import { describe, it, expect } from 'vitest';
import {
  buildProductImageRow,
  buildTransforms,
  mergeProductImageRows,
  stage4ColumnsKnownAvailable,
  __resetStage4ProbeForTests,
  type ExistingProductImageRow,
} from './imageRowSync';
import type { ClothingItem } from '../App';

/**
 * Stage 4 dual-write row builder — shared by registerItemsInDB, the upload
 * upsert, and saveBatchToDatabase. These lock the payload shapes for both
 * states of the world: before the stage4_slim_fields migration runs (no new
 * columns → writing them would fail the WHOLE upsert with PGRST204) and after.
 */

const item = (o: Partial<ClothingItem> & { id: string }): ClothingItem =>
  (o as unknown as ClothingItem);

describe('buildTransforms', () => {
  it('returns null for untouched images (keeps rows clean)', () => {
    expect(buildTransforms({})).toBeNull();
    expect(buildTransforms({ imageRotation: 0 })).toBeNull();
  });

  it('captures rotation without crop', () => {
    expect(buildTransforms({ imageRotation: 90 })).toEqual({ rotation: 90, crop: null });
  });

  it('captures crop with default rotation 0', () => {
    const crop = { x: 5, y: 5, w: 90, h: 90 };
    expect(buildTransforms({ crop })).toEqual({ rotation: 0, crop });
  });

  it('captures both', () => {
    const crop = { x: 1, y: 2, w: 50, h: 60 };
    expect(buildTransforms({ imageRotation: -90, crop })).toEqual({ rotation: -90, crop });
  });
});

describe('buildProductImageRow', () => {
  const full = item({
    id: 'p1',
    storagePath: 'u/p1/img.jpg',
    seoTitle: 'Vintage Nike Tee',
    originalName: 'DSC01.jpg',
    capturedAt: 1710000000000,
    imageRotation: 90,
    crop: { x: 1, y: 2, w: 50, h: 60 },
    originalStoragePath: 'u/p1/orig.jpg',
  });

  it('PRE-migration (stage4=false): never includes the new columns', () => {
    const row = buildProductImageRow(full, 'user-1', 3, 'https://cdn/img.jpg', false);
    expect(row).toEqual({
      image_url: 'https://cdn/img.jpg',
      storage_path: 'u/p1/img.jpg',
      product_id: 'p1',
      user_id: 'user-1',
      position: 3,
      alt_text: 'Vintage Nike Tee',
      original_name: 'DSC01.jpg',
      transforms: { rotation: 90, crop: { x: 1, y: 2, w: 50, h: 60 } },
    });
    expect(row).not.toHaveProperty('captured_at');
    expect(row).not.toHaveProperty('original_storage_path');
  });

  it('POST-migration (stage4=true): includes captured_at and original_storage_path', () => {
    const row = buildProductImageRow(full, 'user-1', 0, 'https://cdn/img.jpg', true);
    expect(row.captured_at).toBe(1710000000000);
    expect(row.original_storage_path).toBe('u/p1/orig.jpg');
  });

  it('nulls the stage4 fields for items without them (legacy/gap-filled items)', () => {
    const bare = item({ id: 'p2', storagePath: 'u/p2/a.jpg' });
    const row = buildProductImageRow(bare, 'user-1', 0, 'https://cdn/a.jpg', true);
    expect(row.captured_at).toBeNull();
    expect(row.original_storage_path).toBeNull();
    expect(row.transforms).toBeNull();
    expect(row.original_name).toBeNull();
    expect(row.alt_text).toBe('Uploaded image');
  });
});

/**
 * mergeProductImageRows — the guard that lets registerItemsInDB keep its
 * delete-then-reinsert (AGENTS.md §18 #3) without destroying a group's photo
 * rows. saveBatchToDatabase writes N rows against the group LEADER with real
 * `position` values; registerItemsInDB only ever knows one row per item, so
 * re-inserting just its own rows collapsed the group to a single photo and
 * flattened every position on EVERY batch open.
 */
describe('mergeProductImageRows', () => {
  const existing = (o: Partial<ExistingProductImageRow> & { product_id: string; image_url: string }) => ({
    storage_path: null,
    user_id: 'u1',
    position: 0,
    alt_text: 'x',
    original_name: null,
    transforms: null,
    ...o,
  }) as ExistingProductImageRow;

  it("carries a group leader's other photos across the wipe, renumbered contiguously", () => {
    const computed = [buildProductImageRow(
      item({ id: 'LEADER', storagePath: 'u/L/a.jpg' }), 'u1', 0, 'https://cdn/a.jpg', false)];
    const rows = mergeProductImageRows(computed, [
      existing({ product_id: 'LEADER', image_url: 'https://cdn/a.jpg', storage_path: 'u/L/a.jpg', position: 0 }),
      existing({ product_id: 'LEADER', image_url: 'https://cdn/b.jpg', storage_path: 'u/L/b.jpg', position: 1 }),
      existing({ product_id: 'LEADER', image_url: 'https://cdn/c.jpg', storage_path: 'u/L/c.jpg', position: 2 }),
    ]);
    expect(rows.map(r => r.image_url)).toEqual(['https://cdn/a.jpg', 'https://cdn/b.jpg', 'https://cdn/c.jpg']);
    expect(rows.map(r => r.position)).toEqual([0, 1, 2]);
  });

  it('keeps the photo in its slot when only the public URL was regenerated, and drops the stale row', () => {
    const computed = [buildProductImageRow(
      item({ id: 'P', storagePath: 'u/P/b.jpg' }), 'u1', 0, 'https://cdn/NEW-b.jpg', false)];
    const rows = mergeProductImageRows(computed, [
      existing({ product_id: 'P', image_url: 'https://cdn/a.jpg', storage_path: 'u/P/a.jpg', position: 0 }),
      existing({ product_id: 'P', image_url: 'https://cdn/OLD-b.jpg', storage_path: 'u/P/b.jpg', position: 1 }),
    ]);
    expect(rows.map(r => r.image_url)).toEqual(['https://cdn/a.jpg', 'https://cdn/NEW-b.jpg']);
    expect(rows.map(r => r.position)).toEqual([0, 1]);
  });

  it('puts a genuinely new photo first (imageUrls[0] is the primary)', () => {
    const computed = [buildProductImageRow(
      item({ id: 'P', storagePath: 'u/P/new.jpg' }), 'u1', 0, 'https://cdn/new.jpg', false)];
    const rows = mergeProductImageRows(computed, [
      existing({ product_id: 'P', image_url: 'https://cdn/old.jpg', storage_path: 'u/P/old.jpg', position: 0 }),
    ]);
    expect(rows.map(r => r.image_url)).toEqual(['https://cdn/new.jpg', 'https://cdn/old.jpg']);
    expect(rows.map(r => r.position)).toEqual([0, 1]);
  });

  it('preserves rows for products we are not writing at all', () => {
    const rows = mergeProductImageRows([], [
      existing({ product_id: 'OTHER', image_url: 'https://cdn/z.jpg', storage_path: 'u/O/z.jpg', position: 3 }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].position).toBe(0);
    expect(rows[0]).not.toHaveProperty('id');
  });

  it('de-duplicates identical image_urls and never emits the DB primary key', () => {
    const rows = mergeProductImageRows([], [
      existing({ product_id: 'P', image_url: 'https://cdn/a.jpg', position: 0, id: 'row-1' }),
      existing({ product_id: 'P', image_url: 'https://cdn/a.jpg', position: 1, id: 'row-2' }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).not.toHaveProperty('id');
  });

  it('is a pure pass-through when there is nothing in the DB yet', () => {
    const computed = [
      buildProductImageRow(item({ id: 'A', storagePath: 'u/A/a.jpg' }), 'u1', 0, 'https://cdn/a.jpg', false),
      buildProductImageRow(item({ id: 'B', storagePath: 'u/B/b.jpg' }), 'u1', 0, 'https://cdn/b.jpg', false),
    ];
    expect(mergeProductImageRows(computed, [])).toEqual(computed);
  });
});

describe('stage4ColumnsKnownAvailable', () => {
  it('is false until the async probe has resolved positively', () => {
    __resetStage4ProbeForTests();
    expect(stage4ColumnsKnownAvailable()).toBe(false);
  });
});
