# Comprehensive Product Form Fields

## Current State
The ProductDescriptionGenerator form currently shows only **15 basic fields**:
1. Price
2. SEO Title
3. Tags
4. Size
5. Brand
6. Condition
7. Flaws
8. Material
9. Era/Vibe
10. Care Instructions
11. Pit to Pit
12. Length
13. Sleeve
14. Waist
15. Inseam

## Missing Fields (19+ fields)

### Shopify Product Fields (Missing 6):
- [ ] **Compare-at Price** (compareAtPrice) - Original price for sale pricing
- [ ] **Cost Per Item** (costPerItem) - Your cost
- [ ] **Color** (color) - Option2 value
- [ ] **Model Name** (modelName) - Specific model
- [ ] **Model Number** (modelNumber) - Model number
- [ ] **Secondary Color** (secondaryColor) - Additional color

### Inventory & Shipping (Missing 4):
- [ ] **SKU** (sku) - Stock keeping unit
- [ ] **Barcode** (barcode) - Product barcode
- [ ] **Weight** (weightValue) - in grams
- [ ] **Inventory Quantity** (inventoryQuantity) - Stock level

### Measurements (Missing 2):
- [ ] **Rise** (rise) - For pants
- [ ] **Shoulder** (shoulder) - Shoulder width

### Shipping & Packaging (Missing 5):
- [ ] **Package Dimensions** (packageDimensions) - Box size
- [ ] **Parcel Size** (parcelSize) - Small/Medium/Large/XL
- [ ] **Ships From** (shipsFrom) - Shipping address
- [ ] **Continue Selling Out of Stock** (continueSellingOutOfStock) - Boolean
- [ ] **Requires Shipping** (requiresShipping) - Physical vs digital

### Product Classification (Missing 4):
- [ ] **Size Type** (sizeType) - Regular/Big & Tall/Petite/Plus
- [ ] **Style** (style) - Vintage/Modern/Streetwear
- [ ] **Gender** (gender) - Men/Women/Unisex/Kids
- [ ] **Age Group** (ageGroup) - Adult/Kids/Infants

### Policies & Marketplace (Missing 6):
- [ ] **Policies** (policies) - Return policy
- [ ] **Renewal Options** (renewalOptions) - Auto/Manual
- [ ] **Who Made It** (whoMadeIt) - Creator
- [ ] **What Is It** (whatIsIt) - Product type
- [ ] **Listing Type** (listingType) - Physical/Digital
- [ ] **Discounted Shipping** (discountedShipping) - Discount level

### Google Shopping / Marketing (Missing 2):
- [ ] **MPN** (mpn) - Manufacturer Part Number
- [ ] **Custom Label 0** (customLabel0) - Top Seller/New/Clearance

### SEO & Status (Missing 3):
- [ ] **SEO Description** (seoDescription) - Meta description
- [ ] **Product Type** (productType) - Category for Shopify
- [ ] **Status** (status) - Active/Draft/Archived
- [ ] **Published** (published) - Boolean

### Advanced Fields (Missing 5):
- [ ] **Tax Code** (taxCode) - Tax classification
- [ ] **Unit Price Total Measure** (unitPriceTotalMeasure)
- [ ] **Unit Price Total Measure Unit** (unitPriceTotalMeasureUnit)
- [ ] **Unit Price Base Measure** (unitPriceBaseMeasure)
- [ ] **Unit Price Base Measure Unit** (unitPriceBaseMeasureUnit)

---

## Proposed Form Structure

### Section 1: Basic Product Info (Expanded - Always Visible)
- Voice Description (existing)
- Price ✅
- Compare-at Price 🆕
- Cost Per Item 🆕
- SEO Title ✅
- Tags ✅
- Brand ✅
- Condition ✅
- Flaws ✅

### Section 2: Product Details (Collapsible)
- Size ✅
- Color 🆕
- Secondary Color 🆕
- Material ✅
- Model Name 🆕
- Model Number 🆕
- Era/Vibe ✅
- Style 🆕
- Gender 🆕
- Age Group 🆕
- Size Type 🆕

### Section 3: Measurements (Collapsible - Existing)
- Pit to Pit ✅
- Length ✅
- Sleeve ✅
- Shoulder 🆕
- Waist ✅
- Rise 🆕
- Inseam ✅

### Section 4: Inventory & SKU (Collapsible - NEW)
- SKU 🆕
- Barcode 🆕
- Inventory Quantity 🆕
- Weight (grams) 🆕

### Section 5: Shipping & Packaging (Collapsible - NEW)
- Requires Shipping 🆕
- Package Dimensions 🆕
- Parcel Size 🆕
- Ships From 🆕
- Continue Selling Out of Stock 🆕

### Section 6: Care & Instructions (Collapsible)
- Care Instructions ✅

### Section 7: Policies & Marketplace (Collapsible - NEW)
- Policies 🆕
- Renewal Options 🆕
- Who Made It 🆕
- What Is It 🆕
- Listing Type 🆕
- Discounted Shipping 🆕

### Section 8: SEO & Marketing (Collapsible - NEW)
- SEO Description 🆕
- Product Type 🆕
- Custom Label 0 🆕
- MPN 🆕

### Section 9: Status & Publishing (Collapsible - NEW)
- Status (Active/Draft/Archived) 🆕
- Published (Yes/No) 🆕

### Section 10: Advanced (Collapsible - Optional)
- Tax Code 🆕
- Unit Pricing Fields 🆕

---

## Pre-fill Behavior

When a category preset is applied (via drag-and-drop), these fields should be **automatically filled** with preset values:

### From Category Preset:
1. **Price** ← `preset.suggested_price_min`
2. **Tags** ← `preset.seo_keywords`
3. **Material** ← `preset.default_material`
4. **Care** ← `preset.default_care_instructions`
5. **Weight** ← `preset.default_weight_value`
6. **Product Type** ← `preset.shopify_product_type`
7. **Brand** ← `preset.vendor`
8. **Package Dimensions** ← `preset.package_dimensions`
9. **Parcel Size** ← `preset.parcel_size`
10. **Ships From** ← `preset.ships_from`
11. **Continue Selling Out of Stock** ← `preset.continue_selling_out_of_stock`
12. **Requires Shipping** ← `preset.requires_shipping`
13. **Size Type** ← `preset.size_type`
14. **Style** ← `preset.style`
15. **Gender** ← `preset.gender`
16. **Age Group** ← `preset.age_group`
17. **Policies** ← `preset.policies`
18. **Renewal Options** ← `preset.renewal_options`
19. **Who Made It** ← `preset.who_made_it`
20. **What Is It** ← `preset.what_is_it`
21. **Listing Type** ← `preset.listing_type`
22. **Discounted Shipping** ← `preset.discounted_shipping`
23. **Custom Label 0** ← `preset.custom_label_0`

### User Can Override:
All fields remain editable - preset values are defaults that can be changed.

---

## Visual Design

### Collapsed Section:
```
┌─────────────────────────────────────────────────────┐
│ ▶ Section 4: Inventory & SKU (4 fields)            │
└─────────────────────────────────────────────────────┘
```

### Expanded Section:
```
┌─────────────────────────────────────────────────────┐
│ ▼ Section 4: Inventory & SKU (4 fields)            │
├─────────────────────────────────────────────────────┤
│ SKU:                 [ABC123            ]           │
│ Barcode:             [789012345678      ]           │
│ Inventory Quantity:  [100               ]           │
│ Weight (grams):      [350               ]  ← Preset │
└─────────────────────────────────────────────────────┘
```

### Preset Indicator:
Fields pre-filled by category preset show a small indicator:
```
Weight (grams): [350]  ← From "Sweatshirts" preset
```

---

## Implementation Plan

### Phase 1: Add All Missing Fields ✅
- Add 40+ input fields organized into sections
- Make sections collapsible
- Show preset indicators

### Phase 2: Pre-fill from Presets ✅
- Already implemented in `applyPresetToGroup()`
- Just need to display the values in form

### Phase 3: Visual Polish
- Add section icons
- Add field descriptions/tooltips
- Add validation indicators
- Show which fields are required for CSV export

---

## Benefits

1. **Complete Data Capture**: All 62 CSV columns visible and editable
2. **Preset Integration**: Category presets automatically fill applicable fields
3. **Organized UI**: Collapsible sections prevent overwhelming users
4. **Flexibility**: Users can override any preset value
5. **CSV-Ready**: Every Shopify CSV column has a corresponding form field
6. **Audit Trail**: Users can see exactly what will be exported

---

## Next Steps

1. Update ProductDescriptionGenerator.tsx with all sections
2. Add collapsible section component
3. Add preset indicator badges
4. Test pre-fill behavior when category assigned
5. Add field descriptions/help text
6. Implement validation for required fields
