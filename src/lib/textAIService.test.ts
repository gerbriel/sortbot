import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  generateProductDescription,
  normalizeSizeValue,
  smartSeoTruncate,
  primaryMaterial,
  stripLeadingFieldTitle,
} from './textAIService';

/**
 * Characterization tests for the voice → fields → description/title engine.
 * These lock in behavior that Steps 3–4 and the CSV export depend on.
 * If one of these fails after a change, either the change broke a workflow
 * invariant or the invariant moved on purpose — update the test deliberately.
 */

describe('normalizeSizeValue — letter symbols, never spelled out', () => {
  it.each([
    ['large', 'L'],
    ['Large', 'L'],
    ['medium', 'M'],
    ['small', 'S'],
    ['extra large', 'XL'],
    ['x-large', 'XL'],
    ['extra extra large', 'XXL'],
    ['double extra large', 'XXL'],
    ['2xl', 'XXL'],
    ['triple extra large', 'XXXL'],
    ['3xl', 'XXXL'],
    ['4xl', '4XL'],
    ['extra small', 'XS'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeSizeValue(input)).toBe(expected);
  });

  it('passes numeric sizes through', () => {
    expect(normalizeSizeValue('32')).toBe('32');
    expect(normalizeSizeValue('10.5')).toBe('10.5');
  });

  it('normalizes one-size variants to OSFA', () => {
    expect(normalizeSizeValue('one size fits all')).toBe('OSFA');
    expect(normalizeSizeValue('osfa')).toBe('OSFA');
    expect(normalizeSizeValue('one size')).toBe('OSFA');
  });
});

describe('normalizeSizeValue — "(fits like …)" note', () => {
  it('strips the note by default (titles, CSV, alt text)', () => {
    expect(normalizeSizeValue('large fits like medium')).toBe('L');
    expect(normalizeSizeValue('L (fits like M)')).toBe('L');
    expect(normalizeSizeValue('large fits like')).toBe('L');
  });

  it('keeps and normalizes the note with keepFitsLike (description SIZE line)', () => {
    expect(normalizeSizeValue('large fits like medium', { keepFitsLike: true })).toBe('L (fits like M)');
    expect(normalizeSizeValue('large fits like', { keepFitsLike: true })).toBe('L (fits like)');
    expect(normalizeSizeValue('extra large fits like large', { keepFitsLike: true })).toBe('XL (fits like L)');
  });

  it('strips leading articles in the target ("fits like a medium" → M, not A)', () => {
    expect(normalizeSizeValue('large fits like a medium', { keepFitsLike: true })).toBe('L (fits like M)');
  });

  it('is idempotent on already-stored values', () => {
    expect(normalizeSizeValue('L (fits like M)', { keepFitsLike: true })).toBe('L (fits like M)');
  });

  it('never mistakes "one size fits all" for a fits-like note', () => {
    expect(normalizeSizeValue('one size fits all', { keepFitsLike: true })).toBe('OSFA');
  });
});

describe('generateProductDescription — voice command extraction', () => {
  beforeEach(() => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
  });

  it('extracts brand / size / color / measurements from voice commands', async () => {
    const result = await generateProductDescription({
      voiceDescription:
        'brand nike period size extra large period color red period width 18 period length 26 period',
      category: 'tees',
    });
    expect(result.extractedFields?.brand).toBe('Nike');
    expect(result.extractedFields?.size).toBe('XL');
    expect(result.extractedFields?.color).toBe('Red');
    const measurements = result.extractedFields?.measurements ?? {};
    const values = Object.entries(measurements).map(([k, v]) => `${k.toLowerCase()}:${v}`);
    expect(values).toContain('width:18');
    expect(values).toContain('length:26');
  });

  it('renders the ✠ SIZE / measurement lines in the description body', async () => {
    const result = await generateProductDescription({
      size: 'XL',
      measurements: { Width: '18', Length: '26' },
      category: 'tees',
      brand: 'Nike',
    });
    expect(result.description).toContain('✠ SIZE- XL');
    expect(result.description).toContain('✠ Width- 18');
    expect(result.description).toContain('✠ Length- 26');
  });

  it('voice "size large fits like medium period" → note in description, NOT in title', async () => {
    const result = await generateProductDescription({
      voiceDescription: 'brand nike period size large fits like medium period',
      category: 'tees',
    });
    expect(result.extractedFields?.size).toBe('L (fits like M)');
    expect(result.description).toContain('✠ SIZE- L (fits like M)');
    expect(result.suggestedTitle ?? '').not.toMatch(/fits like/i);
  });

  it('captures a full "description … period" phrase even when it contains field keywords', async () => {
    // Natural narration is full of words that double as field triggers —
    // "sleeve", "style", "length" must NOT chop the description apart.
    const result = await generateProductDescription({
      voiceDescription:
        'description super faded long sleeve skater style period brand nike period',
      category: 'tees',
    });
    expect(result.extractedFields?.customDescription).toBe('super faded long sleeve skater style');
    expect(result.extractedFields?.brand).toBe('Nike');
  });

  it('description words never leak into other fields (sleeve inside narration ≠ sleeve measurement)', async () => {
    const result = await generateProductDescription({
      voiceDescription: 'description long sleeve heavyweight tee period width 18 period',
      category: 'tees',
    });
    expect(result.extractedFields?.customDescription).toBe('long sleeve heavyweight tee');
    const measurements = result.extractedFields?.measurements ?? {};
    const entries = Object.entries(measurements).map(([k, v]) => `${k.toLowerCase()}:${v}`);
    expect(entries).toContain('width:18');
    expect(entries.find(e => e.startsWith('sleeve'))).toBeUndefined();
  });

  it('applies per-workspace description settings (symbol, lines, hashtags)', async () => {
    const result = await generateProductDescription({
      brand: 'Nike',
      size: 'XL',
      measurements: { Width: '18' },
      condition: 'Good',
      category: 'tees',
      descriptionSettings: {
        measurementPrefix: '•',
        washingLine: 'All items steam cleaned before shipping.',
        closingLine: 'FREE SHIPPING ON BUNDLES',
        includeHashtags: false,
        disclaimerLines: ['* Ships within 48 hours.'],
      },
    });
    expect(result.description).toContain('• SIZE- XL');
    expect(result.description).toContain('• Width- 18');
    expect(result.description).toContain('All items steam cleaned before shipping.');
    expect(result.description).toContain('FREE SHIPPING ON BUNDLES');
    expect(result.description).toContain('* Ships within 48 hours.');
    expect(result.description).not.toContain('✠');
    expect(result.description).not.toContain('BUNDLE AND SAVE');
    expect(result.description).not.toMatch(/#\w+/);
    expect((result.suggestedTags ?? []).length).toBeGreaterThan(0); // tags still computed for CSV
  });

  it('renders the validated prose paragraph in place of the raw keyword note', async () => {
    const prose = 'Sun faded to perfection with the boxy nineties cut collectors hunt for, this piece layers clean and photographs even better.';
    const result = await generateProductDescription({
      brand: 'Nike',
      category: 'tees',
      customDescription: 'faded, boxy',
      proseParagraph: prose,
    });
    expect(result.description).toContain(prose);
    // the raw keyword note is replaced by the prose, not duplicated
    expect(result.description).not.toContain('faded, boxy');

    // without prose, the raw note renders exactly as before
    const plain = await generateProductDescription({
      brand: 'Nike',
      category: 'tees',
      customDescription: 'faded, boxy',
    });
    expect(plain.description).toContain('faded, boxy');
  });

  it('merges founder-curated brandTerms into the generated tags', async () => {
    const result = await generateProductDescription({
      brand: 'Harley Davidson',
      category: 'tees',
      brandTerms: ['biker', 'moto', 'americana'],
    });
    const tags = (result.suggestedTags ?? []).map(t => t.toLowerCase());
    expect(tags).toContain('biker');
    expect(tags).toContain('moto');
  });

  it('keeps suggested titles within 60 characters', async () => {
    const result = await generateProductDescription({
      brand: 'Abercrombie & Fitch',
      color: 'Forest Green',
      size: 'XXL',
      category: 'sweatshirts',
      type: 'Quarter-Zip Pullover Sweatshirt',
      era: '90s',
    });
    expect((result.suggestedTitle ?? '').length).toBeLessThanOrEqual(60);
  });

  it('synonym swaps never compound within one group ("early mid late nineties")', async () => {
    const result = await generateProductDescription({
      brand: 'Nike',
      size: 'XL',
      era: '90s',
      category: 'tees',
      type: 'Tee',
    });
    const title = (result.suggestedTitle ?? '').toLowerCase();
    // At most ONE era-group swap may apply — stacked modifiers mean the
    // per-group lock in fitTo60 regressed.
    expect(title).not.toMatch(/early mid|mid late|early late|late early/);
  });

  it('titles keep sizes as letter symbols — never respelled by synonym swaps', async () => {
    const result = await generateProductDescription({
      brand: 'Nike',
      size: 'XL',
      era: '90s',
      category: 'tees',
      type: 'Tee',
    });
    const title = result.suggestedTitle ?? '';
    expect(title).toContain('XL');
    expect(title.toLowerCase()).not.toContain('extra large');
    expect(title.toLowerCase()).not.toContain('extra lg');
    expect(title.toLowerCase()).not.toContain('xlarge');
  });
});

describe('generateProductDescription — golden output', () => {
  beforeEach(() => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
  });

  it('matches the golden description for a fully-populated context', async () => {
    const result = await generateProductDescription({
      brand: 'Nike',
      size: 'XL',
      color: 'Red',
      secondaryColor: 'White',
      material: 'Cotton',
      condition: 'Good',
      era: '90s',
      category: 'tees',
      type: 'Tee',
      measurements: { Width: '18', Length: '26' },
      flaws: 'small stain on left sleeve',
      care: 'machine wash cold',
    });
    expect({
      description: result.description,
      suggestedTitle: result.suggestedTitle,
      suggestedTags: result.suggestedTags,
    }).toMatchSnapshot();
  });
});

describe('helpers', () => {
  it('smartSeoTruncate stays within the flex window and ends cleanly', () => {
    const long = 'word '.repeat(200);
    const out = smartSeoTruncate(long, 320, 40);
    expect(out.length).toBeLessThanOrEqual(360);
  });

  it('primaryMaterial strips percentage prefixes', () => {
    expect(primaryMaterial('50% cotton 50% polyester').toLowerCase()).toContain('cotton');
  });
});

describe('report 10 — the literal word "description" never reaches title/tags/body', () => {
  it('strips a leading field title from a value dictated before the parser fix', async () => {
    // Items dictated by the old inline parser have the spoken title baked into
    // the saved field. It used to flow straight into the title formula.
    const result = await generateProductDescription({
      customDescription: 'description super soft faded boxy fit',
      brand: 'Nike',
      size: 'L',
      category: 'tees',
    });
    expect(result.suggestedTitle).not.toMatch(/description/i);
    expect(result.suggestedTitle).toContain('soft');
    expect(result.description).not.toMatch(/\bdescription\b/i);
  });

  it('strips the "note" synonym too', () => {
    expect(stripLeadingFieldTitle('note really soft')).toBe('really soft');
  });

  it('only strips at the very start — a real mention is kept', () => {
    expect(stripLeadingFieldTitle('great description on the tag'))
      .toBe('great description on the tag');
  });

  it('leaves an ordinary value untouched', () => {
    expect(stripLeadingFieldTitle('super soft faded')).toBe('super soft faded');
  });

  it('collapses a value that was nothing but the title', () => {
    expect(stripLeadingFieldTitle('description')).toBeUndefined();
  });

  it('passes undefined through', () => {
    expect(stripLeadingFieldTitle(undefined)).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Report 9 — field names never land inside field values
// ═══════════════════════════════════════════════════════════════════════════
describe('report 9 — the extractor stops a value at the NEXT field title', () => {
  beforeEach(() => { vi.spyOn(Math, 'random').mockReturnValue(0); });

  it('"brand nike chest 22" (no periods) → brand "Nike", not "Nike Chest 22"', async () => {
    const r = await generateProductDescription({
      voiceDescription: 'brand nike chest 22 period', category: 'tees',
    });
    expect(r.extractedFields?.brand).toBe('Nike');
  });

  it('a trailing bare "description" does not become part of the brand', async () => {
    const r = await generateProductDescription({
      voiceDescription: 'brand nike description', category: 'tees',
    });
    expect(r.extractedFields?.brand).toBe('Nike');
  });

  it('every extracted value is free of its own field title', async () => {
    const r = await generateProductDescription({
      voiceDescription:
        'brand nike period size large period color red period material cotton period ' +
        'condition good period era 90s period style boxy period gender men period ' +
        'width 18 period length 26 period description super soft period',
      category: 'tees',
    });
    const f = r.extractedFields ?? {};
    for (const [k, v] of Object.entries(f)) {
      if (typeof v !== 'string') continue;
      expect(v.toLowerCase(), `${k} kept its own title`).not.toMatch(
        /^(brand|size|colou?r|material|fabric|condition|era|style|gender|price|description|note|tags?|flaws?|care|title)\b/,
      );
    }
    expect(f.customDescription).toBe('super soft');
  });

  it('MEASUREMENT titles are digit-gated, so "style hip hop" keeps its value', async () => {
    const r = await generateProductDescription({
      voiceDescription: 'style hip hop period brand nike period', category: 'tees',
    });
    expect(r.extractedFields?.style).toBe('Hip Hop');
    expect(r.extractedFields?.brand).toBe('Nike');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Report 11 — titles carry keywords, never grammatical filler
// ═══════════════════════════════════════════════════════════════════════════
describe('report 11 — small words never reach a description-built title', () => {
  beforeEach(() => { vi.spyOn(Math, 'random').mockReturnValue(0); });

  const FILLER = /\b(of|its|it's|a|an|the|and|or|with|for|from|in|on|at|to|is|are|was|this|that|these|those|has|have|very|really|so|just)\b/i;

  it('drops articles, prepositions, auxiliaries and intensifiers', async () => {
    const r = await generateProductDescription({
      customDescription:
        "it's a really nice one of the faded boxy tees and it has some of that single stitch",
      brand: 'Nike', size: 'XL', category: 'tees',
    });
    expect(r.suggestedTitle).not.toMatch(FILLER);
  });

  it('keeps the descriptive words and the brand', async () => {
    const r = await generateProductDescription({
      customDescription: "it's a very faded and really distressed boxy tee with single stitch",
      brand: 'Nike', size: 'XL', category: 'tees',
    });
    expect(r.suggestedTitle).toContain('Nike');
    expect(r.suggestedTitle).toMatch(/faded/);
    expect(r.suggestedTitle).toMatch(/distressed|boxy/);
  });

  it('"it\'s" is filtered even though the apostrophe survives punctuation stripping', async () => {
    const r = await generateProductDescription({
      customDescription: "it's cropped", brand: 'Levis', size: 'M', category: 'tees',
    });
    expect(r.suggestedTitle?.toLowerCase()).not.toContain("it's");
    expect(r.suggestedTitle?.toLowerCase()).not.toMatch(/\bits\b/);
    expect(r.suggestedTitle).toMatch(/cropped/);
  });

  it('domain words that LOOK closed-class are kept ("made in usa", "all over print")', async () => {
    const r = await generateProductDescription({
      customDescription: 'made in usa all over print', brand: 'Nike', size: 'L', category: 'tees',
    });
    expect(r.suggestedTitle?.toLowerCase()).toContain('made');
    expect(r.suggestedTitle?.toLowerCase()).toContain('over');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Report 26 — every size family this catalogue sells
// ═══════════════════════════════════════════════════════════════════════════
describe('normalizeSizeValue — report 26 size families', () => {
  it.each([
    // kids ages
    ['6-9', '6-9'], ['6 to 9', '6-9'], ['6-9 months', '6-9M'], ['3-6 mo', '3-6M'],
    ['2-3 years', '2-3Y'], ['18 months', '18M'], ['2 years', '2Y'],
    // toddler
    ['3T', '3T'], ['4 t', '4T'], ['2t', '2T'],
    // youth / kids
    ['youth medium', 'YM'], ['YM', 'YM'], ['kids large', 'YL'], ['boys small', 'YS'],
    ['youth extra large', 'YXL'], ['junior medium', 'YM'], ['youth 10', 'Y10'],
    ['kids 3T', '3T'],
    // women's petite
    ['petite small', 'PS'], ['petite medium', 'PM'], ['petite large', 'PL'],
    ['petite 2', '2P'], ['2 petite', '2P'], ['petite', 'P'],
    // women's plus — NEVER folded into the XL ramp
    ['1X', '1X'], ['2X', '2X'], ['3X', '3X'], ['1 x', '1X'], ['one x', '1X'],
    // tall
    ['large tall', 'LT'], ['medium tall', 'MT'], ['extra large tall', 'XLT'],
    ['tall large', 'LT'], ['LT', 'LT'],
    // pants
    ['32x34', '32x34'], ['32 x 34', '32x34'], ['32 by 34', '32x34'],
    ['32/34', '32x34'], ['W32 L34', '32x34'], ['w32l34', '32x34'],
    // numeric women's
    ['size 8', '8'], ['size 10', '10'], ['10.5', '10.5'],
    // the existing rules must be untouched
    ['large', 'L'], ['extra large', 'XL'], ['double extra large', 'XXL'],
    ['3xl', 'XXXL'], ['2xl', 'XXL'], ['one size fits all', 'OSFA'],
    ["women's large", 'L'], ['mens extra large', 'XL'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeSizeValue(input)).toBe(expected);
  });

  it('plus sizes are NOT the XL ramp — 1X ≠ XL and 2X ≠ XXL', () => {
    expect(normalizeSizeValue('1X')).not.toBe('XL');
    expect(normalizeSizeValue('2X')).not.toBe(normalizeSizeValue('2XL'));
    expect(normalizeSizeValue('2XL')).toBe('XXL');
  });

  it('the "(fits like …)" note still rides along on the new families', () => {
    expect(normalizeSizeValue('1X fits like XL', { keepFitsLike: true })).toBe('1X (fits like XL)');
    expect(normalizeSizeValue('32x34 fits like 33', { keepFitsLike: true })).toBe('32x34 (fits like 33)');
    expect(normalizeSizeValue('1X fits like XL')).toBe('1X');
  });
});

describe('report 26 — pants sizing through the voice pipeline', () => {
  beforeEach(() => { vi.spyOn(Math, 'random').mockReturnValue(0); });

  it('"waist 32 inseam 34" with no size command → size 32x34', async () => {
    const r = await generateProductDescription({
      voiceDescription: 'brand levis period waist 32 period inseam 34 period', category: 'bottoms',
    });
    expect(r.extractedFields?.size).toBe('32x34');
  });

  it('"size 32 by 34" also fills the waist and inseam measurements', async () => {
    const r = await generateProductDescription({
      voiceDescription: 'size 32 by 34 period', category: 'bottoms',
    });
    expect(r.extractedFields?.size).toBe('32x34');
    const m = (r.extractedFields?.measurements ?? {}) as Record<string, string>;
    expect(m.waist).toBe('32');
    expect(m.inseam).toBe('34');
  });

  it('spoken kids and plus sizes survive the extractor', async () => {
    const kids = await generateProductDescription({
      voiceDescription: 'size youth medium period', category: 'tees',
    });
    expect(kids.extractedFields?.size).toBe('YM');
    const plus = await generateProductDescription({
      voiceDescription: 'size 1X period', category: 'tees',
    });
    expect(plus.extractedFields?.size).toBe('1X');
    const petite = await generateProductDescription({
      voiceDescription: 'size petite small period', category: 'tees',
    });
    expect(petite.extractedFields?.size).toBe('PS');
  });
});
