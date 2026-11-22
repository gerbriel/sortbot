-- ============================================================================
-- COMPLETE RLS POLICY FIX FOR CATEGORY PRESETS
-- ============================================================================
-- This ensures all users can see system default presets

BEGIN;

-- Step 1: Show current policies
SELECT 
  '=== CURRENT POLICIES BEFORE FIX ===' as status,
  policyname,
  cmd,
  qual
FROM pg_policies 
WHERE tablename = 'category_presets';

-- Step 2: Drop ALL existing policies
DROP POLICY IF EXISTS "Users can view their own category presets" ON category_presets;
DROP POLICY IF EXISTS "Users can view their own presets and system defaults" ON category_presets;
DROP POLICY IF EXISTS "Users can insert their own category presets" ON category_presets;
DROP POLICY IF EXISTS "Users can update their own category presets" ON category_presets;
DROP POLICY IF EXISTS "Users can delete their own category presets" ON category_presets;

-- Step 3: Create NEW comprehensive policies

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

-- Step 4: Show new policies
SELECT 
  '=== NEW POLICIES AFTER FIX ===' as status,
  policyname,
  cmd,
  qual,
  with_check
FROM pg_policies 
WHERE tablename = 'category_presets'
ORDER BY cmd, policyname;

-- Step 5: Test query - show what the current user would see
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

-- Final verification count
SELECT 
  '=== FINAL COUNT ===' as status,
  COUNT(*) FILTER (WHERE user_id = '00000000-0000-0000-0000-000000000000') as system_defaults,
  COUNT(*) FILTER (WHERE user_id != '00000000-0000-0000-0000-000000000000') as user_presets,
  COUNT(*) as total_presets
FROM category_presets
WHERE is_active = true;
