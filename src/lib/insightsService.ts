/**
 * SHARED INSIGHTS: the client half of `supabase/migrations/071_shared_insights.sql`.
 *
 * WHAT THIS IS. The research card (Step 3) prices and dates a piece from the
 * shop's OWN comps, which RLS confines to one workspace. As more shops list,
 * the aggregate of what everyone sold and how everyone dated a brand is worth
 * more than any one shop's history. This module reads that aggregate.
 *
 * WHAT CROSSES THE WORKSPACE LINE, AND WHAT NEVER DOES.
 * - Crosses: AGGREGATES ONLY. A median, a quartile band, a count of rows and a
 *   count of contributing workspaces, per (brand, category, era) and per
 *   (brand, era). Every row the server returns is k-anonymous: it is withheld
 *   unless at least `K_ANON_ROWS` listings from at least `K_ANON_ORGS`
 *   different workspaces stand behind it.
 * - Never crosses: photos, titles, descriptions, SKUs, customers, prices of a
 *   single listing, workspace names, who contributed, and the CLIP vectors.
 *   "Similar past listings" (`match_listing_images`) stays same-workspace only.
 * - A workspace can opt out: `organizations.share_insights` (default true).
 *   An opted-out workspace neither contributes nor reads the aggregate.
 *
 * FORWARD-COMPATIBLE, the usageService way: a missing function or column reads
 * as 'unavailable' and every surface that depends on it hides. 'forbidden' is
 * 42501. Anything else is 'error' with the server's message. Reads FAIL QUIET
 * in the research card, like the rest of researchService.
 */
import { supabase } from './supabase';
import { log } from './debugLogger';

// ── Thresholds (mirrored by the SQL; the server is the authority) ────────────

/** Minimum listings behind any returned aggregate. */
export const K_ANON_ROWS = 5;
/** Minimum distinct workspaces behind any returned aggregate. */
export const K_ANON_ORGS = 2;

// ── Types (the 071 contract) ─────────────────────────────────────────────────

export type InsightsResult<T> =
  | { status: 'ok'; data: T }
  | { status: 'unavailable' }
  | { status: 'forbidden' }
  | { status: 'error'; message: string };

/** How a market aggregate was matched, from most to least specific. Same
 *  ladder as `fetchOwnComps` so the two explain themselves the same way. */
export type MarketMatchLevel = 'brand_category' | 'category_era' | 'category';

/** One aggregate of OTHER workspaces' prices. Cents, like everything in pricing. */
export interface MarketPriceStat {
  kind: 'sold' | 'asking';
  level: MarketMatchLevel;
  /** Listings behind the aggregate (>= K_ANON_ROWS). */
  n: number;
  /** Distinct workspaces behind it (>= K_ANON_ORGS). */
  orgs: number;
  medianCents: number;
  /** 25th and 75th percentile. */
  lowCents: number;
  highCents: number;
  /** ISO timestamp of the newest contributing row, or null. */
  newestAt: string | null;
}

/** How other workspaces dated a brand: one row per era with its support. */
export interface BrandEraSignal {
  /** Canonical decade, `'1990s'`-shaped, as identification.ts spells them. */
  era: string;
  n: number;
  orgs: number;
}

export interface FoundingInsightsSummary {
  sharingOrgs: number;
  totalOrgs: number;
  /** Sold listings contributing to market stats, across sharing workspaces. */
  soldListings: number;
  /** Priced listings (asking) contributing. */
  askingListings: number;
  /** Listings with a human-set era and brand contributing to era signals. */
  datedListings: number;
  /** Distinct normalised brands with any signal. */
  brands: number;
}

export interface MarketPriceQuery {
  brand: string;
  category: string;
  era: string;
}

// ── Error mapping ────────────────────────────────────────────────────────────

const UNAVAILABLE_CODES = new Set([
  '42883', 'PGRST202', 'PGRST302', '42703', 'PGRST204', '42P01', 'PGRST205',
]);

function mapError<T>(where: string, error: { code?: string; message?: string } | null): InsightsResult<T> {
  const code = error?.code ?? '';
  const message = error?.message ?? 'unknown error';
  if (UNAVAILABLE_CODES.has(code)) {
    log.service(`${where} | unavailable (${code} ${message})`);
    return { status: 'unavailable' };
  }
  if (code === '42501') return { status: 'forbidden' };
  log.service(`${where} | error (${code} ${message})`);
  return { status: 'error', message };
}

// ── Normalisers (never trust the wire shape) ─────────────────────────────────

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

export function normalizeMarketStat(raw: unknown): MarketPriceStat | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const kind = r.kind === 'sold' || r.kind === 'asking' ? r.kind : null;
  const level = r.level === 'brand_category' || r.level === 'category_era' || r.level === 'category' ? r.level : null;
  if (!kind || !level) return null;
  const stat: MarketPriceStat = {
    kind,
    level,
    n: num(r.n),
    orgs: num(r.orgs),
    medianCents: Math.round(num(r.median_cents)),
    lowCents: Math.round(num(r.low_cents)),
    highCents: Math.round(num(r.high_cents)),
    newestAt: typeof r.newest_at === 'string' ? r.newest_at : null,
  };
  // The server enforces these; the client refuses to render a row that does
  // not meet them anyway, so a misconfigured threshold cannot leak a number.
  if (stat.n < K_ANON_ROWS || stat.orgs < K_ANON_ORGS || stat.medianCents <= 0) return null;
  return stat;
}

export function normalizeEraSignal(raw: unknown): BrandEraSignal | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const era = str(r.era).trim();
  if (!era) return null;
  const sig = { era, n: num(r.n), orgs: num(r.orgs) };
  if (sig.n < K_ANON_ROWS || sig.orgs < K_ANON_ORGS) return null;
  return sig;
}

export function normalizeFoundingSummary(raw: unknown): FoundingInsightsSummary {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    sharingOrgs: num(r.sharing_orgs),
    totalOrgs: num(r.total_orgs),
    soldListings: num(r.sold_listings),
    askingListings: num(r.asking_listings),
    datedListings: num(r.dated_listings),
    brands: num(r.brands),
  };
}

// ── Reads ────────────────────────────────────────────────────────────────────

let availability: Promise<boolean> | null = null;

/** Once per session: does the 071 function exist? Any member may ask. */
export function insightsAvailable(): Promise<boolean> {
  if (!availability) {
    availability = (async () => {
      try {
        const { error } = await supabase
          .rpc('market_price_stats', { p_brand: '', p_category: '', p_era: '' });
        return !error || !UNAVAILABLE_CODES.has(error.code ?? '');
      } catch {
        return false;
      }
    })();
  }
  return availability;
}

/** Aggregates of OTHER sharing workspaces' prices for this brand / category / era.
 *  Zero rows is a normal answer (not enough data yet), not an error. */
export async function fetchMarketPriceStats(q: MarketPriceQuery): Promise<InsightsResult<MarketPriceStat[]>> {
  const { data, error } = await supabase.rpc('market_price_stats', {
    p_brand: q.brand.trim(), p_category: q.category.trim(), p_era: q.era.trim(),
  });
  if (error) return mapError('fetchMarketPriceStats', error);
  const rows = Array.isArray(data) ? data : [];
  return { status: 'ok', data: rows.map(normalizeMarketStat).filter((s): s is MarketPriceStat => s !== null) };
}

/** How other sharing workspaces dated this brand, most supported era first. */
export async function fetchBrandEraSignals(brand: string): Promise<InsightsResult<BrandEraSignal[]>> {
  const b = brand.trim();
  if (!b) return { status: 'ok', data: [] };
  const { data, error } = await supabase.rpc('brand_era_signals', { p_brand: b });
  if (error) return mapError('fetchBrandEraSignals', error);
  const rows = Array.isArray(data) ? data : [];
  const sigs = rows.map(normalizeEraSignal).filter((s): s is BrandEraSignal => s !== null);
  sigs.sort((a, b2) => b2.n - a.n);
  return { status: 'ok', data: sigs };
}

/** Founding admins only. */
export async function fetchFoundingInsightsSummary(): Promise<InsightsResult<FoundingInsightsSummary>> {
  const { data, error } = await supabase.rpc('founding_insights_summary');
  if (error) return mapError('fetchFoundingInsightsSummary', error);
  return { status: 'ok', data: normalizeFoundingSummary(data) };
}

// ── Write ────────────────────────────────────────────────────────────────────

/** Owner or admin of the workspace. RLS decides; 0 rows updated is 'forbidden'. */
export async function setShareInsights(orgId: string, on: boolean): Promise<InsightsResult<boolean>> {
  const { data, error } = await supabase
    .from('organizations')
    .update({ share_insights: on })
    .eq('id', orgId)
    .select('id');
  if (error) return mapError('setShareInsights', error);
  if (!data || data.length === 0) return { status: 'forbidden' };
  return { status: 'ok', data: on };
}

// ── Pure helpers for copy ────────────────────────────────────────────────────

/** "14 sold across 4 shops", the one phrase every surface uses for a market row. */
export function marketSupportLabel(stat: Pick<MarketPriceStat, 'kind' | 'n' | 'orgs'>): string {
  const what = stat.kind === 'sold' ? 'sold' : 'listed';
  return `${stat.n} ${what} across ${stat.orgs} shop${stat.orgs === 1 ? '' : 's'}`;
}

/** Share of the top era among all era signals for a brand, 0..1. */
export function topEraShare(signals: readonly BrandEraSignal[]): { era: string; share: number; n: number; orgs: number } | null {
  if (signals.length === 0) return null;
  const total = signals.reduce((s, x) => s + x.n, 0);
  if (total <= 0) return null;
  const top = signals.reduce((a, b) => (b.n > a.n ? b : a));
  return { era: top.era, share: top.n / total, n: top.n, orgs: top.orgs };
}
