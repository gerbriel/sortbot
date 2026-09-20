"""Replicate backend — BiRefNet as a hosted prediction.

VERIFIED AGAINST THE MODEL'S OWN SCHEMA (replicate.com/men1scus/birefnet/api/schema,
September 2026), because getting this wrong is a 422 on every image:

    input.image       string, format uri, REQUIRED   "Input image"
    input.resolution  string, default ""             "Resolution in WxH format,
                                                      e.g., '1024x1024'"
    output            string, format uri             a single URL

Two things follow from that and are easy to get wrong:

  * `resolution` is a STRING "WxH", not an integer. The service contract talks
    about 1024/2048 as integers, so the translation happens here — `1024` is
    sent as `"1024x1024"`.
  * `output` is ONE url, not a list. Other BiRefNet packagings return a list of
    one; `_first_url` accepts either rather than betting on the shape.

The model returns a cut-out PNG (RGBA), so the alpha comes from its alpha
channel. If a future version or a different REPLICATE_MODEL returns a greyscale
MASK instead, that is handled too — it is one `if` and it costs nothing,
whereas discovering the difference in production means every photo silently
composites as a black rectangle.

── WHAT THE FIRST PRODUCTION RUN TAUGHT THIS FILE (Sept 20 2026) ──────────────

Three photos, three `failed` rows, and one flag repeated three times:

    error:RuntimeError: replicate create failed (429)

The status was a lie of omission. Asked by hand, Replicate answered **402**
`{"title":"Insufficient credit","detail":"You have insufficient credit to run
this model. Go to https://replicate.com/account/billing…"}` — a billing gate. The
429 was the same gate under concurrency. Two rules come out of that, and they are
the reason the code below is shaped the way it is:

  1. SAY WHAT REPLICATE SAID. `_error_message` puts their own `title` and `detail`
     into the flag, so the review queue reads "add credit" rather than a status
     code. `_scrub` keeps the token and the image URL out of it.

  2. RETRY WHAT CAN RECOVER, AND ONLY THAT. 429 and 5xx get the ladder (2, 4, 8,
     16, 32 s, ±20% jitter) because they are load and they pass. **402 and every
     other 4xx fail on the first response**: insufficient credit does not appear
     within a minute, an unpinned/unknown version never will, and retrying turns
     one legible failure into six identical log lines and a minute of a worker
     slot per photo.
"""

from __future__ import annotations

import asyncio
import json as jsonlib
import logging
import random
import re
import time

import httpx
import numpy as np

from ..compose import decode_image_rgba
from ..config import Settings
from .base import BackendUnavailable, MattingFailure, refine_alpha

log = logging.getLogger("matting.replicate")

API_ROOT = "https://api.replicate.com/v1"
TERMINAL_OK = "succeeded"
TERMINAL_BAD = ("failed", "canceled")

# The flag written to product_images.mask_flags is `error:` + this message, and
# the whole flag is capped at 200 characters by the pipeline. 300 is what the
# server-side log keeps of a body.
LOG_BODY_CHARS = 300
MESSAGE_CHARS = 240
# Proportional jitter, so five clients that failed together do not retry together.
RETRY_JITTER = 0.2
# Only these come back. Everything else is a statement about the request, not
# about the moment — see rule 2 in the module docstring.
RETRYABLE_STATUS = (429, 500, 502, 503, 504, 408, 522, 524)

TOKEN_SHAPED = re.compile(r"r8_[A-Za-z0-9]{8,}")


class ReplicateError(MattingFailure):
    """A non-2xx from Replicate, carrying the reason Replicate gave for it."""


async def _backoff_sleep(seconds: float) -> None:
    """The one sleep in the retry ladder, named so a test can replace it.

    A separate seam from the poll loop's `asyncio.sleep` on purpose: a test that
    asserts the ladder is 2, 4, 8, 16, 32 must be able to record exactly those
    delays without the poll interval mixed in, and it must not have to patch the
    stdlib to do it.
    """
    await asyncio.sleep(seconds)


def _scrub(text: str, redact: tuple[str, ...]) -> str:
    """Remove anything that must not reach a database column or a log line.

    Two things, specifically. The API TOKEN, which a proxy in front of Replicate
    could conceivably echo back in an error body; and the IMAGE URL, which the
    create endpoint DOES echo in a 422 and which would be a signed link once the
    bucket goes private. mask_flags is read in the review UI, so this is the last
    place either could leak.
    """
    out = " ".join(text.split())
    for secret in redact:
        if secret and len(secret) > 8:
            out = out.replace(secret, "<redacted>")
    out = TOKEN_SHAPED.sub("<redacted>", out)
    # A data: URI is the private-bucket fallback: megabytes of base64 that would
    # otherwise be truncated INTO the flag.
    out = re.sub(r"data:[^\s,]{0,40},[A-Za-z0-9+/=]{16,}", "<inline image>", out)
    return out[:MESSAGE_CHARS]


def _title_detail(body_text: str) -> tuple[str, str]:
    """Replicate's error shape is `{title, detail, status}`. Others differ.

    Accepts `error` and `message` as a detail too, because a proxy or an older
    endpoint uses those and losing the sentence is the failure this fixes.
    """
    try:
        body = jsonlib.loads(body_text or "")
    except Exception:
        return "", ""
    if not isinstance(body, dict):
        return "", ""

    def pick(*keys: str) -> str:
        for key in keys:
            v = body.get(key)
            if isinstance(v, str) and v.strip():
                return v.strip()
        return ""

    return pick("title"), pick("detail", "error", "message")


def _error_message(status: int, body_text: str, context: str, redact: tuple[str, ...]) -> str:
    """`replicate <status> <title> — <detail>`, per CONTRACT.md §8.1.

    `context` fills the title slot when the body has no `title` — so a 502 HTML
    page from a proxy still reads as a sentence ("replicate 502 poll failed")
    rather than as a bare number with a dash hanging off it.
    """
    title, detail = _title_detail(body_text)
    head = f"replicate {status} {title or context}".rstrip()
    return _scrub(head + (f" — {detail}" if detail else ""), redact)


def _first_url(output: object) -> str | None:
    if isinstance(output, str):
        return output or None
    if isinstance(output, list):
        for item in output:
            if isinstance(item, str) and item:
                return item
    if isinstance(output, dict):
        for key in ("image", "output", "mask"):
            v = output.get(key)
            if isinstance(v, str) and v:
                return v
    return None


class ReplicateMatter:
    """Matter backed by a Replicate prediction."""

    def __init__(self, settings: Settings, client: httpx.AsyncClient) -> None:
        if not settings.replicate_token:
            raise BackendUnavailable("REPLICATE_API_TOKEN is not set")
        self._s = settings
        self._client = client
        owner, name = settings.model_owner_name
        version = settings.replicate_version
        # The tag records the PIN, not the model name, because "which weights
        # cut this photo" is the question you ask when a batch comes out wrong.
        suffix = version[:8] if version else "unpinned"
        self._tag = f"replicate:{owner}/{name}@{suffix}" if owner else f"replicate:{name}@{suffix}"

    @property
    def tag(self) -> str:
        return self._tag

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self._s.replicate_token}",
            "Content-Type": "application/json",
        }

    async def latest_version(self) -> str | None:
        """Ask Replicate what the current version is, for the startup log line.

        This is informational only — it deliberately does NOT become the pin. A
        service that pins itself to "whatever is latest at boot" re-pins every
        restart, which is the unpinned problem with extra steps.
        """
        owner, name = self._s.model_owner_name
        if not owner:
            return None
        try:
            resp = await self._client.get(
                f"{API_ROOT}/models/{owner}/{name}", headers=self._headers(), timeout=20.0
            )
            if resp.status_code != 200:
                log.warning("replicate: model lookup returned %s", resp.status_code)
                return None
            vid = (resp.json().get("latest_version") or {}).get("id")
            return vid if isinstance(vid, str) else None
        except Exception as exc:
            log.warning("replicate: model lookup failed: %s", exc)
            return None

    def _redactions(self, image_url: str) -> tuple[str, ...]:
        return (self._s.replicate_token, image_url)

    async def _request(
        self,
        method: str,
        url: str,
        *,
        context: str,
        image_url: str,
        timeout: float,
        ok: tuple[int, ...] = (200, 201),
        auth: bool = True,
        **kwargs: object,
    ) -> httpx.Response:
        """One Replicate call, with the documented retry ladder.

        Retries 429, 5xx and transport errors `REPLICATE_RETRY_ATTEMPTS` times
        with delays base * 2**n and ±20% jitter (2, 4, 8, 16, 32 s by default).
        Raises `ReplicateError` on anything else, and after the last retry.

        THE ASYMMETRY IS THE POINT. A 429 is the service telling us to slow down,
        and slowing down works. A 402 is the service telling us the account cannot
        run the model, and no amount of waiting changes that — retrying it would
        have turned the founder's three-photo run into eighteen requests, a minute
        of dead worker time per photo, and the same flag at the end.
        """
        redact = self._redactions(image_url)
        attempts = max(0, self._s.replicate_retry_attempts)
        base = max(0.0, self._s.replicate_retry_base_seconds)
        last: ReplicateError | None = None

        for attempt in range(attempts + 1):
            if attempt:
                delay = base * (2**(attempt - 1))
                delay *= 1.0 + random.uniform(-RETRY_JITTER, RETRY_JITTER)
                log.warning(
                    "replicate: %s retry %d/%d in %.1fs", context, attempt, attempts, delay
                )
                await _backoff_sleep(max(0.0, delay))

            try:
                resp = await self._client.request(
                    method,
                    url,
                    # The output lives on replicate.delivery, which needs no
                    # credential — so it does not get one. Same reasoning as
                    # `_scrub`: a token travels only where it is required.
                    headers=self._headers() if auth else {},
                    timeout=timeout,
                    **kwargs,
                )
            except httpx.HTTPError as exc:
                # A connection reset or a read timeout is the same class of
                # problem as a 502 and recovers the same way.
                last = ReplicateError(
                    _scrub(f"replicate {context} transport error: {type(exc).__name__}", redact)
                )
                log.warning("replicate: %s transport error: %s", context, exc)
                continue

            if resp.status_code in ok:
                return resp

            body = resp.text[:LOG_BODY_CHARS] if resp.text else ""
            log.error("replicate: %s returned %s %s", context, resp.status_code, body)
            last = ReplicateError(_error_message(resp.status_code, resp.text or "", context, redact))
            if resp.status_code not in RETRYABLE_STATUS:
                raise last

        raise last or ReplicateError(_scrub(f"replicate {context} failed", redact))

    def _build_input(self, image_url: str, want_resolution: int) -> dict[str, object]:
        payload: dict[str, object] = {self._s.replicate_input_key: image_url}
        if want_resolution:
            # "WxH", per the schema. An empty string means "the model decides".
            payload[self._s.replicate_resolution_key] = f"{want_resolution}x{want_resolution}"
        return payload

    async def _create_prediction(self, image_url: str, want_resolution: int) -> dict:
        body: dict[str, object] = {"input": self._build_input(image_url, want_resolution)}
        if self._s.replicate_version:
            url = f"{API_ROOT}/predictions"
            body["version"] = self._s.replicate_version
        else:
            # Unpinned: only reachable with MATTING_ENV=dev (config.validate).
            owner, name = self._s.model_owner_name
            url = f"{API_ROOT}/models/{owner}/{name}/predictions"

        resp = await self._request(
            "POST", url, context="create failed", image_url=image_url, timeout=60.0, json=body
        )
        return resp.json()

    async def _poll(self, prediction: dict, image_url: str = "") -> dict:
        """Poll until terminal, with a linear backoff and a hard deadline.

        Backoff grows to 4x the base interval: a cold Replicate container can
        take ~30 s to boot and then ~2 s per image, so polling every second for
        three minutes is 180 requests for one $0.0017 job. The deadline exists
        because a prediction that never reaches a terminal state would otherwise
        hold one of CONCURRENCY worker slots forever, and a wedged worker pool
        looks exactly like "the feature stopped working" with nothing in the log.
        """
        status = prediction.get("status")
        get_url = (prediction.get("urls") or {}).get("get")
        if not get_url:
            pid = prediction.get("id")
            if not pid:
                raise ReplicateError("replicate: prediction has no id and no poll url")
            get_url = f"{API_ROOT}/predictions/{pid}"

        deadline = time.monotonic() + self._s.replicate_timeout_seconds
        delay = self._s.replicate_poll_seconds
        while status not in (TERMINAL_OK, *TERMINAL_BAD):
            if time.monotonic() > deadline:
                raise TimeoutError(
                    f"replicate: prediction did not finish within "
                    f"{self._s.replicate_timeout_seconds:.0f}s (last status {status!r})"
                )
            await asyncio.sleep(delay)
            delay = min(self._s.replicate_poll_seconds * 4, delay * 1.5)

            # A 429/5xx here is retried by the ladder rather than swallowed and
            # left to the deadline: swallowing it meant a rate-limited poll looked
            # like a slow prediction, and the flag said "did not finish" when the
            # truth was "we were being throttled".
            resp = await self._request(
                "GET",
                get_url,
                context="poll failed",
                image_url=image_url,
                timeout=30.0,
                ok=(200,),
            )
            prediction = resp.json()
            status = prediction.get("status")

        if status != TERMINAL_OK:
            # The model's own error, not an HTTP one: CUDA OOM, a rejected input,
            # an image it could not fetch. It is the most useful sentence the
            # review queue can carry for this photo, so it goes in the flag.
            err = _scrub(str(prediction.get("error") or ""), self._redactions(image_url))
            log.error("replicate: prediction %s: %s", status, err)
            raise ReplicateError(f"replicate prediction {status}" + (f" — {err}" if err else ""))
        return prediction

    async def mat(self, image_bytes: bytes, want_resolution: int) -> np.ndarray:
        raise NotImplementedError(
            "ReplicateMatter needs a fetchable URL, not bytes — use mat_url()"
        )

    async def mat_url(
        self, image_url: str, source_rgb: np.ndarray, want_resolution: int
    ) -> np.ndarray:
        """Mat an image Replicate can fetch, and return alpha at source size.

        Passing a URL rather than the bytes is the whole reason the bucket being
        public is convenient: the source is already on a CDN, so nothing has to
        be re-uploaded to get a prediction. `mat_data_uri` is the fallback for
        the day the bucket goes private.
        """
        prediction = await self._create_prediction(image_url, want_resolution)
        prediction = await self._poll(prediction, image_url)

        out_url = _first_url(prediction.get("output"))
        if not out_url:
            raise ReplicateError("replicate: prediction succeeded with no output url")

        resp = await self._request(
            "GET",
            out_url,
            context="output download failed",
            image_url=image_url,
            timeout=120.0,
            ok=(200,),
            auth=False,
        )

        rgb, alpha = decode_image_rgba(resp.content)
        if alpha is None:
            # A greyscale return is the MASK itself, already in [0,1] after /255.
            alpha = rgb[..., 0].astype(np.float32) / 255.0
        return refine_alpha(alpha, source_rgb)

    async def mat_data_uri(
        self, image_bytes: bytes, source_rgb: np.ndarray, want_resolution: int, mime: str
    ) -> np.ndarray:
        """Same, but inlines the bytes. For a private bucket, or a local file.

        Replicate accepts a data: URI in a uri-format field. It costs a base64
        round trip (~33% overhead) on every image, which is why it is the
        fallback and not the default.
        """
        import base64

        b64 = base64.b64encode(image_bytes).decode("ascii")
        return await self.mat_url(f"data:{mime};base64,{b64}", source_rgb, want_resolution)
