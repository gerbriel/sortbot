import { describe, it, expect } from 'vitest';
import { deriveLibraryData, cleanTitle, type SavedProductRow, type SavedImageRow } from './libraryData';
import type { WorkflowBatch } from './workflowBatchService';

/**
 * Characterization tests for the Library's data derivation — the two-pass
 * imageList build and its dedup/gap-fill rules were each a production bug
 * once (commits 69dd319, 8643c5d, dbd5d43). These lock them in.
 */

const CDN = 'http://localhost:54321/storage/v1/object/public/product-images';

const batch = (o: Partial<WorkflowBatch> & { id: string }): WorkflowBatch =>
  ({
    user_id: 'u1',
    batch_number: `bn-${o.id}`,
    current_step: 2,
    is_completed: false,
    total_images: 0,
    product_groups_count: 0,
    categorized_count: 0,
    processed_count: 0,
    saved_products_count: 0,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...o,
  } as WorkflowBatch);

const dbProduct = (o: Partial<SavedProductRow> & { id: string }): SavedProductRow =>
  ({ created_at: '2026-01-01T00:00:00Z', ...o });

const dbImage = (o: Partial<SavedImageRow> & { id: string }): SavedImageRow =>
  ({ created_at: '2026-01-01T00:00:00Z', ...o });

describe('deriveLibraryData — imageList two-pass build', () => {
  it('Pass 1: reconstructs CDN URLs from storagePath for slim items', () => {
    const { images } = deriveLibraryData(
      [batch({
        id: 'b1',
        workflow_state: { processedItems: [{ id: 'i1', storagePath: 'u/p/img.jpg' }] },
      })],
      [], [],
    );
    expect(images).toHaveLength(1);
    expect(images[0].preview).toBe(`${CDN}/u/p/img.jpg`);
    expect(images[0].batchId).toBe('b1');
    expect(images[0].isSaved).toBe(false);
  });

  it('Pass 2: skips DB rows whose product is already in workflow_state — even under a DIFFERENT batch_id (8643c5d)', () => {
    const { images } = deriveLibraryData(
      [batch({ id: 'b1', workflow_state: { processedItems: [{ id: 'p1', storagePath: 'u/p1/a.jpg' }] } })],
      [],
      [dbImage({
        id: 'img-row-1',
        image_url: 'https://cdn/x.jpg',
        // DB row claims a different (old/deleted) batch — must still dedup by product id
        products: { id: 'p1', batch_id: 'OLD-BATCH', product_group: 'p1' },
      })],
    );
    expect(images).toHaveLength(1); // only the Pass-1 item — no double count
    expect(images[0].id).toBe('p1');
  });

  it('Pass 2: gap-fills DB images missing from a partial workflow_state (69dd319)', () => {
    const { images } = deriveLibraryData(
      [batch({ id: 'b1', workflow_state: { processedItems: [{ id: 'p1', storagePath: 'u/p1/a.jpg' }] } })],
      [],
      [dbImage({
        id: 'img-row-2',
        image_url: 'https://cdn/loose.jpg',
        products: { id: 'p2', batch_id: 'b1', product_group: 'p2' }, // absent from workflow_state
      })],
    );
    expect(images).toHaveLength(2);
    const loose = images.find(i => i.id === 'img-row-2');
    expect(loose?.preview).toBe('https://cdn/loose.jpg');
    expect(loose?.isSaved).toBe(true);
  });

  it('batches with NO workflow_state get all their DB images (legacy path)', () => {
    const { images } = deriveLibraryData(
      [],
      [],
      [
        dbImage({ id: 'r1', image_url: 'https://cdn/1.jpg', products: { id: 'p1', batch_id: 'b9', product_group: 'p1' } }),
        dbImage({ id: 'r2', image_url: 'https://cdn/2.jpg', products: { id: 'p2', batch_id: 'b9', product_group: 'p2' } }),
      ],
    );
    expect(images).toHaveLength(2);
  });

  it('dedups Pass-2 rows by image_url', () => {
    const { images } = deriveLibraryData(
      [], [],
      [
        dbImage({ id: 'r1', image_url: 'https://cdn/same.jpg', products: { id: 'p1', batch_id: 'b1', product_group: 'p1' } }),
        dbImage({ id: 'r2', image_url: 'https://cdn/same.jpg', products: { id: 'p2', batch_id: 'b1', product_group: 'p2' } }),
      ],
    );
    expect(images).toHaveLength(1);
  });
});

describe('deriveLibraryData — batches', () => {
  it('synthesizes batch entries for batch_ids present in products but missing from workflow_batches', () => {
    const { batches } = deriveLibraryData(
      [],
      [dbProduct({ id: 'p1', batch_id: 'ghost-batch', product_group: 'p1', product_images: [{ image_url: 'https://cdn/1.jpg', position: 0 }] })],
      [],
    );
    expect(batches.map(b => b.id)).toContain('ghost-batch');
  });

  it('sorts batches newest-first by updated_at', () => {
    const { batches } = deriveLibraryData(
      [
        batch({ id: 'old', updated_at: '2026-01-01T00:00:00Z' }),
        batch({ id: 'new', updated_at: '2026-06-01T00:00:00Z' }),
      ],
      [], [],
    );
    expect(batches.map(b => b.id)).toEqual(['new', 'old']);
  });
});

describe('deriveLibraryData — product groups', () => {
  it('groups workflow items by productGroup with the leader id', () => {
    const { groups } = deriveLibraryData(
      [batch({
        id: 'b1',
        workflow_state: {
          processedItems: [
            { id: 'lead', productGroup: 'lead', storagePath: 'u/lead/1.jpg' },
            { id: 'mem', productGroup: 'lead', storagePath: 'u/mem/2.jpg' },
            { id: 'solo', storagePath: 'u/solo/3.jpg' },
          ],
        },
      })],
      [], [],
    );
    const lead = groups.find(g => g.id === 'lead');
    expect(lead?.itemCount).toBe(2);
    expect(lead?.images).toHaveLength(2);
    expect(groups.find(g => g.id === 'solo')?.itemCount).toBe(1);
  });

  it('prefers the DB (saved) version of a group over the workflow_state version', () => {
    const { groups } = deriveLibraryData(
      [batch({
        id: 'b1',
        workflow_state: { processedItems: [{ id: 'g1', productGroup: 'g1', storagePath: 'u/g1/1.jpg' }] },
      })],
      [dbProduct({
        id: 'g1', batch_id: 'b1', product_group: 'g1', title: 'Saved Title',
        product_images: [{ image_url: 'https://cdn/1.jpg', position: 0 }],
      })],
      [],
    );
    const g = groups.find(x => x.id === 'g1');
    expect(groups.filter(x => x.id === 'g1')).toHaveLength(1); // merged, not duplicated
    expect(g?.isSaved).toBe(true);
    expect(g?.title).toBe('Saved Title');
  });

  it('skips empty UNASSIGNED products (no images, no batch) — RLS-orphaned rows', () => {
    const { groups } = deriveLibraryData(
      [],
      [dbProduct({ id: 'orphan', batch_id: null, product_group: 'orphan', product_images: [] })],
      [],
    );
    expect(groups.find(g => g.id === 'orphan')).toBeUndefined();
  });

  it('keeps unassigned products that still HAVE images (deletable from the Unassigned section)', () => {
    const { groups } = deriveLibraryData(
      [],
      [dbProduct({ id: 'un1', batch_id: null, product_group: 'un1', product_images: [{ image_url: 'https://cdn/u.jpg', position: 0 }] })],
      [],
    );
    const g = groups.find(x => x.id === 'un1');
    expect(g).toBeDefined();
    expect(g?.batchId).toBeUndefined();
  });
});

describe('cleanTitle', () => {
  it('strips unresolved {tokens} and tidies separators', () => {
    expect(cleanTitle('{brand} {model} Hat - Vintage')).toBe('Hat - Vintage');
    expect(cleanTitle('  - Nike Tee - ')).toBe('Nike Tee');
    expect(cleanTitle('')).toBe('Untitled Product');
    expect(cleanTitle(undefined)).toBe('Untitled Product');
  });
});
