# Auto-Save Fix for Product Groups

## Problem
Images were being saved twice to the database:
1. **Auto-save**: When grouping images into product groups (to prevent data loss on refresh)
2. **Manual save**: When clicking "Add to Library" button

This caused duplicate database entries (e.g., 10 images → 14 database records).

## Solution
Implemented **deduplication tracking** to prevent saving the same product groups twice:

### 1. Track Auto-Saved Groups
```typescript
const [autoSavedProductGroups, setAutoSavedProductGroups] = useState<Set<string>>(new Set());
```

### 2. Auto-Save on Grouping
When user groups images (Step 3), multi-item groups are automatically saved:

```typescript
// In handleImagesGrouped:
const newMultiItemGroups = Object.entries(groupedItemsMap)
  .filter(([groupId, group]) => 
    group.length > 1 && 
    !autoSavedProductGroups.has(groupId) // Only NEW groups
  )
  .map(([_, group]) => group);

// Save and track
await saveBatchToDatabase(itemsToSave, user.id);
setAutoSavedProductGroups(prev => new Set([...prev, ...savedGroupIds]));
```

### 3. Skip Already-Saved Groups on Manual Save
When clicking "Add to Library", skip groups that were already auto-saved:

```typescript
// In handleSaveToLibrary:
const itemsToSave = processedItems.filter(item => {
  if (item.productGroup && autoSavedProductGroups.has(item.productGroup)) {
    console.log(`⏭️  Skipping item ${item.id} - already auto-saved`);
    return false;
  }
  return true;
});
```

## Benefits

✅ **Prevents Data Loss**: Product groups are saved immediately (survives page refresh)  
✅ **No Duplicates**: Already-saved groups are skipped in manual save  
✅ **Accurate Count**: Shows correct total (auto-saved + newly saved)  
✅ **Clean Database**: No duplicate entries with temp paths  

## Example Flow

**Scenario**: User uploads 10 images, groups into 2 product groups (4 + 6 images)

### Step 1: Auto-Save on Grouping
```
User finishes grouping → handleImagesGrouped triggers
📦 Auto-saving NEW product groups...
✅ Auto-saved 2 product group(s)! (4 + 6 images)
Tracking: Set(['group-1', 'group-2'])
Database: 10 entries with permanent paths
```

### Step 2: Manual Save (Add to Library)
```
User clicks "Add to Library" → handleSaveToLibrary triggers
⏭️  Skipping group-1 - already auto-saved
⏭️  Skipping group-2 - already auto-saved
📦 Manual save: 0 items to save (10 already auto-saved)
✅ Saved 10 product(s)!
Clear tracking: Set()
```

**Result**: 10 database entries (not 14!) ✅

## Console Logs

Look for these messages to verify the fix is working:

```
🔄 Auto-saving NEW product groups (not previously saved)...
✅ Auto-saved 2 product group(s)!

⏭️  Skipping item abc123 - already auto-saved in group group-1
📦 Manual save: 0 items to save (10 already auto-saved)
✅ Saved 10 product(s)!
```

## Testing

1. **Clear existing test data**:
   ```sql
   DELETE FROM product_images WHERE user_id = 'your-user-id';
   ```

2. **Upload fresh images**:
   - Upload 10 images
   - Group into 2 product groups (e.g., 4 + 6)
   - Watch console for auto-save message

3. **Complete workflow**:
   - Click "Add to Library"
   - Watch console for skip messages
   - Verify total count is correct

4. **Verify database**:
   ```sql
   SELECT COUNT(*) FROM product_images WHERE user_id = 'your-user-id';
   -- Should show exactly 10 entries
   ```

5. **Test refresh resilience**:
   - Upload and group images
   - Refresh page BEFORE clicking "Add to Library"
   - Auto-saved groups should persist in database ✅

## Code Changes

**Files Modified**:
- `src/App.tsx`:
  - Added `autoSavedProductGroups` state (line 135)
  - Modified `handleImagesGrouped` to track auto-saved groups (lines 260-305)
  - Modified `handleSaveToLibrary` to skip already-saved groups (lines 170-220)

## Migration Notes

No database migration needed - this is a client-side tracking fix only.
