import { describe, it, expect } from 'vitest';
import { adapter, spec, format, serialize, WHATNOT_COLUMNS } from './whatnot';
import { fullInput, sparseInput, snapshotOf, parseCsv } from './fixtures';

describe('whatnot spec', () => {
  it('delivers as a bulk CSV and as a pack', () => {
    expect(spec.channels).toEqual(['feed', 'pack']);
    expect(adapter.serialize).toBeDefined();
  });

  it('is NOT verified — the template shape is from memory (see the module comment)', () => {
    expect(spec.verified).toBe(false);
  });
});

describe('whatnot format', () => {
  it('golden — a fully populated listing', () => {
    expect(snapshotOf(format(fullInput()))).toMatchSnapshot();
  });

  it('golden — a sparse listing', () => {
    expect(snapshotOf(format(sparseInput()))).toMatchSnapshot();
  });

  it('lists as Buy it Now — an auction is a per-stream decision, not an export default', () => {
    expect(format(fullInput()).attributes.Type).toBe('Buy it Now');
    expect(format(fullInput()).attributes.Quantity).toBe('1');
  });

  it('leaves the Shipping Profile blank — it is named inside the seller’s own account', () => {
    expect('Shipping Profile' in format(fullInput()).attributes).toBe(false);
    const [, row] = parseCsv(serialize([format(fullInput())], { date: '2026-09-15' }).body);
    expect(row[WHATNOT_COLUMNS.indexOf('Shipping Profile')]).toBe('');
  });

  it('passes the canonical condition words through — Whatnot takes free text', () => {
    expect(format(fullInput()).condition).toBe('Excellent');
  });
});

describe('whatnot serialize', () => {
  it('has one image column per photo the spec allows', () => {
    expect(WHATNOT_COLUMNS.filter(c => c.startsWith('Image URL'))).toHaveLength(spec.photos.max);
  });

  it('every row has exactly as many cells as there are columns', () => {
    const feed = serialize([format(fullInput()), format(sparseInput())], { date: '2026-09-15' });
    const rows = parseCsv(feed.body);
    expect(rows).toHaveLength(3);
    for (const row of rows) expect(row).toHaveLength(WHATNOT_COLUMNS.length);
    expect(feed.filename).toBe('whatnot-listings-2026-09-15.csv');
  });

  it('golden — the bulk CSV', () => {
    expect(serialize([format(fullInput()), format(sparseInput())], { date: '2026-09-15' })).toMatchSnapshot();
  });
});
