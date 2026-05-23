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
  title?: string;  // Pre-existing product title to use as the description opener
  brand?: string;
  color?: string;
  secondaryColor?: string;
  size?: string;
  material?: string;
  condition?: string;
  era?: string;
  style?: string;
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
    gender?: string;
    measurements?: Record<string, string>;
    price?: string;
    flaws?: string;
    care?: string;
    tags?: string[];
    seoTitle?: string;
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
  const voiceDesc = rawVoiceDesc
    .replace(/\n/g, ' ')
    .replace(/\.(?=\s|$)/g, ' period')
    .replace(/\s{2,}/g, ' ');
  const lower = voiceDesc.toLowerCase();

  // ─────────────────────────────────────────────────────────────────────────
  // PASS 1: Explicit "field value period" commands (highest priority)
  // ─────────────────────────────────────────────────────────────────────────

  // Helper: grab value between a field trigger and the word "period"
  function extractCommand(pattern: RegExp): string | null {
    const match = voiceDesc.match(pattern);
    return match ? match[1].trim() : null;
  }

  // ── BRAND ────────────────────────────────────────────────────────────────
  const brand = extractCommand(/\bbrand\s+(.+?)\s+period\b/i);
  if (brand) extracted.brand = toTitleCase(brand);

  // ── MODEL ─────────────────────────────────────────────────────────────────
  const model = extractCommand(/\bmodel\s+(.+?)\s+period\b/i);
  if (model) extracted.modelName = toTitleCase(model);

  // ── SIZE ──────────────────────────────────────────────────────────────────
  const sizeRaw = extractCommand(/\bsize\s+(.+?)\s+period\b/i);
  if (sizeRaw) {
    extracted.size = normalizeSizeValue(sizeRaw);
  }

  // ── COLOR ─────────────────────────────────────────────────────────────────
  const colorCmd = extractCommand(/\bcolou?r\s+(.+?)\s+period\b/i);
  if (colorCmd) {
    const parts = colorCmd.split(/\s+and\s+|\s*\/\s*|\s+/i).filter(Boolean);
    extracted.color = toTitleCase(parts[0]);
    if (parts[1]) extracted.secondaryColor = toTitleCase(parts[1]);
  }

  // ── MATERIAL ──────────────────────────────────────────────────────────────
  const materialCmd = extractCommand(/\b(?:material|fabric)\s+(.+?)\s+period\b/i);
  if (materialCmd) extracted.material = toTitleCase(materialCmd);

  // ── CONDITION ─────────────────────────────────────────────────────────────
  const condRaw = extractCommand(/\bcondition\s+(.+?)\s+period\b/i);
  if (condRaw) extracted.condition = normalizeCondition(condRaw);

  // ── ERA ───────────────────────────────────────────────────────────────────
  const eraCmd = extractCommand(/\bera\s+(.+?)\s+period\b/i);
  if (eraCmd) extracted.era = normalizeEra(eraCmd);

  // ── STYLE ─────────────────────────────────────────────────────────────────
  const styleCmd = extractCommand(/\bstyle\s+(.+?)\s+period\b/i);
  if (styleCmd) extracted.style = toTitleCase(styleCmd);

  // ── GENDER ────────────────────────────────────────────────────────────────
  const genderCmd = extractCommand(/\bgender\s+(.+?)\s+period\b/i);
  if (genderCmd) extracted.gender = normalizeGender(genderCmd);

  // ── PRICE ─────────────────────────────────────────────────────────────────
  const priceCmd = extractCommand(/\bprice\s+(.+?)\s+period\b/i);
  if (priceCmd) {
    const num = priceCmd.replace(/[^0-9.]/g, '');
    if (num) extracted.price = num;
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
        /\b(?:size\s+|measurement\s+)?(5xl|4xl|3xl|xxxl|2xl|xxl|xl|large|medium|small|xxs|xs)\b|(?:size\s+|men'?s?\s+|women'?s?\s+)?(\d{1,2}(?:[xX]\d{1,2})?(?:\.\d)?)\b/i
      );
      if (sizeFallback) {
        const raw = (sizeFallback[1] || sizeFallback[2] || '').trim();
        // Don't grab years (1990), prices ($45), or lone single digits as sizes
        if (raw && !/^(19|20)\d{2}$/.test(raw) && !/^\$/.test(raw)) {
          extracted.size = normalizeSizeValue(raw);
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
    for (const b of KNOWN_BRANDS) {
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
      extracted.color = toTitleCase(colorFound);
      if (secColor) extracted.secondaryColor = toTitleCase(secColor);
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
      /\b(y2k|90s|80s|70s|60s|50s|1990s?|1980s?|1970s?|1960s?|1950s?|2000s?|vintage|retro)\b/i
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
    'condition', 'era', 'style', 'gender', 'price',
    'flaws?', 'care', 'width', 'length', 'waist', 'shoulder', 'sleeve',
    'inseam', 'outseam', 'leg\\s+opening', 'tags?', 'title',
    'secondary colo(?:u?r)?', 'second color', 'second colour',
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
    'condition', 'era', 'style', 'gender', 'price',
    'flaws?', 'care', 'width', 'length', 'waist', 'shoulder', 'sleeve',
    'inseam', 'outseam', 'leg\\s+opening', 'tags?', 'title',
    'secondary colo(?:u?r)?', 'second color', 'second colour',
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

function normalizeSizeValue(raw: string): string {
  const trimmed = raw.trim();

  // OSFA / One Size Fits All → "OSFA"
  if (/\b(osfa|one[\s-]?size[\s-]?fits[\s-]?all|one[\s-]?size[\s-]?fits[\s-]?most|one[\s-]?size|os)\b/i.test(trimmed)) {
    return 'OSFA';
  }

  // Collapse whitespace/hyphens and lowercase the whole string first so that
  // multi-word spoken sizes like "extra large", "extra extra small", "double extra large"
  // are matched before we fall back to splitting on the first token.
  const collapsed = trimmed.toLowerCase().replace(/[\s-]+/g, '');

  const map: Record<string, string> = {
    // XS
    extrasmall: 'XS', xsmall: 'XS', xs: 'XS',
    xxsmall: 'XXS', extraextrasmall: 'XXS', doubleextrasmall: 'XXS', xxs: 'XXS',
    xxxsmall: '3XS', tripleextrasmall: '3XS', xxxs: '3XS',
    // S / M / L
    small: 'S', s: 'S',
    medium: 'M', m: 'M',
    large: 'L', l: 'L',
    // XL
    extralarge: 'XL', xlarge: 'XL', xl: 'XL',
    // XXL
    xxlarge: 'XXL', extraextralarge: 'XXL', doubleextralarge: 'XXL',
    '2xlarge': 'XXL', '2xl': 'XXL', xxl: 'XXL',
    // 3XL
    xxxlarge: '3XL', tripleextralarge: '3XL',
    '3xlarge': '3XL', '3xl': '3XL', xxxl: '3XL',
    // 4XL
    '4xlarge': '4XL', '4xl': '4XL', xxxxl: '4XL', quadrupleextralarge: '4XL',
    // 5XL
    '5xlarge': '5XL', '5xl': '5XL', xxxxxl: '5XL',
    // OSFA
    '1size': 'OSFA', onesize: 'OSFA',
  };

  // Try the full collapsed string first (handles "extra large", "extra extra small", etc.)
  if (map[collapsed]) return map[collapsed];

  // Fall back to just the first space/slash-separated token for numeric sizes
  // like "32", "32x30", "10.5" that don't need multi-word handling
  const first = trimmed.split(/[\s/]+/)[0];
  const firstCollapsed = first.toLowerCase().replace(/[\s-]+/g, '');
  return map[firstCollapsed] || first.toUpperCase();
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
  
  // Merge extracted with provided context (provided takes precedence)
  const mergedContext = {
    ...context,
    // Only use extracted if field is empty
    brand: context.brand || extracted.brand,
    color: context.color || extracted.color,
    secondaryColor: context.secondaryColor || extracted.secondaryColor,
    size: context.size || extracted.size,
    material: context.material || extracted.material,
    condition: context.condition || extracted.condition,
    era: context.era || extracted.era,
    style: context.style || extracted.style,
    flaws: context.flaws || extracted.flaws,
    care: context.care || extracted.care,
    modelName: context.modelName || extracted.modelName,
    gender: context.gender || extracted.gender,
    price: context.price || extracted.price,
    tags: context.tags || extracted.tags,
    measurements: context.measurements || extracted.measurements,
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

  // PART 2: Size and measurements with symbols (ONLY if provided in fields)
  if (context.size || (context.measurements && Object.keys(context.measurements).length > 0)) {
    if (context.size) {
      description += `✠ SIZE- ${context.size}\n`;
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
function generateTitleFromFields(context: ProductContext): string {
  const clean = (s?: string) =>
    (s || '').replace(/\bperiod\b/gi, '').replace(/\s{2,}/g, ' ').trim();

  // Detect item type from category + voice for bag/hat special handling
  const categoryStr = `${context.category || ''} ${context.voiceDescription || ''}`.toLowerCase();
  const BAG_TYPES = /\b(bag|backpack|tote|purse|handbag|crossbody|cross-body|messenger|duffel|duffle|fanny\s*pack|belt\s*bag|satchel|clutch|wristlet|pouch|briefcase)\b/;
  const HAT_TYPES = /\b(hat|cap|beanie|snapback|fitted|bucket\s*hat|dad\s*hat|trucker|visor|beret|boonie|headwear|five.panel)\b/;

  const isBag = BAG_TYPES.test(categoryStr);
  const isHat = HAT_TYPES.test(categoryStr);

  // Determine size prefix
  let sizePrefix = '';
  if (!isBag) {
    const size = clean(context.size);
    if (isHat) {
      sizePrefix = 'OSFA - ';
    } else if (size) {
      sizePrefix = `${size} - `;
    }
  }

  // Build body: brand → era → style → modelName → category (item type)
  const bodyParts: string[] = [];
  if (context.brand)     bodyParts.push(clean(context.brand));
  if (context.era)       bodyParts.push(clean(context.era));
  if (context.style)     bodyParts.push(clean(context.style));
  if (context.modelName) bodyParts.push(clean(context.modelName));
  if (context.category)  bodyParts.push(clean(context.category));

  const vintageMarker = 'Vintage / Y2K';
  const body = bodyParts.filter(Boolean).join(' ');
  let full = sizePrefix ? `${sizePrefix}${vintageMarker}` : vintageMarker;
  if (body) full += ` ${body}`;

  // Trim to 60 chars at a word boundary
  if (full.length <= 60) return full;
  let trimmed = '';
  for (const word of full.split(' ')) {
    const candidate = trimmed ? `${trimmed} ${word}` : word;
    if (candidate.length > 60) break;
    trimmed = candidate;
  }
  return trimmed || full.slice(0, 60);
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
    return Array.from(new Set(tags)).slice(0, 8);
  }

  // Last resort: build from filled fields
  const tags: string[] = [];
  if (context.era) {
    const eraParts = context.era.split(/[\s\/]+/).filter(Boolean);
    tags.push(...eraParts);
  }
  if (context.brand) tags.push(context.brand);
  if (context.category) tags.push(context.category);
  if (context.color) {
    const colorParts = context.color.split(/[\s\/]+/).filter(Boolean);
    tags.push(...colorParts);
  }
  if (context.size) tags.push(context.size);
  if (context.style) tags.push(context.style);
  if (context.material) tags.push(context.material);

  return Array.from(new Set(tags)).slice(0, 8);
}
