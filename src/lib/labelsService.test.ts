import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('./supabase', async () => {
  const { createSupabaseMock } = await import('./testing/supabaseMock');
  return { supabase: createSupabaseMock() };
});

import { supabase } from './supabase';
import {
  LABEL_COLORS, labelSwatch, sortLabels,
  fetchLabels, fetchLabelsForProducts, createLabel, updateLabel,
  assignLabel, unassignLabel, ensureSkus, findProductBySku,
  type ListingLabel,
} from './labelsService';
import { isGeneratedSku } from './barcode';
import type { MockedSupabaseClient } from './testing/supabaseMock';

const mock = (supabase as unknown as MockedSupabaseClient).__mock;

const label = (o: Partial<ListingLabel> & { id: string; name: string }): ListingLabel =>
  ({ color: 'slate', kind: 'custom', sort_order: 0, ...o });

beforeEach(() => mock.reset());

describe('LABEL_COLORS + labelSwatch', () => {
  it('every palette entry is a real hex pair with a unique name', () => {
    expect(new Set(LABEL_COLORS.map(c => c.name)).size).toBe(LABEL_COLORS.length);
    for (const c of LABEL_COLORS) {
      expect(c.bg).toMatch(/^#[0-9a-f]{6}$/i);
      expect(c.fg).toMatch(/^#[0-9a-f]{6}$/i);
      // The DB CHECK is `^[a-z]{3,16}$` — every name we offer must satisfy it,
      // or the picker would offer a colour that cannot be saved.
      expect(c.name).toMatch(/^[a-z]{3,16}$/);
    }
  });

  it('an unknown or missing colour renders neutral instead of breaking the row', () => {
    const neutral = { bg: LABEL_COLORS[0].bg, fg: LABEL_COLORS[0].fg };
    expect(labelSwatch('chartreuse')).toEqual(neutral);
    expect(labelSwatch(null)).toEqual(neutral);
    expect(labelSwatch(undefined)).toEqual(neutral);
    expect(labelSwatch('amber')).toEqual({ bg: '#fdefc4', fg: '#6b4a00' });
  });
});

describe('sortLabels', () => {
  it('puts vendors first, then sort_order, then name', () => {
    const out = sortLabels([
      label({ id: '1', name: 'zebra', sort_order: 5 }),
      label({ id: '2', name: 'Goodwill', kind: 'vendor', sort_order: 9 }),
      label({ id: '3', name: 'alpha', sort_order: 5 }),
      label({ id: '4', name: 'Aardvark Supply', kind: 'vendor', sort_order: 1 }),
      label({ id: '5', name: 'beta', sort_order: 1 }),
    ]);
    expect(out.map(l => l.name)).toEqual(['Aardvark Supply', 'Goodwill', 'beta', 'alpha', 'zebra']);
  });

  it('is stable and non-mutating', () => {
    const input = [label({ id: 'b', name: 'b' }), label({ id: 'a', name: 'a' })];
    const copy = [...input];
    sortLabels(input);
    expect(input).toEqual(copy);
  });
});

describe('fetchLabels', () => {
  it('reports unavailable when the migration has not been run', async () => {
    mock.responder = () => ({ data: null, error: { code: '42P01', message: 'relation does not exist' } });
    expect(await fetchLabels()).toEqual({ status: 'unavailable' });
  });

  it('returns labels in picker order', async () => {
    mock.responder = () => ({
      data: [label({ id: '1', name: 'drop 2' }), label({ id: '2', name: 'Goodwill', kind: 'vendor' })],
      error: null,
    });
    const res = await fetchLabels();
    expect(res.status).toBe('ok');
    if (res.status === 'ok') expect(res.labels.map(l => l.name)).toEqual(['Goodwill', 'drop 2']);
  });
});

describe('createLabel', () => {
  it('never sends org_id — the column default owns it', async () => {
    mock.responder = () => ({ data: label({ id: 'x', name: 'Bad Kids Club' }), error: null });
    await createLabel('Bad Kids Club', 'amber', 'custom');
    const [call] = mock.callsFor('listing_labels', 'insert');
    expect(Object.keys(call.payload as object)).toEqual(['name', 'color', 'kind']);
    expect(call.payload).not.toHaveProperty('org_id');
  });

  it('trims, caps at 40 characters, and rejects an empty name without a request', async () => {
    mock.responder = () => ({ data: label({ id: 'x', name: 'n' }), error: null });
    await createLabel(`  ${'n'.repeat(60)}  `, 'amber', 'vendor');
    expect((mock.callsFor('listing_labels', 'insert')[0].payload as { name: string }).name)
      .toHaveLength(40);

    mock.reset();
    expect(await createLabel('   ', 'amber', 'custom')).toEqual({ ok: false, error: 'Give the label a name.' });
    expect(mock.calls).toHaveLength(0);
  });

  it('falls back to the neutral colour rather than storing an unknown one', async () => {
    mock.responder = () => ({ data: label({ id: 'x', name: 'n' }), error: null });
    await createLabel('n', 'chartreuse', 'custom');
    expect((mock.callsFor('listing_labels', 'insert')[0].payload as { color: string }).color)
      .toBe(LABEL_COLORS[0].name);
  });

  it('turns a duplicate-name 23505 into a sentence a human can act on', async () => {
    mock.responder = () => ({ data: null, error: { code: '23505', message: 'duplicate key' } });
    expect(await createLabel('Bad Kids Club', 'amber', 'custom'))
      .toEqual({ ok: false, error: '"Bad Kids Club" already exists.' });
  });
});

describe('updateLabel', () => {
  it('sends only the fields that changed, and nothing when none did', async () => {
    mock.responder = () => ({ data: [{ id: 'x' }], error: null });
    await updateLabel('x', { name: '  renamed  ' });
    expect(mock.callsFor('listing_labels', 'update')[0].payload).toEqual({ name: 'renamed' });

    mock.reset();
    expect(await updateLabel('x', {})).toEqual({ ok: true });
    expect(mock.calls).toHaveLength(0);
  });

  it('treats a 0-row update as a failure, not a silent success', async () => {
    // Exactly the PostgREST trap productService documents: a filtered UPDATE
    // that matches nothing is not an error.
    mock.responder = () => ({ data: [], error: null });
    expect(await updateLabel('x', { name: 'n' }))
      .toEqual({ ok: false, error: 'That label is not in this workspace.' });
  });
});

describe('assign / unassign', () => {
  it('assigns with ignoreDuplicates, because the composite PK already guarantees once', async () => {
    mock.responder = () => ({ data: [], error: null });
    await assignLabel(['p1', 'p2'], 'L');
    const [call] = mock.callsFor('product_labels', 'upsert');
    expect(call.payload).toEqual([
      { product_id: 'p1', label_id: 'L' },
      { product_id: 'p2', label_id: 'L' },
    ]);
    expect(call.options).toMatchObject({ onConflict: 'product_id,label_id', ignoreDuplicates: true });
  });

  it('de-duplicates ids and short-circuits an empty list', async () => {
    mock.responder = () => ({ data: [], error: null });
    await assignLabel(['p1', 'p1', '', 'p2'], 'L');
    expect((mock.callsFor('product_labels', 'upsert')[0].payload as unknown[])).toHaveLength(2);

    mock.reset();
    expect(await assignLabel([], 'L')).toEqual({ ok: true });
    expect(await unassignLabel([], 'L')).toEqual({ ok: true });
    expect(mock.calls).toHaveLength(0);
  });

  it('chunks at 100 ids so a whole batch cannot blow the PostgREST URL limit', async () => {
    mock.responder = () => ({ data: [], error: null });
    const ids = Array.from({ length: 250 }, (_, i) => `p${i}`);
    await assignLabel(ids, 'L');
    expect(mock.callsFor('product_labels', 'upsert').map(c => (c.payload as unknown[]).length))
      .toEqual([100, 100, 50]);

    mock.reset();
    mock.responder = () => ({ data: [], error: null });
    await unassignLabel(ids, 'L');
    expect(mock.inSizes('product_labels', 'delete')).toEqual([100, 100, 50]);
  });
});

describe('fetchLabelsForProducts', () => {
  it('groups by product and sorts each list', async () => {
    mock.responder = () => ({
      data: [
        { product_id: 'p1', listing_labels: label({ id: 'a', name: 'drop 2' }) },
        { product_id: 'p1', listing_labels: label({ id: 'b', name: 'Goodwill', kind: 'vendor' }) },
        { product_id: 'p2', listing_labels: label({ id: 'a', name: 'drop 2' }) },
      ],
      error: null,
    });
    const res = await fetchLabelsForProducts(['p1', 'p2']);
    expect(res.status).toBe('ok');
    if (res.status !== 'ok') return;
    expect(res.byProduct.p1.map(l => l.name)).toEqual(['Goodwill', 'drop 2']);
    expect(res.byProduct.p2.map(l => l.name)).toEqual(['drop 2']);
  });

  it('tolerates PostgREST returning the embedded relation as an array', async () => {
    mock.responder = () => ({
      data: [{ product_id: 'p1', listing_labels: [label({ id: 'a', name: 'x' })] }],
      error: null,
    });
    const res = await fetchLabelsForProducts(['p1']);
    if (res.status !== 'ok') throw new Error('expected ok');
    expect(res.byProduct.p1).toHaveLength(1);
  });

  it('skips a row whose relation came back null instead of crashing', async () => {
    mock.responder = () => ({ data: [{ product_id: 'p1', listing_labels: null }], error: null });
    const res = await fetchLabelsForProducts(['p1']);
    if (res.status !== 'ok') throw new Error('expected ok');
    expect(res.byProduct).toEqual({});
  });

  it('short-circuits an empty id list and reports unavailable pre-migration', async () => {
    expect(await fetchLabelsForProducts([])).toEqual({ status: 'ok', byProduct: {} });
    expect(mock.calls).toHaveLength(0);
    mock.responder = () => ({ data: null, error: { code: '42P01', message: 'no table' } });
    expect(await fetchLabelsForProducts(['p1'])).toEqual({ status: 'unavailable' });
  });
});

describe('ensureSkus', () => {
  it('never overwrites a SKU that already exists', async () => {
    mock.responder = (c) => (c.op === 'select'
      ? { data: [{ id: 'p1', sku: 'ACD-OLD111' }], error: null }
      : undefined);
    const res = await ensureSkus(['p1']);
    expect(res).toEqual({ status: 'ok', skus: { p1: 'ACD-OLD111' } });
    // The whole point: a SKU already on a printed label is not ours to change.
    expect(mock.callsFor('products', 'update')).toHaveLength(0);
  });

  it('mints a generated SKU for a listing that has none, into sku AND barcode', async () => {
    mock.responder = (c) => (c.op === 'select'
      ? { data: [{ id: 'p1', sku: null }], error: null }
      : { data: [{ id: 'p1' }], error: null });
    const res = await ensureSkus(['p1']);
    if (res.status !== 'ok') throw new Error('expected ok');
    expect(isGeneratedSku(res.skus.p1)).toBe(true);
    const payload = mock.callsFor('products', 'update')[0].payload as { sku: string; barcode: string };
    // The printed code IS the SKU — one identifier, never two to keep in step.
    expect(payload.sku).toBe(res.skus.p1);
    expect(payload.barcode).toBe(res.skus.p1);
  });

  it('retries on a unique collision instead of giving up or looping forever', async () => {
    let updates = 0;
    mock.responder = (c) => {
      if (c.op === 'select') return { data: [{ id: 'p1', sku: null }], error: null };
      updates++;
      return updates < 3
        ? { data: null, error: { code: '23505', message: 'duplicate key' } }
        : { data: [{ id: 'p1' }], error: null };
    };
    const res = await ensureSkus(['p1']);
    expect(res.status).toBe('ok');
    expect(updates).toBe(3);
  });

  it('gives up with an error after the retry budget rather than spinning', async () => {
    mock.responder = (c) => (c.op === 'select'
      ? { data: [{ id: 'p1', sku: null }], error: null }
      : { data: null, error: { code: '23505', message: 'duplicate key' } });
    const res = await ensureSkus(['p1']);
    expect(res.status).toBe('error');
  });

  it('treats a 0-row update as "not in this workspace"', async () => {
    mock.responder = (c) => (c.op === 'select'
      ? { data: [{ id: 'p1', sku: null }], error: null }
      : { data: [], error: null });
    expect(await ensureSkus(['p1'])).toEqual({
      status: 'error', error: 'That listing is not in this workspace.',
    });
  });

  it('reports unavailable pre-migration and short-circuits an empty list', async () => {
    mock.responder = () => ({ data: null, error: { code: '42703', message: 'no column' } });
    expect(await ensureSkus(['p1'])).toEqual({ status: 'unavailable' });
    mock.reset();
    expect(await ensureSkus([])).toEqual({ status: 'ok', skus: {} });
    expect(mock.calls).toHaveLength(0);
  });

  it('chunks the existence read at 100 ids', async () => {
    mock.responder = () => ({ data: [], error: null });
    await ensureSkus(Array.from({ length: 150 }, (_, i) => `p${i}`));
    expect(mock.inSizes('products', 'select')).toEqual([100, 50]);
  });
});

describe('findProductBySku', () => {
  const row = {
    id: 'p1', sku: 'ACD-7H2K9M', seo_title: 'Vintage Tee', title: null,
    price: 45, size: 'XL', batch_id: 'b1',
    product_images: [
      { storage_path: 'u/p1/second.jpg', position: 1 },
      { storage_path: 'u/p1/first.jpg', position: 0 },
    ],
  };

  it('finds a listing and takes the position-0 image as the thumbnail', async () => {
    mock.responder = (c) => (c.table === 'products' ? { data: [row], error: null } : { data: [], error: null });
    const res = await findProductBySku('  acd-7h2k9m \n');
    expect(res.status).toBe('found');
    if (res.status !== 'found') return;
    expect(res.product.id).toBe('p1');
    expect(res.product.storage_path).toBe('u/p1/first.jpg');
    // RLS scopes the search — the query must NOT add its own org filter.
    const call = mock.callsFor('products', 'select')[0];
    expect(call.filters.map(f => f.column)).toEqual(['sku']);
    expect(call.filters[0].value).toBe('ACD-7H2K9M');
  });

  it('tries the confusable fold as a SECOND query when the exact spelling misses', async () => {
    const tried: unknown[] = [];
    mock.responder = (c) => {
      if (c.table !== 'products') return { data: [], error: null };
      const sku = c.filters.find(f => f.column === 'sku')?.value;
      tried.push(sku);
      return sku === 'ACD-7H1K90' ? { data: [row], error: null } : { data: [], error: null };
    };
    const res = await findProductBySku('acd-7hIk9O');
    expect(tried).toEqual(['ACD-7HIK9O', 'ACD-7H1K90']);
    expect(res.status).toBe('found');
  });

  it('reports what it tried when nothing matches', async () => {
    mock.responder = () => ({ data: [], error: null });
    expect(await findProductBySku('acd-7hIk9O')).toEqual({
      status: 'not_found', tried: ['ACD-7HIK9O', 'ACD-7H1K90'],
    });
  });

  it('does not query at all for empty input', async () => {
    expect(await findProductBySku('   ')).toEqual({ status: 'not_found', tried: [] });
    expect(mock.calls).toHaveLength(0);
  });

  it('reports unavailable pre-migration', async () => {
    mock.responder = () => ({ data: null, error: { code: '42703', message: 'no column' } });
    expect(await findProductBySku('ACD-7H2K9M')).toEqual({ status: 'unavailable' });
  });
});
