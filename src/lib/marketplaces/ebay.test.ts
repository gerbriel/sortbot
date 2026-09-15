import { describe, it, expect } from 'vitest';
import { adapter, spec, format } from './ebay';
import { fullInput, sparseInput, snapshotOf, stubVocab } from './fixtures';

describe('ebay spec', () => {
  it('is pack-only until the Sell API connector exists (plan phase 3)', () => {
    expect(spec.channels).toEqual(['pack']);
    expect(adapter.serialize).toBeUndefined();
    expect(spec.verified).toBe(false);
  });
});

describe('ebay format', () => {
  it('golden — a fully populated listing', () => {
    expect(snapshotOf(format(fullInput()))).toMatchSnapshot();
  });

  it('golden — a sparse listing', () => {
    expect(snapshotOf(format(sparseInput()))).toMatchSnapshot();
  });

  it('cuts the title to 80 characters on a word boundary', () => {
    const out = format(fullInput());
    expect(out.title.length).toBeLessThanOrEqual(80);
  });

  it('fills the item specifics discovery actually runs on', () => {
    const a = format(fullInput()).attributes;
    expect(a).toMatchObject({
      Brand: 'Nike',
      Department: 'Men',
      Size: 'L',
      'Size Type': 'Regular',
      Style: 'Vintage',
      Type: 'Sweatshirt',
      Color: 'Grey',
      Material: '80% cotton, 20% polyester',
      Decade: '1990s',
      Vintage: 'Yes',
    });
  });

  it('drops a blank specific rather than sending an empty one', () => {
    const a = format(sparseInput()).attributes;
    expect(a.Brand).toBe('Unbranded');     // eBay's own no-brand value
    expect('Department' in a).toBe(false);
    expect('Decade' in a).toBe(false);
  });

  it('every used grade is Pre-owned — eBay has no five-step scale for clothing', () => {
    expect(spec.condition.map.excellent).toBe('Pre-owned');
    expect(spec.condition.map.poor).toBe('Pre-owned');
    expect(format(fullInput()).condition).toBe('Pre-owned');
  });

  it('warns that the eBay category id is unmapped, and stops warning once it is', () => {
    expect(format(fullInput()).issues).toContainEqual(expect.objectContaining({
      field: 'category', fixKind: 'category', value: 'sweatshirts',
    }));
    const mapped = format(fullInput({ vocab: stubVocab({ 'category:ebay:sweatshirts': '155183' }) }));
    expect(mapped.category).toBe('155183');
    expect(mapped.issues.some(i => i.field === 'category')).toBe(false);
  });
});
