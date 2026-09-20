"""Supabase Storage and the product_images row writer.

DERIVED FILES ARE NEW PATHS. AGENTS.md §18 #35 and public/sw.js state the
invariant out loud: product images are immutable per storage_path, and the
Service Worker caches them for seven days on that promise. A cutout is
`cut-<model>-<ms>.webp` and a composite is `bg-<presetHash>-<ms>.jpg`, both
beside the source in the same `{userId}/{productId}/` directory — so nothing
this service writes needs cache invalidation, and storage_path / image_url are
never touched. That is not an accident of convenience: the one place in the app
that DOES overwrite in place (Step 3's crop) has to call invalidateImageUrl()
afterwards, and this pipeline deliberately does not join it.

THE TIMESTAMP IN THE NAME is what makes a re-run safe. Two people hitting
"regenerate backgrounds" at once produce two files and two UPDATEs; the loser's
file is superseded and cleaned up by reference count on the next run, rather
than one of them silently overwriting the bytes the other is about to link.

DELETING A SUPERSEDED FILE IS REFERENCE-COUNTED (AGENTS.md §18 #15). Duplicated
batches share storage paths — that is how duplicateBatch works — so "this row no
longer points at it" does not mean "nothing points at it". Every delete asks the
table first and FAILS SAFE: any error, any doubt, the file stays. A leaked file
costs fractions of a cent; a wrongly deleted one is a hole in someone's catalog.
"""

from __future__ import annotations

import logging
import posixpath
import re
import time

import httpx

from .config import Settings

log = logging.getLogger("matting.storage")

SAFE_TAG_RE = re.compile(r"[^A-Za-z0-9._-]+")


class StorageError(RuntimeError):
    pass


def now_ms() -> int:
    return int(time.time() * 1000)


def _safe(tag: str) -> str:
    """A model tag becomes part of a filename, so flatten everything a path or a
    URL would argue about. 'replicate:men1scus/birefnet@f74986db' is a perfectly
    good tag and a terrible path segment."""
    return SAFE_TAG_RE.sub("_", tag).strip("_") or "unknown"


def derived_paths(storage_path: str, model_tag: str, preset_hash: str) -> tuple[str, str]:
    """(cutout path, composite path) beside the source."""
    directory = posixpath.dirname(storage_path)
    stamp = now_ms()
    cut = f"cut-{_safe(model_tag)}-{stamp}.webp"
    comp = f"bg-{preset_hash}-{stamp}.jpg"
    if directory:
        return posixpath.join(directory, cut), posixpath.join(directory, comp)
    return cut, comp


async def download_source(
    client: httpx.AsyncClient, settings: Settings, storage_path: str
) -> bytes:
    """Public URL first, service role second.

    The bucket is public today, so the public URL is one unauthenticated GET
    that a CDN can serve. The authenticated fallback is what makes this file
    survive the private-bucket migration unchanged — same reason src/ routes
    every URL through storageUrls.ts.
    """
    resp = await client.get(settings.storage_public_url(storage_path), timeout=120.0)
    if resp.status_code == 200:
        return resp.content

    resp = await client.get(
        settings.storage_object_url(storage_path),
        headers=settings.service_headers(),
        timeout=120.0,
    )
    if resp.status_code != 200:
        raise StorageError(f"source download failed ({resp.status_code})")
    return resp.content


async def upload(
    client: httpx.AsyncClient,
    settings: Settings,
    path: str,
    data: bytes,
    content_type: str,
) -> None:
    """Write a NEW object. x-upsert is deliberately false.

    Overwriting would be a silent violation of the immutability promise above,
    and since every path carries a millisecond stamp, a collision means
    something is wrong (a clock moved backwards, or a caller reused a path) and
    should be an error rather than a quiet data loss.
    """
    resp = await client.post(
        settings.storage_object_url(path),
        headers={
            **settings.service_headers(),
            "Content-Type": content_type,
            "x-upsert": "false",
            "cache-control": "max-age=31536000",
        },
        content=data,
        timeout=180.0,
    )
    if resp.status_code not in (200, 201):
        raise StorageError(f"upload of {path} failed ({resp.status_code}) {resp.text[:200]}")


async def path_is_referenced(
    client: httpx.AsyncClient, settings: Settings, path: str, except_id: str
) -> bool:
    """Does any OTHER product_images row point at this derived path?

    Returns True on any uncertainty — see the module docstring. The `or` is one
    request rather than two because the two columns are interchangeable here:
    we are asking "is this blob spoken for", not "in what capacity".
    """
    if not path:
        return True
    try:
        resp = await client.get(
            f"{settings.rest_url}/product_images",
            params={
                "select": "id",
                "or": f'(cutout_storage_path.eq."{path}",composite_storage_path.eq."{path}")',
                "id": f"neq.{except_id}",
                "limit": "1",
            },
            headers=settings.service_headers(),
            timeout=20.0,
        )
        if resp.status_code != 200:
            log.warning("refcount: lookup for %s returned %s — keeping the file", path, resp.status_code)
            return True
        return bool(resp.json())
    except Exception as exc:
        log.warning("refcount: lookup for %s threw (%s) — keeping the file", path, exc)
        return True


async def delete_if_unreferenced(
    client: httpx.AsyncClient, settings: Settings, paths: list[str], except_id: str
) -> list[str]:
    """Delete superseded derived files nothing else points at. Returns what went."""
    candidates = [p for p in paths if p]
    if not candidates:
        return []

    keep_free = []
    for p in candidates:
        if not await path_is_referenced(client, settings, p, except_id):
            keep_free.append(p)
    if not keep_free:
        return []

    try:
        resp = await client.request(
            "DELETE",
            f"{settings.supabase_url}/storage/v1/object/{settings.bucket}",
            headers={**settings.service_headers(), "Content-Type": "application/json"},
            json={"prefixes": keep_free},
            timeout=60.0,
        )
        if resp.status_code not in (200, 204):
            log.warning("cleanup: delete returned %s for %d paths", resp.status_code, len(keep_free))
            return []
        return keep_free
    except Exception as exc:
        # A leaked derived file is a rounding error; a failed cleanup must never
        # fail the image whose cutout was just written successfully.
        log.warning("cleanup: delete threw: %s", exc)
        return []


async def update_image_row(
    client: httpx.AsyncClient, settings: Settings, image_id: str, patch: dict
) -> bool:
    """PATCH one product_images row. 0 rows updated is a FAILURE, not a success.

    Same rule the app learned the hard way (AGENTS.md §8 / updateProduct): a
    PATCH that matches nothing returns 200 with an empty body, and treating that
    as "saved" is how work disappears silently. `return=representation` is what
    makes the difference observable.
    """
    resp = await client.patch(
        f"{settings.rest_url}/product_images",
        params={"id": f"eq.{image_id}"},
        headers={
            **settings.service_headers(),
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        },
        json=patch,
        timeout=30.0,
    )
    if resp.status_code not in (200, 204):
        log.error("update: row %s returned %s %s", image_id, resp.status_code, resp.text[:200])
        return False
    body = resp.json() if resp.content else []
    if not body:
        log.error("update: row %s matched 0 rows — nothing was saved", image_id)
        return False
    return True


async def mark_queued(
    client: httpx.AsyncClient, settings: Settings, ids: list[str]
) -> int:
    """Set mask_status='queued' on accepted rows, chunked.

    Written BEFORE any work starts so the UI can show the queue immediately, and
    so a crash mid-job leaves the rows in a state that says what happened.
    Resubmitting the same ids picks them straight back up — 'queued' is not an
    idempotency key, only mask_model + bg_preset are.
    """
    from .auth import ID_CHUNK

    total = 0
    for i in range(0, len(ids), ID_CHUNK):
        chunk = ids[i : i + ID_CHUNK]
        quoted = ",".join(f'"{cid}"' for cid in chunk)
        resp = await client.patch(
            f"{settings.rest_url}/product_images",
            params={"id": f"in.({quoted})"},
            headers={
                **settings.service_headers(),
                "Content-Type": "application/json",
                "Prefer": "return=representation",
            },
            json={"mask_status": "queued"},
            timeout=30.0,
        )
        if resp.status_code not in (200, 204):
            log.error("mark_queued: chunk returned %s", resp.status_code)
            continue
        total += len(resp.json() or []) if resp.content else len(chunk)
    return total
