import { supabase } from './supabase';
import { log } from './debugLogger';
import { chunked, ID_CHUNK } from './chunk';
import type { BackgroundPreset } from './descriptionSettings';

/**
 * backgroundService — the app's half of automated background removal.
 *
 * WHAT THE FEATURE IS: a self-hosted matting service (VITE_MATTING_URL) cuts
 * each garment out of its photo, stores an alpha master and a deterministic
 * flat-colour composite BESIDE the source in the same Storage folder, scores
 * the mask, and writes the result onto `product_images`. Nothing generative:
 * a mask, a flat colour, a rectangle. The composite is a pure function of
 * (mask, preset), which is what makes `bg_preset` meaningful.
 *
 * WHAT THIS MODULE IS: the client seam. It submits jobs, polls them, re-runs
 * one image, and records a HUMAN's verdict. It is deliberately small, because
 * the division of ownership is the load-bearing part:
 *
 *   THE SERVICE OWNS  cutout_storage_path, composite_storage_path, bg_preset,
 *                     mask_score, mask_flags, mask_model, matted_at — and the
 *                     'queued' / 'auto' / 'review' / 'failed' statuses.
 *   THE APP OWNS      `mask_status` and ONLY when a person decided: 'approved'
 *                     (the composite is fine), 'original' (keep the untouched
 *                     photo), or back to 'review' (I changed my mind).
 *
 * The app never writes a path, a score or a flag. If it did, a re-run would
 * have to reconcile two writers over one row, and the single most useful
 * property of this design — that the service can be re-run over any photo at
 * any time without asking the app anything — would be gone.
 *
 * FORWARD-COMPATIBLE in the house style (labelsService, brandAliasService,
 * marketplaceService): with no `VITE_MATTING_URL`, or before the migration has
 * added the columns, `backgroundsAvailable()` is false and every surface hides
 * itself. The code ships before the service and before the SQL.
 */

// ── Status vocabulary ───────────────────────────────────────────────────────

/**
 * `null` (the column default) means NEVER PROCESSED, which is a seventh state
 * and deliberately not spelled in this union: "we have not looked at this
 * photo" and "we looked and could not do it" must not be the same value, or
 * a retry sweep would keep retrying the failures for ever.
 */
export type MaskStatus = 'queued' | 'auto' | 'review' | 'approved' | 'original' | 'failed';

/** The three a PERSON may write. Everything else is the service's to set. */
export type HumanMaskStatus = 'approved' | 'original' | 'review';

export const MASK_STATUSES: readonly MaskStatus[] =
  ['queued', 'auto', 'review', 'approved', 'original', 'failed'];

/**
 * The mask heuristics, in words.
 *
 * The service emits short machine flags; a person reviewing 400 photos needs a
 * sentence. Unknown flags (a newer service than this build) fall through to the
 * raw string rather than being dropped — a warning nobody can read still beats
 * a warning nobody is shown. `error:<reason>` carries its reason after the
 * colon and is rendered as such.
 */
export const MASK_FLAG_LABELS: Readonly<Record<string, string>> = {
  coverage: 'Garment fills too much or too little of the frame',
  edge: 'Cut off at an edge of the photo',
  fragments: 'Fragmented — the cut-out came back in pieces',
  soft: 'Soft edges',
  contrast: 'Low contrast with the backdrop',
};

export function maskFlagLabel(flag: string): string {
  if (MASK_FLAG_LABELS[flag]) return MASK_FLAG_LABELS[flag];
  if (flag.startsWith('error:')) {
    const reason = flag.slice('error:'.length).replace(/[_-]+/g, ' ').trim();
    return reason ? `Could not be processed — ${reason}` : 'Could not be processed';
  }
  return flag;
}

// ── Row shape ───────────────────────────────────────────────────────────────

/** The columns this feature reads off `product_images`. Projected, never `*`. */
export const BACKGROUND_ROW_COLUMNS =
  'id, product_id, storage_path, mask_status, mask_score, mask_flags, ' +
  'cutout_storage_path, composite_storage_path, bg_preset';

export interface BackgroundImageRow {
  /** `product_images.id` — THE id the matting service takes. NOT the product id. */
  id: string;
  product_id: string;
  storage_path: string | null;
  mask_status: MaskStatus | null;
  mask_score: number | null;
  mask_flags: string[] | null;
  cutout_storage_path: string | null;
  composite_storage_path: string | null;
  bg_preset: string | null;
}

// ── resolveCatalogPath — the ONE rule ───────────────────────────────────────

/**
 * Anything that carries a storage path and a mask status: a `product_images`
 * row read here, or a `ClothingItem` carrying the same values in camelCase.
 * Both spellings are accepted because the two live side by side all the way
 * through the app and a caller should never have to translate at the call site.
 */
export interface CatalogPathSource {
  storagePath?: string | null;
  storage_path?: string | null;
  compositeStoragePath?: string | null;
  composite_storage_path?: string | null;
  maskStatus?: string | null;
  mask_status?: string | null;
}

const pick = (a: unknown, b: unknown): string | null => {
  if (typeof a === 'string' && a) return a;
  if (typeof b === 'string' && b) return b;
  return null;
};

/**
 * THE path that represents this photo in a catalogue: an export, a feed, a
 * pack, a Step-2 thumbnail.
 *
 * ONE RULE, ONE PLACE (AGENTS.md §18): the composite when a machine passed it
 * (`auto`) or a person accepted it (`approved`); the untouched original for
 * everything else — never processed, still queued, waiting for review, failed,
 * or explicitly kept by a person. Re-deriving this anywhere else is how a CSV
 * and a thumbnail start disagreeing about which photo a listing has.
 *
 * It also falls back when the composite is MISSING on an `auto`/`approved` row.
 * That should not happen, but a storage path that resolves to nothing exports
 * a broken image into a shop's catalogue, and the original is always there.
 */
export function resolveCatalogPath(source: CatalogPathSource | null | undefined): string {
  if (!source) return '';
  const original = pick(source.storagePath, source.storage_path) ?? '';
  const status = pick(source.maskStatus, source.mask_status);
  if (status === 'auto' || status === 'approved') {
    const composite = pick(source.compositeStoragePath, source.composite_storage_path);
    if (composite) return composite;
  }
  return original;
}

/** True when this photo is waiting on a human, or on the service. Both block an
 *  export, for the same reason: what the catalogue would carry is not settled. */
export function isBackgroundBlocking(source: CatalogPathSource | null | undefined): boolean {
  const status = pick(source?.maskStatus, source?.mask_status);
  return status === 'review' || status === 'queued';
}

// ── summarizeMaskStatuses ───────────────────────────────────────────────────

export interface MaskSummary {
  total: number;
  /** Per status. `unprocessed` is the `null` case — never looked at. */
  queued: number;
  auto: number;
  review: number;
  approved: number;
  original: number;
  failed: number;
  unprocessed: number;
  /** Photos that would BLOCK an export: awaiting review, or still in flight. */
  blocking: number;
  /** What "Process photos" would act on: never processed, plus the failures
   *  (a failure is usually a transient fetch, and a second pass is cheap). */
  processable: number;
}

/** PURE. The counts every background surface reads. */
export function summarizeMaskStatuses(
  rows: readonly CatalogPathSource[] | null | undefined,
): MaskSummary {
  const out: MaskSummary = {
    total: 0, queued: 0, auto: 0, review: 0, approved: 0, original: 0,
    failed: 0, unprocessed: 0, blocking: 0, processable: 0,
  };
  for (const row of rows ?? []) {
    out.total++;
    const status = pick(row.maskStatus, row.mask_status);
    switch (status) {
      case 'queued':   out.queued++;   out.blocking++;   out.processable++; break;
      case 'auto':     out.auto++;                                          break;
      case 'review':   out.review++;   out.blocking++;                      break;
      case 'approved': out.approved++;                                      break;
      case 'original': out.original++;                                      break;
      case 'failed':   out.failed++;                     out.processable++; break;
      default:         out.unprocessed++;                out.processable++; break;
    }
  }
  return out;
}

// ── Availability ────────────────────────────────────────────────────────────

/** The service origin, with any trailing slash removed. '' when unset. */
export function mattingBaseUrl(): string {
  const raw = import.meta.env.VITE_MATTING_URL;
  return typeof raw === 'string' ? raw.trim().replace(/\/+$/, '') : '';
}

let availabilityProbe: Promise<boolean> | null = null;
let availabilityKnown = false;

/**
 * True when the feature can work at all: the service origin is configured AND
 * `product_images` has the columns. Cached for the session — the answer cannot
 * change without a redeploy or a migration, and every Step-2 render asks.
 *
 * The probe is one projected row, exactly the `stage4ColumnsAvailable` shape:
 * writing or selecting an unknown column is a whole-statement failure (42703 /
 * PGRST204), so this guard is what makes deploying the code before the SQL safe.
 */
export function backgroundsAvailable(): Promise<boolean> {
  if (!availabilityProbe) {
    if (!mattingBaseUrl()) {
      log.service('backgrounds | VITE_MATTING_URL is not set — the feature is off');
      availabilityProbe = Promise.resolve(false);
      return availabilityProbe;
    }
    availabilityProbe = Promise.resolve(
      supabase.from('product_images').select('cutout_storage_path').limit(1),
    )
      .then(({ error }) => {
        if (error) {
          log.service(`backgrounds | columns unavailable (${(error as { code?: string }).code ?? ''} ${(error as { message?: string }).message ?? ''}) — the feature is off`);
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
 *  the probe has resolved positively — which hides the surface, the safe way round. */
export function backgroundsKnownAvailable(): boolean {
  return availabilityKnown;
}

/** Test hook — clears the cached probe. */
export function __resetBackgroundProbeForTests(): void {
  availabilityProbe = null;
  availabilityKnown = false;
}

// ── Reading rows ────────────────────────────────────────────────────────────

export type BackgroundRowsResult =
  | { status: 'ok'; rows: BackgroundImageRow[] }
  | { status: 'unavailable' };

/**
 * Every `product_images` row for these products, with its background state.
 *
 * Chunked at ID_CHUNK: PostgREST answers a long `in()` URL with a 400/414, and
 * a batch is routinely 1 500 photos (AGENTS.md §11). No `user_id` / `org_id`
 * filter — RLS scopes it (§18 #1).
 */
export async function fetchImageRowsForProducts(
  productIds: readonly string[],
): Promise<BackgroundRowsResult> {
  const ids = [...new Set(productIds.filter(Boolean))];
  if (ids.length === 0) return { status: 'ok', rows: [] };
  const rows: BackgroundImageRow[] = [];
  for (const slice of chunked(ids, ID_CHUNK)) {
    const { data, error } = await supabase
      .from('product_images')
      .select(BACKGROUND_ROW_COLUMNS)
      .in('product_id', slice);
    if (error) {
      log.service(`fetchImageRowsForProducts | unavailable (${(error as { code?: string }).code ?? ''} ${(error as { message?: string }).message ?? ''})`);
      return { status: 'unavailable' };
    }
    rows.push(...((data ?? []) as unknown as BackgroundImageRow[]));
  }
  return { status: 'ok', rows };
}

// ── Writing the one column the app owns ─────────────────────────────────────

export type WriteResult = { ok: true } | { ok: false; error: string };

/**
 * Record a person's verdict on one photo.
 *
 * A plain PostgREST update — the row must already be one the caller may UPDATE,
 * which under org RLS it is. **0 rows updated is a FAILURE** (§18 #41): that is
 * exactly what an RLS refusal looks like, and reporting it as success is how a
 * reviewer spends an afternoon approving masks that never moved.
 */
export async function setMaskStatus(
  productImageId: string,
  status: HumanMaskStatus,
): Promise<WriteResult> {
  if (!productImageId) return { ok: false, error: 'No photo id.' };
  const { data, error } = await supabase
    .from('product_images')
    .update({ mask_status: status })
    .eq('id', productImageId)
    .select('id');
  if (error) {
    log.error(`setMaskStatus | ${(error as { message?: string }).message ?? String(error)}`);
    const code = (error as { code?: string }).code;
    if (code === '42703' || code === 'PGRST204') {
      return { ok: false, error: 'The photo-backgrounds migration has not been run yet.' };
    }
    return { ok: false, error: (error as { message?: string }).message ?? 'Could not save that.' };
  }
  if (!data || (data as unknown[]).length === 0) {
    return { ok: false, error: 'That photo could not be updated — you may not have permission.' };
  }
  return { ok: true };
}

/** The same verdict across many photos, serially. Serial on purpose: these are
 *  writes against one table and a burst of 400 concurrent PATCHes is how a
 *  workspace rate-limits itself mid-review (the same reasoning as
 *  `MarketplaceExport.recordPublications`). Returns how many failed. */
export async function setMaskStatusMany(
  productImageIds: readonly string[],
  status: HumanMaskStatus,
): Promise<{ failed: number }> {
  let failed = 0;
  for (const id of productImageIds) {
    const res = await setMaskStatus(id, status);
    if (!res.ok) failed++;
  }
  return { failed };
}

// ── The matting service ─────────────────────────────────────────────────────

export interface HealthResponse { ok: boolean; backend?: string; model?: string }

export interface JobAccepted {
  jobId: string;
  accepted: number;
  /** Already composited with this exact preset and not forced. */
  skipped: number;
}

export interface JobProgress {
  jobId: string;
  status: 'running' | 'done';
  total: number;
  done: number;
  failed: number;
  /** How many of the finished photos came back needing a look. */
  review: number;
  /** How many passed the heuristics on their own. */
  auto: number;
}

export type ServiceResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; status?: number };

/**
 * One authenticated JSON call at the matting service.
 *
 * The access token is the SAME Supabase session JWT the Edge Functions take
 * (`shopify-titles` resolves its caller through `/auth/v1/user` with it), so
 * the service authenticates against the project rather than holding a shared
 * secret this app would have to ship. There is no anon path: without a session
 * this returns before any network call.
 */
async function callService<T>(
  path: string,
  init: { method: 'GET' | 'POST'; body?: unknown },
): Promise<ServiceResult<T>> {
  const base = mattingBaseUrl();
  if (!base) return { ok: false, error: 'Photo backgrounds are not configured for this deployment.' };

  let token = '';
  try {
    const { data } = await supabase.auth.getSession();
    token = (data?.session as { access_token?: string } | null)?.access_token ?? '';
  } catch {
    token = '';
  }
  if (!token) return { ok: false, error: 'You need to be signed in to process photos.' };

  try {
    const res = await fetch(`${base}${path}`, {
      method: init.method,
      headers: {
        'Authorization': `Bearer ${token}`,
        ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    });
    if (!res.ok) {
      // The service's own body is not echoed to the user: it is a server's
      // words about a server, and the two cases a person can act on are the
      // ones named here (the same rule the Edge Functions follow, §9).
      log.service(`matting | ${init.method} ${path} → ${res.status}`);
      if (res.status === 401 || res.status === 403) {
        return { ok: false, error: 'The background service refused this session. Sign out and back in.', status: res.status };
      }
      return { ok: false, error: `The background service returned an error (${res.status}).`, status: res.status };
    }
    return { ok: true, value: (await res.json()) as T };
  } catch (err) {
    log.service(`matting | ${init.method} ${path} | ${String(err)}`);
    return { ok: false, error: 'Could not reach the background service.' };
  }
}

/** `GET /healthz`. Used by the settings screen to say whether the service is up. */
export function checkMattingHealth(): Promise<ServiceResult<HealthResponse>> {
  return callService<HealthResponse>('/healthz', { method: 'GET' });
}

/**
 * `POST /v1/jobs` — mat these photos with this preset.
 *
 * `productImageIds` are `product_images.id`, NOT item/product ids. Everything
 * in this module takes that id, and `fetchImageRowsForProducts` is how the app
 * gets it — a batch's items know their product id and nothing else.
 *
 * `force: false` lets the service skip a photo that already carries a composite
 * built with this exact `bg_preset` hash, which is what makes "Process photos"
 * safe to press twice.
 */
export function submitBackgroundJob(
  productImageIds: readonly string[],
  preset: BackgroundPreset,
  force: boolean,
): Promise<ServiceResult<JobAccepted>> {
  const ids = [...new Set(productImageIds.filter(Boolean))];
  if (ids.length === 0) {
    return Promise.resolve({ ok: false, error: 'No photos to process.' });
  }
  return callService<JobAccepted>('/v1/jobs', {
    method: 'POST',
    body: { productImageIds: ids, preset, force },
  });
}

/** `GET /v1/jobs/{jobId}` — progress for one submitted job. */
export function pollBackgroundJob(jobId: string): Promise<ServiceResult<JobProgress>> {
  if (!jobId) return Promise.resolve({ ok: false, error: 'No job id.' });
  return callService<JobProgress>(`/v1/jobs/${encodeURIComponent(jobId)}`, { method: 'GET' });
}

/** The two resolutions the re-run offers. 2K is the "try harder" pass a
 *  reviewer reaches for on a photo whose edges came back soft. */
export type RerunResolution = 1024 | 2048;

/** `POST /v1/images/{id}/rerun` — one photo, at the chosen resolution. */
export function rerunImage(
  productImageId: string,
  preset: BackgroundPreset,
  resolution: RerunResolution,
): Promise<ServiceResult<{ jobId: string }>> {
  if (!productImageId) return Promise.resolve({ ok: false, error: 'No photo id.' });
  return callService<{ jobId: string }>(
    `/v1/images/${encodeURIComponent(productImageId)}/rerun`,
    { method: 'POST', body: { preset, resolution } },
  );
}
