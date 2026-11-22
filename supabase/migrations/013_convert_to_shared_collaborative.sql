-- ============================================================================
-- CONVERT TO SHARED COLLABORATIVE SYSTEM
-- ============================================================================
-- This migration converts the application from a multi-tenant isolated system
-- to a shared collaborative system where all users see and edit the same data.
--
-- Changes:
-- 1. Drop all user-specific RLS policies
-- 2. Create new collaborative RLS policies (all authenticated users can access all data)
-- 3. Keep user_id columns for audit trail (who created what)
-- 4. Remove unique constraints that include user_id
--
-- IMPORTANT: After running this migration, update application code to remove
-- .eq('user_id', userId) filters from all queries
-- ============================================================================

-- ============================================================================
-- 1. PRODUCTS TABLE
-- ============================================================================

-- Drop existing user-specific policies
DROP POLICY IF EXISTS "Users can view own products" ON public.products;
DROP POLICY IF EXISTS "Users can insert own products" ON public.products;
DROP POLICY IF EXISTS "Users can update own products" ON public.products;
DROP POLICY IF EXISTS "Users can delete own products" ON public.products;

-- Create collaborative policies (all authenticated users can access all products)
CREATE POLICY "Authenticated users can view all products"
  ON public.products FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert products"
  ON public.products FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update all products"
  ON public.products FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete all products"
  ON public.products FOR DELETE
  TO authenticated
  USING (true);

-- ============================================================================
-- 2. PRODUCT_IMAGES TABLE
-- ============================================================================

-- Drop existing user-specific policies
DROP POLICY IF EXISTS "Users can view own product images" ON public.product_images;
DROP POLICY IF EXISTS "Users can insert own product images" ON public.product_images;
DROP POLICY IF EXISTS "Users can delete own product images" ON public.product_images;

-- Create collaborative policies
CREATE POLICY "Authenticated users can view all product images"
  ON public.product_images FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert product images"
  ON public.product_images FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update all product images"
  ON public.product_images FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete all product images"
  ON public.product_images FOR DELETE
  TO authenticated
  USING (true);

-- ============================================================================
-- 3. CATEGORIES TABLE
-- ============================================================================

-- Drop existing user-specific policies
DROP POLICY IF EXISTS "Users can view own categories" ON public.categories;
DROP POLICY IF EXISTS "Users can view system categories" ON public.categories;
DROP POLICY IF EXISTS "Users can insert own categories" ON public.categories;
DROP POLICY IF EXISTS "Users can update own categories" ON public.categories;
DROP POLICY IF EXISTS "Users can delete own categories" ON public.categories;
DROP POLICY IF EXISTS "select_categories" ON public.categories;
DROP POLICY IF EXISTS "insert_categories" ON public.categories;
DROP POLICY IF EXISTS "update_categories" ON public.categories;
DROP POLICY IF EXISTS "delete_categories" ON public.categories;

-- Remove unique constraint that includes user_id
ALTER TABLE public.categories DROP CONSTRAINT IF EXISTS categories_user_id_name_key;

-- Add new unique constraint on name only (shared across all users)
ALTER TABLE public.categories ADD CONSTRAINT categories_name_key UNIQUE (name);

-- Create collaborative policies
CREATE POLICY "Authenticated users can view all categories"
  ON public.categories FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert categories"
  ON public.categories FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update all categories"
  ON public.categories FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete all categories"
  ON public.categories FOR DELETE
  TO authenticated
  USING (true);

-- ============================================================================
-- 4. CATEGORY_PRESETS TABLE
-- ============================================================================

-- Drop existing user-specific policies
DROP POLICY IF EXISTS "Users can view own presets" ON public.category_presets;
DROP POLICY IF EXISTS "Users can view system presets" ON public.category_presets;
DROP POLICY IF EXISTS "Users can insert own presets" ON public.category_presets;
DROP POLICY IF EXISTS "Users can update own presets" ON public.category_presets;
DROP POLICY IF EXISTS "Users can delete own presets" ON public.category_presets;
DROP POLICY IF EXISTS "select_presets" ON public.category_presets;
DROP POLICY IF EXISTS "insert_presets" ON public.category_presets;
DROP POLICY IF EXISTS "update_presets" ON public.category_presets;
DROP POLICY IF EXISTS "delete_presets" ON public.category_presets;

-- Create collaborative policies
CREATE POLICY "Authenticated users can view all presets"
  ON public.category_presets FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert presets"
  ON public.category_presets FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update all presets"
  ON public.category_presets FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete all presets"
  ON public.category_presets FOR DELETE
  TO authenticated
  USING (true);

-- ============================================================================
-- 5. WORKFLOW_BATCHES TABLE
-- ============================================================================

-- Drop existing user-specific policies
DROP POLICY IF EXISTS "Users can view own workflow batches" ON public.workflow_batches;
DROP POLICY IF EXISTS "Users can insert own workflow batches" ON public.workflow_batches;
DROP POLICY IF EXISTS "Users can update own workflow batches" ON public.workflow_batches;
DROP POLICY IF EXISTS "Users can delete own workflow batches" ON public.workflow_batches;

-- Create collaborative policies
CREATE POLICY "Authenticated users can view all workflow batches"
  ON public.workflow_batches FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert workflow batches"
  ON public.workflow_batches FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update all workflow batches"
  ON public.workflow_batches FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete all workflow batches"
  ON public.workflow_batches FOR DELETE
  TO authenticated
  USING (true);

-- ============================================================================
-- 6. EXPORT_BATCHES TABLE
-- ============================================================================

-- Drop existing user-specific policies
DROP POLICY IF EXISTS "Users can view own export batches" ON public.export_batches;
DROP POLICY IF EXISTS "Users can insert own export batches" ON public.export_batches;
DROP POLICY IF EXISTS "Users can update own export batches" ON public.export_batches;
DROP POLICY IF EXISTS "Users can delete own export batches" ON public.export_batches;

-- Remove unique constraint that includes user_id
ALTER TABLE public.export_batches DROP CONSTRAINT IF EXISTS export_batches_user_id_batch_number_key;

-- Add new unique constraint on batch_number only (shared across all users)
ALTER TABLE public.export_batches ADD CONSTRAINT export_batches_batch_number_key UNIQUE (batch_number);

-- Create collaborative policies
CREATE POLICY "Authenticated users can view all export batches"
  ON public.export_batches FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert export batches"
  ON public.export_batches FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update all export batches"
  ON public.export_batches FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete all export batches"
  ON public.export_batches FOR DELETE
  TO authenticated
  USING (true);

-- ============================================================================
-- 7. EXPORT_BATCH_ITEMS TABLE
-- ============================================================================

-- Drop existing user-specific policies
DROP POLICY IF EXISTS "Users can view own export batch items" ON public.export_batch_items;
DROP POLICY IF EXISTS "Users can insert own export batch items" ON public.export_batch_items;
DROP POLICY IF EXISTS "Users can update own export batch items" ON public.export_batch_items;
DROP POLICY IF EXISTS "Users can delete own export batch items" ON public.export_batch_items;

-- Create collaborative policies
CREATE POLICY "Authenticated users can view all export batch items"
  ON public.export_batch_items FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert export batch items"
  ON public.export_batch_items FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update all export batch items"
  ON public.export_batch_items FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete all export batch items"
  ON public.export_batch_items FOR DELETE
  TO authenticated
  USING (true);

-- ============================================================================
-- 8. USER_PROFILES TABLE (Keep as-is for user-specific data)
-- ============================================================================
-- User profiles remain user-specific (email, preferences, etc.)
-- No changes needed here

-- ============================================================================
-- 9. UPDATE get_next_batch_number FUNCTION
-- ============================================================================
-- Remove user_id parameter since batch numbers are now globally shared

DROP FUNCTION IF EXISTS public.get_next_batch_number(UUID);

CREATE OR REPLACE FUNCTION public.get_next_batch_number()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  next_number INTEGER;
BEGIN
  -- Get the max batch_number and add 1
  -- Lock the table to prevent race conditions
  SELECT COALESCE(MAX(batch_number), 0) + 1
  INTO next_number
  FROM public.export_batches
  FOR UPDATE;
  
  RETURN next_number;
END;
$$;

-- Add comment explaining the function
COMMENT ON FUNCTION public.get_next_batch_number() IS 
  'Returns the next available batch number for exports. Thread-safe with table-level locking. Global across all users.';

-- ============================================================================
-- VERIFICATION QUERIES
-- ============================================================================
-- Run these after migration to verify the changes

-- Check RLS policies (should show collaborative policies for all tables)
SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;

-- Check unique constraints (user_id should NOT be in unique constraints)
SELECT
  tc.table_name,
  tc.constraint_name,
  tc.constraint_type,
  string_agg(kcu.column_name, ', ' ORDER BY kcu.ordinal_position) as columns
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name = kcu.constraint_name
  AND tc.table_schema = kcu.table_schema
WHERE tc.table_schema = 'public'
  AND tc.constraint_type = 'UNIQUE'
GROUP BY tc.table_name, tc.constraint_name, tc.constraint_type
ORDER BY tc.table_name;

-- ============================================================================
-- NEXT STEPS - APPLICATION CODE CHANGES REQUIRED
-- ============================================================================
-- After running this migration, update the following files to remove user_id filtering:
--
-- 1. src/lib/productService.ts
--    - Remove: .eq('user_id', userId) from all queries
--    - Keep: user_id in INSERT statements (for audit trail)
--
-- 2. src/lib/libraryService.ts
--    - Remove: .eq('user_id', userId) from all queries
--
-- 3. src/lib/categoriesService.ts
--    - Remove: .eq('user_id', userId) from all queries
--    - Remove: user_id from unique checks
--
-- 4. src/lib/categoryPresetsService.ts
--    - Remove: .eq('user_id', userId) from all queries
--
-- 5. src/lib/exportLibraryService.ts
--    - Remove: .eq('user_id', userId) from all queries
--    - Update: get_next_batch_number RPC call (no longer needs user_id parameter)
--
-- 6. All other service files that query these tables
--
-- ============================================================================
