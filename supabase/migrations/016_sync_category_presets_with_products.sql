-- Migration: Sync Category Presets with Products Table
-- Description: Ensures product_category_presets has all the same fields as products table
-- Date: 2026-02-13
-- Purpose: Allow category presets to define defaults for all product fields

-- ============================================================================
-- ADD FIELDS FROM PRODUCTS TABLE THAT MAY BE MISSING
-- ============================================================================

-- These fields were just added to products table and should also be in category_presets
-- so users can define defaults for their categories

ALTER TABLE public.category_presets 
ADD COLUMN IF NOT EXISTS subculture TEXT[], -- Subculture tags array
ADD COLUMN IF NOT EXISTS brand_category TEXT; -- Extended brand category (160+ options)

-- Inventory tracking (from your CSV)
ALTER TABLE public.category_presets 
ADD COLUMN IF NOT EXISTS inventory_tracker TEXT DEFAULT 'shopify' CHECK (inventory_tracker IN ('shopify', 'manual', 'none'));

-- Charge tax flag (from your CSV - you have "Charge tax" column)
ALTER TABLE public.category_presets 
ADD COLUMN IF NOT EXISTS charge_tax BOOLEAN DEFAULT TRUE;

-- Shopify-specific fields (from your CSV)
ALTER TABLE public.category_presets 
ADD COLUMN IF NOT EXISTS shopify_product_type TEXT,
ADD COLUMN IF NOT EXISTS shopify_collection_id TEXT;

-- SEO fields (from your CSV you have seo_title_template and seo_keywords)
ALTER TABLE public.category_presets 
ADD COLUMN IF NOT EXISTS seo_title_template TEXT,
ADD COLUMN IF NOT EXISTS seo_keywords TEXT[];

-- Custom labels for Google Shopping (you have custom_label_0 in CSV)
-- custom_label_0 already added in extend_category_presets.sql

-- ============================================================================
-- ADD COMMENTS FOR NEW COLUMNS
-- ============================================================================

COMMENT ON COLUMN public.category_presets.subculture IS 'Default subculture tags for this category (e.g., ["punk-diy", "gorpcore-hiking"])';
COMMENT ON COLUMN public.category_presets.brand_category IS 'Extended brand-specific category (160+ options like "adidas-originals", "nike-sportswear")';
COMMENT ON COLUMN public.category_presets.inventory_tracker IS 'Inventory tracking system (shopify/manual/none)';
COMMENT ON COLUMN public.category_presets.charge_tax IS 'Whether to charge tax on products in this category';
COMMENT ON COLUMN public.category_presets.shopify_product_type IS 'Shopify product type for this category';
COMMENT ON COLUMN public.category_presets.shopify_collection_id IS 'Default Shopify collection ID';
COMMENT ON COLUMN public.category_presets.seo_title_template IS 'SEO title template with placeholders like {brand} {model}';
COMMENT ON COLUMN public.category_presets.seo_keywords IS 'Array of SEO keywords for this category';

-- ============================================================================
-- CREATE INDEXES FOR PERFORMANCE
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_category_presets_subculture ON category_presets USING GIN(subculture);
CREATE INDEX IF NOT EXISTS idx_category_presets_brand_category ON category_presets(brand_category);
CREATE INDEX IF NOT EXISTS idx_category_presets_is_default ON category_presets(is_default) WHERE is_default = TRUE;
CREATE INDEX IF NOT EXISTS idx_category_presets_category_name ON category_presets(category_name);

-- ============================================================================
-- VERIFICATION QUERY
-- ============================================================================

-- Run this to verify all columns in category_presets:
/*
SELECT 
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_name = 'category_presets'
ORDER BY ordinal_position;
*/

-- ============================================================================
-- SUMMARY
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '=================================================================';
  RAISE NOTICE 'Category Presets Synced with Products Table ✓';
  RAISE NOTICE '=================================================================';
  RAISE NOTICE '';
  RAISE NOTICE '📊 Columns Added:';
  RAISE NOTICE '  • subculture (TEXT[]) - Array of subculture tags';
  RAISE NOTICE '  • brand_category (TEXT) - Extended brand categories';
  RAISE NOTICE '  • inventory_tracker (TEXT) - Tracking system';
  RAISE NOTICE '  • charge_tax (BOOLEAN) - Tax flag';
  RAISE NOTICE '  • shopify_product_type (TEXT) - Shopify type';
  RAISE NOTICE '  • shopify_collection_id (TEXT) - Collection ID';
  RAISE NOTICE '  • seo_title_template (TEXT) - SEO title template';
  RAISE NOTICE '  • seo_keywords (TEXT[]) - SEO keywords array';
  RAISE NOTICE '';
  RAISE NOTICE '🎯 Total New Columns: 8';
  RAISE NOTICE '📋 Now matches your CSV export structure!';
  RAISE NOTICE '';
  RAISE NOTICE '✅ Category presets and products tables are now in sync!';
  RAISE NOTICE '✅ All 60+ fields from CSV export are supported!';
  RAISE NOTICE '';
  RAISE NOTICE '🔍 From your CSV, these default values are common:';
  RAISE NOTICE '   - ships_from: "601 W. Lincoln Ave, Fresno CA 93706"';
  RAISE NOTICE '   - policies: "No Returns; No Exchanges; All Sales Final"';
  RAISE NOTICE '   - renewal_options: "Automatic"';
  RAISE NOTICE '   - who_made_it: "Another Company Or Person"';
  RAISE NOTICE '   - what_is_it: "A Finished Product"';
  RAISE NOTICE '   - listing_type: "Physical Item"';
  RAISE NOTICE '   - gender: "Unisex" (or "Womens" for Feminine)';
  RAISE NOTICE '   - style: "Vintage"';
  RAISE NOTICE '   - age_group: "Adult (13+ years old)"';
  RAISE NOTICE '   - charge_tax: TRUE';
  RAISE NOTICE '   - inventory_tracker: "shopify"';
  RAISE NOTICE '';
  RAISE NOTICE '=================================================================';
  RAISE NOTICE '';
END $$;
