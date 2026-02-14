-- Migration: Populate Default Values for Category Presets
-- Description: Sets default values for common fields based on your CSV export
-- Date: 2026-02-14

-- ============================================================================
-- UPDATE COMMON DEFAULT VALUES FOR ALL PRESETS
-- ============================================================================

-- Based on your CSV, these values are common across most presets:
UPDATE public.category_presets
SET
  -- Shipping & Location
  ships_from = '601 W. Lincoln Ave, Fresno CA 93706',
  continue_selling_out_of_stock = FALSE,
  
  -- Policies & Marketplace (Etsy/eBay/etc)
  policies = 'No Returns; No Exchanges; All Sales Final',
  renewal_options = 'Automatic',
  who_made_it = 'Another Company Or Person',
  what_is_it = 'A Finished Product',
  listing_type = 'Physical Item',
  
  -- Product Classification
  style = 'Vintage',
  age_group = 'Adult (13+ years old)',
  size_type = 'Regular',
  
  -- Shipping & Discounts
  discounted_shipping = 'No Discount',
  
  -- Inventory & Status
  default_inventory_quantity = 1,
  default_status = 'Active',
  default_published = TRUE,
  
  -- Condition
  typical_condition = 'Excellent',
  
  -- Shipping Settings
  requires_shipping = TRUE,
  
  -- Default Care Instructions
  default_care_instructions = 'Machine wash cold, tumble dry low'
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
  seo_keywords = ARRAY['vintage sweatshirt', 'retro hoodie', 'vintage pullover'],
  default_tags = ARRAY['sweatshirt', 'hoodie', 'pullover', 'vintage', 'streetwear'],
  seo_description = 'Vintage sweatshirt in excellent condition. Perfect for casual wear and streetwear enthusiasts.',
  suggested_price_min = 25,
  suggested_price_max = 75,
  default_material = 'Cotton Blend',
  parcel_size = 'Medium',
  default_weight_value = '1.2',
  default_weight_unit = 'lb',
  package_dimensions = '12 x 10 x 3 inches'
WHERE product_type = 'sweatshirts';

-- Tees
UPDATE public.category_presets
SET
  shopify_product_type = 'T-Shirts',
  seo_title_template = '{brand} {model} T-Shirt - Vintage',
  seo_keywords = ARRAY['vintage t-shirt', 'retro tee', 'vintage shirt'],
  default_tags = ARRAY['t-shirt', 'tee', 'shirt', 'vintage', 'casual'],
  seo_description = 'Vintage t-shirt in excellent condition. Classic style and quality construction.',
  suggested_price_min = 15,
  suggested_price_max = 45,
  default_material = '100% Cotton',
  parcel_size = 'Small',
  default_weight_value = '0.5',
  default_weight_unit = 'lb',
  package_dimensions = '10 x 8 x 2 inches',
  default_care_instructions = 'Machine wash cold with like colors, tumble dry low'
WHERE product_type = 'tees';

-- Outerwear
UPDATE public.category_presets
SET
  shopify_product_type = 'Outerwear & Coats',
  seo_title_template = '{brand} {model} Jacket - Vintage',
  seo_keywords = ARRAY['vintage jacket', 'retro coat', 'vintage outerwear'],
  default_tags = ARRAY['jacket', 'coat', 'outerwear', 'vintage', 'layering'],
  seo_description = 'Vintage outerwear in excellent condition. Perfect for layering and cold weather.',
  suggested_price_min = 40,
  suggested_price_max = 150,
  default_material = 'Nylon',
  parcel_size = 'Large',
  default_weight_value = '1.5',
  default_weight_unit = 'lb',
  package_dimensions = '14 x 12 x 4 inches',
  default_care_instructions = 'Dry clean or machine wash cold, hang dry'
WHERE product_type = 'outerwear';

-- Pants
UPDATE public.category_presets
SET
  shopify_product_type = 'Pants',
  seo_title_template = '{brand} {model} Pants - Vintage',
  seo_keywords = ARRAY['vintage pants', 'retro trousers', 'vintage bottoms'],
  default_tags = ARRAY['pants', 'bottoms', 'trousers', 'vintage', 'classic'],
  seo_description = 'Vintage pants in excellent condition. Classic fit and timeless style.',
  suggested_price_min = 25,
  suggested_price_max = 80,
  default_material = 'Cotton',
  parcel_size = 'Medium',
  default_weight_value = '1.0',
  default_weight_unit = 'lb',
  package_dimensions = '12 x 10 x 3 inches'
WHERE product_type IN ('pants', 'bottoms');

-- Shorts
UPDATE public.category_presets
SET
  shopify_product_type = 'Shorts',
  seo_title_template = '{brand} {model} Shorts - Vintage',
  seo_keywords = ARRAY['vintage shorts', 'retro shorts'],
  default_tags = ARRAY['shorts', 'summer', 'vintage', 'casual'],
  seo_description = 'Vintage shorts in excellent condition. Perfect for summer wear.',
  suggested_price_min = 20,
  suggested_price_max = 50,
  default_material = 'Cotton',
  parcel_size = 'Small',
  default_weight_value = '0.6',
  default_weight_unit = 'lb',
  package_dimensions = '10 x 8 x 2 inches'
WHERE product_type = 'shorts';

-- Dresses
UPDATE public.category_presets
SET
  shopify_product_type = 'Dresses',
  seo_title_template = '{brand} {model} Dress - Vintage',
  seo_keywords = ARRAY['vintage dress', 'retro dress', 'vintage gown'],
  default_tags = ARRAY['dress', 'gown', 'vintage', 'womens', 'elegant'],
  seo_description = 'Vintage dress in excellent condition. Timeless elegance and classic style.',
  suggested_price_min = 30,
  suggested_price_max = 120,
  default_material = 'Polyester Blend',
  parcel_size = 'Medium',
  default_weight_value = '0.8',
  default_weight_unit = 'lb',
  package_dimensions = '12 x 10 x 3 inches'
WHERE product_type = 'dresses';

-- Skirts
UPDATE public.category_presets
SET
  shopify_product_type = 'Skirts',
  seo_title_template = '{brand} {model} Skirt - Vintage',
  seo_keywords = ARRAY['vintage skirt', 'retro skirt'],
  default_tags = ARRAY['skirt', 'vintage', 'womens', 'classic'],
  seo_description = 'Vintage skirt in excellent condition. Perfect for any occasion.',
  suggested_price_min = 20,
  suggested_price_max = 60,
  default_material = 'Cotton Blend',
  parcel_size = 'Small',
  default_weight_value = '0.5',
  default_weight_unit = 'lb',
  package_dimensions = '10 x 8 x 2 inches'
WHERE product_type = 'skirts';

-- Hats
UPDATE public.category_presets
SET
  shopify_product_type = 'Hats & Caps',
  seo_title_template = '{brand} {model} Hat - Vintage',
  seo_keywords = ARRAY['vintage hat', 'retro cap', 'vintage headwear'],
  default_tags = ARRAY['hat', 'cap', 'headwear', 'vintage', 'accessories'],
  seo_description = 'Vintage headwear in excellent condition. Classic style and quality.',
  suggested_price_min = 15,
  suggested_price_max = 45,
  default_material = 'Cotton',
  parcel_size = 'Small',
  default_weight_value = '0.3',
  default_weight_unit = 'lb',
  package_dimensions = '10 x 10 x 4 inches',
  default_care_instructions = 'Spot clean or hand wash cold'
WHERE product_type = 'hats';

-- Feminine
UPDATE public.category_presets
SET
  shopify_product_type = 'Womens Clothing',
  seo_title_template = '{brand} {model} - Vintage Womens',
  seo_keywords = ARRAY['vintage womens', 'retro feminine', 'vintage fashion'],
  default_tags = ARRAY['womens', 'feminine', 'vintage', 'fashion'],
  seo_description = 'Vintage womens clothing in excellent condition. Timeless style.',
  suggested_price_min = 25,
  suggested_price_max = 85,
  default_material = 'Cotton Blend',
  parcel_size = 'Medium',
  default_weight_value = '0.8',
  default_weight_unit = 'lb',
  package_dimensions = '12 x 10 x 3 inches'
WHERE product_type = 'femme';

-- Mystery Boxes
UPDATE public.category_presets
SET
  shopify_product_type = 'Mystery Boxes & Collections',
  seo_title_template = 'Vintage Mystery Box - {model}',
  seo_keywords = ARRAY['vintage mystery box', 'clothing bundle', 'vintage collection'],
  default_tags = ARRAY['mystery box', 'bundle', 'collection', 'vintage', 'reseller'],
  seo_description = 'Curated vintage clothing mystery box. Perfect for resellers and vintage enthusiasts.',
  suggested_price_min = 50,
  suggested_price_max = 200,
  parcel_size = 'Large',
  default_weight_value = '2.0',
  default_weight_unit = 'lb',
  package_dimensions = '16 x 12 x 6 inches',
  default_inventory_quantity = 5
WHERE product_type = 'mystery boxes';

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
  RAISE NOTICE '📊 Updated % presets with comprehensive default values', preset_count;
  RAISE NOTICE '';
  RAISE NOTICE '✅ Common Fields Set (All Categories):';
  RAISE NOTICE '   • ships_from: "601 W. Lincoln Ave, Fresno CA 93706"';
  RAISE NOTICE '   • policies: "No Returns; No Exchanges; All Sales Final"';
  RAISE NOTICE '   • renewal_options: "Automatic"';
  RAISE NOTICE '   • who_made_it: "Another Company Or Person"';
  RAISE NOTICE '   • what_is_it: "A Finished Product"';
  RAISE NOTICE '   • listing_type: "Physical Item"';
  RAISE NOTICE '   • style: "Vintage"';
  RAISE NOTICE '   • age_group: "Adult (13+ years old)"';
  RAISE NOTICE '   • size_type: "Regular"';
  RAISE NOTICE '   • typical_condition: "Excellent"';
  RAISE NOTICE '   • discounted_shipping: "No Discount"';
  RAISE NOTICE '   • default_inventory_quantity: 1';
  RAISE NOTICE '   • default_status: "Active"';
  RAISE NOTICE '   • default_published: TRUE';
  RAISE NOTICE '   • charge_tax: TRUE';
  RAISE NOTICE '   • inventory_tracker: "shopify"';
  RAISE NOTICE '   • default_care_instructions: Washing instructions';
  RAISE NOTICE '';
  RAISE NOTICE '✅ Category-Specific Fields Set:';
  RAISE NOTICE '   • Pricing ranges (suggested_price_min/max)';
  RAISE NOTICE '   • Materials (default_material)';
  RAISE NOTICE '   • Package dimensions and parcel_size';
  RAISE NOTICE '   • Weight values by category';
  RAISE NOTICE '   • SEO templates with {brand} {model} placeholders';
  RAISE NOTICE '   • SEO descriptions and keywords arrays';
  RAISE NOTICE '   • Default tags arrays (default_tags)';
  RAISE NOTICE '   • Shopify product types';
  RAISE NOTICE '   • Care instructions specific to fabric type';
  RAISE NOTICE '';
  RAISE NOTICE '✅ Gender set based on category (Unisex or Womens)';
  RAISE NOTICE '';
  RAISE NOTICE '📦 Complete Field Coverage:';
  RAISE NOTICE '   Total fields populated: 28+ per preset';
  RAISE NOTICE '   Including: Pricing, Shipping, SEO, Materials, Care, Status, Tags, Condition';
  RAISE NOTICE '';
  RAISE NOTICE '🎯 Now refresh your app and ALL preset fields will populate!';
  RAISE NOTICE '   ✓ Condition will show "Excellent"';
  RAISE NOTICE '   ✓ Tags will merge default_tags + seo_keywords';
  RAISE NOTICE '   ✓ Discounted Shipping will show "No Discount"';
  RAISE NOTICE '';
  RAISE NOTICE '=================================================================';
  RAISE NOTICE '';
END $$;
