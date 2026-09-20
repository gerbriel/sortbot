"""Compositing geometry, on synthetic alphas.

The arithmetic is stated in compose.py's docstring and asserted here against
numbers worked out by hand, not against whatever the code happens to produce.
Every expected value below is derived in a comment, so a failure tells you which
step of the derivation moved.
"""

from __future__ import annotations

import numpy as np
import pytest
from PIL import Image

from app.compose import (
    ComposeError,
    alpha_bbox,
    compose,
    decode_image_rgb,
    decode_image_rgba,
    encode_cutout_webp,
    encode_jpeg,
    plan_placement,
)
from app.preset import BackgroundPreset
from tests.conftest import flat_rgb, png_bytes, solid_alpha


def test_bbox_is_tight_and_exclusive():
    a = solid_alpha(100, 200, (30, 10, 80, 60))
    assert alpha_bbox(a) == (30, 10, 80, 60)


def test_bbox_uses_the_soft_threshold_not_a_half_alpha_cut():
    """A matte's soft rim lives below 0.5. Clipping it off would throw away the
    halo-free edge the matter was paid for."""
    a = solid_alpha(100, 100, (40, 40, 60, 60), value=1.0)
    a[38:40, 40:60] = 0.05  # a faint rim above SUBJECT_ALPHA (0.02)
    x0, y0, x1, y1 = alpha_bbox(a)
    assert y0 == 38


def test_bbox_ignores_noise_below_the_threshold():
    a = solid_alpha(100, 100, (40, 40, 60, 60))
    a[0, 0] = 0.01  # below SUBJECT_ALPHA
    assert alpha_bbox(a) == (40, 40, 60, 60)


def test_empty_alpha_is_an_error_not_an_empty_image():
    with pytest.raises(ComposeError):
        alpha_bbox(np.zeros((50, 50), dtype=np.float32))


# ── The worked example from the brief ───────────────────────────────────────


def test_1000x400_subject_on_a_2048_canvas_at_default_padding():
    """inner  = 2048 * (1 - 0.2)        = 1638.4
       scale  = min(1638.4/1000, 1638.4/400) = 1.6384   (width is the binding side)
       nw, nh = round(1638.4), round(655.36)  = 1638, 655
       x      = (2048 - 1638) // 2            = 205
       y      = (2048 -  655) // 2            = 696     (anchor center)
    """
    alpha = solid_alpha(600, 1400, (200, 100, 1200, 500))  # a 1000x400 subject
    place = plan_placement(alpha, BackgroundPreset())

    assert place.bbox == (200, 100, 1200, 500)
    assert (place.width, place.height) == (1638, 655)
    assert (place.x, place.y) == (205, 696)
    assert place.scale == pytest.approx(1.6384)


def test_the_subject_fits_inside_the_padding_on_every_side():
    """The property the arithmetic exists to guarantee."""
    preset = BackgroundPreset()
    margin = preset.padding * preset.canvas  # 204.8
    alpha = solid_alpha(600, 1400, (200, 100, 1200, 500))
    p = plan_placement(alpha, preset)

    assert p.x >= margin - 1
    assert p.y >= margin - 1
    assert p.x + p.width <= preset.canvas - margin + 1
    assert p.y + p.height <= preset.canvas - margin + 1


def test_top_anchor_pins_the_subject_at_the_padding_line():
    """y = round(0.1 * 2048) = 205, and x is still centred."""
    alpha = solid_alpha(600, 1400, (200, 100, 1200, 500))
    p = plan_placement(alpha, BackgroundPreset.parse({"anchor": "top"}))
    assert p.y == 205
    assert p.x == 205  # unchanged from centre — only the vertical anchor moves


def test_top_anchor_lines_up_garments_of_different_heights():
    """The reason `anchor: top` exists: a rail of hanging listings should not
    jump around vertically."""
    preset = BackgroundPreset.parse({"anchor": "top"})
    tall = plan_placement(solid_alpha(900, 900, (300, 100, 600, 800)), preset)
    short = plan_placement(solid_alpha(900, 900, (300, 100, 600, 400)), preset)
    assert tall.y == short.y == 205


def test_centre_anchor_does_not_line_them_up():
    """The contrast to the test above. A HEIGHT-bound subject fills the inner
    box vertically and sits at the padding line; a WIDTH-bound one is shorter
    than the inner box, so centring drops it. (Two height-bound subjects would
    both land at 205 whatever the anchor — which is why this pair is a tall
    garment against a wide one, not a tall one against a short one.)"""
    preset = BackgroundPreset()
    tall = plan_placement(solid_alpha(900, 900, (300, 50, 600, 850)), preset)  # 300x800
    wide = plan_placement(solid_alpha(900, 900, (50, 300, 850, 600)), preset)  # 800x300
    assert tall.height > wide.height
    assert tall.y != wide.y
    assert tall.y == 205  # height-bound: the padding line
    assert wide.y > 205  # width-bound: centred lower


@pytest.mark.parametrize(
    "padding,canvas,expected_inner",
    [(0.10, 2048, 1638.4), (0.08, 1536, 1290.24), (0.0, 1024, 1024.0), (0.4, 2048, 409.6)],
)
def test_padding_maths_across_presets(padding, canvas, expected_inner):
    """A square subject scales to exactly the inner box on both axes."""
    preset = BackgroundPreset.parse({"padding": padding, "canvas": canvas})
    alpha = solid_alpha(400, 400, (100, 100, 300, 300))  # a 200x200 square
    p = plan_placement(alpha, preset)
    assert p.width == p.height == max(1, round(200 * (expected_inner / 200)))
    assert p.width == pytest.approx(expected_inner, abs=1)


def test_aspect_ratio_is_preserved_never_cropped():
    alpha = solid_alpha(1000, 1000, (100, 100, 400, 900))  # 300 x 800, 3:8
    p = plan_placement(alpha, BackgroundPreset())
    assert p.width / p.height == pytest.approx(300 / 800, rel=1e-2)


def test_a_taller_than_wide_subject_is_bound_by_height():
    alpha = solid_alpha(1000, 1000, (400, 50, 600, 950))  # 200 x 900
    preset = BackgroundPreset()
    p = plan_placement(alpha, preset)
    inner = preset.canvas * (1 - 2 * preset.padding)
    assert p.height == pytest.approx(inner, abs=1)
    assert p.width < p.height


# ── Pixels ──────────────────────────────────────────────────────────────────


def test_output_is_square_rgb_at_the_canvas_size():
    preset = BackgroundPreset.parse({"canvas": 512})
    img, _ = compose(flat_rgb(200, 200, (10, 20, 30)), solid_alpha(200, 200, (50, 50, 150, 150)), preset)
    assert img.size == (512, 512)
    assert img.mode == "RGB"


def test_the_backdrop_is_exactly_the_preset_colour():
    preset = BackgroundPreset.parse({"canvas": 512, "color": "#F4F4F4"})
    img, _ = compose(flat_rgb(200, 200, (10, 20, 30)), solid_alpha(200, 200, (50, 50, 150, 150)), preset)
    px = np.asarray(img)
    assert tuple(px[0, 0]) == (244, 244, 244)
    assert tuple(px[-1, -1]) == (244, 244, 244)


def test_the_subject_pixels_land_where_the_placement_says():
    preset = BackgroundPreset.parse({"canvas": 512, "color": "#FFFFFF"})
    src = flat_rgb(200, 200, (10, 20, 30))
    alpha = solid_alpha(200, 200, (50, 50, 150, 150))
    img, place = compose(src, alpha, preset)
    px = np.asarray(img)

    cy = place.y + place.height // 2
    cx = place.x + place.width // 2
    assert tuple(px[cy, cx]) == (10, 20, 30)
    # Just outside the placed box is still backdrop.
    assert tuple(px[place.y - 3, cx]) == (255, 255, 255)


def test_a_half_transparent_subject_blends_with_the_backdrop():
    """Premultiplied compositing, checked against arithmetic: 0.5*0 + 0.5*255."""
    preset = BackgroundPreset.parse({"canvas": 256, "color": "#FFFFFF"})
    src = flat_rgb(100, 100, (0, 0, 0))
    alpha = solid_alpha(100, 100, (20, 20, 80, 80), value=0.5)
    img, place = compose(src, alpha, preset)
    px = np.asarray(img)
    mid = px[place.y + place.height // 2, place.x + place.width // 2]
    assert all(abs(int(v) - 128) <= 2 for v in mid)


def test_shadow_is_off_by_default():
    """The composite must be identical to a no-shadow render unless asked."""
    src = flat_rgb(200, 200, (10, 20, 30))
    alpha = solid_alpha(200, 200, (50, 50, 150, 150))
    plain, _ = compose(src, alpha, BackgroundPreset.parse({"canvas": 384}))
    explicit, _ = compose(src, alpha, BackgroundPreset.parse({"canvas": 384, "shadow": False}))
    assert np.array_equal(np.asarray(plain), np.asarray(explicit))


def test_shadow_darkens_beneath_the_subject_and_leaves_the_top_alone():
    preset_on = BackgroundPreset.parse({"canvas": 384, "shadow": True})
    preset_off = BackgroundPreset.parse({"canvas": 384, "shadow": False})
    src = flat_rgb(200, 200, (10, 20, 30))
    alpha = solid_alpha(200, 200, (50, 50, 150, 150))

    on, place = compose(src, alpha, preset_on)
    off, _ = compose(src, alpha, preset_off)
    on_px, off_px = np.asarray(on).astype(int), np.asarray(off).astype(int)

    below = place.y + place.height + 4
    assert on_px[below, place.x + place.width // 2].mean() < off_px[below, place.x + place.width // 2].mean()
    # A corner far from the subject is untouched.
    assert np.array_equal(on_px[0, 0], off_px[0, 0])


def test_compose_is_deterministic():
    """The whole argument for arithmetic over a generative pass."""
    src = flat_rgb(300, 220, (40, 90, 140))
    alpha = solid_alpha(300, 220, (20, 30, 200, 260))
    preset = BackgroundPreset.parse({"canvas": 512, "shadow": True})
    a, _ = compose(src, alpha, preset)
    b, _ = compose(src, alpha, preset)
    assert np.array_equal(np.asarray(a), np.asarray(b))


def test_mismatched_alpha_and_source_are_refused():
    with pytest.raises(ComposeError):
        compose(flat_rgb(100, 100), solid_alpha(50, 50, (10, 10, 40, 40)), BackgroundPreset())


def test_a_greyscale_source_is_refused_rather_than_guessed_at():
    with pytest.raises(ComposeError):
        compose(np.zeros((50, 50), dtype=np.uint8), solid_alpha(50, 50, (5, 5, 45, 45)), BackgroundPreset())


# ── Encoding ────────────────────────────────────────────────────────────────


def test_the_cutout_master_keeps_its_alpha_losslessly():
    """The expensive artifact must survive the round trip exactly — otherwise
    regenerating a background from it is not free, it is lossy."""
    src = flat_rgb(64, 64, (200, 30, 30))
    alpha = np.zeros((64, 64), dtype=np.float32)
    alpha[16:48, 16:48] = 1.0
    alpha[10:16, 16:48] = 0.5  # a soft rim, the part that matters

    data = encode_cutout_webp(src, alpha)
    rgb, back = decode_image_rgba(data)
    assert back is not None
    assert back.shape == alpha.shape
    assert np.abs(back - alpha).max() <= 1 / 255 + 1e-6


def test_jpeg_encodes_at_the_preset_quality():
    img, _ = compose(flat_rgb(80, 80, (120, 60, 30)), solid_alpha(80, 80, (10, 10, 70, 70)), BackgroundPreset.parse({"canvas": 256}))
    small = encode_jpeg(img, 60)
    large = encode_jpeg(img, 95)
    assert small[:2] == b"\xff\xd8"  # SOI
    assert len(small) < len(large)


def test_exif_orientation_is_applied_exactly_once():
    """Pillow does NOT rotate on open, so this service must — unlike the browser
    side, where the engine already did it and touching EXIF again would
    double-apply (AGENTS.md §18 #34)."""
    import io as _io

    # A 40x20 landscape image tagged orientation 6 (rotate 90 CW on display).
    arr = np.zeros((20, 40, 3), dtype=np.uint8)
    arr[:, :20] = (255, 0, 0)
    buf = _io.BytesIO()
    im = Image.fromarray(arr)
    exif = im.getexif()
    exif[274] = 6
    im.save(buf, format="JPEG", exif=exif)

    decoded = decode_image_rgb(buf.getvalue())
    assert decoded.shape[:2] == (40, 20)  # transposed, i.e. orientation applied


def test_decode_rgba_reports_no_alpha_for_an_opaque_source():
    rgb, alpha = decode_image_rgba(png_bytes(flat_rgb(20, 20, (1, 2, 3))))
    assert alpha is None
    assert rgb.shape == (20, 20, 3)
