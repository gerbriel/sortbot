"""BackgroundPreset and the presetHash.

THE HASH IS A CROSS-LANGUAGE CONTRACT. The browser computes it in TypeScript to
decide whether a stored composite is stale; this service computes it in Python
to name the file and fill product_images.bg_preset. If the two ever disagree,
every composite in the workspace looks stale forever and the app re-mats the
whole catalog — at ~$0.0017 an image, on a 4,800-image bucket, that is a real
bill for a rounding bug. CONTRACT.md §4 states the algorithm and three fixed
vectors; tests/test_preset_hash.py asserts them here, and the TypeScript side
asserts the same three strings.

Two decisions inside the canonical form:

  * `id` and `name` are NOT hashed. The hash identifies a LOOK, not a preset
    row. Renaming "White 2048" to "Default white" must not invalidate 4,800
    composites, and two presets that happen to describe the same look should
    share their output rather than render it twice.

  * `padding` is serialised through a fixed-point form (at most 3 decimals,
    trailing zeros stripped) instead of the language's float repr. Python's
    repr(0.1) and JavaScript's String(0.1) agree today, but repr(0.07*2) does
    not agree with anything, and a slider that emits 0.10000000000000003 would
    mint a second hash for a look the user cannot distinguish. Three decimals
    is ~2 px of padding at a 2048 canvas: below the resolution of the decision.
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass

HEX_COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")

DEFAULT_CANVAS = 2048
DEFAULT_COLOR = "#FFFFFF"
DEFAULT_PADDING = 0.10
DEFAULT_ANCHOR = "center"
DEFAULT_SHADOW = False
DEFAULT_QUALITY = 90

ANCHORS = ("center", "top")
MIN_CANVAS, MAX_CANVAS = 256, 4096
MIN_PADDING, MAX_PADDING = 0.0, 0.4
MIN_QUALITY, MAX_QUALITY = 60, 95


class PresetError(ValueError):
    """A preset that cannot be rendered. Surfaces as a 422, never a 500."""


def _format_padding(value: float) -> str:
    """0.1 and 0.100 -> "0.1"; 0.08 -> "0.08"; 0 -> "0".

    The JavaScript equivalent is String(Number(padding.toFixed(3))), which
    produces the same string for every value in [0, 0.4].
    """
    s = f"{float(value):.3f}".rstrip("0").rstrip(".")
    return s or "0"


@dataclass(frozen=True)
class BackgroundPreset:
    id: str = "default"
    canvas: int = DEFAULT_CANVAS
    color: str = DEFAULT_COLOR
    padding: float = DEFAULT_PADDING
    anchor: str = DEFAULT_ANCHOR
    shadow: bool = DEFAULT_SHADOW
    quality: int = DEFAULT_QUALITY

    # ── Construction ────────────────────────────────────────────────────────

    @classmethod
    def parse(cls, raw: object) -> BackgroundPreset:
        """Build from an untrusted dict, applying every documented default.

        Validation is strict and loud rather than clamping, for everything the
        caller chose explicitly: a padding of 0.9 is not "0.4 with extra", it is
        a caller that has misunderstood the unit, and silently rendering
        something else would be discovered months later in the catalog.
        """
        if raw is None:
            return cls()
        if not isinstance(raw, dict):
            raise PresetError("preset must be an object")

        pid = raw.get("id", "default")
        if not isinstance(pid, str) or not pid.strip():
            raise PresetError("preset.id must be a non-empty string")

        canvas = raw.get("canvas", DEFAULT_CANVAS)
        if isinstance(canvas, bool) or not isinstance(canvas, int):
            raise PresetError("preset.canvas must be an integer")
        if not (MIN_CANVAS <= canvas <= MAX_CANVAS):
            raise PresetError(f"preset.canvas must be {MIN_CANVAS}-{MAX_CANVAS}")

        color = raw.get("color", DEFAULT_COLOR)
        if not isinstance(color, str) or not HEX_COLOR_RE.match(color.strip()):
            raise PresetError("preset.color must be #RRGGBB")

        padding = raw.get("padding", DEFAULT_PADDING)
        if isinstance(padding, bool) or not isinstance(padding, (int, float)):
            raise PresetError("preset.padding must be a number")
        if not (MIN_PADDING <= float(padding) <= MAX_PADDING):
            raise PresetError(f"preset.padding must be {MIN_PADDING}-{MAX_PADDING}")

        anchor = raw.get("anchor", DEFAULT_ANCHOR)
        if anchor not in ANCHORS:
            raise PresetError(f"preset.anchor must be one of {ANCHORS}")

        shadow = raw.get("shadow", DEFAULT_SHADOW)
        if not isinstance(shadow, bool):
            raise PresetError("preset.shadow must be a boolean")

        quality = raw.get("quality", DEFAULT_QUALITY)
        if isinstance(quality, bool) or not isinstance(quality, int):
            raise PresetError("preset.quality must be an integer")
        if not (MIN_QUALITY <= quality <= MAX_QUALITY):
            raise PresetError(f"preset.quality must be {MIN_QUALITY}-{MAX_QUALITY}")

        return cls(
            id=pid.strip(),
            canvas=canvas,
            color=color.strip().upper(),
            # Round on the way in so the stored value and the hashed value can
            # never describe different geometry.
            padding=round(float(padding), 3),
            anchor=anchor,
            shadow=shadow,
            quality=quality,
        )

    # ── The contract ────────────────────────────────────────────────────────

    def canonical_json(self) -> str:
        """The exact bytes that are hashed. Keys sorted, no spaces, no `id`."""
        parts = (
            ("anchor", json.dumps(self.anchor)),
            ("canvas", str(int(self.canvas))),
            ("color", json.dumps(self.color.upper())),
            ("padding", _format_padding(self.padding)),
            ("quality", str(int(self.quality))),
            ("shadow", "true" if self.shadow else "false"),
        )
        return "{" + ",".join(f'"{k}":{v}' for k, v in parts) + "}"

    @property
    def hash(self) -> str:
        """First 8 hex of sha1 over canonical_json().

        sha1 and not sha256 because this is a filename discriminator, not a
        security boundary — nothing trusts it, and an attacker who could forge
        a collision would win the right to reuse their own composite. 8 hex is
        4.3e9 buckets against a handful of presets per workspace.
        """
        return hashlib.sha1(self.canonical_json().encode("utf-8")).hexdigest()[:8]

    def rgb(self) -> tuple[int, int, int]:
        c = self.color.lstrip("#")
        return (int(c[0:2], 16), int(c[2:4], 16), int(c[4:6], 16))

    def to_dict(self) -> dict[str, object]:
        return {
            "id": self.id,
            "canvas": self.canvas,
            "color": self.color,
            "padding": self.padding,
            "anchor": self.anchor,
            "shadow": self.shadow,
            "quality": self.quality,
            "presetHash": self.hash,
        }
