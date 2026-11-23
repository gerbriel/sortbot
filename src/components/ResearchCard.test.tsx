import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { act } from 'react';
import ResearchCard from './ResearchCard';
import { mount, cleanup } from './ui/testUtils';
import type { ClothingItem } from '../App';

/**
 * The research card's shared-insights wiring (071). The network is mocked; the
 * pricing and identification engines run for real. Locked here: with no own
 * comps a usable market aggregate prices the piece, the support line says how
 * many listings and shops stand behind it, and the saved `listing_prices` row
 * carries the market method and the aggregate as its one comp. A missing 071
 * changes nothing.
 */

vi.mock('./SimilarListings', () => ({ default: () => null }));

vi.mock('../lib/researchService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/researchService')>();
  return {
    ...actual,
    researchAvailable: vi.fn(),
    fetchOwnComps: vi.fn(),
    saveIdentification: vi.fn(),
    savePrice: vi.fn(),
    logEvents: vi.fn(),
  };
});

vi.mock('../lib/insightsService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/insightsService')>();
  return {
    ...actual,
    insightsAvailable: vi.fn(),
    fetchMarketPriceStats: vi.fn(),
    fetchBrandEraSignals: vi.fn(),
  };
});

vi.mock('../lib/identification', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/identification')>();
  return { ...actual, loadBrandFacts: vi.fn().mockResolvedValue(null) };
});

import {
  researchAvailable, fetchOwnComps, saveIdentification, savePrice, logEvents,
} from '../lib/researchService';
import {
  insightsAvailable, fetchMarketPriceStats, fetchBrandEraSignals, type MarketPriceStat,
} from '../lib/insightsService';

const item = { id: 'g1', brand: 'Carhartt', category: 'Jackets', era: '' } as unknown as ClothingItem;

const soldStat: MarketPriceStat = {
  kind: 'sold', level: 'brand_category', n: 14, orgs: 4,
  medianCents: 8500, lowCents: 7000, highCents: 9800, newestAt: '2026-11-01T00:00:00Z',
};

async function render() {
  const view = mount(
    <ResearchCard productGroupId="g1" item={item} transcript="" onApplyField={() => {}} />,
  );
  for (let i = 0; i < 4; i++) {
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  }
  return view;
}

beforeEach(() => {
  vi.mocked(researchAvailable).mockResolvedValue(true);
  vi.mocked(fetchOwnComps).mockResolvedValue({ status: 'ok', rows: [] });
  vi.mocked(saveIdentification).mockResolvedValue({ ok: true, id: 'ident-1' });
  vi.mocked(savePrice).mockResolvedValue(true);
  vi.mocked(logEvents).mockResolvedValue(true);
  vi.mocked(insightsAvailable).mockResolvedValue(true);
  vi.mocked(fetchMarketPriceStats).mockResolvedValue({ status: 'ok', data: [soldStat] });
  vi.mocked(fetchBrandEraSignals).mockResolvedValue({ status: 'ok', data: [] });
});

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('ResearchCard shared insights (071)', () => {
  it('asks for the market by brand, category and era, and for the brand era signals', async () => {
    await render();
    expect(fetchMarketPriceStats).toHaveBeenCalledWith({ brand: 'Carhartt', category: 'Jackets', era: '' });
    expect(fetchBrandEraSignals).toHaveBeenCalledWith('Carhartt');
  });

  it('prices from the market aggregate and shows its support line', async () => {
    const { container } = await render();
    expect(container.textContent).toContain('median $85.00');
    const line = container.querySelector('.rc-market');
    expect(line?.textContent).toContain('From other shops');
    expect(line?.textContent).toContain('14 sold across 4 shops');
  });

  it('saves the market method and the aggregate as the one comp, once', async () => {
    await render();
    expect(savePrice).toHaveBeenCalledTimes(1);
    const row = vi.mocked(savePrice).mock.calls[0][0];
    expect(row.method).toBe('market_sold_median');
    expect(row.suggestedCents).toBeGreaterThan(0);
    expect(row.comps).toHaveLength(1);
    expect(row.comps?.[0]).toMatchObject({ kind: 'sold', source: 'market', price_cents: 8500 });
  });

  it('changes nothing when 071 has not run', async () => {
    vi.mocked(insightsAvailable).mockResolvedValue(false);
    const { container } = await render();
    expect(fetchMarketPriceStats).not.toHaveBeenCalled();
    expect(container.querySelector('.rc-market')).toBeNull();
    expect(vi.mocked(savePrice).mock.calls[0][0].method).toBe('insufficient');
  });

  it('fails quiet when the market read errors', async () => {
    vi.mocked(fetchMarketPriceStats).mockResolvedValue({ status: 'error', message: 'boom' });
    const { container } = await render();
    expect(container.textContent).not.toContain('boom');
    expect(container.querySelector('.rc-market')).toBeNull();
    expect(savePrice).toHaveBeenCalledTimes(1);
  });
});
