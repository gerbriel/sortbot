-- ============================================================================
-- Collaborative edit policies
-- ----------------------------------------------------------------------------
-- Makes the shared workspace fully collaborative for EDITING: any authenticated
-- user can INSERT and UPDATE any row in workflow_batches, products, and
-- product_images. SELECT is already open to all authenticated users.
--
-- WHY: previously UPDATE was owner-scoped (auth.uid() = user_id). Opening and
-- editing someone else's batch was silently blocked, and the auto-save then
-- created a *duplicate* batch under the editor — the root cause of the duplicate
-- batches. With collaborative UPDATE, edits save in place and no duplicate is forked.
--
-- SCOPE / SAFETY:
--   * DELETE is intentionally LEFT owner-scoped (deletion is the most destructive
--     operation and we keep per-user protection there).
--   * SELECT policies are untouched (already collaborative).
--   * This is idempotent: re-running drops and recreates the collab policies.
--
-- Run this once in the Supabase Dashboard → SQL Editor.
-- Rollback is at the bottom (commented out).
-- ============================================================================

-- 1. Drop existing INSERT/UPDATE policies on the three tables (whatever they're named).
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('workflow_batches', 'products', 'product_images')
      AND cmd IN ('UPDATE', 'INSERT')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, r.tablename);
  END LOOP;
END $$;

-- 2. Recreate permissive INSERT + UPDATE for authenticated users on all three.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['workflow_batches', 'products', 'product_images'] LOOP
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (true)',
      'collab_insert_' || t, t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (true) WITH CHECK (true)',
      'collab_update_' || t, t);
  END LOOP;
END $$;

-- 3. Verify (optional — run as a separate query to inspect the result):
--   SELECT tablename, policyname, cmd
--   FROM pg_policies
--   WHERE schemaname = 'public'
--     AND tablename IN ('workflow_batches','products','product_images')
--   ORDER BY tablename, cmd;

-- ----------------------------------------------------------------------------
-- ROLLBACK (re-scope INSERT/UPDATE back to owner-only). Uncomment to revert:
--
-- DO $$
-- DECLARE r RECORD;
-- BEGIN
--   FOR r IN SELECT tablename, policyname FROM pg_policies
--            WHERE schemaname='public'
--              AND tablename IN ('workflow_batches','products','product_images')
--              AND policyname LIKE 'collab_%'
--   LOOP EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, r.tablename); END LOOP;
-- END $$;
-- DO $$
-- DECLARE t TEXT;
-- BEGIN
--   FOREACH t IN ARRAY ARRAY['workflow_batches','products','product_images'] LOOP
--     EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id)', 'own_insert_'||t, t);
--     EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id)', 'own_update_'||t, t);
--   END LOOP;
-- END $$;
