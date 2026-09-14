/**
 * selectionGesture — the click/double-click arbitration for Step 2's photo grid.
 *
 * Founder report 30: "when multi-selecting, don't allow double-click to zoom in
 * on the photo. Keep it in selection mode until they are either deselected or
 * something."
 *
 * ── THE PROBLEM ─────────────────────────────────────────────────────────────
 *
 * A hardware double-click on a card emits
 *   mousedown → mouseup → mousedown → mouseup → dblclick
 * so the selection handler runs TWICE and the lightbox opens on top. Two
 * different bad outcomes came out of that, depending on the surface:
 *
 *   • singles grid — the 200 ms repeat guard (commit 7c4806f) eats the second
 *     toggle, so the item ends up SELECTED and the lightbox opens over it. The
 *     user wanted to keep picking photos and got a modal instead.
 *   • group photos / the group select bar — no guard at all, so the two toggles
 *     cancel out: the click appears to do nothing, AND the lightbox opens.
 *
 * ── THE RULE ────────────────────────────────────────────────────────────────
 *
 * A gesture that STARTS while the user is selecting stays a selection gesture:
 * exactly one toggle, no lightbox. The lightbox is reachable only from a
 * double-click that starts with an empty selection and both pick modes off — and
 * when it opens, the selection is restored to what it was before the gesture,
 * because "show me this photo" should not leave a photo silently selected.
 *
 * "While the user is selecting" is judged from the state at the START of the
 * gesture, never the live state: by the time `dblclick` fires the first
 * mousedown has already selected the item, so the live check would report
 * "selecting" for every double-click and the lightbox would be unreachable.
 *
 * This module is the pure half so the rules are testable — `ImageGrouper` has no
 * component harness. It holds no state: the caller owns the timestamp map and
 * the gesture snapshot (both refs).
 */

/** How close two toggles of the SAME target must be to count as one gesture.
 *  A hardware double-click emits its two mousedowns ~10–15 ms apart. */
export const TOGGLE_REPEAT_MS = 200;

/**
 * Is this event the tail of a double-click on the same target?
 * `lastAt` is the previous toggle's timestamp, `now` the current one.
 */
export function isRepeatToggle(lastAt: number | undefined, now: number): boolean {
  if (lastAt === undefined) return false;
  return now - lastAt < TOGGLE_REPEAT_MS;
}

export interface GestureModes {
  /** Size of the selection as it stood when THIS gesture began. */
  selectedAtGestureStart: number;
  /** Pick mode — auto-selects the next N ungrouped photos after each group action. */
  pickMode: boolean;
  /** Photo tools pick mode — click-select photos, including inside group cards. */
  photoSelectMode: boolean;
}

/**
 * True when the user is mid-selection and a double-click must therefore stay a
 * selection gesture rather than opening the lightbox.
 */
export function isSelectionModeActive(m: GestureModes): boolean {
  return m.selectedAtGestureStart > 0 || m.pickMode || m.photoSelectMode;
}

/** May this double-click open the lightbox? The inverse of the above, named for
 *  the call site so the handler reads as the rule. */
export function shouldOpenLightbox(m: GestureModes): boolean {
  return !isSelectionModeActive(m);
}
