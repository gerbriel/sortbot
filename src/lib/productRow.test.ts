import { describe, it, expect, vi } from 'vitest';

vi.mock('./supabase', async () => {
  const { createSupabaseMock } = await import('./testing/supabaseMock');
  return { supabase: createSupabaseMock() };
});

import type { ClothingItem } from '../App';
import {
  productRowToClothingItem,
  mergeProductRowIntoItem,
  imagesFromRow,
  cleanSzTitle,
  STARTUP_MERGE_OPTIONS,
  OPEN_BATCH_MERGE_OPTIONS,
  type ProductRowLite,
} from './productRow';

/**
 * Characterization tests for the four DB-row→ClothingItem copies that lived in
 * App.tsx (architecture review findings #10 and #11).
 *
 * The two BUILDERS were byte-identical, so there is one expected output.
 * The two MERGES were not: they disagree on seven things, every one of which is
 * an option here and is locked below. These tests are what make a future
 * unification a deliberate act with a visible diff instead of a silent
 * behaviour change in one of the two restore paths.
 */

/** Stand-in for App.tsx's htmlDescToPlain — injected, so the test controls it. */
const htmlToPlain = (html: string) => html.replace(/<br\s*\/?>/g, '\n').replace(/<[^>]+>/g, '');

const fullRow = (over: Partial<ProductRowLite> = {}): ProductRowLite => ({
  id: 'p1',
  product_group: 'g1',
  product_images: [
    { image_url: 'https://cdn.test/second.jpg', storage_path: 'u/p1/second.jpg', position: 1, original_name: 'DSC2.jpg' },
    { image_url: 'https://cdn.test/first.jpg', storage_path: 'u/p1/first.jpg', position: 0, original_name: 'DSC1.jpg' },
  ],
  voice_description: 'spoken words',
  description: '<p>Nice tee</p>',
  seo_title: 'Vintage Nike Tee',
  seo_description: 'a tee',
  tags: ['vintage', 'nike'],
  vendor: 'Nike',
  product_category: 'tees',
  product_type: 'T-Shirt',
  published: false,
  status: 'Draft',
  size: 'L',
  color: 'Black',
  secondary_color: 'White',
  price: 45,
  compare_at_price: 60,
  cost_per_item: 10,
  sku: 'SKU1',
  barcode: 'BC1',
  inventory_quantity: 1,
  weight_value: '350',
  requires_shipping: false,
  continue_selling_out_of_stock: true,
  package_dimensions: '8-6-4',
  parcel_size: 'Small',
  ships_from: 'CA',
  condition: 'Good',
  flaws: 'small hole',
  material: 'cotton',
  era: '90s',
  care_instructions: 'cold wash',
  measurements: { width: '20', length: '28' },
  model_name: '501',
  model_number: '501',
  size_type: 'Regular',
  style: 'Streetwear',
  gender: 'Men',
  age_group: 'Adult',
  policies: 'No Returns',
  renewal_options: 'Manual',
  who_made_it: 'Another Company',
  what_is_it: 'A Finished Product',
  listing_type: 'Physical Item',
  discounted_shipping: 'No Discount',
  mpn: 'MPN1',
  custom_label_0: 'Top Seller',
  applied_preset_id: 'preset-9',
  ...over,
});

describe('imagesFromRow', () => {
  it('orders by position and takes the first path/name in that order', () => {
    const { urls, storagePath, originalName } = imagesFromRow(fullRow());
    expect(urls).toEqual(['https://cdn.test/first.jpg', 'https://cdn.test/second.jpg']);
    expect(storagePath).toBe('u/p1/first.jpg');
    expect(originalName).toBe('DSC1.jpg');
  });

  it('does not mutate the row it was given', () => {
    const row = fullRow();
    const before = row.product_images!.map(i => i.image_url);
    imagesFromRow(row);
    expect(row.product_images!.map(i => i.image_url)).toEqual(before);
  });

  it('survives a missing or empty product_images join', () => {
    expect(imagesFromRow({ id: 'x' })).toEqual({ urls: [], storagePath: undefined, originalName: undefined });
    expect(imagesFromRow({ id: 'x', product_images: null }).urls).toEqual([]);
  });

  it('skips rows with no image_url but still finds their storage_path', () => {
    const { urls, storagePath } = imagesFromRow({
      id: 'x',
      product_images: [{ image_url: null, storage_path: 'u/x/a.jpg', position: 0 }],
    });
    expect(urls).toEqual([]);
    expect(storagePath).toBe('u/x/a.jpg');
  });
});

describe('cleanSzTitle', () => {
  it('blanks a title containing the garbled sz artifact so it regenerates', () => {
    expect(cleanSzTitle('Vintage Tee sz L')).toBe('');
    expect(cleanSzTitle('SZ XL Hoodie')).toBe('');
  });
  it('keeps titles where sz is inside a word', () => {
    expect(cleanSzTitle('Szechuan Souvenir Jacket')).toBe('Szechuan Souvenir Jacket');
  });
  it('keeps a clean title untouched', () => {
    expect(cleanSzTitle('Vintage Nike Tee')).toBe('Vintage Nike Tee');
  });
});

describe('productRowToClothingItem — the builder both copies shared', () => {
  it('maps every column to its item field', () => {
    const item = productRowToClothingItem(fullRow(), htmlToPlain);
    expect(item).toMatchObject({
      id: 'p1',
      productGroup: 'g1',
      preview: 'https://cdn.test/first.jpg',
      imageUrls: ['https://cdn.test/first.jpg', 'https://cdn.test/second.jpg'],
      storagePath: 'u/p1/first.jpg',
      originalName: 'DSC1.jpg',
      voiceDescription: 'spoken words',
      generatedDescription: 'Nice tee',
      seoTitle: 'Vintage Nike Tee',
      brand: 'Nike',
      category: 'tees',
      productType: 'T-Shirt',
      published: false,
      status: 'Draft',
      size: 'L',
      color: 'Black',
      secondaryColor: 'White',
      price: 45,
      compareAtPrice: 60,
      costPerItem: 10,
      inventoryQuantity: 1,
      requiresShipping: false,
      continueSellingOutOfStock: true,
      care: 'cold wash',
      measurements: { width: '20', length: '28' },
      gender: 'Men',
      customLabel0: 'Top Seller',
    });
  });

  it('has NO file and NO capturedAt — neither is recoverable from products', () => {
    const item = productRowToClothingItem(fullRow(), htmlToPlain);
    expect(item.file).toBeNull();
    expect(item.capturedAt).toBeUndefined();
  });

  it('falls back to the storage path for preview/imageUrls when no image_url exists', () => {
    const item = productRowToClothingItem(
      fullRow({ product_images: [{ image_url: null, storage_path: 'u/p1/only.jpg', position: 0 }] }),
      htmlToPlain,
    );
    expect(item.preview).toBe('https://cdn.test/u/p1/only.jpg');
    expect(item.imageUrls).toEqual(['https://cdn.test/u/p1/only.jpg']);
    expect(item.thumbnailUrl).toBe('https://cdn.test/u/p1/only.jpg');
  });

  it('applies the documented defaults for an otherwise empty row', () => {
    const item = productRowToClothingItem({ id: 'bare' }, htmlToPlain);
    expect(item).toMatchObject({
      id: 'bare',
      productGroup: 'bare',          // falls back to its own id (leader convention)
      published: true,
      status: 'active',
      requiresShipping: true,
      continueSellingOutOfStock: false,
      tags: [],
      measurements: {},
      brand: '',
      seoTitle: '',
      imageUrls: [],
      preview: '',
    });
    expect(item.price).toBeUndefined();
    expect(item.compareAtPrice).toBeUndefined();
    expect(item.inventoryQuantity).toBeUndefined();
  });

  it('blanks an sz-corrupted title', () => {
    expect(productRowToClothingItem(fullRow({ seo_title: 'Tee sz L' }), htmlToPlain).seoTitle).toBe('');
  });
});

const baseItem = (over: Partial<ClothingItem> = {}): ClothingItem => ({
  id: 'p1',
  file: null as unknown as File,
  preview: 'https://cdn.test/own.jpg',
  imageUrls: ['https://cdn.test/own.jpg'],
  storagePath: 'u/p1/own.jpg',
  ...over,
} as ClothingItem);

describe('mergeProductRowIntoItem — fields both restore paths agree on', () => {
  it('lets the DB row win and keeps the item as the fallback', () => {
    const merged = mergeProductRowIntoItem(
      baseItem({ brand: 'ItemBrand', size: 'M', price: 10 }),
      fullRow(),
      htmlToPlain,
      OPEN_BATCH_MERGE_OPTIONS,
    );
    expect(merged.size).toBe('L');
    expect(merged.price).toBe(45);
    // brand is the ONE exception to this rule — see the block below.
    expect(merged.brand).toBe('ItemBrand');
  });

  // ── Founder report 23 ────────────────────────────────────────────────────
  // products.vendor stores item.brand, and this merge runs on App's BACKGROUND
  // hydration, after the UI is interactive. Row-first meant a brand typed in the
  // first second after load was replaced by whatever the DB held.
  describe('brand — the item wins, so a live edit is never clobbered', () => {
    it.each([OPEN_BATCH_MERGE_OPTIONS, STARTUP_MERGE_OPTIONS])(
      'keeps the in-memory brand over the row vendor (%#)',
      (options) => {
        const merged = mergeProductRowIntoItem(
          baseItem({ brand: 'Carhartt' }),
          { id: 'p1', vendor: 'C&D Vintage' },
          htmlToPlain,
          options,
        );
        expect(merged.brand).toBe('Carhartt');
      });

    it('still takes the row vendor when the item has no brand — the restore case', () => {
      // `brand` is not in the slimForWorkflowState whitelist, so this is what a
      // real hydration looks like and the behaviour there is unchanged.
      const merged = mergeProductRowIntoItem(
        baseItem({ brand: undefined }),
        { id: 'p1', vendor: 'Nike' },
        htmlToPlain,
        OPEN_BATCH_MERGE_OPTIONS,
      );
      expect(merged.brand).toBe('Nike');
    });

    it('treats an empty in-memory brand as absent, not as an edit', () => {
      const merged = mergeProductRowIntoItem(
        baseItem({ brand: '' }),
        { id: 'p1', vendor: 'Nike' },
        htmlToPlain,
        OPEN_BATCH_MERGE_OPTIONS,
      );
      expect(merged.brand).toBe('Nike');
    });
  });

  it('falls back to the item for columns the row does not have', () => {
    const merged = mergeProductRowIntoItem(
      baseItem({ brand: 'ItemBrand', size: 'M' }),
      { id: 'p1', vendor: null, size: null },
      htmlToPlain,
      OPEN_BATCH_MERGE_OPTIONS,
    );
    expect(merged.brand).toBe('ItemBrand');
    expect(merged.size).toBe('M');
  });

  it('uses ?? not || for numerics, so a real 0 from the DB survives', () => {
    const merged = mergeProductRowIntoItem(
      baseItem({ price: 99, inventoryQuantity: 5 }),
      { id: 'p1', price: 0, inventory_quantity: 0 },
      htmlToPlain,
      OPEN_BATCH_MERGE_OPTIONS,
    );
    expect(merged.price).toBe(0);
    expect(merged.inventoryQuantity).toBe(0);
  });

  it('uses ?? for booleans, so an explicit false from the DB survives', () => {
    const merged = mergeProductRowIntoItem(
      baseItem({ published: true, requiresShipping: true }),
      { id: 'p1', published: false, requires_shipping: false },
      htmlToPlain,
      OPEN_BATCH_MERGE_OPTIONS,
    );
    expect(merged.published).toBe(false);
    expect(merged.requiresShipping).toBe(false);
  });

  it('keeps the item tags when the row has an empty array (length check, not truthiness)', () => {
    const merged = mergeProductRowIntoItem(
      baseItem({ tags: ['kept'] }), { id: 'p1', tags: [] }, htmlToPlain, OPEN_BATCH_MERGE_OPTIONS,
    );
    expect(merged.tags).toEqual(['kept']);
  });

  it('blanks an sz-corrupted title from either side', () => {
    expect(mergeProductRowIntoItem(baseItem(), fullRow({ seo_title: 'Tee sz L' }), htmlToPlain, OPEN_BATCH_MERGE_OPTIONS).seoTitle).toBe('');
    expect(mergeProductRowIntoItem(baseItem({ seoTitle: 'Tee sz L' }), { id: 'p1' }, htmlToPlain, OPEN_BATCH_MERGE_OPTIONS).seoTitle).toBe('');
  });

  it('preserves every item field the merge does not name', () => {
    const merged = mergeProductRowIntoItem(
      baseItem({ capturedAt: 1700000000000, crop: { x: 1, y: 2, w: 3, h: 4 }, imageRotation: 90 }),
      fullRow(), htmlToPlain, OPEN_BATCH_MERGE_OPTIONS,
    );
    expect(merged.capturedAt).toBe(1700000000000);
    expect(merged.crop).toEqual({ x: 1, y: 2, w: 3, h: 4 });
    expect(merged.imageRotation).toBe(90);
  });
});

/**
 * The seven divergences. Each `it` below is a place the two restore paths
 * genuinely behaved differently before this extraction; changing any of them is
 * a product decision, not a refactor.
 */
describe('mergeProductRowIntoItem — divergence 1: coerceEmptyStrings', () => {
  const row = { id: 'p1', sku: null, vendor: null };

  it('STARTUP coerced absent strings to the empty string', () => {
    const merged = mergeProductRowIntoItem(baseItem(), row, htmlToPlain, STARTUP_MERGE_OPTIONS);
    expect(merged.sku).toBe('');
    expect(merged.brand).toBe('');
  });

  it('OPEN-BATCH left them undefined', () => {
    const merged = mergeProductRowIntoItem(baseItem(), row, htmlToPlain, OPEN_BATCH_MERGE_OPTIONS);
    expect(merged.sku).toBeUndefined();
    expect(merged.brand).toBeUndefined();
  });

  it("OPEN-BATCH keeps a literal '' from the item rather than turning it into undefined", () => {
    // `a || b` yields '' here; a naive `a || b || undefined` would yield undefined.
    const merged = mergeProductRowIntoItem(baseItem({ sku: '' }), row, htmlToPlain, OPEN_BATCH_MERGE_OPTIONS);
    expect(merged.sku).toBe('');
  });
});

describe('mergeProductRowIntoItem — divergence 2: imageStrategy', () => {
  const groupRow = fullRow(); // two images belonging to the whole GROUP

  it("OPEN-BATCH: the item's OWN image wins over the group list (commit 3a70b52)", () => {
    const merged = mergeProductRowIntoItem(baseItem(), groupRow, htmlToPlain, OPEN_BATCH_MERGE_OPTIONS);
    expect(merged.imageUrls).toEqual(['https://cdn.test/own.jpg']);
    expect(merged.preview).toBe('https://cdn.test/own.jpg');
  });

  it('OPEN-BATCH: the group list is the fallback for an item with no image at all', () => {
    const merged = mergeProductRowIntoItem(
      baseItem({ imageUrls: [], preview: '', storagePath: undefined }),
      groupRow, htmlToPlain, OPEN_BATCH_MERGE_OPTIONS,
    );
    expect(merged.imageUrls).toEqual(['https://cdn.test/first.jpg', 'https://cdn.test/second.jpg']);
    expect(merged.preview).toBe('https://cdn.test/first.jpg');
  });

  it('OPEN-BATCH: rebuilds from storagePath when imageUrls is empty', () => {
    const merged = mergeProductRowIntoItem(
      baseItem({ imageUrls: [], preview: '' }), groupRow, htmlToPlain, OPEN_BATCH_MERGE_OPTIONS,
    );
    expect(merged.imageUrls).toEqual(['https://cdn.test/u/p1/own.jpg']);
  });

  // ── divergence 2 CLOSED (report 16) ───────────────────────────────────────
  // Startup used to be 'db-group-wins'. Two separate data bugs rode on that:
  // a group LEADER's row carries the whole group's photo list, and
  // saveProductToDatabase adds a row for a BAKED (already-rotated) JPEG while
  // leaving item.imageRotation set, so the UI rotated it a second time.
  it("STARTUP: the item's OWN image now wins over the DB group list, like open-batch", () => {
    const merged = mergeProductRowIntoItem(baseItem(), groupRow, htmlToPlain, STARTUP_MERGE_OPTIONS);
    expect(merged.imageUrls).toEqual(['https://cdn.test/own.jpg']);
    expect(merged.preview).toBe('https://cdn.test/own.jpg');
  });

  it('STARTUP: report 16 — a baked, already-rotated row cannot replace the item image', () => {
    // What Save Batch leaves behind: the original row plus a second row holding
    // the rotation-baked file, both at position 0 (so their order is arbitrary).
    const afterSaveBatch: ProductRowLite = {
      id: 'p1',
      product_group: 'g1',
      product_images: [
        { image_url: 'https://cdn.test/baked-rotated.jpg', storage_path: 'u/p1/baked.jpg', position: 0 },
        { image_url: 'https://cdn.test/own.jpg', storage_path: 'u/p1/own.jpg', position: 0 },
      ],
    };
    const item = baseItem({ imageRotation: 90 });
    const merged = mergeProductRowIntoItem(item, afterSaveBatch, htmlToPlain, STARTUP_MERGE_OPTIONS);
    // The item still declares a 90° rotation, so it MUST still be showing the
    // un-rotated original — otherwise the CSS transform doubles it to 180°.
    expect(merged.imageRotation).toBe(90);
    expect(merged.preview).toBe('https://cdn.test/own.jpg');
    expect(merged.imageUrls).not.toContain('https://cdn.test/baked-rotated.jpg');
  });

  it('STARTUP: the DB group list is still the fallback for an item with no image at all', () => {
    const merged = mergeProductRowIntoItem(
      baseItem({ imageUrls: [], preview: '', storagePath: undefined }),
      groupRow, htmlToPlain, STARTUP_MERGE_OPTIONS,
    );
    expect(merged.imageUrls).toEqual(['https://cdn.test/first.jpg', 'https://cdn.test/second.jpg']);
  });

  it('STARTUP: keeps the item images when the row has none', () => {
    const merged = mergeProductRowIntoItem(
      baseItem(), { id: 'p1', product_images: [] }, htmlToPlain, STARTUP_MERGE_OPTIONS,
    );
    expect(merged.imageUrls).toEqual(['https://cdn.test/own.jpg']);
    expect(merged.preview).toBe('https://cdn.test/own.jpg');
  });
});

describe('mergeProductRowIntoItem — divergence 3: descriptionStrategy', () => {
  it('STARTUP falls back to the item when the row HTML renders empty', () => {
    const merged = mergeProductRowIntoItem(
      baseItem({ generatedDescription: 'kept text' }),
      { id: 'p1', description: '<p></p>' }, htmlToPlain, STARTUP_MERGE_OPTIONS,
    );
    expect(merged.generatedDescription).toBe('kept text');
  });

  it('OPEN-BATCH lets an empty row description win', () => {
    const merged = mergeProductRowIntoItem(
      baseItem({ generatedDescription: 'kept text' }),
      { id: 'p1', description: '<p></p>' }, htmlToPlain, OPEN_BATCH_MERGE_OPTIONS,
    );
    expect(merged.generatedDescription).toBe('');
  });

  it('both convert the row HTML to plain text when it has content', () => {
    for (const opts of [STARTUP_MERGE_OPTIONS, OPEN_BATCH_MERGE_OPTIONS]) {
      expect(mergeProductRowIntoItem(baseItem(), { id: 'p1', description: '<p>Hi<br/>there</p>' }, htmlToPlain, opts)
        .generatedDescription).toBe('Hi\nthere');
    }
  });

  it('both fall through to the item when the row column is null', () => {
    for (const opts of [STARTUP_MERGE_OPTIONS, OPEN_BATCH_MERGE_OPTIONS]) {
      expect(mergeProductRowIntoItem(baseItem({ generatedDescription: 'mine' }), { id: 'p1', description: null }, htmlToPlain, opts)
        .generatedDescription).toBe('mine');
    }
  });
});

describe('mergeProductRowIntoItem — divergences 4 and 5: status and measurements defaults', () => {
  it("STARTUP defaulted status to 'Active' and measurements to {}", () => {
    const merged = mergeProductRowIntoItem(baseItem(), { id: 'p1' }, htmlToPlain, STARTUP_MERGE_OPTIONS);
    expect(merged.status).toBe('Active');
    expect(merged.measurements).toEqual({});
  });

  it('OPEN-BATCH left both undefined', () => {
    const merged = mergeProductRowIntoItem(baseItem(), { id: 'p1' }, htmlToPlain, OPEN_BATCH_MERGE_OPTIONS);
    expect(merged.status).toBeUndefined();
    expect(merged.measurements).toBeUndefined();
  });

  it('a row value still wins under both', () => {
    for (const opts of [STARTUP_MERGE_OPTIONS, OPEN_BATCH_MERGE_OPTIONS]) {
      const merged = mergeProductRowIntoItem(baseItem(), fullRow(), htmlToPlain, opts);
      expect(merged.status).toBe('Draft');
      expect(merged.measurements).toEqual({ width: '20', length: '28' });
    }
  });
});

describe('mergeProductRowIntoItem — divergences 6 and 7: which extra fields each path sets', () => {
  // ── divergence 6 CHANGED (report 29) ──────────────────────────────────────
  // products.product_group is a LAGGING mirror of workflow_state, written by a
  // different 2 s debounce; letting it win silently un-grouped restored batches.
  it("OPEN-BATCH keeps the ITEM's productGroup and sets originalName, but not appliedPresetId", () => {
    const merged = mergeProductRowIntoItem(
      baseItem({ productGroup: 'live-group', appliedPresetId: 'item-preset' }),
      fullRow(), htmlToPlain, OPEN_BATCH_MERGE_OPTIONS,
    );
    expect(merged.productGroup).toBe('live-group'); // NOT the row's 'g1'
    expect(merged.originalName).toBe('DSC1.jpg');
    expect(merged.appliedPresetId).toBe('item-preset'); // untouched, carried by the spread
  });

  it('OPEN-BATCH: report 29 — a stale row cannot re-group an item the user ungrouped', () => {
    // workflow_state says "singleton" (productGroup === own id); the products row
    // still carries the group the user just broke up.
    const merged = mergeProductRowIntoItem(
      baseItem({ productGroup: 'p1' }),
      { id: 'p1', product_group: 'old-group' }, htmlToPlain, OPEN_BATCH_MERGE_OPTIONS,
    );
    expect(merged.productGroup).toBe('p1');
  });

  it("OPEN-BATCH: a mismatched (title-matched) row cannot move an item into another product's group", () => {
    const merged = mergeProductRowIntoItem(
      baseItem({ productGroup: 'my-group' }),
      { id: 'SOMEONE-ELSE', product_group: 'their-group' }, htmlToPlain, OPEN_BATCH_MERGE_OPTIONS,
    );
    expect(merged.productGroup).toBe('my-group');
  });

  it("'row-wins' is still available and is the default for setProductGroup: true", () => {
    const row = { id: 'p1', product_group: 'g1' };
    const item = baseItem({ productGroup: 'live-group' });
    expect(mergeProductRowIntoItem(item, row, htmlToPlain, { setProductGroup: true }).productGroup)
      .toBe('g1');
    expect(mergeProductRowIntoItem(item, row, htmlToPlain, { setProductGroup: 'row-wins' }).productGroup)
      .toBe('g1');
  });

  it('STARTUP leaves productGroup and originalName alone and sets appliedPresetId', () => {
    const merged = mergeProductRowIntoItem(
      baseItem({ productGroup: 'old-group', appliedPresetId: 'item-preset' }),
      fullRow(), htmlToPlain, STARTUP_MERGE_OPTIONS,
    );
    expect(merged.productGroup).toBe('old-group');
    expect(merged.originalName).toBeUndefined();
    expect(merged.appliedPresetId).toBe('preset-9');
  });

  it("OPEN-BATCH prefers the item's own originalName over the row's", () => {
    const merged = mergeProductRowIntoItem(
      baseItem({ originalName: 'MINE.jpg' }), fullRow(), htmlToPlain, OPEN_BATCH_MERGE_OPTIONS,
    );
    expect(merged.originalName).toBe('MINE.jpg');
  });

  it('OPEN-BATCH falls back to the item id when the item has no group', () => {
    const merged = mergeProductRowIntoItem(baseItem(), { id: 'p1' }, htmlToPlain, OPEN_BATCH_MERGE_OPTIONS);
    expect(merged.productGroup).toBe('p1');
  });
});

describe('the two option presets are the two call sites', () => {
  it('no longer differ on imageStrategy — divergence 2 is closed', () => {
    expect(STARTUP_MERGE_OPTIONS.imageStrategy).toBe('own-image-wins');
    expect(OPEN_BATCH_MERGE_OPTIONS.imageStrategy).toBe('own-image-wins');
  });

  it('differ in exactly the six remaining documented options', () => {
    const keys = new Set([...Object.keys(STARTUP_MERGE_OPTIONS), ...Object.keys(OPEN_BATCH_MERGE_OPTIONS)]);
    const differing = [...keys].filter(
      k => (STARTUP_MERGE_OPTIONS as Record<string, unknown>)[k]
        !== (OPEN_BATCH_MERGE_OPTIONS as Record<string, unknown>)[k],
    ).sort();
    expect(differing).toEqual([
      'coerceEmptyStrings',
      'defaultEmptyMeasurements',
      'defaultStatus',
      'descriptionStrategy',
      'setAppliedPresetId',
      'setOriginalName',
      'setProductGroup',
    ]);
  });
});
