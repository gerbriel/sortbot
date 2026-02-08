-- Migration: Add unique constraint to product_images and clean up duplicates
-- This prevents the same image_url from being inserted multiple times for the same product

-- Step 1: Identify and mark duplicates (keep the oldest one)
-- Create a temporary table with IDs to keep
CREATE TEMP TABLE images_to_keep AS
SELECT DISTINCT ON (product_id, image_url) id
FROM product_images
ORDER BY product_id, image_url, created_at ASC;

-- Step 2: Delete duplicate rows (keep only the ones in images_to_keep)
DELETE FROM product_images
WHERE id NOT IN (SELECT id FROM images_to_keep);

-- Step 3: Add unique constraint to prevent future duplicates
-- This ensures a product cannot have the same image_url twice
ALTER TABLE product_images
ADD CONSTRAINT unique_product_image_url 
UNIQUE (product_id, image_url);

-- Step 4: Create index for better query performance
CREATE INDEX IF NOT EXISTS idx_product_images_product_url 
ON product_images(product_id, image_url);

-- Note: This migration is idempotent and safe to run multiple times
-- If the constraint already exists, it will fail gracefully
