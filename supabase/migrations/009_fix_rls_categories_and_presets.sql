-- ============================================================================
-- COMPLETE RLS POLICY FIX FOR CATEGORIES AND PRESETS
-- ============================================================================
-- This ensures all users can see system default categories and presets

BEGIN;

-- ============================================================================
-- PART 1: FIX CATEGORIES TABLE
-- ============================================================================

-- Step 1: Show current category policies
SELECT 
  '=== CURRENT CATEGORY POLICIES ===' as status,
  policyname,
  cmd,
  qual
FROM pg_policies 
WHERE tablename = 'categories';

-- Step 2: Drop ALL existing category policies
DROP POLICY IF EXISTS "Users can view their own categories" ON categories;
DROP POLICY IF EXISTS "Users can view their own categories and system defaults" ON categories;
DROP POLICY IF EXISTS "Users can insert their own categories" ON categories;
DROP POLICY IF EXISTS "Users can update their own categories" ON categories;
DROP POLICY IF EXISTS "Users can delete their own categories" ON categories;

-- Step 3: Create NEW category policies

-- SELECT: Users can see their own categories + system defaults
CREATE POLICY "Users can view their own categories and system defaults"
  ON categories FOR SELECT
  USING (
    user_id = '00000000-0000-0000-0000-000000000000'  -- System defaults (visible to everyone)
    OR 
    auth.uid() = user_id  -- User's own categories
  );

-- INSERT: Users can only create their own categories
CREATE POLICY "Users can insert their own categories"
  ON categories FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- UPDATE: Users can only update their own categories (not system defaults)
CREATE POLICY "Users can update their own categories"
  ON categories FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- DELETE: Users can only delete their own categories (not system defaults)
CREATE POLICY "Users can delete their own categories"
  ON categories FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================================================
-- PART 2: FIX CATEGORY_PRESETS TABLE
-- ============================================================================

-- Step 4: Show current preset policies
SELECT 
  '=== CURRENT PRESET POLICIES ===' as status,
  policyname,
  cmd,
  qual
FROM pg_policies 
WHERE tablename = 'category_presets';

-- Step 5: Drop ALL existing preset policies
DROP POLICY IF EXISTS "Users can view their own category presets" ON category_presets;
DROP POLICY IF EXISTS "Users can view their own presets and system defaults" ON category_presets;
DROP POLICY IF EXISTS "Users can insert their own category presets" ON category_presets;
DROP POLICY IF EXISTS "Users can update their own category presets" ON category_presets;
DROP POLICY IF EXISTS "Users can delete their own category presets" ON category_presets;
DROP POLICY IF EXISTS "Users can insert their own presets" ON category_presets;
DROP POLICY IF EXISTS "Users can update their own presets" ON category_presets;
DROP POLICY IF EXISTS "Users can delete their own presets" ON category_presets;

-- Step 6: Create NEW preset policies

-- SELECT: Users can see their own presets + system defaults
CREATE POLICY "Users can view their own presets and system defaults"
  ON category_presets FOR SELECT
  USING (
    user_id = '00000000-0000-0000-0000-000000000000'  -- System defaults (visible to everyone)
    OR 
    auth.uid() = user_id  -- User's own presets
  );

-- INSERT: Users can only create their own presets
CREATE POLICY "Users can insert their own presets"
  ON category_presets FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- UPDATE: Users can only update their own presets (not system defaults)
CREATE POLICY "Users can update their own presets"
  ON category_presets FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- DELETE: Users can only delete their own presets (not system defaults)
CREATE POLICY "Users can delete their own presets"
  ON category_presets FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================================================
-- VERIFICATION
-- ============================================================================

-- Step 7: Show new policies for both tables
SELECT 
  '=== NEW POLICIES ===' as status,
  tablename,
  policyname,
  cmd,
  qual,
  with_check
FROM pg_policies 
WHERE tablename IN ('categories', 'category_presets')
ORDER BY tablename, cmd, policyname;

-- Step 8: Test query - show categories visible to current user
SELECT 
  '=== CATEGORIES VISIBLE TO CURRENT USER ===' as status,
  display_name,
  name,
  emoji,
  user_id,
  CASE 
    WHEN user_id = '00000000-0000-0000-0000-000000000000' THEN '🌐 System Default'
    ELSE '👤 User Category'
  END as category_type,
  is_active
FROM categories
WHERE is_active = true
ORDER BY 
  CASE WHEN user_id = '00000000-0000-0000-0000-000000000000' THEN 0 ELSE 1 END,
  sort_order,
  display_name;

-- Step 9: Test query - show presets visible to current user
SELECT 
  '=== PRESETS VISIBLE TO CURRENT USER ===' as status,
  display_name,
  product_type,
  user_id,
  CASE 
    WHEN user_id = '00000000-0000-0000-0000-000000000000' THEN '🌐 System Default'
    ELSE '👤 User Preset'
  END as preset_type,
  is_active
FROM category_presets
WHERE is_active = true
ORDER BY 
  CASE WHEN user_id = '00000000-0000-0000-0000-000000000000' THEN 0 ELSE 1 END,
  display_name;

COMMIT;

-- Final verification counts
SELECT 
  '=== FINAL COUNTS ===' as status,
  'Categories' as table_name,
  COUNT(*) FILTER (WHERE user_id = '00000000-0000-0000-0000-000000000000') as system_defaults,
  COUNT(*) FILTER (WHERE user_id != '00000000-0000-0000-0000-000000000000') as user_items,
  COUNT(*) as total
FROM categories
WHERE is_active = true

UNION ALL

SELECT 
  '=== FINAL COUNTS ===' as status,
  'Presets' as table_name,
  COUNT(*) FILTER (WHERE user_id = '00000000-0000-0000-0000-000000000000') as system_defaults,
  COUNT(*) FILTER (WHERE user_id != '00000000-0000-0000-0000-000000000000') as user_items,
  COUNT(*) as total
FROM category_presets
WHERE is_active = true;
