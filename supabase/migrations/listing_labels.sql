-- ============================================================================
-- LISTING LABELS + SKUs — colour/word/vendor labels on listings, and the SKU
--                         that the Code 128 barcode encodes.
-- ============================================================================
-- Run AFTER multi_org_tenancy.sql (reuses default_org_id() and user_org_ids()).
-- Purely additive; idempotent; rollback at the bottom. Nothing in the existing
-- listing flow reads these tables, so dropping them cannot affect Steps 1-4.
--
-- MODEL: ordinary ORG-SCOPED data, exactly like kanban_board.sql.
--   * Every table carries org_id with DEFAULT public.default_org_id(), so the
--     client NEVER passes org_id on insert — RLS plus the default do the work.
--   * ANY member of the workspace can read AND write labels. A label is shared
--     vocabulary for the shop ("bad kids club", a vendor's name); a board that
--     only admins can edit is not a shared vocabulary. There is no
--     is_org_admin() gate anywhere below.
--   * Cross-org isolation is total: org_id in (select public.user_org_ids()).
--
-- SHAPE:
--   listing_labels   the vocabulary: one row per label a workspace can apply.
--                    `kind` separates VENDOR labels (who the piece came from —
--                    the picker lists these first, because that is the one a
--                    reseller reaches for every single time) from CUSTOM word
--                    labels ("bad kids club", "needs repair", "hold for Ash").
--   product_labels   the join. Composite PK (product_id, label_id) IS the
--                    "applied at most once" rule — no unique index needed, and
--                    a double-tap in the picker hits 23505 instead of creating
--                    a second row. There are no updatable columns: a label
--                    assignment is created or destroyed, never edited.
--
-- COLOUR — why there is no CHECK against a fixed list of names.
--   The column stores a palette NAME ('amber'), never a hex or CSS, so nothing
--   from the database ever reaches a style attribute — src/lib/labelsService.ts
--   LABEL_COLORS maps the name to a token-derived chip and renders an unknown
--   name as the neutral chip. That client map is the authority on which colours
--   are OFFERED. The CHECK here therefore constrains the SHAPE (a short
--   lowercase slug) rather than the membership: pinning the list in SQL would
--   mean a production migration every time the founder wants one more colour,
--   for no integrity the client-side fallback does not already provide.
--
-- SKU / BARCODE:
--   products.sku and products.barcode ALREADY EXIST (supabase/schema.sql lines
--   44-45, and the Database type in src/lib/supabase.ts). The ADD COLUMN IF NOT
--   EXISTS statements below are no-ops on any database that ran schema.sql, and
--   are here only so a project bootstrapped from the migrations alone still
--   gets them. What is genuinely new is the UNIQUE INDEX: a SKU is the key a
--   scanner looks a product up by, so two products sharing one within a
--   workspace would make the scanner ambiguous. It is PARTIAL (`where sku is
--   not null`) because the overwhelming majority of rows have no SKU and NULLs
--   must not collide with each other.
-- ============================================================================


-- ── 1. Tables ───────────────────────────────────────────────────────────────

create table if not exists public.listing_labels (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations(id) on delete cascade default public.default_org_id(),
  name       text not null check (length(btrim(name)) between 1 and 40),
  -- A palette NAME, not a colour value. See the header note.
  color      text not null default 'slate' check (color ~ '^[a-z]{3,16}$'),
  kind       text not null default 'custom' check (kind in ('vendor', 'custom')),
  sort_order integer not null default 0,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

create table if not exists public.product_labels (
  product_id uuid not null references public.products(id) on delete cascade,
  label_id   uuid not null references public.listing_labels(id) on delete cascade,
  org_id     uuid not null references public.organizations(id) on delete cascade default public.default_org_id(),
  created_at timestamptz not null default now(),
  primary key (product_id, label_id)
);


-- ── 2. SKU / barcode columns and the uniqueness that makes scanning work ────

alter table public.products add column if not exists sku text;
alter table public.products add column if not exists barcode text;

create index if not exists listing_labels_org_idx  on public.listing_labels (org_id);
create index if not exists product_labels_org_idx  on public.product_labels (org_id);
-- The picker loads labels for a handful of product ids at a time; the print
-- sheet loads them for a whole batch. Both filter on product_id.
create index if not exists product_labels_label_idx on public.product_labels (label_id);

-- One label name per workspace — otherwise the picker shows two identical
-- chips and nobody can tell which one is applied.
create unique index if not exists listing_labels_org_name_uidx
  on public.listing_labels (org_id, lower(btrim(name)));

-- One SKU per workspace. Wrapped in a DO block because a database that already
-- contains duplicate SKUs (they were free-text before today) would otherwise
-- fail the WHOLE migration on this one statement. A NOTICE plus a query to find
-- the duplicates is far more useful than a rolled-back transaction: labels and
-- everything else still install, and the founder fixes the handful of rows and
-- re-runs this file.
do $$
begin
  if not exists (
    select 1 from pg_class where relname = 'products_org_sku_uidx' and relnamespace = 'public'::regnamespace
  ) then
    begin
      create unique index products_org_sku_uidx
        on public.products (org_id, sku) where sku is not null;
    exception when unique_violation then
      raise notice 'products_org_sku_uidx NOT created: duplicate SKUs exist. Find them with:';
      raise notice '  select org_id, sku, count(*) from public.products where sku is not null group by 1,2 having count(*) > 1;';
      raise notice 'Clear or correct those rows, then re-run this migration.';
    end;
  end if;
end $$;


-- ── 3. RLS — org members only, no admin gate ────────────────────────────────

alter table public.listing_labels enable row level security;
alter table public.product_labels enable row level security;

grant select, insert, delete on public.listing_labels, public.product_labels to authenticated;

-- UPDATE is granted per COLUMN. org_id is absent, so a label can never be moved
-- into another workspace; created_by/created_at are absent, so provenance is
-- immutable after insert. product_labels gets no UPDATE at all — an assignment
-- is created or deleted, and "editing" one would just be a different row.
--
-- The revoke is what makes the column grants idempotent: a table-wide UPDATE
-- grant left over from an earlier run would otherwise survive and silently
-- re-open org_id. Column grants do not replace a table-wide grant.
revoke update on public.listing_labels, public.product_labels from authenticated;
grant update (name, color, kind, sort_order) on public.listing_labels to authenticated;

do $$
declare t text;
begin
  -- The UPDATE policy is created for both tables for symmetry; on
  -- product_labels it is unreachable, because that table has no UPDATE grant
  -- at all (see the revoke below). Harmless, and it means the loop stays one
  -- shape rather than growing a special case.
  foreach t in array array['listing_labels', 'product_labels'] loop
    execute format('drop policy if exists %I on public.%I', 'labels_select_'||t, t);
    execute format('drop policy if exists %I on public.%I', 'labels_insert_'||t, t);
    execute format('drop policy if exists %I on public.%I', 'labels_update_'||t, t);
    execute format('drop policy if exists %I on public.%I', 'labels_delete_'||t, t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (org_id in (select public.user_org_ids()))',
      'labels_select_'||t, t);
    -- NULL org_id is not "in (...)", so the DEFAULT above is effectively
    -- mandatory: a client cannot insert an untagged row.
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (org_id in (select public.user_org_ids()))',
      'labels_insert_'||t, t);
    execute format(
      'create policy %I on public.%I for update to authenticated using (org_id in (select public.user_org_ids())) with check (org_id in (select public.user_org_ids()))',
      'labels_update_'||t, t);
    execute format(
      'create policy %I on public.%I for delete to authenticated using (org_id in (select public.user_org_ids()))',
      'labels_delete_'||t, t);
  end loop;
end $$;

-- A product_labels row points at a product. RLS above proves the ROW belongs to
-- the caller's workspace; this additionally proves the PRODUCT does, so a
-- member cannot tag another workspace's product by guessing its id (the join
-- row would be invisible to them, but it would still exist, and the print view
-- of the owning workspace would render it).
drop policy if exists labels_insert_product_labels on public.product_labels;
create policy labels_insert_product_labels on public.product_labels for insert
  to authenticated
  with check (
    org_id in (select public.user_org_ids())
    and exists (
      select 1 from public.products p
      where p.id = product_id and p.org_id in (select public.user_org_ids())
    )
  );


-- ── VERIFY (run separately) ─────────────────────────────────────────────────
--   select name, color, kind from public.listing_labels order by kind, sort_order;
--   -- Cross-org leak check — must return 0 for any signed-in member:
--   select count(*) from public.listing_labels
--     where org_id not in (select public.user_org_ids());
--   select count(*) from public.product_labels
--     where org_id not in (select public.user_org_ids());
--   -- Provenance is immutable: this must FAIL with 42501 "permission denied
--   -- for table listing_labels" when run as an ordinary signed-in member.
--   -- (Postgres names the TABLE, not the column, when a column the statement
--   -- touches is outside the grant — the denial is what matters.)
--   update public.listing_labels set org_id = gen_random_uuid() where true;
--   -- The SKU index exists (empty result means the DO block hit duplicates):
--   select indexdef from pg_indexes where indexname = 'products_org_sku_uidx';

-- ── ROLLBACK ────────────────────────────────────────────────────────────────
-- Children first. The products columns are deliberately NOT dropped: they
-- predate this migration (schema.sql) and other code reads them.
-- drop table if exists public.product_labels;
-- drop table if exists public.listing_labels;
-- drop index if exists public.products_org_sku_uidx;
