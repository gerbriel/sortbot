-- Migration: Add CSV Export Fields to Category Presets Table
-- Description: Adds 15 new columns to support all CSV export fields
-- Date: 2026-02-07

-- Add Shipping & Packaging fields
ALTER TABLE category_presets 
ADD COLUMN IF NOT EXISTS package_dimensions TEXT,
ADD COLUMN IF NOT EXISTS parcel_size TEXT CHECK (parcel_size IN ('Small', 'Medium', 'Large', 'Extra Large')),
ADD COLUMN IF NOT EXISTS ships_from TEXT,
ADD COLUMN IF NOT EXISTS continue_selling_out_of_stock BOOLEAN DEFAULT false;

-- Add Product Classification fields
ALTER TABLE category_presets 
ADD COLUMN IF NOT EXISTS size_type TEXT CHECK (size_type IN ('Regular', 'Big & Tall', 'Petite', 'Plus Size', 'One Size')),
ADD COLUMN IF NOT EXISTS style TEXT,
ADD COLUMN IF NOT EXISTS gender TEXT CHECK (gender IN ('Men', 'Women', 'Unisex', 'Kids')),
ADD COLUMN IF NOT EXISTS age_group TEXT;

-- Add Policies & Marketplace fields
ALTER TABLE category_presets 
ADD COLUMN IF NOT EXISTS policies TEXT,
ADD COLUMN IF NOT EXISTS renewal_options TEXT,
ADD COLUMN IF NOT EXISTS who_made_it TEXT,
ADD COLUMN IF NOT EXISTS what_is_it TEXT,
ADD COLUMN IF NOT EXISTS listing_type TEXT,
ADD COLUMN IF NOT EXISTS discounted_shipping TEXT;

-- Add Marketing field
ALTER TABLE category_presets 
ADD COLUMN IF NOT EXISTS custom_label_0 TEXT;

-- Create indexes for commonly queried fields
CREATE INDEX IF NOT EXISTS idx_category_presets_gender ON category_presets(gender);
CREATE INDEX IF NOT EXISTS idx_category_presets_style ON category_presets(style);
CREATE INDEX IF NOT EXISTS idx_category_presets_size_type ON category_presets(size_type);

-- Add comments to document the fields
COMMENT ON COLUMN category_presets.package_dimensions IS 'Package dimensions for shipping (e.g., "12 in - 10 in - 4 in")';
COMMENT ON COLUMN category_presets.parcel_size IS 'Parcel size classification for shipping';
COMMENT ON COLUMN category_presets.ships_from IS 'Shipping origin address';
COMMENT ON COLUMN category_presets.continue_selling_out_of_stock IS 'Allow orders when inventory is depleted';
COMMENT ON COLUMN category_presets.size_type IS 'Size category for clothing';
COMMENT ON COLUMN category_presets.style IS 'Style descriptor (Vintage, Modern, etc.)';
COMMENT ON COLUMN category_presets.gender IS 'Target gender demographic';
COMMENT ON COLUMN category_presets.age_group IS 'Target age demographic';
COMMENT ON COLUMN category_presets.policies IS 'Return/exchange policies';
COMMENT ON COLUMN category_presets.renewal_options IS 'Listing renewal settings';
COMMENT ON COLUMN category_presets.who_made_it IS 'Creator/manufacturer information';
COMMENT ON COLUMN category_presets.what_is_it IS 'Item type classification';
COMMENT ON COLUMN category_presets.listing_type IS 'Physical/digital designation';
COMMENT ON COLUMN category_presets.discounted_shipping IS 'Shipping discount information';
COMMENT ON COLUMN category_presets.custom_label_0 IS 'Custom marketing label for Google Shopping';

-- Example: Insert default preset with new fields
/*
INSERT INTO category_presets (
  user_id,
  category_name,
  display_name,
  default_weight_value,
  default_weight_unit,
  requires_shipping,
  package_dimensions,
  parcel_size,
  ships_from,
  size_type,
  style,
  gender,
  age_group,
  policies,
  renewal_options,
  who_made_it,
  what_is_it,
  listing_type,
  custom_label_0,
  is_active
) VALUES (
  'your-user-id-here',
  'Graphic T-Shirts',
  'Vintage Graphic Tees',
  '8',
  'oz',
  true,
  '10 in - 8 in - 2 in',
  'Small',
  '601 W. Lincoln Ave, Fresno CA 93706',
  'Regular',
  'Vintage',
  'Unisex',
  'Adult (13+ years old)',
  'No Returns; No Exchanges',
  'Automatic',
  'Another Company Or Person',
  'A Finished Product',
  'Physical Item',
  'Top Seller',
  true
);
*/
