"""POST /v1/embed — the boundary, the skip report, and what it must NOT write.

THE BOUNDARY IS THE SAME ONE /v1/jobs USES, and that is the single most important
thing in this file. An embedding is a searchable fingerprint of somebody's
inventory; if this endpoint had its own, looser rule, it would be a second
boundary to keep in step with the first, and the tests in test_auth.py would stop
being the whole story. So every refusal case is re-asserted here through the real
HTTP surface: the status codes, not just the exception types.

THE OTHER THING THIS FILE PINS is what the endpoint does not touch. `mask_status`,
`mask_model`, `bg_preset` and the two derived paths belong to the matting feature.
Borrowing `mask_status = 'queued'` to mean "embedding in flight" would put photos
into the review queue that no reviewer can do anything about, and it would make
"Process photos" skip them.

Driven through httpx.ASGITransport, which runs the app WITHOUT its lifespan — so
`app.state` is populated by hand here. That is deliberate: the real lifespan builds
a live httpx client and a Replicate backend, and a test that needs those is a test
that can reach the network.
"""

from __future__ import annotations

import asyncio
import json

import httpx
import numpy as np
import pytest

from app import config as config_module
from app.auth import ImageRow
from app.jobs import JobRegistry
from app.main import app
from app.pipeline import accepted_rows
from tests.conftest import flat_rgb, png_bytes

TAG = "clip-vit-base-patch32@onnx"
OWNER = "11111111-1111-1111-1111-111111111111"
OUTSIDER = "33333333-3333-3333-3333-333333333333"
ORG_A = "aaaa0000-0000-0000-0000-00000000aaaa"
ORG_B = "bbbb0000-0000-0000-0000-00000000bbbb"
GROUP = "cccc0000-0000-0000-0000-0000000000c1"
SOURCE_PNG = png_bytes(flat_rgb(64, 64, (30, 60, 90)))


class FakeEmbedder:
    """512 floats and a call log. `fail_on_call` makes exactly one photo blow up.

    Keyed on the call NUMBER rather than the photo id, because with
    EMBED_CONCURRENCY = 2 the order two photos reach the model in is not
    deterministic — but "exactly one of them failed" is.
    """

    def __init__(self, tag: str = TAG, fail_on_call: int | None = None) -> None:
        self.tag = tag
        self.calls = 0
        self.fail_on_call = fail_on_call

    async def embed(self, rgb: np.ndarray) -> np.ndarray:  # noqa: ARG002
        self.calls += 1
        if self.fail_on_call is not None and self.calls == self.fail_on_call:
            from app.embed import EmbedError

            raise EmbedError("the model is not downloaded yet")
        v = np.zeros(512, dtype=np.float32)
        v[self.calls % 512] = 1.0
        return v


class Supabase:
    """The five calls this endpoint's path makes, all recorded."""

    def __init__(
        self,
        *,
        user: dict | None = None,
        user_status: int = 200,
        memberships: list[dict] | None = None,
        rows: list[dict] | None = None,
        existing: list[dict] | None = None,
        existing_status: int = 200,
        products: list[dict] | None = None,
        upsert_status: int = 201,
    ) -> None:
        self.user = user
        self.user_status = user_status
        self.memberships = memberships or []
        self.rows = rows or []
        self.existing = existing or []
        self.existing_status = existing_status
        self.products = products or []
        self.upsert_status = upsert_status
        self.requests: list[httpx.Request] = []
        self.upserted: list[dict] = []

    def client(self) -> httpx.AsyncClient:
        def handler(request: httpx.Request) -> httpx.Response:
            self.requests.append(request)
            path = request.url.path
            if path.endswith("/auth/v1/user"):
                return httpx.Response(self.user_status, json=self.user if self.user else {})
            if path.endswith("/rest/v1/org_members"):
                return httpx.Response(200, json=self.memberships)
            if path.endswith("/rest/v1/product_images"):
                return httpx.Response(200, json=self.rows)
            if request.method == "GET" and path.endswith("/rest/v1/listing_embeddings"):
                return httpx.Response(self.existing_status, json=self.existing)
            if request.method == "POST" and path.endswith("/rest/v1/listing_embeddings"):
                sent = json.loads(request.content or b"[]")
                self.upserted.extend(sent)
                return httpx.Response(self.upsert_status, json=sent)
            if path.endswith("/rest/v1/products"):
                return httpx.Response(200, json=self.products)
            if "/storage/v1/object/" in path:
                return httpx.Response(200, content=SOURCE_PNG)
            raise AssertionError(f"unexpected request: {request.method} {request.url}")

        return httpx.AsyncClient(transport=httpx.MockTransport(handler), follow_redirects=True)

    def methods_for(self, table: str) -> list[str]:
        return [r.method for r in self.requests if r.url.path.endswith(f"/rest/v1/{table}")]


def image_row(image_id: str, org_id: str = ORG_A, product_id: str = "prod-1") -> dict:
    return {
        "id": image_id,
        "product_id": product_id,
        "storage_path": f"u/p/{image_id}.jpg",
        "image_url": None,
        "cutout_storage_path": None,
        "composite_storage_path": None,
        "bg_preset": None,
        "mask_status": None,
        "mask_model": None,
        "products": {"org_id": org_id},
    }


@pytest.fixture
def wired(settings, monkeypatch):
    """app.state populated by hand, and get_settings() pinned to the fixture."""
    monkeypatch.setattr(config_module, "_settings", settings, raising=False)

    def wire(sb: Supabase, embedder: FakeEmbedder | None = None) -> tuple[httpx.AsyncClient, JobRegistry, FakeEmbedder]:
        client = sb.client()
        registry = JobRegistry(settings)
        emb = embedder or FakeEmbedder()
        app.state.settings = settings
        app.state.client = client
        app.state.jobs = registry
        app.state.embedder = emb
        app.state.matter = None
        app.state.model_task = None
        return client, registry, emb

    return wire


async def post_embed(body: dict, token: str | None = "good") -> httpx.Response:
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://svc"
    ) as http:
        return await http.post("/v1/embed", json=body, headers=headers)


async def drain(registry: JobRegistry) -> None:
    """Let the submitted job finish. The endpoint returns 202 before it runs."""
    for _ in range(50):
        tasks = [t for t in registry._tasks if not t.done()]  # noqa: SLF001
        if not tasks:
            return
        await asyncio.gather(*tasks, return_exceptions=True)


# ── the boundary ────────────────────────────────────────────────────────────


async def test_no_authorization_header_is_401(wired):
    sb = Supabase()
    client, _, _ = wired(sb)
    async with client:
        resp = await post_embed({"productImageIds": ["img-1"]}, token=None)
    assert resp.status_code == 401
    assert sb.requests == []  # refused before any read


async def test_the_anon_key_is_401_because_it_identifies_no_user(wired):
    """THE TRAP AGENTS.md §9 names: the anon key is a validly signed project JWT
    printed in the browser bundle. /auth/v1/user answers 200 with no user id."""
    sb = Supabase(user={"aud": "authenticated", "role": "anon"})
    client, _, _ = wired(sb)
    async with client:
        resp = await post_embed({"productImageIds": ["img-1"]})
    assert resp.status_code == 401


async def test_a_row_in_another_workspace_is_403(wired):
    sb = Supabase(
        user={"id": OUTSIDER},
        memberships=[{"org_id": ORG_B}],
        rows=[image_row("img-1", org_id=ORG_A)],
    )
    client, _, emb = wired(sb)
    async with client:
        resp = await post_embed({"productImageIds": ["img-1"]})
    assert resp.status_code == 403
    assert emb.calls == 0


async def test_one_foreign_id_among_many_refuses_the_WHOLE_request(wired):
    """A partial success is indistinguishable from a success, so a bug that sent
    the wrong ids would read as 'embedding sometimes skips photos' for months."""
    sb = Supabase(
        user={"id": OWNER},
        memberships=[{"org_id": ORG_A}],
        rows=[image_row("img-1", ORG_A), image_row("img-2", ORG_B)],
    )
    client, _, _ = wired(sb)
    async with client:
        resp = await post_embed({"productImageIds": ["img-1", "img-2"]})
    assert resp.status_code == 403


async def test_an_id_that_does_not_exist_is_403_and_not_404(wired):
    sb = Supabase(user={"id": OWNER}, memberships=[{"org_id": ORG_A}], rows=[])
    client, _, _ = wired(sb)
    async with client:
        resp = await post_embed({"productImageIds": ["img-1"]})
    assert resp.status_code == 403


async def test_an_empty_id_list_is_403(wired):
    sb = Supabase(user={"id": OWNER}, memberships=[{"org_id": ORG_A}])
    client, _, _ = wired(sb)
    async with client:
        resp = await post_embed({"productImageIds": []})
    assert resp.status_code == 403


async def test_too_many_ids_is_422(wired, settings):
    sb = Supabase(user={"id": OWNER}, memberships=[{"org_id": ORG_A}])
    client, _, _ = wired(sb)
    ids = [f"img-{i}" for i in range(settings.max_ids_per_job + 1)]
    async with client:
        resp = await post_embed({"productImageIds": ids})
    assert resp.status_code == 422


async def test_a_job_may_not_span_two_workspaces_even_with_permission_on_both(wired):
    sb = Supabase(
        user={"id": OWNER},
        memberships=[{"org_id": ORG_A}, {"org_id": ORG_B}],
        rows=[image_row("img-1", ORG_A), image_row("img-2", ORG_B)],
    )
    client, _, _ = wired(sb)
    async with client:
        resp = await post_embed({"productImageIds": ["img-1", "img-2"]})
    assert resp.status_code == 403


# ── the 202 shape and the skip report ───────────────────────────────────────


def happy(**over) -> Supabase:
    kwargs: dict = {
        "user": {"id": OWNER},
        "memberships": [{"org_id": ORG_A}],
        "rows": [image_row("img-1"), image_row("img-2")],
        "products": [{"id": "prod-1", "product_group": GROUP}],
    }
    kwargs.update(over)
    return Supabase(**kwargs)


async def test_a_submit_returns_202_with_the_job_id_and_the_counts(wired):
    sb = happy()
    client, registry, _ = wired(sb)
    async with client:
        resp = await post_embed({"productImageIds": ["img-1", "img-2"]})
        assert resp.status_code == 202
        body = resp.json()
        assert set(body) == {"jobId", "accepted", "skipped"}
        assert body["accepted"] == 2
        assert body["skipped"] == 0
        assert body["jobId"]
        await drain(registry)


async def test_a_photo_already_embedded_with_this_model_is_reported_as_skipped(wired):
    sb = happy(existing=[{"product_image_id": "img-1", "model": TAG}])
    client, registry, emb = wired(sb)
    async with client:
        resp = await post_embed({"productImageIds": ["img-1", "img-2"]})
        await drain(registry)
    assert resp.json()["accepted"] == 1
    assert resp.json()["skipped"] == 1
    assert emb.calls == 1


async def test_force_re_embeds_an_already_embedded_photo(wired):
    sb = happy(existing=[{"product_image_id": "img-1", "model": TAG}])
    client, registry, emb = wired(sb)
    async with client:
        resp = await post_embed({"productImageIds": ["img-1", "img-2"], "force": True})
        await drain(registry)
    assert resp.json() == {"jobId": resp.json()["jobId"], "accepted": 2, "skipped": 0}
    assert emb.calls == 2


async def test_nothing_to_do_is_a_SUCCESS_with_an_empty_job_id(wired):
    """The app renders this as "already up to date", exactly as it does for
    POST /v1/jobs. An error here would make a no-op button look broken."""
    sb = happy(
        existing=[
            {"product_image_id": "img-1", "model": TAG},
            {"product_image_id": "img-2", "model": TAG},
        ]
    )
    client, _, emb = wired(sb)
    async with client:
        resp = await post_embed({"productImageIds": ["img-1", "img-2"]})
    assert resp.status_code == 202
    assert resp.json() == {"jobId": "", "accepted": 0, "skipped": 2}
    assert emb.calls == 0


async def test_duplicate_ids_in_the_request_are_collapsed(wired):
    sb = happy()
    client, registry, emb = wired(sb)
    async with client:
        resp = await post_embed({"productImageIds": ["img-1", "img-1", "img-2"]})
        await drain(registry)
    assert resp.json()["accepted"] == 2
    assert emb.calls == 2


async def test_a_missing_listing_embeddings_table_is_503_not_500(wired):
    """The pre-migration case. The client detects it for itself with a column
    probe, so the body here stays generic and the reason stays in the log."""
    sb = happy(existing_status=404)
    client, _, _ = wired(sb)
    async with client:
        resp = await post_embed({"productImageIds": ["img-1"]})
    assert resp.status_code == 503
    assert "listing_embeddings.sql" not in resp.text


# ── what it writes, and what it must not ────────────────────────────────────


async def test_it_writes_one_row_per_photo_with_the_group_and_the_model(wired):
    sb = happy()
    client, registry, _ = wired(sb)
    async with client:
        await post_embed({"productImageIds": ["img-1", "img-2"]})
        await drain(registry)
    assert len(sb.upserted) == 2
    for written in sb.upserted:
        assert written["org_id"] == ORG_A
        assert written["product_group_id"] == GROUP
        assert written["model"] == TAG
        assert written["embedding"].startswith("[") and written["embedding"].endswith("]")
        assert len(written["embedding"][1:-1].split(",")) == 512
    assert {w["product_image_id"] for w in sb.upserted} == {"img-1", "img-2"}


async def test_product_images_is_only_ever_READ_never_written(wired):
    """No mark_queued, no mask_status. Those columns belong to the matting
    feature, and borrowing one would put photos into a review queue that no
    reviewer can act on."""
    sb = happy()
    client, registry, _ = wired(sb)
    async with client:
        await post_embed({"productImageIds": ["img-1", "img-2"]})
        await drain(registry)
    assert set(sb.methods_for("product_images")) == {"GET"}


async def test_the_group_is_read_once_for_the_whole_job(wired):
    sb = happy(rows=[image_row(f"img-{i}") for i in range(1, 6)])
    client, registry, _ = wired(sb)
    async with client:
        await post_embed({"productImageIds": [f"img-{i}" for i in range(1, 6)]})
        await drain(registry)
    assert sb.methods_for("products") == ["GET"]


async def test_a_photo_whose_product_has_no_group_writes_a_null_group(wired):
    sb = happy(products=[{"id": "prod-1", "product_group": None}])
    client, registry, _ = wired(sb)
    async with client:
        await post_embed({"productImageIds": ["img-1"]})
        await drain(registry)
    assert sb.upserted[0]["product_group_id"] is None


async def test_a_failed_photo_writes_NO_ROW_and_does_not_fail_the_job(wired):
    """Not a zero vector, not a NULL embedding — nothing. A zero vector would sit
    at the bottom of every neighbour list forever and look like a result."""
    sb = happy(rows=[image_row("img-1"), image_row("img-2")])
    client, registry, _ = wired(sb, FakeEmbedder(fail_on_call=1))
    async with client:
        resp = await post_embed({"productImageIds": ["img-1", "img-2"]})
        job_id = resp.json()["jobId"]
        await drain(registry)
    job = registry.get(job_id)
    assert job is not None
    assert job.status == "done"
    assert job.done == 2
    assert job.failed == 1
    assert job.auto == 1
    # The surviving photo IS written — one bad JPEG must not cost the other 399.
    assert len(sb.upserted) == 1


async def test_the_job_status_endpoint_reports_the_embed_job(wired):
    sb = happy()
    client, registry, _ = wired(sb)
    async with client:
        resp = await post_embed({"productImageIds": ["img-1", "img-2"]})
        job_id = resp.json()["jobId"]
        await drain(registry)
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://svc"
        ) as http:
            status = await http.get(
                f"/v1/jobs/{job_id}", headers={"Authorization": "Bearer good"}
            )
    assert status.status_code == 200
    body = status.json()
    # The matting shape, so one browser parser covers both: an embedded photo
    # counts as `auto` (it needed nobody) and `review` stays 0.
    assert body["total"] == 2
    assert body["auto"] == 2
    assert body["failed"] == 0
    assert body["review"] == 0
    assert body["status"] == "done"


# ── the two in-flight sets are separate, and that is load-bearing ───────────


async def test_an_embed_job_in_flight_does_NOT_make_a_matting_submit_skip_photos(wired):
    """If the two jobs shared one in-flight set, pressing "Process photos" while
    embeddings were running would silently skip every photo the embed job held —
    and `already_done` could never catch it afterwards."""
    sb = happy()
    client, registry, _ = wired(sb)
    async with client:
        await post_embed({"productImageIds": ["img-1", "img-2"]})
        # Mid-job: the embed set is populated, the matting set is not.
        embed_held = registry.embed_inflight_ids()
        matting_held = registry.inflight_ids()
        rows = [
            ImageRow(
                id="img-1", product_id="prod-1", storage_path="u/p/1.jpg", image_url=None,
                org_id=ORG_A, cutout_storage_path=None, composite_storage_path=None,
                bg_preset=None, mask_status=None, mask_model=None,
            )
        ]
        taken = accepted_rows(
            rows, matter_tag="m", preset_hash="h", force=False, inflight=matting_held
        )
        await drain(registry)
    assert embed_held  # it really was holding them
    assert matting_held == frozenset()
    assert [r.id for r in taken] == ["img-1"]


async def test_the_embed_in_flight_set_is_empty_again_once_the_job_finishes(wired):
    sb = happy()
    client, registry, _ = wired(sb)
    async with client:
        await post_embed({"productImageIds": ["img-1", "img-2"]})
        await drain(registry)
    assert registry.embed_inflight_ids() == frozenset()


# ── /healthz ────────────────────────────────────────────────────────────────


async def test_healthz_names_the_embedding_model_and_whether_it_is_ready(wired, settings):
    sb = happy()
    client, _, _ = wired(sb)
    async with client:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://svc"
        ) as http:
            resp = await http.get("/healthz")
    body = resp.json()
    assert body["embedModel"] == settings.embed_tag
    # False here because the fixture's MODEL_CACHE_DIR holds no weights — which is
    # the honest answer during a cold start, and what a settings screen should show
    # rather than "broken".
    assert body["embedReady"] is False
    assert body["ok"] is True
