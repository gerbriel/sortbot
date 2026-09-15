import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { act } from 'react';
import ProductsView from './ProductsView';
import { mount, cleanup, click, one, all, buttonByText } from './ui/testUtils';
import { searchProducts, fetchListing, fetchBatchNames, type ProductListing } from '../lib/productSearchService';
import {
  fetchLabels, fetchLabelsForProducts, countLabelUsage, ensureSkus, setProductCodes,
} from '../lib/labelsService';
import { syncGroupFieldsToDatabase } from '../lib/productService';

/**
 * ProductsView is where a listing is edited from OUTSIDE the workflow, so the
 * three things that could quietly corrupt data all live here: which rows a save
 * is addressed to, what a cleared price becomes, and whether a rejected SKU is
 * shown to the user or swallowed. Only the network functions are mocked; the
 * component's own reduction, draft seeding and patch building run for real.
 */

vi.mock('../lib/productSearchService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/productSearchService')>();
  return {
    ...actual,
    searchProducts: vi.fn(),
    fetchListing: vi.fn(),
    fetchBatchNames: vi.fn(),
    clearBatchNameCache: vi.fn(),
  };
});

vi.mock('../lib/labelsService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/labelsService')>();
  return {
    ...actual,
    fetchLabels: vi.fn(),
    fetchLabelsForProducts: vi.fn(),
    countLabelUsage: vi.fn(),
    ensureSkus: vi.fn(),
    setProductCodes: vi.fn(),
    updateLabel: vi.fn(),
    deleteLabel: vi.fn(),
  };
});

vi.mock('../lib/productService', () => ({ syncGroupFieldsToDatabase: vi.fn() }));

/* The picker owns its own fetching and its own three-state chip logic, both of
   which are covered by labelsService.test.ts. Stubbing it keeps this file about
   the page rather than about a child's network. */
vi.mock('./ListingLabelsPicker', () => ({
  default: ({ productIds }: { productIds: string[] }) => (
    <div data-testid="picker">{productIds.join(',')}</div>
  ),
}));

const listing = (over: Partial<ProductListing> = {}): ProductListing => ({
  id: 'lead',
  groupId: 'lead',
  memberIds: ['lead', 'm2'],
  title: 'Carhartt Detroit Jacket',
  brand: 'Carhartt',
  size: 'L',
  color: 'Brown',
  category: 'outerwear',
  productType: '',
  condition: 'Good',
  price: 145,
  sku: '',
  barcode: '',
  batchId: 'batch-1',
  updatedAt: '2026-09-10T00:00:00Z',
  photos: ['https://cdn.test/lead/0.jpg'],
  ...over,
});

/** Set a controlled field through the prototype setter, or React's value
 *  tracker swallows the change (same helper as FinanceView.test.tsx). */
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

const onOpenInWorkflow = vi.fn();
const onListingEdited = vi.fn();

async function render(currentBatchId: string | null = 'batch-1') {
  const view = mount(
    <ProductsView
      userId="user-1"
      currentBatchId={currentBatchId}
      onOpenInWorkflow={onOpenInWorkflow}
      onListingEdited={onListingEdited}
    />,
  );
  await settle();
  return view;
}

/** Let the chain of awaited loads inside the effects run out. */
async function settle() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
}

/** The control inside the `.pv-field` whose label reads `name`. Looking fields
 *  up by their visible label rather than by index means re-ordering the form
 *  cannot silently make a test assert about a different column. */
function field(container: HTMLElement, name: string): HTMLElement {
  const match = all(container, '.pv-field').find(
    f => (f.querySelector('span')?.textContent ?? '').trim() === name,
  );
  if (!match) throw new Error(`field(): no field labelled "${name}"`);
  return one(match, 'input, select');
}

/** Open the first row and let the detail read land. */
async function openFirstRow(container: HTMLElement) {
  click(one(container, '.pv-row'));
  await settle();
}

beforeEach(() => {
  vi.mocked(searchProducts).mockResolvedValue({
    status: 'ok', listings: [listing()], rowCount: 2, truncated: false,
  });
  vi.mocked(fetchListing).mockResolvedValue({ status: 'ok', listing: listing() });
  vi.mocked(fetchBatchNames).mockResolvedValue(new Map([['batch-1', 'Spring drop']]));
  vi.mocked(fetchLabels).mockResolvedValue({ status: 'ok', labels: [] });
  vi.mocked(fetchLabelsForProducts).mockResolvedValue({ status: 'ok', byProduct: {} });
  vi.mocked(countLabelUsage).mockResolvedValue({ status: 'ok', counts: {}, complete: true });
  vi.mocked(syncGroupFieldsToDatabase).mockResolvedValue(true);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ProductsView — finding', () => {
  it('lists each listing once, with its batch name and its missing SKU called out', async () => {
    const { container } = await render();
    const rows = all(container, '.pv-row');
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain('Carhartt Detroit Jacket');
    expect(rows[0].textContent).toContain('Spring drop');
    expect(rows[0].textContent).toContain('no SKU');
    expect(rows[0].textContent).toContain('$145.00');
  });

  it('opens with an empty query — the most recent work, not an empty box', async () => {
    await render();
    expect(vi.mocked(searchProducts)).toHaveBeenCalledWith('');
  });

  it('the SKU filter narrows the list without re-querying', async () => {
    vi.mocked(searchProducts).mockResolvedValue({
      status: 'ok',
      listings: [listing(), listing({ id: 'b', groupId: 'b', memberIds: ['b'], title: 'Tee', sku: 'ACD-ABC123' })],
      rowCount: 3, truncated: false,
    });
    const { container } = await render();
    expect(all(container, '.pv-row')).toHaveLength(2);
    const before = vi.mocked(searchProducts).mock.calls.length;
    click(buttonByText(container, 'With SKU'));
    expect(all(container, '.pv-row')).toHaveLength(1);
    expect(one(container, '.pv-row').textContent).toContain('ACD-ABC123');
    click(buttonByText(container, 'Without SKU'));
    expect(one(container, '.pv-row').textContent).toContain('Carhartt');
    expect(vi.mocked(searchProducts).mock.calls.length).toBe(before);
  });

  it('says so when nothing matches, rather than showing an empty list', async () => {
    vi.mocked(searchProducts).mockResolvedValue({ status: 'ok', listings: [], rowCount: 0, truncated: false });
    const { container } = await render();
    expect(one(container, '.pv-empty').textContent).toContain('No listings in this workspace yet');
  });

  it('surfaces a query failure instead of reporting zero matches', async () => {
    vi.mocked(searchProducts).mockResolvedValue({ status: 'error', error: 'permission denied' });
    const { container } = await render();
    expect(one(container, '.pv-warn').textContent).toContain('permission denied');
  });
});

describe('ProductsView — editing a listing', () => {
  it('seeds the form from the listing and hands the picker every photo id', async () => {
    const { container } = await render();
    await openFirstRow(container);
    expect((field(container, 'Title') as HTMLInputElement).value).toBe('Carhartt Detroit Jacket');
    expect((field(container, 'Brand') as HTMLInputElement).value).toBe('Carhartt');
    expect((field(container, 'Condition') as HTMLSelectElement).value).toBe('Good');
    expect((field(container, 'Price') as HTMLInputElement).value).toBe('145');
    // The picker applies a label to the whole LISTING, so it must get both rows.
    expect(one(container, '[data-testid="picker"]').textContent).toBe('lead,m2');
  });

  it('Save writes every member row through the same sync Step 3 uses', async () => {
    const { container } = await render();
    await openFirstRow(container);
    setValue(field(container, 'Brand'), 'Carhartt WIP');
    await act(async () => { click(buttonByText(container, 'Save fields')); await Promise.resolve(); });

    expect(syncGroupFieldsToDatabase).toHaveBeenCalledTimes(1);
    const [items, batchId, userId] = vi.mocked(syncGroupFieldsToDatabase).mock.calls[0];
    expect(items.map(i => i.id)).toEqual(['lead', 'm2']);
    // Every stand-in carries the group id, so the sync finds the same leader
    // Step 3 and handleOpenBatch do.
    expect(items.every(i => i.productGroup === 'lead')).toBe(true);
    expect(items[0].brand).toBe('Carhartt WIP');
    expect(batchId).toBe('batch-1');
    expect(userId).toBe('user-1');
  });

  it('a cleared price is saved as null, never 0', async () => {
    // 0 is what the export gate reads as "priced at nothing" and what the
    // restore merge would then serve back forever.
    const { container } = await render();
    await openFirstRow(container);
    setValue(field(container, 'Price'), '');
    await act(async () => { click(buttonByText(container, 'Save fields')); await Promise.resolve(); });
    const [items] = vi.mocked(syncGroupFieldsToDatabase).mock.calls[0];
    expect((items[0] as unknown as { price: unknown }).price).toBeNull();
  });

  it('refuses a price that is not a number, and writes nothing', async () => {
    const { container } = await render();
    await openFirstRow(container);
    setValue(field(container, 'Price'), 'forty');
    await act(async () => { click(buttonByText(container, 'Save fields')); await Promise.resolve(); });
    expect(syncGroupFieldsToDatabase).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Price must be a number');
  });

  it('tells App about a successful save so the open batch can be mirrored', async () => {
    const { container } = await render();
    await openFirstRow(container);
    await act(async () => { click(buttonByText(container, 'Save fields')); await Promise.resolve(); });
    expect(onListingEdited).toHaveBeenCalledTimes(1);
    const [batchId, groupId, patch] = vi.mocked(onListingEdited).mock.calls[0];
    expect(batchId).toBe('batch-1');
    expect(groupId).toBe('lead');
    expect(patch.seoTitle).toBe('Carhartt Detroit Jacket');
  });

  it('a refused save is shown and NOT mirrored into the workflow', async () => {
    // syncGroupFieldsToDatabase resolves `false` rather than throwing when RLS
    // refuses — reporting that as success is the silent-loss bug this guards.
    vi.mocked(syncGroupFieldsToDatabase).mockResolvedValue(false);
    const { container } = await render();
    await openFirstRow(container);
    await act(async () => { click(buttonByText(container, 'Save fields')); await Promise.resolve(); });
    expect(container.textContent).toContain('Could not save');
    expect(onListingEdited).not.toHaveBeenCalled();
  });

  it('Open in workflow hands App the listing AND the batch it lives in', async () => {
    const { container } = await render('other-batch');
    await openFirstRow(container);
    click(buttonByText(container, 'Open in workflow'));
    expect(onOpenInWorkflow).toHaveBeenCalledWith('lead', 'batch-1');
  });

  it('offers no way in for a listing that is in no batch', async () => {
    vi.mocked(searchProducts).mockResolvedValue({
      status: 'ok', listings: [listing({ batchId: null })], rowCount: 1, truncated: false,
    });
    vi.mocked(fetchListing).mockResolvedValue({ status: 'ok', listing: listing({ batchId: null }) });
    const { container } = await render();
    await openFirstRow(container);
    expect(container.textContent).toContain('Not in a batch');
    expect(() => buttonByText(container, 'Open in workflow')).toThrow();
  });
});

describe('ProductsView — barcodes', () => {
  it('Generate SKU mints one for the LEADER row and shows the code', async () => {
    vi.mocked(ensureSkus).mockResolvedValue({ status: 'ok', skus: { lead: 'ACD-7H2K9M' } });
    const { container } = await render();
    await openFirstRow(container);
    await act(async () => { click(buttonByText(container, 'Generate SKU')); await Promise.resolve(); });
    // The leader is the row the scanner and the printed label read.
    expect(ensureSkus).toHaveBeenCalledWith(['lead']);
    expect((field(container, 'SKU') as HTMLInputElement).value).toBe('ACD-7H2K9M');
    // And the barcode preview is now a real Code 128 drawn from it.
    expect(one(container, '.pv-barcode-preview').innerHTML).toContain('<svg');
  });

  it('a duplicate SKU is shown in words, not swallowed', async () => {
    vi.mocked(setProductCodes).mockResolvedValue({
      ok: false, error: 'That SKU is already used by another listing in this workspace.',
    });
    const { container } = await render();
    await openFirstRow(container);
    setValue(field(container, 'SKU'), 'ACD-TAKEN1');
    await act(async () => { click(buttonByText(container, 'Save codes')); await Promise.resolve(); });
    expect(setProductCodes).toHaveBeenCalledWith('lead', { sku: 'ACD-TAKEN1', barcode: '' });
    expect(container.textContent).toContain('already used');
  });

  it('Save codes stays disabled until a code actually changed', async () => {
    const { container } = await render();
    await openFirstRow(container);
    expect((buttonByText(container, 'Save codes') as HTMLButtonElement).disabled).toBe(true);
    setValue(field(container, 'Barcode'), '012345678905');
    expect((buttonByText(container, 'Save codes') as HTMLButtonElement).disabled).toBe(false);
  });

  it('Print label is unavailable without a SKU — a label with no barcode cannot be scanned', async () => {
    const { container } = await render();
    await openFirstRow(container);
    expect((buttonByText(container, 'Print label') as HTMLButtonElement).disabled).toBe(true);
    expect(container.querySelector('.pv-print-wrap')).toBeNull();
  });

  it('renders the print sheet once a SKU is present, and only then', async () => {
    vi.mocked(fetchListing).mockResolvedValue({ status: 'ok', listing: listing({ sku: 'ACD-AAAAAA' }) });
    vi.mocked(searchProducts).mockResolvedValue({
      status: 'ok', listings: [listing({ sku: 'ACD-AAAAAA' })], rowCount: 2, truncated: false,
    });
    const { container } = await render();
    await openFirstRow(container);
    const sheet = one(container, '.pv-print-wrap');
    expect(sheet.textContent).toContain('Carhartt Detroit Jacket');
    expect(one(sheet, '.pv-print-code').innerHTML).toContain('<svg');
  });
});

describe('ProductsView — the label vocabulary', () => {
  it('lists each label with how many LISTINGS it is on, behind the disclosure', async () => {
    vi.mocked(fetchLabels).mockResolvedValue({
      status: 'ok',
      labels: [{ id: 'l1', name: 'bad kids club', color: 'violet', kind: 'custom', sort_order: 0 }],
    });
    vi.mocked(countLabelUsage).mockResolvedValue({ status: 'ok', counts: { l1: 12 }, complete: true });
    const { container } = await render();
    await openFirstRow(container);
    expect(container.querySelector('.pv-manage')).toBeNull();
    click(buttonByText(container, 'Manage labels'));
    await settle();
    expect(one(container, '.pv-manage').textContent).toContain('used on 12 listings');
  });

  it('deleting is two-step and says how many listings it will strip', async () => {
    vi.mocked(fetchLabels).mockResolvedValue({
      status: 'ok',
      labels: [{ id: 'l1', name: 'repair', color: 'red', kind: 'custom', sort_order: 0 }],
    });
    vi.mocked(countLabelUsage).mockResolvedValue({ status: 'ok', counts: { l1: 3 }, complete: true });
    const { container } = await render();
    await openFirstRow(container);
    click(buttonByText(container, 'Manage labels'));
    await settle();
    // Nothing is destroyed by the first click — that is the whole point of the
    // primitive that replaced confirm() (§18 #12).
    click(buttonByText(container, 'Delete'));
    expect(container.textContent).toContain('remove it from 3 listings');
  });

  it('hides the whole labels surface pre-migration', async () => {
    vi.mocked(fetchLabels).mockResolvedValue({ status: 'unavailable' });
    const { container } = await render();
    await openFirstRow(container);
    expect(container.textContent).toContain('listing_labels');
    expect(container.querySelector('[data-testid="picker"]')).toBeNull();
  });
});
