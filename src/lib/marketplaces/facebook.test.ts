import { describe, it, expect } from 'vitest';
import { adapter, spec, format, serialize, FACEBOOK_COLUMNS } from './facebook';
import { fullInput, sparseInput, snapshotOf, parseCsv, FULL_PHOTOS } from './fixtures';

describe('facebook spec', () => {
  it('delivers as a catalog feed and as a pack', () => {
    expect(spec.channels).toEqual(['feed', 'pack']);
    expect(adapter.serialize).toBeDefined();
    expect(spec.verified).toBe(false);
  });
});

describe('facebook format', () => {
  it('golden — a fully populated listing', () => {
    expect(snapshotOf(format(fullInput()))).toMatchSnapshot();
  });

  it('golden — a sparse listing', () => {
    expect(snapshotOf(format(sparseInput()))).toMatchSnapshot();
  });

  it('uses the catalog’s three condition words, not a wear scale', () => {
    expect(spec.condition.values).toEqual(['new', 'refurbished', 'used']);
    expect(format(fullInput()).condition).toBe('used');
  });

  it('raises an ERROR for a missing condition — a required column loses the whole row', () => {
    const issues = format(sparseInput()).issues;
    const condition = issues.find(i => i.field === 'condition');
    expect(condition?.level).toBe('error');
    expect(condition?.message).toContain('rejects the catalog row');
  });

  it('fills the required brand column with Facebook’s own no-brand value', () => {
    expect(format(sparseInput()).brand).toBe('Unbranded');
  });

  it('maps gender and age group onto the catalog’s vocabularies', () => {
    const a = format(fullInput()).attributes;
    expect(a.gender).toBe('male');
    expect(a.age_group).toBe('adult');
    expect(a.availability).toBe('in stock');
  });

  it('uses the SKU as the catalog id, falling back to the group id', () => {
    expect(format(fullInput()).attributes.id).toBe('ACD-7K2M9Q');
    expect(format(sparseInput()).attributes.id).toBe('sparse-1');
  });
});

describe('facebook serialize', () => {
  it('has the nine required columns first', () => {
    expect(FACEBOOK_COLUMNS.slice(0, 9)).toEqual([
      'id', 'title', 'description', 'availability', 'condition', 'price', 'link', 'image_link', 'brand',
    ]);
  });

  it('writes the price with its currency in the cell', () => {
    const body = serialize([format(fullInput())], { date: '2026-09-15' }).body;
    expect(body).toContain('45.00 USD');
  });

  it('puts the first photo in image_link and the rest in additional_image_link', () => {
    const [, row] = parseCsv(serialize([format(fullInput())], { date: '2026-09-15' }).body);
    expect(row[FACEBOOK_COLUMNS.indexOf('image_link')]).toBe(FULL_PHOTOS[0]);
    expect(row[FACEBOOK_COLUMNS.indexOf('additional_image_link')])
      .toBe(`${FULL_PHOTOS[1]},${FULL_PHOTOS[2]}`);
  });

  it('every row has exactly as many cells as there are columns', () => {
    const feed = serialize([format(fullInput()), format(sparseInput())], { date: '2026-09-15' });
    const rows = parseCsv(feed.body);
    expect(rows).toHaveLength(3);   // header + two listings
    for (const row of rows) expect(row).toHaveLength(FACEBOOK_COLUMNS.length);
    expect(feed.count).toBe(2);
    expect(feed.filename).toBe('facebook-catalog-2026-09-15.csv');
  });

  it('golden — the catalog CSV', () => {
    expect(serialize([format(fullInput()), format(sparseInput())], { date: '2026-09-15' })).toMatchSnapshot();
  });
});
