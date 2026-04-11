-- Add original_name column to product_images
-- Stores the original filename from the user's device (e.g. "DSC02175.jpg")
-- Used for natural-order name sorting in Step 2.
-- Nullable — NULL for rows inserted before this migration.

ALTER TABLE public.product_images
  ADD COLUMN IF NOT EXISTS original_name TEXT;
