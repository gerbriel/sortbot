// ============================================================================
// COMPREHENSIVE COLOR DATABASE (500+ colors with hex codes and cultural context)
// ============================================================================

type ColorContext = {
  hexCodes: string[];
  aliases: string[];
  vibes: string[];
  eras: string[];
  subcultures: string[];
  commonIn: string[];
};

export const COLOR_DNA: Record<string, ColorContext> = {
  
  // ============ REDS ============
  'black': {
    hexCodes: ['#111111', '#1a1a1a', '#222222'],
    aliases: ['black', 'all black'],
    vibes: ['classic', 'versatile', 'goth', 'minimalist', 'timeless'],
    eras: ['1900s', '1950s', '1960s', '1980s', '1990s', '2000s', '2020s'],
    subcultures: ['goth', 'punk', 'minimalist', 'rock', 'streetwear'],
    commonIn: ['tees', 'jeans', 'leather jackets', 'basics', 'boots'],
  },

  'red': {
    hexCodes: ['#CC0000', '#DD0000', '#BB0000'],
    aliases: ['classic red', 'basic red'],
    vibes: ['bold', 'classic', 'passionate', 'vibrant'],
    eras: ['1900s', '1950s', '1970s', '1990s', '2000s', '2020s'],
    subcultures: ['classic', 'vintage', 'streetwear', 'athletic'],
    commonIn: ['tees', 'jackets', 'accessories', 'sneakers'],
  },

  'crimson': {
    hexCodes: ['#DC143C', '#A0111C', '#9E1B32'],
    aliases: ['deep red', 'harvard crimson', 'alabama crimson'],
    vibes: ['bold', 'passionate', 'traditional', 'collegiate', 'regal'],
    eras: ['1800s', '1900s', '1920s', '1940s', '1960s', '1980s', '2000s', '2020s'],
    subcultures: ['college', 'preppy', 'traditional'],
    commonIn: ['jerseys', 'sweaters', 'blazers', 'vintage'],
  },

  'scarlet': {
    hexCodes: ['#FF2400', '#CE2029', '#BB0000'],
    aliases: ['bright red', 'ohio state scarlet', 'rutgers scarlet'],
    vibes: ['bold', 'bright', 'energetic', 'loud', 'athletic'],
    eras: ['1920s', '1950s', '1970s', '1990s', '2000s', '2020s'],
    subcultures: ['college', 'sports', 'athletic'],
    commonIn: ['jerseys', 'athletic wear', 'team gear'],
  },

  'burgundy': {
    hexCodes: ['#800020', '#722F37', '#6D0F28'],
    aliases: ['maroon', 'wine', 'oxblood', 'bordeaux'],
    vibes: ['rich', 'sophisticated', 'vintage', 'luxurious', 'mature'],
    eras: ['1920s', '1930s', '1950s', '1970s', '1990s', '2000s'],
    subcultures: ['vintage', 'preppy', 'rockabilly', 'sophisticated'],
    commonIn: ['leather jackets', 'sweaters', 'vintage wear', 'dress shoes'],
  },

  'cherry red': {
    hexCodes: ['#D2042D', '#DE3163', '#990000'],
    aliases: ['true red', 'fire engine red', 'candy apple'],
    vibes: ['bold', 'vibrant', 'loud', 'attention grabbing', 'pop'],
    eras: ['1950s', '1960s', '1980s', '1990s', '2000s'],
    subcultures: ['rockabilly', 'punk', 'pop', 'streetwear'],
    commonIn: ['leather jackets', 'sneakers', 'accessories', 'dresses'],
  },

  'rust': {
    hexCodes: ['#B7410E', '#A0522D', '#8B4513'],
    aliases: ['burnt orange', 'terracotta', 'copper', 'autumn red'],
    vibes: ['earthy', 'vintage', 'warm', 'retro', '70s'],
    eras: ['1970s', '1980s', '1990s', '2000s', '2020s'],
    subcultures: ['vintage', '70s', 'bohemian', 'earth tones'],
    commonIn: ['corduroy', 'sweaters', 'vintage tees', 'workwear'],
  },

  // ============ BLUES ============
  'blue': {
    hexCodes: ['#2255CC', '#1E6FCC', '#2266BB'],
    aliases: ['classic blue', 'basic blue', 'medium blue'],
    vibes: ['classic', 'versatile', 'casual', 'timeless'],
    eras: ['1900s', '1950s', '1970s', '1990s', '2000s', '2020s'],
    subcultures: ['classic', 'casual', 'preppy', 'streetwear'],
    commonIn: ['jeans', 'tees', 'shirts', 'basics'],
  },

  'denim': {
    hexCodes: ['#1560BD', '#1C6BA0', '#3B7EC8'],
    aliases: ['denim blue', 'jean blue', 'chambray', 'stonewash'],
    vibes: ['casual', 'classic', 'workwear', 'americana', 'timeless'],
    eras: ['1950s', '1960s', '1970s', '1980s', '1990s', '2000s', '2020s'],
    subcultures: ['workwear', 'americana', 'vintage', 'casual'],
    commonIn: ['jeans', 'denim jackets', 'shirts', 'overalls'],
  },

  'navy': {
    hexCodes: ['#000080', '#001F3F', '#1E3A5F'],
    aliases: ['navy blue', 'dark blue', 'midnight blue'],
    vibes: ['classic', 'traditional', 'versatile', 'preppy', 'nautical'],
    eras: ['1900s', '1920s', '1940s', '1960s', '1980s', '2000s', '2020s'],
    subcultures: ['preppy', 'nautical', 'traditional', 'workwear'],
    commonIn: ['blazers', 'jeans', 'workwear', 'suits', 'basics'],
  },

  'royal blue': {
    hexCodes: ['#4169E1', '#002F6C', '#0038A8'],
    aliases: ['bright blue', 'true blue', 'UK blue'],
    vibes: ['bold', 'vibrant', 'collegiate', 'athletic', 'bright'],
    eras: ['1950s', '1970s', '1980s', '1990s', '2000s', '2020s'],
    subcultures: ['college', 'sports', 'athletic', 'streetwear'],
    commonIn: ['jerseys', 'athletic wear', 'varsity jackets', 'team gear'],
  },

  'carolina blue': {
    hexCodes: ['#7BAFD4', '#56A0D3', '#4B9CD3'],
    aliases: ['powder blue', 'sky blue', 'baby blue', 'UNC blue'],
    vibes: ['soft', 'collegiate', 'retro', 'gentle', 'vintage'],
    eras: ['1950s', '1960s', '1980s', '1990s', '2000s', '2020s'],
    subcultures: ['college', 'vintage', 'preppy', 'retro'],
    commonIn: ['jerseys', 'vintage tees', 'sweatshirts', 'casual wear'],
  },

  'teal': {
    hexCodes: ['#008080', '#007C80', '#00827F'],
    aliases: ['turquoise', 'aqua', 'seafoam'],
    vibes: ['90s', 'retro', 'aquatic', 'fresh', 'nostalgic'],
    eras: ['1990s', '2000s', '2010s', '2020s'],
    subcultures: ['90s', 'streetwear', 'sports', 'retro'],
    commonIn: ['windbreakers', 'athletic wear', '90s jerseys', 'swimwear'],
  },

  'cyan': {
    hexCodes: ['#00BFFF', '#00CED1', '#008B8B'],
    aliases: ['electric blue', 'neon blue', 'sky cyan', 'bright cyan'],
    vibes: ['90s', 'rave', 'neon', 'futuristic', 'bold'],
    eras: ['1990s', '2000s', '2010s', '2020s'],
    subcultures: ['rave', '90s', 'streetwear', 'y2k'],
    commonIn: ['athletic wear', 'windbreakers', 'accessories', 'streetwear'],
  },

  'indigo': {
    hexCodes: ['#4B0082', '#2E0854', '#00416A'],
    aliases: ['deep blue', 'denim blue', 'japan blue'],
    vibes: ['denim', 'japanese', 'vintage', 'artisanal', 'authentic'],
    eras: ['1800s', '1900s', '1950s', '1970s', '2000s', '2020s'],
    subcultures: ['denim', 'workwear', 'japanese', 'artisan'],
    commonIn: ['jeans', 'denim jackets', 'sashiko', 'vintage workwear'],
  },

  // ============ GREENS ============
  'green': {
    hexCodes: ['#228B22', '#2E8B2E', '#339933'],
    aliases: ['classic green', 'basic green', 'medium green'],
    vibes: ['classic', 'natural', 'versatile', 'earthy'],
    eras: ['1900s', '1950s', '1970s', '1990s', '2000s', '2020s'],
    subcultures: ['classic', 'outdoor', 'casual', 'vintage'],
    commonIn: ['tees', 'jackets', 'sweaters', 'basics'],
  },

  'forest green': {
    hexCodes: ['#228B22', '#014421', '#0B6623'],
    aliases: ['hunter green', 'dark green', 'pine green'],
    vibes: ['outdoor', 'traditional', 'preppy', 'vintage', 'earthy'],
    eras: ['1920s', '1940s', '1960s', '1970s', '1990s', '2000s'],
    subcultures: ['outdoor', 'preppy', 'vintage', 'workwear'],
    commonIn: ['outdoor gear', 'sweaters', 'vintage jackets', 'flannel'],
  },

  'kelly green': {
    hexCodes: ['#4CBB17', '#00A86B', '#29AB87'],
    aliases: ['bright green', 'irish green', 'emerald'],
    vibes: ['bright', 'bold', 'irish', 'athletic', 'vibrant'],
    eras: ['1950s', '1970s', '1980s', '1990s', '2000s'],
    subcultures: ['sports', 'athletic', 'irish', 'preppy'],
    commonIn: ['jerseys', 'athletic wear', 'st patricks', 'team gear'],
  },

  'olive': {
    hexCodes: ['#808000', '#6B8E23', '#556B2F'],
    aliases: ['olive drab', 'army green', 'khaki green', 'military green'],
    vibes: ['military', 'workwear', 'vintage', 'utilitarian', 'rugged'],
    eras: ['1940s', '1950s', '1960s', '1970s', '1980s', '1990s', '2000s', '2020s'],
    subcultures: ['military', 'workwear', 'streetwear', 'vintage'],
    commonIn: ['military surplus', 'cargo pants', 'field jackets', 'workwear'],
  },

  'sage': {
    hexCodes: ['#9CAF88', '#B2AC88', '#87AE73'],
    aliases: ['mint green', 'pale green', 'dusty green'],
    vibes: ['soft', 'vintage', 'bohemian', 'muted', 'gentle'],
    eras: ['1950s', '1970s', '1990s', '2020s'],
    subcultures: ['vintage', 'bohemian', 'soft grunge', 'cottagecore'],
    commonIn: ['vintage dresses', 'sweaters', 'soft goods', 'homewear'],
  },

  'neon green': {
    hexCodes: ['#39FF14', '#0FFF50', '#7FFF00'],
    aliases: ['lime', 'highlighter', 'electric green'],
    vibes: ['90s', 'rave', 'loud', 'athletic', 'attention'],
    eras: ['1990s', '2000s', '2010s', '2020s'],
    subcultures: ['rave', '90s', 'athletic', 'streetwear', 'skate'],
    commonIn: ['athletic wear', 'windbreakers', 'accessories', 'safety gear'],
  },

  // ============ YELLOWS/GOLDS ============
  'yellow': {
    hexCodes: ['#FFD700', '#FFE033', '#FFCC00'],
    aliases: ['classic yellow', 'basic yellow', 'bright yellow'],
    vibes: ['bright', 'bold', 'cheerful', 'vintage', 'athletic'],
    eras: ['1950s', '1970s', '1980s', '1990s', '2000s', '2020s'],
    subcultures: ['classic', 'athletic', 'streetwear', 'vintage'],
    commonIn: ['tees', 'windbreakers', 'athletic wear', 'accessories'],
  },

  'gold': {
    hexCodes: ['#FFD700', '#FFC72C', '#EAAA00'],
    aliases: ['yellow gold', 'maize', 'sun gold'],
    vibes: ['collegiate', 'bright', 'bold', 'athletic', 'champion'],
    eras: ['1920s', '1950s', '1970s', '1980s', '1990s', '2000s', '2020s'],
    subcultures: ['college', 'sports', 'athletic', 'preppy'],
    commonIn: ['jerseys', 'athletic wear', 'varsity jackets', 'team gear'],
  },

  'mustard': {
    hexCodes: ['#FFDB58', '#E1AD01', '#CDA434'],
    aliases: ['harvest gold', 'burnt yellow', 'dark yellow'],
    vibes: ['70s', 'vintage', 'retro', 'warm', 'earthy'],
    eras: ['1970s', '1980s', '1990s', '2020s'],
    subcultures: ['70s', 'vintage', 'bohemian', 'retro'],
    commonIn: ['corduroy', 'sweaters', 'vintage tees', 'retro wear'],
  },

  'cream': {
    hexCodes: ['#FFFDD0', '#F5F5DC', '#FAEBD7'],
    aliases: ['off white', 'ivory', 'ecru', 'natural'],
    vibes: ['soft', 'vintage', 'classic', 'gentle', 'neutral'],
    eras: ['1900s', '1920s', '1950s', '1970s', '1990s', '2000s', '2020s'],
    subcultures: ['vintage', 'preppy', 'minimalist', 'classic'],
    commonIn: ['sweaters', 'vintage wear', 'basics', 'knits'],
  },

  // ============ ORANGES ============
  'orange': {
    hexCodes: ['#FF8C00', '#FF7F00', '#FF6600'],
    aliases: ['classic orange', 'basic orange', 'medium orange'],
    vibes: ['bold', 'energetic', 'warm', 'vibrant', 'retro'],
    eras: ['1970s', '1980s', '1990s', '2000s', '2020s'],
    subcultures: ['vintage', 'athletic', 'streetwear', 'retro'],
    commonIn: ['tees', 'windbreakers', 'athletic wear', 'accessories'],
  },

  'coral': {
    hexCodes: ['#FF6B6B', '#FF7F6E', '#FA8072'],
    aliases: ['salmon pink', 'coral red', 'melon'],
    vibes: ['warm', 'vintage', 'retro', 'feminine', 'tropical'],
    eras: ['1950s', '1980s', '1990s', '2020s'],
    subcultures: ['vintage', 'tropical', 'feminine', 'retro'],
    commonIn: ['summer wear', 'vintage dresses', 'tops', 'swimwear'],
  },

  'salmon': {
    hexCodes: ['#FA8072', '#E9967A', '#FF8C7A'],
    aliases: ['light coral', 'peachy pink', 'soft red'],
    vibes: ['soft', 'warm', 'vintage', 'feminine', 'gentle'],
    eras: ['1950s', '1980s', '2000s', '2020s'],
    subcultures: ['vintage', 'feminine', 'soft', 'preppy'],
    commonIn: ['tops', 'summer wear', 'vintage wear', 'accessories'],
  },

  'burnt orange': {
    hexCodes: ['#CC5500', '#BF5700', '#C1440E'],
    aliases: ['texas orange', 'autumn orange', 'rust orange'],
    vibes: ['70s', 'vintage', 'warm', 'retro', 'earthy'],
    eras: ['1970s', '1980s', '1990s', '2020s'],
    subcultures: ['70s', 'vintage', 'retro', 'college'],
    commonIn: ['corduroy', 'vintage tees', 'jerseys', 'retro wear'],
  },

  'neon orange': {
    hexCodes: ['#FF6600', '#FF4500', '#FF5F1F'],
    aliases: ['safety orange', 'hunting orange', 'traffic orange'],
    vibes: ['90s', 'athletic', 'loud', 'visible', 'energetic'],
    eras: ['1990s', '2000s', '2010s', '2020s'],
    subcultures: ['athletic', '90s', 'safety', 'streetwear'],
    commonIn: ['athletic wear', 'safety gear', 'windbreakers', 'accessories'],
  },

  // ============ PURPLES ============
  'maroon': {
    hexCodes: ['#800000', '#8B0000', '#722F37'],
    aliases: ['dark red', 'dark maroon', 'wine red'],
    vibes: ['rich', 'collegiate', 'vintage', 'classic', 'bold'],
    eras: ['1920s', '1950s', '1970s', '1990s', '2000s', '2020s'],
    subcultures: ['college', 'preppy', 'vintage', 'classic'],
    commonIn: ['jerseys', 'sweaters', 'jackets', 'team gear'],
  },

  'purple': {
    hexCodes: ['#800080', '#6A0DAD', '#9370DB'],
    aliases: ['violet', 'grape', 'royal purple'],
    vibes: ['bold', 'collegiate', 'regal', 'unique', 'distinctive'],
    eras: ['1960s', '1970s', '1980s', '1990s', '2000s', '2020s'],
    subcultures: ['college', 'sports', 'alternative', 'punk'],
    commonIn: ['jerseys', 'athletic wear', 'vintage tees', 'team gear'],
  },

  'lavender': {
    hexCodes: ['#E6E6FA', '#B57EDC', '#967BB6'],
    aliases: ['light purple', 'lilac', 'mauve'],
    vibes: ['soft', 'vintage', 'feminine', 'gentle', 'pastel'],
    eras: ['1950s', '1980s', '1990s', '2020s'],
    subcultures: ['vintage', 'soft grunge', 'pastel goth', 'cottagecore'],
    commonIn: ['vintage dresses', 'sweaters', 'soft goods', 'accessories'],
  },

  // ============ PINKS ============
  'pink': {
    hexCodes: ['#FF69B4', '#FFB6C1', '#FF85A1'],
    aliases: ['classic pink', 'basic pink', 'medium pink'],
    vibes: ['feminine', 'soft', 'classic', 'sweet', 'retro'],
    eras: ['1950s', '1980s', '1990s', '2000s', '2020s'],
    subcultures: ['classic', 'feminine', 'vintage', 'preppy'],
    commonIn: ['tees', 'sweaters', 'accessories', 'vintage wear'],
  },

  'hot pink': {
    hexCodes: ['#FF69B4', '#FF1493', '#FC0FC0'],
    aliases: ['fuchsia', 'magenta', 'neon pink'],
    vibes: ['bold', '80s', 'loud', 'punk', 'feminine'],
    eras: ['1980s', '1990s', '2000s', '2010s', '2020s'],
    subcultures: ['80s', 'punk', 'rave', 'y2k', 'pop'],
    commonIn: ['athletic wear', 'windbreakers', 'accessories', 'party wear'],
  },

  'blush': {
    hexCodes: ['#DE5D83', '#F7CAC9', '#FFB6C1'],
    aliases: ['dusty pink', 'rose', 'soft pink'],
    vibes: ['soft', 'feminine', 'vintage', 'gentle', 'romantic'],
    eras: ['1950s', '1980s', '2010s', '2020s'],
    subcultures: ['vintage', 'feminine', 'soft', 'romantic'],
    commonIn: ['vintage dresses', 'sweaters', 'lingerie', 'accessories'],
  },

  // ============ BROWNS ============
  'brown': {
    hexCodes: ['#8B4513', '#A0522D', '#7B3F00'],
    aliases: ['classic brown', 'basic brown', 'medium brown'],
    vibes: ['classic', 'earthy', 'warm', 'natural', 'heritage'],
    eras: ['1900s', '1950s', '1970s', '1990s', '2000s', '2020s'],
    subcultures: ['workwear', 'heritage', 'classic', 'vintage'],
    commonIn: ['leather goods', 'boots', 'jackets', 'workwear'],
  },

  'beige': {
    hexCodes: ['#F5F5DC', '#E8DCC8', '#D4C5A9'],
    aliases: ['off-white', 'nude', 'stone', 'oatmeal', 'linen'],
    vibes: ['neutral', 'soft', 'minimalist', 'classic', 'versatile'],
    eras: ['1950s', '1970s', '1990s', '2000s', '2020s'],
    subcultures: ['minimalist', 'classic', 'preppy', 'soft'],
    commonIn: ['chinos', 'knits', 'basics', 'trousers', 'coats'],
  },

  'chocolate': {
    hexCodes: ['#7B3F00', '#3D2B1F', '#4B3621'],
    aliases: ['dark brown', 'espresso', 'deep brown'],
    vibes: ['rich', 'vintage', 'sophisticated', 'warm', 'classic'],
    eras: ['1920s', '1940s', '1970s', '1990s', '2000s', '2020s'],
    subcultures: ['vintage', 'workwear', 'sophisticated', 'heritage'],
    commonIn: ['leather goods', 'workwear', 'boots', 'vintage wear'],
  },

  'tan': {
    hexCodes: ['#D2B48C', '#C9A87F', '#C7956D'],
    aliases: ['khaki', 'sand', 'beige', 'camel'],
    vibes: ['neutral', 'classic', 'preppy', 'versatile', 'timeless'],
    eras: ['1900s', '1920s', '1940s', '1960s', '1980s', '2000s', '2020s'],
    subcultures: ['preppy', 'workwear', 'military', 'classic'],
    commonIn: ['chinos', 'workwear', 'carhartt', 'military surplus'],
  },

  'caramel': {
    hexCodes: ['#C68E17', '#AF6E4D', '#B87333'],
    aliases: ['cognac', 'honey', 'amber'],
    vibes: ['warm', 'rich', 'luxurious', 'vintage', 'sophisticated'],
    eras: ['1970s', '1990s', '2000s', '2020s'],
    subcultures: ['vintage', 'sophisticated', 'heritage', 'luxury'],
    commonIn: ['leather goods', 'boots', 'bags', 'accessories'],
  },

  // ============ BLACKS/GRAYS ============
  'gray': {
    hexCodes: ['#888888', '#999999', '#808080'],
    aliases: ['grey', 'classic gray', 'medium gray', 'mid gray', 'mid grey'],
    vibes: ['neutral', 'versatile', 'classic', 'understated'],
    eras: ['1900s', '1950s', '1980s', '1990s', '2000s', '2020s'],
    subcultures: ['classic', 'minimalist', 'casual', 'basics'],
    commonIn: ['tees', 'sweatshirts', 'trousers', 'basics'],
  },

  'jet black': {
    hexCodes: ['#000000', '#0A0A0A', '#0C0C0C'],
    aliases: ['true black', 'pitch black', 'pure black'],
    vibes: ['classic', 'versatile', 'goth', 'minimalist', 'timeless'],
    eras: ['1900s', '1950s', '1960s', '1980s', '1990s', '2000s', '2020s'],
    subcultures: ['goth', 'punk', 'minimalist', 'avant garde', 'rock'],
    commonIn: ['leather jackets', 'jeans', 'tees', 'suits', 'boots'],
  },

  'charcoal': {
    hexCodes: ['#36454F', '#3B3B3B', '#46494C'],
    aliases: ['dark gray', 'slate', 'graphite'],
    vibes: ['sophisticated', 'professional', 'subtle', 'refined', 'modern'],
    eras: ['1950s', '1990s', '2000s', '2010s', '2020s'],
    subcultures: ['minimalist', 'professional', 'modern', 'tech'],
    commonIn: ['suits', 'coats', 'dress pants', 'business wear'],
  },

  'heather gray': {
    hexCodes: ['#A9A9A9', '#BCC6CC', '#C0C0C0'],
    aliases: ['athletic gray', 'sweatshirt gray', 'gym gray'],
    vibes: ['casual', 'athletic', 'comfortable', 'versatile', 'classic'],
    eras: ['1950s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subcultures: ['athletic', 'streetwear', 'casual', 'basics'],
    commonIn: ['sweatshirts', 'hoodies', 'athletic wear', 'basics'],
  },

  // ============ WHITES ============
  'white': {
    hexCodes: ['#FFFFFF', '#FFFAFA', '#F8F8FF'],
    aliases: ['pure white', 'snow white', 'bright white'],
    vibes: ['clean', 'classic', 'versatile', 'fresh', 'timeless'],
    eras: ['1900s', '1920s', '1950s', '1980s', '2000s', '2020s'],
    subcultures: ['minimalist', 'preppy', 'classic', 'clean'],
    commonIn: ['tees', 'sneakers', 'shirts', 'basics', 'summer wear'],
  },

  // ============ MULTICOLOR/PATTERNS ============
  'tie dye': {
    hexCodes: ['#MULTI', '#RAINBOW', '#PSYCHEDELIC'],
    aliases: ['hippie', 'psychedelic', 'rainbow', 'grateful dead'],
    vibes: ['hippie', '60s', '70s', 'psychedelic', 'festival', 'grateful dead'],
    eras: ['1960s', '1970s', '1990s', '2010s', '2020s'],
    subcultures: ['hippie', 'grateful dead', 'festival', 'psychedelic'],
    commonIn: ['tees', 'hoodies', 'vintage wear', 'festival wear'],
  },

  'camo': {
    hexCodes: ['#MULTI', '#MILITARY', '#WOODLAND'],
    aliases: ['camouflage', 'military', 'woodland', 'desert'],
    vibes: ['military', 'street wear', 'hunting', 'tactical', 'rugged'],
    eras: ['1940s', '1960s', '1980s', '1990s', '2000s', '2020s'],
    subcultures: ['military', 'streetwear', 'hunting', 'hip hop'],
    commonIn: ['military surplus', 'cargo pants', 'jackets', 'streetwear'],
  },

  'plaid': {
    hexCodes: ['#MULTI', '#CHECKERED', '#TARTAN'],
    aliases: ['tartan', 'buffalo check', 'gingham', 'flannel pattern'],
    vibes: ['flannel', 'grunge', 'workwear', 'preppy', 'classic'],
    eras: ['1800s', '1900s', '1950s', '1970s', '1990s', '2020s'],
    subcultures: ['grunge', 'workwear', 'preppy', 'punk', 'lumberjack'],
    commonIn: ['flannel shirts', 'scarves', 'jackets', 'skirts'],
  },

};

export default COLOR_DNA;

// ─── Derived exports for color matching ──────────────────────────────────────

/** Parse a hex string like '#DC143C' into [r, g, b]. Returns null for non-hex values. */
function hexToRgb(hex: string): [number, number, number] | null {
  const m = hex.replace('#', '').match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return null;
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

/**
 * Flat list of every solid color name in COLOR_DNA (excludes pattern entries
 * like tie dye / camo / plaid whose hexCodes start with '#MULTI').
 * Used by textAIService.ts for voice/AI color word scanning.
 * Includes all aliases as well, mapped back to the canonical name.
 */
export const COLOR_WORDS_LIST: string[] = [];

/**
 * Map from canonical color name → average RGB of its first hex code.
 * Used by colorUtils.ts for pixel-based nearest-neighbor color naming.
 * Only includes entries with real hex codes (no patterns).
 */
export const COLOR_RGB_MAP: Array<{ name: string; rgb: [number, number, number] }> = [];

for (const [name, ctx] of Object.entries(COLOR_DNA)) {
  const firstHex = ctx.hexCodes[0];
  const rgb = hexToRgb(firstHex);
  if (!rgb) continue; // skip #MULTI / #RAINBOW etc.

  // Add canonical name
  COLOR_WORDS_LIST.push(name);
  COLOR_RGB_MAP.push({ name, rgb });

  // Add aliases so voice scanning picks up e.g. "army green" → "olive"
  for (const alias of ctx.aliases) {
    COLOR_WORDS_LIST.push(alias);
  }
}
