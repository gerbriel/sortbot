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
}

/** Build one product_images row from an item. Pass the session's
 *  stage4ColumnsAvailable() result as `stage4`. */
export function buildProductImageRow(
  item: ClothingItem,
  userId: string,
  position: number,
  imageUrl: string,
  stage4: boolean,
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
      if (at >= 0) merged[at] = row;
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
