#!/usr/bin/env bash
# One-command deploy of the matting service to Fly.io.
#
#   cd services/matting
#   REPLICATE_API_TOKEN=r8_… SUPABASE_SERVICE_ROLE_KEY=eyJ… ./deploy.sh
#
# Needs: `flyctl` (brew install flyctl) and a login (`fly auth login`, or
# FLY_API_TOKEN in the environment). Everything else is read from the repo or
# asked for once. Re-running is safe: `fly launch` is skipped when fly.toml
# exists, secrets are overwritten, and `fly deploy` is idempotent.
#
# What it sets, and where each value comes from:
#   SUPABASE_URL               the app's own VITE_SUPABASE_URL (public)
#   SUPABASE_ANON_KEY          the app's own VITE_SUPABASE_ANON_KEY (public)
#   SUPABASE_SERVICE_ROLE_KEY  Supabase dashboard → Project Settings → API. SERVER ONLY.
#   REPLICATE_API_TOKEN        replicate.com → Account → API tokens. SERVER ONLY.
#   REPLICATE_VERSION          pinned at deploy time from the model's current
#                              version (printed; change it deliberately later)
#   MATTING_BACKEND=replicate  the approved first backend (AGENTS.md §9)
#   ALLOWED_ORIGINS            the app's origins
set -euo pipefail
cd "$(dirname "$0")"

APP="${FLY_APP:-arcadian-matting}"
REGION="${FLY_REGION:-sjc}"           # Supabase project is West US (N. California)
HOSTNAME="${MATTING_HOSTNAME:-matting.arcadian.ltd}"
MODEL="${REPLICATE_MODEL:-men1scus/birefnet}"

need() { command -v "$1" >/dev/null 2>&1 || { echo "missing: $1" >&2; exit 1; }; }
need flyctl; need curl; need python3

# The two server-only secrets may be given in a local, gitignored file instead
# of on the command line, so they never sit in a shell history or a chat log:
#   services/matting/.env.deploy
#     REPLICATE_API_TOKEN=r8_…
#     SUPABASE_SERVICE_ROLE_KEY=eyJ…
#     FLY_API_TOKEN=fo1_…        # optional: instead of `fly auth login`
#                                # (fly.io → Account → Access Tokens, or `fly tokens create deploy`)
if [ -f .env.deploy ]; then
  set -a; . ./.env.deploy; set +a
fi

: "${REPLICATE_API_TOKEN:?set REPLICATE_API_TOKEN (replicate.com → Account → API tokens)}"
: "${SUPABASE_SERVICE_ROLE_KEY:?set SUPABASE_SERVICE_ROLE_KEY (Supabase → Project Settings → API; never put this in a VITE_* var)}"

# Public values come from the app's .env so they cannot drift from the app.
ENVFILE="../../.env"
SUPABASE_URL="${SUPABASE_URL:-$(grep -E '^VITE_SUPABASE_URL=' "$ENVFILE" | cut -d= -f2- | tr -d '"' )}"
SUPABASE_ANON_KEY="${SUPABASE_ANON_KEY:-$(grep -E '^VITE_SUPABASE_ANON_KEY=' "$ENVFILE" | cut -d= -f2- | tr -d '"')}"
[ -n "$SUPABASE_URL" ] && [ -n "$SUPABASE_ANON_KEY" ] || { echo "could not read VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY from $ENVFILE" >&2; exit 1; }

# Pin the model version NOW, so the catalogue never silently changes under a
# model update (the service refuses to start unpinned — see app/config.py).
if [ -z "${REPLICATE_VERSION:-}" ]; then
  REPLICATE_VERSION=$(curl -fsS -H "Authorization: Bearer $REPLICATE_API_TOKEN" \
    "https://api.replicate.com/v1/models/${MODEL}" \
    | python3 -c 'import json,sys; print(json.load(sys.stdin)["latest_version"]["id"])')
fi
echo "pinning ${MODEL} @ ${REPLICATE_VERSION}"

if [ ! -f fly.toml ]; then
  sed -e "s/^app = .*/app = \"${APP}\"/" -e "s/^primary_region = .*/primary_region = \"${REGION}\"/" fly.toml.example > fly.toml
  fly launch --copy-config --no-deploy --name "$APP" --region "$REGION" --yes
fi

fly secrets set --app "$APP" --stage \
  SUPABASE_URL="$SUPABASE_URL" \
  SUPABASE_ANON_KEY="$SUPABASE_ANON_KEY" \
  SUPABASE_SERVICE_ROLE_KEY="$SUPABASE_SERVICE_ROLE_KEY" \
  REPLICATE_API_TOKEN="$REPLICATE_API_TOKEN" \
  REPLICATE_MODEL="$MODEL" \
  REPLICATE_VERSION="$REPLICATE_VERSION" \
  MATTING_BACKEND=replicate \
  ALLOWED_ORIGINS="https://arcadian.ltd,http://localhost:5173"

fly deploy --app "$APP" --remote-only

# The app's CSP names this hostname exactly (index.html connect-src), so the
# service must answer there and nowhere else. Fly issues the certificate once
# the CNAME exists: matting.arcadian.ltd → ${APP}.fly.dev
fly certs add --app "$APP" "$HOSTNAME" || true
echo
echo "Now: add a DNS CNAME  ${HOSTNAME} → ${APP}.fly.dev , wait for 'fly certs show ${HOSTNAME}' to say Ready,"
echo "then set the GitHub secret:  gh secret set VITE_MATTING_URL --body https://${HOSTNAME}"
echo "and push (or re-run) the Pages deploy. First real check:  curl -s https://${HOSTNAME}/healthz"
