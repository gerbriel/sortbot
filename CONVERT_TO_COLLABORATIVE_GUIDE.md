# Convert to Shared Collaborative System

## Overview

This application is being converted from a **multi-tenant isolated system** (each user sees only their data) to a **shared collaborative system** (all users see and edit the same data).

## What This Means

- **Before**: Each user had their own separate products, images, categories, presets
- **After**: All users share the same products, images, categories, presets
- **Audit Trail**: `user_id` columns remain to track who created what
- **Authentication**: Still required - but RLS policies now allow all authenticated users to access all data

## Changes Required

### 1. Database Migration ✅

Run the migration file: `supabase/migrations/convert_to_shared_collaborative.sql`

**What it does:**
- Removes user-specific RLS policies
- Creates collaborative RLS policies (all authenticated users can access all data)
- Removes unique constraints that included `user_id`
- Updates `get_next_batch_number()` function to work globally
- Keeps `user_id` columns for audit trail

### 2. Application Code Changes

All service files need to be updated to remove `user_id` filtering:

#### Files to Update:

1. **src/lib/productService.ts**
   - ❌ Remove: `.eq('user_id', userId)` from SELECT queries
   - ✅ Keep: `user_id: userId` in INSERT statements (for audit)
   - Lines to change: ~268, 293, 312, 352

2. **src/lib/libraryService.ts**
   - ❌ Remove: `.eq('user_id', userId)` from all queries
   - Search for: "user_id"

3. **src/lib/categoriesService.ts**
   - ❌ Remove: `.eq('user_id', userId)` from SELECT queries
   - ❌ Remove: `user_id` from duplicate checks
   - ✅ Keep: `user_id: user.id` in INSERT statements
   - Lines to change: ~151, 177, 206, 224

4. **src/lib/categoryPresetsService.ts**
   - ❌ Remove: System vs User preset distinction
   - ❌ Remove: `.eq('user_id', userId)` filtering
   - ✅ Keep: `user_id: user.id` in INSERT statements
   - Line 72: Keep user_id in INSERT
   - Line 28: Remove type distinction logic

5. **src/lib/exportLibraryService.ts**
   - ❌ Remove: `.eq('user_id', userId)` from queries
   - ❌ Update: `get_next_batch_number` RPC call (no longer needs user_id)
   - Lines to change: ~96, 233, 374, 406

6. **src/lib/workflowBatchService.ts**
   - ❌ Remove: `.eq('user_id', userId)` from queries
   - ✅ Keep: `user_id: userId` in INSERT statements

## Testing Checklist

After making changes, verify:

- [ ] Products from all users appear in Library
- [ ] All users see the same categories in CategoryZones
- [ ] All users see the same presets in CategoryPresetsManager
- [ ] Creating a new category shows for all users
- [ ] Creating a new preset shows for all users
- [ ] Editing a category updates for all users
- [ ] Editing a preset updates for all users
- [ ] Batch numbers are sequential globally (not per-user)
- [ ] Export batches are shared across all users
- [ ] Workflow batches are visible to all users
- [ ] No "duplicate" entries appearing
- [ ] User authentication still required to access app

## Database Schema Notes

### Tables That Keep user_id (For Audit Trail)

All tables keep `user_id` column but don't filter by it:

- `products` - Track who created each product
- `product_images` - Track who uploaded each image  
- `categories` - Track who created each category
- `category_presets` - Track who created each preset
- `workflow_batches` - Track who started each batch
- `export_batches` - Track who created each export

### Unique Constraints Changed

**Before:**
- `categories` - UNIQUE(`user_id`, `name`) - Each user could have "Tops" category
- `export_batches` - UNIQUE(`user_id`, `batch_number`) - Each user had own numbering

**After:**
- `categories` - UNIQUE(`name`) - Only ONE "Tops" category globally
- `export_batches` - UNIQUE(`batch_number`) - Global batch numbering

## Migration Safety

### Rollback Plan

If you need to revert to user-isolated system:

```sql
-- 1. Restore user-specific RLS policies
-- 2. Restore unique constraints with user_id
-- 3. Restore get_next_batch_number(UUID) function
-- (See original schema.sql and migration files)
```

### Data Integrity

- No data is deleted by migration
- All existing data remains intact
- Users can still see their own `user_id` on records
- Could add UI to show "Created by" user email if desired

## Performance Considerations

### Improved Performance

- ✅ Simpler queries (no user_id filtering)
- ✅ Fewer RLS policy evaluations
- ✅ Shared cache for all users

### Potential Issues

- ⚠️ More data loaded (all users' data, not just one user's)
- ⚠️ Concurrent edits possible (implement optimistic locking if needed)

## Security Considerations

### What's Protected

- ✅ Users must be authenticated to access any data
- ✅ RLS still enabled (but allows all authenticated users)
- ✅ Storage bucket policies still apply
- ✅ Audit trail maintained (user_id shows who did what)

### What Changed

- ❌ Users can now see/edit each other's data
- ❌ No isolation between users
- ✅ This is intentional for collaborative use case

## Example Code Changes

### Before (User-Isolated)

```typescript
// Only fetch current user's products
const { data, error } = await supabase
  .from('products')
  .select('*')
  .eq('user_id', userId);  // ❌ Remove this
```

### After (Collaborative)

```typescript
// Fetch all products (for all users)
const { data, error } = await supabase
  .from('products')
  .select('*');
  // No user_id filter needed - RLS handles authentication
```

### Inserting Data

```typescript
// Still include user_id for audit trail
const { data, error } = await supabase
  .from('products')
  .insert({
    user_id: userId,  // ✅ Keep this for audit
    title: 'My Product',
    // ... other fields
  });
```

## Next Steps

1. ✅ Review migration SQL
2. ⏳ Run migration on database
3. ⏳ Update all service files (remove user_id filtering)
4. ⏳ Test thoroughly
5. ⏳ Deploy changes

## Questions?

- **Q: What if I want some user-specific data?**
  - A: Add new tables specifically for user preferences (like `user_profiles`)

- **Q: Can I track who made changes?**
  - A: Yes, `user_id` is preserved on all records. You could add "Created by" UI.

- **Q: What about concurrent edits?**
  - A: Implement optimistic locking or last-write-wins (currently last-write-wins)

- **Q: Can I revert this?**
  - A: Yes, but you'd need to partition existing data by user_id or assign it to one user
