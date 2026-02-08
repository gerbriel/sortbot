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
 * Fetch all saved products (product groups) from database
 * Returns products with their images from the products and product_images tables
 */
export const fetchSavedProducts = async () => {
  try {
    const { data: products, error } = await supabase
      .from('products')
      .select(`
        *,
        product_images (
          id,
          image_url,
          storage_path,
          position,
          alt_text,
          created_at
        )
      `)
      .order('created_at', { ascending: false });
    
    if (error) {
      console.error('Error fetching saved products:', error);
      return [];
    }
    
    return products || [];
  } catch (error) {
    console.error('Error fetching saved products:', error);
    return [];
  }
};

/**
 * Fetch all saved images from database
 * Returns all product_images with their parent product info
 */
export const fetchSavedImages = async () => {
  try {
    const { data: images, error } = await supabase
      .from('product_images')
      .select(`
        *,
        products (
          id,
          title,
          product_category,
          vendor,
          batch_id
        )
      `)
      .order('created_at', { ascending: false });
    
    if (error) {
      console.error('Error fetching saved images:', error);
      return [];
    }
    
    return images || [];
  } catch (error) {
    console.error('Error fetching saved images:', error);
    return [];
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
    // 1. Delete from products table (CASCADE will delete product_images)
    const { error: productError } = await supabase
      .from('products')
      .delete()
      .eq('id', groupId);
    
    if (productError && productError.code !== 'PGRST116') { // PGRST116 = no rows found (OK)
      console.error('Error deleting product:', productError);
    }
    
    // 2. Fetch all batches and remove from workflow_state
    const batches = await fetchWorkflowBatches();
    
    const updatePromises = batches.map(async (batch) => {
      let modified = false;
      const updatedState = { ...batch.workflow_state };
      
      // Remove items from all arrays
      ['uploadedImages', 'groupedImages', 'sortedImages', 'processedItems'].forEach(key => {
        const items = updatedState[key as keyof typeof updatedState];
        if (Array.isArray(items)) {
          const filtered = items.filter((item: any) => {
            const itemGroup = item.productGroup || item.id;
            return itemGroup !== groupId;
          });
          
          if (filtered.length !== items.length) {
            modified = true;
            (updatedState as any)[key] = filtered;
          }
        }
      });
      
      // Only update if something changed
      if (modified) {
        return updateWorkflowBatch(batch.id, { workflow_state: updatedState });
      }
      return true;
    });
    
    await Promise.all(updatePromises);
    
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
    
    // 3. Fetch all batches and remove image from workflow_state
    const batches = await fetchWorkflowBatches();
    
    const updatePromises = batches.map(async (batch) => {
      let modified = false;
      const updatedState = { ...batch.workflow_state };
      
      // Remove from all arrays
      ['uploadedImages', 'groupedImages', 'sortedImages', 'processedItems'].forEach(key => {
        const items = updatedState[key as keyof typeof updatedState];
        if (Array.isArray(items)) {
          const filtered = items.filter((item: any) => item.id !== imageId);
          
          if (filtered.length !== items.length) {
            modified = true;
            (updatedState as any)[key] = filtered;
          }
        }
      });
      
      // Only update if something changed
      if (modified) {
        return updateWorkflowBatch(batch.id, { workflow_state: updatedState });
      }
      return true;
    });
    
    await Promise.all(updatePromises);
    
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
  imageId: string,
  updates: {
    category?: string;
    productGroup?: string;
    seoTitle?: string;
    brand?: string;
    size?: string;
  }
): Promise<boolean> => {
  try {
    // Fetch all batches and update the image
    const batches = await fetchWorkflowBatches();
    
    const updatePromises = batches.map(async (batch) => {
      let modified = false;
      const updatedState = { ...batch.workflow_state };
      
      // Update in all arrays
      ['uploadedImages', 'groupedImages', 'sortedImages', 'processedItems'].forEach(key => {
        const items = updatedState[key as keyof typeof updatedState];
        if (Array.isArray(items)) {
          const updated = items.map((item: any) => {
            if (item.id === imageId) {
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
    return true;
  } catch (error) {
    console.error('Error updating image:', error);
    return false;
  }
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
