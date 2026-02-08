# Category Presets Integration - Implementation Summary

## Overview
Category presets are now automatically applied to product groups when a category is assigned in Step 3. The preset data pre-fills the AI description form fields, which are then used for generating descriptions and Shopify imports.

## How It Works

### 1. Category Assignment (Step 3 - CategoryZones.tsx)
When you drag a product group to a category zone:
- The category is assigned to all items in the product group
- The system automatically looks up the matching category preset
- If an active preset exists, it applies the preset data to the group

### 2. Preset Data Applied
The following preset values are automatically applied:
- **Price**: Suggested minimum price (if no manual price exists)
- **SEO Title**: Template from preset
- **Tags**: SEO keywords from preset
- **Material**: Default material
- **Care Instructions**: Default care instructions
- **Weight**: Default shipping weight
- **Product Type**: Shopify product type
- **Brand/Vendor**: Vendor from preset
- **Measurement Template**: Which measurements to show

### 3. Manual Overrides
**Important**: Manual entries ALWAYS take precedence over preset values!
- If you've already entered a price, the preset won't override it
- If you've already entered tags, they'll be kept (preset tags are only applied if none exist)
- You can edit any pre-filled field and your changes will be preserved

### 4. AI Description Generation (Step 4)
When generating descriptions:
- The AI uses the preset data along with your voice description
- Pre-filled fields from presets are included in the generation prompt
- Manual edits you make override the preset values
- The measurement template determines which measurements to display

### 5. Visual Indicators
In the Product Description Generator (Step 4):
- **Green box**: Shows "Category Preset Applied" when preset data is loaded
- Displays the category name and description
- Reminds you that you can edit any pre-filled field

## Files Modified

### New Files
1. **`src/lib/applyPresetToGroup.ts`**
   - `applyPresetToProductGroup()`: Applies preset data to product group
   - `getPresetForCategory()`: Retrieves preset for a category
   - Handles preset data mapping and manual override logic

### Modified Files
1. **`src/components/CategoryZones.tsx`**
   - Updated `handleCategoryDrop()` to be async
   - Calls `applyPresetToProductGroup()` when category is assigned
   - Merges preset data into items before updating state

2. **`src/App.tsx`**
   - Added `_presetData` field to `ClothingItem` interface
   - Stores preset metadata for reference in AI generation

3. **`src/components/ProductDescriptionGenerator.tsx`**
   - Added visual indicator showing when preset has been applied
   - Displays category name, description, and usage instructions

## Example Flow

### Scenario: T-shirt Product Group
1. **Step 2**: You group 3 images of the same t-shirt
2. **Step 3**: You drag the group to "Graphic T-Shirts" category
3. **System automatically**:
   - Looks up "Graphic T-Shirts" preset
   - Applies price range ($25-$45)
   - Pre-fills tags: ["vintage", "tee", "graphic", "cotton"]
   - Sets material: "100% Cotton"
   - Sets care: "Machine wash cold"
   - Sets weight: "6 oz"
   - Sets measurement template: Show pit-to-pit, length, sleeve

4. **Step 4**: You open Product Description Generator
   - See green box: "Category Preset Applied - Graphic T-Shirts"
   - Form fields show pre-filled values
   - Price field shows $25.00
   - Tags field shows "vintage, tee, graphic, cotton"
   - Material shows "100% Cotton"
   
5. **You can**:
   - Change price to $35.00 (your change is saved)
   - Add more tags: "rolling stones, band" (merged with preset tags)
   - Voice describe: "black rolling stones vintage tee, excellent condition"
   
6. **AI Generation**:
   - Uses your voice description + preset data + manual edits
   - Generates description with all measurements from template
   - Includes care instructions from preset
   - Creates SEO title based on preset template + your description

## Benefits

✅ **Speed**: Forms are pre-filled instantly when category is assigned
✅ **Consistency**: All items in same category use same defaults
✅ **Flexibility**: You can override any preset value manually
✅ **AI Integration**: Preset data enhances AI description generation
✅ **Shopify Ready**: Preset ensures all required Shopify fields are populated

## Managing Presets

To create or edit presets:
1. Click "Category Presets" in the navbar
2. Create presets for your common categories
3. Set default values for price, tags, material, care, etc.
4. Set measurement templates (which measurements to show)
5. Mark presets as "Active" to use them
6. Presets automatically apply when categories are assigned

## Notes

- Presets are user-specific (each user has their own presets)
- Inactive presets are not applied
- If no preset exists for a category, no pre-filling occurs
- Preset data is stored in `_presetData` for reference but doesn't affect Shopify export
- Only the actual item fields (price, tags, etc.) are exported to Shopify
