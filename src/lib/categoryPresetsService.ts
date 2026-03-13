// Category Presets Database Service
import { supabase } from './supabase';
import type { CategoryPreset, CategoryPresetInput } from './categoryPresets';

/**
 * Fetch all category presets for the current user
 * Includes both user's own presets AND system defaults
 */
export async function getCategoryPresets(): Promise<CategoryPreset[]> {
  const { data, error } = await supabase
    .from('category_presets')
    .select('*')
    .eq('is_active', true)
    .order('display_name', { ascending: true });

  if (error) {
    throw error;
  }

  return data || [];
}

/**
 * Fetch a single category preset by name
 */
export async function getCategoryPresetByName(categoryName: string): Promise<CategoryPreset | null> {
  const { data, error } = await supabase
    .from('category_presets')
    .select('*')
    .eq('category_name', categoryName)
    .eq('is_active', true)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      // No rows returned
      return null;
    }
    throw error;
  }

  return data;
}

/**
 * Create a new category preset
 */
export async function createCategoryPreset(preset: CategoryPresetInput): Promise<CategoryPreset> {
  const { data: { user } } = await supabase.auth.getUser();
  
  if (!user) {
    throw new Error('User must be authenticated to create category presets');
  }

  const { data, error } = await supabase
    .from('category_presets')
    .insert({
      ...preset,
      user_id: user.id,
    })
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data;
}

/**
 * Update an existing category preset
 */
export async function updateCategoryPreset(
  id: string,
  updates: Partial<CategoryPresetInput>
): Promise<CategoryPreset> {
  const { data, error } = await supabase
    .from('category_presets')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data;
}

/**
 * Delete a category preset (soft delete by setting is_active to false)
 */
export async function deleteCategoryPreset(id: string): Promise<void> {
  const { error } = await supabase
    .from('category_presets')
    .update({ is_active: false })
    .eq('id', id);

  if (error) {
    throw error;
  }
}

/**
 * Permanently delete a category preset
 */
export async function permanentlyDeleteCategoryPreset(id: string): Promise<void> {
  const { error } = await supabase
    .from('category_presets')
    .delete()
    .eq('id', id);

  if (error) {
    throw error;
  }
}

/**
 * Apply category preset to product data
 */
export function applyCategoryPreset(
  productData: any,
  preset: CategoryPreset
): any {
  return {
    ...productData,
    // Apply weight if not already set
    weight_value: productData.weight_value || preset.default_weight_value,
    weight_unit: productData.weight_unit || preset.default_weight_unit,
    requires_shipping: productData.requires_shipping ?? preset.requires_shipping,
    
    // Apply product classification
    product_type: productData.product_type || preset.product_type,
    vendor: productData.vendor || preset.vendor,
    
    // Apply material and care
    material: productData.material || preset.default_material,
    care: productData.care || preset.default_care_instructions,
    
    // Apply Shopify fields
    shopify_product_type: productData.shopify_product_type || preset.shopify_product_type,
    shopify_collection_id: productData.shopify_collection_id || preset.shopify_collection_id,
    
    // Merge tags (add preset tags to existing tags)
    tags: [...new Set([...(productData.tags || []), ...(preset.default_tags || [])])],
    
    // Apply condition if not set
    condition: productData.condition || preset.typical_condition,
  };
}
