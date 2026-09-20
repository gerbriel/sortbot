"""THE SECURITY BOUNDARY.

This service writes with the Supabase SERVICE ROLE, which bypasses RLS
completely. Every guarantee the database makes about workspace isolation is
therefore suspended for the duration of a request, and the only thing standing
between "matte these ten photos" and "matte any ten photos in the product" is
the check in this file. Read it as the policy it replaces, not as plumbing.

TWO STEPS, IN THIS ORDER, AND NEITHER IS OPTIONAL:

  1. WHO IS CALLING.  The caller's bearer token is resolved through
     GET {SUPABASE_URL}/auth/v1/user. It is NOT decoded locally. Verifying a JWT
     ourselves would mean holding the project's signing key and reimplementing
     expiry, revocation and the `aud` check — three things Supabase already does
     and we would get subtly wrong. A failure here is 401, full stop.

     The trap this closes is the same one audit 05 found in the Edge Functions
     (AGENTS.md §9): THE ANON KEY IS A VALIDLY SIGNED PROJECT JWT. Anything that
     merely checks "is this a well-formed project token" is checking nothing —
     the anon key is printed in the browser bundle. /auth/v1/user is what turns
     a token into a USER, and it returns no user for the anon key.

  2. WHAT MAY THEY TOUCH.  Every requested product_images row is read with the
     service role, joined to its product's org_id, and that org must be one the
     caller is a member of. Anything else — a row in another workspace, or an id
     that does not exist — is 403 for the WHOLE request, not a filtered subset.

WHY 403 FOR THE WHOLE REQUEST rather than silently processing the allowed
subset: a partial success here is indistinguishable, from the app's side, from
a success, so a bug that sends the wrong ids would look like "matting sometimes
skips photos" for months. And a caller who is allowed to probe which ids exist
by watching `accepted` drop can enumerate the table. Refusing loudly is both
safer and more debuggable.

WHY AN UNKNOWN ID IS ALSO 403 (not 404): answering 404 for "does not exist" and
403 for "not yours" is an existence oracle over a uuid space that is otherwise
opaque. The caller cannot legitimately distinguish the two cases anyway, since
neither is a row they may touch.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

import httpx

from .config import Settings

log = logging.getLogger("matting.auth")

# PostgREST answers a too-long URL with a 400/414. The app uses 100 everywhere
# (src/lib/chunk.ts ID_CHUNK) and hit the wall at ~794 ids; matching it means
# the two sides fail at the same size rather than one surprising the other.
ID_CHUNK = 100

# Exactly the columns the pipeline needs. Never select('*'): the row carries the
# workspace's storage layout and a growing number of unrelated columns, and a
# projection is the cheapest way to keep a log line or an exception from
# containing something it should not.
IMAGE_COLUMNS = (
    "id,product_id,storage_path,image_url,"
    "cutout_storage_path,composite_storage_path,bg_preset,mask_status,mask_model,"
    "products(org_id)"
)


class AuthError(Exception):
    """401 — we could not establish who is calling."""


class ForbiddenError(Exception):
    """403 — we know who is calling, and these rows are not theirs."""


@dataclass(frozen=True)
class ImageRow:
    id: str
    product_id: str | None
    storage_path: str | None
    image_url: str | None
    org_id: str | None
    cutout_storage_path: str | None
    composite_storage_path: str | None
    bg_preset: str | None
    mask_status: str | None
    mask_model: str | None

    @classmethod
    def from_json(cls, row: dict) -> ImageRow:
        product = row.get("products")
        # PostgREST renders an embedded to-one either as an object or, for some
        # relationship shapes, as a single-element array. Handle both rather
        # than bet on one — betting wrong makes org_id None, which the caller
        # below treats as "not yours", so the failure would be a mystery 403.
        if isinstance(product, list):
            product = product[0] if product else None
        return cls(
            id=str(row.get("id")),
            product_id=row.get("product_id"),
            storage_path=row.get("storage_path"),
            image_url=row.get("image_url"),
            org_id=(product or {}).get("org_id"),
            cutout_storage_path=row.get("cutout_storage_path"),
            composite_storage_path=row.get("composite_storage_path"),
            bg_preset=row.get("bg_preset"),
            mask_status=row.get("mask_status"),
            mask_model=row.get("mask_model"),
        )


def bearer_token(header: str | None) -> str:
    """Extract the token, or raise AuthError.

    The scheme prefix is only stripped when a SEPARATOR follows it, so a token
    that happens to begin with the letters "bearer" is not silently truncated.
    A header of exactly "Bearer" (or "Bearer " with nothing after it) is a
    refusal here rather than a token of the literal string "Bearer" — which
    would be sent upstream and rejected there, turning a malformed header into
    a confusing round trip instead of an immediate 401.
    """
    raw = (header or "").strip()
    low = raw.lower()
    if low == "bearer":
        raise AuthError("missing Authorization: Bearer <token>")
    if low.startswith("bearer ") or low.startswith("bearer\t"):
        raw = raw[6:].strip()
    if not raw:
        raise AuthError("missing Authorization: Bearer <token>")
    return raw


async def resolve_uid(client: httpx.AsyncClient, settings: Settings, token: str) -> str:
    """Turn a bearer token into a user id, or raise AuthError."""
    try:
        resp = await client.get(
            f"{settings.supabase_url}/auth/v1/user",
            headers={"apikey": settings.anon_key, "Authorization": f"Bearer {token}"},
            timeout=20.0,
        )
    except Exception as exc:
        log.error("auth: /auth/v1/user request failed: %s", exc)
        # "Could not check" must never mean "allowed".
        raise AuthError("could not verify the caller") from exc

    if resp.status_code != 200:
        raise AuthError("invalid or expired token")
    uid = (resp.json() or {}).get("id")
    if not isinstance(uid, str) or not uid:
        # This is the anon-key case: 200, a body, no user.
        raise AuthError("token does not identify a user")
    return uid


async def caller_org_ids(client: httpx.AsyncClient, settings: Settings, uid: str) -> set[str]:
    """Every org the caller is a member of, read with the service role."""
    resp = await client.get(
        f"{settings.rest_url}/org_members",
        params={"user_id": f"eq.{uid}", "select": "org_id"},
        headers=settings.service_headers(),
        timeout=20.0,
    )
    if resp.status_code != 200:
        log.error("auth: org_members lookup returned %s", resp.status_code)
        raise AuthError("could not resolve workspace membership")
    return {r["org_id"] for r in (resp.json() or []) if r.get("org_id")}


async def fetch_image_rows(
    client: httpx.AsyncClient, settings: Settings, ids: list[str]
) -> list[ImageRow]:
    """Read the requested rows, chunked at ID_CHUNK."""
    rows: list[ImageRow] = []
    for i in range(0, len(ids), ID_CHUNK):
        chunk = ids[i : i + ID_CHUNK]
        quoted = ",".join(f'"{cid}"' for cid in chunk)
        resp = await client.get(
            f"{settings.rest_url}/product_images",
            params={"id": f"in.({quoted})", "select": IMAGE_COLUMNS},
            headers=settings.service_headers(),
            timeout=30.0,
        )
        if resp.status_code != 200:
            log.error("auth: product_images read returned %s", resp.status_code)
            raise AuthError("could not read the requested images")
        rows.extend(ImageRow.from_json(r) for r in (resp.json() or []))
    return rows


async def authorize(
    client: httpx.AsyncClient,
    settings: Settings,
    token: str,
    ids: list[str],
) -> tuple[str, str, list[ImageRow]]:
    """The whole boundary in one call.

    Returns (uid, org_id, rows). Raises AuthError (401) or ForbiddenError (403).
    Nothing in this service may touch a product_images row without having gone
    through here first.
    """
    uid = await resolve_uid(client, settings, token)
    if not ids:
        raise ForbiddenError("no product image ids supplied")

    orgs = await caller_org_ids(client, settings, uid)
    if not orgs:
        # A signed-in account with no workspace — the waitlist case. It has no
        # photos, so there is nothing it could legitimately be asking for.
        raise ForbiddenError("caller belongs to no workspace")

    rows = await fetch_image_rows(client, settings, ids)
    found = {r.id for r in rows}
    missing = [i for i in ids if i not in found]
    if missing:
        log.warning("authorize: %d of %d ids do not exist", len(missing), len(ids))
        raise ForbiddenError("one or more images are not available to this caller")

    foreign = [r.id for r in rows if r.org_id not in orgs]
    if foreign:
        log.warning("authorize: uid=%s requested %d rows outside its workspaces", uid, len(foreign))
        raise ForbiddenError("one or more images are not available to this caller")

    row_orgs = {r.org_id for r in rows}
    if len(row_orgs) != 1:
        # A job is serialised per org (jobs.py), so a job spanning two orgs has
        # no single queue to sit in. It is also not a thing the app can produce:
        # every surface that submits ids is scoped to one batch.
        raise ForbiddenError("all images in one job must belong to the same workspace")

    return uid, next(iter(row_orgs)), rows  # type: ignore[arg-type]
