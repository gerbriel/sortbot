import { describe, it, expect } from 'vitest';
import { adapter, spec, format, serialize } from './shopify';
import { buildShopifyCsv, type ExportProduct } from '../csvExport';
import { fullInput, sparseInput, snapshotOf, FULL_PHOTOS, FULL_GROUP } from './fixtures';
import { coalesceGroup } from './shared';

/**
 * The Shopify adapter must not change the Shopify export. `serialize` calls
 * `buildShopifyCsv` verbatim, and the test below proves the output is the same
 * string the exporter would have produced — the 54-column golden in
 * `src/lib/__snapshots__/csvExport.test.ts.snap` is untouched by this folder.
 */

describe('shopify spec', () => {
  it('is a feed, and not verified until the limits are checked', () => {
    expect(spec.channels).toEqual(['feed']);
    expect(spec.verified).toBe(false);
    expect(adapter.serialize).toBeDefined();
  });
});

describe('shopify format', () => {
  it('golden — a fully populated listing', () => {
    expect(snapshotOf(format(fullInput()))).toMatchSnapshot();
  });

  it('golden — a sparse listing (no price, no brand, one photo, unreadable condition)', () => {
    expect(snapshotOf(format(sparseInput()))).toMatchSnapshot();
  });

  it('resolves the Shopify taxonomy path the CSV will carry', () => {
    const out = format(fullInput());
    expect(out.category).toBe('Apparel & Accessories > Clothing > Clothing Tops > Sweatshirts');
    expect(out.attributes.productType).toBe('Sweatshirts');
  });

  it('warns when a category has no Shopify taxonomy path instead of exporting a blank column', () => {
    const input = fullInput();
    const out = format({ ...input, item: { ...input.item, category: 'not-a-real-category' } });
    expect(out.category).toBeNull();
    expect(out.issues).toContainEqual(expect.objectContaining({
      field: 'category', level: 'warning', value: 'not-a-real-category', fixKind: 'category',
    }));
  });

  it('carries the seller name as the Vendor, never the garment brand (AGENTS.md §18 #37)', () => {
    const out = format(fullInput());
    expect(out.attributes.vendor).toBe('C&D Vintage');
    expect(out.brand).toBe('Nike');
  });

  it('carries `source` — the 54 columns need fields no formatted listing holds', () => {
    expect(format(fullInput()).source?.weightValue).toBe('600');
  });
});

describe('shopify serialize', () => {
  it('produces exactly what buildShopifyCsv would have produced', () => {
    const listing = format(fullInput());
    const expected = buildShopifyCsv([{
      ...coalesceGroup(FULL_GROUP),
      seoTitle: listing.title,
      price: 45,
      compareAtPrice: 60,
      imageUrls: [...FULL_PHOTOS],
      imageCount: 3,
    } as ExportProduct], undefined, 'C&D Vintage', null);
    expect(serialize([listing], { date: '2026-09-15' }).body).toBe(expected);
  });

  it('names the file with the injected date', () => {
    const feed = serialize([format(fullInput())], { date: '2026-09-15' });
    expect(feed.filename).toBe('shopify-products-2026-09-15.csv');
    expect(feed.mime).toBe('text/csv;charset=utf-8');
    expect(feed.count).toBe(1);
  });

  it('does NOT apply the price rule a second time', () => {
    // format() already adjusted; buildShopifyCsv is called with no rule, or a
    // +13% marketplace would ship +27.7%.
    const rule = { id: 'ebay', name: 'eBay', enabled: true, adjustment: { type: 'percent' as const, value: 13 }, rounding: 'none' as const, applyToCompareAt: false };
    const listing = format(fullInput({ pricingRule: rule }));
    expect(listing.price).toBe(50.85);
    expect(serialize([listing], { date: '2026-09-15' }).body).toContain('50.85');
    expect(serialize([listing], { date: '2026-09-15' }).body).not.toContain('57.46');
  });

  it('golden — the full CSV for one listing', () => {
    expect(serialize([format(fullInput())], { date: '2026-09-15' })).toMatchSnapshot();
  });
});
