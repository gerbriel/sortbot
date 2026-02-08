# Product Description Format Guide

## Updated Format - Clean Vintage Style

The product descriptions now follow a cleaner, more professional vintage resale format that emphasizes:
- **Measurements first** with ✠ bullets
- **Clean narrative descriptions** without forced keywords
- **Only include brand/material when explicitly mentioned**
- **Standard disclaimers and policies**
- **Hashtag-style tags** (lowercase, no spaces)

---

## Format Template

```
[SIZE] - [Era] [Brand if mentioned] [Category] [Key Descriptors] [Colorway]

✠ SIZE - [Size]
✠ PIT TO PIT - [measurement]"
✠ LENGTH - [measurement]"
✠ SLEEVE - [measurement]" (if applicable)
✠ SHOULDER - [measurement]" (if applicable)

[Natural description paragraph from voice input - cleaned up]

[Material construction details IF EXPLICITLY MENTIONED] with [fit style] typical of the era. [Made in USA tag if applicable]. [Vintage character note if applicable].

[Condition statement based on grading]

Condition shown in pictures. Minor signs of wear consistent with vintage age may not be individually listed.

[High-quality/Highly collectible] piece suited for everyday wear or collection.

Next-day shipping.
All sales final.

#hashtag #tags #nospaces #lowercase
```

---

## Real Example (Your Format)

```
Large - Vintage 1990s Nike Crewneck Sweatshirt Embroidered Swoosh Minimal Athletic Navy/White

✠ SIZE - Large
✠ PIT TO PIT - 23"
✠ LENGTH - 27"

Classic 1990s Nike crewneck featuring a clean embroidered swoosh front hit in a navy and white colorway.

Heavyweight cotton construction with a boxy fit typical of the era. Made in USA tag. Soft natural fade throughout that adds character without structural flaws.

Light vintage wear consistent with age.

Condition shown in pictures. Minor signs of wear consistent with vintage age may not be individually listed.

High-quality piece suited for everyday wear or collection.

Next-day shipping.
All sales final.

#nike #90s #crewneck #sportswear #boxyfit
```

---

## Generated Example 1: Generic Band Tee (No Brand)

**Voice Input**: "vintage black rolling stones band tee large with cracked print"

**Generated Output**:
```
Large - Vintage Rolling Stones Band Tee Black

✠ SIZE - Large
✠ PIT TO PIT - 22"
✠ LENGTH - 28"

Vintage black rolling stones band tee large with cracked print.

Light vintage wear consistent with age.

Flaws: cracked print

Condition shown in pictures. Minor signs of wear consistent with vintage age may not be individually listed.

High-quality piece suited for everyday wear or collection.

Next-day shipping.
All sales final.

#vintage #tees #graphic
```

Note: Brand name "Rolling Stones" NOT added to tags since it's not a brand, it's the graphic subject.

---

## Generated Example 2: Nike Air Force 1 (Brand Mentioned)

**Voice Input**: "white nike air force 1 sneakers size 10 good condition"

**Generated Output**:
```
10 - Nike Air Force 1 Sneakers White

✠ SIZE - 10

White nike air force 1 sneakers size 10 good condition.

Good vintage condition with moderate wear throughout.

Condition shown in pictures. Minor signs of wear consistent with vintage age may not be individually listed.

Highly collectible piece suited for collection or everyday wear.

Next-day shipping.
All sales final.

#nike #sneakers #athletic
```

Note: "Nike" included in tags BECAUSE it was mentioned in voice input.

---

## Generated Example 3: Carhartt Detroit Jacket

**Voice Input**: "brown carhartt detroit jacket medium heavyweight cotton duck canvas boxy fit"

**Generated Output**:
```
Medium - Carhartt Detroit Jacket Brown

✠ SIZE - Medium
✠ PIT TO PIT - 24"
✠ LENGTH - 28"
✠ SLEEVE - 25"

Brown carhartt detroit jacket medium heavyweight cotton duck canvas boxy fit.

Heavyweight cotton construction with a boxy fit. Soft natural fade throughout that adds character without structural flaws.

Light vintage wear consistent with age.

Condition shown in pictures. Minor signs of wear consistent with vintage age may not be individually listed.

Highly collectible piece suited for collection or everyday wear.

Next-day shipping.
All sales final.

#carhartt #outerwear #workwear #heavyweight #boxyfit
```

Note: "Carhartt" AND "heavyweight cotton" mentioned → included in description. "Boxy fit" mentioned → added to tags.

---

## Generated Example 4: Generic Sweatshirt (No Brand Mentioned)

**Voice Input**: "oversized navy blue crewneck sweatshirt no graphics size large"

**Generated Output**:
```
Large - Oversized Navy Blue Crewneck Sweatshirt

✠ SIZE - Large
✠ PIT TO PIT - 25"
✠ LENGTH - 28"

Oversized navy blue crewneck sweatshirt no graphics size large.

Light vintage wear consistent with age.

Condition shown in pictures. Minor signs of wear consistent with vintage age may not be individually listed.

High-quality piece suited for everyday wear or collection.

Next-day shipping.
All sales final.

#sweatshirts #oversized #crewneck #minimal
```

Note: NO brand mentioned → NO brand in description or tags. Clean and simple.

---

## Key Rules Implemented

### 1. **Brand Inclusion Logic**
- ✅ Include brand IF mentioned in voice description OR manually typed
- ❌ Don't add brand from intelligent matcher if not spoken/typed
- Example: If user says "vintage tee" (no brand) → don't add "Nike" even if AI detects swoosh

### 2. **Material Inclusion Logic**
- ✅ Include material IF explicitly mentioned in voice
- ❌ Don't add generic "cotton" or "polyester" unless user says it
- Example: User says "heavyweight cotton" → include. User silent on material → omit.

### 3. **Title Format**
- Start with SIZE if available
- Add era/vintage marker (Vintage, 1990s, etc.)
- Add BRAND only if explicitly mentioned
- Add category/garment type
- Add key descriptive words from voice
- Add colorway at end (Navy/White format)

### 4. **Measurements Section**
- Use ✠ bullet character (not •)
- All caps labels: SIZE, PIT TO PIT, LENGTH, etc.
- Appears at TOP of description, before narrative

### 5. **Description Narrative**
- Use actual voice description, cleaned up
- Don't force keywords or rewrite unnecessarily
- Add construction details ONLY if materials mentioned
- Add fit style if mentioned (boxy, oversized, etc.)
- Add era context if vintage

### 6. **Condition Section**
- Map condition grades to natural phrases:
  - NWT → "Brand new with tags. Deadstock condition."
  - Like New → "Excellent vintage condition with minimal signs of wear."
  - Excellent → "Light vintage wear consistent with age."
  - Good → "Good vintage condition with moderate wear throughout."
  - Fair → "Fair condition with noticeable wear and character."
- Add flaws section if specific flaws mentioned

### 7. **Standard Disclaimers**
- Always include: "Condition shown in pictures. Minor signs of wear consistent with vintage age may not be individually listed."
- Collectibility: Use "Highly collectible" for 8+ score, "High-quality" for others
- Always end with: "Next-day shipping.\nAll sales final."

### 8. **Tags Format**
- Lowercase, no spaces: `#nike` not `#Nike`
- Remove spaces: `#boxyfit` not `#boxy fit`
- Only include brand if mentioned in voice/manual
- Add style keywords from voice (oversized, heavyweight, crewneck, etc.)
- Add era markers (90s, vintage, etc.)
- Example: `#nike #90s #crewneck #sportswear #boxyfit`

---

## Before vs After Comparison

### BEFORE (Old Format - Too Verbose)
```
Vintage Nike black crewneck sweatshirt. Classic 1990s piece featuring embroidered swoosh. This is a vintage tee perfect for any wardrobe. Don't miss out on this quality piece.

Tagged L, fits true to size.

Condition: Excellent condition, no major flaws noted.

Measurements:
• Pit to pit: 23"
• Length: 27"

Material: Cotton

Compare measurements to your favorites for best fit!
```

### AFTER (New Format - Clean & Professional)
```
Large - Vintage 1990s Nike Crewneck Sweatshirt Embroidered Swoosh Minimal Athletic Navy/White

✠ SIZE - Large
✠ PIT TO PIT - 23"
✠ LENGTH - 27"

Classic 1990s Nike crewneck featuring a clean embroidered swoosh front hit in a navy and white colorway.

Heavyweight cotton construction with a boxy fit typical of the era. Made in USA tag. Soft natural fade throughout that adds character without structural flaws.

Light vintage wear consistent with age.

Condition shown in pictures. Minor signs of wear consistent with vintage age may not be individually listed.

High-quality piece suited for everyday wear or collection.

Next-day shipping.
All sales final.

#nike #90s #crewneck #sportswear #boxyfit
```

---

## Voice Input Best Practices

To get the best descriptions, speak naturally and include:

✅ **DO mention**: Brand if you know it, material if visible, fit style, era, colorway, condition
✅ **DO say**: "heavyweight cotton", "boxy fit", "made in usa", "embroidered logo"
✅ **DO include**: Any unique features like "cracked vintage print", "selvedge denim", "contrast stitching"

❌ **DON'T force**: Generic keywords like "perfect for your wardrobe"
❌ **DON'T add**: Brand names if you're unsure
❌ **DON'T say**: "This is a great piece" (description adds this automatically)

### Good Example
"1990s nike crewneck sweatshirt large navy blue with embroidered swoosh heavyweight cotton boxy fit made in usa light wear"

### Bad Example
"nike sweatshirt great quality perfect for collection rare vintage must have"

---

## Collectibility Scoring

The system automatically adds collectibility context:

- **Score 8-10**: "Highly collectible piece suited for collection or everyday wear."
- **Score 1-7**: "High-quality piece suited for everyday wear or collection."

This is determined by the intelligent matcher based on:
- Model rarity (Levi's 501, Nike AF1, etc.)
- Era (1990s, 1980s, deadstock)
- Brand heritage
- Construction quality

---

## Next Steps

1. **Test the new format** with real voice inputs
2. **Verify measurements display** properly with ✠ bullets
3. **Check tag generation** matches hashtag style
4. **Confirm brand omission** when not mentioned
5. **Export to Shopify** with new format
6. **Update Google Sheets** exporter to handle new structure

---

## Implementation Files

- `/src/components/ProductDescriptionGenerator.tsx` - Main generator logic
- `formatMeasurements()` - Handles ✠ SIZE bullet format
- `formatCondition()` - Maps condition grades to natural phrases
- Tag generation - Lowercase, no-space hashtag format
- SEO title generation - Size-first format

---

## Summary

The new format is:
- **Cleaner** - No forced keywords or marketing fluff
- **More professional** - Industry-standard vintage resale style
- **Honest** - Only includes what's actually mentioned/visible
- **Consistent** - Standard disclaimers and policies
- **SEO-friendly** - Natural descriptions with relevant hashtags
- **Trust-building** - Measurements first, clear condition grading

This matches the format used by successful vintage resellers and builds customer trust through transparency and professionalism.
