-- ============================================================================
-- FOUNDING USER ADMIN — cross-workspace membership management + audit log
-- ============================================================================
-- Run AFTER multi_org_tenancy.sql and beta_signups.sql (uses is_beta_admin()).
-- Additive and idempotent. No data is deleted. Rollback at the bottom.
--
-- WHAT THIS ADDS
--   Founding Workspace owners/admins can, for ANY workspace:
--     * list every user (including users with no workspace at all)
--     * add a user to a workspace / change their role
--     * remove a user from a workspace
--     * move a user from one workspace to another
--   Every one of those writes is recorded in founding_admin_audit.
--
-- WHY FUNCTIONS AND NOT WIDER RLS
--   org_members RLS is is_org_admin(org_id) — scoped to workspaces the caller
--   belongs to. Founding admins are not members of tenant workspaces, so they
--   cannot see or write those rows at all. Widening the policy would leak every
--   tenant's member list to every org admin. These SECURITY DEFINER functions
--   keep the policy narrow and put the cross-tenant power behind one gate
--   (is_beta_admin()) with an audit trail.
--
-- ⚠️ SECURITY PROPERTY YOU ARE ACCEPTING — READ THIS
--   beta_org_directory() was deliberately built to expose AGGREGATES ONLY, so
--   founding admins could oversee the beta without reading tenant data. This
--   migration crosses that line, by necessity: a founding admin who can add any
--   user to any workspace can add THEMSELVES to any workspace, and then read
--   that tenant's batches, products, and images through ordinary org RLS.
--   That is inherent to "move users between workspaces" — it cannot be designed
--   out while keeping the feature. What this migration does instead:
--     * every such action is written to founding_admin_audit (append-only from
--       the client's perspective — no INSERT/UPDATE/DELETE grant exists)
--     * the audit row names the actor, so self-adds are visible after the fact
--   Treat founding admin as a privileged operator role. Only give it to people
--   you would give the SQL Editor to.
--
-- DATA SAFETY
--   Memberships move; DATA DOES NOT. workflow_batches / products /
--   product_images / categories / category_presets keep their org_id, because
--   in this schema data belongs to the WORKSPACE, not to the person who
--   happened to create it. Moving a user out of a workspace leaves that
--   workspace's work intact for everyone still in it, and is reversible by
--   moving them back.
--
-- SAFETY RAIL THAT CANNOT BE OVERRIDDEN
--   No operation may leave the Founding Workspace with zero owners+admins.
--   Only founding admins can execute these functions, so hitting zero would
--   permanently lock user management for everyone, recoverable only from the
--   SQL Editor. Attempts raise an exception and roll back.
-- ============================================================================


-- ── 1. Audit log ────────────────────────────────────────────────────────────
-- Written ONLY by the SECURITY DEFINER functions below (they run as the table
-- owner and bypass RLS). `authenticated` is granted SELECT and nothing else,
-- so no client can forge, edit, or erase a row.

create table if not exists public.founding_admin_audit (
  id            uuid primary key default gen_random_uuid(),
  actor_id      uuid references auth.users(id),
  actor_email   text,
  action        text not null,           -- add_member | set_role | remove_member | move_user
  target_user   uuid,
  target_email  text,
  from_org      uuid,
  from_org_name text,
  to_org        uuid,
  to_org_name   text,
  role          text,
  created_at    timestamptz not null default now()
);

create index if not exists founding_audit_created_idx on public.founding_admin_audit (created_at desc);
create index if not exists founding_audit_target_idx  on public.founding_admin_audit (target_user);

alter table public.founding_admin_audit enable row level security;

revoke all on public.founding_admin_audit from authenticated;
grant select on public.founding_admin_audit to authenticated;

drop policy if exists founding_audit_select on public.founding_admin_audit;
create policy founding_audit_select on public.founding_admin_audit for select to authenticated
  using (public.is_beta_admin());


-- ── 2. Guards ───────────────────────────────────────────────────────────────

create or replace function public.assert_founding_admin()
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not public.is_beta_admin() then
    raise exception 'Not authorized — Founding Workspace admins only.'
      using errcode = '42501';
  end if;
end $$;

-- Must be called AFTER any membership write. plpgsql functions run inside the
-- caller's statement, so raising here rolls the whole change back.
create or replace function public.guard_founding_admins()
returns void
language plpgsql security definer
set search_path = public
as $$
declare n bigint;
begin
  select count(*) into n
  from public.org_members m
  join public.organizations o on o.id = m.org_id
  where o.slug = 'founding' and m.role in ('owner', 'admin');

  if n = 0 then
    raise exception 'Blocked: that would leave the Founding Workspace with no owner or admin, and nobody could manage users again. Promote someone else first.'
      using errcode = '23514';
  end if;
end $$;


-- ── 3. Read: every user and every workspace they belong to ──────────────────
-- Users with NO memberships are included (memberships = []): waitlisted signups
-- and accounts orphaned by a removal. Non-admin callers get zero rows, matching
-- beta_org_directory()'s behavior — the UI hides the section rather than erroring.

create or replace function public.founding_list_users()
returns table (
  user_id         uuid,
  email           text,
  created_at      timestamptz,
  last_sign_in_at timestamptz,
  memberships     jsonb
)
language sql security definer stable
set search_path = public
as $$
  select
    u.id,
    u.email::text,
    u.created_at,
    u.last_sign_in_at,
    coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'org_id',    o.id,
                 'org_name',  o.name,
                 'org_slug',  o.slug,
                 'role',      m.role,
                 'joined_at', m.created_at
               ) order by m.created_at
             )
      from public.org_members m
      join public.organizations o on o.id = m.org_id
      where m.user_id = u.id
    ), '[]'::jsonb)
  from auth.users u
  where public.is_beta_admin()   -- non-admins: zero rows, no error
  order by u.created_at desc
$$;


-- ── 4. Write: add / change role ─────────────────────────────────────────────
-- Upsert semantics: adds the membership, or updates the role if it exists.

create or replace function public.founding_set_membership(
  p_user uuid,
  p_org  uuid,
  p_role text
)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_email    text;
  v_org_name text;
  v_existing text;
begin
  perform public.assert_founding_admin();

  if p_role not in ('owner', 'admin', 'member') then
    raise exception 'Invalid role: %', p_role using errcode = '22023';
  end if;

  select email::text into v_email from auth.users where id = p_user;
  if v_email is null then
    raise exception 'No such user.' using errcode = '22023';
  end if;

  select name into v_org_name from public.organizations where id = p_org;
  if v_org_name is null then
    raise exception 'No such workspace.' using errcode = '22023';
  end if;

  select role into v_existing
  from public.org_members where user_id = p_user and org_id = p_org;

  insert into public.org_members (org_id, user_id, role, email)
  values (p_org, p_user, p_role, v_email)
  on conflict (org_id, user_id) do update set role = excluded.role;

  perform public.guard_founding_admins();

  insert into public.founding_admin_audit
    (actor_id, actor_email, action, target_user, target_email, to_org, to_org_name, role)
  values
    (auth.uid(), auth.jwt() ->> 'email',
     case when v_existing is null then 'add_member' else 'set_role' end,
     p_user, v_email, p_org, v_org_name, p_role);
end $$;


-- ── 5. Write: remove from a workspace ───────────────────────────────────────
-- Their batches/products stay with the workspace (see DATA SAFETY above).

create or replace function public.founding_remove_membership(
  p_user uuid,
  p_org  uuid
)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_email    text;
  v_org_name text;
  v_role     text;
begin
  perform public.assert_founding_admin();

  select role into v_role
  from public.org_members where user_id = p_user and org_id = p_org;
  if v_role is null then
    raise exception 'That user is not in that workspace.' using errcode = '22023';
  end if;

  select email::text into v_email from auth.users where id = p_user;
  select name into v_org_name from public.organizations where id = p_org;

  delete from public.org_members where user_id = p_user and org_id = p_org;

  perform public.guard_founding_admins();

  insert into public.founding_admin_audit
    (actor_id, actor_email, action, target_user, target_email, from_org, from_org_name, role)
  values
    (auth.uid(), auth.jwt() ->> 'email', 'remove_member',
     p_user, v_email, p_org, v_org_name, v_role);
end $$;


-- ── 6. Write: move between workspaces ───────────────────────────────────────
-- Membership only. p_role null keeps the role they had in the old workspace.
-- Atomic: if the guard fires, neither the delete nor the insert survives.

create or replace function public.founding_move_user(
  p_user     uuid,
  p_from_org uuid,
  p_to_org   uuid,
  p_role     text default null
)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_email     text;
  v_from_name text;
  v_to_name   text;
  v_old_role  text;
  v_new_role  text;
begin
  perform public.assert_founding_admin();

  if p_from_org = p_to_org then
    raise exception 'They are already in that workspace.' using errcode = '22023';
  end if;

  select role into v_old_role
  from public.org_members where user_id = p_user and org_id = p_from_org;
  if v_old_role is null then
    raise exception 'That user is not in the workspace you are moving them out of.' using errcode = '22023';
  end if;

  v_new_role := coalesce(p_role, v_old_role);
  if v_new_role not in ('owner', 'admin', 'member') then
    raise exception 'Invalid role: %', v_new_role using errcode = '22023';
  end if;

  select email::text into v_email from auth.users where id = p_user;

  select name into v_from_name from public.organizations where id = p_from_org;
  select name into v_to_name   from public.organizations where id = p_to_org;
  if v_to_name is null then
    raise exception 'No such destination workspace.' using errcode = '22023';
  end if;

  delete from public.org_members where user_id = p_user and org_id = p_from_org;

  insert into public.org_members (org_id, user_id, role, email)
  values (p_to_org, p_user, v_new_role, v_email)
  on conflict (org_id, user_id) do update set role = excluded.role;

  perform public.guard_founding_admins();

  insert into public.founding_admin_audit
    (actor_id, actor_email, action, target_user, target_email,
     from_org, from_org_name, to_org, to_org_name, role)
  values
    (auth.uid(), auth.jwt() ->> 'email', 'move_user',
     p_user, v_email, p_from_org, v_from_name, p_to_org, v_to_name, v_new_role);
end $$;


-- ── 7. Grants ───────────────────────────────────────────────────────────────
-- Safe to grant to `authenticated`: every function gates on is_beta_admin()
-- (mutations raise 42501, the reader returns zero rows).

grant execute on function
  public.founding_list_users(),
  public.founding_set_membership(uuid, uuid, text),
  public.founding_remove_membership(uuid, uuid),
  public.founding_move_user(uuid, uuid, uuid, text)
  to authenticated;

-- Internal helpers — not called from the client, but harmless to expose and
-- needed if you ever call the mutators from another SQL function.
grant execute on function public.assert_founding_admin(), public.guard_founding_admins()
  to authenticated;


-- ── 8. VERIFY (run separately, signed in as a Founding admin via the app) ────
--   select email, memberships from public.founding_list_users();
--   select count(*) from public.founding_list_users();       -- 0 if not an admin
--   select * from public.founding_admin_audit order by created_at desc limit 20;
--
-- Prove the lockout rail works (should RAISE, not succeed):
--   select public.founding_remove_membership(
--     '<your-own-user-uuid>',
--     (select id from public.organizations where slug = 'founding'));
--   -- expected: "Blocked: that would leave the Founding Workspace with no
--   --            owner or admin…" (only if you are the last founding admin)


-- ============================================================================
-- ROLLBACK — removes cross-workspace user management. Memberships already
-- changed are NOT reverted (move people back first if you need that).
-- The audit log is kept by default so the history survives; drop it explicitly
-- on the last line if you really want it gone.
-- ============================================================================
-- drop function if exists public.founding_move_user(uuid, uuid, uuid, text);
-- drop function if exists public.founding_remove_membership(uuid, uuid);
-- drop function if exists public.founding_set_membership(uuid, uuid, text);
-- drop function if exists public.founding_list_users();
-- drop function if exists public.guard_founding_admins();
-- drop function if exists public.assert_founding_admin();
-- -- drop table if exists public.founding_admin_audit;   -- destroys the history
