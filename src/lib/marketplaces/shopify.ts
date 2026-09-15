/**
 * marketplaces/shopify — the adapter that already existed.
 *
 * `src/lib/csvExport.ts` is the Shopify adapter in all but name: pure, golden-
 * tested, 54 columns, taxonomy maps, the formula-injection guard. This file
 * gives it the adapter shape WITHOUT touching it — `serialize` calls
 * `buildShopifyCsv` verbatim, so the golden snapshot in
 * `src/lib/__snapshots__/csvExport.test.ts.snap` stays byte-identical and the
 * Shopify import path this shop runs its business on does not move.
 *
 * `format` exists so Shopify appears in the cross-listing matrix and the
 * readiness checklist beside the other nine. The CSV does not read it.
 */

import type { ClothingItem } from '../../App';
import {
  buildShopifyCsv, canonicalTaxonomyPath, resolveCategoryPath, resolveProductType,
  type ExportProduct,
} from '../csvExport';
import { baseFormat, compactAttributes, feedDate, issue } from './shared';
import type {
  FormattedListing, ListingInput, MarketplaceAdapter, MarketplaceSpec,
  ReadinessIssue, SerializeOptions, SerializedFeed,
} from './types';

export const spec: MarketplaceSpec = {
  key: 'shopify',
  name: 'Shopify',
  channels: ['feed'],
  title: { max: 255 },
  description: { max: 65535, format: 'html' },
  photos: { min: 1, max: 250 },
  tags: { max: 250, maxLength: 255, style: 'tags' },
  // Shopify's Vendor column carries the SELLER (AGENTS.md §18 #37), so the
  // garment's brand is free text in a metafield and nothing is controlled.
  brand: { controlled: false, fallback: null },
  color: { controlled: false, fallback: null },
  condition: {
    values: ['New with tags', 'New without tags', 'Excellent', 'Good', 'Fair', 'Poor'],
    map: {
      new_with_tags: 'New with tags',
      new_without_tags: 'New without tags',
      excellent: 'Excellent',
      good: 'Good',
      fair: 'Fair',
      poor: 'Poor',
    },
  },
  category: { kind: 'path' },
  docsUrl: 'https://help.shopify.com/en/manual/products/import-export/using-csv',
  verified: false,
};

export function format(input: ListingInput): FormattedListing {
  const base = baseFormat(spec, input);
  const { item } = input;
  const issues: ReadinessIssue[] = [...base.issues];

  // The exact rule buildShopifyCsvRows uses, so the matrix shows what the file
  // will contain: a preset's full taxonomy path wins (canonicalised, and only
  // when Shopify actually knows it), otherwise the category-name maps.
  const catKey = item.category?.toLowerCase() ?? '';
  const presetType = (item.shopifyProductType || '').trim();
  const presetIsPath = presetType.includes('>');
  const presetPath = presetIsPath ? canonicalTaxonomyPath(presetType) : '';
  const productCategory = presetPath || resolveCategoryPath(catKey);
  const productType =
    (presetIsPath ? (presetPath ? presetPath.split('>').pop()!.trim() : '') : presetType)
    || resolveProductType(catKey);

  if (item.category && !productCategory) {
    issues.push(issue(spec, 'warning', 'category',
      `"${item.category}" has no Shopify taxonomy path — the Product Category column will be blank.`,
      { value: item.category, fixKind: 'category' }));
  }

  return {
    ...base,
    category: productCategory || null,
    issues,
    attributes: compactAttributes({
      vendor: input.vendorName,
      productType,
      productCategory,
    }),
    // The 54 columns need ~30 fields no marketplace-shaped listing carries.
    source: item,
  };
}

/**
 * The Shopify import CSV, produced by the existing builder.
 *
 * The price rule was already applied by `format`, so `buildShopifyCsv` is
 * called with NO pricing rule — applying it twice would compound the
 * adjustment, and a +13% eBay rule shipped twice is +27.7% on every listing.
 * `compareAtPrice` arrives already resolved (emitted only when it is above the
 * price actually charged), and the builder's own `compare > sale` check agrees.
 */
export function serialize(
  listings: readonly FormattedListing[],
  opts?: SerializeOptions,
): SerializedFeed {
  const products: ExportProduct[] = listings.map(l => ({
    ...((l.source ?? ({} as ClothingItem)) as ClothingItem),
    seoTitle: l.title,
    price: l.price ?? undefined,
    compareAtPrice: l.compareAtPrice ?? undefined,
    imageUrls: [...l.photos],
    imageCount: l.photos.length,
  }));
  // One workspace per export, so the first listing that carries a vendor name
  // speaks for the file — the column is the shop, not the garment.
  const vendorName = listings.find(l => l.attributes.vendor)?.attributes.vendor;

  return {
    filename: `shopify-products-${feedDate(opts?.date)}.csv`,
    mime: 'text/csv;charset=utf-8',
    body: buildShopifyCsv(products, undefined, vendorName, null),
    count: listings.length,
  };
}

export const adapter: MarketplaceAdapter = {
  key: 'shopify',
  spec,
  validate: (input) => format(input).issues,
  format,
  serialize,
};

export default adapter;
