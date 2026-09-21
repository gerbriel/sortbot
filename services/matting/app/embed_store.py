"""The `listing_embeddings` reader and writer.

THE APP NEVER WRITES THIS TABLE. Members are granted the verbs (so a seller can
delete a photo's vector) but every row that exists is written HERE, with the
service role, which is what lets the app ship before the migration and lets the
whole feature be re-run over a catalogue without asking the app anything. Same
division of ownership as the matting columns — see backgroundService.ts's header.

TWO CHUNK SIZES, AND THEY ARE DIFFERENT KINDS OF LIMIT. Reads chunk at
`ID_CHUNK` (100) because PostgREST answers a long `in.(…)` URL with a 400/414 —
the same wall src/lib/chunk.ts documents. Writes chunk at `EMBED_ROW_CHUNK` (50)
because a row carries a 512-float vector as ~5 KB of TEXT, so 100 of them is a
half-megabyte request body. Keeping the two numbers separate keeps the two
reasons visible (AGENTS.md §11 makes the same point about concurrency-bounding
loops).

WHY THE VECTOR GOES OVER AS A STRING. There is no JSON type for a vector, so
pgvector's text input form is the wire format and Postgres casts it on arrival.
That is not a workaround: it is the documented way to write one over PostgREST.
"""

from __future__ import annotations

import logging
import uuid as uuidlib

import httpx

from .auth import ID_CHUNK, ImageRow
from .config import Settings

log = logging.getLogger("matting.embed.store")

# See the module docstring: this bounds the BODY, not the URL.
EMBED_ROW_CHUNK = 50

TABLE = "listing_embeddings"


class EmbedStoreError(RuntimeError):
    """A Supabase read or write this feature cannot proceed without."""


def as_uuid(value: object) -> str | None:
    """`products.product_group` is a TEXT column holding a uuid. Prove it.

    The column has been text since add_product_group_column.sql, and the leader
    convention puts a `products.id` in it — so in practice every value parses.
    `listing_embeddings.product_group_id` is a real `uuid`, though, and a single
    unparseable value would fail the WHOLE chunked upsert it happened to share a
    request with, taking 49 good photos down with it. A group we cannot read is a
    listing of one photo, which is exactly what NULL means in that column.
    """
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        return str(uuidlib.UUID(value.strip()))
    except (ValueError, AttributeError, TypeError):
        return None


# ── reads ───────────────────────────────────────────────────────────────────


async def fetch_existing_models(
    client: httpx.AsyncClient, settings: Settings, image_ids: list[str]
) -> dict[str, str]:
    """product_image_id -> the `model` it is already embedded with.

    Raises rather than returning {} on a failed read, and that asymmetry is the
    point: an empty map means "nothing is embedded yet", which would make
    `POST /v1/embed` re-embed an entire catalogue because one SELECT 500'd.
    """
    out: dict[str, str] = {}
    for i in range(0, len(image_ids), ID_CHUNK):
        chunk = image_ids[i : i + ID_CHUNK]
        quoted = ",".join(f'"{cid}"' for cid in chunk)
        resp = await client.get(
            f"{settings.rest_url}/{TABLE}",
            params={"product_image_id": f"in.({quoted})", "select": "product_image_id,model"},
            headers=settings.service_headers(),
            timeout=30.0,
        )
        if resp.status_code != 200:
            # 404 / PGRST205 is the pre-migration case and is worth naming: the
            # founder has deployed this service before running the SQL.
            raise EmbedStoreError(
                f"could not read {TABLE} ({resp.status_code}) — has "
                f"supabase/migrations/listing_embeddings.sql been run?"
            )
        for row in resp.json() or []:
            key, model = row.get("product_image_id"), row.get("model")
            if isinstance(key, str) and isinstance(model, str):
                out[key] = model
    return out


async def fetch_group_map(
    client: httpx.AsyncClient, settings: Settings, product_ids: list[str]
) -> dict[str, str | None]:
    """products.id -> product_group, as a uuid string or None.

    A SEPARATE read rather than widening auth.IMAGE_COLUMNS, deliberately: that
    projection is part of THE security boundary (app/auth.py), it is asserted
    column by column in tests/test_auth.py, and a feature that only needs one
    more field has no business editing the file that decides who may touch a row.
    One chunked SELECT per job is the whole cost.
    """
    out: dict[str, str | None] = {}
    ids = [p for p in dict.fromkeys(product_ids) if p]
    for i in range(0, len(ids), ID_CHUNK):
        chunk = ids[i : i + ID_CHUNK]
        quoted = ",".join(f'"{cid}"' for cid in chunk)
        resp = await client.get(
            f"{settings.rest_url}/products",
            params={"id": f"in.({quoted})", "select": "id,product_group"},
            headers=settings.service_headers(),
            timeout=30.0,
        )
        if resp.status_code != 200:
            raise EmbedStoreError(f"could not read products ({resp.status_code})")
        for row in resp.json() or []:
            pid = row.get("id")
            if isinstance(pid, str):
                out[pid] = as_uuid(row.get("product_group"))
    return out


# ── what a submit takes on ──────────────────────────────────────────────────


def accepted_embed_rows(
    rows: list[ImageRow],
    *,
    existing: dict[str, str],
    tag: str,
    force: bool,
    inflight: frozenset[str] | set[str] = frozenset(),
) -> list[ImageRow]:
    """Everything not already embedded with THIS model, minus what is in flight.

    Two exclusions, the same two shapes `pipeline.accepted_rows` has and for the
    same reasons.

    `existing[id] == tag` is about the ROW: this photo already carries this
    model's vector, and re-computing it would produce the same 512 floats.
    `force` overrides it — that is what "re-embed anyway" means, and it is how a
    photo that was re-cropped gets a fresh vector.

    A row embedded with a DIFFERENT model is ALWAYS taken, force or not: the RPC
    never compares across models, so such a row is invisible to the feature until
    it is replaced. That is what makes swapping EMBED_MODEL_URL a re-run rather
    than a migration.

    `inflight` is about THIS PROCESS and `force` does NOT override it: the per-org
    lock serialises jobs, so a duplicate submit would run afterwards with an
    accepted list decided before the first job wrote anything.
    """
    return [
        r
        for r in rows
        if r.id not in inflight and (force or existing.get(r.id) != tag)
    ]


# ── writes ──────────────────────────────────────────────────────────────────


def build_embedding_row(
    row: ImageRow,
    *,
    org_id: str,
    group_id: str | None,
    vector_text: str,
    tag: str,
) -> dict:
    """The one place a `listing_embeddings` row is spelled."""
    return {
        "product_image_id": row.id,
        "product_id": row.product_id,
        "product_group_id": group_id,
        "org_id": org_id,
        "embedding": vector_text,
        "model": tag,
    }


async def upsert_embeddings(
    client: httpx.AsyncClient, settings: Settings, rows: list[dict]
) -> int:
    """Write rows, replacing any existing vector for the same photo.

    `on_conflict=product_image_id` + `resolution=merge-duplicates` is the upsert:
    the primary key is the photo alone, so re-embedding REPLACES rather than
    accumulating, and the old model's vectors disappear as they are superseded
    instead of lingering as comps nothing will ever compare against.

    0 rows written is a FAILURE, not a success (AGENTS.md §18 #41 / storage.py's
    `update_image_row`): a PATCH or POST that matches nothing answers 200 with an
    empty body, and calling that "saved" is how work disappears silently.
    """
    if not rows:
        return 0
    written = 0
    for i in range(0, len(rows), EMBED_ROW_CHUNK):
        chunk = rows[i : i + EMBED_ROW_CHUNK]
        resp = await client.post(
            f"{settings.rest_url}/{TABLE}",
            params={"on_conflict": "product_image_id"},
            headers={
                **settings.service_headers(),
                "Content-Type": "application/json",
                "Prefer": "resolution=merge-duplicates,return=representation",
            },
            json=chunk,
            timeout=60.0,
        )
        if resp.status_code not in (200, 201):
            raise EmbedStoreError(
                f"{TABLE} upsert failed ({resp.status_code}) {resp.text[:200]}"
            )
        body = resp.json() if resp.content else []
        if not body:
            raise EmbedStoreError(f"{TABLE} upsert matched 0 rows — nothing was saved")
        written += len(body)
    return written
