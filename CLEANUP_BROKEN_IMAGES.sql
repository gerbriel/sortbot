-- Deletes all product_images rows for this user whose storage_path filename
-- contains a timestamp in the broken upload session range (1779695xxxxx).
-- These files were never written to Supabase Storage, causing browser 400s.
--
-- Run this in the Supabase SQL editor.
-- Replace the user_id below with the actual user UUID if needed (or leave
-- the subquery which reads it from auth.users).

-- Step 1: delete the broken product_images rows
DELETE FROM product_images
WHERE storage_path ~ '17796956|17796957'
  AND user_id = '18c356d9-2b6a-45c6-ae41-c6d360e9663f';

-- Step 2: delete products rows that now have no remaining product_images
DELETE FROM products
WHERE id IN (
  SELECT p.id
  FROM products p
  LEFT JOIN product_images pi ON pi.product_id = p.id
  WHERE pi.id IS NULL
    AND p.user_id = '18c356d9-2b6a-45c6-ae41-c6d360e9663f'
);
