"""Trace the brand mark (one glyph of the brand font) into public/favicon.svg.

The mark is a capital letter of Outfit, the one brand font, at weight 700,
taken from the self-hosted variable font so it matches the wordmark exactly.
The letter comes from the "mark" field of brand.json at the repo root (a
--glyph argument overrides it). The path is written as absolute M, L, H, V, Q
and Z commands in favicon units (viewBox 0 0 64 64), with the glyph's ink
fitted to the same 38-unit box the previous "A" mark used (13 to 51 on the
taller axis) and centred on the black rounded tile, which is left untouched.

Normally run through the whole chain, from the repo root:
    BRAND_PYTHON=/path/to/fontvenv/bin/python npm run brand:assets
which traces the mark, runs assets/make-sources.mjs, runs @capacitor/assets for
iOS and Android and reverts android/app/src/main/AndroidManifest.xml.

It needs fonttools and brotli (brotli decodes the woff2). One-time setup of a
scratch venv, anywhere outside the repo:
    python3 -m venv /tmp/fontvenv
    /tmp/fontvenv/bin/pip install fonttools brotli
Then on its own:
    /tmp/fontvenv/bin/python assets/trace-glyph.py           # prints the d
    /tmp/fontvenv/bin/python assets/trace-glyph.py --write   # updates favicon.svg

Options: --glyph S (override brand.json), --weight 700, --box 38 (ink size in
favicon units), --write.
"""
import argparse
import io
import json
import re
import sys
from pathlib import Path

try:
    import brotli  # noqa: F401  (needed by TTFont to read woff2)
    from fontTools.pens.boundsPen import BoundsPen
    from fontTools.pens.svgPathPen import SVGPathPen
    from fontTools.pens.transformPen import TransformPen
    from fontTools.ttLib import TTFont
    from fontTools.varLib import instancer
except ImportError as e:
    sys.exit(
        f"trace-glyph.py: {e}. It needs fonttools and brotli. Fix with:\n"
        "  python3 -m venv /tmp/fontvenv && /tmp/fontvenv/bin/pip install fonttools brotli\n"
        "then run it as BRAND_PYTHON=/tmp/fontvenv/bin/python npm run brand:assets"
    )

ROOT = Path(__file__).resolve().parent.parent
FONT = ROOT / "src" / "assets" / "fonts" / "outfit-latin-300-700.woff2"
FAVICON = ROOT / "public" / "favicon.svg"
BRAND = ROOT / "brand.json"
VIEW = 64


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--glyph", help='letter to trace (default: "mark" in brand.json)')
    ap.add_argument("--weight", type=float, default=700)
    ap.add_argument("--box", type=float, default=38)
    ap.add_argument("--write", action="store_true")
    args = ap.parse_args()
    if not args.glyph:
        try:
            args.glyph = json.loads(BRAND.read_text())["mark"]
        except (OSError, ValueError, KeyError) as e:
            sys.exit(f"trace-glyph.py: no --glyph and no \"mark\" in brand.json ({e})")
    if len(args.glyph) != 1:
        sys.exit(f"trace-glyph.py: the mark must be one character, got {args.glyph!r}")

    font = TTFont(FONT)  # woff2 is decompressed on load (needs brotli)
    font = instancer.instantiateVariableFont(font, {"wght": args.weight})
    # Round-trip through a plain TTF so glyf coordinates reflect the instance.
    buf = io.BytesIO()
    font.flavor = None
    font.save(buf)
    font = TTFont(io.BytesIO(buf.getvalue()))

    cmap = font.getBestCmap()
    if ord(args.glyph) not in cmap:
        sys.exit(f"trace-glyph.py: {args.glyph!r} is not in {FONT.name}")
    name = cmap[ord(args.glyph)]
    glyphs = font.getGlyphSet()
    bounds = BoundsPen(glyphs)
    glyphs[name].draw(bounds)
    xmin, ymin, xmax, ymax = bounds.bounds
    s = args.box / max(xmax - xmin, ymax - ymin)
    # Font units are y-up; flip and centre the ink on the tile.
    tx = VIEW / 2 - (xmin + xmax) / 2 * s
    ty = VIEW / 2 + (ymin + ymax) / 2 * s

    pen = SVGPathPen(glyphs, ntos=lambda v: f"{round(v, 2):g}")
    glyphs[name].draw(TransformPen(pen, (s, 0, 0, -s, tx, ty)))
    d = pen.getCommands()
    # SVGPathPen emits H/V shortcuts; make-sources.mjs reads M L H V Q Z.
    print(d)
    if args.write:
        svg = FAVICON.read_text()
        new, n = re.subn(r'(<path[^>]*\sd=")[^"]+(")', lambda m: m.group(1) + d + m.group(2), svg)
        if n != 1:
            raise SystemExit(f"expected one <path> in favicon.svg, found {n}")
        FAVICON.write_text(new)
        print(f"wrote {FAVICON.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
