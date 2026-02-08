# How to Complete the Database Migration

## ✅ Code Changes: DONE
All service files have been updated to work in collaborative mode.

## ⏳ Database Changes: TODO
You need to update the RLS policies in Supabase.

## Quick Start

### Option 1: Supabase Dashboard (Recommended)

1. **Open Supabase SQL Editor**
   - Go to: https://supabase.com/dashboard/project/raaenaqjsmihimegflhj/sql/new

2. **Copy and run this SQL** (in order):

```sql
-- ============================================================================
-- STEP 1: Update Products Table
-- ============================================================================

DROP POLICY IF EXISTS "Users can view own products" ON public.products;
DROP POLICY IF EXISTS "Users can insert own products" ON public.products;
DROP POLICY IF EXISTS "Users can update own products" ON public.products;
DROP POLICY IF EXISTS "Users can delete own products" ON public.products;

CREATE POLICY "Authenticated users can view all products"
  ON public.products FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert products"
  ON public.products FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update all products"
  ON public.products FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can delete all products"
  ON public.products FOR DELETE TO authenticated USING (true);
```

```sql
-- ============================================================================
-- STEP 2: Update Product Images Table
-- ============================================================================

DROP POLICY IF EXISTS "Users can view own product images" ON public.product_images;
DROP POLICY IF EXISTS "Users can insert own product images" ON public.product_images;
DROP POLICY IF EXISTS "Users can delete own product images" ON public.product_images;

CREATE POLICY "Authenticated users can view all product images"
  ON public.product_images FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert product images"
  ON public.product_images FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update all product images"
  ON public.product_images FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can delete all product images"
  ON public.product_images FOR DELETE TO authenticated USING (true);
```

```sql
-- ============================================================================
-- STEP 3: Update Workflow Batches Table
-- ============================================================================

DROP POLICY IF EXISTS "Users can view own workflow batches" ON public.workflow_batches;
DROP POLICY IF EXISTS "Users can insert own workflow batches" ON public.workflow_batches;
DROP POLICY IF EXISTS "Users can update own workflow batches" ON public.workflow_batches;
DROP POLICY IF EXISTS "Users can delete own workflow batches" ON public.workflow_batches;

CREATE POLICY "Authenticated users can view all workflow batches"
  ON public.workflow_batches FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert workflow batches"
  ON public.workflow_batches FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update all workflow batches"
  ON public.workflow_batches FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can delete all workflow batches"
  ON public.workflow_batches FOR DELETE TO authenticated USING (true);
```

3. **Verify it worked**

```sql
-- Check policies were created
SELECT tablename, policyname, cmd 
FROM pg_policies 
WHERE schemaname = 'public' 
  AND tablename IN ('products', 'product_images', 'workflow_batches')
ORDER BY tablename, policyname;
```

You should see policies like "Authenticated users can view all products"

### Option 2: Use Full Migration File

If you want to update ALL tables at once (including categories, presets, export batches):

1. Open `supabase/migrations/convert_to_shared_collaborative.sql`
2. Copy the entire file
3. Paste into Supabase SQL Editor
4. Run it

## After Running Migration

1. **Refresh your app** (hard refresh: Cmd+Shift+R)
2. **Check Library** - you should see all products (not just yours)
3. **Check Categories** - should be shared
4. **Test creating** a new category - other users should see it

## If Something Goes Wrong

### Revert the policies:

```sql
-- Restore old policy for products (example)
DROP POLICY "Authenticated users can view all products" ON public.products;

CREATE POLICY "Users can view own products"
  ON public.products FOR SELECT
  USING (auth.uid() = user_id);

-- Repeat for other policies...
```

## Need Help?

- Check `MIGRATION_COMPLETED.md` for full details
- Check `CONVERT_TO_COLLABORATIVE_GUIDE.md` for explanation
- Check Supabase logs for errors

## Summary

**What you're doing:**
- Changing RLS policies from "user can only see their own data" 
- To "all authenticated users can see all data"

**What stays the same:**
- You still need to be logged in
- user_id is still recorded (for audit trail)

**What changes:**
- All users see the same products, categories, etc.
- Changes by one user appear for everyone

---

**Ready?** Copy the SQL above and run it in Supabase Dashboard!
