# System Defaults Fix - Categories & Presets

## Problem
System default categories and presets (with `user_id = '00000000-0000-0000-0000-000000000000'`) were not showing up for users because:

1. **RLS Policies were too restrictive** - Only allowed users to see their own data
2. **Service functions were filtering by user_id** - Explicitly excluding system defaults

## Solution

### 1. Database RLS Policies (Migration)

Run: `fix_rls_categories_and_presets.sql`

**Categories Policies:**
```sql
-- SELECT: Show system defaults + user's own
CREATE POLICY "Users can view their own categories and system defaults"
  ON categories FOR SELECT
  USING (
    user_id = '00000000-0000-0000-0000-000000000000'  -- System defaults
    OR 
    auth.uid() = user_id  -- User's own
  );
```

**Presets Policies:**
```sql
-- SELECT: Show system defaults + user's own
CREATE POLICY "Users can view their own presets and system defaults"
  ON category_presets FOR SELECT
  USING (
    user_id = '00000000-0000-0000-0000-000000000000'  -- System defaults
    OR 
    auth.uid() = user_id  -- User's own
  );
```

**Protection:**
- Users CAN view system defaults ✅
- Users CANNOT edit system defaults ❌
- Users CANNOT delete system defaults ❌
- Users CAN duplicate system defaults ✅

### 2. Code Changes

**categoriesService.ts:**
```typescript
// BEFORE - only showed user's own categories
.eq('user_id', user.id)

// AFTER - let RLS policy handle it (shows system defaults + user's own)
// Removed .eq('user_id', user.id)
```

**categoryPresetsService.ts:**
```typescript
// Already correct - no user_id filter
// RLS policy automatically shows system defaults + user's own
```

### 3. Testing

**Console Logs Added:**
- `categoriesService.ts` - Shows which categories are loaded (SYSTEM vs USER)
- `categoryPresetsService.ts` - Shows which presets are loaded (SYSTEM vs USER)

**Check Browser Console:**
```
🔍 Fetching categories for user: 18c356d9-2b6a-45c6-ae41-c6d360e9663f
✅ Found 7 categories: [
  { name: 'Bottoms', type: 'SYSTEM' },
  { name: 'Feminine', type: 'SYSTEM' },
  ...
]

🔍 Fetching category presets for user: 18c356d9-2b6a-45c6-ae41-c6d360e9663f
✅ Found 7 category presets: [
  { name: 'Bottoms (Default)', type: 'SYSTEM', product_type: 'bottoms' },
  { name: 'Feminine (Default)', type: 'SYSTEM', product_type: 'femme' },
  ...
]
```

## Expected Results

**Categories Manager:**
- Shows 7 system default categories ✅
- Bottoms 👖
- Feminine 👗
- Hats 🧢
- Mystery Boxes 📦
- Outerwear 🧥
- Sweatshirts 👕
- Tees 👚

**Presets Manager:**
- Shows 7 system default presets ✅
- Bottoms (Default) - 1.0 lb
- Feminine (Default) - 0.8 lb
- Hats (Default) - 0.3 lb
- Mystery Boxes (Default) - 2.0 lb
- Outerwear (Default) - 1.5 lb
- Sweatshirts (Default) - 1.2 lb
- Tees (Default) - 0.5 lb

**Product Description Generator:**
- Category dropdown shows all 7 categories ✅
- Preset dropdown shows all 7 presets ✅
- Auto-applies default preset when category is selected ✅

## Migration Steps

1. **Run Migration:**
   ```sql
   -- In Supabase SQL Editor
   -- Copy and run: fix_rls_categories_and_presets.sql
   ```

2. **Verify in Database:**
   ```sql
   -- Should show 7 system defaults visible to all users
   SELECT display_name, user_id 
   FROM categories 
   WHERE is_active = true;
   
   SELECT display_name, user_id 
   FROM category_presets 
   WHERE is_active = true;
   ```

3. **Refresh App:**
   - Open browser console
   - Check for "✅ Found X categories" logs
   - Open Categories Manager - should see 7 categories
   - Open Presets Manager - should see 7 presets

## Future: Adding New System Defaults

When adding new system categories/presets:

```sql
-- Use the special system user_id
INSERT INTO categories (user_id, name, display_name, ...)
VALUES ('00000000-0000-0000-0000-000000000000', 'new_category', 'New Category', ...);

INSERT INTO category_presets (user_id, product_type, display_name, ...)
VALUES ('00000000-0000-0000-0000-000000000000', 'new_category', 'New Category (Default)', ...);
```

These will automatically be visible to ALL users! 🌐
