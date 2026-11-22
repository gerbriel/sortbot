-- ============================================================================
-- 068_user_profiles_cascade.sql
-- public.user_profiles.id references auth.users(id) with NO ON DELETE action
-- (schema.sql line 10). Since 067 restored the sign-up trigger, every account
-- gets a profile row again, and that row then BLOCKS deleting the user:
-- auth.admin.deleteUser and the dashboard's "Delete user" fail with a foreign
-- key violation ("Database error deleting user"). 066's account-deletion
-- function deletes the profile itself first, so in-app deletion is unaffected;
-- this file fixes the other two paths.
--
-- WHAT IT DOES
--   Re-creates the constraint as ON DELETE CASCADE. user_profiles holds only
--   (id, email, created_at, updated_at) mirrored from auth.users, read by
--   nothing in the app, so a profile without its user has no meaning.
--   Looks the constraint up by SHAPE (the single FK from user_profiles to
--   auth.users), not by name, so a renamed constraint is still found.
--
-- IDEMPOTENT: a constraint that already cascades is left alone; safe to re-run.
-- ROLLBACK at the bottom restores the no-action form.
-- ============================================================================

do $$
declare
  c record;
begin
  if to_regclass('public.user_profiles') is null then
    raise notice 'user_profiles: table absent, nothing to do';
    return;
  end if;

  for c in
    select con.conname, con.confdeltype
    from pg_constraint con
    where con.conrelid = 'public.user_profiles'::regclass
      and con.contype = 'f'
      and con.confrelid = 'auth.users'::regclass
  loop
    if c.confdeltype = 'c' then
      raise notice 'user_profiles: % already cascades', c.conname;
      continue;
    end if;
    execute format('alter table public.user_profiles drop constraint %I', c.conname);
    execute format(
      'alter table public.user_profiles add constraint %I foreign key (id) references auth.users(id) on delete cascade',
      c.conname);
    raise notice 'user_profiles: % re-created with on delete cascade', c.conname;
  end loop;

  if not exists (
    select 1 from pg_constraint con
    where con.conrelid = 'public.user_profiles'::regclass
      and con.contype = 'f' and con.confrelid = 'auth.users'::regclass
  ) then
    alter table public.user_profiles
      add constraint user_profiles_id_fkey foreign key (id) references auth.users(id) on delete cascade;
    raise notice 'user_profiles: user_profiles_id_fkey created with on delete cascade';
  end if;
end $$;


-- ============================================================================
-- VERIFY (run separately)
-- ============================================================================
-- select conname, confdeltype from pg_constraint
--   where conrelid = 'public.user_profiles'::regclass and contype = 'f';
-- -- expect: one row, confdeltype = 'c'


-- ============================================================================
-- ROLLBACK (restores the blocking form; only if you want user deletion to
-- fail again while a profile row exists)
-- ============================================================================
-- alter table public.user_profiles drop constraint if exists user_profiles_id_fkey;
-- alter table public.user_profiles
--   add constraint user_profiles_id_fkey foreign key (id) references auth.users(id);
