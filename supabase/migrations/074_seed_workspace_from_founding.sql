-- ============================================================================
-- 074_seed_workspace_from_founding.sql
-- WORKSPACE DEFAULTS: a new workspace starts with the founding workspace's
-- categories and category presets, prefilled, MINUS everything that belongs
-- to one shop. The new workspace then owns its copies outright: it fills them
-- out, edits them, adds its own and removes the ones it does not need.
-- ============================================================================
-- Run AFTER:
--     031_multi_org_tenancy.sql        (organizations.slug, org_members,
--                                       categories/category_presets.org_id)
--     061_tenant_scoped_uniqueness.sql (per-workspace unique names; without it
--                                       a second workspace cannot hold the
--                                       same category names at all)
--
-- IDEMPOTENT. Additive: one function pair (`create or replace`) and grants
-- re-stated on every run. No table, column, policy, trigger or row is changed
-- by applying it. Safe to run any number of times. Rollback at the bottom.
--
-- THE PRIVACY RULE, IN PLAIN WORDS
--   Categories and presets are copied, never shared: the new workspace gets
--   its OWN rows (its org_id, its caller as user_id, fresh ids and
--   timestamps), and nothing links them back to the founding rows. An edit on
--   either side never reaches the other.
--
--   Four preset columns NEVER cross the workspace line and are written as
--   NULL on every copy:
--     ships_from             the shop's own street address (017 wrote the
--                            founder's real address onto the founding presets)
--     vendor                 the seller's own shop name (AGENTS.md section 18
--                            #37: it must never become anyone's brand either)
--     shopify_collection_id  the founding shop's Shopify ids mean nothing in
--                            another store
--     policies               the shop's own returns and exchange terms (017
--                            filled it with the founding shop's policy text)
--   Any column whose name matches those four is blanked whenever the column
--   exists; a future per-shop column must be added to the same list.
--   Kept on purpose: sku_prefix, barcode_prefix, renewal_options and
--   who_made_it are starting values a new shop edits, not shop facts.
--
-- WHAT IT ADDS
--   public.seed_workspace_from_founding(p_org uuid) returns jsonb
--     { "categories": int, "presets": int, "source": text }
--     source 'founding'  the copy ran; counts are the rows inserted
--            'skipped'   p_org already has at least one category or preset
--                        (active or not); nothing written, counts 0
--            'none'      no organizations row with slug 'founding'; nothing
--                        written, counts 0 (the client then seeds its
--                        hard-coded list, categoriesService)
--   Caller must be an owner or admin of p_org (is_org_admin), else 42501.
--   Copies only is_active = true rows, so a category the founder retired is
--   not handed to a new shop. sort_order and is_default copy as they are.
--
--   The column list is built DYNAMICALLY from information_schema at call
--   time, so a column added to either table after this function was created
--   is copied too, with no edit here. Excluded: id, org_id, user_id,
--   created_at, updated_at (set fresh), generated and identity-always columns
--   (Postgres refuses them), and the four per-shop preset columns above.
--
-- WHY IT CANNOT DUPLICATE OR OVERWRITE
--   The "already has rows" guard runs FIRST, under a transaction-scoped
--   advisory lock keyed on p_org, so two admins opening the same empty
--   workspace at the same moment run one after the other and the second sees
--   'skipped'. It only ever INSERTs; no existing row is updated or deleted.
--   061's per-workspace unique indexes would turn any slip into a 23505
--   anyway, never a silent duplicate.
--
-- HOW IT READS THE FOUNDING ROWS
--   As the function OWNER (postgres, which owns both tables, and neither
--   table has FORCE ROW LEVEL SECURITY), which is why the body is a SECURITY
--   DEFINER: the caller is not a member of the founding workspace, so RLS
--   would show them none of its rows. The function is also declared with
--   `set row_security = off`: for the owner that changes nothing, but if the
--   owner ever stops being exempt (a FORCE, an owner change) Postgres raises
--   an error instead of silently filtering the founding rows down to zero and
--   seeding an empty workspace.
--
-- SHAPE AND PRIVILEGES (AGENTS.md section 18 #45, #46, as 060/069/071)
--   An app_private SECURITY DEFINER body with `set search_path = public,
--   pg_temp` behind a public SECURITY INVOKER wrapper with an IDENTICAL
--   signature. EXECUTE revoked from PUBLIC and anon on both halves and
--   granted to authenticated and service_role on both halves (the invoker
--   wrapper calls the body AS the caller). anon gets NO usage on app_private
--   (#45a). A service_role call has no auth.uid(), so it fails the
--   is_org_admin check with 42501 by design: seeding is the admin's own act.
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
    raise exception '074_seed_workspace_from_founding.sql: run 031_multi_org_tenancy.sql first.';
  end if;
  if to_regprocedure('public.is_org_admin(uuid)') is null then
    raise exception '074_seed_workspace_from_founding.sql: is_org_admin(uuid) is missing. Run 031_multi_org_tenancy.sql first.';
  end if;
  if to_regclass('public.categories') is null or to_regclass('public.category_presets') is null then
    raise exception '074_seed_workspace_from_founding.sql: categories / category_presets missing.';
  end if;
  if (select count(*) from information_schema.columns
       where table_schema = 'public'
         and table_name in ('categories', 'category_presets')
         and column_name in ('org_id', 'user_id', 'is_active')) <> 6 then
    raise exception '074_seed_workspace_from_founding.sql: categories / category_presets need org_id, user_id and is_active. Run 031_multi_org_tenancy.sql first.';
  end if;
  if to_regclass('public.categories_org_name_uidx') is null
     or to_regclass('public.category_presets_org_name_uidx') is null then
    raise exception '074_seed_workspace_from_founding.sql: the per-workspace unique indexes are missing. Run 061_tenant_scoped_uniqueness.sql first.';
  end if;
end $$;


-- ── 1. The definer body ─────────────────────────────────────────────────────

create or replace function app_private.seed_workspace_from_founding(p_org uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  v_uid       uuid := auth.uid();
  v_founding  uuid;
  v_cols      text;
  v_blank     text;
  v_blank_val text;
  v_stamp     text;
  v_stamp_val text;
  v_cats      int := 0;
  v_presets   int := 0;
  -- Per-shop preset columns, written NULL on every copy (header).
  c_per_shop  constant text[] := array['ships_from', 'vendor', 'shopify_collection_id', 'policies'];
  -- Never copied: fresh identity, owner and timestamps.
  c_fresh     constant text[] := array['id', 'org_id', 'user_id', 'created_at', 'updated_at'];
begin
  if p_org is null or v_uid is null or not public.is_org_admin(p_org) then
    raise exception 'seed_workspace_from_founding: only an owner or admin of this workspace can seed it'
      using errcode = '42501';
  end if;

  select id into v_founding from public.organizations where slug = 'founding' limit 1;
  if v_founding is null then
    return jsonb_build_object('categories', 0, 'presets', 0, 'source', 'none');
  end if;

  -- One seeder per workspace at a time; the guard below then sees the rows
  -- the first one wrote.
  perform pg_advisory_xact_lock(hashtextextended('seed_workspace_from_founding:' || p_org::text, 0));

  if exists (select 1 from public.categories where org_id = p_org)
     or exists (select 1 from public.category_presets where org_id = p_org) then
    return jsonb_build_object('categories', 0, 'presets', 0, 'source', 'skipped');
  end if;

  -- created_at / updated_at are stamped now() when the column exists (both
  -- tables carry them today; looked up anyway, like every other column).

  -- ── categories ──
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
    into v_cols
  from information_schema.columns
  where table_schema = 'public' and table_name = 'categories'
    and column_name <> all (c_fresh)
    and is_generated = 'NEVER'
    and coalesce(identity_generation, '') <> 'ALWAYS';

  select coalesce(string_agg(', ' || quote_ident(column_name), '' order by column_name), ''),
         coalesce(string_agg(', now()', ''), '')
    into v_stamp, v_stamp_val
  from information_schema.columns
  where table_schema = 'public' and table_name = 'categories'
    and column_name in ('created_at', 'updated_at');

  execute format(
    'insert into public.categories (org_id, user_id%s, %s)
     select $1, $2%s, %s from public.categories
     where org_id = $3 and is_active = true',
    v_stamp, v_cols, v_stamp_val, v_cols)
  using p_org, v_uid, v_founding;
  get diagnostics v_cats = row_count;

  -- ── category_presets ──
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
    into v_cols
  from information_schema.columns
  where table_schema = 'public' and table_name = 'category_presets'
    and column_name <> all (c_fresh)
    and column_name <> all (c_per_shop)
    and is_generated = 'NEVER'
    and coalesce(identity_generation, '') <> 'ALWAYS';

  select coalesce(string_agg(', ' || quote_ident(column_name), '' order by column_name), ''),
         coalesce(string_agg(', null', ''), '')
    into v_blank, v_blank_val
  from information_schema.columns
  where table_schema = 'public' and table_name = 'category_presets'
    and column_name = any (c_per_shop);

  select coalesce(string_agg(', ' || quote_ident(column_name), '' order by column_name), ''),
         coalesce(string_agg(', now()', ''), '')
    into v_stamp, v_stamp_val
  from information_schema.columns
  where table_schema = 'public' and table_name = 'category_presets'
    and column_name in ('created_at', 'updated_at');

  execute format(
    'insert into public.category_presets (org_id, user_id%s%s, %s)
     select $1, $2%s%s, %s from public.category_presets
     where org_id = $3 and is_active = true',
    v_stamp, v_blank, v_cols, v_stamp_val, v_blank_val, v_cols)
  using p_org, v_uid, v_founding;
  get diagnostics v_presets = row_count;

  return jsonb_build_object('categories', v_cats, 'presets', v_presets, 'source', 'founding');
end $$;


-- ── 2. The public SECURITY INVOKER wrapper (identical signature) ────────────

create or replace function public.seed_workspace_from_founding(p_org uuid)
returns jsonb
language sql
volatile
security invoker
set search_path = public, pg_temp
as $$ select app_private.seed_workspace_from_founding(p_org) $$;

comment on function public.seed_workspace_from_founding(uuid) is
  'Copies the founding workspace''s active categories and presets into an EMPTY workspace (074). ships_from, vendor, shopify_collection_id and policies are written NULL. Owner/admin of p_org only.';


-- ── 3. Privileges ───────────────────────────────────────────────────────────
-- Re-stated on every run: `create or replace` keeps an ACL, but a function
-- dropped and re-created by hand would come back with the PUBLIC default.

do $$
declare
  sig  text;
  r    text;
  sigs text[] := array[
    'app_private.seed_workspace_from_founding(uuid)',
    'public.seed_workspace_from_founding(uuid)'
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


-- ── 4. Tell PostgREST to re-read the schema ─────────────────────────────────

notify pgrst, 'reload schema';


-- ============================================================================
-- VERIFY (run separately, in the SQL Editor)
-- ============================================================================
-- (a) The wrapper in public with prosecdef = f, the body in app_private with
--     prosecdef = t, identical arguments and results (section 18 #46), and
--     row_security = off on the body:
--
--   select n.nspname, p.oid::regprocedure::text, p.prosecdef, p.proconfig,
--          pg_get_function_arguments(p.oid), pg_get_function_result(p.oid)
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where p.proname = 'seed_workspace_from_founding'
--   order by 1;
--
-- (b) anon cannot execute either half; authenticated can; anon has no usage
--     on app_private:
--
--   select p.oid::regprocedure::text,
--          has_function_privilege('anon', p.oid, 'execute')          as anon,
--          has_function_privilege('authenticated', p.oid, 'execute') as authed
--   from pg_proc p where p.proname = 'seed_workspace_from_founding';
--   select has_schema_privilege('anon', 'app_private', 'usage');   -- false
--
-- (c) What a new workspace would receive (no write):
--
--   select (select count(*) from public.categories c join public.organizations o on o.id = c.org_id
--            where o.slug = 'founding' and c.is_active) as categories,
--          (select count(*) from public.category_presets p join public.organizations o on o.id = p.org_id
--            where o.slug = 'founding' and p.is_active) as presets;
--
-- (d) No workspace other than the founding one holds the founding address,
--     vendor or policy text on a preset (run after a seed; expect zero rows):
--
--   select p.org_id, p.category_name from public.category_presets p
--   join public.category_presets f on f.org_id = (select id from public.organizations where slug = 'founding')
--   where p.org_id <> f.org_id
--     and ((p.ships_from is not null and p.ships_from = f.ships_from)
--       or (p.vendor is not null and p.vendor = f.vendor)
--       or (p.policies is not null and p.policies = f.policies));
--
-- (e) From the app, signed in as an owner or admin of an EMPTY workspace:
--     await supabase.rpc('seed_workspace_from_founding', { p_org: '<org>' })
--       -- { categories: N, presets: M, source: 'founding' }, then 'skipped'
--     as a plain member: 42501.


-- ============================================================================
-- ROLLBACK (run as postgres). Drops the function pair. Rows a seed already
-- copied stay where they are: they belong to their workspace now.
-- Run it BEFORE 054_security_function_hardening.sql's own rollback, whose
-- `drop schema app_private restrict` refuses while the body lives there.
-- ============================================================================
-- drop function if exists public.seed_workspace_from_founding(uuid);
-- drop function if exists app_private.seed_workspace_from_founding(uuid);
-- notify pgrst, 'reload schema';
