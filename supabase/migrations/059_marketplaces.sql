-- ============================================================================
-- MARKETPLACES — where a workspace sells, what each marketplace calls things,
--                which batch is aimed at which, and what has actually been
--                published where.
-- ============================================================================
-- Run AFTER multi_org_tenancy.sql (reuses user_org_ids(), default_org_id() and
-- is_org_admin()) and AFTER org_description_settings.sql (the per-marketplace
-- PRICE RULES live in organizations.description_settings->'platformPricing';
-- org_marketplaces.settings->>'pricingRuleId' points AT one of those rules by
-- id rather than re-storing the numbers — one price rule, one place to edit it).
-- is_beta_admin() comes from beta_signups.sql and is required only for the
-- GLOBAL vocabulary rows; the rest of this file works without it.
--
-- Purely additive; idempotent; rollback at the bottom. Until it is run, every
-- read in src/lib/marketplaceService.ts reports 'unavailable', the Workspace
-- panel's Marketplaces tab shows a setup hint, and Steps 1-4 behave exactly as
-- they do today — so the code ships first, in the house order.
--
-- Plan: docs/marketplaces/00-plan.md §2b, §2c, §4. Rationale, RLS decisions and
-- the verification transcript: docs/marketplaces/02-data.md.
--
--
-- WHAT IS HERE, AND WHY EACH IS ITS OWN SHAPE
--
--   org_marketplaces       WHICH marketplaces this workspace sells on, plus
--                          that marketplace's defaults. The PK is
--                          (org_id, marketplace) — a workspace enables a
--                          marketplace at most once, and that IS the rule, so
--                          there is no surrogate id and no unique index to keep
--                          in step with it.
--                          ADMIN-WRITTEN. Turning a marketplace on changes what
--                          every member sees in Step 4 and commits the shop to
--                          a place it will be judged on; that is a workspace
--                          decision, not a per-listing one. (Contrast
--                          marketplace_vocab below, and listing_labels.sql.)
--
--   marketplace_vocab      WHAT this marketplace calls a brand / colour /
--                          condition / size / category. Two scopes in one
--                          table: org_id NULL rows are GLOBAL (founder-curated,
--                          seeded from each marketplace's own published lists),
--                          org_id rows are that workspace's overrides, and the
--                          workspace row WINS. Resolution lives in the client
--                          (buildVocabResolver), not in SQL — an adapter must
--                          be able to resolve with no network.
--                          MEMBER-WRITTEN for workspace rows, exactly like
--                          brand_aliases.sql: this is one shop's record of how
--                          the labels it actually sells are spelled on the
--                          marketplaces it actually uses, and a vocabulary only
--                          admins can extend is not a vocabulary the shop can
--                          keep up to date. FOUNDER-WRITTEN for global rows,
--                          exactly like vocab_tables.sql: those are read by
--                          every tenant.
--
--   workflow_batches       WHICH of the enabled marketplaces THIS batch is for
--     .target_marketplaces (Step 4's toggles, remembered on the batch). A
--                          text[] rather than a join table because it is read
--                          on every batch open, is never queried across
--                          batches, and has at most ten elements. The existing
--                          workflow_batches policies already cover members and
--                          there are no column grants on that table, so this
--                          column needs no new RLS.
--
--   listing_publications   WHAT ACTUALLY HAPPENED: one row per
--                          (listing, marketplace) — draft / exported / posted /
--                          live / sold / removed, plus the marketplace's own id
--                          and url once it has one. This is the cross-listing
--                          matrix, and it is deliberately a RECORD, not a
--                          derivation: removing a marketplace from a batch's
--                          targets must not erase the fact that fourteen
--                          listings went live on it last month.
--                          MEMBER-WRITTEN — it is written by the act of
--                          exporting or posting, which every member does.
--
--
-- THE MARKETPLACE KEY IS THE CONTRACT. The ten values in every CHECK below are
-- MarketplaceKey in src/lib/marketplaces/types.ts, and that file says "Never
-- rename". Adding an eleventh marketplace is a one-line CHECK edit in four
-- places here plus the union there; renaming one is a data migration.
-- ============================================================================


-- ── 0. Shared helpers ───────────────────────────────────────────────────────
-- Declared FIRST: the table below defaults a column to my_email() and
-- constrains one with marketplace_vocab_trim().

-- Shared with kanban_board.sql and brand_aliases.sql; recreated here, byte for
-- byte, so this file can be applied on its own. SECURITY INVOKER, so it is not
-- one of the eight helpers that live in app_private behind a wrapper
-- (AGENTS.md §18 #43) — re-creating it plants nothing and re-raises no linter.
create or replace function public.my_email()
returns text
language sql stable
set search_path = public
as $$
  select lower(coalesce(auth.jwt()->>'email',''))
$$;

grant execute on function public.my_email() to authenticated;

-- THE trimmed form of a canonical value — one definition, used by the CHECK on
-- marketplace_vocab.canonical below.
--
-- Same reasoning as canonical_heard() in brand_aliases.sql, and the same
-- character set: btrim/1 strips U+0020 ONLY, while JavaScript's String.trim()
-- strips the whole Unicode White_Space set. A row stored as E'\tRed' would
-- satisfy a btrim/1-based constraint, take its own slot in the unique index
-- below, and yet never be found by the client — which trims the tab away before
-- it looks. "Remember this mapping" would then find nothing, insert, trip
-- 23505, and report success having changed nothing. The explicit set below is
-- what JS trims: space, tab, LF, CR, FF, VT, NBSP, the line/paragraph
-- separators and the BOM.
--
-- It does NOT lower-case, and that is the difference from canonical_heard():
-- `canonical` is display text the seller reads back ("Forest Green", "Ecko
-- Unltd"), so its capitalisation is kept. Case-insensitive UNIQUENESS is the
-- index's job, one line down.
create or replace function public.marketplace_vocab_trim(t text)
returns text
language sql immutable strict
set search_path = public
as $$
  select btrim($1, E' \t\n\r\f\u000B\u00A0\u2028\u2029\uFEFF')
$$;

grant execute on function public.marketplace_vocab_trim(text) to authenticated;

-- updated_at bookkeeping for all three tables. A trigger fires regardless of
-- the invoking role's EXECUTE privilege, so no client role needs it
-- (AGENTS.md §18 #44); search_path is pinned per §18 #45.
create or replace function public.marketplace_touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke execute on function public.marketplace_touch_updated_at() from public;
revoke execute on function public.marketplace_touch_updated_at() from anon, authenticated;


-- ── 1. org_marketplaces — the workspace's opt-in ────────────────────────────

create table if not exists public.org_marketplaces (
  org_id      uuid not null references public.organizations(id) on delete cascade,
  marketplace text not null check (marketplace in (
    'shopify','ebay','etsy','poshmark','mercari','grailed','depop','facebook','vinted','whatnot')),
  enabled     boolean not null default true,
  -- { pricingRuleId?, defaultCondition?, shippingProfile?, notes? } — see
  -- normalizeMarketplaceSettings() in src/lib/marketplaceService.ts, which is
  -- run on EVERY read. Free-form JSONB on purpose: this shape will grow a field
  -- per connector (an eBay policy id, an Etsy shop section) and a production
  -- migration per field is the wrong price for that. The service is the one
  -- place a malformed or older value is dropped, exactly as
  -- normalizePlatformRules does for description_settings.
  settings    jsonb not null default '{}'::jsonb,
  created_by  uuid references auth.users(id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (org_id, marketplace),
  constraint org_marketplaces_settings_is_object check (jsonb_typeof(settings) = 'object')
);

-- org_id has NO DEFAULT here, unlike every other org-scoped table in this
-- schema, and that is deliberate: the PK is (org_id, marketplace), so the
-- client must send org_id for an upsert to have a conflict target at all.
-- Safety does not come from the default — it comes from is_org_admin(org_id)
-- being both the USING and the WITH CHECK below, which is strictly stronger:
-- default_org_id() only picks A workspace, this proves the caller administers
-- THAT one.

drop trigger if exists org_marketplaces_touch on public.org_marketplaces;
create trigger org_marketplaces_touch
  before update on public.org_marketplaces
  for each row execute function public.marketplace_touch_updated_at();


-- ── 2. marketplace_vocab — what THEY call it ────────────────────────────────

create table if not exists public.marketplace_vocab (
  id                uuid primary key default gen_random_uuid(),
  -- NULL = a GLOBAL row every workspace reads. Not-null = one workspace's
  -- override, which wins. No DEFAULT: a default of default_org_id() would make
  -- "global" unreachable by omission, and the scope is the whole point of the
  -- row, so it is always stated.
  org_id            uuid references public.organizations(id) on delete cascade,
  marketplace       text not null check (marketplace in (
    'shopify','ebay','etsy','poshmark','mercari','grailed','depop','facebook','vinted','whatnot')),
  -- VocabKind in src/lib/marketplaces/types.ts.
  kind              text not null check (kind in ('brand','color','condition','size','category')),
  -- What the app holds: "Ecko Unltd", "Forest Green", "excellent".
  canonical         text not null,
  -- What the marketplace's own picker calls it: "Ecko Unlimited", "Green",
  -- "Good condition". Free text — it is THEIR vocabulary, and constraining it
  -- here would mean a migration every time one of the ten edits a list.
  marketplace_value text not null,
  created_by        uuid references auth.users(id) on delete set null default auth.uid(),
  -- Denormalized for display (auth.users is not client-readable). It DEFAULTS
  -- to the caller's own email because the UPDATE grant below excludes it: a row
  -- inserted without it could otherwise never be backfilled by any client.
  created_by_email  text default nullif(public.my_email(), ''),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint marketplace_vocab_canonical_not_blank check (length(btrim(canonical)) > 0),
  constraint marketplace_vocab_value_not_blank     check (length(btrim(marketplace_value)) > 0),
  -- The form the unique index and the client lookup both assume. See the
  -- header on marketplace_vocab_trim().
  constraint marketplace_vocab_canonical_is_trimmed
    check (canonical = public.marketplace_vocab_trim(canonical))
);

-- The CHECK again, for a table an EARLIER version of this file already created:
-- `create table if not exists` skips the whole statement, so re-running alone
-- would never add it.
do $$
declare collisions int;
begin
  alter table public.marketplace_vocab
    alter column created_by_email set default nullif(public.my_email(), '');

  if not exists (select 1 from pg_constraint
                 where conrelid = 'public.marketplace_vocab'::regclass
                   and conname = 'marketplace_vocab_canonical_is_trimmed') then
    -- Two rows differing only in padding would collapse onto one another once
    -- trimmed. Refuse with an actionable message rather than leave the table
    -- half-migrated: this file is not wrapped in a transaction.
    select count(*) - count(distinct (
             coalesce(org_id, '00000000-0000-0000-0000-000000000000'::uuid),
             marketplace, kind, lower(public.marketplace_vocab_trim(canonical))))
      into collisions from public.marketplace_vocab;
    if collisions > 0 then
      raise exception
        'marketplace_vocab: % row(s) differ only in case or padding. De-duplicate them, then re-run: '
        'select org_id, marketplace, kind, lower(public.marketplace_vocab_trim(canonical)), count(*) '
        'from public.marketplace_vocab group by 1,2,3,4 having count(*) > 1;', collisions;
    end if;
    update public.marketplace_vocab
      set canonical = public.marketplace_vocab_trim(canonical)
      where canonical <> public.marketplace_vocab_trim(canonical);
    alter table public.marketplace_vocab
      add constraint marketplace_vocab_canonical_is_trimmed
      check (canonical = public.marketplace_vocab_trim(canonical));
  end if;
end $$;

-- ONE mapping per (scope, marketplace, kind, canonical), case-insensitively.
-- Two rows for "Forest Green" on Poshmark would make the resolver's answer
-- depend on row order, which is the same failure the Step-3 preset resolver had.
--
-- coalesce(org_id, all-zero uuid) is what makes the GLOBAL rows participate:
-- a plain multi-column unique index would let two NULL-org rows coexist, since
-- NULL is not equal to NULL. The all-zero uuid can never be a real
-- organizations.id (gen_random_uuid() cannot produce it), so it cannot collide
-- with a workspace's rows.
--
-- PostgREST cannot address an EXPRESSION index with onConflict, so the service
-- does find-then-update-else-insert and treats a racing 23505 as a win. The
-- index is the referee, not the mechanism — same as brand_aliases.
create unique index if not exists marketplace_vocab_scope_uidx
  on public.marketplace_vocab (
    coalesce(org_id, '00000000-0000-0000-0000-000000000000'::uuid),
    marketplace, kind, lower(public.marketplace_vocab_trim(canonical))
  );

-- Every read is "the global rows plus my workspace's", filtered by scope.
create index if not exists marketplace_vocab_org_idx on public.marketplace_vocab (org_id);
create index if not exists marketplace_vocab_lookup_idx
  on public.marketplace_vocab (marketplace, kind);

drop trigger if exists marketplace_vocab_touch on public.marketplace_vocab;
create trigger marketplace_vocab_touch
  before update on public.marketplace_vocab
  for each row execute function public.marketplace_touch_updated_at();


-- ── 3. workflow_batches.target_marketplaces — this batch's targets ──────────

alter table public.workflow_batches
  add column if not exists target_marketplaces text[] not null default '{}'::text[];

-- `<@` (contained by) rather than a per-element trigger: it is one index-free
-- array comparison, it accepts the empty array (which is the default and means
-- "no targets chosen yet"), and it rejects a typo'd key before it can reach an
-- adapter lookup that would silently return nothing.
do $$
begin
  if not exists (select 1 from pg_constraint
                 where conrelid = 'public.workflow_batches'::regclass
                   and conname = 'workflow_batches_target_marketplaces_known') then
    alter table public.workflow_batches
      add constraint workflow_batches_target_marketplaces_known
      check (target_marketplaces <@ array[
        'shopify','ebay','etsy','poshmark','mercari','grailed','depop','facebook','vinted','whatnot'
      ]::text[]);
  end if;
end $$;

comment on column public.workflow_batches.target_marketplaces is
  'MarketplaceKey[] (src/lib/marketplaces/types.ts) this batch is being listed on. Chosen in Step 4 from the workspace''s enabled set; empty means none chosen yet.';


-- ── 4. listing_publications — what actually happened ────────────────────────

create table if not exists public.listing_publications (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations(id) on delete cascade
                     default public.default_org_id(),
  -- ON DELETE SET NULL, not CASCADE: deleting a batch must not erase the record
  -- that its listings went live somewhere. Same reasoning as
  -- finance_transactions.org_id.
  batch_id         uuid references public.workflow_batches(id) on delete set null,
  -- The group LEADER's id (AGENTS.md §11, "productGroup — leader convention").
  -- Deliberately NOT a foreign key to products: a leader row can be deleted or
  -- re-created while the listing stays live on the marketplace, and a cascade
  -- there would delete the only record that it was ever posted.
  product_group_id uuid not null,
  -- Denormalized at write time so the matrix reads without a join, and so the
  -- record survives the product row.
  sku              text,
  marketplace      text not null check (marketplace in (
    'shopify','ebay','etsy','poshmark','mercari','grailed','depop','facebook','vinted','whatnot')),
  status           text not null default 'draft' check (status in (
    'draft','exported','posted','live','sold','removed')),
  -- The marketplace's own identifier and public url, once there is one (the
  -- API connectors write these; the pack and feed channels leave them null).
  external_id      text,
  url              text,
  -- Cents, like finance_transactions — the price this listing actually went out
  -- at on THIS marketplace, after that marketplace's price rule.
  price_cents      bigint check (price_cents is null or price_cents >= 0),
  posted_at        timestamptz,
  sold_at          timestamptz,
  created_by       uuid references auth.users(id) on delete set null default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- One publication row per listing per marketplace — that IS the matrix cell.
create unique index if not exists listing_publications_group_marketplace_uidx
  on public.listing_publications (org_id, product_group_id, marketplace);

-- Step 4 reads one batch's matrix; the founder's analytics read one
-- marketplace's live/sold counts.
create index if not exists listing_publications_batch_idx
  on public.listing_publications (org_id, batch_id);
create index if not exists listing_publications_status_idx
  on public.listing_publications (org_id, marketplace, status);

drop trigger if exists listing_publications_touch on public.listing_publications;
create trigger listing_publications_touch
  before update on public.listing_publications
  for each row execute function public.marketplace_touch_updated_at();


-- ── 5. RLS ──────────────────────────────────────────────────────────────────
-- Every helper call is written `(select public.fn())` so Postgres evaluates it
-- ONCE PER STATEMENT as an InitPlan instead of once per row (AGENTS.md §18 #47,
-- perf_rls_initplan.sql). `org_id in (select public.user_org_ids())` is already
-- optimal in that form and is left as it is everywhere else in the schema.

alter table public.org_marketplaces      enable row level security;
alter table public.marketplace_vocab     enable row level security;
alter table public.listing_publications  enable row level security;

grant select, insert, delete
  on public.org_marketplaces, public.marketplace_vocab, public.listing_publications
  to authenticated;

-- UPDATE is granted per COLUMN everywhere. The revoke is what keeps the column
-- grants idempotent: a table-wide UPDATE grant left over from an earlier run
-- would otherwise survive and silently re-open the provenance columns — column
-- grants do not replace a table-wide grant.
revoke update
  on public.org_marketplaces, public.marketplace_vocab, public.listing_publications
  from authenticated;

-- org_marketplaces: the PK columns ARE in the grant, unlike every other table
-- here, and only because PostgREST's upsert compiles to
-- `insert ... on conflict (org_id, marketplace) do update set <every body
-- column>` — without UPDATE on them, enabling an already-enabled marketplace
-- would 42501. It costs nothing: the UPDATE policy's USING proves the caller
-- administers the row's CURRENT workspace and its WITH CHECK proves they
-- administer the new one, so a row can only ever move between two workspaces
-- the same person already administers. created_by / created_at are absent, so
-- provenance is immutable.
grant update (org_id, marketplace, enabled, settings, updated_at)
  on public.org_marketplaces to authenticated;

-- marketplace_vocab: org_id is ABSENT on purpose — a workspace override must
-- never be promoted to a global row (visible to every tenant) by an UPDATE, and
-- a global row must never be captured by a workspace. Changing scope means
-- delete and re-insert, which the policies below judge on its own merits.
grant update (marketplace, kind, canonical, marketplace_value, updated_at)
  on public.marketplace_vocab to authenticated;

-- listing_publications: everything except org_id and provenance. product_group_id
-- and marketplace stay updatable because they are part of the unique triple the
-- service's find-then-update addresses.
grant update (batch_id, product_group_id, sku, marketplace, status,
              external_id, url, price_cents, posted_at, sold_at, updated_at)
  on public.listing_publications to authenticated;


-- 5a. org_marketplaces — members read, ADMINS write ──────────────────────────
-- Read is membership, because Step 4 and the readiness checklist run for every
-- member; write is is_org_admin, because enabling a marketplace changes what
-- the whole shop is asked to publish to.

drop policy if exists org_marketplaces_select on public.org_marketplaces;
drop policy if exists org_marketplaces_insert on public.org_marketplaces;
drop policy if exists org_marketplaces_update on public.org_marketplaces;
drop policy if exists org_marketplaces_delete on public.org_marketplaces;

create policy org_marketplaces_select on public.org_marketplaces for select
  to authenticated
  using (org_id in (select public.user_org_ids()));

create policy org_marketplaces_insert on public.org_marketplaces for insert
  to authenticated
  with check (
    (select public.is_org_admin(org_id))
    and (created_by is null or created_by = (select auth.uid()))
  );

create policy org_marketplaces_update on public.org_marketplaces for update
  to authenticated
  using ((select public.is_org_admin(org_id)))
  with check ((select public.is_org_admin(org_id)));

create policy org_marketplaces_delete on public.org_marketplaces for delete
  to authenticated
  using ((select public.is_org_admin(org_id)));


-- 5b. marketplace_vocab — two scopes, two rules ──────────────────────────────
-- SELECT: the global rows are readable by every signed-in user (every workspace
--   consumes them, exactly like descriptor_chips / brand_keywords in
--   vocab_tables.sql) plus my own workspace's overrides. Another workspace's
--   overrides are invisible.
-- WRITE: a global row (org_id null) is founder chrome — is_beta_admin(). A
--   workspace row is ANY MEMBER, with no admin gate, for the reason written at
--   the top of brand_aliases.sql: it is the shop's own record of its own
--   inventory, and the person who hits "remember this mapping" in Step 3 is
--   whoever is dictating, not whoever happens to be an admin.

drop policy if exists marketplace_vocab_select on public.marketplace_vocab;
drop policy if exists marketplace_vocab_insert on public.marketplace_vocab;
drop policy if exists marketplace_vocab_update on public.marketplace_vocab;
drop policy if exists marketplace_vocab_delete on public.marketplace_vocab;

create policy marketplace_vocab_select on public.marketplace_vocab for select
  to authenticated
  using (org_id is null or org_id in (select public.user_org_ids()));

-- The authorship pins are the same ones brand_aliases.sql carries: "any member
-- can edit any row" must not become "any member can sign a row as the founder".
create policy marketplace_vocab_insert on public.marketplace_vocab for insert
  to authenticated
  with check (
    (
      (org_id is null and (select public.is_beta_admin()))
      or org_id in (select public.user_org_ids())
    )
    and (created_by is null or created_by = (select auth.uid()))
    and (created_by_email is null or lower(created_by_email) = (select public.my_email()))
  );

create policy marketplace_vocab_update on public.marketplace_vocab for update
  to authenticated
  using (
    (org_id is null and (select public.is_beta_admin()))
    or org_id in (select public.user_org_ids())
  )
  with check (
    (org_id is null and (select public.is_beta_admin()))
    or org_id in (select public.user_org_ids())
  );

create policy marketplace_vocab_delete on public.marketplace_vocab for delete
  to authenticated
  using (
    (org_id is null and (select public.is_beta_admin()))
    or org_id in (select public.user_org_ids())
  );


-- 5c. listing_publications — org membership, all four verbs ──────────────────
-- Any member, because the row is written by the act of exporting a feed,
-- copying a pack or pressing publish — all of which are ordinary work.

drop policy if exists listing_publications_select on public.listing_publications;
drop policy if exists listing_publications_insert on public.listing_publications;
drop policy if exists listing_publications_update on public.listing_publications;
drop policy if exists listing_publications_delete on public.listing_publications;

create policy listing_publications_select on public.listing_publications for select
  to authenticated
  using (org_id in (select public.user_org_ids()));

-- NULL org_id is never "in (...)", so the DEFAULT above is effectively
-- mandatory: a client cannot insert an untagged row, and a user with no
-- workspace at all (default_org_id() → NULL) is refused outright.
create policy listing_publications_insert on public.listing_publications for insert
  to authenticated
  with check (
    org_id in (select public.user_org_ids())
    and (created_by is null or created_by = (select auth.uid()))
  );

create policy listing_publications_update on public.listing_publications for update
  to authenticated
  using (org_id in (select public.user_org_ids()))
  with check (org_id in (select public.user_org_ids()));

create policy listing_publications_delete on public.listing_publications for delete
  to authenticated
  using (org_id in (select public.user_org_ids()));


-- ── VERIFY (run separately, AS A SIGNED-IN MEMBER, not as the table owner) ───
-- org_id on listing_publications defaults to default_org_id(), which is NULL
-- without a JWT, so an owner-run insert fails 23502 before reaching any policy.
--
--   -- Cross-org leak checks — all three must return 0:
--   select count(*) from public.org_marketplaces
--     where org_id not in (select public.user_org_ids());
--   select count(*) from public.marketplace_vocab
--     where org_id is not null and org_id not in (select public.user_org_ids());
--   select count(*) from public.listing_publications
--     where org_id not in (select public.user_org_ids());
--
--   -- A NON-ADMIN member must NOT be able to enable a marketplace. This must
--   -- FAIL with 42501 (new row violates row-level security policy):
--   insert into public.org_marketplaces (org_id, marketplace)
--     values ((select public.default_org_id()), 'ebay');
--   -- ... and an ADMIN of the same workspace must succeed with the same line.
--
--   -- A non-founder must NOT be able to write a GLOBAL vocabulary row —
--   -- 42501:
--   insert into public.marketplace_vocab (org_id, marketplace, kind, canonical, marketplace_value)
--     values (null, 'poshmark', 'color', 'Forest Green', 'Green');
--   -- ... while the same row scoped to their own workspace succeeds:
--   insert into public.marketplace_vocab (org_id, marketplace, kind, canonical, marketplace_value)
--     values ((select public.default_org_id()), 'poshmark', 'color', 'Forest Green', 'Green');
--
--   -- One mapping per scope, case-insensitively — the second must FAIL 23505:
--   insert into public.marketplace_vocab (org_id, marketplace, kind, canonical, marketplace_value)
--     values ((select public.default_org_id()), 'poshmark', 'color', 'forest green', 'Multi');
--
--   -- Untrimmed canonical — must FAIL 23514 (canonical_is_trimmed), including
--   -- the non-ASCII whitespace btrim/1 alone would let through:
--   insert into public.marketplace_vocab (org_id, marketplace, kind, canonical, marketplace_value)
--     values ((select public.default_org_id()), 'depop', 'brand', '  Ecko ', 'Ecko Unltd');
--   insert into public.marketplace_vocab (org_id, marketplace, kind, canonical, marketplace_value)
--     values ((select public.default_org_id()), 'depop', 'brand', E'\tEcko', 'Ecko Unltd');
--
--   -- Scope is immutable (org_id outside the UPDATE grant) — must FAIL 42501:
--   update public.marketplace_vocab set org_id = null where true;
--   -- ... while an ordinary edit succeeds:
--   update public.marketplace_vocab set marketplace_value = 'Dark Green' where true;
--
--   -- An unknown marketplace key on a batch — must FAIL 23514:
--   update public.workflow_batches set target_marketplaces = '{tiktok}' where true;
--   -- ... while a known set succeeds:
--   update public.workflow_batches set target_marketplaces = '{ebay,depop}' where true;
--
--   -- One publication per listing per marketplace — the second must FAIL 23505:
--   insert into public.listing_publications (product_group_id, marketplace, status)
--     values ('11111111-1111-1111-1111-111111111111', 'ebay', 'exported');
--   insert into public.listing_publications (product_group_id, marketplace, status)
--     values ('11111111-1111-1111-1111-111111111111', 'ebay', 'posted');
--
--   -- The indexes exist:
--   select indexname from pg_indexes
--    where indexname in ('marketplace_vocab_scope_uidx',
--                        'listing_publications_group_marketplace_uidx');

-- ── ROLLBACK ────────────────────────────────────────────────────────────────
-- my_email() is shared with kanban_board.sql and brand_aliases.sql and is
-- deliberately NOT dropped. The workflow_batches column is dropped LAST so a
-- partial rollback leaves the app in the pre-migration state rather than with a
-- column whose CHECK is gone.
--
-- drop table if exists public.listing_publications;
-- drop table if exists public.marketplace_vocab;
-- drop table if exists public.org_marketplaces;
-- drop function if exists public.marketplace_vocab_trim(text);
-- drop function if exists public.marketplace_touch_updated_at();
-- alter table public.workflow_batches drop constraint if exists workflow_batches_target_marketplaces_known;
-- alter table public.workflow_batches drop column if exists target_marketplaces;
