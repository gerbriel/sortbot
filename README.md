# Acadia — Vintage Clothing Listing Workflow

Acadia is a web app for vintage clothing resellers. Upload a batch of clothing photos, group the multi-angle shots of each item, assign categories, dictate a description per listing, and export a Shopify-ready product CSV — hundreds of listings per session.

**Live app:** https://gerbriel.github.io/sortbot (deployed from `main` via GitHub Actions)

> **Contributors / AI agents:** read [CLAUDE.md](CLAUDE.md) first. It is the authoritative codebase reference — architecture, data model, invariants, and a long list of things that look wrong but are deliberate.

---

## Features

### The listing pipeline

- 📤 **Batch upload** — drag-drop files, folders, or ZIPs. Images are canvas-compressed (max 2000 px, JPEG 0.88) and uploaded to Supabase Storage over TUS resumable uploads (survives connection drops mid-batch).
- 📅 **EXIF-aware ordering** — shot time (`DateTimeOriginal`) read on upload; Step 2 sorts and filters by capture date or original filename.
- 📦 **Grouping (Step 2)** — rubber-band multi-select, keyboard shortcuts (`Cmd+Enter` group, `Cmd+A` / `Cmd+Shift+A` / `Cmd+D` selection), auto-group by N photos per item, **pick mode** (auto-selects the next N ungrouped photos for rapid grouping), and a columns-per-row density slider (2–12).
- 🛠️ **Photo toolbar (Step 2)** — sticky toolbar above the grid: photo-pick mode (select individual photos, including inside group cards), rotate the selection ±90°, copy/paste rotation and crop across many photos, revert to original, delete selection.
- 🏷️ **Categories + presets** — drag groups onto category zones; presets auto-fill shipping, measurements, SEO title templates, and Shopify taxonomy. Per-group preset overrides persist across reloads.
- 🎤 **Voice descriptions (Step 3)** — Web Speech API dictation with field commands (`"brand Nike period"`, `"size large period"`, `"width 18 period"`, `"type crewneck period"`, `"description ... period"`).
- 💡 **Quick keyword chips (Step 3)** — one-click resale descriptors that patch the voice transcript and update the whole group. Chips related to the current item's brand float to the front with a "suggested" treatment.
- ✍️ **Title/tag engine** — builds ≤60-char SEO titles from garment type, brand, and description keywords; sizes always render as letter symbols (XL/XXL); category-aware synonym swapping prevents cross-category contamination.
- ✒️ **Model-written selling paragraph (opt-in, per workspace)** — a Cloudflare Workers AI model writes *only* the short selling paragraph; the rule-based engine still owns the description skeleton, so a model can never corrupt a measurement or price. Output is validated (length, banned phrases, and a numbers guard) and silently falls back to the rule-based text if anything fails.
- ✂️ **Crop tool** — crop/zoom any photo in Step 3, then copy the crop and paste it across many items; re-encoded images re-upload to the same storage path.
- 🛍️ **Shopify CSV export (Step 4)** — 54-column Shopify import format, group-wide field coalescing, rows in shoot order, a hard $0-price export block, and title/handle dedup against the export itself, the app's own database, **and the live Shopify catalog** (via the `shopify-titles` Edge Function).
- 💾 **Auto-save + session restore** — work-in-progress persists to Supabase on a 2 s debounce (it saves once you stop making changes); reload restores the active batch.
- 📚 **Library** — browse all batches/groups/images, rename, duplicate, delete (with a shared-storage-file reference guard), reopen any batch. Batch cards show who last edited them.

### Workspaces & administration

- 🏢 **Multi-org workspace tenancy** — each workspace sees only its own batches, products, and image *records* via org-membership RLS. Invite teammates by email with owner/admin/member roles; membership bootstraps automatically on sign-in. (Runs in a legacy shared-workspace mode until the tenancy migration is applied — the same build supports both. Per-org Shopify connections and the waitlist gate activate with that same migration; until then their UI stays hidden. See [Security](#security) for the current limits of this boundary.)
- 👤 **Header account menu** — workspace name, role, and email in one dropdown, with links to the workspace dashboard and sign-out.
- 📊 **Workspace dashboard** — tabbed panel for members and invites, workspace settings, beta request approvals, and (for founding admins) an aggregate directory of all workspaces and cross-workspace user management. Analytics, CRM, Finance and Errors are their own full-page views opened from the header.
- 🔌 **Per-org Shopify connections** — each workspace connects its own Shopify store (Workspace → Settings), so export dedup and per-store metaobject GIDs use that store. The Admin token is **write-only from the client** — only the Edge Function can read it.
- 🎨 **Per-workspace description format** — customize the measurement prefix, washing/closing lines, hashtag rendering, disclaimers, seller name, and selling-paragraph tone from the workspace panel.
- 📖 **Vocabulary dashboard (founding admins)** — CRUD the global knowledge base every workspace consumes: Step 3 quick-keyword chips, per-brand keywords (with a searchable built-in 917-brand library to copy from), and a brand/model database.
- 💬 **Messages (everyone)** — every signed-in user gets a floating **Messages** button *and* a full **Messages** page from the header, with an unread badge. Search your conversations, keep the thread open beside the list, send with Enter. For founding admins the same page is the **Inbox**: every conversation from every workspace, Open/Closed/All filters, unread first, close and reopen. Both views and the badge share one live connection, so they never disagree.
- 🛠 **Founder tools (founding admins)** — built in, no third-party services: a **CRM** where every beta request and account becomes a contact automatically (stages, tags, follow-ups, notes), a cookieless **analytics** dashboard (pageviews, sessions, signup→export funnel, referrers, devices), the **Inbox** half of Messages, a **Finance** module (income/expense ledger, monthly profit-and-loss, what the customer base is worth, CSV + printable reports), and an **Errors** view that groups the app's own crash reports into issues. Everything lives in this project's own Supabase tables. See [Founder tools](#founder-tools--analytics-crm-messaging-first-party).
- 🏬 **Marketing landing + private beta** — logged-out visitors get a product tour, pricing, and a beta signup form. New sign-ups without a workspace or invite hit a waitlist gate; founding admins approve or deny requests, and approval auto-creates the workspace on next sign-in.
- 🐛 **Debug logger** — a corner toggle enables categorized, colour-coded console logging plus DOM event tracing. Zero-cost when off; persisted across sessions.

### Mobile

The app is usable on a phone end to end. **Step 1 takes photos directly from the camera** ("Take photos") or the camera roll ("Choose from library") — the same compression, EXIF and resumable-upload pipeline as a desktop drop. Navigation changes with the screen: the full tool row on desktop, a scrolling rail on a tablet, and a **bottom tab bar** (Workflow / Library / Messages / More) on a phone, with everything else behind More. Tool pages reflow — wide tables become cards or scroll inside themselves, dialogs become bottom sheets, and every control is at least 44px with 16px text so iOS does not zoom the page.

**Desktop-only, by design:** dragging groups onto a category (on a phone you select photos and tap a category instead), drag-to-reorder photos, rubber-band selection, and the cursor-following magnifier. Crop works on touch. Voice dictation still needs Chrome or Edge.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19 + TypeScript 5.9 |
| Build | Vite 7 |
| Backend / DB | Supabase (Postgres + RLS, Storage, Auth, two Deno Edge Functions) |
| Tests | Vitest 4 + happy-dom (570 tests, 39 files) |
| Uploads | tus-js-client (resumable, 6 MB chunks) |
| Styling | Plain CSS, component-scoped files |
| Speech | Web Speech API (Chrome/Edge) |
| Images | Canvas compression, exifr (EXIF), Service Worker CDN cache |
| Icons | Lucide React |
| CI | GitHub Actions: tests, type-check, build verification, bundle secret-leak scan, lint ratchet, migration hygiene, `deno check` |
| Monitoring | First-party: `app_errors` table + a founder Errors panel, plus a 15-minute uptime probe. No Sentry, no third-party monitor. |

There is no application server — the app is a static SPA talking directly to Supabase. The only server-side code is the two Edge Functions in `supabase/functions/`:

| Function | Purpose |
|---|---|
| `shopify-titles` | Reads existing product titles/handles (and metaobject GIDs) from the merchant's Shopify store so the exporter can avoid collisions. Admin token stays server-side. |
| `generate-prose` | Writes the selling paragraph via Cloudflare Workers AI. Returns 503 when unconfigured, and the client falls back to rule-based text. |

## Getting Started

### Prerequisites

- **Node.js 20.19+ or 22.12+** (required by Vite 7; CI builds on Node 24)
- A [Supabase](https://supabase.com/) project (Postgres + a Storage bucket named `product-images`)

### Install & Run

```bash
git clone https://github.com/gerbriel/sortbot.git
cd sortbot
npm install
cp .env.example .env   # then fill in the two Supabase values
npm run dev            # http://localhost:5173
```

### Environment Variables

Only two variables are required — the app throws on load without them.

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-supabase-anon-key
# optional
VITE_STORAGE_LIMIT_GB=100   # storage meter denominator (1 = free tier)
```

> ⚠️ **Anything prefixed `VITE_` is compiled into the public JavaScript bundle and is readable by anyone who visits the site.** Only ever put publishable values there. The Supabase **anon** key belongs here by design — it is a public key, and RLS is what actually enforces access. A **service_role** key must *never* appear in a `VITE_` variable, in client code, or in this repo; it bypasses RLS entirely. See [Security](#security).

### Scripts

```bash
npm run dev        # dev server
npm test           # vitest run
npm run test:watch # vitest watch mode
npm run build      # tsc -b && vite build → dist/
npm run lint       # eslint
npm run preview    # preview the production build
```

Tests are characterization tests that lock in workflow-critical behavior: the title/size/voice engine, preset priority and preset resolution, the CSV builder (golden snapshot) and its formula-injection guard, Library data derivation, grouping conventions, the save→reload field whitelist, batch-delete tombstones, query pagination and chunk sizes, the compare-and-set on the workflow blob, the LRU image cache, the error reporter's privacy and fingerprint contracts, and the UI primitives' keyboard/ARIA behavior. Snapshots live in `src/lib/__snapshots__/` — update deliberately with `npx vitest run -u` only when output changes on purpose.

### CI and monitoring

| Workflow | Trigger | What it does |
|---|---|---|
| `.github/workflows/deploy.yml` | push to `main` | Builds and publishes `dist/` to GitHub Pages. The only path to production. |
| `.github/workflows/ci.yml` | every PR + every push to a non-`main` branch | `npm ci` → `npm test` → `npm run build` (dummy `VITE_*` values) → verifies `dist/index.html` has the right `<title>` and the `/sortbot/` base path → **greps the built bundle for credential-shaped strings** → lint ratchet (fails only if the problem count grew past `LINT_BASELINE`) → migration hygiene (every SQL file the PR changes must carry a ROLLBACK section and an idempotency note, because migrations are applied by hand) → `deno check` on the Edge Functions. Permissions are `contents: read`; it never deploys. |
| `.github/workflows/uptime.yml` | `*/15 * * * *` + manual | Curls the deployed page (must contain the app title) and `${VITE_SUPABASE_URL}/auth/v1/health` (must return 200), then files/comments on a single GitHub issue and closes it on recovery. Needs the `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` repository secrets. `schedule` is best-effort, so a missing run means *unknown*, not healthy. |

Crashes are reported by the app itself into its own `app_errors` table and read in the header **Analytics** view, Errors tab (see [Founder tools](#founder-tools--analytics-crm-messaging-first-party)).

### Optional: run it as a container

Production is GitHub Pages; `deploy/` exists for the three things Pages cannot do — a staging URL, a fully self-hosted deployment, and a rollback artifact that does not depend on re-running CI.

```bash
cp .env deploy/.env
docker compose -f deploy/docker-compose.yml up --build -d   # http://localhost:8088
curl -fsS http://localhost:8088/healthz                     # -> ok
```

Two stages: `node:24-alpine` runs `npm ci`, `npm test` and `npm run build`; `nginx:1.27-alpine` serves `dist/` with SPA fallback, immutable asset caching and a never-cached `index.html`/`sw.js`. Every `VITE_*` value is baked in at build time, so **one image per environment** — and never pass a `service_role` key or a Shopify Admin token as a build arg (the Dockerfile fails the build if it finds a credential-shaped string in `dist/`). `deploy/README.md` covers pointing the image at a self-hosted Supabase (use the **Kong** gateway URL, not Postgres), the `BASE_PATH` arg, adding a per-environment CSP to `nginx.conf`, and why Kubernetes is the wrong tool for a static SPA plus managed Postgres.

### Optional: Shopify title dedup

Each workspace connects its own store from **Workspace → Settings → Shopify**. The Admin token is write-only from the client; only the Edge Function reads it.

```bash
supabase functions deploy shopify-titles
```

The Shopify section of the workspace panel only appears once `supabase/migrations/org_shopify_connections.sql` has been applied (it depends on `multi_org_tenancy.sql`); until then the UI hides itself and the global fallback below is the only path.

A global fallback store (used only by the founding workspace / pre-tenancy legacy mode) can be set with Supabase secrets:

```bash
supabase secrets set SHOPIFY_STORE=my-store SHOPIFY_ADMIN_TOKEN=shpat_...
```

Without any connection, the exporter silently falls back to deduping against its own database only.

### Optional: selling paragraph

```bash
supabase secrets set CF_ACCOUNT_ID=... CF_API_TOKEN=...
supabase functions deploy generate-prose
```

Then enable it per workspace in **Workspace → Settings**. It is **off by default**; without the secrets the function returns 503 and listings keep their rule-based text.

### Founder tools — analytics, CRM, messaging (first-party)

Acadia has its own analytics, CRM, support messaging and finance. They are **features of this app, stored in this project's own Supabase tables** — no third-party service, no external API, no payment processor, no keys to configure. Each one is a migration in `supabase/migrations/` (run in the SQL Editor after `multi_org_tenancy.sql` + `beta_signups.sql`); the UI hides itself until its tables exist, so the code can ship first.

| Feature | Migration | Who sees it |
|---|---|---|
| **Analytics** — cookieless pageviews + funnel events (Beta Signup → Account Created → Batch Created → CSV Exported), daily chart, referrers, devices | `analytics_events.sql` | Tracking runs for every visitor (Do Not Track honored, localhost skipped). Dashboard: Founding admins, header **Analytics** button |
| **CRM** — one contact per email with stage (lead → approved → active → churned / lost), tags, next follow-up, notes. Beta requests and accounts (with their workspace) become contacts automatically via `crm_sync_contacts()` | `crm.sql` | Founding admins, header **CRM** button |
| **Messaging** — two ways into the same conversations: the floating **Messages** button, and a full **Messages** page from the header (the **Inbox** for founders) with search, an unread badge, keyboard navigation and Enter-to-send. Live via Supabase Realtime with a polling fallback — one connection shared by both views and the badge | `support_messaging.sql` | Every signed-in user (waitlisted users get the floating button); the Inbox for Founding admins |
| **Finance** — the founder's books: an income/expense ledger with recurring entries, monthly profit-and-loss over any range, per-workspace revenue, projected monthly recurring revenue at list price and after the founding discount, two CSV exports and a printable statement | `finance.sql` | Founding admins, header **Finance** button |
| **Errors** — one row per uncaught error, rejected promise, or caught render error, grouped into issues by a fingerprint that survives a redeploy. KPI tiles, a top-issues table (with the full message for copy/paste), plus daily and by-screen breakdowns | `app_errors.sql` | Reporting runs for every visitor (localhost skipped). Dashboard: Founding admins, header **Analytics** button → Errors tab |

**Not yet applied:** `analytics_events.sql`, `crm.sql`, `support_messaging.sql`, `app_errors.sql` and `finance.sql` are all written, additive, idempotent and carry their own rollback, but they must be run by hand in the Supabase SQL Editor. Until a tool's migration is run, that tool reports itself unavailable and shows a setup step instead of an error — Finance, for example, is safe to expose on the header before its tables exist. `finance.sql` seeds plan prices to match the pricing on the landing page (Starter $50, Basic $90, Growth $150, Pro $250, Business $350, Scale $700, Enterprise $1,200 per month) and a 30% founding discount, and seeds with `on conflict do nothing` so re-running it never overwrites a price you edited in the app.

Privacy: analytics rows carry a random per-tab session id, the referrer host, a coarse device class and — for signed-in users — their own user/workspace id. No cookies, no IP, no user agent. `select public.analytics_prune(365);` trims history.

Error rows are held to the same standard, and the database enforces it: `user_agent_class` is a closed vocabulary in a CHECK constraint (a browser family, never a full user agent), `path` is `location.pathname` with no query string or hash, and the message and stack are scrubbed of emails, UUIDs and opaque tokens **in the browser** before they are sent. Volume is capped three ways (one row per issue per 60 s, 20 per page load, 20 per session per 10 minutes in the database), because a crash loop is exactly the situation this table exists to catch. `select public.app_errors_prune(90);` trims history. Deliberate exception to the analytics rules: error reporting does not honor Do Not Track — DNT is about cross-site tracking, and a crash report about our own code is neither behavioural nor cross-site.

## Security

- **The Supabase anon key is public by design.** It ships in the client bundle (as it does in every Supabase SPA). It is not a secret — for database rows, RLS policies rather than the key are the access boundary.
- **Real secrets live only as Supabase Edge Function secrets** (`SHOPIFY_ADMIN_TOKEN`, `CF_API_TOKEN`), set via `supabase secrets set` and read server-side with `Deno.env`. They are never bundled, never committed, and never returned to the client.
- **Per-workspace Shopify tokens are write-only from the client**, enforced with column-level grants — the browser can store a token but cannot read one back. Only the Edge Function (service role) reads it.
- **`.env` is gitignored and must never be committed.** `.env.example` contains placeholders only.
- **Never add a `service_role` key to this repo or to any `VITE_` variable.** It bypasses all RLS and would expose every workspace's data. CI greps the built bundle for credential-shaped strings on every pull request, because this is the one mistake that cannot be walked back once deployed.
- **There is no third-party API key of any kind.** The OpenAI, Google Vision, Google Drive and Llama-vision code paths were deleted in Sept 2026 (they were dead), and their variables were dropped from `.env.example`. Only three `VITE_` variables exist.
- **A Content-Security-Policy ships in `index.html`.** GitHub Pages cannot send response headers, so it is a `<meta http-equiv>`; it matters because the Supabase session lives in `localStorage`, where any XSS would be a persistent account takeover. `script-src 'self'` with no `'unsafe-eval'` and no CDN; `connect-src` limited to `https://*.supabase.co` + `wss://*.supabase.co`; `img-src` adds only `data:`, `blob:` and `images.unsplash.com` (the landing-page photos); `object-src`/`base-uri` are `'none'`. Every origin was verified against the built bundle. Two directives are deliberately absent and documented in the file: `frame-ancestors` (ignored in a `<meta>` by spec — clickjacking protection needs a real header, i.e. a host that can send one) and `upgrade-insecure-requests` (it would break the dev server's HMR socket and buys nothing). **If you add an origin, update the meta tag — a blocked subresource fails silently.**
- **Both Edge Functions verify the caller, not just the JWT.** The Supabase anon key is itself a validly signed project JWT, so `verify_jwt` alone never proved a user: both functions resolve the caller through `/auth/v1/user` and return 401 without one. The global Shopify credentials are reachable only by a proven member of the founding workspace; the prose function additionally requires that workspace's `proseEnabled` opt-in, bounds its prompt, and treats the input as data. Neither echoes an upstream error body.
- **Passwords require 10 characters on sign-up.** Existing shorter passwords still work for sign-in. The server-side minimum and breach checking are dashboard settings — see below.

### Security work that is written but NOT yet applied

Code can only go so far. These are in the repo and waiting on the owner, in this order, after a database backup:

| Step | What | Notes |
|---|---|---|
| 1 | `supabase/migrations/security_invites_hardening.sql` | Closes an invited member's path to workspace **owner**. Needs `multi_org_tenancy.sql`; must run before step 2. |
| 2 | `supabase/migrations/security_verified_email.sql` | Stops every email-matching RLS policy from trusting the unverified JWT email claim. Precondition: confirm `select count(*) from auth.users where email_confirmed_at is null;` returns 0 first, and turn **Confirm email** on in the dashboard. |
| 3 | `supabase/migrations/security_abuse_limits.sql` | Size, format and rate limits on the three client-writable tables (analytics, beta signups, support messaging). All constraints are `NOT VALID`, so existing rows are untouched. |
| 4 | `supabase/migrations/security_storage_policies.sql` | Org-scoped write/delete policies on `storage.objects`. **Inert until you drop the permissive policy that exists in the dashboard** — RLS policies are OR'ed. Run its inventory query first, then smoke-test upload, Step 3 crop, "Compress N Images", and deleting a teammate's batch. |
| 5 | `supabase/migrations/app_errors.sql` | Turns on error reporting and the founder Errors panel. Independent of 1–4; needs `multi_org_tenancy.sql` + `beta_signups.sql`. |
| 6 | `deno check supabase/functions/*/index.ts` then `supabase functions deploy shopify-titles generate-prose` | **Then rotate `SHOPIFY_ADMIN_TOKEN` and `CF_API_TOKEN`** — assume both were reachable by anyone holding the public anon key. |

Supabase dashboard settings no code can set: Authentication → Providers → Email → **Confirm email**, **Leaked password protection**, **minimum password length 10** (the dashboard value is authoritative); Authentication → **MFA (TOTP)**, especially for founding admins, whose access reaches every workspace's membership, the CRM and all support threads; Authentication → **Rate limits**; Database → **PITR / backups**, because the delete paths are irreversible.

### Known limitation: image files are publicly readable

⚠️ **RLS scopes database rows, not image bytes.** The `product-images` Storage bucket is **public**: every image is served through an unauthenticated CDN URL, so anyone who has (or guesses) an image URL can fetch that photo without signing in — including after the tenancy migration, which scopes the `product_images` *rows* but not the files they point at.

Paths follow `{userId}/{productId}/{timestamp}-{random}.{ext}`, so URLs are unguessable in practice rather than by design. Treat uploaded photos as public data until private buckets + signed URLs land — every path→URL call in the app now goes through one helper (`src/lib/storageUrls.ts`), so that migration is a single function body rather than 23 call sites (tracked in [ANALYSIS.md](ANALYSIS.md) / CLAUDE.md §16).

`security_storage_policies.sql` (step 4 above) closes the **write** half of this — today any signed-in user of any workspace can overwrite or delete any other tenant's photos by path — and deliberately leaves SELECT public, because making it private is the separate signed-URL project. One mitigation already ships: signing out purges the Service Worker's image cache, so the next person on a shared machine cannot pull the previous workspace's photos out of it.

## Workflow

1. **Upload** — drop images/folders/ZIPs. Compression, TUS upload, and EXIF read happen automatically. The storage meter and compression tools live here.
2. **Group & Categorize** — group each item's photos (manually, auto-group by N, or pick mode), then drag groups onto category zones. Presets apply automatically.
3. **Describe** — navigate listing-by-listing; dictate or type; Generate Description builds the title, tags, and Shopify-style description; edit any of the ~50 fields. Everything auto-saves.
4. **Export** — review the 54-column preview, then download the Shopify import CSV. Export blocks if any product is missing a price.

## Database

The core workflow tables (`products`, `product_images`, `categories`, `category_presets`) are typed in `src/lib/supabase.ts`; the rest are typed in their own service modules (`workflowBatchService.ts`, `orgService.ts`, `shopifyConnectionService.ts`, `vocabService.ts`, `betaService.ts`). Schema and migration SQL live in `supabase/migrations/` (**read the warnings in CLAUDE.md before running any of them** — several rewrite RLS policies).

| Group | Tables |
|---|---|
| Workflow | `workflow_batches` (session state as JSONB), `products`, `product_images` |
| Configuration | `categories`, `category_presets` |
| Tenancy | `organizations` (incl. `description_settings` JSONB), `org_members`, `org_invites` |
| Integrations | `org_shopify_connections` (client-write-only Admin token) |
| Vocabulary | `descriptor_chips`, `brand_keywords`, `vocab_models` |
| Beta program | `beta_signups` |
| Founder tools | `analytics_events` (+ `analytics_summary()` / `analytics_prune()`), `crm_contacts`, `crm_notes` (+ `crm_sync_contacts()`), `support_threads`, `support_messages`, `app_errors` (+ `app_errors_summary()` / `app_errors_prune()`) |
| Finance | `finance_transactions` (the ledger — a row with a recurrence is a *template*, its repeats are expanded when read, never stored), `finance_plan_prices` (plan → monthly list price), `finance_settings` (founding discount percent and cutoff date) (+ `finance_summary()`) |

## Browser Support

| Feature | Chrome | Edge | Safari | Firefox |
|---------|--------|------|--------|---------|
| Voice recording | ✅ | ✅ | ⚠️ Partial | ❌ |
| Everything else | ✅ | ✅ | ✅ | ✅ |

## Project Docs

- [CLAUDE.md](CLAUDE.md) — full codebase reference (read before contributing)
- [CHANGELOG.md](CHANGELOG.md) — release history
- [ANALYSIS.md](ANALYSIS.md) — strengths/weaknesses assessment and the multi-org SaaS scaling roadmap

## License

MIT
</content>
