import type { ClothingItem } from '../App';
import type { Identification } from './identification';

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
 * Pure: no React, no Supabase, no Date, no randomness, no DOM.
 */

// ── Types ───────────────────────────────────────────────────────────────────

export type CompKind = 'sold' | 'asking';
export type CompSource = 'own_sales' | 'ebay_active' | 'web_sold';

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

export type PriceMethod = 'spoken' | 'own_sold_median' | 'asking_adjusted' | 'insufficient';

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
  /** Exactly the comps the number was built from, newest first. */
  compsUsed: PriceComp[];
}

export interface ComputePriceInput {
  comps: readonly PriceComp[];
  identification: Identification;
  item: ClothingItem;
  /** A price the seller said out loud THIS session, in cents. Wins outright. */
  spokenPriceCents?: number | null;
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
};

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
 *   3. ≥ MIN_COMPS asking comps         → `asking_adjusted`, discounted, and SAID so
 *   4. otherwise                        → `insufficient`, and we name no number
 *
 * Step 3 is never reached while step 2 is available, and step 2 never sees an
 * asking price. That is the guarantee, and it is tested exhaustively.
 */
export function computePrice(input: ComputePriceInput): PriceSuggestion {
  const { comps, identification, item, spokenPriceCents } = input;
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

  // ── 3. Asking comps, and only now ─────────────────────────────────────────
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

  // ── 4. Nothing usable ─────────────────────────────────────────────────────
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
  asking_adjusted: 'Asking prices, discounted',
  insufficient: 'Not enough comparables',
};
