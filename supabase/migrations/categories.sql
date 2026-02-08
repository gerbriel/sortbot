-- Categories Table
-- This table stores the user's custom category list
-- These categories are used in the drag-and-drop sorting and category presets

CREATE TABLE IF NOT EXISTS categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  
  -- Category Info
  name TEXT NOT NULL, -- Internal name (lowercase, no spaces)
  display_name TEXT NOT NULL, -- Display name shown to user
  emoji TEXT DEFAULT '📦', -- Emoji icon for the category
  color TEXT DEFAULT '#667eea', -- Hex color for category button
  
  -- Ordering
  sort_order INTEGER DEFAULT 0, -- For custom ordering in the UI
  
  -- Active Status
  is_active BOOLEAN DEFAULT true,
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Ensure unique category names per user
  UNIQUE(user_id, name)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_categories_user_id ON categories(user_id);
CREATE INDEX IF NOT EXISTS idx_categories_name ON categories(name);
CREATE INDEX IF NOT EXISTS idx_categories_active ON categories(is_active);
CREATE INDEX IF NOT EXISTS idx_categories_sort_order ON categories(sort_order);

-- Enable Row Level Security
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view their own categories"
  ON categories FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own categories"
  ON categories FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own categories"
  ON categories FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own categories"
  ON categories FOR DELETE
  USING (auth.uid() = user_id);

-- Function to update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_categories_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to automatically update updated_at
CREATE TRIGGER update_categories_timestamp
  BEFORE UPDATE ON categories
  FOR EACH ROW
  EXECUTE FUNCTION update_categories_updated_at();

-- Insert default categories (these will be user-specific after first login)
-- Note: Replace '00000000-0000-0000-0000-000000000000' with actual user_id during app initialization
INSERT INTO categories (user_id, name, display_name, emoji, sort_order)
VALUES 
  ('00000000-0000-0000-0000-000000000000', 'sweatshirts', 'Sweatshirts', '🧥', 1),
  ('00000000-0000-0000-0000-000000000000', 'outerwear', 'Outerwear', '🧥', 2),
  ('00000000-0000-0000-0000-000000000000', 'tees', 'Tees', '👕', 3),
  ('00000000-0000-0000-0000-000000000000', 'bottoms', 'Bottoms', '👖', 4),
  ('00000000-0000-0000-0000-000000000000', 'femme', 'Feminine', '👗', 5),
  ('00000000-0000-0000-0000-000000000000', 'hats', 'Hats', '🧢', 6),
  ('00000000-0000-0000-0000-000000000000', 'mystery boxes', 'Mystery Boxes', '📦', 7)
ON CONFLICT (user_id, name) DO NOTHING;

-- Add comment for documentation
COMMENT ON TABLE categories IS 'Stores user-specific product categories used for sorting and organization';
