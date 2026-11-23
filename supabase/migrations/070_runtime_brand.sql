-- ============================================================================
-- 070_runtime_brand.sql
-- RUNTIME BRAND: the product name, its descriptor and its tagline as data the
-- founding workspace edits from the Founder console, read by every screen and
-- by the logged-out landing page.
-- ============================================================================
-- Run AFTER:
--     032_beta_signups.sql        (is_beta_admin())
--     039_founding_user_admin.sql (assert_founding_admin(), founding_admin_audit)
--     051_finance.sql             (finance_settings, key/value text, founders-only RLS)
--
-- Purely additive and idempotent: three new finance_settings rows
-- (`on conflict do nothing`, so a re-run never overwrites a name a founder
-- set), one public function and one function pair (`create or replace`). No
-- existing function, policy, grant or row is changed, and NO schema grant is
-- made to anon. Safe to run any number of times. Rollback at the bottom.
--
-- WHAT IT ADDS
--   finance_settings ('brand_name',       'SQRL')
--   finance_settings ('brand_descriptor', 'Super quick resale lister')
--   finance_settings ('brand_tagline',    'SQRL turns a camera roll of vintage ...')
--     Seeded from brand.json as of this file. brand.json stays the build-time
--     default (the static files, the native app names and the artwork follow
--     it through `npm run brand:apply` / `brand:assets`); these rows are what
--     the running app renders.
--
--   public.public_brand() returns jsonb   STABLE, SECURITY DEFINER (the exception below)
--     anyone, signed in or not (the landing page reads it logged out).
--     { "name", "descriptor", "tagline", "updated_at" }
--     Reads ONLY the three brand_* keys. finance_settings stays founders-only
--     by RLS; this definer function is the one window onto these three rows and
--     never onto the discount rules, the cutoff or the storage quota.
--     A missing row reads as NULL for that field; the client keeps its build
--     value for anything that is not a usable string.
--
--   public.founding_set_brand(p_name text, p_descriptor text, p_tagline text)
--     returns jsonb, the new public_brand() payload. Founding admins only
--     (assert_founding_admin(), 42501). Validation (22023):
--       name        trimmed, 1 to 24 characters, no line breaks
--       descriptor  trimmed, 0 to 120 characters, no line breaks
--       tagline     trimmed, 0 to 120 characters, no line breaks
--     Upserts the three keys and appends ONE founding_admin_audit row:
--     action 'set_brand', role = the new name (the audit table has no free
--     detail column; role is the free-text slot 069 also uses for its subject).
--
-- SHAPE AND PRIVILEGES (AGENTS.md section 18 #43 to #46, as 057/062/069)
--   founding_set_brand is an app_private SECURITY DEFINER body with
--   `set search_path = public, pg_temp` behind a public SECURITY INVOKER
--   wrapper with an IDENTICAL signature. EXECUTE is revoked from PUBLIC and
--   anon on both halves and granted to authenticated and service_role on both
--   halves (an invoker wrapper calls the body as the caller).
--
-- THE ONE EXCEPTION: public.public_brand() IS ITSELF SECURITY DEFINER
--   (AGENTS.md section 18, beside #45). The logged-out landing page calls it
--   as anon, and the two-half shape would need anon USAGE on app_private. A
--   schema-level grant to anon is a standing widening: any function created
--   there later with the default EXECUTE-to-PUBLIC would become anon-callable,
--   and no apply-time check can see functions added after it. So instead:
--     public.public_brand()  SECURITY DEFINER, STABLE, no parameters,
--                            `set search_path = public, pg_temp`, reads
--                            exactly the three brand_* keys and nothing else.
--     EXECUTE revoked from PUBLIC, granted to anon, authenticated, service_role.
--   A public SECURITY DEFINER is allowed ONLY for a parameterless, read-only,
--   anon-facing function that exposes a fixed allowlist of values. Supabase
--   linter 0029 lists it by design. The definer is needed because
--   finance_settings is readable by founders only (051's select policy is
--   is_beta_admin()); this function is the one window onto those three rows.
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
  if to_regprocedure('public.is_beta_admin()') is null then
    raise exception '070_runtime_brand.sql: is_beta_admin() is missing. Run 032_beta_signups.sql first.';
  end if;
  if to_regprocedure('public.assert_founding_admin()') is null
     or to_regclass('public.founding_admin_audit') is null then
    raise exception '070_runtime_brand.sql: run 039_founding_user_admin.sql first.';
  end if;
  if to_regclass('public.finance_settings') is null then
    raise exception '070_runtime_brand.sql: finance_settings is missing. Run 051_finance.sql first.';
  end if;
end $$;


-- ── 1. The seeds (brand.json as of this file; never overwritten) ────────────

insert into public.finance_settings (key, value, note) values
  ('brand_name', 'SQRL',
   'Product name rendered across the app and landing. Edit from the Founder console (founding_set_brand).'),
  ('brand_descriptor', 'Super quick resale lister',
   'What the name stands for: landing hero subtitle and footer line. Founder console.'),
  ('brand_tagline', 'SQRL turns a camera roll of vintage clothing photos into Shopify-ready listings.',
   'One-sentence product summary. Founder console. The static meta description follows brand.json.')
on conflict (key) do nothing;


-- ── 2. public.public_brand(): SECURITY DEFINER by design (see header) ───────
-- A pre-release draft of this file put the body in app_private; drop it if a
-- local database ever ran that draft, so there is exactly one public_brand.

drop function if exists app_private.public_brand();

create or replace function public.public_brand()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'name',       max(s.value) filter (where s.key = 'brand_name'),
    'descriptor', max(s.value) filter (where s.key = 'brand_descriptor'),
    'tagline',    max(s.value) filter (where s.key = 'brand_tagline'),
    'updated_at', max(s.updated_at)
  )
  from public.finance_settings s
  where s.key in ('brand_name', 'brand_descriptor', 'brand_tagline')
$$;


-- ── 3. app_private.founding_set_brand(...) ──────────────────────────────────

create or replace function app_private.founding_set_brand(
  p_name       text,
  p_descriptor text,
  p_tagline    text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_name       text := btrim(coalesce(p_name, ''));
  v_descriptor text := btrim(coalesce(p_descriptor, ''));
  v_tagline    text := btrim(coalesce(p_tagline, ''));
begin
  perform public.assert_founding_admin();

  if char_length(v_name) < 1 then
    raise exception 'The name cannot be empty.' using errcode = '22023';
  end if;
  if char_length(v_name) > 24 then
    raise exception 'The name can be at most 24 characters.' using errcode = '22023';
  end if;
  if v_name ~ '[\r\n]' then
    raise exception 'The name must be one line.' using errcode = '22023';
  end if;
  if char_length(v_descriptor) > 120 then
    raise exception 'The descriptor can be at most 120 characters.' using errcode = '22023';
  end if;
  if v_descriptor ~ '[\r\n]' then
    raise exception 'The descriptor must be one line.' using errcode = '22023';
  end if;
  if char_length(v_tagline) > 120 then
    raise exception 'The tagline can be at most 120 characters.' using errcode = '22023';
  end if;
  if v_tagline ~ '[\r\n]' then
    raise exception 'The tagline must be one line.' using errcode = '22023';
  end if;

  insert into public.finance_settings (key, value) values
    ('brand_name',       v_name),
    ('brand_descriptor', v_descriptor),
    ('brand_tagline',    v_tagline)
  on conflict (key) do update set value = excluded.value;

  insert into public.founding_admin_audit
    (actor_id, actor_email, action, role)
  values
    (auth.uid(), auth.jwt() ->> 'email', 'set_brand', v_name);

  return public.public_brand();
end $$;


-- ── 4. The public SECURITY INVOKER wrapper (identical signature) ────────────

create or replace function public.founding_set_brand(
  p_name       text,
  p_descriptor text,
  p_tagline    text
)
returns jsonb
language sql
security invoker
set search_path = public, pg_temp
as $$ select app_private.founding_set_brand(p_name, p_descriptor, p_tagline) $$;


-- ── 5. Privileges ───────────────────────────────────────────────────────────
-- Re-stated on every run: `create or replace` keeps an ACL, but a function
-- dropped and re-created by hand would come back with the PUBLIC default.

do $$
declare
  sig  text;
  r    text;
begin
  -- Both halves of the founder write: never anon.
  foreach sig in array array[
    'app_private.founding_set_brand(text, text, text)',
    'public.founding_set_brand(text, text, text)'
  ] loop
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

  -- The public read: one SECURITY DEFINER function, anon included (the
  -- logged-out landing page). No schema grant to anon anywhere.
  execute 'revoke all on function public.public_brand() from public';
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('grant execute on function public.public_brand() to %I', r);
    end if;
  end loop;
end $$;


-- ── 6. Tell PostgREST to re-read the schema ─────────────────────────────────

notify pgrst, 'reload schema';


-- ============================================================================
-- VERIFY (run separately, in the SQL Editor)
-- ============================================================================
-- (a) public.public_brand with prosecdef = t (the documented exception),
--     public.founding_set_brand with prosecdef = f, its app_private body with
--     prosecdef = t, identical arguments and results; no app_private.public_brand:
--
--   select n.nspname, p.oid::regprocedure::text, p.prosecdef, p.provolatile,
--          pg_get_function_arguments(p.oid), pg_get_function_result(p.oid)
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where p.proname in ('public_brand', 'founding_set_brand')
--   order by 2;
--
-- (b) anon can execute public_brand and NOT founding_set_brand (either half);
--     authenticated can execute all three:
--
--   select p.oid::regprocedure::text,
--          has_function_privilege('anon', p.oid, 'execute')          as anon,
--          has_function_privilege('authenticated', p.oid, 'execute') as authed
--   from pg_proc p
--   where p.proname in ('public_brand', 'founding_set_brand');
--
-- (c) anon has no USAGE on app_private (expect false):
--
--   select has_schema_privilege('anon', 'app_private', 'usage');
--
-- (d) From the app:
--     await supabase.rpc('public_brand')                      -- anyone, logged out included
--     await supabase.rpc('founding_set_brand', { p_name: 'SQRL',
--       p_descriptor: 'Super quick resale lister', p_tagline: '...' })  -- founders only, else 42501
--
-- (e) The read never leaks another finance_settings key:
--
--   select jsonb_object_keys(public.public_brand());   -- name, descriptor, tagline, updated_at


-- ============================================================================
-- ROLLBACK (run as postgres). Drops the three functions and the three
-- settings. The app falls back to brand.json (the client
-- reads a missing function as "keep the build value").
-- ============================================================================
-- drop function if exists public.founding_set_brand(text, text, text);
-- drop function if exists public.public_brand();
-- drop function if exists app_private.founding_set_brand(text, text, text);
-- delete from public.finance_settings
--  where key in ('brand_name', 'brand_descriptor', 'brand_tagline');
-- notify pgrst, 'reload schema';
