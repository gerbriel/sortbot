-- fix_invalid_preset_taxonomy_paths.sql
--
-- WHY -------------------------------------------------------------------------
-- The 2026-07-27 Shopify import failed 240 of 263 products with:
--     "Validation failed: Owner subtype does not match the metafield
--      definition's constraints."
-- plus warnings: "Kids' Outerwear is not a valid product category".
--
-- Root cause: category_presets.shopify_product_type held invented taxonomy
-- paths such as
--     Apparel & Accessories > Clothing > Kids' Clothing > Kids' Tops & T-Shirts
-- which are NOT in the Shopify Standard Product Taxonomy. csvExport.ts passed
-- them straight into the CSV's "Product Category" column. Shopify could not
-- resolve the category, so the standard metafields that are SCOPED BY CATEGORY
-- (shopify.color-pattern / shopify.fabric / shopify.target-gender) had no valid
-- owner subtype and the ENTIRE product was rejected. The only 23 products that
-- imported were the ones that happened to have all three of those metafields
-- blank — they still got the "not a valid product category" warning.
--
-- The exporter is now hardened (isKnownTaxonomyPath in src/lib/csvExport.ts):
-- an unrecognized path is discarded and the category-name maps drive both
-- columns instead. So THIS SCRIPT IS OPTIONAL for the export to work — it just
-- clears the bad values out of the preset rows so the Presets UI stops showing
-- them and so the preset can't reassert a wrong-but-valid path later.
--
-- SAFETY ----------------------------------------------------------------------
-- * Additive/idempotent. Touches ONE nullable column on category_presets.
-- * Sets the column to NULL only where the value is a path ('>' present) that
--   is not in the canonical allowlist below. NULL means "fall back to the
--   category-name maps", which is exactly what the app now does anyway.
-- * Short (non-path) values like 'Band Tees' are left alone — those legitimately
--   feed the CSV "Type" column only.
-- * Run step 1 FIRST and read the output before running step 2.
-- * Rollback at the bottom.

-- ── STEP 1: inspect. Run this alone first. ───────────────────────────────────
-- Lists every preset whose shopify_product_type is a path Shopify won't accept.
WITH valid_paths(path) AS (VALUES
  ('Apparel & Accessories > Clothing > Baby & Children''s Clothing > Baby & Children''s Bottoms'),
  ('Apparel & Accessories > Clothing > Baby & Children''s Clothing > Baby & Children''s Bottoms > Jeans'),
  ('Apparel & Accessories > Clothing > Baby & Children''s Clothing > Baby & Children''s Bottoms > Joggers'),
  ('Apparel & Accessories > Clothing > Baby & Children''s Clothing > Baby & Children''s Bottoms > Leggings'),
  ('Apparel & Accessories > Clothing > Baby & Children''s Clothing > Baby & Children''s Dresses'),
  ('Apparel & Accessories > Clothing > Baby & Children''s Clothing > Baby & Children''s Outerwear'),
  ('Apparel & Accessories > Clothing > Baby & Children''s Clothing > Baby & Children''s Outerwear > Baby & Children''s Coats & Jackets'),
  ('Apparel & Accessories > Clothing > Baby & Children''s Clothing > Baby & Children''s Tops'),
  ('Apparel & Accessories > Clothing > Baby & Children''s Clothing > Baby & Children''s Tops > Hoodies'),
  ('Apparel & Accessories > Clothing > Baby & Children''s Clothing > Baby & Children''s Tops > Shirts'),
  ('Apparel & Accessories > Clothing > Baby & Children''s Clothing > Baby & Children''s Tops > Sweatshirts'),
  ('Apparel & Accessories > Clothing > Baby & Children''s Clothing > Baby & Children''s Tops > T-Shirts'),
  ('Apparel & Accessories > Clothing > Clothing Tops'),
  ('Apparel & Accessories > Clothing > Clothing Tops > Bodysuits'),
  ('Apparel & Accessories > Clothing > Clothing Tops > Cardigans'),
  ('Apparel & Accessories > Clothing > Clothing Tops > Hoodies'),
  ('Apparel & Accessories > Clothing > Clothing Tops > Polos'),
  ('Apparel & Accessories > Clothing > Clothing Tops > Shirts'),
  ('Apparel & Accessories > Clothing > Clothing Tops > Sweaters'),
  ('Apparel & Accessories > Clothing > Clothing Tops > Sweatshirts'),
  ('Apparel & Accessories > Clothing > Clothing Tops > T-Shirts'),
  ('Apparel & Accessories > Clothing > Dresses'),
  ('Apparel & Accessories > Clothing > Outerwear > Coats & Jackets'),
  ('Apparel & Accessories > Clothing > Pants'),
  ('Apparel & Accessories > Clothing > Pants > Chinos'),
  ('Apparel & Accessories > Clothing > Pants > Jeans'),
  ('Apparel & Accessories > Clothing > Pants > Joggers'),
  ('Apparel & Accessories > Clothing > Pants > Leggings'),
  ('Apparel & Accessories > Clothing > Pants > Trousers'),
  ('Apparel & Accessories > Clothing > Shorts'),
  ('Apparel & Accessories > Clothing > Skirts'),
  ('Apparel & Accessories > Clothing Accessories'),
  ('Apparel & Accessories > Clothing Accessories > Baby & Children''s Clothing Accessories'),
  ('Apparel & Accessories > Clothing Accessories > Baby & Children''s Clothing Accessories > Baby & Children''s Hats'),
  ('Apparel & Accessories > Clothing Accessories > Hats'),
  ('Apparel & Accessories > Clothing Accessories > Hats > Baseball Caps'),
  ('Apparel & Accessories > Clothing Accessories > Hats > Beanies'),
  ('Apparel & Accessories > Shoes'),
  ('Apparel & Accessories > Shoes > Baby & Children''s Shoes'),
  ('Apparel & Accessories > Shoes > Baby & Children''s Shoes > Baby & Children''s Boots'),
  ('Apparel & Accessories > Shoes > Baby & Children''s Shoes > Baby & Children''s Sneakers'),
  ('Apparel & Accessories > Shoes > Boots'),
  ('Apparel & Accessories > Shoes > Sneakers')
)
SELECT id, category_name, product_type, shopify_product_type, is_active
FROM category_presets
WHERE shopify_product_type LIKE '%>%'
  AND lower(btrim(shopify_product_type)) NOT IN (SELECT lower(path) FROM valid_paths)
ORDER BY category_name;

-- ── STEP 2: repair. Run only after reviewing step 1's output. ────────────────
-- Uncomment to apply.
--
-- WITH valid_paths(path) AS (VALUES
--   -- (paste the same VALUES list from step 1 here)
--   ('Apparel & Accessories > Clothing > Clothing Tops > T-Shirts')
-- )
-- UPDATE category_presets
-- SET shopify_product_type = NULL
-- WHERE shopify_product_type LIKE '%>%'
--   AND lower(btrim(shopify_product_type)) NOT IN (SELECT lower(path) FROM valid_paths);

-- ── ROLLBACK ─────────────────────────────────────────────────────────────────
-- There is no automatic rollback: the previous values were invalid. To restore
-- a specific preset's path, set it explicitly to one of the allowlisted paths:
--   UPDATE category_presets SET shopify_product_type =
--     'Apparel & Accessories > Clothing > Clothing Tops > T-Shirts'
--   WHERE category_name = 'tees';
