# 09 — Finance: first-party books

**The request, verbatim:** *"need to keep track of finances + users + profit and
expenses + pull reports"*

Built against the working tree at `c60e437` (branch `main`). Nothing committed.
No dependency added. No SQL run against Supabase — the migration is a file, and
it was verified against a throwaway local Postgres 14 instead (§5). `src/App.tsx`
was **not** edited; the exact wiring is in §6 for the orchestrator to apply.

Everything is first-party, per CLAUDE.md §9's self-reliant rule: three tables and
one RPC in the project's own Postgres, plus React. No payment processor, no
accounting vendor, no external API, no import of a bank feed.

---

## 1. Data model

### `finance_transactions` — the ledger

One row per real-world money movement.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `occurred_on` | date, default `current_date` | For a recurring row this is the series' **anchor**, not just its first date. |
| `kind` | text | `income` \| `expense`. Carries the sign. |
| `category` | text ≤ 60 | Free text; the form suggests, it does not constrain. |
| `amount_cents` | bigint | `> 0` and `<= 1e11` ($1B). Always positive — the sign lives in `kind`. The ceiling stops a fat-fingered amount silently rescaling every chart. |
| `currency` | text(3), default `USD` | Stored per row; the UI is USD-only today. |
| `description` | text ≤ 500 | |
| `org_id` | uuid → organizations, **on delete set null** | The customer workspace an income relates to. Deleting a workspace must not erase what it paid. |
| `recurrence` | `monthly` \| `yearly` \| null | |
| `recurrence_ends_on` | date, null | CHECKed `>= occurred_on`, and CHECKed to require a recurrence. |
| `created_by` | uuid, default `auth.uid()` | **Excluded from the UPDATE grant** — it is the audit trail of who typed a number into the books. |
| `created_at` / `updated_at` | timestamptz | `updated_at` via a touch trigger. |

Indexes: `occurred_on desc`, `(kind, category)`, partial on `org_id`, partial on
`recurrence` (recurring rows are read on *every* range query regardless of their
own date).

### `finance_plan_prices` — plan → list price

`plan text pk` (the value in `organizations.plan`), `monthly_cents`, `note`,
`updated_at`. Seeded `free 0`, `beta 0`, `starter 4900`, `pro 12900`,
`studio 29900`, all `on conflict do nothing` so re-running the migration never
overwrites a founder's edit. Projected MRR is therefore a join, not a constant
in the client.

### `finance_settings` — key/value knobs

`key text pk`, `value text`, `note`, `updated_at`. Seeded
`founding_discount_pct = 30` and `founding_cutoff = 2026-12-31`.

**Why a third table rather than a magic row in `finance_plan_prices`** (the brief
left the choice open): a discount is not a plan, and a `founding_discount_pct`
row sitting in the price table would be summed into MRR by any future query that
forgot to exclude it. A separate key/value table cannot be added up by accident.
Values are parsed defensively in the RPC — a founder typing "thirty" degrades to
"no discount", it never breaks the books.

### RLS

Every policy on all three tables is `public.is_beta_admin()` — SELECT, INSERT,
UPDATE and DELETE. Founding-Workspace-only data; unlike the CRM, nothing syncs
into it. Column-level UPDATE grants exclude `created_by` and `created_at` on the
ledger (verified: attempting to update `created_by` raises 42501), and restrict
the other two tables to their editable columns.

---

## 2. The two rules worth arguing about

### Recurrence: templates, expanded at read time

**A row with a `recurrence` is a template, not a log entry.** It stands for
itself and for every repeat until `recurrence_ends_on` (or forever). Repeats are
never stored, so changing a $20/mo hosting bill to $25 fixes the history and the
forecast in one edit — and there is no monthly cron job to forget to run.

```
occurrences(txn, from, to):
  no recurrence  → [occurred_on], if inside [from, to]
  monthly/yearly → occurred_on, +1 step, +2 steps, … up to
                   least(recurrence_ends_on, to), keeping those >= from
```

Steps are **anchored** to `occurred_on` (`occurred_on + n × interval`), which is
what `generate_series` does: Jan 31 monthly → Feb 28, **Mar 31**, Apr 30. It does
not drift down to the 28th for good. `financeService.addMonthsAnchored`
reproduces that by clamping the *original* day into each target month, so the
client's preview, the CSV exports and the server's dashboard cannot disagree.
Both sides are asserted against the same worked example (Jan-31 monthly over
Jan–Jun 2026 = 6 dates; expense total 9900¢; income 79400¢; profit 69500¢;
margin 87.5%; 17 occurrences) — in SQL in §5 and in TypeScript in
`financeService.test.ts`.

Consequence, documented in both files: `totals.transaction_count` counts
**occurrences**, not ledger rows. Totals, `by_category` and `by_workspace` all
come from the same expansion, so every number on the page adds up.

### Founding discount: a durable rule, not a flag

> A workspace is a **founding shop** when its `plan` is `'beta'` **or** it was
> created on or before `finance_settings.founding_cutoff`. Founding shops get
> `founding_discount_pct` (30) off their plan's list price, for life.

The cutoff is what makes it survive an upgrade: moving a beta workspace onto a
paid plan changes `plan` but never `created_at`, so a `plan = 'beta'` test alone
would have silently revoked the landing page's promise the moment it was
honoured. No column was added to `organizations` to carry a flag.

The summary returns **both** `projected_mrr_list_cents` (everyone at list) and
`projected_mrr_cents` (founding shops discounted), because the gap between them
is the cost of the founding promise and the founder should be able to see it.
Both read $0 today: `organizations.plan` only ever holds `free` or `beta`. That
is correct, not a bug, and the Customers tab says so in words.

**Seeded prices vs. the live landing page — flagged, not silently resolved.**
The brief specified Starter $49 / Pro $129 / Studio $299. `src/components/
Landing.tsx` today advertises per-item tiers — **Starter $50 / Pro $250 / Scale
$700** — it was changed after the brief was written. The seeds follow the brief
(they are `on conflict do nothing`), and both the migration header and the
Customers tab point at the plan-price editor: fixing this is typing three
numbers and adding a `scale` row in the UI, no migration. Nothing in the app
reads Landing's numbers, so the two cannot silently diverge in code.

---

## 3. RPC contract — `finance_summary(p_from date, p_to date) → jsonb`

`SECURITY DEFINER`, `search_path = public`, `grant execute … to authenticated`,
raises **42501** for a non-founder, **22007** when `p_to < p_from`. One
round-trip feeds the whole view.

```jsonc
{
  "from": "2026-01-01", "to": "2026-06-30", "days": 181, "currency": "USD",
  "totals":   { "income_cents", "expense_cents", "profit_cents",
                "margin_pct",            // round(profit/income*100, 1); 0 when income = 0
                "transaction_count" },   // OCCURRENCES, not rows
  "previous": { "from", "to",            // equal-length range immediately before
                "income_cents", "expense_cents", "profit_cents", "transaction_count" },
  "monthly":  [ { "month": "2026-01", "income_cents", "expense_cents", "profit_cents" } ], // zero-filled
  "by_category":  [ { "kind", "category", "total_cents", "count" } ],   // total desc
  "by_workspace": [ { "org_id", "name", "plan", "members", "income_cents",
                      "monthly_value_cents",   // discounted where founding
                      "founding", "created_at", "last_active" } ],      // income desc, name asc
  "customers": {
    "total_workspaces", "total_members", "new_workspaces", "new_members",
    "active_workspaces",        // null when analytics_events.sql has not been run — NOT zero
    "founding_workspaces", "founding_discount_pct",
    "projected_mrr_cents", "projected_mrr_list_cents",
    "by_plan": [ { "plan", "workspaces", "members", "monthly_cents" } ]
  }
}
```

Implementation notes:

- **One expansion, split by date.** Recurring rows are expanded once over
  `[previous_from, p_to]` via `cross join lateral generate_series`, then split
  into `cur` (`occ_on >= p_from`) and `prv`. The current and previous ranges
  therefore cannot be computed two different ways.
- **`analytics_events` is optional.** Referencing a missing table in a static
  plpgsql query fails at execution, so the activity map is read through
  `to_regclass` + `execute format(…)`. Verified: dropping `analytics_events`
  leaves the function working, with `active_workspaces: null`.
- `by_workspace` lists **every** workspace, including zero-income ones, so the
  transaction form's workspace picker can use it instead of querying
  `organizations` directly — which org RLS would scope to the caller's own
  workspace anyway.

---

## 4. Files

| File | Lines | What it is |
|---|---|---|
| `supabase/migrations/finance.sql` | ~370 | Three tables, RLS + column grants, touch triggers, seeds, `finance_summary()`, rollback block. |
| `src/lib/financeService.ts` | ~640 | Typed CRUD, `fetchFinanceSummary` with `unavailable`/`forbidden` mapping, `normalizeSummary`, and the pure helpers: money in/out of cents, date maths, range presets, `expandOccurrences`, `buildMonthlyPnl`, `summarizeTransactions`, `buildCategoryBreakdown`, the two CSV builders, category suggestions, `validateTransactionInput`. |
| `src/lib/financeService.test.ts` | ~300 | 34 tests (§below). |
| `src/components/FinanceView.tsx` | ~880 | The page: Overview / Transactions / Customers / Reports. |
| `src/components/FinanceView.css` | ~340 | Finance-only classes + the print stylesheet. |
| `src/components/FinanceView.test.tsx` | ~190 | 8 render tests on the house harness. |

### Choices inside the view

- **Sub-tabs live in the component, not in App.** App's diff is then the same
  shape as the CRM's (no extra state), and the tab strip reuses ToolView's tab
  geometry under its own `.fin-*` classes without the negative pull that belongs
  to a strip sitting directly under the title block.
- **It inherits the page-scale overrides for free.** `OrgPanel.css` already
  carries `.tool-view .ft-card { padding: 2rem }`, `.tool-view .an-kpis`,
  `.tool-view .an-table` and friends, and `FinanceView` renders inside
  `.tool-view` — so the new CSS only adds what Finance actually needs, at the
  same scale (3rem section gaps, 2rem cards, 4rem controls, tokens only, no
  literal hex).
- **Chart colour is black + grey, not green + red.** §1 spends colour almost
  entirely on black/white/grey and reserves semantics for signalling state, so
  the two series are `--accent` and `--text-muted` with a legend, and
  `--success`/`--danger` are kept for the one genuine state: whether profit is
  positive or negative (and a single `--success` income chip in the ledger).
  Chart rules followed: thin bars (max 14px), 4px caps rounded at the top and
  square at the baseline, three hairline gridlines, sparse x labels, a per-month
  tooltip on hover *and* focus, a legend because there are two series, and every
  charted value repeated in the table beneath it.
- **The Transactions tab shows templates, not occurrences** — it is what you
  edit. Its footer totals say so ("repeats counted once here"). Overview,
  Reports and both CSVs show expanded occurrences. The range picker is hidden on
  that tab because it does not apply there.
- **Printing** uses the `visibility` technique rather than enumerating every
  piece of app chrome to hide (header, storage meter, toasts, support widget,
  debug toggle — all outside this component and free to change): everything is
  made invisible, then the `.fin-print` subtree is painted back and lifted to
  the top of the sheet. `@page { margin: 18mm }`, and `break-inside: avoid` on
  rows.
- **No `confirm()`/`prompt()`** — delete is the two-step
  `org-confirm-yes`/`org-confirm-no` pattern, as in the CRM.
- **react-hooks v7:** all loading happens in `.then` callbacks off a module-level
  `loadFinance(range)`; no synchronous `setState` in an effect; `setState` for
  the loading flag happens in event handlers only.

---

## 5. Verification on a throwaway Postgres 14

`initdb` into the scratchpad, started with `-k /tmp -c wal_level=logical` on port
55439, then `stub2.sql` → `multi_org_tenancy.sql` → `beta_signups.sql` →
`analytics_events.sql` → `finance.sql`. **Cluster stopped and deleted afterwards.**
All 18 checks green:

| # | Check | Result |
|---|---|---|
| 1 | Non-founder SELECT on all three tables | 0 rows each |
| 2 | Non-founder `finance_summary()` | raises **42501** |
| 3 | Non-founder INSERT into the ledger | blocked by RLS |
| 4 | Founder SELECT | 6 rows |
| 5 | Jan-31 monthly over Jan–Jun | Jan 31, Feb 28, **Mar 31**, Apr 30, May 31, Jun 30 |
| 6 | Totals from expansion | expense 9900, income 79400, profit 69500, margin 87.5, 17 occurrences |
| 7 | Previous equal-length range | 2025-07-04 → 2025-12-31, income 104899 |
| 8 | Yearly outside its anniversary month | absent |
| 9 | `recurrence_ends_on` honoured | tools gone after 2026-03-10 |
| 10 | Range clipping (single month) | one month, income 4900 |
| 11 | Projected MRR + founding discount | list 17800, discounted 16330 (Early Bird starter 4900 → 3430) |
| 12 | `active_workspaces` with analytics present | a number |
| 13 | Inverted range | raises 22007 |
| 14 | `amount_cents = -5` | CHECK violation |
| 15 | End date with no recurrence | CHECK violation |
| 16 | UPDATE `created_by` | 42501 (column grant), while editable columns update and the touch trigger bumps `updated_at` |
| 17 | **Idempotent re-apply** after hand-editing a seeded price (starter → 5000) and the discount (30 → 25): both edits survive, 6 ledger rows intact, MRR recomputes to 16650 | pass |
| 18 | `drop table analytics_events` then summary | works, `active_workspaces: null`, profit unchanged |
| 19 | **Rollback block** (uncommented) then clean re-apply | 0 finance tables and 0 finance functions left; re-install seeds 5 prices and returns zeroed totals on an empty ledger |

---

## 6. Exact `src/App.tsx` wiring (for the orchestrator)

Four edits. Nothing else in App changes.

**(a)** Add `Wallet` to the `lucide-react` import on line 5:

```ts
… MousePointerClick, Move, Save, BarChart3, Contact, Users, Wallet } from 'lucide-react';
```

**(b)** Add the lazy import beside the other founder tools (after `CrmPanel`, ~line 138):

```ts
const FinanceView = React.lazy(() => import('./components/FinanceView'));
```

**(c)** Add `'finance'` to the `ActiveView` union (~line 143):

```ts
export type ActiveView =
  | 'workflow' | 'library' | 'categories' | 'presets'
  | 'vocabulary' | 'analytics' | 'crm' | 'finance' | 'board' | 'workspace';
```

**(d)** Header button — inside the existing founding-admin fragment, immediately
after the CRM button (~line 2681):

```tsx
                <button
                  onClick={toggleView('finance')}
                  className={`button button-secondary nav-tool-btn${activeView === 'finance' ? ' nav-tool-btn--on' : ''}`}
                  aria-current={activeView === 'finance' ? 'page' : undefined}
                  title="Finance — income, expenses, profit, customers and reports (Founding Workspace)"
                >
                  <Wallet size={18} /> Finance
                </button>
```

**(e)** Render branch — immediately after the `activeView === 'crm'` block (~line 3197):

```tsx
      {/* Finance — the founder's books. Same first-party model as Analytics and
          the CRM: our own tables, one SECURITY DEFINER aggregate, no vendor. */}
      {activeView === 'finance' && currentOrg?.slug === 'founding' && (orgRole === 'owner' || orgRole === 'admin') && (
        <Suspense fallback={<ViewFallback />}>
          <ToolView
            icon={<Wallet size={26} />}
            title="Finance"
            description="Income, expenses and profit over any range — what the customer base is worth, and reports you can download or print."
            onBack={goToWorkflow}
          >
            <FinanceView />
          </ToolView>
        </Suspense>
      )}
```

After wiring, `FinanceView` becomes its own build chunk (it is lazy and nothing
else imports it).

---

## 7. Tests

`npm test`: **39 files / 570 tests**, up from 37 files / 528 in this tree.

`src/lib/financeService.test.ts` — 34:
money formatting (cents → display, the `−` minus, compact tiles never rounding
$999.99 up to $1,000, plain CSV dollars, dollars → cents rejecting non-positive
input, margin to one decimal); date maths (date-key validation incl. month
length and leap years, day arithmetic, **anchored** month steps, inclusive day
span, the previous equal-length range, month enumeration); all five range presets
including year-boundary crossings; recurrence expansion (one-off in/out of range,
Jan-31 anchoring, front clipping, `recurrence_ends_on` inclusive and fully
before the range, yearly anniversary-only, junk input, repeat flagging and
ordering); P&L maths on the same six rows the SQL smoke test uses (identical
totals: 9900 / 79400 / 69500 / 87.5 / 17), zero-filled months, category
breakdown; CSV (occurrence rows, header match, **formula guard** — `=cmd|"/c
calc"!A1` gets the apostrophe *and* the quoting, `@handle` and `-nonstarter`
prefixed, while `-10.00` stays a plain negative number — comma/quote escaping,
P&L total row, filenames); category suggestions; validation mirroring every
CHECK; and summary normalization (partial payloads, `active_workspaces` null vs
0, numeric strings from jsonb).

`src/components/FinanceView.test.tsx` — 8, on the house `ui/testUtils` harness
(no testing-library, no new dependency), with only the three network functions
mocked so every pure helper runs for real: the setup hint when the migration has
not run, the founders-only message on 42501, KPI + chart + legend + table parity,
ledger filtering, the recurring-entry preview count, the Customers tab (including
the "needs analytics_events.sql" note and both MRR numbers), the CSV download
calling `createObjectURL`/`revokeObjectURL`, and the printable statement adding
up to the same profit the server returned. The clock is pinned with fake Date
timers so the "year to date" default cannot make the suite date-dependent.

## 8. Gates

| Gate | Before | After |
|---|---|---|
| `npm test` | 528 / 37 files | **570 / 39 files** (+42) |
| `npm run build` | clean | **clean** |
| `npx eslint .` | 254 problems | **254 problems** — unchanged, and 0 findings on any of the six new files |

---

## 9. CLAUDE.md lines to add

**§5 (folder structure)** — under `src/components/`:

```
│   ├── FinanceView.tsx        # Founder Finance view (Founding admins). Sub-tabs Overview/Transactions/Customers/Reports. Ledger CRUD, monthly P&L, projected MRR, CSV + printable statement. Renders inside ToolView.
│   ├── FinanceView.css        # Finance-only classes + the print stylesheet (visibility technique — hides all chrome, paints back .fin-print).
```

under `src/lib/`:

```
│   ├── financeService.ts      # Finance CRUD + fetchFinanceSummary + the PURE helpers: money↔cents, date-range presets, expandOccurrences (mirrors the SQL recurrence rule exactly), monthly P&L, ledger/P&L CSV builders (through csvExport's escapeCsvValue), category suggestions. Tested.
```

under `supabase/migrations/`:

```
│       ├── finance.sql            # First-party books: finance_transactions (ledger, recurring rows expanded at read time), finance_plan_prices, finance_settings, all founders-only (is_beta_admin()) with column-level UPDATE grants excluding created_by/created_at, + finance_summary(from,to) SECURITY DEFINER aggregate (totals, previous equal range, monthly series, by_category, by_workspace, customer/MRR stats; analytics_events optional via to_regclass). Run AFTER multi_org_tenancy.sql + beta_signups.sql. Additive, idempotent, rollback at the bottom.
```

**§7 (data models)** — three new table blocks:

```
#### `finance_transactions`
| Column | Type | Notes |
| `id` | UUID | PK |
| `occurred_on` | DATE | For a recurring row this is the series ANCHOR, not just its first date. |
| `kind` | TEXT | income \| expense. Carries the sign — amount_cents is always positive. |
| `category` | TEXT | ≤ 60 chars, free text. |
| `amount_cents` | BIGINT | > 0, ≤ 1e11. |
| `currency` | TEXT | 3 chars, default USD. |
| `description` | TEXT | ≤ 500 chars. |
| `org_id` | UUID | FK → organizations, ON DELETE SET NULL. The customer workspace an income relates to. |
| `recurrence` | TEXT | monthly \| yearly \| null. A recurring row is a TEMPLATE; repeats are expanded at read time, never stored. |
| `recurrence_ends_on` | DATE | Requires a recurrence; must be ≥ occurred_on. |
| `created_by` | UUID | default auth.uid(). NOT client-editable (column grant). |
| `created_at` / `updated_at` | TIMESTAMPTZ | updated_at via trigger. |

#### `finance_plan_prices`
| `plan` | TEXT | PK. Matches organizations.plan. |
| `monthly_cents` | BIGINT | List price. Seeded free 0 / beta 0 / starter 4900 / pro 12900 / studio 29900 (on conflict do nothing — founder edits survive a re-run). |
| `note` | TEXT | |

#### `finance_settings`
| `key` | TEXT | PK. Seeded founding_discount_pct = 30, founding_cutoff = 2026-12-31. |
| `value` | TEXT | Parsed defensively by the RPC — bad input degrades to "no discount". |
```

**§9 (external integrations → the "no vendor" list)**:

```
### Finance (first-party)
- `finance_summary(p_from, p_to)` RPC (Founding admins; 42501 otherwise) is the only read the Finance view makes. Everything is our own Postgres: no payment processor, no accounting service, no bank feed, no external API.
- RECURRENCE RULE (implemented twice — finance.sql and financeService.expandOccurrences — and asserted against the same worked example in both): a recurring row is a template expanded at read time; steps are ANCHORED to occurred_on (Jan 31 monthly → Feb 28, Mar 31, Apr 30), and totals count OCCURRENCES, not rows.
- FOUNDING DISCOUNT: a workspace is founding when plan = 'beta' OR created_at ≤ finance_settings.founding_cutoff — the cutoff is what makes the 30%-off-for-life promise survive an upgrade off the beta plan. The summary returns list MRR and discounted MRR side by side.
```

**§15 (What's Done)**:

```
- ✅ **Finance — first-party books (July 2026)** — `finance.sql` (finance_transactions / finance_plan_prices / finance_settings, all is_beta_admin(), column-level UPDATE grants excluding created_by/created_at) + `finance_summary()` SECURITY DEFINER aggregate + `financeService.ts` + `FinanceView.tsx` (Overview / Transactions / Customers / Reports inside ToolView, founding admins only). Recurring entries are TEMPLATES expanded at read time by the same anchored rule on both sides, so the chart, the ledger CSV, the P&L CSV and the printed statement always agree. Reports downloads go through csvExport's `escapeCsvValue` (formula guard included). 42 tests; verified end-to-end on a throwaway Postgres 14 (founders-only access, recurrence math, idempotent re-apply preserving founder price edits, rollback, and operation with analytics_events absent).
```

**§16 (In progress / missing)**:

```
| Finance module | **Built — migration not yet run** | `supabase/migrations/finance.sql` + `financeService.ts` + `FinanceView.tsx`. Ship the code first: every read reports 'unavailable' pre-migration and the view shows the setup step instead, so the Finance button is safe to expose immediately. Run the SQL after `multi_org_tenancy.sql` + `beta_signups.sql`. NOTE: the seeded plan prices (starter 4900 / pro 12900 / studio 29900) predate the current Landing tiers (Starter $50 / Pro $250 / Scale $700) — edit them in Finance → Customers → Plan prices, no migration needed. Not built: multi-currency (the column exists, the UI is USD-only), receipt attachments, and any bank/processor import. |
```

---

## 10. Summary

1. Founder asked to track finances, users, profit/expenses and pull reports.
2. `supabase/migrations/finance.sql`: ledger + plan prices + settings, every
   policy `is_beta_admin()`, `created_by`/`created_at` outside the UPDATE grant.
3. `finance_summary(from, to)` returns totals, the previous equal-length range,
   a zero-filled monthly series, category/workspace breakdowns and customer+MRR
   stats in one round-trip; `analytics_events` is optional via `to_regclass`.
4. Recurring rows are templates expanded at read time with **anchored** month
   steps — implemented in SQL and TS, asserted against the same worked example.
5. Founding discount is `plan = 'beta' OR created_at ≤ cutoff`, so it survives
   the upgrade it exists to reward; list and discounted MRR are both returned.
6. `financeService.ts` holds the typed CRUD plus every pure helper the view,
   the previews and both CSVs share; CSVs go through `escapeCsvValue`.
7. `FinanceView.tsx/.css`: Overview (KPIs + legended two-series chart + tables),
   Transactions (ledger CRUD, two-step delete), Customers (workspaces + plan
   price editor), Reports (two CSV downloads + a printable P&L).
8. Verified on a throwaway Postgres 14 — 19 checks including founders-only,
   recurrence math, idempotent re-apply preserving founder edits, and rollback.
   Cluster deleted. No SQL was run against Supabase.
9. Gates: 570 tests (+42) green, build clean, eslint 254 = baseline, 0 findings
   on the six new files.
10. `src/App.tsx` was not touched — the four-part wiring is in §6.
11. Flagged: seeded plan prices follow the brief, not the current Landing tiers;
    they are editable in the UI without a migration.
12. Not built: multi-currency UI, receipts, any bank or processor import.
