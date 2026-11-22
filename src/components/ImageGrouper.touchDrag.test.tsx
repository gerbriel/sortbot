import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { act } from 'react';
import ImageGrouper from './ImageGrouper';
import { mount, cleanup } from './ui/testUtils';
import { LONG_PRESS_MS, STEP2_DROP_EVENT } from './step2TouchDrag';
import type { Step2DragPayload, Step2DropDetail } from './step2TouchDrag';
import type { ClothingItem } from '../App';

/**
 * Step 2's touch drag, end to end inside ImageGrouper: a long press on a card,
 * a move, and a release over another card commit the same change the mouse
 * (HTML5) drop does. No userId / batchId is passed, so nothing reaches
 * Supabase; happy-dom has no layout, so `elementFromPoint` is stubbed.
 */

const items = (): ClothingItem[] => ([
  { id: 'g1', productGroup: 'g1', preview: 'https://img.test/g1.jpg' },
  { id: 'g1b', productGroup: 'g1', preview: 'https://img.test/g1b.jpg' },
  { id: 's1', productGroup: 's1', preview: 'https://img.test/s1.jpg' },
  { id: 's2', productGroup: 's2', preview: 'https://img.test/s2.jpg' },
] as unknown as ClothingItem[]);

function pointerDown(el: Element, pointerType = 'touch') {
  const ev = new Event('pointerdown', { bubbles: true, cancelable: true });
  Object.assign(ev, { pointerId: 7, pointerType, isPrimary: true, clientX: 10, clientY: 10, button: 0 });
  act(() => { el.dispatchEvent(ev); });
}

function touch(type: 'touchmove' | 'touchend', x: number, y: number) {
  const ev = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'touches', { value: type === 'touchend' ? [] : [{ clientX: x, clientY: y }] });
  act(() => { window.dispatchEvent(ev); });
}

function dragStart(el: Element) {
  const setData = vi.fn();
  const ev = new Event('dragstart', { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'dataTransfer', {
    value: { setData, getData: () => '', setDragImage: vi.fn(), types: [], effectAllowed: 'all', dropEffect: 'none' },
  });
  act(() => { el.dispatchEvent(ev); });
  return { ev, setData };
}

type GroupedSpy = ReturnType<typeof vi.fn<(items: ClothingItem[]) => void>>;

async function mountGrouper(onGrouped: GroupedSpy) {
  const m = mount(<ImageGrouper items={items()} onGrouped={onGrouped} />);
  // Items are adopted by an async effect; let it settle.
  for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve(); });
  return m;
}

function lastEmit(onGrouped: GroupedSpy): ClothingItem[] {
  return onGrouped.mock.calls[onGrouped.mock.calls.length - 1][0] as ClothingItem[];
}

describe('ImageGrouper touch drag', () => {
  let under: Element | null = null;

  beforeEach(() => {
    under = null;
    document.elementFromPoint = ((): Element | null => under) as typeof document.elementFromPoint;
  });
  afterEach(() => { vi.useRealTimers(); cleanup(); });

  it('every card is a drop target carrying the ids the drop needs', async () => {
    const { container } = await mountGrouper(vi.fn<(items: ClothingItem[]) => void>());
    expect(container.querySelector('.single-item-card[data-step2-drop="single"][data-drop-item="s1"][data-drop-group="s1"]')).not.toBeNull();
    expect(container.querySelector('.product-group-card[data-step2-drop="group"][data-drop-group="g1"]')).not.toBeNull();
  });

  it('long press a single, drag it onto a group card: the photo joins that group', async () => {
    const onGrouped = vi.fn<(items: ClothingItem[]) => void>();
    const { container } = await mountGrouper(onGrouped);
    vi.useFakeTimers();
    onGrouped.mockClear();
    const s1 = container.querySelector('.single-item-card[data-drop-item="s1"]')!;
    const groupCard = container.querySelector('.product-group-card[data-drop-group="g1"]')!;

    pointerDown(s1);
    act(() => { vi.advanceTimersByTime(LONG_PRESS_MS); });
    under = groupCard;
    touch('touchmove', 200, 200);
    touch('touchend', 200, 200);

    expect(onGrouped).toHaveBeenCalled();
    expect(lastEmit(onGrouped).find(i => i.id === 's1')?.productGroup).toBe('g1');
  });

  it('a mouse pointerdown never arms the touch path (desktop keeps HTML5 drag)', async () => {
    const onGrouped = vi.fn<(items: ClothingItem[]) => void>();
    const { container } = await mountGrouper(onGrouped);
    vi.useFakeTimers();
    onGrouped.mockClear();
    pointerDown(container.querySelector('.single-item-card[data-drop-item="s1"]')!, 'mouse');
    act(() => { vi.advanceTimersByTime(LONG_PRESS_MS * 2); });
    expect(document.querySelector('.step2-drag-ghost')).toBeNull();
  });

  it('iPadOS: the native HTML5 dragstart after a touch long press is refused, so the drop commits once', async () => {
    const onGrouped = vi.fn<(items: ClothingItem[]) => void>();
    const { container } = await mountGrouper(onGrouped);
    vi.useFakeTimers();
    onGrouped.mockClear();
    const s1 = container.querySelector('.single-item-card[data-drop-item="s1"]')!;
    const groupCard = container.querySelector('.product-group-card[data-drop-group="g1"]')!;

    pointerDown(s1);
    // Safari lifts the card for its own drag before and after our pickup.
    const early = dragStart(s1);
    expect(early.ev.defaultPrevented).toBe(true);
    expect(early.setData).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(LONG_PRESS_MS); });
    const late = dragStart(s1);
    expect(late.ev.defaultPrevented).toBe(true);
    expect(late.setData).not.toHaveBeenCalled();

    under = groupCard;
    touch('touchmove', 200, 200);
    touch('touchend', 200, 200);
    expect(onGrouped).toHaveBeenCalledTimes(1);
    expect(lastEmit(onGrouped).find(i => i.id === 's1')?.productGroup).toBe('g1');
  });

  it('iPadOS: group cards and photos inside a group refuse the native dragstart after a touch press too', async () => {
    const { container } = await mountGrouper(vi.fn<(items: ClothingItem[]) => void>());
    const groupCard = container.querySelector('.product-group-card[data-drop-group="g1"]')!;
    pointerDown(groupCard);
    expect(dragStart(groupCard).ev.defaultPrevented).toBe(true);
    const pile = groupCard.querySelector('[aria-label^="Pile of"]') as HTMLElement | null;
    expect(pile).not.toBeNull();
    act(() => { pile!.click(); });
    const photo = container.querySelector('.group-image-item[data-drop-item="g1"]');
    expect(photo).not.toBeNull();
    pointerDown(photo!);
    expect(dragStart(photo!).ev.defaultPrevented).toBe(true);
    // Leave no armed press behind for the next test.
    touch('touchend', 10, 10);
  });

  it('desktop: after a mouse press the HTML5 dragstart runs as before', async () => {
    const { container } = await mountGrouper(vi.fn<(items: ClothingItem[]) => void>());
    const s1 = container.querySelector('.single-item-card[data-drop-item="s1"]')!;
    pointerDown(s1, 'mouse');
    const { ev, setData } = dragStart(s1);
    expect(ev.defaultPrevented).toBe(false);
    expect(setData).toHaveBeenCalled();
    const groupCard = container.querySelector('.product-group-card[data-drop-group="g1"]')!;
    pointerDown(groupCard, 'mouse');
    const g = dragStart(groupCard);
    expect(g.ev.defaultPrevented).toBe(false);
    expect(g.setData).toHaveBeenCalledWith('application/json', expect.any(String));
  });

  it('a photo dropped on a single makes them a group; the old group of 2 dissolves', async () => {
    const onGrouped = vi.fn<(items: ClothingItem[]) => void>();
    const { container } = await mountGrouper(onGrouped);
    const s2 = container.querySelector('.single-item-card[data-drop-item="s2"]')!;
    const payload: Step2DragPayload = { kind: 'photo', itemId: 'g1b', groupId: 'g1' };
    const detail: Step2DropDetail = { payload, clientX: 0, clientY: 0, side: 'after' };
    act(() => { s2.dispatchEvent(new CustomEvent(STEP2_DROP_EVENT, { bubbles: true, detail })); });
    const out = lastEmit(onGrouped);
    expect(out.find(i => i.id === 'g1b')?.productGroup).toBe('s2');
    // g1 is down to one photo, so it is a single again (same rule as the mouse drop).
    expect(out.find(i => i.id === 'g1')?.productGroup).toBe('g1');
  });

  it('a whole group dropped back on the grid changes nothing', async () => {
    const onGrouped = vi.fn<(items: ClothingItem[]) => void>();
    const { container } = await mountGrouper(onGrouped);
    onGrouped.mockClear();
    const s1 = container.querySelector('.single-item-card[data-drop-item="s1"]')!;
    const detail: Step2DropDetail = { payload: { kind: 'group', groupId: 'g1', itemId: 'g1', count: 2 }, clientX: 0, clientY: 0, side: 'after' };
    act(() => { s1.dispatchEvent(new CustomEvent(STEP2_DROP_EVENT, { bubbles: true, detail })); });
    expect(onGrouped).not.toHaveBeenCalled();
  });
});
