-- Backfill user_id on product_images rows that are missing it.
-- Joins product_images → products to copy user_id from the parent product row.
-- Safe to run multiple times (WHERE user_id IS NULL only touches unfilled rows).
UPDATE product_images pi
SET user_id = p.user_id
FROM products p
WHERE pi.product_id = p.id
  AND pi.user_id IS NULL
  AND p.user_id IS NOT NULL;
