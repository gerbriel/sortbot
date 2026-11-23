import { supabase } from './supabase';
import { log } from './debugLogger';
import { chunked } from './chunk';
import { DEFAULT_GENERATED_SKU_PATTERN, generateSkuBody, isGeneratedSku, skuLookupCandidates } from './barcode';
import {
  DEFAULT_CODE_SETTINGS, barcodeFor, formatSku, generatedSkuPattern, isValidEan13, sequentialBody,
  type CodeSettings,
} from './codeSettings';

/**
 * labelsService — colour/word/vendor labels on listings, and the SKU a label's
 * barcode encodes.
 *
 * Backed by supabase/migrations/053_listing_labels.sql. FORWARD-COMPATIBLE in the
 * house style: every read reports `unavailable` when the migration has not been
 * run, and the UI hides itself rather than showing an error to a user who has
 * done nothing wrong. Shipping the code before the SQL is the normal order here
 * (see shopifyConnectionService, betaService, imageRowSync).
 *
 * NO org_id IS EVER PASSED ON INSERT. The column's DEFAULT default_org_id()
 * plus the RLS with-check do that job; a client that chose its own org_id would
 * be a client that could choose the WRONG one.
 */

export type LabelKind = 'vendor' | 'custom';

export interface ListingLabel {
  id: string;
  name: string;
  /** A palette NAME (see LABEL_COLORS) — never a hex, never CSS. */
  color: string;
  kind: LabelKind;
  sort_order: number;
}

/** product_id → the labels applied to it. */
export type LabelsByProduct = Record<string, ListingLabel[]>;

/**
 * THE PALETTE — the client is the authority on which colours exist (the DB
 * checks only that the stored value is a short lowercase slug; see the
 * migration header). Values are literal hex rather than `--ink-*` tokens for
 * one reason: these chips are PRINTED. A print stylesheet cannot rely on a
 * themed token resolving, and a label that comes out of a thermal printer as
 * the same grey as its neighbour is not a label. Screen and sheet therefore
 * show the identical swatch.
 *
 * `fg` is chosen per swatch for contrast on the chip, not derived, so each pair
 * can be eyeballed once and stay right.
 */
export const LABEL_COLORS: ReadonlyArray<{ name: string; label: string; bg: string; fg: string }> = [
  { name: 'slate',  label: 'Slate',  bg: '#e4e6ea', fg: '#22252b' },
  { name: 'red',    label: 'Red',    bg: '#ffd9dd', fg: '#7a0014' },
  { name: 'orange', label: 'Orange', bg: '#ffe2cc', fg: '#7a3800' },
  { name: 'amber',  label: 'Amber',  bg: '#fdefc4', fg: '#6b4a00' },
  { name: 'green',  label: 'Green',  bg: '#d3f2df', fg: '#065f36' },
  { name: 'teal',   label: 'Teal',   bg: '#cdefee', fg: '#04564f' },
  { name: 'blue',   label: 'Blue',   bg: '#d7e6ff', fg: '#0b3d8c' },
  { name: 'indigo', label: 'Indigo', bg: '#e0dcff', fg: '#2f2482' },
  { name: 'violet', label: 'Violet', bg: '#eedcfb', fg: '#57177f' },
  { name: 'pink',   label: 'Pink',   bg: '#ffdcee', fg: '#7d0f4c' },
  { name: 'brown',  label: 'Brown',  bg: '#e8ddd0', fg: '#4e3520' },
  { name: 'black',  label: 'Black',  bg: '#1c1c1c', fg: '#ffffff' },
];

const FALLBACK_SWATCH = LABEL_COLORS[0];

/** Chip colours for a stored palette name. An unknown name (older build, hand
 *  edit) renders neutral instead of breaking the row. */
export function labelSwatch(color: string | null | undefined): { bg: string; fg: string } {
  const hit = LABEL_COLORS.find(c => c.name === color);
  return hit ? { bg: hit.bg, fg: hit.fg } : { bg: FALLBACK_SWATCH.bg, fg: FALLBACK_SWATCH.fg };
}

/**
 * Picker/print order: VENDOR labels first (a reseller reaches for "where did
 * this come from" on every single listing), then the workspace's own sort
 * order, then alphabetical so the list never reshuffles between renders.
 */
export function sortLabels(labels: readonly ListingLabel[]): ListingLabel[] {
  return [...labels].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'vendor' ? -1 : 1;
    if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
    return a.name.localeCompare(b.name, undefined, { numeric: true });
  });
}

export const LABEL_NAME_MAX = 40;

/** Table missing (migration not run) or the column set is older than this code. */
function isMissingSchema(error: { code?: string | null } | null): boolean {
  return error?.code === '42P01' || error?.code === '42703' || error?.code === 'PGRST205';
}

export type LabelsResult =
  | { status: 'ok'; labels: ListingLabel[] }
  | { status: 'unavailable' };

const LABEL_COLUMNS = 'id, name, color, kind, sort_order';

/** Every label this workspace has defined, in picker order. */
export async function fetchLabels(): Promise<LabelsResult> {
  try {
    const { data, error } = await supabase
      .from('listing_labels')
      .select(LABEL_COLUMNS)
      .order('sort_order', { ascending: true });
    if (error) {
      log.service(`fetchLabels | unavailable (${error.code ?? ''} ${error.message})`);
      return { status: 'unavailable' };
    }
    return { status: 'ok', labels: sortLabels((data ?? []) as ListingLabel[]) };
  } catch (err) {
    log.error(`fetchLabels | unexpected: ${String(err)}`);
    return { status: 'unavailable' };
  }
}

export async function createLabel(
  name: string, color: string, kind: LabelKind,
): Promise<{ ok: true; label: ListingLabel } | { ok: false; error: string }> {
  const clean = name.trim().slice(0, LABEL_NAME_MAX);
  if (!clean) return { ok: false, error: 'Give the label a name.' };
  const swatch = LABEL_COLORS.find(c => c.name === color)?.name ?? FALLBACK_SWATCH.name;
  // org_id is deliberately absent — the column default owns it.
  const { data, error } = await supabase
    .from('listing_labels')
    .insert({ name: clean, color: swatch, kind })
    .select(LABEL_COLUMNS)
    .single();
  if (error) {
    if (error.code === '23505') return { ok: false, error: `"${clean}" already exists.` };
    if (isMissingSchema(error)) return { ok: false, error: 'The labels migration has not been run yet.' };
    log.error(`createLabel | ${error.message}`);
    return { ok: false, error: error.message };
  }
  return { ok: true, label: data as ListingLabel };
}

export async function updateLabel(
  id: string, patch: Partial<Pick<ListingLabel, 'name' | 'color' | 'kind' | 'sort_order'>>,
): Promise<{ ok: boolean; error?: string }> {
  const body: Record<string, unknown> = {};
  if (patch.name !== undefined) {
    const clean = patch.name.trim().slice(0, LABEL_NAME_MAX);
    if (!clean) return { ok: false, error: 'Give the label a name.' };
    body.name = clean;
  }
  if (patch.color !== undefined) {
    body.color = LABEL_COLORS.find(c => c.name === patch.color)?.name ?? FALLBACK_SWATCH.name;
  }
  if (patch.kind !== undefined) body.kind = patch.kind;
  if (patch.sort_order !== undefined) body.sort_order = patch.sort_order;
  if (Object.keys(body).length === 0) return { ok: true };

  const { data, error } = await supabase.from('listing_labels').update(body).eq('id', id).select('id');
  if (error) {
    if (error.code === '23505') return { ok: false, error: 'Another label already has that name.' };
    return { ok: false, error: error.message };
  }
  if (!data || data.length === 0) return { ok: false, error: 'That label is not in this workspace.' };
  return { ok: true };
}

/** Deleting a label removes it from every listing (product_labels cascades). */
export async function deleteLabel(id: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from('listing_labels').delete().eq('id', id);
  return error ? { ok: false, error: error.message } : { ok: true };
}

/**
 * Labels for a set of products, chunked so a whole batch's worth of ids cannot
 * blow the PostgREST URL-length limit (chunk.ts, AGENTS.md §11).
 */
export async function fetchLabelsForProducts(
  productIds: readonly string[],
): Promise<{ status: 'ok'; byProduct: LabelsByProduct } | { status: 'unavailable' }> {
  const ids = [...new Set(productIds.filter(Boolean))];
  if (ids.length === 0) return { status: 'ok', byProduct: {} };
  const byProduct: LabelsByProduct = {};
  try {
    for (const batch of chunked(ids)) {
      const { data, error } = await supabase
        .from('product_labels')
        .select(`product_id, listing_labels ( ${LABEL_COLUMNS} )`)
        .in('product_id', batch);
      if (error) {
        log.service(`fetchLabelsForProducts | unavailable (${error.code ?? ''} ${error.message})`);
        return { status: 'unavailable' };
      }
      for (const row of (data ?? []) as Array<{ product_id: string; listing_labels: ListingLabel | ListingLabel[] | null }>) {
        // PostgREST returns an embedded to-one relation as an object; some
        // versions return a one-element array. Tolerate both.
        const rel = row.listing_labels;
        const labels = Array.isArray(rel) ? rel : rel ? [rel] : [];
        if (labels.length === 0) continue;
        (byProduct[row.product_id] ??= []).push(...labels);
      }
    }
    for (const id of Object.keys(byProduct)) byProduct[id] = sortLabels(byProduct[id]);
    return { status: 'ok', byProduct };
  } catch (err) {
    log.error(`fetchLabelsForProducts | unexpected: ${String(err)}`);
    return { status: 'unavailable' };
  }
}

/**
 * Apply a label to one or more products.
 *
 * `ignoreDuplicates` because the composite primary key already guarantees
 * at-most-once: two people tagging the same listing at the same moment, or a
 * double-tap on a phone, should be a no-op rather than a 409 the user has to
 * read. Same reasoning as the product_images upsert (AGENTS.md §13).
 */
export async function assignLabel(
  productIds: readonly string[], labelId: string,
): Promise<{ ok: boolean; error?: string }> {
  const ids = [...new Set(productIds.filter(Boolean))];
  if (ids.length === 0) return { ok: true };
  for (const batch of chunked(ids)) {
    const { error } = await supabase
      .from('product_labels')
      .upsert(batch.map(product_id => ({ product_id, label_id: labelId })),
        { onConflict: 'product_id,label_id', ignoreDuplicates: true });
    if (error) {
      if (isMissingSchema(error)) return { ok: false, error: 'The labels migration has not been run yet.' };
      log.error(`assignLabel | ${error.message}`);
      return { ok: false, error: error.message };
    }
  }
  return { ok: true };
}

export async function unassignLabel(
  productIds: readonly string[], labelId: string,
): Promise<{ ok: boolean; error?: string }> {
  const ids = [...new Set(productIds.filter(Boolean))];
  if (ids.length === 0) return { ok: true };
  for (const batch of chunked(ids)) {
    const { error } = await supabase
      .from('product_labels')
      .delete()
      .eq('label_id', labelId)
      .in('product_id', batch);
    if (error) {
      log.error(`unassignLabel | ${error.message}`);
      return { ok: false, error: error.message };
    }
  }
  return { ok: true };
}

/**
 * How many LISTINGS each label is on.
 *
 * Listings, not photos: a listing's photos are separate `products` rows (§7),
 * so counting `product_labels` rows would tell a founder that a four-photo
 * jacket used a label four times. The embed pulls each assignment's product
 * group and the distinct groups are counted, which is the number the picker and
 * the Manage-labels list actually mean.
 *
 * PAGINATED. PostgREST truncates at 1,000 rows with no error (§18 #23), and a
 * workspace that labels everything crosses that in one season — an undercount
 * here would quietly turn "used on 1,400 listings" into a delete that looked
 * safe. MAX_PAGES bounds the walk; `complete` says whether it finished, so the
 * UI can decline to claim a number it did not finish counting.
 */
const USAGE_PAGE = 1000;
const USAGE_MAX_PAGES = 30;

export type LabelUsageResult =
  | { status: 'ok'; counts: Record<string, number>; complete: boolean }
  | { status: 'unavailable' };

export async function countLabelUsage(): Promise<LabelUsageResult> {
  const groupsByLabel = new Map<string, Set<string>>();
  try {
    let page = 0;
    let complete = true;
    for (; page < USAGE_MAX_PAGES; page++) {
      const from = page * USAGE_PAGE;
      const { data, error } = await supabase
        .from('product_labels')
        .select('label_id, products ( id, product_group )')
        .range(from, from + USAGE_PAGE - 1);
      if (error) {
        log.service(`countLabelUsage | unavailable (${error.code ?? ''} ${error.message})`);
        return { status: 'unavailable' };
      }
      const rows = (data ?? []) as Array<{
        label_id: string;
        products: { id?: string; product_group?: string | null } | Array<{ id?: string; product_group?: string | null }> | null;
      }>;
      for (const row of rows) {
        // PostgREST returns a to-one embed as an object; some versions return a
        // one-element array. Tolerate both, as fetchLabelsForProducts does.
        const rel = row.products;
        const product = Array.isArray(rel) ? rel[0] : rel;
        const key = (product?.product_group || product?.id || '').trim();
        if (!key) continue;
        let set = groupsByLabel.get(row.label_id);
        if (!set) { set = new Set(); groupsByLabel.set(row.label_id, set); }
        set.add(key);
      }
      if (rows.length < USAGE_PAGE) break;
      if (page === USAGE_MAX_PAGES - 1) complete = false;
    }
    const counts: Record<string, number> = {};
    for (const [labelId, set] of groupsByLabel) counts[labelId] = set.size;
    return { status: 'ok', counts, complete };
  } catch (err) {
    log.error(`countLabelUsage | unexpected: ${String(err)}`);
    return { status: 'unavailable' };
  }
}

// ── SKUs ────────────────────────────────────────────────────────────────────

/** How many fresh codes to try before giving up on a collision. At 32⁶ codes
 *  per workspace, reaching 2 is already astronomically unlikely; 6 exists so a
 *  genuinely broken RNG surfaces as an error instead of an infinite loop. The
 *  sequential scheme spends the same budget: each 23505 there means a person
 *  typed that number by hand, and the next number is drawn from the database. */
const SKU_ATTEMPTS = 6;

/** `next_code_numbers` (073) hands out at most this many per call. */
export const CODE_NUMBERS_MAX = 500;

export type SkuAssignment = { status: 'ok'; skus: Record<string, string> }
  | { status: 'unavailable' }
  | { status: 'error'; error: string };

export interface EnsureSkusOptions {
  /** The workspace's conventions (`description_settings.codes`). Default:
   *  DEFAULT_CODE_SETTINGS, the behaviour before conventions existed. */
  settings?: CodeSettings;
  /** The workspace the listings belong to. Required when a number comes from
   *  the database (scheme 'sequential' or barcode 'ean13_store'). */
  orgId?: string;
  /** productId -> category, for the category code. A listing missing here
   *  falls back to its row's `product_category`. */
  categories?: Record<string, string | null>;
}

/** Does this convention need numbers from `next_code_numbers`? */
function needsCounter(s: CodeSettings): boolean {
  return s.skuScheme === 'sequential' || s.barcodeMode === 'ean13_store';
}

/** RPC missing (073 not run): PostgREST says PGRST202, Postgres 42883. */
function isMissingFunction(error: { code?: string | null } | null): boolean {
  return error?.code === 'PGRST202' || error?.code === '42883';
}

type NumbersResult = { ok: true; numbers: number[] } | { ok: false; error: string };

/**
 * `count` consecutive numbers from the workspace counter. The database is the
 * only source (AGENTS.md section 18): two people assigning at once never draw
 * the same number, and the client never computes max + 1. Calls in slices of
 * CODE_NUMBERS_MAX, the function's own bound.
 */
async function drawCodeNumbers(orgId: string, count: number): Promise<NumbersResult> {
  const numbers: number[] = [];
  for (let left = count; left > 0; left -= CODE_NUMBERS_MAX) {
    const take = Math.min(left, CODE_NUMBERS_MAX);
    const { data, error } = await supabase.rpc('next_code_numbers', { p_org: orgId, p_count: take });
    if (error) {
      if (isMissingFunction(error)) {
        return { ok: false, error: 'Numbered codes need the 073_code_sequences.sql migration, which has not been run yet.' };
      }
      if (error.code === '42501') return { ok: false, error: 'Only members of this workspace can assign its codes.' };
      log.error(`drawCodeNumbers | ${error.message}`);
      return { ok: false, error: error.message };
    }
    const rows = (Array.isArray(data) ? data : []) as Array<{ n: number | string }>;
    const got = rows.map(r => Number(r.n)).filter(n => Number.isSafeInteger(n) && n > 0);
    if (got.length !== take) return { ok: false, error: 'The workspace counter answered with the wrong count. Try again.' };
    numbers.push(...got);
  }
  return { ok: true, numbers };
}

/** A barcode already on the row that is safe to replace: empty, or one this
 *  app generated (a generated SKU under either the default or the current
 *  convention, or a GS1 in-store number). A manufacturer barcode someone typed
 *  is never overwritten. */
function barcodeIsReplaceable(existing: string | null | undefined, s: CodeSettings): boolean {
  const b = (existing ?? '').trim();
  if (!b) return true;
  if (isGeneratedSku(b, DEFAULT_GENERATED_SKU_PATTERN) || isGeneratedSku(b, generatedSkuPattern(s))) return true;
  return /^2\d{12}$/.test(b) && isValidEan13(b);
}

/**
 * Make sure each of `productIds` has a SKU, minting one where it is missing,
 * under the workspace's conventions (`opts.settings`, codeSettings.ts).
 *
 * Existing SKUs are never overwritten: a SKU that is already on a printed
 * label, in a spreadsheet, or in someone's Shopify catalogue is not ours to
 * change. Returns the SKU for every requested product (old or new).
 *
 * THE BODY. Scheme 'random': a Crockford body per listing, retried on 23505.
 * Scheme 'sequential': ONE `next_code_numbers` call for every listing that
 * needs a code, then each gets `formatSku(settings, sequentialBody(n))`; a
 * 23505 (someone typed that SKU by hand) draws the next number with another
 * call, under the same attempt budget.
 *
 * THE BARCODE. `barcodeFor(settings, sku, n)`: mode 'sku' mirrors the SKU (the
 * pre-conventions behaviour), 'ean13_store' writes a GS1 in-store EAN-13 from
 * the SAME number as a sequential body (one number per listing serves both;
 * under the random scheme the number is drawn only for the barcode), and
 * 'manual' never writes the barcode column. A barcode a person typed is kept
 * (`barcodeIsReplaceable`).
 *
 * UNIQUENESS IS THE DATABASE'S JOB. `products_org_sku_uidx` is the authority;
 * this loop just retries on 23505. Checking "is it taken?" with a SELECT first
 * would be a race, not a check.
 */
export async function ensureSkus(productIds: readonly string[], opts: EnsureSkusOptions = {}): Promise<SkuAssignment> {
  const settings = opts.settings ?? DEFAULT_CODE_SETTINGS;
  const ids = [...new Set(productIds.filter(Boolean))];
  if (ids.length === 0) return { status: 'ok', skus: {} };

  const skus: Record<string, string> = {};
  const needed: Array<{ id: string; barcode: string | null; category: string | null }> = [];
  const columns = settings.categoryCode ? 'id, sku, barcode, product_category' : 'id, sku, barcode';
  try {
    for (const batch of chunked(ids)) {
      const { data, error } = await supabase.from('products').select(columns).in('id', batch);
      if (error) {
        if (isMissingSchema(error)) return { status: 'unavailable' };
        return { status: 'error', error: error.message };
      }
      for (const row of (data ?? []) as unknown as Array<{ id: string; sku: string | null; barcode?: string | null; product_category?: string | null }>) {
        if (row.sku && row.sku.trim()) { skus[row.id] = row.sku.trim(); continue; }
        const category = opts.categories && row.id in opts.categories
          ? opts.categories[row.id] ?? null
          : row.product_category ?? null;
        needed.push({ id: row.id, barcode: row.barcode ?? null, category });
      }
    }
  } catch (err) {
    log.error(`ensureSkus | unexpected: ${String(err)}`);
    return { status: 'error', error: String(err) };
  }
  if (needed.length === 0) return { status: 'ok', skus };

  let counters: number[] = [];
  if (needsCounter(settings)) {
    if (!opts.orgId) return { status: 'error', error: 'Which workspace are these listings in?' };
    const drawn = await drawCodeNumbers(opts.orgId, needed.length);
    if (!drawn.ok) return { status: 'error', error: drawn.error };
    counters = drawn.numbers;
  }

  for (let i = 0; i < needed.length; i++) {
    const { id, barcode: existingBarcode, category } = needed[i];
    let counter: number | undefined = counters[i];
    let assigned = '';
    for (let attempt = 0; attempt < SKU_ATTEMPTS && !assigned; attempt++) {
      if (attempt > 0 && settings.skuScheme === 'sequential') {
        // The number collided with a hand-typed SKU: draw a fresh one.
        const next = await drawCodeNumbers(opts.orgId as string, 1);
        if (!next.ok) return { status: 'error', error: next.error };
        counter = next.numbers[0];
      }
      const body = settings.skuScheme === 'sequential'
        ? sequentialBody(settings, counter as number)
        : generateSkuBody();
      const candidate = formatSku(settings, { body, category });
      const patch: Record<string, string> = { sku: candidate };
      const barcode = barcodeFor(settings, candidate, counter);
      if (barcode !== undefined && barcodeIsReplaceable(existingBarcode, settings)) patch.barcode = barcode;
      const { data, error } = await supabase
        .from('products')
        .update(patch)
        .eq('id', id)
        .select('id');
      if (error) {
        if (error.code === '23505') continue;             // collision: draw again
        if (isMissingSchema(error)) return { status: 'unavailable' };
        return { status: 'error', error: error.message };
      }
      if (!data || data.length === 0) {
        return { status: 'error', error: 'That listing is not in this workspace.' };
      }
      assigned = candidate;
    }
    if (!assigned) return { status: 'error', error: 'Could not generate a unique SKU. Try again.' };
    skus[id] = assigned;
  }

  return { status: 'ok', skus };
}

// ── Listings with no code yet ───────────────────────────────────────────────

const MISSING_PAGE = 1000;
const MISSING_MAX_PAGES = 50;

type MissingLeaders =
  | { status: 'ok'; ids: string[]; categories: Record<string, string | null> }
  | { status: 'unavailable' }
  | { status: 'error'; error: string };

/**
 * Every LEADER row in the workspace with no SKU (a listing's photos are
 * separate rows; the leader is the one the scanner and the label read, §11).
 * Paginated 1000 a page (PostgREST truncates silently, §18 #23), projected,
 * RLS-scoped, and narrowed to `orgId` so a person in two workspaces never
 * numbers one workspace's listings under the other's convention. A leader is
 * a row with no `product_group` or whose `product_group` is its own id; a
 * legacy group with no leader row is left for its Products page.
 */
async function listMissingCodeLeaders(orgId: string): Promise<MissingLeaders> {
  const ids: string[] = [];
  const categories: Record<string, string | null> = {};
  try {
    for (let page = 0; page < MISSING_MAX_PAGES; page++) {
      const from = page * MISSING_PAGE;
      const { data, error } = await supabase
        .from('products')
        .select('id, product_group, product_category')
        .eq('org_id', orgId)
        .is('sku', null)
        .order('id', { ascending: true })
        .range(from, from + MISSING_PAGE - 1);
      if (error) {
        if (isMissingSchema(error)) return { status: 'unavailable' };
        log.error(`listMissingCodeLeaders | ${error.message}`);
        return { status: 'error', error: error.message };
      }
      const rows = (data ?? []) as Array<{ id: string; product_group: string | null; product_category: string | null }>;
      for (const r of rows) {
        const group = (r.product_group ?? '').trim();
        if (group && group !== r.id) continue;
        ids.push(r.id);
        categories[r.id] = r.product_category ?? null;
      }
      if (rows.length < MISSING_PAGE) break;
    }
    return { status: 'ok', ids, categories };
  } catch (err) {
    log.error(`listMissingCodeLeaders | unexpected: ${String(err)}`);
    return { status: 'error', error: String(err) };
  }
}

export type MissingCodesCount =
  | { status: 'ok'; count: number }
  | { status: 'unavailable' }
  | { status: 'error'; error: string };

/** How many listings in the workspace have no SKU yet (for the confirm copy
 *  of "Assign codes to listings without one"). */
export async function countMissingCodes(orgId: string): Promise<MissingCodesCount> {
  const res = await listMissingCodeLeaders(orgId);
  return res.status === 'ok' ? { status: 'ok', count: res.ids.length } : res;
}

export type RegenerateResult =
  | { status: 'ok'; assigned: number }
  | { status: 'unavailable' }
  | { status: 'error'; error: string };

/**
 * "Assign codes to listings without one": every leader in the workspace with
 * no SKU gets one under `settings`, through `ensureSkus` (so the same
 * retries, the same counter and the same never-overwrite rule apply). The ids
 * are collected FIRST: paging over `sku is null` while writing SKUs would
 * shift the pages under the walk.
 */
export async function regenerateMissingCodes(orgId: string, settings: CodeSettings): Promise<RegenerateResult> {
  const missing = await listMissingCodeLeaders(orgId);
  if (missing.status !== 'ok') return missing;
  if (missing.ids.length === 0) return { status: 'ok', assigned: 0 };
  const res = await ensureSkus(missing.ids, { settings, orgId, categories: missing.categories });
  if (res.status !== 'ok') return res;
  return { status: 'ok', assigned: missing.ids.filter(id => res.skus[id]).length };
}

export type CodeWriteResult = { ok: true } | { ok: false; error: string };

/**
 * Write a listing's SKU and/or free-text barcode.
 *
 * A DEDICATED FUNCTION rather than productService.updateProduct, for one
 * reason: updateProduct swallows the Postgres error and returns `false`, which
 * is exactly right for a field edit and exactly wrong here. `products_org_sku_uidx`
 * makes a duplicate SKU a 23505, and "That SKU is already used" is the only
 * message that tells the user what to do about it — a bare "could not save"
 * would leave them retyping the same code.
 *
 * Writes the row the scanner and the printed label read (the group LEADER); the
 * caller passes that id. Sending `null` clears the column, which is how a
 * manufacturer barcode is removed — and an empty SKU is normalised to null so a
 * blank string cannot occupy the unique index's `where sku is not null` slot.
 */
export async function setProductCodes(
  productId: string,
  patch: { sku?: string | null; barcode?: string | null },
): Promise<CodeWriteResult> {
  const body: Record<string, unknown> = {};
  if (patch.sku !== undefined) body.sku = (patch.sku ?? '').trim() || null;
  if (patch.barcode !== undefined) body.barcode = (patch.barcode ?? '').trim() || null;
  if (Object.keys(body).length === 0) return { ok: true };

  const { data, error } = await supabase
    .from('products').update(body).eq('id', productId).select('id');
  if (error) {
    if (error.code === '23505') {
      return { ok: false, error: 'That SKU is already used by another listing in this workspace.' };
    }
    if (isMissingSchema(error)) return { ok: false, error: 'The labels migration has not been run yet.' };
    log.error(`setProductCodes | ${error.message}`);
    return { ok: false, error: error.message };
  }
  // 0 rows is RLS or a missing row — never a success (the lesson of updateProduct).
  if (!data || data.length === 0) return { ok: false, error: 'That listing is not in this workspace.' };
  return { ok: true };
}

export interface ScannedProduct {
  id: string;
  sku: string | null;
  seo_title: string | null;
  title: string | null;
  price: number | null;
  size: string | null;
  batch_id: string | null;
  storage_path: string | null;
}

export type ScanResult =
  | { status: 'found'; product: ScannedProduct; labels: ListingLabel[] }
  | { status: 'not_found'; tried: string[] }
  | { status: 'unavailable' }
  | { status: 'error'; error: string };

/**
 * Look a listing up by a scanned or typed SKU.
 *
 * Tries the exact spelling first, then the confusable fold (I/L→1, O→0) that a
 * human keying our own codes off a printed label needs, offered only when the
 * fold matches `pattern` (the workspace's `generatedSkuPattern`; default the
 * `ACD-` convention). See
 * barcode.skuLookupCandidates for why that is a second attempt and not an edit
 * to the first. RLS scopes the search to the caller's workspace; there is no
 * `.eq('org_id')` here on purpose (AGENTS.md §18.1).
 */
export async function findProductBySku(raw: string, pattern?: RegExp): Promise<ScanResult> {
  const candidates = skuLookupCandidates(raw, pattern);
  if (candidates.length === 0) return { status: 'not_found', tried: [] };

  for (const sku of candidates) {
    const { data, error } = await supabase
      .from('products')
      .select('id, sku, seo_title, title, price, size, batch_id, product_images(storage_path, position)')
      .eq('sku', sku)
      .limit(1);
    if (error) {
      if (isMissingSchema(error)) return { status: 'unavailable' };
      log.error(`findProductBySku | ${error.message}`);
      return { status: 'error', error: error.message };
    }
    const row = (data ?? [])[0] as (Omit<ScannedProduct, 'storage_path'> & {
      product_images?: Array<{ storage_path: string | null; position: number | null }>;
    }) | undefined;
    if (!row) continue;

    const images = [...(row.product_images ?? [])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    const product: ScannedProduct = {
      id: row.id, sku: row.sku, seo_title: row.seo_title, title: row.title,
      price: row.price, size: row.size, batch_id: row.batch_id,
      storage_path: images[0]?.storage_path ?? null,
    };
    const labelRes = await fetchLabelsForProducts([row.id]);
    return {
      status: 'found',
      product,
      labels: labelRes.status === 'ok' ? (labelRes.byProduct[row.id] ?? []) : [],
    };
  }
  return { status: 'not_found', tried: candidates };
}

/** Re-exported so views can show "this code was generated here" without also
 *  importing the barcode module. */
export { isGeneratedSku };
