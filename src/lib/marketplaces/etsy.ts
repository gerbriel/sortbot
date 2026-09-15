/**
 * marketplaces/etsy — listing pack today, Open API v3 later (plan phase 3).
 *
 * Etsy is the only one of the ten that polices WHAT may be sold: an item is
 * listed as vintage only if it is 20+ years old, and every listing must declare
 * who made it, when, and whether it is a supply. Those three answers are
 * `who_made` / `when_made` / `is_supply`, and the app already collects them as
 * `whoMadeIt` / `era` / `whatIsIt` (they come from the category preset), so the
 * adapter's job is translation, not invention.
 *
 * Tags are the other half: 13 of them, 20 characters each, and they are what
 * Etsy search runs on.
 */

import { baseFormat, compactAttributes, decadeFromEra, issue } from './shared';
import type {
  FormattedListing, ListingInput, MarketplaceAdapter, MarketplaceSpec, ReadinessIssue,
} from './types';

export const spec: MarketplaceSpec = {
  key: 'etsy',
  name: 'Etsy',
  channels: ['pack'],
  title: { max: 140 },
  description: { max: 13000, format: 'plain' },
  photos: { min: 1, max: 10 },
  tags: { max: 13, maxLength: 20, style: 'tags' },
  brand: { controlled: false, fallback: null },
  color: { controlled: false, fallback: null },
  condition: {
    // Etsy has no condition scale — an item is new, vintage, or handmade, and
    // wear is described in the listing text. The map exists so the matrix has
    // a word for every grade; everything used maps to "Vintage" because that
    // is what this shop sells and what Etsy files it under.
    values: ['New', 'Vintage', 'Handmade'],
    map: {
      new_with_tags: 'New',
      new_without_tags: 'New',
      excellent: 'Vintage',
      good: 'Vintage',
      fair: 'Vintage',
      poor: 'Vintage',
    },
  },
  category: { kind: 'taxonomy' },
  docsUrl: 'https://help.etsy.com/hc/en-us/articles/115015628847-What-Can-Be-Sold-on-Etsy',
  verified: false,
};

/** Etsy's `when_made` decade slugs, from the app's free-text era. */
function whenMade(era: string | undefined): string {
  const decade = decadeFromEra(era);
  if (!decade) return '';
  const year = Number(decade.slice(0, 4));
  if (!Number.isFinite(year)) return '';
  // Etsy buckets everything before 1920 rather than listing each decade.
  if (year < 1920) return 'before_1920';
  return decade;
}

export function format(input: ListingInput): FormattedListing {
  const base = baseFormat(spec, input);
  const { item } = input;
  const issues: ReadinessIssue[] = [...base.issues];

  const whoMade = /\bi\s+(made|did)\b/i.test(item.whoMadeIt ?? '') ? 'i_did' : 'someone_else';
  const isSupply = /\bsupply|supplies\b/i.test(item.whatIsIt ?? '');
  const when = whenMade(item.era);
  if (!when) {
    issues.push(issue(spec, 'warning', 'era',
      'Etsy needs a "when made" decade — set the era so the listing can be filed as vintage.',
      { value: item.era ?? '' }));
  }

  return {
    ...base,
    issues,
    attributes: compactAttributes({
      who_made: whoMade,
      when_made: when,
      is_supply: isSupply ? 'true' : 'false',
      materials: item.material,
      // Etsy's own "Item type" reads better as the garment type than as the
      // workspace's internal category key ("mens-tees").
      item_type: item.productType || item.category,
    }),
  };
}

export const adapter: MarketplaceAdapter = {
  key: 'etsy',
  spec,
  validate: (input) => format(input).issues,
  format,
};

export default adapter;
