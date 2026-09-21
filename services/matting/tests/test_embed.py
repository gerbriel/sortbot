"""The embedding model: preprocessing, normalisation, the wire format, the file.

WHY THE PREPROCESSING IS THE MOST-TESTED PART OF THIS FEATURE. Nothing here can
fail loudly. A wrong resample kernel, a rounded long edge, a forgotten /255, the
mean and std swapped — every one of those produces a 512-float unit vector that
Postgres accepts, that sorts, and whose neighbour list is *almost* right. There
is no assertion anywhere else in the system that would catch it, and the symptom
("the similar-listings strip is a bit rubbish") is unfalsifiable by eye.

So these tests pin the pipeline to CLIP's own: shortest side to 224 with PIL
bicubic, centre crop, /255, then the published mean/std — including transformers'
`int()` truncation on the long edge, which is one pixel and is the difference
between "exactly as CLIP expects" being true and being nearly true.

NOTHING HERE TOUCHES THE NETWORK OR LOADS A MODEL. The 350 MB of weights are
downloaded at run time (app/embed.ensure_model_file) and a copy of them has no
business in a test suite; the ONNX session is stood in for, and the download is
driven through httpx.MockTransport like everything else in this suite.
"""

from __future__ import annotations

import os

import httpx
import numpy as np
import pytest
from PIL import Image

from app.embed import (
    CLIP_MEAN,
    CLIP_SIZE,
    CLIP_STD,
    EMBED_DIM,
    MIN_MODEL_BYTES,
    EmbedError,
    OnnxEmbedder,
    ensure_model_file,
    l2_normalise,
    model_is_present,
    pick_output,
    preprocess,
    resize_shortest,
    to_pgvector,
)
from tests.conftest import flat_rgb, gradient_rgb

# ── resize_shortest ─────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("size", "expected"),
    [
        ((500, 500), (224, 224)),   # square: both sides land on the target
        ((400, 300), (298, 224)),   # landscape: int(224*400/300) = 298, NOT 299
        ((300, 400), (224, 298)),   # portrait: the mirror image
        ((10, 10), (224, 224)),     # upscaled — CLIP has no minimum
        ((4032, 3024), (298, 224)), # a real phone photo, same ratio as above
        ((224, 224), (224, 224)),   # already there: a no-op, not an off-by-one
    ],
)
def test_the_shortest_side_lands_on_224_and_the_long_side_is_truncated(size, expected):
    assert resize_shortest(size) == expected


def test_the_truncation_is_transformers_int_and_not_a_round():
    """224 * 401/300 = 299.4666 -> 299 either way; 224 * 400/300 = 298.666 -> 298
    by truncation and 299 by rounding. That one pixel shifts the centre crop."""
    assert resize_shortest((400, 300))[0] == 298
    assert resize_shortest((401, 300))[0] == 299


def test_an_image_with_no_pixels_is_a_legible_error_not_a_zero_division():
    for size in ((0, 100), (100, 0), (0, 0)):
        with pytest.raises(EmbedError):
            resize_shortest(size)


# ── preprocess ──────────────────────────────────────────────────────────────


def test_the_batch_is_exactly_what_the_onnx_input_expects():
    batch = preprocess(gradient_rgb(300, 500))
    assert batch.shape == (1, 3, CLIP_SIZE, CLIP_SIZE)
    assert batch.dtype == np.float32
    assert batch.flags["C_CONTIGUOUS"]  # ORT copies a non-contiguous array


def test_the_normalisation_is_the_published_clip_mean_and_std():
    """A flat colour is the one input where the expected value is arithmetic:
    every pixel of channel c must be (v/255 - mean[c]) / std[c]."""
    rgb = flat_rgb(400, 400, (128, 64, 32))
    batch = preprocess(rgb)[0]
    for channel, raw in enumerate((128, 64, 32)):
        expected = (raw / 255.0 - float(CLIP_MEAN[channel])) / float(CLIP_STD[channel])
        assert np.allclose(batch[channel], expected, atol=1e-5)


def test_the_channel_order_is_rgb_and_the_layout_is_nchw():
    """Pure red must put its energy in channel 0. A BGR slip is invisible in any
    aggregate statistic and ruins every neighbour list."""
    batch = preprocess(flat_rgb(300, 300, (255, 0, 0)))[0]
    assert batch[0].mean() > batch[1].mean()
    assert batch[0].mean() > batch[2].mean()
    assert batch.shape == (3, CLIP_SIZE, CLIP_SIZE)


def test_the_crop_is_CENTRED_not_taken_from_a_corner():
    """A gradient makes the answer checkable: the crop's mean must match the
    middle of the resized image, not its top-left."""
    rgb = gradient_rgb(300, 900)  # x ramps 0..255 across a wide frame
    batch = preprocess(rgb)[0]
    # Channel 0 carries the x ramp. Centred, its mean sits near the mid grey;
    # a top-left crop would sit far below it.
    centre = (127.5 / 255.0 - float(CLIP_MEAN[0])) / float(CLIP_STD[0])
    assert abs(float(batch[0].mean()) - centre) < 0.25


def test_the_resample_is_pil_bicubic_and_not_something_close_to_it():
    """Asserted against PIL directly rather than against a golden array: the
    claim is 'the same kernel CLIPImageProcessor uses', and this is that claim."""
    rgb = gradient_rgb(300, 500)
    reference = np.asarray(
        Image.fromarray(rgb, "RGB").resize((373, 224), Image.BICUBIC).crop((74, 0, 298, 224)),
        dtype=np.float32,
    ) / 255.0
    reference = np.transpose((reference - CLIP_MEAN) / CLIP_STD, (2, 0, 1))
    assert np.allclose(preprocess(rgb)[0], reference, atol=1e-6)


def test_a_non_rgb_array_is_refused_rather_than_silently_reshaped():
    with pytest.raises(EmbedError):
        preprocess(np.zeros((10, 10), dtype=np.uint8))
    with pytest.raises(EmbedError):
        preprocess(np.zeros((10, 10, 4), dtype=np.uint8))


# ── l2_normalise ────────────────────────────────────────────────────────────


def test_the_vector_comes_out_unit_length():
    v = l2_normalise(np.arange(EMBED_DIM, dtype=np.float32) + 1.0)
    assert abs(float(np.linalg.norm(v)) - 1.0) < 1e-6
    assert v.dtype == np.float32


def test_normalising_is_idempotent():
    once = l2_normalise(np.random.RandomState(7).randn(EMBED_DIM).astype(np.float32))
    assert np.allclose(once, l2_normalise(once), atol=1e-6)


def test_a_zero_vector_is_an_error_and_never_a_row_of_nans():
    """A NaN vector sorts FIRST in pgvector and would become everything's best
    comp, silently, for as long as the row existed."""
    with pytest.raises(EmbedError):
        l2_normalise(np.zeros(EMBED_DIM, dtype=np.float32))


def test_a_nan_vector_is_an_error():
    bad = np.ones(EMBED_DIM, dtype=np.float32)
    bad[3] = np.nan
    with pytest.raises(EmbedError):
        l2_normalise(bad)


# ── to_pgvector ─────────────────────────────────────────────────────────────


def test_the_wire_format_is_pgvectors_own_text_form():
    text = to_pgvector(l2_normalise(np.ones(EMBED_DIM, dtype=np.float32)))
    assert text.startswith("[") and text.endswith("]")
    parts = text[1:-1].split(",")
    assert len(parts) == EMBED_DIM
    assert all("[" not in p and "]" not in p and " " not in p for p in parts)


def test_the_text_form_parses_back_to_the_same_vector():
    v = l2_normalise(np.random.RandomState(3).randn(EMBED_DIM).astype(np.float32))
    parsed = np.array([float(x) for x in to_pgvector(v)[1:-1].split(",")], dtype=np.float32)
    assert np.allclose(v, parsed, atol=1e-6)


def test_numpy_float_repr_never_reaches_the_wire():
    """`repr(np.float32(0.1))` is 'np.float32(0.1)' on numpy 2, which Postgres
    would reject — one cast error for a whole 50-row chunk."""
    text = to_pgvector(l2_normalise(np.full(EMBED_DIM, 0.1, dtype=np.float32)))
    assert "np." not in text and "float32" not in text


def test_the_wrong_dimension_is_refused_here_rather_than_by_postgres():
    with pytest.raises(EmbedError):
        to_pgvector(np.ones(511, dtype=np.float32))
    with pytest.raises(EmbedError):
        to_pgvector(np.ones(513, dtype=np.float32))


def test_a_non_finite_value_is_refused():
    bad = np.ones(EMBED_DIM, dtype=np.float32)
    bad[0] = np.inf
    with pytest.raises(EmbedError):
        to_pgvector(bad)


# ── pick_output ─────────────────────────────────────────────────────────────


def test_the_image_embeds_output_is_preferred():
    assert pick_output([("last_hidden_state", [1, 50, 768]), ("image_embeds", [1, 512])]) == "image_embeds"


def test_a_pooler_only_export_is_accepted():
    assert pick_output([("pooler_output", [1, 512])]) == "pooler_output"


def test_a_768_wide_output_is_refused_rather_than_truncated_into_the_database():
    with pytest.raises(EmbedError):
        pick_output([("last_hidden_state", [1, 768])])


def test_a_model_with_no_outputs_is_an_error():
    with pytest.raises(EmbedError):
        pick_output([])


def test_a_dynamic_width_is_accepted_because_it_cannot_be_checked_statically():
    assert pick_output([("image_embeds", [1, "hidden"])]) == "image_embeds"


# ── the model file ──────────────────────────────────────────────────────────


def settings_for(tmp_path, settings, **over):
    import dataclasses

    return dataclasses.replace(settings, model_cache_dir=str(tmp_path), **over)


def test_model_is_present_wants_the_exact_expected_size(tmp_path, settings):
    s = settings_for(tmp_path, settings, embed_model_bytes=MIN_MODEL_BYTES + 10)
    assert model_is_present(s) is False  # nothing there at all

    path = os.path.join(str(tmp_path), s.embed_model_file)
    with open(path, "wb") as fh:
        fh.write(b"\0" * 10)
    assert model_is_present(s) is False  # an HTML error page, not a model

    with open(path, "wb") as fh:
        fh.write(b"\0" * (MIN_MODEL_BYTES + 10))
    assert model_is_present(s) is True


def test_model_is_present_ignores_the_size_when_it_is_not_configured(tmp_path, settings):
    s = settings_for(tmp_path, settings, embed_model_bytes=0)
    path = os.path.join(str(tmp_path), s.embed_model_file)
    with open(path, "wb") as fh:
        fh.write(b"\0" * (MIN_MODEL_BYTES + 1))
    assert model_is_present(s) is True


def _payload(n: int = MIN_MODEL_BYTES + 5) -> bytes:
    return b"onnx" + b"\x01" * (n - 4)


def _client(body: bytes | None, status: int = 200, calls: list | None = None):
    def handler(request: httpx.Request) -> httpx.Response:
        if calls is not None:
            calls.append(request)
        if body is None:
            return httpx.Response(status, text="nope")
        return httpx.Response(status, content=body)

    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


async def test_a_good_download_lands_at_the_cache_path(tmp_path, settings):
    import hashlib

    body = _payload()
    s = settings_for(
        tmp_path,
        settings,
        embed_model_bytes=len(body),
        embed_model_sha256=hashlib.sha256(body).hexdigest(),
    )
    async with _client(body) as client:
        path = await ensure_model_file(client, s)
    assert path == s.embed_model_path
    assert os.path.getsize(path) == len(body)


async def test_an_already_cached_model_makes_no_request_at_all(tmp_path, settings):
    body = _payload()
    s = settings_for(tmp_path, settings, embed_model_bytes=len(body), embed_model_sha256="")
    with open(s.embed_model_path, "wb") as fh:
        fh.write(body)
    calls: list = []
    async with _client(body, calls=calls) as client:
        await ensure_model_file(client, s)
    assert calls == []


async def test_a_404_raises_and_leaves_nothing_behind(tmp_path, settings):
    s = settings_for(tmp_path, settings, embed_model_sha256="")
    async with _client(None, status=404) as client:
        with pytest.raises(EmbedError):
            await ensure_model_file(client, s)
    assert os.listdir(str(tmp_path)) == []


async def test_a_truncated_download_is_rejected_and_leaves_nothing_behind(tmp_path, settings):
    """THE FAILURE THIS EXISTS FOR: a short read does not raise. Without the byte
    check, a half-downloaded 350 MB file would be cached, accepted by
    model_is_present on the next start, and fail one image at a time inside a
    worker — or worse, load and produce wrong vectors."""
    body = _payload()
    s = settings_for(
        tmp_path, settings, embed_model_bytes=len(body) + 1000, embed_model_sha256=""
    )
    async with _client(body) as client:
        with pytest.raises(EmbedError):
            await ensure_model_file(client, s)
    assert os.listdir(str(tmp_path)) == []


async def test_a_body_too_small_to_be_a_model_is_rejected(tmp_path, settings):
    """An HTML error page served with a 200 — what a rate-limited CDN hands back."""
    s = settings_for(tmp_path, settings, embed_model_bytes=0, embed_model_sha256="")
    async with _client(b"<html>rate limited</html>") as client:
        with pytest.raises(EmbedError):
            await ensure_model_file(client, s)
    assert os.listdir(str(tmp_path)) == []


async def test_a_wrong_digest_is_rejected_and_leaves_nothing_behind(tmp_path, settings):
    body = _payload()
    s = settings_for(tmp_path, settings, embed_model_bytes=len(body), embed_model_sha256="00" * 32)
    async with _client(body) as client:
        with pytest.raises(EmbedError):
            await ensure_model_file(client, s)
    assert os.listdir(str(tmp_path)) == []


async def test_the_digest_check_can_be_turned_off_for_a_custom_export(tmp_path, settings):
    body = _payload()
    s = settings_for(tmp_path, settings, embed_model_bytes=len(body), embed_model_sha256="")
    async with _client(body) as client:
        await ensure_model_file(client, s)
    assert model_is_present(s) is True


def test_the_cache_filename_and_tag_are_derived_from_the_url(settings):
    import dataclasses

    fp32 = dataclasses.replace(settings, embed_model_url="https://h/onnx/vision_model.onnx")
    assert fp32.embed_model_file == "vision_model.onnx"
    assert fp32.embed_tag == "clip-vit-base-patch32@onnx"

    q8 = dataclasses.replace(
        settings, embed_model_url="https://h/onnx/vision_model_quantized.onnx"
    )
    assert q8.embed_model_file == "vision_model_quantized.onnx"
    # A DIFFERENT tag, so the RPC never compares the two populations. Swapping the
    # URL without the tag changing is the mistake this derivation prevents.
    assert q8.embed_tag == "clip-vit-base-patch32@onnx-q8"


def test_an_explicit_tag_wins_over_the_derived_one(settings):
    import dataclasses

    s = dataclasses.replace(settings, embed_model_tag="my-own-export@1")
    assert s.embed_tag == "my-own-export@1"


# ── OnnxEmbedder, with a stand-in session ───────────────────────────────────


class FakeSession:
    """Returns a fixed array and records what it was fed."""

    def __init__(self, out: np.ndarray) -> None:
        self.out = out
        self.fed: list[np.ndarray] = []

    def run(self, names, feeds):  # noqa: ARG002 — the ORT signature
        self.fed.append(feeds["pixel_values"])
        return [self.out]


def embedder_with(settings, out: np.ndarray) -> tuple[OnnxEmbedder, FakeSession]:
    session = FakeSession(out)
    e = OnnxEmbedder(settings)
    e._session = session  # noqa: SLF001 — standing in for a 350 MB load
    e._output = "image_embeds"  # noqa: SLF001
    return e, session


async def test_the_embedder_feeds_a_preprocessed_batch_and_normalises_the_output(settings):
    raw = np.arange(EMBED_DIM, dtype=np.float32)[None, :] + 1.0
    e, session = embedder_with(settings, raw)
    vec = await e.embed(gradient_rgb(300, 400))
    assert session.fed[0].shape == (1, 3, CLIP_SIZE, CLIP_SIZE)
    assert vec.shape == (EMBED_DIM,)
    assert abs(float(np.linalg.norm(vec)) - 1.0) < 1e-6


async def test_a_three_dimensional_output_takes_the_CLS_token_not_the_mean(settings):
    """CLIP's projection is trained on the CLS token. Averaging the sequence
    would produce a plausible unit vector from the wrong quantity."""
    out = np.zeros((1, 4, EMBED_DIM), dtype=np.float32)
    out[0, 0, 0] = 1.0   # CLS points at axis 0
    out[0, 1:, 1] = 9.0  # the rest point at axis 1, and much harder
    e, _ = embedder_with(settings, out)
    vec = await e.embed(flat_rgb(240, 240))
    assert vec[0] == pytest.approx(1.0)
    assert vec[1] == pytest.approx(0.0)


async def test_a_zero_output_fails_the_photo_rather_than_writing_a_null_vector(settings):
    e, _ = embedder_with(settings, np.zeros((1, EMBED_DIM), dtype=np.float32))
    with pytest.raises(EmbedError):
        await e.embed(flat_rgb(240, 240))


async def test_loading_without_a_model_file_says_so_in_words(tmp_path, settings):
    e = OnnxEmbedder(settings_for(tmp_path, settings))
    assert e.loaded() is False
    with pytest.raises(EmbedError) as caught:
        await e.embed(flat_rgb(240, 240))
    assert "not downloaded" in str(caught.value) or "onnxruntime" in str(caught.value)


def test_the_embedder_carries_the_tag_that_lands_in_the_row(settings):
    e = OnnxEmbedder(settings)
    assert e.tag == settings.embed_tag == "clip-vit-base-patch32@onnx"
