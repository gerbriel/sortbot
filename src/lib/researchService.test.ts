import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('./supabase', async () => {
  const { createSupabaseMock } = await import('./testing/supabaseMock');
  return { supabase: createSupabaseMock() };
});

import { supabase } from './supabase';
import type { MockedSupabaseClient, MockCall } from './testing/supabaseMock';
import {
  researchAvailable, researchKnownAvailable, __resetResearchProbeForTests,
  logEvents, saveIdentification, markIdentificationReviewed, savePrice,
  fetchLatestIdentifications, fetchLatestPrices,
  recordSale, fetchSales, deleteSale, daysToSell,
  fetchOwnComps, fetchCachedComps, compsQueryKey,
  RESEARCH_FIELDS,
} from './researchService';

const mock = (supabase as unknown as MockedSupabaseClient).__mock;

beforeEach(() => {
  mock.reset();
  __resetResearchProbeForTests();
});

const rows = (data: unknown[]) => ({ data, error: null });
const fails = (code: string, message = 'boom') => ({ data: null, error: { code, message } });
const payloadOf = (c: MockCall) => c.payload as Record<string, unknown>;
const payloadsOf = (c: MockCall) => c.payload as Record<string, unknown>[];

// ── Availability ────────────────────────────────────────────────────────────

describe('researchAvailable', () => {
  it('probes one projected row of pricing_events', async () => {
    expect(await researchAvailable()).toBe(true);
    const call = mock.callsFor('pricing_events', 'select')[0];
    expect(call.columns).toBe('id');
    expect(call.limit).toBe(1);
  });

  it('an EMPTY result is still available — "no rows yet" is not "no table"', async () => {
    mock.responder = () => rows([]);
    expect(await researchAvailable()).toBe(true);
    expect(researchKnownAvailable()).toBe(true);
  });

  it('a missing table turns the feature off', async () => {
    mock.responder = () => fails('42P01', 'relation does not exist');
    expect(await researchAvailable()).toBe(false);
    expect(researchKnownAvailable()).toBe(false);
  });

  it('is cached for the session — one probe however many callers', async () => {
    await Promise.all([researchAvailable(), researchAvailable(), researchAvailable()]);
    expect(mock.callsFor('pricing_events', 'select')).toHaveLength(1);
  });

  it('the synchronous view is false until the probe says yes — hiding the surface is the safe way round', async () => {
    expect(researchKnownAvailable()).toBe(false);
    await researchAvailable();
    expect(researchKnownAvailable()).toBe(true);
  });
});

// ── The log ─────────────────────────────────────────────────────────────────

describe('logEvents', () => {
  it('writes the whole array in ONE insert, not one per field', async () => {
    await logEvents([
      { productGroupId: 'g1', field: 'price', suggested: { cents: 4500 } },
      { productGroupId: 'g1', field: 'era', suggested: '1990s' },
      { productGroupId: 'g1', field: 'condition', suggested: 'Good' },
    ]);
    const calls = mock.callsFor('pricing_events', 'insert');
    expect(calls).toHaveLength(1);
    expect(payloadsOf(calls[0])).toHaveLength(3);
  });

  it('NEVER sends org_id — the column DEFAULT and RLS do that job', async () => {
    await logEvents([{ productGroupId: 'g1', field: 'price', suggested: 1 }]);
    const row = payloadsOf(mock.callsFor('pricing_events', 'insert')[0])[0];
    expect(row).not.toHaveProperty('org_id');
    expect(row).not.toHaveProperty('created_by');
  });

  it('keeps accepted NULL when it was not decided — never coerces it to false', async () => {
    await logEvents([
      { productGroupId: 'g1', field: 'price', suggested: 1 },
      { productGroupId: 'g1', field: 'era', suggested: '1990s', accepted: false },
      { productGroupId: 'g1', field: 'tags', suggested: [], accepted: true },
    ]);
    const written = payloadsOf(mock.callsFor('pricing_events', 'insert')[0]);
    expect(written[0].accepted).toBeNull();
    expect(written[1].accepted).toBe(false);
    expect(written[2].accepted).toBe(true);
  });

  it('drops a row with no listing or an unknown field, rather than letting the CHECK reject the batch', async () => {
    await logEvents([
      { productGroupId: '', field: 'price' },
      { productGroupId: 'g1', field: 'Price' as never },
      { productGroupId: 'g1', field: 'price' },
    ]);
    expect(payloadsOf(mock.callsFor('pricing_events', 'insert')[0])).toHaveLength(1);
  });

  it('writes nothing at all for an empty or fully-invalid list', async () => {
    expect(await logEvents([])).toBe(true);
    expect(await logEvents([{ productGroupId: '', field: 'price' }])).toBe(true);
    expect(mock.callsFor('pricing_events', 'insert')).toHaveLength(0);
  });

  it('chunks a batch-sized sweep at 100', async () => {
    await logEvents(Array.from({ length: 250 }, (_, i) => ({
      productGroupId: `g${i}`, field: 'export' as const,
    })));
    expect(mock.callsFor('pricing_events', 'insert').map(c => payloadsOf(c).length))
      .toEqual([100, 100, 50]);
  });

  it('FAILS QUIET — an error is reported as false and never thrown', async () => {
    mock.responder = () => fails('42501', 'permission denied');
    await expect(logEvents([{ productGroupId: 'g1', field: 'price' }])).resolves.toBe(false);
  });

  it('clamps confidence into the column CHECK and to three decimals', async () => {
    await logEvents([
      { productGroupId: 'g1', field: 'price', confidence: 1.9 },
      { productGroupId: 'g2', field: 'price', confidence: -3 },
      { productGroupId: 'g3', field: 'price', confidence: 0.123456 },
      { productGroupId: 'g4', field: 'price', confidence: NaN },
    ]);
    const written = payloadsOf(mock.callsFor('pricing_events', 'insert')[0]);
    expect(written.map(r => r.confidence)).toEqual([1, 0, 0.123, null]);
  });

  it('covers every field in the documented vocabulary', () => {
    expect([...RESEARCH_FIELDS]).toEqual(
      ['title', 'description', 'tags', 'price', 'era', 'condition', 'flaws', 'rarity', 'export']);
  });
});

// ── Identification runs ─────────────────────────────────────────────────────

describe('saveIdentification', () => {
  it('writes one row with the evidence arrays, and no org_id', async () => {
    await saveIdentification({
      batchId: 'b1', productGroupId: 'g1', era: '1990s',
      eraEvidence: [{ kind: 'voice', text: 'heard nineties', weight: 0.6 }],
      condition: 'Good', flaws: ['holes'], rarity: 0.35,
      rarityEvidence: [], confidence: 0.64, source: 'rules', model: 'rules@1',
    });
    const row = payloadOf(mock.callsFor('listing_identifications', 'insert')[0]);
    expect(row.product_group_id).toBe('g1');
    expect(row.era_evidence).toHaveLength(1);
    expect(row.flaws).toEqual(['holes']);
    expect(row).not.toHaveProperty('org_id');
    expect(row).not.toHaveProperty('reviewed');   // the DB default owns it
  });

  it('defaults the evidence to an empty ARRAY, matching the jsonb_typeof CHECK', async () => {
    await saveIdentification({ productGroupId: 'g1', confidence: 0 });
    const row = payloadOf(mock.callsFor('listing_identifications', 'insert')[0]);
    expect(row.era_evidence).toEqual([]);
    expect(row.flaws).toEqual([]);
  });

  it('rounds rarity to the two decimals numeric(3,2) stores, and clamps it', async () => {
    await saveIdentification({ productGroupId: 'g1', confidence: 0.5, rarity: 0.876 });
    await saveIdentification({ productGroupId: 'g2', confidence: 0.5, rarity: 4 });
    await saveIdentification({ productGroupId: 'g3', confidence: 0.5, rarity: NaN });
    const written = mock.callsFor('listing_identifications', 'insert').map(c => payloadOf(c).rarity);
    expect(written).toEqual([0.88, 1, null]);
  });

  it('refuses a run with no listing', async () => {
    expect(await saveIdentification({ productGroupId: '', confidence: 1 })).toEqual({ ok: false });
    expect(mock.callsFor('listing_identifications', 'insert')).toHaveLength(0);
  });

  it('reads the new id back in the SAME request, so Mark reviewed has a row to address', async () => {
    mock.responder = c => (c.op === 'insert' ? rows([{ id: 'run-1' }]) : undefined);
    expect(await saveIdentification({ productGroupId: 'g1', confidence: 1 }))
      .toEqual({ ok: true, id: 'run-1' });
    expect(mock.callsFor('listing_identifications', 'insert')[0].returning).toBe(true);
  });

  it('fails quiet', async () => {
    mock.responder = () => fails('23514', 'check violation');
    await expect(saveIdentification({ productGroupId: 'g1', confidence: 1 }))
      .resolves.toEqual({ ok: false });
  });
});

describe('markIdentificationReviewed', () => {
  it('updates only `reviewed` and reads the row back', async () => {
    mock.responder = c => (c.op === 'update' ? rows([{ id: 'r1' }]) : undefined);
    expect(await markIdentificationReviewed('r1')).toEqual({ ok: true });
    const call = mock.callsFor('listing_identifications', 'update')[0];
    expect(payloadOf(call)).toEqual({ reviewed: true });
    expect(call.returning).toBe(true);
  });

  it('0 ROWS UPDATED IS A FAILURE — that is what an RLS refusal looks like', async () => {
    mock.responder = c => (c.op === 'update' ? rows([]) : undefined);
    const r = await markIdentificationReviewed('r1');
    expect(r).toEqual({ ok: false, error: 'No permission to mark this reviewed.' });
  });

  it('surfaces a real error in words', async () => {
    mock.responder = c => (c.op === 'update' ? fails('42501', 'permission denied') : undefined);
    const r = await markIdentificationReviewed('r1');
    expect(r.ok).toBe(false);
  });
});

// ── Price runs ──────────────────────────────────────────────────────────────

describe('savePrice', () => {
  it('writes the explanation lines and the comps as given', async () => {
    await savePrice({
      batchId: 'b1', productGroupId: 'g1', suggestedCents: 4499,
      lowCents: 3500, highCents: 5500, method: 'own_sold_median',
      explanation: ['Median of 5 sold comparables: $42.00.'],
      confidence: 0.7,
      comps: [{ kind: 'sold', source: 'own_sales', price_cents: 4200 }],
      needsReview: false, reviewReasons: [],
    });
    const row = payloadOf(mock.callsFor('listing_prices', 'insert')[0]);
    expect(row.suggested_cents).toBe(4499);
    expect(row.explanation).toHaveLength(1);
    expect(row.comps).toHaveLength(1);
    expect(row).not.toHaveProperty('org_id');
  });

  it('WRITES NULL, NOT 0, for a price it declines to name', async () => {
    await savePrice({ productGroupId: 'g1', method: 'insufficient', suggestedCents: 0 });
    const row = payloadOf(mock.callsFor('listing_prices', 'insert')[0]);
    // The column CHECK refuses 0, and the export gate reads $0 as "unpriced".
    expect(row.suggested_cents).toBeNull();
    expect(row.low_cents).toBeNull();
    expect(row.high_cents).toBeNull();
  });

  it('rounds a fractional cent rather than sending it', async () => {
    await savePrice({ productGroupId: 'g1', method: 'spoken', suggestedCents: 4499.6 });
    expect(payloadOf(mock.callsFor('listing_prices', 'insert')[0]).suggested_cents).toBe(4500);
  });

  it('defaults explanation, comps and review_reasons to arrays', async () => {
    await savePrice({ productGroupId: 'g1', method: 'insufficient' });
    const row = payloadOf(mock.callsFor('listing_prices', 'insert')[0]);
    expect(row.explanation).toEqual([]);
    expect(row.comps).toEqual([]);
    expect(row.review_reasons).toEqual([]);
    expect(row.needs_review).toBe(false);
  });

  it('fails quiet', async () => {
    mock.responder = () => fails('23514');
    await expect(savePrice({ productGroupId: 'g1', method: 'spoken' })).resolves.toBe(false);
  });
});

// ── Newest-per-listing reads ────────────────────────────────────────────────

describe('fetchLatestPrices / fetchLatestIdentifications', () => {
  it('keeps the NEWEST row per listing — the reads are ordered, the reduce trusts that', async () => {
    mock.responder = () => rows([
      { id: 'new', product_group_id: 'g1', created_at: '2026-09-02', method: 'spoken' },
      { id: 'old', product_group_id: 'g1', created_at: '2026-09-01', method: 'insufficient' },
      { id: 'other', product_group_id: 'g2', created_at: '2026-09-01', method: 'spoken' },
    ]);
    const r = await fetchLatestPrices(['g1', 'g2']);
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    expect(r.rows.get('g1')?.id).toBe('new');
    expect(r.rows.get('g2')?.id).toBe('other');
  });

  it('projects its columns and never selects *', async () => {
    await fetchLatestPrices(['g1']);
    const call = mock.callsFor('listing_prices', 'select')[0];
    expect(call.columns).toContain('suggested_cents');
    expect(call.columns).not.toContain('*');
  });

  it('adds NO user_id or org_id filter — RLS scopes it', async () => {
    await fetchLatestIdentifications(['g1']);
    const call = mock.callsFor('listing_identifications', 'select')[0];
    expect(call.filters.map(f => f.column)).toEqual(['product_group_id']);
  });

  it('chunks the id list at 100 and de-duplicates it first', async () => {
    const ids = Array.from({ length: 250 }, (_, i) => `g${i}`);
    await fetchLatestPrices([...ids, ...ids.slice(0, 50)]);
    expect(mock.inSizes('listing_prices', 'select')).toEqual([100, 100, 50]);
  });

  it('asks for nothing when there is nothing to ask about', async () => {
    const r = await fetchLatestPrices([]);
    expect(r).toEqual({ status: 'ok', rows: new Map() });
    expect(mock.calls).toHaveLength(0);
  });

  it('reports unavailable rather than an empty map, so the caller can hide instead of lying', async () => {
    mock.responder = () => fails('42P01');
    expect(await fetchLatestPrices(['g1'])).toEqual({ status: 'unavailable' });
  });

  it('is row-capped, so one listing with a thousand runs cannot starve the rest', async () => {
    await fetchLatestPrices(['g1']);
    expect(mock.callsFor('listing_prices', 'select')[0].limit).toBe(400);
  });
});

// ── Sales ───────────────────────────────────────────────────────────────────

describe('recordSale', () => {
  it('writes the row, with source manual and no org_id', async () => {
    const r = await recordSale({
      productGroupId: 'g1', sku: ' ACD-7H2K9M ', soldPriceCents: 4200,
      listedPriceCents: 4500, listedAt: '2026-08-01', soldAt: '2026-08-15',
      marketplace: 'shopify', externalOrderId: ' SHOP-1 ',
    });
    expect(r).toEqual({ ok: true });
    const row = payloadOf(mock.callsFor('listing_sales', 'insert')[0]);
    expect(row).toMatchObject({
      product_group_id: 'g1', sku: 'ACD-7H2K9M', sold_price_cents: 4200,
      listed_price_cents: 4500, marketplace: 'shopify',
      source: 'manual', external_order_id: 'SHOP-1',
    });
    expect(row).not.toHaveProperty('org_id');
    expect(row).not.toHaveProperty('created_by');
  });

  it('omits sold_at entirely when none was given, so the column default applies', async () => {
    await recordSale({ productGroupId: 'g1', soldPriceCents: 100 });
    expect(payloadOf(mock.callsFor('listing_sales', 'insert')[0])).not.toHaveProperty('sold_at');
  });

  it('refuses a non-positive or nonsense price, in words a person can act on', async () => {
    for (const bad of [0, -1, NaN]) {
      const r = await recordSale({ productGroupId: 'g1', soldPriceCents: bad });
      expect(r).toEqual({ ok: false, error: 'Enter what it sold for.' });
    }
    expect(mock.callsFor('listing_sales', 'insert')).toHaveLength(0);
  });

  it('refuses a price past the column ceiling', async () => {
    const r = await recordSale({ productGroupId: 'g1', soldPriceCents: 100_000_000_001 });
    expect(r.ok).toBe(false);
    expect(mock.callsFor('listing_sales', 'insert')).toHaveLength(0);
  });

  it('refuses a sale dated before the listing, before the CHECK has to', async () => {
    const r = await recordSale({
      productGroupId: 'g1', soldPriceCents: 100,
      listedAt: '2026-09-01', soldAt: '2026-08-01',
    });
    expect(r).toEqual({ ok: false, error: 'It cannot have sold before it was listed.' });
  });

  it('refuses a sale with no listing', async () => {
    expect((await recordSale({ productGroupId: '', soldPriceCents: 100 })).ok).toBe(false);
  });

  it('translates 23505 — the expression unique index cannot be an upsert target', async () => {
    mock.responder = () => fails('23505', 'duplicate key');
    const withOrder = await recordSale({
      productGroupId: 'g1', soldPriceCents: 100, externalOrderId: 'SHOP-1',
    });
    expect(withOrder).toEqual({ ok: false, error: 'That order is already recorded for this listing.' });
    const without = await recordSale({ productGroupId: 'g1', soldPriceCents: 100 });
    expect(without.ok).toBe(false);
    if (without.ok) return;
    expect(without.error).toContain('already marked sold');
    expect(without.error).toContain('order number');
  });

  it('names the migration when the table is missing', async () => {
    mock.responder = () => fails('42P01');
    const r = await recordSale({ productGroupId: 'g1', soldPriceCents: 100 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('pricing_research');
  });

  it('turns a blank sku / marketplace / order id into NULL, not an empty string', async () => {
    await recordSale({
      productGroupId: 'g1', soldPriceCents: 100,
      sku: '  ', marketplace: '', externalOrderId: '   ',
    });
    const row = payloadOf(mock.callsFor('listing_sales', 'insert')[0]);
    expect(row.sku).toBeNull();
    expect(row.marketplace).toBeNull();
    expect(row.external_order_id).toBeNull();
  });
});

describe('fetchSales / deleteSale / daysToSell', () => {
  it('groups by listing, newest first, chunked', async () => {
    mock.responder = () => rows([
      { id: 's2', product_group_id: 'g1', sold_price_cents: 4200, sold_at: '2026-09-01' },
      { id: 's1', product_group_id: 'g1', sold_price_cents: 3900, sold_at: '2026-08-01' },
      { id: 's3', product_group_id: 'g2', sold_price_cents: 1000, sold_at: '2026-07-01' },
    ]);
    const r = await fetchSales(['g1', 'g2']);
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    expect(r.rows.get('g1')?.map(s => s.id)).toEqual(['s2', 's1']);
    expect(r.rows.get('g2')).toHaveLength(1);
  });

  it('reports unavailable pre-migration', async () => {
    mock.responder = () => fails('PGRST205');
    expect(await fetchSales(['g1'])).toEqual({ status: 'unavailable' });
  });

  it('deleteSale reads the row back — 0 rows is a failure', async () => {
    mock.responder = () => rows([]);
    expect((await deleteSale('s1')).ok).toBe(false);
    mock.responder = () => rows([{ id: 's1' }]);
    expect(await deleteSale('s1')).toEqual({ ok: true });
  });

  it('daysToSell is computed at read time, and null when it cannot be', () => {
    expect(daysToSell({ listed_at: '2026-08-01', sold_at: '2026-08-15' })).toBe(14);
    expect(daysToSell({ listed_at: null, sold_at: '2026-08-15' })).toBeNull();
    expect(daysToSell({ listed_at: '2026-08-15', sold_at: '2026-08-01' })).toBeNull();
    expect(daysToSell({ listed_at: 'nonsense', sold_at: '2026-08-01' })).toBeNull();
    expect(daysToSell({ listed_at: '2026-08-01', sold_at: '2026-08-01' })).toBe(0);
  });
});

// ── The shop's own comps ────────────────────────────────────────────────────

describe('fetchOwnComps', () => {
  const leader = { id: 'p1', product_group: 'g1', price: 45, era: '1990s' };

  it('narrows brand + category first, and stops as soon as it finds something', async () => {
    mock.responder = c => {
      if (c.table === 'products') return rows([leader]);
      if (c.table === 'listing_sales') {
        return rows([{ id: 's1', product_group_id: 'g1', sold_price_cents: 4200, sold_at: '2026-08-15', listed_at: '2026-08-01', marketplace: 'depop' }]);
      }
      return undefined;
    };
    const r = await fetchOwnComps({ brand: 'Nike', category: 'tees' });
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ kind: 'sold', source: 'own_sales', price_cents: 4200 });
    // Only ONE products read happened — the first step matched.
    expect(mock.callsFor('products', 'select')).toHaveLength(1);
    const filters = mock.callsFor('products', 'select')[0].filters;
    expect(filters.map(f => [f.kind, f.column])).toEqual([['ilike', 'vendor'], ['ilike', 'product_category']]);
  });

  it('falls back to category + era, then to category alone', async () => {
    let step = 0;
    mock.responder = c => {
      if (c.table === 'products') { step++; return rows(step < 3 ? [] : [leader]); }
      if (c.table === 'listing_sales') return rows([]);
      return undefined;
    };
    await fetchOwnComps({ brand: 'Nike', category: 'tees', era: '1990s' });
    const calls = mock.callsFor('products', 'select');
    expect(calls).toHaveLength(3);
    expect(calls[1].filters.map(f => f.column)).toEqual(['product_category', 'era']);
    expect(calls[2].filters.map(f => f.column)).toEqual(['product_category']);
  });

  it('THERE IS NO "everything the shop ever sold" STEP — the loosest match is the category', async () => {
    mock.responder = c => (c.table === 'products' ? rows([]) : undefined);
    const r = await fetchOwnComps({ brand: 'Nike', category: 'tees', era: '1990s' });
    expect(r).toEqual({ status: 'ok', rows: [] });
    // Three steps, and none of them is unfiltered.
    for (const call of mock.callsFor('products', 'select')) {
      expect(call.filters.length).toBeGreaterThan(0);
    }
  });

  it('never proposes the listing being priced as a comp for itself', async () => {
    mock.responder = c => {
      if (c.table === 'products') return rows([leader, { id: 'p2', product_group: 'g2', price: 50, era: null }]);
      if (c.table === 'listing_sales') return rows([{ id: 's1', product_group_id: 'g2', sold_price_cents: 5000, sold_at: '2026-08-15' }]);
      return undefined;
    };
    const r = await fetchOwnComps({ category: 'tees', excludeGroupId: 'g1' });
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    expect(mock.inSizes('listing_sales', 'select')).toEqual([1]);
    expect(r.rows).toHaveLength(1);
  });

  it('EVERY comp it returns is kind "sold" — a recorded sale is never an asking price', async () => {
    mock.responder = c => {
      if (c.table === 'products') return rows([leader]);
      if (c.table === 'listing_sales') {
        return rows(Array.from({ length: 5 }, (_, i) => ({
          id: `s${i}`, product_group_id: 'g1', sold_price_cents: 4000 + i, sold_at: `2026-08-0${i + 1}`,
        })));
      }
      return undefined;
    };
    const r = await fetchOwnComps({ category: 'tees' });
    if (r.status !== 'ok') return;
    expect(r.rows.every(c => c.kind === 'sold' && c.source === 'own_sales')).toBe(true);
  });

  it('notes the marketplace and the days to sell, so the card can show WHY a comp counts', async () => {
    mock.responder = c => {
      if (c.table === 'products') return rows([leader]);
      if (c.table === 'listing_sales') {
        return rows([{ id: 's1', product_group_id: 'g1', sold_price_cents: 4200, listed_price_cents: 4500, listed_at: '2026-08-01', sold_at: '2026-08-15', marketplace: 'depop' }]);
      }
      return undefined;
    };
    const r = await fetchOwnComps({ category: 'tees' });
    if (r.status !== 'ok') return;
    expect(r.rows[0].note).toContain('sold on depop');
    expect(r.rows[0].note).toContain('14 days to sell');
    expect(r.rows[0].note).toContain('listed at $45.00');
  });

  it('asks nothing at all with neither a brand nor a category', async () => {
    expect(await fetchOwnComps({})).toEqual({ status: 'ok', rows: [] });
    expect(mock.calls).toHaveLength(0);
  });

  it('is row-capped on both reads, and returns at most 40 comps', async () => {
    mock.responder = c => {
      if (c.table === 'products') return rows([leader]);
      if (c.table === 'listing_sales') {
        return rows(Array.from({ length: 80 }, (_, i) => ({
          id: `s${i}`, product_group_id: 'g1', sold_price_cents: 1000 + i, sold_at: '2026-08-01',
        })));
      }
      return undefined;
    };
    const r = await fetchOwnComps({ category: 'tees' });
    if (r.status !== 'ok') return;
    expect(r.rows).toHaveLength(40);
    expect(mock.callsFor('products', 'select')[0].limit).toBe(500);
  });

  it('reports unavailable when the products read fails', async () => {
    mock.responder = c => (c.table === 'products' ? fails('42501') : undefined);
    expect(await fetchOwnComps({ category: 'tees' })).toEqual({ status: 'unavailable' });
  });

  it('reports unavailable when the SALES read fails, rather than "no comps"', async () => {
    mock.responder = c => {
      if (c.table === 'products') return rows([leader]);
      if (c.table === 'listing_sales') return fails('42P01');
      return undefined;
    };
    // "No sold history" and "the table is missing" must not look the same: the
    // first is an honest `insufficient`, the second is a feature that is off.
    expect(await fetchOwnComps({ category: 'tees' })).toEqual({ status: 'unavailable' });
  });
});

// ── The comps cache ─────────────────────────────────────────────────────────

describe('fetchCachedComps', () => {
  it('filters expiry IN THE QUERY — a stale row must never reach the price engine', async () => {
    await fetchCachedComps('nike|tees|1990s', 'ebay_active');
    const call = mock.callsFor('price_comps_cache', 'select')[0];
    const kinds = call.filters.map(f => `${f.kind}:${f.column}`);
    expect(kinds).toContain('gt:expires_at');
    expect(kinds).toContain('eq:query_key');
    expect(kinds).toContain('eq:source');
  });

  it('returns null for a miss, and the comps for a hit', async () => {
    mock.responder = () => rows([]);
    expect(await fetchCachedComps('k', 'web_sold')).toEqual({ status: 'ok', rows: null });
    mock.responder = () => rows([{ comps: [{ kind: 'asking', source: 'ebay_active', price_cents: 5500 }] }]);
    const hit = await fetchCachedComps('k', 'web_sold');
    expect(hit.status).toBe('ok');
    if (hit.status !== 'ok') return;
    expect(hit.rows).toHaveLength(1);
  });

  it('asks nothing for an empty key', async () => {
    expect(await fetchCachedComps('   ', 'web_sold')).toEqual({ status: 'ok', rows: null });
    expect(mock.calls).toHaveLength(0);
  });

  it('reports unavailable pre-migration', async () => {
    mock.responder = () => fails('42P01');
    expect(await fetchCachedComps('k', 'web_sold')).toEqual({ status: 'unavailable' });
  });
});

describe('compsQueryKey', () => {
  it('is ONE KEY PER DESIGN — size and condition are deliberately not in it', () => {
    const a = compsQueryKey({ brand: 'Nike', productType: 'Tee', era: '1990s' });
    const b = compsQueryKey({ brand: 'nike', productType: ' tee ', era: '1990s' });
    expect(a).toBe(b);
    expect(a).toBe('nike|tee|1990s');
  });

  it('falls back from productType to category', () => {
    expect(compsQueryKey({ brand: 'Nike', category: 'tees' })).toBe('nike|tees');
  });

  it('includes the model when there is one, between brand and type', () => {
    expect(compsQueryKey({ brand: 'Levi', modelName: '501', productType: 'Jeans' }))
      .toBe('levi|501|jeans');
  });

  it('collapses whitespace and drops blanks rather than leaving empty segments', () => {
    expect(compsQueryKey({ brand: '  The   North Face ', productType: '', era: null }))
      .toBe('the north face');
  });

  it('is empty for nothing, and bounded by the column CHECK', () => {
    expect(compsQueryKey({})).toBe('');
    expect(compsQueryKey({ brand: 'x'.repeat(400) }).length).toBe(200);
  });
});
