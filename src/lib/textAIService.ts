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
 * Extract fields from voice description (only if explicitly mentioned)
 */
function extractFieldsFromVoice(voiceDesc: string, category?: string): Record<string, any> {
  const extracted: Record<string, any> = {};
  const lower = voiceDesc.toLowerCase();

  // Extract brand (common brands)
  const brandPatterns = [
    /\b(nike|adidas|supreme|carhartt|levi\'?s?|levis|jordan|yeezy|gucci|prada|louis vuitton|lv|champion|north face|patagonia|polo|ralph lauren|tommy hilfiger|gap|old navy|h&m|zara|uniqlo|bape|off-white|balenciaga|versace|fendi|dior|chanel)\b/i
  ];
  for (const pattern of brandPatterns) {
    const brandMatch = voiceDesc.match(pattern);
    if (brandMatch) {
      let brand = brandMatch[1];
      // Normalize common variations
      if (/levi/i.test(brand)) brand = "Levi's";
      else if (/north face/i.test(brand)) brand = "The North Face";
      else if (/ralph lauren/i.test(brand)) brand = "Ralph Lauren";
      else if (/tommy hilfiger/i.test(brand)) brand = "Tommy Hilfiger";
      else if (/louis vuitton|lv/i.test(brand)) brand = "Louis Vuitton";
      else brand = brand.charAt(0).toUpperCase() + brand.slice(1);
      extracted.brand = brand;
      break;
    }
  }

  // Extract model name/number (common models)
  const modelPatterns = [
    /\b(air force 1|af1|jordan 1|j1|yeezy 350|yeezy 700|501|511|air max|dunk|box logo|hoodie|windbreaker)\b/i,
    /model:?\s*([a-z0-9\s-]+)/i,
    /style:?\s*([a-z0-9\s-]+)/i
  ];
  for (const pattern of modelPatterns) {
    const modelMatch = voiceDesc.match(pattern);
    if (modelMatch) {
      extracted.modelName = modelMatch[1].trim();
      break;
    }
  }

  // Extract size (if mentioned)
  // Only match actual clothing sizes, not random numbers or words like "small amount"
  // Match: XS, S, M, L, XL, XXL, XXXL, 2XL, 3XL, 4XL, Extra Large, Medium, etc.
  // For bottoms (pants/shorts): Also allow numeric sizes like "32", "30x34", "28x30"
  const isBottomsCategory = category && /pants|shorts|jeans|bottoms|trousers/i.test(category);
  
  // Check for numeric waist sizes (e.g., "32", "30x34") for bottoms
  if (isBottomsCategory) {
    const waistSizeMatch = lower.match(/\b(\d{2,3})\s*x?\s*(\d{2,3})?\b/);
    if (waistSizeMatch) {
      const waist = waistSizeMatch[1];
      const length = waistSizeMatch[2];
      extracted.size = length ? `${waist}x${length}` : waist;
    }
  }
  
  // If size not yet extracted, try letter sizes
  if (!extracted.size) {
    const sizeWithContextMatch = lower.match(/\bsize:?\s*(extra[\s-]?small|extra[\s-]?large|x-?small|xx?-?large|xxx?-?large|xs|s|m|l|xl|xxl|xxxl|2xl|3xl|4xl|small|medium|large)\b/i);
    const standaloneSizeMatch = lower.match(/\b(extra[\s-]?small|extra[\s-]?large|x-?small|xx?-?large|xxx?-?large|xs|xl|xxl|xxxl|2xl|3xl|4xl)\b/i);
    
    const sizeMatch = sizeWithContextMatch || standaloneSizeMatch;
    
    if (sizeMatch) {
      let size = (sizeMatch[1] || sizeMatch[0]).toUpperCase().replace(/[\s-]/g, ''); // Remove spaces/hyphens
      
      // Reject if it's ONLY digits (e.g., "35" from "$35", "10", "20", etc.)
      // Allow sizes like "2XL", "3XL", "4XL" which contain digits + letters
      const isPureNumber = /^\d+$/.test(size);
      
      if (!isPureNumber) {
        // Normalize sizes
        if (/^EXTRA.?LARGE$/i.test(size) || /^XLARGE$/i.test(size)) size = 'XL';
        else if (/^XX.?LARGE$/i.test(size) || /^XXLARGE$/i.test(size) || /^2XL$/i.test(size)) size = 'XXL';
        else if (/^XXX.?LARGE$/i.test(size) || /^XXXLARGE$/i.test(size) || /^3XL$/i.test(size)) size = '3XL';
        else if (/^4XL$/i.test(size)) size = '4XL';
        else if (/^EXTRA.?SMALL$/i.test(size) || /^XSMALL$/i.test(size)) size = 'XS';
        else if (/^SMALL$/i.test(size)) size = 'S';
        else if (/^MEDIUM$/i.test(size)) size = 'M';
        else if (/^LARGE$/i.test(size)) size = 'L';
        else if (/^XL$/i.test(size)) size = 'XL';
        else if (/^XXL$/i.test(size)) size = 'XXL';
        
        extracted.size = size;
      }
    }
  }

  // Extract colors (if mentioned)
  const colorPatterns = [
    /\b(black|white|red|blue|green|yellow|pink|purple|gray|grey|brown|orange|navy|maroon|burgundy|cream|beige|tan|olive|khaki|teal|turquoise|mint|lavender|crimson|magenta|charcoal|silver|gold)\b/gi
  ];
  const colors: string[] = [];
  colorPatterns.forEach(pattern => {
    const matches = voiceDesc.match(pattern);
    if (matches) {
      matches.forEach(match => {
        const normalized = match.charAt(0).toUpperCase() + match.slice(1).toLowerCase();
        if (!colors.includes(normalized)) colors.push(normalized);
      });
    }
  });
  if (colors.length > 0) {
    extracted.color = colors[0]; // Primary color
    if (colors.length > 1) {
      extracted.secondaryColor = colors[1]; // Secondary color
    }
  }

  // Extract materials (if mentioned)
  const materialMatch = lower.match(/\b(cotton|polyester|denim|leather|wool|silk|fleece|nylon|linen|cashmere|suede|canvas|corduroy|velvet|satin|rayon|spandex|lycra)\b/i);
  if (materialMatch) {
    extracted.material = materialMatch[1].charAt(0).toUpperCase() + materialMatch[1].slice(1);
  }

  // Extract condition (if mentioned)
  if (/new with tags|nwt|brand new/i.test(voiceDesc)) {
    extracted.condition = 'NWT';
  } else if (/like new|mint|pristine/i.test(voiceDesc)) {
    extracted.condition = 'Like New';
  } else if (/excellent|great condition/i.test(voiceDesc)) {
    extracted.condition = 'Excellent';
  } else if (/good condition|gently used/i.test(voiceDesc)) {
    extracted.condition = 'Good';
  } else if (/fair|worn|used/i.test(voiceDesc)) {
    extracted.condition = 'Fair';
  }

  // Extract era (if mentioned)
  const eraMatch = voiceDesc.match(/\b(vintage|retro|90s|80s|70s|60s|50s|y2k|2000s|modern|contemporary|classic)\b/i);
  if (eraMatch) {
    extracted.era = eraMatch[1].charAt(0).toUpperCase() + eraMatch[1].slice(1);
  }

  // Extract style (if mentioned)
  const styleMatch = voiceDesc.match(/\b(streetwear|preppy|grunge|punk|goth|minimalist|boho|vintage|athletic|casual|formal|business)\b/i);
  if (styleMatch) {
    extracted.style = styleMatch[1].charAt(0).toUpperCase() + styleMatch[1].slice(1);
  }

  // Extract gender (if mentioned)
  if (/\b(men\'?s?|male|masculine)\b/i.test(voiceDesc)) {
    extracted.gender = 'Men';
  } else if (/\b(women\'?s?|female|feminine|ladies)\b/i.test(voiceDesc)) {
    extracted.gender = 'Women';
  } else if (/\b(unisex|gender neutral)\b/i.test(voiceDesc)) {
    extracted.gender = 'Unisex';
  } else if (/\b(kids?|children|youth)\b/i.test(voiceDesc)) {
    extracted.gender = 'Kids';
  }

  // Extract measurements (if mentioned)
  const measurements: any = {};
  const pitMatch = voiceDesc.match(/pit\s*(?:to|2)\s*pit:?\s*(\d+(?:\.\d+)?)\s*(?:in|inch|")?/i);
  if (pitMatch) measurements.pitToPit = pitMatch[1];
  
  const lengthMatch = voiceDesc.match(/length:?\s*(\d+(?:\.\d+)?)\s*(?:in|inch|")?/i);
  if (lengthMatch) measurements.length = lengthMatch[1];
  
  const waistMatch = voiceDesc.match(/waist:?\s*(\d+(?:\.\d+)?)\s*(?:in|inch|")?/i);
  if (waistMatch) measurements.waist = waistMatch[1];
  
  const shoulderMatch = voiceDesc.match(/shoulder:?\s*(\d+(?:\.\d+)?)\s*(?:in|inch|")?/i);
  if (shoulderMatch) measurements.shoulder = shoulderMatch[1];
  
  const sleeveMatch = voiceDesc.match(/sleeve:?\s*(\d+(?:\.\d+)?)\s*(?:in|inch|")?/i);
  if (sleeveMatch) measurements.sleeve = sleeveMatch[1];
  
  if (Object.keys(measurements).length > 0) {
    extracted.measurements = measurements;
  }

  // Extract price (if mentioned)
  const priceMatch = voiceDesc.match(/\$\s*(\d+(?:\.\d{2})?)|(\d+)\s*dollars?/i);
  if (priceMatch) {
    extracted.price = priceMatch[1] || priceMatch[2];
  }

  // Extract flaws (if mentioned)
  const flawPatterns = [
    /flaws?:\s*([^.]+)/i,
    /stains?:\s*([^.]+)/i,
    /holes?:\s*([^.]+)/i,
    /damage:\s*([^.]+)/i,
    /has\s+(?:a\s+)?(small|minor|slight)\s+(stain|hole|tear|mark|fade|scratch|scuff)/i,
    /(?:small|minor|slight|tiny)\s+(stain|hole|tear|mark|fade|scratch|scuff|wear|fading|pilling)/i
  ];
  for (const pattern of flawPatterns) {
    const match = voiceDesc.match(pattern);
    if (match) {
      extracted.flaws = match[1] || match[0];
      break;
    }
  }

  // Extract care instructions (if mentioned)
  if (/machine wash|hand wash|dry clean|wash cold|wash warm|tumble dry|hang dry|do not bleach/i.test(voiceDesc)) {
    const careMatch = voiceDesc.match(/(?:care:?\s*)?([^.]*(?:machine wash|hand wash|dry clean|wash cold|wash warm|tumble dry|hang dry|do not bleach)[^.]*)/i);
    if (careMatch) {
      extracted.care = careMatch[1].trim();
    }
  }

  // Extract tags/keywords
  const tags: string[] = [];
  if (/graphic/i.test(voiceDesc)) tags.push('graphic');
  if (/print/i.test(voiceDesc)) tags.push('print');
  if (/embroidered/i.test(voiceDesc)) tags.push('embroidered');
  if (/oversized/i.test(voiceDesc)) tags.push('oversized');
  if (/fitted/i.test(voiceDesc)) tags.push('fitted');
  if (/cropped/i.test(voiceDesc)) tags.push('cropped');
  if (/distressed/i.test(voiceDesc)) tags.push('distressed');
  if (/faded/i.test(voiceDesc)) tags.push('faded');
  if (/rare|grail|hard to find/i.test(voiceDesc)) tags.push('rare');
  if (tags.length > 0) {
    extracted.tags = tags;
  }

  return extracted;
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

  // PART 1: Main voice description (use EXACTLY as provided)
  if (context.voiceDescription && context.voiceDescription.length > 5) {
    let mainDesc = context.voiceDescription.trim();
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
    
    // Add pit to pit and length if available
    if (context.measurements) {
      const pitToPit = context.measurements['Pit to Pit'] || context.measurements['pit to pit'] || 
                       context.measurements['Chest'] || context.measurements['chest'];
      const length = context.measurements['Length'] || context.measurements['length'];
      
      if (pitToPit) {
        description += `✠ Pit to pit- ${pitToPit}\n`;
      }
      if (length) {
        description += `✠ length- ${length}\n`;
      }
      
      // Add other measurements
      Object.entries(context.measurements).forEach(([key, value]) => {
        const lowerKey = key.toLowerCase();
        if (value && 
            lowerKey !== 'pit to pit' && 
            lowerKey !== 'chest' && 
            lowerKey !== 'length') {
          description += `✠ ${key}- ${value}\n`;
        }
      });
    }
    
    description += '\n';
  }

  // PART 3: Condition & Flaws (if provided)
  if (context.condition || context.flaws) {
    if (context.condition) {
      description += `Condition: ${context.condition}\n`;
    }
    if (context.flaws) {
      description += `Flaws: ${context.flaws}\n`;
    }
    description += '\n';
  }

  // PART 4: Care Instructions (if provided)
  if (context.care) {
    description += `Care: ${context.care}\n\n`;
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
  description += '* We note major imperfections—minor signs of age or wear may not be listed, adding to the vintage character.\n\n';
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
