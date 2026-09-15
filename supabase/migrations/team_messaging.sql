-- ============================================================================
-- TEAM MESSAGING — a second KIND of conversation on the same two tables
-- ============================================================================
-- Run in the Supabase SQL Editor (as `postgres`) AFTER multi_org_tenancy.sql,
-- beta_signups.sql, support_messaging.sql and security_abuse_limits.sql.
-- Purely additive: two columns, one table, one widened CHECK per role column,
-- one helper, and a policy rewrite. NO existing row changes meaning — every
-- thread that exists today is `kind = 'support'` and behaves exactly as before.
-- Idempotent — safe to run any number of times. Rollback at the bottom.
--
-- RECOMMENDED RUN ORDER
--   1. team_messaging.sql        (this file)
--   2. perf_rls_initplan.sql     (re-run LAST — it recreates these policies;
--                                 its section 8 carries the NEW definitions and
--                                 falls back to the old ones on a database
--                                 where this file has not run)
--   security_function_hardening.sql / security_rpc_wrappers.sql do NOT need a
--   re-run: this file replaces one TRIGGER function (public.support_after_message,
--   treatment B — it re-states its own revokes below) and adds one NEW policy
--   helper that is created in `app_private` behind a public SECURITY INVOKER
--   wrapper already, so there is nothing left for them to move (AGENTS.md §18 #45).
--
-- ── THE MODEL ───────────────────────────────────────────────────────────────
-- Until now a thread was always "one user ↔ the founders' shared inbox". That
-- stays, and is now spelled `kind = 'support'`. The new `kind = 'team'` is a
-- direct message between people in ONE workspace: a participant list, no
-- founder privilege, and NOT visible to founders of other workspaces.
--
--   support  participants are implied — the owner (`user_id`) and every
--            founding admin. Roles 'user' / 'founder'. Unchanged.
--   team     participants are ENUMERATED in support_thread_members, one row
--            each INCLUDING the creator, so membership is ONE rule with no
--            special case. Role 'member' for everybody, founders included:
--            inside their own workspace a founder is a colleague, not staff.
--
-- WHY FOUNDERS MUST NOT SEE TEAM THREADS: `is_beta_admin()` is a cross-tenant
-- power (it reaches every workspace's membership, CRM and support threads).
-- Extending it to private colleague-to-colleague messages would make every
-- workspace's internal chat readable by us, which is not a promise this product
-- can keep. So the founder branch of every policy below is gated on
-- `kind = 'support'`; a founder reaches a team thread only as a participant.
--
-- ── WHY A HELPER FUNCTION, NOT A SUB-SELECT ─────────────────────────────────
-- `support_threads_select` has to ask "am I a participant?" (a read of
-- support_thread_members) and `support_thread_members_select` has to ask "is
-- this a thread I belong to?". Written as plain sub-selects those two policies
-- reference each other and Postgres raises 42P17 "infinite recursion detected
-- in policy for relation". `app_private.is_thread_participant()` is SECURITY
-- DEFINER and owned by the table owner, so its read of support_thread_members
-- is not policy-checked at all — the cycle is cut at the only point where it
-- can be cut without duplicating the rule in two places.
--
-- ── UNREAD, FOR A THREAD WITH N SIDES ───────────────────────────────────────
-- Support unread is "the other SIDE wrote last, after my stamp", which works
-- because there are exactly two sides. A team thread has N participants, so the
-- test becomes "the last message is not MINE, and it is newer than my stamp":
--   * `last_sender_id` (new, trigger-maintained) answers the first half,
--   * `support_thread_members.last_read_at` (per participant) the second.
-- ============================================================================


-- ── 1. The private schema (no-op if security_function_hardening.sql ran) ─────

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


-- ── 2. New columns on support_threads ───────────────────────────────────────
-- `kind` defaults to 'support', so every existing row is already correct and
-- no backfill runs. `last_sender_id` is maintained by the trigger in §5 and is
-- NOT in the client UPDATE grant — a participant can no more forge it than
-- they can forge last_message_at.

alter table public.support_threads
  add column if not exists kind text not null default 'support';

alter table public.support_threads
  add column if not exists last_sender_id uuid references auth.users(id) on delete set null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.support_threads'::regclass and conname = 'support_threads_kind_check'
  ) then
    alter table public.support_threads
      add constraint support_threads_kind_check check (kind in ('support','team'));
  end if;
end $$;

create index if not exists support_threads_kind_idx
  on public.support_threads (kind, last_message_at desc);


-- ── 3. Widen the two role CHECKs to accept 'member' ─────────────────────────
-- The originals are unnamed inline column checks, so their names are
-- auto-generated (support_threads_last_sender_role_check /
-- support_messages_sender_role_check). Rather than trust that, find every check
-- constraint on the table whose definition mentions the column and drop it,
-- then add ours back under a name we own. Re-running finds only our own.

do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.support_threads'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%last_sender_role%'
  loop
    execute format('alter table public.support_threads drop constraint %I', c.conname);
  end loop;
  alter table public.support_threads
    add constraint support_threads_last_sender_role_check
    check (last_sender_role is null or last_sender_role in ('user','founder','member'));

  for c in
    select conname from pg_constraint
    where conrelid = 'public.support_messages'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%sender_role%'
  loop
    execute format('alter table public.support_messages drop constraint %I', c.conname);
  end loop;
  alter table public.support_messages
    add constraint support_messages_sender_role_check
    check (sender_role in ('user','founder','member'));
end $$;


-- ── 4. The participant table ────────────────────────────────────────────────
-- The PK (thread_id, user_id) IS the "in a conversation at most once" rule — a
-- double-add hits 23505 instead of creating a second row (same reasoning as
-- product_labels in listing_labels.sql).
--
-- `email` is denormalised because auth.users is not client-readable and the
-- thread list has to print who is in a conversation; the INSERT policy proves
-- it against org_members, so it cannot be a made-up name.
--
-- `last_read_at` defaults to now(), which is what makes a newly added
-- participant see only messages sent AFTER they joined as unread.

create table if not exists public.support_thread_members (
  thread_id    uuid not null references public.support_threads(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  email        text,
  last_read_at timestamptz default now(),
  added_at     timestamptz not null default now(),
  primary key (thread_id, user_id)
);

create index if not exists support_thread_members_user_idx
  on public.support_thread_members (user_id);

alter table public.support_thread_members enable row level security;


-- ── 5. The policy helper ────────────────────────────────────────────────────
-- SECURITY DEFINER so it reads support_thread_members as the table owner and
-- no policy is evaluated (see the header). STABLE, search_path pinned.
-- The `public` twin is SECURITY INVOKER — policies, and only policies, call it,
-- and an RLS expression requires the INVOKING role to hold EXECUTE on what it
-- calls, which is why `authenticated` keeps EXECUTE on both halves.

create or replace function app_private.is_thread_participant(p_thread uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.support_thread_members m
    where m.thread_id = p_thread and m.user_id = auth.uid()
  );
$$;

create or replace function public.is_thread_participant(p_thread uuid)
returns boolean
language sql
stable
security invoker
set search_path = app_private, public
as $$ select app_private.is_thread_participant(p_thread) $$;

do $$
begin
  execute 'revoke all on function app_private.is_thread_participant(uuid) from public';
  execute 'revoke all on function public.is_thread_participant(uuid) from public';
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function app_private.is_thread_participant(uuid) from anon';
    execute 'revoke all on function public.is_thread_participant(uuid) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function app_private.is_thread_participant(uuid) to authenticated';
    execute 'grant execute on function public.is_thread_participant(uuid) to authenticated';
  end if;
end $$;


-- ── 6. The message trigger, extended ────────────────────────────────────────
-- Same function as support_messaging.sql plus two things: it records
-- last_sender_id, and for a 'member' message it stamps the SENDER's own
-- participant row instead of one of the two support read columns (a team
-- thread has no "user side" / "founder side").
--
-- Trigger function = treatment B in security_function_hardening.sql: it stays
-- in `public` with EXECUTE revoked from PUBLIC, anon AND authenticated. Firing
-- a trigger does not require the invoking role to hold EXECUTE. CREATE OR
-- REPLACE preserves existing grants, so the revokes below are belt-and-braces
-- for a database where the hardening file has not run yet.

create or replace function public.support_after_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.support_threads t set
    last_message_at      = new.created_at,
    last_message_preview = left(new.body, 140),
    last_sender_role     = new.sender_role,
    last_sender_id       = new.sender_id,
    status               = 'open',
    updated_at           = now(),
    user_last_read_at    = case when new.sender_role = 'user'    then new.created_at else t.user_last_read_at end,
    founder_last_read_at = case when new.sender_role = 'founder' then new.created_at else t.founder_last_read_at end
  where t.id = new.thread_id;

  -- A team message: the sender has read their own message.
  if new.sender_role = 'member' and new.sender_id is not null then
    update public.support_thread_members m
       set last_read_at = new.created_at
     where m.thread_id = new.thread_id and m.user_id = new.sender_id;
  end if;

  return new;
end;
$$;

drop trigger if exists support_messages_after_insert on public.support_messages;
create trigger support_messages_after_insert
  after insert on public.support_messages
  for each row execute function public.support_after_message();

do $$
begin
  execute 'revoke all on function public.support_after_message() from public';
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.support_after_message() from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public.support_after_message() from authenticated';
  end if;
end $$;


-- ── 7. Grants ───────────────────────────────────────────────────────────────
-- support_threads gains DELETE, scoped by the policy below to a TEAM thread I
-- created. It exists for exactly one reason: createTeamThread() inserts the
-- thread, then the participants, then the first message, and a failure at step
-- 2 or 3 must not leave a half-built conversation in everybody's list. Support
-- threads stay undeletable from any client, as they were.

grant delete on public.support_threads to authenticated;

grant select, delete on public.support_thread_members to authenticated;
-- The client supplies only who is in the conversation; added_at and the initial
-- last_read_at come from their defaults.
grant insert (thread_id, user_id, email) on public.support_thread_members to authenticated;
-- The ONLY column a participant may move is their own read marker.
grant update (last_read_at) on public.support_thread_members to authenticated;


-- ── 8. Policies ─────────────────────────────────────────────────────────────
-- Every helper call is written `(select public.x())` so it is evaluated once
-- per statement rather than once per row — the InitPlan rule, AGENTS.md §18 #47.
-- `is_thread_participant(id)` takes the row, so it is a correlated SubPlan; it
-- is wrapped anyway for uniformity (perf_rls_initplan.sql says why).
--
-- NOT RECREATED HERE: support_threads_insert. It is owned by
-- security_verified_email.sql (it carries the verified-email condition) and a
-- team thread needs nothing extra from it — the row is still `user_id = me`,
-- and security_abuse_limits.sql's BEFORE INSERT trigger still derives org_id
-- and org_name from the caller's real membership.

drop policy if exists support_threads_select on public.support_threads;
create policy support_threads_select on public.support_threads for select
  to authenticated using (
    user_id = (select auth.uid())
    or (kind = 'support' and (select public.is_beta_admin()))
    or (select public.is_thread_participant(id))
  );

drop policy if exists support_threads_update on public.support_threads;
create policy support_threads_update on public.support_threads for update
  to authenticated
  using (
    user_id = (select auth.uid())
    or (kind = 'support' and (select public.is_beta_admin()))
    or (select public.is_thread_participant(id))
  )
  with check (
    user_id = (select auth.uid())
    or (kind = 'support' and (select public.is_beta_admin()))
    or (select public.is_thread_participant(id))
  );

drop policy if exists support_threads_delete on public.support_threads;
create policy support_threads_delete on public.support_threads for delete
  to authenticated using (kind = 'team' and user_id = (select auth.uid()));

-- Participants: I see the roster of any thread I am in (my own row is what puts
-- me in it, so the creator is covered by the same rule as everybody else).
drop policy if exists support_thread_members_select on public.support_thread_members;
create policy support_thread_members_select on public.support_thread_members for select
  to authenticated using (
    user_id = (select auth.uid())
    or (select public.is_thread_participant(thread_id))
  );

-- Adding someone: only the creator of a TEAM thread, and only somebody who is
-- really in that thread's workspace — proving the product/org relationship the
-- same way listing_labels.sql's product_labels INSERT policy does, so a member
-- id cannot be guessed at from another workspace. The denormalised email must
-- match that membership row (case-insensitively) or be omitted.
drop policy if exists support_thread_members_insert on public.support_thread_members;
create policy support_thread_members_insert on public.support_thread_members for insert
  to authenticated with check (
    exists (
      select 1 from public.support_threads t
      where t.id = support_thread_members.thread_id
        and t.kind = 'team'
        and t.user_id = (select auth.uid())
        and exists (
          select 1 from public.org_members om
          where om.org_id = t.org_id
            and om.user_id = support_thread_members.user_id
            and (
              support_thread_members.email is null
              or lower(support_thread_members.email) = lower(coalesce(om.email, ''))
            )
        )
    )
  );

-- My read marker, and nobody else's.
drop policy if exists support_thread_members_update on public.support_thread_members;
create policy support_thread_members_update on public.support_thread_members for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Leaving a conversation (my own row) or removing someone from one I started.
drop policy if exists support_thread_members_delete on public.support_thread_members;
create policy support_thread_members_delete on public.support_thread_members for delete
  to authenticated using (
    user_id = (select auth.uid())
    or exists (
      select 1 from public.support_threads t
      where t.id = support_thread_members.thread_id and t.user_id = (select auth.uid())
    )
  );

-- Messages are readable exactly when their thread is. Written out rather than
-- delegated so the condition is readable at the point it is enforced.
drop policy if exists support_messages_select on public.support_messages;
create policy support_messages_select on public.support_messages for select
  to authenticated using (
    exists (
      select 1 from public.support_threads t
      where t.id = thread_id
        and (
          t.user_id = (select auth.uid())
          or (t.kind = 'support' and (select public.is_beta_admin()))
          or (select public.is_thread_participant(t.id))
        )
    )
  );

-- Who may post as what. A founder posting into their OWN workspace's team
-- thread posts as 'member' like anybody else; 'founder' is a support-desk role
-- and is rejected on a team thread, and 'member' is rejected on a support one.
drop policy if exists support_messages_insert on public.support_messages;
create policy support_messages_insert on public.support_messages for insert
  to authenticated with check (
    sender_id = (select auth.uid())
    and (
      (sender_role = 'user' and exists (
         select 1 from public.support_threads t
         where t.id = thread_id and t.kind = 'support' and t.user_id = (select auth.uid())))
      or
      (sender_role = 'founder' and (select public.is_beta_admin()) and exists (
         select 1 from public.support_threads t
         where t.id = thread_id and t.kind = 'support'))
      or
      (sender_role = 'member' and (select public.is_thread_participant(thread_id)) and exists (
         select 1 from public.support_threads t
         where t.id = thread_id and t.kind = 'team'))
    )
  );


-- ── 9. Realtime ─────────────────────────────────────────────────────────────
-- support_thread_members joins the publication so that turning on live read
-- receipts later is a CLIENT-ONLY change. Nothing subscribes to it today:
-- supportService.subscribeToSupport still listens to INSERT on
-- support_messages and INSERT/UPDATE on support_threads only, and a read stamp
-- moving is not news worth a render — it arrives with the next poll.
--
-- DELIBERATELY NOT `replica identity full` here, unlike the other two tables.
-- FULL exists there so UPDATE payloads carry enough of the row for RLS to
-- filter them; this table's policy keys on (thread_id, user_id), which IS the
-- primary key, so the default identity is sufficient — and it keeps a DELETE
-- payload from carrying a participant's email (the same reasoning that keeps
-- DELETE off the subscription at all; see supportService).

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public'
                   and tablename = 'support_thread_members') then
    alter publication supabase_realtime add table public.support_thread_members;
  end if;
end;
$$;


-- ============================================================================
-- VERIFY (run separately)
-- ============================================================================
-- -- (a) The new shape:
-- select column_name, data_type, column_default from information_schema.columns
--  where table_name = 'support_threads' and column_name in ('kind','last_sender_id');
-- select conname, pg_get_constraintdef(oid) from pg_constraint
--  where conrelid in ('public.support_threads'::regclass,'public.support_messages'::regclass)
--    and contype = 'c';
--
-- -- (b) Every policy, with the helper calls wrapped:
-- select tablename, policyname, cmd, qual, with_check from pg_policies
--  where tablename in ('support_threads','support_messages','support_thread_members')
--  order by tablename, policyname;
--
-- -- (c) Nothing existing changed kind:
-- select kind, count(*) from public.support_threads group by 1;   -- expect only 'support'
--
-- -- (d) The helper is private and not executable by anon:
-- select n.nspname, p.proname, p.prosecdef, pg_get_function_identity_arguments(p.oid)
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--  where p.proname = 'is_thread_participant';
-- select has_function_privilege('anon', 'public.is_thread_participant(uuid)', 'execute');   -- false
-- select has_function_privilege('authenticated', 'public.is_thread_participant(uuid)', 'execute'); -- true


-- ============================================================================
-- ROLLBACK (manual) — restores support_messaging.sql's policy set exactly
-- ============================================================================
-- PRE-STEP — RUN THIS FIRST, AND READ WHY:
--
--   delete from public.support_messages where sender_role = 'member';
--   delete from public.support_threads  where kind = 'team';
--
-- The narrowed CHECKs at the bottom of this block refuse to install while a
-- 'member' row survives, and this block is NOT one transaction — so a rollback
-- started without the pre-step gets HALF WAY (support_thread_members dropped,
-- the helper dropped, the pre-team policies already restored) and then stops.
-- In that half-way state the restored `support_threads_select` is
-- `user_id = auth.uid() or public.is_beta_admin()` with no `kind` test, and
-- every surviving team thread — and every message in it — is readable from the
-- founders' inbox. Verified on a throwaway PG 14: a founder in an unrelated
-- workspace saw the team thread's subject, preview and body.
--
-- Deleting the team THREADS is therefore not tidying-up. Once `kind` is
-- dropped a team thread is indistinguishable from a support thread, so there is
-- no later moment at which it can be told apart and excluded. If those
-- conversations must be kept, export them before rolling back.
--
-- do $$
-- begin
--   if exists (select 1 from pg_publication_tables
--              where pubname = 'supabase_realtime' and schemaname = 'public'
--                and tablename = 'support_thread_members') then
--     alter publication supabase_realtime drop table public.support_thread_members;
--   end if;
-- end $$;
--
-- drop policy if exists support_thread_members_select on public.support_thread_members;
-- drop policy if exists support_thread_members_insert on public.support_thread_members;
-- drop policy if exists support_thread_members_update on public.support_thread_members;
-- drop policy if exists support_thread_members_delete on public.support_thread_members;
-- drop table if exists public.support_thread_members;
--
-- drop policy if exists support_threads_delete on public.support_threads;
-- revoke delete on public.support_threads from authenticated;
--
-- drop policy if exists support_threads_select on public.support_threads;
-- create policy support_threads_select on public.support_threads for select
--   to authenticated using (user_id = auth.uid() or public.is_beta_admin());
-- drop policy if exists support_threads_update on public.support_threads;
-- create policy support_threads_update on public.support_threads for update
--   to authenticated
--   using (user_id = auth.uid() or public.is_beta_admin())
--   with check (user_id = auth.uid() or public.is_beta_admin());
-- drop policy if exists support_messages_select on public.support_messages;
-- create policy support_messages_select on public.support_messages for select
--   to authenticated using (
--     exists (select 1 from public.support_threads t
--             where t.id = thread_id and (t.user_id = auth.uid() or public.is_beta_admin())));
-- drop policy if exists support_messages_insert on public.support_messages;
-- create policy support_messages_insert on public.support_messages for insert
--   to authenticated with check (
--     sender_id = auth.uid()
--     and (
--       (sender_role = 'user' and exists (
--          select 1 from public.support_threads t where t.id = thread_id and t.user_id = auth.uid()))
--       or (sender_role = 'founder' and public.is_beta_admin())
--     ));
--
-- create or replace function public.support_after_message()
-- returns trigger language plpgsql security definer set search_path = public as $$
-- begin
--   update public.support_threads t set
--     last_message_at      = new.created_at,
--     last_message_preview = left(new.body, 140),
--     last_sender_role     = new.sender_role,
--     status               = 'open',
--     updated_at           = now(),
--     user_last_read_at    = case when new.sender_role = 'user'    then new.created_at else t.user_last_read_at end,
--     founder_last_read_at = case when new.sender_role = 'founder' then new.created_at else t.founder_last_read_at end
--   where t.id = new.thread_id;
--   return new;
-- end; $$;
--
-- drop function if exists public.is_thread_participant(uuid);
-- drop function if exists app_private.is_thread_participant(uuid);
--
-- -- Narrow the CHECKs back (fails if any 'member' row survives — clear them first):
-- alter table public.support_messages drop constraint if exists support_messages_sender_role_check;
-- alter table public.support_messages add constraint support_messages_sender_role_check
--   check (sender_role in ('user','founder'));
-- alter table public.support_threads drop constraint if exists support_threads_last_sender_role_check;
-- alter table public.support_threads add constraint support_threads_last_sender_role_check
--   check (last_sender_role is null or last_sender_role in ('user','founder'));
--
-- drop index if exists public.support_threads_kind_idx;
-- alter table public.support_threads drop constraint if exists support_threads_kind_check;
-- alter table public.support_threads drop column if exists last_sender_id;
-- alter table public.support_threads drop column if exists kind;
