-- ============================================================================
-- LISTING EMBEDDINGS — one CLIP vector per product photo, and the nearest-
--                      neighbour lookup that turns them into comps.
-- ============================================================================
-- Run in the Supabase SQL Editor (as `postgres`) AFTER:
--     multi_org_tenancy.sql   (organizations, default_org_id(), user_org_ids())
--   optional, in any order relative to this file:
--     pricing_research.sql    (listing_sales — read through to_regclass below,
--                              so its absence is fine and its arrival needs no
--                              re-run of this file)
--     security_function_hardening.sql + security_rpc_wrappers.sql
--
-- Purely additive: ONE table, ONE function pair, no change to any existing
-- table, column, policy or trigger. Idempotent. Rollback at the bottom.
--
-- This is step 3 of docs/pricing/00-plan.md — the free one. The shop's own sold
-- history is the cheapest comp source it will ever have, and an image embedding
-- is how a photo finds it without anybody typing a search.
--
-- ── WHAT A ROW IS ───────────────────────────────────────────────────────────
-- One row per `product_images` row: the 512-float CLIP ViT-B/32 image embedding
-- of that PHOTO, L2-normalised, plus the ids needed to get from a photo back to
-- a listing. Written ONLY by the matting service (services/matting) with the
-- service role — see `POST /v1/embed` in that service's CONTRACT.md §5. The app
-- never computes an embedding; it asks the service to, and reads the result
-- through match_listing_images().
--
-- ── WHY THE VECTORS ARE L2-NORMALISED BEFORE THEY GET HERE ──────────────────
-- Cosine distance is what `<=>` computes, and for unit vectors it is exactly
-- 1 - dot product. Normalising at write time means every read — the index, the
-- RPC, any future query — agrees on the metric without having to remember to
-- divide. The service asserts the norm; nothing here re-checks it, because a
-- CHECK on a 512-dimension float sum is a cost paid on every insert for a
-- property one writer already guarantees.
--
-- ── WHY `model` IS PART OF THE ANSWER, NOT JUST PROVENANCE ──────────────────
-- Two vectors from DIFFERENT models are not comparable: the cosine between a
-- CLIP-B/32 embedding and some future model's embedding is noise that sorts
-- convincingly. So match_listing_images() filters candidates to the QUERY row's
-- own `model`, and re-embedding a catalogue with a new model is a re-run of the
-- service rather than a migration. The primary key is `product_image_id` ALONE
-- (not (image, model)), so that re-run REPLACES each row rather than doubling
-- the table — one photo has one current embedding, and the old model's vectors
-- disappear as they are superseded instead of lingering as ghost comps.
--
-- ── WHY product_group_id IS NOT A FOREIGN KEY ───────────────────────────────
-- Same reasoning as listing_publications.product_group_id (marketplaces.sql):
-- the group LEADER's `products` row can be deleted and re-created while the
-- listing itself carries on, and a cascade from it would destroy the embedding
-- of a photo that still exists. `product_id` IS a foreign key, because a photo
-- genuinely cannot outlive its product row — `product_images` already cascades
-- from `products`.
--
-- ── WHAT `similarity` IS FOR, BESIDES COMPS ─────────────────────────────────
-- Duplicate detection. Two photos of the SAME garment land at ~0.95+; the app
-- surfaces that as "near duplicate" (src/lib/embeddingsService.ts thresholds),
-- which is how a reseller catches the jacket they already listed last month.
-- That is also why the RPC excludes the query's own product_group_id: a
-- listing's other four photos are not a comp, they are the same garment.
-- ============================================================================


-- ── 0. Preconditions ────────────────────────────────────────────────────────
-- Fail loudly and early rather than leaving a half-built table behind.

do $$
begin
  if to_regclass('public.organizations') is null then
    raise exception 'listing_embeddings.sql: run multi_org_tenancy.sql first.';
  end if;
  if to_regclass('public.product_images') is null then
    raise exception 'listing_embeddings.sql: public.product_images is missing.';
  end if;
  if to_regprocedure('public.default_org_id()') is null
     or to_regprocedure('public.user_org_ids()') is null then
    raise exception 'listing_embeddings.sql: default_org_id()/user_org_ids() are missing — run multi_org_tenancy.sql first.';
  end if;
end $$;


-- ── 1. pgvector ─────────────────────────────────────────────────────────────
-- On Supabase the extension normally lives in the `extensions` schema, which is
-- already on the search_path of `postgres` and of the PostgREST roles; on a
-- plain Postgres it lands in `public`. Either is fine — everything below names
-- the type unqualified and the precondition after this block is what turns
-- "the type does not resolve" into a sentence naming the fix, rather than a
-- confusing `type "vector" does not exist` on the CREATE TABLE.
--
-- IF THIS BLOCK CANNOT CREATE IT: enable it in the Supabase dashboard under
-- Database → Extensions (search "vector"), then re-run this file. Managed
-- Postgres often withholds CREATE EXTENSION from the SQL editor's role, and
-- that is not a reason to stop — the dashboard toggle does the same thing.

do $$
begin
  if exists (select 1 from pg_extension where extname = 'vector') then
    return;
  end if;
  begin
    if exists (select 1 from pg_namespace where nspname = 'extensions') then
      execute 'create extension vector with schema extensions';
    else
      execute 'create extension vector';
    end if;
  exception when others then
    raise notice 'listing_embeddings.sql: could not create the pgvector extension (%). Enable it in the Supabase dashboard under Database → Extensions (search "vector"), then re-run this file.', sqlerrm;
  end;
end $$;

do $$
begin
  if to_regtype('vector') is null then
    raise exception 'listing_embeddings.sql: the `vector` type does not resolve. Either pgvector is not enabled (Supabase dashboard → Database → Extensions → "vector"), or its schema is not on this session''s search_path — in that case run `set search_path = public, extensions;` and re-run this file.';
  end if;
end $$;


-- ── 2. The table ────────────────────────────────────────────────────────────

create table if not exists public.listing_embeddings (
  -- One current embedding per photo. See the header for why the model is not
  -- part of this key.
  product_image_id uuid primary key references public.product_images(id) on delete cascade,
  product_id       uuid references public.products(id) on delete cascade,
  -- The group LEADER's id — the same value src/lib/grouping.ts calls a group.
  -- Deliberately NOT a foreign key (see the header). NULL for a photo whose
  -- product row carries no product_group, which is a listing of one photo.
  product_group_id uuid,
  org_id           uuid not null references public.organizations(id) on delete cascade default public.default_org_id(),
  -- L2-normalised at write time. 512 is CLIP ViT-B/32's projected image
  -- embedding; a different model means a different `model` value AND, if its
  -- width differs, a new column — which is the honest cost of the dimension
  -- being part of the type.
  embedding        vector(512) not null,
  model            text not null check (length(btrim(model)) between 1 and 80),
  created_at       timestamptz not null default now()
);


-- ── 3. Indexes ──────────────────────────────────────────────────────────────

create index if not exists listing_embeddings_org_idx
  on public.listing_embeddings (org_id);
-- The RPC excludes the query's whole group, and the app looks a listing's
-- photos up by group; both read this.
create index if not exists listing_embeddings_group_idx
  on public.listing_embeddings (org_id, product_group_id);
create index if not exists listing_embeddings_product_idx
  on public.listing_embeddings (product_id);
-- `model` is in every candidate filter (see the header), so it pairs with org.
create index if not exists listing_embeddings_org_model_idx
  on public.listing_embeddings (org_id, model);

-- THE VECTOR INDEX, and why it is guarded.
--
-- HNSW is what this wants: better recall per unit of work than ivfflat, and —
-- the part that matters for a shop that lists every day — it does not need to
-- be rebuilt as rows arrive, because there is no centroid list to go stale.
-- It requires pgvector >= 0.5.0.
--
-- ivfflat is the fallback rather than "no index" because the query is an
-- ORDER BY over every row in the workspace; a sequential scan is fine at a
-- thousand photos and is not fine at fifty thousand. An ivfflat index built on
-- an EMPTY table has one useless centroid, so the NOTICE says to reindex once
-- there are rows — that is a real caveat of the fallback and the reason HNSW is
-- preferred, not a footnote.
do $$
begin
  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname in
      ('listing_embeddings_vec_hnsw', 'listing_embeddings_vec_ivfflat')
  ) then
    return;
  end if;
  begin
    execute 'create index listing_embeddings_vec_hnsw on public.listing_embeddings '
         || 'using hnsw (embedding vector_cosine_ops)';
  exception when others then
    raise notice 'listing_embeddings.sql: HNSW is unavailable (%) — falling back to ivfflat.', sqlerrm;
    begin
      execute 'create index listing_embeddings_vec_ivfflat on public.listing_embeddings '
           || 'using ivfflat (embedding vector_cosine_ops) with (lists = 100)';
      raise notice 'listing_embeddings.sql: built ivfflat with lists=100 on an empty table. REINDEX it once the table holds real rows, or upgrade pgvector to >= 0.5.0 for HNSW.';
    exception when others then
      raise notice 'listing_embeddings.sql: no vector index could be built (%). Similarity search still works by sequential scan; revisit before the table passes a few thousand rows.', sqlerrm;
    end;
  end;
end $$;


-- ── 4. RLS — org members, read and write ────────────────────────────────────
-- The SERVICE writes these rows (service role, bypasses RLS). Members get the
-- verbs anyway, and DELETE is the one that earns its place: a photo's embedding
-- is derived data about that member's own listing, and "forget this photo"
-- must not require a founder. INSERT is granted for symmetry with every other
-- org-scoped table here; nothing in src/ uses it.

alter table public.listing_embeddings enable row level security;

grant select, insert, delete on public.listing_embeddings to authenticated;

-- UPDATE is granted per COLUMN, in the listing_labels.sql shape: the three ids
-- and org_id are absent, so a row can never be moved to another workspace or
-- re-pointed at another listing, and created_at cannot be back-dated. The
-- revoke is what makes the column grant idempotent — a table-wide grant left by
-- an earlier run would otherwise survive and silently re-open org_id.
revoke update on public.listing_embeddings from authenticated;
grant update (embedding, model) on public.listing_embeddings to authenticated;

drop policy if exists listing_embeddings_select on public.listing_embeddings;
drop policy if exists listing_embeddings_insert on public.listing_embeddings;
drop policy if exists listing_embeddings_update on public.listing_embeddings;
drop policy if exists listing_embeddings_delete on public.listing_embeddings;

-- Every helper call is wrapped as `(select ...)` so Postgres evaluates it once
-- per statement (InitPlan) instead of once per row — AGENTS.md §18 #47, and the
-- reason perf_rls_initplan.sql exists.
create policy listing_embeddings_select on public.listing_embeddings
  for select to authenticated
  using (org_id in (select public.user_org_ids()));

-- A NULL org_id is not `in (...)`, so the DEFAULT above is effectively
-- mandatory: a client cannot insert an untagged row.
create policy listing_embeddings_insert on public.listing_embeddings
  for insert to authenticated
  with check (org_id in (select public.user_org_ids()));

create policy listing_embeddings_update on public.listing_embeddings
  for update to authenticated
  using (org_id in (select public.user_org_ids()))
  with check (org_id in (select public.user_org_ids()));

create policy listing_embeddings_delete on public.listing_embeddings
  for delete to authenticated
  using (org_id in (select public.user_org_ids()));


-- ── 5. The private schema (no-op if the hardening files already ran) ────────

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


-- ── 6. match_listing_images — the nearest-neighbour read ────────────────────
-- Born in the AGENTS.md §18 #45 shape: an `app_private` SECURITY DEFINER body
-- behind a `public` SECURITY INVOKER wrapper with an IDENTICAL signature, so
-- neither hardening file ever has to move it and linter 0028/0029 never fires.
-- "Identical" is literal — PostgREST resolves an RPC by ARGUMENT NAME and
-- renders the response from the RETURN TYPE, so the wrapper in §7 repeats
-- `p_product_image_id` / `p_limit`, the default, the column list in order and
-- the volatility. Change one half and you must change the other.
--
-- WHY SECURITY DEFINER AT ALL, when a member can already SELECT these rows.
-- Two reasons, and the first is the load-bearing one:
--
--   1. THE PLAN. This is `order by embedding <=> $1 limit N` — the one query
--      shape a vector index can answer. An RLS `USING` clause on the table
--      becomes a filter the planner applies to rows the index hands back, so an
--      APPROXIMATE index plus a post-filter can return fewer than `p_limit`
--      rows and silently drop comps. Here the function proves the workspace
--      ONCE, up front, and then filters with a plain `e.org_id = <that org>`,
--      which the index and the planner both understand.
--
--   2. `listing_sales` is read through `to_regclass`, so the body has to be
--      dynamic SQL — and dynamic SQL in an INVOKER function would re-plan
--      against whatever search_path the caller happened to have.
--
-- WHAT THIS DOES NOT FIX, said plainly: `e.org_id = $2` and `e.model = $3` are
-- still a FILTER over an approximate index scan (verified — at 5,000 rows the
-- plan is `Index Scan using listing_embeddings_vec_hnsw` with both as Filter),
-- and pgvector documents that a filtered HNSW scan can return fewer rows than
-- the LIMIT asks for. It is acceptable here because ONE workspace dominates its
-- own table and its own model, so the filter discards almost nothing; a
-- deployment where that stops being true wants `hnsw.ef_search` raised, or a
-- partial index per workspace. Moving the filter into an RLS USING clause would
-- make the same problem worse AND invisible.
--
-- The org check is therefore the whole boundary, exactly as in the matting
-- service's auth.py: a query row in another workspace returns NOTHING (an empty
-- result, not an error — an error would distinguish "not yours" from "no
-- neighbours" and turn this into an existence oracle over product_image_id).

create or replace function app_private.match_listing_images(
  p_product_image_id uuid,
  p_limit            int default 12
)
returns table (
  product_image_id uuid,
  product_id       uuid,
  product_group_id uuid,
  similarity       real,
  title            text,
  price            numeric,
  sold_price_cents bigint,
  sold_at          timestamptz
)
language plpgsql
stable
security definer
-- `extensions` is here for Supabase (where pgvector lives there) and is simply
-- ignored on a Postgres where the extension is in `public`. Without it the
-- `<=>` operator and the vector_cosine_ops opclass do not resolve inside this
-- body, whatever the caller's own search_path happens to be.
set search_path = public, extensions, pg_temp
as $$
declare
  v_org    uuid;
  v_group  uuid;
  v_model  text;
  v_vec    vector(512);
  -- Clamped, not validated: this is a strip of thumbnails, and a caller asking
  -- for 10,000 neighbours is a bug in the caller, not a request to serve.
  v_limit  int := least(greatest(coalesce(p_limit, 12), 1), 50);
  v_sales  boolean := to_regclass('public.listing_sales') is not null;
  v_sql    text;
begin
  select e.org_id, e.product_group_id, e.model, e.embedding
    into v_org, v_group, v_model, v_vec
  from public.listing_embeddings e
  where e.product_image_id = p_product_image_id;

  -- No embedding for that photo yet, or it belongs to somebody else. Both are
  -- an empty result: see the header.
  if v_org is null then
    return;
  end if;
  if not (v_org in (select public.user_org_ids())) then
    return;
  end if;

  -- $1 v_vec  $2 v_org  $3 v_model  $4 p_product_image_id  $5 v_group  $6 v_limit
  v_sql := $q$
    select
      e.product_image_id,
      e.product_id,
      e.product_group_id,
      -- `<=>` is cosine DISTANCE; for the unit vectors this table stores,
      -- 1 - distance is exactly cosine similarity.
      (1 - (e.embedding <=> $1))::real       as similarity,
      -- Leader-tolerant, the same rule as productSearchService.groupRowsIntoListings:
      -- the leader row when there is one, the photo's own product row otherwise
      -- (the legacy fresh-UUID groups, AGENTS.md §11).
      coalesce(pl.title, pm.title)           as title,
      coalesce(pl.price, pm.price)           as price,
      %s                                     as sold_price_cents,
      %s                                     as sold_at
    from public.listing_embeddings e
    left join public.products pl on pl.id = e.product_group_id
    left join public.products pm on pm.id = e.product_id
    %s
    where e.org_id = $2
      -- Same model only. A cosine across two models sorts convincingly and
      -- means nothing (see the header).
      and e.model = $3
      -- Never the query photo itself...
      and e.product_image_id <> $4
      -- ...and never another photo of the same garment.
      and ($5::uuid is null or e.product_group_id is distinct from $5::uuid)
    -- The operator has to appear in ORDER BY in this exact form for the vector
    -- index to be used. `order by similarity desc` would sort correctly and
    -- scan the whole workspace to do it.
    order by e.embedding <=> $1
    limit $6
  $q$;

  return query execute format(
    v_sql,
    case when v_sales then 's.sold_price_cents' else 'null::bigint' end,
    case when v_sales then 's.sold_at'          else 'null::timestamptz' end,
    case when v_sales then
      -- LATERAL and not a plain join: a listing can have several sales rows
      -- (a return, a re-list), and joining them directly would multiply the
      -- candidate row and hand the app the same photo three times. The most
      -- recent sale is the one a comp wants. Matches listing_sales_org_group_idx.
      'left join lateral ('
      || ' select s2.sold_price_cents, s2.sold_at'
      || ' from public.listing_sales s2'
      || ' where s2.org_id = e.org_id and s2.product_group_id = e.product_group_id'
      || ' order by s2.sold_at desc limit 1'
      || ') s on true'
    else '' end
  ) using v_vec, v_org, v_model, p_product_image_id, v_group, v_limit;
end $$;


-- ── 7. The public SECURITY INVOKER wrapper ──────────────────────────────────
-- `create or replace` so a re-run repairs a stray definer copy, the same way
-- security_rpc_wrappers.sql section 2 does.

create or replace function public.match_listing_images(
  p_product_image_id uuid,
  p_limit            int default 12
)
returns table (
  product_image_id uuid,
  product_id       uuid,
  product_group_id uuid,
  similarity       real,
  title            text,
  price            numeric,
  sold_price_cents bigint,
  sold_at          timestamptz
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$ select * from app_private.match_listing_images(p_product_image_id, p_limit) $$;


-- ── 8. Privileges ───────────────────────────────────────────────────────────
-- BOTH halves need EXECUTE for `authenticated`: the wrapper so the request gets
-- in, the app_private body because a SECURITY INVOKER wrapper runs as the
-- caller. PUBLIC and anon are revoked from both (CREATE FUNCTION grants EXECUTE
-- to PUBLIC, which is the whole reason §9's hardening files exist).

do $$
declare
  sig  text;
  r    text;
  sigs text[] := array[
    'app_private.match_listing_images(uuid, int)',
    'public.match_listing_images(uuid, int)'
  ];
begin
  foreach sig in array sigs loop
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
end $$;


-- ── 9. Tell PostgREST to re-read the schema ─────────────────────────────────

notify pgrst, 'reload schema';


-- ============================================================================
-- VERIFY (run separately, in the SQL Editor)
-- ============================================================================
-- (a) The table, the vector column and whichever vector index was built:
--
--   select column_name, data_type, udt_name
--   from information_schema.columns
--   where table_schema = 'public' and table_name = 'listing_embeddings'
--   order by ordinal_position;
--
--   select indexname, indexdef from pg_indexes
--   where schemaname = 'public' and tablename = 'listing_embeddings' order by 1;
--   -- listing_embeddings_vec_hnsw is the one you want. _vec_ivfflat means
--   -- pgvector is older than 0.5.0 — see section 3's NOTICE.
--
-- (b) One wrapper in public with prosecdef = f, one body in app_private with
--     prosecdef = t:
--
--   select n.nspname, p.oid::regprocedure::text, p.prosecdef
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where p.proname = 'match_listing_images' order by 1;
--
-- (c) Linter 0028/0029 must stay clear — expect ZERO rows:
--
--   select p.oid::regprocedure::text
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and p.prosecdef
--     and (has_function_privilege('anon', p.oid, 'EXECUTE')
--          or has_function_privilege('authenticated', p.oid, 'EXECUTE'));
--
-- (d) Cross-org leak check — must return 0 for any signed-in member:
--
--   select count(*) from public.listing_embeddings
--   where org_id not in (select public.user_org_ids());
--
-- (e) Provenance and scope are immutable: this must FAIL with 42501 when run as
--     an ordinary signed-in member. (Postgres names the TABLE, not the column,
--     when a statement touches a column outside the grant — the denial is what
--     matters.)
--
--   update public.listing_embeddings set org_id = gen_random_uuid() where true;
--
-- (f) End to end, signed in as a member of a workspace that has embeddings:
--
--   select * from public.match_listing_images(
--     (select product_image_id from public.listing_embeddings limit 1), 5);
--
--   -- similarity must be in (-1, 1] and DESCENDING; no row may share the query
--   -- row's product_group_id; every row must be in your own workspace.
--
-- (g) Before pricing_research.sql has run, (f) must still work with
--     sold_price_cents and sold_at NULL on every row. After it runs, a
--     listing_sales row for a neighbour's group must appear there — with no
--     re-run of this file.
--
-- (h) The index is actually used once the table has rows (expect an Index Scan
--     using listing_embeddings_vec_hnsw, not a Seq Scan):
--
--   explain analyze select product_image_id from public.listing_embeddings
--   where org_id = '<your org>' order by embedding <=> (
--     select embedding from public.listing_embeddings limit 1) limit 12;

-- ── ROLLBACK ────────────────────────────────────────────────────────────────
-- Functions before the table (the body references it), and the wrapper before
-- the body. `app_private` is deliberately NOT dropped — the hardening files and
-- founder_console.sql live there too.
--
-- The `vector` EXTENSION is deliberately NOT dropped either: dropping it would
-- take every vector column in the database with it, and another feature may
-- have started using it since.
--
-- drop function if exists public.match_listing_images(uuid, int);
-- drop function if exists app_private.match_listing_images(uuid, int);
-- drop table if exists public.listing_embeddings;
