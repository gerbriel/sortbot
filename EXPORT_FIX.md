# Export Fix - Product Grouping Implementation

## Date: February 2, 2026

## Problem Statement
The export showed 8 items when there were only a few actual products because it was counting individual photos instead of product groups.

## Core Understanding
- **Photos** = Individual uploaded images
- **Groups** = Products (multiple photos OR single photo)
- **Export** = Should count GROUPS as products, not photos

Example:
- Upload 8 photos
- Create 2 groups (Group A has 4 photos, Group B has 2 photos)
- 2 photos remain ungrouped
- **Result**: 4 products to export (2 groups + 2 individual photos)

## Changes Made

### File: `GoogleSheetExporter.tsx`

#### 1. Product Grouping Logic
**Added:**
```typescript
// Group items by productGroup - each group is ONE product
const productGroups = items.reduce((groups, item) => {
  const groupId = item.productGroup || item.id; // If no group, item becomes its own product
  if (!groups[groupId]) {
    groups[groupId] = [];
  }
  groups[groupId].push(item);
  return groups;
}, {} as Record<string, ClothingItem[]>);

const products = Object.values(productGroups).map(group => {
  // Use the first item in the group as the product data (all should have same data)
  const productData = group[0];
  return {
    ...productData,
    imageUrls: group.map(item => item.preview), // All images in the group
    imageCount: group.length
  };
});
```

**What this does:**
- Groups items by their `productGroup` ID
- If item has no group, uses item's own ID (becomes group of 1)
- Creates product objects with ALL images from the group
- Each product knows how many photos it has

#### 2. Updated CSV Export
**Before:**
```typescript
const rows = items.map(item => [
  item.seoTitle || '',
  // ... one row per photo
]);
```

**After:**
```typescript
const rows = products.map(product => [
  product.seoTitle || '',
  (product.seoTitle || '').toLowerCase().replace(/\s+/g, '-'),
  product.category || '',
  product.generatedDescription || '',
  product.price || '',
  product.tags?.join(', ') || '',
  product.imageUrls[0] || '', // Main image
  product.imageUrls[1] || '', // Additional images
  product.imageUrls[2] || '',
  product.imageUrls[3] || '',
  'draft'
]);
```

**What changed:**
- Now exports ONE row per product group
- Includes up to 4 image URLs (Shopify supports multiple images)
- Each product has all its photos in separate columns

#### 3. Updated Statistics Display
**Changed:**
```typescript
// Before: {items.length}
// After:  {products.length}
```

**Affects:**
- Total Products count
- Priced Items count  
- Categories count

**Result:** Shows actual product count, not photo count

#### 4. Updated Preview Table
**Changed:**
```typescript
// Before: items.slice(0, 5).map(item => ...)
// After:  products.slice(0, 5).map(product => ...)
```

**Result:** Preview shows products with their grouped data

#### 5. Added Google Sheets URL
**Added your test sheet:**
```typescript
const sheetUrl = 'https://docs.google.com/spreadsheets/d/1dr5an9GjbXnGFTKCNGmQATAuIQDzAGgqtSgp9ta4flM/edit?gid=0#gid=0';
```

**Updated export function:**
```typescript
const sheetData = products.map(product => ({
  Title: product.seoTitle || '',
  Handle: (product.seoTitle || '').toLowerCase().replace(/\s+/g, '-'),
  Category: product.category || '',
  Description: product.generatedDescription || '',
  Price: product.price || '',
  Tags: product.tags?.join(', ') || '',
  'Image 1': product.imageUrls[0] || '',
  'Image 2': product.imageUrls[1] || '',
  'Image 3': product.imageUrls[2] || '',
  'Image 4': product.imageUrls[3] || '',
  'Photo Count': product.imageCount,
  Status: 'draft'
}));
```

## CSV Format

### Headers:
```
Title, Handle, Category, Description, Price, Tags, Image URL, Image 2 URL, Image 3 URL, Image 4 URL, Status
```

### Example Row:
```
"Black Tees - Rolling Stones","black-tees-rolling-stones","Tees","Vintage Rolling Stones tee...","32","tees, fashion, black, vintage","https://...front.jpg","https://...back.jpg","https://...tag.jpg","https://...flat.jpg","draft"
```

## Testing Scenarios

### Scenario 1: All Photos Grouped
- Upload: 8 photos
- Group: All into 2 groups (4 photos each)
- Export: **2 products** with 4 images each

### Scenario 2: Mixed Grouping
- Upload: 8 photos
- Group: 4 photos into 1 group
- Leave: 4 photos ungrouped
- Export: **5 products** (1 group of 4 + 4 individuals)

### Scenario 3: No Grouping
- Upload: 8 photos
- Group: None
- Export: **8 products** (each photo is its own product)

### Scenario 4: Real-World Example
- Upload: 20 photos
- Group 1: 5 photos (front, back, side, detail, tag) → 1 product
- Group 2: 3 photos (front, back, flat) → 1 product
- Group 3: 2 photos (front, back) → 1 product
- Ungrouped: 10 photos → 10 products
- Export: **13 products** total

## Benefits

### For Users:
✅ Accurate product counts  
✅ Multiple images per product  
✅ Better Shopify imports  
✅ Clearer export preview  
✅ Grouped photos treated as one item  

### For Shopify:
✅ Proper product structure  
✅ Multiple product images  
✅ One listing per product  
✅ Better customer experience  

### For Google Sheets:
✅ Clean data structure  
✅ Easy to review  
✅ One row per actual product  
✅ All images linked  

## Workflow Summary

```
1. Upload Photos
   ↓
2. Group Photos (similar items = same product)
   ↓
3. Categorize (per group or individual)
   ↓
4. Describe (per group or individual)
   ↓
5. Export
   - Count groups as products
   - Include all images per group
   - Generate Shopify-ready CSV
   - Export to Google Sheets
```

## Next Steps

### To Test:
1. Upload multiple photos
2. Create some groups
3. Leave some photos ungrouped
4. Navigate to Export step
5. Verify "Total Products" count = number of groups + ungrouped photos
6. Download CSV and check structure
7. Open your Google Sheet after "export"

### To Implement Real Google Sheets API:
1. Set up Google Cloud Project
2. Enable Google Sheets API
3. Create OAuth credentials
4. Add `@googleapis/sheets` package
5. Implement authentication flow
6. Replace mock export with real API calls

## Status: ✅ Complete

All export logic now correctly treats groups as products, not individual photos!
