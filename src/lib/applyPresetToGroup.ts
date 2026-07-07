import type { ClothingItem } from '../App';
import type { CategoryPreset } from './categoryPresets';
import { getCategoryPresets } from './categoryPresetsService';

/**
 * Interpolate a SEO title template string, replacing {placeholder} tokens
 * with actual field values from the item and preset.
 * Removes unresolved placeholders and cleans up extra whitespace.
 *
 * Supported tokens: {brand}, {model}, {color}, {size}, {era}, {category}
 */
function interpolateSeoTemplate(
  template: string,
  item: ClothingItem,
  preset: CategoryPreset
): string {
  const replacements: Record<string, string> = {
    brand:    item.brand    || '',
    model:    item.modelName|| preset.model_name     || '',
    color:    item.color    || preset.color          || '',
    size:     item.size     || '',
    era:      item.era      || preset.era            || '',
    category: item.category || preset.product_type   || preset.category_name || '',
  };

  return template
    .replace(/\{(\w+)\}/g, (_, key) => replacements[key] ?? '')
    // Remove empty tokens that left consecutive spaces or leading/trailing dashes/spaces
    .replace(/\s{2,}/g, ' ')
    .replace(/(^[\s\-]+|[\s\-]+$)/g, '')
    .trim();
}
/**
 * Apply category preset data to a product group
 * Automatically applies the DEFAULT preset for the category
 * Manual entries take precedence over preset values
 */

/**
 * Apply a preset object directly to items (no network fetch).
 * Use this when the caller already has the preset in hand.
 *
 * force=true → used when the user explicitly switches presets;
 * overwrites ALL preset-owned fields so the new preset's defaults
 * take full effect.  Voice-entered fields (brand, size, color,
 * material, era, flaws, care, measurements, title, price, condition)
 * are always kept regardless.
 */
export function applyPresetDirectly(
  items: ClothingItem[],
  categoryName: string,
  preset: CategoryPreset,
  force = false
): ClothingItem[] {
  return applyPresetFields(items, categoryName, preset, force);
}

export async function applyPresetToProductGroup(
  items: ClothingItem[],
  categoryName: string,
  force = false
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
    
    return applyPresetFields(items, categoryName, preset, force);
  } catch (error) {
    console.error('Error applying preset to product group:', error);
    return items;
  }
}

/**
 * Core field-mapping logic — shared by both the async (fetch) and sync (direct) paths.
 *
 * Apply preset values to items with priority hierarchy:
 * 1. Voice Dictation / manual entry (highest priority — always kept)
 * 2. Category Preset values
 * 3. Empty (lowest priority)
 *
 * Normal mode:  item.field || preset.field  — never overwrites existing values.
 * Force mode:   preset.field || item.field  for "preset-owned" fields;
 *               used when the user explicitly switches presets so stale
 *               values from the old preset are replaced.  Voice-entered
 *               fields are always kept.
 */
// Item weightValue is stored in GRAMS (the CSV writes it as-is with unit 'g').
// Presets store the value in whatever unit the author picked — convert here.
const WEIGHT_UNIT_TO_GRAMS: Record<string, number> = { g: 1, kg: 1000, oz: 28.3495, lb: 453.592 };

function presetWeightInGrams(preset: CategoryPreset): string | undefined {
  const raw = parseFloat(preset.default_weight_value ?? '');
  if (isNaN(raw)) return undefined;
  const factor = WEIGHT_UNIT_TO_GRAMS[preset.default_weight_unit ?? 'g'] ?? 1;
  return String(Math.round(raw * factor));
}

function applyPresetFields(
  items: ClothingItem[],
  categoryName: string,
  preset: CategoryPreset,
  force = false
): ClothingItem[] {
  // Fields that are purely voice/manual — never overwritten even in force mode.
  // Everything else is considered "preset-owned" and will be reset when force=true.
  const pick = <T>(itemVal: T, presetVal: T): T =>
    force ? (presetVal ?? itemVal) : (itemVal || presetVal);

  const presetWeight = presetWeightInGrams(preset);

  return items.map(item => ({
      ...item,
      
      // ======= CATEGORY (Always Set) =======
      category: categoryName,
      
      // ======= PRICING =======
      // Voice-entered: keep item value. Preset-owned: use pick() so force resets them.
      price: item.price || preset.suggested_price_min || undefined,
      // compare_at_price wins; suggested_price_max is its fallback default
      // (the "was" price a discounted listing shows).
      compareAtPrice: pick(item.compareAtPrice, preset.compare_at_price ?? preset.suggested_price_max) || undefined,
      costPerItem: pick(item.costPerItem, preset.cost_per_item) || undefined,
      
      // ======= BASIC PRODUCT INFO =======
      // seoTitle and brand are voice/manual — never force-overwritten.
      seoTitle: (() => {
        if (item.seoTitle && !/\{[a-z]+\}/i.test(item.seoTitle)) {
          return item.seoTitle; // Real title already set
        }
        if (preset.seo_title_template) {
          const interpolated = interpolateSeoTemplate(preset.seo_title_template, item, preset);
          return interpolated || undefined;
        }
        return undefined;
      })(),
      // brand is the GARMENT's brand — voice/manual only. (preset.vendor is
      // NOT a brand default: the CSV Vendor column is the seller name, which
      // comes from the org-level vendorName setting, not from items.)
      brand: item.brand || undefined,
      // productType / shopifyProductType are preset-owned
      productType: pick(item.productType, preset.product_type) || undefined,
      shopifyProductType: pick(item.shopifyProductType, preset.shopify_product_type) || undefined,
      
      // ======= PRODUCT DETAILS =======
      // Voice-entered fields: keep item value first
      material: item.material || preset.default_material || undefined,
      color: item.color || preset.color || undefined,
      secondaryColor: item.secondaryColor || preset.secondary_color || undefined,
      modelName: item.modelName || preset.model_name || undefined,
      modelNumber: item.modelNumber || preset.model_number || undefined,
      era: item.era || preset.era || undefined,
      care: item.care || preset.default_care_instructions || undefined,
      condition: item.condition || preset.typical_condition as any || undefined,
      
      // Tags: preset-owned — pick() so force gives fresh preset tags
      tags: force
        ? [...(preset.default_tags || []), ...(preset.seo_keywords || [])].filter((t, i, a) => a.indexOf(t) === i)
        : (item.tags || [...(preset.default_tags || []), ...(preset.seo_keywords || [])].filter((t, i, a) => a.indexOf(t) === i)),
      
      // ======= MEASUREMENTS =======
      // Voice-entered: keep item measurements; only fill blanks from preset
      ...(preset.default_measurements && !item.measurements?.width ? {
        measurements: {
          ...item.measurements,
          width: item.measurements?.width || preset.default_measurements.width || '',
          length: item.measurements?.length || preset.default_measurements.length || '',
          sleeve: item.measurements?.sleeve || preset.default_measurements.sleeve || '',
          shoulder: item.measurements?.shoulder || preset.default_measurements.shoulder || '',
          waist: item.measurements?.waist || preset.default_measurements.waist || '',
          inseam: item.measurements?.inseam || preset.default_measurements.inseam || '',
          rise: item.measurements?.rise || preset.default_measurements.rise || ''
        }
      } : {}),
      
      // ======= INVENTORY & SKU =======
      sku: pick(item.sku, preset.sku_prefix ? `${preset.sku_prefix}${item.id.slice(0, 8)}` : undefined) || undefined,
      barcode: pick(item.barcode, preset.barcode_prefix) || undefined,
      inventoryQuantity: pick(item.inventoryQuantity, preset.default_inventory_quantity) || undefined,
      
      // ======= SHIPPING & PACKAGING =======
      // Preset weight converted to grams (item.weightValue is always grams)
      weightValue: pick(item.weightValue, presetWeight) || undefined,
      packageDimensions: pick(item.packageDimensions, preset.package_dimensions) || undefined,
      parcelSize: pick(item.parcelSize, preset.parcel_size) || undefined,
      shipsFrom: pick(item.shipsFrom, preset.ships_from) || undefined,
      continueSellingOutOfStock: force
        ? (preset.continue_selling_out_of_stock ?? item.continueSellingOutOfStock)
        : (item.continueSellingOutOfStock ?? preset.continue_selling_out_of_stock),
      requiresShipping: force
        ? (preset.requires_shipping ?? item.requiresShipping)
        : (item.requiresShipping ?? preset.requires_shipping),
      
      // ======= PRODUCT CLASSIFICATION — preset-owned =======
      sizeType: pick(item.sizeType, preset.size_type) || undefined,
      style: pick(item.style, preset.style) || undefined,
      gender: pick(item.gender, preset.gender) || undefined,
      ageGroup: pick(item.ageGroup, preset.age_group) || undefined,
      
      // ======= POLICIES & MARKETPLACE — preset-owned =======
      policies: pick(item.policies, preset.policies) || undefined,
      renewalOptions: pick(item.renewalOptions, preset.renewal_options) || undefined,
      whoMadeIt: pick(item.whoMadeIt, preset.who_made_it) || undefined,
      whatIsIt: pick(item.whatIsIt, preset.what_is_it) || undefined,
      listingType: pick(item.listingType, preset.listing_type) || undefined,
      discountedShipping: pick(item.discountedShipping, preset.discounted_shipping) || undefined,
      
      // ======= MARKETING & SEO — preset-owned =======
      customLabel0: pick(item.customLabel0, preset.custom_label_0) || undefined,
      seoDescription: pick(item.seoDescription, preset.seo_description) || undefined,
      mpn: pick(item.mpn, preset.mpn_prefix) || undefined,
      
      // ======= STATUS & PUBLISHING =======
      status: item.status || preset.default_status || 'Active',
      published: item.published ?? preset.default_published,
      
      // ======= ADVANCED FIELDS =======
      taxCode: item.taxCode || preset.tax_code || undefined,
      unitPriceTotalMeasure: item.unitPriceTotalMeasure || preset.unit_price_total_measure || undefined,
      unitPriceTotalMeasureUnit: item.unitPriceTotalMeasureUnit || preset.unit_price_total_measure_unit || undefined,
      unitPriceBaseMeasure: item.unitPriceBaseMeasure || preset.unit_price_base_measure || undefined,
      unitPriceBaseMeasureUnit: item.unitPriceBaseMeasureUnit || preset.unit_price_base_measure_unit || undefined,
      
      // ======= PRESET METADATA =======
      // Persisted ID — survives reload so PRESET NAV shows the correct label
      appliedPresetId: preset.id,
      // In-memory preset data for reference in AI generation
      _presetData: {
        presetId: preset.id,
        categoryName: preset.category_name,
        productType: preset.product_type || preset.category_name, // Use product_type for comparison
        displayName: preset.display_name,
        description: preset.description,
        measurementTemplate: preset.measurement_template,
        requiresShipping: preset.requires_shipping,
      }
    }));
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
