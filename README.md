# Sortbot — Vintage Clothing Listing Workflow

Sortbot is a web app for vintage clothing resellers. Upload a batch of clothing photos, group the multi-angle shots of each item, assign categories, dictate a description per listing, and export a Shopify-ready product CSV — hundreds of listings per session.

**Live app:** https://gerbriel.github.io/sortbot (deployed from `main` via GitHub Actions)

> **Contributors / AI agents:** read [CLAUDE.md](CLAUDE.md) first. It is the authoritative codebase reference — architecture, data model, invariants, and a long list of things that look wrong but are deliberate.

---

## Features

- 📤 **Batch upload** — drag-drop files, folders, or ZIPs. Images are canvas-compressed (max 2000 px, JPEG 0.88) and uploaded to Supabase Storage over TUS resumable uploads (survives connection drops mid-batch).
- 📅 **EXIF-aware ordering** — shot time (`DateTimeOriginal`) read on upload; Step 2 sorts/filters by capture date or original filename.
- 📦 **Grouping (Step 2)** — rubber-band multi-select, keyboard shortcuts (`Cmd+Enter` group, `Cmd+A`/`Cmd+Shift+A`/`Cmd+D` selection), auto-group by N photos per item, and **pick mode** (auto-selects the next N ungrouped photos for rapid grouping).
- 🏷️ **Categories + presets** — drag groups onto category zones; presets auto-fill shipping, measurements, SEO title templates, and Shopify taxonomy. Per-group preset overrides persist across reloads.
- 🎤 **Voice descriptions (Step 3)** — Web Speech API dictation with field commands (`"brand Nike period"`, `"size large period"`, `"width 18 period"`, `"type crewneck period"`, `"description ... period"`).
- ✍️ **Title/tag engine** — builds ≤60-char SEO titles from garment type, brand, and description keywords; sizes always render as letter symbols (XL/XXL); category-aware synonym swapping prevents cross-category contamination.
- ✂️ **Crop tool** — crop/zoom any photo in Step 3, then copy the crop and paste it across many items; re-encoded images re-upload to the same storage path.
- 🛍️ **Shopify CSV export (Step 4)** — 63-column Shopify import format, group-wide field coalescing, $0-price export block, and title/handle dedup against the export itself, the app's own database, **and the live Shopify catalog** (via the `shopify-titles` Supabase Edge Function).
- 💾 **Auto-save + session restore** — work-in-progress persists to Supabase every 2 s; reload restores the active batch.
- 📚 **Library** — browse all batches/groups/images, rename, duplicate, delete (with shared-storage-file reference guard), reopen any batch. Batch cards show who last edited them.
- 👥 **Shared workspace** — all authenticated users see and can edit all batches (Supabase RLS collaborative policies).

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19 + TypeScript 5.9 |
| Build | Vite 7 |
| Backend / DB | Supabase (Postgres + RLS, Storage, Auth, one Deno Edge Function) |
| Uploads | tus-js-client (resumable, 6 MB chunks) |
| Styling | Plain CSS, component-scoped files |
| Speech | Web Speech API (Chrome/Edge) |
| Images | Canvas compression, exifr (EXIF), Service Worker CDN cache |
| Icons | Lucide React |

There is no application server — the app is a static SPA talking directly to Supabase. The only server-side code is `supabase/functions/shopify-titles` (reads existing Shopify product titles for export dedup; Admin token stays server-side).

## Getting Started

### Prerequisites

- Node.js 18+
- A [Supabase](https://supabase.com/) project (Postgres + Storage bucket `product-images`)

### Install & Run

```bash
git clone https://github.com/gerbriel/sortbot.git
cd sortbot
npm install
cp .env.example .env   # fill in the two Supabase values
npm run dev            # http://localhost:5173
```

### Environment Variables

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-supabase-anon-key
# optional
VITE_STORAGE_LIMIT_GB=100   # storage meter denominator (1 = free tier)
```

The two Supabase variables are required — the app throws on load without them. Everything else in `.env.example` is legacy/optional (see CLAUDE.md §4).

### Shopify title dedup (optional)

To enable live duplicate-title checking against your Shopify store at export time:

```bash
supabase secrets set SHOPIFY_STORE=my-store SHOPIFY_ADMIN_TOKEN=shpat_...
supabase functions deploy shopify-titles
```

Without this, the exporter silently falls back to deduping against its own database only.

### Build / Lint

```bash
npm run build    # tsc -b && vite build → dist/
npm run lint
npm run preview
```

There are currently **no automated tests**.

## Workflow

1. **Upload** — drop images/folders/ZIPs. Compression + TUS upload + EXIF read happen automatically. Storage meter and compression tools live here.
2. **Group & Categorize** — group each item's photos (manually, auto-group by N, or pick mode), then drag groups onto category zones. Presets apply automatically.
3. **Describe** — navigate listing-by-listing; dictate or type; Generate Description builds the title, tags, and Shopify-style description; edit any of the ~50 fields. Everything auto-saves.
4. **Export** — review the 63-column preview, then download the Shopify import CSV. Export blocks if any product is missing a price.

## Database

Supabase tables: `workflow_batches` (session state as JSONB), `products`, `product_images`, `categories`, `category_presets`. Authoritative TypeScript definitions in `src/lib/supabase.ts`; schema/migration SQL in `supabase/migrations/` (**read the warnings in CLAUDE.md before running any of them**).

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
