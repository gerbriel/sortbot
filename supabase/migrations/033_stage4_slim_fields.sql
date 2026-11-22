-- ============================================================================
-- STAGE 4 (dual-write phase): give every slim()-preserved field a real column
-- ============================================================================
-- Purely additive; idempotent; safe to run any time. Run in the SQL Editor.
--
-- WHY: workflow_state (the JSONB blob) is today the only home for a handful of
-- fields — so the app defends the blob with heuristics that DELETE data
-- (gap-fill cap, ±24h orphan window, stolen-row cleanup). Stage 4 retires the
-- blob as source of truth. This migration is step one: columns exist, the app
-- dual-writes them (feature-detected — the code ships before this runs and
-- activates itself when the columns appear). After a soak period, reads flip
-- to the relational tables and the heuristics become dead code.
--
-- FIELD → HOME (everything else slim() keeps already has a column):
--   capturedAt          → product_images.captured_at (bigint, Unix ms — exact
--                         roundtrip of the EXIF DateTimeOriginal / file mtime)
--   originalStoragePath → product_images.original_storage_path (pre-crop
--                         original backup; today only in the blob, so the
--                         "revert to original" feature dies for gap-filled items)
--   descriptionEdited   → products.description_edited (user manually edited
--                         the generated description; suppresses regeneration)
--   rotation/crop       → product_images.transforms (column already exists via
--                         20260426_add_transforms_to_product_images.sql; the
--                         app now writes it from EVERY write path, not just
--                         Save Batch)
-- ============================================================================

alter table public.product_images
  add column if not exists captured_at bigint;

alter table public.product_images
  add column if not exists original_storage_path text;

alter table public.products
  add column if not exists description_edited boolean;

comment on column public.product_images.captured_at is
  'Unix ms shot time (EXIF DateTimeOriginal, falling back to file mtime). Stage 4 dual-write.';
comment on column public.product_images.original_storage_path is
  'Storage path of the pre-crop original image, for revert. Stage 4 dual-write.';
comment on column public.products.description_edited is
  'True when the user manually edited the generated description. Stage 4 dual-write.';

-- ── VERIFY (run separately) ─────────────────────────────────────────────────
--   select column_name from information_schema.columns
--   where table_name = 'product_images'
--     and column_name in ('captured_at','original_storage_path','transforms');
--   -- expect 3 rows
--
--   After using the app for a bit (open a batch, upload, Save Batch):
--   select count(*) filter (where captured_at is not null) as with_date,
--          count(*) as total
--   from public.product_images;

-- ── ROLLBACK ────────────────────────────────────────────────────────────────
-- alter table public.product_images drop column if exists captured_at;
-- alter table public.product_images drop column if exists original_storage_path;
-- alter table public.products       drop column if exists description_edited;
