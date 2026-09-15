import { describe, it, expect } from 'vitest';
import { ADAPTERS, getAdapter, listAdapters, adaptersWithChannel } from './registry';
import { MARKETPLACE_KEYS, CONDITION_GRADES, type MarketplaceKey } from './types';
import { fullInput, sparseInput } from './fixtures';

/**
 * The registry is where a `MarketplaceKey` out of the database becomes
 * behaviour, so the contract it has to keep is total: every key has an adapter,
 * every adapter answers to its own key, and `serialize` exists exactly when the
 * spec claims a feed channel. A gap here is a crash in Step 4 for a workspace
 * that enabled one marketplace.
 */

describe('registry', () => {
  it('has an adapter for every key, and every adapter knows its own key', () => {
    expect(listAdapters()).toHaveLength(MARKETPLACE_KEYS.length);
    for (const key of MARKETPLACE_KEYS) {
      const a = getAdapter(key);
      expect(a, key).toBeDefined();
      expect(a.key).toBe(key);
      expect(a.spec.key).toBe(key);
    }
  });

  it('exposes `serialize` exactly when the spec claims a feed channel', () => {
    for (const a of listAdapters()) {
      expect(typeof a.serialize === 'function', `${a.key} serialize vs channels`)
        .toBe(a.spec.channels.includes('feed'));
    }
  });

  it('lists adapters in MARKETPLACE_KEYS order, so Step 4 is stable', () => {
    expect(listAdapters().map(a => a.key)).toEqual([...MARKETPLACE_KEYS]);
  });

  it('groups by channel', () => {
    expect(adaptersWithChannel('feed').map(a => a.key)).toEqual(['shopify', 'depop', 'facebook', 'whatnot']);
    expect(adaptersWithChannel('pack').map(a => a.key)).toEqual([
      'ebay', 'etsy', 'poshmark', 'mercari', 'grailed', 'depop', 'facebook', 'vinted', 'whatnot',
    ]);
    // No connector is built yet — the plan's phase 3.
    expect(adaptersWithChannel('api')).toEqual([]);
  });

  it('has no unverified spec claiming to be verified (they are all provisional today)', () => {
    for (const a of listAdapters()) expect(a.spec.verified, a.key).toBe(false);
  });
});

describe('every spec is internally consistent', () => {
  for (const key of MARKETPLACE_KEYS) {
    const { spec } = ADAPTERS[key as MarketplaceKey];

    it(`${key}: limits are positive and a name is set`, () => {
      expect(spec.name.length).toBeGreaterThan(0);
      expect(spec.title.max).toBeGreaterThan(0);
      expect(spec.description.max).toBeGreaterThan(0);
      expect(spec.photos.min).toBeGreaterThanOrEqual(1);
      expect(spec.photos.max).toBeGreaterThanOrEqual(spec.photos.min);
      expect(spec.channels.length).toBeGreaterThan(0);
    });

    it(`${key}: every canonical grade maps to a word the marketplace lists`, () => {
      for (const grade of CONDITION_GRADES) {
        const word = spec.condition.map[grade];
        expect(word, `${key}.${grade}`).toBeTruthy();
        expect(spec.condition.values, `${key}.${grade}`).toContain(word);
      }
    });

    it(`${key}: a tag style of "none" carries no tag budget, and vice versa`, () => {
      expect(spec.tags.max === 0).toBe(spec.tags.style === 'none');
    });
  }
});

describe('every adapter survives both fixtures', () => {
  for (const key of MARKETPLACE_KEYS) {
    const adapter = ADAPTERS[key as MarketplaceKey];

    it(`${key}: format() never throws and respects its own limits`, () => {
      for (const input of [fullInput(), sparseInput()]) {
        const out = adapter.format(input);
        expect(out.marketplace).toBe(key);
        expect(out.title.length).toBeLessThanOrEqual(adapter.spec.title.max);
        expect(out.photos.length).toBeLessThanOrEqual(adapter.spec.photos.max);
        expect(out.tags.length).toBeLessThanOrEqual(adapter.spec.tags.max);
        // HTML expands past the plain-text budget by design; the budget is the
        // plain text the seller wrote.
        if (adapter.spec.description.format === 'plain') {
          expect(out.description.length).toBeLessThanOrEqual(adapter.spec.description.max);
        }
      }
    });

    it(`${key}: validate() is exactly format().issues`, () => {
      expect(adapter.validate(sparseInput())).toEqual(adapter.format(sparseInput()).issues);
    });

    it(`${key}: a listing with no price is an ERROR, never a silent $0`, () => {
      const out = adapter.format(sparseInput());
      expect(out.price).toBeNull();
      expect(out.issues).toContainEqual(expect.objectContaining({ field: 'price', level: 'error' }));
    });

    it(`${key}: an unreadable condition is reported, never guessed`, () => {
      const out = adapter.format(sparseInput());
      expect(out.condition).toBeNull();
      expect(out.issues).toContainEqual(expect.objectContaining({
        field: 'condition', value: 'kinda beat up', fixKind: 'condition',
      }));
    });

    it(`${key}: every issue names this marketplace`, () => {
      for (const i of adapter.format(sparseInput()).issues) expect(i.marketplace).toBe(key);
    });
  }
});
