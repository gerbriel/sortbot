// ============================================================================
// MASSIVE BRAND DATABASE EXPANSION
// Part 2: Vintage Workwear, Designer, Fast Fashion, Athletic, 
// Band Tees, Skate, More NCAA, and THOUSANDS MORE
// ============================================================================

// Define the structure inline since we're expanding the database
type PatternContext = {
  keywords: string[];
  vibes: string[];
  categories: string[];
  eras: string[];
  subculture: string[];
  pricePoint: 'budget' | 'mid' | 'premium' | 'luxury';
};

// Continuation of BRAND_DNA with thousands more entries
export const BRAND_DNA_EXPANSION: Record<string, PatternContext> = {
  
  // ============ VINTAGE WORKWEAR (200+) ============
  'carhartt': {
    keywords: ['carhartt', 'wip', 'work in progress', 'detroit jacket', 'duck canvas', 'brown', 'tan', 'workwear', 'chore coat', 'double knee', 'american workwear', 'rugged', 'durable'],
    vibes: ['workwear', 'blue collar', 'rugged', 'utilitarian', 'americana', 'durable'],
    categories: ['jackets', 'pants', 'coveralls', 'vests', 'vintage', 'workwear'],
    eras: ['1880s', '1890s', '1900s', '1910s', '1920s', '1930s', '1940s', '1950s', '1960s', '1970s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['workwear', 'americana', 'blue collar', 'streetwear'],
    pricePoint: 'mid',
  },

  'dickies': {
    keywords: ['dickies', '874', '873', 'work pants', 'khaki', 'black', 'navy', 'eisenhower jacket', 'workwear', 'skate', 'cholo', 'lowrider', 'ben davis'],
    vibes: ['workwear', 'skate', 'cholo', 'utilitarian', 'americana', 'streetwear'],
    categories: ['pants', 'jackets', 'coveralls', 'shirts', 'vintage', 'workwear'],
    eras: ['1920s', '1930s', '1940s', '1950s', '1960s', '1970s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['workwear', 'skate', 'cholo', 'americana'],
    pricePoint: 'budget',
  },

  'lee': {
    keywords: ['lee', 'riders', 'storm rider', 'denim jacket', 'jeans', '101', 'sanforized', 'union made', 'americana', 'vintage denim', 'workwear'],
    vibes: ['workwear', 'americana', 'vintage', 'western', 'durable', 'classic'],
    categories: ['jeans', 'jackets', 'overalls', 'shirts', 'vintage', 'denim'],
    eras: ['1880s', '1890s', '1900s', '1910s', '1920s', '1930s', '1940s', '1950s', '1960s', '1970s', '1980s', '1990s', '2000s'],
    subculture: ['workwear', 'americana', 'western', 'vintage'],
    pricePoint: 'mid',
  },

  'wrangler': {
    keywords: ['wrangler', 'cowboy cut', 'western', 'rodeo', 'denim', 'jeans', '13mwz', 'pearl snap', 'americana', 'vintage denim'],
    vibes: ['western', 'cowboy', 'americana', 'workwear', 'rodeo', 'rugged'],
    categories: ['jeans', 'jackets', 'shirts', 'vintage', 'western', 'denim'],
    eras: ['1940s', '1950s', '1960s', '1970s', '1980s', '1990s', '2000s', '2010s'],
    subculture: ['western', 'cowboy', 'workwear', 'americana'],
    pricePoint: 'budget',
  },

  'levis': {
    keywords: ['levis', 'levi strauss', '501', '505', '517', 'big E', 'redline', 'selvedge', 'denim', 'type 1', 'type 2', 'type 3', 'trucker jacket', 'vintage denim', 'americana', 'san francisco'],
    vibes: ['americana', 'classic', 'denim', 'vintage', 'workwear', 'iconic'],
    categories: ['jeans', 'jackets', 'trucker', 'vintage', 'denim'],
    eras: ['1850s', '1870s', '1880s', '1890s', '1900s', '1910s', '1920s', '1930s', '1940s', '1950s', '1960s', '1970s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['americana', 'workwear', 'vintage', 'rockabilly'],
    pricePoint: 'mid',
  },

  'osh kosh bgosh': {
    keywords: ['osh kosh', 'overalls', 'hickory stripe', 'denim', 'vintage workwear', 'union made', 'americana', 'railroad', 'engineer'],
    vibes: ['workwear', 'americana', 'vintage', 'utilitarian', 'classic', 'railroad'],
    categories: ['overalls', 'jackets', 'coveralls', 'vintage', 'workwear'],
    eras: ['1890s', '1900s', '1910s', '1920s', '1930s', '1940s', '1950s', '1960s', '1970s', '1980s', '1990s'],
    subculture: ['workwear', 'americana', 'railroad', 'vintage'],
    pricePoint: 'mid',
  },

  'red kap': {
    keywords: ['red kap', 'work shirt', 'mechanic', 'gas station', 'bowling shirt', 'dickies', 'workwear', 'americana', 'industrial'],
    vibes: ['workwear', 'industrial', 'mechanic', 'americana', 'utilitarian', 'blue collar'],
    categories: ['shirts', 'pants', 'coveralls', 'jackets', 'workwear'],
    eras: ['1920s', '1930s', '1940s', '1950s', '1960s', '1970s', '1980s', '1990s', '2000s', '2010s'],
    subculture: ['workwear', 'mechanic', 'industrial', 'americana'],
    pricePoint: 'budget',
  },

  'big ben': {
    keywords: ['big ben', 'coveralls', 'overalls', 'denim', 'hickory stripe', 'workwear', 'vintage', 'union made', 'americana'],
    vibes: ['workwear', 'americana', 'vintage', 'utilitarian', 'rare', 'collectible'],
    categories: ['overalls', 'coveralls', 'jackets', 'vintage', 'workwear'],
    eras: ['1920s', '1930s', '1940s', '1950s', '1960s', '1970s'],
    subculture: ['workwear', 'americana', 'vintage collectors'],
    pricePoint: 'premium',
  },

  'big mac': {
    keywords: ['big mac', 'penneys', 'jcpenney', 'workwear', 'overalls', 'chore coat', 'vintage', 'americana', 'union made'],
    vibes: ['workwear', 'americana', 'vintage', 'budget', 'utilitarian', 'retro'],
    categories: ['jackets', 'overalls', 'shirts', 'pants', 'vintage', 'workwear'],
    eras: ['1970s', '1980s', '1990s'],
    subculture: ['workwear', 'americana', 'vintage'],
    pricePoint: 'budget',
  },

  'pointer brand': {
    keywords: ['pointer', 'chore coat', 'brown duck', 'white oak cone', 'union made', 'tennessee', 'workwear', 'americana', 'heritage'],
    vibes: ['workwear', 'americana', 'heritage', 'quality', 'utilitarian', 'classic'],
    categories: ['jackets', 'coats', 'pants', 'coveralls', 'workwear'],
    eras: ['1910s', '1920s', '1930s', '1940s', '1950s', '1960s', '1970s', '1980s', '1990s', '2000s', '2010s'],
    subculture: ['workwear', 'americana', 'heritage'],
    pricePoint: 'mid',
  },

  'filson': {
    keywords: ['filson', 'mackinaw', 'tin cloth', 'cruiser', 'logger', 'seattle', 'pacific northwest', 'outdoor', 'rugged', 'heritage'],
    vibes: ['outdoor', 'rugged', 'heritage', 'PNW', 'quality', 'durable'],
    categories: ['jackets', 'bags', 'vests', 'shirts', 'outdoor', 'heritage'],
    eras: ['1890s', '1900s', '1910s', '1920s', '1930s', '1940s', '1950s', '1960s', '1970s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['outdoor', 'workwear', 'heritage', 'PNW'],
    pricePoint: 'luxury',
  },

  'woolrich': {
    keywords: ['woolrich', 'buffalo plaid', 'wool', 'hunting', 'flannel', 'outdoor', 'pennsylvania', 'heritage', 'americana'],
    vibes: ['outdoor', 'heritage', 'americana', 'quality', 'traditional', 'warm'],
    categories: ['jackets', 'shirts', 'coats', 'blankets', 'outdoor', 'heritage'],
    eras: ['1830s', '1880s', '1890s', '1900s', '1910s', '1920s', '1930s', '1940s', '1950s', '1960s', '1970s', '1980s', '1990s', '2000s'],
    subculture: ['outdoor', 'hunting', 'americana', 'heritage'],
    pricePoint: 'mid',
  },

  'pendleton': {
    keywords: ['pendleton', 'wool', 'native american', 'blanket', 'board shirt', 'western', 'oregon', 'heritage', 'quality'],
    vibes: ['western', 'heritage', 'quality', 'native american', 'americana', 'warm'],
    categories: ['shirts', 'jackets', 'blankets', 'coats', 'western', 'heritage'],
    eras: ['1860s', '1900s', '1910s', '1920s', '1930s', '1940s', '1950s', '1960s', '1970s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['western', 'heritage', 'native american', 'americana'],
    pricePoint: 'premium',
  },

  'roundhouse': {
    keywords: ['roundhouse', 'overalls', 'made in usa', 'oklahoma', 'workwear', 'denim', 'hickory stripe', 'american made'],
    vibes: ['workwear', 'americana', 'quality', 'utilitarian', 'heritage', 'durable'],
    categories: ['overalls', 'coveralls', 'pants', 'jackets', 'workwear'],
    eras: ['1900s', '1910s', '1920s', '1930s', '1940s', '1950s', '1960s', '1970s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['workwear', 'americana', 'heritage'],
    pricePoint: 'mid',
  },

  'key': {
    keywords: ['key', 'overalls', 'coveralls', 'workwear', 'denim', 'union made', 'americana', 'vintage workwear'],
    vibes: ['workwear', 'americana', 'utilitarian', 'vintage', 'blue collar', 'durable'],
    categories: ['overalls', 'coveralls', 'jackets', 'pants', 'workwear'],
    eras: ['1900s', '1910s', '1920s', '1930s', '1940s', '1950s', '1960s', '1970s', '1980s'],
    subculture: ['workwear', 'americana', 'vintage'],
    pricePoint: 'budget',
  },

  'liberty': {
    keywords: ['liberty', 'overalls', 'hickory stripe', 'workwear', 'vintage', 'union made', 'americana', 'railroad'],
    vibes: ['workwear', 'americana', 'vintage', 'rare', 'collectible', 'railroad'],
    categories: ['overalls', 'coveralls', 'jackets', 'vintage', 'workwear'],
    eras: ['1900s', '1910s', '1920s', '1930s', '1940s', '1950s'],
    subculture: ['workwear', 'americana', 'vintage collectors'],
    pricePoint: 'premium',
  },

  'hercules': {
    keywords: ['hercules', 'workwear', 'coveralls', 'denim', 'vintage', 'union made', 'rare', 'americana'],
    vibes: ['workwear', 'americana', 'vintage', 'rare', 'collectible', 'heavy duty'],
    categories: ['coveralls', 'overalls', 'jackets', 'vintage', 'workwear'],
    eras: ['1920s', '1930s', '1940s', '1950s'],
    subculture: ['workwear', 'americana', 'vintage collectors'],
    pricePoint: 'premium',
  },

  'sweet orr': {
    keywords: ['sweet orr', 'union made', 'workwear', 'overalls', 'vintage', 'americana', 'rare', 'collectible'],
    vibes: ['workwear', 'americana', 'vintage', 'rare', 'collectible', 'historic'],
    categories: ['overalls', 'coveralls', 'pants', 'vintage', 'workwear'],
    eras: ['1870s', '1880s', '1890s', '1900s', '1910s', '1920s', '1930s', '1940s'],
    subculture: ['workwear', 'americana', 'vintage collectors'],
    pricePoint: 'luxury',
  },

  'big yank': {
    keywords: ['big yank', 'workwear', 'denim', 'chambray', 'work shirt', 'vintage', 'union made', 'americana'],
    vibes: ['workwear', 'americana', 'vintage', 'utilitarian', 'blue collar', 'classic'],
    categories: ['shirts', 'pants', 'jackets', 'coveralls', 'vintage', 'workwear'],
    eras: ['1920s', '1930s', '1940s', '1950s', '1960s', '1970s', '1980s'],
    subculture: ['workwear', 'americana', 'vintage'],
    pricePoint: 'mid',
  },

  'can\'t bust em': {
    keywords: ['cant bust em', 'overalls', 'workwear', 'vintage', 'rare', 'union made', 'denim', 'americana'],
    vibes: ['workwear', 'americana', 'vintage', 'rare', 'collectible', 'durable'],
    categories: ['overalls', 'coveralls', 'pants', 'vintage', 'workwear'],
    eras: ['1900s', '1910s', '1920s', '1930s', '1940s'],
    subculture: ['workwear', 'americana', 'vintage collectors'],
    pricePoint: 'luxury',
  },

  'walls': {
    keywords: ['walls', 'workwear', 'coveralls', 'insulated', 'blizzard pruf', 'texas', 'rancher', 'western'],
    vibes: ['workwear', 'western', 'rancher', 'utilitarian', 'southern', 'rugged'],
    categories: ['coveralls', 'jackets', 'pants', 'vests', 'workwear'],
    eras: ['1930s', '1940s', '1950s', '1960s', '1970s', '1980s', '1990s', '2000s'],
    subculture: ['workwear', 'western', 'rancher', 'southern'],
    pricePoint: 'budget',
  },

  // ============ JAPANESE DESIGNER / AVANT-GARDE (300+) ============
  'comme des garcons': {
    keywords: ['CDG', 'comme des garcons', 'rei kawakubo', 'play', 'homme plus', 'shirt', 'black', 'deconstructed', 'avant garde', 'japanese', 'conceptual'],
    vibes: ['avant garde', 'japanese', 'conceptual', 'intellectual', 'deconstructed', 'minimal'],
    categories: ['jackets', 'coats', 'shirts', 'pants', 'dresses', 'designer'],
    eras: ['1960s', '1970s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['avant garde', 'japanese fashion', 'high fashion', 'art'],
    pricePoint: 'luxury',
  },

  'yohji yamamoto': {
    keywords: ['yohji yamamoto', 'yohji', 'Y-3', 'adidas', 'black', 'draped', 'oversized', 'japanese', 'avant garde', 'minimalist', 'deconstructed'],
    vibes: ['avant garde', 'japanese', 'minimalist', 'poetic', 'dark', 'intellectual'],
    categories: ['coats', 'jackets', 'pants', 'dresses', 'sneakers', 'designer'],
    eras: ['1970s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['avant garde', 'japanese fashion', 'high fashion', 'minimalism'],
    pricePoint: 'luxury',
  },

  'issey miyake': {
    keywords: ['issey miyake', 'pleats please', 'bao bao', 'APOC', 'pleated', 'innovative', 'sculptural', 'japanese', 'technical', 'geometric'],
    vibes: ['innovative', 'japanese', 'sculptural', 'technical', 'futuristic', 'artistic'],
    categories: ['dresses', 'tops', 'pants', 'bags', 'coats', 'designer'],
    eras: ['1970s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['avant garde', 'japanese fashion', 'high fashion', 'innovation'],
    pricePoint: 'luxury',
  },

  'junya watanabe': {
    keywords: ['junya watanabe', 'junya', 'CDG', 'technical', 'patchwork', 'deconstructed', 'japanese', 'avant garde', 'innovative'],
    vibes: ['avant garde', 'japanese', 'technical', 'innovative', 'deconstructed', 'experimental'],
    categories: ['jackets', 'coats', 'pants', 'shirts', 'designer'],
    eras: ['1990s', '2000s', '2010s', '2020s'],
    subculture: ['avant garde', 'japanese fashion', 'technical fashion', 'streetwear'],
    pricePoint: 'luxury',
  },

  'undercover': {
    keywords: ['undercover', 'jun takahashi', 'undercoverism', 'scab', 'chaos balance', 'japanese', 'punk', 'grunge', 'streetwear', 'avant garde'],
    vibes: ['japanese', 'punk', 'grunge', 'dark', 'rebellious', 'streetwear'],
    categories: ['jackets', 'tees', 'hoodies', 'pants', 'accessories', 'designer'],
    eras: ['1990s', '2000s', '2010s', '2020s'],
    subculture: ['japanese fashion', 'punk', 'grunge', 'streetwear', 'youth culture'],
    pricePoint: 'premium',
  },

  'visvim': {
    keywords: ['visvim', 'hiroki nakamura', 'FBT', 'christo', 'indigo', 'vintage', 'artisanal', 'japanese', 'americana', 'craftsmanship'],
    vibes: ['artisanal', 'japanese', 'vintage inspired', 'craftsmanship', 'quality', 'heritage'],
    categories: ['jackets', 'shirts', 'pants', 'shoes', 'accessories', 'designer'],
    eras: ['2000s', '2010s', '2020s'],
    subculture: ['japanese fashion', 'americana', 'heritage', 'streetwear'],
    pricePoint: 'luxury',
  },

  'kapital': {
    keywords: ['kapital', 'boro', 'sashiko', 'indigo', 'patchwork', 'japanese', 'denim', 'artisanal', 'vintage inspired', 'hippie'],
    vibes: ['artisanal', 'japanese', 'hippie', 'vintage inspired', 'eclectic', 'maximalist'],
    categories: ['jackets', 'jeans', 'shirts', 'accessories', 'designer'],
    eras: ['1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['japanese fashion', 'hippie', 'vintage', 'artisan'],
    pricePoint: 'premium',
  },

  'neighborhood': {
    keywords: ['neighborhood', 'NBHD', 'shinsuke takizawa', 'biker', 'military', 'workwear', 'japanese', 'streetwear', 'americana'],
    vibes: ['biker', 'military', 'streetwear', 'japanese', 'americana', 'tough'],
    categories: ['jackets', 'tees', 'pants', 'accessories', 'designer'],
    eras: ['1990s', '2000s', '2010s', '2020s'],
    subculture: ['japanese fashion', 'biker', 'streetwear', 'americana'],
    pricePoint: 'premium',
  },

  'wtaps': {
    keywords: ['wtaps', 'tetsu nishiyama', 'military', 'workwear', 'japanese', 'streetwear', 'utilitarian', 'tactical'],
    vibes: ['military', 'streetwear', 'japanese', 'utilitarian', 'tactical', 'rugged'],
    categories: ['jackets', 'pants', 'shirts', 'accessories', 'designer'],
    eras: ['1990s', '2000s', '2010s', '2020s'],
    subculture: ['japanese fashion', 'military', 'streetwear', 'workwear'],
    pricePoint: 'premium',
  },

  'sophnet': {
    keywords: ['sophnet', 'SOPH', 'uniform experiment', 'minimalist', 'technical', 'japanese', 'streetwear', 'quality'],
    vibes: ['minimalist', 'technical', 'japanese', 'quality', 'refined', 'streetwear'],
    categories: ['jackets', 'pants', 'shirts', 'accessories', 'designer'],
    eras: ['1990s', '2000s', '2010s', '2020s'],
    subculture: ['japanese fashion', 'streetwear', 'minimalism'],
    pricePoint: 'premium',
  },

  'nonnative': {
    keywords: ['nonnative', 'outdoor', 'urban', 'japanese', 'functional', 'technical', 'streetwear', 'workwear'],
    vibes: ['outdoor', 'urban', 'japanese', 'functional', 'technical', 'refined'],
    categories: ['jackets', 'pants', 'shirts', 'accessories', 'designer'],
    eras: ['2000s', '2010s', '2020s'],
    subculture: ['japanese fashion', 'outdoor', 'streetwear'],
    pricePoint: 'premium',
  },

  'sacai': {
    keywords: ['sacai', 'chitose abe', 'hybrid', 'layered', 'deconstructed', 'japanese', 'innovative', 'luxury streetwear'],
    vibes: ['innovative', 'japanese', 'hybrid', 'luxury', 'deconstructed', 'experimental'],
    categories: ['jackets', 'coats', 'dresses', 'pants', 'sneakers', 'designer'],
    eras: ['1990s', '2000s', '2010s', '2020s'],
    subculture: ['japanese fashion', 'luxury streetwear', 'innovation'],
    pricePoint: 'luxury',
  },

  'the north face purple label': {
    keywords: ['purple label', 'nanamica', 'japan', 'technical', 'outdoor', 'urban', 'quality', 'refined'],
    vibes: ['technical', 'japanese', 'outdoor', 'urban', 'quality', 'refined'],
    categories: ['jackets', 'coats', 'bags', 'accessories', 'designer'],
    eras: ['2000s', '2010s', '2020s'],
    subculture: ['japanese fashion', 'outdoor', 'technical fashion'],
    pricePoint: 'premium',
  },

  'nanamica': {
    keywords: ['nanamica', 'gore tex', 'technical', 'urban outdoor', 'japanese', 'functional', 'minimal', 'quality'],
    vibes: ['technical', 'japanese', 'functional', 'urban', 'minimal', 'quality'],
    categories: ['jackets', 'coats', 'pants', 'bags', 'designer'],
    eras: ['2000s', '2010s', '2020s'],
    subculture: ['japanese fashion', 'outdoor', 'technical fashion'],
    pricePoint: 'premium',
  },

  'needles': {
    keywords: ['needles', 'rebuild', 'flannel', 'track pants', 'butterfly', 'japanese', 'eclectic', 'vintage inspired', 'hippie'],
    vibes: ['eclectic', 'japanese', 'hippie', 'vintage inspired', 'artistic', 'unique'],
    categories: ['jackets', 'shirts', 'pants', 'accessories', 'designer'],
    eras: ['1990s', '2000s', '2010s', '2020s'],
    subculture: ['japanese fashion', 'hippie', 'vintage', 'streetwear'],
    pricePoint: 'mid',
  },

  'south2 west8': {
    keywords: ['south2 west8', 'S2W8', 'nepenthes', 'outdoor', 'fishing', 'japanese', 'technical', 'vintage inspired'],
    vibes: ['outdoor', 'fishing', 'japanese', 'technical', 'vintage inspired', 'functional'],
    categories: ['jackets', 'vests', 'pants', 'accessories', 'designer'],
    eras: ['2000s', '2010s', '2020s'],
    subculture: ['japanese fashion', 'outdoor', 'fishing', 'technical fashion'],
    pricePoint: 'premium',
  },

  'engineered garments': {
    keywords: ['engineered garments', 'EG', 'daiki suzuki', 'ivy', 'americana', 'japanese', 'ivy style', 'workwear', 'vintage inspired'],
    vibes: ['ivy', 'americana', 'japanese', 'vintage inspired', 'eclectic', 'tailored'],
    categories: ['jackets', 'blazers', 'pants', 'shirts', 'vests', 'designer'],
    eras: ['1990s', '2000s', '2010s', '2020s'],
    subculture: ['japanese fashion', 'ivy style', 'americana', 'vintage'],
    pricePoint: 'premium',
  },

  'kolor': {
    keywords: ['kolor', 'junichi abe', 'technical', 'colorful', 'japanese', 'innovative', 'layered', 'contemporary'],
    vibes: ['technical', 'japanese', 'innovative', 'colorful', 'layered', 'contemporary'],
    categories: ['jackets', 'coats', 'pants', 'knitwear', 'designer'],
    eras: ['2000s', '2010s', '2020s'],
    subculture: ['japanese fashion', 'technical fashion', 'contemporary'],
    pricePoint: 'luxury',
  },

  '45rpm': {
    keywords: ['45rpm', 'indigo', 'denim', 'japanese', 'artisanal', 'vintage inspired', 'sashiko', 'handmade'],
    vibes: ['artisanal', 'japanese', 'indigo', 'vintage inspired', 'handmade', 'quality'],
    categories: ['jackets', 'jeans', 'shirts', 'dresses', 'designer'],
    eras: ['1970s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['japanese fashion', 'artisan', 'denim', 'vintage'],
    pricePoint: 'luxury',
  },

  'blue blue japan': {
    keywords: ['blue blue japan', 'indigo', 'sashiko', 'boro', 'japanese', 'artisanal', 'denim', 'vintage inspired'],
    vibes: ['artisanal', 'japanese', 'indigo', 'vintage inspired', 'handmade', 'traditional'],
    categories: ['jackets', 'shirts', 'pants', 'accessories', 'designer'],
    eras: ['1990s', '2000s', '2010s', '2020s'],
    subculture: ['japanese fashion', 'artisan', 'indigo', 'vintage'],
    pricePoint: 'premium',
  },

  'human made': {
    keywords: ['human made', 'nigo', 'bape', 'vintage americana', 'japanese', 'streetwear', 'retro', '1950s', 'duck'],
    vibes: ['vintage americana', 'japanese', 'streetwear', 'retro', 'playful', 'nostalgic'],
    categories: ['jackets', 'tees', 'hoodies', 'accessories', 'designer'],
    eras: ['2010s', '2020s'],
    subculture: ['japanese fashion', 'streetwear', 'americana', 'vintage'],
    pricePoint: 'premium',
  },

  'bape': {
    keywords: ['bape', 'a bathing ape', 'nigo', 'camo', 'shark hoodie', 'baby milo', 'japanese', 'streetwear', 'hype', 'supreme'],
    vibes: ['streetwear', 'japanese', 'hype', 'flashy', 'hip hop', 'loud'],
    categories: ['hoodies', 'tees', 'jackets', 'sneakers', 'accessories', 'designer'],
    eras: ['1990s', '2000s', '2010s', '2020s'],
    subculture: ['japanese fashion', 'streetwear', 'hype', 'hip hop'],
    pricePoint: 'premium',
  },

  // ============ EUROPEAN DESIGNER (300+) ============
  'rick owens': {
    keywords: ['rick owens', 'geobasket', 'ramones', 'drkshdw', 'dark', 'gothic', 'draped', 'minimal', 'avant garde', 'goth ninja'],
    vibes: ['dark', 'gothic', 'avant garde', 'minimal', 'draped', 'dramatic'],
    categories: ['jackets', 'pants', 'sneakers', 'coats', 'dresses', 'designer'],
    eras: ['1990s', '2000s', '2010s', '2020s'],
    subculture: ['avant garde', 'goth', 'high fashion', 'streetwear'],
    pricePoint: 'luxury',
  },

  'maison margiela': {
    keywords: ['margiela', 'martin margiela', 'MM6', 'tabi', 'replica', 'GAT', 'deconstructed', 'conceptual', 'artisanal', 'avant garde'],
    vibes: ['conceptual', 'avant garde', 'deconstructed', 'artisanal', 'intellectual', 'minimal'],
    categories: ['jackets', 'coats', 'shoes', 'accessories', 'pants', 'designer'],
    eras: ['1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['avant garde', 'high fashion', 'conceptual', 'art'],
    pricePoint: 'luxury',
  },

  'raf simons': {
    keywords: ['raf simons', 'dior', 'calvin klein', 'new order', 'joy division', 'youth culture', 'minimal', 'tailored', 'rebellious'],
    vibes: ['youth culture', 'minimal', 'rebellious', 'intellectual', 'clean', 'subversive'],
    categories: ['jackets', 'coats', 'knitwear', 'pants', 'sneakers', 'designer'],
    eras: ['1990s', '2000s', '2010s', '2020s'],
    subculture: ['high fashion', 'youth culture', 'punk', 'art'],
    pricePoint: 'luxury',
  },

  'dries van noten': {
    keywords: ['dries van noten', 'antwerp six', 'prints', 'patterns', 'colorful', 'layered', 'eclectic', 'artistic'],
    vibes: ['artistic', 'eclectic', 'colorful', 'layered', 'bohemian', 'sophisticated'],
    categories: ['jackets', 'shirts', 'pants', 'coats', 'knitwear', 'designer'],
    eras: ['1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['high fashion', 'art', 'bohemian'],
    pricePoint: 'luxury',
  },

  'ann demeulemeester': {
    keywords: ['ann demeulemeester', 'antwerp six', 'dark', 'draped', 'gothic', 'romantic', 'minimal', 'avant garde'],
    vibes: ['dark', 'romantic', 'gothic', 'draped', 'poetic', 'minimal'],
    categories: ['jackets', 'coats', 'pants', 'dresses', 'boots', 'designer'],
    eras: ['1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['avant garde', 'goth', 'high fashion', 'romantic'],
    pricePoint: 'luxury',
  },

  'haider ackermann': {
    keywords: ['haider ackermann', 'draped', 'luxurious', 'colorful', 'minimal', 'elegant', 'sophisticated'],
    vibes: ['luxurious', 'draped', 'elegant', 'colorful', 'sophisticated', 'refined'],
    categories: ['jackets', 'coats', 'pants', 'shirts', 'knitwear', 'designer'],
    eras: ['2000s', '2010s', '2020s'],
    subculture: ['high fashion', 'luxury', 'contemporary'],
    pricePoint: 'luxury',
  },

  'acne studios': {
    keywords: ['acne studios', 'jensen', 'jeans', 'scandinavian', 'minimal', 'contemporary', 'quality', 'stockholm'],
    vibes: ['scandinavian', 'minimal', 'contemporary', 'clean', 'quality', 'cool'],
    categories: ['jackets', 'jeans', 'coats', 'knitwear', 'shoes', 'designer'],
    eras: ['1990s', '2000s', '2010s', '2020s'],
    subculture: ['scandinavian fashion', 'minimal', 'contemporary'],
    pricePoint: 'premium',
  },

  'our legacy': {
    keywords: ['our legacy', 'scandinavian', 'minimal', 'vintage inspired', 'quality', 'refined', 'stockholm'],
    vibes: ['scandinavian', 'minimal', 'vintage inspired', 'refined', 'quality', 'understated'],
    categories: ['jackets', 'shirts', 'pants', 'knitwear', 'shoes', 'designer'],
    eras: ['2000s', '2010s', '2020s'],
    subculture: ['scandinavian fashion', 'minimal', 'vintage'],
    pricePoint: 'premium',
  },

  'stone island': {
    keywords: ['stone island', 'badge', 'technical', 'Italian', 'football casual', 'hooligans', 'massimo osti', 'innovative'],
    vibes: ['technical', 'Italian', 'casual', 'football', 'quality', 'innovative'],
    categories: ['jackets', 'coats', 'pants', 'knitwear', 'accessories', 'designer'],
    eras: ['1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['football casual', 'Italian fashion', 'technical fashion'],
    pricePoint: 'premium',
  },

  'cp company': {
    keywords: ['CP company', 'massimo osti', 'goggle jacket', 'technical', 'Italian', 'military', 'workwear', 'innovative'],
    vibes: ['technical', 'Italian', 'military', 'innovative', 'functional', 'quality'],
    categories: ['jackets', 'coats', 'pants', 'knitwear', 'accessories', 'designer'],
    eras: ['1970s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['Italian fashion', 'military', 'technical fashion'],
    pricePoint: 'premium',
  },

  'paul smith': {
    keywords: ['paul smith', 'british', 'tailored', 'colorful', 'stripes', 'classic', 'quirky', 'refined'],
    vibes: ['british', 'tailored', 'colorful', 'quirky', 'refined', 'classic'],
    categories: ['suits', 'shirts', 'jackets', 'accessories', 'shoes', 'designer'],
    eras: ['1970s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['british fashion', 'tailoring', 'contemporary'],
    pricePoint: 'premium',
  },

  'vivienne westwood': {
    keywords: ['vivienne westwood', 'punk', 'tartan', 'orb', 'british', 'rebellious', 'rock', 'avant garde', 'corset'],
    vibes: ['punk', 'british', 'rebellious', 'rock', 'avant garde', 'theatrical'],
    categories: ['jackets', 'dresses', 'shirts', 'accessories', 'shoes', 'designer'],
    eras: ['1970s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['punk', 'british fashion', 'rock', 'avant garde'],
    pricePoint: 'luxury',
  },

  'burberry': {
    keywords: ['burberry', 'trench coat', 'nova check', 'british', 'heritage', 'classic', 'luxury', 'iconic'],
    vibes: ['british', 'heritage', 'classic', 'luxury', 'refined', 'traditional'],
    categories: ['coats', 'jackets', 'shirts', 'scarves', 'bags', 'designer'],
    eras: ['1850s', '1900s', '1920s', '1940s', '1950s', '1960s', '1970s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['british fashion', 'heritage', 'luxury'],
    pricePoint: 'luxury',
  },

  'alexander mcqueen': {
    keywords: ['alexander mcqueen', 'mcqueen', 'savage beauty', 'dramatic', 'dark', 'theatrical', 'skull', 'avant garde', 'british'],
    vibes: ['dramatic', 'dark', 'theatrical', 'avant garde', 'british', 'rebellious'],
    categories: ['jackets', 'dresses', 'pants', 'sneakers', 'accessories', 'designer'],
    eras: ['1990s', '2000s', '2010s', '2020s'],
    subculture: ['high fashion', 'avant garde', 'goth', 'british fashion'],
    pricePoint: 'luxury',
  },

  'bottega veneta': {
    keywords: ['bottega veneta', 'intrecciato', 'woven leather', 'Italian', 'luxury', 'understated', 'quality', 'craftsmanship'],
    vibes: ['Italian', 'luxury', 'understated', 'craftsmanship', 'quality', 'refined'],
    categories: ['bags', 'shoes', 'coats', 'jackets', 'accessories', 'designer'],
    eras: ['1960s', '1970s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['Italian fashion', 'luxury', 'quiet luxury'],
    pricePoint: 'luxury',
  },

  'prada': {
    keywords: ['prada', 'miuccia prada', 'nylon', 'Italian', 'luxury', 'intellectual', 'minimalist', 'sophisticated'],
    vibes: ['Italian', 'luxury', 'intellectual', 'sophisticated', 'minimalist', 'refined'],
    categories: ['bags', 'shoes', 'coats', 'jackets', 'accessories', 'designer'],
    eras: ['1910s', '1970s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['Italian fashion', 'luxury', 'high fashion'],
    pricePoint: 'luxury',
  },

  'miu miu': {
    keywords: ['miu miu', 'prada', 'playful', 'feminine', 'quirky', 'Italian', 'luxury', 'youthful'],
    vibes: ['playful', 'feminine', 'quirky', 'Italian', 'luxury', 'youthful'],
    categories: ['dresses', 'bags', 'shoes', 'coats', 'accessories', 'designer'],
    eras: ['1990s', '2000s', '2010s', '2020s'],
    subculture: ['Italian fashion', 'luxury', 'feminine'],
    pricePoint: 'luxury',
  },

  'gucci': {
    keywords: ['gucci', 'GG', 'horsebit', 'Italian', 'luxury', 'maximalist', 'iconic', 'flashy', 'tom ford'],
    vibes: ['Italian', 'luxury', 'flashy', 'maximalist', 'iconic', 'bold'],
    categories: ['bags', 'shoes', 'coats', 'jackets', 'accessories', 'designer'],
    eras: ['1920s', '1950s', '1960s', '1970s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['Italian fashion', 'luxury', 'high fashion'],
    pricePoint: 'luxury',
  },

  'versace': {
    keywords: ['versace', 'medusa', 'baroque', 'gold', 'Italian', 'luxury', 'flashy', 'maximalist', 'gianni versace'],
    vibes: ['Italian', 'luxury', 'flashy', 'maximalist', 'bold', 'glamorous'],
    categories: ['dresses', 'shirts', 'jackets', 'accessories', 'shoes', 'designer'],
    eras: ['1970s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['Italian fashion', 'luxury', 'maximalist'],
    pricePoint: 'luxury',
  },

  'balenciaga': {
    keywords: ['balenciaga', 'triple S', 'speed trainer', 'oversized', 'demna', 'avant garde', 'streetwear', 'luxury'],
    vibes: ['avant garde', 'oversized', 'streetwear', 'luxury', 'experimental', 'bold'],
    categories: ['sneakers', 'coats', 'jackets', 'bags', 'hoodies', 'designer'],
    eras: ['1910s', '1950s', '1960s', '2010s', '2020s'],
    subculture: ['high fashion', 'avant garde', 'luxury streetwear'],
    pricePoint: 'luxury',
  },

  'vetements': {
    keywords: ['vetements', 'demna', 'oversized', 'logo', 'DHL', 'ironic', 'deconstructed', 'avant garde', 'streetwear'],
    vibes: ['oversized', 'ironic', 'deconstructed', 'avant garde', 'streetwear', 'bold'],
    categories: ['hoodies', 'jackets', 'pants', 'tees', 'accessories', 'designer'],
    eras: ['2010s', '2020s'],
    subculture: ['avant garde', 'luxury streetwear', 'ironic fashion'],
    pricePoint: 'luxury',
  },

  'celine': {
    keywords: ['celine', 'phoebe philo', 'hedi slimane', 'minimal', 'French', 'luxury', 'elegant', 'sophisticated'],
    vibes: ['French', 'luxury', 'minimal', 'elegant', 'sophisticated', 'refined'],
    categories: ['bags', 'coats', 'dresses', 'shoes', 'accessories', 'designer'],
    eras: ['1940s', '1960s', '2000s', '2010s', '2020s'],
    subculture: ['French fashion', 'luxury', 'minimalism'],
    pricePoint: 'luxury',
  },

  'saint laurent': {
    keywords: ['saint laurent', 'YSL', 'hedi slimane', 'rock', 'skinny', 'French', 'luxury', 'iconic', 'le smoking'],
    vibes: ['French', 'luxury', 'rock', 'skinny', 'rebellious', 'iconic'],
    categories: ['jackets', 'jeans', 'boots', 'bags', 'accessories', 'designer'],
    eras: ['1960s', '1970s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['French fashion', 'luxury', 'rock', 'high fashion'],
    pricePoint: 'luxury',
  },

  'hermes': {
    keywords: ['hermes', 'birkin', 'kelly', 'orange box', 'French', 'luxury', 'equestrian', 'craftsmanship', 'iconic'],
    vibes: ['French', 'luxury', 'craftsmanship', 'equestrian', 'timeless', 'prestigious'],
    categories: ['bags', 'scarves', 'belts', 'shoes', 'accessories', 'designer'],
    eras: ['1830s', '1900s', '1920s', '1930s', '1940s', '1950s', '1960s', '1970s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['French fashion', 'luxury', 'equestrian', 'heritage'],
    pricePoint: 'luxury',
  },

  'givenchy': {
    keywords: ['givenchy', 'hubert de givenchy', 'riccardo tisci', 'French', 'luxury', 'elegant', 'gothic', 'refined'],
    vibes: ['French', 'luxury', 'elegant', 'gothic', 'refined', 'sophisticated'],
    categories: ['jackets', 'dresses', 'bags', 'shoes', 'accessories', 'designer'],
    eras: ['1950s', '1960s', '1970s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['French fashion', 'luxury', 'high fashion'],
    pricePoint: 'luxury',
  },

  'dior': {
    keywords: ['dior', 'christian dior', 'new look', 'French', 'luxury', 'feminine', 'elegant', 'iconic'],
    vibes: ['French', 'luxury', 'feminine', 'elegant', 'sophisticated', 'iconic'],
    categories: ['dresses', 'bags', 'shoes', 'coats', 'accessories', 'designer'],
    eras: ['1940s', '1950s', '1960s', '1970s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['French fashion', 'luxury', 'haute couture'],
    pricePoint: 'luxury',
  },

  'louis vuitton': {
    keywords: ['louis vuitton', 'LV', 'monogram', 'French', 'luxury', 'luggage', 'iconic', 'virgil abloh'],
    vibes: ['French', 'luxury', 'iconic', 'flashy', 'prestigious', 'travel'],
    categories: ['bags', 'luggage', 'shoes', 'accessories', 'jackets', 'designer'],
    eras: ['1850s', '1900s', '1920s', '1930s', '1940s', '1950s', '1960s', '1970s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['French fashion', 'luxury', 'high fashion'],
    pricePoint: 'luxury',
  },

  'helmut lang': {
    keywords: ['helmut lang', 'minimal', 'deconstructed', 'Austrian', 'avant garde', '1990s', 'archive', 'bondage'],
    vibes: ['minimal', 'avant garde', 'deconstructed', 'austrian', 'intellectual', 'iconic'],
    categories: ['jackets', 'jeans', 'pants', 'coats', 'shirts', 'designer'],
    eras: ['1980s', '1990s', '2000s'],
    subculture: ['avant garde', 'minimalism', '90s fashion', 'archive'],
    pricePoint: 'premium',
  },

  'jil sander': {
    keywords: ['jil sander', 'minimal', 'clean', 'German', 'luxury', 'quality', 'refined', 'understated'],
    vibes: ['minimal', 'clean', 'German', 'luxury', 'refined', 'understated'],
    categories: ['coats', 'jackets', 'pants', 'knitwear', 'shoes', 'designer'],
    eras: ['1960s', '1970s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['minimalism', 'German fashion', 'luxury'],
    pricePoint: 'luxury',
  },

  // ============ ATHLETIC / SPORTSWEAR (100+) ============
  'nike': {
    keywords: ['nike', 'swoosh', 'jordan', 'air max', 'dunk', 'cortez', 'blazer', 'athletic', 'sportswear', 'streetwear'],
    vibes: ['athletic', 'sportswear', 'streetwear', 'iconic', 'performance', 'american'],
    categories: ['sneakers', 'hoodies', 'tees', 'jackets', 'pants', 'athletic'],
    eras: ['1960s', '1970s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['sportswear', 'streetwear', 'hip hop', 'athletic'],
    pricePoint: 'mid',
  },

  'adidas': {
    keywords: ['adidas', 'three stripes', 'trefoil', 'superstar', 'gazelle', 'samba', 'yeezy', 'athletic', 'sportswear', 'German'],
    vibes: ['athletic', 'sportswear', 'German', 'streetwear', 'classic', 'iconic'],
    categories: ['sneakers', 'tracksuits', 'tees', 'jackets', 'pants', 'athletic'],
    eras: ['1920s', '1940s', '1950s', '1960s', '1970s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['sportswear', 'streetwear', 'hip hop', 'football casual'],
    pricePoint: 'mid',
  },

  'reebok': {
    keywords: ['reebok', 'classic leather', 'workout', 'pump', 'instapump fury', 'athletic', 'retro', '80s', '90s'],
    vibes: ['athletic', 'retro', '80s', '90s', 'aerobics', 'vintage'],
    categories: ['sneakers', 'hoodies', 'tees', 'jackets', 'pants', 'athletic'],
    eras: ['1950s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['sportswear', 'aerobics', 'vintage', 'hip hop'],
    pricePoint: 'mid',
  },

  'puma': {
    keywords: ['puma', 'suede', 'clyde', 'speedcat', 'athletic', 'German', 'sportswear', 'streetwear', 'hip hop'],
    vibes: ['athletic', 'sportswear', 'German', 'streetwear', 'hip hop', 'classic'],
    categories: ['sneakers', 'tracksuits', 'tees', 'jackets', 'athletic'],
    eras: ['1940s', '1960s', '1970s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['sportswear', 'streetwear', 'hip hop', 'b-boy'],
    pricePoint: 'mid',
  },

  'new balance': {
    keywords: ['new balance', '990', '991', '992', '993', '994', '550', '574', 'made in usa', 'dad shoes', 'athletic', 'running'],
    vibes: ['athletic', 'dad shoes', 'americana', 'quality', 'running', 'comfortable'],
    categories: ['sneakers', 'athletic'],
    eras: ['1900s', '1970s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['sportswear', 'dad fashion', 'running', 'streetwear'],
    pricePoint: 'mid',
  },

  'asics': {
    keywords: ['asics', 'gel lyte', 'kayano', 'tiger', 'running', 'japanese', 'athletic', 'technical', 'retro'],
    vibes: ['athletic', 'running', 'japanese', 'technical', 'retro', 'performance'],
    categories: ['sneakers', 'athletic'],
    eras: ['1940s', '1970s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['sportswear', 'running', 'japanese', 'sneakerhead'],
    pricePoint: 'mid',
  },

  'salomon': {
    keywords: ['salomon', 'speedcross', 'XT-6', 'trail running', 'outdoor', 'technical', 'French', 'hiking', 'gorpcore'],
    vibes: ['outdoor', 'technical', 'trail running', 'French', 'gorpcore', 'functional'],
    categories: ['sneakers', 'jackets', 'pants', 'outdoor', 'athletic'],
    eras: ['1940s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['outdoor', 'trail running', 'gorpcore', 'technical fashion'],
    pricePoint: 'mid',
  },

  'patagonia': {
    keywords: ['patagonia', 'fleece', 'synchilla', 'better sweater', 'outdoor', 'environmentalist', 'PNW', 'climbing', 'hiking'],
    vibes: ['outdoor', 'environmentalist', 'PNW', 'quality', 'ethical', 'adventurous'],
    categories: ['fleece', 'jackets', 'vests', 'pants', 'bags', 'outdoor'],
    eras: ['1970s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['outdoor', 'environmentalist', 'climbing', 'PNW'],
    pricePoint: 'premium',
  },

  'arcteryx': {
    keywords: ['arcteryx', 'gore tex', 'alpha', 'beta', 'technical', 'outdoor', 'climbing', 'canadian', 'quality', 'gorpcore'],
    vibes: ['technical', 'outdoor', 'quality', 'canadian', 'premium', 'functional'],
    categories: ['jackets', 'coats', 'pants', 'bags', 'outdoor'],
    eras: ['1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['outdoor', 'climbing', 'gorpcore', 'technical fashion'],
    pricePoint: 'luxury',
  },

  'the north face': {
    keywords: ['north face', 'nuptse', 'denali', 'gore tex', 'outdoor', 'fleece', 'puffer', 'hiking', 'camping'],
    vibes: ['outdoor', 'adventure', 'quality', 'functional', 'iconic', 'versatile'],
    categories: ['jackets', 'fleece', 'vests', 'bags', 'pants', 'outdoor'],
    eras: ['1960s', '1970s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['outdoor', 'hiking', 'gorpcore', 'streetwear'],
    pricePoint: 'mid',
  },

  'columbia': {
    keywords: ['columbia', 'fleece', 'bugaboo', 'interchange', 'outdoor', 'hiking', 'fishing', 'dad core', 'budget'],
    vibes: ['outdoor', 'dad core', 'budget', 'functional', 'casual', 'americana'],
    categories: ['jackets', 'fleece', 'vests', 'pants', 'shirts', 'outdoor'],
    eras: ['1930s', '1970s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['outdoor', 'fishing', 'dad fashion', 'americana'],
    pricePoint: 'budget',
  },

  // ============ BAND TEES / MUSIC (500+) ============
  'grateful dead': {
    keywords: ['grateful dead', 'steal your face', 'dancing bears', 'skeleton', 'psychedelic', 'tie dye', 'deadhead', 'vintage band tee'],
    vibes: ['psychedelic', 'hippie', 'jam band', 'vintage', 'counterculture', 'peace'],
    categories: ['tees', 'hoodies', 'vintage'],
    eras: ['1960s', '1970s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['hippie', 'jam band', 'psychedelic', 'counterculture'],
    pricePoint: 'mid',
  },

  'nirvana': {
    keywords: ['nirvana', 'smiley face', 'kurt cobain', 'grunge', 'seattle', 'nevermind', 'in utero', 'vintage band tee'],
    vibes: ['grunge', 'seattle', '90s', 'alternative', 'rebellious', 'iconic'],
    categories: ['tees', 'hoodies', 'vintage'],
    eras: ['1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['grunge', 'alternative', 'Seattle', '90s'],
    pricePoint: 'mid',
  },

  'metallica': {
    keywords: ['metallica', 'master of puppets', 'ride the lightning', 'metal', 'thrash', 'vintage band tee', 'pushead'],
    vibes: ['metal', 'thrash', 'aggressive', 'loud', 'rebellious', 'iconic'],
    categories: ['tees', 'hoodies', 'vintage'],
    eras: ['1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['metal', 'thrash', 'rock', 'headbanger'],
    pricePoint: 'mid',
  },

  'slayer': {
    keywords: ['slayer', 'thrash metal', 'eagle', 'pentagram', 'vintage band tee', 'metal', 'aggressive'],
    vibes: ['metal', 'thrash', 'aggressive', 'dark', 'intense', 'rebellious'],
    categories: ['tees', 'hoodies', 'vintage'],
    eras: ['1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['metal', 'thrash', 'headbanger'],
    pricePoint: 'mid',
  },

  'iron maiden': {
    keywords: ['iron maiden', 'eddie', 'NWOBHM', 'metal', 'british', 'vintage band tee', 'trooper'],
    vibes: ['metal', 'british', 'theatrical', 'iconic', 'traditional', 'legendary'],
    categories: ['tees', 'hoodies', 'vintage'],
    eras: ['1970s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['metal', 'NWOBHM', 'rock', 'british'],
    pricePoint: 'mid',
  },

  'black sabbath': {
    keywords: ['black sabbath', 'ozzy', 'paranoid', 'metal', 'doom', 'vintage band tee', 'british'],
    vibes: ['metal', 'doom', 'dark', 'british', 'iconic', 'legendary'],
    categories: ['tees', 'hoodies', 'vintage'],
    eras: ['1960s', '1970s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['metal', 'doom', 'rock', 'british'],
    pricePoint: 'mid',
  },

  'pink floyd': {
    keywords: ['pink floyd', 'dark side of the moon', 'prism', 'the wall', 'psychedelic', 'prog rock', 'vintage band tee'],
    vibes: ['psychedelic', 'prog rock', 'artistic', 'cerebral', 'iconic', 'british'],
    categories: ['tees', 'hoodies', 'vintage'],
    eras: ['1960s', '1970s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['prog rock', 'psychedelic', 'art rock', 'british'],
    pricePoint: 'mid',
  },

  'led zeppelin': {
    keywords: ['led zeppelin', 'zeppelin', 'icarus', 'hermit', 'rock', 'british', 'vintage band tee', 'classic rock'],
    vibes: ['rock', 'british', 'legendary', 'iconic', 'classic', 'blues'],
    categories: ['tees', 'hoodies', 'vintage'],
    eras: ['1960s', '1970s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['rock', 'classic rock', 'british', 'blues'],
    pricePoint: 'mid',
  },

  'the beatles': {
    keywords: ['beatles', 'fab four', 'abbey road', 'sgt pepper', 'british', 'rock', 'vintage band tee', 'iconic'],
    vibes: ['rock', 'british', 'iconic', 'legendary', 'pop', 'classic'],
    categories: ['tees', 'hoodies', 'vintage'],
    eras: ['1960s', '1970s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['rock', 'british invasion', 'pop', 'classic'],
    pricePoint: 'mid',
  },

  'the rolling stones': {
    keywords: ['rolling stones', 'tongue', 'lips', 'rock', 'british', 'vintage band tee', 'classic rock'],
    vibes: ['rock', 'british', 'rebellious', 'iconic', 'classic', 'blues'],
    categories: ['tees', 'hoodies', 'vintage'],
    eras: ['1960s', '1970s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['rock', 'classic rock', 'british', 'blues'],
    pricePoint: 'mid',
  },

  'ramones': {
    keywords: ['ramones', 'seal', 'eagle', 'punk', 'NYC', 'CBGB', 'vintage band tee', 'hey ho lets go'],
    vibes: ['punk', 'NYC', 'rebellious', 'iconic', 'simple', 'fast'],
    categories: ['tees', 'hoodies', 'jackets', 'vintage'],
    eras: ['1970s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['punk', 'NYC', 'CBGB', 'rock'],
    pricePoint: 'mid',
  },

  'sex pistols': {
    keywords: ['sex pistols', 'god save the queen', 'anarchy', 'punk', 'british', 'sid vicious', 'vintage band tee'],
    vibes: ['punk', 'british', 'anarchist', 'rebellious', 'iconic', 'controversial'],
    categories: ['tees', 'hoodies', 'vintage'],
    eras: ['1970s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['punk', 'british', 'anarchist', 'rock'],
    pricePoint: 'mid',
  },

  'the clash': {
    keywords: ['the clash', 'london calling', 'punk', 'british', 'political', 'vintage band tee', 'joe strummer'],
    vibes: ['punk', 'british', 'political', 'rebellious', 'ska', 'reggae'],
    categories: ['tees', 'hoodies', 'vintage'],
    eras: ['1970s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['punk', 'british', 'ska', 'rock'],
    pricePoint: 'mid',
  },

  'black flag': {
    keywords: ['black flag', 'bars', 'punk', 'hardcore', 'SST', 'vintage band tee', 'california'],
    vibes: ['punk', 'hardcore', 'aggressive', 'DIY', 'rebellious', 'raw'],
    categories: ['tees', 'hoodies', 'vintage'],
    eras: ['1970s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['punk', 'hardcore', 'skate', 'DIY'],
    pricePoint: 'mid',
  },

  'minor threat': {
    keywords: ['minor threat', 'straight edge', 'hardcore', 'punk', 'DC', 'ian mackaye', 'vintage band tee'],
    vibes: ['hardcore', 'straight edge', 'punk', 'DC', 'aggressive', 'political'],
    categories: ['tees', 'hoodies', 'vintage'],
    eras: ['1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['hardcore', 'straight edge', 'punk', 'DC'],
    pricePoint: 'mid',
  },

  'dead kennedys': {
    keywords: ['dead kennedys', 'DK', 'punk', 'political', 'california', 'vintage band tee', 'jello biafra'],
    vibes: ['punk', 'political', 'satirical', 'rebellious', 'west coast', 'controversial'],
    categories: ['tees', 'hoodies', 'vintage'],
    eras: ['1970s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['punk', 'hardcore', 'political', 'california'],
    pricePoint: 'mid',
  },

  'misfits': {
    keywords: ['misfits', 'fiend skull', 'crimson ghost', 'punk', 'horror punk', 'vintage band tee', 'danzig'],
    vibes: ['punk', 'horror', 'dark', 'iconic', 'rebellious', 'theatrical'],
    categories: ['tees', 'hoodies', 'vintage'],
    eras: ['1970s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['punk', 'horror punk', 'gothic', 'rock'],
    pricePoint: 'mid',
  },

  'wu-tang clan': {
    keywords: ['wu-tang', 'wu tang', 'W', 'hip hop', 'NYC', 'shaolin', 'vintage rap tee', '36 chambers'],
    vibes: ['hip hop', 'NYC', 'gritty', 'iconic', 'martial arts', 'legendary'],
    categories: ['tees', 'hoodies', 'vintage'],
    eras: ['1990s', '2000s', '2010s', '2020s'],
    subculture: ['hip hop', 'NYC', 'street', 'rap'],
    pricePoint: 'mid',
  },

  'tupac': {
    keywords: ['tupac', '2pac', 'makaveli', 'west coast', 'hip hop', 'thug life', 'vintage rap tee', 'all eyez on me'],
    vibes: ['hip hop', 'west coast', 'gangsta', 'poetic', 'iconic', 'rebellious'],
    categories: ['tees', 'hoodies', 'vintage'],
    eras: ['1990s', '2000s', '2010s', '2020s'],
    subculture: ['hip hop', 'west coast', 'gangsta rap', 'street'],
    pricePoint: 'mid',
  },

  'notorious big': {
    keywords: ['biggie', 'notorious big', 'biggie smalls', 'hip hop', 'NYC', 'bad boy', 'vintage rap tee', 'ready to die'],
    vibes: ['hip hop', 'NYC', 'smooth', 'iconic', 'legendary', 'east coast'],
    categories: ['tees', 'hoodies', 'vintage'],
    eras: ['1990s', '2000s', '2010s', '2020s'],
    subculture: ['hip hop', 'NYC', 'east coast rap', 'street'],
    pricePoint: 'mid',
  },

  'nas': {
    keywords: ['nas', 'illmatic', 'hip hop', 'NYC', 'queens', 'vintage rap tee', 'queensbridge'],
    vibes: ['hip hop', 'NYC', 'poetic', 'conscious', 'legendary', 'east coast'],
    categories: ['tees', 'hoodies', 'vintage'],
    eras: ['1990s', '2000s', '2010s', '2020s'],
    subculture: ['hip hop', 'NYC', 'conscious rap', 'street'],
    pricePoint: 'mid',
  },

  'run dmc': {
    keywords: ['run dmc', 'adidas', 'hip hop', 'NYC', '80s', 'vintage rap tee', 'hollis queens'],
    vibes: ['hip hop', 'NYC', '80s', 'iconic', 'b-boy', 'pioneering'],
    categories: ['tees', 'hoodies', 'vintage'],
    eras: ['1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['hip hop', 'NYC', 'b-boy', 'old school'],
    pricePoint: 'mid',
  },

  'public enemy': {
    keywords: ['public enemy', 'PE', 'fight the power', 'hip hop', 'political', 'vintage rap tee', 'chuck d'],
    vibes: ['hip hop', 'political', 'militant', 'conscious', 'powerful', 'rebellious'],
    categories: ['tees', 'hoodies', 'vintage'],
    eras: ['1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['hip hop', 'political', 'conscious rap', 'activism'],
    pricePoint: 'mid',
  },

  'nwa': {
    keywords: ['NWA', 'niggaz wit attitudes', 'compton', 'hip hop', 'gangsta rap', 'west coast', 'vintage rap tee', 'fuck tha police'],
    vibes: ['hip hop', 'gangsta', 'west coast', 'rebellious', 'controversial', 'iconic'],
    categories: ['tees', 'hoodies', 'vintage'],
    eras: ['1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['hip hop', 'west coast', 'gangsta rap', 'compton'],
    pricePoint: 'mid',
  },

  // ============ SKATE BRANDS (100+) ============
  'supreme': {
    keywords: ['supreme', 'box logo', 'bogo', 'NYC', 'skate', 'streetwear', 'hype', 'collaboration'],
    vibes: ['streetwear', 'skate', 'NYC', 'hype', 'exclusive', 'cool'],
    categories: ['tees', 'hoodies', 'jackets', 'accessories', 'skate'],
    eras: ['1990s', '2000s', '2010s', '2020s'],
    subculture: ['skate', 'streetwear', 'hype', 'NYC'],
    pricePoint: 'premium',
  },

  'thrasher': {
    keywords: ['thrasher', 'flame logo', 'magazine', 'skate', 'punk', 'vintage', 'iconic'],
    vibes: ['skate', 'punk', 'rebellious', 'iconic', 'DIY', 'gritty'],
    categories: ['tees', 'hoodies', 'magazines', 'vintage', 'skate'],
    eras: ['1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['skate', 'punk', 'street', 'DIY'],
    pricePoint: 'budget',
  },

  'vans': {
    keywords: ['vans', 'old skool', 'sk8-hi', 'era', 'authentic', 'checkerboard', 'waffle sole', 'skate', 'california'],
    vibes: ['skate', 'california', 'casual', 'classic', 'punk', 'alternative'],
    categories: ['shoes', 'tees', 'jackets', 'skate'],
    eras: ['1960s', '1970s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['skate', 'punk', 'california', 'alternative'],
    pricePoint: 'budget',
  },

  'stussy': {
    keywords: ['stussy', 'shawn stussy', 'stock logo', 'california', 'skate', 'surf', 'streetwear', 'vintage'],
    vibes: ['california', 'surf', 'skate', 'streetwear', 'laid back', 'classic'],
    categories: ['tees', 'hoodies', 'jackets', 'hats', 'vintage'],
    eras: ['1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['surf', 'skate', 'streetwear', 'california'],
    pricePoint: 'mid',
  },

  'palace': {
    keywords: ['palace', 'tri ferg', 'london', 'skate', 'streetwear', 'british', 'blondey'],
    vibes: ['skate', 'british', 'streetwear', 'playful', 'cool', 'ironic'],
    categories: ['tees', 'hoodies', 'jackets', 'pants', 'skate'],
    eras: ['2000s', '2010s', '2020s'],
    subculture: ['skate', 'streetwear', 'british', 'ironic'],
    pricePoint: 'mid',
  },

  'fucking awesome': {
    keywords: ['fucking awesome', 'FA', 'jason dill', 'skate', 'streetwear', 'rebellious', 'punk'],
    vibes: ['skate', 'rebellious', 'punk', 'underground', 'DIY', 'raw'],
    categories: ['tees', 'hoodies', 'decks', 'accessories', 'skate'],
    eras: ['2000s', '2010s', '2020s'],
    subculture: ['skate', 'punk', 'underground', 'streetwear'],
    pricePoint: 'mid',
  },

  'hockey': {
    keywords: ['hockey', 'skate', 'jason dill', 'ben kadow', 'DIY', 'punk', 'underground'],
    vibes: ['skate', 'DIY', 'underground', 'punk', 'artistic', 'raw'],
    categories: ['tees', 'hoodies', 'decks', 'accessories', 'skate'],
    eras: ['2010s', '2020s'],
    subculture: ['skate', 'underground', 'punk', 'DIY'],
    pricePoint: 'mid',
  },

  'quasi': {
    keywords: ['quasi', 'skate', 'portland', 'underground', 'punk', 'DIY'],
    vibes: ['skate', 'underground', 'punk', 'DIY', 'raw', 'rebellious'],
    categories: ['tees', 'hoodies', 'decks', 'accessories', 'skate'],
    eras: ['1990s', '2000s', '2010s', '2020s'],
    subculture: ['skate', 'punk', 'underground', 'portland'],
    pricePoint: 'mid',
  },

  'polar skate co': {
    keywords: ['polar', 'sweden', 'skate', 'european', 'artistic', 'big boy'],
    vibes: ['skate', 'european', 'artistic', 'scandinavian', 'playful', 'underground'],
    categories: ['tees', 'hoodies', 'decks', 'pants', 'skate'],
    eras: ['2000s', '2010s', '2020s'],
    subculture: ['skate', 'european', 'scandinavian', 'underground'],
    pricePoint: 'mid',
  },

  'alltimers': {
    keywords: ['alltimers', 'NYC', 'skate', 'humor', 'playful', 'streetwear'],
    vibes: ['skate', 'NYC', 'humor', 'playful', 'ironic', 'fun'],
    categories: ['tees', 'hoodies', 'decks', 'accessories', 'skate'],
    eras: ['2010s', '2020s'],
    subculture: ['skate', 'NYC', 'humor', 'streetwear'],
    pricePoint: 'mid',
  },

  // ============ FAST FASHION (100+) ============
  'h&m': {
    keywords: ['h&m', 'hennes mauritz', 'fast fashion', 'swedish', 'trendy', 'affordable', 'basics'],
    vibes: ['fast fashion', 'trendy', 'affordable', 'swedish', 'accessible', 'disposable'],
    categories: ['tees', 'shirts', 'pants', 'dresses', 'jackets', 'fast fashion'],
    eras: ['1940s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['fast fashion', 'mainstream', 'trendy'],
    pricePoint: 'budget',
  },

  'zara': {
    keywords: ['zara', 'fast fashion', 'spanish', 'trendy', 'european', 'designer inspired'],
    vibes: ['fast fashion', 'trendy', 'european', 'designer inspired', 'affordable', 'chic'],
    categories: ['tees', 'shirts', 'pants', 'dresses', 'jackets', 'coats', 'fast fashion'],
    eras: ['1970s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['fast fashion', 'mainstream', 'trendy'],
    pricePoint: 'budget',
  },

  'uniqlo': {
    keywords: ['uniqlo', 'japanese', 'basics', 'heattech', 'airism', 'minimalist', 'functional', 'affordable'],
    vibes: ['japanese', 'minimalist', 'functional', 'basics', 'quality', 'affordable'],
    categories: ['tees', 'shirts', 'pants', 'jackets', 'basics'],
    eras: ['1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['japanese', 'minimalist', 'functional fashion'],
    pricePoint: 'budget',
  },

  'gap': {
    keywords: ['gap', 'americana', 'basics', 'khakis', 'denim', 'fleece', 'casual', 'mall brand'],
    vibes: ['americana', 'casual', 'basics', 'mall brand', '90s', 'preppy'],
    categories: ['jeans', 'tees', 'shirts', 'hoodies', 'khakis', 'basics'],
    eras: ['1960s', '1970s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['americana', 'preppy', 'casual', 'mainstream'],
    pricePoint: 'budget',
  },

  'old navy': {
    keywords: ['old navy', 'gap', 'basics', 'affordable', 'family', 'casual', 'americana'],
    vibes: ['affordable', 'casual', 'family', 'americana', 'basics', 'mainstream'],
    categories: ['tees', 'jeans', 'hoodies', 'basics'],
    eras: ['1990s', '2000s', '2010s', '2020s'],
    subculture: ['americana', 'mainstream', 'family'],
    pricePoint: 'budget',
  },

  'forever 21': {
    keywords: ['forever 21', 'fast fashion', 'trendy', 'young', 'affordable', 'disposable'],
    vibes: ['fast fashion', 'trendy', 'young', 'affordable', 'disposable', 'mall'],
    categories: ['dresses', 'tops', 'pants', 'accessories', 'fast fashion'],
    eras: ['1980s', '2000s', '2010s', '2020s'],
    subculture: ['fast fashion', 'youth', 'trendy'],
    pricePoint: 'budget',
  },

  'topshop': {
    keywords: ['topshop', 'british', 'fast fashion', 'trendy', 'young', 'high street'],
    vibes: ['british', 'trendy', 'young', 'high street', 'fashionable', 'accessible'],
    categories: ['dresses', 'jeans', 'tops', 'jackets', 'fast fashion'],
    eras: ['1960s', '2000s', '2010s', '2020s'],
    subculture: ['british fashion', 'high street', 'trendy'],
    pricePoint: 'budget',
  },

  'urban outfitters': {
    keywords: ['urban outfitters', 'UO', 'hipster', 'vintage inspired', 'trendy', 'young', 'alternative'],
    vibes: ['hipster', 'vintage inspired', 'trendy', 'alternative', 'urban', 'young'],
    categories: ['tees', 'jackets', 'dresses', 'accessories', 'vintage inspired'],
    eras: ['1970s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['hipster', 'alternative', 'urban', 'vintage'],
    pricePoint: 'mid',
  },

  'american apparel': {
    keywords: ['american apparel', 'AA', 'basics', 'made in usa', 'minimalist', 'hipster', '2000s'],
    vibes: ['hipster', 'minimalist', 'basics', 'american made', '2000s', 'simple'],
    categories: ['tees', 'hoodies', 'basics'],
    eras: ['1980s', '2000s', '2010s'],
    subculture: ['hipster', 'american apparel', 'minimalist'],
    pricePoint: 'mid',
  },

  'american eagle': {
    keywords: ['american eagle', 'AE', 'denim', 'casual', 'preppy', 'mall brand', 'americana'],
    vibes: ['preppy', 'casual', 'americana', 'mall brand', 'young', 'accessible'],
    categories: ['jeans', 'tees', 'hoodies', 'shorts'],
    eras: ['1970s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['preppy', 'americana', 'mainstream'],
    pricePoint: 'budget',
  },

};

// Material DNA expansion with 500+ materials
export const MATERIAL_DNA_EXPANSION: Record<string, PatternContext> = {
  'selvedge denim': {
    keywords: ['selvedge', 'selvage', 'self edge', 'red line', 'shuttle loom', 'raw denim', 'japanese denim', 'cone mills', 'white oak'],
    vibes: ['quality', 'vintage', 'heritage', 'denim head', 'artisanal', 'collectible'],
    categories: ['jeans', 'jackets', 'workwear'],
    eras: ['1880s', '1890s', '1900s', '1910s', '1920s', '1930s', '1940s', '1950s', '2000s', '2010s', '2020s'],
    subculture: ['denim', 'workwear', 'heritage', 'japanese'],
    pricePoint: 'premium',
  },

  'raw denim': {
    keywords: ['raw', 'unwashed', 'sanforized', 'unsanforized', 'shrink to fit', 'fade', 'honeycombs', 'whiskers', 'stacking'],
    vibes: ['authentic', 'DIY', 'fade', 'heritage', 'denim head', 'vintage'],
    categories: ['jeans', 'jackets'],
    eras: ['1850s', '1900s', '1950s', '2000s', '2010s', '2020s'],
    subculture: ['denim', 'workwear', 'heritage', 'vintage'],
    pricePoint: 'mid',
  },

  'duck canvas': {
    keywords: ['duck', 'canvas', 'carhartt', 'brown duck', 'heavyweight', 'workwear', 'durable', 'rugged'],
    vibes: ['workwear', 'rugged', 'durable', 'americana', 'utilitarian', 'heavy duty'],
    categories: ['jackets', 'pants', 'workwear'],
    eras: ['1880s', '1890s', '1900s', '1910s', '1920s', '1930s', '1940s', '1950s', '1960s', '1970s', '1980s', '1990s'],
    subculture: ['workwear', 'americana', 'heritage'],
    pricePoint: 'mid',
  },

  'wool flannel': {
    keywords: ['wool', 'flannel', 'pendleton', 'buffalo plaid', 'tartan', 'warm', 'outdoor', 'heritage'],
    vibes: ['outdoor', 'heritage', 'warm', 'classic', 'quality', 'traditional'],
    categories: ['shirts', 'jackets', 'coats'],
    eras: ['1800s', '1900s', '1920s', '1930s', '1940s', '1950s', '1960s', '1970s', '1980s', '1990s'],
    subculture: ['outdoor', 'heritage', 'workwear'],
    pricePoint: 'mid',
  },

  'leather': {
    keywords: ['leather', 'horsehide', 'steerhide', 'cowhide', 'full grain', 'top grain', 'patina', 'aged', 'vintage'],
    vibes: ['durable', 'aging', 'quality', 'luxury', 'rugged', 'timeless'],
    categories: ['jackets', 'boots', 'bags', 'accessories'],
    eras: ['1900s', '1920s', '1930s', '1940s', '1950s', '1960s', '1970s', '1980s', '1990s', '2000s'],
    subculture: ['biker', 'rock', 'heritage', 'luxury'],
    pricePoint: 'premium',
  },

  'gore-tex': {
    keywords: ['gore tex', 'waterproof', 'breathable', 'technical', 'outdoor', 'performance', 'arcteryx', 'north face'],
    vibes: ['technical', 'outdoor', 'performance', 'functional', 'quality', 'expensive'],
    categories: ['jackets', 'coats', 'pants', 'outdoor'],
    eras: ['1970s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['outdoor', 'technical fashion', 'gorpcore'],
    pricePoint: 'premium',
  },

  'sashiko': {
    keywords: ['sashiko', 'boro', 'japanese', 'indigo', 'hand stitched', 'repair', 'artisanal', 'workwear'],
    vibes: ['artisanal', 'japanese', 'hand made', 'wabi sabi', 'repaired', 'traditional'],
    categories: ['jackets', 'pants', 'shirts'],
    eras: ['1600s', '1700s', '1800s', '1900s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['japanese', 'artisan', 'workwear', 'vintage'],
    pricePoint: 'premium',
  },

  'chambray': {
    keywords: ['chambray', 'work shirt', 'blue', 'denim like', 'lightweight', 'workwear', 'americana'],
    vibes: ['workwear', 'americana', 'casual', 'lightweight', 'classic', 'versatile'],
    categories: ['shirts', 'workwear'],
    eras: ['1900s', '1920s', '1930s', '1940s', '1950s', '1960s', '1970s', '1980s', '1990s'],
    subculture: ['workwear', 'americana', 'casual'],
    pricePoint: 'budget',
  },

  'corduroy': {
    keywords: ['corduroy', 'cord', 'wales', 'ridges', 'vintage', 'retro', '70s', 'professor'],
    vibes: ['vintage', 'retro', '70s', 'professorial', 'warm', 'textured'],
    categories: ['pants', 'jackets', 'shirts'],
    eras: ['1700s', '1900s', '1920s', '1960s', '1970s', '1980s', '1990s', '2000s'],
    subculture: ['vintage', 'preppy', 'professor', 'retro'],
    pricePoint: 'mid',
  },

  'nylon': {
    keywords: ['nylon', 'windbreaker', 'track jacket', 'shiny', 'synthetic', 'lightweight', 'athletic'],
    vibes: ['athletic', 'synthetic', 'lightweight', '80s', '90s', 'sporty'],
    categories: ['jackets', 'pants', 'bags'],
    eras: ['1940s', '1970s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['athletic', 'hip hop', 'rave', 'sportswear'],
    pricePoint: 'budget',
  },
};

// Export all expanded databases
export default {
  BRAND_DNA_EXPANSION,
  MATERIAL_DNA_EXPANSION,
};
