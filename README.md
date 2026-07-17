# Sortbot — Vintage Clothing Listing Workflow

Sortbot is a web app for vintage clothing resellers. Upload a batch of clothing photos, group the multi-angle shots of each item, assign categories, dictate a description per listing, and export a Shopify-ready product CSV — hundreds of listings per session.

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
- 📊 **Workspace dashboard** — tabbed panel for members and invites, workspace settings, beta request approvals, and (for founding admins) an aggregate directory of all workspaces.
- 🔌 **Per-org Shopify connections** — each workspace connects its own Shopify store (Workspace → Settings), so export dedup and per-store metaobject GIDs use that store. The Admin token is **write-only from the client** — only the Edge Function can read it.
- 🎨 **Per-workspace description format** — customize the measurement prefix, washing/closing lines, hashtag rendering, disclaimers, seller name, and selling-paragraph tone from the workspace panel.
- 📖 **Vocabulary dashboard (founding admins)** — CRUD the global knowledge base every workspace consumes: Step 3 quick-keyword chips, per-brand keywords (with a searchable built-in 917-brand library to copy from), and a brand/model database.
- 🏬 **Marketing landing + private beta** — logged-out visitors get a product tour, pricing, and a beta signup form. New sign-ups without a workspace or invite hit a waitlist gate; founding admins approve or deny requests, and approval auto-creates the workspace on next sign-in.
- 🐛 **Debug logger** — a corner toggle enables categorized, colour-coded console logging plus DOM event tracing. Zero-cost when off; persisted across sessions.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19 + TypeScript 5.9 |
| Build | Vite 7 |
| Backend / DB | Supabase (Postgres + RLS, Storage, Auth, two Deno Edge Functions) |
| Tests | Vitest 4 + happy-dom |
| Uploads | tus-js-client (resumable, 6 MB chunks) |
| Styling | Plain CSS, component-scoped files |
| Speech | Web Speech API (Chrome/Edge) |
| Images | Canvas compression, exifr (EXIF), Service Worker CDN cache |
| Icons | Lucide React |

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

Tests are characterization tests that lock in workflow-critical behavior: the title/size/voice engine, preset priority, the CSV builder (golden snapshot), Library data derivation, grouping conventions, the save→reload field whitelist, and batch-delete tombstones. Snapshots live in `src/lib/__snapshots__/` — update deliberately with `npx vitest run -u` only when output changes on purpose.

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

## Security

- **The Supabase anon key is public by design.** It ships in the client bundle (as it does in every Supabase SPA). It is not a secret — for database rows, RLS policies rather than the key are the access boundary.
- **Real secrets live only as Supabase Edge Function secrets** (`SHOPIFY_ADMIN_TOKEN`, `CF_API_TOKEN`), set via `supabase secrets set` and read server-side with `Deno.env`. They are never bundled, never committed, and never returned to the client.
- **Per-workspace Shopify tokens are write-only from the client**, enforced with column-level grants — the browser can store a token but cannot read one back. Only the Edge Function (service role) reads it.
- **`.env` is gitignored and must never be committed.** `.env.example` contains placeholders only.
- **Never add a `service_role` key to this repo or to any `VITE_` variable.** It bypasses all RLS and would expose every workspace's data.

### Known limitation: image files are publicly readable

⚠️ **RLS scopes database rows, not image bytes.** The `product-images` Storage bucket is **public**: every image is served through an unauthenticated CDN URL (`getPublicUrl`), and no migration applies policies to `storage.objects`. Anyone who has (or guesses) an image URL can fetch that photo without signing in — including after the tenancy migration, which scopes the `product_images` *rows* but not the files they point at.

Paths follow `{userId}/{productId}/{timestamp}-{random}.{ext}`, so URLs are unguessable in practice rather than by design. Treat uploaded photos as public data until private buckets + signed URLs land (tracked in [ANALYSIS.md](ANALYSIS.md) / CLAUDE.md §16).

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
