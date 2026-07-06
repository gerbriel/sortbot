import { supabase } from './supabase';
import { log } from './debugLogger';
import type { ClothingItem } from '../App';
import type { WorkflowBatch, SlimItem } from './workflowBatchService';

/**
 * libraryData — the Library's data derivation, extracted VERBATIM from
 * Library.tsx:loadAll (refactor Stage 3). Pure transformation:
 *   (workflow batches, DB products, DB images) → (batches, groups, images)
 * The component keeps: fetching, cancellation, loading state, setState,
 * collapse bookkeeping, and diagnostics.
 *
 * The two-pass imageList build encodes hard-won dedup/gap-fill rules
 * (commits 69dd319, 8643c5d, dbd5d43) — locked in by libraryData.test.ts.
 */

export interface ProductGroup {
  id: string;
  title: string;
  category: string;
  images: string[];
  itemCount: number;
  createdAt: string;
  isSaved?: boolean; // Track if from database vs workflow_state
  batchId?: string;
  batchName?: string;
}

export interface ImageRecord {
  id: string;
  preview: string;
  category?: string;
  productGroup?: string;
  productGroupTitle?: string;
  batchId?: string;
  batchNumber?: string;
  batchName?: string;
  createdAt: string;
  isSaved?: boolean; // Track if from database vs workflow_state
}

/** Strip unfilled template tokens like {brand}, {model}, {color} and collapse extra spaces/dashes */
export function cleanTitle(raw: string | undefined | null, fallback = 'Untitled Product'): string {
  if (!raw) return fallback;
  const cleaned = raw
    .replace(/\{[^}]+\}/g, '')   // remove {brand}, {model}, etc.
    .replace(/\s{2,}/g, ' ')     // collapse multiple spaces
    .replace(/^\s*[-–—·]\s*/g, '') // strip leading dash/bullet
    .replace(/\s*[-–—·]\s*$/g, '') // strip trailing dash/bullet
    .replace(/\s*-\s*-+/g, ' - ') // collapse double dashes
    .trim();
  return cleaned || fallback;
}

export const makeBatchName = (b: { batch_name?: string; created_at: string }) =>
  b.batch_name || `Batch ${new Date(b.created_at).toLocaleDateString()} ${new Date(b.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;

/* Row shapes as returned by libraryService (structurally — kept loose on purpose,
 * matching the `any`-typed access patterns of the original inline code). */
export interface SavedProductRow {
  id: string;
  batch_id?: string | null;
  product_group?: string | null;
  title?: string | null;
  seo_title?: string | null;
  product_category?: string | null;
  created_at: string;
  product_images?: { image_url?: string | null; position?: number }[];
  workflow_batches?: { batch_name?: string; batch_number?: string; created_at?: string } | null;
}

export interface SavedImageRow {
  id: string;
  image_url?: string | null;
  created_at: string;
  products?: {
    id?: string;
    batch_id?: string | null;
    product_group?: string | null;
    title?: string | null;
    product_category?: string | null;
    workflow_batches?: { batch_name?: string; batch_number?: string; created_at?: string } | null;
  } | null;
}

export interface LibraryDerivedData {
  batches: WorkflowBatch[];
  groups: ProductGroup[];
  images: ImageRecord[];
}

export function deriveLibraryData(
  wfBatches: WorkflowBatch[],
  savedProducts: SavedProductRow[],
  savedImages: SavedImageRow[],
): LibraryDerivedData {
  const batchesById = new Map<string, WorkflowBatch>(wfBatches.map(b => [b.id, b]));

  // Helper: synthesize a batch entry for any batch_id missing from workflow_batches
  const synthesizeBatch = (
    batchId: string | null | undefined,
    wb: { batch_name?: string; batch_number?: string; created_at?: string } | null | undefined,
    fallbackDate: string,
  ) => {
    if (!batchId || batchesById.has(batchId)) return;
    batchesById.set(batchId, {
      id: batchId,
      user_id: '',
      batch_number: wb?.batch_number || batchId,
      batch_name: wb?.batch_name || undefined,
      workflow_state: undefined,
      total_images: 0,
      product_groups_count: 0,
      categorized_count: 0,
      processed_count: 0,
      saved_products_count: 0,
      current_step: 0,
      is_completed: false,
      created_at: wb?.created_at || fallbackDate,
      updated_at: wb?.created_at || fallbackDate,
    });
  };

  savedProducts.forEach(p => synthesizeBatch(p.batch_id, p.workflow_batches, p.created_at));
  savedImages.forEach(img => synthesizeBatch(img.products?.batch_id, img.products?.workflow_batches, img.created_at));

  // ── Build productGroups ──────────────────────────────────────────────────
  const groups: ProductGroup[] = [];

  wfBatches.forEach(batch => {
    const items: (ClothingItem | SlimItem)[] =
      (batch.workflow_state?.processedItems?.length  ? batch.workflow_state.processedItems  : null) ||
      (batch.workflow_state?.sortedImages?.length    ? batch.workflow_state.sortedImages    : null) ||
      (batch.workflow_state?.groupedImages?.length   ? batch.workflow_state.groupedImages   : null) ||
      [];

    const wfGroupMap = new Map<string, (ClothingItem | SlimItem)[]>();
    items.forEach((item) => {
      const gid = item.productGroup || item.id;
      if (!wfGroupMap.has(gid)) wfGroupMap.set(gid, []);
      wfGroupMap.get(gid)!.push(item);
    });

    wfGroupMap.forEach((groupItems, groupId) => {
      const first = groupItems[0];
      groups.push({
        id: groupId,
        title: cleanTitle((first as ClothingItem).seoTitle),
        category: first.category || 'Uncategorized',
        images: groupItems.map(i => {
          // preview and imageUrls are stripped by slim() before saving to workflow_state.
          // Reconstruct the CDN URL from storagePath (always preserved by slim()).
          const storagePath = (i as ClothingItem).storagePath || i.storagePath;
          const reconstructed = storagePath
            ? supabase.storage.from('product-images').getPublicUrl(storagePath).data.publicUrl
            : '';
          return (i as ClothingItem).preview || i.imageUrls?.[0] || reconstructed;
        }).filter(Boolean),
        itemCount: groupItems.length,
        createdAt: batch.created_at,
        batchId: batch.id,
        batchName: makeBatchName(batch),
      });
    });
  });

  // Build from DB products — group siblings by product_group value.
  // Products where product_group === id are standalones (1-image listings).
  // Products where product_group !== id share a group — merge them together.
  const dbGroupMap = new Map<string, SavedProductRow[]>();
  savedProducts.forEach(product => {
    const gid = product.product_group || product.id;
    if (!dbGroupMap.has(gid)) dbGroupMap.set(gid, []);
    dbGroupMap.get(gid)!.push(product);
  });

  dbGroupMap.forEach((members, groupId) => {
    // Use the member whose id === groupId as canonical (the group "leader"),
    // falling back to the first member if none matches.
    const canonical = members.find(p => p.id === groupId) || members[0];
    const allImages = members
      .flatMap(p => (p.product_images || [])
        .slice()
        .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
        .map(img => img.image_url))
      .filter(Boolean) as string[];
    // Skip groups with 0 images — they are products whose product_images were all
    // deleted but whose products row survived RLS (wrong user_id). Treat them as gone.
    if (allImages.length === 0 && !canonical.batch_id) {
      log.library(`deriveLibraryData | skipping empty unassigned product id=${groupId.slice(0, 8)} — all images deleted, products row is RLS-orphaned`);
      return;
    }
    groups.push({
      id: groupId,
      title: cleanTitle(canonical.title || canonical.seo_title),
      category: canonical.product_category || 'Uncategorized',
      images: allImages,
      itemCount: allImages.length || members.length,
      createdAt: canonical.created_at,
      isSaved: true,
      batchId: canonical.batch_id || undefined,
      batchName: canonical.workflow_batches?.batch_name || (canonical.batch_id ? `Batch ${new Date(canonical.created_at).toLocaleDateString()}` : undefined),
    });
  });

  const groupMap = new Map<string, ProductGroup>();
  groups.forEach(g => {
    const existing = groupMap.get(g.id);
    if (!existing || (!existing.isSaved && g.isSaved)) groupMap.set(g.id, g);
  });

  // ── Build imageList ────────────────────────────────────────────────────
  // SOURCE PRIORITY: workflow_state items are used first (they have richer in-memory data).
  // DB product_images rows fill in any gaps — items that exist in the DB but are
  // absent from workflow_state. This handles batches whose workflow_state was saved
  // before a bug-fix and is missing loose/uncategorized images that ARE in the DB.
  const imageList: ImageRecord[] = [];

  // Pass 1: workflow_state items — add all, track IDs
  const wfItemIds = new Set<string>();

  wfBatches.forEach(batch => {
    const items: (ClothingItem | SlimItem)[] =
      batch.workflow_state?.processedItems ||
      batch.workflow_state?.sortedImages ||
      batch.workflow_state?.groupedImages ||
      batch.workflow_state?.uploadedImages || [];
    if (items.length === 0) return;
    items.forEach((item) => {
      if (wfItemIds.has(item.id)) return; // dedup by item ID
      wfItemIds.add(item.id);
      // Reconstruct public URL from storagePath if preview/imageUrls are empty
      // (slim() strips preview before saving; storagePath is always preserved)
      const storagePath = (item as ClothingItem).storagePath || item.storagePath;
      const reconstructed = (!((item as ClothingItem).preview || item.imageUrls?.[0]) && storagePath)
        ? supabase.storage.from('product-images').getPublicUrl(storagePath).data.publicUrl
        : '';
      const url = (item as ClothingItem).preview || item.imageUrls?.[0] || reconstructed;
      imageList.push({
        id: item.id,
        preview: url,
        category: item.category,
        productGroup: item.productGroup || item.id,
        productGroupTitle: (item as ClothingItem).seoTitle || undefined,
        batchId: batch.id,
        batchName: makeBatchName(batch),
        createdAt: batch.created_at,
        isSaved: false,
      });
    });
  });

  // Pass 2: DB product_images rows.
  // For batches with NO workflow_state at all: include all DB rows (legacy behaviour).
  // For batches WITH workflow_state: only include DB rows whose product_id was NOT
  //   already added in Pass 1. This catches loose/uncategorized images that exist in
  //   the DB (written by registerItemsInDB) but were absent from an old workflow_state
  //   that was saved before the handleItemsProcessed merge-fix (commit dbd5d43).
  const dbImageUrls = new Set<string>();
  savedImages.forEach(img => {
    const batchId: string | undefined = img.products?.batch_id || undefined;
    const productId: string | undefined = img.products?.id || undefined;

    // If this product's ID was already emitted in Pass 1 (workflow_state), skip it to
    // avoid duplicates — regardless of which batch_id the DB row claims.  This handles
    // the case where items were registered under a different batch_id than the one that
    // holds the workflow_state (e.g. items registered under an old/deleted batch).
    // For batches with NO workflow_state at all, productId won't be in wfItemIds so
    // they still fall through and get added here (legacy behaviour preserved).
    if (productId && wfItemIds.has(productId)) return;

    if (!img.image_url) return;
    if (dbImageUrls.has(img.image_url)) return; // dedup by URL
    dbImageUrls.add(img.image_url);

    const batchEntry = batchId ? batchesById.get(batchId) : undefined;
    const batchName = batchEntry ? makeBatchName(batchEntry) : undefined;
    const groupLeaderId = img.products?.product_group || img.products?.id;
    if (!groupLeaderId) {
      // Orphaned product_images row — parent products row is missing.
      // Still show it in the Library (so user can delete it), but productGroup will be
      // undefined which handleDeleteUnassigned now handles via the orphan path.
      log.library(`deriveLibraryData | orphaned product_images row id=${img.id?.slice(0, 8)} (no parent products row)`);
    }
    const groupLeaderMembers = groupLeaderId ? dbGroupMap.get(groupLeaderId) : undefined;
    const groupLeaderTitle = groupLeaderMembers
      ? cleanTitle((groupLeaderMembers.find(p => p.id === groupLeaderId) || groupLeaderMembers[0])?.title)
      : (img.products?.title || undefined);

    imageList.push({
      id: img.id,
      preview: img.image_url,
      category: img.products?.product_category ?? undefined,
      productGroup: groupLeaderId ?? undefined,
      productGroupTitle: groupLeaderTitle ?? undefined,
      batchId,
      batchName,
      createdAt: img.created_at,
      isSaved: true,
    });
  });

  const finalBatches = Array.from(batchesById.values())
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());

  return { batches: finalBatches, groups: Array.from(groupMap.values()), images: imageList };
}
