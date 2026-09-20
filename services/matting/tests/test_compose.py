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
    cover_crop,
    decode_image_rgb,
    decode_image_rgba,
    encode_cutout_webp,
    encode_jpeg,
    plan_placement,
)
from app.preset import BackgroundPreset
from tests.conftest import flat_rgb, gradient_rgb, png_bytes, solid_alpha


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


# ── Photo backdrops ─────────────────────────────────────────────────────────
#
# The property that matters is that a backdrop changes the FILL and nothing else.
# A seller who switches from white to linen is changing the look of a catalogue,
# not re-cropping it, and a subject that shifted by a few pixels at the same time
# would make the two halves of a grid look mismatched in a way nobody can name.


def test_the_subject_lands_in_exactly_the_same_place_on_a_backdrop():
    """THE BACKDROP INVARIANT, asserted against the flat path rather than against
    a number this file made up."""
    src = flat_rgb(300, 220, (40, 90, 140))
    alpha = solid_alpha(300, 220, (20, 30, 200, 260))
    flat = BackgroundPreset.parse({"canvas": 512})
    photo = BackgroundPreset.parse({"canvas": 512, "backdrop": "u/backdrops/linen.jpg"})

    _, flat_place = compose(src, alpha, flat)
    _, photo_place = compose(src, alpha, photo, cover_crop(gradient_rgb(700, 400), 512))

    assert photo_place == flat_place


def test_the_backdrop_pixels_are_the_canvas_and_the_colour_fills_nothing():
    src = flat_rgb(100, 100, (10, 20, 30))
    alpha = solid_alpha(100, 100, (30, 30, 70, 70))
    # A colour that could not be confused with the gradient, so "the fill lost"
    # is provable rather than plausible.
    preset = BackgroundPreset.parse(
        {"canvas": 256, "color": "#FF00FF", "backdrop": "u/backdrops/linen.jpg"}
    )
    backdrop = cover_crop(gradient_rgb(256, 256), 256)

    img, place = compose(src, alpha, preset, backdrop)
    px = np.asarray(img)

    assert np.array_equal(px[0, 0], backdrop[0, 0])
    assert np.array_equal(px[-1, -1], backdrop[-1, -1])
    assert not np.array_equal(px[0, 0], np.array([255, 0, 255], dtype=np.uint8))
    # …and the subject is still the subject.
    assert tuple(px[place.y + place.height // 2, place.x + place.width // 2]) == (10, 20, 30)


def test_a_preset_naming_a_backdrop_with_none_supplied_is_an_error_not_a_flat_fill():
    """The silent fallback this refuses is the one that puts half a catalogue on
    linen and half on white, discovered by a buyer rather than by a test."""
    preset = BackgroundPreset.parse({"canvas": 256, "backdrop": "u/backdrops/linen.jpg"})
    with pytest.raises(ComposeError):
        compose(flat_rgb(100, 100), solid_alpha(100, 100, (30, 30, 70, 70)), preset)


def test_a_backdrop_of_the_wrong_size_is_refused():
    """Cover-cropping is load-bearing, so an uncropped backdrop must not be
    silently stretched, tiled or ignored."""
    preset = BackgroundPreset.parse({"canvas": 256, "backdrop": "u/backdrops/linen.jpg"})
    with pytest.raises(ComposeError):
        compose(
            flat_rgb(100, 100),
            solid_alpha(100, 100, (30, 30, 70, 70)),
            preset,
            gradient_rgb(300, 200),
        )


def test_the_shadow_darkens_the_backdrop_rather_than_painting_grey_on_it():
    """`_draw_shadow` multiplies, which is why it works on any backdrop. Painting
    a grey smudge would assume white and look like a sticker on linen."""
    src = flat_rgb(200, 200, (10, 20, 30))
    alpha = solid_alpha(200, 200, (50, 50, 150, 150))
    backdrop = cover_crop(gradient_rgb(384, 384), 384)
    on, place = compose(
        src, alpha, BackgroundPreset.parse({"canvas": 384, "backdrop": "u/b/l.jpg", "shadow": True}), backdrop
    )
    off, _ = compose(
        src, alpha, BackgroundPreset.parse({"canvas": 384, "backdrop": "u/b/l.jpg"}), backdrop
    )
    on_px, off_px = np.asarray(on).astype(int), np.asarray(off).astype(int)

    below = place.y + place.height + 4
    col = place.x + place.width // 2
    assert on_px[below, col].mean() < off_px[below, col].mean()
    # Far from the subject the backdrop is untouched — not flattened to grey.
    assert np.array_equal(on_px[0, 0], off_px[0, 0])


def test_compose_on_a_backdrop_is_deterministic():
    src = flat_rgb(300, 220, (40, 90, 140))
    alpha = solid_alpha(300, 220, (20, 30, 200, 260))
    preset = BackgroundPreset.parse({"canvas": 512, "backdrop": "u/b/l.jpg", "shadow": True})
    backdrop = cover_crop(gradient_rgb(700, 400), 512)
    a, _ = compose(src, alpha, preset, backdrop)
    b, _ = compose(src, alpha, preset, backdrop)
    assert np.array_equal(np.asarray(a), np.asarray(b))


# ── cover_crop ──────────────────────────────────────────────────────────────


@pytest.mark.parametrize("h,w", [(400, 200), (200, 400), (512, 512), (100, 100), (1, 300), (300, 1)])
def test_cover_crop_always_fills_the_square(h, w):
    """"Cover" means no uncovered pixel, at any input aspect — including the
    degenerate one-pixel-tall backdrop, where ceil() is what saves it."""
    out = cover_crop(gradient_rgb(h, w), 256)
    assert out.shape == (256, 256, 3)
    assert out.dtype == np.uint8


def test_cover_crop_takes_the_middle_of_a_wide_backdrop():
    """A 400x200 backdrop into a 100 square: scale = max(100/400, 100/200) = 0.5,
    so the resize is 200x100 and the crop is x = (200-100)//2 = 50 — the middle
    horizontal half, with nothing taken off the top or bottom."""
    src = gradient_rgb(200, 400)
    out = cover_crop(src, 100)
    full = np.asarray(
        Image.fromarray(src, mode="RGB").resize((200, 100), resample=Image.Resampling.LANCZOS)
    )
    assert np.array_equal(out, full[0:100, 50:150])


def test_cover_crop_takes_the_middle_of_a_tall_backdrop():
    src = gradient_rgb(400, 200)
    out = cover_crop(src, 100)
    full = np.asarray(
        Image.fromarray(src, mode="RGB").resize((100, 200), resample=Image.Resampling.LANCZOS)
    )
    assert np.array_equal(out, full[50:150, 0:100])


def test_cover_crop_of_an_already_square_backdrop_is_a_plain_resize():
    src = gradient_rgb(300, 300)
    out = cover_crop(src, 150)
    expect = np.asarray(
        Image.fromarray(src, mode="RGB").resize((150, 150), resample=Image.Resampling.LANCZOS)
    )
    assert np.array_equal(out, expect)


def test_cover_crop_is_deterministic():
    src = gradient_rgb(431, 277)
    assert np.array_equal(cover_crop(src, 256), cover_crop(src, 256))


@pytest.mark.parametrize(
    "bad",
    [np.zeros((10, 10), dtype=np.uint8), np.zeros((10, 10, 4), dtype=np.uint8)],
)
def test_cover_crop_refuses_anything_that_is_not_rgb(bad):
    with pytest.raises(ComposeError):
        cover_crop(bad, 64)
