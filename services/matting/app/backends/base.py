"""The matting backend interface.

THE WHOLE POINT OF THIS FILE. Matting is the one part of the pipeline that is a
model, costs money, and will be replaced. Everything else — the compositor, the
scorer, the storage layout, the database columns, the HTTP contract, and every
line of the app that talks to this service — is written against `Matter`, which
is four lines. Swapping `replicate` for `local` (or for whatever is better in a
year) changes one env var and nothing else: same alpha master, same composite,
same review queue, same columns. `mask_model` records which one produced a given
cutout, so a backend change is also answerable after the fact ("re-run
everything the old one touched") rather than a silent fork in the catalog.
"""

from __future__ import annotations

import logging
from typing import Protocol, runtime_checkable

import cv2
import numpy as np

log = logging.getLogger("matting.backend")


@runtime_checkable
class Matter(Protocol):
    """Produce an alpha matte for one image."""

    @property
    def tag(self) -> str:
        """The value written to product_images.mask_model, e.g.
        'replicate:men1scus/birefnet@f74986db' or 'local:BiRefNet@1024'."""
        ...

    async def mat(self, image_bytes: bytes, want_resolution: int) -> np.ndarray:
        """Return float32 [H, W] alpha in [0, 1] at the SOURCE image's resolution.

        `want_resolution` is a request, not a promise: a backend that only has
        one resolution ignores it. Returning at source resolution (rather than
        the model's working resolution) is a contract, because the compositor
        indexes the alpha against the source pixels; `refine_alpha` below is how
        a backend keeps it.
        """
        ...


def guided_filter(
    guide_gray: np.ndarray, src: np.ndarray, radius: int = 8, eps: float = 1e-4
) -> np.ndarray:
    """He/Sun/Tang (2010) guided filter, greyscale guide, on the base cv2 API.

    WHY THIS IS HAND-WRITTEN rather than cv2.ximgproc.guidedFilter: ximgproc
    ships in opencv-CONTRIB, not in the opencv-python-headless wheel this
    service depends on. The alternatives were to depend on contrib (a second
    ~50 MB wheel that also provides `cv2`, so installing both leaves whichever
    landed last in charge — a genuinely confusing failure) or to fall back to
    bicubic when it is absent. The fallback is the worse option for a reason
    specific to this pipeline: it would make the SAME photo and the SAME preset
    produce DIFFERENT pixels on the founder's laptop and on the server, and the
    whole argument for a deterministic compositor is that a catalog's cutouts
    are consistent. Seven box filters are cheaper than that ambiguity.

    The maths, in full, so it can be checked against the paper:
        a = cov(I, p) / (var(I) + eps)
        b = mean(p) - a * mean(I)
        q = mean(a) * I + mean(b)
    """
    r = max(1, int(radius))
    k = (r * 2 + 1, r * 2 + 1)
    guide = guide_gray.astype(np.float32)
    p = src.astype(np.float32)

    def box(x: np.ndarray) -> np.ndarray:
        return cv2.boxFilter(x, ddepth=-1, ksize=k, normalize=True, borderType=cv2.BORDER_REFLECT)

    mean_i = box(guide)
    mean_p = box(p)
    var_i = box(guide * guide) - mean_i * mean_i
    cov_ip = box(guide * p) - mean_i * mean_p

    a = cov_ip / (var_i + eps)
    b = mean_p - a * mean_i
    return box(a) * guide + box(b)


MIN_REFINE_RADIUS = 8
MAX_REFINE_RADIUS = 32


def refine_radius(alpha_shape: tuple[int, int], source_shape: tuple[int, int]) -> int:
    """Pick a guided-filter radius from the upsample factor.

    A FIXED RADIUS IS A BUG THAT ONLY SHOWS AT HIGH RESOLUTION, which is why
    this is a function. Bicubic upsampling by k spreads a hard edge over roughly
    k target pixels, and the filter can only pull an edge back inside its own
    window — so a radius that sharpens a 4x upsample does nothing at all at 8x.
    Measured on a step edge (64 -> 512, k=8): bicubic leaves a 6-pixel
    transition, radius 8 leaves it at 6, radius 16 collapses it to 0.

    2k with a floor of 8 covers the real range: BiRefNet at 1024 against a 12 MP
    phone photo is k ~= 4, against a 4096-px source k = 4, and a small source is
    clamped up rather than given a uselessly tight window. The ceiling is there
    because the window is also the neighbourhood the local linear model assumes
    is flat, and a very large one starts smoothing across real texture — and
    because box filtering is O(1) in the radius, so nothing else stops it.
    """
    scale = max(
        source_shape[0] / max(1, alpha_shape[0]), source_shape[1] / max(1, alpha_shape[1])
    )
    return int(min(MAX_REFINE_RADIUS, max(MIN_REFINE_RADIUS, round(2 * scale))))


def refine_alpha(
    alpha: np.ndarray,
    source_rgb: np.ndarray,
    *,
    radius: int | None = None,
    eps: float = 1e-4,
) -> np.ndarray:
    """Upsample a low-resolution alpha to the source, guided by the source.

    BiRefNet works at 1024²; a phone photo is 3024×4032. A plain bicubic
    upsample of the mask gives a 3-pixel-wide mushy edge that reads as a halo
    once the garment sits on a flat white canvas — the exact artefact that makes
    a cutout look like a cutout. The guided filter instead snaps the transition
    back onto the real luminance edge in the full-resolution photo, which is
    where the garment actually ends.

    The guide is LUMINANCE, not colour. The colour-guided variant needs a 3×3
    covariance inverse per pixel and buys most of its advantage on coloured
    fringes (chroma keying); a garment edge against a studio backdrop is a
    luminance step, and the grey version is ~4× cheaper on a 12 MP photo.

    `eps` is in the units of the guide, so the guide is normalised to [0, 1]
    first — otherwise 1e-4 against 0-255 values is effectively zero and the
    filter degenerates into a no-op that looks like it ran.

    The radius defaults to `refine_radius(...)`, i.e. it SCALES WITH THE
    UPSAMPLE FACTOR. See that function for why a fixed radius silently stops
    working as the source resolution goes up.
    """
    h, w = source_rgb.shape[:2]
    a = np.clip(alpha.astype(np.float32), 0.0, 1.0)

    if a.shape[:2] == (h, w):
        return a

    r = radius if radius is not None else refine_radius(a.shape[:2], (h, w))
    upsampled = np.clip(cv2.resize(a, (w, h), interpolation=cv2.INTER_CUBIC), 0.0, 1.0)
    guide = cv2.cvtColor(source_rgb, cv2.COLOR_RGB2GRAY).astype(np.float32) / 255.0
    refined = guided_filter(guide, upsampled, radius=r, eps=eps)
    return np.clip(refined.astype(np.float32), 0.0, 1.0)


class BackendUnavailable(RuntimeError):
    """The configured backend cannot run (missing extra, missing token)."""
