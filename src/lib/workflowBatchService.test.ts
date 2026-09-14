import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('./supabase', async () => {
  const { createSupabaseMock } = await import('./testing/supabaseMock');
  return { supabase: createSupabaseMock() };
});

import { supabase } from './supabase';
import { markBatchDeleted, isBatchDeleted, deleteWorkflowBatch, fetchWorkflowBatches, removeItemsFromWorkflowBatch } from './workflowBatchService';
import type { MockedSupabaseClient, MockCall } from './testing/supabaseMock';

const mock = (supabase as unknown as MockedSupabaseClient).__mock;

/**
 * Characterization tests for the deleted-batch tombstone registry — the July
 * 2026 fix for "deleted batches keep coming back". If these break, auto-save
 * can resurrect deleted batches again.
 */

describe('deleted-batch tombstones', () => {
  it('marks a batch deleted and reports it', () => {
    const id = `tomb-${crypto.randomUUID()}`;
    expect(isBatchDeleted(id)).toBe(false);
    markBatchDeleted(id);
    expect(isBatchDeleted(id)).toBe(true);
  });

  it('treats null/undefined/unknown ids as not deleted', () => {
    expect(isBatchDeleted(null)).toBe(false);
    expect(isBatchDeleted(undefined)).toBe(false);
    expect(isBatchDeleted('never-seen-before')).toBe(false);
  });

  it('persists tombstones to localStorage under sortbot_deleted_batch_ids', () => {
    const id = `tomb-${crypto.randomUUID()}`;
    markBatchDeleted(id);
    const stored = JSON.parse(localStorage.getItem('sortbot_deleted_batch_ids') || '[]');
    expect(Array.isArray(stored)).toBe(true);
    expect(stored).toContain(id);
  });

  it('caps the persisted list at 200 entries', () => {
    for (let i = 0; i < 230; i++) markBatchDeleted(`cap-test-${i}`);
    const stored = JSON.parse(localStorage.getItem('sortbot_deleted_batch_ids') || '[]');
    expect(stored.length).toBeLessThanOrEqual(200);
    // The most recent tombstones must be the ones kept
    expect(stored).toContain('cap-test-229');
  });
});

/**
 * deleteWorkflowBatch. Two separate regressions are locked here:
 *  - the product_images lookup was UNCHUNKED, so a >~700-image batch 400'd,
 *    `imageRows` came back undefined (the error was not even destructured) and
 *    every storage file in the batch leaked into the bucket forever;
 *  - storage and products were destroyed BEFORE the authoritative
 *    workflow_batches delete was confirmed, so an RLS-blocked delete returned
 *    false to a Library whose images were already gone.
 */
describe('deleteWorkflowBatch', () => {
  const productIds = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}` }));

  /**
   * Responder for a healthy batch of `n` products, one image row each at
   * `u/<productId>/x.jpg`. Distinguishes the two different product_images reads:
   * the row lookup (`in('product_id', …)`) and filterUnreferencedStoragePaths'
   * reference count (`in('storage_path', …)`), so the ownership check is real.
   * `sharedWith` marks a path as ALSO referenced by a product outside the batch.
   */
  const healthy = (n = 1200, sharedWith?: Record<string, string>) => {
    // PostgREST answers the product id read one 1,000-row page at a time. The
    // mock's .range() is a no-op, so page number == call number here.
    let productPage = 0;
    return (c: MockCall) => {
      if (c.table === 'products' && c.op === 'select') {
        const page = productIds(n).slice(productPage * 1000, productPage * 1000 + 1000);
        productPage += 1;
        return { data: page, error: null };
      }
      if (c.table === 'product_images' && c.op === 'select') {
        const f = c.filters.find(x => x.kind === 'in');
        const vals = (f?.value ?? []) as string[];
        if (f?.column === 'storage_path') {
          return {
            data: vals.map(path => ({
              storage_path: path,
              product_id: sharedWith?.[path] ?? path.split('/')[1],
            })),
            error: null,
          };
        }
        return { data: vals.map(id => ({ id: `img-${id}`, storage_path: `u/${id}/x.jpg`, product_id: id })), error: null };
      }
      if (c.table === 'workflow_batches' && c.op === 'select') return { data: { workflow_state: null }, error: null };
      if (c.table === 'workflow_batches' && c.op === 'update') return { data: [{ id: 'b1' }], error: null };
      if (c.table === 'workflow_batches' && c.op === 'delete') return { data: [{ id: 'b1' }], error: null };
      return undefined;
    };
  };

  /** The `.in()` values recorded for a table/op/column — which ids actually reached it. */
  const inValues = (table: string, op: MockCall['op'], column: string): Set<string> =>
    new Set(
      mock.callsFor(table, op).flatMap(c =>
        c.filters
          .filter(f => f.kind === 'in' && f.column === column)
          .flatMap(f => f.value as string[])),
    );

  beforeEach(() => {
    mock.reset();
    localStorage.removeItem('sortbot_deleted_batch_ids');
  });

  it('chunks the product_images lookup at 100 so a big batch never 400s', async () => {
    mock.responder = healthy(1200);
    expect(await deleteWorkflowBatch('b1')).toBe(true);
    // 12 read chunks + 12 reference-count chunks (filterUnreferencedStoragePaths)
    // + 12 claim chunks + 12 delete chunks — every one of them 100 ids wide.
    expect(new Set(mock.inSizes('product_images', 'select'))).toEqual(new Set([100]));
    expect(mock.inSizes('product_images', 'select').filter(n => n === 100).length).toBeGreaterThanOrEqual(12);
    expect(new Set(mock.inSizes('product_images', 'delete'))).toEqual(new Set([100]));
  });

  it('removes the storage files it found (the leak: this used to be skipped entirely)', async () => {
    mock.responder = healthy(3);
    expect(await deleteWorkflowBatch('b1')).toBe(true);
    expect(mock.storageRemoveCalls.flat().sort()).toEqual(['u/p0/x.jpg', 'u/p1/x.jpg', 'u/p2/x.jpg']);
  });

  it('keeps a storage file another batch still references (§18 #15 guard, run BEFORE the rows go)', async () => {
    mock.responder = healthy(2, { 'u/p1/x.jpg': 'a-product-in-another-batch' });
    expect(await deleteWorkflowBatch('b1')).toBe(true);
    expect(mock.storageRemoveCalls.flat()).toEqual(['u/p0/x.jpg']);
  });

  it('deletes NOTHING when the batch row cannot be claimed (RLS)', async () => {
    mock.responder = (c) => {
      const base = healthy(3)(c);
      if (c.table === 'workflow_batches' && c.op === 'update') return { data: [], error: null };
      return base;
    };
    expect(await deleteWorkflowBatch('b1')).toBe(false);
    expect(mock.storageRemoveCalls).toHaveLength(0);
    expect(mock.callsFor('products', 'delete')).toHaveLength(0);
    expect(mock.callsFor('workflow_batches', 'delete')).toHaveLength(0);
    expect(mock.callsFor('product_images', 'delete')).toHaveLength(0);
  });

  it('deletes NOTHING when the batch-row delete affects 0 rows', async () => {
    mock.responder = (c) => {
      const base = healthy(3)(c);
      if (c.table === 'workflow_batches' && c.op === 'delete') return { data: [], error: null };
      return base;
    };
    expect(await deleteWorkflowBatch('b1')).toBe(false);
    expect(mock.storageRemoveCalls).toHaveLength(0);
    expect(mock.callsFor('products', 'delete')).toHaveLength(0);
    expect(mock.callsFor('product_images', 'delete')).toHaveLength(0);
  });

  it('confirms the batch row is gone BEFORE it destroys anything else', async () => {
    mock.responder = healthy(3);
    await deleteWorkflowBatch('b1');
    const order = mock.calls
      .map((c, i) => ({ i, key: `${c.table}.${c.op}` }))
      .filter(x => x.key.endsWith('.delete'));
    const batchDelete = order.find(x => x.key === 'workflow_batches.delete')!;
    expect(batchDelete).toBeDefined();
    for (const other of order.filter(x => x.key !== 'workflow_batches.delete')) {
      expect(other.i).toBeGreaterThan(batchDelete.i);
    }
  });

  it('leaves storage untouched when the image lookup could not be completed', async () => {
    mock.responder = (c) => {
      if (c.table === 'product_images' && c.op === 'select') return { data: null, error: { message: 'boom' } };
      return healthy(3)(c);
    };
    expect(await deleteWorkflowBatch('b1')).toBe(true);   // the DB still gets cleaned
    expect(mock.storageRemoveCalls).toHaveLength(0);      // but no guessing about files
  });

  it('refuses when there is no authenticated user', async () => {
    mock.responder = healthy(3);
    mock.authUser = null;
    expect(await deleteWorkflowBatch('b1')).toBe(false);
    expect(mock.callsFor('workflow_batches', 'delete')).toHaveLength(0);
  });

  // ── F13: the 1,000-row cap was a DATA-LOSS bug ─────────────────────────────
  // The product id read had no pagination, so a 1,500-product batch saw 1,000 ids:
  // the other 500 products kept their product_images rows AND their storage files
  // forever, and the partial deletion set also made the reference count KEEP files
  // it should have deleted.
  it('paginates the product id read past the 1,000-row cap (500 products used to be orphaned)', async () => {
    mock.responder = healthy(1200);
    expect(await deleteWorkflowBatch('b1')).toBe(true);

    // Two pages: one full 1,000 and one short 200 (the short page ends the loop).
    expect(mock.callsFor('products', 'select')).toHaveLength(2);

    // Ids from BOTH pages reach the product_images lookup…
    const looked = inValues('product_images', 'select', 'product_id');
    expect(looked.size).toBe(1200);
    expect(looked.has('p0')).toBe(true);        // page 1
    expect(looked.has('p1199')).toBe(true);     // page 2 — silently dropped before

    // …and the product_images delete.
    const deleted = inValues('product_images', 'delete', 'product_id');
    expect(deleted.size).toBe(1200);
    expect(deleted.has('p0')).toBe(true);
    expect(deleted.has('p1199')).toBe(true);

    // The products delete itself is server-side (`eq batch_id`), so it never
    // needed the id list — it is the rows hanging off those ids that leaked.
    const prodDelete = mock.callsFor('products', 'delete');
    expect(prodDelete).toHaveLength(1);
    expect(prodDelete[0].filters).toEqual([{ kind: 'eq', column: 'batch_id', value: 'b1' }]);

    // The second page's storage file is now actually removed.
    expect(mock.storageRemoveCalls.flat()).toContain('u/p1199/x.jpg');
  });

  it('stops at the pagination guard instead of spinning forever on always-full pages', async () => {
    mock.responder = (c) => {
      // A server that answers every page with a full 1,000 rows.
      if (c.table === 'products' && c.op === 'select') return { data: productIds(1000), error: null };
      if (c.table === 'product_images' && c.op === 'select') return { data: [], error: null };
      if (c.table === 'workflow_batches' && c.op === 'select') return { data: { workflow_state: null }, error: null };
      if (c.table === 'workflow_batches' && c.op === 'update') return { data: [{ id: 'b1' }], error: null };
      if (c.table === 'workflow_batches' && c.op === 'delete') return { data: [{ id: 'b1' }], error: null };
      return undefined;
    };
    expect(await deleteWorkflowBatch('b1')).toBe(true);
    expect(mock.callsFor('products', 'select')).toHaveLength(50);   // MAX_PAGES, then it stops
    // An id list we know is incomplete must not drive a storage delete.
    expect(mock.storageRemoveCalls).toHaveLength(0);
  });

  it('leaves storage untouched when the product id read fails (partial deletion set)', async () => {
    mock.responder = (c) => {
      if (c.table === 'products' && c.op === 'select') return { data: null, error: { message: 'boom' } };
      return healthy(3)(c);
    };
    expect(await deleteWorkflowBatch('b1')).toBe(true);       // the DB is still cleaned…
    expect(mock.storageRemoveCalls).toHaveLength(0);          // …but no file is guessed at
    expect(mock.callsFor('products', 'delete')).toHaveLength(1);   // by batch_id, so unaffected
  });

  // ── F14: every bulk list stays under PostgREST's URL limit ─────────────────
  it('keeps every bulk request at 100 or fewer — ids and storage paths alike', async () => {
    mock.responder = healthy(250);
    expect(await deleteWorkflowBatch('b1')).toBe(true);
    for (const op of ['select', 'update', 'delete'] as const) {
      for (const size of mock.inSizes('product_images', op)) {
        expect(size).toBeLessThanOrEqual(100);
      }
    }
    expect(mock.inSizes('product_images', 'delete')).toEqual([100, 100, 50]);
    expect(mock.inSizes('product_images', 'update')).toEqual([100, 100, 50]);
    expect(mock.storageRemoveCalls.map(paths => paths.length)).toEqual([100, 100, 50]);
  });

  it('tombstones the id on success so auto-save can never re-create it', async () => {
    mock.responder = healthy(2);
    await deleteWorkflowBatch('tombstone-me');
    expect(isBatchDeleted('tombstone-me')).toBe(true);
  });
});

/**
 * fetchWorkflowBatches used `select('*')` with no limit (architecture review
 * finding #14), so it silently stopped at PostgREST's 1000-row max-rows cap: a
 * workspace past 1000 batches simply never saw its oldest ones in the Library,
 * with no error anywhere. It now walks pages like fetchSavedProducts does.
 */
describe('fetchWorkflowBatches pagination + projection', () => {
  beforeEach(() => mock.reset());

  const page = (n: number, startId: number) =>
    Array.from({ length: n }, (_, i) => ({ id: `b${startId + i}`, workflow_state: null }));

  it('walks pages until a short one, returning every row', async () => {
    let call = 0;
    mock.responder = (c: MockCall) => {
      if (c.table !== 'workflow_batches' || c.op !== 'select') return undefined;
      call++;
      // two full pages then a partial one
      if (call === 1) return { data: page(1000, 0), error: null };
      if (call === 2) return { data: page(1000, 1000), error: null };
      return { data: page(7, 2000), error: null };
    };
    const rows = await fetchWorkflowBatches();
    expect(rows).toHaveLength(2007);
    expect(rows[0].id).toBe('b0');
    expect(rows[2006].id).toBe('b2006');
  });

  it('requests consecutive 1000-row windows', async () => {
    let call = 0;
    mock.responder = (c: MockCall) => {
      if (c.table !== 'workflow_batches' || c.op !== 'select') return undefined;
      call++;
      return { data: call === 1 ? page(1000, 0) : page(3, 1000), error: null };
    };
    await fetchWorkflowBatches();
    const ranges = mock.callsFor('workflow_batches', 'select').map(c => c.range);
    expect(ranges).toEqual([{ from: 0, to: 999 }, { from: 1000, to: 1999 }]);
  });

  it('stops after ONE request when the first page is short', async () => {
    mock.responder = (c: MockCall) =>
      c.table === 'workflow_batches' && c.op === 'select' ? { data: page(4, 0), error: null } : undefined;
    const rows = await fetchWorkflowBatches();
    expect(rows).toHaveLength(4);
    expect(mock.callsFor('workflow_batches', 'select')).toHaveLength(1);
  });

  it('projects named columns — never select(*) — and includes what every consumer reads', async () => {
    mock.responder = () => ({ data: [], error: null });
    await fetchWorkflowBatches();
    const columns = mock.callsFor('workflow_batches', 'select')[0].columns ?? '';
    expect(columns).not.toBe('*');
    // deriveLibraryData, the Library batch cards, and handleOpenBatch, respectively.
    for (const c of [
      'id', 'created_at', 'workflow_state',
      'batch_name', 'batch_number', 'current_step', 'is_completed',
      'total_images', 'product_groups_count', 'updated_at', 'last_opened_at',
    ]) {
      expect(columns.split(', ')).toContain(c);
    }
  });

  it('omits the columns nothing reads', async () => {
    mock.responder = () => ({ data: [], error: null });
    await fetchWorkflowBatches();
    const columns = (mock.callsFor('workflow_batches', 'select')[0].columns ?? '').split(', ');
    expect(columns).not.toContain('thumbnail_url');
    expect(columns).not.toContain('tags');
    expect(columns).not.toContain('notes');
  });

  it('returns [] rather than throwing when a page errors', async () => {
    mock.responder = () => ({ data: null, error: { message: 'boom' } });
    await expect(fetchWorkflowBatches()).resolves.toEqual([]);
  });
});

/**
 * removeItemsFromWorkflowBatch is a read-modify-write on the same blob App's
 * auto-save blind-UPDATEs every 2 s (architecture review finding #2). Without the
 * `updated_at` compare-and-set, the interleaving READ → App writes → WRITE
 * silently discarded everything App wrote in between.
 */
describe('removeItemsFromWorkflowBatch — compare-and-set on updated_at', () => {
  beforeEach(() => mock.reset());

  const state = (ids: string[]) => ({
    uploadedImages: [], groupedImages: [], sortedImages: [],
    processedItems: ids.map(id => ({ id })),
    lastEditedBy: 'a@b.c',
  });

  /** Responds to the read with the given updated_at, and to the update with `affected` rows. */
  const wire = (updatedAt: string, affectedPerUpdate: number[]) => {
    let updateCall = 0;
    mock.responder = (c: MockCall) => {
      if (c.table !== 'workflow_batches') return undefined;
      if (c.op === 'select') return { data: { workflow_state: state(['a', 'b', 'c']), updated_at: updatedAt }, error: null };
      if (c.op === 'update') {
        const n = affectedPerUpdate[updateCall++] ?? 0;
        return { data: Array.from({ length: n }, () => ({ id: 'batch-1' })), error: null };
      }
      return undefined;
    };
  };

  it('guards the UPDATE on the updated_at it just read', async () => {
    wire('2026-09-13T22:00:00.123456+00:00', [1]);
    await removeItemsFromWorkflowBatch('batch-1', ['b']);
    const upd = mock.callsFor('workflow_batches', 'update')[0];
    expect(upd.filters).toEqual([
      { kind: 'eq', column: 'id', value: 'batch-1' },
      { kind: 'eq', column: 'updated_at', value: '2026-09-13T22:00:00.123456+00:00' },
    ]);
    expect(upd.returning).toBe(true);   // .select('id') — needed to see 0 rows affected
  });

  it('removes only the named ids from every array and keeps the other blob keys', async () => {
    wire('t1', [1]);
    await removeItemsFromWorkflowBatch('batch-1', ['b']);
    const payload = mock.callsFor('workflow_batches', 'update')[0].payload as { workflow_state: Record<string, unknown> };
    expect(payload.workflow_state.processedItems).toEqual([{ id: 'a' }, { id: 'c' }]);
    expect(payload.workflow_state.lastEditedBy).toBe('a@b.c');
  });

  it('succeeds on the first attempt when nothing else wrote', async () => {
    wire('t1', [1]);
    await expect(removeItemsFromWorkflowBatch('batch-1', ['b'])).resolves.toBe(true);
    expect(mock.callsFor('workflow_batches', 'update')).toHaveLength(1);
    expect(mock.callsFor('workflow_batches', 'select')).toHaveLength(1);
  });

  it('re-reads and retries ONCE when the guard matches nothing', async () => {
    wire('t1', [0, 1]);   // first update loses the race, second wins
    await expect(removeItemsFromWorkflowBatch('batch-1', ['b'])).resolves.toBe(true);
    expect(mock.callsFor('workflow_batches', 'update')).toHaveLength(2);
    // The retry must RE-READ, or it would just resubmit the same stale blob.
    expect(mock.callsFor('workflow_batches', 'select')).toHaveLength(2);
  });

  it('gives up after the second miss instead of looping', async () => {
    wire('t1', [0, 0]);
    await expect(removeItemsFromWorkflowBatch('batch-1', ['b'])).resolves.toBe(false);
    expect(mock.callsFor('workflow_batches', 'update')).toHaveLength(2);
  });

  it('is a no-op with no ids or no batch id — no query at all', async () => {
    mock.responder = () => ({ data: null, error: null });
    await expect(removeItemsFromWorkflowBatch('batch-1', [])).resolves.toBe(true);
    await expect(removeItemsFromWorkflowBatch('', ['a'])).resolves.toBe(true);
    expect(mock.callsFor('workflow_batches', 'select')).toHaveLength(0);
  });

  it('does not UPDATE when the batch has no workflow_state', async () => {
    mock.responder = (c: MockCall) =>
      c.table === 'workflow_batches' && c.op === 'select'
        ? { data: { workflow_state: null, updated_at: 't1' }, error: null }
        : undefined;
    await expect(removeItemsFromWorkflowBatch('batch-1', ['b'])).resolves.toBe(true);
    expect(mock.callsFor('workflow_batches', 'update')).toHaveLength(0);
  });
});
