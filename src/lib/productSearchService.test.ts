import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('./supabase', async () => {
  const { createSupabaseMock } = await import('./testing/supabaseMock');
  return { supabase: createSupabaseMock() };
});

vi.mock('./workflowBatchService', () => ({
  fetchWorkflowBatchesMeta: vi.fn(),
}));

import { supabase } from './supabase';
import { fetchWorkflowBatchesMeta } from './workflowBatchService';
import {
  escapeIlikeTerm, buildSearchFilter, groupRowsIntoListings, searchProducts,
  fetchListing, fetchBatchNames, clearBatchNameCache, batchLabel,
  SEARCH_MATCH_COLUMNS, SEARCH_ROW_LIMIT,
  type ProductSearchRow,
} from './productSearchService';
import type { MockedSupabaseClient } from './testing/supabaseMock';

const mock = (supabase as unknown as MockedSupabaseClient).__mock;

const row = (o: Partial<ProductSearchRow> & { id: string }): ProductSearchRow => ({
  product_group: null, batch_id: null, title: null, seo_title: null, vendor: null,
  product_category: null, product_type: null, size: null, color: null, price: null,
  condition: null, sku: null, barcode: null, updated_at: null, created_at: null,
  product_images: [], ...o,
});

beforeEach(() => {
  mock.reset();
  clearBatchNameCache();
  vi.mocked(fetchWorkflowBatchesMeta).mockReset();
});

// ── escaping ────────────────────────────────────────────────────────────────

describe('escapeIlikeTerm', () => {
  it('leaves ordinary search text alone', () => {
    expect(escapeIlikeTerm('carhartt detroit')).toBe('carhartt detroit');
    expect(escapeIlikeTerm('  ACD-7H2K9M  ')).toBe('ACD-7H2K9M');
  });

  it('escapes the two characters that can break out of a quoted value', () => {
    // A raw `"` would close the PostgREST quote-string and let everything after
    // it be read as more filter grammar — this is the injection the quoting exists
    // to stop, so the escape must survive verbatim.
    expect(escapeIlikeTerm('say "hi"')).toBe('say \\"hi\\"');
    expect(escapeIlikeTerm('back\\slash')).toBe('back\\\\slash');
    // Backslashes added by the escape are not themselves re-escaped.
    expect(escapeIlikeTerm('a"b')).toBe('a\\"b');
  });

  it('keeps the or()-grammar characters, because quoting already neutralises them', () => {
    // `,` `.` `(` `)` `:` all have meaning in or=(...) and all are literal inside
    // a quoted value — stripping them would stop "Levi's 501, 32x34" matching the
    // title it names.
    const out = escapeIlikeTerm("Levi's 501, 32x34 (deadstock): tagged");
    expect(out).toBe("Levi's 501, 32x34 (deadstock): tagged");
  });

  it('drops the wildcards that would match every row', () => {
    expect(escapeIlikeTerm('*')).toBe('');
    expect(escapeIlikeTerm('%')).toBe('');
    expect(escapeIlikeTerm('ni*ke%')).toBe('nike');
  });

  it('keeps underscore — it matches any single character INCLUDING itself', () => {
    expect(escapeIlikeTerm('DSC_0192')).toBe('DSC_0192');
  });
});

describe('buildSearchFilter', () => {
  it('covers every documented column, quoted and wildcarded on both sides', () => {
    const filter = buildSearchFilter('nike');
    for (const col of SEARCH_MATCH_COLUMNS) {
      expect(filter).toContain(`${col}.ilike."*nike*"`);
    }
    expect(filter.split(',').length).toBe(SEARCH_MATCH_COLUMNS.length);
  });

  it('an injected comma cannot add a filter of its own', () => {
    const filter = buildSearchFilter('x,id.eq.00000000-0000-0000-0000-000000000000');
    // The comma is INSIDE the quoted value on every clause, so splitting on the
    // grammar's separator still yields exactly one clause per column.
    expect(filter).toContain('title.ilike."*x,id.eq.00000000-0000-0000-0000-000000000000*"');
    expect(filter.match(/ilike/g)?.length).toBe(SEARCH_MATCH_COLUMNS.length);
  });
});

// ── the group → listing reduction ───────────────────────────────────────────

describe('groupRowsIntoListings', () => {
  it('collapses rows sharing a product_group into one listing', () => {
    const out = groupRowsIntoListings([
      row({ id: 'a', product_group: 'a' }),
      row({ id: 'b', product_group: 'a' }),
      row({ id: 'c', product_group: 'a' }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].memberIds).toEqual(['a', 'b', 'c']);
    expect(out[0].groupId).toBe('a');
  });

  it('the leader is the row whose id IS the group id, whatever order it arrives in', () => {
    const out = groupRowsIntoListings([
      row({ id: 'b', product_group: 'leader' }),
      row({ id: 'leader', product_group: 'leader' }),
      row({ id: 'c', product_group: 'leader' }),
    ]);
    expect(out[0].id).toBe('leader');
    // The leader moves to the front; the rest keep their arrival order.
    expect(out[0].memberIds).toEqual(['leader', 'b', 'c']);
  });

  it('falls back to the first row when the leader row is absent (legacy fresh-UUID group)', () => {
    const out = groupRowsIntoListings([
      row({ id: 'm1', product_group: 'ghost' }),
      row({ id: 'm2', product_group: 'ghost' }),
    ]);
    expect(out[0].id).toBe('m1');
    expect(out[0].groupId).toBe('ghost');
  });

  it('an ungrouped row is its own listing, keyed on its own id', () => {
    const out = groupRowsIntoListings([row({ id: 'solo' }), row({ id: 'solo2', product_group: '' })]);
    expect(out.map(l => l.groupId)).toEqual(['solo', 'solo2']);
  });

  it('preserves the order the rows arrived in (updated_at desc from the query)', () => {
    const out = groupRowsIntoListings([
      row({ id: 'z', product_group: 'z' }),
      row({ id: 'a', product_group: 'a' }),
      row({ id: 'z2', product_group: 'z' }),
    ]);
    expect(out.map(l => l.groupId)).toEqual(['z', 'a']);
  });

  it('coalesces every field leader-first, so a blank leader still shows the listing', () => {
    const out = groupRowsIntoListings([
      row({ id: 'lead', product_group: 'lead', seo_title: '', vendor: null, price: null }),
      row({ id: 'm', product_group: 'lead', seo_title: 'Carhartt Detroit', vendor: 'Carhartt', size: 'L', price: 145, condition: 'Good' }),
    ]);
    expect(out[0]).toMatchObject({
      title: 'Carhartt Detroit', brand: 'Carhartt', size: 'L', price: 145, condition: 'Good',
    });
  });

  it('prefers seo_title, falling back to title', () => {
    expect(groupRowsIntoListings([row({ id: '1', seo_title: 'SEO', title: 'Plain' })])[0].title).toBe('SEO');
    expect(groupRowsIntoListings([row({ id: '2', title: 'Plain' })])[0].title).toBe('Plain');
  });

  it('a $0 or missing price becomes null, never 0', () => {
    // 0 is what the export gate treats as "unpriced" (§10) — a listing must not
    // report a price it does not have.
    expect(groupRowsIntoListings([row({ id: '1', price: 0 })])[0].price).toBeNull();
    expect(groupRowsIntoListings([row({ id: '2' })])[0].price).toBeNull();
    expect(groupRowsIntoListings([row({ id: '3', price: '45.50' })])[0].price).toBe(45.5);
  });

  it('photos are position-ordered within a member and leader-first across the group', () => {
    const out = groupRowsIntoListings([
      row({ id: 'm', product_group: 'lead', product_images: [{ storage_path: 'm/1.jpg', position: 0 }] }),
      row({
        id: 'lead', product_group: 'lead',
        product_images: [
          { storage_path: 'lead/2.jpg', position: 1 },
          { storage_path: 'lead/0.jpg', position: 0 },
        ],
      }),
    ]);
    expect(out[0].photos).toEqual([
      'https://cdn.test/lead/0.jpg',
      'https://cdn.test/lead/2.jpg',
      'https://cdn.test/m/1.jpg',
    ]);
  });

  it('de-duplicates a photo that appears on two rows, and falls back to image_url', () => {
    const out = groupRowsIntoListings([
      row({ id: 'a', product_group: 'a', product_images: [{ storage_path: 'p.jpg', position: 0 }] }),
      row({ id: 'b', product_group: 'a', product_images: [{ storage_path: 'p.jpg', position: 0 }] }),
      row({ id: 'c', product_group: 'a', product_images: [{ image_url: 'https://legacy/x.jpg', position: 0 }] }),
    ]);
    expect(out[0].photos).toEqual(['https://cdn.test/p.jpg', 'https://legacy/x.jpg']);
  });

  it('ignores rows with no id rather than minting a listing keyed on undefined', () => {
    expect(groupRowsIntoListings([{ id: '' } as ProductSearchRow, row({ id: 'real' })]))
      .toHaveLength(1);
  });
});

// ── searchProducts ──────────────────────────────────────────────────────────

describe('searchProducts', () => {
  it('reads products once, projected and limited — never select(*)', async () => {
    mock.responder = () => ({ data: [row({ id: 'a' })], error: null });
    const res = await searchProducts('nike');
    expect(res.status).toBe('ok');
    const calls = mock.callsFor('products', 'select');
    expect(calls).toHaveLength(1);
    expect(calls[0].columns).not.toContain('*,');
    expect(calls[0].columns).toContain('product_images(');
    expect(calls[0].limit).toBe(SEARCH_ROW_LIMIT);
  });

  it('sends ONE or() filter carrying every match column', async () => {
    mock.responder = () => ({ data: [], error: null });
    await searchProducts('carhartt');
    const ors = mock.callsFor('products', 'select')[0].filters.filter(f => f.kind === 'or');
    expect(ors).toHaveLength(1);
    expect(ors[0].value).toBe(buildSearchFilter('carhartt'));
  });

  it('an empty query sends no filter at all — the most recent rows, not an error', async () => {
    mock.responder = () => ({ data: [row({ id: 'a' })], error: null });
    const res = await searchProducts('   ');
    expect(res.status).toBe('ok');
    expect(mock.callsFor('products', 'select')[0].filters).toEqual([]);
  });

  it('never filters by user_id or org_id — RLS scopes the read (§18 #1)', async () => {
    mock.responder = () => ({ data: [], error: null });
    await searchProducts('x');
    const cols = mock.callsFor('products', 'select')[0].filters.map(f => f.column);
    expect(cols).not.toContain('user_id');
    expect(cols).not.toContain('org_id');
  });

  it('reports truncation when the row cap was reached', async () => {
    const rows = Array.from({ length: 5 }, (_, i) => row({ id: `p${i}` }));
    mock.responder = () => ({ data: rows, error: null });
    const res = await searchProducts('x', { limit: 5 });
    expect(res).toMatchObject({ status: 'ok', rowCount: 5, truncated: true });
    const res2 = await searchProducts('x', { limit: 6 });
    expect(res2).toMatchObject({ truncated: false });
  });

  it('surfaces a query error instead of pretending there are no matches', async () => {
    mock.responder = () => ({ data: null, error: { code: '42501', message: 'permission denied' } });
    expect(await searchProducts('x')).toEqual({ status: 'error', error: 'permission denied' });
  });
});

// ── fetchListing ────────────────────────────────────────────────────────────

describe('fetchListing', () => {
  it('resolves the group from any member and returns the whole listing', async () => {
    const seed = row({ id: 'member', product_group: 'lead' });
    const group = [
      row({ id: 'lead', product_group: 'lead', seo_title: 'Jacket', sku: 'ACD-AAAAAA' }),
      seed,
    ];
    let call = 0;
    mock.responder = () => ({ data: call++ === 0 ? [seed] : group, error: null });
    const res = await fetchListing('member');
    expect(res.status).toBe('ok');
    if (res.status !== 'ok') return;
    expect(res.listing.id).toBe('lead');
    expect(res.listing.memberIds).toEqual(['lead', 'member']);
    expect(res.listing.sku).toBe('ACD-AAAAAA');
    // Second read is the group read, addressed by or() on both spellings.
    const ors = mock.callsFor('products', 'select')[1].filters.filter(f => f.kind === 'or');
    expect(ors[0].value).toBe('id.eq."lead",product_group.eq."lead"');
  });

  it('reports not_found for an id nothing comes back for', async () => {
    mock.responder = () => ({ data: [], error: null });
    expect(await fetchListing('gone')).toEqual({ status: 'not_found' });
    expect(await fetchListing('   ')).toEqual({ status: 'not_found' });
  });

  it('falls back to the seed row when the group read comes back empty', async () => {
    const seed = row({ id: 'solo', seo_title: 'Only photo' });
    let call = 0;
    mock.responder = () => ({ data: call++ === 0 ? [seed] : [], error: null });
    const res = await fetchListing('solo');
    expect(res.status).toBe('ok');
    if (res.status === 'ok') expect(res.listing.title).toBe('Only photo');
  });
});

// ── batch names ─────────────────────────────────────────────────────────────

describe('batch names', () => {
  it('prefers the name, then the number, then the date — and never shows "null"', () => {
    expect(batchLabel({ batch_name: 'Spring drop' })).toBe('Spring drop');
    expect(batchLabel({ batch_name: 'null', batch_number: 'batch-17' })).toBe('batch-17');
    expect(batchLabel({ batch_number: 'batch-17' })).toBe('batch-17');
    expect(batchLabel({})).toBe('Untitled batch');
  });

  it('reads workflow_batches ONCE however many callers ask', async () => {
    vi.mocked(fetchWorkflowBatchesMeta).mockResolvedValue([
      { id: 'b1', batch_name: 'Spring drop' },
    ] as unknown as Awaited<ReturnType<typeof fetchWorkflowBatchesMeta>>);
    const [a, b] = await Promise.all([fetchBatchNames(), fetchBatchNames()]);
    expect(a.get('b1')).toBe('Spring drop');
    expect(b.get('b1')).toBe('Spring drop');
    expect(fetchWorkflowBatchesMeta).toHaveBeenCalledTimes(1);
  });

  it('a failed read degrades to no names rather than rejecting the view', async () => {
    vi.mocked(fetchWorkflowBatchesMeta).mockRejectedValue(new Error('offline'));
    expect((await fetchBatchNames()).size).toBe(0);
  });
});
