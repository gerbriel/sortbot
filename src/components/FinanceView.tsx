import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  RefreshCw, Plus, Search, Trash2, Pencil, X, Download, Printer, Check,
} from 'lucide-react';
import {
  fetchFinanceSummary, fetchTransactions, fetchPlanPrices,
  createTransaction, updateTransaction, deleteTransaction, savePlanPrice,
  buildMonthlyPnl, summarizeTransactions, buildLedgerCsv, buildPnlCsv, csvFilename,
  categorySuggestions, expandOccurrences, validateTransactionInput,
  formatMoney, formatMoneyShort, parseAmountToCents, centsToPlainDollars,
  rangeForPreset, previousRange, todayKey, monthsBetween, marginPct,
  RANGE_PRESETS,
  type DateRange, type RangePreset, type FinanceKind, type Recurrence,
  type FinanceSummary, type FinanceTransaction, type FinancePlanPrice,
  type MonthlyPnlRow, type PnlTotals,
} from '../lib/financeService';
// Same shared founder-tool styles the Analytics and CRM views pull in
// (ft-card, ft-toolbar, beta-chip, an-tile, an-table, org-confirm-*).
import './OrgPanel.css';
import './FinanceView.css';

type Tab = 'overview' | 'transactions' | 'customers' | 'reports';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'transactions', label: 'Transactions' },
  { id: 'customers', label: 'Customers' },
  { id: 'reports', label: 'Reports' },
];

type Status = 'loading' | 'ok' | 'unavailable' | 'forbidden';

interface FinanceLoad {
  status: Status;
  summary: FinanceSummary | null;
  transactions: FinanceTransaction[];
  prices: FinancePlanPrice[];
}

/** One round of fetching. No React state here — callers apply it in `.then`. */
async function loadFinance(range: DateRange): Promise<FinanceLoad> {
  const [summary, txns, prices] = await Promise.all([
    fetchFinanceSummary(range.from, range.to),
    fetchTransactions(),
    fetchPlanPrices(),
  ]);
  if (summary.status !== 'ok') {
    return { status: summary.status, summary: null, transactions: [], prices: [] };
  }
  return {
    status: 'ok',
    summary: summary.summary,
    transactions: txns.status === 'ok' ? txns.transactions : [],
    prices: prices.status === 'ok' ? prices.prices : [],
  };
}

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—';

const fmtMonth = (month: string) =>
  new Date(`${month}-01T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', year: '2-digit', timeZone: 'UTC' });

const fmtMonthLong = (month: string) =>
  new Date(`${month}-01T00:00:00Z`).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });

/** Download a string as a file, then release the object URL. */
function downloadCsv(text: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8;' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Finance — the founder's books as a full page: profit and loss over a range,
 * the ledger they type into, what the customer base is worth, and reports they
 * can hand to an accountant.
 *
 * Everything is first-party: `finance_transactions` + `finance_summary()` in
 * this project's own Postgres. No payment processor, no accounting vendor.
 *
 * Recurring rows are expanded (never stored), by `finance_summary` on the
 * server and by `expandOccurrences` on the client — one rule, two
 * implementations, both unit-tested, so the chart, the CSV and the printed
 * statement always agree.
 */
export default function FinanceView() {
  const today = todayKey();
  const [tab, setTab] = useState<Tab>('overview');
  const [preset, setPreset] = useState<RangePreset>('ytd');
  const [customFrom, setCustomFrom] = useState(rangeForPreset('ytd', today).from);
  const [customTo, setCustomTo] = useState(today);
  const [load, setLoad] = useState<FinanceLoad>({ status: 'loading', summary: null, transactions: [], prices: [] });
  const [reloadKey, setReloadKey] = useState(0);

  const range = useMemo<DateRange>(
    () => (preset === 'custom' ? { from: customFrom, to: customTo } : rangeForPreset(preset, today)),
    [preset, customFrom, customTo, today],
  );
  const validRange = range.from <= range.to;

  const apply = useCallback((next: FinanceLoad) => setLoad(next), []);

  useEffect(() => {
    if (!validRange) return;
    let cancelled = false;
    loadFinance(range).then(r => { if (!cancelled) apply(r); });
    return () => { cancelled = true; };
  }, [range, validRange, reloadKey, apply]);

  const reload = () => {
    setLoad(l => ({ ...l, status: 'loading' }));
    setReloadKey(k => k + 1);
  };

  const changePreset = (p: RangePreset) => {
    if (p === preset) return;
    if (p !== 'custom') {
      const r = rangeForPreset(p, today);
      setCustomFrom(r.from);
      setCustomTo(r.to);
    }
    setLoad(l => ({ ...l, status: 'loading' }));
    setPreset(p);
  };

  if (load.status === 'forbidden') {
    return <section className="ft-card"><p className="ft-error">Founding Workspace admins only.</p></section>;
  }

  if (load.status === 'unavailable') {
    return (
      <section className="ft-card">
        <p className="ft-setup">
          Finance is not set up yet — run <code>supabase/migrations/finance.sql</code> in the SQL Editor.
          It adds the ledger, the plan-price table and the <code>finance_summary()</code> aggregate.
          Nothing here talks to a payment processor or an accounting service: the books live in this project.
        </p>
      </section>
    );
  }

  const summary = load.summary;
  const orgNames: Record<string, string> = {};
  for (const w of summary?.by_workspace ?? []) orgNames[w.org_id] = w.name;

  return (
    <div className="fin-view">
      <nav className="fin-tabs fin-noprint" role="tablist" aria-label="Finance sections">
        {TABS.map(t => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={`fin-tab${tab === t.id ? ' fin-tab--on' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {tab !== 'transactions' && (
        <section className="ft-card fin-noprint">
          <div className="ft-toolbar fin-range">
            <div className="ft-chips">
              {RANGE_PRESETS.map(p => (
                <button
                  key={p.id}
                  className={`beta-chip ${preset === p.id ? 'beta-chip--active' : ''}`}
                  onClick={() => changePreset(p.id)}
                >
                  {p.label}
                </button>
              ))}
              <button
                className={`beta-chip ${preset === 'custom' ? 'beta-chip--active' : ''}`}
                onClick={() => changePreset('custom')}
              >
                Custom
              </button>
            </div>
            <label className="fin-range-field">
              From
              <input type="date" value={range.from} max={range.to}
                onChange={e => { setPreset('custom'); setCustomFrom(e.target.value); }} />
            </label>
            <label className="fin-range-field">
              To
              <input type="date" value={range.to} min={range.from}
                onChange={e => { setPreset('custom'); setCustomTo(e.target.value); }} />
            </label>
            <button className="org-icon-btn" title="Refresh" onClick={reload} disabled={load.status === 'loading'}>
              <RefreshCw size={13} className={load.status === 'loading' ? 'ft-spin' : ''} />
            </button>
          </div>
          {!validRange && <p className="ft-error">The end date is before the start date.</p>}
        </section>
      )}

      {load.status === 'loading' && !summary && <p className="org-panel-loading">Loading the books…</p>}

      {summary && tab === 'overview' && <Overview summary={summary} range={range} />}
      {summary && tab === 'transactions' && (
        <Transactions
          transactions={load.transactions}
          workspaces={summary.by_workspace}
          onChanged={reload}
        />
      )}
      {summary && tab === 'customers' && (
        <Customers summary={summary} prices={load.prices} range={range} onChanged={reload} />
      )}
      {summary && tab === 'reports' && (
        <Reports summary={summary} transactions={load.transactions} range={range} orgNames={orgNames} />
      )}
    </div>
  );
}

// ── Overview ─────────────────────────────────────────────────────────────────

function Overview({ summary, range }: { summary: FinanceSummary; range: DateRange }) {
  const t = summary.totals;
  const p = summary.previous;
  const prev = previousRange(range);
  const empty = t.transaction_count === 0;

  return (
    <>
      <div className="an-kpis">
        <Tile label="Income" value={t.income_cents} previous={p.income_cents} />
        <Tile label="Expenses" value={t.expense_cents} previous={p.expense_cents} invert />
        <Tile label="Profit" value={t.profit_cents} previous={p.profit_cents} />
        <Tile label="Margin" text={`${t.margin_pct}%`} note={`${t.transaction_count} entries in range`} />
      </div>
      <p className="ft-help">
        {range.from} → {range.to} · compared with {prev.from} → {prev.to}.
        Recurring entries are counted once per month they land in, so a monthly bill shows up every month.
      </p>

      {empty ? (
        <p className="ft-help">
          Nothing in the books for this range yet. Add income and expenses in the Transactions tab —
          mark the repeating ones monthly or yearly and they will fill in by themselves.
        </p>
      ) : (
        <>
          <section className="ft-card">
            <h4 className="an-h">Income vs expenses by month</h4>
            <MonthlyChart monthly={summary.monthly} />
            <table className="an-table fin-table">
              <thead>
                <tr><th>Month</th><th className="an-num">Income</th><th className="an-num">Expenses</th><th className="an-num">Profit</th><th className="an-num">Margin</th></tr>
              </thead>
              <tbody>
                {summary.monthly.map(m => (
                  <tr key={m.month}>
                    <td>{fmtMonth(m.month)}</td>
                    <td className="an-num">{formatMoney(m.income_cents)}</td>
                    <td className="an-num">{formatMoney(m.expense_cents)}</td>
                    <td className={`an-num ${m.profit_cents < 0 ? 'fin-neg' : m.profit_cents > 0 ? 'fin-pos' : ''}`}>
                      {formatMoney(m.profit_cents)}
                    </td>
                    <td className="an-num">{m.income_cents > 0 ? `${marginPct(m.income_cents, m.profit_cents)}%` : '—'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th>Total</th>
                  <th className="an-num">{formatMoney(t.income_cents)}</th>
                  <th className="an-num">{formatMoney(t.expense_cents)}</th>
                  <th className="an-num">{formatMoney(t.profit_cents)}</th>
                  <th className="an-num">{t.margin_pct}%</th>
                </tr>
              </tfoot>
            </table>
          </section>

          <div className="fin-two-up">
            <CategoryTable title="Where the money came from" rows={summary.by_category.filter(c => c.kind === 'income')} total={t.income_cents} />
            <CategoryTable title="Where the money went" rows={summary.by_category.filter(c => c.kind === 'expense')} total={t.expense_cents} />
          </div>
        </>
      )}
    </>
  );
}

function Tile({ label, value, previous, text, note, invert }: {
  label: string; value?: number; previous?: number; text?: string; note?: string; invert?: boolean;
}) {
  const delta = value !== undefined && previous ? (value - previous) / Math.abs(previous) : null;
  // On expenses, growth is the bad direction — so the colour flips.
  const good = delta === null ? null : invert ? delta <= 0 : delta >= 0;
  return (
    <div className="an-tile">
      <span className="an-tile-label">{label}</span>
      <span className={`an-tile-value ${value !== undefined && value < 0 ? 'fin-neg' : ''}`}>
        {text ?? formatMoneyShort(value ?? 0)}
      </span>
      <span className={`an-tile-delta ${good === null ? '' : good ? 'an-tile-delta--up' : 'an-tile-delta--down'}`}>
        {note ?? (delta === null ? 'no previous period' : `${delta >= 0 ? '+' : '−'}${Math.abs(Math.round(delta * 100))}% vs previous range`)}
      </span>
    </div>
  );
}

function CategoryTable({ title, rows, total }: {
  title: string; rows: FinanceSummary['by_category']; total: number;
}) {
  return (
    <section className="ft-card">
      <h4 className="an-h">{title}</h4>
      {rows.length === 0 ? <p className="ft-help">Nothing in this range.</p> : (
        <table className="an-table fin-table">
          <thead><tr><th>Category</th><th className="an-num">Total</th><th>Share</th></tr></thead>
          <tbody>
            {rows.map(r => {
              const share = total > 0 ? (r.total_cents / total) * 100 : 0;
              return (
                <tr key={`${r.kind}-${r.category}`}>
                  <td>{r.category}<span className="fin-count">{r.count}×</span></td>
                  <td className="an-num">{formatMoney(r.total_cents)}</td>
                  <td>
                    <span className="an-meter" aria-hidden="true"><span style={{ width: `${share}%` }} /></span>
                    <span className="an-num an-meter-label">{Math.round(share)}%</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

/**
 * Grouped column chart, plain HTML: two thin bars per month, 4px caps rounded
 * at the top and square at the baseline, three hairline gridlines, a legend
 * (there are two series), and a per-month tooltip on hover and focus. Every
 * value is repeated in the table underneath, so nothing is gated on pointing.
 */
function MonthlyChart({ monthly }: { monthly: FinanceSummary['monthly'] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = monthly.reduce((m, x) => Math.max(m, x.income_cents, x.expense_cents), 0);
  const ceil = niceMoneyCeiling(max);
  const ticks = [ceil, ceil / 2, 0];
  const labelEvery = monthly.length > 24 ? 3 : monthly.length > 12 ? 2 : 1;
  const hovered = hover !== null ? monthly[hover] : null;

  return (
    /* The legend sits OUTSIDE the scroll box on purpose: on a phone the chart
       scrolls sideways (see FinanceView.css), and a legend that scrolls with the
       bars is gone the moment you look at the months that matter. */
    <div className="fin-chart-wrap">
      <div className="fin-legend" aria-hidden="true">
        <span><i className="fin-swatch fin-swatch--income" /> Income</span>
        <span><i className="fin-swatch fin-swatch--expense" /> Expenses</span>
      </div>
      <div className="fin-chart-scroll">
      <div className="fin-chart" onPointerLeave={() => setHover(null)} onBlur={() => setHover(null)}>
      <div className="fin-plot">
        {ticks.map(tk => (
          <div key={tk} className="an-gridline" style={{ bottom: `${(tk / ceil) * 100}%` }}>
            <span>{formatMoneyShort(tk)}</span>
          </div>
        ))}
        <div className="fin-bars" role="img" aria-label="Income and expenses by month">
          {monthly.map((m, i) => (
            <div
              key={m.month}
              className={`fin-slot ${hover === i ? 'fin-slot--hover' : ''}`}
              tabIndex={0}
              aria-label={`${fmtMonthLong(m.month)}: income ${formatMoney(m.income_cents)}, expenses ${formatMoney(m.expense_cents)}, profit ${formatMoney(m.profit_cents)}`}
              onPointerEnter={() => setHover(i)}
              onFocus={() => setHover(i)}
            >
              <div className="fin-bar fin-bar--income" style={{ height: barHeight(m.income_cents, ceil) }} />
              <div className="fin-bar fin-bar--expense" style={{ height: barHeight(m.expense_cents, ceil) }} />
            </div>
          ))}
        </div>
        {hovered && hover !== null && (
          <div className="an-tooltip fin-tooltip" style={{ left: `${((hover + 0.5) / monthly.length) * 100}%` }}>
            <strong>{formatMoney(hovered.profit_cents)}</strong> profit
            <span>{formatMoney(hovered.income_cents)} in · {formatMoney(hovered.expense_cents)} out</span>
            <span>{fmtMonthLong(hovered.month)}</span>
          </div>
        )}
      </div>
      <div className="an-xaxis">
        {monthly.map((m, i) => (
          (i % labelEvery === 0 || i === monthly.length - 1) && (
            <span key={m.month} className="an-xlabel" style={{ left: `${((i + 0.5) / monthly.length) * 100}%` }}>{fmtMonth(m.month)}</span>
          )
        ))}
      </div>
      </div>
      </div>
    </div>
  );
}

const barHeight = (cents: number, ceil: number) => `${cents > 0 ? Math.max(2, (cents / ceil) * 100) : 0}%`;

/** Clean tick ceiling in whole dollars: 1 / 2 / 5 × 10^k. */
function niceMoneyCeiling(maxCents: number): number {
  if (maxCents <= 0) return 100;
  const exp = Math.floor(Math.log10(maxCents));
  const base = Math.pow(10, exp);
  const m = maxCents / base;
  const step = m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10;
  return step * base;
}

// ── Transactions ─────────────────────────────────────────────────────────────

interface FormState {
  id: string | null;
  occurred_on: string;
  kind: FinanceKind;
  category: string;
  amount: string;
  description: string;
  org_id: string;
  recurrence: '' | Recurrence;
  recurrence_ends_on: string;
}

const emptyForm = (): FormState => ({
  id: null, occurred_on: todayKey(), kind: 'expense', category: '', amount: '',
  description: '', org_id: '', recurrence: '', recurrence_ends_on: '',
});

const formFor = (t: FinanceTransaction): FormState => ({
  id: t.id,
  occurred_on: t.occurred_on,
  kind: t.kind,
  category: t.category,
  amount: centsToPlainDollars(t.amount_cents),
  description: t.description ?? '',
  org_id: t.org_id ?? '',
  recurrence: t.recurrence ?? '',
  recurrence_ends_on: t.recurrence_ends_on ?? '',
});

function Transactions({ transactions, workspaces, onChanged }: {
  transactions: FinanceTransaction[];
  workspaces: FinanceSummary['by_workspace'];
  onChanged: () => void;
}) {
  const [kind, setKind] = useState<FinanceKind | 'all'>('all');
  const [category, setCategory] = useState('all');
  const [org, setOrg] = useState('all');
  const [query, setQuery] = useState('');
  const [form, setForm] = useState<FormState | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const orgName = useMemo(() => {
    const map: Record<string, string> = {};
    for (const w of workspaces) map[w.org_id] = w.name;
    return map;
  }, [workspaces]);

  const categories = useMemo(
    () => [...new Set(transactions.map(t => t.category))].sort((a, b) => a.localeCompare(b)),
    [transactions],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return transactions.filter(t => {
      if (kind !== 'all' && t.kind !== kind) return false;
      if (category !== 'all' && t.category !== category) return false;
      if (org !== 'all' && (t.org_id ?? '') !== org) return false;
      if (!q) return true;
      return `${t.category} ${t.description ?? ''} ${orgName[t.org_id ?? ''] ?? ''} ${t.occurred_on}`.toLowerCase().includes(q);
    });
  }, [transactions, kind, category, org, query, orgName]);

  const footer = useMemo(() => {
    let income = 0;
    let expense = 0;
    for (const t of visible) {
      if (t.kind === 'income') income += t.amount_cents;
      else expense += t.amount_cents;
    }
    return { income, expense, profit: income - expense };
  }, [visible]);

  const openNew = () => { setForm(emptyForm()); setFormError(null); };
  const openEdit = (t: FinanceTransaction) => { setForm(formFor(t)); setFormError(null); setConfirmDelete(null); };

  const save = async () => {
    if (!form || busy) return;
    const amount_cents = parseAmountToCents(form.amount);
    if (amount_cents === null) { setFormError('Enter an amount greater than zero.'); return; }
    const input = {
      occurred_on: form.occurred_on,
      kind: form.kind,
      category: form.category.trim(),
      amount_cents,
      description: form.description,
      org_id: form.org_id || null,
      recurrence: form.recurrence || null,
      recurrence_ends_on: form.recurrence ? (form.recurrence_ends_on || null) : null,
    };
    const problem = validateTransactionInput(input);
    if (problem) { setFormError(problem); return; }
    setBusy(true);
    const ok = form.id
      ? Boolean(await updateTransaction(form.id, input))
      : (await createTransaction(input)).ok;
    setBusy(false);
    if (!ok) { setFormError('Could not save that. Check you are signed in to the Founding Workspace.'); return; }
    setForm(null);
    onChanged();
  };

  const remove = async (id: string) => {
    if (busy) return;
    setBusy(true);
    const ok = await deleteTransaction(id);
    setBusy(false);
    setConfirmDelete(null);
    if (ok) onChanged();
  };

  // Preview: what this row will actually add to the books this year.
  const previewCount = form && form.recurrence
    ? expandOccurrences(
      { occurred_on: form.occurred_on, recurrence: form.recurrence, recurrence_ends_on: form.recurrence_ends_on || null },
      { from: form.occurred_on, to: `${Number(form.occurred_on.slice(0, 4)) + 1}-12-31` },
    ).length
    : 0;

  return (
    <>
      <section className="ft-card">
        <div className="ft-toolbar">
          <div className="ft-chips">
            {(['all', 'income', 'expense'] as const).map(k => (
              <button key={k} className={`beta-chip ${kind === k ? 'beta-chip--active' : ''}`} onClick={() => setKind(k)}>
                {k === 'all' ? `All ${transactions.length}` : k}
              </button>
            ))}
          </div>
          <select className="org-role-select" value={category} onChange={e => setCategory(e.target.value)} aria-label="Category">
            <option value="all">Every category</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <select className="org-role-select" value={org} onChange={e => setOrg(e.target.value)} aria-label="Workspace">
            <option value="all">Every workspace</option>
            <option value="">No workspace</option>
            {workspaces.map(w => <option key={w.org_id} value={w.org_id}>{w.name}</option>)}
          </select>
          <div className="beta-search">
            <Search size={13} />
            <input placeholder="Search category, note, workspace" value={query} onChange={e => setQuery(e.target.value)} />
          </div>
          <button className="org-invite-btn" onClick={openNew}><Plus size={13} /> Add entry</button>
        </div>

        {form && (
          <div className="fin-form">
            <div className="fin-form-grid">
              <label>Date
                <input type="date" value={form.occurred_on} onChange={e => setForm({ ...form, occurred_on: e.target.value })} />
              </label>
              <label>Kind
                <select value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value as FinanceKind })}>
                  <option value="expense">Expense</option>
                  <option value="income">Income</option>
                </select>
              </label>
              <label>Category
                <input list="fin-category-options" value={form.category} maxLength={60}
                  placeholder={form.kind === 'income' ? 'subscriptions revenue' : 'hosting'}
                  onChange={e => setForm({ ...form, category: e.target.value })} />
                <datalist id="fin-category-options">
                  {categorySuggestions(form.kind, categories).map(c => <option key={c} value={c} />)}
                </datalist>
              </label>
              <label>Amount (USD)
                <input inputMode="decimal" placeholder="49.00" value={form.amount}
                  onChange={e => setForm({ ...form, amount: e.target.value })} />
              </label>
              <label>Workspace
                <select value={form.org_id} onChange={e => setForm({ ...form, org_id: e.target.value })}>
                  <option value="">None</option>
                  {workspaces.map(w => <option key={w.org_id} value={w.org_id}>{w.name}</option>)}
                </select>
              </label>
              <label>Repeats
                <select value={form.recurrence} onChange={e => setForm({ ...form, recurrence: e.target.value as '' | Recurrence })}>
                  <option value="">Once</option>
                  <option value="monthly">Monthly</option>
                  <option value="yearly">Yearly</option>
                </select>
              </label>
              <label>Repeats until
                <input type="date" value={form.recurrence_ends_on} disabled={!form.recurrence} min={form.occurred_on}
                  onChange={e => setForm({ ...form, recurrence_ends_on: e.target.value })} />
              </label>
              <label className="fin-form-wide">Note
                <input value={form.description} maxLength={500} placeholder="What this was for"
                  onChange={e => setForm({ ...form, description: e.target.value })} />
              </label>
            </div>
            {form.recurrence && (
              <p className="ft-help">
                Saved once, counted {previewCount} times between {form.occurred_on} and the end of next year
                {form.recurrence_ends_on ? ` (stops ${form.recurrence_ends_on})` : ' (no end date)'}.
              </p>
            )}
            {formError && <p className="ft-error">{formError}</p>}
            <div className="fin-form-actions">
              <button className="org-invite-btn" disabled={busy} onClick={() => void save()}>
                <Check size={13} /> {form.id ? 'Save changes' : 'Add to the books'}
              </button>
              <button className="org-confirm-no" onClick={() => setForm(null)}><X size={13} /> Cancel</button>
            </div>
          </div>
        )}

        {transactions.length === 0 && <p className="ft-help">The books are empty. Add the first entry with “Add entry”.</p>}
        {transactions.length > 0 && visible.length === 0 && <p className="org-panel-loading">Nothing matches this filter.</p>}

        {visible.length > 0 && (
          <div className="fin-scroll">
            <table className="an-table an-table--cards fin-table fin-ledger">
              <thead>
                <tr>
                  <th>Date</th><th>Kind</th><th>Category</th><th className="an-num">Amount</th>
                  <th>Workspace</th><th>Repeats</th><th>Note</th><th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {visible.map(t => (
                  <tr key={t.id} className={confirmDelete === t.id ? 'fin-row--danger' : ''}>
                    {/* data-col drives the phone card layout ONLY (grid-template-areas
                        in FinanceView.css). It changes nothing on a desktop, and it is
                        an attribute rather than nth-child so re-ordering a column here
                        cannot silently scramble the card. */}
                    <td data-col="date">{t.occurred_on}</td>
                    <td data-col="kind"><span className={`fin-kind fin-kind--${t.kind}`}>{t.kind}</span></td>
                    <td data-col="category">{t.category}</td>
                    <td data-col="amount" className={`an-num ${t.kind === 'income' ? 'fin-pos' : ''}`}>
                      {t.kind === 'income' ? formatMoney(t.amount_cents) : `−${formatMoney(t.amount_cents)}`}
                    </td>
                    <td data-col="workspace">{t.org_id ? (orgName[t.org_id] ?? 'unknown') : '—'}</td>
                    <td data-col="repeats">{t.recurrence ? `${t.recurrence}${t.recurrence_ends_on ? ` → ${t.recurrence_ends_on}` : ''}` : 'once'}</td>
                    <td data-col="note" className="fin-note">{t.description ?? ''}</td>
                    <td data-col="actions" className="fin-actions">
                      {confirmDelete === t.id ? (
                        <span className="org-confirm-actions">
                          <button className="org-confirm-yes" disabled={busy} onClick={() => void remove(t.id)}>Delete</button>
                          <button className="org-confirm-no" disabled={busy} onClick={() => setConfirmDelete(null)}>Cancel</button>
                        </span>
                      ) : (
                        <>
                          <button className="org-icon-btn" title="Edit" onClick={() => openEdit(t)}><Pencil size={12} /></button>
                          <button className="org-icon-btn org-icon-danger" title="Delete" onClick={() => setConfirmDelete(t.id)}><Trash2 size={12} /></button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th colSpan={3}>{visible.length} of {transactions.length} entries</th>
                  <th className="an-num">{formatMoney(footer.profit)}</th>
                  <th colSpan={4}>
                    {formatMoney(footer.income)} in · {formatMoney(footer.expense)} out
                    <span className="fin-count">one-off totals; repeats counted once here</span>
                  </th>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

// ── Customers ────────────────────────────────────────────────────────────────

function Customers({ summary, prices, range, onChanged }: {
  summary: FinanceSummary; prices: FinancePlanPrice[]; range: DateRange; onChanged: () => void;
}) {
  const c = summary.customers;
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [newPlan, setNewPlan] = useState('');
  const [newPrice, setNewPrice] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const savePrice = async (plan: string, dollars: string) => {
    const cents = dollars.trim() === '0' ? 0 : parseAmountToCents(dollars);
    if (cents === null) { setNote(`“${dollars}” is not an amount.`); return; }
    setBusy(true);
    const ok = await savePlanPrice(plan, cents);
    setBusy(false);
    setNote(ok ? `${plan} is now ${formatMoney(cents)} a month.` : 'Could not save that price.');
    if (ok) {
      setDrafts(d => { const next = { ...d }; delete next[plan]; return next; });
      onChanged();
    }
  };

  const addPlan = async () => {
    const cents = newPrice.trim() === '0' ? 0 : parseAmountToCents(newPrice);
    if (!newPlan.trim() || cents === null) { setNote('A plan needs a name and a price.'); return; }
    setBusy(true);
    const ok = await savePlanPrice(newPlan, cents);
    setBusy(false);
    if (ok) { setNewPlan(''); setNewPrice(''); setNote(null); onChanged(); }
    else setNote('Could not add that plan.');
  };

  return (
    <>
      <div className="an-kpis">
        <Tile label="Workspaces" text={String(c.total_workspaces)} note={`${c.new_workspaces} new in range`} />
        <Tile label="People" text={String(c.total_members)} note={`${c.new_members} new in range`} />
        <Tile
          label="Active in range"
          text={c.active_workspaces === null ? '—' : String(c.active_workspaces)}
          note={c.active_workspaces === null ? 'needs analytics_events.sql' : 'workspaces with recorded activity'}
        />
        <Tile
          label="Projected MRR"
          text={formatMoneyShort(c.projected_mrr_cents)}
          note={`${formatMoney(c.projected_mrr_list_cents)} at list · ${c.founding_workspaces} founding at ${c.founding_discount_pct}% off`}
        />
      </div>
      <p className="ft-help">
        Projected MRR values every workspace at its plan’s price. A workspace counts as founding when its plan is
        beta or it was created on or before the founding cutoff — those keep {c.founding_discount_pct}% off for life,
        which is why the two numbers differ. Both are $0 until workspaces are moved onto a paid plan.
      </p>

      <section className="ft-card">
        <h4 className="an-h">Workspaces</h4>
        <div className="fin-scroll">
          <table className="an-table an-table--cards fin-table">
            <thead>
              <tr>
                <th>Workspace</th><th>Plan</th><th className="an-num">People</th>
                <th className="an-num">Income in range</th><th className="an-num">Monthly value</th>
                <th>Last active</th>
              </tr>
            </thead>
            <tbody>
              {summary.by_workspace.map(w => (
                <tr key={w.org_id}>
                  <td data-label="Workspace">
                    {w.name}
                    {w.founding && <span className="fin-count">founding</span>}
                  </td>
                  <td data-label="Plan"><span className="org-plan-badge">{w.plan}</span></td>
                  <td data-label="People" className="an-num">{w.members}</td>
                  <td data-label="Income in range" className="an-num">{w.income_cents > 0 ? formatMoney(w.income_cents) : '—'}</td>
                  <td data-label="Monthly value" className="an-num">{w.monthly_value_cents > 0 ? formatMoney(w.monthly_value_cents) : '—'}</td>
                  <td data-label="Last active">{w.last_active ? fmtDate(w.last_active) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="ft-help">Income in range is what this workspace was recorded as paying between {range.from} and {range.to}.</p>
      </section>

      <div className="fin-two-up">
        <section className="ft-card">
          <h4 className="an-h">Plans in use</h4>
          <table className="an-table fin-table">
            <thead><tr><th>Plan</th><th className="an-num">Workspaces</th><th className="an-num">People</th><th className="an-num">List price</th></tr></thead>
            <tbody>
              {c.by_plan.map(p => (
                <tr key={p.plan}>
                  <td>{p.plan}</td>
                  <td className="an-num">{p.workspaces}</td>
                  <td className="an-num">{p.members}</td>
                  <td className="an-num">{formatMoney(p.monthly_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="ft-card">
          <h4 className="an-h">Plan prices</h4>
          <p className="ft-help">What each plan is worth per month. Editing a price re-values every workspace on it.</p>
          <table className="an-table fin-table">
            <thead><tr><th>Plan</th><th className="an-num">Monthly (USD)</th><th aria-label="Actions" /></tr></thead>
            <tbody>
              {prices.map(p => {
                const draft = drafts[p.plan];
                const dirty = draft !== undefined && draft !== centsToPlainDollars(p.monthly_cents);
                return (
                  <tr key={p.plan}>
                    <td>{p.plan}{p.note && <span className="fin-count" title={p.note}>note</span>}</td>
                    <td className="an-num">
                      <input
                        className="fin-price-input"
                        inputMode="decimal"
                        value={draft ?? centsToPlainDollars(p.monthly_cents)}
                        onChange={e => setDrafts(d => ({ ...d, [p.plan]: e.target.value }))}
                      />
                    </td>
                    <td>
                      <button className="org-icon-btn" title="Save price" disabled={busy || !dirty}
                        onClick={() => void savePrice(p.plan, draft ?? '')}>
                        <Check size={12} />
                      </button>
                    </td>
                  </tr>
                );
              })}
              <tr>
                <td><input placeholder="new plan" value={newPlan} maxLength={40} onChange={e => setNewPlan(e.target.value)} /></td>
                <td className="an-num"><input className="fin-price-input" inputMode="decimal" placeholder="0.00" value={newPrice} onChange={e => setNewPrice(e.target.value)} /></td>
                <td>
                  <button className="org-icon-btn" title="Add plan" disabled={busy || !newPlan.trim()} onClick={() => void addPlan()}>
                    <Plus size={12} />
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
          {note && <p className="ft-result">{note}</p>}
        </section>
      </div>
    </>
  );
}

// ── Reports ──────────────────────────────────────────────────────────────────

function Reports({ summary, transactions, range, orgNames }: {
  summary: FinanceSummary; transactions: FinanceTransaction[]; range: DateRange; orgNames: Record<string, string>;
}) {
  // Built client-side from the same expansion rule the server uses, so the file
  // the founder downloads matches the dashboard they are looking at.
  const monthly: MonthlyPnlRow[] = useMemo(() => buildMonthlyPnl(transactions, range), [transactions, range]);
  const totals: PnlTotals = useMemo(() => summarizeTransactions(transactions, range), [transactions, range]);
  const months = monthsBetween(range);

  const drift = totals.profitCents !== summary.totals.profit_cents;

  return (
    <>
      <section className="ft-card fin-noprint">
        <h4 className="an-h">Download</h4>
        <p className="ft-help">
          {range.from} → {range.to} · {months.length} month{months.length === 1 ? '' : 's'} ·
          {' '}{totals.occurrenceCount} entries once repeats are counted.
        </p>
        <div className="fin-form-actions">
          <button className="org-invite-btn"
            onClick={() => downloadCsv(buildLedgerCsv(transactions, range, orgNames), csvFilename('ledger', range))}>
            <Download size={13} /> Download ledger CSV
          </button>
          <button className="org-invite-btn"
            onClick={() => downloadCsv(buildPnlCsv(monthly, totals, range), csvFilename('pnl', range))}>
            <Download size={13} /> Download monthly P&amp;L CSV
          </button>
          <button className="org-confirm-no" onClick={() => window.print()}>
            <Printer size={13} /> Print statement
          </button>
        </div>
        <p className="ft-help">
          The ledger exports one row per occurrence — a monthly bill appears in every month it lands in, so the file
          adds up to the profit below. Amounts are plain numbers; text that a spreadsheet would treat as a formula is
          neutralised on the way out.
        </p>
        {drift && (
          <p className="ft-error">
            These totals were built from {transactions.length} loaded rows and differ from the server’s
            ({formatMoney(summary.totals.profit_cents)}). Refresh before relying on the export.
          </p>
        )}
      </section>

      <section className="ft-card fin-print">
        <header className="fin-statement-head">
          <h3>Profit and loss</h3>
          <p>{range.from} to {range.to}</p>
        </header>
        <table className="an-table fin-table fin-statement">
          <thead>
            <tr><th>Month</th><th className="an-num">Income</th><th className="an-num">Expenses</th><th className="an-num">Profit</th></tr>
          </thead>
          <tbody>
            {monthly.map(m => (
              <tr key={m.month}>
                <td>{fmtMonthLong(m.month)}</td>
                <td className="an-num">{formatMoney(m.incomeCents)}</td>
                <td className="an-num">{formatMoney(m.expenseCents)}</td>
                <td className={`an-num ${m.profitCents < 0 ? 'fin-neg' : ''}`}>{formatMoney(m.profitCents)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th>Total</th>
              <th className="an-num">{formatMoney(totals.incomeCents)}</th>
              <th className="an-num">{formatMoney(totals.expenseCents)}</th>
              <th className={`an-num ${totals.profitCents < 0 ? 'fin-neg' : ''}`}>{formatMoney(totals.profitCents)}</th>
            </tr>
            <tr>
              <th>Margin</th>
              <th className="an-num" colSpan={3}>{totals.marginPct}%</th>
            </tr>
          </tfoot>
        </table>

        <h4 className="an-h">By category</h4>
        <table className="an-table fin-table fin-statement">
          <thead><tr><th>Category</th><th>Kind</th><th className="an-num">Total</th></tr></thead>
          <tbody>
            {summary.by_category.map(r => (
              <tr key={`${r.kind}-${r.category}`}>
                <td>{r.category}</td>
                <td>{r.kind}</td>
                <td className="an-num">{formatMoney(r.total_cents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="fin-statement-foot">
          Prepared from the Acadia books · recurring entries counted once per month they land in.
        </p>
      </section>
    </>
  );
}
