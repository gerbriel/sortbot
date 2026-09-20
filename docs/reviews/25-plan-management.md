# 25 — Plan management + plan history

**Founder's brief:** real CRUD over plans, and a durable answer to *"who was a beta user?"*

**Date:** 20 Sept 2026 · **Nothing committed** · **No SQL run against Supabase.**

> **Numbering note.** The contract named this file `24-plan-management.md`, but
> `docs/reviews/24-cd-vintage-split.md` already exists (commit `04d2eb5`). It is filed as
> **25** to keep the series unique. Rename it if you would rather the contract's number won.

| Gate | Result |
|---|---|
| SQL | **64 scenarios** on a throwaway Postgres 17, three migration orders (§5) |
| Files touched | `supabase/migrations/plan_management.sql` (new) · this file (new) |
| Existing migrations edited | **none** — `finance.sql`, `founder_console.sql` and `perf_rls_initplan.sql` are untouched |
| CI migration hygiene | ROLLBACK section ✅ · `idempotent` / `if not exists` ✅ |
| Linter 0028/0029 | clear for all six new RPCs, in both hardening orders |

> **This is the SQL half only.** The client (`foundingAdminService.ts`), the UI
> (`FounderConsole.tsx` → Plans tab, plan history, beta alumni) and their tests were built
> concurrently by a second agent against the same contract and are **reported separately**.
> §7 lists the two things that half needs to know about the final signatures.

---

## 1. What was actually wrong

### 1.1 A plan you can price but cannot assign

The plan vocabulary was a **hardcoded array in two hand-synced places**:
`app_private.org_plan_list()` (`founder_console.sql` §3) and `ORG_PLANS` in
`src/lib/foundingAdminService.ts`. Both writers that touch `organizations.plan` —
`founding_set_org_plan` and `founding_create_workspace` — reject anything the array does not
name.

Meanwhile **Finance → Customers already has an "add plan" control** that writes freely to
`finance_plan_prices`. So the founder's existing path to "we have a new tier" was:

1. add the tier in Finance → it gets a price, and shows up in projected MRR;
2. open the Founder console → the plan is not in the dropdown;
3. call the RPC by hand → `Unknown plan: studio`.

Nothing in that sequence says why. The price list and the assignable list were two
different lists that looked like one.

### 1.2 "Who was a beta user" was not recorded anywhere durable

`organizations.plan` is **one mutable column**. The moment a beta shop moves to `pro`, the
fact that it was ever a beta shop is gone — and that fact is a promise: the landing page
sells 30% off list *for life* to founding shops. The four places that might have held it:

| Candidate | Why it does not answer the question |
|---|---|
| `organizations.plan` | One value. Overwritten on every change. |
| `beta_signups` | No `org_id` at all — email plus a free-text `org_name`. |
| `founding_admin_audit` | Records only what a founder did **through the console**. A SQL-Editor `update organizations set plan = …` is invisible to it. |
| `created_at <= founding_cutoff` (`finance.sql`) | A date proxy. Good enough to price with, useless as a record — and it says nothing about a shop that joined after the cutoff on a beta invite. |

---

## 2. The shape of the fix

Three moves, in this order, and each one is load-bearing for the next:

1. **`finance_plan_prices` becomes the plan catalog.** It already was one in intent —
   `finance.sql`'s own header says it is "keyed by the value in `organizations.plan`, so
   projected MRR is a JOIN, not a constant in the client". It gains `display_name`,
   `is_active` and `sort_order`.
2. **`app_private.org_plan_list()` is replaced IN PLACE** to read that table. Same name,
   same `returns text[]`. `founder_console.sql` is not edited, does not need to be, and
   `founding_set_org_plan` / `founding_create_workspace` become data-driven the moment the
   `create or replace` lands. **That is the whole trick**, and scenario 6 is the proof.
3. **`org_plan_history` is written by a TRIGGER on `organizations`**, not by the RPC.

Move 3 is the one worth arguing about, so: **why a trigger and not the RPC.**
`founding_set_org_plan` is *one* of the ways `organizations.plan` changes. The others are
the SQL Editor, a future admin surface, and a hand-written `UPDATE` during an incident —
and those are exactly the changes you most want a record of. `founding_admin_audit` keeps
recording the console's own writes alongside; the two answer different questions
(*"what did a founder do"* vs *"what has this workspace's plan been"*). A trigger is the
difference between "we log our own writes" and "the column cannot change without a record".

---

## 3. The migration — section map

**`supabase/migrations/plan_management.sql`. Written, NOT run.** Additive, idempotent,
rollback at the bottom.

| § | What |
|---|---|
| header | The two problems, function placement, the two ⚠️ ordering hazards, what this file deliberately does not do |
| 1 | `create schema if not exists app_private` (+ `usage` grants) — no-op when a security file already ran |
| 2 | Preconditions: `organizations`, `is_beta_admin()`, `founding_admin_audit`, `assert_founding_admin()`, **and `app_private.org_plan_list()`** |
| 3.1 | `finance_plan_prices` re-created **byte for byte** from `finance.sql`, plus its nine-row seed |
| 3.2 | `add column if not exists` × 3 — `display_name`, `is_active`, `sort_order` |
| 3.3 | Seed the two new columns for the nine known keys, only where untouched |
| 3.4 | `finance_touch_updated_at()` **created only when absent**, + the `finance_plan_prices_touch` trigger |
| 3.5 | RLS, the widened column UPDATE grant, and the four policies in `perf_rls_initplan.sql`'s exact form |
| 4 | **`app_private.org_plan_list()` replaced in place** — reads the catalog, two fallbacks to the nine literals, re-revoked |
| 5 | `org_plan_history` — table, two indexes, RLS (`select` only, founders only, no client write at all) |
| 6 | `public.org_plan_history_write()` + **two** triggers (`_ins`, `_upd`) |
| 7 | Backfill: one `source = 'backfill'` row per workspace with no history |
| 8.1–8.6 | The six RPC bodies in `app_private` |
| 9 | The six `public` SECURITY INVOKER wrappers |
| 10 | Privileges — grant the twelve RPC halves, revoke the trigger function from everything |
| 11 | `notify pgrst, 'reload schema'` |
| VERIFY | Seven copy-paste queries for the SQL Editor |
| ROLLBACK | Commented block with **three deliberate asymmetries** (§3.6) |

### 3.1 The six RPCs

All SECURITY DEFINER, all `perform public.assert_founding_admin()` first (→ **42501**), all
audited into `founding_admin_audit` — whose `action` column is plain `text` with no CHECK,
so the four new verbs (`create_plan` / `update_plan` / `rename_plan` / `delete_plan`) need
no `ALTER`.

| Function | Returns | Notes |
|---|---|---|
| `founding_plan_directory()` | 9-column table | `workspaces` = now · `ever_used` = distinct orgs in history · `protected` = free\|beta. Needs a definer body because **`organizations` is hidden from a founding admin by RLS** (scenario 37). |
| `founding_upsert_plan(p_plan, p_display_name, p_monthly_cents, p_note, p_is_active, p_sort_order)` | `void` | Key validated `^[a-z][a-z0-9_-]{0,39}$`. `create_plan` vs `update_plan` by whether the row existed. |
| `founding_rename_plan(p_from, p_to)` | `bigint` (workspaces moved) | The only two-table write in the file. Atomic. |
| `founding_delete_plan(p_plan)` | `void` | Refuses protected and in-use; **does not** refuse on history. |
| `founding_org_plan_history(p_org)` | 5-column table | Newest first. |
| `founding_plan_alumni(p_plan default 'beta')` | 8-column table | The headline. Includes **deleted** workspaces. |

### 3.2 Why `org_plan_history.org_id` is not a foreign key

Direct precedent: `listing_publications.product_group_id` in `marketplaces.sql` — *"a
cascade would destroy the only record it was ever posted"*. The same argument one level up:

- **`ON DELETE CASCADE`** would delete exactly the rows a founder asking "who were our beta
  users" is looking for. Those shops have, by definition, mostly churned.
- **`ON DELETE RESTRICT`** would make deleting a workspace impossible — a history vetoing a
  deletion.
- **No FK** costs an `org_id` that can point at nothing, which `founding_plan_alumni()`
  surfaces as `exists_now = false` rather than hiding. That is the feature, not the caveat.

`org_name` is denormalised at write time for the second half of the same reason: a deleted
workspace has no name to join to, and a renamed one must not have its past rewritten.

`changed_by` is FK-free too, and that one is a small correction to an existing pattern:
`founding_admin_audit.actor_id` references `auth.users(id)` with **no `ON DELETE` clause**,
which means deleting an account is blocked by its own audit trail. A record of who made a
change must not be able to veto a deletion.

### 3.3 Why `free` and `beta` cannot be renamed or deleted

Three separate things in this codebase read those two literals:

- **`organizations.plan`'s column DEFAULT is `'free'`** (`multi_org_tenancy.sql`). Rename
  it and every workspace created afterwards lands on a plan that does not exist.
- The **waitlist-approval path** and `founding_create_workspace`'s own default both write
  `'beta'`.
- **`finance_summary()`'s founding-shop test is the literal string `'beta'`**
  (`finance.sql`), mirrored in `financeService.ts` — AGENTS.md §18 #28. Renaming the plan
  would silently revoke the 30%-off-for-life promise for every founding shop.

Refusing also keeps history truthful and keeps `founding_plan_alumni('beta')` meaning what
it says. They are load-bearing identifiers, like the marketplace keys — not special-cased
out of timidity.

**Only the KEY is protected.** A protected plan can still be repriced, relabelled,
re-noted and reordered (scenario 17); it just cannot change its name or disappear.

### 3.4 `source = 'rename'`, and why the cascade is recorded rather than suppressed

A rename updates `organizations.plan` for every workspace on the tier, which fires the
trigger N times. Two options, both defensible:

- **Suppress** those rows — a rename is a relabelling, not a plan change.
- **Record** them — but then a 200-workspace tier rename reads as 200 shops all changing
  plan on the same day.

The file records them, marked `source = 'rename'`. The deciding argument is that
suppression needs an off switch, and **a trigger with an off switch is not a guarantee** —
it would punch a hole in the exact property the trigger exists to provide. Marking is the
honest middle: the row is written, and the UI can render *"renamed starter → launch"*
instead of *"moved to launch from starter"*.

The mechanism is a transaction-local GUC (`set_config(..., true)`) that the trigger accepts
only as the one literal `'rename'`. The worst a caller can do by setting it themselves is
mislabel a change they were already allowed to make. Scenario 26 proves it does not leak
into the next statement.

**History is never rewritten.** Rows written before a rename keep the old key forever —
scenario 24. That is the only thing an append-only log can honestly claim.

### 3.5 The two `finance.sql` interactions, both tested

**The table.** `§3.1` re-creates `finance_plan_prices` byte for byte (precedent:
`my_email()` in `marketplaces.sql`). `if not exists` + `on conflict do nothing` mean that
whichever file runs second is a no-op, and **no price a founder edited is ever
overwritten in either direction** (scenarios 24, 49).

**The touch function.** `public.finance_touch_updated_at()` is `finance.sql`'s, and
`security_function_hardening.sql` §9 **pins a `search_path` on it** to clear linter 0011.
`create or replace` resets a function's config settings, so replacing it here would
silently undo that fix. This file therefore creates it **only when it is absent**, already
carrying the search_path it would otherwise have to be given later (scenarios 52, 53).

**The policies.** `§3.5` writes the four `finance_plan_prices_*` policies in
`perf_rls_initplan.sql`'s exact form — `(select public.is_beta_admin())`, §18 #47 — with
the same names, so **re-running that file afterwards is a byte-identical no-op** rather
than a correction (scenario 51, asserted by diffing `pg_get_expr` before and after).

`finance.sql` run *after* this file reverts those four to its own bare form; `perf` §7
restores them exactly (scenario 50). Same known hazard AGENTS.md §9 already documents.

### 3.6 The rollback's three deliberate asymmetries

1. **`finance_plan_prices` and its three new columns are KEPT.** Dropping the table would
   destroy every price a founder set and break `finance_summary()`; dropping the columns
   would throw away labels and ordering for nothing. They are inert without the rest of the
   file.
2. **`org_plan_history` is KEPT by default.** It is the record this file exists to create,
   the same way `founder_console.sql`'s rollback leaves `founding_admin_audit` alone. The
   drop is the last line, commented twice over.
3. **`app_private.org_plan_list()` MUST be restored** to the hardcoded nine, and that
   statement is *not* optional — `founder_console.sql` calls it by name, and leaving it
   reading a table this rollback no longer maintains makes every plan unassignable. The
   block restores the original definition including its `immutable` volatility and its
   revokes (scenarios 61–63).

---

## 4. Departures from the contract

Five, all deliberate. Each is also called out in my hand-back so the client agent sees them.

| # | Contract said | Shipped | Why |
|---|---|---|---|
| D1 | `source ... check (source in ('trigger','backfill'))` | adds `'rename'` | §3.4. Purely additive to the CHECK; `PlanHistoryRow.source` is already `string` on the client, so no TS type moves. |
| D2 | "REFUSE to rename a protected plan" | also refuses renaming **into** `free`/`beta` | A plan renamed *into* a protected key silently becomes the target of the column DEFAULT, the waitlist path and the founding-discount rule, whatever it used to mean. Belt and braces; "already exists" covers the normal case anyway. |
| D3 | (order of `founding_org_plan_history` unspecified) | `changed_at desc, plan` | The expanded workspace row reads downward from "where they are now". |
| D4 | (nothing about `finance_touch_updated_at`) | created only when absent, born with a pinned `search_path` | §3.5. Without it, `updated_at` never moves on a database where `finance.sql` has not run. Replacing it unconditionally would undo the 0011 fix. |
| D5 | file named `24-plan-management.md` | `25-plan-management.md` | `24-cd-vintage-split.md` already exists. |

---

## 5. SQL verification — 64 scenarios

Throwaway **Postgres 17.10** (`initdb` + `pg_ctl`, TCP 55801, data dir in the scratchpad,
torn down afterwards). Stub `auth` schema (`auth.users`, `auth.jwt()`, `auth.uid()`,
`auth.role()`, the three Supabase roles) plus the five data tables `multi_org_tenancy.sql`
adds `org_id` to. Then the real migrations in run order. Callers impersonated with
`set local role authenticated; set local "request.jwt.claims" = '{…}'`. Method as
`docs/reviews/22-founder-console.md` §4.

Actors: `founder@arcadian.test` (owner of the Founding Workspace), `tenant@shopa.test`
(owner of a tenant workspace), `nobody@shopb.test`.

### Access control

| # | Scenario | Result |
|---|---|---|
| 1 | Non-founder calls each of the six | `42501 Not authorized — Founding Workspace admins only.` ×6 |
| 2 | A **tenant workspace's OWNER** calls `founding_plan_directory` | 42501 — being an org owner is not being a founder |
| 3 | The raised SQLSTATE | exactly `42501` (caught and printed) |

### The bug being fixed

| # | Scenario | Result |
|---|---|---|
| 4 | `founding_set_org_plan(…, 'studio')` **before** the plan exists | `Unknown plan: studio` |
| 5 | `founding_upsert_plan('  STUDIO  ', 'Studio', 29900, …)` | created as `studio` — trimmed and case-folded |
| 6 | **`founding_set_org_plan(…, 'studio')` immediately after** | **accepted**, workspace moved, `founder_console.sql` never edited |
| 7 | A plan added by a plain `insert into finance_plan_prices` (the Finance → Customers control) | assignable too — `org_plan_list()` picks it up |
| 8 | `founding_create_workspace('Shop C', 'studio_x', …)` with a brand-new plan | workspace created; the INSERT is recorded in history |

### Directory

| # | Scenario | Result |
|---|---|---|
| 9 | Founder reads the directory | 9 rows, ladder order, `workspaces` / `ever_used` / `protected` all correct |
| 10 | `ever_used` on a workspace that went beta → pro → beta | counts the org **once** (distinct) |
| 11 | `ever_used` after the workspace is deleted | still counts it |
| 12 | A new plan at `sort_order = 65` | sorts between `pro` (60) and `business` (70) |

### Upsert

| # | Scenario | Result |
|---|---|---|
| 13 | Retire a tier (`is_active = false`) | keeps its price, **drops out of `org_plan_list()`**, `set_org_plan` now refuses it |
| 14 | Key validation: `Pro Plus` · `9lives` · 45 chars · `''` · `pro!` | all refused in plain English |
| 15 | Keys containing `-` and `_` (`pro-plus_2026`) | accepted, and assignable end to end |
| 16 | `monthly_cents` of `-1` and `100000001` | both refused before touching the table |
| 17 | Null `p_monthly_cents` / `p_is_active` / `p_sort_order` on an **update** | price, active and sort left exactly as they were |
| 18 | `founding_upsert_plan('free', 'Free forever', 0, …)` | accepted — **only the KEY is protected** |
| 19 | `create_plan` vs `update_plan` in the audit | chosen by whether the row existed |

### Rename

| # | Scenario | Result |
|---|---|---|
| 20 | Rename with **two** workspaces on the tier | `moved = 2`; both workspaces moved; catalog row renamed, price and label intact |
| 21 | `free → premium`, `beta → legacy` | both refused, with the three reasons named |
| 22 | `atelier → free`, `atelier → beta` | both refused (D2) |
| 23 | to an existing key / from a missing key / to itself / to an invalid key | `There is already a plan called "pro".` · `No such plan: ghost` · `That is already the plan key.` · key-shape message |
| 24 | **Atomicity** — a `CHECK` on `organizations` makes the second write fail | catalog still has the old key, new key absent, workspaces unmoved, **no history row left behind** |
| 25 | History after a rename | old rows keep `studio`; the cascade rows read `atelier <- studio [rename]` |
| 26 | The rename GUC leaking | the next plain `UPDATE` records `[trigger]`, not `[rename]` |

### Delete

| # | Scenario | Result |
|---|---|---|
| 27 | `founding_delete_plan('free')` / `('beta')` | both refused |
| 28 | Delete a plan with 1 workspace on it | refused: *"1 workspace(s) are on "pro". Move them … or set it inactive to take it off the list and keep its price."* |
| 29 | Delete a plan that does not exist | `No such plan: ghost` |
| 30 | Delete a retired, unused plan that **has history** | deleted; the history rows naming it survive |

### The trigger

| # | Scenario | Result |
|---|---|---|
| 31 | Workspace INSERT | one row, `previous_plan` null |
| 32 | A real plan UPDATE | one row, `previous_plan` = the old value |
| 33 | `update … set name = …` · `set plan = plan` · setting the same value | **no row** — three non-changing updates, count unmoved at 6 |
| 34 | A SQL-Editor change (**no JWT**) | recorded with `changed_by` and `changed_by_email` **NULL** |
| 35 | The same change through the RPC | stamped with the founder's uuid and email |
| 36 | `delete from organizations` | 0 org rows, **4 history rows survive** |

### Alumni — the headline

| # | Scenario | Result |
|---|---|---|
| 37 | `founding_plan_alumni('beta')` after the workspace was **deleted** | `Shop A \| current=(gone) \| still_on=false \| exists_now=false \| created=(gone)` — name from the denormalised `org_name` |
| 38 | `still_on` for a live workspace currently on the plan | `true` |
| 39 | `founding_plan_alumni()` with no argument | identical to `('beta')` — the DEFAULT reaches through the wrapper |
| 40 | A plan nobody ever used | 0 rows, no error |
| 41 | `first_on` for a beta → pro → beta workspace | the **earlier** of the two beta stamps |

### Table safety

| # | Scenario | Result |
|---|---|---|
| 42 | Founder tries INSERT / UPDATE / DELETE on `org_plan_history` | `permission denied for table org_plan_history` ×3 |
| 43 | SELECT as founder / non-founder / anon | 8 rows / **0 rows** / permission denied |

### `org_plan_list()` fallbacks

| # | Scenario | Result |
|---|---|---|
| 44 | `finance_plan_prices` dropped | the nine literals |
| 45 | Every row `is_active = false` | the nine literals |
| 46 | Table present, **zero rows** | the nine literals |
| 47 | `founding_set_org_plan` with a zero-row catalog | **still works** — a zero-row catalog can never make every plan unassignable |

### Idempotence, ordering, placement

| # | Scenario | Result |
|---|---|---|
| 48 | Re-apply the whole file | clean; history unchanged at 8; `my-plan_2`'s hand-set `sort_order = 95` survives |
| 49 | Re-apply after a founder edited a price to `31337` and a note | both survive |
| 50 | Backfill re-run | idempotent — 8 → 8 |
| 51 | `finance.sql` applied **after** | clean; prices and extra plans survive; the UPDATE grant keeps **all five** columns (GRANT is additive) |
| 52 | …and its policies | revert to the bare `is_beta_admin()` form; `perf` §7 restores the wrapped form **exactly** |
| 53 | `finance.sql` → `plan_management.sql` → `perf` §7 | **byte-identical no-op** for the four policies (diffed via `pg_get_expr`) |
| 54 | `finance_touch_updated_at()` when `finance.sql` ran first **and was hardened** | `search_path=public` preserved — never replaced |
| 55 | …when `finance.sql` has **not** run | created, born with `search_path=public`; the touch trigger fires and `updated_at` moves |
| 56 | **Order A** — hardening files first, then this file | clean; placement table identical to Order B |
| 57 | **Order B** — this file first, then the hardening files | clean; **0028/0029 completely clear across the whole `public` schema** |
| 58 | Re-running both hardening files afterwards | changes nothing of ours (diffed: schema, `prosecdef`, `proconfig`, EXECUTE) |
| 59 | `app_private.org_plan_list()` / `public.org_plan_history_write()` privileges | `anon` f, `authenticated` f, `service_role` f — treatment B, as §18 #44 requires |
| 60 | `drop schema app_private restrict` | refuses while these bodies live there, as the header says |
| 61 | **Signature parity**, wrapper vs body, all six | args **MATCH** (names + DEFAULT), result **MATCH**, volatility **MATCH** |
| 62 | **Named-argument calls** (PostgREST's form) on all six | all work |

### Rollback

| # | Scenario | Result |
|---|---|---|
| 63 | Run the rollback block | 0 new RPCs, 0 history triggers left; **`org_plan_history` kept with its 3 rows**; `finance_plan_prices` kept with 9 rows and all three new columns; UPDATE grant narrowed back to `monthly_cents, note`; `org_plan_list()` restored to `sql`/`immutable`/nine literals |
| 64 | `founding_set_org_plan` after the rollback | **still works** — this is what makes the restore mandatory rather than cosmetic |
| 64b | Re-apply the whole file after the rollback | clean; RPCs back; `org_plan_list()` back to `plpgsql`/`stable`; **no duplicate history rows** |

### Audit

One more, run on a clean database to avoid inference:

| Scenario | Result |
|---|---|
| Four refusals (bad key, protected rename, protected delete, missing plan) | `founding_admin_audit` plan rows: **0**; `org_plan_history` rows: unchanged |
| Three successes (upsert → rename → delete) | exactly three rows, in order: `create_plan plan=trial` · `rename_plan old=trial plan=trial_30` · `delete_plan plan=trial_30` |

---

## 6. Follow-ups

1. **`finance_summary()`'s founding-shop test should eventually read history.** It stays
   `plan = 'beta' or created_at <= founding_cutoff`, deliberately untouched. Reading
   `org_plan_history` instead is strictly more correct — a shop that was on beta and
   upgraded *after* the cutoff is a founding shop by promise and by fact, and only history
   knows it — but AGENTS.md §18 #28 says that rule is implemented **twice** (SQL and
   `financeService.ts`) and asserted against one worked example on both sides. It is its own
   pass, with its own TypeScript half and its own test update. **Not smuggled in here.**
2. **Add the new function signatures to `security_function_hardening.sql`** if that file is
   ever revised: `public.org_plan_history_write()` belongs in §7's trigger list, and the six
   `founding_*_plan*` pairs in §8's. They are already hardened inline, so this is tidiness,
   not a gap — verified by scenario 58.
3. **`finance.sql` replants a public SECURITY DEFINER `finance_summary`.** Observed in
   Order A: applying `finance.sql` after the hardening files leaves exactly one 0029 hit.
   Pre-existing, `finance.sql`'s doing, and already covered by AGENTS.md §9's "RE-RUN AFTER"
   note — re-run `security_function_hardening.sql` then `security_rpc_wrappers.sql`.
4. **Consider a `plan_changed` notification.** Nothing tells a founder that a plan changed
   outside the console; the history now makes it *visible* but not *noticed*.

---

## 7. What the client half needs to know

Two things, both already reported in the hand-back:

1. **`source` can be `'rename'`** as well as `'trigger'` and `'backfill'` (D1). The TS type
   is `string`, so nothing breaks; render an unknown source generically, and ideally render
   `'rename'` as *"renamed X → Y"* rather than *"moved to Y from X"*.
2. **`founding_upsert_plan` REPLACES `display_name` and `note` with whatever it is given.**
   Passing `null` (or omitting them, if the client sends `null` for an omitted field)
   **clears** them. `monthly_cents` / `is_active` / `sort_order` are the opposite — `null`
   means "leave alone" on an update. So a control that only toggles `is_active` must still
   send the row's current `display_name` and `note`, or the label is wiped. The Plans tab's
   natural shape (an edit row that posts the whole record) does this for free.

---

## 8. Not done

- **No SQL was run against Supabase.** The file ships unrun; AGENTS.md §16 is where its
  run-status belongs.
- Nothing was verified in a signed-in browser — that is the client half's report.
- No multi-currency, no per-plan feature limits, no automatic migration of workspaces off a
  retired tier. Retiring is `is_active = false`; moving them is `founding_set_org_plan`, one
  at a time, which is the right amount of friction for a billing change.
