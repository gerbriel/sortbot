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

  it('marks every zone as a touch drop target and the rail as a sideways scroller', async () => {
    const { container } = mount(<CategoryZones items={items} onCategorized={vi.fn()} compactMode />);
    await flush();
    expect(container.querySelector('[data-step2-drop="category"][data-drop-category="tees"]')).not.toBeNull();
    expect(container.querySelector('[data-step2-drop="clear"]')).not.toBeNull();
    expect(container.querySelector('.category-list[data-step2-scroll-x]')).not.toBeNull();
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
