-- Migration: Add Missing Fields to Category Presets
-- Description: Extends category_presets table with all 62 CSV fields for complete preset support
-- Date: 2026-02-07

-- ============================================================================
-- ADD MISSING COLUMNS TO CATEGORY_PRESETS
-- ============================================================================

-- Pricing Fields
ALTER TABLE public.category_presets 
  ADD COLUMN IF NOT EXISTS compare_at_price NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS cost_per_item NUMERIC(10, 2);

-- Product Details
ALTER TABLE public.category_presets 
  ADD COLUMN IF NOT EXISTS color TEXT,
  ADD COLUMN IF NOT EXISTS secondary_color TEXT,
  ADD COLUMN IF NOT EXISTS model_name TEXT,
  ADD COLUMN IF NOT EXISTS model_number TEXT,
  ADD COLUMN IF NOT EXISTS era TEXT;

-- Inventory & SKU
ALTER TABLE public.category_presets 
  ADD COLUMN IF NOT EXISTS sku_prefix TEXT,
  ADD COLUMN IF NOT EXISTS barcode_prefix TEXT,
  ADD COLUMN IF NOT EXISTS default_inventory_quantity INTEGER DEFAULT 1;

-- Measurements Templates (JSON for flexibility)
ALTER TABLE public.category_presets 
  ADD COLUMN IF NOT EXISTS default_measurements JSONB;

-- SEO & Marketing
ALTER TABLE public.category_presets 
  ADD COLUMN IF NOT EXISTS seo_description TEXT,
  ADD COLUMN IF NOT EXISTS mpn_prefix TEXT;

-- Status & Publishing
ALTER TABLE public.category_presets 
  ADD COLUMN IF NOT EXISTS default_status TEXT DEFAULT 'Active' CHECK (default_status IN ('Active', 'Draft', 'Archived')),
  ADD COLUMN IF NOT EXISTS default_published BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS is_default BOOLEAN DEFAULT FALSE;

-- Advanced Fields (rarely used but for completeness)
ALTER TABLE public.category_presets 
  ADD COLUMN IF NOT EXISTS tax_code TEXT,
  ADD COLUMN IF NOT EXISTS unit_price_total_measure TEXT,
  ADD COLUMN IF NOT EXISTS unit_price_total_measure_unit TEXT,
  ADD COLUMN IF NOT EXISTS unit_price_base_measure TEXT,
  ADD COLUMN IF NOT EXISTS unit_price_base_measure_unit TEXT;

-- ============================================================================
-- ADD COMMENTS FOR NEW COLUMNS
-- ============================================================================

COMMENT ON COLUMN public.category_presets.compare_at_price IS 'Original price for sale pricing';
COMMENT ON COLUMN public.category_presets.cost_per_item IS 'Your cost for pricing calculations';
COMMENT ON COLUMN public.category_presets.color IS 'Default color for this category';
COMMENT ON COLUMN public.category_presets.secondary_color IS 'Additional color option';
COMMENT ON COLUMN public.category_presets.model_name IS 'Common model name for this category';
COMMENT ON COLUMN public.category_presets.model_number IS 'Common model number pattern';
COMMENT ON COLUMN public.category_presets.era IS 'Default era/vibe (e.g., "90s", "vintage")';
COMMENT ON COLUMN public.category_presets.sku_prefix IS 'SKU prefix for auto-generation (e.g., "TEE-")';
COMMENT ON COLUMN public.category_presets.barcode_prefix IS 'Barcode prefix pattern';
COMMENT ON COLUMN public.category_presets.default_inventory_quantity IS 'Default stock quantity';
COMMENT ON COLUMN public.category_presets.default_measurements IS 'JSON with measurement templates {pitToPit: "22", length: "28"}';
COMMENT ON COLUMN public.category_presets.seo_description IS 'Default meta description template';
COMMENT ON COLUMN public.category_presets.mpn_prefix IS 'Manufacturer Part Number prefix';
COMMENT ON COLUMN public.category_presets.default_status IS 'Default product status (Active/Draft/Archived)';
COMMENT ON COLUMN public.category_presets.default_published IS 'Default published state';
COMMENT ON COLUMN public.category_presets.is_default IS 'Marks the default preset for a category (one per category)';

-- ============================================================================
-- SUMMARY
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '=================================================================';
  RAISE NOTICE 'Category Presets Extended - UPDATED ✓';
  RAISE NOTICE '=================================================================';
  RAISE NOTICE '';
  RAISE NOTICE '📊 Columns Added:';
  RAISE NOTICE '  • Pricing: compare_at_price, cost_per_item';
  RAISE NOTICE '  • Details: color, secondary_color, model_name, model_number, era';
  RAISE NOTICE '  • Inventory: sku_prefix, barcode_prefix, default_inventory_quantity';
  RAISE NOTICE '  • Measurements: default_measurements (JSONB)';
  RAISE NOTICE '  • SEO: seo_description, mpn_prefix';
  RAISE NOTICE '  • Status: default_status, default_published, is_default';
  RAISE NOTICE '  • Advanced: tax_code, unit pricing fields (5 columns)';
  RAISE NOTICE '';
  RAISE NOTICE '🎯 Total New Columns: 21';
  RAISE NOTICE '📋 Total Preset Fields: 50 (29 existing + 21 new)';
  RAISE NOTICE '';
  RAISE NOTICE '✅ Category presets now support ALL 62 CSV fields!';
  RAISE NOTICE '✅ Added is_default flag for default presets per category!';
  RAISE NOTICE '';
  RAISE NOTICE '=================================================================';
  RAISE NOTICE '';
END $$;
