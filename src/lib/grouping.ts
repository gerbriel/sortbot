import type { ClothingItem } from '../App';

/**
 * grouping — Step 3's display group builder, extracted from
 * ProductDescriptionGenerator so the grouping rules are unit-testable.
 *
 * THE BUG THIS FIXED (July 2026): grouping features (Group Selected, auto-group
 * by N) assign a FRESH crypto.randomUUID() as productGroup, but the old
 * validation here only accepted a productGroup that matched some item's id
 * (the "leader" convention from CLAUDE.md §11). Fresh-UUID groups failed that
 * check and every item silently became its own listing — Step 3's Next/Prev
 * cycled per-image instead of per-product (the long-standing §16 mystery bug,
 * reproduced live with a 42-image / 11-group batch).
 *
 * The tolerant rule below accepts BOTH conventions, so historical batches
 * grouped with fresh UUIDs heal without regrouping:
 *   a productGroup value is a REAL group id when
 *     (a) it equals some item's id in the list (leader convention), OR
 *     (b) at least two items in the list share it (fresh-UUID convention).
 *   Anything else is a stale reference from another batch → singleton.
 */

/** Step-3 visibility rule (commit 0922eca): only categorized items and true
 *  multi-image groups are shown/navigable; uncategorized singles stay in
 *  Step 2. Exported for reuse and tests. */
export function filterStep3Visible(allItems: ClothingItem[]): ClothingItem[] {
  const groupCounts: Record<string, number> = {};
  for (const i of allItems) {
    const g = i.productGroup || i.id;
    groupCounts[g] = (groupCounts[g] || 0) + 1;
  }
  return allItems.filter(i => i.category || (groupCounts[i.productGroup || i.id] || 0) > 1);
}

/** Build the display group array with groups-first ordering. Takes the FULL
 *  item list (the workflowStore list) and applies the visibility filter. */
export function buildGroupArray(allItems: ClothingItem[]): ClothingItem[][] {
  const items = filterStep3Visible(allItems);
  const itemIds = new Set(items.map(i => i.id));

  // How many items share each productGroup value — a shared value is a real
  // group even when it isn't any item's id (fresh-UUID groups).
  const sharedCounts: Record<string, number> = {};
  for (const i of items) {
    if (i.productGroup) sharedCounts[i.productGroup] = (sharedCounts[i.productGroup] || 0) + 1;
  }

  const productGroups = items.reduce((groups, item, idx) => {
    const pg = item.productGroup;
    const isRealGroup = !!pg && (itemIds.has(pg) || (sharedCounts[pg] || 0) >= 2);
    const groupId = isRealGroup ? pg! : item.id;
    if (!groups[groupId]) groups[groupId] = { items: [], firstIdx: idx };
    groups[groupId].items.push(item);
    return groups;
  }, {} as Record<string, { items: ClothingItem[]; firstIdx: number }>);

  // Sort: multi-item groups first, then singles — stable tiebreaker is the index
  // of the first photo in that group within the original items array, so order
  // never shuffles when processedItems state updates.
  return Object.values(productGroups)
    .sort((a, b) => {
      const aMulti = a.items.length > 1 ? 0 : 1;
      const bMulti = b.items.length > 1 ? 0 : 1;
      if (aMulti !== bMulti) return aMulti - bMulti;
      return a.firstIdx - b.firstIdx; // stable tiebreaker
    })
    .map(g => g.items);
}
