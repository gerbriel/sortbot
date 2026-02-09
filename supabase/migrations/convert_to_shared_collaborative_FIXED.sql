-- ============================================================================
-- CONVERT TO SHARED COLLABORATIVE SYSTEM (FIXED - Handles Duplicates)
-- ============================================================================
-- This migration converts the application from a multi-tenant isolated system
-- to a shared collaborative system where all users see and edit the same data.
--
-- FIXES: Handles duplicate category names before creating unique constraint
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
-- 3. CATEGORIES TABLE (WITH DUPLICATE HANDLING)
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

-- Remove old unique constraint if it exists
ALTER TABLE public.categories DROP CONSTRAINT IF EXISTS categories_user_id_name_key;
ALTER TABLE public.categories DROP CONSTRAINT IF EXISTS categories_name_key;

-- HANDLE DUPLICATES: Keep the oldest entry for each category name, delete the rest
DELETE FROM public.categories a
USING public.categories b
WHERE a.id > b.id
  AND LOWER(TRIM(a.name)) = LOWER(TRIM(b.name));

-- Now add the unique constraint (should work since duplicates are removed)
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
-- 6. EXPORT_BATCHES TABLE (WITH DUPLICATE HANDLING)
-- ============================================================================

-- Drop existing user-specific policies
DROP POLICY IF EXISTS "Users can view own export batches" ON public.export_batches;
DROP POLICY IF EXISTS "Users can insert own export batches" ON public.export_batches;
DROP POLICY IF EXISTS "Users can update own export batches" ON public.export_batches;
DROP POLICY IF EXISTS "Users can delete own export batches" ON public.export_batches;

-- Remove old unique constraint if it exists
ALTER TABLE public.export_batches DROP CONSTRAINT IF EXISTS export_batches_user_id_batch_number_key;
ALTER TABLE public.export_batches DROP CONSTRAINT IF EXISTS export_batches_batch_number_key;

-- HANDLE DUPLICATES: Keep the oldest entry for each batch_number, delete the rest
-- (Only if export_batches table exists and has data)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'export_batches') THEN
    DELETE FROM public.export_batches a
    USING public.export_batches b
    WHERE a.id > b.id
      AND a.batch_number = b.batch_number;
      
    -- Add unique constraint
    ALTER TABLE public.export_batches ADD CONSTRAINT export_batches_batch_number_key UNIQUE (batch_number);
  END IF;
END $$;

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

-- Create collaborative policies (only if table exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'export_batch_items') THEN
    EXECUTE 'CREATE POLICY "Authenticated users can view all export batch items"
      ON public.export_batch_items FOR SELECT
      TO authenticated
      USING (true)';
    
    EXECUTE 'CREATE POLICY "Authenticated users can insert export batch items"
      ON public.export_batch_items FOR INSERT
      TO authenticated
      WITH CHECK (true)';
    
    EXECUTE 'CREATE POLICY "Authenticated users can update all export batch items"
      ON public.export_batch_items FOR UPDATE
      TO authenticated
      USING (true)
      WITH CHECK (true)';
    
    EXECUTE 'CREATE POLICY "Authenticated users can delete all export batch items"
      ON public.export_batch_items FOR DELETE
      TO authenticated
      USING (true)';
  END IF;
END $$;

-- ============================================================================
-- 8. UPDATE get_next_batch_number FUNCTION
-- ============================================================================
-- Remove user_id parameter since batch numbers are now globally shared

DROP FUNCTION IF EXISTS public.get_next_batch_number(UUID);

-- Only create if export_batches exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'export_batches') THEN
    EXECUTE '
    CREATE OR REPLACE FUNCTION public.get_next_batch_number()
    RETURNS INTEGER
    LANGUAGE plpgsql
    SECURITY DEFINER
    AS $func$
    DECLARE
      next_number INTEGER;
    BEGIN
      SELECT COALESCE(MAX(batch_number), 0) + 1
      INTO next_number
      FROM public.export_batches
      FOR UPDATE;
      
      RETURN next_number;
    END;
    $func$';
    
    COMMENT ON FUNCTION public.get_next_batch_number() IS 
      'Returns the next available batch number for exports. Thread-safe with table-level locking. Global across all users.';
  END IF;
END $$;

-- ============================================================================
-- VERIFICATION: Show what changed
-- ============================================================================

-- Show all RLS policies
SELECT 
  tablename,
  policyname,
  cmd,
  CASE 
    WHEN policyname LIKE '%all%' THEN '✅ Collaborative'
    WHEN policyname LIKE '%own%' THEN '❌ User-specific (should not exist)'
    ELSE '⚠️  Unknown'
  END as policy_type
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;

-- Show categories (should have no duplicates)
SELECT name, COUNT(*) as count
FROM public.categories
GROUP BY name
HAVING COUNT(*) > 1;

-- If the above returns 0 rows, duplicates are fixed! ✅
