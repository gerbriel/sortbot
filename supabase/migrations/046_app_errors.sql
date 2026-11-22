-- ============================================================================
-- APP ERRORS — first-party error tracking (no Sentry, no third party)
-- ============================================================================
-- Run AFTER multi_org_tenancy.sql and beta_signups.sql (organizations FK +
-- is_beta_admin()). Purely additive; idempotent; rollback at the bottom.
-- Nothing else in the app reads or writes this table.
--
-- MODEL: the browser writes one row per uncaught error / rejected promise /
-- caught render error straight into OUR OWN Supabase project — anon visitors on
-- the landing page included. Same shape as analytics_events.sql:
--   * INSERT: anon + authenticated. Anon rows can never carry a user/org id;
--     signed-in rows may only carry the caller's own user id.
--   * SELECT: Founding Workspace owners/admins only (is_beta_admin()) — and in
--     practice they read the app_errors_summary() aggregate, not raw rows.
--   * No client UPDATE/DELETE. app_errors_prune() (founding admins) trims it.
--   * A per-session BEFORE INSERT rate limit (20 rows / 10 min) so a render
--     loop cannot flood the table — the client caps itself too, but the client
--     is the thing that is broken when this matters.
--
-- PRIVACY: no full user agent (a coarse browser family only), no IP, no
-- cookies. `path` is location.pathname — never the query string or hash.
-- `message`/`stack` are scrubbed client-side (emails, UUID-ish tokens) before
-- they are sent; see src/lib/errorReporter.ts. session_id is the same random
-- per-tab id analytics uses (sessionStorage — gone when the tab closes).
--
-- GROUPING: `fingerprint` is a client-computed hash of source + normalized
-- message + normalized top stack frame. Rows sharing one fingerprint are one
-- issue. The normalization strips build hashes and line numbers so a
-- fingerprint survives a redeploy.
-- ============================================================================

create table if not exists public.app_errors (
  id               bigint generated always as identity primary key,
  created_at       timestamptz not null default now(),
  source           text not null
                   check (source in ('window','unhandledrejection','boundary','manual')),
  message          text not null check (char_length(message) between 1 and 500),
  stack            text        check (stack is null or char_length(stack) <= 4000),
  component        text        check (component is null or char_length(component) <= 120),
  view             text        check (view is null or char_length(view) <= 30),
  path             text        check (path is null or char_length(path) <= 200),
  fingerprint      text not null check (char_length(fingerprint) between 8 and 64),
  -- Coarse browser family ONLY. A closed vocabulary, so no full user agent can
  -- be smuggled into this column even if the client is changed or forged.
  user_agent_class text        check (user_agent_class is null or user_agent_class in
                     ('chrome','edge','safari','firefox','opera','samsung','webview','other')),
  app_version      text        check (app_version is null or char_length(app_version) <= 60),
  session_id       text not null check (char_length(session_id) between 8 and 64),
  user_id          uuid references auth.users(id) on delete set null,
  org_id           uuid references public.organizations(id) on delete set null
);

create index if not exists app_errors_created_idx
  on public.app_errors (created_at desc);
create index if not exists app_errors_fp_created_idx
  on public.app_errors (fingerprint, created_at desc);
create index if not exists app_errors_session_idx
  on public.app_errors (session_id);

alter table public.app_errors enable row level security;

grant insert on public.app_errors to anon, authenticated;
grant select on public.app_errors to authenticated;
grant usage on sequence public.app_errors_id_seq to anon, authenticated;

-- Anonymous visitors: a row, but never an identity.
drop policy if exists app_errors_insert_anon on public.app_errors;
create policy app_errors_insert_anon on public.app_errors for insert
  to anon
  with check (user_id is null and org_id is null);

-- Signed-in users: only their own user id (org_id is not verified — it is a
-- cosmetic dimension the founders' dashboard groups by, never an access key).
drop policy if exists app_errors_insert_auth on public.app_errors;
create policy app_errors_insert_auth on public.app_errors for insert
  to authenticated
  with check (user_id is null or user_id = auth.uid());

-- Founders-only read. No client UPDATE/DELETE at all.
drop policy if exists app_errors_select on public.app_errors;
create policy app_errors_select on public.app_errors for select
  to authenticated
  using (public.is_beta_admin());


-- ── Rate limit ───────────────────────────────────────────────────────────────
-- 20 rows / 10 minutes per session. The whole point of this table is to catch
-- the crash loop, and a crash loop is exactly what would otherwise write a
-- million rows before anyone noticed. Errcode 54000 (program_limit_exceeded);
-- the client treats it as "not now" and keeps reporting later — only a MISSING
-- TABLE latches reporting off.
create or replace function public.app_errors_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare n int;
begin
  select count(*) into n
  from public.app_errors
  where session_id = new.session_id
    and created_at > now() - interval '10 minutes';
  if n >= 20 then
    raise exception 'app_errors: rate limit for this session' using errcode = '54000';
  end if;
  return new;
end $$;

drop trigger if exists app_errors_rate_limit on public.app_errors;
create trigger app_errors_rate_limit
  before insert on public.app_errors
  for each row execute function public.app_errors_rate_limit();


-- ── Aggregate for the founder dashboard ─────────────────────────────────────
-- One round-trip returns everything the Errors view draws: totals, the top
-- fingerprints (one row per issue), a zero-filled daily series, and counts by
-- view. UTC days. Founding admins only.
create or replace function public.app_errors_summary(p_days int default 7)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_days int := greatest(1, least(coalesce(p_days, 7), 365));
  v_from timestamptz := (date_trunc('day', now() at time zone 'utc')
                         - make_interval(days => v_days - 1)) at time zone 'utc';
  result jsonb;
begin
  if not public.is_beta_admin() then
    raise exception 'app_errors_summary: Founding Workspace admins only'
      using errcode = '42501';
  end if;

  with er as (
    select * from public.app_errors where created_at >= v_from
  ), days as (
    select generate_series(
      (v_from at time zone 'utc')::date,
      ((v_from + make_interval(days => v_days - 1)) at time zone 'utc')::date,
      interval '1 day'
    )::date as day
  ), per_day as (
    select (created_at at time zone 'utc')::date as day,
           count(*) as c,
           count(distinct fingerprint) as f
    from er group by 1
  )
  select jsonb_build_object(
    'days', v_days,
    'from', v_from,
    'totals', (select jsonb_build_object(
        'errors',       count(*),
        'fingerprints', count(distinct fingerprint),
        'sessions',     count(distinct session_id),
        'users',        count(distinct user_id),
        'last_seen',    max(created_at)
      ) from er),
    -- One entry per issue, worst first. `message` is the shortest sample in the
    -- group (min) so the sample is the least id-polluted variant.
    'groups', (select coalesce(jsonb_agg(jsonb_build_object(
        'fingerprint', t.fingerprint,
        'count',       t.c,
        'sessions',    t.s,
        'users',       t.u,
        'message',     t.message,
        'source',      t.source,
        'component',   t.component,
        'view',        t.view,
        'app_version', t.app_version,
        'first_seen',  t.first_seen,
        'last_seen',   t.last_seen
      ) order by t.c desc, t.last_seen desc), '[]'::jsonb)
      from (
        select fingerprint,
               count(*)                    as c,
               count(distinct session_id)  as s,
               count(distinct user_id)     as u,
               min(message)                as message,
               min(source)                 as source,
               min(component)              as component,
               min(view)                   as view,
               max(app_version)            as app_version,
               min(created_at)             as first_seen,
               max(created_at)             as last_seen
        from er group by fingerprint
        order by count(*) desc, max(created_at) desc
        limit 50
      ) t),
    'daily', (select coalesce(jsonb_agg(jsonb_build_object(
        'day', d.day, 'errors', coalesce(x.c, 0), 'fingerprints', coalesce(x.f, 0)
      ) order by d.day), '[]'::jsonb)
      from days d left join per_day x on x.day = d.day),
    'views', (select coalesce(jsonb_agg(jsonb_build_object(
        'view', t.view, 'errors', t.c, 'sessions', t.s) order by t.c desc), '[]'::jsonb)
      from (select coalesce(view, 'unknown') as view, count(*) c, count(distinct session_id) s
            from er group by 1) t)
  ) into result;

  return result;
end;
$$;

grant execute on function public.app_errors_summary(int) to authenticated;


-- ── Retention ────────────────────────────────────────────────────────────────
-- Deletes rows older than p_keep_days (never fewer than 7). Founding admins
-- only; returns the number of rows removed. Not wired to any UI — call it from
-- the SQL Editor: select public.app_errors_prune(90);
create or replace function public.app_errors_prune(p_keep_days int default 90)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted bigint;
begin
  if not public.is_beta_admin() then
    raise exception 'app_errors_prune: Founding Workspace admins only'
      using errcode = '42501';
  end if;
  delete from public.app_errors
  where created_at < now() - make_interval(days => greatest(7, coalesce(p_keep_days, 90)));
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

grant execute on function public.app_errors_prune(int) to authenticated;


-- ============================================================================
-- VERIFY (run separately)
-- ============================================================================
-- -- (a) Table, policies, trigger:
-- select policyname, cmd from pg_policies where tablename = 'app_errors';
-- select tgname from pg_trigger where tgrelid = 'public.app_errors'::regclass
--   and not tgisinternal;
--
-- -- (b) A minimal insert must SUCCEED (run as an ordinary signed-in user):
-- insert into public.app_errors (source, message, fingerprint, session_id)
-- values ('manual', 'verify insert', 'fpverify0001', 'verify-session-0001');
--
-- -- (c) Stamping someone else's user id must FAIL (42501):
-- insert into public.app_errors (source, message, fingerprint, session_id, user_id)
-- values ('manual', 'nope', 'fpverify0002', 'verify-session-0002',
--         '00000000-0000-0000-0000-000000000000');
--
-- -- (d) A full user agent must FAIL the closed vocabulary (23514):
-- insert into public.app_errors (source, message, fingerprint, session_id, user_agent_class)
-- values ('manual', 'nope', 'fpverify0003', 'verify-session-0003',
--         'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)');
--
-- -- (e) The 21st row in 10 minutes for one session must FAIL (54000):
-- do $$ begin for i in 1..21 loop
--   insert into public.app_errors (source, message, fingerprint, session_id)
--   values ('manual', 'flood ' || i, 'fpverifyflood', 'verify-session-flood');
-- end loop; end $$;
--
-- -- (f) The dashboard payload (founding admin only; 42501 otherwise):
-- select jsonb_pretty(public.app_errors_summary(7));
--
-- -- (g) Clean up the verify rows:
-- delete from public.app_errors where session_id like 'verify-session-%';


-- ============================================================================
-- ROLLBACK (manual — run only if you want the feature gone)
-- ============================================================================
-- drop function if exists public.app_errors_prune(int);
-- drop function if exists public.app_errors_summary(int);
-- drop trigger  if exists app_errors_rate_limit on public.app_errors;
-- drop function if exists public.app_errors_rate_limit();
-- drop table    if exists public.app_errors;
