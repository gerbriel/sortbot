import type { CategoryPreset } from './categoryPresets';

/**
 * presetResolver — the ONE "which preset applies to this category" rule.
 *
 * There were two implementations that had silently diverged:
 *   applyPresetToGroup.ts  (3 steps) — used by ProductDescriptionGenerator
 *   CategoryZones.tsx      (4 steps) — adds the "<name>_default…" prefix match
 *                                     that createCategory's auto-created preset
 *                                     is named with
 * Both are preserved exactly: the 4th step is opt-in via `allowDefaultPrefix`, so
 * routing either caller through this resolver cannot change which preset it picks.
 *
 * The only other difference between the two copies was how they spelled "active":
 * CategoryZones used `is_active !== false`, applyPresetToGroup used truthiness.
 * Those agree for every value `CategoryPreset` permits (`is_active: boolean`, not
 * optional), so this resolver uses `!== false` — the more forgiving spelling, and
 * the one already in front of the drag-and-drop path.
 *
 * The important consequence is at the CALL SITES: `resolvePreset` is synchronous
 * and takes the preset list as an argument, so callers use the list they already
 * hold. PDG used to call the async `applyPresetToProductGroup` once per group in a
 * loop, and each call issued its own uncached `getCategoryPresets()` round trip —
 * 100 groups meant 100 sequential fetches on Step-3 mount. That was already fixed
 * in CategoryZones (commits 55a46f0, b0a41a6); this closes it for good.
 */

export interface ResolvePresetOptions {
  /**
   * Also accept a preset whose `category_name` starts with `<categoryName>_default`
   * — the auto-created naming from `createCategory`. CategoryZones passes true;
   * the Step-3 paths never did, so they must not start.
   */
  allowDefaultPrefix?: boolean;
}

export function resolvePreset(
  presets: readonly CategoryPreset[] | undefined,
  categoryName: string | undefined,
  { allowDefaultPrefix = false }: ResolvePresetOptions = {},
): CategoryPreset | undefined {
  if (!categoryName || !presets?.length) return undefined;
  const lower = categoryName.toLowerCase();
  const active = presets.filter(p => p.is_active !== false);

  return (
    // 1. exact product_type match, default preferred
    active.find(p => p.product_type?.toLowerCase() === lower && p.is_default) ??
    // 2. any exact product_type match
    active.find(p => p.product_type?.toLowerCase() === lower) ??
    // 3. legacy category_name match
    active.find(p => p.category_name?.toLowerCase() === lower) ??
    // 4. opt-in: the "<name>_default_<rand>" naming from createCategory
    (allowDefaultPrefix
      ? active.find(p => p.category_name?.toLowerCase().startsWith(`${lower}_default`))
      : undefined)
  );
  // NO wild fallback to "any is_default preset" — that applied another category's
  // shipping defaults to unmatched categories, and was removed in the July 2026
  // preset audit. An unmatched category gets a plain category assignment.
}
