/**
 * Text-based AI service using Hugging Face Inference API
 * Uses text-only models (no vision) - FREE and working!
 */

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
function extractFieldsFromVoice(voiceDesc: string, _category?: string): Record<string, any> {
  const extracted: Record<string, any> = {};
  const lower = voiceDesc.toLowerCase();

  // ─────────────────────────────────────────────────────────────────────────
  // PASS 1: Explicit "field value period" commands (highest priority)
  // ─────────────────────────────────────────────────────────────────────────

  // Helper: grab value between a field trigger and the command terminator.
  // Accepts BOTH the spoken word "period" AND the already-normalised "."
  // so extraction works whether punctuation conversion has run or not.
  function extractCommand(pattern: RegExp): string | null {
    // Re-build the pattern to accept both terminators dynamically.
    // We reconstruct: replace the literal \s+period\b in the source with TERM.
    const src = pattern.source.replace(/\\s\+period\\b/gi, '(?:\\s+period\\b|\\.)');
    const match = voiceDesc.match(new RegExp(src, pattern.flags));
    if (!match) return null;
    // Strip any trailing "." left over from the normalised terminator
    return match[1].trim().replace(/\.$/, '').trim();
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
  if (widthCmd) measurements['Width'] = widthCmd.replace(/[^0-9.]/g, '');

  const lengthCmd = extractCommand(/\blength\s+(.+?)\s+period\b/i);
  if (lengthCmd) measurements['Length'] = lengthCmd.replace(/[^0-9.]/g, '');

  const waistCmd = extractCommand(/\bwaist\s+(.+?)\s+period\b/i);
  if (waistCmd) measurements['Waist'] = waistCmd.replace(/[^0-9.]/g, '');

  const shoulderCmd = extractCommand(/\bshoulder\s+(.+?)\s+period\b/i);
  if (shoulderCmd) measurements['Shoulder'] = shoulderCmd.replace(/[^0-9.]/g, '');

  const sleeveCmd = extractCommand(/\bsleeve\s+(.+?)\s+period\b/i);
  if (sleeveCmd) measurements['Sleeve'] = sleeveCmd.replace(/[^0-9.]/g, '');

  const inseamCmd = extractCommand(/\binseam\s+(.+?)\s+period\b/i);
  if (inseamCmd) measurements['Inseam'] = inseamCmd.replace(/[^0-9.]/g, '');

  // ── TAGS (explicit) ───────────────────────────────────────────────────────
  const tagsRaw = extractCommand(/\btags?\s+(.+?)\s+period\b/i);
  if (tagsRaw) {
    // Split on spaces/commas, then also split any run-together words caused by
    // the Web Speech API merging words from a mid-sentence pause (e.g. "vintageHip Hop"
    // → the uppercase letter marks where the pause joined two tokens without a space).
    // Strategy: insert a space before any uppercase letter that follows a lowercase letter,
    // then split normally on spaces and commas.
    const separated = tagsRaw.replace(/([a-z])([A-Z])/g, '$1 $2');
    extracted.tags = separated.split(/[\s,]+/).filter(Boolean).map((t: string) => t.toLowerCase());
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PASS 2: Contextual fuzzy fallbacks (fire only when explicit command was NOT used)
  // These scan free-form natural speech for common patterns
  // ─────────────────────────────────────────────────────────────────────────

  // ── SIZE fallback ─────────────────────────────────────────────────────────
  // Handles: "XL", "men's XL", "size XL", "32x30", "size 32/34", "size 10.5" (shoes)
  // Also catches OSFA / OS / "one size" / "one size fits all" → "1 SIZE"
  if (!extracted.size) {
    // Check for one-size phrases first (before the numeric fallback grabs stray digits)
    if (/\b(osfa|o\.s\.f\.a|one\s+size\s+fits?\s+all|one\s+size\s+fits?\s+most|one\s+size|os\b)/i.test(voiceDesc)) {
      extracted.size = '1 SIZE';
    } else {
      const sizeFallback = voiceDesc.match(
        /\b(?:size\s+|measurement\s+)?(4xl|3xl|2xl|xxl|xl|extra[\s-]large|large|medium|small|xs|x[\s-]small)\b|(?:size\s+|men'?s?\s+|women'?s?\s+)?(\d{1,2}(?:[xX]\d{1,2})?(?:\.\d)?)\b/i
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
  // Scan for known brand names spoken naturally without the "brand X period" command
  if (!extracted.brand) {
    const KNOWN_BRANDS = [
      // ── Athletic / Sportswear ──────────────────────────────────────────────
      'Nike', 'Adidas', 'Puma', 'Reebok', 'Fila', 'Kappa', 'Umbro', 'Russell',
      'Under Armour', 'Asics', 'New Balance', 'Champion', 'And1', 'Athleta',
      'Ellesse', 'CCM', 'Campagnolo',
      // ── Denim / Heritage ──────────────────────────────────────────────────
      'Levi', 'Levis', "Levi's", 'Wrangler', 'Lee', 'Jordache', 'AG Jeans',
      'Buffalo David Bitton', 'Blank NYC', 'BDG', 'Cotton-Belt', 'Denim Tears',
      'Diesel', 'Dsquared2',
      // ── Streetwear / Hype ─────────────────────────────────────────────────
      'Supreme', 'Stussy', 'Bape', 'A Bathing Ape', 'Amiri', 'Off White',
      'Fear of God', 'Essentials', 'Awake NY', 'Black Scale', 'Avirex',
      'Affliction', 'AllSaints', 'Allsaints', 'Dime', 'Daily Paper',
      'Danielle Guizio', 'Ed Hardy', 'Element', 'Ecko',
      // ── Outdoor / Technical ───────────────────────────────────────────────
      'Patagonia', 'North Face', 'Columbia', 'Arcteryx', "Arc'teryx",
      'Barbour', 'Belstaff', 'Bonclar', 'Arcticwear', 'Canada Goose',
      'Cabelas', 'Eddie Bauer', 'Caterpillar',
      // ── Luxury / Designer ─────────────────────────────────────────────────
      'Gucci', 'Louis Vuitton', 'Balenciaga', 'Burberry', 'Prada', 'Alaia',
      'Alexander McQueen', 'Alexander Wang', 'Armani', 'Armani Exchange',
      'Armani Jeans', 'Emporio Armani', 'Akris', 'Balmain', 'Bally',
      'Bottega Veneta', 'Brunello Cucinelli', 'Stone Island', 'Aquascutum',
      'Ami Paris', 'Cartier', 'Casablanca', 'Chanel', 'Chrome Hearts',
      'Comme des Garcons', 'Coperni', 'Courrèges', 'Dior', 'Dolce & Gabbana',
      'Emilio Pucci', 'Carolina Herrera',
      // ── Preppy / Classic American ─────────────────────────────────────────
      'Ralph Lauren', 'Polo', 'Tommy Hilfiger', 'Calvin Klein', 'Brooks Brothers',
      'Lacoste', 'Fred Perry', 'Nautica', 'Izod', 'Banana Republic',
      'Ann Taylor', 'Anne Klein', 'Alfred Dunner', 'Bernardo',
      'Chaps', 'Chaps Ralph Lauren', 'Charles Tyrwhitt', 'Dockers',
      // ── Mall / Fast Fashion ───────────────────────────────────────────────
      'Gap', 'Old Navy', 'American Eagle', 'Hollister', 'Abercrombie',
      'Aeropostale', 'Anthropologie', 'American Apparel', 'Brandy Melville',
      'Zara', 'H&M', 'ASOS', 'Bershka', 'Bench', 'COS', 'Cotton On',
      'Covington', 'Croft & Barrow', 'Desigual', 'Dressbarn',
      'Christopher Banks', 'Christopher & Banks',
      // ── Workwear ──────────────────────────────────────────────────────────
      'Carhartt', 'Carhartt WIP', 'Dickies', 'Oakley', 'Duluth', 'Duluth Trading',
      'Craftsman', 'DC Shoes', 'DC',
      // ── Footwear / Boots ──────────────────────────────────────────────────
      'Vans', 'Converse', 'Jordan', 'Yeezy', 'Timberland', 'Red Wing',
      'Doc Martens', 'Dr Martens', 'Dr. Martens', 'Birkenstock', 'Blundstone',
      'Sperry', 'Clarks', 'UGG', 'Ugg', 'Crocs',
      // ── Accessories / Eyewear ─────────────────────────────────────────────
      'Coach', 'Cutler and Gross',
      // ── Specialty / Niche ─────────────────────────────────────────────────
      'Starter', 'Logo Athletic', 'Salem', 'Anvil', 'Gildan', 'Hanes',
      'Fruit of the Loom', 'APC', 'Acne Studios', 'Alpha Industries',
      'Sergio Valente', 'Burton', 'Billabong', 'Boden', 'Betsy Barclay',
      'Bill Blass', 'Bear USA', 'Aston Martin', 'Act III', 'All That Jazz',
      'Amanda Smith', 'A.P.C.', 'APT 9', 'Apt9', 'Avisu', 'BLL',
      'Boss Hugo Boss', 'Hugo Boss', 'Bamboo and Moon', 'Batik Bay',
      'Ben Sherman', 'Bermuda Bay', 'Betsybarclay', 'Billblass', 'Billy Plains',
      'Bleu de Paname', 'Butter Goods', 'C.P. Company', 'CP Company',
      'Cabelas', 'Cape Cod', 'Caribbean', 'Caribbean Joe', 'Cartoon Network',
      'Crazy Shirts', 'Casa Donna', 'Chase Authentics', 'Cathy Cho', 'Cathy Choi',
      'Celaia', 'Charley Mood', 'Chaus', 'Ciro Citterio', 'Claude de Saire',
      'Collezione', 'Comint', 'Cornerstone', 'Crossings', 'Cotton-Belt',
      'Cowboys Turtle', 'DDP', 'DKNY', 'DKNY Jeans', 'Darwin', 'David Brooks',
      'David Taylor', 'DeLong', 'Deadstock', 'Deep Blue', 'Dimensions',
      'Disney', 'Doen', 'Donna Louise', 'Down Impact', 'Dun MC', 'Dunbrooke',
      'ELLE', 'East 5th', 'End Clothing', 'Element',
      // ── E–M batch additions ───────────────────────────────────────────────
      'Energie', 'Engineered Garments', 'Erin London', 'Ermenegildo Zegna',
      'Escada', 'Esprit', 'Evan-Picone', 'Everlane', 'Exclusive Leather',
      'Express', 'Fabletics', 'Faded Glory', 'Fear of God', 'Fendi',
      'Fjallraven', 'Foot Locker', 'FuBu', 'FOX', 'Ford Motorsport',
      'Forever 21', 'Frame', 'Free People', 'Freemans', 'FMC', 'FSBN',
      'G-Star', 'G-Star Raw', 'G-Unit', 'GAP', 'GAS', 'Ganni', 'Gelco',
      'Giorgio Fellini', 'Givenchy', 'Gloria Vanderbilt', 'Glossier',
      'Golden Goose', 'Good American', 'Guess', 'Gymshark',
      'Hale Bob', 'Hard Rock', 'Harley Davidson', 'Hawaiian Reserve',
      'Helly Hansen', 'Hermes', 'Heron Preston', 'High Sierra',
      'House of CB', 'Hudson Jeans', 'Hurley', 'Hybrid',
      'Hook Ups', 'Hartwell', 'Hillard & Hanson', 'Hobo Authentic', 'Hot Stuff',
      'INC International Concepts', 'ICON', 'Icebreaker',
      'Illegal Unlimited', 'Impressions', 'Independent Trading',
      'International Scene', 'Irving Posuns', 'Isabel Marant',
      'Island Shores', 'Islander', 'Issey Miyake',
      'J Crew', 'J.Crew', 'JM Collection', 'JaGee', 'Jachs',
      'Jack & Jones', 'Jacqueline Riu', 'Jacquemus', 'JNCO',
      'Jaded London', 'Jansport', 'Jean Paul Gaultier', 'Jeanbay',
      'Jennifer Lloyd', 'Jerzees', 'Jessica Howard', 'Jil Sander',
      'Jinglers', 'John Elliott', 'John F. Gee', 'Jones New York',
      'Joyx', 'Juicy Couture', 'Junya Watanabe', 'Just Cavalli', 'Just Elegance',
      'Kappa', 'Kate Moss', 'Kate Spade', 'Kenzo', 'Kia Purple',
      'Killah', 'Kim Rogers', 'Kim Rogers Signature', 'Kith', 'Koret', 'Kriss', 'Ksubi',
      'L.L. Bean', 'LL Bean', 'LA Wear', 'Lakeland', 'Lands End', "Lands' End",
      'Lanvin', 'Lapetite', 'Lapin Chore', 'Lauren Jeans Co',
      'Le Coq Sportif', 'Le Fumor', 'Lego', 'Lindbergh',
      'Logo 7', 'Logo Athletic', 'Loewe', 'London Fog', 'Longchamp',
      'Loro Piana', 'Lot 29', 'Lucky Brand', 'Lucky Christine', 'Lululemon',
      'MDK', 'MET', 'MGM', 'MSGM', 'Maddox', 'MLB',
      // ── N–S batch additions ───────────────────────────────────────────────
      'Nascar', 'Neighborhood', 'New Directions', 'New Wear', 'Next',
      'Nicola', 'NHL', 'NBA', 'Noah', 'North Crest', 'North River',
      'NoseDNM', 'Notations', 'Nudie Jeans', 'Number 1', 'Nxt',
      'No Boundaries', 'Ocean Current', 'Ocean Pacific', 'Off-White',
      'Official NFL', 'Ohnet', 'Okay Jeans', 'Old Navy', 'Oldport',
      'On Running', 'Opening Ceremony', 'Orizzonte Artico', 'Osaka',
      'Oscar de la Renta', 'Outdoor Voices', 'Ozark Mountain',
      'PacSun', 'Paco', 'Palace', 'Palm Angels', 'Panda', 'Panhandle Slim',
      'Papper In', 'Paul & Shark', 'Paul Smith', 'Pelle', 'Pendleton',
      'Pepe Jeans', 'Per Una', 'Perfect Moment', 'Peter Millar', 'Petrol',
      'Phard', 'Philipp Plein', 'Pier Connection', 'Pierre Cardin',
      'Pineapple Connection', 'Pink', 'Pioneer', 'Pit Stop', 'Pitstop',
      'Plains', 'Pohland', 'Polo Ralph Lauren', 'Polo by Ralph Lauren',
      'Premier International', 'PrettyLittleThing', 'Primitive',
      'Pull & Bear', 'Pull&Bear', 'Pro Player', 'Puritan',
      'Quiksilver', 'R13', 'RK Brand', 'RVCA', 'Racing',
      'Rag & Bone', 'Rag and Bone', 'Rainforest', 'Ray-Ban',
      'Re/Done', 'Realtree', 'Real Leather', 'Red Kap', 'Redcell',
      'Reiss', 'Relcal', 'Replay', 'Represent', 'Requirements',
      'Resistol Ranch', 'Retail', 'Reyn Spooner', 'Rick Owens',
      'Rip Curl', 'River Island', 'Robert Graham', 'Rocawear',
      'Rock Revival', 'Roper', 'Rouge', 'Route 66', 'Roxy',
      'Russell Athletic', 'Rusty', 'Rustler', 'Saddle King',
      // ── S–Z batch additions ───────────────────────────────────────────────
      'Saint Laurent', 'Salem', 'Salvatore Ferragamo', 'Sandro', 'Saucony',
      'Schott NYC', 'Scotch & Soda', 'Scrubbies', 'Sean John', 'Sebastiano',
      'See by Chloé', 'See by Chloe', 'Self-Portrait', 'Seven for All Mankind',
      'Sideout', 'Shein', 'Shinola', 'Signature by Larry Levine',
      'Skechers', 'Sketchley', 'Skims', 'Smartwool', 'Snap On', 'Snidel',
      'Solo', 'Solis Collection', 'Sonoma', 'Sorel', 'Star Wars',
      'Southpole', 'Soviet', 'Spanx', 'Spenser Jeremy', 'Sports Attack',
      'Sports Specialties', 'Sportsmaster', 'Spyder', 'St Johns Bay',
      'St Michael', 'Stella McCartney', 'Stussy', 'Stüssy',
      'Sugarloaf', 'Sun Surf', 'Shaded Limited', 'Swingster', 'Swish Jeans',
      'TNA', 'Tapout', 'Talbots', 'TanJay', 'Ted Baker', 'Temple', 'Thales',
      'The Daily Planet', 'The Hundreds', 'The Kooples', 'The Thrift',
      'Theory', 'Thom Browne', 'Together', 'Tom English', 'Tom Ford',
      'Tommy Bahama', 'Top Heavy', 'Topman', 'Topshop', 'Torelli',
      'Tory Burch', 'Trader Bay', 'Trimark', 'Triple R Brand',
      'Tru-Spec', 'True Religion', 'Tultex',
      'UMM', 'Unbranded', 'U.S. Polo Assn', 'US Polo Assn',
      'Union', 'Union Bay', 'Unlimited', 'Urban Outfitters', 'Urban Star',
      'Valentino', 'Van Allan', 'Varley', 'Velvet by Graham & Spencer',
      'Venezia', 'Vera Bradley', 'Vetements', "Victoria's Secret",
      'Vince', 'Vineyard Vines', 'Vintage Havana', 'Violet & Claire', 'Volcom',
      'Warner Bros', 'West Coast Choppers', 'Wales Bonner', 'Wallis',
      'White Horse', 'Wilsons', 'Winlit', "Winner's Choice", 'Winners Circle',
      'Woodland Leather', 'Woolrich', "Work N' Sport", 'Worldwide', 'Worthington',
      'X-Mail', 'Xlarge', 'Y-3', 'YSL', 'Zac & Rachel',
      'Zadig & Voltaire', 'Zem London', 'Zero King', 'Zimmermann',
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
    const COLOR_WORDS = [
      'black', 'white', 'grey', 'gray', 'navy', 'blue', 'red', 'green', 'yellow',
      'orange', 'purple', 'pink', 'brown', 'tan', 'khaki', 'cream', 'beige', 'off white',
      'olive', 'maroon', 'burgundy', 'teal', 'cyan', 'coral', 'salmon', 'lavender',
      'charcoal', 'heather grey', 'heather gray', 'royal blue', 'forest green',
    ];
    const colorFound = COLOR_WORDS.find(c => new RegExp(`\\b${c}\\b`, 'i').test(lower));
    if (colorFound) {
      // Check for a second color immediately after (e.g. "black and white", "navy blue")
      const secMatch = lower.match(new RegExp(`\\b${colorFound}\\b\\s+(?:and\\s+)?(\\w+(?:\\s+\\w+)?)`, 'i'));
      const potentialSec = secMatch ? secMatch[1].trim() : null;
      const secColor = potentialSec && COLOR_WORDS.find(c => c === potentialSec) ? potentialSec : null;
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
    { key: 'Width', patterns: [
      /(\d+(?:\.\d)?)\s*(?:inch(?:es)?)?\s*(?:pit[\s-]to[\s-]pit|p2p|chest|across\s+chest)/i,
      /(?:pit[\s-]to[\s-]pit|p2p|chest|across\s+chest)\s+(\d+(?:\.\d)?)/i,
    ]},
    { key: 'Length', patterns: [
      /(\d+(?:\.\d)?)\s*(?:inch(?:es)?)?\s*(?:long|length|top\s+to\s+bottom)/i,
      /(?:length|top\s+to\s+bottom)\s+(\d+(?:\.\d)?)/i,
    ]},
    { key: 'Waist', patterns: [
      /(\d+(?:\.\d)?)\s*(?:inch(?:es)?)?\s*waist/i,
      /waist\s+(\d+(?:\.\d)?)/i,
    ]},
    { key: 'Shoulder', patterns: [
      /(\d+(?:\.\d)?)\s*(?:inch(?:es)?)?\s*shoulder/i,
      /shoulder\s+(?:to\s+shoulder\s+)?(\d+(?:\.\d)?)/i,
    ]},
    { key: 'Sleeve', patterns: [
      /(\d+(?:\.\d)?)\s*(?:inch(?:es)?)?\s*sleeve/i,
      /sleeve\s+(?:length\s+)?(\d+(?:\.\d)?)/i,
    ]},
    { key: 'Inseam', patterns: [
      /(\d+(?:\.\d)?)\s*(?:inch(?:es)?)?\s*inseam/i,
      /inseam\s+(\d+(?:\.\d)?)/i,
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

// ── Normalizer helpers ────────────────────────────────────────────────────────

function normalizeCondition(raw: string): string {
  const c = raw.toLowerCase();
  if (/nwt|new with tags|brand new/.test(c)) return 'NWT';
  if (/like[\s-]new|mint|pristine/.test(c)) return 'Like New';
  if (/excellent|great/.test(c)) return 'Excellent';
  if (/good|gently[\s-]used/.test(c)) return 'Good';
  if (/fair|worn|used|pre[\s-]owned/.test(c)) return 'Fair';
  return toTitleCase(raw);
}

function normalizeEra(raw: string): string {
  const r = raw.toLowerCase().replace(/\s+/g, '');
  if (r === 'y2k' || r === '2000s') return 'Y2K';
  if (/^90s?$|^1990s?$/.test(r)) return '90s';
  if (/^80s?$|^1980s?$/.test(r)) return '80s';
  if (/^70s?$|^1970s?$/.test(r)) return '70s';
  if (/^60s?$|^1960s?$/.test(r)) return '60s';
  if (/^50s?$|^1950s?$/.test(r)) return '50s';
  return toTitleCase(raw);
}

function normalizeGender(raw: string): string {
  const g = raw.toLowerCase();
  if (/^men|^male|^mens/.test(g)) return 'Men';
  if (/^women|^female|^ladies|^womens/.test(g)) return 'Women';
  if (/unisex|neutral/.test(g)) return 'Unisex';
  if (/kid|child|youth|boy|girl/.test(g)) return 'Kids';
  return toTitleCase(raw);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function toTitleCase(str: string): string {
  return str.trim().replace(/\w\S*/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

function normalizeSizeValue(raw: string): string {
  const trimmed = raw.trim();
  // One-size phrases → "1 SIZE" (check before splitting on spaces)
  // Also catches partial phrases like "one size fits" (missing "all") and "one size fit"
  if (/^(osfa|o\.s\.f\.a|one[\s-]size[\s-]fits?[\s-](all|most)|one[\s-]size[\s-]fits?|one[\s-]size|os)$/i.test(trimmed)) {
    return '1 SIZE';
  }
  // Take only the first token if there's a slash or slash+word (e.g., "XL/XLARGE" → "XL")
  const first = trimmed.split(/[\/\s]+/)[0];
  const s = first.trim().toLowerCase().replace(/[\s-]+/g, '');
  const map: Record<string, string> = {
    extrasmall: 'XS', xsmall: 'XS', xs: 'XS',
    small: 'S', s: 'S',
    medium: 'M', m: 'M',
    large: 'L', l: 'L',
    extralarge: 'XL', xlarge: 'XL', xl: 'XL',
    xxlarge: 'XXL', '2xlarge': 'XXL', '2xl': 'XXL', xxl: 'XXL',
    xxxlarge: '3XL', '3xlarge': '3XL', '3xl': '3XL', xxxl: '3XL',
    '4xlarge': '4XL', '4xl': '4XL', xxxxl: '4XL',
    // One-size abbreviations as standalone tokens
    osfa: '1 SIZE', os: '1 SIZE', onesize: '1 SIZE',
  };
  // Return mapped value or original uppercased first token (preserves "32", "32x30", "32/34")
  return map[s] || first.toUpperCase();
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

    // Strip "field <value> period/." voice commands from the display description
    // These are handled separately via extractFieldsFromVoice; don't show them in the text
    // Matches both:
    //   "brand rock period" (not yet normalised)  →  \s+period\b
    //   "brand rock."       (already normalised)  →  \.
    //   "brand rock"        (no terminator, end of string)
    const fieldPrefixes = [
      'brand', 'model', 'size', 'colou?r', 'secondary colou?r',
      'material', 'fabric', 'condition', 'era', 'style', 'gender', 'price',
      'flaws?', 'damage', 'care', 'tags?',
      'width', 'length', 'waist', 'shoulder', 'sleeve', 'inseam'
    ].join('|');
    // Strip "fieldname value." or "fieldname value period" or "fieldname value<end>"
    mainDesc = mainDesc.replace(
      new RegExp(`\\b(${fieldPrefixes})\\s+.+?(?:\\.(?=\\s|$)|\\s+period\\b|$)`, 'gi'), ''
    );
    // Also strip run-together variants where no space after field name due to pause-merge
    // e.g. "sizeone size fits all." → strip from "size" onwards to next "." or end of string
    mainDesc = mainDesc.replace(
      new RegExp(`\\b(${fieldPrefixes})(?=\\S)[^.]*(?:\\.|$)`, 'g'), ''
    );

    // Strip condition phrases from description
    mainDesc = mainDesc.replace(/\b(nwt|new with tags|like[\s-]new|mint|pristine|excellent[\s-]condition|great[\s-]condition|good[\s-]condition|gently[\s-]used|fair[\s-]condition|worn[\s-]condition|brand[\s-]new|in[\s-]good[\s-]condition|in[\s-]great[\s-]condition|in[\s-]excellent[\s-]condition|very[\s-]good[\s-]condition|pre[\s-]owned)\b[,.]?\s*/gi, '');

    // Strip care instruction phrases from description
    mainDesc = mainDesc.replace(/\b(machine[\s-]wash(?:[\s-]cold|[\s-]warm|[\s-]hot)?|hand[\s-]wash(?:[\s-]only)?|dry[\s-]clean(?:[\s-]only)?|wash[\s-]cold|wash[\s-]warm|wash[\s-]hot|tumble[\s-]dry(?:[\s-]low|[\s-]high|[\s-]no[\s-]heat)?|hang[\s-]dry|air[\s-]dry(?:[\s-]only)?|do[\s-]not[\s-]bleach|do[\s-]not[\s-]tumble[\s-]dry|iron(?:[\s-]low|[\s-]medium|[\s-]high)?|dry[\s-]flat|lay[\s-]flat[\s-]to[\s-]dry|line[\s-]dry)[^.]*[.]?\s*/gi, '');

    // Clean up any double spaces or leading/trailing commas left behind
    mainDesc = mainDesc.replace(/\s{2,}/g, ' ').replace(/^[,.\s]+|[,.\s]+$/g, '').trim();

    // Capitalize first letter only
    mainDesc = mainDesc.charAt(0).toUpperCase() + mainDesc.slice(1);
    description += mainDesc;
  } else {
    // Fallback: build ONLY from filled fields (no assumptions)
    const intro = buildIntroFromFields(context);
    if (intro) {
      description += intro;
    } else {
      description += 'Vintage clothing item'; // Generic fallback
    }
  }

  description += '\n\n\n';

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
        description += `✠ length- ${length}\n`;
      }
      
      // Add other measurements
      Object.entries(context.measurements).forEach(([key, value]) => {
        const lowerKey = key.toLowerCase();
        if (value && 
            lowerKey !== 'width' && 
            lowerKey !== 'length') {
          description += `✠ ${key}- ${value}\n`;
        }
      });
    }
    
    description += '\n';
  }

  // PART 5: Call to action
  description += 'BUNDLE AND SAVE!!!!!!\n\n';

  // PART 6: Tags (ONLY from explicitly filled fields, no assumptions)
  const tags = generateTagsFromFields(context);
  if (tags.length > 0) {
    description += tags.map(tag => `#${tag.toLowerCase().replace(/\s+/g, '')}`).join(' ');
    description += '\n\n';
  }

  // PART 7: Standard disclaimers
  description += '* We note major imperfections—minor signs of age or wear may not be listed, adding to the vintage character.\n';
  description += '* High-quality piece, perfect for streetwear.\n';
  description += '* Next-day shipping.\n';
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
 * Generate title ONLY from filled fields.
 * SEO priority order: brand → era → color → material → style → category → size
 * Target: ≤60 characters. Words are never split mid-word — if a whole word fits
 * (even slightly over 60 chars) it is kept; if it would push the title well over
 * the limit the whole token is dropped.
 */
function generateTitleFromFields(context: ProductContext): string {
  // Build tokens in SEO-priority order (highest value first)
  const candidates: string[] = [];
  if (context.brand)    candidates.push(context.brand);
  if (context.era)      candidates.push(context.era);
  if (context.color)    candidates.push(context.color);
  if (context.material) candidates.push(context.material);
  if (context.style)    candidates.push(context.style);
  if (context.category) candidates.push(context.category);
  if (context.size)     candidates.push(`Size ${context.size}`);

  if (candidates.length === 0) return 'Vintage Item';

  const LIMIT = 60;
  // Grace: allow a word to finish even if it pushes past 60, as long as the
  // overshoot is small (≤ one average word, ~12 chars). This prevents cutting
  // a word like "Embroidered" just because it lands at character 63.
  const GRACE = 12;

  const kept: string[] = [];
  let length = 0;

  for (const token of candidates) {
    const needed = length === 0 ? token.length : length + 1 + token.length;
    if (needed <= LIMIT + GRACE) {
      kept.push(token);
      length = needed;
    }
    // If this token alone would blow past LIMIT + GRACE, skip it entirely
  }

  const title = kept.join(' ');
  return title.length > 0 ? title : 'Vintage Item';
}

/**
 * Generate tags ONLY from filled fields
 * No assumptions about brand, style, etc.
 */
function generateTagsFromFields(context: ProductContext): string[] {
  const tags: string[] = [];
  
  // ONLY add tags for explicitly filled fields
  if (context.era) {
    // Split era if it contains multiple words (e.g., "Vintage / Y2K")
    const eraParts = context.era.split(/[\s\/]+/).filter(Boolean);
    tags.push(...eraParts);
  }
  if (context.brand) tags.push(context.brand);
  if (context.category) tags.push(context.category);
  if (context.color) {
    // Split color if multiple (e.g., "Black/White")
    const colorParts = context.color.split(/[\s\/]+/).filter(Boolean);
    tags.push(...colorParts);
  }
  if (context.size) tags.push(context.size);
  if (context.style) tags.push(context.style);
  if (context.material) tags.push(context.material);
  
  // Remove duplicates
  return Array.from(new Set(tags));
}
