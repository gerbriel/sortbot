/**
 * stackLayout — the geometry of a Step 2 photo PILE.
 *
 * Step 2 used to render a multi-photo group as a fanned grid of every
 * thumbnail, which meant a 40-group batch painted 160+ images and every card
 * was a different height. A group is now a *pile*: the leader photo sits on top
 * at full card size and the rest peek out behind it as a couple of offset
 * layers, with a "+N" badge for whatever is deeper than the visible stack.
 * Clicking the pile expands it back into the fan.
 *
 * All of the numbers live here, pure and tested, for three reasons:
 *   1. the offsets have to be reserved as padding on the pile box (a layer
 *      translated down-right would otherwise be clipped by `overflow: hidden`),
 *      so the CSS and the JSX must agree on the same constants;
 *   2. the phone variant is the same geometry scaled down — expressing it as a
 *      scale factor rather than a second hand-tuned table keeps the two in step
 *      when the card size changes;
 *   3. layer order is load-bearing. `stackLayers` returns BACK-TO-FRONT so the
 *      natural paint order already puts the leader last; `z` is set as well so
 *      the pile survives any future reordering of the JSX.
 *
 * No DOM, no React.
 */

/** How many photos of a pile are drawn. Leader + 2 peeking layers behind it.
 *  Anything deeper is represented by the "+N" badge instead — three layers is
 *  where the offsets stop reading as a pile and start reading as a smear. */
export const STACK_MAX_LAYERS = 3;

/** Per-layer offset, in px, at desktop card size. */
export const STACK_OFFSET_X = 7;
export const STACK_OFFSET_Y = 7;

/** Per-layer rotation magnitude, in degrees. The sign alternates by depth so a
 *  pile looks tossed rather than sheared. */
export const STACK_ROTATE_STEP = 2.6;

/** ≤640px the card is ~105-155px wide, where the full 14px reserve is a tenth of
 *  the photo. The same geometry, scaled. */
export const STACK_COMPACT_SCALE = 0.7;

export interface StackLayer {
  /** Index into the group's item array. 0 is the leader (the top of the pile). */
  index: number;
  /** px offset from the pile's top-left. */
  x: number;
  y: number;
  /** degrees */
  rotate: number;
  /** z-index. Highest for the leader. */
  z: number;
}

export interface StackLayoutOptions {
  /** Phone-sized card — shrink the offsets (see STACK_COMPACT_SCALE). */
  compact?: boolean;
  /** Override the visible-layer cap. Mostly for tests. */
  maxLayers?: number;
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

/**
 * The layers to draw for a pile of `count` photos, ordered BACK TO FRONT —
 * the last element is always the leader (index 0, no offset, highest z).
 *
 * A count of 0 returns []; a count of 1 returns a single un-offset layer, so a
 * one-photo group (which Step 2 never renders as a pile today, but which a
 * remove-from-group can produce mid-render) degrades to a plain card.
 */
export function stackLayers(count: number, opts: StackLayoutOptions = {}): StackLayer[] {
  const { compact = false, maxLayers = STACK_MAX_LAYERS } = opts;
  if (!Number.isFinite(count) || count <= 0 || maxLayers <= 0) return [];

  const visible = Math.min(Math.floor(count), Math.floor(maxLayers));
  const scale = compact ? STACK_COMPACT_SCALE : 1;

  const layers: StackLayer[] = [];
  // depth counts DOWN from the deepest visible layer to the leader, so the
  // array comes out back-to-front.
  for (let depth = visible - 1; depth >= 0; depth--) {
    layers.push({
      index: depth,
      x: round1(depth * STACK_OFFSET_X * scale),
      y: round1(depth * STACK_OFFSET_Y * scale),
      rotate: depth === 0 ? 0 : round1((depth % 2 === 1 ? -1 : 1) * STACK_ROTATE_STEP * depth * scale),
      z: visible - depth,
    });
  }
  return layers;
}

/**
 * Space the offsets need reserved at the right and bottom of the pile box, in
 * px, so the deepest layer is not clipped. The component writes this as inline
 * padding on `.group-stack`; the layers are positioned against that padding box,
 * so the reserve is exactly the room the translated layers need.
 */
export function stackReserve(count: number, opts: StackLayoutOptions = {}): { right: number; bottom: number } {
  const layers = stackLayers(count, opts);
  if (layers.length === 0) return { right: 0, bottom: 0 };
  // layers[0] is the deepest — the largest offset.
  return { right: layers[0].x, bottom: layers[0].y };
}

/**
 * The "+N" badge for photos deeper than the visible stack, or null when every
 * photo is already drawn. N counts the HIDDEN photos, not the total.
 */
export function stackOverflowBadge(count: number, opts: StackLayoutOptions = {}): string | null {
  const { maxLayers = STACK_MAX_LAYERS } = opts;
  if (!Number.isFinite(count)) return null;
  const hidden = Math.floor(count) - Math.floor(maxLayers);
  return hidden > 0 ? `+${hidden}` : null;
}
