import { describe, it, expect } from 'vitest';
import { buildProductImageRow, buildTransforms } from './imageRowSync';
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
