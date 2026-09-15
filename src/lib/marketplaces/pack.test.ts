import { describe, it, expect } from 'vitest';
import { buildListingPack, packToText } from './pack';
import { getAdapter } from './registry';
import { fullInput, sparseInput } from './fixtures';

const packFor = (key: Parameters<typeof getAdapter>[0], input = fullInput()) =>
  buildListingPack(getAdapter(key).format(input));

describe('buildListingPack', () => {
  it('golden — the Poshmark pack for a full listing', () => {
    expect(packFor('poshmark')).toMatchSnapshot();
  });

  it('golden — the eBay pack, item specifics included', () => {
    expect(packFor('ebay')).toMatchSnapshot();
  });

  it('labels every field and copies as text', () => {
    const pack = packFor('poshmark');
    expect(pack.fields.map(f => f.label).slice(0, 8)).toEqual([
      'Title', 'Description', 'Brand', 'Size', 'Color', 'Condition', 'Category', 'Price',
    ]);
    for (const f of pack.fields) {
      expect(f.copyAs).toBe('text');
      expect(f.value.trim()).not.toBe('');
    }
  });

  it('omits a field with no value — a copy button that copies nothing is a dead control', () => {
    const pack = packFor('poshmark', sparseInput());
    expect(pack.fields.map(f => f.label)).not.toContain('Price');
    // …and the reason is still on the record.
    expect(pack.issues).toContainEqual(expect.objectContaining({ field: 'price', level: 'error' }));
  });

  it('writes the price as a bare number — every price box here rejects "$45.00"', () => {
    const price = packFor('poshmark').fields.find(f => f.label === 'Price');
    expect(price?.value).toBe('45.00');
  });

  it('does not repeat hashtags that are already the end of the description', () => {
    // Mercari has no tag field — the hashtags are typed into the body, and the
    // body is already carrying them.
    const mercari = packFor('mercari');
    expect(mercari.fields.map(f => f.label)).not.toContain('Hashtags');
    expect(mercari.fields.find(f => f.label === 'Description')?.value)
      .toMatch(/#\S+ #\S+ #\S+$/);
  });

  it('gives a real tag field its own row, joined the way it is pasted', () => {
    const etsy = packFor('etsy').fields.find(f => f.label === 'Tags');
    expect(etsy?.value).toContain(', ');
    expect(etsy?.value.split(', ')).toHaveLength(13);
  });

  it('adds the marketplace’s own attributes after the standard fields', () => {
    const labels = packFor('ebay').fields.map(f => f.label);
    expect(labels).toContain('Department');
    expect(labels).toContain('Decade');
    // "Brand" is already a standard field — eBay's Brand specific is not repeated.
    expect(labels.filter(l => l === 'Brand')).toHaveLength(1);
  });

  it('does not repeat a standard field under a marketplace’s alias', () => {
    // Grailed's "Designer" IS the brand.
    const labels = packFor('grailed').fields.map(f => f.label);
    expect(labels).toContain('Brand');
    expect(labels).toContain('Designer');   // Grailed's own name for it, shown once
    expect(labels.filter(l => l === 'Designer')).toHaveLength(1);
  });

  it('carries the photos in publish order and the issues unchanged', () => {
    const formatted = getAdapter('poshmark').format(fullInput());
    const pack = buildListingPack(formatted);
    expect(pack.photos).toEqual(formatted.photos);
    expect(pack.issues).toEqual(formatted.issues);
  });

  it('copies the arrays rather than aliasing the formatted listing', () => {
    const formatted = getAdapter('poshmark').format(fullInput());
    const pack = buildListingPack(formatted);
    pack.photos.push('https://evil.example/x.jpg');
    pack.issues.length = 0;
    expect(formatted.photos).toHaveLength(3);
    expect(formatted.issues.length).toBeGreaterThan(0);
  });
});

describe('packToText', () => {
  it('is one labelled block per field, blank-line separated', () => {
    const text = packToText(packFor('poshmark'));
    expect(text.startsWith('Title\nVintage 90s Nike')).toBe(true);
    expect(text).toContain('\n\nPrice\n45.00');
  });

  it('leaves the photos OUT — a list of CDN URLs pasted into a description is a bug', () => {
    const pack = packFor('poshmark');
    const text = packToText(pack);
    for (const url of pack.photos) expect(text).not.toContain(url);
  });

  it('golden — the copy-all block', () => {
    expect(packToText(packFor('mercari'))).toMatchSnapshot();
  });
});
