import type { ClothingItem } from '../App';
import type { CategoryPreset } from './categoryPresets';
import { getCategoryPresets } from './categoryPresetsService';

/**
 * Apply category preset data to a product group
 * Automatically applies the DEFAULT preset for the category
 * Manual entries take precedence over preset values
 */
export async function applyPresetToProductGroup(
  items: ClothingItem[],
  categoryName: string
): Promise<ClothingItem[]> {
  try {
    // Get all presets for the user
    const presets = await getCategoryPresets();
    
    // Find the DEFAULT preset for this category (by product_type)
    // Look for is_default=true first, fallback to any matching preset
    let preset = presets.find(
      p => p.product_type?.toLowerCase() === categoryName.toLowerCase() && p.is_default && p.is_active
    );
    
    // Fallback: if no default preset, try to find any active preset for this category
    if (!preset) {
      preset = presets.find(
        p => p.product_type?.toLowerCase() === categoryName.toLowerCase() && p.is_active
      );
    }
    
    // Fallback: check old category_name field (backward compatibility)
    if (!preset) {
      preset = presets.find(
        p => p.category_name.toLowerCase() === categoryName.toLowerCase() && p.is_active
      );
    }
    
    if (!preset) {
      // Still apply category even if no preset exists
      return items.map(item => ({
        ...item,
        category: categoryName
      }));
    }
    
    /**
     * Apply preset values to items with priority hierarchy:
     * 1. Voice Dictation (highest priority - already set on item)
     * 2. Category Preset values
     * 3. Empty (lowest priority)
     * 
     * Use pattern: item.field || preset.field || undefined
     * This ensures voice/manual entry is never overwritten
     */
    return items.map(item => ({
      ...item,
      
      // ======= CATEGORY (Always Set) =======
      category: categoryName,
      
      // ======= PRICING =======
      price: item.price || preset.suggested_price_min || undefined,
      compareAtPrice: item.compareAtPrice || preset.compare_at_price || undefined,
      costPerItem: item.costPerItem || preset.cost_per_item || undefined,
      
      // ======= BASIC PRODUCT INFO =======
      seoTitle: item.seoTitle || preset.seo_title_template || undefined,
      brand: item.brand || preset.vendor || undefined,
      productType: item.productType || preset.shopify_product_type || undefined,
      
      // ======= PRODUCT DETAILS =======
      material: item.material || preset.default_material || undefined,
      color: item.color || preset.color || undefined,
      secondaryColor: item.secondaryColor || preset.secondary_color || undefined,
      modelName: item.modelName || preset.model_name || undefined,
      modelNumber: item.modelNumber || preset.model_number || undefined,
      era: item.era || preset.era || undefined,
      care: item.care || preset.default_care_instructions || undefined,
      
      // Tags: merge preset keywords with existing tags (special case)
      tags: item.tags || (preset.seo_keywords ? [...preset.seo_keywords] : []),
      
      // ======= MEASUREMENTS =======
      // If preset has default measurements template, apply them
      ...(preset.default_measurements && !item.measurements?.pitToPit ? {
        measurements: {
          ...item.measurements,
          pitToPit: item.measurements?.pitToPit || preset.default_measurements.pitToPit || '',
          length: item.measurements?.length || preset.default_measurements.length || '',
          sleeve: item.measurements?.sleeve || preset.default_measurements.sleeve || '',
          shoulder: item.measurements?.shoulder || preset.default_measurements.shoulder || '',
          waist: item.measurements?.waist || preset.default_measurements.waist || '',
          inseam: item.measurements?.inseam || preset.default_measurements.inseam || '',
          rise: item.measurements?.rise || preset.default_measurements.rise || ''
        }
      } : {}),
      
      // ======= INVENTORY & SKU =======
      sku: item.sku || (preset.sku_prefix ? `${preset.sku_prefix}${item.id.slice(0, 8)}` : undefined),
      barcode: item.barcode || preset.barcode_prefix || undefined,
      inventoryQuantity: item.inventoryQuantity || preset.default_inventory_quantity || undefined,
      
      // ======= SHIPPING & PACKAGING =======
      weightValue: item.weightValue || preset.default_weight_value || undefined,
      packageDimensions: item.packageDimensions || preset.package_dimensions || undefined,
      parcelSize: item.parcelSize || preset.parcel_size || undefined,
      shipsFrom: item.shipsFrom || preset.ships_from || undefined,
      continueSellingOutOfStock: item.continueSellingOutOfStock ?? preset.continue_selling_out_of_stock,
      requiresShipping: item.requiresShipping ?? preset.requires_shipping,
      
      // ======= PRODUCT CLASSIFICATION =======
      sizeType: item.sizeType || preset.size_type || undefined,
      style: item.style || preset.style || undefined,
      gender: item.gender || preset.gender || undefined,
      ageGroup: item.ageGroup || preset.age_group || undefined,
      
      // ======= POLICIES & MARKETPLACE =======
      policies: item.policies || preset.policies || undefined,
      renewalOptions: item.renewalOptions || preset.renewal_options || undefined,
      whoMadeIt: item.whoMadeIt || preset.who_made_it || undefined,
      whatIsIt: item.whatIsIt || preset.what_is_it || undefined,
      listingType: item.listingType || preset.listing_type || undefined,
      discountedShipping: item.discountedShipping || preset.discounted_shipping || undefined,
      
      // ======= MARKETING & SEO =======
      customLabel0: item.customLabel0 || preset.custom_label_0 || undefined,
      seoDescription: item.seoDescription || preset.seo_description || undefined,
      mpn: item.mpn || preset.mpn_prefix || undefined,
      
      // ======= STATUS & PUBLISHING =======
      status: item.status || preset.default_status || undefined,
      published: item.published ?? preset.default_published,
      
      // ======= ADVANCED FIELDS =======
      taxCode: item.taxCode || preset.tax_code || undefined,
      unitPriceTotalMeasure: item.unitPriceTotalMeasure || preset.unit_price_total_measure || undefined,
      unitPriceTotalMeasureUnit: item.unitPriceTotalMeasureUnit || preset.unit_price_total_measure_unit || undefined,
      unitPriceBaseMeasure: item.unitPriceBaseMeasure || preset.unit_price_base_measure || undefined,
      unitPriceBaseMeasureUnit: item.unitPriceBaseMeasureUnit || preset.unit_price_base_measure_unit || undefined,
      
      // ======= PRESET METADATA =======
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
