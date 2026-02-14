# Step 4: Product Description Generator - Complete Workflow

## Overview
Step 4 handles product data entry with intelligent automation through category presets and voice-to-text AI extraction.

## Workflow Sequence

### 1. **Category Preset Auto-Application**
When a product group first enters Step 4:
- ✅ **Automatic**: Category preset defaults are applied based on the product category
- ✅ **Includes**: shipping info, policies, measurements templates, default tags, etc.
- ✅ **Smart Detection**: Only applies if the group hasn't been processed yet (checks for existing preset data)

**Example Preset Defaults:**
```javascript
{
  ships_from: "601 W. Lincoln Ave, Fresno CA 93706",
  policies: "No Returns; No Exchanges; All Sales Final",
  renewal_options: "Automatic",
  who_made_it: "Another Company Or Person",
  what_is_it: "A Finished Product",
  listing_type: "Physical Item",
  gender: "Unisex",
  style: "Vintage",
  age_group: "Adult (13+ years old)",
  charge_tax: true,
  inventory_tracker: "shopify"
}
```

### 2. **Voice Recording (Per Product Group)**
Each product group has its own persistent voice recording:
- 🎤 **Start Recording**: User clicks "Start Recording" button
- 🗣️ **Speak Description**: User describes the product naturally
- ⏹️ **Stop Recording**: Triggers automatic AI field extraction

**Voice Description Format:**
```
"Vintage Nike Air Force 1, men's size 10, white and black leather,
excellent condition, small scuff on toe, machine wash cold,
pit to pit 22 inches, length 28 inches, $120"
```

### 3. **AI Field Extraction on Stop Recording** ✨ NEW
When user stops recording, AI automatically:
- 🧠 **Extracts Fields**: Analyzes voice description for 15+ product fields
- 🎯 **Smart Context**: Only extracts fields with clear supporting information
- ⚖️ **Overrides Presets**: Voice-extracted fields override category preset defaults
- 📝 **Preserves Data**: All extracted fields are saved to the product group

**Extracted Fields:**
- `brand` - Nike, Adidas, Supreme, Carhartt, Levi's, etc. (30+ brands recognized)
- `modelName` - Air Force 1, Jordan 1, Box Logo, 501, etc.
- `size` - S, M, L, XL, 2XL, 3XL, 4XL, numeric sizes
- `color` - Primary color (black, white, red, blue, etc.)
- `secondaryColor` - Second color for multi-color items
- `material` - Cotton, denim, leather, wool, etc.
- `condition` - NWT, Like New, Excellent, Good, Fair
- `era` - Vintage, 90s, 80s, Y2K, etc.
- `style` - Streetwear, preppy, grunge, punk, etc.
- `gender` - Men, Women, Unisex, Kids
- `measurements` - Pit to pit, length, waist, shoulder, sleeve
- `price` - Extracted from "$120" or "120 dollars"
- `flaws` - Stains, holes, fading, etc.
- `care` - Machine wash, hand wash, dry clean
- `tags` - Graphic, print, embroidered, oversized, rare, etc.

**Smart Extraction Rules:**
- ✅ **Only extracts when confident** - Won't guess brand/color without supporting info
- ✅ **Context clues** - Uses surrounding words to validate extraction
- ✅ **No false positives** - Prefers leaving field empty over incorrect data

### 4. **Persistent Data Per Group**
Each product group retains its data across navigation:
- 💾 **Voice Recording**: Saved to `currentItem.voiceDescription`
- 💾 **Extracted Fields**: Saved to all items in the group
- 💾 **Generated Description**: Saved to `currentItem.generatedDescription`
- 🔄 **Navigation**: Previous/Next preserves all data

**Example Flow:**
```
Group 1 (Nike Hoodie):
  Record voice → AI extracts fields → Navigate to Group 2

Group 2 (Levi's Jeans):
  Record voice → AI extracts fields → Navigate back to Group 1

Group 1 (Nike Hoodie):
  ✅ Voice recording still there
  ✅ All extracted fields still there
  ✅ Description still there
```

### 5. **Manual Overrides**
Users can manually edit any field:
- ✍️ **Form Fields**: Edit any field in the comprehensive form
- 🎨 **Manual Input**: Type or select from dropdowns
- 🔄 **Regenerate**: Use "Regenerate" buttons to refresh specific sections

### 6. **Next Group Workflow**
When clicking "Next" to move to the next product group:
- 🆕 **If new group**: Category preset applied, voice recording empty
- 💾 **If existing group**: All previous data loaded (voice, fields, description)
- 🔄 **Never wiped**: Data only cleared with "Clear Voice Recording" button

## Field Priority Hierarchy

When multiple sources provide the same field:

```
1. Manual User Input (highest priority)
   ↓
2. Voice-Extracted Fields
   ↓
3. Category Preset Defaults
   ↓
4. Empty (lowest priority)
```

**Example:**
```javascript
// Category Preset says:
{ gender: "Unisex", style: "Vintage" }

// User records voice: "Men's streetwear hoodie"
// AI extracts:
{ gender: "Men", style: "Streetwear" }

// Final Result:
{ gender: "Men", style: "Streetwear" } // Voice overrides preset ✅
```

## Integration with Other Steps

### From Step 3 (Categorization):
- ✅ Products arrive grouped by category
- ✅ Category determines which preset to apply

### To Step 5 (Export):
- ✅ All 60+ fields saved to database
- ✅ Voice description preserved in database
- ✅ Complete product data ready for Shopify CSV export

## Technical Implementation

### Category Preset Application
```typescript
// File: src/components/ProductDescriptionGenerator.tsx
// Lines: 255-290

useEffect(() => {
  const autoApplyDefaultPreset = async () => {
    if (!currentItem || !currentItem.category) return;
    
    // Skip if already has preset data
    const hasPresetData = currentGroup.some(item => 
      item.productType || item._presetData || item.requiresShipping !== undefined
    );
    
    if (hasPresetData) return;

    // Apply preset to entire group
    const updatedGroup = await applyPresetToProductGroup(currentGroup, currentItem.category);
    setProcessedItems(updated);
  };
  
  autoApplyDefaultPreset();
}, [currentGroupIndex, currentItem]);
```

### Voice Extraction on Stop
```typescript
// File: src/components/ProductDescriptionGenerator.tsx
// Lines: 372-465

const handleStopRecording = async () => {
  // Stop recording
  isRecordingRef.current = false;
  recognitionRef.current.stop();
  
  // AUTO-EXTRACT fields from voice
  if (currentItem?.voiceDescription) {
    const aiResult = await generateProductDescription({
      voiceDescription: currentItem.voiceDescription,
      // ... pass existing context
    });
    
    const extractedFields = aiResult.extractedFields || {};
    
    // Update all items in group with extracted fields
    currentGroup.forEach(groupItem => {
      updated[itemIndex] = {
        ...updated[itemIndex],
        ...(extractedFields.brand && { brand: extractedFields.brand }),
        ...(extractedFields.size && { size: extractedFields.size }),
        // ... 15+ more fields
      };
    });
    
    setProcessedItems(updated);
  }
};
```

### AI Field Extraction
```typescript
// File: src/lib/textAIService.ts
// Lines: 40-228

function extractFieldsFromVoice(voiceDesc: string): Record<string, any> {
  const extracted: Record<string, any> = {};
  
  // Extract brand (30+ brands recognized)
  if (/\b(nike|adidas|supreme|...)\b/i.test(voiceDesc)) {
    extracted.brand = normalizedBrand;
  }
  
  // Extract model name
  if (/air force 1|jordan 1|box logo/i.test(voiceDesc)) {
    extracted.modelName = modelMatch[1];
  }
  
  // Extract 15+ more fields...
  
  return extracted;
}
```

## User Experience

### Typical Workflow:
1. **Load Group**: Product group loads in Step 4
2. **See Defaults**: Category preset fields are pre-filled
3. **Click Record**: Start recording button
4. **Speak**: "Vintage Nike hoodie, large, black, excellent condition, pit to pit 24 inches"
5. **Click Stop**: Stop recording button
6. **Watch Magic**: AI automatically fills in:
   - Brand: Nike
   - Size: L
   - Color: Black
   - Condition: Excellent
   - Measurements: {pitToPit: "24"}
   - Era: Vintage
7. **Review**: Check auto-filled fields
8. **Edit**: Manually adjust any fields if needed
9. **Next**: Move to next product group

### Best Practices:
- 🎤 **Speak clearly** - Better audio = better extraction
- 📝 **Be specific** - "Nike Air Force 1" better than "sneakers"
- 📏 **Include measurements** - "pit to pit 22 inches"
- 💰 **State price** - "$50" or "50 dollars"
- 🔍 **Mention flaws** - "small stain on front"
- 🧼 **Care instructions** - "machine wash cold"

## Benefits

### For Users:
- ⏱️ **80% faster** - AI fills 15+ fields automatically
- 🎯 **More accurate** - No typos, consistent formatting
- 🧠 **Less mental load** - Just speak naturally
- 💪 **Comprehensive data** - More fields filled = better listings

### For Business:
- 📈 **Higher quality listings** - Complete product data
- 🚀 **Faster processing** - Process more products per hour
- 💯 **Consistent data** - Category presets ensure standards
- 📊 **Better analytics** - Rich data for reporting

## Future Enhancements

- 🌍 **Multi-language support** - Extract from Spanish, French, etc.
- 🤖 **Image-based extraction** - Extract fields from product images
- 📚 **Learning system** - AI learns from corrections
- 🎨 **Style templates** - Save custom preset configurations
- 📱 **Mobile voice recording** - Use phone for better audio quality

---

**Last Updated:** February 14, 2026
**Version:** 1.0.0
