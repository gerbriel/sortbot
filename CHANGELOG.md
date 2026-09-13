# Changelog — Acadia

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
