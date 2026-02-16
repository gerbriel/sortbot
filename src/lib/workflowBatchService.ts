import { supabase } from './supabase';
import type { ClothingItem } from '../App';

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
    processedItems?: ClothingItem[];
  };
  thumbnail_url?: string;
  created_at: string;
  updated_at: string;
  last_opened_at?: string;
  tags?: string[];
  notes?: string;
}

/**
 * Fetch all workflow batches (collaborative - all users see all batches)
 */
export async function fetchWorkflowBatches(): Promise<WorkflowBatch[]> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    const { data, error } = await supabase
      .from('workflow_batches')
      .select('*')
      .order('updated_at', { ascending: false });

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('Error fetching workflow batches:', error);
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

    // Get thumbnail from first image
    const firstImage = workflowState?.uploadedImages?.[0] || 
                       workflowState?.groupedImages?.[0] || 
                       workflowState?.sortedImages?.[0] || 
                       workflowState?.processedItems?.[0];
    
    const thumbnail_url = firstImage?.preview || firstImage?.imageUrls?.[0];

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
 * Delete a workflow batch
 */
export async function deleteWorkflowBatch(batchId: string): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('workflow_batches')
      .delete()
      .eq('id', batchId);

    if (error) throw error;
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
      .single();

    if (error) throw error;
    
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
  console.log('🔧 autoSaveWorkflowBatch called:', {
    batchId,
    batchNumber,
    processedItemsCount: workflowState?.processedItems?.length || 0,
    withVoice: workflowState?.processedItems?.filter(i => i.voiceDescription).length || 0,
    withGenerated: workflowState?.processedItems?.filter(i => i.generatedDescription).length || 0
  });
  
  try {
    const stats = calculateWorkflowStats(workflowState);
    const currentStep = determineCurrentStep(workflowState);

    if (batchId) {
      // Update existing batch
      console.log('📝 Updating existing batch:', batchId);
      await updateWorkflowBatch(batchId, {
        workflow_state: workflowState,
        current_step: currentStep,
        ...stats,
      });
      console.log('✅ Batch updated successfully');
      return batchId;
    } else {
      // Create new batch
      console.log('🆕 Creating new batch:', batchNumber);
      const batch = await createWorkflowBatch(batchNumber, workflowState, stats);
      console.log('✅ New batch created:', batch?.id);
      return batch?.id || null;
    }
  } catch (error) {
    console.error('❌ Error auto-saving workflow batch:', error);
    return null;
  }
}

/**
 * Calculate workflow statistics from state
 */
function calculateWorkflowStats(workflowState: WorkflowBatch['workflow_state']) {
  const uploadedImages = workflowState?.uploadedImages || [];
  const groupedImages = workflowState?.groupedImages || [];
  const sortedImages = workflowState?.sortedImages || [];
  const processedItems = workflowState?.processedItems || [];

  // Count unique product groups
  const productGroups = new Set<string>();
  groupedImages.forEach(item => {
    const groupId = item.productGroup || item.id;
    productGroups.add(groupId);
  });

  // Count categorized items
  const categorizedCount = sortedImages.filter(item => item.category).length;

  // Count processed items (with descriptions)
  const processedCount = processedItems.filter(
    item => item.voiceDescription && item.generatedDescription
  ).length;

  return {
    total_images: uploadedImages.length,
    product_groups_count: productGroups.size,
    categorized_count: categorizedCount,
    processed_count: processedCount,
  };
}

/**
 * Determine which step the workflow is currently on
 */
function determineCurrentStep(workflowState: WorkflowBatch['workflow_state']): number {
  if (!workflowState) return 1;

  const { uploadedImages, groupedImages, sortedImages, processedItems } = workflowState;

  // Step 5: Has processed items (completed descriptions)
  if (processedItems && processedItems.length > 0) {
    return 5;
  }

  // Step 4: Has sorted/categorized images
  if (sortedImages && sortedImages.length > 0 && sortedImages.some(item => item.category)) {
    return 4;
  }

  // Step 3: Has grouped images
  if (groupedImages && groupedImages.length > 0) {
    return 3;
  }

  // Step 2: Has uploaded images
  if (uploadedImages && uploadedImages.length > 0) {
    return 2;
  }

  // Step 1: Default
  return 1;
}
