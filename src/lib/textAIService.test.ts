import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  generateProductDescription,
  normalizeSizeValue,
  smartSeoTruncate,
  primaryMaterial,
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
