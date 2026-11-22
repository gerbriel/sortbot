-- ============================================================================
-- 067_fix_signup_trigger.sql
-- Sign-up has been failing with "Database error saving new user" (auth 500).
--
-- WHY
--   auth.users has an AFTER INSERT trigger, on_auth_user_created, that calls
--   public.handle_new_user() to create the user's public.user_profiles row.
--   The ad-hoc root script fix_security_warnings.sql (June 2026) rewrote that
--   function as SECURITY INVOKER with search_path = '' on the belief that "the
--   trigger fires as the postgres role". It does not. An insert into auth.users
--   is performed by the auth service as supabase_auth_admin, so an INVOKER
--   trigger runs as supabase_auth_admin, which holds no privilege on
--   public.user_profiles (and that table has RLS with owner-only policies).
--   The insert raises, the auth transaction rolls back, and every sign-up,
--   invite acceptance and admin createUser fails. The newest auth.users row is
--   from February 2026, consistent with the break landing with that script.
--
-- WHAT THIS FILE DOES
--   * Re-creates public.handle_new_user() as SECURITY DEFINER (runs as its
--     owner, postgres, which bypasses RLS and owns user_profiles) with
--     search_path = public, pg_temp.
--   * Makes the profile insert idempotent (ON CONFLICT (id) DO UPDATE keeps
--     the email current) and WRAPS it so a profile-bookkeeping failure can
--     never block an account from being created: the error is logged as a
--     WARNING and the trigger still returns NEW. user_profiles is read by
--     nothing in the app today; auth must not depend on it.
--   * Re-applies the 054 privilege rule (EXECUTE revoked from PUBLIC, anon,
--     authenticated, service_role: a trigger fires without the caller holding
--     EXECUTE).
--   * Re-creates the trigger on auth.users if it is missing, guarded, because
--     postgres may lack TRIGGER privilege on auth.users on some projects; in
--     that case a NOTICE says so and nothing else changes.
--   * Backfills a profile for any auth user that has none.
--
-- IDEMPOTENT: create or replace, if not exists, on conflict; safe to re-run.
-- The ROLLBACK at the bottom restores the SECURITY INVOKER body for the record
-- only; do not actually run it, that is the broken state.
-- ============================================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  begin
    insert into public.user_profiles (id, email, created_at, updated_at)
    values (new.id, new.email, now(), now())
    on conflict (id) do update
      set email = excluded.email,
          updated_at = now();
  exception when others then
    -- Profile bookkeeping must never block account creation.
    raise warning 'handle_new_user: % (%)', sqlerrm, sqlstate;
  end;
  return new;
end $$;

-- 054 rule for trigger functions: no client role needs EXECUTE.
do $$
declare r text;
begin
  revoke all on function public.handle_new_user() from public;
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on function public.handle_new_user() from %I', r);
    end if;
  end loop;
end $$;

-- The trigger itself, if it was ever dropped.
do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'on_auth_user_created' and tgrelid = 'auth.users'::regclass
  ) then
    begin
      execute 'create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user()';
      raise notice 'handle_new_user: trigger on_auth_user_created re-created';
    exception when insufficient_privilege then
      raise notice 'handle_new_user: cannot create the trigger on auth.users as this role; create it from the dashboard as the auth admin';
    end;
  end if;
end $$;

-- Backfill: any account that signed up while the trigger was broken but
-- somehow got through (none expected), or whose profile was deleted.
insert into public.user_profiles (id, email, created_at, updated_at)
select u.id, u.email::text, coalesce(u.created_at, now()), now()
from auth.users u
where not exists (select 1 from public.user_profiles p where p.id = u.id)
on conflict (id) do nothing;


-- ============================================================================
-- VERIFY (run separately)
-- ============================================================================
-- select prosecdef, proconfig from pg_proc
--   where oid = 'public.handle_new_user()'::regprocedure;
-- -- expect: prosecdef = true, proconfig = {search_path=public, pg_temp}
-- select tgname, tgenabled from pg_trigger
--   where tgrelid = 'auth.users'::regclass and tgname = 'on_auth_user_created';
-- -- expect: one row, tgenabled = 'O'
-- -- Then sign up a throwaway account in the app: it must succeed.


-- ============================================================================
-- ROLLBACK (for the record only: this is the broken state)
-- ============================================================================
-- create or replace function public.handle_new_user()
-- returns trigger language plpgsql security invoker set search_path = ''
-- as $$
-- begin
--   insert into public.user_profiles (id, email, created_at, updated_at)
--   values (new.id, new.email, now(), now())
--   on conflict (id) do nothing;
--   return new;
-- end $$;
