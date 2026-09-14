# Changelog — Acadia

## 2026-09-13 — Engineering review: six passes over the whole codebase

Six audits (architecture, latent defects, performance, UI system, security, DevOps) were run against the tree and each was then implemented. Reports and implementation logs are in `docs/reviews/`. End state: **505 tests / 35 files green** (from 305/24), `npm run build` clean, **254 lint problems** (from 311), **no dependency added or removed**, and no `sortbot_*` storage key renamed.

Most of this is invisible to a user in the good sense — the app does the same things, with fewer ways to lose their work. **Two things need the owner: five SQL migrations to run and a handful of Supabase dashboard settings to turn on.** Both lists are at the bottom.

### Data loss and correctness (`docs/reviews/02-debugging-fixes.md`, `03-performance-fixes.md`)

- **Six queries silently truncated at 1,000 rows and now paginate.** PostgREST caps a response with no error, so a partial read looked like a complete one. The worst of them meant deleting a 1,500-item batch permanently orphaned 500 products' images and storage files; another meant a 1,500-item batch reloaded with 500 items missing every saved field (description, price, tags). A read that cannot be completed now refuses to delete storage rather than guessing.
- **Field edits in Step 3 could be silently discarded.** The product update treated "0 rows changed" as success, so an RLS-blocked or missing row lost the edit. It is now checked, and it also writes the group *leader* row (the one the restore path reads) before mirroring onto the rest of the group, so no later re-grouping can strand a listing's text on a row nothing reads.
- **Reopening a batch no longer destroys a group's other photos.** The `product_images` refresh wiped and re-inserted; it now merges against what is already there, keeps positions, drops only genuinely stale rows, and skips the wipe entirely if it could not read the existing rows first.
- **Deleting a batch is ordered so a failure leaves a recoverable state**: reference-count, claim, confirm the batch row is gone, then children, then storage files last.
- **Cancelling an upload cleans up after itself** — the rows and files it had already created are deleted (rows before files). One rough edge remains: cancelling during the first chunk leaves an empty batch in the Library.
- **Duplicating a batch used to produce an empty one.** It now copies the items.
- **An upload could wedge the whole batch** if a resumable-upload session hung; there is now a 5-minute watchdog that falls back to a normal upload.
- **Items no longer get stolen between batches** by the Step 2 saves, and the ±24 h orphan-adoption fallback is now restricted to genuinely unassigned rows belonging to the current user.
- **"No price" is saved as empty instead of $0**, so a reload no longer pins a fake price (and the $0 export block still fires for a real 0).
- **Library's delete of individual images no longer discards concurrent work** (a compare-and-set on the shared session blob). *Known and still open:* deleting an image in Library while its batch is open can be undone by the open session's next auto-save — the fix is a behaviour change and is waiting on a decision.
- **A dangerous one-time cleanup was deleted.** It ran unscoped storage-row deletions with no workspace filter on first load per browser; under multi-workspace RLS it could have reached another workspace's rows.

### Speed and memory (`docs/reviews/03-performance-fixes.md`)

- **First load parses ~30% less JavaScript**: the main bundle went 1,250 kB → ~875 kB raw (363 → ~259 kB gzipped) and the render-blocking stylesheet 189 kB → 112 kB (−40%), by loading the ZIP and EXIF libraries only when those features are used and every modal only when it is opened.
- **Step 2 is dramatically cheaper to render**: date labels on 1,500 cards went from 84.6 ms to 0.07 ms per render, the name sort 19× faster, and rubber-band selection now repaints at most once per frame instead of once per mouse event (and halves its forced layouts).
- **The tab no longer runs out of memory during bulk crop work.** The decoded-image cache was unbounded (~24 GB at 1,500 images; the tab died somewhere around 130–250) and is now a 512 MB least-recently-used cache.
- **Auto-save writes half as much**: derived image URLs are no longer stored in the session blob, since every restore path rebuilds them from the storage path anyway (1,066 KB → 508 KB per save at 1,500 items). Items with no storage path keep theirs.
- **The crash backup no longer blocks the UI on every click** (a ~393 KB synchronous write, now throttled to at most once a second and flushed when the page goes away), and the compress-tracking registry went from an O(n²) rewrite per image to one write.
- **Saving a batch makes 60% fewer requests** (1,875 → 750 for 1,500 images), and Step 3's preset pass makes one request instead of 375.
- Unmount now cancels the timers and animation loops that used to keep running against a detached page.

### Security (`docs/reviews/05-security-fixes.md`)

- **Both Edge Functions now verify who is calling.** The public anon key is itself a valid project token, so the built-in JWT check never proved a user: the Shopify function was dumping the founding store's entire product catalog to anyone with the public key, and the description-paragraph function was an unmetered AI proxy on the owner's Cloudflare account. Both now require a real signed-in user; the global Shopify credentials are reachable only by a proven member of the founding workspace; the paragraph function requires that workspace's opt-in, bounds its prompt, and treats the input as data, not instructions. Neither function echoes an upstream error body any more.
- **Store-domain input is validated**, closing a server-side request forgery vector (`evil.com/.myshopify.com` and friends).
- **A Content-Security-Policy ships in `index.html`** — the app's session tokens live in browser storage, so this is what makes injected script useless. No remote scripts, no `eval`, network limited to Supabase plus the landing page's photo host.
- **CSV exports can no longer carry a spreadsheet formula** (`=`, `+`, `@`, leading tab/CR are neutralized; `-12.50` still exports as a number). The golden export snapshot is byte-identical.
- **Mail links are validated** — a beta applicant's email address could previously inject extra headers into the owner's mail client.
- **Live updates no longer leak deleted support threads** to every subscriber.
- **Sign-up requires a 10-character password** (existing accounts are unaffected), and **signing out purges the cached images** the Service Worker was holding for 7 days — relevant on a shared machine.

### Reliability and operations (`docs/reviews/06-devops-monitoring.md`)

- **CI on every pull request** (`.github/workflows/ci.yml`): tests, type-check, production build, verification that the built page keeps its title and its `/sortbot/` asset paths, a scan of the built bundle for credential-shaped strings, a lint ratchet that fails only if the debt grew, a rule that every migration touched by the change documents its rollback and is safe to re-run, and a type-check of the Edge Functions. It has read-only permissions and never deploys.
- **The app reports its own crashes** into its own `app_errors` table, grouped into issues by a fingerprint that survives a redeploy, readable in **Workspace → Founder tools → Errors**. Messages and stacks are scrubbed of emails and identifiers in the browser; the database itself refuses to store a full user agent; volume is capped three ways so a crash loop cannot flood the table. Inert until the migration is run — the panel shows a setup hint instead of an error.
- **An uptime probe every 15 minutes** (`.github/workflows/uptime.yml`) checks the deployed page and Supabase's auth health and files a single GitHub issue on failure, closing it on recovery. Its limits are written into the file: a skipped cron run means *unknown*, not healthy, and no probe can see a broken access-control policy.
- **Optional container packaging** in `deploy/` (Docker + nginx, `/healthz`, SPA fallback, cache headers) for a staging URL, self-hosting, or a rollback artifact that does not depend on re-running CI. GitHub Pages remains production.

### Internal structure (`docs/reviews/01-architecture-refactors.md`, `04-ui-system.md`)

- **20 dead files / 5,819 lines deleted** — all six unused components, the unused presence hook, and the OpenAI / Google-Vision / Llama-vision code paths, which is what makes "there is no third-party API key in this app" true rather than aspirational. Their variables were dropped from `.env.example`.
- **Five new single-purpose modules** replaced duplicated logic: the database-row→item conversion (two copies plus two 45-field merges, whose seven real differences are now explicit options), the storage-path→URL conversion (23 inline copies — which turns the future private-image migration into a one-function change), ID chunking (18 hand-written loops), preset matching (two diverging matchers), and the crash backup.
- **The session-blob item type is honest now** — one type instead of a 5-field claim about a 15-field reality, which removed the unchecked casts that claim required.
- **Library thumbnails get the retry-on-failure behaviour** the rest of the app already had (it had its own copy of the image component).
- **Diagnostic logging is gated again** — 76 stray console calls routed through the debug logger, with the expensive ones skipped entirely when debug is off.
- **A tested UI primitive library landed in `src/components/ui/`** (13 components, 76 tests) — real focus traps, keyboard-navigable tabs, required accessible names on icon buttons, one confirm pattern instead of six copies. **It is not adopted yet**: nothing outside that folder uses it, and adoption is an 18-step plan ordered by risk. Nothing in the app changed visually.

### Migrations to run, in this order

All are additive, idempotent, and carry their own rollback. **Take a database backup first.**

1. `supabase/migrations/security_invites_hardening.sql` — closes an invited member's path to workspace owner. Needs `multi_org_tenancy.sql`; must precede step 2.
2. `supabase/migrations/security_verified_email.sql` — stops email-matching access rules from trusting an unverified address. Precondition: confirm `select count(*) from auth.users where email_confirmed_at is null;` returns 0, and turn **Confirm email** on.
3. `supabase/migrations/security_abuse_limits.sql` — size/format/rate limits on the three tables the browser can write to. Existing rows are untouched.
4. `supabase/migrations/security_storage_policies.sql` — stops one workspace overwriting or deleting another's image files. **Inert until you drop the permissive policy that currently exists in the dashboard** (its inventory query finds it), then smoke-test upload, Step 3 crop, "Compress N Images", and deleting a teammate's batch.
5. `supabase/migrations/app_errors.sql` — turns on error reporting and the Errors panel. Independent of 1–4.

Then `deno check supabase/functions/*/index.ts`, `supabase functions deploy shopify-titles`, `supabase functions deploy generate-prose`, and **rotate `SHOPIFY_ADMIN_TOKEN` and `CF_API_TOKEN`** — assume both were reachable by anyone holding the public key.

### Supabase dashboard settings (code cannot set these)

- Authentication → Providers → Email: **Confirm email** (the precondition for migration 2), **Leaked password protection**, **minimum password length 10** (the dashboard value is the authoritative one).
- Authentication → **MFA (TOTP)**, especially for founding admins — that role reaches every workspace's membership, the CRM, and all support threads.
- Authentication → **Rate limits**. Database → **PITR / backups**: the delete paths are irreversible.
- For the uptime workflow: repository secrets `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.

## 2026-09-13 — Founder tools built in: analytics, CRM, messaging (first-party)

The app is 100% self-reliant for these: no third-party service, no external API. Everything is a table in this project's own Supabase database plus React UI. (An earlier same-day pass had integrated Twenty CRM, Plausible and Chatwoot — first hosted, then self-hosted; it was replaced outright by the native features below and no trace of it ships.)

### Analytics (`supabase/migrations/analytics_events.sql`, `src/lib/analytics.ts`, `AnalyticsPanel.tsx`)
- Cookieless first-party tracking: one `analytics_events` row per pageview / funnel event, written straight from the browser (anon landing visitors included; anon rows can never carry an identity, signed-in rows only their own user id — RLS). Random per-tab session id, referrer **host only**, coarse device class; no cookies, IP or user agent. Honors Do Not Track; skips localhost (`localStorage sortbot_analytics_force=1` to override).
- Events: `pageview` on every top-level view change (landing / auth / waitlist / app), plus Beta Signup, Account Created, Batch Created, CSV Exported.
- `analytics_summary(days)` RPC (Founding admins) returns totals + previous-period totals, a zero-filled daily series, top events, referrers, devices and views in one round-trip; `analytics_prune(days)` trims history.
- Dashboard in **Workspace → Founder tools → Analytics**: 7/30/90-day range, KPI tiles with deltas, a daily pageview column chart (thin bars, rounded caps, hairline grid, per-bar tooltip, keyboard-focusable), the four-step funnel with conversion rates, and events / referrers / devices tables — every charted value is also in a table.

### CRM (`supabase/migrations/crm.sql`, `src/lib/crmService.ts`, `CrmPanel.tsx`)
- `crm_contacts` (one per email: stage lead → approved → active → churned / lost, tags, next follow-up, links to the auth user + workspace, last seen) and `crm_notes` (timeline). Founding admins only (every policy is `is_beta_admin()`); note authorship is pinned to the caller.
- `crm_sync_contacts()` mirrors beta requests and accounts (with their oldest non-founding workspace) into contacts — new orgs and users show up by themselves; runs on panel open, on the Sync button, and after a beta approve/deny. It never overwrites hand edits: names/companies only fill blanks, stage only moves forward from lead/approved, tags/follow-ups/notes are untouched. The Founding Workspace's own members are skipped.
- Panel: stage chips with counts, a "Due" chip for overdue/today follow-ups, search across email/name/company/tags, inline stage select + follow-up date (overdue/today/soon styling), expandable rows with editable name/company/tags, notes with add/delete, manual "Add contact", two-step delete.

### Messaging (`supabase/migrations/support_messaging.sql`, `src/lib/supportService.ts`, `SupportWidget.tsx`)
- `support_threads` (one per conversation, denormalized email/workspace for the inbox, trigger-maintained last-message/preview/read stamps, open/closed) and `support_messages`. RLS: a user sees only their own threads and may only post as `user` in them; Founding admins see everything and post as `founder`. Both tables are added to the Realtime publication (replica identity full) so updates are live; the widget also polls every 45 s as a fallback.
- Floating **Messages** button (bottom-right) for every signed-in user — waitlisted users at the gate included — with an unread badge, conversation list, new-conversation composer, Enter-to-send. For Founding admins the same button is the **Inbox**: open/closed filter, unread-first ordering, reply, close/reopen.

### Plumbing
- New keys: `sortbot_analytics_session` (sessionStorage) and `sortbot_analytics_force` (localStorage) — listed in CLAUDE.md §1. No env vars, no Edge Function, no new dependency.
- 16 new tests: tracker privacy contract (session id, DNT/localhost gating, referrer host, row shape), dashboard math (funnel, compact numbers, deltas, tick ceilings), CRM list logic (tags, follow-up urgency, filter/sort/counts), messaging unread/ordering/timestamps.

## 2026-09-13 — Rename to Acadia

### Brand
- **Arcatya → Acadia** across every user-visible surface: landing page, auth, waitlist gate, app header wordmark, invite and beta-approval emails, browser title and meta description, the beta.html redirect page, the index.css header comment, README, ANALYSIS, CLAUDE.md
- No structural identifier changed — the `/sortbot/` base path and every `sortbot_*` localStorage key still read `sortbot` (see CLAUDE.md §1)

## 2026-07-29 — Rebrand to Arcatya + dark theme

### Brand
- **Sortbot → Arcatya** across every user-visible surface: landing page, auth, waitlist gate, app header (now a wordmark, with the descriptor moved to the subtitle), invite emails, browser title, README, CHANGELOG
- Structural identifiers deliberately still read `sortbot` and must not be renamed without a migration — the `/sortbot/` base path (derived from the GitHub repo name; changing it 404s every asset) and the `sortbot_*` localStorage keys (in-progress batch, delete tombstones, the compressed-paths set covering all 4,854 storage files, debug toggle). Documented as a table in CLAUDE.md §1.

### Dark theme
- `src/index.css` is now the single source of truth for color, elevation and motion: near-black canvas (`--ink-950` `#08080a`, never pure black), violet accent (`--accent` `#b087ff`), gold secondary, one shared easing curve
- **The legacy `--gray-*` ramp was inverted rather than replaced** — `--gray-50` was the lightest background and is now the darkest surface; `--gray-600/700` were text and are now near-white. That let ~13,300 lines of existing CSS flip correctly without per-rule edits.
- All 24 CSS files converted to tokens (~1,400 color literals), plus the hardcoded colors in TSX inline styles and runtime `element.style` assignments, which no stylesheet change could reach
- Category default palette reseeded — the old brand indigo was being written into every new workspace's `categories` table as persisted data

### Accessibility fixes surfaced by the conversion audit
- `--shopify-red-dark` was referenced by `.button-danger:hover` but **never defined anywhere**, so the hover state silently dropped its background and the label vanished (1.09:1). Now defined.
- `--text-muted` measured 4.34:1 on `--ink-850` — under AA, on the surface cards actually use. Lifted to 5.38:1. At a 9 px root font nothing in this app qualifies for WCAG's large-text exemption, so 4.5:1 applies to every string.
- `--gray-100` resolved byte-identical to `--ink-850`, making page canvas and cards the same color; remapped to the canvas step
- Added `--border-control` (3:1) for interactive edges — the decorative border tokens left inputs and buttons with no visible boundary at rest
- Solid accent/semantic fills now carry dark labels (`--text-primary` on `--accent` is only 2.46:1)
- `prefers-reduced-motion` honored; dark scrollbars, selection color, and a pre-paint canvas in `index.html` so there is no white flash on load

## 2026-07 — Title Engine, Export Integrity & Collaboration

### Title / Tags / Voice Engine Overhaul
- Category-aware synonym system: `fitTo60` detects the active garment type and only swaps synonyms within that group — no more sweatshirt titles absorbing tee terms
- New voice **"type"** (garment) and **"description"** fields; titles built from description keywords when a spoken description exists
- Sizes always render as letter symbols (XL / XXL / XXXL); many spoken size forms normalized
- Color/material dropped from title formulas; color modifiers stripped ("Faded Out White" → White); material split into primary (Shopify GID) vs full composition (description)
- User-typed titles are respected: used as the description opener and never overwritten by Regenerate

### Export Integrity & Shopify Cross-Reference
- Group-wide field coalescing — exported price/brand/size no longer depend on which photo happens to lead the group
- Export blocks (alert + banner) when any product has no price
- Titles/handles deduplicated against the export, the app's own database, **and the live Shopify catalog** via the new `shopify-titles` Supabase Edge Function (first server-side code; Admin token stays server-side)

### Collaboration
- `collaborative_edit_policies.sql`: any authenticated user can INSERT/UPDATE workflow tables (DELETE stays owner-scoped) — editing someone else's batch saves in place instead of forking a duplicate
- Library batch cards show "edited by <email>" (`lastEditedBy`/`lastEditedAt` stamped on auto-save)
- Batch/listing delete works on any batch (claims ownership before delete)

### Reliability
- Shared-storage-file guard (`storageSafety.ts`): deleting a batch no longer wipes files still referenced by a duplicated batch
- Batch reopen matches items by `productGroup` (was title/position — bled wrong images across products)
- Preset overrides persist across reloads (`applied_preset_id` column); 500 ms debounced field saves + `beforeunload` flush
- Image load errors no longer delete database rows; pick mode works with categorized singletons (ungroup→crop→regroup flow)

### UI
- Pick mode (auto-select next N ungrouped photos) + 1–10 quick-pick slider; columns-per-row slider (2–12)
- Density pass: 9 px base font (67%-zoom look at 100%), narrower right sidebar, rebalanced gutters

## 2026 H1 — Scale & Workflow Hardening (summary)

- TUS resumable uploads (6 MB chunks) for large batches on unreliable connections
- Canvas compression on upload (max 2000 px / JPEG 0.88) + bucket-wide recompression tools (~2.3 GB reclaimed)
- Crop/zoom tool in Step 3 with copy-crop → paste-crop across items; in-memory image cache
- EXIF `DateTimeOriginal` capture ordering + rescan backfill; original filename persistence and name sort
- Step 2: vertical sidebar, sort/filter bars, auto-group by N, select-all shortcuts, `Cmd+Enter` grouping
- Library: gap-fill recovery for corrupted batches, orphan cleanup, dedup fixes, newest-first sort
- Service Worker CDN image cache (stale-while-revalidate, 7-day TTL)
- Centralized debug logger with per-category colors and DOM event tracing
- Voice command table with inline editing; Shopify taxonomy mapping in CSV export

See `CLAUDE.md` §15 for the exhaustive commit-by-commit record.

---

## [2025] - Natural Product Descriptions Update

### 🎯 Major Changes

#### Enhanced Product Fields
- Added **8 new fields** to product data structure:
  - `brand` - Manual brand entry (no auto-detection)
  - `condition` - Dropdown: NWT, Excellent, Good, Fair
  - `flaws` - Text input for transparency (e.g., "minor pilling on sleeves")
  - `material` - Fabric composition or "unknown"
  - `measurements` - 7 fields: pit-to-pit, length, waist, inseam, rise, shoulder, sleeve
  - `era` - Time period/vibe (e.g., "90s", "Y2K", "workwear")
  - `care` - Care instructions

#### Rewritten AI Description Generator
- **Removed banned phrases**: "perfect for any occasion", "timeless piece", "elevate your wardrobe", "must-have"
- **Fact-based descriptions**: Only uses provided data, no hallucinations
- **Natural conversational tone**: Sounds like a real person, not AI
- **Transparency**: Mentions condition and flaws honestly
- **Measurements included**: Builds trust and reduces returns
- **"Feels like" language**: Uses qualifiers for uncertain details (e.g., "Material feels like polyester")
- **Limited adjectives**: Max 6-10 adjectives for natural flow
- **All colors included**: Captures every color mentioned in voice description

#### Description Structure
1. **Opening**: Era + Brand + Colors + Category + Voice description
2. **Size & Fit**: Tagged size with fit notes
3. **Condition**: Honest assessment with any flaws mentioned
4. **Measurements**: Formatted list of all measurements
5. **Material**: Fabric info or "unknown" with transparency
6. **Care**: Instructions if provided
7. **Closing**: Helpful reminder to compare measurements

### 📋 Example Before/After

#### BEFORE (AI-sounding):
```
Discover this timeless Lakers jacket - a must-have piece that will elevate your wardrobe! 
Perfect for any occasion, this versatile piece offers unparalleled style and comfort. 
Don't miss this opportunity to own a piece of Lakers history!
```
❌ Problems: Banned phrases, no specifics, salesy tone, no useful info

#### AFTER (Natural):
```
Mid-2000s blue and white Lakers warmup jacket. Tagged XL, fits true to size with a 
roomy athletic cut.

Condition: Good vintage wear - minor pilling on sleeves, but no holes or stains.

Measurements:
• Pit to pit: 24"
• Length: 28"
• Sleeve: 26"

Material feels like polyester or nylon blend. Full zip, side pockets, elastic cuffs and 
waist. Machine wash cold. Compare measurements to your favorites!
```
✅ Benefits: Factual, specific, honest, helpful, natural tone

### 🎨 UI Improvements

Added comprehensive manual input fields:
- Brand text input
- Condition dropdown (4 options)
- Flaws text input
- Material input
- Era/Vibe input
- Care instructions input
- Measurements section (7-field grid layout)

All fields update the entire product group simultaneously for consistency.

### 🚫 Banned Phrases Filter

Implemented automatic filtering of:
- "perfect for any occasion"
- "timeless piece"  
- "elevate your wardrobe"
- "must-have"
- "wardrobe staple"
- "unparalleled"
- "investment piece"
- "holy grail"
- "game changer"

### 📈 Benefits

1. **Reduced Returns**: Measurements provide accurate fit info
2. **Increased Trust**: Honest condition and flaw disclosure
3. **Better SEO**: Natural language improves search rankings
4. **Avoids AI Detection**: Descriptions sound human-written
5. **Faster Approval**: No banned phrases to edit out
6. **Professional**: Builds credibility with transparency

### 🔧 Technical Details

- Updated `ClothingItem` interface in `App.tsx`
- Rewrote `handleGenerateProductInfo` function in `ProductDescriptionGenerator.tsx`
- Added helper functions: `removeBannedPhrases`, `formatMeasurements`, `formatCondition`
- Maintained all existing features (voice recognition, color detection, pricing)
- No breaking changes - backwards compatible with existing data

### 📚 Documentation Added

- `DESCRIPTION_BEST_PRACTICES.md` - Comprehensive 9-point guideline system
- `AI_PROMPT_IMPROVEMENTS.md` - Implementation details and examples

---

## Previous Updates

### v1.6 - Excel Export with Embedded Images
- Added ExcelJS library for .xlsx generation
- Images embedded directly in cells, not just file paths
- High-quality image compression and formatting

### v1.5 - GitHub Actions Deployment
- Automated deployment to GitHub Pages
- Custom domain support ready
- Build and deploy on every push to main

### v1.4 - Google Drive Integration
- Load images directly from shared Drive folders
- No downloads required - images processed in browser
- Batch import with progress tracking

### v1.3 - SEO Title Improvements
- Removed hard 70-character limit
- Smart word-boundary trimming
- Includes ALL colors and key features

### v1.2 - Console Cleanup
- Removed 19+ console.log statements
- Production-ready logging
- Cleaner browser console

### v1.1 - Color Organization Fix
- ALL colors now included in titles and descriptions
- Consistent color detection across fields
- Improved natural color combinations

### v1.0 - Initial Release
- React + TypeScript + Vite setup
- Voice recognition for product descriptions
- AI-powered description generation
- CSV and Excel export
- Google Sheets integration
- Category-based organization
