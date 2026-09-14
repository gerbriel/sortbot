/**
 * magnifierPosition — keep the Step 3 zoom lens inside the viewport.
 *
 * The lens is `position: fixed` and was placed at `left: cursorX + 20` with the
 * vertical centre on the cursor, unclamped. Anywhere near an edge it hung off
 * the screen: on the right the zoomed region was simply cut away, and near the
 * top or bottom half the lens disappeared — which is founder report 17 ("the
 * magnifying glass ... should stay in visible area").
 *
 * Pure on purpose: the component owns mouse events and React state, this owns
 * the geometry, and the geometry is what has edge cases worth testing.
 *
 * The returned coordinates are the lens's true top-left, so the CSS rule must
 * NOT also apply a centring transform (it used to translate(0, -50%)).
 */

export interface LensPosition {
  left: number;
  top: number;
}

export interface ClampOptions {
  /** Gap between cursor and the lens's near edge. */
  offset?: number;
  /** Minimum gap between the lens and any viewport edge. */
  margin?: number;
}

const DEFAULT_OFFSET = 20;
const DEFAULT_MARGIN = 8;

/**
 * Where to paint a `size`×`size` lens for a cursor at (cursorX, cursorY).
 *
 * Horizontally the lens sits to the RIGHT of the cursor, and flips to the left
 * when that would overflow — flipping rather than sliding keeps the lens from
 * covering the pixel being inspected. Vertically it is centred on the cursor and
 * simply clamped, because there is nothing to dodge.
 *
 * A lens bigger than the viewport (possible: the size slider goes to 400 px on a
 * short window) clamps to the top-left margin rather than inverting.
 */
export function clampLensPosition(
  cursorX: number,
  cursorY: number,
  size: number,
  viewportW: number,
  viewportH: number,
  opts: ClampOptions = {},
): LensPosition {
  const offset = opts.offset ?? DEFAULT_OFFSET;
  const margin = opts.margin ?? DEFAULT_MARGIN;

  const maxLeft = Math.max(margin, viewportW - size - margin);
  const maxTop = Math.max(margin, viewportH - size - margin);

  let left = cursorX + offset;
  if (left + size > viewportW - margin) {
    const flipped = cursorX - offset - size;
    // Only flip if the left side actually has room; otherwise clamp on the right.
    left = flipped >= margin ? flipped : left;
  }

  return {
    left: Math.min(Math.max(left, margin), maxLeft),
    top: Math.min(Math.max(cursorY - size / 2, margin), maxTop),
  };
}
