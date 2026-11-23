import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { act } from 'react';
import CategoryPresetsManager from './CategoryPresetsManager';
import { mount, cleanup, click, one, all, buttonByText } from './ui/testUtils';
import { getCategoryPresets, updateCategoryPreset } from '../lib/categoryPresetsService';
import { getCategories } from '../lib/categoriesService';
import type { CategoryPreset } from '../lib/categoryPresets';

/**
 * The ship-from address is per workspace: the seed copies presets into a new
 * workspace without it, so this page has to make a missing one obvious and
 * easy to fill in. Locked here: the placeholder is not anyone's real address,
 * a shipping preset without one is flagged (and a non-shipping one is not),
 * and "Apply to all presets" writes every preset.
 */

vi.mock('../lib/categoryPresetsService', () => ({
  getCategoryPresets: vi.fn(),
  createCategoryPreset: vi.fn(),
  updateCategoryPreset: vi.fn(),
  deleteCategoryPreset: vi.fn(),
}));
vi.mock('../lib/categoriesService', () => ({ getCategories: vi.fn() }));

const preset = (over: Partial<CategoryPreset> & Record<string, unknown> = {}) => ({
  id: 'p1',
  category_name: 'tees',
  display_name: 'Tees',
  requires_shipping: true,
  is_active: true,
  ships_from: '',
  gender: 'Men',
  measurement_template: { width: true, length: true },
  ...over,
}) as unknown as CategoryPreset;

const flush = async () => {
  await act(async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve();
  });
};

async function render() {
  const view = mount(<CategoryPresetsManager onClose={() => {}} />);
  await flush();
  return view;
}

const card = (container: HTMLElement, name: string) => {
  const found = all(container, '.preset-card').find(c => c.querySelector('h3')?.textContent === name);
  if (!found) throw new Error(`no card for ${name}`);
  return found;
};

beforeEach(() => {
  localStorage.clear();
  vi.mocked(getCategories).mockResolvedValue([]);
  vi.mocked(updateCategoryPreset).mockImplementation(async (id) => ({ id }) as unknown as CategoryPreset);
});

afterEach(() => { cleanup(); vi.clearAllMocks(); localStorage.clear(); });

describe('CategoryPresetsManager: ship-from', () => {
  it('uses a generic placeholder in the editor, never a real address', async () => {
    vi.mocked(getCategoryPresets).mockResolvedValue([preset()]);
    const { container } = await render();
    click(buttonByText(card(container, 'Tees'), 'Edit'));
    const input = one(container, 'input[aria-describedby="preset-ships-from-hint"]') as HTMLInputElement;
    expect(input.placeholder).toBe('Street, city, state and ZIP');
    expect(one(container, '#preset-ships-from-hint').textContent).toContain('never shared with other shops');
    expect(container.innerHTML).not.toContain('Lincoln');
  });

  it('flags a shipping preset with no ship-from, and not a non-shipping one', async () => {
    vi.mocked(getCategoryPresets).mockResolvedValue([
      preset(),
      preset({ id: 'p2', display_name: 'Gift card', requires_shipping: false }),
      preset({ id: 'p3', display_name: 'Jackets', ships_from: '12 Main St, Town, ST 00000' }),
    ]);
    const { container } = await render();
    expect(card(container, 'Tees').textContent).toContain('No ship-from');
    expect(card(container, 'Gift card').textContent).not.toContain('No ship-from');
    expect(card(container, 'Jackets').textContent).not.toContain('No ship-from');
  });

  it('prefills the apply-to-all field with the most common ship-from', async () => {
    vi.mocked(getCategoryPresets).mockResolvedValue([
      preset({ ships_from: 'A St' }),
      preset({ id: 'p2', ships_from: 'B St' }),
      preset({ id: 'p3', ships_from: 'B St' }),
    ]);
    const { container } = await render();
    const field = one(container, '.presets-shipfrom input') as HTMLInputElement;
    expect(field.value).toBe('B St');
  });

  it('Apply to all presets asks first, then updates EVERY preset', async () => {
    const presets = [
      preset({ ships_from: 'B St' }),
      // A Women preset is not on screen under the Men tab and is still written.
      preset({ id: 'p2', gender: 'Women' }),
      preset({ id: 'p3', requires_shipping: false }),
    ];
    vi.mocked(getCategoryPresets).mockResolvedValue(presets);
    const { container } = await render();

    click(buttonByText(container, 'Apply to all presets'));
    expect(updateCategoryPreset).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Set the ship-from on 3 presets? Presets that already have one are overwritten.');

    click(buttonByText(container, 'Apply'));
    await flush();
    expect(updateCategoryPreset).toHaveBeenCalledTimes(3);
    for (const p of presets) {
      expect(updateCategoryPreset).toHaveBeenCalledWith(p.id, { ships_from: 'B St' });
    }
    // ...and reloads the list afterwards.
    expect(vi.mocked(getCategoryPresets).mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(container.textContent).toContain('Ship-from set on 3 presets.');
  });
});
