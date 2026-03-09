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

  // Helper: grab value between a field trigger and the word "period"
  // Matches: <trigger word(s)> <captured value> period
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
  const color = extractCommand(/\bcolor\s+(.+?)\s+period\b/i);
  if (color) {
    // Support "black and white" or "black white" → primary + secondary
    const parts = color.split(/\s+and\s+|\s*\/\s*|\s+/i).filter(Boolean);
    extracted.color = toTitleCase(parts[0]);
    if (parts[1]) extracted.secondaryColor = toTitleCase(parts[1]);
  }

  // ── MATERIAL ──────────────────────────────────────────────────────────────
  const material = extractCommand(/\bmaterial\s+(.+?)\s+period\b/i);
  if (material) extracted.material = toTitleCase(material);

  // ── CONDITION ─────────────────────────────────────────────────────────────
  const condRaw = extractCommand(/\bcondition\s+(.+?)\s+period\b/i);
  if (condRaw) {
    const c = condRaw.toLowerCase();
    if (/nwt|new with tags/.test(c)) extracted.condition = 'NWT';
    else if (/like new|mint|pristine/.test(c)) extracted.condition = 'Like New';
    else if (/excellent|great/.test(c)) extracted.condition = 'Excellent';
    else if (/good|gently used/.test(c)) extracted.condition = 'Good';
    else if (/fair|worn|used/.test(c)) extracted.condition = 'Fair';
    else extracted.condition = toTitleCase(condRaw);
  }

  // ── ERA ───────────────────────────────────────────────────────────────────
  const era = extractCommand(/\bera\s+(.+?)\s+period\b/i);
  if (era) extracted.era = era.toUpperCase().replace(/^(\d{2,4}S?)$/i, s => s.toUpperCase()) || toTitleCase(era);

  // ── STYLE ─────────────────────────────────────────────────────────────────
  const style = extractCommand(/\bstyle\s+(.+?)\s+period\b/i);
  if (style) extracted.style = toTitleCase(style);

  // ── GENDER ────────────────────────────────────────────────────────────────
  const genderRaw = extractCommand(/\bgender\s+(.+?)\s+period\b/i);
  if (genderRaw) {
    const g = genderRaw.toLowerCase();
    if (/men|male|masculine/.test(g)) extracted.gender = 'Men';
    else if (/women|female|ladies|feminine/.test(g)) extracted.gender = 'Women';
    else if (/unisex|neutral/.test(g)) extracted.gender = 'Unisex';
    else if (/kid|child|youth/.test(g)) extracted.gender = 'Kids';
    else extracted.gender = toTitleCase(genderRaw);
  }

  // ── PRICE ─────────────────────────────────────────────────────────────────
  const priceRaw = extractCommand(/\bprice\s+(.+?)\s+period\b/i);
  if (priceRaw) {
    const num = priceRaw.replace(/[^0-9.]/g, '');
    if (num) extracted.price = num;
  }

  // ── FLAWS ─────────────────────────────────────────────────────────────────
  const flaws = extractCommand(/\bflaws?\s+(.+?)\s+period\b/i);
  if (flaws) extracted.flaws = flaws;

  // ── CARE ──────────────────────────────────────────────────────────────────
  const care = extractCommand(/\bcare\s+(.+?)\s+period\b/i);
  if (care) extracted.care = care;

  // ── MEASUREMENTS ──────────────────────────────────────────────────────────
  const measurements: Record<string, string> = {};

  const width = extractCommand(/\bwidth\s+(.+?)\s+period\b/i);
  if (width) measurements['Width'] = width.replace(/[^0-9.]/g, '');

  const length = extractCommand(/\blength\s+(.+?)\s+period\b/i);
  if (length) measurements['Length'] = length.replace(/[^0-9.]/g, '');

  const waist = extractCommand(/\bwaist\s+(.+?)\s+period\b/i);
  if (waist) measurements['Waist'] = waist.replace(/[^0-9.]/g, '');

  const shoulder = extractCommand(/\bshoulder\s+(.+?)\s+period\b/i);
  if (shoulder) measurements['Shoulder'] = shoulder.replace(/[^0-9.]/g, '');

  const sleeve = extractCommand(/\bsleeve\s+(.+?)\s+period\b/i);
  if (sleeve) measurements['Sleeve'] = sleeve.replace(/[^0-9.]/g, '');

  const inseam = extractCommand(/\binseam\s+(.+?)\s+period\b/i);
  if (inseam) measurements['Inseam'] = inseam.replace(/[^0-9.]/g, '');

  if (Object.keys(measurements).length > 0) extracted.measurements = measurements;

  // ── TAGS ──────────────────────────────────────────────────────────────────
  const tagsRaw = extractCommand(/\btags?\s+(.+?)\s+period\b/i);
  if (tagsRaw) {
    extracted.tags = tagsRaw.split(/[\s,]+/).filter(Boolean).map((t: string) => t.toLowerCase());
  }

  return extracted;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function toTitleCase(str: string): string {
  return str.trim().replace(/\w\S*/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

function normalizeSizeValue(raw: string): string {
  const s = raw.trim().toLowerCase().replace(/[\s-]+/g, '');
  const map: Record<string, string> = {
    extrasmall: 'XS', xsmall: 'XS', xs: 'XS',
    small: 'S', s: 'S',
    medium: 'M', m: 'M',
    large: 'L', l: 'L',
    extralarge: 'XL', xlarge: 'XL', xl: 'XL',
    xxlarge: 'XXL', '2xlarge': 'XXL', '2xl': 'XXL', xxl: 'XXL',
    xxxlarge: '3XL', '3xlarge': '3XL', '3xl': '3XL', xxxl: '3XL',
    '4xlarge': '4XL', '4xl': '4XL', xxxxl: '4XL',
  };
  return map[s] || raw.toUpperCase();
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
      'flaws?', 'damage', 'care', 'tags?',
      'width', 'length', 'waist', 'shoulder', 'sleeve', 'inseam'
    ].join('|');
    mainDesc = mainDesc.replace(new RegExp(`\\b(?:${fieldPrefixes})\\s+.+?\\s+period\\b`, 'gi'), '');

    // Strip condition phrases from description
    mainDesc = mainDesc.replace(/\b(nwt|new with tags|like new|excellent\s*condition|great\s*condition|good\s*condition|gently used|fair\s*condition|worn\s*condition|brand new)\b[,.]?\s*/gi, '');

    // Strip care instruction phrases from description
    mainDesc = mainDesc.replace(/\b(machine wash\s*(cold|warm|hot)?|hand wash|dry clean( only)?|wash cold|wash warm|tumble dry(\s*(low|high|no heat))?|hang dry|air dry|do not bleach|do not tumble dry|iron\s*(low|medium|high)?|dry flat)[^.]*[.]?\s*/gi, '');

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
 * Generate title ONLY from filled fields
 */
function generateTitleFromFields(context: ProductContext): string {
  const parts: string[] = [];
  
  // ONLY use what's explicitly filled
  if (context.brand) parts.push(context.brand);
  if (context.era) parts.push(context.era);
  if (context.color) parts.push(context.color);
  if (context.category) parts.push(context.category);
  if (context.size) parts.push(`Size ${context.size}`);

  return parts.length > 0 ? parts.join(' ') : 'Vintage Item';
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
