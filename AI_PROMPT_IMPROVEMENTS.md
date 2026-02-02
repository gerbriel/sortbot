# Improved AI Description Generation Prompt

## System Prompt for Natural Product Descriptions

```
You are an experienced vintage clothing reseller creating product descriptions for online sales. Write descriptions that sound natural, honest, and conversational - like a real person talking about clothes they're selling.

CRITICAL RULES:
1. BE FACTUAL - Only use information explicitly provided. If something is unknown, say "unknown" or omit it.
2. NO FLUFF - Banned phrases: "perfect for any occasion", "timeless piece", "elevate your wardrobe", "must-have", "wardrobe staple"
3. BE SPECIFIC - Use actual measurements, known flaws, real condition details
4. BE HONEST - If condition is Fair, say it. If there are flaws, mention them clearly.
5. KEEP IT CONVERSATIONAL - Write like you're describing the item to a friend. Reading level: 8th grade.
6. MAX 8 ADJECTIVES total
7. Don't repeat the same word more than once (especially "vintage", "quality", "perfect")
8. Use "seems like", "appears to be", "feels like" for uncertain details

STRUCTURE:
1. Hook (1-2 sentences mentioning key features)
2. Condition & Flaws (be specific)
3. Measurements (if provided)
4. Material & Care (if known)
5. Fit notes (if applicable)

TONE: Friendly casual, not salesy. Think: "checking out cool thrift finds" not "luxury boutique"
```

## Example Input

```json
{
  "category": "Tees",
  "voiceDescription": "blue and white athletic Lakers jacket mid 2000's era extra large",
  "brand": "unknown",
  "condition": "Good",
  "flaws": "minor pilling on sleeves, no holes",
  "material": "unknown",
  "size": "XL",
  "measurements": {
    "pitToPit": "24",
    "length": "28",
    "sleeve": "26"
  },
  "era": "mid-2000s",
  "care": "machine wash cold"
}
```

## Example BAD Output (AI-sounding)

```
Discover this timeless Lakers jacket - a must-have piece that will elevate your wardrobe! 
Perfect for any occasion, this versatile piece offers unparalleled style and comfort. 
Premium quality construction ensures lasting durability. Don't miss this opportunity to own 
a piece of Lakers history!
```

❌ Problems:
- Banned phrases ("timeless", "must-have", "elevate", "perfect for any occasion")
- Too many adjectives
- Overclaiming ("unparalleled", "premium quality")
- No specific details
- Salesy tone

## Example GOOD Output (Natural)

```
Mid-2000s Lakers warmup jacket in blue and white. Tagged XL, fits true to size with a 
roomy athletic cut.

Condition: Good vintage wear - minor pilling on sleeves, but no holes or stains. Clean 
and ready to wear.

Measurements:
• Pit to pit: 24"
• Length: 28"
• Sleeve: 26"

Material feels like polyester or nylon blend. Full zip, side pockets, elastic cuffs and 
waist. Machine wash cold. Compare measurements to your favorites!
```

✅ Good because:
- Factual and specific
- Honest condition (mentions pilling)
- Useful measurements
- No banned phrases
- Natural conversational tone
- "Feels like" for uncertain material
- Helpful note to compare measurements

## Implementation Notes

### Fields to Include in Prompt

```typescript
const promptData = {
  category: item.category,
  voiceDescription: item.voiceDescription,
  brand: item.brand || "unbranded",
  condition: item.condition || "condition unknown",
  flaws: item.flaws || "no major flaws noted",
  material: item.material || "material unknown",
  size: item.size || "size not listed",
  measurements: item.measurements || {},
  era: item.era || "",
  care: item.care || "care instructions unknown"
};
```

### Banned Phrases to Filter

```typescript
const BANNED_PHRASES = [
  "perfect for any occasion",
  "timeless piece",
  "elevate your wardrobe",
  "must-have",
  "wardrobe staple",
  "unparalleled",
  "premium quality" (unless verified),
  "luxury" (unless verified brand),
  "investment piece",
  "you won't find another",
  "holy grail",
  "game changer",
  "essential piece"
];

// Filter function
function removeBannedPhrases(text: string): string {
  let filtered = text;
  BANNED_PHRASES.forEach(phrase => {
    const regex = new RegExp(phrase, 'gi');
    filtered = filtered.replace(regex, '');
  });
  // Clean up double spaces
  return filtered.replace(/\s+/g, ' ').trim();
}
```

### Custom Phrase Bank (Shop Persona)

```typescript
const SHOP_PHRASES = [
  "easy throw-on",
  "solid everyday piece",
  "broken-in feel",
  "boxy fit",
  "soft and drapey",
  "oversized fit, size down for TTS",
  "perfect vintage fade",
  "lived-in look",
  "clean and ready to wear",
  "minor wear consistent with age",
  "no major flaws",
  "sturdy construction",
  "buttery soft",
  "roomy through the body",
  "cropped at the ankle"
];

// Randomly select 1-2 phrases to include
function getShopPhrases(): string[] {
  const shuffled = [...SHOP_PHRASES].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, Math.floor(Math.random() * 2) + 1);
}
```

### Measurement Formatting

```typescript
function formatMeasurements(measurements: any): string {
  if (!measurements) return "";
  
  const lines = [];
  if (measurements.pitToPit) lines.push(`• Pit to pit: ${measurements.pitToPit}"`);
  if (measurements.length) lines.push(`• Length: ${measurements.length}"`);
  if (measurements.sleeve) lines.push(`• Sleeve: ${measurements.sleeve}"`);
  if (measurements.shoulder) lines.push(`• Shoulder: ${measurements.shoulder}"`);
  if (measurements.waist) lines.push(`• Waist: ${measurements.waist}"`);
  if (measurements.inseam) lines.push(`• Inseam: ${measurements.inseam}"`);
  if (measurements.rise) lines.push(`• Rise: ${measurements.rise}"`);
  
  if (lines.length === 0) return "";
  
  return `\n\nMeasurements:\n${lines.join('\n')}`;
}
```

### Condition Transparency

```typescript
function formatCondition(condition?: string, flaws?: string): string {
  if (!condition) return "";
  
  const conditionMap = {
    'NWT': 'Brand new with tags',
    'Excellent': 'Excellent condition',
    'Good': 'Good vintage condition',
    'Fair': 'Fair condition with wear'
  };
  
  let text = conditionMap[condition] || condition;
  
  if (flaws && flaws.trim()) {
    text += ` - ${flaws}`;
  } else if (condition !== 'NWT') {
    text += ' - no major flaws noted';
  }
  
  return `\n\nCondition: ${text}.`;
}
```

## Status

This improved system will generate descriptions that:
- ✅ Sound like a real person
- ✅ Are factually accurate
- ✅ Build trust with transparency
- ✅ Reduce returns with measurements
- ✅ Avoid AI detection
- ✅ Match your shop's voice
