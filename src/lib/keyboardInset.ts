/**
 * keyboardInset.ts: how much of the layout viewport the on-screen keyboard covers.
 *
 * Pure. On the web an open keyboard shrinks the VISUAL viewport (window.visualViewport)
 * but not the LAYOUT viewport, which is what `position: sticky` and `position: fixed`
 * resolve against. iOS Safari always behaves that way, and so does Chrome on Android
 * since Chrome 108 (the default `interactive-widget=resizes-visual`). So a surface
 * stuck to the bottom of the layout viewport ends up behind the keyboard, and the
 * distance it has to rise is the gap between the bottom of the visual viewport and the
 * bottom of the layout viewport:
 *
 *   inset = layoutHeight - (visualViewport.offsetTop + visualViewport.height)
 *
 * offsetTop is how far the visual viewport has been panned down inside the layout
 * viewport (iOS pans it to keep a focused input visible), so it is part of the sum.
 * The dock consumes it as `--kb` (CategoryZones, App.css).
 */

/** Below this an inset is browser chrome (the URL bar collapsing), not a keyboard. */
export const KEYBOARD_OPEN_THRESHOLD_PX = 100;

export interface ViewportBox {
  height: number;
  offsetTop: number;
}

/** Pixels of the layout viewport hidden under the keyboard; never negative, rounded. */
export function keyboardInsetFrom(viewport: ViewportBox, layoutHeight: number): number {
  const inset = layoutHeight - viewport.height - viewport.offsetTop;
  if (!Number.isFinite(inset) || inset <= 0) return 0;
  return Math.round(inset);
}

/** True when an inset is large enough to be a keyboard rather than a toolbar change. */
export function isKeyboardOpen(inset: number): boolean {
  return inset >= KEYBOARD_OPEN_THRESHOLD_PX;
}
