-- ============================================================================
-- 072_plan_column_lockdown.sql
-- PLAN COLUMN LOCKDOWN: a workspace owner or admin can no longer set their
-- own organizations.plan from the client. The plan changes only through the
-- founder RPCs (founding_set_org_plan, 060; the plan catalog renames, 062).
-- ============================================================================
-- Run AFTER:
--     031_multi_org_tenancy.sql   (organizations, the table-wide grant)
--     037_org_description_settings.sql (organizations.description_settings)
--     060_founder_console.sql     (founding_set_org_plan)
--     071_shared_insights.sql     (organizations.share_insights)
--
-- THE HOLE
--   031 granted table-wide `update` on public.organizations to authenticated.
--   The org_rows_update policy (031, re-created by 056) limits WHICH ROWS to
--   is_org_admin(id), but nothing limited WHICH COLUMNS, so any owner or
--   admin could run
--       update({ plan: 'enterprise' }).eq('id', myOrg)
--   and move their own workspace onto a paid plan (062's history trigger
--   records it, but does not stop it). Since 069 the plan also sets the
--   workspace's limits, so this is now a quota bypass as well.
--
-- THE FIX
--   Revoke the table-wide UPDATE from authenticated (and anon, which on
--   Supabase holds it through the default privileges on public; its RLS
--   policies are `to authenticated`, so anon could never use it, but the
--   grant goes too). Then grant UPDATE on exactly the columns a workspace
--   admin edits from the client. The policy is unchanged: rows are still
--   is_org_admin(id) only. service_role and the table owner are untouched,
--   and every SECURITY DEFINER function (060 founding_set_org_plan and
--   founding_rename_org, 062's plan renames, 066's created_by reassignment)
--   runs as the owner, so they keep working.
--
-- THE COLUMN LIST, from every `.from('organizations').update(` in src/
--   (grep of src/ and supabase/functions/ on 22 Nov 2026):
--     name                  src/lib/orgService.ts         renameOrganization
--     description_settings  src/lib/descriptionSettings.ts saveOrgDescriptionSettings
--     share_insights        src/lib/insightsService.ts    setShareInsights
--   Nothing else in src/ updates organizations. supabase/functions/ only
--   READS it (generate-prose, with the service role).
--
-- PRECONDITION: the client never sends `plan` in an UPDATE. Confirmed by grep
--   on 22 Nov 2026: the three update calls above send only name,
--   description_settings and share_insights. The one client write that
--   carries plan is an INSERT (orgService.ts ensureOrganization,
--   `insert({ name, plan: 'beta' })` for an approved beta signup), and INSERT
--   is a separate privilege this file does not touch.
--   If a later change adds a column a workspace admin edits from the client,
--   add it to the grant below in a new migration, or the update fails with
--   42501 "permission denied for table organizations".
--
-- NOT IN SCOPE (noted, not fixed): the INSERT grant has no column limit
--   either, so a signed-in user creating a workspace could choose its plan.
--   Closing that needs the beta-plan insert moved server side first.
--
-- IDEMPOTENT. Every run revokes the table-wide UPDATE (which also clears any
-- column UPDATE grants, Postgres revokes those with it) and re-grants the
-- three columns, so a re-run lands on the same ACL. No table, column, policy,
-- function or row is changed. Rollback at the bottom.
-- ============================================================================


-- ── 0. Preconditions ────────────────────────────────────────────────────────

do $$
begin
  if to_regclass('public.organizations') is null then
    raise exception '072_plan_column_lockdown.sql: run 031_multi_org_tenancy.sql first.';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'organizations'
                    and column_name = 'description_settings') then
    raise exception '072_plan_column_lockdown.sql: organizations.description_settings is missing. Run 037_org_description_settings.sql first.';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'organizations'
                    and column_name = 'share_insights') then
    raise exception '072_plan_column_lockdown.sql: organizations.share_insights is missing. Run 071_shared_insights.sql first.';
  end if;
  if to_regprocedure('public.founding_set_org_plan(uuid, text)') is null then
    raise exception '072_plan_column_lockdown.sql: founding_set_org_plan is missing. Run 060_founder_console.sql first, or no one could change a plan afterwards.';
  end if;
end $$;


-- ── 1. Table-wide UPDATE out, three columns in ──────────────────────────────

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke update on public.organizations from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke update on public.organizations from authenticated';
    execute 'grant update (name, description_settings, share_insights) on public.organizations to authenticated';
  end if;
end $$;


-- ── 2. Tell PostgREST to re-read the schema ─────────────────────────────────

notify pgrst, 'reload schema';


-- ============================================================================
-- VERIFY (run separately, in the SQL Editor)
-- ============================================================================
-- (a) authenticated has no table-wide UPDATE, and column UPDATE on exactly
--     name, description_settings and share_insights:
--
--   select has_table_privilege('authenticated', 'public.organizations', 'UPDATE') as table_wide;  -- false
--   select column_name from information_schema.column_privileges
--   where table_schema = 'public' and table_name = 'organizations'
--     and grantee = 'authenticated' and privilege_type = 'UPDATE'
--   order by 1;   -- description_settings, name, share_insights
--   select has_column_privilege('authenticated', 'public.organizations', 'plan', 'UPDATE');  -- false
--
-- (b) From the app, signed in as a workspace owner or admin:
--     await supabase.from('organizations').update({ name: 'New name' }).eq('id', '<org>').select('id')       -- 1 row
--     await supabase.from('organizations').update({ share_insights: false }).eq('id', '<org>').select('id')  -- 1 row
--     await supabase.from('organizations').update({ plan: 'enterprise' }).eq('id', '<org>').select('id')     -- 42501
--
-- (c) As a founding admin, the RPC still works:
--     await supabase.rpc('founding_set_org_plan', { p_org: '<org>', p_plan: 'pro' })


-- ============================================================================
-- ROLLBACK (run as postgres). Restores 031's table-wide UPDATE grant, which
-- re-opens the hole described above.
-- ============================================================================
-- revoke update (name, description_settings, share_insights) on public.organizations from authenticated;
-- grant update on public.organizations to authenticated;
-- notify pgrst, 'reload schema';
