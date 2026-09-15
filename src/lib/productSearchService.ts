import { supabase } from './supabase';
import { log } from './debugLogger';
import { publicImageUrl } from './storageUrls';
import { fetchWorkflowBatchesMeta } from './workflowBatchService';

/**
 * productSearchService — pull ONE listing out of every batch this workspace has.
 *
 * WHY IT EXISTS: until now a listing could only be reached through the batch it
 * was created in — open the Library, find the batch, open the batch, page
 * through Step 3 — or by scanning a barcode that may not have been printed yet.
 * A reseller who wants "that Carhartt jacket" has a name, not a batch.
 *
 * ONE READ, RLS-SCOPED. There is no `.eq('org_id')` and no `.eq('user_id')`
 * here on purpose (AGENTS.md §18 #1): the policies decide what a caller can
 * see, and adding a client-side filter would silently hide a teammate's work in
 * the shared workspace.
 *
 * ROWS ARE PHOTOS; THE UI WANTS LISTINGS. A listing's photos are separate
 * `products` rows sharing a `product_group` (§11's leader convention), so the
 * reduction below is the same idea `buildGroupArray` applies to the workflow
 * store — done here against DB rows, tolerantly: the leader is the row whose
 * `id === product_group`, and when there is no such row (a legacy fresh-UUID
 * group) the first row stands in. Every field is then coalesced leader-first,
 * exactly the way the CSV exporter coalesces a group, so the list can never
 * show a price that belongs to whichever photo happened to sort first.
 */

/** Columns the list and the detail both need. Never `select('*')` — the blob
 *  columns on `products` are large and none of them is rendered here. */
export const PRODUCT_SEARCH_COLUMNS =
  'id, product_group, batch_id, title, seo_title, vendor, product_category, product_type, ' +
  'size, color, price, condition, sku, barcode, updated_at, created_at, ' +
  'product_images(image_url, storage_path, position)';

/** The columns a query term is matched against, in the order a human would
 *  guess: what it is called, then what it is coded as, then who made it. */
export const SEARCH_MATCH_COLUMNS = [
  'title', 'seo_title', 'sku', 'barcode', 'vendor', 'product_category',
] as const;

/** Row limit for one search. PHOTOS, not listings — see `searchProducts`. */
export const SEARCH_ROW_LIMIT = 60;

export interface ProductImageRow {
  image_url?: string | null;
  storage_path?: string | null;
  position?: number | null;
}

export interface ProductSearchRow {
  id: string;
  product_group?: string | null;
  batch_id?: string | null;
  title?: string | null;
  seo_title?: string | null;
  vendor?: string | null;
  product_category?: string | null;
  product_type?: string | null;
  size?: string | null;
  color?: string | null;
  price?: number | string | null;
  condition?: string | null;
  sku?: string | null;
  barcode?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
  product_images?: ProductImageRow[] | null;
}

/** One listing, assembled from the rows of a single `product_group`. */
export interface ProductListing {
  /** The leader row's id — the row a SKU, labels and edits hang off. */
  id: string;
  /** `product_group` (or the leader's own id for a never-grouped single). */
  groupId: string;
  /** Every `products` row in this listing, leader first. */
  memberIds: string[];
  title: string;
  brand: string;
  size: string;
  color: string;
  category: string;
  productType: string;
  condition: string;
  /** null when the listing has no price — never 0, which the export gate reads
   *  as "priced at nothing" (§10). */
  price: number | null;
  sku: string;
  barcode: string;
  batchId: string | null;
  updatedAt: string | null;
  /** Public CDN URLs, leader's photos first, de-duplicated. */
  photos: string[];
}

/**
 * Make a user's search text safe to embed inside a PostgREST `or=(...)` value.
 *
 * TWO SEPARATE HAZARDS, and they need different treatment:
 *
 * 1. THE `or()` GRAMMAR. `,` separates filters, `.` separates
 *    column.operator.value, `()` groups, `:` starts a cast. Left raw, a comma
 *    in the search box ends our filter and begins one the user wrote — a filter
 *    injection. PostgREST's own answer is double quoting, so every value below
 *    is wrapped in `"…"` and this function escapes the two characters that can
 *    break out of those quotes (`\` and `"`) by backslashing them. That closes
 *    `,` `.` `(` `)` and `:` at a stroke, and — unlike stripping them — a
 *    search for `Levi's 501, 32x34` still matches the text it names.
 *
 * 2. THE `LIKE` PATTERN. `*` is PostgREST's spelling of `%`; both match
 *    anything, so a stray one turns a search into "show me everything" (and a
 *    pasted `%` from a copied description does it silently). Both are dropped.
 *    `_` is deliberately kept: it matches any single character INCLUDING
 *    itself, so a SKU or filename containing one still finds itself, and the
 *    worst it can do is match one extra row.
 *
 * Returns the inner text only. The caller supplies the surrounding quotes.
 */
export function escapeIlikeTerm(raw: string): string {
  return (raw ?? '')
    .trim()
    // Escape the quote-string metacharacters FIRST, or the backslashes this
    // step adds would themselves be escaped by it.
    .replace(/[\\"]/g, '\\$&')
    // Wildcards that would match every row.
    .replace(/[*%]/g, '');
}

/** The `or=(...)` argument for one search term, already escaped and quoted. */
export function buildSearchFilter(term: string): string {
  const safe = escapeIlikeTerm(term);
  return SEARCH_MATCH_COLUMNS.map(col => `${col}.ilike."*${safe}*"`).join(',');
}

const text = (v: unknown): string =>
  v === null || v === undefined ? '' : String(v).trim();

/** First non-blank value across the group, leader first. */
function coalesce(rows: readonly ProductSearchRow[], key: keyof ProductSearchRow): string {
  for (const row of rows) {
    const v = text(row[key]);
    if (v) return v;
  }
  return '';
}

/** A listing's photos: every member's images in position order, leader's first,
 *  de-duplicated by the URL that will actually be rendered. */
function photosFor(rows: readonly ProductSearchRow[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of rows) {
    const images = [...(row.product_images ?? [])]
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    for (const img of images) {
      // storage_path is the authoritative reference (§11) and the only one that
      // survives a restore; image_url is the legacy fallback for rows written
      // before paths were persisted. Never an inline getPublicUrl (§18 #20).
      const url = img.storage_path ? publicImageUrl(img.storage_path) : text(img.image_url);
      if (!url || seen.has(url)) continue;
      seen.add(url);
      out.push(url);
    }
  }
  return out;
}

/**
 * Collapse `products` rows into listings, preserving the order the rows arrived
 * in (which is `updated_at desc` from the query, so the first row of a group
 * decides where its listing sits).
 *
 * PURE — no network, no Supabase — so the leader choice, the photo order and
 * the field coalescing are unit-testable without a fixture database.
 */
export function groupRowsIntoListings(rows: readonly ProductSearchRow[]): ProductListing[] {
  const order: string[] = [];
  const byGroup = new Map<string, ProductSearchRow[]>();

  for (const row of rows) {
    if (!row?.id) continue;
    const groupId = text(row.product_group) || row.id;
    if (!byGroup.has(groupId)) { byGroup.set(groupId, []); order.push(groupId); }
    byGroup.get(groupId)!.push(row);
  }

  return order.map(groupId => {
    const members = byGroup.get(groupId)!;
    // The leader is the row handleOpenBatch and syncGroupFieldsToDatabase both
    // key on. Legacy groups whose leader row is absent (or was never created)
    // fall back to the first member, exactly as buildGroupArray does.
    const leaderIndex = members.findIndex(r => r.id === groupId);
    const ordered = leaderIndex > 0
      ? [members[leaderIndex], ...members.filter((_, i) => i !== leaderIndex)]
      : members;
    const leader = ordered[0];

    const rawPrice = ordered.map(r => r.price).find(p => p !== null && p !== undefined && p !== '');
    const priceNum = rawPrice === undefined ? NaN : Number(rawPrice);

    return {
      id: leader.id,
      groupId,
      memberIds: ordered.map(r => r.id),
      title: coalesce(ordered, 'seo_title') || coalesce(ordered, 'title'),
      brand: coalesce(ordered, 'vendor'),
      size: coalesce(ordered, 'size'),
      color: coalesce(ordered, 'color'),
      category: coalesce(ordered, 'product_category'),
      productType: coalesce(ordered, 'product_type'),
      condition: coalesce(ordered, 'condition'),
      price: Number.isFinite(priceNum) && priceNum > 0 ? priceNum : null,
      sku: coalesce(ordered, 'sku'),
      barcode: coalesce(ordered, 'barcode'),
      batchId: (ordered.map(r => text(r.batch_id)).find(Boolean) || null) as string | null,
      updatedAt: coalesce(ordered, 'updated_at') || null,
      photos: photosFor(ordered),
    };
  });
}

export type ProductSearchResult =
  | { status: 'ok'; listings: ProductListing[]; rowCount: number; truncated: boolean }
  | { status: 'error'; error: string };

export interface SearchOptions {
  /** How many `products` ROWS to read. Default `SEARCH_ROW_LIMIT`. */
  limit?: number;
}

/**
 * Find listings by name, SKU, barcode, brand or category — across every batch.
 *
 * An empty query is not an error: it returns the most recently updated rows, so
 * opening the view shows the work in progress rather than an empty box.
 *
 * THE LIMIT IS ROWS, NOT LISTINGS, and the returned `truncated` flag says when
 * it bit. A four-photo listing is four rows, so 60 rows can be as few as 15
 * listings; the view tells the user that in words rather than quietly showing a
 * short list. Paginating instead would mean the group reduction could split a
 * listing across a page boundary, which is a worse failure than a visible cap.
 */
export async function searchProducts(
  query: string,
  options: SearchOptions = {},
): Promise<ProductSearchResult> {
  const limit = options.limit ?? SEARCH_ROW_LIMIT;
  const term = (query ?? '').trim();
  try {
    let request = supabase
      .from('products')
      .select(PRODUCT_SEARCH_COLUMNS)
      .order('updated_at', { ascending: false })
      .limit(limit);

    if (term) request = request.or(buildSearchFilter(term));

    const { data, error } = await request;
    if (error) {
      log.service(`searchProducts | ${error.code ?? ''} ${error.message}`);
      return { status: 'error', error: error.message };
    }
    const rows = (data ?? []) as unknown as ProductSearchRow[];
    return {
      status: 'ok',
      listings: groupRowsIntoListings(rows),
      rowCount: rows.length,
      truncated: rows.length >= limit,
    };
  } catch (err) {
    log.error(`searchProducts | unexpected: ${String(err)}`);
    return { status: 'error', error: String(err) };
  }
}

export type ListingResult =
  | { status: 'ok'; listing: ProductListing }
  | { status: 'not_found' }
  | { status: 'error'; error: string };

/**
 * The full listing a product id belongs to.
 *
 * Two reads rather than one, because the id may be any member: the first
 * resolves which group it is in, the second collects that group. `.or()` on the
 * second covers both spellings of membership — the leader row whose own
 * `product_group` may be null, and the members that point at it.
 */
export async function fetchListing(productId: string): Promise<ListingResult> {
  const id = (productId ?? '').trim();
  if (!id) return { status: 'not_found' };
  try {
    const { data: seedData, error: seedErr } = await supabase
      .from('products')
      .select(PRODUCT_SEARCH_COLUMNS)
      .eq('id', id)
      .limit(1);
    if (seedErr) return { status: 'error', error: seedErr.message };
    const seed = ((seedData ?? []) as unknown as ProductSearchRow[])[0];
    if (!seed) return { status: 'not_found' };

    const groupId = text(seed.product_group) || seed.id;
    // Both ids come from our own database, so there is nothing user-supplied to
    // escape here — but they still go through the same escaper, because the day
    // an id is ever built from typed text is the day nobody remembers this line.
    const safeGroup = escapeIlikeTerm(groupId);
    const { data, error } = await supabase
      .from('products')
      .select(PRODUCT_SEARCH_COLUMNS)
      .or(`id.eq."${safeGroup}",product_group.eq."${safeGroup}"`)
      .order('created_at', { ascending: true });
    if (error) return { status: 'error', error: error.message };

    const rows = (data ?? []) as unknown as ProductSearchRow[];
    // A read that came back empty (RLS, a race with a delete) still has the
    // seed row in hand — showing the one photo beats showing nothing.
    const listings = groupRowsIntoListings(rows.length > 0 ? rows : [seed]);
    const listing = listings.find(l => l.groupId === groupId) ?? listings[0];
    return listing ? { status: 'ok', listing } : { status: 'not_found' };
  } catch (err) {
    log.error(`fetchListing | unexpected: ${String(err)}`);
    return { status: 'error', error: String(err) };
  }
}

// ── Batch names ─────────────────────────────────────────────────────────────

/**
 * batch id → the name a human recognises.
 *
 * Cached at module scope and shared by every render of the view: the list shows
 * a batch name per row, and re-reading `workflow_batches` for each keystroke of
 * a search would be one metadata query per character. `fetchWorkflowBatchesMeta`
 * is already the cheap projection (no `workflow_state` blob), and the names are
 * stable enough that a stale entry is a wrong label, never a wrong action.
 */
let batchNamesPromise: Promise<Map<string, string>> | null = null;

export function batchLabel(row: { batch_name?: string; batch_number?: string; created_at?: string }): string {
  const name = text(row.batch_name);
  if (name && name !== 'null') return name;
  const number = text(row.batch_number);
  if (number) return number;
  const created = text(row.created_at);
  return created ? `Batch ${new Date(created).toLocaleDateString()}` : 'Untitled batch';
}

export async function fetchBatchNames(force = false): Promise<Map<string, string>> {
  if (force || !batchNamesPromise) {
    batchNamesPromise = (async () => {
      const rows = await fetchWorkflowBatchesMeta();
      return new Map(rows.map(r => [r.id, batchLabel(r)]));
    })().catch(() => new Map<string, string>());
  }
  return batchNamesPromise;
}

/** Drop the cache — after a rename, or when a different account signs in. */
export function clearBatchNameCache(): void {
  batchNamesPromise = null;
}
