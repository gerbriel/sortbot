import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { act } from 'react';
import LabelPrintView from './LabelPrintView';
import { mount, cleanup, all, one, click, buttonByText } from './ui/testUtils';
import type { ClothingItem } from '../App';

/**
 * The label sheet reads the workspace's settings for two things: the custom
 * label stocks (offered after the built-ins) and the barcode convention (EAN-13
 * symbology when the workspace prints GS1 in-store numbers). Only the network
 * is mocked; the encoders and the template list run for real.
 */

vi.mock('../lib/descriptionSettings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/descriptionSettings')>();
  return { ...actual, getOrgDescriptionSettings: vi.fn() };
});

vi.mock('../lib/labelsService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/labelsService')>();
  return { ...actual, fetchLabelsForProducts: vi.fn(), ensureSkus: vi.fn() };
});

vi.mock('../lib/productSearchService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/productSearchService')>();
  return { ...actual, fetchListing: vi.fn() };
});

import { getOrgDescriptionSettings, DEFAULT_DESCRIPTION_SETTINGS } from '../lib/descriptionSettings';
import { fetchLabelsForProducts, ensureSkus } from '../lib/labelsService';
import { DEFAULT_CODE_SETTINGS } from '../lib/codeSettings';
import { labelTemplateFromInput, labelTemplateToInput, LABEL_TEMPLATES } from '../lib/labelTemplates';
import { workflowStore } from '../lib/workflowStore';

const item = (over: Partial<ClothingItem>): ClothingItem => ({
  id: 'a',
  productGroup: 'a',
  seoTitle: 'Levi\'s 501 jeans',
  size: '32',
  price: 48,
  category: 'Denim',
  ...over,
} as ClothingItem);

const CUSTOM = labelTemplateFromInput(
  { ...labelTemplateToInput(LABEL_TEMPLATES[0]), name: 'Shelf tag', note: 'Our own stock' },
  'custom-shelf',
);

async function render(orgId: string | null = 'org-1') {
  const view = mount(<LabelPrintView orgId={orgId} />);
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
  return view;
}

beforeEach(() => {
  workflowStore.reset();
  workflowStore.setState({
    processedItems: [
      item({ id: 'a', productGroup: 'a', sku: 'ACD-00012', barcode: '2000000000121' }),
      item({ id: 'b', productGroup: 'b', seoTitle: 'Carhartt jacket', sku: '', barcode: '' }),
    ],
  });
  vi.mocked(fetchLabelsForProducts).mockResolvedValue({ status: 'ok', byProduct: {} });
  vi.mocked(getOrgDescriptionSettings).mockResolvedValue(DEFAULT_DESCRIPTION_SETTINGS);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  workflowStore.reset();
});

describe('LabelPrintView', () => {
  it('offers the workspace custom stocks after the built-ins', async () => {
    vi.mocked(getOrgDescriptionSettings).mockResolvedValue({ ...DEFAULT_DESCRIPTION_SETTINGS, labelTemplates: [CUSTOM] });
    const { container } = await render();
    expect(getOrgDescriptionSettings).toHaveBeenCalledWith('org-1');
    const options = all(container, '.lpv-control select option').map(o => o.textContent);
    expect(options).toEqual([...LABEL_TEMPLATES.map(t => t.name), 'Shelf tag']);
    expect(container.textContent).toContain('Codes follow the workspace convention.');
  });

  it('prints Code 128 of the SKU by default', async () => {
    const { container } = await render();
    const code = one(container, '.lpv-label .lpv-barcode');
    expect(code.className).not.toContain('lpv-barcode--ean');
    expect(code.innerHTML).toContain('<svg');
    expect(code.innerHTML).toContain('ACD-00012');
  });

  it('prints EAN-13 with the SKU under it when the workspace uses in-store numbers', async () => {
    vi.mocked(getOrgDescriptionSettings).mockResolvedValue({
      ...DEFAULT_DESCRIPTION_SETTINGS,
      codes: { ...DEFAULT_CODE_SETTINGS, skuScheme: 'sequential', barcodeMode: 'ean13_store' },
    });
    const { container } = await render();
    const code = one(container, '.lpv-label .lpv-barcode--ean');
    expect(code.innerHTML).toContain('<svg');
    expect(code.innerHTML).toContain('Barcode 2000000000121');
    expect(one(code, '.lpv-label-sku').textContent).toBe('ACD-00012');
  });

  it('assigns missing SKUs under the workspace convention, with categories', async () => {
    const codes = { ...DEFAULT_CODE_SETTINGS, skuPrefix: 'RCK', categoryCode: true };
    vi.mocked(getOrgDescriptionSettings).mockResolvedValue({ ...DEFAULT_DESCRIPTION_SETTINGS, codes });
    vi.mocked(ensureSkus).mockResolvedValue({ status: 'ok', skus: { b: 'RCK-DEN-7K3Q9M' } });
    const { container } = await render();
    await act(async () => { click(buttonByText(container, 'Assign SKUs to selected (1)')); await Promise.resolve(); });
    expect(ensureSkus).toHaveBeenCalledWith(['b'], { settings: codes, orgId: 'org-1', categories: { b: 'Denim' } });
    expect(container.textContent).toContain('Assigned 1 SKU.');
  });

  it('uses the defaults with no workspace and reads nothing', async () => {
    const { container } = await render(null);
    expect(getOrgDescriptionSettings).not.toHaveBeenCalled();
    expect(all(container, '.lpv-control select option')).toHaveLength(LABEL_TEMPLATES.length);
  });
});
