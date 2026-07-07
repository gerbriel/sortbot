/**
 * Text-based AI service using Hugging Face Inference API
 * Uses text-only models (no vision) - FREE and working!
 */

import { COLOR_WORDS_LIST } from './colorDatabase';

/**
 * Truncate a string for SEO description without cutting mid-word or mid-sentence.
 * Tries to end at a sentence boundary within the target range, then a word boundary.
 */
export function smartSeoTruncate(text: string, target = 320, flex = 40): string {
  if (text.length <= target + flex) return text;
  const max = target + flex;
  const min = target - flex;
  const sentenceEnd = /[.!?](?:\s|$)/g;
  let lastSentence = -1;
  let m: RegExpExecArray | null;
  while ((m = sentenceEnd.exec(text)) !== null) {
    const pos = m.index + 1;
    if (pos >= min && pos <= max) return text.slice(0, pos).trimEnd();
    if (pos > max) break;
    if (pos >= min) lastSentence = pos;
  }
  if (lastSentence > 0) return text.slice(0, lastSentence).trimEnd();
  const wordEnd = text.lastIndexOf(' ', max);
  if (wordEnd >= min) return text.slice(0, wordEnd).trimEnd();
  return text.slice(0, target).trimEnd();
}

interface ProductContext {
  voiceDescription?: string;
  customDescription?: string; // Voice-dictated note injected after the title line
  title?: string;  // Pre-existing product title to use as the description opener
  brand?: string;
  color?: string;
  secondaryColor?: string;
  size?: string;
  material?: string;
  condition?: string;
  era?: string;
  style?: string;
  type?: string;   // Garment type (e.g., "Sweater", "Hoodie") from productType field
  category?: string;
  measurements?: Record<string, string>;
  flaws?: string;
  care?: string;
  modelName?: string;
  gender?: string;
  price?: number;
  tags?: string[];
  presetTags?: string[];  // default_tags from the matched category preset
}

export interface AIGeneratedContent {
  description: string;
  suggestedTitle?: string;
  suggestedTags?: string[];
  extractedFields?: { // Fields extracted from voice description
    brand?: string;
    modelName?: string;
    color?: string;
    secondaryColor?: string;
    size?: string;
    material?: string;
    condition?: string;
    era?: string;
    style?: string;
    type?: string;       // Garment type from "type X period" voice command
    gender?: string;
    measurements?: Record<string, string>;
    price?: string;
    flaws?: string;
    care?: string;
    tags?: string[];
    seoTitle?: string;
    customDescription?: string;
  };
}

/**
 * Extract fields from voice description using "field name <value> period" syntax.
 *
 * Supported commands (say the field name, then the value, then "period"):
 *   "brand gucci period"
 *   "size extra large period"
 *   "color black period"
 *   "material cotton period"
 *   "condition excellent period"
 *   "era 1980s period"
 *   "style streetwear period"
 *   "gender mens period"
 *   "model air force one period"
 *   "price 45 period"
 *   "flaws small stain on sleeve period"
 *   "care machine wash cold period"
 *   "width 22 period"
 *   "length 28 period"
 *   "waist 32 period"
 *   "shoulder 18 period"
 *   "sleeve 25 period"
 *   "tags graphic print period"
 *
 * Anything NOT in a field command stays in the main description text.
 */
function extractFieldsFromVoice(rawVoiceDesc: string, _category?: string): Record<string, any> {
  const extracted: Record<string, any> = {};
  // Normalize newlines → spaces so command regexes work even after formatVoiceTranscript
  // has already inserted \n before each trigger word.
  // Also normalize "." back to " period" so that transcripts where the period
  // delimiter was already converted to a dot (display format) still parse correctly.
  // `let` because the matched "description … period" span is scrubbed out
  // before the other Pass-1 commands run (see the DESCRIPTION block below).
  let voiceDesc = rawVoiceDesc
    .replace(/\n/g, ' ')
    .replace(/\.(?=\s|$)/g, ' period')
    .replace(/\s{2,}/g, ' ');
  // Lowercased FULL text (description included) — Pass 2's color/material/etc.
  // word scanning should still see description words.
  const lower = voiceDesc.toLowerCase();

  // ─────────────────────────────────────────────────────────────────────────
  // PASS 1: Explicit "field value period" commands (highest priority)
  // ─────────────────────────────────────────────────────────────────────────

  // Helper: grab value between a field trigger and the word "period".
  // Guards against cross-field contamination: if the captured value contains a
  // field trigger keyword followed by at least one more word (indicating a new
  // command started without a preceding "period"), truncate at that boundary.
  // Example: "brand quicksilver size xl period" → primary regex captures
  // "quicksilver size xl" → trimmed to "quicksilver" before "size xl".
  const FIELD_BOUNDARY_RE =
    /^(.*?)\b(?:brand|model|size|colou?r|secondary|second|accent|material|fabric|condition|era|style|type|gender|price|flaws?|care|width|length|waist|shoulder|sleeve|inseam|outseam|tags?|title|description)\s+\w/i;

  function extractCommand(pattern: RegExp): string | null {
    const match = voiceDesc.match(pattern);
    if (!match) return null;
    const val = match[1].trim();
    const boundary = val.match(FIELD_BOUNDARY_RE);
    return boundary ? (boundary[1].trim() || null) : val;
  }

  // ── DESCRIPTION (freeform note) ─────────────────────────────────────────
  // Deliberately NOT using extractCommand here: natural narration is full of
  // words that double as field triggers ("style", "sleeve", "length", "care"…)
  // and the FIELD_BOUNDARY_RE guard was chopping descriptions at the first one.
  // "description … period" captures EVERYTHING up to the first "period".
  let descriptionCmd: string | null = null;
  const descMatch = voiceDesc.match(/\bdescription\s+(.+?)\s+period\b/i);
  if (descMatch) {
    descriptionCmd = descMatch[1].trim();
    // Scrub the description span so its words ("long sleeve", "boxy style"…)
    // can't be picked up as field commands by the extractors below.
    voiceDesc = voiceDesc.replace(descMatch[0], ' ').replace(/\s{2,}/g, ' ');
  } else {
    // No closing "period" (recording cut off) — fall back to the keyword
    // boundary so a following command can't bleed in.
    const m = voiceDesc.match(/\bdescription\s+(.+?)(?=\s+(?:brand|model|size|colou?r|secondary|second|accent|material|fabric|condition|era|style|gender|price|flaws?|care|width|length|waist|shoulder|sleeve|inseam|outseam|tags?|title)\b|$)/i);
    if (m) {
      descriptionCmd = m[1].trim();
      voiceDesc = voiceDesc.replace(m[0], ' ').replace(/\s{2,}/g, ' ');
    }
  }
  if (descriptionCmd) extracted.customDescription = descriptionCmd;

  // ── BRAND ────────────────────────────────────────────────────────────────
  // ── BRAND ──────────────────────────────────────────────────────────────────
  // Primary: "brand X period" (explicit command)
  // Fallback 1: "brand X." (period already converted to dot by formatVoiceTranscript)
  // Fallback 2: "brand X" at end of line or end of string (fast speech, period dropped)
  let brand = extractCommand(/\bbrand\s+(.+?)\s+period\b/i);
  if (!brand) {
    // Fallback for fast speech where "period" delimiter is missing or dropped.
    // Capture everything after "brand " up to the next field trigger keyword or end of string.
    const m = voiceDesc.match(/\bbrand\s+(.+?)(?=\s+(?:model|size|colou?r|secondary|second|accent|material|fabric|condition|era|style|gender|price|flaws?|care|width|length|waist|shoulder|sleeve|inseam|outseam|tags?|title)\b|$)/i);
    if (m) brand = m[1].trim();
  }
  if (brand) extracted.brand = toTitleCase(brand);

  // ── MODEL ─────────────────────────────────────────────────────────────────
  let model = extractCommand(/\bmodel\s+(.+?)\s+period\b/i);
  if (!model) {
    const m = voiceDesc.match(/\bmodel\s+(.+?)(?=\s+(?:brand|size|colou?r|secondary|second|accent|material|fabric|condition|era|style|gender|price|flaws?|care|width|length|waist|shoulder|sleeve|inseam|outseam|tags?|title)\b|$)/i);
    if (m) model = m[1].trim();
  }
  if (model) extracted.modelName = toTitleCase(model);

  // ── SIZE ──────────────────────────────────────────────────────────────────
  // Accept: "size large period", "size 32 period", "size extra large period"
  // Also accept: "size: large" (colon variant from some STT engines)
  // "fits like" note: "size large fits like period" → "L (fits like)";
  // "size large fits like medium period" → "L (fits like M)". The note renders in
  // the description SIZE line only — titles/CSV strip it via normalizeSizeValue's default.
  const sizeRaw = extractCommand(/\bsize[:\s]+(.+?)\s+period\b/i);
  if (sizeRaw) {
    extracted.size = normalizeSizeValue(sizeRaw, { keepFitsLike: true });
  }

  // ── COLOR ─────────────────────────────────────────────────────────────────
  // Secondary color runs FIRST so "secondary/second/accent color X" is consumed
  // before the plain "color X" command gets a chance to match.
  // Accepts: "secondary color blue period", "secondary blue period",
  //          "second color blue period", "accent color blue period"
  const NEXT_FIELD = /brand|model|size|colou?r|material|fabric|condition|era|style|gender|price|flaws?|care|width|length|waist|shoulder|sleeve|inseam|outseam|tags?|title/i;

  let secondaryColorCmd =
    extractCommand(/\b(?:secondary\s+colou?r?|second\s+colou?r?|accent\s+colou?r?)\s+(.+?)\s+period\b/i);
  if (!secondaryColorCmd) {
    const m = voiceDesc.match(/\b(?:secondary\s+colou?r?|second\s+colou?r?|accent\s+colou?r?)\s+(.+?)(?=\s+(?:brand|model|size|colou?r|material|fabric|condition|era|style|gender|price|flaws?|care|width|length|waist|shoulder|sleeve|inseam|outseam|tags?|title)\b|$)/i);
    if (m) secondaryColorCmd = m[1].trim();
  }
  if (secondaryColorCmd) extracted.secondaryColor = toTitleCase(secondaryColorCmd);

  // Primary color — only matches plain "color X" not prefixed by secondary/second/accent
  let colorCmd =
    extractCommand(/(?<!secondary[\s])(?<!second[\s])(?<!accent[\s])\bcolou?r\s+(.+?)\s+period\b/i);
  if (!colorCmd) {
    // No-period fallback: "color blue" → stop at next field trigger
    const m = voiceDesc.match(/(?<!secondary[\s])(?<!second[\s])(?<!accent[\s])\bcolou?r\s+(.+?)(?=\s+(?:brand|model|size|secondary|second|accent|material|fabric|condition|era|style|gender|price|flaws?|care|width|length|waist|shoulder|sleeve|inseam|outseam|tags?|title)\b|$)/i);
    if (m) colorCmd = m[1].trim();
  }
  if (colorCmd) {
    const parts = colorCmd.split(/\s+and\s+|\s*\/\s*/i).filter(Boolean);
    extracted.color = toTitleCase(stripColorModifiers(parts[0]));
    if (parts[1] && !extracted.secondaryColor) extracted.secondaryColor = toTitleCase(stripColorModifiers(parts[1]));
    void NEXT_FIELD; // used in fallback regexes above
  }

  // ── MATERIAL ──────────────────────────────────────────────────────────────
  let materialCmd = extractCommand(/\b(?:material|fabric)\s+(.+?)\s+period\b/i);
  if (!materialCmd) {
    const m = voiceDesc.match(/\b(?:material|fabric)\s+(.+?)(?=\s+(?:brand|model|size|colou?r|secondary|second|accent|condition|era|style|gender|price|flaws?|care|width|length|waist|shoulder|sleeve|inseam|outseam|tags?|title)\b|$)/i);
    if (m) materialCmd = m[1].trim();
  }
  if (materialCmd) {
    // Store only the primary material name (strips "50% " prefix) so Shopify fabric GID lookup works.
    // The full composition string is kept in the raw voice text and surfaced in the AI description.
    extracted.material = toTitleCase(primaryMaterial(materialCmd));
  }

  // ── CONDITION ─────────────────────────────────────────────────────────────
  let condRaw = extractCommand(/\bcondition\s+(.+?)\s+period\b/i);
  if (!condRaw) {
    const m = voiceDesc.match(/\bcondition\s+(.+?)(?=\s+(?:brand|model|size|colou?r|secondary|second|accent|material|fabric|era|style|gender|price|flaws?|care|width|length|waist|shoulder|sleeve|inseam|outseam|tags?|title)\b|$)/i);
    if (m) condRaw = m[1].trim();
  }
  if (condRaw) extracted.condition = normalizeCondition(condRaw);

  // ── ERA ───────────────────────────────────────────────────────────────────
  let eraCmd = extractCommand(/\bera\s+(.+?)\s+period\b/i);
  if (!eraCmd) {
    const m = voiceDesc.match(/\bera\s+(.+?)(?=\s+(?:brand|model|size|colou?r|secondary|second|accent|material|fabric|condition|style|gender|price|flaws?|care|width|length|waist|shoulder|sleeve|inseam|outseam|tags?|title)\b|$)/i);
    if (m) eraCmd = m[1].trim();
  }
  if (eraCmd) extracted.era = normalizeEra(eraCmd);

  // ── STYLE ─────────────────────────────────────────────────────────────────
  let styleCmd = extractCommand(/\bstyle\s+(.+?)\s+period\b/i);
  if (!styleCmd) {
    const m = voiceDesc.match(/\bstyle\s+(.+?)(?=\s+(?:brand|model|size|colou?r|secondary|second|accent|material|fabric|condition|era|gender|price|flaws?|care|width|length|waist|shoulder|sleeve|inseam|outseam|tags?|title)\b|$)/i);
    if (m) styleCmd = m[1].trim();
  }
  if (styleCmd) extracted.style = toTitleCase(styleCmd);

  // ── TYPE (garment type) ───────────────────────────────────────────────────
  let typeCmd = extractCommand(/\btype\s+(.+?)\s+period\b/i);
  if (!typeCmd) {
    const m = voiceDesc.match(/\btype\s+(.+?)(?=\s+(?:brand|model|size|colou?r|secondary|second|accent|material|fabric|condition|era|style|gender|price|flaws?|care|width|length|waist|shoulder|sleeve|inseam|outseam|tags?|title)\b|$)/i);
    if (m) typeCmd = m[1].trim();
  }
  if (typeCmd) extracted.type = toTitleCase(typeCmd);

  // ── GENDER ────────────────────────────────────────────────────────────────
  let genderCmd = extractCommand(/\bgender\s+(.+?)\s+period\b/i);
  if (!genderCmd) {
    const m = voiceDesc.match(/\bgender\s+(.+?)(?=\s+(?:brand|model|size|colou?r|secondary|second|accent|material|fabric|condition|era|style|price|flaws?|care|width|length|waist|shoulder|sleeve|inseam|outseam|tags?|title)\b|$)/i);
    if (m) genderCmd = m[1].trim();
  }
  if (genderCmd) extracted.gender = normalizeGender(genderCmd);

  // ── PRICE ─────────────────────────────────────────────────────────────────
  let priceRaw = extractCommand(/\bprice[:\s]+(.+?)\s+period\b/i);
  if (!priceRaw) {
    const m = voiceDesc.match(/\bprice[:\s]+(.+?)(?=\s+(?:brand|model|size|colou?r|secondary|second|accent|material|fabric|condition|era|style|gender|flaws?|care|width|length|waist|shoulder|sleeve|inseam|outseam|tags?|title)\b|$)/i);
    if (m) priceRaw = m[1].trim();
  }
  if (priceRaw) {
    const directNum = priceRaw.replace(/[^0-9.]/g, '');
    if (directNum) {
      extracted.price = directNum;
    } else {
      const wordToNum: Record<string, number> = {
        zero:0,one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,
        eleven:11,twelve:12,thirteen:13,fourteen:14,fifteen:15,sixteen:16,seventeen:17,
        eighteen:18,nineteen:19,twenty:20,thirty:30,forty:40,fifty:50,sixty:60,
        seventy:70,eighty:80,ninety:90,hundred:100,
      };
      const tokens = priceRaw.toLowerCase().replace(/[^a-z\s]/g, '').replace(/\bdollars?\b/g, '').trim().split(/[\s-]+/);
      let total = 0, current = 0;
      for (const tok of tokens) {
        const n = wordToNum[tok];
        if (n === undefined) continue;
        if (n === 100) { current = (current || 1) * 100; }
        else if (n >= 20) { total += n; }
        else { current += n; }
      }
      total += current;
      if (total > 0) extracted.price = String(total);
    }
  }

  // ── FLAWS ─────────────────────────────────────────────────────────────────
  const flawsCmd = extractCommand(/\bflaws?\s+(.+?)\s+period\b/i);
  if (flawsCmd) extracted.flaws = flawsCmd;

  // ── CARE ──────────────────────────────────────────────────────────────────
  const careCmd = extractCommand(/\bcare\s+(.+?)\s+period\b/i);
  if (careCmd) extracted.care = careCmd;

  // ── MEASUREMENTS (explicit) ───────────────────────────────────────────────
  const measurements: Record<string, string> = {};

  const widthCmd = extractCommand(/\bwidth\s+(.+?)\s+period\b/i);
  if (widthCmd) measurements['width'] = widthCmd.replace(/[^0-9.]/g, '');
  // chest and pit-to-pit both route to width
  const chestCmd = extractCommand(/\b(?:chest|pit\s*(?:to|2)?\s*pit|p2p)\s+(.+?)\s+period\b/i);
  if (chestCmd && !measurements['width']) measurements['width'] = chestCmd.replace(/[^0-9.]/g, '');

  const lengthCmd = extractCommand(/\blength\s+(.+?)\s+period\b/i);
  if (lengthCmd) measurements['length'] = lengthCmd.replace(/[^0-9.]/g, '');

  const waistCmd = extractCommand(/\bwaist\s+(.+?)\s+period\b/i);
  if (waistCmd) measurements['waist'] = waistCmd.replace(/[^0-9.]/g, '');

  const shoulderCmd = extractCommand(/\bshoulder\s+(.+?)\s+period\b/i);
  if (shoulderCmd) measurements['shoulder'] = shoulderCmd.replace(/[^0-9.]/g, '');

  const sleeveCmd = extractCommand(/\bsleeve\s+(.+?)\s+period\b/i);
  if (sleeveCmd) measurements['sleeve'] = sleeveCmd.replace(/[^0-9.]/g, '');

  const inseamCmd = extractCommand(/\binseam\s+(.+?)\s+period\b/i);
  if (inseamCmd) measurements['inseam'] = inseamCmd.replace(/[^0-9.]/g, '');

  const outseamCmd = extractCommand(/\boutseam\s+(.+?)\s+period\b/i);
  if (outseamCmd) measurements['outseam'] = outseamCmd.replace(/[^0-9.]/g, '');

  const legOpeningCmd = extractCommand(/\bleg\s+opening\s+(.+?)\s+period\b/i);
  if (legOpeningCmd) measurements['leg_opening'] = legOpeningCmd.replace(/[^0-9.]/g, '');

  // ── TAGS (explicit) ───────────────────────────────────────────────────────
  // Support: "tags silvertab baggy wideleg period" OR "#silvertab #baggy #wideleg period"
  const tagsRaw = extractCommand(/\btags?\s+(.+?)\s+period\b/i);
  if (tagsRaw) {
    extracted.tags = tagsRaw
      // treat spoken "comma" and "hashtag" (or "hash") as delimiters
      .replace(/\b(comma|hashtag|hash)\b/gi, ',')
      .replace(/#/g, ',')
      .split(/[\s,]+/)
      .map((t: string) => t.toLowerCase())
      .filter(Boolean)
      .slice(0, 5);
  }

  // ── TITLE ─────────────────────────────────────────────────────────────────
  const titleCmd = extractCommand(/\btitle\s+(.+?)\s+period\b/i);
  if (titleCmd) extracted.seoTitle = titleCmd;

  // ─────────────────────────────────────────────────────────────────────────
  // PASS 2: Contextual fuzzy fallbacks (fire only when explicit command was NOT used)
  // These scan free-form natural speech for common patterns
  // ─────────────────────────────────────────────────────────────────────────

  // ── SIZE fallback ─────────────────────────────────────────────────────────
  // Handles spoken multi-word sizes ("extra large", "extra extra small", "double extra large")
  // as well as abbreviations (XL, XXS, 3XL) and numeric sizes (32, 32x30, 10.5)
  if (!extracted.size) {
    // Try multi-word spoken forms first (longest match wins)
    const multiWordSize = voiceDesc.match(
      /\b(triple\s+extra\s+large|triple\s+extra\s+small|double\s+extra\s+large|double\s+extra\s+small|extra\s+extra\s+extra\s+large|extra\s+extra\s+extra\s+small|extra\s+extra\s+large|extra\s+extra\s+small|extra\s+large|extra\s+small|one\s+size(?:\s+fits\s+(?:all|most))?)\b/i
    );
    if (multiWordSize) {
      extracted.size = normalizeSizeValue(multiWordSize[1]);
    } else {
      // Single-word / abbreviation / numeric fallback
      const sizeFallback = voiceDesc.match(
        /\b(?:size[:\s]+)?(5xl|4xl|3xl|xxxl|2xl|xxl|xl|large|medium|small|xxs|xs)\b/i
      );
      if (sizeFallback) {
        extracted.size = normalizeSizeValue((sizeFallback[1] || '').trim());
      } else {
        // Numeric sizes: "32", "32x30", "10.5" — guard against years and prices
        const numericSize = voiceDesc.match(/\bsize[:\s]+(\d{1,2}(?:[xX]\d{1,2})?(?:\.\d)?)\b/i);
        if (numericSize) {
          const raw = numericSize[1].trim();
          if (raw && !/^(19|20)\d{2}$/.test(raw)) {
            extracted.size = normalizeSizeValue(raw);
          }
        }
      }
    }
  }

  // ── BRAND fallback ────────────────────────────────────────────────────────
  // Scan for known brand names spoken naturally without the "brand X period" command.
  // Guard: only run this on actual voice transcripts (must contain the word "period" somewhere,
  // OR a field trigger pattern like "brand X period" / "brand X.") so that re-parsing a
  // generated description doesn't false-match brand names.
  const looksLikeVoiceTranscript = /\bperiod\b/i.test(voiceDesc) ||
    /\b(?:brand|size|colou?r|material|condition|era|style|gender|price)\s+\S.*?\s+period\b/i.test(voiceDesc);
  if (!extracted.brand && looksLikeVoiceTranscript) {
    const KNOWN_BRANDS = [
      // ── Numbers / Symbols ─────────────────────────────────────────────────
      '212 NYC', '47', '49 Neon', '5.11 Tactical', '5.11 Tactical Series', '96 North',
      // ── A ─────────────────────────────────────────────────────────────────
      'AAA', 'Abercrombie & Fitch', 'Abercrombie', 'ACDC', 'Acme', 'Activision',
      'Adidas', 'adidas', 'Adiktd Jeans', 'Aeropostale', 'Affliction', 'Akademiks',
      'All American Inc. Team Sports Specialists', 'All Sport', 'allsport',
      'Alpinestars', 'Alstyle Apparel & Activewear', 'amc', 'American',
      'American Apparel', 'American Blue', 'American Chopper', 'American Eagle Outfitters',
      'American Eagle', 'American Sporting', 'American Vintage', 'Anchor Blue',
      'And1', 'Anne Klein', 'Antigua', 'Anvil', "Arc'teryx", 'Arizona',
      'Arizona Jean Company', 'Asics', 'Athleta', 'Avirex',
      // ── B ─────────────────────────────────────────────────────────────────
      'B Makowsky', 'B.U.M. Equipment', 'Bad Boy', 'Bakugan', 'Balboa',
      'Banana Republic', 'Bape', 'A Bathing Ape', 'Bass Pro Shops', 'Bauer',
      'Bauer Team', 'BCBG', 'Bebe', 'Ben Davis', 'Betseyville By Betsey Johnson',
      'Betty Boop', 'Big Ball Sports', 'BIG BANG', 'Big Dogs', 'Big Flirt', 'Bike',
      'Billabong', 'Billionaire Boys Club', 'Blue84', 'BMW', 'Bob Marley',
      'Body Glove', 'BONGO', 'Bonjour', 'Bosch', 'BOSS', 'Boss',
      'BOSS by HUGO BOSS', 'Hugo Boss', 'Boss Hugo Boss', 'Brandini', 'Bravado',
      'Brave Soul', 'Brixton', 'Brooklyn Xpress', 'Budweiser', 'Buffalo London',
      'Bugle Boy', 'Burton',
      // ── C ─────────────────────────────────────────────────────────────────
      "Cabela's", 'Cabelas', 'Caesars', 'Callaway', 'Calvin Klein',
      'CALVIN KLEIN JEANS', 'Carbon', 'Carhartt', 'Carhartt WIP', 'CAT', 'Caterpillar',
      'CCM', 'Champion', 'Chaps', 'Chaps x Ralph Lauren', 'Chase Authentics',
      'Cherokee', 'Chevrolet', "Chico's", 'Chocolate', 'Christian Dior',
      'Coach', 'Coca-Cola', 'Cody James Authentic Western Wear', 'Columbia',
      'Columbia Sportswear', 'Converse', 'Coogi', 'Cornerstone',
      'Corona', 'Crazy Shirts', 'Culture Jeans',
      // ── D ─────────────────────────────────────────────────────────────────
      'DC Comics', 'DC Shoes', 'DC', 'Delta', 'Dickies', 'Disney',
      'Disney Beauty And The Beast', 'Disneyland', 'DKNY', 'Dockers', 'Doctrine',
      'Dodge', 'Dooney & Bourke', 'Drunknmunky', 'Dunbrooke', 'Dynasty',
      // ── E ─────────────────────────────────────────────────────────────────
      'Ecko', 'Ecko Red', 'Ecko Unltd', 'Ecko Unltd.', 'Ed Hardy', 'Eddie Bauer',
      'Element', 'Enjoi', 'Enyce', 'Esprit', 'ESSENTIALS Fear of God',
      'Fear of God', 'Essentials', 'Etnies', 'Express',
      // ── F ─────────────────────────────────────────────────────────────────
      'Faded Glory', 'Fallen', 'Famous', 'Famous Stars & Straps', 'FC Barcelona',
      'FDNY', 'Fifa', 'FILA', 'Fila', 'FMF', 'Ford', 'Fox', 'Fox Racing',
      'Freshjive', 'Fruit of the Loom', 'FUBU', 'Fubu',
      // ── G ─────────────────────────────────────────────────────────────────
      'G-III Sports by Carl Banks', 'G-Unit', 'G.H. Bass & Co.', 'Gallery Dept.',
      'Gant', 'Gap', 'GAP', 'Gear', 'Gear for Sports', 'Gildan', 'Girl Scouts',
      'Grateful Dead', 'GUESS', 'Guess', 'Guess Jeans',
      // ── H ─────────────────────────────────────────────────────────────────
      'Hanes', 'Hard Rock Cafe', 'Harley Davidson', 'Hartwell', 'Hawk',
      'High Sierra', 'Hippie Rose', 'Hollister', 'Holloway', 'Honda', 'Hooters',
      'House Of Blues', 'Hurley', 'Hybrid', 'Hybrid Apparel',
      // ── I ─────────────────────────────────────────────────────────────────
      'Imperial', 'Independent', 'IZOD', 'Izod',
      // ── J ─────────────────────────────────────────────────────────────────
      'J America', 'Jagermeister', 'Jansport', 'Jerzees', 'JNCO', 'Jnco',
      'John Deere', 'Jordan', 'Juicy Couture', 'Juicy by Juicy Couture', 'Junk Food',
      // ── K ─────────────────────────────────────────────────────────────────
      'K-Swiss', 'Kappa', 'Karl Kani', 'Kate Spade', 'Kenzo',
      // ── L ─────────────────────────────────────────────────────────────────
      'L.L. Bean', 'LL Bean', 'LA Gear', 'Lacoste', 'Le Tigre', 'Lee',
      'Legendary Whitetails', 'Lego', "Levi's", 'Levis', 'Levi',
      'Liz Claiborne', 'Logo 7', 'Logo Athletic', 'LRG', 'Lucky', 'Lucky Brand', 'Lugz',
      // ── M ─────────────────────────────────────────────────────────────────
      'Majestic', 'Majestic Athletic', 'Makaveli', 'Manchester United',
      'Manchester United F.C.', 'Marc Ecko', 'Marlboro', 'Marmot', 'Marvel',
      'Matix', 'Mecca', 'Mercedes-Benz', 'Metal Mulisha', 'Metallica',
      'Michael Kors', 'MICHAEL Michael Kors', 'Mickey Mouse', 'Miskeen',
      'Miss Me', 'Mitchell & Ness', 'MLB', 'Monster', 'Monster Jam', 'Mossimo',
      'Mossy Oak', 'Mudd', 'Mudd Clothing',
      // ── N ─────────────────────────────────────────────────────────────────
      'NASA', 'NASCAR', 'Nascar', 'Nautica', 'Nautica Jeans Company', 'NBA', 'NCAA',
      'Neff', 'New Era', 'NFL', 'NHL', 'Nickelodeon', 'Nike', 'Nike 6.0',
      'Nike x ACG', 'Nintendo', 'Nixon', 'No Boundaries', 'No Fear',
      // ── O ─────────────────────────────────────────────────────────────────
      "O'Neill", 'Oakley', 'Ocean Pacific', "October's Very Own OVO", 'Old Navy',
      // ── P ─────────────────────────────────────────────────────────────────
      'Pacific Trail', 'Paco', 'Paco Jeans', 'Palace', 'Parasuco', 'Patagonia',
      'Pelle Pelle', 'Pepe Jeans', 'Pepsi', 'Phat Farm', 'Pink',
      'Planet Hollywood', 'Playboy', 'Plugg Jeans Co.',
      'Polo', 'Polo Jeans Co. by Ralph Lauren', 'Polo Ralph Lauren',
      'Polo Sport by Ralph Lauren', 'Port & Company', 'Port Authority', 'PRADA',
      'Pro Player', 'PUMA', 'Puma',
      // ── Q–R ───────────────────────────────────────────────────────────────
      'Quiksilver', 'Ralph Lauren', 'Rawlings', 'Ray-Ban', 'Real Madrid',
      'Realtree', 'Reebok', 'Rocawear', 'Rockport', 'Robert Graham',
      'Route 66', 'ROXY', 'Roxy', 'Russell Athletic', 'Rusty', 'RVCA',
      // ── S ─────────────────────────────────────────────────────────────────
      'Salem', 'Santa Cruz', 'Sean John', 'Shaq', 'Southpole', 'Spalding Athletic',
      'Speedo', 'SRH Clothing', 'Star Wars', 'Starter', 'Stone Island', 'Stussy',
      'STUSSY DESIGN CORP.', 'Supreme',
      // ── T ─────────────────────────────────────────────────────────────────
      'Tapout', 'The Hundreds', 'The Mountain', 'The North Face', 'North Face',
      'The Rolling Stones', 'Timberland', 'Tommy Hilfiger', 'Tommy Hilfiger Sport',
      'True Religion', 'Tultex',
      // ── U ─────────────────────────────────────────────────────────────────
      'U.S. Polo Assn.', 'U.S. Polo Assn', 'UFC', 'Umbro', 'Undefeated',
      'Union Bay', 'Unionbay', 'Universal Studios', 'Urban Pipeline',
      // ── V ─────────────────────────────────────────────────────────────────
      'Vans', 'VANS', 'Volcom', 'Von Dutch',
      // ── W ─────────────────────────────────────────────────────────────────
      'Walt Disney', 'Warner Bros', 'Weatherproof', 'West Coast Choppers',
      'Wilson', 'Winners Circle', 'Wolverine', 'Woolrich', 'Wrangler', 'Wu Wear', 'WWE',
      // ── X–Z ───────────────────────────────────────────────────────────────
      'Xbox', 'Yeezy', 'Zoo York',
      // ── Additional designer / luxury ──────────────────────────────────────
      'Gucci', 'Louis Vuitton', 'Balenciaga', 'Burberry', 'Alaia',
      'Alexander McQueen', 'Alexander Wang', 'Armani', 'Armani Exchange',
      'Balmain', 'Bottega Veneta', 'Brunello Cucinelli', 'Ami Paris', 'Cartier',
      'Casablanca', 'Chanel', 'Chrome Hearts', 'Comme des Garcons', 'Coperni',
      'Dior', 'Dolce & Gabbana', 'Givenchy', 'Loewe', 'Off-White', 'Off White',
      'Prada', 'Saint Laurent', 'Valentino', 'Vetements',
      // ── Additional streetwear / skate ─────────────────────────────────────
      'Primitive', 'The Hundreds', 'Chocolate', 'Enjoi', 'Brixton', 'Billionaire Boys Club',
      'Akademiks', 'Enyce', 'Karl Kani', 'Rocawear', 'Makaveli', 'Sean John',
      'LRG', 'Mecca', 'Metal Mulisha', 'Tapout', 'Affliction',
      // ── Additional outdoor / workwear ──────────────────────────────────────
      'Legendary Whitetails', 'Mossy Oak', 'Realtree', 'Bass Pro Shops',
      "Cabela's", 'Pacific Trail', 'Marmot', 'High Sierra', 'Columbia Sportswear',
    ];
    // Sort longest-first so multi-word brands (e.g. "American Vintage") match
    // before their shorter subsets (e.g. "American").
    const sortedBrands = [...KNOWN_BRANDS].sort((x, y) => y.length - x.length);
    for (const b of sortedBrands) {
      if (new RegExp(`\\b${b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(voiceDesc)) {
        extracted.brand = toTitleCase(b);
        break;
      }
    }
  }

  // ── COLOR fallback ────────────────────────────────────────────────────────
  if (!extracted.color) {
    // COLOR_WORDS_LIST is derived from COLOR_DNA in colorDatabase.ts — includes
    // canonical names and all aliases (e.g. "army green" → resolves to "olive").
    // Sorted longest-first so multi-word names like "forest green" match before "green".
    const sortedColorWords = [...COLOR_WORDS_LIST].sort((a, b) => b.length - a.length);
    const colorFound = sortedColorWords.find(c => new RegExp(`\\b${c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(lower));
    if (colorFound) {
      // Check for a second color immediately after (e.g. "black and white", "navy blue")
      const secMatch = lower.match(new RegExp(`\\b${colorFound.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b\\s+(?:and\\s+)?(\\w+(?:\\s+\\w+)?)`, 'i'));
      const potentialSec = secMatch ? secMatch[1].trim() : null;
      const secColor = potentialSec && sortedColorWords.find(c => c.toLowerCase() === potentialSec.toLowerCase()) ? potentialSec : null;
      extracted.color = toTitleCase(stripColorModifiers(colorFound));
      if (secColor) extracted.secondaryColor = toTitleCase(stripColorModifiers(secColor));
    }
  }

  // ── MATERIAL fallback ─────────────────────────────────────────────────────
  if (!extracted.material) {
    const MATERIAL_WORDS = [
      'cotton', 'polyester', 'wool', 'denim', 'leather', 'suede', 'linen', 'silk',
      'nylon', 'fleece', 'flannel', 'corduroy', 'velvet', 'velour', 'canvas',
      'spandex', 'lycra', 'rayon', 'cashmere', 'tweed', 'terry', 'mesh',
      'heavyweight cotton', 'lightweight cotton', '100% cotton', 'pure cotton',
    ];
    const matFound = MATERIAL_WORDS.find(m => new RegExp(`\\b${m}\\b`, 'i').test(lower));
    if (matFound) extracted.material = toTitleCase(matFound);
  }

  // ── CONDITION fallback ────────────────────────────────────────────────────
  if (!extracted.condition) {
    const condFallback = lower.match(
      /\b(nwt|new with tags|brand new|like[\s-]new|mint(?:\s+condition)?|pristine|excellent(?:\s+condition)?|great(?:\s+condition)?|good(?:\s+condition)?|gently[\s-]used|fair(?:\s+condition)?|worn|pre[\s-]owned|used)\b/i
    );
    if (condFallback) extracted.condition = normalizeCondition(condFallback[1]);
  }

  // ── ERA fallback ──────────────────────────────────────────────────────────
  if (!extracted.era) {
    const eraFallback = lower.match(
      // Note: "vintage" and "retro" intentionally excluded — every item in this app
      // is vintage, so they don't convey a useful era and collide with brand names
      // like "American Vintage". Use the explicit "era X period" command instead.
      /\b(y2k|90s|80s|70s|60s|50s|1990s?|1980s?|1970s?|1960s?|1950s?|2000s?)\b/i
    );
    if (eraFallback) extracted.era = normalizeEra(eraFallback[1]);
  }

  // ── GENDER fallback ───────────────────────────────────────────────────────
  if (!extracted.gender) {
    const genderFallback = lower.match(
      /\b(men'?s?|women'?s?|ladies|boys?|girls?|kids?|youth|unisex|mens|womens)\b/i
    );
    if (genderFallback) extracted.gender = normalizeGender(genderFallback[1]);
  }

  // ── PRICE fallback ────────────────────────────────────────────────────────
  // Handles: "$45", "45 dollars", "asking 50", "priced at 65", "selling for 30"
  if (!extracted.price) {
    const priceFallback = voiceDesc.match(
      /\$(\d+(?:\.\d{1,2})?)|(\d+(?:\.\d{1,2})?)\s*(?:dollars?|bucks?)|\b(?:asking|priced?\s*at|selling\s*for|listed\s*at)\s+\$?(\d+(?:\.\d{1,2})?)/i
    );
    if (priceFallback) {
      const num = (priceFallback[1] || priceFallback[2] || priceFallback[3] || '').trim();
      if (num) extracted.price = num;
    }
  }

  // ── MEASUREMENTS fallback ─────────────────────────────────────────────────
  // Handles: "22 inch pit to pit", "pit to pit 22", "22 pit", "length 28", "28 inches long", "inseam 30"
  const measureFallbacks: Array<{ key: string; patterns: RegExp[] }> = [
    { key: 'width', patterns: [
      /(\d+(?:\.\d)?)\s*(?:inch(?:es)?)?\s*(?:pit[\s-]to[\s-]pit|p2p|chest|across\s+chest)/i,
      /(?:pit[\s-]to[\s-]pit|p2p|chest|across\s+chest)\s+(\d+(?:\.\d)?)/i,
    ]},
    { key: 'length', patterns: [
      /(\d+(?:\.\d)?)\s*(?:inch(?:es)?)?\s*(?:long|length|top\s+to\s+bottom)/i,
      /(?:length|top\s+to\s+bottom)\s+(\d+(?:\.\d)?)/i,
    ]},
    { key: 'waist', patterns: [
      /(\d+(?:\.\d)?)\s*(?:inch(?:es)?)?\s*waist/i,
      /waist\s+(\d+(?:\.\d)?)/i,
    ]},
    { key: 'shoulder', patterns: [
      /(\d+(?:\.\d)?)\s*(?:inch(?:es)?)?\s*shoulder/i,
      /shoulder\s+(?:to\s+shoulder\s+)?(\d+(?:\.\d)?)/i,
    ]},
    { key: 'sleeve', patterns: [
      /(\d+(?:\.\d)?)\s*(?:inch(?:es)?)?\s*sleeve/i,
      /sleeve\s+(?:length\s+)?(\d+(?:\.\d)?)/i,
    ]},
    { key: 'inseam', patterns: [
      /(\d+(?:\.\d)?)\s*(?:inch(?:es)?)?\s*inseam/i,
      /inseam\s+(\d+(?:\.\d)?)/i,
    ]},
    { key: 'outseam', patterns: [
      /(\d+(?:\.\d)?)\s*(?:inch(?:es)?)?\s*outseam/i,
      /outseam\s+(\d+(?:\.\d)?)/i,
    ]},
    { key: 'leg_opening', patterns: [
      /(\d+(?:\.\d)?)\s*(?:inch(?:es)?)?\s*leg[\s-]opening/i,
      /leg[\s-]opening\s+(\d+(?:\.\d)?)/i,
    ]},
  ];
  for (const { key, patterns } of measureFallbacks) {
    if (!measurements[key]) {
      for (const pat of patterns) {
        const m = voiceDesc.match(pat);
        if (m) { measurements[key] = m[1]; break; }
      }
    }
  }

  if (Object.keys(measurements).length > 0) extracted.measurements = measurements;

  return extracted;
}

/**
 * Remove all "field value period" commands from a voice transcript, leaving only
 * the free-form description text.  Called after field extraction so the textarea
 * shows clean prose instead of raw commands like "brand Nike period size XL period".
 */
/**
 * Format a raw voice transcript for display in the textarea.
 * Each "trigger value period" command is placed on its own line so the
 * wall-of-text is easy to read. Prose (non-command text) is kept inline.
 */
export function formatVoiceTranscript(voiceDesc: string): string {
  const FIELD_TRIGGERS = [
    'brand', 'model', 'size', 'colo(?:u?r)?', 'material', 'fabric',
    'condition', 'era', 'style', 'type', 'gender', 'price',
    'flaws?', 'care', 'width', 'chest', 'pit\s*(?:to|2)?\s*pit', 'p2p', 'length', 'waist', 'shoulder', 'sleeve',
    'inseam', 'outseam', 'leg\\s+opening', 'tags?', 'title',
    // secondary/second/accent accept an optional " color" suffix
    'secondary(?:\\s+colou?r?)?', 'second(?:\\s+colou?r?)?', 'accent(?:\\s+colou?r?)?',
  ].join('|');

  // Insert a newline before each trigger word that starts a new command block,
  // so each "trigger value period" chunk lands on its own line.
  // Then replace the spoken word "period" with a literal "." for cleaner display.
  return voiceDesc
    .replace(
      new RegExp(`\\s*\\b(${FIELD_TRIGGERS})\\b`, 'gi'),
      '\n$1'
    )
    .replace(/\s+period\b/gi, '.')
    .trim();
}

export function stripVoiceCommands(voiceDesc: string): string {
  const FIELD_TRIGGERS = [
    'brand', 'model', 'size', 'colo(?:u?r)?', 'material', 'fabric',
    'condition', 'era', 'style', 'type', 'gender', 'price',
    'flaws?', 'care', 'width', 'chest', 'pit\s*(?:to|2)?\s*pit', 'p2p', 'length', 'waist', 'shoulder', 'sleeve',
    'inseam', 'outseam', 'leg\\s+opening', 'tags?', 'title',
    'secondary(?:\\s+colou?r?)?', 'second(?:\\s+colou?r?)?', 'accent(?:\\s+colou?r?)?',
  ].join('|');

  // Pass 1 — raw format: "trigger value period" on one line (original speech output)
  let cleaned = voiceDesc.replace(
    new RegExp(`\\b(?:${FIELD_TRIGGERS})\\b[^]*?\\bperiod\\b`, 'gi'),
    ''
  );

  // Pass 2 — formatted (newline) format: each line that STARTS with a trigger word
  // is a command line and should be removed even if "period" was already stripped.
  cleaned = cleaned.replace(
    new RegExp(`^[ \\t]*(?:${FIELD_TRIGGERS})\\b.*$`, 'gim'),
    ''
  );

  // Strip any leftover bare "period" words
  cleaned = cleaned.replace(/\bperiod\b/gi, '');

  // Collapse blank lines and leading/trailing whitespace
  return cleaned.replace(/\n{2,}/g, '\n').replace(/^\n+|\n+$/g, '').replace(/[ \t]{2,}/g, ' ').trim();
}

// ── Normalizer helpers ────────────────────────────────────────────────────────

/** Strip descriptor adjectives from a color phrase: "Faded Out White" → "White" */
function stripColorModifiers(raw: string): string {
  return raw
    .replace(/\b(?:faded\s+out|faded|washed\s+out|washed|sun[\s-]?faded|acid[\s-]?washed|slightly|very|super|deep|dark|light|bright|pale|dusty|muted|soft|rich|heathered?|over[\s-]?dyed)\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function normalizeCondition(raw: string): string {
  const c = raw.toLowerCase().replace(/\bperiod\b/gi, '').trim();
  if (/nwt|new with tags|brand new/.test(c)) return 'NWT';
  if (/like[\s-]new|mint|pristine/.test(c)) return 'Like New';
  if (/excellent|great/.test(c)) return 'Excellent';
  if (/good|gently[\s-]used/.test(c)) return 'Good';
  if (/fair|worn|used|pre[\s-]owned/.test(c)) return 'Fair';
  return toTitleCase(c);
}

function normalizeEra(raw: string): string {
  const cleaned = raw.replace(/\bperiod\b/gi, '').replace(/\s{2,}/g, ' ').trim();
  const r = cleaned.toLowerCase().replace(/\s+/g, '');
  if (r === 'y2k' || r === '2000s') return 'Y2K';
  if (/^90s?$|^1990s?$/.test(r)) return '90s';
  if (/^80s?$|^1980s?$/.test(r)) return '80s';
  if (/^70s?$|^1970s?$/.test(r)) return '70s';
  if (/^60s?$|^1960s?$/.test(r)) return '60s';
  if (/^50s?$|^1950s?$/.test(r)) return '50s';
  return toTitleCase(cleaned);
}

function normalizeGender(raw: string): string {
  const g = raw.toLowerCase().replace(/\bperiod\b/gi, '').trim();
  if (/^men|^male|^mens/.test(g)) return 'Men';
  if (/^women|^female|^ladies|^womens/.test(g)) return 'Women';
  if (/unisex|neutral/.test(g)) return 'Unisex';
  if (/kid|child|youth|boy|girl/.test(g)) return 'Kids';
  return toTitleCase(g);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function toTitleCase(str: string): string {
  return str
    .replace(/\bperiod\b/gi, '') // never let the voice delimiter word appear in display fields
    .trim()
    .replace(/\w\S*/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Extract the primary (first) material name from a composition string.
 * "50% Cotton 25% Nylon 25% Rayon" → "Cotton"
 * "Cotton" → "Cotton"
 */
export function primaryMaterial(raw: string): string {
  if (!raw) return '';
  // Strip a leading percentage like "50% " then take the first word(s) up to the next digit/percent
  const stripped = raw.replace(/^\d+\s*%\s*/i, '');
  const firstMat = stripped.match(/^([A-Za-z][A-Za-z\s\-]*?)(?=\s*\d|\s*%|$)/);
  return firstMat ? firstMat[1].trim() : raw.trim();
}

export function normalizeSizeValue(raw: string, opts?: { keepFitsLike?: boolean }): string {
  // ── "(fits like …)" note ────────────────────────────────────────────────
  // Spoken as "size large fits like period" or "size large fits like medium period",
  // or already stored as "L (fits like M)". The note is preserved ONLY where
  // explicitly requested (description SIZE line, the size form field) — titles,
  // CSV size columns, and Shopify fields always get the clean base size.
  // NOTE: this must run BEFORE the OSFA check — "fits like" contains the word
  // sequence "size fits" nowhere, but "one size fits all" must not be split here,
  // so we require the note to come AFTER some base text or a "(" delimiter.
  let fitsNote: string | null = null;
  let base = raw;
  const fitsMatch = raw.match(/^(.+?)[\s,]*\(?\s*fits\s+like\s*:?\s*([^)]*?)\s*\)?\s*$/i);
  if (fitsMatch && !/^one[\s-]?size/i.test(raw.trim()) && !/\bosfa\b/i.test(raw)) {
    base = fitsMatch[1].trim();
    // Strip leading articles so "fits like a medium" → "M", not "A"
    const target = fitsMatch[2].trim().replace(/^(?:a|an)\s+/i, '');
    fitsNote = target ? ` (fits like ${normalizeSizeValue(target)})` : ' (fits like)';
  }
  const withNote = (size: string) => (opts?.keepFitsLike && fitsNote ? `${size}${fitsNote}` : size);

  const trimmed = base.trim();

  // OSFA / One Size Fits All → "OSFA"
  if (/\b(osfa|one[\s-]?size[\s-]?fits[\s-]?all|one[\s-]?size[\s-]?fits[\s-]?most|one[\s-]?size|os)\b/i.test(trimmed)) {
    return withNote('OSFA');
  }

  // Collapse whitespace/hyphens and lowercase the whole string first so that
  // multi-word spoken sizes like "extra large", "extra extra small", "double extra large"
  // are matched before we fall back to splitting on the first token.
  const collapsed = trimmed.toLowerCase().replace(/[\s-]+/g, '');

  const map: Record<string, string> = {
    // XS
    extrasmall: 'XS', xsmall: 'XS', xs: 'XS',
    xxsmall: 'XXS', extraextrasmall: 'XXS', doubleextrasmall: 'XXS', xxs: 'XXS',
    xxxsmall: 'XXXS', tripleextrasmall: 'XXXS', extraextraextrasmall: 'XXXS', xxxs: 'XXXS',
    // S / M / L
    small: 'S', s: 'S',
    medium: 'M', m: 'M',
    large: 'L', l: 'L',
    // XL
    extralarge: 'XL', xlarge: 'XL', xl: 'XL',
    // XXL — accept "extra extra large", "double extra large", "double x large", "xx large", "2xl"
    xxlarge: 'XXL', extraextralarge: 'XXL', doubleextralarge: 'XXL',
    doublexlarge: 'XXL', extraxlarge: 'XXL',
    '2xlarge': 'XXL', '2xl': 'XXL', xxl: 'XXL',
    // XXXL — accept "triple extra large", "extra extra extra large", "3xl", "triple x large"
    xxxlarge: 'XXXL', tripleextralarge: 'XXXL',
    extraextraextralarge: 'XXXL', triplexlarge: 'XXXL',
    '3xlarge': 'XXXL', '3xl': 'XXXL', xxxl: 'XXXL',
    // 4XL
    '4xlarge': '4XL', '4xl': '4XL', xxxxl: '4XL', quadrupleextralarge: '4XL',
    // 5XL
    '5xlarge': '5XL', '5xl': '5XL', xxxxxl: '5XL',
    // OSFA
    '1size': 'OSFA', onesize: 'OSFA',
  };

  // Try the full collapsed string first (handles "extra large", "extra extra small", etc.)
  if (map[collapsed]) return withNote(map[collapsed]);

  // Fall back to just the first space/slash-separated token for numeric sizes
  // like "32", "32x30", "10.5" that don't need multi-word handling
  const first = trimmed.split(/[\s/]+/)[0];
  const firstCollapsed = first.toLowerCase().replace(/[\s-]+/g, '');
  return withNote(map[firstCollapsed] || first.toUpperCase());
}

/**
 * Generate product description using Hugging Face text model
 */
export const generateProductDescription = async (
  context: ProductContext
): Promise<AIGeneratedContent> => {
  // Hugging Face free API is permanently deprecated
  // Using intelligent template system instead
  
  // Extract fields from voice (if mentioned) to suggest filling
  const extracted = context.voiceDescription 
    ? extractFieldsFromVoice(context.voiceDescription, context.category) 
    : {};
  
  // Merge extracted with provided context — voice-extracted fields win over passed-in form values
  // so regenerate always reflects the latest voice content, with form values as fallback.
  const mergedContext = {
    ...context,
    customDescription: extracted.customDescription || context.customDescription,
    brand:             extracted.brand             || context.brand,
    color:             extracted.color             || context.color,
    secondaryColor:    extracted.secondaryColor    || context.secondaryColor,
    size:              extracted.size              || context.size,
    material:          extracted.material          || context.material,
    condition:         extracted.condition         || context.condition,
    era:               extracted.era               || context.era,
    style:             extracted.style             || context.style,
    type:              extracted.type              || context.type,
    flaws:             extracted.flaws             || context.flaws,
    care:              extracted.care              || context.care,
    modelName:         extracted.modelName         || context.modelName,
    gender:            extracted.gender            || context.gender,
    price:             extracted.price             || context.price,
    tags:              extracted.tags              || context.tags,
    measurements:      extracted.measurements      || context.measurements,
  };
  
  const result = createFallbackDescription(mergedContext);
  
  // Return with extracted fields so UI can auto-fill
  return {
    ...result,
    extractedFields: extracted
  };
};

/**
 * Create professional description using intelligent templates
 * Formatted like vintage streetwear listings
 * ONLY uses what's explicitly in fields - no assumptions!
 */
function createFallbackDescription(context: ProductContext): AIGeneratedContent {
  let description = '';

  // Generate the structured SEO title from fields — always auto-generated, never
  // pulled from the existing seoTitle (which would cause a double prefix).
  const suggestedTitle = generateTitleFromFields(context);

  // PART 1: Opener line — the full formatted title (already contains size + Vintage / Y2K)
  description += suggestedTitle || 'Vintage clothing item';

  description += '\n\n';

  // PART 1b: Custom description note (voice-dictated) — injected right after title
  if (context.customDescription) {
    description += context.customDescription.trim();
    description += '\n\n';
  }

  // PART 2: Size and measurements with symbols (ONLY if provided in fields)
  if (context.size || (context.measurements && Object.keys(context.measurements).length > 0)) {
    if (context.size) {
      // keepFitsLike — the "(fits like …)" note belongs in the description SIZE line
      description += `✠ SIZE- ${normalizeSizeValue(context.size, { keepFitsLike: true })}\n`;
    }
    
    // Add width and length if available
    if (context.measurements) {
      const width = context.measurements['Width'] || context.measurements['width'];
      const length = context.measurements['Length'] || context.measurements['length'];
      
      if (width) {
        description += `✠ Width- ${width}\n`;
      }
      if (length) {
        description += `✠ Length- ${length}\n`;
      }
      
      // Add other measurements
      Object.entries(context.measurements).forEach(([key, value]) => {
        const lowerKey = key.toLowerCase();
        if (value && lowerKey !== 'width' && lowerKey !== 'length') {
          description += `✠ ${key}- ${value}\n`;
        }
      });
    }
    
    description += '\n';
  }

  // PART 3b: Material composition — show full "50% Cotton 25% Nylon 25% Rayon" if available
  {
    const voiceMatMatch = (context.voiceDescription || '')
      .match(/\b(?:material|fabric)\s+(.+?)\s+period\b/i);
    const rawMaterial = voiceMatMatch ? voiceMatMatch[1].trim() : context.material || '';
    if (rawMaterial) {
      description += `Material: ${toTitleCase(rawMaterial)}\n\n`;
    }
  }

  // PART 4b: Washing disclosure + condition
  description += 'Every Garment goes through a thorough washing process before being photographed.\n';
  if (context.condition) {
    description += `Condition: ${context.condition}\n`;
  }
  description += '\n';

  // PART 5: Call to action
  description += 'BUNDLE AND SAVE!!!!!!\n\n';

  // PART 6: Tags — prefer hashtags found in voice description, fall back to field-based tags
  const tags = generateTagsFromFields(context);
  if (tags.length > 0) {
    description += tags.map(tag => `#${tag.toLowerCase().replace(/\s+/g, '')}`).join(' ');
    description += '\n\n';
  }

  // PART 7: Standard disclaimers
  description += '* We note major imperfections—minor signs of age or wear may not be listed, adding to the vintage character.\n';
  description += '* High-quality piece, perfect for streetwear.\n';
  description += '* Ships next day.\n';
  description += '* All sales final.';

  return {
    description,
    suggestedTitle,
    suggestedTags: tags
  };
}

/**
 * Generate SEO title from filled fields.
 * Format: [size] - Vintage / Y2K [brand] [era] [style] [modelName] [category]
 * - Max 60 characters
 * - No size prefix for bags
 * - OSFA for hats/caps
 * - "period" voice delimiter is never included
 */
// ── Synonym groups — organized by field, any member substitutes for any other ─
// STYLE — print / graphic techniques
const TITLE_SYNONYMS: string[][] = [
  ['spellout', 'spell out', 'screen print', 'printed logo', 'print logo'],
  ['embroidered', 'embroider', 'embroidery', 'stitched logo', 'stitched patch'],
  ['graphic', 'all over print', 'sublimated print', 'full print', 'aop'],
  ['patch logo', 'iron on patch', 'woven patch', 'sewn patch'],
  ['bootleg', 'knockoff style', 'unofficial print', 'off brand print'],
  // STYLE — distress / wash
  ['faded', 'distressed', 'washed', 'acid wash', 'sun faded'],
  ['super faded', 'heavily distressed', 'heavily faded', 'over dyed', 'raw faded'],
  ['stonewash', 'stone washed', 'bleach wash', 'bleached', 'enzyme wash'],
  ['thrashed', 'worn in', 'beat up', 'well worn', 'broken in'],
  // STYLE — fit descriptors
  ['baggy', 'oversized', 'wide leg', 'relaxed fit', 'loose fit'],
  ['slim', 'slim fit', 'tapered', 'fitted cut', 'narrow fit'],
  ['cropped', 'crop', 'cut off', 'shortened', 'above waist'],
  ['boxy', 'boxy fit', 'boxy cut', 'boxy silhouette', 'square cut'],
  // STYLE — closures / construction
  ['zip up', 'full zip', 'zippered', 'zip front', 'front zip'],
  // NOTE: 'pullover' intentionally omitted here — it lives in item-type groups only
  // (e.g. 'pullover sweatshirt') to avoid swapping it onto non-pullover items.
  ['button up', 'button down', 'buttoned', 'front button', 'snap button'],
  ['snap', 'snap closure', 'snap front', 'press stud', 'popper'],
  ['lace up', 'laced', 'drawstring', 'tie front', 'tie waist'],
  // STYLE — weight / fabric feel
  ['heavyweight', 'heavy weight', 'thick fleece', 'dense knit', 'heavy duty'],
  ['lightweight', 'light weight', 'thin knit', 'sheer', 'breathable'],
  ['ribbed', 'rib knit', 'waffle knit', 'textured knit', 'cable knit'],
  // STYLE — cultural / aesthetic
  ['hip hop', 'streetwear', 'street style', 'urban street', 'rap style'],
  ['workwear', 'work wear', 'utility wear', 'chore wear', 'labor wear'],
  ['athletic', 'sport', 'activewear', 'sporty', 'performance'],
  ['preppy', 'collegiate', 'ivy league', 'classic fit', 'campus style'],
  ['western', 'cowboy', 'country', 'rodeo', 'ranch style'],
  ['biker', 'moto', 'motorcycle', 'rocker', 'punk'],
  ['skater', 'skate style', 'sk8', 'boarder', 'skate brand'],
  ['grunge', 'alternative', 'alt', 'indie', 'underground'],
  ['hip hop style', 'rap tee', 'rap shirt', 'hip hop tee', 'rap graphic'],
  // STYLE — item-specific descriptors
  ['carpenter', 'utility pant', 'work pant', 'chore pant', 'multi pocket'],
  ['cargo', 'cargo style', 'cargo pocket', 'multi pocket', 'tactical'],
  ['flare', 'flare leg', 'bell bottom', 'wide hem', 'flared cut'],
  ['straight leg', 'straight cut', 'regular cut', 'classic cut', 'traditional cut'],
  // MATERIAL — denim
  ['denim', 'jean material', 'indigo denim', 'blue denim', 'raw denim'],
  ['corduroy', 'cord', 'corduroy fabric', 'wide wale cord', 'fine wale cord'],
  ['canvas', 'canvas material', 'heavy canvas', 'waxed canvas', 'duck canvas'],
  ['twill', 'twill fabric', 'cotton twill', 'poly twill', 'woven twill'],
  ['flannel', 'brushed flannel', 'plaid flannel', 'soft flannel', 'woven flannel'],
  ['fleece', 'polar fleece', 'sherpa', 'plush fleece', 'brushed fleece'],
  ['terry', 'terry cloth', 'french terry', 'loopback terry', 'sweat terry'],
  ['nylon', 'rip stop', 'ripstop nylon', 'nylon shell', 'windbreaker material'],
  ['polyester', 'poly', 'poly blend', 'synthetic', 'poly fabric'],
  ['cotton', 'all cotton', 'pure cotton', 'soft cotton', '100% cotton'],
  ['velour', 'velvet', 'crushed velvet', 'plush velvet', 'velour fabric'],
  ['leather', 'faux leather', 'pu leather', 'pleather', 'vegan leather'],
  ['suede', 'faux suede', 'microsuede', 'suede fabric', 'suede material'],
  ['wool', 'wool blend', 'knit wool', 'merino', 'lambswool'],
  ['silk', 'satin', 'silky', 'charmeuse', 'satin finish'],
  ['mesh', 'open mesh', 'jersey mesh', 'athletic mesh', 'breathable mesh'],
  // COLOR — neutrals
  ['black', 'jet black', 'all black', 'onyx', 'midnight black'],
  ['white', 'off white', 'cream white', 'ivory', 'bright white'],
  ['grey', 'gray', 'heather grey', 'charcoal', 'slate grey'],
  ['beige', 'tan', 'khaki', 'sand', 'cream'],
  ['brown', 'chocolate', 'camel', 'coffee', 'mocha brown'],
  // COLOR — main colors
  ['navy', 'navy blue', 'dark navy', 'midnight blue', 'deep navy'],
  ['blue', 'royal blue', 'cobalt', 'bright blue', 'sky blue'],
  ['red', 'crimson', 'scarlet', 'bright red', 'cherry red'],
  ['green', 'forest green', 'olive', 'hunter green', 'army green'],
  ['orange', 'burnt orange', 'rust', 'tangerine', 'flame orange'],
  ['yellow', 'gold', 'mustard', 'canary yellow', 'lemon yellow'],
  ['purple', 'violet', 'plum', 'grape', 'lavender'],
  ['pink', 'hot pink', 'bubblegum pink', 'blush', 'rose pink'],
  ['teal', 'teal blue', 'cyan', 'aqua', 'turquoise'],
  ['maroon', 'burgundy', 'wine', 'oxblood', 'dark red'],
  // SIZE groups removed on purpose: sizes reach titles as letter symbols (XL/XXL)
  // via normalizeSizeValue, and any swap here can only respell them ("extra lg")
  // — violating the sizes-always-letter-symbols rule (commit 28e9d9b). Locked in
  // by textAIService.test.ts.
  // DECADE / ERA
  ['90s', 'nineties', 'mid 90s', 'late 90s', 'early 90s'],
  ['2000s', 'y2k era', 'early 2000s', 'mid 2000s', '00s'],
  ['80s', 'eighties', 'mid 80s', 'late 80s', 'early 80s'],
  ['70s', 'seventies', 'mid 70s', 'late 70s', 'early 70s'],
];

/**
 * ITEM_TYPE_SYNONYM_GROUPS — synonyms keyed strictly per garment type.
 *
 * These are intentionally SEPARATE from TITLE_SYNONYMS so that fitTo60()
 * can load ONLY the single group whose canonical term appears in the title.
 * This prevents cross-contamination — e.g. "sweatshirt" can never be swapped
 * to "graphic tee" even after many fitTo60 passes.
 *
 * Rules for each group:
 *  - The CANONICAL term (first entry) must be the exact word/phrase the
 *    title-generation formulas output (e.g. 'sweatshirt', 'trucker hat').
 *  - No canonical term may appear as a plain sub-word in another group's
 *    canonical (e.g. avoid bare 'fitted' because 'slim fit' ≠ 'fitted cap').
 *  - Womens / youth variants get their OWN group so they only swap with
 *    other same-gender variants.
 */
const ITEM_TYPE_SYNONYM_GROUPS: string[][] = [
  // ── Tops — unisex/mens ────────────────────────────────────────────────────
  ['t-shirt', 'tee shirt', 'graphic tee', 'cotton tee', 'solid tee'],
  ['sweatshirt', 'crewneck sweatshirt', 'crew sweatshirt', 'fleece sweatshirt', 'pullover sweatshirt'],
  ['hoodie', 'hooded sweatshirt', 'hooded fleece', 'zip hoodie', 'pullover hoodie'],
  ['shirt', 'woven shirt', 'long sleeve shirt', 'short sleeve shirt', 'cotton shirt'],
  ['jersey', 'sport jersey', 'mesh jersey', 'athletic jersey', 'game jersey'],
  // ── Tops — womens ─────────────────────────────────────────────────────────
  ['womens t-shirt', 'womens tee', 'ladies tee', 'womens graphic tee', 'womens cotton tee'],
  ['womens sweatshirt', 'ladies sweatshirt', 'womens crewneck', 'ladies crewneck', 'womens crew sweatshirt'],
  ['womens hoodie', 'ladies hoodie', 'womens zip hoodie', 'womens fleece hoodie', 'womens pullover hoodie'],
  ['womens top', 'ladies top', 'womens blouse', 'womens knit top', 'ladies blouse'],
  ['womens bodysuit', 'ladies bodysuit', 'snap bodysuit', 'womens one piece', 'fitted bodysuit'],
  // ── Tops — youth/kids ─────────────────────────────────────────────────────
  ['youth t-shirt', 'kids tee', 'youth tee', 'kids t-shirt', 'youth graphic tee'],
  ['youth sweatshirt', 'kids sweatshirt', 'youth crewneck', 'kids crewneck', 'youth fleece sweatshirt'],
  ['youth hoodie', 'kids hoodie', 'youth zip hoodie', 'kids zip hoodie', 'youth pullover hoodie'],
  // ── Outerwear ─────────────────────────────────────────────────────────────
  ['jacket', 'outerwear jacket', 'shell jacket', 'sport jacket', 'light jacket'],
  // ── Bottoms — unisex/mens ─────────────────────────────────────────────────
  ['jeans', 'denim jeans', 'blue jeans', 'jean pants', 'denim pants'],
  ['pants', 'trousers', 'slacks', 'dress pants', 'chino pants'],
  ['shorts', 'sport shorts', 'casual shorts', 'gym shorts', 'athletic shorts'],
  // ── Bottoms — womens ──────────────────────────────────────────────────────
  ['womens jeans', 'ladies jeans', 'womens denim jeans', 'ladies denim jeans', 'womens skinny jeans'],
  ['womens pants', 'ladies pants', 'womens trousers', 'ladies trousers', 'womens slacks'],
  ['womens shorts', 'ladies shorts', 'womens cutoff shorts', 'womens gym shorts', 'ladies sport shorts'],
  ['womens skirt', 'ladies skirt', 'womens mini skirt', 'womens midi skirt', 'ladies midi skirt'],
  ['womens dress', 'ladies dress', 'womens midi dress', 'womens mini dress', 'womens sundress'],
  // ── Bottoms — youth/kids ──────────────────────────────────────────────────
  ['youth pants', 'kids pants', 'youth joggers', 'kids joggers', 'youth sweatpants'],
  ['youth shorts', 'kids shorts', 'youth sport shorts', 'kids sport shorts', 'youth gym shorts'],
  // ── Headwear ──────────────────────────────────────────────────────────────
  // Canonical terms must be multi-word where needed to avoid partial-word matches
  // e.g. 'fitted cap' not bare 'fitted' (would collide with style 'fitted cut')
  ['snapback', 'snapback cap', 'snap back cap', 'adjustable snapback', 'snap cap'],
  ['fitted cap', 'structured cap', 'closed back cap', 'fitted baseball cap', 'new era cap'],
  ['trucker hat', 'trucker cap', 'mesh back hat', 'foam front hat', 'mesh trucker cap'],
  ['beanie', 'knit beanie', 'winter beanie', 'cuffed beanie', 'knit skull cap'],
  ['bucket hat', 'bucket cap', 'wide brim hat', 'cotton bucket hat', 'unstructured bucket hat'],
  ['visor', 'sun visor', 'sport visor', 'tennis visor', 'open top visor'],
  ['hat', 'ball cap', 'sport cap', 'logo hat', 'adjustable hat'],
];

// dedupeTitle: remove repeated words from an assembled title (case-insensitive).
// Keeps the first occurrence of each word. Handles hyphenated words as one unit.
function dedupeTitle(title: string): string {
  const seen = new Set<string>();
  return title
    .split(' ')
    .filter(word => {
      const key = word.toLowerCase().replace(/[^a-z0-9-]/g, '');
      if (!key) return false;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join(' ');
}

// fitTo60: after assembling a title, greedily swap synonyms across all tokens
// to get as close to 60 characters as possible (never cuts mid-word).
// When multiple swaps are within RANDOM_TOLERANCE chars of the best, picks randomly.
//
// Cross-contamination prevention: item-type synonyms (ITEM_TYPE_SYNONYM_GROUPS) are
// kept in a separate list. fitTo60 scans the title to find the ONE group whose
// canonical term is present, then builds effective synonyms as:
//   TITLE_SYNONYMS (general)  +  that single matched item-type group
// This means "sweatshirt" titles can only ever swap within the sweatshirt group —
// they can never accidentally gain "graphic tee" or "trucker hat" variants.
function fitTo60(title: string): string {
  const TARGET = 60;
  const RANDOM_TOLERANCE = 3; // chars — candidates within this range of best are randomized
  let current = title.replace(/\s{2,}/g, ' ').trim();

  // ── Find the single item-type synonym group active in this title ───────────
  // Scan groups longest-canonical-first so "fitted cap" beats bare "hat" on overlap.
  const sortedItemGroups = [...ITEM_TYPE_SYNONYM_GROUPS].sort(
    (a, b) => b[0].length - a[0].length
  );
  let activeItemGroup: string[] | null = null;
  for (const group of sortedItemGroups) {
    const canonical = group[0];
    const escaped = canonical.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, 'i');
    if (re.test(current)) {
      activeItemGroup = group;
      break;
    }
  }

  // ── Build effective synonym list: general + (at most) one item-type group ──
  const effectiveSynonyms: string[][] = activeItemGroup
    ? [...TITLE_SYNONYMS, activeItemGroup]
    : TITLE_SYNONYMS;

  // Each synonym group may be used at most ONCE per title. Without this lock,
  // a replacement that still contains its own group's canonical word gets
  // re-swapped on the next pass and the swaps compound into gibberish:
  // '90s' → 'early 90s' → 'early mid 90s' → 'early mid late nineties'.
  // (Same failure family as the historic "extra l size" corruption, 58376d2.)
  const usedGroups = new Set<number>();

  for (let pass = 0; pass < 30; pass++) {
    const len = current.length;
    if (len === TARGET) break;

    let bestDiff = Math.abs(len - TARGET);
    const topCandidates: { text: string; groupIdx: number }[] = [];

    for (let groupIdx = 0; groupIdx < effectiveSynonyms.length; groupIdx++) {
      if (usedGroups.has(groupIdx)) continue;
      const group = effectiveSynonyms[groupIdx];
      // Find which member of this group appears in the current title
      let matchedWord = '';
      let matchedRe: RegExp | null = null;
      for (const word of group) {
        const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, 'i');
        if (re.test(current)) {
          matchedWord = word;
          matchedRe = re;
          break;
        }
      }
      if (!matchedRe) continue;

      for (const alt of group) {
        if (alt.toLowerCase() === matchedWord.toLowerCase()) continue;
        const swapped = current.replace(matchedRe, alt);
        const candidate = dedupeTitle(swapped.replace(/\s{2,}/g, ' ').trim());
        const candLen = candidate.length;
        if (len <= TARGET && candLen > TARGET) continue;
        const diff = Math.abs(candLen - TARGET);
        if (diff < bestDiff) {
          bestDiff = diff;
          topCandidates.length = 0;
          topCandidates.push({ text: candidate, groupIdx });
        } else if (diff <= bestDiff + RANDOM_TOLERANCE) {
          topCandidates.push({ text: candidate, groupIdx });
        }
      }
    }

    if (topCandidates.length === 0) break;
    // Pick randomly among near-best candidates for title variety
    const chosen = topCandidates[Math.floor(Math.random() * topCandidates.length)];
    current = chosen.text;
    usedGroups.add(chosen.groupIdx);
  }

  return current;
}

function generateTitleFromFields(context: ProductContext): string {
  const clean = (s?: string) =>
    (s || '').replace(/\bperiod\b/gi, '').replace(/\s{2,}/g, ' ').trim();

  // ── Filled tokens — dedupe internal repeated words, but preserve proper nouns ─
  // Normalize size to letter form (XL/XXL/XXXL) so spelled-out values ("extra large",
  // "double extra large") never reach the title, even on legacy/typed data.
  const SIZE    = context.size ? normalizeSizeValue(clean(context.size)) : '';
  const BRAND   = clean(context.brand);   // do NOT dedupe — proper noun (e.g. "American Vintage")
  const STYLE   = dedupeTitle(clean(context.style));
  const SUBJECT  = clean(context.modelName); // do NOT dedupe — proper noun (band/team/artist name)
  // TYPE from productType/type field: the specific garment noun ("Crewneck", "Cargos", etc.)
  // It replaces or refines the auto-detected item word in the title formula.
  const TYPE    = dedupeTitle(clean(context.type));

  // ERA is always "Vintage Y2K" in this app (the constant prefix)
  const ERA = 'Vintage Y2K';

  // DECADE is derived from the era field: "90s", "00s", "2000s", "80s", etc.
  // Y2K/2000s is intentionally left BLANK here — ERA = 'Vintage Y2K' already
  // covers it, so adding '2000s' would be redundant.
  const rawEra = clean(context.era).toLowerCase().replace(/\s+/g, '');
  let DECADE = '';
  if (/^y2k$|^2000s?$|^00s$/.test(rawEra))       DECADE = ''; // covered by ERA
  else if (/^90s$|^1990s?$/.test(rawEra))          DECADE = '90s';
  else if (/^80s$|^1980s?$/.test(rawEra))          DECADE = '80s';
  else if (/^70s$|^1970s?$/.test(rawEra))          DECADE = '70s';
  else if (/^60s$|^1960s?$/.test(rawEra))          DECADE = '60s';
  else if (rawEra && !/vintage|retro/.test(rawEra)) DECADE = clean(context.era);

  // ── Category / gender detection ────────────────────────────────────────────
  const catRaw   = (context.category || '').toLowerCase();
  const genderRaw = (context.gender  || '').toLowerCase();

  const isWomens = /women|female|ladies/.test(genderRaw) || /women/.test(catRaw);
  const isKids   = /kid|youth|child|boy|girl|junior/.test(genderRaw) || /kid|youth/.test(catRaw);

  const catStr = catRaw; // convenience alias

  const isTee        = /\btees?\b|\bt[-\s]?shirts?\b|\btshirts?\b/.test(catStr);
  const isShirt      = /\bshirts?\b/.test(catStr) && !isTee;
  const isSweatshirt = /sweatshirts?|crewnecks?/.test(catStr) && !/hoodie/.test(catStr);
  const isHoodie     = /hoodies?/.test(catStr);
  const isJacket     = /jackets?|coats?/.test(catStr);
  const isPants      = /\bpants?\b|\btrousers?\b/.test(catStr) && !/jeans/.test(catStr);
  const isJeans      = /jeans?/.test(catStr);
  const isShorts     = /shorts?/.test(catStr);
  const isJersey     = /jerseys?/.test(catStr);
  const isHat        = /\bhats?\b|\bcaps?\b|\bbeanies?\b|\bsnapbacks?\b|\bfitteds?\b|\bbuckets?\b|\btruckers?\b|\bvisors?\b/.test(catStr);
  const isBeanie     = /beanies?|knit\s*hat/.test(catStr);
  const isAccessory  = /accessor|bags?\b|backpacks?|totes?\b|purses?|handbags?|crossbody|wallets?/.test(catStr);
  const isSkirt      = /skirts?/.test(catStr);
  const isDress      = /dresses?/.test(catStr);
  const isBodysuit   = /bodysuits?/.test(catStr);
  const isTop        = /\btops?\b/.test(catStr) && !isTee && !isShirt;

  // Hats always show OSFA unless we have a numeric size (e.g. "7½")
  let displaySize = SIZE;
  if (isHat) {
    displaySize = (SIZE && /^\d/.test(SIZE)) ? SIZE : 'OSFA';
  }
  // Accessories skip the size prefix
  if (isAccessory) displaySize = '';

  // ── Custom-description title path ─────────────────────────────────────────
  // When the user dictated a freeform description, extract key words from it
  // and build: "{SIZE} - Vintage Y2K {BRAND} {desc keywords}" capped at 60 chars.
  // Falls through to the normal structured-fields formula if no description present.
  if (context.customDescription) {
    const STOP_WORDS = new Set([
      'a','an','the','and','or','for','of','in','to','is','are','was','were',
      'be','been','with','without','that','this','these','those','very','quite',
      'just','also','has','have','had','it','its','lot','lots','colored','coloured',
      'great','nice','perfect','really','super','some','so','how','all','on','at',
      'by','as','up','out','from','into','about',
    ]);
    let descText = (context.customDescription)
      .toLowerCase()
      .replace(/\bperiod\b/gi, '')           // strip voice delimiter
      .replace(/^[xsml\d]+[\s\-]+/i, '')     // strip leading size prefix ("L -", "XL-")
      .replace(/[,;:.!?()\-\/]/g, ' ')       // strip punctuation
      .replace(/\s{2,}/g, ' ')
      .trim();
    // Remove brand name BEFORE stripping "vintage" so "American Vintage" is removed as a unit,
    // not mangled into "American" first.
    if (BRAND) {
      descText = descText
        .replace(new RegExp('\\b' + BRAND.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'gi'), '')
        .replace(/\s{2,}/g, ' ').trim();
    }
    descText = descText.replace(/\bvintage\b|\by2k\b/gi, '').replace(/\s{2,}/g, ' ').trim();
    // Split, filter stop words, dedupe while preserving order
    const rawWords = descText.split(/\s+/).filter(w => w.length > 1 && !STOP_WORDS.has(w));
    const seen = new Set<string>();
    const unique: string[] = [];
    for (const w of rawWords) { if (!seen.has(w)) { seen.add(w); unique.push(w); } }
    // Assemble with 60-char word-boundary cap — size, ERA, brand, TYPE, then description keywords
    const base = displaySize
      ? `${displaySize} - Vintage Y2K${BRAND ? ` ${BRAND}` : ''}${TYPE ? ` ${TYPE}` : ''}`
      : `Vintage Y2K${BRAND ? ` ${BRAND}` : ''}${TYPE ? ` ${TYPE}` : ''}`;
    let customTitle = base;
    for (const w of unique) {
      const next = `${customTitle} ${w}`;
      if (next.length > 60) break;
      customTitle = next;
    }
    return customTitle.replace(/\s{2,}/g, ' ').trim();
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  // Join non-empty tokens with a single space
  const j = (...parts: string[]) => parts.filter(Boolean).join(' ');

  // Assemble: "{size} - {body}" or "{body}" when size is empty
  const asm = (sz: string, ...tokens: string[]) => {
    const body = j(...tokens);
    return sz ? `${sz} - ${body}` : body;
  };

  // ── Pick variation (1–6) based on which fields are filled ──────────────────
  // Prefer subject-forward (V2/V3) when modelName is filled.
  // Prefer color/material (V3) when both color & material are filled.
  // Otherwise pick randomly so titles stay varied.
  let v: number;
  if (SUBJECT && !BRAND)      v = 2;          // subject-only scenario
  else if (SUBJECT && BRAND)  v = Math.random() < 0.5 ? 2 : 1;
  else if (!STYLE && !DECADE) v = 6;          // minimal fallback
  else v = Math.floor(Math.random() * 4) + 1; // V1-V4 for most cases

  // ── Category-specific formula sets ────────────────────────────────────────
  let title = '';

  // ── TEES ──────────────────────────────────────────────────────────────────
  if (isTee) {
    const item = TYPE || (isWomens ? 'womens t-shirt' : isKids ? 'youth t-shirt' : 't-shirt');
    if      (v === 1) title = asm(displaySize, ERA, BRAND, STYLE, DECADE, item);
    else if (v === 2) title = asm(displaySize, ERA, SUBJECT, BRAND, DECADE, item);
    else if (v === 3) title = asm(displaySize, ERA, BRAND, STYLE, DECADE, item);
    else if (v === 4) title = asm(displaySize, ERA, BRAND, STYLE, item);
    else if (v === 5) title = asm(displaySize, ERA, BRAND, DECADE, item);
    else              title = asm(displaySize, ERA, SUBJECT, STYLE, DECADE, item);
  }
  // ── SHIRTS ────────────────────────────────────────────────────────────────
  else if (isShirt) {
    const item = TYPE || (isWomens ? 'womens shirt' : isKids ? 'youth shirt' : 'shirt');
    if      (v === 1) title = asm(displaySize, ERA, BRAND, STYLE, DECADE, item);
    else if (v === 2) title = asm(displaySize, ERA, BRAND, STYLE, DECADE, item);
    else if (v === 3) title = asm(displaySize, ERA, BRAND, STYLE, DECADE, item);
    else if (v === 4) title = asm(displaySize, ERA, BRAND, STYLE, DECADE, item);
    else if (v === 5) title = asm(displaySize, ERA, BRAND, DECADE, item);
    else              title = asm(displaySize, ERA, SUBJECT, BRAND, STYLE, item);
  }
  // ── SWEATSHIRTS ───────────────────────────────────────────────────────────
  else if (isSweatshirt) {
    const item = TYPE || (isWomens ? 'womens sweatshirt' : isKids ? 'youth sweatshirt' : 'sweatshirt');
    if      (v === 1) title = asm(displaySize, ERA, BRAND, STYLE, DECADE, item);
    else if (v === 2) title = asm(displaySize, ERA, SUBJECT, BRAND, DECADE, item);
    else if (v === 3) title = asm(displaySize, ERA, BRAND, STYLE, DECADE, item);
    else if (v === 4) title = asm(displaySize, ERA, BRAND, 'heavyweight', DECADE, item);
    else if (v === 5) title = asm(displaySize, ERA, BRAND, STYLE, item);
    else              title = asm(displaySize, ERA, SUBJECT, BRAND, DECADE, item);
  }
  // ── HOODIES ───────────────────────────────────────────────────────────────
  else if (isHoodie) {
    const item = TYPE || (isWomens ? 'womens hoodie' : isKids ? 'youth hoodie' : 'hoodie');
    if      (v === 1) title = asm(displaySize, ERA, BRAND, STYLE, DECADE, item);
    else if (v === 2) title = asm(displaySize, ERA, BRAND, STYLE, DECADE, item);
    else if (v === 3) title = asm(displaySize, ERA, BRAND, STYLE, 'zip up', DECADE, item);
    else if (v === 4) title = asm(displaySize, ERA, BRAND, 'pullover', DECADE, item);
    else if (v === 5) title = asm(displaySize, ERA, SUBJECT, STYLE, DECADE, item);
    else              title = asm(displaySize, ERA, BRAND, DECADE, item);
  }
  // ── JACKETS ───────────────────────────────────────────────────────────────
  else if (isJacket) {
    const item = TYPE || (isWomens ? 'womens jacket' : isKids ? 'youth jacket' : 'jacket');
    if      (v === 1) title = asm(displaySize, ERA, BRAND, STYLE, DECADE, item);
    else if (v === 2) title = asm(displaySize, ERA, BRAND, STYLE, DECADE, item);
    else if (v === 3) title = asm(displaySize, ERA, SUBJECT, STYLE, DECADE, item);
    else if (v === 4) title = asm(displaySize, ERA, BRAND, STYLE, 'workwear', DECADE, item);
    else if (v === 5) title = asm(displaySize, ERA, BRAND, STYLE, DECADE, item);
    else              title = asm(displaySize, ERA, BRAND, DECADE, item);
  }
  // ── PANTS ─────────────────────────────────────────────────────────────────
  else if (isPants) {
    const item = TYPE || (isWomens ? 'womens pants' : isKids ? 'youth pants' : 'pants');
    if      (v === 1) title = asm(displaySize, ERA, BRAND, STYLE, DECADE, item);
    else if (v === 2) title = asm(displaySize, ERA, BRAND, STYLE, DECADE, item);
    else if (v === 3) title = asm(displaySize, ERA, BRAND, 'baggy', STYLE, DECADE, item);
    else if (v === 4) title = asm(displaySize, ERA, BRAND, DECADE, item);
    else if (v === 5) title = asm(displaySize, ERA, BRAND, DECADE, item);
    else              title = asm(displaySize, ERA, BRAND, STYLE, DECADE, item);
  }
  // ── JEANS ─────────────────────────────────────────────────────────────────
  else if (isJeans) {
    const item = TYPE || (isWomens ? 'womens jeans' : isKids ? 'youth jeans' : 'jeans');
    if      (v === 1) title = asm(displaySize, ERA, BRAND, SUBJECT, STYLE, DECADE, item);
    else if (v === 2) title = asm(displaySize, ERA, BRAND, STYLE, DECADE, item);
    else if (v === 3) title = asm(displaySize, ERA, BRAND, 'baggy', STYLE, DECADE, item);
    else if (v === 4) title = asm(displaySize, ERA, BRAND, DECADE, item);
    else if (v === 5) title = asm(displaySize, ERA, BRAND, 'faded', DECADE, item);
    else              title = asm(displaySize, ERA, BRAND, STYLE, 'carpenter', DECADE, item);
  }
  // ── SHORTS ────────────────────────────────────────────────────────────────
  else if (isShorts) {
    const item = TYPE || (isWomens ? 'womens shorts' : isKids ? 'youth shorts' : 'shorts');
    if      (v === 1) title = asm(displaySize, ERA, BRAND, STYLE, DECADE, item);
    else if (v === 2) title = asm(displaySize, ERA, BRAND, STYLE, DECADE, item);
    else if (v === 3) title = asm(displaySize, ERA, BRAND, STYLE, DECADE, item);
    else if (v === 4) title = asm(displaySize, ERA, BRAND, STYLE, 'hip hop', DECADE, item);
    else if (v === 5) title = asm(displaySize, ERA, BRAND, DECADE, item);
    else              title = asm(displaySize, ERA, SUBJECT, STYLE, DECADE, item);
  }
  // ── JERSEYS ───────────────────────────────────────────────────────────────
  else if (isJersey) {
    const item = TYPE || 'jersey';
    if      (v === 1) title = asm(displaySize, ERA, SUBJECT, BRAND, DECADE, item);
    else if (v === 2) title = asm(displaySize, ERA, SUBJECT, STYLE, DECADE, item);
    else if (v === 3) title = asm(displaySize, ERA, BRAND, STYLE, SUBJECT, DECADE, item);
    else if (v === 4) title = asm(displaySize, ERA, SUBJECT, DECADE, item);
    else if (v === 5) title = asm(displaySize, ERA, SUBJECT, DECADE, item);
    else              title = asm(displaySize, ERA, SUBJECT, BRAND, STYLE, item);
  }
  // ── HATS / BEANIES ────────────────────────────────────────────────────────
  else if (isHat) {
    // Detect specific hat subtype from category string for accurate item word
    const isSnapback = /snapback/.test(catStr);
    const isFitted   = /\bfitted\b/.test(catStr);
    const isTrucker  = /trucker/.test(catStr);
    const isBucket   = /bucket/.test(catStr);
    const isVisor    = /visor/.test(catStr);
    const hatBase =
      isBeanie  ? 'beanie'   :
      isSnapback? 'snapback' :
      isFitted  ? 'fitted'   :
      isTrucker ? 'trucker'  :
      isBucket  ? 'bucket hat':
      isVisor   ? 'visor'    : 'hat';
    const hatWord = TYPE || (isWomens ? `womens ${hatBase}` : hatBase);
    if      (v === 1) title = asm(displaySize, ERA, SUBJECT, STYLE, DECADE, hatWord);
    else if (v === 2) title = asm(displaySize, ERA, BRAND,   STYLE, DECADE, hatWord);
    else if (v === 3) title = asm(displaySize, ERA, SUBJECT, BRAND, STYLE, DECADE, hatWord);
    else if (v === 4) title = asm(displaySize, ERA, SUBJECT, STYLE, DECADE, hatWord);
    else if (v === 5) title = asm(displaySize, ERA, BRAND,   STYLE, DECADE, hatWord);
    else              title = asm(displaySize, ERA, SUBJECT, DECADE, hatWord);
  }
  // ── ACCESSORIES / BAGS ────────────────────────────────────────────────────
  else if (isAccessory) {
    const item = TYPE || (isWomens ? 'womens bag' : 'bag');
    if      (v === 1) title = asm('', ERA, BRAND,   STYLE,    DECADE, item);
    else if (v === 2) title = asm('', ERA, BRAND,   STYLE,    DECADE, item);
    else if (v === 3) title = asm('', ERA, SUBJECT, STYLE,    DECADE, item);
    else if (v === 4) title = asm('', ERA, BRAND,   DECADE, item);
    else if (v === 5) title = asm('', ERA, BRAND,   STYLE,    item);
    else              title = asm('', ERA, SUBJECT, STYLE,    'accessory');
  }
  // ── SKIRTS ────────────────────────────────────────────────────────────────
  else if (isSkirt) {
    const item = TYPE || 'womens skirt';
    if      (v === 1) title = asm(displaySize, ERA, BRAND, STYLE, DECADE, item);
    else if (v === 2) title = asm(displaySize, ERA, BRAND, STYLE, DECADE, item);
    else if (v === 3) title = asm(displaySize, ERA, BRAND, STYLE,    DECADE, item);
    else if (v === 4) title = asm(displaySize, ERA, BRAND, DECADE, item);
    else if (v === 5) title = asm(displaySize, ERA, SUBJECT, STYLE, DECADE, item);
    else              title = asm(displaySize, ERA, BRAND, 'mini', DECADE, item);
  }
  // ── DRESSES ───────────────────────────────────────────────────────────────
  else if (isDress) {
    const item = TYPE || 'womens dress';
    if      (v === 1) title = asm(displaySize, ERA, BRAND, STYLE,    DECADE, item);
    else if (v === 2) title = asm(displaySize, ERA, BRAND, STYLE, DECADE, item);
    else if (v === 3) title = asm(displaySize, ERA, SUBJECT, STYLE,  DECADE, item);
    else if (v === 4) title = asm(displaySize, ERA, BRAND, STYLE,    'midi', DECADE, item);
    else if (v === 5) title = asm(displaySize, ERA, BRAND, DECADE, item);
    else              title = asm(displaySize, ERA, BRAND, STYLE, item);
  }
  // ── BODYSUITS ─────────────────────────────────────────────────────────────
  else if (isBodysuit) {
    const item = TYPE || 'womens bodysuit';
    if      (v === 1) title = asm(displaySize, ERA, BRAND, STYLE,    DECADE, item);
    else if (v === 2) title = asm(displaySize, ERA, BRAND, STYLE, DECADE, item);
    else if (v === 3) title = asm(displaySize, ERA, BRAND, STYLE,    DECADE, item);
    else if (v === 4) title = asm(displaySize, ERA, BRAND, DECADE, item);
    else if (v === 5) title = asm(displaySize, ERA, BRAND, DECADE, item);
    else              title = asm(displaySize, ERA, BRAND, 'snap', DECADE, item);
  }
  // ── TOPS (women) ──────────────────────────────────────────────────────────
  else if (isTop) {
    const item = TYPE || 'womens top';
    if      (v === 1) title = asm(displaySize, ERA, BRAND, STYLE,    DECADE, item);
    else if (v === 2) title = asm(displaySize, ERA, BRAND, STYLE, DECADE, item);
    else if (v === 3) title = asm(displaySize, ERA, BRAND, STYLE, DECADE, item);
    else if (v === 4) title = asm(displaySize, ERA, BRAND, DECADE, item);
    else if (v === 5) title = asm(displaySize, ERA, SUBJECT, STYLE,  DECADE, item);
    else              title = asm(displaySize, ERA, BRAND, STYLE, item);
  }
  // ── GENERIC FALLBACK ──────────────────────────────────────────────────────
  else {
    const item = TYPE || clean(context.category) || 'item';
    if      (v === 1) title = asm(displaySize, ERA, BRAND, STYLE, DECADE, item);
    else if (v === 2) title = asm(displaySize, ERA, SUBJECT, BRAND, DECADE, item);
    else if (v === 3) title = asm(displaySize, ERA, BRAND, STYLE, DECADE, item);
    else              title = asm(displaySize, ERA, BRAND, DECADE, item);
  }

  // ── Remove duplicate words (protecting BRAND/SUBJECT proper noun sequences) ─
  // Swap brand/subject with placeholders BEFORE deduping so words like
  // "Vintage" in "American Vintage" aren't stripped when ERA also says
  // "Vintage Y2K". Restore them after.
  const brandPH   = BRAND   ? '\x00BRAND\x00'   : '';
  const subjectPH = SUBJECT ? '\x00SUBJECT\x00' : '';
  let td = title.replace(/\s{2,}/g, ' ').trim();
  if (BRAND)   td = td.replace(new RegExp(BRAND.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), brandPH);
  if (SUBJECT) td = td.replace(new RegExp(SUBJECT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), subjectPH);
  td = dedupeTitle(td);
  td = fitTo60(td); // run BEFORE restoring placeholders so internal dedupeTitle also treats brand as opaque
  if (BRAND)   td = td.replace(brandPH, BRAND);
  if (SUBJECT) td = td.replace(subjectPH, SUBJECT);
  title = td.replace(/\s{2,}/g, ' ').trim();

  // Hard word-boundary trim to 60 chars (safety net for titles with no synonyms)
  if (title.length <= 60) return title;
  let trimmed = '';
  for (const word of title.split(' ')) {
    const candidate = trimmed ? `${trimmed} ${word}` : word;
    if (candidate.length > 60) break;
    trimmed = candidate;
  }
  return trimmed || title.slice(0, 60);
}


/**
 * Scan a title (or any text) for specific item-type keywords and return
 * precise tags for that item — e.g. "beanie" instead of generic "hats",
 * "backpack" instead of "bags", "crewneck" instead of "sweatshirts".
 *
 * Rules are grouped by category. Multiple matches within a category are
 * all returned so the tags are additive (e.g. "cargo shorts" → ["cargo","shorts"]).
 */
function deriveSpecificTagsFromTitle(text: string): string[] {
  if (!text) return [];
  const t = text.toLowerCase();
  const found = new Set<string>();
  const check = (pattern: RegExp, ...tags: string[]) => {
    if (pattern.test(t)) tags.forEach(tag => found.add(tag));
  };

  // ── HEADWEAR ──────────────────────────────────────────────────────────────
  check(/\bbeanie\b|\bskull\s*cap\b|\bknit\s*hat\b|\bwinter\s*hat\b/, 'beanie', 'knit hat');
  check(/\bsnapback\b/, 'snapback', 'cap');
  check(/\bfitted\s*cap\b|\bfitted\b(?=.*\bcap\b)|\bnew\s*era\b/, 'fitted cap', 'cap');
  check(/\bdad\s*hat\b|\bunstructured\s*cap\b/, 'dad hat', 'cap');
  check(/\btrucker\b/, 'trucker hat', 'cap');
  check(/\bbucket\s*hat\b|\bbucket\b(?=.*\bhat\b)/, 'bucket hat');
  check(/\bvisor\b/, 'visor');
  check(/\bberet\b/, 'beret');
  check(/\bboonie\b|\bbush\s*hat\b/, 'boonie hat');
  check(/\bpanama\s*hat\b/, 'panama hat');
  check(/\bcowboy\s*hat\b|\bwestern\s*hat\b|\bstraw\s*hat\b/, 'cowboy hat');
  check(/\bbaseball\s*cap\b|\bball\s*cap\b/, 'baseball cap', 'cap');
  check(/\bfive[\s-]panel\b/, 'five panel cap', 'cap');
  check(/\bfleece\s*hat\b/, 'fleece hat');
  // Generic fallback — only if nothing specific matched yet
  if (t.match(/\bhat\b|\bcap\b|\bheadwear\b/) && found.size === 0) found.add('hat');

  // ── BAGS ──────────────────────────────────────────────────────────────────
  check(/\bbackpack\b|\bday\s*pack\b|\brucksack\b/, 'backpack');
  check(/\btote\s*bag\b|\btote\b/, 'tote bag', 'tote');
  check(/\bcross[\s-]?body\b/, 'crossbody bag', 'crossbody');
  check(/\bmessenger\s*bag\b|\bmessenger\b(?=.*\bbag\b)/, 'messenger bag');
  check(/\bduffel\b|\bduffle\b|\bgym\s*bag\b/, 'duffel bag');
  check(/\bfanny\s*pack\b|\bbelt\s*bag\b|\bwaist\s*bag\b|\bbum\s*bag\b/, 'fanny pack', 'belt bag');
  check(/\bpurse\b|\bhandbag\b|\bshoulder\s*bag\b/, 'purse', 'handbag');
  check(/\bclutch\b(?=.*\bbag\b|\bpurse\b)?/, 'clutch');
  check(/\bsatchel\b/, 'satchel');
  check(/\bhobo\s*bag\b|\bhobo\b(?=.*\bbag\b)/, 'hobo bag');
  check(/\bwristlet\b/, 'wristlet');
  check(/\bbriefcase\b|\blaptop\s*bag\b/, 'briefcase');
  check(/\bdrawstring\s*bag\b|\bcinch\s*bag\b/, 'drawstring bag');
  check(/\bmini\s*bag\b|\bmicro\s*bag\b/, 'mini bag');
  if (t.match(/\bbag\b|\bpurse\b|\bpouch\b/) && found.size === 0) found.add('bag');

  // ── TOPS / SHIRTS ──────────────────────────────────────────────────────────
  check(/\bgraphic\s*tee\b|\bgraphic\s*t[\s-]?shirt\b/, 'graphic tee');
  check(/\bt[\s-]?shirt\b|\btee\b(?!\s*ball|\s*pee)/, 'tshirt');
  check(/\bpolo\b(?!\s*ralph)/, 'polo');
  check(/\bbutton[\s-]?(?:up|down)\b|\bbuttonup\b/, 'button up');
  check(/\bflannel\b/, 'flannel');
  check(/\bhenley\b/, 'henley');
  check(/\bdress\s*shirt\b|\boxford\s*shirt\b/, 'dress shirt');
  check(/\bcamp\s*collar\b|\bcubana\b|\bbowling\s*shirt\b/, 'camp collar shirt');
  check(/\bhawaiian\s*shirt\b|\baloha\s*shirt\b/, 'hawaiian shirt');
  check(/\bjersey\b(?!\s*shore)/, 'jersey');
  check(/\btank\s*top\b|\bsleeveless\b|\bmuscle\s*tee\b|\bmuscle\s*shirt\b/, 'tank top');
  check(/\bcrop\s*top\b|\bcropped\s*(?:tee|shirt|top)\b/, 'crop top');
  check(/\bringer\s*tee\b|\bringer\s*t[\s-]?shirt\b/, 'ringer tee');
  check(/\blong[\s-]?sleeve\s*(?:shirt|tee)\b/, 'long sleeve');
  check(/\btube\s*top\b|\bstrapless\s*top\b/, 'tube top');
  check(/\bcami\b|\bcamisole\b/, 'camisole');

  // ── SWEATSHIRTS / HOODIES ─────────────────────────────────────────────────
  check(/\bhoodie\b|\bhooded\s*sweatshirt\b/, 'hoodie');
  check(/\bzip[\s-]?up\s*hoodie\b|\bhalf[\s-]?zip\b|\bquarter[\s-]?zip\b/, 'zip-up', 'hoodie');
  check(/\bcrewneck\b|\bcrew[\s-]?neck\b(?!\s*shirt)|\bsweatshirt\b(?!\s*hoodie)/, 'crewneck');
  check(/\bpullover\b/, 'pullover');

  // ── OUTERWEAR ─────────────────────────────────────────────────────────────
  check(/\bbomber\s*jacket\b|\bbomber\b(?=.*\bjacket\b)/, 'bomber jacket', 'jacket');
  check(/\bwindbreaker\b/, 'windbreaker', 'jacket');
  check(/\bparka\b/, 'parka', 'jacket');
  check(/\bpuffer\b|\bdown\s*jacket\b|\bpuffer\s*jacket\b/, 'puffer jacket', 'jacket');
  check(/\bcoach\s*jacket\b/, 'coach jacket', 'jacket');
  check(/\btrack\s*jacket\b/, 'track jacket', 'jacket');
  check(/\bvarsity\s*jacket\b|\bletterman\b/, 'varsity jacket', 'jacket');
  check(/\bdenim\s*jacket\b|\bjean\s*jacket\b/, 'denim jacket', 'jacket');
  check(/\bleather\s*jacket\b|\bmoto\s*jacket\b/, 'leather jacket', 'jacket');
  check(/\btrench\s*coat\b/, 'trench coat', 'coat');
  check(/\bpea\s*coat\b|\bpeacoat\b/, 'peacoat', 'coat');
  check(/\bblaz[eo]r\b/, 'blazer', 'jacket');
  check(/\brain\s*jacket\b|\brain\s*coat\b|\banorak\b/, 'rain jacket');
  check(/\bvest\b(?!\s*pocket)/, 'vest');
  check(/\bfleece\s*jacket\b|\bfleece\b(?=.*\bjacket\b)/, 'fleece jacket', 'jacket');
  if (t.match(/\bjacket\b/) && found.size === 0) found.add('jacket');
  if (t.match(/\bcoat\b/) && found.size === 0) found.add('coat');

  // ── PANTS / BOTTOMS ────────────────────────────────────────────────────────
  check(/\bcargo\s*pants\b|\bcargo\s*trousers\b/, 'cargo pants', 'cargo');
  check(/\bjoggers\b|\bsweatpants\b|\bjogger\s*pants\b/, 'joggers', 'sweatpants');
  check(/\bwide[\s-]?leg\s*(?:jeans|pants|denim)\b/, 'wide leg', 'jeans');
  check(/\bbaggy\s*jeans\b|\bbaggies\b(?=.*\bjean)/, 'baggy jeans', 'jeans');
  check(/\bslim\s*(?:jeans|fit\s*jeans)\b|\bskinny\s*jeans\b/, 'slim jeans', 'jeans');
  check(/\bstraight[\s-]?leg\s*jeans\b/, 'straight leg jeans', 'jeans');
  check(/\bdenim\b|\bjeans\b/, 'jeans');
  check(/\bchinos\b|\bkhakis\b/, 'chinos');
  check(/\bcorduroy\b|\bcords\b(?=.*\bpant)/, 'corduroy');
  check(/\bdress\s*pants\b|\btrousers\b/, 'trousers');
  check(/\bleggings\b/, 'leggings');

  // ── SHORTS ─────────────────────────────────────────────────────────────────
  check(/\bcargo\s*shorts\b/, 'cargo shorts', 'shorts');
  check(/\bjean\s*shorts\b|\bdenim\s*shorts\b|\bcutoffs\b/, 'jean shorts', 'shorts');
  check(/\bbasketball\s*shorts\b|\bbasketball\b(?=.*\bshorts)/, 'basketball shorts', 'shorts');
  check(/\bboard\s*shorts\b|\bswim\s*shorts\b|\bswim\s*trunks\b/, 'board shorts', 'shorts');
  check(/\bathletic\s*shorts\b|\bgyM\s*shorts\b/, 'athletic shorts', 'shorts');
  if (t.match(/\bshorts\b/) && !Array.from(found).some(f => f.includes('short'))) found.add('shorts');

  // ── DRESSES / SKIRTS ───────────────────────────────────────────────────────
  check(/\bmidi\s*dress\b/, 'midi dress', 'dress');
  check(/\bmaxi\s*dress\b/, 'maxi dress', 'dress');
  check(/\bmini\s*dress\b/, 'mini dress', 'dress');
  check(/\bwrap\s*dress\b/, 'wrap dress', 'dress');
  check(/\bshirt\s*dress\b/, 'shirt dress', 'dress');
  if (t.match(/\bdress\b/) && !Array.from(found).some(f => f.includes('dress'))) found.add('dress');
  check(/\bmaxi\s*skirt\b/, 'maxi skirt', 'skirt');
  check(/\bmini\s*skirt\b/, 'mini skirt', 'skirt');
  check(/\bpencil\s*skirt\b/, 'pencil skirt', 'skirt');
  if (t.match(/\bskirt\b/) && !Array.from(found).some(f => f.includes('skirt'))) found.add('skirt');

  // ── FOOTWEAR ───────────────────────────────────────────────────────────────
  check(/\bsneakers?\b|\btrainers?\b|\bkicks\b/, 'sneakers');
  check(/\bboots?\b(?!\s*leg)/, 'boots');
  check(/\bloafers?\b/, 'loafers');
  check(/\bsandals?\b/, 'sandals');
  check(/\bslides?\b(?!\s*deck|\s*show)/, 'slides');
  check(/\bcrocs?\b/, 'crocs');
  check(/\bclogs?\b/, 'clogs');
  check(/\bheels?\b|\bpumps?\b|\bstiletto\b/, 'heels');
  check(/\bflats?\b(?=\s*shoe|\s*sandal)?/, 'flats');
  check(/\bwedges?\b/, 'wedges');
  check(/\bconverse\b|\bchuck\s*taylors?\b|\ball\s*stars?\b/, 'converse', 'sneakers');
  check(/\bvans\b(?!\s*gogh)/, 'vans', 'sneakers');

  // ── ACCESSORIES ───────────────────────────────────────────────────────────
  check(/\bbelt\b(?!\s*bag)/, 'belt');
  check(/\bwallet\b/, 'wallet');
  check(/\bsunglasses\b|\bshades\b|\beyewear\b/, 'sunglasses');
  check(/\bwatch\b/, 'watch');
  check(/\bscarf\b|\bwrap\b(?=\s*scarf)/, 'scarf');
  check(/\bgloves?\b/, 'gloves');
  check(/\bsocks?\b/, 'socks');
  check(/\bbandana\b|\bbandanna\b/, 'bandana');
  check(/\bnecklace\b|\bchain\b(?=.*\bjewel|\s*necklace)/, 'necklace');
  check(/\bbracelet\b|\bcuff\b(?=.*\bjewel)/, 'bracelet');
  check(/\bpin\b(?=.*\bbadge|\s*button)|\blapel\s*pin\b/, 'pin');
  check(/\bpatch\b/, 'patch');
  check(/\btie\b(?!\s*dye)/, 'tie');
  check(/\btie[\s-]?dye\b|\bhandkerchief\b/, 'tie dye');
  check(/\bkeychain\b|\bkey\s*ring\b/, 'keychain');

  // ── SWIMWEAR ──────────────────────────────────────────────────────────────
  check(/\bbikini\b/, 'bikini');
  check(/\bone[\s-]piece\b(?=.*\bswim)|\bswimsuit\b/, 'swimsuit');

  // ── SETS / TRACKSUITS ─────────────────────────────────────────────────────
  check(/\btracksuit\b|\btrack\s*suit\b/, 'tracksuit');
  check(/\bmatching\s*set\b|\bco[\s-]?ord\b|\bsweat\s*set\b/, 'matching set');

  return Array.from(found);
}

/**
 * Generate tags — primary source is #hashtags in voice description,
 * then explicit tags array, then field-based fallback.
 */
function generateTagsFromFields(context: ProductContext): string[] {
  // Derive specific item-type tags from the title (e.g. "beanie", "backpack")
  const titleSpecific = deriveSpecificTagsFromTitle(
    [context.title, context.voiceDescription].filter(Boolean).join(' ')
  );

  const presetTagsNorm = (context.presetTags || []).map((t: string) => t.toLowerCase().replace(/\s+/g, ''));

  // Primary: extract #hashtags from voice description
  const hashtagsFromVoice = (context.voiceDescription || '')
    .match(/#(\w+)/g)
    ?.map((t: string) => t.slice(1).toLowerCase()) || [];
  if (hashtagsFromVoice.length > 0) {
    return Array.from(new Set([...titleSpecific, ...hashtagsFromVoice, ...presetTagsNorm])).slice(0, 8);
  }

  // Secondary: explicit tags array (from voice "tags ... period" command),
  // always merged with preset tags so the product type stays accurate.
  if (context.tags && context.tags.length > 0) {
    const userTags = context.tags.map((t: string) => t.toLowerCase());
    return Array.from(new Set([...titleSpecific, ...presetTagsNorm, ...userTags])).slice(0, 8);
  }

  // If we have preset tags or title-specific tags, build from those
  if (titleSpecific.length > 0 || presetTagsNorm.length > 0) {
    const tags: string[] = [...titleSpecific, ...presetTagsNorm];
    if (context.era) tags.push(...context.era.split(/[\s\/]+/).filter(Boolean));
    if (context.brand) tags.push(context.brand);
    if (context.color) tags.push(...context.color.split(/[\s\/]+/).filter(Boolean));
    if (context.style) tags.push(context.style);
    const result = Array.from(new Set(tags)).slice(0, 8);
    if (result.length < 4) result.push(...pullTagsFromDescription(context));
    return Array.from(new Set(result)).slice(0, 8);
  }

  // Last resort: build from filled fields — no size, no material
  const tags: string[] = [];
  if (context.era) tags.push(...context.era.split(/[\s\/]+/).filter(Boolean));
  if (context.brand) tags.push(context.brand);
  if (context.category) tags.push(context.category);
  if (context.color) tags.push(...context.color.split(/[\s\/]+/).filter(Boolean));
  if (context.style) tags.push(context.style);
  if (tags.length < 4) tags.push(...pullTagsFromDescription(context));

  return Array.from(new Set(tags)).slice(0, 8);
}

function pullTagsFromDescription(context: ProductContext): string[] {
  // 'vintage' and 'retro' intentionally excluded — every item is vintage,
  // so they add no SEO value and collide with brand names like "American Vintage".
  const AESTHETIC_WORDS = [
    'y2k', 'streetwear', 'grunge', 'skate', 'surf', 'hip hop',
    'embroidered', 'graphic', 'spellout', 'band tee', 'rap', 'bootleg', 'workwear',
    'athletic', 'western', 'biker', 'preppy', 'indie', 'alternative', 'collegiate',
  ];
  let src = [context.voiceDescription, context.customDescription].filter(Boolean).join(' ').toLowerCase();
  // Strip brand name so words within a brand (e.g. "Vintage" in "American Vintage") don't false-match
  if (context.brand) {
    src = src.replace(new RegExp('\\b' + context.brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'gi'), '');
  }
  return AESTHETIC_WORDS.filter(w => src.includes(w));
}
