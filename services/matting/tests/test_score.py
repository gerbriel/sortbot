"""The five heuristics.

Each rule gets a case that MUST fire and a clean case that MUST NOT. The second
half is the half that matters: a scorer that flags everything sends every photo
to a human, which is the feature not existing.
"""

from __future__ import annotations

import numpy as np
import pytest

from app.score import ALL_FLAGS, score_mask
from tests.conftest import flat_rgb, solid_alpha


def clean_alpha(h: int = 400, w: int = 400) -> np.ndarray:
    """A plausible garment: one connected blob, ~25% of the frame, hard edges,
    not touching any border."""
    a = solid_alpha(h, w, (120, 80, 280, 320))
    return a


def clean_rgb(h: int = 400, w: int = 400) -> np.ndarray:
    """A dark garment on a light backdrop — high edge contrast."""
    img = flat_rgb(h, w, (240, 240, 240))
    img[80:320, 120:280] = (20, 20, 30)
    return img


def test_a_clean_cutout_raises_no_flags_and_scores_one(settings):
    r = score_mask(clean_alpha(), clean_rgb(), settings)
    assert r.flags == []
    assert r.score == 1.0
    assert not r.needs_review(settings.advisory_flags)


# ── coverage ────────────────────────────────────────────────────────────────


def test_coverage_fires_when_the_subject_is_tiny(settings):
    """It found a button or a care label instead of the garment."""
    a = solid_alpha(400, 400, (190, 190, 210, 210))  # 0.25% of the frame
    r = score_mask(a, clean_rgb(), settings)
    assert "coverage" in r.flags


def test_coverage_fires_when_the_mask_failed_open(settings):
    """The 'cutout' is the whole photo — the most dangerous failure, because the
    composite looks like a photo rather than like a bug."""
    a = np.ones((400, 400), dtype=np.float32)
    r = score_mask(a, clean_rgb(), settings)
    assert "coverage" in r.flags


def test_coverage_uses_mean_alpha_so_a_ghost_mask_trips_it(settings):
    """A uniformly half-transparent mask covers 'half' of what it claims."""
    a = solid_alpha(400, 400, (60, 40, 340, 360), value=0.2)
    r = score_mask(a, clean_rgb(), settings)
    assert "coverage" in r.flags


# ── edge ────────────────────────────────────────────────────────────────────


def test_edge_fires_when_the_mask_runs_off_the_bottom(settings):
    """It grabbed the floor."""
    a = solid_alpha(400, 400, (100, 80, 300, 400))
    r = score_mask(a, clean_rgb(), settings)
    assert "edge" in r.flags


def test_edge_fires_on_a_side(settings):
    a = solid_alpha(400, 400, (0, 80, 300, 320))
    r = score_mask(a, clean_rgb(), settings)
    assert "edge" in r.flags


def test_edge_fires_on_the_top_for_a_centre_anchored_photo(settings):
    a = solid_alpha(400, 400, (100, 0, 300, 320))
    r = score_mask(a, clean_rgb(), settings, anchor="center")
    assert "edge" in r.flags


def test_the_hanger_exemption_top_anchor_tolerates_the_top_edge(settings):
    """THE ONE EXEMPTION. A jacket on a hanger has its hook at the very top of
    the frame; with anchor='top' that is the expected framing, not a failure."""
    a = solid_alpha(400, 400, (100, 0, 300, 320))
    centred = score_mask(a, clean_rgb(), settings, anchor="center")
    hanging = score_mask(a, clean_rgb(), settings, anchor="top")
    assert "edge" in centred.flags
    assert "edge" not in hanging.flags


def test_the_hanger_exemption_does_not_excuse_the_other_three_edges(settings):
    """It exempts the TOP, not 'edges'."""
    a = solid_alpha(400, 400, (100, 0, 400, 320))  # top AND right
    r = score_mask(a, clean_rgb(), settings, anchor="top")
    assert "edge" in r.flags


def test_a_few_stray_border_pixels_do_not_fire_edge(settings):
    """Under the 1.5% threshold — a thread, not a wall."""
    a = clean_alpha()
    a[399, 198:202] = 1.0  # 4 of 1600 border pixels = 0.25%
    r = score_mask(a, clean_rgb(), settings)
    assert "edge" not in r.flags


# ── fragments ───────────────────────────────────────────────────────────────


def test_fragments_fires_when_the_mask_grabbed_several_objects(settings):
    """A garment is one connected thing. Five blobs means the hanger, a shadow
    and a bit of rug came along as separate objects."""
    a = np.zeros((400, 400), dtype=np.float32)
    for i in range(5):
        x = 40 + i * 70
        a[100:260, x : x + 50] = 1.0
    r = score_mask(a, clean_rgb(), settings)
    assert "fragments" in r.flags


def test_a_garment_with_a_couple_of_parts_does_not_fire(settings):
    """A two-piece set, or a sleeve that reads as detached, is under the limit
    of 3 — the threshold is not 'exactly one blob' on purpose."""
    a = np.zeros((400, 400), dtype=np.float32)
    a[80:320, 100:200] = 1.0
    a[80:320, 220:300] = 1.0
    r = score_mask(a, clean_rgb(), settings)
    assert "fragments" not in r.flags


def test_speckle_noise_is_not_fragments(settings):
    """The 256-px downscale IS the noise filter — a few dozen stray anti-aliased
    pixels must not read as objects."""
    a = clean_alpha()
    rng = np.random.default_rng(7)
    ys = rng.integers(0, 400, 40)
    xs = rng.integers(0, 400, 40)
    for y, x in zip(ys, xs, strict=False):
        a[y, x] = 1.0
    r = score_mask(a, clean_rgb(), settings)
    assert "fragments" not in r.flags


# ── soft ────────────────────────────────────────────────────────────────────


def test_soft_fires_when_the_model_is_unsure_everywhere(settings):
    """A real matte is mostly 0 or 1 with a thin soft rim. A quarter of it in
    the half-transparent band composites as a ghost."""
    a = solid_alpha(400, 400, (100, 80, 300, 320), value=0.5)
    r = score_mask(a, clean_rgb(), settings)
    assert "soft" in r.flags


def test_a_thin_soft_rim_does_not_fire_soft(settings):
    """Knit fuzz and hair belong in the 0.2-0.8 band; that is the point of a
    matte rather than a binary mask."""
    a = clean_alpha()
    a[78:80, 120:280] = 0.5
    a[320:322, 120:280] = 0.5
    r = score_mask(a, clean_rgb(), settings)
    assert "soft" not in r.flags


# ── contrast ────────────────────────────────────────────────────────────────


def test_contrast_fires_for_a_white_tee_on_a_white_wall(settings):
    """The soft rim and the photo's own backdrop are the same colour."""
    a = clean_alpha()
    a[78:82, 120:280] = 0.5  # a soft rim to measure
    rgb = flat_rgb(400, 400, (250, 250, 250))
    rgb[80:320, 120:280] = (248, 248, 248)  # a white garment on white
    r = score_mask(a, rgb, settings)
    assert "contrast" in r.flags


def test_contrast_does_not_fire_for_a_dark_garment_on_a_light_backdrop(settings):
    a = clean_alpha()
    a[78:82, 120:280] = 0.5
    r = score_mask(a, clean_rgb(), settings)
    assert "contrast" not in r.flags


def test_contrast_is_advisory_so_it_alone_does_not_send_a_photo_to_a_human(settings):
    """It describes a DIFFICULT SOURCE, not a wrong answer."""
    a = clean_alpha()
    a[78:82, 120:280] = 0.5
    rgb = flat_rgb(400, 400, (250, 250, 250))
    rgb[80:320, 120:280] = (248, 248, 248)
    r = score_mask(a, rgb, settings)
    assert r.flags == ["contrast"]
    assert not r.needs_review(settings.advisory_flags)
    assert r.score == 0.8  # still recorded and still lowers the sort key


def test_a_backdrop_is_the_median_of_four_corners_so_one_bad_corner_survives(settings):
    """A price tag in one corner must not redefine the backdrop."""
    a = clean_alpha()
    a[78:82, 120:280] = 0.5
    rgb = clean_rgb()
    rgb[:24, :24] = (5, 5, 5)  # one corner ruined
    r = score_mask(a, rgb, settings)
    assert "contrast" not in r.flags


# ── the score ───────────────────────────────────────────────────────────────


def test_score_is_one_minus_flags_over_five(settings):
    a = np.ones((400, 400), dtype=np.float32)  # coverage + edge
    r = score_mask(a, clean_rgb(), settings)
    assert set(r.flags) >= {"coverage", "edge"}
    assert r.score == pytest.approx(1.0 - len(r.flags) / 5, abs=1e-9)


def test_score_is_rounded_to_three_decimals_for_numeric_4_3(settings):
    r = score_mask(clean_alpha(), clean_rgb(), settings)
    assert round(r.score, 3) == r.score


def test_every_documented_flag_is_reachable(settings):
    """If a flag can never fire, it is documentation that lies."""
    seen: set[str] = set()
    a = np.ones((400, 400), dtype=np.float32)
    seen |= set(score_mask(a, clean_rgb(), settings).flags)

    frag = np.zeros((400, 400), dtype=np.float32)
    for i in range(5):
        frag[100:260, 40 + i * 70 : 90 + i * 70] = 1.0
    seen |= set(score_mask(frag, clean_rgb(), settings).flags)

    soft = solid_alpha(400, 400, (100, 80, 300, 320), value=0.5)
    seen |= set(score_mask(soft, clean_rgb(), settings).flags)

    rim = clean_alpha()
    rim[78:82, 120:280] = 0.5
    white = flat_rgb(400, 400, (250, 250, 250))
    white[80:320, 120:280] = (248, 248, 248)
    seen |= set(score_mask(rim, white, settings).flags)

    assert seen == set(ALL_FLAGS)


def test_thresholds_are_configurable(settings):
    """Every number is an env var because the right one depends on how a
    particular shop photographs."""
    import dataclasses

    a = clean_alpha()  # ~24% coverage, clean by default
    strict = dataclasses.replace(settings, coverage_min=0.30)
    assert "coverage" not in score_mask(a, clean_rgb(), settings).flags
    assert "coverage" in score_mask(a, clean_rgb(), strict).flags


def test_the_scorer_never_raises(settings):
    """A scoring bug must not turn a good cutout into a 'failed' row."""
    for bad in (
        np.zeros((10, 10), dtype=np.float32),
        np.full((10, 10), np.nan, dtype=np.float32),
        np.ones((1, 1), dtype=np.float32),
    ):
        r = score_mask(bad, flat_rgb(10, 10), settings)
        assert isinstance(r.score, float)
