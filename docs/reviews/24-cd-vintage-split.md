# 24 — Splitting C&D Vintage out of the Founding Workspace

**Request (Sept 19 2026).** "CJ has 2 emails. Move the founding account
thecreatendestroy@gmail.com into a preseeded workspace called C&D Vintage, and move
all his libraries and info over to that workspace so he will be a tenant there with
his business. His cjdub2004@icloud.com email will remain on the founding workspace so
he can test how demo users experience the workspace, in comparison to founding
workspace admins."

**Deliverables.** Two SQL files, both written, both verified on a throwaway Postgres,
**neither run against Supabase** — that is the founder's step, and this document is the
runbook for it.

| File | What it is | Run it? |
|---|---|---|
| `supabase/migrations/tenant_scoped_uniqueness.sql` | A real migration: category names and preset category_names become unique **per workspace** instead of across the whole database. | Yes, first. Every environment needs it — it fixes a bug that empties every new tenant's Step 2. |
| `supabase/oneoff/split_cd_vintage.sql` | The one-off: creates C&D Vintage, moves CJ's account and his work into it, copies the shared vocabulary across, re-points the rows that follow the account. | Yes, second, after reading its PREVIEW. It refuses to run until the migration has. |

No client code changed for the split itself. One line in `App.tsx` was changed in the
onboarding pass that shipped alongside (`docs/reviews/23-onboarding.md`): the Founding
Workspace's hard-coded `'C&D Vintage'` Vendor fallback is gone, so it now exports under
its own name, and C&D Vintage exports under the `vendorName` this script pins.

---

## 1. The bug that had to be fixed first

The plan was simple: copy the Founding Workspace's categories and presets into the new
workspace so it opens "preseeded". Writing the copy surfaced this:

```
supabase/migrations/convert_to_shared_collaborative_FIXED.sql:99
  ALTER TABLE public.categories ADD CONSTRAINT categories_name_key UNIQUE (name);
supabase/migrations/category_presets.sql:10
  category_name TEXT NOT NULL UNIQUE,
```

Both constraints date from the single-workspace era, and `multi_org_tenancy.sql` added
`org_id` and per-workspace RLS to both tables without touching them. So the **namespace is
still global**: because the Founding Workspace holds a category named `tees`, no other
workspace can. That is not only a problem for this copy —

- `categoriesService.initializeDefaultCategories()` (the seed `ensureOrganization` runs for
  every new workspace) inserts one row at a time and **ignores the error**, so an approved
  beta shop signs in, the seed fires, every insert hits `categories_name_key`, and Step 2
  opens with nothing to categorise into.
- `createCategoryPreset` already works around the presets half by appending a random suffix
  to every `category_name` it mints — which is *why* that suffix exists.

Verified on the throwaway cluster with the old constraints installed: a second workspace
inserting `tees` fails with `duplicate key value violates unique constraint
"categories_name_key"`.

### The fix — `tenant_scoped_uniqueness.sql`

Drops the global constraints (looked up by **shape** — a unique index on exactly that one
column — not by name, since the older files were run by hand) and creates four partial
unique indexes:

| Index | Columns | Where |
|---|---|---|
| `categories_org_name_uidx` | `(org_id, name)` | `org_id is not null` |
| `category_presets_org_name_uidx` | `(org_id, category_name)` | `org_id is not null` |
| `categories_global_name_uidx` | `(name)` | `org_id is null` |
| `category_presets_global_name_uidx` | `(category_name)` | `org_id is null` |

Semantics are otherwise byte-identical to the old constraints (case-sensitive, exact
match), so no existing row can fail them — global uniqueness is a superset of
per-workspace uniqueness. The `create index` calls still catch `unique_violation` and
downgrade to a NOTICE naming the query to run. No policy, function, column or RLS changes;
the client needs no change — the seed that used to fail silently now succeeds.

### The guard — in the split script

Step 1.2 of the one-off inspects `pg_index` for a non-partial unique index on exactly
`categories(name)` or `category_presets(category_name)` and refuses with:

```
Refusing: category names are still unique across the WHOLE database.
Run supabase/migrations/tenant_scoped_uniqueness.sql first, then re-run this script.
```

— before it has created or moved anything. Verified: under the old constraint the org
count is unchanged after the refusal.

---

## 2. What the split does, and the decisions in it

1. **Creates "C&D Vintage"** — plan `beta` (founding pricing for life), slug `cd-vintage`
   (the idempotency key; the app never reads slugs other than `founding`), `created_by` =
   CJ's account (so `ensureOrganization`'s creator-repair branch agrees with reality), and
   the Founding Workspace's `description_settings` copied across with **`vendorName`
   pinned to "C&D Vintage"** — the platform pricing rules travel with it, so marketplace
   opt-ins that point at a rule id still resolve.
2. **Membership** — CJ's gmail becomes **owner** of the new workspace and leaves the
   Founding Workspace. The script records the role he had there and prints it, because the
   rollback restores it. It refuses outright if that removal would leave the Founding
   Workspace with no owner or admin (AGENTS.md §18 #16's lock-out rail), and it asserts at
   the end that **cjdub2004@icloud.com is still a founding member** — that account is not
   touched by design.
3. **His work moves by BATCH, not by uploader.** Batches he created move; every product in
   those batches moves *whoever uploaded it* (the fixture has a founder-uploaded product
   inside a CJ batch, and it moves); every image of those products moves; his unassigned
   products (Library "Unassigned") move. Batches other people created stay — including the
   icloud account's. A batch is therefore never split across two workspaces, which the
   VERIFY section checks with two queries that must return zero rows.
   - The PREVIEW (section 0) prints per-creator counts first. If it shows that other
     founding members uploaded C&D's inventory under their own accounts,
     `v_move_all_founding_batches := true` moves **every** batch in the Founding Workspace
     instead, and the Founding Workspace starts over as a demo with no batches. Verified in
     a rolled-back transaction: 4 batches / 6 products move; the one product left behind is
     a founder's unassigned orphan.
4. **Shared vocabulary is COPIED, never moved** — both workspaces keep needing it, and a
   copy is what "preseeded" means: categories and presets (column lists read from
   `information_schema`, so the copy carries every column the table has), marketplace
   opt-ins (with their settings), workspace marketplace vocabulary, brand aliases, listing
   labels. Copies are `on conflict do nothing`, and categories/presets copy only into an
   **empty** new workspace, so a re-run copies nothing twice.
   - **Presets keep their meaning for moved products**: the copy goes through an id map and
     `products.applied_preset_id` on the moved rows is re-pointed to the copy. The
     founder's own products keep pointing at the Founding Workspace's presets.
   - **Label assignments** on moved products are re-pointed to the copied labels; a label
     that already exists in the new workspace by name is reused rather than duplicated.
5. **Rows that follow the account are re-pointed**: his support threads (`org_id`,
   `org_name`), his CRM contact (`org_id`, and `company` filled in if blank), the
   publication records of the moved listings, and — if the Founding Workspace has a per-org
   Shopify connection row — that row moves, because it is C&D's store.
6. **One `founding_admin_audit` row** names the actor (`v_actor_email`, edit it if someone
   else runs the script) with action `split_workspace`, or `split_workspace_rerun` on a
   second pass.

Every optional table is read through `to_regclass()`, so the script runs identically
whether or not `brand_aliases.sql`, `listing_labels.sql`, `crm.sql`,
`support_messaging.sql`, `marketplaces.sql`, `org_shopify_connections.sql`,
`org_description_settings.sql` or `founding_user_admin.sql` have been applied.

**Why a script and not the Founder console.** AGENTS.md §18 #16: the app's "move user"
moves MEMBERSHIPS and never data, because a workspace's batches belong to the workspace,
not to whoever pressed Upload. That is the right rule for a general tool. This is the
founder deciding, once, that one person's work in the shared Founding Workspace *is* his
shop's work — and that decision is written down once, with counts printed at every step
and a rollback that puts every row back.

---

## 3. Runbook

1. **Deploy** the client (the App.tsx Vendor-fallback change is in the onboarding pass).
2. In the SQL Editor, as `postgres`: run **`tenant_scoped_uniqueness.sql`**. Expect two
   `dropped global unique constraint …` notices (or none, if a previous run already did
   it). Run its VERIFY (a).
3. Open `split_cd_vintage.sql`. Run **section 0** on its own and read the three result
   sets: per-creator counts, unassigned products per creator, the founding roster. Decide
   `v_move_all_founding_batches`. Check `v_actor_email`.
4. Run **section 1**. Read every NOTICE — the counts are the receipt. If anything raises,
   nothing has changed (it is one transaction).
5. Run **section 2** (VERIFY): the two-workspace summary, the two zero-row integrity
   checks, the Vendor name.
6. **CJ signs out and back in** on the gmail account. He lands in C&D Vintage as owner;
   whichever batch he had open is still open (it moved with him), and Step 2 has the
   copied categories.
7. **Shopify title dedup for C&D's exports.** If section 1 printed
   `shopify connection: moved`, nothing more. If it printed `none`, the Founding Workspace
   had been using the global `SHOPIFY_STORE` / `SHOPIFY_ADMIN_TOKEN` Edge Function secrets,
   which fire **only for the founding slug** — so CJ (or a founding admin who adds
   themself to C&D Vintage as admin for a minute via the Founder console) connects the
   store in Workspace → Shopify. Consider unsetting the global secrets afterwards: the
   Founding Workspace is a demo now.
8. Storage needs nothing. The bucket is public and paths are keyed by user id; CJ's files
   stay under his prefix, which is now read from the new workspace. If
   `security_storage_policies.sql` is ever run, it scopes writes by ORG membership and CJ
   is a member of the workspace his files belong to.

**To undo:** the ROLLBACK block at the bottom of the one-off (uncomment, set
`v_restore_role` to what step 1.5 printed as "was: …", run). It moves every row back,
deletes the copies, restores his founding membership and deletes the workspace. The
migration has its own rollback, which correctly **refuses** to restore the global
constraint while two workspaces share a name and says so.

---

## 4. Verification transcript (throwaway Postgres 14)

Stack: the tenancy stub, then `multi_org_tenancy`, `beta_signups`, `founding_user_admin`,
`org_description_settings`, `org_shopify_connections`, `support_messaging`, `crm`,
`marketplaces`, `brand_aliases`, `listing_labels`. Fixture: a Founding Workspace with the
founder (owner), CJ gmail (admin), CJ icloud (member) and a demo account; two CJ batches
(one containing a founder-uploaded product), one founder batch, one icloud batch; a CJ
unassigned product and a founder unassigned product; two categories + two presets with
`applied_preset_id` set on a CJ product and on a founder product; marketplace opt-ins
(one pointing at pricing rule `r1`), a workspace vocabulary row, a brand alias, a listing
label on a CJ product and on a founder product, a CJ support thread, a CJ CRM contact, a
per-org Shopify connection, and `description_settings` with an empty `vendorName` and one
platform pricing rule.

```
[1.4] created workspace "C&D Vintage" (…) plan=beta
[1.5] thecreatendestroy@gmail.com is owner of "C&D Vintage"; founding membership removed: 1 (was: admin)
[1.6] batches moved: 2 (mode: batches created by thecreatendestroy@gmail.com)
[1.7] products moved: 4
[1.8] product_images moved: 4
[1.9] categories copied: 2
[1.10] presets copied: 2; applied_preset_id remapped on 2 products
[1.11] marketplace opt-ins copied: 2
[1.11] workspace marketplace vocabulary copied: 1
[1.11] publication records moved: 1
[1.12] brand aliases copied: 1
[1.13] listing labels copied: 1; assignments re-pointed: 1
[1.14] support threads re-pointed: 1
[1.14] CRM contacts re-pointed: 1
[1.15] shopify connection: moved
[1.17] audit row written
```

22 assertions after the first run, all true:

| | Assertion |
|---|---|
| A | founder-uploaded product inside a CJ batch moved |
| B | icloud account's product stayed |
| C | CJ's unassigned product moved |
| D | founder's unassigned product stayed |
| E | moved products point at the NEW workspace's presets |
| F | founder's product still points at the Founding Workspace's preset |
| G | copied preset keeps its `product_type` |
| H | label assignment re-pointed to a label in the new workspace |
| I | founder's product label untouched |
| J | publication record of the moved batch moved; the founder's stayed |
| K | marketplace opt-ins copied with `settings` (pricing rule id intact) |
| L | Founding Workspace's opt-ins still there |
| M | support thread's `org_name` is now "C&D Vintage" |
| N | CRM contact re-pointed and `company` filled |
| O | Shopify connection now on the new workspace |
| P | audit row with actor and target |
| Q | new `description_settings` keeps the pricing rule and pins the Vendor |
| R | Founding Workspace's `description_settings` untouched |
| S | brand alias copied |
| T | icloud account still a founding member |
| U | gmail account no longer a founding member |
| V | `created_by` is CJ |

Then, in order:

- **Idempotent re-run** — every count 0, "already exists / already present", 22/22 still
  true, no duplicate rows anywhere.
- **Rollback** — 4 images, 4 products, 2 batches back; copies deleted; `applied_preset_id`
  and the label assignment restored to the founding rows; Shopify row back; CJ back as
  admin; workspace gone. Counts identical to the baseline.
- **Forward again after the rollback** — works; 22/22 (the audit-row assertion then reads
  `>= 1`, since each pass writes one).
- **The lock-out guard** — with every other founding member demoted to `member`:
  `Refusing: removing thecreatendestroy@gmail.com would leave the Founding Workspace with
  no owner or admin (AGENTS.md §18 #16).` — and no row changed.
- **Move-all mode** in a rolled-back transaction — 4 batches / 6 products move; the
  founder's unassigned orphan is the one product left.
- **Under the OLD global constraints** (re-added to mimic production): a second workspace
  inserting `tees` fails on `categories_name_key`; the split **refuses** at step 1.2 with
  the org count unchanged (this was re-tested with the rule installed both as a CONSTRAINT
  and as a standalone unique INDEX — the first version of the guard compared
  `indkey::int2[]` to an array literal, which is always false because `int2vector` is
  zero-based, and only failed later at the copy; the guard and the migration's fallback
  loop now test by subscript); `tenant_scoped_uniqueness.sql` then drops both shapes and
  creates the four indexes; a second workspace can hold `tees` while the same
  workspace still cannot hold it twice (`categories_org_name_uidx`); the migration
  re-applies as a no-op; its rollback with two workspaces sharing names prints the two
  `NOT restored` notices and leaves no global constraint behind; after undoing the split
  the rollback does restore them; re-apply → split → 22/22.

- **Production run 1 failed at step 1.10** with `operator does not exist: text = uuid`:
  `products.applied_preset_id` is a **`text`** column in production
  (`ADD_APPLIED_PRESET_ID.sql`), while the throwaway stub had it as `uuid`. The DO block is
  one transaction, so that run changed nothing. The remap (and its mirror in the rollback)
  now compares both sides as text and assigns in the column's own type, read from
  `information_schema.columns.udt_name`. Re-verified with the column as `text` (the failing
  statement reproduced first, then the fixed script: moved products point at the new
  workspace's presets, 22/22, rollback restores the founding preset id, forward again 22/22)
  and again with the column as `uuid` (22/22).

Harness: `scratchpad/cds/{run.sh,fixture.sql,checks.sql,uniq.sh}` (not committed).

---

## 5. Not done, and why

- **No SQL was run against Supabase.** Both files are for the founder to run, in the
  order above.
- **No auth account is created or deleted.** Both of CJ's accounts already exist.
- **Storage objects are not moved** (nothing to move — see the runbook).
- **The Founding Workspace's own categories and presets are not deleted** — the icloud
  account and every future demo user still need them.
- **Analytics history is left where it is.** `analytics_events.org_id` is the workspace an
  event happened in; rewriting it would falsify the founder's own dashboards.
