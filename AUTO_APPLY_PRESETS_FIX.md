# Auto-Apply Category Presets Fix

## Problem
Category presets were not being automatically applied when users reached Step 4 (Product Description Generator). Fields that should have been prefilled with preset values were empty.

## Root Cause
The `ProductDescriptionGenerator` component was loading available presets but **never automatically applying** the default preset for the current product's category.

## Solution
Added a `useEffect` hook that automatically applies the default category preset when:
1. The component first loads with items
2. User navigates to a different product group
3. Presets finish loading

### Key Changes

**File**: `src/components/ProductDescriptionGenerator.tsx`

#### 1. Auto-Apply Default Preset (lines 255-305)
```typescript
useEffect(() => {
  const autoApplyDefaultPreset = async () => {
    if (!currentItem || !currentItem.category) return;
    
    // Skip if this group already has preset data applied
    const hasPresetData = currentGroup.some(item => 
      item.productType || 
      item._presetData ||
      item.requiresShipping !== undefined ||
      item.policies
    );
    
    if (hasPresetData) {
      console.log('⏭️  Preset already applied to this group, skipping auto-apply');
      return;
    }

    // Apply the default preset for this category
    const updatedGroup = await applyPresetToProductGroup(currentGroup, currentItem.category);
    
    // Update state with preset-enriched items
    setProcessedItems(updated);
    
    // Select the default preset in the dropdown
    const defaultPreset = availablePresets.find(p => 
      (p.product_type?.toLowerCase() === currentItem.category?.toLowerCase() || 
       p.category_name.toLowerCase() === currentItem.category?.toLowerCase()) &&
      p.is_default && 
      p.is_active
    );
    
    if (defaultPreset) {
      setSelectedPresetId(defaultPreset.id);
    }
  };

  if (availablePresets.length > 0) {
    autoApplyDefaultPreset();
  }
}, [currentGroupIndex, availablePresets]);
```

## How It Works

### Flow Diagram
```
User reaches Step 4
    ↓
Component loads → useEffect #1: Load available presets
    ↓
Presets loaded → useEffect #2: Auto-apply default preset
    ↓
Check if category exists
    ↓
Check if preset already applied (skip if yes)
    ↓
Find default preset for category (is_default=true)
    ↓
Call applyPresetToProductGroup()
    ↓
Merge preset data into items:
  - productType
  - requiresShipping
  - policies
  - whoMadeIt
  - whatIsIt
  - renewalOptions
  - etc.
    ↓
Update processedItems state
    ↓
Select preset in dropdown
    ↓
✅ Fields are now prefilled!
```

## What Gets Prefilled

When the default preset is applied, these fields are automatically populated:

### From Category Preset:
- **Product Type** (productType)
- **Requires Shipping** (requiresShipping)
- **Policies** (policies)
- **Who Made It** (whoMadeIt)
- **What Is It** (whatIsIt)
- **Renewal Options** (renewalOptions)
- **Listing Type** (listingType)
- **Gender** (gender)
- **Age Group** (ageGroup)
- **Size Type** (sizeType)
- **Package Dimensions** (packageDimensions)
- **Parcel Size** (parcelSize)

### Precedence Rules:
1. **Voice Dictation** - Highest priority (user spoken values)
2. **Manual Override** - User selects different preset from dropdown
3. **Default Preset** - Auto-applied (this fix)
4. **Empty** - No value if preset doesn't specify

## Testing

### Before Fix:
1. Upload images
2. Sort into categories (e.g., "t-shirts")
3. Group images
4. Reach Step 4
5. ❌ Fields like "Product Type", "Policies", "Who Made It" are EMPTY

### After Fix:
1. Upload images
2. Sort into categories (e.g., "t-shirts")
3. Group images
4. Reach Step 4
5. ✅ Fields are PREFILLED with default preset values
6. ✅ Dropdown shows selected preset: "T-Shirts (Default)"

### Console Logs to Verify:
```
🔄 Auto-applying default preset for category: t-shirts
Applying DEFAULT preset "T-Shirts (Default)" for category: t-shirts
✅ Auto-applied default preset: T-Shirts (Default)
```

## Manual Override Still Works

Users can still:
1. Select a different preset from the dropdown
2. Manually type in any field (overrides preset)
3. Use voice dictation (takes precedence over preset)

## Edge Cases Handled

### 1. No Category Assigned
```typescript
if (!currentItem || !currentItem.category) return;
```
Skips auto-apply if item has no category yet.

### 2. Preset Already Applied
```typescript
const hasPresetData = currentGroup.some(item => 
  item.productType || item._presetData || item.requiresShipping !== undefined
);
```
Prevents re-applying preset if items already have preset data (e.g., from database).

### 3. No Default Preset Exists
```typescript
if (!preset) {
  console.log(`No active preset found for category: ${categoryName}`);
  return items.map(item => ({ ...item, category: categoryName }));
}
```
Still assigns category even if no preset is configured.

### 4. Multiple Groups
```typescript
}, [currentGroupIndex, availablePresets]);
```
Re-applies preset when user navigates between product groups.

## Database Requirements

For this to work, you need:

1. **Categories** in the `categories` table
2. **Default Presets** in the `category_presets` table with:
   - `is_default = true`
   - `is_active = true`
   - `product_type` matching the category name

### Create Default Presets:
Run the SQL script: `supabase/migrations/create_default_presets.sql`

This will create default presets for all existing categories.

## Benefits

✅ **Better UX**: Fields are prefilled automatically  
✅ **Faster Workflow**: Less manual data entry  
✅ **Consistency**: All products in same category get same preset values  
✅ **Flexible**: Users can still override any field  
✅ **Smart**: Skips re-applying if preset already exists  

## Files Modified

1. **src/components/ProductDescriptionGenerator.tsx**
   - Added auto-apply preset useEffect (lines 255-305)
   - Runs when component loads or group changes
   - Checks for existing preset data before applying

## Related Files (Not Modified)

- `src/lib/applyPresetToGroup.ts` - Preset application logic (already working)
- `src/lib/categoryPresetsService.ts` - Preset loading from database (already working)
- `supabase/migrations/create_default_presets.sql` - SQL to create default presets

## Migration Notes

No database migration needed - this is a frontend-only fix.

However, you should run `create_default_presets.sql` if you haven't already to ensure all categories have default presets.
