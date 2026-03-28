-- ============================================================
-- SHARED WORKSPACE RLS POLICIES
-- All logged-in users can READ all rows.
-- Users can only INSERT/UPDATE/DELETE their own rows.
-- ============================================================

-- ── workflow_batches ────────────────────────────────────────
DROP POLICY IF EXISTS "Users can view own batches" ON workflow_batches;
DROP POLICY IF EXISTS "Users can view their batches" ON workflow_batches;
DROP POLICY IF EXISTS "Users can read own batches" ON workflow_batches;
DROP POLICY IF EXISTS "Select own batches" ON workflow_batches;

CREATE POLICY "All users can view all batches"
  ON workflow_batches FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- ── products ────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can view own products" ON products;
DROP POLICY IF EXISTS "Users can view their products" ON products;
DROP POLICY IF EXISTS "Users can read own products" ON products;
DROP POLICY IF EXISTS "Select own products" ON products;

CREATE POLICY "All users can view all products"
  ON products FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- ── product_images ───────────────────────────────────────────
DROP POLICY IF EXISTS "Users can view own images" ON product_images;
DROP POLICY IF EXISTS "Users can view their images" ON product_images;
DROP POLICY IF EXISTS "Users can read own images" ON product_images;
DROP POLICY IF EXISTS "Select own images" ON product_images;

CREATE POLICY "All users can view all images"
  ON product_images FOR SELECT
  USING (auth.uid() IS NOT NULL);
