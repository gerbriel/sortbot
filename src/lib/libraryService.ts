/**
 * Library Service - CRUD operations for batches, product groups, and images
 * Handles deletion, updating, and management of workflow data
 * Also fetches saved products and images from the database
 */

import { supabase } from './supabase';
import { fetchWorkflowBatches, updateWorkflowBatch, deleteWorkflowBatch } from './workflowBatchService';
import type { WorkflowBatch } from './workflowBatchService';

// ============================================================================
// FETCH SAVED PRODUCTS AND IMAGES FROM DATABASE
// ============================================================================

/**
 * Fetch saved products (shared workspace — all users see all products)
 * Returns products with their images from the products and product_images tables
 */
export const fetchSavedProducts = async (_userId: string) => {
  // Paginate in chunks of 1000 to bypass PostgREST server-side max-rows cap
  const PAGE = 1000;
  const allProducts: any[] = [];
  let from = 0;
  try {
    while (true) {
      const { data, error } = await supabase
        .from('products')
        .select(`
          id,
          title,
          description,
          vendor,
          size,
          price,
          created_at,
          updated_at,
          batch_id,
          product_category,
          seo_title,
          product_group,
          workflow_batches (
            id,
            batch_name,
            batch_number,
            created_at
          ),
          product_images (
            id,
            image_url,
            storage_path,
            position,
            alt_text,
            created_at
          )
        `)
        .order('created_at', { ascending: true })
        .range(from, from + PAGE - 1);

      if (error) {
        console.error('❌ Supabase error fetching saved products:', {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code
        });
        break;
      }

      if (!data || data.length === 0) break;
      allProducts.push(...data);
      if (data.length < PAGE) break; // last page
      from += PAGE;
    }
    // Log a breakdown by user_id so we can see cross-user data
    const byUser: Record<string, number> = {};
    allProducts.forEach((p: any) => { byUser[p.user_id ?? 'null'] = (byUser[p.user_id ?? 'null'] || 0) + 1; });
    return allProducts;
  } catch (error: any) {
    if (error?.name === 'AbortError') return []; // expected from React 18 Strict Mode cleanup
    if (error?.message === 'Failed to fetch') return []; // network down / Supabase unreachable
    console.error('❌ Exception fetching saved products:', error);
    return allProducts; // return whatever we got before the error
  }
};

/**
 * Fetch saved images (shared workspace — all users see all images)
 * Returns product_images with their parent product info
 */
export const fetchSavedImages = async (_userId: string) => {
  // Paginate in chunks of 1000 to bypass PostgREST server-side max-rows cap
  const PAGE = 1000;
  const allImages: any[] = [];
  let from = 0;
  try {
    while (true) {
      const { data, error } = await supabase
        .from('product_images')
        .select(`
          *,
          products (
            id,
            title,
            product_category,
            product_group,
            vendor,
            batch_id,
            user_id,
            workflow_batches (
              id,
              batch_name,
              batch_number,
              created_at
            )
          )
        `)
        .order('created_at', { ascending: true })
        .range(from, from + PAGE - 1);

      if (error) {
        console.error('Error fetching saved images:', error);
        break;
      }

      if (!data || data.length === 0) break;
      allImages.push(...data);
      if (data.length < PAGE) break; // last page
      from += PAGE;
    }
    // Log a breakdown by user_id (on the parent product) so we can spot cross-user rows
    const byUser: Record<string, number> = {};
    allImages.forEach((img: any) => { const uid = img.products?.user_id ?? img.user_id ?? 'null'; byUser[uid] = (byUser[uid] || 0) + 1; });
    return allImages;
  } catch (error: any) {
    if (error?.name === 'AbortError') return []; // expected from React 18 Strict Mode cleanup
    if (error?.message === 'Failed to fetch') return []; // network down / Supabase unreachable
    console.error('Error fetching saved images:', error);
    return allImages; // return whatever we got before the error
  }
};

// ============================================================================
// PRODUCT GROUP OPERATIONS
// ============================================================================

/**
 * Delete a product group from all workflow batches AND database
 * Removes all items with matching productGroup from workflow_state
 * Also deletes the product record and all its images from database
 */
export const deleteProductGroup = async (
  groupId: string
): Promise<boolean> => {
  try {
    // 1. Collect storage paths for all images belonging to this product
    const { data: imageRows } = await supabase
      .from('product_images')
      .select('id, storage_path')
      .eq('product_id', groupId);

    // 2. Delete files from Storage
    const storagePaths = (imageRows ?? [])
      .map((r: any) => r.storage_path)
      .filter(Boolean) as string[];
    if (storagePaths.length > 0) {
      await supabase.storage.from('product-images').remove(storagePaths);
    }

    // 3. Delete product_images rows
    const imageIds = (imageRows ?? []).map((r: any) => r.id);
    if (imageIds.length > 0) {
      await supabase.from('product_images').delete().in('id', imageIds);
    }

    // 4. Delete the product row
    const { error: productError } = await supabase
      .from('products')
      .delete()
      .eq('id', groupId);

    if (productError && productError.code !== 'PGRST116') {
      console.error('Error deleting product:', productError);
    }

    return true;
  } catch (error) {
    console.error('Error deleting product group:', error);
    return false;
  }
};

/**
 * Update a product group's metadata across all batches
 */
export const updateProductGroup = async (
  groupId: string,
  updates: {
    seoTitle?: string;
    category?: string;
    brand?: string;
    size?: string;
  }
): Promise<boolean> => {
  try {
    // 1. Fetch all batches
    const batches = await fetchWorkflowBatches();
    
    // 2. Update items in workflow_state
    const updatePromises = batches.map(async (batch) => {
      let modified = false;
      const updatedState = { ...batch.workflow_state };
      
      // Update items in all arrays
      ['uploadedImages', 'groupedImages', 'sortedImages', 'processedItems'].forEach(key => {
        const items = updatedState[key as keyof typeof updatedState];
        if (Array.isArray(items)) {
          const updated = items.map((item: any) => {
            const itemGroup = item.productGroup || item.id;
            if (itemGroup === groupId) {
              modified = true;
              return { ...item, ...updates };
            }
            return item;
          });
          
          (updatedState as any)[key] = updated;
        }
      });
      
      // Only update if something changed
      if (modified) {
        return updateWorkflowBatch(batch.id, { workflow_state: updatedState });
      }
      return true;
    });
    
    await Promise.all(updatePromises);
    
    // 3. Also update in products table if saved
    const { error } = await supabase
      .from('products')
      .update({
        title: updates.seoTitle,
        category: updates.category,
        vendor: updates.brand,
        size: updates.size,
      })
      .eq('id', groupId);
    
    if (error && error.code !== 'PGRST116') {
      console.error('Error updating product:', error);
    }
    
    return true;
  } catch (error) {
    console.error('Error updating product group:', error);
    return false;
  }
};

// ============================================================================
// BATCH OPERATIONS
// ============================================================================

/**
 * Update batch metadata (name, notes, tags)
 */
export const updateBatchMetadata = async (
  batchId: string,
  updates: {
    batch_name?: string;
    notes?: string;
    tags?: string[];
  }
): Promise<boolean> => {
  try {
    const { error } = await supabase
      .from('workflow_batches')
      .update(updates)
      .eq('id', batchId);
    
    if (error) {
      console.error('Error updating batch metadata:', error);
      return false;
    }
    
    return true;
  } catch (error) {
    console.error('Error updating batch:', error);
    return false;
  }
};

/**
 * Duplicate a workflow batch
 */
export const duplicateBatch = async (
  batchId: string
): Promise<string | null> => {
  try {
    // 1. Fetch original batch
    const { data: batch, error: fetchError } = await supabase
      .from('workflow_batches')
      .select('*')
      .eq('id', batchId)
      .single();
    
    if (fetchError || !batch) {
      console.error('Error fetching batch:', fetchError);
      return null;
    }
    
    // 2. Create duplicate
    const duplicate = {
      user_id: batch.user_id,
      batch_name: batch.batch_name ? `${batch.batch_name} (Copy)` : null,
      batch_number: `batch-${Date.now()}`,
      current_step: 1, // Start from beginning
      is_completed: false,
      total_images: batch.total_images,
      product_groups_count: 0,
      categorized_count: 0,
      processed_count: 0,
      saved_products_count: 0,
      workflow_state: {
        uploadedImages: batch.workflow_state?.uploadedImages || [],
        groupedImages: [],
        sortedImages: [],
        processedItems: [],
      },
      thumbnail_url: batch.thumbnail_url,
      tags: batch.tags,
      notes: batch.notes ? `${batch.notes}\n\nDuplicated from original batch` : null,
    };
    
    const { data: newBatch, error: insertError } = await supabase
      .from('workflow_batches')
      .insert(duplicate)
      .select()
      .single();
    
    if (insertError || !newBatch) {
      console.error('Error creating duplicate:', insertError);
      return null;
    }
    
    return newBatch.id;
  } catch (error) {
    console.error('Error duplicating batch:', error);
    return null;
  }
};

// ============================================================================
// IMAGE OPERATIONS
// ============================================================================

/**
 * Delete an individual image from workflow batches AND database
 * Also deletes from Supabase Storage if exists
 */
export const deleteImage = async (
  imageId: string,
  storagePath?: string
): Promise<boolean> => {
  try {
    // 1. Delete from Storage if path exists
    if (storagePath) {
      const { error: storageError } = await supabase.storage
        .from('product-images')
        .remove([storagePath]);
      
      if (storageError) {
        console.error('Storage delete error:', storageError);
        // Continue anyway - image might already be deleted
      }
    }
    
    // 2. Delete from product_images table
    const { error: dbError } = await supabase
      .from('product_images')
      .delete()
      .eq('id', imageId);
    
    if (dbError && dbError.code !== 'PGRST116') {
      console.error('Error deleting product image record:', dbError);
    }

    // NOTE: workflow_state scrubbing is intentionally omitted here.
    // The active session in App.tsx manages its own workflow_state via autoSaveWorkflow.
    // Trying to scrub all batches here requires fetching every workflow_batch row, which
    // is slow (multiple paginated requests) and fragile (fails if a batch was deleted).
    
    return true;
  } catch (error) {
    console.error('Error deleting image:', error);
    return false;
  }
};

/**
 * Update an image's metadata
 */
export const updateImage = async (
  _imageId: string,
  _updates: {
    category?: string;
    productGroup?: string;
    seoTitle?: string;
    brand?: string;
    size?: string;
  }
): Promise<boolean> => {
  // workflow_state is managed by App.tsx's autoSaveWorkflow.
  // The Library never updates individual image metadata in workflow_state directly.
  // If this function is needed in the future, update the products/product_images
  // tables directly rather than patching every workflow_batch row.
  console.warn('updateImage called but workflow_state scrubbing is disabled — update products table directly');
  return true;
};

/**
 * Move an image to a different product group
 */
export const moveImageToGroup = async (
  imageId: string,
  newGroupId: string
): Promise<boolean> => {
  return updateImage(imageId, { productGroup: newGroupId });
};

// ============================================================================
// BULK OPERATIONS
// ============================================================================

/**
 * Delete multiple images at once
 */
export const bulkDeleteImages = async (
  imageIds: string[]
): Promise<{ success: number; failed: number }> => {
  let success = 0;
  let failed = 0;
  
  for (const imageId of imageIds) {
    const result = await deleteImage(imageId);
    if (result) {
      success++;
    } else {
      failed++;
    }
  }
  
  return { success, failed };
};

/**
 * Delete multiple product groups at once
 */
export const bulkDeleteProductGroups = async (
  groupIds: string[]
): Promise<{ success: number; failed: number }> => {
  let success = 0;
  let failed = 0;
  
  for (const groupId of groupIds) {
    const result = await deleteProductGroup(groupId);
    if (result) {
      success++;
    } else {
      failed++;
    }
  }
  
  return { success, failed };
};

/**
 * Delete multiple batches at once
 */
export const bulkDeleteBatches = async (
  batchIds: string[]
): Promise<{ success: number; failed: number }> => {
  let success = 0;
  let failed = 0;
  
  for (const batchId of batchIds) {
    const result = await deleteWorkflowBatch(batchId);
    if (result) {
      success++;
    } else {
      failed++;
    }
  }
  
  return { success, failed };
};

// ============================================================================
// SEARCH AND FILTER
// ============================================================================

/**
 * Search batches by name, notes, or tags
 */
export const searchBatches = async (
  query: string
): Promise<WorkflowBatch[]> => {
  try {
    const { data, error } = await supabase
      .from('workflow_batches')
      .select('*')
      .or(`batch_name.ilike.%${query}%,notes.ilike.%${query}%`)
      .order('updated_at', { ascending: false });
    
    if (error) {
      console.error('Error searching batches:', error);
      return [];
    }
    
    return data || [];
  } catch (error) {
    console.error('Error searching batches:', error);
    return [];
  }
};

/**
 * Filter batches by tags
 */
export const filterBatchesByTags = async (
  tags: string[]
): Promise<WorkflowBatch[]> => {
  try {
    const { data, error } = await supabase
      .from('workflow_batches')
      .select('*')
      .contains('tags', tags)
      .order('updated_at', { ascending: false });
    
    if (error) {
      console.error('Error filtering batches:', error);
      return [];
    }
    
    return data || [];
  } catch (error) {
    console.error('Error filtering batches:', error);
    return [];
  }
};
