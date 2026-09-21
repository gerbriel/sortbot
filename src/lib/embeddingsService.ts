import { supabase } from './supabase';
import { log } from './debugLogger';
import { chunked, ID_CHUNK } from './chunk';
import { publicImageUrl } from './storageUrls';
import { mattingBaseUrl, pollBackgroundJob, type JobProgress, type ServiceResult } from './backgroundService';

/**
 * embeddingsService — the app's half of image embeddings.
 *
 * WHAT THE FEATURE IS: the matting service computes one CLIP vector per photo and
 * writes it to `listing_embeddings` (services/matting CONTRACT.md §9). This module
 * asks it to, and reads the ranking back through ONE RPC. It never computes,
 * stores or even sees a vector — 512 floats have no business crossing the wire to
 * a browser, and the only question the app has is "which past listings look like
 * this one", which is a sort the database is already doing.
 *
 * WHY IT MATTERS (docs/pricing/00-plan.md step 3): the shop's own sold history is
 * the cheapest comp source it will ever have and the only one that gets better as
 * the shop sells. The same numbers also catch a garment that was already listed
 * last month, which is the one thing a reseller cannot check by remembering.
 *
 * THE DIVISION OF OWNERSHIP, the same shape as backgroundService:
 *
 *   THE SERVICE OWNS  every row in `listing_embeddings` — the vector, the model,
 *                     the ids. It writes with the service role.
 *   THE APP OWNS      nothing in that table. It reads a ranking and it asks for
 *                     work. A member may DELETE their own rows (the migration
 *                     grants it) but no surface here does.
 *
 * FORWARD-COMPATIBLE in the house style (labelsService, brandAliasService,
 * backgroundService): with no `VITE_MATTING_URL`, or before
 * `supabase/migrations/listing_embeddings.sql` has been run,
 * `embeddingsAvailable()` is false and every surface hides itself.
 */

// ── Similarity, in words ────────────────────────────────────────────────────

/**
 * THE DUPLICATE THRESHOLD, and the reason it is a named constant.
 *
 * 0.92 is where "two photos of the same garment" stops and "two similar garments"
 * starts, measured on the model this feature actually runs (a re-shoot of one
 * jacket — brighter, slightly re-cropped — scored 0.984; two different garments in
 * the same style scored 0.842). It is a USER-VISIBLE rule: cross it and the strip
 * says "near duplicate", which is a claim the seller acts on.
 *
 * That is also why the service refuses to mix models (CONTRACT.md §9.3): a
 * quantized export moved every pairwise similarity down by 0.03-0.06, which would
 * not have added noise to the ranking — it would have moved this number out from
 * under it, silently.
 */
export const NEAR_DUPLICATE = 0.92;
export const VERY_SIMILAR = 0.85;
export const SIMILAR = 0.75;

export type SimilarityLabel = 'near duplicate' | 'very similar' | 'similar' | 'related';

/** PURE. The one place a cosine becomes a word. */
export function similarityLabel(sim: number): SimilarityLabel {
  if (!Number.isFinite(sim)) return 'related';
  if (sim >= NEAR_DUPLICATE) return 'near duplicate';
  if (sim >= VERY_SIMILAR) return 'very similar';
  if (sim >= SIMILAR) return 'similar';
  return 'related';
}

/** PURE. Whether this row is the same garment, not merely a lookalike. */
export function isNearDuplicate(sim: number): boolean {
  return Number.isFinite(sim) && sim >= NEAR_DUPLICATE;
}

// ── Row shape ───────────────────────────────────────────────────────────────

/** Exactly what `match_listing_images` returns, in its own spelling. */
interface MatchRow {
  product_image_id: string;
  product_id: string | null;
  product_group_id: string | null;
  similarity: number | null;
  title: string | null;
  price: number | string | null;
  sold_price_cents: number | null;
  sold_at: string | null;
}

export interface SimilarListing {
  /** `product_images.id` — the photo, and the key everything here is joined on. */
  productImageId: string;
  productId: string | null;
  /** The group leader's id. Null for a legacy single-photo listing. */
  productGroupId: string | null;
  /** The batch this listing lives in, or null when it is not in one. */
  batchId: string | null;
  similarity: number;
  label: SimilarityLabel;
  title: string;
  /** Dollars, or null. NEVER 0 — see the note on `toPrice`. */
  price: number | null;
  soldPriceCents: number | null;
  soldAt: string | null;
  /**
   * The ORIGINAL photo's URL, built through storageUrls (AGENTS.md §18 #20).
   *
   * Deliberately the original and not the background-composited version: the
   * original is what was embedded, so the strip shows the picture the match was
   * actually made on. A thumbnail that disagreed with the vector behind it would
   * make a correct match look wrong.
   */
  thumbnailUrl: string;
}

/**
 * A price of 0 is not a price (AGENTS.md — the export gate reads $0 as
 * "unpriced"), so it becomes null here rather than being rendered as "$0.00" next
 * to a comp somebody is about to price from.
 */
function toPrice(value: number | string | null): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// ── Pure formatting the strip renders ───────────────────────────────────────

/** PURE. `$45.00`, or '' for no price. */
export function formatPrice(dollars: number | null): string {
  if (dollars === null || !Number.isFinite(dollars) || dollars <= 0) return '';
  return `$${dollars.toFixed(2)}`;
}

/** PURE. Cents to `$45.00`. */
export function formatCents(cents: number | null): string {
  if (cents === null || !Number.isFinite(cents) || cents <= 0) return '';
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * PURE. Whole days between `iso` and `now`, or null for anything unparseable.
 * Floored, and never negative: a clock skew of a few seconds must not render
 * "sold -0 days ago".
 */
export function daysAgo(iso: string | null, now: number = Date.now()): number | null {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return null;
  return Math.max(0, Math.floor((now - then) / 86_400_000));
}

/**
 * PURE. The sold line, or '' when this listing never sold.
 *
 * `listing_sales` is the other migration's table, read by the RPC through
 * `to_regclass` — so before `pricing_research.sql` runs, every row here has a null
 * sold price and this returns ''. That is the pre-migration state, not an error.
 */
export function formatSoldLine(
  row: Pick<SimilarListing, 'soldPriceCents' | 'soldAt'>,
  now: number = Date.now(),
): string {
  const money = formatCents(row.soldPriceCents);
  if (!money) return '';
  const days = daysAgo(row.soldAt, now);
  if (days === null) return `sold ${money}`;
  if (days === 0) return `sold ${money} · today`;
  if (days === 1) return `sold ${money} · yesterday`;
  return `sold ${money} · ${days} days ago`;
}

// ── Availability ────────────────────────────────────────────────────────────

let availabilityProbe: Promise<boolean> | null = null;
let availabilityKnown = false;

/**
 * True when the feature can work at all: the service origin is configured AND
 * `listing_embeddings` exists. Cached for the session — the answer cannot change
 * without a redeploy or a migration, and every Step-3 navigation asks.
 *
 * The probe is one projected row, the `backgroundsAvailable` / `stage4Columns`
 * shape: selecting from a table that is not there is a whole-statement failure
 * (42P01 / PGRST205), so this guard is what makes deploying the code before the
 * SQL safe.
 */
export function embeddingsAvailable(): Promise<boolean> {
  if (!availabilityProbe) {
    if (!mattingBaseUrl()) {
      log.service('embeddings | VITE_MATTING_URL is not set — the feature is off');
      availabilityProbe = Promise.resolve(false);
      return availabilityProbe;
    }
    availabilityProbe = Promise.resolve(
      supabase.from('listing_embeddings').select('product_image_id').limit(1),
    )
      .then(({ error }) => {
        if (error) {
          log.service(`embeddings | unavailable (${(error as { code?: string }).code ?? ''} ${(error as { message?: string }).message ?? ''}) — run supabase/migrations/listing_embeddings.sql`);
          return false;
        }
        availabilityKnown = true;
        return true;
      })
      .catch(() => false);
  }
  return availabilityProbe;
}

/** Synchronous view of the probe. False until it resolves positively — which
 *  hides the surface, the safe way round. */
export function embeddingsKnownAvailable(): boolean {
  return availabilityKnown;
}

/** Test hook — clears the cached probe. */
export function __resetEmbeddingsProbeForTests(): void {
  availabilityProbe = null;
  availabilityKnown = false;
}

// ── findSimilar ─────────────────────────────────────────────────────────────

export type SimilarResult =
  | { status: 'ok'; rows: SimilarListing[] }
  | { status: 'unavailable' }
  | { status: 'error'; error: string };

/** PostgREST reports a missing function as 42883 (Postgres) or PGRST202 (its own
 *  schema-cache answer); a missing TABLE is 42P01 / PGRST205. All four mean the
 *  migration has not been run — never that the caller did something wrong. */
function isMissing(error: { code?: string } | null): boolean {
  const code = error?.code;
  return code === '42883' || code === 'PGRST202' || code === '42P01' || code === 'PGRST205';
}

/**
 * The nearest past listings to this photo.
 *
 * ONE RPC and ONE follow-up read, and the second one is why this function exists
 * rather than the component calling `supabase.rpc` itself: the RPC returns ids,
 * and a strip needs a picture and a way in. So the photo ids come back to
 * `product_images` for `storage_path` (the only image reference that survives a
 * reload, AGENTS.md §11) with `products(batch_id)` embedded, which is what lets
 * "Open in workflow" open the right batch. Two round trips, never N.
 *
 * NO `org_id` FILTER ANYWHERE — the RPC proves the workspace itself and RLS scopes
 * the follow-up read (§18 #1).
 *
 * An empty result is `ok` with no rows, not an error: a photo with no embedding
 * yet, a photo whose workspace has nothing else in it, and a photo that is simply
 * unlike everything are all "nothing to show".
 */
export async function findSimilar(productImageId: string, limit = 12): Promise<SimilarResult> {
  if (!productImageId) return { status: 'ok', rows: [] };

  const { data, error } = await supabase.rpc('match_listing_images', {
    p_product_image_id: productImageId,
    p_limit: limit,
  });
  if (error) {
    if (isMissing(error as { code?: string })) return { status: 'unavailable' };
    log.error(`findSimilar | ${(error as { message?: string }).message ?? String(error)}`);
    return { status: 'error', error: (error as { message?: string }).message ?? 'Could not look that up.' };
  }

  const matches = ((data ?? []) as unknown as MatchRow[]).filter(
    (r) => r && typeof r.product_image_id === 'string' && r.product_image_id,
  );
  if (matches.length === 0) return { status: 'ok', rows: [] };

  const paths = await fetchPhotoRefs(matches.map((r) => r.product_image_id));

  return {
    status: 'ok',
    rows: matches.map((r) => {
      const similarity = Number.isFinite(Number(r.similarity)) ? Number(r.similarity) : 0;
      const ref = paths[r.product_image_id];
      return {
        productImageId: r.product_image_id,
        productId: r.product_id ?? null,
        productGroupId: r.product_group_id ?? null,
        batchId: ref?.batchId ?? null,
        similarity,
        label: similarityLabel(similarity),
        title: (r.title ?? '').trim() || 'Untitled listing',
        price: toPrice(r.price),
        soldPriceCents: r.sold_price_cents ?? null,
        soldAt: r.sold_at ?? null,
        thumbnailUrl: publicImageUrl(ref?.storagePath ?? null),
      };
    }),
  };
}

interface PhotoRef {
  storagePath: string | null;
  batchId: string | null;
}

/**
 * product_image_id -> its storage path and its batch.
 *
 * Chunked at ID_CHUNK because PostgREST answers a long `in()` URL with a 400/414;
 * `p_limit` caps this at 50 today, so the loop runs once — it is here so raising
 * that cap is not also a bug. A failed read is not fatal: the strip then renders
 * the titles with a placeholder rather than nothing at all.
 */
async function fetchPhotoRefs(ids: readonly string[]): Promise<Record<string, PhotoRef>> {
  const out: Record<string, PhotoRef> = {};
  for (const slice of chunked([...new Set(ids)], ID_CHUNK)) {
    const { data, error } = await supabase
      .from('product_images')
      .select('id, storage_path, products(batch_id)')
      .in('id', slice);
    if (error) {
      log.service(`findSimilar | photo refs unavailable (${(error as { code?: string }).code ?? ''})`);
      continue;
    }
    for (const row of (data ?? []) as unknown as Array<{
      id: string;
      storage_path: string | null;
      products: { batch_id: string | null } | Array<{ batch_id: string | null }> | null;
    }>) {
      // PostgREST renders a to-one embed either as an object or as a
      // single-element array depending on the relationship shape. Betting on one
      // makes batchId null, which silently turns "Open in workflow" off.
      const product = Array.isArray(row.products) ? row.products[0] : row.products;
      out[row.id] = {
        storagePath: row.storage_path ?? null,
        batchId: product?.batch_id ?? null,
      };
    }
  }
  return out;
}

// ── Which photos are embedded at all ────────────────────────────────────────

export type EmbeddedIdsResult =
  | { status: 'ok'; ids: Set<string> }
  | { status: 'unavailable' };

/**
 * Which of these photos already have an embedding.
 *
 * THE ONE QUESTION `findSimilar` CANNOT ANSWER. An empty neighbour list means
 * either "this photo has never been analysed" or "this workspace has nothing else
 * that looks like it", and those need opposite words on screen — the first offers a
 * button, the second says there is nothing to show. The RPC returns rows, not the
 * reason there are none, so this is a separate projected read, and it is made ONLY
 * in the empty case (see SimilarListings).
 *
 * The `model` is deliberately NOT part of the question. A row from an older model
 * is invisible to the RPC, so "embedded" here means "the service has looked at this
 * photo" — and offering Find similar again is the right move either way: the
 * service's own skip rule re-embeds a stale model for free (CONTRACT.md §5).
 */
export async function fetchEmbeddedPhotoIds(
  productImageIds: readonly string[],
): Promise<EmbeddedIdsResult> {
  const ids = [...new Set(productImageIds.filter(Boolean))];
  if (ids.length === 0) return { status: 'ok', ids: new Set() };
  const found = new Set<string>();
  for (const slice of chunked(ids, ID_CHUNK)) {
    const { data, error } = await supabase
      .from('listing_embeddings')
      .select('product_image_id')
      .in('product_image_id', slice);
    if (error) {
      log.service(`fetchEmbeddedPhotoIds | unavailable (${(error as { code?: string }).code ?? ''})`);
      return { status: 'unavailable' };
    }
    for (const row of (data ?? []) as unknown as Array<{ product_image_id: string }>) {
      if (row?.product_image_id) found.add(row.product_image_id);
    }
  }
  return { status: 'ok', ids: found };
}

// ── ensureEmbeddings ────────────────────────────────────────────────────────

export interface EmbedAccepted {
  jobId: string;
  accepted: number;
  /** Already embedded with the service's current model, and not forced. */
  skipped: number;
}

/**
 * `POST /v1/embed` — embed these photos.
 *
 * `productImageIds` are `product_images.id`, never item or product ids. The
 * service resolves the caller through `/auth/v1/user` with the SAME session JWT
 * the Edge Functions take, so there is no shared secret in this bundle and no anon
 * path: without a session this returns before any network call.
 *
 * FAILS QUIET in the sense that matters — it returns a result rather than throwing
 * — but it does NOT invent success. A caller that ignores the return will simply
 * find no embeddings afterwards, which is the honest outcome.
 */
export async function ensureEmbeddings(
  productImageIds: readonly string[],
  force = false,
): Promise<ServiceResult<EmbedAccepted>> {
  const ids = [...new Set(productImageIds.filter(Boolean))];
  if (ids.length === 0) return { ok: false, error: 'No photos to embed.' };

  const base = mattingBaseUrl();
  if (!base) return { ok: false, error: 'Similar listings are not configured for this deployment.' };

  let token = '';
  try {
    const { data } = await supabase.auth.getSession();
    token = (data?.session as { access_token?: string } | null)?.access_token ?? '';
  } catch {
    token = '';
  }
  if (!token) return { ok: false, error: 'You need to be signed in for this.' };

  try {
    const res = await fetch(`${base}/v1/embed`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ productImageIds: ids, force }),
    });
    if (!res.ok) {
      // The service's own body is not echoed to a reseller: it is a server's
      // words about a server (§9). The two cases a person can act on are named.
      log.service(`embeddings | POST /v1/embed → ${res.status}`);
      if (res.status === 401 || res.status === 403) {
        return { ok: false, error: 'The service refused this session. Sign out and back in.', status: res.status };
      }
      if (res.status === 503) {
        return { ok: false, error: 'Run supabase/migrations/listing_embeddings.sql to turn this on.', status: res.status };
      }
      return { ok: false, error: `The service returned an error (${res.status}).`, status: res.status };
    }
    return { ok: true, value: (await res.json()) as EmbedAccepted };
  } catch (err) {
    log.service(`embeddings | POST /v1/embed | ${String(err)}`);
    return { ok: false, error: 'Could not reach the service.' };
  }
}

/**
 * `GET /v1/jobs/{jobId}` — re-exported from backgroundService rather than
 * duplicated, because it is LITERALLY the same endpoint: an embed job is a job on
 * the same registry with the same progress shape (an embedded photo counts as
 * `auto`, `review` is always 0). Two pollers over one endpoint is two places to
 * fix when it changes.
 */
export { pollBackgroundJob as pollEmbedJob };
export type { JobProgress, ServiceResult };
