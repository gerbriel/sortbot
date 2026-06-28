import { supabase } from './supabase';

/**
 * Reference-count guard for storage deletions.
 *
 * Duplicated batches in this app share the same storage files (a duplicate's
 * workflow_state references the original's image paths instead of copying them).
 * That means deleting one batch's storage files can orphan another batch's images —
 * the exact bug that wiped "Gabriel's Test Batch".
 *
 * Given the storage paths about to be deleted and the product IDs whose rows are
 * being removed in the same operation, this returns only the paths that NO surviving
 * product_images row references. A path is kept (NOT deleted) if any product_images
 * row pointing at it belongs to a product OUTSIDE the deletion set.
 *
 * Must be called BEFORE the product_images rows are deleted, so this batch's own
 * rows are still present and can be distinguished from other batches' references.
 *
 * Fails safe: if a lookup errors, the affected paths are treated as referenced
 * (left in storage) rather than risk deleting a shared file.
 */
export async function filterUnreferencedStoragePaths(
  candidatePaths: string[],
  deletingProductIds: string[],
): Promise<string[]> {
  const paths = [...new Set(candidatePaths.filter(Boolean))];
  if (paths.length === 0) return [];
  const deleting = new Set(deletingProductIds);
  const referencedElsewhere = new Set<string>();
  const CHUNK = 100; // keep the IN() list under PostgREST's URL-length limit

  for (let i = 0; i < paths.length; i += CHUNK) {
    const chunk = paths.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from('product_images')
      .select('storage_path, product_id')
      .in('storage_path', chunk);
    if (error) {
      // Uncertain → be conservative: don't delete anything in this chunk.
      for (const p of chunk) referencedElsewhere.add(p);
      continue;
    }
    for (const row of (data ?? []) as Array<{ storage_path: string; product_id: string }>) {
      if (row.storage_path && !deleting.has(row.product_id)) {
        referencedElsewhere.add(row.storage_path);
      }
    }
  }

  return paths.filter(p => !referencedElsewhere.has(p));
}
