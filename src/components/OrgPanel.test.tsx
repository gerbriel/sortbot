import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { act } from 'react';
import OrgPanel, { PlanUsageGroup } from './OrgPanel';
import { mount, cleanup, all, one, click, buttonByText } from './ui/testUtils';

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
  return { ...actual, getOrgDescriptionSettings: vi.fn(), saveOrgDescriptionSettings: vi.fn() };
});

vi.mock('../lib/labelsService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/labelsService')>();
  return { ...actual, countMissingCodes: vi.fn(), regenerateMissingCodes: vi.fn() };
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
import { getOrgDescriptionSettings, saveOrgDescriptionSettings, DEFAULT_DESCRIPTION_SETTINGS } from '../lib/descriptionSettings';
import { countMissingCodes, regenerateMissingCodes } from '../lib/labelsService';
import { DEFAULT_CODE_SETTINGS } from '../lib/codeSettings';
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

/** Set a controlled field through the prototype setter, or React's value
 *  tracker swallows the change. */
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

/** The control in the FieldCell whose label reads `label`, inside `root`. */
function cell(root: HTMLElement, label: string): HTMLElement {
  const match = all(root, '.ui-fieldcell').find(
    c => (c.querySelector('.ui-fieldcell__label')?.textContent ?? '').trim() === label,
  );
  if (!match) throw new Error(`cell(): no cell labelled "${label}"`);
  return one(match, 'input, select');
}

async function flush() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
}

describe('OrgPanel SKUs and barcodes', () => {
  async function renderSettings(role: 'owner' | 'admin' | 'member' = 'admin') {
    const view = mount(<OrgPanel org={ORG} myRole={role} myUserId="u1" onClose={() => {}} initialTab="settings" />);
    await flush();
    return view;
  }

  it('renders the codes card for an admin, and not for a member', async () => {
    const { container } = await renderSettings('admin');
    const card = one(container, '.org-codes');
    expect(card.textContent).toContain('SKUs and barcodes');
    for (const label of ['Prefix', 'Separator', 'Scheme', 'Category code', 'Barcode', 'Assign codes']) {
      expect(cell(card, label)).toBeTruthy();
    }
    // Digits and In-store prefix only appear for the modes that use them.
    expect(card.textContent).not.toContain('Digits');
    expect(card.textContent).not.toContain('In-store prefix');
    expect(one(card, '.org-codes-preview').textContent).toBe('Example: ACD-7K3Q9M, barcode ACD-7K3Q9M');
    cleanup();
    const member = await renderSettings('member');
    expect(member.container.querySelector('.org-codes')).toBeNull();
  });

  it('updates the preview when the scheme changes, and shows Digits', async () => {
    const { container } = await renderSettings();
    const card = one(container, '.org-codes');
    setValue(cell(card, 'Scheme'), 'sequential');
    expect(one(card, '.org-codes-preview').textContent).toBe('Example: ACD-00012, barcode ACD-00012');
    expect(cell(card, 'Digits')).toBeTruthy();
    setValue(cell(card, 'Barcode'), 'ean13_store');
    expect(one(card, '.org-codes-preview').textContent).toBe('Example: ACD-00012, barcode 2000000000121');
    expect((cell(card, 'In-store prefix') as HTMLSelectElement).value).toBe('20');
  });

  it('shows a validation error in the hint and blocks Save', async () => {
    const { container } = await renderSettings();
    const card = one(container, '.org-codes');
    setValue(cell(card, 'Prefix'), '');
    expect(one(card, '.org-codes-error').textContent).toContain('Prefix is 1 to 8');
    expect((buttonByText(card, 'Save codes') as HTMLButtonElement).disabled).toBe(true);
  });

  it('Save sends codes through saveOrgDescriptionSettings', async () => {
    vi.mocked(saveOrgDescriptionSettings).mockResolvedValue({ ok: true });
    const { container } = await renderSettings();
    const card = one(container, '.org-codes');
    setValue(cell(card, 'Prefix'), 'rck');
    setValue(cell(card, 'Scheme'), 'sequential');
    await act(async () => { click(buttonByText(card, 'Save codes')); await Promise.resolve(); });
    expect(saveOrgDescriptionSettings).toHaveBeenCalledTimes(1);
    const [orgId, saved] = vi.mocked(saveOrgDescriptionSettings).mock.calls[0];
    expect(orgId).toBe('org-1');
    expect(saved.codes).toEqual({ ...DEFAULT_CODE_SETTINGS, skuPrefix: 'RCK', skuScheme: 'sequential' });
    expect(saved.labelTemplates).toEqual([]);
    expect(container.textContent).toContain('SKU and barcode settings saved');
  });

  it('assigns codes to listings without one after a count and a confirm', async () => {
    vi.mocked(countMissingCodes).mockResolvedValue({ status: 'ok', count: 7 });
    vi.mocked(regenerateMissingCodes).mockResolvedValue({ status: 'ok', assigned: 7 });
    const { container } = await renderSettings();
    const card = one(container, '.org-codes');
    await act(async () => { click(buttonByText(card, 'Assign codes to listings without one')); await Promise.resolve(); });
    expect(countMissingCodes).toHaveBeenCalledWith('org-1');
    expect(card.textContent).toContain('Assign codes to 7 listings?');
    expect(regenerateMissingCodes).not.toHaveBeenCalled();
    await act(async () => { click(buttonByText(card, 'Assign')); await Promise.resolve(); });
    expect(regenerateMissingCodes).toHaveBeenCalledWith('org-1', DEFAULT_CODE_SETTINGS);
    expect(container.textContent).toContain('Assigned 7 codes.');
  });
});

describe('OrgPanel label sizes', () => {
  async function renderSettings() {
    const view = mount(<OrgPanel org={ORG} myRole="admin" myUserId="u1" onClose={() => {}} initialTab="settings" />);
    await flush();
    return view;
  }

  it('lists the built-in stocks as read-only', async () => {
    const { container } = await renderSettings();
    const group = one(container, '.org-labelsizes');
    expect(all(group, '.org-labelsizes-row')).toHaveLength(3);
    expect(group.textContent).toContain('Built in');
    expect(group.textContent).not.toContain('Edit');
  });

  it('rejects a label wider than the page and writes nothing', async () => {
    const { container } = await renderSettings();
    const group = one(container, '.org-labelsizes');
    click(buttonByText(group, 'Add a label size'));
    const form = one(group, '.org-labelsizes-form');
    setValue(cell(form, 'Name'), 'Too wide');
    setValue(cell(form, 'Label width (in)'), '6');
    await act(async () => { click(buttonByText(form, 'Add label size')); await Promise.resolve(); });
    expect(one(form, '.org-codes-error').textContent).toContain('between the margins');
    expect(saveOrgDescriptionSettings).not.toHaveBeenCalled();
  });

  it('saves a stock that fits into labelTemplates', async () => {
    vi.mocked(saveOrgDescriptionSettings).mockResolvedValue({ ok: true });
    const { container } = await renderSettings();
    const group = one(container, '.org-labelsizes');
    click(buttonByText(group, 'Add a label size'));
    const form = one(group, '.org-labelsizes-form');
    setValue(cell(form, 'Name'), 'Shelf tag');
    await act(async () => { click(buttonByText(form, 'Add label size')); await Promise.resolve(); });
    const saved = vi.mocked(saveOrgDescriptionSettings).mock.calls[0][1];
    expect(saved.labelTemplates).toHaveLength(1);
    expect(saved.labelTemplates[0]).toMatchObject({ name: 'Shelf tag', columns: 2, label: { width: '4in', height: '2in' } });
    expect(saved.labelTemplates[0].id).toMatch(/^custom-/);
    await flush();
    expect(all(one(container, '.org-labelsizes'), '.org-labelsizes-row')).toHaveLength(4);
  });
});
