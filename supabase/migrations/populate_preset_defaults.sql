-- Migration: Populate Default Values for Category Presets
-- Description: Sets default values for common fields based on your CSV export
-- Date: 2026-02-14

-- ============================================================================
-- UPDATE COMMON DEFAULT VALUES FOR ALL PRESETS
-- ============================================================================

-- Based on your CSV, these values are common across most presets:
UPDATE public.category_presets
SET
  ships_from = '601 W. Lincoln Ave, Fresno CA 93706',
  policies = 'No Returns; No Exchanges; All Sales Final',
  renewal_options = 'Automatic',
  who_made_it = 'Another Company Or Person',
  what_is_it = 'A Finished Product',
  listing_type = 'Physical Item',
  style = 'Vintage',
  age_group = 'Adult (13+ years old)',
  requires_shipping = TRUE
WHERE id IS NOT NULL; -- Update all presets

-- Update fields that were added in sync_category_presets_with_products.sql
UPDATE public.category_presets
SET
  charge_tax = TRUE,
  inventory_tracker = 'shopify'
WHERE id IS NOT NULL AND charge_tax IS NULL;

-- ============================================================================
-- SET GENDER BASED ON CATEGORY
-- ============================================================================

-- Most categories are Unisex
UPDATE public.category_presets
SET gender = 'Unisex'
WHERE category_name NOT IN ('dresses', 'skirts', 'feminine-tops');

-- Feminine categories
UPDATE public.category_presets
SET gender = 'Womens'
WHERE category_name IN ('dresses', 'skirts', 'feminine-tops');

-- ============================================================================
-- SET PRODUCT TYPE SPECIFIC DEFAULTS
-- ============================================================================

-- Sweatshirts
UPDATE public.category_presets
SET
  shopify_product_type = 'Sweatshirts',
  seo_title_template = '{brand} {model} Sweatshirt - Vintage',
  seo_keywords = ARRAY['vintage sweatshirt', 'retro hoodie', 'vintage pullover']
WHERE product_type = 'sweatshirts';

-- Tees
UPDATE public.category_presets
SET
  shopify_product_type = 'T-Shirts',
  seo_title_template = '{brand} {model} T-Shirt - Vintage',
  seo_keywords = ARRAY['vintage t-shirt', 'retro tee', 'vintage shirt']
WHERE product_type = 'tees';

-- Outerwear
UPDATE public.category_presets
SET
  shopify_product_type = 'Outerwear & Coats',
  seo_title_template = '{brand} {model} Jacket - Vintage',
  seo_keywords = ARRAY['vintage jacket', 'retro coat', 'vintage outerwear']
WHERE product_type = 'outerwear';

-- Pants
UPDATE public.category_presets
SET
  shopify_product_type = 'Pants',
  seo_title_template = '{brand} {model} Pants - Vintage',
  seo_keywords = ARRAY['vintage pants', 'retro trousers', 'vintage bottoms']
WHERE product_type = 'pants';

-- Shorts
UPDATE public.category_presets
SET
  shopify_product_type = 'Shorts',
  seo_title_template = '{brand} {model} Shorts - Vintage',
  seo_keywords = ARRAY['vintage shorts', 'retro shorts']
WHERE product_type = 'shorts';

-- Dresses
UPDATE public.category_presets
SET
  shopify_product_type = 'Dresses',
  seo_title_template = '{brand} {model} Dress - Vintage',
  seo_keywords = ARRAY['vintage dress', 'retro dress', 'vintage gown']
WHERE product_type = 'dresses';

-- Skirts
UPDATE public.category_presets
SET
  shopify_product_type = 'Skirts',
  seo_title_template = '{brand} {model} Skirt - Vintage',
  seo_keywords = ARRAY['vintage skirt', 'retro skirt']
WHERE product_type = 'skirts';

-- ============================================================================
-- VERIFICATION QUERY
-- ============================================================================

-- Run this to see your updated presets:
/*
SELECT 
  display_name,
  product_type,
  gender,
  policies,
  ships_from,
  who_made_it,
  style,
  age_group,
  shopify_product_type
FROM public.category_presets
WHERE is_active = TRUE
ORDER BY display_name;
*/

-- ============================================================================
-- SUMMARY
-- ============================================================================

DO $$
DECLARE
  preset_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO preset_count FROM public.category_presets;
  
  RAISE NOTICE '';
  RAISE NOTICE '=================================================================';
  RAISE NOTICE 'Category Preset Defaults Populated ✓';
  RAISE NOTICE '=================================================================';
  RAISE NOTICE '';
  RAISE NOTICE '📊 Updated % presets with default values:', preset_count;
  RAISE NOTICE '';
  RAISE NOTICE '✅ Common Fields Set:';
  RAISE NOTICE '   • ships_from: "601 W. Lincoln Ave, Fresno CA 93706"';
  RAISE NOTICE '   • policies: "No Returns; No Exchanges; All Sales Final"';
  RAISE NOTICE '   • renewal_options: "Automatic"';
  RAISE NOTICE '   • who_made_it: "Another Company Or Person"';
  RAISE NOTICE '   • what_is_it: "A Finished Product"';
  RAISE NOTICE '   • listing_type: "Physical Item"';
  RAISE NOTICE '   • style: "Vintage"';
  RAISE NOTICE '   • age_group: "Adult (13+ years old)"';
  RAISE NOTICE '   • charge_tax: TRUE';
  RAISE NOTICE '';
  RAISE NOTICE '✅ Gender set based on category (Unisex or Womens)';
  RAISE NOTICE '✅ SEO templates and keywords added per category';
  RAISE NOTICE '';
  RAISE NOTICE '🎯 Now refresh your app and the preset fields should populate!';
  RAISE NOTICE '';
  RAISE NOTICE '=================================================================';
  RAISE NOTICE '';
END $$;
