-- ============================================================================
-- 073_code_sequences.sql
-- CODE SEQUENCES: a per-workspace counter that hands out consecutive numbers
-- for sequential SKUs and GS1 in-store EAN-13 barcodes, atomically, so two
-- people assigning codes at the same moment never draw the same number.
-- ============================================================================
-- Run AFTER:
--     031_multi_org_tenancy.sql   (organizations, org_members)
--     053_listing_labels.sql      (products.sku, products_org_sku_uidx)
--
-- IDEMPOTENT. Additive: one new table (`create table if not exists`), one
-- function pair (`create or replace`), grants re-stated on every run. No
-- existing table, policy, function or row is changed. Safe to run any number
-- of times. Rollback at the bottom.
--
-- WHY A TABLE AND NOT organizations.code_sequence
--   Locking. The counter is bumped with one UPDATE that takes a row lock until
--   the caller's transaction ends. On organizations that lock would be the
--   same row lock a workspace rename, a description_settings save or the
--   share_insights toggle needs, so a long label run would queue behind (or
--   in front of) an admin saving settings, and every bump would rewrite the
--   whole organizations row (description_settings JSONB included) as a new
--   tuple version. A one-row-per-workspace table locks nothing else, and its
--   tuples are tiny. It also keeps organizations' columns, and 072's narrowed
--   client UPDATE grant on them, exactly as they are.
--   The table lives in app_private, so PostgREST never exposes it and no
--   client role holds any privilege on it: the only way to touch the counter
--   is next_code_numbers.
--
-- WHAT IT ADDS
--   app_private.org_code_sequences
--     org_id      uuid primary key references organizations(id) on delete cascade
--     last_value  bigint not null default 0 check (last_value >= 0)
--     updated_at  timestamptz not null default now()
--   A row is created lazily on a workspace's first draw.
--
--   public.next_code_numbers(p_org uuid, p_count int)
--     returns table (n bigint)
--   p_count consecutive numbers (1 to 500 per call), the first one 1 for a
--   workspace that has never drawn. One statement:
--     insert ... on conflict (org_id) do update
--       set last_value = last_value + p_count returning last_value
--   then generate_series(last - p_count + 1, last). The upsert's row lock
--   serialises concurrent callers for the same workspace (the second waits
--   for the first to commit, then adds to the committed value), so ranges
--   never overlap; different workspaces never wait on each other. A number
--   drawn and then not used (a 23505 on a hand-typed SKU, a failed write)
--   is a gap, never a reuse: the client draws the next one.
--   22023 when p_org is null or p_count is outside 1 to 500.
--   42501 unless the caller is a member of p_org (any role), or the request
--   carries the service_role JWT. Membership is checked first, so a
--   non-member learns nothing, not even whether the workspace exists.
--
-- SHAPE AND PRIVILEGES (AGENTS.md section 18 #45, #46, as 069/071)
--   An app_private SECURITY DEFINER body with
--   `set search_path = public, pg_temp` behind a public SECURITY INVOKER
--   wrapper with an IDENTICAL signature. EXECUTE is revoked from PUBLIC and
--   anon on both halves and granted to authenticated and service_role on
--   both halves (the invoker wrapper calls the body AS the caller). The
--   definer is the point: no client role can write the counter table. anon
--   gets NO usage on app_private (#45a).
--   The client never computes max + 1 (AGENTS.md section 18 #63).
-- ============================================================================


-- ── 0. Preconditions ────────────────────────────────────────────────────────

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

do $$
begin
  if to_regclass('public.organizations') is null or to_regclass('public.org_members') is null then
    raise exception '073_code_sequences.sql: run 031_multi_org_tenancy.sql first.';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'products'
                    and column_name = 'sku') then
    raise exception '073_code_sequences.sql: products.sku is missing. Run 053_listing_labels.sql first.';
  end if;
end $$;


-- ── 1. The counter table ────────────────────────────────────────────────────

create table if not exists app_private.org_code_sequences (
  org_id     uuid primary key references public.organizations(id) on delete cascade,
  last_value bigint not null default 0 check (last_value >= 0),
  updated_at timestamptz not null default now()
);

comment on table app_private.org_code_sequences is
  'Per-workspace counter for sequential SKUs and in-store EAN-13 numbers (073). Written only by app_private.next_code_numbers.';

-- No client role reads or writes it directly, whatever default privileges say.
do $$
declare
  r text;
begin
  revoke all on table app_private.org_code_sequences from public;
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on table app_private.org_code_sequences from %I', r);
    end if;
  end loop;
end $$;


-- ── 2. app_private.next_code_numbers(p_org, p_count) ────────────────────────

create or replace function app_private.next_code_numbers(p_org uuid, p_count int)
returns table (n bigint)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_last bigint;
begin
  if p_org is null then
    raise exception 'Which workspace?' using errcode = '22023';
  end if;

  -- Membership first, so a non-member learns nothing (not even existence).
  if not exists (select 1 from public.org_members m
                  where m.org_id = p_org and m.user_id = (select auth.uid()))
     and coalesce((select auth.jwt()) ->> 'role', '') <> 'service_role' then
    raise exception 'Not authorized: members of this workspace only.'
      using errcode = '42501';
  end if;

  if p_count is null or p_count < 1 or p_count > 500 then
    raise exception 'Ask for 1 to 500 numbers at a time.' using errcode = '22023';
  end if;

  if not exists (select 1 from public.organizations o where o.id = p_org) then
    raise exception 'No such workspace.' using errcode = '22023';
  end if;

  insert into app_private.org_code_sequences as s (org_id, last_value)
  values (p_org, p_count)
  on conflict (org_id) do update
    set last_value = s.last_value + excluded.last_value,
        updated_at = now()
  returning s.last_value into v_last;

  return query
    select g::bigint from generate_series(v_last - p_count + 1, v_last) as g;
end $$;


-- ── 3. The public SECURITY INVOKER wrapper (identical signature) ────────────

create or replace function public.next_code_numbers(p_org uuid, p_count int)
returns table (n bigint)
language sql
volatile
security invoker
set search_path = public, pg_temp
as $$ select * from app_private.next_code_numbers(p_org, p_count) $$;


-- ── 4. Privileges ───────────────────────────────────────────────────────────
-- Re-stated on every run: `create or replace` keeps an ACL, but a function
-- dropped and re-created by hand would come back with the PUBLIC default.

do $$
declare
  sig  text;
  r    text;
  sigs text[] := array[
    'app_private.next_code_numbers(uuid, int)',
    'public.next_code_numbers(uuid, int)'
  ];
begin
  foreach sig in array sigs loop
    execute format('revoke all on function %s from public', sig);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on function %s from anon', sig);
    end if;
    foreach r in array array['authenticated', 'service_role'] loop
      if exists (select 1 from pg_roles where rolname = r) then
        execute format('grant execute on function %s to %I', sig, r);
      end if;
    end loop;
  end loop;
end $$;


-- ── 5. Tell PostgREST to re-read the schema ─────────────────────────────────

notify pgrst, 'reload schema';


-- ============================================================================
-- VERIFY (run separately, in the SQL Editor)
-- ============================================================================
-- (a) The wrapper in public with prosecdef = f, the body in app_private with
--     prosecdef = t, identical arguments and results:
--
--   select n.nspname, p.oid::regprocedure::text, p.prosecdef, p.provolatile,
--          pg_get_function_arguments(p.oid), pg_get_function_result(p.oid)
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where p.proname = 'next_code_numbers'
--   order by 1;
--
-- (b) anon cannot execute either half; authenticated and service_role can;
--     no client role holds a privilege on the table:
--
--   select p.oid::regprocedure::text,
--          has_function_privilege('anon', p.oid, 'execute')          as anon,
--          has_function_privilege('authenticated', p.oid, 'execute') as authed,
--          has_function_privilege('service_role', p.oid, 'execute')  as service
--   from pg_proc p where p.proname = 'next_code_numbers';
--
--   select grantee, privilege_type from information_schema.role_table_grants
--   where table_schema = 'app_private' and table_name = 'org_code_sequences';
--   -- expect only postgres (the owner)
--
-- (c) From the app, signed in:
--     await supabase.rpc('next_code_numbers', { p_org: '<my org id>', p_count: 3 })
--     -- [{ n: 1 }, { n: 2 }, { n: 3 }] the first time, [{ n: 4 }, ...] next
--     await supabase.rpc('next_code_numbers', { p_org: '<another org id>', p_count: 1 })
--     -- error 42501
--
-- (d) Each workspace's counter:
--
--   select o.name, s.last_value, s.updated_at
--   from app_private.org_code_sequences s join public.organizations o on o.id = s.org_id
--   order by s.updated_at desc;


-- ============================================================================
-- ROLLBACK (run as postgres). Drops the function pair and the counters.
-- SKUs and barcodes already written to products are untouched; a workspace on
-- the sequential scheme gets "needs the 073 migration" from the app until the
-- file is run again, and would then restart at 1 (a 23505 on each number
-- already used is retried with the next one, but a long run of them will
-- exhaust the client's attempt budget: keep the table if you may re-apply).
-- ============================================================================
-- drop function if exists public.next_code_numbers(uuid, int);
-- drop function if exists app_private.next_code_numbers(uuid, int);
-- drop table if exists app_private.org_code_sequences;
-- notify pgrst, 'reload schema';
