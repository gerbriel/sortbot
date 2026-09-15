import { describe, it, expect } from 'vitest';
import { adapter, spec, format } from './grailed';
import { fullInput, sparseInput, snapshotOf } from './fixtures';

describe('grailed spec', () => {
  it('is pack-only', () => {
    expect(spec.channels).toEqual(['pack']);
    expect(adapter.serialize).toBeUndefined();
    expect(spec.verified).toBe(false);
  });
});

describe('grailed format', () => {
  it('golden — a fully populated listing', () => {
    expect(snapshotOf(format(fullInput()))).toMatchSnapshot();
  });

  it('golden — a sparse listing', () => {
    expect(snapshotOf(format(sparseInput()))).toMatchSnapshot();
  });

  it('calls the brand a Designer and never blanks one Grailed has not confirmed', () => {
    const out = format(fullInput());
    expect(out.brand).toBe('Nike');
    expect(out.attributes.Designer).toBe('Nike');
    expect(out.issues).toContainEqual(expect.objectContaining({ field: 'brand', fixKind: 'brand' }));
  });

  it('splits the site by department and leaves Unisex for the seller', () => {
    const input = fullInput();
    expect(format(input).attributes.Department).toBe('Menswear');
    expect('Department' in format({ ...input, item: { ...input.item, gender: 'Unisex' } }).attributes).toBe(false);
  });

  it('maps the canonical scale onto Grailed’s four words', () => {
    expect(spec.condition.values).toEqual(['New', 'Gently used', 'Used', 'Very worn']);
    expect(spec.condition.map.excellent).toBe('Gently used');
    expect(spec.condition.map.poor).toBe('Very worn');
    expect(format(fullInput()).condition).toBe('Gently used');
  });

  it('cuts the title to 60 characters', () => {
    expect(format(fullInput()).title.length).toBeLessThanOrEqual(60);
  });
});
