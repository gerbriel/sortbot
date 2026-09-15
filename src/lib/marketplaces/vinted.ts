/**
 * marketplaces/vinted — listing pack only.
 *
 * Vinted's condition scale bottoms out at "Satisfactory": there is no word for
 * a garment in poor condition, so `poor` maps up to the lowest grade Vinted
 * offers. That is the one place in this folder where the mapping is lossy, and
 * it is lossy in the safe direction only because the description carries the
 * flaws — which is why `flaws` is surfaced as an attribute here.
 */

import { baseFormat, compactAttributes } from './shared';
import type {
  FormattedListing, ListingInput, MarketplaceAdapter, MarketplaceSpec,
} from './types';

/** Vinted's colour picker. FROM MEMORY — confirm before `verified`. */
const VINTED_COLORS = [
  'Black', 'Brown', 'Grey', 'Beige', 'Pink', 'Purple', 'Red', 'Yellow',
  'Blue', 'Green', 'Orange', 'White', 'Silver', 'Gold', 'Navy', 'Burgundy',
  'Khaki', 'Turquoise', 'Cream', 'Coral', 'Mustard', 'Multi',
] as const;

export const spec: MarketplaceSpec = {
  key: 'vinted',
  name: 'Vinted',
  channels: ['pack'],
  title: { max: 60 },
  description: { max: 3000, format: 'plain' },
  photos: { min: 1, max: 20 },
  tags: { max: 0, style: 'none' },
  brand: { controlled: true, fallback: null },
  color: { controlled: true, values: VINTED_COLORS, fallback: 'Multi' },
  condition: {
    values: ['New with tags', 'New without tags', 'Very good', 'Good', 'Satisfactory'],
    map: {
      new_with_tags: 'New with tags',
      new_without_tags: 'New without tags',
      excellent: 'Very good',
      good: 'Good',
      fair: 'Satisfactory',
      poor: 'Satisfactory',   // Vinted has no lower grade — the flaws go in the text.
    },
  },
  category: { kind: 'taxonomy' },
  docsUrl: 'https://www.vinted.com/help/79-how-do-i-list-an-item',
  verified: false,
};

const DEPARTMENT: Readonly<Record<string, string>> = { Men: 'Men', Women: 'Women', Kids: 'Kids' };

export function format(input: ListingInput): FormattedListing {
  const base = baseFormat(spec, input);
  const { item } = input;
  return {
    ...base,
    attributes: compactAttributes({
      Department: item.gender ? DEPARTMENT[item.gender] ?? '' : '',
      Material: item.material,
      // `poor` was rounded up to Satisfactory — say what is wrong with it.
      Flaws: item.flaws,
      'Package size': item.parcelSize,
    }),
  };
}

export const adapter: MarketplaceAdapter = {
  key: 'vinted',
  spec,
  validate: (input) => format(input).issues,
  format,
};

export default adapter;
