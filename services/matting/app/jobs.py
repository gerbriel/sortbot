"""The job registry and the worker pool.

THE ROWS ARE THE TRUTH; THIS IS A PROGRESS BAR. Everything durable — which
photos are queued, which came out clean, which need a human — lives in
product_images. This module holds an in-memory counter so a browser can render
a progress bar without polling the database once a second, and that is all it
is for. Losing it to a restart costs a progress bar, not work: the rows are
still 'queued', and resubmitting the same ids picks them up.

That is a deliberate trade against a durable queue (a jobs table, or Redis).
A durable queue buys automatic resumption after a crash and costs a table, a
migration, a reaper for abandoned leases, and a second source of truth that can
disagree with the rows. For a founder-operated service where "press the button
again" is an acceptable recovery and a batch is minutes, not hours, the
in-memory version is the right size. It is written down here so the day it
stops being the right size is a decision rather than a discovery.

ONE JOB PER WORKSPACE AT A TIME, queued rather than rejected. Two reasons:
a second submit is almost always "I added ten more photos", and rejecting it
makes the caller invent a retry loop; and 375 concurrent PATCHes against one
table is how a workspace rate-limits itself mid-export (the same lesson Step 4's
publication writes learned). Within a job, CONCURRENCY images run at once.

AND IT KNOWS WHICH PHOTOS IT IS HOLDING. `inflight_ids()` is every image this
process has queued in Supabase and not yet written a result for, and it exists
for two things that both came out of the first production run:

  * POST /v1/jobs re-accepts a `queued` row, because a queued row is normally an
    orphan from a machine that died (see pipeline.already_done). The exception is
    a row THIS process is holding — re-accepting that one would mat the same photo
    twice and bill for it twice, and the org lock means the duplicate runs later
    rather than concurrently, so `already_done` cannot catch it afterwards either.

  * On shutdown those rows are written back to 'queued' (`requeue_inflight`).
    Fly's trial stops every machine after five minutes, so "the process went away
    mid-batch" is the normal case here, not the exceptional one.
"""

from __future__ import annotations

import asyncio
import logging
import time
import uuid
from dataclasses import dataclass, field

import httpx
import numpy as np

from .auth import ImageRow
from .backends import Matter
from .config import Settings
from .pipeline import ImageOutcome, load_backdrop, process_image
from .preset import BackgroundPreset
from .storage import mark_queued

log = logging.getLogger("matting.jobs")

# How long a finished job stays readable by GET /v1/jobs/{id}. Long enough for a
# browser that was backgrounded mid-batch to come back and see the result;
# short enough that a long-lived process does not accumulate them.
JOB_TTL_SECONDS = 60 * 60
MAX_JOBS_RETAINED = 500


@dataclass
class JobState:
    job_id: str
    org_id: str
    total: int
    status: str = "running"  # 'running' | 'done'
    done: int = 0
    failed: int = 0
    review: int = 0
    auto: int = 0
    created_at: float = field(default_factory=time.monotonic)
    finished_at: float | None = None

    def to_json(self) -> dict:
        return {
            "jobId": self.job_id,
            "status": self.status,
            "total": self.total,
            "done": self.done,
            "failed": self.failed,
            "review": self.review,
            "auto": self.auto,
        }


class JobRegistry:
    def __init__(self, settings: Settings) -> None:
        self._s = settings
        self._jobs: dict[str, JobState] = {}
        # One lock per org. Created lazily and never removed — an org is a uuid
        # and a founder-scale deployment has tens of them, so the map is not a
        # leak worth managing.
        self._org_locks: dict[str, asyncio.Lock] = {}
        self._tasks: set[asyncio.Task] = set()
        # Image ids this process has set to 'queued' and not yet written a result
        # for. See the module docstring for the two things that read it.
        self._inflight: set[str] = set()

    def inflight_ids(self) -> frozenset[str]:
        return frozenset(self._inflight)

    def _lock_for(self, org_id: str) -> asyncio.Lock:
        lock = self._org_locks.get(org_id)
        if lock is None:
            lock = asyncio.Lock()
            self._org_locks[org_id] = lock
        return lock

    def get(self, job_id: str) -> JobState | None:
        self._evict()
        return self._jobs.get(job_id)

    def _evict(self) -> None:
        now = time.monotonic()
        stale = [
            jid
            for jid, j in self._jobs.items()
            if j.finished_at is not None and (now - j.finished_at) > JOB_TTL_SECONDS
        ]
        for jid in stale:
            self._jobs.pop(jid, None)
        if len(self._jobs) > MAX_JOBS_RETAINED:
            oldest = sorted(self._jobs.values(), key=lambda j: j.created_at)
            for j in oldest[: len(self._jobs) - MAX_JOBS_RETAINED]:
                if j.finished_at is not None:
                    self._jobs.pop(j.job_id, None)

    def submit(
        self,
        *,
        client: httpx.AsyncClient,
        matter: Matter,
        org_id: str,
        rows: list[ImageRow],
        preset: BackgroundPreset,
        want_resolution: int = 1024,
    ) -> JobState:
        job = JobState(job_id=str(uuid.uuid4()), org_id=org_id, total=len(rows))
        self._jobs[job.job_id] = job
        self._evict()
        self._inflight.update(r.id for r in rows)

        task = asyncio.create_task(
            self._run(client, matter, job, rows, preset, want_resolution),
            name=f"matting-job-{job.job_id[:8]}",
        )
        # Hold a reference: asyncio only keeps a weak one, and a garbage-collected
        # task is a job that silently stops halfway.
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)
        return job

    async def _run(
        self,
        client: httpx.AsyncClient,
        matter: Matter,
        job: JobState,
        rows: list[ImageRow],
        preset: BackgroundPreset,
        want_resolution: int,
    ) -> None:
        async with self._lock_for(job.org_id):
            # ONE decode of the backdrop for the whole job, not one per image.
            # A failure here is not fatal to the job: process_image raises
            # BackdropMissing for each row, so every photo gets the same legible
            # flag instead of the job dying silently at image 1.
            backdrop: np.ndarray | None = None
            if preset.backdrop:
                try:
                    backdrop = await load_backdrop(client, self._s, preset)
                except Exception:
                    log.error(
                        "job %s: backdrop %s unavailable — every image will fail",
                        job.job_id[:8],
                        preset.backdrop.storage_path,
                    )

            sem = asyncio.Semaphore(self._s.concurrency)

            async def one(row: ImageRow) -> None:
                async with sem:
                    outcome: ImageOutcome = await process_image(
                        client, self._s, matter, row, preset, want_resolution, backdrop
                    )
                # Discarded only once process_image has RETURNED, i.e. once the row
                # carries a result. A cancelled image (shutdown) never reaches this
                # line, which is exactly what leaves it for requeue_inflight.
                self._inflight.discard(row.id)
                job.done += 1
                if outcome.status == "failed":
                    job.failed += 1
                elif outcome.status == "review":
                    job.review += 1
                else:
                    job.auto += 1

            cancelled = False
            try:
                # gather with return_exceptions: process_image already swallows
                # everything, but a bug in the counting above must not leave the
                # job 'running' forever.
                await asyncio.gather(*(one(r) for r in rows), return_exceptions=True)
            except asyncio.CancelledError:
                cancelled = True
                raise
            finally:
                if not cancelled:
                    # Belt and braces. If the counting above ever threw, an id
                    # left in the set would be skipped by every future submit —
                    # a photo that can never be matted again is worse than one
                    # matted twice, so a job that ran to completion clears its own.
                    for r in rows:
                        self._inflight.discard(r.id)
                job.status = "done"
                job.finished_at = time.monotonic()
                log.info(
                    "job %s finished: %d auto, %d review, %d failed of %d",
                    job.job_id[:8],
                    job.auto,
                    job.review,
                    job.failed,
                    job.total,
                )

    async def drain(self, timeout: float = 30.0) -> None:
        """Let in-flight images finish on shutdown.

        A SIGTERM mid-image otherwise leaves a row 'queued' with a cutout
        already uploaded and no row pointing at it — recoverable (resubmit) but
        it leaks a file. Fly sends SIGTERM and waits, so a short drain converts
        most of those into clean completions.
        """
        if not self._tasks:
            return
        _, pending = await asyncio.wait(set(self._tasks), timeout=timeout)
        for t in pending:
            t.cancel()

    async def requeue_inflight(
        self, client: httpx.AsyncClient, settings: Settings
    ) -> list[str]:
        """Write every photo this process still holds back to 'queued'.

        WHY THIS EXISTS EVEN THOUGH THE ROWS ARE ALREADY 'queued'. mark_queued
        runs before any work starts, so on a clean SIGTERM the unfinished rows are
        queued already and this is a no-op. It is here for the two cases where
        that reasoning is a coincidence rather than a guarantee: a photo cancelled
        by `drain` after step 6 has FAILED but before its result landed, and any
        future code path that moves a row out of 'queued' mid-flight. The cost is
        one chunked PATCH on shutdown; the failure it prevents is a photo that is
        permanently "in flight" behind a process that no longer exists.

        Fly's trial makes this the normal path, not the exceptional one: every
        machine is stopped after five minutes, so a 400-photo batch WILL be
        interrupted. Afterwards the founder presses the button again and the
        remaining rows are picked straight back up (pipeline.already_done).

        Never raises — a failed requeue must not stop the process from exiting.
        """
        ids = sorted(self._inflight)
        if not ids:
            return []
        try:
            written = await mark_queued(client, settings, ids)
            log.warning(
                "shutdown: %d image(s) were still in flight and have been left "
                "'queued' for resubmission (%d row(s) written): %s",
                len(ids),
                written,
                ", ".join(ids[:20]) + (" …" if len(ids) > 20 else ""),
            )
        except Exception as exc:
            log.error("shutdown: could not requeue %d in-flight image(s): %s", len(ids), exc)
        return ids
