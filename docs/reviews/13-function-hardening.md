# 13 — Function hardening (Supabase linter 0011 / 0028 / 0029)

**Date:** 2026-09-14 · **Deliverable:** `supabase/migrations/security_function_hardening.sql` (one file, additive, idempotent, rollback included) · **No source file, CLAUDE.md, README or CHANGELOG was touched. No SQL was run against Supabase.**

---

## 1. The warnings

| Rule | What it means | Where it fired |
|---|---|---|
| **0011** `function_search_path_mutable` | function has no pinned `search_path` → a caller can shadow an unqualified name | `public.crm_touch_updated_at`, `public.finance_touch_updated_at` |
| **0028** `anon_security_definer_function_executable` | a SECURITY DEFINER function in an exposed schema is executable by `anon` | **all 27** SECURITY DEFINER functions in `public` |
| **0029** `authenticated_security_definer_function_executable` | … executable by `authenticated` | **all 27** |

Nobody granted `anon` anything. `CREATE FUNCTION` grants EXECUTE **to PUBLIC by default**, and the project's `grant execute … to authenticated` lines never revoked it. Baseline measured on a throwaway cluster: `27 SD fns in public, 27 anon-executable`.

None of them leaks on its own — every one keys off `auth.uid()`, which is NULL for `anon`, and the founder RPCs raise `42501` — but a SECURITY DEFINER function reachable by the logged-out landing page is a standing invitation, and every future edit to one of those bodies would be written under the wrong assumption about who can reach it.

---

## 2. Per-function decision table

`Before` is the measured baseline (anon/auth EXECUTE). `After` is the measured end state. **RPC-facing set** re-derived by grepping `supabase.rpc(` over `src/` — note `financeService.ts` is detected as binary by BSD grep, so `grep -a` is required or `finance_summary` is missed.

### A — RPC-facing SECURITY DEFINER · stay in `public` · 0028 cleared, **0029 intentional**

| Function | Client call site | Before | After | Linter after |
|---|---|---|---|---|
| `analytics_summary(int)` | `src/lib/analytics.ts:239` | anon ✓ auth ✓ | anon ✗ auth ✓ | 0028 cleared · **0029 documented** |
| `app_errors_summary(int)` | `src/lib/errorReporter.ts:451` | anon ✓ auth ✓ | anon ✗ auth ✓ | 0028 cleared · **0029 documented** |
| `beta_org_directory()` | `src/lib/betaService.ts:132` | anon ✓ auth ✓ | anon ✗ auth ✓ | 0028 cleared · **0029 documented** |
| `crm_sync_contacts()` | `src/lib/crmService.ts:73` | anon ✓ auth ✓ | anon ✗ auth ✓ | 0028 cleared · **0029 documented** |
| `finance_summary(date,date)` | `src/lib/financeService.ts:591` | anon ✓ auth ✓ | anon ✗ auth ✓ | 0028 cleared · **0029 documented** |
| `founding_list_users()` | `src/lib/foundingAdminService.ts:58` | anon ✓ auth ✓ | anon ✗ auth ✓ | 0028 cleared · **0029 documented** |
| `founding_set_membership(uuid,uuid,text)` | `…:71` | anon ✓ auth ✓ | anon ✗ auth ✓ | 0028 cleared · **0029 documented** |
| `founding_remove_membership(uuid,uuid)` | `…:80` | anon ✓ auth ✓ | anon ✗ auth ✓ | 0028 cleared · **0029 documented** |
| `founding_move_user(uuid,uuid,uuid,text)` | `…:92` | anon ✓ auth ✓ | anon ✗ auth ✓ | 0028 cleared · **0029 documented** |

**Why 0029 must stay on these nine.** They have to live in the exposed schema to be callable over PostgREST, and SECURITY INVOKER is impossible: they read `auth.users` (which `authenticated` has no grant on) and cross-tenant rows that org RLS hides from their caller. The boundary is not the EXECUTE bit — it is `is_beta_admin()` / `assert_founding_admin()` in the first lines of each body, raising `42501`. Measured: a non-founder gets `42501` from all five gated RPCs, and `0 rows` from the two that return empty by design.

### B(i) — maintenance-only SECURITY DEFINER · no client caller · both cleared

| Function | Before | After | Linter after |
|---|---|---|---|
| `analytics_prune(int)` | anon ✓ auth ✓ | anon ✗ auth ✗ | 0028 + 0029 **cleared** |
| `app_errors_prune(int)` | anon ✓ auth ✓ | anon ✗ auth ✗ | 0028 + 0029 **cleared** |
| `get_next_batch_number(uuid)` / `()` *(legacy)* | anon ✓ auth ✓ | anon ✗ auth ✗ | cleared (skipped if absent) |
| `update_export_batch_stats(uuid)` *(legacy)* | anon ✓ auth ✓ | anon ✗ auth ✗ | cleared (skipped if absent) |

Zero hits for all of them across `src/` and `scripts/` (binary-safe `grep -a`). The founder runs the prunes from the SQL Editor, which connects as `postgres` — the **owner**, whose EXECUTE no revoke here touches. One line grants any of them back if a UI ever wants it.

### B(ii) — trigger functions + internal guards · both cleared

| Function | Kind | Before | After | Linter after |
|---|---|---|---|---|
| `analytics_rate_limit()` | SD trigger | anon ✓ auth ✓ | ✗ ✗ | 0028 + 0029 **cleared** |
| `app_errors_rate_limit()` | SD trigger | anon ✓ auth ✓ | ✗ ✗ | cleared |
| `support_after_message()` | SD trigger | anon ✓ auth ✓ | ✗ ✗ | cleared |
| `support_message_rate_limit()` | SD trigger | anon ✓ auth ✓ | ✗ ✗ | cleared |
| `support_thread_before_insert()` | SD trigger | anon ✓ auth ✓ | ✗ ✗ | cleared |
| `support_thread_before_update()` | SD trigger | anon ✓ auth ✓ | ✗ ✗ | cleared |
| `assert_founding_admin()` | SD guard (`perform`ed from the founding RPCs) | anon ✓ auth ✓ | ✗ ✗ | cleared |
| `guard_founding_admins()` | SD guard (the no-founding-admin rail) | anon ✓ auth ✓ | ✗ ✗ | cleared |
| `crm_touch_updated_at()` | plain trigger | ✓ ✓, **no search_path** | ✗ ✗, `search_path=public` | **0011 cleared** |
| `finance_touch_updated_at()` | plain trigger | ✓ ✓, **no search_path** | ✗ ✗, `search_path=public` | **0011 cleared** |
| `update_category_presets_updated_at()`, `update_categories_updated_at()`, `update_export_batches_updated_at()`, `handle_updated_at()`, `handle_new_user()` | legacy SD triggers | ✓ ✓ | ✗ ✗ | cleared (skipped if absent) |

### C — policy / column-default helpers · **moved to `app_private`** · both cleared

| Function | Consumed by | Before | After | Linter after |
|---|---|---|---|---|
| `is_beta_admin()` | ~68 policy references | `public`, SD, anon ✓ auth ✓ | `app_private`, SD, anon ✗ auth ✓ **+ `public` invoker wrapper** | 0028 + 0029 **cleared** |
| `user_org_ids()` | ~48 policy references | idem | idem | cleared |
| `default_org_id()` | ~19 refs, incl. the `org_id` **column DEFAULT** on 8 tables | idem | idem | cleared |
| `is_org_admin(uuid)` | ~24 policy references | idem | idem | cleared |
| `org_has_members(uuid)` | 5 policy references | idem | idem | cleared |
| `invited_role(uuid)` | `org_members_insert` policy | idem | idem | cleared |
| `auth_email_verified()` | 13 refs (`search_path=public, auth` preserved) | idem | idem | cleared |
| `storage_prefix_writable(text)` | 4 `storage.objects` policies | idem | idem | cleared |

### Deliberately untouched

`public.my_email()` and `public.canonical_heard(text)` are **SECURITY INVOKER** (no 0028/0029) and already pin `search_path`. `my_email()` is a column DEFAULT on `brand_aliases.created_by_email` and `canonical_heard()` backs a CHECK constraint **and a unique index** on the same table — both need EXECUTE by the inserting role (see E2/E4 below). They stay in `public` with their grants intact. `anon` retains EXECUTE on both, which is harmless: `anon` has no grant on `brand_aliases`, and the functions only read the caller's own JWT / do string math.

---

## 3. Empirical proofs

All on a throwaway PostgreSQL 14.21 cluster (`/opt/homebrew/opt/postgresql@14/bin`, `initdb --encoding=UTF8 --locale=en_US.UTF-8`, started with `-k /tmp -c wal_level=logical`), with the repo's own stub `auth`/`storage` schema. Each claim in the migration's header comment maps to a probe here.

| # | Claim under test | Method | Result |
|---|---|---|---|
| **E1** | An **RLS policy** expression requires the *invoking* role to hold EXECUTE on the functions it calls | policy `with check (probe.h())`, `revoke all on function probe.h() from public`, insert as `authenticated` | ❌ **`ERROR: permission denied for function h`** → EXECUTE is **required**. This is why Group C keeps `grant execute … to authenticated` on the moved functions |
| **E2** | A **column DEFAULT** requires EXECUTE | column `val int default probe.d()`, EXECUTE revoked | ❌ **`permission denied for function d`** → required |
| **E3** | **Trigger firing does NOT require EXECUTE** | `before insert` trigger on `probe.trg()`, EXECUTE revoked from PUBLIC (verified `has_function_privilege = f`), insert as `authenticated` | ✅ **row inserted, `note = 'trigger-ran'`** → the trigger manager calls it on the table's behalf. **This is the whole basis for treatment B** |
| **E4** | A **CHECK constraint** requires EXECUTE | `check (probe.c(name))`, EXECUTE revoked, everything else granted | ❌ **`permission denied for function c`** → required (why `canonical_heard` keeps its grant) |
| **E5** | Policies / DEFAULTs / triggers follow a function **by OID** across `ALTER FUNCTION … SET SCHEMA` | moved `probe.h/d/trg` to `probe_priv`, re-read catalogs, re-inserted | ✅ policy shows `probe_priv.h()`, default shows `probe_priv.d()`, `pg_get_triggerdef` shows `probe_priv.trg()`, **insert succeeded unchanged** |
| **E6** | A **function BODY does not** — `language sql` *and* `plpgsql` bodies are stored as text and re-resolve `public.x()` at execution | created `ck_sql`/`ck_pl` calling `probe.k()`, moved `probe.k()` away, called each in a **fresh session** | ❌ both: **`ERROR: function probe.k() does not exist`**. After adding a same-name SECURITY INVOKER wrapper: ✅ **both return `true` again**. **This is why section 3 exists** — 68 `public.is_beta_admin(` references live inside other function bodies (`beta_org_directory`, `finance_summary`, `support_thread_before_insert`, the `founding_*` RPCs, …) and every one would have broken |
| **E7** | `anon` needs none of the Group C helpers | catalog sweep: the only tables `anon` may INSERT into are `analytics_events`, `app_errors`, `beta_signups`; none has a helper in a policy **or a column default** (the `default_org_id()` defaults are all on tables `anon` cannot touch) | ✅ confirmed, then confirmed again functionally (T6 below) |

### Functional smoke — applied state, single pass, clean cluster

Apply order used: stub → `multi_org_tenancy` → `beta_signups` → `analytics_events` → `crm` → `support_messaging` → `app_errors` → `security_invites_hardening` → `security_verified_email` → `security_abuse_limits` → `security_storage_policies` → `finance` → `brand_aliases` → `listing_labels` → **`beta_admin_directory` + `founding_user_admin`** (added: the linter names their functions, so they are in production) → **`security_function_hardening`**.

| Test | Result |
|---|---|
| T1 founder calls all 9 RPC-facing functions | ✅ `analytics_summary`, `app_errors_summary`, `finance_summary`, `crm_sync_contacts` return jsonb; `beta_org_directory` 2 rows; `founding_list_users` 4 rows; `founding_set_membership` / `founding_move_user` / `founding_remove_membership` all succeed |
| T2 non-founder | ✅ `42501` from `analytics_summary`, `app_errors_summary`, `crm_sync_contacts`, `finance_summary`, `founding_set_membership`; `0 rows` from `beta_org_directory` and `founding_list_users` (by design) |
| T3 RLS through the **moved** helpers | ✅ tenant sees exactly 1 org + 1 membership; wrappers return `user_org_ids=1`, `default_org_id=<own org>`, `is_org_admin=true`, `is_beta_admin=false`, `auth_email_verified=true`, `storage_prefix_writable(self/stranger)=true/false` |
| T4 `org_id` column DEFAULT `default_org_id()` | ✅ `products` and `workflow_batches` inserts auto-fill `org_id` with the tenant org and read back through org RLS |
| T5 support thread insert | ✅ `has EXECUTE on support_thread_before_insert = false`, yet the SD trigger derived `org_name = 'Tenant Co'`, and `support_after_message` set `last_message_preview` |
| T6 anon writes | ✅ `analytics_events`, `app_errors`, `beta_signups` inserts all succeed with `anon EXECUTE on analytics_rate_limit = false`; flooding 130 rows trips **`sqlstate=54000 "analytics: rate limit for this session"`** — the SD trigger provably still runs |
| T7 anon reachability | ✅ **0 of 17** probes reachable (8 wrappers/helpers, 6 RPCs, 2 prunes, 1 trigger fn, plus `app_private.is_beta_admin()` which fails at schema USAGE) |
| T8 touch triggers | ✅ `finance_touch_updated_at` and `crm_touch_updated_at` both fire with EXECUTE revoked and `search_path` now pinned |
| T9 founding lockout rail | ✅ 2nd founding admin removable; removing the **last** one raises `23514` and rolls back; count stays 1 — the guards still run with EXECUTE revoked |
| Idempotency | ✅ runs 2 and 3 produce zero errors/warnings and an **identical catalog hash** (`281ddeb5…`) — no re-move, no re-pin |
| **Rollback** | ✅ from the clean hardened state the block restores the catalog hash **exactly** to the pre-hardening baseline `99875b6a07eb89c8f56fec34a2a96f5b` (31 functions × schema/signature/secdef/anon/auth/service_role), policies re-point to `public.is_beta_admin()`, `app_private` dropped |

### The rollback flaw the harness found

The first rollback draft did `drop function public.is_beta_admin()` unconditionally and **failed** with `2BP01 … policy beta_select on table beta_signups depends on function is_beta_admin()` — because `beta_signups.sql` had been replayed in between, and the policies it recreated bound to the **wrapper**. The shipped block now catches `dependent_objects_still_exist` per helper, **never cascades**, names the dependent policies, and leaves that one helper hardened (a fully working state); the final `drop schema … restrict` refuses rather than destroying live policies. The clean-state rollback was then re-verified end to end.

---

## 4. Forward risk — "re-run after"

Every file below contains `create or replace function public.<Group-C-helper>`. Replaying one plants a fresh **SECURITY DEFINER copy in `public`** beside the `app_private` original.

**Measured blast radius:** replaying `beta_signups.sql` produced `public.is_beta_admin() sd=t auth=t` — 0029 returns. **0028 did *not*** return, because `create or replace` **preserves the existing ACL** (it replaced the wrapper, keeping `anon ✗`). A migration that `DROP`s before creating would reset the ACL to PUBLIC and bring 0028 back too. Crucially, policies and defaults **kept pointing at the `app_private` OID** and the app kept working — *a linter regression, not an outage*.

**Re-run `security_function_hardening.sql` after any of:**

| Migration file | Group C helpers it recreates |
|---|---|
| `supabase/migrations/multi_org_tenancy.sql` | `user_org_ids`, `default_org_id`, `is_org_admin`, `org_has_members`, `invited_role` |
| `supabase/migrations/beta_signups.sql` | `is_beta_admin` |
| `supabase/migrations/security_verified_email.sql` | `auth_email_verified`, `invited_role` |
| `supabase/migrations/security_storage_policies.sql` | `storage_prefix_writable` |

Replaying anything else (`analytics_events`, `app_errors`, `crm`, `support_messaging`, `security_abuse_limits`, `finance`, `beta_admin_directory`, `founding_user_admin`, `fix_linter_issues`, `export_library`) re-adds `grant execute … to authenticated` on its own Group A/B functions, so the same rule applies: **after replaying any migration, re-run this file.** It is idempotent and a no-op when nothing drifted.

**Verified repair:** after the `beta_signups.sql` replay, one re-run of the hardening file turned the stray SD copy back into the invoker wrapper (`sd=f`) and returned the catalog hash to the canonical `281ddeb5…`.

---

## 5. Run order

```
# in the Supabase SQL Editor, as postgres, AFTER a DB backup
1. (already applied) multi_org_tenancy.sql, beta_signups.sql, beta_admin_directory.sql,
   founding_user_admin.sql, analytics_events.sql, crm.sql, support_messaging.sql,
   app_errors.sql, security_invites_hardening.sql, security_verified_email.sql,
   security_abuse_limits.sql, security_storage_policies.sql, finance.sql,
   brand_aliases.sql, listing_labels.sql
2. security_function_hardening.sql          ← this file, last
3. paste the two VERIFY queries at the bottom of the file
4. re-run the Supabase database linter
```

Expected linter result: **0011 gone**, **0028 gone**, **0029 down to the nine Group A functions**.

---

## 6. Ready-to-paste doc lines

### CLAUDE.md §9 — under *Supabase*, after the **RLS** bullets

```markdown
- **Function privileges (Sept 2026, `supabase/migrations/security_function_hardening.sql`):** `CREATE FUNCTION`
  grants EXECUTE to PUBLIC, so every SECURITY DEFINER function was reachable by `anon` until this file. Three
  rules now hold, and new SQL must keep them. (1) **Policy / column-DEFAULT helpers live in `app_private`,
  not `public`** — `is_beta_admin`, `user_org_ids`, `default_org_id`, `is_org_admin`, `org_has_members`,
  `invited_role`, `auth_email_verified`, `storage_prefix_writable`. A same-name **SECURITY INVOKER wrapper**
  stays in `public` so every function body that says `public.is_beta_admin()` keeps resolving — a sql/plpgsql
  body is stored as TEXT and re-resolves at execution, unlike a policy, which is bound by OID and followed the
  move. (2) **Trigger functions and internal guards have EXECUTE revoked from PUBLIC, anon AND authenticated**
  — a trigger fires without the invoking role holding EXECUTE (proven). (3) **The nine RPC-facing functions
  keep `authenticated`** — `analytics_summary`, `app_errors_summary`, `beta_org_directory`, `crm_sync_contacts`,
  `finance_summary` and the four `founding_*`. Linter 0029 stays raised on those nine **by design**: they must
  sit in the exposed schema to be callable, and their real boundary is the `is_beta_admin()` check that raises
  42501. **Re-running `multi_org_tenancy.sql`, `beta_signups.sql`, `security_verified_email.sql` or
  `security_storage_policies.sql` plants a public SECURITY DEFINER copy beside the wrapper — re-run the
  hardening file afterwards.**
```

### CLAUDE.md §16 — new row in the status table

```markdown
| Function-privilege hardening (linter 0011/0028/0029) | **Written — migration not yet run** | `supabase/migrations/security_function_hardening.sql`: moves the 8 policy/default helpers into `app_private` behind same-name SECURITY INVOKER wrappers, revokes PUBLIC/anon from every SECURITY DEFINER function, revokes `authenticated` too from the 15 trigger/guard/maintenance ones, and pins `search_path` on `crm_touch_updated_at` + `finance_touch_updated_at`. Additive, idempotent, rollback at the bottom; verified on a throwaway PG 14 (rollback restores the exact pre-state). Ship code first — no client change is needed — then run the SQL. |
```

### CLAUDE.md §18 — new "Do Not" entries

```markdown
18. **Do not `create or replace` one of the eight org/founder helpers in `public`.** `is_beta_admin`,
    `user_org_ids`, `default_org_id`, `is_org_admin`, `org_has_members`, `invited_role`,
    `auth_email_verified` and `storage_prefix_writable` live in `app_private`; `public.<name>` is a
    SECURITY INVOKER wrapper. Redefining the public name replaces the wrapper with a SECURITY DEFINER
    copy and re-raises linter 0029. Edit the `app_private` function, or re-run
    `security_function_hardening.sql` after whatever replanted it.

19. **Do not "fix" a trigger function by granting EXECUTE back to `authenticated` or `anon`.** Triggers
    fire without it (verified). If a trigger appears not to run, the cause is the trigger definition or
    RLS, never the EXECUTE bit.

20. **Do not add a new SECURITY DEFINER function to `public` without deciding its group.** RPC the client
    calls → `public`, `revoke from public, anon`, `grant to authenticated`, and gate the body on
    `is_beta_admin()`. Anything a policy, DEFAULT or another function calls → `app_private` + a `public`
    SECURITY INVOKER wrapper. Trigger or internal guard → `public`, EXECUTE revoked from all three client
    roles. Always `set search_path`. Then add it to `security_function_hardening.sql`.
```

### CHANGELOG bullet

```markdown
- **Database function hardening (linter 0011 / 0028 / 0029)** — `CREATE FUNCTION` grants EXECUTE to PUBLIC,
  so all 27 SECURITY DEFINER functions were callable by the logged-out `anon` role. New migration
  `supabase/migrations/security_function_hardening.sql`: the eight helpers that policies and `org_id` column
  DEFAULTs call move into a new unexposed `app_private` schema (with same-name SECURITY INVOKER wrappers in
  `public`, because function bodies re-resolve names at execution time while policies are bound by OID);
  the fifteen trigger functions, internal guards and maintenance routines lose EXECUTE from PUBLIC, `anon`
  **and** `authenticated` (a trigger fires without it); the nine RPCs the client actually calls keep
  `authenticated` and lose `anon`. `crm_touch_updated_at` and `finance_touch_updated_at` get a pinned
  `search_path`. Additive, idempotent, rollback included; verified on a throwaway PostgreSQL 14 — founder
  RPCs, tenant RLS, anon analytics writes, the support triggers and the founding-admin lockout rail all
  behave identically, and the rollback restores the catalog byte for byte. No client code changes.
```

---

## 7 — Follow-up: `security_rpc_wrappers.sql` (clearing the last nine 0029s)

**Production result of §1–§6:** the founder ran `security_function_hardening.sql`. The linter now reports **0011 gone, 0028 gone**, and 0029 on exactly the predicted set — `analytics_summary`, `beta_org_directory`, `crm_sync_contacts`, `finance_summary`, `founding_list_users`, `founding_move_user`, `founding_remove_membership`, `founding_set_membership`.

> **`app_errors_summary` is absent from the linter output**, which means `supabase/migrations/app_errors.sql` was **never applied in production**. Nothing in the app breaks from that — `errorReporter.ts` treats a missing table/function as "reporting unavailable" and latches off — but the Errors view will stay empty until that migration is run. It is **still handled in both hardening files** (every statement is guarded by `to_regprocedure`, so it is a logged no-op today and correct the moment `app_errors.sql` is applied).

### 7.1 The decision

The §2 rationale for leaving 0029 raised was *"the function must stay in the exposed schema to be callable."* That is true of the **callable entry point** — it is not true of the **definer rights**. Splitting the two removes the warning without weakening anything:

- the SECURITY DEFINER body moves to `app_private` (unexposed, so the linter cannot see it);
- a **SECURITY INVOKER wrapper with an identical signature** stays in `public`, so `/rest/v1/rpc/<fn>` answers byte-for-byte as before and **no client code changes**;
- both halves are granted to `authenticated` only (the wrapper to let the request in; the original because an invoker wrapper runs as the caller), PUBLIC and `anon` revoked from both.

| Function | Args (verbatim, incl. DEFAULTs) | Returns | Vol | Before | After | Linter |
|---|---|---|---|---|---|---|
| `analytics_summary` | `p_days int default 30` | `jsonb` | v | `public` SD, auth ✓ | `app_private` SD + `public` invoker wrapper | **0029 cleared** |
| `app_errors_summary` | `p_days int default 7` | `jsonb` | v | *(not applied in prod)* | idem, guarded | cleared when applied |
| `finance_summary` | `p_from date, p_to date` | `jsonb` | v | `public` SD, auth ✓ | idem | **cleared** |
| `crm_sync_contacts` | — | `jsonb` | v | `public` SD, auth ✓ | idem | **cleared** |
| `beta_org_directory` | — | `table(org_id, name, slug, plan, created_at, member_count, member_emails, batch_count, product_count, image_count, last_active)` | **s** | `public` SD, auth ✓ | idem | **cleared** |
| `founding_list_users` | — | `table(user_id, email, created_at, last_sign_in_at, memberships)` | **s** | `public` SD, auth ✓ | idem | **cleared** |
| `founding_set_membership` | `p_user uuid, p_org uuid, p_role text` | `void` | v | `public` SD, auth ✓ | idem | **cleared** |
| `founding_remove_membership` | `p_user uuid, p_org uuid` | `void` | v | `public` SD, auth ✓ | idem | **cleared** |
| `founding_move_user` | `p_user uuid, p_from_org uuid, p_to_org uuid, p_role text default null` | `void` | v | `public` SD, auth ✓ | idem | **cleared** |

**Why the signature is copied verbatim rather than retyped.** PostgREST resolves an RPC by matching the POSTed JSON keys to **argument names**, and renders the response from the **return type**. So a wrapper must reproduce: the argument names `src/` actually sends (re-verified with `grep -a '\.rpc(' src/lib` → `p_days`, `p_from`/`p_to`, `p_user`/`p_org`/`p_role`, `p_user`/`p_from_org`/`p_to_org`/`p_role`); the **DEFAULTs**, so a call that omits `p_days` or `p_role` still resolves; the full **`returns table` column list in order**, because PostgREST names the JSON keys from it and a reordered column is a silent client break; and the **volatility**, because PostgREST allows GET only for non-volatile functions. `pg_get_function_arguments` / `pg_get_function_result` were diffed between each wrapper and its original — **all nine identical**, `prosecdef` the only difference.

### 7.2 Proofs (throwaway PG 14.21, full chain + both files, then destroyed)

| Test | Result |
|---|---|
| **Result equality** — md5 over `analytics_summary` + `finance_summary` (volatile `from`/`to` keys stripped) + every row of `beta_org_directory` + `founding_list_users`, captured **before** the wrappers and **after** | ✅ `ffbfff7ccb742f68a5d56570896f2d41` **both times** |
| Signature fidelity, all 18 catalog rows | ✅ args, DEFAULTs, return type, TABLE column names/types/**order**, volatility identical; `prosecdef` t → f on the `public` half only |
| W1 founder, **named arguments as `src/` sends them** | ✅ all nine; `analytics_summary()` still defaults to 30 days, `app_errors_summary()` to 7, `founding_move_user` resolves with `p_role` **omitted** |
| W1.9 table column names/order | ✅ `org_id,name,slug,plan,created_at,member_count,member_emails,batch_count,product_count,image_count,last_active` |
| W2 non-founder through the wrapper | ✅ `42501` from all 7 gated RPCs (the `is_beta_admin()` gate resolves the §2 helper wrapper correctly); `0 rows` from the two readers |
| W3 anon | ✅ **0 of 18** reachable (9 wrappers + 9 `app_private` originals; the latter also fail at schema USAGE) |
| W4 §1–§6 hardening not disturbed | ✅ tenant org RLS, `org_id` DEFAULT, SD support trigger all unchanged |
| W5 founding lockout rail through the wrapper | ✅ `23514`, rolled back, count stays 1 |
| Idempotency | ✅ runs 2 and 3 identical catalog hash (`6abc7466…`); **re-running `security_function_hardening.sql` on top is also a no-op** — its Group A list resolves to these wrappers and merely re-applies their grants |
| Replay + repair | ✅ replaying `crm.sql` plants `public.crm_sync_contacts sd=t` (0029 returns; app keeps working). Notably it **also** regressed `crm_touch_updated_at`'s pinned `search_path` — so the rule is **re-run file 1, then file 2**; doing so restored the canonical hash exactly |
| **Layered rollback** | ✅ rollback #2 → **byte-identical diff** against the after-file-1 state; then rollback #1 → pristine **except** the two deliberately-retained `search_path` pins; `app_private` dropped |
| Rollback **order** is enforced, not just documented | ✅ `drop schema app_private restrict` (the last line of file 1's rollback) **refuses** while the nine still live there: `cannot drop schema app_private because other objects depend on it` |
| Final linter equivalents | ✅ 0028/0029 → **NONE**; 0011 → **NONE** |

**A rollback bug the harness caught (second time lucky).** Rollback #2's first draft ended each move with `grant execute … to public`, restoring the *pristine* grant. Measured: that re-raised `anon ✓` on all nine while `security_function_hardening.sql` was still in force — a silent half-undo of the first file. It now restores the **file-1 privilege shape** (revoke PUBLIC/anon, grant `authenticated` + `service_role`) inline, and the diff against the after-file-1 dump is now empty.

### 7.3 Re-run after

| Migration file | RPCs it replants |
|---|---|
| `analytics_events.sql` | `analytics_summary` |
| `app_errors.sql` | `app_errors_summary` |
| `beta_admin_directory.sql` | `beta_org_directory` |
| `crm.sql` | `crm_sync_contacts` (**and** `crm_touch_updated_at`'s search_path) |
| `finance.sql` | `finance_summary` (**and** `finance_touch_updated_at`'s search_path) |
| `founding_user_admin.sql` | `founding_list_users`, `founding_set_membership`, `founding_remove_membership`, `founding_move_user` |

General rule, unchanged and now measured: **after replaying any migration, run `security_function_hardening.sql` and then `security_rpc_wrappers.sql`.** Both are no-ops when nothing drifted.

**Run order:** `security_function_hardening.sql` → `security_rpc_wrappers.sql`. **Rollback order is the reverse**, and the database enforces it.

### 7.4 ⚠ The linter is now blind — §18 is the only remaining guard

After this file **no SECURITY DEFINER function anywhere in the exposed schema is executable by `anon` or `authenticated`** (measured: `NONE`). That is the goal, and it is also the hazard: **0028 and 0029 have nothing left to report, so they will not warn you about the next one either.** Ten SECURITY DEFINER functions still sit in `public` (the triggers, guards and prune routines) — they are invisible to the linter only because their EXECUTE is revoked, and a single stray `grant execute … to authenticated` would re-expose one without a peep. From here on, the grouping rules in CLAUDE.md §18 are the control, not the linter.

### 7.5 Paste-ready doc lines (follow-up)

**CLAUDE.md §9 — replace the last sentence of the §6 block above ("…keep `authenticated` … 42501.") with:**

```markdown
  (3) **The nine RPC-facing functions are split** (`security_rpc_wrappers.sql`): the SECURITY DEFINER body
  lives in `app_private` and a SECURITY INVOKER wrapper with an IDENTICAL signature stays in `public`, so
  `/rest/v1/rpc/<fn>` is unchanged and no client code moved. "Identical" is literal — PostgREST resolves by
  ARGUMENT NAME and renders from the RETURN TYPE, so the wrapper copies the arg names `src/` sends
  (`p_days`, `p_from`/`p_to`, `p_user`/`p_org`/`p_role`, `p_from_org`/`p_to_org`), the DEFAULTs, the
  `returns table (...)` column list in order, and the volatility. After this file **no SECURITY DEFINER
  function in `public` is executable by `anon` or `authenticated`** — 0028/0029 have nothing left to report,
  which also means THE LINTER WILL NOT CATCH THE NEXT ONE. §18 is the guard now. Re-run order after any
  migration replay: `security_function_hardening.sql`, then `security_rpc_wrappers.sql`; rollback order is
  the reverse (the first file's `drop schema app_private restrict` refuses otherwise).
```

**CLAUDE.md §16 — replace the row from §6 with:**

```markdown
| Function-privilege hardening (linter 0011/0028/0029) | **Done — both migrations run** | `security_function_hardening.sql` (helpers → `app_private` behind invoker wrappers; EXECUTE revoked from PUBLIC/anon everywhere, and from `authenticated` too on the 15 trigger/guard/maintenance functions; `search_path` pinned on the two touch triggers) then `security_rpc_wrappers.sql` (the nine client RPCs split into an `app_private` definer body + an identical-signature `public` invoker wrapper). Linter: 0011, 0028 and 0029 all clear. No client code changed. `app_errors.sql` is **not applied in production** — its function is handled but inert. Both files are idempotent; re-run them in that order after replaying any migration. |
```

**CLAUDE.md §18 — amend rule 18 and add rule 21:**

```markdown
18. **Do not `create or replace` an org/founder helper OR a client RPC in `public`.** The eight helpers
    (`is_beta_admin`, `user_org_ids`, `default_org_id`, `is_org_admin`, `org_has_members`, `invited_role`,
    `auth_email_verified`, `storage_prefix_writable`) AND the nine RPCs (`analytics_summary`,
    `app_errors_summary`, `beta_org_directory`, `crm_sync_contacts`, `finance_summary`, `founding_list_users`,
    `founding_set_membership`, `founding_remove_membership`, `founding_move_user`) live in `app_private`;
    `public.<name>` is a SECURITY INVOKER wrapper. Redefining the public name replaces the wrapper with a
    SECURITY DEFINER copy and re-raises 0029. Edit the `app_private` function, or re-run
    `security_function_hardening.sql` then `security_rpc_wrappers.sql`.

21. **Do not change a wrapper's signature without changing its `app_private` twin identically.** PostgREST
    resolves RPCs by ARGUMENT NAME and renders the response from the RETURN TYPE, so renaming an argument,
    dropping a DEFAULT, reordering a `returns table` column, or changing volatility silently breaks `src/`
    with no type error and no failing test. Diff `pg_get_function_arguments` and `pg_get_function_result`
    between the two halves after any edit.
```

**CHANGELOG bullet:**

```markdown
- **The last nine database linter warnings cleared** — `supabase/migrations/security_rpc_wrappers.sql`
  finishes what `security_function_hardening.sql` started. The nine functions the client calls through
  `supabase.rpc(...)` kept warning 0029 because they had to stay in the exposed schema to be callable; that
  was true of the entry point, not of the definer rights. Each SECURITY DEFINER body now lives in the
  unexposed `app_private` schema behind a SECURITY INVOKER wrapper in `public` whose signature is identical
  down to argument names, DEFAULTs, `returns table` column order and volatility — so `/rest/v1/rpc/<fn>`
  answers exactly as before and **no client code changed** (verified: identical result hash, founder access,
  42501 for non-founders, zero anon reachability across all 18 functions, and a byte-identical layered
  rollback). Supabase's linter now reports nothing: 0011, 0028 and 0029 all clear. Note that this also means
  the linter can no longer flag a NEW SECURITY DEFINER function — CLAUDE.md §18 is the guard from here.
```

---

## Summary

- Two new migrations, no source/CLAUDE.md/README/CHANGELOG edits, nothing committed, no SQL run against Supabase.
- `security_function_hardening.sql` (§1–§6) shipped and is **live**: linter 0011 and 0028 gone, 0029 down to the nine client RPCs, exactly as predicted.
- `security_rpc_wrappers.sql` (§7) clears those nine by splitting each into an `app_private` SECURITY DEFINER body + an identical-signature `public` SECURITY INVOKER wrapper — same arg names, DEFAULTs, `returns table` column order and volatility, so PostgREST and `src/` are untouched.
- Verified on a throwaway PG 14 and destroyed: identical RPC result hash before/after, founder access intact, 42501 for non-founders, **0 of 18** anon-reachable, idempotent across three runs, layered rollback byte-identical.
- Two rollback bugs were found *by* the harness and fixed: file 1 cascading over replay-bound policies, and file 2 restoring PUBLIC instead of the file-1 privilege shape.
- `app_errors.sql` is **not applied in production** (its function is missing from the linter output) — handled but inert in both files; the Errors view stays empty until it is run.
- After both files the linter can no longer see any SECURITY DEFINER function, so **CLAUDE.md §18 is the only remaining guard** — paste-ready §9/§16/§18/CHANGELOG text is in §6 and §7.5.
