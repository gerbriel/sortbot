-- ============================================================================
-- 075_category_presets_custom_sections.sql
-- The column the preset editor has written since March 2026 (ff2d149, "full
-- CRUD for custom sections and fields") and no migration ever created.
-- ============================================================================
-- WHY: CategoryPresetsManager sent `custom_sections` on EVERY create, update
-- and duplicate. No file in supabase/migrations (or the root SQL files) adds
-- it, so PostgREST answers PGRST204 "Could not find the 'custom_sections'
-- column of 'category_presets' in the schema cache" and the whole write fails.
-- That is the bare "Failed to save preset" the owner reported (Nov 2026).
--
-- The client now whitelists columns (CATEGORY_PRESET_COLUMNS in
-- src/lib/categoryPresets.ts) and sends only the changed keys, so ordinary
-- field edits save with or without this file. Only the custom sections and
-- fields editor needs it; until it runs, that editor shows the PGRST204
-- message inline.
--
-- Run AFTER 003 (the table). IDEMPOTENT and additive: one nullable column,
-- no default rewrite, no policy or grant change (031's table-wide grants and
-- org_* policies already cover a new column). Rollback at the bottom.
-- ============================================================================

alter table public.category_presets
  add column if not exists custom_sections jsonb;

comment on column public.category_presets.custom_sections is
  'Editor-defined sections and typed fields (CustomSection[] in src/lib/categoryPresets.ts). NULL = none. 075.';

-- PostgREST caches the schema; reload it so the column is writable at once.
notify pgrst, 'reload schema';

-- ── VERIFY ──────────────────────────────────────────────────────────────────
--   select column_name, data_type from information_schema.columns
--   where table_schema = 'public' and table_name = 'category_presets'
--     and column_name = 'custom_sections';          -- one row, jsonb

-- ── ROLLBACK ────────────────────────────────────────────────────────────────
--   alter table public.category_presets drop column if exists custom_sections;
--   notify pgrst, 'reload schema';
