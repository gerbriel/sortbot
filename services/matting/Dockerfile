# ── build ───────────────────────────────────────────────────────────────────
# A wheel-building stage so the runtime image carries no compiler and no build
# metadata. opencv and numpy ship manylinux wheels, so this is fast; it exists
# for the day something in the tree does not.
FROM python:3.12-slim AS build

WORKDIR /build
ENV PIP_DISABLE_PIP_VERSION_CHECK=1 PIP_NO_CACHE_DIR=1

COPY pyproject.toml ./
COPY app ./app

# Install the RUNTIME extras only. The `local` extra (torch, transformers, timm)
# is deliberately NOT installed here: it is ~2.5 GB of wheels and several GB of
# RAM at inference, and the default deployment mats through Replicate. Build a
# separate image with `--build-arg EXTRAS='[local]'` if you want it in-process.
ARG EXTRAS=""
RUN python -m venv /opt/venv \
 && /opt/venv/bin/pip install --upgrade pip setuptools wheel \
 && /opt/venv/bin/pip install ".${EXTRAS}"

# ── runtime ─────────────────────────────────────────────────────────────────
FROM python:3.12-slim

# opencv-python-headless still links libgl-free image codecs but needs
# libglib2.0 for a handful of its modules. Installing it here rather than
# reaching for the non-headless wheel keeps the image ~120 MB smaller and
# avoids pulling in an X11 stack a server has no use for.
RUN apt-get update \
 && apt-get install -y --no-install-recommends libglib2.0-0 curl \
 && rm -rf /var/lib/apt/lists/*

# Non-root. The process writes nothing to disk — every artifact goes straight to
# Supabase Storage — so it does not even need a writable home.
RUN useradd --create-home --uid 10001 matting

COPY --from=build /opt/venv /opt/venv
WORKDIR /srv
COPY app ./app

ENV PATH="/opt/venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PORT=8080

USER matting
EXPOSE 8080

# /healthz is unauthenticated on purpose — an orchestrator's probe has no user.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT}/healthz" || exit 1

# One worker, deliberately. The job registry and the per-org lock are IN-PROCESS
# (app/jobs.py), so two uvicorn workers would be two independent registries:
# a job started on one is a 404 on the other, and the "one job per workspace"
# rule would hold per worker rather than per workspace. Concurrency comes from
# asyncio inside the one process (CONCURRENCY), which is the right shape anyway
# — this service is almost entirely waiting on network.
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --workers 1 --no-access-log"]
