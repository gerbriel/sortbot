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
        return true;
      })
      .catch(() => false);
  }
  return stage4Probe;
}

/** Test hook — clears the cached probe result. */
export function __resetStage4ProbeForTests(): void {
  stage4Probe = null;
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
