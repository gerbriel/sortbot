import { describe, it, expect } from 'vitest';
import { applyPresetDirectly } from './applyPresetToGroup';
import type { CategoryPreset } from './categoryPresets';
import type { ClothingItem } from '../App';

/**
 * Characterization tests for preset application — the priority hierarchy that
 * the June 2026 "preset persistence saga" (15 commits) kept breaking:
 *   1. Voice/manual entry always wins.
 *   2. Preset fills the gaps.
 *   3. force=true resets preset-OWNED fields only; voice fields survive.
 */

const makeItem = (overrides: Partial<ClothingItem> = {}): ClothingItem =>
  ({
    id: 'item-1',
    file: null,
    preview: '',
    ...overrides,
  } as unknown as ClothingItem);

const makePreset = (overrides: Partial<CategoryPreset> = {}): CategoryPreset =>
  ({
    id: 'preset-1',
    user_id: 'user-1',
    category_name: 'tees',
    display_name: 'Tees',
    default_weight_unit: 'oz',
    requires_shipping: true,
    product_type: 'tees',
    default_material: 'Cotton',
    suggested_price_min: 25,
    measurement_template: {},
    is_default: true,
    is_active: true,
    ...overrides,
  } as unknown as CategoryPreset);

describe('applyPresetDirectly', () => {
  it('always sets the category on every item', () => {
    const out = applyPresetDirectly(
      [makeItem(), makeItem({ id: 'item-2' })],
      'tees',
      makePreset()
    );
    expect(out).toHaveLength(2);
    for (const item of out) expect(item.category).toBe('tees');
  });

  it('fills empty fields from the preset', () => {
    const [out] = applyPresetDirectly([makeItem()], 'tees', makePreset());
    expect(out.material).toBe('Cotton');
    expect(out.productType).toBe('tees');
    expect(out.price).toBe(25);
  });

  it('never overwrites voice/manual values in normal mode', () => {
    const [out] = applyPresetDirectly(
      [makeItem({ material: 'Polyester', price: 45, brand: 'Nike' })],
      'tees',
      makePreset()
    );
    expect(out.material).toBe('Polyester');
    expect(out.price).toBe(45);
    expect(out.brand).toBe('Nike');
  });

  it('force mode resets preset-owned fields but keeps voice fields', () => {
    const [out] = applyPresetDirectly(
      [makeItem({
        productType: 'sweatshirts',   // preset-owned — should reset
        material: 'Polyester',        // voice-entered — must survive
        price: 45,                    // voice-entered — must survive
        brand: 'Nike',                // voice-entered — must survive
      })],
      'tees',
      makePreset(),
      true
    );
    expect(out.productType).toBe('tees');
    expect(out.material).toBe('Polyester');
    expect(out.price).toBe(45);
    expect(out.brand).toBe('Nike');
  });

  it('interpolates the SEO title template and drops unresolved tokens', () => {
    const [out] = applyPresetDirectly(
      [makeItem({ brand: 'Nike', size: 'XL' })],
      'tees',
      makePreset({ seo_title_template: '{brand} {model} {category} - Vintage {size}' })
    );
    expect(out.seoTitle).toBeTruthy();
    expect(out.seoTitle).not.toMatch(/\{[a-z]+\}/i); // no leftover {tokens}
    expect(out.seoTitle).toContain('Nike');
    expect(out.seoTitle).toContain('XL');
  });

  it('keeps a real (token-free) existing title instead of the template', () => {
    const [out] = applyPresetDirectly(
      [makeItem({ seoTitle: 'My Hand Written Title' })],
      'tees',
      makePreset({ seo_title_template: '{brand} {category} - Vintage' })
    );
    expect(out.seoTitle).toBe('My Hand Written Title');
  });
});
