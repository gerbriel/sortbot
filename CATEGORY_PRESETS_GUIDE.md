# Category Presets System - Complete Guide

## Overview

The Category Presets system allows you to define default attributes for product categories (like Sweatshirts, Outerwear, Tees, etc.) that automatically apply when you assign a category to a product group. This saves time and ensures consistency across your inventory.

---

## Features

### ✅ What Can You Preset?

1. **Shipping & Physical Attributes**
   - Default weight (e.g., 1.2 lb for sweatshirts)
   - Weight unit (lb, oz, kg, g)
   - Requires shipping checkbox

2. **Product Classification**
   - Product type (e.g., "Apparel", "Accessories")
   - Default vendor/brand
   - Shopify product type

3. **Pricing Guidance**
   - Suggested minimum price
   - Suggested maximum price
   - Helps with consistent pricing

4. **Product Attributes**
   - Default material (e.g., "Cotton")
   - Default care instructions
   - Typical condition

5. **Measurement Templates**
   - Which measurements are relevant
   - Example: Shirts need pit-to-pit, length, sleeve
   - Example: Pants need waist, inseam, rise

6. **Tags & SEO**
   - Default tags to auto-apply
   - SEO keywords
   - SEO title template

---

## Database Setup

### Step 1: Run the Migration

Execute the SQL migration in your Supabase dashboard:

```bash
# The migration file is located at:
/supabase/migrations/category_presets.sql
```

**Or manually in Supabase SQL Editor:**
1. Go to your Supabase project
2. Click "SQL Editor" in the left sidebar
3. Copy the contents of `category_presets.sql`
4. Click "Run"

This creates the `category_presets` table with:
- Row Level Security enabled
- User-specific data isolation
- Default presets for common categories
- Indexes for fast lookups

---

## Frontend Setup

### Step 2: Add Category Presets Manager to Your App

Update your main `App.tsx` to include the Category Presets Manager:

```typescript
import CategoryPresetsManager from './components/CategoryPresetsManager';

// Add a new route/section:
<CategoryPresetsManager />
```

**Example Integration (Simple):**
```typescript
function App() {
  const [view, setView] = useState<'sorter' | 'presets'>('sorter');
  
  return (
    <div>
      <nav>
        <button onClick={() => setView('sorter')}>Image Sorter</button>
        <button onClick={() => setView('presets')}>Category Presets</button>
      </nav>
      
      {view === 'sorter' && <ImageSorter />}
      {view === 'presets' && <CategoryPresetsManager />}
    </div>
  );
}
```

---

## Usage Guide

### Creating a New Preset

1. **Open Category Presets Manager**
2. **Click "+ Create New Preset"**
3. **Fill in the form:**

   **Basic Information:**
   - Category Name: `Sweatshirts` (internal name, can't change later)
   - Display Name: `Sweatshirts & Hoodies` (user-facing)
   - Description: Optional description

   **Shipping & Physical:**
   - Default Weight: `1.2`
   - Weight Unit: `lb`
   - ☑️ Requires Shipping

   **Product Classification:**
   - Product Type: `Apparel`
   - Shopify Product Type: `Sweatshirts`

   **Pricing Guidance:**
   - Min Price: `$35.00`
   - Max Price: `$85.00`

   **Product Attributes:**
   - Default Material: `Cotton` (optional)
   - Care Instructions: `Machine wash cold, tumble dry low`
   - Typical Condition: `Excellent`

   **Measurement Template:**
   - ☑️ Pit to Pit
   - ☑️ Length
   - ☑️ Sleeve
   - ☑️ Shoulder

   **Tags & SEO:**
   - Default Tags: `sweatshirt, pullover, vintage`
   - SEO Keywords: `vintage sweatshirt, retro, streetwear`
   - SEO Title Template: `{size} {era} {brand} Sweatshirt {color}`

4. **Click "Create Preset"**

---

## Applying Presets to Products

### Option 1: Automatic Application (Recommended)

Update `ProductDescriptionGenerator.tsx` to auto-apply presets:

```typescript
import { getCategoryPresetByName, applyCategoryPreset } from '../lib/categoryPresetsService';

// Inside handleGenerateProductInfo:
const category = currentItem.category || 'clothing';

// Fetch the preset for this category
const preset = await getCategoryPresetByName(category);

if (preset) {
  // Apply preset defaults to all items in group
  currentGroup.forEach(groupItem => {
    const itemIndex = updated.findIndex(item => item.id === groupItem.id);
    if (itemIndex !== -1) {
      // Apply preset attributes
      updated[itemIndex] = applyCategoryPreset(updated[itemIndex], preset);
    }
  });
}
```

### Option 2: Manual Application

In `ImageSorter.tsx` when category is selected:

```typescript
import { getCategoryPresetByName, applyCategoryPreset } from '../lib/categoryPresetsService';

const handleCategorySelect = async (category: string) => {
  // ... existing code ...
  
  // Load and apply preset
  const preset = await getCategoryPresetByName(category);
  
  if (preset) {
    const updatedItems = processedItems.map(item => {
      if (item.category === category) {
        return applyCategoryPreset(item, preset);
      }
      return item;
    });
    
    setProcessedItems(updatedItems);
  }
};
```

---

## Real-World Examples

### Example 1: Sweatshirts Preset

```json
{
  "category_name": "Sweatshirts",
  "display_name": "Sweatshirts & Hoodies",
  "description": "Pullover sweatshirts, hoodies, and crewnecks",
  "default_weight_value": "1.2",
  "default_weight_unit": "lb",
  "requires_shipping": true,
  "product_type": "Apparel",
  "suggested_price_min": 35.00,
  "suggested_price_max": 85.00,
  "measurement_template": {
    "pitToPit": true,
    "length": true,
    "sleeve": true,
    "shoulder": true,
    "waist": false,
    "inseam": false,
    "rise": false
  },
  "default_tags": ["sweatshirt", "hoodie", "pullover"],
  "seo_keywords": ["vintage sweatshirt", "retro hoodie", "streetwear"],
  "typical_condition": "Excellent"
}
```

**When Applied:**
- Product automatically gets `1.2 lb` weight
- Measurement form shows: Pit to Pit, Length, Sleeve, Shoulder fields
- Tags `sweatshirt`, `hoodie`, `pullover` added automatically
- Price suggestions: $35-$85 range

### Example 2: Bottoms Preset

```json
{
  "category_name": "Bottoms",
  "display_name": "Pants & Jeans",
  "description": "Jeans, pants, shorts, and bottoms",
  "default_weight_value": "1.0",
  "default_weight_unit": "lb",
  "product_type": "Apparel",
  "suggested_price_min": 40.00,
  "suggested_price_max": 120.00,
  "measurement_template": {
    "pitToPit": false,
    "length": false,
    "sleeve": false,
    "shoulder": false,
    "waist": true,
    "inseam": true,
    "rise": true
  },
  "default_tags": ["pants", "jeans", "bottoms", "denim"],
  "default_material": "Denim"
}
```

**When Applied:**
- Product gets `1.0 lb` weight
- Measurement form shows: Waist, Inseam, Rise fields
- Tags include `pants`, `jeans`, `bottoms`, `denim`
- Default material set to "Denim"

### Example 3: Hats Preset

```json
{
  "category_name": "Hats",
  "display_name": "Hats & Headwear",
  "default_weight_value": "0.3",
  "default_weight_unit": "lb",
  "product_type": "Accessories",
  "suggested_price_min": 15.00,
  "suggested_price_max": 45.00,
  "measurement_template": {
    "pitToPit": false,
    "length": false,
    "sleeve": false,
    "shoulder": false,
    "waist": false,
    "inseam": false,
    "rise": false
  },
  "default_tags": ["hat", "cap", "headwear"]
}
```

**When Applied:**
- Lightweight: `0.3 lb`
- No measurements needed
- Simple accessory tags

---

## Benefits

### Time Savings
- **Before**: Manually enter weight for every sweatshirt
- **After**: Weight auto-filled when you select "Sweatshirts" category

### Consistency
- All sweatshirts get the same default tags
- Pricing stays within suggested ranges
- Measurements always captured correctly

### Accuracy
- Shipping weights match actual weights
- Measurements relevant to garment type
- SEO tags consistent across category

### Scalability
- Create once, use forever
- Easy to update all future products
- Bulk operations simplified

---

## API Reference

### Service Functions

```typescript
// Fetch all presets
const presets = await getCategoryPresets();

// Get specific preset
const preset = await getCategoryPresetByName('Sweatshirts');

// Create new preset
const newPreset = await createCategoryPreset({
  category_name: 'Jackets',
  display_name: 'Jackets & Coats',
  // ... other fields
});

// Update preset
await updateCategoryPreset(presetId, {
  default_weight_value: '1.5'
});

// Delete preset (soft delete)
await deleteCategoryPreset(presetId);

// Apply preset to product data
const updatedProduct = applyCategoryPreset(productData, preset);
```

---

## Template Variables

When creating SEO title templates, use these variables:

- `{size}` - Product size (e.g., "Large", "M")
- `{brand}` - Brand name (e.g., "Nike", "Carhartt")
- `{category}` - Category name (e.g., "Sweatshirt")
- `{color}` - Color (e.g., "Black", "Navy")
- `{era}` - Era/vintage marker (e.g., "1990s", "Vintage")

**Example Template:**
```
{size} - {era} {brand} {category} {color}
```

**Produces:**
```
Large - Vintage 1990s Nike Sweatshirt Black
```

---

## Measurement Template Guide

Which measurements for each category:

**Tops (Tees, Sweatshirts, Outerwear):**
- ✅ Pit to Pit
- ✅ Length
- ✅ Sleeve (for long sleeve)
- ✅ Shoulder

**Bottoms (Pants, Jeans, Shorts):**
- ✅ Waist
- ✅ Inseam
- ✅ Rise

**Accessories (Hats, Bags):**
- ❌ Usually no measurements needed

---

## Advanced: Conditional Logic

You can add conditional preset application:

```typescript
// Apply different presets based on brand
if (brand === 'Nike' && category === 'Sweatshirts') {
  const nikePreset = await getCategoryPresetByName('Nike Sweatshirts');
  // Apply Nike-specific preset
} else {
  const genericPreset = await getCategoryPresetByName('Sweatshirts');
  // Apply generic preset
}
```

---

## Troubleshooting

### Preset not applying?
- Check that category name matches exactly (case-sensitive)
- Verify preset is active (`is_active = true`)
- Check user authentication (RLS policies)

### Can't create preset?
- Ensure you're authenticated
- Check that category name is unique
- Verify database migration ran successfully

### Measurements not showing?
- Check `measurement_template` JSON is valid
- Verify boolean values are `true` for desired fields

---

## Migration Checklist

- [ ] Run `category_presets.sql` migration in Supabase
- [ ] Verify table created in Supabase dashboard
- [ ] Check RLS policies are enabled
- [ ] Test creating a preset via UI
- [ ] Test applying preset to product
- [ ] Update default presets to match your categories
- [ ] Train team on using preset manager

---

## Files Created

1. **`/supabase/migrations/category_presets.sql`** - Database schema
2. **`/src/lib/categoryPresets.ts`** - TypeScript types
3. **`/src/lib/categoryPresetsService.ts`** - Database service functions
4. **`/src/components/CategoryPresetsManager.tsx`** - UI component
5. **`/src/components/CategoryPresetsManager.css`** - Styling
6. **`/src/lib/supabase.ts`** - Updated with new table types

---

## Next Steps

1. **Run the migration** in Supabase
2. **Add CategoryPresetsManager** to your app navigation
3. **Create your first preset** for a common category
4. **Test applying the preset** to a product
5. **Integrate auto-apply logic** in ProductDescriptionGenerator
6. **Customize default presets** to match your inventory

---

## Support

Common categories to set up first:
- Sweatshirts
- Outerwear
- Tees
- Bottoms
- Hats
- Accessories
- Activewear
- Femme

You can always add more categories as your inventory grows!
