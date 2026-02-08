# CSV Export Format Update

## Overview
Updated the CSV export in `GoogleSheetExporter.tsx` to match the exact column layout from your Shopify template. **All product data comes from the items themselves** - either manually entered or populated by category presets.

## Column Structure (62 columns total)

### Product Information (1-9)
1. Title
2. URL handle
3. Description
4. Vendor / Brand
5. Product category
6. Type
7. Tags
8. Published on online store
9. Status

### Inventory & Pricing (10-21)
10. SKU
11. Barcode
12. Condition
13. Size Type
14. Size
15. Price
16. Currency
17. Compare-at price
18. Cost per item
19. Primary Color
20. Secondary Color
21. Charge tax

### Tax & Pricing Units (22-26)
22. Tax code
23. Unit price total measure
24. Unit price total measure unit
25. Unit price base measure
26. Unit price base measure unit

### Inventory Management (27-35)
27. Inventory tracker
28. Inventory quantity
29. Continue selling when out of stock
30. Weight Value (LB)
31. Weight unit for display
32. Package Dimensions
33. Requires shipping
34. Fulfillment service
35. Ships From

### Images (36-39)
36. Product image URL
37. Image position
38. Image alt text
39. Variant image URL

### SEO & Metadata (40-50)
40. Gift card
41. SEO title
42. SEO description
43. Color (product.metafields.shopify.color-pattern)
44. Discounted Shipping
45. Material / Fabric
46. Policies
47. Renewal options
48. Who Made It
49. What Is It
50. Listing Type

### Physical Measurements (51-53)
51. Chest
52. Length
53. Parcel Size

### Google Shopping (54-62)
54. Describe your listing's style
55. Google Shopping / Google product category
56. Google Shopping / Gender
57. Google Shopping / Age group
58. Google Shopping / Manufacturer part number (MPN)
59. Google Shopping / Ad group name
60. Google Shopping / Ads labels
61. Google Shopping / Condition
62. Google Shopping / Custom label 0

## Key Features

### Data Source Priority
All values in the CSV come from the product items in this order:
1. **Manual user input** (entered in Step 4)
2. **Category preset defaults** (applied in Step 3)
3. **Empty string** (if no data provided)

**No hardcoded defaults** - everything comes from your data or presets!

### Fixed Values
Only these values are hardcoded for technical reasons:
- **Currency**: Always "USD"
- **Inventory tracker**: Always "shopify"
- **Charge tax**: Always "TRUE"
- **Inventory quantity**: Always "1"
- **Continue selling**: Always "DENY"
- **Fulfillment service**: Always "manual"
- **Weight unit**: Always "LB / OZ"
- **Gift card**: Always "FALSE"
- **Google Custom product**: Always "FALSE"

### Multi-Image Support
- First row contains all product data + first image
- Additional rows contain only:
  - URL handle (column 2)
  - Image URL (column 36)
  - Image position (column 37)
  - Image alt text (column 38)
  - All other columns empty

### Automatic Mapping
These fields are automatically mapped from your product data:
- **Primary/Secondary Color**: From product.color field
- **Material**: From product.material field
- **Measurements**: Maps pitToPit → Chest, length → Length
- **Tags**: Comma-separated from product.tags array
- **Brand**: Maps to Vendor / Brand column
- **Product Type**: Uses product.productType field
- **Condition**: From product.condition field
- **Size Type**: From product.sizeType (set by presets)
- **Weight**: From product.weightValue
- **Package Dimensions**: From product.packageDimensions
- **Parcel Size**: From product.parcelSize (set by presets)
- **Ships From**: From product.shipsFrom (set by presets)
- **Requires Shipping**: From product.requiresShipping (set by presets)
- **Style**: From product.style (set by presets)
- **Gender**: From product.gender (set by presets)
- **Age Group**: From product.ageGroup (set by presets)
- **MPN**: From product.mpn
- **Policies**: From product.policies (set by presets)
- **Care Instructions**: From product.care (set by presets)

### Category Presets Integration
When you assign a category in Step 3, the category preset automatically populates:
- Price range
- Material
- Care instructions
- Weight
- Product type
- Size type
- Parcel size
- Shipping requirements
- Gender
- Age group
- Style
- Policies
- And more...

All these preset values flow through to the CSV export!

## Export Process

1. Groups items by `productGroup` (each group = one product)
2. Takes data from first item in group
3. Collects all image URLs from group
4. Generates first row with complete product data
5. Generates additional rows for remaining images (up to all images)
6. Properly escapes CSV values (commas, quotes, newlines)
7. Downloads as `shopify-products-YYYY-MM-DD.csv`

## Testing
Export a product with multiple images to verify:
- ✅ All 62 columns present
- ✅ First row has all product data + first image
- ✅ Additional rows only have handle + image data
- ✅ No column misalignment
- ✅ Proper CSV escaping
- ✅ Opens correctly in Excel/Google Sheets
- ✅ Ready for Shopify import

## Files Modified
- `/src/components/GoogleSheetExporter.tsx` - Updated `handleDownloadCSV()` function
