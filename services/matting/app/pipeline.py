"""One image, start to finish.

Seven steps, in this order, and the order is load-bearing:

  1. download the source from storage_path
  2. mat it -> alpha at SOURCE resolution
  3. write the ALPHA MASTER (WebP, lossless alpha)      <- the durable asset
  4. composite deterministically -> JPEG                <- disposable, re-derivable
  5. score the mask
  6. UPDATE the row (this is the commit point)
  7. clean up the PREVIOUS cutout/composite, reference-counted

Why the master is written before the composite (3 before 4): the alpha is the
expensive artifact — a matting call, money on the replicate backend — and the
composite is arithmetic. If the process dies between them, the next run finds a
row with no composite, re-derives it from nothing, and pays again; if they were
the other way round it could die holding a composite whose alpha was never
saved, which is the same cost plus a file that cannot be regenerated to match.

Why the row UPDATE is last of the writes (6 after 3 and 4): the row is the only
thing anyone reads. A row that points at a file is a promise that the file
exists; writing the row first would publish a broken link for as long as the
upload took, and forever if it failed.

Why cleanup is after the commit (7 after 6): until the row points at the new
files, the OLD ones are still the live catalog images. Deleting them first is a
window in which the product has no picture.

FAILURE IS A ROW STATE, NOT AN EXCEPTION. Anything that throws lands as
mask_status='failed' with mask_flags=['error:<short reason>'], and the job moves
to the next image. A batch of 400 photos must not be stopped by one corrupt
JPEG, and "it just stopped at 137" is the least debuggable outcome available.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

import httpx

from .auth import ImageRow
from .backends import Matter
from .compose import compose, decode_image_rgb, encode_cutout_webp, encode_jpeg
from .config import Settings
from .preset import BackgroundPreset
from .score import score_mask
from .storage import (
    delete_if_unreferenced,
    derived_paths,
    download_source,
    update_image_row,
    upload,
)

log = logging.getLogger("matting.pipeline")

# A reason string goes into mask_flags, which is text[] read by a human in the
# review UI. Keep it short, stable, and free of anything identifying.
MAX_REASON = 60


@dataclass
class ImageOutcome:
    image_id: str
    status: str  # 'auto' | 'review' | 'failed'
    flags: list[str]
    score: float | None
    cutout_path: str | None = None
    composite_path: str | None = None


def _reason(exc: BaseException) -> str:
    name = type(exc).__name__
    msg = str(exc).strip().splitlines()[0] if str(exc).strip() else ""
    text = f"{name}: {msg}" if msg else name
    return text[:MAX_REASON]


def already_done(row: ImageRow, matter_tag: str, preset_hash: str) -> bool:
    """The idempotency key is mask_model + bg_preset, and nothing else.

    NOT mask_status: a row can legitimately be 'approved' or 'original' with the
    current model and preset, and re-matting it would throw away the human's
    decision. And not the presence of a cutout path alone: the same alpha under
    a new preset needs a new composite.

    'failed' is never skipped — a retry is the whole point of pressing the
    button again.
    """
    if row.mask_status == "failed":
        return False
    return bool(
        row.cutout_storage_path
        and row.composite_storage_path
        and row.mask_model == matter_tag
        and row.bg_preset == preset_hash
    )


async def process_image(
    client: httpx.AsyncClient,
    settings: Settings,
    matter: Matter,
    row: ImageRow,
    preset: BackgroundPreset,
    want_resolution: int = 1024,
) -> ImageOutcome:
    """Run the seven steps for one row. Never raises."""
    try:
        if not row.storage_path:
            raise ValueError("row has no storage_path")

        # 1 — source
        source_bytes = await download_source(client, settings, row.storage_path)
        source_rgb = decode_image_rgb(source_bytes)

        # 2 — alpha, at source resolution (the backend's contract)
        alpha = await _mat(client, settings, matter, row, source_bytes, source_rgb, want_resolution)
        if alpha.shape[:2] != source_rgb.shape[:2]:
            raise ValueError("backend returned an alpha of the wrong size")

        cut_path, comp_path = derived_paths(row.storage_path, matter.tag, preset.hash)

        # 3 — the durable master
        await upload(client, settings, cut_path, encode_cutout_webp(source_rgb, alpha), "image/webp")

        # 4 — the disposable composite
        image, place = compose(source_rgb, alpha, preset)
        await upload(
            client, settings, comp_path, encode_jpeg(image, preset.quality), "image/jpeg"
        )

        # 5 — score
        scored = score_mask(alpha, source_rgb, settings, anchor=preset.anchor)
        status = "review" if scored.needs_review(settings.advisory_flags) else "auto"

        # 6 — commit. storage_path / image_url / position are NOT in this patch.
        ok = await update_image_row(
            client,
            settings,
            row.id,
            {
                "cutout_storage_path": cut_path,
                "composite_storage_path": comp_path,
                "bg_preset": preset.hash,
                "mask_model": matter.tag,
                "mask_score": scored.score,
                "mask_flags": scored.flags,
                "mask_status": status,
                "matted_at": "now()",
            },
        )
        if not ok:
            raise RuntimeError("row update matched 0 rows")

        log.info(
            "matted %s -> %s flags=%s score=%.3f place=%dx%d@%d,%d",
            row.id,
            status,
            scored.flags or "-",
            scored.score,
            place.width,
            place.height,
            place.x,
            place.y,
        )

        # 7 — supersede the previous derived files, reference-counted
        stale = [
            p
            for p in (row.cutout_storage_path, row.composite_storage_path)
            if p and p not in (cut_path, comp_path)
        ]
        if stale:
            removed = await delete_if_unreferenced(client, settings, stale, row.id)
            if removed:
                log.info("cleanup: removed %d superseded file(s) for %s", len(removed), row.id)

        return ImageOutcome(
            image_id=row.id,
            status=status,
            flags=scored.flags,
            score=scored.score,
            cutout_path=cut_path,
            composite_path=comp_path,
        )

    except Exception as exc:
        reason = _reason(exc)
        log.warning("matting failed for %s: %s", row.id, reason, exc_info=True)
        await update_image_row(
            client,
            settings,
            row.id,
            {"mask_status": "failed", "mask_flags": [f"error:{reason}"], "matted_at": "now()"},
        )
        return ImageOutcome(image_id=row.id, status="failed", flags=[f"error:{reason}"], score=None)


async def _mat(
    client: httpx.AsyncClient,
    settings: Settings,
    matter: Matter,
    row: ImageRow,
    source_bytes: bytes,
    source_rgb,
    want_resolution: int,
):
    """Call the backend the way that backend wants to be called.

    The Replicate backend takes a URL it can fetch — the bucket is public, so
    the source is already on a CDN and nothing has to be re-uploaded to get a
    prediction. Every other backend takes bytes. This is the one place the
    difference is visible; `Matter.mat` is still the interface everything else
    is written against.
    """
    from .backends.replicate import ReplicateMatter

    if isinstance(matter, ReplicateMatter):
        if row.storage_path:
            url = settings.storage_public_url(row.storage_path)
            try:
                return await matter.mat_url(url, source_rgb, want_resolution)
            except Exception as exc:
                # A private bucket (or a CDN hiccup) shows up here as Replicate
                # being unable to fetch. Inlining the bytes always works, so try
                # it once before calling the image a failure.
                log.warning("replicate: url fetch path failed (%s) — retrying inline", _reason(exc))
        return await matter.mat_data_uri(source_bytes, source_rgb, want_resolution, "image/jpeg")

    return await matter.mat(source_bytes, want_resolution)
