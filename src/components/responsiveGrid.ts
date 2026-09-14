/**
 * Grid column bounds for the Step 2 photo grid.
 *
 * The columns slider writes a raw number into `columnsPerRow`, and the grid
 * applies it as an INLINE `grid-template-columns`. Inline styles beat any media
 * query, so a phone layout cannot be expressed in CSS alone — the clamp has to
 * happen where the value is produced. These helpers are the single place that
 * decides how many columns a viewport may show, so the slider keeps working
 * (it just gets a phone-sized range) instead of being overridden into a no-op.
 *
 * Pure — no DOM, no React. Unit-tested in responsiveGrid.test.ts.
 */

/** Widest viewport still treated as a phone (matches the CSS breakpoint). */
export const PHONE_BREAKPOINT_PX = 640;

export const PHONE_MIN_COLUMNS = 1;
/** 3 columns at 390px leaves ~105px cards — still a comfortable tap target. */
export const PHONE_MAX_COLUMNS = 3;
export const DESKTOP_MIN_COLUMNS = 2;
export const DESKTOP_MAX_COLUMNS = 12;

/** Group cards carry a 3-up thumbnail strip, so they need more width than a single. */
export const PHONE_MAX_GROUP_COLUMNS = 2;

export interface GridColumnBounds {
  min: number;
  max: number;
}

/** Slider range for the current viewport class. */
export function gridColumnBounds(isPhone: boolean): GridColumnBounds {
  return isPhone
    ? { min: PHONE_MIN_COLUMNS, max: PHONE_MAX_COLUMNS }
    : { min: DESKTOP_MIN_COLUMNS, max: DESKTOP_MAX_COLUMNS };
}

/**
 * Clamp a requested column count into the range this viewport allows.
 * A desktop value of 8 becomes 3 on a phone without mutating the stored
 * preference, so rotating back to a wide viewport restores the user's choice.
 */
export function clampGridColumns(requested: number, isPhone: boolean): number {
  const { min, max } = gridColumnBounds(isPhone);
  if (!Number.isFinite(requested)) return min;
  return Math.min(Math.max(Math.round(requested), min), max);
}

/**
 * Column count for the product-GROUP grid. Group cards are denser than singles
 * (a header bar plus a thumbnail strip), so phones cap them tighter.
 */
export function clampGroupGridColumns(requested: number, isPhone: boolean): number {
  const cols = clampGridColumns(requested, isPhone);
  return isPhone ? Math.min(cols, PHONE_MAX_GROUP_COLUMNS) : cols;
}
