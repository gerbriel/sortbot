/**
 * marketplaces/ebay — listing pack today, Sell API later (plan phase 3).
 *
 * eBay has no tag field at all: discovery runs on ITEM SPECIFICS, the
 * structured name/value pairs under the description. A vintage tee with
 * Department, Size Type, Style and Decade filled in is findable; the same tee
 * with a beautiful description and no specifics is not. So this adapter's real
 * work is `attributes` — everything the app already knows, in eBay's names.
 */

import { baseFormat, compactAttributes, decadeFromEra } from './shared';
import type {
  FormattedListing, ListingInput, MarketplaceAdapter, MarketplaceSpec,
} from './types';

export const spec: MarketplaceSpec = {
  key: 'ebay',
  name: 'eBay',
  channels: ['pack'],
  title: { max: 80 },
  description: { max: 500000, format: 'html' },
  photos: { min: 1, max: 24 },
  tags: { max: 0, style: 'none' },
  // Free text is accepted, but "Unbranded" is eBay's own documented value for
  // a garment with no label — better than an empty Brand specific, which drops
  // the listing out of every brand-filtered search.
  brand: { controlled: false, fallback: 'Unbranded' },
  color: { controlled: false, fallback: null },
  condition: {
    values: ['New with tags', 'New without tags', 'New with defects', 'Pre-owned'],
    map: {
      new_with_tags: 'New with tags',
      new_without_tags: 'New without tags',
      excellent: 'Pre-owned',
      good: 'Pre-owned',
      fair: 'Pre-owned',
      poor: 'Pre-owned',
    },
  },
  // A numeric eBay category id — there is no way to guess one, so an unmapped
  // category is a readiness warning the workspace fixes once per category.
  category: { kind: 'taxonomy' },
  docsUrl: 'https://www.ebay.com/help/selling/listings/creating-managing-listings/item-specifics',
  verified: false,
};

/** eBay's Department values for clothing. */
const DEPARTMENT: Readonly<Record<string, string>> = {
  Men: 'Men', Women: 'Women', Unisex: 'Unisex Adults', Kids: 'Kids',
};

/** The app's size types in eBay's spelling ("Plus Size" is just "Plus"). */
const SIZE_TYPE: Readonly<Record<string, string>> = {
  Regular: 'Regular', 'Big & Tall': 'Big & Tall', Petite: 'Petite',
  'Plus Size': 'Plus', 'One Size': 'One Size',
};

export function format(input: ListingInput): FormattedListing {
  const base = baseFormat(spec, input);
  const { item } = input;
  const isVintage = /vintage/i.test(`${item.era ?? ''} ${item.style ?? ''}`);

  return {
    ...base,
    attributes: compactAttributes({
      Brand: base.brand,
      Department: item.gender ? DEPARTMENT[item.gender] : '',
      Size: base.size,
      'Size Type': item.sizeType ? SIZE_TYPE[item.sizeType] : '',
      Style: item.style,
      Type: item.productType,
      Color: base.color,
      Material: item.material,
      Decade: decadeFromEra(item.era),
      Vintage: isVintage ? 'Yes' : '',
      MPN: item.mpn,
    }),
  };
}

export const adapter: MarketplaceAdapter = {
  key: 'ebay',
  spec,
  validate: (input) => format(input).issues,
  format,
};

export default adapter;
