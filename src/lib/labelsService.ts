import { supabase } from './supabase';
import { log } from './debugLogger';
import { chunked } from './chunk';
import { generateSkuCandidate, isGeneratedSku, skuLookupCandidates } from './barcode';

/**
 * labelsService — colour/word/vendor labels on listings, and the SKU a label's
 * barcode encodes.
 *
 * Backed by supabase/migrations/listing_labels.sql. FORWARD-COMPATIBLE in the
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

// ── SKUs ────────────────────────────────────────────────────────────────────

/** How many fresh codes to try before giving up on a collision. At 32⁶ codes
 *  per workspace, reaching 2 is already astronomically unlikely; 6 exists so a
 *  genuinely broken RNG surfaces as an error instead of an infinite loop. */
const SKU_ATTEMPTS = 6;

export type SkuAssignment = { status: 'ok'; skus: Record<string, string> }
  | { status: 'unavailable' }
  | { status: 'error'; error: string };

/**
 * Make sure each of `productIds` has a SKU, minting one where it is missing.
 *
 * Existing SKUs are never overwritten — a SKU that is already on a printed
 * label, in a spreadsheet, or in someone's Shopify catalogue is not ours to
 * change. Returns the SKU for every requested product (old or new).
 *
 * UNIQUENESS IS THE DATABASE'S JOB. `products_org_sku_uidx` is the authority;
 * this loop just retries on 23505. Checking "is it taken?" with a SELECT first
 * would be a race, not a check.
 */
export async function ensureSkus(productIds: readonly string[]): Promise<SkuAssignment> {
  const ids = [...new Set(productIds.filter(Boolean))];
  if (ids.length === 0) return { status: 'ok', skus: {} };

  const skus: Record<string, string> = {};
  const needed: string[] = [];
  try {
    for (const batch of chunked(ids)) {
      const { data, error } = await supabase.from('products').select('id, sku').in('id', batch);
      if (error) {
        if (isMissingSchema(error)) return { status: 'unavailable' };
        return { status: 'error', error: error.message };
      }
      for (const row of (data ?? []) as Array<{ id: string; sku: string | null }>) {
        if (row.sku && row.sku.trim()) skus[row.id] = row.sku.trim();
        else needed.push(row.id);
      }
    }
  } catch (err) {
    log.error(`ensureSkus | unexpected: ${String(err)}`);
    return { status: 'error', error: String(err) };
  }

  for (const id of needed) {
    let assigned = '';
    for (let attempt = 0; attempt < SKU_ATTEMPTS && !assigned; attempt++) {
      const candidate = generateSkuCandidate();
      // barcode carries the same value: the printed code IS the SKU, so there
      // is never a second identifier to keep in step.
      const { data, error } = await supabase
        .from('products')
        .update({ sku: candidate, barcode: candidate })
        .eq('id', id)
        .select('id');
      if (error) {
        if (error.code === '23505') continue;             // collision — draw again
        if (isMissingSchema(error)) return { status: 'unavailable' };
        return { status: 'error', error: error.message };
      }
      if (!data || data.length === 0) {
        return { status: 'error', error: 'That listing is not in this workspace.' };
      }
      assigned = candidate;
    }
    if (!assigned) return { status: 'error', error: 'Could not generate a unique SKU — try again.' };
    skus[id] = assigned;
  }

  return { status: 'ok', skus };
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
 * human keying our own codes off a printed label needs — see
 * barcode.skuLookupCandidates for why that is a second attempt and not an edit
 * to the first. RLS scopes the search to the caller's workspace; there is no
 * `.eq('org_id')` here on purpose (AGENTS.md §18.1).
 */
export async function findProductBySku(raw: string): Promise<ScanResult> {
  const candidates = skuLookupCandidates(raw);
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
