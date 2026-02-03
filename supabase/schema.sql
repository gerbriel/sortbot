-- Supabase Schema for Sortbot
-- Run this in your Supabase SQL Editor

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users table (extends auth.users)
-- Supabase auth handles this automatically, but we can add a profile
CREATE TABLE public.user_profiles (
  id UUID REFERENCES auth.users(id) PRIMARY KEY,
  email TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Products table (one per product listing)
CREATE TABLE public.products (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  
  -- Core product info
  title TEXT,
  url_handle TEXT,
  description TEXT,
  
  -- Shopify fields
  vendor TEXT, -- brand
  product_category TEXT,
  product_type TEXT,
  tags TEXT[], -- array of tags
  published BOOLEAN DEFAULT false,
  status TEXT DEFAULT 'Draft', -- 'Active', 'Draft', 'Archived'
  
  -- Variants/Options
  size TEXT,
  color TEXT,
  
  -- Pricing
  price DECIMAL(10,2),
  compare_at_price DECIMAL(10,2),
  cost_per_item DECIMAL(10,2),
  
  -- Inventory
  sku TEXT,
  barcode TEXT,
  inventory_quantity INTEGER DEFAULT 0,
  
  -- Shipping
  weight_value TEXT,
  weight_unit TEXT DEFAULT 'g',
  requires_shipping BOOLEAN DEFAULT true,
  
  -- Product details
  condition TEXT, -- 'New', 'Used', 'NWT', 'Excellent', 'Good', 'Fair'
  flaws TEXT,
  material TEXT,
  era TEXT, -- 'vintage', 'modern', '90s', etc.
  care_instructions TEXT,
  
  -- Measurements (stored as JSONB for flexibility)
  measurements JSONB,
  
  -- SEO
  seo_title TEXT,
  seo_description TEXT,
  
  -- Original voice description
  voice_description TEXT,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  exported_at TIMESTAMPTZ
);

-- Product images table (multiple images per product)
CREATE TABLE public.product_images (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id UUID REFERENCES public.products(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  
  -- Image data
  image_url TEXT NOT NULL, -- Supabase Storage URL
  storage_path TEXT NOT NULL, -- Path in storage bucket
  position INTEGER DEFAULT 0, -- Order of images (0 = main image)
  alt_text TEXT,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_products_user_id ON public.products(user_id);
CREATE INDEX idx_products_created_at ON public.products(created_at DESC);
CREATE INDEX idx_product_images_product_id ON public.product_images(product_id);
CREATE INDEX idx_product_images_user_id ON public.product_images(user_id);

-- Row Level Security (RLS) Policies
-- Users can only see/edit their own data

-- Enable RLS
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_images ENABLE ROW LEVEL SECURITY;

-- User Profiles policies
CREATE POLICY "Users can view own profile"
  ON public.user_profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON public.user_profiles FOR UPDATE
  USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile"
  ON public.user_profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

-- Products policies
CREATE POLICY "Users can view own products"
  ON public.products FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own products"
  ON public.products FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own products"
  ON public.products FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own products"
  ON public.products FOR DELETE
  USING (auth.uid() = user_id);

-- Product images policies
CREATE POLICY "Users can view own product images"
  ON public.product_images FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own product images"
  ON public.product_images FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own product images"
  ON public.product_images FOR DELETE
  USING (auth.uid() = user_id);

-- Function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for products updated_at
CREATE TRIGGER set_products_updated_at
  BEFORE UPDATE ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- Function to create user profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.user_profiles (id, email)
  VALUES (NEW.id, NEW.email);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to create profile when user signs up
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- Storage bucket for product images
-- Run this in Supabase Dashboard > Storage > Create Bucket
-- Bucket name: product-images
-- Public: true
-- File size limit: 10MB
-- Allowed MIME types: image/*

-- Storage policies (add in Supabase Dashboard > Storage > product-images > Policies)
-- 1. Allow authenticated users to upload
-- 2. Allow public read access
-- 3. Users can only delete their own images
