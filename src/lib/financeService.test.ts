import { describe, it, expect } from 'vitest';
import {
  formatMoney, formatMoneyShort, centsToPlainDollars, parseAmountToCents, marginPct,
  addDays, addMonthsAnchored, daysInMonth, daySpan, previousRange, monthsBetween, isDateKey,
  rangeForPreset, expandOccurrences, expandTransactions, buildMonthlyPnl, summarizeTransactions,
  buildCategoryBreakdown, buildLedgerCsv, buildPnlCsv, csvFilename, categorySuggestions,
  validateTransactionInput, normalizeSummary,
  LEDGER_CSV_HEADERS, PNL_CSV_HEADERS,
  type FinanceTransaction,
} from './financeService';

/**
 * The finance money-path. The recurrence cases below are the same ones the
 * migration's smoke test asserts against a real Postgres — the client expander
 * and `finance_summary` must agree, or the preview, the CSV and the dashboard
 * would each show a different profit.
 */

const txn = (over: Partial<FinanceTransaction>): FinanceTransaction => ({
  id: over.id ?? Math.random().toString(36).slice(2),
  occurred_on: '2026-01-15',
  kind: 'expense',
  category: 'hosting',
  amount_cents: 1000,
  currency: 'USD',
  description: null,
  org_id: null,
  recurrence: null,
  recurrence_ends_on: null,
  created_by: null,
  created_at: '2026-01-15T00:00:00Z',
  updated_at: '2026-01-15T00:00:00Z',
  ...over,
});

const H1 = 'Jan-31 monthly, no end';

describe('financeService — money formatting', () => {
  it('formats cents as dollars, with a real minus for negatives', () => {
    expect(formatMoney(0)).toBe('$0.00');
    expect(formatMoney(5)).toBe('$0.05');
    expect(formatMoney(123456)).toBe('$1,234.56');
    expect(formatMoney(-1200)).toBe('−$12.00');
    expect(formatMoney(4900, { showPlus: true })).toBe('+$49.00');
  });

  it('rounds and survives junk input', () => {
    expect(formatMoney(1234.6)).toBe('$12.35');
    expect(formatMoney(Number.NaN)).toBe('$0.00');
    expect(formatMoney(Number.POSITIVE_INFINITY)).toBe('$0.00');
  });

  it('compacts big numbers for KPI tiles', () => {
    expect(formatMoneyShort(4900)).toBe('$49.00');
    expect(formatMoneyShort(99_999)).toBe('$999.99'); // never rounded up to $1,000
    expect(formatMoneyShort(150_000)).toBe('$1.5K');
    expect(formatMoneyShort(4_800_000)).toBe('$48K');
    expect(formatMoneyShort(140_000_000)).toBe('$1.4M');
    expect(formatMoneyShort(-150_000)).toBe('−$1.5K');
  });

  it('writes plain, unsigned-symbol dollars for CSV', () => {
    expect(centsToPlainDollars(123456)).toBe('1234.56');
    expect(centsToPlainDollars(-1250)).toBe('-12.50');
    expect(centsToPlainDollars(0)).toBe('0.00');
  });

  it('parses typed dollars into cents, rejecting anything that is not positive', () => {
    expect(parseAmountToCents('49')).toBe(4900);
    expect(parseAmountToCents('$1,234.56')).toBe(123456);
    expect(parseAmountToCents(' 12.005 ')).toBe(1201); // banker-free rounding, half up
    expect(parseAmountToCents('.5')).toBe(50);
    expect(parseAmountToCents('')).toBeNull();
    expect(parseAmountToCents('0')).toBeNull();
    expect(parseAmountToCents('-5')).toBeNull();
    expect(parseAmountToCents('abc')).toBeNull();
    expect(parseAmountToCents('1.2.3')).toBeNull();
  });

  it('computes margin to one decimal, and zero when there is no income', () => {
    expect(marginPct(79400, 69500)).toBe(87.5);
    expect(marginPct(0, -500)).toBe(0);
    expect(marginPct(300, -300)).toBe(-100);
  });
});

describe('financeService — date maths', () => {
  it('validates date keys including month length', () => {
    expect(isDateKey('2026-02-28')).toBe(true);
    expect(isDateKey('2026-02-29')).toBe(false);   // 2026 is not a leap year
    expect(isDateKey('2028-02-29')).toBe(true);
    expect(isDateKey('2026-13-01')).toBe(false);
    expect(isDateKey('2026-1-1')).toBe(false);
    expect(isDateKey('')).toBe(false);
  });

  it('adds days across month and year ends', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('anchors month steps to the original day, clamping short months', () => {
    // Postgres generate_series semantics: start + n × interval, not iterative.
    expect(addMonthsAnchored('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonthsAnchored('2026-01-31', 2)).toBe('2026-03-31'); // NOT 2026-03-28
    expect(addMonthsAnchored('2026-01-31', 3)).toBe('2026-04-30');
    expect(addMonthsAnchored('2026-11-15', 2)).toBe('2027-01-15');
    expect(addMonthsAnchored('2026-03-15', -3)).toBe('2025-12-15');
    expect(addMonthsAnchored('2028-02-29', 12)).toBe('2029-02-28');
    expect(daysInMonth(2028, 2)).toBe(29);
  });

  it('counts an inclusive day span and the equal-length previous range', () => {
    expect(daySpan({ from: '2026-01-01', to: '2026-01-01' })).toBe(1);
    expect(daySpan({ from: '2026-01-01', to: '2026-06-30' })).toBe(181);
    // Matches finance_summary: prev_from = from − span, prev_to = from − 1.
    expect(previousRange({ from: '2026-01-01', to: '2026-06-30' }))
      .toEqual({ from: '2025-07-04', to: '2025-12-31' });
    expect(previousRange({ from: '2026-03-01', to: '2026-03-31' }))
      .toEqual({ from: '2026-01-29', to: '2026-02-28' });
  });

  it('lists every month the range touches', () => {
    expect(monthsBetween({ from: '2026-01-15', to: '2026-03-02' })).toEqual(['2026-01', '2026-02', '2026-03']);
    expect(monthsBetween({ from: '2026-03-01', to: '2026-03-31' })).toEqual(['2026-03']);
    expect(monthsBetween({ from: '2025-11-01', to: '2026-02-01' })).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
  });
});

describe('financeService — range presets', () => {
  const today = '2026-05-14';

  it('resolves each preset from a fixed "today"', () => {
    expect(rangeForPreset('this_month', today)).toEqual({ from: '2026-05-01', to: '2026-05-31' });
    expect(rangeForPreset('last_month', today)).toEqual({ from: '2026-04-01', to: '2026-04-30' });
    expect(rangeForPreset('this_quarter', today)).toEqual({ from: '2026-04-01', to: '2026-06-30' });
    expect(rangeForPreset('ytd', today)).toEqual({ from: '2026-01-01', to: '2026-05-14' });
    expect(rangeForPreset('last_12_months', today)).toEqual({ from: '2025-06-01', to: '2026-05-31' });
  });

  it('crosses the year boundary for last month and the first quarter', () => {
    expect(rangeForPreset('last_month', '2026-01-07')).toEqual({ from: '2025-12-01', to: '2025-12-31' });
    expect(rangeForPreset('this_quarter', '2026-02-10')).toEqual({ from: '2026-01-01', to: '2026-03-31' });
    expect(rangeForPreset('last_12_months', '2026-01-31')).toEqual({ from: '2025-02-01', to: '2026-01-31' });
  });

  it('always produces 12 whole months for last_12_months', () => {
    expect(monthsBetween(rangeForPreset('last_12_months', today))).toHaveLength(12);
  });
});

describe('financeService — recurrence expansion (matches finance.sql)', () => {
  it('yields one date for a one-off, and nothing outside the range', () => {
    const t = txn({ occurred_on: '2026-02-14' });
    expect(expandOccurrences(t, { from: '2026-01-01', to: '2026-06-30' })).toEqual(['2026-02-14']);
    expect(expandOccurrences(t, { from: '2026-03-01', to: '2026-06-30' })).toEqual([]);
    expect(expandOccurrences(t, { from: '2026-01-01', to: '2026-02-01' })).toEqual([]);
  });

  it(`expands ${H1} with anchored day-of-month`, () => {
    const t = txn({ occurred_on: '2026-01-31', recurrence: 'monthly' });
    expect(expandOccurrences(t, { from: '2026-01-01', to: '2026-06-30' })).toEqual([
      '2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31', '2026-06-30',
    ]);
  });

  it('clips the front of a series that started before the range', () => {
    const t = txn({ occurred_on: '2025-12-05', recurrence: 'monthly' });
    expect(expandOccurrences(t, { from: '2026-03-01', to: '2026-03-31' })).toEqual(['2026-03-05']);
    expect(expandOccurrences(t, { from: '2026-01-01', to: '2026-06-30' })).toHaveLength(6);
  });

  it('stops at recurrence_ends_on, inclusive', () => {
    const t = txn({ occurred_on: '2026-01-10', recurrence: 'monthly', recurrence_ends_on: '2026-03-15' });
    expect(expandOccurrences(t, { from: '2026-01-01', to: '2026-12-31' }))
      .toEqual(['2026-01-10', '2026-02-10', '2026-03-10']);
    // Exactly on the end date still counts.
    const exact = txn({ occurred_on: '2026-01-10', recurrence: 'monthly', recurrence_ends_on: '2026-03-10' });
    expect(expandOccurrences(exact, { from: '2026-01-01', to: '2026-12-31' })).toHaveLength(3);
    // Ended before the range: nothing at all.
    expect(expandOccurrences(t, { from: '2026-04-01', to: '2026-12-31' })).toEqual([]);
  });

  it('repeats yearly only in the anniversary month', () => {
    const t = txn({ occurred_on: '2025-06-15', recurrence: 'yearly' });
    expect(expandOccurrences(t, { from: '2026-01-01', to: '2026-06-30' })).toEqual(['2026-06-15']);
    expect(expandOccurrences(t, { from: '2026-01-01', to: '2026-03-31' })).toEqual([]);
    expect(expandOccurrences(t, { from: '2025-01-01', to: '2027-12-31' }))
      .toEqual(['2025-06-15', '2026-06-15', '2027-06-15']);
  });

  it('refuses nonsense ranges and dates instead of looping', () => {
    const t = txn({ occurred_on: '2026-01-01', recurrence: 'monthly' });
    expect(expandOccurrences(t, { from: '2026-06-30', to: '2026-01-01' })).toEqual([]);
    expect(expandOccurrences(txn({ occurred_on: 'nope', recurrence: 'monthly' }), { from: '2026-01-01', to: '2026-12-31' })).toEqual([]);
  });

  it('flags repeats and sorts occurrences oldest first', () => {
    const rows = [
      txn({ id: 'b', occurred_on: '2026-02-14', kind: 'income', amount_cents: 50000 }),
      txn({ id: 'a', occurred_on: '2026-01-31', recurrence: 'monthly' }),
    ];
    const occ = expandTransactions(rows, { from: '2026-01-01', to: '2026-03-31' });
    expect(occ.map(o => o.date)).toEqual(['2026-01-31', '2026-02-14', '2026-02-28', '2026-03-31']);
    expect(occ.map(o => o.isRepeat)).toEqual([false, false, true, true]);
  });
});

describe('financeService — P&L maths', () => {
  // The same six rows the migration smoke test uses, so both sides prove the
  // same numbers: expenses 9900, income 79400, profit 69500, margin 87.5.
  const ledger: FinanceTransaction[] = [
    txn({ id: 'c1', occurred_on: '2026-01-31', kind: 'expense', category: 'hosting', amount_cents: 1000, recurrence: 'monthly' }),
    txn({ id: 'c2', occurred_on: '2025-06-15', kind: 'expense', category: 'domains', amount_cents: 2400, recurrence: 'yearly' }),
    txn({ id: 'c3', occurred_on: '2026-01-10', kind: 'expense', category: 'tools', amount_cents: 500, recurrence: 'monthly', recurrence_ends_on: '2026-03-15' }),
    txn({ id: 'c4', occurred_on: '2026-02-14', kind: 'income', category: 'services revenue', amount_cents: 50000, org_id: 'org-1' }),
    txn({ id: 'c5', occurred_on: '2025-11-01', kind: 'income', category: 'subscriptions revenue', amount_cents: 99999 }),
    txn({ id: 'c6', occurred_on: '2025-12-05', kind: 'income', category: 'subscriptions revenue', amount_cents: 4900, recurrence: 'monthly', org_id: 'org-2' }),
  ];
  const range = { from: '2026-01-01', to: '2026-06-30' };

  it('totals the range from expanded occurrences', () => {
    expect(summarizeTransactions(ledger, range)).toEqual({
      incomeCents: 79400,
      expenseCents: 9900,
      profitCents: 69500,
      marginPct: 87.5,
      occurrenceCount: 17,
    });
  });

  it('builds a zero-filled monthly series that sums to the totals', () => {
    const monthly = buildMonthlyPnl(ledger, range);
    expect(monthly.map(m => m.month)).toEqual(['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06']);
    expect(monthly[0]).toEqual({ month: '2026-01', incomeCents: 4900, expenseCents: 1500, profitCents: 3400 });
    expect(monthly[1]).toEqual({ month: '2026-02', incomeCents: 54900, expenseCents: 1500, profitCents: 53400 });
    expect(monthly[5]).toEqual({ month: '2026-06', incomeCents: 4900, expenseCents: 3400, profitCents: 1500 });
    expect(monthly.reduce((n, m) => n + m.profitCents, 0)).toBe(69500);
  });

  it('keeps empty months in the series at zero', () => {
    const monthly = buildMonthlyPnl([txn({ occurred_on: '2026-01-05', amount_cents: 100 })], { from: '2026-01-01', to: '2026-03-31' });
    expect(monthly.map(m => m.expenseCents)).toEqual([100, 0, 0]);
  });

  it('breaks down by category, biggest first, income and expense separate', () => {
    const rows = buildCategoryBreakdown(ledger, range);
    expect(rows[0]).toEqual({ kind: 'income', category: 'services revenue', totalCents: 50000, count: 1 });
    expect(rows[1]).toEqual({ kind: 'income', category: 'subscriptions revenue', totalCents: 29400, count: 6 });
    expect(rows.find(r => r.category === 'hosting')).toEqual({ kind: 'expense', category: 'hosting', totalCents: 6000, count: 6 });
    expect(rows.find(r => r.category === 'tools')?.count).toBe(3);
  });
});

describe('financeService — CSV', () => {
  const range = { from: '2026-01-01', to: '2026-03-31' };

  it('exports the ledger as occurrences, one row per repeat', () => {
    const rows = [
      txn({ id: 'a', occurred_on: '2026-01-31', category: 'hosting', amount_cents: 1000, recurrence: 'monthly', description: 'Supabase' }),
      txn({ id: 'b', occurred_on: '2026-02-14', kind: 'income', category: 'services revenue', amount_cents: 50000, org_id: 'org-1' }),
    ];
    const csv = buildLedgerCsv(rows, range, { 'org-1': 'Rack City' });
    const lines = csv.split('\n');
    expect(lines[0]).toBe(LEDGER_CSV_HEADERS.join(','));
    expect(lines).toHaveLength(5); // header + Jan 31, Feb 14, Feb 28, Mar 31
    expect(lines[1]).toBe('2026-01-31,expense,hosting,10.00,-10.00,USD,,Supabase,monthly,2026-01-31,original');
    expect(lines[2]).toBe('2026-02-14,income,services revenue,500.00,500.00,USD,Rack City,,,,original');
    expect(lines[3]).toContain(',repeat');
  });

  it('quotes commas and quotes, and neutralizes spreadsheet formulas', () => {
    const rows = [
      txn({ id: 'a', occurred_on: '2026-01-05', category: 'tools', description: '=cmd|"/c calc"!A1' }),
      txn({ id: 'b', occurred_on: '2026-01-06', category: 'marketing', description: 'Ads, print' }),
      txn({ id: 'c', occurred_on: '2026-01-07', category: '@handle' }),
      txn({ id: 'd', occurred_on: '2026-01-08', category: '-nonstarter' }),
    ];
    const lines = buildLedgerCsv(rows, range).split('\n');
    // The formula guard prefixes an apostrophe, THEN the quoting rules apply.
    expect(lines[1]).toContain('"\'=cmd|""/c calc""!A1"');
    expect(lines[2]).toContain('"Ads, print"');
    expect(lines[3]).toContain("'@handle");
    expect(lines[4]).toContain("'-nonstarter");
    // A real negative number must NOT be escaped — it is data, not a formula.
    expect(lines[1]).toContain(',-10.00,');
  });

  it('exports the monthly P&L with a total row', () => {
    const ledger = [
      txn({ id: 'a', occurred_on: '2026-01-10', kind: 'income', category: 'sales', amount_cents: 10000 }),
      txn({ id: 'b', occurred_on: '2026-02-10', kind: 'expense', category: 'hosting', amount_cents: 2500 }),
    ];
    const monthly = buildMonthlyPnl(ledger, range);
    const csv = buildPnlCsv(monthly, summarizeTransactions(ledger, range), range);
    const lines = csv.split('\n');
    expect(lines[0]).toBe(PNL_CSV_HEADERS.join(','));
    expect(lines[1]).toBe('2026-01,100.00,0.00,100.00,100.0');
    expect(lines[2]).toBe('2026-02,0.00,25.00,-25.00,');
    expect(lines[3]).toBe('2026-03,0.00,0.00,0.00,');
    expect(lines[4]).toBe('Total 2026-01-01 to 2026-03-31,100.00,25.00,75.00,75.0');
  });

  it('names files by range', () => {
    expect(csvFilename('ledger', range)).toBe('acadia-ledger-2026-01-01-to-2026-03-31.csv');
    expect(csvFilename('pnl', range)).toBe('acadia-pnl-2026-01-01-to-2026-03-31.csv');
  });
});

describe('financeService — categories and validation', () => {
  it('suggests defaults per kind, folding in what the books already use', () => {
    const s = categorySuggestions('expense', ['Hosting', 'film scans', 'film scans']);
    expect(s[0]).toBe('hosting');
    expect(s).toContain('film scans');
    expect(s.filter(x => x.toLowerCase() === 'hosting')).toHaveLength(1); // first spelling wins
    expect(categorySuggestions('income')).toContain('subscriptions revenue');
    expect(categorySuggestions('income')).not.toContain('hosting');
  });

  it('mirrors the table CHECK constraints', () => {
    const good = { occurred_on: '2026-01-01', kind: 'expense' as const, category: 'hosting', amount_cents: 100 };
    expect(validateTransactionInput(good)).toBeNull();
    expect(validateTransactionInput({ ...good, occurred_on: '2026-02-31' })).toMatch(/date/i);
    expect(validateTransactionInput({ ...good, category: '   ' })).toMatch(/category/i);
    expect(validateTransactionInput({ ...good, category: 'x'.repeat(61) })).toMatch(/60/);
    expect(validateTransactionInput({ ...good, amount_cents: 0 })).toMatch(/amount/i);
    expect(validateTransactionInput({ ...good, description: 'x'.repeat(501) })).toMatch(/500/);
    expect(validateTransactionInput({ ...good, recurrence_ends_on: '2026-05-01' })).toMatch(/recurrence/i);
    expect(validateTransactionInput({ ...good, recurrence: 'monthly', recurrence_ends_on: '2025-05-01' })).toMatch(/before/i);
    expect(validateTransactionInput({ ...good, recurrence: 'monthly', recurrence_ends_on: '2026-05-01' })).toBeNull();
  });
});

describe('financeService — summary normalization', () => {
  it('defaults every field when the RPC returns a partial payload', () => {
    const s = normalizeSummary({}, '2026-01-01', '2026-03-31');
    expect(s.from).toBe('2026-01-01');
    expect(s.totals.profit_cents).toBe(0);
    expect(s.monthly).toEqual([]);
    expect(s.customers.active_workspaces).toBeNull();
    expect(s.currency).toBe('USD');
  });

  it('keeps active_workspaces null when analytics_events is absent, 0 when present but empty', () => {
    expect(normalizeSummary({ customers: { active_workspaces: null } }, 'a', 'b').customers.active_workspaces).toBeNull();
    expect(normalizeSummary({ customers: { active_workspaces: 0 } }, 'a', 'b').customers.active_workspaces).toBe(0);
  });

  it('coerces numeric strings from jsonb and defaults an unknown kind to expense', () => {
    const s = normalizeSummary({
      totals: { income_cents: '79400', margin_pct: '87.5' },
      by_category: [{ kind: 'weird', category: 'x', total_cents: '10' }],
      by_workspace: [{ org_id: 'o', name: 'N', plan: 'pro', founding: true, last_active: null }],
    }, 'a', 'b');
    expect(s.totals.income_cents).toBe(79400);
    expect(s.totals.margin_pct).toBe(87.5);
    expect(s.by_category[0].kind).toBe('expense');
    expect(s.by_workspace[0].founding).toBe(true);
    expect(s.by_workspace[0].last_active).toBeNull();
  });
});
