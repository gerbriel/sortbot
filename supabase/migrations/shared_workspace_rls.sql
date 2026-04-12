-- ============================================================
-- SHARED WORKSPACE RLS POLICIES
-- All logged-in users can READ, INSERT, UPDATE, and DELETE all rows.
-- ============================================================

-- ── workflow_batches ────────────────────────────────────────
DROP POLICY IF EXISTS "Users can view own batches" ON workflow_batches;
DROP POLICY IF EXISTS "Users can view their batches" ON workflow_batches;
DROP POLICY IF EXISTS "Users can read own batches" ON workflow_batches;
DROP POLICY IF EXISTS "Select own batches" ON workflow_batches;
DROP POLICY IF EXISTS "Users can insert own batches" ON workflow_batches;
DROP POLICY IF EXISTS "Users can update own batches" ON workflow_batches;
DROP POLICY IF EXISTS "Users can delete own batches" ON workflow_batches;

CREATE POLICY "All users can view all batches"
  ON workflow_batches FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "All users can insert batches"
  ON workflow_batches FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "All users can update all batches"
  ON workflow_batches FOR UPDATE
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "All users can delete all batches"
  ON workflow_batches FOR DELETE
  USING (auth.uid() IS NOT NULL);

-- ── products ────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can view own products" ON products;
DROP POLICY IF EXISTS "Users can view their products" ON products;
DROP POLICY IF EXISTS "Users can read own products" ON products;
DROP POLICY IF EXISTS "Select own products" ON products;
DROP POLICY IF EXISTS "Users can insert own products" ON products;
DROP POLICY IF EXISTS "Users can update own products" ON products;
DROP POLICY IF EXISTS "Users can delete own products" ON products;

CREATE POLICY "All users can view all products"
  ON products FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "All users can insert products"
  ON products FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "All users can update all products"
  ON products FOR UPDATE
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "All users can delete all products"
  ON products FOR DELETE
  USING (auth.uid() IS NOT NULL);

-- ── product_images ───────────────────────────────────────────
DROP POLICY IF EXISTS "Users can view own images" ON product_images;
DROP POLICY IF EXISTS "Users can view their images" ON product_images;
DROP POLICY IF EXISTS "Users can read own images" ON product_images;
DROP POLICY IF EXISTS "Select own images" ON product_images;
DROP POLICY IF EXISTS "Users can insert own images" ON product_images;
DROP POLICY IF EXISTS "Users can update own images" ON product_images;
DROP POLICY IF EXISTS "Users can delete own images" ON product_images;

CREATE POLICY "All users can view all images"
  ON product_images FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "All users can insert images"
  ON product_images FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "All users can update all images"
  ON product_images FOR UPDATE
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "All users can delete all images"
  ON product_images FOR DELETE
  USING (auth.uid() IS NOT NULL);
