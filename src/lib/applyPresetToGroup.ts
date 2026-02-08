import type { ClothingItem } from '../App';
import type { CategoryPreset } from './categoryPresets';
import { getCategoryPresets } from './categoryPresetsService';

/**
 * Apply category preset data to a product group
 * Manual entries take precedence over preset values
 */
export async function applyPresetToProductGroup(
  items: ClothingItem[],
  categoryName: string
): Promise<ClothingItem[]> {
  try {
    // Get all presets for the user
    const presets = await getCategoryPresets();
    
    // Find matching preset for this category
    const preset = presets.find(
      p => p.category_name.toLowerCase() === categoryName.toLowerCase() && p.is_active
    );
    
    if (!preset) {
      console.log(`No active preset found for category: ${categoryName}`);
      // Still apply category even if no preset exists
      return items.map(item => ({
        ...item,
        category: categoryName
      }));
    }
    
    console.log(`Applying preset for category: ${categoryName}`, preset);
    
    // Apply preset values to items, but don't override existing manual entries
    return items.map(item => ({
      ...item,
      // IMPORTANT: Set the category field
      category: categoryName,
      
      // Price: use manual entry if exists, otherwise use preset suggestion
      price: item.price || (preset.suggested_price_min ? preset.suggested_price_min : undefined),
      
      // SEO Title: use preset template if no manual entry
      seoTitle: item.seoTitle || preset.seo_title_template || undefined,
      
      // Tags: merge preset keywords with existing tags
      tags: item.tags || (preset.seo_keywords ? [...preset.seo_keywords] : []),
      
      // Material: use preset default if no manual entry
      material: item.material || preset.default_material || undefined,
      
      // Care instructions: use preset if no manual entry
      care: item.care || preset.default_care_instructions || undefined,
      
      // Weight: use preset default if no manual entry
      weightValue: item.weightValue || preset.default_weight_value || undefined,
      
      // Product type: use preset for Shopify
      productType: item.productType || preset.shopify_product_type || undefined,
      
      // Vendor/Brand: use preset if specified
      brand: item.brand || preset.vendor || undefined,
      
      // Shipping & Packaging (from presets)
      packageDimensions: item.packageDimensions || preset.package_dimensions || undefined,
      parcelSize: item.parcelSize || preset.parcel_size || undefined,
      shipsFrom: item.shipsFrom || preset.ships_from || undefined,
      continueSellingOutOfStock: item.continueSellingOutOfStock ?? preset.continue_selling_out_of_stock,
      requiresShipping: item.requiresShipping ?? preset.requires_shipping,
      
      // Product Classification (from presets)
      sizeType: item.sizeType || preset.size_type || undefined,
      style: item.style || preset.style || undefined,
      gender: item.gender || preset.gender || undefined,
      ageGroup: item.ageGroup || preset.age_group || undefined,
      
      // Policies & Marketplace Info (from presets)
      policies: item.policies || preset.policies || undefined,
      renewalOptions: item.renewalOptions || preset.renewal_options || undefined,
      whoMadeIt: item.whoMadeIt || preset.who_made_it || undefined,
      whatIsIt: item.whatIsIt || preset.what_is_it || undefined,
      listingType: item.listingType || preset.listing_type || undefined,
      discountedShipping: item.discountedShipping || preset.discounted_shipping || undefined,
      
      // Google Shopping / Marketing
      customLabel0: item.customLabel0 || preset.custom_label_0 || undefined,
      
      // Store preset data for reference in AI generation
      _presetData: {
        presetId: preset.id,
        categoryName: preset.category_name,
        displayName: preset.display_name,
        description: preset.description,
        measurementTemplate: preset.measurement_template,
        requiresShipping: preset.requires_shipping,
      }
    }));
  } catch (error) {
    console.error('Error applying preset to product group:', error);
    return items;
  }
}

/**
 * Get preset data for a category (for pre-filling forms)
 */
export async function getPresetForCategory(
  categoryName: string
): Promise<CategoryPreset | null> {
  try {
    const presets = await getCategoryPresets();
    const preset = presets.find(
      p => p.category_name.toLowerCase() === categoryName.toLowerCase() && p.is_active
    );
    return preset || null;
  } catch (error) {
    console.error('Error getting preset for category:', error);
    return null;
  }
}
