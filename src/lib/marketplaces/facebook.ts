/**
 * marketplaces/facebook — Meta Commerce Manager catalog feed, plus a pack.
 *
 * The catalog feed is a flat CSV with NINE REQUIRED COLUMNS (id, title,
 * description, availability, condition, price, link, image_link, brand). A row
 * missing one of them is rejected on upload — silently, in a summary screen
 * nobody reads — so the missing ones are `error`s here, not warnings.
 *
 * `link` is deliberately blank. It is the product's page on the seller's own
 * site and this shop has none; Commerce Manager accepts the row and the item
 * checks out inside Facebook. If the workspace ever gets a storefront, this is
 * the one column to fill.
 */

import { baseFormat, compactAttributes, feedDate, toCsv } from './shared';
import type {
  FormattedListing, ListingInput, MarketplaceAdapter, MarketplaceSpec,
  ReadinessIssue, SerializeOptions, SerializedFeed,
} from './types';

export const spec: MarketplaceSpec = {
  key: 'facebook',
  name: 'Facebook',
  channels: ['feed', 'pack'],
  title: { max: 150 },
  description: { max: 5000, format: 'plain' },
  photos: { min: 1, max: 20 },
  tags: { max: 0, style: 'none' },
  // `brand` is required, and "Unbranded" is a value the catalog accepts — an
  // empty one loses the row.
  brand: { controlled: false, fallback: 'Unbranded' },
  // The CATALOG FEED's colour column is free text (Marketplace's own listing
  // form has a picker, but that is a different surface and not what this feed
  // uploads to). Confirm before `verified`.
  color: { controlled: false, fallback: null },
  condition: {
    values: ['new', 'refurbished', 'used'],
    map: {
      new_with_tags: 'new',
      new_without_tags: 'new',
      excellent: 'used',
      good: 'used',
      fair: 'used',
      poor: 'used',
    },
  },
  category: { kind: 'taxonomy', fallback: 'Apparel & Accessories > Clothing' },
  docsUrl: 'https://www.facebook.com/business/help/120325381656392',
  verified: false,
};

/** Facebook's `gender`: the three values the catalog accepts. Kids' clothing
 *  carries its department in `age_group`, not here. */
const GENDER: Readonly<Record<string, string>> = {
  Men: 'male', Women: 'female', Unisex: 'unisex', Kids: 'unisex',
};

/** `age_group`: adult / kids / toddler / infant / newborn / all ages. */
function ageGroup(item: { ageGroup?: string; gender?: string }): string {
  const t = `${item.ageGroup ?? ''}`.toLowerCase();
  if (/newborn/.test(t)) return 'newborn';
  if (/infant|baby/.test(t)) return 'infant';
  if (/toddler/.test(t)) return 'toddler';
  if (/kid|child|youth|junior/.test(t)) return 'kids';
  if (/adult/.test(t)) return 'adult';
  if (item.gender === 'Kids') return 'kids';
  return t ? '' : 'adult';
}

/** The catalog's column order. */
export const FACEBOOK_COLUMNS = [
  'id', 'title', 'description', 'availability', 'condition', 'price', 'link',
  'image_link', 'brand', 'additional_image_link', 'google_product_category',
  'color', 'size', 'gender', 'age_group', 'product_type',
] as const;

export function format(input: ListingInput): FormattedListing {
  const base = baseFormat(spec, input);
  const { item } = input;

  // A required column that is blank costs the whole row, so the condition
  // warning every other adapter raises is an error here.
  const issues: ReadinessIssue[] = base.issues.map(i => {
    if (i.field !== 'condition') return i;
    return {
      ...i,
      level: 'error' as const,
      message: i.value
        ? `Condition "${i.value}" is not one of ${spec.condition.values.join(' / ')} — Facebook rejects the catalog row.`
        : `No condition set — Facebook's catalog requires ${spec.condition.values.join(' / ')} and rejects the row without it.`,
    };
  });

  return {
    ...base,
    issues,
    attributes: compactAttributes({
      id: base.sku || base.productGroupId,
      availability: 'in stock',
      // No storefront to link to — see the module comment.
      link: '',
      gender: item.gender ? GENDER[item.gender] ?? '' : '',
      age_group: ageGroup(item),
      product_type: item.productType || item.category,
      google_product_category: base.category ?? '',
    }),
  };
}

export function serialize(
  listings: readonly FormattedListing[],
  opts?: SerializeOptions,
): SerializedFeed {
  const rows = listings.map(l => {
    const a = l.attributes;
    return [
      a.id ?? l.productGroupId,
      l.title,
      l.description,
      a.availability ?? 'in stock',
      l.condition ?? '',
      // Facebook wants the currency in the cell, not a separate column.
      l.price !== null ? `${l.price.toFixed(2)} USD` : '',
      a.link ?? '',
      l.photos[0] ?? '',
      l.brand ?? '',
      l.photos.slice(1).join(','),
      a.google_product_category ?? '',
      l.color ?? '',
      l.size ?? '',
      a.gender ?? '',
      a.age_group ?? '',
      a.product_type ?? '',
    ];
  });

  return {
    filename: `facebook-catalog-${feedDate(opts?.date)}.csv`,
    mime: 'text/csv;charset=utf-8',
    body: toCsv(FACEBOOK_COLUMNS, rows),
    count: listings.length,
  };
}

export const adapter: MarketplaceAdapter = {
  key: 'facebook',
  spec,
  validate: (input) => format(input).issues,
  format,
  serialize,
};

export default adapter;
