import { describe, it, expect } from 'vitest';
import { buildGroupArray, filterStep3Visible } from './grouping';
import type { ClothingItem } from '../App';

/**
 * Locks the July 2026 fix for "Next/Prev cycles per-image instead of
 * per-product-group": grouping features assigned fresh-UUID productGroups,
 * which the old leader-only validation rejected — every item silently became
 * its own listing. The tolerant rule accepts both group-id conventions.
 */

const item = (id: string, o: Partial<ClothingItem> = {}): ClothingItem =>
  ({ id, ...o } as unknown as ClothingItem);

describe('buildGroupArray — group id conventions', () => {
  it('groups leader-convention items (productGroup === leader item id)', () => {
    const groups = buildGroupArray([
      item('a', { productGroup: 'a', category: 'tees' }),
      item('b', { productGroup: 'a', category: 'tees' }),
      item('c', { productGroup: 'a', category: 'tees' }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(3);
  });

  it('groups fresh-UUID-convention items (shared productGroup that is no item id) — THE bug', () => {
    const groups = buildGroupArray([
      item('a', { productGroup: 'uuid-1', category: 'tees' }),
      item('b', { productGroup: 'uuid-1', category: 'tees' }),
      item('c', { productGroup: 'uuid-2', category: 'hats' }),
      item('d', { productGroup: 'uuid-2', category: 'hats' }),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups.map(g => g.length)).toEqual([2, 2]);
  });

  it('reproduces the users 42-image / 11-group auto-group batch correctly', () => {
    // Auto-group by 4: 42 items → 10 chunks of 4 + 1 chunk of 2, fresh UUID per chunk
    const items: ClothingItem[] = [];
    for (let i = 0; i < 42; i++) {
      items.push(item(`img-${i}`, { productGroup: `chunk-uuid-${Math.floor(i / 4)}`, category: 'mens-shirts' }));
    }
    const groups = buildGroupArray(items);
    expect(groups).toHaveLength(11);          // NOT 42 — one listing per product
    expect(groups[0].length).toBe(4);
    expect(groups[10].length).toBe(2);        // the remainder chunk
  });

  it('still treats a STALE foreign productGroup (single occurrence, not an item id) as a singleton', () => {
    const groups = buildGroupArray([
      item('a', { productGroup: 'deleted-item-from-other-batch', category: 'tees' }),
      item('b', { productGroup: 'b', category: 'tees' }),
    ]);
    expect(groups).toHaveLength(2);
    for (const g of groups) expect(g).toHaveLength(1);
  });

  it('orders multi-image groups before singles, stable by first appearance', () => {
    const groups = buildGroupArray([
      item('single1', { category: 'tees' }),
      item('g1a', { productGroup: 'g1a', category: 'tees' }),
      item('g1b', { productGroup: 'g1a', category: 'tees' }),
      item('single2', { category: 'hats' }),
    ]);
    expect(groups[0].map(i => i.id)).toEqual(['g1a', 'g1b']); // multi first
    expect(groups[1][0].id).toBe('single1');                   // then singles in order
    expect(groups[2][0].id).toBe('single2');
  });
});

describe('filterStep3Visible (commit 0922eca rule)', () => {
  it('hides uncategorized singles, keeps categorized singles and any multi-group member', () => {
    const visible = filterStep3Visible([
      item('loose'),                                        // uncategorized single → hidden
      item('catSingle', { category: 'tees' }),              // categorized single → shown
      item('m1', { productGroup: 'uuid-9' }),               // uncategorized but grouped → shown
      item('m2', { productGroup: 'uuid-9' }),
    ]);
    expect(visible.map(i => i.id)).toEqual(['catSingle', 'm1', 'm2']);
  });

  it('never mutates or drops items from the input list', () => {
    const input = [item('a'), item('b', { category: 'tees' })];
    const before = [...input];
    filterStep3Visible(input);
    expect(input).toEqual(before);
  });
});
