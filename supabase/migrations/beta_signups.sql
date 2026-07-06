-- ============================================================================
-- BETA SIGNUPS — public waitlist + admin approval gate
-- ============================================================================
-- Run AFTER multi_org_tenancy.sql (uses org_members/organizations for the
-- admin check). Purely additive; idempotent; rollback at the bottom.
--
-- FLOW:
--   1. Anyone submits the form on beta.html → INSERT into beta_signups
--      (anonymous; forced to status='pending' by the policy).
--   2. A Founding Workspace owner/admin reviews requests in the app's
--      Workspace panel → sets status to 'approved' or 'denied'.
--   3. When the requester signs up / signs in, the app checks their email:
--      approved → their workspace is created (plan='beta'); pending/denied/none
--      → they see the waitlist screen instead of the dashboard.
--   Existing members and invited teammates are NEVER gated (membership and
--   invites are checked before the beta gate).
--
-- PAID-TIER GROUNDWORK: approved workspaces are created with
-- organizations.plan = 'beta', so the future billing migration can target
-- them precisely (e.g. UPDATE ... WHERE plan = 'beta').
-- ============================================================================

create table if not exists public.beta_signups (
  id           uuid primary key default gen_random_uuid(),
  org_name     text not null,
  contact_name text not null,
  email        text not null,
  store_url    text,
  volume       text,
  notes        text,
  status       text not null default 'pending' check (status in ('pending','approved','denied')),
  reviewed_by  uuid references auth.users(id),
  reviewed_at  timestamptz,
  created_at   timestamptz not null default now()
);

-- One request per email (case-insensitive). The landing form treats the
-- unique-violation error (23505) as "you're already on the list".
create unique index if not exists beta_signups_email_uidx on public.beta_signups (lower(email));

alter table public.beta_signups enable row level security;

grant insert on public.beta_signups to anon;
grant select, insert, update, delete on public.beta_signups to authenticated;

-- Is the current user an owner/admin of the Founding Workspace?
create or replace function public.is_beta_admin()
returns boolean
language sql security definer stable
set search_path = public
as $$
  select exists (
    select 1
    from public.org_members m
    join public.organizations o on o.id = m.org_id
    where o.slug = 'founding'
      and m.user_id = auth.uid()
      and m.role in ('owner','admin')
  )
$$;

grant execute on function public.is_beta_admin() to authenticated;

-- INSERT: anyone (the public landing form), but only as a pending request —
-- nobody can insert themselves pre-approved.
drop policy if exists beta_insert on public.beta_signups;
create policy beta_insert on public.beta_signups for insert
  to anon, authenticated
  with check (status = 'pending');

-- SELECT: beta admins see everything; a signed-in user can see THEIR OWN row
-- (the app reads it to decide approved vs waitlist).
drop policy if exists beta_select on public.beta_signups;
create policy beta_select on public.beta_signups for select
  to authenticated
  using (
    public.is_beta_admin()
    or lower(email) = lower(coalesce(auth.jwt()->>'email',''))
  );

-- UPDATE/DELETE: beta admins only (approve / deny / clean up).
drop policy if exists beta_update on public.beta_signups;
create policy beta_update on public.beta_signups for update
  to authenticated
  using (public.is_beta_admin())
  with check (public.is_beta_admin());

drop policy if exists beta_delete on public.beta_signups;
create policy beta_delete on public.beta_signups for delete
  to authenticated
  using (public.is_beta_admin());

-- ── VERIFY (run separately) ─────────────────────────────────────────────────
--   select * from public.beta_signups order by created_at desc limit 20;
--   select public.is_beta_admin();   -- true when signed in as a founding admin

-- ── ROLLBACK ────────────────────────────────────────────────────────────────
-- drop table if exists public.beta_signups;
-- drop function if exists public.is_beta_admin();
