/**
 * marketplaces/grailed — listing pack only.
 *
 * Grailed calls the brand a DESIGNER and will not accept one that is not in
 * its list, so brand is controlled and an unresolved one is a readiness
 * warning rather than a silent "Other" — on Grailed more than anywhere, the
 * designer IS the listing.
 */

import { baseFormat, compactAttributes } from './shared';
import type {
  FormattedListing, ListingInput, MarketplaceAdapter, MarketplaceSpec,
} from './types';

export const spec: MarketplaceSpec = {
  key: 'grailed',
  name: 'Grailed',
  channels: ['pack'],
  title: { max: 60 },
  description: { max: 5000, format: 'plain' },
  photos: { min: 1, max: 25 },
  tags: { max: 0, style: 'none' },
  brand: { controlled: true, fallback: null },
  color: { controlled: false, fallback: null },
  condition: {
    // The plan's table says "5-step" but names four; four is what Grailed's
    // listing form shows. Confirm before `verified`.
    values: ['New', 'Gently used', 'Used', 'Very worn'],
    map: {
      new_with_tags: 'New',
      new_without_tags: 'New',
      excellent: 'Gently used',
      good: 'Used',
      fair: 'Used',
      poor: 'Very worn',
    },
  },
  category: { kind: 'taxonomy' },
  docsUrl: 'https://www.grailed.com/drycleanonly/how-to-sell-on-grailed',
  verified: false,
};

/** Grailed splits the site in two before anything else. Unisex is left blank
 *  rather than defaulted into Menswear. */
const DEPARTMENT: Readonly<Record<string, string>> = { Men: 'Menswear', Women: 'Womenswear' };

export function format(input: ListingInput): FormattedListing {
  const base = baseFormat(spec, input);
  const { item } = input;
  return {
    ...base,
    attributes: compactAttributes({
      Designer: base.brand,
      Department: item.gender ? DEPARTMENT[item.gender] ?? '' : '',
      Material: item.material,
      // Grailed buyers filter by era harder than any other marketplace here.
      Era: item.era,
    }),
  };
}

export const adapter: MarketplaceAdapter = {
  key: 'grailed',
  spec,
  validate: (input) => format(input).issues,
  format,
};

export default adapter;
