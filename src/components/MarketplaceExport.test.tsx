import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { act } from 'react';
import MarketplaceExport, { type MarketplaceExportProps } from './MarketplaceExport';
import { mount, cleanup, click, one, all, buttonByText } from './ui/testUtils';
import { FULL_GROUP, SPARSE_GROUP } from '../lib/marketplaces/fixtures';
import {
  fetchBatchTargets, fetchOrgMarketplaces, fetchPublications, fetchVocab,
  setBatchTargets, upsertPublication, upsertVocab,
  type OrgMarketplaceRow,
} from '../lib/marketplaceService';
import type { ClothingItem } from '../App';

/**
 * The Step 4 panel is where the adapters, the service and the grid arithmetic
 * finally meet, and none of the three can prove the meeting happened. Only the
 * network functions are mocked — `buildGroupArray`, `coalesceGroup`, all ten
 * adapters, `buildListingPack` and `summarizeMatrix` run for real, which is what
 * makes the counts below mean something.
 *
 * The fixtures are the adapters' own (`marketplaces/fixtures.ts`), so a column
 * that reads "1 blocked" here is blocked for exactly the reason the adapter
 * golden says it is: the sparse listing has no price.
 */

vi.mock('../lib/marketplaceService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/marketplaceService')>();
  return {
    ...actual,
    fetchOrgMarketplaces: vi.fn(),
    fetchVocab: vi.fn(),
    fetchBatchTargets: vi.fn(),
    fetchPublications: vi.fn(),
    setBatchTargets: vi.fn(),
    upsertVocab: vi.fn(),
    upsertPublication: vi.fn(),
  };
});

const ORG = 'a0000000-0000-0000-0000-00000000000a';
const BATCH = 'b0000000-0000-0000-0000-00000000000b';

const enabledRow = (marketplace: OrgMarketplaceRow['marketplace']): OrgMarketplaceRow => ({
  org_id: ORG, marketplace, enabled: true, settings: {},
});

/** Three photos in one group (the FULL fixture) plus one uncategorised-but-
 *  categorised single (SPARSE) — two listings, which is what the grid renders. */
const ITEMS = [...FULL_GROUP, ...SPARSE_GROUP] as ClothingItem[];

const props: MarketplaceExportProps = {
  orgId: ORG,
  batchId: BATCH,
  items: ITEMS,
  vendorName: 'C&D Vintage',
  descriptionSettings: null,
  isOrgAdmin: true,
  onToast: () => {},
  onOpenWorkspaceMarketplaces: () => {},
};

async function render(over: Partial<typeof props> = {}) {
  const view = mount(<MarketplaceExport {...props} {...over} />);
  // Two awaits: one for Promise.all in the loader, one for the setState flush.
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  return view;
}

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

beforeEach(() => {
  vi.mocked(fetchOrgMarketplaces).mockResolvedValue({
    status: 'ok',
    rows: [enabledRow('shopify'), enabledRow('ebay'), enabledRow('poshmark')],
  });
  vi.mocked(fetchVocab).mockResolvedValue({ status: 'ok', rows: [] });
  vi.mocked(fetchBatchTargets).mockResolvedValue({ status: 'ok', targets: [] });
  vi.mocked(fetchPublications).mockResolvedValue({ status: 'ok', rows: [] });
  vi.mocked(setBatchTargets).mockResolvedValue({ ok: true });
  vi.mocked(upsertVocab).mockResolvedValue({ ok: true });
  vi.mocked(upsertPublication).mockResolvedValue({ ok: true });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('MarketplaceExport', () => {
  it('shows the setup hint, and nothing else, when the migration has not run', async () => {
    vi.mocked(fetchOrgMarketplaces).mockResolvedValue({ status: 'unavailable' });
    const { container } = await render();
    expect(container.textContent).toContain('marketplaces.sql');
    expect(container.querySelector('.mkx-matrix')).toBeNull();
    expect(container.querySelector('.mkx-targets')).toBeNull();
  });

  it('points at the workspace dashboard when the shop has enabled nothing', async () => {
    vi.mocked(fetchOrgMarketplaces).mockResolvedValue({ status: 'ok', rows: [] });
    let opened = 0;
    const { container } = await render({ onOpenWorkspaceMarketplaces: () => { opened++; } });
    expect(container.textContent).toContain('No marketplaces chosen yet');
    expect(container.querySelector('.mkx-matrix')).toBeNull();
    click(buttonByText(container, 'Choose marketplaces'));
    expect(opened).toBe(1);
  });

  it('an empty stored target list renders every ENABLED marketplace as a column, in key order', async () => {
    const { container } = await render();
    expect(all(container, '.mkx-mk-head .mkx-mk-name').map(n => n.textContent))
      .toEqual(['Shopify', 'eBay', 'Poshmark']);
    // The target chips are the workspace's enabled set, all pressed.
    const chips = all(container, '.mkx-targets [aria-pressed]');
    expect(chips.map(c => c.textContent)).toEqual(['Shopify', 'eBay', 'Poshmark']);
    expect(chips.every(c => c.getAttribute('aria-pressed') === 'true')).toBe(true);
  });

  it('honours an explicit stored target list', async () => {
    vi.mocked(fetchBatchTargets).mockResolvedValue({ status: 'ok', targets: ['poshmark'] });
    const { container } = await render();
    expect(all(container, '.mkx-mk-head .mkx-mk-name').map(n => n.textContent)).toEqual(['Poshmark']);
    expect(all(container, '.mkx-targets [aria-pressed="true"]').map(c => c.textContent)).toEqual(['Poshmark']);
  });

  it('renders one row per listing with the right cell level in each column', async () => {
    const { container } = await render();
    const rows = all(container, '.mkx-matrix tbody tr');
    expect(rows).toHaveLength(2);
    // Groups come first (buildGroupArray), so row 1 is the three-photo listing.
    expect(one(rows[0], '.mkx-listing-title').textContent)
      .toContain('Vintage 90s Nike Grey Embroidered Swoosh Crewneck Sweatshirt');
    expect(one(rows[0], '.mkx-listing-sku').textContent).toBe('ACD-7K2M9Q');
    expect(one(rows[1], '.mkx-listing-sku').textContent).toBe('no SKU');

    const level = (tr: HTMLElement) =>
      all(tr, '.mkx-cell').map(td => (td.className.match(/mkx-cell--(\w+)/) ?? [])[1]);
    // Full listing: Shopify clean, eBay + Poshmark warn (category / brand).
    expect(level(rows[0])).toEqual(['clean', 'warning', 'warning']);
    // Sparse listing has no price — an error everywhere.
    expect(level(rows[1])).toEqual(['error', 'error', 'error']);
  });

  it('counts each column in the readiness checklist and blocks the blocked one', async () => {
    const { container } = await render();
    const checks = all(container, '.mkx-check');
    expect(checks.map(c => one(c, 'h4').textContent)).toEqual(['Shopify', 'eBay', 'Poshmark']);
    expect(one(checks[0], '.mkx-counts').textContent).toContain('1 ready');
    expect(one(checks[0], '.mkx-counts').textContent).toContain('1 blocked');
    expect(one(checks[1], '.mkx-counts').textContent).toContain('0 ready');
    // Every adapter's limits are still unverified (01-adapters.md §3), said once
    // per marketplace rather than once per listing.
    expect(all(container, '.mkx-provisional')).toHaveLength(3);
  });

  it('offers a feed download per feed marketplace, blocked while a listing errors — and never a second Shopify CSV', async () => {
    const { container } = await render();
    const heads = all(container, '.mkx-mk-head');
    // Shopify's column defers to GoogleSheetExporter below.
    expect(one(heads[0], '.mkx-mk-note').textContent).toBe('Download below');
    expect(heads[0].querySelector('button')).toBeNull();
    // eBay is pack-only; Poshmark is pack-only. Neither offers a CSV.
    expect(heads[1].textContent).not.toContain('CSV');
    // Both offer packs.
    expect(buttonByText(heads[1], 'Open packs')).toBeTruthy();
  });

  it('downloads a feed CSV and records every listing as exported', async () => {
    vi.mocked(fetchOrgMarketplaces).mockResolvedValue({ status: 'ok', rows: [enabledRow('facebook')] });
    // Only the full listing — the sparse one has no price, which blocks the feed.
    const { container } = await render({ items: [...FULL_GROUP] as ClothingItem[] });
    const clicks: Array<{ download: string }> = [];
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = realCreate(tag);
      if (tag === 'a') {
        el.click = () => clicks.push({ download: (el as HTMLAnchorElement).download });
      }
      return el;
    });
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();

    click(buttonByText(one(container, '.mkx-mk-head'), 'Facebook CSV'));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(clicks[0].download).toMatch(/^facebook-catalog-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(vi.mocked(upsertPublication)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(upsertPublication).mock.calls[0][0]).toMatchObject({
      marketplace: 'facebook', status: 'exported', productGroupId: 'grp-1', priceCents: 4500,
    });
    vi.mocked(document.createElement).mockRestore();
  });

  it('refuses the feed while any listing has an error for that marketplace', async () => {
    vi.mocked(fetchOrgMarketplaces).mockResolvedValue({ status: 'ok', rows: [enabledRow('facebook')] });
    const { container } = await render();       // both listings — the sparse one has no price
    const button = buttonByText(one(container, '.mkx-mk-head'), 'Facebook CSV');
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.getAttribute('title')).toContain('error');
  });

  it('turning a target off persists the explicit list, and the last one cannot be turned off', async () => {
    const said: string[] = [];
    const { container } = await render({ onToast: (m: string) => { said.push(m); } });
    click(one(container, '.mkx-targets [aria-pressed]'));       // Shopify off
    await act(async () => { await Promise.resolve(); });
    expect(vi.mocked(setBatchTargets)).toHaveBeenCalledWith(BATCH, ['ebay', 'poshmark']);

    vi.mocked(fetchBatchTargets).mockResolvedValue({ status: 'ok', targets: ['ebay'] });
    const solo = await render({ onToast: (m: string) => { said.push(m); } });
    vi.mocked(setBatchTargets).mockClear();
    click(one(solo.container, '.mkx-targets [aria-pressed="true"]'));
    await act(async () => { await Promise.resolve(); });
    expect(vi.mocked(setBatchTargets)).not.toHaveBeenCalled();
    expect(said.some(m => m.includes('at least one marketplace'))).toBe(true);
  });

  it('a "Remember" save writes a WORKSPACE vocabulary row and re-reads the vocabulary', async () => {
    vi.mocked(fetchBatchTargets).mockResolvedValue({ status: 'ok', targets: ['poshmark'] });
    const { container } = await render();
    // Poshmark's brand picker does not know "Nike" until the shop maps it.
    const fixes = all(container, '.mkx-fix');
    expect(fixes.length).toBeGreaterThan(0);
    expect(one(fixes[0], '.mkx-fix-label').textContent).toContain('Nike');

    setValue(one(fixes[0], '.mkx-fix-input'), 'NIKE');
    click(buttonByText(fixes[0], 'Save'));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(vi.mocked(upsertVocab)).toHaveBeenCalledWith({
      orgId: ORG, marketplace: 'poshmark', kind: 'brand',
      canonical: 'Nike', marketplaceValue: 'NIKE',
    });
    // The matrix re-resolves off the refetched rows, so the vocabulary is read again.
    expect(vi.mocked(fetchVocab).mock.calls.length).toBeGreaterThan(1);
  });

  it('opens the listing packs for one marketplace, with a copy button per field', async () => {
    vi.mocked(fetchBatchTargets).mockResolvedValue({ status: 'ok', targets: ['poshmark'] });
    const { container } = await render();
    expect(container.querySelector('.mkx-packs')).toBeNull();
    click(buttonByText(one(container, '.mkx-mk-head'), 'Open packs'));
    const packs = all(container, '.mkx-pack');
    expect(packs).toHaveLength(2);
    const labels = all(packs[0], '.mkx-pack-field dt').map(dt => (dt.textContent ?? '').replace('Copy', '').trim());
    expect(labels).toContain('Title');
    expect(labels).toContain('Description');
    expect(labels).toContain('Price');
    // A field with no value is left out entirely, never shown as a dead button.
    expect(all(packs[0], '.mkx-pack-field dd').every(dd => (dd.textContent ?? '').trim() !== '')).toBe(true);
    // Three photos, in publish order, with a zip button.
    expect(all(packs[0], '.mkx-thumbs img')).toHaveLength(3);
    expect(buttonByText(packs[0], 'Download photos (zip)')).toBeTruthy();
  });

  it('"Mark posted" records the publication for that listing and marketplace only', async () => {
    vi.mocked(fetchBatchTargets).mockResolvedValue({ status: 'ok', targets: ['poshmark'] });
    const { container } = await render();
    click(buttonByText(one(container, '.mkx-mk-head'), 'Open packs'));
    click(buttonByText(all(container, '.mkx-pack')[0], 'Mark posted'));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(vi.mocked(upsertPublication)).toHaveBeenCalledTimes(1);
    const arg = vi.mocked(upsertPublication).mock.calls[0][0];
    expect(arg).toMatchObject({
      batchId: BATCH, productGroupId: 'grp-1', sku: 'ACD-7K2M9Q',
      marketplace: 'poshmark', status: 'posted', priceCents: 4500,
    });
    expect(typeof arg.postedAt).toBe('string');
  });

  it('shows the publication status already recorded for a cell', async () => {
    vi.mocked(fetchBatchTargets).mockResolvedValue({ status: 'ok', targets: ['poshmark'] });
    vi.mocked(fetchPublications).mockResolvedValue({
      status: 'ok',
      rows: [{
        id: 'p1', batch_id: BATCH, product_group_id: 'grp-1', sku: 'ACD-7K2M9Q',
        marketplace: 'poshmark', status: 'live', external_id: null, url: null,
        price_cents: 4500, posted_at: null, sold_at: null,
      }],
    });
    const { container } = await render();
    const rows = all(container, '.mkx-matrix tbody tr');
    expect(one(rows[0], '.mkx-cell').textContent).toContain('live');
    expect(rows[1].querySelector('.ui-badge')).toBeNull();
  });

  it('says so, and renders no grid, when the batch has no listings', async () => {
    const { container } = await render({ items: [] });
    expect(container.textContent).toContain('No listings in this batch yet');
    expect(container.querySelector('.mkx-matrix')).toBeNull();
    // The targets row stays — choosing where a batch goes does not need listings.
    expect(all(container, '.mkx-targets [aria-pressed]')).toHaveLength(3);
  });
});
