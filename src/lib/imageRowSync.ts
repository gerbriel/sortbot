import { supabase } from './supabase';
import { log } from './debugLogger';
import type { ClothingItem } from '../App';

/**
 * imageRowSync — Stage 4 dual-write for product_images rows.
 *
 * One row builder shared by every product_images write path
 * (registerItemsInDB, the upload upsert, saveBatchToDatabase), so the
 * relational tables converge with workflow_state on every open/upload/save.
 *
 * FORWARD-COMPATIBLE: the Stage 4 columns (captured_at,
 * original_storage_path on product_images; description_edited on products)
 * may not exist yet — stage4ColumnsAvailable() probes ONCE per session and
 * the builders omit the new fields until the migration is run. Writing an
 * unknown column would fail the whole upsert (PostgREST PGRST204), so this
 * guard is what makes deploying the code before the SQL safe.
 */

let stage4Probe: Promise<boolean> | null = null;
let stage4Known = false;

/** True once supabase/migrations/stage4_slim_fields.sql has been run. Cached
 *  for the session; any error (column missing, offline) counts as "not yet". */
export function stage4ColumnsAvailable(): Promise<boolean> {
  if (!stage4Probe) {
    stage4Probe = Promise.resolve(
      supabase.from('product_images').select('captured_at').limit(1)
    )
      .then(({ error }) => {
        if (error) {
          log.db(`stage4 columns unavailable (${error.code ?? ''} ${error.message}) — dual-write of new fields disabled`);
          return false;
        }
        stage4Known = true;
        return true;
      })
      .catch(() => false);
  }
  return stage4Probe;
}

/** Synchronous view of the probe result, for the ONE caller that cannot await:
 *  the Step-3 keepalive flush during page teardown. `false` until the async
 *  probe has resolved positively — the Stage 4 columns are then simply omitted,
 *  which is always safe. */
export function stage4ColumnsKnownAvailable(): boolean {
  return stage4Known;
}

/** Test hook — clears the cached probe result. */
export function __resetStage4ProbeForTests(): void {
  stage4Probe = null;
  stage4Known = false;
}

/* ── Photo-background columns ───────────────────────────────────────────────
 *
 * The same forward-compatible shape as Stage 4, and for the same reason: an
 * unknown column fails the WHOLE upsert with PGRST204, so `registerItemsInDB`
 * — which runs on every batch open and on startup restore — must not name a
 * column until the migration has added it.
 *
 * Note this probe is separate from `backgroundService.backgroundsAvailable()`,
 * which ALSO requires `VITE_MATTING_URL`. That is right: a workspace whose
 * service is not configured (or is down) must still carry across any mask
 * state already in the database, or one batch open would erase a day of
 * reviewing. This asks only "do the columns exist".
 */

let bgProbe: Promise<boolean> | null = null;
let bgKnown = false;

/** True once the photo-backgrounds migration has been run. Cached for the
 *  session; any error (column missing, offline) counts as "not yet". */
export function backgroundColumnsAvailable(): Promise<boolean> {
  if (!bgProbe) {
    bgProbe = Promise.resolve(
      supabase.from('product_images').select('mask_status').limit(1)
    )
      .then(({ error }) => {
        if (error) {
          log.db(`background columns unavailable (${error.code ?? ''} ${error.message}) — mask columns omitted from writes`);
          return false;
        }
        bgKnown = true;
        return true;
      })
      .catch(() => false);
  }
  return bgProbe;
}

/** Synchronous view of the background probe — same contract as
 *  `stage4ColumnsKnownAvailable`: `false` until the probe resolves positively,
 *  and omitting the columns is always safe. */
export function backgroundColumnsKnownAvailable(): boolean {
  return bgKnown;
}

/** Test hook — clears the cached background probe result. */
export function __resetBackgroundColumnProbeForTests(): void {
  bgProbe = null;
  bgKnown = false;
}

/**
 * THE mask columns, in one list.
 *
 * `mergeProductImageRows` walks it per column and `buildProductImageRow` writes
 * it as a block; naming them twice is how one of the two quietly stops covering
 * `mask_flags` on the day a seventh column is added.
 */
export const BACKGROUND_COLUMNS = [
  'cutout_storage_path',
  'composite_storage_path',
  'bg_preset',
  'mask_status',
  'mask_score',
  'mask_flags',
] as const;

export type BackgroundColumn = typeof BACKGROUND_COLUMNS[number];

/** The rotation/crop payload for product_images.transforms (column exists
 *  since 20260426). null when the image is untouched — keeps rows clean. */
export function buildTransforms(
  item: Pick<ClothingItem, 'imageRotation' | 'crop'>,
): { rotation: number; crop: ClothingItem['crop'] | null } | null {
  return item.crop || item.imageRotation
    ? { rotation: item.imageRotation || 0, crop: item.crop || null }
    : null;
}

export interface ProductImageRow {
  image_url: string;
  storage_path: string | null;
  product_id: string;
  user_id: string;
  position: number;
  alt_text: string;
  original_name: string | null;
  transforms: ReturnType<typeof buildTransforms>;
  // Stage 4 fields — present only when the migration has been run
  captured_at?: number | null;
  original_storage_path?: string | null;
  // Photo-background fields — present only when THAT migration has been run.
  // The app is not their author (the matting service is); it carries across
  // what it last read so the delete-then-reinsert cannot drop them.
  cutout_storage_path?: string | null;
  composite_storage_path?: string | null;
  bg_preset?: string | null;
  mask_status?: string | null;
  mask_score?: number | null;
  mask_flags?: string[] | null;
}

/** Build one product_images row from an item. Pass the session's
 *  stage4ColumnsAvailable() result as `stage4`, and its
 *  backgroundColumnsAvailable() result as `background`.
 *
 *  The background block is written from what the ITEM knows, which is what the
 *  app last READ from these columns — never something it authored. It is a
 *  belt to `mergeProductImageRows`' braces: the merge preserves an existing
 *  row's mask columns per column, so a hydrating item that only carries three
 *  of the six (the `slimForWorkflowState` whitelist) still cannot erase the
 *  other three. */
export function buildProductImageRow(
  item: ClothingItem,
  userId: string,
  position: number,
  imageUrl: string,
  stage4: boolean,
  background = false,
): ProductImageRow {
  const row: ProductImageRow = {
    image_url: imageUrl,
    storage_path: item.storagePath ?? null,
    product_id: item.id,
    user_id: userId,
    position,
    alt_text: item.seoTitle || 'Uploaded image',
    original_name: item.originalName ?? null,
    transforms: buildTransforms(item),
  };
  if (stage4) {
    row.captured_at = item.capturedAt ?? null;
    row.original_storage_path = item.originalStoragePath ?? null;
  }
  if (background) {
    row.cutout_storage_path    = item.cutoutStoragePath    ?? null;
    row.composite_storage_path = item.compositeStoragePath ?? null;
    row.bg_preset              = item.bgPreset             ?? null;
    row.mask_status            = item.maskStatus           ?? null;
    row.mask_score             = item.maskScore            ?? null;
    // NEVER null: `mask_flags` is `not null default '{}'` in the migration, so
    // writing null fails the whole insert. An empty array from here means "the
    // app has nothing to say", which is what `carryBackground` reads it as.
    row.mask_flags             = item.maskFlags            ?? [];
  }
  return row;
}

/** A product_images row as it exists in the DB (the columns we read back before
 *  registerItemsInDB's delete-then-reinsert). */
export interface ExistingProductImageRow extends ProductImageRow {
  id?: string;
}

/**
 * Merge the rows registerItemsInDB is about to write with the rows already in the
 * DB for the same products, so the wipe cannot destroy a group's photo list.
 *
 * WHY (finding 16): registerItemsInDB deletes every product_images row for the
 * batch's products and re-inserts ONE row per item. saveBatchToDatabase, however,
 * writes N rows against the group LEADER (one per group photo, with real
 * `position` values). Re-opening the batch therefore collapsed those N rows to 1
 * and flattened every position — the concrete cause of "photo reorder does not
 * persist". Removing the delete is not an option (AGENTS.md §18 #3: it is what
 * stops stale rows accumulating when a CDN URL changes between sessions), so
 * instead we carry the still-valid rows across the wipe.
 *
 * Rules, per product:
 *  - a computed row REPLACES the existing row with the same image_url, keeping
 *    that row's slot (so a group's photo order is stable across opens);
 *  - an existing row whose storage_path is one we are re-writing is STALE (same
 *    file, different URL) and is dropped — exactly what the wipe was for;
 *  - every other existing row is carried forward (these are the group's other
 *    photos, which our one-row-per-item build knows nothing about);
 *  - a computed row with no counterpart goes FIRST (imageUrls[0] is the primary);
 *  - positions are renumbered 0..n-1 in that order, so they are always contiguous.
 */
/**
 * Carry an existing row's photo-background state onto the computed row that is
 * replacing it, COLUMN BY COLUMN.
 *
 * THIS IS THE GUARD THE WHOLE FEATURE RESTS ON (AGENTS.md §18). The matting
 * service is the author of five of these six columns and the reviewer of the
 * sixth; `registerItemsInDB` deletes and re-inserts every row for the batch on
 * EVERY open and on startup restore, and it builds those rows from in-memory
 * items. A restored item carries only three of the six (the
 * `slimForWorkflowState` whitelist), and an item hydrated before the background
 * read lands carries none — so a whole-row replacement would erase a batch's
 * masks, scores and flags on the next refresh.
 *
 * Per column rather than all-or-nothing for exactly that reason: a computed row
 * that knows its `mask_status` and nothing else must not take the absence of
 * `mask_score` as an instruction to clear it.
 *
 * The computed row still WINS wherever it has a value, because that value is
 * what the app last read from the database and a person may have changed
 * `mask_status` since this row was written.
 */
function carryBackground(
  computed: ProductImageRow,
  existing: ExistingProductImageRow,
): ProductImageRow {
  const out = { ...computed } as Record<string, unknown>;
  for (const col of BACKGROUND_COLUMNS) {
    const own = out[col];
    // `mask_flags` is NOT NULL in the database, so the app's "I have nothing to
    // say" is an EMPTY ARRAY rather than null — and it has to be read as
    // absence here, or a hydrating item (which never carries flags: they are
    // outside the slimForWorkflowState whitelist) would clear a real warning on
    // every batch open. The app is not the author of this column; the existing
    // row was just read, so it is always the newer answer.
    const nothingToSay = own === undefined || own === null
      || (col === 'mask_flags' && Array.isArray(own) && own.length === 0);
    if (nothingToSay) {
      const theirs = (existing as unknown as Record<string, unknown>)[col];
      // `undefined` means the column was not selected at all (pre-migration);
      // writing it back would name a column that does not exist.
      if (theirs !== undefined) out[col] = theirs;
    }
  }
  return out as unknown as ProductImageRow;
}

export function mergeProductImageRows(
  computed: ProductImageRow[],
  existing: ExistingProductImageRow[],
): ProductImageRow[] {
  const byProduct = new Map<string, { computed: ProductImageRow[]; existing: ExistingProductImageRow[] }>();
  const slot = (id: string) => {
    let s = byProduct.get(id);
    if (!s) { s = { computed: [], existing: [] }; byProduct.set(id, s); }
    return s;
  };
  for (const r of computed) slot(r.product_id).computed.push(r);
  for (const r of existing) slot(r.product_id).existing.push(r);

  const out: ProductImageRow[] = [];
  for (const [, group] of byProduct) {
    // Existing rows in their stored order — this is the group's photo order.
    const merged: ProductImageRow[] = group.existing
      .slice()
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      .map((row) => {
        const copy = { ...row };
        delete copy.id;            // the PK is re-issued on insert
        return copy as ProductImageRow;
      });

    for (const row of group.computed) {
      // Same file (storage_path) first: that row keeps its slot even when the
      // public URL was regenerated — which is exactly the stale-row case the
      // wipe exists for, minus the collateral damage.
      let at = row.storage_path
        ? merged.findIndex(r => r.storage_path === row.storage_path)
        : -1;
      if (at < 0) at = merged.findIndex(r => r.image_url === row.image_url);
      // The replaced row's background state survives the swap (see carryBackground).
      if (at >= 0) merged[at] = carryBackground(row, merged[at]);
      else merged.unshift(row);   // new photo — imageUrls[0] is the primary
    }

    const writtenUrls = new Set(group.computed.map(r => r.image_url));
    const writtenPaths = new Set(
      group.computed.map(r => r.storage_path).filter((p): p is string => !!p),
    );
    const seenUrls = new Set<string>();
    let position = 0;
    for (const row of merged) {
      if (seenUrls.has(row.image_url)) continue;                 // exact duplicate
      // Another row pointing at a file we just re-wrote, under a different URL:
      // that is the stale row the delete-then-reinsert was introduced to clear.
      if (row.storage_path && writtenPaths.has(row.storage_path) && !writtenUrls.has(row.image_url)) continue;
      seenUrls.add(row.image_url);
      out.push({ ...row, position: position++ });
    }
  }
  return out;
}
