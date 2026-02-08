# Quick Start: Using the New Library System

## What Changed?

**Before:**
- "Saved Products" showed individual product groups
- No way to resume workflow
- Lost progress when closing browser

**After:**
- "Library" shows batch cards (like macOS Finder folders)
- Click to reopen and resume exactly where you left off
- Never lose progress

---

## How to Use

### 1. Create a Batch

```
1. Upload images (Step 1)
2. Group them (Step 2)  
3. Categorize (Step 3)
4. Add descriptions (Step 4)
5. Click "💾 Save Batch to Database" (Step 5)
```

### 2. View Your Batches

```
1. Click "📦 Library" button in header
2. See all your saved batches as cards
3. Each card shows:
   - 2x2 thumbnail grid
   - Date ("2h ago", "3d ago", "Feb 8")
   - Image count
   - Product groups count
   - Progress bar ("Step 3: Categorize - 60%")
```

### 3. Reopen a Batch

```
1. In Library, find the batch you want
2. Hover over it
3. Click "Open" button
4. ✨ Workflow resumes exactly where you left off!
```

### 4. Delete a Batch

```
1. In Library, hover over batch
2. Click "Delete" button
3. Click again to confirm
4. Batch removed
```

---

## Visual Guide

### Library View

```
┌────────────────────────────────────────────┐
│  Library                      (3 batches)  │
├────────────────────────────────────────────┤
│                                            │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐ │
│  │ [🖼️][🖼️] │  │ [🖼️][🖼️] │  │ [🖼️]    │ │
│  │ [🖼️][🖼️] │  │ [🖼️][🖼️] │  │         │ │
│  ├──────────┤  ├──────────┤  ├──────────┤ │
│  │Batch #14 │  │Batch #d3 │  │Batch #5a │ │
│  │2h ago    │  │1d ago    │  │Feb 7     │ │
│  │4 images  │  │2 images  │  │1 image   │ │
│  │2 groups  │  │1 group   │  │1 group   │ │
│  │Step 3:60%│  │Step 5✓   │  │Step 4:80%│ │
│  │──────────│  │──────────│  │──────────│ │
│  │[Open]    │  │[Open]    │  │[Open]    │ │
│  │[Delete]  │  │[Delete]  │  │[Delete]  │ │
│  └──────────┘  └──────────┘  └──────────┘ │
└────────────────────────────────────────────┘
```

### What You See When You Open a Batch

If you saved at **Step 3 (Categorize):**

```
✅ Step 1: Upload Images
   → Your 6 images are all there

✅ Step 2: Group Product Images  
   → Your 3 groups are preserved
   
🔄 Step 3: Drag Groups to Categories
   → Ready for you to categorize! ← YOU ARE HERE

❌ Step 4: (Not shown yet - you haven't reached it)

❌ Step 5: (Not shown yet - you haven't reached it)
```

---

## Database Setup

**Run this migration in Supabase SQL Editor:**

```sql
-- File: supabase/migrations/create_workflow_batches.sql
-- Copy the entire file and run it in Supabase Dashboard → SQL Editor
```

**Verification:**
```sql
-- Should return the new table structure
SELECT * FROM workflow_batches LIMIT 1;

-- Should return 4 RLS policies
SELECT COUNT(*) FROM pg_policies WHERE tablename = 'workflow_batches';
```

---

## Technical Details

### What Gets Saved?

Everything in your workflow:
- ✅ All uploaded images
- ✅ Product groups
- ✅ Categories assigned
- ✅ Voice descriptions
- ✅ AI-generated content
- ✅ All product data (price, size, color, etc.)
- ✅ Current step you're on

### Where Is It Saved?

**Table:** `workflow_batches`

**Key Column:** `workflow_state` (JSONB)

```json
{
  "uploadedImages": [...all your ClothingItem objects],
  "groupedImages": [...with productGroup IDs],
  "sortedImages": [...with categories],
  "processedItems": [...with descriptions]
}
```

### How It Determines Your Current Step

```
Has processedItems? → Step 5 (Save & Export)
Has categories? → Step 4 (Add Descriptions)
Has groups? → Step 3 (Categorize)  
Has uploads? → Step 2 (Group Images)
Nothing? → Step 1 (Upload)
```

---

## Troubleshooting

### "Library is empty"
- You need to save at least one batch first
- Go through Steps 1-5 and click "💾 Save Batch"

### "Batch has no saved workflow state"
- This means the batch was created before the new system
- You can delete it and create a new one

### "Images not loading"
- Check that your Supabase Storage is set up correctly
- Verify images were uploaded to storage in Step 2

### "Can't see my old products"
- Old system saved to `products` table
- New system uses `workflow_batches` table
- They're separate (old products still exist in database)

---

## Keyboard Shortcuts

(Coming soon!)

- `L` - Open Library
- `Esc` - Close Library
- `Enter` - Open selected batch
- `Delete` - Delete selected batch

---

## Tips & Tricks

1. **Name Your Batches**
   - Click batch name to edit (coming soon!)
   - Example: "Winter Coats 2026" instead of "Batch #14149c48"

2. **Use Tags**
   - Add tags like "vintage", "streetwear", "clearance" (coming soon!)
   - Filter batches by tag

3. **Don't Lose Work**
   - Auto-save coming soon (every 30 seconds)
   - For now, manually click "Save Batch" often

4. **Organize by Progress**
   - Batches sorted by most recent first
   - Look at progress percentage to see what needs finishing

5. **Thumbnail Preview**
   - Hover over thumbnails to see larger preview (coming soon!)

---

## What's Coming Next

**Phase 2: Auto-Save**
- Saves every 30 seconds automatically
- Saves on major actions (grouping, categorizing)
- Never lose work again

**Phase 3: Drag & Drop**
- Drag products from library
- Drop onto any step (1-5)
- Merge multiple batches

**Phase 4: Better Organization**
- Rename batches
- Add tags
- Search and filter
- Sort by date/name/progress

**Phase 5: Analytics**
- Dashboard showing all batches
- Completion statistics
- Time tracking

---

## Status

✅ **Library System Live!**

**Files Created:**
- `/supabase/migrations/create_workflow_batches.sql`
- `/src/lib/workflowBatchService.ts`
- `/src/components/Library.tsx`
- `/src/components/Library.css`
- `/src/App.tsx` (updated)

**Files Removed:**
- ❌ SavedProducts.tsx (replaced by Library.tsx)

**What Works:**
- ✅ Save workflow as batch
- ✅ View batches in Library (batch-level only!)
- ✅ See thumbnails and metadata
- ✅ Track progress
- ✅ Reopen and resume workflow
- ✅ Delete batches

**Button Label Changed:**
- "📦 Saved Products" → "📦 Library"

---

## Support

If you encounter issues:

1. Check console for errors (F12 → Console tab)
2. Verify migration ran successfully in Supabase
3. Confirm RLS policies are active
4. Check that images uploaded to storage

Happy cataloging! 🎉
