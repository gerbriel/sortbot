-- ============================================================================
-- FIX RLS POLICY TO SHOW SYSTEM DEFAULT PRESETS
-- ============================================================================
-- This allows users to see both their own presets AND system defaults

-- Drop the existing restrictive policy
DROP POLICY IF EXISTS "Users can view their own category presets" ON category_presets;

-- Create new policy that shows both user's own presets AND system defaults
CREATE POLICY "Users can view their own presets and system defaults"
  ON category_presets FOR SELECT
  USING (
    auth.uid() = user_id  -- User's own presets
    OR 
    user_id = '00000000-0000-0000-0000-000000000000'  -- System defaults visible to all
  );

-- Verify the policy was created
SELECT 
  '=== RLS POLICY UPDATED ===' as status,
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual
FROM pg_policies 
WHERE tablename = 'category_presets'
  AND policyname = 'Users can view their own presets and system defaults';
