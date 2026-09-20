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
mask_status='failed' with mask_flags=['error:<reason>'], and the job moves
to the next image. A batch of 400 photos must not be stopped by one corrupt
JPEG, and "it just stopped at 137" is the least debuggable outcome available.

AND THE REASON HAS TO BE A REASON. The first production run wrote
`error:RuntimeError: replicate create failed (429)` three times, which named an
exception class and a status code and not the cause (Replicate's 402 billing
gate). A `MattingFailure` therefore renders WITHOUT its class name, so a backend
can put a sentence there; the flag is capped at 200 characters rather than 60,
because 60 truncates the sentence to nothing.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass

import httpx
import numpy as np

from .auth import ImageRow
from .backends import Matter, MattingFailure
from .compose import (
    compose,
    cover_crop,
    decode_image_rgb,
    encode_cutout_webp,
    encode_jpeg,
)
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

# The whole flag, `error:` included, is capped here. It goes into mask_flags,
# which is text[] read by a human in the review UI — long enough for Replicate's
# own sentence, short enough that a stack-shaped message cannot fill a column.
MAX_FLAG = 200


class BackdropMissing(MattingFailure):
    """The preset names a photo backdrop and it could not be loaded.

    NEVER a fall back to the flat colour. Half a catalogue on linen and half on
    white — because one fetch failed on a Tuesday — is the failure the whole
    deterministic-compositor design exists to prevent, and it is invisible until a
    buyer sees the grid. Failing the row puts it in the review queue instead,
    where the reason is one word long.
    """

    def __init__(self) -> None:
        super().__init__("backdrop missing")


@dataclass
class ImageOutcome:
    image_id: str
    status: str  # 'auto' | 'review' | 'failed'
    flags: list[str]
    score: float | None
    cutout_path: str | None = None
    composite_path: str | None = None


def _reason(exc: BaseException) -> str:
    """The sentence that goes in the flag.

    A MattingFailure's message IS the reason (see backends/base.py), so it is
    used verbatim. Everything else is `ClassName: message`, because for an
    unexpected exception the class is the most informative half.
    """
    if isinstance(exc, MattingFailure):
        return " ".join(exc.reason.split())
    name = type(exc).__name__
    msg = str(exc).strip().splitlines()[0] if str(exc).strip() else ""
    return f"{name}: {msg}" if msg else name


def error_flag(reason: str) -> str:
    """`error:<reason>`, capped whole. The one place the flag is spelled."""
    return f"error:{reason}"[:MAX_FLAG]


async def load_backdrop(
    client: httpx.AsyncClient, settings: Settings, preset: BackgroundPreset
) -> np.ndarray:
    """Fetch, decode and cover-crop the preset's backdrop. Raises BackdropMissing.

    CALLED ONCE PER JOB, not once per image (see jobs.py). A 2048px backdrop is a
    download, a JPEG decode and a LANCZOS resample; doing that 400 times for one
    batch would cost more than the compositing it feeds. The result is a plain
    uint8 array, so the per-image path is pure arithmetic.
    """
    if not preset.backdrop:
        raise BackdropMissing()
    try:
        data = await download_source(client, settings, preset.backdrop.storage_path)
        return cover_crop(decode_image_rgb(data), preset.canvas)
    except Exception as exc:
        log.error(
            "backdrop %s could not be prepared: %s",
            preset.backdrop.storage_path,
            _reason(exc),
        )
        raise BackdropMissing() from exc


def already_done(row: ImageRow, matter_tag: str, preset_hash: str) -> bool:
    """The idempotency key is mask_model + bg_preset, plus two status exceptions.

    NOT mask_status in general: a row can legitimately be 'approved' or 'original'
    with the current model and preset, and re-matting it would throw away the
    human's decision. And not the presence of a cutout path alone: the same alpha
    under a new preset needs a new composite.

    TWO STATUSES ARE NEVER SKIPPED.

    'failed' — a retry is the whole point of pressing the button again.

    'queued' — because a queued row is a row NOBODY IS WORKING ON. The status is
    written before any work starts, so a machine that dies mid-batch leaves its
    remaining photos queued forever, and Fly's trial SIGKILLs every machine after
    five minutes. Worse, a queued row can carry the PREVIOUS run's model and
    preset (mark_queued only touches mask_status), so the idempotency key matches
    and the row would be skipped for good — permanently stuck "in flight" with no
    process behind it. The rows this process IS working on are excluded in main.py
    from its own in-memory set, which is the only place that knowledge exists.
    """
    if row.mask_status in ("failed", "queued"):
        return False
    return bool(
        row.cutout_storage_path
        and row.composite_storage_path
        and row.mask_model == matter_tag
        and row.bg_preset == preset_hash
    )


def accepted_rows(
    rows: list[ImageRow],
    *,
    matter_tag: str,
    preset_hash: str,
    force: bool,
    inflight: frozenset[str] | set[str] = frozenset(),
) -> list[ImageRow]:
    """What POST /v1/jobs takes on. Everything else is reported as `skipped`.

    Two exclusions, and they are not the same kind of thing.

    `already_done` is about the ROW: it says this photo already carries this
    model's cutout under this preset, so there is nothing to compute. `force`
    overrides it, because "regenerate anyway" is a legitimate request.

    `inflight` is about THIS PROCESS: it says a job running right now has already
    claimed this photo. `force` does NOT override that, and the reason is money
    rather than correctness — the per-org lock serialises jobs, so a duplicate
    would run afterwards rather than concurrently, and by then its accepted list
    was decided before the first job wrote a single row. `already_done` cannot
    catch it retrospectively. `force` means "ignore what the row says", never "do
    it twice".
    """
    return [
        r
        for r in rows
        if r.id not in inflight and (force or not already_done(r, matter_tag, preset_hash))
    ]


async def process_image(
    client: httpx.AsyncClient,
    settings: Settings,
    matter: Matter,
    row: ImageRow,
    preset: BackgroundPreset,
    want_resolution: int = 1024,
    backdrop: np.ndarray | None = None,
) -> ImageOutcome:
    """Run the seven steps for one row, under a deadline. Never raises.

    THE DEADLINE IS THE OUTER ONE. Every call inside has its own timeout, but a
    photo can still wedge between them — and a wedged photo holds one of
    CONCURRENCY worker slots while its row sits at 'queued', which reads exactly
    like "the feature stopped working" with nothing in the log to say otherwise.
    `IMAGE_TIMEOUT_S` converts that into a failed row with a legible flag.

    Cancellation is deliberately NOT converted: on shutdown the row must stay
    'queued' so it is re-submittable, which is what jobs.py's requeue guarantees.
    """
    limit = max(1.0, settings.image_timeout_seconds)
    # Built before the `try` so `deadline` is always bound in the handler below —
    # `as` binds only after __aenter__ succeeds.
    deadline = asyncio.timeout(limit)
    try:
        async with deadline:
            return await _process_one(
                client, settings, matter, row, preset, want_resolution, backdrop
            )
    except TimeoutError as exc:
        # `expired()` is the only reliable way to tell OUR deadline from an inner
        # one — the Replicate poll deadline also raises TimeoutError, and
        # reporting it as "timeout after 180s" would hide which clock ran out.
        reason = f"timeout after {int(limit)}s" if deadline.expired() else _reason(exc)
        return await _fail(client, settings, row, reason)
    except Exception as exc:
        return await _fail(client, settings, row, _reason(exc), traceback=True)


async def _fail(
    client: httpx.AsyncClient,
    settings: Settings,
    row: ImageRow,
    reason: str,
    *,
    traceback: bool = False,
) -> ImageOutcome:
    """One place writes a failed row, so the flag has one spelling.

    The write itself is guarded: `process_image` promises never to raise, and a
    Supabase hiccup while REPORTING a failure must not escalate into an exception
    that skips the job's counters. The row then stays 'queued' and the next submit
    picks it up, which is the right outcome anyway.
    """
    flag = error_flag(reason)
    log.warning("matting failed for %s: %s", row.id, reason, exc_info=traceback)
    try:
        await update_image_row(
            client,
            settings,
            row.id,
            {"mask_status": "failed", "mask_flags": [flag], "matted_at": "now()"},
        )
    except Exception as exc:  # noqa: BLE001 — reporting a failure may not fail
        log.error("could not record the failure of %s (%s): %s", row.id, flag, exc)
    return ImageOutcome(image_id=row.id, status="failed", flags=[flag], score=None)


async def _process_one(
    client: httpx.AsyncClient,
    settings: Settings,
    matter: Matter,
    row: ImageRow,
    preset: BackgroundPreset,
    want_resolution: int,
    backdrop: np.ndarray | None,
) -> ImageOutcome:
    """The seven steps. Raises; `process_image` is what turns that into a row."""
    if not row.storage_path:
        raise ValueError("row has no storage_path")
    if preset.backdrop and backdrop is None:
        raise BackdropMissing()

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
    image, place = compose(source_rgb, alpha, preset, backdrop)
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
