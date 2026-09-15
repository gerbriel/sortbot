/**
 * marketplaces/whatnot — bulk-listing CSV plus a pack.
 *
 * ⚠️ THE COLUMN LIST IS NOT CONFIRMED. Whatnot publishes a bulk-upload
 * template to sellers; `WHATNOT_COLUMNS` reproduces its documented shape from
 * memory. Same rule as Depop: it is ONE CONSTANT, so a correction is a one-line
 * edit and a snapshot update, and `spec.verified` stays false until it is
 * checked against a template downloaded from a real seller account.
 *
 * Two columns the app cannot fill and must not guess:
 *   Shipping Profile — named per seller inside Whatnot; left blank.
 *   Sub Category     — Whatnot's own taxonomy; comes from the workspace's
 *                      vocabulary or not at all.
 */

import { baseFormat, compactAttributes, feedDate, toCsv } from './shared';
import type {
  FormattedListing, ListingInput, MarketplaceAdapter, MarketplaceSpec,
  SerializeOptions, SerializedFeed,
} from './types';

export const spec: MarketplaceSpec = {
  key: 'whatnot',
  name: 'Whatnot',
  channels: ['feed', 'pack'],
  title: { max: 80 },
  description: { max: 2000, format: 'plain' },
  photos: { min: 1, max: 12 },
  tags: { max: 0, style: 'none' },
  brand: { controlled: false, fallback: null },
  color: { controlled: false, fallback: null },
  condition: {
    // The plan's table says free text, so the canonical labels go through
    // unchanged rather than being squeezed into someone else's scale.
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
  category: { kind: 'taxonomy' },
  docsUrl: 'https://help.whatnot.com/hc/en-us/articles/8919868545805',
  verified: false,
};

/** ⚠️ UNCONFIRMED — see the module comment. */
export const WHATNOT_COLUMNS = [
  'Category', 'Sub Category', 'Title', 'Description', 'Quantity', 'Type',
  'Price', 'Shipping Profile', 'Offerable', 'Hazmat', 'Condition',
  'Cost Per Item', 'SKU',
  'Image URL 1', 'Image URL 2', 'Image URL 3', 'Image URL 4', 'Image URL 5', 'Image URL 6',
  'Image URL 7', 'Image URL 8', 'Image URL 9', 'Image URL 10', 'Image URL 11', 'Image URL 12',
] as const;

export function format(input: ListingInput): FormattedListing {
  const base = baseFormat(spec, input);
  const { item } = input;
  return {
    ...base,
    attributes: compactAttributes({
      'Sub Category': item.productType,
      Quantity: String(item.inventoryQuantity ?? 1),
      // Every listing here is one-of-one vintage — an auction is a decision the
      // seller makes per stream, not something an export should assume.
      Type: 'Buy it Now',
      Offerable: 'FALSE',
      Hazmat: 'Not Hazmat',
      'Cost Per Item': item.costPerItem !== undefined ? String(item.costPerItem) : '',
      'Shipping Profile': '',
    }),
  };
}

export function serialize(
  listings: readonly FormattedListing[],
  opts?: SerializeOptions,
): SerializedFeed {
  const photoCount = spec.photos.max;
  const rows = listings.map(l => {
    const a = l.attributes;
    return [
      l.category ?? '',
      a['Sub Category'] ?? '',
      l.title,
      l.description,
      a.Quantity ?? '1',
      a.Type ?? 'Buy it Now',
      l.price !== null ? l.price.toFixed(2) : '',
      a['Shipping Profile'] ?? '',
      a.Offerable ?? 'FALSE',
      a.Hazmat ?? 'Not Hazmat',
      l.condition ?? '',
      a['Cost Per Item'] ?? '',
      l.sku ?? '',
      ...Array.from({ length: photoCount }, (_, i) => l.photos[i] ?? ''),
    ];
  });

  return {
    filename: `whatnot-listings-${feedDate(opts?.date)}.csv`,
    mime: 'text/csv;charset=utf-8',
    body: toCsv(WHATNOT_COLUMNS, rows),
    count: listings.length,
  };
}

export const adapter: MarketplaceAdapter = {
  key: 'whatnot',
  spec,
  validate: (input) => format(input).issues,
  format,
  serialize,
};

export default adapter;
