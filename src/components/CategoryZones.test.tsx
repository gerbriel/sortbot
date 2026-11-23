import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { act } from 'react';
import CategoryZones from './CategoryZones';
import { mount, cleanup } from './ui/testUtils';
import { getCategories } from '../lib/categoriesService';
import { getCategoryPresets } from '../lib/categoryPresetsService';
import { STEP2_DROP_EVENT } from './step2TouchDrag';
import type { Step2DragPayload, Step2DropDetail } from './step2TouchDrag';
import type { ClothingItem } from '../App';

/**
 * What a touch drop does to a category zone (Step 2, compact mode). The
 * gesture itself is tested in step2TouchDrag.test.ts; this locks that a drop
 * event reaching a zone commits the SAME assignment the mouse drop does.
 */

vi.mock('../lib/categoriesService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/categoriesService')>();
  return { ...actual, getCategories: vi.fn() };
});
vi.mock('../lib/categoryPresetsService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/categoryPresetsService')>();
  return { ...actual, getCategoryPresets: vi.fn() };
});

const kb = vi.hoisted(() => ({
  cb: null as null | ((s: { open: boolean; height: number }) => void),
  off: vi.fn(),
  resizes: { value: false },
}));
vi.mock('../lib/native/keyboard', () => ({
  subscribeKeyboard: (cb: (s: { open: boolean; height: number }) => void) => { kb.cb = cb; return kb.off; },
  keyboardResizesWebview: () => kb.resizes.value,
}));

const preset = (id: string, category_name: string, display_name: string) =>
  ({ id, category_name, display_name, gender: 'Men', is_active: true }) as never;

const items: ClothingItem[] = [
  { id: 'g1', productGroup: 'g1' },
  { id: 'g1b', productGroup: 'g1' },
  { id: 's1', productGroup: 's1' },
  { id: 's2', productGroup: 's2', category: 'tees' },
] as unknown as ClothingItem[];

async function flush() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

function drop(el: Element, payload: Step2DragPayload) {
  const detail: Step2DropDetail = { payload, clientX: 0, clientY: 0, side: 'after' };
  act(() => { el.dispatchEvent(new CustomEvent(STEP2_DROP_EVENT, { bubbles: true, detail })); });
}

describe('CategoryZones touch drop', () => {
  beforeEach(() => {
    localStorage.setItem('dropzone_gender_filter', 'Men');
    vi.mocked(getCategories).mockResolvedValue([]);
    vi.mocked(getCategoryPresets).mockResolvedValue([
      preset('p1', 'tees', 'Tees'),
      preset('p2', 'jackets', 'Jackets'),
    ]);
  });
  afterEach(() => { cleanup(); vi.clearAllMocks(); });

  it('marks every zone as a touch drop target and the chip area as a vertical scroller', async () => {
    const { container } = mount(<CategoryZones items={items} onCategorized={vi.fn()} compactMode />);
    await flush();
    expect(container.querySelector('[data-step2-drop="category"][data-drop-category="tees"]')).not.toBeNull();
    expect(container.querySelector('[data-step2-drop="clear"]')).not.toBeNull();
    expect(container.querySelector('.category-list[data-step2-scroll-y]')).not.toBeNull();
    // The dock no longer scrolls sideways: no element in it carries the x-axis hook.
    expect(container.querySelector('[data-step2-scroll-x]')).toBeNull();
  });

  it('a group dropped on a zone gets that category, every photo in it', async () => {
    const onCategorized = vi.fn();
    const onCategoryAssigned = vi.fn();
    const { container } = mount(
      <CategoryZones items={items} onCategorized={onCategorized} onCategoryAssigned={onCategoryAssigned} compactMode />,
    );
    await flush();
    drop(container.querySelector('[data-drop-category="jackets"]')!, { kind: 'group', groupId: 'g1', itemId: 'g1', count: 2 });
    expect(onCategorized).toHaveBeenCalledTimes(1);
    const out = onCategorized.mock.calls[0][0] as ClothingItem[];
    expect(out.filter(i => i.productGroup === 'g1').map(i => i.category)).toEqual(['jackets', 'jackets']);
    expect(out.find(i => i.id === 's1')?.category).toBeUndefined();
    expect(onCategoryAssigned).toHaveBeenCalled();
  });

  it('with a selection, the drop assigns the selection (same as a tap on the zone)', async () => {
    const onCategorized = vi.fn();
    const { container } = mount(
      <CategoryZones items={items} onCategorized={onCategorized} compactMode selectedItemIds={new Set(['s1'])} />,
    );
    await flush();
    drop(container.querySelector('[data-drop-category="tees"]')!, { kind: 'group', groupId: 'g1', itemId: 'g1', count: 2 });
    const out = onCategorized.mock.calls[0][0] as ClothingItem[];
    expect(out.find(i => i.id === 's1')?.category).toBe('tees');
    expect(out.find(i => i.id === 'g1')?.category).toBeUndefined();
  });

  it('a drop on Clear Category clears the dragged group', async () => {
    const onCategorized = vi.fn();
    const { container } = mount(<CategoryZones items={items} onCategorized={onCategorized} compactMode />);
    await flush();
    drop(container.querySelector('[data-step2-drop="clear"]')!, { kind: 'single', itemId: 's2', groupId: 's2', ids: ['s2'] });
    const out = onCategorized.mock.calls[0][0] as ClothingItem[];
    expect(out.find(i => i.id === 's2')?.category).toBeUndefined();
  });

  it('the selection hint carries no em dash', async () => {
    const { container } = mount(
      <CategoryZones items={items} onCategorized={vi.fn()} compactMode selectedItemIds={new Set(['s1'])} />,
    );
    await flush();
    const hint = container.querySelector('.cz-selection-hint');
    expect(hint?.textContent).toContain('Tap or click a category');
    expect(hint?.textContent).not.toContain('—');
  });
});

describe('CategoryZones and the on-screen keyboard', () => {
  const html = document.documentElement;
  beforeEach(() => {
    localStorage.setItem('dropzone_gender_filter', 'Men');
    vi.mocked(getCategories).mockResolvedValue([]);
    vi.mocked(getCategoryPresets).mockResolvedValue([
      preset('p1', 'tees', 'Tees'),
      preset('p2', 'jackets', 'Jackets'),
    ]);
    kb.cb = null;
    kb.resizes.value = false;
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    html.classList.remove('kb-open');
    html.style.removeProperty('--kb');
  });

  const input = (c: Element) => c.querySelector<HTMLInputElement>('.cz-search-input')!;

  it('the search input is a search field that does not autocorrect', async () => {
    const { container } = mount(<CategoryZones items={items} onCategorized={vi.fn()} compactMode />);
    await flush();
    const el = input(container);
    expect(el.getAttribute('enterkeyhint')).toBe('search');
    expect(el.getAttribute('autocapitalize')).toBe('off');
    expect(el.getAttribute('autocorrect')).toBe('off');
    expect(el.getAttribute('spellcheck')).toBe('false');
  });

  it('applies kb-open and --kb only while the dock has focus and the keyboard is open', async () => {
    const { container } = mount(<CategoryZones items={items} onCategorized={vi.fn()} compactMode />);
    await flush();
    expect(kb.cb).not.toBeNull();

    // Keyboard open but focus elsewhere: nothing.
    act(() => kb.cb!({ open: true, height: 320 }));
    expect(html.classList.contains('kb-open')).toBe(false);

    act(() => { input(container).focus(); });
    expect(html.classList.contains('kb-open')).toBe(true);
    expect(html.style.getPropertyValue('--kb')).toBe('320px');

    act(() => kb.cb!({ open: true, height: 280 }));
    expect(html.style.getPropertyValue('--kb')).toBe('280px');

    // Keyboard dismissed with focus still in the field (iOS Done, Android back).
    act(() => kb.cb!({ open: false, height: 0 }));
    expect(html.classList.contains('kb-open')).toBe(false);
    expect(html.style.getPropertyValue('--kb')).toBe('');

    act(() => kb.cb!({ open: true, height: 300 }));
    expect(html.classList.contains('kb-open')).toBe(true);
    act(() => { input(container).blur(); });
    expect(html.classList.contains('kb-open')).toBe(false);
    expect(html.style.getPropertyValue('--kb')).toBe('');
  });

  it('focus moving to another control in the dock keeps it open', async () => {
    const { container } = mount(<CategoryZones items={items} onCategorized={vi.fn()} compactMode />);
    await flush();
    act(() => { input(container).focus(); });
    act(() => kb.cb!({ open: true, height: 300 }));
    act(() => { container.querySelector<HTMLButtonElement>('.cz-gender-btn')!.focus(); });
    expect(html.classList.contains('kb-open')).toBe(true);
  });

  it('a mousedown on a chip while searching does not take focus from the field', async () => {
    const { container } = mount(<CategoryZones items={items} onCategorized={vi.fn()} compactMode />);
    await flush();
    act(() => { input(container).focus(); });
    const ev = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    act(() => { container.querySelector('[data-drop-category="tees"]')!.dispatchEvent(ev); });
    expect(ev.defaultPrevented).toBe(true);
  });

  it('inside the native shell --kb stays 0 (the webview itself shrinks)', async () => {
    kb.resizes.value = true;
    const { container } = mount(<CategoryZones items={items} onCategorized={vi.fn()} compactMode />);
    await flush();
    act(() => { input(container).focus(); });
    act(() => kb.cb!({ open: true, height: 336 }));
    expect(html.classList.contains('kb-open')).toBe(true);
    expect(html.style.getPropertyValue('--kb')).toBe('0px');
  });

  it('Escape clears the field and restores the idle state', async () => {
    const { container } = mount(<CategoryZones items={items} onCategorized={vi.fn()} compactMode />);
    await flush();
    const el = input(container);
    act(() => { el.focus(); });
    act(() => kb.cb!({ open: true, height: 300 }));
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(el, 'jack');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(container.querySelector('[data-drop-category="tees"]')).toBeNull();
    act(() => { el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(el.value).toBe('');
    expect(document.activeElement).not.toBe(el);
    expect(html.classList.contains('kb-open')).toBe(false);
    expect(container.querySelector('[data-drop-category="tees"]')).not.toBeNull();
  });

  it('unmounting unsubscribes and clears the html state', async () => {
    const { container } = mount(<CategoryZones items={items} onCategorized={vi.fn()} compactMode />);
    await flush();
    act(() => { input(container).focus(); });
    act(() => kb.cb!({ open: true, height: 300 }));
    expect(html.classList.contains('kb-open')).toBe(true);
    cleanup();
    expect(kb.off).toHaveBeenCalled();
    expect(html.classList.contains('kb-open')).toBe(false);
    expect(html.style.getPropertyValue('--kb')).toBe('');
  });

  it('a non-compact mount never subscribes', async () => {
    mount(<CategoryZones items={items} onCategorized={vi.fn()} />);
    await flush();
    expect(kb.cb).toBeNull();
  });
});
