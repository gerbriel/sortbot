-- ============================================================
-- Update all system category presets (user_id = 00000000...)
-- Sets:
--   typical_condition = 'Good'
--   ships_from        = '601 W. Lincoln Ave, Fresno CA 93706'
--   style             = 'Vintage'
--   policies          = 'No Returns; No Exchanges; All Sales Final'
--   renewal_options   = 'Automatic'
--   who_made_it       = 'Another Company Or Person'
--   what_is_it        = 'A Finished Product'
--   listing_type      = 'Physical Item'
--   discounted_shipping = 'No Discount'
--   parcel_size       = Small / Medium / Large by category weight
--   package_dimensions = matching box/mailer dimensions (L x W x H in)
--
-- NOTE: is_default is intentionally NOT set here — the unique constraint
--   idx_category_presets_unique_default allows only one TRUE per product_type
--   per user, and multiple categories share the same product_type (e.g.
--   mens-pants / womens-pants / kids-pants all = "Pants").
--
-- Parcel size tiers (per Shopify weight guidelines):
--   Small  → poly mailer  14 x 10 x 1 in   (<1 lb: tees, shirts, shorts, hats, accessories)
--   Medium → small box    14 x 12 x 4 in   (1–2 lb: hoodies, sweatshirts, pants, jeans, dresses, jerseys, kids jackets/shoes)
--   Large  → medium box   16 x 12 x 6 in   (>2 lb: adult jackets, adult shoes)
-- ============================================================

UPDATE category_presets
SET
  typical_condition   = 'Good',
  ships_from          = '601 W. Lincoln Ave, Fresno CA 93706',
  style               = 'Vintage',
  policies            = 'No Returns; No Exchanges; All Sales Final',
  renewal_options     = 'Automatic',
  who_made_it         = 'Another Company Or Person',
  what_is_it          = 'A Finished Product',
  listing_type        = 'Physical Item',
  discounted_shipping = 'No Discount',

  parcel_size = CASE category_name
    -- Small (poly mailer, <1 lb)
    WHEN 'mens-tees'            THEN 'Small'
    WHEN 'womens-tees'          THEN 'Small'
    WHEN 'kids-tees'            THEN 'Small'
    WHEN 'mens-shirts'          THEN 'Small'
    WHEN 'kids-shirts'          THEN 'Small'
    WHEN 'womens-tops'          THEN 'Small'
    WHEN 'womens-bodysuits'     THEN 'Small'
    WHEN 'womens-skirts'        THEN 'Small'
    WHEN 'womens-shorts'        THEN 'Small'
    WHEN 'mens-shorts'          THEN 'Small'
    WHEN 'kids-shorts'          THEN 'Small'
    WHEN 'mens-hats'            THEN 'Small'
    WHEN 'womens-hats'          THEN 'Small'
    WHEN 'kids-hats'            THEN 'Small'
    WHEN 'mens-accessories'     THEN 'Small'
    WHEN 'womens-accessories'   THEN 'Small'
    WHEN 'kids-accessories'     THEN 'Small'
    WHEN 'kids-sweatshirts'     THEN 'Small'
    WHEN 'kids-hoodies'         THEN 'Small'
    -- Medium (small box, 1–2 lb)
    WHEN 'mens-sweatshirts'     THEN 'Medium'
    WHEN 'womens-sweatshirts'   THEN 'Medium'
    WHEN 'mens-hoodies'         THEN 'Medium'
    WHEN 'womens-hoodies'       THEN 'Medium'
    WHEN 'mens-pants'           THEN 'Medium'
    WHEN 'womens-pants'         THEN 'Medium'
    WHEN 'mens-jeans'           THEN 'Medium'
    WHEN 'womens-jeans'         THEN 'Medium'
    WHEN 'kids-pants'           THEN 'Medium'
    WHEN 'mens-jerseys'         THEN 'Medium'
    WHEN 'womens-dresses'       THEN 'Medium'
    WHEN 'kids-dresses'         THEN 'Medium'
    WHEN 'kids-jackets'         THEN 'Medium'
    WHEN 'kids-shoes'           THEN 'Medium'
    -- Large (medium box, >2 lb)
    WHEN 'mens-jackets'         THEN 'Large'
    WHEN 'womens-jackets'       THEN 'Large'
    WHEN 'mens-shoes'           THEN 'Large'
    WHEN 'womens-shoes'         THEN 'Large'
    ELSE parcel_size
  END,

  package_dimensions = CASE category_name
    -- Small → poly mailer 14 x 10 x 1 in
    WHEN 'mens-tees'            THEN '14 x 10 x 1 in'
    WHEN 'womens-tees'          THEN '14 x 10 x 1 in'
    WHEN 'kids-tees'            THEN '14 x 10 x 1 in'
    WHEN 'mens-shirts'          THEN '14 x 10 x 1 in'
    WHEN 'kids-shirts'          THEN '14 x 10 x 1 in'
    WHEN 'womens-tops'          THEN '14 x 10 x 1 in'
    WHEN 'womens-bodysuits'     THEN '14 x 10 x 1 in'
    WHEN 'womens-skirts'        THEN '14 x 10 x 1 in'
    WHEN 'womens-shorts'        THEN '14 x 10 x 1 in'
    WHEN 'mens-shorts'          THEN '14 x 10 x 1 in'
    WHEN 'kids-shorts'          THEN '14 x 10 x 1 in'
    WHEN 'mens-hats'            THEN '14 x 10 x 1 in'
    WHEN 'womens-hats'          THEN '14 x 10 x 1 in'
    WHEN 'kids-hats'            THEN '14 x 10 x 1 in'
    WHEN 'mens-accessories'     THEN '14 x 10 x 1 in'
    WHEN 'womens-accessories'   THEN '14 x 10 x 1 in'
    WHEN 'kids-accessories'     THEN '14 x 10 x 1 in'
    WHEN 'kids-sweatshirts'     THEN '14 x 10 x 1 in'
    WHEN 'kids-hoodies'         THEN '14 x 10 x 1 in'
    -- Medium → small box 14 x 12 x 4 in
    WHEN 'mens-sweatshirts'     THEN '14 x 12 x 4 in'
    WHEN 'womens-sweatshirts'   THEN '14 x 12 x 4 in'
    WHEN 'mens-hoodies'         THEN '14 x 12 x 4 in'
    WHEN 'womens-hoodies'       THEN '14 x 12 x 4 in'
    WHEN 'mens-pants'           THEN '14 x 12 x 4 in'
    WHEN 'womens-pants'         THEN '14 x 12 x 4 in'
    WHEN 'mens-jeans'           THEN '14 x 12 x 4 in'
    WHEN 'womens-jeans'         THEN '14 x 12 x 4 in'
    WHEN 'kids-pants'           THEN '14 x 12 x 4 in'
    WHEN 'mens-jerseys'         THEN '14 x 12 x 4 in'
    WHEN 'womens-dresses'       THEN '14 x 12 x 4 in'
    WHEN 'kids-dresses'         THEN '14 x 12 x 4 in'
    WHEN 'kids-jackets'         THEN '14 x 12 x 4 in'
    WHEN 'kids-shoes'           THEN '14 x 12 x 4 in'
    -- Large → medium box 16 x 12 x 6 in
    WHEN 'mens-jackets'         THEN '16 x 12 x 6 in'
    WHEN 'womens-jackets'       THEN '16 x 12 x 6 in'
    WHEN 'mens-shoes'           THEN '16 x 12 x 6 in'
    WHEN 'womens-shoes'         THEN '16 x 12 x 6 in'
    ELSE package_dimensions
  END

WHERE user_id = '00000000-0000-0000-0000-000000000000'
  AND is_active = TRUE;

-- ============================================================
-- Update age_group based on category_name prefix
--   mens-*   → 'adult'
--   womens-* → 'adult'
--   kids-*   → 'kids'
-- ============================================================

UPDATE category_presets
SET age_group = CASE
  WHEN category_name LIKE 'mens-%'   THEN 'adult'
  WHEN category_name LIKE 'womens-%' THEN 'adult'
  WHEN category_name LIKE 'kids-%'   THEN 'kids'
  ELSE age_group
END
WHERE user_id = '00000000-0000-0000-0000-000000000000'
  AND is_active = TRUE;
