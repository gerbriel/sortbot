# Field Mapping: AI Description Generator

## Overview
The AI description generator pulls data from **Step 4 Product Info fields** and formats them into a vintage streetwear listing.

## Fields Used in Description Generation

### Currently Mapped (9 fields):

| Field Name | Source | Used In Description | Example |
|------------|--------|---------------------|---------|
| **voiceDescription** | Voice recording | Main description text | "megadeath world tour 1990s grail t-shirt" |
| **brand** | Manual field | Tags & intro | "Nike", "Carhartt" |
| **color** | Manual field | Tags | "Black/White", "Navy" |
| **size** | Manual field | ✠ SIZE section & tags | "Large", "XL" |
| **material** | Manual field | Tags | "Cotton", "Denim" |
| **condition** | Manual field | Not used (could add) | "Excellent", "Good" |
| **era** | Manual field | Tags & intro | "Vintage", "Y2K", "90s" |
| **style** | Manual field | Tags & intro | "Streetwear", "Grunge" |
| **category** (productType) | Manual field | Tags & intro | "T-Shirt", "Hoodie" |
| **measurements** | Manual fields | ✠ Measurements section | Pit to Pit: 20, Length: 27 |

### Description Format Structure:

```
[VOICE DESCRIPTION]
(Exact text from voice, capitalized first letter)


✠ SIZE- [size]
✠ Pit to pit- [measurements.pitToPit]
✠ length- [measurements.length]
✠ [other measurements]...

BUNDLE AND SAVE!!!!!!

#[tags from: era, brand, category, color, size, style, material]

* We note major imperfections—minor signs of age or wear may not be listed, adding to the vintage character.

* High-quality piece, perfect for streetwear.
* Next-day shipping.
* All sales final.
```

## Available But NOT Used (40+ fields):

These fields exist in ClothingItem but are NOT currently mapped to the description:

### Product Details (not in description):
- **seoTitle** - Could be auto-generated from brand + era + category
- **price** - Not in description (shows separately in Shopify)
- **compareAtPrice** - Not in description
- **tags** - Separate field (not formatted as hashtags in description)
- **modelName** - Could add to description (e.g., "Air Force 1")
- **modelNumber** - Could add (e.g., "Style #AF1")
- **subculture** - Could add as hashtags
- **flaws** - Could add to condition section
- **secondaryColor** - Not used

### Measurements (could expand):
- **measurements.waist** - Not formatted yet
- **measurements.inseam** - Not formatted yet
- **measurements.rise** - Not formatted yet
- **measurements.shoulder** - Not formatted yet
- **measurements.sleeve** - Not formatted yet

### Product Classification (not in description):
- **brandCategory** - Extended category system (160+ categories)
- **sizeType** - Regular, Plus Size, etc.
- **gender** - Men, Women, Unisex
- **ageGroup** - Adult, Kids, etc.
- **care** - Care instructions

### Shipping/Inventory (not in description):
- **weightValue**
- **packageDimensions**
- **parcelSize**
- **requiresShipping**
- **sku**
- **barcode**
- **inventoryQuantity**

### Marketing/SEO (not in description):
- **seoDescription**
- **mpn**
- **customLabel0**
- **whoMadeIt**
- **whatIsIt**

## Where Fields Come From:

1. **Voice Recording** (Step 3)
   - User speaks description
   - Stored in: `voiceDescription`
   - Used as: Main description text

2. **Category Presets** (Auto-applied in Step 2)
   - Selected when categorizing
   - Pre-fills: measurements template, shipping, gender, style
   - Stored in: `_presetData`

3. **Manual Entry** (Step 4 Product Info Form)
   - User types in fields
   - Examples: brand, color, size, era, material
   - Takes precedence over presets

4. **Voice Extraction** (Future)
   - Could extract from voice: brand mentions, colors, sizes
   - Currently: Only uses voice as-is for description

## Code Location:

**Description Generator:**
- File: `src/lib/textAIService.ts`
- Function: `createFallbackDescription()`
- Input: `ProductContext` interface (9 fields)

**Calling Code:**
- File: `src/components/ProductDescriptionGenerator.tsx`
- Lines: 786-799
- Passes: voiceDescription, brand, color, size, material, condition, era, style, category, measurements

**Data Source:**
- File: `src/App.tsx`
- Interface: `ClothingItem` (120+ fields total)
- Lines: 19-127

## Expandable Fields:

Could easily add to description:
1. **condition** - "Condition: Excellent"
2. **flaws** - "Flaws: Small stain on sleeve"
3. **modelName** - "Nike Air Force 1 model"
4. **modelNumber** - "Style #AF1"
5. **subculture** - Add to hashtags: #grunge #punk
6. **care** - "Care: Machine wash cold"
7. **secondaryColor** - "Colors: Black/White/Grey"
8. **More measurements** - waist, inseam, rise, shoulder, sleeve

## Current Limitations:

1. **No Brand Extraction** - Won't assume brand unless explicitly filled in field
2. **Limited Measurements** - Only uses Pit to Pit, Length (could use all 7)
3. **No Condition Text** - Condition field exists but not in description
4. **No Flaws Section** - Flaws field exists but not used
5. **Fixed Disclaimers** - Same text for all items (could customize by condition)

## To Add More Fields:

1. Update `ProductContext` interface in `textAIService.ts`
2. Pass field in `ProductDescriptionGenerator.tsx` line 786
3. Use field in `createFallbackDescription()` function
4. Format into description template
