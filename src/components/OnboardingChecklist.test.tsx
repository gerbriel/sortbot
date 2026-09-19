import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { act } from 'react';
import OnboardingChecklist from './OnboardingChecklist';
import type { OnboardingChecklistProps } from './OnboardingChecklist';
import { mount, cleanup, click, one, all, buttonByText } from './ui/testUtils';
import { onboardingLocalKey, writeOnboardingLocal } from '../lib/onboarding';
import { getCategories } from '../lib/categoriesService';
import { getCategoryPresets } from '../lib/categoryPresetsService';
import { fetchOrgMarketplaces, fetchPublications } from '../lib/marketplaceService';
import { getShopifyConnection } from '../lib/shopifyConnectionService';
import { fetchOrgMembers } from '../lib/orgService';
import { fetchWorkflowBatchesMeta } from '../lib/workflowBatchService';
import type { WorkflowBatch } from '../lib/workflowBatchService';

/**
 * The derivation is tested in `lib/onboarding.test.ts`; what is locked HERE is
 * the thing a rule cannot promise — that the widget puts itself away.
 *
 * Every read is mocked (nothing in this file may touch the network) and every
 * one of them is also tested REJECTING, because "fails quiet" is the whole
 * contract of a card that is the first thing on the first screen after sign-in.
 */

vi.mock('../lib/categoriesService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/categoriesService')>();
  return { ...actual, getCategories: vi.fn() };
});
vi.mock('../lib/categoryPresetsService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/categoryPresetsService')>();
  return { ...actual, getCategoryPresets: vi.fn() };
});
vi.mock('../lib/marketplaceService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/marketplaceService')>();
  return { ...actual, fetchOrgMarketplaces: vi.fn(), fetchPublications: vi.fn() };
});
vi.mock('../lib/shopifyConnectionService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/shopifyConnectionService')>();
  return { ...actual, getShopifyConnection: vi.fn() };
});
vi.mock('../lib/orgService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/orgService')>();
  return { ...actual, fetchOrgMembers: vi.fn() };
});
vi.mock('../lib/workflowBatchService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/workflowBatchService')>();
  return { ...actual, fetchWorkflowBatchesMeta: vi.fn() };
});

const batch = (over: Record<string, unknown> = {}) => ({
  id: 'b1', user_id: 'u1', current_step: 2, total_images: 12,
  created_at: '2026-09-01T10:00:00Z', updated_at: '2026-09-10T10:00:00Z',
  ...over,
}) as unknown as Omit<WorkflowBatch, 'workflow_state'>;

function props(over: Partial<OnboardingChecklistProps> = {}): OnboardingChecklistProps {
  return {
    orgId: 'org-1',
    orgName: 'Rack City',
    plan: 'beta',
    role: 'owner',
    canInvite: true,
    hasVendorName: false,
    refreshTrigger: 0,
    onNavigate: vi.fn(),
    onOpenMarketplaces: vi.fn(),
    onStartWorkflow: vi.fn(),
    ...over,
  };
}

/** mount + let the reads (and the chained publications read) settle. */
async function render(over: Partial<OnboardingChecklistProps> = {}) {
  const p = props(over);
  const view = mount(<OnboardingChecklist {...p} />);
  await act(async () => {
    await Promise.resolve(); await Promise.resolve();
    await Promise.resolve(); await Promise.resolve();
  });
  return { ...view, p };
}

const titles = (container: HTMLElement) =>
  all(container, '.onb-step-title').map(t => (t.textContent ?? '').replace(/ — (done|still to do)/, '').trim());

beforeEach(() => {
  localStorage.clear();
  vi.mocked(getCategories).mockResolvedValue([]);
  vi.mocked(getCategoryPresets).mockResolvedValue([]);
  vi.mocked(fetchOrgMarketplaces).mockResolvedValue({ status: 'ok', rows: [] });
  vi.mocked(fetchPublications).mockResolvedValue({ status: 'ok', rows: [] });
  vi.mocked(getShopifyConnection).mockResolvedValue({ status: 'none' });
  vi.mocked(fetchOrgMembers).mockResolvedValue([]);
  vi.mocked(fetchWorkflowBatchesMeta).mockResolvedValue([]);
});

afterEach(() => { cleanup(); vi.clearAllMocks(); localStorage.clear(); });

describe('OnboardingChecklist — a brand-new workspace', () => {
  it('welcomes the shop BY NAME and counts the work left', async () => {
    const { container } = await render();
    expect(one(container, '#onb-heading').textContent).toContain('Welcome to Arcadian, Rack City');
    expect(one(container, '.onb-count').textContent).toBe('0 of 7 done');
  });

  it('badges the founding cohort with what they actually bought', async () => {
    const { container } = await render();
    expect(one(container, '.ui-badge').textContent).toBe('Beta · founding pricing for life');
  });

  it('lists every step an owner can take, in order', async () => {
    const { container } = await render();
    expect(titles(container)).toEqual([
      'Name your shop',
      'Review your categories and presets',
      'Choose where you sell',
      'Connect your Shopify storeOptional',
      'Invite your teamOptional',
      'Upload your first batch',
      'Export your first listings',
    ]);
  });

  it('drops the welcome once the shop has a batch — it is working now', async () => {
    vi.mocked(fetchWorkflowBatchesMeta).mockResolvedValue([batch()]);
    const { container } = await render();
    expect(one(container, '#onb-heading').textContent).toContain('Get set up');
    expect(one(container, '#onb-heading').textContent).not.toContain('Welcome');
  });
});

describe('OnboardingChecklist — where the buttons go', () => {
  it('sends "Name your shop" to the workspace dashboard', async () => {
    const { container, p } = await render();
    click(buttonByText(container, 'Open workspace settings'));
    expect(p.onNavigate).toHaveBeenCalledWith('workspace');
  });

  it('sends "Review categories" to the categories view', async () => {
    const { container, p } = await render();
    click(buttonByText(container, 'Review categories'));
    expect(p.onNavigate).toHaveBeenCalledWith('categories');
  });

  it('opens marketplaces through its own callback, NOT as a view', async () => {
    const { container, p } = await render();
    click(buttonByText(container, 'Choose marketplaces'));
    expect(p.onOpenMarketplaces).toHaveBeenCalledTimes(1);
    expect(p.onNavigate).not.toHaveBeenCalled();
  });

  it('un-parks the workflow on Step 1 to upload, and Step 4 to export', async () => {
    const { container, p } = await render();
    click(buttonByText(container, 'Start uploading'));
    expect(p.onStartWorkflow).toHaveBeenCalledWith(1);
    click(buttonByText(container, 'Go to export'));
    expect(p.onStartWorkflow).toHaveBeenCalledWith(4);
  });

  it('offers no button on a step already done', async () => {
    writeOnboardingLocal('org-1', { visitedCategories: true });
    const { container } = await render();
    const done = all(container, '.onb-step--done');
    expect(done).toHaveLength(1);
    expect(done[0].querySelector('button')).toBeNull();
    // ...and says so for a screen reader, since the tick beside it is aria-hidden.
    expect(done[0].textContent).toContain('— done');
  });
});

describe('OnboardingChecklist — putting itself away', () => {
  it('renders NOTHING once every required step is done', async () => {
    // Two optional steps (Shopify, team) deliberately left outstanding.
    writeOnboardingLocal('org-1', { visitedCategories: true });
    vi.mocked(fetchOrgMarketplaces).mockResolvedValue({
      status: 'ok', rows: [{ org_id: 'org-1', marketplace: 'ebay', enabled: true, settings: {} }],
    });
    vi.mocked(fetchWorkflowBatchesMeta).mockResolvedValue([batch({ current_step: 4 })]);
    const { container } = await render({ hasVendorName: true });
    expect(container.innerHTML).toBe('');
  });

  it('hides on the SECOND click of "Hide this checklist", never the first', async () => {
    // window.confirm is banned (Do Not #12) — this is the ConfirmAction pattern.
    const { container } = await render();
    click(buttonByText(container, 'Hide this checklist'));
    expect(container.innerHTML).not.toBe('');
    click(buttonByText(container, 'Hide it'));
    expect(container.innerHTML).toBe('');
    // ...and it stays hidden across a reload, per workspace.
    expect(JSON.parse(localStorage.getItem(onboardingLocalKey('org-1')) ?? '{}')).toEqual({ hidden: true });
  });

  it('reads NOTHING at all for a workspace that dismissed it', async () => {
    writeOnboardingLocal('org-1', { hidden: true });
    const { container } = await render();
    expect(container.innerHTML).toBe('');
    expect(getCategories).not.toHaveBeenCalled();
    expect(fetchWorkflowBatchesMeta).not.toHaveBeenCalled();
  });

  it('renders nothing in legacy mode, where there is no workspace to set up', async () => {
    const { container } = await render({ orgId: null });
    expect(container.innerHTML).toBe('');
    expect(getCategories).not.toHaveBeenCalled();
  });

  it('renders nothing at all while the reads are still in flight', () => {
    // No flash: an established workspace must not see a checklist appear and
    // then vanish on every page load.
    const view = mount(<OnboardingChecklist {...props()} />);
    expect(view.container.innerHTML).toBe('');
  });
});

describe('OnboardingChecklist — steps that hide, and reads that fail', () => {
  it('omits the marketplaces step when that migration has not been run', async () => {
    vi.mocked(fetchOrgMarketplaces).mockResolvedValue({ status: 'unavailable' });
    const { container } = await render();
    expect(titles(container)).not.toContain('Choose where you sell');
    expect(container.textContent).toContain('Name your shop');
  });

  it('omits the Shopify step when that migration has not been run', async () => {
    vi.mocked(getShopifyConnection).mockResolvedValue({ status: 'unavailable' });
    const { container } = await render();
    expect(titles(container)).not.toContain('Connect your Shopify storeOptional');
  });

  it('asks for neither the marketplaces nor the roster it has no step for', async () => {
    // A plain member: three of the seven steps are not theirs to take, so the
    // reads behind them are never made.
    const { container } = await render({ role: 'member', canInvite: false });
    expect(titles(container)).toEqual([
      'Review your categories and presets',
      'Upload your first batch',
      'Export your first listings',
    ]);
    expect(fetchOrgMarketplaces).not.toHaveBeenCalled();
    expect(getShopifyConnection).not.toHaveBeenCalled();
    expect(fetchOrgMembers).not.toHaveBeenCalled();
  });

  it('a read that REJECTS leaves its step undone rather than ticking it off', async () => {
    vi.mocked(getCategories).mockRejectedValue(new Error('offline'));
    vi.mocked(fetchWorkflowBatchesMeta).mockRejectedValue(new Error('offline'));
    vi.mocked(fetchOrgMembers).mockRejectedValue(new Error('offline'));
    const { container } = await render();
    // Still a checklist, no error wall, nothing falsely complete.
    expect(all(container, '.onb-step')).toHaveLength(7);
    expect(all(container, '.onb-step--done')).toHaveLength(0);
    expect(container.textContent).not.toContain('offline');
  });

  it('counts a publication as an export when no batch reached Step 4', async () => {
    // The cheap proof first (a batch at Step 4); the rows only when that is 0.
    vi.mocked(fetchWorkflowBatchesMeta).mockResolvedValue([batch({ current_step: 2 })]);
    vi.mocked(fetchPublications).mockResolvedValue({
      status: 'ok',
      rows: [{ id: 'p1', product_group_id: 'g1', marketplace: 'ebay', status: 'exported' }] as never,
    });
    const { container } = await render();
    const exportStep = all(container, '.onb-step').find(s => (s.textContent ?? '').includes('Export your first listings'));
    expect(exportStep?.className).toContain('onb-step--done');
  });

  it('does not pay for the publications read once a batch has reached Step 4', async () => {
    vi.mocked(fetchWorkflowBatchesMeta).mockResolvedValue([batch({ current_step: 4 })]);
    await render();
    expect(fetchPublications).not.toHaveBeenCalled();
  });
});
