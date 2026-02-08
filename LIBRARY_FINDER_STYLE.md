# Library - macOS Finder Style Interface

## Overview
Transform the Library into a macOS Finder-style interface where batches appear as folders with previews, and clicking into them resumes the exact workflow state.

## Current vs New Design

### Current (Before)
```
┌─────────────────────────────────────┐
│  Saved Products                     │
├─────────────────────────────────────┤
│  ┌─────────┐  ┌─────────┐          │
│  │ Product │  │ Product │          │
│  │ Card    │  │ Card    │          │
│  └─────────┘  └─────────┘          │
└─────────────────────────────────────┘
```

### New (macOS Finder Style)
```
┌─────────────────────────────────────┐
│  📚 Library                          │
├─────────────────────────────────────┤
│  ┌─────────┐  ┌─────────┐          │
│  │  📁     │  │  📁     │          │
│  │ [Grid]  │  │ [Grid]  │          │
│  │ Batch 1 │  │ Batch 2 │          │
│  │ Jan 15  │  │ Jan 14  │          │
│  │ 12 items│  │ 8 items │          │
│  └─────────┘  └─────────┘          │
└─────────────────────────────────────┘

Click on Batch 1 →

┌─────────────────────────────────────┐
│  📚 Library › Batch 1               │
├─────────────────────────────────────┤
│  ← Back to Library                  │
│                                     │
│  Created: Jan 15, 2026              │
│  Status: Step 3 (Descriptions)      │
│  Items: 12 products                 │
│                                     │
│  ┌─────────────────────────────┐   │
│  │  🔄 Resume from Step 3      │   │
│  │     Continue where you      │   │
│  │     left off                │   │
│  └─────────────────────────────┘   │
│                                     │
│  Quick Actions:                     │
│  ┌───────┐ ┌───────┐ ┌───────┐   │
│  │Step 2 │ │Step 3 │ │Step 4 │   │
│  │Group  │ │Descrip│ │Export │   │
│  └───────┘ └───────┘ └───────┘   │
│                                     │
│  Preview (12 items):               │
│  ┌───┐ ┌───┐ ┌───┐ ┌───┐        │
│  │img│ │img│ │img│ │img│ ...    │
│  └───┘ └───┘ └───┘ └───┘        │
└─────────────────────────────────────┘
```

## Features

### 1. Finder-Style Grid View
- **Folder Cards**: Each batch = folder
- **Preview Grid**: 2x2 thumbnail grid of first 4 images
- **Metadata**: Date, item count, status
- **Hover Effect**: Preview expands, shows more info

### 2. Batch Detail View
- **Breadcrumb**: "Library › Batch Name"
- **Status Indicator**: Which step (Step 2, 3, 4, 5)
- **Resume Button**: Big CTA to continue
- **Quick Actions**: Jump to specific step
- **Full Preview**: All images in batch
- **Edit Metadata**: Rename, add notes

### 3. State Restoration
When clicking "Resume":
```typescript
1. Load all batch data from database
2. Reconstruct workflow state:
   - uploadedImages
   - groupedImages
   - sortedImages  
   - processedItems
3. Navigate to correct step
4. Restore all form data
5. User continues from there
```

### 4. Step Detection
Automatically detect which step to resume from:
```
- No categories → Resume at Step 2 (Categorization)
- Has categories, no descriptions → Resume at Step 3
- Has descriptions, not exported → Resume at Step 4
- Already exported → View/Edit mode
```

## Component Structure

```
Library/
├── LibraryGrid (List view)
│   ├── BatchFolderCard (Each batch)
│   │   ├── Thumbnail Grid (2x2)
│   │   ├── Batch Name
│   │   ├── Date
│   │   ├── Item Count
│   │   └── Status Badge
│   └── EmptyState
│
└── BatchDetail (Detail view)
    ├── Breadcrumb
    ├── BatchHeader
    │   ├── Status Indicator
    │   ├── Resume Button
    │   └── Quick Actions
    ├── BatchMetadata
    │   ├── Created Date
    │   ├── Last Modified
    │   ├── Item Count
    │   └── Notes
    └── ItemsPreview
        └── Image Grid (all items)
```

## Database Schema Updates

### Batches Table (New)
```sql
CREATE TABLE batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  
  -- Basic Info
  name TEXT NOT NULL,
  notes TEXT,
  
  -- Status Tracking
  current_step INT DEFAULT 1, -- 1=Upload, 2=Group, 3=Describe, 4=Export
  is_complete BOOLEAN DEFAULT false,
  
  -- Metadata
  item_count INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  last_opened_at TIMESTAMPTZ,
  
  -- Workflow State (JSONB)
  workflow_state JSONB DEFAULT '{}'::jsonb,
  -- Stores: { uploadedImages, groupedImages, currentStep, etc }
  
  CONSTRAINT batches_user_id_fkey FOREIGN KEY (user_id)
    REFERENCES auth.users(id) ON DELETE CASCADE
);

CREATE INDEX idx_batches_user_id ON batches(user_id);
CREATE INDEX idx_batches_updated_at ON batches(updated_at DESC);
```

### Update Products Table
```sql
ALTER TABLE products 
ADD COLUMN batch_id UUID REFERENCES batches(id) ON DELETE SET NULL;

CREATE INDEX idx_products_batch_id ON products(batch_id);
```

## Workflow State Storage

### What to Save
```typescript
interface WorkflowState {
  currentStep: 1 | 2 | 3 | 4;
  
  // Images at each stage
  uploadedImages: ClothingItem[];
  sortedImages: ClothingItem[];
  groupedImages: ClothingItem[];
  processedItems: ClothingItem[];
  
  // Current selections
  currentGroupIndex: number;
  selectedPresetId: string;
  
  // Progress flags
  hasSorted: boolean;
  hasGrouped: boolean;
  hasDescribed: boolean;
  hasExported: boolean;
}
```

### Auto-Save Triggers
- On category selection
- On grouping
- On description entry
- Every 30 seconds (debounced)
- On navigation away

## UI Implementation

### Batch Folder Card
```tsx
<div className="batch-folder-card" onClick={() => openBatch(batch)}>
  {/* Thumbnail Grid (2x2) */}
  <div className="batch-thumbnail-grid">
    <img src={images[0]} />
    <img src={images[1]} />
    <img src={images[2]} />
    <img src={images[3]} />
    {itemCount > 4 && (
      <div className="more-count">+{itemCount - 4}</div>
    )}
  </div>
  
  {/* Metadata */}
  <div className="batch-meta">
    <h3>{batch.name || 'Untitled Batch'}</h3>
    <div className="batch-date">{formatDate(batch.created_at)}</div>
    <div className="batch-stats">
      {batch.item_count} items • {getStepName(batch.current_step)}
    </div>
  </div>
  
  {/* Status Badge */}
  <div className={`status-badge step-${batch.current_step}`}>
    {getStepBadge(batch.current_step)}
  </div>
</div>
```

### Batch Detail View
```tsx
<div className="batch-detail">
  {/* Breadcrumb */}
  <div className="breadcrumb">
    <span onClick={goBackToLibrary}>📚 Library</span>
    <span className="separator">›</span>
    <span className="current">{batch.name}</span>
  </div>
  
  {/* Big Resume Button */}
  <button 
    className="resume-button-large"
    onClick={() => resumeBatch(batch)}
  >
    <div className="icon">🔄</div>
    <div className="text">
      <div className="title">Resume from Step {batch.current_step}</div>
      <div className="subtitle">Continue where you left off</div>
    </div>
  </button>
  
  {/* Quick Actions */}
  <div className="quick-actions">
    <button onClick={() => jumpToStep(2)}>
      <span>Step 2</span>
      <span>Categorize</span>
    </button>
    <button onClick={() => jumpToStep(3)}>
      <span>Step 3</span>
      <span>Describe</span>
    </button>
    <button onClick={() => jumpToStep(4)}>
      <span>Step 4</span>
      <span>Export</span>
    </button>
  </div>
  
  {/* Image Preview */}
  <div className="batch-images-preview">
    <h4>Items ({batch.item_count})</h4>
    <div className="images-grid">
      {images.map(img => (
        <img key={img.id} src={img.url} />
      ))}
    </div>
  </div>
</div>
```

## State Restoration Flow

### 1. Load Batch Data
```typescript
async function loadBatch(batchId: string) {
  // Fetch batch metadata
  const batch = await supabase
    .from('batches')
    .select('*')
    .eq('id', batchId)
    .single();
  
  // Fetch all products in batch
  const products = await supabase
    .from('products')
    .select(`
      *,
      product_images (*)
    `)
    .eq('batch_id', batchId);
  
  // Parse workflow state
  const workflowState = batch.workflow_state;
  
  return { batch, products, workflowState };
}
```

### 2. Reconstruct App State
```typescript
function resumeBatch(batch: Batch) {
  const { products, workflowState } = loadBatch(batch.id);
  
  // Convert products to ClothingItems
  const items = products.map(convertToClothingItem);
  
  // Restore state
  setUploadedImages(workflowState.uploadedImages || items);
  setSortedImages(workflowState.sortedImages || []);
  setGroupedImages(workflowState.groupedImages || []);
  setProcessedItems(workflowState.processedItems || []);
  
  // Navigate to correct step
  setCurrentStep(batch.current_step);
  
  // Update last opened
  await supabase
    .from('batches')
    .update({ last_opened_at: new Date() })
    .eq('id', batch.id);
}
```

### 3. Auto-Save Progress
```typescript
async function saveBatchState(batchId: string) {
  const workflowState = {
    currentStep,
    uploadedImages,
    sortedImages,
    groupedImages,
    processedItems,
    currentGroupIndex,
    selectedPresetId,
  };
  
  await supabase
    .from('batches')
    .update({
      current_step: currentStep,
      workflow_state: workflowState,
      updated_at: new Date(),
    })
    .eq('id', batchId);
}
```

## Visual Design (macOS Finder Style)

### Colors
- Background: `#f5f5f7` (Apple light gray)
- Cards: `#ffffff` with shadow
- Hover: Subtle lift + shadow
- Selected: Blue border
- Status badges: Color-coded by step

### Typography
- Titles: SF Pro Display (or system-ui)
- Body: SF Pro Text
- Sizes: 14px base, 18px titles

### Spacing
- Grid: 16px gap
- Cards: 12px padding
- Margins: 24px around sections

### Animations
- Hover: transform scale(1.02)
- Click: transform scale(0.98)
- Navigation: Slide transition
- Loading: Skeleton shimmer

## File Structure

```
src/components/
├── Library/
│   ├── Library.tsx (Main container)
│   ├── LibraryGrid.tsx (Folder grid view)
│   ├── BatchFolderCard.tsx (Individual folder)
│   ├── BatchDetail.tsx (Detail view)
│   ├── BatchHeader.tsx
│   ├── QuickActions.tsx
│   └── Library.css
│
src/lib/
├── batchService.ts (CRUD operations)
└── batchStateManager.ts (State save/restore)
```

## Migration Path

### Phase 1: Database Setup
1. Create `batches` table
2. Update `products` table
3. Migrate existing products to batches

### Phase 2: UI Components
1. Build LibraryGrid
2. Build BatchFolderCard
3. Build BatchDetail
4. Style with Finder aesthetics

### Phase 3: State Management
1. Implement auto-save
2. Implement state restoration
3. Handle edge cases

### Phase 4: Integration
1. Connect to main App
2. Add navigation
3. Test workflows

## Success Criteria

✅ Looks like macOS Finder  
✅ Batches appear as folders  
✅ Click to see detail view  
✅ Resume from exact step  
✅ Auto-saves progress  
✅ Fast and responsive  
✅ No data loss  
✅ Beautiful animations  

This will transform the Library into a professional content management system! 🎯
