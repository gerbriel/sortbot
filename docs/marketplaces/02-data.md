# Multi-marketplace, phase 1 — the data and the workspace half

What this pass built: the migration, the Database types, `src/lib/marketplaceService.ts`
(+ 58 tests), two small additions to `workflowBatchService`, and the Workspace
dashboard's **Marketplaces** tab. It is the "where do you sell / what do they call
things / where has this listing been" half of `00-plan.md` §2b, §2c and §4. The
adapters (`src/lib/marketplaces/*`) and Step 4 are a separate pass and consume this.

**No SQL was run against Supabase.** `supabase/migrations/marketplaces.sql` is written,
verified on a throwaway Postgres 14, and not applied — the standing order (§16).

---

## 1. Files

| File | What |
|---|---|
| `supabase/migrations/marketplaces.sql` | **NEW, NOT RUN.** `org_marketplaces`, `marketplace_vocab`, `workflow_batches.target_marketplaces`, `listing_publications`. Additive, idempotent, rollback at the bottom. |
| `src/lib/supabase.ts` | Database types for the three new tables. |
| `src/lib/marketplaceService.ts` | All four reads/writes + the pure helpers. **NEW.** |
| `src/lib/marketplaceService.test.ts` | 58 tests. **NEW.** |
| `src/lib/workflowBatchService.ts` | `target_marketplaces` added to `WORKFLOW_BATCH_RESTORE_COLUMNS` and to `WorkflowBatch` (optional). Two lines plus comments. |
| `src/components/OrgPanel.tsx` / `.css` | The **Marketplaces** tab. |

---

## 2. Schema rationale

### `org_marketplaces` — the workspace's opt-in, and the only ADMIN-gated table here

PK `(org_id, marketplace)`. A workspace enables a marketplace at most once, and that
*is* the rule — so there is no surrogate id and no unique index that could drift from it.

**`org_id` carries no DEFAULT**, which is the one place this schema departs from the
`default_org_id()` convention every other org-scoped table follows. It has to: `org_id`
is half the primary key, so PostgREST's upsert has no conflict target without it. Safety
does not come from the default anyway — it comes from `is_org_admin(org_id)` being both
the `USING` and the `WITH CHECK`, which is *stronger*: `default_org_id()` picks **a**
workspace, this proves the caller administers **that** one. Verified as S6 below (an
admin of Shop A cannot write a row for Shop B).

**Admin-gated deliberately.** Turning a marketplace on changes what every member is asked
to publish to and commits the shop to a place it will be judged on. That is a workspace
decision. Contrast `marketplace_vocab` below and `listing_labels.sql`, which are
member-written for the opposite reason.

**The PK columns are in the UPDATE grant**, unlike every other table in this schema. Only
because PostgREST compiles an upsert to `on conflict (…) do update set <every body
column>`, and without UPDATE on `org_id`/`marketplace` "enable an already-enabled
marketplace" would 42501. It costs nothing: `USING` proves the caller administers the
row's current workspace and `WITH CHECK` proves they administer the new one, so a row can
only move between two workspaces the same person already administers. `created_by` and
`created_at` are absent, so provenance stays immutable.

**`settings` is free JSONB** (`{ pricingRuleId?, defaultCondition?, shippingProfile?,
notes? }`) with a `jsonb_typeof = 'object'` CHECK and nothing more. This shape will grow a
field per connector (an eBay policy id, an Etsy shop section), and a production migration
per field is the wrong price. `normalizeMarketplaceSettings()` runs on **every** read and
every write — the same discipline `normalizePlatformRules` applies to
`description_settings`, and for the same reason: it feeds a money path.

**`pricingRuleId` POINTS AT a rule** in `organizations.description_settings.platformPricing`
rather than copying the numbers. One markup, one place to edit it. When the id no longer
resolves the UI says so in `--warning` instead of silently exporting at list price — a quiet
fallback there is how a listing goes out at the wrong number.

### `marketplace_vocab` — two scopes in one table

`org_id NULL` is a **global** row (founder-curated, seeded from each marketplace's own
published lists); a set `org_id` is that workspace's **override**, and the override wins.
One table rather than two because every read wants both and the resolver has to merge them
anyway; the scope is one nullable column and one line in each policy.

**Member-written for workspace rows, with no admin gate**, copying `brand_aliases.sql`
verbatim in reasoning: this is one shop's record of how the labels it actually sells are
spelled on the marketplaces it actually uses, and the person who will hit "remember this
mapping" in Step 3 is whoever is dictating, not whoever happens to be an admin. A
vocabulary only admins can extend is not a vocabulary the shop can keep current.
**Founder-written for global rows** (`is_beta_admin()`), copying `vocab_tables.sql`: those
are read by every tenant.

**Authorship is pinned and immutable.** "Any member can edit any row" must not become "any
member can sign a row as the founder": the INSERT policy pins `created_by` to `auth.uid()`
and `created_by_email` to the caller's own JWT email, and the column-level UPDATE grant
omits both — plus `org_id`, so a workspace override can never be *promoted* to a global row
(visible to every tenant) by an edit, and a global row can never be captured by a workspace.
Changing scope means delete and re-insert, which the policies judge on its own merits.

**Uniqueness is `(coalesce(org_id, all-zero uuid), marketplace, kind, lower(trim(canonical)))`.**
Two rows for "Forest Green" on Poshmark would make the resolver's answer depend on row order
— the same failure the Step-3 preset resolver had. The `coalesce` is what makes the global
rows participate at all: a plain multi-column unique index lets two NULL-org rows coexist,
because NULL is not equal to NULL. `gen_random_uuid()` cannot produce the all-zero uuid, so
it can never collide with a real workspace.

**The `canonical_is_trimmed` CHECK** is what makes that index trustworthy, and it is the
`brand_aliases.sql` argument again: `btrim/1` strips U+0020 only, while JavaScript's
`.trim()` strips the whole Unicode White_Space set. A row stored as `E'\tRed'` would satisfy
a `btrim/1`-based constraint, take its own index slot, and never be found by the client —
so "re-point this mapping" would find nothing, insert, trip 23505, and report success having
changed nothing. `marketplace_vocab_trim()` strips exactly what JS strips. It does **not**
lower-case (the difference from `canonical_heard()`): `canonical` is display text the seller
reads back, so its capitalisation is kept and case-insensitive uniqueness is the index's job.

### `workflow_batches.target_marketplaces`

`text[] not null default '{}'` plus a `<@` CHECK against the ten keys. An array rather than
a join table because it is read on every batch open, is never queried across batches, and
has at most ten elements. `<@` is one index-free comparison, accepts the empty array, and
rejects a typo'd key before it can reach an adapter lookup that would silently return
nothing. No new RLS: the existing `workflow_batches` policies cover members and that table
has no column grants.

### `listing_publications` — a record, not a derivation

Unique on `(org_id, product_group_id, marketplace)` — that triple *is* the matrix cell.
It is deliberately a record: removing a marketplace from a batch's targets must not erase
the fact that fourteen listings went live on it last month.

- `batch_id` is `on delete set null`, not cascade — deleting a batch must not delete the
  proof its listings were published. Verified as S29.
- **`product_group_id` is NOT a foreign key.** The group leader's `products` row can be
  deleted or re-created while the listing stays live on the marketplace, and a cascade
  there would destroy the only record that it was ever posted. `sku` is denormalized at
  write time for the same reason, and so the matrix renders without a join.
- `org_id` DOES carry `default default_org_id()` here (unlike `org_marketplaces`) and the
  client never sends it — there is no composite key forcing its hand, so the ordinary rule
  applies. `upsertPublication` is find-then-update precisely so it never has to.
- Member-written on all four verbs: the row is created by the act of exporting a feed,
  copying a pack or pressing publish, which is ordinary work.

### Function privileges (§18 #43–#47)

Three functions, all placed by the standing rules:

| Function | Where | EXECUTE |
|---|---|---|
| `public.my_email()` | `public`, SECURITY **INVOKER** | `authenticated` — re-created byte for byte from `brand_aliases.sql` / `kanban_board.sql` so this file applies on its own. Not one of the eight `app_private`-wrapped helpers, so re-creating it plants nothing (§18 #43). |
| `public.marketplace_vocab_trim(text)` | `public`, SECURITY **INVOKER**, `immutable strict`, `search_path` pinned | `authenticated` — a CHECK constraint runs as the invoking role. |
| `public.marketplace_touch_updated_at()` | `public`, trigger, `search_path` pinned | **revoked from PUBLIC, anon and authenticated** — a trigger fires without the invoking role's EXECUTE (§18 #44). |

Every policy helper call is written `(select public.…())` so it evaluates once per
statement as an InitPlan (§18 #47). No SECURITY DEFINER function is added, so
`security_function_hardening.sql` / `security_rpc_wrappers.sql` need no re-run for this
file — but note the standing rule that replaying `multi_org_tenancy.sql` does.

---

## 3. Service API (`src/lib/marketplaceService.ts`)

Forward-compatible in the house style: every read reports `'unavailable'` pre-migration and
the UI hides itself. 58 tests, driven by `src/lib/testing/supabaseMock.ts`.

| Export | Kind | Notes |
|---|---|---|
| `fetchOrgMarketplaces(orgId)` | read | `{ status:'ok', rows } \| { status:'unavailable' }`. Named columns, never `select(*)`. Drops a row whose key this build does not know. |
| `setMarketplaceEnabled(orgId, key, enabled)` | write | Upsert on `org_id,marketplace`. Maps 42501 → "only a workspace admin can…", 42P01/PGRST205 → the setup message. |
| `updateMarketplaceSettings(orgId, key, settings)` | write | Normalised before the write as well as after the read. |
| `normalizeMarketplaceSettings(json)` | **pure** | Keeps four keys, trims, caps notes at 500, drops everything else. |
| `fetchVocab(orgId)` | read | **Two queries**, globals first. Not one `.or()`: PostgREST's `or` is a server-parsed filter expression, so a workspace id becomes part of a mini-language rather than a bound parameter — and two plain filters keep the halves separable for the scope badges. |
| `upsertVocab({ orgId \| null, … })` | write | **Find-then-update-else-insert.** The uniqueness is an EXPRESSION index, which PostgREST cannot address with `onConflict`; a racing 23505 is treated as a win. The find reads the (scope, marketplace, kind) slice and matches in JS, because only the JS side knows the full Unicode trim rule. |
| `updateVocab(id, canonical, value)` | write | Edits **by row id**. Separate from `upsertVocab` on purpose: that one keys on the canonical value, so using it to *rename* one would find nothing under the new spelling, insert, and leave the old row beside it. A 23505 is reported, never merged — folding two rows together would discard the other's marketplace value. 0 rows is a failure. |
| `deleteVocab(id)` | write | |
| `canonicalizeVocabValue(raw)` | **pure** | `.trim()` — the client half of the SQL CHECK. Never lower-cases. |
| `buildVocabResolver(rows)` | **pure** | Returns the contract's `VocabResolver`. Workspace beats global; `brand` folds through `normalizeBrand` (so Step 3's spelling memory and this agree); other kinds fold case and runs of whitespace and nothing else — `2X` and `2 X` stay different sizes. **A no-match returns null and never guesses**, which is the whole point of §2c. |
| `readBatchTargets(row)` | **pure** | Filters unknown keys, de-duplicates, keeps order. A pre-migration batch has no column at all — that is `[]`, not a crash. |
| `setBatchTargets(batchId, keys)` | write | Validates keys first (a readable message beats a 23514), writes in `MARKETPLACE_KEYS` order so two people toggling the same set store the same row, and **treats 0 rows updated as a failure** (§18 #41 / `updateProduct`). |
| `fetchPublications(orgId, batchId?)` | read | |
| `upsertPublication({…})` | write | Find-then-update on the unique triple. **Only the fields supplied are written** — a feed export knows the status and price, a connector later fills `external_id`/`url`, and neither may blank what the other wrote. An explicit `null` IS written; an omitted key is not. |
| `markPublicationStatus(id, status)` | write | Checked row count. |
| `publicationMatrix(rows)` | **pure** | `Map<productGroupId, Map<MarketplaceKey, row>>`, insertion order preserved. |
| `MARKETPLACE_NAMES` / `marketplaceName(key)` | data | The one place a display name comes from; a test asserts it covers every key in the contract. |

`workflowBatchService` gained exactly two things: `'target_marketplaces'` in
`WORKFLOW_BATCH_RESTORE_COLUMNS` (Step 4 needs it the moment a batch opens) and an
**optional** `target_marketplaces?: string[]` on `WorkflowBatch`. Optional is load-bearing:
the column does not exist until the migration runs.

---

## 4. The Marketplaces tab

Workspace dashboard → **Marketplaces**, visible to every member.

- **Where you sell** — one card per marketplace (all ten, so the list reads as a complete
  inventory rather than shrinking as you use it), an enabled switch, and for enabled ones a
  price-rule `<select>` from `selectablePlatforms(descriptionSettings.platformPricing)` and a
  default-condition `<select>` over `CONDITION_GRADES`. Admins edit; members see the same
  cards with the controls disabled and one line saying why. Writes are optimistic-then-
  reconciled: the row is re-read after each change, and a refusal puts the old value back
  with a notice, so the UI never lies about what is stored.
- **Marketplace vocabulary** — the workspace's mappings (marketplace · field · scope badge ·
  `canonical → marketplace value`) with add, inline edit and the two-step `org-confirm-yes/no`
  delete, filterable by marketplace. Founding admins additionally see the GLOBAL rows with the
  same editor and an "all workspaces" badge, and get a checkbox to write one.
- **Pre-migration** the whole tab is the standing `ft-setup` hint naming `marketplaces.sql`.

Reuses OrgPanel's existing `.plat-*`, `.org-tab`, `.org-icon-btn`, `.org-confirm-*`,
`.ft-setup` and `.shopify-conn-help` classes; the new `.mkt-*` rules are only what the
vocabulary list needs. Phone block at `<= 640px`: one column, 44px targets, `--fs-md` (16px)
controls, and the arrow between two stacked inputs hidden because it is noise there.

The description-settings fetch, previously `if (!isAdmin) return`, now runs for every member:
the tab shows each marketplace's price rule **by name**, and those names live in that JSONB.
`organizations` SELECT has always been membership-scoped, so it reads nothing a member could
not already read.

---

## 5. Verification — throwaway PostgreSQL 14.21, port 55491

Applied in order: stub `auth`/`storage` schema → `multi_org_tenancy.sql` →
`beta_signups.sql` → `org_description_settings.sql` → `marketplaces.sql`. Two gaps the
stub has that real Supabase does not were filled by hand (table grants to `authenticated`
on the five data tables, and `enable row level security` on `workflow_batches`) — both are
stub artifacts, not migration behaviour.

Fixture: **Shop A** (an admin and an ordinary member), **Shop B** (a member), the
**Founding Workspace** (a founder), and one batch in each shop. Every scenario runs as a
signed-in user via `set local role authenticated` plus `request.jwt.claims`.

| # | Scenario | Result |
|---|---|---|
| S1 | Admin of Shop A enables `ebay` + `depop`, settings stored, `created_by` signed | 2 rows |
| S2 | An ordinary MEMBER of Shop A reads them — read is membership, not admin | 2 rows |
| S3 | A member of Shop B sees none of them | 0 |
| S4 | A non-admin member INSERTs a marketplace | **42501** RLS |
| S4b | ... and their UPDATE / DELETE affect 0 rows (refused by `USING`) | `UPDATE 0` / `DELETE 0` |
| S5 | An admin can, and PostgREST's `on conflict … do update set` shape works on the composite PK | 3 rows |
| S6 | An admin of Shop A enables something for Shop B | **42501** RLS |
| S7 | An ORDINARY MEMBER writes workspace vocab rows — no admin gate — and `created_by_email` defaults to their own | 2 rows |
| S8 | Another workspace sees none of them | 0 |
| S9 | A non-founder writes a GLOBAL row (`org_id null`) | **42501** RLS |
| S10 | A founder writes the same rows | 2 rows |
| S11 | Every workspace reads the globals (Shop B, which has no overrides) | 2 rows |
| S12 | Shop A sees globals + its own overrides — the input `buildVocabResolver` merges | 4 rows |
| S13 | A non-founder edits or deletes a global row | `UPDATE 0` / `DELETE 0`, globals intact |
| S14 | Same canonical, different CASE, same scope | **23505** `marketplace_vocab_scope_uidx` |
| S15 | Two GLOBAL rows collide too — `coalesce(org_id, all-zero uuid)` is what makes NULLs compare | **23505** |
| S16 | Same canonical on another marketplace / for another field | allowed, 4 rows |
| S17 | Untrimmed canonical, ASCII space | **23514** `canonical_is_trimmed` |
| S18 | Untrimmed canonical, TAB — what `btrim/1` alone would have let through | **23514** |
| S19 | Blank `marketplace_value` | **23514** `value_not_blank` |
| S19b | `update … set org_id = null` (scope immutable) | **42501** column grant |
| S19c | `update … set created_by_email = …` (authorship immutable) | **42501** column grant |
| S19d | An ordinary edit succeeds and the touch trigger moves `updated_at` | `UPDATE 1`, `touched = t` |
| S20 | `target_marketplaces = '{tiktok}'` | **23514** `target_marketplaces_known` |
| S21 | `'{ebay,tiktok}'` — one bad key rejects the whole array | **23514** |
| S22 | `'{ebay,depop}'` stored; the `'{}'` default was already valid | `UPDATE 1` |
| S23 | Shop B still sees only its own batch and cannot write Shop A's | 1 row, `UPDATE 0` |
| S24 | A member records two cells; `org_id` comes from the DEFAULT, never the client | 2 rows, `tagged_by_default = t` |
| S25 | The same (listing, marketplace) twice | **23505** `group_marketplace_uidx` |
| S26 | Another workspace may hold the same group id on the same marketplace | 1 row |
| S27 | Shop A still sees only its own two | 2 rows |
| S28 | `status = 'shipped'` | **23514** closed vocabulary |
| S28b | `price_cents = -1` | **23514** |
| S28c | `update … set org_id = <other org>` | **42501** column grant |
| S29 | Deleting the BATCH keeps the publication record (`on delete set null`) | 2 rows, `batch_gone = t` |
| S30 | Idempotent re-apply — data and policy counts unchanged | 3 / 6 / 3 rows, 12 policies, before and after |
| S31 | UPGRADE PATH: a table left by an earlier version of the file (no CHECK, no default, an untrimmed row) — the DO block canonicalises the row and restores the CHECK and the default | `[  Stussy \t]` → `[Stussy]`, CHECK restored |
| S32 | COLLISION REFUSAL: two rows differing only in padding with no CHECK and no unique index — the file refuses with the de-duplication query rather than leaving the table half-migrated, and applies cleanly after the repair | raised, then `exit=0` |
| S33 | ROLLBACK (the commented block, verbatim) then RE-APPLY | tables `(none)`, column `false`, both marketplace functions dropped, **`my_email()` kept** (shared); re-apply → 3 tables, 12 policies, column back |

### Not verified

- **Nothing was run against Supabase.** The real database has policies this stub does not
  (the dashboard's permissive `storage.objects` policy, `perf_rls_initplan.sql`'s rewrites),
  and `workflow_batches` RLS was enabled by hand here.
- **The tab has not been seen in a signed-in browser** — same standing gap as the mobile pass
  (§14 #26). It was type-checked and built; the layout was written against OrgPanel's existing
  classes rather than rendered.
- The `settings.shippingProfile` field is stored and normalised but nothing reads it yet; it
  exists because the plan's connector phase needs it and adding a JSONB key later is free.

---

## 6. Gates

`npx vitest run` — **1347 passed / 60 files**, of which this pass adds **58 tests in 1 file**
(`marketplaceService.test.ts`); the rest of the delta from the 1158 baseline is the concurrent
adapter pass. `npm run build` clean. `npx eslint .` — **252 problems**, exactly the recorded
baseline: this pass removed one `@typescript-eslint/no-explicit-any` (the `settings` JSONB is
typed `Record<string, unknown>`, which a `jsonb_typeof = 'object'` CHECK makes the true type)
and added none.

## 7. Open questions

1. **Seeding the global vocabulary.** The tables are here and empty. The colour and condition
   lists are small and public; the brand lists are not, and the plan proposes seeding them from
   the built-in 917-brand library by normalised match. That is a data pass, and it should be a
   `scripts/` one-off a human runs, not a migration.
2. **Where "remember this mapping" lives.** §2c wants it on the Step 4 readiness warning, the
   same shape as the Step 3 brand-spelling notice. `upsertVocab` is the write it needs; the
   surface belongs to the Step 4 pass.
3. **Whether a batch's targets should DEFAULT to every enabled marketplace.** §2b says they
   should, on first open. `setBatchTargets` can express it; who calls it, and whether an
   explicit empty set must survive a reopen, is a Step 4 decision — today `'{}'` means
   "none chosen yet" and nothing distinguishes it from "none, deliberately".

## 8. Global vocabulary seed — resolved (15 Sept 2026)

§7.1 asked who seeds the global rows. Answer: a generator, not a migration and not a hand list.
`scripts/seed-marketplace-vocab.ts` reads the adapters' own `spec.color.values` and
`spec.condition.map` plus `COLOR_DNA`, and writes `supabase/seeds/marketplace_vocab.sql`
(`npm run seed:vocab`). It is bundled for Node by `scripts/vite.seed.config.ts`, which aliases the
debug logger (touches `window` at import) and the Supabase client (throws without env) to
`scripts/stubs/` — both are reached through `vocabService.ts` and neither is used by the seed.

What it writes (859 rows): for the two marketplaces with a fixed colour list, every colour name and
alias in the app's colour database mapped to the closest list word through one ordered candidate
table (`forest green → Green`, `olive → Khaki` on Vinted, `charcoal → Gray`, `tie dye → Multi`),
skipping identity rows because the adapter already matches the list itself; and for all ten, the
loose condition phrasings the normaliser does not read (`beat up`, `barely worn`, `sealed`,
`well loved`…) mapped through each adapter's condition map. Brands are deliberately not seeded.

Verified on a throwaway Postgres 14: applied after `marketplaces.sql` with no errors, applied a second
time as a no-op (`on conflict` against the expression index resolves), 859 rows both times.

