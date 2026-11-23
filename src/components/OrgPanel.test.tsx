import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { act } from 'react';
import OrgPanel, { PlanUsageGroup } from './OrgPanel';
import { mount, cleanup, all, one, click } from './ui/testUtils';

/**
 * The Workspace page's "Plan and usage" group (069). Only the network is
 * mocked; the meter arithmetic (`planUsageMeters`, `usageReadout`) runs for
 * real. Locked here: every member sees it, it hides on anything but 'ok', and
 * the tints follow the 85% / 100% rule.
 */

vi.mock('../lib/orgService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/orgService')>();
  return { ...actual, fetchOrgMembers: vi.fn(), fetchOrgInvites: vi.fn() };
});

vi.mock('../lib/descriptionSettings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/descriptionSettings')>();
  return { ...actual, getOrgDescriptionSettings: vi.fn() };
});

vi.mock('../lib/shopifyConnectionService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/shopifyConnectionService')>();
  return { ...actual, getShopifyConnection: vi.fn() };
});

vi.mock('../lib/marketplaceService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/marketplaceService')>();
  return { ...actual, fetchOrgMarketplaces: vi.fn(), fetchVocab: vi.fn() };
});

vi.mock('../lib/usageService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/usageService')>();
  return { ...actual, fetchOrgUsage: vi.fn() };
});

vi.mock('../lib/insightsService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/insightsService')>();
  return { ...actual, setShareInsights: vi.fn() };
});

import { fetchOrgMembers, fetchOrgInvites, type Organization } from '../lib/orgService';
import { setShareInsights } from '../lib/insightsService';
import { getOrgDescriptionSettings, DEFAULT_DESCRIPTION_SETTINGS } from '../lib/descriptionSettings';
import { getShopifyConnection } from '../lib/shopifyConnectionService';
import { fetchOrgMarketplaces, fetchVocab } from '../lib/marketplaceService';
import { fetchOrgUsage, type OrgUsage } from '../lib/usageService';

const GB = 1024 ** 3;

const usage = (over: Partial<OrgUsage> = {}): OrgUsage => ({
  org_id: 'org-1',
  plan: 'pro',
  limits: { listings_per_month: 100, storage_gb: 10, seats: 3 },
  usage: { storage_bytes: 1 * GB, files: 5, listings_this_month: 90, members: 3, month_start: '2026-11-01' },
  listing_basis: 'created',
  ...over,
});

const ORG = { id: 'org-1', name: 'Rack City', slug: 'rack-city', plan: 'pro' };

async function renderPanel(role: 'owner' | 'admin' | 'member' = 'member') {
  const view = mount(<OrgPanel org={ORG} myRole={role} myUserId="u1" onClose={() => {}} />);
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
  return view;
}

beforeEach(() => {
  vi.mocked(fetchOrgMembers).mockResolvedValue([]);
  vi.mocked(fetchOrgInvites).mockResolvedValue([]);
  vi.mocked(getOrgDescriptionSettings).mockResolvedValue(DEFAULT_DESCRIPTION_SETTINGS);
  vi.mocked(getShopifyConnection).mockResolvedValue({ status: 'none' });
  vi.mocked(fetchOrgMarketplaces).mockResolvedValue({ status: 'unavailable' });
  vi.mocked(fetchVocab).mockResolvedValue({ status: 'unavailable' });
  vi.mocked(fetchOrgUsage).mockResolvedValue({ status: 'unavailable' });
});

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('PlanUsageGroup', () => {
  it('shows plan, storage, listings (with the basis) and members as cells', () => {
    const { container } = mount(<PlanUsageGroup usage={usage()} />);
    expect(container.textContent).toContain('Plan and usage');
    const labels = all(container, '.ui-fieldcell__label').map(l => l.textContent);
    expect(labels).toEqual(['Plan', 'Storage', 'Listings this month', 'Members']);
    const values = all(container, '.org-usage-value').map(v => v.textContent);
    expect(values).toEqual(['Pro', '1.0 GB of 10 GB', '90 of 100', '3 of 3']);
    expect(container.textContent).toContain('Counts listings created this month');
  });

  it('tints near-limit and over-limit cells and hides the bar when unlimited', () => {
    const { container } = mount(<PlanUsageGroup usage={usage({
      limits: { listings_per_month: 100, storage_gb: null, seats: 3 },
    })} />);
    const cells = all(container, '.org-usage-cell');
    expect(cells[0].className).toContain('org-usage-cell--ok');
    expect(cells[0].textContent).toContain('Unlimited');
    expect(cells[0].querySelector('.org-usage-track')).toBeNull();
    expect(cells[1].className).toContain('org-usage-cell--warn');
    expect(cells[2].className).toContain('org-usage-cell--over');
    expect(one(cells[2], '.org-usage-fill').style.width).toBe('100%');
  });
});

describe('OrgPanel plan and usage', () => {
  it('is shown to a plain member on the Members tab', async () => {
    vi.mocked(fetchOrgUsage).mockResolvedValue({ status: 'ok', data: usage() });
    const { container } = await renderPanel('member');
    expect(fetchOrgUsage).toHaveBeenCalledWith('org-1');
    expect(container.textContent).toContain('Plan and usage');
  });

  it.each([
    [{ status: 'unavailable' } as const],
    [{ status: 'forbidden' } as const],
    [{ status: 'error', message: 'boom' } as const],
  ])('hides on %o', async (res) => {
    vi.mocked(fetchOrgUsage).mockResolvedValue(res);
    const { container } = await renderPanel('owner');
    expect(container.textContent).not.toContain('Plan and usage');
    expect(container.textContent).not.toContain('boom');
  });
});

describe('OrgPanel shared insights (071)', () => {
  async function renderSettings(org: Organization, role: 'owner' | 'admin' | 'member' = 'admin') {
    const view = mount(<OrgPanel org={org} myRole={role} myUserId="u1" onClose={() => {}} initialTab="settings" />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    return view;
  }

  it('renders for an admin when the org row carries share_insights', async () => {
    const { container } = await renderSettings({ ...ORG, share_insights: true });
    const card = one(container, '.org-share-insights');
    expect(card.textContent).toContain('Shared insights');
    expect(card.textContent).toContain('Share anonymised insights with other shops');
    expect(card.textContent).toContain('at least 5 listings from 2 or more shops');
    expect(card.textContent).toContain('On');
    expect((one(card, 'input[type="checkbox"]') as HTMLInputElement).checked).toBe(true);
  });

  it('is hidden when the column is missing (071 not run) and for a plain member', async () => {
    const pre = await renderSettings({ ...ORG });
    expect(pre.container.querySelector('.org-share-insights')).toBeNull();
    cleanup();
    const member = await renderSettings({ ...ORG, share_insights: true }, 'member');
    expect(member.container.querySelector('.org-share-insights')).toBeNull();
  });

  it('saves through setShareInsights with the org id and the new value', async () => {
    vi.mocked(setShareInsights).mockResolvedValue({ status: 'ok', data: false });
    const { container } = await renderSettings({ ...ORG, share_insights: true });
    const box = one(container, '.org-share-insights input[type="checkbox"]') as HTMLInputElement;
    await act(async () => { click(box); await Promise.resolve(); await Promise.resolve(); });
    expect(setShareInsights).toHaveBeenCalledWith('org-1', false);
    expect(box.checked).toBe(false);
    expect(one(container, '.org-share-insights').textContent).toContain('Off');
  });

  it('shows the inline error on forbidden', async () => {
    vi.mocked(setShareInsights).mockResolvedValue({ status: 'forbidden' });
    const { container } = await renderSettings({ ...ORG, share_insights: true });
    const box = one(container, '.org-share-insights input[type="checkbox"]') as HTMLInputElement;
    await act(async () => { click(box); await Promise.resolve(); await Promise.resolve(); });
    expect(one(container, '.org-share-error').textContent).toContain('owner or admin');
    expect(box.checked).toBe(true);
  });
});
