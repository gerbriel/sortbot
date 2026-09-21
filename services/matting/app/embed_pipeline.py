"""One photo, start to finish — the embedding half.

`pipeline.py` is the same idea for matting; this is deliberately the smaller,
duller sibling, and the difference is worth naming: matting WRITES two files and
mutates the row that the whole catalogue reads, so its step order is load-bearing
and its failures are a row state. An embedding writes one derived row that
nothing else depends on, so a failure here is a photo with no comps — annoying,
never destructive, and always fixable by pressing the button again.

FOUR STEPS:

  1. download the source from storage_path (public URL first, service role second)
  2. decode + EXIF-orient it, ONCE, with compose.decode_image_rgb
  3. preprocess + forward pass -> 512 L2-normalised floats
  4. stage the row; the caller upserts in chunks

WHY THE ROWS ARE STAGED AND UPSERTED IN CHUNKS rather than written one at a time:
a 400-photo batch is 400 round trips against one table otherwise, which is how a
workspace rate-limits itself mid-job (the same lesson Step 4's publication writes
and `saveBatchToDatabase` both learned). The flush happens every
EMBED_ROW_CHUNK photos and again at the end, so progress is durable long before
the job finishes.

A FAILED PHOTO IS LOGGED AND SKIPPED, AND NO ROW IS WRITTEN. Not a row with a
zero vector, not a row with a NULL embedding — nothing. A zero vector is
orthogonal to everything and would sit quietly at the bottom of every neighbour
list forever; the absence of a row is what makes "press Find similar again" work.

A FAILED FLUSH counts its whole chunk as failed and the job CARRIES ON. The
photos in it are simply not embedded, `fetch_existing_models` will not find them
next time, and a resubmit picks them straight back up.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Callable
from dataclasses import dataclass, field

import httpx

from .auth import ImageRow
from .compose import decode_image_rgb
from .config import Settings
from .embed import Embedder
from .embed_store import (
    EMBED_ROW_CHUNK,
    build_embedding_row,
    upsert_embeddings,
)
from .storage import download_source

log = logging.getLogger("matting.embed.pipeline")

# Same cap and the same reason as pipeline.MAX_FLAG: a reason that is a sentence
# is worth 200 characters; a reason that is a stack trace is worth none.
MAX_REASON = 200


@dataclass
class EmbedOutcome:
    image_id: str
    ok: bool
    reason: str = ""


@dataclass
class EmbedBatchResult:
    embedded: int = 0
    failed: int = 0
    reasons: list[str] = field(default_factory=list)


def _reason(exc: BaseException) -> str:
    """The sentence that gets logged and counted.

    An `EmbedError`'s message IS the reason and is used verbatim; anything else
    keeps its class name, because for an unexpected exception the class is the
    informative half. Same rule as `pipeline._reason`.
    """
    from .embed import EmbedError

    if isinstance(exc, EmbedError):
        return " ".join(str(exc).split())[:MAX_REASON]
    name = type(exc).__name__
    msg = str(exc).strip().splitlines()[0] if str(exc).strip() else ""
    return (f"{name}: {msg}" if msg else name)[:MAX_REASON]


async def embed_one(
    client: httpx.AsyncClient,
    settings: Settings,
    embedder: Embedder,
    row: ImageRow,
    *,
    org_id: str,
    group_id: str | None,
) -> dict:
    """Steps 1-4 for one photo. Raises; the caller turns that into a count."""
    from .embed import EmbedError, to_pgvector

    if not row.storage_path:
        raise EmbedError("row has no storage_path")

    # THE ORIGINAL PHOTO, never the composite. A cutout on a flat white canvas is
    # a different image to CLIP than the garment as shot, and half a catalogue
    # embedded one way and half the other would make every cross-comparison
    # between the two halves useless — while looking like it worked.
    data = await download_source(client, settings, row.storage_path)
    rgb = await asyncio.to_thread(decode_image_rgb, data)
    vector = await embedder.embed(rgb)
    return build_embedding_row(
        row,
        org_id=org_id,
        group_id=group_id,
        vector_text=to_pgvector(vector),
        tag=embedder.tag,
    )


async def run_embed_batch(
    client: httpx.AsyncClient,
    settings: Settings,
    embedder: Embedder,
    rows: list[ImageRow],
    *,
    org_id: str,
    group_map: dict[str, str | None],
    on_result: Callable[[EmbedOutcome], None] | None = None,
) -> EmbedBatchResult:
    """Embed every row, flushing staged rows in chunks. Never raises.

    `on_result` is how the job registry ticks its progress bar without this
    module knowing what a job is.

    The per-photo deadline is the OUTER one, exactly as in `pipeline.process_image`
    and for the same reason: every inner call has its own timeout and a photo can
    still wedge between them, holding one of EMBED_CONCURRENCY slots while the
    progress bar sits still. Cancellation is deliberately NOT converted into a
    failure — on shutdown the photo is simply not embedded, and the next submit
    finds it missing and takes it.
    """
    result = EmbedBatchResult()
    staged: list[dict] = []
    stage_ids: list[str] = []
    lock = asyncio.Lock()
    sem = asyncio.Semaphore(max(1, settings.embed_concurrency))
    limit = max(1.0, settings.embed_timeout_seconds)

    def record(image_id: str, ok: bool, reason: str = "") -> None:
        if ok:
            result.embedded += 1
        else:
            result.failed += 1
            if reason and reason not in result.reasons:
                result.reasons.append(reason)
        if on_result is not None:
            on_result(EmbedOutcome(image_id=image_id, ok=ok, reason=reason))

    async def flush(batch: list[dict], ids: list[str]) -> None:
        try:
            await upsert_embeddings(client, settings, batch)
            for image_id in ids:
                record(image_id, True)
        except Exception as exc:  # noqa: BLE001 — a failed flush must not stop the job
            reason = _reason(exc)
            log.error("embed: flush of %d row(s) failed: %s", len(batch), reason)
            for image_id in ids:
                record(image_id, False, reason)

    async def one(row: ImageRow) -> None:
        async with sem:
            deadline = asyncio.timeout(limit)
            try:
                async with deadline:
                    built = await embed_one(
                        client,
                        settings,
                        embedder,
                        row,
                        org_id=org_id,
                        group_id=group_map.get(row.product_id or "", None),
                    )
            except TimeoutError as exc:
                # `expired()` distinguishes OUR deadline from an inner one; the
                # download has its own, and reporting it as "timeout after 60s"
                # would name the wrong clock.
                reason = f"timeout after {int(limit)}s" if deadline.expired() else _reason(exc)
                log.warning("embed: %s failed: %s", row.id, reason)
                record(row.id, False, reason)
                return
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001
                reason = _reason(exc)
                log.warning("embed: %s failed: %s", row.id, reason)
                record(row.id, False, reason)
                return

        # Staged under a lock, and the chunk is handed OFF as a fresh list before
        # the await — otherwise a concurrent `one` could append to the list this
        # flush is already sending, and those photos would be counted twice.
        async with lock:
            staged.append(built)
            stage_ids.append(row.id)
            if len(staged) < EMBED_ROW_CHUNK:
                return
            batch, ids = staged[:], stage_ids[:]
            staged.clear()
            stage_ids.clear()
        await flush(batch, ids)

    await asyncio.gather(*(one(r) for r in rows), return_exceptions=True)

    if staged:
        await flush(staged[:], stage_ids[:])
        staged.clear()
        stage_ids.clear()

    log.info(
        "embed: %d embedded, %d failed of %d%s",
        result.embedded,
        result.failed,
        len(rows),
        f" ({'; '.join(result.reasons[:3])})" if result.reasons else "",
    )
    return result
