-- ============================================================================
-- FINANCE — first-party books: income, expenses, profit, customers, reports
-- ============================================================================
-- Run AFTER multi_org_tenancy.sql and beta_signups.sql (organizations FK +
-- is_beta_admin()). Purely additive; idempotent; rollback at the bottom.
-- Nothing in the listing workflow reads or writes these tables.
--
-- MODEL: the founder's books live in OUR OWN Supabase project. No payment
-- processor, no accounting vendor, no external API — a ledger table the
-- founder types into, plan prices that value the customer base, and one
-- SECURITY DEFINER aggregate the Finance view draws. Every policy on every
-- table here is is_beta_admin(): this is Founding-Workspace-only data, and
-- unlike the CRM it is not synced from anywhere.
--
-- THREE TABLES
--   finance_transactions  one row per real-world money movement. A row with a
--                         `recurrence` is a TEMPLATE: it stands for itself and
--                         for every repeat until `recurrence_ends_on` (or
--                         forever). Repeats are never stored — they are
--                         expanded at read time (see OCCURRENCES below), so
--                         changing a $20/mo hosting bill to $25 fixes history
--                         and the forecast in one edit.
--   finance_plan_prices   plan → list price per month. Keyed by the value in
--                         organizations.plan, so projected MRR is a join, not
--                         a hardcoded table in the client.
--   finance_settings      key/value knobs that are neither a transaction nor a
--                         price. Seeded with the two founding-discount rules
--                         below. (Chosen over a magic row inside
--                         finance_plan_prices: a discount is not a plan, and a
--                         'founding_discount_pct' row there would be summed
--                         into MRR by any query that forgot to exclude it.)
--
-- OCCURRENCES — the one rule the SQL and the client both implement
--   occurrences(txn, from, to):
--     no recurrence  → [occurred_on], if it falls inside [from, to]
--     monthly/yearly → occurred_on, occurred_on + 1 step, + 2 steps, … up to
--                      least(recurrence_ends_on, to), keeping only those >= from
--   Steps are ANCHORED to occurred_on (occurred_on + n × interval), which is
--   what generate_series does: Jan 31 monthly → Feb 28, Mar 31, Apr 30 — never
--   drifting to the 28th for good. src/lib/financeService.ts:expandOccurrences
--   reproduces this exactly so the on-screen preview, the CSV exports and this
--   RPC can never disagree.
--   Totals, by_category and by_workspace are all computed from the SAME
--   expanded set, so `transaction_count` counts OCCURRENCES in the range, not
--   ledger rows.
--
-- FOUNDING DISCOUNT — documented rule, editable without a migration
--   A workspace is a FOUNDING SHOP when its plan is 'beta' OR it was created
--   on/before finance_settings.founding_cutoff. Founding shops get
--   founding_discount_pct off their plan's list price, for life (the promise on
--   the landing page). The cutoff is what makes it durable: moving a beta
--   workspace onto a paid plan changes `plan` but never `created_at`, so the
--   discount survives the upgrade.
--   The summary returns BOTH numbers — projected_mrr_list_cents (everyone at
--   list) and projected_mrr_cents (founding shops discounted) — because the
--   gap between them is the cost of the founding promise, and the founder
--   should be able to see it.
--
-- SEEDED PRICES (match Landing.tsx tiers, Sept 2026): free 0, beta 0, starter 5000,
-- basic 9000, growth 15000, pro 25000, business 35000, scale 70000, enterprise 120000.
-- Founding shops pay 70% of list (the 30% founding discount) — same as the landing page.
--   organizations.plan only ever holds 'free' or 'beta' today, so projected MRR
--   reads $0 until plans are assigned — that is correct, not a bug.
--   The seeds mirror the eight tiers on src/components/Landing.tsx exactly. If
--   the landing page's pricing changes again, edit prices in Finance →
--   Customers → Plan prices; seeds are `on conflict do nothing`, so re-running
--   this file never overwrites what the founder typed.
-- ============================================================================

-- ── Ledger ──────────────────────────────────────────────────────────────────

create table if not exists public.finance_transactions (
  id                uuid primary key default gen_random_uuid(),
  occurred_on       date not null default current_date,
  kind              text not null check (kind in ('income','expense')),
  category          text not null check (char_length(category) between 1 and 60),
  -- Always positive: `kind` carries the sign. A 1e11-cent ($1B) ceiling keeps a
  -- fat-fingered amount from silently rescaling every chart in the view.
  amount_cents      bigint not null check (amount_cents > 0 and amount_cents <= 100000000000),
  currency          text not null default 'USD' check (char_length(currency) = 3),
  description       text check (description is null or char_length(description) <= 500),
  -- The customer workspace an income relates to. Nullable: most expenses have
  -- none. ON DELETE SET NULL — deleting a workspace must not erase the money
  -- it paid us.
  org_id            uuid references public.organizations(id) on delete set null,
  recurrence        text check (recurrence is null or recurrence in ('monthly','yearly')),
  recurrence_ends_on date,
  created_by        uuid references auth.users(id) on delete set null default auth.uid(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint finance_tx_end_after_start
    check (recurrence_ends_on is null or recurrence_ends_on >= occurred_on),
  constraint finance_tx_end_needs_recurrence
    check (recurrence_ends_on is null or recurrence is not null)
);

create index if not exists finance_tx_occurred_idx
  on public.finance_transactions (occurred_on desc);
create index if not exists finance_tx_kind_category_idx
  on public.finance_transactions (kind, category);
create index if not exists finance_tx_org_idx
  on public.finance_transactions (org_id) where org_id is not null;
-- Recurring rows are read on EVERY range query regardless of occurred_on.
create index if not exists finance_tx_recurring_idx
  on public.finance_transactions (recurrence) where recurrence is not null;

-- ── Plan prices ─────────────────────────────────────────────────────────────

create table if not exists public.finance_plan_prices (
  plan          text primary key check (char_length(plan) between 1 and 40),
  monthly_cents bigint not null default 0 check (monthly_cents >= 0 and monthly_cents <= 100000000),
  note          text check (note is null or char_length(note) <= 200),
  updated_at    timestamptz not null default now()
);

insert into public.finance_plan_prices (plan, monthly_cents, note) values
  ('free',       0,      'No workspace is billed on free (5 listings).'),
  ('beta',       0,      'Private beta — free, and founding-priced for life afterwards.'),
  ('starter',    5000,   'Launch pricing — 25 listings/mo.'),
  ('basic',      9000,   'Launch pricing — 60 listings/mo.'),
  ('growth',     15000,  'Launch pricing — 135 listings/mo.'),
  ('pro',        25000,  'Launch pricing — 300 listings/mo, the featured tier.'),
  ('business',   35000,  'Launch pricing — 550 listings/mo.'),
  ('scale',      70000,  'Launch pricing — 2,000 listings/mo.'),
  ('enterprise', 120000, 'Launch pricing — 6,000 listings/mo.')
on conflict (plan) do nothing;

-- ── Settings ────────────────────────────────────────────────────────────────

create table if not exists public.finance_settings (
  key        text primary key check (char_length(key) between 1 and 40),
  value      text not null check (char_length(value) <= 200),
  note       text check (note is null or char_length(note) <= 300),
  updated_at timestamptz not null default now()
);

insert into public.finance_settings (key, value, note) values
  ('founding_discount_pct', '30',
   'Percent off list, for life, for founding shops. Landing page promise.'),
  ('founding_cutoff', '2026-12-31',
   'A workspace created on or before this date is a founding shop, whatever plan it later moves to.')
on conflict (key) do nothing;

-- ── updated_at bookkeeping ──────────────────────────────────────────────────

create or replace function public.finance_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists finance_tx_touch on public.finance_transactions;
create trigger finance_tx_touch
  before update on public.finance_transactions
  for each row execute function public.finance_touch_updated_at();

drop trigger if exists finance_plan_prices_touch on public.finance_plan_prices;
create trigger finance_plan_prices_touch
  before update on public.finance_plan_prices
  for each row execute function public.finance_touch_updated_at();

drop trigger if exists finance_settings_touch on public.finance_settings;
create trigger finance_settings_touch
  before update on public.finance_settings
  for each row execute function public.finance_touch_updated_at();

-- ── RLS: founders only, everywhere ──────────────────────────────────────────

alter table public.finance_transactions enable row level security;
alter table public.finance_plan_prices  enable row level security;
alter table public.finance_settings     enable row level security;

-- Column-level UPDATE grants: authorship and creation time are not editable —
-- they are the audit trail of who typed a number into the books.
grant select, insert, delete on public.finance_transactions to authenticated;
grant update (occurred_on, kind, category, amount_cents, currency, description,
              org_id, recurrence, recurrence_ends_on)
  on public.finance_transactions to authenticated;

grant select, insert, delete on public.finance_plan_prices to authenticated;
grant update (monthly_cents, note) on public.finance_plan_prices to authenticated;

grant select, insert, delete on public.finance_settings to authenticated;
grant update (value, note) on public.finance_settings to authenticated;

drop policy if exists finance_tx_select on public.finance_transactions;
create policy finance_tx_select on public.finance_transactions for select
  to authenticated using (public.is_beta_admin());
-- Authorship cannot be self-asserted: the row is stamped with the caller.
drop policy if exists finance_tx_insert on public.finance_transactions;
create policy finance_tx_insert on public.finance_transactions for insert
  to authenticated with check (
    public.is_beta_admin() and (created_by is null or created_by = auth.uid())
  );
drop policy if exists finance_tx_update on public.finance_transactions;
create policy finance_tx_update on public.finance_transactions for update
  to authenticated using (public.is_beta_admin()) with check (public.is_beta_admin());
drop policy if exists finance_tx_delete on public.finance_transactions;
create policy finance_tx_delete on public.finance_transactions for delete
  to authenticated using (public.is_beta_admin());

drop policy if exists finance_plan_prices_select on public.finance_plan_prices;
create policy finance_plan_prices_select on public.finance_plan_prices for select
  to authenticated using (public.is_beta_admin());
drop policy if exists finance_plan_prices_insert on public.finance_plan_prices;
create policy finance_plan_prices_insert on public.finance_plan_prices for insert
  to authenticated with check (public.is_beta_admin());
drop policy if exists finance_plan_prices_update on public.finance_plan_prices;
create policy finance_plan_prices_update on public.finance_plan_prices for update
  to authenticated using (public.is_beta_admin()) with check (public.is_beta_admin());
drop policy if exists finance_plan_prices_delete on public.finance_plan_prices;
create policy finance_plan_prices_delete on public.finance_plan_prices for delete
  to authenticated using (public.is_beta_admin());

drop policy if exists finance_settings_select on public.finance_settings;
create policy finance_settings_select on public.finance_settings for select
  to authenticated using (public.is_beta_admin());
drop policy if exists finance_settings_insert on public.finance_settings;
create policy finance_settings_insert on public.finance_settings for insert
  to authenticated with check (public.is_beta_admin());
drop policy if exists finance_settings_update on public.finance_settings;
create policy finance_settings_update on public.finance_settings for update
  to authenticated using (public.is_beta_admin()) with check (public.is_beta_admin());
drop policy if exists finance_settings_delete on public.finance_settings;
create policy finance_settings_delete on public.finance_settings for delete
  to authenticated using (public.is_beta_admin());

-- ── The aggregate the Finance view draws ────────────────────────────────────
-- One round-trip returns: totals + the previous equal-length range (deltas), a
-- zero-filled monthly income/expense/profit series, category and workspace
-- breakdowns, and the customer/plan/MRR stats. Founding admins only.
--
-- Recurring rows are expanded ONCE over [previous_from, p_to] and then split by
-- date, so the current and previous ranges can never be computed two different
-- ways. Everything downstream reads `cur` / `prv`.
--
-- analytics_events is OPTIONAL: guarded with to_regclass and read through
-- dynamic SQL, so this function installs and runs on a project that never ran
-- analytics_events.sql (active_workspaces is null there, not zero).
create or replace function public.finance_summary(p_from date, p_to date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_from      date := coalesce(p_from, (date_trunc('year', now())::date));
  v_to        date := coalesce(p_to, current_date);
  v_span      int;
  v_prev_from date;
  v_disc      numeric := 0;
  v_cutoff    date;
  v_active_map jsonb := '{}'::jsonb;
  v_active    int;
  result      jsonb;
begin
  if not public.is_beta_admin() then
    raise exception 'finance_summary: Founding Workspace admins only'
      using errcode = '42501';
  end if;

  if v_to < v_from then
    raise exception 'finance_summary: p_to (%) is before p_from (%)', v_to, v_from
      using errcode = '22007';
  end if;

  v_span      := (v_to - v_from) + 1;             -- inclusive day count
  v_prev_from := v_from - v_span;                 -- equal-length preceding range

  -- Settings, defensively parsed: a founder typing "thirty" into the value
  -- column must degrade to "no discount", never break the books.
  select coalesce(max(case when key = 'founding_discount_pct' and value ~ '^[0-9]+(\.[0-9]+)?$'
                           then least(value::numeric, 100) end), 0),
         max(case when key = 'founding_cutoff' and value ~ '^\d{4}-\d{2}-\d{2}$'
                  then value::date end)
    into v_disc, v_cutoff
  from public.finance_settings;

  -- Optional: activity per workspace from first-party analytics.
  if to_regclass('public.analytics_events') is not null then
    execute format($q$
      select coalesce(jsonb_object_agg(org_id::text, jsonb_build_object(
               'events', c, 'last_active', la)), '{}'::jsonb)
      from (
        select org_id, count(*) c, max(created_at) la
        from public.analytics_events
        where org_id is not null
          and created_at >= %L::date
          and created_at <  (%L::date + 1)
        group by org_id
      ) s $q$, v_from, v_to)
    into v_active_map;
    v_active := (select count(*) from jsonb_object_keys(v_active_map));
  end if;

  with occ as (
    -- THE recurrence rule. A non-recurring row has stop = start, so the series
    -- yields exactly one date; a recurring row steps from occurred_on until the
    -- earlier of its end date and p_to.
    select t.kind, t.category, t.org_id, t.amount_cents, d::date as occ_on
    from public.finance_transactions t
    cross join lateral generate_series(
      t.occurred_on::timestamp,
      (case when t.recurrence is null then t.occurred_on
            else least(coalesce(t.recurrence_ends_on, v_to), v_to) end)::timestamp,
      case t.recurrence when 'yearly' then interval '1 year' else interval '1 month' end
    ) as d
    where t.occurred_on <= v_to
      and d::date between v_prev_from and v_to
  ), cur as (
    select * from occ where occ_on >= v_from
  ), prv as (
    select * from occ where occ_on < v_from
  ), months as (
    select generate_series(date_trunc('month', v_from::timestamp),
                           date_trunc('month', v_to::timestamp),
                           interval '1 month')::date as m
  ), per_month as (
    select date_trunc('month', occ_on)::date as m,
           sum(amount_cents) filter (where kind = 'income')  as inc,
           sum(amount_cents) filter (where kind = 'expense') as exp
    from cur group by 1
  ), cur_totals as (
    select coalesce(sum(amount_cents) filter (where kind = 'income'), 0)  as inc,
           coalesce(sum(amount_cents) filter (where kind = 'expense'), 0) as exp,
           count(*) as n
    from cur
  ), prv_totals as (
    select coalesce(sum(amount_cents) filter (where kind = 'income'), 0)  as inc,
           coalesce(sum(amount_cents) filter (where kind = 'expense'), 0) as exp,
           count(*) as n
    from prv
  ), org_income as (
    select org_id, sum(amount_cents) as inc
    from cur where kind = 'income' and org_id is not null group by org_id
  ), org_members_agg as (
    select org_id, count(*) as members from public.org_members group by org_id
  ), orgs as (
    select o.id, o.name, o.plan, o.created_at,
           coalesce(m.members, 0)        as members,
           coalesce(i.inc, 0)            as income_cents,
           coalesce(p.monthly_cents, 0)  as monthly_cents,
           (o.plan = 'beta' or (v_cutoff is not null and o.created_at::date <= v_cutoff)) as founding
    from public.organizations o
    left join org_members_agg m on m.org_id = o.id
    left join org_income i      on i.org_id = o.id
    left join public.finance_plan_prices p on p.plan = o.plan
  )
  select jsonb_build_object(
    'from', v_from,
    'to',   v_to,
    'days', v_span,
    'currency', 'USD',
    'totals', (select jsonb_build_object(
        'income_cents',      inc,
        'expense_cents',     exp,
        'profit_cents',      inc - exp,
        'margin_pct',        case when inc > 0 then round(((inc - exp)::numeric / inc) * 100, 1) else 0 end,
        'transaction_count', n
      ) from cur_totals),
    'previous', (select jsonb_build_object(
        'from',           v_prev_from,
        'to',             v_from - 1,
        'income_cents',   inc,
        'expense_cents',  exp,
        'profit_cents',   inc - exp,
        'transaction_count', n
      ) from prv_totals),
    'monthly', (select coalesce(jsonb_agg(jsonb_build_object(
        'month',         to_char(mo.m, 'YYYY-MM'),
        'income_cents',  coalesce(x.inc, 0),
        'expense_cents', coalesce(x.exp, 0),
        'profit_cents',  coalesce(x.inc, 0) - coalesce(x.exp, 0)
      ) order by mo.m), '[]'::jsonb)
      from months mo left join per_month x on x.m = mo.m),
    'by_category', (select coalesce(jsonb_agg(jsonb_build_object(
        'kind', t.kind, 'category', t.category, 'total_cents', t.total, 'count', t.n
      ) order by t.total desc), '[]'::jsonb)
      from (select kind, category, sum(amount_cents) total, count(*) n
            from cur group by kind, category) t),
    'by_workspace', (select coalesce(jsonb_agg(jsonb_build_object(
        'org_id',             o.id,
        'name',               o.name,
        'plan',               o.plan,
        'members',            o.members,
        'income_cents',       o.income_cents,
        'monthly_value_cents', case when o.founding
                                    then round(o.monthly_cents * (1 - v_disc / 100))::bigint
                                    else o.monthly_cents end,
        'founding',           o.founding,
        'created_at',         o.created_at,
        'last_active',        v_active_map -> (o.id::text) ->> 'last_active'
      ) order by o.income_cents desc, o.name asc), '[]'::jsonb) from orgs o),
    'customers', jsonb_build_object(
      'total_workspaces', (select count(*) from orgs),
      'total_members',    (select count(*) from public.org_members),
      'new_workspaces',   (select count(*) from public.organizations
                           where created_at >= v_from and created_at < (v_to + 1)),
      'new_members',      (select count(*) from public.org_members
                           where created_at >= v_from and created_at < (v_to + 1)),
      'active_workspaces', to_jsonb(v_active),
      'founding_workspaces', (select count(*) from orgs where founding),
      'founding_discount_pct', v_disc,
      'projected_mrr_list_cents', (select coalesce(sum(monthly_cents), 0) from orgs),
      'projected_mrr_cents', (select coalesce(sum(
          case when founding then round(monthly_cents * (1 - v_disc / 100)) else monthly_cents end
        ), 0)::bigint from orgs),
      'by_plan', (select coalesce(jsonb_agg(jsonb_build_object(
          'plan', t.plan, 'workspaces', t.n, 'members', t.members, 'monthly_cents', t.monthly_cents
        ) order by t.monthly_cents desc, t.plan), '[]'::jsonb)
        from (select plan, count(*) n, sum(members) members, max(monthly_cents) monthly_cents
              from orgs group by plan) t)
    )
  ) into result;

  return result;
end;
$$;

grant execute on function public.finance_summary(date, date) to authenticated;

-- ============================================================================
-- ROLLBACK (manual — run only if you want the feature gone)
-- ============================================================================
-- drop function if exists public.finance_summary(date, date);
-- drop trigger if exists finance_settings_touch on public.finance_settings;
-- drop trigger if exists finance_plan_prices_touch on public.finance_plan_prices;
-- drop trigger if exists finance_tx_touch on public.finance_transactions;
-- drop function if exists public.finance_touch_updated_at();
-- drop table if exists public.finance_settings;
-- drop table if exists public.finance_plan_prices;
-- drop table if exists public.finance_transactions;
