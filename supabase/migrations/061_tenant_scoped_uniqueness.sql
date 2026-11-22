-- ============================================================================
-- TENANT-SCOPED UNIQUENESS — categories.name and category_presets.category_name
-- are unique PER WORKSPACE, not across the whole database
-- ============================================================================
-- Run in the Supabase SQL Editor (as `postgres`) AFTER multi_org_tenancy.sql.
-- Additive in effect (it widens what may be inserted), idempotent — safe to run
-- any number of times. Rollback at the bottom.
--
-- ── THE BUG THIS CLOSES ─────────────────────────────────────────────────────
-- Two constraints survived from the single-workspace era:
--
--   categories        UNIQUE (name)             convert_to_shared_collaborative*.sql
--   category_presets  UNIQUE (category_name)    category_presets.sql (inline)
--
-- multi_org_tenancy.sql added org_id to both tables and scoped their RLS per
-- workspace, but never touched these — so the NAMESPACE stayed global. The
-- Founding Workspace holds "tees", therefore no other workspace can. And the
-- app's seed for a new workspace (categoriesService.initializeDefaultCategories)
-- inserts one row at a time and IGNORES the error, so an approved beta shop
-- signs in, `ensureOrganization` seeds its workspace, every insert hits
-- categories_name_key, and Step 2 opens with nothing to categorise into.
-- `createCategoryPreset` already works around the presets half by appending a
-- random suffix to every category_name it mints — which is why that suffix
-- exists at all.
--
-- ── WHAT CHANGES ────────────────────────────────────────────────────────────
-- The global constraints are dropped and replaced by partial unique indexes
-- keyed on (org_id, <name>):
--
--   categories_org_name_uidx           (org_id, name)            where org_id is not null
--   category_presets_org_name_uidx     (org_id, category_name)   where org_id is not null
--   categories_global_name_uidx        (name)                    where org_id is null
--   category_presets_global_name_uidx  (category_name)           where org_id is null
--
-- The two "global" partials keep today's rule for rows with NO workspace (the
-- future system rows multi_org_tenancy.sql's RLS already anticipates), so
-- nothing gets looser for them. Semantics are otherwise byte-identical to the
-- old constraints — case-SENSITIVE, exact match — so no existing row can fail
-- the new indexes: global uniqueness is a superset of per-workspace uniqueness.
-- The DO blocks still catch unique_violation and downgrade to a NOTICE, in
-- case a row was hand-edited into a duplicate in between; the rest of the file
-- installs either way and the NOTICE says which index to revisit.
--
-- Constraints are looked up by SHAPE (a unique index on exactly that one
-- column), not by name, because the older files were run by hand and the name
-- may differ from what the file says.
--
-- ── WHAT DOES NOT CHANGE ────────────────────────────────────────────────────
-- No policy, no function, no column, no RLS. `idx_categories_name` (the plain,
-- non-unique index) stays. The client needs no change: the seed that used to
-- fail silently now succeeds, and presets keep their random suffix (harmless).
-- ============================================================================


-- ── 1. Drop the global constraints / indexes, whatever they are called ──────

do $$
declare r record;
begin
  for r in
    select con.conname, con.conrelid::regclass as tbl
    from pg_constraint con
    join pg_class c on c.oid = con.conrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and con.contype = 'u'
      and (
        (c.relname = 'categories'       and con.conkey = array[(select attnum from pg_attribute where attrelid = c.oid and attname = 'name')::smallint])
        or
        (c.relname = 'category_presets' and con.conkey = array[(select attnum from pg_attribute where attrelid = c.oid and attname = 'category_name')::smallint])
      )
  loop
    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
    raise notice 'dropped global unique constraint % on %', r.conname, r.tbl;
  end loop;

  -- a standalone unique INDEX (not a constraint) with the same shape.
  -- indkey is an int2vector, which is ZERO-based — `indkey::int2[] = array[n]`
  -- is always false ([0:0]={n} ≠ {n}), so the shape is tested by subscript.
  for r in
    select i.indexrelid::regclass::text as idx, i.indrelid::regclass::text as tbl
    from pg_index i
    join pg_class c on c.oid = i.indrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and i.indisunique
      and i.indpred is null
      and not exists (select 1 from pg_constraint where conindid = i.indexrelid)
      and (
        (c.relname = 'categories'       and i.indnkeyatts = 1 and i.indkey[0] = (select attnum from pg_attribute where attrelid = c.oid and attname = 'name'))
        or
        (c.relname = 'category_presets' and i.indnkeyatts = 1 and i.indkey[0] = (select attnum from pg_attribute where attrelid = c.oid and attname = 'category_name'))
      )
  loop
    raise notice 'dropping global unique index % on %', r.idx, r.tbl;
    execute format('drop index %s', r.idx);
  end loop;
end $$;


-- ── 2. Per-workspace uniqueness ─────────────────────────────────────────────

do $$
begin
  create unique index if not exists categories_org_name_uidx
    on public.categories (org_id, name) where org_id is not null;
exception when unique_violation then
  raise notice 'categories_org_name_uidx NOT created: a workspace already holds two categories with the same name — find them with the query in VERIFY (c), merge, and re-run';
end $$;

do $$
begin
  create unique index if not exists category_presets_org_name_uidx
    on public.category_presets (org_id, category_name) where org_id is not null;
exception when unique_violation then
  raise notice 'category_presets_org_name_uidx NOT created: a workspace already holds two presets with the same category_name — find them with the query in VERIFY (c), merge, and re-run';
end $$;


-- ── 3. Rows with no workspace keep the old rule ─────────────────────────────

do $$
begin
  create unique index if not exists categories_global_name_uidx
    on public.categories (name) where org_id is null;
exception when unique_violation then
  raise notice 'categories_global_name_uidx NOT created: duplicate names among rows with org_id IS NULL';
end $$;

do $$
begin
  create unique index if not exists category_presets_global_name_uidx
    on public.category_presets (category_name) where org_id is null;
exception when unique_violation then
  raise notice 'category_presets_global_name_uidx NOT created: duplicate category_names among rows with org_id IS NULL';
end $$;


-- ============================================================================
-- VERIFY (run separately)
-- ============================================================================
-- (a) The four new indexes exist and no single-column unique remains:
--
--   select tablename, indexname, indexdef from pg_indexes
--   where schemaname = 'public' and tablename in ('categories','category_presets')
--   order by 1, 2;
--
-- (b) A second workspace can now hold "tees" — as postgres, in a transaction:
--
--   begin;
--   insert into public.categories (user_id, org_id, name, display_name, emoji, color)
--   select (select id from auth.users limit 1), o.id, 'tees', 'Tees', 'shirt', '#000'
--   from public.organizations o where o.slug <> 'founding' limit 1;
--   rollback;
--
-- (c) If section 2 printed a NOTICE, the duplicates it refused:
--
--   select org_id, name, count(*) from public.categories
--   where org_id is not null group by 1, 2 having count(*) > 1;
--   select org_id, category_name, count(*) from public.category_presets
--   where org_id is not null group by 1, 2 having count(*) > 1;


-- ============================================================================
-- ROLLBACK
-- ============================================================================
-- Drops the four partial indexes and restores the two global constraints. The
-- restore is wrapped: once two workspaces legitimately share a name, the old
-- constraint CANNOT be re-added, and the block says so instead of failing.
--
-- drop index if exists public.categories_org_name_uidx;
-- drop index if exists public.category_presets_org_name_uidx;
-- drop index if exists public.categories_global_name_uidx;
-- drop index if exists public.category_presets_global_name_uidx;
-- do $$ begin
--   alter table public.categories add constraint categories_name_key unique (name);
-- exception when unique_violation then
--   raise notice 'categories_name_key NOT restored: two workspaces share a category name';
-- end $$;
-- do $$ begin
--   alter table public.category_presets add constraint category_presets_category_name_key unique (category_name);
-- exception when unique_violation then
--   raise notice 'category_presets_category_name_key NOT restored: two workspaces share a preset category_name';
-- end $$;
