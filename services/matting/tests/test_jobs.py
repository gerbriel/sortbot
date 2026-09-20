"""Never strand a photo as "in flight".

This file is the statement of what the first production run made necessary. The
founder's machines are on a Fly TRIAL, which stops every machine after five
minutes, so "the process went away in the middle of a batch" is the NORMAL case
here and not an exotic one. Three things have to hold for that to be survivable:

  1. A `queued` row is re-accepted by the next submit (tests/test_pipeline.py) —
     unless this process is the one holding it, which is what `inflight_ids()`
     answers and what stops a second submit doubling the Replicate bill.
  2. On shutdown, whatever did not finish is written back to `queued`, with a log
     line naming it, so the founder knows what to resubmit.
  3. A photo that wedges between two inner timeouts fails with a legible flag
     instead of holding a worker slot until the machine dies.

Nothing here touches the network: Supabase is an `httpx.MockTransport` that
records every PATCH, and the matter is a local stub.
"""

from __future__ import annotations

import asyncio
import dataclasses
import json

import httpx
import numpy as np
import pytest

from app.auth import ImageRow
from app.jobs import JobRegistry
from app.pipeline import process_image
from app.preset import BackgroundPreset
from tests.conftest import flat_rgb, gradient_rgb, png_bytes, solid_alpha

SOURCE_PNG = png_bytes(flat_rgb(64, 64, (30, 60, 90)))
BACKDROP_PATH = "u1/backdrops/1700000000000-linen.jpg"


def image_row(n: int) -> ImageRow:
    return ImageRow(
        id=f"img-{n}",
        product_id="prod-1",
        storage_path=f"user/prod/photo-{n}.jpg",
        image_url=f"https://cdn/photo-{n}.jpg",
        org_id="org-1",
        cutout_storage_path=None,
        composite_storage_path=None,
        bg_preset=None,
        mask_status="queued",
        mask_model=None,
    )


class Recorder:
    """A Supabase stand-in that answers the four calls the pipeline makes."""

    def __init__(self, *, backdrop_status: int = 200, backdrop: bytes | None = None) -> None:
        self.patches: list[tuple[str, dict]] = []
        self.gets: list[str] = []
        self.backdrop_status = backdrop_status
        self.backdrop = backdrop if backdrop is not None else png_bytes(gradient_rgb(300, 500))

    def transport(self) -> httpx.MockTransport:
        def handler(request: httpx.Request) -> httpx.Response:
            url = str(request.url)

            if request.method == "GET" and "/storage/v1/object/" in url:
                self.gets.append(url)
                if BACKDROP_PATH in url:
                    if self.backdrop_status != 200:
                        return httpx.Response(self.backdrop_status, text="not found")
                    return httpx.Response(200, content=self.backdrop)
                return httpx.Response(200, content=SOURCE_PNG)

            if request.method == "POST" and "/storage/v1/object/" in url:
                return httpx.Response(201, json={"Key": "ok"})

            if request.method == "PATCH" and "/product_images" in url:
                body = json.loads(request.content or b"{}")
                ids = str(request.url.params.get("id", ""))
                self.patches.append((ids, body))
                return httpx.Response(200, json=[{"id": "img-1"}])

            if request.method == "GET" and "/product_images" in url:
                return httpx.Response(200, json=[])

            raise AssertionError(f"unexpected request: {request.method} {url}")

        return httpx.MockTransport(handler)

    def statuses(self) -> list[str]:
        return [b.get("mask_status") for _, b in self.patches if "mask_status" in b]

    def flags(self) -> list[str]:
        out: list[str] = []
        for _, body in self.patches:
            for flag in body.get("mask_flags") or []:
                out.append(flag)
        return out


class FakeMatter:
    """A backend that produces a usable alpha without a model or a network."""

    tag = "fake:matter@1"

    def __init__(self, *, gate: asyncio.Event | None = None, hang: bool = False) -> None:
        self._gate = gate
        self._hang = hang
        self.calls = 0

    async def mat(self, image_bytes: bytes, want_resolution: int) -> np.ndarray:
        self.calls += 1
        if self._hang:
            await asyncio.Event().wait()  # never returns
        if self._gate is not None:
            await self._gate.wait()
        return solid_alpha(64, 64, (16, 16, 48, 48))


@pytest.fixture
def job_settings(settings):
    return dataclasses.replace(settings, concurrency=2, image_timeout_seconds=30.0)


# ── the in-flight set ───────────────────────────────────────────────────────


async def test_the_rows_are_held_until_each_one_has_a_result(job_settings):
    gate = asyncio.Event()
    rec = Recorder()
    registry = JobRegistry(job_settings)

    async with httpx.AsyncClient(transport=rec.transport()) as client:
        rows = [image_row(1), image_row(2)]
        job = registry.submit(
            client=client,
            matter=FakeMatter(gate=gate),
            org_id="org-1",
            rows=rows,
            preset=BackgroundPreset.parse({"canvas": 256}),
        )
        await asyncio.sleep(0)
        assert registry.inflight_ids() == {"img-1", "img-2"}

        gate.set()
        await registry.drain(timeout=5.0)

    assert job.status == "done"
    assert registry.inflight_ids() == frozenset()


async def test_a_job_that_ran_to_completion_holds_nothing(job_settings):
    """The belt-and-braces clear. An id left behind would be skipped by every
    future submit — a photo that can never be matted again is worse than one
    matted twice."""
    rec = Recorder()
    registry = JobRegistry(job_settings)
    async with httpx.AsyncClient(transport=rec.transport()) as client:
        registry.submit(
            client=client,
            matter=FakeMatter(),
            org_id="org-1",
            rows=[image_row(i) for i in range(1, 4)],
            preset=BackgroundPreset.parse({"canvas": 256}),
        )
        await registry.drain(timeout=5.0)
    assert registry.inflight_ids() == frozenset()
    assert rec.statuses().count("auto") + rec.statuses().count("review") == 3


# ── the shutdown requeue ────────────────────────────────────────────────────


async def test_shutdown_writes_the_unfinished_rows_back_to_queued(job_settings):
    """The cancelled image never reaches the per-image discard, which is exactly
    what leaves it here to be requeued."""
    rec = Recorder()
    registry = JobRegistry(job_settings)

    async with httpx.AsyncClient(transport=rec.transport()) as client:
        registry.submit(
            client=client,
            matter=FakeMatter(hang=True),
            org_id="org-1",
            rows=[image_row(1), image_row(2)],
            preset=BackgroundPreset.parse({"canvas": 256}),
        )
        await asyncio.sleep(0)
        # The drain gives up and cancels, exactly as it does on SIGTERM.
        await registry.drain(timeout=0.05)
        requeued = await registry.requeue_inflight(client, job_settings)

    assert set(requeued) == {"img-1", "img-2"}
    assert rec.statuses()[-1] == "queued"
    # And nothing claimed a result for them.
    assert "auto" not in rec.statuses()
    assert "failed" not in rec.statuses()


async def test_shutdown_requeues_nothing_when_nothing_is_in_flight(job_settings):
    rec = Recorder()
    registry = JobRegistry(job_settings)
    async with httpx.AsyncClient(transport=rec.transport()) as client:
        assert await registry.requeue_inflight(client, job_settings) == []
    assert rec.patches == []


async def test_a_failed_requeue_never_stops_the_process_exiting(job_settings):
    """Shutdown is the worst possible moment to raise: the container is going away
    either way, and an exception here would lose the log line that says which
    photos to resubmit."""

    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("supabase unreachable")

    registry = JobRegistry(job_settings)
    registry._inflight.add("img-9")
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        assert await registry.requeue_inflight(client, job_settings) == ["img-9"]


# ── the per-job backdrop ────────────────────────────────────────────────────


async def test_the_backdrop_is_fetched_once_per_job_not_once_per_image(job_settings):
    """A 2048px backdrop is a download, a JPEG decode and a LANCZOS resample. Four
    hundred of those for one batch would cost more than the compositing they feed."""
    rec = Recorder()
    registry = JobRegistry(job_settings)
    preset = BackgroundPreset.parse({"canvas": 256, "backdrop": BACKDROP_PATH})

    async with httpx.AsyncClient(transport=rec.transport()) as client:
        registry.submit(
            client=client,
            matter=FakeMatter(),
            org_id="org-1",
            rows=[image_row(i) for i in range(1, 6)],
            preset=preset,
        )
        await registry.drain(timeout=5.0)

    backdrop_gets = [u for u in rec.gets if BACKDROP_PATH in u]
    assert len(backdrop_gets) == 1
    assert len([u for u in rec.gets if "photo-" in u]) == 5
    assert rec.statuses().count("failed") == 0


async def test_a_missing_backdrop_fails_every_row_and_never_falls_back_to_the_colour(
    job_settings,
):
    """THE FAILURE THIS DESIGN EXISTS TO PREVENT is half a catalogue on linen and
    half on white. So a backdrop that cannot be fetched fails the photos — it does
    not quietly render them on the flat colour and report success."""
    rec = Recorder(backdrop_status=404)
    registry = JobRegistry(job_settings)
    preset = BackgroundPreset.parse({"canvas": 256, "backdrop": BACKDROP_PATH})

    async with httpx.AsyncClient(transport=rec.transport()) as client:
        registry.submit(
            client=client,
            matter=FakeMatter(),
            org_id="org-1",
            rows=[image_row(1), image_row(2)],
            preset=preset,
        )
        await registry.drain(timeout=5.0)

    assert rec.statuses() == ["failed", "failed"]
    assert rec.flags() == ["error:backdrop missing", "error:backdrop missing"]
    # No composite was uploaded and no row claims one.
    assert all("composite_storage_path" not in body for _, body in rec.patches)


async def test_an_undecodable_backdrop_is_also_backdrop_missing(job_settings):
    """A 200 that is not an image is the same outcome as a 404 — the distinction
    would be a second flag for one condition a reviewer cannot act on differently."""
    rec = Recorder(backdrop=b"this is not an image")
    registry = JobRegistry(job_settings)

    async with httpx.AsyncClient(transport=rec.transport()) as client:
        registry.submit(
            client=client,
            matter=FakeMatter(),
            org_id="org-1",
            rows=[image_row(1)],
            preset=BackgroundPreset.parse({"canvas": 256, "backdrop": BACKDROP_PATH}),
        )
        await registry.drain(timeout=5.0)

    assert rec.flags() == ["error:backdrop missing"]


async def test_a_backdrop_job_composites_and_commits_like_any_other(job_settings):
    rec = Recorder()
    registry = JobRegistry(job_settings)
    preset = BackgroundPreset.parse({"canvas": 256, "backdrop": BACKDROP_PATH})

    async with httpx.AsyncClient(transport=rec.transport()) as client:
        registry.submit(
            client=client,
            matter=FakeMatter(),
            org_id="org-1",
            rows=[image_row(1)],
            preset=preset,
        )
        await registry.drain(timeout=5.0)

    committed = [b for _, b in rec.patches if "composite_storage_path" in b]
    assert len(committed) == 1
    assert committed[0]["bg_preset"] == preset.hash
    assert committed[0]["composite_storage_path"].endswith(".jpg")
    assert f"bg-{preset.hash}-" in committed[0]["composite_storage_path"]


# ── the per-image timeout ───────────────────────────────────────────────────


async def test_an_image_that_hangs_fails_with_a_timeout_flag(job_settings):
    """Every inner call has its own timeout; a photo can still wedge BETWEEN them,
    and a wedged photo holds a worker slot while its row says 'queued' — which
    reads exactly like "the feature stopped working"."""
    rec = Recorder()
    one_second = dataclasses.replace(job_settings, image_timeout_seconds=1.0)

    async with httpx.AsyncClient(transport=rec.transport()) as client:
        outcome = await process_image(
            client,
            one_second,
            FakeMatter(hang=True),
            image_row(1),
            BackgroundPreset.parse({"canvas": 256}),
        )

    assert outcome.status == "failed"
    assert outcome.flags == ["error:timeout after 1s"]
    assert rec.statuses() == ["failed"]


async def test_the_timeout_does_not_mislabel_an_inner_deadline(job_settings):
    """The Replicate poll deadline raises TimeoutError too. Reporting it as
    "timeout after 180s" would hide WHICH clock ran out, so `expired()` — not the
    exception type — is what decides."""
    rec = Recorder()

    class DeadlineMatter(FakeMatter):
        async def mat(self, image_bytes: bytes, want_resolution: int) -> np.ndarray:
            raise TimeoutError("replicate: prediction did not finish within 180s")

    async with httpx.AsyncClient(transport=rec.transport()) as client:
        outcome = await process_image(
            client,
            job_settings,
            DeadlineMatter(),
            image_row(1),
            BackgroundPreset.parse({"canvas": 256}),
        )

    assert outcome.status == "failed"
    assert outcome.flags == ["error:TimeoutError: replicate: prediction did not finish within 180s"]


async def test_a_cancelled_image_is_not_turned_into_a_failed_row(job_settings):
    """On shutdown the row must stay 'queued' so it is resubmittable — converting
    cancellation into a failure would hand the founder a review queue full of
    photos that were never actually attempted."""
    rec = Recorder()
    async with httpx.AsyncClient(transport=rec.transport()) as client:
        task = asyncio.create_task(
            process_image(
                client,
                job_settings,
                FakeMatter(hang=True),
                image_row(1),
                BackgroundPreset.parse({"canvas": 256}),
            )
        )
        await asyncio.sleep(0)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

    assert rec.statuses() == []


async def test_a_long_running_image_inside_the_budget_still_succeeds(job_settings):
    """The deadline is a backstop, not a throttle."""
    rec = Recorder()
    gate = asyncio.Event()
    generous = dataclasses.replace(job_settings, image_timeout_seconds=30.0)

    async with httpx.AsyncClient(transport=rec.transport()) as client:
        task = asyncio.create_task(
            process_image(
                client,
                generous,
                FakeMatter(gate=gate),
                image_row(1),
                BackgroundPreset.parse({"canvas": 256}),
            )
        )
        await asyncio.sleep(0.02)
        gate.set()
        outcome = await task

    assert outcome.status in ("auto", "review")
    assert "failed" not in rec.statuses()
