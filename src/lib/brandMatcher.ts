// ============================================================================
// INTELLIGENT BRAND & MODEL MATCHER
// Matches voice descriptions to extended category system and model database
// ============================================================================

import { MODEL_DATABASE, type BrandCategory } from './brandCategorySystem';
import { BRAND_DNA_EXPANSION } from './vintagePatternExpansion';
import { BRAND_DNA_EXPANSION_2 } from './vintagePatternExpansion2';

export interface MatchResult {
  brand?: string;
  modelName?: string;
  modelNumber?: string;
  brandCategory?: BrandCategory;
  subcultures?: string[];
  confidence: number; // 0-1 scale
  priceRange?: [number, number];
  collectibility?: number;
  eras?: string[];
}

// Combine all brand databases
const ALL_BRANDS = {
  ...BRAND_DNA_EXPANSION,
  ...BRAND_DNA_EXPANSION_2,
};

// ============================================================================
// BRAND MATCHING
// ============================================================================

export function matchBrand(voiceDescription: string): MatchResult | null {
  const lowerDesc = voiceDescription.toLowerCase();
  
  // Check MODEL_DATABASE first for specific models
  for (const [, modelData] of Object.entries(MODEL_DATABASE)) {
    // Check if any keyword matches
    const matchesKeyword = modelData.keywords.some(keyword => 
      lowerDesc.includes(keyword.toLowerCase())
    );
    
    // Check model number
    const matchesModelNumber = modelData.modelNumber && 
      lowerDesc.includes(modelData.modelNumber.toLowerCase());
    
    // Check brand name
    const matchesBrand = lowerDesc.includes(modelData.brand.toLowerCase());
    
    if (matchesKeyword || matchesModelNumber || (matchesBrand && matchesKeyword)) {
      return {
        brand: modelData.brand,
        modelName: modelData.modelName,
        modelNumber: modelData.modelNumber,
        brandCategory: modelData.category,
        confidence: matchesKeyword && matchesBrand ? 0.95 : 
                   matchesModelNumber ? 0.9 : 
                   matchesKeyword ? 0.8 : 0.7,
        priceRange: modelData.priceRange,
        collectibility: modelData.collectibility,
      };
    }
  }
  
  // Check ALL_BRANDS database for general brand matches
  for (const [brandKey, brandData] of Object.entries(ALL_BRANDS)) {
    const matchesKeyword = brandData.keywords.some(keyword =>
      lowerDesc.includes(keyword.toLowerCase())
    );
    
    if (matchesKeyword) {
      return {
        brand: brandKey.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
        confidence: 0.75,
        subcultures: brandData.subculture,
        eras: brandData.eras,
      };
    }
  }
  
  return null;
}

// ============================================================================
// CATEGORY DETECTION
// ============================================================================

const CATEGORY_KEYWORDS: Record<BrandCategory, string[]> = {
  // DENIM
  'heritage-denim': ['levi', 'lee', 'wrangler', '501', '505', 'jeans', 'denim', 'selvage', 'selvedge'],
  'japanese-denim': ['momotaro', 'iron heart', 'pure blue japan', 'oni', 'samurai', 'japan', 'japanese denim'],
  'designer-denim': ['apc', 'acne', 'nudie', 'designer jeans', 'petit standard'],
  'raw-selvedge': ['raw denim', 'selvedge', 'selvage', 'unwashed', '3sixteen', 'naked famous'],
  'reproductions-vintage': ['rrl', 'real mccoys', 'buzz rickson', 'reproduction', 'vintage repro'],
  'stretch-performance': ['lululemon', 'abc', 'outlier', 'stretch', 'performance denim'],
  
  // WORKWEAR
  'workwear-heritage': ['carhartt', 'dickies', 'red kap', 'work', 'detroit jacket', '874'],
  'workwear-japanese': ['kapital', 'needles', 'engineered garments', 'japanese workwear'],
  'workwear-french': ['vetra', 'le laboureur', 'french workwear', 'chore coat'],
  'safety-industrial': ['hi vis', 'high visibility', 'safety', 'construction', 'duluth'],
  'construction-hi-vis': ['hi vis', 'high vis', 'reflective', 'safety vest', 'construction'],
  
  // MILITARY
  'military-surplus': ['alpha industries', 'ma-1', 'm65', 'bdu', 'military', 'surplus'],
  'military-vintage': ['vietnam', 'korean war', 'wwii', 'vintage military', 'army surplus'],
  'tactical-modern': ['5.11', 'tactical', 'crye', 'modern tactical', 'operator'],
  'camo-hunting': ['realtree', 'mossy oak', 'camo', 'camouflage', 'hunting', 'sitka'],
  
  // OUTDOOR
  'outdoor-technical': ['arcteryx', 'patagonia', 'north face', 'gore-tex', 'technical', 'outdoor'],
  'mountaineering-alpine': ['mountain hardwear', 'black diamond', 'mammut', 'alpine', 'climbing'],
  'hiking-trail': ['salomon', 'merrell', 'hiking', 'trail', 'backpacking'],
  'camping-bushcraft': ['fjallraven', 'camping', 'bushcraft', 'helly hansen'],
  'fishing-marine': ['columbia pfg', 'fishing', 'marine', 'baggies', 'guy harvey'],
  'cycling-performance': ['rapha', 'castelli', 'cycling', 'bike', 'road bike'],
  'skiing-snowboard': ['burton', 'volcom', 'ski', 'snowboard', 'winter sports'],
  
  // STREETWEAR
  'streetwear-brands': ['supreme', 'stussy', 'bape', 'box logo', 'streetwear'],
  'streetwear-korean': ['ader error', 'andersson bell', 'korean', 'we11done'],
  'streetwear-japanese': ['neighborhood', 'wtaps', 'fragment', 'japanese streetwear'],
  'streetwear-european': ['palace', 'carhartt wip', 'stone island', 'european streetwear'],
  'hype-limited': ['off white', 'fear of god', 'essentials', 'hype', 'limited'],
  'graphic-tees': ['online ceramics', 'brain dead', 'graphic tee', 'art tee'],
  
  // SKATE
  'skate-brands': ['palace', 'thrasher', 'independent', 'skate'],
  'skate-heritage': ['santa cruz', 'powell peralta', 'vision', 'vintage skate'],
  'skate-contemporary': ['fucking awesome', 'hockey', 'quasi', 'modern skate'],
  'skate-shoes': ['nike sb', 'vans', 'dc shoes', 'skate shoes', 'dunk'],
  
  // LUXURY
  'luxury-fashion': ['gucci', 'louis vuitton', 'prada', 'luxury', 'designer'],
  'luxury-italian': ['loro piana', 'brunello cucinelli', 'kiton', 'italian luxury'],
  'luxury-french': ['hermes', 'dior', 'saint laurent', 'ysl', 'french luxury'],
  'designer-contemporary': ['comme des garcons', 'yohji', 'rick owens', 'cdg'],
  'designer-avant-garde': ['margiela', 'ann demeulemeester', 'raf simons', 'avant garde'],
  'designer-streetwear': ['balenciaga', 'vetements', 'givenchy', 'designer street'],
  'designer-minimalist': ['jil sander', 'the row', 'lemaire', 'minimalist'],
  
  // ATHLETIC
  'performance-running': ['pegasus', 'asics gel', 'brooks', 'running shoes', 'runner'],
  'performance-basketball': ['jordan', 'lebron', 'kobe', 'basketball', 'hoops'],
  'performance-football': ['vapor', 'mercurial', 'predator', 'cleats', 'football'],
  'performance-training': ['metcon', 'nano', 'training', 'crossfit', 'gym'],
  'performance-soccer': ['mercurial', 'predator', 'soccer', 'football boots'],
  'performance-baseball': ['baseball', 'cleats', 'diamond', 'mlb gear'],
  'athleisure': ['lululemon', 'athleta', 'athleisure', 'yoga pants', 'leggings'],
  'yoga-pilates': ['alo yoga', 'yoga', 'pilates', 'meditation', 'wellness'],
  
  // SNEAKERS
  'lifestyle-sneakers': ['air force 1', 'stan smith', 'old skool', 'casual sneakers'],
  'retro-runners': ['air max', '990', 'gel lyte', 'retro runner', 'dad shoe'],
  'dad-shoes': ['monarch', '624', 'dad shoe', 'chunky', 'new balance dad'],
  'luxury-sneakers': ['common projects', 'golden goose', 'luxury sneakers', 'achilles'],
  'basketball-retro': ['jordan retro', 'foamposite', 'uptempo', 'retro basketball'],
  'chunky-sneakers': ['triple s', 'yeezy 700', 'fila disruptor', 'chunky'],
  'minimalist-sneakers': ['allbirds', 'atoms', 'vessi', 'minimalist'],
  'skate-vulc': ['vans authentic', 'chuck taylor', 'converse', 'vulcanized'],
  
  // FOOTWEAR
  'heritage-boots': ['red wing', 'wolverine', 'iron ranger', '1000 mile', 'heritage boot'],
  'work-boots': ['timberland pro', 'steel toe', 'work boot', 'construction boot'],
  'western-boots': ['lucchese', 'tony lama', 'cowboy boots', 'western', 'ariat'],
  'motorcycle-boots': ['frye', 'engineer boot', 'harness', 'motorcycle', 'biker boot'],
  'hiking-boots': ['danner', 'vasque', 'hiking boot', 'trail boot', 'backpacking'],
  'chelsea-boots': ['blundstone', 'rm williams', 'chelsea', 'elastic sided'],
  'combat-boots': ['doc martens', 'dr martens', '1460', 'combat', 'military boot'],
  'dress-shoes': ['allen edmonds', 'church', 'dress shoe', 'oxford', 'formal'],
  'loafers-moccasins': ['alden', 'penny loafer', 'moccasin', 'quoddy', 'loafer'],
  'boat-shoes': ['sperry', 'boat shoe', 'deck shoe', 'top-sider'],
  'sandals-slides': ['birkenstock', 'sandal', 'slide', 'arizona', 'teva'],
  'espadrilles': ['espadrille', 'soludos', 'castaner', 'rope sole'],
  
  // JERSEYS
  'nfl-jerseys': ['nfl', 'football jersey', 'game jersey', 'limited', 'elite'],
  'nba-jerseys': ['nba', 'basketball jersey', 'swingman', 'city edition'],
  'mlb-jerseys': ['mlb', 'baseball jersey', 'cool base', 'replica'],
  'nhl-jerseys': ['nhl', 'hockey jersey', 'premier', 'reverse retro'],
  'soccer-jerseys': ['soccer jersey', 'football kit', 'home', 'away', 'third kit'],
  'ncaa-apparel': ['ncaa', 'college', 'university', 'collegiate'],
  'international-soccer': ['world cup', 'national team', 'euro', 'international'],
  'minor-league': ['minor league', 'milb', 'g-league', 'ahl'],
  'team-snapbacks': ['new era', '59fifty', 'snapback', 'fitted cap'],
  'vintage-starter': ['starter', 'apex one', 'pro line', 'vintage jacket'],
  'vintage-logo-athletic': ['logo athletic', 'satin jacket', '90s nba'],
  'vintage-champion': ['champion', 'reverse weave', 'vintage champion'],
  
  // BAND MERCH
  'band-tees-rock': ['rock band', 'concert tee', 'tour shirt', 'band tee'],
  'band-tees-rap': ['rap tee', 'hip hop', 'tour merch', 'rapper'],
  'band-tees-punk': ['punk', 'hardcore', 'diy', 'punk rock'],
  'band-tees-metal': ['metal', 'death metal', 'black metal', 'heavy metal'],
  'band-tees-electronic': ['edm', 'techno', 'rave', 'electronic'],
  'band-tees-country': ['country', 'folk', 'americana music'],
  'band-tees-indie': ['indie', 'indie rock', 'alternative'],
  'tour-merch': ['tour dates', 'tour shirt', 'concert', 'venue'],
  'bootleg-merch': ['bootleg', 'unofficial', 'vintage bootleg'],
  'festival-merch': ['coachella', 'bonnaroo', 'festival', 'lollapalooza'],
  'skateboard-band': ['thrasher', 'skate band', 'toy machine'],
  
  // BAGS
  'luxury-bags': ['lv', 'gucci bag', 'hermes', 'designer bag', 'luxury bag'],
  'technical-bags': ['arcteryx bag', 'technical bag', 'outdoor bag'],
  'streetwear-bags': ['supreme bag', 'palace bag', 'streetwear accessory'],
  'vintage-bags': ['coach', 'dooney bourke', 'vintage bag', 'legacy'],
  'messenger-bags': ['timbuk2', 'chrome', 'messenger', 'courier bag'],
  'backpacks-tactical': ['mystery ranch', 'goruck', 'tactical backpack'],
  'camera-bags': ['peak design', 'camera bag', 'billingham', 'photography'],
  'tote-canvas': ['ll bean', 'boat tote', 'canvas tote', 'tote bag'],
  
  // OUTERWEAR
  'bomber-jackets': ['bomber', 'flight jacket', 'ma-1', 'souvenir jacket'],
  'varsity-jackets': ['varsity', 'letterman', 'delong', 'holloway'],
  'leather-jackets': ['leather jacket', 'perfecto', 'schott', 'motorcycle jacket'],
  'denim-jackets': ['denim jacket', 'trucker', 'jean jacket', 'type 3'],
  'puffer-jackets': ['puffer', 'down jacket', 'nuptse', 'moncler'],
  'fleece-technical': ['fleece', 'synchilla', 'retro-x', 'patagonia fleece'],
  'windbreakers': ['windbreaker', 'nylon jacket', 'pullover', 'half zip'],
  'parkas-shells': ['parka', 'shell', 'waterproof', 'rain jacket'],
  'chore-coats': ['chore coat', 'work jacket', 'french workwear'],
  'coach-jackets': ['coach jacket', 'coaches jacket', 'nylon coach'],
  'blazers-sport-coats': ['blazer', 'sport coat', 'suit jacket', 'tailored'],
  'peacoats-overcoats': ['peacoat', 'overcoat', 'wool coat', 'naval'],
  'trench-coats': ['trench', 'burberry', 'rain coat', 'trench coat'],
  'shackets-overshirts': ['shacket', 'overshirt', 'shirt jacket', 'cpo'],
  'harrington-jackets': ['harrington', 'baracuta', 'g9', 'mod jacket'],
  'safari-field-jackets': ['safari', 'field jacket', 'm65', 'utility'],
  'track-jackets': ['track jacket', 'firebird', 'track top', 'athletic jacket'],
  
  // APPAREL
  'graphic-tees-vintage': ['vintage tee', 'single stitch', '80s tee', '90s tee'],
  'souvenir-tees': ['souvenir', 'tourist tee', 'vacation shirt'],
  'corporate-promo': ['promo tee', 'corporate', 'company shirt', 'convention'],
  'hawaiian-shirts': ['hawaiian', 'aloha', 'sun surf', 'rayon shirt'],
  'bowling-shirts': ['bowling shirt', 'hilton', 'panel shirt', 'retro bowling'],
  'western-shirts': ['western shirt', 'pearl snap', 'rockmount', 'cowboy shirt'],
  'flannel-shirts': ['flannel', 'plaid', 'pendleton', 'woolrich'],
  'oxford-button-downs': ['ocbd', 'oxford', 'button down', 'brooks brothers'],
  'chambray-work-shirts': ['chambray', 'work shirt', 'blue chambray'],
  'rugby-shirts': ['rugby', 'striped rugby', 'ralph lauren rugby'],
  'henley-shirts': ['henley', 'waffle', 'thermal'],
  'polo-shirts': ['polo', 'lacoste', 'fred perry', 'pique'],
  'mock-neck-turtleneck': ['mock neck', 'turtleneck', '90s minimalist'],
  'hoodies-sweatshirts': ['hoodie', 'sweatshirt', 'crewneck', 'pullover'],
  'varsity-letterman': ['letterman sweater', 'varsity sweater', 'athletic sweater'],
  'cardigan-sweaters': ['cardigan', 'sweater', 'knit cardigan'],
  'fisherman-knits': ['fisherman', 'aran', 'cable knit', 'irish sweater'],
  'fair-isle-nordic': ['fair isle', 'nordic', 'scandinavian', 'vintage pattern'],
  'cargo-pants': ['cargo', 'cargo pants', 'utility pants', 'pockets'],
  'painter-pants': ['painter pants', 'painter', 'dickies painter'],
  'corduroy-pants': ['corduroy', 'cord', 'wide wale', 'cords'],
  'chino-pants': ['chino', 'khaki', 'dress pants', 'trousers'],
  'sweatpants-joggers': ['sweatpants', 'joggers', 'track pants', 'athletic pants'],
  'shorts-vintage': ['shorts', 'baggies', 'vintage shorts', 'athletic shorts'],
  'overalls-coveralls': ['overalls', 'coveralls', 'hickory stripe', 'denim overalls'],
  
  // SUBCULTURE
  'punk-diy': ['punk', 'diy', 'studded', 'patches', 'safety pins'],
  'goth-alternative': ['goth', 'gothic', 'dark', 'industrial', 'alternative'],
  'grunge-90s': ['grunge', '90s grunge', 'seattle', 'nirvana era'],
  'preppy-ivy': ['preppy', 'ivy', 'trad', 'conservative', 'prep'],
  'rockabilly-greaser': ['rockabilly', 'greaser', '50s', 'hot rod', 'pompadour'],
  'mod-revival': ['mod', 'mod revival', 'lambretta', 'british mod'],
  'teddy-boy': ['teddy boy', 'ted', 'drape jacket', 'british 50s'],
  'rude-boy-ska': ['rude boy', 'ska', 'two-tone', 'checkered'],
  'hippie-bohemian': ['hippie', 'boho', 'bohemian', 'tie dye', 'festival'],
  'hip-hop-streetwear': ['hip hop', 'rap', 'baggy', '90s rap', 'street'],
  'rave-culture': ['rave', 'plur', 'candy kid', 'cyber', 'edm'],
  'surfer-beach': ['surf', 'surfer', 'beach', 'op', 'quicksilver'],
  'skater-punk': ['skater', 'skate punk', 'crossover'],
  'biker-motorcycle': ['biker', 'motorcycle', 'harley', 'patches'],
  'cowboy-western': ['cowboy', 'western wear', 'rodeo', 'ranch'],
  'lumberjack-americana': ['lumberjack', 'americana', 'heritage', 'logger'],
  'normcore-minimal': ['normcore', 'minimal', 'understated', 'basic'],
  'techwear-urban': ['techwear', 'tech', 'acronym', 'futuristic', 'tactical fashion'],
  'gorpcore-hiking': ['gorpcore', 'hiking dad', 'outdoor aesthetic', 'gorp'],
  
  // OTHER
  'fast-fashion': ['h&m', 'zara', 'forever 21', 'fast fashion', 'mall'],
  'mall-brands': ['gap', 'old navy', 'american eagle', 'mall brand'],
  'sustainable-eco': ['sustainable', 'eco', 'organic', 'recycled', 'ethical'],
  'department-store': ['macys', 'nordstrom', 'department store', 'house brand'],
  'outlet-discount': ['tj maxx', 'marshalls', 'ross', 'outlet', 'discount'],
  'recycled-upcycled': ['recycled', 'upcycled', 'remake', 'reworked'],
  'organic-natural': ['organic', 'natural fiber', 'cotton organic'],
  'fair-trade-ethical': ['fair trade', 'ethical', 'fair production'],
  'costume-halloween': ['costume', 'halloween', 'cosplay'],
  'novelty-funny': ['novelty', 'funny shirt', 'joke shirt'],
  'tourist-souvenir': ['tourist', 'souvenir', 'i love', 'vacation'],
  'sports-fan-generic': ['sports fan', 'fan gear', 'generic sports'],
};

export function detectCategory(voiceDescription: string): BrandCategory | null {
  const lowerDesc = voiceDescription.toLowerCase();
  let bestMatch: BrandCategory | null = null;
  let maxMatches = 0;
  
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS) as [BrandCategory, string[]][]) {
    const matches = keywords.filter(keyword => 
      lowerDesc.includes(keyword.toLowerCase())
    ).length;
    
    if (matches > maxMatches) {
      maxMatches = matches;
      bestMatch = category;
    }
  }
  
  return maxMatches > 0 ? bestMatch : null;
}

// ============================================================================
// COMPREHENSIVE MATCHER
// ============================================================================

export function intelligentMatch(voiceDescription: string): MatchResult {
  const brandMatch = matchBrand(voiceDescription);
  const categoryMatch = detectCategory(voiceDescription);
  
  if (brandMatch) {
    return {
      ...brandMatch,
      brandCategory: brandMatch.brandCategory || categoryMatch || undefined,
    };
  }
  
  if (categoryMatch) {
    return {
      brandCategory: categoryMatch,
      confidence: 0.6,
    };
  }
  
  return {
    confidence: 0,
  };
}

export default {
  matchBrand,
  detectCategory,
  intelligentMatch,
};
