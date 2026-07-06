import { describe, it, expect } from 'vitest';
import { slimForWorkflowState, ultraSlimForBackup } from './slimItems';
import type { ClothingItem } from '../App';

/**
 * The save→reload contract (CLAUDE.md §11). If these fail, either a field
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
  } as unknown as ClothingItem);

describe('slimForWorkflowState (Supabase workflow_state blob)', () => {
  it('preserves exactly the fields that cannot be recovered from the DB', () => {
    const [slim] = slimForWorkflowState([fullItem()]);
    expect(slim).toEqual({
      id: 'item-1',
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
      brandCategory: undefined,
      descriptionEdited: true,
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
