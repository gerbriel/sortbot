-- Migration: Fix Missing Product Columns
-- Description: Adds ALL columns referenced by saveProductToDatabase INSERT
--              that may be missing from the live database.
--              Safe to re-run — all statements use IF NOT EXISTS.
-- Date: 2026-03-10
-- ============================================================================

-- From schema.sql (base table already has these, but just in case):
ALTER TABLE products ADD COLUMN IF NOT EXISTS url_handle TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS product_category TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS product_type TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS tags TEXT[];
ALTER TABLE products ADD COLUMN IF NOT EXISTS published BOOLEAN DEFAULT false;
ALTER TABLE products ADD COLUMN IF NOT EXISTS batch_id UUID;

-- add_all_clothing_fields.sql fields (may not have been run):
ALTER TABLE products ADD COLUMN IF NOT EXISTS secondary_color TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS model_name TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS model_number TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS subculture TEXT[];
ALTER TABLE products ADD COLUMN IF NOT EXISTS package_dimensions TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS parcel_size TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS ships_from TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS continue_selling_out_of_stock BOOLEAN DEFAULT false;
ALTER TABLE products ADD COLUMN IF NOT EXISTS size_type TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS style TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS gender TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS age_group TEXT;

-- ============================================================================
-- FIX CHECK CONSTRAINTS THAT REJECT EMPTY STRINGS
-- The app uses '' as a default for unset fields, which violates these constraints.
-- ============================================================================

-- Drop gender check constraint (allows only Men/Women/Unisex/Kids but app sends '')
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_gender_check;

-- Drop parcel_size check constraint (same issue)
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_parcel_size_check;

-- Drop size_type check constraint (same issue)
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_size_type_check;
ALTER TABLE products ADD COLUMN IF NOT EXISTS policies TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS renewal_options TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS who_made_it TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS what_is_it TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS listing_type TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS discounted_shipping TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS mpn TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS custom_label_0 TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS tax_code TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS unit_price_total_measure TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS unit_price_total_measure_unit TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS unit_price_base_measure TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS unit_price_base_measure_unit TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS brand_category TEXT;

-- Indexes for performance (safe to re-run):
CREATE INDEX IF NOT EXISTS idx_products_style ON products(style);
CREATE INDEX IF NOT EXISTS idx_products_gender ON products(gender);
CREATE INDEX IF NOT EXISTS idx_products_size_type ON products(size_type);
CREATE INDEX IF NOT EXISTS idx_products_brand_category ON products(brand_category);
CREATE INDEX IF NOT EXISTS idx_products_model_name ON products(model_name);
CREATE INDEX IF NOT EXISTS idx_products_model_number ON products(model_number);
CREATE INDEX IF NOT EXISTS idx_products_subculture ON products USING GIN(subculture);

-- ============================================================================
-- VERIFICATION: Run this SELECT after applying the migration to confirm
-- all columns exist.
-- ============================================================================
-- SELECT column_name, data_type
-- FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'products'
-- ORDER BY ordinal_position;
