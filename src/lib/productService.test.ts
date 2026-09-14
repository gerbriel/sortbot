import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { ClothingItem } from '../App';

vi.mock('./supabase', async () => {
  const { createSupabaseMock } = await import('./testing/supabaseMock');
  return { supabase: createSupabaseMock() };
});

import { supabase } from './supabase';
import {
  buildProductPatch,
  updateProduct,
  syncGroupFieldsToDatabase,
  flushProductPatchKeepalive,
  saveProductToDatabase,
  saveBatchToDatabase,
  fetchUserProducts,
  deleteProduct,
} from './productService';
import { __resetStage4ProbeForTests } from './imageRowSync';
import type { MockedSupabaseClient, MockCall } from './testing/supabaseMock';

const mock = (supabase as unknown as MockedSupabaseClient).__mock;
const item = (o: Partial<ClothingItem> & { id: string }): ClothingItem => o as unknown as ClothingItem;

/**
 * The Step-3 save path. These lock the two defects that made edits disappear:
 *   - a PostgREST UPDATE matching 0 rows is NOT an error, so the old code
 *     reported success for a write that never happened (and workflow_state is
 *     slim, so nothing else held the text);
 *   - the write went to processedItems[0] while the restore reads the group
 *     LEADER row, so as soon as those diverged the work became unreachable.
 */
describe('updateProduct — 0 rows is a failure, not a success', () => {
  beforeEach(() => {
    mock.reset();
    __resetStage4ProbeForTests();
    // Stage 4 probe: pretend the migration has not run (the safe default).
    mock.responder = (c) => (c.table === 'product_images' && c.op === 'select'
      ? { data: null, error: { code: '42703', message: 'column does not exist' } }
      : undefined);
  });

  it('returns true when the UPDATE touches a row', async () => {
    mock.responder = (c) => {
      if (c.table === 'products' && c.op === 'update') return { data: [{ id: 'p1' }], error: null };
      return undefined;
    };
    expect(await updateProduct('p1', { price: 42 })).toBe(true);
    expect(mock.callsFor('products', 'upsert')).toHaveLength(0);
  });

  it('reports FAILURE when the UPDATE matches no row and there is no userId to recover with', async () => {
    mock.responder = (c) => {
      if (c.table === 'products' && c.op === 'update') return { data: [], error: null };
      return undefined;
    };
    expect(await updateProduct('missing-id', { price: 42 })).toBe(false);
  });

  it('recovers a missing row by upserting it when a userId is available', async () => {
    mock.responder = (c) => {
      if (c.table === 'products' && c.op === 'update') return { data: [], error: null };
      if (c.table === 'products' && c.op === 'upsert') return { data: [{ id: 'p1' }], error: null };
      return undefined;
    };
    expect(await updateProduct('p1', { price: 42 }, 'u1')).toBe(true);
    const up = mock.callsFor('products', 'upsert');
    expect(up).toHaveLength(1);
    const payload = up[0].payload as Record<string, unknown>;
    expect(payload.id).toBe('p1');
    expect(payload.user_id).toBe('u1');
    // AGENTS.md §18 #3 — a products write from this path must never carry batch_id.
    expect(payload).not.toHaveProperty('batch_id');
  });

  it('reports failure when the recovery upsert is itself blocked', async () => {
    mock.responder = (c) => {
      if (c.table === 'products' && c.op === 'update') return { data: [], error: null };
      if (c.table === 'products' && c.op === 'upsert') return { data: null, error: { message: 'rls' } };
      return undefined;
    };
    expect(await updateProduct('p1', { price: 42 }, 'u1')).toBe(false);
  });

  it('short-circuits an empty patch without touching the DB', async () => {
    expect(await updateProduct('p1', {})).toBe(true);
    expect(mock.callsFor('products', 'update')).toHaveLength(0);
  });
});

describe('syncGroupFieldsToDatabase — writes the key the restore path reads', () => {
  beforeEach(() => {
    mock.reset();
    __resetStage4ProbeForTests();
    mock.responder = (c) => {
      if (c.table === 'product_images' && c.op === 'select') {
        return { data: null, error: { code: '42703', message: 'column does not exist' } };
      }
      if (c.table === 'products' && c.op === 'update') {
        return { data: [{ id: 'touched' }], error: null };
      }
      return undefined;
    };
  });

  const updatedIds = (): unknown[] =>
    mock.callsFor('products', 'update').flatMap((c: MockCall) =>
      c.filters.filter(f => f.kind === 'eq' && f.column === 'id').map(f => f.value));

  it('targets the LEADER row even when it is not first in the group array', async () => {
    const leader = item({ id: 'G', productGroup: 'G', price: 40 });
    const member = item({ id: 'B', productGroup: 'G', price: 40 });
    expect(await syncGroupFieldsToDatabase([member, leader], null, 'u1')).toBe(true);
    expect(updatedIds()).toContain('G');
    expect(updatedIds()).not.toContain('B'); // B is mirrored via .in(), not .eq()
  });

  it('mirrors the same fields onto the other members in ONE extra request', async () => {
    const group = [
      item({ id: 'G', productGroup: 'G', seoTitle: 'Vintage Tee' }),
      item({ id: 'B', productGroup: 'G' }),
      item({ id: 'C', productGroup: 'G' }),
    ];
    await syncGroupFieldsToDatabase(group, null, 'u1');
    const updates = mock.callsFor('products', 'update');
    const mirror = updates.find(c => c.filters.some(f => f.kind === 'in'));
    expect(mirror).toBeDefined();
    expect(mirror!.filters.find(f => f.kind === 'in')!.value).toEqual(['B', 'C']);
    expect((mirror!.payload as Record<string, unknown>).seo_title).toBe('Vintage Tee');
    // Exactly two requests: the checked leader write + one mirror.
    expect(updates).toHaveLength(2);
  });

  it('chunks the mirror at 100 ids so a select-all-then-group cannot 414 (F14)', async () => {
    const group = [
      item({ id: 'G', productGroup: 'G', seoTitle: 'Vintage Tee' }),
      ...Array.from({ length: 249 }, (_, i) => item({ id: `m${i}`, productGroup: 'G' })),
    ];
    await syncGroupFieldsToDatabase(group, null, 'u1');
    expect(mock.inSizes('products', 'update')).toEqual([100, 100, 49]);
  });

  it('falls back to the first member for a legacy group with no leader row', async () => {
    const group = [
      item({ id: 'A', productGroup: 'fresh-uuid-no-owner', price: 30 }),
      item({ id: 'B', productGroup: 'fresh-uuid-no-owner', price: 30 }),
    ];
    await syncGroupFieldsToDatabase(group, null, 'u1');
    expect(updatedIds()).toContain('A');
  });

  it('propagates the leader write failure instead of swallowing it', async () => {
    mock.responder = (c) => {
      if (c.table === 'product_images' && c.op === 'select') {
        return { data: null, error: { code: '42703', message: 'column does not exist' } };
      }
      if (c.table === 'products' && c.op === 'update') return { data: [], error: null };
      return undefined;
    };
    const ok = await syncGroupFieldsToDatabase([item({ id: 'G', productGroup: 'G', price: 5 })], null);
    expect(ok).toBe(false);
  });

  it('is a no-op for an empty group', async () => {
    expect(await syncGroupFieldsToDatabase([], null)).toBe(false);
    expect(mock.calls).toHaveLength(0);
  });
});

describe('buildProductPatch', () => {
  it('maps only the fields present, onto DB column names', () => {
    const patch = buildProductPatch({ seoTitle: 'Vintage Nike Tee', price: 45, brand: 'Nike' }, false);
    expect(patch).toEqual({
      title: 'Vintage Nike Tee',
      url_handle: 'vintage-nike-tee',
      seo_title: 'Vintage Nike Tee',
      price: 45,
      vendor: 'Nike',
    });
  });

  it('omits the Stage 4 column until the migration has been run', () => {
    expect(buildProductPatch({ descriptionEdited: true }, false)).toEqual({});
    expect(buildProductPatch({ descriptionEdited: true }, true)).toEqual({ description_edited: true });
  });

  it('never clears applied_preset_id with an empty string', () => {
    expect(buildProductPatch({ appliedPresetId: '' }, false)).toEqual({});
    expect(buildProductPatch({ appliedPresetId: 'abc' }, false)).toEqual({ applied_preset_id: 'abc' });
  });
});

describe('flushProductPatchKeepalive — survives page teardown', () => {
  const original = globalThis.fetch;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(() => Promise.resolve({ ok: true } as Response));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });
  afterEach(() => { globalThis.fetch = original; });

  it('PATCHes the single row with keepalive set', () => {
    expect(flushProductPatchKeepalive('p1', { price: 42 }, 'tok')).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/rest/v1/products?id=eq.p1');
    expect(init.method).toBe('PATCH');
    expect(init.keepalive).toBe(true);
    expect(JSON.parse(init.body as string)).toEqual({ price: 42 });
  });

  it('does nothing without a token or with an empty patch', () => {
    expect(flushProductPatchKeepalive('p1', { price: 42 }, null)).toBe(false);
    expect(flushProductPatchKeepalive('p1', {}, 'tok')).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});


/**
 * Save Batch (F4). The image write used to be one awaited upsert PER IMAGE inside
 * a per-group loop that is itself serial — ~1,875 serial round trips (≈150 s) for a
 * 1,500-image batch. The rows are now collected and written in one request per 100.
 *
 * These lock the things that must NOT have changed with it: the row content
 * (product_id is the group LEADER, contiguous positions, no Stage 4 columns until
 * the probe says so), the conflict target, and the failure semantics that
 * saveBatchToDatabase's success/failed tally depends on.
 */
describe('saveProductToDatabase — one product_images upsert per group, not per image (F4)', () => {
  // storagePath + preview present and no rotation/crop => no Storage round trip,
  // so these tests exercise only the DB write.
  const photo = (id: string) => item({
    id,
    productGroup: 'G',
    storagePath: `u/G/${id}.jpg`,
    preview: `https://cdn.test/u/G/${id}.jpg`,
  });

  /** stage4 probe off (the safe default) + a products upsert that echoes the id it was given. */
  const healthy = (c: MockCall) => {
    if (c.table === 'product_images' && c.op === 'select') {
      return { data: null, error: { code: '42703', message: 'column does not exist' } };
    }
    if (c.table === 'products' && c.op === 'upsert') {
      return { data: { id: (c.payload as { id: string }).id }, error: null };
    }
    return undefined;
  };

  beforeEach(() => {
    mock.reset();
    __resetStage4ProbeForTests();
    mock.responder = healthy;
  });

  it('issues ONE upsert for a four-photo group instead of one per photo', async () => {
    const group = [photo('a'), photo('G'), photo('c'), photo('d')];
    expect(await saveProductToDatabase(photo('G'), 'u1', group, 'batch-1')).toBe('G');

    const ups = mock.callsFor('product_images', 'upsert');
    expect(ups).toHaveLength(1);
    expect(ups[0].payload as unknown[]).toHaveLength(4);
    // Unchanged conflict target and ignore semantics.
    expect(ups[0].options).toEqual({ onConflict: 'product_id,image_url', ignoreDuplicates: false });
  });

  it('writes the group LEADER as product_id and positions 0..n-1, with no Stage 4 columns', async () => {
    const group = [photo('a'), photo('G'), photo('c')];
    await saveProductToDatabase(photo('G'), 'u1', group, 'batch-1');

    const rows = mock.callsFor('product_images', 'upsert')[0].payload as Array<Record<string, unknown>>;
    // Every row keys on the leader (finding 2/16) — NOT on each item's own id.
    expect(rows.map(r => r.product_id)).toEqual(['G', 'G', 'G']);
    expect(rows.map(r => r.position)).toEqual([0, 1, 2]);
    expect(rows.map(r => r.image_url)).toEqual([
      'https://cdn.test/u/G/a.jpg', 'https://cdn.test/u/G/G.jpg', 'https://cdn.test/u/G/c.jpg',
    ]);
    expect(rows.map(r => r.storage_path)).toEqual(['u/G/a.jpg', 'u/G/G.jpg', 'u/G/c.jpg']);
    expect(rows[0].user_id).toBe('u1');
    expect(rows[0].alt_text).toBe('Product - Image 1');
    expect(rows[2].alt_text).toBe('Product - Image 3');
    expect(rows[0].transforms).toBe(null);
    expect(rows[0]).not.toHaveProperty('captured_at');
    expect(rows[0]).not.toHaveProperty('original_storage_path');
  });

  it('splits a >100-photo group into ≤100-row chunks, positions continuing across them', async () => {
    const group = Array.from({ length: 250 }, (_, i) => photo(`p${i}`));
    await saveProductToDatabase(photo('G'), 'u1', group, 'batch-1');

    const ups = mock.callsFor('product_images', 'upsert');
    expect(ups.map(c => (c.payload as unknown[]).length)).toEqual([100, 100, 50]);
    const positions = ups.flatMap(c => (c.payload as Array<Record<string, unknown>>).map(r => r.position));
    expect(positions[0]).toBe(0);
    expect(positions[249]).toBe(249);
  });

  it('still returns null when the bulk upsert fails, so the group counts as failed', async () => {
    mock.responder = (c) => {
      if (c.table === 'product_images' && c.op === 'upsert') return { data: null, error: { message: 'rls' } };
      return healthy(c);
    };
    const group = [photo('G'), photo('b')];
    expect(await saveProductToDatabase(photo('G'), 'u1', group, 'batch-1')).toBe(null);
  });

  it('skips items with no url/path entirely rather than writing a blank row', async () => {
    const group = [photo('G'), item({ id: 'no-file', productGroup: 'G' })];
    await saveProductToDatabase(photo('G'), 'u1', group, 'batch-1');
    const rows = mock.callsFor('product_images', 'upsert')[0].payload as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0].position).toBe(0);
  });

  it('saveBatchToDatabase keeps its per-group accounting: 2 requests per group, no cross-group batching', async () => {
    const items = [
      item({ id: 'G1', productGroup: 'G1', storagePath: 'u/G1/a.jpg', preview: 'https://cdn.test/u/G1/a.jpg' }),
      item({ id: 'm1', productGroup: 'G1', storagePath: 'u/G1/b.jpg', preview: 'https://cdn.test/u/G1/b.jpg' }),
      item({ id: 'G2', productGroup: 'G2', storagePath: 'u/G2/a.jpg', preview: 'https://cdn.test/u/G2/a.jpg' }),
      item({ id: 'm2', productGroup: 'G2', storagePath: 'u/G2/b.jpg', preview: 'https://cdn.test/u/G2/b.jpg' }),
    ];
    expect(await saveBatchToDatabase(items, 'u1', 'batch-1')).toEqual({ success: 2, failed: 0 });
    expect(mock.callsFor('products', 'upsert')).toHaveLength(2);
    expect(mock.callsFor('product_images', 'upsert')).toHaveLength(2);
    const groups = mock.callsFor('product_images', 'upsert')
      .map(c => (c.payload as Array<Record<string, unknown>>).map(r => r.product_id));
    expect(groups).toEqual([['G1', 'G1'], ['G2', 'G2']]);
  });
});

/**
 * The other two unbounded-query sites in this module (F13 / F14). Both are only
 * reachable from SavedProducts.tsx, which is dead code, but the bug class is the
 * same one that made deleteWorkflowBatch orphan files.
 */
describe('fetchUserProducts / deleteProduct — past the 1,000-row cap', () => {
  beforeEach(() => {
    mock.reset();
    __resetStage4ProbeForTests();
  });

  it('fetchUserProducts pages until a short page comes back', async () => {
    let page = 0;
    mock.responder = (c) => {
      if (c.table === 'products' && c.op === 'select') {
        const rows = page === 0
          ? Array.from({ length: 1000 }, (_, i) => ({ id: `p${i}` }))
          : page === 1 ? [{ id: 'p1000' }, { id: 'p1001' }] : [];
        page += 1;
        return { data: rows, error: null };
      }
      return undefined;
    };
    const all = await fetchUserProducts();
    expect(all).toHaveLength(1002);
    expect(mock.callsFor('products', 'select')).toHaveLength(2);
  });

  it('fetchUserProducts returns what it read when a page errors', async () => {
    let page = 0;
    mock.responder = (c) => {
      if (c.table === 'products' && c.op === 'select') {
        const res = page === 0
          ? { data: Array.from({ length: 1000 }, (_, i) => ({ id: `p${i}` })), error: null }
          : { data: null, error: { message: 'boom' } };
        page += 1;
        return res;
      }
      return undefined;
    };
    expect(await fetchUserProducts()).toHaveLength(1000);
  });

  it('deleteProduct removes its storage paths in chunks of 100', async () => {
    mock.responder = (c) => {
      if (c.table === 'product_images' && c.op === 'select') {
        return { data: Array.from({ length: 150 }, (_, i) => ({ storage_path: `u/p/${i}.jpg` })), error: null };
      }
      return undefined;
    };
    expect(await deleteProduct('p')).toBe(true);
    expect(mock.storageRemoveCalls.map(paths => paths.length)).toEqual([100, 50]);
    expect(mock.storageRemoveCalls.flat()).toHaveLength(150);
  });
});
