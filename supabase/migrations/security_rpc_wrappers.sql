-- ============================================================================
-- SECURITY RPC WRAPPERS — clears the last nine linter 0029 warnings
-- ============================================================================
-- Run in the Supabase SQL Editor (as `postgres`, the owner) AFTER
-- security_function_hardening.sql. Purely additive; no table, column, policy,
-- trigger or function BODY changes. Idempotent. Rollback at the bottom.
--
-- WHY THIS EXISTS
--   security_function_hardening.sql deliberately LEFT 0029 raised on the nine
--   functions the client calls through `supabase.rpc(...)`: they have to live
--   in the exposed `public` schema to be reachable over PostgREST, and they
--   cannot be SECURITY INVOKER because they read auth.users and cross-tenant
--   rows that org RLS hides from their caller. That reasoning was about the
--   FUNCTION needing to stay reachable — not about the DEFINER RIGHTS needing
--   to be reachable. Splitting the two removes the warning without weakening
--   anything: the SECURITY DEFINER body moves into `app_private` (unexposed),
--   and a SECURITY INVOKER wrapper with an IDENTICAL SIGNATURE keeps
--   /rest/v1/rpc/<fn> answering exactly as before.
--
-- WHAT "IDENTICAL SIGNATURE" MEANS HERE, AND WHY IT IS NOT NEGOTIABLE
--   PostgREST resolves an RPC by matching the POSTed JSON KEYS to the
--   function's ARGUMENT NAMES, and renders the response from its RETURN TYPE.
--   So each wrapper below reproduces, verbatim:
--     * argument names — p_days / p_from / p_to / p_user / p_org / p_role /
--       p_from_org / p_to_org, the exact keys src/ sends;
--     * argument DEFAULTS — `p_days int default 30` (analytics), `default 7`
--       (app_errors), `p_role text default null` (founding_move_user), so a
--       call that omits them still resolves;
--     * the return type — `jsonb` for the five scalar ones, `void` for the
--       three mutators (PostgREST answers 204), and the full `returns table
--       (...)` COLUMN LIST, in order, for beta_org_directory and
--       founding_list_users (PostgREST names the JSON keys from those columns,
--       so a reordered or renamed column is a silent client break);
--     * the VOLATILITY — `stable` on the two table-returning readers, volatile
--       on the rest. PostgREST allows GET only for non-volatile functions;
--       supabase-js POSTs, but the class must not change underneath it.
--
-- THE GATE STILL WORKS. Each moved original opens with `is_beta_admin()`
-- (directly, or via assert_founding_admin()). That name resolves to the
-- SECURITY INVOKER wrapper security_function_hardening.sql left in `public`,
-- which delegates to app_private.is_beta_admin() — still SECURITY DEFINER,
-- still reading auth.uid() from the request JWT. A non-founder still gets
-- 42501 from the five gated RPCs and zero rows from the two readers.
--
-- ORDER MATTERS FOR ROLLBACK: this file must be rolled back BEFORE
-- security_function_hardening.sql, whose own rollback ends with
-- `drop schema app_private restrict` and will (correctly) refuse while these
-- nine still live there.
--
-- AFTER THIS FILE THE LINTER CAN NO LONGER SEE A SINGLE SECURITY DEFINER
-- FUNCTION — every one of them sits in `app_private`, or has EXECUTE revoked
-- from anon and authenticated. That is the goal, and it is also the hazard:
-- the linter will no longer warn you about the NEXT one. The grouping rules in
-- CLAUDE.md §18 are from here on the only thing standing between a new
-- SECURITY DEFINER function and the anonymous role. Read them before adding
-- one.
-- ============================================================================


-- ── 0. Preconditions ────────────────────────────────────────────────────────

do $$
begin
  if to_regnamespace('app_private') is null then
    raise exception
      'security_rpc_wrappers.sql: app_private does not exist — run security_function_hardening.sql first.';
  end if;
end $$;


-- ── 1. Move the nine originals into app_private ─────────────────────────────
-- Same three guards as the first file: must exist in public, must still be the
-- SECURITY DEFINER original (never the section-2 wrapper), must not already
-- have an app_private twin. A function absent from this project (e.g.
-- app_errors_summary, if app_errors.sql was never applied) is reported and
-- skipped, so this file is correct on any subset.

do $$
declare
  sig    text;
  target text;
  f      oid;
  sigs   text[] := array[
    'public.analytics_summary(int)',
    'public.app_errors_summary(int)',
    'public.beta_org_directory()',
    'public.crm_sync_contacts()',
    'public.finance_summary(date, date)',
    'public.founding_list_users()',
    'public.founding_set_membership(uuid, uuid, text)',
    'public.founding_remove_membership(uuid, uuid)',
    'public.founding_move_user(uuid, uuid, uuid, text)'
  ];
begin
  foreach sig in array sigs loop
    f := to_regprocedure(sig);
    if f is null then
      raise notice 'rpc-wrappers: % not present — skipped', sig;
      continue;
    end if;
    if not (select prosecdef from pg_proc where oid = f) then
      raise notice 'rpc-wrappers: % is already the SECURITY INVOKER wrapper — skipped', sig;
      continue;
    end if;
    target := replace(sig, 'public.', 'app_private.');
    if to_regprocedure(target) is not null then
      raise notice 'rpc-wrappers: % already exists — leaving public copy for section 2 to replace', target;
      continue;
    end if;
    execute format('alter function %s set schema app_private', sig);
    raise notice 'rpc-wrappers: moved % -> app_private', sig;
  end loop;
end $$;


-- ── 2. The public SECURITY INVOKER wrappers ─────────────────────────────────
-- One per function, created only when its app_private original is present.
-- `create or replace` also repairs the state you land in when a source
-- migration is replayed and plants a fresh SECURITY DEFINER copy here.

do $$
begin

-- analytics_summary(p_days int default 30) -> jsonb   [src/lib/analytics.ts]
if to_regprocedure('app_private.analytics_summary(int)') is not null then
  execute $f$
    create or replace function public.analytics_summary(p_days int default 30)
    returns jsonb language sql security invoker
    set search_path = public
    as $body$ select app_private.analytics_summary(p_days) $body$
  $f$;
end if;

-- app_errors_summary(p_days int default 7) -> jsonb   [src/lib/errorReporter.ts]
if to_regprocedure('app_private.app_errors_summary(int)') is not null then
  execute $f$
    create or replace function public.app_errors_summary(p_days int default 7)
    returns jsonb language sql security invoker
    set search_path = public
    as $body$ select app_private.app_errors_summary(p_days) $body$
  $f$;
end if;

-- finance_summary(p_from date, p_to date) -> jsonb    [src/lib/financeService.ts]
if to_regprocedure('app_private.finance_summary(date, date)') is not null then
  execute $f$
    create or replace function public.finance_summary(p_from date, p_to date)
    returns jsonb language sql security invoker
    set search_path = public
    as $body$ select app_private.finance_summary(p_from, p_to) $body$
  $f$;
end if;

-- crm_sync_contacts() -> jsonb                        [src/lib/crmService.ts]
if to_regprocedure('app_private.crm_sync_contacts()') is not null then
  execute $f$
    create or replace function public.crm_sync_contacts()
    returns jsonb language sql security invoker
    set search_path = public
    as $body$ select app_private.crm_sync_contacts() $body$
  $f$;
end if;

-- beta_org_directory() -> table(11)                   [src/lib/betaService.ts]
-- Column list copied verbatim from beta_admin_directory.sql. PostgREST names
-- the JSON keys from it, so it must not drift.
if to_regprocedure('app_private.beta_org_directory()') is not null then
  execute $f$
    create or replace function public.beta_org_directory()
    returns table (
      org_id        uuid,
      name          text,
      slug          text,
      plan          text,
      created_at    timestamptz,
      member_count  bigint,
      member_emails text[],
      batch_count   bigint,
      product_count bigint,
      image_count   bigint,
      last_active   timestamptz
    )
    language sql stable security invoker
    set search_path = public
    as $body$ select * from app_private.beta_org_directory() $body$
  $f$;
end if;

-- founding_list_users() -> table(5)                   [src/lib/foundingAdminService.ts]
-- Column list copied verbatim from founding_user_admin.sql.
if to_regprocedure('app_private.founding_list_users()') is not null then
  execute $f$
    create or replace function public.founding_list_users()
    returns table (
      user_id         uuid,
      email           text,
      created_at      timestamptz,
      last_sign_in_at timestamptz,
      memberships     jsonb
    )
    language sql stable security invoker
    set search_path = public
    as $body$ select * from app_private.founding_list_users() $body$
  $f$;
end if;

-- founding_set_membership(p_user, p_org, p_role) -> void
if to_regprocedure('app_private.founding_set_membership(uuid, uuid, text)') is not null then
  execute $f$
    create or replace function public.founding_set_membership(
      p_user uuid,
      p_org  uuid,
      p_role text
    )
    returns void language sql security invoker
    set search_path = public
    as $body$ select app_private.founding_set_membership(p_user, p_org, p_role) $body$
  $f$;
end if;

-- founding_remove_membership(p_user, p_org) -> void
if to_regprocedure('app_private.founding_remove_membership(uuid, uuid)') is not null then
  execute $f$
    create or replace function public.founding_remove_membership(
      p_user uuid,
      p_org  uuid
    )
    returns void language sql security invoker
    set search_path = public
    as $body$ select app_private.founding_remove_membership(p_user, p_org) $body$
  $f$;
end if;

-- founding_move_user(p_user, p_from_org, p_to_org, p_role default null) -> void
-- The DEFAULT is load-bearing: foundingAdminService passes `p_role: role ?? null`,
-- but a future caller omitting the key must still resolve.
if to_regprocedure('app_private.founding_move_user(uuid, uuid, uuid, text)') is not null then
  execute $f$
    create or replace function public.founding_move_user(
      p_user     uuid,
      p_from_org uuid,
      p_to_org   uuid,
      p_role     text default null
    )
    returns void language sql security invoker
    set search_path = public
    as $body$ select app_private.founding_move_user(p_user, p_from_org, p_to_org, p_role) $body$
  $f$;
end if;

end $$;


-- ── 3. Privileges: `authenticated` only, on BOTH halves ─────────────────────
-- The wrapper needs EXECUTE for the request to get in; the app_private
-- original needs it because the wrapper is SECURITY INVOKER and therefore runs
-- as the caller. PUBLIC and anon are revoked from both. service_role is
-- granted back where PUBLIC used to give it access (it bypasses RLS already,
-- so this moves no boundary, and the linter does not look at it).

select app_private._harden(array[
  'app_private.analytics_summary(int)',
  'app_private.app_errors_summary(int)',
  'app_private.beta_org_directory()',
  'app_private.crm_sync_contacts()',
  'app_private.finance_summary(date, date)',
  'app_private.founding_list_users()',
  'app_private.founding_set_membership(uuid, uuid, text)',
  'app_private.founding_remove_membership(uuid, uuid)',
  'app_private.founding_move_user(uuid, uuid, uuid, text)'
], array['authenticated', 'service_role']);

select app_private._harden(array[
  'public.analytics_summary(int)',
  'public.app_errors_summary(int)',
  'public.beta_org_directory()',
  'public.crm_sync_contacts()',
  'public.finance_summary(date, date)',
  'public.founding_list_users()',
  'public.founding_set_membership(uuid, uuid, text)',
  'public.founding_remove_membership(uuid, uuid)',
  'public.founding_move_user(uuid, uuid, uuid, text)'
], array['authenticated', 'service_role']);


-- ── 4. Tell PostgREST to re-read the schema ─────────────────────────────────
-- Supabase reloads on DDL via an event trigger; this is the belt-and-braces
-- half, and harmless where the channel has no listener.

notify pgrst, 'reload schema';


-- ============================================================================
-- VERIFY (run after, in the SQL Editor)
-- ============================================================================
-- 1. No SECURITY DEFINER function is visible to anon or authenticated anywhere
--    in the exposed schema — expect ZERO rows:
--
--   select p.oid::regprocedure::text
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and p.prosecdef
--     and (has_function_privilege('anon', p.oid, 'EXECUTE')
--          or has_function_privilege('authenticated', p.oid, 'EXECUTE'));
--
-- 2. The nine wrappers exist with the right shape — expect nine rows, all
--    prosecdef = f:
--
--   select p.oid::regprocedure::text, p.prosecdef, pg_get_function_result(p.oid)
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and p.proname in (
--     'analytics_summary','app_errors_summary','beta_org_directory',
--     'crm_sync_contacts','finance_summary','founding_list_users',
--     'founding_set_membership','founding_remove_membership','founding_move_user')
--   order by 1;
--
-- 3. Signed in as a Founding admin, the app itself: Analytics, Errors,
--    Finance, CRM sync, Beta workspaces and the OrgPanel Users tab must all
--    still load. No client code changed, so any failure here is a signature
--    mismatch in section 2.


-- ============================================================================
-- ⚠ RE-RUN THIS FILE AFTER any of these, and ONLY these
-- ============================================================================
-- Each contains a `create or replace function public.<rpc>` for one of the
-- nine. Replaying it plants a fresh SECURITY DEFINER copy in `public` beside
-- the app_private original and 0029 returns for that function. Nothing breaks
-- — the stray copy is a complete, working function — but the linter regresses.
-- Section 2's `create or replace` turns it back into the wrapper.
--
--   supabase/migrations/analytics_events.sql    → analytics_summary
--   supabase/migrations/app_errors.sql          → app_errors_summary
--   supabase/migrations/beta_admin_directory.sql→ beta_org_directory
--   supabase/migrations/crm.sql                 → crm_sync_contacts
--   supabase/migrations/finance.sql             → finance_summary
--   supabase/migrations/founding_user_admin.sql → founding_list_users,
--                                                 founding_set_membership,
--                                                 founding_remove_membership,
--                                                 founding_move_user
--
-- The general rule is unchanged: after replaying ANY migration, run
-- security_function_hardening.sql and then this file. Both are no-ops when
-- nothing drifted, and they are safe in that order (the first file's Group A
-- list resolves to these wrappers and simply re-applies their grants).


-- ============================================================================
-- ROLLBACK (paste into the SQL Editor) — run BEFORE the first file's rollback
-- ============================================================================
-- Nothing in the database calls these nine by name (verified by grep over every
-- migration: the only `public.<rpc>(` occurrences are their own definitions,
-- their grants, and commented VERIFY/ROLLBACK lines), so unlike the Group C
-- helpers these wrappers have no policy dependents and drop cleanly. The
-- dependent_objects_still_exist handler is kept anyway, for the day one of
-- them is used in a view or a policy.
--
-- IT RESTORES THE *FILE-1* STATE, NOT THE PRISTINE ONE. security_function_hardening.sql
-- is still in force at this point, so each function comes home revoked from
-- PUBLIC + anon and granted to authenticated + service_role — exactly how the
-- first file left it. Handing EXECUTE back to PUBLIC here would silently undo
-- half of that file (measured: it re-raised anon on all nine). The first
-- file's own rollback is what restores PUBLIC, afterwards.
--
-- do $$
-- declare sig text; f oid; r text;
-- begin
--   foreach sig in array array[
--     'analytics_summary(int)', 'app_errors_summary(int)',
--     'beta_org_directory()', 'crm_sync_contacts()',
--     'finance_summary(date, date)', 'founding_list_users()',
--     'founding_set_membership(uuid, uuid, text)',
--     'founding_remove_membership(uuid, uuid)',
--     'founding_move_user(uuid, uuid, uuid, text)'
--   ] loop
--     if to_regprocedure('app_private.' || sig) is null then continue; end if;
--     begin
--       f := to_regprocedure('public.' || sig);
--       if f is not null and not (select prosecdef from pg_proc where oid = f) then
--         execute format('drop function public.%s', sig);   -- never CASCADE
--       end if;
--       execute format('alter function app_private.%s set schema public', sig);
--       -- back to the file-1 privilege shape
--       execute format('revoke all on function public.%s from public', sig);
--       foreach r in array array['anon', 'authenticated', 'service_role'] loop
--         if exists (select 1 from pg_roles where rolname = r) then
--           execute format('revoke all on function public.%s from %I', sig, r);
--         end if;
--       end loop;
--       foreach r in array array['authenticated', 'service_role'] loop
--         if exists (select 1 from pg_roles where rolname = r) then
--           execute format('grant execute on function public.%s to %I', sig, r);
--         end if;
--       end loop;
--       raise notice 'rollback: app_private.% -> public', sig;
--     exception when dependent_objects_still_exist then
--       raise warning 'rollback: public.% kept — something depends on the wrapper', sig;
--     end;
--   end loop;
-- end $$;
-- notify pgrst, 'reload schema';
