import { describe, it, expect } from 'vitest';
import { applyPresetDirectly } from './applyPresetToGroup';
import { resolvePreset } from './presetResolver';
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

describe('applyPresetDirectly — field wiring (July 2026 audit fixes)', () => {
  it('converts preset weight to grams (item.weightValue is always grams)', () => {
    const [lb] = applyPresetDirectly([makeItem()], 'tees',
      makePreset({ default_weight_value: '1', default_weight_unit: 'lb' }));
    expect(lb.weightValue).toBe('454'); // 1 lb ≈ 453.592 g, rounded

    const [oz] = applyPresetDirectly([makeItem()], 'tees',
      makePreset({ default_weight_value: '8', default_weight_unit: 'oz' }));
    expect(oz.weightValue).toBe('227'); // 8 oz ≈ 226.8 g

    const [g] = applyPresetDirectly([makeItem()], 'tees',
      makePreset({ default_weight_value: '350', default_weight_unit: 'g' }));
    expect(g.weightValue).toBe('350');

    // Item's own weight (already grams) always wins
    const [own] = applyPresetDirectly([makeItem({ weightValue: '300' })], 'tees',
      makePreset({ default_weight_value: '1', default_weight_unit: 'lb' }));
    expect(own.weightValue).toBe('300');
  });

  it('preset vendor NEVER becomes the item brand (Vendor is the seller, set at export time)', () => {
    const [out] = applyPresetDirectly([makeItem()], 'tees',
      makePreset({ vendor: 'C&D Vintage' }));
    expect(out.brand).toBeUndefined();

    const [voiceKept] = applyPresetDirectly([makeItem({ brand: 'Nike' })], 'tees',
      makePreset({ vendor: 'C&D Vintage' }));
    expect(voiceKept.brand).toBe('Nike');
  });

  // ── Report 23 ────────────────────────────────────────────────────────────
  // A build that shipped for 34 minutes in July 2026 did `item.brand ||
  // preset.vendor`. The wiring was reverted; the ROWS it wrote were not, and
  // products.vendor is the storage column for item.brand, so every reload
  // re-serves the shop name as the brand. Applying a preset heals it.
  it('a brand that IS the preset vendor is dropped, not preserved', () => {
    const [healed] = applyPresetDirectly([makeItem({ brand: 'C&D Vintage' })], 'tees',
      makePreset({ vendor: 'C&D Vintage' }));
    expect(healed.brand).toBeUndefined();
  });

  it('heals through case, punctuation and the &/and spelling', () => {
    for (const poisoned of ['c and d vintage', 'C&D VINTAGE.', 'c & d  vintage']) {
      const [out] = applyPresetDirectly([makeItem({ brand: poisoned })], 'tees',
        makePreset({ vendor: 'C&D Vintage' }));
      expect(out.brand, poisoned).toBeUndefined();
    }
  });

  it('never touches a real brand, including one that merely contains "Vintage"', () => {
    const [kept] = applyPresetDirectly([makeItem({ brand: 'American Vintage' })], 'tees',
      makePreset({ vendor: 'C&D Vintage' }));
    expect(kept.brand).toBe('American Vintage');
  });

  it('a preset with no vendor leaves the brand exactly as it was', () => {
    const [kept] = applyPresetDirectly([makeItem({ brand: 'Carhartt' })], 'tees', makePreset({}));
    expect(kept.brand).toBe('Carhartt');
  });

  it('force mode still cannot put the vendor into brand', () => {
    const [forced] = applyPresetDirectly([makeItem({ brand: 'Nike' })], 'tees',
      makePreset({ vendor: 'C&D Vintage' }), true);
    expect(forced.brand).toBe('Nike');
  });

  it('falls back to suggested_price_max for compare-at when compare_at_price is unset', () => {
    const [maxFallback] = applyPresetDirectly([makeItem()], 'tees',
      makePreset({ suggested_price_max: 60 }));
    expect(maxFallback.compareAtPrice).toBe(60);

    const [explicitWins] = applyPresetDirectly([makeItem()], 'tees',
      makePreset({ suggested_price_max: 60, compare_at_price: 80 }));
    expect(explicitWins.compareAtPrice).toBe(80);

    const [itemWins] = applyPresetDirectly([makeItem({ compareAtPrice: 45 })], 'tees',
      makePreset({ suggested_price_max: 60 }));
    expect(itemWins.compareAtPrice).toBe(45);
  });
});

/**
 * resolvePreset — the shared matcher (architecture review duplicate #4).
 *
 * Two copies had diverged: CategoryZones' 4-step version (which knows about the
 * "<name>_default_<rand>" preset createCategory auto-creates) and
 * applyPresetToGroup's 3-step version. The 4th step is opt-in so migrating either
 * caller cannot change which preset it picks. These tests are the lock.
 */
describe('resolvePreset', () => {
  const p = (o: Partial<CategoryPreset>) =>
    ({ is_active: true, is_default: false, category_name: '', ...o }) as CategoryPreset;

  it('prefers an exact product_type match that is default', () => {
    const list = [p({ id: 'a', product_type: 'tees' }), p({ id: 'b', product_type: 'Tees', is_default: true })];
    expect(resolvePreset(list, 'TEES')?.id).toBe('b');
  });

  it('falls back to any exact product_type match when none is default', () => {
    const list = [p({ id: 'c', category_name: 'tees' }), p({ id: 'd', product_type: 'tees' })];
    expect(resolvePreset(list, 'tees')?.id).toBe('d');
  });

  it('falls back to the legacy category_name match last', () => {
    expect(resolvePreset([p({ id: 'e', category_name: 'hats' })], 'hats')?.id).toBe('e');
  });

  it('is case-insensitive on both sides', () => {
    expect(resolvePreset([p({ id: 'f', product_type: 'OuterWear' })], 'outerwear')?.id).toBe('f');
  });

  it('ignores inactive presets', () => {
    expect(resolvePreset([p({ id: 'g', product_type: 'hats', is_active: false })], 'hats')).toBeUndefined();
  });

  it('matches "<name>_default…" ONLY when allowDefaultPrefix is set', () => {
    const list = [p({ id: 'h', category_name: 'hats_default_91k' })];
    expect(resolvePreset(list, 'hats')).toBeUndefined();
    expect(resolvePreset(list, 'hats', { allowDefaultPrefix: true })?.id).toBe('h');
  });

  it('never falls back to an unrelated default preset (the July 2026 audit fix)', () => {
    expect(resolvePreset([p({ id: 'i', product_type: 'jeans', is_default: true })], 'hats')).toBeUndefined();
  });

  it('returns undefined for an empty category, list or undefined input', () => {
    expect(resolvePreset([p({ id: 'j', product_type: 'hats' })], '')).toBeUndefined();
    expect(resolvePreset([], 'hats')).toBeUndefined();
    expect(resolvePreset(undefined, 'hats')).toBeUndefined();
    expect(resolvePreset([p({ id: 'k', product_type: 'hats' })], undefined)).toBeUndefined();
  });
});

describe('report 3 — the categoryName argument is the LISTING category, not the preset type', () => {
  // applyPresetFields always writes `category: categoryName`. Step 3 used to pass
  // `preset.product_type` there, which overwrote the Step-2 category with the
  // preset's type. That broke two things at once: the category stopped sticking,
  // and `productType !== category` — the signal every auto-apply guard uses to
  // detect a manual override — was flattened, so the next regeneration re-resolved
  // a preset from scratch and could land on an unrelated one.
  const preset = makePreset({
    product_type: 'Mens Sweatshirts',
    category_name: 'sweatshirts',
    gender: 'Men',
  });

  it('keeps the listing category while taking productType from the preset', () => {
    const [out] = applyPresetDirectly(
      [{ id: 'i1', category: 'sweatshirts' } as ClothingItem],
      'sweatshirts',
      preset,
      true,
    );
    expect(out.category).toBe('sweatshirts');
    expect(out.productType).toBe('Mens Sweatshirts');
  });

  it('leaves the override signal (productType !== category) intact', () => {
    const [out] = applyPresetDirectly(
      [{ id: 'i1', category: 'sweatshirts' } as ClothingItem],
      'sweatshirts',
      preset,
      true,
    );
    expect(out.productType!.toLowerCase()).not.toBe(out.category!.toLowerCase());
  });

  it('destroys that signal when the preset type is passed as the category', () => {
    // The shape of the bug, kept as documentation of what must not be done.
    const [out] = applyPresetDirectly(
      [{ id: 'i1', category: 'sweatshirts' } as ClothingItem],
      preset.product_type!,
      preset,
      true,
    );
    expect(out.category).toBe('Mens Sweatshirts');
    expect(out.productType!.toLowerCase()).toBe(out.category!.toLowerCase());
  });

  it('records the preset identity so regeneration can resolve it again', () => {
    const [out] = applyPresetDirectly(
      [{ id: 'i1', category: 'sweatshirts' } as ClothingItem],
      'sweatshirts',
      preset,
      true,
    );
    expect(out.appliedPresetId).toBe(preset.id);
    expect(out._presetData?.presetId).toBe(preset.id);
  });
});

describe('report 3 — resolvePreset prefers the default over an arbitrary first match', () => {
  const p = (o: Partial<CategoryPreset>) =>
    ({ is_active: true, is_default: false, category_name: '', ...o }) as CategoryPreset;

  it('picks the default when two presets share a product_type', () => {
    // The old regeneration chain used a bare `.find()` here, so whichever row the
    // DB returned first won — that is the "unrelated preset group" in the report.
    const list = [
      p({ id: 'first', product_type: 'sweatshirts' }),
      p({ id: 'default', product_type: 'sweatshirts', is_default: true }),
    ];
    expect(resolvePreset(list, 'sweatshirts')?.id).toBe('default');
  });
});
