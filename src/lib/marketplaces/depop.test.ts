import { describe, it, expect } from 'vitest';
import { adapter, spec, format, serialize, DEPOP_COLUMNS } from './depop';
import { fullInput, sparseInput, snapshotOf, parseCsv, FULL_PHOTOS } from './fixtures';

describe('depop spec', () => {
  it('delivers as a bulk CSV and as a pack', () => {
    expect(spec.channels).toEqual(['feed', 'pack']);
    expect(adapter.serialize).toBeDefined();
  });

  it('is NOT verified — the bulk template is not published openly (see the module comment)', () => {
    expect(spec.verified).toBe(false);
  });
});

describe('depop format', () => {
  it('golden — a fully populated listing', () => {
    expect(snapshotOf(format(fullInput()))).toMatchSnapshot();
  });

  it('golden — a sparse listing', () => {
    expect(snapshotOf(format(sparseInput()))).toMatchSnapshot();
  });

  it('carries five hashtags and keeps them inside the 1,000-character description', () => {
    const out = format(fullInput());
    expect(out.tags).toHaveLength(5);
    expect(out.description.endsWith(out.tags.join(' '))).toBe(true);
    expect(out.description.length).toBeLessThanOrEqual(1000);
  });

  it('uses all five Depop words, with `poor` doubling up on the lowest', () => {
    expect(spec.condition.map.new_without_tags).toBe('Like new');
    expect(spec.condition.map.fair).toBe('Used - fair');
    expect(spec.condition.map.poor).toBe('Used - fair');
    expect(format(fullInput()).condition).toBe('Used - excellent');
  });

  it('claims a Source only when the listing says so', () => {
    const input = fullInput();
    expect(format(input).attributes.source).toBe('Vintage');
    expect('source' in format({ ...input, item: { ...input.item, era: '', style: '' } }).attributes).toBe(false);
  });

  it('warns about an unconfirmed brand — Depop has a picker', () => {
    expect(format(fullInput()).issues).toContainEqual(expect.objectContaining({
      field: 'brand', fixKind: 'brand', value: 'Nike',
    }));
  });
});

describe('depop serialize', () => {
  it('has one photo column per photo the spec allows', () => {
    expect(DEPOP_COLUMNS.filter(c => c.startsWith('photo_'))).toHaveLength(spec.photos.max);
  });

  it('every row has exactly as many cells as there are columns', () => {
    const feed = serialize([format(fullInput()), format(sparseInput())], { date: '2026-09-15' });
    const rows = parseCsv(feed.body);
    expect(rows).toHaveLength(3);
    for (const row of rows) expect(row).toHaveLength(DEPOP_COLUMNS.length);
    expect(feed.filename).toBe('depop-listings-2026-09-15.csv');
  });

  it('pads the unused photo columns rather than shortening the row', () => {
    const [, row] = parseCsv(serialize([format(fullInput())], { date: '2026-09-15' }).body);
    const first = DEPOP_COLUMNS.indexOf('photo_1');
    expect(row.slice(first, first + 3)).toEqual([...FULL_PHOTOS]);
    expect(row.slice(first + 3)).toEqual(['', '', '', '', '']);
  });

  it('golden — the bulk CSV', () => {
    expect(serialize([format(fullInput()), format(sparseInput())], { date: '2026-09-15' })).toMatchSnapshot();
  });
});
