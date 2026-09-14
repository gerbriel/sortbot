import { supabase } from './supabase';

/**
 * storageUrls — THE single seam between a Supabase Storage path and a URL the
 * browser can load.
 *
 * WHY THIS EXISTS: `storagePath` is the only image reference that survives
 * slimForWorkflowState (CLAUDE.md §11), so every restore path has to turn paths
 * back into URLs. That expression was inlined at ~20 call sites, which made the
 * planned public→private bucket migration (ANALYSIS §4 Phase 1b) a 20-site edit
 * with three different async-ness assumptions. Route everything through here and
 * it becomes one function body.
 *
 * INVARIANT: an empty/absent path yields '' — never 'undefined' in a URL, never
 * a throw. Every current call site already relies on that (they all guard with
 * `item.storagePath ? … : ''`, which this function absorbs).
 */

export const IMAGE_BUCKET = 'product-images';

/** Full-resolution public CDN URL for a storage path. '' when there is no path. */
export function publicImageUrl(storagePath?: string | null): string {
  if (!storagePath) return '';
  return supabase.storage.from(IMAGE_BUCKET).getPublicUrl(storagePath).data.publicUrl;
}

/**
 * Card/thumbnail URL. Identical to publicImageUrl today: Supabase Storage image
 * transforms require the paid Image Transformation add-on, so the free tier must
 * serve the full-resolution object and let CSS crop it. Kept as a distinct
 * function so enabling transforms is a one-line change here, and so call sites
 * document their intent.
 *
 * @param size Accepted and ignored — kept so the old `getThumbnailUrl(path, 300)`
 *             signature still type-checks. It becomes meaningful the day the
 *             Image Transformation add-on is enabled.
 */
export function thumbnailImageUrl(storagePath?: string | null, size = 300): string {
  void size;
  return publicImageUrl(storagePath);
}
