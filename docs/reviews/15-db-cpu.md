# 15 — Database CPU: where it goes, and six changes that take it back

**Date:** 2026-09-14 · **Symptom:** production Supabase (compute `t4g.nano`, 2 shared vCPU, 0.5 GB RAM) sitting at **96 % CPU** with **34/60** connections.
**Deliverables:** `supabase/migrations/perf_rls_initplan.sql`, `supabase/migrations/perf_storage_usage.sql`, and five source changes.
**Nothing was committed. No SQL was run against Supabase.** Every SQL claim below was measured on a throwaway PostgreSQL 14 cluster built from the repo's own migrations.

---

## 0. The one-paragraph version

The app was asking Postgres to do a lot of work that produced no new information. Every RLS policy re-ran `is_beta_admin()` (which runs its own `exists (select … from org_members join organizations …)`) **once per candidate row**. Every Step-3 keystroke rewrote a ~500 KB JSONB blob that had not changed. Every group/ungroup click re-upserted all 800–1 500 product rows to move one photo. Every support tab polled every 45 s forever, visible or not. Every storage-meter render made ~2 500 round trips. Every CRM panel open re-derived the entire contact table. None of that is a bug — each one is individually reasonable — but together they are the CPU bill.

The six changes below remove the redundant work and change no behaviour. The RLS change is the big one and is proven equivalent by running the same 5-identity smoke suite before and after and diffing: **0 lines differ**.

---

## 1. Change table

| # | What | Files | Expected CPU effect | Test / proof |
|---|---|---|---|---|
| 1 | **RLS InitPlan.** Wrap every bare `auth.uid()` / `auth.jwt()` / `is_beta_admin()` / `is_org_admin()` / `auth_email_verified()` / `invited_role()` / `org_has_members()` / `storage_prefix_writable()` / `my_email()` call in a policy as `(select …)` so it is evaluated **once per statement** instead of once per row. Plus 6 missing indexes. | `supabase/migrations/perf_rls_initplan.sql` (new) | **Largest single win.** Founder-facing scans drop from O(rows) helper calls to 1. Measured **94.5 ms → 1.9 ms (−98 %)** on a 20 100-row founder query. Every org-scoped table read by every user benefits proportionally to rows scanned. | Harness: `explain (analyze)` before/after (§3.1) + 5-identity × 24-table × 180-write-probe smoke diff = **empty** (§3.2). Idempotent ×3; rollback restores the exact pristine texts. |
| 2a | **Autosave: skip byte-identical writes.** Hash the `workflow_state` payload (ignoring `lastEditedAt`); if it matches the last one Postgres accepted for that batch, send no UPDATE. New outcome `'unchanged'`. | `src/lib/workflowBatchService.ts`, `src/App.tsx` | Step 3 currently sends a full JSONB rewrite (TOAST + WAL) every ~2 s of typing, changing nothing — those fields live in `products`. Expect **most Step-3 autosave UPDATEs to disappear**. | `workflowBatchService.test.ts` +10 tests: lastEditedAt ignored, lastEditedBy not, second identical save sends 0 UPDATEs, changed payload writes again, rls-blocked never remembered, delete forgets. |
| 2b | **Autosave: debounce 2 000 → 5 000 ms**, plus `flushPendingAutoSave()` on batch switch / clear so the wider window cannot drop edits. | `src/App.tsx` | ~40 % of the remaining autosave round-trips during grouping bursts. | CLAUDE.md §11 floor is 1 000 ms — this is well above it. Loss protection re-read in code before relying on it (§2.2). |
| 2c | **Group upsert: send only changed rows.** Per-item fingerprint of everything the `products` + `product_images` mirror writes; unchanged rows are skipped. `pruneStaleProducts` still gets the full id list. | `src/lib/productUpsertDedupe.ts` (new), `src/App.tsx` | Moving one photo between groups went from **800 upserted rows to 1**. Each skipped row is an index probe + heap update + WAL record not paid. | `productUpsertDedupe.test.ts`, 13 tests — incl. the 800-row/1-changed case and the "never shrink the prune list" trap. |
| 3 | **Support polling.** Don't poll a hidden tab at all; stretch to 180 s once Realtime reports `SUBSCRIBED`; keep 45 s when it is not; refetch immediately on visibility regain. | `src/lib/supportStore.ts`, `src/lib/supportService.ts` | A `support_threads` SELECT (whose RLS calls `is_beta_admin()`) per tab per 45 s, forever → **zero while hidden, ¼ the rate while visible**. Multiplies by every stale tab every user leaves open. | `supportStore.test.ts` +5 tests on the pure `supportPollInterval(visible, subscribed)`. |
| 4 | **Storage meter: one RPC.** `storage_usage_bytes()` sums `storage.objects` for the caller's prefix instead of walking the bucket with ~2 500 paginated `list()` calls. Client falls back to the walk when the migration is not run; result cached per session, refreshed after upload and delete. | `supabase/migrations/perf_storage_usage.sql` (new), `src/App.tsx` | **~2 518 authenticated requests → 1** per meter render (sign-in, post-upload, refresh button). Each of those requests was a `storage.objects` query under RLS calling `storage_prefix_writable()`. | Harness: RPC output matches the walk's own arithmetic **to the byte** (51 files / 128 500 B), is scoped to the caller's own prefix, and `anon` gets 42501 (§3.3). |
| 5 | **CRM sync throttle.** The automatic sync on panel open runs at most once per 10 min per session. The manual **Sync** button and the post-approve/deny sync are untouched. | `src/lib/crmService.ts`, `src/components/CrmPanel.tsx` | `crm_sync_contacts()` re-derives and re-upserts **every** contact from `beta_signups` + `auth.users` + `organizations` on every call (architecture review #18). Ten panel opens in a session → **1 sync, not 10**. | `crmService.test.ts` +6 tests, incl. the ten-opens-one-sync case. |
| 6 | **This document.** | `docs/reviews/15-db-cpu.md` | — | — |

Gates: **`npm test` 1060 passed / 53 files** (1026 → +34) · **`npm run build` clean** · **`npx eslint .` 252 problems — exactly the recorded baseline**, and per-file identical on every file touched (`App.tsx` 41 → 41, `workflowBatchService.ts` 4 → 4, every new file 0). react-hooks v7 rules respected — the one new `exhaustive-deps` warning that appeared mid-work was removed properly, by hoisting `walkStorageUsage` to module scope (it closes over nothing reactive) rather than by silencing the rule.

---

## 2. What each change actually does

### 2.1 RLS per-row function evaluation — the main event

A policy expression runs for every candidate row. When it calls a function that does not reference the row, the planner still calls it per row:

```
 Seq Scan on analytics_events (actual rows=20100 loops=1)
   Filter: ((created_at > (now() - '30 days')) AND app_private.is_beta_admin())
```

That is 20 100 executions of a `SECURITY DEFINER` function that itself runs an `exists (select 1 from org_members m join organizations o …)`. Wrapping the identical call as `(select public.is_beta_admin())` makes it an uncorrelated sub-select, which becomes an **InitPlan**: executed once, before the scan, its value substituted as a constant. Same semantics, same rows, same people see the same things.

**Scope.** `grep -c 'create policy' supabase/migrations/*.sql` reports 111 statements, which are not 111 live policies. The migration's header documents the determination for each file: the pre-tenancy sets (`create_workflow_batches`, `categories`, `category_presets`, `collaborative_edit_policies`, `shared_workspace_rls`, `convert_to_shared_collaborative*`, the three `fix_rls_*`) are **superseded** — `multi_org_tenancy.sql` §6 drops every policy on the five data tables and replaces them, so recreating any of them would re-open the old sharing model. `export_library.sql` and `fix_linter_issues.sql` **already** spell `(SELECT auth.uid())`. Everything else is rewritten, guarded with `to_regclass` so the file is correct against any subset of the migrations.

**Three honest caveats, all in the migration header too:**

1. **`org_id in (select public.user_org_ids())` was already optimal.** Every org-scoped policy already spells it as a subquery, which is already an InitPlan. Those fragments are reproduced verbatim and deliberately unchanged — including on the three hot tables (`workflow_batches`, `products`, `product_images`). The big per-user tables were *already* fine; the fix is for the founder-facing and cross-cutting tables.
2. **Correlated helpers become SubPlans, not InitPlans.** `is_org_admin(org_id)`, `invited_role(org_id)`, `org_has_members(org_id)` and `storage_prefix_writable((storage.foldername(name))[1])` take the row as an argument, so `(select f(row.x))` is still once per row. Measured, and shown honestly in §3.1. They are wrapped anyway for uniformity and for the Supabase linter (which reads text, not plans); the real mitigation there is that `org_members(user_id)` is already indexed and those policies sit on tables with tens of rows — except `storage.objects`, which is discussed below. **Do not "fix" this by inlining the function body into the policy** — that duplicates a security boundary in two places (CLAUDE.md §18).
3. **The policies rebind from `app_private.<helper>` to `public.<helper>`.** `security_function_hardening.sql` moved the helpers with `alter function … set schema`, and because a policy is bound by **OID**, the live policies currently point straight at the `app_private` originals. Recreating them from text makes them point at the same-signature **SECURITY INVOKER wrapper** in `public` — which is the name every source migration uses, what the hardening file's own rollback restores, and functionally identical (proven by the empty smoke diff). Consequence to know: roll `perf_rls_initplan.sql` back **before** rolling back `security_function_hardening.sql`, for the same reason that file already documents about `security_rpc_wrappers.sql`.

**Indexes.** Added only where absent, each justified in the file:

| Index | Why |
|---|---|
| `analytics_events(session_id, created_at desc)` | The abuse-limit trigger counts `session_id = … and created_at > now() - interval`. Only `(session_id)` existed, so every insert re-read every row that session ever wrote and filtered by time in the heap. Fires on **every** analytics event. |
| `app_errors(session_id, created_at desc)` | Identical trigger shape. Guarded — `app_errors.sql` is not applied in production. |
| `products(batch_id)` | **No index existed.** `pruneStaleProducts` (every 2 s group upsert), `handleOpenBatch` gap-fill, `registerItemsInDB` and `deleteWorkflowBatch` all filter on it. |
| `product_images(product_id)` | **No index existed**, despite being the target of the chunked delete-then-upsert on every batch open, every products→images join in the Library, **and the `ON DELETE CASCADE` lookup** Postgres runs per deleted product. |
| `workflow_batches(org_id, updated_at desc)` | `fetchWorkflowBatches` reads the org's batches ordered `updated_at DESC`; `(org_id)` alone forced a separate sort over rows whose width includes the `workflow_state` JSONB. |
| `crm_contacts(org_id)` | `crm_sync_contacts()` and the panel group by workspace; indexes existed on `lower(email)`, `stage`, `next_follow_up` — not `org_id`. |

Checked and **deliberately not created**: `org_members(user_id)` (exists — and it is the index behind `user_org_ids`/`is_org_admin`/`is_beta_admin`/`storage_prefix_writable`, which is why the correlated helpers are survivable), `support_threads(user_id, last_message_at desc)` (exists), `brand_aliases(org_id, lower(heard))` (exists as `(org_id, lower(btrim(heard)))`; `heard` carries a CHECK that it equals `canonical_heard(heard)` = lower+btrim, so the expressions are equal on every stored row — **note for later**: `brandAliasService.saveBrandAlias` looks rows up with `.ilike('heard', …)`, which cannot use either index; the table is org-scoped and tiny, so it is a note, not a fix), and `product_labels(product_id)` (the PK is `(product_id, label_id)`; `product_id` leads it).

### 2.2 Autosave

**The write that changes nothing.** Every Step-3 field edit fires `onProcessed` → `autoSaveWorkflow` → a full `workflow_state` UPDATE. But none of the fields being typed is in the slim payload — brand, price, title, tags all live in `products`, written separately by PDG's own 500 ms save. So the UPDATE rewrote up to 500 KB of JSONB to produce a byte-identical row, and Postgres paid for it twice (TOAST rewrite + WAL record) each time. The fingerprint check elides it.

`lastEditedAt` is excluded from the hash (it is stamped `new Date().toISOString()` on every call — include it and nothing is ever equal). `lastEditedBy` **is** included, so a different teammate editing the same batch always writes and the Library's "edited by X" stays correct.

**The one observable difference, stated plainly:** a skipped save does not advance `updated_at` / `last_opened_at`, so a long Step-3 session that only edits `products` fields no longer re-sorts its batch to the top of the Library on every keystroke. `AUTOSAVE_FINGERPRINT_MAX_AGE_MS = 5 min` bounds that — after five minutes the next save goes through regardless, so timestamps still advance during an active session, just at minutes instead of seconds.

**Debounce 2 s → 5 s.** CLAUDE.md §11's rail is a floor, not a target. Both things it protects were re-read in code before relying on them:

- The no-loss-on-refresh guarantee belongs to `scheduleWorkflowBackup` (`lib/workflowBackup.ts`), a **1 s trailing throttle** — it fires *during* a continuous stream of edits rather than being pushed out by them — plus `flushWorkflowBackup()` wired to **both** `pagehide` and `beforeunload` and to the teardown effect. Confirmed present.
- Batch switch and clear-batch previously just **dropped** the pending timer. At 2 s that was a small loss; at 5 s it was worth fixing, so `flushPendingAutoSave()` now runs the pending save (pinned to the outgoing batch, before `currentBatchIdRef` moves) instead of discarding it. `handleBatchDeleted` deliberately still drops it — firing a save for a deleted batch is the "deleted batch comes back" bug.

**The group upsert.** The 2 s debounce bounded how *often* the products mirror was written, never how *big* it was: every fire re-upserted every registerable item in the batch. `filterChangedForUpsert` keys on every field the two upserts derive from the item — `productGroup`, `seoTitle`, primary `imageUrls[0]`, `storagePath`, `originalName` — not just `product_group`, so a title-only change still writes and the mirror cannot go stale. Keys are recorded **only after** the round-trip lands, so a failed write retries. `pruneStaleProducts` still receives the full id list: it deletes by omission, and handing it the filtered set would delete every row that was skipped precisely because it was already correct.

### 2.3 Support polling

The poll ran at a flat 45 s in every subscriber, forever, regardless of tab visibility and regardless of whether Realtime was already delivering every change in milliseconds. `supportPollInterval(visible, subscribed)` is the whole decision and is pure:

- hidden → **`null`** (do not poll). A hidden tab has nothing to render and nobody to render it for; browsers already throttle its timers to ~1/min, so the only thing a background poll reliably produces is Postgres load × every stale tab. The store refetches immediately on `visibilitychange`, so a returning tab is never stale.
- visible + Realtime `SUBSCRIBED` → **180 s** (backstop for DELETEs, which are not subscribed, and for a channel that dies quietly).
- visible + not subscribed → **45 s**, unchanged. If Realtime is not available for these tables, the poll is the only path and must stay fast.

`subscribeToSupport` gained an optional `onStatus` callback; existing callers are unaffected. `supportStore.isLive()` now means "subscribed" rather than "a timer is running" — a hidden tab is still live, it just is not polling.

### 2.4 Storage meter

Object paths are `{userId}/{productId}/{file}`, so the meter listed the user's prefix and then listed **each product folder**. The founder's prefix holds 2 517 folders → ~2 518 authenticated round trips per render, each one a `storage.objects` query under RLS that calls `storage_prefix_writable()`, which runs its own `exists (select … from org_members …)`. One `sum()` answers it.

`storage_usage_bytes()` follows the post-`security_rpc_wrappers` shape required by §18 rule 20: `SECURITY DEFINER` body in `app_private`, identical-signature `SECURITY INVOKER` wrapper in `public`, PUBLIC and `anon` revoked from both, `authenticated` + `service_role` granted, `search_path` pinned on both. Both signatures were added to the Group A list in `security_function_hardening.sql` and to `security_rpc_wrappers.sql`, so replaying either file re-hardens the pair instead of leaving it behind.

It sums the caller's **own uid prefix**, not the org — that is exactly the set the walk visited, which is what keeps the number identical. The org-wide variant is written out in the migration as a comment; it would be a product decision, not a refactor. Path segments are compared as `text` and never cast to `uuid`, matching the storage policies' own rule.

The client tries the RPC and falls back to the original walk (kept verbatim) on any error, latching a flag only on `42883` (function does not exist = migration not run). **So the code ships before the SQL.**

### 2.5 CRM sync

`crm_sync_contacts()` is idempotent, which is exactly why running it on every panel open was easy to miss: the result never changes, only the CPU bill does. It re-derives and re-upserts every contact from `beta_signups` + `auth.users` + `organizations`, while the data it syncs *from* changes when somebody signs up — rarely. The automatic path is now throttled to once per 10 min per session; the **Sync** button and the post-approve/deny sync are untouched, because a human asking for fresh data should get it.

**Noted, not done:** `crm_sync_contacts()` could be incremental — a `p_since timestamptz default null` argument, or a `where greatest(u.created_at, o.created_at, b.created_at) > (select max(last_seen_at) from crm_contacts)` — turning an O(all users) write into an O(new users) one. Not rewritten here: it is a `SECURITY DEFINER` body with its own correctness story (its `updated` count means "rows re-checked", which an incremental version would silently change), and the throttle removes the repeat-call cost without touching its semantics. That rewrite deserves its own before/after. The note is in `crmService.ts` beside the function.

---

## 3. Harness evidence

Throwaway PostgreSQL 14.21 (`/opt/homebrew/opt/postgresql@14`), `initdb --encoding=UTF8 --locale=en_US.UTF-8`, started with `-k /tmp -c wal_level=logical -c shared_preload_libraries=pg_stat_statements`. Applied, in order, onto the auth/storage stub: `multi_org_tenancy`, `beta_signups`, `beta_admin_directory`, `founding_user_admin`, `analytics_events`, `crm`, `support_messaging`, `app_errors`, `security_invites_hardening`, `security_verified_email`, `security_abuse_limits`, `security_storage_policies`, `finance`, `brand_aliases`, `listing_labels`, `security_function_hardening`, `security_rpc_wrappers` — **all 17 clean** — then RLS enabled on the five data tables and on `storage.objects`, then a fixture: a founder, a customer org with an owner + a member + an unverified member, an outsider with a pending invite, data rows in both orgs, a support thread + message, telemetry, CRM/finance/beta rows, labels, aliases, and storage objects for three different uid prefixes. Cluster destroyed afterwards.

### 3.1 The planner difference

Representative founder query — `select count(*) from public.analytics_events where created_at > now() - interval '30 days'` over 20 100 rows, as a Founding-Workspace admin.

**Before** — the helper is a per-row filter expression:

```
 Aggregate (actual rows=1 loops=1)
   ->  Seq Scan on analytics_events (actual rows=20100 loops=1)
         Filter: ((created_at > (now() - '30 days'::interval)) AND app_private.is_beta_admin())
 Execution Time: 94.545 ms
```

**After** — the helper is an InitPlan, and removing it from the filter also lets the planner take an index-only scan:

```
 Aggregate (actual rows=1 loops=1)
   InitPlan 1 (returns $0)
     ->  Result (actual rows=1 loops=1)
   ->  Index Only Scan using analytics_events_created_idx on analytics_events (actual rows=20100 loops=1)
         Index Cond: (created_at > (now() - '30 days'::interval))
         Filter: $0
         Heap Fetches: 80
 Execution Time: 1.913 ms
```

**94.545 ms → 1.913 ms, and 20 100 helper calls → 1.**

The correlated case, shown honestly — `storage.objects` under `storage_prefix_writable((storage.foldername(name))[1])`, as an org owner:

```
   ->  Seq Scan on objects (actual rows=2 loops=1)
         Filter: ((bucket_id = 'product-images'::text) AND (SubPlan 1))
         SubPlan 1
           ->  Result (actual rows=1 loops=3)      ← loops = rows, i.e. still per-row
```

`loops=3` for 3 candidate rows: a **SubPlan**, not an InitPlan, exactly as §2.1 caveat 2 says. This is why the bucket walk in change #4 had to be replaced rather than merely re-planned.

### 3.2 Equivalence: before/after result diff = **empty**

The same smoke suite was run as five identities — **FOUNDER**, **CUST_OWNER**, **CUST_MEMBER**, **OUTSIDER** (no workspace, one pending invite), **UNVERIFIED** (member, `email_confirmed_at` null) — each producing:

- row counts **and the sorted id/email list** for 24 RLS'd tables (`workflow_batches`, `products`, `product_images`, `categories`, `category_presets`, `organizations`, `org_members`, `org_invites`, `beta_signups`, `support_threads`, `support_messages`, `analytics_events`, `app_errors`, `crm_contacts`, `crm_notes`, `finance_transactions`, `finance_settings`, `finance_plan_prices`, `founding_admin_audit`, `brand_aliases`, `listing_labels`, `product_labels`, `storage.objects`);
- the six helper return values (`is_beta_admin`, `count(user_org_ids)`, `auth_email_verified`, two `storage_prefix_writable` prefixes, `is_org_admin`);
- **36 write probes** per identity (180 total) — INSERT/UPDATE/DELETE against every policy path including the ones that must fail — each reporting either `rows=N` or its SQLSTATE, all inside one transaction that is deliberately rolled back.

```
$ diff smoke_before.txt smoke_after.txt
<<< IDENTICAL — 0 lines differ >>>
```

Re-verified at the end against the **final** state (perf migration + storage migration + a re-run of both hardening files on top):

```
<<< FINAL STATE: RLS BEHAVIOUR IDENTICAL TO PRISTINE — 0 lines differ
    across 5 identities, 24 tables, 180 write probes >>>
```

Also verified:

- **Idempotent:** applied ×3, smoke output identical each time, `pg_policies` catalog hash stable at `9e5c8531228ad720aba798215d3b33d3`.
- **Rollback:** restores the pristine policy set exactly; the only rendered difference is the schema qualifier eliding to `is_beta_admin()` because the policy now binds the `public` wrapper (§2.1 caveat 3). All six indexes dropped.
- **§18 rails intact:** `anon`-executable `SECURITY DEFINER` functions in `public` = **0**, before and after, including after adding `storage_usage_bytes`.

### 3.3 The storage RPC

```
-- as CUST_OWNER, 51 objects seeded under that uid prefix
select public.storage_usage_bytes();
  {"file_count": 51, "used_bytes": 128500}

-- the walk's own arithmetic, computed independently over the same prefix
  {"file_count": 51, "used_bytes": 128500}      ← byte-identical

-- as OUTSIDER (different prefix)
  {"file_count": 1, "used_bytes": 9999}          ← own prefix only

-- as anon
  ERROR: permission denied for function storage_usage_bytes
```

Function shape after a re-run of both hardening files:

```
storage_usage_bytes: app_private  secdef=true   anon=false  auth=true
storage_usage_bytes: public       secdef=false  anon=false  auth=true
```

---

## 4. Migrations to run, and in what order

| Order | File | Notes |
|---|---|---|
| … | *(existing, already run)* `multi_org_tenancy` → … → `security_function_hardening` → `security_rpc_wrappers` | Unchanged except for the two add-to-list edits described in §2.4. Re-running them is safe and now also hardens `storage_usage_bytes`. |
| **1** | **`perf_storage_usage.sql`** | Requires `app_private` (i.e. after `security_function_hardening.sql`). Creates one function pair. |
| **2** | **`perf_rls_initplan.sql`** | **Run this LAST.** |

**The re-run rule, stated once:** `perf_rls_initplan.sql` must be re-applied after **any** migration that recreates a policy, because that migration's `create policy` re-installs the bare, per-row form. That is: `multi_org_tenancy.sql`, `beta_signups.sql`, `crm.sql`, `finance.sql`, `support_messaging.sql`, `analytics_events.sql`, `app_errors.sql`, `security_invites_hardening.sql`, `security_verified_email.sql`, `security_storage_policies.sql`, `brand_aliases.sql`, `listing_labels.sql`, `kanban_board.sql`, `vocab_tables.sql`, `vocab_models.sql`, `org_shopify_connections.sql`, `founding_user_admin.sql`.

It is **independent of** `security_function_hardening.sql` / `security_rpc_wrappers.sql` (those move functions, not policies) but belongs after them so the policies bind `public.<helper>`. For rollback, reverse the order: `perf_rls_initplan` → `perf_storage_usage` → `security_rpc_wrappers` → `security_function_hardening`.

Client code ships **before** any of this. Change 4 falls back to the bucket walk when the RPC is absent; changes 2, 3 and 5 are pure client logic.

---

## 5. Diagnostics: reading the CPU yourself

### 5.1 The query

`pg_stat_statements` is enabled on Supabase by default. Run this in the SQL Editor:

```sql
select
  round(total_exec_time)::bigint            as total_ms,
  calls,
  round(mean_exec_time::numeric, 2)         as mean_ms,
  round(100 * total_exec_time / nullif(sum(total_exec_time) over (), 0), 1) as pct_of_total,
  rows,
  left(regexp_replace(query, '\s+', ' ', 'g'), 140) as query
from pg_stat_statements
order by total_exec_time desc
limit 25;
```

Reset the counters before a measured window so you are looking at *now*, not since the last restart:

```sql
select pg_stat_statements_reset();
-- …use the app normally for 10–20 minutes…
-- then run the query above
```

### 5.2 How to read it

**Sort by `total_ms`, not `mean_ms`.** A 0.4 ms statement called 400 000 times costs more than a 900 ms report run twice. The app's problem was always the former.

Then classify each of the top 25:

| What you see | What it means | Where it comes from |
|---|---|---|
| `UPDATE workflow_batches SET workflow_state = $1, …` with **high `calls`** | The autosave blob. | Change 2. After shipping, `calls` should fall sharply and the remainder should correlate with real grouping activity, not typing. |
| `INSERT INTO products … ON CONFLICT (id)` with **`rows` ≫ what you changed** | The group mirror upsert. | Change 2c. `rows` per call should drop from batch-size to a handful. |
| `SELECT … FROM support_threads …` with `calls` ≈ *tabs × window ÷ 45 s* | The support poll. | Change 3. |
| `SELECT … FROM storage.objects WHERE bucket_id = … AND name LIKE …` with **thousands of calls** | The bucket walk. | Change 4. Should collapse to the single `storage_usage_bytes` call. |
| `crm_sync_contacts` / the `INSERT … ON CONFLICT` inside it | CRM sync. | Change 5. |
| A **helper function body** — `SELECT EXISTS (SELECT 1 FROM org_members m JOIN organizations o …)` — with an enormous `calls` count and a tiny `mean_ms` | **This is the per-row RLS evaluation.** It is the signature of the problem change 1 fixes: the function is cheap, and it is called a million times. | Change 1. This row should drop by orders of magnitude in `calls`. |

Two supporting queries worth having:

```sql
-- Are the new indexes being used? (idx_scan should be climbing)
select relname, indexrelname, idx_scan, idx_tup_read
from pg_stat_user_indexes
where indexrelname in ('products_batch_id_idx','product_images_product_id_idx',
                       'workflow_batches_org_updated_idx','crm_contacts_org_idx',
                       'analytics_events_session_created_idx','app_errors_session_created_idx')
order by idx_scan desc;

-- Sequential scans on big tables are where the remaining CPU hides
select relname, seq_scan, seq_tup_read, idx_scan,
       seq_tup_read / nullif(seq_scan, 0) as avg_rows_per_seq_scan
from pg_stat_user_tables
where seq_scan > 0
order by seq_tup_read desc
limit 15;
```

### 5.3 Expected before/after, per change

| Statement pattern | Before | After |
|---|---|---|
| Helper-function bodies (`org_members` EXISTS) | Top of the list by `calls` — one per row scanned by every policy-filtered query | Orders of magnitude fewer `calls`; `total_ms` should leave the top 25 |
| `UPDATE workflow_batches` | One per ~2 s of activity per active user, most changing nothing | Only when the slim payload genuinely changed, or every 5 min |
| `INSERT INTO products … ON CONFLICT` | `rows` = whole batch (800–1 500) per fire | `rows` = the items that changed |
| `SELECT … support_threads` | `calls` ≈ tabs × window ÷ 45 s | 0 while hidden; ÷4 while visible with Realtime up |
| `storage.objects` listing | ~2 518 calls per meter render | 1 |
| `crm_sync_contacts` + its upserts | Once per CRM panel open | Once per 10 min per session |

### 5.4 When the remaining CPU is **not** the app

After the above lands, re-run the top-25 and look at what is left. These are Supabase's own baseline, not your queries, and no amount of app work will move them:

- **`realtime.list_changes(...)`, `realtime.apply_rls(...)`, WAL slot reads.** Realtime polls the logical replication slot continuously. On `t4g.nano` this is a visible, permanent background cost and it scales with the number of subscribed tables and connected clients, not with your query volume. `select * from pg_replication_slots;` — a growing `confirmed_flush_lsn` lag here means Realtime is behind, which is its own problem.
- **`pg_stat_statements` / `pg_stat_activity` / `pg_stat_database` polled every few seconds.** That is the Supabase dashboard and the metrics exporter. It is small but never zero.
- **Supavisor / pooler churn.** `34/60` connections with a 0.5 GB instance is already a meaningful memory line: each backend reserves `work_mem` and its own catalog cache. Check `select state, count(*) from pg_stat_activity group by 1;` — a large `idle` count (not `idle in transaction`, which is a bug) is the pooler holding connections, and each idle backend still costs RAM. If `idle in transaction` is non-trivial, that **is** an app bug and worth chasing.
- **`authenticator` / GoTrue statements** — `SELECT … FROM auth.users WHERE …`, refresh-token rotation. Proportional to sign-ins and token refreshes.
- **Autovacuum.** `select relname, last_autovacuum, last_autoanalyze, n_dead_tup from pg_stat_user_tables order by n_dead_tup desc limit 10;`. The autosave UPDATE pattern generated a lot of dead tuples in `workflow_batches` (every UPDATE is a new row version plus a TOAST rewrite), so expect autovacuum there to *fall* after change 2 — but if `n_dead_tup` is high on a table you are not writing much, autovacuum is starved, and on a 2-shared-vCPU instance it competes directly with queries.

### 5.5 The honest conclusion

**If, after these changes, the top 25 by `total_exec_time` is dominated by `realtime.*`, `pg_stat_*` polling and auth statements — and the app's own statements are each a small slice — then the app is no longer the problem and `t4g.nano` is simply the wrong size.**

That instance is 2 **shared** (burstable) vCPUs and 0.5 GB RAM. Burstable means sustained load earns CPU credits down to a throttled baseline, which is exactly how a box ends up pinned at 96 % and staying there: once credits are exhausted, everything queues, queueing holds connections open, and held connections consume the little RAM there is. 34/60 connections on 0.5 GB is already tight before any query runs.

So the decision procedure is: ship these six changes, reset `pg_stat_statements`, run a normal working session, and look at the app's share of `total_exec_time`. If it is still the majority, there is more application work to do and this document's §5.2 table says where to look. If it is not — if the app's queries are individually cheap and collectively minor — **stop optimising and move to the next compute tier.** A `small` instance (2 dedicated vCPU, 2 GB) is the usual next step, and no further query tuning will substitute for it. Paying for the right box is a legitimate engineering answer; grinding a 0.5 GB shared instance for another 5 % is not.

---

## 6. Files

**New**
- `supabase/migrations/perf_rls_initplan.sql` — policy rewrite + 6 indexes, guarded, idempotent, rollback included
- `supabase/migrations/perf_storage_usage.sql` — `storage_usage_bytes()` pair, guarded, idempotent, rollback included
- `src/lib/productUpsertDedupe.ts` + `src/lib/productUpsertDedupe.test.ts` (13 tests)
- `docs/reviews/15-db-cpu.md` (this file)

**Changed**
- `src/lib/workflowBatchService.ts` — fingerprint registry, `'unchanged'` outcome, skip in `autoSaveWorkflowBatchDetailed`
- `src/App.tsx` — `AUTOSAVE_DEBOUNCE_MS` 2 000 → 5 000, `flushPendingAutoSave()`, changed-rows filter on the group upsert, storage meter via RPC with walk fallback + session cache
- `src/lib/supportStore.ts` — `supportPollInterval`, visibility-aware lifecycle, `pollIntervalMs()`
- `src/lib/supportService.ts` — optional `onStatus` on `subscribeToSupport`
- `src/lib/crmService.ts` — auto-sync throttle + the incremental-rewrite note
- `src/components/CrmPanel.tsx` — `loadCrm('auto' | 'manual' | 'none')`
- `supabase/migrations/security_function_hardening.sql`, `supabase/migrations/security_rpc_wrappers.sql` — `storage_usage_bytes` added to their lists
- `src/lib/workflowBatchService.test.ts` (+10), `src/lib/supportStore.test.ts` (+5), `src/lib/crmService.test.ts` (+6)

CLAUDE.md, README and CHANGELOG were not touched. Nothing was committed.
