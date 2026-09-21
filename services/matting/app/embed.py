"""CLIP image embeddings: the preprocessing, the ONNX session, the model file.

WHAT THIS IS FOR. The shop's own sold history is the cheapest comp source it will
ever have, and an image embedding is how a photo finds it without anybody typing
a search (docs/pricing/00-plan.md step 3). The same numbers also catch the jacket
that was already listed last month — two photos of one garment land at ~0.95+
cosine, which is what the app calls a "near duplicate".

WHY THE MODEL IS HERE AND NOT IN THE APP. 512 floats per photo, 350 MB of
weights, and a CPU-bound forward pass: none of that belongs in a browser, and
none of it belongs behind an API key either. This service already holds the
service role, already downloads every photo, and already has a job runner — so
embedding is the one place it can happen for free.

  MIT all the way down, and written into README "Licences":
    CLIP weights          OpenAI, MIT
    the ONNX export       Xenova/clip-vit-base-patch32, MIT
    onnxruntime           Microsoft, MIT
  NO torch. onnxruntime is ~20 MB of wheel against ~2.5 GB, and nothing here
  needs autograd.

WHY fp32 AND NOT THE QUANTIZED EXPORT. Measured, not assumed, on three real
garment photos (docs/pricing/02-embeddings.md):

  cosine(fp32, int8) per image   0.9216 / 0.9682 / 0.8986   — not > 0.99
  pairwise similarity, fp32      0.842   0.770   0.819
  pairwise similarity, int8      0.785   0.740   0.802       — every pair moved
  latency, 1 thread, arm64       15 ms fp32  vs  25 ms int8  — and slower
  resident after warm-up         407 MB fp32 vs 239 MB int8

The pairwise row is what decides it: this feature does not consume an embedding,
it consumes the COSINE BETWEEN two of them, and it thresholds that number at
0.92 to say "near duplicate". A quantization that shifts every pair down by
0.03-0.06 does not add noise to a ranking, it moves the thresholds out from
under it. The 170 MB saved is not worth re-tuning a user-visible rule for, and
on this hardware it was not even faster.

THE PREPROCESSING IS A CONTRACT, NOT A CHOICE. CLIP was trained on exactly this
pipeline and it is reproduced here to the pixel: shortest side to 224 (bicubic),
centre crop 224, RGB, /255, then the CLIP mean/std. `resize_shortest` even
copies transformers' `int()` truncation on the long side rather than rounding —
one pixel, and matching it means "exactly as CLIP expects" is literally true
rather than approximately true. Getting any of this wrong does not raise; it
quietly produces vectors whose neighbours are almost right, which is the worst
possible failure for a feature whose whole output is a ranking.

EXIF IS HANDLED ONCE, BY `compose.decode_image_rgb`, AND THIS MODULE DOES NOT
TOUCH IT. Pillow does not orient on open, so the service must — and it does, in
the one place the matting pipeline already does it. A photo embedded sideways is
a garment CLIP has never seen; a photo oriented twice is the same bug mirrored.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import os
import tempfile
from typing import Protocol

import httpx
import numpy as np
from PIL import Image

from .config import Settings

log = logging.getLogger("matting.embed")

# CLIP ViT-B/32's projected image embedding. The dimension is part of the
# database type (`vector(512)`), so a model of another width is a migration and
# not a config change.
EMBED_DIM = 512

# CLIPImageProcessor's defaults for openai/clip-vit-base-patch32. Do not round
# these: they are the constants the weights were trained against.
CLIP_SIZE = 224
CLIP_MEAN = np.array([0.48145466, 0.4578275, 0.40821073], dtype=np.float32)
CLIP_STD = np.array([0.26862954, 0.26130258, 0.27577711], dtype=np.float32)

# The export's tensor names, verified against the file itself
# (`in pixel_values [batch,channels,height,width]`, `out image_embeds [batch,512]`).
INPUT_NAME = "pixel_values"
OUTPUT_NAMES = ("image_embeds", "pooler_output", "last_hidden_state")

# A floor under "the download worked". The real check is the byte count and the
# digest from Settings; this catches an HTML error page served with a 200, which
# is what a rate-limited CDN hands back.
MIN_MODEL_BYTES = 1_000_000


class EmbedError(RuntimeError):
    """Anything that stops one photo being embedded. Never fails a whole job."""


# ── preprocessing (pure, and the part most worth testing) ───────────────────


def resize_shortest(size: tuple[int, int], target: int = CLIP_SIZE) -> tuple[int, int]:
    """(w, h) after scaling the SHORTEST side to `target`.

    Transformers' `get_resize_output_image_size(..., default_to_square=False)`
    truncates the long side with `int()`; this copies that rather than rounding,
    so the crop window lands where CLIP's own processor would put it. A degenerate
    input (a zero-width image) is an EmbedError, not a division by zero.
    """
    w, h = int(size[0]), int(size[1])
    if w <= 0 or h <= 0:
        raise EmbedError(f"image has no pixels ({w}x{h})")
    short, long = (w, h) if w <= h else (h, w)
    new_long = int(target * long / short)
    return (target, new_long) if w <= h else (new_long, target)


def preprocess(rgb: np.ndarray, size: int = CLIP_SIZE) -> np.ndarray:
    """RGB uint8 HxWx3 -> NCHW float32 1x3x224x224, normalised for CLIP.

    Takes the ALREADY DECODED, already EXIF-oriented array from
    `compose.decode_image_rgb`, so there is exactly one decoder and one
    orientation rule in this service.
    """
    if rgb.ndim != 3 or rgb.shape[2] != 3:
        raise EmbedError(f"expected an RGB HxWx3 array, got {rgb.shape}")
    h, w = rgb.shape[:2]
    nw, nh = resize_shortest((w, h), size)

    # Pillow's BICUBIC, because that is `PILImageResampling.BICUBIC`, which is
    # what CLIPImageProcessor uses. cv2's INTER_CUBIC is a different kernel and
    # would move every vector a little.
    img = Image.fromarray(rgb, mode="RGB").resize((nw, nh), Image.BICUBIC)
    left = (nw - size) // 2
    top = (nh - size) // 2
    img = img.crop((left, top, left + size, top + size))

    arr = np.asarray(img, dtype=np.float32) / 255.0
    arr = (arr - CLIP_MEAN) / CLIP_STD
    return np.ascontiguousarray(np.transpose(arr, (2, 0, 1))[None, ...], dtype=np.float32)


def l2_normalise(vec: np.ndarray) -> np.ndarray:
    """Unit-length float32, so cosine is a dot product everywhere downstream.

    The database's `<=>` is cosine distance and would normalise internally, but
    doing it HERE is what lets every other reader — a future SQL query, a script,
    the app — treat the stored numbers as directions without remembering to. A
    zero vector cannot be normalised and is a failure rather than a NaN row: NaNs
    in a vector column sort first and silently become everything's best comp.
    """
    v = np.asarray(vec, dtype=np.float32).reshape(-1)
    norm = float(np.linalg.norm(v))
    if not np.isfinite(norm) or norm <= 0.0:
        raise EmbedError("embedding has no magnitude (model returned zeros or NaN)")
    return (v / norm).astype(np.float32)


def to_pgvector(vec: np.ndarray) -> str:
    """pgvector's text input form: '[0.1,0.2,…]'.

    PostgREST sends JSON, and there is no JSON type for a vector — so the value
    goes over as a STRING in exactly this shape and Postgres casts it on the way
    in. `repr` on a float32 would emit numpy's own formatting; `float()` first
    keeps it plain and short.
    """
    v = np.asarray(vec, dtype=np.float32).reshape(-1)
    if v.size != EMBED_DIM:
        raise EmbedError(f"expected {EMBED_DIM} dimensions, got {v.size}")
    if not np.all(np.isfinite(v)):
        raise EmbedError("embedding contains NaN or infinity")
    return "[" + ",".join(f"{float(x):.7g}" for x in v) + "]"


# ── the model file ──────────────────────────────────────────────────────────


def model_is_present(settings: Settings) -> bool:
    """True when a plausible model file is already cached.

    Size only — re-hashing 350 MB on every startup buys nothing, because the
    digest is checked when the file is WRITTEN and nothing else writes there.
    """
    path = settings.embed_model_path
    try:
        size = os.path.getsize(path)
    except OSError:
        return False
    if size < MIN_MODEL_BYTES:
        return False
    return settings.embed_model_bytes <= 0 or size == settings.embed_model_bytes


async def ensure_model_file(client: httpx.AsyncClient, settings: Settings) -> str:
    """Download the model into MODEL_CACHE_DIR if it is not already there.

    Streamed to a temporary file in the SAME directory and then `os.replace`d,
    which is atomic on one filesystem: a process killed mid-download (Fly stops
    an idle machine, and this is a ~350 MB fetch) leaves a `.part` file behind
    and never a truncated `vision_model.onnx` that the next start would happily
    load and produce subtly wrong vectors from.

    Verified two ways before the rename — the byte count and the sha256 — because
    a short read does not raise. Either mismatch deletes the temporary file and
    raises; the model is then simply absent, which fails embedding with a legible
    reason and leaves matting untouched.
    """
    path = settings.embed_model_path
    if model_is_present(settings):
        return path

    directory = os.path.dirname(path) or "."
    os.makedirs(directory, exist_ok=True)

    digest = hashlib.sha256()
    written = 0
    fd, tmp = tempfile.mkstemp(dir=directory, prefix=".model-", suffix=".part")
    try:
        with os.fdopen(fd, "wb") as fh:
            async with client.stream("GET", settings.embed_model_url, timeout=600.0) as resp:
                if resp.status_code != 200:
                    raise EmbedError(
                        f"model download failed ({resp.status_code}) for {settings.embed_model_url}"
                    )
                async for chunk in resp.aiter_bytes(1024 * 1024):
                    fh.write(chunk)
                    digest.update(chunk)
                    written += len(chunk)

        if written < MIN_MODEL_BYTES:
            raise EmbedError(f"model download is only {written} bytes — not a model file")
        if settings.embed_model_bytes > 0 and written != settings.embed_model_bytes:
            raise EmbedError(
                f"model download is {written} bytes, expected {settings.embed_model_bytes}"
            )
        if settings.embed_model_sha256 and digest.hexdigest() != settings.embed_model_sha256:
            raise EmbedError("model download failed its sha256 check")

        os.replace(tmp, path)
        log.info("embed: model cached at %s (%d bytes)", path, written)
        return path
    except BaseException:
        # Including CancelledError: a partial file that passed no check must not
        # be left where `model_is_present` could accept it on the next start.
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


# ── the session ─────────────────────────────────────────────────────────────


def pick_output(outputs: list[tuple[str, list]]) -> str:
    """Which of the export's outputs is the image embedding.

    Extracted from the session build so it can be tested without 350 MB of
    weights, and because the failure it prevents is silent: `last_hidden_state`
    is 50x768 and a shape-agnostic caller would accept it, hand it to
    `l2_normalise`, and write 512 of the 38,400 numbers into the database — a
    vector that is not wrong in any way Postgres can see and is noise in every
    way that matters.
    """
    if not outputs:
        raise EmbedError("the model has no outputs")
    names = [name for name, _ in outputs]
    chosen = next((n for n in OUTPUT_NAMES if n in names), None) or names[0]
    shape = next(s for n, s in outputs if n == chosen)
    if len(shape) == 2 and isinstance(shape[1], int) and shape[1] != EMBED_DIM:
        raise EmbedError(f"model output {chosen} is {shape[1]}-wide, expected {EMBED_DIM}")
    return chosen


class Embedder(Protocol):
    """What the job runner needs. A test supplies its own."""

    tag: str

    async def embed(self, rgb: np.ndarray) -> np.ndarray: ...


class OnnxEmbedder:
    """CLIP ViT-B/32's vision tower, loaded lazily and shared for the process.

    LAZY ON PURPOSE. Importing onnxruntime and loading 350 MB takes seconds and
    ~400 MB of resident memory; doing it in `lifespan` would make /healthz and
    the whole matting path pay for a feature a given deployment may never use.
    The first `/v1/embed` pays instead, once.

    THREAD-SAFE ENOUGH, and the reason is worth stating: `InferenceSession.run`
    is safe to call concurrently, so the lock covers CONSTRUCTION only. Without
    it, two images arriving together would each build a session and the machine
    would briefly hold 800 MB — which on a 1 GB box is the OOM the memory note in
    the README is about.
    """

    def __init__(self, settings: Settings) -> None:
        self._s = settings
        self._session: object | None = None
        self._output: str | None = None
        self._lock = asyncio.Lock()
        self.tag = settings.embed_tag

    def loaded(self) -> bool:
        return self._session is not None

    def _build(self) -> tuple[object, str]:
        """Blocking. Called through `to_thread`."""
        try:
            import onnxruntime as ort  # noqa: PLC0415 — see the class docstring
        except Exception as exc:
            raise EmbedError("onnxruntime is not installed in this image") from exc

        path = self._s.embed_model_path
        if not model_is_present(self._s):
            raise EmbedError(f"the embedding model is not downloaded yet ({path})")

        options = ort.SessionOptions()
        options.intra_op_num_threads = self._s.embed_threads
        options.inter_op_num_threads = 1
        # The graph optimisations are worth ~10% here and cost nothing; the
        # default already applies them, and saying so keeps it from being a
        # mystery if a future ORT changes its default.
        options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        session = ort.InferenceSession(path, sess_options=options, providers=["CPUExecutionProvider"])

        chosen = pick_output([(o.name, list(o.shape)) for o in session.get_outputs()])
        log.info("embed: loaded %s output=%s tag=%s", path, chosen, self.tag)
        return session, chosen

    async def _ensure(self) -> tuple[object, str]:
        if self._session is not None and self._output is not None:
            return self._session, self._output
        async with self._lock:
            if self._session is None or self._output is None:
                session, output = await asyncio.to_thread(self._build)
                self._session, self._output = session, output
        return self._session, self._output  # type: ignore[return-value]

    async def embed(self, rgb: np.ndarray) -> np.ndarray:
        """One photo -> one L2-normalised 512-float vector.

        Both halves run in a thread: inference is CPU-bound and so, at 12 MP, is
        the bicubic resize. Either on the event loop would stall the job's own
        progress polling and the health check with it.
        """
        session, output = await self._ensure()
        batch = await asyncio.to_thread(preprocess, rgb)
        raw = await asyncio.to_thread(
            lambda: session.run([output], {INPUT_NAME: batch})[0]  # type: ignore[attr-defined]
        )
        arr = np.asarray(raw, dtype=np.float32)
        if arr.ndim == 3:
            # A pooler-less export can hand back 1xNx512; the first token is the
            # CLS embedding. Never averaged — CLIP's projection is trained on CLS.
            arr = arr[:, 0, :]
        return l2_normalise(arr.reshape(-1)[:EMBED_DIM])
