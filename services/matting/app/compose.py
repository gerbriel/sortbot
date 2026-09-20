"""Deterministic compositing: alpha cutout + flat canvas -> catalog JPEG.

NOTHING HERE IS GENERATIVE. Given the same source bytes, the same alpha and the
same preset, this produces the same pixels on every machine, forever. That is
the whole reason the background step is arithmetic rather than a second model
call: a generative "replace the background" pass makes every photo a little
different, and a catalog page of forty garments on forty subtly different whites
looks broken in a way nobody can point at. It also means a preset change is a
cheap re-render from the stored alpha master, not another matting bill.

GEOMETRY, stated once so it can be tested:

  inner   = canvas * (1 - 2*padding)          the square the subject must fit in
  scale   = min(inner/bw, inner/bh)           aspect preserved, never cropped
  nw, nh  = round(bw*scale), round(bh*scale)
  x       = (canvas - nw) // 2                always horizontally centred
  y       = (canvas - nh) // 2                anchor "center"
          = round(padding * canvas)           anchor "top"

`anchor: "top"` exists for hanging garments. A jacket on a hanger photographed
against a wall has its hook at the very top of the frame; centring it leaves an
odd gap above and makes a rail of listings jump around vertically. Pinning the
top edge lines the shoulders up across a whole batch.

A PHOTO BACKDROP CHANGES ONE LINE OF THIS, AND ONLY ONE. When `preset.backdrop`
is set, the canvas starts as that photo cover-cropped to canvas x canvas instead
of as a flat fill; the geometry above, the shadow and the premultiplied composite
are byte-for-byte the same code. That is what makes "the subject lands in the same
place on a linen backdrop as on white" a property rather than a coincidence, and
it is asserted as one in tests/test_compose.py.

`preset.color` then fills NOTHING — the backdrop replaces it entirely. It still
has an effect through the shadow, which multiplies darkness into whatever is
underneath rather than painting grey over an assumed white, so a contact shadow
on a linen backdrop darkens the linen.
"""

from __future__ import annotations

import io
from dataclasses import dataclass

import cv2
import numpy as np
from PIL import Image

from .preset import BackgroundPreset

# The alpha value at which a pixel counts as "part of the subject" for the
# bounding box. 0.02 and not 0.5: a matte's soft edge (hair, knit fuzz, a loose
# thread) lives below 0.5, and a 0.5 box would clip it off, which is exactly the
# halo-free edge the matter was paid for.
SUBJECT_ALPHA = 0.02

SHADOW_SIGMA_FRACTION = 0.015
SHADOW_OFFSET_FRACTION = 0.01
SHADOW_OPACITY = 0.18


class ComposeError(ValueError):
    """The alpha describes nothing that can be composited."""


@dataclass(frozen=True)
class Placement:
    """Where the subject landed. Returned so tests can assert geometry without
    reading pixels, and so the pipeline can log it."""

    x: int
    y: int
    width: int
    height: int
    scale: float
    bbox: tuple[int, int, int, int]  # x0, y0, x1, y1 in SOURCE pixels (x1/y1 exclusive)


def alpha_bbox(alpha: np.ndarray, threshold: float = SUBJECT_ALPHA) -> tuple[int, int, int, int]:
    """Tight bounding box of alpha > threshold, as (x0, y0, x1, y1) exclusive."""
    mask = alpha > threshold
    cols = np.any(mask, axis=0)
    rows = np.any(mask, axis=1)
    if not cols.any() or not rows.any():
        raise ComposeError("alpha is empty — the matter found no subject")
    x0 = int(np.argmax(cols))
    x1 = int(len(cols) - np.argmax(cols[::-1]))
    y0 = int(np.argmax(rows))
    y1 = int(len(rows) - np.argmax(rows[::-1]))
    return x0, y0, x1, y1


def plan_placement(alpha: np.ndarray, preset: BackgroundPreset) -> Placement:
    """Pure geometry — no pixels touched. This is what the tests pin."""
    x0, y0, x1, y1 = alpha_bbox(alpha)
    bw, bh = x1 - x0, y1 - y0

    inner = preset.canvas * (1.0 - 2.0 * preset.padding)
    if inner <= 0:
        raise ComposeError("padding leaves no room for the subject")

    scale = min(inner / bw, inner / bh)
    nw = max(1, int(round(bw * scale)))
    nh = max(1, int(round(bh * scale)))

    x = (preset.canvas - nw) // 2
    y = (
        int(round(preset.padding * preset.canvas))
        if preset.anchor == "top"
        else (preset.canvas - nh) // 2
    )
    return Placement(x=x, y=y, width=nw, height=nh, scale=scale, bbox=(x0, y0, x1, y1))


def cover_crop(rgb: np.ndarray, size: int) -> np.ndarray:
    """Scale-to-cover then centre-crop to `size` x `size`, LANCZOS.

    The `fit: "cover"` of the backdrop contract, and the only fit there is. Cover
    rather than contain because a backdrop that does not reach the edges is not a
    backdrop — it is a picture with a border of whatever is behind it, which is
    the flat colour this replaces.

    PIL's LANCZOS rather than cv2's INTER_LANCZOS4 because a backdrop is almost
    always being made SMALLER (the app uploads up to 2048 px, the canvas is often
    1536), and PIL scales the filter's support with the ratio — proper area-aware
    downsampling — where cv2's fixed 8x8 kernel aliases a woven texture into
    moire. Both are deterministic, which is the property that actually matters
    here (see the module docstring).

    `ceil` on both sides, not `round`: rounding down by one pixel on either axis
    would leave a one-pixel strip of uninitialised canvas at an edge, which on a
    white fill is invisible in review and very visible in a marketplace listing.
    """
    if rgb.ndim != 3 or rgb.shape[2] != 3:
        raise ComposeError("backdrop must be RGB uint8 [H, W, 3]")
    if size < 1:
        raise ComposeError("backdrop target size must be positive")

    import math

    h, w = rgb.shape[:2]
    if h < 1 or w < 1:
        raise ComposeError("backdrop is empty")

    scale = max(size / w, size / h)
    nw, nh = max(size, math.ceil(w * scale)), max(size, math.ceil(h * scale))
    resized = np.asarray(
        Image.fromarray(rgb, mode="RGB").resize((nw, nh), resample=Image.Resampling.LANCZOS),
        dtype=np.uint8,
    )
    x = (nw - size) // 2
    y = (nh - size) // 2
    return np.ascontiguousarray(resized[y : y + size, x : x + size])


def _resize_rgb(rgb: np.ndarray, w: int, h: int) -> np.ndarray:
    # INTER_AREA when shrinking (it averages, so it does not alias a pinstripe
    # into moire), INTER_CUBIC when growing.
    interp = cv2.INTER_AREA if (w < rgb.shape[1] or h < rgb.shape[0]) else cv2.INTER_CUBIC
    return cv2.resize(rgb, (w, h), interpolation=interp)


def compose(
    source_rgb: np.ndarray,
    alpha: np.ndarray,
    preset: BackgroundPreset,
    backdrop: np.ndarray | None = None,
) -> tuple[Image.Image, Placement]:
    """Place the cut-out subject on a flat canvas. Returns (RGB image, placement).

    source_rgb: uint8 [H, W, 3]
    alpha:      float32 [H, W] in [0, 1], same H/W as source_rgb
    backdrop:   uint8 [canvas, canvas, 3], already cover-cropped, or None

    A preset that names a backdrop and is handed none is an ERROR here, not a
    flat-colour render. A catalogue in which some listings got the linen and some
    got white — because a fetch failed quietly on a Tuesday — is the exact failure
    the whole deterministic-compositor argument exists to prevent, and it is
    invisible until a buyer sees the grid. The pipeline refuses first, with a
    legible `error:backdrop missing` flag; this is the second lock on the same
    door, for the CLI and for any future caller.
    """
    if source_rgb.ndim != 3 or source_rgb.shape[2] != 3:
        raise ComposeError("source must be RGB uint8 [H, W, 3]")
    if alpha.shape[:2] != source_rgb.shape[:2]:
        raise ComposeError("alpha and source must have the same dimensions")
    if preset.backdrop and backdrop is None:
        raise ComposeError("preset names a backdrop but none was supplied")
    if backdrop is not None and backdrop.shape != (preset.canvas, preset.canvas, 3):
        raise ComposeError(
            f"backdrop must be cover-cropped to {preset.canvas}x{preset.canvas} before compositing"
        )

    place = plan_placement(alpha, preset)
    x0, y0, x1, y1 = place.bbox

    sub_rgb = source_rgb[y0:y1, x0:x1]
    sub_a = alpha[y0:y1, x0:x1]

    sub_rgb = _resize_rgb(sub_rgb, place.width, place.height)
    # The alpha is resized with the same filter family so the colour and the
    # coverage stay registered with each other; a mismatch here is what produces
    # a one-pixel fringe of the old background all the way round the garment.
    interp = (
        cv2.INTER_AREA
        if (place.width < sub_a.shape[1] or place.height < sub_a.shape[0])
        else cv2.INTER_CUBIC
    )
    sub_a = cv2.resize(sub_a, (place.width, place.height), interpolation=interp)
    sub_a = np.clip(sub_a, 0.0, 1.0).astype(np.float32)

    canvas = np.empty((preset.canvas, preset.canvas, 3), dtype=np.float32)
    if backdrop is not None:
        canvas[:, :] = backdrop.astype(np.float32)
    else:
        canvas[:, :] = np.asarray(preset.rgb(), dtype=np.float32)

    if preset.shadow:
        canvas = _draw_shadow(canvas, sub_a, place, preset)

    # Premultiplied composite over whatever is now on the canvas (flat colour,
    # or flat colour plus shadow).
    ys, ye, xs, xe = _clipped_slice(place, preset.canvas)
    if ye > ys and xe > xs:
        a = sub_a[ys - place.y : ye - place.y, xs - place.x : xe - place.x][..., None]
        fg = sub_rgb[ys - place.y : ye - place.y, xs - place.x : xe - place.x].astype(np.float32)
        canvas[ys:ye, xs:xe] = fg * a + canvas[ys:ye, xs:xe] * (1.0 - a)

    out = np.clip(np.rint(canvas), 0, 255).astype(np.uint8)
    return Image.fromarray(out, mode="RGB"), place


def _clipped_slice(place: Placement, canvas: int) -> tuple[int, int, int, int]:
    """The subject rect intersected with the canvas.

    It can only fall outside when padding is 0 and rounding pushes a dimension
    one pixel over, but a silent IndexError in a background worker is a photo
    that is 'failed' for no legible reason, so clip rather than assume.
    """
    ys = max(0, place.y)
    xs = max(0, place.x)
    ye = min(canvas, place.y + place.height)
    xe = min(canvas, place.x + place.width)
    return ys, ye, xs, xe


def _draw_shadow(
    canvas: np.ndarray,
    sub_a: np.ndarray,
    place: Placement,
    preset: BackgroundPreset,
) -> np.ndarray:
    """A soft contact shadow under the subject.

    Off by default. It is the one part of the composite that is a matter of
    taste rather than correctness, and a shadow that is wrong is much more
    obviously wrong than no shadow — a marketplace that strips backgrounds to
    pure white will also reject a grey smudge.
    """
    size = preset.canvas
    sigma = max(1.0, SHADOW_SIGMA_FRACTION * size)
    offset = int(round(SHADOW_OFFSET_FRACTION * size))

    layer = np.zeros((size, size), dtype=np.float32)
    sy, sx = place.y + offset, place.x
    ys, ye = max(0, sy), min(size, sy + place.height)
    xs, xe = max(0, sx), min(size, sx + place.width)
    if ye > ys and xe > xs:
        layer[ys:ye, xs:xe] = sub_a[ys - sy : ye - sy, xs - sx : xe - sx]

    # ksize 0 lets OpenCV derive it from sigma; it must still be odd internally.
    layer = cv2.GaussianBlur(layer, (0, 0), sigmaX=sigma, sigmaY=sigma)
    layer = np.clip(layer * SHADOW_OPACITY, 0.0, 1.0)[..., None]

    # Shadow colour is black multiplied in, so it darkens whatever the backdrop
    # is rather than assuming white.
    return canvas * (1.0 - layer)


def encode_jpeg(image: Image.Image, quality: int) -> bytes:
    """4:4:4 subsampling, deliberately.

    The default 4:2:0 throws away three quarters of the colour resolution, which
    is invisible on a photograph and very visible on the hard subject/backdrop
    edge this pipeline just created — it fringes. These files are the catalog's
    product shots; the extra ~15% of bytes is the cheapest quality in the whole
    pipeline.
    """
    buf = io.BytesIO()
    image.save(buf, format="JPEG", quality=quality, subsampling=0, optimize=True, progressive=True)
    return buf.getvalue()


def encode_cutout_webp(source_rgb: np.ndarray, alpha: np.ndarray) -> bytes:
    """The alpha master: source RGB + LOSSLESS alpha, in WebP.

    `alpha_quality=100` is what makes this a master rather than another lossy
    generation: the RGB is re-encoded at 90 (it is already a JPEG, so it has
    been through a lossy pass regardless), but the alpha — the expensive part,
    the thing a second matting call would cost money to recreate — is stored
    exactly. `method=6` is Pillow's slowest/smallest setting; this file is
    written once and read on every preset change.
    """
    h, w = alpha.shape[:2]
    a8 = np.clip(np.rint(alpha * 255.0), 0, 255).astype(np.uint8)
    rgba = np.dstack([source_rgb[:h, :w], a8])
    buf = io.BytesIO()
    Image.fromarray(rgba, mode="RGBA").save(
        buf, format="WEBP", quality=90, alpha_quality=100, method=6, exact=True
    )
    return buf.getvalue()


def decode_image_rgb(data: bytes) -> np.ndarray:
    """Decode to RGB uint8, honouring EXIF orientation exactly once.

    Pillow does NOT apply orientation on open, so unlike the browser (AGENTS.md
    §18 #34, where the rule is the opposite — never touch EXIF, the engine did
    it) this service must apply it, and must apply it here and nowhere else. If
    it did not, a phone photo with EXIF 6 would be matted sideways: BiRefNet
    would still find the garment, but the composite would be a rotated jacket on
    a perfect white background, which looks like a deliberate choice rather than
    a bug.
    """
    from PIL import ImageOps

    with Image.open(io.BytesIO(data)) as im:
        im = ImageOps.exif_transpose(im)
        return np.asarray(im.convert("RGB"), dtype=np.uint8)


def decode_image_rgba(data: bytes) -> tuple[np.ndarray, np.ndarray | None]:
    """Decode to (RGB uint8, alpha float32 or None). Same EXIF rule as above."""
    from PIL import ImageOps

    with Image.open(io.BytesIO(data)) as im:
        im = ImageOps.exif_transpose(im)
        if im.mode in ("RGBA", "LA") or (im.mode == "P" and "transparency" in im.info):
            rgba = np.asarray(im.convert("RGBA"), dtype=np.uint8)
            return rgba[..., :3].copy(), (rgba[..., 3].astype(np.float32) / 255.0)
        if im.mode in ("L", "1", "I;16"):
            g = np.asarray(im.convert("L"), dtype=np.uint8)
            return np.dstack([g, g, g]), None
        return np.asarray(im.convert("RGB"), dtype=np.uint8), None
