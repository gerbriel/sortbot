import { describe, it, expect } from 'vitest';
import { adapter, spec, format } from './poshmark';
import { fullInput, sparseInput, snapshotOf, stubVocab } from './fixtures';

describe('poshmark spec', () => {
  it('is pack-only — Poshmark has no import and forbids automating the app', () => {
    expect(spec.channels).toEqual(['pack']);
    expect(adapter.serialize).toBeUndefined();
    expect(spec.verified).toBe(false);
  });
});

describe('poshmark format', () => {
  it('golden — a fully populated listing', () => {
    expect(snapshotOf(format(fullInput()))).toMatchSnapshot();
  });

  it('golden — a sparse listing', () => {
    expect(snapshotOf(format(sparseInput()))).toMatchSnapshot();
  });

  it('cuts the description to 1,500 characters and the title to 80', () => {
    const out = format(fullInput());
    expect(out.title.length).toBeLessThanOrEqual(80);
    expect(out.description.length).toBeLessThanOrEqual(1500);
  });

  it('matches a colour on Poshmark’s own picker', () => {
    expect(format(fullInput()).color).toBe('Gray');  // "Grey" → Poshmark's spelling
  });

  it('WARNS on a colour the picker does not have instead of letting Poshmark default it', () => {
    const out = format(sparseInput());
    expect(out.color).toBe('Forest Green');   // no fallback configured — sent as typed
    expect(out.issues).toContainEqual(expect.objectContaining({
      field: 'color', level: 'warning', value: 'Forest Green', fixKind: 'color',
    }));
  });

  it('a workspace mapping silences the warning', () => {
    const out = format(sparseInput({ vocab: stubVocab({ 'color:poshmark:forest green': 'Green' }) }));
    expect(out.color).toBe('Green');
    expect(out.issues.some(i => i.field === 'color')).toBe(false);
  });

  it('warns about a brand Poshmark’s picker has not confirmed — and never blanks it', () => {
    const out = format(fullInput());
    expect(out.brand).toBe('Nike');
    expect(out.issues).toContainEqual(expect.objectContaining({
      field: 'brand', level: 'warning', value: 'Nike', fixKind: 'brand',
    }));
  });

  it('warns when there is no brand at all', () => {
    expect(format(sparseInput()).issues).toContainEqual(expect.objectContaining({
      field: 'brand', level: 'warning', message: 'No brand set — Poshmark needs one.',
    }));
  });

  it('shows the compare-at as Poshmark’s struck-through original price', () => {
    expect(format(fullInput()).attributes['Original price']).toBe('60.00');
  });
});
