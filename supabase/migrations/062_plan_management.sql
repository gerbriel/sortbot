-- ============================================================================
-- PLAN MANAGEMENT — plans become DATA, and plan changes become HISTORY
-- ============================================================================
-- Run in the Supabase SQL Editor (as `postgres`) AFTER:
--     multi_org_tenancy.sql   (organizations / org_members / org_invites)
--     beta_signups.sql        (is_beta_admin())
--     founding_user_admin.sql (assert_founding_admin(), founding_admin_audit)
--     founder_console.sql     (app_private.org_plan_list() — §4 REPLACES it)
--   optional, in ANY order relative to this file:
--     finance.sql             (finance_plan_prices — §3 re-creates it byte for
--                              byte so this file stands alone; see §3)
--     security_function_hardening.sql + security_rpc_wrappers.sql
--     perf_rls_initplan.sql   (§3.5 writes its policy form already)
--
-- Purely additive. ONE new table, THREE new columns on an existing one, two
-- new triggers, eight new functions. No existing function BODY is changed
-- except app_private.org_plan_list(), which is replaced on purpose (§4).
-- Idempotent — every statement is `if not exists` / `create or replace` /
-- `on conflict do nothing`, so it is safe to run any number of times.
-- Rollback at the bottom.
--
-- ── THE TWO PROBLEMS ────────────────────────────────────────────────────────
--
-- 1. PLANS ARE A HARDCODED LIST IN TWO HAND-SYNCED PLACES.
--    app_private.org_plan_list() (founder_console.sql §3) and ORG_PLANS in
--    src/lib/foundingAdminService.ts. Meanwhile Finance → Customers already
--    has an "add plan" control that writes freely to finance_plan_prices — so
--    a tier added through the UI gets a price and then CANNOT BE ASSIGNED TO
--    ANYBODY, because founding_set_org_plan rejects it as an unknown plan.
--    It fails silently, in the sense that nothing says why.
--
--    The fix is not a bigger literal. finance_plan_prices is ALREADY the plan
--    catalog in intent — finance.sql's own header says it is "keyed by the
--    value in organizations.plan, so projected MRR is a JOIN, not a constant
--    in the client". This file makes that true: the table gains display_name /
--    is_active / sort_order, and org_plan_list() is REPLACED IN PLACE to read
--    it. Same name, same return type, so founding_set_org_plan and
--    founding_create_workspace inherit data-driven plans with ZERO edits to
--    founder_console.sql. That is the whole trick.
--
-- 2. "WHO WAS A BETA USER" IS NOT RECORDED ANYWHERE DURABLE.
--    organizations.plan is one mutable column: the moment a beta shop moves to
--    `pro` the fact that it was ever a beta shop is gone. beta_signups has no
--    org_id (email + free-text org_name only). founding_admin_audit catches
--    only what was done through the Founder console. And finance.sql's
--    `created_at <= founding_cutoff` is a lossy proxy for it — good enough to
--    price with, useless as a record.
--
--    org_plan_history (§5) is written by a TRIGGER ON organizations, not by
--    the RPC. A trigger catches a plan changed from the SQL Editor, from a
--    future admin tool, or by a hand-written UPDATE during an incident —
--    which is the one thing an audit table written by five RPCs can never
--    promise. It is the difference between "we log our own writes" and
--    "the column cannot change without a record".
--
-- ── FUNCTION PLACEMENT (AGENTS.md §18 #43–#46) ──────────────────────────────
-- Every function here is born in the SHAPE the hardening files would have put
-- it in, so neither of them ever has to move it:
--     app_private.<fn>   SECURITY DEFINER body, gated on assert_founding_admin()
--     public.<fn>        SECURITY INVOKER wrapper, IDENTICAL signature
-- "Identical" is literal: PostgREST resolves an RPC by ARGUMENT NAME and
-- renders the response from the RETURN TYPE, so each wrapper repeats the
-- argument names src/lib/foundingAdminService.ts sends (p_plan / p_from /
-- p_to / p_org / p_display_name / p_monthly_cents / p_note / p_is_active /
-- p_sort_order), the DEFAULT on founding_plan_alumni, the return type and the
-- volatility. Change one half and you must change the other.
--
-- The two internal functions — app_private.org_plan_list() and the trigger
-- function public.org_plan_history_write() — get treatment B instead: EXECUTE
-- revoked from PUBLIC, anon, authenticated AND service_role, exactly as
-- security_function_hardening.sql §7 does for every other trigger function.
-- §18 #44: a trigger fires WITHOUT the invoking role holding EXECUTE.
--
-- ⚠️ `create schema if not exists app_private` below is a no-op when
--    security_function_hardening.sql has already run. It also means THAT
--    file's rollback (`drop schema app_private restrict`) will refuse while
--    these bodies live there — roll THIS file back first.
--
-- ⚠️ founder_console.sql's OWN rollback drops app_private.org_plan_list().
--    If you ever roll that file back after running this one, re-run §4 here
--    (or this whole file) or every plan becomes unassignable.
--
-- ── WHAT THIS FILE DELIBERATELY DOES NOT DO ─────────────────────────────────
-- 1. It does not touch finance.sql or finance_summary(). That function's
--    founding-shop test stays `plan = 'beta' or created_at <= founding_cutoff`.
--    Reading org_plan_history instead would be strictly more correct — a shop
--    that was on beta and upgraded after the cutoff is a founding shop by
--    promise and by fact, and only history knows it — but AGENTS.md §18 #28
--    says that rule is implemented TWICE (here and in financeService.ts) and
--    asserted against one worked example on both sides. Widening it is its own
--    pass, with its own TypeScript half. Noted as a follow-up, not smuggled in.
-- 2. It does not rewrite history on a rename. See §8.3.
-- 3. It does not add a plan column anywhere. organizations.plan stays the one
--    mutable "where are they now", and history is the append-only "where have
--    they been".
-- ============================================================================


-- ── 1. The private schema (no-op if a security/console file already ran) ────

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
-- Fail loudly and early rather than creating eight functions that raise at
-- call time. Everything here comes from the four files named in the header.

do $$
begin
  if to_regclass('public.organizations') is null then
    raise exception 'plan_management.sql: run multi_org_tenancy.sql first.';
  end if;
  if to_regprocedure('public.is_beta_admin()') is null then
    raise exception 'plan_management.sql: is_beta_admin() is missing — run beta_signups.sql first.';
  end if;
  if to_regclass('public.founding_admin_audit') is null then
    raise exception 'plan_management.sql: run founding_user_admin.sql first.';
  end if;
  if to_regprocedure('public.assert_founding_admin()') is null then
    raise exception 'plan_management.sql: assert_founding_admin() is missing — run founding_user_admin.sql first.';
  end if;
  -- Not strictly needed to CREATE anything below — §4 would happily mint
  -- org_plan_list() from nothing — but without founder_console.sql there is no
  -- founding_set_org_plan() for it to feed, so the file would install a trick
  -- with nothing to play it on. Say so instead.
  if to_regprocedure('app_private.org_plan_list()') is null then
    raise exception 'plan_management.sql: app_private.org_plan_list() is missing — run founder_console.sql first (this file REPLACES that function).';
  end if;
end $$;


-- ── 3. finance_plan_prices becomes THE PLAN CATALOG ─────────────────────────
--
-- 3.1  The table, re-created here BYTE FOR BYTE from finance.sql (the `create
--      table if not exists public.finance_plan_prices (...)` block and its
--      nine-row seed), so this file works whether or not finance.sql has run.
--      Precedent: my_email() in marketplaces.sql, re-created verbatim for the
--      same reason. `if not exists` + `on conflict do nothing` mean that when
--      finance.sql HAS run, both statements are no-ops and no price a founder
--      edited is ever overwritten — in either direction, whichever file runs
--      second.
--
--      DO NOT let this copy drift from finance.sql's. If that file's DDL
--      changes, change it here too, or the two will disagree depending on
--      which one a given database ran first.

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


-- 3.2  The three columns that turn a price list into a catalog.
--      The CHECK rides on the ADD COLUMN, so a re-run skips both together.

alter table public.finance_plan_prices
  -- The label the dropdown shows. NULL is fine and common — the client falls
  -- back to the key, which is what every existing row reads as today.
  add column if not exists display_name text
    constraint finance_plan_prices_display_name_len
    check (display_name is null or char_length(display_name) <= 60);

alter table public.finance_plan_prices
  -- A RETIRED tier stays PRICED. That is the whole point of not deleting it:
  -- historical MRR still joins, finance_summary still values the workspaces
  -- that are on it, and the books do not silently reprice the past. It just
  -- drops out of org_plan_list(), so nobody new can be put on it.
  add column if not exists is_active boolean not null default true;

alter table public.finance_plan_prices
  -- Dropdown order. Tiebreak is `plan asc` everywhere it is read, so two rows
  -- sharing a sort_order still have a stable, reproducible order.
  add column if not exists sort_order int not null default 100;


-- 3.3  Seed the two new columns for the nine known keys — ONLY where the row
--      still carries the untouched value, so a founder's edit survives a
--      re-run. `sort_order = 100` IS that marker (it is the column default);
--      a founder who deliberately sets a plan to exactly 100 and re-runs this
--      file will see it moved back onto the ladder. That is the one case, it
--      is cosmetic, and it is cheaper than a second "has been edited" column.

update public.finance_plan_prices p
   set display_name = coalesce(p.display_name, v.display_name),
       sort_order   = case when p.sort_order = 100 then v.sort_order else p.sort_order end
  from (values
          ('free',       'Free',       10),
          ('beta',       'Beta',       20),
          ('starter',    'Starter',    30),
          ('basic',      'Basic',      40),
          ('growth',     'Growth',     50),
          ('pro',        'Pro',        60),
          ('business',   'Business',   70),
          ('scale',      'Scale',      80),
          ('enterprise', 'Enterprise', 90)
       ) as v(plan, display_name, sort_order)
 where p.plan = v.plan
   and (p.display_name is null or p.sort_order = 100);


-- 3.4  updated_at bookkeeping.
--      finance.sql owns public.finance_touch_updated_at(). We create it ONLY
--      when it is absent, and never `create or replace` it — that statement
--      resets a function's config settings, and security_function_hardening.sql
--      §9 PINS a search_path on this exact function to clear linter 0011.
--      Replacing it here would silently undo that fix. So: if finance.sql has
--      run, this is a no-op; if it has not, we mint the function already
--      carrying the search_path it would otherwise have to be given later.
--      The trigger name matches finance.sql's, so whichever file runs second
--      simply re-creates the same trigger.

do $$
begin
  if to_regprocedure('public.finance_touch_updated_at()') is null then
    execute $f$
      create function public.finance_touch_updated_at()
      returns trigger language plpgsql
      set search_path = public
      as $body$
      begin
        new.updated_at := now();
        return new;
      end;
      $body$
    $f$;
  end if;
end $$;

drop trigger if exists finance_plan_prices_touch on public.finance_plan_prices;
create trigger finance_plan_prices_touch
  before update on public.finance_plan_prices
  for each row execute function public.finance_touch_updated_at();


-- 3.5  RLS, grants and policies.
--
--      GRANTS: the UPDATE grant is EXTENDED to the three new columns, so the
--      Finance price editor can keep writing monthly_cents/note and the new
--      Plans tab can toggle is_active and reorder. `plan` STAYS OUT of it, and
--      that is load-bearing: renaming a plan has to cascade to
--      organizations.plan in the same transaction, which is a privileged
--      cross-table write and therefore the RPC's job (§8.3), not a client
--      table write. A client that could UPDATE finance_plan_prices.plan could
--      orphan every workspace on that tier in one statement.
--
--      GRANT is additive, so finance.sql's narrower
--      `grant update (monthly_cents, note)` running AFTER this file takes
--      nothing away.
--
--      POLICIES: written in perf_rls_initplan.sql's form — `(select
--      public.is_beta_admin())`, evaluated once per statement rather than once
--      per row (AGENTS.md §18 #47) — and with the same names, so re-running
--      that file afterwards is a NO-OP for these four rather than a
--      correction. finance.sql's own copies use the bare form; if finance.sql
--      is run after this file, re-run perf_rls_initplan.sql.

alter table public.finance_plan_prices enable row level security;

grant select, insert, delete on public.finance_plan_prices to authenticated;
grant update (monthly_cents, note, display_name, is_active, sort_order)
  on public.finance_plan_prices to authenticated;

drop policy if exists finance_plan_prices_select on public.finance_plan_prices;
create policy finance_plan_prices_select on public.finance_plan_prices for select
  to authenticated using ((select public.is_beta_admin()));
drop policy if exists finance_plan_prices_insert on public.finance_plan_prices;
create policy finance_plan_prices_insert on public.finance_plan_prices for insert
  to authenticated with check ((select public.is_beta_admin()));
drop policy if exists finance_plan_prices_update on public.finance_plan_prices;
create policy finance_plan_prices_update on public.finance_plan_prices for update
  to authenticated using ((select public.is_beta_admin())) with check ((select public.is_beta_admin()));
drop policy if exists finance_plan_prices_delete on public.finance_plan_prices;
create policy finance_plan_prices_delete on public.finance_plan_prices for delete
  to authenticated using ((select public.is_beta_admin()));


-- ── 4. app_private.org_plan_list() — REPLACED IN PLACE ──────────────────────
-- Same name, same `returns text[]`. `stable` instead of `immutable`, because
-- it now reads a table. That is the ONLY signature-adjacent change, and
-- `create or replace` permits it.
--
-- Nothing in founder_console.sql is edited: founding_set_org_plan and
-- founding_create_workspace call this function by name, so they become
-- data-driven the moment this statement lands. A plan created through
-- founding_upsert_plan is assignable on the very next call — which is the bug
-- in the header, fixed.
--
-- TWO FALLBACKS TO THE NINE LITERALS, and both matter:
--   * the table is absent (finance.sql never ran AND §3.1 was rolled back);
--   * the query returns zero rows — every plan retired, or the seed deleted.
-- A zero-row catalog must never make every plan unassignable, because the
-- only ways back out of that state (the console, the SQL Editor's use of
-- founding_upsert_plan) would themselves be broken. Read through to_regclass
-- + dynamic SQL, the finance_summary / founding_org_detail pattern, so a
-- missing table yields the fallback rather than an error.
--
-- Treatment B (internal guard): called only from SECURITY DEFINER bodies that
-- run as this file's owner, so no client role needs EXECUTE. `create or
-- replace` RESETS a function's ACL to the default (EXECUTE to PUBLIC), which
-- is exactly why the revoke block below is repeated here rather than assumed
-- from founder_console.sql.

create or replace function app_private.org_plan_list()
returns text[]
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v text[];
begin
  if to_regclass('public.finance_plan_prices') is not null then
    execute $q$
      select array_agg(plan order by sort_order, plan)
      from public.finance_plan_prices
      where is_active
    $q$ into v;
  end if;

  if v is null or cardinality(v) = 0 then
    return array[
      'free', 'beta', 'starter', 'basic', 'growth',
      'pro', 'business', 'scale', 'enterprise'
    ]::text[];
  end if;

  return v;
end $$;

do $$
declare r text;
begin
  execute 'revoke all on function app_private.org_plan_list() from public';
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on function app_private.org_plan_list() from %I', r);
    end if;
  end loop;
end $$;


-- ── 5. org_plan_history ─────────────────────────────────────────────────────
-- The append-only record of every value organizations.plan has ever held.
--
-- ⚠️ org_id IS DELIBERATELY NOT A FOREIGN KEY, and org_name is denormalised.
--    Direct precedent: listing_publications.product_group_id in
--    marketplaces.sql — "a cascade would destroy the only record it was ever
--    posted". The same argument, one level up: deleting a workspace must not
--    erase the record that it WAS A BETA SHOP, and renaming one must not
--    rewrite what it was called at the time. A founder asking "who were our
--    beta users" ten years from now is asking about shops that have long since
--    churned; a foreign key with ON DELETE CASCADE would have deleted exactly
--    the rows they are looking for, and ON DELETE RESTRICT would have made
--    deleting a workspace impossible. Neither is the answer. No FK is.
--
--    The cost is an org_id that can point at nothing. founding_plan_alumni()
--    (§8.6) surfaces that as `exists_now = false` rather than hiding it, which
--    is the feature, not the caveat.
--
-- changed_by is likewise FK-free: founding_admin_audit.actor_id references
-- auth.users(id) with no ON DELETE clause, which means deleting an account
-- would be BLOCKED by its own audit trail. A record of who made a change must
-- not be able to veto a deletion.

create table if not exists public.org_plan_history (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null,     -- NO FOREIGN KEY, deliberately (above)
  org_name         text,              -- denormalised at write time (above)
  plan             text not null,
  previous_plan    text,              -- null on the first row for an org
  changed_at       timestamptz not null default now(),
  changed_by       uuid,              -- auth.uid(); NULL for a SQL-Editor edit
  changed_by_email text,
  source           text not null default 'trigger'
                     check (source in ('trigger', 'backfill', 'rename'))
);

-- The two reads this table has: one workspace's timeline, and "everyone who
-- was ever on plan X".
create index if not exists org_plan_history_org_idx
  on public.org_plan_history (org_id, changed_at desc);
create index if not exists org_plan_history_plan_idx
  on public.org_plan_history (plan);

-- RLS: read-only to founding admins, and NOT WRITABLE BY ANY CLIENT AT ALL —
-- no INSERT/UPDATE/DELETE grant and no policy for them. The trigger below is
-- SECURITY DEFINER and runs as this table's owner, which bypasses RLS. Same
-- shape as founding_admin_audit: a history somebody can edit is not a history.
alter table public.org_plan_history enable row level security;

revoke all on public.org_plan_history from anon;
revoke all on public.org_plan_history from authenticated;
grant select on public.org_plan_history to authenticated;

drop policy if exists org_plan_history_select on public.org_plan_history;
create policy org_plan_history_select on public.org_plan_history for select
  to authenticated using ((select public.is_beta_admin()));


-- ── 6. The trigger that writes it ───────────────────────────────────────────
-- Why a trigger and not the RPC: founding_set_org_plan is ONE of the ways
-- organizations.plan changes. The others are the SQL Editor, a future admin
-- surface, and a hand-written UPDATE during an incident — and those are
-- exactly the changes you most want a record of. A trigger cannot be gone
-- around. founding_admin_audit keeps recording the console's own writes
-- alongside; they answer different questions ("what did a founder DO" vs
-- "what has this workspace's plan BEEN").
--
-- changed_by is NULL when there is no JWT. That is not a gap, it is the
-- signal: a null actor means "changed outside the app", which the UI renders
-- as "from the SQL Editor" rather than pretending somebody is responsible.
--
-- source = 'rename' is set by founding_rename_plan (§8.3) through a
-- transaction-local GUC, so a relabelling reads as a relabelling instead of
-- as 200 workspaces all changing plan on the same day. The trigger accepts
-- that one literal value and nothing else, so the worst a caller can do by
-- setting the GUC themselves is mislabel a change they were already allowed
-- to make. Suppressing the row entirely was the alternative and was rejected:
-- a trigger with an off switch is not a guarantee.

create or replace function public.org_plan_history_write()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_prev   text;
  v_source text;
begin
  if tg_op = 'UPDATE' then
    v_prev := old.plan;
  end if;

  v_source := case
    when coalesce(current_setting('app.plan_history_source', true), '') = 'rename'
      then 'rename'
    else 'trigger'
  end;

  insert into public.org_plan_history
    (org_id, org_name, plan, previous_plan, changed_by, changed_by_email, source)
  values
    (new.id, new.name, new.plan, v_prev,
     auth.uid(), nullif(auth.jwt() ->> 'email', ''), v_source);

  return null;   -- AFTER trigger: the return value is ignored
end $$;

-- TWO triggers, one function. A trigger's WHEN clause may only reference OLD
-- and NEW — `tg_op` is not available there — so "fire on INSERT, and on an
-- UPDATE only when the value actually moved" cannot be one statement.
-- `of plan` already narrows the UPDATE trigger to statements whose SET list
-- mentions the column; the WHEN clause narrows it further to the ones that
-- change it. Setting plan to the value it already holds records nothing.
drop trigger if exists organizations_plan_history_ins on public.organizations;
create trigger organizations_plan_history_ins
  after insert on public.organizations
  for each row
  execute function public.org_plan_history_write();

drop trigger if exists organizations_plan_history_upd on public.organizations;
create trigger organizations_plan_history_upd
  after update of plan on public.organizations
  for each row
  when (old.plan is distinct from new.plan)
  execute function public.org_plan_history_write();


-- ── 7. Backfill ─────────────────────────────────────────────────────────────
-- One row per existing workspace, stamped at the workspace's own created_at
-- rather than now(), because that is when it went onto the plan it is on as
-- far as anything in this database knows. previous_plan is null (there is no
-- "before"), changed_by is null (nobody alive did it), and source = 'backfill'
-- says out loud that this row is inferred, not observed — so a future reader
-- never mistakes it for evidence that the plan has not changed since.
--
-- Idempotent by construction: a workspace that already has ANY history row is
-- skipped, so a re-run after months of real trigger writes adds nothing.

insert into public.org_plan_history
  (org_id, org_name, plan, previous_plan, changed_at, changed_by, changed_by_email, source)
select o.id, o.name, o.plan, null, o.created_at, null, null, 'backfill'
from public.organizations o
where not exists (
  select 1 from public.org_plan_history h where h.org_id = o.id
);


-- ── 8. The RPCs ─────────────────────────────────────────────────────────────
-- All SECURITY DEFINER, all gated on assert_founding_admin() (42501), all
-- audited into founding_admin_audit. That table's `action` column is plain
-- `text` with no CHECK, so the four new verbs need no ALTER:
--     create_plan | update_plan | rename_plan | delete_plan
-- The plan key rides in `role` — that is already how set_plan carries one —
-- and on a rename the OLD key rides in `from_org_name`, the same
-- "carries the before" role that column plays for rename_org. No human
-- sentence is stored; the UI composes it.

-- 8.1 ── The catalog, with usage ────────────────────────────────────────────
-- Needs a definer body even though finance_plan_prices is readable by a
-- founding admin: `organizations` is NOT. Org RLS is is_org_admin(org_id), and
-- a founding admin is not a member of a tenant workspace, so the workspace
-- counts are invisible to them from the client. Same reason every other
-- founding_* function exists.
--
-- `workspaces` = how many are on it RIGHT NOW.
-- `ever_used`  = how many distinct workspaces have EVER been on it, from
--                history — which is the number that tells you whether
--                deleting a tier throws away anything.
-- `protected`  = free | beta (§8.3 explains why those two are special).

create or replace function app_private.founding_plan_directory()
returns table (
  plan          text,
  display_name  text,
  monthly_cents bigint,
  note          text,
  is_active     boolean,
  sort_order    int,
  workspaces    bigint,
  ever_used     bigint,
  protected     boolean
)
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
begin
  perform public.assert_founding_admin();

  return query
  select
    fp.plan,
    fp.display_name,
    fp.monthly_cents,
    fp.note,
    fp.is_active,
    fp.sort_order,
    (select count(*) from public.organizations o where o.plan = fp.plan),
    (select count(distinct h.org_id) from public.org_plan_history h where h.plan = fp.plan),
    (fp.plan in ('free', 'beta'))
  from public.finance_plan_prices fp
  order by fp.sort_order, fp.plan;
end $$;


-- 8.2 ── Create or update a plan ────────────────────────────────────────────
-- The key lands in organizations.plan, is compared in SQL, appears in a CSV
-- column and is rendered as a badge, so it is constrained hard:
-- ^[a-z][a-z0-9_-]{0,39}$ — lower-case, starts with a letter, 40 characters
-- max (which is also finance_plan_prices.plan's own CHECK). Anything else is
-- refused in plain English, because this message is shown to a person typing
-- into a form.
--
-- NULL handling, which is the argument contract the client is written against:
--   p_display_name / p_note  — written as given. NULL CLEARS them.
--   p_monthly_cents / p_is_active / p_sort_order — NULL means "the column
--     default" on an insert and "leave it exactly as it is" on an update, so
--     a partial update from a future caller cannot silently zero a price.

create or replace function app_private.founding_upsert_plan(
  p_plan          text,
  p_display_name  text,
  p_monthly_cents bigint,
  p_note          text,
  p_is_active     boolean,
  p_sort_order    int
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_plan   text := lower(btrim(coalesce(p_plan, '')));
  v_name   text := nullif(btrim(coalesce(p_display_name, '')), '');
  v_note   text := nullif(btrim(coalesce(p_note, '')), '');
  v_exists boolean;
begin
  perform public.assert_founding_admin();

  if v_plan = '' then
    raise exception 'Give the plan a key.' using errcode = '22023';
  end if;
  if v_plan !~ '^[a-z][a-z0-9_-]{0,39}$' then
    raise exception 'A plan key must be lower-case, start with a letter, use only letters, numbers, - or _, and be 40 characters or fewer. Got: %', v_plan
      using errcode = '22023';
  end if;
  if v_name is not null and char_length(v_name) > 60 then
    raise exception 'Keep the plan name under 60 characters.' using errcode = '22023';
  end if;
  if v_note is not null and char_length(v_note) > 200 then
    raise exception 'Keep the plan note under 200 characters.' using errcode = '22023';
  end if;
  if p_monthly_cents is not null and (p_monthly_cents < 0 or p_monthly_cents > 100000000) then
    raise exception 'A monthly price must be between $0 and $1,000,000.' using errcode = '22023';
  end if;

  select true into v_exists from public.finance_plan_prices where plan = v_plan;

  insert into public.finance_plan_prices
    (plan, monthly_cents, note, display_name, is_active, sort_order)
  values
    (v_plan,
     coalesce(p_monthly_cents, 0),
     v_note,
     v_name,
     coalesce(p_is_active, true),
     coalesce(p_sort_order, 100))
  on conflict (plan) do update set
    monthly_cents = coalesce(p_monthly_cents, public.finance_plan_prices.monthly_cents),
    note          = v_note,
    display_name  = v_name,
    is_active     = coalesce(p_is_active, public.finance_plan_prices.is_active),
    sort_order    = coalesce(p_sort_order, public.finance_plan_prices.sort_order);

  insert into public.founding_admin_audit
    (actor_id, actor_email, action, role)
  values
    (auth.uid(), auth.jwt() ->> 'email',
     case when v_exists then 'update_plan' else 'create_plan' end,
     v_plan);
end $$;


-- 8.3 ── Rename a plan, cascading to every workspace on it ──────────────────
-- Returns the number of workspaces moved. This is the only write in the file
-- that touches two tables, and it MUST be both or neither — a
-- finance_plan_prices row renamed without its workspaces leaves every one of
-- them on a key with no price, which finance_summary would value at nothing.
-- A plpgsql function runs inside the caller's statement, so a raise here rolls
-- the whole thing back.
--
-- ⚠️ `free` AND `beta` CANNOT BE RENAMED, in either direction. Three separate
--    things in this codebase read those two literals:
--      * organizations.plan's column DEFAULT is 'free' (multi_org_tenancy.sql).
--        Rename it and every workspace created afterwards lands on a plan that
--        does not exist.
--      * the waitlist-approval path and founding_create_workspace's own
--        default both write 'beta'.
--      * finance_summary()'s founding-shop test is the LITERAL string 'beta'
--        (finance.sql), mirrored in financeService.ts — AGENTS.md §18 #28 —
--        and renaming the plan would silently revoke the 30%-off-for-life
--        promise for every founding shop.
--    Refusing also keeps history truthful and keeps founding_plan_alumni('beta')
--    meaning what it says. They are not special-cased out of timidity; they are
--    load-bearing identifiers, like the marketplace keys.
--
-- ⚠️ HISTORY IS NOT REWRITTEN. org_plan_history records what the plan was
--    called AT THE TIME, which is the only thing an append-only log can
--    honestly claim. The cascade does fire the trigger for every affected
--    workspace, and those rows are marked source = 'rename' (§6) so the UI can
--    render "renamed starter → launch" instead of "moved to launch from
--    starter". Rows written before the rename keep the old key forever.

create or replace function app_private.founding_rename_plan(
  p_from text,
  p_to   text
)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_from  text := lower(btrim(coalesce(p_from, '')));
  v_to    text := lower(btrim(coalesce(p_to, '')));
  v_moved bigint := 0;
begin
  perform public.assert_founding_admin();

  if v_from = '' or v_to = '' then
    raise exception 'Give both the current key and the new one.' using errcode = '22023';
  end if;
  if v_from = v_to then
    raise exception 'That is already the plan key.' using errcode = '22023';
  end if;
  if v_to !~ '^[a-z][a-z0-9_-]{0,39}$' then
    raise exception 'A plan key must be lower-case, start with a letter, use only letters, numbers, - or _, and be 40 characters or fewer. Got: %', v_to
      using errcode = '22023';
  end if;
  if v_from in ('free', 'beta') then
    raise exception '"%" is built in and cannot be renamed — it is written into the database defaults, the waitlist path and the founding-discount rule.', v_from
      using errcode = '22023';
  end if;
  -- The same reasoning in reverse: a plan renamed INTO 'free' or 'beta' would
  -- quietly become the target of all three of those, whatever it used to mean.
  if v_to in ('free', 'beta') then
    raise exception '"%" is built in and cannot be taken over by another plan.', v_to
      using errcode = '22023';
  end if;

  if not exists (select 1 from public.finance_plan_prices where plan = v_from) then
    raise exception 'No such plan: %', v_from using errcode = '22023';
  end if;
  if exists (select 1 from public.finance_plan_prices where plan = v_to) then
    raise exception 'There is already a plan called "%".', v_to using errcode = '22023';
  end if;

  update public.finance_plan_prices set plan = v_to where plan = v_from;

  -- Transaction-local (the `true`), so it cannot leak into the next statement
  -- on this connection even if something below raises.
  perform set_config('app.plan_history_source', 'rename', true);
  update public.organizations set plan = v_to where plan = v_from;
  get diagnostics v_moved = row_count;
  perform set_config('app.plan_history_source', '', true);

  insert into public.founding_admin_audit
    (actor_id, actor_email, action, from_org_name, role)
  values
    (auth.uid(), auth.jwt() ->> 'email', 'rename_plan', v_from, v_to);

  return v_moved;
end $$;


-- 8.4 ── Delete a plan ──────────────────────────────────────────────────────
-- Refuses on protected (§8.3), on IN USE, and — since the alumni surface
-- exists — on EVER USED.
--
-- Why "ever used" refuses too. §8.6's alumni picker is built from the
-- catalog, so deleting a tier is what makes its alumni unreachable: the
-- history rows survive (they are FK-free by design, §5) but nothing can ask
-- for them any more. That is the opposite of the property this file was
-- written for. It is also the right billing answer on its own — a tier real
-- workspaces were once on is a fact about money that changed hands, and the
-- catalog row is the only place its name and price are still written down.
--
-- DELETE therefore means "I created this by mistake": a typo'd key, a tier
-- nobody was ever put on. Anything with a past is RETIRED instead, which is
-- almost always what the founder actually wants — an inactive plan keeps its
-- price, so the books still value any workspace on it, keeps its alumni
-- selectable, and simply stops being offered.
--
-- Both refusal messages name that alternative rather than just saying no.

create or replace function app_private.founding_delete_plan(p_plan text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_plan  text := lower(btrim(coalesce(p_plan, '')));
  v_count bigint;
begin
  perform public.assert_founding_admin();

  if v_plan = '' then
    raise exception 'Which plan?' using errcode = '22023';
  end if;
  if v_plan in ('free', 'beta') then
    raise exception '"%" is built in and cannot be deleted.', v_plan using errcode = '22023';
  end if;
  if not exists (select 1 from public.finance_plan_prices where plan = v_plan) then
    raise exception 'No such plan: %', v_plan using errcode = '22023';
  end if;

  select count(*) into v_count from public.organizations o where o.plan = v_plan;
  if v_count > 0 then
    raise exception '% workspace(s) are on "%". Move them to another plan first, or set it inactive to take it off the list and keep its price.', v_count, v_plan
      using errcode = '22023';
  end if;

  -- Nobody is on it NOW, but somebody has been. Deleting the catalog row is
  -- what would strand those alumni (§8.6 builds its picker from the catalog),
  -- so this is a retire, not a delete.
  select count(distinct h.org_id) into v_count
    from public.org_plan_history h where h.plan = v_plan;
  if v_count > 0 then
    raise exception '% workspace(s) have been on "%" in the past. A plan with history cannot be deleted — set it inactive instead, which takes it off the list, keeps its price and keeps its alumni findable.', v_count, v_plan
      using errcode = '22023';
  end if;

  delete from public.finance_plan_prices where plan = v_plan;

  insert into public.founding_admin_audit
    (actor_id, actor_email, action, role)
  values
    (auth.uid(), auth.jwt() ->> 'email', 'delete_plan', v_plan);
end $$;


-- 8.5 ── One workspace's plan timeline ──────────────────────────────────────
-- Newest first: the expanded workspace row in the console reads downward from
-- "where they are now".

create or replace function app_private.founding_org_plan_history(p_org uuid)
returns table (
  plan             text,
  previous_plan    text,
  changed_at       timestamptz,
  changed_by_email text,
  source           text
)
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
begin
  perform public.assert_founding_admin();

  return query
  select h.plan, h.previous_plan, h.changed_at, h.changed_by_email, h.source
  from public.org_plan_history h
  where h.org_id = p_org
  order by h.changed_at desc, h.plan;
end $$;


-- 8.6 ── THE HEADLINE: everyone who was ever on a plan ──────────────────────
-- "Who was a beta user", answerable in ten years, INCLUDING the shops that
-- have since been deleted — which is the whole reason org_id is not a foreign
-- key (§5). A deleted workspace comes back with exists_now = false and its
-- name taken from the denormalised org_name on its most recent history row.
--
--   first_on / last_on   the earliest and latest time this workspace was
--                        recorded ON that plan. Not "how long" — a workspace
--                        can go beta → pro → beta, and both stamps are real.
--   still_on             their CURRENT plan is this one. False for a deleted
--                        workspace, which has no current plan at all.
--   created_at           from organizations, so NULL once it is gone.
--
-- Ordered first_on ascending: the earliest adopters at the top, which is the
-- order a founder reads a list like this in.

create or replace function app_private.founding_plan_alumni(p_plan text default 'beta')
returns table (
  org_id       uuid,
  org_name     text,
  current_plan text,
  first_on     timestamptz,
  last_on      timestamptz,
  still_on     boolean,
  created_at   timestamptz,
  exists_now   boolean
)
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  v_plan text := lower(btrim(coalesce(p_plan, 'beta')));
begin
  perform public.assert_founding_admin();

  return query
  select
    h.org_id,
    coalesce(
      o.name,
      (select h2.org_name
         from public.org_plan_history h2
        where h2.org_id = h.org_id and h2.org_name is not null
        order by h2.changed_at desc
        limit 1)
    ),
    o.plan,
    min(h.changed_at),
    max(h.changed_at),
    coalesce(o.plan = v_plan, false),
    o.created_at,
    (o.id is not null)
  from public.org_plan_history h
  left join public.organizations o on o.id = h.org_id
  where h.plan = v_plan
  group by h.org_id, o.id, o.name, o.plan, o.created_at
  order by min(h.changed_at);
end $$;


-- ── 9. The public SECURITY INVOKER wrappers ─────────────────────────────────
-- `create or replace` so a re-run repairs a stray definer copy the same way
-- security_rpc_wrappers.sql section 2 does. Argument names, DEFAULTs, return
-- types and volatility are copied from section 8 verbatim (see the header).

create or replace function public.founding_plan_directory()
returns table (
  plan          text,
  display_name  text,
  monthly_cents bigint,
  note          text,
  is_active     boolean,
  sort_order    int,
  workspaces    bigint,
  ever_used     bigint,
  protected     boolean
)
language sql
security invoker
stable
set search_path = public, pg_temp
as $$ select * from app_private.founding_plan_directory() $$;

create or replace function public.founding_upsert_plan(
  p_plan          text,
  p_display_name  text,
  p_monthly_cents bigint,
  p_note          text,
  p_is_active     boolean,
  p_sort_order    int
)
returns void
language sql
security invoker
set search_path = public, pg_temp
as $$ select app_private.founding_upsert_plan(p_plan, p_display_name, p_monthly_cents, p_note, p_is_active, p_sort_order) $$;

create or replace function public.founding_rename_plan(
  p_from text,
  p_to   text
)
returns bigint
language sql
security invoker
set search_path = public, pg_temp
as $$ select app_private.founding_rename_plan(p_from, p_to) $$;

create or replace function public.founding_delete_plan(p_plan text)
returns void
language sql
security invoker
set search_path = public, pg_temp
as $$ select app_private.founding_delete_plan(p_plan) $$;

create or replace function public.founding_org_plan_history(p_org uuid)
returns table (
  plan             text,
  previous_plan    text,
  changed_at       timestamptz,
  changed_by_email text,
  source           text
)
language sql
security invoker
stable
set search_path = public, pg_temp
as $$ select * from app_private.founding_org_plan_history(p_org) $$;

create or replace function public.founding_plan_alumni(p_plan text default 'beta')
returns table (
  org_id       uuid,
  org_name     text,
  current_plan text,
  first_on     timestamptz,
  last_on      timestamptz,
  still_on     boolean,
  created_at   timestamptz,
  exists_now   boolean
)
language sql
security invoker
stable
set search_path = public, pg_temp
as $$ select * from app_private.founding_plan_alumni(p_plan) $$;


-- ── 10. Privileges ──────────────────────────────────────────────────────────
-- BOTH halves of each RPC need EXECUTE for `authenticated`: the wrapper so the
-- request gets in, the app_private body because a SECURITY INVOKER wrapper
-- runs as the caller. PUBLIC and anon are revoked from both. service_role is
-- granted back where PUBLIC used to give it access (it bypasses RLS already,
-- so this moves no boundary).
--
-- public.org_plan_history_write() gets the OPPOSITE treatment — revoked from
-- every client role including service_role — because it is a trigger function,
-- and a trigger fires regardless of the invoking role's EXECUTE privilege
-- (AGENTS.md §18 #44; proven in security_function_hardening.sql §7, which is
-- where this signature should be added if that file is ever revised).
-- app_private.org_plan_list() was revoked the same way in §4, next to the
-- `create or replace` that resets its ACL.
--
-- Written inline rather than through app_private._harden(), which only exists
-- once security_function_hardening.sql has run.

do $$
declare
  sig  text;
  r    text;
  rpcs text[] := array[
    'app_private.founding_plan_directory()',
    'app_private.founding_upsert_plan(text, text, bigint, text, boolean, int)',
    'app_private.founding_rename_plan(text, text)',
    'app_private.founding_delete_plan(text)',
    'app_private.founding_org_plan_history(uuid)',
    'app_private.founding_plan_alumni(text)',
    'public.founding_plan_directory()',
    'public.founding_upsert_plan(text, text, bigint, text, boolean, int)',
    'public.founding_rename_plan(text, text)',
    'public.founding_delete_plan(text)',
    'public.founding_org_plan_history(uuid)',
    'public.founding_plan_alumni(text)'
  ];
  internals text[] := array[
    'public.org_plan_history_write()'
  ];
begin
  foreach sig in array rpcs loop
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

  foreach sig in array internals loop
    execute format('revoke all on function %s from public', sig);
    foreach r in array array['anon', 'authenticated', 'service_role'] loop
      if exists (select 1 from pg_roles where rolname = r) then
        execute format('revoke all on function %s from %I', sig, r);
      end if;
    end loop;
  end loop;
end $$;


-- ── 11. Tell PostgREST to re-read the schema ────────────────────────────────

notify pgrst, 'reload schema';


-- ============================================================================
-- VERIFY (run separately, in the SQL Editor)
-- ============================================================================
-- (a) Six wrappers in public, all prosecdef = f; six bodies in app_private,
--     all prosecdef = t:
--
--   select n.nspname, p.oid::regprocedure::text, p.prosecdef
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where p.proname in ('founding_plan_directory','founding_upsert_plan',
--                       'founding_rename_plan','founding_delete_plan',
--                       'founding_org_plan_history','founding_plan_alumni')
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
-- (c) The catalog now drives assignability. Expect the nine seeded keys, in
--     ladder order, and expect the list to SHRINK when you retire one:
--
--   select app_private.org_plan_list();
--   update public.finance_plan_prices set is_active = false where plan = 'scale';
--   select app_private.org_plan_list();     -- 'scale' is gone
--   update public.finance_plan_prices set is_active = true  where plan = 'scale';
--
-- (d) Every workspace has at least one history row (the backfill), and the
--     trigger is live:
--
--   select count(*) filter (where source = 'backfill') as backfilled,
--          count(*) filter (where source = 'trigger')  as observed,
--          count(*) filter (where source = 'rename')   as relabelled
--   from public.org_plan_history;
--
-- (e) The headline, signed in as a Founding admin via the app:
--
--   select * from public.founding_plan_alumni('beta');
--
-- (f) The audit trail of everything done here:
--
--   select created_at, actor_email, action, from_org_name as old_key, role as plan
--   from public.founding_admin_audit
--   where action in ('create_plan','update_plan','rename_plan','delete_plan')
--   order by created_at desc limit 20;
--
-- (g) From the app: Founder console → Plans. A non-founder must get
--     "Not authorized — Founding Workspace admins only." (42501) from all six.


-- ============================================================================
-- ROLLBACK — run BEFORE security_function_hardening.sql's own rollback, whose
-- `drop schema app_private restrict` refuses while these six bodies live there.
--
-- ⚠️ READ THIS BEFORE RUNNING IT. Three deliberate asymmetries:
--
--  1. finance_plan_prices IS KEPT, and so are display_name / is_active /
--     sort_order. Dropping the table would destroy every price a founder has
--     set and break finance_summary(); dropping the columns would throw away
--     labels and ordering for nothing. The columns are inert without the rest
--     of this file — is_active stops being consulted the moment §4 is reverted
--     below — so there is no reason to remove them.
--
--  2. org_plan_history IS KEPT BY DEFAULT. It is the record this file exists
--     to create, the same way founder_console.sql's rollback leaves
--     founding_admin_audit alone. The drop is the last line, commented out
--     twice over; uncomment it only if you mean to throw the history away.
--
--  3. app_private.org_plan_list() MUST BE RESTORED to the hardcoded nine, and
--     that statement is NOT optional. founder_console.sql's
--     founding_set_org_plan and founding_create_workspace call it by name; if
--     it is left reading a table this rollback has stopped maintaining — or
--     dropped outright — every plan becomes unassignable from the console.
--     The block below therefore restores the ORIGINAL definition, byte for
--     byte, including its `immutable` volatility and its revokes.
-- ============================================================================
-- -- 1. The RPCs (wrappers first — they depend on the bodies).
-- drop function if exists public.founding_plan_alumni(text);
-- drop function if exists public.founding_org_plan_history(uuid);
-- drop function if exists public.founding_delete_plan(text);
-- drop function if exists public.founding_rename_plan(text, text);
-- drop function if exists public.founding_upsert_plan(text, text, bigint, text, boolean, int);
-- drop function if exists public.founding_plan_directory();
-- drop function if exists app_private.founding_plan_alumni(text);
-- drop function if exists app_private.founding_org_plan_history(uuid);
-- drop function if exists app_private.founding_delete_plan(text);
-- drop function if exists app_private.founding_rename_plan(text, text);
-- drop function if exists app_private.founding_upsert_plan(text, text, bigint, text, boolean, int);
-- drop function if exists app_private.founding_plan_directory();
--
-- -- 2. The history trigger. The TABLE is kept (see note 2 above).
-- drop trigger if exists organizations_plan_history_upd on public.organizations;
-- drop trigger if exists organizations_plan_history_ins on public.organizations;
-- drop function if exists public.org_plan_history_write();
--
-- -- 3. REQUIRED — put org_plan_list() back exactly as founder_console.sql §3
-- --    defines it, or the console can no longer set a plan.
-- create or replace function app_private.org_plan_list()
-- returns text[]
-- language sql
-- immutable
-- as $$
--   select array[
--     'free', 'beta', 'starter', 'basic', 'growth',
--     'pro', 'business', 'scale', 'enterprise'
--   ]::text[]
-- $$;
--
-- do $$
-- declare r text;
-- begin
--   execute 'revoke all on function app_private.org_plan_list() from public';
--   foreach r in array array['anon', 'authenticated'] loop
--     if exists (select 1 from pg_roles where rolname = r) then
--       execute format('revoke all on function app_private.org_plan_list() from %I', r);
--     end if;
--   end loop;
-- end $$;
--
-- -- 4. Narrow the UPDATE grant back to finance.sql's two columns. REVOKE is
-- --    per-column, so this removes only the three this file added.
-- revoke update (display_name, is_active, sort_order) on public.finance_plan_prices from authenticated;
--
-- notify pgrst, 'reload schema';
--
-- -- 5. LAST RESORT ONLY — this destroys the record of who was a beta shop.
-- --    Leave it commented unless you mean it.
-- -- drop table if exists public.org_plan_history;
