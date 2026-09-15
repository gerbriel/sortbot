import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { act } from 'react';
import { Package, Printer, ScanLine, Settings, Users } from 'lucide-react';
import HomeDashboard from './HomeDashboard';
import type { HomeDashboardProps } from './HomeDashboard';
import { mount, cleanup, click, one, all, buttonByText } from './ui/testUtils';
import type { WorkspaceNavItem } from './WorkspaceMenu';
import type { ClothingItem } from '../App';
import { fetchWorkflowBatchesMeta, getWorkflowBatch } from '../lib/workflowBatchService';
import type { WorkflowBatch } from '../lib/workflowBatchService';
import { fetchOrgMarketplaces, fetchPublications } from '../lib/marketplaceService';
import { fetchAnalyticsSummary } from '../lib/analytics';
import { useSupportThreads } from '../lib/supportStore';

/**
 * The home dashboard is the first thing a signed-in user sees and the only
 * place several of these numbers are assembled, so the render path needs a test
 * of its own. Only the NETWORK functions are mocked; every pure helper
 * (`batchSummary`, `recentBatchRows`, `storageReadout`) runs for real, which is
 * what makes the assertions below mean something.
 *
 * What is deliberately locked here: the two states of the batch widget, that
 * Resume hands back the step the work is actually on, that "Start a new batch"
 * is two-step and not a `window.confirm`, that the open batch never appears
 * twice, and that a tool a user has no role for cannot appear as a tile.
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

const item = (id: string, o: Partial<ClothingItem> = {}): ClothingItem =>
  ({ id, ...o } as unknown as ClothingItem);

const NAV: WorkspaceNavItem[] = [
  { id: 'home', label: 'Home', icon: <Package size={16} />, title: 'Home', group: 'work' },
  { id: 'library', label: 'Library', icon: <Package size={16} />, title: 'Library', group: 'work' },
  { id: 'labels', label: 'Labels', icon: <Printer size={16} />, title: 'Labels', group: 'work' },
  { id: 'scan', label: 'Scan', icon: <ScanLine size={16} />, title: 'Scan', group: 'work' },
  { id: 'presets', label: 'Category Presets', icon: <Settings size={16} />, title: 'Presets', group: 'setup' },
  { id: 'workspace', label: 'Workspace dashboard', icon: <Users size={16} />, title: 'Workspace', group: 'setup' },
  { id: 'shortcuts', label: 'Keyboard shortcuts', icon: <Settings size={16} />, title: 'Shortcuts', group: 'setup', phoneOnly: true },
];

const meta = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  user_id: 'u1',
  batch_name: undefined,
  batch_number: `batch-${id}`,
  current_step: 2,
  is_completed: false,
  total_images: 12,
  product_groups_count: 4,
  categorized_count: 4,
  processed_count: 4,
  saved_products_count: 0,
  created_at: '2026-09-01T10:00:00Z',
  updated_at: '2026-09-10T10:00:00Z',
  ...over,
}) as unknown as Omit<WorkflowBatch, 'workflow_state'>;

function props(over: Partial<HomeDashboardProps> = {}): HomeDashboardProps {
  return {
    userEmail: 'sam@example.com',
    userId: 'u1',
    orgName: 'Rack City',
    orgId: 'org-1',
    isFounder: false,
    navItems: NAV,
    activeBatchId: null,
    activeBatchNumber: null,
    items: [],
    refreshTrigger: 0,
    storage: null,
    onResume: vi.fn(),
    onStartNewBatch: vi.fn(),
    onOpenBatch: vi.fn(),
    onNavigate: vi.fn(),
    onOpenMarketplaces: vi.fn(),
    ...over,
  };
}

/** mount + let every widget's load promise settle. */
async function render(over: Partial<HomeDashboardProps> = {}) {
  const p = props(over);
  const view = mount(<HomeDashboard {...p} />);
  // Three awaits: the marketplaces widget chains a second fetch behind its first.
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
  return { ...view, p };
}

beforeEach(() => {
  vi.mocked(fetchWorkflowBatchesMeta).mockResolvedValue([]);
  vi.mocked(getWorkflowBatch).mockResolvedValue(null);
  vi.mocked(fetchOrgMarketplaces).mockResolvedValue({ status: 'unavailable' });
  vi.mocked(fetchPublications).mockResolvedValue({ status: 'ok', rows: [] });
  vi.mocked(fetchAnalyticsSummary).mockResolvedValue({ status: 'unavailable' });
  vi.mocked(useSupportThreads).mockReturnValue({
    threads: [], sorted: [], available: false, teamAvailable: false,
    unreadCount: 0, supportUnreadCount: 0, revision: 0, refresh: async () => {},
  });
});

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('HomeDashboard — no batch open', () => {
  it('offers Upload photos, and taking it reveals Step 1', async () => {
    const { container, p } = await render();
    expect(container.textContent).toContain('No batch open');
    click(buttonByText(container, 'Upload photos'));
    expect(p.onResume).toHaveBeenCalledWith(1);
  });

  it('greets the user by the local part of their email', async () => {
    const { container } = await render();
    expect(one(container, '.home-title').textContent).toBe('Welcome back, sam');
  });

  it('does not offer to start a new batch when there is no batch to put down', async () => {
    const { container } = await render();
    expect(container.textContent).not.toContain('Start a new batch');
  });
});

describe('HomeDashboard — a batch open', () => {
  const items = [
    item('a', { productGroup: 'a', category: 'tees' }),
    item('b', { productGroup: 'a', category: 'tees' }),
    item('c', { category: 'hats' }),
    item('d'),
  ];

  it('counts photos, groups and listings the way Step 3 does', async () => {
    const { container } = await render({ activeBatchId: 'b1', activeBatchNumber: 'batch-777', items });
    const values = all(container, '.home-card--wide .ui-stat__value').map(v => v.textContent);
    // 4 photos, 1 true multi-photo group, 2 listings — the loose uncategorized
    // single is a photo but not a listing.
    expect(values).toEqual(['4', '1', '2']);
    expect(container.textContent).toContain('3 categorized');
  });

  it('resumes on the step the work is actually on, not the furthest one', async () => {
    const { container, p } = await render({ activeBatchId: 'b1', activeBatchNumber: 'batch-777', items });
    // Something is categorized → Describe.
    expect(container.textContent).toContain('Step 3 — Describe listings');
    click(buttonByText(container, 'Resume batch'));
    expect(p.onResume).toHaveBeenCalledWith(3);
  });

  it('resumes on Group when nothing has been categorized yet', async () => {
    const { container, p } = await render({
      activeBatchId: 'b1', activeBatchNumber: 'batch-777',
      items: [item('a', { productGroup: 'a' }), item('b', { productGroup: 'a' })],
    });
    expect(container.textContent).toContain('Step 2 — Group & categorize');
    click(buttonByText(container, 'Resume batch'));
    expect(p.onResume).toHaveBeenCalledWith(2);
  });

  it('shows the batch NAME when the metadata has one, and the number otherwise', async () => {
    vi.mocked(fetchWorkflowBatchesMeta).mockResolvedValue([meta('b1', { batch_name: 'Fall drop' })]);
    const { container } = await render({ activeBatchId: 'b1', activeBatchNumber: 'batch-777', items });
    expect(one(container, '.home-batch-name').textContent).toBe('Fall drop');
  });

  it('falls back to the batch number when no metadata row comes back', async () => {
    const { container } = await render({ activeBatchId: 'b1', activeBatchNumber: 'batch-777', items });
    expect(one(container, '.home-batch-name').textContent).toBe('batch-777');
  });

  it('"Start a new batch" is TWO-STEP — it never fires on the first click', async () => {
    // window.confirm is banned (Do Not #12); this is the ConfirmAction pattern.
    const { container, p } = await render({ activeBatchId: 'b1', activeBatchNumber: 'batch-777', items });
    click(buttonByText(container, 'Start a new batch'));
    expect(p.onStartNewBatch).not.toHaveBeenCalled();
    click(buttonByText(container, 'Start new'));
    expect(p.onStartNewBatch).toHaveBeenCalledTimes(1);
  });
});

describe('HomeDashboard — recent batches', () => {
  it('lists batches and SKIPS the one already open', async () => {
    vi.mocked(fetchWorkflowBatchesMeta).mockResolvedValue([
      meta('b1', { batch_name: 'Open one' }),
      meta('b2', { batch_name: 'Older' }),
      meta('b3', { batch_name: 'Oldest' }),
    ]);
    const { container } = await render({ activeBatchId: 'b1', activeBatchNumber: 'batch-1', items: [item('x', { category: 'tees' })] });
    const names = all(container, '.home-row-name').map(n => n.textContent);
    expect(names).toEqual(['Older', 'Oldest']);
  });

  it('opens a row through the FULL batch row, not the metadata projection', async () => {
    vi.mocked(fetchWorkflowBatchesMeta).mockResolvedValue([meta('b2', { batch_name: 'Older' })]);
    const full = { id: 'b2', workflow_state: { processedItems: [] } } as unknown as WorkflowBatch;
    vi.mocked(getWorkflowBatch).mockResolvedValue(full);
    const { container, p } = await render();
    click(one(container, '.home-row'));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    // The metadata read projects workflow_state away; handing that to
    // handleOpenBatch would send it down the DB-rebuild path.
    expect(getWorkflowBatch).toHaveBeenCalledWith('b2');
    expect(p.onOpenBatch).toHaveBeenCalledWith(full);
  });

  it('says so when there is nothing else saved, and links to the Library', async () => {
    const { container, p } = await render();
    expect(container.textContent).toContain('Nothing else saved yet');
    click(buttonByText(container, 'All batches'));
    expect(p.onNavigate).toHaveBeenCalledWith('library');
  });

  it('renders an empty list rather than an error when the read throws', async () => {
    vi.mocked(fetchWorkflowBatchesMeta).mockRejectedValue(new Error('offline'));
    const { container } = await render();
    expect(container.textContent).toContain('Nothing else saved yet');
  });
});

describe('HomeDashboard — quick actions', () => {
  it('renders a tile ONLY for an id that is in navItems', async () => {
    const { container } = await render();
    const labels = all(container, '.home-tile-label').map(l => l.textContent);
    expect(labels).toEqual([
      'Labels', 'Scan', 'Library', 'Category Presets', 'Workspace dashboard', 'Marketplaces',
    ]);
    // The founder tools are not in this user's nav list, so they cannot appear.
    expect(labels).not.toContain('Finance');
    expect(labels).not.toContain('Analytics');
    // Home is not a tile on the home page, and neither is the phone-only row.
    expect(labels).not.toContain('Home');
    expect(labels).not.toContain('Keyboard shortcuts');
  });

  it('a tile navigates to its own view', async () => {
    const { container, p } = await render();
    click(buttonByText(container, 'Scan'));
    expect(p.onNavigate).toHaveBeenCalledWith('scan');
  });

  it('Marketplaces is not a view — it opens the workspace dashboard on that tab', async () => {
    const { container, p } = await render();
    click(buttonByText(container, 'Marketplaces'));
    expect(p.onOpenMarketplaces).toHaveBeenCalledTimes(1);
    expect(p.onNavigate).not.toHaveBeenCalled();
  });
});

describe('HomeDashboard — widgets that hide themselves', () => {
  it('hides Messages entirely when the messaging tables are not installed', async () => {
    const { container } = await render();
    expect(container.textContent).not.toContain('Messages');
  });

  it('shows threads and an unread badge when messaging is available', async () => {
    vi.mocked(useSupportThreads).mockReturnValue({
      threads: [], available: true, teamAvailable: false, unreadCount: 2,
      supportUnreadCount: 2, revision: 1, refresh: async () => {},
      sorted: [{
        id: 't1', kind: 'support', user_email: 'shop@example.com',
        last_message_preview: 'My export is stuck', last_message_at: new Date().toISOString(),
      }] as never,
    });
    const { container, p } = await render();
    expect(container.textContent).toContain('2 unread');
    expect(container.textContent).toContain('My export is stuck');
    // A non-founder sees who they are talking to, not their own address.
    expect(container.textContent).toContain('Customer support');
    click(buttonByText(container, 'Open messages'));
    expect(p.onNavigate).toHaveBeenCalledWith('messages');
  });

  it('hides Marketplaces pre-migration and when no marketplace is enabled', async () => {
    const { container } = await render();
    expect(container.textContent).not.toContain('Marketplaces —');
    expect(container.querySelector('.home-chips')).toBeNull();

    cleanup();
    vi.mocked(fetchOrgMarketplaces).mockResolvedValue({ status: 'ok', rows: [] });
    const second = await render();
    expect(second.container.querySelector('.home-chips')).toBeNull();
  });

  it('lists enabled marketplaces and the batch publication counts', async () => {
    vi.mocked(fetchOrgMarketplaces).mockResolvedValue({
      status: 'ok',
      rows: [
        { org_id: 'org-1', marketplace: 'ebay', enabled: true, settings: {} },
        { org_id: 'org-1', marketplace: 'depop', enabled: true, settings: {} },
        { org_id: 'org-1', marketplace: 'etsy', enabled: false, settings: {} },
      ],
    });
    vi.mocked(fetchPublications).mockResolvedValue({
      status: 'ok',
      rows: [
        { id: '1', product_group_id: 'g1', marketplace: 'ebay', status: 'posted' },
        { id: '2', product_group_id: 'g1', marketplace: 'depop', status: 'sold' },
      ] as never,
    });
    const { container } = await render({ activeBatchId: 'b1', activeBatchNumber: 'batch-1', items: [item('x', { category: 'tees' })] });
    const chips = all(container, '.home-chips .ui-badge').map(c => c.textContent);
    expect(chips).toEqual(['eBay', 'Depop']);
    expect(chips).not.toContain('Etsy');
  });

  it('hides the founder pulse for a non-founder and never calls analytics', async () => {
    await render();
    expect(fetchAnalyticsSummary).not.toHaveBeenCalled();
  });

  it('shows the founder pulse when the summary comes back', async () => {
    vi.mocked(fetchAnalyticsSummary).mockResolvedValue({
      status: 'ok',
      summary: {
        days: 7, from: '2026-09-08',
        totals: { pageviews: 420, sessions: 88, users: 12, events: 500, beta_signups: 3 },
        previous: { pageviews: 300, sessions: 60 },
        daily: [], events: [], referrers: [], devices: [], views: [],
      },
    });
    const { container, p } = await render({ isFounder: true });
    expect(container.textContent).toContain('Last 7 days');
    click(buttonByText(container, 'Open analytics'));
    expect(p.onNavigate).toHaveBeenCalledWith('analytics');
  });
});

describe('HomeDashboard — storage', () => {
  it('hides the widget when App has no reading yet', async () => {
    const { container } = await render();
    expect(container.textContent).not.toContain('Photos stored');
  });

  it('shows used / limit / files and a clamped meter', async () => {
    const gb = 1024 * 1024 * 1024;
    const { container } = await render({
      storage: { usedBytes: 310 * gb, fileCount: 4854, loading: false, limitGb: 100 },
    });
    expect(container.textContent).toContain('310 GB');
    expect(container.textContent).toContain('of 100 GB');
    expect(container.textContent).toContain('4854');
    // An over-plan bucket must not draw a 310%-wide bar.
    expect(one(container, '.home-meter-bar').style.width).toBe('100%');
    expect(one(container, '.home-meter-bar').className).toContain('home-meter-bar--warn');
  });
});
