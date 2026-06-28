import { supabase } from './supabase';
import type { ClothingItem } from '../App';
import { log } from './debugLogger';
import { filterUnreferencedStoragePaths } from './storageSafety';

/**
 * Minimal item stored in workflow_state — only what's needed to restore
 * grouping/category state on reload. Everything else lives in the products table.
 */
export interface SlimItem {
  id: string;
  productGroup?: string;
  category?: string;
  storagePath?: string;
  imageUrls?: string[];
}

export interface WorkflowBatch {
  id: string;
  user_id: string;
  batch_name?: string;
  batch_number: string;
  current_step: number;
  is_completed: boolean;
  total_images: number;
  product_groups_count: number;
  categorized_count: number;
  processed_count: number;
  saved_products_count: number;
  workflow_state?: {
    uploadedImages?: ClothingItem[];
    groupedImages?: ClothingItem[];
    sortedImages?: ClothingItem[];
    processedItems?: ClothingItem[] | SlimItem[];
    lastEditedBy?: string;   // email of the user who last saved this batch
    lastEditedAt?: string;   // ISO timestamp of the last save
  };
  thumbnail_url?: string;
  created_at: string;
  updated_at: string;
  last_opened_at?: string;
  tags?: string[];
  notes?: string;
  // Surfaced from workflow_state JSONB for the Library list (collaborative edit note).
  lastEditedBy?: string;
  lastEditedAt?: string;
}

/**
 * Fetch all workflow batches (collaborative - all users see all batches)
 */
export async function fetchWorkflowBatches(): Promise<WorkflowBatch[]> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      console.warn('[fetchWorkflowBatches] no authenticated user — returning []');
      return []; // not authenticated or network unavailable — silently return empty
    }

    const { data, error } = await supabase
      .from('workflow_batches')
      .select('*')
      .order('updated_at', { ascending: false });

    if (error) throw error;
    const rows = data || [];
    log.service(`fetchWorkflowBatches | rows=${rows.length}`);
    return rows;
  } catch (error: any) {
    if (error?.name === 'AbortError') return []; // expected from React 18 Strict Mode cleanup
    if (error?.message === 'Failed to fetch') return []; // network down / Supabase unreachable
    console.error('Error fetching workflow batches:', error);
    return [];
  }
}

/**
 * Fetch only batch metadata — excludes the heavy workflow_state JSONB blob.
 * Used for Phase 1 of Library load so the batch list renders immediately.
 */
export async function fetchWorkflowBatchesMeta(): Promise<Omit<WorkflowBatch, 'workflow_state'>[]> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return [];
    const { data, error } = await supabase
      .from('workflow_batches')
      .select('id, user_id, batch_name, batch_number, current_step, is_completed, total_images, product_groups_count, categorized_count, processed_count, saved_products_count, created_at, updated_at, lastEditedBy:workflow_state->>lastEditedBy, lastEditedAt:workflow_state->>lastEditedAt')
      .order('updated_at', { ascending: false });
    if (error) throw error;
    log.service(`fetchWorkflowBatchesMeta | rows=${(data || []).length}`);
    return (data || []) as Omit<WorkflowBatch, 'workflow_state'>[];
  } catch (error: any) {
    if (error?.name === 'AbortError') return [];
    if (error?.message === 'Failed to fetch') return [];
    console.error('Error fetching workflow batch metadata:', error);
    return [];
  }
}

/**
 * Create a new workflow batch
 */
export async function createWorkflowBatch(
  batchNumber: string,
  workflowState: WorkflowBatch['workflow_state'],
  stats: {
    total_images: number;
    product_groups_count: number;
    categorized_count: number;
    processed_count: number;
  }
): Promise<WorkflowBatch | null> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    // Get thumbnail from first image — only SlimItems are stored so use imageUrls
    const firstItem = workflowState?.processedItems?.[0] as SlimItem | undefined;
    const thumbnail_url = firstItem?.imageUrls?.[0];

    const { data, error } = await supabase
      .from('workflow_batches')
      .insert({
        user_id: user.id,
        batch_number: batchNumber,
        current_step: determineCurrentStep(workflowState),
        total_images: stats.total_images,
        product_groups_count: stats.product_groups_count,
        categorized_count: stats.categorized_count,
        processed_count: stats.processed_count,
        workflow_state: workflowState,
        thumbnail_url,
        last_opened_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Error creating workflow batch:', error);
    return null;
  }
}

/**
 * Update an existing workflow batch
 */
export async function updateWorkflowBatch(
  batchId: string,
  updates: Partial<WorkflowBatch>
): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('workflow_batches')
      .update({
        ...updates,
        last_opened_at: new Date().toISOString(),
      })
      .eq('id', batchId);

    if (error) {
      console.error('Error updating workflow batch:', error);
      throw error;
    }
    
    return true;
  } catch (error) {
    console.error('❌ Error updating workflow batch:', error);
    return false;
  }
}

/**
 * Remove specific item IDs from all workflow_state arrays of a batch.
 * Call this after deleting individual images or product groups from the Library
 * so the items don't resurrect on the next loadAll() (which reads from workflow_state).
 */
export async function removeItemsFromWorkflowBatch(
  batchId: string,
  itemIds: string[]
): Promise<void> {
  if (!batchId || itemIds.length === 0) return;
  try {
    const { data } = await supabase
      .from('workflow_batches')
      .select('workflow_state')
      .eq('id', batchId)
      .maybeSingle();
    if (!data?.workflow_state) return;
    const ws = data.workflow_state;
    const idSet = new Set(itemIds);
    const filter = (arr: any[] | undefined) => (arr ?? []).filter((i: any) => !idSet.has(i.id));
    await supabase.from('workflow_batches').update({
      workflow_state: {
        ...ws,
        uploadedImages:  filter(ws.uploadedImages),
        groupedImages:   filter(ws.groupedImages),
        sortedImages:    filter(ws.sortedImages),
        processedItems:  filter(ws.processedItems),
      }
    }).eq('id', batchId);
  } catch (err) {
    console.error('[removeItemsFromWorkflowBatch] error:', err);
  }
}

/**
 * Delete a workflow batch
 */
export async function deleteWorkflowBatch(batchId: string): Promise<boolean> {
  try {
    // 1. Collect storage paths for all images belonging to this batch's products
    const batchProductIds =
      (await supabase.from('products').select('id').eq('batch_id', batchId)).data?.map((r: any) => r.id) ?? [];
    const { data: imageRows } = await supabase
      .from('product_images')
      .select('id, storage_path')
      .in('product_id', batchProductIds);

    // 1b. Also collect originalStoragePath values cached in the workflow_state JSON
    // (these are NOT stored as product_images rows — they're backup copies of pre-crop
    // originals and would be orphaned in Storage if we only delete product_images paths).
    const { data: batchRow } = await supabase
      .from('workflow_batches')
      .select('workflow_state')
      .eq('id', batchId)
      .maybeSingle();
    const workflowItems: any[] = [
      ...(batchRow?.workflow_state?.uploadedImages ?? []),
      ...(batchRow?.workflow_state?.groupedImages ?? []),
    ];
    const originalPaths = workflowItems
      .map((i: any) => i.originalStoragePath)
      .filter(Boolean) as string[];

    // 2. Delete files from Storage (live images + cached originals) — but ONLY files
    // that no OTHER batch's product_images row still references. Duplicated batches
    // share storage files, so deleting blindly would orphan another batch's images.
    const storagePaths = (imageRows ?? [])
      .map((r: any) => r.storage_path)
      .filter(Boolean) as string[];
    const allPaths = [...new Set([...storagePaths, ...originalPaths])];
    if (allPaths.length > 0) {
      const safePaths = await filterUnreferencedStoragePaths(allPaths, batchProductIds);
      const sharedCount = allPaths.length - safePaths.length;
      if (sharedCount > 0) {
        console.warn(`[deleteWorkflowBatch] kept ${sharedCount} storage file(s) still referenced by other batches`);
      }
      if (safePaths.length > 0) {
        await supabase.storage.from('product-images').remove(safePaths);
      }
    }

    // 2b. Claim ownership of the batch + its products + images so the owner-scoped
    // DELETE policies permit removal. UPDATE is collaborative (see collaborative_edit
    // _policies.sql), so this works even for batches created by another account in the
    // shared workspace. Reassigning user_id is harmless since these rows are about to
    // be deleted. Without this, a non-owner's DELETE silently affects 0 rows and the
    // batch reappears in the Library.
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      await supabase.from('workflow_batches').update({ user_id: user.id }).eq('id', batchId);
      await supabase.from('products').update({ user_id: user.id }).eq('batch_id', batchId);
      const CLAIM_CHUNK = 100;
      for (let i = 0; i < batchProductIds.length; i += CLAIM_CHUNK) {
        await supabase
          .from('product_images')
          .update({ user_id: user.id })
          .in('product_id', batchProductIds.slice(i, i + CLAIM_CHUNK));
      }
    }

    // 3. Delete product_images rows
    const imageIds = (imageRows ?? []).map((r: any) => r.id);
    if (imageIds.length > 0) {
      await supabase.from('product_images').delete().in('id', imageIds);
    }

    // 4. Delete products rows
    await supabase.from('products').delete().eq('batch_id', batchId);

    // 5. Delete the workflow_batch row — .select() so we can confirm it actually went.
    const { data: deletedRows, error } = await supabase
      .from('workflow_batches')
      .delete()
      .eq('id', batchId)
      .select('id');

    if (error) throw error;
    if (!deletedRows || deletedRows.length === 0) {
      console.warn(`[deleteWorkflowBatch] batch ${batchId} delete affected 0 rows — not removed`);
      return false;
    }
    return true;
  } catch (error) {
    console.error('Error deleting workflow batch:', error);
    return false;
  }
}

/**
 * Get a single workflow batch by ID
 */
export async function getWorkflowBatch(batchId: string): Promise<WorkflowBatch | null> {
  try {
    const { data, error } = await supabase
      .from('workflow_batches')
      .select('*')
      .eq('id', batchId)
      .maybeSingle(); // .single() returns a 406 error when row doesn't exist; .maybeSingle() returns null

    if (error) throw error;
    if (!data) return null;
    
    // Update last_opened_at
    await updateWorkflowBatch(batchId, {});
    
    return data;
  } catch (error) {
    console.error('Error fetching workflow batch:', error);
    return null;
  }
}

/**
 * Auto-save workflow state
 * Call this periodically (every 30 seconds) or on major actions
 */
export async function autoSaveWorkflowBatch(
  batchId: string | null,
  batchNumber: string,
  workflowState: WorkflowBatch['workflow_state']
): Promise<string | null> {
  try {
    const stats = calculateWorkflowStats(workflowState);
    const currentStep = determineCurrentStep(workflowState);

    if (batchId) {
      // Blind UPDATE — no pre-flight SELECT round-trip.
      // If the batch no longer exists the update silently affects 0 rows; we
      // detect that by checking the returned data array length.
      const { data: updated, error: updateError } = await supabase
        .from('workflow_batches')
        .update({
          workflow_state: workflowState,
          current_step: currentStep,
          last_opened_at: new Date().toISOString(),
          ...stats,
        })
        .eq('id', batchId)
        .select('id');

      if (!updateError && updated && updated.length > 0) {
        // Update succeeded
        return batchId;
      } else if (!updateError && (!updated || updated.length === 0)) {
        // UPDATE affected 0 rows. Two very different causes:
        //  (a) the batch row was genuinely DELETED → create a fresh one.
        //  (b) the row still EXISTS but RLS blocked our UPDATE because we don't own it.
        //      Shared workspace: anyone can open/SELECT any batch, but only the owner
        //      can UPDATE. Creating a new batch here would silently FORK the batch into
        //      a duplicate under the current user — the exact duplicate-spawning bug.
        // SELECT is open to all authenticated users, so it finds the row in case (b)
        // but returns nothing in case (a) — that's how we tell them apart.
        const { data: existing } = await supabase
          .from('workflow_batches')
          .select('id')
          .eq('id', batchId)
          .maybeSingle();
        if (existing) {
          // Case (b): batch exists but isn't ours — do NOT fork a duplicate.
          // Keep pointing at the same batch; this edit just won't persist.
          console.warn(
            `autoSaveWorkflowBatch: batch ${batchId} exists but UPDATE affected 0 rows ` +
            `(not owned by current user) — skipping save, NOT creating a duplicate`,
          );
          return batchId;
        }
        // Case (a): genuinely gone — create a fresh one.
        console.warn(`Batch ${batchId} no longer exists, creating new batch`);
        const batch = await createWorkflowBatch(batchNumber, workflowState, stats);
        return batch?.id || null;
      } else {
        // Real DB error — surface it so outer catch logs it
        throw updateError;
      }
    } else {
      // Create new batch
      const batch = await createWorkflowBatch(batchNumber, workflowState, stats);
      return batch?.id || null;
    }
  } catch (error) {
    console.error('Error auto-saving workflow batch:', error);
    return null;
  }
}

/**
 * Calculate workflow statistics from state.
 * Uses the most-progressed image list as the source of truth so counts
 * always match what is actually loaded when the batch is opened.
 */
function calculateWorkflowStats(workflowState: WorkflowBatch['workflow_state']) {
  const uploadedImages = workflowState?.uploadedImages || [];
  const groupedImages  = workflowState?.groupedImages  || [];
  const sortedImages   = workflowState?.sortedImages   || [];
  const processedItems = workflowState?.processedItems || [];

  // Pick the most-progressed list as the single source of truth for counts.
  // This prevents the card from showing uploadedImages.length (all individual images)
  // when the user has already grouped them into fewer listings.
  const liveItems =
    processedItems.length > 0 ? processedItems :
    sortedImages.length   > 0 ? sortedImages   :
    groupedImages.length  > 0 ? groupedImages  :
    uploadedImages;

  // Count unique product groups from the live list
  const productGroups = new Set<string>();
  liveItems.forEach(item => {
    const groupId = item.productGroup || item.id;
    productGroups.add(groupId);
  });

  // Total images = all individual images across every group
  const totalImages = liveItems.length || uploadedImages.length;

  // Count categorized items
  const categorizedCount = liveItems.filter(item => item.category).length;

  // Count processed items (with descriptions) — SlimItems don't carry descriptions,
  // so we use category as a proxy for "processed"
  const processedCount = processedItems.filter(
    item => item.category
  ).length;

  return {
    total_images: totalImages,
    product_groups_count: productGroups.size,
    categorized_count: categorizedCount,
    processed_count: processedCount,
  };
}

/**
 * Determine which step the workflow is currently on.
 * Steps (post-merge of old Steps 2+3):
 *   1 = Upload Images
 *   2 = Group & Categorize  (groupedImages exist)
 *   3 = Add Descriptions    (processedItems exist with voice/generated descriptions)
 *   4 = Save & Export       (processedItems with descriptions complete)
 */
function determineCurrentStep(workflowState: WorkflowBatch['workflow_state']): number {
  if (!workflowState) return 1;

  const { uploadedImages, groupedImages, sortedImages, processedItems } = workflowState;

  // Step 4: All items are categorized (descriptions done — we no longer store descriptions
  // in workflow_state, so use "all items have a category" as the step-4 signal)
  if (processedItems && processedItems.length > 0 &&
      processedItems.every(item => item.category)) {
    return 4;
  }

  // Step 3: Some items started but not all categorized
  if (processedItems && processedItems.length > 0 &&
      processedItems.some(item => item.category)) {
    return 3;
  }

  // Step 2: Items exist (grouping started)
  if (processedItems && processedItems.length > 0) {
    return 2;
  }

  // Legacy format fallbacks
  if ((groupedImages && groupedImages.length > 0) ||
      (sortedImages && sortedImages.length > 0)) {
    return 2;
  }

  if (uploadedImages && uploadedImages.length > 0) {
    return 1;
  }

  return 1;
}
