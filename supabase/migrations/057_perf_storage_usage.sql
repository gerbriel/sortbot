-- ============================================================================
-- PERF: storage_usage_bytes() — one query instead of ~2 500 bucket LIST calls
-- ============================================================================
-- Run in the Supabase SQL Editor (as `postgres`, the owner) AFTER
-- security_function_hardening.sql and security_rpc_wrappers.sql. Additive:
-- creates ONE function pair and nothing else. No table, column, policy, grant
-- on any existing object, or DATA change. Idempotent. Rollback at the bottom.
--
-- ── WHAT IT REPLACES ────────────────────────────────────────────────────────
-- `fetchStorageUsage` in src/App.tsx walks the bucket to draw the header meter:
--
--     storage.list(userId)                     → 1 call, returns the product folders
--     for each folder: storage.list(uid/pid)   → 1 call EACH
--
-- The founder's own prefix holds 2 517 product folders, so one render of the
-- storage meter is ~2 518 round trips. Each one is an authenticated PostgREST
-- request that Supabase's storage API answers with a `storage.objects` query
-- under RLS — and that RLS calls `storage_prefix_writable()`, which itself runs
-- an `exists (select … from org_members …)`. The meter fires on sign-in, after
-- every upload, and on the refresh button.
--
-- One `sum()` over the same rows answers it exactly.
--
-- ── SCOPE: THE CALLER'S OWN uid PREFIX, DELIBERATELY ────────────────────────
-- Object paths are `{userId}/{productId}/{file}` (security_storage_policies.sql).
-- The walk it replaces lists `userId` — the SIGNED-IN USER's own prefix — so
-- this function sums exactly that prefix and NOT the whole org. That is what
-- keeps the meter's number identical before and after; widening it to the org
-- would be a behaviour change, not a perf change. If an org-wide meter is ever
-- wanted, the org variant is `(storage.foldername(name))[1] in
-- (select m.user_id::text from org_members m where m.org_id in (select user_org_ids()))`
-- — a deliberate product decision, not a refactor.
--
-- Compared as TEXT, never cast to uuid: a legacy or hand-made object whose
-- first path segment is not a uuid must not raise inside this function (same
-- rule as the storage policies).
--
-- ── WHY SECURITY DEFINER ────────────────────────────────────────────────────
-- `storage.objects` is owned by the storage extension and `authenticated` has
-- no direct grant on it in a default Supabase project; the browser only ever
-- reaches it through the storage API. A SECURITY INVOKER function would fail
-- with 42501 for every real caller. The definer body is therefore the boundary,
-- and the boundary is the WHERE clause: it can only ever sum rows whose first
-- path segment equals `auth.uid()`, so a caller cannot read another user's
-- total, and it returns two integers — never a path, a name or an id.
--
-- ── SHAPE: AGENTS.md §18 rule 20, post-security_rpc_wrappers form ───────────
-- Client-called RPC → the SECURITY DEFINER body lives in `app_private`
-- (unexposed, so linter 0028/0029 cannot see it) and a SECURITY INVOKER wrapper
-- with an IDENTICAL signature stays in `public` so `/rest/v1/rpc/storage_usage_bytes`
-- answers. PUBLIC and anon are revoked from both; `authenticated` and
-- `service_role` keep EXECUTE. `search_path` is pinned on both (0011).
--
-- ⚠️ ADD-TO-LIST: both signatures must also be added to the Group A array in
--    security_function_hardening.sql and to the `sigs` array in
--    security_rpc_wrappers.sql, so replaying either file re-hardens this pair
--    instead of leaving it behind. That edit ships with this file.
--
-- ── THE CLIENT DOES NOT DEPEND ON THIS HAVING BEEN RUN ──────────────────────
-- `fetchStorageUsage` calls the RPC, and on ANY error (42883 undefined_function
-- being the one that matters) falls back to the original walk. Ship the code
-- first; run this whenever.
-- ============================================================================


-- ── 0. Preconditions ────────────────────────────────────────────────────────

do $$
begin
  if to_regnamespace('app_private') is null then
    raise exception
      'perf_storage_usage.sql: app_private does not exist — run security_function_hardening.sql first.';
  end if;
  if to_regclass('storage.objects') is null then
    raise exception
      'perf_storage_usage.sql: storage.objects not found — is this a Supabase project?';
  end if;
end $$;


-- ── 1. The definer body ─────────────────────────────────────────────────────
-- Returns jsonb so the shape can grow without a signature change (PostgREST
-- renders a scalar jsonb RPC as the JSON value itself):
--   { "used_bytes": <bigint>, "file_count": <bigint> }
-- `metadata->>'size'` is the same field the JS walk reads as `metadata.size`.
-- Objects with no size metadata count toward file_count and contribute 0 bytes,
-- which is exactly what `?? 0` does in the walk.

create or replace function app_private.storage_usage_bytes()
returns jsonb
language sql
stable
security definer
set search_path = storage, public
as $$
  select jsonb_build_object(
    'used_bytes', coalesce(sum((o.metadata->>'size')::bigint), 0)::bigint,
    'file_count', count(*)::bigint
  )
  from storage.objects o
  where o.bucket_id = 'product-images'
    and (storage.foldername(o.name))[1] = auth.uid()::text
$$;


-- ── 2. The public SECURITY INVOKER wrapper ──────────────────────────────────

create or replace function public.storage_usage_bytes()
returns jsonb
language sql
stable
security invoker
set search_path = app_private, public
as $$ select app_private.storage_usage_bytes() $$;


-- ── 3. Privileges ───────────────────────────────────────────────────────────
-- Same rule as every other Group A function: revoke the CREATE-time PUBLIC
-- grant and anon, keep authenticated (the app) and service_role.

revoke all on function app_private.storage_usage_bytes() from public;
revoke all on function public.storage_usage_bytes()      from public;

do $$
declare r text;
begin
  foreach r in array array['anon'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on function app_private.storage_usage_bytes() from %I', r);
      execute format('revoke all on function public.storage_usage_bytes() from %I', r);
    end if;
  end loop;
  foreach r in array array['authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('grant execute on function app_private.storage_usage_bytes() to %I', r);
      execute format('grant execute on function public.storage_usage_bytes() to %I', r);
    end if;
  end loop;
end $$;


-- ── 4. VERIFY (run separately) ──────────────────────────────────────────────
--   -- As the founder, from the app's devtools console while signed in:
--   --   const { data } = await supabase.rpc('storage_usage_bytes');
--   --   data  // { used_bytes: 1234567890, file_count: 4854 }
--   -- and confirm it matches the meter's old number (the walk) to the byte.
--
--   -- Anon must NOT be able to call it:
--   --   error.code === '42501'
--
--   -- No SECURITY DEFINER function became anon-reachable (expect 0):
--   select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and p.prosecdef
--     and has_function_privilege('anon', p.oid, 'execute');


-- ============================================================================
-- ROLLBACK
-- ============================================================================
-- drop function if exists public.storage_usage_bytes();
-- drop function if exists app_private.storage_usage_bytes();
