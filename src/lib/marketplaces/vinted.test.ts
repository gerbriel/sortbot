import { describe, it, expect } from 'vitest';
import { adapter, spec, format } from './vinted';
import { fullInput, sparseInput, snapshotOf } from './fixtures';

describe('vinted spec', () => {
  it('is pack-only', () => {
    expect(spec.channels).toEqual(['pack']);
    expect(adapter.serialize).toBeUndefined();
    expect(spec.verified).toBe(false);
  });
});

describe('vinted format', () => {
  it('golden — a fully populated listing', () => {
    expect(snapshotOf(format(fullInput()))).toMatchSnapshot();
  });

  it('golden — a sparse listing', () => {
    expect(snapshotOf(format(sparseInput()))).toMatchSnapshot();
  });

  it('matches Grey against Vinted’s "Grey" and falls an unlisted colour to Multi', () => {
    expect(format(fullInput()).color).toBe('Grey');
    const sparse = format(sparseInput());
    expect(sparse.color).toBe('Multi');
    expect(sparse.issues).toContainEqual(expect.objectContaining({
      field: 'color', value: 'Forest Green', fixKind: 'color',
    }));
  });

  it('rounds `poor` UP to Satisfactory — Vinted has no lower grade — and surfaces the flaws', () => {
    expect(spec.condition.map.poor).toBe('Satisfactory');
    expect(spec.condition.map.fair).toBe('Satisfactory');
    expect(format(fullInput()).attributes.Flaws).toBe('small mark on the left cuff');
  });

  it('uses Vinted’s own five words', () => {
    expect(spec.condition.values).toEqual([
      'New with tags', 'New without tags', 'Very good', 'Good', 'Satisfactory',
    ]);
    expect(format(fullInput()).condition).toBe('Very good');
  });
});
