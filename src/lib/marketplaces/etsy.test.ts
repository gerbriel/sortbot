import { describe, it, expect } from 'vitest';
import { adapter, spec, format } from './etsy';
import { fullInput, sparseInput, snapshotOf } from './fixtures';

describe('etsy spec', () => {
  it('is pack-only until the Open API v3 connector exists (plan phase 3)', () => {
    expect(spec.channels).toEqual(['pack']);
    expect(adapter.serialize).toBeUndefined();
    expect(spec.verified).toBe(false);
  });
});

describe('etsy format', () => {
  it('golden — a fully populated listing', () => {
    expect(snapshotOf(format(fullInput()))).toMatchSnapshot();
  });

  it('golden — a sparse listing', () => {
    expect(snapshotOf(format(sparseInput()))).toMatchSnapshot();
  });

  it('honours BOTH tag limits: 13 tags, 20 characters each', () => {
    const tags = format(fullInput()).tags;
    expect(tags).toHaveLength(13);                       // the fixture has 14
    for (const t of tags) expect(t.length).toBeLessThanOrEqual(20);
    expect(tags).toContain('90s streetwear');
  });

  it('answers Etsy’s three required questions from what the preset already collected', () => {
    expect(format(fullInput()).attributes).toMatchObject({
      who_made: 'someone_else',
      when_made: '1990s',
      is_supply: 'false',
    });
  });

  it('says "i_did" only when the listing says the seller made it', () => {
    const input = fullInput();
    const out = format({ ...input, item: { ...input.item, whoMadeIt: 'I made it' } });
    expect(out.attributes.who_made).toBe('i_did');
  });

  it('asks for an era rather than guessing a decade Etsy files vintage by', () => {
    expect(format(sparseInput()).issues).toContainEqual(expect.objectContaining({
      field: 'era', level: 'warning',
    }));
    expect(format(fullInput()).issues.some(i => i.field === 'era')).toBe(false);
  });

  it('files a used garment as Vintage — Etsy has no wear scale', () => {
    expect(format(fullInput()).condition).toBe('Vintage');
  });
});
