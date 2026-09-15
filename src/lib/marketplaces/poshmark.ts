/**
 * marketplaces/poshmark — listing pack only.
 *
 * Poshmark has no import, no bulk upload and no public listing API, and its
 * terms forbid automating the app. That is not a gap in this adapter — it is
 * the reason the "pack" channel exists: the seller opens Poshmark, and every
 * field is already written, cut to Poshmark's limits, one tap to copy.
 *
 * Brand and colour both come from Poshmark's own pickers, which is where
 * "Forest green" silently becomes whatever Poshmark feels like — so both go
 * through the controlled-vocabulary resolver.
 */

import { baseFormat, compactAttributes } from './shared';
import type {
  FormattedListing, ListingInput, MarketplaceAdapter, MarketplaceSpec,
} from './types';

/** Poshmark's colour picker. FROM MEMORY — confirm before `verified`. */
const POSHMARK_COLORS = [
  'Black', 'Blue', 'Brown', 'Cream', 'Gold', 'Gray', 'Green',
  'Orange', 'Pink', 'Purple', 'Red', 'Silver', 'Tan', 'White', 'Yellow',
] as const;

export const spec: MarketplaceSpec = {
  key: 'poshmark',
  name: 'Poshmark',
  channels: ['pack'],
  title: { max: 80 },
  description: { max: 1500, format: 'plain' },
  photos: { min: 1, max: 16 },
  tags: { max: 0, style: 'none' },
  brand: { controlled: true, fallback: null },
  color: { controlled: true, values: POSHMARK_COLORS, fallback: null },
  condition: {
    values: ['NWT', 'NWOT', 'Pre-owned'],
    map: {
      new_with_tags: 'NWT',
      new_without_tags: 'NWOT',
      excellent: 'Pre-owned',
      good: 'Pre-owned',
      fair: 'Pre-owned',
      poor: 'Pre-owned',
    },
  },
  category: { kind: 'path' },
  docsUrl: 'https://support.poshmark.com/s/article/How-do-I-list-an-item',
  verified: false,
};

/** Poshmark files everything under a department first. Unisex has no home
 *  there, so it is left for the seller rather than guessed into Men's. */
const DEPARTMENT: Readonly<Record<string, string>> = { Men: 'Men', Women: 'Women', Kids: 'Kids' };

export function format(input: ListingInput): FormattedListing {
  const base = baseFormat(spec, input);
  const { item } = input;
  return {
    ...base,
    attributes: compactAttributes({
      Department: item.gender ? DEPARTMENT[item.gender] ?? '' : '',
      // Poshmark shows this struck through beside the price.
      'Original price': base.compareAtPrice !== null ? base.compareAtPrice.toFixed(2) : '',
      'Style tags': (item.tags ?? []).slice(0, 3).join(', '),
    }),
  };
}

export const adapter: MarketplaceAdapter = {
  key: 'poshmark',
  spec,
  validate: (input) => format(input).issues,
  format,
};

export default adapter;
