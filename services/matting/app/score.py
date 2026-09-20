"""Mask scoring — five heuristics that decide whether a human needs to look.

WHY HEURISTICS AND NOT A CONFIDENCE NUMBER. BiRefNet emits an alpha, not a
calibrated confidence, and the one number it could produce (mean alpha
certainty) is high precisely on the failure that matters most: a mask that
confidently cuts out the mannequin's stand as if it were the garment. Each rule
below instead describes a SHAPE that a correct clothing cutout does not have.
They are cheap (milliseconds on a 256-px downscale), independent, and every one
of them is a sentence a human can check by looking at the photo.

The point is not to be right. It is to be WRONG IN ONE DIRECTION: a false
'review' costs one glance, a false 'auto' ships a jacket with half a sleeve
missing to a marketplace. Every threshold below is set to flag generously, and
every one is an env var (config.Settings) because the right numbers depend on
how a particular shop photographs.

FLAGS
  coverage   the subject is <12% or >90% of the frame. Under: it found a button
             or a label instead of the garment. Over: it found the whole photo,
             i.e. it failed open and the "cutout" is the original.
  edge       >1.5% of the left/right/bottom border is subject. A garment shot
             for resale is framed with air around it; touching a side or the
             bottom means the mask has run off into the floor or the wall.
             THE TOP EDGE IS EXEMPT WHEN anchor == "top", because that is the
             hanging-garment case and the hook legitimately leaves the frame.
  fragments  more than 3 connected blobs, each >0.5% of the subject. A garment
             is one connected thing. Several means it grabbed the hanger, a
             shadow, and a bit of the rug as separate objects. Counted on a
             256-px downscale so a few dozen stray anti-aliased pixels are not
             "fragments" — the downscale IS the noise filter.
  soft       >25% of subject pixels sit in the 0.2-0.8 alpha band. A real matte
             is mostly 0 or 1 with a thin soft rim; a quarter of it being
             half-transparent is a model that is unsure everywhere, and
             composites as a ghost.
  contrast   the soft rim and the photo's own backdrop are within 12 CIELAB of
             each other — a white tee on a white wall. ADVISORY BY DEFAULT: it
             describes a hard photograph, not a wrong answer, and BiRefNet
             handles most of them. It is recorded so that when a human does open
             a flagged photo they know why it was hard.

SCORE = 1 - (flags / 5), rounded to 3 decimals, stored in mask_score. It is a
sort key for the review queue ("show me the worst first"), NOT a gate — nothing
branches on it, which is deliberate: a single number that merges five unrelated
failure modes has no threshold that means anything.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import cv2
import numpy as np

from .compose import SUBJECT_ALPHA
from .config import Settings

ALL_FLAGS = ("coverage", "edge", "fragments", "soft", "contrast")
SCORE_DENOMINATOR = len(ALL_FLAGS)

# The downscale the fragment count is measured at. Small enough that isolated
# anti-aliasing noise merges away, big enough that a detached sleeve survives.
FRAGMENT_SCALE = 256
CORNER_PATCH = 24


@dataclass
class MaskScore:
    flags: list[str] = field(default_factory=list)
    score: float = 1.0
    # Kept for the log line and for tuning; never written to the database.
    detail: dict[str, float] = field(default_factory=dict)

    def needs_review(self, advisory: list[str]) -> bool:
        return any(f not in advisory for f in self.flags)


def _coverage(alpha: np.ndarray) -> float:
    """Mean alpha == the subject's area as a fraction of the frame.

    Mean rather than (alpha > 0.5).mean() so a uniformly half-transparent mask
    reads as half-covered instead of not covering at all — that failure should
    trip `coverage`, not slip past it.
    """
    return float(alpha.mean())


def _edge_fraction(alpha: np.ndarray, anchor: str) -> float:
    """Fraction of the considered border that is solidly subject."""
    h, w = alpha.shape[:2]
    borders = [alpha[:, 0], alpha[:, w - 1], alpha[h - 1, :]]  # left, right, bottom
    if anchor != "top":
        borders.append(alpha[0, :])
    band = np.concatenate(borders)
    if band.size == 0:
        return 0.0
    return float((band > 0.5).mean())


def _fragment_count(alpha: np.ndarray, min_area: float) -> tuple[int, int]:
    """(components above min_area, total components) on a FRAGMENT_SCALE downscale."""
    h, w = alpha.shape[:2]
    scale = FRAGMENT_SCALE / max(h, w)
    if scale < 1.0:
        small = cv2.resize(
            alpha, (max(1, int(w * scale)), max(1, int(h * scale))), interpolation=cv2.INTER_AREA
        )
    else:
        small = alpha
    binary = (small > 0.5).astype(np.uint8)
    subject_area = int(binary.sum())
    if subject_area == 0:
        return 0, 0
    n, _, stats, _ = cv2.connectedComponentsWithStats(binary, connectivity=8)
    big = 0
    for i in range(1, n):  # 0 is background
        if stats[i, cv2.CC_STAT_AREA] >= min_area * subject_area:
            big += 1
    return big, max(0, n - 1)


def _soft_band(alpha: np.ndarray) -> tuple[float, np.ndarray]:
    """(fraction of subject pixels in the 0.2-0.8 band, the band mask)."""
    subject = alpha > SUBJECT_ALPHA
    n = int(subject.sum())
    band = (alpha > 0.2) & (alpha < 0.8)
    if n == 0:
        return 0.0, band
    return float(band.sum()) / n, band


def _backdrop_lab(rgb: np.ndarray) -> np.ndarray:
    """The photo's own backdrop, as the median of four corner patches in CIELAB.

    Median of four and not mean of one: a corner can contain a price tag, a bit
    of floor, or the photographer's foot, and the median of four survives one
    bad corner where an average does not.
    """
    h, w = rgb.shape[:2]
    p = min(CORNER_PATCH, h, w)
    patches = np.concatenate(
        [
            rgb[:p, :p].reshape(-1, 3),
            rgb[:p, w - p :].reshape(-1, 3),
            rgb[h - p :, :p].reshape(-1, 3),
            rgb[h - p :, w - p :].reshape(-1, 3),
        ]
    )
    med = np.median(patches, axis=0).astype(np.uint8).reshape(1, 1, 3)
    return cv2.cvtColor(med, cv2.COLOR_RGB2LAB).astype(np.float32).reshape(3)


def _edge_contrast(rgb: np.ndarray, band: np.ndarray) -> float:
    """Mean CIELAB distance between the soft rim's colours and the backdrop."""
    if not band.any():
        return float("inf")  # no soft rim at all: nothing to confuse
    lab = cv2.cvtColor(rgb, cv2.COLOR_RGB2LAB).astype(np.float32)
    backdrop = _backdrop_lab(rgb)
    px = lab[band]
    # OpenCV's 8-bit LAB is scaled (L 0-255, a/b offset by 128); the distance is
    # therefore not a true dE76, but it is monotonic in it and the threshold is
    # calibrated against this scale, not against a textbook.
    return float(np.linalg.norm(px - backdrop, axis=1).mean())


def score_mask(
    alpha: np.ndarray,
    source_rgb: np.ndarray,
    settings: Settings,
    anchor: str = "center",
) -> MaskScore:
    """Run all five heuristics. Never raises — a scorer that throws would turn a
    perfectly good cutout into a 'failed' row."""
    result = MaskScore()
    try:
        cov = _coverage(alpha)
        result.detail["coverage"] = round(cov, 4)
        if cov < settings.coverage_min or cov > settings.coverage_max:
            result.flags.append("coverage")

        edge = _edge_fraction(alpha, anchor)
        result.detail["edge"] = round(edge, 4)
        if edge > settings.edge_fraction:
            result.flags.append("edge")

        big, total = _fragment_count(alpha, settings.fragment_min_area)
        result.detail["fragments"] = float(big)
        result.detail["fragments_total"] = float(total)
        if big > settings.fragments_max:
            result.flags.append("fragments")

        soft, band = _soft_band(alpha)
        result.detail["soft"] = round(soft, 4)
        if soft > settings.soft_band_max:
            result.flags.append("soft")

        contrast = _edge_contrast(source_rgb, band)
        result.detail["contrast"] = round(contrast, 2) if np.isfinite(contrast) else -1.0
        if contrast < settings.contrast_min_lab:
            result.flags.append("contrast")
    except Exception as exc:  # pragma: no cover - defensive
        # A scoring failure must not become a matting failure. Say so out loud
        # and send it to a human, which is the conservative direction.
        result.flags.append("coverage")
        result.detail["scorer_error"] = -1.0
        result.detail["scorer_error_msg"] = 0.0
        del exc

    result.score = round(1.0 - (len(result.flags) / SCORE_DENOMINATOR), 3)
    return result
