/**
 * Finance — the founder's books, kept in OUR OWN Supabase project
 * (`finance_transactions`, `finance_plan_prices`, `finance_settings`;
 * migration `supabase/migrations/finance.sql`). No payment processor, no
 * accounting vendor, no external API: a ledger the founder types into, plan
 * prices that value the customer base, and one SECURITY DEFINER aggregate
 * (`finance_summary`) that the Finance view draws.
 *
 * RECURRENCE — the single rule this file and the SQL both implement.
 * A row with a `recurrence` is a TEMPLATE, not a log entry: it stands for
 * itself and for every repeat until `recurrence_ends_on` (or forever). Repeats
 * are never stored; they are expanded at read time. Steps are ANCHORED to
 * `occurred_on` (occurred_on + n × interval), matching Postgres
 * `generate_series`: Jan 31 monthly → Feb 28, **Mar 31**, Apr 30 — it does not
 * drift down to the 28th for good. `expandOccurrences` below reproduces that
 * exactly, so the on-screen preview, the CSV exports and the server's numbers
 * can never disagree.
 *
 * MONEY is integer cents everywhere. Dollars exist only at the edges — the
 * amount input (`parseAmountToCents`) and display (`formatMoney`,
 * `centsToPlainDollars` for CSV).
 *
 * FORWARD-COMPATIBLE: every read reports 'unavailable' when the tables are
 * missing (migration not run) so the view can show the setup step instead, and
 * 'forbidden' (42501) for a non-founder.
 */
import { supabase } from './supabase';
import { log } from './debugLogger';
// One CSV escaper for the whole app — including the spreadsheet-formula guard
// (security audit 05, #14). A finance export is exactly the kind of file that
// gets opened in Excel, so it must not be a second, weaker implementation.
import { escapeCsvValue } from './csvExport';

// ── Types ────────────────────────────────────────────────────────────────────

export type FinanceKind = 'income' | 'expense';
export type Recurrence = 'monthly' | 'yearly';

export interface FinanceTransaction {
  id: string;
  occurred_on: string;            // YYYY-MM-DD
  kind: FinanceKind;
  category: string;
  amount_cents: number;
  currency: string;
  description: string | null;
  org_id: string | null;
  recurrence: Recurrence | null;
  recurrence_ends_on: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface FinancePlanPrice {
  plan: string;
  monthly_cents: number;
  note: string | null;
  updated_at: string;
}

export interface FinanceTransactionInput {
  occurred_on: string;
  kind: FinanceKind;
  category: string;
  amount_cents: number;
  currency?: string;
  description?: string | null;
  org_id?: string | null;
  recurrence?: Recurrence | null;
  recurrence_ends_on?: string | null;
}

export type FinanceTransactionPatch = Partial<Omit<FinanceTransactionInput, 'kind'>> & { kind?: FinanceKind };

/** The `finance_summary(p_from, p_to)` contract. Cents throughout. */
export interface FinanceSummary {
  from: string;
  to: string;
  days: number;
  currency: string;
  totals: {
    income_cents: number;
    expense_cents: number;
    profit_cents: number;
    margin_pct: number;
    /** OCCURRENCES in range — a monthly bill counts once per month, not once. */
    transaction_count: number;
  };
  previous: {
    from: string; to: string;
    income_cents: number; expense_cents: number; profit_cents: number; transaction_count: number;
  };
  monthly: Array<{ month: string; income_cents: number; expense_cents: number; profit_cents: number }>;
  by_category: Array<{ kind: FinanceKind; category: string; total_cents: number; count: number }>;
  by_workspace: Array<{
    org_id: string; name: string; plan: string; members: number;
    income_cents: number; monthly_value_cents: number; founding: boolean;
    created_at: string; last_active: string | null;
  }>;
  customers: {
    total_workspaces: number; total_members: number;
    new_workspaces: number; new_members: number;
    /** null when analytics_events.sql has not been run — not zero. */
    active_workspaces: number | null;
    founding_workspaces: number; founding_discount_pct: number;
    projected_mrr_cents: number; projected_mrr_list_cents: number;
    by_plan: Array<{ plan: string; workspaces: number; members: number; monthly_cents: number }>;
  };
}

export type FinanceSummaryResult =
  | { status: 'ok'; summary: FinanceSummary }
  | { status: 'unavailable' }
  | { status: 'forbidden' };

export type FinanceTransactionsResult =
  | { status: 'ok'; transactions: FinanceTransaction[] }
  | { status: 'unavailable' };

export type FinancePlanPricesResult =
  | { status: 'ok'; prices: FinancePlanPrice[] }
  | { status: 'unavailable' };

const TX_COLS =
  'id, occurred_on, kind, category, amount_cents, currency, description, org_id, recurrence, recurrence_ends_on, created_by, created_at, updated_at';
const PRICE_COLS = 'plan, monthly_cents, note, updated_at';

// ── Money ────────────────────────────────────────────────────────────────────

/** U+2212 MINUS, matching the analytics deltas. Display only — never CSV. */
const MINUS = '−';

/** `$1,234.56` · `−$12.00` · `$0.00`. Display format; cents in, string out. */
export function formatMoney(cents: number, opts: { showPlus?: boolean } = {}): string {
  const n = Number.isFinite(cents) ? Math.round(cents) : 0;
  const abs = (Math.abs(n) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (n < 0) return `${MINUS}$${abs}`;
  return `${opts.showPlus ? '+' : ''}$${abs}`;
}

/**
 * `$49.00` · `$1.2K` · `$48K` · `$1.4M` — for KPI tiles, where cents past a
 * thousand dollars are noise. Below $1,000 it is exactly `formatMoney`: a tile
 * must never round $999.99 up to "$1,000".
 */
export function formatMoneyShort(cents: number): string {
  const n = Number.isFinite(cents) ? Math.round(cents) : 0;
  const dollars = Math.abs(n) / 100;
  const sign = n < 0 ? MINUS : '';
  if (dollars < 1000) return formatMoney(n);
  if (dollars < 1_000_000) {
    const k = dollars / 1000;
    return `${sign}$${(k < 10 ? k.toFixed(1) : Math.round(k).toString()).replace(/\.0$/, '')}K`;
  }
  return `${sign}$${(dollars / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
}

/** Machine-readable dollars for CSV: `1234.56`, `-1234.56`. Never a symbol. */
export function centsToPlainDollars(cents: number): string {
  const n = Number.isFinite(cents) ? Math.round(cents) : 0;
  return (n / 100).toFixed(2);
}

/**
 * Dollars typed by a human → integer cents. Accepts `$1,234.56`, `1234.56`,
 * `1234`, `.5`. Returns null for anything that is not a positive amount — the
 * ledger's CHECK constraint requires `amount_cents > 0` (the sign lives in
 * `kind`), so a negative here is a mistake, not a credit.
 */
export function parseAmountToCents(input: string): number | null {
  const cleaned = String(input ?? '').replace(/[$,\s]/g, '');
  if (!cleaned || !/^\d*\.?\d*$/.test(cleaned) || cleaned === '.') return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value <= 0) return null;
  const cents = Math.round(value * 100);
  return cents > 0 ? cents : null;
}

/** Percent with one decimal, matching the RPC's `round(…, 1)`. */
export function marginPct(incomeCents: number, profitCents: number): number {
  if (incomeCents <= 0) return 0;
  return Math.round((profitCents / incomeCents) * 1000) / 10;
}

// ── Dates (plain YYYY-MM-DD strings — no Date objects, no timezones) ─────────

export interface DateRange { from: string; to: string }

export function todayKey(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isDateKey(v: string): boolean {
  const m = DATE_RE.exec(v ?? '');
  if (!m) return false;
  const month = Number(m[2]);
  const day = Number(m[3]);
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(Number(m[1]), month);
}

function parts(key: string): { y: number; m: number; d: number } {
  const m = DATE_RE.exec(key ?? '');
  if (!m) return { y: 1970, m: 1, d: 1 };
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

const pad = (n: number) => String(n).padStart(2, '0');
const key = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

export function daysInMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

export function addDays(dateKey: string, n: number): string {
  const p = parts(dateKey);
  const t = new Date(Date.UTC(p.y, p.m - 1, p.d + n));
  return key(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/**
 * Anchored month arithmetic — Postgres `generate_series` semantics. The day of
 * month comes from the ORIGINAL date and is clamped to the target month's
 * length, so Jan 31 + 1 = Feb 28 but Jan 31 + 2 = Mar 31.
 */
export function addMonthsAnchored(dateKey: string, n: number): string {
  const p = parts(dateKey);
  const total = (p.y * 12) + (p.m - 1) + n;
  const y = Math.floor(total / 12);
  const m = (total % 12) + 1;
  return key(y, m, Math.min(p.d, daysInMonth(y, m)));
}

/** Inclusive day count, matching the RPC's `(p_to - p_from) + 1`. */
export function daySpan(range: DateRange): number {
  const a = Date.UTC(parts(range.from).y, parts(range.from).m - 1, parts(range.from).d);
  const b = Date.UTC(parts(range.to).y, parts(range.to).m - 1, parts(range.to).d);
  return Math.round((b - a) / 86_400_000) + 1;
}

/** The equal-length range immediately before this one (the KPI baseline). */
export function previousRange(range: DateRange): DateRange {
  const span = daySpan(range);
  return { from: addDays(range.from, -span), to: addDays(range.from, -1) };
}

export function monthKey(dateKey: string): string {
  return dateKey.slice(0, 7);
}

/** Every `YYYY-MM` touched by the range, in order — the zero-fill spine. */
export function monthsBetween(range: DateRange): string[] {
  const out: string[] = [];
  const start = parts(range.from);
  const end = parts(range.to);
  const last = (end.y * 12) + (end.m - 1);
  for (let i = (start.y * 12) + (start.m - 1); i <= last; i++) {
    out.push(`${Math.floor(i / 12)}-${pad((i % 12) + 1)}`);
  }
  return out;
}

export type RangePreset = 'this_month' | 'last_month' | 'this_quarter' | 'ytd' | 'last_12_months' | 'custom';

export const RANGE_PRESETS: Array<{ id: Exclude<RangePreset, 'custom'>; label: string }> = [
  { id: 'this_month', label: 'This month' },
  { id: 'last_month', label: 'Last month' },
  { id: 'this_quarter', label: 'This quarter' },
  { id: 'ytd', label: 'Year to date' },
  { id: 'last_12_months', label: 'Last 12 months' },
];

const monthRange = (y: number, m: number): DateRange => ({ from: key(y, m, 1), to: key(y, m, daysInMonth(y, m)) });

/**
 * A preset → a concrete range. `today` is a parameter so this is pure and
 * testable; the view passes `todayKey()`. 'custom' is not accepted here — the
 * view owns those two inputs.
 */
export function rangeForPreset(preset: Exclude<RangePreset, 'custom'>, today: string): DateRange {
  const t = parts(today);
  switch (preset) {
    case 'this_month':
      return monthRange(t.y, t.m);
    case 'last_month': {
      const y = t.m === 1 ? t.y - 1 : t.y;
      const m = t.m === 1 ? 12 : t.m - 1;
      return monthRange(y, m);
    }
    case 'this_quarter': {
      const qStart = Math.floor((t.m - 1) / 3) * 3 + 1;
      const qEnd = qStart + 2;
      return { from: key(t.y, qStart, 1), to: key(t.y, qEnd, daysInMonth(t.y, qEnd)) };
    }
    case 'ytd':
      return { from: key(t.y, 1, 1), to: today };
    case 'last_12_months': {
      const start = addMonthsAnchored(key(t.y, t.m, 1), -11);
      return { from: start, to: key(t.y, t.m, daysInMonth(t.y, t.m)) };
    }
  }
}

// ── Recurrence expansion (must match finance.sql) ────────────────────────────

/** Only the fields the expansion depends on — so tests and previews stay light. */
export interface RecurringLike {
  occurred_on: string;
  recurrence: Recurrence | null;
  recurrence_ends_on?: string | null;
}

/** Runaway guard: 200 years of monthly repeats. Reaching it means bad data. */
const MAX_OCCURRENCES = 2400;

/**
 * Every date this transaction lands on inside [from, to], ascending.
 *
 * Mirrors the SQL exactly:
 *   stop = recurrence ? min(recurrence_ends_on ?? to, to) : occurred_on
 *   step = anchored +1 month / +1 year from occurred_on
 *   keep occurrences in [from, stop]
 * A non-recurring row therefore yields one date, or none when it is outside
 * the range.
 */
export function expandOccurrences(txn: RecurringLike, range: DateRange): string[] {
  const { from, to } = range;
  if (!isDateKey(txn.occurred_on) || !isDateKey(from) || !isDateKey(to) || from > to) return [];
  if (txn.occurred_on > to) return [];

  if (!txn.recurrence) {
    return txn.occurred_on >= from ? [txn.occurred_on] : [];
  }

  const end = txn.recurrence_ends_on && isDateKey(txn.recurrence_ends_on) ? txn.recurrence_ends_on : null;
  const stop = end && end < to ? end : to;
  const stepMonths = txn.recurrence === 'yearly' ? 12 : 1;

  const out: string[] = [];
  for (let n = 0; n < MAX_OCCURRENCES; n++) {
    const occ = addMonthsAnchored(txn.occurred_on, n * stepMonths);
    if (occ > stop) break;
    if (occ >= from) out.push(occ);
  }
  return out;
}

/** One expanded row: a transaction as it lands on a specific date. */
export interface Occurrence {
  date: string;
  /** True for every repeat after the template's own date. */
  isRepeat: boolean;
  txn: FinanceTransaction;
}

/** The ledger flattened into occurrences, oldest first — the CSV's row set. */
export function expandTransactions(txns: FinanceTransaction[], range: DateRange): Occurrence[] {
  const out: Occurrence[] = [];
  for (const txn of txns) {
    for (const date of expandOccurrences(txn, range)) {
      out.push({ date, isRepeat: date !== txn.occurred_on, txn });
    }
  }
  return out.sort((a, b) => (a.date === b.date ? a.txn.id.localeCompare(b.txn.id) : a.date.localeCompare(b.date)));
}

// ── P&L ──────────────────────────────────────────────────────────────────────

export interface MonthlyPnlRow {
  month: string;           // YYYY-MM
  incomeCents: number;
  expenseCents: number;
  profitCents: number;
}

export interface PnlTotals {
  incomeCents: number;
  expenseCents: number;
  profitCents: number;
  marginPct: number;
  occurrenceCount: number;
}

/** Zero-filled month-by-month P&L over the range. Mirrors summary.monthly. */
export function buildMonthlyPnl(txns: FinanceTransaction[], range: DateRange): MonthlyPnlRow[] {
  const rows = new Map<string, MonthlyPnlRow>();
  for (const month of monthsBetween(range)) {
    rows.set(month, { month, incomeCents: 0, expenseCents: 0, profitCents: 0 });
  }
  for (const occ of expandTransactions(txns, range)) {
    const row = rows.get(monthKey(occ.date));
    if (!row) continue;
    if (occ.txn.kind === 'income') row.incomeCents += occ.txn.amount_cents;
    else row.expenseCents += occ.txn.amount_cents;
    row.profitCents = row.incomeCents - row.expenseCents;
  }
  return [...rows.values()];
}

/** Totals over the range, from the same expansion the P&L uses. */
export function summarizeTransactions(txns: FinanceTransaction[], range: DateRange): PnlTotals {
  let incomeCents = 0;
  let expenseCents = 0;
  let occurrenceCount = 0;
  for (const occ of expandTransactions(txns, range)) {
    occurrenceCount++;
    if (occ.txn.kind === 'income') incomeCents += occ.txn.amount_cents;
    else expenseCents += occ.txn.amount_cents;
  }
  const profitCents = incomeCents - expenseCents;
  return { incomeCents, expenseCents, profitCents, marginPct: marginPct(incomeCents, profitCents), occurrenceCount };
}

/** Totals per category, biggest first — the Overview breakdown. */
export function buildCategoryBreakdown(
  txns: FinanceTransaction[], range: DateRange,
): Array<{ kind: FinanceKind; category: string; totalCents: number; count: number }> {
  const map = new Map<string, { kind: FinanceKind; category: string; totalCents: number; count: number }>();
  for (const occ of expandTransactions(txns, range)) {
    const k = `${occ.txn.kind} ${occ.txn.category}`;
    const row = map.get(k) ?? { kind: occ.txn.kind, category: occ.txn.category, totalCents: 0, count: 0 };
    row.totalCents += occ.txn.amount_cents;
    row.count++;
    map.set(k, row);
  }
  return [...map.values()].sort((a, b) => b.totalCents - a.totalCents);
}

// ── CSV ──────────────────────────────────────────────────────────────────────

export const LEDGER_CSV_HEADERS = [
  'Date', 'Kind', 'Category', 'Amount', 'Signed amount', 'Currency',
  'Workspace', 'Description', 'Recurrence', 'Series start', 'Occurrence',
];

export const PNL_CSV_HEADERS = ['Month', 'Income', 'Expenses', 'Profit', 'Margin %'];

const csvLine = (cells: string[]) => cells.map(escapeCsvValue).join(',');

/**
 * The ledger CSV exports OCCURRENCES, not rows: a $20/mo bill appears once per
 * month in the range, so the file adds up to the same profit the view shows.
 * `Series start` names the template row a repeat came from.
 */
export function buildLedgerCsv(
  txns: FinanceTransaction[], range: DateRange, orgNames: Record<string, string> = {},
): string {
  const lines = [csvLine(LEDGER_CSV_HEADERS)];
  for (const occ of expandTransactions(txns, range)) {
    const t = occ.txn;
    const signed = t.kind === 'income' ? t.amount_cents : -t.amount_cents;
    lines.push(csvLine([
      occ.date,
      t.kind,
      t.category,
      centsToPlainDollars(t.amount_cents),
      centsToPlainDollars(signed),
      t.currency || 'USD',
      t.org_id ? (orgNames[t.org_id] ?? '') : '',
      t.description ?? '',
      t.recurrence ?? '',
      t.recurrence ? t.occurred_on : '',
      occ.isRepeat ? 'repeat' : 'original',
    ]));
  }
  return lines.join('\n');
}

/** Monthly P&L with a Total row — the statement, as a spreadsheet. */
export function buildPnlCsv(monthly: MonthlyPnlRow[], totals: PnlTotals, range: DateRange): string {
  const lines = [csvLine(PNL_CSV_HEADERS)];
  for (const m of monthly) {
    lines.push(csvLine([
      m.month,
      centsToPlainDollars(m.incomeCents),
      centsToPlainDollars(m.expenseCents),
      centsToPlainDollars(m.profitCents),
      m.incomeCents > 0 ? marginPct(m.incomeCents, m.profitCents).toFixed(1) : '',
    ]));
  }
  lines.push(csvLine([
    `Total ${range.from} to ${range.to}`,
    centsToPlainDollars(totals.incomeCents),
    centsToPlainDollars(totals.expenseCents),
    centsToPlainDollars(totals.profitCents),
    totals.incomeCents > 0 ? totals.marginPct.toFixed(1) : '',
  ]));
  return lines.join('\n');
}

/** `acadia-ledger-2026-01-01-to-2026-06-30.csv` */
export function csvFilename(kind: 'ledger' | 'pnl', range: DateRange): string {
  return `acadia-${kind}-${range.from}-to-${range.to}.csv`;
}

// ── Categories ───────────────────────────────────────────────────────────────

/** Starting points, not a closed list — the field accepts anything ≤ 60 chars. */
export const EXPENSE_CATEGORY_SUGGESTIONS = [
  'hosting', 'domains', 'tools', 'software subscriptions', 'contractors',
  'marketing', 'advertising', 'payment fees', 'bank fees', 'equipment',
  'shipping supplies', 'inventory', 'travel', 'meals', 'taxes', 'insurance',
  'legal', 'accounting', 'education', 'office',
];

export const INCOME_CATEGORY_SUGGESTIONS = [
  'subscriptions revenue', 'services revenue', 'setup fees', 'consulting',
  'sales', 'affiliate', 'refunds recovered', 'other income',
];

/**
 * Suggestions for a kind, with the categories already used in the books
 * folded in (case-insensitively, first spelling wins) so the founder's own
 * vocabulary ranks alongside the defaults.
 */
export function categorySuggestions(kind: FinanceKind, used: string[] = []): string[] {
  const base = kind === 'income' ? INCOME_CATEGORY_SUGGESTIONS : EXPENSE_CATEGORY_SUGGESTIONS;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of [...base, ...used]) {
    const clean = (c ?? '').trim();
    if (!clean) continue;
    const k = clean.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(clean);
  }
  return out;
}

// ── Validation ───────────────────────────────────────────────────────────────

/** Returns a human message, or null when the input is good. Mirrors the CHECKs. */
export function validateTransactionInput(input: Partial<FinanceTransactionInput>): string | null {
  if (!input.occurred_on || !isDateKey(input.occurred_on)) return 'Pick a date.';
  if (input.kind !== 'income' && input.kind !== 'expense') return 'Pick income or expense.';
  const category = (input.category ?? '').trim();
  if (!category) return 'Add a category.';
  if (category.length > 60) return 'Category is longer than 60 characters.';
  if (!input.amount_cents || input.amount_cents <= 0) return 'Enter an amount greater than zero.';
  if (input.amount_cents > 100_000_000_000) return 'That amount is too large.';
  if ((input.description ?? '').length > 500) return 'Description is longer than 500 characters.';
  if (input.recurrence && input.recurrence !== 'monthly' && input.recurrence !== 'yearly') return 'Recurrence must be monthly or yearly.';
  if (input.recurrence_ends_on) {
    if (!input.recurrence) return 'An end date needs a recurrence.';
    if (!isDateKey(input.recurrence_ends_on)) return 'That end date is not a real date.';
    if (input.recurrence_ends_on < input.occurred_on) return 'The end date is before the start date.';
  }
  return null;
}

// ── Runtime: reads ───────────────────────────────────────────────────────────

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);
const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

export async function fetchTransactions(limit = 5000): Promise<FinanceTransactionsResult> {
  const { data, error } = await supabase
    .from('finance_transactions')
    .select(TX_COLS)
    .order('occurred_on', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) {
    log.service(`fetchTransactions | unavailable (${error.code ?? ''} ${error.message})`);
    return { status: 'unavailable' };
  }
  return { status: 'ok', transactions: (data ?? []) as FinanceTransaction[] };
}

export async function fetchPlanPrices(): Promise<FinancePlanPricesResult> {
  const { data, error } = await supabase
    .from('finance_plan_prices')
    .select(PRICE_COLS)
    .order('monthly_cents', { ascending: true });
  if (error) {
    log.service(`fetchPlanPrices | unavailable (${error.code ?? ''} ${error.message})`);
    return { status: 'unavailable' };
  }
  return { status: 'ok', prices: (data ?? []) as FinancePlanPrice[] };
}

/** The dashboard aggregate. One round-trip; founders only (42501 → forbidden). */
export async function fetchFinanceSummary(from: string, to: string): Promise<FinanceSummaryResult> {
  try {
    const { data, error } = await supabase.rpc('finance_summary', { p_from: from, p_to: to });
    if (error) {
      log.service(`fetchFinanceSummary | ${error.code ?? ''} ${error.message}`);
      return error.code === '42501' ? { status: 'forbidden' } : { status: 'unavailable' };
    }
    return { status: 'ok', summary: normalizeSummary(data, from, to) };
  } catch (err) {
    log.error(`fetchFinanceSummary | unexpected: ${String(err)}`);
    return { status: 'unavailable' };
  }
}

/** jsonb → typed, with every field defaulted. Exported for tests. */
export function normalizeSummary(raw: unknown, from: string, to: string): FinanceSummary {
  const d = (raw ?? {}) as Record<string, unknown>;
  const totals = (d.totals ?? {}) as Record<string, unknown>;
  const previous = (d.previous ?? {}) as Record<string, unknown>;
  const customers = (d.customers ?? {}) as Record<string, unknown>;
  const active = customers.active_workspaces;
  return {
    from: str(d.from) || from,
    to: str(d.to) || to,
    days: num(d.days),
    currency: str(d.currency) || 'USD',
    totals: {
      income_cents: num(totals.income_cents),
      expense_cents: num(totals.expense_cents),
      profit_cents: num(totals.profit_cents),
      margin_pct: num(totals.margin_pct),
      transaction_count: num(totals.transaction_count),
    },
    previous: {
      from: str(previous.from), to: str(previous.to),
      income_cents: num(previous.income_cents),
      expense_cents: num(previous.expense_cents),
      profit_cents: num(previous.profit_cents),
      transaction_count: num(previous.transaction_count),
    },
    monthly: ((d.monthly ?? []) as Array<Record<string, unknown>>).map(m => ({
      month: str(m.month),
      income_cents: num(m.income_cents),
      expense_cents: num(m.expense_cents),
      profit_cents: num(m.profit_cents),
    })),
    by_category: ((d.by_category ?? []) as Array<Record<string, unknown>>).map(c => ({
      kind: c.kind === 'income' ? 'income' : 'expense',
      category: str(c.category),
      total_cents: num(c.total_cents),
      count: num(c.count),
    })),
    by_workspace: ((d.by_workspace ?? []) as Array<Record<string, unknown>>).map(w => ({
      org_id: str(w.org_id),
      name: str(w.name),
      plan: str(w.plan),
      members: num(w.members),
      income_cents: num(w.income_cents),
      monthly_value_cents: num(w.monthly_value_cents),
      founding: w.founding === true,
      created_at: str(w.created_at),
      last_active: w.last_active ? str(w.last_active) : null,
    })),
    customers: {
      total_workspaces: num(customers.total_workspaces),
      total_members: num(customers.total_members),
      new_workspaces: num(customers.new_workspaces),
      new_members: num(customers.new_members),
      active_workspaces: active === null || active === undefined ? null : num(active),
      founding_workspaces: num(customers.founding_workspaces),
      founding_discount_pct: num(customers.founding_discount_pct),
      projected_mrr_cents: num(customers.projected_mrr_cents),
      projected_mrr_list_cents: num(customers.projected_mrr_list_cents),
      by_plan: ((customers.by_plan ?? []) as Array<Record<string, unknown>>).map(p => ({
        plan: str(p.plan),
        workspaces: num(p.workspaces),
        members: num(p.members),
        monthly_cents: num(p.monthly_cents),
      })),
    },
  };
}

// ── Runtime: writes ──────────────────────────────────────────────────────────

export type CreateTransactionResult =
  | { ok: true; transaction: FinanceTransaction }
  | { ok: false; error: string };

export async function createTransaction(input: FinanceTransactionInput): Promise<CreateTransactionResult> {
  const problem = validateTransactionInput(input);
  if (problem) return { ok: false, error: problem };
  const row = {
    occurred_on: input.occurred_on,
    kind: input.kind,
    category: input.category.trim(),
    amount_cents: input.amount_cents,
    currency: (input.currency || 'USD').toUpperCase().slice(0, 3),
    description: input.description?.trim() || null,
    org_id: input.org_id || null,
    recurrence: input.recurrence ?? null,
    recurrence_ends_on: input.recurrence ? (input.recurrence_ends_on || null) : null,
  };
  const { data, error } = await supabase.from('finance_transactions').insert(row).select(TX_COLS).single();
  if (error) {
    log.service(`createTransaction | ${error.code ?? ''} ${error.message}`);
    return { ok: false, error: 'Could not save that — check you are signed in to the Founding Workspace.' };
  }
  return { ok: true, transaction: data as FinanceTransaction };
}

export async function updateTransaction(id: string, patch: FinanceTransactionPatch): Promise<FinanceTransaction | null> {
  const row: Record<string, unknown> = { ...patch };
  if (typeof row.category === 'string') row.category = row.category.trim();
  if (typeof row.description === 'string') row.description = (row.description as string).trim() || null;
  if ('recurrence' in row && !row.recurrence) row.recurrence_ends_on = null;
  const { data, error } = await supabase.from('finance_transactions').update(row).eq('id', id).select(TX_COLS).single();
  if (error) {
    log.service(`updateTransaction | ${error.code ?? ''} ${error.message}`);
    return null;
  }
  return data as FinanceTransaction;
}

export async function deleteTransaction(id: string): Promise<boolean> {
  const { error } = await supabase.from('finance_transactions').delete().eq('id', id);
  if (error) {
    log.service(`deleteTransaction | ${error.code ?? ''} ${error.message}`);
    return false;
  }
  return true;
}

/** Insert-or-update one plan price. Returns false when RLS refuses. */
export async function savePlanPrice(plan: string, monthlyCents: number, note?: string | null): Promise<boolean> {
  const clean = plan.trim().toLowerCase();
  if (!clean || clean.length > 40 || monthlyCents < 0) return false;
  const { error } = await supabase
    .from('finance_plan_prices')
    .upsert({ plan: clean, monthly_cents: Math.round(monthlyCents), note: note?.trim() || null }, { onConflict: 'plan' });
  if (error) {
    log.service(`savePlanPrice | ${error.code ?? ''} ${error.message}`);
    return false;
  }
  return true;
}

export async function deletePlanPrice(plan: string): Promise<boolean> {
  const { error } = await supabase.from('finance_plan_prices').delete().eq('plan', plan);
  if (error) {
    log.service(`deletePlanPrice | ${error.code ?? ''} ${error.message}`);
    return false;
  }
  return true;
}
