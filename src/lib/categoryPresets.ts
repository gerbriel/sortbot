// Category Presets Types and Database Functions

// ---------------------------------------------------------------------------
// Custom field & section types
// ---------------------------------------------------------------------------

export type CustomFieldType = 'text' | 'number' | 'textarea' | 'select' | 'checkbox';

export interface CustomFieldDefinition {
  id: string;
  label: string;
  key: string;
  type: CustomFieldType;
  defaultValue: string;
  options?: string[]; // for select fields
  order: number;
}

export interface CustomSection {
  id: string;
  title: string;
  order: number;
  fields: CustomFieldDefinition[];
}

// ---------------------------------------------------------------------------

export interface MeasurementTemplate {
  width: boolean;
  length: boolean;
  sleeve: boolean;
  shoulder: boolean;
  waist: boolean;
  inseam: boolean;
  rise: boolean;
}

export interface CategoryPreset {
  id: string;
  user_id: string;
  
  // Basic Info
  category_name: string;
  display_name: string;
  description?: string;
  
  // Shipping & Physical
  default_weight_value?: string;
  default_weight_unit: 'lb' | 'oz' | 'kg' | 'g';
  requires_shipping: boolean;
  
  // Product Classification
  product_type?: string;
  vendor?: string;
  
  // Pricing
  suggested_price_min?: number;
  suggested_price_max?: number;
  
  // Attributes
  default_material?: string;
  default_care_instructions?: string;
  
  // Measurements
  measurement_template: MeasurementTemplate;
  
  // SEO
  seo_title_template?: string;
  seo_keywords?: string[];
  
  // Shopify
  shopify_product_type?: string;
  shopify_collection_id?: string;
  
  // Tags
  default_tags?: string[];
  
  // Condition
  typical_condition?: string;
  
  // Status
  is_active: boolean;
  is_default?: boolean; // NEW: Marks the default preset for a category
  
  // New CSV-mapped fields (Shipping & Packaging)
  package_dimensions?: string;
  parcel_size?: 'Small' | 'Medium' | 'Large' | 'Extra Large';
  ships_from?: string;
  continue_selling_out_of_stock?: boolean;
  
  // Product Classification (Extended)
  size_type?: 'Regular' | 'Big & Tall' | 'Petite' | 'Plus Size' | 'One Size';
  style?: string;
  gender?: 'Men' | 'Women' | 'Unisex' | 'Kids';
  age_group?: string;
  
  // Policies & Marketplace
  policies?: string;
  renewal_options?: string;
  who_made_it?: string;
  what_is_it?: string;
  listing_type?: string;
  discounted_shipping?: string;
  
  // Marketing
  custom_label_0?: string;
  
  // === NEW: Extended Fields (Phase 6) ===
  
  // Pricing (Extended)
  compare_at_price?: number;
  cost_per_item?: number;
  
  // Product Details (Extended)
  color?: string;
  secondary_color?: string;
  model_name?: string;
  model_number?: string;
  era?: string;
  
  // Inventory & SKU
  sku_prefix?: string;
  barcode_prefix?: string;
  default_inventory_quantity?: number;
  
  // Measurements Templates (JSON)
  default_measurements?: {
    width?: string;
    length?: string;
    sleeve?: string;
    shoulder?: string;
    waist?: string;
    inseam?: string;
    rise?: string;
  };
  
  // SEO & Marketing (Extended)
  seo_description?: string;
  mpn_prefix?: string;
  
  // Status & Publishing
  default_status?: 'Active' | 'Draft' | 'Archived';
  default_published?: boolean;
  
  // Advanced Fields
  tax_code?: string;
  unit_price_total_measure?: string;
  unit_price_total_measure_unit?: string;
  unit_price_base_measure?: string;
  unit_price_base_measure_unit?: string;
  
  // === NEW: Synced with Products Table (Phase 7) ===
  
  // Subculture & Brand Category
  subculture?: string[]; // Array of subculture tags
  brand_category?: string; // Extended brand category (160+ options)
  
  // Inventory Tracking
  inventory_tracker?: 'shopify' | 'manual' | 'none';
  charge_tax?: boolean; // Whether to charge tax
  
  // Timestamps
  created_at: string;
  updated_at: string;

  // === Custom Sections & Fields ===
  custom_sections?: CustomSection[];
}

export interface CategoryPresetInput {
  /** Target workspace. Omit to fall back to the column DEFAULT
   *  (default_org_id(), the caller's first-joined workspace). */
  org_id?: string;
  category_name: string;
  display_name: string;
  description?: string;
  default_weight_value?: string;
  default_weight_unit?: 'lb' | 'oz' | 'kg' | 'g';
  requires_shipping?: boolean;
  product_type?: string;
  vendor?: string;
  suggested_price_min?: number;
  suggested_price_max?: number;
  default_material?: string;
  default_care_instructions?: string;
  measurement_template?: MeasurementTemplate;
  seo_title_template?: string;
  seo_keywords?: string[];
  shopify_product_type?: string;
  shopify_collection_id?: string;
  default_tags?: string[];
  typical_condition?: string;
  is_active?: boolean;
  is_default?: boolean; // NEW: Marks the default preset for a category
  
  // New CSV-mapped fields
  package_dimensions?: string;
  parcel_size?: 'Small' | 'Medium' | 'Large' | 'Extra Large';
  ships_from?: string;
  continue_selling_out_of_stock?: boolean;
  size_type?: 'Regular' | 'Big & Tall' | 'Petite' | 'Plus Size' | 'One Size';
  style?: string;
  gender?: 'Men' | 'Women' | 'Unisex' | 'Kids';
  age_group?: string;
  policies?: string;
  renewal_options?: string;
  who_made_it?: string;
  what_is_it?: string;
  listing_type?: string;
  discounted_shipping?: string;
  custom_label_0?: string;
  
  // === Phase 6: Comprehensive Fields (for create/update) ===
  compare_at_price?: number;
  cost_per_item?: number;
  color?: string;
  secondary_color?: string;
  model_name?: string;
  model_number?: string;
  era?: string;
  sku_prefix?: string;
  barcode_prefix?: string;
  default_inventory_quantity?: number;
  default_measurements?: {
    width?: string;
    length?: string;
    sleeve?: string;
    shoulder?: string;
    waist?: string;
    inseam?: string;
    rise?: string;
  };
  seo_description?: string;
  mpn_prefix?: string;
  default_status?: 'Active' | 'Draft' | 'Archived';
  default_published?: boolean;
  tax_code?: string;
  unit_price_total_measure?: string;
  unit_price_total_measure_unit?: string;
  unit_price_base_measure?: string;
  unit_price_base_measure_unit?: string;
  
  // === Phase 7: Synced with Products Table ===
  subculture?: string[]; // Array of subculture tags
  brand_category?: string; // Extended brand category
  inventory_tracker?: 'shopify' | 'manual' | 'none';
  charge_tax?: boolean; // Whether to charge tax

  // === Custom Sections & Fields ===
  custom_sections?: CustomSection[];
}

// Default measurement templates for common categories
export const DEFAULT_MEASUREMENT_TEMPLATES: Record<string, MeasurementTemplate> = {
  'Sweatshirts': {
    width: true,
    length: true,
    sleeve: true,
    shoulder: true,
    waist: false,
    inseam: false,
    rise: false,
  },
  'Outerwear': {
    width: true,
    length: true,
    sleeve: true,
    shoulder: true,
    waist: false,
    inseam: false,
    rise: false,
  },
  'Tees': {
    width: true,
    length: true,
    sleeve: false,
    shoulder: true,
    waist: false,
    inseam: false,
    rise: false,
  },
  'Bottoms': {
    width: false,
    length: false,
    sleeve: false,
    shoulder: false,
    waist: true,
    inseam: true,
    rise: true,
  },
  'Hats': {
    width: false,
    length: false,
    sleeve: false,
    shoulder: false,
    waist: false,
    inseam: false,
    rise: false,
  },
  'Accessories': {
    width: false,
    length: false,
    sleeve: false,
    shoulder: false,
    waist: false,
    inseam: false,
    rise: false,
  },
};

// ---------------------------------------------------------------------------
// The real column list of public.category_presets, and the payload whitelist
// ---------------------------------------------------------------------------
//
// Built from the migrations, not from the interfaces above (the interfaces
// carry fields the table never had, and PostgREST rejects the WHOLE write with
// PGRST204 / 42703 for one unknown key):
//   003_category_presets.sql                 the base table
//   database_migration_csv_fields.sql (root) the CSV-export columns; live
//                                            since 004 indexes them and 017
//                                            writes them
//   006_extend_category_presets.sql          pricing, details, SKU, SEO, status
//   016_sync_category_presets_with_products  subculture .. charge_tax
//   031_multi_org_tenancy.sql                org_id
//   075_category_presets_custom_sections.sql custom_sections (jsonb). The
//                                            editor has sent it since March
//                                            2026 with no migration behind it.
// A new column is added HERE in the same change as its migration.

export const CATEGORY_PRESET_COLUMNS = [
  // 003
  'id', 'user_id', 'category_name', 'display_name', 'description',
  'default_weight_value', 'default_weight_unit', 'requires_shipping',
  'product_type', 'vendor', 'suggested_price_min', 'suggested_price_max',
  'default_material', 'default_care_instructions', 'measurement_template',
  'seo_title_template', 'seo_keywords', 'shopify_product_type', 'shopify_collection_id',
  'default_tags', 'typical_condition', 'is_active', 'created_at', 'updated_at',
  // database_migration_csv_fields.sql
  'package_dimensions', 'parcel_size', 'ships_from', 'continue_selling_out_of_stock',
  'size_type', 'style', 'gender', 'age_group',
  'policies', 'renewal_options', 'who_made_it', 'what_is_it', 'listing_type', 'discounted_shipping',
  'custom_label_0',
  // 006
  'compare_at_price', 'cost_per_item', 'color', 'secondary_color', 'model_name', 'model_number', 'era',
  'sku_prefix', 'barcode_prefix', 'default_inventory_quantity', 'default_measurements',
  'seo_description', 'mpn_prefix', 'default_status', 'default_published', 'is_default',
  'tax_code', 'unit_price_total_measure', 'unit_price_total_measure_unit',
  'unit_price_base_measure', 'unit_price_base_measure_unit',
  // 016
  'subculture', 'brand_category', 'inventory_tracker', 'charge_tax',
  // 031
  'org_id',
  // 075
  'custom_sections',
] as const;

export type CategoryPresetColumn = (typeof CATEGORY_PRESET_COLUMNS)[number];

const COLUMN_SET: ReadonlySet<string> = new Set(CATEGORY_PRESET_COLUMNS);

/** Never sent on UPDATE: identity, tenancy and the trigger-owned timestamps. */
export const CATEGORY_PRESET_UPDATE_STRIPPED = ['id', 'org_id', 'user_id', 'created_at', 'updated_at'] as const;

/** Never sent on INSERT: the database (or the service) owns them. */
export const CATEGORY_PRESET_INSERT_STRIPPED = ['id', 'user_id', 'created_at', 'updated_at'] as const;

/**
 * Columns where an empty string is not a value: a CHECK list (parcel_size,
 * size_type, gender, default_status, inventory_tracker) rejects '' with 23514,
 * and a numeric column rejects it with 22P02. They go as NULL.
 */
const EMPTY_IS_NULL: ReadonlySet<string> = new Set([
  'parcel_size', 'size_type', 'gender', 'default_status', 'inventory_tracker',
  'suggested_price_min', 'suggested_price_max', 'compare_at_price', 'cost_per_item',
  'default_inventory_quantity',
]);

/**
 * The payload that may leave the client for `category_presets`: only real
 * columns, never the stripped keys for this mode, `undefined` dropped and an
 * empty string turned into NULL where the column cannot hold one.
 */
export function toCategoryPresetPayload(
  input: object,
  mode: 'insert' | 'update',
): Record<string, unknown> {
  const stripped: readonly string[] = mode === 'update' ? CATEGORY_PRESET_UPDATE_STRIPPED : CATEGORY_PRESET_INSERT_STRIPPED;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!COLUMN_SET.has(key) || stripped.includes(key) || value === undefined) continue;
    out[key] = value === '' && EMPTY_IS_NULL.has(key) ? null : value;
  }
  return out;
}
