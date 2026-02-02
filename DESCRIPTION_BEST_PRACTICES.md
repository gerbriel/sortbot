# Product Description Best Practices

## Parameters for Natural, Accurate Descriptions

### 1) Item Facts (Hard Requirements)

**Must-have fields to prevent hallucinations:**
- ✅ Category (tee, denim, dress, jacket, sweater, etc.)
- ✅ Brand (or "unbranded/vintage tag missing")
- ✅ Size on tag + recommended fit (e.g., "tag says L, fits like M")
- ✅ Measurements (pit-to-pit, length, waist, inseam, rise, shoulder, sleeve)
- ✅ Material (or "unknown")
- ✅ Color(s) (primary + accents)
- ✅ Era / vibe (90s, Y2K, workwear, cottagecore, etc.)
- ✅ Condition grade (NWT, excellent, good, fair) + flaws
- ✅ Care instructions (machine wash cold, dry clean only, unknown)
- ✅ Unique details (graphic, embroidery, distressing, pleats, lining, hardware)

**"Do not assume" toggle:**
- If a field is blank/unknown, say "unknown" or omit — do not invent

---

### 2) Audience + Vibe Controls

**Tone options:**
- "friendly casual"
- "cool streetwear"
- "minimal + premium"
- "playful / cheeky"
- "vintage nerd (detail-y)"

**Energy level:** 1–5 (low-key → hype)

**Slang level:** none / light / moderate

**Voice:** first-person "I found…" vs neutral "This piece…"

**Sentence style:** short & punchy vs longer & descriptive

**Emoji:** none / light / yes

**Shop persona presets:**
- "curated vintage boutique"
- "Depop/Y2K reseller"
- "outdoors/workwear thrift"
- "minimalist capsule wardrobe"
- "western/americana"

---

### 3) Structure Controls

**Format types:**
1. Short + punchy (2–4 lines)
2. Standard Shopify (paragraph + bullets)
3. SEO-leaning (still human, but includes keywords)
4. Story-style (tiny narrative, then facts)

**Include sections (checkboxes):**
- Hook line
- Fit notes
- Condition / flaws
- Measurements
- Styling suggestions ("wear it with…")
- Shipping/returns snippet

---

### 4) "Natural Speech" Guardrails

**Reading level:** 6–9 (perfect for conversational)

**Banned phrases list:**
- ❌ "perfect for any occasion"
- ❌ "timeless piece"
- ❌ "elevate your wardrobe"
- ❌ "must-have" (unless intentional)

**Rules:**
- Avoid repetition (don't say "vintage" more than once)
- Max adjectives: 6–10
- No overclaiming if not verified (authenticity, era, material, brand specifics, "rare", "deadstock")
- Truthfulness rule: if uncertain, use "seems like / feels like / appears to be" or skip

---

### 5) Shopify-Specific Outputs

**Product title styles:**
- "Brand + Item + Key detail + Size"
- "Color + Item + Era vibe + Size"

**Outputs:**
- Description (paragraph)
- Bullet facts (condition, measurements, material)
- Tags / keywords (10–20)
- Google Shopping short description (optional)
- Alt text for images (optional)

---

### 6) SEO Without Sounding Robotic

**Parameters:**
- Primary keyword (e.g., "vintage Levi's 501 jeans")
- Secondary keywords (3–6)
- Avoid keyword stuffing (limit exact match uses to 1–2)
- Location terms (optional): "USA made", "Made in Mexico" (only if on tag)

---

### 7) Safety + Customer Trust

**Transparency:**
- Flaw transparency level (light / clear / extra detailed)
- Returns language (firm vs friendly)
- Fit disclaimer: "compare to measurements"
- Condition disclaimer: "pre-owned vintage may show wear"

---

### 8) Best-Practice Default Set

**Recommended defaults:**
- Tone: friendly casual
- Energy: 3/5
- Slang: light
- Emojis: none or light
- Format: paragraph + bullets
- Include: hook + fit notes + condition + measurements
- Guardrails: banned phrases ON, max adjectives 8, no assumptions ON

---

### 9) Shop's Phrase Bank

**Add your favorite phrases (5–15 lines) to sound like YOU:**

Examples:
- "easy throw-on"
- "solid everyday piece"
- "broken-in feel"
- "boxy fit"
- "soft and drapey"
- "oversized fit, size down for TTS"
- "perfect vintage fade"
- "lived-in look"
- "clean and ready to wear"
- "minor wear consistent with age"
- "no major flaws"
- "sturdy construction"
- "buttery soft"
- "roomy through the body"
- "cropped at the ankle"

---

## Implementation Notes

### Current System
- ✅ Color detection
- ✅ Size detection
- ✅ Category selection
- ✅ Voice input for details
- ✅ AI generation with OpenAI

### Enhancements Needed
1. Add condition grade selector (NWT, Excellent, Good, Fair)
2. Add measurement input fields
3. Add material/fabric input
4. Add era/vibe selector
5. Add tone/persona selector
6. Add format type selector
7. Implement banned phrases filter
8. Add phrase bank customization
9. Add "do not assume" mode toggle
10. Add SEO keyword inputs

### Priority Improvements
1. **Condition & Flaws** - Critical for trust
2. **Measurements** - Essential for online clothing
3. **Fit Notes** - Reduces returns
4. **Tone Controls** - Makes it sound authentic
5. **Banned Phrases** - Removes AI tells

---

## Example Outputs

### Current (Basic)
```
Discover this quality blue outerwear piece. Blue and white athletic 
Lakers jacket mid 2000's era extra large. Perfect for any wardrobe. 
Don't miss out on this quality piece.
```
❌ Generic, AI-sounding, no useful details

### Improved (With Parameters)
```
Vintage Lakers warmup jacket from the mid-2000s in blue and white. 
Tagged XL, fits true to size with a roomy athletic cut.

Condition: Good vintage — minor pilling on sleeves, no holes or stains.

Measurements:
• Pit to pit: 24"
• Length: 28"
• Sleeve: 26"

Material feels like polyester/nylon blend. Full zip, side pockets, 
elastic cuffs and waist. Compare measurements to your favorites!
```
✅ Natural, detailed, useful, trustworthy

---

## Status: Guidelines Documented

**Next steps:**
1. Implement advanced input fields
2. Add tone/persona presets
3. Create banned phrases filter
4. Add phrase bank customization
5. Enhance AI prompt with these parameters

These guidelines will dramatically improve description quality! 🎯
