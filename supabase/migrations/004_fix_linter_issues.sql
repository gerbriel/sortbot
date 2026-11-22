-- Migration: Fix Supabase Database Linter Issues
-- Description: Addresses security and performance warnings from database linter
-- Date: 2026-02-07

-- ============================================================================
-- PART 1: Fix Function Search Path Mutable (SECURITY - WARN)
-- ============================================================================
-- These functions need explicit search_path to prevent search_path injection attacks

-- Fix: update_category_presets_updated_at
CREATE OR REPLACE FUNCTION public.update_category_presets_updated_at()
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

-- Fix: update_categories_updated_at
CREATE OR REPLACE FUNCTION public.update_categories_updated_at()
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

-- Fix: handle_updated_at (generic function)
CREATE OR REPLACE FUNCTION public.handle_updated_at()
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

-- Fix: handle_new_user
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.user_profiles (id, email, created_at, updated_at)
  VALUES (
    NEW.id,
    NEW.email,
    NOW(),
    NOW()
  );
  RETURN NEW;
END;
$$;

-- ============================================================================
-- PART 2: Fix Auth RLS Init Plan (PERFORMANCE - WARN)
-- ============================================================================
-- Replace auth.uid() with (SELECT auth.uid()) to avoid re-evaluation per row

-- Fix: user_profiles policies
DROP POLICY IF EXISTS "Users can view own profile" ON public.user_profiles;
CREATE POLICY "Users can view own profile"
  ON public.user_profiles
  FOR SELECT
  USING (id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Users can update own profile" ON public.user_profiles;
CREATE POLICY "Users can update own profile"
  ON public.user_profiles
  FOR UPDATE
  USING (id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Users can insert own profile" ON public.user_profiles;
CREATE POLICY "Users can insert own profile"
  ON public.user_profiles
  FOR INSERT
  WITH CHECK (id = (SELECT auth.uid()));

-- Fix: products policies
DROP POLICY IF EXISTS "Users can view own products" ON public.products;
CREATE POLICY "Users can view own products"
  ON public.products
  FOR SELECT
  USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Users can insert own products" ON public.products;
CREATE POLICY "Users can insert own products"
  ON public.products
  FOR INSERT
  WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Users can update own products" ON public.products;
CREATE POLICY "Users can update own products"
  ON public.products
  FOR UPDATE
  USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Users can delete own products" ON public.products;
CREATE POLICY "Users can delete own products"
  ON public.products
  FOR DELETE
  USING (user_id = (SELECT auth.uid()));

-- Fix: product_images policies
DROP POLICY IF EXISTS "Users can view own product images" ON public.product_images;
CREATE POLICY "Users can view own product images"
  ON public.product_images
  FOR SELECT
  USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Users can insert own product images" ON public.product_images;
CREATE POLICY "Users can insert own product images"
  ON public.product_images
  FOR INSERT
  WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Users can delete own product images" ON public.product_images;
CREATE POLICY "Users can delete own product images"
  ON public.product_images
  FOR DELETE
  USING (user_id = (SELECT auth.uid()));

-- Fix: category_presets policies
DROP POLICY IF EXISTS "Users can view their own category presets" ON public.category_presets;
CREATE POLICY "Users can view their own category presets"
  ON public.category_presets
  FOR SELECT
  USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Users can insert their own category presets" ON public.category_presets;
CREATE POLICY "Users can insert their own category presets"
  ON public.category_presets
  FOR INSERT
  WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Users can update their own category presets" ON public.category_presets;
CREATE POLICY "Users can update their own category presets"
  ON public.category_presets
  FOR UPDATE
  USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Users can delete their own category presets" ON public.category_presets;
CREATE POLICY "Users can delete their own category presets"
  ON public.category_presets
  FOR DELETE
  USING (user_id = (SELECT auth.uid()));

-- Fix: categories policies
DROP POLICY IF EXISTS "Users can view their own categories" ON public.categories;
CREATE POLICY "Users can view their own categories"
  ON public.categories
  FOR SELECT
  USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Users can insert their own categories" ON public.categories;
CREATE POLICY "Users can insert their own categories"
  ON public.categories
  FOR INSERT
  WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Users can update their own categories" ON public.categories;
CREATE POLICY "Users can update their own categories"
  ON public.categories
  FOR UPDATE
  USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Users can delete their own categories" ON public.categories;
CREATE POLICY "Users can delete their own categories"
  ON public.categories
  FOR DELETE
  USING (user_id = (SELECT auth.uid()));

-- ============================================================================
-- PART 3: Document Unused Indexes (PERFORMANCE - INFO)
-- ============================================================================
-- Note: These indexes are newly created and haven't been used yet.
-- DO NOT DROP THEM - they will be used as the application scales.
-- The linter shows them as "unused" because the database is new.

-- Indexes that will be used:
-- ✓ idx_product_images_user_id - Used for filtering images by user
-- ✓ idx_category_presets_style - Used for filtering presets by style
-- ✓ idx_categories_name - Used for looking up categories by name
-- ✓ idx_categories_active - Used for filtering active categories
-- ✓ idx_category_presets_size_type - Used for filtering by size type
-- ✓ idx_products_batch_id - Used for batch operations
-- ✓ idx_category_presets_category_name - Used for preset lookups
-- ✓ idx_category_presets_active - Used for filtering active presets
-- ✓ idx_category_presets_gender - Used for filtering by gender

-- Comment to explain why indexes are present
COMMENT ON INDEX public.idx_product_images_user_id IS 'Performance: Filters product images by user_id in image gallery';
COMMENT ON INDEX public.idx_category_presets_style IS 'Performance: Filters presets by style in CSV export';
COMMENT ON INDEX public.idx_categories_name IS 'Performance: Fast category name lookups in category assignment';
COMMENT ON INDEX public.idx_categories_active IS 'Performance: Filters active categories in UI dropdowns';
COMMENT ON INDEX public.idx_category_presets_size_type IS 'Performance: Filters presets by size type in analytics';
COMMENT ON INDEX public.idx_products_batch_id IS 'Performance: Groups products for batch CSV export';
COMMENT ON INDEX public.idx_category_presets_category_name IS 'Performance: Fast preset lookup by category name';
COMMENT ON INDEX public.idx_category_presets_active IS 'Performance: Filters active presets in preset manager';
COMMENT ON INDEX public.idx_category_presets_gender IS 'Performance: Filters presets by gender for targeted queries';

-- ============================================================================
-- VERIFICATION QUERIES
-- ============================================================================

-- Verify function search_path is set
SELECT 
  p.proname AS function_name,
  pg_get_function_arguments(p.oid) AS arguments,
  CASE 
    WHEN p.proconfig IS NULL THEN 'NO search_path set ⚠️'
    WHEN array_to_string(p.proconfig, ', ') LIKE '%search_path%' THEN 'search_path IS SET ✓'
    ELSE 'NO search_path set ⚠️'
  END AS search_path_status,
  array_to_string(p.proconfig, ', ') AS config
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'
  AND p.proname IN (
    'update_category_presets_updated_at',
    'update_categories_updated_at', 
    'handle_updated_at',
    'handle_new_user'
  )
ORDER BY p.proname;

-- Verify RLS policies use (SELECT auth.uid())
SELECT 
  schemaname,
  tablename,
  policyname,
  CASE 
    WHEN qual LIKE '%(SELECT auth.uid())%' OR with_check LIKE '%(SELECT auth.uid())%' THEN '✓ Optimized'
    WHEN qual LIKE '%auth.uid()%' OR with_check LIKE '%auth.uid()%' THEN '⚠️ Needs (SELECT)'
    ELSE '? Unknown'
  END AS optimization_status,
  qual AS using_clause,
  with_check AS with_check_clause
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('user_profiles', 'products', 'product_images', 'category_presets', 'categories')
ORDER BY tablename, policyname;

-- List all indexes with usage stats
SELECT
  schemaname,
  relname AS tablename,
  indexrelname AS indexname,
  idx_scan AS times_used,
  CASE 
    WHEN idx_scan = 0 THEN 'ℹ️  Not yet used (new index)'
    WHEN idx_scan < 10 THEN '⚠️ Low usage'
    ELSE '✓ Actively used'
  END AS status
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
  AND relname IN ('products', 'product_images', 'category_presets', 'categories')
ORDER BY relname, indexrelname;

-- ============================================================================
-- SUMMARY
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '=================================================================';
  RAISE NOTICE 'Database Linter Issues - FIXED ✓';
  RAISE NOTICE '=================================================================';
  RAISE NOTICE '';
  RAISE NOTICE '✓ SECURITY (4 functions fixed):';
  RAISE NOTICE '  - update_category_presets_updated_at: search_path set';
  RAISE NOTICE '  - update_categories_updated_at: search_path set';
  RAISE NOTICE '  - handle_updated_at: search_path set';
  RAISE NOTICE '  - handle_new_user: search_path set';
  RAISE NOTICE '';
  RAISE NOTICE '✓ PERFORMANCE (18 RLS policies optimized):';
  RAISE NOTICE '  - user_profiles: 3 policies use (SELECT auth.uid())';
  RAISE NOTICE '  - products: 4 policies use (SELECT auth.uid())';
  RAISE NOTICE '  - product_images: 3 policies use (SELECT auth.uid())';
  RAISE NOTICE '  - category_presets: 4 policies use (SELECT auth.uid())';
  RAISE NOTICE '  - categories: 4 policies use (SELECT auth.uid())';
  RAISE NOTICE '';
  RAISE NOTICE 'ℹ️  INFO (9 unused indexes):';
  RAISE NOTICE '  - All indexes documented and retained for future use';
  RAISE NOTICE '  - Indexes will be utilized as data volume grows';
  RAISE NOTICE '';
  RAISE NOTICE 'Run the verification queries above to confirm all fixes.';
  RAISE NOTICE '=================================================================';
  RAISE NOTICE '';
END $$;
