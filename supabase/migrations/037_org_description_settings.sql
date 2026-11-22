-- ============================================================================
-- ORG DESCRIPTION SETTINGS — per-workspace description format preferences
-- ============================================================================
-- Run AFTER multi_org_tenancy.sql. Purely additive; idempotent; rollback below.
--
-- One JSONB column on organizations holding the workspace's description
-- format (measurement symbol, garment-prep line, closing line, disclaimer
-- lines, hashtags on/off — see src/lib/descriptionSettings.ts for the shape
-- and defaults). NULL means "use the defaults", which match today's output
-- exactly, so nothing changes for any workspace until an admin edits it.
--
-- No new RLS needed: organizations SELECT (members) and UPDATE (org admins)
-- policies already cover the column.
-- ============================================================================

alter table public.organizations
  add column if not exists description_settings jsonb;

comment on column public.organizations.description_settings is
  'Per-workspace listing description format (see src/lib/descriptionSettings.ts). NULL = defaults.';

-- ── VERIFY (run separately) ─────────────────────────────────────────────────
--   select name, description_settings from public.organizations;

-- ── ROLLBACK ────────────────────────────────────────────────────────────────
-- alter table public.organizations drop column if exists description_settings;
