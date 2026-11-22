-- ============================================================
-- SEED GENDER-FILTERED CATEGORY PRESETS
-- Shopify Apparel Taxonomy (April 2026)
--
-- Run in: supabase.com/dashboard/project/raaenaqjsmihimegflhj/sql/new
--
-- 1. Deletes old "Femme" and "Kids" category presets
-- 2. Inserts Men / Women / Kids presets mapped to Shopify's
--    official product category taxonomy
--
-- NOTE: user_id = '00000000-0000-0000-0000-000000000000' marks
--   these as shared system presets visible to ALL users per the
--   RLS policy: "user_id = '00000000...' OR auth.uid() = user_id"
--
-- shopify_product_type values verified against the official
-- Shopify Standard Product Taxonomy (github.com/Shopify/product-taxonomy)
-- GIDs confirmed:
--   aa-1-13-8  = Apparel & Accessories > Clothing > Clothing Tops > T-Shirts
--   aa-1-13-7  = Apparel & Accessories > Clothing > Clothing Tops > Shirts
--   aa-1-13-14 = Apparel & Accessories > Clothing > Clothing Tops > Sweatshirts
--   aa-1-13-13 = Apparel & Accessories > Clothing > Clothing Tops > Hoodies
--   aa-1-13-2  = Apparel & Accessories > Clothing > Clothing Tops > Bodysuits
--   aa-1-10-2  = Apparel & Accessories > Clothing > Outerwear > Coats & Jackets
--   aa-1-12    = Apparel & Accessories > Clothing > Pants
--   aa-1-12-4  = Apparel & Accessories > Clothing > Pants > Jeans
--   aa-1-14    = Apparel & Accessories > Clothing > Shorts
--   aa-1-4     = Apparel & Accessories > Clothing > Dresses
--   aa-1-15    = Apparel & Accessories > Clothing > Skirts
--   aa-2-17    = Apparel & Accessories > Clothing Accessories > Hats
--   aa-8-1     = Apparel & Accessories > Shoes > Athletic Shoes
--   aa-2       = Apparel & Accessories > Clothing Accessories
--   aa-1-25-9-7  = Apparel & Accessories > Clothing > Baby & Children's Clothing > Baby & Children's Tops > T-Shirts
--   aa-1-25-9-6  = Apparel & Accessories > Clothing > Baby & Children's Clothing > Baby & Children's Tops > Shirts
--   aa-1-25-9-13 = Apparel & Accessories > Clothing > Baby & Children's Clothing > Baby & Children's Tops > Sweatshirts
--   aa-1-25-9-11 = Apparel & Accessories > Clothing > Baby & Children's Clothing > Baby & Children's Tops > Hoodies
--   aa-1-25-4    = Apparel & Accessories > Clothing > Baby & Children's Clothing > Baby & Children's Outerwear
--   aa-1-25-4-17 = Apparel & Accessories > Clothing > Baby & Children's Clothing > Baby & Children's Outerwear > Baby & Children's Coats & Jackets
--   aa-1-25-1    = Apparel & Accessories > Clothing > Baby & Children's Clothing > Baby & Children's Bottoms
--   aa-1-25-3    = Apparel & Accessories > Clothing > Baby & Children's Clothing > Baby & Children's Dresses
--   aa-2-33-3    = Apparel & Accessories > Clothing Accessories > Baby & Children's Clothing Accessories > Baby & Children's Hats
--   aa-8-11      = Apparel & Accessories > Shoes > Baby & Children's Shoes
-- ============================================================

-- ── Step 1: Remove old presets ───────────────────────────────
-- Hard-delete anything matching "Femme" or "Kids" category names
-- (catches both active and soft-deleted rows)
DELETE FROM category_presets
WHERE LOWER(display_name) LIKE '%femme%'
   OR LOWER(category_name) LIKE '%femme%'
   OR LOWER(display_name) = 'kids'
   OR LOWER(category_name) = 'kids';

-- Also remove any previously seeded gender presets with the system UUID
-- so re-running this script is safe (idempotent via delete + insert)
DELETE FROM category_presets
WHERE user_id = '00000000-0000-0000-0000-000000000000'
  AND gender IN ('Men', 'Women', 'Kids');

-- ── 2. Men's presets ─────────────────────────────────────────
-- Shopify taxonomy: Apparel & Accessories > Clothing > [category]

INSERT INTO category_presets (user_id, category_name, display_name, gender, product_type, shopify_product_type, default_weight_value, default_weight_unit, requires_shipping, measurement_template, is_active, default_tags) VALUES
('00000000-0000-0000-0000-000000000000', 'mens-tees',        'Men''s Tees',        'Men', 'T-Shirts',        'Apparel & Accessories > Clothing > Clothing Tops > T-Shirts',                        '0.3', 'lb', true, '{"width":true,"length":true,"sleeve":false,"shoulder":true,"waist":false,"inseam":false,"rise":false}',  true, ARRAY['vintage','tee','shirt','mens']),
('00000000-0000-0000-0000-000000000000', 'mens-shirts',      'Men''s Shirts',      'Men', 'Shirts',          'Apparel & Accessories > Clothing > Clothing Tops > Shirts',                          '0.4', 'lb', true, '{"width":true,"length":true,"sleeve":true,"shoulder":true,"waist":false,"inseam":false,"rise":false}',   true, ARRAY['vintage','shirt','button-up','mens']),
('00000000-0000-0000-0000-000000000000', 'mens-sweatshirts', 'Men''s Sweatshirts', 'Men', 'Sweatshirts',     'Apparel & Accessories > Clothing > Clothing Tops > Sweatshirts',                     '0.6', 'lb', true, '{"width":true,"length":true,"sleeve":true,"shoulder":true,"waist":false,"inseam":false,"rise":false}',   true, ARRAY['vintage','sweatshirt','crewneck','mens']),
('00000000-0000-0000-0000-000000000000', 'mens-hoodies',     'Men''s Hoodies',     'Men', 'Hoodies',         'Apparel & Accessories > Clothing > Clothing Tops > Hoodies',                         '0.7', 'lb', true, '{"width":true,"length":true,"sleeve":true,"shoulder":true,"waist":false,"inseam":false,"rise":false}',   true, ARRAY['vintage','hoodie','mens']),
('00000000-0000-0000-0000-000000000000', 'mens-jackets',     'Men''s Jackets',     'Men', 'Jackets & Coats', 'Apparel & Accessories > Clothing > Outerwear > Coats & Jackets',                    '1.2', 'lb', true, '{"width":true,"length":true,"sleeve":true,"shoulder":true,"waist":false,"inseam":false,"rise":false}',   true, ARRAY['vintage','jacket','outerwear','mens']),
('00000000-0000-0000-0000-000000000000', 'mens-pants',       'Men''s Pants',       'Men', 'Pants',           'Apparel & Accessories > Clothing > Pants',                                          '0.7', 'lb', true, '{"width":false,"length":false,"sleeve":false,"shoulder":false,"waist":true,"inseam":true,"rise":true}',   true, ARRAY['vintage','pants','trousers','mens']),
('00000000-0000-0000-0000-000000000000', 'mens-shorts',      'Men''s Shorts',      'Men', 'Shorts',          'Apparel & Accessories > Clothing > Shorts',                                         '0.4', 'lb', true, '{"width":false,"length":false,"sleeve":false,"shoulder":false,"waist":true,"inseam":true,"rise":true}',   true, ARRAY['vintage','shorts','mens']),
('00000000-0000-0000-0000-000000000000', 'mens-jeans',       'Men''s Jeans',       'Men', 'Jeans',           'Apparel & Accessories > Clothing > Pants > Jeans',                                  '0.8', 'lb', true, '{"width":false,"length":false,"sleeve":false,"shoulder":false,"waist":true,"inseam":true,"rise":true}',   true, ARRAY['vintage','denim','jeans','mens']),
('00000000-0000-0000-0000-000000000000', 'mens-jerseys',     'Men''s Jerseys',     'Men', 'Jerseys',         'Apparel & Accessories > Clothing > Activewear > Activewear Tops > T-Shirts',        '0.5', 'lb', true, '{"width":true,"length":true,"sleeve":true,"shoulder":true,"waist":false,"inseam":false,"rise":false}',   true, ARRAY['vintage','jersey','sports','mens']),
('00000000-0000-0000-0000-000000000000', 'mens-hats',        'Men''s Hats',        'Men', 'Hats',            'Apparel & Accessories > Clothing Accessories > Hats',                               '0.2', 'lb', true, '{"width":false,"length":false,"sleeve":false,"shoulder":false,"waist":false,"inseam":false,"rise":false}', true, ARRAY['vintage','hat','cap','mens']),
('00000000-0000-0000-0000-000000000000', 'mens-shoes',       'Men''s Shoes',       'Men', 'Shoes',           'Apparel & Accessories > Shoes > Athletic Shoes',                                    '1.0', 'lb', true, '{"width":false,"length":false,"sleeve":false,"shoulder":false,"waist":false,"inseam":false,"rise":false}', true, ARRAY['vintage','shoes','sneakers','mens']),
('00000000-0000-0000-0000-000000000000', 'mens-accessories', 'Men''s Accessories', 'Men', 'Accessories',     'Apparel & Accessories > Clothing Accessories',                                      '0.2', 'lb', true, '{"width":false,"length":false,"sleeve":false,"shoulder":false,"waist":false,"inseam":false,"rise":false}', true, ARRAY['vintage','accessories','mens']);


-- ── 3. Women's presets ───────────────────────────────────────

INSERT INTO category_presets (user_id, category_name, display_name, gender, product_type, shopify_product_type, default_weight_value, default_weight_unit, requires_shipping, measurement_template, is_active, default_tags) VALUES
('00000000-0000-0000-0000-000000000000', 'womens-tees',        'Women''s Tees',        'Women', 'T-Shirts',        'Apparel & Accessories > Clothing > Clothing Tops > T-Shirts',                        '0.3', 'lb', true, '{"width":true,"length":true,"sleeve":false,"shoulder":true,"waist":false,"inseam":false,"rise":false}',  true, ARRAY['vintage','tee','top','womens']),
('00000000-0000-0000-0000-000000000000', 'womens-tops',        'Women''s Tops',        'Women', 'Tops',            'Apparel & Accessories > Clothing > Clothing Tops > Shirts',                          '0.3', 'lb', true, '{"width":true,"length":true,"sleeve":true,"shoulder":true,"waist":false,"inseam":false,"rise":false}',   true, ARRAY['vintage','top','blouse','womens']),
('00000000-0000-0000-0000-000000000000', 'womens-sweatshirts', 'Women''s Sweatshirts', 'Women', 'Sweatshirts',     'Apparel & Accessories > Clothing > Clothing Tops > Sweatshirts',                     '0.6', 'lb', true, '{"width":true,"length":true,"sleeve":true,"shoulder":true,"waist":false,"inseam":false,"rise":false}',   true, ARRAY['vintage','sweatshirt','crewneck','womens']),
('00000000-0000-0000-0000-000000000000', 'womens-hoodies',     'Women''s Hoodies',     'Women', 'Hoodies',         'Apparel & Accessories > Clothing > Clothing Tops > Hoodies',                         '0.7', 'lb', true, '{"width":true,"length":true,"sleeve":true,"shoulder":true,"waist":false,"inseam":false,"rise":false}',   true, ARRAY['vintage','hoodie','womens']),
('00000000-0000-0000-0000-000000000000', 'womens-jackets',     'Women''s Jackets',     'Women', 'Jackets & Coats', 'Apparel & Accessories > Clothing > Outerwear > Coats & Jackets',                    '1.0', 'lb', true, '{"width":true,"length":true,"sleeve":true,"shoulder":true,"waist":false,"inseam":false,"rise":false}',   true, ARRAY['vintage','jacket','outerwear','womens']),
('00000000-0000-0000-0000-000000000000', 'womens-dresses',     'Women''s Dresses',     'Women', 'Dresses',         'Apparel & Accessories > Clothing > Dresses',                                        '0.6', 'lb', true, '{"width":true,"length":true,"sleeve":false,"shoulder":false,"waist":true,"inseam":false,"rise":false}',   true, ARRAY['vintage','dress','womens']),
('00000000-0000-0000-0000-000000000000', 'womens-skirts',      'Women''s Skirts',      'Women', 'Skirts',          'Apparel & Accessories > Clothing > Skirts',                                         '0.4', 'lb', true, '{"width":false,"length":true,"sleeve":false,"shoulder":false,"waist":true,"inseam":false,"rise":false}',  true, ARRAY['vintage','skirt','womens']),
('00000000-0000-0000-0000-000000000000', 'womens-pants',       'Women''s Pants',       'Women', 'Pants',           'Apparel & Accessories > Clothing > Pants',                                          '0.6', 'lb', true, '{"width":false,"length":false,"sleeve":false,"shoulder":false,"waist":true,"inseam":true,"rise":true}',   true, ARRAY['vintage','pants','womens']),
('00000000-0000-0000-0000-000000000000', 'womens-jeans',       'Women''s Jeans',       'Women', 'Jeans',           'Apparel & Accessories > Clothing > Pants > Jeans',                                  '0.8', 'lb', true, '{"width":false,"length":false,"sleeve":false,"shoulder":false,"waist":true,"inseam":true,"rise":true}',   true, ARRAY['vintage','denim','jeans','womens']),
('00000000-0000-0000-0000-000000000000', 'womens-shorts',      'Women''s Shorts',      'Women', 'Shorts',          'Apparel & Accessories > Clothing > Shorts',                                         '0.4', 'lb', true, '{"width":false,"length":false,"sleeve":false,"shoulder":false,"waist":true,"inseam":true,"rise":false}',  true, ARRAY['vintage','shorts','womens']),
('00000000-0000-0000-0000-000000000000', 'womens-bodysuits',   'Women''s Bodysuits',   'Women', 'Bodysuits',       'Apparel & Accessories > Clothing > Clothing Tops > Bodysuits',                      '0.3', 'lb', true, '{"width":true,"length":true,"sleeve":false,"shoulder":false,"waist":false,"inseam":false,"rise":false}',  true, ARRAY['vintage','bodysuit','womens']),
('00000000-0000-0000-0000-000000000000', 'womens-hats',        'Women''s Hats',        'Women', 'Hats',            'Apparel & Accessories > Clothing Accessories > Hats',                               '0.2', 'lb', true, '{"width":false,"length":false,"sleeve":false,"shoulder":false,"waist":false,"inseam":false,"rise":false}', true, ARRAY['vintage','hat','womens']),
('00000000-0000-0000-0000-000000000000', 'womens-shoes',       'Women''s Shoes',       'Women', 'Shoes',           'Apparel & Accessories > Shoes > Athletic Shoes',                                    '0.9', 'lb', true, '{"width":false,"length":false,"sleeve":false,"shoulder":false,"waist":false,"inseam":false,"rise":false}', true, ARRAY['vintage','shoes','womens']),
('00000000-0000-0000-0000-000000000000', 'womens-accessories', 'Women''s Accessories', 'Women', 'Accessories',     'Apparel & Accessories > Clothing Accessories',                                      '0.2', 'lb', true, '{"width":false,"length":false,"sleeve":false,"shoulder":false,"waist":false,"inseam":false,"rise":false}', true, ARRAY['vintage','accessories','womens']);


-- ── 4. Kids' presets ─────────────────────────────────────────

INSERT INTO category_presets (user_id, category_name, display_name, gender, product_type, shopify_product_type, default_weight_value, default_weight_unit, requires_shipping, measurement_template, is_active, default_tags) VALUES
('00000000-0000-0000-0000-000000000000', 'kids-tees',        'Kids Tees',        'Kids', 'T-Shirts',        'Apparel & Accessories > Clothing > Baby & Children''s Clothing > Baby & Children''s Tops > T-Shirts',               '0.2', 'lb', true, '{"width":true,"length":true,"sleeve":false,"shoulder":false,"waist":false,"inseam":false,"rise":false}', true, ARRAY['vintage','kids','tee']),
('00000000-0000-0000-0000-000000000000', 'kids-shirts',      'Kids Shirts',      'Kids', 'Shirts',          'Apparel & Accessories > Clothing > Baby & Children''s Clothing > Baby & Children''s Tops > Shirts',                 '0.3', 'lb', true, '{"width":true,"length":true,"sleeve":true,"shoulder":false,"waist":false,"inseam":false,"rise":false}',  true, ARRAY['vintage','kids','shirt']),
('00000000-0000-0000-0000-000000000000', 'kids-sweatshirts', 'Kids Sweatshirts', 'Kids', 'Sweatshirts',     'Apparel & Accessories > Clothing > Baby & Children''s Clothing > Baby & Children''s Tops > Sweatshirts',            '0.4', 'lb', true, '{"width":true,"length":true,"sleeve":true,"shoulder":false,"waist":false,"inseam":false,"rise":false}',  true, ARRAY['vintage','kids','sweatshirt']),
('00000000-0000-0000-0000-000000000000', 'kids-hoodies',     'Kids Hoodies',     'Kids', 'Hoodies',         'Apparel & Accessories > Clothing > Baby & Children''s Clothing > Baby & Children''s Tops > Hoodies',               '0.5', 'lb', true, '{"width":true,"length":true,"sleeve":true,"shoulder":false,"waist":false,"inseam":false,"rise":false}',  true, ARRAY['vintage','kids','hoodie']),
('00000000-0000-0000-0000-000000000000', 'kids-pants',       'Kids Pants',       'Kids', 'Pants',           'Apparel & Accessories > Clothing > Baby & Children''s Clothing > Baby & Children''s Bottoms',                      '0.4', 'lb', true, '{"width":false,"length":false,"sleeve":false,"shoulder":false,"waist":true,"inseam":true,"rise":false}',  true, ARRAY['vintage','kids','pants']),
('00000000-0000-0000-0000-000000000000', 'kids-shorts',      'Kids Shorts',      'Kids', 'Shorts',          'Apparel & Accessories > Clothing > Baby & Children''s Clothing > Baby & Children''s Bottoms',                      '0.3', 'lb', true, '{"width":false,"length":false,"sleeve":false,"shoulder":false,"waist":true,"inseam":true,"rise":false}',  true, ARRAY['vintage','kids','shorts']),
('00000000-0000-0000-0000-000000000000', 'kids-dresses',     'Kids Dresses',     'Kids', 'Dresses',         'Apparel & Accessories > Clothing > Baby & Children''s Clothing > Baby & Children''s Dresses',                      '0.4', 'lb', true, '{"width":true,"length":true,"sleeve":false,"shoulder":false,"waist":false,"inseam":false,"rise":false}',  true, ARRAY['vintage','kids','dress']),
('00000000-0000-0000-0000-000000000000', 'kids-jackets',     'Kids Jackets',     'Kids', 'Jackets & Coats', 'Apparel & Accessories > Clothing > Baby & Children''s Clothing > Baby & Children''s Outerwear > Baby & Children''s Coats & Jackets', '0.6', 'lb', true, '{"width":true,"length":true,"sleeve":true,"shoulder":false,"waist":false,"inseam":false,"rise":false}',  true, ARRAY['vintage','kids','jacket']),
('00000000-0000-0000-0000-000000000000', 'kids-hats',        'Kids Hats',        'Kids', 'Hats',            'Apparel & Accessories > Clothing Accessories > Baby & Children''s Clothing Accessories > Baby & Children''s Hats', '0.1', 'lb', true, '{"width":false,"length":false,"sleeve":false,"shoulder":false,"waist":false,"inseam":false,"rise":false}', true, ARRAY['vintage','kids','hat']),
('00000000-0000-0000-0000-000000000000', 'kids-shoes',       'Kids Shoes',       'Kids', 'Shoes',           'Apparel & Accessories > Shoes > Baby & Children''s Shoes',                                                          '0.6', 'lb', true, '{"width":false,"length":false,"sleeve":false,"shoulder":false,"waist":false,"inseam":false,"rise":false}', true, ARRAY['vintage','kids','shoes']),
('00000000-0000-0000-0000-000000000000', 'kids-accessories', 'Kids Accessories', 'Kids', 'Accessories',     'Apparel & Accessories > Clothing Accessories > Baby & Children''s Clothing Accessories',                           '0.1', 'lb', true, '{"width":false,"length":false,"sleeve":false,"shoulder":false,"waist":false,"inseam":false,"rise":false}', true, ARRAY['vintage','kids','accessories']);


-- ── 5. Verify ────────────────────────────────────────────────
SELECT gender, COUNT(*) AS count
FROM category_presets
WHERE user_id = '00000000-0000-0000-0000-000000000000'
GROUP BY gender
ORDER BY gender;
