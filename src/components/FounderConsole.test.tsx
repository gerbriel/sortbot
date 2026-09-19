import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { act } from 'react';
import FounderConsole from './FounderConsole';
import { mount, cleanup, click, one, all, buttonByText } from './ui/testUtils';
import type { BetaOrgDirectoryRow, BetaSignupRow } from '../lib/betaService';
import type { FoundingUserRow, OrgDetail } from '../lib/foundingAdminService';

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
  };
});

vi.mock('../lib/crmService', () => ({ syncCrmContacts: vi.fn().mockResolvedValue(undefined) }));

import {
  fetchBetaSignups, fetchBetaOrgDirectory, setBetaStatus,
} from '../lib/betaService';
import {
  fetchAllUsers, fetchFoundingAudit, createWorkspace, setOrgPlan, fetchOrgDetail,
} from '../lib/foundingAdminService';

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

beforeEach(() => {
  vi.mocked(fetchBetaSignups).mockResolvedValue([signup()]);
  vi.mocked(fetchBetaOrgDirectory).mockResolvedValue([dirRow()]);
  vi.mocked(fetchAllUsers).mockResolvedValue([userRow()]);
  vi.mocked(fetchFoundingAudit).mockResolvedValue([]);
  vi.mocked(fetchOrgDetail).mockResolvedValue({ status: 'ok', detail });
  vi.mocked(setBetaStatus).mockResolvedValue(true);
  vi.mocked(setOrgPlan).mockResolvedValue({ ok: true });
  vi.mocked(createWorkspace).mockResolvedValue({ ok: true, id: 'new-org' });
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

  it('shows the setup line only when founder_console.sql is missing', async () => {
    const clean = await render();
    expect(clean.container.textContent).not.toContain('founder_console.sql');
    cleanup();

    vi.mocked(fetchOrgDetail).mockResolvedValue({ status: 'unavailable' });
    const { container } = await render();
    expect(one(container, '.fc-setup').textContent).toContain('founder_console.sql');
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
    setValue(one(container, '.fc-form select'), 'pro');
    setValue(inputs[1], 'new@shop.test');
    click(buttonByText(container, 'Create workspace'));
    await act(async () => { await Promise.resolve(); });
    expect(createWorkspace).toHaveBeenCalledWith({
      name: 'Thrift Haus', plan: 'pro', ownerEmail: 'new@shop.test',
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
