import { describe, it, expect } from 'vitest';
import {
  cellSummary, effectiveTargets, fixableIssues, nextTargets,
  summarizeMarketplace, summarizeMatrix,
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
