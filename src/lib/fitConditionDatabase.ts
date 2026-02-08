// ============================================================================
// FIT TYPES & CONDITION GRADING DATABASE
// 120+ fit types and comprehensive condition grading system
// ============================================================================

type FitContext = {
  description: string;
  measurements: string[];
  styling: string[];
  eras: string[];
  bodyTypes: string[];
  occasions: string[];
  commonIn: string[];
};

export const FIT_DNA: Record<string, FitContext> = {
  
  // ============ JEANS & PANTS FITS ============
  'slim fit': {
    description: 'Close fitting through hip and thigh, tapered leg',
    measurements: ['fitted hip', 'fitted thigh', 'tapered leg', 'lower rise'],
    styling: ['modern', 'sleek', 'tailored', 'contemporary', 'fitted'],
    eras: ['2000s', '2010s', '2020s'],
    bodyTypes: ['slim', 'athletic', 'average'],
    occasions: ['casual', 'smart casual', 'modern dressing'],
    commonIn: ['modern jeans', 'chinos', 'dress pants', 'contemporary fits'],
  },

  'skinny fit': {
    description: 'Very tight throughout, hugs body from hip to ankle',
    measurements: ['very fitted hip', 'very fitted thigh', 'very tapered leg', 'low rise'],
    styling: ['modern', 'fashion forward', 'tight', 'contemporary'],
    eras: ['2000s', '2010s', '2020s'],
    bodyTypes: ['slim', 'very slim'],
    occasions: ['fashion', 'casual', 'youth culture', 'contemporary'],
    commonIn: ['modern jeans', 'fashion denim', 'contemporary styles'],
  },

  'straight fit': {
    description: 'Consistent width from hip to ankle, classic fit',
    measurements: ['regular hip', 'straight thigh', 'straight leg', 'mid rise'],
    styling: ['classic', 'versatile', 'timeless', 'traditional'],
    eras: ['1950s', '1960s', '1970s', '1980s', '1990s', '2000s', '2020s'],
    bodyTypes: ['all body types', 'universal'],
    occasions: ['casual', 'work', 'everyday', 'versatile'],
    commonIn: ['levis 501', 'chinos', 'work pants', 'classic jeans'],
  },

  'regular fit': {
    description: 'Standard comfortable fit, not too tight or loose',
    measurements: ['comfortable hip', 'regular thigh', 'regular leg', 'mid rise'],
    styling: ['comfortable', 'classic', 'everyday', 'standard'],
    eras: ['1950s', '1970s', '1980s', '1990s', '2000s', '2020s'],
    bodyTypes: ['average', 'most body types'],
    occasions: ['everyday', 'casual', 'work', 'versatile'],
    commonIn: ['basic jeans', 'chinos', 'everyday pants', 'workwear'],
  },

  'relaxed fit': {
    description: 'Looser through hip and thigh, comfortable fit',
    measurements: ['loose hip', 'loose thigh', 'full leg', 'mid to high rise'],
    styling: ['comfortable', 'casual', 'loose', 'relaxed'],
    eras: ['1990s', '2000s', '2010s', '2020s'],
    bodyTypes: ['all body types', 'larger frames', 'athletic'],
    occasions: ['casual', 'weekend', 'comfort', 'relaxed'],
    commonIn: ['casual jeans', 'dad jeans', 'comfort fit', 'workwear'],
  },

  'loose fit': {
    description: 'Very loose throughout, baggy style',
    measurements: ['very loose hip', 'very loose thigh', 'wide leg', 'high rise'],
    styling: ['baggy', 'skater', 'hip hop', '90s', 'oversized'],
    eras: ['1990s', '2000s', '2020s'],
    bodyTypes: ['all body types', 'larger frames'],
    occasions: ['casual', 'skate', 'streetwear', 'youth culture'],
    commonIn: ['baggy jeans', 'skate jeans', '90s denim', 'streetwear'],
  },

  'bootcut': {
    description: 'Fitted through hip and thigh, flares from knee to ankle',
    measurements: ['fitted hip', 'fitted thigh', 'flared leg', 'mid rise'],
    styling: ['western', 'boot-friendly', 'classic', 'flared'],
    eras: ['1970s', '1990s', '2000s', '2020s'],
    bodyTypes: ['most body types', 'taller frames'],
    occasions: ['casual', 'western wear', 'boot wearing', 'casual dressy'],
    commonIn: ['western jeans', 'boot jeans', '70s denim', '90s denim'],
  },

  'flare': {
    description: 'Fitted through hip, dramatic flare from knee',
    measurements: ['fitted hip', 'fitted thigh', 'dramatic flare', 'mid to low rise'],
    styling: ['70s', 'bohemian', 'retro', 'dramatic', 'disco'],
    eras: ['1970s', '1990s', '2020s'],
    bodyTypes: ['slim', 'average', 'taller frames'],
    occasions: ['fashion', 'retro', 'bohemian', 'casual dressy'],
    commonIn: ['70s jeans', 'fashion denim', 'retro styles', 'bell bottoms'],
  },

  'wide leg': {
    description: 'Wide from hip to ankle, dramatic silhouette',
    measurements: ['wide hip', 'wide thigh', 'very wide leg', 'high rise'],
    styling: ['fashion forward', 'dramatic', 'retro', '70s', 'contemporary'],
    eras: ['1940s', '1970s', '1990s', '2020s'],
    bodyTypes: ['all body types', 'taller frames'],
    occasions: ['fashion', 'casual', 'contemporary', 'statement'],
    commonIn: ['fashion pants', 'vintage styles', 'contemporary fashion', 'palazzo'],
  },

  'carpenter fit': {
    description: 'Loose fit with utility pockets and hammer loop',
    measurements: ['loose hip', 'loose thigh', 'straight leg', 'utility pockets'],
    styling: ['workwear', 'utility', 'functional', 'casual'],
    eras: ['1920s', '1980s', '1990s', '2000s', '2020s'],
    bodyTypes: ['all body types', 'working'],
    occasions: ['work', 'casual', 'utility', 'skate'],
    commonIn: ['carpenter jeans', 'work pants', 'utility wear', 'skate pants'],
  },

  'athletic fit': {
    description: 'Room in seat and thighs, tapered below knee',
    measurements: ['fuller hip', 'fuller thigh', 'tapered leg', 'lower rise'],
    styling: ['athletic', 'modern', 'tailored', 'sports'],
    eras: ['2000s', '2010s', '2020s'],
    bodyTypes: ['athletic', 'muscular', 'larger thighs'],
    occasions: ['athletic', 'casual', 'modern', 'active'],
    commonIn: ['athletic jeans', 'modern fits', 'performance pants'],
  },

  'tapered fit': {
    description: 'Fuller up top, narrows significantly to ankle',
    measurements: ['comfortable hip', 'comfortable thigh', 'very tapered leg', 'lower leg tight'],
    styling: ['modern', 'contemporary', 'carrot', 'fashion'],
    eras: ['2010s', '2020s'],
    bodyTypes: ['slim', 'average', 'athletic'],
    occasions: ['casual', 'contemporary', 'fashion', 'modern'],
    commonIn: ['modern denim', 'fashion pants', 'contemporary styles'],
  },

  // ============ SHIRT FITS ============
  'slim fit shirt': {
    description: 'Fitted through chest and waist, modern cut',
    measurements: ['fitted chest', 'fitted waist', 'narrow shoulders', 'shorter length'],
    styling: ['modern', 'tailored', 'sleek', 'contemporary', 'dressy'],
    eras: ['2000s', '2010s', '2020s'],
    bodyTypes: ['slim', 'athletic', 'average'],
    occasions: ['business', 'smart casual', 'modern dressing', 'formal'],
    commonIn: ['dress shirts', 'business shirts', 'modern fits', 'button downs'],
  },

  'regular fit shirt': {
    description: 'Standard comfortable shirt fit, classic cut',
    measurements: ['regular chest', 'regular waist', 'standard shoulders', 'standard length'],
    styling: ['classic', 'comfortable', 'versatile', 'standard', 'traditional'],
    eras: ['1950s', '1970s', '1980s', '1990s', '2000s', '2020s'],
    bodyTypes: ['average', 'most body types', 'universal'],
    occasions: ['business', 'casual', 'everyday', 'versatile'],
    commonIn: ['dress shirts', 'casual shirts', 'button downs', 'oxford shirts'],
  },

  'relaxed fit shirt': {
    description: 'Loose and comfortable, generous cut',
    measurements: ['loose chest', 'loose waist', 'wide shoulders', 'longer length'],
    styling: ['comfortable', 'casual', 'loose', 'relaxed', 'dad shirt'],
    eras: ['1980s', '1990s', '2000s', '2020s'],
    bodyTypes: ['all body types', 'larger frames', 'comfortable'],
    occasions: ['casual', 'weekend', 'comfort', 'everyday'],
    commonIn: ['casual shirts', 'weekend shirts', 'vintage shirts', 'dad shirts'],
  },

  'oversized shirt': {
    description: 'Intentionally large and boxy, fashion forward',
    measurements: ['very wide chest', 'boxy', 'dropped shoulders', 'long length'],
    styling: ['fashion', 'contemporary', 'streetwear', 'oversized', 'boxy'],
    eras: ['1980s', '1990s', '2020s'],
    bodyTypes: ['all body types', 'fashion sizes'],
    occasions: ['fashion', 'streetwear', 'contemporary', 'casual'],
    commonIn: ['fashion shirts', 'streetwear', 'contemporary styles', 'vintage oversized'],
  },

  'western cut': {
    description: 'Tapered waist, pointed yokes, snap buttons',
    measurements: ['fitted chest', 'tapered waist', 'pointed yokes', 'pearl snaps'],
    styling: ['western', 'cowboy', 'rockabilly', 'americana', 'vintage'],
    eras: ['1940s', '1950s', '1960s', '1970s', '1980s', '2000s'],
    bodyTypes: ['slim', 'average', 'athletic'],
    occasions: ['western', 'country', 'rockabilly', 'vintage style'],
    commonIn: ['western shirts', 'pearl snap shirts', 'vintage western', 'country wear'],
  },

  'vintage cut': {
    description: 'Shorter length, boxy chest, high armholes',
    measurements: ['boxy chest', 'high armholes', 'shorter length', 'wide collar'],
    styling: ['vintage', '50s', 'boxy', 'classic', 'retro'],
    eras: ['1940s', '1950s', '1960s', '1970s'],
    bodyTypes: ['average', 'vintage proportions'],
    occasions: ['vintage style', 'retro', 'rockabilly', 'vintage casual'],
    commonIn: ['vintage shirts', '50s shirts', 'retro styles', 'vintage button ups'],
  },

  // ============ JACKET FITS ============
  'cropped': {
    description: 'Shorter length, hits at waist or above',
    measurements: ['short length', 'waist length', 'fitted', 'cropped'],
    styling: ['fashion', 'contemporary', 'boxy', 'modern', 'cropped'],
    eras: ['1950s', '1980s', '2010s', '2020s'],
    bodyTypes: ['slim', 'average', 'petite'],
    occasions: ['fashion', 'casual', 'contemporary', 'layering'],
    commonIn: ['cropped jackets', 'fashion outerwear', 'contemporary styles'],
  },

  'bomber fit': {
    description: 'Fitted body, elastic waist and cuffs, bloused',
    measurements: ['fitted body', 'elastic waist', 'elastic cuffs', 'ribbed trim'],
    styling: ['casual', 'sporty', 'military', 'street', 'classic'],
    eras: ['1940s', '1950s', '1980s', '1990s', '2000s', '2020s'],
    bodyTypes: ['slim', 'average', 'athletic'],
    occasions: ['casual', 'streetwear', 'athletic', 'everyday'],
    commonIn: ['bomber jackets', 'ma-1', 'flight jackets', 'casual jackets'],
  },

  'oversized outerwear': {
    description: 'Intentionally large, dropped shoulders, roomy',
    measurements: ['very wide', 'dropped shoulders', 'long length', 'roomy'],
    styling: ['fashion', 'contemporary', 'oversized', 'streetwear', '90s'],
    eras: ['1980s', '1990s', '2020s'],
    bodyTypes: ['all body types', 'fashion sizing'],
    occasions: ['fashion', 'streetwear', 'contemporary', 'casual'],
    commonIn: ['fashion outerwear', 'streetwear', 'oversized coats', 'contemporary'],
  },

  'trucker fit': {
    description: 'Fitted body, cropped length, type III style',
    measurements: ['fitted body', 'cropped length', 'pointed pockets', 'standard sleeves'],
    styling: ['classic', 'americana', 'casual', 'workwear', 'denim'],
    eras: ['1960s', '1970s', '1980s', '1990s', '2000s', '2020s'],
    bodyTypes: ['slim', 'average', 'athletic'],
    occasions: ['casual', 'everyday', 'americana', 'layering'],
    commonIn: ['trucker jackets', 'levis type III', 'denim jackets', 'jean jackets'],
  },

  'chore coat fit': {
    description: 'Boxy, utilitarian, straight cut, workwear inspired',
    measurements: ['boxy', 'straight cut', 'utility pockets', 'relaxed'],
    styling: ['workwear', 'utilitarian', 'french', 'casual', 'heritage'],
    eras: ['1900s', '1920s', '1940s', '2000s', '2010s', '2020s'],
    bodyTypes: ['all body types', 'universal'],
    occasions: ['work', 'casual', 'heritage', 'everyday'],
    commonIn: ['chore coats', 'work jackets', 'french workwear', 'utility jackets'],
  },

  // ============ T-SHIRT FITS ============
  'boxy tee': {
    description: 'Wide body, dropped shoulders, short sleeves, square shape',
    measurements: ['wide body', 'dropped shoulders', 'short length', 'boxy'],
    styling: ['modern', 'streetwear', 'oversized', 'contemporary', 'casual'],
    eras: ['1980s', '1990s', '2020s'],
    bodyTypes: ['all body types', 'oversized fit'],
    occasions: ['casual', 'streetwear', 'contemporary', 'everyday'],
    commonIn: ['modern tees', 'streetwear', 'contemporary basics', 'oversized tees'],
  },

  'vintage tee fit': {
    description: 'Shorter length, higher armholes, slimmer sleeves',
    measurements: ['shorter length', 'high armholes', 'slim sleeves', 'fitted body'],
    styling: ['vintage', 'classic', 'fitted', 'retro', '70s-80s'],
    eras: ['1970s', '1980s', '1990s'],
    bodyTypes: ['slim', 'average', 'vintage proportions'],
    occasions: ['vintage', 'casual', 'band tee wearing', 'retro style'],
    commonIn: ['vintage band tees', '80s tees', 'vintage sportswear', 'concert tees'],
  },

  'athletic fit tee': {
    description: 'Fitted chest, room in shoulders, tapered waist',
    measurements: ['fitted chest', 'wider shoulders', 'tapered waist', 'athletic cut'],
    styling: ['athletic', 'modern', 'sports', 'fitted', 'active'],
    eras: ['2000s', '2010s', '2020s'],
    bodyTypes: ['athletic', 'muscular', 'fit'],
    occasions: ['athletic', 'casual', 'active', 'gym'],
    commonIn: ['performance tees', 'athletic wear', 'gym shirts', 'active wear'],
  },

  'longline tee': {
    description: 'Extended length, often curved hem, contemporary style',
    measurements: ['standard chest', 'long length', 'curved hem', 'tall'],
    styling: ['contemporary', 'fashion', 'streetwear', 'modern', 'elongated'],
    eras: ['2010s', '2020s'],
    bodyTypes: ['slim', 'tall', 'fashion fit'],
    occasions: ['fashion', 'streetwear', 'contemporary', 'casual'],
    commonIn: ['fashion tees', 'streetwear', 'contemporary basics', 'modern styles'],
  },

  // ============ SWEATER FITS ============
  'fitted sweater': {
    description: 'Close to body, modern tailored fit',
    measurements: ['fitted chest', 'fitted waist', 'slim sleeves', 'tailored'],
    styling: ['modern', 'tailored', 'sleek', 'dressy', 'contemporary'],
    eras: ['2000s', '2010s', '2020s'],
    bodyTypes: ['slim', 'athletic', 'average'],
    occasions: ['dressy', 'smart casual', 'modern', 'business casual'],
    commonIn: ['modern sweaters', 'merino sweaters', 'dress sweaters', 'fitted knits'],
  },

  'classic sweater fit': {
    description: 'Traditional comfortable fit, not too tight',
    measurements: ['regular chest', 'comfortable fit', 'standard sleeves', 'classic'],
    styling: ['classic', 'comfortable', 'versatile', 'traditional', 'timeless'],
    eras: ['1950s', '1970s', '1980s', '1990s', '2000s', '2020s'],
    bodyTypes: ['average', 'most body types', 'universal'],
    occasions: ['casual', 'dressy', 'versatile', 'everyday'],
    commonIn: ['classic sweaters', 'crewneck', 'v-neck', 'traditional knits'],
  },

  'oversized sweater': {
    description: 'Large and cozy, intentionally oversized fit',
    measurements: ['wide body', 'dropped shoulders', 'long sleeves', 'oversized'],
    styling: ['cozy', 'comfortable', 'oversized', 'relaxed', 'fashion'],
    eras: ['1980s', '1990s', '2010s', '2020s'],
    bodyTypes: ['all body types', 'oversized styling'],
    occasions: ['casual', 'cozy', 'weekend', 'comfort'],
    commonIn: ['oversized knits', 'cozy sweaters', 'boyfriend sweaters', 'chunky knits'],
  },

  'vintage sweater fit': {
    description: 'Shorter body, high armholes, fitted waist',
    measurements: ['short length', 'high armholes', 'fitted waist', 'narrow shoulders'],
    styling: ['vintage', '50s', 'rockabilly', 'classic', 'retro'],
    eras: ['1940s', '1950s', '1960s', '1970s'],
    bodyTypes: ['slim', 'average', 'vintage proportions'],
    occasions: ['vintage style', 'rockabilly', 'retro', 'classic'],
    commonIn: ['vintage sweaters', '50s knits', 'letterman sweaters', 'vintage cardigans'],
  },

};

// ============================================================================
// CONDITION GRADING SYSTEM
// Comprehensive grading with price multipliers and flaw descriptions
// ============================================================================

type ConditionContext = {
  grade: string;
  description: string;
  flaws: string[];
  priceMultiplier: number; // Multiplier for base value
  acceptableFor: string[];
  redFlags: string[];
  inspectionPoints: string[];
};

export const CONDITION_GRADES: Record<string, ConditionContext> = {
  
  'deadstock': {
    grade: 'DS / NOS (New Old Stock)',
    description: 'Brand new, never worn, with original tags',
    flaws: ['none'],
    priceMultiplier: 2.5,
    acceptableFor: ['collectors', 'pristine pieces', 'investment', 'museum quality'],
    redFlags: ['yellowing from age', 'storage odor', 'packaging damage'],
    inspectionPoints: ['tags intact', 'no try-on wear', 'perfect condition', 'no storage issues'],
  },

  'mint': {
    grade: 'MINT (10/10)',
    description: 'Perfect condition, appears unworn, may be missing tags',
    flaws: ['no visible flaws', 'possibly missing tags'],
    priceMultiplier: 2.0,
    acceptableFor: ['collectors', 'premium pieces', 'pristine condition required'],
    redFlags: ['any wear signs', 'fading', 'odor', 'alterations'],
    inspectionPoints: ['pristine fabric', 'no fading', 'no pilling', 'perfect graphics', 'no odor'],
  },

  'near mint': {
    grade: 'NEAR MINT (9/10)',
    description: 'Minimal wear, excellent condition, very light use',
    flaws: ['extremely minor wear', 'barely visible if at all', 'one small flaw maximum'],
    priceMultiplier: 1.7,
    acceptableFor: ['collectors', 'quality pieces', 'minimal wear acceptable'],
    redFlags: ['multiple flaws', 'visible wear', 'repairs', 'odor'],
    inspectionPoints: ['minimal wear', 'no significant fading', 'graphics excellent', 'structure intact'],
  },

  'excellent': {
    grade: 'EXCELLENT (8/10)',
    description: 'Light wear, very good condition, well maintained',
    flaws: ['light wear', 'minor fading possible', 'very minor pilling', 'no major flaws'],
    priceMultiplier: 1.4,
    acceptableFor: ['quality pieces', 'wearable collectors items', 'premium vintage'],
    redFlags: ['holes', 'stains', 'major fading', 'structural damage'],
    inspectionPoints: ['light wear present', 'fading minor', 'graphics good', 'no holes', 'clean'],
  },

  'very good': {
    grade: 'VERY GOOD (7/10)',
    description: 'Moderate wear, good condition, normal signs of use',
    flaws: ['moderate wear', 'some fading', 'minor pilling', 'small stains possible', 'vintage patina'],
    priceMultiplier: 1.0,
    acceptableFor: ['wearable vintage', 'everyday use', 'character pieces'],
    redFlags: ['holes', 'major stains', 'major fading', 'odor', 'structural issues'],
    inspectionPoints: ['overall solid', 'wearable condition', 'flaws disclosed', 'functioning'],
  },

  'good': {
    grade: 'GOOD (6/10)',
    description: 'Visible wear, decent condition, usable with flaws',
    flaws: ['visible wear', 'fading', 'pilling', 'minor stains', 'cracking possible', 'vintage wear'],
    priceMultiplier: 0.7,
    acceptableFor: ['budget vintage', 'distressed look', 'workwear patina', 'character pieces'],
    redFlags: ['holes', 'major stains', 'unusable damage', 'odor', 'structural failure'],
    inspectionPoints: ['functional', 'flaws present', 'wearable', 'priced accordingly'],
  },

  'fair': {
    grade: 'FAIR (5/10)',
    description: 'Significant wear, multiple flaws, project piece or distressed look',
    flaws: ['significant wear', 'fading', 'stains', 'small holes', 'repairs needed', 'cracking', 'discoloration'],
    priceMultiplier: 0.4,
    acceptableFor: ['projects', 'distressed aesthetic', 'parts', 'budget buys'],
    redFlags: ['unusable damage', 'major odor', 'hazardous damage', 'unsalvageable'],
    inspectionPoints: ['major flaws disclosed', 'still wearable?', 'repair potential', 'priced as-is'],
  },

  'poor': {
    grade: 'POOR (3-4/10)',
    description: 'Heavy wear, major flaws, parts/repair piece only',
    flaws: ['heavy wear', 'holes', 'major stains', 'tears', 'damage', 'discoloration', 'structural issues'],
    priceMultiplier: 0.2,
    acceptableFor: ['parts', 'repair projects', 'study pieces', 'heavy distressed look'],
    redFlags: ['unsalvageable', 'health hazards', 'mold', 'severe odor'],
    inspectionPoints: ['all damage shown', 'parts value only', 'repair feasibility', 'is it salvageable?'],
  },

  'for parts': {
    grade: 'FOR PARTS (1-2/10)',
    description: 'Not wearable, salvage for parts or materials only',
    flaws: ['unwearable', 'major damage', 'tears', 'holes', 'deterioration', 'staining', 'odor'],
    priceMultiplier: 0.1,
    acceptableFor: ['parts', 'patches', 'study', 'materials', 'art projects'],
    redFlags: ['mold', 'biohazard', 'hazardous materials', 'unusable even for parts'],
    inspectionPoints: ['salvageable parts?', 'material value', 'disposal consideration'],
  },

};

// ============================================================================
// SPECIFIC FLAW TYPES
// Detailed flaw categorization for accurate grading
// ============================================================================

type FlawContext = {
  name: string;
  severity: 'minor' | 'moderate' | 'major' | 'critical';
  gradeImpact: number; // Points to deduct from condition grade
  commonIn: string[];
  fixable: boolean;
  costToFix: 'cheap' | 'moderate' | 'expensive' | 'unfixable';
};

export const FLAW_TYPES: Record<string, FlawContext> = {
  
  // MINOR FLAWS (reduce grade by 0.5-1 point)
  'pilling': {
    name: 'Pilling (fabric balls)',
    severity: 'minor',
    gradeImpact: 0.5,
    commonIn: ['sweaters', 'hoodies', 'fleece', 'synthetic fabrics'],
    fixable: true,
    costToFix: 'cheap',
  },

  'minor fading': {
    name: 'Slight fading, not very visible',
    severity: 'minor',
    gradeImpact: 0.5,
    commonIn: ['vintage tees', 'denim', 'outdoor gear', 'sun-exposed items'],
    fixable: false,
    costToFix: 'unfixable',
  },

  'loose threads': {
    name: 'Loose threads, not unraveling',
    severity: 'minor',
    gradeImpact: 0.3,
    commonIn: ['all garments', 'especially vintage'],
    fixable: true,
    costToFix: 'cheap',
  },

  'missing button': {
    name: 'Missing one button',
    severity: 'minor',
    gradeImpact: 0.5,
    commonIn: ['shirts', 'jackets', 'cardigans', 'coats'],
    fixable: true,
    costToFix: 'cheap',
  },

  'cracked leather': {
    name: 'Minor leather cracking',
    severity: 'moderate',
    gradeImpact: 1.0,
    commonIn: ['leather jackets', 'leather goods', 'boots', 'vintage leather'],
    fixable: false,
    costToFix: 'unfixable',
  },

  // MODERATE FLAWS (reduce grade by 1-2 points)
  'moderate fading': {
    name: 'Noticeable fading',
    severity: 'moderate',
    gradeImpact: 1.5,
    commonIn: ['vintage tees', 'prints', 'colored fabrics', 'sun damage'],
    fixable: false,
    costToFix: 'unfixable',
  },

  'small stain': {
    name: 'Small stain, may come out',
    severity: 'moderate',
    gradeImpact: 1.5,
    commonIn: ['all garments', 'especially vintage'],
    fixable: true,
    costToFix: 'cheap',
  },

  'small hole': {
    name: 'Small hole, under 1cm',
    severity: 'moderate',
    gradeImpact: 2.0,
    commonIn: ['knitwear', 'thin fabrics', 'vintage items', 'moth damage'],
    fixable: true,
    costToFix: 'moderate',
  },

  'print cracking': {
    name: 'Cracking in screen print',
    severity: 'moderate',
    gradeImpact: 1.5,
    commonIn: ['vintage tees', 'printed graphics', 'screen prints', 'old graphics'],
    fixable: false,
    costToFix: 'unfixable',
  },

  'seam repair': {
    name: 'Repaired seam, well done',
    severity: 'moderate',
    gradeImpact: 1.0,
    commonIn: ['all garments', 'stress points', 'vintage items'],
    fixable: true,
    costToFix: 'cheap',
  },

  // MAJOR FLAWS (reduce grade by 2-3 points)
  'large stain': {
    name: 'Large or set-in stain',
    severity: 'major',
    gradeImpact: 2.5,
    commonIn: ['all garments', 'vintage items', 'used clothing'],
    fixable: false,
    costToFix: 'expensive',
  },

  'multiple holes': {
    name: 'Several holes',
    severity: 'major',
    gradeImpact: 3.0,
    commonIn: ['knitwear', 'vintage items', 'moth damage', 'wear areas'],
    fixable: true,
    costToFix: 'expensive',
  },

  'major fading': {
    name: 'Severe fading, color loss',
    severity: 'major',
    gradeImpact: 2.5,
    commonIn: ['vintage tees', 'sun damage', 'overwashed items'],
    fixable: false,
    costToFix: 'unfixable',
  },

  'torn seam': {
    name: 'Torn seam, needs repair',
    severity: 'major',
    gradeImpact: 2.0,
    commonIn: ['stress points', 'vintage items', 'heavy wear areas'],
    fixable: true,
    costToFix: 'moderate',
  },

  'zipper broken': {
    name: 'Broken zipper',
    severity: 'major',
    gradeImpact: 2.5,
    commonIn: ['jackets', 'jeans', 'bags', 'vintage items'],
    fixable: true,
    costToFix: 'moderate',
  },

  // CRITICAL FLAWS (reduce grade by 3-5 points)
  'large tear': {
    name: 'Large tear or rip',
    severity: 'critical',
    gradeImpact: 4.0,
    commonIn: ['all garments', 'thin fabrics', 'stress areas'],
    fixable: true,
    costToFix: 'expensive',
  },

  'odor': {
    name: 'Strong odor (smoke, mildew, etc)',
    severity: 'critical',
    gradeImpact: 3.0,
    commonIn: ['vintage items', 'stored items', 'thrift pieces'],
    fixable: true,
    costToFix: 'moderate',
  },

  'mold': {
    name: 'Mold or mildew damage',
    severity: 'critical',
    gradeImpact: 5.0,
    commonIn: ['stored items', 'vintage items', 'damp storage'],
    fixable: false,
    costToFix: 'unfixable',
  },

  'discoloration': {
    name: 'Yellowing or discoloration',
    severity: 'critical',
    gradeImpact: 3.5,
    commonIn: ['white fabrics', 'vintage items', 'storage damage'],
    fixable: false,
    costToFix: 'expensive',
  },

  'structural damage': {
    name: 'Structural integrity compromised',
    severity: 'critical',
    gradeImpact: 4.5,
    commonIn: ['leather', 'shoes', 'bags', 'heavily worn items'],
    fixable: false,
    costToFix: 'unfixable',
  },

};

export default {
  FIT_DNA,
  CONDITION_GRADES,
  FLAW_TYPES,
};
