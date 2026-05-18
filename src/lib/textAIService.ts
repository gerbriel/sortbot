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
  const voiceDesc = rawVoiceDesc.replace(/\n/g, ' ').replace(/\s{2,}/g, ' ');
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
      .replace(/#/g, ' ')
      .split(/[\s,]+/)
      .filter(Boolean)
      .map((t: string) => t.toLowerCase());
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
  // Guard: only run this on actual voice transcripts (must contain the word "period" somewhere)
  // so that re-parsing a generated description doesn't false-match brand names.
  const looksLikeVoiceTranscript = /\bperiod\b/i.test(voiceDesc);
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
  return voiceDesc
    .replace(
      new RegExp(`\\s*\\b(${FIELD_TRIGGERS})\\b`, 'gi'),
      '\n$1'
    )
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

  // PART 1: Main voice description (use EXACTLY as provided, minus condition/care)
  if (context.voiceDescription && context.voiceDescription.length > 5) {
    let mainDesc = context.voiceDescription.trim();

    // Strip "field <value> period" voice commands from the display description
    // These are handled separately via extractFieldsFromVoice; don't show them in the text
    const fieldPrefixes = [
      'brand', 'model', 'size', 'color', 'colour', 'secondary color', 'secondary colour',
      'material', 'fabric', 'condition', 'era', 'style', 'gender', 'price',
      'flaws?', 'damage', 'care', 'tags?', 'title',
      'width', 'length', 'waist', 'shoulder', 'sleeve', 'inseam'
    ].join('|');
    mainDesc = mainDesc.replace(new RegExp(`\\b(?:${fieldPrefixes})\\s+.+?\\s+period\\b`, 'gi'), '');

    // Any remaining standalone spoken "period" → "." (sentence end)
    mainDesc = mainDesc.replace(/\bperiod\b/gi, '.').replace(/\.\.+/g, '.').replace(/\s+\./g, '.');

    // Strip condition phrases from description
    mainDesc = mainDesc.replace(/\b(nwt|new with tags|like[\s-]new|mint|pristine|excellent[\s-]condition|great[\s-]condition|good[\s-]condition|gently[\s-]used|fair[\s-]condition|worn[\s-]condition|brand[\s-]new|in[\s-]good[\s-]condition|in[\s-]great[\s-]condition|in[\s-]excellent[\s-]condition|very[\s-]good[\s-]condition|pre[\s-]owned)\b[,.]?\s*/gi, '');

    // Strip care instruction phrases from description
    mainDesc = mainDesc.replace(/\b(machine[\s-]wash(?:[\s-]cold|[\s-]warm|[\s-]hot)?|hand[\s-]wash(?:[\s-]only)?|dry[\s-]clean(?:[\s-]only)?|wash[\s-]cold|wash[\s-]warm|wash[\s-]hot|tumble[\s-]dry(?:[\s-]low|[\s-]high|[\s-]no[\s-]heat)?|hang[\s-]dry|air[\s-]dry(?:[\s-]only)?|do[\s-]not[\s-]bleach|do[\s-]not[\s-]tumble[\s-]dry|iron(?:[\s-]low|[\s-]medium|[\s-]high)?|dry[\s-]flat|lay[\s-]flat[\s-]to[\s-]dry|line[\s-]dry)[^.]*[.]?\s*/gi, '');

    // Clean up any double spaces or leading/trailing commas left behind
    mainDesc = mainDesc.replace(/\s{2,}/g, ' ').replace(/^[,.\s]+|[,.\s]+$/g, '').trim();

    // Capitalize first letter only
    mainDesc = mainDesc.charAt(0).toUpperCase() + mainDesc.slice(1);

    // Prepend "Vintage / Y2K" inline at the start of the paragraph
    // If size is known, prefix it: "OSFA - Vintage / Y2K ..."
    const sizePrefix = context.size ? `${context.size} - ` : '';
    description += `${sizePrefix}Vintage / Y2K ${mainDesc}`;
  } else {
    // Fallback: build ONLY from filled fields (no assumptions)
    const intro = buildIntroFromFields(context);
    const sizePrefix = context.size ? `${context.size} - ` : '';
    description += `${sizePrefix}Vintage / Y2K ${intro || 'Vintage clothing item'}`;
  }

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
    suggestedTitle: generateTitleFromFields(context),
    suggestedTags: tags
  };
}

/**
 * Build intro ONLY from explicitly filled fields
 * No assumptions, no AI guessing
 */
function buildIntroFromFields(context: ProductContext): string {
  const { brand, category, color, era, style } = context;
  
  const parts: string[] = [];
  
  // ONLY add if explicitly provided in fields
  if (era) parts.push(era.toLowerCase());
  if (style) parts.push(style.toLowerCase());
  if (brand) parts.push(brand); // Keep brand case as entered
  if (color) parts.push(color.toLowerCase());
  if (category) parts.push(category.toLowerCase());
  
  return parts.join(' ');
}

/**
 * Generate SEO title ONLY from filled fields.
 * - Max 60 characters (Google/Shopify best practice)
 * - Priority order: Brand → Era/Style → Color → Category → Size
 * - "period" word is never included (it's a voice delimiter, not content)
 */
function generateTitleFromFields(context: ProductContext): string {
  // Strip the voice delimiter word "period" from any field value before using it
  const clean = (s?: string) =>
    (s || '').replace(/\bperiod\b/gi, '').replace(/\s{2,}/g, ' ').trim();

  const parts: string[] = [];

  if (context.brand) parts.push(clean(context.brand));
  if (context.era)   parts.push(clean(context.era));
  if (context.style) parts.push(clean(context.style));
  if (context.color) parts.push(clean(context.color));
  if (context.category) parts.push(clean(context.category));
  if (context.size)  parts.push(`(${clean(context.size)})`);

  const raw = parts.filter(Boolean).join(' ') || 'Vintage Item';

  // Trim to 60 characters at a word boundary
  if (raw.length <= 60) return raw;
  let trimmed = '';
  for (const word of raw.split(' ')) {
    const candidate = trimmed ? `${trimmed} ${word}` : word;
    if (candidate.length > 60) break;
    trimmed = candidate;
  }
  return trimmed || raw.slice(0, 60);
}

/**
 * Generate tags — primary source is #hashtags in voice description,
 * then explicit tags array, then field-based fallback.
 */
function generateTagsFromFields(context: ProductContext): string[] {
  // Primary: extract #hashtags from voice description
  const hashtagsFromVoice = (context.voiceDescription || '')
    .match(/#(\w+)/g)
    ?.map((t: string) => t.slice(1).toLowerCase()) || [];
  if (hashtagsFromVoice.length > 0) {
    return Array.from(new Set(hashtagsFromVoice)).slice(0, 8);
  }

  // Secondary: explicit tags array (from voice "tags ... period" command)
  if (context.tags && context.tags.length > 0) {
    return Array.from(new Set(context.tags.map((t: string) => t.toLowerCase()))).slice(0, 8);
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
