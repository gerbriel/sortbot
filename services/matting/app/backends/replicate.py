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
"""

from __future__ import annotations

import asyncio
import logging
import time

import httpx
import numpy as np

from ..compose import decode_image_rgba
from ..config import Settings
from .base import BackendUnavailable, refine_alpha

log = logging.getLogger("matting.replicate")

API_ROOT = "https://api.replicate.com/v1"
TERMINAL_OK = "succeeded"
TERMINAL_BAD = ("failed", "canceled")


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

        resp = await self._client.post(url, headers=self._headers(), json=body, timeout=60.0)
        if resp.status_code not in (200, 201):
            # The body can echo the input URL, which for a private bucket would
            # be a signed link. Truncate hard and log server-side only.
            detail = resp.text[:300] if resp.text else ""
            log.error("replicate: create returned %s %s", resp.status_code, detail)
            raise RuntimeError(f"replicate create failed ({resp.status_code})")
        return resp.json()

    async def _poll(self, prediction: dict) -> dict:
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
                raise RuntimeError("replicate: prediction has no id and no poll url")
            get_url = f"{API_ROOT}/predictions/{pid}"

        deadline = time.monotonic() + self._s.replicate_timeout_seconds
        delay = self._s.replicate_poll_seconds
        attempt = 0
        while status not in (TERMINAL_OK, *TERMINAL_BAD):
            if time.monotonic() > deadline:
                raise TimeoutError(
                    f"replicate: prediction did not finish within "
                    f"{self._s.replicate_timeout_seconds:.0f}s (last status {status!r})"
                )
            await asyncio.sleep(delay)
            attempt += 1
            delay = min(self._s.replicate_poll_seconds * 4, delay * 1.5)

            resp = await self._client.get(get_url, headers=self._headers(), timeout=30.0)
            if resp.status_code != 200:
                log.warning("replicate: poll returned %s (attempt %d)", resp.status_code, attempt)
                # A transient 5xx must not fail the image; the deadline is the
                # real stop condition.
                continue
            prediction = resp.json()
            status = prediction.get("status")

        if status != TERMINAL_OK:
            err = str(prediction.get("error") or "")[:300]
            log.error("replicate: prediction %s: %s", status, err)
            raise RuntimeError(f"replicate prediction {status}")
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
        prediction = await self._poll(prediction)

        out_url = _first_url(prediction.get("output"))
        if not out_url:
            raise RuntimeError("replicate: prediction succeeded with no output url")

        resp = await self._client.get(out_url, timeout=120.0)
        if resp.status_code != 200:
            raise RuntimeError(f"replicate: output download failed ({resp.status_code})")

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
