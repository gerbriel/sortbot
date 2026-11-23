-- ============================================================================
-- 071_shared_insights.sql
-- SHARED INSIGHTS: what every workspace has learned about prices and eras,
-- pooled into k-anonymous AGGREGATES that improve recommendations for all,
-- while each workspace's own listings stay inside that workspace.
-- ============================================================================
-- Run AFTER:
--     031_multi_org_tenancy.sql   (organizations, org_members, is_org_admin())
--     039_founding_user_admin.sql (assert_founding_admin())
--     064_pricing_research.sql    (listing_sales)
--
-- IDEMPOTENT. Additive: one new column (`add column if not exists`), two
-- expression indexes (`if not exists`), one helper and three function pairs
-- (`create or replace`), grants re-stated on every run, and ONE widened CHECK
-- (listing_prices.method, skipped once it already allows the new values).
-- No policy, function or row is changed. Safe to run any number of times.
-- Rollback at the bottom.
--
-- THE PRIVACY MODEL, IN PLAIN WORDS
--   What crosses the workspace line: AGGREGATES ONLY. A median, a 25th and
--   75th percentile, a count of listings and a count of contributing
--   workspaces, per (category), (category, era) and (brand, category) for
--   prices, and per (brand, era) for dating. Nothing else.
--
--   What never crosses: any single listing. No listing id, product id, org
--   id, workspace name, title, description, SKU, photo, embedding, customer,
--   marketplace, or the price of any one row. "Similar past listings"
--   (match_listing_images, 065) is untouched and stays same-workspace only.
--   Own comps keep coming from the workspace's own rows through RLS
--   (researchService.fetchOwnComps); these functions EXCLUDE the caller's own
--   workspaces, so the aggregate is always "other shops".
--
--   K-anonymity: a row is returned only when at least 5 listings from at
--   least 2 different workspaces stand behind it (insightsService.ts
--   K_ANON_ROWS / K_ANON_ORGS mirror these; the server is the authority). A
--   bucket with 4 listings, or with 50 listings all from one shop, is
--   withheld entirely, not rounded or partially shown.
--
--   Opt-out: organizations.share_insights (default true). A workspace's
--   owner or admin can turn it off from the client through the existing
--   org_rows_update policy (031/056: is_org_admin(id)). An opted-out
--   workspace neither CONTRIBUTES (its rows are filtered out at the source)
--   nor READS: a caller who is not a member of at least one sharing
--   workspace gets zero rows, never an error.
--
--   Era signals use HUMAN-SET eras only (products.era), never
--   listing_identifications, which is the engine's own output: feeding the
--   engine's guesses back to itself as "what other shops said" is circular.
--
-- WHAT IT ADDS
--   organizations.share_insights boolean not null default true
--
--   listing_prices.method CHECK widened (listing_prices_method_check) to
--     'spoken', 'own_sold_median', 'asking_adjusted', 'insufficient',
--     'market_sold_median', 'market_asking_adjusted'
--     so the engine can record a price taken from the shared aggregate.
--     comps entries with source 'market' need nothing: 064 checks only that
--     comps is a JSON array.
--
--   public.market_price_stats(p_brand text, p_category text, p_era text)
--     returns table (kind text, level text, n int, orgs int,
--                    median_cents bigint, low_cents bigint, high_cents bigint,
--                    newest_at timestamptz)
--     kind  'sold'  listing_sales.sold_price_cents, newest_at = sold_at
--           'asking' products.price (numeric dollars) * 100, rounded to
--                   integer cents, price > 0 only, newest_at = created_at
--     level 'brand_category'  brand and category match (needs p_brand)
--           'category_era'    category and era match   (needs p_era)
--           'category'        category matches
--     Every level needs p_category (the ladder is fetchOwnComps' three
--     category steps). All available levels are returned; the client picks
--     the most specific. Each (kind, level) aggregates at most the NEWEST 500
--     contributing rows, and the k-anonymity test runs on those same rows.
--     All-empty parameters (the client's availability probe) return zero rows.
--
--   public.brand_era_signals(p_brand text)
--     returns table (era text, n int, orgs int)
--     One row per canonical decade ('1990s'), human-set eras only, most
--     supported first. Empty p_brand returns zero rows.
--
--   public.founding_insights_summary() returns jsonb
--     { sharing_orgs, total_orgs, sold_listings, asking_listings,
--       dated_listings, brands }   founding admins only (42501 otherwise).
--     Whole-project counts over SHARING workspaces (the founder's own
--     workspace included, since this is a health meter, not a read of the
--     aggregate):
--       sold_listings   listing_sales rows whose listing has a category
--       asking_listings listings with a category and price > 0
--       dated_listings  listings with a brand and a normalisable era
--       brands          distinct brands that clear the k-anonymity bar on
--                       either dated listings or priced (sold or asking) rows
--
--   app_private.insights_era_decade(text) returns text (immutable helper)
--
-- HOW A LISTING IS READ (AGENTS.md section 11, the leader convention)
--   A listing is a group of products rows keyed coalesce(nullif(product_group,
--   ''), id::text); its leader is the row whose id equals that key (first row
--   by created_at for legacy groups with no leader row). Members mirror the
--   leader's fields (syncGroupFieldsToDatabase), so one row per group is read,
--   leader first. Brand is products.vendor (productService writes brand into
--   vendor); category is products.product_category, as fetchOwnComps matches.
--   A sale joins its listing on (org_id, product_group_id::text = key). Brand
--   and category compare as lower(btrim(...)); era compares as the canonical
--   decade when both sides normalise ('90s' = '1990s'), else lower(btrim()).
--
-- ERA NORMALISATION (insights_era_decade)
--   '1990s'                    -> '1990s'   (1900s to 2090s)
--   '90s', '''90s', '90''s'    -> '1990s'   two digits: 00, 10, 20 -> 20xx,
--                                           30 to 90 -> 19xx
--   anything else ('vintage', 'y2k', '1994') -> null, dropped from era signals
--
-- SHAPE AND PRIVILEGES (AGENTS.md section 18 #45, #46, as 065/069)
--   Each function is an app_private SECURITY DEFINER body with
--   `set search_path = public, pg_temp` behind a public SECURITY INVOKER
--   wrapper with an IDENTICAL signature. EXECUTE is revoked from PUBLIC and
--   anon on both halves and granted to authenticated and service_role on both
--   halves (the invoker wrapper calls the body AS the caller). The definer is
--   the point: RLS confines products and listing_sales to the caller's own
--   workspaces, and these bodies are the one audited place that reads across
--   them, returning only aggregates. anon gets NO usage on app_private (#45a).
--   The era helper is internal: EXECUTE revoked from PUBLIC, anon and
--   authenticated; only the definer bodies (owned by postgres) call it.
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
    raise exception '071_shared_insights.sql: run 031_multi_org_tenancy.sql first.';
  end if;
  if to_regprocedure('public.assert_founding_admin()') is null then
    raise exception '071_shared_insights.sql: assert_founding_admin() is missing. Run 039_founding_user_admin.sql first.';
  end if;
  if to_regclass('public.listing_sales') is null or to_regclass('public.listing_prices') is null then
    raise exception '071_shared_insights.sql: listing_sales / listing_prices missing. Run 064_pricing_research.sql first.';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'products'
                    and column_name = 'org_id') then
    raise exception '071_shared_insights.sql: products.org_id is missing. Run 031_multi_org_tenancy.sql first.';
  end if;
end $$;


-- ── 1. The opt-out ──────────────────────────────────────────────────────────
-- Default true: the pool is only useful if it is on by default, and the
-- privacy model above means opting in exposes no single listing.

alter table public.organizations
  add column if not exists share_insights boolean not null default true;

comment on column public.organizations.share_insights is
  'Shared insights opt-out (071). true: this workspace contributes to and reads the k-anonymous cross-workspace aggregates. false: neither.';

-- 031 grants table-wide UPDATE on organizations to authenticated and the
-- org_rows_update policy limits it to is_org_admin(id), so an owner or admin
-- can already set this column. If a later hardening ever narrows that to
-- column grants, re-open exactly this column (a column grant does nothing
-- while the table-wide grant stands, so this is a no-op today).
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated')
     and not has_table_privilege('authenticated', 'public.organizations', 'UPDATE') then
    execute 'grant update (share_insights) on public.organizations to authenticated';
  end if;
end $$;


-- ── 1a. Two new price methods on listing_prices ─────────────────────────────
-- The engine now records a price taken from the shared aggregate as
-- 'market_sold_median' or 'market_asking_adjusted'. 064's column CHECK allows
-- only the four own-workspace methods, so every such row would fail with
-- 23514. The constraint is found by SHAPE (any CHECK on listing_prices whose
-- definition mentions `method`), not only by 064's generated name
-- listing_prices_method_check, and the block does nothing once a CHECK
-- mentioning 'market_sold_median' is already there.
-- comps entries now carry source 'market'; 064 constrains only
-- jsonb_typeof(comps) = 'array', never the inside of an entry, so that needs
-- no change.

do $$
declare
  c record;
begin
  if exists (select 1 from pg_constraint
              where conrelid = 'public.listing_prices'::regclass and contype = 'c'
                and pg_get_constraintdef(oid) like '%market_sold_median%') then
    return;
  end if;

  for c in
    select conname from pg_constraint
     where conrelid = 'public.listing_prices'::regclass and contype = 'c'
       and pg_get_constraintdef(oid) ~ '\mmethod\M'
  loop
    execute format('alter table public.listing_prices drop constraint %I', c.conname);
  end loop;

  alter table public.listing_prices
    add constraint listing_prices_method_check
    check (method in ('spoken', 'own_sold_median', 'asking_adjusted', 'insufficient',
                      'market_sold_median', 'market_asking_adjusted'));
end $$;


-- ── 2. Indexes for the case-folded lookups ──────────────────────────────────
-- market_price_stats is driven by category, brand_era_signals by brand. Both
-- compare lower(btrim(col)), which no existing index serves. Small table
-- today; a plain (non-concurrent) build takes a short write lock.

create index if not exists products_category_fold_idx
  on public.products (lower(btrim(product_category)))
  where product_category is not null;

create index if not exists products_vendor_fold_idx
  on public.products (lower(btrim(vendor)))
  where vendor is not null;


-- ── 3. app_private.insights_era_decade(text) ────────────────────────────────

create or replace function app_private.insights_era_decade(p_era text)
returns text
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v text := lower(btrim(coalesce(p_era, '')));
  d int;
begin
  -- Straight and curly apostrophes: '90s, 90's, ’90s.
  v := replace(replace(v, '''', ''), chr(8217), '');
  if v ~ '^(19|20)[0-9]0s$' then
    return v;
  end if;
  if v ~ '^[0-9]0s$' then
    d := substr(v, 1, 1)::int;
    return case when d <= 2 then '20' else '19' end || d::text || '0s';
  end if;
  return null;
end $$;


-- ── 4. app_private.market_price_stats(p_brand, p_category, p_era) ───────────

create or replace function app_private.market_price_stats(
  p_brand    text,
  p_category text,
  p_era      text
)
returns table (
  kind         text,
  level        text,
  n            int,
  orgs         int,
  median_cents bigint,
  low_cents    bigint,
  high_cents   bigint,
  newest_at    timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_uid   uuid := (select auth.uid());
  v_brand text := lower(btrim(coalesce(p_brand, '')));
  v_cat   text := lower(btrim(coalesce(p_category, '')));
  v_era   text := coalesce(app_private.insights_era_decade(p_era),
                           nullif(lower(btrim(coalesce(p_era, ''))), ''));
begin
  -- Every level needs a category; the availability probe sends all-empty.
  if v_uid is null or v_cat = '' then
    return;
  end if;

  -- A caller in no sharing workspace reads nothing.
  if not exists (select 1
                   from public.org_members m
                   join public.organizations o on o.id = m.org_id
                  where m.user_id = v_uid and o.share_insights) then
    return;
  end if;

  return query
  with mine as (
    select m.org_id from public.org_members m where m.user_id = v_uid
  ),
  listings as (
    -- One row per listing group, leader first, from OTHER sharing workspaces.
    select distinct on (p.org_id, coalesce(nullif(p.product_group, ''), p.id::text))
           p.org_id,
           coalesce(nullif(p.product_group, ''), p.id::text)              as gkey,
           lower(btrim(coalesce(p.vendor, '')))                           as brand,
           coalesce(app_private.insights_era_decade(p.era),
                    nullif(lower(btrim(coalesce(p.era, ''))), ''))        as era,
           p.price,
           p.created_at
      from public.products p
      join public.organizations o on o.id = p.org_id and o.share_insights
     where lower(btrim(p.product_category)) = v_cat
       and p.product_category is not null
       and p.org_id not in (select mine.org_id from mine)
     order by p.org_id,
              coalesce(nullif(p.product_group, ''), p.id::text),
              (p.id::text = coalesce(nullif(p.product_group, ''), p.id::text)) desc,
              p.created_at,
              p.id
  ),
  points as (
    select 'sold'::text as kind, l.org_id, l.brand, l.era,
           s.sold_price_cents::bigint as cents, s.sold_at as at
      from public.listing_sales s
      join listings l on l.org_id = s.org_id and l.gkey = s.product_group_id::text
    union all
    select 'asking'::text, l.org_id, l.brand, l.era,
           round(l.price * 100)::bigint, l.created_at
      from listings l
     where l.price > 0
  ),
  levels as (
    select 'brand_category'::text as level, 1 as ord where v_brand <> ''
    union all
    select 'category_era'::text, 2 where v_era is not null
    union all
    select 'category'::text, 3
  ),
  ranked as (
    select lv.level, lv.ord, t.kind, t.org_id, t.cents, t.at,
           row_number() over (partition by lv.level, t.kind
                              order by t.at desc nulls last) as rn
      from levels lv
      join points t
        on lv.level = 'category'
        or (lv.level = 'brand_category' and t.brand = v_brand)
        or (lv.level = 'category_era'   and t.era   = v_era)
  )
  select r.kind,
         r.level,
         count(*)::int,
         count(distinct r.org_id)::int,
         round(percentile_cont(0.5)  within group (order by r.cents))::bigint,
         round(percentile_cont(0.25) within group (order by r.cents))::bigint,
         round(percentile_cont(0.75) within group (order by r.cents))::bigint,
         max(r.at)
    from ranked r
   where r.rn <= 500
   group by r.kind, r.level, r.ord
  having count(*) >= 5 and count(distinct r.org_id) >= 2
   order by (r.kind = 'sold') desc, r.ord;
end $$;


-- ── 5. app_private.brand_era_signals(p_brand) ───────────────────────────────

create or replace function app_private.brand_era_signals(p_brand text)
returns table (
  era  text,
  n    int,
  orgs int
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_uid   uuid := (select auth.uid());
  v_brand text := lower(btrim(coalesce(p_brand, '')));
begin
  if v_uid is null or v_brand = '' then
    return;
  end if;

  if not exists (select 1
                   from public.org_members m
                   join public.organizations o on o.id = m.org_id
                  where m.user_id = v_uid and o.share_insights) then
    return;
  end if;

  return query
  with mine as (
    select m.org_id from public.org_members m where m.user_id = v_uid
  ),
  listings as (
    select distinct on (p.org_id, coalesce(nullif(p.product_group, ''), p.id::text))
           p.org_id,
           app_private.insights_era_decade(p.era) as era
      from public.products p
      join public.organizations o on o.id = p.org_id and o.share_insights
     where lower(btrim(p.vendor)) = v_brand
       and p.vendor is not null
       and p.org_id not in (select mine.org_id from mine)
       and p.era is not null and btrim(p.era) <> ''
     order by p.org_id,
              coalesce(nullif(p.product_group, ''), p.id::text),
              (p.id::text = coalesce(nullif(p.product_group, ''), p.id::text)) desc,
              p.created_at,
              p.id
  )
  select l.era, count(*)::int, count(distinct l.org_id)::int
    from listings l
   where l.era is not null
   group by l.era
  having count(*) >= 5 and count(distinct l.org_id) >= 2
   order by count(*) desc, l.era;
end $$;


-- ── 6. app_private.founding_insights_summary() ──────────────────────────────

create or replace function app_private.founding_insights_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_sharing int;
  v_total   int;
  v_sold    int;
  v_asking  int;
  v_dated   int;
  v_brands  int;
begin
  perform public.assert_founding_admin();

  select count(*) filter (where o.share_insights)::int, count(*)::int
    into v_sharing, v_total
  from public.organizations o;

  with listings as (
    select distinct on (p.org_id, coalesce(nullif(p.product_group, ''), p.id::text))
           p.org_id,
           coalesce(nullif(p.product_group, ''), p.id::text) as gkey,
           nullif(lower(btrim(coalesce(p.vendor, ''))), '')           as brand,
           nullif(lower(btrim(coalesce(p.product_category, ''))), '') as cat,
           app_private.insights_era_decade(p.era)                    as decade,
           p.price
      from public.products p
      join public.organizations o on o.id = p.org_id and o.share_insights
     order by p.org_id,
              coalesce(nullif(p.product_group, ''), p.id::text),
              (p.id::text = coalesce(nullif(p.product_group, ''), p.id::text)) desc,
              p.created_at,
              p.id
  ),
  sold as (
    select l.org_id, l.brand
      from public.listing_sales s
      join listings l on l.org_id = s.org_id and l.gkey = s.product_group_id::text
     where l.cat is not null
  ),
  priced as (
    select org_id, brand from sold
    union all
    select org_id, brand from listings where cat is not null and price > 0
  ),
  era_brands as (
    select brand from listings
     where brand is not null and decade is not null
     group by brand, decade
    having count(*) >= 5 and count(distinct org_id) >= 2
  ),
  price_brands as (
    select brand from priced
     where brand is not null
     group by brand
    having count(*) >= 5 and count(distinct org_id) >= 2
  )
  select (select count(*) from sold)::int,
         (select count(*) from listings where cat is not null and price > 0)::int,
         (select count(*) from listings where brand is not null and decade is not null)::int,
         (select count(*) from (select brand from era_brands
                                union
                                select brand from price_brands) b)::int
    into v_sold, v_asking, v_dated, v_brands;

  return jsonb_build_object(
    'sharing_orgs',    v_sharing,
    'total_orgs',      v_total,
    'sold_listings',   v_sold,
    'asking_listings', v_asking,
    'dated_listings',  v_dated,
    'brands',          v_brands);
end $$;


-- ── 7. The public SECURITY INVOKER wrappers (identical signatures) ──────────

create or replace function public.market_price_stats(
  p_brand    text,
  p_category text,
  p_era      text
)
returns table (
  kind         text,
  level        text,
  n            int,
  orgs         int,
  median_cents bigint,
  low_cents    bigint,
  high_cents   bigint,
  newest_at    timestamptz
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$ select * from app_private.market_price_stats(p_brand, p_category, p_era) $$;

create or replace function public.brand_era_signals(p_brand text)
returns table (
  era  text,
  n    int,
  orgs int
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$ select * from app_private.brand_era_signals(p_brand) $$;

create or replace function public.founding_insights_summary()
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$ select app_private.founding_insights_summary() $$;


-- ── 8. Privileges ───────────────────────────────────────────────────────────
-- Re-stated on every run: `create or replace` keeps an ACL, but a function
-- dropped and re-created by hand would come back with the PUBLIC default.

do $$
declare
  sig  text;
  r    text;
  sigs text[] := array[
    'app_private.market_price_stats(text, text, text)',
    'app_private.brand_era_signals(text)',
    'app_private.founding_insights_summary()',
    'public.market_price_stats(text, text, text)',
    'public.brand_era_signals(text)',
    'public.founding_insights_summary()'
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

  -- The era helper is internal to the definer bodies.
  execute 'revoke all on function app_private.insights_era_decade(text) from public';
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on function app_private.insights_era_decade(text) from %I', r);
    end if;
  end loop;
end $$;


-- ── 9. Tell PostgREST to re-read the schema ─────────────────────────────────

notify pgrst, 'reload schema';


-- ============================================================================
-- VERIFY (run separately, in the SQL Editor)
-- ============================================================================
-- (a) Three wrappers in public with prosecdef = f, three bodies in
--     app_private with prosecdef = t, identical arguments and results
--     (AGENTS.md section 18 #46):
--
--   select n.nspname, p.oid::regprocedure::text, p.prosecdef,
--          pg_get_function_arguments(p.oid), pg_get_function_result(p.oid)
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where p.proname in ('market_price_stats', 'brand_era_signals', 'founding_insights_summary')
--   order by 2;
--
-- (b) anon cannot execute any of the six or the helper; authenticated can
--     execute the six but not the helper; anon has no usage on app_private:
--
--   select p.oid::regprocedure::text,
--          has_function_privilege('anon', p.oid, 'execute')          as anon,
--          has_function_privilege('authenticated', p.oid, 'execute') as authed
--   from pg_proc p
--   where p.proname in ('market_price_stats', 'brand_era_signals',
--                       'founding_insights_summary', 'insights_era_decade');
--   select has_schema_privilege('anon', 'app_private', 'usage');   -- false
--
-- (c) The column exists, defaults to true, and every workspace is sharing:
--
--   select share_insights, count(*) from public.organizations group by 1;
--
-- (d) The era normaliser:
--
--   select x, app_private.insights_era_decade(x)
--   from unnest(array['1990s', '90s', '''90s', '00s', '20s', '70s', 'vintage', '1994']) x;
--   -- 1990s, 1990s, 1990s, 2000s, 2020s, 1970s, null, null
--
-- (d2) Exactly one method CHECK on listing_prices, with the two new values:
--
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--   where conrelid = 'public.listing_prices'::regclass and contype = 'c'
--     and pg_get_constraintdef(oid) ~ '\mmethod\M';
--
-- (e) From the app, signed in:
--     await supabase.rpc('market_price_stats', { p_brand: '', p_category: '', p_era: '' })  -- [] (the probe)
--     await supabase.rpc('market_price_stats', { p_brand: 'Levi''s', p_category: 'Jeans', p_era: '1990s' })
--     await supabase.rpc('brand_era_signals', { p_brand: 'Levi''s' })
--     await supabase.rpc('founding_insights_summary')   -- founders only, else 42501
--     await supabase.from('organizations').update({ share_insights: false }).eq('id', '<org>').select('id')
--       -- one row for an owner/admin, zero rows for a plain member


-- ============================================================================
-- ROLLBACK (run as postgres). Drops the three function pairs, the helper,
-- the two indexes and the column (the opt-out choices are lost with it), and
-- narrows the method CHECK back to 064's four values. The narrowed CHECK is
-- added NOT VALID so rows already written with a market_* method do not block
-- the rollback (new inserts are checked; delete or rewrite those rows and
-- `validate constraint` if you want it fully enforced again).
-- ============================================================================
-- alter table public.listing_prices drop constraint if exists listing_prices_method_check;
-- alter table public.listing_prices add constraint listing_prices_method_check
--   check (method in ('spoken', 'own_sold_median', 'asking_adjusted', 'insufficient')) not valid;
-- drop function if exists public.founding_insights_summary();
-- drop function if exists public.brand_era_signals(text);
-- drop function if exists public.market_price_stats(text, text, text);
-- drop function if exists app_private.founding_insights_summary();
-- drop function if exists app_private.brand_era_signals(text);
-- drop function if exists app_private.market_price_stats(text, text, text);
-- drop function if exists app_private.insights_era_decade(text);
-- drop index if exists public.products_category_fold_idx;
-- drop index if exists public.products_vendor_fold_idx;
-- alter table public.organizations drop column if exists share_insights;
-- notify pgrst, 'reload schema';
