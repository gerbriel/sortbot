# CSV Field Mapping - Complete Analysis

## Field Mapping from CSV Template to Product Group

Based on your CSV template, here's the complete field mapping with current status and data source:

### ✅ ALREADY MAPPED (Existing in ClothingItem)

| CSV Column | ClothingItem Field | Data Source |
|------------|-------------------|-------------|
| Title | `seoTitle` | Manual/AI |
| URL handle | Generated from `seoTitle` | Auto-generated |
| Description | `generatedDescription` | AI Generated |
| Vendor / Brand | `brand` | Manual/Preset |
| Product category | `category` | Category Assignment |
| Type | `productType` | Manual/Preset |
| Tags | `tags[]` | Manual/AI/Preset |
| Published on online store | `published` | Manual |
| Status | `status` | Manual |
| SKU | `sku` | Manual |
| Barcode | `barcode` | Manual |
| Condition | `condition` | Manual |
| Size | `size` | Manual |
| Price | `price` | Manual/Preset |
| Compare-at price | `compareAtPrice` | Manual |
| Cost per item | `costPerItem` | Manual |
| Primary Color | `color` | Manual/AI |
| Charge tax | N/A | Fixed: TRUE |
| Inventory tracker | N/A | Fixed: shopify |
| Inventory quantity | `inventoryQuantity` | Manual |
| Weight Value (LB) | `weightValue` | Manual/Preset |
| Requires shipping | N/A | Fixed: TRUE |
| Fulfillment service | N/A | Fixed: manual |
| Product image URL | `imageUrls[0]` | Auto (Supabase) |
| Image position | N/A | Auto-generated |
| Image alt text | Generated from `seoTitle` | Auto-generated |
| SEO title | `seoTitle` | Manual/AI |
| SEO description | `seoDescription` | Manual/AI |
| Material / Fabric | `material` | Manual/Preset |
| Chest | `measurements.pitToPit` | Manual |
| Length | `measurements.length` | Manual |

### ❌ MISSING (Need to Add to ClothingItem)

| CSV Column | Suggested Field Name | Data Source | Set By |
|------------|---------------------|-------------|---------|
| Secondary Color | `secondaryColor` | Manual/AI | User/AI |
| Tax code | `taxCode` | Manual | User |
| Unit price total measure | `unitPriceTotalMeasure` | Manual | User |
| Unit price total measure unit | `unitPriceTotalMeasureUnit` | Manual | User |
| Unit price base measure | `unitPriceBaseMeasure` | Manual | User |
| Unit price base measure unit | `unitPriceBaseMeasureUnit` | Manual | User |
| Continue selling when out of stock | `continueSellingOutOfStock` | Manual/Preset | Preset |
| Weight unit for display | N/A | Fixed: LB/OZ | Fixed |
| Package Dimensions | `packageDimensions` | Manual/Preset | Preset |
| Ships From | `shipsFrom` | Preset | Preset |
| Variant image URL | N/A | Empty | Auto |
| Gift card | N/A | Fixed: FALSE | Fixed |
| Color (metafields) | `colorMetafield` | Auto from colors | Auto |
| Discounted Shipping | `discountedShipping` | Preset | Preset |
| Policies | `policies` | Preset | Preset |
| Renewal options | `renewalOptions` | Preset | Preset |
| Who Made It | `whoMadeIt` | Preset | Preset |
| What Is It | `whatIsIt` | Preset | Preset |
| Listing Type | `listingType` | Preset | Preset |
| Parcel Size | `parcelSize` | Preset | Preset |
| Describe your listing's style | `style` | Preset/User | Preset |
| Google Shopping / Gender | `gender` | Preset | Preset |
| Google Shopping / Age group | `ageGroup` | Preset | Preset |
| Google Shopping / MPN | `mpn` | Manual | User |
| Google Shopping / Ad group name | Auto from `seoTitle` | Auto | Auto |
| Google Shopping / Ads labels | Auto from `productType` | Auto | Auto |
| Google Shopping / Condition | Auto from `condition` | Auto | Auto |
| Google Shopping / Custom product | N/A | Fixed: FALSE | Fixed |
| Google Shopping / Custom label 0 | `customLabel0` | Preset | Preset |
| Size Type | `sizeType` | Preset | Preset |

### 🔧 EMPTY/OPTIONAL (Not Needed or Left Blank)

These fields exist in CSV but are typically left empty:
- Variant image URL (only for multi-variant products)
- Gift card (always FALSE for physical products)
- Tax code (optional, usually empty)
- Unit pricing fields (rarely used for clothing)

## Recommended Actions

### 1. Add Missing Fields to ClothingItem Interface

```typescript
export interface ClothingItem {
  // ... existing fields ...
  
  // Additional Color
  secondaryColor?: string;
  
  // Shipping & Packaging (from Presets)
  packageDimensions?: string; // e.g., "8 in - 6 in - 4 in"
  parcelSize?: 'Small' | 'Medium' | 'Large' | 'Extra Large';
  shipsFrom?: string; // Address
  continueSellingOutOfStock?: boolean;
  
  // Product Classification (from Presets)
  sizeType?: 'Regular' | 'Big & Tall' | 'Petite' | 'Plus Size';
  style?: string; // "Vintage", "Modern", "Streetwear"
  gender?: 'Men' | 'Women' | 'Unisex' | 'Kids';
  ageGroup?: string; // "Adult (13+ years old)", "Kids", "Infants"
  
  // Policies & Info (from Presets)
  policies?: string; // "No Returns; No Exchanges"
  renewalOptions?: string; // "Automatic", "Manual"
  whoMadeIt?: string; // "Another Company Or Person", "I made it"
  whatIsIt?: string; // "A Finished Product", "A supply"
  listingType?: string; // "Physical Item", "Digital Download"
  discountedShipping?: string; // "No Discount", "10% Off"
  
  // Google Shopping Fields
  mpn?: string; // Manufacturer Part Number
  customLabel0?: string; // "Top Seller", "New Arrival"
  
  // Optional Advanced Fields
  taxCode?: string;
  unitPriceTotalMeasure?: string;
  unitPriceTotalMeasureUnit?: string;
  unitPriceBaseMeasure?: string;
  unitPriceBaseMeasureUnit?: string;
}
```

### 2. Update Category Presets to Include New Fields

In `getCategoryPresets()`, add these columns to the presets table:
- `package_dimensions` (text)
- `parcel_size` (text)
- `ships_from` (text)
- `continue_selling_out_of_stock` (boolean)
- `size_type` (text)
- `style` (text)
- `gender` (text)
- `age_group` (text)
- `policies` (text)
- `renewal_options` (text)
- `who_made_it` (text)
- `what_is_it` (text)
- `listing_type` (text)
- `discounted_shipping` (text)
- `custom_label_0` (text)

### 3. Update applyPresetToGroup.ts

Map all new preset fields to the product items:

```typescript
packageDimensions: item.packageDimensions || preset.package_dimensions,
parcelSize: item.parcelSize || preset.parcel_size,
shipsFrom: item.shipsFrom || preset.ships_from,
continueSellingOutOfStock: item.continueSellingOutOfStock ?? preset.continue_selling_out_of_stock,
sizeType: item.sizeType || preset.size_type,
style: item.style || preset.style,
gender: item.gender || preset.gender,
ageGroup: item.ageGroup || preset.age_group,
policies: item.policies || preset.policies,
renewalOptions: item.renewalOptions || preset.renewal_options,
whoMadeIt: item.whoMadeIt || preset.who_made_it,
whatIsIt: item.whatIsIt || preset.what_is_it,
listingType: item.listingType || preset.listing_type,
discountedShipping: item.discountedShipping || preset.discounted_shipping,
customLabel0: item.customLabel0 || preset.custom_label_0,
```

### 4. Update ProductDescriptionGenerator Form

Add input fields for:
- Secondary Color (text input)
- MPN (text input)
- These will be manual entries since they're product-specific

### 5. CSV Export Already Updated

The `GoogleSheetExporter.tsx` already references these fields with `(product as any)`, so once we add them to the interface, they'll automatically work.

## Priority Implementation Order

### Phase 1: Critical Fields (Preset-Driven)
1. ✅ Add shipping fields: `packageDimensions`, `parcelSize`, `shipsFrom`
2. ✅ Add classification: `sizeType`, `gender`, `ageGroup`, `style`
3. ✅ Add policies: `policies`, `whoMadeIt`, `whatIsIt`, `listingType`

### Phase 2: Optional Manual Fields
4. ✅ Add `secondaryColor` (user can enter in Step 4)
5. ✅ Add `mpn` (user can enter in Step 4)
6. ✅ Add `customLabel0` (preset or manual)

### Phase 3: Advanced (Low Priority)
7. ⏭️ Unit pricing fields (rarely used)
8. ⏭️ Tax code (usually empty)

## Summary

- **Currently Mapped**: 26 fields ✅
- **Need to Add**: 17 fields 🔧
- **Fixed Values**: 8 fields 🔒
- **Total CSV Columns**: 62

Once we add these 17 fields to the interface and update the preset system, you'll have 100% coverage of your CSV template!
