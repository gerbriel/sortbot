# Voice Field Extraction & Description Generation

## How It Works

The AI system now has **TWO capabilities**:

### 1. **Extract Fields from Voice** (Auto-fill Step 4)
When you speak, the system listens for specific keywords and auto-fills Step 4 fields.

### 2. **Format Description** (Using filled fields)
Takes all filled fields (manual + extracted) and formats into vintage streetwear listing.

---

## Voice Extraction Examples

### What Gets Extracted:

| You Say | Field Filled | Value |
|---------|-------------|-------|
| "large t-shirt" | **size** | "L" |
| "extra large hoodie" | **size** | "XL" |
| "black and white sneakers" | **color** | "Black/White" |
| "cotton material" | **material** | "Cotton" |
| "vintage 90s style" | **era** | "Vintage" |
| "y2k aesthetic" | **era** | "Y2k" |
| "brand new with tags" | **condition** | "NWT" |
| "like new condition" | **condition** | "Like New" |
| "excellent condition" | **condition** | "Excellent" |
| "small stain on sleeve" | **flaws** | "Small stain on sleeve" |
| "machine wash cold" | **care** | "Machine wash cold" |

### Extraction Rules:

- ✅ **Only extracts if EXPLICITLY mentioned** in voice
- ✅ **Manual entry always wins** (if you fill a field, voice extraction is ignored)
- ✅ **Smart detection** (recognizes variations: "XL", "extra large", "x-large")
- ❌ **No assumptions** (won't guess brand unless you say it)

---

## New Description Format

With flaws and care instructions added:

```
[VOICE DESCRIPTION]


✠ SIZE- [size]
✠ Pit to pit- [measurements]
✠ length- [measurements]

Condition: [condition]
Flaws: [flaws]

Care: [care instructions]

BUNDLE AND SAVE!!!!!!

#[tags]

* We note major imperfections—minor signs of age or wear may not be listed, adding to the vintage character.

* High-quality piece, perfect for streetwear.
* Next-day shipping.
* All sales final.
```

---

## Example Workflow

### Input:
**Voice:** "vintage 90s Nike windbreaker, blue and white, large, excellent condition, small fade on logo, machine wash cold"

### What Happens:

1. **Voice Extraction Detects:**
   - era: "Vintage"
   - brand: (NOT detected - "Nike" needs manual entry)
   - color: "Blue/White"
   - size: "L"
   - condition: "Excellent"
   - flaws: "Small fade on logo"
   - care: "Machine wash cold"

2. **Step 4 Fields Auto-Fill:**
   - Era: "Vintage" ✅
   - Color: "Blue/White" ✅
   - Size: "L" ✅
   - Condition: "Excellent" ✅
   - Flaws: "Small fade on logo" ✅
   - Care: "Machine wash cold" ✅
   - Brand: (empty - you need to type "Nike")

3. **You Manually Add:**
   - Brand: "Nike" (type it)
   - Category: "Outerwear" (select from dropdown)
   - Measurements: Pit to Pit: 22, Length: 28

4. **Click "Generate AI Description"**

### Output:
```
Vintage 90s Nike windbreaker, blue and white


✠ SIZE- L
✠ Pit to pit- 22
✠ length- 28

Condition: Excellent
Flaws: Small fade on logo

Care: Machine wash cold

BUNDLE AND SAVE!!!!!!

#vintage #90s #nike #outerwear #blue #white #l

* We note major imperfections—minor signs of age or wear may not be listed, adding to the vintage character.

* High-quality piece, perfect for streetwear.
* Next-day shipping.
* All sales final.
```

---

## Supported Extractions

### Size Detection:
- **Keywords:** small, medium, large, x-large, xx-large, XS, S, M, L, XL, XXL
- **Variations:** "extra large", "x large", "xlarge" all → "XL"

### Color Detection:
- **Keywords:** black, white, red, blue, green, yellow, pink, purple, gray, grey, brown, orange, navy, maroon, burgundy, cream, beige, tan, olive, khaki
- **Multi-color:** "black and white" → "Black/White"
- **Limit:** Max 2 colors combined

### Material Detection:
- **Keywords:** cotton, polyester, denim, leather, wool, silk, fleece, nylon, linen, cashmere

### Condition Detection:
- **"NWT":** "new with tags", "nwt", "brand new"
- **"Like New":** "like new", "mint", "pristine"
- **"Excellent":** "excellent", "great condition"
- **"Good":** "good condition", "gently used"
- **"Fair":** "fair", "worn"

### Era Detection:
- **Keywords:** vintage, retro, 90s, 80s, 70s, 60s, y2k, modern, contemporary

### Flaws Detection:
- **Patterns:** "flaws: ...", "stain: ...", "hole: ...", "damage: ...", "has a small stain"
- **Extraction:** Takes the description after the keyword

### Care Detection:
- **Keywords:** machine wash, hand wash, dry clean, wash cold, wash warm
- **Extraction:** Takes surrounding context

---

## Priority System

When generating description:

1. **Manual entry** (you typed it) = HIGHEST priority
2. **Voice extraction** (system detected) = Used if field empty
3. **Category preset** (auto-filled from category) = Lowest priority

Example:
- Voice says: "large"
- Preset says: "M" (from category default)
- You type: "XL"
- **Result: "XL"** (manual wins)

---

## Code Location

**Extraction Function:**
- File: `src/lib/textAIService.ts`
- Function: `extractFieldsFromVoice()`
- Lines: 40-119

**Description Generator:**
- Function: `generateProductDescription()`
- Lines: 129-153
- Returns: `AIGeneratedContent` with `extractedFields`

**Integration:**
- File: `src/components/ProductDescriptionGenerator.tsx`
- Lines: 786-800
- Passes: voiceDescription, brand, color, size, material, condition, era, style, category, measurements, **flaws**, **care**

---

## Future Enhancements

Could add extraction for:
- [ ] Brand names (risky - need brand database)
- [ ] Model numbers ("style #123")
- [ ] Measurements from voice ("22 inch pit to pit")
- [ ] Price ("asking $50")
- [ ] Multiple flaws ("small stain and tiny hole")
- [ ] Style tags ("grunge", "preppy", "streetwear")
