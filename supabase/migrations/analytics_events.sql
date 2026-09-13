-- ============================================================================
-- ANALYTICS EVENTS — first-party, cookieless product analytics
-- ============================================================================
-- Run AFTER multi_org_tenancy.sql and beta_signups.sql (organizations FK +
-- is_beta_admin()). Purely additive; idempotent; rollback at the bottom.
-- Nothing else in the app reads or writes this table.
--
-- MODEL: the browser writes one row per pageview / funnel event straight into
-- OUR OWN Supabase project — anon visitors on the landing page included. No
-- third-party script, no external API, nothing leaves the database we run.
--   * INSERT: anon + authenticated. Anon rows can never carry a user/org id;
--     signed-in rows may only carry the caller's own user id.
--   * SELECT: Founding Workspace owners/admins only (is_beta_admin()) — and in
--     practice they read the analytics_summary() aggregate, not raw rows.
--   * No client UPDATE/DELETE. analytics_prune() (founding admins) trims history.
--   * PRIVACY: session_id is a random per-tab id (sessionStorage — gone when the
--     tab closes), referrer is the HOST only, device is a coarse class. No IP,
--     no user agent, no cookies. The client honors Do Not Track and skips
--     localhost.
-- ============================================================================

create table if not exists public.analytics_events (
  id         bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  event      text not null check (char_length(event) between 1 and 60),
  props      jsonb not null default '{}'::jsonb,
  session_id text not null check (char_length(session_id) between 8 and 64),
  user_id    uuid references auth.users(id) on delete set null,
  org_id     uuid references public.organizations(id) on delete set null,
  view       text check (view is null or char_length(view) <= 30),
  path       text check (path is null or char_length(path) <= 200),
  referrer   text check (referrer is null or char_length(referrer) <= 200),
  device     text check (device is null or device in ('mobile','tablet','desktop'))
);

create index if not exists analytics_events_created_idx
  on public.analytics_events (created_at desc);
create index if not exists analytics_events_event_created_idx
  on public.analytics_events (event, created_at desc);
create index if not exists analytics_events_session_idx
  on public.analytics_events (session_id);

alter table public.analytics_events enable row level security;

grant insert on public.analytics_events to anon, authenticated;
grant select on public.analytics_events to authenticated;
grant usage on sequence public.analytics_events_id_seq to anon, authenticated;

-- Anonymous visitors: a row, but never an identity.
drop policy if exists analytics_insert_anon on public.analytics_events;
create policy analytics_insert_anon on public.analytics_events for insert
  to anon with check (user_id is null and org_id is null);

-- Signed-in users: only their own user id (org_id is not verified — it is a
-- cosmetic dimension the founders' dashboard groups by, never an access key).
drop policy if exists analytics_insert_auth on public.analytics_events;
create policy analytics_insert_auth on public.analytics_events for insert
  to authenticated with check (user_id is null or user_id = auth.uid());

drop policy if exists analytics_select on public.analytics_events;
create policy analytics_select on public.analytics_events for select
  to authenticated using (public.is_beta_admin());

-- ── Aggregate for the founder dashboard ─────────────────────────────────────
-- One round-trip returns everything the Analytics view draws: totals for the
-- range and the previous range (for deltas), a zero-filled daily series, top
-- events, referrers, devices, views. UTC days. Founding admins only.
create or replace function public.analytics_summary(p_days int default 30)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_days      int := greatest(1, least(coalesce(p_days, 30), 365));
  v_from      timestamptz := (date_trunc('day', now() at time zone 'utc')
                              - make_interval(days => v_days - 1)) at time zone 'utc';
  v_prev_from timestamptz;
  result      jsonb;
begin
  if not public.is_beta_admin() then
    raise exception 'analytics_summary: Founding Workspace admins only'
      using errcode = '42501';
  end if;
  v_prev_from := v_from - make_interval(days => v_days);

  with ev as (
    select * from public.analytics_events where created_at >= v_from
  ), prev as (
    select * from public.analytics_events
    where created_at >= v_prev_from and created_at < v_from
  ), days as (
    select generate_series(
      (v_from at time zone 'utc')::date,
      ((v_from + make_interval(days => v_days - 1)) at time zone 'utc')::date,
      interval '1 day'
    )::date as day
  ), per_day as (
    select (created_at at time zone 'utc')::date as day,
           count(*) filter (where event = 'pageview') as pv,
           count(distinct session_id) as s
    from ev group by 1
  )
  select jsonb_build_object(
    'days', v_days,
    'from', v_from,
    'totals', (select jsonb_build_object(
        'pageviews',    count(*) filter (where event = 'pageview'),
        'sessions',     count(distinct session_id),
        'users',        count(distinct user_id),
        'events',       count(*) filter (where event <> 'pageview'),
        'beta_signups', count(*) filter (where event = 'Beta Signup')
      ) from ev),
    'previous', (select jsonb_build_object(
        'pageviews', count(*) filter (where event = 'pageview'),
        'sessions',  count(distinct session_id)
      ) from prev),
    'daily', (select coalesce(jsonb_agg(jsonb_build_object(
        'day', d.day, 'pageviews', coalesce(x.pv, 0), 'sessions', coalesce(x.s, 0)
      ) order by d.day), '[]'::jsonb)
      from days d left join per_day x on x.day = d.day),
    'events', (select coalesce(jsonb_agg(jsonb_build_object(
        'event', t.event, 'count', t.c, 'sessions', t.s) order by t.c desc), '[]'::jsonb)
      from (select event, count(*) c, count(distinct session_id) s
            from ev where event <> 'pageview' group by event order by c desc limit 20) t),
    'referrers', (select coalesce(jsonb_agg(jsonb_build_object(
        'referrer', t.referrer, 'sessions', t.s) order by t.s desc), '[]'::jsonb)
      from (select referrer, count(distinct session_id) s
            from ev where referrer is not null and referrer <> ''
            group by referrer order by s desc limit 10) t),
    'devices', (select coalesce(jsonb_agg(jsonb_build_object(
        'device', t.device, 'sessions', t.s) order by t.s desc), '[]'::jsonb)
      from (select coalesce(device, 'unknown') device, count(distinct session_id) s
            from ev group by 1) t),
    'views', (select coalesce(jsonb_agg(jsonb_build_object(
        'view', t.view, 'pageviews', t.c) order by t.c desc), '[]'::jsonb)
      from (select coalesce(view, 'unknown') view, count(*) c
            from ev where event = 'pageview' group by 1) t)
  ) into result;

  return result;
end;
$$;

grant execute on function public.analytics_summary(int) to authenticated;

-- ── Retention ────────────────────────────────────────────────────────────────
-- Deletes rows older than p_keep_days (never fewer than 30). Founding admins
-- only; returns the number of rows removed. Not wired to any UI yet — call it
-- from the SQL Editor: select public.analytics_prune(365);
create or replace function public.analytics_prune(p_keep_days int default 365)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted bigint;
begin
  if not public.is_beta_admin() then
    raise exception 'analytics_prune: Founding Workspace admins only'
      using errcode = '42501';
  end if;
  delete from public.analytics_events
  where created_at < now() - make_interval(days => greatest(30, coalesce(p_keep_days, 365)));
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

grant execute on function public.analytics_prune(int) to authenticated;

-- ============================================================================
-- ROLLBACK (manual — run only if you want the feature gone)
-- ============================================================================
-- drop function if exists public.analytics_prune(int);
-- drop function if exists public.analytics_summary(int);
-- drop table if exists public.analytics_events;
