-- ============================================================================
-- 069_plan_limits_and_usage.sql
-- PLAN LIMITS (data on the plan catalog) and WORKSPACE USAGE (measured, not
-- stored): what a workspace is allowed, and how much of it it is using.
-- ============================================================================
-- Run AFTER:
--     031_multi_org_tenancy.sql   (organizations.plan, org_members)
--     032_beta_signups.sql        (is_beta_admin())
--     039_founding_user_admin.sql (assert_founding_admin(), founding_admin_audit)
--     051_finance.sql             (finance_settings, key/value text)
--     062_plan_management.sql     (finance_plan_prices as the plan catalog)
--     033 + 063                   (the four product_images path columns)
--
-- Purely additive and idempotent: three new nullable columns (`add column if
-- not exists`), one new finance_settings row (`on conflict do nothing`), three
-- new function pairs (`create or replace`). No existing function, policy,
-- grant or row is changed. Safe to run any number of times; a re-run is a
-- no-op (the limit seed only runs in the same statement that adds the column,
-- see section 1). Rollback at the bottom.
--
-- WHAT IT ADDS
--   finance_plan_prices.listings_per_month int      null = unlimited
--   finance_plan_prices.storage_gb         numeric  null = unlimited
--   finance_plan_prices.seats              int      null = unlimited
--   finance_settings ('project_storage_gb', '100')  the Supabase project quota
--
--   public.org_usage(p_org uuid) returns jsonb
--     a member of p_org, or a founding admin; anyone else gets 42501.
--     { org_id, plan,
--       limits: { listings_per_month, storage_gb, seats },
--       usage:  { storage_bytes, files, listings_this_month, members, month_start },
--       listing_basis: 'created' }
--
--   public.project_usage() returns jsonb
--     founding admins only (42501 otherwise).
--     { project: { storage_gb_quota, storage_bytes_total, files_total, orgs,
--                  members_total, listings_this_month_total, month_start,
--                  listing_basis },
--       orgs: [ { org_id, name, plan, storage_bytes, files,
--                 listings_this_month, members, limits } ]  storage_bytes desc }
--
--   public.founding_set_plan_limits(p_plan text, p_listings_per_month int,
--                                   p_storage_gb numeric, p_seats int)
--     returns jsonb, the updated catalog row. Founding admins only. A separate
--     function, NOT an overload of founding_upsert_plan: PostgREST resolves
--     RPCs by argument names and two overloads of one name are ambiguous.
--
-- LISTING BASIS: 'created', and why not 'exported'
--   listing_publications (059) is written ONLY by MarketplaceExport.tsx's
--   recordPublications (the per-marketplace feeds and pastes). The Shopify CSV
--   export (GoogleSheetExporter.tsx), which is the main export path, never
--   calls upsertPublication and writes no row. A count over
--   listing_publications would read 0 for a Shopify-only shop. It is also keyed
--   on (product_group_id, marketplace) with created_at = the FIRST export, so a
--   re-export never moves it.
--   So a "listing this month" is a listing GROUP (AGENTS.md section 11, leader
--   convention: key = coalesce(product_group, id)) of the org's products whose
--   EARLIEST product row was created on or after the first of the current UTC
--   month. Using the group's earliest row, not "any row this month", means a
--   photo added on the 2nd to a listing started on the 30th does not count it
--   again in the new month. products.created_at is stable: the products upsert
--   uses ignoreDuplicates, so a re-save never re-stamps it.
--   When a Shopify export starts writing publications, switch the basis here
--   (both functions read it from one place: the 'listing_basis' literal).
--
-- STORAGE: what is "a workspace's storage"
--   Object paths are {userId}/{productId}/{file}, so a uid prefix is a USER,
--   not a workspace (057 sums the caller's own prefix for that reason). A
--   workspace owns the objects its product_images rows point at:
--   storage_path, cutout_storage_path, composite_storage_path and
--   original_storage_path, deduplicated by object name (one file referenced by
--   two rows or two columns is counted once), joined to storage.objects on
--   (bucket_id, name), which is the unique index Supabase ships. Size is
--   metadata->>'size', the field 057 and the old JS walk read; a missing or
--   non-numeric size counts as a file of 0 bytes.
--   project_usage's storage_bytes_total is the WHOLE bucket, referenced or not,
--   so orphaned files count against the quota exactly as Supabase bills them.
--   The per-org figures therefore do not sum to the total; the gap is orphans.
--
-- PERFORMANCE
--   No per-org loop. org_usage does one indexed join for one org.
--   project_usage reads storage.objects twice in total (one whole-bucket sum,
--   one join of all referenced paths) and products once, grouped by org.
--   About 5,000 objects today.
--
-- SHAPE AND PRIVILEGES (AGENTS.md section 18 #43 to #46, as 057/062/065)
--   Each function is an app_private SECURITY DEFINER body with
--   `set search_path = public, pg_temp` behind a public SECURITY INVOKER
--   wrapper with an IDENTICAL signature. EXECUTE is revoked from PUBLIC and
--   anon on both halves and granted to authenticated and service_role on both
--   halves. The app_private half needs the authenticated grant: an INVOKER
--   wrapper calls the body AS the caller, so without it every call is 42501
--   (054/055/057/062 grant both halves for this reason). The bodies' own
--   checks are the boundary, as with the existing founder RPCs.
--   The definer is needed because storage.objects has no grant for
--   authenticated and finance_plan_prices is readable by founders only (062's
--   select policy is is_beta_admin()), so org_usage embeds the limits itself.
-- ============================================================================


-- ── 0. Preconditions ────────────────────────────────────────────────────────

create schema if not exists app_private;
revoke all on schema app_private from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant usage on schema app_private to authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant usage on schema app_private to service_role';
  end if;
end $$;

do $$
begin
  if to_regclass('public.organizations') is null or to_regclass('public.org_members') is null then
    raise exception '069_plan_limits_and_usage.sql: run 031_multi_org_tenancy.sql first.';
  end if;
  if to_regprocedure('public.is_beta_admin()') is null then
    raise exception '069_plan_limits_and_usage.sql: is_beta_admin() is missing. Run 032_beta_signups.sql first.';
  end if;
  if to_regprocedure('public.assert_founding_admin()') is null
     or to_regclass('public.founding_admin_audit') is null then
    raise exception '069_plan_limits_and_usage.sql: run 039_founding_user_admin.sql first.';
  end if;
  if to_regclass('public.finance_settings') is null then
    raise exception '069_plan_limits_and_usage.sql: finance_settings is missing. Run 051_finance.sql first.';
  end if;
  if to_regclass('public.finance_plan_prices') is null
     or not exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'finance_plan_prices'
                       and column_name = 'sort_order') then
    raise exception '069_plan_limits_and_usage.sql: run 062_plan_management.sql first.';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'product_images'
                    and column_name = 'original_storage_path')
     or not exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'product_images'
                       and column_name = 'composite_storage_path') then
    raise exception '069_plan_limits_and_usage.sql: product_images path columns missing. Run 033_stage4_slim_fields.sql and 063_image_backgrounds.sql first.';
  end if;
  if to_regclass('storage.objects') is null then
    raise exception '069_plan_limits_and_usage.sql: storage.objects not found. Is this a Supabase project?';
  end if;
end $$;


-- ── 1. Limit columns on the plan catalog, seeded ONCE ───────────────────────
-- NULL means unlimited, so NULL is a value a founder can choose on purpose
-- (founding_set_plan_limits). A seed of the form `where col is null` would
-- therefore overwrite that choice on every re-run. Instead each column is
-- added and seeded in the same block, and only when the column did not exist
-- yet: the first run seeds, every later run touches nothing.
-- Plans created later (founding_upsert_plan) start unlimited until a founder
-- sets their limits.

do $$
declare
  v_seed constant jsonb := '{
    "free":       [5,    1,    1],
    "starter":    [25,   10,   2],
    "basic":      [60,   20,   3],
    "growth":     [135,  40,   5],
    "pro":        [300,  100,  10],
    "business":   [550,  150,  15],
    "scale":      [2000, 400,  30],
    "enterprise": [6000, 1000, null],
    "beta":       [null, null, null]
  }'::jsonb;
  v_col  text;
  v_idx  int;
  v_type text;
  v_chk  text;
begin
  foreach v_col in array array['listings_per_month', 'storage_gb', 'seats'] loop
    if exists (select 1 from information_schema.columns
                where table_schema = 'public' and table_name = 'finance_plan_prices'
                  and column_name = v_col) then
      continue;   -- already added (and seeded) by an earlier run
    end if;

    v_idx  := case v_col when 'listings_per_month' then 0 when 'storage_gb' then 1 else 2 end;
    v_type := case v_col when 'storage_gb' then 'numeric' else 'int' end;
    v_chk  := case v_col when 'seats' then '>= 1' else '>= 0' end;

    execute format(
      'alter table public.finance_plan_prices add column if not exists %1$I %2$s '
      'constraint %3$I check (%1$I is null or %1$I %4$s)',
      v_col, v_type, 'finance_plan_prices_' || v_col || '_check', v_chk);

    execute format(
      'update public.finance_plan_prices p set %1$I = (s.value ->> %2$s)::%3$s '
      'from jsonb_each($1) s where p.plan = s.key and p.%1$I is null',
      v_col, v_idx, v_type)
      using v_seed;
  end loop;
end $$;

-- 062 grants table-wide SELECT to authenticated (rows gated to founders by
-- its policy), which already covers the new columns. The column UPDATE grant
-- is deliberately NOT widened: founding_set_plan_limits is the one write path,
-- so every limit change lands in founding_admin_audit.


-- ── 2. The project storage quota, in finance_settings' key/value shape ──────

insert into public.finance_settings (key, value, note) values
  ('project_storage_gb', '100',
   'Supabase project storage quota in GB, for the founder usage meter (project_usage).')
on conflict (key) do nothing;


-- ── 3. app_private.org_usage(p_org) ─────────────────────────────────────────

create or replace function app_private.org_usage(p_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_month_ts  timestamptz := date_trunc('month', now() at time zone 'utc') at time zone 'utc';
  v_plan      text;
  v_limits    jsonb;
  v_bytes     bigint;
  v_files     int;
  v_listings  int;
  v_members   int;
begin
  if p_org is null then
    raise exception 'Which workspace?' using errcode = '22023';
  end if;

  -- Membership first, so a non-member learns nothing (not even existence).
  if not exists (select 1 from public.org_members m
                  where m.org_id = p_org and m.user_id = (select auth.uid()))
     and not (select public.is_beta_admin()) then
    raise exception 'Not authorized: members of this workspace only.'
      using errcode = '42501';
  end if;

  select o.plan into v_plan from public.organizations o where o.id = p_org;
  if not found then
    raise exception 'No such workspace.' using errcode = '22023';
  end if;

  select jsonb_build_object(
           'listings_per_month', fp.listings_per_month,
           'storage_gb',         fp.storage_gb,
           'seats',              fp.seats)
    into v_limits
  from public.finance_plan_prices fp where fp.plan = v_plan;
  v_limits := coalesce(v_limits, jsonb_build_object(
    'listings_per_month', null, 'storage_gb', null, 'seats', null));

  with refs as (
    select distinct x.path
    from public.product_images pi
    cross join lateral (values
      (pi.storage_path), (pi.cutout_storage_path),
      (pi.composite_storage_path), (pi.original_storage_path)) as x(path)
    where pi.org_id = p_org
      and x.path is not null and x.path <> ''
  )
  select coalesce(sum(case when o.metadata ->> 'size' ~ '^[0-9]+$'
                           then (o.metadata ->> 'size')::bigint else 0 end), 0)::bigint,
         count(o.id)::int
    into v_bytes, v_files
  from refs r
  join storage.objects o
    on o.bucket_id = 'product-images' and o.name = r.path;

  select count(*)::int into v_listings
  from (
    select coalesce(nullif(p.product_group, ''), p.id::text)
    from public.products p
    where p.org_id = p_org
    group by 1
    having min(p.created_at) >= v_month_ts
  ) g;

  select count(*)::int into v_members
  from public.org_members m where m.org_id = p_org;

  return jsonb_build_object(
    'org_id', p_org,
    'plan',   v_plan,
    'limits', v_limits,
    'usage',  jsonb_build_object(
      'storage_bytes',       v_bytes,
      'files',               v_files,
      'listings_this_month', v_listings,
      'members',             v_members,
      'month_start',         to_char(v_month_ts at time zone 'utc', 'YYYY-MM-DD')),
    'listing_basis', 'created');
end $$;


-- ── 4. app_private.project_usage() ──────────────────────────────────────────

create or replace function app_private.project_usage()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_month_ts  timestamptz := date_trunc('month', now() at time zone 'utc') at time zone 'utc';
  v_quota     numeric;
  v_raw       text;
  v_bytes     bigint;
  v_files     int;
  v_orgs      jsonb;
  v_org_count int;
  v_members   int;
  v_listings  int;
begin
  perform public.assert_founding_admin();

  select s.value into v_raw from public.finance_settings s where s.key = 'project_storage_gb';
  v_quota := case when v_raw ~ '^[0-9]+(\.[0-9]+)?$' then v_raw::numeric else 100 end;

  -- The whole bucket, orphans included: this is what Supabase bills.
  select coalesce(sum(case when o.metadata ->> 'size' ~ '^[0-9]+$'
                           then (o.metadata ->> 'size')::bigint else 0 end), 0)::bigint,
         count(*)::int
    into v_bytes, v_files
  from storage.objects o
  where o.bucket_id = 'product-images';

  with refs as (
    select distinct pi.org_id, x.path
    from public.product_images pi
    cross join lateral (values
      (pi.storage_path), (pi.cutout_storage_path),
      (pi.composite_storage_path), (pi.original_storage_path)) as x(path)
    where pi.org_id is not null
      and x.path is not null and x.path <> ''
  ),
  st as (
    select r.org_id,
           sum(case when o.metadata ->> 'size' ~ '^[0-9]+$'
                    then (o.metadata ->> 'size')::bigint else 0 end)::bigint as bytes,
           count(*)::int as files
    from refs r
    join storage.objects o
      on o.bucket_id = 'product-images' and o.name = r.path
    group by r.org_id
  ),
  li as (
    select g.org_id, count(*)::int as listings
    from (
      select p.org_id
      from public.products p
      where p.org_id is not null
      group by p.org_id, coalesce(nullif(p.product_group, ''), p.id::text)
      having min(p.created_at) >= v_month_ts
    ) g
    group by g.org_id
  ),
  mb as (
    select m.org_id, count(*)::int as members
    from public.org_members m
    group by m.org_id
  ),
  rows as (
    select o.id, o.name, o.plan,
           coalesce(st.bytes, 0)    as bytes,
           coalesce(st.files, 0)    as files,
           coalesce(li.listings, 0) as listings,
           coalesce(mb.members, 0)  as members,
           fp.listings_per_month, fp.storage_gb, fp.seats
    from public.organizations o
    left join st on st.org_id = o.id
    left join li on li.org_id = o.id
    left join mb on mb.org_id = o.id
    left join public.finance_plan_prices fp on fp.plan = o.plan
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'org_id',              r.id,
           'name',                r.name,
           'plan',                r.plan,
           'storage_bytes',       r.bytes,
           'files',               r.files,
           'listings_this_month', r.listings,
           'members',             r.members,
           'limits', jsonb_build_object(
             'listings_per_month', r.listings_per_month,
             'storage_gb',         r.storage_gb,
             'seats',              r.seats)
         ) order by r.bytes desc, r.name, r.id), '[]'::jsonb),
         count(*)::int,
         coalesce(sum(r.members), 0)::int,
         coalesce(sum(r.listings), 0)::int
    into v_orgs, v_org_count, v_members, v_listings
  from rows r;

  return jsonb_build_object(
    'project', jsonb_build_object(
      'storage_gb_quota',          v_quota,
      'storage_bytes_total',       v_bytes,
      'files_total',               v_files,
      'orgs',                      v_org_count,
      'members_total',             v_members,
      'listings_this_month_total', v_listings,
      'month_start',               to_char(v_month_ts at time zone 'utc', 'YYYY-MM-DD'),
      'listing_basis',             'created'),
    'orgs', v_orgs);
end $$;


-- ── 5. app_private.founding_set_plan_limits(...) ────────────────────────────

create or replace function app_private.founding_set_plan_limits(
  p_plan               text,
  p_listings_per_month int,
  p_storage_gb         numeric,
  p_seats              int
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_plan text := lower(btrim(coalesce(p_plan, '')));
  v_row  jsonb;
begin
  perform public.assert_founding_admin();

  if v_plan = '' then
    raise exception 'Which plan?' using errcode = '22023';
  end if;
  if p_listings_per_month is not null and p_listings_per_month < 0 then
    raise exception 'Listings per month must be 0 or more (leave it empty for unlimited).' using errcode = '22023';
  end if;
  if p_storage_gb is not null and p_storage_gb < 0 then
    raise exception 'Storage must be 0 GB or more (leave it empty for unlimited).' using errcode = '22023';
  end if;
  if p_seats is not null and p_seats < 1 then
    raise exception 'A plan needs at least 1 seat (leave it empty for unlimited).' using errcode = '22023';
  end if;

  update public.finance_plan_prices fp
     set listings_per_month = p_listings_per_month,
         storage_gb         = p_storage_gb,
         seats              = p_seats
   where fp.plan = v_plan
  returning to_jsonb(fp.*) into v_row;

  if v_row is null then
    raise exception 'No such plan: %', v_plan using errcode = '22023';
  end if;

  insert into public.founding_admin_audit
    (actor_id, actor_email, action, role)
  values
    (auth.uid(), auth.jwt() ->> 'email', 'set_plan_limits', v_plan);

  return v_row;
end $$;


-- ── 6. The public SECURITY INVOKER wrappers (identical signatures) ──────────

create or replace function public.org_usage(p_org uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$ select app_private.org_usage(p_org) $$;

create or replace function public.project_usage()
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$ select app_private.project_usage() $$;

create or replace function public.founding_set_plan_limits(
  p_plan               text,
  p_listings_per_month int,
  p_storage_gb         numeric,
  p_seats              int
)
returns jsonb
language sql
security invoker
set search_path = public, pg_temp
as $$ select app_private.founding_set_plan_limits(p_plan, p_listings_per_month, p_storage_gb, p_seats) $$;


-- ── 7. Privileges ───────────────────────────────────────────────────────────
-- Re-stated on every run: `create or replace` keeps an ACL, but a function
-- dropped and re-created by hand would come back with the PUBLIC default.

do $$
declare
  sig  text;
  r    text;
  sigs text[] := array[
    'app_private.org_usage(uuid)',
    'app_private.project_usage()',
    'app_private.founding_set_plan_limits(text, int, numeric, int)',
    'public.org_usage(uuid)',
    'public.project_usage()',
    'public.founding_set_plan_limits(text, int, numeric, int)'
  ];
begin
  foreach sig in array sigs loop
    execute format('revoke all on function %s from public', sig);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on function %s from anon', sig);
    end if;
    foreach r in array array['authenticated', 'service_role'] loop
      if exists (select 1 from pg_roles where rolname = r) then
        execute format('grant execute on function %s to %I', sig, r);
      end if;
    end loop;
  end loop;
end $$;


-- ── 8. Tell PostgREST to re-read the schema ─────────────────────────────────

notify pgrst, 'reload schema';


-- ============================================================================
-- VERIFY (run separately, in the SQL Editor)
-- ============================================================================
-- (a) Three wrappers in public with prosecdef = f, three bodies in
--     app_private with prosecdef = t, and identical arguments and results:
--
--   select n.nspname, p.oid::regprocedure::text, p.prosecdef,
--          pg_get_function_arguments(p.oid), pg_get_function_result(p.oid)
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where p.proname in ('org_usage', 'project_usage', 'founding_set_plan_limits')
--   order by 2;
--
-- (b) anon cannot execute any of the six; authenticated can:
--
--   select p.oid::regprocedure::text,
--          has_function_privilege('anon', p.oid, 'execute')          as anon,
--          has_function_privilege('authenticated', p.oid, 'execute') as authed
--   from pg_proc p
--   where p.proname in ('org_usage', 'project_usage', 'founding_set_plan_limits');
--
-- (c) The seeded limits (the founder's later edits are never re-seeded):
--
--   select plan, listings_per_month, storage_gb, seats
--   from public.finance_plan_prices order by sort_order, plan;
--
-- (d) From the app, signed in:
--     await supabase.rpc('org_usage', { p_org: '<my org id>' })   -- my workspace
--     await supabase.rpc('project_usage')                          -- founders only, else 42501
--
-- (e) Storage cross-check: the referenced total never exceeds the bucket:
--
--   select (public.project_usage() -> 'project' ->> 'storage_bytes_total')::bigint
--          >= (select sum((e ->> 'storage_bytes')::bigint)
--                from jsonb_array_elements(public.project_usage() -> 'orgs') e);
--   -- (as a founding admin; true unless one object is referenced by two orgs)


-- ============================================================================
-- ROLLBACK (run as postgres). Drops the three function pairs and the setting.
-- The three catalog columns are KEPT by default (dropping them loses any limit
-- a founder set); uncomment the last statement to remove them too.
-- ============================================================================
-- drop function if exists public.founding_set_plan_limits(text, int, numeric, int);
-- drop function if exists public.project_usage();
-- drop function if exists public.org_usage(uuid);
-- drop function if exists app_private.founding_set_plan_limits(text, int, numeric, int);
-- drop function if exists app_private.project_usage();
-- drop function if exists app_private.org_usage(uuid);
-- delete from public.finance_settings where key = 'project_storage_gb';
-- -- alter table public.finance_plan_prices
-- --   drop column if exists listings_per_month,
-- --   drop column if exists storage_gb,
-- --   drop column if exists seats;
-- notify pgrst, 'reload schema';
