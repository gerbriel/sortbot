import { describe, it, expect } from 'vitest';
import { adapter, spec, format } from './mercari';
import { fullInput, sparseInput, snapshotOf } from './fixtures';

describe('mercari spec', () => {
  it('is pack-only, with the tightest title in the set', () => {
    expect(spec.channels).toEqual(['pack']);
    expect(adapter.serialize).toBeUndefined();
    expect(spec.title.max).toBe(40);
    expect(spec.verified).toBe(false);
  });
});

describe('mercari format', () => {
  it('golden — a fully populated listing', () => {
    expect(snapshotOf(format(fullInput()))).toMatchSnapshot();
  });

  it('golden — a sparse listing', () => {
    expect(snapshotOf(format(sparseInput()))).toMatchSnapshot();
  });

  it('cuts the 40-character title on a word, never mid-word', () => {
    const out = format(fullInput());
    expect(out.title).toBe('Vintage 90s Nike Grey Embroidered Swoosh');
    expect(out.title.length).toBeLessThanOrEqual(40);
  });

  it('carries exactly three hashtags, in the description as well as the field', () => {
    const out = format(fullInput());
    expect(out.tags).toHaveLength(3);
    for (const t of out.tags) expect(t.startsWith('#')).toBe(true);
    expect(out.description.endsWith(out.tags.join(' '))).toBe(true);
    expect(out.description.length).toBeLessThanOrEqual(1000);
  });

  it('uses Mercari’s own five-step scale', () => {
    expect(spec.condition.values).toEqual(['New', 'Like new', 'Good', 'Fair', 'Poor']);
    expect(format(fullInput()).condition).toBe('Like new');  // canonical `excellent`
  });
});
