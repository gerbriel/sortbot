// Export Library Service
// Manages CSV export batches and tracks export history

import { supabase } from './supabase';
import type { ClothingItem } from '../App';

// ============================================================================
// TYPES
// ============================================================================

export type ExportStatus = 
  | 'pending'      // Created but not yet exported
  | 'exported'     // CSV generated and downloaded
  | 'uploaded'     // Uploaded to Shopify
  | 'processing'   // Being processed by Shopify
  | 'completed'    // Successfully imported to Shopify
  | 'failed'       // Import failed
  | 'archived';    // Old export, archived

export type ExportItemStatus =
  | 'pending'
  | 'exported'
  | 'imported'
  | 'failed'
  | 'skipped';

export interface ExportBatch {
  id: string;
  user_id: string;
  batch_name: string;
  batch_number: number;
  description?: string;
  product_count: number;
  total_value: number;
  csv_file_name: string;
  csv_storage_path?: string;
  file_size_bytes?: number;
  status: ExportStatus;
  shopify_import_id?: string;
  shopify_status?: string;
  shopify_error_message?: string;
  shopify_imported_count?: number;
  shopify_failed_count?: number;
  created_at: string;
  exported_at?: string;
  uploaded_at?: string;
  completed_at?: string;
  updated_at: string;
  tags?: string[];
  notes?: string;
}

export interface ExportBatchItem {
  id: string;
  export_batch_id: string;
  product_id?: string;
  row_number: number;
  csv_data: Record<string, any>; // 62 Shopify CSV columns
  title?: string;
  handle?: string;
  vendor?: string;
  product_type?: string;
  price?: number;
  sku?: string;
  status: ExportItemStatus;
  shopify_product_id?: string;
  shopify_error?: string;
  created_at: string;
}

export interface CreateExportBatchParams {
  userId: string;
  batchName: string;
  description?: string;
  tags?: string[];
  notes?: string;
}

export interface ExportBatchWithItems extends ExportBatch {
  items: ExportBatchItem[];
}

// ============================================================================
// EXPORT BATCH OPERATIONS
// ============================================================================

/**
 * Create a new export batch
 */
export const createExportBatch = async (
  params: CreateExportBatchParams
): Promise<ExportBatch | null> => {
  try {
    // Get next batch number (global across all users)
    const { data: batchNumber, error: numberError } = await supabase
      .rpc('get_next_batch_number');

    if (numberError) {
      console.error('Error getting batch number:', numberError);
      return null;
    }

    // Generate CSV file name
    const timestamp = new Date().toISOString().split('T')[0];
    const csvFileName = `shopify_export_batch${batchNumber}_${timestamp}.csv`;

    // Create export batch
    const { data, error } = await supabase
      .from('export_batches')
      .insert({
        user_id: params.userId,
        batch_name: params.batchName,
        batch_number: batchNumber,
        description: params.description,
        tags: params.tags || [],
        notes: params.notes,
        csv_file_name: csvFileName,
        status: 'pending',
        product_count: 0,
        total_value: 0,
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating export batch:', error);
      return null;
    }

    return data;
  } catch (error) {
    console.error('Error in createExportBatch:', error);
    return null;
  }
};

/**
 * Add items (CSV rows) to an export batch
 */
export const addItemsToExportBatch = async (
  batchId: string,
  items: ClothingItem[],
  csvDataMapper: (item: ClothingItem) => Record<string, any>
): Promise<boolean> => {
  try {
    // Map items to export batch items
    const batchItems = items.map((item, index) => {
      const csvData = csvDataMapper(item);
      
      return {
        export_batch_id: batchId,
        product_id: item.id,
        row_number: index + 1,
        csv_data: csvData,
        // Extract quick-access fields from CSV data
        title: csvData['Title'],
        handle: csvData['URL handle'],
        vendor: csvData['Vendor / Brand'],
        product_type: csvData['Type'],
        price: parseFloat(csvData['Price']) || 0,
        sku: csvData['SKU'],
        status: 'pending' as ExportItemStatus,
      };
    });

    // Insert all items
    const { error } = await supabase
      .from('export_batch_items')
      .insert(batchItems);

    if (error) {
      console.error('Error adding items to export batch:', error);
      return false;
    }

    // Update batch statistics
    await supabase.rpc('update_export_batch_stats', { p_batch_id: batchId });

    return true;
  } catch (error) {
    console.error('Error in addItemsToExportBatch:', error);
    return false;
  }
};

/**
 * Mark export batch as exported (CSV downloaded)
 */
export const markBatchExported = async (
  batchId: string,
  csvStoragePath?: string,
  fileSizeBytes?: number
): Promise<boolean> => {
  try {
    const { error } = await supabase
      .from('export_batches')
      .update({
        status: 'exported',
        exported_at: new Date().toISOString(),
        csv_storage_path: csvStoragePath,
        file_size_bytes: fileSizeBytes,
      })
      .eq('id', batchId);

    if (error) {
      console.error('Error marking batch exported:', error);
      return false;
    }

    // Update all items status
    await supabase
      .from('export_batch_items')
      .update({ status: 'exported' })
      .eq('export_batch_id', batchId);

    return true;
  } catch (error) {
    console.error('Error in markBatchExported:', error);
    return false;
  }
};

/**
 * Get all export batches for a user
/**
 * Fetch all export batches (collaborative - all users see all batches)
 */
export const fetchUserExportBatches = async (
  userId: string
): Promise<ExportBatch[]> => {
  try {
    const { data, error } = await supabase
      .from('export_batches')
      .select('*')
      .order('batch_number', { ascending: false });

    if (error) {
      console.error('Error fetching export batches:', error);
      return [];
    }

    return data || [];
  } catch (error) {
    console.error('Error in fetchUserExportBatches:', error);
    return [];
  }
};

/**
 * Get a single export batch with all its items
 */
export const fetchExportBatchWithItems = async (
  batchId: string
): Promise<ExportBatchWithItems | null> => {
  try {
    // Fetch batch
    const { data: batch, error: batchError } = await supabase
      .from('export_batches')
      .select('*')
      .eq('id', batchId)
      .single();

    if (batchError || !batch) {
      console.error('Error fetching export batch:', batchError);
      return null;
    }

    // Fetch items
    const { data: items, error: itemsError } = await supabase
      .from('export_batch_items')
      .select('*')
      .eq('export_batch_id', batchId)
      .order('row_number', { ascending: true });

    if (itemsError) {
      console.error('Error fetching batch items:', itemsError);
      return null;
    }

    return {
      ...batch,
      items: items || [],
    };
  } catch (error) {
    console.error('Error in fetchExportBatchWithItems:', error);
    return null;
  }
};

/**
 * Update export batch status
 */
export const updateExportBatchStatus = async (
  batchId: string,
  status: ExportStatus,
  shopifyData?: {
    shopifyImportId?: string;
    shopifyStatus?: string;
    shopifyErrorMessage?: string;
    shopifyImportedCount?: number;
    shopifyFailedCount?: number;
  }
): Promise<boolean> => {
  try {
    const updates: any = { status };

    // Add timestamp based on status
    if (status === 'uploaded') {
      updates.uploaded_at = new Date().toISOString();
    } else if (status === 'completed') {
      updates.completed_at = new Date().toISOString();
    }

    // Add Shopify data if provided
    if (shopifyData) {
      Object.assign(updates, {
        shopify_import_id: shopifyData.shopifyImportId,
        shopify_status: shopifyData.shopifyStatus,
        shopify_error_message: shopifyData.shopifyErrorMessage,
        shopify_imported_count: shopifyData.shopifyImportedCount,
        shopify_failed_count: shopifyData.shopifyFailedCount,
      });
    }

    const { error } = await supabase
      .from('export_batches')
      .update(updates)
      .eq('id', batchId);

    if (error) {
      console.error('Error updating batch status:', error);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Error in updateExportBatchStatus:', error);
    return false;
  }
};

/**
 * Delete an export batch and all its items
 */
export const deleteExportBatch = async (batchId: string): Promise<boolean> => {
  try {
    const { error } = await supabase
      .from('export_batches')
      .delete()
      .eq('id', batchId);

    if (error) {
      console.error('Error deleting export batch:', error);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Error in deleteExportBatch:', error);
    return false;
  }
};

/**
/**
 * Search export batches by tags (collaborative - all users see all batches)
 */
export const searchExportBatchesByTags = async (
  userId: string,
  tags: string[]
): Promise<ExportBatch[]> => {
  try {
    const { data, error } = await supabase
      .from('export_batches')
      .select('*')
      .overlaps('tags', tags)
      .order('batch_number', { ascending: false });

    if (error) {
      console.error('Error searching batches by tags:', error);
      return [];
    }

    return data || [];
  } catch (error) {
    console.error('Error in searchExportBatchesByTags:', error);
    return [];
  }
};

/**
 * Get export statistics for a user
 */
export const fetchUserExportStats = async (
  userId: string
): Promise<{
  totalExports: number;
  totalProductsExported: number;
  totalValueExported: number;
  completedExports: number;
  pendingExports: number;
} | null> => {
  try {
    const { data, error } = await supabase
      .from('export_batches')
      .select('status, product_count, total_value');

    if (error) {
      console.error('Error fetching export stats:', error);
      return null;
    }

    const stats = {
      totalExports: data.length,
      totalProductsExported: data.reduce((sum, b) => sum + b.product_count, 0),
      totalValueExported: data.reduce((sum, b) => sum + parseFloat(b.total_value || '0'), 0),
      completedExports: data.filter(b => b.status === 'completed').length,
      pendingExports: data.filter(b => b.status === 'pending' || b.status === 'exported').length,
    };

    return stats;
  } catch (error) {
    console.error('Error in fetchUserExportStats:', error);
    return null;
  }
};

/**
 * Regenerate CSV from stored batch data
 */
export const regenerateCSVFromBatch = async (
  batchId: string
): Promise<string | null> => {
  try {
    const batchWithItems = await fetchExportBatchWithItems(batchId);
    if (!batchWithItems) return null;

    // Get the first item to determine CSV headers
    if (batchWithItems.items.length === 0) return null;
    
    const firstItem = batchWithItems.items[0];
    const headers = Object.keys(firstItem.csv_data);

    // Generate CSV content
    let csv = headers.join(',') + '\n';
    
    batchWithItems.items.forEach(item => {
      const row = headers.map(header => {
        const value = item.csv_data[header] || '';
        // Escape commas and quotes
        if (typeof value === 'string' && (value.includes(',') || value.includes('"') || value.includes('\n'))) {
          return `"${value.replace(/"/g, '""')}"`;
        }
        return value;
      });
      csv += row.join(',') + '\n';
    });

    return csv;
  } catch (error) {
    console.error('Error in regenerateCSVFromBatch:', error);
    return null;
  }
};

/**
 * Update batch tags
 */
export const updateExportBatchTags = async (
  batchId: string,
  tags: string[]
): Promise<boolean> => {
  try {
    const { error } = await supabase
      .from('export_batches')
      .update({ tags })
      .eq('id', batchId);

    if (error) {
      console.error('Error updating batch tags:', error);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Error in updateExportBatchTags:', error);
    return false;
  }
};

/**
 * Update batch notes
 */
export const updateExportBatchNotes = async (
  batchId: string,
  notes: string
): Promise<boolean> => {
  try {
    const { error } = await supabase
      .from('export_batches')
      .update({ notes })
      .eq('id', batchId);

    if (error) {
      console.error('Error updating batch notes:', error);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Error in updateExportBatchNotes:', error);
    return false;
  }
};
