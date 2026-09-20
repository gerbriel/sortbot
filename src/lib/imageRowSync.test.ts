import { describe, it, expect } from 'vitest';
import {
  buildProductImageRow,
  buildTransforms,
  mergeProductImageRows,
  stage4ColumnsKnownAvailable,
  __resetStage4ProbeForTests,
  backgroundColumnsKnownAvailable,
  __resetBackgroundColumnProbeForTests,
  BACKGROUND_COLUMNS,
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


/**
 * Photo backgrounds across the delete-then-reinsert.
 *
 * `registerItemsInDB` wipes every product_images row for the batch on EVERY
 * open and on startup restore, and rebuilds them from in-memory items. The
 * matting service owns five of the six mask columns and a reviewer owns the
 * sixth, so a whole-row replacement here erases a day of work on the next
 * refresh. These lock the guard (AGENTS.md §18).
 */
describe('photo-background columns', () => {
  const bgItem = item({
    id: 'p1',
    storagePath: 'u/p1/img.jpg',
    cutoutStoragePath: 'u/p1/img-cut.png',
    compositeStoragePath: 'u/p1/img-bg.jpg',
    bgPreset: '7abc910f',
    maskStatus: 'approved',
    maskScore: 0.93,
    maskFlags: ['soft'],
  });

  it('PRE-migration (background=false): names none of the six columns', () => {
    const row = buildProductImageRow(bgItem, 'u1', 0, 'https://cdn/img.jpg', false);
    for (const col of BACKGROUND_COLUMNS) expect(row).not.toHaveProperty(col);
  });

  it('defaults to false, so no existing caller starts writing them', () => {
    const row = buildProductImageRow(bgItem, 'u1', 0, 'https://cdn/img.jpg', true);
    for (const col of BACKGROUND_COLUMNS) expect(row).not.toHaveProperty(col);
  });

  it('POST-migration (background=true): carries what the item knows', () => {
    const row = buildProductImageRow(bgItem, 'u1', 0, 'https://cdn/img.jpg', false, true);
    expect(row.cutout_storage_path).toBe('u/p1/img-cut.png');
    expect(row.composite_storage_path).toBe('u/p1/img-bg.jpg');
    expect(row.bg_preset).toBe('7abc910f');
    expect(row.mask_status).toBe('approved');
    expect(row.mask_score).toBe(0.93);
    expect(row.mask_flags).toEqual(['soft']);
  });

  it('nulls them for an item that has never been processed — EXCEPT mask_flags', () => {
    const row = buildProductImageRow(
      item({ id: 'p2', storagePath: 'u/p2/a.jpg' }), 'u1', 0, 'https://cdn/a.jpg', false, true);
    for (const col of BACKGROUND_COLUMNS) {
      if (col === 'mask_flags') continue;
      expect(row[col]).toBeNull();
    }
    // `mask_flags` is `not null default '{}'` in image_backgrounds.sql — writing
    // null there fails the whole insert, and this row builder feeds the
    // delete-then-reinsert that runs on every batch open.
    expect(row.mask_flags).toEqual([]);
  });

  it('backgroundColumnsKnownAvailable is false until the probe resolves positively', () => {
    __resetBackgroundColumnProbeForTests();
    expect(backgroundColumnsKnownAvailable()).toBe(false);
  });
});

describe('mergeProductImageRows — the wipe must never drop mask state', () => {
  const dbRow = (o: Partial<ExistingProductImageRow> & { product_id: string; image_url: string }) => ({
    storage_path: null,
    user_id: 'u1',
    position: 0,
    alt_text: 'x',
    original_name: null,
    transforms: null,
    ...o,
  }) as ExistingProductImageRow;

  const fullExisting = () => dbRow({
    product_id: 'p1', image_url: 'https://cdn/img.jpg', storage_path: 'u/p1/img.jpg',
    cutout_storage_path: 'u/p1/img-cut.png',
    composite_storage_path: 'u/p1/img-bg.jpg',
    bg_preset: '7abc910f',
    mask_status: 'auto',
    mask_score: 0.96,
    mask_flags: [],
  });

  it('preserves ALL six when the computed row knows none of them (the startup-restore case)', () => {
    const computed = [buildProductImageRow(
      item({ id: 'p1', storagePath: 'u/p1/img.jpg' }), 'u1', 0, 'https://cdn/img.jpg', false, true)];
    const [row] = mergeProductImageRows(computed, [fullExisting()]);
    expect(row.cutout_storage_path).toBe('u/p1/img-cut.png');
    expect(row.composite_storage_path).toBe('u/p1/img-bg.jpg');
    expect(row.bg_preset).toBe('7abc910f');
    expect(row.mask_status).toBe('auto');
    expect(row.mask_score).toBe(0.96);
    expect(row.mask_flags).toEqual([]);
  });

  it('preserves PER COLUMN — an item that knows only its status keeps the score and flags', () => {
    // Exactly what a reloaded item looks like: slimForWorkflowState persists
    // three of the six, so the other three arrive null.
    const computed = [buildProductImageRow(
      item({
        id: 'p1', storagePath: 'u/p1/img.jpg',
        compositeStoragePath: 'u/p1/img-bg.jpg', maskStatus: 'approved',
      }), 'u1', 0, 'https://cdn/img.jpg', false, true)];
    const [row] = mergeProductImageRows(computed, [fullExisting()]);
    expect(row.mask_status).toBe('approved');          // the reviewer's newer verdict WINS
    expect(row.mask_score).toBe(0.96);                 // the service's, preserved
    expect(row.bg_preset).toBe('7abc910f');            // the service's, preserved
    expect(row.cutout_storage_path).toBe('u/p1/img-cut.png');
  });

  it('an EMPTY mask_flags from the app is "nothing to say", not "no warnings"', () => {
    // A hydrating item never carries flags — they are outside the
    // slimForWorkflowState whitelist — so the builder writes []. Reading that
    // as an answer would clear a real warning on every batch open.
    const computed = [buildProductImageRow(
      item({ id: 'p1', storagePath: 'u/p1/img.jpg', maskStatus: 'review' }),
      'u1', 0, 'https://cdn/img.jpg', false, true)];
    const existingFlagged = dbRow({
      product_id: 'p1', image_url: 'https://cdn/img.jpg', storage_path: 'u/p1/img.jpg',
      mask_status: 'review', mask_flags: ['edge', 'soft'],
    });
    const [row] = mergeProductImageRows(computed, [existingFlagged]);
    expect(row.mask_flags).toEqual(['edge', 'soft']);
  });

  it('a new photo with no counterpart still writes [] rather than null', () => {
    const computed = [buildProductImageRow(
      item({ id: 'p1', storagePath: 'u/p1/new.jpg' }), 'u1', 0, 'https://cdn/new.jpg', false, true)];
    const [row] = mergeProductImageRows(computed, []);
    expect(row.mask_flags).toEqual([]);
    expect(row.mask_flags).not.toBeNull();
  });

  it('matches on storage_path, so a regenerated public URL still keeps the mask', () => {
    const computed = [buildProductImageRow(
      item({ id: 'p1', storagePath: 'u/p1/img.jpg' }), 'u1', 0, 'https://cdn2/img.jpg', false, true)];
    const [row] = mergeProductImageRows(computed, [fullExisting()]);
    expect(row.image_url).toBe('https://cdn2/img.jpg');
    expect(row.mask_status).toBe('auto');
  });

  it('never invents a column PRE-migration — an absent column stays absent', () => {
    const computed = [buildProductImageRow(
      item({ id: 'p1', storagePath: 'u/p1/img.jpg' }), 'u1', 0, 'https://cdn/img.jpg', false)];
    const existingNoBg = dbRow({
      product_id: 'p1', image_url: 'https://cdn/img.jpg', storage_path: 'u/p1/img.jpg',
    });
    const [row] = mergeProductImageRows(computed, [existingNoBg]);
    for (const col of BACKGROUND_COLUMNS) expect(row).not.toHaveProperty(col);
  });

  it('a genuinely NEW photo carries no borrowed mask state', () => {
    const computed = [buildProductImageRow(
      item({ id: 'p1', storagePath: 'u/p1/new.jpg' }), 'u1', 0, 'https://cdn/new.jpg', false, true)];
    const rows = mergeProductImageRows(computed, [fullExisting()]);
    const fresh = rows.find(r => r.storage_path === 'u/p1/new.jpg')!;
    expect(fresh.mask_status).toBeNull();
    // and the existing photo is still carried across, untouched
    const kept = rows.find(r => r.storage_path === 'u/p1/img.jpg')!;
    expect(kept.mask_status).toBe('auto');
  });

  it('a carried-forward row that is not replaced keeps its mask columns verbatim', () => {
    const computed = [buildProductImageRow(
      item({ id: 'p1', storagePath: 'u/p1/a.jpg' }), 'u1', 0, 'https://cdn/a.jpg', false, true)];
    const other = dbRow({
      product_id: 'p1', image_url: 'https://cdn/b.jpg', storage_path: 'u/p1/b.jpg', position: 1,
      mask_status: 'review', mask_flags: ['edge'],
    });
    const rows = mergeProductImageRows(computed, [other]);
    const carried = rows.find(r => r.storage_path === 'u/p1/b.jpg')!;
    expect(carried.mask_status).toBe('review');
    expect(carried.mask_flags).toEqual(['edge']);
  });
});
