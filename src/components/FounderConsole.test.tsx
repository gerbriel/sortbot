import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { act } from 'react';
import FounderConsole from './FounderConsole';
import { mount, cleanup, click, one, all, buttonByText } from './ui/testUtils';
import type { BetaOrgDirectoryRow, BetaSignupRow } from '../lib/betaService';
import type {
  FoundingUserRow, OrgDetail, PlanRow, PlanAlumniRow,
} from '../lib/foundingAdminService';

/**
 * The console is where three moved sections and five brand-new RPCs are
 * assembled into one page, so the render path needs a test of its own. Only the
 * network functions are mocked; the tab machinery, the filtering and every
 * primitive run for real.
 *
 * The assertions are deliberately about the SEAMS rather than the copy: which
 * RPC a control calls and with what, and that "Create workspace now" on a
 * request really does hand its shop name and email to the onboarding form —
 * that hand-off is the whole reason the two tabs sit on one page.
 */

vi.mock('../lib/betaService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/betaService')>();
  return {
    ...actual,
    fetchBetaSignups: vi.fn(),
    fetchBetaOrgDirectory: vi.fn(),
    setBetaStatus: vi.fn(),
    deleteBetaSignup: vi.fn(),
  };
});

vi.mock('../lib/foundingAdminService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/foundingAdminService')>();
  return {
    ...actual,
    fetchAllUsers: vi.fn(),
    fetchFoundingAudit: vi.fn(),
    setMembership: vi.fn(),
    removeMembership: vi.fn(),
    moveUser: vi.fn(),
    createWorkspace: vi.fn(),
    setOrgPlan: vi.fn(),
    renameOrg: vi.fn(),
    inviteMember: vi.fn(),
    fetchOrgDetail: vi.fn(),
    fetchPlanDirectory: vi.fn(),
    upsertPlan: vi.fn(),
    renamePlan: vi.fn(),
    deletePlan: vi.fn(),
    fetchOrgPlanHistory: vi.fn(),
    fetchPlanAlumni: vi.fn(),
  };
});

vi.mock('../lib/crmService', () => ({ syncCrmContacts: vi.fn().mockResolvedValue(undefined) }));

// The Brand card on Overview probes 070 on mount; its own behaviour is tested
// in FounderBrandCard.test.tsx.
vi.mock('../lib/brandService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/brandService')>();
  return { ...actual, probeBrand: vi.fn().mockResolvedValue('ok'), saveBrand: vi.fn() };
});

vi.mock('../lib/usageService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/usageService')>();
  return { ...actual, fetchProjectUsage: vi.fn(), fetchPlanLimits: vi.fn(), setPlanLimits: vi.fn() };
});

vi.mock('../lib/insightsService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/insightsService')>();
  return { ...actual, fetchFoundingInsightsSummary: vi.fn() };
});

import { fetchFoundingInsightsSummary } from '../lib/insightsService';
import {
  fetchBetaSignups, fetchBetaOrgDirectory, setBetaStatus,
} from '../lib/betaService';
import {
  fetchAllUsers, fetchFoundingAudit, createWorkspace, setOrgPlan, fetchOrgDetail,
  fetchPlanDirectory, upsertPlan, renamePlan, deletePlan, fetchOrgPlanHistory,
  fetchPlanAlumni, ORG_PLANS,
} from '../lib/foundingAdminService';
import {
  fetchProjectUsage, fetchPlanLimits, setPlanLimits, type ProjectUsage,
} from '../lib/usageService';

const signup = (over: Partial<BetaSignupRow> = {}): BetaSignupRow => ({
  id: 's1',
  org_name: 'Rack City',
  contact_name: 'Ana',
  email: 'ana@rackcity.test',
  store_url: null,
  volume: null,
  notes: null,
  status: 'pending',
  created_at: '2026-09-01T00:00:00Z',
  reviewed_at: null,
  ...over,
});

const dirRow = (over: Partial<BetaOrgDirectoryRow> = {}): BetaOrgDirectoryRow => ({
  org_id: 'org-1',
  name: 'Shop A',
  slug: null,
  plan: 'beta',
  created_at: '2026-01-01T00:00:00Z',
  member_count: 2,
  member_emails: ['owner@shopa.test'],
  batch_count: 2,
  product_count: 1,
  image_count: 5,
  last_active: new Date().toISOString(),
  ...over,
});

const detail: OrgDetail = {
  org: { id: 'org-1', name: 'Shop A', slug: null, plan: 'beta', created_at: '2026-01-01T00:00:00Z' },
  members: [{ user_id: 'u1', email: 'owner@shopa.test', role: 'owner', created_at: '2026-01-01T00:00:00Z' }],
  invites: [{ id: 'i1', email: 'pending@shopa.test', role: 'member', created_at: '2026-02-01T00:00:00Z' }],
  counts: { batches: 2, products: 1, images: 5 },
  last_active: '2026-09-12T00:00:00Z',
  marketplaces: ['ebay'],
};

const planRow = (over: Partial<PlanRow> = {}): PlanRow => ({
  plan: 'studio',
  display_name: 'Studio',
  monthly_cents: 29900,
  note: null,
  is_active: true,
  sort_order: 60,
  workspaces: 0,
  ever_used: 0,
  protected: false,
  ...over,
});

/**
 * The mocked catalog. `studio` and `legacy` exist ONLY here, and `pro` — which
 * is in ORG_PLANS — deliberately does not: that pair is what proves the plan
 * dropdowns read the catalog and not the hardcoded constant, which is the bug
 * this pass exists to fix (a tier priced in Finance could never be assigned).
 */
const PLAN_DIR: PlanRow[] = [
  planRow({ plan: 'free', display_name: 'Free', monthly_cents: 0, sort_order: 10, workspaces: 1, ever_used: 3, protected: true }),
  planRow({ plan: 'beta', display_name: 'Beta', monthly_cents: 0, sort_order: 20, workspaces: 1, ever_used: 4, protected: true }),
  planRow({ plan: 'growth', display_name: 'Growth', monthly_cents: 15000, sort_order: 50, workspaces: 2, ever_used: 2 }),
  planRow({ plan: 'studio' }),
  planRow({ plan: 'legacy', display_name: 'Legacy', monthly_cents: 4900, sort_order: 90, ever_used: 5, is_active: false }),
];

const alumniRow = (over: Partial<PlanAlumniRow> = {}): PlanAlumniRow => ({
  org_id: 'org-1',
  org_name: 'Shop A',
  current_plan: 'beta',
  first_on: '2026-01-01T00:00:00Z',
  last_on: '2026-09-01T00:00:00Z',
  still_on: true,
  created_at: '2026-01-01T00:00:00Z',
  exists_now: true,
  ...over,
});

const userRow = (over: Partial<FoundingUserRow> = {}): FoundingUserRow => ({
  user_id: 'u1',
  email: 'owner@shopa.test',
  created_at: '2026-01-01T00:00:00Z',
  last_sign_in_at: null,
  memberships: [{ org_id: 'org-1', org_name: 'Shop A', org_slug: null, role: 'owner', joined_at: '2026-01-01T00:00:00Z' }],
  ...over,
});

/** Set a controlled field through the prototype's original setter, so React's
 *  value tracker sees the change instead of swallowing it. */
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

/** mount + let the load promises (including the availability probe) settle. */
async function render() {
  const view = mount(<FounderConsole myUserId="me" myOrgId="org-founding" />);
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
  return view;
}

const tab = (container: HTMLElement, label: string) =>
  all(container, '[role="tab"]').find(t => (t.textContent ?? '').startsWith(label));

/** The catalog row for one plan key, or a loud failure. */
const planRowEl = (container: HTMLElement, key: string): HTMLElement => {
  const row = all(container, '.fc-plan-row')
    .find(r => one(r, '.fc-plan-key code').textContent === key);
  if (!row) throw new Error(`planRowEl(): no row for the "${key}" plan`);
  return row;
};

const labelsOf = (root: HTMLElement) =>
  all(root, 'button').map(b => (b.textContent ?? '').trim());

/** Let one round of awaited state updates land. */
const flush = async () => { await act(async () => { await Promise.resolve(); }); };

beforeEach(() => {
  vi.mocked(fetchBetaSignups).mockResolvedValue([signup()]);
  vi.mocked(fetchBetaOrgDirectory).mockResolvedValue([dirRow()]);
  vi.mocked(fetchAllUsers).mockResolvedValue([userRow()]);
  vi.mocked(fetchFoundingAudit).mockResolvedValue([]);
  vi.mocked(fetchOrgDetail).mockResolvedValue({ status: 'ok', detail });
  vi.mocked(setBetaStatus).mockResolvedValue(true);
  vi.mocked(setOrgPlan).mockResolvedValue({ ok: true });
  vi.mocked(createWorkspace).mockResolvedValue({ ok: true, id: 'new-org' });
  vi.mocked(fetchPlanDirectory).mockResolvedValue({ status: 'ok', plans: PLAN_DIR });
  vi.mocked(fetchOrgPlanHistory).mockResolvedValue([]);
  vi.mocked(fetchPlanAlumni).mockResolvedValue({ status: 'ok', rows: [] });
  vi.mocked(upsertPlan).mockResolvedValue({ ok: true });
  vi.mocked(renamePlan).mockResolvedValue({ ok: true, moved: 0 });
  vi.mocked(deletePlan).mockResolvedValue({ ok: true });
  vi.mocked(fetchProjectUsage).mockResolvedValue({ status: 'unavailable' });
  vi.mocked(fetchPlanLimits).mockResolvedValue({ status: 'unavailable' });
  vi.mocked(setPlanLimits).mockResolvedValue({ status: 'unavailable' });
  vi.mocked(fetchFoundingInsightsSummary).mockResolvedValue({ status: 'unavailable' });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('FounderConsole', () => {
  it('opens on Overview with the counts the mocked rows imply', async () => {
    const { container } = await render();
    const values = all(container, '.ui-stat__value').map(v => v.textContent);
    // pending requests · workspaces · accounts · active in 7 days
    expect(values).toEqual(['1', '1', '1', '1']);
  });

  it('shows the setup line only when 060_founder_console.sql is missing', async () => {
    const clean = await render();
    expect(clean.container.textContent).not.toContain('060_founder_console.sql');
    cleanup();

    vi.mocked(fetchOrgDetail).mockResolvedValue({ status: 'unavailable' });
    const { container } = await render();
    expect(one(container, '.fc-setup').textContent).toContain('060_founder_console.sql');
    // and the moved sections still work — this is not an error wall
    expect(tab(container, 'Requests')).toBeTruthy();
  });

  it('Approve on a pending request calls setBetaStatus', async () => {
    const { container } = await render();
    click(tab(container, 'Requests'));
    click(buttonByText(container, 'Approve'));
    await act(async () => { await Promise.resolve(); });
    expect(setBetaStatus).toHaveBeenCalledWith('s1', 'approved');
  });

  it('"Create workspace now" prefills the Onboard form from the request', async () => {
    const { container } = await render();
    click(tab(container, 'Requests'));
    click(buttonByText(container, 'Create workspace now'));

    // It also switched tabs — the hand-off is the point, not the prefill alone.
    expect(tab(container, 'Onboard')?.getAttribute('aria-selected')).toBe('true');
    const inputs = all(container, '.fc-form input');
    expect((inputs[0] as HTMLInputElement).value).toBe('Rack City');
    expect((inputs[1] as HTMLInputElement).value).toBe('ana@rackcity.test');
    expect((one(container, '.fc-form select') as HTMLSelectElement).value).toBe('beta');
  });

  it('Onboard submits { name, plan, ownerEmail } to createWorkspace', async () => {
    const { container } = await render();
    click(tab(container, 'Onboard'));
    const inputs = all(container, '.fc-form input');
    setValue(inputs[0], 'Thrift Haus');
    // `studio` is a catalog-only tier — it is NOT in ORG_PLANS. Picking it here
    // is the proof that the Onboard select is built from the catalog too; while
    // the list was hardcoded this option would not have existed.
    setValue(one(container, '.fc-form select'), 'studio');
    setValue(inputs[1], 'new@shop.test');
    click(buttonByText(container, 'Create workspace'));
    await act(async () => { await Promise.resolve(); });
    expect(createWorkspace).toHaveBeenCalledWith({
      name: 'Thrift Haus', plan: 'studio', ownerEmail: 'new@shop.test',
    });
  });

  it('expanding a workspace shows its members and open invites', async () => {
    const { container } = await render();
    click(tab(container, 'Workspaces'));
    click(one(container, '.fc-org-head'));
    await act(async () => { await Promise.resolve(); });
    expect(fetchOrgDetail).toHaveBeenCalledWith('org-1');
    const body = one(container, '.fc-org-body');
    expect(body.textContent).toContain('owner@shopa.test');
    expect(body.textContent).toContain('pending@shopa.test');
    expect(body.textContent).toContain('Selling on: ebay');
  });

  it('a plan change is two steps — pick, then Apply — and then calls setOrgPlan', async () => {
    const { container } = await render();
    click(tab(container, 'Workspaces'));
    click(one(container, '.fc-org-head'));
    await act(async () => { await Promise.resolve(); });

    // Picking alone must not write: that is what makes a mis-click harmless.
    setValue(one(container, '.fc-inline-field select'), 'growth');
    expect(setOrgPlan).not.toHaveBeenCalled();

    click(buttonByText(container, 'Apply'));
    await act(async () => { await Promise.resolve(); });
    expect(setOrgPlan).toHaveBeenCalledWith('org-1', 'growth');
  });

  it('the Users tab lists every account, with the workspaces they belong to', async () => {
    const { container } = await render();
    click(tab(container, 'Users'));
    expect(container.textContent).toContain('All users (1)');
    expect(one(container, '.fa-ms-org').textContent).toContain('Shop A');
  });
});

/* ── Plans: the catalog ──────────────────────────────────────────────────────
   The assertions that matter here are the COUPLING ones. A plan dropdown built
   from the hardcoded ORG_PLANS array and one built from the catalog look
   identical on screen right up until somebody adds a tier — which is exactly
   how a plan priced in Finance → Customers ended up impossible to assign to
   anybody, with nothing failing anywhere. */

describe('FounderConsole — plan dropdowns read the catalog', () => {
  const expandFirstOrg = async (container: HTMLElement) => {
    click(tab(container, 'Workspaces'));
    click(one(container, '.fc-org-head'));
    await flush();
    return one(container, '.fc-inline-field select') as HTMLSelectElement;
  };

  it('offers the catalog, not ORG_PLANS, and leaves a retired tier out', async () => {
    const { container } = await render();
    const select = await expandFirstOrg(container);
    const values = Array.from(select.options).map(o => o.value);
    expect(values).toContain('studio');   // catalog only
    expect(values).not.toContain('pro');  // ORG_PLANS only
    expect(values).not.toContain('legacy'); // priced, but is_active false
    // The label is the display name, falling back to the key.
    expect(Array.from(select.options).map(o => o.textContent)).toContain('Growth');
  });

  it('keeps a workspace already on a RETIRED tier selected at its own value', async () => {
    vi.mocked(fetchBetaOrgDirectory).mockResolvedValue([dirRow({ plan: 'legacy' })]);
    const { container } = await render();
    const select = await expandFirstOrg(container);
    // A <select> whose value is absent from its options renders as the FIRST
    // option — this shop would have read as "on free" and been written to free
    // by the next Apply.
    expect(select.value).toBe('legacy');
    expect(select.options[0].textContent).toContain('not offered');
  });

  it('falls back to the nine seeded plans when the catalog cannot be read', async () => {
    vi.mocked(fetchPlanDirectory).mockResolvedValue({ status: 'unavailable', error: 'x' });
    const { container } = await render();
    const select = await expandFirstOrg(container);
    expect(Array.from(select.options).map(o => o.value)).toEqual([...ORG_PLANS]);
  });
});

describe('FounderConsole — Plans tab', () => {
  it('names 062_plan_management.sql when the catalog is missing, and nothing else breaks', async () => {
    vi.mocked(fetchPlanDirectory).mockResolvedValue({ status: 'unavailable', error: 'x' });
    const { container } = await render();
    click(tab(container, 'Plans'));
    const hints = all(container, '.fc-setup').map(h => h.textContent ?? '').join(' ');
    expect(hints).toContain('062_plan_management.sql');
    // 060_founder_console.sql is installed in this scenario; naming it would send
    // the founder to a file they have already run.
    expect(hints).not.toContain('060_founder_console.sql');
    expect(tab(container, 'Requests')).toBeTruthy();
  });

  it('adds a plan through upsertPlan, with the key normalised and dollars as cents', async () => {
    const { container } = await render();
    click(tab(container, 'Plans'));
    const inputs = all(container, '.fc-plan-add input');
    setValue(inputs[0], '  Atelier ');
    setValue(inputs[1], 'Atelier');
    setValue(inputs[2], '499');
    click(buttonByText(container, 'Add plan'));
    await flush();
    expect(upsertPlan).toHaveBeenCalledWith({
      plan: 'atelier', displayName: 'Atelier', monthlyCents: 49900,
      // `note` is a REPLACE field, so it is stated rather than left implicit —
      // null is right here because Add is gated on the key not existing.
      note: null, isActive: true,
    });
  });

  it('refuses a key that is not a slug, and shows what one looks like', async () => {
    const { container } = await render();
    click(tab(container, 'Plans'));
    setValue(all(container, '.fc-plan-add input')[0], 'Pro Plan!');
    const add = buttonByText(container, 'Add plan') as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    expect(container.textContent).toContain('Start with a letter');
    click(add);
    expect(upsertPlan).not.toHaveBeenCalled();
  });

  it('editing a row is two steps — type, then Save — and sends the whole row', async () => {
    const { container } = await render();
    click(tab(container, 'Plans'));
    const row = planRowEl(container, 'studio');
    setValue(one(row, '.fc-plan-input--num'), '349');

    // Typing alone writes nothing: same rule as the workspace plan change, so a
    // mis-keyed price is discarded by navigating away rather than saved.
    expect(upsertPlan).not.toHaveBeenCalled();
    expect(row.textContent).toContain('was $299.00');

    click(buttonByText(row, 'Save'));
    await flush();
    expect(upsertPlan).toHaveBeenCalledWith({
      plan: 'studio', displayName: 'Studio', monthlyCents: 34900,
      // `note` has no cell in this table and the function REPLACES it, so it is
      // sent back unchanged rather than blanking a note written elsewhere.
      note: null, isActive: true, sortOrder: 60,
    });
  });

  it('the Offered toggle posts the WHOLE row, never a one-field patch', async () => {
    // founding_upsert_plan REPLACES display_name and note — a standalone toggle
    // that posted only { plan, isActive } would wipe that tier's label and the
    // note Finance wrote against it, with nothing failing anywhere. That is why
    // the checkbox lives in the row draft behind the same one Save.
    vi.mocked(fetchPlanDirectory).mockResolvedValue({
      status: 'ok',
      plans: [planRow({ plan: 'growth', display_name: 'Growth', note: 'launch tier', monthly_cents: 15000, sort_order: 50 })],
    });
    const { container } = await render();
    click(tab(container, 'Plans'));
    const row = planRowEl(container, 'growth');

    click(one(row, '.fc-plan-check input'));
    expect(upsertPlan).not.toHaveBeenCalled();   // ticking alone writes nothing

    click(buttonByText(row, 'Save'));
    await flush();
    expect(upsertPlan).toHaveBeenCalledWith({
      plan: 'growth', displayName: 'Growth', monthlyCents: 15000,
      note: 'launch tier', isActive: false, sortOrder: 50,
    });
  });

  it('Add a plan states note: null rather than omitting it', async () => {
    // Omitting it would mean the same thing today, but `note` is a REPLACE
    // field: leaving it implicit is how a future partial writer starts.
    const { container } = await render();
    click(tab(container, 'Plans'));
    const inputs = all(container, '.fc-plan-add input');
    setValue(inputs[0], 'atelier');
    click(buttonByText(container, 'Add plan'));
    await flush();
    expect(vi.mocked(upsertPlan).mock.calls[0][0]).toHaveProperty('note', null);
  });

  it('a price that is not a number blocks Save and says so', async () => {
    const { container } = await render();
    click(tab(container, 'Plans'));
    const row = planRowEl(container, 'studio');
    setValue(one(row, '.fc-plan-input--num'), 'free!');
    // Save APPEARS (the row is edited) but cannot fire — an invalid cell that
    // looked untouched would be the more confusing failure.
    expect((buttonByText(row, 'Save') as HTMLButtonElement).disabled).toBe(true);
    expect(row.textContent).toContain('Price needs to be a number');
    click(buttonByText(row, 'Save'));
    expect(upsertPlan).not.toHaveBeenCalled();
  });

  it('a built-in plan offers no rename and no delete, and says why', async () => {
    const { container } = await render();
    click(tab(container, 'Plans'));
    for (const key of ['free', 'beta']) {
      const row = planRowEl(container, key);
      expect(labelsOf(row), key).not.toContain('Delete');
      expect(labelsOf(row), key).not.toContain('Rename');
      // Not a greyed control with no explanation — the row states what depends
      // on the name (Do Not #12's sibling: say why, do not just disable).
      expect(one(row, '.fc-plan-why').textContent, key).toContain('organizations.plan');
    }
  });

  it('a plan with workspaces on it offers no delete, and points at the retire path', async () => {
    const { container } = await render();
    click(tab(container, 'Plans'));
    const row = planRowEl(container, 'growth');
    expect(labelsOf(row)).not.toContain('Delete');
    expect(row.textContent).toContain('2 workspaces on it');
    expect(row.textContent).toContain('untick Offered');
  });

  it('deleting an unused plan is two steps and calls deletePlan', async () => {
    const { container } = await render();
    click(tab(container, 'Plans'));
    const row = planRowEl(container, 'studio');
    click(buttonByText(row, 'Delete'));
    expect(deletePlan).not.toHaveBeenCalled();
    click(buttonByText(row, 'Confirm'));
    await flush();
    expect(deletePlan).toHaveBeenCalledWith('studio');
  });

  it('a plan with history offers no Delete, and says to retire it instead', async () => {
    // `legacy` has nobody on it now (workspaces 0) but five workspaces have
    // been. Deleting it would strand those alumni: the Alumni tab's picker is
    // built from the catalog, so the history rows would survive with nothing
    // able to ask for them. The server refuses this too — this is the half
    // that explains it without a round trip.
    const { container } = await render();
    click(tab(container, 'Plans'));
    const row = planRowEl(container, 'legacy');
    const labels = all(row, 'button').map(b => (b.textContent ?? '').trim());
    expect(labels).not.toContain('Delete');
    expect(row.textContent).toContain('5 workspaces have been on it');
    expect(row.textContent).toContain('alumni findable');
    click(buttonByText(row, 'Rename'));           // still renameable
    expect(deletePlan).not.toHaveBeenCalled();
  });

  it('renaming a plan sends both keys, lower-cased', async () => {
    const { container } = await render();
    click(tab(container, 'Plans'));
    const row = planRowEl(container, 'studio');
    click(buttonByText(row, 'Rename'));
    setValue(one(row, '.org-rename-form input'), 'Atelier');
    click(one(row, '.org-rename-form button[title="Save key"]'));
    await flush();
    expect(renamePlan).toHaveBeenCalledWith('studio', 'atelier');
  });

  it('refuses to rename a plan INTO free or beta, and says so', async () => {
    const { container } = await render();
    click(tab(container, 'Plans'));
    const row = planRowEl(container, 'studio');
    click(buttonByText(row, 'Rename'));
    for (const taken of ['free', 'beta']) {
      setValue(one(row, '.org-rename-form input'), taken);
      // A plan renamed into one of these would quietly inherit the column
      // default, the waitlist path and the founding-discount rule. The server
      // refuses too; this is the half that explains it before the round trip.
      const save = one(row, '.org-rename-form button') as HTMLButtonElement;
      expect(save.disabled, taken).toBe(true);
      expect(save.title, taken).toContain('cannot be taken over');
      click(save);
    }
    await flush();
    expect(renamePlan).not.toHaveBeenCalled();
  });
});

describe('FounderConsole — plan history and alumni', () => {
  it('an expanded workspace shows its plan history, SQL-editor changes included', async () => {
    vi.mocked(fetchOrgPlanHistory).mockResolvedValue([
      { plan: 'pro', previous_plan: 'beta', changed_at: '2027-03-12T00:00:00Z', changed_by_email: 'me@shop.test', source: 'trigger' },
      { plan: 'growth', previous_plan: 'beta', changed_at: '2027-01-02T00:00:00Z', changed_by_email: null, source: 'trigger' },
      { plan: 'beta', previous_plan: null, changed_at: '2026-01-01T00:00:00Z', changed_by_email: null, source: 'backfill' },
    ]);
    const { container } = await render();
    click(tab(container, 'Workspaces'));
    click(one(container, '.fc-org-head'));
    await flush();
    await flush();

    expect(fetchOrgPlanHistory).toHaveBeenCalledWith('org-1');
    const body = one(container, '.fc-org-body');
    expect(body.textContent).toContain('moved to pro from beta');
    expect(body.textContent).toContain('me@shop.test');
    // A null email is not missing data: it is a change made straight in the SQL
    // Editor, which the trigger catches and founding_admin_audit never could.
    expect(body.textContent).toContain('from the SQL editor');
    expect(body.textContent).toContain('on the beta plan when the record starts');
  });

  it('a tier rename reads as a rename, not as every shop changing plan', async () => {
    // Renaming a tier cascades to organizations.plan for every workspace on it,
    // so the history trigger fires once per workspace and those rows are
    // RECORDED rather than suppressed. Rendered as "moved to X from Y" they
    // would read as the whole beta cohort switching plan on one afternoon.
    vi.mocked(fetchOrgPlanHistory).mockResolvedValue([
      { plan: 'atelier', previous_plan: 'studio', changed_at: '2027-05-01T00:00:00Z', changed_by_email: 'me@shop.test', source: 'rename' },
    ]);
    const { container } = await render();
    click(tab(container, 'Workspaces'));
    click(one(container, '.fc-org-head'));
    await flush();
    await flush();

    const body = one(container, '.fc-org-body');
    expect(body.textContent).toContain('the plan was renamed studio → atelier');
    expect(body.textContent).not.toContain('moved to atelier');
  });

  it('renders an unknown history source rather than crashing on it', async () => {
    // `source` is free text in the database: a newer migration may add a value
    // this build has never heard of, and a plan history that throws is worse
    // than one that reads plainly.
    vi.mocked(fetchOrgPlanHistory).mockResolvedValue([
      { plan: 'pro', previous_plan: 'beta', changed_at: '2027-05-01T00:00:00Z', changed_by_email: null, source: 'merge' },
    ]);
    const { container } = await render();
    click(tab(container, 'Workspaces'));
    click(one(container, '.fc-org-head'));
    await flush();
    await flush();
    expect(one(container, '.fc-org-body').textContent).toContain('moved to pro from beta');
  });

  it('the Alumni tab reads beta by default and flags a workspace that no longer exists', async () => {
    vi.mocked(fetchPlanAlumni).mockResolvedValue({
      status: 'ok',
      rows: [
        alumniRow({
          org_id: 'deadbeef-0000-0000-0000-000000000000', org_name: 'Closed Shop',
          current_plan: null, still_on: false, created_at: null, exists_now: false,
          last_on: '2026-11-01T00:00:00Z',
        }),
        alumniRow(),
      ],
    });
    const { container } = await render();
    click(tab(container, 'Alumni'));
    await flush();

    expect(fetchPlanAlumni).toHaveBeenCalledWith('beta');
    expect(container.textContent).toContain('2 workspaces have been on Beta');
    expect(container.textContent).toContain('1 no longer exists');

    // THE HEADLINE CASE. organizations.plan cannot answer this at all, and a
    // foreign key would have deleted the answer along with the workspace.
    const gone = one(container, '.fc-alumni-row--gone');
    expect(gone.textContent).toContain('Closed Shop');
    expect(gone.textContent).toContain('workspace deleted');
    expect(all(container, '.fc-alumni-row--gone')).toHaveLength(1);
  });

  it('changing the alumni plan re-reads for that plan', async () => {
    const { container } = await render();
    click(tab(container, 'Alumni'));
    await flush();
    setValue(one(container, '.fc-alumni-toolbar select'), 'growth');
    await flush();
    expect(fetchPlanAlumni).toHaveBeenLastCalledWith('growth');
  });

  it('the alumni read is lazy — nothing asks for it until the tab is opened', async () => {
    const { container } = await render();
    expect(fetchPlanAlumni).not.toHaveBeenCalled();
    // …but the CATALOG is read on mount, because two other tabs' dropdowns
    // are built from it.
    expect(fetchPlanDirectory).toHaveBeenCalledTimes(1);
    click(tab(container, 'Alumni'));
    await flush();
    expect(fetchPlanAlumni).toHaveBeenCalledTimes(1);
  });
});

describe('FounderConsole: Usage tab (069)', () => {
  const GB = 1024 ** 3;
  const project = (over: Partial<ProjectUsage> = {}): ProjectUsage => ({
    project: {
      storage_gb_quota: 100, storage_bytes_total: 90 * GB, files_total: 12345, orgs: 2,
      members_total: 5, listings_this_month_total: 77, month_start: '2026-11-01', listing_basis: 'created',
    },
    orgs: [
      { org_id: 'org-1', name: 'Shop A', plan: 'pro', storage_bytes: 9.5 * GB, files: 10, listings_this_month: 120, members: 2,
        limits: { listings_per_month: 100, storage_gb: 10, seats: null } },
      { org_id: 'org-2', name: 'Shop B', plan: 'beta', storage_bytes: 1 * GB, files: 2, listings_this_month: 3, members: 1,
        limits: { listings_per_month: null, storage_gb: null, seats: 3 } },
    ],
    ...over,
  });

  it('loads only when the tab is opened, and names 069 when it is missing', async () => {
    const { container } = await render();
    expect(fetchProjectUsage).not.toHaveBeenCalled();
    click(tab(container, 'Usage'));
    expect(container.querySelector('.fc-skeleton')).toBeTruthy();
    await flush();
    expect(fetchProjectUsage).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('Run 069_plan_limits_and_usage.sql');
  });

  it('shows the project tiles and a workspace table with tinted bars', async () => {
    vi.mocked(fetchProjectUsage).mockResolvedValue({ status: 'ok', data: project() });
    const { container } = await render();
    click(tab(container, 'Usage'));
    await flush();
    const panel = one(container, '[role="tabpanel"]:not([hidden])');
    const values = all(panel, '.ui-stat__value').map(v => v.textContent);
    expect(values).toEqual(['90.0 GB', '12,345', '2', '5', '77']);
    expect(panel.textContent).toContain('90% of the 100 GB Supabase quota');
    expect(panel.textContent).toContain('Counts listings created this month');
    expect(one(panel, '.fc-usage--warn .ui-stat__value')).toBeTruthy();

    const rows = all(panel, '.fc-usage-row');
    expect(rows.map(r => one(r, '.fc-usage-name').textContent)).toEqual(['Shop A', 'Shop B']);
    expect(rows[0].textContent).toContain('9.5 GB of 10 GB');
    expect(one(rows[0], 'td[data-label="Storage"]').className).toContain('fc-usage--warn');
    expect(one(rows[0], 'td[data-label="Listings"]').className).toContain('fc-usage--over');
    expect(rows[0].textContent).toContain('2 · Unlimited');
    expect(one(rows[0], '.fc-usage-fill').style.width).toBe('95%');
    // Unlimited storage has no bar.
    expect(rows[1].querySelector('.fc-usage-track')).toBeNull();
    expect(rows[1].textContent).toContain('1 of 3');
  });

  it('says why on forbidden and offers a retry on error', async () => {
    vi.mocked(fetchProjectUsage).mockResolvedValue({ status: 'forbidden' });
    const a = await render();
    click(tab(a.container, 'Usage'));
    await flush();
    expect(a.container.textContent).toContain('Founding Workspace admins only');
    cleanup();
    vi.mocked(fetchProjectUsage).mockClear();

    vi.mocked(fetchProjectUsage).mockResolvedValue({ status: 'error', message: 'storage walk timed out' });
    const { container } = await render();
    click(tab(container, 'Usage'));
    await flush();
    expect(container.textContent).toContain('storage walk timed out');
    vi.mocked(fetchProjectUsage).mockResolvedValue({ status: 'ok', data: project({ orgs: [] }) });
    click(buttonByText(container, 'Try again'));
    await flush();
    expect(fetchProjectUsage).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain('No workspaces yet');
  });
});

describe('FounderConsole: Usage tab, shared insights (071)', () => {
  const insightsSection = (container: HTMLElement) => one(container, '.fc-insights');

  it('loads with the Usage tab and names 071 when it is missing', async () => {
    const { container } = await render();
    expect(fetchFoundingInsightsSummary).not.toHaveBeenCalled();
    click(tab(container, 'Usage'));
    expect(insightsSection(container).querySelector('.fc-skeleton')).toBeTruthy();
    await flush();
    expect(fetchFoundingInsightsSummary).toHaveBeenCalledTimes(1);
    expect(insightsSection(container).textContent).toContain('071_shared_insights.sql');
  });

  it('shows the five counts as tiles', async () => {
    vi.mocked(fetchFoundingInsightsSummary).mockResolvedValue({ status: 'ok', data: {
      sharingOrgs: 3, totalOrgs: 4, soldListings: 1200, askingListings: 340, datedListings: 87, brands: 41,
    } });
    const { container } = await render();
    click(tab(container, 'Usage'));
    await flush();
    const values = all(insightsSection(container), '.ui-stat__value').map(v => v.textContent);
    expect(values).toEqual(['3 of 4', '1,200', '340', '87', '41']);
    expect(insightsSection(container).textContent).toContain('at least 5 listings from 2 or more shops');
  });

  it('is founders only on forbidden', async () => {
    vi.mocked(fetchFoundingInsightsSummary).mockResolvedValue({ status: 'forbidden' });
    const { container } = await render();
    click(tab(container, 'Usage'));
    await flush();
    expect(insightsSection(container).textContent).toContain('Founding Workspace admins only');
  });
});

describe('FounderConsole: plan limits in the catalog row (069)', () => {
  const limitInputs = (row: HTMLElement) => all(row, '.fc-plan-input--limit') as HTMLInputElement[];
  const priceInput = (row: HTMLElement) => one(row, 'input[aria-label^="Monthly price"]');

  it('names 069 in the limit headers and disables the limit cells when the columns are missing', async () => {
    const { container } = await render();
    click(tab(container, 'Plans'));
    await flush();
    expect(fetchPlanLimits).toHaveBeenCalledTimes(1);
    // No separate Limits table any more.
    expect(container.querySelector('.fc-limit-row')).toBeNull();
    const row = planRowEl(container, 'studio');
    const cells = limitInputs(row);
    expect(cells).toHaveLength(3);
    expect(cells.every(i => i.disabled)).toBe(true);
    expect(cells[0].placeholder).toBe('Run 069');
    const storageTip = one(container, 'button[aria-label="What Storage means"]').getAttribute('aria-describedby');
    expect(one(container, `[id="${storageTip}"]`).textContent).toContain('069_plan_limits_and_usage.sql');
    // A catalog-only header carries no setup note.
    const orderTip = one(container, 'button[aria-label="What Order means"]').getAttribute('aria-describedby');
    expect(one(container, `[id="${orderTip}"]`).textContent).not.toContain('069');
  });

  it('every column header carries its hint', async () => {
    vi.mocked(fetchPlanLimits).mockResolvedValue({ status: 'ok', data: [] });
    const { container } = await render();
    click(tab(container, 'Plans'));
    await flush();
    const table = one(container, '.fc-plan-table');
    const heads = all(table, 'thead th .ui-header-hint__text').map(t => t.textContent);
    expect(heads).toEqual([
      'Key', 'Name shown', 'Price / mo', 'Assignable', 'Order',
      'Listings / mo', 'Storage (GB)', 'Seats', 'Workspaces', 'Ever used',
    ]);
    const tipFor = (name: string) => {
      const id = one(table, `button[aria-label="What ${name} means"]`).getAttribute('aria-describedby');
      return one(table, `[id="${id}"][role="tooltip"]`).textContent ?? '';
    };
    expect(tipFor('Assignable')).toContain('Offered: the plan can be put on a workspace');
    expect(tipFor('Assignable')).toContain('Retired: kept for history and billing');
    expect(tipFor('Order')).toBe('Position in every plan dropdown and list, lowest first. Ties are broken by key.');
    expect(tipFor('Storage')).toContain('product-images bucket');
    expect(tipFor('Ever used')).toContain('cannot be deleted, only retired');
    // No em dash in any hint.
    expect(all(table, '[role="tooltip"]').map(t => t.textContent).join(' ')).not.toContain('—');
    // The last columns hang their tooltip from the right edge.
    const everUsed = one(table, 'button[aria-label="What Ever used means"]').parentElement as HTMLElement;
    expect(one(everUsed, '[role="tooltip"]').className).toContain('ui-header-hint__tip--end');
  });

  it('a limit-only change calls setPlanLimits and not the price RPC', async () => {
    vi.mocked(fetchPlanLimits).mockResolvedValue({
      status: 'ok',
      data: [{ plan: 'growth', listings_per_month: 500, storage_gb: 25, seats: 3 }],
    });
    vi.mocked(setPlanLimits).mockResolvedValue({
      status: 'ok', data: { plan: 'growth', listings_per_month: null, storage_gb: 2.5, seats: 3 },
    });
    const { container } = await render();
    click(tab(container, 'Plans'));
    await flush();

    // A plan with no saved limits reads as blank (unlimited).
    expect(limitInputs(planRowEl(container, 'studio')).map(i => i.value)).toEqual(['', '', '']);
    expect(limitInputs(planRowEl(container, 'studio'))[0].placeholder).toBe('Unlimited');

    const row = planRowEl(container, 'growth');
    expect(limitInputs(row).map(i => i.value)).toEqual(['500', '25', '3']);
    setValue(limitInputs(row)[0], '');
    setValue(limitInputs(planRowEl(container, 'growth'))[1], '2.5');
    click(buttonByText(planRowEl(container, 'growth'), 'Save'));
    await flush();
    expect(setPlanLimits).toHaveBeenCalledWith({ plan: 'growth', listingsPerMonth: null, storageGb: 2.5, seats: 3 });
    expect(upsertPlan).not.toHaveBeenCalled();
    expect(limitInputs(planRowEl(container, 'growth')).map(i => i.value)).toEqual(['', '2.5', '3']);
    expect(container.textContent).toContain("Saved the growth plan's limits");
  });

  it('a price-only change calls the price RPC and not setPlanLimits', async () => {
    vi.mocked(fetchPlanLimits).mockResolvedValue({
      status: 'ok',
      data: [{ plan: 'studio', listings_per_month: 100, storage_gb: 10, seats: 2 }],
    });
    const { container } = await render();
    click(tab(container, 'Plans'));
    await flush();
    setValue(priceInput(planRowEl(container, 'studio')), '349');
    click(buttonByText(planRowEl(container, 'studio'), 'Save'));
    await flush();
    expect(upsertPlan).toHaveBeenCalledTimes(1);
    expect(setPlanLimits).not.toHaveBeenCalled();
  });

  it('one Save with both halves changed calls both, and a failed half is named', async () => {
    vi.mocked(fetchPlanLimits).mockResolvedValue({ status: 'ok', data: [] });
    vi.mocked(setPlanLimits).mockResolvedValue({ status: 'error', message: 'limits exploded' });
    const { container } = await render();
    click(tab(container, 'Plans'));
    await flush();
    setValue(priceInput(planRowEl(container, 'studio')), '349');
    setValue(limitInputs(planRowEl(container, 'studio'))[2], '4');
    click(buttonByText(planRowEl(container, 'studio'), 'Save'));
    await flush();
    await flush();
    expect(upsertPlan).toHaveBeenCalledTimes(1);
    expect(setPlanLimits).toHaveBeenCalledWith({ plan: 'studio', listingsPerMonth: null, storageGb: null, seats: 4 });
    const notice = one(container, '.org-panel-notice').textContent ?? '';
    expect(notice).toContain("Saved the studio plan's name, price, Assignable and order");
    expect(notice).toContain('its limits did not save: limits exploded');
    // The failed half keeps its typed value for another try.
    expect(limitInputs(planRowEl(container, 'studio'))[2].value).toBe('4');
  });

  it('refuses a fractional seat count before the round trip', async () => {
    vi.mocked(fetchPlanLimits).mockResolvedValue({ status: 'ok', data: [] });
    const { container } = await render();
    click(tab(container, 'Plans'));
    await flush();
    setValue(limitInputs(planRowEl(container, 'studio'))[2], '1.5');
    const row = planRowEl(container, 'studio');
    const save = buttonByText(row, 'Save') as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect(row.textContent).toContain('whole numbers for listings and seats');
    click(save);
    expect(setPlanLimits).not.toHaveBeenCalled();
    expect(upsertPlan).not.toHaveBeenCalled();
  });

  it('Add plan saves its limits after the plan row exists', async () => {
    vi.mocked(fetchPlanLimits).mockResolvedValue({ status: 'ok', data: [] });
    vi.mocked(setPlanLimits).mockResolvedValue({
      status: 'ok', data: { plan: 'atelier', listings_per_month: 200, storage_gb: 5, seats: null },
    });
    const order: string[] = [];
    vi.mocked(upsertPlan).mockImplementation(async () => { order.push('upsert'); return { ok: true }; });
    vi.mocked(setPlanLimits).mockImplementation(async () => {
      order.push('limits');
      return { status: 'ok', data: { plan: 'atelier', listings_per_month: 200, storage_gb: 5, seats: null } };
    });
    const { container } = await render();
    click(tab(container, 'Plans'));
    await flush();
    const inputs = all(container, '.fc-plan-add input');
    setValue(inputs[0], 'atelier');
    setValue(inputs[3], '200');
    setValue(inputs[4], '5');
    click(buttonByText(container, 'Add plan'));
    await flush();
    await flush();
    expect(order).toEqual(['upsert', 'limits']);
    expect(setPlanLimits).toHaveBeenCalledWith({ plan: 'atelier', listingsPerMonth: 200, storageGb: 5, seats: null });
  });

  it('Add plan with blank limits makes no limits write', async () => {
    vi.mocked(fetchPlanLimits).mockResolvedValue({ status: 'ok', data: [] });
    const { container } = await render();
    click(tab(container, 'Plans'));
    await flush();
    setValue(all(container, '.fc-plan-add input')[0], 'atelier');
    click(buttonByText(container, 'Add plan'));
    await flush();
    expect(upsertPlan).toHaveBeenCalledTimes(1);
    expect(setPlanLimits).not.toHaveBeenCalled();
  });

  it('the Usage table headers carry hints', async () => {
    vi.mocked(fetchProjectUsage).mockResolvedValue({ status: 'ok', data: {
      project: {
        storage_gb_quota: 100, storage_bytes_total: 0, files_total: 0, orgs: 1,
        members_total: 1, listings_this_month_total: 0, month_start: '2026-11-01', listing_basis: 'created',
      },
      orgs: [{ org_id: 'org-1', name: 'Shop A', plan: 'beta', storage_bytes: 0, files: 0, listings_this_month: 0, members: 1,
        limits: { listings_per_month: null, storage_gb: null, seats: null } }],
    } });
    const { container } = await render();
    click(tab(container, 'Usage'));
    await flush();
    const table = one(container, '.fc-usage-table');
    const tipFor = (name: string) => {
      const id = one(table, `button[aria-label="What ${name} means"]`).getAttribute('aria-describedby');
      return one(table, `[id="${id}"]`).textContent;
    };
    expect(tipFor('Storage')).toContain("Used of the plan's limit");
    expect(tipFor('Listings')).toContain("Created this month of the plan's cap");
    expect(tipFor('Members')).toContain("Of the plan's seats");
  });
});
