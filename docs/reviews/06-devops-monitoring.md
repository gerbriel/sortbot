# 06 — DevOps: monitoring, implemented

Implementation log for `docs/reviews/06-devops.md` §6 (monitoring) and §6.3
(uptime). Everything here is first-party: a Postgres table this project owns, a
client module, a founder panel, and a GitHub Actions cron. **No Sentry, no
Datadog, no third-party uptime service** — the self-reliance rule holds.

Nothing is wired into the running app yet: the four artifacts below are inert
until (a) the migration is run and (b) the five App.tsx edits in §5 are applied.
Both halves are safe to ship in either order — the client latches itself off when
the table is missing, and the panel shows a setup hint instead of an error.

---

## 1. What was built

| File | Status | What it is |
|---|---|---|
| `supabase/migrations/app_errors.sql` | **new, NOT run** | `app_errors` table + RLS + rate-limit trigger + `app_errors_summary(days)` + `app_errors_prune(keep_days)`. Additive, idempotent, rollback at the bottom. |
| `src/lib/errorReporter.ts` | **new** | `installErrorReporter()`, `reportError()`, `setErrorContext()`, fingerprinting, PII scrubbing, dedupe + cap, `fetchErrorSummary()`. |
| `src/lib/errorReporter.test.ts` | **new** | 27 tests over the pure helpers and the insert path. |
| `src/components/ErrorsPanel.tsx` | **new** | Founders-only Errors view, same shape as `AnalyticsPanel`. |
| `src/components/OrgPanel.tsx` | **edited (4 lines + a comment)** | Third Founder-tools sub-tab: `toolsView` union, icon import, one button, one branch. |
| `.github/workflows/uptime.yml` | **new, inert until pushed** | 15-minute liveness probe; files/closes a GitHub issue. |

Files deliberately **not** touched (owned by the concurrent performance agent):
`src/App.tsx`, `src/lib/analytics.ts` (imported only), the Step 1–4 components,
`public/sw.js`, `index.html`.

---

## 2. `app_errors.sql` — the table

Mirrors `analytics_events.sql` exactly: the browser writes, only Founding admins
read, no client UPDATE/DELETE, one aggregate RPC for the panel, a prune function,
rollback at the bottom.

**Columns.** `source` (`window` | `unhandledrejection` | `boundary` | `manual`),
`message` (1–500), `stack` (≤4000), `component`, `view`, `path`, `fingerprint`
(8–64), `user_agent_class`, `app_version`, `session_id` (8–64, NOT NULL),
`user_id`, `org_id`, `created_at`.

Three decisions worth knowing:

* **`user_agent_class` is a closed vocabulary in the CHECK**
  (`chrome|edge|safari|firefox|opera|samsung|webview|other`). The privacy promise
  — a browser family, never a full UA — is therefore enforced by the *database*,
  not only by the client. A forged client cannot smuggle a fingerprintable UA
  string into that column; it gets a 23514 instead.
* **`path` is `location.pathname`** — no query string, no hash.
* **A per-session rate trigger (20 rows / 10 min, errcode 54000).** The table
  exists to catch crash loops, and a crash loop is exactly what would otherwise
  write a million rows before anyone noticed. Same style as
  `security_abuse_limits.sql`: SECURITY DEFINER so it can COUNT rows the caller
  has no SELECT grant for.

`app_errors_summary(p_days)` returns one jsonb payload: `totals`
(errors / unique fingerprints / affected sessions / signed-in users / last_seen),
`groups` (top 50 fingerprints with count, sessions, users, sample message,
source, component, view, app_version, first/last seen), a zero-filled `daily`
series, and `views`. UTC days, same convention as `analytics_summary`.

### Verified against a real Postgres

A throwaway PG 17 cluster with stubbed `auth.users`, `organizations` and
`is_beta_admin()` (the same technique used for `founding_user_admin.sql`).
All green, cluster destroyed afterwards:

| # | Check | Result |
|---|---|---|
| 1 | Applies clean; **applies twice** clean | idempotent |
| 2 | Signed-in user inserting **their own** `user_id` | accepted |
| 3 | Signed-in user inserting **someone else's** `user_id` | RLS rejected |
| 4 | Anon insert with no identity / with a `user_id` | accepted / RLS rejected |
| 5 | Full user agent in `user_agent_class` | 23514 rejected |
| 6 | `source = 'sentry'`, 501-char message, 3-char fingerprint | 23514 rejected |
| 7 | Anon SELECT | permission denied |
| 8 | Non-founder SELECT / `summary()` / `prune()` | 0 rows / 42501 / 42501 |
| 9 | 22 inserts in one session | **exactly 20 accepted**, 21st+ 54000 |
| 10 | Founder `summary(7)` | correct totals, groups, 7-day series, views |
| 11 | `prune(90)` deletes a 120-day-old row; `prune(1)` is clamped to 7 days | 1 / 0 |
| 12 | The commented ROLLBACK block | table + 0 functions left behind |

---

## 3. `errorReporter.ts` — the client

Imports `getSessionId` and `FORCE_KEY` from `analytics.ts` (import only — that
file was not edited), so an error row and an analytics row share the same
per-tab session id and can be correlated.

**Gating.** Skips localhost unless `localStorage.sortbot_analytics_force === '1'`
(the same override analytics uses). It deliberately does **not** honor Do Not
Track — DNT asks not to be tracked across sites; a crash report about our own
broken code is neither behavioural nor cross-site. There is no `doNotTrack`
input to `shouldReport()` at all, and a test asserts that.

**Three volume guards**, because the app is broken when this code runs:
1. one row per fingerprint per 60 s (`DEDUPE_MS`);
2. ≤ 20 reports per page load (`MAX_PER_LOAD`) — and a *suppressed* report does
   not spend the cap;
3. the database trigger above.

**Availability latch.** A missing table (42P01 / PGRST205) disables reporting for
the session, exactly like `analytics.ts`. A 54000 rate-limit rejection does
**not** — the session keeps reporting later. Tested both ways.

**Fingerprints survive a redeploy.** `fingerprintError()` hashes
`source | normalizeMessage(message) | normalizeFrame(stack)` with two independent
32-bit hashes (~13 chars, satisfies the 8–64 CHECK). The normalizers strip the
things that change between builds and users: the origin, the Vite content hash
(`index-BQ3f7x.js` → `index.js`), `:line:col`, cache-buster query strings, and
digit runs in the message. Without that, every deploy would split one bug into a
brand-new issue and the panel would be useless.

**PII scrubbing** runs on the message **and** the stack before either leaves the
browser: emails → `[email]`, UUIDs → `[id]` (storage paths are
`{userId}/{productId}/…`, so stacks leak ids constantly), long opaque runs →
`[token]`.

**`app_version` with no build-config change.** There is no `__APP_VERSION__`
define in this repo and adding one would mean editing `vite.config.ts`. Instead
`appVersionFrom()` reads the hash Vite already puts in the entry chunk filename —
verified against the real `dist/index.html`: `/assets/index-BghMgT1B.js` →
`BghMgT1B`. A `<meta name="app-version">` wins if one is ever added.

### Two bugs the tests caught while writing them

* **The token scrubber was too greedy.** `\b[A-Za-z0-9_-]{32,}\b` also matches
  long *identifiers* — a 35-char function name in a stack frame became
  `[token]`, destroying the very frame the fingerprint is built from. Now a match
  is only replaced when it contains a digit or is ≥ 40 chars
  (`isOpaqueToken`), which still catches JWTs, access tokens and hex digests.
* **`appVersionFrom` preferred the wrong chunk.** Testing per-source instead of
  per-pattern meant a hashed *vendor* chunk earlier in the document beat the
  entry chunk. It now runs the `index-*` pattern across all script tags first.

---

## 4. `ErrorsPanel.tsx` + the OrgPanel tab

Founder tools → **Errors** (third sub-tab, beside Analytics and CRM). Range chips
7 / 30 / 90 (defaults to 7 — an error list is a "what is broken right now"
view), four KPI tiles (Errors, Unique issues, Affected sessions, Signed-in users
hit), a Top-issues table (message, where, count, sessions, last seen — with the
untruncated message in `title` for copy/paste), and Daily + By-screen tables.

Deliberately **table-only, no chart**: an error list is read for its text, and
the founder needs to copy a message into a fix.

Styling adds nothing: `ft-card`, `ft-toolbar`, `ft-chips`, `beta-chip`,
`ft-help`, `ft-setup`, `ft-error`, `ft-spin`, `an-kpis`, `an-tile*`, `an-h`,
`an-tables`, `an-table`, `an-num`, `org-icon-btn`, `org-panel-loading` — all
already in `OrgPanel.css`. No hardcoded colours, no new CSS file, no emoji
(lucide `AlertTriangle` / `RefreshCw`). Data loads in a `.then` callback inside
the effect, mirroring `AnalyticsPanel` — no synchronous setState in an effect, no
ref writes during render.

The `'unavailable'` branch names the migration to run, so a founder opening the
tab before the SQL exists sees an instruction, not a blank panel.

---

## 5. DEFERRED — the five App.tsx edits (locked file)

`src/App.tsx` is owned by the concurrent performance agent. Apply these after it
lands. All five are additive; none changes existing behaviour.

**(1) Import** — after line 41
(`import { track, trackPageview, setAnalyticsContext, clearAnalyticsContext } from './lib/analytics';`):

```ts
import { installErrorReporter, reportError, setErrorContext, clearErrorContext } from './lib/errorReporter';
```

**(2) Install at boot** — module scope, immediately below the import block (it is
idempotent and `typeof window`-guarded, so StrictMode's double invoke is safe):

```ts
// First-party error tracking: window 'error' + 'unhandledrejection' → app_errors.
// Module scope so it is listening before the first render. No-op on localhost and
// until app_errors.sql has been run.
installErrorReporter();
```

*(If the orchestrator prefers it before `createRoot`, `src/main.tsx` is an
equally valid anchor — the function is idempotent, so both is also harmless.)*

**(3) Report caught render errors** — in `GrouperErrorBoundary.componentDidCatch`
(~line 216), keep the existing `console.error` and add:

```ts
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[GrouperErrorBoundary] caught render error:', error, info);
    // The boundary is the ONLY place a render crash is observable.
    reportError(error, {
      source: 'boundary',
      component: info.componentStack?.split('\n')[1]?.trim().replace(/^at\s+/, '') ?? 'ImageGrouper',
    });
  }
```

**(4) Identity on workspace resolve** — in the `ensureOrganization(user).then(...)`
effect, add one line beside each of the three existing `setAnalyticsContext`
calls, and clear it in the two teardown paths:

```ts
        setAnalyticsContext({ userId: user.id, orgId: res.org.id });
        setErrorContext({ userId: user.id, orgId: res.org.id });      // ← add
```
```ts
        setAnalyticsContext({ userId: user.id, orgId: null });
        setErrorContext({ userId: user.id, orgId: null });            // ← add (both the waitlist and legacy branches)
```
```ts
    if (!user) { setCurrentOrg(null); setShowOrgPanel(false); setBetaWaitlist(null); clearAnalyticsContext(); clearErrorContext(); return; }
```
```ts
    await supabase.auth.signOut();
    clearAnalyticsContext();
    clearErrorContext();                                             // ← add in handleSignOut
```

**(5) Which screen** — in the pageview effect (~line 1213), hoist the view so the
error context gets it too (`setErrorContext` is a plain module function, not
setState, so this stays effect-safe):

```ts
    const view = !signedInUserId ? (showLogin ? 'auth' : 'landing') : betaWaitlist ? 'waitlist' : 'app';
    setErrorContext({ view });
    trackPageview(view);
```

**Follow-up, not required (review §7.2):** the "UPDATE affected 0 rows but RLS
blocked us" branches in `src/lib/workflowBatchService.ts` are `console.warn` only.
`reportError(new Error('autoSave: RLS-blocked update'), { source: 'manual', component: 'workflowBatchService' })`
there would make the single most dangerous failure mode in this stack visible.
That file is also locked right now.

---

## 6. The migration to run

In the Supabase SQL Editor, **after** `multi_org_tenancy.sql` and
`beta_signups.sql` (it needs `organizations` and `is_beta_admin()`):

```
supabase/migrations/app_errors.sql
```

Additive — creates one table, one trigger and two functions, touches nothing
existing. The VERIFY block at the bottom of the file is the smoke test (a
minimal insert, a forged-identity insert, a full-UA insert, a 21-row flood, the
summary payload, then a cleanup `delete`). No backup needed; the ROLLBACK block
removes everything.

Retention is manual, like analytics: `select public.app_errors_prune(90);`

---

## 7. `uptime.yml`

Cron `*/15 * * * *` plus `workflow_dispatch`. `permissions: contents: read,
issues: write` — nothing else. No `actions/checkout` (nothing in the repo is
needed), so the job is a few seconds of billed time.

Two probes:
1. `GET https://gerbriel.github.io/sortbot/` must return a body containing
   `<title>Acadia</title>` (verified present in `index.html:63`). Catches a
   broken deploy, a 404, and an empty shell.
2. `GET ${VITE_SUPABASE_URL}/auth/v1/health` with the anon key must return 200.
   Cheap, touches no data. A missing secret is itself reported as a failure.

Incident handling uses `gh` with the default `GITHUB_TOKEN`: one open issue
titled **"Uptime check failed"** at a time — commented on if it already exists,
created if not, closed with a recovery comment when the probe goes green.
Matching is done by listing open issues and filtering the exact title with
`--jq`, **not** `gh issue list --search`: the GitHub search index lags by minutes,
which on a 15-minute cron would open duplicate issues. No label is used, so the
workflow cannot fail on a missing label.

Validated with `node -e "require('js-yaml').load(...)"` (parses; `on`,
`permissions`, `concurrency`, three steps) and each `run:` block extracted and
checked with `bash -n`.

**Honest limits**, copied from the review: `schedule` is best-effort — GitHub
delays or skips runs under load, so a missing run means *unknown*, not healthy.
The probe cannot see a partial outage that only affects signed-in users, and it
cannot see a broken RLS policy. The real end-to-end availability signal remains
`CSV Exported` per day in the Analytics panel (§6.4).

---

## 8. How to verify in production

1. **Run the migration**, then reload the deployed site. Open Workspace →
   Founder tools → **Errors**: the setup hint must be gone and the panel must
   show zeros instead.
2. **Prove the write path** from the deployed site's console (localhost is
   skipped by design; if you must test locally, first run
   `localStorage.setItem('sortbot_analytics_force','1')`):
   ```js
   setTimeout(() => { throw new Error('uptime smoke test'); }, 0);   // window handler
   Promise.reject(new Error('uptime smoke test 2'));                  // unhandledrejection
   ```
   Refresh the Errors panel: two issues, `source` `window` and
   `unhandledrejection`, each with `view: app`, your user, and an `app_version`
   matching the deployed entry chunk hash (`dist/assets/index-<hash>.js`).
3. **Prove the dedupe**: throw the *same* error five times in a row — still one
   row, count 1 (the second through fifth are dropped inside the 60 s window).
4. **Prove the privacy contract** as a founder in the SQL Editor:
   ```sql
   select user_agent_class, path, message, stack from public.app_errors
   order by created_at desc limit 5;
   ```
   `user_agent_class` must be a single word, `path` must have no `?`, and no
   email or UUID may appear in `message`/`stack`.
5. **Prove the read gate**: as a non-founding user, the Errors tab is not even
   rendered (`isBetaAdmin` gates the whole Founder-tools block); calling
   `supabase.rpc('app_errors_summary', { p_days: 7 })` from that account must
   return 42501, which the panel renders as "Founding Workspace admins only".
6. **Uptime**: after the workflow lands on `main`, trigger it by hand
   (Actions → Uptime → Run workflow). Green run = probe passed. To rehearse the
   alert, temporarily change `EXPECTED_TITLE` on a branch and dispatch it there:
   an issue titled "Uptime check failed" should appear, and reverting + re-running
   should close it with a recovery comment.
7. **Weekly, 2 minutes**: Errors panel (7 days) for new fingerprints, then
   Analytics for a day with sessions but zero `CSV Exported` — that is an
   incident even when every probe is green.

---

## 9. Gates

| Gate | Before | After |
|---|---|---|
| `npm test` | 31 files green | **32 files green, 427 tests** — my 27 included (the total moved from 422 to 427 mid-session as the concurrent agent's tests landed; all pass) |
| `npx tsc -b` | 1 error (`src/App.tsx(1,59) useMemo declared but never read`) | **same 1 error, none of mine** |
| `npx vite build` | — | **clean** (`✓ built in 1.43s`) |
| `npx eslint . \| grep problems` | **302 problems** (286 errors, 16 warnings) | **302 problems** — unchanged |
| `npx eslint` on my four files | — | **zero output** |

The single `tsc` error is the concurrent performance agent's in-flight edit
(`useMemo` added to the App.tsx import, not yet used) — `git diff` confirms it
arrived with their 247-insertion change, and App.tsx is locked here. `vite build`
was run separately to prove the bundle, including `ErrorsPanel`, compiles.

Side observation for the orchestrator: `.github/workflows/ci.yml` sets
`LINT_BASELINE: 311`, but the tree is at 302. Tightening that line would make CI
enforce the real number.

Nothing was committed.
