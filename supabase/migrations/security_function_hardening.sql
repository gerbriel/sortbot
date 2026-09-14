-- ============================================================================
-- SECURITY FUNCTION HARDENING — Supabase linter 0011 / 0028 / 0029
-- ============================================================================
-- Run in the Supabase SQL Editor (as `postgres`, which owns every function
-- touched here) AFTER every migration that creates one of them. Purely
-- additive: no table, column, policy, trigger or function BODY is changed.
-- Idempotent — safe to run any number of times. Rollback at the bottom.
--
-- WHAT THE LINTER FLAGGED
--   0011 function_search_path_mutable — public.crm_touch_updated_at,
--        public.finance_touch_updated_at ship with no fixed search_path.
--   0028 anon_security_definer_function_executable
--   0029 authenticated_security_definer_function_executable
--        — EVERY SECURITY DEFINER function in the exposed `public` schema is
--        executable by `anon` and `authenticated`. Not because anyone granted
--        it: `CREATE FUNCTION` grants EXECUTE to PUBLIC by default, and a
--        later `grant execute ... to authenticated` never revokes that. So the
--        logged-out landing page could call is_beta_admin(), user_org_ids(),
--        default_org_id(), storage_prefix_writable() and the six trigger
--        functions. None of them LEAK anything on their own (they all key off
--        auth.uid(), which is NULL for anon), but a SECURITY DEFINER function
--        reachable by the anonymous role is a standing invitation, and every
--        future edit to one of these bodies would be written under the wrong
--        assumption about who can reach it.
--
-- THE THREE TREATMENTS (per function; see docs/reviews/13-function-hardening.md)
--
--   A. RPC-FACING (the 9 the client calls by name through supabase.rpc):
--      revoke from PUBLIC + anon, keep `authenticated`. 0028 clears; 0029
--      REMAINS BY DESIGN on these nine and is documented — they must sit in
--      the exposed schema to be callable, and SECURITY INVOKER is impossible
--      because they read auth.users and cross-tenant rows that org RLS hides
--      from their caller. Their real boundary is the is_beta_admin() check in
--      the first lines of each body, which raises 42501 for everyone else.
--
--   B. TRIGGER FUNCTIONS + INTERNAL GUARDS (never called by name from any
--      client): revoke from PUBLIC, anon AND authenticated. 0028 and 0029
--      both clear. PROVEN SAFE — firing a trigger does NOT require the
--      invoking role to hold EXECUTE on the trigger function (the trigger
--      manager calls it on the table's behalf); and the guards are only ever
--      `perform`ed from inside SECURITY DEFINER bodies that already run as
--      this file's owner. Same treatment for the maintenance-only functions
--      (…_prune, get_next_batch_number, update_export_batch_stats): nothing in
--      src/ calls them, and the founder runs them from the SQL Editor as
--      `postgres`, the owner, whose EXECUTE no revoke here touches.
--
--   C. POLICY / COLUMN-DEFAULT HELPERS (is_beta_admin, user_org_ids,
--      default_org_id, is_org_admin, org_has_members, invited_role,
--      auth_email_verified, storage_prefix_writable): MOVED OUT of the exposed
--      API schema into `app_private`, which PostgREST does not serve — 0028
--      and 0029 both clear because the linter only inspects exposed schemas.
--      They keep `grant execute ... to authenticated`, which is NOT optional:
--      an RLS policy expression, a column DEFAULT and a CHECK constraint each
--      require the INVOKING role to hold EXECUTE on the functions they call
--      (verified empirically — a revoke breaks the INSERT with "permission
--      denied for function"). A trigger, notably, does not.
--
--      Policies, column DEFAULTs, CHECK constraints and triggers all reference
--      a function by OID, so they follow it across the schema move untouched
--      (also verified empirically). FUNCTION BODIES DO NOT — a `language sql`
--      or `plpgsql` body is stored as TEXT and re-resolves `public.x()` at
--      execution time, so every body in the repo that calls one of these by
--      name (beta_org_directory, finance_summary, storage_prefix_writable,
--      invited_role, support_thread_before_insert, the founding_* RPCs, …)
--      would break the moment the target left `public`. That is why section 3
--      leaves a SAME-NAME SECURITY INVOKER WRAPPER in `public` for each moved
--      helper: every existing body, every future migration and any client
--      calling by name keeps working, the wrapper itself is not SECURITY
--      DEFINER so it raises no 0028/0029, and anon is revoked from it too.
--
-- service_role is granted back everywhere it had access through PUBLIC. It
-- already bypasses RLS, so this changes no boundary; it only keeps today's
-- reachability for anything the Edge Functions or maintenance scripts do.
-- ============================================================================


-- ── 1. The private schema ───────────────────────────────────────────────────
-- Not in PostgREST's exposed schema list, so nothing here is reachable over
-- the REST API by any role — only from inside the database.

create schema if not exists app_private;
revoke all on schema app_private from public;
comment on schema app_private is
  'Internal helpers called only by RLS policies, column DEFAULTs and other '
  'functions. NOT exposed through PostgREST. See security_function_hardening.sql.';

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant usage on schema app_private to authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant usage on schema app_private to service_role';
  end if;
end $$;


-- ── 2. Move the policy / column-default helpers into app_private ────────────
-- Guarded three ways so a re-run is a no-op:
--   * the function must exist in public,
--   * it must still be the SECURITY DEFINER original (never the section-3
--     wrapper, which is SECURITY INVOKER),
--   * app_private must not already hold one of that signature.

do $$
declare
  sig     text;
  target  text;
  f       oid;
  sigs    text[] := array[
    'public.is_beta_admin()',
    'public.user_org_ids()',
    'public.default_org_id()',
    'public.is_org_admin(uuid)',
    'public.org_has_members(uuid)',
    'public.invited_role(uuid)',
    'public.auth_email_verified()',
    'public.storage_prefix_writable(text)'
  ];
begin
  foreach sig in array sigs loop
    f := to_regprocedure(sig);
    if f is null then
      raise notice 'hardening: % not present — skipped', sig;
      continue;
    end if;
    if not (select prosecdef from pg_proc where oid = f) then
      raise notice 'hardening: % is already the SECURITY INVOKER wrapper — skipped', sig;
      continue;
    end if;
    target := replace(sig, 'public.', 'app_private.');
    if to_regprocedure(target) is not null then
      raise notice 'hardening: % already exists — leaving public copy for section 3 to replace', target;
      continue;
    end if;
    execute format('alter function %s set schema app_private', sig);
    raise notice 'hardening: moved % -> app_private', sig;
  end loop;
end $$;


-- ── 3. Same-name SECURITY INVOKER wrappers in public ────────────────────────
-- These exist so that TEXT bodies keep resolving. They are deliberately NOT
-- SECURITY DEFINER (no 0028/0029) — they simply delegate, and the function
-- they delegate to is the one that carries the definer rights.
--
-- `create or replace` also REPAIRS the state you land in if an older migration
-- file is re-run later and recreates its own public SECURITY DEFINER copy: this
-- statement overwrites that copy with the wrapper again. See "RE-RUN AFTER".
--
-- Every wrapper pins a search_path (0011 applies to invoker functions too) and
-- mirrors the original's volatility, return type and PARAMETER NAMES, so
-- named-argument calls (`is_org_admin(p_org => …)`) are unaffected.

do $$
begin
  if to_regprocedure('app_private.is_beta_admin()') is not null then
    execute $f$
      create or replace function public.is_beta_admin()
      returns boolean language sql stable security invoker
      set search_path = app_private, public
      as $body$ select app_private.is_beta_admin() $body$
    $f$;
  end if;

  if to_regprocedure('app_private.user_org_ids()') is not null then
    execute $f$
      create or replace function public.user_org_ids()
      returns setof uuid language sql stable security invoker
      set search_path = app_private, public
      as $body$ select * from app_private.user_org_ids() $body$
    $f$;
  end if;

  if to_regprocedure('app_private.default_org_id()') is not null then
    execute $f$
      create or replace function public.default_org_id()
      returns uuid language sql stable security invoker
      set search_path = app_private, public
      as $body$ select app_private.default_org_id() $body$
    $f$;
  end if;

  if to_regprocedure('app_private.is_org_admin(uuid)') is not null then
    execute $f$
      create or replace function public.is_org_admin(p_org uuid)
      returns boolean language sql stable security invoker
      set search_path = app_private, public
      as $body$ select app_private.is_org_admin(p_org) $body$
    $f$;
  end if;

  if to_regprocedure('app_private.org_has_members(uuid)') is not null then
    execute $f$
      create or replace function public.org_has_members(p_org uuid)
      returns boolean language sql stable security invoker
      set search_path = app_private, public
      as $body$ select app_private.org_has_members(p_org) $body$
    $f$;
  end if;

  if to_regprocedure('app_private.invited_role(uuid)') is not null then
    execute $f$
      create or replace function public.invited_role(p_org uuid)
      returns text language sql stable security invoker
      set search_path = app_private, public
      as $body$ select app_private.invited_role(p_org) $body$
    $f$;
  end if;

  if to_regprocedure('app_private.auth_email_verified()') is not null then
    execute $f$
      create or replace function public.auth_email_verified()
      returns boolean language sql stable security invoker
      set search_path = app_private, public
      as $body$ select app_private.auth_email_verified() $body$
    $f$;
  end if;

  if to_regprocedure('app_private.storage_prefix_writable(text)') is not null then
    execute $f$
      create or replace function public.storage_prefix_writable(p_prefix text)
      returns boolean language sql stable security invoker
      set search_path = app_private, public
      as $body$ select app_private.storage_prefix_writable(p_prefix) $body$
    $f$;
  end if;
end $$;


-- ── 4. Privileges ───────────────────────────────────────────────────────────
-- One helper block; every section below feeds it a list of signatures.
--   grantees := the roles that KEEP execute. PUBLIC and every other client
--   role listed in `strip` is revoked first, so the result is exact rather
--   than additive.

create or replace function app_private._harden(
  p_sigs     text[],
  p_grantees text[]
) returns void
language plpgsql
set search_path = app_private, public
as $$
declare
  sig text;
  r   text;
begin
  foreach sig in array p_sigs loop
    if to_regprocedure(sig) is null then
      raise notice 'hardening: % not present — skipped', sig;
      continue;
    end if;
    -- A function this project does not own (an extension's, say) is reported
    -- and skipped rather than aborting the whole file.
    begin
      execute format('revoke all on function %s from public', sig);
      foreach r in array array['anon', 'authenticated', 'service_role'] loop
        if exists (select 1 from pg_roles where rolname = r) then
          execute format('revoke all on function %s from %I', sig, r);
        end if;
      end loop;
      foreach r in array p_grantees loop
        if exists (select 1 from pg_roles where rolname = r) then
          execute format('grant execute on function %s to %I', sig, r);
        end if;
      end loop;
    exception when insufficient_privilege then
      raise warning 'hardening: not the owner of % — left unchanged', sig;
    end;
  end loop;
end $$;

revoke all on function app_private._harden(text[], text[]) from public;


-- ── 5. Group A — RPC-facing SECURITY DEFINER (0028 clears, 0029 intentional) ─
-- The exact set the client calls: grep `supabase.rpc(` over src/. Each of
-- these gates internally on is_beta_admin() and raises 42501 otherwise.

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


-- ── 6. Group B(i) — maintenance-only SECURITY DEFINER (both clear) ──────────
-- Nothing in src/ or scripts/ calls these. The founder runs them from the SQL
-- Editor, which connects as `postgres` — the owner — so the revoke below does
-- not affect that. If one of them ever gets a UI, grant it back in ONE line.

select app_private._harden(array[
  'public.analytics_prune(int)',
  'public.app_errors_prune(int)',
  'public.get_next_batch_number(uuid)',
  'public.get_next_batch_number()',
  'public.update_export_batch_stats(uuid)'
], array['service_role']);


-- ── 7. Group B(ii) — trigger functions + internal guards (both clear) ───────
-- A trigger fires regardless of the invoking role's EXECUTE privilege, and the
-- two guards are only `perform`ed from inside SECURITY DEFINER bodies running
-- as the owner. No client role needs EXECUTE on any of these — including
-- service_role, whose writes fire the same triggers the same way.

select app_private._harden(array[
  -- SECURITY DEFINER triggers
  'public.analytics_rate_limit()',
  'public.app_errors_rate_limit()',
  'public.support_after_message()',
  'public.support_message_rate_limit()',
  'public.support_thread_before_insert()',
  'public.support_thread_before_update()',
  -- SECURITY DEFINER internal guards (founding_user_admin.sql)
  'public.assert_founding_admin()',
  'public.guard_founding_admins()',
  -- plain (SECURITY INVOKER) triggers — no 0028/0029, revoked for consistency
  'public.crm_touch_updated_at()',
  'public.finance_touch_updated_at()',
  -- legacy triggers from the pre-tenancy era, if still present
  'public.update_category_presets_updated_at()',
  'public.update_categories_updated_at()',
  'public.update_export_batches_updated_at()',
  'public.handle_updated_at()',
  'public.handle_new_user()'
], array[]::text[]);


-- ── 8. Group C — the moved helpers, and their public wrappers ───────────────
-- EXECUTE for `authenticated` is load-bearing here, not cosmetic: RLS policy
-- expressions, column DEFAULTs (org_id on eight tables) and CHECK constraints
-- all run the function AS THE INVOKING ROLE and fail with 42501 without it.
-- anon is revoked: no anon-reachable policy or DEFAULT calls any of them
-- (anon may INSERT into analytics_events, app_errors and beta_signups only,
-- and none of those three has a helper in a policy or a column default).

select app_private._harden(array[
  'app_private.is_beta_admin()',
  'app_private.user_org_ids()',
  'app_private.default_org_id()',
  'app_private.is_org_admin(uuid)',
  'app_private.org_has_members(uuid)',
  'app_private.invited_role(uuid)',
  'app_private.auth_email_verified()',
  'app_private.storage_prefix_writable(text)'
], array['authenticated', 'service_role']);

select app_private._harden(array[
  'public.is_beta_admin()',
  'public.user_org_ids()',
  'public.default_org_id()',
  'public.is_org_admin(uuid)',
  'public.org_has_members(uuid)',
  'public.invited_role(uuid)',
  'public.auth_email_verified()',
  'public.storage_prefix_writable(text)'
], array['authenticated', 'service_role']);


-- ── 9. 0011 — pin a search_path on any function still missing one ───────────
-- ONLY where none is set. crm_touch_updated_at and finance_touch_updated_at
-- are the two the linter names; the loop catches any future straggler without
-- clobbering the ones that deliberately carry something wider
-- (`public, auth` on auth_email_verified, `public, pg_temp` on the legacy
-- trigger functions).

do $$
declare r record;
begin
  for r in
    select n.nspname, p.oid::regprocedure::text as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'app_private')
      and p.prokind = 'f'
      and not exists (
        select 1 from unnest(coalesce(p.proconfig, '{}')) c
        where c like 'search\_path=%'
      )
  loop
    begin
      execute format('alter function %s set search_path = public', r.sig);
      raise notice 'hardening: pinned search_path=public on %', r.sig;
    exception when insufficient_privilege then
      raise warning 'hardening: not the owner of % — search_path left unpinned', r.sig;
    end;
  end loop;
end $$;


-- ============================================================================
-- VERIFY (run after, in the SQL Editor)
-- ============================================================================
-- Expect exactly the nine Group A rows, and nothing else:
--
--   select p.oid::regprocedure::text as fn,
--          has_function_privilege('anon',          p.oid, 'EXECUTE') as anon,
--          has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and p.prosecdef
--     and (has_function_privilege('anon', p.oid, 'EXECUTE')
--          or has_function_privilege('authenticated', p.oid, 'EXECUTE'))
--   order by 1;
--
-- And no function anywhere without a pinned search_path:
--
--   select p.oid::regprocedure::text from pg_proc p
--   join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname in ('public','app_private') and p.prokind='f'
--     and not exists (select 1 from unnest(coalesce(p.proconfig,'{}')) c
--                     where c like 'search\_path=%');


-- ============================================================================
-- ⚠ RE-RUN THIS FILE AFTER any of these, and ONLY these
-- ============================================================================
-- Each one contains a `create or replace function public.<helper>` for a
-- Group C helper. Re-running it plants a fresh SECURITY DEFINER copy in
-- `public` ALONGSIDE the app_private original — 0028/0029 come back for that
-- helper. (Nothing breaks: policies, DEFAULTs and CHECKs keep pointing at the
-- app_private OID. It is a linter regression, not an outage.) Section 3's
-- `create or replace` turns the stray copy back into the wrapper, and the rest
-- of this file re-applies the grants, so one re-run of THIS file is the whole
-- fix.
--
--   supabase/migrations/multi_org_tenancy.sql      → user_org_ids, default_org_id,
--                                                    is_org_admin, org_has_members,
--                                                    invited_role
--   supabase/migrations/beta_signups.sql           → is_beta_admin
--   supabase/migrations/security_verified_email.sql→ auth_email_verified, invited_role
--   supabase/migrations/security_storage_policies.sql → storage_prefix_writable
--
-- Every other migration only ADDS grants to functions this file already
-- handles (re-running those restores PUBLIC/anon EXECUTE on the Group A/B
-- functions they define, so the same rule applies — re-run this file after any
-- migration you replay).


-- ============================================================================
-- ROLLBACK (paste into the SQL Editor to undo this file completely)
-- ============================================================================
-- Restores the pre-hardening state: each helper back in `public` as SECURITY
-- DEFINER (policies, DEFAULTs and CHECKs follow it home by OID, exactly as
-- they followed it out), and EXECUTE back to PUBLIC on everything this file
-- revoked. Verified end to end on a throwaway cluster.
--
-- ONE CASE NEEDS A HUMAN. If an older migration was REPLAYED while this file
-- was in force, the policies it recreated bound to the section-3 WRAPPER, and
-- Postgres will not let the wrapper be dropped out from under them. The block
-- below reports each such helper by name and leaves it hardened (a perfectly
-- working state — the app does not care) instead of cascading policies away.
-- To finish rolling that helper back: drop the policies it names, run this
-- block again, then re-run the migration that owns those policies so they are
-- recreated against the restored public function.
--
-- NOT reverted on purpose: the search_path pinned on crm_touch_updated_at and
-- finance_touch_updated_at in section 9. It is the 0011 fix, it changes no
-- behavior, and unpinning it would only restore a search_path-injection
-- surface. To undo it anyway:
--   alter function public.crm_touch_updated_at()     reset search_path;
--   alter function public.finance_touch_updated_at() reset search_path;
--
-- do $$
-- declare sig text; f oid; dep text;
-- begin
--   -- 1. drop each wrapper, then move the original home
--   foreach sig in array array[
--     'is_beta_admin()', 'user_org_ids()', 'default_org_id()',
--     'is_org_admin(uuid)', 'org_has_members(uuid)', 'invited_role(uuid)',
--     'auth_email_verified()', 'storage_prefix_writable(text)'
--   ] loop
--     if to_regprocedure('app_private.' || sig) is null then continue; end if;
--     begin
--       f := to_regprocedure('public.' || sig);
--       if f is not null and not (select prosecdef from pg_proc where oid = f) then
--         execute format('drop function public.%s', sig);   -- never CASCADE
--       end if;
--       execute format('alter function app_private.%s set schema public', sig);
--       raise notice 'rollback: app_private.% -> public', sig;
--     exception when dependent_objects_still_exist then
--       select string_agg(c.relname || '.' || pol.polname, ', ')
--         into dep
--         from pg_policy pol join pg_class c on c.oid = pol.polrelid
--        where pg_get_expr(coalesce(pol.polqual, pol.polwithcheck), pol.polrelid)
--              like '%' || split_part(sig, '(', 1) || '%';
--       raise warning 'rollback: public.% kept (a replayed migration bound these to the wrapper: %). Drop them, re-run this block, then re-run their migration.', sig, coalesce(dep, 'unknown');
--     end;
--   end loop;
--   -- 2. hand EXECUTE back to PUBLIC on everything this file revoked
--   foreach sig in array array[
--     'public.analytics_summary(int)', 'public.app_errors_summary(int)',
--     'public.beta_org_directory()', 'public.crm_sync_contacts()',
--     'public.finance_summary(date, date)', 'public.founding_list_users()',
--     'public.founding_set_membership(uuid, uuid, text)',
--     'public.founding_remove_membership(uuid, uuid)',
--     'public.founding_move_user(uuid, uuid, uuid, text)',
--     'public.analytics_prune(int)', 'public.app_errors_prune(int)',
--     'public.get_next_batch_number(uuid)', 'public.get_next_batch_number()',
--     'public.update_export_batch_stats(uuid)',
--     'public.analytics_rate_limit()', 'public.app_errors_rate_limit()',
--     'public.support_after_message()', 'public.support_message_rate_limit()',
--     'public.support_thread_before_insert()', 'public.support_thread_before_update()',
--     'public.assert_founding_admin()', 'public.guard_founding_admins()',
--     'public.crm_touch_updated_at()', 'public.finance_touch_updated_at()',
--     'public.update_category_presets_updated_at()', 'public.update_categories_updated_at()',
--     'public.update_export_batches_updated_at()', 'public.handle_updated_at()',
--     'public.handle_new_user()',
--     'public.is_beta_admin()', 'public.user_org_ids()', 'public.default_org_id()',
--     'public.is_org_admin(uuid)', 'public.org_has_members(uuid)',
--     'public.invited_role(uuid)', 'public.auth_email_verified()',
--     'public.storage_prefix_writable(text)'
--   ] loop
--     if to_regprocedure(sig) is not null then
--       execute format('grant execute on function %s to public', sig);
--     end if;
--   end loop;
-- end $$;
-- drop function if exists app_private._harden(text[], text[]);
-- -- RESTRICT, never CASCADE: if a helper could not be moved home the schema
-- -- still holds it (and live policies point at it), so this must refuse.
-- drop schema if exists app_private restrict;
