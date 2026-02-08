// Category Presets Types and Database Functions

export interface MeasurementTemplate {
  pitToPit: boolean;
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
    pitToPit?: string;
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
  
  // Timestamps
  created_at: string;
  updated_at: string;
}

export interface CategoryPresetInput {
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
    pitToPit?: string;
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
}

// Default measurement templates for common categories
export const DEFAULT_MEASUREMENT_TEMPLATES: Record<string, MeasurementTemplate> = {
  'Sweatshirts': {
    pitToPit: true,
    length: true,
    sleeve: true,
    shoulder: true,
    waist: false,
    inseam: false,
    rise: false,
  },
  'Outerwear': {
    pitToPit: true,
    length: true,
    sleeve: true,
    shoulder: true,
    waist: false,
    inseam: false,
    rise: false,
  },
  'Tees': {
    pitToPit: true,
    length: true,
    sleeve: false,
    shoulder: true,
    waist: false,
    inseam: false,
    rise: false,
  },
  'Bottoms': {
    pitToPit: false,
    length: false,
    sleeve: false,
    shoulder: false,
    waist: true,
    inseam: true,
    rise: true,
  },
  'Hats': {
    pitToPit: false,
    length: false,
    sleeve: false,
    shoulder: false,
    waist: false,
    inseam: false,
    rise: false,
  },
  'Accessories': {
    pitToPit: false,
    length: false,
    sleeve: false,
    shoulder: false,
    waist: false,
    inseam: false,
    rise: false,
  },
};
