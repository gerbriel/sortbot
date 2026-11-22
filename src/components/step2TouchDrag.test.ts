import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import {
  acceptsDrop, beginLongPressDrag, dragLabel, edgeScrollDelta, guardTouchMove,
  installTouchMoveGuard, isInteractiveTarget, isReorderDrop, isStep2DragActive, isTouchPointer,
  noteStep2PointerDown, shouldBlockHtml5Drag, sideOf,
  DRAGGING_CLASS, LONG_PRESS_MS, MOVE_TOLERANCE_PX, OVER_ATTR, SOURCE_ATTR, STEP2_DROP_EVENT,
} from './step2TouchDrag';
import type { Step2DragPayload, Step2DropDetail } from './step2TouchDrag';

/**
 * The long-press drag that stands in for HTML5 drag-and-drop on touch screens
 * in Step 2. happy-dom has no layout, so `elementFromPoint` is stubbed to
 * return whichever element the test says the finger is over.
 */

const single: Step2DragPayload = { kind: 'single', itemId: 'a', groupId: 'a', ids: ['a'] };
const group: Step2DragPayload = { kind: 'group', groupId: 'g1', itemId: 'p1', count: 3 };
const photo: Step2DragPayload = { kind: 'photo', itemId: 'p1', groupId: 'g1' };

function target(kind: string, attrs: Record<string, string> = {}): HTMLElement {
  const el = document.createElement('div');
  el.setAttribute('data-step2-drop', kind);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  document.body.appendChild(el);
  return el;
}

function touch(type: string, x: number, y: number, on: EventTarget = window) {
  const ev = new Event(type, { bubbles: true, cancelable: true }) as Event & { touches: Array<{ clientX: number; clientY: number }> };
  Object.defineProperty(ev, 'touches', { value: type === 'touchend' ? [] : [{ clientX: x, clientY: y }] });
  on.dispatchEvent(ev);
  return ev;
}

function pointer(type: string, x: number, y: number, pointerId = 1) {
  const ev = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(ev, { pointerId, clientX: x, clientY: y, pointerType: 'pen' });
  window.dispatchEvent(ev);
}

describe('pure helpers', () => {
  it('only touch and pen take the long-press path; the mouse keeps HTML5 drag', () => {
    expect(isTouchPointer('touch')).toBe(true);
    expect(isTouchPointer('pen')).toBe(true);
    expect(isTouchPointer('mouse')).toBe(false);
    expect(isTouchPointer(undefined)).toBe(false);
  });

  it('a press on a control inside a card never starts a drag', () => {
    const card = document.createElement('div');
    card.innerHTML = '<button><span id="in"></span></button><img id="img">';
    expect(isInteractiveTarget(card.querySelector('#in'))).toBe(true);
    expect(isInteractiveTarget(card.querySelector('#img'))).toBe(false);
  });

  it('labels say what is being carried, without em dashes', () => {
    expect(dragLabel(single)).toBe('Moving 1 photo');
    expect(dragLabel({ ...single, ids: ['a', 'b', 'c'] })).toBe('Moving 3 photos');
    expect(dragLabel(group)).toBe('Moving a group of 3 photos');
    for (const p of [single, group, photo]) expect(dragLabel(p)).not.toContain('—');
  });

  it('sideOf splits a target at its midpoint', () => {
    expect(sideOf(10, { left: 0, width: 100 })).toBe('before');
    expect(sideOf(60, { left: 0, width: 100 })).toBe('after');
  });

  it('edgeScrollDelta scrolls toward the nearer edge and is idle in the middle', () => {
    expect(edgeScrollDelta(300, 0, 600)).toBe(0);
    expect(edgeScrollDelta(0, 0, 600)).toBeLessThan(0);
    expect(edgeScrollDelta(600, 0, 600)).toBeGreaterThan(0);
    expect(Math.abs(edgeScrollDelta(10, 0, 600))).toBeGreaterThan(Math.abs(edgeScrollDelta(40, 0, 600)));
  });

  it('a whole group only lands on a category or Clear', () => {
    expect(acceptsDrop(group, target('category'))).toBe(true);
    expect(acceptsDrop(group, target('clear'))).toBe(true);
    expect(acceptsDrop(group, target('group'))).toBe(false);
    expect(acceptsDrop(group, target('single'))).toBe(false);
    expect(acceptsDrop(single, target('group'))).toBe(true);
    expect(acceptsDrop(photo, target('single'))).toBe(true);
  });

  it('reorders mirror the mouse rules: single over single, photo over its own group', () => {
    expect(isReorderDrop(single, target('single'))).toBe(true);
    expect(isReorderDrop(photo, target('single'))).toBe(false);
    expect(isReorderDrop(photo, target('photo', { 'data-drop-group': 'g1' }))).toBe(true);
    expect(isReorderDrop(photo, target('photo', { 'data-drop-group': 'g2' }))).toBe(false);
    expect(isReorderDrop(single, target('group'))).toBe(false);
  });
});

describe('beginLongPressDrag', () => {
  let under: Element | null = null;
  let source: HTMLElement;

  beforeEach(() => {
    vi.useFakeTimers();
    under = null;
    source = document.createElement('div');
    document.body.appendChild(source);
    document.elementFromPoint = ((): Element | null => under) as typeof document.elementFromPoint;
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
    document.documentElement.classList.remove(DRAGGING_CLASS);
  });

  const start = { pointerId: 1, pointerType: 'touch', clientX: 50, clientY: 50 };

  it('a tap (release before the hold completes) is not a drag and drops nothing', () => {
    const onEnd = vi.fn();
    beginLongPressDrag(start, { payload: single, sourceEl: source, onEnd });
    vi.advanceTimersByTime(LONG_PRESS_MS - 50);
    const end = touch('touchend', 50, 50);
    expect(onEnd).toHaveBeenCalledWith(false);
    // The tap's compatibility mousedown must survive, or tap-to-select breaks.
    expect(end.defaultPrevented).toBe(false);
    vi.advanceTimersByTime(500);
    expect(isStep2DragActive()).toBe(false);
    expect(document.querySelector('.step2-drag-ghost')).toBeNull();
  });

  it('a finger that moves during the hold is scrolling, so the press is abandoned', () => {
    const onActivate = vi.fn();
    beginLongPressDrag(start, { payload: single, sourceEl: source, onActivate });
    touch('touchmove', 50, 50 + MOVE_TOLERANCE_PX + 5);
    vi.advanceTimersByTime(LONG_PRESS_MS + 10);
    expect(onActivate).not.toHaveBeenCalled();
    expect(isStep2DragActive()).toBe(false);
  });

  it('hold, move, release: highlights the target and dispatches a drop on it', () => {
    const zone = target('category', { 'data-drop-category': 'tees' });
    const received: Step2DropDetail[] = [];
    zone.addEventListener(STEP2_DROP_EVENT, (e) => received.push((e as CustomEvent<Step2DropDetail>).detail));
    const onEnd = vi.fn();

    beginLongPressDrag(start, { payload: group, sourceEl: source, onEnd });
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(isStep2DragActive()).toBe(true);
    expect(document.documentElement.classList.contains(DRAGGING_CLASS)).toBe(true);
    expect(source.hasAttribute(SOURCE_ATTR)).toBe(true);
    expect(document.querySelector('.step2-drag-ghost')?.textContent).toBe('Moving a group of 3 photos');

    under = zone;
    // Once picked up, the move must not scroll the page under the finger. The
    // root's guard (installed for the component's lifetime) is what stops it;
    // touch events target the element the touch started on, so it bubbles there.
    const root = document.createElement('div');
    document.body.appendChild(root);
    root.appendChild(source);
    const removeGuard = installTouchMoveGuard(root);
    const move = touch('touchmove', 120, 400, source);
    expect(move.defaultPrevented).toBe(true);
    removeGuard();
    expect(zone.getAttribute(OVER_ATTR)).toBe('on');

    const end = touch('touchend', 120, 400);
    expect(end.defaultPrevented).toBe(true);
    expect(received).toHaveLength(1);
    expect(received[0].payload).toEqual(group);
    expect(onEnd).toHaveBeenCalledWith(true);
    // Everything visual is torn down.
    expect(zone.hasAttribute(OVER_ATTR)).toBe(false);
    expect(source.hasAttribute(SOURCE_ATTR)).toBe(false);
    expect(document.querySelector('.step2-drag-ghost')).toBeNull();
    expect(document.documentElement.classList.contains(DRAGGING_CLASS)).toBe(false);
    expect(isStep2DragActive()).toBe(false);
  });

  it('a target that does not take the payload neither lights up nor receives the drop', () => {
    const card = target('group', { 'data-drop-group': 'g2' });
    const onDrop = vi.fn();
    card.addEventListener(STEP2_DROP_EVENT, onDrop);
    const onEnd = vi.fn();
    beginLongPressDrag(start, { payload: group, sourceEl: source, onEnd });
    vi.advanceTimersByTime(LONG_PRESS_MS);
    under = card;
    touch('touchmove', 80, 80);
    expect(card.hasAttribute(OVER_ATTR)).toBe(false);
    touch('touchend', 80, 80);
    expect(onDrop).not.toHaveBeenCalled();
    expect(onEnd).toHaveBeenCalledWith(false);
  });

  it('picking up and putting down without moving is not a drop', () => {
    const card = target('single', { 'data-drop-item': 'a' });
    under = card;
    const onDrop = vi.fn();
    card.addEventListener(STEP2_DROP_EVENT, onDrop);
    beginLongPressDrag(start, { payload: single, sourceEl: source });
    vi.advanceTimersByTime(LONG_PRESS_MS);
    touch('touchend', 50, 50);
    expect(onDrop).not.toHaveBeenCalled();
  });

  it('pen (no touch events) runs the same gesture on pointer events alone', () => {
    const card = target('group', { 'data-drop-group': 'g9' });
    const onDrop = vi.fn();
    card.addEventListener(STEP2_DROP_EVENT, onDrop);
    beginLongPressDrag({ ...start, pointerType: 'pen' }, { payload: single, sourceEl: source });
    vi.advanceTimersByTime(LONG_PRESS_MS);
    under = card;
    pointer('pointermove', 200, 200);
    pointer('pointerup', 200, 200);
    expect(onDrop).toHaveBeenCalledTimes(1);
  });

  it('the returned cancel tears a live drag down without dropping (unmount path)', () => {
    const onEnd = vi.fn();
    const cancel = beginLongPressDrag(start, { payload: single, sourceEl: source, onEnd });
    vi.advanceTimersByTime(LONG_PRESS_MS);
    cancel();
    expect(onEnd).toHaveBeenCalledWith(false);
    expect(isStep2DragActive()).toBe(false);
    expect(document.querySelector('.step2-drag-ghost')).toBeNull();
  });

  it('the per-press window touchmove listener is passive (the root guard is the only blocking one)', () => {
    const add = vi.spyOn(window, 'addEventListener');
    const cancel = beginLongPressDrag(start, { payload: single, sourceEl: source });
    const call = add.mock.calls.find(c => c[0] === 'touchmove');
    expect(call?.[2]).toMatchObject({ passive: true });
    // Without a root guard, a window-level move during a live drag is not blocked here.
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(touch('touchmove', 60, 60).defaultPrevented).toBe(false);
    cancel();
    add.mockRestore();
  });

  it('a finger that scrolls during the hold still cancels it with the passive listener', () => {
    const onEnd = vi.fn();
    beginLongPressDrag(start, { payload: single, sourceEl: source, onEnd });
    const ev = touch('touchmove', 50, 50 + MOVE_TOLERANCE_PX + 1);
    expect(ev.defaultPrevented).toBe(false);
    expect(onEnd).toHaveBeenCalledWith(false);
  });

  it('shouldBlockHtml5Drag: blocks after a touch or pen press and during a live drag, never after a mouse press', () => {
    noteStep2PointerDown('mouse');
    expect(shouldBlockHtml5Drag()).toBe(false);
    noteStep2PointerDown('touch');
    expect(shouldBlockHtml5Drag()).toBe(true);
    noteStep2PointerDown('pen');
    expect(shouldBlockHtml5Drag()).toBe(true);
    noteStep2PointerDown('mouse');
    const cancel = beginLongPressDrag(start, { payload: single, sourceEl: source });
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(shouldBlockHtml5Drag()).toBe(true); // live drag wins whatever was recorded
    cancel();
    expect(shouldBlockHtml5Drag()).toBe(false);
  });

  it('guardTouchMove only blocks scrolling while a drag is live', () => {
    const idle = new Event('touchmove', { cancelable: true }) as TouchEvent;
    guardTouchMove(idle);
    expect(idle.defaultPrevented).toBe(false);

    const cancel = beginLongPressDrag(start, { payload: single, sourceEl: source });
    vi.advanceTimersByTime(LONG_PRESS_MS);
    const live = new Event('touchmove', { cancelable: true }) as TouchEvent;
    guardTouchMove(live);
    expect(live.defaultPrevented).toBe(true);
    cancel();
  });
});
