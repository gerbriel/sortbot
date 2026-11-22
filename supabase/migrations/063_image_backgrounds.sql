-- ============================================================================
-- IMAGE BACKGROUNDS — bookkeeping for the automated cutout + background
--                     replacement pipeline (services/matting).
-- ============================================================================
-- Run AFTER multi_org_tenancy.sql. Purely additive; idempotent (every statement
-- is `add column if not exists` / `create index if not exists`); rollback at the
-- bottom.
--
-- NO NEW TABLE, NO NEW POLICY, NO NEW RLS, NO NEW FUNCTION, NO COLUMN GRANT
-- CHANGE. Nine columns and one partial index on public.product_images, and
-- that is the whole migration. It is deliberately the smallest thing that can
-- work, for two reasons:
--
--   1. product_images is ALREADY org-scoped under multi_org_tenancy.sql —
--      members SELECT and UPDATE their own workspace's rows. That existing
--      grant is exactly what lets the review UI write mask_status='approved'
--      or 'original' from the browser with no new policy, and it is what stops
--      one workspace from seeing another's cutouts. Adding a policy here would
--      only be a second, drifting copy of a rule that already holds.
--   2. The matting SERVICE writes these columns with the service role, which
--      bypasses RLS entirely. Its boundary is therefore NOT a policy — it is
--      the membership check in services/matting/app/auth.py, which proves the
--      caller belongs to the org that owns each requested row before the
--      service role touches anything. A policy here would give a false sense
--      that the database is guarding the service. It is not; the service is.
--
-- WHAT THE COLUMNS ARE FOR
--
--   storage_path            (pre-existing) the ORIGINAL photo. NEVER rewritten
--                           by this pipeline — see the immutability note below.
--   cutout_storage_path     the ALPHA MASTER: a WebP carrying the source RGB
--                           plus a lossless alpha channel. This is the durable
--                           asset. Backgrounds are cheap to regenerate FROM it;
--                           re-deriving it costs a matting call (money, on the
--                           replicate backend). Keep it even when the composite
--                           is thrown away.
--   composite_storage_path  the flat-background JPEG the catalog exports.
--                           Derived, disposable, regenerated whenever the
--                           preset changes.
--   bg_preset               the 8-hex presetHash the composite was built with
--                           (services/matting/CONTRACT.md defines the hash
--                           exactly, with fixed vectors, so the TypeScript and
--                           Python sides provably agree). Comparing this to the
--                           workspace's current preset is how the app knows a
--                           composite is stale WITHOUT re-matting.
--   mask_status             the review lifecycle. NULL means "never processed"
--                           — that is the state of every row that exists today
--                           and the reason the column is nullable rather than
--                           defaulted: a default would retroactively claim
--                           4,800 existing photos are queued for matting.
--                             queued    accepted, not yet processed
--                             auto      matted, scored clean, no human needed
--                             review    matted, but a heuristic flagged it
--                             approved  a human looked and kept the cutout
--                             original  a human rejected it; export the source
--                             failed    the pipeline threw; flags carry why
--   mask_score              0.000-1.000, 1 - (flags / 5). A sort key for the
--                           review queue, not a gate.
--   mask_flags              which heuristics fired ('coverage', 'edge',
--                           'fragments', 'soft', 'contrast', 'error:<reason>').
--                           NOT NULL DEFAULT '{}' so `= '{}'` and `array_length`
--                           are safe everywhere and the app never has to spell
--                           `coalesce(mask_flags, '{}')`.
--   mask_model              which matter produced it, e.g.
--                           'replicate:men1scus/birefnet@f74986db' or
--                           'local:BiRefNet@1024'. Together with bg_preset this
--                           is the whole idempotency key: the service skips a
--                           row whose model AND preset already match.
--   matted_at               when. Distinct from updated_at, which any edit moves.
--
-- IMMUTABILITY (AGENTS.md §18 #35, public/sw.js)
--   Product images are immutable per storage_path: the Service Worker caches
--   them for 7 days on that promise, and re-cropping writes a NEW path rather
--   than overwriting bytes. This pipeline keeps that promise by construction —
--   a cutout and a composite are NEW paths (`cut-<model>-<ms>.webp`,
--   `bg-<presetHash>-<ms>.jpg`) beside the source, and storage_path/image_url
--   are never touched. Nothing here needs cache invalidation, which is the
--   point: the one place in the app that DOES overwrite in place (Step 3's
--   crop) has to call invalidateImageUrl(), and this deliberately does not
--   join it.
--
-- SHARED FILES (AGENTS.md §18 #15)
--   Duplicated batches share storage files, so the service reference-counts a
--   derived path across product_images before deleting a superseded cutout or
--   composite, and fails safe (keeps the file) on any lookup error. Same rule
--   as filterUnreferencedStoragePaths(); it is enforced in the service rather
--   than here because there is no delete path in SQL at all.
-- ============================================================================


-- ── 1. Columns ──────────────────────────────────────────────────────────────

alter table public.product_images
  add column if not exists cutout_storage_path text;

alter table public.product_images
  add column if not exists composite_storage_path text;

alter table public.product_images
  add column if not exists bg_preset text;

alter table public.product_images
  add column if not exists mask_status text;

alter table public.product_images
  add column if not exists mask_score numeric(4,3);

alter table public.product_images
  add column if not exists mask_flags text[] not null default '{}';

alter table public.product_images
  add column if not exists mask_model text;

alter table public.product_images
  add column if not exists matted_at timestamptz;


-- ── 2. The one integrity rule worth having in the database ──────────────────
-- A status outside this set is not a new feature, it is a typo in a service
-- that writes with the service role and therefore has no RLS to catch it. The
-- CHECK is the only thing standing between a bad deploy and a review queue that
-- silently loses rows. NOT VALID is deliberately NOT used: the column is new,
-- so every existing row is NULL and nothing can fail validation.
--
-- Wrapped in a DO block for idempotency — `add constraint if not exists` does
-- not exist for table constraints in Postgres 14.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'product_images_mask_status_check'
      and conrelid = 'public.product_images'::regclass
  ) then
    alter table public.product_images
      add constraint product_images_mask_status_check
      check (mask_status is null or mask_status in
        ('queued', 'auto', 'review', 'approved', 'original', 'failed'));
  end if;
end $$;


-- ── 3. Index ────────────────────────────────────────────────────────────────
-- The review queue asks one question — "which of this batch's photos need a
-- human?" — and the answer is a rounding error of the table. A PARTIAL index
-- on (product_id) where mask_status = 'review' is a few hundred entries against
-- ~4,900 rows today, versus a full index on a column that is NULL for nearly
-- every row. product_id (not id) because the queue is grouped by listing.
create index if not exists product_images_mask_review_idx
  on public.product_images (product_id)
  where mask_status = 'review';


comment on column public.product_images.cutout_storage_path is
  'Alpha master (WebP, lossless alpha) produced by services/matting. Durable — backgrounds regenerate from this without re-matting.';
comment on column public.product_images.composite_storage_path is
  'Flat-background JPEG for export. Derived from the cutout; disposable.';
comment on column public.product_images.bg_preset is
  'The 8-hex presetHash the composite was built with (services/matting/CONTRACT.md). Mismatch with the workspace preset = stale composite.';
comment on column public.product_images.mask_status is
  'queued|auto|review|approved|original|failed. NULL = never processed.';
comment on column public.product_images.mask_score is
  '1 - (flags/5), 3 decimals. A sort key for the review queue, not a gate.';
comment on column public.product_images.mask_flags is
  'Heuristics that fired: coverage, edge, fragments, soft, contrast, error:<reason>.';
comment on column public.product_images.mask_model is
  'Matter that produced the cutout, e.g. replicate:men1scus/birefnet@f74986db or local:BiRefNet@1024.';
comment on column public.product_images.matted_at is
  'When the cutout was produced. Distinct from updated_at, which any edit moves.';


-- ── VERIFY (run separately) ─────────────────────────────────────────────────
--   -- (a) All nine columns landed:
--   select column_name, data_type, is_nullable, column_default
--   from information_schema.columns
--   where table_schema = 'public' and table_name = 'product_images'
--     and column_name in ('cutout_storage_path','composite_storage_path',
--                         'bg_preset','mask_status','mask_score','mask_flags',
--                         'mask_model','matted_at');
--   -- expect 8 rows; mask_flags is NOT NULL with default '{}'::text[]
--
--   -- (b) The CHECK rejects a bad status. This must FAIL with 23514:
--   update public.product_images set mask_status = 'pending' where true;
--
--   -- (c) The partial index exists:
--   select indexdef from pg_indexes
--   where indexname = 'product_images_mask_review_idx';
--
--   -- (d) Nothing was retroactively claimed — every pre-existing row is
--   --     untouched and unprocessed:
--   select count(*) filter (where mask_status is null) as never_processed,
--          count(*) as total
--   from public.product_images;
--   -- expect never_processed = total immediately after this migration
--
--   -- (e) Cross-org isolation still holds (run as a signed-in member; the
--   --     existing tenancy policies are doing this, not anything added here):
--   select count(*) from public.product_images
--   where org_id not in (select public.user_org_ids());
--   -- expect 0

-- ── ROLLBACK ────────────────────────────────────────────────────────────────
-- Index and constraint first, then the columns. Re-runnable.
--
-- WHAT THIS DESTROYS: the BOOKKEEPING, not the pixels. Every cutout and
-- composite already written to the product-images bucket survives — but the
-- only record of which file belongs to which photo, which preset built it, and
-- which ones a human approved is in these columns. After a rollback those files
-- are unreferenced blobs with legible names (`cut-*`, `bg-*`) and nothing in
-- the app points at them; re-applying this migration brings back empty columns,
-- not the mapping. If you intend to come back, snapshot first:
--
--   create table if not exists public._image_backgrounds_backup as
--   select id, cutout_storage_path, composite_storage_path, bg_preset,
--          mask_status, mask_score, mask_flags, mask_model, matted_at
--   from public.product_images
--   where mask_status is not null;
--
-- drop index if exists public.product_images_mask_review_idx;
-- alter table public.product_images drop constraint if exists product_images_mask_status_check;
-- alter table public.product_images drop column if exists cutout_storage_path;
-- alter table public.product_images drop column if exists composite_storage_path;
-- alter table public.product_images drop column if exists bg_preset;
-- alter table public.product_images drop column if exists mask_status;
-- alter table public.product_images drop column if exists mask_score;
-- alter table public.product_images drop column if exists mask_flags;
-- alter table public.product_images drop column if exists mask_model;
-- alter table public.product_images drop column if exists matted_at;
