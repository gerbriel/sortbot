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
"""

from __future__ import annotations

import asyncio
import logging
import time
import uuid
from dataclasses import dataclass, field

import httpx

from .auth import ImageRow
from .backends import Matter
from .config import Settings
from .pipeline import ImageOutcome, process_image
from .preset import BackgroundPreset

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
            sem = asyncio.Semaphore(self._s.concurrency)

            async def one(row: ImageRow) -> None:
                async with sem:
                    outcome: ImageOutcome = await process_image(
                        client, self._s, matter, row, preset, want_resolution
                    )
                job.done += 1
                if outcome.status == "failed":
                    job.failed += 1
                elif outcome.status == "review":
                    job.review += 1
                else:
                    job.auto += 1

            try:
                # gather with return_exceptions: process_image already swallows
                # everything, but a bug in the counting above must not leave the
                # job 'running' forever.
                await asyncio.gather(*(one(r) for r in rows), return_exceptions=True)
            finally:
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
