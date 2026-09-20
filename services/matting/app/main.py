"""The HTTP surface. Four endpoints, defined verbatim in CONTRACT.md.

The app agent codes against CONTRACT.md, not against this file — so if the two
ever disagree, CONTRACT.md is the bug report and this is the bug.
"""

from __future__ import annotations

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

    log.info(
        "matting up: backend=%s model=%s concurrency=%d bucket=%s",
        settings.backend,
        app.state.matter.tag,
        settings.concurrency,
        settings.bucket,
    )

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
