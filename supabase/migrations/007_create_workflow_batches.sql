-- ============================================================================
-- WORKFLOW BATCHES TABLE
-- ============================================================================
-- Stores workflow sessions so users can resume from where they left off
-- Date: February 8, 2026

BEGIN;

-- Create workflow_batches table
CREATE TABLE IF NOT EXISTS public.workflow_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Batch Metadata
  batch_name TEXT, -- Optional user-defined name
  batch_number TEXT NOT NULL, -- Like "Batch #14149c48-c5c0-4147..."
  
  -- Workflow Progress
  current_step INTEGER NOT NULL DEFAULT 1 CHECK (current_step BETWEEN 1 AND 5),
  -- Step 1: Upload Images
  -- Step 2: Group Images  
  -- Step 3: Categorize Groups
  -- Step 4: Add Descriptions
  -- Step 5: Save & Export
  
  is_completed BOOLEAN NOT NULL DEFAULT FALSE,
  
  -- Statistics
  total_images INTEGER NOT NULL DEFAULT 0,
  product_groups_count INTEGER NOT NULL DEFAULT 0,
  categorized_count INTEGER NOT NULL DEFAULT 0,
  processed_count INTEGER NOT NULL DEFAULT 0,
  saved_products_count INTEGER NOT NULL DEFAULT 0,
  
  -- Workflow State (JSONB for flexibility)
  -- Stores complete ClothingItem[] array state
  workflow_state JSONB,
  /*
  Example workflow_state structure:
  {
    "uploadedImages": [...ClothingItem[]],
    "groupedImages": [...ClothingItem[]],
    "sortedImages": [...ClothingItem[]],
    "processedItems": [...ClothingItem[]]
  }
  */
  
  -- Thumbnail (first image for preview)
  thumbnail_url TEXT,
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_opened_at TIMESTAMPTZ,
  
  -- Search and filtering
  tags TEXT[],
  notes TEXT
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_workflow_batches_user_id ON public.workflow_batches(user_id);
CREATE INDEX IF NOT EXISTS idx_workflow_batches_created_at ON public.workflow_batches(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_batches_updated_at ON public.workflow_batches(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_batches_current_step ON public.workflow_batches(current_step);

-- ============================================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================================

-- Enable RLS
ALTER TABLE public.workflow_batches ENABLE ROW LEVEL SECURITY;

-- Users can only see their own workflow batches
CREATE POLICY "Users can view their own workflow batches"
  ON public.workflow_batches FOR SELECT
  USING (auth.uid() = user_id);

-- Users can insert their own workflow batches
CREATE POLICY "Users can insert their own workflow batches"
  ON public.workflow_batches FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can update their own workflow batches
CREATE POLICY "Users can update their own workflow batches"
  ON public.workflow_batches FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Users can delete their own workflow batches
CREATE POLICY "Users can delete their own workflow batches"
  ON public.workflow_batches FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================================================
-- TRIGGER: Auto-update updated_at timestamp
-- ============================================================================

CREATE OR REPLACE FUNCTION update_workflow_batches_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER workflow_batches_updated_at
  BEFORE UPDATE ON public.workflow_batches
  FOR EACH ROW
  EXECUTE FUNCTION update_workflow_batches_updated_at();

-- ============================================================================
-- LINK products TO workflow_batches
-- ============================================================================

-- Add workflow_batch_id to products table
ALTER TABLE public.products 
ADD COLUMN IF NOT EXISTS workflow_batch_id UUID REFERENCES public.workflow_batches(id) ON DELETE SET NULL;

-- Index for faster queries
CREATE INDEX IF NOT EXISTS idx_products_workflow_batch_id ON public.products(workflow_batch_id);

COMMIT;

-- ============================================================================
-- VERIFICATION QUERIES
-- ============================================================================

-- Check if table was created
SELECT 
  '=== WORKFLOW_BATCHES TABLE ===' as status,
  table_name,
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_name = 'workflow_batches'
ORDER BY ordinal_position;

-- Check RLS policies
SELECT 
  '=== RLS POLICIES ===' as status,
  policyname,
  cmd,
  qual
FROM pg_policies
WHERE tablename = 'workflow_batches';

-- Check indexes
SELECT 
  '=== INDEXES ===' as status,
  indexname,
  indexdef
FROM pg_indexes
WHERE tablename = 'workflow_batches';
