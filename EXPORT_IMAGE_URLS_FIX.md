# Export Image URLs Fix

## Problem
Google Sheets export was using local blob URLs (`blob:http://localhost...`) instead of Supabase public URLs for product images. This meant exported sheets had broken image links.

## Root Cause
The `GoogleSheetExporter` component was using `item.preview` (local blob URLs) instead of `item.imageUrl` (Supabase public URLs) when building the image URLs array.

## Solution

### 1. Added `imageUrl` Field to ClothingItem Interface
**File**: `src/App.tsx`

```typescript
export interface ClothingItem {
  // ... other fields ...
  storagePath?: string; // Supabase Storage path for deletion
  imageUrl?: string; // Supabase public URL for sharing/export ← NEW
}
```

### 2. Updated GoogleSheetExporter to Prefer Supabase URLs
**File**: `src/components/GoogleSheetExporter.tsx` (line 28)

```typescript
const products = Object.values(productGroups).map(group => {
  const productData = group[0];
  return {
    ...productData,
    // Use Supabase URLs if available, otherwise fall back to preview (blob URLs)
    imageUrls: group.map(item => item.imageUrl || item.preview), // ← FIXED
    imageCount: group.length
  };
});
```

### 3. How It Works Now

#### Scenario A: Exporting Saved Products (From Database)
1. User clicks "Saved Products" button
2. Products loaded from database include `image_url` from `product_images` table
3. These are mapped to `imageUrl` field in ClothingItem
4. Export uses `imageUrl` (Supabase public URLs) ✅

#### Scenario B: Exporting Before Saving (In-Memory)
1. User processes images in Step 4
2. Items only have `preview` (blob URLs) at this point
3. Export falls back to `preview` URLs ⚠️ (These are temporary)
4. **Recommendation**: Save to database first, then export

## Image URL Flow

### During Upload (Step 1)
```
User selects image
    ↓
File uploaded to Supabase temp folder
    ↓
Gets public URL: https://...supabase.co/.../temp/abc123.jpg
    ↓
Stored in item.preview (blob URL for local display)
    ↓
Stored in item.storagePath (temp path)
```

### During Save (Step 5 - Add to Library)
```
User clicks "Add to Library"
    ↓
Images copied from temp → permanent folder
    ↓
New public URL: https://...supabase.co/.../user-id/product-id/0_timestamp.jpg
    ↓
Saved to database:
  - product_images.image_url ← Permanent Supabase URL
  - product_images.storage_path ← Permanent storage path
```

### During Export
```
User clicks "Export to Google Sheets"
    ↓
Check item.imageUrl first (Supabase URL if saved)
    ↓
Fall back to item.preview if not saved yet
    ↓
Build CSV with image URLs
```

## Best Practice

✅ **Recommended Export Flow**:
1. Upload images (Step 1)
2. Sort into categories (Step 2)
3. Group images (Step 3)
4. Add descriptions (Step 4)
5. **Add to Library** (Saves to database with Supabase URLs)
6. **Then export** to Google Sheets

❌ **Not Recommended**:
- Exporting before saving to database (will use temporary blob URLs that don't work outside the app)

## Verification

To check if export is using correct URLs:

1. Export products to Google Sheets
2. Open the CSV file
3. Check "Product image URL" column (Column 36)
4. URLs should look like:
   ```
   https://xyzproject.supabase.co/storage/v1/object/public/product-images/user-id/product-id/0_1234567890.jpg
   ```
   
NOT like:
```
blob:http://localhost:5173/abc-123-def
```

## Database Schema

### product_images Table
```sql
CREATE TABLE product_images (
  id uuid PRIMARY KEY,
  product_id uuid REFERENCES products(id),
  user_id uuid,
  image_url text,        ← Supabase public URL (permanent)
  storage_path text,     ← Storage path for deletion
  position integer,      ← Image order (0, 1, 2, ...)
  alt_text text,
  created_at timestamptz
);
```

## Future Enhancements

1. **Fetch Supabase URLs for In-Memory Items**
   - When exporting before saving, automatically fetch Supabase URLs from temp storage
   - Requires updating `uploadImageToStorage` to return and store the public URL

2. **Visual Indicator**
   - Show badge/icon indicating whether items have Supabase URLs or local URLs
   - Warn user if exporting items without permanent URLs

3. **Auto-Populate imageUrl on Upload**
   - Store Supabase temp URLs in `imageUrl` field immediately after upload
   - Ensures export always has working URLs, even before save

## Files Modified

1. **src/App.tsx**
   - Added `imageUrl?: string` to ClothingItem interface

2. **src/components/GoogleSheetExporter.tsx**
   - Changed line 28 from `item.preview` to `item.imageUrl || item.preview`
   - Now prefers Supabase URLs when available

## Testing

### Test Case 1: Export Saved Products
1. Add products to library
2. Open "Saved Products"
3. Select products and export
4. ✅ Verify CSV has Supabase URLs

### Test Case 2: Export Before Saving
1. Process images through Step 4
2. Export without saving
3. ⚠️ CSV will have blob URLs (expected, but not recommended)

### Test Case 3: Re-export After Saving
1. Process and export (gets blob URLs)
2. Save to library
3. Export again from Saved Products
4. ✅ CSV now has Supabase URLs
