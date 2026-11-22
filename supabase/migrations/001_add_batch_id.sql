-- Add batch_id column to products table
-- Run this in your Supabase SQL Editor to add batch tracking

ALTER TABLE public.products 
ADD COLUMN IF NOT EXISTS batch_id UUID;

-- Add index for faster batch queries
CREATE INDEX IF NOT EXISTS idx_products_batch_id ON public.products(batch_id);
CREATE INDEX IF NOT EXISTS idx_products_created_at ON public.products(created_at DESC);
