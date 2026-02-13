-- Migration: Add All Missing Clothing Item Fields to Products Table
-- Description: Adds all fields from ClothingItem interface that were missing
-- Date: 2026-02-12
-- Purpose: Ensure all Step 4 fields are saved to database when adding to library

-- ============================================================================
-- PRODUCT DETAILS (Extended)
-- ============================================================================

ALTER TABLE products 
ADD COLUMN IF NOT EXISTS model_name TEXT, -- Specific model (e.g., "501 Original Fit", "Air Force 1")
ADD COLUMN IF NOT EXISTS model_number TEXT, -- Model number (e.g., "501", "AF1", "MA-1")
ADD COLUMN IF NOT EXISTS subculture TEXT[], -- Subculture tags (e.g., ["punk-diy", "gorpcore-hiking"])
ADD COLUMN IF NOT EXISTS secondary_color TEXT; -- Additional color

-- ============================================================================
-- SHIPPING & PACKAGING (from Category Presets)
-- ============================================================================

ALTER TABLE products 
ADD COLUMN IF NOT EXISTS package_dimensions TEXT, -- e.g., "8 in - 6 in - 4 in"
ADD COLUMN IF NOT EXISTS parcel_size TEXT CHECK (parcel_size IN ('Small', 'Medium', 'Large', 'Extra Large')),
ADD COLUMN IF NOT EXISTS ships_from TEXT, -- Shipping address
ADD COLUMN IF NOT EXISTS continue_selling_out_of_stock BOOLEAN DEFAULT false;

-- ============================================================================
-- PRODUCT CLASSIFICATION (from Category Presets)
-- ============================================================================

ALTER TABLE products 
ADD COLUMN IF NOT EXISTS size_type TEXT CHECK (size_type IN ('Regular', 'Big & Tall', 'Petite', 'Plus Size', 'One Size')),
ADD COLUMN IF NOT EXISTS style TEXT, -- "Vintage", "Modern", "Streetwear", etc.
ADD COLUMN IF NOT EXISTS gender TEXT CHECK (gender IN ('Men', 'Women', 'Unisex', 'Kids')),
ADD COLUMN IF NOT EXISTS age_group TEXT; -- "Adult (13+ years old)", "Kids", "Infants", etc.

-- ============================================================================
-- POLICIES & MARKETPLACE INFO (from Category Presets)
-- ============================================================================

ALTER TABLE products 
ADD COLUMN IF NOT EXISTS policies TEXT, -- "No Returns; No Exchanges"
ADD COLUMN IF NOT EXISTS renewal_options TEXT, -- "Automatic", "Manual", etc.
ADD COLUMN IF NOT EXISTS who_made_it TEXT, -- "Another Company Or Person", "I made it", etc.
ADD COLUMN IF NOT EXISTS what_is_it TEXT, -- "A Finished Product", "A supply", etc.
ADD COLUMN IF NOT EXISTS listing_type TEXT, -- "Physical Item", "Digital Download"
ADD COLUMN IF NOT EXISTS discounted_shipping TEXT; -- "No Discount", "10% Off", etc.

-- ============================================================================
-- GOOGLE SHOPPING / ADVANCED MARKETING
-- ============================================================================

ALTER TABLE products 
ADD COLUMN IF NOT EXISTS mpn TEXT, -- Manufacturer Part Number
ADD COLUMN IF NOT EXISTS custom_label_0 TEXT; -- "Top Seller", "New Arrival", "Clearance"

-- ============================================================================
-- ADVANCED FIELDS (rarely used but might be needed)
-- ============================================================================

ALTER TABLE products 
ADD COLUMN IF NOT EXISTS tax_code TEXT,
ADD COLUMN IF NOT EXISTS unit_price_total_measure TEXT,
ADD COLUMN IF NOT EXISTS unit_price_total_measure_unit TEXT,
ADD COLUMN IF NOT EXISTS unit_price_base_measure TEXT,
ADD COLUMN IF NOT EXISTS unit_price_base_measure_unit TEXT;

-- ============================================================================
-- BRAND CATEGORY (Extended category system)
-- ============================================================================

ALTER TABLE products 
ADD COLUMN IF NOT EXISTS brand_category TEXT; -- 160+ extended categories (e.g., "adidas-originals", "nike-sportswear")

-- ============================================================================
-- CREATE INDEXES FOR PERFORMANCE
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_products_model_name ON products(model_name);
CREATE INDEX IF NOT EXISTS idx_products_model_number ON products(model_number);
CREATE INDEX IF NOT EXISTS idx_products_style ON products(style);
CREATE INDEX IF NOT EXISTS idx_products_gender ON products(gender);
CREATE INDEX IF NOT EXISTS idx_products_size_type ON products(size_type);
CREATE INDEX IF NOT EXISTS idx_products_brand_category ON products(brand_category);
CREATE INDEX IF NOT EXISTS idx_products_subculture ON products USING GIN(subculture); -- GIN index for array columns

-- ============================================================================
-- ADD COMMENTS TO DOCUMENT FIELDS
-- ============================================================================

COMMENT ON COLUMN products.model_name IS 'Specific product model name (e.g., "501 Original Fit", "Air Force 1")';
COMMENT ON COLUMN products.model_number IS 'Model/style number (e.g., "501", "AF1", "MA-1")';
COMMENT ON COLUMN products.subculture IS 'Array of subculture tags (e.g., punk-diy, gorpcore-hiking)';
COMMENT ON COLUMN products.secondary_color IS 'Second color for multi-color items';
COMMENT ON COLUMN products.package_dimensions IS 'Shipping package dimensions (e.g., "12 in - 10 in - 4 in")';
COMMENT ON COLUMN products.parcel_size IS 'Parcel size classification for carriers';
COMMENT ON COLUMN products.ships_from IS 'Shipping origin address';
COMMENT ON COLUMN products.continue_selling_out_of_stock IS 'Allow orders when out of stock';
COMMENT ON COLUMN products.size_type IS 'Size category (Regular, Big & Tall, Petite, Plus Size, One Size)';
COMMENT ON COLUMN products.style IS 'Style descriptor (Vintage, Modern, Streetwear, etc.)';
COMMENT ON COLUMN products.gender IS 'Target gender demographic';
COMMENT ON COLUMN products.age_group IS 'Target age demographic';
COMMENT ON COLUMN products.policies IS 'Return/exchange policy text';
COMMENT ON COLUMN products.renewal_options IS 'Listing renewal settings (Automatic/Manual)';
COMMENT ON COLUMN products.who_made_it IS 'Creator/manufacturer information';
COMMENT ON COLUMN products.what_is_it IS 'Item type (Finished Product, Supply, etc.)';
COMMENT ON COLUMN products.listing_type IS 'Physical Item or Digital Download';
COMMENT ON COLUMN products.discounted_shipping IS 'Shipping discount amount';
COMMENT ON COLUMN products.mpn IS 'Manufacturer Part Number for marketplaces';
COMMENT ON COLUMN products.custom_label_0 IS 'Custom marketing label for Google Shopping';
COMMENT ON COLUMN products.brand_category IS 'Extended brand-specific category (160+ options)';
COMMENT ON COLUMN products.tax_code IS 'Tax classification code';

-- ============================================================================
-- VERIFICATION QUERY
-- ============================================================================

-- Run this to verify all columns were added:
/*
SELECT 
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_name = 'products'
ORDER BY ordinal_position;
*/
