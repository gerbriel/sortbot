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
    console.log(`🎯 applyPresetToProductGroup called:`, {
      categoryName,
      itemCount: items.length,
      firstItemId: items[0]?.id
    });

    // Get all presets for the user
    const presets = await getCategoryPresets();
    console.log(`📚 Found ${presets.length} total presets`);
    
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
    
    console.log(`🔍 Preset lookup for "${categoryName}":`, {
      found: !!preset,
      presetId: preset?.id,
      presetName: preset?.display_name,
      productType: preset?.product_type,
      policies: preset?.policies?.substring(0, 50),
      shipsFrom: preset?.ships_from?.substring(0, 30),
      gender: preset?.gender
    });
    
    if (!preset) {
      console.warn(`⚠️ No preset found for category: ${categoryName}`);
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
    const p = preset; // narrowed, non-null

    const result = items.map(item => ({
      ...item,

      // ======= CATEGORY (Always Set) =======
      category: categoryName,

      // ======= PRICING =======
      price: item.price || p.suggested_price_min || undefined,
      compareAtPrice: item.compareAtPrice || p.compare_at_price || undefined,
      costPerItem: item.costPerItem || p.cost_per_item || undefined,

      // ======= BASIC PRODUCT INFO =======
      seoTitle: item.seoTitle || p.seo_title_template || undefined,
      brand: item.brand || p.vendor || undefined,
      productType: item.productType || p.shopify_product_type || undefined,

      // ======= PRODUCT DETAILS =======
      material: item.material || p.default_material || undefined,
      color: item.color || p.color || undefined,
      secondaryColor: item.secondaryColor || p.secondary_color || undefined,
      modelName: item.modelName || p.model_name || undefined,
      modelNumber: item.modelNumber || p.model_number || undefined,
      era: item.era || p.era || undefined,
      care: item.care || p.default_care_instructions || undefined,
      condition: item.condition || p.typical_condition as any || undefined,

      // Tags: merge preset default_tags and seo_keywords with existing tags
      tags: item.tags || [
        ...(p.default_tags || []),
        ...(p.seo_keywords || [])
      ].filter((tag, index, self) => self.indexOf(tag) === index),

      // ======= MEASUREMENTS =======
      ...(p.default_measurements && !item.measurements?.width ? {
        measurements: {
          ...item.measurements,
          width: item.measurements?.width || p.default_measurements.width || '',
          length: item.measurements?.length || p.default_measurements.length || '',
          sleeve: item.measurements?.sleeve || p.default_measurements.sleeve || '',
          shoulder: item.measurements?.shoulder || p.default_measurements.shoulder || '',
          waist: item.measurements?.waist || p.default_measurements.waist || '',
          inseam: item.measurements?.inseam || p.default_measurements.inseam || '',
          rise: item.measurements?.rise || p.default_measurements.rise || ''
        }
      } : {}),

      // ======= INVENTORY & SKU =======
      sku: item.sku || (p.sku_prefix ? `${p.sku_prefix}${item.id.slice(0, 8)}` : undefined),
      barcode: item.barcode || p.barcode_prefix || undefined,
      inventoryQuantity: item.inventoryQuantity || p.default_inventory_quantity || undefined,

      // ======= SHIPPING & PACKAGING =======
      weightValue: item.weightValue || p.default_weight_value || undefined,
      packageDimensions: item.packageDimensions || p.package_dimensions || undefined,
      parcelSize: item.parcelSize || p.parcel_size || undefined,
      shipsFrom: item.shipsFrom || p.ships_from || undefined,
      continueSellingOutOfStock: item.continueSellingOutOfStock ?? p.continue_selling_out_of_stock,
      requiresShipping: item.requiresShipping ?? p.requires_shipping,

      // ======= PRODUCT CLASSIFICATION =======
      sizeType: item.sizeType || p.size_type || undefined,
      style: item.style || p.style || undefined,
      gender: item.gender || p.gender || undefined,
      ageGroup: item.ageGroup || p.age_group || undefined,

      // ======= POLICIES & MARKETPLACE =======
      policies: item.policies || p.policies || undefined,
      renewalOptions: item.renewalOptions || p.renewal_options || undefined,
      whoMadeIt: item.whoMadeIt || p.who_made_it || undefined,
      whatIsIt: item.whatIsIt || p.what_is_it || undefined,
      listingType: item.listingType || p.listing_type || undefined,
      discountedShipping: item.discountedShipping || p.discounted_shipping || undefined,

      // ======= MARKETING & SEO =======
      customLabel0: item.customLabel0 || p.custom_label_0 || undefined,
      seoDescription: item.seoDescription || p.seo_description || undefined,
      mpn: item.mpn || p.mpn_prefix || undefined,

      // ======= STATUS & PUBLISHING =======
      status: item.status || p.default_status || undefined,
      published: item.published ?? p.default_published,

      // ======= ADVANCED FIELDS =======
      taxCode: item.taxCode || p.tax_code || undefined,
      unitPriceTotalMeasure: item.unitPriceTotalMeasure || p.unit_price_total_measure || undefined,
      unitPriceTotalMeasureUnit: item.unitPriceTotalMeasureUnit || p.unit_price_total_measure_unit || undefined,
      unitPriceBaseMeasure: item.unitPriceBaseMeasure || p.unit_price_base_measure || undefined,
      unitPriceBaseMeasureUnit: item.unitPriceBaseMeasureUnit || p.unit_price_base_measure_unit || undefined,

      // ======= PRESET METADATA =======
      _presetData: {
        presetId: p.id,
        categoryName: p.category_name,
        productType: p.product_type || p.category_name,
        displayName: p.display_name,
        description: p.description,
        measurementTemplate: p.measurement_template,
        requiresShipping: p.requires_shipping,
      }
    }));

    console.log(`✅ Preset applied to ${result.length} items. Sample fields:`, {
      policies: result[0]?.policies,
      shipsFrom: result[0]?.shipsFrom,
      gender: result[0]?.gender,
      whoMadeIt: result[0]?.whoMadeIt,
      requiresShipping: result[0]?.requiresShipping,
      _presetData: result[0]?._presetData?.displayName,
    });

    return result;
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
