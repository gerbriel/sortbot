import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * The 071 client contract. The supabaseMock records `from().update()` calls
 * (table, payload, filters, whether `.select()` was chained); it has no `rpc`,
 * so one is attached here as a vi.fn, the same way usageService.test does.
 */
const rpc = vi.fn();

vi.mock('./supabase', async () => {
  const { createSupabaseMock } = await import('./testing/supabaseMock');
  const client = createSupabaseMock();
  return { supabase: Object.assign(client, { rpc: (...args: unknown[]) => rpc(...args) }) };
});

import { supabase } from './supabase';
import type { MockedSupabaseClient } from './testing/supabaseMock';
import {
  normalizeMarketStat, normalizeEraSignal, normalizeFoundingSummary,
  fetchMarketPriceStats, fetchBrandEraSignals, fetchFoundingInsightsSummary,
  setShareInsights, marketSupportLabel, topEraShare,
  K_ANON_ROWS, K_ANON_ORGS,
} from './insightsService';

const mock = (supabase as unknown as MockedSupabaseClient).__mock;

const wireStat = (o: Record<string, unknown> = {}) => ({
  kind: 'sold', level: 'brand_category', n: 14, orgs: 4,
  median_cents: 4200, low_cents: 3600, high_cents: 5000, newest_at: '2026-11-01T00:00:00Z', ...o,
});

beforeEach(() => {
  rpc.mockReset();
  mock.reset();
});

// ── Normalisers ─────────────────────────────────────────────────────────────

describe('normalizeMarketStat', () => {
  it('maps the wire shape to cents and camelCase', () => {
    expect(normalizeMarketStat(wireStat())).toEqual({
      kind: 'sold', level: 'brand_category', n: 14, orgs: 4,
      medianCents: 4200, lowCents: 3600, highCents: 5000, newestAt: '2026-11-01T00:00:00Z',
    });
  });

  it('accepts numeric strings (bigint/numeric come back as strings) and rounds cents', () => {
    const s = normalizeMarketStat(wireStat({ n: '7', orgs: '3', median_cents: '4200.6', newest_at: null }));
    expect(s).toMatchObject({ n: 7, orgs: 3, medianCents: 4201, newestAt: null });
  });

  it('rejects rows below the k-anonymity thresholds', () => {
    expect(normalizeMarketStat(wireStat({ n: K_ANON_ROWS - 1 }))).toBeNull();
    expect(normalizeMarketStat(wireStat({ orgs: K_ANON_ORGS - 1 }))).toBeNull();
    expect(normalizeMarketStat(wireStat({ n: K_ANON_ROWS, orgs: K_ANON_ORGS }))).not.toBeNull();
  });

  it('rejects a non-positive median', () => {
    expect(normalizeMarketStat(wireStat({ median_cents: 0 }))).toBeNull();
    expect(normalizeMarketStat(wireStat({ median_cents: -1 }))).toBeNull();
    expect(normalizeMarketStat(wireStat({ median_cents: 'abc' }))).toBeNull();
  });

  it('rejects malformed shapes', () => {
    for (const bad of [null, undefined, 42, 'row', [], wireStat({ kind: 'listed' }), wireStat({ level: 'brand' }), wireStat({ kind: undefined })]) {
      expect(normalizeMarketStat(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});

describe('normalizeEraSignal', () => {
  it('keeps a supported era, trimmed', () => {
    expect(normalizeEraSignal({ era: ' 1990s ', n: 23, orgs: 6 })).toEqual({ era: '1990s', n: 23, orgs: 6 });
  });

  it('rejects rows below the k-anonymity thresholds', () => {
    expect(normalizeEraSignal({ era: '1990s', n: K_ANON_ROWS - 1, orgs: 6 })).toBeNull();
    expect(normalizeEraSignal({ era: '1990s', n: 23, orgs: K_ANON_ORGS - 1 })).toBeNull();
  });

  it('rejects malformed shapes and a blank era', () => {
    for (const bad of [null, 7, 'x', { n: 23, orgs: 6 }, { era: '', n: 23, orgs: 6 }, { era: '   ', n: 23, orgs: 6 }, { era: 1990, n: 23, orgs: 6 }]) {
      expect(normalizeEraSignal(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});

describe('normalizeFoundingSummary', () => {
  it('maps every count and zero-fills a missing or malformed payload', () => {
    expect(normalizeFoundingSummary({
      sharing_orgs: 3, total_orgs: 5, sold_listings: 120, asking_listings: 300, dated_listings: 80, brands: 40,
    })).toEqual({ sharingOrgs: 3, totalOrgs: 5, soldListings: 120, askingListings: 300, datedListings: 80, brands: 40 });
    expect(normalizeFoundingSummary(null)).toEqual({
      sharingOrgs: 0, totalOrgs: 0, soldListings: 0, askingListings: 0, datedListings: 0, brands: 0,
    });
  });
});

// ── fetchMarketPriceStats ───────────────────────────────────────────────────

describe('fetchMarketPriceStats', () => {
  const q = { brand: ' Carhartt ', category: ' Jackets ', era: ' 1990s ' };

  it('calls the 071 function with trimmed arguments and drops rows that fail the normaliser', async () => {
    rpc.mockResolvedValue({ data: [wireStat(), wireStat({ n: 2 }), wireStat({ median_cents: 0 }), 'junk'], error: null });
    const r = await fetchMarketPriceStats(q);
    expect(rpc).toHaveBeenCalledWith('market_price_stats', { p_brand: 'Carhartt', p_category: 'Jackets', p_era: '1990s' });
    expect(r.status).toBe('ok');
    if (r.status === 'ok') expect(r.data).toHaveLength(1);
  });

  it('zero rows is ok, not an error; a non-array payload is ok and empty', async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    expect(await fetchMarketPriceStats(q)).toEqual({ status: 'ok', data: [] });
    rpc.mockResolvedValue({ data: null, error: null });
    expect(await fetchMarketPriceStats(q)).toEqual({ status: 'ok', data: [] });
  });

  it.each(['42883', 'PGRST202'])('maps %s to unavailable', async code => {
    rpc.mockResolvedValue({ data: null, error: { code, message: 'no such function' } });
    expect(await fetchMarketPriceStats(q)).toEqual({ status: 'unavailable' });
  });

  it('maps 42501 to forbidden', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'opted out' } });
    expect(await fetchMarketPriceStats(q)).toEqual({ status: 'forbidden' });
  });

  it('maps anything else to error with the server message', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'XX000', message: 'boom' } });
    expect(await fetchMarketPriceStats(q)).toEqual({ status: 'error', message: 'boom' });
  });
});

// ── fetchBrandEraSignals ────────────────────────────────────────────────────

describe('fetchBrandEraSignals', () => {
  it('a blank brand is ok [] with no network call', async () => {
    expect(await fetchBrandEraSignals('')).toEqual({ status: 'ok', data: [] });
    expect(await fetchBrandEraSignals('   ')).toEqual({ status: 'ok', data: [] });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('sorts by n descending and drops rows that fail the normaliser', async () => {
    rpc.mockResolvedValue({
      data: [
        { era: '1980s', n: 8, orgs: 3 },
        { era: '1990s', n: 23, orgs: 6 },
        { era: '2000s', n: 3, orgs: 2 },
        { era: '1970s', n: 12, orgs: 2 },
      ],
      error: null,
    });
    const r = await fetchBrandEraSignals(' Nike ');
    expect(rpc).toHaveBeenCalledWith('brand_era_signals', { p_brand: 'Nike' });
    expect(r).toEqual({ status: 'ok', data: [
      { era: '1990s', n: 23, orgs: 6 },
      { era: '1970s', n: 12, orgs: 2 },
      { era: '1980s', n: 8, orgs: 3 },
    ] });
  });

  it('maps errors the same way', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'x' } });
    expect(await fetchBrandEraSignals('Nike')).toEqual({ status: 'unavailable' });
    rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'x' } });
    expect(await fetchBrandEraSignals('Nike')).toEqual({ status: 'forbidden' });
    rpc.mockResolvedValue({ data: null, error: { code: '22023', message: 'bad' } });
    expect(await fetchBrandEraSignals('Nike')).toEqual({ status: 'error', message: 'bad' });
  });
});

describe('fetchFoundingInsightsSummary', () => {
  it('normalises the payload, and 42501 is forbidden', async () => {
    rpc.mockResolvedValue({ data: { sharing_orgs: 2, total_orgs: 3 }, error: null });
    const r = await fetchFoundingInsightsSummary();
    expect(rpc).toHaveBeenCalledWith('founding_insights_summary');
    expect(r.status === 'ok' && r.data.sharingOrgs).toBe(2);
    rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'x' } });
    expect(await fetchFoundingInsightsSummary()).toEqual({ status: 'forbidden' });
  });
});

// ── setShareInsights ────────────────────────────────────────────────────────

describe('setShareInsights', () => {
  it('updates organizations.share_insights for one workspace and asks for the row back', async () => {
    mock.responder = call => (call.table === 'organizations' && call.op === 'update'
      ? { data: [{ id: 'org-1' }], error: null } : undefined);
    expect(await setShareInsights('org-1', false)).toEqual({ status: 'ok', data: false });
    const [call] = mock.callsFor('organizations', 'update');
    expect(call.payload).toEqual({ share_insights: false });
    expect(call.filters).toEqual([{ kind: 'eq', column: 'id', value: 'org-1' }]);
    expect(call.returning).toBe(true);
  });

  it('0 rows updated is forbidden: RLS refused it silently', async () => {
    mock.responder = () => ({ data: [], error: null });
    expect(await setShareInsights('org-1', true)).toEqual({ status: 'forbidden' });
    mock.responder = () => ({ data: null, error: null });
    expect(await setShareInsights('org-1', true)).toEqual({ status: 'forbidden' });
  });

  it('a missing column is unavailable, 42501 forbidden, anything else error', async () => {
    mock.responder = () => ({ data: null, error: { code: '42703', message: 'no column' } });
    expect(await setShareInsights('org-1', true)).toEqual({ status: 'unavailable' });
    mock.responder = () => ({ data: null, error: { code: '42501', message: 'x' } });
    expect(await setShareInsights('org-1', true)).toEqual({ status: 'forbidden' });
    mock.responder = () => ({ data: null, error: { code: 'XX000', message: 'boom' } });
    expect(await setShareInsights('org-1', true)).toEqual({ status: 'error', message: 'boom' });
  });
});

// ── Pure copy helpers ───────────────────────────────────────────────────────

describe('marketSupportLabel', () => {
  it('says sold or listed, with the shop plural right', () => {
    expect(marketSupportLabel({ kind: 'sold', n: 14, orgs: 4 })).toBe('14 sold across 4 shops');
    expect(marketSupportLabel({ kind: 'asking', n: 9, orgs: 2 })).toBe('9 listed across 2 shops');
    expect(marketSupportLabel({ kind: 'sold', n: 5, orgs: 1 })).toBe('5 sold across 1 shop');
  });
});

describe('topEraShare', () => {
  it('is null for nothing or a zero total', () => {
    expect(topEraShare([])).toBeNull();
    expect(topEraShare([{ era: '1990s', n: 0, orgs: 0 }])).toBeNull();
  });

  it('returns the top era, its share of all rows and its support', () => {
    expect(topEraShare([
      { era: '1980s', n: 8, orgs: 3 },
      { era: '1990s', n: 23, orgs: 6 },
    ])).toEqual({ era: '1990s', share: 23 / 31, n: 23, orgs: 6 });
  });

  it('does not depend on input order', () => {
    const a = topEraShare([{ era: '1990s', n: 23, orgs: 6 }, { era: '1980s', n: 8, orgs: 3 }]);
    const b = topEraShare([{ era: '1980s', n: 8, orgs: 3 }, { era: '1990s', n: 23, orgs: 6 }]);
    expect(a).toEqual(b);
  });
});
