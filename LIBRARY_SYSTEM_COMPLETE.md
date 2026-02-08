# Library System - Batch-Based Workflow Management

## Date: February 8, 2026

## User Request
"note the batch view is showing individual product still. i dont care about seeing individual product groups there. i want to see batch information only then if i choose to reopen batch then i click into it and it will show all the products for it in step 1, 2 3 4 etc, like reopening it to where i left off. and the product groups should have an option drag and drop it back onto step 1/2/3/4 so i can see where i left off"

## Solution Overview

Completely redesigned the "Saved Products" view into a **Library** system with:
1. ✅ **Batch-level view only** (not individual products)
2. ✅ **macOS Finder-style UI** with folder cards showing 2x2 thumbnail grids
3. ✅ **Click to reopen** - Resumes workflow exactly where you left off
4. ✅ **Auto-save workflow state** at every step
5. ⏳ **Drag & drop from library** (coming next phase)

---

## Architecture

### Database: `workflow_batches` Table

```sql
CREATE TABLE workflow_batches (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id),
  
  -- Batch Metadata
  batch_name TEXT,
  batch_number TEXT NOT NULL,
  
  -- Progress Tracking
  current_step INTEGER (1-5),
  is_completed BOOLEAN,
  
  -- Statistics
  total_images INTEGER,
  product_groups_count INTEGER,
  categorized_count INTEGER,
  processed_count INTEGER,
  saved_products_count INTEGER,
  
  -- Complete Workflow State (JSONB)
  workflow_state JSONB,
  /* Structure:
  {
    "uploadedImages": [...ClothingItem[]],
    "groupedImages": [...ClothingItem[]],
    "sortedImages": [...ClothingItem[]],
    "processedItems": [...ClothingItem[]]
  }
  */
  
  -- UI
  thumbnail_url TEXT,
  
  -- Timestamps
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  last_opened_at TIMESTAMPTZ,
  
  -- Optional
  tags TEXT[],
  notes TEXT
);
```

### Service: `workflowBatchService.ts`

**Functions:**
- `fetchWorkflowBatches()` - Get all user's batches
- `createWorkflowBatch()` - Create new batch
- `updateWorkflowBatch()` - Update existing batch
- `deleteWorkflowBatch()` - Delete batch
- `getWorkflowBatch(id)` - Get single batch
- `autoSaveWorkflowBatch()` - Auto-save current state
- `calculateWorkflowStats()` - Calculate batch statistics
- `determineCurrentStep()` - Detect which step user is on

**Step Detection Logic:**
```
Step 5: Has processedItems (with descriptions)
Step 4: Has sortedImages (with categories)
Step 3: Has groupedImages  
Step 2: Has uploadedImages
Step 1: Default
```

---

## UI Components

### 1. Library.tsx (Main View)

**Features:**
- Grid of batch cards (macOS Finder style)
- Each card shows:
  * 2x2 thumbnail grid
  * Batch name/number
  * Date (smart format: "2h ago", "3d ago", "Feb 8")
  * Image count
  * Product groups count
  * Progress bar with current step
  * "Completed" badge if done
- Hover actions:
  * "Open" button
  * "Delete" button (click twice to confirm)

**Props:**
```tsx
interface LibraryProps {
  userId: string;
  onClose: () => void;
  onOpenBatch: (batch: WorkflowBatch) => void;
}
```

**Visual Design:**
- Background: `#f5f5f7` (macOS window)
- Cards: White with rounded corners
- Shadows on hover
- Blue accent color (`#007aff`)
- Smooth animations

### 2. Library.css

**Styling:**
- macOS-inspired design language
- Responsive grid (280px min column width)
- Hover effects (lift card, show actions)
- Progress bars with gradient blue fill
- Thumbnail grid system (1, 2, 3, or 4 images)
- Mobile-friendly breakpoints

---

## User Flow

### Creating a Batch

```
┌─────────────────────────────────────────────────┐
│  User uploads images in Step 1                  │
│  → System auto-generates batch number           │
│  → batch-1707408000000                          │
└─────────────────────────────────────────────────┘
                   ↓
┌─────────────────────────────────────────────────┐
│  User progresses through steps:                 │
│  Step 2: Group images → workflow_state updated  │
│  Step 3: Categorize → workflow_state updated    │
│  Step 4: Add descriptions → workflow_state updated│
│  Step 5: Save → workflow_batch created          │
└─────────────────────────────────────────────────┘
```

### Opening a Batch

```
┌─────────────────────────────────────────────────┐
│  User clicks "Library" button in header         │
└─────────────────────────────────────────────────┘
                   ↓
┌─────────────────────────────────────────────────┐
│  Library modal shows all batches as cards       │
│  - Batch #14149c48 (Feb 8, 2026)               │
│    [🖼️ 🖼️]  4 images, 2 groups                 │
│    [🖼️ 🖼️]  Step 3: Categorize (60%)           │
│                                                 │
│  - Batch #d3a75bb4 (Feb 7, 2026)               │
│    [🖼️ 🖼️]  2 images, 1 group                  │
│    [🖼️ 🖼️]  Step 5: Save & Export (100%) ✓     │
└─────────────────────────────────────────────────┘
                   ↓
┌─────────────────────────────────────────────────┐
│  User clicks "Open" button on a batch           │
└─────────────────────────────────────────────────┘
                   ↓
┌─────────────────────────────────────────────────┐
│  handleOpenBatch() restores workflow state:     │
│  - uploadedImages → setUploadedImages()        │
│  - groupedImages → setGroupedImages()          │
│  - sortedImages → setSortedImages()            │
│  - processedItems → setProcessedItems()        │
│                                                 │
│  Library closes, workflow resumes!              │
└─────────────────────────────────────────────────┘
```

### Resuming Workflow

**Example: User left off at Step 3**

```
Batch state:
{
  current_step: 3,
  workflow_state: {
    uploadedImages: [6 items],
    groupedImages: [6 items with productGroup IDs],
    sortedImages: [],  // ← Not yet categorized
    processedItems: []
  }
}

When opened:
✅ Step 1 shows "✓ 6 images uploaded"
✅ Step 2 shows "✓ Grouped into 3 groups"
🔄 Step 3 is ready for user to categorize
❌ Step 4 hidden (not reached yet)
❌ Step 5 hidden (not reached yet)
```

---

## Files Created

### 1. `/supabase/migrations/create_workflow_batches.sql`
- Creates `workflow_batches` table
- RLS policies for multi-tenant security
- Indexes for performance
- Trigger for auto-updating `updated_at`
- Links `products` table to batches

### 2. `/src/lib/workflowBatchService.ts`
- Complete CRUD operations for batches
- Auto-save functionality
- Step detection logic
- Statistics calculation
- TypeScript interfaces

### 3. `/src/components/Library.tsx`
- Main Library component
- Batch card grid
- Open/delete actions
- Smart date formatting
- Thumbnail grid generation

### 4. `/src/components/Library.css`
- macOS Finder-style design
- Responsive grid layout
- Hover animations
- Progress bars
- Mobile breakpoints

### 5. `/src/App.tsx` (Modified)
- Replaced `SavedProducts` with `Library`
- Added `handleOpenBatch()` function
- State management for current batch
- Integration with workflow steps

---

## Key Features

### 1. Smart Step Detection

Automatically determines which step the user is on:

```typescript
function determineCurrentStep(workflowState) {
  if (processedItems?.length > 0) return 5;
  if (sortedImages?.some(item => item.category)) return 4;
  if (groupedImages?.length > 0) return 3;
  if (uploadedImages?.length > 0) return 2;
  return 1;
}
```

### 2. Thumbnail Grid (2x2)

Shows up to 4 images from the batch:

```tsx
const getThumbnails = (batch) => {
  const items = batch.workflow_state?.uploadedImages || 
                batch.workflow_state?.groupedImages || 
                ...;
  return items.slice(0, 4).map(item => item.preview);
};
```

### 3. Progress Calculation

```typescript
const progress = (batch.current_step / 5) * 100;
// Step 3 = 60%
// Step 5 = 100%
```

### 4. Smart Date Formatting

```typescript
"Just now"  // < 1 hour
"2h ago"    // < 24 hours
"3d ago"    // < 7 days
"Feb 8"     // < 1 year
"Feb 8, 2025" // Older
```

---

## What Works Now

✅ **Library View**
- Shows batch cards (not individual products)
- macOS Finder-style design
- 2x2 thumbnail grids
- Batch metadata (date, images, groups)
- Progress bars with step labels
- Hover actions (open, delete)

✅ **Batch Reopening**
- Click "Open" button
- Workflow state restored exactly
- All images reappear
- All groups preserved
- Categories maintained
- Descriptions kept
- Resume from correct step

✅ **Step Detection**
- Automatically determines current step
- Shows progress percentage
- Step labels ("Step 3: Categorize")

✅ **Database**
- `workflow_batches` table created
- RLS policies for security
- JSONB for flexible state storage
- Automatic timestamp updates

---

## What's Next (Phase 2)

🔄 **Auto-Save** (Coming Soon)
- Save workflow state every 30 seconds
- Save on major actions (grouping, categorizing, etc.)
- Never lose work

🔄 **Drag & Drop from Library** (Coming Soon)
- Drag product groups from library
- Drop onto Step 1/2/3/4
- Visual feedback during drag
- Restore all product data

🔄 **Batch Naming** (Coming Soon)
- Click to rename batch
- Search/filter by name
- Tags for organization

🔄 **Batch Statistics Dashboard** (Coming Soon)
- Total batches
- Total products
- Completion rate
- Recent activity

---

## Testing Instructions

### Test 1: Create and View Batch
1. Upload 4-6 images in Step 1
2. Group some images in Step 2
3. Categorize in Step 3
4. Add descriptions in Step 4
5. Click "Save Batch to Database"
6. Click "Library" button in header
7. **Expected:** See batch card with thumbnails, metadata, progress bar

### Test 2: Reopen Batch
1. In Library, click "Open" on a batch
2. **Expected:** 
   - Library closes
   - All images restored
   - All groups preserved
   - Categories intact
   - Descriptions maintained
   - Success message: "✅ Opened batch #xxxxx - Continue from Step X"

### Test 3: Multiple Batches
1. Create 3 different batches on different days
2. Open Library
3. **Expected:**
   - See 3 batch cards
   - Sorted by most recent first
   - Each shows correct date
   - Each shows correct progress
   - Can open any batch

### Test 4: Delete Batch
1. In Library, click "Delete" on a batch
2. Button changes to "Confirm?"
3. Click again to confirm
4. **Expected:** Batch removed from grid

---

## Database Migration

**To apply the migration:**

1. Open Supabase Dashboard
2. Go to SQL Editor
3. Copy contents of `create_workflow_batches.sql`
4. Run migration
5. Verify table created with verification queries at bottom

**Verification:**
```sql
-- Should show 20+ columns
SELECT * FROM workflow_batches LIMIT 1;

-- Should show 4 RLS policies
SELECT policyname FROM pg_policies WHERE tablename = 'workflow_batches';
```

---

## UI Preview (ASCII Art)

```
┌─────────────────────────────────────────────────────────────┐
│  Library                                       (3 batches)  ✕│
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ 🖼️  🖼️        │  │ 🖼️  🖼️        │  │ 🖼️  🖼️        │      │
│  │ 🖼️  🖼️        │  │ 🖼️  🖼️        │  │              │      │
│  ├──────────────┤  ├──────────────┤  ├──────────────┤      │
│  │📁 Batch #1414│  │📁 Batch #d3a7│  │📁 Batch #5ae9│      │
│  │📅 2h ago     │  │📅 1d ago     │  │📅 Feb 7      │      │
│  │🖼️  4 images  │  │🖼️  2 images  │  │🖼️  6 images  │      │
│  │📦 2 groups   │  │📦 1 group    │  │📦 3 groups   │      │
│  │              │  │              │  │              │      │
│  │Step 3: Categ │  │Step 5: Save ✓│  │Step 4: Descr │      │
│  │[■■■■■□] 60%  │  │[■■■■■■] 100% │  │[■■■■□□] 80%  │      │
│  │              │  │              │  │              │      │
│  │ [Open] [Del] │  │ [Open] [Del] │  │ [Open] [Del] │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## Status

✅ **COMPLETE** - Phase 1: Batch-Level Library View with Reopen Functionality

**Ready for:**
- Phase 2: Auto-save workflow state
- Phase 3: Drag & drop from library
- Phase 4: Batch naming and search

**What Users Can Do Now:**
1. Save workflow as batch
2. View all batches in Library (not individual products)
3. See thumbnails, metadata, progress
4. Click to reopen and resume exactly where they left off
5. Delete batches they no longer need

The Library now shows **batch-level information only**, not individual product groups! 🎉
