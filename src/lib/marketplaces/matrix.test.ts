import { describe, it, expect } from 'vitest';
import {
  BACKGROUND_REVIEW_MESSAGE,
  cellSummary, effectiveTargets, fixableIssues, nextTargets,
  summarizeMarketplace, summarizeMatrix, withBackgroundIssues,
} from './matrix';
import type { FormattedListing, MarketplaceKey, ReadinessIssue } from './types';

/**
 * The rules Step 4's grid is built on, tested away from React because the
 * component has no harness that can count a column.
 *
 * The "empty targets means all enabled" rule is the load-bearing one: it is a
 * product decision `marketplaces.sql` deliberately left open (02-data.md §7.3),
 * and getting it wrong shows either an empty panel or a set of targets the
 * seller did not pick.
 */

const issue = (o: Partial<ReadinessIssue> & { field: string }): ReadinessIssue => ({
  marketplace: 'ebay',
  level: 'warning',
  message: `${o.field} problem`,
  ...o,
});

const listing = (id: string, issues: ReadinessIssue[]): FormattedListing => ({
  marketplace: 'ebay',
  productGroupId: id,
  sku: null,
  title: 't',
  description: 'd',
  tags: [],
  category: null,
  brand: null,
  color: null,
  condition: null,
  size: null,
  price: 1,
  compareAtPrice: null,
  photos: [],
  attributes: {},
  issues,
});

describe('effectiveTargets', () => {
  it('reads an empty stored list as every enabled marketplace', () => {
    expect(effectiveTargets([], ['ebay', 'depop'])).toEqual(['ebay', 'depop']);
    expect(effectiveTargets(null, ['ebay', 'depop'])).toEqual(['ebay', 'depop']);
    expect(effectiveTargets(undefined, ['poshmark'])).toEqual(['poshmark']);
  });

  it('honours an explicit list', () => {
    expect(effectiveTargets(['depop'], ['ebay', 'depop', 'poshmark'])).toEqual(['depop']);
  });

  it('always returns MARKETPLACE_KEYS order, not click order', () => {
    // Stored the other way round; rendered Shopify-first regardless.
    expect(effectiveTargets(['whatnot', 'shopify', 'ebay'], ['whatnot', 'ebay', 'shopify']))
      .toEqual(['shopify', 'ebay', 'whatnot']);
  });

  it('drops a target the workspace has since disabled', () => {
    expect(effectiveTargets(['ebay', 'depop'], ['ebay'])).toEqual(['ebay']);
  });

  it('falls back to all enabled when every stored target was disabled', () => {
    // Otherwise the panel renders no columns at all and says nothing.
    expect(effectiveTargets(['depop'], ['ebay', 'poshmark'])).toEqual(['ebay', 'poshmark']);
  });

  it('is empty when the workspace has enabled nothing', () => {
    expect(effectiveTargets(['ebay'], [])).toEqual([]);
  });
});

describe('nextTargets', () => {
  it('turns the implicit "all" into an explicit list minus the clicked one', () => {
    const enabled: MarketplaceKey[] = ['shopify', 'ebay', 'depop'];
    const current = effectiveTargets([], enabled);
    expect(nextTargets(current, 'ebay', enabled)).toEqual(['shopify', 'depop']);
  });

  it('adds a target back', () => {
    expect(nextTargets(['shopify'], 'depop', ['shopify', 'ebay', 'depop']))
      .toEqual(['shopify', 'depop']);
  });

  it('REFUSES to turn off the last remaining target', () => {
    expect(nextTargets(['ebay'], 'ebay', ['shopify', 'ebay'])).toBeNull();
  });

  it('refuses a marketplace the workspace has not enabled', () => {
    expect(nextTargets(['ebay'], 'vinted', ['shopify', 'ebay'])).toBeNull();
  });

  it('writes in MARKETPLACE_KEYS order whatever order the chips were clicked in', () => {
    expect(nextTargets(['whatnot', 'ebay'], 'shopify', ['shopify', 'ebay', 'whatnot']))
      .toEqual(['shopify', 'ebay', 'whatnot']);
  });
});

describe('cellSummary', () => {
  it('counts each level', () => {
    expect(cellSummary(listing('a', [
      issue({ field: 'brand' }), issue({ field: 'size' }), issue({ field: 'price', level: 'error' }),
    ]))).toEqual({ level: 'error', errors: 1, warnings: 2 });
  });

  it('an error outranks any number of warnings', () => {
    expect(cellSummary(listing('a', [issue({ field: 'price', level: 'error' })])).level).toBe('error');
  });

  it('no issues is clean, and a missing listing does not throw', () => {
    expect(cellSummary(listing('a', []))).toEqual({ level: 'clean', errors: 0, warnings: 0 });
    expect(cellSummary(null)).toEqual({ level: 'clean', errors: 0, warnings: 0 });
  });
});

describe('summarizeMarketplace', () => {
  it('splits listings into clean / warning / error and blocks on any error', () => {
    const s = summarizeMarketplace('ebay', [
      listing('a', []),
      listing('b', [issue({ field: 'size' })]),
      listing('c', [issue({ field: 'price', level: 'error' }), issue({ field: 'size' })]),
    ]);
    expect(s).toMatchObject({ listings: 3, clean: 1, warning: 1, error: 1, blocked: true });
  });

  it('is not blocked when every issue is a warning', () => {
    const s = summarizeMarketplace('ebay', [listing('a', [issue({ field: 'size' })])]);
    expect(s.blocked).toBe(false);
  });

  it('collapses the same problem across listings and counts them', () => {
    const s = summarizeMarketplace('ebay', [
      listing('a', [issue({ field: 'size', message: 'No size set.' })]),
      listing('b', [issue({ field: 'size', message: 'No size set.' })]),
      listing('c', []),
    ]);
    expect(s.issues).toHaveLength(1);
    expect(s.issues[0]).toMatchObject({ field: 'size', count: 2 });
  });

  it('keeps two unresolved VALUES apart — each needs its own mapping', () => {
    const s = summarizeMarketplace('poshmark', [
      listing('a', [issue({ field: 'brand', value: 'Ecko Unltd', fixKind: 'brand', message: 'x' })]),
      listing('b', [issue({ field: 'brand', value: 'Stussy', fixKind: 'brand', message: 'x' })]),
    ]);
    expect(s.issues.map(i => i.value)).toEqual(['Ecko Unltd', 'Stussy']);
    expect(s.issues.every(i => i.count === 1)).toBe(true);
  });

  it('folds the same value seen in different case into one fix row', () => {
    const s = summarizeMarketplace('poshmark', [
      listing('a', [issue({ field: 'color', value: 'Forest Green', fixKind: 'color', message: 'x' })]),
      listing('b', [issue({ field: 'color', value: 'forest green', fixKind: 'color', message: 'x' })]),
    ]);
    expect(s.issues).toHaveLength(1);
    expect(s.issues[0].count).toBe(2);
  });

  it('preserves the adapters own issue order', () => {
    const s = summarizeMarketplace('ebay', [
      listing('a', [
        issue({ field: 'price', level: 'error' }),
        issue({ field: 'photos' }),
        issue({ field: 'brand' }),
      ]),
    ]);
    expect(s.issues.map(i => i.field)).toEqual(['price', 'photos', 'brand']);
  });

  it('an empty column is all zeros, not a crash', () => {
    expect(summarizeMarketplace('etsy', [])).toMatchObject({
      listings: 0, clean: 0, warning: 0, error: 0, blocked: false, issues: [],
    });
  });
});

describe('summarizeMatrix', () => {
  it('returns one row per target, in target order, including empty ones', () => {
    const formatted = new Map<MarketplaceKey, FormattedListing[]>([
      ['ebay', [listing('a', [])]],
    ]);
    const rows = summarizeMatrix(['ebay', 'depop'], formatted);
    expect(rows.map(r => r.marketplace)).toEqual(['ebay', 'depop']);
    expect(rows[1].listings).toBe(0);
  });
});

describe('fixableIssues', () => {
  it('keeps only the issues a vocabulary row would fix', () => {
    const s = summarizeMarketplace('poshmark', [
      listing('a', [
        issue({ field: 'price', level: 'error' }),
        issue({ field: 'brand', value: 'Ecko Unltd', fixKind: 'brand', message: 'x' }),
        // A fixKind with no value cannot be mapped — there is nothing to type.
        issue({ field: 'condition', fixKind: 'condition', message: 'x' }),
      ]),
    ]);
    expect(fixableIssues(s).map(i => i.value)).toEqual(['Ecko Unltd']);
  });
});


/**
 * Photo backgrounds block a feed exactly as a $0 price blocks the Shopify CSV:
 * an `error`, therefore a blocked column, therefore no download. A photo that
 * FAILED to mat, or that a person chose to keep untouched, is a settled answer
 * and must not block anything.
 */
describe('withBackgroundIssues', () => {
  const clean = () => [listing('L1', []), listing('L2', []), listing('L3', [])];

  it('adds a blocking photos error only to the listings that have a waiting photo', () => {
    const out = withBackgroundIssues(clean(), new Map([['L2', 3]]));
    expect(out[0].issues).toEqual([]);
    expect(out[2].issues).toEqual([]);
    expect(out[1].issues).toEqual([{
      marketplace: 'ebay',
      level: 'error',
      field: 'photos',
      message: BACKGROUND_REVIEW_MESSAGE,
    }]);
  });

  it('adds it ONCE however many photos are waiting — the count belongs to the cell', () => {
    const out = withBackgroundIssues(clean(), new Map([['L1', 7]]));
    expect(out[0].issues.filter(i => i.field === 'photos')).toHaveLength(1);
  });

  it('keeps the adapter\'s own issues and appends after them', () => {
    const withBrand = [listing('L1', [issue({ field: 'brand', value: 'Ecko Unltd', fixKind: 'brand' })])];
    const out = withBackgroundIssues(withBrand, new Map([['L1', 1]]));
    expect(out[0].issues.map(i => i.field)).toEqual(['brand', 'photos']);
  });

  it('is a pure pass-through when nothing is waiting — the same array object', () => {
    const input = clean();
    expect(withBackgroundIssues(input, new Map())).toBe(input);
    const zeroed = withBackgroundIssues(input, new Map([['L1', 0]]));
    expect(zeroed[0].issues).toEqual([]);
  });

  it('never mutates the listing it was given', () => {
    const input = clean();
    withBackgroundIssues(input, new Map([['L1', 2]]));
    expect(input[0].issues).toEqual([]);
  });

  it('tags the issue with the listing\'s OWN marketplace, not a hardcoded one', () => {
    const depop: FormattedListing = { ...listing('L1', []), marketplace: 'depop' as MarketplaceKey };
    const [out] = withBackgroundIssues([depop], new Map([['L1', 1]]));
    expect(out.issues[0].marketplace).toBe('depop');
  });

  it('BLOCKS the column, exactly like the $0 price gate', () => {
    const summary = summarizeMarketplace('ebay', withBackgroundIssues(clean(), new Map([['L2', 1]])));
    expect(summary.blocked).toBe(true);
    expect(summary.error).toBe(1);
    expect(summary.clean).toBe(2);
  });

  it('turns the cell red rather than amber', () => {
    const [, l2] = withBackgroundIssues(clean(), new Map([['L2', 1]]));
    expect(cellSummary(l2).level).toBe('error');
  });

  it('collapses into ONE checklist line with a count — the message is a constant', () => {
    const summary = summarizeMarketplace(
      'ebay', withBackgroundIssues(clean(), new Map([['L1', 1], ['L2', 4], ['L3', 2]])));
    const photos = summary.issues.filter(i => i.field === 'photos');
    expect(photos).toHaveLength(1);
    expect(photos[0].count).toBe(3);
  });

  it('is not fixable by a vocabulary row — it has no fixKind', () => {
    const summary = summarizeMarketplace('ebay', withBackgroundIssues(clean(), new Map([['L1', 1]])));
    expect(fixableIssues(summary)).toEqual([]);
  });
});
