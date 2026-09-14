import { describe, it, expect, afterAll, afterEach, beforeAll, beforeEach, vi } from 'vitest';
import { act } from 'react';
import FinanceView from './FinanceView';
import { mount, cleanup, click, one, all, buttonByText } from './ui/testUtils';
import {
  fetchFinanceSummary, fetchTransactions, fetchPlanPrices, normalizeSummary,
  type FinanceTransaction,
} from '../lib/financeService';

/**
 * FinanceView is the only place the finance numbers are actually assembled into
 * a page, and until App.tsx is wired it is not rendered anywhere else — so the
 * render path needs a test of its own. Only the network functions are mocked;
 * every pure helper (expansion, formatting, CSV) runs for real, which is what
 * makes the assertions below meaningful.
 */

vi.mock('../lib/financeService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/financeService')>();
  return {
    ...actual,
    fetchFinanceSummary: vi.fn(),
    fetchTransactions: vi.fn(),
    fetchPlanPrices: vi.fn(),
  };
});

const txn = (over: Partial<FinanceTransaction>): FinanceTransaction => ({
  id: over.id ?? 't1',
  occurred_on: '2026-01-31',
  kind: 'expense',
  category: 'hosting',
  amount_cents: 1000,
  currency: 'USD',
  description: 'Supabase',
  org_id: null,
  recurrence: null,
  recurrence_ends_on: null,
  created_by: null,
  created_at: '2026-01-31T00:00:00Z',
  updated_at: '2026-01-31T00:00:00Z',
  ...over,
});

const summary = normalizeSummary({
  from: '2026-01-01', to: '2026-03-31', days: 90, currency: 'USD',
  totals: { income_cents: 50000, expense_cents: 3000, profit_cents: 47000, margin_pct: 94, transaction_count: 4 },
  previous: { from: '2025-10-03', to: '2025-12-31', income_cents: 25000, expense_cents: 1000, profit_cents: 24000, transaction_count: 2 },
  monthly: [
    { month: '2026-01', income_cents: 0, expense_cents: 1000, profit_cents: -1000 },
    { month: '2026-02', income_cents: 50000, expense_cents: 1000, profit_cents: 49000 },
    { month: '2026-03', income_cents: 0, expense_cents: 1000, profit_cents: -1000 },
  ],
  by_category: [
    { kind: 'income', category: 'services revenue', total_cents: 50000, count: 1 },
    { kind: 'expense', category: 'hosting', total_cents: 3000, count: 3 },
  ],
  by_workspace: [
    { org_id: 'org-1', name: 'Rack City', plan: 'pro', members: 2, income_cents: 50000, monthly_value_cents: 12900, founding: false, created_at: '2026-01-01T00:00:00Z', last_active: '2026-03-02T00:00:00Z' },
  ],
  customers: {
    total_workspaces: 3, total_members: 4, new_workspaces: 1, new_members: 2,
    active_workspaces: null, founding_workspaces: 2, founding_discount_pct: 30,
    projected_mrr_cents: 16330, projected_mrr_list_cents: 17800,
    by_plan: [{ plan: 'pro', workspaces: 1, members: 2, monthly_cents: 12900 }],
  },
}, '2026-01-01', '2026-03-31');

const ledger = [
  txn({ id: 'a', occurred_on: '2026-01-31', recurrence: 'monthly' }),
  txn({ id: 'b', occurred_on: '2026-02-14', kind: 'income', category: 'services revenue', amount_cents: 50000, org_id: 'org-1', description: null }),
];

/**
 * Set a controlled field the way React's value tracker requires: through the
 * prototype's original setter (assigning `el.value` goes through React's own
 * instance setter, which updates the tracker and swallows the change).
 */
function setValue(el: HTMLElement, value: string) {
  let proto: object | null = Object.getPrototypeOf(el);
  let desc: PropertyDescriptor | undefined;
  while (proto && !desc) {
    desc = Object.getOwnPropertyDescriptor(proto, 'value');
    proto = Object.getPrototypeOf(proto);
  }
  act(() => {
    if (desc?.set) desc.set.call(el, value);
    else (el as HTMLInputElement).value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

/** mount + let the load promises settle. */
async function render() {
  const view = mount(<FinanceView />);
  await act(async () => { await Promise.resolve(); });
  return view;
}

// The default range is "year to date", so the view's own numbers depend on the
// clock. Pin it to the last day of the fixture's range and the client-side P&L
// covers exactly the months the mocked summary does.
beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-03-31T12:00:00Z'));
});
afterAll(() => { vi.useRealTimers(); });

beforeEach(() => {
  vi.mocked(fetchFinanceSummary).mockResolvedValue({ status: 'ok', summary });
  vi.mocked(fetchTransactions).mockResolvedValue({ status: 'ok', transactions: ledger });
  vi.mocked(fetchPlanPrices).mockResolvedValue({
    status: 'ok',
    prices: [{ plan: 'pro', monthly_cents: 12900, note: null, updated_at: '2026-01-01T00:00:00Z' }],
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('FinanceView', () => {
  it('shows the setup hint, and nothing else, when the migration has not run', async () => {
    vi.mocked(fetchFinanceSummary).mockResolvedValue({ status: 'unavailable' });
    const { container } = await render();
    expect(container.textContent).toContain('finance.sql');
    expect(container.querySelector('.fin-tabs')).toBeNull();
  });

  it('says founders only on 42501', async () => {
    vi.mocked(fetchFinanceSummary).mockResolvedValue({ status: 'forbidden' });
    const { container } = await render();
    expect(one(container, '.ft-error').textContent).toContain('Founding Workspace admins only');
  });

  it('draws the KPI row, a two-series chart with a legend, and the same values in a table', async () => {
    const { container } = await render();
    expect(all(container, '.an-tile-value').map(t => t.textContent))
      .toEqual(['$500.00', '$30.00', '$470.00', '94%']);
    // Two bars per month, and a legend because there are two series.
    expect(all(container, '.fin-slot')).toHaveLength(3);
    expect(all(container, '.fin-bar')).toHaveLength(6);
    expect(all(container, '.fin-legend span').map(s => s.textContent?.trim())).toEqual(['Income', 'Expenses']);
    // Every charted value is also in the table under it.
    const body = one(container, '.fin-table tbody').textContent ?? '';
    expect(body).toContain('$500.00');
    expect(body).toContain('$10.00');
    expect(one(container, '.fin-table tfoot').textContent).toContain('$470.00');
  });

  it('lists the ledger newest-first with a filter that narrows it', async () => {
    const { container } = await render();
    click(buttonByText(container, 'Transactions'));
    const rows = () => all(container, '.fin-ledger tbody tr');
    expect(rows()).toHaveLength(2);
    expect(rows()[0].textContent).toContain('2026-01-31');
    // The ledger shows TEMPLATES (what you edit), not expanded occurrences.
    expect(container.textContent).toContain('monthly');
    click(buttonByText(container, 'income'));
    expect(rows()).toHaveLength(1);
    expect(rows()[0].textContent).toContain('services revenue');
  });

  it('previews how many times a recurring entry will be counted', async () => {
    const { container } = await render();
    click(buttonByText(container, 'Transactions'));
    click(one(container, '.ft-toolbar .org-invite-btn'));
    setValue(one(container, '.fin-form input[type="date"]'), '2026-01-01');
    // selects in source order: Kind, Workspace, Repeats
    setValue(all(one(container, '.fin-form'), 'select')[2], 'monthly');
    // Jan 2026 → end of 2027 inclusive = 24 monthly occurrences.
    expect(one(container, '.fin-form .ft-help').textContent).toContain('counted 24 times');
  });

  it('shows workspaces and flags that active counts need the analytics migration', async () => {
    const { container } = await render();
    click(buttonByText(container, 'Customers'));
    expect(container.textContent).toContain('Rack City');
    expect(container.textContent).toContain('needs analytics_events.sql');
    // Projected MRR is the discounted number; list price is shown beside it.
    expect(container.textContent).toContain('$163.30');
    expect(container.textContent).toContain('$178.00');
  });

  it('downloads a CSV and releases the object URL', async () => {
    // Spy on the two URL methods rather than replacing the global: happy-dom
    // still runs its anchor-navigation path, and it needs a real URL class.
    const blob = 'blob:http://localhost/fin';
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue(blob);
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const { container } = await render();
    click(buttonByText(container, 'Reports'));
    click(all(container, '.fin-form-actions button')[0]);
    expect(create).toHaveBeenCalledTimes(1);
    expect(revoke).toHaveBeenCalledWith(blob);
    create.mockRestore();
    revoke.mockRestore();
    open.mockRestore();
  });

  it('renders a printable statement built from the same expansion as the CSV', async () => {
    const { container } = await render();
    click(buttonByText(container, 'Reports'));
    const statement = one(container, '.fin-print');
    expect(statement.textContent).toContain('Profit and loss');
    // The monthly bill was expanded: Jan 31, Feb 28, Mar 31 = $30 of expenses,
    // against the single $500 income — the same numbers the server returned.
    expect(one(statement, 'tfoot').textContent).toContain('$470.00');
  });
});
