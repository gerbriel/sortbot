-- ============================================================================
-- SEED: Kanban board ← Feature Atlas (140 cards)
-- ============================================================================
-- Preseeds the Founding Workspace kanban board with every feature from the
-- July 2026 Feature Atlas (codebase-wide capability map): one card per feature,
-- one task per sub-feature, wiring/relationships in the card notes.
--
-- LANE MAPPING (atlas status → lane):
--   done              → Done         (110 cards — completed_at stamped, tasks 'done')
--   partial           → In progress  (  5 cards — works with a known gap)
--   migration-pending → In review    (  6 cards — code shipped, awaiting manual SQL)
--   built-not-wired   → To do        ( 10 cards — needs a wiring decision/work)
--   dead              → Backlog      (  9 cards — cleanup / deletion candidates)
--
-- PREREQUISITES (run first, in this order):
--   1. multi_org_tenancy.sql   (organizations table + Founding Workspace)
--   2. kanban_board.sql        (kanban tables + default lanes)
--
-- RE-RUN SEMANTICS (read before running a second time): every card insert is
-- guarded by NOT EXISTS on (org_id, title), and tasks ride inside the card's
-- CTE, so an existing card is skipped wholesale. A re-run inserts nothing new
-- ONLY while the seeded cards keep their exact titles and the five default
-- lanes keep their names:
--   * RENAMED CARD → its guard misses and a pristine DUPLICATE (fresh tasks,
--     original lane) is inserted beside the edited one.
--   * DELETED SEEDED CARD → it is re-inserted (restore-by-re-run).
--   * DELETED/RENAMED DEFAULT LANE → the ensure block below re-creates the
--     old-named lane (unlike kanban_board.sql it has no "only when the org has
--     zero lanes" guard — the card inserts join lanes BY NAME and need them),
--     and that lane's seeded cards are re-inserted there.
-- Once the team has started editing the board, treat this file as a one-shot:
-- to truly re-seed, run the ROLLBACK delete below first, then the file.
--
-- SQL-EDITOR NOTE: default_org_id() reads auth.uid(), which is NULL in the SQL
-- Editor — every insert below therefore resolves org_id explicitly via
-- slug = 'founding'. created_by stays NULL (no author), which the board renders
-- fine; assignees are empty for the team to claim.
--
-- ROLLBACK (removes ONLY seeded cards; tasks/comments cascade):
--   delete from public.kanban_cards
--   where notes like '%[seeded: feature-atlas 2026-07-19]%';
-- ============================================================================

begin;

-- ── Guards: prerequisites must exist ────────────────────────────────────────
do $$
begin
  if to_regclass('public.organizations') is null then
    raise exception 'organizations table missing — run multi_org_tenancy.sql first';
  end if;
  if to_regclass('public.kanban_cards') is null then
    raise exception 'kanban tables missing — run kanban_board.sql first';
  end if;
  if not exists (select 1 from public.organizations where slug = 'founding') then
    raise exception 'Founding Workspace (slug=founding) not found — run multi_org_tenancy.sql first';
  end if;
end $$;

-- ── Ensure the five default lanes exist (idempotent; restores a missing lane
--    because the cards below need their lanes — skips lanes already present) ─
insert into public.kanban_columns (org_id, name, rank, is_done)
select o.id, v.name, v.rank, v.is_done
from public.organizations o
cross join (values
  ('Backlog',     1000.0, false),
  ('To do',       2000.0, false),
  ('In progress', 3000.0, false),
  ('In review',   4000.0, false),
  ('Done',        5000.0, true)
) as v(name, rank, is_done)
where o.slug = 'founding'
on conflict (org_id, lower(name)) do nothing;

-- ═══ LANE: Backlog — 9 cards (atlas status: dead) ═══

-- 1. [Upload] Compress All Batches (bucket-walk v2)
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Upload] Compress All Batches (bucket-walk v2)',
         'The cross-batch recompression tool (DB query + full storage-bucket walk) documented in CLAUDE.md has been removed from current source — only a placeholder comment remains (''Button hidden — compression runs automatically on import''); recompressAllBatches no longer exists in ImageUpload.tsx.

Subsystem: Step 1 — Image upload pipeline
Atlas status at seed: dead (cleanup / deletion candidate)

Wiring:
• superseded by: automatic compression on upload (COMPRESS_ON_UPLOAD) + per-batch recompress button

[seeded: feature-atlas 2026-07-19]',
         false,
         1000,
         null
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'backlog'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Upload] Compress All Batches (bucket-walk v2)'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'todo', t.rank, null
from new_card nc
cross join (values
  ('Historical completion', 'its final confirmed run (Apr 2026) verified all 4,854 bucket files compressed, so the tool was retired as no longer needed', 1000.0)
) as t(title, notes, rank);

-- 2. [Group] Step 2 sidebar preset picker (removed)
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Group] Step 2 sidebar preset picker (removed)',
         'The former handleApplyPreset flow and green per-preset buttons in the Step 2 right sidebar no longer exist in App.tsx — preset application now happens exclusively through CategoryZones preset zones (CLAUDE.md still documents the old path).

Subsystem: Step 2 — Grouping, categorization, presets application
Atlas status at seed: dead (cleanup / deletion candidate)

Wiring:
• superseded by: CategoryZones preset drop zones + click-assign
• doc drift: CLAUDE.md §10/§15 still describe handleApplyPreset and the preset pill buttons

[seeded: feature-atlas 2026-07-19]',
         false,
         2000,
         null
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'backlog'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Group] Step 2 sidebar preset picker (removed)'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'todo', t.rank, null
from new_card nc
cross join (values
  ('Removal marker', 'App.tsx:2847 comment: ''Category Preset picker removed — presets applied via right-click or category drag''; no handleApplyPreset function remains', 1000.0)
) as t(title, notes, rank);

-- 3. [Describe] Dead supporting databases & helpers
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Describe] Dead supporting databases & helpers',
         'Compiled-but-unconsumed modules in the Step 3 orbit: construction/fit-condition databases, brandMatcher, stripVoiceCommands, fieldLimits, COLOR_RGB_MAP.

Subsystem: Step 3 — Voice, fields, description generation, crop tool
Atlas status at seed: dead (cleanup / deletion candidate)

Wiring:
• colorDatabase''s live half (COLOR_WORDS_LIST) is a dependency of the voice field extractor
• candidates for future photo-scanning feature per vocab_models notes — not deleted

[seeded: feature-atlas 2026-07-19]',
         true,
         3000,
         null
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'backlog'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Describe] Dead supporting databases & helpers'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'todo', t.rank, null
from new_card nc
cross join (values
  ('CONSTRUCTION_DNA (300+ techniques)', 'No imports anywhere in src', 1000.0),
  ('FIT_DNA (120+ fits/condition grades)', 'No imports anywhere in src', 2000.0),
  ('brandMatcher.matchBrand', 'No consumers (see Intelligent Match panel)', 3000.0),
  ('FIELD_LIMITS + helpers', 'constants/fieldLimits.ts has zero importers; PDG uses a hardcoded 60-char title counter instead', 4000.0),
  ('stripVoiceCommands export', 'Exported from textAIService but never imported', 5000.0),
  ('COLOR_RGB_MAP', 'Orphaned since colorUtils removal (49dc58a); COLOR_DNA/COLOR_WORDS_LIST remain live via textAIService color fallback', 6000.0)
) as t(title, notes, rank);

-- 4. [Infra] Local Hugging Face proxy server
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Infra] Local Hugging Face proxy server',
         'huggingface-proxy.cjs is a standalone Express server on :3001 with CORS for localhost:5173, proxying /api/llama-vision (Meta-Llama-3.1-8B-Instruct — text-only despite the name) and /api/llama-text (Mistral-7B) to the HF Inference API using VITE_HUGGINGFACE_API_KEY.

Subsystem: Infrastructure, performance, debug, dead/unwired code
Atlas status at seed: dead (cleanup / deletion candidate)

Wiring:
• consumed by: src/lib/huggingfaceService.ts (itself only used by dead TestLlamaVision)
• blocked by: express/cors/node-fetch were removed from package.json — running it now requires reinstalling those deps
• unreachable from: GitHub Pages production (localhost only); wiring for prod would mean porting it to a Supabase Edge Function like generate-prose

[seeded: feature-atlas 2026-07-19]',
         false,
         4000,
         null
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'backlog'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Infra] Local Hugging Face proxy server'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'todo', t.rank, null
from new_card nc
cross join (values
  ('Two proxy endpoints', 'llama-vision and llama-text, both with JSON/text content-type fallback and error passthrough', 1000.0),
  ('50MB JSON body limit', 'Accommodates base64-encoded images', 2000.0)
) as t(title, notes, rank);

-- 5. [Infra] Legacy OpenAI/vision/Sheets API service
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Infra] Legacy OpenAI/vision/Sheets API service',
         'src/services/api.ts (520 lines, zero importers) bundles a GPT-4 listing generator with a detailed vintage-listing system prompt and mock fallback, a vision-label analyzer with mocks, Google Sheets export stubs, and a speech-recognition helper — all superseded by the active textAIService path.

Subsystem: Infrastructure, performance, debug, dead/unwired code
Atlas status at seed: dead (cleanup / deletion candidate)

Wiring:
• superseded by: src/lib/textAIService.ts (active description/title engine) and supabase/functions/generate-prose
• depends on (if revived): VITE_OPENAI_API_KEY / VITE_GOOGLE_* env vars (currently dead in .env.example)
• consumed by: nothing — no imports anywhere in src/

[seeded: feature-atlas 2026-07-19]',
         true,
         5000,
         null
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'backlog'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Infra] Legacy OpenAI/vision/Sheets API service'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'todo', t.rank, null
from new_card nc
cross join (values
  ('generateProductDetails', 'OpenAI chat completions (gpt-4, JSON response format) using VITE_OPENAI_API_KEY; mock ProductDetails when absent or on error', 1000.0),
  ('generateVintageListing', 'Enhanced parametrized listing generator (rarity/marketing-intensity/platform controls)', 2000.0),
  ('analyzeClothingImage + mapLabelsToCategory', 'Vision-label analysis with mock labels and label→category mapping', 3000.0),
  ('exportToGoogleSheets / initGoogleAPI', 'Google Sheets export scaffolding tied to the dead VITE_GOOGLE_* env vars', 4000.0),
  ('initSpeechRecognition', 'Web Speech API setup helper duplicating what PDG does inline', 5000.0)
) as t(title, notes, rank);

-- 6. [Infra] AISettings provider picker
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Infra] AISettings provider picker',
         'src/components/AISettings.tsx is a dropdown to choose Google Vision vs ''Llama 3'' as AI provider, persisted to localStorage ''ai_provider''; neither provider is on the active generation path and the component is never rendered.

Subsystem: Infrastructure, performance, debug, dead/unwired code
Atlas status at seed: dead (cleanup / deletion candidate)

Wiring:
• would feed: an AI provider switch that nothing reads — textAIService.ts (the active path) ignores ''ai_provider'' entirely
• wire-up: render in the header AND make the generation path branch on the stored provider; both halves are missing
• depends on: dead VITE_GOOGLE_VISION_API_KEY env var

[seeded: feature-atlas 2026-07-19]',
         false,
         6000,
         null
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'backlog'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Infra] AISettings provider picker'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'todo', t.rank, null
from new_card nc
cross join (values
  ('Provider persistence', 'localStorage ''ai_provider'' + onProviderChange callback', 1000.0),
  ('Google option gating', 'Disabled unless VITE_GOOGLE_VISION_API_KEY exists (the integration behind it is nonfunctional anyway)', 2000.0),
  ('Key-acquisition help footer', 'Links to HF/Google credential pages', 3000.0)
) as t(title, notes, rank);

-- 7. [Infra] TestLlamaVision dev tester
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Infra] TestLlamaVision dev tester',
         'src/components/TestLlamaVision.tsx is a dev-only upload-one-image tester that calls analyzeLlamaVision and renders the parsed product-type/brand/color/material/condition/era/style/confidence grid; never rendered in App.tsx.

Subsystem: Infrastructure, performance, debug, dead/unwired code
Atlas status at seed: dead (cleanup / deletion candidate)

Wiring:
• depends on: huggingfaceService → huggingface-proxy.cjs running on localhost:3001 (itself dead: deps removed from package.json)
• wire-up: temporarily render it in App.tsx while running the proxy locally — dev-only by design, impossible on GitHub Pages

[seeded: feature-atlas 2026-07-19]',
         false,
         7000,
         null
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'backlog'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Infra] TestLlamaVision dev tester'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'todo', t.rank, null
from new_card nc
cross join (values
  ('Single-file analysis flow', 'File input → spinner with model-warmup note → result grid or error card', 1000.0)
) as t(title, notes, rank);

-- 8. [Infra] SavedProducts legacy browser
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Infra] SavedProducts legacy browser',
         'src/components/SavedProducts.tsx is a modal product/batch browser (grid with main image by position, per-product delete-confirm, batch grouping by batch_id) fully superseded by Library.tsx; marked ''// UNUSED — Safe to delete''.

Subsystem: Infrastructure, performance, debug, dead/unwired code
Atlas status at seed: dead (cleanup / deletion candidate)

Wiring:
• superseded by: Library.tsx (batches/groups/images tabs with far richer derivation)
• depends on: productService.fetchUserProducts/deleteProduct and LazyImg — duplicate fetch/UI logic that would fight Library''s tombstone/storage-safety machinery if revived; deletion is the right move, not wiring

[seeded: feature-atlas 2026-07-19]',
         false,
         8000,
         null
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'backlog'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Infra] SavedProducts legacy browser'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'todo', t.rank, null
from new_card nc
cross join (values
  ('Products/batches view toggle', 'Flat product grid or products grouped by batch_id (''unbatched'' bucket)', 1000.0),
  ('Delete with confirm', 'deleteProduct via productService with two-step confirmation', 2000.0)
) as t(title, notes, rank);

-- 9. [Infra] ImageSorter legacy categorizer
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Infra] ImageSorter legacy categorizer',
         'src/components/ImageSorter.tsx is the pre-CategoryZones Step 2 categorizer: one card per product group with a hardcoded 8-category <select> and an all-items-categorized gate before onSorted; never rendered (and unlike the other dead components it lacks the // UNUSED banner).

Subsystem: Infrastructure, performance, debug, dead/unwired code
Atlas status at seed: dead (cleanup / deletion candidate)

Wiring:
• superseded by: CategoryZones drag/click assignment + preset buttons (DB-driven categories vs this hardcoded list)
• depends on: ClothingItem type from App.tsx and LazyImg; the debug logger even keeps a ''Sorter'' category for it — deletion candidate rather than wiring

[seeded: feature-atlas 2026-07-19]',
         false,
         9000,
         null
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'backlog'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Infra] ImageSorter legacy categorizer'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'todo', t.rank, null
from new_card nc
cross join (values
  ('Group-level category select', 'productGroup||id grouping, category applied to every member', 1000.0),
  ('Completion gate', 'Continue button disabled until every item has a category (behavior the current flow deliberately dropped)', 2000.0)
) as t(title, notes, rank);

-- ═══ LANE: To do — 10 cards (atlas status: built-not-wired) ═══

-- 1. [Upload] Pause / cancel upload machinery
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Upload] Pause / cancel upload machinery',
         'processFiles honors pausedRef (busy-wait poll every 200ms between chunks) and cancelledRef (break loop, delete every already-uploaded storage file via storage.remove), but no UI ever sets either ref — the state vars are underscore-prefixed and unused, so the controls are unreachable.

Subsystem: Step 1 — Image upload pipeline
Atlas status at seed: built-not-wired

Wiring:
• would feed: Supabase Storage delete on cancel
• blocked by: no pause/cancel buttons rendered anywhere (the cat-overlay UI that hosted them was removed — creatureOverlay = null)

[seeded: feature-atlas 2026-07-19]',
         false,
         1000,
         null
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'to do'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Upload] Pause / cancel upload machinery'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'todo', t.rank, null
from new_card nc
cross join (values
  ('Cancel storage cleanup', 'uploadedPaths tracked per session; on cancel all are removed from the product-images bucket so no orphans remain', 1000.0),
  ('State reset in finally', 'pause/cancel refs and isProcessingRef reset in finally so the next upload starts clean', 2000.0)
) as t(title, notes, rank);

-- 2. [Upload] Manual EXIF rescan button / onCapturedAtUpdated callback
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Upload] Manual EXIF rescan button / onCapturedAtUpdated callback',
         'App.tsx still defines handleCapturedAtUpdated (patches capturedAt across all four arrays + auto-saves) and passes it as the onCapturedAtUpdated prop, but ImageUpload renames it to _onCapturedAtUpdated and never calls it — the yellow ''Fix Sort Order (EXIF rescan)'' button described in CLAUDE.md no longer exists in the component.

Subsystem: Step 1 — Image upload pipeline
Atlas status at seed: built-not-wired

Wiring:
• superseded by: auto EXIF rescan on startup restore / batch open (App-side, no callback needed)
• would feed: auto-save + Step 2 date sort if re-wired

[seeded: feature-atlas 2026-07-19]',
         false,
         2000,
         null
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'to do'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Upload] Manual EXIF rescan button / onCapturedAtUpdated callback'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'todo', t.rank, null
from new_card nc
cross join (values
  ('handleCapturedAtUpdated', 'by-id patch of uploaded/grouped/sorted/processed arrays followed by autoSaveWorkflow — fully functional, just unreachable', 1000.0)
) as t(title, notes, rank);

-- 3. [Group] CategoryZones full-mode group/photo reorder
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Group] CategoryZones full-mode group/photo reorder',
         'Non-compact mode renders an ''All Product Groups'' section with grip-handle group reordering, position badges, drag-to-zone headers, and in-card photo reordering that emits export order via emitReordered.

Subsystem: Step 2 — Grouping, categorization, presets application
Atlas status at seed: built-not-wired

Wiring:
• would feed: CSV export row order (superseded by capturedAt shoot-order sort in GoogleSheetExporter)
• consumed by: nothing currently (compactMode always true in App.tsx)

[seeded: feature-atlas 2026-07-19]',
         true,
         3000,
         null
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'to do'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Group] CategoryZones full-mode group/photo reorder'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'todo', t.rank, null
from new_card nc
cross join (values
  ('groupOrder state', 'Stable ordered group-id list synced as groups appear/disappear; controls emitted item order', 1000.0),
  ('Grip-handle group reorder', 'Drag to reposition a group card; splice + emitReordered', 2000.0),
  ('Photo reorder', 'Drag photos within a card to reorder', 3000.0),
  ('Dormant in current app', 'App always passes compactMode, which hides this entire section — only the zones+click flow is live', 4000.0)
) as t(title, notes, rank);

-- 4. [Describe] Intelligent Match display panel
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Describe] Intelligent Match display panel',
         'Blue info panel showing Brand/Model/Category/Subcultures when modelName is set — but the matcher meant to populate brandCategory/subculture is not wired into the active flow.

Subsystem: Step 3 — Voice, fields, description generation, crop tool
Atlas status at seed: built-not-wired

Wiring:
• modelName IS populated by the voice command engine, so the panel partially functions
• brandCategorySystem.MODEL_DATABASE''s live consumer is the VocabDashboard lazy import (admin subsystem), not this panel

[seeded: feature-atlas 2026-07-19]',
         false,
         4000,
         null
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'to do'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Describe] Intelligent Match display panel'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'todo', t.rank, null
from new_card nc
cross join (values
  ('brandMatcher.matchBrand', 'Matches voice text against MODEL_DATABASE + BRAND_DNA expansions with confidence/price/collectibility — zero consumers anywhere in src', 1000.0),
  ('Panel render condition', 'Shows only when currentItem.modelName exists (settable via ''model X period'' voice command); brandCategory/subculture rows render only if some legacy path populated them', 2000.0)
) as t(title, notes, rank);

-- 5. [Library] Export library tracking (export_batches)
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Library] Export library tracking (export_batches)',
         'Complete service layer for recording CSV export history (export_batches/export_batch_items tables, status lifecycle, stats, CSV regeneration from stored rows) with no UI consumer anywhere.

Subsystem: Library, batches, persistence & data-integrity machinery
Atlas status at seed: built-not-wired

Wiring:
• intended consumer: GoogleSheetExporter/CSV export flow (never wired)
• depends on: export_batches/export_batch_items tables + two RPCs existing in Supabase

[seeded: feature-atlas 2026-07-19]',
         true,
         5000,
         null
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'to do'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Library] Export library tracking (export_batches)'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'todo', t.rank, null
from new_card nc
cross join (values
  ('Export batch CRUD', 'create (get_next_batch_number RPC + generated CSV filename), fetch, delete, tag/note updates', 1000.0),
  ('Row snapshotting', 'addItemsToExportBatch stores each product''s full 62-column CSV row as JSONB with quick-access fields', 2000.0),
  ('Status lifecycle', 'pending → exported → uploaded → processing → completed/failed/archived with timestamps and Shopify import metadata', 3000.0),
  ('CSV regeneration', 'regenerateCSVFromBatch rebuilds a CSV string from stored csv_data', 4000.0),
  ('Stats', 'fetchUserExportStats aggregates counts and total value across exports', 5000.0)
) as t(title, notes, rank);

-- 6. [Accounts] Vocabulary dashboard — models tab
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Accounts] Vocabulary dashboard — models tab',
         'Founder-editable vocab_models knowledge base (recognition features + pricing per garment model) with a read-only built-in MODEL_DATABASE importer; no runtime consumer yet.

Subsystem: Auth, landing/beta gate, multi-org tenancy, admin panels
Atlas status at seed: built-not-wired

Wiring:
• consumed by: nothing yet — the growing knowledge base for the future photo-scanning feature
• gated by: same founding-admin gate + is_beta_admin() write RLS as the other vocab tabs
• depends on: vocab_models.sql (global SELECT, founder writes, unique on lower(brand)+lower(model))

[seeded: feature-atlas 2026-07-19]',
         false,
         6000,
         null
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'to do'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Accounts] Vocabulary dashboard — models tab'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'todo', t.rank, null
from new_card nc
cross join (values
  ('Model add/edit form', '~11 fields: brand, model name/number, category, year, price min/max, collectibility (clamped 1–10), identifying features, keywords, discontinued flag; edit-in-place with cancel.', 1000.0),
  ('Model list controls', 'On/off toggle, two-step delete, multi-field search; 42P01 surfaces a friendly ''vocab_models.sql not run'' error.', 2000.0),
  ('Built-in model library', 'MODEL_DATABASE (~65 entries, lazy chunk loaded only when the tab opens) read-only with one-click import + ''customized'' badge keyed on brand|model.', 3000.0)
) as t(title, notes, rank);

-- 7. [Infra] huggingfaceService (Llama vision client)
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Infra] huggingfaceService (Llama vision client)',
         'src/lib/huggingfaceService.ts calls the local proxy for clothing-image analysis (analyzeLlamaVision → LlamaVisionAnalysis JSON) and has a direct-HF generateLlamaDescription with mock fallback; not on any active code path.

Subsystem: Infrastructure, performance, debug, dead/unwired code
Atlas status at seed: built-not-wired

Wiring:
• consumed by: TestLlamaVision only (dead component)
• depends on: huggingface-proxy.cjs running locally + VITE_HUGGINGFACE_API_KEY
• superseded by: textAIService.ts (rule-based) + generate-prose Edge Function for the active description path; wiring vision into Step 2/3 would need a server-side proxy and a call site in the upload/analysis flow

[seeded: feature-atlas 2026-07-19]',
         false,
         7000,
         null
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'to do'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Infra] huggingfaceService (Llama vision client)'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'todo', t.rank, null
from new_card nc
cross join (values
  ('analyzeLlamaVision', 'base64-encodes the File, posts a structured-JSON vintage-analysis prompt to localhost:3001, regex-extracts and parses the JSON response', 1000.0),
  ('generateLlamaDescription', 'Direct HF Inference API call (Meta-Llama-3-8B) with hardcoded mock-description fallback when no key/error', 2000.0),
  ('Proxy-down detection', 'TypeError fetch failures logged with a start-the-proxy hint; errors thrown, not mocked, for vision', 3000.0)
) as t(title, notes, rank);

-- 8. [Infra] Realtime presence hook (useUserPresence)
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Infra] Realtime presence hook (useUserPresence)',
         'src/hooks/useUserPresence.ts joins the Supabase Realtime ''workspace-presence'' channel to broadcast cursor position (100ms throttle), current step/view, and email with a 5s heartbeat, exposing otherUsers + broadcastAction; compiles but is never called from App.tsx.

Subsystem: Infrastructure, performance, debug, dead/unwired code
Atlas status at seed: built-not-wired

Wiring:
• consumed by: RemoteCursors (type import only today); LiveWorkspaceSelector reads the same channel independently
• wire-up: call in App.tsx with user.id/currentStep and render RemoteCursors with the returned otherUsers
• known flaw: effect dep array includes isTracking + currentStep/currentView, causing channel teardown/resubscribe churn on every step change
• depends on: Supabase Realtime; multi-org tenancy would need per-org channel names before wiring

[seeded: feature-atlas 2026-07-19]',
         true,
         8000,
         null
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'to do'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Infra] Realtime presence hook (useUserPresence)'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'todo', t.rank, null
from new_card nc
cross join (values
  ('Presence sync → otherUsers map', 'presenceState() rebuilt on sync events, keyed by userId, excluding self', 1000.0),
  ('Throttled cursor broadcast', 'mousemove tracked at max 10 updates/sec via channel.track', 2000.0),
  ('5s heartbeat', 'Keeps presence alive with step/view but zeroed cursor', 3000.0),
  ('broadcastAction', 'Separate ''workspace-actions'' broadcast channel for named user actions', 4000.0)
) as t(title, notes, rank);

-- 9. [Infra] RemoteCursors overlay
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Infra] RemoteCursors overlay',
         'src/components/RemoteCursors.tsx renders floating SVG cursors with per-user hash-derived colors and email labels plus a ''Live Activity'' side panel (step names, last action) for every presence user; never rendered in App.tsx.

Subsystem: Infrastructure, performance, debug, dead/unwired code
Atlas status at seed: built-not-wired

Wiring:
• depends on: useUserPresence otherUsers output (the only consumer of its UserPresence type)
• wire-up: render in App.tsx alongside the useUserPresence hook; cursor coords are raw viewport pixels so differing screen sizes would need normalization
• note: its STEP_NAMES map has 5 steps vs the app''s 4 — drifted from the current flow

[seeded: feature-atlas 2026-07-19]',
         false,
         9000,
         null
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'to do'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Infra] RemoteCursors overlay'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'todo', t.rank, null
from new_card nc
cross join (values
  ('Cursor glyphs', 'Absolutely-positioned SVG arrows at each user''s clientX/Y with drop-shadow in the user color', 1000.0),
  ('Activity panel', 'Per-user step (5-step name map, which predates the current 4-step flow) and lastAction list', 2000.0),
  ('Deterministic user colors', '8-color palette picked by char-code hash of userId', 3000.0)
) as t(title, notes, rank);

-- 10. [Infra] LiveWorkspaceSelector dropdown
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Infra] LiveWorkspaceSelector dropdown',
         'src/components/LiveWorkspaceSelector.tsx is a presence-driven dropdown listing online users (active dot, current step, last-active age) with an ''All Users (Collaborative)'' option, calling onWorkspaceChange(userId|null); never rendered.

Subsystem: Infrastructure, performance, debug, dead/unwired code
Atlas status at seed: built-not-wired

Wiring:
• depends on: the same Supabase presence channel useUserPresence broadcasts on (someone must be tracking for the list to populate)
• wire-up: App.tsx has no per-user workspace filtering to honor the callback — and adding one conflicts with the §18 no-user_id-filter shared-workspace rule and the new org-RLS model, so wiring needs a design decision first

[seeded: feature-atlas 2026-07-19]',
         false,
         10000,
         null
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'to do'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Infra] LiveWorkspaceSelector dropdown'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'todo', t.rank, null
from new_card nc
cross join (values
  ('Presence-fed user list', 'Subscribes to the same ''workspace-presence'' channel; current user sorted first, then alphabetical', 1000.0),
  ('Selection callback', 'onWorkspaceChange(null) = all users, or a specific userId; ''Viewing live workspace'' pulse indicator when viewing someone else', 2000.0)
) as t(title, notes, rank);

-- ═══ LANE: In progress — 5 cards (atlas status: partial) ═══
-- 1. [Group] Singles grid manual reorder
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Group] Singles grid manual reorder',
         'Drag single cards (or a multi-selected block with a count-badge ghost) to a new position with left/right drop indicators and edge auto-scroll; order held in component-local manualOrder.

Subsystem: Step 2 — Grouping, categorization, presets application
Atlas status at seed: partial

Wiring:
• coexists with: group-drop drag (same dragstart also arms the into-group drag so dropping on a group card still works)
• overrides: the active sort order for display only

[seeded: feature-atlas 2026-07-19]',
         true,
         1000,
         null
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'in progress'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Group] Singles grid manual reorder'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'todo', t.rank, null
from new_card nc
cross join (values
  ('Block move', 'reorderPreDragSelectionRef snapshots selection on mousedown so multi-drag works despite the toggle firing first', 1000.0),
  ('Drop side detection', 'Left/right half of the hovered card decides insert-before/after', 2000.0),
  ('Custom drag ghost', '''Moving N photos'' pill when dragging multiple', 3000.0),
  ('Not persisted', 'manualOrder is session-local state — lost on remount/batch switch, never saved to DB', 4000.0)
) as t(title, notes, rank);

-- 2. [Group] Category Presets management
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Group] Category Presets management',
         'CategoryPresetsManager modal CRUDs category_presets with gender-filtered cards, a multi-section form (~30 of the ~45 preset columns), a custom sections/fields builder, duplicate, and soft delete.

Subsystem: Step 2 — Grouping, categorization, presets application
Atlas status at seed: partial

Wiring:
• feeds: CategoryZones zones (each active preset renders a zone) and the preset application engine
• feeds: App presetsUpdated re-apply effect and (in App) categoryPresets refresh when the modal closes
• depends on: categories table for the new-preset category dropdown
• consumed by: Step 3 PDG preset override dropdown (same category_presets rows)

[seeded: feature-atlas 2026-07-19]',
         true,
         2000,
         null
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'in progress'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Group] Category Presets management'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'todo', t.rank, null
from new_card nc
cross join (values
  ('Gender-filtered cards', 'Men/Women/Kids toggle (localStorage) filters preset cards showing weight/type/price/tags/measurements summaries', 1000.0),
  ('Create/edit form', 'Built-in sections: basic, shipping, classification, pricing, attributes, CSV shipping/classification/policies, measurement template (with load-default button), tags & SEO (title template + keywords + description)', 2000.0),
  ('Custom sections & fields', 'User-defined sections with typed fields (text/number/textarea/select/checkbox), reorder/rename/delete, persisted in custom_sections JSONB', 3000.0),
  ('Unique-name generation', 'New/duplicated presets get slugified display name + random suffix as category_name', 4000.0),
  ('presetsUpdated dispatch', 'After update, fires the window event that makes App re-apply the preset to in-state items', 5000.0),
  ('Field coverage gap', 'Extended fields (compare_at_price, cost_per_item, color/model/era, sku/barcode prefixes, default_measurements values, unit-price, tax, inventory) are type-defined but editable only via SQL', 6000.0),
  ('Dead helper', 'categoryPresetsService.applyCategoryPreset has no consumers (superseded by applyPresetToGroup.ts)', 7000.0)
) as t(title, notes, rank);

-- 3. [Describe] Photo reorder within group
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Describe] Photo reorder within group',
         'Drag-and-drop reorder of group thumbnails that swaps items in-place so the group''s position in processedItems (and currentGroupIndex) is stable.

Subsystem: Step 3 — Voice, fields, description generation, crop tool
Atlas status at seed: partial

Wiring:
• order persists only via workflow_state (App auto-save) — product_images.position is NOT updated in DB (§16 known gap)
• first item after reorder becomes the primary image in Step 3 preview and CSV Image Src order

[seeded: feature-atlas 2026-07-19]',
         false,
         3000,
         null
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'in progress'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Describe] Photo reorder within group'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'todo', t.rank, null
from new_card nc
cross join (values
  ('Drag states', 'draggedThumbId/dragOverThumbId with dragging/over CSS classes and dataTransfer payload', 1000.0),
  ('In-place slot replacement', 'Reordered members re-fill the group''s original slots in the full list', 2000.0)
) as t(title, notes, rank);

-- 4. [Describe] Brand/vocab knowledge-base libraries
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Describe] Brand/vocab knowledge-base libraries',
         'Layered brand vocabulary: DB tables (founder-curated) → built-in 917-brand distillation → raw BRAND_DNA engine files; only the first two feed the active generation flow.

Subsystem: Step 3 — Voice, fields, description generation, crop tool
Atlas status at seed: partial

Wiring:
• getBrandTerms feeds: tag engine merge + Step 3 chip suggestions
• CRUD UI lives in VocabDashboard (founding-admin subsystem)
• writes gated by is_beta_admin() RLS; reads open to all workspaces

[seeded: feature-atlas 2026-07-19]',
         true,
         4000,
         null
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'in progress'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Describe] Brand/vocab knowledge-base libraries'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'todo', t.rank, null
from new_card nc
cross join (values
  ('vocabService CRUD + caches', 'descriptor_chips / brand_keywords / vocab_models tables (fail-soft pre-migration); getBrandTerms precedence: edited row (disabled row = off) → built-in library; paginated fetches past the 1000-row cap; session caches', 1000.0),
  ('builtinBrandVocab', 'Lazy-chunk distillation of BRAND_DNA + 4 expansions into brand→keywords (vibes+subculture only, ≤10/brand, 917 brands) — the getBrandTerms fallback and VocabDashboard browse source', 2000.0),
  ('vintagePatternEngine + expansions', 'Raw BRAND_DNA cultural database (~1442 lines + 4 expansion files); consumed ONLY via builtinBrandVocab/brandMatcher — keep out of main-bundle imports', 3000.0),
  ('vocab_models rows', 'Editable model knowledge base — nothing consumes rows yet (future photo-scanning feature)', 4000.0)
) as t(title, notes, rank);

-- 5. [Library] Batch duplication
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Library] Batch duplication',
         'Duplicate button clones a batch row (name ''(Copy)'', reset to step 1) copying only workflow_state.uploadedImages by reference — shared storage paths, no file copies.

Subsystem: Library, batches, persistence & data-integrity machinery
Atlas status at seed: partial

Wiring:
• triggered by: batch card Duplicate button
• creates the hazard mitigated by: storageSafety shared-file guard
• noted in CLAUDE.md as: behavior after duplication not fully tested

[seeded: feature-atlas 2026-07-19]',
         false,
         5000,
         null
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'in progress'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Library] Batch duplication'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'todo', t.rank, null
from new_card nc
cross join (values
  ('Shallow clone', 'Copies uploadedImages array only; groupedImages/sortedImages/processedItems reset to [] — new-format batches (which store only processedItems) duplicate as visually empty', 1000.0),
  ('Shared storage model', 'Duplicate references the original''s storage paths — the reason storageSafety exists', 2000.0)
) as t(title, notes, rank);

-- ═══ LANE: In review — 6 cards (atlas status: migration-pending) ═══

-- 1. [Export] Per-org Shopify connection management
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Export] Per-org Shopify connection management',
         'Client service for connecting a workspace''s Shopify store: domain + write-only Admin token stored in org_shopify_connections, readable only by the Edge Function.

Subsystem: Step 4 — Save batch + Shopify CSV export
Atlas status at seed: migration-pending

Wiring:
• consumed by: OrgPanel Shopify section (org admins connect their store)
• token consumed by: shopify-titles Edge Function only (service-role read; column-level grants block client SELECT)
• depends on: org_shopify_connections.sql + multi_org_tenancy.sql migrations (self-hides via ''unavailable'' until run)
• enables: per-store title dedup + per-store metaobject GIDs in CSV export

[seeded: feature-atlas 2026-07-19]',
         true,
         1000,
         null
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'in review'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Export] Per-org Shopify connection management'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'todo', t.rank, null
from new_card nc
cross join (values
  ('getShopifyConnection', 'Selects org_id/store_domain/updated_at (never the token); any error → ''unavailable'' so the OrgPanel Shopify section hides pre-migration.', 1000.0),
  ('saveShopifyConnection', 'Validates domain + token shape (shpat_/shppa_ prefix, no whitespace), then replace-style delete+insert with return=minimal so the token is never echoed back.', 2000.0),
  ('deleteShopifyConnection', 'Disconnects the org''s store (delete by org_id, admin/owner RLS).', 3000.0),
  ('normalizeStoreDomain', 'Accepts ''my-store'', full URL, or *.myshopify.com and canonicalizes — mirrored server-side in the Edge Function.', 4000.0)
) as t(title, notes, rank);

-- 2. [Library] Stage 4 dual-write (imageRowSync)
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Library] Stage 4 dual-write (imageRowSync)',
         'Forward-compatible dual-write of slim-only fields (captured_at, original_storage_path, description_edited) into DB columns so workflow_state can eventually be retired as source of truth.

Subsystem: Library, batches, persistence & data-integrity machinery
Atlas status at seed: migration-pending

Wiring:
• consumed by: registerItemsInDB, handleImagesUploaded upload upsert, saveProductToDatabase, updateProduct
• depends on: stage4_slim_fields.sql being run manually (code shipped first by design)
• goal: makes gap-fill cap / ±24h orphan window / stolen-row deletion dead code once reads flip to DB-first

[seeded: feature-atlas 2026-07-19]',
         true,
         2000,
         null
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'in review'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Library] Stage 4 dual-write (imageRowSync)'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'todo', t.rank, null
from new_card nc
cross join (values
  ('stage4ColumnsAvailable probe', 'One cached SELECT per session; any error means ''not yet'' and new fields are omitted (unknown column would fail the whole upsert with PGRST204)', 1000.0),
  ('buildTransforms', 'rotation/crop payload for product_images.transforms; null when untouched — now written on every open/upload/save, not just Save Batch', 2000.0),
  ('buildProductImageRow', 'One row shape shared by registerItemsInDB, the upload upsert, and saveBatchToDatabase', 3000.0),
  ('description_edited gating', 'saveProductToDatabase + updateProduct write it only when the probe passes', 4000.0)
) as t(title, notes, rank);

-- 3. [Accounts] Multi-org tenancy bootstrap
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Accounts] Multi-org tenancy bootstrap',
         'Per-sign-in workspace resolution with legacy fallback: membership → invite auto-accept → orphan-org self-repair → beta gate → create personal workspace.

Subsystem: Auth, landing/beta gate, multi-org tenancy, admin panels
Atlas status at seed: migration-pending

Wiring:
• triggered by: App.tsx useEffect on user.id after auth
• feeds: WaitlistGate (waitlist mode), WorkspaceMenu org name, OrgPanel, Vocabulary/Board button gating, description-settings load
• depends on: betaService.getMyBetaSignup for the gate decision; categoriesService.initializeDefaultCategories for seeding
• consumed by: ALL data reads app-wide — org_id RLS scopes batches/products/images/categories/presets once the migration runs (org_id DEFAULT means no client code passes it)

[seeded: feature-atlas 2026-07-19]',
         true,
         3000,
         null
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'in review'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Accounts] Multi-org tenancy bootstrap'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'todo', t.rank, null
from new_card nc
cross join (values
  ('5-step resolution order', 'Oldest membership wins; pending invite for my email auto-joins with invited role and stamps accepted_at; creator-orphaned org gets membership repaired; else waitlist or fresh workspace.', 1000.0),
  ('Legacy-mode fail-soft', 'Any error (e.g. org tables missing) returns { mode: ''legacy'' } so the identical build runs against a pre-migration DB as the old shared workspace.', 2000.0),
  ('StrictMode dedup', 'In-flight promise dedupes concurrent bootstraps so double-invoked effects can''t create two personal workspaces.', 3000.0),
  ('New-workspace seeding', 'Fresh workspaces seed the default categories (and org creation writes plan=''beta'' + requested shop name for approved beta signups).', 4000.0),
  ('Migration SQL', 'Creates organizations/org_members/org_invites + user_org_ids()/default_org_id()/is_org_admin() helpers, adds org_id DEFAULT to the 5 data tables, backfills everything into a Founding Workspace, swaps RLS to org-membership policies.', 5000.0),
  ('Member/invite/role service API', 'fetchOrgMembers/fetchOrgInvites/inviteToOrg/revokeInvite/removeMember/renameOrganization/updateMemberRole/fetchMemberActivity, all RLS-enforced with 0-row detection.', 6000.0)
) as t(title, notes, rank);

-- 4. [Accounts] Per-org Shopify connection
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Accounts] Per-org Shopify connection',
         'OrgPanel Settings tab section where org admins connect their Shopify store with a write-only Admin API token.

Subsystem: Auth, landing/beta gate, multi-org tenancy, admin panels
Atlas status at seed: migration-pending

Wiring:
• consumed by: shopify-titles Edge Function (service role reads the token) → CSV export title/handle dedup + per-store metaobject GID overrides in csvExport.ts
• depends on: multi_org_tenancy (org_id + is_org_admin RLS)
• triggered by: OrgPanel Settings tab (org admins of any workspace)

[seeded: feature-atlas 2026-07-19]',
         true,
         4000,
         null
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'in review'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Accounts] Per-org Shopify connection'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'todo', t.rank, null
from new_card nc
cross join (values
  ('Connect form', 'Domain normalized to *.myshopify.com; token validated (shpat_/shppa_ prefix, no whitespace); help text walks through creating a custom app with read_products + read_metaobjects scopes.', 1000.0),
  ('Write-only token', 'Column-level grants give INSERT but no SELECT on admin_token; save is delete-then-insert with return=minimal so the token is never echoed back to the browser.', 2000.0),
  ('Connected view + replace/disconnect', 'Shows store domain and connect date (''token stored server side, never shown again''); pencil to replace; two-step disconnect confirm.', 3000.0),
  ('Pre-migration hiding', 'getShopifyConnection reports ''unavailable'' when the table is missing and the whole section hides.', 4000.0)
) as t(title, notes, rank);

-- 5. [Accounts] Founding cross-workspace user admin + audit
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Accounts] Founding cross-workspace user admin + audit',
         'OrgPanel Users tab letting Founding admins manage every account''s memberships across all workspaces via SECURITY DEFINER RPCs, with an append-only audit trail.

Subsystem: Auth, landing/beta gate, multi-org tenancy, admin panels
Atlas status at seed: migration-pending

Wiring:
• gated by: is_beta_admin() (Founding admins) — RPCs deliberately bypass org_members RLS instead of widening it
• depends on: multi_org_tenancy.sql + beta_signups.sql (run order)
• feeds: self-role changes sync App orgRole via onMyRoleChanged; removed/moved users re-resolve through ensureOrganization on next sign-in
• consumes: beta_org_directory + membership rows for the workspace-destination dropdowns

[seeded: feature-atlas 2026-07-19]',
         true,
         5000,
         null
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'in review'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Accounts] Founding cross-workspace user admin + audit'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'todo', t.rank, null
from new_card nc
cross join (values
  ('All-users list', 'founding_list_users returns every auth user (signed-up/last-sign-in dates) incl. waitlisted accounts flagged ''no workspace''; searchable by email or workspace, render-capped at 50.', 1000.0),
  ('Membership edit', 'Per-membership role dropdown and add-to-workspace draft (destination + role pickers, explicit Add) via founding_set_membership.', 2000.0),
  ('Remove membership', 'Two-step confirm; notice states the workspace keeps all its batches/products (a removed user just hits the waitlist gate).', 3000.0),
  ('Move user (two-step)', 'Pick destination → confirm; memberships move, data does NOT (org_id untouched), so moves are reversible; role optionally carried over.', 4000.0),
  ('Audit log', '''Recent user changes'' renders founding_admin_audit rows (actor, action, target, orgs, role) written by the RPCs as table owner; clients have SELECT only.', 5000.0),
  ('Lockout hard rail', 'guard_founding_admins() raises + rolls back any operation that would leave the founding org with zero owners+admins.', 6000.0),
  ('Pre-migration hiding', 'RPC returns [] before founding_user_admin.sql runs → allUsers.length gates the tab off entirely.', 7000.0)
) as t(title, notes, rank);

-- 6. [Accounts] Team kanban board
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Accounts] Team kanban board',
         'Org-scoped project board (lanes → cards → tasks → subtasks with assignees, dates, comments) gated in App to Founding Workspace members.

Subsystem: Auth, landing/beta gate, multi-org tenancy, admin panels
Atlas status at seed: migration-pending

Wiring:
• triggered by: header ''Board'' button — visible to ALL Founding Workspace members (not just admins); schema itself is plain org-scoped so any workspace could get it later
• depends on: multi-org tenancy (org_id DEFAULT default_org_id() on insert, user_org_ids() RLS; reads filter by org_id for scope, not permission)
• depends on: org_members roster for assignee names (cosmetic — roster errors don''t take the board down)
• depends on: unit-tested pure modules in src/lib/kanban/ (rank/tree/dates/status/format)

[seeded: feature-atlas 2026-07-19]',
         true,
         6000,
         null
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'in review'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Accounts] Team kanban board'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'todo', t.rank, null
from new_card nc
cross join (values
  ('Lanes', 'Default 5 lanes (Backlog→Done) auto-seeded via ensureColumns (23505 = raced success; in-flight-promise StrictMode dedup); add/delete lane (delete cascades cards/tasks/comments); is_done lane defines completion.', 1000.0),
  ('Card drag-and-drop', 'Native HTML5 DnD (JSON payload + state-mirrored id Safari fallback); computeDropRank/dropIndexBefore own the ordering math; needsRebalance → rebalanceCards rewrites collapsed ranks as one critical section with the move.', 2000.0),
  ('Done-lane completion semantics', 'completionForMove sets/clears completed_at based on the destination lane; drawer hint explains dragging out of Done reopens the card.', 3000.0),
  ('Card detail drawer', 'Rename/notes drafts committed on blur (remount-keyed on card.id — no prop-sync effects), epic flag, assignee picker from the org roster, start/due/end dates with validateDateRange warnings, delete-card with cascade confirm.', 4000.0),
  ('Tasks and subtasks', 'One-level nested task tree with tri-state status (setTaskStatus keeps completed_at consistent in the same write), ranks, per-task assignees/dates, delete cascades.', 5000.0),
  ('Comments', 'Threads on the card and on every task/subtask (task_id null = card comment); card_id always set so card deletion cascades everything.', 6000.0),
  ('Due badges + progress', 'deriveDateStatus badges (now passed as state, never clock reads in render); cardProgress/taskProgress leaf-counted rollup bars; comment counts and assignee initials on mini cards.', 7000.0),
  ('Mutation discipline', 'Single run() path with a busyRef mutex that REPORTS skipped writes; drafts cleared only after the write lands (functional clears preserve typed-ahead text).', 8000.0),
  ('Pre-migration panel', 'fetchBoard ''unavailable'' → ''run kanban_board.sql'' panel instead of a broken board.', 9000.0)
) as t(title, notes, rank);

-- ═══ LANE: Done — 110 cards (atlas status: done) ═══

-- 1. [Upload] Drag-and-drop / click-to-select image upload (dropzone)
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Upload] Drag-and-drop / click-to-select image upload (dropzone)',
         'react-dropzone zone in Step 1 accepting JPG/PNG/WEBP files and ZIPs via drag, drop, or click; disabled while an upload is running.

Subsystem: Step 1 — Image upload pipeline
Atlas status at seed: done

Wiring:
• feeds: chunked upload pipeline (processFiles)
• consumed by: App.tsx Step 1 section (rendered when authed)
• depends on: react-dropzone

[seeded: feature-atlas 2026-07-19]',
         false,
         1000,
         now()
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'done'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Upload] Drag-and-drop / click-to-select image upload (dropzone)'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'done', t.rank, now()
from new_card nc
cross join (values
  ('Mixed drop routing', 'onDrop splits ZIPs from plain images; ZIPs are extracted then merged with loose images into one processFiles call', 1000.0),
  ('Upload progress readout', 'dropzone body shows ''Uploading N / total'' from uploadProgress state while busy', 2000.0),
  ('Double-fire guard', 'isProcessingRef drops concurrent processFiles calls (StrictMode double-invoke, simultaneous drop + input events)', 3000.0)
) as t(title, notes, rank);

-- 2. [Upload] Folder import
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Upload] Folder import',
         'Hidden webkitdirectory <input> lets the user import an entire folder of images; triggered from an ''Import Folder'' button that lives in App.tsx''s Step 1 header, not inside ImageUpload.

Subsystem: Step 1 — Image upload pipeline
Atlas status at seed: done

Wiring:
• triggered by: App.tsx step1-header ''Import Folder'' button via uploadRef
• feeds: chunked upload pipeline (processFiles)

[seeded: feature-atlas 2026-07-19]',
         false,
         2000,
         now()
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'done'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Upload] Folder import'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'done', t.rank, now()
from new_card nc
cross join (values
  ('Imperative handle', 'ImageUploadHandle exposes triggerFolder()/triggerZip()/isBusy via forwardRef + useImperativeHandle so App.tsx header buttons can drive the hidden inputs', 1000.0),
  ('Input reset', 'e.target.value cleared after each pick so re-selecting the same folder fires change again', 2000.0)
) as t(title, notes, rank);

-- 3. [Upload] ZIP import
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Upload] ZIP import',
         'JSZip extracts jpg/jpeg/png/webp/gif entries from dropped or picked .zip files, skipping directories, __MACOSX and hidden files, and preserving each entry''s zip date as lastModified for capture-order sort.

Subsystem: Step 1 — Image upload pipeline
Atlas status at seed: done

Wiring:
• triggered by: App.tsx ''Import ZIP'' button via uploadRef.triggerZip() or ZIP dropped on dropzone
• feeds: chunked upload pipeline (processFiles)
• depends on: jszip

[seeded: feature-atlas 2026-07-19]',
         false,
         3000,
         now()
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'done'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Upload] ZIP import'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'done', t.rank, now()
from new_card nc
cross join (values
  ('Multi-ZIP support', 'multiple ZIPs extracted in parallel via Promise.all, results flattened and sorted oldest-first by lastModified', 1000.0),
  ('Extracting spinner', 'extractingZip state shows ''Extracting ZIP… please wait'' in the dropzone', 2000.0),
  ('MIME reconstruction', 'MIME type rebuilt from file extension since zip entries carry no type', 3000.0)
) as t(title, notes, rank);

-- 4. [Upload] EXIF capture-time read at upload
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Upload] EXIF capture-time read at upload',
         'getCapturedAt() parses EXIF DateTimeOriginal from JPEGs via exifr (fallback file.lastModified) for every file in parallel before upload, and files are sorted oldest-first so batches enter the app in real shot order.

Subsystem: Step 1 — Image upload pipeline
Atlas status at seed: done

Wiring:
• consumed by: Step 2 date sort/date filter and capture-date card labels (ImageGrouper)
• consumed by: CSV export shoot-order row sorting (GoogleSheetExporter)
• persisted via: slimForWorkflowState whitelist (auto-save) and Stage 4 product_images.captured_at dual-write
• depends on: exifr

[seeded: feature-atlas 2026-07-19]',
         false,
         4000,
         now()
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'done'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Upload] EXIF capture-time read at upload'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'done', t.rank, now()
from new_card nc
cross join (values
  ('Non-JPEG / parse-failure fallback', 'non-JPEGs, missing tags, or exifr errors silently fall back to file.lastModified', 1000.0),
  ('capturedAt on ClothingItem', 'the resolved timestamp is stored as item.capturedAt on every uploaded item', 2000.0)
) as t(title, notes, rank);

-- 5. [Upload] Client-side canvas compression on upload
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Upload] Client-side canvas compression on upload',
         'compressImage() resizes each file so the longest side is ≤2000px and re-encodes as JPEG at quality 0.88 before upload (COMPRESS_ON_UPLOAD gate), preserving lastModified; compression failure falls back to the original file.

Subsystem: Step 1 — Image upload pipeline
Atlas status at seed: done

Wiring:
• feeds: TUS/PUT upload (smaller payloads) and storage meter (lower usage)
• consumed by: recompress-existing tool (shares compressImage + registry)
• interacts with: Step 3 crop tool (imageTransforms re-encodes at 92% — compression quality chosen to avoid double-generation loss)

[seeded: feature-atlas 2026-07-19]',
         false,
         5000,
         now()
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'done'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Upload] Client-side canvas compression on upload'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'done', t.rank, now()
from new_card nc
cross join (values
  ('Tuning constants', 'COMPRESS_MAX_PX=2000, COMPRESS_QUALITY=0.88, RECOMPRESS_SKIP_UNDER_BYTES=200KB at top of file; raised from 1200/0.75 after visible pixelation', 1000.0),
  ('Compressed-paths registry', 'markCompressed()/getCompressedPaths() persist every compressed storagePath to localStorage key sortbot_compressed_paths so images are compressed at most once', 2000.0)
) as t(title, notes, rank);

-- 6. [Upload] TUS resumable upload with standard-PUT fallback
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Upload] TUS resumable upload with standard-PUT fallback',
         'tusUploadFile() uploads each file to Supabase Storage''s TUS endpoint in 6MB chunks with the user''s bearer token (so Storage RLS applies), resuming interrupted uploads from localStorage fingerprints; on any TUS failure uploadToSupabase falls back to the standard supabase.storage.upload PUT.

Subsystem: Step 1 — Image upload pipeline
Atlas status at seed: done

Wiring:
• depends on: Supabase auth session token (rejects with no session) and VITE_SUPABASE_URL
• consumed by: uploadToSupabase in ImageUpload (primary path for every file)
• produces: {storagePath, publicUrl} — the storagePath is the app-wide durable image reference used by slim()/restore/Library/CSV

[seeded: feature-atlas 2026-07-19]',
         true,
         6000,
         now()
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'done'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Upload] TUS resumable upload with standard-PUT fallback'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'done', t.rank, now()
from new_card nc
cross join (values
  ('Resume from previous session', 'findPreviousUploads + resumeFromPreviousUpload restarts an interrupted file from the exact byte it stopped at', 1000.0),
  ('Internal retry backoff', 'tus retryDelays [0,1s,3s,5s,10s,30s] for transient chunk errors', 2000.0),
  ('Stale fingerprint purge', 'processFiles deletes all ''tus::'' localStorage keys at start so re-dropped files never resume to an old storage path that would create DB rows pointing at nonexistent files', 3000.0),
  ('Dynamic import', 'tus-js-client loaded via dynamic import so it stays out of the main bundle', 4000.0),
  ('Progress + chunk logging', '25%-milestone progress logs and per-PATCH logs for diagnosing stalled uploads', 5000.0)
) as t(title, notes, rank);

-- 7. [Upload] Per-file upload retry + failed-uploads banner
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Upload] Per-file upload retry + failed-uploads banner',
         'Each file gets up to 5 upload attempts with 1s→16s exponential backoff; files that exhaust all attempts are queued in failedUploads state and shown in a red banner (first 10 names) with ''Retry All'' and dismiss buttons — no silent blob-URL ghost items are ever created.

Subsystem: Step 1 — Image upload pipeline
Atlas status at seed: done

Wiring:
• depends on: TUS/PUT upload path (uploadToSupabase returning null)
• prevents: blob-only ghost items that would vanish on reload (Do-Not rule about blob URLs in DB)

[seeded: feature-atlas 2026-07-19]',
         false,
         7000,
         now()
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'done'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Upload] Per-file upload retry + failed-uploads banner'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'done', t.rank, now()
from new_card nc
cross join (values
  ('Retry All', 'retryFailedUploads clears the queue and re-runs processFiles on just the failed File objects', 1000.0),
  ('Live banner accumulation', 'failures append per-chunk via setFailedUploads so the banner updates while the batch is still uploading', 2000.0)
) as t(title, notes, rank);

-- 8. [Upload] Chunked upload pipeline with per-chunk DB write and progressive rendering
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Upload] Chunked upload pipeline with per-chunk DB write and progressive rendering',
         'processFiles uploads in chunks of 10 (parallel within a chunk); after each chunk it writes products + product_images rows immediately (crash recovery — a drop at image 900/1500 keeps the first 900 recoverable) and fires onChunkReady so the parent renders images as they land.

Subsystem: Step 1 — Image upload pipeline
Atlas status at seed: done

Wiring:
• feeds: Step 2 ImageGrouper (progressive item arrival) via workflowStore arrays
• writes to: products + product_images tables (Supabase)
• depends on: batch-ID minting (getBatchId ref read) so rows carry the right batch_id from chunk 1
• consumed by: Library (rows visible immediately) and crash-recovery restore

[seeded: feature-atlas 2026-07-19]',
         true,
         8000,
         now()
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'done'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Upload] Chunked upload pipeline with per-chunk DB write and progressive rendering'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'done', t.rank, now()
from new_card nc
cross join (values
  ('Per-chunk products upsert', 'products rows upserted first (ignoreDuplicates:true, batch_id from getBatchId()) so the product_images FK is valid', 1000.0),
  ('Per-chunk product_images insert', 'plain insert — fresh UUID paths make duplicates impossible; errors logged, not fatal', 2000.0),
  ('handleChunkReady 150ms debounce', 'App accumulates chunk items in pendingChunkRef and flushes to uploadedImages at most every 150ms to avoid 39 repaints on a 385-image batch', 3000.0),
  ('Add-more streaming into open batch', 'when a batch is already open, fresh chunk items are also streamed into groupedImages/sortedImages/processedItems so grouping can start mid-upload', 4000.0),
  ('isUploadingRef cascade suppressor', 'set during upload so handleImagesGrouped skips its setGroupedImages cascade per debounce flush', 5000.0)
) as t(title, notes, rank);

-- 9. [Upload] Batch-ID minting and stub workflow_batches row insert
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Upload] Batch-ID minting and stub workflow_batches row insert',
         'handleUploadStart (fired synchronously before any file is processed) mints a stable batch UUID into currentBatchIdRef/state/localStorage; handleImagesUploaded pre-INSERTs the workflow_batches stub row exactly once (batchRowInsertedRef guard) so auto-save''s blind UPDATE always finds a row — the fix for duplicate-batch forking.

Subsystem: Step 1 — Image upload pipeline
Atlas status at seed: done

Wiring:
• triggered by: ImageUpload onUploadStart callback at the top of processFiles
• feeds: auto-save (autoSaveWorkflowBatch blind UPDATE), per-chunk DB writes (getBatchId), ImageGrouper batchId prop stability (prevents mid-upload group wipes)
• consumed by: session restore (sortbot_current_batch_id in localStorage) and Library

[seeded: feature-atlas 2026-07-19]',
         false,
         9000,
         now()
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'done'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Upload] Batch-ID minting and stub workflow_batches row insert'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'done', t.rank, now()
from new_card nc
cross join (values
  ('Fallback minting', 'handleChunkReady and handleImagesUploaded both re-mint if handleUploadStart somehow didn''t fire (tiny uploads racing)', 1000.0),
  ('Reload-safe insert guard', 'batchRowInsertedRef initialized true when localStorage already holds a batch id, preventing a 409 re-INSERT on reload', 2000.0)
) as t(title, notes, rank);

-- 10. [Upload] Upload completion finalization (handleImagesUploaded)
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Upload] Upload completion finalization (handleImagesUploaded)',
         'After all chunks finish, App dedups against already-streamed items, appends any stragglers to all four workflowStore arrays, triggers auto-save with the fresh arrays, upserts stub products + product_images rows (best-effort, ignoreDuplicates), bumps libraryRefreshTrigger, fires the ''N images uploaded'' toast, and refreshes the storage meter.

Subsystem: Step 1 — Image upload pipeline
Atlas status at seed: done

Wiring:
• triggered by: ImageUpload onImagesUploaded after the last chunk
• feeds: auto-save (workflow_state), Library refresh trigger, storage meter refetch, toast system
• depends on: imageRowSync (stage4ColumnsAvailable, buildProductImageRow), workflowStore setters
• consumed by: Steps 2–4 via the four item arrays

[seeded: feature-atlas 2026-07-19]',
         false,
         10000,
         now()
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'done'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Upload] Upload completion finalization (handleImagesUploaded)'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'done', t.rank, now()
from new_card nc
cross join (values
  ('Ref-based dedup', 'reads uploadedImagesRef/groupedImagesRef live views so a just-opened batch''s un-committed state can''t cause double-adds', 1000.0),
  ('Stage 4 dual-write', 'product_images rows built via buildProductImageRow with stage4ColumnsAvailable() probe (captured_at/original_storage_path omitted pre-migration)', 2000.0),
  ('original_name at upload time', 'filename persisted immediately so name-sort works without a batch reopen', 3000.0)
) as t(title, notes, rank);

-- 11. [Upload] Recompress existing images (current batch)
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Upload] Recompress existing images (current batch)',
         'Green ''🗜️ Compress N Images'' button (shown only when uncompressed candidates exist among existingItems) downloads each image from its CDN URL, canvas-compresses it, and re-uploads to the SAME storagePath with upsert:true so URLs/DB rows never change; skips files <200KB, small AVIFs, or <10% savings.

Subsystem: Step 1 — Image upload pipeline
Atlas status at seed: done

Wiring:
• depends on: compressImage + compressed-paths registry, Supabase Storage upsert upload
• triggered by: existingItems prop from App (current batch''s uploadedImages)
• feeds: toast notifications, storage savings (meter reflects on next refresh)
• safe because: same storagePath means workflow_state, product_images, and CDN URLs are all untouched

[seeded: feature-atlas 2026-07-19]',
         true,
         11000,
         now()
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'done'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Upload] Recompress existing images (current batch)'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'done', t.rank, now()
from new_card nc
cross join (values
  ('Once-only guard', 'localStorage sortbot_compressed_paths set filters candidates; skipped/already-done counts surfaced in UI', 1000.0),
  ('Chunked processing', '5 images at a time with live progress panel (done/total, KB/MB saved, skipped)', 2000.0),
  ('Per-image error list', 'fetch/upload errors collected and rendered in the done panel', 3000.0),
  ('Completion toast', 'onToast fires ''✅ Compression done · X saved'' summary to App''s toast stack', 4000.0)
) as t(title, notes, rank);

-- 12. [Upload] Auto EXIF rescan for restored batches
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Upload] Auto EXIF rescan for restored batches',
         'Both startup restore and handleOpenBatch fire a background rescan for items missing capturedAt (pre-ac06e11 batches): fetch each image blob from CDN, exifr-parse DateTimeOriginal in chunks of 5, patch all four workflow arrays by id, then auto-save so corrected dates survive reload; hard-capped at 30 items to avoid freezing the browser on full-res downloads.

Subsystem: Step 1 — Image upload pipeline
Atlas status at seed: done

Wiring:
• triggered by: startup session restore and Library batch open (handleOpenBatch)
• feeds: Step 2 date sort/labels/date-filter and CSV shoot-order via capturedAt, then auto-save (workflow_state persistence)
• depends on: exifr, Supabase CDN URLs reconstructed from storagePath

[seeded: feature-atlas 2026-07-19]',
         false,
         12000,
         now()
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'done'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Upload] Auto EXIF rescan for restored batches'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'done', t.rank, now()
from new_card nc
cross join (values
  ('Fire-and-forget', 'runs after state is set and UI is visible; failures per-image are non-fatal', 1000.0),
  ('30-item safety cap', 'large batches skip the rescan entirely — dates are non-critical sort hints', 2000.0)
) as t(title, notes, rank);

-- 13. [Upload] Storage usage meter
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Upload] Storage usage meter',
         'Always-visible bar under the header: fetchStorageUsage walks the product-images bucket (list userId folders, then per-folder file listing when folder metadata lacks size) to sum bytes and file count; rendered with GB used / VITE_STORAGE_LIMIT_GB limit (default 100), percent, file count, threshold colors (green/amber >60%/red >85%), an ''⚠️ Almost full'' warning, and a manual 🔄 refresh button.

Subsystem: Step 1 — Image upload pipeline
Atlas status at seed: done

Wiring:
• depends on: Supabase Storage list API and VITE_STORAGE_LIMIT_GB env var
• triggered by: login, upload completion (handleImagesUploaded), manual refresh button
• informs: recompress tooling decisions (storage pressure)

[seeded: feature-atlas 2026-07-19]',
         false,
         13000,
         now()
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'done'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Upload] Storage usage meter'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'done', t.rank, now()
from new_card nc
cross join (values
  ('Auto-refresh triggers', 'fetched on login (user effect) and after each completed upload; recompress savings appear on next refresh', 1000.0),
  ('Calculating state', 'shows ''Calculating…'' only on first load; subsequent refreshes keep stale numbers visible while loading', 2000.0)
) as t(title, notes, rank);

-- 14. [Upload] Toast notification system
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Upload] Toast notification system',
         'App-level toasts state with addToast/dismissToast: auto-dismiss after 4s, manual ✕ close, rendered in a fixed .toast-stack overlay; upload completion (''✓ N images uploaded'') and recompression summaries are the Step 1 producers.

Subsystem: Step 1 — Image upload pipeline
Atlas status at seed: done

Wiring:
• triggered by: upload completion, recompress completion (and available to any other subsystem via addToast)
• replaced: inline ''N images uploaded'' banners (moved to toasts in c7c6538)

[seeded: feature-atlas 2026-07-19]',
         false,
         14000,
         now()
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'done'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Upload] Toast notification system'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'done', t.rank, now()
from new_card nc
cross join (values
  ('onToast prop', 'ImageUpload receives addToast as onToast so component-level events (recompress done) surface app-wide', 1000.0),
  ('Monotonic ids', 'toastCounterRef gives each toast a stable id for targeted dismissal', 2000.0)
) as t(title, notes, rank);

-- 15. [Upload] Step 1 header import buttons + batch-active hint
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Upload] Step 1 header import buttons + batch-active hint',
         'App.tsx renders ''Import Folder'' and ''Import ZIP'' buttons in the step1-header (disabled while uploadRef.isBusy) plus a contextual hint line — ''➕ Batch active — drop more images to add them'' when a batch with images is open, else a multi-batch tip.

Subsystem: Step 1 — Image upload pipeline
Atlas status at seed: done

Wiring:
• depends on: ImageUploadHandle imperative ref (triggerFolder/triggerZip/isBusy)
• feeds: folder/ZIP import flows
• reflects: batch lifecycle state (currentBatchId + uploadedImages.length)

[seeded: feature-atlas 2026-07-19]',
         false,
         15000,
         now()
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'done'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Upload] Step 1 header import buttons + batch-active hint'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'done', t.rank, now()
from new_card nc
cross join (values
  ('isBusy disable', 'buttons grey out during upload or ZIP extraction via the imperative handle''s isBusy flag', 1000.0)
) as t(title, notes, rank);

-- 16. [Group] Step 2 multi-select mechanics
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Group] Step 2 multi-select mechanics',
         'Click/Shift+click/Cmd-click selection of single cards and whole groups, with double-fire debounce and selection lifted to App for CategoryZones to consume.

Subsystem: Step 2 — Grouping, categorization, presets application
Atlas status at seed: done

Wiring:
• consumed by: CategoryZones click-to-assign and preset zones (selectedItemIds)
• consumed by: photo toolbar (rotate/paste/revert/delete act on selection)
• consumed by: right-panel action buttons via GrouperActions.selectedCount
• triggered by: pick mode and photo pick mode which own the selection lifecycle

[seeded: feature-atlas 2026-07-19]',
         true,
         16000,
         now()
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'done'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Group] Step 2 multi-select mechanics'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'done', t.rank, now()
from new_card nc
cross join (values
  ('Click toggle', 'toggleItemSelection toggles a single card on mousedown; 200ms per-item debounce guards hardware double-click double-fire', 1000.0),
  ('Shift+click range', 'Selects the filename-order range between lastClickedSingleRef and the clicked item within the singles list', 2000.0),
  ('Group-as-unit selection', 'toggleGroupSelection selects/deselects every member of a group at once; card shows all-selected/some-selected states', 3000.0),
  ('Click-outside deselect', 'Document mousedown clears selection unless target is a card, button, CategoryZones panel, or grouper-actions-sidebar; suppressed in pick/photo-pick modes', 4000.0),
  ('Selection lifting', 'onSelectionChange(Set<id>) → App.selectedGroupItems → CategoryZones selectedItemIds prop', 5000.0)
) as t(title, notes, rank);

-- 17. [Group] Rubber-band (marquee) selection
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Group] Rubber-band (marquee) selection',
         'Drag-select in the singles or groups grid with a 5px activation threshold, edge auto-scroll RAF loop, and shift-additive mode.

Subsystem: Step 2 — Grouping, categorization, presets application
Atlas status at seed: done

Wiring:
• feeds: Step 2 multi-select mechanics (updates the same selectedItems set and notifies App)
• suppresses: card drag (draggable disabled while selectionThresholdMet)

[seeded: feature-atlas 2026-07-19]',
         true,
         17000,
         now()
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'done'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Group] Rubber-band (marquee) selection'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'done', t.rank, now()
from new_card nc
cross join (values
  ('Stable listener registration', 'useEffect dep array is [isSelecting] only; all mutable values read via per-render refs to avoid listener churn/event drops', 1000.0),
  ('Edge auto-scroll', 'RAF loop scrolls grouper-scroll-content when cursor is within 60px of edges and re-grows the box over newly revealed items', 2000.0),
  ('Container-aware hit test', 'Singles container selects individual cards; groups container selects whole group cards (all member ids added)', 3000.0),
  ('Shift-additive', 'Mouseup with shiftKey merges the box result into the existing selection instead of replacing it', 4000.0)
) as t(title, notes, rank);

-- 18. [Group] Step 2 keyboard shortcuts
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Group] Step 2 keyboard shortcuts',
         'Global keydown handlers for grouping, selection, undo/redo, and photos-per-item, all no-ops when an input/textarea has focus.

Subsystem: Step 2 — Grouping, categorization, presets application
Atlas status at seed: done

Wiring:
• triggers: manual grouping, undo/redo history, pick-mode N (autoGroupN)
• depends on: live refs (selectedItemsRef, singleItemsRef, multiItemGroupsRef) for stale-closure safety

[seeded: feature-atlas 2026-07-19]',
         true,
         18000,
         now()
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'done'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Group] Step 2 keyboard shortcuts'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'done', t.rank, now()
from new_card nc
cross join (values
  ('Cmd+Enter', 'Group selected (Cmd+G abandoned — browser intercepts it)', 1000.0),
  ('Cmd+Backspace', 'Ungroup selected (members become singles, category cleared)', 2000.0),
  ('Cmd+A / Cmd+Shift+A / Cmd+D', 'Toggle-select all singles / all multi-image groups / hard deselect', 3000.0),
  ('Cmd+Z / Cmd+Shift+Z', 'Undo/redo grouping history; key-repeat ignored', 4000.0),
  ('Cmd+1–9 / Cmd+0', 'Sets the Photos/item count (0 = 10) driving auto-group and pick mode', 5000.0),
  ('Cheatsheet panel', 'Static shortcut reference rendered in the left sidebar', 6000.0)
) as t(title, notes, rank);

-- 19. [Group] Manual grouping / ungrouping
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Group] Manual grouping / ungrouping',
         'Create a group from selected items using the leader-id convention (groupId = first member''s id), ungroup selected/all/one-group, and drag items between groups or back to singles.

Subsystem: Step 2 — Grouping, categorization, presets application
Atlas status at seed: done

Wiring:
• feeds: App.handleImagesGrouped via onGrouped on every change (state sync + debounced products upsert + auto-save)
• consumed by: lib/grouping.ts buildGroupArray in Step 3 (tolerant leader/shared-id resolution heals legacy fresh-UUID groups)
• triggers: pick mode advance (pendingPickRef) after each group action
• recorded in: undo/redo history via commitUpdate

[seeded: feature-atlas 2026-07-19]',
         true,
         19000,
         now()
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'done'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Group] Manual grouping / ungrouping'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'done', t.rank, now()
from new_card nc
cross join (values
  ('createGroupFromSelected', 'Requires ≥2 selected; sets productGroup = grouped[0].id (leader convention — fresh UUIDs broke Step 3 nav, July 2026)', 1000.0),
  ('ungroupSelected / ungroupAll / ungroupGroup', 'Reset productGroup to own id and clear category (ungroupAll keeps categories); ungroupGroup is the ⋯ menu per-group action', 2000.0),
  ('Drag item onto a group card', 'handleDrop moves the item into the target group; a source group left with 1 member auto-dissolves to a singleton', 3000.0),
  ('Individuals drop zone', 'Always-visible zone that ejects a dragged photo back to singles', 4000.0),
  ('Cross-render drag payload', 'dataTransfer application/json carries item + productGroup so drops survive re-renders and reach CategoryZones', 5000.0)
) as t(title, notes, rank);

-- 20. [Group] Grouping undo/redo history
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Group] Grouping undo/redo history',
         '50-deep snapshot stack of groupedItems; commitUpdate is the single write path for user grouping actions, with deletes deliberately excluded from history.

Subsystem: Step 2 — Grouping, categorization, presets application
Atlas status at seed: done

Wiring:
• wraps: manual grouping, auto-group, drag-move, lightbox rotate
• feeds: App.handleImagesGrouped on every undo/redo (persists the restored state)

[seeded: feature-atlas 2026-07-19]',
         true,
         20000,
         now()
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'done'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Group] Grouping undo/redo history'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'done', t.rank, now()
from new_card nc
cross join (values
  ('commitUpdate', 'Deep-clones current state onto the undo stack, clears redo, applies new items, calls onGrouped', 1000.0),
  ('handleUndo/handleRedo', 'Pop/push between stacks; also fire onGrouped so App/DB stay in sync', 2000.0),
  ('skipHistory for deletes', 'deleteSelected/deleteGroup pass skipHistory=true since storage/DB deletion is irreversible', 3000.0),
  ('Sidebar Undo/Redo pills + Cmd+Z', 'Visible only when stacks are non-empty; reset on batch switch', 4000.0)
) as t(title, notes, rank);

-- 21. [Group] Auto-group by N photos/item
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Group] Auto-group by N photos/item',
         'Chunks all images into consecutive groups of N by natural filename order (fallback capturedAt), replacing all existing grouping; each chunk''s group id is its first item''s id.

Subsystem: Step 2 — Grouping, categorization, presets application
Atlas status at seed: done

Wiring:
• depends on: originalName captured at upload (Step 1 EXIF/filename pipeline)
• feeds: App.handleImagesGrouped; undoable via Cmd+Z
• shares: autoGroupN state with pick mode

[seeded: feature-atlas 2026-07-19]',
         false,
         21000,
         now()
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'done'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Group] Auto-group by N photos/item'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'done', t.rank, now()
from new_card nc
cross join (values
  ('N input + Apply + Enter', 'Number input 1–50 with confirm dialog; Enter in the input also applies', 1000.0),
  ('Quick-set slider', 'Range 1–10 mirrors autoGroupN; Cmd+1–9/0 also set it', 2000.0),
  ('Natural filename sort', 'localeCompare({numeric:true}) on originalName so DSC02175 < DSC02176; unnamed files fall back to capturedAt', 3000.0)
) as t(title, notes, rank);

-- 22. [Group] Pick mode (auto-select next N)
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Group] Pick mode (auto-select next N)',
         'Toggle that auto-selects the next N ungrouped singletons (in the current grid sort order) and advances after each group/category action for rapid-fire grouping.

Subsystem: Step 2 — Grouping, categorization, presets application
Atlas status at seed: done

Wiring:
• triggered by: createGroupFromSelected and GrouperActions.onCategoryAssigned (called from App after CategoryZones assigns a category)
• depends on: sortOrder + autoGroupN + nameKey natural sort

[seeded: feature-atlas 2026-07-19]',
         true,
         22000,
         now()
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'done'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Group] Pick mode (auto-select next N)'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'done', t.rank, now()
from new_card nc
cross join (values
  ('Cursor + advance', 'pendingPickRef set after group/category actions; a groupedItems-watching effect re-selects the next slice once state has flushed', 1000.0),
  ('Live N re-select', 'Changing autoGroupN while pick mode is on immediately re-selects from cursor 0', 2000.0),
  ('Category-tolerant pool', 'Pool is any singleton regardless of category (excluding categorized items broke the ungroup→crop→regroup flow)', 3000.0),
  ('Auto-off', 'Turns itself off when no ungrouped items remain', 4000.0),
  ('Selection ownership', 'Click-outside deselect is suppressed while pick mode is active', 5000.0)
) as t(title, notes, rank);

-- 23. [Group] Photo toolbar (pick photos + rotate/copy/paste/revert/delete)
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Group] Photo toolbar (pick photos + rotate/copy/paste/revert/delete)',
         'Sticky toolbar above the grid consolidating all per-photo actions: a 🎯 photo pick mode (selects photos even inside group cards), bulk rotate, crop/rotation format painter, revert-to-original, bulk delete, and originals-cache purge.

Subsystem: Step 2 — Grouping, categorization, presets application
Atlas status at seed: done

Wiring:
• depends on: crop engine (applyAndPersistTransformGrouper) and lib/imageTransforms createTransformedFile
• feeds: App.handleImagesGrouped (deferred onGrouped after batch completes → auto-save)
• writes: Supabase Storage + product_images directly (upload new cropped file, delete previous crop)

[seeded: feature-atlas 2026-07-19]',
         true,
         23000,
         now()
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'done'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Group] Photo toolbar (pick photos + rotate/copy/paste/revert/delete)'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'done', t.rank, now()
from new_card nc
cross join (values
  ('Photo pick mode', 'photoSelectMode makes clicking any photo (incl. inside groups) toggle .photo-picked selection; suppresses drag-reorder and click-outside clear', 1000.0),
  ('Rotate selected ±90', 'rotateSelected updates imageRotation on all selected items (CSS transform; persisted via slim/transforms dual-write)', 2000.0),
  ('Copy Rot / Copy Crop', 'Copies from the first selected image then clears selection so targets can be picked', 3000.0),
  ('Paste to N', 'runCropBatchPaste applies crop(+rotation) to selected ids in parallel batches of 8 with wake lock, progress toast, and per-item failure retry button; rotation-only paste is a pure state update', 4000.0),
  ('Revert selected', 'revertToOriginalBatch restores originalStoragePath/originalUrl, deleting the cropped copies', 5000.0),
  ('Clear originals cache', 'Permanently deletes cached pre-crop files from Storage + product_images rows (selected or all), disabling future revert', 6000.0)
) as t(title, notes, rank);

-- 24. [Group] Step 2 lightbox + full-screen crop tool
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Group] Step 2 lightbox + full-screen crop tool',
         'Double-click opens a lightbox with group/singles navigation, rotate, copy rot/crop, and an iOS-style full-screen crop UI (aspect presets, drag handles) that re-encodes and re-uploads the image.

Subsystem: Step 2 — Grouping, categorization, presets application
Atlas status at seed: done

Wiring:
• shares: crop-fs-* CSS and behavior with Step 3 (ProductDescriptionGenerator crop tool)
• feeds: photo toolbar copy/paste crop (copiedCrop/copiedRotation)
• writes: Supabase Storage + product_images; new storagePath propagates through onGrouped → auto-save → workflow_state

[seeded: feature-atlas 2026-07-19]',
         true,
         24000,
         now()
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'done'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Group] Step 2 lightbox + full-screen crop tool'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'done', t.rank, now()
from new_card nc
cross join (values
  ('Lightbox pool navigation', 'Pool = group members if grouped, else all singles; arrow keys/buttons cycle with counter', 1000.0),
  ('Crop UI', 'FREE/1:1/9:16/16:9/4:5/3:2 presets, corner/edge/move handles, rule-of-thirds grid; cropRequestedRef synchronous guard stops overlay-close races', 2000.0),
  ('applyAndPersistTransformGrouper', 'createTransformedFile → upload to fresh cropped-<ts> path → insert product_images row → delete previous intermediate crop (original kept for revert) → commitFunctional state patch + onGrouped', 3000.0),
  ('Original caching', 'First crop stores originalStoragePath/originalUrl on the item so revert is possible; session image cache evicted post-crop', 4000.0),
  ('Crop upload indicator', 'Fixed toast while a single crop uploads; batch paste shows the progress overlay instead', 5000.0)
) as t(title, notes, rank);

-- 25. [Group] Group card select bar + ⋯ actions menu
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Group] Group card select bar + ⋯ actions menu',
         'Group cards have a full-width select bar (check circle toggles whole-group selection) and a ⋯ dropdown with Copy crop, Paste crop, Ungroup, and Delete group; photos inside the card are drag-reorder/lightbox only.

Subsystem: Step 2 — Grouping, categorization, presets application
Atlas status at seed: done

Wiring:
• feeds: Library refresh via onImageDeleted → App libraryRefreshTrigger
• depends on: crop batch paste engine and grouping/ungroup helpers
• note: leader-photo deletion is safe because grouping.ts resolves shared group ids tolerantly

[seeded: feature-atlas 2026-07-19]',
         true,
         25000,
         now()
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'done'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Group] Group card select bar + ⋯ actions menu'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'done', t.rank, now()
from new_card nc
cross join (values
  ('Select bar', 'Bar (badge + category chip + check) toggles group selection; clicks on .group-images or the menu never toggle', 1000.0),
  ('⋯ menu', 'openMenuGroupId state, closes on outside mousedown; Paste crop disabled until a crop is copied', 2000.0),
  ('Per-group Copy/Paste crop', 'Copies from the first cropped member; paste runs runCropBatchPaste over all members', 3000.0),
  ('Delete group…', 'deleteGroup: confirm → storage remove + product_images + products delete → state prune (skipHistory) → onImageDeleted', 4000.0),
  ('In-group photo drag reorder', 'handlePhotoDragStart/Drop reorders photos within a group; cross-group photo drops delegate to handleDrop', 5000.0)
) as t(title, notes, rank);

-- 26. [Group] Sort/filter sidebar + stats
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Group] Sort/filter sidebar + stats',
         'Sticky left sidebar with live stats (groups/singles/listings/images/selected), 4 sort modes, combinable view/date/category filters, columns-per-row slider, and the auto-group/pick controls.

Subsystem: Step 2 — Grouping, categorization, presets application
Atlas status at seed: done

Wiring:
• feeds: pick mode (uses current sortOrder to pick the next N)
• consumed by: rubber-band + Cmd+A shortcuts (operate on the derived singles/groups lists)
• note: onStatsChange is wired to a no-op in App — Step 3 stats now computed from processedItems directly

[seeded: feature-atlas 2026-07-19]',
         true,
         26000,
         now()
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'done'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Group] Sort/filter sidebar + stats'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'done', t.rank, now()
from new_card nc
cross join (values
  ('Sort', 'date-asc (default) / date-desc by capturedAt, name-asc/desc by originalName natural order; groups sort by min member capturedAt', 1000.0),
  ('Within-group sort', 'Group members always filename-sorted so the representative thumbnail is the first shot', 2000.0),
  ('Filters (AND logic)', 'Groups/Singles view toggles, capture-date dropdown (unique dates), per-category + Uncategorized toggle buttons, ✕ Clear; headings show ''N of Total''', 3000.0),
  ('Columns slider', '2–12 columns applied to both grids via gridTemplateColumns', 4000.0),
  ('Memoized derivation', 'multiItemGroups/singleItems/filter option sets recompute only on groupedItems/sortOrder/manualOrder change', 5000.0)
) as t(title, notes, rank);

-- 27. [Group] Item initialization + in-grouper upload sync
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Group] Item initialization + in-grouper upload sync',
         'The [items]-effect dedupes new props items against local state, syncs external category/group/image-URL changes, and uploads any items still carrying blob files to Supabase Storage with progress UI.

Subsystem: Step 2 — Grouping, categorization, presets application
Atlas status at seed: done

Wiring:
• triggered by: App items prop (groupedImages || uploadedImages) after Step 1 upload, batch open, or restore
• feeds: App.handleImagesGrouped with final authoritative URLs after uploads
• depends on: Supabase Storage bucket product-images

[seeded: feature-atlas 2026-07-19]',
         true,
         27000,
         now()
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'done'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Group] Item initialization + in-grouper upload sync'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'done', t.rank, now()
from new_card nc
cross join (values
  ('Metadata-only sync', 'When no new items: patches productGroup/category from props while protecting local image fields (crop/original paths always win locally)', 1000.0),
  ('Fast path', 'New items that already have Supabase URLs (from Step 1 chunked upload) append synchronously via functional updater', 2000.0),
  ('uploadImageImmediately', 'Fallback direct Storage upload for blob-only items (userId/itemId/timestamp-rand path), swapping blob URLs in place with progress bar', 3000.0),
  ('Batch-switch reset', 'batchId prop change wipes local state, history, and selection before new items initialize', 4000.0),
  ('Image load retry', 'retryImg: 3 retries with 500/1500/4500ms backoff + cache-bust; never deletes DB rows on load error', 5000.0)
) as t(title, notes, rank);

-- 28. [Group] Bulk image deletion (Step 2)
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Group] Bulk image deletion (Step 2)',
         'Delete Selected (toolbar + right-panel button) and Delete group remove files from Storage, product_images rows by storage_path, and products rows by id, then prune state and refresh Library.

Subsystem: Step 2 — Grouping, categorization, presets application
Atlas status at seed: done

Wiring:
• feeds: Library refresh via onImageDeleted → libraryRefreshTrigger
• feeds: App.handleImagesGrouped (prunes uploadedImages/sortedImages/processedItems of deleted ids)
• contrast: Library deletion path uses lib/storageSafety.ts; this path does not

[seeded: feature-atlas 2026-07-19]',
         true,
         28000,
         now()
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'done'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Group] Bulk image deletion (Step 2)'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'done', t.rank, now()
from new_card nc
cross join (values
  ('Confirm dialog', 'Native confirm() with count before any deletion', 1000.0),
  ('Parallel storage removal', 'deleteImageFromStorage per path via Promise.all', 2000.0),
  ('No storageSafety guard', 'Deletes storage directly — does NOT route through storageSafety.filterUnreferencedStoragePaths (Library deletes do); shared-file batches could lose files here', 3000.0),
  ('History exempt', 'commitUpdate(…, true) — deletes are not undoable', 4000.0)
) as t(title, notes, rank);

-- 29. [Group] CategoryZones — preset drop zones + click-assign
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Group] CategoryZones — preset drop zones + click-assign',
         'Right panel renders one clickable/droppable zone per active gender-filtered preset (plus a Clear Category zone); assigning merges selected singles into one group, applies the preset independently to each selected multi-group, and emits the updated item list.

Subsystem: Step 2 — Grouping, categorization, presets application
Atlas status at seed: done

Wiring:
• consumes: ImageGrouper selection via App.selectedGroupItems
• feeds: App.handleImagesSorted via onCategorized (sets sorted/grouped/processed + auto-save + immediate products upsert)
• triggers: App onCategoryAssigned → clears selection + GrouperActions.onCategoryAssigned (pick-mode advance)
• depends on: getCategoryPresets (loaded once on mount) + applyPresetDirectly (no per-group network fetch)
• note: this is now the ONLY Step 2 preset-apply path — App''s handleApplyPreset/sidebar preset picker was removed (App.tsx:2847 comment)

[seeded: feature-atlas 2026-07-19]',
         true,
         29000,
         now()
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'done'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Group] CategoryZones — preset drop zones + click-assign'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'done', t.rank, now()
from new_card nc
cross join (values
  ('Preset-driven zones', 'Zones come from category_presets rows filtered by gender (Men/Women/Kids toggle, localStorage-persisted) with fixed sort order, per-type colors, live per-category counts, and lucide icon mapping', 1000.0),
  ('Category search', 'Normalized substring search over display names with clear button', 2000.0),
  ('findPreset matching', 'product_type exact (default preferred) → category_name → ''<name>_default'' prefix; no wild fallback — unmatched categories get plain category assignment', 3000.0),
  ('handleCategoryClick', 'Selected singles merge into one group + preset applied; true multi-groups keep their id and get the preset applied to ALL members wholesale', 4000.0),
  ('handleCategoryDrop', 'Drop with a selection delegates to click path; otherwise applies to the single dragged group from the dataTransfer payload', 5000.0),
  ('Clear Category zone', 'Click (selection) or drop (dragged group) sets category: undefined', 6000.0),
  ('categoriesUpdated listener', 'Reloads categories on the CategoriesManager custom event (categories state currently unused for zone rendering — zones are preset-driven)', 7000.0)
) as t(title, notes, rank);

-- 30. [Group] Preset application engine
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Group] Preset application engine',
         'applyPresetDirectly/applyPresetFields maps ~45 preset fields onto items with a strict priority hierarchy (voice/manual > preset > empty), force-mode reset for preset-owned fields, SEO title template interpolation, and weight-to-grams conversion.

Subsystem: Step 2 — Grouping, categorization, presets application
Atlas status at seed: done

Wiring:
• consumed by: CategoryZones click/drop, App presetsUpdated re-apply effect, PDG (Step 3) preset auto-apply/switch
• feeds: CSV export (shopifyProductType/weight/tags/compare-at flow into GoogleSheetExporter columns)
• feeds: Step 3 measurement ''needed'' badges via _presetData.measurementTemplate
• locked by: applyPresetToGroup.test.ts characterization tests

[seeded: feature-atlas 2026-07-19]',
         true,
         30000,
         now()
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'done'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Group] Preset application engine'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'done', t.rank, now()
from new_card nc
cross join (values
  ('Priority hierarchy', 'Voice/manual fields (brand, size, color, price, measurements, seoTitle…) never overwritten even in force mode; preset-owned fields use pick() so force resets them', 1000.0),
  ('SEO template interpolation', '{brand}/{model}/{color}/{size}/{era}/{category} tokens resolved from item-then-preset; unresolved tokens stripped', 2000.0),
  ('Weight conversion', 'presetWeightInGrams converts lb/oz/kg/g to grams since item.weightValue is always grams for CSV', 3000.0),
  ('Preset metadata', 'Stamps appliedPresetId (persists via products.applied_preset_id) and runtime-only _presetData (stripped by slim())', 4000.0),
  ('compare-at fallback', 'compare_at_price ?? suggested_price_max feeds compareAtPrice', 5000.0),
  ('Vendor deliberately unused', 'preset.vendor never becomes brand — CSV Vendor is the org-level seller name', 6000.0),
  ('Legacy async path', 'applyPresetToProductGroup (fetches presets per call) still used by Step 3 PDG auto-apply; getPresetForCategory has no consumers', 7000.0)
) as t(title, notes, rank);

-- 31. [Group] App Step 2 orchestration (handleImagesGrouped / handleImagesSorted)
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Group] App Step 2 orchestration (handleImagesGrouped / handleImagesSorted)',
         'App-level handlers that fan every grouping/categorization change into the four workflowStore arrays, the 2s-debounced workflow_state auto-save, and chunked products/product_images upserts.

Subsystem: Step 2 — Grouping, categorization, presets application
Atlas status at seed: done

Wiring:
• triggered by: ImageGrouper.onGrouped and CategoryZones.onCategorized
• feeds: auto-save (workflow_batches.workflow_state via slimForWorkflowState) + localStorage ultra-slim backup
• feeds: Library refresh (libraryRefreshTrigger) after DB writes
• feeds: Step 3 visibility — processedItems is what PDG reads from workflowStore
• depends on: liveArrayRef store views for stale-closure-free reads

[seeded: feature-atlas 2026-07-19]',
         true,
         31000,
         now()
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'done'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Group] App Step 2 orchestration (handleImagesGrouped / handleImagesSorted)'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'done', t.rank, now()
from new_card nc
cross join (values
  ('handleImagesGrouped', 'Merges live categories (groupedImagesRef), prunes deleted ids from uploadedImages/sortedImages, rebuilds processedItems preserving preset/user fields with storagePath-canonical image URLs, then auto-saves', 1000.0),
  ('Debounced group upsert', 'Separate 2s groupUpsertTimerRef: products upsert (chunks of 100, ignoreDuplicates:false on id) + product_images upsert (ignoreDuplicates:true) + pruneStaleProducts + Library refresh', 2000.0),
  ('handleImagesSorted', 'Sets sorted+grouped, merges preset-enriched items into processedItems via a userFields whitelist (voice + all 16 preset fields), auto-saves, and immediately upserts product_category/product_group for ALL registerable items', 3000.0),
  ('presetsUpdated re-apply', 'Window event from CategoryPresetsManager strips PRESET_OWNED fields and re-runs applyPresetDirectly on matching processedItems', 4000.0),
  ('GrouperErrorBoundary', 'Class boundary around ImageGrouper and CategoryZones showing the error + Retry (re-mount) instead of a white screen', 5000.0),
  ('GrouperActions lifting', 'onActionsReady exposes groupSelected/ungroup/clear/delete/selectedCount/onCategoryAssigned so App renders the right-panel action buttons', 6000.0),
  ('handleCapturedAtUpdated', 'EXIF-rescan callback patches capturedAt across all four arrays and auto-saves', 7000.0)
) as t(title, notes, rank);

-- 32. [Group] Categories management
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Group] Categories management',
         'CategoriesManager modal CRUDs the shared categories table (lucide icon picker, color, reorder, soft delete) and categoriesService seeds defaults with per-category default presets for new workspaces.

Subsystem: Step 2 — Grouping, categorization, presets application
Atlas status at seed: done

Wiring:
• consumed by: CategoryPresetsManager (category dropdown for new presets), CategoryZones (event-driven reload), ImageGrouper category filter buttons (via item.category values)
• triggered by: App header modal state (showCategoriesManager)
• depends on: shared-workspace/org RLS — getCategories has no user filter by design

[seeded: feature-atlas 2026-07-19]',
         true,
         32000,
         now()
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'done'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Group] Categories management'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'done', t.rank, now()
from new_card nc
cross join (values
  ('CRUD + reorder', 'Create (name locked after creation), edit display/icon/color, ↑/↓ reorder via sort_order rewrites, soft delete (is_active=false)', 1000.0),
  ('Auto default preset', 'createCategory best-effort creates a ''<name>_default_<rand>'' is_default preset with product_type = category name', 2000.0),
  ('Default seeding', 'initializeDefaultCategories inserts 7 defaults + default presets with DEFAULT_MEASUREMENT_TEMPLATES when zero categories exist (called by CategoriesManager and orgService on new-workspace creation)', 3000.0),
  ('categoriesUpdated event', 'Window CustomEvent after every mutation so CategoryZones reloads', 4000.0),
  ('Dead constants', 'DEFAULT_CATEGORIES and EMOJI_OPTIONS in categories.ts have no consumers (seeding uses its own inline list; icon names replaced emoji)', 5000.0)
) as t(title, notes, rank);

-- 33. [Group] Step 3 group resolution library (grouping.ts)
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Group] Step 3 group resolution library (grouping.ts)',
         'Pure, unit-tested resolver of productGroup conventions: a group id is real if it equals a member''s id (leader) OR ≥2 items share it (legacy fresh-UUID), plus the Step-3 visibility filter (categorized items + true multi-groups).

Subsystem: Step 2 — Grouping, categorization, presets application
Atlas status at seed: done

Wiring:
• consumed by: ProductDescriptionGenerator (all 8 group-derivation sites) and Step 3 stats
• depends on: the leader convention enforced by createGroupFromSelected/applyAutoGrouping in this subsystem

[seeded: feature-atlas 2026-07-19]',
         false,
         33000,
         now()
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'done'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Group] Step 3 group resolution library (grouping.ts)'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'done', t.rank, now()
from new_card nc
cross join (values
  ('filterStep3Visible', 'Only categorized items and true multi-image groups pass; uncategorized singles stay in Step 2', 1000.0),
  ('buildGroupArray', 'Groups-first ordering with stable first-index tiebreaker; stale foreign group refs degrade to singletons', 2000.0),
  ('Self-healing', 'Tolerant rule heals historical fresh-UUID batches without regrouping (fixed the 42-image/11-group per-image-nav bug)', 3000.0)
) as t(title, notes, rank);

-- 34. [Group] Clear originals cache (pre-crop storage reclamation)
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Group] Clear originals cache (pre-crop storage reclamation)',
         'Toolbar action that permanently deletes the preserved pre-crop original files (and their product_images rows) from Storage for cropped items — reclaims space at the cost of losing revert ability. Confirm dialog, selected/all scopes, cleans up originalStoragePath/originalUrl.

Subsystem: Step 2 — Grouping, categorization, presets application
Atlas status at seed: done

Wiring:
• depends on: storageSafety guard + Supabase Storage remove
• complements: crop revert-to-original (storage-management counterpart)

[seeded: feature-atlas 2026-07-19]',
         false,
         34000,
         now()
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'done'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Group] Clear originals cache (pre-crop storage reclamation)'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'done', t.rank, now()
from new_card nc
cross join (values
  ('clearOriginalsCache(selected|all)', 'Two scopes with a confirm dialog', 1000.0),
  ('State cleanup', 'Drops originalStoragePath/originalUrl so future revert is disabled', 2000.0)
) as t(title, notes, rank);

-- 35. [Group] Step 2 inline help + shortcut cheatsheet
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Group] Step 2 inline help + shortcut cheatsheet',
         'Two help surfaces in Step 2: an i info toggle beside the heading expanding a how-to-use panel (showStep2Info), and a persistent keyboard-shortcut cheatsheet block in the grouper sidebar (hidden on mobile).

Subsystem: Step 2 — Grouping, categorization, presets application
Atlas status at seed: done

Wiring:
• complements: Step 2 keyboard shortcuts (documents the bindings)
• triggered by: i button next to the Step 2 heading

[seeded: feature-atlas 2026-07-19]',
         false,
         35000,
         now()
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'done'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Group] Step 2 inline help + shortcut cheatsheet'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'done', t.rank, now()
from new_card nc
cross join (values
  ('How-to-use panel', 'showStep2Info toggle in App.tsx', 1000.0),
  ('Shortcuts block', 'Static binding reference in the sidebar', 2000.0)
) as t(title, notes, rank);

-- 36. [Describe] Voice recording & live transcription
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Describe] Voice recording & live transcription',
         'Continuous Web Speech API recording in Step 3 that appends corrected speech to the group''s voiceDescription with live interim display.

Subsystem: Step 3 — Voice, fields, description generation, crop tool
Atlas status at seed: done

Wiring:
• writes group-wide voiceDescription into workflowStore processedItems (shared source of truth with App.tsx)
• triggered edits fire onProcessed → App.tsx autoSaveWorkflow (workflow_state blob, Step 4 subsystem)
• feeds: voice command engine, field extractor, description/title/tag generation
• depends on: lib/grouping.ts buildGroupArray for current-group resolution

[seeded: feature-atlas 2026-07-19]',
         true,
         36000,
         now()
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'done'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Describe] Voice recording & live transcription'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'done', t.rank, now()
from new_card nc
cross join (values
  ('Continuous recognition with auto-restart', 'recognition.continuous=true; onend auto-restarts after 300ms while isRecordingRef is set (browser timeout recovery)', 1000.0),
  ('STT misrecognition fixer', 'fixTranscript rewrites ''with 18''→''width 18'', waste→waist, in seam→inseam, ''30 and a half''→30.5, strips ''inches'' after numbers', 2000.0),
  ('Interim transcript + active-column highlight', 'Interim text previews in the active VoiceCommandTable cell; keyword detection switches the highlighted column in real time', 3000.0),
  ('Transcript formatting', 'formatVoiceTranscript puts each ''trigger value period'' command on its own line and renders ''period'' as ''.''', 4000.0),
  ('Start/Stop guards', 'isTransitioning + 1000ms transition lockout + rapid-click debounce prevent double start/stop; Chrome/Edge-only warning when unsupported', 5000.0),
  ('Enter-key toggle', 'Enter toggles recording when no input/lightbox/crop modal has focus', 6000.0),
  ('Stop-recording auto pipeline', '150ms after stop: extractFieldsFromVoice runs (voice always wins), fields patch the group, then handleRegenerateAll fires', 7000.0)
) as t(title, notes, rank);

-- 37. [Describe] Voice command engine ("field value period")
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Describe] Voice command engine ("field value period")',
         'Parses spoken ''field name → value → period'' commands from live speech chunks into ~35 structured fields including measurements.

Subsystem: Step 3 — Voice, fields, description generation, crop tool
Atlas status at seed: done

Wiring:
• consumes: VoiceCommandTable''s VOICE_KEYWORD_TO_FIELD map
• writes via applyTableFieldRef → handleTableFieldChange (group patch + transcript line patch + debounced DB save)
• complemented by: extractFieldsFromVoice on stop-recording and Regenerate (re-parse of the full transcript)

[seeded: feature-atlas 2026-07-19]',
         true,
         37000,
         now()
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'done'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Describe] Voice command engine ("field value period")'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'done', t.rank, now()
from new_card nc
cross join (values
  ('VOICE_KEYWORD_TO_FIELD map', 'Exported keyword→fieldKey map (title, brand, size, color/colour, secondary/accent color, condition, price, era, style, gender, material/fabric, tags, flaws, care, description/note, 11 measurements)', 1000.0),
  ('Multi-command chunk splitting', 'One speech chunk is split on ''period'' boundaries; each segment can yield multiple keyword→value writes (''width 18 length 28 period'')', 2000.0),
  ('Description swallow mode', 'While dictating ''description …'', narration words that double as keywords (sleeve, style, length) are NOT commands until the closing ''period''; interim highlighting cannot switch away', 3000.0),
  ('Trailing-keyword carry-over', 'Text after the last ''period'' that starts with a keyword arms the next field (pendingFieldValueRef) across chunk boundaries', 4000.0),
  ('Spoken-word price parsing', '''forty five'' / ''one hundred'' → 45 / 100 via word-to-number accumulator in handleTableFieldChange', 5000.0)
) as t(title, notes, rank);

-- 38. [Describe] Voice field extractor (extractFieldsFromVoice)
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Describe] Voice field extractor (extractFieldsFromVoice)',
         'Pure-JS two-pass parser in textAIService that turns a full transcript into structured fields — explicit commands first, then fuzzy natural-speech fallbacks.

Subsystem: Step 3 — Voice, fields, description generation, crop tool
Atlas status at seed: done

Wiring:
• called by: generateProductDescription (which merges extracted-over-context so voice always wins)
• depends on: colorDatabase COLOR_WORDS_LIST for color scanning
• extracted fields consumed by: PDG stop-recording patch, Regenerate All field back-fill
• characterization-tested in src/lib/textAIService.test.ts

[seeded: feature-atlas 2026-07-19]',
         true,
         38000,
         now()
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'done'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Describe] Voice field extractor (extractFieldsFromVoice)'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'done', t.rank, now()
from new_card nc
cross join (values
  ('Pass 1 explicit commands', '''field value period'' regexes with FIELD_BOUNDARY_RE cross-field contamination guard and no-period fast-speech fallbacks per field', 1000.0),
  ('Description scrub', '''description … period'' captures everything to ''period'' (skips the boundary guard) and scrubs its span so narration words can''t leak into other fields — locked by tests', 2000.0),
  ('Pass 2 fuzzy fallbacks', 'Size (multi-word spoken forms), brand (~400-entry KNOWN_BRANDS list longest-first, guarded to real transcripts), color (COLOR_WORDS_LIST), material, condition, era, gender, price, and 8 measurement patterns', 3000.0),
  ('Normalizers', 'normalizeCondition (NWT/Like New/Excellent/Good/Fair), normalizeEra (Y2K/90s…), normalizeGender, stripColorModifiers (''Faded Out White''→''White''), primaryMaterial (''50% Cotton…''→''Cotton''), toTitleCase strips ''period''', 4000.0),
  ('chest/p2p → width routing', 'chest, pit-to-pit, and p2p all write the width measurement', 5000.0)
) as t(title, notes, rank);

-- 39. [Describe] Voice command table UI
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Describe] Voice command table UI',
         'Grid of keyword-labelled editable cells (title/description full-width + Core Info / Style & Details / upper & lower Measurements rows) that doubles as the voice-command reference.

Subsystem: Step 3 — Voice, fields, description generation, crop tool
Atlas status at seed: done

Wiring:
• rendered by: ProductDescriptionGenerator
• exports VOICE_KEYWORD_TO_FIELD consumed by the live voice engine
• cell edits feed: patchVoiceLine transcript sync + debounced product-table save

[seeded: feature-atlas 2026-07-19]',
         true,
         39000,
         now()
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'done'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Describe] Voice command table UI'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'done', t.rank, now()
from new_card nc
cross join (values
  ('Active-column listening state', 'Currently-dictated field shows a listening dot and interim value preview; filled cells styled distinctly', 1000.0),
  ('Inline cell editing', 'Every cell is an input routing through onChange → handleTableFieldChange (same path as voice)', 2000.0),
  ('Listening status bar', 'Shows which field is armed or prompts ''say a field name'' while recording', 3000.0),
  ('Table/Text mode toggle', 'voiceMode switches between the grid and a raw textarea with a voice-commands cheat-sheet; textarea onChange re-parses ''field value period'' + no-period measurement commands into fields', 4000.0)
) as t(title, notes, rank);

-- 40. [Describe] Field-edit pipeline with transcript sync (handleTableFieldChange + patchVoiceLine)
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Describe] Field-edit pipeline with transcript sync (handleTableFieldChange + patchVoiceLine)',
         'Single write path for table/chip/voice field edits: targeted group-wide patch, surgical ''label value period'' transcript line update, and an 800ms direct DB save.

Subsystem: Step 3 — Voice, fields, description generation, crop tool
Atlas status at seed: done

Wiring:
• consumed by: VoiceCommandTable cells, voice engine (applyTableFieldRef), descriptor chips
• feeds: productService.syncGroupFieldsToDatabase (products table)
• store writes trigger onProcessed → App auto-save (workflow_state)

[seeded: feature-atlas 2026-07-19]',
         true,
         40000,
         now()
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'done'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Describe] Field-edit pipeline with transcript sync (handleTableFieldChange + patchVoiceLine)'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'done', t.rank, now()
from new_card nc
cross join (values
  ('Group-targeted patches', 'Edits map over the FULL store list but only touch current-group ids (never wipes uncategorized singles — dbd5d43 bug class)', 1000.0),
  ('patchVoiceLine', 'Updates/appends/removes only the edited field''s transcript line, preserving freeform narration (replaced the old whole-transcript rebuild that deleted narration)', 2000.0),
  ('meas_/price/tags routing', 'meas_* keys write into measurements object; price accepts numeric or spoken words; tags split on commas', 3000.0),
  ('debouncedDirectSave', '800ms debounce → syncGroupFieldsToDatabase(group, batchId) — the most direct per-edit products-table save', 4000.0)
) as t(title, notes, rank);

-- 41. [Describe] Quick descriptor keyword chips
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Describe] Quick descriptor keyword chips',
         'Tap-to-toggle resale keywords (faded, y2k, single stitch…) that insert/remove terms from customDescription, with founder-curated defs and brand-driven suggestions.

Subsystem: Step 3 — Voice, fields, description generation, crop tool
Atlas status at seed: done

Wiring:
• depends on: vocab_tables.sql migration (descriptor_chips + brand_keywords, founder-edited via VocabDashboard in the admin subsystem)
• falls back to: builtinBrandVocab lazy chunk when no edited brand row exists
• customDescription feeds: description keyword titles, description-sourced tags, prose paragraph facts

[seeded: feature-atlas 2026-07-19]',
         true,
         41000,
         now()
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'done'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Describe] Quick descriptor keyword chips'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'done', t.rank, now()
from new_card nc
cross join (values
  ('DB-driven chip definitions', 'fetchActiveChips loads descriptor_chips (label vs output_text); hardcoded DESCRIPTOR_KEYWORDS 31-item list is the pre-migration fallback', 1000.0),
  ('Brand-suggested ordering', 'getBrandTerms(brand) (session-cached per brand) floats related chips to the front with amber ''suggested for {brand}'' treatment; matching via termMatchesChip/wordsRelated (loose ≥4-char prefix)', 2000.0),
  ('Word-association graph', 'getAllBrandKeywordEntries (session cache): keywords already used in the description pull in related brands'' other keywords as up-to-12 extra ''brand-only'' chips', 3000.0),
  ('Toggle via normal edit path', 'toggleDescriptorKeyword routes through handleTableFieldChange(''customDescription'') so chips get group update + transcript patch + auto-save for free', 4000.0)
) as t(title, notes, rank);

-- 42. [Describe] Rule-based description generation
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Describe] Rule-based description generation',
         'generateProductDescription merges voice-extracted fields over form values and assembles the full Shopify listing text from a deterministic template (no external AI on this path).

Subsystem: Step 3 — Voice, fields, description generation, crop tool
Atlas status at seed: done

Wiring:
• called by: PDG Regenerate All and stop-recording auto pipeline
• settings from: organizations.description_settings via App → descriptionSettings prop (edited in OrgPanel, admin subsystem)
• suggestedTags consumed by: CSV export (Step 4 subsystem)
• smartSeoTruncate also imported by GoogleSheetExporter for CSV SEO Description

[seeded: feature-atlas 2026-07-19]',
         true,
         42000,
         now()
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'done'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Describe] Rule-based description generation'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'done', t.rank, now()
from new_card nc
cross join (values
  ('Voice-wins merge', 'extractFieldsFromVoice output overrides passed-in context per field; result returned with extractedFields for UI back-fill', 1000.0),
  ('Description skeleton', 'Title opener → selling paragraph (prose or customDescription) → ✠ SIZE/measurement lines → Material composition → washing line → Condition → closing line → #hashtags → disclaimers', 2000.0),
  ('Per-workspace format resolution', 'resolveDescriptionSettings merges org partial over DEFAULT_DESCRIPTION_SETTINGS; defaults are byte-identical to legacy output (golden test)', 3000.0),
  ('Full material composition line', 'Re-reads the raw ''material … period'' span from the transcript so ''50% Cotton 25% Nylon'' shows in full while the field keeps only the primary material', 4000.0),
  ('smartSeoTruncate', 'Sentence/word-boundary-aware ~320-char truncation used for auto seoDescription', 5000.0)
) as t(title, notes, rank);

-- 43. [Describe] Title engine
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Describe] Title engine',
         'generateTitleFromFields builds a ≤60-char SEO title from fields with category-specific formulas, then fitTo60 swap-optimizes length via synonym groups.

Subsystem: Step 3 — Voice, fields, description generation, crop tool
Atlas status at seed: done

Wiring:
• output becomes item.seoTitle on Regenerate (always overwrites AI titles; typed titles win via input field)
• TYPE token fed by preset productType / ''type X period'' voice command
• consumed by: CSV export buildCleanTitle and title dedup (Step 4)
• locked by textAIService.test.ts incl. golden snapshot with mocked Math.random

[seeded: feature-atlas 2026-07-19]',
         true,
         43000,
         now()
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'done'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Describe] Title engine'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'done', t.rank, now()
from new_card nc
cross join (values
  ('Category formula sets', 'Tees/shirts/sweatshirts/hoodies/jackets/pants/jeans/shorts/jerseys/hats/accessories/skirts/dresses/bodysuits/tops + generic fallback, each with 6 randomized variations and womens/youth item words', 1000.0),
  ('Constant ''Vintage Y2K'' ERA prefix + DECADE derivation', 'era field maps to 90s/80s/70s/60s; Y2K/2000s omitted as redundant', 2000.0),
  ('Description-keyword title path', 'When customDescription exists: ''{SIZE} - Vintage Y2K {BRAND} {TYPE} {desc keywords}'' with stop-word filter, brand stripped first, 60-char word-boundary cap', 3000.0),
  ('fitTo60 synonym optimizer', 'TITLE_SYNONYMS (style/material/color/era groups) + at most ONE matched ITEM_TYPE_SYNONYM_GROUP; per-group swap lock prevents compounding; near-best candidates randomized for variety; size groups deliberately removed', 4000.0),
  ('Proper-noun protection', 'BRAND/SUBJECT swapped to placeholders before dedupeTitle/fitTo60 so ''American Vintage'' survives dedup against the ERA prefix', 5000.0),
  ('Hat OSFA / accessory no-size rules', 'Hats show OSFA unless numeric size; bags/accessories drop the size prefix', 6000.0)
) as t(title, notes, rank);

-- 44. [Describe] Tag engine
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Describe] Tag engine',
         'generateTagsFromFields builds ≤8 Shopify tags from voice hashtags > explicit tags > preset tags + brand terms + field values, always computed regardless of the hashtag display setting.

Subsystem: Step 3 — Voice, fields, description generation, crop tool
Atlas status at seed: done

Wiring:
• feeds: description #hashtags (gated by includeHashtags setting) and item.tags
• item.tags consumed by: CSV export Tags column (Step 4)
• depends on: vocabService.getBrandTerms + category preset default_tags

[seeded: feature-atlas 2026-07-19]',
         true,
         44000,
         now()
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'done'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Describe] Tag engine'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'done', t.rank, now()
from new_card nc
cross join (values
  ('deriveSpecificTagsFromTitle', '~100 regex rules turn title/voice text into precise item tags (beanie not hats, cargo shorts → cargo+shorts) across headwear/bags/tops/outerwear/bottoms/footwear/accessories', 1000.0),
  ('Source priority', '#hashtags in voice → ''tags … period'' command → preset default_tags + brandTerms + era/brand/color/style fields', 2000.0),
  ('brandTerms merge', 'Founder-curated brand_keywords merged on every path like preset tags (locked by test)', 3000.0),
  ('pullTagsFromDescription', 'AESTHETIC_WORDS scan (y2k, skate, bootleg…) tops up when under 4 tags; ''vintage''/''retro'' deliberately excluded', 4000.0)
) as t(title, notes, rank);

-- 45. [Describe] Size normalization (normalizeSizeValue)
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Describe] Size normalization (normalizeSizeValue)',
         'Canonicalizes any spoken/typed size to letter symbols (XS–5XL, OSFA) with an optional preserved ''(fits like …)'' note.

Subsystem: Step 3 — Voice, fields, description generation, crop tool
Atlas status at seed: done

Wiring:
• used by: voice extractor, title engine (letter-only rule), description SIZE line, size form field
• CSV exporter strips the note via baseSize() (Step 4)
• locked by textAIService.test.ts

[seeded: feature-atlas 2026-07-19]',
         false,
         45000,
         now()
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'done'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Describe] Size normalization (normalizeSizeValue)'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'done', t.rank, now()
from new_card nc
cross join (values
  ('Multi-word spoken forms', '''double extra large''→XXL, ''triple extra large''→XXXL, one size fits all/most→OSFA, numeric 32/32x30/10.5 passthrough', 1000.0),
  ('fits-like note', 'keepFitsLike opt keeps ''L (fits like M)'' in the description SIZE line and size form field only; titles/CSV get the clean base size', 2000.0),
  ('Form onBlur normalization', 'Size input in ComprehensiveProductForm normalizes on blur with keepFitsLike:true', 3000.0)
) as t(title, notes, rank);

-- 46. [Describe] Model-written selling paragraph (prose)
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Describe] Model-written selling paragraph (prose)',
         'Opt-in per workspace: a Cloudflare Workers AI Llama model writes only the short selling paragraph while the rule engine keeps the skeleton; invalid output silently falls back.

Subsystem: Step 3 — Voice, fields, description generation, crop tool
Atlas status at seed: done

Wiring:
• triggered by: Regenerate All in PDG
• configured in: OrgPanel Settings (admin subsystem) via description_settings JSONB
• fallback path: createFallbackDescription renders customDescription instead
• tested in proseService.test.ts

[seeded: feature-atlas 2026-07-19]',
         true,
         46000,
         now()
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'done'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Describe] Model-written selling paragraph (prose)'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'done', t.rank, now()
from new_card nc
cross join (values
  ('generate-prose Edge Function', '@cf/meta/llama-3.1-8b-instruct via CF_ACCOUNT_ID/CF_API_TOKEN secrets; verify_jwt ON; 503 without secrets; 20s abort; hard-rule system prompt (facts only, 40–80 words, no invented numbers, never says ''AI'')', 1000.0),
  ('Client validation gates', 'validateProse: 15–120 words, PROSE_BANNED_PHRASES (marketing slop + AI tells), no #/@/links, numbers guard (every digit sequence must appear in provided facts) — any failure → null', 2000.0),
  ('Opt-in flags', 'proseEnabled (default false) + proseStyle voice notes live in description_settings; PDG requests prose in parallel with getBrandTerms only when enabled', 3000.0),
  ('Render placement', 'ProductContext.proseParagraph replaces the raw customDescription note in PART 1b; keywords still feed titles/tags; absent = byte-identical output', 4000.0)
) as t(title, notes, rank);

-- 47. [Describe] Per-workspace description format settings
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Describe] Per-workspace description format settings',
         'DescriptionSettings (measurementPrefix, washingLine, closingLine, includeHashtags, disclaimerLines, vendorName, proseEnabled, proseStyle) stored in organizations.description_settings JSONB with byte-identical defaults.

Subsystem: Step 3 — Voice, fields, description generation, crop tool
Atlas status at seed: done

Wiring:
• edited in: OrgPanel ''Listing description format'' section (admin subsystem)
• App fetches on org resolve and passes to PDG via descriptionSettings prop
• vendorName consumed by: CSV export Vendor column (Step 4)
• gates: prose feature and hashtag rendering

[seeded: feature-atlas 2026-07-19]',
         false,
         47000,
         now()
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'done'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Describe] Per-workspace description format settings'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'done', t.rank, now()
from new_card nc
cross join (values
  ('Fail-soft fetch/save', 'getOrgDescriptionSettings returns defaults on missing column/migration; save reports permission and 42703 migration-not-run errors', 1000.0),
  ('resolveDescriptionSettings', 'Partial-over-defaults merge tolerating old/missing keys', 2000.0)
) as t(title, notes, rank);

-- 48. [Describe] Regenerate All pipeline
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Describe] Regenerate All pipeline',
         'Single action (button + auto after stop-recording) that re-applies the resolved preset, fetches brand terms + optional prose, regenerates description/title/tags, back-fills extracted fields, and flushes to DB.

Subsystem: Step 3 — Voice, fields, description generation, crop tool
Atlas status at seed: done

Wiring:
• depends on: applyPresetToGroup lib, textAIService, vocabService, proseService
• writes: products table via productService.syncGroupFieldsToDatabase
• triggered by: Regenerate button and handleStopRecording

[seeded: feature-atlas 2026-07-19]',
         true,
         48000,
         now()
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'done'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Describe] Regenerate All pipeline'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'done', t.rank, now()
from new_card nc
cross join (values
  ('Manual-edit guard', 'descriptionEdited flag (set by editing the generated textarea) triggers a confirm before overwrite; cleared after regeneration', 1000.0),
  ('Step 0 fresh preset re-apply', 'getCategoryPresets fresh from DB; priority selectedPresetId → productType lookup → category default; applyPresetDirectly result flushed into state', 2000.0),
  ('Parallel enrichment', 'Promise.all(getBrandTerms, requestProse-if-enabled) before the generation call', 3000.0),
  ('Field back-fill + title overwrite', 'Extracted fields patch the group; suggestedTitle always overwrites seoTitle; seoDescription auto-filled via smartSeoTruncate when empty', 4000.0),
  ('Immediate DB flush', 'syncGroupFieldsToDatabase fired right after state update so refresh never loses the generated description', 5000.0)
) as t(title, notes, rank);

-- 49. [Describe] Per-group preset system (Step 3)
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Describe] Per-group preset system (Step 3)',
         'Category presets auto-apply per group with layered override guards, survive reload via appliedPresetId/productType DB columns, and can be manually overridden (single or bulk) from a searchable combobox.

Subsystem: Step 3 — Voice, fields, description generation, crop tool
Atlas status at seed: done

Wiring:
• depends on: category_presets table (CRUD in CategoryPresetsManager, Step 2 subsystem)
• preset productType feeds: title/tag category and CSV taxonomy resolution
• persisted via: products.applied_preset_id + product_type columns (hydrated on batch open)
• priority hierarchy locked by applyPresetToGroup tests

[seeded: feature-atlas 2026-07-19]',
         true,
         49000,
         now()
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'done'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Describe] Per-group preset system (Step 3)'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'done', t.rank, now()
from new_card nc
cross join (values
  ('Initial batch apply', 'applyPresetsToAllGroups applies category defaults to every unpresetted group on preset load, merging patches functionally so DB-hydrated values (title/voice/brand/price…) are never clobbered', 1000.0),
  ('Per-group auto-apply with guards', 'Skips when _presetData matches category, in-memory selectedPresetId matches, productType encodes a DB-persisted override, appliedPresetId resolves, or legacy preset fields exist', 2000.0),
  ('Nav-effect preset restore', 'On group change resolves selectedPresetId/label from _presetData → appliedPresetId → productType lookup', 3000.0),
  ('Searchable override combobox', 'Filterable dropdown of active presets; selection calls applyPresetDirectly with force=true (preset-owned fields reset, voice/manual fields kept)', 4000.0),
  ('Bulk multi-group apply', 'Per-group Select checkbox builds selectedGroupIds; override applies to all selected groups then clears the selection', 5000.0),
  ('Applied-preset indicator', 'Green box shows active preset name/description; form shows ''← Preset'' badges on preset-sourced fields', 6000.0)
) as t(title, notes, rank);

-- 50. [Describe] Comprehensive product form
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Describe] Comprehensive product form',
         '~40-field editable form (Pricing, Core Details, Measurements, Inventory & Shipping, Status & SEO) whose every edit propagates to the whole product group.

Subsystem: Step 3 — Voice, fields, description generation, crop tool
Atlas status at seed: done

Wiring:
• rendered by: PDG Product Info section with the store list + setter
• edits trigger: 500ms debounced products-table save + App workflow_state auto-save
• field values consumed by: CSV export columns (Step 4)

[seeded: feature-atlas 2026-07-19]',
         true,
         50000,
         now()
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'done'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Describe] Comprehensive product form'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'done', t.rank, now()
from new_card nc
cross join (values
  ('updateGroupField', 'Single/nested (measurements.x) path writes applied to every item in the current group via setProcessedItems', 1000.0),
  ('Empty-field highlighting', 'req() adds field-required-empty class to any empty tracked field', 2000.0),
  ('Preset badges', '''← Preset'' badge on fields sourced from the applied preset (_presetData present + value set)', 3000.0),
  ('Measurement-template ''needed'' badges', 'Preset measurement_template flags empty-but-expected measurements with an amber badge — nothing hidden', 4000.0),
  ('Size normalize on blur', 'normalizeSizeValue(keepFitsLike) tidies typed sizes', 5000.0)
) as t(title, notes, rank);

-- 51. [Describe] Group navigation & Step-3 visibility
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Describe] Group navigation & Step-3 visibility',
         'Per-listing (product group) navigation with Prev/Next, a jump slider, Finish→CSV, and a top-of-column Download CSV button; group list built by the tolerant grouping lib.

Subsystem: Step 3 — Voice, fields, description generation, crop tool
Atlas status at seed: done

Wiring:
• batch switches remount PDG via key={currentBatchId} in App.tsx (resets to group 0)
• consumes: workflowStore processedItems (Stage 2b single source of truth)
• onDownloadCSV wired to: GoogleSheetExporter (Step 4)

[seeded: feature-atlas 2026-07-19]',
         true,
         51000,
         now()
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'done'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Describe] Group navigation & Step-3 visibility'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'done', t.rank, now()
from new_card nc
cross join (values
  ('buildGroupArray integration', 'Applies the Step-3 visibility filter (categorized items + true multi-image groups) and tolerant group-id resolution (leader id OR ≥2 shared) — the fix for per-image Next/Prev', 1000.0),
  ('Background save on navigation', 'Prev/Next/slider call handleSave (syncGroupFieldsToDatabase) when hasUnsavedChanges, without blocking', 2000.0),
  ('Finish → export', 'handleFinish fires onProcessed(full list) then onDownloadCSV (GoogleSheetExporter ref)', 3000.0),
  ('Index clamp', 'Effect keeps currentGroupIndex in range when the group list shrinks (items deleted in Step 2)', 4000.0),
  ('Empty-state guard', 'No categorized items → ''⚠️ go back to Step 2'' message instead of the 7997a6a crash', 5000.0)
) as t(title, notes, rank);

-- 52. [Describe] Debounced auto-save & unload persistence
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Describe] Debounced auto-save & unload persistence',
         'Multi-layer persistence: 500ms debounce on any processedItems change, 800ms direct save on explicit edits, immediate flush after Regenerate, and beforeunload+pagehide flush.

Subsystem: Step 3 — Voice, fields, description generation, crop tool
Atlas status at seed: done

Wiring:
• writes: products table (syncGroupFieldsToDatabase) and workflow_state (via App)
• note: heavy unconditional console.log instrumentation remains in these paths (Known Bugs #15 cleanup candidate)

[seeded: feature-atlas 2026-07-19]',
         false,
         52000,
         now()
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'done'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Describe] Debounced auto-save & unload persistence'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'done', t.rank, now()
from new_card nc
cross join (values
  ('500ms debounce effect', 'Any processedItems mutation schedules syncGroupFieldsToDatabase for the current group', 1000.0),
  ('beforeunload + pagehide flush', 'Both listeners fire the pending save so back-button/bfcache navigation never loses edits', 2000.0),
  ('onProcessed trigger', 'processedItems effect calls onProcessed → App autoSaveWorkflow (2s debounce, workflow_state blob) — PDG''s callback is purely an auto-save trigger post-Stage-2b', 3000.0)
) as t(title, notes, rank);

-- 53. [Describe] Duplicate title warning
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Describe] Duplicate title warning',
         '800ms-debounced cross-batch Supabase ilike query on products.seo_title flags a red warning when the current title already exists elsewhere.

Subsystem: Step 3 — Voice, fields, description generation, crop tool
Atlas status at seed: done

Wiring:
• complements: CSV export''s three-source title/handle dedup incl. shopify-titles Edge Function (Step 4)
• depends on: shared-workspace products SELECT RLS

[seeded: feature-atlas 2026-07-19]',
         false,
         53000,
         now()
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'done'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Describe] Duplicate title warning'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'done', t.rank, now()
from new_card nc
cross join (values
  ('Self-exclusion', 'Query excludes the current item''s own id; limit(1) existence check', 1000.0),
  ('Title input UX', '60-char color-coded counter, live placeholder preview built from current fields, typed titles never overwritten by Regenerate', 2000.0)
) as t(title, notes, rank);

-- 54. [Describe] Lightbox with rotate
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Describe] Lightbox with rotate',
         'Double-click any preview/thumbnail opens a full-screen lightbox with arrow navigation through the group, rotate L/R, and entry to the crop tool.

Subsystem: Step 3 — Voice, fields, description generation, crop tool
Atlas status at seed: done

Wiring:
• imageRotation consumed by: createTransformedFile bake and Step 2 card previews
• crop button opens the crop tool with a default 90% rect

[seeded: feature-atlas 2026-07-19]',
         false,
         54000,
         now()
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'done'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Describe] Lightbox with rotate'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'done', t.rank, now()
from new_card nc
cross join (values
  ('Pool navigation', 'lightboxPool of group item ids; on-screen ‹ › buttons + ArrowLeft/Right keys + wrap-around counter', 1000.0),
  ('Rotate L/R', '±90° imageRotation stored on the item, previewed via CSS transform everywhere; baked only when a crop is applied', 2000.0),
  ('Escape close ordering', 'Escape closes crop first, then lightbox', 3000.0)
) as t(title, notes, rank);

-- 55. [Describe] Crop tool (full-screen)
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Describe] Crop tool (full-screen)',
         'Pointer-driven crop editor inside the lightbox: draw/move/resize with 8 handles, aspect presets, rule-of-thirds grid, then bakes rotation+crop to a new JPEG uploaded over the same storage path.

Subsystem: Step 3 — Voice, fields, description generation, crop tool
Atlas status at seed: done

Wiring:
• depends on: imageTransforms session cache + productService upload helpers (Supabase Storage)
• same-storagePath overwrite keeps DB rows and workflow_state untouched
• crop upload progress banner exists in App-side flow (47593d9)

[seeded: feature-atlas 2026-07-19]',
         true,
         55000,
         now()
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'done'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Describe] Crop tool (full-screen)'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'done', t.rank, now()
from new_card nc
cross join (values
  ('Percent-based crop coords', 'tempCrop {x,y,w,h} percentages relative to the visually-rotated image; overlay masks/handles positioned in real px from measured image bounds (double-rAF post-paint)', 1000.0),
  ('Aspect presets', 'FREE / 1:1 / 9:16 / 16:9 / 4:5 / 3:2 pills with aspect-locked draw and resize', 2000.0),
  ('applyAndPersistTransform', 'createTransformedFile (canvas rotate-then-crop, JPEG 0.92) → uploadFileToPath overwriting the same storagePath (fallback: new path + delete old) → item resets rotation/crop and updates preview URL', 3000.0),
  ('Copy Crop', 'Copies the crop rect to copiedCrop clipboard for cross-item paste', 4000.0)
) as t(title, notes, rank);

-- 56. [Describe] Bulk crop paste (format painter for crops)
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Describe] Bulk crop paste (format painter for crops)',
         'Pastes the copied crop rect to every item across selected groups (or ALL groups), with instant CSS clip-path preview then batched background bake+re-upload.

Subsystem: Step 3 — Voice, fields, description generation, crop tool
Atlas status at seed: done

Wiring:
• depends on: crop tool''s copiedCrop + applyAndPersistTransform
• re-uses the group Select checkboxes shared with bulk preset apply
• uploads hit Supabase Storage (Step 1 subsystem infrastructure)

[seeded: feature-atlas 2026-07-19]',
         false,
         56000,
         now()
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'done'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Describe] Bulk crop paste (format painter for crops)'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'done', t.rank, now()
from new_card nc
cross join (values
  ('Scope control', 'selectedGroupIds limits the paste; empty selection = all groups; button label shows (N)/(All)', 1000.0),
  ('Instant visual, deferred bake', 'crop set on all targets first (thumbnails clip immediately) while uploads run 4-concurrent with 150ms breathing room and a done/total progress readout', 2000.0),
  ('Session image cache', 'imageTransforms'' unbounded tab-lifetime HTMLImageElement cache + retry-with-cache-bust loader means hundreds of pastes never re-fetch from CDN', 3000.0)
) as t(title, notes, rank);

-- 57. [Describe] Magnifier lens
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Describe] Magnifier lens',
         'Cursor-following circular zoom lens over the main preview and group thumbnails, with persisted size/zoom/on-off settings.

Subsystem: Step 3 — Voice, fields, description generation, crop tool
Atlas status at seed: done

Wiring:
• reads the same preview/imageUrls sources as the lightbox
• standalone — no cross-subsystem dependencies

[seeded: feature-atlas 2026-07-19]',
         false,
         57000,
         now()
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'done'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Describe] Magnifier lens'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'done', t.rank, now()
from new_card nc
cross join (values
  ('CSS background zoom', 'Lens is a fixed-position div using backgroundImage/position/size (zoom×100%) at cursor+20px', 1000.0),
  ('Persisted settings', 'size 160–700px, zoom 2–10×, enabled toggle saved to localStorage key sortbot_magnifier_settings', 2000.0)
) as t(title, notes, rank);

-- 58. [Describe] Field format painter & clear actions
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Describe] Field format painter & clear actions',
         'Copy Fields/Paste Fields transfers all structured fields between groups; Clear buttons wipe transcript, all voice fields, or the generated description.

Subsystem: Step 3 — Voice, fields, description generation, crop tool
Atlas status at seed: done

Wiring:
• all writes go through setProcessedItems → auto-save chain
• Clear Fields removal of a field also drops its transcript line on next patch (patchVoiceLine empty-value path)

[seeded: feature-atlas 2026-07-19]',
         false,
         58000,
         now()
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'done'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Describe] Field format painter & clear actions'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'done', t.rank, now()
from new_card nc
cross join (values
  ('Copy/Paste Fields', 'copiedFields snapshot (brand→measurements+tags) pasted onto every item in the target group', 1000.0),
  ('Clear transcript / Clear Fields / Clear description', 'Clear Fields resets ~15 fields group-wide; description clear also resets seoDescription and descriptionEdited', 2000.0)
) as t(title, notes, rank);

-- 59. [Export] Save Batch to Database (Step 4)
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Export] Save Batch to Database (Step 4)',
         'Persists every product group in the session to the products + product_images tables via upsert, then prunes stale rows and refreshes the Library.

Subsystem: Step 4 — Save batch + Shopify CSV export
Atlas status at seed: done

Wiring:
• triggered by: Step 4 ''Save Batch to Database'' button in App.tsx
• consumes: processedItems from workflowStore (Step 3 output, full list)
• depends on: Supabase Storage upload helpers (uploadImageToStorage/uploadFileToPath) and Step 3 crop tool transforms (imageTransforms.createTransformedFile)
• depends on: imageRowSync stage4 feature-detect (migration-gated columns)
• feeds: Library (libraryRefreshTrigger increment → loadAll refetch)
• feeds: CSV export dedup Source 1 (the products.seo_title rows it writes are the ''existing titles'' for future exports)
• shares write path with: registerItemsInDB / handleImagesUploaded via buildProductImageRow conventions (imageRowSync)

[seeded: feature-atlas 2026-07-19]',
         true,
         59000,
         now()
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'done'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Export] Save Batch to Database (Step 4)'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'done', t.rank, now()
from new_card nc
cross join (values
  ('handleSaveBatch orchestration', 'Step 4 button → saveBatchToDatabase(processedItems, user.id, currentBatchId); shows saving state, success/error message, and auto-clears all four item arrays 3s after success.', 1000.0),
  ('Group-by-productGroup save', 'saveBatchToDatabase buckets items by productGroup (leader convention tolerated) and saves one products row per group, group[0] as the field source.', 2000.0),
  ('Idempotent product upsert', 'saveProductToDatabase upserts ~50 columns on id (onConflict: ''id'') so repeated Save Batch clicks update rather than duplicate; also slugifies seoTitle into url_handle.', 3000.0),
  ('Transformed-image re-upload', 'Items with imageRotation/crop get a canvas re-encoded file (createTransformedFile) uploaded to Storage before the image row is written; otherwise reuses existing storagePath or uploads the raw File.', 4000.0),
  ('Image row upsert', 'product_images upserted on (product_id, image_url) with position, alt_text (''Title - Image N''), and transforms JSON (buildTransforms).', 5000.0),
  ('Stage 4 dual-write gating', 'stage4ColumnsAvailable() cached probe gates writes of products.description_edited and product_images.captured_at/original_storage_path until the stage4_slim_fields.sql migration runs.', 6000.0),
  ('Stale product pruning', 'pruneStaleProducts fetches all products.id for the batch, diffs against kept item ids, and deletes orphans in chunks of 100 (avoids PostgREST URL-length 400s).', 7000.0),
  ('Library refresh', 'setLibraryRefreshTrigger(+1) after a successful save so the Library modal re-fetches.', 8000.0)
) as t(title, notes, rank);

-- 60. [Export] Clear Batch (Step 4)
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Export] Clear Batch (Step 4)',
         'Confirm-guarded reset that wipes all four item arrays, the batch id, localStorage session keys, and upload-session refs so the next drop starts a fresh batch.

Subsystem: Step 4 — Save batch + Shopify CSV export
Atlas status at seed: done

Wiring:
• triggered by: Step 4 ''Clear Batch'' button
• mutates: workflowStore item arrays (uploadedImages/groupedImages/sortedImages/processedItems)
• affects: auto-save (no batch id → autoSaveWorkflow skips) and Step 1 upload (next drop mints a new batch row)

[seeded: feature-atlas 2026-07-19]',
         false,
         60000,
         now()
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'done'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Export] Clear Batch (Step 4)'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'done', t.rank, now()
from new_card nc
cross join (values
  ('Native confirm() guard', 'Uses window.confirm — a known inconsistency with the app''s inline-modal convention (CLAUDE.md Do-Not #12 acknowledges it).', 1000.0),
  ('Session teardown', 'Clears currentBatchId/ref, sortbot_current_batch_id + batch_number localStorage, batchRowInsertedRef, pending upload chunk timer.', 2000.0)
) as t(title, notes, rank);

-- 61. [Export] Shopify CSV export (GoogleSheetExporter)
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Export] Shopify CSV export (GoogleSheetExporter)',
         'Turns the session''s categorized items into a Shopify product-import CSV — one product per group, deduped titles, price-gated, downloaded as a dated .csv blob.

Subsystem: Step 4 — Save batch + Shopify CSV export
Atlas status at seed: done

Wiring:
• consumes: processedItems filtered by App with the Step-3 visibility rule (category set OR true multi-image group) — uncategorized singles never export
• triggered by: Step 3 Finish button via onDownloadCSV → exporterRef.current.downloadCSV(), or manually from the Step 4 panel
• depends on: existing-title dedup fetch (DB + shopify-titles Edge Function)
• depends on: pure CSV builder lib (csvExport.ts) for rows/escaping/taxonomy/GIDs
• depends on: vendorName resolution in App (org description_settings)
• depends on: Step 1 EXIF capture (capturedAt) for shoot-order sorting and Step 2 grouping for product boundaries
• depends on: Step 3 fields (price, seoTitle, generatedDescription, measurements) set by voice/AI/presets/manual edit
• depends on: Supabase Storage public CDN URLs (Shopify fetches Image Src during import)

[seeded: feature-atlas 2026-07-19]',
         true,
         61000,
         now()
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'done'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Export] Shopify CSV export (GoogleSheetExporter)'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'done', t.rank, now()
from new_card nc
cross join (values
  ('Group-to-product mapping', 'Items bucketed by productGroup || id — each group becomes exactly one CSV product with multiple image rows.', 1000.0),
  ('Shoot-order row sorting', 'Groups sorted by earliest capturedAt of members (Math.min), tiebreak by originalName/storagePath natural-order localeCompare — matches Step 2''s default ↑ Date sort; within-group image order untouched.', 2000.0),
  ('Whole-group field coalescing', 'For every field, first non-blank value across ALL group members wins (isBlank covers '''', [], {}) — price/brand/size never depend on which item is group[0].', 3000.0),
  ('Best-title resolution chain', 'First member seoTitle with no unresolved {tokens} → autoTitle from brand/model/color/category/(baseSize) → filename minus extension → stripUnresolvedTokens safety net.', 4000.0),
  ('Image URL resolution', 'resolvePublicUrl prefers https imageUrls[0], reconstructs from storagePath via getPublicUrl, rejects blob: previews (Shopify can''t fetch those).', 5000.0),
  ('Title dedup pass', 'Single running used-set seeded with existingTitles; collisions get '' 2'', '' 3''… suffixes — unique within the file AND against already-uploaded products.', 6000.0),
  ('Price gate', 'Export hard-blocked (alert listing up to 10 offenders + red banner listing up to 8) when any product has NaN/<=0 price; user must fix in Step 3.', 7000.0),
  ('Blob download', 'buildShopifyCsv text → Blob → hidden <a> click, filename shopify-products-YYYY-MM-DD.csv.', 8000.0),
  ('Ref-triggered download', 'downloadCSV exposed via forwardRef/useImperativeHandle; App wires exporterRef so Step 3''s Finish button triggers the download without scrolling to Step 4.', 9000.0),
  ('compactMode prop', 'Hides summary/preview/instructions when true; App currently renders it without compactMode (full UI inside the Step 4 <details>).', 10000.0)
) as t(title, notes, rank);

-- 62. [Export] Pure Shopify CSV builder (csvExport lib)
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Export] Pure Shopify CSV builder (csvExport lib)',
         'Dependency-light pure module that formats coalesced products into the exact 54-column Shopify import CSV — extracted from the component so the export money-path is golden-tested.

Subsystem: Step 4 — Save batch + Shopify CSV export
Atlas status at seed: done

Wiring:
• consumed by: GoogleSheetExporter (buildShopifyCsv for download; the preview table duplicates the same precedence inline for parity)
• depends on: textAIService (smartSeoTruncate, primaryMaterial for fabric GID lookup, normalizeSizeValue for baseSize)
• receives: shopifyProductType/weightValue/tags written by category preset application (applyPresetToGroup) in Steps 2-3
• receives: GidOverrides from the shopify-titles Edge Function metaobjects payload
• locked by: csvExport.test.ts golden snapshot + header/handle/compare-at/taxonomy tests

[seeded: feature-atlas 2026-07-19]',
         true,
         62000,
         now()
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'done'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Export] Pure Shopify CSV builder (csvExport lib)'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'done', t.rank, now()
from new_card nc
cross join (values
  ('54-column header contract', 'SHOPIFY_CSV_HEADERS matches Shopify''s own export format exactly, including metafield column names (custom.size/condition/parcel_size/package_dimensions, shopify.color-pattern/fabric/target-gender, discovery recommendations).', 1000.0),
  ('URL handle generation', 'cleanTitle slugified (lowercase, spaces→dashes, strip non-alphanum, collapse/trim dashes, product-N fallback) with per-export uniqueness via -2/-3 suffixes (usedHandles set).', 2000.0),
  ('Additional image rows', 'For images 2..N a sparse row carries only Handle, Status, Image Src, Image Position, Image Alt Text — Shopify''s multi-image convention.', 3000.0),
  ('Vendor = seller not brand', 'vendorName param fills the Vendor column; falls back to product.brand only when absent (legacy pre-tenancy behavior, locked by golden test).', 4000.0),
  ('Preset shopifyProductType precedence', 'Full taxonomy path (contains ''>'') → Product Category column + Type from last segment; short value → Type only; unset → category-name map resolvers.', 5000.0),
  ('Adult taxonomy map', 'SHOPIFY_CATEGORY_MAP ~80 keys → full Shopify Standard Product Taxonomy paths; mystery-box/bundle keys deliberately blank (no valid taxonomy).', 6000.0),
  ('Kids taxonomy routing', 'resolveCategoryPath checks the kids- prefix FIRST and looks the type segment up in SHOPIFY_KIDS_CATEGORY_MAP (Baby & Children''s Clothing paths) with a parent-path fallback.', 7000.0),
  ('Gender-prefix stripping', 'mens-/womens- prefixes ignored (Shopify taxonomy has no gendered clothing paths — gender lives in the Target gender metafield); segments tried last→first.', 8000.0),
  ('Store Product Type map', 'SHOPIFY_TYPE_MAP maps category segments to the store''s existing custom types (Clothing, Sweatshirts, Pants, Hats & Caps, Outerwear & Coats…) via resolveProductType.', 9000.0),
  ('Hardcoded founding-store GID maps', 'COLOR/FABRIC/GENDER_GID_MAP carry the founding store''s metaobject GIDs with baked-in aliases (cream/tan→beige, olive→green, maroon/burgundy→red, grey/silver→gray, mens→male, unisex→other).', 10000.0),
  ('Per-store GID overrides', 'GidOverrides (from the connected store''s live metaobjects) replace the hardcoded maps entirely — alias-aware lookup, NO fallback to foreign GIDs (blank is safer than a wrong store''s id).', 11000.0),
  ('Tags from hashtags', '#hashtags extracted from generatedDescription win; product.tags array is the fallback.', 12000.0),
  ('Compare-at price rule', 'Variant Compare At Price emitted only when strictly greater than sale price and > 0.', 13000.0),
  ('Grams passthrough', 'weightValue is already grams (preset apply converts lb/oz/kg upstream); Variant Weight Unit hardcoded ''g''.', 14000.0),
  ('Image alt text', '''Title - Color - Size'' with color skipped if already in the title and size run through baseSize.', 15000.0),
  ('baseSize / fits-like stripping', 'baseSize strips ''(fits like …)'' notes via normalizeSizeValue so CSV size metafields/titles/alt carry the clean letter size.', 16000.0),
  ('Token stripping + CSV escaping', 'stripUnresolvedTokens removes leftover {brand}/{model} template tokens; escapeCsvValue quotes/doubles per RFC-ish CSV rules.', 17000.0),
  ('SEO description fallback', 'seoDescription or smartSeoTruncate(generatedDescription) fills the SEO Description column.', 18000.0),
  ('Fixed variant defaults', 'Option1 Title/Default Title, inventory tracker ''shopify'', qty default 1, fulfillment ''manual'', taxable true, gift card false, status lowercased (default active), Body (HTML) newlines → <br>.', 19000.0)
) as t(title, notes, rank);

-- 63. [Export] Existing-title dedup fetch (two sources)
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Export] Existing-title dedup fetch (two sources)',
         'On mount / item-set change, builds the set of already-used product titles from the app DB and the live Shopify catalog so exported titles never collide with prior uploads.

Subsystem: Step 4 — Save batch + Shopify CSV export
Atlas status at seed: done

Wiring:
• feeds: the title dedup pass (usedTitles seed) and GID resolvers (per-store overrides) in the CSV export
• depends on: shopify-titles Edge Function (best-effort) and the products table rows written by Save Batch / registerItemsInDB / Step 3 sync
• triggered by: GoogleSheetExporter mount and item-set size changes

[seeded: feature-atlas 2026-07-19]',
         true,
         63000,
         now()
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'done'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Export] Existing-title dedup fetch (two sources)'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'done', t.rank, now()
from new_card nc
cross join (values
  ('Source 1 — app products table', 'Paginated select of seo_title/id/product_group (1000/page past PostgREST cap), excluding the current batch''s own product ids AND group ids so re-exporting keeps identical titles (Shopify updates, not duplicates).', 1000.0),
  ('Source 2 — live Shopify catalog', 'supabase.functions.invoke(''shopify-titles'') best-effort; own current titles excluded; silent catch → DB-only dedup when the function isn''t deployed or errors.', 2000.0),
  ('GID override capture', 'The same invoke response''s metaobjects key (color/fabric/gender maps) is stored as gidOverrides state for metafield resolution.', 3000.0),
  ('Refetch throttle + cancellation', 'Effect keyed on items.length only (not per-keystroke) with a cancelled flag against StrictMode/unmount races.', 4000.0)
) as t(title, notes, rank);

-- 64. [Export] shopify-titles Edge Function (server-side Shopify Admin read)
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Export] shopify-titles Edge Function (server-side Shopify Admin read)',
         'Deno Edge Function that reads every product title+handle (and metaobject GID maps) from the caller''s org''s Shopify store via Admin GraphQL, keeping the Admin token server-side.

Subsystem: Step 4 — Save batch + Shopify CSV export
Atlas status at seed: done

Wiring:
• invoked by: GoogleSheetExporter''s dedup effect (supabase.functions.invoke, best-effort)
• reads: org_shopify_connections table via service role (client has no SELECT on admin_token)
• depends on: multi_org_tenancy + org_shopify_connections migrations for per-org mode (falls back gracefully pre-migration)
• feeds: existingTitles set (title dedup) and GidOverrides (metafield GID resolution) in the CSV export
• configured by: per-org Shopify connection management (OrgPanel) or global Supabase secrets

[seeded: feature-atlas 2026-07-19]',
         true,
         64000,
         now()
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'done'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Export] shopify-titles Edge Function (server-side Shopify Admin read)'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'done', t.rank, now()
from new_card nc
cross join (values
  ('Per-org connection resolution', 'JWT → user id → oldest org membership (mirrors default_org_id) → org_shopify_connections row read via service role; token never touches the client.', 1000.0),
  ('Founding/legacy global fallback', 'No org connection: founding slug or failed lookup (pre-tenancy) falls back to SHOPIFY_STORE/SHOPIFY_ADMIN_TOKEN secrets; any OTHER org gets a clean empty {titles:[],source:''none''} — never deduped against a foreign store.', 2000.0),
  ('Paginated title crawl', 'GraphQL products query 250/page, cursor pagination, hard 200-page cap so a runaway store can''t time out the function; 502 with detail on Shopify errors.', 3000.0),
  ('Metaobject GID harvest', 'Best-effort metaobjectDefinitions scan bucketing types containing color/fabric/gender into lowercased displayName→gid maps; requires read_metaobjects scope, silently omitted on failure.', 4000.0),
  ('Auth + CORS', 'verify_jwt ON (only signed-in app users can invoke); CORS headers open; OPTIONS preflight handled.', 5000.0)
) as t(title, notes, rank);

-- 65. [Export] Export preview table + summary
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Export] Export preview table + summary',
         'Live in-browser preview of the exact CSV output — summary stat cards, price-block banner, and a sticky-header horizontally-scrollable table mirroring the row builder''s precedence rules.

Subsystem: Step 4 — Save batch + Shopify CSV export
Atlas status at seed: done

Wiring:
• depends on: the same coalesced/deduped products array and gidOverrides used for the actual download (single source in the component render)
• depends on: csvExport resolvers so preview and file can never disagree on taxonomy/type/GIDs
• hidden when: compactMode is true (currently always rendered full inside the Step 4 <details>)

[seeded: feature-atlas 2026-07-19]',
         true,
         65000,
         now()
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'done'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Export] Export preview table + summary'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'done', t.rank, now()
from new_card nc
cross join (values
  ('Summary stat cards', 'Total products, priced-item count, distinct category count.', 1000.0),
  ('Price-block banner', 'Red banner listing up to 8 unpriced products (buildCleanTitle names) whenever the price gate would block export.', 2000.0),
  ('Full-width preview table', 'All products rendered (minWidth 4800px, sticky thead, 420px max height); cells truncated 35-60 chars with full value in title tooltip, em-dash for blanks.', 3000.0),
  ('Builder parity', 'Each cell computed with the same helpers/precedence as buildShopifyCsvRows (buildCleanTitle, preset shopifyProductType, GID overrides, vendorName, grams, compare-at rule).', 4000.0),
  ('Header/cell drift (minor)', 'Preview header array lists 52 columns but rows emit 54 cells — Parcel Size and Package Dimensions values render without header cells (real CSV headers are correct at 54).', 5000.0)
) as t(title, notes, rank);

-- 66. [Export] Vendor name resolution (CSV Vendor column)
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Export] Vendor name resolution (CSV Vendor column)',
         'App resolves the seller name for the CSV Vendor column: org description_settings.vendorName → ''C&D Vintage'' for the founding workspace → workspace name → undefined (legacy → garment brand fallback).

Subsystem: Step 4 — Save batch + Shopify CSV export
Atlas status at seed: done

Wiring:
• depends on: org bootstrap (orgService.ensureOrganization) and description_settings JSONB edited in OrgPanel''s format section
• consumed by: buildShopifyCsvRows Vendor column and the preview table
• deliberately decoupled from: preset.vendor / item.brand (a short-lived wiring that leaked shop name into brand/titles was reverted and is test-locked)

[seeded: feature-atlas 2026-07-19]',
         false,
         66000,
         now()
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'done'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Export] Vendor name resolution (CSV Vendor column)'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'done', t.rank, now()
from new_card nc
cross join (values
  ('resolvedVendorName chain', 'Computed in App from orgDescSettings + currentOrg slug/name; passed as the vendorName prop to GoogleSheetExporter (download + preview).', 1000.0),
  ('Legacy brand fallback', 'Undefined vendorName (pre-tenancy legacy mode) makes buildShopifyCsvRows fall back to product.brand — the old behavior, golden-test locked.', 2000.0)
) as t(title, notes, rank);

-- 67. [Library] Library modal (three-tab data browser)
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Library] Library modal (three-tab data browser)',
         'Modal overlay browsing all batches, product groups (''listings''), and images across the shared workspace, with two-phase loading so the batch list renders before heavy data arrives.

Subsystem: Library, batches, persistence & data-integrity machinery
Atlas status at seed: done

Wiring:
• triggered by: header Library button in App.tsx (showLibrary state)
• triggered by: libraryRefreshTrigger increments from upload / grouping / image delete / Save Batch
• depends on: deriveLibraryData (pure derivation), fetchSavedProducts/fetchSavedImages (paginated fetchers)
• feeds: batch open flow via onOpenBatch → App.handleOpenBatch
• feeds: active-batch teardown via onBatchDeleted → App.handleBatchDeleted
• consumed by: all steps indirectly — opening a batch repopulates the whole workflow

[seeded: feature-atlas 2026-07-19]',
         true,
         67000,
         now()
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'done'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Library] Library modal (three-tab data browser)'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'done', t.rank, now()
from new_card nc
cross join (values
  ('Two-phase loadAll', 'Phase 1 fetchWorkflowBatchesMeta (no workflow_state blob, lastEditedBy via JSONB ->> projection) shows batches instantly; Phase 2 fetches workflow_state + products + images in parallel', 1000.0),
  ('Tab counts', 'Header shows live batch/listing/image counts per active tab', 2000.0),
  ('Client-side search', 'Normalized (punctuation-stripped) search over batch names/numbers, group titles, images per tab', 3000.0),
  ('StrictMode cancellation', 'cancelRef pattern per effect invocation prevents double-mount fetches stomping state', 4000.0),
  ('In-flight guard', 'isLoadingRef skips overlapping loadAll calls; force=true bypasses for mount calls', 5000.0),
  ('refreshTrigger re-fetch', 'Re-runs loadAll when App increments libraryRefreshTrigger (upload, group change, image delete, Save Batch)', 6000.0),
  ('Collapse-all default', 'All batch and group sections collapse on load; collapse state keyed per tab', 7000.0),
  ('Scroll preservation', 'saveScroll + useLayoutEffect restore scroll position across optimistic state updates', 8000.0),
  ('Inline prompt modal', 'showPrompt() promise-based modal replaces native prompt() for all name/choice inputs', 9000.0),
  ('Delete progress overlay', 'Animated clothing-rack/hanger/trashcan 2s deletion animation per delete', 10000.0),
  ('Delete-failure banner', 'Dismissible red .library-delete-error banner when a delete is RLS-blocked (never silent)', 11000.0),
  ('Debug diagnostics', 'Per-batch image breakdowns and unassigned/orphan traces logged when window.__SORTBOT_DEBUG__ is on', 12000.0)
) as t(title, notes, rank);

-- 68. [Library] Library data derivation (deriveLibraryData)
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Library] Library data derivation (deriveLibraryData)',
         'Pure transformation (workflow batches, DB products, DB images) → (batches, groups, images) extracted from Library.loadAll and locked by libraryData.test.ts.

Subsystem: Library, batches, persistence & data-integrity machinery
Atlas status at seed: done

Wiring:
• consumed by: Library.loadAll (sole consumer)
• depends on: slim whitelist contract — storagePath must survive slimForWorkflowState for URL rebuild
• depends on: registerItemsInDB writes — Pass 2 sees what it registered in product_images

[seeded: feature-atlas 2026-07-19]',
         true,
         68000,
         now()
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'done'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Library] Library data derivation (deriveLibraryData)'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'done', t.rank, now()
from new_card nc
cross join (values
  ('Batch synthesis', 'Fabricates batch entries for batch_ids present in products/images but missing from workflow_batches', 1000.0),
  ('Dual-source productGroups', 'Groups built from workflow_state AND DB products (leader = member whose id === product_group); saved (DB) version wins on id collision', 2000.0),
  ('Two-pass imageList', 'Pass 1 workflow_state items (authoritative, ID-deduped into wfItemIds); Pass 2 DB product_images rows skipped per-product-id regardless of batch_id (commit 8643c5d rule)', 3000.0),
  ('Gap-fill surfacing', 'DB rows absent from workflow_state still surface (covers pre-dbd5d43 corrupted blobs)', 4000.0),
  ('URL reconstruction', 'CDN URLs rebuilt from storagePath because slim() strips preview/imageUrls', 5000.0),
  ('RLS-orphan skip', 'Unassigned DB groups with zero images are treated as gone (products row survived RLS, images deleted)', 6000.0),
  ('cleanTitle / makeBatchName', 'Strips unfilled {token} placeholders; generates date-based fallback batch names', 7000.0),
  ('Newest-first sort', 'Final batches sorted by updated_at descending', 8000.0)
) as t(title, notes, rank);

-- 69. [Library] Batch cards & batch management
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Library] Batch cards & batch management',
         'Batch tab cards with open/rename/duplicate/repair/delete actions, live counts, progress, 2x2 thumbnails, Active badge, and edited-by attribution.

Subsystem: Library, batches, persistence & data-integrity machinery
Atlas status at seed: done

Wiring:
• feeds: App.handleOpenBatch (Open), deleteWorkflowBatch cascade (Delete)
• depends on: auto-save''s lastEditedBy/lastEditedAt stamp for attribution
• consumed by: rubber-band + click multi-select for bulk delete

[seeded: feature-atlas 2026-07-19]',
         true,
         69000,
         now()
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'done'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Library] Batch cards & batch management'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'done', t.rank, now()
from new_card nc
cross join (values
  ('Open batch', 'Open button (only path into a stored batch) calls onOpenBatch(batch)', 1000.0),
  ('Inline rename', 'Click title or edit icon → input, Enter/blur saves via updateBatchMetadata', 2000.0),
  ('Two-click delete confirm', 'Delete → ''Confirm?'' with 3s auto-reset before cascade delete runs', 3000.0),
  ('Active badge', 'Green ''● Active'' pill when card matches currentBatchId prop from App', 4000.0),
  ('Live counts', 'Image/group counts take max(workflow_state count, DB-derived count) so corrupted blobs show the fuller number', 5000.0),
  ('edited-by row', 'Shows lastEditedBy email stamped into workflow_state by auto-save', 6000.0),
  ('Step progress bar', 'current_step (1-4) rendered as label + percent bar', 7000.0),
  ('Thumbnail grid', 'Up to 4 thumbnails from workflow_state with DB productGroups fallback (getThumbnails)', 8000.0),
  ('New Batch button', 'Creates an empty workflow_batches row via inline prompt (batches tab only)', 9000.0),
  ('Relative dates', '''Just now'' / ''Nh ago'' / ''Nd ago'' formatting on updated_at', 10000.0)
) as t(title, notes, rank);

-- 70. [Library] Batch open/restore (handleOpenBatch)
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Library] Batch open/restore (handleOpenBatch)',
         '300+ line App.tsx flow that rehydrates a stored batch into the live workflow: workflow_state first for instant render, then DB merge, gap-fill, and background registration.

Subsystem: Library, batches, persistence & data-integrity machinery
Atlas status at seed: done

Wiring:
• triggered by: Library Open button (onOpenBatch)
• feeds: workflowStore four item arrays (all Steps 2-4 visibility)
• feeds: gap-fill safety cap + stolen-row cleanup (see that feature)
• calls: registerItemsInDB, autoSaveWorkflow (via EXIF patch)
• depends on: slim whitelist + storagePath survival, markBatchConfirmed tombstone machinery
• consumed by: PDG remount via key={currentBatchId}

[seeded: feature-atlas 2026-07-19]',
         true,
         70000,
         now()
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'done'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Library] Batch open/restore (handleOpenBatch)'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'done', t.rank, now()
from new_card nc
cross join (values
  ('Double-fire guard', 'isOpeningBatchRef blocks StrictMode/double-click re-entry; released in finally', 1000.0),
  ('Identity-first ordering', 'batchId ref + localStorage + markBatchConfirmed set BEFORE state clears so racing auto-saves target the right batch', 2000.0),
  ('Restore fallback chain', 'processedItems → sortedImages → groupedImages → uploadedImages (single-list new format + legacy formats)', 3000.0),
  ('URL rehydration', 'Rejects stale blob: URLs; rebuilds preview/imageUrls/thumbnailUrl from storagePath (authoritative)', 4000.0),
  ('DB merge by productGroup', 'products matched group-first (only collision-free key), then own image URL, then title; position-index fallback removed to stop cross-item bleed', 5000.0),
  ('Own-image preservation', 'Group-level DB match never overwrites an item''s own photo — DB group image list is fallback only', 6000.0),
  ('±24h orphan search', 'When no products carry the batch_id, searches products created within 24h and matches by image URL', 7000.0),
  ('No-workflow_state rebuild', 'Full ClothingItems reconstructed from products + product_images when the blob is empty', 8000.0),
  ('Background registration', 'registerItemsInDB fired without await, skipped when DB already has products (foundInDB) or batch already active', 9000.0),
  ('Auto-EXIF rescan', '≤30 items missing capturedAt get background EXIF DateTimeOriginal fetch, then auto-save persists dates', 10000.0),
  ('sz-title scrub', 'Titles containing the garbled ''sz'' artifact cleared for regeneration', 11000.0)
) as t(title, notes, rank);

-- 71. [Library] Startup session restore
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Library] Startup session restore',
         'On app mount, restores the last active batch from localStorage id + Supabase workflow_state so a page reload never loses the session.

Subsystem: Library, batches, persistence & data-integrity machinery
Atlas status at seed: done

Wiring:
• triggered by: auth useEffect on mount (supabase.auth.getSession)
• depends on: localStorage keys written by auto-save and batch lifecycle (sortbot_current_batch_id, sortbot_workflow_backup)
• depends on: markBatchConfirmed (arms deleted-batch detection for later auto-saves)
• feeds: workflowStore four arrays, registerItemsInDB

[seeded: feature-atlas 2026-07-19]',
         true,
         71000,
         now()
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'done'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Library] Startup session restore'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'done', t.rank, now()
from new_card nc
cross join (values
  ('Stale-id cleanup', 'maybeSingle fetch; missing row clears sortbot_current_batch_id/number from localStorage', 1000.0),
  ('Backup race-win', 'sortbot_workflow_backup wins over Supabase when savedAt is newer than last_opened_at (quick-refresh-before-debounce case) or Supabase is empty', 2000.0),
  ('Canonical URL rebuild', 'imageUrls always rebuilt from storagePath (saved values can point at wrong items after merge bugs); blob: URLs rejected', 3000.0),
  ('originalName backfill', 'Bulk product_images select (chunked 100) merges filenames into items missing them', 4000.0),
  ('Two-stage DB image fallback', 'No-URL legacy items: stage 1 product_images by id; stage 2 productGroup peers'' images via products join', 5000.0),
  ('Background DB hydration', 'Fire-and-forget products fetch merges ~50 DB-backed fields (byId/byTitle/byImgUrl maps) after UI renders; registers items if DB empty', 6000.0),
  ('workflow_state-null path', 'Batch row exists but never saved — restores entirely from localStorage backup and registers in DB', 7000.0),
  ('Explicit session user', 'registerItemsInDB receives session.user because React user state isn''t set yet', 8000.0),
  ('Auto-EXIF rescan', 'Same ≤30-item background capturedAt recovery as handleOpenBatch', 9000.0)
) as t(title, notes, rank);

-- 72. [Library] Auto-save engine (autoSaveWorkflow + autoSaveWorkflowBatch)
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Library] Auto-save engine (autoSaveWorkflow + autoSaveWorkflowBatch)',
         'Debounced (2s) persistence of the most-progressed item list into workflow_batches.workflow_state, with a synchronous localStorage backup and duplicate/resurrection safeguards.

Subsystem: Library, batches, persistence & data-integrity machinery
Atlas status at seed: done

Wiring:
• triggered by: every workflow mutation in App (upload complete, grouping, categorize, PDG onProcessed, EXIF patches)
• depends on: workflowStore liveArrayRef reads and currentBatchIdRef (never render-captured state)
• depends on: tombstone registry (refuses writes to deleted batch ids)
• feeds: Library loadAll, startup restore, handleOpenBatch (they all read workflow_state)
• feeds: localStorage backup consumed by startup restore race-win

[seeded: feature-atlas 2026-07-19]',
         true,
         72000,
         now()
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'done'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Library] Auto-save engine (autoSaveWorkflow + autoSaveWorkflowBatch)'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'done', t.rank, now()
from new_card nc
cross join (values
  ('Instant localStorage backup', 'ultraSlimForBackup (7 fields) written synchronously on every call — no debounce — to win quick-refresh races', 1000.0),
  ('Single-list save', 'Only the most-progressed array saved as processedItems (others []), slim-whitelisted; restore fans it back into all four arrays', 2000.0),
  ('2s debounce + null-batch skip', 'Timer resets per call; fires only when currentBatchIdRef is resolved', 3000.0),
  ('In-flight mutex', 'autoSaveInFlightRef skips a second fire while a round-trip is pending (prevents duplicate batch INSERTs)', 4000.0),
  ('Blind UPDATE disambiguation', '0-rows-updated splits into: row exists but RLS-blocked (keep id, don''t fork), confirmed-then-gone (tombstone, drop save), never-confirmed (stub-insert recovery creates fresh row)', 5000.0),
  ('lastEditedBy stamp', 'Editor email + ISO timestamp written into workflow_state for Library attribution', 6000.0),
  ('Stats + step computation', 'calculateWorkflowStats and determineCurrentStep derive card counts and current_step from the live list', 7000.0),
  ('No Library refresh', 'Deliberately never bumps libraryRefreshTrigger (would create an autoSave → loadAll loop)', 8000.0)
) as t(title, notes, rank);

-- 73. [Library] Deleted-batch tombstones & confirmed-batch registry
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Library] Deleted-batch tombstones & confirmed-batch registry',
         'Anti-resurrection machinery: confirmed-deleted batch ids can never be re-written by this browser, and confirmed-existing batches that vanish are treated as deleted rather than re-created.

Subsystem: Library, batches, persistence & data-integrity machinery
Atlas status at seed: done

Wiring:
• consumed by: auto-save engine (write gate) and deleteWorkflowBatch (tombstones on confirmed row deletion)
• complements: App.handleBatchDeleted UI teardown (tombstone blocks the write, teardown clears the UI)

[seeded: feature-atlas 2026-07-19]',
         true,
         73000,
         now()
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'done'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Library] Deleted-batch tombstones & confirmed-batch registry'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'done', t.rank, now()
from new_card nc
cross join (values
  ('Tombstone registry', 'markBatchDeleted/isBatchDeleted, in-memory Set + localStorage sortbot_deleted_batch_ids capped at 200', 1000.0),
  ('Confirmed-batch set', 'markBatchConfirmed called from startup restore, handleOpenBatch, getWorkflowBatch, and successful auto-save UPDATEs', 2000.0),
  ('Save refusal', 'autoSaveWorkflowBatch returns null (no write) for tombstoned ids', 3000.0),
  ('Cross-user delete detection', 'Confirmed batch whose row is gone (deleted by another user) is tombstoned instead of re-created', 4000.0)
) as t(title, notes, rank);

-- 74. [Library] Slim persistence contracts (slimItems)
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Library] Slim persistence contracts (slimItems)',
         'The unit-tested save→reload whitelist: only fields unrecoverable from the products/product_images tables survive into workflow_state or the localStorage backup.

Subsystem: Library, batches, persistence & data-integrity machinery
Atlas status at seed: done

Wiring:
• consumed by: auto-save engine (both shapes)
• contract with: startup restore, handleOpenBatch, deriveLibraryData (all must reconstruct stripped fields from storagePath/DB)
• shrinks toward retirement by: Stage 4 dual-write (moves capturedAt/originalStoragePath/descriptionEdited into DB columns)

[seeded: feature-atlas 2026-07-19]',
         false,
         74000,
         now()
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'done'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Library] Slim persistence contracts (slimItems)'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'done', t.rank, now()
from new_card nc
cross join (values
  ('slimForWorkflowState', '15-field whitelist (id, storagePath, imageUrls, thumbnailUrl, productGroup, category, capturedAt, originalName, imageRotation, crop, originalStoragePath, originalUrl, brandCategory, descriptionEdited, customDescription); strips file/preview/_presetData/all DB text — ~10x smaller blob', 1000.0),
  ('ultraSlimForBackup', '7-field shape for the synchronous localStorage backup (race detection only)', 2000.0),
  ('Contract invariant', 'Any new ClothingItem field not DB-recoverable must be added here or it vanishes on reload', 3000.0)
) as t(title, notes, rank);

-- 75. [Library] workflowStore (shared item-array store)
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Library] workflowStore (shared item-array store)',
         'Dependency-free useSyncExternalStore store that is the single source of truth for the four workflow item arrays plus currentBatchId, replacing the ref-mirror pattern.

Subsystem: Library, batches, persistence & data-integrity machinery
Atlas status at seed: done

Wiring:
• consumed by: App.tsx and ProductDescriptionGenerator (both read/write the same processedItems list)
• feeds: auto-save engine via liveArrayRef reads
• populated by: startup restore, handleOpenBatch, upload chunk streaming

[seeded: feature-atlas 2026-07-19]',
         true,
         75000,
         now()
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'done'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Library] workflowStore (shared item-array store)'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'done', t.rank, now()
from new_card nc
cross join (values
  ('getState live reads', 'Async callbacks/timers read live state directly — staleness impossible by construction', 1000.0),
  ('useStoreItemArray', 'useState-compatible adapter (value + functional setter, stable identity) so ~74 App call sites were unchanged', 2000.0),
  ('liveArrayRef', '.current getter views replacing per-render ref mirrors; fresh immediately after a setter call', 3000.0),
  ('reset()', 'Empties the store on sign-out / active-batch deletion / tests', 4000.0)
) as t(title, notes, rank);

-- 76. [Library] registerItemsInDB (workflow → relational sync)
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Library] registerItemsInDB (workflow → relational sync)',
         'Registers restored/backup workflow items into products + product_images so the Library and DB hydration see them; the canonical hybrid delete-then-upsert write path.

Subsystem: Library, batches, persistence & data-integrity machinery
Atlas status at seed: done

Wiring:
• triggered by: startup restore (DB-empty and backup paths) and handleOpenBatch (background)
• feeds: Library imageList Pass 2, DB hydration merges, gap-fill queries
• depends on: imageRowSync (stage4 probe + shared row shape)

[seeded: feature-atlas 2026-07-19]',
         true,
         76000,
         now()
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'done'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Library] registerItemsInDB (workflow → relational sync)'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'done', t.rank, now()
from new_card nc
cross join (values
  ('batch_id-safe products upsert', 'ignoreDuplicates:true on id — can NEVER steal batch_id from another batch (the unbounded-gap-fill bug)', 1000.0),
  ('Hybrid delete-then-upsert', 'product_images wiped (chunked 100 to dodge PostgREST URL-length 400s) then upserted on (product_id,image_url) with ignoreDuplicates for concurrent-call safety', 2000.0),
  ('original_name preservation', 'Pre-fetches existing filenames before the wipe so backfilled values survive', 3000.0),
  ('Stage 4 row builder', 'buildProductImageRow shared builder adds transforms + captured_at + original_storage_path when migration columns exist', 4000.0),
  ('Skip heuristics', 'Not called when DB already has the batch''s products (foundInDB) or when re-opening the already-active batch', 5000.0)
) as t(title, notes, rank);

-- 77. [Library] Save Batch (explicit products persistence)
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Library] Save Batch (explicit products persistence)',
         'Step 4 ''Save Batch'' writes one products row per group plus all image rows, prunes stale rows, refreshes the Library, and clears the session.

Subsystem: Library, batches, persistence & data-integrity machinery
Atlas status at seed: done

Wiring:
• triggered by: Step 4 Save Batch button (handleSaveBatch)
• feeds: Library groups/images tabs, CSV exporter''s own-products title dedup, handleOpenBatch DB merge
• depends on: imageRowSync stage4 gating, imageTransforms.createTransformedFile

[seeded: feature-atlas 2026-07-19]',
         true,
         77000,
         now()
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'done'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Library] Save Batch (explicit products persistence)'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'done', t.rank, now()
from new_card nc
cross join (values
  ('Group-wise upsert', 'saveBatchToDatabase groups by productGroup; saveProductToDatabase upserts ~50 columns on id (safe to save repeatedly)', 1000.0),
  ('Transformed-image re-upload', 'Items with rotation/crop get a client-side re-encoded file uploaded; otherwise existing storagePath reused (no re-upload)', 2000.0),
  ('Image upsert on (product_id,image_url)', 'Composite unique key updates in place instead of duplicating', 3000.0),
  ('pruneStaleProducts', 'Diff DB ids vs kept ids, delete orphans chunked 100 (avoids giant NOT IN)', 4000.0),
  ('Post-save teardown', 'libraryRefreshTrigger bump, success/fail message, session arrays cleared after 3s', 5000.0)
) as t(title, notes, rank);

-- 78. [Library] Per-field product sync (updateProduct / syncGroupFieldsToDatabase)
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Library] Per-field product sync (updateProduct / syncGroupFieldsToDatabase)',
         'Field-mapped patch of the products table used by Step 3''s debounced 500ms save and Next/Prev navigation, keeping DB text in sync without a Save button.

Subsystem: Library, batches, persistence & data-integrity machinery
Atlas status at seed: done

Wiring:
• triggered by: PDG debounced auto-save, Next/Prev, beforeunload/pagehide flush
• consumed by: handleOpenBatch merge and startup DB hydration (reads what this wrote)
• depends on: Stage 4 probe for description_edited

[seeded: feature-atlas 2026-07-19]',
         false,
         78000,
         now()
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'done'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Library] Per-field product sync (updateProduct / syncGroupFieldsToDatabase)'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'done', t.rank, now()
from new_card nc
cross join (values
  ('Undefined-skipping patch builder', '~50 ClothingItem→column mappings; only defined fields written; url_handle derived from seoTitle', 1000.0),
  ('applied_preset_id guard', 'Never overwrites the DB value with an empty string (preset label survives reload)', 2000.0),
  ('Direct id lookup', 'syncGroupFieldsToDatabase keys on representative item.id (product.id === item.id invariant) — no title lookups', 3000.0)
) as t(title, notes, rank);

-- 79. [Library] Batch delete cascade (deleteWorkflowBatch)
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Library] Batch delete cascade (deleteWorkflowBatch)',
         'Full cascade delete of a batch: storage files (reference-guarded), product_images, products, and the batch row, with confirmed-deletion tombstoning and claim-ownership for non-owned rows.

Subsystem: Library, batches, persistence & data-integrity machinery
Atlas status at seed: done

Wiring:
• triggered by: Library single delete and bulk delete
• feeds: Library delete-failure banner (false return) and onBatchDeleted callback
• depends on: storageSafety guard running BEFORE product_images rows are deleted

[seeded: feature-atlas 2026-07-19]',
         true,
         79000,
         now()
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'done'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Library] Batch delete cascade (deleteWorkflowBatch)'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'done', t.rank, now()
from new_card nc
cross join (values
  ('Path collection incl. crop originals', 'Gathers product_images storage_paths PLUS originalStoragePath backups cached only in workflow_state', 1000.0),
  ('Shared-file guard', 'filterUnreferencedStoragePaths keeps files another batch''s rows still reference (duplicates share files)', 2000.0),
  ('Claim ownership', 'UPDATEs user_id on batch/products/images (chunked 100) so owner-scoped DELETE RLS permits removal of others'' batches', 3000.0),
  ('Confirmed deletion', '.select(''id'') on the batch delete — 0 rows returns false so the UI can surface the failure', 4000.0),
  ('Tombstone on success', 'markBatchDeleted prevents any auto-save resurrection in this browser', 5000.0)
) as t(title, notes, rank);

-- 80. [Library] Active-batch teardown (handleBatchDeleted)
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Library] Active-batch teardown (handleBatchDeleted)',
         'When the deleted batch is the active session, App cancels all pending debounced saves and wipes in-memory + localStorage session state so nothing writes the deleted content back.

Subsystem: Library, batches, persistence & data-integrity machinery
Atlas status at seed: done

Wiring:
• triggered by: Library onBatchDeleted (single and bulk delete paths)
• complements: tombstone registry (tombstone blocks the write; this clears the UI/session)

[seeded: feature-atlas 2026-07-19]',
         false,
         80000,
         now()
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'done'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Library] Active-batch teardown (handleBatchDeleted)'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'done', t.rank, now()
from new_card nc
cross join (values
  ('Timer cancellation', 'Clears autoSaveTimerRef, groupUpsertTimerRef, chunkTimerRef and pending upload chunks', 1000.0),
  ('Identity + backup wipe', 'Removes sortbot_current_batch_id, sortbot_current_batch_number, sortbot_workflow_backup; resets batchRowInsertedRef', 2000.0),
  ('Array clear', 'Empties all four workflowStore item arrays', 3000.0)
) as t(title, notes, rank);

-- 81. [Library] Clear Batch (handleClearBatch)
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Library] Clear Batch (handleClearBatch)',
         'Confirm-guarded local session reset that clears all item arrays and batch identity WITHOUT touching DB rows, so the next upload starts a fresh batch.

Subsystem: Library, batches, persistence & data-integrity machinery
Atlas status at seed: done

Wiring:
• triggered by: Clear button in Step 4 area
• contrasts with: deleteWorkflowBatch (DB rows and storage remain intact here)

[seeded: feature-atlas 2026-07-19]',
         false,
         81000,
         now()
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'done'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Library] Clear Batch (handleClearBatch)'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'done', t.rank, now()
from new_card nc
cross join (values
  ('Native confirm()', 'Still uses window.confirm — known inconsistency vs Library''s inline modal', 1000.0),
  ('Upload-session reset', 'Resets batchRowInsertedRef/isUploadingRef/pendingChunkRef/chunkTimer so the next drop gets a fresh batch row', 2000.0)
) as t(title, notes, rank);

-- 82. [Library] Storage shared-file guard (storageSafety)
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Library] Storage shared-file guard (storageSafety)',
         'Reference-count guard that returns only storage paths no surviving product_images row references, preventing deletes from wiping images shared by duplicated batches.

Subsystem: Library, batches, persistence & data-integrity machinery
Atlas status at seed: done

Wiring:
• consumed by: deleteWorkflowBatch, deleteProductGroup, Library handleDeleteUnassigned
• protects against: batch duplication''s shared-storage-path model

[seeded: feature-atlas 2026-07-19]',
         false,
         82000,
         now()
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'done'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Library] Storage shared-file guard (storageSafety)'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'done', t.rank, now()
from new_card nc
cross join (values
  ('Chunked lookup', 'storage_path IN() queries chunked at 100 for PostgREST URL limits', 1000.0),
  ('Fail-safe', 'Lookup errors mark the chunk as referenced (file kept) rather than risk deleting a shared file', 2000.0),
  ('Ordering contract', 'Must run BEFORE the product_images rows are deleted so own-rows vs foreign-rows are distinguishable', 3000.0)
) as t(title, notes, rank);

-- 83. [Library] Library group/image delete + workflow_state scrubbing (libraryService)
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Library] Library group/image delete + workflow_state scrubbing (libraryService)',
         'Deletion of individual product groups and images with storage guard, RLS claim-ownership, and workflow_state scrubbing so deleted items cannot resurrect on the next loadAll.

Subsystem: Library, batches, persistence & data-integrity machinery
Atlas status at seed: done

Wiring:
• triggered by: Library group/image delete buttons and bulk delete loop
• depends on: storageSafety guard, claim-ownership pattern (owner-scoped DELETE RLS)
• protects: loadAll from resurrecting deleted items out of workflow_state

[seeded: feature-atlas 2026-07-19]',
         true,
         83000,
         now()
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'done'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Library] Library group/image delete + workflow_state scrubbing (libraryService)'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'done', t.rank, now()
from new_card nc
cross join (values
  ('deleteProductGroup', 'Storage guard → claim user_id → delete images → delete product → scrub group items from workflow_state (fast path by batch_id, else scan all batches)', 1000.0),
  ('deleteImage', 'Storage remove → row delete → scrub item id from the owning batch''s workflow_state arrays', 2000.0),
  ('removeItemsFromWorkflowBatch', 'Filters given ids out of all four workflow_state arrays (anti-resurrection helper)', 3000.0),
  ('Local state mirror', 'Library also patches its in-memory batches'' workflow_state so re-renders don''t show deleted items', 4000.0),
  ('Dead exports', 'updateProductGroup, moveImageToGroup, bulkDeleteImages/ProductGroups/Batches, searchBatches, filterBatchesByTags have no consumers (Library loops the singular deletes itself)', 5000.0)
) as t(title, notes, rank);

-- 84. [Library] Gap-fill + safety cap + stolen-row cleanup
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Library] Gap-fill + safety cap + stolen-row cleanup',
         'Data-integrity heuristic in handleOpenBatch: appends DB products missing from workflow_state (corrupted-blob recovery) unless the missing count exceeds max(2×wfItems, 50), in which case the rows are treated as stolen duplicates and permanently deleted in the background.

Subsystem: Library, batches, persistence & data-integrity machinery
Atlas status at seed: done

Wiring:
• part of: handleOpenBatch flow
• cleans up: rows cloned by the historical ignoreDuplicates:false registerItemsInDB era
• constrains: Library Unassigned section (no assign-to-batch button allowed — would re-trigger this cap in an infinite loop)
• becomes dead code after: Stage 4 DB-first restore flip

[seeded: feature-atlas 2026-07-19]',
         false,
         84000,
         now()
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'done'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Library] Gap-fill + safety cap + stolen-row cleanup'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'done', t.rank, now()
from new_card nc
cross join (values
  ('Gap-fill append', 'Missing DB products become full ClothingItems (images, storagePath, thumbnail, originalName reconstructed; capturedAt undefined)', 1000.0),
  ('Safety cap', 'max(workflowItems.length × 2, 50) — 2x headroom for legitimate gap-fill, catches mass-stolen batches', 2000.0),
  ('Background DELETE', 'Stolen ids deleted chunked 100, product_images before products (FK); deliberately DELETE not batch_id=null (nullifying loops via Unassigned)', 3000.0)
) as t(title, notes, rank);

-- 85. [Library] Unassigned/orphan cleanup (Library Images tab)
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Library] Unassigned/orphan cleanup (Library Images tab)',
         'Separate ''Unassigned'' section for batch_id-null products and parentless product_images rows, with a single guarded ''Delete all unassigned'' bulk operation and deliberately no assign feature.

Subsystem: Library, batches, persistence & data-integrity machinery
Atlas status at seed: done

Wiring:
• cleans up: duplicates from the old gap-fill/ignoreDuplicates bug (complements handleOpenBatch''s stolen-row deletion)
• depends on: storageSafety guard, deriveLibraryData surfacing orphaned rows with undefined productGroup

[seeded: feature-atlas 2026-07-19]',
         true,
         85000,
         now()
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'done'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Library] Unassigned/orphan cleanup (Library Images tab)'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'done', t.rank, now()
from new_card nc
cross join (values
  ('Two deletion buckets', 'Products with a productGroup (normal path) vs orphan product_images rows whose parent product is gone (deleted by id directly)', 1000.0),
  ('RLS fallbacks', 'When SELECT returns 0 (RLS-blocked), deletes fall back to image ids known from Library state; claim-ownership UPDATE before products DELETE', 2000.0),
  ('workflow_state scrub', 'All batches scanned and scrubbed of the deleted product groups', 3000.0),
  ('Delete debug trace', 'addTrace step-by-step console audit (fetch/storage/delete/claim/confirm) when debug is on', 4000.0),
  ('workingUnassigned guard', 'Boolean state prevents double-click re-entry; native confirm gate', 5000.0),
  ('No assign button by design', 'Assigning orphans to a batch re-triggers the gap-fill cap → delete → reappear infinite loop', 6000.0)
) as t(title, notes, rank);

-- 86. [Library] Library selection & drag-drop organization
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Library] Library selection & drag-drop organization',
         'Multi-select (click, shift-click, rubber-band) plus drag-drop reorganization: images between groups, groups between batches, and toolbar actions for grouping/moving/merging.

Subsystem: Library, batches, persistence & data-integrity machinery
Atlas status at seed: done

Wiring:
• writes: products.batch_id and product_images.product_id directly (bypasses workflow_state, resynced by scrub helpers on delete paths)
• feeds: onBatchDeleted for each bulk-deleted batch
• falls back to: full loadAll reload when a background DB write fails

[seeded: feature-atlas 2026-07-19]',
         true,
         86000,
         now()
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'done'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Library] Library selection & drag-drop organization'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'done', t.rank, now()
from new_card nc
cross join (values
  ('Rubber-band selection', 'Threshold-gated box select per tab grid, viewport-corrected for scroll, suppressed during native drags', 1000.0),
  ('Selection toolbar', 'Clear / Select All / Delete Selected plus per-tab actions (groups: Move to Batch, New Batch from Selection, Merge Groups; images: Add to Group, Create New Group)', 2000.0),
  ('Multi-image drag', 'Dragging a selected image carries all selected ids with a count-badge drag ghost', 3000.0),
  ('Drop image onto group', 'Optimistic local update + background product_id UPDATE; duplicate URLs in target deleted instead of moved; ''no-group'' target ungroups', 4000.0),
  ('Drop group onto batch', 'Optimistic batch reassignment + products.batch_id UPDATE; ''no-batch'' unassigns', 5000.0),
  ('Merge Groups', 'Moves unique images to the primary product, deletes URL-duplicates, retitles primary, deletes emptied secondaries (saved groups only)', 6000.0),
  ('Same-type reorder', 'Card drag reorder within a tab is local-state only (not persisted)', 7000.0),
  ('Bulk delete', 'Per-type loop with progress; batches path only removes confirmed deletes and reports RLS-blocked failures', 8000.0)
) as t(title, notes, rank);

-- 87. [Library] Batch repair (legacy storagePath recovery)
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Library] Batch repair (legacy storagePath recovery)',
         'Wrench button on batches whose workflow_state items lack storagePath (blob-URL era): scans Storage under userId/itemId/ to recover paths and patches workflow_state back to the DB.

Subsystem: Library, batches, persistence & data-integrity machinery
Atlas status at seed: done

Wiring:
• enables: URL reconstruction everywhere (restore, Library, exports) that depends on storagePath
• feeds: loadAll refresh after repair

[seeded: feature-atlas 2026-07-19]',
         false,
         87000,
         now()
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'done'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Library] Batch repair (legacy storagePath recovery)'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'done', t.rank, now()
from new_card nc
cross join (values
  ('needsRepair detection', 'Any workflow_state item missing storagePath flags the batch', 1000.0),
  ('Storage scan', 'Per-item storage.list(userId/itemId) picks the first real file, skipping .emptyFolderPlaceholder', 2000.0),
  ('State patch', 'All four workflow_state arrays rebuilt with recovered paths; recovered/not-found tally alerted', 3000.0)
) as t(title, notes, rank);

-- 88. [Library] Batch lifecycle creation at upload
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Library] Batch lifecycle creation at upload',
         'Persistence side of Step 1: batch UUID minted synchronously at upload start, stub workflow_batches row pre-inserted exactly once so auto-save''s blind UPDATE always lands, and stub products/product_images rows written immediately for Library visibility.

Subsystem: Library, batches, persistence & data-integrity machinery
Atlas status at seed: done

Wiring:
• triggered by: ImageUpload Step 1 callbacks (onUploadStart/onChunkReady/onImagesUploaded)
• feeds: auto-save (row must exist for blind UPDATE), Library imageList Pass 2
• depends on: imageRowSync buildProductImageRow + stage4 probe

[seeded: feature-atlas 2026-07-19]',
         false,
         88000,
         now()
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'done'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Library] Batch lifecycle creation at upload'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'done', t.rank, now()
from new_card nc
cross join (values
  ('Synchronous id mint', 'handleUploadStart/handleChunkReady mint currentBatchId + localStorage before the first chunk write', 1000.0),
  ('Stub row pre-insert', 'batchRowInsertedRef guards a single workflow_batches INSERT per upload session (fixes the duplicate-batch fork from two 0-row UPDATEs)', 2000.0),
  ('Immediate stub DB writes', 'products upsert (ignoreDuplicates on id) + product_images upsert on (product_id,image_url) via the shared Stage 4 row builder — best-effort; registerItemsInDB stays authoritative', 3000.0)
) as t(title, notes, rank);

-- 89. [Library] One-time orphan product_images cleanup
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Library] One-time orphan product_images cleanup',
         'Once-per-browser effect (localStorage key sortbot_orphan_cleanup_v3) that deletes product_images rows from three known-broken upload sessions whose storage_path timestamps never had real files.

Subsystem: Library, batches, persistence & data-integrity machinery
Atlas status at seed: done

Wiring:
• triggered by: user login (useEffect [user])
• prevents: perpetual 400s in the Library gallery from rows with no backing file

[seeded: feature-atlas 2026-07-19]',
         false,
         89000,
         now()
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'done'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Library] One-time orphan product_images cleanup'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'done', t.rank, now()
from new_card nc
cross join (values
  ('Prefix-targeted delete', 'DELETE ... LIKE %prefix% for bad timestamp prefixes 17796956/17796957/17796974', 1000.0),
  ('Versioned localStorage gate', 'Runs once per browser per version key, silent on error', 2000.0)
) as t(title, notes, rank);

-- 90. [Library] Product/image fetch layer (fetchSavedProducts, fetchSavedImages, fetchUserProducts, getThumbnailUrl)
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Library] Product/image fetch layer (fetchSavedProducts, fetchSavedImages, fetchUserProducts, getThumbnailUrl)',
         'Shared-workspace fetchers with 1000-row pagination (PostgREST cap bypass) joining batches/products/images, plus the plain-CDN thumbnail URL helper (no paid transform API).

Subsystem: Library, batches, persistence & data-integrity machinery
Atlas status at seed: done

Wiring:
• consumed by: Library loadAll Phase 2, deriveLibraryData inputs
• getThumbnailUrl consumed by: startup restore, handleOpenBatch, ImageGrouper card rendering

[seeded: feature-atlas 2026-07-19]',
         true,
         90000,
         now()
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'done'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Library] Product/image fetch layer (fetchSavedProducts, fetchSavedImages, fetchUserProducts, getThumbnailUrl)'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'done', t.rank, now()
from new_card nc
cross join (values
  ('Paginated range() loops', 'fetchSavedProducts/fetchSavedImages page 1000 rows until short page; return partial results on mid-loop error', 1000.0),
  ('No user_id filters', 'RLS decides visibility — shared-workspace pattern, deliberately unfiltered', 2000.0),
  ('AbortError/network tolerance', 'StrictMode aborts and offline errors return [] silently', 3000.0),
  ('getThumbnailUrl', 'Plain public CDN URL from storagePath (transform params intentionally omitted on free tier)', 4000.0)
) as t(title, notes, rank);

-- 91. [Accounts] Email/password authentication
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Accounts] Email/password authentication',
         'Supabase email/password sign-in and sign-up screen with outage-aware error handling.

Subsystem: Auth, landing/beta gate, multi-org tenancy, admin panels
Atlas status at seed: done

Wiring:
• triggered by: Landing page ''Log in'' button (App.tsx showLogin state, with an inline ← Back button)
• feeds: App.tsx onAuthStateChange → session restore, batch restore, and org bootstrap (ensureOrganization)
• depends on: Supabase Auth (email/password)

[seeded: feature-atlas 2026-07-19]',
         false,
         91000,
         now()
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'done'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Accounts] Email/password authentication'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'done', t.rank, now()
from new_card nc
cross join (values
  ('Sign in / sign up toggle', 'Single form flips between modes; signup shows ''check your email to verify'' message; min 6-char password.', 1000.0),
  ('Outage detection', '502/503/504/''failed to fetch'' errors show a ''Supabase is temporarily unreachable'' banner with a status.supabase.com link instead of blaming credentials.', 2000.0),
  ('No-AI copy header', 'Header copy ''From camera roll to Shopify-ready listings'' per the user''s no-AI-wording rule.', 3000.0)
) as t(title, notes, rank);

-- 92. [Accounts] Public marketing landing page
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Accounts] Public marketing landing page',
         'Marketing front door rendered at the main URL for logged-out visitors, with pricing tiers and a beta-access request form.

Subsystem: Auth, landing/beta gate, multi-org tenancy, admin panels
Atlas status at seed: done

Wiring:
• triggered by: App.tsx when !user && !showLogin (logged-in users skip it via session restore)
• feeds: beta_signups table → beta gate + OrgPanel beta approvals
• feeds: Auth screen via onLoginClick → setShowLogin(true)

[seeded: feature-atlas 2026-07-19]',
         true,
         92000,
         now()
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'done'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Accounts] Public marketing landing page'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'done', t.rank, now()
from new_card nc
cross join (values
  ('Hero + stats strip + 4-panel tour', 'CSS-mockup ''screenshots'' of grouping toolbar, presets, voice fields, and CSV export (swap for PNGs in public/screenshots/ later).', 1000.0),
  ('Pricing tiers section', 'Starter $49 / Pro $129 (featured) / Studio $299 with per-tier founding-shop 30%-off-for-life chips, overage and annual notes.', 2000.0),
  ('Labor-math + founding-shop incentives', 'Time/cost-saved sections selling the beta (free during beta, direct line, team invites, CSV data portability).', 3000.0),
  ('Beta signup form', 'Inline handler validates shop/name/email then inserts into beta_signups via requestBetaAccess; duplicate email (23505) treated as success.', 4000.0),
  ('px-based stylesheet', 'Landing.css sets font-size:16px and uses px throughout so the app''s 9px root font cannot shrink it; copy rules: no emojis, no ''AI'', no dashes.', 5000.0),
  ('beta.html redirect', 'public/beta.html is a meta-refresh redirect to the main URL (replaced the old standalone Vite entry).', 6000.0)
) as t(title, notes, rank);

-- 93. [Accounts] Private beta waitlist gate
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Accounts] Private beta waitlist gate',
         'Full-screen gate for signed-in users with no workspace whose beta request is not approved; replaces the dashboard entirely.

Subsystem: Auth, landing/beta gate, multi-org tenancy, admin panels
Atlas status at seed: done

Wiring:
• triggered by: ensureOrganization step 4 returning { mode: ''waitlist'' } (never for existing members or invitees)
• depends on: beta_signups table + own-row SELECT RLS (anon INSERT pending-only)
• consumed by: OrgPanel Beta tab approvals — approval causes workspace auto-creation (plan=''beta'', requested shop name) on the user''s next sign-in

[seeded: feature-atlas 2026-07-19]',
         true,
         93000,
         now()
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'done'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Accounts] Private beta waitlist gate'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'done', t.rank, now()
from new_card nc
cross join (values
  ('Three states', '''none'' shows an in-app request form (shop + name; email from session), ''pending'' shows on-the-list copy, ''denied'' shows at-capacity copy.', 1000.0),
  ('In-app beta request', 'requestBetaAccess insert; success flips the screen to pending via onRequested without a reload.', 2000.0),
  ('Forward-compatible skip', 'getMyBetaSignup returns ''unavailable'' when beta_signups.sql hasn''t run → gate skipped, new users get a workspace immediately.', 3000.0),
  ('Sign out escape hatch', 'Sign out (email) button so gated users aren''t trapped.', 4000.0)
) as t(title, notes, rank);

-- 94. [Accounts] Workspace panel — members, invites, rename, leave
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Accounts] Workspace panel — members, invites, rename, leave',
         'OrgPanel Members tab: full member/invite management for the current workspace with role controls and inline two-step confirms.

Subsystem: Auth, landing/beta gate, multi-org tenancy, admin panels
Atlas status at seed: done

Wiring:
• triggered by: WorkspaceMenu ''Workspace dashboard'' item (App showOrgPanel)
• feeds: ensureOrganization step 2 consumes the invites created here
• depends on: org_members/org_invites tables + is_org_admin RLS (multi_org_tenancy.sql)

[seeded: feature-atlas 2026-07-19]',
         true,
         94000,
         now()
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'done'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Accounts] Workspace panel — members, invites, rename, leave'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'done', t.rank, now()
from new_card nc
cross join (values
  ('Member list with expandable detail', 'Chevron/email click expands to lazily-fetched activity (batches/products created, last active via fetchMemberActivity) and, for founding admins, the member''s matching beta application.', 1000.0),
  ('Role management', 'Owner/Admin/Member dropdown (owner option visible to owners only) with a client-side last-owner guard; self-changes sync App via onMyRoleChanged.', 2000.0),
  ('Remove member', 'Inline two-step Confirm/Cancel (no native confirm() per Do-Not #12).', 3000.0),
  ('Email invites', 'Invite by email + role; invitee auto-joins on next sign-in; copy-invite-message-to-clipboard button (no email is sent automatically); revoke invite.', 4000.0),
  ('Workspace rename', 'Inline pencil-edit with 60-char cap; RLS-blocked update (0 rows) surfaces a permission error; onOrgUpdated refreshes the header.', 5000.0),
  ('Leave workspace', 'Blocked for the last owner and the only member; success fires onLeftWorkspace → App full reload to re-bootstrap into the next org/waitlist.', 6000.0)
) as t(title, notes, rank);

-- 95. [Accounts] Listing description format settings
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Accounts] Listing description format settings',
         'OrgPanel Settings tab editor for the per-workspace description_settings JSONB controlling how Step 3 generates listing text.

Subsystem: Auth, landing/beta gate, multi-org tenancy, admin panels
Atlas status at seed: done

Wiring:
• feeds: onDescriptionSettingsChanged → App orgDescSettings → ProductDescriptionGenerator descriptionSettings prop → textAIService.generateProductDescription
• feeds: resolvedVendorName in App → GoogleSheetExporter CSV Vendor column
• feeds: proseEnabled gates proseService/generate-prose Edge Function calls in Step 3
• depends on: organizations table UPDATE RLS (org admins) + description_settings JSONB column

[seeded: feature-atlas 2026-07-19]',
         true,
         95000,
         now()
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'done'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Accounts] Listing description format settings'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'done', t.rank, now()
from new_card nc
cross join (values
  ('Editable fields', 'Vendor name (CSV Vendor column — the seller, not the garment brand), measurement symbol (default ✠), garment prep line, closing line, disclaimer lines (one per line), include-#hashtags toggle.', 1000.0),
  ('Prose paragraph opt-in', 'proseEnabled checkbox (off by default) + proseStyle voice-notes textarea gating the model-written selling paragraph (generate-prose Edge Function); UI copy says ''language model'', never ''AI''.', 2000.0),
  ('Load-once semantics', 'Settings load once per org open (not on action reloads) so unsaved edits survive other panel actions; Save/Reset-to-defaults buttons.', 3000.0),
  ('Byte-identical defaults', 'Missing column/row/keys resolve to DEFAULT_DESCRIPTION_SETTINGS matching the old hardcoded output (locked by golden test); 42703 gives a friendly ''migration not run'' error.', 4000.0)
) as t(title, notes, rank);

-- 96. [Accounts] Beta program admin (approvals + workspace directory)
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Accounts] Beta program admin (approvals + workspace directory)',
         'OrgPanel Beta tab for Founding Workspace admins: the beta request queue plus an aggregate directory of every workspace.

Subsystem: Auth, landing/beta gate, multi-org tenancy, admin panels
Atlas status at seed: done

Wiring:
• gated by: isBetaAdmin (org.slug===''founding'' + admin role client-side; is_beta_admin() server-side)
• consumed by: ensureOrganization — an approved signup causes the requester''s workspace to be auto-created on next sign-in with plan=''beta''
• fed by: Landing signup form and WaitlistGate in-app request
• feeds: OrgPanel Users tab move/add destination dropdowns (org name map)

[seeded: feature-atlas 2026-07-19]',
         true,
         96000,
         now()
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'done'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Accounts] Beta program admin (approvals + workspace directory)'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'done', t.rank, now()
from new_card nc
cross join (values
  ('Request queue', 'Pending-first sorted list with filter chips (pending/approved/denied/all + counts), search across name/email/store, and request metadata (store URL, volume/wk, notes, requested/reviewed dates).', 1000.0),
  ('Approve / Deny / Reopen / Delete', 'Approve stamps reviewer; deny shows ''at capacity'' to the user; reopen clears the review stamp (does NOT remove an already-created workspace); delete has a two-step confirm for spam/dupes.', 2000.0),
  ('Welcome mailto', 'Mail button composes a pre-filled welcome email with the app URL for approved shops.', 3000.0),
  ('Beta workspaces directory', 'beta_org_directory() SECURITY DEFINER RPC returns aggregates only per org (plan badge, member count + emails, batch/product/image counts, created/last-active) — never tenant data; hides pre-migration or for non-admins.', 4000.0)
) as t(title, notes, rank);

-- 97. [Accounts] Vocabulary dashboard — quick keyword chips tab
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Accounts] Vocabulary dashboard — quick keyword chips tab',
         'Founder-only CRUD for the global descriptor_chips table that renders as Step 3 quick-keyword chips in every workspace.

Subsystem: Auth, landing/beta gate, multi-org tenancy, admin panels
Atlas status at seed: done

Wiring:
• consumed by: ProductDescriptionGenerator Step 3 chips via fetchActiveChips (falls back to hardcoded DESCRIPTOR_KEYWORDS when table missing/empty)
• gated by: App renders the Vocabulary button/modal only for founding owners/admins; is_beta_admin() RLS enforces writes; all workspaces read
• depends on: wordsRelated/termMatchesChip shared matching so dashboard coverage agrees with Step 3 suggestions

[seeded: feature-atlas 2026-07-19]',
         false,
         97000,
         now()
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'done'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Accounts] Vocabulary dashboard — quick keyword chips tab'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'done', t.rank, now()
from new_card nc
cross join (values
  ('Chip CRUD', 'Add/edit label vs output_text (blank output inserts the label), on/off toggle (hide without deleting), two-step delete, search.', 1000.0),
  ('Brand-keyword coverage view', 'Every distinct word across edited + built-in brand entries with usage counts, covered/uncovered against active chips (termMatchesChip loose matching), and a one-click ''make chip'' promote button.', 2000.0)
) as t(title, notes, rank);

-- 98. [Accounts] Vocabulary dashboard — brand keywords tab
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Accounts] Vocabulary dashboard — brand keywords tab',
         'Founder-only CRUD for brand→keywords rows merged into generated tags whenever an item''s brand matches, layered over a built-in 917-brand library.

Subsystem: Auth, landing/beta gate, multi-org tenancy, admin panels
Atlas status at seed: done

Wiring:
• consumed by: PDG Generate path (getBrandTerms → brandTerms merged into tags/#hashtags in textAIService) and Step 3 brand-suggested chip ordering
• consumed by: getAllBrandKeywordEntries session cache → Step 3 tangential word-association chip suggestions
• feeds: chips-tab coverage view word universe

[seeded: feature-atlas 2026-07-19]',
         true,
         98000,
         now()
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'done'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Accounts] Vocabulary dashboard — brand keywords tab'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'done', t.rank, now()
from new_card nc
cross join (values
  ('Brand row CRUD', 'Add/edit brand + comma-separated keywords (parseKeywordList dedup/lowercase), on/off toggle (disabled edited row = ''off'', no built-in fallback), delete confirm.', 1000.0),
  ('Built-in library section', '917-brand BRAND_DNA distillation rendered read-only with one-click copy-to-editable and a ''customized'' badge; lazy-loaded as its own ~361 KB chunk.', 2000.0),
  ('Paginated fetch', 'fetchAllBrandKeywords pages past PostgREST''s 1000-row cap so the imported library never truncates.', 3000.0),
  ('Precedence rule', 'getBrandTerms: edited row always wins (even disabled); no row → built-in library fallback via dynamic import.', 4000.0)
) as t(title, notes, rank);

-- 99. [Accounts] Header workspace/account menu
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Accounts] Header workspace/account menu',
         'Consolidated account control at the right of the header showing the workspace name with a dropdown for identity, dashboard, and sign-out.

Subsystem: Auth, landing/beta gate, multi-org tenancy, admin panels
Atlas status at seed: done

Wiring:
• triggered by: App header (replaced the old workspace-button + email + Sign Out trio)
• feeds: OrgPanel open (showOrgPanel) and handleSignOut (clears user, org, item arrays, batch localStorage keys)
• depends on: ensureOrganization result for org name/role

[seeded: feature-atlas 2026-07-19]',
         false,
         99000,
         now()
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'done'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Accounts] Header workspace/account menu'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'done', t.rank, now()
from new_card nc
cross join (values
  ('Identity block', 'Org name (or ''Account'' in legacy mode), role badge, email inside the dropdown.', 1000.0),
  ('Workspace dashboard entry', 'Menu item opens OrgPanel; hidden entirely in legacy mode (no org resolved).', 2000.0),
  ('Dismissal', 'Click-outside and Escape close the dropdown.', 3000.0)
) as t(title, notes, rank);

-- 100. [Accounts] App auth/workspace routing shell
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Accounts] App auth/workspace routing shell',
         'App.tsx state-driven gate ordering: loading → Landing → Auth → WaitlistGate → dashboard, plus role-gated admin entry points.

Subsystem: Auth, landing/beta gate, multi-org tenancy, admin panels
Atlas status at seed: done

Wiring:
• orchestrates: Auth, Landing, WaitlistGate, WorkspaceMenu, OrgPanel, VocabDashboard, KanbanBoard mounting
• feeds: orgDescSettings → PDG descriptionSettings prop; resolvedVendorName (settings vendorName → ''C&D Vintage'' for founding → workspace name) → GoogleSheetExporter
• depends on: Supabase auth session restore and orgService/betaService fail-soft contracts

[seeded: feature-atlas 2026-07-19]',
         true,
         100000,
         now()
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'done'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Accounts] App auth/workspace routing shell'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'done', t.rank, now()
from new_card nc
cross join (values
  ('Front-door routing', '!user renders Landing unless showLogin (then Auth with ← Back); betaWaitlist state renders WaitlistGate full-screen instead of the dashboard.', 1000.0),
  ('Org bootstrap effect', 'ensureOrganization runs once per user.id; ''org'' mode also fetches description settings; ''legacy'' leaves currentOrg null so no org UI renders.', 2000.0),
  ('Founding-only header buttons', 'Vocabulary button (founding owners/admins) and Board button (all founding members) render conditionally; modals double-check the same gates.', 3000.0),
  ('Sign-out cleanup', 'Clears user/org/panel state, all four item arrays, and batch localStorage keys.', 4000.0)
) as t(title, notes, rank);

-- 101. [Infra] Service Worker image cache
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Infra] Service Worker image cache',
         'public/sw.js intercepts all Supabase Storage product-image GETs and serves them stale-while-revalidate with a 7-day TTL, defeating the free-tier Cache-Control: no-cache header that forced ~800 revalidations per refresh.

Subsystem: Infrastructure, performance, debug, dead/unwired code
Atlas status at seed: done

Wiring:
• depends on: Supabase Storage public CDN URLs (the only intercepted host path)
• consumed by: every image render — LazyImg, ImageGrouper bare <img> tags, Library thumbnails, Step 3 preview
• cooperates with: LazyImg retry cache-bust (strips ?t so retries do not inflate the cache)
• depends on: GitHub Pages deploy base path via import.meta.env.BASE_URL (vite.config.ts)

[seeded: feature-atlas 2026-07-19]',
         true,
         101000,
         now()
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'done'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Infra] Service Worker image cache'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'done', t.rank, now()
from new_card nc
cross join (values
  ('Scoped interception', 'Only GET requests matching /storage/v1/object/public/product-images/ are handled; API/auth/JS/CSS pass through', 1000.0),
  ('Stale-while-revalidate', 'Cache hit returns instantly plus fire-and-forget background refresh; miss fetches network then stores', 2000.0),
  ('TTL via injected header', 'x-sw-cached-at timestamp stamped on store; entries >7 days fall through to network; cache-control rewritten to max-age', 3000.0),
  ('Cache-bust normalization', 'stripCacheBust removes the ?t= param LazyImg adds on retries so retries share one cache key', 4000.0),
  ('Pruning', 'Old cache versions and expired entries deleted on activate (pruneOldCaches/pruneExpiredEntries)', 5000.0),
  ('Offline fallback', 'On network error a stale cached copy is returned rather than failing', 6000.0),
  ('Immediate takeover', 'skipWaiting + clients.claim so a new SW controls open tabs without reload', 7000.0),
  ('Base-path-aware registration', 'main.tsx registers ${BASE_URL}sw.js with matching scope so it works at / locally and /sortbot/ on Pages; registration failure is non-fatal', 8000.0)
) as t(title, notes, rank);

-- 102. [Infra] LazyImg retry/backoff image component
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Infra] LazyImg retry/backoff image component',
         'src/components/LazyImg.tsx renders a shimmer skeleton, then the image, retrying failed loads 3x with exponential backoff (500/1500/4500ms) and a ?t= cache-bust to escape broken QUIC sessions; grey placeholder after exhaustion.

Subsystem: Infrastructure, performance, debug, dead/unwired code
Atlas status at seed: done

Wiring:
• feeds: debug logger [Img] category (logs each retry attempt and final failure)
• cooperates with: Service Worker cache (its ?t bust is stripped to a shared cache key)
• consumed by: CategoryZones, ProductDescriptionGenerator, and the dead SavedProducts/ImageSorter components
• depends on: Supabase Storage CDN URLs reconstructed from storagePath by restore paths

[seeded: feature-atlas 2026-07-19]',
         true,
         102000,
         now()
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'done'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Infra] LazyImg retry/backoff image component'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'done', t.rank, now()
from new_card nc
cross join (values
  ('Skeleton shimmer + fade-in', 'lazy-skeleton div shown until onLoad; error state shows lazy-skeleton--error grey placeholder', 1000.0),
  ('Exponential retry with cache-bust', '500*3^(n-1) ms delays; each retry appends ?t=Date.now() to force a fresh request off the broken connection', 2000.0),
  ('Deliberate no-DB-delete-on-error', 'Explicit comment: transient <img> errors must never delete product_images rows (previous behavior destroyed data)', 3000.0),
  ('Perf attributes', 'loading=lazy default, decoding=async, retry timer cleanup on unmount, full state reset when src prop changes', 4000.0),
  ('retryImg twin for bare imgs', 'ImageGrouper uses a data-retry DOM-attribute helper with the same 3x backoff strategy on its two bare <img> tags', 5000.0)
) as t(title, notes, rank);

-- 103. [Infra] Centralized debug logger + DOM instrumentation
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Infra] Centralized debug logger + DOM instrumentation',
         'src/lib/debugLogger.ts provides dbg()/log.X() color-coded console logging that is a zero-cost no-op unless window.__SORTBOT_DEBUG__ is true, plus full-page DOM event capture when enabled.

Subsystem: Infrastructure, performance, debug, dead/unwired code
Atlas status at seed: done

Wiring:
• consumed by: ~20 files — App, Library, ImageGrouper, ImageUpload, PDG, CategoryZones, KanbanBoard, LazyImg, and nearly every lib service (workflowBatchService, orgService, kanbanService, vocabService, proseService, etc.)
• triggered by: 🐛 button in App.tsx or window.__SORTBOT_DEBUG__ = true in DevTools
• known gap: ~100 raw console.log calls have crept back in outside this system (CLAUDE.md Known Bugs #15)

[seeded: feature-atlas 2026-07-19]',
         true,
         103000,
         now()
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'done'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Infra] Centralized debug logger + DOM instrumentation'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'done', t.rank, now()
from new_card nc
cross join (values
  ('13 color-coded categories', 'App/Library/Grouper/Upload/PDG/Sorter/Service/DB/Auth/DOM/Img/Kanban/Error each with a hex badge color, HH:MM:SS.mmm timestamp, collapsed data groups', 1000.0),
  ('Zero-cost guard', 'First line of dbg() returns if window.__SORTBOT_DEBUG__ is falsy — safe to leave call sites in production', 2000.0),
  ('localStorage persistence', 'sortbot_debug_enabled key restores the toggle across reloads; listeners auto-attach at module load if previously on', 3000.0),
  ('Global DOM listeners', 'click/dblclick/contextmenu/mousedown/up/move, keydown/up, full dragstart→dragend cycle, drop, scroll (capture), selectionchange, focusin/out, input, change — mousemove/scroll throttled to 100ms', 4000.0),
  ('Toggle API + UI button', 'setDebugEnabled()/isDebugEnabled(); App.tsx renders a fixed bottom-left 🐛 Bug button (amber on, grey off) wired to it', 5000.0),
  ('Clean detach', 'All listeners tracked in an array and removed on disable', 6000.0)
) as t(title, notes, rank);

-- 104. [Infra] GitHub Pages CI/CD deploy
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Infra] GitHub Pages CI/CD deploy',
         '.github/workflows/deploy.yml builds (tsc -b + vite) and deploys dist/ to GitHub Pages at gerbriel.github.io/sortbot on every push to main, with the Vite base path switched by process.env.GITHUB_ACTIONS.

Subsystem: Infrastructure, performance, debug, dead/unwired code
Atlas status at seed: done

Wiring:
• feeds: Service Worker registration scope and asset URLs via import.meta.env.BASE_URL
• depends on: npm run build passing (tsc -b — the §17 zero-type-error gate)
• constrains: huggingfaceService/local proxy (localhost:3001 unreachable from Pages — why vision AI is dead in prod)
• consumed by: production users at https://gerbriel.github.io/sortbot

[seeded: feature-atlas 2026-07-19]',
         true,
         104000,
         now()
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'done'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Infra] GitHub Pages CI/CD deploy'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'done', t.rank, now()
from new_card nc
cross join (values
  ('Triggers', 'push to main + manual workflow_dispatch; pages concurrency group with cancel-in-progress: false', 1000.0),
  ('Build env from GitHub Secrets', 'VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_STORAGE_LIMIT_GB injected at build; inline comment forbids server-side secrets since Vite inlines all VITE_* into the public bundle', 2000.0),
  ('Toolchain', 'Node 24, npm ci, npm run build (type-check gate), actions/configure-pages + upload-pages-artifact + deploy-pages v4', 3000.0),
  ('Base path switch', 'vite.config.ts sets base: ''/sortbot/'' under GITHUB_ACTIONS, ''/'' locally; sourcemaps off', 4000.0),
  ('beta.html redirect stub', 'public/beta.html meta-refresh + location.replace redirect preserving old landing-page links to the main URL', 5000.0)
) as t(title, notes, rank);

-- 105. [Infra] Vitest characterization test suite
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Infra] Vitest characterization test suite',
         '16 co-located *.test.ts files (happy-dom, dummy Supabase env vars injected so supabase.ts constructs offline) lock in the behaviors the workflow depends on — voice/title engine, CSV golden file, preset hierarchy, Library derivation, save→reload contract, grouping conventions, kanban math.

Subsystem: Infrastructure, performance, debug, dead/unwired code
Atlas status at seed: done

Wiring:
• locks in: CSV export, voice/title engine, preset apply, Library loadAll derivation, slim() save→reload contract, Step 2/3 grouping, kanban board — regression fence for the whole pipeline
• depends on: vitest.config.ts dummy env vars (src/lib/supabase.ts throws at import without them); tests never hit the network
• gates: §17 ''npm test'' must pass before any task is marked done; snapshots in src/lib/__snapshots__ updated only deliberately with -u

[seeded: feature-atlas 2026-07-19]',
         true,
         105000,
         now()
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'done'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Infra] Vitest characterization test suite'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'done', t.rank, now()
from new_card nc
cross join (values
  ('textAIService tests', 'Size normalization (letter symbols, OSFA, fits-like note keep/strip/idempotency), voice command + description-period extraction, 60-char titles, per-group synonym swap lock, description settings, prose paragraph render, brandTerms tag merge, golden description snapshot (Math.random mocked)', 1000.0),
  ('csvExport tests + golden CSV', '54-header shape, extra-image rows, handle -2/-3 dedup, compare-at rule, fits-like strip in metafields/alt, taxonomy resolution (gendered/kids/unknown-blank), Vendor=seller-not-brand, preset shopifyProductType routing, per-store GID overrides with alias resolution and no-foreign-fallback, escapeCsvValue, full two-product golden file', 2000.0),
  ('applyPresetToGroup tests', 'Priority hierarchy (voice wins, preset fills gaps, force-mode resets), SEO template interpolation + token stripping, weight→grams conversion, preset vendor never becomes brand, suggested_price_max as compare-at fallback', 3000.0),
  ('grouping tests', 'Leader-id AND fresh-UUID group conventions both resolve, the 42-image/11-group bug reproduction, stale foreign refs stay singletons, Step-3 visibility filter (hides uncategorized singles), no input mutation', 4000.0),
  ('libraryData tests', 'Two-pass imageList: URL reconstruction from storagePath, dedup by product_id regardless of batch_id (8643c5d), gap-fill of partial workflow_state (69dd319), legacy no-state path, batch synthesis, newest-first sort, unassigned-row rules', 5000.0),
  ('slimItems tests', 'The save→reload whitelist contract: preserved fields exact-match, file/preview/_presetData/DB-recoverable text proven stripped, JSON-serializability; ultraSlim 7-field backup', 6000.0),
  ('imageRowSync tests', 'Stage-4 dual-write gating: new columns omitted pre-migration, included + nulled-for-legacy post-migration; buildTransforms null-for-untouched', 7000.0),
  ('workflowStore + tombstone tests', 'Live getState/liveArrayRef semantics inside async callbacks (ref-mirror replacement), subscriber lifecycle, reset; deleted-batch tombstones with localStorage persistence and 200 cap', 8000.0),
  ('proseService tests', 'Model-output validation: 15-120 words, banned phrases/AI tells, no hashtags/links, numbers guard (digits must exist in facts)', 9000.0),
  ('kanban math tests', 'rankBetween/computeDropRank (incl. the moving-down off-by-one), rebalance guard, tree building with orphan promotion and cycle survival, leaf-based progress, done-lane completion stamping, date status (completed-never-overdue)', 10000.0)
) as t(title, notes, rank);

-- 106. [Infra] Orphaned-storage cleanup script
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Infra] Orphaned-storage cleanup script',
         'scripts/cleanup-orphaned-storage.mjs is an interactive one-shot Node script that diffs the product-images bucket against product_images rows AND all workflow_state imageUrls, then confirm-deletes unreferenced files in chunks of 100.

Subsystem: Infrastructure, performance, debug, dead/unwired code
Atlas status at seed: done

Wiring:
• protects: Auto-save workflow_state references (uploads mid-session live only there)
• complements: in-app storageSafety.ts filterUnreferencedStoragePaths guard for shared files
• depends on: hardcoded Supabase URL/anon key and app credentials — not part of the Vite build

[seeded: feature-atlas 2026-07-19]',
         true,
         106000,
         now()
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'done'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Infra] Orphaned-storage cleanup script'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'done', t.rank, now()
from new_card nc
cross join (values
  ('Interactive auth', 'Prompts for app email/password since storage.remove() needs an authenticated RLS session', 1000.0),
  ('Full bucket walk', 'Lists userId top-level product-UUID folders then files inside each', 2000.0),
  ('Paginated DB reference set', 'product_images storage_path fetched 1000/page to dodge URL-length limits', 3000.0),
  ('In-flight batch protection', 'workflow_batches.workflow_state imageUrls parsed into knownPaths so images not yet in product_images survive (commit a4b452d)', 4000.0),
  ('Confirm + chunked delete', 'Explicit yes prompt, then remove() in chunks of 100', 5000.0)
) as t(title, notes, rank);

-- 107. [Infra] Shopify taxonomy fetch script
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Infra] Shopify taxonomy fetch script',
         'scripts/fetch-taxonomy.mjs pages the Shopify Admin GraphQL taxonomy (250/page) and prints Apparel/Footwear/Bags/Accessories leaf category fullName + GID pairs for pasting into the CSV exporter maps.

Subsystem: Infrastructure, performance, debug, dead/unwired code
Atlas status at seed: done

Wiring:
• feeds: taxonomy/category maps in src/lib/csvExport.ts (SHOPIFY_CATEGORY_MAP lineage) via manual paste
• depends on: SHOPIFY_STORE/SHOPIFY_ADMIN_TOKEN env vars (same Admin API as the shopify-titles Edge Function)

[seeded: feature-atlas 2026-07-19]',
         false,
         107000,
         now()
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'done'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Infra] Shopify taxonomy fetch script'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'done', t.rank, now()
from new_card nc
cross join (values
  ('Cursor pagination', 'Loops hasNextPage/endCursor over taxonomy.categories', 1000.0),
  ('Leaf + prefix filter', 'Keeps isLeaf nodes whose fullName matches Apparel/Clothing/Footwear/Shoes/Bags/Luggage/Accessories', 2000.0)
) as t(title, notes, rank);

-- 108. [Infra] Shopify metaobject GID fetch script
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Infra] Shopify metaobject GID fetch script',
         'scripts/fetch-metaobject-gids.mjs prints color-pattern/fabric/target-gender metaobject GID maps (with grey/camo/tiedye aliases) formatted as TS literals for pasting into the exporter.

Subsystem: Infrastructure, performance, debug, dead/unwired code
Atlas status at seed: done

Wiring:
• feeds: hardcoded founding-store GID maps in src/lib/csvExport.ts via manual paste
• superseded per-store by: shopify-titles Edge Function returning live GidOverrides (July 2026) — script remains useful only for the founding store defaults
• depends on: SHOPIFY_STORE/SHOPIFY_ADMIN_TOKEN with read_metaobjects scope

[seeded: feature-atlas 2026-07-19]',
         false,
         108000,
         now()
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'done'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Infra] Shopify metaobject GID fetch script'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'done', t.rank, now()
from new_card nc
cross join (values
  ('Definition filtering', 'Matches shopify--color-pattern / fabric / target-gender type variants among metaobjectDefinitions', 1000.0),
  ('Alias emission', 'Auto-adds grey/camo/tiedye alias lines next to canonical labels', 2000.0)
) as t(title, notes, rank);

-- 109. [Infra] System preset updater script
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Infra] System preset updater script',
         'scripts/update-presets.mjs one-off bulk-updates the all-zeros-user system category_presets rows: forces is_default=true and fills typical_condition/parcel_size from a hardcoded per-category override table (weight-derived fallback).

Subsystem: Infrastructure, performance, debug, dead/unwired code
Atlas status at seed: done

Wiring:
• feeds: category_presets table consumed by applyPresetToGroup/CategoryZones preset apply
• depends on: hardcoded Supabase URL/anon key; RLS must permit the update

[seeded: feature-atlas 2026-07-19]',
         false,
         109000,
         now()
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'done'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Infra] System preset updater script'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'done', t.rank, now()
from new_card nc
cross join (values
  ('Per-category overrides', '~37 category_name → {parcel_size, typical_condition} entries from CSV analysis', 1000.0),
  ('Weight-based parcel fallback', 'parcelSize(lb) tiers Small/Medium/Large/XL when no override', 2000.0)
) as t(title, notes, rank);

-- 110. [Infra] Step 2 render error boundary (GrouperErrorBoundary)
with org as (
  select id from public.organizations where slug = 'founding'
),
new_card as (
  insert into public.kanban_cards (org_id, column_id, title, notes, is_epic, rank, completed_at)
  select org.id, col.id,
         '[Infra] Step 2 render error boundary (GrouperErrorBoundary)',
         'Class-based React error boundary wrapping ImageGrouper + CategoryZones: catches render errors, shows the message with a please-report banner and a Retry button that re-mounts the grouper without losing app state. CLAUDE.md §16 still lists error boundaries as missing — doc drift.

Subsystem: Infrastructure, performance, debug, dead/unwired code
Atlas status at seed: done

Wiring:
• note: contradicts CLAUDE.md §16 Error boundaries Missing (doc drift)
• wraps: Step 2 ImageGrouper + CategoryZones in App.tsx

[seeded: feature-atlas 2026-07-19]',
         false,
         110000,
         now()
  from org
  join public.kanban_columns col
    on col.org_id = org.id and lower(col.name) = 'done'
  where not exists (
    select 1 from public.kanban_cards c
    where c.org_id = org.id and c.title = '[Infra] Step 2 render error boundary (GrouperErrorBoundary)'
  )
  returning id, org_id
)
insert into public.kanban_tasks (org_id, card_id, title, notes, status, rank, completed_at)
select nc.org_id, nc.id, t.title, t.notes, 'done', t.rank, now()
from new_card nc
cross join (values
  ('Catch + report', 'Renders error/stack instead of a white screen', 1000.0),
  ('Retry re-mount', 'Remounts the Step 2 panel, app state intact', 2000.0)
) as t(title, notes, rank);

commit;

-- ── VERIFY (run separately after the seed) ──────────────────────────────────
--   select c.name, count(k.id) cards
--   from public.kanban_columns c
--   left join public.kanban_cards k on k.column_id = c.id
--   where c.org_id = (select id from public.organizations where slug = 'founding')
--   group by c.name, c.rank order by c.rank;
--   -- want: Backlog=9, To do=10, In progress=5, In review=6, Done=110
--   select count(*) from public.kanban_cards
--   where notes like '%[seeded: feature-atlas 2026-07-19]%';   -- want 140

-- ── ROLLBACK (removes ONLY seeded cards; tasks/comments cascade) ────────────
-- delete from public.kanban_cards
-- where notes like '%[seeded: feature-atlas 2026-07-19]%';
