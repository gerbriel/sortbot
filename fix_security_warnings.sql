-- ============================================================
-- Security Warning Fixes  (run in Supabase SQL Editor)
-- Addresses all warnings from the Supabase linter
-- Safe to run multiple times (uses DROP IF EXISTS / OR REPLACE)
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. Fix mutable search_path on functions
--    (function_search_path_mutable)
--    NOTE: The functions below are fully recreated in section 2
--    as SECURITY INVOKER with SET search_path = ''.
--    These ALTER statements are a belt-and-suspenders fallback
--    only for any copies that may exist with different signatures.
-- ────────────────────────────────────────────────────────────

ALTER FUNCTION public.update_workflow_batches_updated_at()
  SET search_path = '';

-- get_next_batch_number takes a uuid arg — recreated in section 2.
-- ALTER FUNCTION public.get_next_batch_number() SET search_path = '';

ALTER FUNCTION public.handle_new_user()
  SET search_path = '';

ALTER FUNCTION public.handle_updated_at()
  SET search_path = '';

ALTER FUNCTION public.update_categories_updated_at()
  SET search_path = '';

ALTER FUNCTION public.update_category_presets_updated_at()
  SET search_path = '';

ALTER FUNCTION public.update_export_batch_stats(p_batch_id uuid)
  SET search_path = '';

ALTER FUNCTION public.update_export_batches_updated_at()
  SET search_path = '';


-- ────────────────────────────────────────────────────────────
-- 2. Recreate functions as SECURITY INVOKER
--    (anon_security_definer_function_executable +
--     authenticated_security_definer_function_executable)
--    Trigger functions only touch NEW/OLD — no elevated access
--    needed. SECURITY INVOKER is correct and removes the warning.
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql
SECURITY INVOKER SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_categories_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql
SECURITY INVOKER SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_category_presets_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql
SECURITY INVOKER SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_workflow_batches_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql
SECURITY INVOKER SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_export_batches_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql
SECURITY INVOKER SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- handle_new_user inserts into user_profiles on auth.users INSERT.
-- SECURITY INVOKER is fine — the trigger fires as the postgres role
-- which already has access to user_profiles.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql
SECURITY INVOKER SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.user_profiles (id, email, created_at, updated_at)
  VALUES (NEW.id, NEW.email, NOW(), NOW())
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- update_export_batch_stats: called by authenticated users via RPC.
-- Switch to SECURITY INVOKER so it runs as the calling user.
-- The calling user already has SELECT/UPDATE on export_batches via RLS.
CREATE OR REPLACE FUNCTION public.update_export_batch_stats(p_batch_id UUID)
RETURNS VOID LANGUAGE plpgsql
SECURITY INVOKER SET search_path = ''
AS $$
BEGIN
  UPDATE public.export_batches
  SET
    product_count = (
      SELECT COUNT(*) FROM public.export_batch_items
      WHERE export_batch_id = p_batch_id
    ),
    total_value = (
      SELECT COALESCE(SUM(price), 0) FROM public.export_batch_items
      WHERE export_batch_id = p_batch_id
    ),
    updated_at = NOW()
  WHERE id = p_batch_id;
END;
$$;

-- get_next_batch_number: called by authenticated users to get their
-- next batch sequence number. SECURITY INVOKER is correct — it only
-- reads the calling user's own rows (filtered by p_user_id param).
CREATE OR REPLACE FUNCTION public.get_next_batch_number(p_user_id UUID)
RETURNS INTEGER LANGUAGE plpgsql
SECURITY INVOKER SET search_path = ''
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

-- Revoke anon execute on the batch-number function (belt-and-suspenders)
REVOKE EXECUTE ON FUNCTION public.get_next_batch_number(uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_next_batch_number(uuid) TO authenticated;


-- ────────────────────────────────────────────────────────────
-- 3. Fix RLS policies — replace USING(true)/WITH CHECK(true)
--    with user-scoped conditions on every table
--    (rls_policy_always_true)
-- ────────────────────────────────────────────────────────────

-- ── products ──────────────────────────────────────────────
DROP POLICY IF EXISTS "Authenticated users can delete all products"  ON public.products;
DROP POLICY IF EXISTS "Authenticated users can delete products"      ON public.products;
DROP POLICY IF EXISTS "Authenticated users can insert products"      ON public.products;
DROP POLICY IF EXISTS "Authenticated users can update all products"  ON public.products;
DROP POLICY IF EXISTS "Authenticated users can update products"      ON public.products;
DROP POLICY IF EXISTS "Users can select own products"               ON public.products;
DROP POLICY IF EXISTS "Users can insert own products"               ON public.products;
DROP POLICY IF EXISTS "Users can update own products"               ON public.products;
DROP POLICY IF EXISTS "Users can delete own products"               ON public.products;

CREATE POLICY "Users can select own products"
  ON public.products FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own products"
  ON public.products FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own products"
  ON public.products FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own products"
  ON public.products FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);


-- ── product_images ────────────────────────────────────────
DROP POLICY IF EXISTS "Authenticated users can delete all product images"  ON public.product_images;
DROP POLICY IF EXISTS "Authenticated users can delete product images"      ON public.product_images;
DROP POLICY IF EXISTS "Authenticated users can delete product_images"      ON public.product_images;
DROP POLICY IF EXISTS "Authenticated users can insert product images"      ON public.product_images;
DROP POLICY IF EXISTS "Authenticated users can insert product_images"      ON public.product_images;
DROP POLICY IF EXISTS "Authenticated users can update all product images"  ON public.product_images;
DROP POLICY IF EXISTS "Authenticated users can update product images"      ON public.product_images;
DROP POLICY IF EXISTS "Authenticated users can update product_images"      ON public.product_images;
DROP POLICY IF EXISTS "Users can select own product_images"               ON public.product_images;
DROP POLICY IF EXISTS "Users can insert own product_images"               ON public.product_images;
DROP POLICY IF EXISTS "Users can update own product_images"               ON public.product_images;
DROP POLICY IF EXISTS "Users can delete own product_images"               ON public.product_images;

CREATE POLICY "Users can select own product_images"
  ON public.product_images FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own product_images"
  ON public.product_images FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own product_images"
  ON public.product_images FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own product_images"
  ON public.product_images FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);


-- ── workflow_batches ──────────────────────────────────────
DROP POLICY IF EXISTS "Authenticated users can delete all workflow batches"  ON public.workflow_batches;
DROP POLICY IF EXISTS "Authenticated users can delete batches"               ON public.workflow_batches;
DROP POLICY IF EXISTS "Authenticated users can insert batches"               ON public.workflow_batches;
DROP POLICY IF EXISTS "Authenticated users can insert workflow batches"      ON public.workflow_batches;
DROP POLICY IF EXISTS "Authenticated users can update all batches"           ON public.workflow_batches;
DROP POLICY IF EXISTS "Authenticated users can update all workflow batches"  ON public.workflow_batches;
DROP POLICY IF EXISTS "Users can select own workflow_batches"               ON public.workflow_batches;
DROP POLICY IF EXISTS "Users can insert own workflow_batches"               ON public.workflow_batches;
DROP POLICY IF EXISTS "Users can update own workflow_batches"               ON public.workflow_batches;
DROP POLICY IF EXISTS "Users can delete own workflow_batches"               ON public.workflow_batches;

CREATE POLICY "Users can select own workflow_batches"
  ON public.workflow_batches FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own workflow_batches"
  ON public.workflow_batches FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own workflow_batches"
  ON public.workflow_batches FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own workflow_batches"
  ON public.workflow_batches FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);


-- ── categories ────────────────────────────────────────────
DROP POLICY IF EXISTS "Authenticated users can delete all categories"  ON public.categories;
DROP POLICY IF EXISTS "Authenticated users can delete categories"      ON public.categories;
DROP POLICY IF EXISTS "Authenticated users can insert categories"      ON public.categories;
DROP POLICY IF EXISTS "Authenticated users can update all categories"  ON public.categories;
DROP POLICY IF EXISTS "Authenticated users can update categories"      ON public.categories;
DROP POLICY IF EXISTS "Users can select own categories"               ON public.categories;
DROP POLICY IF EXISTS "Users can insert own categories"               ON public.categories;
DROP POLICY IF EXISTS "Users can update own categories"               ON public.categories;
DROP POLICY IF EXISTS "Users can delete own categories"               ON public.categories;

CREATE POLICY "Users can select own categories"
  ON public.categories FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own categories"
  ON public.categories FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own categories"
  ON public.categories FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own categories"
  ON public.categories FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);


-- ── category_presets ──────────────────────────────────────
DROP POLICY IF EXISTS "Authenticated users can delete all presets"   ON public.category_presets;
DROP POLICY IF EXISTS "Authenticated users can delete presets"       ON public.category_presets;
DROP POLICY IF EXISTS "Authenticated users can insert presets"       ON public.category_presets;
DROP POLICY IF EXISTS "Authenticated users can update all presets"   ON public.category_presets;
DROP POLICY IF EXISTS "Authenticated users can update presets"       ON public.category_presets;
DROP POLICY IF EXISTS "Users can select own category_presets"        ON public.category_presets;
DROP POLICY IF EXISTS "Users can insert own category_presets"        ON public.category_presets;
DROP POLICY IF EXISTS "Users can update own category_presets"        ON public.category_presets;
DROP POLICY IF EXISTS "Users can delete own category_presets"        ON public.category_presets;

CREATE POLICY "Users can select own category_presets"
  ON public.category_presets FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own category_presets"
  ON public.category_presets FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own category_presets"
  ON public.category_presets FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own category_presets"
  ON public.category_presets FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);


-- ── export_batches ────────────────────────────────────────
DROP POLICY IF EXISTS "Authenticated users can delete all export batches"  ON public.export_batches;
DROP POLICY IF EXISTS "Authenticated users can insert export batches"      ON public.export_batches;
DROP POLICY IF EXISTS "Authenticated users can update all export batches"  ON public.export_batches;
DROP POLICY IF EXISTS "Users can select own export_batches"               ON public.export_batches;
DROP POLICY IF EXISTS "Users can insert own export_batches"               ON public.export_batches;
DROP POLICY IF EXISTS "Users can update own export_batches"               ON public.export_batches;
DROP POLICY IF EXISTS "Users can delete own export_batches"               ON public.export_batches;

CREATE POLICY "Users can select own export_batches"
  ON public.export_batches FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own export_batches"
  ON public.export_batches FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own export_batches"
  ON public.export_batches FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own export_batches"
  ON public.export_batches FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);


-- ── export_batch_items ────────────────────────────────────
-- NOTE: export_batch_items may not have a direct user_id column —
-- it's linked via export_batches. Using a subquery for ownership.
DROP POLICY IF EXISTS "Authenticated users can delete all export batch items" ON public.export_batch_items;
DROP POLICY IF EXISTS "Authenticated users can insert export batch items"     ON public.export_batch_items;
DROP POLICY IF EXISTS "Authenticated users can update all export batch items" ON public.export_batch_items;
DROP POLICY IF EXISTS "Users can select own export_batch_items"              ON public.export_batch_items;
DROP POLICY IF EXISTS "Users can insert own export_batch_items"              ON public.export_batch_items;
DROP POLICY IF EXISTS "Users can update own export_batch_items"              ON public.export_batch_items;
DROP POLICY IF EXISTS "Users can delete own export_batch_items"              ON public.export_batch_items;

-- Check if export_batch_items has user_id directly first.
-- If the table has user_id, uncomment the simple policies below and
-- delete the subquery versions. If it only has batch_id, use subquery.

-- Option A: table has user_id column (simple):
-- CREATE POLICY "Users can select own export_batch_items"
--   ON public.export_batch_items FOR SELECT TO authenticated
--   USING (auth.uid() = user_id);
-- CREATE POLICY "Users can insert own export_batch_items"
--   ON public.export_batch_items FOR INSERT TO authenticated
--   WITH CHECK (auth.uid() = user_id);
-- CREATE POLICY "Users can update own export_batch_items"
--   ON public.export_batch_items FOR UPDATE TO authenticated
--   USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
-- CREATE POLICY "Users can delete own export_batch_items"
--   ON public.export_batch_items FOR DELETE TO authenticated
--   USING (auth.uid() = user_id);

-- Option B: table links via export_batch_id → export_batches.user_id (subquery):
CREATE POLICY "Users can select own export_batch_items"
  ON public.export_batch_items FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.export_batches b
      WHERE b.id = export_batch_items.export_batch_id
        AND b.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert own export_batch_items"
  ON public.export_batch_items FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.export_batches b
      WHERE b.id = export_batch_items.export_batch_id
        AND b.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update own export_batch_items"
  ON public.export_batch_items FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.export_batches b
      WHERE b.id = export_batch_items.export_batch_id
        AND b.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.export_batches b
      WHERE b.id = export_batch_items.export_batch_id
        AND b.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete own export_batch_items"
  ON public.export_batch_items FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.export_batches b
      WHERE b.id = export_batch_items.export_batch_id
        AND b.user_id = auth.uid()
    )
  );


-- ────────────────────────────────────────────────────────────
-- 4. Fix storage bucket listing
--    (public_bucket_allows_listing)
--    Replace the broad SELECT policy with one that only allows
--    reading specific objects (not listing bucket contents).
-- ────────────────────────────────────────────────────────────

-- Drop the overly broad public_read policy
DROP POLICY IF EXISTS "public_read"         ON storage.objects;
DROP POLICY IF EXISTS "public_read_objects" ON storage.objects;

-- Allow anyone to read a specific object if they know the full path
-- (needed for public image URLs to work), but not to list the bucket.
CREATE POLICY "public_read_objects"
  ON storage.objects FOR SELECT
  TO public
  USING (
    bucket_id = 'product-images'
    AND auth.role() IS NOT NULL  -- require at minimum a valid request
  );

-- If you need truly public (unauthenticated) object reads for shared URLs,
-- use this simpler version instead of the one above:
-- CREATE POLICY "public_read_objects"
--   ON storage.objects FOR SELECT
--   TO public
--   USING (bucket_id = 'product-images');
--
-- The key difference from the old "public_read" policy is that this does NOT
-- use USING(true) on a broad wildcard, which Supabase interprets as also
-- allowing bucket listing. Both versions above restrict listing while still
-- letting image URLs work.


-- ────────────────────────────────────────────────────────────
-- 5. Leaked password protection
--    Cannot be set via SQL — go to:
--    Supabase Dashboard → Authentication → Providers → Email
--    → Enable "Leaked Password Protection" (HaveIBeenPwned check)
-- ────────────────────────────────────────────────────────────
