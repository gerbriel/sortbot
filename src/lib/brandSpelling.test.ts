import { describe, it, expect } from 'vitest';
import {
  normalizeBrand, levenshtein, similarity, phoneticCode, phoneticKey,
  brandSimilarity, rankBrandMatches, resolveHeardBrand,
  isSellerName, scrubSellerBrand,
  SUGGEST_THRESHOLD, type BrandCandidate,
} from './brandSpelling';

describe('normalizeBrand', () => {
  it.each([
    ['Ecko Unltd.', 'ecko unltd'],
    ['ECKO  UNLTD', 'ecko unltd'],
    ["Levi's", 'levis'],
    ['Dolce & Gabbana', 'dolce and gabbana'],
    ['Dolce and Gabbana', 'dolce and gabbana'],
    ['Stüssy', 'stussy'],
    ['  Guess?  ', 'guess'],
  ])('%s → %s', (raw, expected) => expect(normalizeBrand(raw)).toBe(expected));
});

describe('levenshtein', () => {
  it('is 0 for identical and the length for empty', () => {
    expect(levenshtein('nike', 'nike')).toBe(0);
    expect(levenshtein('', 'nike')).toBe(4);
    expect(levenshtein('nike', '')).toBe(4);
  });
  it('counts single edits', () => {
    expect(levenshtein('nike', 'bike')).toBe(1);      // substitute
    expect(levenshtein('nike', 'nikes')).toBe(1);     // insert
    expect(levenshtein('kitten', 'sitting')).toBe(3); // the textbook case
  });
  it('is symmetric', () => {
    expect(levenshtein('ecko', 'echo')).toBe(levenshtein('echo', 'ecko'));
  });
  it('similarity is 1 for equal, 0 for nothing shared', () => {
    expect(similarity('nike', 'nike')).toBe(1);
    expect(similarity('', '')).toBe(1);
    expect(similarity('abcd', 'wxyz')).toBe(0);
  });
});

describe('phoneticCode', () => {
  it('pairs the spellings speech-to-text confuses', () => {
    expect(phoneticCode('echo')).toBe(phoneticCode('ecko'));
    expect(phoneticCode('kappa')).toBe(phoneticCode('capa'));
    expect(phoneticCode('hurley')).toBe(phoneticCode('hurly'));
    expect(phoneticCode('phat')).toBe(phoneticCode('fat'));
  });
  it('keeps genuinely different names apart', () => {
    expect(phoneticCode('nike')).not.toBe(phoneticCode('dickies'));
    expect(phoneticCode('carhartt')).not.toBe(phoneticCode('columbia'));
  });
  it('is 4 characters, letter then digits, and empty for nothing', () => {
    expect(phoneticCode('carhartt')).toMatch(/^[A-Z]\d{3}$/);
    expect(phoneticCode('')).toBe('');
    expect(phoneticCode('123')).toBe('');
  });
  it('drops noise words from the key', () => {
    expect(phoneticKey('The North Face Co')).toBe(phoneticKey('North Face'));
  });
});

describe('brandSimilarity — the report-14 case', () => {
  it('"echo unlimited" is a strong match for "Ecko Unltd"', () => {
    const s = brandSimilarity('echo unlimited', 'Ecko Unltd');
    expect(s).toBeGreaterThan(SUGGEST_THRESHOLD);
  });
  it('spacing is not a difference', () => {
    expect(brandSimilarity('ecko unltd', 'eckounltd')).toBe(1);
  });
  it('unrelated brands score far below the threshold', () => {
    expect(brandSimilarity('nike', 'dickies')).toBeLessThan(SUGGEST_THRESHOLD);
    expect(brandSimilarity('carhartt', 'champion')).toBeLessThan(SUGGEST_THRESHOLD);
    expect(brandSimilarity('polo ralph lauren', 'tommy hilfiger')).toBeLessThan(SUGGEST_THRESHOLD);
  });
  it('an empty side scores 0', () => {
    expect(brandSimilarity('', 'nike')).toBe(0);
  });

  it('numeric brand names are not all identical to each other', () => {
    // Both have an EMPTY phonetic code; only spelling can separate them.
    expect(brandSimilarity('47', '212')).toBeLessThan(SUGGEST_THRESHOLD);
    expect(brandSimilarity('47', '47')).toBe(1);
    expect(brandSimilarity('5 11 tactical', '96 north')).toBeLessThan(SUGGEST_THRESHOLD);
  });
});

const CANDIDATES: BrandCandidate[] = [
  { brand: 'Ecko Unltd', source: 'alias', heard: 'echo unlimited' },
  { brand: 'Nike', source: 'vocab' },
  { brand: 'Carhartt', source: 'vocab' },
  { brand: 'Champion', source: 'builtin' },
  { brand: 'Dickies', source: 'builtin' },
];

describe('rankBrandMatches', () => {
  it('an exact alias hit wins with score 1 and reason "alias"', () => {
    const [top] = rankBrandMatches('echo unlimited', CANDIDATES);
    expect(top).toMatchObject({ brand: 'Ecko Unltd', reason: 'alias', score: 1 });
  });

  it('an exact brand hit is reason "exact"', () => {
    const [top] = rankBrandMatches('nike', CANDIDATES);
    expect(top).toMatchObject({ brand: 'Nike', reason: 'exact', score: 1 });
  });

  it('returns nothing when nothing is close', () => {
    expect(rankBrandMatches('supreme', CANDIDATES)).toEqual([]);
  });

  it('returns nothing for empty input', () => {
    expect(rankBrandMatches('', CANDIDATES)).toEqual([]);
  });

  it('prefers the workspace alias over the global library on a tie', () => {
    const cands: BrandCandidate[] = [
      { brand: 'Kappa', source: 'builtin' },
      { brand: 'Kappa', source: 'alias', heard: 'capa' },
    ];
    expect(rankBrandMatches('kappa', cands)[0].source).toBe('alias');
  });

  it('honours the limit', () => {
    expect(rankBrandMatches('nike', CANDIDATES, 1).length).toBeLessThanOrEqual(1);
  });
});

describe('resolveHeardBrand — what Step 3 does with the result', () => {
  it('applies an exact alias silently (with an Undo affordance)', () => {
    const r = resolveHeardBrand('Echo Unlimited', CANDIDATES);
    expect(r.brand).toBe('Ecko Unltd');
    expect(r.applied?.reason).toBe('alias');
    expect(r.suggestion).toBeUndefined();
  });

  it('says nothing when the recogniser already got it right', () => {
    const r = resolveHeardBrand('Nike', CANDIDATES);
    expect(r.brand).toBe('Nike');
    expect(r.applied).toBeUndefined();
    expect(r.suggestion).toBeUndefined();
  });

  it('suggests, but does not apply, a strong near match', () => {
    const noAlias = CANDIDATES.filter(c => c.source !== 'alias');
    const r = resolveHeardBrand('carhart', [...noAlias, { brand: 'Carhartt', source: 'vocab' }]);
    expect(r.brand).toBe('carhart');             // the field is NOT rewritten
    expect(r.suggestion?.brand).toBe('Carhartt');
    expect(r.applied).toBeUndefined();
  });

  it('leaves an unknown brand completely alone', () => {
    const r = resolveHeardBrand('Zephyr Athletics', CANDIDATES);
    expect(r).toEqual({ brand: 'Zephyr Athletics' });
  });

  it('is a no-op on empty input', () => {
    expect(resolveHeardBrand('  ', CANDIDATES)).toEqual({ brand: '' });
  });
});

// ── Report 23 ──────────────────────────────────────────────────────────────
describe('the seller name is never a garment brand', () => {
  it('matches the shop name through case, punctuation and &/and', () => {
    expect(isSellerName('C&D Vintage', ['C&D Vintage'])).toBe(true);
    expect(isSellerName('c and d vintage', ['C&D Vintage'])).toBe(true);
    expect(isSellerName('C&D VINTAGE.', ['C&D Vintage'])).toBe(true);
  });
  it('does not match a real brand that merely contains "vintage"', () => {
    expect(isSellerName('American Vintage', ['C&D Vintage'])).toBe(false);
    expect(isSellerName('Nike', ['C&D Vintage'])).toBe(false);
  });
  it('ignores blank brands and blank seller names', () => {
    expect(isSellerName('', ['C&D Vintage'])).toBe(false);
    expect(isSellerName('Nike', [undefined, ''])).toBe(false);
  });
  it('scrubSellerBrand drops the seller name and keeps everything else', () => {
    expect(scrubSellerBrand('C&D Vintage', ['C&D Vintage'])).toBeUndefined();
    expect(scrubSellerBrand('Nike', ['C&D Vintage'])).toBe('Nike');
    expect(scrubSellerBrand(undefined, ['C&D Vintage'])).toBeUndefined();
  });
});
