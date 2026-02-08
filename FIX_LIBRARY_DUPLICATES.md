# Fix: Library Duplicates in Product Groups and Images

## Problem
The Library was showing duplicate entries for both Product Groups and Images. The same products and images appeared multiple times in the list.

## Root Cause

The Library loads data from **two sources**:

1. **workflow_batches.workflow_state** (JSONB field)
   - Contains in-progress work (uploaded images, grouped items, processed items)
   - Data stays here throughout the workflow

2. **Database tables** (products, product_images)
   - Contains saved/finalized products
   - Data is written here when user completes the workflow

### The Duplication Issue

When a user completes a workflow and saves products:
- Products are written to the `products` table
- Images are written to the `product_images` table
- BUT the data also remains in `workflow_batches.workflow_state`
- Result: The Library loads the same items from BOTH sources → duplicates

### Previous Deduplication Logic (Inadequate)

**Product Groups**:
```typescript
// Deduped by ID only
const uniqueGroups = Array.from(
  new Map(groups.map(g => [g.id, g])).values()
);
```
- Problem: IDs from workflow_state differ from database IDs
- Different IDs = no deduplication

**Images**:
```typescript
// Deduped by preview URL
const uniqueImages = Array.from(
  new Map(imageList.map(img => [img.preview, img])).values()
);
```
- Problem: URLs might have different formats (query params, trailing slashes, case)
- Different URL strings = no deduplication

## Solution

### 1. Added `isSaved` Flag to Interfaces

```typescript
interface ProductGroup {
  id: string;
  title: string;
  category: string;
  images: string[];
  itemCount: number;
  createdAt: string;
  isSaved?: boolean; // NEW: Track if from database vs workflow_state
}

interface ImageRecord {
  id: string;
  preview: string;
  category?: string;
  productGroup?: string;
  batchNumber?: string;
  createdAt: string;
  isSaved?: boolean; // NEW: Track if from database vs workflow_state
}
```

### 2. Improved Product Groups Deduplication

**Strategy**: Use `title + category` as deduplication key, prefer saved products

```typescript
// 2. Load saved products from database
const savedProducts = await fetchSavedProducts();
savedProducts.forEach((product: any) => {
  groups.push({
    id: product.id,
    title: product.title || product.seo_title || 'Untitled Product',
    category: product.product_category || 'Uncategorized',
    images: (product.product_images || [])
      .sort((a: any, b: any) => a.position - b.position)
      .map((img: any) => img.image_url)
      .filter(Boolean),
    itemCount: product.product_images?.length || 0,
    createdAt: product.created_at,
    isSaved: true, // Mark as saved
  });
});

// Remove duplicates - prefer saved products over workflow state
// Use title + category as dedup key since IDs might differ
const groupMap = new Map<string, ProductGroup>();
groups.forEach(group => {
  const key = `${group.title}-${group.category}`.toLowerCase();
  const existing = groupMap.get(key);
  
  // If no existing, or existing is not saved but this one is, use this one
  if (!existing || (!existing.isSaved && group.isSaved)) {
    groupMap.set(key, group);
  }
});

setProductGroups(Array.from(groupMap.values()));
```

**Key improvements**:
- Uses semantic key: `title + category` (case-insensitive)
- Prefers saved products over workflow state versions
- Handles products with same title/category correctly

### 3. Improved Images Deduplication

**Strategy**: Normalize URLs, prefer saved images

```typescript
// 2. Load saved images from database
const savedImages = await fetchSavedImages();
savedImages.forEach((img: any) => {
  imageList.push({
    id: img.id,
    preview: img.image_url,
    category: img.products?.product_category,
    productGroup: img.products?.id,
    batchNumber: img.products?.batch_id,
    createdAt: img.created_at,
    isSaved: true, // Mark as saved
  });
});

// Remove duplicates - prefer saved images over workflow state
// Normalize URLs for comparison (remove query params, trailing slashes)
const imageMap = new Map<string, ImageRecord>();
imageList.forEach(img => {
  if (!img.preview) return; // Skip images without preview
  
  // Normalize URL for comparison
  const normalizedUrl = img.preview.split('?')[0].replace(/\/$/, '').toLowerCase();
  const existing = imageMap.get(normalizedUrl);
  
  // If no existing, or existing is not saved but this one is, use this one
  if (!existing || (!existing.isSaved && img.isSaved)) {
    imageMap.set(normalizedUrl, img);
  }
});

setImages(Array.from(imageMap.values()));
```

**Key improvements**:
- **URL normalization**:
  - Removes query parameters: `image.jpg?token=123` → `image.jpg`
  - Removes trailing slashes: `image.jpg/` → `image.jpg`
  - Converts to lowercase for case-insensitive comparison
- Prefers saved images over workflow state versions
- Skips images without preview URLs

## How It Works

### Deduplication Priority System

When duplicates are found:
1. **Saved items** (from database) take priority
2. **Workflow items** (from workflow_state) are used only if no saved version exists

### Example Scenario

**Before Fix**:
```
Product Groups: 10 items
- 5 from workflow_state (IDs: ws-1, ws-2, ws-3, ws-4, ws-5)
- 5 from database (IDs: db-1, db-2, db-3, db-4, db-5)
- Same products, different IDs
- Result: Shows 10 items (5 duplicates)
```

**After Fix**:
```
Product Groups: 5 items
- Dedup key: "blue-jeans-pants", "red-shirt-tops", etc.
- ws-1 and db-1 have same key → keep db-1 (saved)
- ws-2 and db-2 have same key → keep db-2 (saved)
- Result: Shows 5 items (no duplicates)
```

## Benefits

✅ **No More Duplicates**: Each unique product/image appears only once
✅ **Prefer Saved Data**: Shows finalized versions from database
✅ **Smart Deduplication**: Uses semantic matching (title+category for products, normalized URLs for images)
✅ **Handles Edge Cases**: Different URL formats, case variations, query parameters
✅ **Backwards Compatible**: Still shows workflow_state items if not yet saved

## Testing

### Manual Test Cases

1. **Complete Workflow and Check Library**
   - Complete a workflow with 5 products
   - Save to Shopify
   - Open Library → Product Groups view
   - Should see 5 products, not 10

2. **Check Images View**
   - Complete workflow with 20 images
   - Save products
   - Open Library → Images view
   - Should see 20 images, not 40

3. **Mix of Saved and Unsaved**
   - Complete one workflow, save it (5 products)
   - Complete another workflow, don't save it (3 products)
   - Library should show 8 products total
   - First 5 from database, last 3 from workflow_state

4. **Similar Product Names**
   - Create two products: "Blue Shirt" (category: Tops)
   - Create another: "Blue Shirt" (category: Pants)
   - Should show both (different categories)
   - Not deduplicated because different category

5. **URL Variations**
   - Same image with different URLs:
     - `https://storage.com/image.jpg`
     - `https://storage.com/image.jpg?token=abc`
     - `https://storage.com/IMAGE.jpg/`
   - Should appear as single image (normalized to same key)

## Technical Details

### Deduplication Keys

**Product Groups**: `${title}-${category}` (lowercase)
- Example: `blue-jeans-pants`
- Unique per title+category combination
- Case-insensitive

**Images**: Normalized URL
- Example: `https://storage.com/image.jpg`
- Removes: query params (`?...`), trailing slashes, case variations
- Case-insensitive

### Priority Logic

```typescript
if (!existing || (!existing.isSaved && item.isSaved)) {
  map.set(key, item);
}
```

This means:
- If no item with this key exists → add it
- If existing item is from workflow_state AND new item is saved → replace with saved version
- If existing item is saved → keep it (don't replace)

## Related Files
- `src/components/Library.tsx` - Main implementation (lines 17-35, 141-160, 192-222)
- `src/lib/libraryService.ts` - Data fetching functions

## Status
✅ **FIXED** - Duplicates eliminated using smart deduplication with priority for saved data
