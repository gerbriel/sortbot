-- ============================================================================
-- SECURITY: ABUSE LIMITS — bound the three client-writable tables
-- ============================================================================
-- Run AFTER analytics_events.sql, beta_signups.sql and support_messaging.sql
-- (and therefore after multi_org_tenancy.sql). Additive, idempotent, rollback
-- at the bottom. Every section is guarded, so the file runs cleanly even if
-- one of those optional migrations has never been applied.
--
-- WHAT IT CLOSES (security audit 05):
--   #6  analytics_events is anon-INSERTable with NO size cap on `props`, no
--       row-rate limit and an arbitrary `event` string → unbounded DB growth,
--       storage cost, and funnel poisoning (fake "Beta Signup" rows).
--   #16 beta_signups is anon-INSERTable with NO length checks on org_name /
--       contact_name / notes / store_url → cheap storage exhaustion and
--       founder-panel spam. Its unvalidated `email` is also what enables the
--       mailto: header injection of #7 (the client-side half is in
--       src/lib/mailto.ts).
--   #10 Support messaging has no quotas at all (unlimited threads, unlimited
--       4 000-char messages → inbox DoS), and a thread owner can suppress the
--       founder's unread badge (founder_last_read_at) and forge the org_id /
--       org_name the founder inbox displays.
--
-- WHY TRIGGERS, NOT POLICIES: rate/quota rules need a COUNT over the table,
-- which anon has no SELECT grant for and which RLS would filter. SECURITY
-- DEFINER trigger functions see the real counts and cannot be bypassed by
-- talking straight to PostgREST. Column-level grants cannot be made
-- role-conditional, which is why the founder-only columns are protected by a
-- BEFORE UPDATE trigger that resets them rather than by a grant.
--
-- ALL CHECK CONSTRAINTS ARE `NOT VALID`: new rows are validated, existing
-- history is left alone (validating would fail the migration on any legacy row
-- that predates the rule, and deleting history is not this file's job).
-- ============================================================================


-- ════════════════════════════════════════════════════════════════════════════
-- 1. analytics_events (#6) — bounded payload, sane event names, rate limit
-- ════════════════════════════════════════════════════════════════════════════
do $$
begin
  if to_regclass('public.analytics_events') is null then
    raise notice 'analytics_events not present — skipping section 1';
    return;
  end if;

  -- props is a free-form jsonb bag written by anonymous visitors. 2 KB is ~40×
  -- the largest thing the app actually sends ({"products": 37}).
  -- NOTE: if this Postgres rejects pg_column_size() in a CHECK, the drop-in
  -- equivalent is  octet_length(props::text) <= 2048.
  alter table public.analytics_events
    drop constraint if exists analytics_events_props_size_chk;
  alter table public.analytics_events
    add  constraint analytics_events_props_size_chk
    check (pg_column_size(props) <= 2048) not valid;

  -- Event names are a closed vocabulary in practice (pageview, Beta Signup,
  -- Account Created, Batch Created, CSV Exported). This allows that shape and
  -- nothing exotic — no control characters, no 60-char garbage streams.
  alter table public.analytics_events
    drop constraint if exists analytics_events_event_pattern_chk;
  alter table public.analytics_events
    add  constraint analytics_events_event_pattern_chk
    check (event ~ '^[A-Za-z0-9][A-Za-z0-9 ._-]{0,59}$') not valid;
end $$;

-- Per-session insert rate. 120 rows / 10 minutes is far above any real session
-- (a full funnel is ~6 events) and far below anything worth paying for.
create or replace function public.analytics_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare n int;
begin
  select count(*) into n
  from public.analytics_events
  where session_id = new.session_id
    and created_at > now() - interval '10 minutes';
  if n >= 120 then
    raise exception 'analytics: rate limit for this session' using errcode = '54000';
  end if;
  return new;
end $$;

do $$
begin
  if to_regclass('public.analytics_events') is null then return; end if;
  drop trigger if exists analytics_events_rate_limit on public.analytics_events;
  create trigger analytics_events_rate_limit
    before insert on public.analytics_events
    for each row execute function public.analytics_rate_limit();
end $$;


-- ════════════════════════════════════════════════════════════════════════════
-- 2. beta_signups (#16, and the server half of #7) — real input validation
-- ════════════════════════════════════════════════════════════════════════════
do $$
begin
  if to_regclass('public.beta_signups') is null then
    raise notice 'beta_signups not present — skipping section 2';
    return;
  end if;

  alter table public.beta_signups drop constraint if exists beta_signups_len_chk;
  alter table public.beta_signups add constraint beta_signups_len_chk check (
    char_length(org_name)     between 1 and 120
    and char_length(contact_name) between 1 and 120
    and char_length(email)    between 6 and 254
    and (store_url is null or char_length(store_url) <= 200)
    and (volume    is null or char_length(volume)    <= 60)
    and (notes     is null or char_length(notes)     <= 2000)
  ) not valid;

  -- Strict address shape: no '?', '&', '<', '>', ',', ';', whitespace or
  -- control characters can reach the founder panel, so the stored value can
  -- never smuggle extra mailto: headers (bcc=, body=) into a mail client.
  alter table public.beta_signups drop constraint if exists beta_signups_email_chk;
  alter table public.beta_signups add constraint beta_signups_email_chk
    check (email ~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$') not valid;
end $$;


-- ════════════════════════════════════════════════════════════════════════════
-- 3. support messaging (#10) — quotas, and columns the client may not write
-- ════════════════════════════════════════════════════════════════════════════

-- 3a. BEFORE INSERT on support_threads: quota + org truth.
-- org_id/org_name are displayed in the founder inbox, and the client passes
-- org_name as a plain string. Rather than reject a mismatch (which would break
-- the widget whenever the client's copy drifts), derive both from the caller's
-- real membership. Forging becomes impossible and no valid request ever fails.
create or replace function public.support_thread_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare open_threads int;
begin
  -- Quota: founders are exempt (they never open threads, but a founder testing
  -- the widget should not be able to lock themselves out either).
  if not public.is_beta_admin() then
    select count(*) into open_threads
    from public.support_threads
    where user_id = auth.uid() and status = 'open';
    if open_threads >= 20 then
      raise exception 'You already have 20 open conversations — close one first.'
        using errcode = '54000';
    end if;
  end if;

  -- Org identity is derived, never accepted from the client.
  if new.org_id is null or new.org_id not in (select public.user_org_ids()) then
    new.org_id := public.default_org_id();
  end if;
  new.org_name := (select o.name from public.organizations o where o.id = new.org_id);

  return new;
end $$;

-- 3b. BEFORE UPDATE on support_threads: read stamps belong to their own side.
-- The UPDATE grant is (subject, status, user_last_read_at, founder_last_read_at)
-- for everyone, and a grant cannot be conditional on is_beta_admin(). So the
-- trigger puts back any value the caller was not entitled to write.
create or replace function public.support_thread_before_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Only a founder may move the FOUNDER's read stamp (else the thread owner
  -- clears the founder's unread badge and the message is never noticed).
  if not public.is_beta_admin() then
    new.founder_last_read_at := old.founder_last_read_at;
  end if;
  -- Only the thread's owner may move the USER's read stamp.
  if old.user_id is distinct from auth.uid() then
    new.user_last_read_at := old.user_last_read_at;
  end if;
  -- Identity and inbox-display columns are immutable from any client. (The
  -- column grant already excludes them; this is the belt-and-braces half, and
  -- it also covers any future grant widening.)
  new.user_id    := old.user_id;
  new.user_email := old.user_email;
  new.org_id     := old.org_id;
  new.org_name   := old.org_name;
  return new;
end $$;

-- 3c. BEFORE INSERT on support_messages: per-user message rate.
-- 30 messages / 10 minutes is a fast typist's ceiling, not a limit a real
-- conversation reaches. Founders are exempt (they answer many threads at once).
create or replace function public.support_message_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare n int;
begin
  if public.is_beta_admin() then return new; end if;
  select count(*) into n
  from public.support_messages
  where sender_id = auth.uid()
    and created_at > now() - interval '10 minutes';
  if n >= 30 then
    raise exception 'Too many messages — try again in a few minutes.'
      using errcode = '54000';
  end if;
  return new;
end $$;

do $$
begin
  if to_regclass('public.support_threads') is null then
    raise notice 'support_threads not present — skipping section 3 triggers';
    return;
  end if;

  drop trigger if exists support_threads_before_insert on public.support_threads;
  create trigger support_threads_before_insert
    before insert on public.support_threads
    for each row execute function public.support_thread_before_insert();

  drop trigger if exists support_threads_before_update on public.support_threads;
  create trigger support_threads_before_update
    before update on public.support_threads
    for each row execute function public.support_thread_before_update();

  if to_regclass('public.support_messages') is not null then
    drop trigger if exists support_messages_rate_limit on public.support_messages;
    create trigger support_messages_rate_limit
      before insert on public.support_messages
      for each row execute function public.support_message_rate_limit();
  end if;
end $$;


-- ============================================================================
-- VERIFY (run separately)
-- ============================================================================
-- -- (a) The new constraints and triggers exist:
-- select conname, convalidated from pg_constraint
-- where conrelid in ('public.analytics_events'::regclass, 'public.beta_signups'::regclass)
--   and conname like '%_chk';
-- select tgname, tgrelid::regclass from pg_trigger
-- where not tgisinternal and tgname in ('analytics_events_rate_limit',
--   'support_threads_before_insert','support_threads_before_update',
--   'support_messages_rate_limit');
--
-- -- (b) Oversized analytics props must FAIL (23514):
-- insert into public.analytics_events (event, props, session_id)
-- values ('pageview', jsonb_build_object('x', repeat('a', 4000)), 'verify-session-1');
--
-- -- (c) A junk event name must FAIL (23514):
-- insert into public.analytics_events (event, session_id)
-- values (E'bad\nname', 'verify-session-2');
--
-- -- (d) A header-injecting beta email must FAIL (23514):
-- insert into public.beta_signups (org_name, contact_name, email)
-- values ('x', 'y', 'a@b.com?bcc=me@evil.com');
--
-- -- (e) As an ordinary user, the founder's stamp must NOT move (the value is
-- --     unchanged after the update):
-- update public.support_threads set founder_last_read_at = now()
-- where user_id = auth.uid() returning founder_last_read_at;
--
-- -- (f) Rows that would violate the NOT VALID constraints (history to clean up
-- --     before you ever `validate constraint`):
-- select count(*) from public.analytics_events where pg_column_size(props) > 2048;
-- select count(*) from public.analytics_events
--   where event !~ '^[A-Za-z0-9][A-Za-z0-9 ._-]{0,59}$';


-- ============================================================================
-- ROLLBACK
-- ============================================================================
-- drop trigger if exists support_messages_rate_limit  on public.support_messages;
-- drop trigger if exists support_threads_before_update on public.support_threads;
-- drop trigger if exists support_threads_before_insert on public.support_threads;
-- drop trigger if exists analytics_events_rate_limit   on public.analytics_events;
-- drop function if exists public.support_message_rate_limit();
-- drop function if exists public.support_thread_before_update();
-- drop function if exists public.support_thread_before_insert();
-- drop function if exists public.analytics_rate_limit();
-- alter table public.analytics_events drop constraint if exists analytics_events_props_size_chk;
-- alter table public.analytics_events drop constraint if exists analytics_events_event_pattern_chk;
-- alter table public.beta_signups     drop constraint if exists beta_signups_len_chk;
-- alter table public.beta_signups     drop constraint if exists beta_signups_email_chk;
