-- ============================================================================
-- FOUNDER CONSOLE — create workspaces, set plans, rename, invite, inspect
-- ============================================================================
-- Run in the Supabase SQL Editor (as `postgres`) AFTER:
--     multi_org_tenancy.sql   (organizations / org_members / org_invites)
--     beta_signups.sql        (is_beta_admin())
--     founding_user_admin.sql (assert_founding_admin(), founding_admin_audit)
--   optional, in any order relative to this file:
--     security_function_hardening.sql + security_rpc_wrappers.sql
--     security_invites_hardening.sql  (the "no owner via invite" rule this
--                                      file deliberately keeps — see §3.4)
--     marketplaces.sql                (org_marketplaces; read through
--                                      to_regclass, so its absence is fine)
--
-- Purely additive. NO NEW TABLE, no new column, no policy change, no trigger.
-- Idempotent — safe to run any number of times. Rollback at the bottom.
--
-- ── WHAT THIS ADDS ──────────────────────────────────────────────────────────
-- The Founder console (src/components/FounderConsole.tsx) already had reads for
-- every workspace (beta_org_directory) and membership writes for every user
-- (founding_user_admin). Five things were missing, and each of them is
-- impossible from the client for the same reason the membership writes were:
-- a founding admin is NOT a member of a tenant workspace, so organizations /
-- org_invites RLS (is_org_admin(org_id)) hides those rows from them entirely.
--
--   founding_create_workspace  onboard a shop before its owner ever signs in
--   founding_set_org_plan      move a workspace between plans
--   founding_rename_org        fix a workspace's name
--   founding_invite_member     add somebody to a workspace by email
--   founding_org_detail        one workspace's members, invites and counts
--
-- Every mutation writes a row to founding_admin_audit, exactly as the four
-- existing founding_* functions do. That table's `action` column is plain
-- `text` with no CHECK, so the four new verbs below need no ALTER:
--   create_workspace | set_plan | rename_org | invite_member
--
-- ── FUNCTION PLACEMENT (AGENTS.md §18 #43–#46) ──────────────────────────────
-- Every function here is born in the SHAPE the hardening files would have put
-- it in, so neither of them ever has to move it:
--     app_private.<fn>   SECURITY DEFINER body, gated on assert_founding_admin()
--     public.<fn>        SECURITY INVOKER wrapper, IDENTICAL signature
-- "Identical" is literal: PostgREST resolves an RPC by ARGUMENT NAME and
-- renders the response from the RETURN TYPE, so the wrapper repeats the
-- argument names src/lib/foundingAdminService.ts sends (p_name / p_plan /
-- p_owner_email / p_org / p_email / p_role), the return type and the
-- volatility. Change one half and you must change the other.
--
-- ⚠️ `create schema if not exists app_private` below is a no-op when
--    security_function_hardening.sql has already run. It also means THAT file's
--    rollback (`drop schema app_private restrict`) will refuse while these five
--    bodies live there — roll THIS file back first, exactly as
--    security_rpc_wrappers.sql documents for its own nine.
--
-- ── THE SECURITY PROPERTY YOU ARE ACCEPTING ─────────────────────────────────
-- founding_user_admin.sql already says it: a founding admin who can add any
-- user to any workspace can add themselves. This file adds "can create a
-- workspace and invite into it", which is the same power one step earlier. The
-- mitigation is unchanged and is the only honest one — every action is written
-- to founding_admin_audit with the actor's name on it, and founding admin is a
-- privileged operator role you only give to someone you would give the SQL
-- Editor to.
--
-- ── WHAT THIS FILE DELIBERATELY DOES NOT DO ─────────────────────────────────
-- 1. It does not create an OWNER from an invite. security_invites_hardening.sql
--    closed invitee → owner self-promotion, and that rule stands: when the
--    owner's email has no auth.users row yet, founding_create_workspace writes
--    an **admin** invite and the founder promotes them after they join. When
--    the account DOES exist, the owner membership is written directly by this
--    SECURITY DEFINER body — a trusted founder write, not an invitee's.
-- 2. It does not seed categories or presets. The default list lives in
--    src/lib/categories.ts and has exactly one home; orgService.ensureOrganization
--    seeds an empty workspace on the owner's first sign-in instead (which also
--    heals any workspace that ended up empty for another reason).
-- 3. It does not create an auth.users row. Accounts are Supabase Auth's, and
--    minting one needs the service_role key — a much larger blast radius than
--    anything here. An unknown email gets an invite; they sign up normally.
-- ============================================================================


-- ── 1. The private schema (no-op if security_function_hardening.sql ran) ────

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


-- ── 2. Preconditions ────────────────────────────────────────────────────────
-- Fail loudly and early rather than creating five functions that raise at call
-- time. Everything here comes from founding_user_admin.sql / beta_signups.sql.

do $$
begin
  if to_regclass('public.organizations') is null then
    raise exception 'founder_console.sql: run multi_org_tenancy.sql first.';
  end if;
  if to_regclass('public.founding_admin_audit') is null then
    raise exception 'founder_console.sql: run founding_user_admin.sql first.';
  end if;
  if to_regprocedure('public.assert_founding_admin()') is null then
    raise exception 'founder_console.sql: assert_founding_admin() is missing — run founding_user_admin.sql first.';
  end if;
end $$;


-- ── 3. The plan vocabulary, in ONE place ────────────────────────────────────
-- These are the `finance_plan_prices` keys seeded by finance.sql, which is what
-- makes projected MRR a JOIN rather than a constant. A plan this list does not
-- name would price at nothing and silently vanish from the books, so the two
-- writers below reject it. ORG_PLANS in src/lib/foundingAdminService.ts mirrors
-- this array — change one and change the other.
--
-- Internal guard (treatment B): called only from the SECURITY DEFINER bodies
-- below, which run as this file's owner, so no client role needs EXECUTE.

create or replace function app_private.org_plan_list()
returns text[]
language sql
immutable
as $$
  select array[
    'free', 'beta', 'starter', 'basic', 'growth',
    'pro', 'business', 'scale', 'enterprise'
  ]::text[]
$$;

do $$
declare r text;
begin
  execute 'revoke all on function app_private.org_plan_list() from public';
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on function app_private.org_plan_list() from %I', r);
    end if;
  end loop;
end $$;


-- ── 4. Create a workspace and attach (or invite) its owner ──────────────────
-- Returns the new organizations.id.
--
-- The owner branch is the whole point of the function: a shop that has never
-- signed in has no auth.users row, so there is nothing to make an owner OF.
-- Known account  → an owner membership, written here as the table owner.
-- Unknown email  → an ADMIN invite (never owner — see the header, §1), which
--                  ensureOrganization accepts on their first sign-in.

create or replace function app_private.founding_create_workspace(
  p_name        text,
  p_plan        text,
  p_owner_email text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_name   text := btrim(coalesce(p_name, ''));
  v_plan   text := lower(btrim(coalesce(p_plan, 'beta')));
  v_email  text := lower(btrim(coalesce(p_owner_email, '')));
  v_org    uuid;
  v_user   uuid;
  v_role   text;
begin
  perform public.assert_founding_admin();

  if v_name = '' then
    raise exception 'Give the workspace a name.' using errcode = '22023';
  end if;
  if char_length(v_name) > 60 then
    raise exception 'Keep the workspace name under 60 characters.' using errcode = '22023';
  end if;
  if not (v_plan = any (app_private.org_plan_list())) then
    raise exception 'Unknown plan: %', v_plan using errcode = '22023';
  end if;
  if v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then
    raise exception 'Enter a valid owner email address.' using errcode = '22023';
  end if;

  -- slug stays NULL. 'founding' is the one slug that means anything (it is what
  -- is_beta_admin() keys on), and it must never be handed out from here.
  insert into public.organizations (name, plan, created_by)
  values (v_name, v_plan, auth.uid())
  returning id into v_org;

  select id into v_user from auth.users where lower(email) = v_email limit 1;

  if v_user is not null then
    v_role := 'owner';
    insert into public.org_members (org_id, user_id, role, email)
    values (v_org, v_user, 'owner', v_email)
    on conflict (org_id, user_id) do update set role = excluded.role;
  else
    v_role := 'admin';
    insert into public.org_invites (org_id, email, role, invited_by)
    values (v_org, v_email, 'admin', auth.uid());
  end if;

  insert into public.founding_admin_audit
    (actor_id, actor_email, action, target_user, target_email, to_org, to_org_name, role)
  values
    (auth.uid(), auth.jwt() ->> 'email', 'create_workspace',
     v_user, v_email, v_org, v_name, v_role);

  return v_org;
end $$;


-- ── 5. Set a workspace's plan ───────────────────────────────────────────────

create or replace function app_private.founding_set_org_plan(
  p_org  uuid,
  p_plan text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_plan text := lower(btrim(coalesce(p_plan, '')));
  v_name text;
begin
  perform public.assert_founding_admin();

  if not (v_plan = any (app_private.org_plan_list())) then
    raise exception 'Unknown plan: %', v_plan using errcode = '22023';
  end if;

  update public.organizations set plan = v_plan where id = p_org
  returning name into v_name;
  if v_name is null then
    raise exception 'No such workspace.' using errcode = '22023';
  end if;

  insert into public.founding_admin_audit
    (actor_id, actor_email, action, to_org, to_org_name, role)
  values
    (auth.uid(), auth.jwt() ->> 'email', 'set_plan', p_org, v_name, v_plan);
end $$;


-- ── 6. Rename a workspace ───────────────────────────────────────────────────

create or replace function app_private.founding_rename_org(
  p_org  uuid,
  p_name text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_old  text;
begin
  perform public.assert_founding_admin();

  if v_name = '' then
    raise exception 'Give the workspace a name.' using errcode = '22023';
  end if;
  if char_length(v_name) > 60 then
    raise exception 'Keep the workspace name under 60 characters.' using errcode = '22023';
  end if;

  select name into v_old from public.organizations where id = p_org;
  if v_old is null then
    raise exception 'No such workspace.' using errcode = '22023';
  end if;

  update public.organizations set name = v_name where id = p_org;

  -- from_org_name carries the OLD name, so the audit line reads as a rename
  -- rather than as an edit with no before.
  insert into public.founding_admin_audit
    (actor_id, actor_email, action, from_org, from_org_name, to_org, to_org_name)
  values
    (auth.uid(), auth.jwt() ->> 'email', 'rename_org', p_org, v_old, p_org, v_name);
end $$;


-- ── 7. Invite somebody to a workspace ───────────────────────────────────────
-- Returns the new org_invites.id. member/admin only: an invite may never mint
-- an owner (security_invites_hardening.sql §3), and the founder can promote
-- with founding_set_membership once they have joined.

create or replace function app_private.founding_invite_member(
  p_org   uuid,
  p_email text,
  p_role  text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_role  text := lower(btrim(coalesce(p_role, 'member')));
  v_name  text;
  v_id    uuid;
begin
  perform public.assert_founding_admin();

  if v_role not in ('member', 'admin') then
    raise exception 'An invite can only be member or admin. Add them, then promote.'
      using errcode = '22023';
  end if;
  if v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then
    raise exception 'Enter a valid email address.' using errcode = '22023';
  end if;

  select name into v_name from public.organizations where id = p_org;
  if v_name is null then
    raise exception 'No such workspace.' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.org_members m
    join auth.users u on u.id = m.user_id
    where m.org_id = p_org and lower(u.email) = v_email
  ) then
    raise exception 'They are already in that workspace.' using errcode = '22023';
  end if;

  -- org_invites_org_email_uidx (security_invites_hardening.sql) makes a second
  -- open invite a 23505. Say so in words rather than leaking the index name.
  begin
    insert into public.org_invites (org_id, email, role, invited_by)
    values (p_org, v_email, v_role, auth.uid())
    returning id into v_id;
  exception when unique_violation then
    raise exception 'There is already an invite for that address in this workspace.'
      using errcode = '23505';
  end;

  insert into public.founding_admin_audit
    (actor_id, actor_email, action, target_email, to_org, to_org_name, role)
  values
    (auth.uid(), auth.jwt() ->> 'email', 'invite_member', v_email, p_org, v_name, v_role);

  return v_id;
end $$;


-- ── 8. One workspace, in detail ─────────────────────────────────────────────
-- The same boundary beta_org_directory() drew: membership, open invites and
-- COUNTS. No batch, product or image row ever crosses it.
--
-- org_marketplaces is OPTIONAL (marketplaces.sql may not have run), so it is
-- read through to_regclass + dynamic SQL — the finance_summary pattern. A
-- missing table yields an empty array, never an error.

create or replace function app_private.founding_org_detail(p_org uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org      jsonb;
  v_members  jsonb;
  v_invites  jsonb;
  v_markets  jsonb := '[]'::jsonb;
begin
  perform public.assert_founding_admin();

  select jsonb_build_object(
           'id', o.id, 'name', o.name, 'slug', o.slug,
           'plan', o.plan, 'created_at', o.created_at
         )
    into v_org
  from public.organizations o where o.id = p_org;

  if v_org is null then
    raise exception 'No such workspace.' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'user_id',    m.user_id,
           -- org_members.email is denormalised at write time and is NULL on
           -- rows written before it existed; auth.users is the fallback.
           'email',      coalesce(m.email, u.email),
           'role',       m.role,
           'created_at', m.created_at
         ) order by m.created_at), '[]'::jsonb)
    into v_members
  from public.org_members m
  left join auth.users u on u.id = m.user_id
  where m.org_id = p_org;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', i.id, 'email', i.email, 'role', i.role, 'created_at', i.created_at
         ) order by i.created_at desc), '[]'::jsonb)
    into v_invites
  from public.org_invites i
  where i.org_id = p_org and i.accepted_at is null;

  if to_regclass('public.org_marketplaces') is not null then
    execute format($q$
      select coalesce(jsonb_agg(marketplace order by marketplace), '[]'::jsonb)
      from public.org_marketplaces
      where org_id = %L::uuid and enabled $q$, p_org)
    into v_markets;
  end if;

  return jsonb_build_object(
    'org',     v_org,
    'members', v_members,
    'invites', v_invites,
    'counts',  jsonb_build_object(
      'batches',  (select count(*) from public.workflow_batches b where b.org_id = p_org),
      'products', (select count(*) from public.products p        where p.org_id = p_org),
      'images',   (select count(*) from public.product_images pi where pi.org_id = p_org)
    ),
    'last_active',  (select max(b.updated_at) from public.workflow_batches b where b.org_id = p_org),
    'marketplaces', coalesce(v_markets, '[]'::jsonb)
  );
end $$;


-- ── 9. The public SECURITY INVOKER wrappers ─────────────────────────────────
-- `create or replace` so a re-run repairs a stray definer copy the same way
-- security_rpc_wrappers.sql section 2 does. Argument names, defaults, return
-- types and volatility are copied from section 4-8 verbatim (see the header).

create or replace function public.founding_create_workspace(
  p_name        text,
  p_plan        text,
  p_owner_email text
)
returns uuid
language sql
security invoker
set search_path = public, pg_temp
as $$ select app_private.founding_create_workspace(p_name, p_plan, p_owner_email) $$;

create or replace function public.founding_set_org_plan(
  p_org  uuid,
  p_plan text
)
returns void
language sql
security invoker
set search_path = public, pg_temp
as $$ select app_private.founding_set_org_plan(p_org, p_plan) $$;

create or replace function public.founding_rename_org(
  p_org  uuid,
  p_name text
)
returns void
language sql
security invoker
set search_path = public, pg_temp
as $$ select app_private.founding_rename_org(p_org, p_name) $$;

create or replace function public.founding_invite_member(
  p_org   uuid,
  p_email text,
  p_role  text
)
returns uuid
language sql
security invoker
set search_path = public, pg_temp
as $$ select app_private.founding_invite_member(p_org, p_email, p_role) $$;

create or replace function public.founding_org_detail(p_org uuid)
returns jsonb
language sql
security invoker
set search_path = public, pg_temp
as $$ select app_private.founding_org_detail(p_org) $$;


-- ── 10. Privileges ──────────────────────────────────────────────────────────
-- BOTH halves need EXECUTE for `authenticated`: the wrapper so the request gets
-- in, the app_private body because a SECURITY INVOKER wrapper runs as the
-- caller. PUBLIC and anon are revoked from both. service_role is granted back
-- where PUBLIC used to give it access (it bypasses RLS already, so this moves
-- no boundary). Written inline rather than through app_private._harden(), which
-- only exists once security_function_hardening.sql has run.

do $$
declare
  sig  text;
  r    text;
  sigs text[] := array[
    'app_private.founding_create_workspace(text, text, text)',
    'app_private.founding_set_org_plan(uuid, text)',
    'app_private.founding_rename_org(uuid, text)',
    'app_private.founding_invite_member(uuid, text, text)',
    'app_private.founding_org_detail(uuid)',
    'public.founding_create_workspace(text, text, text)',
    'public.founding_set_org_plan(uuid, text)',
    'public.founding_rename_org(uuid, text)',
    'public.founding_invite_member(uuid, text, text)',
    'public.founding_org_detail(uuid)'
  ];
begin
  foreach sig in array sigs loop
    execute format('revoke all on function %s from public', sig);
    foreach r in array array['anon', 'authenticated', 'service_role'] loop
      if exists (select 1 from pg_roles where rolname = r) then
        execute format('revoke all on function %s from %I', sig, r);
      end if;
    end loop;
    foreach r in array array['authenticated', 'service_role'] loop
      if exists (select 1 from pg_roles where rolname = r) then
        execute format('grant execute on function %s to %I', sig, r);
      end if;
    end loop;
  end loop;
end $$;


-- ── 11. Tell PostgREST to re-read the schema ────────────────────────────────

notify pgrst, 'reload schema';


-- ============================================================================
-- VERIFY (run separately, in the SQL Editor)
-- ============================================================================
-- (a) Five wrappers in public, all prosecdef = f; five bodies in app_private,
--     all prosecdef = t:
--
--   select n.nspname, p.oid::regprocedure::text, p.prosecdef
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where p.proname in ('founding_create_workspace','founding_set_org_plan',
--                       'founding_rename_org','founding_invite_member',
--                       'founding_org_detail')
--   order by 2;
--
-- (b) Linter 0028/0029 must stay clear — expect ZERO rows:
--
--   select p.oid::regprocedure::text
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and p.prosecdef
--     and (has_function_privilege('anon', p.oid, 'EXECUTE')
--          or has_function_privilege('authenticated', p.oid, 'EXECUTE'));
--
-- (c) Signed in as a Founding admin, from the app: Founder console →
--     Workspaces (expand a row) → Onboard (create one) → Requests. A non-founder
--     must get "Not authorized — Founding Workspace admins only." (42501) from
--     every one of the five.
--
-- (d) The audit trail of everything done here:
--
--   select created_at, actor_email, action, target_email, to_org_name, role
--   from public.founding_admin_audit
--   where action in ('create_workspace','set_plan','rename_org','invite_member')
--   order by created_at desc limit 20;


-- ============================================================================
-- ROLLBACK — run BEFORE security_function_hardening.sql's own rollback, whose
-- `drop schema app_private restrict` refuses while these five bodies live there.
--
-- Workspaces, plans, invites and renames already made are NOT reverted; this
-- only removes the ability to make more from the app. founding_admin_audit is
-- left alone so the history survives. app_private.org_plan_list() is dropped
-- with them — nothing else uses it. The schema itself is NOT dropped: the
-- hardening file and team_messaging.sql both live in it.
-- ============================================================================
-- drop function if exists public.founding_org_detail(uuid);
-- drop function if exists public.founding_invite_member(uuid, text, text);
-- drop function if exists public.founding_rename_org(uuid, text);
-- drop function if exists public.founding_set_org_plan(uuid, text);
-- drop function if exists public.founding_create_workspace(text, text, text);
-- drop function if exists app_private.founding_org_detail(uuid);
-- drop function if exists app_private.founding_invite_member(uuid, text, text);
-- drop function if exists app_private.founding_rename_org(uuid, text);
-- drop function if exists app_private.founding_set_org_plan(uuid, text);
-- drop function if exists app_private.founding_create_workspace(text, text, text);
-- drop function if exists app_private.org_plan_list();
