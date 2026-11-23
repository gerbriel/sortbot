import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { act } from 'react';
import CategoryPresetsManager from './CategoryPresetsManager';
import { mount, cleanup, click, one, all, buttonByText, focusElement } from './ui/testUtils';
import { getCategoryPresets, updateCategoryPreset, createCategoryPreset, deleteCategoryPreset } from '../lib/categoryPresetsService';
import { saveStatus } from '../lib/saveStatusStore';
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
  deleteCategoryPreset: vi.fn(async () => undefined),
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
  saveStatus.reset();
  vi.mocked(getCategories).mockResolvedValue([]);
  vi.mocked(updateCategoryPreset).mockImplementation(async (id) => ({ id }) as unknown as CategoryPreset);
});

afterEach(() => { cleanup(); vi.clearAllMocks(); localStorage.clear(); });

describe('CategoryPresetsManager: ship-from', () => {
  it('uses a generic placeholder in the editor, never a real address', async () => {
    vi.mocked(getCategoryPresets).mockResolvedValue([preset()]);
    const { container } = await render();
    // Nothing to open: the first preset on the tab is the editor.
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

// ─── Autosave ────────────────────────────────────────────────────────────────

function type(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  act(() => {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function choose(el: HTMLSelectElement, value: string) {
  act(() => {
    el.value = value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function toggle(el: HTMLInputElement) {
  act(() => { el.click(); });
}

const field = <T extends HTMLElement = HTMLInputElement>(c: HTMLElement, key: string) =>
  one(c, `[data-field="${key}"]`) as unknown as T;

async function advance(ms: number) {
  await act(async () => { vi.advanceTimersByTime(ms); });
  await flush();
}

describe('CategoryPresetsManager: every field saves itself', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(getCategoryPresets).mockResolvedValue([preset()]);
  });
  afterEach(() => { vi.useRealTimers(); });

  it('has no Update preset, Create preset, Cancel or close button', async () => {
    const { container } = await render();
    const labels = all(container, 'button').map(b => (b.textContent ?? '').trim());
    for (const banned of ['Update Preset', 'Update preset', 'Create Preset', 'Create preset', 'Cancel']) {
      expect(labels).not.toContain(banned);
    }
    expect(container.querySelector('button[aria-label*="lose" i]')).toBeNull();
    expect(container.querySelector('form#preset-form')).toBeNull();
  });

  it('typing in Display name then blurring writes ONLY display_name, once', async () => {
    const { container } = await render();
    const name = field(container, 'display_name');
    focusElement(name);
    type(name, 'Tees and tanks');
    focusElement(field(container, 'description'));
    await flush();
    expect(updateCategoryPreset).toHaveBeenCalledTimes(1);
    expect(updateCategoryPreset).toHaveBeenCalledWith('p1', { display_name: 'Tees and tanks' });
    // The debounce was cancelled by the blur: no second write later.
    await advance(1000);
    expect(updateCategoryPreset).toHaveBeenCalledTimes(1);
  });

  it('saves on a 600 ms debounce while typing, and two fast edits become one write', async () => {
    const { container } = await render();
    const name = field(container, 'display_name');
    type(name, 'Tees A');
    await advance(300);
    type(name, 'Tees AB');
    await advance(599);
    expect(updateCategoryPreset).not.toHaveBeenCalled();
    await advance(1);
    expect(updateCategoryPreset).toHaveBeenCalledTimes(1);
    expect(updateCategoryPreset).toHaveBeenCalledWith('p1', { display_name: 'Tees AB' });
  });

  it('coalesces changes made in the same moment into one write', async () => {
    const { container } = await render();
    const name = field(container, 'display_name');
    focusElement(name);
    type(name, 'Tees 2');
    act(() => {
      focusElement(field(container, 'requires_shipping'));
      field(container, 'requires_shipping').click();
    });
    await flush();
    expect(updateCategoryPreset).toHaveBeenCalledTimes(1);
    expect(updateCategoryPreset).toHaveBeenCalledWith('p1', { display_name: 'Tees 2', requires_shipping: false });
  });

  it('a select change saves immediately, with only that key', async () => {
    const { container } = await render();
    choose(field<HTMLSelectElement>(container, 'parcel_size'), 'Small');
    await flush();
    expect(updateCategoryPreset).toHaveBeenCalledWith('p1', { parcel_size: 'Small' });
    expect(saveStatus.getState().status).toBe('saved');
    expect(one(container, '.preset-save').textContent).toBe('Saved');
  });

  it('a measurement toggle saves the template immediately', async () => {
    const { container } = await render();
    toggle(field(container, 'measure-sleeve'));
    await flush();
    expect(updateCategoryPreset).toHaveBeenCalledWith('p1', {
      measurement_template: expect.objectContaining({ width: true, length: true, sleeve: true }),
    });
  });

  it('an unchanged value is never written', async () => {
    const { container } = await render();
    const name = field(container, 'display_name');
    focusElement(name);
    type(name, 'Tees');
    focusElement(field(container, 'description'));
    await advance(1000);
    expect(updateCategoryPreset).not.toHaveBeenCalled();
  });

  it('an empty Display name is not sent: the cell says Needed and the list keeps the saved name', async () => {
    const { container } = await render();
    const name = field(container, 'display_name');
    focusElement(name);
    type(name, '');
    focusElement(field(container, 'description'));
    await advance(1000);
    expect(updateCategoryPreset).not.toHaveBeenCalled();
    expect(name.closest('.ui-fieldcell')?.textContent).toContain('Needed');
    expect(card(container, 'Tees')).toBeTruthy();
  });

  it('a failed save shows the server message, keeps the typed value, and Retry re-sends it', async () => {
    vi.mocked(updateCategoryPreset).mockRejectedValueOnce({
      code: 'PGRST204', message: "Could not find the 'custom_sections' column of 'category_presets' in the schema cache",
    });
    const { container } = await render();
    const name = field(container, 'display_name');
    focusElement(name);
    type(name, 'Tees 3');
    focusElement(field(container, 'description'));
    await flush();

    const alert = one(container, '.preset-save--error');
    expect(alert.textContent).toContain("Could not find the 'custom_sections' column");
    expect(alert.textContent).toContain('PGRST204');
    expect(name.value).toBe('Tees 3');
    expect(saveStatus.getState().status).toBe('error');

    click(buttonByText(container, 'Retry'));
    await flush();
    expect(updateCategoryPreset).toHaveBeenCalledTimes(2);
    expect(updateCategoryPreset).toHaveBeenLastCalledWith('p1', { display_name: 'Tees 3' });
    expect(container.querySelector('.preset-save--error')).toBeNull();
    expect(saveStatus.getState().status).toBe('saved');
  });

  it('Add preset creates the row at once and focuses its name with the text selected', async () => {
    vi.mocked(getCategoryPresets).mockResolvedValue([]);
    vi.mocked(createCategoryPreset).mockImplementation(async (input) => ({
      ...input, id: 'new1', user_id: 'u1', created_at: '', updated_at: '',
    }) as unknown as CategoryPreset);
    const { container } = await render();
    click(buttonByText(container, 'Add preset'));
    await flush();

    expect(createCategoryPreset).toHaveBeenCalledTimes(1);
    const input = vi.mocked(createCategoryPreset).mock.calls[0][0];
    expect(input.display_name).toBe('New preset');
    expect(input.gender).toBe('Men');
    expect(input.is_active).toBe(true);
    expect(input.product_type).toBeUndefined();
    expect(input.category_name).toMatch(/^new_preset_[a-z0-9]+$/);

    const name = field(container, 'display_name');
    expect(document.activeElement).toBe(name);
    expect(name.value).toBe('New preset');
    expect(name.selectionStart).toBe(0);
    expect(name.selectionEnd).toBe('New preset'.length);
    // Category is required and shows the marker until one is chosen.
    expect(field(container, 'product_type').closest('.ui-fieldcell')?.textContent).toContain('Needed');
  });

  it('Delete asks inline first (ConfirmAction, no window.confirm), then removes the row', async () => {
    const { container } = await render();
    click(buttonByText(card(container, 'Tees'), 'Delete'));
    expect(container.textContent).toContain('Delete "Tees"?');
    expect(deleteCategoryPreset).not.toHaveBeenCalled();
    click(buttonByText(card(container, 'Tees'), 'Delete'));
    await flush();
    expect(deleteCategoryPreset).toHaveBeenCalledWith('p1');
    expect(container.querySelector('.preset-card')).toBeNull();
  });
});
