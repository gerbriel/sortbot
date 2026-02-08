-- Migration: Export Library System
-- Description: Tracks CSV exports with batch metadata and export history
-- Date: 2026-02-07

-- ============================================================================
-- EXPORT BATCHES TABLE
-- ============================================================================
-- Stores metadata about each CSV export batch

CREATE TABLE IF NOT EXISTS public.export_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Batch Information
  batch_name TEXT NOT NULL,
  batch_number INTEGER NOT NULL, -- Auto-incrementing per user
  description TEXT,
  
  -- Export Metadata
  product_count INTEGER NOT NULL DEFAULT 0,
  total_value NUMERIC(10, 2),
  
  -- CSV File Information
  csv_file_name TEXT NOT NULL,
  csv_storage_path TEXT, -- Path in Supabase Storage
  file_size_bytes BIGINT,
  
  -- Status Tracking
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending',      -- Created but not yet exported
    'exported',     -- CSV generated and downloaded
    'uploaded',     -- Uploaded to Shopify
    'processing',   -- Being processed by Shopify
    'completed',    -- Successfully imported to Shopify
    'failed',       -- Import failed
    'archived'      -- Old export, archived
  )),
  
  -- Shopify Integration
  shopify_import_id TEXT, -- Shopify bulk import ID
  shopify_status TEXT,
  shopify_error_message TEXT,
  shopify_imported_count INTEGER,
  shopify_failed_count INTEGER,
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  exported_at TIMESTAMPTZ, -- When CSV was generated
  uploaded_at TIMESTAMPTZ, -- When uploaded to Shopify
  completed_at TIMESTAMPTZ, -- When Shopify confirmed completion
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Search and Filtering
  tags TEXT[], -- User-defined tags like "vintage", "winter-2026", "clearance"
  notes TEXT,
  
  -- Constraints
  UNIQUE(user_id, batch_number)
);

-- ============================================================================
-- EXPORT BATCH ITEMS TABLE
-- ============================================================================
-- Stores the actual CSV row data for each product in the export

CREATE TABLE IF NOT EXISTS public.export_batch_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  export_batch_id UUID NOT NULL REFERENCES public.export_batches(id) ON DELETE CASCADE,
  product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  
  -- Position in CSV
  row_number INTEGER NOT NULL,
  
  -- Complete CSV Row Data (62 Shopify columns)
  -- Stored as JSONB for flexibility and queryability
  csv_data JSONB NOT NULL,
  
  -- Quick Access Fields (extracted from csv_data for fast queries)
  title TEXT,
  handle TEXT,
  vendor TEXT,
  product_type TEXT,
  price NUMERIC(10, 2),
  sku TEXT,
  
  -- Status
  status TEXT DEFAULT 'pending' CHECK (status IN (
    'pending',
    'exported',
    'imported',
    'failed',
    'skipped'
  )),
  
  -- Shopify Results
  shopify_product_id TEXT,
  shopify_error TEXT,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Constraints
  UNIQUE(export_batch_id, row_number)
);

-- ============================================================================
-- INDEXES FOR PERFORMANCE
-- ============================================================================

-- Export Batches indexes
CREATE INDEX idx_export_batches_user_id ON public.export_batches(user_id);
CREATE INDEX idx_export_batches_status ON public.export_batches(status);
CREATE INDEX idx_export_batches_created_at ON public.export_batches(created_at DESC);
CREATE INDEX idx_export_batches_batch_number ON public.export_batches(user_id, batch_number DESC);
CREATE INDEX idx_export_batches_tags ON public.export_batches USING GIN(tags);

-- Export Batch Items indexes
CREATE INDEX idx_export_batch_items_batch_id ON public.export_batch_items(export_batch_id);
CREATE INDEX idx_export_batch_items_product_id ON public.export_batch_items(product_id);
CREATE INDEX idx_export_batch_items_row_number ON public.export_batch_items(export_batch_id, row_number);
CREATE INDEX idx_export_batch_items_csv_data ON public.export_batch_items USING GIN(csv_data);
CREATE INDEX idx_export_batch_items_sku ON public.export_batch_items(sku);

-- ============================================================================
-- FUNCTIONS
-- ============================================================================

-- Function: Auto-increment batch_number per user
CREATE OR REPLACE FUNCTION public.get_next_batch_number(p_user_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  next_number INTEGER;
BEGIN
  SELECT COALESCE(MAX(batch_number), 0) + 1 
  INTO next_number
  FROM public.export_batches
  WHERE user_id = p_user_id;
  
  RETURN next_number;
END;
$$;

-- Function: Update export batch statistics
CREATE OR REPLACE FUNCTION public.update_export_batch_stats(p_batch_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.export_batches
  SET 
    product_count = (
      SELECT COUNT(*) 
      FROM public.export_batch_items 
      WHERE export_batch_id = p_batch_id
    ),
    total_value = (
      SELECT COALESCE(SUM(price), 0)
      FROM public.export_batch_items
      WHERE export_batch_id = p_batch_id
    ),
    updated_at = NOW()
  WHERE id = p_batch_id;
END;
$$;

-- Function: Update timestamps trigger
CREATE OR REPLACE FUNCTION public.update_export_batches_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- ============================================================================
-- TRIGGERS
-- ============================================================================

-- Auto-update updated_at timestamp
DROP TRIGGER IF EXISTS trg_export_batches_updated_at ON public.export_batches;
CREATE TRIGGER trg_export_batches_updated_at
  BEFORE UPDATE ON public.export_batches
  FOR EACH ROW
  EXECUTE FUNCTION public.update_export_batches_updated_at();

-- ============================================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================================

-- Enable RLS
ALTER TABLE public.export_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.export_batch_items ENABLE ROW LEVEL SECURITY;

-- Export Batches Policies
CREATE POLICY "Users can view their own export batches"
  ON public.export_batches
  FOR SELECT
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY "Users can insert their own export batches"
  ON public.export_batches
  FOR INSERT
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "Users can update their own export batches"
  ON public.export_batches
  FOR UPDATE
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY "Users can delete their own export batches"
  ON public.export_batches
  FOR DELETE
  USING (user_id = (SELECT auth.uid()));

-- Export Batch Items Policies
CREATE POLICY "Users can view items from their own export batches"
  ON public.export_batch_items
  FOR SELECT
  USING (
    export_batch_id IN (
      SELECT id FROM public.export_batches WHERE user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "Users can insert items to their own export batches"
  ON public.export_batch_items
  FOR INSERT
  WITH CHECK (
    export_batch_id IN (
      SELECT id FROM public.export_batches WHERE user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "Users can update items from their own export batches"
  ON public.export_batch_items
  FOR UPDATE
  USING (
    export_batch_id IN (
      SELECT id FROM public.export_batches WHERE user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "Users can delete items from their own export batches"
  ON public.export_batch_items
  FOR DELETE
  USING (
    export_batch_id IN (
      SELECT id FROM public.export_batches WHERE user_id = (SELECT auth.uid())
    )
  );

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE public.export_batches IS 'Tracks CSV export batches with metadata and Shopify integration status';
COMMENT ON TABLE public.export_batch_items IS 'Stores individual CSV rows (products) for each export batch';

COMMENT ON COLUMN public.export_batches.batch_number IS 'Sequential number per user (1, 2, 3...)';
COMMENT ON COLUMN public.export_batches.csv_storage_path IS 'Path to CSV file in Supabase Storage';
COMMENT ON COLUMN public.export_batches.status IS 'Export lifecycle: pending → exported → uploaded → processing → completed';
COMMENT ON COLUMN public.export_batch_items.csv_data IS 'Complete 62-column CSV row data as JSONB';
COMMENT ON COLUMN public.export_batch_items.row_number IS 'Position in CSV file (1-based)';

-- ============================================================================
-- EXAMPLE QUERIES
-- ============================================================================

-- Get all export batches for a user
/*
SELECT 
  id,
  batch_name,
  batch_number,
  product_count,
  total_value,
  status,
  created_at,
  exported_at
FROM public.export_batches
WHERE user_id = 'your-user-id'
ORDER BY batch_number DESC;
*/

-- Get batch items with product details
/*
SELECT 
  ebi.row_number,
  ebi.title,
  ebi.price,
  ebi.sku,
  ebi.status,
  ebi.csv_data
FROM public.export_batch_items ebi
WHERE ebi.export_batch_id = 'batch-id'
ORDER BY ebi.row_number;
*/

-- Search within CSV data
/*
SELECT 
  eb.batch_name,
  ebi.title,
  ebi.csv_data->>'vendor' as vendor,
  ebi.csv_data->>'product_type' as type
FROM public.export_batch_items ebi
JOIN public.export_batches eb ON eb.id = ebi.export_batch_id
WHERE 
  eb.user_id = 'your-user-id'
  AND ebi.csv_data->>'vendor' ILIKE '%Nike%';
*/

-- Get export statistics
/*
SELECT 
  COUNT(*) as total_exports,
  SUM(product_count) as total_products_exported,
  SUM(total_value) as total_value_exported,
  COUNT(*) FILTER (WHERE status = 'completed') as completed_exports
FROM public.export_batches
WHERE user_id = 'your-user-id';
*/

-- ============================================================================
-- SUMMARY
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '=================================================================';
  RAISE NOTICE 'Export Library System - CREATED ✓';
  RAISE NOTICE '=================================================================';
  RAISE NOTICE '';
  RAISE NOTICE '📊 Tables Created:';
  RAISE NOTICE '  • export_batches - Export metadata and tracking';
  RAISE NOTICE '  • export_batch_items - Individual CSV rows per export';
  RAISE NOTICE '';
  RAISE NOTICE '🔒 Security:';
  RAISE NOTICE '  • RLS enabled on both tables';
  RAISE NOTICE '  • Users can only access their own exports';
  RAISE NOTICE '';
  RAISE NOTICE '⚡ Performance:';
  RAISE NOTICE '  • 10 indexes for fast queries';
  RAISE NOTICE '  • JSONB for flexible CSV data storage';
  RAISE NOTICE '  • GIN indexes for tag and JSON searches';
  RAISE NOTICE '';
  RAISE NOTICE '🎯 Features:';
  RAISE NOTICE '  • Auto-incrementing batch numbers';
  RAISE NOTICE '  • Full CSV data storage (62 columns)';
  RAISE NOTICE '  • Shopify integration tracking';
  RAISE NOTICE '  • Export lifecycle status';
  RAISE NOTICE '  • Tag-based organization';
  RAISE NOTICE '  • Complete audit trail';
  RAISE NOTICE '';
  RAISE NOTICE '=================================================================';
  RAISE NOTICE '';
END $$;
