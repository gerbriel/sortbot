-- Migration: add transforms JSONB to product_images

ALTER TABLE public.product_images
  ADD COLUMN IF NOT EXISTS transforms JSONB DEFAULT '{}'::jsonb;

-- Add index for quick lookup if needed
CREATE INDEX IF NOT EXISTS idx_product_images_transforms ON public.product_images USING gin (transforms);
