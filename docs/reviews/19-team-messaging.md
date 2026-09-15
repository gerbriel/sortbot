# 19 — Team messaging: a second KIND of conversation on the messaging tables

**Date:** 15 Sept 2026 · **Scope:** `supabase/migrations/team_messaging.sql` (new),
`perf_rls_initplan.sql` §8, `src/lib/supportService.ts`, `src/lib/supportStore.ts`,
`src/components/MessagesView.tsx` + `.css`, `src/components/SupportWidget.tsx`,
`src/App.tsx` (six lines) · **Nothing committed. No SQL was run against Supabase.**

The ask: *"today messaging is one kind of conversation — a user's thread with the
founders' shared inbox. I want a second kind: team threads with people in your own
workspace."* Support threads keep working exactly as they do; team threads are private
to their participants; **founders must not see other workspaces' team threads.**

---

## 1. The model, and the one decision everything follows from

`support_threads` / `support_messages` already existed and already had the right shape
for a conversation. What they did not have was a notion of *who is in it* — support has
two implied sides (the owner, and every founding admin), which is why the read markers
are two columns and the roles are `user` / `founder`.

So the change is one discriminator column and one roster table:

| | `kind = 'support'` | `kind = 'team'` |
|---|---|---|
| participants | implied: `user_id` + every founding admin | enumerated in `support_thread_members` |
| roles | `user` / `founder` | `member`, for everyone |
| founder access | every thread, in every workspace | **only as a participant of their own workspace** |
| read marker | `user_last_read_at` / `founder_last_read_at` | my own `support_thread_members.last_read_at` |
| unread | "the other SIDE wrote last, after my stamp" | "the last message is **not mine**, and is newer than my stamp" |
| close / reopen | founder triage | not offered — there is no desk to close it |

`kind` defaults to `'support'`, so **the migration backfills nothing and no existing row
changes meaning.** That is the property that makes the whole thing shippable: a database
that has not run the file behaves as it does today, and one that has behaves as it did
for every row written before it.

**The creator gets a participant row like everybody else.** It would have been cheaper to
treat `support_threads.user_id` as "member zero", but then every policy, every unread
computation and every roster render carries an "…or I am the creator" clause, and the
first one that forgets it is a silent access bug. One rule, checked in one place.

**Why founders are locked out of team threads.** `is_beta_admin()` is a cross-tenant
power — it already reaches every workspace's membership, the CRM, and every support
thread. Extending it to private colleague-to-colleague messages would make every
workspace's internal chat readable by us, which is not a promise this product can keep
and not one anybody asked for. Every policy's founder branch is therefore gated on
`kind = 'support'`. A founder reaches a team thread the same way anyone does: by being in
it, in their own workspace.

---

## 2. The two things that were not obvious

### 2.1 The policies are mutually recursive if written the obvious way

`support_threads_select` has to ask *am I a participant of this thread?* — a read of
`support_thread_members`. `support_thread_members_select` has to ask *is this a thread I
belong to?*. Written as plain sub-selects, evaluating either one requires evaluating the
other, and Postgres answers:

```
ERROR:  infinite recursion detected in policy for relation "support_threads"
```

The cut has to happen somewhere. The options were (a) duplicate the membership rule
inside one of the two policies as raw SQL, or (b) put it in a SECURITY DEFINER function
that reads the roster as the table owner, where RLS does not apply. (a) means the same
security boundary written twice, which AGENTS.md §18 exists to prevent. So:

```sql
app_private.is_thread_participant(p_thread uuid)   -- SECURITY DEFINER, stable
public.is_thread_participant(p_thread uuid)        -- SECURITY INVOKER wrapper
```

created in `app_private` **from the start**, behind a `public` invoker wrapper, exactly
the shape `security_function_hardening.sql` produces for the other eight policy helpers
(§18 #45) — so that file never has to move it and its re-run order is unaffected. Both
halves keep `grant execute … to authenticated`, which is not optional: an RLS expression
requires the *invoking* role to hold EXECUTE on what it calls.

### 2.2 Unread needed a new column, not a new rule

`isUnread` used to be *"`last_sender_role` is the other side, and `last_message_at` is
newer than my column"*. With N participants there is no "other side" to name — `member`
is every side. The missing fact is **who** wrote last, so `support_threads.last_sender_id`
is added, maintained by the same `support_after_message` trigger that already maintains
`last_message_at` / `_preview` / `_role`, and kept out of the client UPDATE grant so it is
no more forgeable than the others. A `member` message stamps the **sender's own
participant row** instead of one of the two support columns.

`support_thread_members.last_read_at` defaults to `now()`, which is what makes somebody
added to a conversation later see only the messages sent *after* they joined — and it is
also why `createTeamThread` writes the roster **before** the first message.

---

## 3. The ordering hazard, and why it had to be handled here

`perf_rls_initplan.sql` (written, not yet run) recreates every RLS policy with its helper
calls wrapped as `(select …)`. Its section 8 recreates precisely the five policies this
feature rewrites — `support_threads_select`, `_insert`, `_update`, `support_messages_select`,
`_insert` — with their **pre-team** definitions. Run it after `team_messaging.sql` and team
visibility would be silently revoked, with nothing failing: threads would simply stop
appearing, the roster table would still be there, and every test would still pass.

**It is worse than a revoke, and the verification run proved it.** With
`perf_rls_initplan.sql` applied on top of `team_messaging.sql` unmodified, participant B lost
their own thread and could no longer post into it — *and founder E, in an unrelated workspace,
gained read access to that team thread and could post `'founder'` into it.* The restored
policies are `user_id = auth.uid() or is_beta_admin()` with no `kind` test, so the file did not
merely undo the feature: it inverted the one guarantee the feature exists to make. Scenario 13
in §5 is that failure, and the same scenario passing afterwards.

Both files therefore end in the same state now, in either order:

- `team_messaging.sql` writes its policies **already InitPlan-wrapped**, so it is not
  undoing the perf work when it runs second.
- `perf_rls_initplan.sql` §8 branches on whether `support_threads.kind` exists and emits
  the NEW definitions when it does, the original ones when it does not — so it stays
  correct on a database where team messaging was never installed.

Recommended order is stated in both headers: `team_messaging.sql`, then
`perf_rls_initplan.sql` last, as that file's own header already requires of every
migration that touches a policy. `security_function_hardening.sql` and
`security_rpc_wrappers.sql` need **no** re-run: this file replaces one trigger function
(treatment B — it re-states its own revokes) and creates its new helper in `app_private`
already.

---

## 4. Schema and policies as shipped

**`support_threads`** gains `kind text not null default 'support'` (CHECK
`in ('support','team')`), `last_sender_id uuid references auth.users on delete set null`,
an index on `(kind, last_message_at desc)`, and a **DELETE** grant + policy scoped to
`kind = 'team' and user_id = auth.uid()`. The two `sender_role` / `last_sender_role`
CHECKs are widened to accept `'member'` — the originals are unnamed inline column checks,
so the migration finds them by scanning `pg_constraint` for a definition mentioning the
column rather than trusting the auto-generated name, and re-adds them under a name it owns.

**`support_thread_members`** is `(thread_id, user_id)` PK — that PK *is* the "in a
conversation at most once" rule, so a double-add hits 23505 rather than creating a second
row — plus `email` (denormalised, because `auth.users` is not client-readable and the
thread list has to print who is in a conversation), `last_read_at` and `added_at`.
Grants are column-level: `insert (thread_id, user_id, email)`, `update (last_read_at)`.

| Policy | Rule |
|---|---|
| `support_threads_select` / `_update` | mine, **or** (`kind='support'` and founding admin), **or** I have a participant row |
| `support_threads_delete` | `kind='team'` and I created it |
| `support_thread_members_select` | my own row, or any row of a thread I am in |
| `support_thread_members_insert` | the thread is `kind='team'` **and I created it** **and** the new `user_id` is really in `org_members` for that thread's `org_id`, with a matching (case-insensitive) email |
| `support_thread_members_update` | my own row only (and only `last_read_at` is granted) |
| `support_thread_members_delete` | my own row (leave), or any row of a thread I created |
| `support_messages_select` | the thread is visible to me, written out rather than delegated |
| `support_messages_insert` | `sender_id = me` **and** (`user` on a support thread I own · `founder` on a support thread, as a founding admin · `member` on a team thread I am in) |

`support_threads_insert` is deliberately **not** recreated: it belongs to
`security_verified_email.sql` (it carries the verified-email condition) and a team thread
needs nothing extra from it — the row is still `user_id = me`, and
`security_abuse_limits.sql`'s BEFORE INSERT trigger still derives `org_id` / `org_name`
from the caller's real membership, which is what makes the members INSERT policy's
`org_members` check meaningful.

The members INSERT policy proving the *product* relationship is the same shape as
`product_labels` in `listing_labels.sql`: a guessed `user_id` from another workspace is
rejected by the database, not just by the picker.

### 4.1 The rollback has a mandatory PRE-STEP, for the same reason

The ROLLBACK block at the bottom of the migration is a sequence of top-level statements, not one
transaction, and its last act is narrowing the two role CHECKs — which **refuses to install while
a `'member'` row survives**. An operator following it literally on a live database therefore gets
half way (members table dropped, helper dropped, pre-team policies already restored) and stops.
In that half-way state the restored `support_threads_select` is the old
`user_id = auth.uid() or is_beta_admin()` with no `kind` test, so **every surviving team
conversation, bodies included, appears in the founders' inbox** — reproduced on the throwaway
cluster, where founder E in an unrelated workspace read a team thread's subject, preview and
message body.

Deleting the team *threads* is not tidying up either: once `kind` is dropped there is no later
moment at which a team thread can be told apart from a support one. So the block now opens with
an explicit PRE-STEP giving both `delete` statements, why the block is not atomic, what the
half-way state exposes, and that the conversations must be exported first if they are to be
kept. No executable statement changed. (`perf_rls_initplan.sql` §8 also handles this state: if
`kind` exists but the helper does not, it raises a NOTICE and falls back rather than aborting.)

`support_thread_members` joins the realtime publication so that live read receipts are a
client-only change later, but **nothing subscribes to it** — a read marker moving is not
news worth a render, and it arrives with the next poll. It is deliberately left at the
default replica identity, unlike the other two tables: its policy keys on the primary key,
so FULL buys nothing and would put a participant's email in a DELETE payload.

---

## 5. Throwaway-Postgres verification

Nothing in this run touched Supabase. Everything below ran against a local cluster created
for this task and thrown away afterwards. No commits.

```
initdb  -D <scratch>/pgtm --encoding=UTF8 --locale=en_US.UTF-8
pg_ctl  -D <scratch>/pgtm -o "-k /tmp -p 55470 -c wal_level=logical" start
psql    -c "create role postgres login superuser;"
createdb -O postgres verify
→ PostgreSQL 14.21 (Homebrew) on aarch64-apple-darwin24.6.0
```

Identities are impersonated the way earlier passes did it — inside a transaction:

```sql
begin;
  set local role authenticated;
  set local "request.jwt.claim.sub" = '<uuid>';
  set local "request.jwt.claims"    = '{"sub":"<uuid>","email":"<addr>","role":"authenticated"}';
  <statement>
commit;
```

Scripts used: `tm-stub.sql`, `tm-apply.sh`, `tm-run.sh`, `tm-fixture.sql`, `tm-rebuild.sh`,
`tm-s1to3.sh`, `tm-s4to8.sh`, `tm-s9.sh`, `tm-s10.sh`, `tm-s12b.sh`, `tm-s13.sh`, `tm-full.sh`.
Full raw log: `tm-full.log`.

---

### Files changed

| File | Change |
|---|---|
| `supabase/migrations/team_messaging.sql` | One comment block added: an explicit **PRE-STEP** at the top of the ROLLBACK section (bug 1 below). No executable statement changed. |
| `supabase/migrations/perf_rls_initplan.sql` | **Section 8 rewritten to branch on the schema** (Task B), the commented section-8 rollback mirrored, and the file header's RE-RUN ORDER list updated. Nothing outside section 8 / its rollback / the header was touched. |

No other file was opened for writing. `src/**`, `AGENTS.md`, `CHANGELOG.md` and `docs/**` were
being edited concurrently by another worker and are untouched here.

---

### Apply chain

The chain in the task brief needed three additions before `perf_rls_initplan.sql` could run at
all. **None of them is caused by `team_messaging.sql`** — they are pre-existing unguarded
dependencies in `perf_rls_initplan.sql`, reproduced below and now written into that file's
header:

| Failure on the literal brief chain | Cause |
|---|---|
| `perf:180 ERROR: function public.auth_email_verified() does not exist` | section 1 (`org_invites_select`) calls it; it is created by `security_verified_email.sql`, which the brief chain omitted |
| `perf:662 ERROR: relation "public.analytics_events" does not exist` | section 10's first `create index` is unguarded (every other index in that section is behind `to_regclass`) |
| `perf:629 ERROR: function public.storage_prefix_writable(text) does not exist` | section 11 is guarded on `storage.objects` existing, not on the helper; the helper comes from `security_storage_policies.sql` |

Each is a `do $$ … $$` block or a bare statement that aborts atomically, so nothing was left
half-applied — but the file stops there. Fixed in the harness by adding the three migrations;
documented in the perf header rather than "fixed", because those sections are outside the
edit scope for this task.

Final chain, all `exit=0`:

```
───── apply: tm-stub.sql ─────                      exit=0     (auth/storage stub + the 5 data tables)
───── apply: multi_org_tenancy.sql ─────            exit=0
───── apply: beta_signups.sql ─────                 exit=0
───── apply: support_messaging.sql ─────            exit=0
───── apply: analytics_events.sql ─────             exit=0     (added: perf §10 needs the table)
───── apply: security_abuse_limits.sql ─────        exit=0
───── apply: security_invites_hardening.sql ─────   exit=0     (added: AGENTS §16 puts it before verified_email)
───── apply: security_storage_policies.sql ─────    exit=0     (added: perf §11 needs storage_prefix_writable)
───── apply: security_verified_email.sql ─────      exit=0     (added: perf §1 needs auth_email_verified)
───── apply: security_function_hardening.sql ─────  exit=0
───── apply: team_messaging.sql ─────               exit=0
───── apply: perf_rls_initplan.sql ─────            exit=0
fixture loaded
```

`security_function_hardening.sql` applied **cleanly** on the stub (it moved
`is_beta_admin`, `user_org_ids`, `default_org_id`, `is_org_admin`, `org_has_members`,
`invited_role` into `app_private` and left same-name invoker wrappers in `public`), so no
scenario is affected by its absence.

`team_messaging.sql`'s own first-run output was six `NOTICE … does not exist, skipping` lines
for the policies it drops before creating, and `NOTICE: schema "app_private" already exists`.
No warnings, no errors.

#### Fixture

Inserted as `postgres` so RLS cannot hide a fixture mistake.

| | |
|---|---|
| Org **X** `1111…` "Shop X", slug `shop-x` | members **A** (owner, `a@shopx.test`), **B** (member), **C** (member) |
| Org **Y** `2222…` "Founding Workspace", slug **`founding`** | member **E** (owner, `e@founding.test`) → `is_beta_admin()` is true for E only |
| Org **Z** `3333…` "Shop Z", slug `shop-z` | member **D** (owner, `d@shopz.test`) |

All five `auth.users` rows carry `email_confirmed_at`, which is
`security_verified_email.sql`'s precondition. Every `org_members` row carries `email`,
because `support_thread_members_insert` matches against it.

---

### Scenarios

#### 1 — A creates a team thread with B — **PASS**

```
--- 1a  insert support_threads (kind='team')  [as A] ---
    INSERT 0 1
--- 1b  insert both participant rows (A and B)  [as A] ---
    INSERT 0 2
--- 1c  insert first message, sender_role='member'  [as A] ---
    INSERT 0 1
--- 1d  the row as stored  [as postgres] ---
     kind |               user_id                |                org_id                | org_name | last_sender_role |            last_sender_id            |            preview
    ------+--------------------------------------+--------------------------------------+----------+------------------+--------------------------------------+--------------------------------
     team | aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa | 11111111-1111-1111-1111-111111111111 | Shop X   | member           | aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa | Can you pull the denim rail to
--- 1e  participants  [as postgres] ---
                   user_id                |    email     | stamped_to_msg
    --------------------------------------+--------------+----------------
     aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa | a@shopx.test | t
     bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb | b@shopx.test | f
```

`org_id`/`org_name` were derived by `security_abuse_limits.sql`'s BEFORE INSERT trigger, not
supplied. `last_sender_id` is A. The sender's own participant row was stamped to the message
(`t`); the recipient's was not (`f`) — the §6 trigger extension works.

#### 2 — thread visibility — **PASS**

| as | sees |
|---|---|
| **A** (creator) | `support / Export is stuck`, `team / Restock plan` |
| **B** (participant) | `team / Restock plan` |
| **C** (same workspace, not a participant) | 0 rows |
| **D** (other workspace) | 0 rows |
| **E** (founding admin, other workspace) | `support / Export is stuck` **only** |

```
--- 2  select support_threads  [as C] ---     (0 rows)
--- 2  select support_threads  [as D] ---     (0 rows)
--- 2  select support_threads  [as E] ---
                      id                  |  kind   |     subject
    --------------------------------------+---------+-----------------
     05a00000-0000-0000-0000-000000000002 | support | Export is stuck
    (1 row)
```

This is the header's central claim: `is_beta_admin()` reaches the support thread and stops at
the team thread.

#### 3 — messages follow the thread — **PASS**

A: 2 rows (support/user + team/member). B: 1 row (team/member). **C, D: 0 rows. E: the
support message only.**

#### 4 — adding an outsider is rejected — **PASS**

```
--- 4  A adds D (member of org Z)              [as A] --- ERROR:  new row violates row-level security policy for table "support_thread_members"
--- 4b A adds D with the email omitted         [as A] --- ERROR:  new row violates row-level security policy for table "support_thread_members"
--- 4c B (participant, not creator) adds C     [as B] --- ERROR:  new row violates row-level security policy for table "support_thread_members"
```

4b matters: omitting `email` skips the email half of the check but not the `org_members`
existence half, so the org proof cannot be sidestepped. 4c confirms only the creator adds.

#### 5 — a non-participant cannot post — **PASS**

C (same org) and D (other org) both get `42501` on `support_messages`.

#### 6 — role policing — **PASS**

| | result |
|---|---|
| E posts `founder` into the **team** thread | rejected |
| A posts `user` into the **team** thread | rejected |
| E posts `member` into the **support** thread | rejected |
| E posts `founder` into the **support** thread | `INSERT 0 1` |

#### 7 — unread bookkeeping — **PASS**

```
--- 7a B posts 'member' on the team thread  [as B] --- INSERT 0 1
--- 7b thread last_sender_*  --- last_sender_role = member | sender_is_b = t
--- 7c read stamps vs the new message ---
        email     | stamped_to_new_msg
    --------------+--------------------
     a@shopx.test | f          ← A's stamp NOT bumped
     b@shopx.test | t          ← B's own stamp bumped to the message
--- 7d A's unread  (last_message_at > last_read_at and last_sender_id <> me) --- t
--- 7e A marks their own row read     [as A] --- UPDATE 1
--- 7f A's unread now --- f
--- 7g A tries to mark B's row read   [as A] --- UPDATE 0     ← filtered by the policy, not an error
```

#### 8 — column grants — **PASS**

```
--- 8a A updates added_at     [as A] --- ERROR:  42501: permission denied for table support_thread_members
--- 8b A inserts last_read_at [as A] --- ERROR:  permission denied for table support_thread_members
```

Note on wording: PostgreSQL 14 reports `permission denied for **table**` (SQLSTATE `42501`,
`aclcheck_error, aclchk.c:3454`) rather than naming the column. The refusal is a privilege
refusal, not an RLS one, which is what the grant design intends. Effective grants:

```
     grantee    | privilege_type |                     cols
 ---------------+----------------+-----------------------------------------------
  authenticated | INSERT         | email,thread_id,user_id
  authenticated | SELECT         | added_at,email,last_read_at,thread_id,user_id
  authenticated | UPDATE         | last_read_at
```

#### 9 — creator cleanup — **PASS**

```
before:  threads 1 | members 2 | messages 2
--- 9b B (participant, not creator) deletes the team thread [as B] --- DELETE 0
--- 9c A deletes their own SUPPORT thread                   [as A] --- DELETE 0
--- 9d A deletes the TEAM thread                            [as A] --- DELETE 1
after:   threads 0 | members 0 | messages 0          ← FK cascade
support thread untouched: threads 1 | messages 2
```

#### 10 — support threads byte-for-byte unchanged — **PASS**

```
  kind   | status | last_sender_role | last_sender_is_e | user_stamp_is_user_msg | founder_stamp_is_founder_msg
 support | open   | founder          | t                | t                      | t
```

`user_last_read_at` / `founder_last_read_at` are stamped by the trigger exactly as before;
A's support unread is `t` before marking read and `f` after; A moving
`founder_last_read_at` is silently reverted by `security_abuse_limits.sql`'s BEFORE UPDATE
trigger (`founder_stamp_untouched = t`); A still cannot see D's support thread; E sees both
support threads and no team thread.

#### 11 — idempotence — **PASS**

Re-applying `team_messaging.sql` produced only `already exists, skipping` notices, `exit=0`.

```
kind census before: support 1 | team 1
kind census after:  support 1 | team 1

support_messages_sender_role_check     | CHECK ((sender_role = ANY (ARRAY['user','founder','member'])))
support_threads_last_sender_role_check | CHECK (((last_sender_role IS NULL) OR (last_sender_role = ANY (ARRAY['user','founder','member']))))
support_threads_kind_check             | CHECK ((kind = ANY (ARRAY['support','team'])))
support_threads_status_check           | unchanged
support_threads_subject_check          | unchanged
support_messages_body_check            | unchanged
```

The §3 drop-by-definition loop found only its own constraints the second time; the two
unrelated CHECKs on each table (`status`, `subject`, `body`) were not matched. Visibility
checks for A/B/C/D/E re-run after the second apply: identical to scenario 2 and 3.

#### 12 — rollback, then re-apply — **PASS (after fixing bug 1)**

**12a — first attempt, exactly as the file shipped.** The rollback block is a sequence of
top-level statements, not one transaction, so `ON_ERROR_STOP` left the database half-rolled-back:

```
───── apply: tm-rollback.sql ─────
  ERROR:  check constraint "support_messages_sender_role_check" of relation "support_messages" is violated by some row
  exit=3

state after:  members_table = (null) | helper = (null) | team_threads_left = 1
policies now: support_threads_{select,insert,update}, support_messages_{select,insert}   ← the PRE-TEAM set
```

and then, as **E, a founding admin in an unrelated workspace**:

```
--- 12a4 E now sees the TEAM thread  [as E] ---
      kind   |     subject     |                preview
    ---------+-----------------+---------------------------------------
     support | Export is stuck | My CSV download does nothing.
     team    | Restock plan    | Can you pull the denim rail tomorrow?
--- 12a5 ... and its private messages  [as E] ---
     team    | member      | Can you pull the denim rail tomorrow?
```

That is bug 1 (below). Fix: a PRE-STEP block added at the top of the ROLLBACK section.

**12b — with the pre-step, the rollback runs clean in one pass:**

```
--- 12p1 delete member messages and team threads --- DELETE 1
───── apply: tm-rollback.sql ─────  exit=0
 new_cols_left | members_table | helper | authed_can_delete | policy_count
             0 |               |        | f                 |            5
 support_messages_sender_role_check     | CHECK ((sender_role = ANY (ARRAY['user','founder'])))
 support_threads_last_sender_role_check | CHECK (((last_sender_role IS NULL) OR (last_sender_role = ANY (ARRAY['user','founder']))))
```

`kind` and `last_sender_id` gone, the members table and both helper halves gone, the DELETE
grant revoked, exactly the five `support_messaging.sql` policies back.

**12c — support messaging still works after the rollback:**

```
C opens a thread + posts 'user'   → INSERT 0 1 / INSERT 0 1
E replies 'founder'               → INSERT 0 1
C sees only their own thread · E sees all threads · A sees only their own
a 'member' message is now refused → ERROR: new row violates row-level security policy
```

**12d — re-apply `team_messaging.sql`, re-run scenarios 1-3:** `exit=0`, and 1/2/3 produce
output identical to the first run (A sees both, B sees the team thread, C and D see nothing,
E sees the support thread only).

One honest note: the rollback restores `support_messaging.sql`'s policy *text*, i.e. the
un-`(select …)`-wrapped form. Re-running `perf_rls_initplan.sql` afterwards re-wraps them
through the new else branch. That is the documented re-run order, not a defect.

#### 13 — after `perf_rls_initplan.sql` — **FAIL before the Task B fix, PASS after**

**Before** (the file as it shipped, run after `team_messaging.sql`):

```
--- 2 support_threads  [as B] ---   (0 rows)                 ← participant lost their own thread
--- 2 support_threads  [as E] ---   support | Export is stuck
                                    team    | Restock plan   ← FOUNDER NOW SEES THE TEAM THREAD
--- 3 support_messages [as B] ---   (0 rows)
--- 3 support_messages [as E] ---   support/user + team/member  ← and its private messages
--- 5c B (participant) posts 'member' -> expect success --- ERROR: new row violates RLS
--- 6a E 'founder' into TEAM -> expect reject --- INSERT 0 1  ← accepted
--- 6b A 'user'    into TEAM -> expect reject --- INSERT 0 1  ← accepted
```

Four of the five recreated policies are the pre-team text, and the pre-team
`support_threads_select` is `user_id = me or is_beta_admin()` with no `kind` test — so it
does not merely revoke team access, it *inverts* the privacy guarantee. (Interestingly
`support_threads_delete` and the three `support_thread_members` policies survived, because
`perf_rls_initplan.sql` never mentions them — a half-broken state is worse than a wholly
broken one.)

**After** the section-8 branch, on the same clean build:

```
--- 2 [A] support+team · [B] team · [C] 0 · [D] 0 · [E] support only
--- 3 [A] 2 rows · [B] team/member · [C] 0 · [D] 0 · [E] support/user only
--- 5  C posts 'member' -> ERROR (RLS)      5b D posts 'member' -> ERROR (RLS)
--- 5c B (participant) posts 'member' -> INSERT 0 1
--- 6a E 'founder' into TEAM    -> ERROR (RLS)
--- 6b A 'user'    into TEAM    -> ERROR (RLS)
--- 6c E 'member'  into SUPPORT -> ERROR (RLS)
--- 6d E 'founder' into SUPPORT -> INSERT 0 1
--- X1 B reads the roster -> a@shopx.test, b@shopx.test
--- X2 A adds D (outsider) -> ERROR (RLS)
--- X3 A deletes the team thread -> DELETE 1
```

Identical to the pre-perf results, statement for statement.

#### 14 — recursion — **PASS**

`support_threads_select` reads `support_thread_members` (through the helper) and
`support_thread_members_select` asks about `support_threads`; the SECURITY DEFINER helper is
what breaks the cycle. Forced all three policy sets to evaluate in one statement, as a
participant who is *not* the thread owner (so the `user_id = auth.uid()` short-circuit cannot
mask it), with `VERBOSITY verbose`:

```
--- 14a B joins threads x members x messages  [as B] ---
     kind |   subject    | participants | messages
     team | Restock plan |            2 |        2
--- 14b B reads the roster directly  [as B] --- a@shopx.test, b@shopx.test
--- 14c D (in no thread at all)      [as D] --- count = 0
```

`grep "ERROR.*42P17\|ERROR.*infinite recursion"` over the whole run log: **none**.

#### 15 — function privileges — **PASS**

```
   nspname   |        proname        | security_definer |     args
 app_private | is_thread_participant | t                | p_thread uuid
 public      | is_thread_participant | f                | p_thread uuid

 anon_public | authed_public | anon_private | authed_private
 f           | t             | f            | t

 support_after_message():  anon_exec = f | authed_exec = f
```

`has_function_privilege('anon','public.is_thread_participant(uuid)','execute')` is **false**
and `('authenticated', …)` is **true**, on both halves. The trigger function keeps EXECUTE
revoked from all three client roles and the trigger still fires (scenarios 1, 7, 10 prove it).

---

### Bugs found and fixed

#### Bug 1 — the ROLLBACK block can half-finish and expose every team conversation to the founders

**Found by scenario 12a. Fixed in `team_messaging.sql` (comment only).**

The block's existing note — *"Narrow the CHECKs back (fails if any 'member' row survives —
clear them first)"* — is true but sits at the bottom, describes only the message CHECK, and
does not say what state a failure leaves behind. Because the block is a sequence of top-level
statements rather than one transaction, an operator following it literally on a live database
gets: the members table dropped, the helper dropped, the pre-team policies already restored,
and then a hard stop at the CHECK. In that state every surviving `kind='team'` thread is
matched by the restored `user_id = auth.uid() or public.is_beta_admin()` and appears, with its
message bodies, in the founders' inbox — demonstrated above as user E.

Deleting the team *threads* is also not optional: once `kind` is dropped there is no later
moment at which a team thread can be told apart from a support thread.

Fix: a PRE-STEP block at the top of the ROLLBACK section giving the two `delete` statements,
why the block is not atomic, what the half-way state exposes, and that the conversations must
be exported first if they are to be kept. No executable statement in the migration changed.
Re-verified: with the pre-step the rollback runs to completion in one pass (scenario 12b).

#### Bug 2 — `perf_rls_initplan.sql` silently revokes team access *and* inverts the privacy guarantee

**Found by scenario 13. Fixed in `perf_rls_initplan.sql` section 8 — this is Task B.**

Detailed above. Section 8 now branches; see the next section.

#### Not a bug in `team_messaging.sql`, recorded anyway

`perf_rls_initplan.sql` has three unguarded prerequisites (`auth_email_verified`,
`analytics_events`, `storage_prefix_writable`) that abort the file on a database missing the
migration that supplies them. Those sections are outside this task's edit scope, so they were
not changed; a paragraph naming all three was added to that file's header, where the RE-RUN
ORDER note already lives.

---

### Task B — `perf_rls_initplan.sql` section 8

Section 8 now:

1. Creates `support_threads_insert` **once, outside the branch** — it is owned by
   `security_verified_email.sql`, is identical either way, and was not otherwise touched.
2. Computes `team_ready` = the `support_threads.kind` column exists **and**
   `public.is_thread_participant(uuid)` exists.
3. `team_ready` → installs the definitions **textually identical to `team_messaging.sql` §8**
   (`support_threads_select` / `_update` / `_delete`, `support_messages_select` / `_insert`),
   plus the four `support_thread_members` policies behind
   `to_regclass('public.support_thread_members') is not null`.
4. otherwise → the existing `support_messaging.sql` definitions, unchanged.
5. If `kind` exists but the helper does not — the reachable half-rolled-back state from bug 1 —
   it raises a `NOTICE` naming the situation and falls back, rather than aborting the section.

Also updated: the file header's RE-RUN ORDER list now includes `team_messaging.sql`, with a
sentence saying it is the one entry whose order does not matter; and the commented section-8
ROLLBACK now guards the pre-team text on `kind` being absent, with a `raise notice` and an
explanation of why restoring it on a team-enabled database is the wrong move.

#### Both orders, and the no-team case

```
════════ (i)  team_messaging.sql → perf_rls_initplan.sql ════════   scenarios 2,3,5,6 + X1-X3: PASS
════════ (ii) perf_rls_initplan.sql → team_messaging.sql ════════   scenarios 2,3,5,6 + X1-X3: PASS
```

Stronger than matching behaviour — the two live policy sets are textually identical. Dumped
`tablename|policyname|cmd|qual|with_check` for all three tables from each build and diffed:

```
=== diff of the live policy set, order (i) vs order (ii) ===
IDENTICAL (no output above)

       tablename        |          policyname           |  cmd
 support_messages       | support_messages_insert       | INSERT
 support_messages       | support_messages_select       | SELECT
 support_thread_members | support_thread_members_delete | DELETE
 support_thread_members | support_thread_members_insert | INSERT
 support_thread_members | support_thread_members_select | SELECT
 support_thread_members | support_thread_members_update | UPDATE
 support_threads        | support_threads_delete        | DELETE
 support_threads        | support_threads_insert        | INSERT
 support_threads        | support_threads_select        | SELECT
 support_threads        | support_threads_update        | UPDATE
(10 rows)
```

**No-team database (the else branch).** Rebuilt the chain without `team_messaging.sql`:

```
───── apply: perf_rls_initplan.sql ─────  exit=0
(no section-8 notice → the else branch ran silently, as intended)

--- diff: else branch (new file) vs the file as it was before this edit ---
IDENTICAL — the no-team outcome is byte-for-byte unchanged
```

and support messaging itself still works there: A opens a thread and posts `user`, E replies
`founder`, A and E see it, B does not, and
`information_schema.columns … column_name='kind'` returns 0, proving it was the else branch.

**Half-rolled-back database (`kind` present, helper gone):**

```
NOTICE:  perf_rls_initplan: support_threads.kind exists but public.is_thread_participant(uuid)
         does not — installing the PRE-TEAM policies. Re-run team_messaging.sql (or finish its
         rollback) and then re-run this file.
exit=0
       policyname       |  cmd
 support_threads_insert | INSERT
 support_threads_select | SELECT
 support_threads_update | UPDATE
```

**Idempotence of the edited file:** applied `perf_rls_initplan.sql` a second and third time on
the team build, then `team_messaging.sql` again on top of that. All `exit=0`, and the dumped
policy set was unchanged after each.

---

### Summary

| # | Scenario | Verdict |
|---|---|---|
| 1 | A creates a team thread with B (thread + members + message) | **PASS** |
| 2 | Visibility: A ✓ B ✓ C ✗ D ✗ E ✗(team) ✓(support) | **PASS** |
| 3 | Messages follow the thread | **PASS** |
| 4 | Adding an outsider rejected (with and without `email`; non-creator too) | **PASS** |
| 5 | Non-participant cannot post | **PASS** |
| 6 | Role policing, all four cases | **PASS** |
| 7 | Unread bookkeeping, incl. "cannot move someone else's stamp" | **PASS** |
| 8 | Column grants on `added_at` / `last_read_at` | **PASS** |
| 9 | Creator cleanup: cascade yes, support thread no, non-creator no | **PASS** |
| 10 | Support threads byte-for-byte unchanged | **PASS** |
| 11 | Idempotence of `team_messaging.sql` | **PASS** |
| 12 | Rollback then re-apply | **PASS** (after bug 1 fixed; 12a recorded as the failure) |
| 13 | After `perf_rls_initplan.sql` | **FAIL before Task B, PASS after** |
| 14 | No `42P17` infinite recursion anywhere | **PASS** |
| 15 | `is_thread_participant` execute privileges + table grants | **PASS** |
| B | Both run orders end in an identical policy set; no-team branch unchanged | **PASS** |

### Not verified, and why

- **Realtime.** `support_thread_members` is added to the `supabase_realtime` publication and
  the cluster ran with `wal_level=logical`, but no replication slot was opened and no
  `postgres_changes` payload was inspected. The claim that the default replica identity is
  sufficient for this table's `(thread_id, user_id)` policy — and that a DELETE payload
  therefore carries no `email` — is reasoned from the policy shape, not observed on the wire.
- **`auth.uid()` / `auth.jwt()` are stubs** reading `current_setting('request.jwt.claim*')`.
  They match real Supabase semantics for everything exercised here, but nothing about GoTrue
  token issuance, refresh or `role` switching was tested.
- **No client code was run.** `supportService.ts` / `supportStore.ts` were being edited by
  another worker during this pass; whether the client sends the column list these grants
  allow (notably: never `last_read_at` on INSERT, never `kind` on UPDATE) is not checked here.
- **No PostgREST.** Everything went through `psql`, so error *shapes* the client sees
  (`42501` vs a PostgREST `401`/`403` envelope) are not verified.
- **Quota interaction.** `security_abuse_limits.sql`'s 20-open-threads quota counts a user's
  team threads alongside their support threads. That is current behaviour, not a regression,
  and was not exercised — it needs 20 threads to trigger.
- **Scale.** Single-row fixtures throughout; no assertion that
  `(select public.is_thread_participant(id))` plans as a SubPlan rather than a per-row
  Function Scan (the file itself says correlated helpers stay SubPlans, so there is nothing to
  regress), and no `EXPLAIN ANALYZE` was taken.


---

## 6. Client changes

**`supportService.ts`** — `SupportRole` gains `'member'`; new `ThreadKind`,
`ThreadMember`; `SupportThread` gains `kind`, `last_sender_id`, `members`.

- `fetchThreads()` selects the new columns plus an aliased embed
  (`members:support_thread_members(...)`). On `42703` / `PGRST200` / `PGRST204` /
  `PGRST100` — undefined column, no relationship found, column missing from the schema
  cache, parse failure: all four are "old schema", not "broken" — it retries with the
  original column list and returns `teamAvailable: false`. Any other error is still
  `'unavailable'`, with **no** pointless retry (asserted).
- `normalizeThread` fills `kind: 'support'`, `last_sender_id: null`, `members: []` so the
  rest of the app has ONE shape either way.
- `createTeamThread()` is three writes — thread, roster, first message — and **deletes the
  thread** if either of the last two fails. A half-built conversation with no participants
  is visible to its creator forever and unrecoverable from the UI; the new team-only
  DELETE policy exists for exactly this caller. Asserted in both failure positions.
- `isUnread` / `sortThreads` / `unreadThreadCount` take an optional `myUserId`. Without
  one, a team thread reads as **read** — a badge that cannot be cleared is worse than no
  badge.
- `messageRole(thread, isFounder)` — `member` on a team thread including for a founder,
  who is a colleague there and not staff.

**`supportStore.ts`** — state gains `teamAvailable`; `applyReadStamp` and
`applySentMessage` gained the team branch (my participant row rather than a column) and
`last_sender_id`; `filterThreads` gained `kind` and now searches participant emails,
because on a team thread the emails *are* the name of the conversation and nothing else in
the row carries them; new `supportActions.startTeamThread`;
`useSupportThreads(role, myUserId)` returns `teamAvailable` plus a second count,
`supportUnreadCount` (support threads only). The single channel / single poll / ref-count
design is untouched (§18 #27).

**`MessagesView.tsx`** — an All / Support / Team chip row (shown whenever team messaging
is migrated, even with no team threads yet: it is how the second kind announces itself), a
kind mark per row, the other participants' emails as a team row's title, a participant
count in the conversation header, and **one inline compose panel** that starts either
kind. Deliberately inline and not a modal: at ≤1024px this page is already a one-column
list/conversation swap, and a dialog on top of that is a third layer to escape on a phone.
Teammates come from `fetchOrgMembers(orgId)`, loaded when the panel opens rather than on
mount, with an empty state for "no teammates yet" and one for legacy (no workspace) mode. My own
participant row takes its email from **that** query rather than from the JWT, because
`org_members.email` is the column the INSERT policy checks it against — the same string today,
but not necessarily forever.
Close / Reopen is not offered on a team thread. "You:" in a row preview keys on
`last_sender_id` with a fallback to the old two-sided test, so it does not disappear on
pre-migration rows.

**`SupportWidget.tsx`** — behaviour unchanged, filtered to `kind !== 'team'` and badged
with `supportUnreadCount`. The floating button is the line to the Arcadian team; a
colleague's message appearing in it would read as a support reply.

**`App.tsx`** — six lines: `userId` into `AccountNav` (the header badge counts both kinds)
and `userId` + `orgId` into `MessagesView`, plus the widened ToolView description.

---

## 7. Gates

| Gate | Before | After |
|---|---|---|
| `npx vitest run` | 1,137 / 56 files | **1,157 / 56 files, green** (+20) |
| `npm run build` | clean | **clean** (the pre-existing "dynamically imported by" warning is unchanged) |
| `npx eslint .` | 252 | **252** — the recorded baseline, not raised |

New tests: 13 in `supportService.test.ts` (team unread in all five shapes, participants
and roles, the pre-migration fallback and its non-retry, `createTeamThread` happy path and
both cleanup-on-failure positions, pre-network guards) and 7 in `supportStore.test.ts`
(the team branch of both optimistic transitions, the kind filter and participant search,
`markRead` writing `support_thread_members` and not the thread row, `startTeamThread`
landing at the top of the list, `teamAvailable` following the fetch).

---

## 8. What is NOT verified

- **Nothing was run signed in.** No agent in this environment can authenticate, so the
  Messages page, the compose panel, the chip rows and the widget's filter were verified
  from the types, the tests and the CSS — not from a rendered app. The unread arithmetic,
  the fallback, the optimistic writes and every policy are covered by tests or by the
  Postgres transcript; the *rendering* is not.
- **No Realtime run.** The subscription is unchanged and `support_thread_members` is
  deliberately not subscribed, so there is nothing new to observe, but the store's
  behaviour under a live burst is still only exercised against the mock.
- **The 20-open-threads quota is now shared.** `security_abuse_limits.sql`'s
  `support_thread_before_insert` counts every open thread I *started*, which now includes
  team threads. Narrowing it to `kind = 'support'` means editing that file's trigger
  function, which would put the same function body in two migrations and create exactly
  the drift §3 is about. Left as-is and recorded in AGENTS.md §16; it is a founder's call
  whether 20 is the right shared number.
- **Realtime was not observed on the wire.** The cluster ran with `wal_level=logical` and the
  table is in the publication, but no replication slot was opened and no `postgres_changes`
  payload was inspected. The claim that the default replica identity is sufficient here — and
  that a DELETE payload therefore carries no participant email — is reasoned from the policy
  shape, not measured.
- **Nothing went through PostgREST.** Every scenario ran in `psql`, so the error *shapes* the
  client sees (a bare `42501` versus a PostgREST envelope) are not verified, and neither is the
  assumption behind the pre-migration fallback that a missing embed answers `PGRST200`.
- **Three pre-existing gaps in `perf_rls_initplan.sql`** surfaced while building the apply
  chain and were documented in that file's header rather than fixed, being outside this pass's
  edit scope: section 1 calls `auth_email_verified()` (needs `security_verified_email.sql`),
  section 11 calls `storage_prefix_writable()` (needs `security_storage_policies.sql`), and
  section 10's first `create index` on `analytics_events` is unguarded while every other index
  in that section is. Each aborts the file on a database missing the migration that supplies it.
- **No email or push when a teammate writes.** Same as support: the badge and Realtime are
  the only signal.
- **Not built:** adding or removing participants after a thread exists (the policies allow
  it — the creator may add, anyone may leave — but no UI drives them), leaving a
  conversation, renaming a thread, and per-message read receipts (the data is there).
