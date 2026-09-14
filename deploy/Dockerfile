# syntax=docker/dockerfile:1
#
# Arcadian — static SPA image.
#
# WHY THIS EXISTS: GitHub Pages is the production deploy path and is a fine one
# (static files, free, CDN-backed). This image exists for the three things Pages
# cannot do:
#   1. a staging/preview environment that is not the production URL,
#   2. self-hosting the whole stack (this image + supabase/docker) when a
#      customer or the founder wants no managed dependency at all,
#   3. a reproducible artifact to roll back to that does not depend on
#      re-running a GitHub Actions job.
#
# The bundle is built at IMAGE BUILD time, which means the Supabase URL and anon
# key are baked into the JavaScript (that is how Vite works — see README
# "Security"). An image is therefore per-environment: build one for staging and
# one for production. Both values are public by design; never pass a
# service_role key or a Shopify Admin token as a build arg.
#
#   docker build -f deploy/Dockerfile \
#     --build-arg BASE_PATH=/ \
#     --build-arg VITE_SUPABASE_URL=https://xxxx.supabase.co \
#     --build-arg VITE_SUPABASE_ANON_KEY=eyJ... \
#     --build-arg VITE_STORAGE_LIMIT_GB=100 \
#     -t acadia:local .
#
# Build context is the REPO ROOT (not deploy/), because the build needs
# package.json and src/.

# ── Stage 1: build ───────────────────────────────────────────────────────────
FROM node:24-alpine AS build

WORKDIR /app

# Dependencies first so the npm layer caches across source-only changes.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Where the app will be served from. "/" for a container behind its own
# hostname; "/sortbot/" only if you are reproducing the GitHub Pages layout.
# vite.config.ts derives the base from GITHUB_ACTIONS, so it is overridden here
# on the command line instead of editing that file (CLAUDE.md §1 pins the Pages
# value). `npm run build -- --base=X` appends the flag to `vite build`.
ARG BASE_PATH=/

# Public, inlined-into-the-bundle values. The two Supabase ones are required:
# src/lib/supabase.ts throws at import time without them.
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ARG VITE_STORAGE_LIMIT_GB=100

ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL \
    VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY \
    VITE_STORAGE_LIMIT_GB=$VITE_STORAGE_LIMIT_GB

RUN if [ -z "$VITE_SUPABASE_URL" ] || [ -z "$VITE_SUPABASE_ANON_KEY" ]; then \
      echo "VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY build-args are required"; \
      exit 1; \
    fi

# Fail the image build on a type error or a failing test, exactly like CI.
RUN npm test
RUN npm run build -- --base="$BASE_PATH"

# Refuse to ship an image with a credential-shaped string in the bundle.
RUN if grep -rqE 'shpat_[A-Za-z0-9]{4}|service_role|sk-ant-api|sk-proj-' dist/; then \
      echo "credential-shaped string found in dist/ — refusing to build"; \
      exit 1; \
    fi

# ── Stage 2: serve ───────────────────────────────────────────────────────────
FROM nginx:1.27-alpine AS serve

# nginx:alpine reads *.conf from here; the default server block is replaced.
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

# Static files only — no app server, no secrets, no state in the container.
# nginx:alpine's entrypoint already handles /docker-entrypoint.d and runs as
# root only to bind :80; drop to an unprivileged image (nginxinc/nginx-unprivileged)
# and change listen to 8080 in nginx.conf if your platform forbids root.
EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/healthz || exit 1

# Inherit nginx's CMD ["nginx", "-g", "daemon off;"].
