# 🚨 IMPORTANT: Apply Collaborative Migration

## Problem
Your database still has user-specific RLS policies that prevent users from seeing shared data.

## Solution
Run the collaborative migration in your Supabase SQL Editor.

## Steps:

### 1. Open Supabase Dashboard
Go to: https://supabase.com/dashboard/project/YOUR_PROJECT_ID/sql

### 2. Copy the Migration SQL
Open the file: `supabase/migrations/convert_to_shared_collaborative.sql`

### 3. Paste and Run
- Paste the entire SQL file into the Supabase SQL Editor
- Click **"Run"** (or press Cmd+Enter)

### 4. Verify Success
You should see output showing:
- Policies dropped
- New collaborative policies created
- Constraints updated

### 5. Refresh Your App
After running the migration:
- Reload the app in your browser
- The Library views should now show all data from all users

## What This Does:
Changes RLS policies from:
```sql
-- OLD (user-specific)
CREATE POLICY "Users can view own products"
  ON public.products FOR SELECT
  USING (auth.uid() = user_id);
```

To:
```sql
-- NEW (collaborative)
CREATE POLICY "Authenticated users can view all products"
  ON public.products FOR SELECT
  TO authenticated
  USING (true);
```

This makes:
- ✅ Products visible to all users
- ✅ Images visible to all users  
- ✅ Batches visible to all users
- ✅ Categories shared across all users
- ✅ Presets shared across all users

## Need Help?
The full migration is in: `supabase/migrations/convert_to_shared_collaborative.sql`
