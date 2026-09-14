/**
 * platformPricing — one price in the app, many prices in the world.
 *
 * THE PROBLEM, in the founder's words: *"User can set pricing options for
 * different platforms they will upload CSV to. Either an upsell percentage or
 * dollar value per app because of charges and fees."* A garment priced at $45
 * nets $45 on a direct Shopify sale, ~$39 on eBay after final-value fees, and
 * less again on Depop. Re-pricing 200 listings by hand per marketplace is how
 * a reseller loses an afternoon and still ships the wrong number.
 *
 * THE MODEL: the listing keeps ONE price — the one the user typed in Step 3,
 * the one stored in `products.price`. A platform is a pure FUNCTION applied at
 * export time. Nothing in the database changes when you switch platforms, so
 * the same batch exports to Shopify and eBay from the same data, and the price
 * the user reasons about never becomes ambiguous.
 *
 * TWO INVARIANTS THAT ARE NOT NEGOTIABLE
 *
 *   1. **$0 passes through untouched.** GoogleSheetExporter hard-blocks an
 *      export where any product has no price or $0 (CLAUDE.md §10). If a
 *      rounding rule could turn 0 into 0.99, a platform selection would
 *      silently defeat that gate and ship unpriced products to Shopify. So
 *      anything that is not a positive, finite number is returned exactly as
 *      it came in — the gate still sees the $0 and still blocks.
 *
 *   2. **A rule can never produce a non-positive price.** A discount platform
 *      (-100%) or a fixed -$50 on a $20 item would otherwise manufacture the
 *      very $0 the gate exists to catch, *after* the gate has run. The result
 *      is clamped to one cent, and whole-dollar rounding to one dollar.
 *
 * Everything here is pure: no React, no Supabase, no Date, no randomness.
 */

export type PriceAdjustmentType = 'percent' | 'fixed';

/**
 * How the adjusted number is tidied for display.
 *   'none'  — plain cents (49.50)
 *   '.99'   — charm pricing: nearest whole dollar, less a penny (49.50 → 49.99)
 *   'whole' — nearest whole dollar (49.50 → 50.00)
 */
export type PriceRounding = 'none' | '.99' | 'whole';

export interface PlatformPricingRule {
  /** Stable key. Used by the selector, the filename slug and React keys. */
  id: string;
  /** What the user calls it: Shopify, eBay, Depop, "Etsy — vintage shop"… */
  name: string;
  /** Off keeps the platform in the list but out of the export selector. */
  enabled: boolean;
  /** percent: value is a PERCENTAGE (12 → +12%). fixed: value is DOLLARS. */
  adjustment: { type: PriceAdjustmentType; value: number };
  rounding: PriceRounding;
  /** Also adjust Compare At Price. Off leaves the compare-at as typed, which
   *  is usually right: it is a reference price, not a price you are charging. */
  applyToCompareAt: boolean;
}

/** The identity platform. Always offered, never stored, never adjusts anything —
 *  so the default export is byte-for-byte what it was before this feature. */
export const NO_ADJUSTMENT_PLATFORM: PlatformPricingRule = {
  id: 'shopify-direct',
  name: 'Shopify',
  enabled: true,
  adjustment: { type: 'percent', value: 0 },
  rounding: 'none',
  applyToCompareAt: false,
};

/**
 * Quick-add suggestions in the Workspace panel. The percentages are the
 * marketplaces' own published headline fee rates as a STARTING POINT, not
 * advice and not a live feed — the founder edits them, and the UI says so.
 * Fees change; that is exactly why this is an editable list and not a constant
 * consulted at export time.
 */
export const PLATFORM_PRESETS: ReadonlyArray<{ name: string; percent: number }> = [
  { name: 'Shopify', percent: 0 },
  { name: 'eBay', percent: 13 },
  { name: 'Depop', percent: 10 },
  { name: 'Poshmark', percent: 20 },
  { name: 'Mercari', percent: 10 },
  { name: 'Etsy', percent: 9 },
  { name: 'Grailed', percent: 9 },
  { name: 'Vinted', percent: 5 },
];

export const ADJUSTMENT_TYPES: ReadonlyArray<{ value: PriceAdjustmentType; label: string }> = [
  { value: 'percent', label: 'Percent (%)' },
  { value: 'fixed', label: 'Dollars ($)' },
];

export const ROUNDING_MODES: ReadonlyArray<{ value: PriceRounding; label: string }> = [
  { value: 'none', label: 'Exact cents' },
  { value: '.99', label: 'End in .99' },
  { value: 'whole', label: 'Whole dollars' },
];

/** Bound on a single adjustment. ±1000% / ±$100,000 is far past any real fee
 *  structure and stops a mistyped value rescaling an entire export. */
export const MAX_PERCENT = 1000;
export const MAX_FIXED = 100000;

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/** Parse anything the DB or a form hands us into a finite number, or NaN. */
export function toPriceNumber(raw: unknown): number {
  if (raw === null || raw === undefined || raw === '') return NaN;
  const n = typeof raw === 'number' ? raw : parseFloat(String(raw));
  return Number.isFinite(n) ? n : NaN;
}

/**
 * Apply a platform's rule to one price.
 *
 * Returns the price unchanged when there is no rule, when the rule is the
 * identity (0% / $0 / no rounding), or when the price is not a positive finite
 * number — see invariant 1 above. Otherwise: adjust, round, clamp.
 */
export function applyPlatformPrice(price: number, rule?: PlatformPricingRule | null): number {
  if (!Number.isFinite(price) || price <= 0) return price;  // invariant 1
  if (!rule) return round2(price);

  const { type, value } = rule.adjustment ?? { type: 'percent', value: 0 };
  const amount = Number.isFinite(value) ? value : 0;
  const clamped = type === 'percent'
    ? Math.max(-MAX_PERCENT, Math.min(MAX_PERCENT, amount))
    : Math.max(-MAX_FIXED, Math.min(MAX_FIXED, amount));

  const adjusted = type === 'percent'
    ? price * (1 + clamped / 100)
    : price + clamped;

  switch (rule.rounding) {
    case 'whole':
      // Never round a real price down to $0 — invariant 2.
      return Math.max(1, Math.round(adjusted));
    case '.99': {
      // Charm pricing: nearest whole dollar, one penny under. 49.50 → 49.99,
      // 50.60 → 50.99. The floor is 0.99 so a heavy discount still ships a
      // price the export gate accepts.
      const whole = Math.round(adjusted);
      return Math.max(0.99, round2(whole - 0.01));
    }
    default:
      return Math.max(0.01, round2(adjusted));
  }
}

/**
 * The CSV/preview cell for a price under a platform rule: a 2-decimal string,
 * or '' when there is no usable price. The single helper both the exporter's
 * download path and its preview table call, so they cannot drift apart.
 */
export function formatPlatformPrice(raw: unknown, rule?: PlatformPricingRule | null): string {
  const n = toPriceNumber(raw);
  if (!Number.isFinite(n)) return '';
  return applyPlatformPrice(n, rule).toFixed(2);
}

/** True when the rule changes nothing — the exporter uses this to stay on the
 *  legacy code path and to decide whether the summary line is worth showing. */
export function isIdentityRule(rule?: PlatformPricingRule | null): boolean {
  if (!rule) return true;
  const v = rule.adjustment?.value ?? 0;
  return (!Number.isFinite(v) || v === 0) && rule.rounding === 'none';
}

/** URL/filename-safe form of a platform name: "eBay — Vintage" → "ebay-vintage". */
export function platformSlug(name: string): string {
  const slug = String(name ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'export';
}

/** "Prices +12% rounded to .99 for eBay" — the one-line summary above the
 *  preview, so nobody downloads an adjusted CSV without being told. */
export function describePlatformRule(rule?: PlatformPricingRule | null): string {
  if (!rule) return '';
  const v = rule.adjustment?.value ?? 0;
  const parts: string[] = [];
  if (Number.isFinite(v) && v !== 0) {
    const sign = v > 0 ? '+' : '−';
    const mag = Math.abs(v);
    parts.push(rule.adjustment.type === 'percent'
      ? `${sign}${round2(mag)}%`
      : `${sign}$${round2(mag).toFixed(2)}`);
  }
  if (rule.rounding === '.99') parts.push('rounded to .99');
  else if (rule.rounding === 'whole') parts.push('rounded to whole dollars');

  if (parts.length === 0) return `Prices unchanged for ${rule.name}`;
  return `Prices ${parts.join(' ')} for ${rule.name}`
    + (rule.applyToCompareAt ? ' (compare-at too)' : '');
}

/** A worked example for the settings form: "$45.00 → $49.99". */
export function pricingExample(rule: PlatformPricingRule, sample = 45): string {
  return `$${sample.toFixed(2)} → $${applyPlatformPrice(sample, rule).toFixed(2)}`;
}

/**
 * Coerce whatever is in the org's JSONB into a valid, de-duplicated rule list.
 *
 * Settings are stored as free-form JSON, may have been written by an older
 * build, and are the input to the money path — so nothing downstream gets to
 * assume shape. Anything unrecognizable is dropped rather than repaired into a
 * plausible-but-wrong rule.
 */
export function normalizePlatformRules(raw: unknown): PlatformPricingRule[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: PlatformPricingRule[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const name = typeof e.name === 'string' ? e.name.trim().slice(0, 40) : '';
    if (!name) continue;
    const id = typeof e.id === 'string' && e.id.trim() ? e.id.trim().slice(0, 60) : platformSlug(name);
    if (seen.has(id)) continue;
    seen.add(id);
    const adj = (e.adjustment ?? {}) as Record<string, unknown>;
    const type: PriceAdjustmentType = adj.type === 'fixed' ? 'fixed' : 'percent';
    const rawValue = typeof adj.value === 'number' ? adj.value : parseFloat(String(adj.value ?? 0));
    const limit = type === 'percent' ? MAX_PERCENT : MAX_FIXED;
    const value = Number.isFinite(rawValue) ? Math.max(-limit, Math.min(limit, rawValue)) : 0;
    const rounding: PriceRounding =
      e.rounding === '.99' || e.rounding === 'whole' ? e.rounding : 'none';
    out.push({
      id,
      name,
      enabled: e.enabled !== false,
      adjustment: { type, value },
      rounding,
      applyToCompareAt: e.applyToCompareAt === true,
    });
  }
  return out;
}

/** The platforms offered in the Step 4 selector: the identity platform first,
 *  then every enabled configured one (an id collision with the identity
 *  platform is resolved in the stored rule's favour — the user configured it). */
export function selectablePlatforms(rules: readonly PlatformPricingRule[] | null | undefined): PlatformPricingRule[] {
  const configured = (rules ?? []).filter(r => r.enabled);
  const replacesDefault = configured.some(r => r.id === NO_ADJUSTMENT_PLATFORM.id);
  return replacesDefault ? configured : [NO_ADJUSTMENT_PLATFORM, ...configured];
}
