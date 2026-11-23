import type { ClothingItem } from '../App';
import type { Identification } from './identification';
import {
  K_ANON_ORGS, K_ANON_ROWS, marketSupportLabel,
  type MarketMatchLevel, type MarketPriceStat,
} from './insightsService';

/**
 * pricing — the price engine. Comps in, one explainable number out.
 *
 * THE RULE THE WHOLE PLAN RESTS ON (docs/pricing/00-plan.md): *"Code computes
 * the final price from the comps rather than letting a model name a number, so
 * every price is explainable."* Nothing in this module invents a figure. Every
 * number in `explanation` is either copied from a comp, copied from the
 * listing, or arithmetic over those — and the tests assert it, so a future
 * "let the model suggest a price" is a change somebody has to make on purpose.
 *
 * ASKING AND SOLD ARE NEVER MERGED INTO ONE MEDIAN. This is the plan's own
 * warning (§"What to watch out for") and it is the single easiest way to make
 * this feature quietly wrong: what three people are ASKING for a jacket says
 * what they hope, and it is systematically above what the last one SOLD for.
 * The two are medianed separately, asking is discounted before it is used at
 * all, and asking is only reached when there are fewer than three solds.
 *
 * AND A SPOKEN PRICE WINS OUTRIGHT. The plan again: *"skip entirely for basics
 * or anything already priced out loud."* A reseller who said "price forty five"
 * over the garment has already done the research this module exists to
 * approximate; second-guessing them with a median of their own old sales is
 * both wrong and insulting, and it would burn a paid search to do it.
 *
 * OTHER SHOPS' AGGREGATES COME AFTER THE SHOP'S OWN DATA, never before and
 * never blended in. `market` carries k-anonymous aggregates of other sharing
 * workspaces (`MarketPriceStat`, migration 071): a median, a quartile band, a
 * row count and a workspace count. The ladder is
 *   spoken > own sold > market sold > own asking > market asking > insufficient
 * so a shop's own three sales always beat a thousand of someone else's, and a
 * market SALE beats the shop's own ASKING (what sold elsewhere is better
 * evidence than what is hoped for here). A market median is used as it is (it
 * is already a median); it is never mixed with an own comp, and a market sold
 * aggregate is never mixed with a market asking one. Every market figure in the
 * explanation is the aggregate's own medianCents, lowCents or highCents, or
 * arithmetic over them, and the line names the support ("14 sales across 4
 * other shops").
 *
 * Pure: no React, no Date, no randomness, no DOM, no network. The one value
 * import from `insightsService` is its pure copy helpers and thresholds; that
 * module creates the Supabase client at import but this one never calls it.
 */

// ── Types ───────────────────────────────────────────────────────────────────

export type CompKind = 'sold' | 'asking';
/** `market` is ONE aggregate of other shops (its `price_cents` is the
 *  aggregate's median and its `note` the support label), never a single
 *  listing of theirs: no single other-shop price ever crosses the line. */
export type CompSource = 'own_sales' | 'ebay_active' | 'web_sold' | 'market';

export interface PriceComp {
  /** The whole point. 'asking' is what somebody wants; 'sold' is what happened. */
  kind: CompKind;
  source: CompSource;
  /** Integer cents, always positive. A non-positive comp is dropped, not clamped. */
  price_cents: number;
  url?: string;
  note?: string;
  /** ISO timestamp. Used only to order comps newest-first — never parsed to a Date. */
  sold_at?: string;
}

export type PriceMethod =
  | 'spoken' | 'own_sold_median' | 'market_sold_median'
  | 'asking_adjusted' | 'market_asking_adjusted' | 'insufficient';

export interface PriceSuggestion {
  /** NULL when we decline to name a number. NEVER 0 — the export price gate
   *  reads $0 as "unpriced" and a zero here would be a suggestion it blocks on. */
  suggestedCents: number | null;
  lowCents: number | null;
  highCents: number | null;
  method: PriceMethod;
  /** Ordered plain sentences. Every figure in them comes from the inputs. */
  explanation: string[];
  confidence: number;
  needsReview: boolean;
  reviewReasons: string[];
  /** Exactly the comps the number was built from, newest first. For the two
   *  market methods this is ONE comp with `source: 'market'`, the aggregate
   *  that was used, so `listing_prices.comps` records it with no extra field. */
  compsUsed: PriceComp[];
}

export interface ComputePriceInput {
  comps: readonly PriceComp[];
  identification: Identification;
  item: ClothingItem;
  /** A price the seller said out loud THIS session, in cents. Wins outright. */
  spokenPriceCents?: number | null;
  /** Aggregates of OTHER sharing workspaces (071). Consulted only after the
   *  shop's own sold comps, and malformed or under-threshold rows are ignored. */
  market?: readonly MarketPriceStat[];
}

// ── Constants, all named ────────────────────────────────────────────────────

/** Below this many usable comps of a kind we do not median at all. Three is the
 *  smallest number where one outlier cannot be the answer. */
export const MIN_COMPS = 3;

/** The newest N solds are the market; older ones are history. Twelve is roughly
 *  a year of a busy shop's sales of one design. */
export const MAX_SOLD_COMPS = 12;

/**
 * What asking prices are worth as evidence of a sale. Deliberately a single
 * blunt number with the reasoning in the explanation line rather than a
 * per-marketplace table: the discount depends on how long the item has been
 * listed, which is exactly what an active-listing API does not tell us.
 */
export const ASKING_DISCOUNT = 0.85;

/** Condition → multiplier, stated in the explanation whenever it is not 1. */
export const CONDITION_ADJUSTMENT: Readonly<Record<string, number>> = {
  Fair: 0.75,
  Good: 0.9,
  Used: 0.9,
  Excellent: 1,
  New: 1.15,
  NWT: 1.15,
};

/**
 * Market confidence, before the identification blend.
 *
 *   sourceConfidence = min(cap, LEVEL_BASE[level] + support)
 *   support          = min(0.10, 0.004 * n + 0.01 * orgs)
 *
 * The caps sit strictly below the floor of the equivalent own tier (own sold
 * starts at 0.60 with three comps, own asking at 0.37), so another shop's data
 * can never look as sure as the shop's own, however many rows stand behind it.
 * A brand match is worth more than a category-and-era match, which is worth
 * more than a category-only match ("a jacket" is not "a Carhartt jacket").
 * Support grows gently with rows and shops and stops at +0.10.
 */
export const MARKET_SOLD_LEVEL_BASE: Readonly<Record<MarketMatchLevel, number>> = {
  brand_category: 0.45,
  category_era: 0.4,
  category: 0.35,
};
export const MARKET_ASKING_LEVEL_BASE: Readonly<Record<MarketMatchLevel, number>> = {
  brand_category: 0.26,
  category_era: 0.22,
  category: 0.18,
};
export const MARKET_SOLD_CONFIDENCE_CAP = 0.55;
export const MARKET_ASKING_CONFIDENCE_CAP = 0.34;
export const MARKET_SUPPORT_CAP = 0.1;

/** The support bonus above, exported so the tests state the formula once. */
export function marketSupport(n: number, orgs: number): number {
  return Math.min(MARKET_SUPPORT_CAP, 0.004 * n + 0.01 * orgs);
}

/** Confidence below this needs a human look whatever the price. */
export const REVIEW_CONFIDENCE = 0.6;
/** Above this value, a merely-decent confidence is not good enough. */
export const REVIEW_HIGH_VALUE_CENTS = 7500;
export const REVIEW_HIGH_VALUE_CONFIDENCE = 0.8;
/** An identification this unsure makes any price built on it unsure. */
export const REVIEW_IDENTIFICATION_CONFIDENCE = 0.5;

// ── Money ───────────────────────────────────────────────────────────────────

const clamp01 = (n: number): number =>
  !Number.isFinite(n) ? 0 : n < 0 ? 0 : n > 1 ? 1 : n;
const round3 = (n: number): number => Math.round(n * 1000) / 1000;

/** `$42.00` — display only; the explanation lines are read by a person. */
export function formatCents(cents: number): string {
  const n = Number.isFinite(cents) ? Math.round(cents) : 0;
  return `$${(n / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Charm pricing in CENTS: nearest whole dollar, one penny under. $49.50 → $49.99.
 *
 * Deliberately a REPLICA of `platformPricing.applyPlatformPrice`'s `.99` branch
 * rather than a call into it — that function takes dollars as a float and is
 * bound up with a `PlatformPricingRule`, which a price suggestion is not. The
 * two are asserted to agree in the tests (`platformPricing` rounds $45.00 +10%
 * to $49.99; `roundToCharm(4950)` is 4999), so a change to either shows up.
 *
 * The floor is 99 cents for the same reason the other one has it: a suggestion
 * of $0 is a suggestion the export gate blocks on.
 */
export function roundToCharm(cents: number): number {
  if (!Number.isFinite(cents) || cents <= 0) return 0;
  const wholeDollars = Math.round(cents / 100);
  return Math.max(99, wholeDollars * 100 - 1);
}

/** A comp is usable when its price is a positive finite integer-ish number. */
function usable(c: PriceComp): boolean {
  return (c.kind === 'sold' || c.kind === 'asking')
    && Number.isFinite(c.price_cents) && c.price_cents > 0;
}

/**
 * Newest first. A comp with no `sold_at` sorts AFTER every dated one rather
 * than being dropped: an undated own-sale is still a real sale, and the only
 * thing lost is its place in the queue.
 */
function newestFirst(a: PriceComp, b: PriceComp): number {
  const ta = a.sold_at ?? '';
  const tb = b.sold_at ?? '';
  if (ta && tb) return tb.localeCompare(ta);
  if (ta) return -1;
  if (tb) return 1;
  return 0;
}

/** Plain median of integer cents. Even counts average the middle pair. */
export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2
    ? sorted[mid]
    : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/**
 * Median with the extremes dropped — one 10× outlier (a bundle sold as one
 * listing, a typo) must not move the answer. Only trimmed once there are enough
 * values that dropping two still leaves a median worth having.
 */
export function trimmedMedian(values: readonly number[]): number {
  if (values.length < 5) return median(values);
  const sorted = [...values].sort((a, b) => a - b);
  return median(sorted.slice(1, -1));
}

/**
 * The interquartile range, as the low/high of the suggested band.
 *
 * IQR rather than min/max on purpose: min/max on eight comps is one flea-market
 * giveaway and one collector overpaying, which is a range so wide it advises
 * nothing. With fewer than four values there are no quartiles to speak of, so
 * the band is the full spread — honest, and visibly wide.
 */
export function iqrBand(values: readonly number[]): { low: number; high: number } {
  if (values.length === 0) return { low: 0, high: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length < 4) return { low: sorted[0], high: sorted[sorted.length - 1] };
  const q = (p: number) => {
    const idx = (sorted.length - 1) * p;
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    return lo === hi ? sorted[lo] : Math.round(sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo));
  };
  return { low: q(0.25), high: q(0.75) };
}

/**
 * [singular, plural] per source, because these are read aloud in a sentence and
 * "1 active eBay listings" is the kind of seam that makes a whole feature feel
 * machine-written. `own_sales` uses the same phrase either way — "1 of your own
 * sales" and "5 of your own sales" both read correctly.
 */
const SOURCE_WORDS: Readonly<Record<CompSource, readonly [string, string]>> = {
  own_sales: ['of your own sales', 'of your own sales'],
  ebay_active: ['active eBay listing', 'active eBay listings'],
  web_sold: ['sold listing found on the web', 'sold listings found on the web'],
  market: ['aggregate of other shops', 'aggregates of other shops'],
};

// ── Market aggregates ───────────────────────────────────────────────────────

const LEVEL_RANK: Readonly<Record<MarketMatchLevel, number>> = {
  brand_category: 0, category_era: 1, category: 2,
};

/** How the aggregate was matched, in words, for the explanation line. */
export const MARKET_LEVEL_WORDS: Readonly<Record<MarketMatchLevel, string>> = {
  brand_category: 'brand and category match',
  category_era: 'category and era match',
  category: 'category match only',
};

const positiveInt = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v > 0;

/**
 * A market stat is usable when it meets the k-anonymity thresholds and its
 * median is a positive finite number. The server enforces the thresholds and
 * `normalizeMarketStat` enforces them again; the engine checks a third time
 * because it is handed whatever the caller has, and a row that should never
 * have existed must not become a price.
 */
function usableMarket(s: MarketPriceStat): boolean {
  return !!s && (s.kind === 'sold' || s.kind === 'asking')
    && s.level in LEVEL_RANK
    && positiveInt(s.n) && s.n >= K_ANON_ROWS
    && positiveInt(s.orgs) && s.orgs >= K_ANON_ORGS
    && positiveInt(s.medianCents);
}

/** The most specific usable aggregate of one kind: brand_category, then
 *  category_era, then category; more rows breaks a tie. */
function pickMarket(market: readonly MarketPriceStat[] | undefined, kind: 'sold' | 'asking'): MarketPriceStat | null {
  const ok = (market ?? []).filter(s => usableMarket(s) && s.kind === kind);
  if (ok.length === 0) return null;
  return [...ok].sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level] || b.n - a.n)[0];
}

/** The aggregate's band, made safe: a missing or out-of-order quartile falls
 *  back to the median rather than widening the range with a made-up figure. */
function marketBand(s: MarketPriceStat): { low: number; high: number } {
  const m = Math.round(s.medianCents);
  const low = positiveInt(s.lowCents) && s.lowCents <= m ? Math.round(s.lowCents) : m;
  const high = positiveInt(s.highCents) && s.highCents >= m ? Math.round(s.highCents) : m;
  return { low, high };
}

/** The aggregate as one comp, so `listing_prices.comps` records what was used. */
function marketComp(s: MarketPriceStat): PriceComp {
  return {
    kind: s.kind,
    source: 'market',
    price_cents: Math.round(s.medianCents),
    note: `${marketSupportLabel(s)} (${MARKET_LEVEL_WORDS[s.level]})`,
    ...(s.newestAt ? { sold_at: s.newestAt } : {}),
  };
}

function marketConfidence(s: MarketPriceStat): number {
  const sold = s.kind === 'sold';
  const base = (sold ? MARKET_SOLD_LEVEL_BASE : MARKET_ASKING_LEVEL_BASE)[s.level];
  const cap = sold ? MARKET_SOLD_CONFIDENCE_CAP : MARKET_ASKING_CONFIDENCE_CAP;
  return Math.min(cap, base + marketSupport(s.n, s.orgs));
}

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

/** "5 of your own sales and 2 active eBay listings" — grouped, so a mixed set
 *  reads as one sentence instead of one line per comp. */
function describeSources(comps: readonly PriceComp[]): string {
  const counts = new Map<CompSource, number>();
  for (const c of comps) counts.set(c.source, (counts.get(c.source) ?? 0) + 1);
  return [...counts.entries()]
    .map(([source, n]) => `${n} ${SOURCE_WORDS[source][n === 1 ? 0 : 1]}`)
    .join(' and ');
}

// ── The engine ──────────────────────────────────────────────────────────────

/**
 * PURE. One price suggestion for one listing.
 *
 * ORDER IS THE DESIGN:
 *   1. a price said out loud            → `spoken`, confidence 1, no search needed
 *   2. ≥ MIN_COMPS sold comps           → `own_sold_median`
 *   3. a usable market SOLD aggregate   → `market_sold_median`
 *   4. ≥ MIN_COMPS asking comps         → `asking_adjusted`, discounted, and SAID so
 *   5. a usable market ASKING aggregate → `market_asking_adjusted`, discounted the same
 *   6. otherwise                        → `insufficient`, and we name no number
 *
 * No asking step is reached while a sold step is available, and no sold step
 * ever sees an asking price. That is the guarantee, and it is tested exhaustively.
 */
export function computePrice(input: ComputePriceInput): PriceSuggestion {
  const { comps, identification, item, spokenPriceCents, market } = input;
  const explanation: string[] = [];

  // ── 1. Already priced out loud ────────────────────────────────────────────
  if (Number.isFinite(spokenPriceCents ?? NaN) && (spokenPriceCents ?? 0) > 0) {
    const cents = Math.round(spokenPriceCents as number);
    return {
      suggestedCents: cents,
      lowCents: cents,
      highCents: cents,
      method: 'spoken',
      explanation: [`You priced this at ${formatCents(cents)} while dictating — nothing else was consulted.`],
      confidence: 1,
      needsReview: false,
      reviewReasons: [],
      compsUsed: [],
    };
  }

  const pool = comps.filter(usable);
  const sold = pool.filter(c => c.kind === 'sold').sort(newestFirst).slice(0, MAX_SOLD_COMPS);
  const asking = pool.filter(c => c.kind === 'asking').sort(newestFirst);
  const marketSold = pickMarket(market, 'sold');
  const marketAsking = pickMarket(market, 'asking');
  let marketUsed: MarketPriceStat | null = null;

  const conditionKey = identification.condition.value ?? item.condition ?? null;
  const conditionFactor = conditionKey ? CONDITION_ADJUSTMENT[conditionKey] ?? 1 : 1;

  let base = 0;
  let band = { low: 0, high: 0 };
  let method: PriceMethod = 'insufficient';
  let used: PriceComp[] = [];
  let sourceConfidence = 0;

  // ── 2. Sold comps ─────────────────────────────────────────────────────────
  if (sold.length >= MIN_COMPS) {
    const values = sold.map(c => c.price_cents);
    base = trimmedMedian(values);
    band = iqrBand(values);
    method = 'own_sold_median';
    used = sold;
    explanation.push(
      `Median of ${sold.length} sold comparable${sold.length === 1 ? '' : 's'} ` +
      `(${describeSources(sold)}): ${formatCents(base)}.`,
    );
    if (values.length >= 5) {
      explanation.push('The highest and lowest were dropped before taking the median.');
    }
    // More solds is more confidence, flattening out: 3 → 0.60, 6 → 0.75,
    // 12 → 0.90. Capped below 1 because a comp is a different garment.
    sourceConfidence = Math.min(0.9, 0.45 + sold.length * 0.05);

  // ── 3. Other shops' sales, before any asking price ───────────────────────
  } else if (marketSold) {
    const m = marketSold;
    marketUsed = m;
    base = Math.round(m.medianCents);
    band = marketBand(m);
    method = 'market_sold_median';
    used = [marketComp(m)];
    explanation.push(
      `Priced from ${m.n} ${plural(m.n, 'sale', 'sales')} across ${m.orgs} other ` +
      `${plural(m.orgs, 'shop', 'shops')} (${MARKET_LEVEL_WORDS[m.level]}): median ${formatCents(base)}.`,
    );
    if (band.low !== band.high) {
      explanation.push(
        `The middle half of those sales ran ${formatCents(band.low)} to ${formatCents(band.high)}.`,
      );
    }
    if (sold.length > 0) {
      explanation.push(
        `${sold.length} of your own sales ${plural(sold.length, 'was', 'were')} found, fewer than ` +
        `${MIN_COMPS}, so other shops' sales were used instead of mixing the two.`,
      );
    }
    explanation.push('Other shops are only ever seen as totals: no single listing of theirs is used.');
    sourceConfidence = marketConfidence(m);

  // ── 4. Asking comps, and only now ─────────────────────────────────────────
  } else if (asking.length >= MIN_COMPS) {
    const values = asking.map(c => c.price_cents);
    const askingMedian = trimmedMedian(values);
    base = Math.round(askingMedian * ASKING_DISCOUNT);
    const rawBand = iqrBand(values);
    band = {
      low: Math.round(rawBand.low * ASKING_DISCOUNT),
      high: Math.round(rawBand.high * ASKING_DISCOUNT),
    };
    method = 'asking_adjusted';
    used = asking;
    explanation.push(
      `No sold comparables — using ${asking.length} asking price${asking.length === 1 ? '' : 's'} ` +
      `(${describeSources(asking)}), median ${formatCents(askingMedian)}.`,
    );
    explanation.push(
      `Asking prices are what sellers want, not what buyers paid, so they are ` +
      `discounted ${Math.round((1 - ASKING_DISCOUNT) * 100)}%: ${formatCents(base)}.`,
    );
    if (sold.length > 0) {
      explanation.push(
        `${sold.length} sold comparable${sold.length === 1 ? '' : 's'} ` +
        `${sold.length === 1 ? 'was' : 'were'} found but that is fewer than ${MIN_COMPS}, ` +
        `so ${sold.length === 1 ? 'it was' : 'they were'} not medianed — asking and sold are never mixed.`,
      );
    }
    // Structurally weaker than a sold median, and it says so.
    sourceConfidence = Math.min(0.55, 0.25 + asking.length * 0.04);

  // ── 5. Other shops' asking prices, discounted the same way ───────────────
  } else if (marketAsking) {
    const m = marketAsking;
    marketUsed = m;
    const askingMedian = Math.round(m.medianCents);
    const rawBand = marketBand(m);
    base = Math.round(askingMedian * ASKING_DISCOUNT);
    band = {
      low: Math.round(rawBand.low * ASKING_DISCOUNT),
      high: Math.round(rawBand.high * ASKING_DISCOUNT),
    };
    method = 'market_asking_adjusted';
    used = [marketComp(m)];
    explanation.push(
      `No sold comparables. Using ${m.n} asking ${plural(m.n, 'price', 'prices')} across ${m.orgs} other ` +
      `${plural(m.orgs, 'shop', 'shops')} (${MARKET_LEVEL_WORDS[m.level]}), median ${formatCents(askingMedian)}.`,
    );
    explanation.push(
      `Asking prices are what sellers want, not what buyers paid, so they are ` +
      `discounted ${Math.round((1 - ASKING_DISCOUNT) * 100)}%: ${formatCents(base)}.`,
    );
    if (sold.length + asking.length > 0) {
      explanation.push(
        `Your own comparables (${[sold.length ? `${sold.length} sold` : '', asking.length ? `${asking.length} asking` : '']
          .filter(Boolean).join(', ')}) were fewer than ${MIN_COMPS} of a kind, so they were not used.`,
      );
    }
    explanation.push('Other shops are only ever seen as totals: no single listing of theirs is used.');
    sourceConfidence = marketConfidence(m);

  // ── 6. Nothing usable ─────────────────────────────────────────────────────
  } else {
    const parts: string[] = [];
    if (sold.length) parts.push(`${sold.length} sold`);
    if (asking.length) parts.push(`${asking.length} asking`);
    explanation.push(
      parts.length
        ? `Only ${parts.join(' and ')} comparable${sold.length + asking.length === 1 ? '' : 's'} — ` +
          `fewer than the ${MIN_COMPS} needed to price from. No price suggested.`
        : `No comparables found for this piece yet. No price suggested.`,
    );
    explanation.push('Price it yourself, or mark similar pieces sold so the next one has history to read.');
    return {
      suggestedCents: null,
      lowCents: null,
      highCents: null,
      method: 'insufficient',
      explanation,
      confidence: 0,
      needsReview: true,
      reviewReasons: [
        parts.length
          ? `Not enough comparables (${parts.join(', ')}) to price from.`
          : 'No comparables found for this piece.',
      ],
      compsUsed: [...sold, ...asking],
    };
  }

  // ── Condition ─────────────────────────────────────────────────────────────
  if (conditionFactor !== 1 && conditionKey) {
    const before = base;
    base = Math.round(base * conditionFactor);
    band = { low: Math.round(band.low * conditionFactor), high: Math.round(band.high * conditionFactor) };
    const pct = Math.round((conditionFactor - 1) * 100);
    explanation.push(
      `${conditionKey} condition: ${pct > 0 ? '+' : '−'}${Math.abs(pct)}% ` +
      `(${formatCents(before)} → ${formatCents(base)}).`,
    );
  }

  // ── Rounding ──────────────────────────────────────────────────────────────
  const rounded = roundToCharm(base);
  if (rounded !== base) {
    explanation.push(`Rounded to ${formatCents(rounded)}.`);
  }
  const suggestedCents = Math.max(99, rounded);
  const lowCents = Math.max(99, Math.min(roundToCharm(band.low), suggestedCents));
  const highCents = Math.max(suggestedCents, roundToCharm(band.high));
  explanation.push(`Range from the comparables: ${formatCents(lowCents)} – ${formatCents(highCents)}.`);

  // Confidence blends how good the comps were with how sure the identification
  // is — a condition adjustment applied on a guessed condition is a guess.
  const confidence = round3(clamp01(
    sourceConfidence * 0.7 + identification.confidence * 0.3,
  ));

  const reviewReasons: string[] = [];
  if (confidence < REVIEW_CONFIDENCE) {
    reviewReasons.push(`Low confidence in the price (${Math.round(confidence * 100)}%).`);
  }
  if (suggestedCents >= REVIEW_HIGH_VALUE_CENTS && confidence < REVIEW_HIGH_VALUE_CONFIDENCE) {
    reviewReasons.push(
      `${formatCents(suggestedCents)} is high enough that being wrong costs real money, ` +
      `and confidence is only ${Math.round(confidence * 100)}%.`,
    );
  }
  if (identification.confidence < REVIEW_IDENTIFICATION_CONFIDENCE) {
    reviewReasons.push(
      `The piece itself is not confidently identified (${Math.round(identification.confidence * 100)}%).`,
    );
  }
  if (method === 'asking_adjusted') {
    reviewReasons.push('Priced from asking prices, not sales — no sold history for this piece yet.');
  }
  if (method === 'market_asking_adjusted') {
    reviewReasons.push("Priced from other shops' asking prices, not sales: no sold history for this piece yet.");
  }
  if (marketUsed && pool.length === 0 && suggestedCents >= REVIEW_HIGH_VALUE_CENTS) {
    reviewReasons.push(
      `${formatCents(suggestedCents)} comes only from other shops (${marketSupportLabel(marketUsed)}), ` +
      `with none of your own comparables behind it. Check it before it goes out.`,
    );
  }

  return {
    suggestedCents,
    lowCents,
    highCents,
    method,
    explanation,
    confidence,
    needsReview: reviewReasons.length > 0,
    reviewReasons,
    compsUsed: used,
  };
}

/** One word for the method, for the card and the review list. */
export const METHOD_LABELS: Readonly<Record<PriceMethod, string>> = {
  spoken: 'You said it',
  own_sold_median: 'Median of sold comparables',
  market_sold_median: "Other shops' sales",
  asking_adjusted: 'Asking prices, discounted',
  market_asking_adjusted: "Other shops' asking, adjusted",
  insufficient: 'Not enough comparables',
};
