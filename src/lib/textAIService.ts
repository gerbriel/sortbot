/**
 * Text-based AI service using Hugging Face Inference API
 * Uses text-only models (no vision) - FREE and working!
 */

interface ProductContext {
  voiceDescription?: string;
  brand?: string;
  color?: string;
  size?: string;
  material?: string;
  condition?: string;
  era?: string;
  style?: string;
  category?: string;
  measurements?: Record<string, string>;
  flaws?: string; // NEW: For flaws/imperfections section
  care?: string; // NEW: For care instructions
}

export interface AIGeneratedContent {
  description: string;
  suggestedTitle?: string;
  suggestedTags?: string[];
  extractedFields?: { // NEW: Fields extracted from voice
    brand?: string;
    color?: string;
    size?: string;
    material?: string;
    condition?: string;
    era?: string;
    flaws?: string;
    care?: string;
  };
}

/**
 * Extract fields from voice description (only if explicitly mentioned)
 */
function extractFieldsFromVoice(voiceDesc: string): Record<string, string> {
  const extracted: Record<string, string> = {};
  const lower = voiceDesc.toLowerCase();

  // Extract size (if mentioned)
  const sizeMatch = lower.match(/\b(small|medium|large|x-?large|xx-?large|xs|s|m|l|xl|xxl)\b/i);
  if (sizeMatch) {
    let size = sizeMatch[1].toUpperCase();
    if (/x-?large|xl/i.test(size) && !/xx/i.test(size)) size = 'XL';
    else if (/xx-?large|xxl/i.test(size)) size = 'XXL';
    else if (/small/i.test(size) && !/x/i.test(size)) size = 'S';
    else if (/medium/i.test(size)) size = 'M';
    else if (/large/i.test(size) && !/x/i.test(size)) size = 'L';
    extracted.size = size;
  }

  // Extract colors (if mentioned)
  const colorPatterns = [
    /\b(black|white|red|blue|green|yellow|pink|purple|gray|grey|brown|orange|navy|maroon|burgundy|cream|beige|tan|olive|khaki)\b/gi
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
    extracted.color = colors.slice(0, 2).join('/'); // Max 2 colors
  }

  // Extract materials (if mentioned)
  const materialMatch = lower.match(/\b(cotton|polyester|denim|leather|wool|silk|fleece|nylon|linen|cashmere)\b/i);
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
  } else if (/fair|worn/i.test(voiceDesc)) {
    extracted.condition = 'Fair';
  }

  // Extract era (if mentioned)
  const eraMatch = voiceDesc.match(/\b(vintage|retro|90s|80s|70s|60s|y2k|modern|contemporary)\b/i);
  if (eraMatch) {
    extracted.era = eraMatch[1].charAt(0).toUpperCase() + eraMatch[1].slice(1);
  }

  // Extract flaws (if mentioned)
  const flawPatterns = [
    /flaws?:\s*([^.]+)/i,
    /stains?:\s*([^.]+)/i,
    /holes?:\s*([^.]+)/i,
    /damage:\s*([^.]+)/i,
    /has\s+(?:a\s+)?(small|minor|slight)\s+(stain|hole|tear|mark|fade)/i
  ];
  for (const pattern of flawPatterns) {
    const match = voiceDesc.match(pattern);
    if (match) {
      extracted.flaws = match[1] || match[0];
      break;
    }
  }

  // Extract care instructions (if mentioned)
  if (/machine wash|hand wash|dry clean|wash cold|wash warm/i.test(voiceDesc)) {
    const careMatch = voiceDesc.match(/(?:care:?\s*)?([^.]*(?:machine wash|hand wash|dry clean|wash cold|wash warm)[^.]*)/i);
    if (careMatch) {
      extracted.care = careMatch[1].trim();
    }
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
    ? extractFieldsFromVoice(context.voiceDescription) 
    : {};
  
  // Merge extracted with provided context (provided takes precedence)
  const mergedContext = {
    ...context,
    // Only use extracted if field is empty
    brand: context.brand || extracted.brand,
    color: context.color || extracted.color,
    size: context.size || extracted.size,
    material: context.material || extracted.material,
    condition: context.condition || extracted.condition,
    era: context.era || extracted.era,
    flaws: context.flaws || extracted.flaws,
    care: context.care || extracted.care,
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
 * Build intro from product data - vintage streetwear style
 */
function buildIntro(context: ProductContext): string {
  const { brand, category, color, material, style, era } = context;
  
  const parts: string[] = [];
  
  // Add era/vintage first (lowercase for streetwear vibe)
  if (era) {
    parts.push(era.toLowerCase());
  }
  
  // Add style
  if (style) {
    parts.push(style.toLowerCase());
  }
  
  // Add brand (keep original case)
  if (brand) {
    parts.push(brand);
  }
  
  // Add color
  if (color) {
    parts.push(color.toLowerCase());
  }
  
  // Add category
  if (category) {
    parts.push(category.toLowerCase());
  }
  
  // Add material if mentioned
  if (material) {
    parts.push(material.toLowerCase());
  }
  
  return parts.join(' ');
}

/**
 * Build features description
 */
function buildFeatures(context: ProductContext): string {
  const features: string[] = [];
  
  if (context.material && !context.voiceDescription?.toLowerCase().includes(context.material.toLowerCase())) {
    features.push(`${context.material} construction`);
  }
  
  if (context.color && features.length === 0) {
    features.push(`${context.color} colorway`);
  }
  
  if (context.size) {
    features.push(`size ${context.size}`);
  }
  
  if (features.length === 0) return '';
  
  if (features.length === 1) {
    return `Features ${features[0]}.`;
  }
  
  const last = features.pop();
  return `Features ${features.join(', ')} and ${last}.`;
}

/**
 * Build era context with style
 */
function buildEraContext(era: string, style?: string): string {
  const eraLower = era.toLowerCase();
  
  if (eraLower.includes('vintage') || eraLower.includes('90s') || eraLower.includes('80s') || eraLower.includes('70s')) {
    return `This ${era} piece showcases authentic period styling${style ? ` with ${style} influences` : ''}.`;
  }
  
  if (eraLower.includes('modern') || eraLower.includes('contemporary')) {
    return `This ${era} piece features${style ? ` ${style}` : ''} contemporary design.`;
  }
  
  return `From the ${era} era${style ? ` with ${style} styling` : ''}.`;
}

/**
 * Build measurements text
 */
function buildMeasurements(measurements: Record<string, string>): string {
  const entries = Object.entries(measurements).filter(([_, value]) => value && value.trim() !== '');
  
  if (entries.length === 0) return '';
  if (entries.length === 1) {
    const [key, value] = entries[0];
    return `${key}: ${value}.`;
  }
  
  const measText = entries.map(([key, value]) => `${key} ${value}`).join(', ');
  return `Measurements: ${measText}.`;
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
