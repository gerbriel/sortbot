"""The `listing_embeddings` reader, the skip rule, and the writer.

Three things here are worth a test rather than a read-through.

THE SKIP RULE decides whether pressing "Find similar" on a 400-photo batch is
free or is 400 forward passes. It also decides what happens when the model
changes, which is the one operation this table has no migration for.

THE READ FAILS LOUD. `fetch_existing_models` raising instead of returning {} is
the difference between "one SELECT 500'd" and "re-embed the entire catalogue".

THE WRITE CHUNKS BY BODY SIZE, not by URL length, and 0 rows written is a
failure. Both are lessons the app learned the expensive way (AGENTS.md §11 and
§18 #41), and the shapes are asserted here so a refactor cannot quietly undo them.

Nothing touches the network: Supabase is an httpx.MockTransport that records
every request.
"""

from __future__ import annotations

import json

import httpx
import pytest

from app.auth import ImageRow
from app.embed_store import (
    EMBED_ROW_CHUNK,
    EmbedStoreError,
    accepted_embed_rows,
    as_uuid,
    build_embedding_row,
    fetch_existing_models,
    fetch_group_map,
    upsert_embeddings,
)

TAG = "clip-vit-base-patch32@onnx"
ORG = "aaaa0000-0000-0000-0000-00000000aaaa"
GROUP = "cccc0000-0000-0000-0000-0000000000c1"


def row(n: int, product_id: str | None = "prod-1") -> ImageRow:
    return ImageRow(
        id=f"img-{n}",
        product_id=product_id,
        storage_path=f"u/p/{n}.jpg",
        image_url=None,
        org_id=ORG,
        cutout_storage_path=None,
        composite_storage_path=None,
        bg_preset=None,
        mask_status=None,
        mask_model=None,
    )


class Recorder:
    """Answers the three calls this module makes, and records every request."""

    def __init__(self) -> None:
        self.requests: list[httpx.Request] = []
        self.existing: list[dict] = []
        self.products: list[dict] = []
        self.existing_status = 200
        self.products_status = 200
        self.upsert_status = 201
        self.upsert_returns: list[dict] | None = None

    def client(self) -> httpx.AsyncClient:
        def handler(request: httpx.Request) -> httpx.Response:
            self.requests.append(request)
            path = request.url.path
            if request.method == "GET" and path.endswith("/listing_embeddings"):
                return httpx.Response(self.existing_status, json=self.existing)
            if request.method == "GET" and path.endswith("/products"):
                return httpx.Response(self.products_status, json=self.products)
            if request.method == "POST" and path.endswith("/listing_embeddings"):
                sent = json.loads(request.content or b"[]")
                body = self.upsert_returns if self.upsert_returns is not None else sent
                return httpx.Response(self.upsert_status, json=body)
            raise AssertionError(f"unexpected request: {request.method} {request.url}")

        return httpx.AsyncClient(transport=httpx.MockTransport(handler))

    def posts(self) -> list[httpx.Request]:
        return [r for r in self.requests if r.method == "POST"]


# ── as_uuid ─────────────────────────────────────────────────────────────────


def test_a_real_uuid_passes_through_normalised():
    assert as_uuid(GROUP) == GROUP
    assert as_uuid(f"  {GROUP.upper()}  ") == GROUP


@pytest.mark.parametrize("value", [None, "", "   ", "not-a-uuid", 12, {}, "img-1"])
def test_anything_that_is_not_a_uuid_becomes_none(value):
    """`products.product_group` is a TEXT column. One unparseable value would
    otherwise fail the whole 50-row chunk it shared a request with, taking 49
    good photos down with it — and a group we cannot read IS a listing of one."""
    assert as_uuid(value) is None


# ── the skip rule ───────────────────────────────────────────────────────────


def test_a_photo_already_embedded_with_this_model_is_skipped():
    taken = accepted_embed_rows([row(1), row(2)], existing={"img-1": TAG}, tag=TAG, force=False)
    assert [r.id for r in taken] == ["img-2"]


def test_force_takes_an_already_embedded_photo():
    taken = accepted_embed_rows([row(1)], existing={"img-1": TAG}, tag=TAG, force=True)
    assert [r.id for r in taken] == ["img-1"]


def test_a_photo_embedded_with_ANOTHER_model_is_always_taken():
    """This is what makes changing EMBED_MODEL_URL a re-run rather than a
    migration: the RPC never compares across models, so such a row is invisible
    to the feature until it is replaced — force or no force."""
    for force in (False, True):
        taken = accepted_embed_rows(
            [row(1)], existing={"img-1": "some-other-model@v2"}, tag=TAG, force=force
        )
        assert [r.id for r in taken] == ["img-1"]


def test_a_never_embedded_photo_is_taken():
    assert len(accepted_embed_rows([row(1)], existing={}, tag=TAG, force=False)) == 1


def test_a_photo_this_process_is_holding_is_skipped_EVEN_under_force():
    """MONEY and duplicated work, not correctness: the per-org lock means a second
    submit runs AFTER the first, with an accepted list decided before the first
    wrote a row — so `existing` cannot catch it retrospectively."""
    taken = accepted_embed_rows(
        [row(1), row(2)], existing={}, tag=TAG, force=True, inflight={"img-1"}
    )
    assert [r.id for r in taken] == ["img-2"]


def test_the_order_of_the_requested_rows_is_preserved():
    rows = [row(3), row(1), row(2)]
    taken = accepted_embed_rows(rows, existing={}, tag=TAG, force=False)
    assert [r.id for r in taken] == ["img-3", "img-1", "img-2"]


# ── fetch_existing_models ───────────────────────────────────────────────────


async def test_existing_models_come_back_as_a_map(settings):
    rec = Recorder()
    rec.existing = [
        {"product_image_id": "img-1", "model": TAG},
        {"product_image_id": "img-2", "model": "other@v2"},
    ]
    async with rec.client() as client:
        got = await fetch_existing_models(client, settings, ["img-1", "img-2", "img-3"])
    assert got == {"img-1": TAG, "img-2": "other@v2"}


async def test_the_read_is_projected_and_uses_the_service_role(settings):
    rec = Recorder()
    async with rec.client() as client:
        await fetch_existing_models(client, settings, ["img-1"])
    req = rec.requests[0]
    assert req.headers["apikey"] == settings.service_role_key
    assert req.url.params["select"] == "product_image_id,model"
    assert req.url.params["product_image_id"] == 'in.("img-1")'


async def test_ids_are_chunked_at_one_hundred(settings):
    rec = Recorder()
    ids = [f"img-{i}" for i in range(250)]
    async with rec.client() as client:
        await fetch_existing_models(client, settings, ids)
    assert len(rec.requests) == 3  # 100 + 100 + 50


async def test_a_failed_read_RAISES_rather_than_reporting_nothing_is_embedded(settings):
    """The pre-migration case and a transient 500 look identical, and both would
    read as "nothing is embedded yet" — which re-embeds a whole catalogue."""
    rec = Recorder()
    rec.existing_status = 500
    async with rec.client() as client:
        with pytest.raises(EmbedStoreError):
            await fetch_existing_models(client, settings, ["img-1"])


async def test_the_pre_migration_failure_names_the_migration_file(settings):
    rec = Recorder()
    rec.existing_status = 404
    async with rec.client() as client:
        with pytest.raises(EmbedStoreError) as caught:
            await fetch_existing_models(client, settings, ["img-1"])
    assert "listing_embeddings.sql" in str(caught.value)


# ── fetch_group_map ─────────────────────────────────────────────────────────


async def test_the_group_map_parses_the_text_column_into_uuids(settings):
    rec = Recorder()
    rec.products = [
        {"id": "prod-1", "product_group": GROUP},
        {"id": "prod-2", "product_group": None},
        {"id": "prod-3", "product_group": "legacy-non-uuid"},
    ]
    async with rec.client() as client:
        got = await fetch_group_map(client, settings, ["prod-1", "prod-2", "prod-3"])
    assert got == {"prod-1": GROUP, "prod-2": None, "prod-3": None}


async def test_the_group_read_does_not_touch_the_auth_projection(settings):
    """A SEPARATE read of `products`, on purpose: app/auth.py's IMAGE_COLUMNS is
    part of the security boundary and is asserted column by column in
    test_auth.py. One extra chunked SELECT is the price of not editing it."""
    rec = Recorder()
    async with rec.client() as client:
        await fetch_group_map(client, settings, ["prod-1"])
    req = rec.requests[0]
    assert req.url.path.endswith("/products")
    assert req.url.params["select"] == "id,product_group"


async def test_duplicate_and_empty_product_ids_are_collapsed(settings):
    rec = Recorder()
    async with rec.client() as client:
        await fetch_group_map(client, settings, ["prod-1", "prod-1", "", "prod-2"])
    assert rec.requests[0].url.params["id"] == 'in.("prod-1","prod-2")'


async def test_no_product_ids_makes_no_request(settings):
    rec = Recorder()
    async with rec.client() as client:
        assert await fetch_group_map(client, settings, []) == {}
    assert rec.requests == []


async def test_a_failed_products_read_raises(settings):
    rec = Recorder()
    rec.products_status = 500
    async with rec.client() as client:
        with pytest.raises(EmbedStoreError):
            await fetch_group_map(client, settings, ["prod-1"])


# ── build_embedding_row ─────────────────────────────────────────────────────


def test_the_row_carries_exactly_the_six_columns_the_table_has():
    built = build_embedding_row(
        row(1), org_id=ORG, group_id=GROUP, vector_text="[1,0]", tag=TAG
    )
    assert built == {
        "product_image_id": "img-1",
        "product_id": "prod-1",
        "product_group_id": GROUP,
        "org_id": ORG,
        "embedding": "[1,0]",
        "model": TAG,
    }


def test_created_at_is_never_sent_so_the_database_owns_it():
    built = build_embedding_row(row(1), org_id=ORG, group_id=None, vector_text="[1]", tag=TAG)
    assert "created_at" not in built


def test_a_photo_with_no_group_sends_null_not_a_made_up_id():
    built = build_embedding_row(row(1), org_id=ORG, group_id=None, vector_text="[1]", tag=TAG)
    assert built["product_group_id"] is None


# ── upsert_embeddings ───────────────────────────────────────────────────────


def rows_for(n: int) -> list[dict]:
    return [
        build_embedding_row(row(i), org_id=ORG, group_id=GROUP, vector_text="[1]", tag=TAG)
        for i in range(n)
    ]


async def test_the_upsert_targets_the_photo_as_the_conflict_key(settings):
    """The PK is the photo ALONE, so re-embedding REPLACES; a conflict target of
    (photo, model) would accumulate two incomparable vectors per photo."""
    rec = Recorder()
    async with rec.client() as client:
        await upsert_embeddings(client, settings, rows_for(2))
    req = rec.posts()[0]
    assert req.url.params["on_conflict"] == "product_image_id"
    assert "resolution=merge-duplicates" in req.headers["Prefer"]
    assert "return=representation" in req.headers["Prefer"]
    assert req.headers["apikey"] == settings.service_role_key


async def test_rows_are_chunked_at_the_BODY_limit_not_the_url_limit(settings):
    """50, not 100: a row carries a 512-float vector as ~5 KB of text, so 100 of
    them is a half-megabyte request body. Different limit, different number."""
    rec = Recorder()
    total = EMBED_ROW_CHUNK * 2 + 3
    async with rec.client() as client:
        written = await upsert_embeddings(client, settings, rows_for(total))
    sizes = [len(json.loads(r.content)) for r in rec.posts()]
    assert sizes == [EMBED_ROW_CHUNK, EMBED_ROW_CHUNK, 3]
    assert written == total


async def test_no_rows_makes_no_request(settings):
    rec = Recorder()
    async with rec.client() as client:
        assert await upsert_embeddings(client, settings, []) == 0
    assert rec.requests == []


async def test_zero_rows_written_is_a_FAILURE_not_a_success(settings):
    """A POST that matches nothing answers 200 with an empty body. Calling that
    'saved' is how work disappears silently — the same rule storage.update_image_row
    exists to enforce."""
    rec = Recorder()
    rec.upsert_returns = []
    async with rec.client() as client:
        with pytest.raises(EmbedStoreError):
            await upsert_embeddings(client, settings, rows_for(1))


async def test_an_error_status_raises_with_the_status_in_the_message(settings):
    rec = Recorder()
    rec.upsert_status = 409
    async with rec.client() as client:
        with pytest.raises(EmbedStoreError) as caught:
            await upsert_embeddings(client, settings, rows_for(1))
    assert "409" in str(caught.value)
