/**
 * marketplaces/mercari — listing pack only.
 *
 * The tightest title in the set: 40 characters, which is roughly "Vintage Nike
 * Grey Crewneck Sweatshirt L" and nothing else. `cutTitle` guarantees it ends
 * on a word, because a Mercari title cut mid-word is the first thing a buyer
 * sees.
 *
 * Mercari's three hashtags go in the description, so they are reserved out of
 * the 1,000-character budget before the body is cut — never truncated away.
 */

import { baseFormat, compactAttributes } from './shared';
import type {
  FormattedListing, ListingInput, MarketplaceAdapter, MarketplaceSpec,
} from './types';

export const spec: MarketplaceSpec = {
  key: 'mercari',
  name: 'Mercari',
  channels: ['pack'],
  title: { max: 40 },
  description: { max: 1000, format: 'plain' },
  photos: { min: 1, max: 12 },
  tags: { max: 3, maxLength: 20, style: 'hashtags' },
  brand: { controlled: true, fallback: null },
  color: { controlled: false, fallback: null },
  condition: {
    values: ['New', 'Like new', 'Good', 'Fair', 'Poor'],
    map: {
      new_with_tags: 'New',
      new_without_tags: 'New',
      excellent: 'Like new',
      good: 'Good',
      fair: 'Fair',
      poor: 'Poor',
    },
  },
  category: { kind: 'taxonomy' },
  docsUrl: 'https://www.mercari.com/help_center/article/369/',
  verified: false,
};

export function format(input: ListingInput): FormattedListing {
  const base = baseFormat(spec, input);
  const { item } = input;
  return {
    ...base,
    attributes: compactAttributes({
      Material: item.material,
      // Mercari's shipping calculator is driven by weight, and the app already
      // stores grams (never the unit the preset's dropdown said).
      'Weight (g)': item.weightValue,
      'Package size': item.parcelSize,
    }),
  };
}

export const adapter: MarketplaceAdapter = {
  key: 'mercari',
  spec,
  validate: (input) => format(input).issues,
  format,
};

export default adapter;
