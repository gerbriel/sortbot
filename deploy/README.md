# deploy/ — container packaging for Acadia

Production today is **GitHub Pages**: `.github/workflows/deploy.yml` builds on
every push to `main` and publishes `dist/` to
<https://gerbriel.github.io/sortbot>. Nothing in this folder changes that, and
none of it is required to ship.

This folder exists for the three things Pages cannot do.

| Need | Why Pages can't | What to use here |
|---|---|---|
| A staging URL that is not production | One Pages site per repo, one environment | `docker compose up` locally, or the image on any host |
| A no-managed-dependency deployment | Pages is a managed service | this image + the official `supabase/docker` stack |
| A rollback artifact independent of CI | Rollback means re-running an Actions job | a tagged image (`acadia-app:2026-09-13-abc1234`) |

Full reasoning, plus the GitHub Pages deploy pipeline review, is in
[`docs/reviews/06-devops.md`](../docs/reviews/06-devops.md).

---

## Files

| File | What it is |
|---|---|
| `Dockerfile` | Two stages: `node:24-alpine` runs `npm ci`, `npm test`, `npm run build`; `nginx:1.27-alpine` serves `dist/`. Build context is the **repo root**. |
| `nginx.conf` | SPA fallback, correct cache headers (immutable assets, never-cached `index.html`/`sw.js`), `/healthz`, baseline security headers. |
| `docker-compose.yml` | Builds and runs the app on `:8088`, and documents how to run it next to a self-hosted Supabase without duplicating that stack. |

## Quick start

```bash
# from the repo root
cp .env deploy/.env            # or write the three VITE_ values by hand
docker compose -f deploy/docker-compose.yml up --build -d
open http://localhost:8088
curl -fsS http://localhost:8088/healthz     # -> ok
```

Or without compose:

```bash
docker build -f deploy/Dockerfile \
  --build-arg BASE_PATH=/ \
  --build-arg VITE_SUPABASE_URL=https://xxxx.supabase.co \
  --build-arg VITE_SUPABASE_ANON_KEY=eyJhbGciOi... \
  --build-arg VITE_STORAGE_LIMIT_GB=100 \
  -t acadia-app:local .
docker run --rm -p 8088:80 acadia-app:local
```

### The base path

`vite.config.ts` sets `base: process.env.GITHUB_ACTIONS ? '/sortbot/' : '/'`.
That file is not edited here — `/sortbot/` is pinned to the GitHub repo name and
changing it 404s every asset on the live site (CLAUDE.md §1). The image passes
`--base` to `vite build` on the command line instead:

```
ARG BASE_PATH=/          # default: container owns its own hostname
```

Set `BASE_PATH=/sortbot/` only if you are serving the container behind that same
path prefix.

### Configuration is baked in, not injected

Vite inlines every `VITE_*` variable into the JavaScript bundle at build time.
There is no runtime config file to mount, so:

* one image per environment (staging image ≠ production image);
* changing the Supabase URL or anon key means rebuilding;
* both of those values are public by design and safe to bake in
  (README "Security");
* a `service_role` key or a Shopify Admin token must never be passed as a build
  arg. The Dockerfile greps `dist/` for credential-shaped strings and fails the
  build if it finds one.

### What the image does not contain

No app server, no secrets, no state. Server-side secrets live only as Supabase
Edge Function secrets (`SHOPIFY_ADMIN_TOKEN`, `CF_API_TOKEN`), and the
functions run on Supabase, not in this container.

## Pointing the app at Supabase

`VITE_SUPABASE_URL` must be reachable **from the user's browser**: this app has
no backend of its own, so the browser is the only Supabase client. A
Docker-network hostname such as `http://kong:8000` will not work.

* **Managed Supabase (production today):** `https://<project-ref>.supabase.co`.
* **Self-hosted:** the **Kong** gateway URL — `http://localhost:8000` on the
  same machine, or your own TLS hostname. Kong fronts `/auth`, `/rest`,
  `/realtime` and `/storage`; do not point the app at Postgres or PostgREST
  directly.
* `VITE_SUPABASE_ANON_KEY` must be the anon key minted from that stack's
  `JWT_SECRET`.

Run the official stack rather than a copy of it:

```bash
git clone --depth 1 https://github.com/supabase/supabase /opt/supabase-docker
cd /opt/supabase-docker/docker
cp .env.example .env    # POSTGRES_PASSWORD, JWT_SECRET, ANON_KEY, SERVICE_ROLE_KEY, DASHBOARD_*
docker compose up -d
```

<https://supabase.com/docs/guides/self-hosting/docker>

Self-hosting checklist for this app specifically:

1. Create the `product-images` Storage bucket (public today — README "Known
   limitation: image files are publicly readable").
2. Apply `supabase/migrations/*.sql` **by hand, in dependency order**. Start
   with the table-creating ones, then `multi_org_tenancy.sql`, then the
   migrations that depend on it (`beta_signups.sql`, `analytics_events.sql`,
   `crm.sql`, `support_messaging.sql`, `org_shopify_connections.sql`,
   `founding_user_admin.sql`, `vocab_*.sql`). Several are destructive — read the
   warnings in CLAUDE.md §5 first.
3. Edge Functions are optional. Without them `shopify-titles` falls back to
   database-only title dedup and `generate-prose` returns 503 with the
   rule-based description path intact.
4. Backups are yours: nightly `pg_dump` plus an off-box copy of the storage
   volume. Managed Supabase does this for you; self-hosted it is not automatic.

## Adding a CSP

`nginx.conf` deliberately sets no `Content-Security-Policy`, because the correct
`connect-src`/`img-src` depends on which Supabase project the image was built
against, and a wrong value breaks uploads with no visible error. Add one per
environment, substituting your project host:

```nginx
add_header Content-Security-Policy "\
default-src 'self'; \
script-src 'self'; \
style-src 'self' 'unsafe-inline'; \
img-src 'self' data: blob: https://<project-ref>.supabase.co; \
connect-src 'self' https://<project-ref>.supabase.co wss://<project-ref>.supabase.co; \
font-src 'self' data:; \
frame-ancestors 'none'; \
base-uri 'self'" always;
```

`wss:` is required — Supabase Realtime powers support messaging
(`src/lib/supportService.ts:143`). `blob:`/`data:` are required for upload
previews and canvas compression. Verify with the browser console open and a real
upload before considering it done.

## Why not Kubernetes

This is a static SPA plus managed Postgres. There is no server process to scale,
no queue, no cron, no internal service mesh — the only "backend" in the request
path is Supabase, which is managed. Kubernetes would add a control plane,
manifests, an ingress controller, a registry, and a secret store to operate, in
exchange for nothing that a CDN and one container do not already give: asset
delivery is CDN work, "scaling" means adding replicas of a process that does
nothing but read files off disk, and rollback is already `docker run <old tag>`.

For anything beyond GitHub Pages, the realistic order of escalation is:

1. GitHub Pages (today) — free, CDN-backed, zero ops.
2. This container on a single small host behind Caddy/nginx-proxy with
   automatic TLS — the whole self-hosted story, one box.
3. A managed container host (Fly.io, Cloud Run, Render) if multi-region matters.
4. Kubernetes only when there are other services that already justify a cluster.

### Appendix: minimal k8s manifest (optional, Helm-free)

If a cluster already exists and this app has to live in it, this is the whole
thing — a Deployment, a Service, and an Ingress. It is an appendix, not a
recommendation.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: acadia-app
  labels: { app: acadia-app }
spec:
  replicas: 2                      # for rolling updates, not for load
  selector:
    matchLabels: { app: acadia-app }
  template:
    metadata:
      labels: { app: acadia-app }
    spec:
      containers:
        - name: nginx
          # Immutable tag: the bundle is baked in, so the tag IS the release.
          image: ghcr.io/gerbriel/acadia-app:2026-09-13-abc1234
          ports: [{ containerPort: 80, name: http }]
          readinessProbe:
            httpGet: { path: /healthz, port: http }
            initialDelaySeconds: 2
            periodSeconds: 10
          livenessProbe:
            httpGet: { path: /healthz, port: http }
            periodSeconds: 30
          resources:
            requests: { cpu: 10m, memory: 32Mi }
            limits:   { cpu: 200m, memory: 128Mi }
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities: { drop: ["ALL"] }
          volumeMounts:
            - { name: cache, mountPath: /var/cache/nginx }
            - { name: run,   mountPath: /var/run }
      volumes:
        - { name: cache, emptyDir: {} }
        - { name: run,   emptyDir: {} }
---
apiVersion: v1
kind: Service
metadata:
  name: acadia-app
spec:
  selector: { app: acadia-app }
  ports: [{ name: http, port: 80, targetPort: http }]
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: acadia-app
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-prod
spec:
  tls:
    - hosts: [app.acadia.example.com]
      secretName: acadia-app-tls
  rules:
    - host: app.acadia.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: acadia-app
                port: { name: http }
```

Note the two consequences of build-time config: the image tag is the release
(there is no ConfigMap to change), and `nginxinc/nginx-unprivileged` plus
`listen 8080` in `nginx.conf` is required if the cluster forbids binding :80.
