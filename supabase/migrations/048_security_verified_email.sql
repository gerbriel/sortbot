-- ============================================================================
-- SECURITY: VERIFIED EMAIL IDENTITY — stop trusting the raw JWT email claim
-- ============================================================================
-- Run AFTER multi_org_tenancy.sql, beta_signups.sql, support_messaging.sql,
-- crm.sql and kanban_board.sql, and AFTER security_invites_hardening.sql
-- (this file re-creates the same two org_invites policies with one extra
-- condition). Additive, idempotent, rollback at the bottom. Every table this
-- touches is guarded, so the file runs cleanly even if some of those optional
-- migrations have never been applied.
--
-- THE HOLE (security audit 05, finding #5 — High):
--   Every cross-tenant identity check in the schema is
--   `lower(auth.jwt()->>'email')`. That claim comes from the SIGNUP FORM — it
--   is not proof of control of the mailbox. An attacker who signs up as
--   ops@bigvintageshop.com therefore inherits that address's:
--     * pending workspace invite   (invited_role / org_invites_select)  → joins a foreign workspace
--     * beta application row       (beta_select)
--     * ability to open support threads as them (support_threads_insert)
--   and, combined with finding #2, escalates to owner of the victim's workspace.
--
-- THE FIX: auth_email_verified() — the address is only an identity once
--   auth.users.email_confirmed_at is set. Every email-matching policy now
--   requires it IN ADDITION to its original condition; nothing else about the
--   policies changes. Admin branches (is_org_admin / is_beta_admin) are
--   untouched, so no admin path depends on the new check.
--
-- ⚠️ PRECONDITION — READ BEFORE RUNNING:
--   Accounts with email_confirmed_at IS NULL lose exactly three abilities:
--   accepting a workspace invite, reading their own beta_signups row (so an
--   approved user would stay on the waitlist screen), and opening a support
--   thread that carries their email. With Supabase's "Confirm email" setting
--   ON, users confirm and are fine; with it OFF, Supabase auto-confirms at
--   signup and stamps email_confirmed_at, so they are also fine. Run this
--   FIRST and confirm it returns 0 — if it does not, confirm or stamp those
--   accounts before running this migration:
--     select count(*) from auth.users where email_confirmed_at is null;
--     -- listing them:
--     select id, email, created_at from auth.users
--     where email_confirmed_at is null order by created_at;
-- ============================================================================


-- ── 0. The helper ───────────────────────────────────────────────────────────
-- SECURITY DEFINER because `authenticated` cannot read auth.users.
create or replace function public.auth_email_verified()
returns boolean
language sql security definer stable
set search_path = public, auth
as $$
  select exists (
    select 1 from auth.users u
    where u.id = auth.uid()
      and u.email_confirmed_at is not null
  )
$$;

grant execute on function public.auth_email_verified() to authenticated;


-- ── 1. multi_org_tenancy: invite acceptance + invite visibility ─────────────
-- invited_role() is the function org_members_insert trusts to decide what role
-- an invitee may claim. Original semantics kept: newest OPEN invite for my
-- address, in this org. Added: my address must be confirmed.
create or replace function public.invited_role(p_org uuid)
returns text
language sql security definer stable
set search_path = public
as $$
  select role from public.org_invites
  where org_id = p_org
    and public.auth_email_verified()
    and lower(email) = lower(coalesce(auth.jwt()->>'email',''))
    and accepted_at is null
  order by created_at desc
  limit 1
$$;

drop policy if exists org_invites_select on public.org_invites;
create policy org_invites_select on public.org_invites for select to authenticated
  using (
    public.is_org_admin(org_id)
    or (public.auth_email_verified()
        and lower(email) = lower(coalesce(auth.jwt()->>'email','')))
  );

drop policy if exists org_invites_update on public.org_invites;
create policy org_invites_update on public.org_invites for update to authenticated
  using (
    public.is_org_admin(org_id)
    or (public.auth_email_verified()
        and lower(email) = lower(coalesce(auth.jwt()->>'email','')))
  )
  with check (
    public.is_org_admin(org_id)
    or (public.auth_email_verified()
        and lower(email) = lower(coalesce(auth.jwt()->>'email','')))
  );


-- ── 2. beta_signups: own-row read ───────────────────────────────────────────
do $$
begin
  if to_regclass('public.beta_signups') is null then
    raise notice 'beta_signups not present — skipping beta_select';
    return;
  end if;
  drop policy if exists beta_select on public.beta_signups;
  create policy beta_select on public.beta_signups for select
    to authenticated
    using (
      public.is_beta_admin()
      or (public.auth_email_verified()
          and lower(email) = lower(coalesce(auth.jwt()->>'email','')))
    );
end $$;


-- ── 3. support_messaging: opening a thread with my own address ──────────────
do $$
begin
  if to_regclass('public.support_threads') is null then
    raise notice 'support_threads not present — skipping support_threads_insert';
    return;
  end if;
  drop policy if exists support_threads_insert on public.support_threads;
  create policy support_threads_insert on public.support_threads for insert
    to authenticated with check (
      user_id = auth.uid()
      and (
        user_email is null
        or (public.auth_email_verified()
            and lower(user_email) = lower(auth.jwt() ->> 'email'))
      )
    );
end $$;


-- ── 4. crm_notes: verified authorship ───────────────────────────────────────
do $$
begin
  if to_regclass('public.crm_notes') is null then
    raise notice 'crm_notes not present — skipping crm_notes_insert';
    return;
  end if;
  drop policy if exists crm_notes_insert on public.crm_notes;
  create policy crm_notes_insert on public.crm_notes for insert
    to authenticated with check (
      public.is_beta_admin()
      and author_id = auth.uid()
      and (
        author_email is null
        or (public.auth_email_verified()
            and lower(author_email) = lower(auth.jwt() ->> 'email'))
      )
    );
end $$;


-- ── 5. kanban: self-asserted authorship on cards and comments ──────────────
-- my_email() itself is left alone (it is a plain claim reader used in several
-- places); the verified requirement is added at each policy instead, so each
-- one keeps its original semantics plus the new condition.
do $$
begin
  if to_regclass('public.kanban_cards') is not null then
    drop policy if exists kanban_insert_kanban_cards on public.kanban_cards;
    create policy kanban_insert_kanban_cards on public.kanban_cards for insert
      to authenticated
      with check (
        org_id in (select public.user_org_ids())
        and (created_by is null or created_by = auth.uid())
        and (created_by_email is null
             or (public.auth_email_verified()
                 and lower(created_by_email) = public.my_email()))
      );
  else
    raise notice 'kanban_cards not present — skipping';
  end if;

  if to_regclass('public.kanban_comments') is not null then
    drop policy if exists kanban_insert_kanban_comments on public.kanban_comments;
    create policy kanban_insert_kanban_comments on public.kanban_comments for insert
      to authenticated
      with check (
        org_id in (select public.user_org_ids())
        and (author_id is null or author_id = auth.uid())
        and (author_email is null
             or (public.auth_email_verified()
                 and lower(author_email) = public.my_email()))
      );
  else
    raise notice 'kanban_comments not present — skipping';
  end if;
end $$;


-- ============================================================================
-- NOT CHANGED, ON PURPOSE
-- ============================================================================
--   founding_user_admin.sql writes auth.jwt()->>'email' into
--   founding_admin_audit as a DESCRIPTIVE actor label. It is not an access
--   check (the gate is is_beta_admin()), so adding a verified requirement
--   there would only risk losing audit rows.


-- ============================================================================
-- VERIFY (run separately)
-- ============================================================================
--   select public.auth_email_verified();      -- true when signed in as a confirmed user
--   select count(*) from auth.users where email_confirmed_at is null;   -- expect 0
--   -- Every policy that should now mention the helper (expect 7 rows, or fewer
--   -- if some optional migrations were never applied):
--   select tablename, policyname from pg_policies
--   where schemaname='public' and (qual like '%auth_email_verified%'
--                               or with_check like '%auth_email_verified%')
--   order by 1,2;


-- ============================================================================
-- ROLLBACK — restores the original (claim-trusting) conditions.
-- ============================================================================
-- create or replace function public.invited_role(p_org uuid)
-- returns text language sql security definer stable set search_path = public as $$
--   select role from public.org_invites
--   where org_id = p_org
--     and lower(email) = lower(coalesce(auth.jwt()->>'email',''))
--     and accepted_at is null
--   order by created_at desc limit 1
-- $$;
--
-- drop policy if exists org_invites_select on public.org_invites;
-- create policy org_invites_select on public.org_invites for select to authenticated
--   using (public.is_org_admin(org_id)
--          or lower(email) = lower(coalesce(auth.jwt()->>'email','')));
--
-- drop policy if exists org_invites_update on public.org_invites;
-- create policy org_invites_update on public.org_invites for update to authenticated
--   using (public.is_org_admin(org_id)
--          or lower(email) = lower(coalesce(auth.jwt()->>'email','')))
--   with check (public.is_org_admin(org_id)
--          or lower(email) = lower(coalesce(auth.jwt()->>'email','')));
--
-- drop policy if exists beta_select on public.beta_signups;
-- create policy beta_select on public.beta_signups for select to authenticated
--   using (public.is_beta_admin()
--          or lower(email) = lower(coalesce(auth.jwt()->>'email','')));
--
-- drop policy if exists support_threads_insert on public.support_threads;
-- create policy support_threads_insert on public.support_threads for insert
--   to authenticated with check (
--     user_id = auth.uid()
--     and (user_email is null or lower(user_email) = lower(auth.jwt() ->> 'email')));
--
-- drop policy if exists crm_notes_insert on public.crm_notes;
-- create policy crm_notes_insert on public.crm_notes for insert
--   to authenticated with check (
--     public.is_beta_admin() and author_id = auth.uid()
--     and (author_email is null or lower(author_email) = lower(auth.jwt() ->> 'email')));
--
-- drop policy if exists kanban_insert_kanban_cards on public.kanban_cards;
-- create policy kanban_insert_kanban_cards on public.kanban_cards for insert
--   to authenticated with check (
--     org_id in (select public.user_org_ids())
--     and (created_by is null or created_by = auth.uid())
--     and (created_by_email is null or lower(created_by_email) = public.my_email()));
--
-- drop policy if exists kanban_insert_kanban_comments on public.kanban_comments;
-- create policy kanban_insert_kanban_comments on public.kanban_comments for insert
--   to authenticated with check (
--     org_id in (select public.user_org_ids())
--     and (author_id is null or author_id = auth.uid())
--     and (author_email is null or lower(author_email) = public.my_email()));
--
-- drop function if exists public.auth_email_verified();
