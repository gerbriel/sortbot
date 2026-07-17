import { describe, it, expect } from 'vitest';
import {
  MIN_RANK_GAP,
  RANK_STEP,
  byRank,
  computeDropRank,
  dropIndexBefore,
  initialRanks,
  needsRebalance,
  rankBetween,
  rebalance,
} from './rank';

/**
 * Locks the drag-and-drop ordering math. The two failures these exist to catch:
 *   1. The drop-index off-by-one — moving a card DOWN its own lane must account
 *      for the card being lifted out first, or every downward drag lands one
 *      slot short.
 *   2. Silent rank ties from float exhaustion after repeated drops into the
 *      same slot. Ordering must never become non-deterministic; needsRebalance
 *      has to fire BEFORE that happens.
 * Both are invisible in a UI test and permanent once shipped.
 */

const lane = (...ids: string[]) => ids.map((id, i) => ({ id, rank: (i + 1) * RANK_STEP }));

/** Apply a computed rank and re-sort, i.e. what the board renders after a drop. */
const applyDrop = (items: { id: string; rank: number }[], movingId: string, toIndex: number) => {
  const rank = computeDropRank(items, toIndex, movingId);
  return items
    .map(i => (i.id === movingId ? { ...i, rank } : i))
    .sort((a, b) => byRank(a, b))
    .map(i => i.id);
};

describe('rankBetween', () => {
  it('gives a valid rank for an empty lane', () => {
    expect(rankBetween(null, null)).toBe(RANK_STEP);
  });

  it('lands strictly before the head and strictly after the tail', () => {
    expect(rankBetween(null, 1000)).toBeLessThan(1000);
    expect(rankBetween(1000, null)).toBeGreaterThan(1000);
  });

  it('lands strictly between two neighbours', () => {
    const r = rankBetween(1000, 2000);
    expect(r).toBeGreaterThan(1000);
    expect(r).toBeLessThan(2000);
  });

  it('stays strictly between even for adjacent-as-possible neighbours', () => {
    const r = rankBetween(1000, 1000.0001);
    expect(r).toBeGreaterThan(1000);
    expect(r).toBeLessThan(1000.0001);
  });
});

describe('initialRanks', () => {
  it('is evenly spaced and ascending', () => {
    expect(initialRanks(3)).toEqual([1000, 2000, 3000]);
  });

  it('returns [] for a count of 0', () => {
    expect(initialRanks(0)).toEqual([]);
  });
});

describe('computeDropRank — within the same lane', () => {
  it('moving DOWN accounts for the moving card being lifted out — THE off-by-one', () => {
    // [a,b,c,d,e]; grab b, drop at index 3 of the list you can see (= [a,c,d,e]).
    // It must land between d and e, giving [a,c,d,b,e] — NOT [a,c,b,d,e].
    expect(applyDrop(lane('a', 'b', 'c', 'd', 'e'), 'b', 3)).toEqual(['a', 'c', 'd', 'b', 'e']);
  });

  it('moving UP lands where it was dropped', () => {
    expect(applyDrop(lane('a', 'b', 'c', 'd', 'e'), 'd', 1)).toEqual(['a', 'd', 'b', 'c', 'e']);
  });

  it('dropping at index 0 makes it the head', () => {
    expect(applyDrop(lane('a', 'b', 'c'), 'c', 0)).toEqual(['c', 'a', 'b']);
  });

  it('dropping past the end makes it the tail', () => {
    expect(applyDrop(lane('a', 'b', 'c'), 'a', 99)).toEqual(['b', 'c', 'a']);
  });

  it('dropping a card back where it already is, is a no-op (idempotent)', () => {
    const before = lane('a', 'b', 'c');
    expect(applyDrop(before, 'b', 1)).toEqual(['a', 'b', 'c']);
    // …and again, to prove it does not drift on repeat drops.
    const rank = computeDropRank(before, 1, 'b');
    const after = before.map(i => (i.id === 'b' ? { ...i, rank } : i));
    expect(applyDrop(after, 'b', 1)).toEqual(['a', 'b', 'c']);
  });
});

describe('computeDropRank — arriving from another lane', () => {
  it('inserts into an empty lane', () => {
    expect(computeDropRank([], 0, null)).toBe(RANK_STEP);
  });

  it('inserts between two existing cards without lifting anything out', () => {
    const r = computeDropRank(lane('a', 'b'), 1, null);
    expect(r).toBeGreaterThan(1000);
    expect(r).toBeLessThan(2000);
  });

  it('inserts at the head and the tail', () => {
    expect(computeDropRank(lane('a', 'b'), 0, null)).toBeLessThan(1000);
    expect(computeDropRank(lane('a', 'b'), 2, null)).toBeGreaterThan(2000);
  });

  it('clamps an out-of-range index instead of producing NaN', () => {
    expect(Number.isFinite(computeDropRank(lane('a', 'b'), -5, null))).toBe(true);
    expect(Number.isFinite(computeDropRank(lane('a', 'b'), 999, null))).toBe(true);
  });
});

describe('dropIndexBefore — dropping ON a card lands ABOVE it', () => {
  const l = lane('a', 'b', 'c', 'd', 'e');

  /** The full round trip the board performs on a drop. */
  const dropOn = (movingId: string, targetId: string) => {
    const toIndex = dropIndexBefore(l, movingId, targetId);
    return applyDrop(l, movingId, toIndex);
  };

  it('dragging DOWN onto a card lands directly above it — not one slot late', () => {
    // Drop b onto d: the indicator sits on d's top edge, so b goes above d.
    expect(dropOn('b', 'd')).toEqual(['a', 'c', 'b', 'd', 'e']);
  });

  it('dragging UP onto a card lands directly above it', () => {
    expect(dropOn('d', 'b')).toEqual(['a', 'd', 'b', 'c', 'e']);
  });

  it('dropping onto the head makes it the new head', () => {
    expect(dropOn('e', 'a')).toEqual(['e', 'a', 'b', 'c', 'd']);
  });

  it('measures against the lane WITHOUT the dragged card', () => {
    // d sits at index 3 of the full lane, but index 2 once b is lifted out.
    expect(dropIndexBefore(l, 'b', 'd')).toBe(2);
    // Nothing lifted out (a card arriving from another lane) → its real index.
    expect(dropIndexBefore(l, 'none', 'd')).toBe(3);
  });

  it('appends when the target is unknown', () => {
    expect(dropIndexBefore(l, 'b', 'ghost')).toBe(4); // lane without b is 4 long
  });
});

describe('needsRebalance / rebalance', () => {
  it('is false for a fresh lane and for lanes too short to tie', () => {
    expect(needsRebalance([])).toBe(false);
    expect(needsRebalance([1000])).toBe(false);
    expect(needsRebalance([1000, 2000, 3000])).toBe(false);
  });

  it('fires once a gap collapses', () => {
    expect(needsRebalance([1000, 1000 + MIN_RANK_GAP / 2])).toBe(true);
  });

  it('repeated inserts into the SAME slot trip the guard before ranks can tie', () => {
    // The real exhaustion path: every new card goes into the tightest slot
    // (index 1), so the gap halves each time — 1000 → 500 → 250 → …
    let items = lane('a', 'b');
    let tripped = false;
    let inserts = 0;
    for (let i = 0; i < 200; i++) {
      const id = `z${i}`;
      const rank = computeDropRank(items, 1, null);
      items = [...items.slice(0, 1), { id, rank }, ...items.slice(1)];
      inserts++;
      // Every insert must land in the slot the user aimed at, right up until
      // the guard fires — a tie here would be a silent ordering bug.
      expect(items.map(x => x.id)).toEqual([...items].sort((x, y) => byRank(x, y)).map(x => x.id));
      if (needsRebalance(items.map(x => x.rank))) { tripped = true; break; }
    }
    expect(tripped).toBe(true);
    // Conservative by design: the guard fires with float64 precision to spare.
    expect(inserts).toBeLessThan(30);
  });

  it('rebalance preserves visible order and restores even spacing', () => {
    const squished = [
      { id: 'a', rank: 1000 },
      { id: 'b', rank: 1000.0001 },
      { id: 'c', rank: 1000.0002 },
    ];
    const fixed = rebalance(squished);
    expect(fixed.map(f => f.id)).toEqual(['a', 'b', 'c']);
    expect(fixed.map(f => f.rank)).toEqual([1000, 2000, 3000]);
    expect(needsRebalance(fixed.map(f => f.rank))).toBe(false);
  });

  it('rebalance does not mutate its input', () => {
    const input = lane('a', 'b');
    const copy = JSON.parse(JSON.stringify(input));
    rebalance(input);
    expect(input).toEqual(copy);
  });
});

describe('byRank', () => {
  it('orders by rank ascending', () => {
    expect([{ id: 'b', rank: 2 }, { id: 'a', rank: 1 }].sort(byRank).map(x => x.id)).toEqual(['a', 'b']);
  });

  it('breaks ties on id so equal ranks still render in a stable order', () => {
    const tied = [{ id: 'b', rank: 1 }, { id: 'a', rank: 1 }];
    expect([...tied].sort(byRank).map(x => x.id)).toEqual(['a', 'b']);
    expect([...tied].reverse().sort(byRank).map(x => x.id)).toEqual(['a', 'b']);
  });
});
