"""Offline CLI — the same pipeline against a folder, with no Supabase at all.

    python -m app.cli --backend local --preset preset.json --in ./photos --out ./out

WHY THIS EXISTS. The service is one process on one host; the founder's work is
not allowed to stop because it is down, because a card expired, or because
Replicate is having an afternoon. This reads a directory, writes `cut-*.webp`
and `bg-*.jpg` beside each other in --out, and prints the same flags the review
queue would have shown. Nothing about it is a toy path: it calls the SAME
compose, score and backend code, so a composite produced here is byte-identical
to one produced by the service for the same preset and alpha.

It is also how you tune thresholds. Run a hundred photos, look at the flag
column, move SCORE_* in the environment, run again — without touching
production or spending a matting call per iteration (with --backend local).
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import mimetypes
import sys
from pathlib import Path

import httpx

from .backends import build_matter
from .backends.replicate import ReplicateMatter
from .compose import compose, decode_image_rgb, encode_cutout_webp, encode_jpeg
from .config import Settings, get_settings
from .preset import BackgroundPreset
from .score import score_mask

log = logging.getLogger("matting.cli")

IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"}


def _load_preset(path: str | None) -> BackgroundPreset:
    if not path:
        return BackgroundPreset()
    return BackgroundPreset.parse(json.loads(Path(path).read_text(encoding="utf-8")))


async def _run(args: argparse.Namespace) -> int:
    settings = get_settings(refresh=True)
    # The CLI overrides the backend without needing the env var set, and it
    # explicitly does not require SUPABASE_* — validate() would demand them.
    settings = Settings(**{**settings.__dict__, "backend": args.backend})

    preset = _load_preset(args.preset)
    in_dir, out_dir = Path(args.input), Path(args.output)
    out_dir.mkdir(parents=True, exist_ok=True)

    files = sorted(p for p in in_dir.iterdir() if p.suffix.lower() in IMAGE_SUFFIXES)
    if not files:
        print(f"no images in {in_dir}", file=sys.stderr)
        return 1

    print(f"preset {preset.id} -> hash {preset.hash}  ({preset.canonical_json()})")
    print(f"{len(files)} image(s), backend={args.backend}\n")

    failed = 0
    async with httpx.AsyncClient(timeout=settings.http_timeout_seconds, follow_redirects=True) as client:
        matter = build_matter(settings, client)
        sem = asyncio.Semaphore(max(1, args.concurrency))

        async def one(path: Path) -> None:
            nonlocal failed
            async with sem:
                try:
                    data = path.read_bytes()
                    rgb = decode_image_rgb(data)
                    if isinstance(matter, ReplicateMatter):
                        mime = mimetypes.guess_type(path.name)[0] or "image/jpeg"
                        alpha = await matter.mat_data_uri(data, rgb, args.resolution, mime)
                    else:
                        alpha = await matter.mat(data, args.resolution)

                    stem = path.stem
                    (out_dir / f"cut-{stem}.webp").write_bytes(encode_cutout_webp(rgb, alpha))
                    image, place = compose(rgb, alpha, preset)
                    (out_dir / f"bg-{preset.hash}-{stem}.jpg").write_bytes(
                        encode_jpeg(image, preset.quality)
                    )

                    scored = score_mask(alpha, rgb, settings, anchor=preset.anchor)
                    status = "review" if scored.needs_review(settings.advisory_flags) else "auto"
                    print(
                        f"  {path.name:<34s} {status:<7s} score={scored.score:.3f} "
                        f"flags={','.join(scored.flags) or '-':<28s} "
                        f"placed {place.width}x{place.height}@{place.x},{place.y}"
                    )
                except Exception as exc:
                    failed += 1
                    print(f"  {path.name:<34s} FAILED  {type(exc).__name__}: {exc}", file=sys.stderr)

        await asyncio.gather(*(one(p) for p in files))

    print(f"\n{len(files) - failed} ok, {failed} failed -> {out_dir}")
    return 1 if failed else 0


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.WARNING, format="%(levelname)s %(name)s %(message)s")
    p = argparse.ArgumentParser(prog="python -m app.cli", description=__doc__)
    p.add_argument("--backend", choices=("local", "replicate"), default="local")
    p.add_argument("--preset", help="path to a preset JSON file (defaults to the default preset)")
    p.add_argument("--in", dest="input", required=True, help="directory of source images")
    p.add_argument("--out", dest="output", required=True, help="directory to write into")
    p.add_argument("--resolution", type=int, default=1024, choices=(1024, 2048))
    p.add_argument("--concurrency", type=int, default=2)
    args = p.parse_args(argv)
    return asyncio.run(_run(args))


if __name__ == "__main__":
    raise SystemExit(main())
