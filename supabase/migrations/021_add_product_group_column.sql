-- Migration: Add product_group column to products table
-- This stores the ImageGrouper group ID so multi-image products can be
-- associated together in the Library and export.

ALTER TABLE products
ADD COLUMN IF NOT EXISTS product_group TEXT;

-- Index for fast group lookups
CREATE INDEX IF NOT EXISTS idx_products_product_group ON products(product_group);
