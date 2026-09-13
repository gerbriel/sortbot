-- ============================================================================
-- SUPPORT MESSAGING — in-app conversations between users and the founders
-- ============================================================================
-- Run AFTER multi_org_tenancy.sql and beta_signups.sql (default_org_id(),
-- organizations, is_beta_admin()). Purely additive; idempotent; rollback at
-- the bottom. Nothing in the listing workflow reads or writes these tables.
--
-- MODEL: a thread belongs to ONE user (the person who opened it). Founding
-- Workspace owners/admins see every thread (the inbox) and answer as
-- 'founder'. No third-party chat service — the widget, the inbox and the
-- realtime updates all run on our own Supabase project.
--   * support_threads  one per conversation; denormalized user_email/org_name
--                      for the inbox (auth.users is not client-readable);
--                      last_* columns are maintained by a trigger so clients
--                      never write them.
--   * support_messages the messages; sender_role is enforced by RLS — a user
--                      can only post as 'user' in their own thread, a founder
--                      only as 'founder'.
--   * Unread = last message from the OTHER side is newer than my last-read
--     stamp (user_last_read_at / founder_last_read_at, set by the client when
--     a thread is viewed).
--   * REALTIME: both tables are added to the supabase_realtime publication so
--     the widget updates live (postgres_changes honors RLS). The client also
--     polls as a fallback, so the feature works even if realtime is off.
-- ============================================================================

create table if not exists public.support_threads (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null default auth.uid() references auth.users(id) on delete cascade,
  user_email           text,
  org_id               uuid default public.default_org_id() references public.organizations(id) on delete set null,
  org_name             text,
  subject              text check (subject is null or char_length(subject) <= 140),
  status               text not null default 'open' check (status in ('open','closed')),
  last_message_at      timestamptz not null default now(),
  last_message_preview text,
  last_sender_role     text check (last_sender_role is null or last_sender_role in ('user','founder')),
  user_last_read_at    timestamptz default now(),
  founder_last_read_at timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists support_threads_user_idx
  on public.support_threads (user_id, last_message_at desc);
create index if not exists support_threads_inbox_idx
  on public.support_threads (status, last_message_at desc);

create table if not exists public.support_messages (
  id          uuid primary key default gen_random_uuid(),
  thread_id   uuid not null references public.support_threads(id) on delete cascade,
  sender_id   uuid default auth.uid() references auth.users(id) on delete set null,
  sender_role text not null check (sender_role in ('user','founder')),
  body        text not null check (char_length(body) between 1 and 4000),
  created_at  timestamptz not null default now()
);

create index if not exists support_messages_thread_idx
  on public.support_messages (thread_id, created_at asc);

-- ── Trigger: a new message updates its thread (and reopens it) ──────────────
-- SECURITY DEFINER so it can write the last_* columns clients have no grant on.
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
    status               = 'open',
    updated_at           = now(),
    user_last_read_at    = case when new.sender_role = 'user'    then new.created_at else t.user_last_read_at end,
    founder_last_read_at = case when new.sender_role = 'founder' then new.created_at else t.founder_last_read_at end
  where t.id = new.thread_id;
  return new;
end;
$$;

drop trigger if exists support_messages_after_insert on public.support_messages;
create trigger support_messages_after_insert
  after insert on public.support_messages
  for each row execute function public.support_after_message();

alter table public.support_threads  enable row level security;
alter table public.support_messages enable row level security;

grant select, insert on public.support_threads to authenticated;
-- Clients may only move the read stamps, the status and the subject; identity
-- and the trigger-maintained columns are immutable from the client.
grant update (subject, status, user_last_read_at, founder_last_read_at) on public.support_threads to authenticated;
grant select, insert on public.support_messages to authenticated;

-- Threads: mine, or everything for founding admins.
drop policy if exists support_threads_select on public.support_threads;
create policy support_threads_select on public.support_threads for select
  to authenticated using (user_id = auth.uid() or public.is_beta_admin());

-- Opening a thread: it is always MINE, with my own email.
drop policy if exists support_threads_insert on public.support_threads;
create policy support_threads_insert on public.support_threads for insert
  to authenticated with check (
    user_id = auth.uid()
    and (user_email is null or lower(user_email) = lower(auth.jwt() ->> 'email'))
  );

drop policy if exists support_threads_update on public.support_threads;
create policy support_threads_update on public.support_threads for update
  to authenticated
  using (user_id = auth.uid() or public.is_beta_admin())
  with check (user_id = auth.uid() or public.is_beta_admin());

-- Messages: readable with the thread; sender identity + role enforced.
drop policy if exists support_messages_select on public.support_messages;
create policy support_messages_select on public.support_messages for select
  to authenticated using (
    exists (select 1 from public.support_threads t
            where t.id = thread_id and (t.user_id = auth.uid() or public.is_beta_admin()))
  );

drop policy if exists support_messages_insert on public.support_messages;
create policy support_messages_insert on public.support_messages for insert
  to authenticated with check (
    sender_id = auth.uid()
    and (
      (sender_role = 'user' and exists (
         select 1 from public.support_threads t where t.id = thread_id and t.user_id = auth.uid()))
      or
      (sender_role = 'founder' and public.is_beta_admin())
    )
  );

-- ── Realtime ─────────────────────────────────────────────────────────────────
-- FULL replica identity so UPDATE events (read stamps, status) carry the row
-- and RLS can filter them for each subscriber.
alter table public.support_threads  replica identity full;
alter table public.support_messages replica identity full;

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'support_threads') then
    alter publication supabase_realtime add table public.support_threads;
  end if;
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'support_messages') then
    alter publication supabase_realtime add table public.support_messages;
  end if;
end;
$$;

-- ============================================================================
-- ROLLBACK (manual)
-- ============================================================================
-- alter publication supabase_realtime drop table public.support_messages;
-- alter publication supabase_realtime drop table public.support_threads;
-- drop trigger if exists support_messages_after_insert on public.support_messages;
-- drop function if exists public.support_after_message();
-- drop table if exists public.support_messages;
-- drop table if exists public.support_threads;
