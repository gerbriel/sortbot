# Placeholder Text Styling Update

## Problem
Placeholder text in input fields was too dark, making it difficult to distinguish between placeholder text and prefilled values.

## Solution
Updated all placeholder text across the application to be **much lighter** (35% opacity) and **italic** for clear visual distinction.

## Changes Made

### Global Styling (applies to all inputs)
**File**: `src/index.css`
```css
input::placeholder,
textarea::placeholder {
  color: rgba(140, 145, 150, 0.35);  /* Very light gray at 35% opacity */
  font-style: italic;                 /* Italic to distinguish from real values */
  opacity: 1;                         /* Firefox compatibility fix */
}
```

### Component-Specific Overrides

1. **ComprehensiveProductForm.css** (Step 4 form fields)
   - `.info-input::placeholder` - 35% opacity + italic

2. **ProductDescriptionGenerator.css** (Description textarea & form inputs)
   - `.description-textarea::placeholder` - 35% opacity + italic
   - `.form-group input::placeholder` - 35% opacity + italic
   - `.form-group textarea::placeholder` - 35% opacity + italic

3. **GoogleSheetExporter.css** (Sheet URL input)
   - `.sheet-url-input::placeholder` - 35% opacity + italic + monospace

4. **ImageUpload.css** (Drive URL input)
   - `.drive-url-input::placeholder` - 35% opacity + italic

5. **Auth.css** (Login/signup forms)
   - `.form-group input::placeholder` - 35% opacity + italic

6. **CategoryPresetsManager.css** (Preset management forms)
   - `.form-group input::placeholder` - 35% opacity + italic
   - `.form-group textarea::placeholder` - 35% opacity + italic

7. **CategoriesManager.css** (Category management forms)
   - `.form-group input::placeholder` - 35% opacity + italic

## Visual Comparison

### Before
- **Placeholder**: Dark gray (#8c9196 or #9ca3af) - ~60% opacity
- **Prefilled Value**: Dark gray (#202223)
- **Issue**: Hard to tell them apart!

### After
- **Placeholder**: Very light gray (rgba(140, 145, 150, 0.35)) - 35% opacity + italic
- **Prefilled Value**: Dark gray (#202223) - normal font style
- **Result**: ✅ Clear distinction!

## Testing

Open the app and check these screens:

1. **Step 4 (Product Description Generator)**:
   - Title, Brand, Color, Size fields
   - Description textarea
   - Should see very faint italic placeholders

2. **Step 5 (Comprehensive Product Form)**:
   - Price, Compare-at price, Cost per item
   - Tags, Material, Condition fields
   - Placeholders should be barely visible and italic

3. **Google Sheets Exporter**:
   - Sheet URL input
   - Placeholder should be faint monospace italic

4. **Category/Preset Managers**:
   - Form inputs should have faint italic placeholders

5. **Auth Forms**:
   - Email, Password fields
   - Placeholders should be very light and italic

## Benefits

✅ **Clear Distinction**: Easy to tell placeholder vs prefilled values  
✅ **Better UX**: Users know which fields have been auto-filled  
✅ **Consistent**: Applied globally across all components  
✅ **Accessible**: Still visible but clearly marked as hints  
✅ **Professional**: Italic style is a common design pattern for placeholders  

## Color Values

- **Old**: `#8c9196` or `var(--gray-400)` (solid color, ~60% opacity)
- **New**: `rgba(140, 145, 150, 0.35)` (35% opacity with italic style)

The rgba() format ensures consistent opacity across all browsers and provides better control over the final appearance.
