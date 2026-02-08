-- Category Presets Table
-- This table stores preset configurations for product categories
-- including shipping weights, product types, care instructions, etc.

CREATE TABLE IF NOT EXISTS category_presets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  
  -- Basic Info
  category_name TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  description TEXT,
  
  -- Shipping & Physical Attributes
  default_weight_value TEXT, -- e.g., "1.2"
  default_weight_unit TEXT DEFAULT 'lb', -- lb, oz, kg, g
  requires_shipping BOOLEAN DEFAULT true,
  
  -- Product Classification
  product_type TEXT, -- e.g., "Apparel", "Accessories"
  vendor TEXT, -- Default vendor/brand if applicable
  
  -- Pricing
  suggested_price_min DECIMAL(10, 2),
  suggested_price_max DECIMAL(10, 2),
  
  -- Product Attributes
  default_material TEXT, -- e.g., "Cotton", "Polyester"
  default_care_instructions TEXT,
  
  -- Measurements Template (JSON)
  -- Stores which measurements are relevant for this category
  measurement_template JSONB DEFAULT '{
    "pitToPit": false,
    "length": false,
    "sleeve": false,
    "shoulder": false,
    "waist": false,
    "inseam": false,
    "rise": false
  }'::jsonb,
  
  -- SEO Defaults
  seo_title_template TEXT, -- e.g., "{size} {brand} {category} {color}"
  seo_keywords TEXT[], -- Array of default keywords
  
  -- Shopify Specific
  shopify_product_type TEXT,
  shopify_collection_id TEXT,
  
  -- Tags Template
  default_tags TEXT[], -- Array of tags to auto-apply
  
  -- Condition Defaults
  typical_condition TEXT, -- Most common condition for this category
  
  -- Active Status
  is_active BOOLEAN DEFAULT true,
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_category_presets_user_id ON category_presets(user_id);
CREATE INDEX IF NOT EXISTS idx_category_presets_category_name ON category_presets(category_name);
CREATE INDEX IF NOT EXISTS idx_category_presets_active ON category_presets(is_active);

-- Enable Row Level Security
ALTER TABLE category_presets ENABLE ROW LEVEL SECURITY;

-- RLS Policies
-- Users can only see and manage their own presets
CREATE POLICY "Users can view their own category presets"
  ON category_presets FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own category presets"
  ON category_presets FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own category presets"
  ON category_presets FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own category presets"
  ON category_presets FOR DELETE
  USING (auth.uid() = user_id);

-- Function to update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_category_presets_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to automatically update updated_at
CREATE TRIGGER update_category_presets_timestamp
  BEFORE UPDATE ON category_presets
  FOR EACH ROW
  EXECUTE FUNCTION update_category_presets_updated_at();

-- Insert default presets (optional - customize as needed)
INSERT INTO category_presets (user_id, category_name, display_name, description, default_weight_value, default_weight_unit, product_type, measurement_template, default_tags)
VALUES 
  -- These are examples - you can delete/modify them
  ('00000000-0000-0000-0000-000000000000', 'Sweatshirts', 'Sweatshirts & Hoodies', 'Pullover sweatshirts, hoodies, and crewnecks', '1.2', 'lb', 'Apparel', 
   '{"pitToPit": true, "length": true, "sleeve": true, "shoulder": true, "waist": false, "inseam": false, "rise": false}'::jsonb,
   ARRAY['sweatshirt', 'hoodie', 'pullover']),
   
  ('00000000-0000-0000-0000-000000000000', 'Outerwear', 'Jackets & Coats', 'Jackets, coats, and outerwear', '1.5', 'lb', 'Apparel',
   '{"pitToPit": true, "length": true, "sleeve": true, "shoulder": true, "waist": false, "inseam": false, "rise": false}'::jsonb,
   ARRAY['jacket', 'outerwear', 'coat']),
   
  ('00000000-0000-0000-0000-000000000000', 'Tees', 'T-Shirts', 'Short and long sleeve tees', '0.5', 'lb', 'Apparel',
   '{"pitToPit": true, "length": true, "sleeve": false, "shoulder": true, "waist": false, "inseam": false, "rise": false}'::jsonb,
   ARRAY['tee', 'tshirt', 'shirt']),
   
  ('00000000-0000-0000-0000-000000000000', 'Bottoms', 'Pants & Shorts', 'Jeans, pants, shorts, and bottoms', '1.0', 'lb', 'Apparel',
   '{"pitToPit": false, "length": false, "sleeve": false, "shoulder": false, "waist": true, "inseam": true, "rise": true}'::jsonb,
   ARRAY['pants', 'jeans', 'bottoms']),
   
  ('00000000-0000-0000-0000-000000000000', 'Hats', 'Hats & Headwear', 'Baseball caps, beanies, and headwear', '0.3', 'lb', 'Accessories',
   '{"pitToPit": false, "length": false, "sleeve": false, "shoulder": false, "waist": false, "inseam": false, "rise": false}'::jsonb,
   ARRAY['hat', 'cap', 'headwear']),
   
  ('00000000-0000-0000-0000-000000000000', 'Accessories', 'Accessories', 'Bags, belts, and other accessories', '0.5', 'lb', 'Accessories',
   '{"pitToPit": false, "length": false, "sleeve": false, "shoulder": false, "waist": false, "inseam": false, "rise": false}'::jsonb,
   ARRAY['accessories'])
ON CONFLICT (category_name) DO NOTHING;

-- Add comment for documentation
COMMENT ON TABLE category_presets IS 'Stores preset configurations for product categories including shipping, measurements, and default attributes';
