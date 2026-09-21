"""The HTTP surface. Four endpoints, defined verbatim in CONTRACT.md.

The app agent codes against CONTRACT.md, not against this file — so if the two
ever disagree, CONTRACT.md is the bug report and this is the bug.
"""

from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, Header, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from .auth import AuthError, ForbiddenError, authorize, bearer_token
from .backends import BackendUnavailable, build_matter
from .config import get_settings
from .embed import OnnxEmbedder, ensure_model_file, model_is_present
from .embed_store import (
    EmbedStoreError,
    accepted_embed_rows,
    fetch_existing_models,
    fetch_group_map,
)
from .jobs import JobRegistry
from .pipeline import accepted_rows
from .preset import BackgroundPreset, PresetError
from .storage import mark_queued

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-7s %(name)s  %(message)s",
)
log = logging.getLogger("matting")


class JobRequest(BaseModel):
    productImageIds: list[str] = Field(default_factory=list)
    preset: dict | None = None
    force: bool = False


class RerunRequest(BaseModel):
    preset: dict | None = None
    resolution: int = 1024


class EmbedRequest(BaseModel):
    productImageIds: list[str] = Field(default_factory=list)
    force: bool = False


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings(refresh=True)
    settings.validate()

    client = httpx.AsyncClient(
        timeout=settings.http_timeout_seconds,
        follow_redirects=True,
        # A batch is CONCURRENCY images each doing a handful of round trips;
        # the default pool of 10 would serialise them behind connection reuse.
        limits=httpx.Limits(max_connections=max(16, settings.concurrency * 4)),
    )
    app.state.settings = settings
    app.state.client = client
    app.state.jobs = JobRegistry(settings)
    app.state.matter = build_matter(settings, client)
    # Constructed, NOT loaded: the 350 MB session is built on the first
    # /v1/embed (see OnnxEmbedder), so a deployment that only mats photos never
    # pays for it and /healthz never waits on it.
    app.state.embedder = OnnxEmbedder(settings)
    app.state.model_task = None

    log.info(
        "matting up: backend=%s model=%s concurrency=%d bucket=%s embed=%s",
        settings.backend,
        app.state.matter.tag,
        settings.concurrency,
        settings.bucket,
        settings.embed_tag,
    )

    # THE MODEL FILE IS FETCHED IN THE BACKGROUND, at container start, and this
    # is the one place the scale-to-zero trade-off bites: MODEL_CACHE_DIR
    # defaults to /tmp, which on Fly is ephemeral, so every cold start re-fetches
    # ~350 MB. A 1 GB volume mounted at /data (see fly.toml.example's commented
    # [mounts] block) turns that into a one-off. It is a task rather than an
    # await because the health check has 20 s of grace and this has 350 MB of
    # download: blocking startup on it would fail the deploy on a slow link,
    # for a feature the first request can wait for anyway.
    if settings.embed_prefetch and not model_is_present(settings):
        async def _prefetch() -> None:
            try:
                await ensure_model_file(client, settings)
            except Exception as exc:  # noqa: BLE001 — never fail startup for this
                log.warning("embed: model prefetch failed (%s) — /v1/embed will retry", exc)

        app.state.model_task = asyncio.create_task(_prefetch(), name="embed-model-prefetch")

    # Report the live version so pinning is a copy-paste, not a hunt. It is
    # NEVER adopted automatically — see ReplicateMatter.latest_version.
    if settings.backend == "replicate":
        latest = await app.state.matter.latest_version()
        if latest:
            if not settings.replicate_version:
                log.warning("REPLICATE_VERSION unset. Latest is %s — pin it.", latest)
            elif latest != settings.replicate_version:
                log.info(
                    "pinned to %s; Replicate's latest is %s (deliberate — re-pin when you "
                    "have re-run the catalog)",
                    settings.replicate_version[:8],
                    latest[:8],
                )

    try:
        yield
    finally:
        # Uvicorn turns SIGTERM *and* SIGINT into a lifespan shutdown, which is
        # what makes this reachable on Fly's trial — it stops a machine with a
        # SIGINT after five minutes, so an interrupted batch is the normal case.
        # Drain first (let an image finish if it can), then leave whatever did not
        # finish as 'queued' so pressing the button again picks it up.
        await app.state.jobs.drain()
        await app.state.jobs.requeue_inflight(client, settings)
        # The prefetch holds the httpx client, so it has to stop before the
        # client closes. `ensure_model_file` deletes its own partial file on
        # cancellation, so this leaves nothing half-written behind.
        task = getattr(app.state, "model_task", None)
        if task is not None and not task.done():
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
            except Exception:  # noqa: BLE001 — shutdown must not fail on a prefetch
                pass
        await client.aclose()


app = FastAPI(title="Arcadian matting", version="0.1.0", lifespan=lifespan)


def _origins() -> list[str]:
    return get_settings().allowed_origins


app.add_middleware(
    CORSMiddleware,
    # An explicit list, never "*". The browser sends a bearer token on every
    # call here, and `allow_credentials` aside, a wildcard would let any page
    # on the internet drive a signed-in user's matting quota.
    allow_origins=_origins(),
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
    max_age=600,
)


@app.middleware("http")
async def body_cap(request: Request, call_next):
    """256 KB is ~8,000 uuids — far more than MAX_IDS_PER_JOB allows anyway.

    Enforced on Content-Length before the body is read, so a large POST costs
    a header parse rather than a buffer. A chunked request without a length
    still gets through here; MAX_IDS_PER_JOB is the real bound on work.
    """
    cap = get_settings().max_body_bytes
    raw = request.headers.get("content-length")
    if raw and raw.isdigit() and int(raw) > cap:
        return JSONResponse({"error": f"request body exceeds {cap} bytes"}, status_code=413)
    return await call_next(request)


@app.exception_handler(AuthError)
async def _auth_handler(_: Request, exc: AuthError) -> JSONResponse:
    return JSONResponse({"error": str(exc) or "Sign in required."}, status_code=401)


@app.exception_handler(ForbiddenError)
async def _forbidden_handler(_: Request, exc: ForbiddenError) -> JSONResponse:
    return JSONResponse({"error": str(exc) or "Not available to this caller."}, status_code=403)


@app.exception_handler(PresetError)
async def _preset_handler(_: Request, exc: PresetError) -> JSONResponse:
    return JSONResponse({"error": str(exc)}, status_code=422)


@app.exception_handler(BackendUnavailable)
async def _backend_handler(_: Request, exc: BackendUnavailable) -> JSONResponse:
    log.error("backend unavailable: %s", exc)
    return JSONResponse({"error": "Matting backend unavailable."}, status_code=503)


@app.exception_handler(EmbedStoreError)
async def _embed_store_handler(_: Request, exc: EmbedStoreError) -> JSONResponse:
    """503, and the reason stays in the log.

    The overwhelmingly likely cause is that listing_embeddings.sql has not been
    run, and the CLIENT already detects that for itself with a column probe
    (embeddingsService.embeddingsAvailable) — so it can say which file to run
    without this endpoint echoing a server's words at a reseller. Same rule as
    the Edge Functions, §9.
    """
    log.error("embed store: %s", exc)
    return JSONResponse({"error": "Embeddings are unavailable."}, status_code=503)


@app.get("/healthz")
async def healthz() -> dict:
    """The only unauthenticated endpoint. It reveals the backend name and the
    model tag and nothing else — no counts, no org, no config."""
    settings = get_settings()
    matter = getattr(app.state, "matter", None)
    return {
        "ok": True,
        "backend": settings.backend,
        "model": matter.tag if matter else settings.replicate_model,
        # Which embedding model this deployment writes, and whether its weights
        # are on disk yet. `embedReady: false` is the honest answer during the
        # first minutes of a cold start on an ephemeral MODEL_CACHE_DIR, and it is
        # what a settings screen should show rather than "broken".
        "embedModel": settings.embed_tag,
        "embedReady": model_is_present(settings),
    }


@app.post("/v1/jobs", status_code=202)
async def create_job(body: JobRequest, authorization: str | None = Header(default=None)) -> dict:
    settings = get_settings()
    token = bearer_token(authorization)

    ids = list(dict.fromkeys(i for i in body.productImageIds if isinstance(i, str) and i))
    if not ids:
        raise ForbiddenError("no product image ids supplied")
    if len(ids) > settings.max_ids_per_job:
        return JSONResponse(
            {"error": f"at most {settings.max_ids_per_job} images per job"}, status_code=422
        )

    preset = BackgroundPreset.parse(body.preset)
    _, org_id, rows = await authorize(app.state.client, settings, token, ids)

    matter = app.state.matter
    # The rule — including why a row this process is holding is skipped even under
    # `force` — is in pipeline.accepted_rows, next to `already_done`.
    accepted = accepted_rows(
        rows,
        matter_tag=matter.tag,
        preset_hash=preset.hash,
        force=body.force,
        inflight=app.state.jobs.inflight_ids(),
    )
    skipped = len(rows) - len(accepted)

    if not accepted:
        # Nothing to do is a success. The app renders "already up to date".
        return {"jobId": "", "accepted": 0, "skipped": skipped}

    # Publish the queue before starting work, so the first poll already shows it.
    await mark_queued(app.state.client, settings, [r.id for r in accepted])

    job = app.state.jobs.submit(
        client=app.state.client,
        matter=matter,
        org_id=org_id,
        rows=accepted,
        preset=preset,
    )
    log.info(
        "job %s accepted %d skipped %d preset=%s org=%s",
        job.job_id[:8],
        len(accepted),
        skipped,
        preset.hash,
        org_id,
    )
    return {"jobId": job.job_id, "accepted": len(accepted), "skipped": skipped}


@app.post("/v1/embed", status_code=202)
async def create_embed_job(
    body: EmbedRequest, authorization: str | None = Header(default=None)
) -> dict:
    """CLIP-embed these photos. SAME AUTH BOUNDARY AS /v1/jobs, no exceptions.

    `authorize` is the whole security story (app/auth.py): the caller is resolved
    through /auth/v1/user, every requested row is read with the service role and
    joined to its org, and one foreign or unknown id is 403 for the WHOLE request.
    A different rule here would be a second boundary to keep in step with the
    first, and an embedding is not less sensitive than a cutout — it is a
    searchable fingerprint of somebody's inventory.

    202 with `jobId: ""` means "nothing to do", exactly as POST /v1/jobs does:
    every photo already carries this model's vector. The app renders that as
    already up to date rather than as an error.

    THIS ENDPOINT WRITES NOTHING TO `product_images`. No mark_queued, no
    mask_status — those columns belong to the matting feature, and borrowing one
    to mean "embedding in flight" would make the review queue lie.
    """
    settings = get_settings()
    token = bearer_token(authorization)

    ids = list(dict.fromkeys(i for i in body.productImageIds if isinstance(i, str) and i))
    if not ids:
        raise ForbiddenError("no product image ids supplied")
    if len(ids) > settings.max_ids_per_job:
        return JSONResponse(
            {"error": f"at most {settings.max_ids_per_job} images per job"}, status_code=422
        )

    _, org_id, rows = await authorize(app.state.client, settings, token, ids)

    embedder = app.state.embedder
    existing = await fetch_existing_models(app.state.client, settings, [r.id for r in rows])
    accepted = accepted_embed_rows(
        rows,
        existing=existing,
        tag=embedder.tag,
        force=body.force,
        inflight=app.state.jobs.embed_inflight_ids(),
    )
    skipped = len(rows) - len(accepted)

    if not accepted:
        return {"jobId": "", "accepted": 0, "skipped": skipped}

    # Read BEFORE the job starts, so the whole job shares one lookup and a photo's
    # group cannot change under it half way through a batch.
    group_map = await fetch_group_map(
        app.state.client, settings, [r.product_id for r in accepted if r.product_id]
    )

    job = app.state.jobs.submit_embed(
        client=app.state.client,
        embedder=embedder,
        org_id=org_id,
        rows=accepted,
        group_map=group_map,
    )
    log.info(
        "embed job %s accepted %d skipped %d model=%s org=%s",
        job.job_id[:8],
        len(accepted),
        skipped,
        embedder.tag,
        org_id,
    )
    return {"jobId": job.job_id, "accepted": len(accepted), "skipped": skipped}


@app.get("/v1/jobs/{job_id}")
async def job_status(job_id: str, authorization: str | None = Header(default=None)) -> dict:
    """Authenticated, but not authorized against the job's org.

    A job id is a random uuid handed only to its submitter, and the response is
    five integers with no workspace, no ids and no filenames in it — so the
    worst an id-guesser learns is that somebody, somewhere, matted some photos.
    Resolving the caller anyway keeps the endpoint off the unauthenticated
    surface, which is what actually matters for abuse.
    """
    settings = get_settings()
    token = bearer_token(authorization)
    from .auth import resolve_uid

    await resolve_uid(app.state.client, settings, token)

    job = app.state.jobs.get(job_id)
    if job is None:
        return JSONResponse({"error": "unknown job"}, status_code=404)
    return job.to_json()


@app.post("/v1/images/{product_image_id}/rerun", status_code=202)
async def rerun(
    product_image_id: str,
    body: RerunRequest,
    authorization: str | None = Header(default=None),
) -> dict:
    """A one-image job. Always forced — asking for a re-run IS the force."""
    settings = get_settings()
    token = bearer_token(authorization)
    preset = BackgroundPreset.parse(body.preset)

    resolution = 2048 if body.resolution and int(body.resolution) >= 2048 else 1024

    _, org_id, rows = await authorize(app.state.client, settings, token, [product_image_id])
    await mark_queued(app.state.client, settings, [product_image_id])

    job = app.state.jobs.submit(
        client=app.state.client,
        matter=app.state.matter,
        org_id=org_id,
        rows=rows,
        preset=preset,
        want_resolution=resolution,
    )
    return {"jobId": job.job_id}
