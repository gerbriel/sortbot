import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * The embeddings seam.
 *
 * TWO THINGS HERE HAVE NO COMPILER BEHIND THEM and are the reason this file
 * exists.
 *
 * **The RPC contract.** PostgREST resolves a function by its NAME and its
 * ARGUMENT NAMES, and renders the response from its RETURN TYPE. Rename
 * `p_product_image_id` in either half and you get a 404 at runtime with nothing in
 * the type system to catch it. `supabase/migrations/listing_embeddings.sql` spells
 * the same names in its wrapper; these tests are the other end of that pair.
 *
 * **The thresholds.** `similarityLabel` turns a cosine into a claim a seller acts
 * on ("near duplicate" means *you already listed this*). The boundaries are
 * asserted on both sides, because a `>` where a `>=` belongs is invisible in
 * review and only ever wrong on the exact value that matters.
 *
 * The rest is the pre-migration path, which is the whole reason this code can ship
 * before the SQL: a missing table and a missing function both have to read as
 * "hide the feature", never as an error a reseller sees.
 */

const rpcCalls: Array<{ fn: string; args: unknown }> = [];
let rpcResponse: { data: unknown; error: { code?: string; message: string } | null } = {
  data: [],
  error: null,
};

vi.mock('./supabase', async () => {
  const { createSupabaseMock } = await import('./testing/supabaseMock');
  const base = createSupabaseMock();
  return {
    supabase: {
      ...base,
      // The shared mock has no `rpc` (nothing else in src/ needed one that also
      // needed the chainable builder). Composed here rather than edited there:
      // this file is the only caller, and widening the shared fake for one test
      // is how a test double grows features nobody asserts.
      rpc: (fn: string, args?: unknown) => {
        rpcCalls.push({ fn, args });
        return Promise.resolve(rpcResponse);
      },
    },
  };
});

import { supabase } from './supabase';
import type { MockedSupabaseClient } from './testing/supabaseMock';
import { ID_CHUNK } from './chunk';
import {
  NEAR_DUPLICATE,
  SIMILAR,
  VERY_SIMILAR,
  __resetEmbeddingsProbeForTests,
  daysAgo,
  embeddingsAvailable,
  embeddingsKnownAvailable,
  ensureEmbeddings,
  findSimilar,
  formatCents,
  formatPrice,
  formatSoldLine,
  isNearDuplicate,
  similarityLabel,
} from './embeddingsService';

const mock = (supabase as unknown as MockedSupabaseClient).__mock;

/** A `match_listing_images` row in the database's own spelling. */
function matchRow(over: Record<string, unknown> = {}) {
  return {
    product_image_id: 'img-1',
    product_id: 'prod-1',
    product_group_id: 'group-1',
    similarity: 0.88,
    title: 'Vintage Carhartt jacket',
    price: 45,
    sold_price_cents: null,
    sold_at: null,
    ...over,
  };
}

/** A fetch stub that records every call and answers from a queue. */
function stubFetch(responses: Array<{ ok?: boolean; status?: number; body?: unknown } | Error>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  let i = 0;
  const fn = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = responses[Math.min(i++, responses.length - 1)];
    if (next instanceof Error) throw next;
    return {
      ok: next.ok !== false,
      status: next.status ?? 200,
      json: async () => next.body,
    } as unknown as Response;
  });
  vi.stubGlobal('fetch', fn);
  return calls;
}

beforeEach(() => {
  mock.reset();
  rpcCalls.length = 0;
  rpcResponse = { data: [], error: null };
  __resetEmbeddingsProbeForTests();
  vi.stubEnv('VITE_MATTING_URL', 'https://matting.test');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

// ── similarityLabel — the thresholds, on both sides ─────────────────────────

describe('similarityLabel', () => {
  it('calls the duplicate threshold INCLUSIVE, and one ten-thousandth below it is not', () => {
    expect(similarityLabel(NEAR_DUPLICATE)).toBe('near duplicate');
    expect(similarityLabel(1)).toBe('near duplicate');
    expect(similarityLabel(NEAR_DUPLICATE - 0.0001)).toBe('very similar');
  });

  it('steps down through very similar, similar and related on their exact values', () => {
    expect(similarityLabel(VERY_SIMILAR)).toBe('very similar');
    expect(similarityLabel(VERY_SIMILAR - 0.0001)).toBe('similar');
    expect(similarityLabel(SIMILAR)).toBe('similar');
    expect(similarityLabel(SIMILAR - 0.0001)).toBe('related');
    expect(similarityLabel(0)).toBe('related');
    expect(similarityLabel(-1)).toBe('related');
  });

  it('separates a re-shoot of ONE garment from two different garments — the numbers the real model produced', () => {
    // Measured, not invented (docs/pricing/02-embeddings.md): the same jacket
    // re-shot brighter and re-cropped, then two genuinely different garments in
    // the same style. The property that matters is that only the first is called
    // a duplicate — the other two are useful comps and must not read as "you
    // already listed this".
    expect(similarityLabel(0.9837)).toBe('near duplicate');
    expect(similarityLabel(0.8422)).toBe('similar');
    expect(similarityLabel(0.7697)).toBe('similar');
    expect(isNearDuplicate(0.8422)).toBe(false);
  });

  it('degrades to "related" for any non-finite number rather than throwing in a render', () => {
    expect(similarityLabel(NaN)).toBe('related');
    // Infinity is not finite, so it takes the same safe floor. A cosine cannot
    // exceed 1; if one ever does, something upstream is broken and the strip
    // should not be the thing that announces it as a certainty.
    expect(similarityLabel(Infinity)).toBe('related');
  });
});

describe('isNearDuplicate', () => {
  it('agrees with the label, exactly', () => {
    expect(isNearDuplicate(0.92)).toBe(true);
    expect(isNearDuplicate(0.9199)).toBe(false);
    expect(isNearDuplicate(NaN)).toBe(false);
  });
});

// ── money and dates ─────────────────────────────────────────────────────────

describe('formatPrice / formatCents', () => {
  it('formats a real amount to two decimals', () => {
    expect(formatPrice(45)).toBe('$45.00');
    expect(formatPrice(45.5)).toBe('$45.50');
    expect(formatCents(1800)).toBe('$18.00');
    expect(formatCents(99)).toBe('$0.99');
  });

  it('renders NOTHING for zero, negative, null or NaN — $0 is not a price', () => {
    for (const v of [0, -5, null, NaN]) {
      expect(formatPrice(v as number | null)).toBe('');
      expect(formatCents(v as number | null)).toBe('');
    }
  });
});

describe('daysAgo', () => {
  const now = Date.parse('2026-09-20T12:00:00Z');

  it('floors to whole days', () => {
    expect(daysAgo('2026-09-20T11:00:00Z', now)).toBe(0);
    expect(daysAgo('2026-09-19T11:00:00Z', now)).toBe(1);
    expect(daysAgo('2026-08-21T12:00:00Z', now)).toBe(30);
  });

  it('never returns a negative day count, so a clock skew cannot render "-0 days ago"', () => {
    expect(daysAgo('2026-09-21T12:00:00Z', now)).toBe(0);
  });

  it('is null for nothing and for anything unparseable', () => {
    expect(daysAgo(null, now)).toBeNull();
    expect(daysAgo('not a date', now)).toBeNull();
  });
});

describe('formatSoldLine', () => {
  const now = Date.parse('2026-09-20T12:00:00Z');

  it('is EMPTY when the listing never sold — which is every row before pricing_research.sql runs', () => {
    expect(formatSoldLine({ soldPriceCents: null, soldAt: null }, now)).toBe('');
    expect(formatSoldLine({ soldPriceCents: 0, soldAt: '2026-09-01T00:00:00Z' }, now)).toBe('');
  });

  it('reads as a sentence at every age', () => {
    expect(formatSoldLine({ soldPriceCents: 1800, soldAt: '2026-09-20T09:00:00Z' }, now))
      .toBe('sold $18.00 · today');
    expect(formatSoldLine({ soldPriceCents: 1800, soldAt: '2026-09-19T09:00:00Z' }, now))
      .toBe('sold $18.00 · yesterday');
    expect(formatSoldLine({ soldPriceCents: 2250, soldAt: '2026-08-21T12:00:00Z' }, now))
      .toBe('sold $22.50 · 30 days ago');
  });

  it('still names the money when the date is missing', () => {
    expect(formatSoldLine({ soldPriceCents: 1800, soldAt: null }, now)).toBe('sold $18.00');
  });
});

// ── availability ────────────────────────────────────────────────────────────

describe('embeddingsAvailable', () => {
  it('is false with no VITE_MATTING_URL, and never touches the database', async () => {
    vi.stubEnv('VITE_MATTING_URL', '');
    expect(await embeddingsAvailable()).toBe(false);
    expect(mock.calls).toEqual([]);
    expect(embeddingsKnownAvailable()).toBe(false);
  });

  it('probes the table with ONE projected row', async () => {
    expect(await embeddingsAvailable()).toBe(true);
    const call = mock.callsFor('listing_embeddings', 'select')[0];
    expect(call.columns).toBe('product_image_id');
    expect(call.limit).toBe(1);
    expect(embeddingsKnownAvailable()).toBe(true);
  });

  it('is false when the table is not there — the pre-migration case', async () => {
    mock.responder = () => ({ data: null, error: { code: '42P01', message: 'relation does not exist' } });
    expect(await embeddingsAvailable()).toBe(false);
    expect(embeddingsKnownAvailable()).toBe(false);
  });

  it('asks once per session, because every Step-3 navigation asks it', async () => {
    await embeddingsAvailable();
    await embeddingsAvailable();
    await embeddingsAvailable();
    expect(mock.callsFor('listing_embeddings', 'select')).toHaveLength(1);
  });
});

// ── findSimilar — the RPC contract ──────────────────────────────────────────

describe('findSimilar', () => {
  it('calls match_listing_images with the argument names the migration declares', async () => {
    await findSimilar('img-query', 8);
    expect(rpcCalls).toEqual([
      { fn: 'match_listing_images', args: { p_product_image_id: 'img-query', p_limit: 8 } },
    ]);
  });

  it('defaults the limit to 12, the same default the SQL function has', async () => {
    await findSimilar('img-query');
    expect((rpcCalls[0].args as { p_limit: number }).p_limit).toBe(12);
  });

  it('short-circuits an empty id without a round trip', async () => {
    expect(await findSimilar('')).toEqual({ status: 'ok', rows: [] });
    expect(rpcCalls).toEqual([]);
  });

  it('reports a missing FUNCTION as unavailable, both codes', async () => {
    for (const code of ['42883', 'PGRST202']) {
      rpcResponse = { data: null, error: { code, message: 'no function matches' } };
      expect(await findSimilar('img-1')).toEqual({ status: 'unavailable' });
    }
  });

  it('reports a missing TABLE as unavailable too — one unrun migration, one answer', async () => {
    for (const code of ['42P01', 'PGRST205']) {
      rpcResponse = { data: null, error: { code, message: 'relation does not exist' } };
      expect(await findSimilar('img-1')).toEqual({ status: 'unavailable' });
    }
  });

  it('reports any other failure as an error the caller can show', async () => {
    rpcResponse = { data: null, error: { code: '42501', message: 'permission denied' } };
    expect(await findSimilar('img-1')).toEqual({ status: 'error', error: 'permission denied' });
  });

  it('no neighbours is a SUCCESS with no rows, and makes no follow-up read', async () => {
    rpcResponse = { data: [], error: null };
    expect(await findSimilar('img-1')).toEqual({ status: 'ok', rows: [] });
    expect(mock.callsFor('product_images', 'select')).toEqual([]);
  });

  it('maps a row into what the strip renders', async () => {
    rpcResponse = {
      data: [matchRow({ similarity: 0.9837, sold_price_cents: 1800, sold_at: '2026-09-01T00:00:00Z' })],
      error: null,
    };
    mock.responder = (call) =>
      call.table === 'product_images'
        ? { data: [{ id: 'img-1', storage_path: 'u/p/a.jpg', products: { batch_id: 'batch-7' } }], error: null }
        : undefined;

    const res = await findSimilar('img-query');
    expect(res.status).toBe('ok');
    if (res.status !== 'ok') return;
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0]).toEqual({
      productImageId: 'img-1',
      productId: 'prod-1',
      productGroupId: 'group-1',
      batchId: 'batch-7',
      similarity: 0.9837,
      label: 'near duplicate',
      title: 'Vintage Carhartt jacket',
      price: 45,
      soldPriceCents: 1800,
      soldAt: '2026-09-01T00:00:00Z',
      // Built through storageUrls, never an inline getPublicUrl (§18 #20).
      thumbnailUrl: 'https://cdn.test/u/p/a.jpg',
    });
  });

  it('turns a $0 price into null — the export gate reads 0 as "unpriced"', async () => {
    rpcResponse = { data: [matchRow({ price: 0 }), matchRow({ product_image_id: 'img-2', price: '12.50' })], error: null };
    const res = await findSimilar('img-query');
    if (res.status !== 'ok') throw new Error('expected ok');
    expect(res.rows[0].price).toBeNull();
    expect(res.rows[1].price).toBe(12.5);
  });

  it('falls back to a placeholder title rather than rendering an empty card', async () => {
    rpcResponse = { data: [matchRow({ title: null }), matchRow({ product_image_id: 'img-2', title: '   ' })], error: null };
    const res = await findSimilar('img-query');
    if (res.status !== 'ok') throw new Error('expected ok');
    expect(res.rows.map((r) => r.title)).toEqual(['Untitled listing', 'Untitled listing']);
  });

  it('reads the batch id whether PostgREST embeds the product as an object or an array', async () => {
    rpcResponse = { data: [matchRow()], error: null };
    for (const embed of [{ batch_id: 'b1' }, [{ batch_id: 'b1' }]]) {
      mock.reset();
      mock.responder = (call) =>
        call.table === 'product_images'
          ? { data: [{ id: 'img-1', storage_path: 'u/p/a.jpg', products: embed }], error: null }
          : undefined;
      const res = await findSimilar('img-query');
      if (res.status !== 'ok') throw new Error('expected ok');
      expect(res.rows[0].batchId).toBe('b1');
    }
  });

  it('projects the follow-up read and filters it with in(), never selecting *', async () => {
    rpcResponse = { data: [matchRow()], error: null };
    await findSimilar('img-query');
    const call = mock.callsFor('product_images', 'select')[0];
    expect(call.columns).toBe('id, storage_path, products(batch_id)');
    expect(call.columns).not.toContain('*');
    expect(call.filters).toEqual([{ kind: 'in', column: 'id', value: ['img-1'] }]);
  });

  it('chunks the follow-up read at ID_CHUNK so a raised p_limit cannot 414', async () => {
    rpcResponse = {
      data: Array.from({ length: ID_CHUNK + 5 }, (_, i) => matchRow({ product_image_id: `img-${i}` })),
      error: null,
    };
    await findSimilar('img-query', 200);
    expect(mock.inSizes('product_images', 'select')).toEqual([ID_CHUNK, 5]);
  });

  it('still returns the rows when the follow-up read fails — a title beats nothing', async () => {
    rpcResponse = { data: [matchRow()], error: null };
    mock.responder = (call) =>
      call.table === 'product_images' ? { data: null, error: { code: '500', message: 'boom' } } : undefined;
    const res = await findSimilar('img-query');
    if (res.status !== 'ok') throw new Error('expected ok');
    expect(res.rows[0].title).toBe('Vintage Carhartt jacket');
    expect(res.rows[0].thumbnailUrl).toBe('');
    expect(res.rows[0].batchId).toBeNull();
  });

  it('never filters by org_id or user_id — the RPC proves the workspace and RLS scopes the read', async () => {
    rpcResponse = { data: [matchRow()], error: null };
    await findSimilar('img-query');
    const columns = mock.calls.flatMap((c) => c.filters.map((f) => f.column));
    expect(columns).not.toContain('org_id');
    expect(columns).not.toContain('user_id');
  });

  it('drops a malformed row rather than rendering a card with no id', async () => {
    rpcResponse = { data: [matchRow(), { product_image_id: '' }, null], error: null };
    const res = await findSimilar('img-query');
    if (res.status !== 'ok') throw new Error('expected ok');
    expect(res.rows).toHaveLength(1);
  });

  it('treats a missing similarity as 0 rather than NaN — a NaN sorts nowhere and renders as "NaN%"', async () => {
    rpcResponse = { data: [matchRow({ similarity: null })], error: null };
    const res = await findSimilar('img-query');
    if (res.status !== 'ok') throw new Error('expected ok');
    expect(res.rows[0].similarity).toBe(0);
    expect(res.rows[0].label).toBe('related');
  });
});

// ── ensureEmbeddings ────────────────────────────────────────────────────────

describe('ensureEmbeddings', () => {
  it('refuses an empty list without a network call', async () => {
    const calls = stubFetch([{ body: {} }]);
    const res = await ensureEmbeddings([]);
    expect(res.ok).toBe(false);
    expect(calls).toEqual([]);
  });

  it('refuses when VITE_MATTING_URL is unset', async () => {
    vi.stubEnv('VITE_MATTING_URL', '');
    const calls = stubFetch([{ body: {} }]);
    const res = await ensureEmbeddings(['img-1']);
    expect(res.ok).toBe(false);
    expect(calls).toEqual([]);
  });

  it('refuses without a session rather than calling the service anonymously', async () => {
    mock.authSession = null;
    const calls = stubFetch([{ body: {} }]);
    const res = await ensureEmbeddings(['img-1']);
    expect(res.ok).toBe(false);
    expect(calls).toEqual([]);
  });

  it('survives getSession() throwing', async () => {
    mock.getSessionThrows = true;
    const res = await ensureEmbeddings(['img-1']);
    expect(res.ok).toBe(false);
  });

  it('posts the deduped ids with the session token', async () => {
    const calls = stubFetch([{ status: 202, body: { jobId: 'j1', accepted: 2, skipped: 1 } }]);
    const res = await ensureEmbeddings(['img-1', 'img-1', 'img-2'], true);
    expect(res).toEqual({ ok: true, value: { jobId: 'j1', accepted: 2, skipped: 1 } });
    expect(calls[0].url).toBe('https://matting.test/v1/embed');
    expect(calls[0].init.method).toBe('POST');
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer test-token');
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      productImageIds: ['img-1', 'img-2'],
      force: true,
    });
  });

  it('defaults force to false, so pressing the button twice is cheap', async () => {
    const calls = stubFetch([{ status: 202, body: { jobId: 'j1', accepted: 0, skipped: 3 } }]);
    await ensureEmbeddings(['img-1']);
    expect(JSON.parse(String(calls[0].init.body)).force).toBe(false);
  });

  it('names the migration on a 503 — the one failure a founder can act on', async () => {
    stubFetch([{ ok: false, status: 503, body: { error: 'Embeddings are unavailable.' } }]);
    const res = await ensureEmbeddings(['img-1']);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toContain('listing_embeddings.sql');
    expect(res.status).toBe(503);
  });

  it('says to sign in again on 401 and 403, and never echoes the service body', async () => {
    for (const status of [401, 403]) {
      stubFetch([{ ok: false, status, body: { error: 'caller belongs to no workspace' } }]);
      const res = await ensureEmbeddings(['img-1']);
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.error).toMatch(/Sign out and back in/);
      expect(res.error).not.toContain('workspace');
    }
  });

  it('reports any other status generically, with the number', async () => {
    stubFetch([{ ok: false, status: 500, body: {} }]);
    const res = await ensureEmbeddings(['img-1']);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toContain('500');
  });

  it('reports an unreachable service rather than throwing into a render', async () => {
    stubFetch([new Error('network down')]);
    const res = await ensureEmbeddings(['img-1']);
    expect(res).toEqual({ ok: false, error: 'Could not reach the service.' });
  });
});
