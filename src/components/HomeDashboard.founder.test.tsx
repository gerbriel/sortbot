import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { act } from 'react';
import {
  BarChart3, Building2, Package, Printer, ScanLine, ShieldCheck, Users,
} from 'lucide-react';
import HomeDashboard from './HomeDashboard';
import type { HomeDashboardProps } from './HomeDashboard';
import { mount, cleanup, click, all, buttonByText } from './ui/testUtils';
import type { WorkspaceNavItem } from './WorkspaceMenu';
import { fetchWorkflowBatchesMeta, getWorkflowBatch } from '../lib/workflowBatchService';
import { fetchOrgMarketplaces, fetchPublications } from '../lib/marketplaceService';
import { fetchAnalyticsSummary } from '../lib/analytics';
import { useSupportThreads } from '../lib/supportStore';
import { getCategories } from '../lib/categoriesService';
import { getCategoryPresets } from '../lib/categoryPresetsService';
import { getShopifyConnection } from '../lib/shopifyConnectionService';
import { fetchOrgMembers } from '../lib/orgService';
import { fetchOrgUsage, fetchProjectUsage, type ProjectUsage } from '../lib/usageService';
import {
  fetchBetaSignupsOrNull, fetchBetaOrgDirectory, type BetaSignupRow,
} from '../lib/betaService';

/**
 * FOUNDER MODE: the Founding Workspace's Home is admin-first. Locked here: the
 * admin cards lead and the batch widgets follow, a member's Home is untouched
 * (no admin cards, Plan usage and Marketplaces still read), the glance card's
 * primary action opens the Founder console, and the requests card has an
 * honest empty state and hides when the beta table cannot be read.
 * Only network functions are mocked, as in HomeDashboard.test.tsx.
 */

vi.mock('../lib/workflowBatchService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/workflowBatchService')>();
  return { ...actual, fetchWorkflowBatchesMeta: vi.fn(), getWorkflowBatch: vi.fn() };
});
vi.mock('../lib/marketplaceService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/marketplaceService')>();
  return { ...actual, fetchOrgMarketplaces: vi.fn(), fetchPublications: vi.fn() };
});
vi.mock('../lib/analytics', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/analytics')>();
  return { ...actual, fetchAnalyticsSummary: vi.fn() };
});
vi.mock('../lib/supportStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/supportStore')>();
  return { ...actual, useSupportThreads: vi.fn() };
});
vi.mock('../lib/categoriesService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/categoriesService')>();
  return { ...actual, getCategories: vi.fn() };
});
vi.mock('../lib/categoryPresetsService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/categoryPresetsService')>();
  return { ...actual, getCategoryPresets: vi.fn() };
});
vi.mock('../lib/shopifyConnectionService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/shopifyConnectionService')>();
  return { ...actual, getShopifyConnection: vi.fn() };
});
vi.mock('../lib/orgService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/orgService')>();
  return { ...actual, fetchOrgMembers: vi.fn() };
});
vi.mock('../lib/usageService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/usageService')>();
  return { ...actual, fetchOrgUsage: vi.fn(), fetchProjectUsage: vi.fn() };
});
vi.mock('../lib/betaService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/betaService')>();
  return { ...actual, fetchBetaSignupsOrNull: vi.fn(), fetchBetaOrgDirectory: vi.fn() };
});

const icon = <Package size={16} />;
const MEMBER_NAV: WorkspaceNavItem[] = [
  { id: 'library', label: 'Library', icon, title: 'Library', group: 'work' },
  { id: 'products', label: 'Products', icon, title: 'Products', group: 'work' },
  { id: 'labels', label: 'Labels', icon: <Printer size={16} />, title: 'Labels', group: 'work' },
  { id: 'scan', label: 'Scan', icon: <ScanLine size={16} />, title: 'Scan', group: 'work' },
  { id: 'workspace', label: 'Workspace dashboard', icon: <Users size={16} />, title: 'Workspace', group: 'setup' },
];
const FOUNDER_NAV: WorkspaceNavItem[] = [
  ...MEMBER_NAV,
  { id: 'founder', label: 'Founder console', icon: <ShieldCheck size={16} />, title: 'Founder', group: 'founder' },
  { id: 'analytics', label: 'Analytics', icon: <BarChart3 size={16} />, title: 'Analytics', group: 'founder' },
  { id: 'crm', label: 'CRM', icon: <Building2 size={16} />, title: 'CRM', group: 'founder' },
];

function props(over: Partial<HomeDashboardProps> = {}): HomeDashboardProps {
  return {
    userEmail: 'gab@example.com',
    userId: 'u1',
    orgName: 'Founding Workspace',
    orgId: 'org-f',
    isFounder: true,
    orgPlan: 'founding',
    orgRole: 'owner',
    descriptionSettings: null,
    navItems: FOUNDER_NAV,
    activeBatchId: null,
    activeBatchNumber: null,
    items: [],
    refreshTrigger: 0,
    onResume: vi.fn(),
    onStartNewBatch: vi.fn(),
    onOpenBatch: vi.fn(),
    onNavigate: vi.fn(),
    onOpenMarketplaces: vi.fn(),
    ...over,
  };
}

async function render(over: Partial<HomeDashboardProps> = {}) {
  const p = props(over);
  const view = mount(<HomeDashboard {...p} />);
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
  return { ...view, p };
}

/** Card titles in DOM order, leaving out the setup checklist (it owns its
 *  reads and its own tests, and leads either mode while it is showing). */
const titles = (c: HTMLElement) => all(c, '.home-card:not(.onb-card) > .home-card-head .home-card-title')
  .map(t => (t.textContent ?? '').trim());

const signup = (id: string, status: BetaSignupRow['status'], created_at: string): BetaSignupRow => ({
  id, org_name: `Shop ${id}`, contact_name: 'Pat', email: `${id}@shop.test`,
  store_url: null, volume: null, notes: null, status, created_at, reviewed_at: null,
});

const GB = 1024 ** 3;
const projectUsage = (bytes: number, quota: number | null): ProjectUsage => ({
  project: {
    storage_gb_quota: quota, storage_bytes_total: bytes, files_total: 40, orgs: 6,
    members_total: 14, listings_this_month_total: 230, month_start: '2026-11-01',
    listing_basis: 'created',
  },
  orgs: [],
});

beforeEach(() => {
  vi.mocked(fetchWorkflowBatchesMeta).mockResolvedValue([]);
  vi.mocked(getWorkflowBatch).mockResolvedValue(null);
  vi.mocked(fetchOrgMarketplaces).mockResolvedValue({
    status: 'ok', rows: [{ org_id: 'org-1', marketplace: 'ebay', enabled: true, settings: {} }],
  });
  vi.mocked(fetchPublications).mockResolvedValue({ status: 'ok', rows: [] });
  vi.mocked(fetchAnalyticsSummary).mockResolvedValue({
    status: 'ok',
    summary: {
      days: 7, from: '2026-11-15',
      totals: { pageviews: 420, sessions: 88, users: 12, events: 500, beta_signups: 3 },
      previous: { pageviews: 300, sessions: 60 },
      daily: [], events: [], referrers: [], devices: [], views: [],
    },
  });
  vi.mocked(getCategories).mockResolvedValue([]);
  vi.mocked(getCategoryPresets).mockResolvedValue([]);
  vi.mocked(getShopifyConnection).mockResolvedValue({ status: 'unavailable' });
  vi.mocked(fetchOrgMembers).mockResolvedValue([]);
  vi.mocked(fetchOrgUsage).mockResolvedValue({
    status: 'ok',
    data: {
      org_id: 'org-1', plan: 'beta',
      limits: { listings_per_month: 100, storage_gb: 10, seats: 3 },
      usage: { storage_bytes: GB, files: 1, listings_this_month: 1, members: 1, month_start: '2026-11-01' },
      listing_basis: 'created',
    },
  });
  vi.mocked(fetchProjectUsage).mockResolvedValue({ status: 'ok', data: projectUsage(9 * GB, 10) });
  vi.mocked(fetchBetaSignupsOrNull).mockResolvedValue([]);
  vi.mocked(fetchBetaOrgDirectory).mockResolvedValue([]);
  vi.mocked(useSupportThreads).mockReturnValue({
    threads: [], sorted: [], available: true, teamAvailable: false,
    unreadCount: 0, supportUnreadCount: 0, revision: 0, refresh: async () => {},
  });
});

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('HomeDashboard founder mode: layout', () => {
  it('leads with App at a glance and Admin tools, then the batch widgets', async () => {
    const { container } = await render();
    const t = titles(container);
    const glance = t.indexOf('App at a glance');
    const admin = t.indexOf('Admin tools');
    const batch = t.indexOf('Current batch');
    expect(glance).toBe(0);
    expect(admin).toBeGreaterThan(-1);
    expect(batch).toBeGreaterThan(admin);
    expect(t.indexOf('Inbox')).toBeLessThan(batch);
    // The quiet section caption sits between them.
    expect(container.querySelector('.home-section')?.textContent).toBe('Test a batch');
  });

  it('drops Plan usage and Marketplaces, and does not read plan usage', async () => {
    const { container } = await render();
    const t = titles(container);
    expect(t).not.toContain('Plan usage');
    expect(t).not.toContain('Marketplaces');
    // (Marketplaces is still read by the setup checklist, so only usage is asserted.)
    expect(fetchOrgUsage).not.toHaveBeenCalled();
  });

  it('says what the page is for in the subtitle', async () => {
    const { container } = await render();
    expect(container.querySelector('.home-sub')?.textContent)
      .toMatch(/^Founding Workspace\. Requests, workspaces, accounts and .+ as a whole\.$/);
  });

  it('builds Admin tools from the founder nav rows plus Workspace', async () => {
    const { container } = await render();
    const cards = all(container, '.home-card');
    const admin = cards.find(c => c.querySelector('.home-card-title')?.textContent === 'Admin tools');
    const labels = all(admin as HTMLElement, '.home-tile-label').map(l => l.textContent);
    expect(labels).toEqual(['Founder console', 'Analytics', 'CRM', 'Workspace dashboard']);
    const tools = cards.find(c => c.querySelector('.home-card-title')?.textContent === 'Tools');
    expect(all(tools as HTMLElement, '.home-tile-label').map(l => l.textContent))
      .toEqual(['Library', 'Products', 'Labels', 'Scan']);
  });
});

describe('HomeDashboard founder mode: App at a glance', () => {
  it('"Open Founder console" opens the founder view', async () => {
    const { container, p } = await render();
    click(buttonByText(container, 'Open Founder console'));
    expect(p.onNavigate).toHaveBeenCalledWith('founder');
  });

  it('shows traffic, requests and project usage, with storage tinted near the quota', async () => {
    vi.mocked(fetchBetaSignupsOrNull).mockResolvedValue([
      signup('a', 'pending', '2026-11-20T00:00:00Z'),
      signup('b', 'approved', '2026-11-19T00:00:00Z'),
    ]);
    const { container } = await render();
    const text = container.textContent ?? '';
    expect(text).toContain('Pageviews');
    expect(text).toContain('420');
    expect(text).toContain('Pending requests');
    expect(text).toContain('230');
    expect(text).toContain('90% of the 10 GB quota');
    const storage = all(container, '.ui-stat').find(s => s.textContent?.includes('Project storage'));
    expect(storage?.className).toContain('home-stat--warn');
  });

  it('fails quiet: missing features drop their tiles, never the card', async () => {
    vi.mocked(fetchAnalyticsSummary).mockResolvedValue({ status: 'unavailable' });
    vi.mocked(fetchProjectUsage).mockResolvedValue({ status: 'unavailable' });
    vi.mocked(fetchBetaSignupsOrNull).mockResolvedValue(null);
    const { container } = await render();
    expect(titles(container)).toContain('App at a glance');
    const text = container.textContent ?? '';
    expect(text).not.toContain('Pageviews');
    expect(text).not.toContain('Project storage');
    expect(text).toContain('Workspaces');
    expect(buttonByText(container, 'Open Founder console')).toBeTruthy();
  });
});

describe('HomeDashboard founder mode: pending requests', () => {
  it('says so when there are none', async () => {
    vi.mocked(fetchBetaSignupsOrNull).mockResolvedValue([signup('x', 'approved', '2026-11-20T00:00:00Z')]);
    const { container } = await render();
    expect(container.textContent).toContain('No pending requests.');
  });

  it('lists the newest pending requests and links to the console', async () => {
    vi.mocked(fetchBetaSignupsOrNull).mockResolvedValue([
      signup('old', 'pending', '2026-11-01T00:00:00Z'),
      signup('new', 'pending', '2026-11-21T00:00:00Z'),
    ]);
    const { container, p } = await render();
    const names = all(container, '.home-row-name').map(n => n.textContent);
    expect(names.slice(0, 2)).toEqual(['new@shop.test', 'old@shop.test']);
    click(buttonByText(container, 'Open requests'));
    expect(p.onNavigate).toHaveBeenCalledWith('founder');
  });

  it('hides when the beta table cannot be read', async () => {
    vi.mocked(fetchBetaSignupsOrNull).mockResolvedValue(null);
    const { container } = await render();
    expect(titles(container)).not.toContain('Pending requests');
  });
});

describe('HomeDashboard member mode is unchanged', () => {
  it('renders no admin cards and keeps Plan usage and Marketplaces', async () => {
    const { container } = await render({ isFounder: false, navItems: MEMBER_NAV, orgName: 'Rack City' });
    const t = titles(container);
    expect(t).not.toContain('App at a glance');
    expect(t).not.toContain('Admin tools');
    expect(t).not.toContain('Pending requests');
    expect(container.querySelector('.home-section')).toBeNull();
    expect(t[0]).toBe('Current batch');
    expect(t).toContain('Plan usage');
    expect(t).toContain('Marketplaces');
    expect(fetchProjectUsage).not.toHaveBeenCalled();
    expect(fetchBetaSignupsOrNull).not.toHaveBeenCalled();
    expect(container.querySelector('.home-sub')?.textContent)
      .toBe('Rack City — pick up where you left off, or start something else.');
    // The batch card keeps its full row for members.
    expect(container.querySelector('.home-card--wide:not(.onb-card) .home-card-title')?.textContent)
      .toBe('Current batch');
  });
});
