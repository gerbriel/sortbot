import { supabase } from './supabase';
import { log } from './debugLogger';
import { chunked, ID_CHUNK } from './chunk';
import type { PriceComp, PriceMethod } from './pricing';

/**
 * researchService — the client seam onto supabase/migrations/pricing_research.sql.
 *
 * FIVE TABLES, ONE JOB: remember what the app suggested, what a human changed it
 * to, and what the piece eventually sold for. That record is step 1 of
 * docs/pricing/00-plan.md and it comes first because it is the only part of the
 * plan that cannot be recreated later — a price engine can be rewritten next
 * month, but the corrections a seller made last month are gone unless they were
 * written down as they happened.
 *
 * FORWARD-COMPATIBLE in the house style (labelsService, brandAliasService,
 * marketplaceService, backgroundService): `researchAvailable()` probes once per
 * session, every read reports `'unavailable'` rather than throwing, and the Step
 * 3 card renders nothing when it is false. The code ships before the SQL.
 *
 * WRITES FAIL QUIET, AND THAT IS DELIBERATE — the opposite of §18 #41's rule for
 * the SAVE path. A failed `logEvents` must never surface as "Save failed" or
 * block a dictation: the seller is listing garments, not maintaining a training
 * set, and a research log that interrupts the workflow is a research log that
 * gets turned off. Everything a PERSON typed still goes through
 * `syncGroupFieldsToDatabase` and still reports into `saveStatusStore`; nothing
 * in this file is on that path.
 *
 * NO org_id IS EVER PASSED ON INSERT. The column's DEFAULT default_org_id() plus
 * the RLS with-check do that job (§18 #1, and the same rule labelsService keeps).
 */

// ── Row shapes ──────────────────────────────────────────────────────────────

export type ResearchField =
  | 'title' | 'description' | 'tags' | 'price'
  | 'era' | 'condition' | 'flaws' | 'rarity' | 'export';

export type ResearchSource = 'rules' | 'model' | 'user' | 'export';

export const RESEARCH_FIELDS: readonly ResearchField[] =
  ['title', 'description', 'tags', 'price', 'era', 'condition', 'flaws', 'rarity', 'export'];

/** One logged moment: what was suggested, or what a human corrected it to. */
export interface PricingEventInput {
  batchId?: string | null;
  productGroupId: string;
  field: ResearchField;
  /** JSON-able. The column is JSONB because `tags` is an array and `price` a number. */
  suggested?: unknown;
  corrected?: unknown;
  /** NULL means "not yet decided" — never coerce it to false (see the migration). */
  accepted?: boolean | null;
  source?: ResearchSource;
  confidence?: number | null;
}

export interface IdentificationInput {
  batchId?: string | null;
  productGroupId: string;
  era?: string | null;
  eraEvidence?: unknown[];
  condition?: string | null;
  flaws?: string[];
  rarity?: number | null;
  rarityEvidence?: unknown[];
  confidence: number;
  suggestions?: Record<string, unknown> | null;
  source?: 'rules' | 'model';
  model?: string | null;
}

export interface IdentificationRow {
  id: string;
  batch_id: string | null;
  product_group_id: string;
  era: string | null;
  era_evidence: unknown[];
  condition: string | null;
  flaws: string[];
  rarity: number | null;
  rarity_evidence: unknown[] | null;
  confidence: number;
  suggestions: Record<string, unknown> | null;
  source: string;
  model: string | null;
  reviewed: boolean;
  created_at: string;
}

export interface PriceInput {
  batchId?: string | null;
  productGroupId: string;
  /** NULL for 'insufficient'. NEVER 0 — the DB CHECK refuses it, because the
   *  export gate reads $0 as "unpriced" (see the migration header). */
  suggestedCents?: number | null;
  lowCents?: number | null;
  highCents?: number | null;
  method: PriceMethod;
  explanation?: string[];
  confidence?: number | null;
  comps?: PriceComp[];
  needsReview?: boolean;
  reviewReasons?: string[];
}

export interface PriceRow {
  id: string;
  batch_id: string | null;
  product_group_id: string;
  suggested_cents: number | null;
  low_cents: number | null;
  high_cents: number | null;
  method: PriceMethod;
  explanation: string[];
  confidence: number | null;
  comps: PriceComp[];
  needs_review: boolean;
  review_reasons: string[];
  created_at: string;
}

export interface SaleInput {
  productGroupId: string;
  sku?: string | null;
  listedPriceCents?: number | null;
  soldPriceCents: number;
  /** ISO date or timestamp. */
  listedAt?: string | null;
  soldAt?: string | null;
  marketplace?: string | null;
  externalOrderId?: string | null;
}

export interface SaleRow {
  id: string;
  product_group_id: string;
  sku: string | null;
  listed_price_cents: number | null;
  sold_price_cents: number;
  listed_at: string | null;
  sold_at: string;
  marketplace: string | null;
  source: 'manual' | 'shopify_webhook';
  external_order_id: string | null;
  created_at: string;
}

export type ResearchResult<T> = { status: 'ok'; rows: T } | { status: 'unavailable' };
export type WriteResult = { ok: true } | { ok: false; error: string };

const IDENT_COLS =
  'id, batch_id, product_group_id, era, era_evidence, condition, flaws, rarity, ' +
  'rarity_evidence, confidence, suggestions, source, model, reviewed, created_at';
const PRICE_COLS =
  'id, batch_id, product_group_id, suggested_cents, low_cents, high_cents, method, ' +
  'explanation, confidence, comps, needs_review, review_reasons, created_at';
const SALE_COLS =
  'id, product_group_id, sku, listed_price_cents, sold_price_cents, listed_at, ' +
  'sold_at, marketplace, source, external_order_id, created_at';

const errCode = (e: unknown): string => (e as { code?: string } | null)?.code ?? '';
const errMsg = (e: unknown): string => (e as { message?: string } | null)?.message ?? '';

// ── Availability ────────────────────────────────────────────────────────────

let availabilityProbe: Promise<boolean> | null = null;
let availabilityKnown = false;

/**
 * True when `pricing_research.sql` has been run. Cached for the session — the
 * answer cannot change without a migration, and every listing open asks.
 *
 * One projected row against `pricing_events`, the same shape
 * `backgroundsAvailable` and `stage4ColumnsAvailable` use. An RLS-empty result
 * is still a SUCCESS: "no rows yet" and "no table" are different answers and
 * only the second one turns the feature off.
 */
export function researchAvailable(): Promise<boolean> {
  if (!availabilityProbe) {
    availabilityProbe = Promise.resolve(
      supabase.from('pricing_events').select('id').limit(1),
    )
      .then(({ error }) => {
        if (error) {
          log.service(`research | unavailable (${errCode(error)} ${errMsg(error)}) — the feature is off`);
          return false;
        }
        availabilityKnown = true;
        return true;
      })
      .catch(() => false);
  }
  return availabilityProbe;
}

/** Synchronous view of the probe, for a render that cannot await. False until
 *  the probe resolves positively — which hides the surface, the safe way round. */
export function researchKnownAvailable(): boolean {
  return availabilityKnown;
}

/** Test hook — clears the cached probe. */
export function __resetResearchProbeForTests(): void {
  availabilityProbe = null;
  availabilityKnown = false;
}

// ── The log ─────────────────────────────────────────────────────────────────

/**
 * Append to `pricing_events`. ONE insert for the whole array.
 *
 * A run of the research card logs six or seven fields at once; one request per
 * field would be seven round trips per listing and 2,600 for a batch of 375.
 * Chunked anyway because a "log everything on export" sweep can hand this the
 * whole batch, and PostgREST answers an over-long body no better than an
 * over-long URL.
 *
 * Fails quiet on purpose — see the module header. The boolean is for tests and
 * for a caller that wants to know; nobody is shown an error.
 */
export async function logEvents(events: readonly PricingEventInput[]): Promise<boolean> {
  const rows = events
    .filter(e => e.productGroupId && RESEARCH_FIELDS.includes(e.field))
    .map(e => ({
      batch_id: e.batchId ?? null,
      product_group_id: e.productGroupId,
      field: e.field,
      suggested: e.suggested === undefined ? null : e.suggested,
      corrected: e.corrected === undefined ? null : e.corrected,
      accepted: e.accepted ?? null,
      source: e.source ?? 'rules',
      confidence: clampConfidence(e.confidence),
    }));
  if (rows.length === 0) return true;
  let ok = true;
  for (const slice of chunked(rows, ID_CHUNK)) {
    const { error } = await supabase.from('pricing_events').insert(slice);
    if (error) {
      log.service(`logEvents | ${errCode(error)} ${errMsg(error)}`);
      ok = false;
    }
  }
  return ok;
}

/** 0..1 with three decimals, or null. The DB CHECK refuses anything else. */
function clampConfidence(raw: number | null | undefined): number | null {
  if (raw === null || raw === undefined || !Number.isFinite(raw)) return null;
  return Math.round(Math.min(1, Math.max(0, raw)) * 1000) / 1000;
}

/** A positive integer number of cents, or null. Zero becomes null: the column's
 *  CHECK refuses 0 and the export gate reads it as "unpriced" anyway. */
function centsOrNull(raw: number | null | undefined): number | null {
  if (raw === null || raw === undefined || !Number.isFinite(raw)) return null;
  const n = Math.round(raw);
  return n > 0 ? n : null;
}

// ── Identification runs ─────────────────────────────────────────────────────

/**
 * One run of the identification pass. A new run is a new row; nothing updates.
 *
 * Reads the new id back in the SAME request (`.select('id')` on an insert is not
 * a second round trip), because "Mark reviewed" has to UPDATE that row and the
 * `reviewed` column is the only thing in this table a person may write. Without
 * the id there would be nothing to address, and the column would be decoration.
 */
export async function saveIdentification(
  input: IdentificationInput,
): Promise<{ ok: boolean; id?: string }> {
  if (!input.productGroupId) return { ok: false };
  const { data, error } = await supabase.from('listing_identifications').insert({
    batch_id: input.batchId ?? null,
    product_group_id: input.productGroupId,
    era: input.era ?? null,
    era_evidence: input.eraEvidence ?? [],
    condition: input.condition ?? null,
    flaws: input.flaws ?? [],
    // numeric(3,2): two decimals, 0..1.
    rarity: input.rarity === null || input.rarity === undefined || !Number.isFinite(input.rarity)
      ? null
      : Math.round(Math.min(1, Math.max(0, input.rarity)) * 100) / 100,
    rarity_evidence: input.rarityEvidence ?? null,
    confidence: clampConfidence(input.confidence) ?? 0,
    suggestions: input.suggestions ?? null,
    source: input.source ?? 'rules',
    model: input.model ?? null,
  }).select('id');
  if (error) {
    log.service(`saveIdentification | ${errCode(error)} ${errMsg(error)}`);
    return { ok: false };
  }
  const id = (data ?? [])[0] as { id?: string } | undefined;
  return { ok: true, ...(id?.id ? { id: id.id } : {}) };
}

/**
 * "I have looked at this." The ONE mutable column in `listing_identifications`,
 * and the only UPDATE this module makes.
 *
 * 0 rows updated is a FAILURE (§18 #41): that is exactly what an RLS refusal
 * looks like, and a Mark-reviewed button that silently does nothing is worse
 * than no button. This one is surfaced, unlike the fail-quiet writes above —
 * a person pressed it and is waiting.
 */
export async function markIdentificationReviewed(id: string): Promise<WriteResult> {
  const { data, error } = await supabase
    .from('listing_identifications')
    .update({ reviewed: true })
    .eq('id', id)
    .select('id');
  if (error) return { ok: false, error: errMsg(error) || 'Could not save the review.' };
  if (!data || data.length === 0) return { ok: false, error: 'No permission to mark this reviewed.' };
  return { ok: true };
}

/**
 * The newest identification run per listing.
 *
 * Ordered newest-first and reduced client-side rather than with a DISTINCT ON:
 * PostgREST cannot express one, and a per-listing request would be 375 of them.
 * The row cap is the newest 400 across the ids asked for, which for a batch's
 * worth of listings is ample and bounded.
 */
export async function fetchLatestIdentifications(
  productGroupIds: readonly string[],
): Promise<ResearchResult<Map<string, IdentificationRow>>> {
  return fetchLatestByGroup<IdentificationRow>('listing_identifications', IDENT_COLS, productGroupIds);
}

// ── Price runs ──────────────────────────────────────────────────────────────

export async function savePrice(input: PriceInput): Promise<boolean> {
  if (!input.productGroupId) return false;
  const { error } = await supabase.from('listing_prices').insert({
    batch_id: input.batchId ?? null,
    product_group_id: input.productGroupId,
    suggested_cents: centsOrNull(input.suggestedCents),
    low_cents: centsOrNull(input.lowCents),
    high_cents: centsOrNull(input.highCents),
    method: input.method,
    explanation: input.explanation ?? [],
    confidence: clampConfidence(input.confidence),
    comps: input.comps ?? [],
    needs_review: input.needsReview ?? false,
    review_reasons: input.reviewReasons ?? [],
  });
  if (error) { log.service(`savePrice | ${errCode(error)} ${errMsg(error)}`); return false; }
  return true;
}

/** The newest price run per listing — what Step 4's review split reads. */
export async function fetchLatestPrices(
  productGroupIds: readonly string[],
): Promise<ResearchResult<Map<string, PriceRow>>> {
  return fetchLatestByGroup<PriceRow>('listing_prices', PRICE_COLS, productGroupIds);
}

/**
 * Shared "newest row per listing" read. Chunked at ID_CHUNK (PostgREST answers a
 * long `in()` URL with a 400/414 — §11), row-capped, and NO `user_id`/`org_id`
 * filter: RLS scopes it (§18 #1).
 */
async function fetchLatestByGroup<T extends { product_group_id: string }>(
  table: string,
  columns: string,
  productGroupIds: readonly string[],
): Promise<ResearchResult<Map<string, T>>> {
  const ids = [...new Set(productGroupIds.filter(Boolean))];
  const out = new Map<string, T>();
  if (ids.length === 0) return { status: 'ok', rows: out };
  for (const slice of chunked(ids, ID_CHUNK)) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .in('product_group_id', slice)
      .order('created_at', { ascending: false })
      .limit(400);
    if (error) {
      log.service(`fetchLatest ${table} | unavailable (${errCode(error)} ${errMsg(error)})`);
      return { status: 'unavailable' };
    }
    // Newest first, so the FIRST row seen for a listing is the current answer.
    for (const row of (data ?? []) as unknown as T[]) {
      if (!out.has(row.product_group_id)) out.set(row.product_group_id, row);
    }
  }
  return { status: 'ok', rows: out };
}

// ── Sales — the feedback loop ───────────────────────────────────────────────

/**
 * Record a sale. The manual half of plan step 6; the Shopify webhook writes the
 * same row with `source = 'shopify_webhook'` later.
 *
 * Validated here rather than relying on the CHECKs, because this one IS shown to
 * a person: they typed a price into a form and a constraint name is not an
 * answer. 23505 is translated too — the unique index is an EXPRESSION index
 * (`coalesce(external_order_id, '')`), which PostgREST cannot address with
 * `onConflict`, so an insert-and-report is the only shape available (the same
 * reasoning as `brandAliasService.saveBrandAlias`).
 */
export async function recordSale(input: SaleInput): Promise<WriteResult> {
  if (!input.productGroupId) return { ok: false, error: 'No listing to record a sale against.' };
  const cents = Math.round(input.soldPriceCents);
  if (!Number.isFinite(cents) || cents <= 0) {
    return { ok: false, error: 'Enter what it sold for.' };
  }
  if (cents > 100_000_000_000) {
    return { ok: false, error: 'That sold price is out of range.' };
  }
  const listed = centsOrNull(input.listedPriceCents);
  const soldAt = (input.soldAt ?? '').trim() || null;
  const listedAt = (input.listedAt ?? '').trim() || null;
  if (listedAt && soldAt && listedAt > soldAt) {
    return { ok: false, error: 'It cannot have sold before it was listed.' };
  }
  const { error } = await supabase.from('listing_sales').insert({
    product_group_id: input.productGroupId,
    sku: (input.sku ?? '').trim() || null,
    listed_price_cents: listed,
    sold_price_cents: cents,
    listed_at: listedAt,
    ...(soldAt ? { sold_at: soldAt } : {}),   // omitted → the column's now() default
    marketplace: (input.marketplace ?? '').trim() || null,
    source: 'manual' as const,
    external_order_id: (input.externalOrderId ?? '').trim() || null,
  });
  if (error) {
    if (errCode(error) === '23505') {
      return {
        ok: false,
        error: input.externalOrderId?.trim()
          ? 'That order is already recorded for this listing.'
          : 'This listing is already marked sold. Add the order number to record a second sale.',
      };
    }
    if (errCode(error) === '42P01' || errCode(error) === 'PGRST205') {
      return { ok: false, error: 'Sales need the pricing_research migration to be run first.' };
    }
    return { ok: false, error: errMsg(error) || 'Could not record the sale.' };
  }
  return { ok: true };
}

/** Every sale for these listings, newest first. Grouped by listing. */
export async function fetchSales(
  productGroupIds: readonly string[],
): Promise<ResearchResult<Map<string, SaleRow[]>>> {
  const ids = [...new Set(productGroupIds.filter(Boolean))];
  const out = new Map<string, SaleRow[]>();
  if (ids.length === 0) return { status: 'ok', rows: out };
  for (const slice of chunked(ids, ID_CHUNK)) {
    const { data, error } = await supabase
      .from('listing_sales')
      .select(SALE_COLS)
      .in('product_group_id', slice)
      .order('sold_at', { ascending: false });
    if (error) {
      log.service(`fetchSales | unavailable (${errCode(error)} ${errMsg(error)})`);
      return { status: 'unavailable' };
    }
    for (const row of (data ?? []) as unknown as SaleRow[]) {
      const list = out.get(row.product_group_id);
      if (list) list.push(row); else out.set(row.product_group_id, [row]);
    }
  }
  return { status: 'ok', rows: out };
}

export async function deleteSale(id: string): Promise<WriteResult> {
  const { data, error } = await supabase
    .from('listing_sales').delete().eq('id', id).select('id');
  if (error) return { ok: false, error: errMsg(error) || 'Could not remove the sale.' };
  if (!data || data.length === 0) return { ok: false, error: 'No permission to remove that sale.' };
  return { ok: true };
}

/**
 * PURE. Days between listing and sale, or null when either date is missing.
 *
 * Computed at read time and never stored (the migration says so): `days_to_sell`
 * would be a third value that can disagree with the two it comes from.
 */
export function daysToSell(row: Pick<SaleRow, 'listed_at' | 'sold_at'>): number | null {
  if (!row.listed_at || !row.sold_at) return null;
  const a = Date.parse(row.listed_at);
  const b = Date.parse(row.sold_at);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
  return Math.round((b - a) / 86_400_000);
}

// ── The first comps source: the workspace's own sold history ────────────────

export interface OwnCompsQuery {
  brand?: string | null;
  category?: string | null;
  era?: string | null;
  productType?: string | null;
  /** Never propose the listing being priced as a comparable for itself. */
  excludeGroupId?: string | null;
}

/** How many of the shop's own sales are worth reading for one listing. */
const OWN_COMPS_LIMIT = 40;

/**
 * The shop's own sold comps for one listing — plan step 4's FREE source, and the
 * only one that exists before a key.
 *
 * TWO READS, DELIBERATELY. `listing_sales.product_group_id` is not a foreign key
 * (see the migration header — a sale must outlive its leader row), so there is
 * no PostgREST embed to use. The shape is therefore: find the workspace's
 * `products` leader rows that look like this garment, then read the sales for
 * those listings.
 *
 * MATCHING NARROWS IN THREE STEPS and stops at the first that finds anything:
 *   1. brand + category   — the same label, the same kind of garment
 *   2. category + era     — no brand match, but a 1990s tee is still a comp
 *   3. category           — the loosest thing still worth calling a comparable
 * A fourth step of "everything the shop ever sold" was considered and rejected:
 * the median of a whole inventory is not a comparable, it is an average price,
 * and presenting it as a comp would be the model naming a number by another
 * route. `insufficient` is the honest answer instead.
 *
 * `era` is matched on `product_category` + the products row's own era only when
 * the column exists in the projection; it is read from `products.era` if
 * present, otherwise step 2 degrades to step 3 — this is one reason the steps
 * are ordered loosest-last rather than combined into one `or()`.
 */
export async function fetchOwnComps(q: OwnCompsQuery): Promise<ResearchResult<PriceComp[]>> {
  const brand = (q.brand ?? '').trim();
  const category = (q.category ?? q.productType ?? '').trim();
  const era = (q.era ?? '').trim();
  if (!brand && !category) return { status: 'ok', rows: [] };

  interface Leader { id: string; product_group: string | null; price: number | null; era: string | null }

  /** One narrowing step: the columns to match, loosest step last. */
  type Step = ReadonlyArray<readonly [column: 'vendor' | 'product_category' | 'era', value: string]>;
  const steps: Step[] = [];
  if (brand && category) steps.push([['vendor', brand], ['product_category', category]]);
  if (category && era)   steps.push([['product_category', category], ['era', era]]);
  if (category)          steps.push([['product_category', category]]);
  else if (brand)        steps.push([['vendor', brand]]);

  let groupIds: string[] = [];
  const leadersByGroup = new Map<string, Leader>();
  for (const step of steps) {
    // No user_id / org_id filter — RLS scopes it (§18 #1). Row-capped: a shop
    // with thousands of tees does not need all of them to price one.
    let query = supabase.from('products').select('id, product_group, price, era').limit(500);
    for (const [column, value] of step) query = query.ilike(column, value);
    const { data, error } = await query;
    if (error) {
      log.service(`fetchOwnComps | unavailable (${errCode(error)} ${errMsg(error)})`);
      return { status: 'unavailable' };
    }
    const found = new Map<string, Leader>();
    for (const row of (data ?? []) as unknown as Leader[]) {
      const gid = row.product_group || row.id;
      if (!gid || gid === q.excludeGroupId) continue;
      if (!found.has(gid)) found.set(gid, row);
    }
    if (found.size > 0) {
      for (const [gid, row] of found) leadersByGroup.set(gid, row);
      groupIds = [...found.keys()];
      break;
    }
  }
  if (groupIds.length === 0) return { status: 'ok', rows: [] };

  const sales = await fetchSales(groupIds);
  if (sales.status !== 'ok') return { status: 'unavailable' };

  const comps: PriceComp[] = [];
  for (const [gid, rows] of sales.rows) {
    const leaderPrice = leadersByGroup.get(gid)?.price;
    for (const row of rows) {
      const listed = row.listed_price_cents
        ?? (leaderPrice != null ? Math.round(Number(leaderPrice) * 100) : null);
      const days = daysToSell(row);
      const note = [
        row.marketplace ? `sold on ${row.marketplace}` : '',
        days !== null ? `${days} day${days === 1 ? '' : 's'} to sell` : '',
        listed && listed !== row.sold_price_cents ? `listed at $${(listed / 100).toFixed(2)}` : '',
      ].filter(Boolean).join(' \u00b7 ');
      comps.push({
        kind: 'sold',              // a recorded sale is never an asking price
        source: 'own_sales',
        price_cents: row.sold_price_cents,
        sold_at: row.sold_at,
        ...(note ? { note } : {}),
      });
    }
  }
  comps.sort((a, b) => (b.sold_at ?? '').localeCompare(a.sold_at ?? ''));
  return { status: 'ok', rows: comps.slice(0, OWN_COMPS_LIMIT) };
}

// ── The comps cache (the seam for the paid sources) ─────────────────────────

/**
 * Read a cached comps set. NOTHING WRITES THIS TABLE YET — the eBay Browse API
 * and web search arrive with a key (plan step 4). The read exists now so the
 * price engine's "cheapest first" order is already in place, and so the cache's
 * shape is settled before the first paid call is ever made.
 *
 * `expires_at > now()` is applied in the QUERY, not after: a stale row must
 * never reach the price engine, and filtering client-side is how it eventually
 * would.
 */
export async function fetchCachedComps(
  queryKey: string,
  source: 'ebay_active' | 'web_sold' | 'own_sales',
): Promise<ResearchResult<PriceComp[] | null>> {
  const key = queryKey.trim();
  if (!key) return { status: 'ok', rows: null };
  const { data, error } = await supabase
    .from('price_comps_cache')
    .select('comps, expires_at')
    .eq('query_key', key)
    .eq('source', source)
    .gt('expires_at', new Date().toISOString())
    .limit(1);
  if (error) {
    log.service(`fetchCachedComps | unavailable (${errCode(error)} ${errMsg(error)})`);
    return { status: 'unavailable' };
  }
  const row = (data ?? [])[0] as { comps?: PriceComp[] } | undefined;
  return { status: 'ok', rows: row?.comps ?? null };
}

/**
 * PURE. The cache key for a listing.
 *
 * ONE SEARCH PER DESIGN, NOT PER ITEM — the plan's own rule. Two identical tees
 * shot on the same day must produce the same key, so size and condition are
 * deliberately NOT in it: they change the price, which the engine adjusts for,
 * but they do not change what the comps for the design are.
 */
export function compsQueryKey(parts: {
  brand?: string | null;
  productType?: string | null;
  category?: string | null;
  modelName?: string | null;
  era?: string | null;
}): string {
  const bits = [
    parts.brand, parts.modelName, parts.productType ?? parts.category, parts.era,
  ]
    .map(s => (s ?? '').trim().toLowerCase().replace(/\s+/g, ' '))
    .filter(Boolean);
  return bits.join('|').slice(0, 200);
}
