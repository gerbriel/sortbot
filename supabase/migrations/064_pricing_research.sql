-- ============================================================================
-- PRICING RESEARCH — what was suggested, what the seller corrected it to, what
--                    it eventually sold for, and how long that took.
-- ============================================================================
-- Run AFTER multi_org_tenancy.sql (reuses default_org_id() and user_org_ids()).
-- Purely additive; idempotent; rollback at the bottom. Nothing in Steps 1-4
-- reads these tables today except the research card, which hides itself when
-- they are absent — so the client ships before this file is run.
--
-- WHY THIS IS STEP ONE of docs/pricing/00-plan.md and not step four: a price
-- engine can be rewritten next month, and an identification pass can be
-- replaced outright. The RECORD of what the app suggested, what a human
-- changed it to, and what the piece actually sold for cannot be recreated
-- later at any price. Everything here costs one small insert per listing per
-- run, and it is the only part of the plan whose absence is permanent.
--
-- MODEL: ordinary ORG-SCOPED data, exactly like listing_labels.sql and
-- brand_aliases.sql.
--   * Every table carries org_id with DEFAULT public.default_org_id(), so the
--     client NEVER passes org_id on insert.
--   * ANY member writes. There is no is_org_admin() gate anywhere below, and
--     that is deliberate: the person who corrects a price or marks a piece sold
--     is whoever is listing that day. A feedback loop only an admin can close
--     is a feedback loop that does not close.
--   * Cross-org isolation is total: org_id in (select public.user_org_ids()).
--     Nothing in this file reads across workspaces, and nothing should: the
--     plan's own rule (§"What to watch out for") is that captured data is used
--     only for the workspace that produced it until terms say otherwise.
--
-- product_group_id IS DELIBERATELY NOT A FOREIGN KEY, in all four tables that
-- carry it — the same decision listing_publications made in marketplaces.sql.
-- A listing's leader `products` row can be deleted, re-created by a restore, or
-- re-grouped while the garment is still on a rack and still sold last Tuesday.
-- A cascade there would destroy the only record that the sale ever happened,
-- which is the one row in this file that can never be reconstructed.
-- `batch_id` IS a foreign key, ON DELETE SET NULL, for the same reason: deleting
-- a batch must not erase what its listings were priced at.
--
-- SHAPE:
--   pricing_events         the append-only log. One row per (listing, field,
--                          moment): what was suggested, and separately what a
--                          human corrected it to. This is the training set for
--                          plan step 7 and the only reason step 1 comes first.
--   listing_identifications one row per RUN per listing: era, condition, flaws,
--                          rarity, each with the EVIDENCE behind it, plus a
--                          confidence. A run is never updated — a new run is a
--                          new row, and the newest is the current answer. The
--                          one exception is `reviewed`, below.
--   listing_prices         one row per RUN per listing: the suggested price, the
--                          range, the method in one word, the explanation as
--                          ORDERED lines, the comps it used, and whether it
--                          needs a human look and why.
--   listing_sales          what it actually sold for. Entered by hand today
--                          (Products › Mark as sold); a Shopify webhook later.
--                          READ BY THE EMBEDDINGS RPC through to_regclass, so
--                          the two migrations may be run in either order.
--   price_comps_cache      the seam for the paid comps sources. NOTHING WRITES
--                          IT YET, on purpose: the eBay Browse API and web
--                          search arrive with a key, and a cache whose shape is
--                          already settled is one fewer migration at that point.
--
-- ASKING PRICES AND SOLD PRICES ARE NEVER MERGED. `comps` entries carry a
-- `kind` of 'sold' or 'asking' and the price engine medians them separately —
-- see src/lib/pricing.ts and AGENTS.md §18. A CHECK cannot enforce the inside
-- of a JSONB array without a function, so the guarantee lives in one pure,
-- exhaustively tested module rather than in a trigger nobody can read.
--
-- MONEY IS INTEGER CENTS, like finance.sql. Every amount is bounded at 1e11
-- (a billion dollars): a fat-fingered price must not silently rescale a chart,
-- and a bigint with no ceiling is how that happens.
-- ============================================================================


-- ── 1. Tables ───────────────────────────────────────────────────────────────

-- The log. `field` names WHAT was suggested; `source` names WHO suggested it.
-- Both are CHECKed vocabularies, because this table's whole value is being
-- groupable years from now, and a free-text `field` becomes 'Price' / 'price '
-- / 'price_cents' within a month.
create table if not exists public.pricing_events (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations(id) on delete cascade default public.default_org_id(),
  batch_id         uuid references public.workflow_batches(id) on delete set null,
  product_group_id uuid not null,
  field            text not null check (field in (
                     'title', 'description', 'tags', 'price',
                     'era', 'condition', 'flaws', 'rarity', 'export')),
  -- What the app proposed, and what it ended up as. Both JSONB rather than text
  -- because `tags` is an array, `price` is a number and `flaws` is a list: one
  -- column per shape would be nine columns, eight of them always null.
  suggested        jsonb,
  corrected        jsonb,
  -- NULL means "not yet decided", which is a third state and not the same as
  -- false: a suggestion nobody has looked at must not count as a rejection.
  accepted         boolean,
  source           text not null default 'rules' check (source in ('rules', 'model', 'user', 'export')),
  confidence       numeric(4,3) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  created_by       uuid references auth.users(id) on delete set null default auth.uid(),
  created_at       timestamptz not null default now()
);

-- One run of the identification pass. Evidence is an ORDERED array of
-- { kind, text, weight } — the "Why" list under each facet in the Step 3 card
-- is literally this column, so the order the rules fired in is the order the
-- seller reads. An answer with no evidence is not an answer this feature ships.
create table if not exists public.listing_identifications (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations(id) on delete cascade default public.default_org_id(),
  batch_id         uuid references public.workflow_batches(id) on delete set null,
  product_group_id uuid not null,
  era              text check (era is null or length(era) <= 40),
  era_evidence     jsonb not null default '[]'::jsonb check (jsonb_typeof(era_evidence) = 'array'),
  condition        text check (condition is null or length(condition) <= 40),
  flaws            text[] not null default '{}',
  -- 0..1, two decimals. NOT the 1-10 that vocab_models.collectibility uses —
  -- that is one INPUT to this, divided by ten, and keeping the stored value in
  -- the same 0..1 space as every confidence means the review rule reads one way.
  rarity           numeric(3,2) check (rarity is null or (rarity >= 0 and rarity <= 1)),
  rarity_evidence  jsonb check (rarity_evidence is null or jsonb_typeof(rarity_evidence) = 'array'),
  confidence       numeric(4,3) not null check (confidence >= 0 and confidence <= 1),
  -- title / description / tags / metafields the run proposes. Never applied on
  -- its own: the card offers them and a person accepts.
  suggestions      jsonb check (suggestions is null or jsonb_typeof(suggestions) = 'object'),
  source           text not null default 'rules' check (source in ('rules', 'model')),
  -- Which engine produced it: 'rules@1' today. A model name later. This is what
  -- lets a held-out test set in plan step 7 compare two eras of suggestion.
  model            text check (model is null or length(model) <= 60),
  -- THE ONE MUTABLE COLUMN IN THIS TABLE. "I have looked at this" is a fact
  -- about a person, not about the run, and it must not require re-running the
  -- pass to record. It is the only column in the UPDATE grant below.
  reviewed         boolean not null default false,
  created_by       uuid references auth.users(id) on delete set null default auth.uid(),
  created_at       timestamptz not null default now()
);

-- One run of the price engine. `explanation` is an ordered array of plain
-- sentences — every number in it comes from `comps` or from the listing, and
-- nothing in this app is allowed to write a price it cannot explain that way.
create table if not exists public.listing_prices (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations(id) on delete cascade default public.default_org_id(),
  batch_id         uuid references public.workflow_batches(id) on delete set null,
  product_group_id uuid not null,
  -- NULL is a real answer: 'insufficient' means we decline to name a number.
  -- Zero would be a number, and the export price gate reads $0 as "unpriced",
  -- so a 0 here would be a suggestion the gate then blocks on. Never write 0.
  suggested_cents  bigint check (suggested_cents is null or (suggested_cents > 0 and suggested_cents <= 100000000000)),
  low_cents        bigint check (low_cents  is null or (low_cents  > 0 and low_cents  <= 100000000000)),
  high_cents       bigint check (high_cents is null or (high_cents > 0 and high_cents <= 100000000000)),
  constraint listing_prices_range_ordered
    check (low_cents is null or high_cents is null or low_cents <= high_cents),
  method           text not null check (method in ('spoken', 'own_sold_median', 'asking_adjusted', 'insufficient')),
  explanation      jsonb not null default '[]'::jsonb check (jsonb_typeof(explanation) = 'array'),
  confidence       numeric(4,3) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  -- Each entry: { kind: 'sold'|'asking', source, price_cents, url?, note?, sold_at? }.
  comps            jsonb not null default '[]'::jsonb check (jsonb_typeof(comps) = 'array'),
  needs_review     boolean not null default false,
  review_reasons   text[] not null default '{}',
  created_by       uuid references auth.users(id) on delete set null default auth.uid(),
  created_at       timestamptz not null default now()
);

-- What it sold for. The contract in docs/pricing/00-plan.md §"Contracts", column
-- for column, because the embeddings migration's RPC reads this table and the
-- two files are written by different passes.
--
-- `days_to_sell` is deliberately NOT a column: it is `sold_at - listed_at`, it
-- is computed at read time, and storing it would be a third value that can
-- disagree with the two it comes from.
create table if not exists public.listing_sales (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.organizations(id) on delete cascade default public.default_org_id(),
  product_group_id   uuid not null,
  -- Denormalised at write time, like listing_publications.sku: the products row
  -- may be gone, and the sale still needs to name what was sold.
  sku                text check (sku is null or length(sku) <= 60),
  listed_price_cents bigint check (listed_price_cents is null or (listed_price_cents > 0 and listed_price_cents <= 100000000000)),
  sold_price_cents   bigint not null check (sold_price_cents > 0 and sold_price_cents <= 100000000000),
  listed_at          timestamptz,
  sold_at            timestamptz not null default now(),
  constraint listing_sales_dates_ordered check (listed_at is null or listed_at <= sold_at),
  -- Free text, not a CHECK against MarketplaceKey: a shop sells at a flea market
  -- and to a friend, and a sale the app refuses to record is a sale that leaves
  -- the price history wrong. The UI offers the ten keys plus 'shopify'/'other'.
  marketplace        text check (marketplace is null or length(marketplace) <= 40),
  source             text not null default 'manual' check (source in ('manual', 'shopify_webhook')),
  external_order_id  text check (external_order_id is null or length(external_order_id) <= 120),
  created_by         uuid references auth.users(id) on delete set null default auth.uid(),
  created_at         timestamptz not null default now()
);

-- The comps cache. NOTHING WRITES IT YET — see the header. It is here so the
-- shape is settled before the first paid source arrives, and so the price
-- engine's read path (`expires_at > now()`) exists from the start.
create table if not exists public.price_comps_cache (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations(id) on delete cascade default public.default_org_id(),
  -- A normalised description of the QUERY, not of one listing: the plan's rule
  -- is one search per design, not per item ("Search once per design rather than
  -- per item"), so two identical tees share a row and one API call.
  query_key  text not null check (length(btrim(query_key)) between 1 and 200),
  source     text not null check (source in ('ebay_active', 'web_sold', 'own_sales')),
  comps      jsonb not null default '[]'::jsonb check (jsonb_typeof(comps) = 'array'),
  fetched_at timestamptz not null default now(),
  -- NOT NULL on purpose: a cache row with no expiry is a permanent wrong answer.
  -- The plan says a month or two; the writer picks, this column insists there is one.
  expires_at timestamptz not null,
  constraint price_comps_cache_expiry_after_fetch check (expires_at >= fetched_at)
);


-- ── 2. Indexes ──────────────────────────────────────────────────────────────

-- Every read in researchService is "the latest rows for these listings in my
-- workspace", so all three logs get the same (org, listing, newest-first) shape.
create index if not exists pricing_events_org_group_idx
  on public.pricing_events (org_id, product_group_id, created_at desc);
create index if not exists listing_identifications_org_group_idx
  on public.listing_identifications (org_id, product_group_id, created_at desc);
create index if not exists listing_prices_org_group_idx
  on public.listing_prices (org_id, product_group_id, created_at desc);
create index if not exists listing_sales_org_group_idx
  on public.listing_sales (org_id, product_group_id, sold_at desc);

-- Step 4's review split reads every flagged listing of ONE batch.
create index if not exists listing_prices_batch_idx
  on public.listing_prices (batch_id) where batch_id is not null;

-- One sale row per order. COALESCE because a hand-entered sale has no order id
-- and two of those for one listing are legitimate (sold, returned, sold again) —
-- so NULLs must not collide, and an empty string is what makes them compare.
-- An EXPRESSION index, which PostgREST cannot address with onConflict: the
-- service therefore inserts and reports 23505 in words, exactly as
-- brandAliasService does with its own expression uniqueness.
create unique index if not exists listing_sales_order_uidx
  on public.listing_sales (org_id, product_group_id, coalesce(external_order_id, ''));

-- One cache row per (workspace, source, query). A plain multi-column unique
-- index, so a future writer COULD upsert onto it — but should not: putting the
-- conflict columns in the UPDATE grant would re-open org_id (marketplaces.sql
-- §org_marketplaces explains the trade). Find-then-update instead.
create unique index if not exists price_comps_cache_key_uidx
  on public.price_comps_cache (org_id, source, query_key);

-- The sweep that drops expired rows.
create index if not exists price_comps_cache_expiry_idx
  on public.price_comps_cache (expires_at);


-- ── 3. RLS — org members only, no admin gate ────────────────────────────────

alter table public.pricing_events          enable row level security;
alter table public.listing_identifications enable row level security;
alter table public.listing_prices          enable row level security;
alter table public.listing_sales           enable row level security;
alter table public.price_comps_cache       enable row level security;

grant select, insert, delete on
  public.pricing_events, public.listing_identifications, public.listing_prices,
  public.listing_sales, public.price_comps_cache
  to authenticated;

-- UPDATE is granted PER COLUMN, and on three of the five tables not at all.
--
-- The revoke is what makes the column grants idempotent: a table-wide UPDATE
-- grant left over from an earlier run would otherwise survive and silently
-- re-open org_id. Column grants do not replace a table-wide grant.
revoke update on
  public.pricing_events, public.listing_identifications, public.listing_prices,
  public.listing_sales, public.price_comps_cache
  from authenticated;

-- pricing_events: NO UPDATE AT ALL. A logged suggestion is a fact about a
-- moment — "at 14:02 the app proposed $38 and the seller typed $55". Editing it
-- does not correct history, it destroys the one signal plan step 7 needs. A
-- correction is a NEW row, which is why `corrected` exists as its own column.
--
-- listing_prices: NO UPDATE either. Each run is a row; re-running writes a new
-- one and the newest wins. There is nothing in a completed price calculation
-- that a person should be able to reach in and change.
--
-- listing_identifications: `reviewed` only. See the column comment.
grant update (reviewed) on public.listing_identifications to authenticated;

-- listing_sales: the money, the dates, the marketplace and the sku are all
-- correctable — a mistyped sold price is the single most likely error in this
-- whole file and it poisons every future comp drawn from it. `org_id`,
-- `product_group_id`, `source`, `created_by` and `created_at` are outside the
-- grant: a sale cannot be moved between workspaces or between listings, a
-- webhook row cannot be relabelled as hand-entered, and provenance is immutable.
grant update (sku, listed_price_cents, sold_price_cents, listed_at, sold_at,
              marketplace, external_order_id)
  on public.listing_sales to authenticated;

-- price_comps_cache: the payload and its clock. The key columns stay out, so a
-- refresh can never move a cached answer onto another workspace or another query.
grant update (comps, fetched_at, expires_at) on public.price_comps_cache to authenticated;

-- One policy shape for all five tables. Helper calls are wrapped as
-- `(select public.user_org_ids())` so Postgres evaluates them ONCE per
-- statement (an InitPlan) rather than once per row — AGENTS.md §18 #47, and the
-- reason perf_rls_initplan.sql exists. A bare call here would cost 94 ms on the
-- kind of 300-row read Step 4's review split makes.
do $$
declare t text;
begin
  foreach t in array array['pricing_events', 'listing_identifications',
                           'listing_prices', 'listing_sales', 'price_comps_cache'] loop
    execute format('drop policy if exists %I on public.%I', 'research_select_'||t, t);
    execute format('drop policy if exists %I on public.%I', 'research_insert_'||t, t);
    execute format('drop policy if exists %I on public.%I', 'research_update_'||t, t);
    execute format('drop policy if exists %I on public.%I', 'research_delete_'||t, t);
    execute format(
      'create policy %I on public.%I for select to authenticated '
      'using (org_id in (select public.user_org_ids()))',
      'research_select_'||t, t);
    -- NULL org_id is not "in (...)", so the DEFAULT above is effectively
    -- mandatory: a client cannot insert an untagged row.
    execute format(
      'create policy %I on public.%I for insert to authenticated '
      'with check (org_id in (select public.user_org_ids()))',
      'research_insert_'||t, t);
    -- Created for all five for symmetry. On pricing_events and listing_prices it
    -- is UNREACHABLE — those tables have no UPDATE grant at all — and that is
    -- the same harmless shape listing_labels.sql uses on product_labels: the
    -- loop stays one thing rather than growing a special case.
    execute format(
      'create policy %I on public.%I for update to authenticated '
      'using (org_id in (select public.user_org_ids())) '
      'with check (org_id in (select public.user_org_ids()))',
      'research_update_'||t, t);
    execute format(
      'create policy %I on public.%I for delete to authenticated '
      'using (org_id in (select public.user_org_ids()))',
      'research_delete_'||t, t);
  end loop;
end $$;


-- ── VERIFY (run separately) ─────────────────────────────────────────────────
--   -- Cross-org leak check — must return 0 for every table, for any member:
--   select 'pricing_events' t, count(*) from public.pricing_events
--     where org_id not in (select public.user_org_ids())
--   union all select 'listing_identifications', count(*) from public.listing_identifications
--     where org_id not in (select public.user_org_ids())
--   union all select 'listing_prices', count(*) from public.listing_prices
--     where org_id not in (select public.user_org_ids())
--   union all select 'listing_sales', count(*) from public.listing_sales
--     where org_id not in (select public.user_org_ids())
--   union all select 'price_comps_cache', count(*) from public.price_comps_cache
--     where org_id not in (select public.user_org_ids());
--
--   -- Provenance is immutable: each of these must FAIL with 42501 for an
--   -- ordinary signed-in member. (Postgres names the TABLE, not the column,
--   -- when a column the statement touches is outside the grant.)
--   update public.listing_sales set created_by = gen_random_uuid() where true;
--   update public.listing_sales set org_id = gen_random_uuid() where true;
--   update public.listing_identifications set confidence = 1 where true;
--   -- ...but the one human column IS writable:
--   update public.listing_identifications set reviewed = true where true;
--
--   -- A log row cannot be rewritten at all (42501):
--   update public.pricing_events set corrected = '"x"'::jsonb where true;
--
--   -- One sale per order (23505 on the second):
--   insert into public.listing_sales (product_group_id, sold_price_cents, external_order_id)
--     values ('00000000-0000-0000-0000-0000000000aa', 4500, 'SHOP-1');
--   insert into public.listing_sales (product_group_id, sold_price_cents, external_order_id)
--     values ('00000000-0000-0000-0000-0000000000aa', 4500, 'SHOP-1');
--
--   -- ...but two hand-entered sales of one listing are fine (both NULL order ids
--   -- collapse to '' — so the SECOND of these fails, which is the intended
--   -- reading: re-recording the same listing as sold is a mistake, not a resale
--   -- to capture. A genuine resale carries an order id or a note.)
--
--   -- A price suggestion of $0 is refused (23514) — the export gate reads 0 as
--   -- "unpriced", so 'insufficient' must be NULL, never zero:
--   insert into public.listing_prices (product_group_id, method, suggested_cents)
--     values ('00000000-0000-0000-0000-0000000000aa', 'insufficient', 0);
--
--   -- An inverted range is refused (23514):
--   insert into public.listing_prices (product_group_id, method, low_cents, high_cents)
--     values ('00000000-0000-0000-0000-0000000000aa', 'own_sold_median', 9000, 4000);
--
--   -- Days to sell, computed at read time (never stored):
--   select product_group_id, sold_price_cents,
--          extract(day from (sold_at - listed_at))::int as days_to_sell
--     from public.listing_sales where listed_at is not null order by sold_at desc;
--
--   -- Retention for the cache, by hand (there is no cron here):
--   delete from public.price_comps_cache where expires_at < now();

-- ── ROLLBACK ────────────────────────────────────────────────────────────────
-- No dependency order to respect: none of these tables references another.
-- listing_sales is LAST because it is the only one holding data a shop cannot
-- re-derive — dropping it discards the sold history that every future comp and
-- every future model is built on. Take a copy first if there is anything in it:
--   create table listing_sales_backup as select * from public.listing_sales;
--
-- drop table if exists public.price_comps_cache;
-- drop table if exists public.pricing_events;
-- drop table if exists public.listing_prices;
-- drop table if exists public.listing_identifications;
-- drop table if exists public.listing_sales;
