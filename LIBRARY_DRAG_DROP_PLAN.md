# Library Drag & Drop System - Implementation Plan

## Overview
Transform "Saved Products" into a powerful "Library" system where users can drag saved products back into the workflow with all their saved data intact.

## User Flow

### Current Flow (Before)
```
Step 1: Upload Images
   ↓
Step 2: Group & Categorize
   ↓
Step 3: Add Descriptions
   ↓
Step 4: Export
   ↓
[Saved Products] (View only, no re-use)
```

### New Flow (After)
```
Step 1: Upload Images OR Drag from Library
   ↓
Step 2: Group & Categorize (Pre-filled if from library)
   ↓
Step 3: Add Descriptions (Pre-filled if from library)
   ↓
Step 4: Export
   ↓
[Library] ←── Can drag items back to Step 1!
```

## Features to Implement

### 1. Rename Component
- ✅ `SavedProducts` → `Library`
- ✅ "Saved Products" → "Library" in UI
- ✅ Update button text and icons

### 2. Make Library Items Draggable
```tsx
<div
  draggable={true}
  onDragStart={(e) => handleDragStart(e, product)}
  className="library-product-card draggable"
>
  <div className="drag-handle">⋮⋮</div>
  {/* Product content */}
</div>
```

### 3. Create Drop Zone in Step 1
```tsx
<div
  onDrop={handleDropFromLibrary}
  onDragOver={(e) => e.preventDefault()}
  className="drop-zone-library"
>
  Drop library items here to add to batch
</div>
```

### 4. Data Restoration
When dropped, restore ALL saved data:
- ✅ Images (from Supabase URLs)
- ✅ Category
- ✅ Title & Description
- ✅ Price, condition, size, color
- ✅ Measurements
- ✅ Tags
- ✅ All metadata

### 5. Visual Feedback
- Drag cursor: `cursor: move`
- Drop zone highlight on hover
- Loading state while fetching full data
- Success notification

## Component Structure

```
App.tsx
├── Library (new name)
│   ├── Library Grid
│   ├── Draggable Product Cards
│   └── Batch View
│
├── ImageUpload (Step 1)
│   ├── File Upload Zone
│   ├── Library Drop Zone (NEW)
│   └── Combined Images Display
│
└── ImageGrouper (Step 2)
    └── Pre-filled data from library
```

## Data Flow

### Drag from Library
```typescript
1. User drags product card
   → onDragStart: Store product ID in e.dataTransfer

2. User drops in Step 1
   → onDrop: Extract product ID
   → Fetch full product data from Supabase
   → Fetch all product images
   → Convert to ClothingItem format
   → Add to uploadedImages state

3. Product appears in workflow
   → Images loaded
   → Category pre-selected
   → All fields pre-filled
```

### ClothingItem Structure
```typescript
interface ClothingItem {
  id: string;
  file?: File;  // Optional for library items
  preview: string;  // Supabase URL for library items
  imageUrl?: string;  // Supabase URL
  groupId?: string;
  category?: string;
  
  // All saved data
  title?: string;
  description?: string;
  price?: number;
  condition?: string;
  size?: string;
  color?: string;
  measurements?: {...};
  tags?: string[];
  // ... etc
  
  // Source tracking
  fromLibrary?: boolean;  // NEW
  libraryProductId?: string;  // NEW
}
```

## Implementation Steps

### Phase 1: Rename & Basic Structure
1. ✅ Rename component files
2. ✅ Update imports
3. ✅ Change UI text
4. ✅ Update icons

### Phase 2: Drag System
1. ✅ Add draggable attribute to library cards
2. ✅ Implement onDragStart handler
3. ✅ Store product data in drag event
4. ✅ Visual drag feedback

### Phase 3: Drop Zone
1. ✅ Create drop zone in ImageUpload
2. ✅ Implement onDrop handler
3. ✅ Fetch full product data
4. ✅ Convert to ClothingItem format
5. ✅ Add to workflow

### Phase 4: Data Restoration
1. ✅ Fetch product images from Supabase
2. ✅ Restore all metadata
3. ✅ Pre-fill forms in Step 2/3
4. ✅ Mark as from library

### Phase 5: UX Polish
1. ✅ Drag cursor styles
2. ✅ Drop zone highlight
3. ✅ Loading animation
4. ✅ Success notification
5. ✅ Error handling

## Database Schema

No schema changes needed! Use existing:
- `products` table (all product data)
- `product_images` table (image URLs)

## API Functions Needed

### Fetch Full Product
```typescript
async function fetchProductWithImages(productId: string) {
  // Get product data
  const product = await supabase
    .from('products')
    .select(`
      *,
      product_images (*)
    `)
    .eq('id', productId)
    .single();
    
  return product;
}
```

### Convert to ClothingItem
```typescript
function convertProductToClothingItem(product: Product): ClothingItem {
  return {
    id: `library-${product.id}`,
    preview: product.product_images[0]?.image_url,
    imageUrl: product.product_images[0]?.image_url,
    category: product.category,
    title: product.title,
    description: product.description,
    price: product.price,
    condition: product.condition,
    size: product.size,
    color: product.color,
    // ... all other fields
    fromLibrary: true,
    libraryProductId: product.id,
  };
}
```

## UI Mockup

### Library View
```
┌─────────────────────────────────────────────────────┐
│  Library (127)                              [Close] │
├─────────────────────────────────────────────────────┤
│                                                     │
│  [Products] [Batches]                     [Search] │
│                                                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐        │
│  │ ⋮⋮       │  │ ⋮⋮       │  │ ⋮⋮       │        │
│  │ [Image]  │  │ [Image]  │  │ [Image]  │        │
│  │ Vintage  │  │ Supreme  │  │ Levi's   │        │
│  │ Tee      │  │ Hoodie   │  │ 501s     │        │
│  │ $45      │  │ $120     │  │ $85      │        │
│  │ [Delete] │  │ [Delete] │  │ [Delete] │        │
│  └──────────┘  └──────────┘  └──────────┘        │
│                                                     │
│  Drag items to Step 1 to add them to a new batch  │
└─────────────────────────────────────────────────────┘
```

### Drop Zone in Step 1
```
┌─────────────────────────────────────────────────────┐
│  Step 1: Upload Images                              │
├─────────────────────────────────────────────────────┤
│                                                     │
│  ┌───────────────────────────────────────────────┐ │
│  │   Drop images here or click to browse         │ │
│  └───────────────────────────────────────────────┘ │
│                                                     │
│  ─────────────────  OR  ─────────────────          │
│                                                     │
│  ┌───────────────────────────────────────────────┐ │
│  │   📚 Drag from Library to add saved products  │ │
│  │                                                │ │
│  │   [Drag zone - highlights on hover]           │ │
│  └───────────────────────────────────────────────┘ │
│                                                     │
└─────────────────────────────────────────────────────┘
```

## Benefits

✅ **Re-use Products** - Don't re-enter data  
✅ **Quick Batching** - Combine old + new items  
✅ **Edit & Re-export** - Update and re-publish  
✅ **Duplicate Workflow** - Clone successful listings  
✅ **Flexible Workflows** - Mix library & new uploads  
✅ **Time Saving** - Massive efficiency gain  

## Technical Considerations

### Performance
- Lazy load library images
- Virtual scrolling for large libraries
- Debounce drag events

### Data Consistency
- Verify image URLs still valid
- Handle missing images gracefully
- Update library items if edited in workflow

### Edge Cases
- Drop during processing
- Network errors during fetch
- Duplicate items in batch
- Missing product data

## Success Criteria

✅ Can drag library items smoothly  
✅ Drop zone provides clear feedback  
✅ All product data restored correctly  
✅ Images load from Supabase URLs  
✅ Pre-fills all forms in workflow  
✅ No data loss  
✅ Fast and responsive  
✅ Works with touch devices (future)  

This turns the Library into a powerful content management system! 🎯
