import { describe, it, expect } from 'vitest';
import { normalizeCondition, CONDITION_LABELS } from './conditions';
import { CONDITION_GRADES, type ConditionGrade } from './types';

/**
 * The condition field holds whatever the seller dictated. These are the
 * phrasings a vintage reseller actually uses — and, just as importantly, the
 * ones that must resolve to NOTHING, because a guessed condition is the single
 * most disputable thing in a listing.
 */

const cases: ReadonlyArray<readonly [string, ConditionGrade]> = [
  // new, tags on
  ['NWT', 'new_with_tags'],
  ['nwt', 'new_with_tags'],
  ['new with tags', 'new_with_tags'],
  ['brand new with tags', 'new_with_tags'],
  ['new w/ tags', 'new_with_tags'],
  ['tags still attached', 'new_with_tags'],
  ['deadstock', 'new_with_tags'],
  ['dead stock', 'new_with_tags'],
  ['new in box', 'new_with_tags'],

  // new, no tags
  ['NWOT', 'new_without_tags'],
  ['new without tags', 'new_without_tags'],
  ['new, no tags', 'new_without_tags'],
  ['new w/o tags', 'new_without_tags'],
  ['never worn', 'new_without_tags'],
  ['unworn', 'new_without_tags'],
  ['brand new', 'new_without_tags'],
  ['New', 'new_without_tags'],

  // excellent
  ['like new', 'excellent'],
  ['mint', 'excellent'],
  ['near mint', 'excellent'],
  ['excellent', 'excellent'],
  ['excellent used condition', 'excellent'],
  ['EUC', 'excellent'],
  ['very good', 'excellent'],
  ['gently used', 'excellent'],
  ['barely worn', 'excellent'],
  ['great condition', 'excellent'],

  // good
  ['good', 'good'],
  ['good condition', 'good'],
  ['GUC', 'good'],
  ['light wear', 'good'],
  ['pre-owned', 'good'],
  ['Used', 'good'],

  // fair
  ['fair', 'fair'],
  ['well worn', 'fair'],
  ['well loved', 'fair'],
  ['satisfactory', 'fair'],
  ['some flaws', 'fair'],
  ['worn', 'fair'],

  // poor
  ['poor', 'poor'],
  ['damaged', 'poor'],
  ['for parts', 'poor'],
  ['as is', 'poor'],
  ['heavily worn', 'poor'],
  ['thrashed', 'poor'],
  ['bad condition', 'poor'],

  // out-of-ten scores
  ['10/10', 'excellent'],
  ['9/10', 'excellent'],
  ['8/10', 'good'],
  ['7 out of 10', 'good'],
  ['6/10', 'fair'],
  ['3/10', 'poor'],
];

describe('normalizeCondition', () => {
  for (const [text, grade] of cases) {
    it(`"${text}" → ${grade}`, () => {
      expect(normalizeCondition(text)).toBe(grade);
    });
  }

  it('reads every value ClothingItem.condition is typed to hold', () => {
    // The union the app writes from the form/presets. None of these may fall
    // through — they are the common case, not an edge case.
    expect(normalizeCondition('NWT')).toBe('new_with_tags');
    expect(normalizeCondition('New')).toBe('new_without_tags');
    expect(normalizeCondition('Excellent')).toBe('excellent');
    expect(normalizeCondition('Good')).toBe('good');
    expect(normalizeCondition('Fair')).toBe('fair');
    expect(normalizeCondition('Used')).toBe('good');
  });

  it('phrases beat the bare words inside them', () => {
    // Each of these contains a word that means something else on its own.
    expect(normalizeCondition('like new')).toBe('excellent');        // contains "new"
    expect(normalizeCondition('very good')).toBe('excellent');       // contains "good"
    expect(normalizeCondition('gently worn')).toBe('excellent');     // contains "worn"
    expect(normalizeCondition('heavily used')).toBe('poor');         // contains "used"
    expect(normalizeCondition('heavily worn')).toBe('poor');         // contains "worn"
    expect(normalizeCondition('well worn')).toBe('fair');            // contains "worn"
  });

  it('a 10/10 vintage garment is excellent, NEVER new', () => {
    // The one direction of this mapping a buyer disputes.
    expect(normalizeCondition('10/10')).toBe('excellent');
    expect(normalizeCondition('10/10 condition')).toBe('excellent');
  });

  it('returns null rather than guessing', () => {
    expect(normalizeCondition('kinda beat up')).toBeNull();
    expect(normalizeCondition('see photos')).toBeNull();
    expect(normalizeCondition('ask me')).toBeNull();
    expect(normalizeCondition('')).toBeNull();
    expect(normalizeCondition('   ')).toBeNull();
    expect(normalizeCondition(undefined)).toBeNull();
    expect(normalizeCondition(null)).toBeNull();
    expect(normalizeCondition(42 as unknown as string)).toBeNull();
  });

  it('does not read a loose number as a score', () => {
    // "worn 10 times" must not become a grade from the 10.
    expect(normalizeCondition('washed 10 times')).toBeNull();
    expect(normalizeCondition('size 10')).toBeNull();
  });

  it('is case- and punctuation-insensitive', () => {
    expect(normalizeCondition('  N.W.T.  ')).toBe('new_with_tags');
    expect(normalizeCondition('PRE OWNED')).toBe('good');
    expect(normalizeCondition('Like-New')).toBe('excellent');
  });
});

describe('CONDITION_LABELS', () => {
  it('names every canonical grade', () => {
    for (const g of CONDITION_GRADES) {
      expect(CONDITION_LABELS[g]).toBeTruthy();
    }
    expect(Object.keys(CONDITION_LABELS)).toHaveLength(CONDITION_GRADES.length);
  });
});
