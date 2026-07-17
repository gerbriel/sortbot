/**
 * kanban/rank — fractional ordering for drag-and-drop.
 *
 * WHY NOT `position: int`: renumbering a lane on every drop writes N rows, and
 * two people dragging at once overwrite each other's numbering. A fractional
 * rank writes exactly ONE row per drop (the midpoint between the two cards you
 * dropped between), so concurrent drags in different slots never collide.
 *
 * THE CATCH, and why needsRebalance exists: repeatedly dropping into the SAME
 * slot halves the gap each time. Left alone, float64 eventually returns a
 * midpoint equal to one of its neighbours and the order silently ties.
 * needsRebalance() fires long before that — at MIN_RANK_GAP, roughly 20 inserts
 * into one slot, with precision still to spare — and the caller then rewrites
 * the lane with rebalance() (the one place an N-row write is correct).
 *
 * Pure and deterministic: no Date.now(), no randomness, no I/O. See rank.test.ts.
 */

/** Gap between appended items. Large enough that ~20 midpoint inserts fit
 *  between any two neighbours before a rebalance is needed. */
export const RANK_STEP = 1000;

/** Below this, float64 midpoints are close to exhausting their precision and
 *  the lane should be rebalanced. Deliberately conservative — rebalancing early
 *  is cheap, rebalancing late is a silent ordering bug. */
export const MIN_RANK_GAP = 0.001;

/**
 * A rank strictly between two neighbours.
 *   rankBetween(null, null)  → the first item in an empty lane
 *   rankBetween(null, first) → the new head (before everything)
 *   rankBetween(last, null)  → the new tail (after everything)
 * Callers must pass the ranks of the ACTUAL neighbours at the drop slot;
 * computeDropRank() below works them out from a lane and an index.
 */
export function rankBetween(before: number | null, after: number | null): number {
  if (before === null && after === null) return RANK_STEP;
  if (before === null) return (after as number) - RANK_STEP;
  if (after === null) return before + RANK_STEP;
  return (before + after) / 2;
}

/** Evenly spaced ranks for `count` fresh items appended to an empty lane. */
export function initialRanks(count: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push((i + 1) * RANK_STEP);
  return out;
}

/** The comparator every consumer uses, so ordering can never drift between
 *  components. Ties break on id — two rows can share a rank only in the window
 *  before a rebalance, and even then the order must be stable across renders. */
export function byRank<T extends { rank: number; id: string }>(a: T, b: T): number {
  if (a.rank !== b.rank) return a.rank - b.rank;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * The rank for "the user dropped `movingId` at index `toIndex` of this lane".
 *
 * `laneItems` is the destination lane ALREADY SORTED by rank, exactly as
 * rendered. `movingId` is the dragged item's id when it is being reordered
 * WITHIN this lane, or null when it is arriving from another lane.
 *
 * The moving item is removed from the lane before the neighbours are read.
 * That is the whole off-by-one story: dragging the item at index 1 to index 3
 * of [a,b,c,d,e] must land it between `d` and `e` (→ [a,c,d,b,e]), not between
 * `c` and `d`. Indices refer to the list WITHOUT the item you are holding —
 * which is what the user sees while dragging.
 */
export function computeDropRank<T extends { id: string; rank: number }>(
  laneItems: ReadonlyArray<T>,
  toIndex: number,
  movingId: string | null,
): number {
  const rest = movingId === null ? [...laneItems] : laneItems.filter(i => i.id !== movingId);
  const idx = Math.max(0, Math.min(toIndex, rest.length));
  const before = idx > 0 ? rest[idx - 1].rank : null;
  const after = idx < rest.length ? rest[idx].rank : null;
  return rankBetween(before, after);
}

/**
 * The `toIndex` for "the user dropped ON `targetId`, so land ABOVE it" — the
 * promise the drop indicator (a top border on the hovered card) makes.
 *
 * The index is measured against the lane WITHOUT the dragged card, because that
 * is the list computeDropRank reads its neighbours from. Handing it the
 * target's index in the FULL lane instead lands the card one slot late on every
 * downward drag: the same off-by-one as computeDropRank's, one layer up. It
 * lives here, not in the component, so it can be tested.
 */
export function dropIndexBefore<T extends { id: string }>(
  laneItems: ReadonlyArray<T>,
  movingId: string,
  targetId: string,
): number {
  const rest = laneItems.filter(i => i.id !== movingId);
  const idx = rest.findIndex(i => i.id === targetId);
  return idx === -1 ? rest.length : idx; // unknown target → append
}

/**
 * True when the lane's ranks have degenerated far enough that the next drop
 * into the tightest slot could tie. Checks adjacent gaps on the sorted lane.
 */
export function needsRebalance(ranks: readonly number[]): boolean {
  if (ranks.length < 2) return false;
  const sorted = [...ranks].sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] - sorted[i - 1] < MIN_RANK_GAP) return true;
  }
  return false;
}

/**
 * Fresh evenly-spaced ranks in the lane's CURRENT visible order — the write
 * payload for a rebalance. Returns one entry per item; the caller writes them
 * all. Does not mutate the input.
 */
export function rebalance<T extends { id: string; rank: number }>(
  laneItems: ReadonlyArray<T>,
): Array<{ id: string; rank: number }> {
  return [...laneItems]
    .sort((a, b) => byRank(a, b))
    .map((item, i) => ({ id: item.id, rank: (i + 1) * RANK_STEP }));
}
