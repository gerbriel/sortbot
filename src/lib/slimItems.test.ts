import { describe, it, expect } from 'vitest';
import { slimForWorkflowState, ultraSlimForBackup, asClothingItems } from './slimItems';
import type { PersistedWorkflowItem } from './slimItems';
import type { ClothingItem } from '../App';

/**
 * The save→reload contract (AGENTS.md §11). If these fail, either a field
 * silently stopped surviving page reloads, or heavy/unserializable data
 * (File objects, blob previews) started leaking into the Supabase JSONB blob.
 */

const fullItem = (): ClothingItem =>
  ({
    id: 'item-1',
    file: new File(['x'], 'DSC01.jpg'),          // must NEVER be persisted
    preview: 'blob:http://localhost/abc',         // must NEVER be persisted
    _presetData: { presetId: 'p1' },              // runtime-only — never persisted
    generatedDescription: 'big text lives in the products table, not the blob',
    voiceDescription: 'also DB-recovered',
    seoTitle: 'also DB-recovered',
    storagePath: 'user/prod/img.jpg',
    imageUrls: ['https://cdn/img.jpg'],
    thumbnailUrl: 'https://cdn/img.jpg',
    productGroup: 'group-1',
    category: 'tees',
    capturedAt: 1710000000000,
    originalName: 'DSC01.jpg',
    imageRotation: 90,
    crop: { x: 1, y: 2, w: 50, h: 60 },
    originalStoragePath: 'user/prod/orig.jpg',
    originalUrl: 'https://cdn/orig.jpg',
    descriptionEdited: true,
    customDescription: 'faded, boxy, single stitch',
    productImageId: 'img-row-1',
    compositeStoragePath: 'user/prod/img-bg.jpg',
    maskStatus: 'approved',
    // Service-owned detail read on demand, NOT persisted — the row read is
    // always back before a reviewer can open a photo.
    cutoutStoragePath: 'user/prod/img-cut.png',
    bgPreset: '7abc910f',
    maskScore: 0.94,
    maskFlags: ['soft'],
  } as unknown as ClothingItem);

describe('slimForWorkflowState (Supabase workflow_state blob)', () => {
  it('preserves exactly the fields that cannot be recovered from the DB', () => {
    const [slim] = slimForWorkflowState([fullItem()]);
    expect(slim).toEqual({
      id: 'item-1',
      storagePath: 'user/prod/img.jpg',
      // DERIVED from storagePath, so deliberately NOT persisted — see the
      // "derived image fields" block below for the full contract.
      imageUrls: undefined,
      thumbnailUrl: undefined,
      productGroup: 'group-1',
      category: 'tees',
      capturedAt: 1710000000000,
      originalName: 'DSC01.jpg',
      imageRotation: 90,
      crop: { x: 1, y: 2, w: 50, h: 60 },
      originalStoragePath: 'user/prod/orig.jpg',
      originalUrl: 'https://cdn/orig.jpg',
      brandCategory: undefined,
      descriptionEdited: true,
      customDescription: 'faded, boxy, single stitch',
      // Photo backgrounds: the three the first render after a reload needs.
      productImageId: 'img-row-1',
      compositeStoragePath: 'user/prod/img-bg.jpg',
      maskStatus: 'approved',
    });
  });

  it('strips File objects, blob previews, preset cache, and DB-recoverable text', () => {
    const [slim] = slimForWorkflowState([fullItem()]) as unknown as Record<string, unknown>[];
    expect(slim).not.toHaveProperty('file');
    expect(slim).not.toHaveProperty('preview');
    expect(slim).not.toHaveProperty('_presetData');
    expect(slim).not.toHaveProperty('generatedDescription');
    expect(slim).not.toHaveProperty('voiceDescription');
    expect(slim).not.toHaveProperty('seoTitle');
  });

  it('persists only three of the seven background fields — the rest are read on demand', () => {
    const [slim] = slimForWorkflowState([fullItem()]) as unknown as Record<string, unknown>[];
    expect(slim.productImageId).toBe('img-row-1');
    expect(slim.compositeStoragePath).toBe('user/prod/img-bg.jpg');
    expect(slim.maskStatus).toBe('approved');
    // Only ever read on a photo the reviewer has opened, by which time
    // fetchImageRowsForProducts has landed. Keeping them would grow every
    // autosave PATCH for data nothing reads on first paint.
    expect(slim).not.toHaveProperty('cutoutStoragePath');
    expect(slim).not.toHaveProperty('bgPreset');
    expect(slim).not.toHaveProperty('maskScore');
    expect(slim).not.toHaveProperty('maskFlags');
  });

  it('output is JSON-serializable (blob-safe)', () => {
    const slimmed = slimForWorkflowState([fullItem()]);
    const roundtrip = JSON.parse(JSON.stringify(slimmed));
    expect(roundtrip[0].id).toBe('item-1');
    expect(roundtrip[0].crop).toEqual({ x: 1, y: 2, w: 50, h: 60 });
  });
});

describe('ultraSlimForBackup (localStorage race backup)', () => {
  it('keeps only the 7 race-detection fields', () => {
    const backup = ultraSlimForBackup(fullItem());
    expect(Object.keys(backup).sort()).toEqual(
      ['capturedAt', 'category', 'crop', 'id', 'imageRotation', 'productGroup', 'storagePath'].sort()
    );
  });
});

/**
 * F8 — the derived image fields.
 *
 * `imageUrls` and `thumbnailUrl` are both `getPublicUrl(storagePath)`, and every
 * restore path rebuilds them from `storagePath` while discarding whatever was saved
 * (App startup restore, handleOpenBatch, handleImagesGrouped, libraryData pass 1).
 * Persisting them was 51 % of a measured 1 067 KB autosave payload for zero
 * information. They are now omitted WHENEVER a storagePath is present — and kept
 * whenever it is not, because a legacy item has no other reference to its picture.
 */
describe('slimForWorkflowState — derived image fields (F8)', () => {
  it('omits imageUrls and thumbnailUrl when storagePath can rebuild them', () => {
    const [slim] = slimForWorkflowState([fullItem()]);
    expect(slim.storagePath).toBe('user/prod/img.jpg');
    expect(slim.imageUrls).toBeUndefined();
    expect(slim.thumbnailUrl).toBeUndefined();
  });

  it('KEEPS imageUrls and thumbnailUrl for a legacy item with no storagePath', () => {
    const legacy = { ...fullItem(), storagePath: undefined } as unknown as ClothingItem;
    const [slim] = slimForWorkflowState([legacy]);
    expect(slim.storagePath).toBeUndefined();
    expect(slim.imageUrls).toEqual(['https://cdn/img.jpg']);
    expect(slim.thumbnailUrl).toBe('https://cdn/img.jpg');
  });

  it('treats an empty-string storagePath as not derivable', () => {
    const blank = { ...fullItem(), storagePath: '' } as unknown as ClothingItem;
    const [slim] = slimForWorkflowState([blank]);
    expect(slim.imageUrls).toEqual(['https://cdn/img.jpg']);
  });

  it('drops the two derived keys from the serialized blob entirely', () => {
    // `undefined` values disappear through JSON.stringify — this is where the
    // payload saving actually materializes.
    const json = JSON.stringify(slimForWorkflowState([fullItem()]));
    expect(json).not.toContain('imageUrls');
    expect(json).not.toContain('thumbnailUrl');
    expect(json).toContain('storagePath');
  });

  it('a 1 000-item batch serializes smaller than it did with the derived fields', () => {
    const items = Array.from({ length: 1000 }, (_, i) =>
      ({ ...fullItem(), id: `item-${i}`, storagePath: `user/prod/img-${i}.jpg` } as unknown as ClothingItem));
    const withDerived = JSON.stringify(
      slimForWorkflowState(items).map((s, i) => ({
        ...s,
        imageUrls: [`https://cdn/img-${i}.jpg`],
        thumbnailUrl: `https://cdn/img-${i}.jpg`,
      })),
    ).length;
    const actual = JSON.stringify(slimForWorkflowState(items)).length;
    expect(actual).toBeLessThan(withDerived);
  });
});

/**
 * The unified persisted-item type (architecture review finding #13).
 *
 * `workflowBatchService.ts` used to declare its own 5-field `SlimItem` as the
 * shape of `workflow_state.processedItems` while THIS module's writer had been
 * persisting 15 fields — so the type understated the blob and every consumer
 * cast around it. There is now one type; these tests lock the two properties
 * consumers depend on.
 */
describe('PersistedWorkflowItem / asClothingItems', () => {
  it('admits a slim item written by slimForWorkflowState', () => {
    const [slim] = slimForWorkflowState([fullItem()]);
    const persisted: PersistedWorkflowItem = slim;   // type-level assertion
    expect(persisted.id).toBe('item-1');
    expect(persisted.storagePath).toBe('user/prod/img.jpg');
  });

  it('admits a LEGACY whole ClothingItem — old batches still hold them', () => {
    const persisted: PersistedWorkflowItem = fullItem();   // type-level assertion
    expect(persisted.seoTitle).toBe('also DB-recovered');
  });

  it('exposes the ClothingItem fields consumers read off the blob without a cast', () => {
    const persisted: PersistedWorkflowItem = fullItem();
    // These four reads are what libraryData's two passes do; they each needed an
    // `as ClothingItem` cast when the type claimed only 5 fields existed.
    expect([persisted.preview, persisted.seoTitle, persisted.storagePath, persisted.category])
      .toEqual(['blob:http://localhost/abc', 'also DB-recovered', 'user/prod/img.jpg', 'tees']);
  });

  it('asClothingItems widens without adding, removing or normalising any field', () => {
    const slim = slimForWorkflowState([fullItem()]);
    const widened = asClothingItems(slim);
    expect(widened).toBe(slim as unknown as typeof widened);  // same array identity
    expect(widened[0]).toBe(slim[0] as unknown as typeof widened[0]);
    expect(Object.keys(widened[0])).toEqual(Object.keys(slim[0]));
  });

  it('asClothingItems turns undefined into an empty array', () => {
    expect(asClothingItems(undefined)).toEqual([]);
  });
});
