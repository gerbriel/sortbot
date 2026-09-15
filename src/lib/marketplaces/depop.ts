/**
 * marketplaces/depop — bulk-listing CSV (verified sellers) plus a pack.
 *
 * ⚠️ THE COLUMN LIST IS NOT CONFIRMED. Depop's bulk upload is granted per
 * seller and its template is not published openly, so `DEPOP_COLUMNS` below is
 * built from the fields Depop's own listing form collects. It is ONE CONSTANT
 * on purpose: correcting it against the real template is a one-line edit plus
 * a snapshot update, and nothing else in the adapter moves. Until then the
 * pack channel is the one to trust, and `spec.verified` stays false.
 *
 * Depop's five hashtags are the discovery surface — they are reserved out of
 * the 1,000-character description budget before the body is cut.
 */

import { baseFormat, compactAttributes, decadeFromEra, feedDate, toCsv } from './shared';
import type {
  FormattedListing, ListingInput, MarketplaceAdapter, MarketplaceSpec,
  SerializeOptions, SerializedFeed,
} from './types';

export const spec: MarketplaceSpec = {
  key: 'depop',
  name: 'Depop',
  channels: ['feed', 'pack'],
  title: { max: 60 },
  description: { max: 1000, format: 'plain' },
  photos: { min: 1, max: 8 },
  tags: { max: 5, maxLength: 20, style: 'hashtags' },
  brand: { controlled: true, fallback: null },
  color: { controlled: false, fallback: null },
  condition: {
    // Six canonical grades into five Depop words: `poor` doubles up on
    // "Used - fair", which is the lowest grade Depop offers.
    values: ['Brand new', 'Like new', 'Used - excellent', 'Used - good', 'Used - fair'],
    map: {
      new_with_tags: 'Brand new',
      new_without_tags: 'Like new',
      excellent: 'Used - excellent',
      good: 'Used - good',
      fair: 'Used - fair',
      poor: 'Used - fair',
    },
  },
  category: { kind: 'taxonomy' },
  docsUrl: 'https://depophelp.zendesk.com/hc/en-gb/articles/360001740108',
  verified: false,
};

/** ⚠️ UNCONFIRMED — see the module comment. One constant, one edit to fix. */
export const DEPOP_COLUMNS = [
  'sku', 'title', 'description', 'hashtags', 'category', 'subcategory',
  'brand', 'colour', 'condition', 'size', 'style', 'source', 'age',
  'price', 'currency',
  'photo_1', 'photo_2', 'photo_3', 'photo_4', 'photo_5', 'photo_6', 'photo_7', 'photo_8',
] as const;

/** Depop's "Source" field — where the garment came from. Only claimed when the
 *  listing says so; guessing "Vintage" onto a modern piece is a false claim. */
function sourceOf(item: { era?: string; style?: string }): string {
  const t = `${item.era ?? ''} ${item.style ?? ''}`.toLowerCase();
  if (/deadstock/.test(t)) return 'Deadstock';
  if (/vintage/.test(t)) return 'Vintage';
  if (/thrift/.test(t)) return 'Thrifted';
  return '';
}

export function format(input: ListingInput): FormattedListing {
  const base = baseFormat(spec, input);
  const { item } = input;
  return {
    ...base,
    attributes: compactAttributes({
      style: item.style,
      source: sourceOf(item),
      age: decadeFromEra(item.era),
      subcategory: item.productType,
      currency: 'USD',
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
      l.sku ?? '',
      l.title,
      l.description,
      l.tags.join(' '),
      l.category ?? '',
      a.subcategory ?? '',
      l.brand ?? '',
      l.color ?? '',
      l.condition ?? '',
      l.size ?? '',
      a.style ?? '',
      a.source ?? '',
      a.age ?? '',
      l.price !== null ? l.price.toFixed(2) : '',
      a.currency ?? 'USD',
      ...Array.from({ length: photoCount }, (_, i) => l.photos[i] ?? ''),
    ];
  });

  return {
    filename: `depop-listings-${feedDate(opts?.date)}.csv`,
    mime: 'text/csv;charset=utf-8',
    body: toCsv(DEPOP_COLUMNS, rows),
    count: listings.length,
  };
}

export const adapter: MarketplaceAdapter = {
  key: 'depop',
  spec,
  validate: (input) => format(input).issues,
  format,
  serialize,
};

export default adapter;
