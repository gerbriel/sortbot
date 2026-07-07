import { describe, it, expect } from 'vitest';
import { validateProse } from './proseService';

/**
 * The gate between the language model and the listing. If these fail, either
 * invalid prose can reach descriptions (hallucinated numbers, banned slop) or
 * valid prose is being thrown away.
 */

const FACTS = ['Nike', 'tees', 'black', 'XL', '90s', '100% cotton'];

const GOOD =
  'Heavyweight black Nike tee straight out of the 90s, with the boxy cut and ' +
  'soft broken-in cotton that only decades of wear can give. The graphic still ' +
  'pops, the collar holds strong, and it layers as easily as it stands alone.';

describe('validateProse', () => {
  it('accepts a clean paragraph and collapses whitespace', () => {
    const out = validateProse(GOOD.replace('90s, with', '90s,\n\nwith'), FACTS);
    expect(out).toBe(GOOD);
  });

  it('rejects empty, too-short, and too-long output', () => {
    expect(validateProse('', FACTS)).toBeNull();
    expect(validateProse('Great tee.', FACTS)).toBeNull();
    expect(validateProse(Array(150).fill('word').join(' '), FACTS)).toBeNull();
  });

  it('rejects banned phrases and AI tells', () => {
    expect(validateProse(GOOD.replace('The graphic still pops', 'A must-have that will elevate your wardrobe'), FACTS)).toBeNull();
    expect(validateProse(`As an AI language model I think ${GOOD}`, FACTS)).toBeNull();
  });

  it('rejects hashtags, handles, and links', () => {
    expect(validateProse(`${GOOD} #vintage`, FACTS)).toBeNull();
    expect(validateProse(`${GOOD} https://example.com`, FACTS)).toBeNull();
  });

  it('numbers guard: digits absent from the facts are rejected, present ones pass', () => {
    // "90s" and "100" are in the facts → fine
    expect(validateProse(GOOD, FACTS)).not.toBeNull();
    // invented measurement → rejected
    expect(validateProse(GOOD.replace('boxy cut', '23 inch wide boxy cut'), FACTS)).toBeNull();
  });
});
