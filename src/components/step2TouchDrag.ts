/**
 * Step 2 touch drag-and-drop (Nov 2026, mobile-readiness pass).
 *
 * WHY THIS EXISTS: Step 2's drags (a photo onto a group, a group onto a
 * category, a single reordered in the grid, a photo reordered inside a group)
 * were HTML5 drag-and-drop, and HTML5 `dragstart`/`drop` never fire on a touch
 * screen. That holds inside a Capacitor WebView too, on iOS and Android.
 *
 * HOW: a LONG PRESS starts the drag, so an ordinary swipe still scrolls the
 * grid. The cards keep `touch-action: pan-y pinch-zoom` (AGENTS.md §10 Step 2,
 * pinch-zoom is a WCAG 1.4.4 requirement); scrolling is suppressed only AFTER
 * the press has turned into a drag, by `guardTouchMove` (a non-passive
 * `touchmove` listener the components install on their own root). A
 * `touch-action: none` handle would have needed a visible grip on every 100px
 * photo and would still have blocked scrolling from it.
 *
 * Only touch and pen pointers come through here. A mouse keeps the HTML5 path
 * byte for byte (its drag image, its `draggable` gating against the rubber
 * band), so desktop behaviour is unchanged. Both paths end in the SAME commit
 * functions in ImageGrouper / CategoryZones; only the gesture front end is
 * doubled.
 *
 * THE CONTRACT WITH THE COMPONENTS:
 *  - A drop target carries `data-step2-drop="<kind>"` plus whatever ids it needs
 *    (`data-drop-item`, `data-drop-group`, `data-drop-category`).
 *  - On release, the target under the finger receives a bubbling
 *    `STEP2_DROP_EVENT` CustomEvent whose `detail` is a `Step2DropDetail`.
 *    Each component listens on its own root, so ImageGrouper never needs to
 *    know CategoryZones exists (the HTML5 path used `dataTransfer` for that).
 *  - While dragging, the hovered target carries `data-step2-over`
 *    (`before` / `after` / `on`) and the source carries `data-step2-source`.
 *    React does not own either attribute, so a re-render never wipes them.
 *  - `<html>` carries `step2-touch-dragging` for the whole drag.
 */

export type Step2DragPayload =
  /** A card from the singles grid. `ids` is the block a reorder moves (the
   *  selection when the card is part of a multi-select, else just itself). */
  | { kind: 'single'; itemId: string; groupId: string; ids: string[] }
  /** A whole multi-photo group card. */
  | { kind: 'group'; groupId: string; itemId: string; count: number }
  /** One photo inside an opened group. */
  | { kind: 'photo'; itemId: string; groupId: string };

export interface Step2DropDetail {
  payload: Step2DragPayload;
  clientX: number;
  clientY: number;
  /** Which half of the target the finger was over, for reorder drops. */
  side: 'before' | 'after';
}

export const STEP2_DROP_EVENT = 'step2:touchdrop';
export const DROP_ATTR = 'data-step2-drop';
export const OVER_ATTR = 'data-step2-over';
export const SOURCE_ATTR = 'data-step2-source';
export const SCROLL_X_ATTR = 'data-step2-scroll-x';
export const DRAGGING_CLASS = 'step2-touch-dragging';

/** Hold this long without moving to pick something up. Long enough that a
 *  flick-scroll never trips it, short enough not to feel like waiting. */
export const LONG_PRESS_MS = 350;
/** A finger that wanders this far during the hold is scrolling, not pressing. */
export const MOVE_TOLERANCE_PX = 10;

export function isTouchPointer(pointerType: string | undefined): boolean {
  return pointerType === 'touch' || pointerType === 'pen';
}

/** Controls inside a card do their own thing; a press on one never drags. */
export function isInteractiveTarget(el: Element | null): boolean {
  return !!el?.closest('button, input, select, textarea, a, [role="menu"], .group-menu-wrap');
}

export function dragLabel(p: Step2DragPayload): string {
  if (p.kind === 'group') return `Moving a group of ${p.count} photos`;
  if (p.kind === 'single' && p.ids.length > 1) return `Moving ${p.ids.length} photos`;
  return 'Moving 1 photo';
}

/** Which half of a target a point is over. Reorders insert before or after. */
export function sideOf(clientX: number, rect: { left: number; width: number }): 'before' | 'after' {
  return clientX < rect.left + rect.width / 2 ? 'before' : 'after';
}

/**
 * Auto-scroll speed for a point near the edge of a scroller: negative toward
 * the start, positive toward the end, 0 in the middle. Pure, for tests.
 */
export function edgeScrollDelta(pos: number, start: number, end: number, zone = 56, max = 14): number {
  if (end - start <= zone * 2) zone = Math.max(1, (end - start) / 4);
  const fromStart = pos - start;
  const fromEnd = end - pos;
  if (fromStart < zone) return -max * (1 - Math.max(0, fromStart) / zone);
  if (fromEnd < zone) return max * (1 - Math.max(0, fromEnd) / zone);
  return 0;
}

/**
 * Whether dropping `p` on `target` REORDERS (insert before/after) rather than
 * moves into a group. Mirrors the mouse rules: a single over a single, or a
 * photo over a photo of its own group.
 */
export function isReorderDrop(p: Step2DragPayload, target: Element): boolean {
  const kind = target.getAttribute(DROP_ATTR);
  if (kind === 'single') return p.kind === 'single';
  if (kind === 'photo') return p.kind === 'photo' && target.getAttribute('data-drop-group') === p.groupId;
  return false;
}

/**
 * Whether a target takes this payload at all. A whole group only goes to a
 * category or Clear (dropping a group on a group is not a merge on the mouse
 * path either), so the grid does not light up under it.
 */
export function acceptsDrop(p: Step2DragPayload, target: Element): boolean {
  const kind = target.getAttribute(DROP_ATTR);
  if (kind === 'category' || kind === 'clear') return true;
  if (p.kind === 'group') return false;
  return kind === 'single' || kind === 'group' || kind === 'photo';
}

/** The drop target under a viewport point, or null. */
export function dropTargetAt(x: number, y: number, doc: Document = document): HTMLElement | null {
  const el = typeof doc.elementFromPoint === 'function' ? doc.elementFromPoint(x, y) : null;
  return (el?.closest(`[${DROP_ATTR}]`) as HTMLElement | null) ?? null;
}

function acceptingTargetAt(p: Step2DragPayload, x: number, y: number, doc: Document): HTMLElement | null {
  const t = dropTargetAt(x, y, doc);
  return t && acceptsDrop(p, t) ? t : null;
}

let activeDrag = false;
/** True between pickup and release. */
export function isStep2DragActive(): boolean { return activeDrag; }

let lastPointerType = '';
/** Record the pointer type of a press on a drag source. The cards call this
 *  from onPointerDown so their onDragStart can tell what started the drag. */
export function noteStep2PointerDown(pointerType: string | undefined): void {
  lastPointerType = pointerType ?? '';
}

/**
 * True when a card's HTML5 `dragstart` must be cancelled: the touch drag is
 * live, or the press that led to it came from a finger or pen. iPadOS Safari
 * starts a native HTML5 drag on a long press of a `draggable` element, and the
 * touch path would commit the same drop again through STEP2_DROP_EVENT (a
 * double reorder). A mouse press always records 'mouse' first, so desktop
 * HTML5 drag is unaffected.
 */
export function shouldBlockHtml5Drag(): boolean {
  return activeDrag || isTouchPointer(lastPointerType);
}

/**
 * Install on a component root as a NON-passive `touchmove` listener. It only
 * acts while a drag is live, so it never costs the grid its scroll. It has to
 * exist before the touch starts: a listener added mid-gesture can arrive after
 * the browser has already committed the touch to a scroll.
 *
 * WHY IT STAYS MOUNTED (Nov 2026 review): moving it to "attach at pickup" was
 * considered and rejected. WebKit decides at touchstart whether a touch
 * sequence is dispatched cancelably, and Chromium decides at touchstart and
 * again at the first touchmove (finger jitter during the 350 ms hold is
 * usually that first move). A guard added after either point gets
 * non-cancelable touchmoves, and the grid would scroll under a live drag. The
 * cost of keeping it is one main-thread round trip before a scroll begins;
 * once a scroll is under way both engines stop waiting on the listener. The
 * per-press window listener in beginLongPressDrag is passive, so this is the
 * only non-passive touchmove listener in Step 2.
 */
export function guardTouchMove(e: TouchEvent): void {
  if (activeDrag && e.cancelable) e.preventDefault();
}

/** Ensure every Step 2 root has the guard. Returns the remover. */
export function installTouchMoveGuard(el: HTMLElement | null): () => void {
  if (!el) return () => {};
  el.addEventListener('touchmove', guardTouchMove, { passive: false });
  return () => el.removeEventListener('touchmove', guardTouchMove);
}

export interface PointerStart {
  pointerId: number;
  pointerType: string;
  clientX: number;
  clientY: number;
}

export interface LongPressDragOptions {
  payload: Step2DragPayload;
  sourceEl: HTMLElement;
  /** The vertical scroller to auto-scroll when the finger nears its edges. */
  scrollContainer?: () => HTMLElement | null;
  delayMs?: number;
  onActivate?: () => void;
  /** `dropped` is true when a drop event was dispatched to a target. */
  onEnd?: (dropped: boolean) => void;
  doc?: Document;
}

/**
 * Arm a long press for a touch/pen `pointerdown`. Returns a cancel function
 * (call it on unmount). Nothing changes on screen until the hold completes.
 */
export function beginLongPressDrag(start: PointerStart, opts: LongPressDragOptions): () => void {
  const doc = opts.doc ?? document;
  const win = doc.defaultView ?? window;
  let phase: 'pending' | 'active' | 'done' = 'pending';
  let x = start.clientX;
  let y = start.clientY;
  let movedSinceActivate = false;
  let ghost: HTMLElement | null = null;
  let over: HTMLElement | null = null;
  let raf: number | null = null;
  const sawTouchEvents = { v: false };

  const timer = win.setTimeout(activate, opts.delayMs ?? LONG_PRESS_MS);

  function setOver(next: HTMLElement | null) {
    if (over && over !== next) over.removeAttribute(OVER_ATTR);
    over = next;
    if (next) {
      next.setAttribute(OVER_ATTR, isReorderDrop(opts.payload, next)
        ? sideOf(x, next.getBoundingClientRect())
        : 'on');
    }
  }

  function placeGhost() {
    if (ghost) ghost.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }

  function activate() {
    if (phase !== 'pending') return;
    phase = 'active';
    activeDrag = true;
    try { opts.sourceEl.setPointerCapture?.(start.pointerId); } catch { /* pointer already gone */ }
    opts.sourceEl.setAttribute(SOURCE_ATTR, '');
    doc.documentElement.classList.add(DRAGGING_CLASS);
    ghost = doc.createElement('div');
    ghost.className = 'step2-drag-ghost';
    ghost.setAttribute('aria-hidden', 'true');
    ghost.textContent = dragLabel(opts.payload);
    doc.body.appendChild(ghost);
    placeGhost();
    try { win.navigator?.vibrate?.(12); } catch { /* not supported */ }
    opts.onActivate?.();
    const loop = () => {
      tickAutoScroll();
      raf = win.requestAnimationFrame(loop);
    };
    raf = win.requestAnimationFrame(loop);
  }

  function tickAutoScroll() {
    const box = opts.scrollContainer?.();
    if (box) {
      const r = box.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top - 24 && y <= r.bottom + 24) {
        const d = edgeScrollDelta(y, r.top, r.bottom);
        if (d) box.scrollTop += d;
      }
    }
    const under = typeof doc.elementFromPoint === 'function' ? doc.elementFromPoint(x, y) : null;
    const rail = under?.closest(`[${SCROLL_X_ATTR}]`) as HTMLElement | null;
    if (rail) {
      const r = rail.getBoundingClientRect();
      const d = edgeScrollDelta(x, r.left, r.right, 40, 10);
      if (d) rail.scrollLeft += d;
    }
  }

  function move(nx: number, ny: number) {
    if (phase === 'pending') {
      if (Math.hypot(nx - start.clientX, ny - start.clientY) > MOVE_TOLERANCE_PX) cancel();
      return;
    }
    if (phase !== 'active') return;
    if (Math.hypot(nx - x, ny - y) > 0) movedSinceActivate = true;
    x = nx; y = ny;
    placeGhost();
    setOver(acceptingTargetAt(opts.payload, x, y, doc));
  }

  function finish(drop: boolean) {
    if (phase === 'done') return;
    const wasActive = phase === 'active';
    phase = 'done';
    win.clearTimeout(timer);
    if (raf !== null) win.cancelAnimationFrame(raf);
    detach();
    let dropped = false;
    if (wasActive) {
      const target = drop ? acceptingTargetAt(opts.payload, x, y, doc) : null;
      setOver(null);
      ghost?.remove();
      opts.sourceEl.removeAttribute(SOURCE_ATTR);
      doc.documentElement.classList.remove(DRAGGING_CLASS);
      try { opts.sourceEl.releasePointerCapture?.(start.pointerId); } catch { /* already released */ }
      // A press that never moved after pickup is not a drop on itself.
      if (target && movedSinceActivate) {
        const detail: Step2DropDetail = {
          payload: opts.payload,
          clientX: x,
          clientY: y,
          side: sideOf(x, target.getBoundingClientRect()),
        };
        target.dispatchEvent(new CustomEvent(STEP2_DROP_EVENT, { bubbles: true, detail }));
        dropped = true;
      }
      // Cleared after dispatch so the commit still sees the drag as live.
      activeDrag = false;
    }
    opts.onEnd?.(dropped);
  }

  function cancel() { finish(false); }

  const onPointerMove = (e: PointerEvent) => {
    if (e.pointerId !== start.pointerId || sawTouchEvents.v) return;
    move(e.clientX, e.clientY);
  };
  const onPointerUp = (e: PointerEvent) => {
    if (e.pointerId !== start.pointerId) return;
    if (sawTouchEvents.v && phase === 'active') return; // touchend finishes it
    finish(true);
  };
  const onPointerCancel = (e: PointerEvent) => {
    if (e.pointerId !== start.pointerId) return;
    // Once a touch drag is live, some engines still cancel the pointer when
    // the WebView considers a pan; the touch stream carries on, so it ends it.
    // (iPadOS also cancels it when its own HTML5 drag lifts the card; the
    // cards' onDragStart refuses that drag via shouldBlockHtml5Drag, so only
    // this path can commit.)
    if (phase === 'active' && sawTouchEvents.v) return;
    cancel();
  };
  const onTouchMove = (e: TouchEvent) => {
    sawTouchEvents.v = true;
    const t = e.touches[0];
    if (!t) return;
    // Passive: tracking only. Scrolling during a live drag is stopped by the
    // root's guardTouchMove (see installTouchMoveGuard for why it lives there).
    move(t.clientX, t.clientY);
  };
  const onTouchEnd = (e: TouchEvent) => {
    if (phase === 'active') {
      // Stops the compatibility mousedown/click, which would toggle the
      // selection of whatever card the photo was dropped on.
      if (e.cancelable) e.preventDefault();
      finish(true);
    } else {
      cancel();
    }
  };
  const onTouchCancel = () => cancel();
  const onContextMenu = (e: Event) => { e.preventDefault(); };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') cancel(); };

  function detach() {
    win.removeEventListener('pointermove', onPointerMove);
    win.removeEventListener('pointerup', onPointerUp);
    win.removeEventListener('pointercancel', onPointerCancel);
    win.removeEventListener('touchmove', onTouchMove);
    win.removeEventListener('touchend', onTouchEnd);
    win.removeEventListener('touchcancel', onTouchCancel);
    win.removeEventListener('contextmenu', onContextMenu, true);
    win.removeEventListener('keydown', onKey);
  }

  win.addEventListener('pointermove', onPointerMove);
  win.addEventListener('pointerup', onPointerUp);
  win.addEventListener('pointercancel', onPointerCancel);
  win.addEventListener('touchmove', onTouchMove, { passive: true });
  win.addEventListener('touchend', onTouchEnd, { passive: false });
  win.addEventListener('touchcancel', onTouchCancel);
  // Android raises the context menu on a long press; it would steal the drag.
  win.addEventListener('contextmenu', onContextMenu, true);
  win.addEventListener('keydown', onKey);

  return cancel;
}
