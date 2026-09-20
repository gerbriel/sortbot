"""Shared fixtures. NOTHING HERE TOUCHES THE NETWORK.

Every test in this suite runs offline: the Replicate backend is driven through
an httpx MockTransport, and the auth boundary through the same. That is not
only for CI speed — a test that can reach Replicate is a test that can spend
money, and a test that can reach Supabase is a test that can write to the real
product_images table.
"""

from __future__ import annotations

import io

import numpy as np
import pytest
from PIL import Image

from app.config import Settings


@pytest.fixture
def settings() -> Settings:
    """A fully-populated Settings that never calls validate()."""
    return Settings(
        supabase_url="https://project.supabase.co",
        service_role_key="service-role-not-real",
        anon_key="anon-not-real",
        bucket="product-images",
        backend="replicate",
        replicate_token="r8-not-real",
        replicate_model="men1scus/birefnet",
        replicate_version="f74986db0355b58403ed20963af156525e2891ea3c2d499bfbfb2a28cd87c5d7",
        replicate_poll_seconds=0.001,
        replicate_timeout_seconds=2.0,
        # The retry ladder is 2, 4, 8, 16, 32 s in production. A suite that
        # actually waited that out would take minutes, so the BASE is tiny here
        # and the tests that assert the real ladder raise it themselves and record
        # the delays through a fake `_backoff_sleep` (test_backend_replicate.py).
        replicate_retry_base_seconds=0.001,
        env="dev",
    )


def gradient_rgb(h: int, w: int) -> np.ndarray:
    """A backdrop with a distinguishable value at every position.

    A flat colour would make "was the backdrop cropped from the middle?" and "did
    the backdrop reach the canvas at all?" unanswerable — every pixel would match
    every other one.
    """
    ys = np.linspace(0, 255, h, dtype=np.float32)[:, None]
    xs = np.linspace(0, 255, w, dtype=np.float32)[None, :]
    img = np.empty((h, w, 3), dtype=np.uint8)
    img[..., 0] = xs.astype(np.uint8)
    img[..., 1] = ys.astype(np.uint8)
    img[..., 2] = 128
    return img


def solid_alpha(h: int, w: int, box: tuple[int, int, int, int], value: float = 1.0) -> np.ndarray:
    """A float32 alpha that is `value` inside (x0, y0, x1, y1) and 0 outside."""
    a = np.zeros((h, w), dtype=np.float32)
    x0, y0, x1, y1 = box
    a[y0:y1, x0:x1] = value
    return a


def flat_rgb(h: int, w: int, color: tuple[int, int, int] = (200, 200, 200)) -> np.ndarray:
    img = np.empty((h, w, 3), dtype=np.uint8)
    img[:, :] = color
    return img


def png_bytes(rgb: np.ndarray, alpha: np.ndarray | None = None) -> bytes:
    buf = io.BytesIO()
    if alpha is None:
        Image.fromarray(rgb, mode="RGB").save(buf, format="PNG")
    else:
        a8 = np.clip(np.rint(alpha * 255), 0, 255).astype(np.uint8)
        Image.fromarray(np.dstack([rgb, a8]), mode="RGBA").save(buf, format="PNG")
    return buf.getvalue()


def gray_png_bytes(alpha: np.ndarray) -> bytes:
    buf = io.BytesIO()
    a8 = np.clip(np.rint(alpha * 255), 0, 255).astype(np.uint8)
    Image.fromarray(a8, mode="L").save(buf, format="PNG")
    return buf.getvalue()
