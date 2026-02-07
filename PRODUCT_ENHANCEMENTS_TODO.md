# Product Management Enhancements - TODO

## Overview
Improve field management, product detail views, and add CSV export functionality.

## 1. Character Limits on All Fields ✅ (Constants Created)

### Implementation Status
- ✅ Created `src/constants/fieldLimits.ts` with Shopify-compatible limits
- ⏳ Need to add to ProductDescriptionGenerator component
- ⏳ Need to add visual character counters

### Fields to Update
- SEO Title: 70 chars (Shopify page title limit)
- Tags: 255 chars total
- Size: 50 chars
- Brand: 255 chars
- Condition: 50 chars (dropdown)
- Flaws: 500 chars
- Material: 255 chars
- Era/Vibe: 100 chars
- Care Instructions: 500 chars
- Product Description: 5000 chars (Shopify limit)
- Price: 10 chars

### UI Requirements
- Add `maxLength` attribute to all input/textarea fields
- Show character counter below each field (e.g., "45/70")
- Turn counter red when approaching/at limit
- Prevent typing beyond limit

## 2. Expand AI Description Field

### Current Issue
- AI-generated description takes up small portion of screen
- Hard to read/edit long descriptions

### Solution
- Make description textarea wider (use more horizontal space)
- Increase default height to 8-10 rows
- Consider making it full-width or 2-column layout
- Add visual distinction (border, background color)

### CSS Changes Needed
```css
.info-textarea {
  width: 100%;
  min-height: 200px;
  font-size: 14px;
  line-height: 1.6;
}
```

## 3. Product Group Detail View

### Feature: Click to View Full Details
- Click any product group card to open detailed modal
- Show all fields for that product group:
  - All images in gallery
  - Full product description
  - All metadata (size, brand, condition, etc.)
  - Measurements if entered
  - Flaws, material, era, care instructions
  - Tags list
  - Price, status
  - Created date, batch info

### UI Design
- Modal overlay (similar to Saved Products modal)
- Image gallery at top (carousel or grid)
- Fields organized in sections
- Edit capability (optional)
- "Export This Product" button
- "Delete Product" button
- Close button (X)

### Component Structure
```
ProductDetailModal.tsx
- Props: product, onClose, onUpdate, onDelete
- Sections: Images, Details, Metadata, Export
```

## 4. Batch Detail View

### Feature: Click Batch to See All Products
- In Saved Products > Batch View
- Click batch header to expand/show all products in that batch
- OR click to open modal with batch details

### UI Options

**Option A: Expandable Section**
- Batch header clickable
- Toggles collapse/expand
- Products show inline

**Option B: Batch Modal**
- Click batch opens modal
- Shows batch metadata:
  - Date/time saved
  - Number of product groups
  - Total images
  - Batch ID
- Grid of all products in batch
- Bulk actions:
  - Export all as CSV
  - Delete entire batch
  - Export to Shopify (batch)

## 5. CSV Export Functionality

### Export Options

**Per Product Group**
- Button in Product Detail Modal
- Export single product with all fields
- Filename: `product-{title}-{date}.csv`

**Per Batch**
- Button in Batch View/Modal
- Export all products in batch
- Filename: `batch-{date}-{count}products.csv`

**All Products**
- Button in main Saved Products view
- Export everything
- Filename: `all-products-{date}.csv`

### CSV Format (Shopify Compatible)
```csv
Handle,Title,Body (HTML),Vendor,Product Category,Type,Tags,Published,Option1 Name,Option1 Value,Variant SKU,Variant Grams,Variant Inventory Qty,Variant Price,Variant Compare At Price,Image Src,Image Position,Image Alt Text,Status,Variant Barcode
```

### Fields to Include
- Handle (URL slug)
- Title (SEO Title)
- Body (HTML) - Product Description
- Vendor (Brand)
- Product Category
- Type (product_type)
- Tags (comma-separated)
- Published (true/false)
- Option1 Name: "Size"
- Option1 Value: size value
- Variant SKU
- Variant Price
- Image URLs (multiple rows per product for multiple images)
- Image Position (1, 2, 3...)
- Image Alt Text
- Status (Draft/Active)
- Condition, Flaws, Material, Era (in Tags or Body)

### Implementation Files Needed
```
src/lib/csvExport.ts
- exportProductToCSV(product)
- exportBatchToCSV(products[])
- exportAllProductsToCSV(products[])
- formatForShopify(product)
- downloadCSV(data, filename)
```

## 6. Database Schema Updates

### Already Have
- ✅ batch_id field in products table

### May Need
- Export history table (optional)
- Track which products/batches have been exported
- Export timestamp
- Export type (CSV, Shopify, etc.)

## Implementation Priority

### Phase 1: Character Limits (High Priority)
1. Update ProductDescriptionGenerator.tsx
2. Add maxLength to all fields
3. Add character counters
4. Test with long text

### Phase 2: Layout Improvements (Medium Priority)
1. Expand description textarea
2. Improve overall form layout
3. Better mobile responsiveness

### Phase 3: Detail Views (High Priority)
1. Create ProductDetailModal component
2. Add click handlers to product cards
3. Implement view/edit functionality
4. Add delete confirmation

### Phase 4: Batch Management (Medium Priority)
1. Make batch headers clickable
2. Implement expand/collapse OR modal
3. Add batch metadata display
4. Bulk actions UI

### Phase 5: CSV Export (High Priority)
1. Create csvExport.ts utility
2. Implement Shopify format conversion
3. Add export buttons to UI
4. Test CSV downloads
5. Verify Shopify import compatibility

## Testing Checklist

- [ ] All fields respect character limits
- [ ] Character counters update in real-time
- [ ] Cannot type beyond maxLength
- [ ] Product detail modal opens/closes correctly
- [ ] All product data visible in detail view
- [ ] Batch view shows correct products
- [ ] CSV export creates valid file
- [ ] CSV imports successfully to Shopify
- [ ] Export filename is descriptive
- [ ] Multiple image rows in CSV for multi-image products
- [ ] Special characters handled correctly in CSV

## Notes

- Keep backward compatibility with existing saved products
- Handle products without batch_id (show as "Unbatched")
- CSV should escape commas, quotes properly
- Consider adding export format options (Shopify, WooCommerce, etc.)
- Add loading states for CSV generation
- Show success message after export
- Consider adding print view for products

