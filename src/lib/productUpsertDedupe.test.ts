import { describe, it, expect } from 'vitest';
import {
  productUpsertKey, filterChangedForUpsert, rememberUpserted, type UpsertKeyedItem,
} from './productUpsertDedupe';

/**
 * The changed-rows filter for the 2 s `products` mirror upsert in
 * `handleImagesGrouped`. Moving ONE photo between groups used to re-upsert every
 * registerable item in the batch (800–1 500 rows). These tests pin what counts
 * as "changed" — and, just as importantly, that nothing here is ever allowed to
 * shrink the list handed to `pruneStaleProducts`, which DELETES by omission.
 */

const item = (over: Partial<UpsertKeyedItem> & { id: string }): UpsertKeyedItem => ({
  seoTitle: 'Vintage Tee',
  imageUrls: ['https://cdn/one.jpg'],
  storagePath: 'u1/p1/one.jpg',
  originalName: 'DSC0001.jpg',
  ...over,
});

describe('productUpsertKey', () => {
  it('is stable for an unchanged item', () => {
    const a = item({ id: 'i1', productGroup: 'g1' });
    expect(productUpsertKey(a)).toBe(productUpsertKey({ ...a }));
  });

  it('treats a missing productGroup as the item being its own leader', () => {
    // The upsert writes `product_group: item.productGroup || item.id`, so these
    // two produce the SAME row and must produce the same key.
    expect(productUpsertKey(item({ id: 'i1' })))
      .toBe(productUpsertKey(item({ id: 'i1', productGroup: 'i1' })));
  });

  it('changes when any mirrored field changes', () => {
    const base = productUpsertKey(item({ id: 'i1', productGroup: 'g1' }));
    expect(productUpsertKey(item({ id: 'i1', productGroup: 'g2' }))).not.toBe(base);
    expect(productUpsertKey(item({ id: 'i1', productGroup: 'g1', seoTitle: 'Other' }))).not.toBe(base);
    expect(productUpsertKey(item({ id: 'i1', productGroup: 'g1', imageUrls: ['https://cdn/two.jpg'] }))).not.toBe(base);
    expect(productUpsertKey(item({ id: 'i1', productGroup: 'g1', storagePath: 'u1/p1/two.jpg' }))).not.toBe(base);
    expect(productUpsertKey(item({ id: 'i1', productGroup: 'g1', originalName: 'DSC0002.jpg' }))).not.toBe(base);
  });

  it('only the PRIMARY image url is mirrored, so trailing images do not force a write', () => {
    // product_images is written with `imageUrls?.[0]` at position 0 only.
    const a = item({ id: 'i1', imageUrls: ['https://cdn/one.jpg'] });
    const b = item({ id: 'i1', imageUrls: ['https://cdn/one.jpg', 'https://cdn/two.jpg'] });
    expect(productUpsertKey(a)).toBe(productUpsertKey(b));
  });

  it('cannot blur two adjacent fields into each other', () => {
    // A naive '|' join would make these two equal.
    const a = item({ id: 'i1', productGroup: 'g', seoTitle: 'x', imageUrls: [], storagePath: '', originalName: '' });
    const b = item({ id: 'i1', productGroup: 'gx', seoTitle: '', imageUrls: [], storagePath: '', originalName: '' });
    expect(productUpsertKey(a)).not.toBe(productUpsertKey(b));
  });
});

describe('filterChangedForUpsert', () => {
  it('includes every item the map has never seen (fresh session / re-opened batch)', () => {
    const items = [item({ id: 'i1' }), item({ id: 'i2' }), item({ id: 'i3' })];
    expect(filterChangedForUpsert(items, new Map())).toHaveLength(3);
  });

  it('after a full write, an unchanged list filters down to NOTHING', () => {
    const seen = new Map<string, string>();
    const items = [item({ id: 'i1', productGroup: 'g1' }), item({ id: 'i2', productGroup: 'g1' })];
    rememberUpserted(items, seen);
    expect(filterChangedForUpsert(items, seen)).toEqual([]);
  });

  it('one photo moving groups sends ONE row, not all 800', () => {
    const seen = new Map<string, string>();
    const items = Array.from({ length: 800 }, (_, n) => item({ id: `i${n}`, productGroup: 'g1' }));
    rememberUpserted(items, seen);

    const moved = items.map(i => (i.id === 'i42' ? { ...i, productGroup: 'g2' } : i));
    const changed = filterChangedForUpsert(moved, seen);
    expect(changed).toHaveLength(1);
    expect(changed[0].id).toBe('i42');
  });

  it('a NEW item in an otherwise unchanged list is the only one written', () => {
    const seen = new Map<string, string>();
    const items = [item({ id: 'i1' }), item({ id: 'i2' })];
    rememberUpserted(items, seen);
    const changed = filterChangedForUpsert([...items, item({ id: 'i3' })], seen);
    expect(changed.map(i => i.id)).toEqual(['i3']);
  });

  it('a title edit alone still writes — the products.title mirror must not go stale', () => {
    const seen = new Map<string, string>();
    const items = [item({ id: 'i1', productGroup: 'g1', seoTitle: 'Old' })];
    rememberUpserted(items, seen);
    const changed = filterChangedForUpsert([{ ...items[0], seoTitle: 'New' }], seen);
    expect(changed).toHaveLength(1);
  });

  it('does not mutate the input list or the map', () => {
    const seen = new Map<string, string>();
    const items = [item({ id: 'i1' }), item({ id: 'i2' })];
    const before = JSON.stringify(items);
    filterChangedForUpsert(items, seen);
    expect(JSON.stringify(items)).toBe(before);
    expect(seen.size).toBe(0);   // reading never records
  });

  it('preserves order and identity of the items it returns', () => {
    const seen = new Map<string, string>();
    const a = item({ id: 'a' }), b = item({ id: 'b' }), c = item({ id: 'c' });
    rememberUpserted([b], seen);
    const changed = filterChangedForUpsert([a, b, c], seen);
    expect(changed).toEqual([a, c]);
    expect(changed[0]).toBe(a);
  });

  it('an item removed from the batch simply stops being offered — prune, not this, deletes it', () => {
    // Guards the trap documented in the module header: the filtered list must
    // never be what pruneStaleProducts receives.
    const seen = new Map<string, string>();
    const items = [item({ id: 'i1' }), item({ id: 'i2' })];
    rememberUpserted(items, seen);
    expect(filterChangedForUpsert([items[0]], seen)).toEqual([]);
    expect(seen.has('i2')).toBe(true); // stale key is harmless; it keys on id
  });
});
