// ============================================================================
// COMPREHENSIVE BRAND CATEGORY & MAKE/MODEL SYSTEM
// Detailed product categorization beyond just "athletic" or "workwear"
// Includes specific model numbers, silhouettes, and product lines
// ============================================================================

export type BrandCategory = 
  // ============ DENIM CATEGORIES ============
  | 'heritage-denim'           // Levi's 501, Lee 101, Wrangler 13MWZ
  | 'japanese-denim'           // Pure Blue Japan, Momotaro, Iron Heart
  | 'designer-denim'           // APC, Acne, Nudie
  | 'raw-selvedge'             // Naked & Famous, 3sixteen, Left Field
  | 'reproductions-vintage'    // RRL, The Real McCoy's, Buzz Rickson's
  | 'stretch-performance'      // Lululemon ABC, Outlier, Western Rise
  
  // ============ WORKWEAR CATEGORIES ============
  | 'workwear-heritage'        // Carhartt Detroit, Dickies 874, Red Kap
  | 'workwear-japanese'        // Kapital, Needles, Engineered Garments
  | 'workwear-french'          // Le Laboureur, Vetra, Adolphe Lafont
  | 'safety-industrial'        // Duluth Trading, Wolverine, Caterpillar
  | 'construction-hi-vis'      // Carhartt High Vis, Dickies Safety
  
  // ============ MILITARY & TACTICAL ============
  | 'military-surplus'         // Alpha Industries MA-1, M65, BDU
  | 'military-vintage'         // Vietnam era, Korean War, WWII surplus
  | 'tactical-modern'          // 5.11 Tactical, Arc'teryx LEAF, Crye Precision
  | 'camo-hunting'             // Realtree, Mossy Oak, Sitka Gear
  
  // ============ OUTDOOR & TECHNICAL ============
  | 'outdoor-technical'        // Arc'teryx jackets, Patagonia fleece
  | 'mountaineering-alpine'    // Mountain Hardwear, Black Diamond, Mammut
  | 'hiking-trail'             // Salomon, Merrell, Columbia
  | 'camping-bushcraft'        // Fjallraven, Helly Hansen, Filson
  | 'fishing-marine'           // Patagonia Baggies, Columbia PFG, Guy Harvey
  | 'cycling-performance'      // Rapha, Castelli, Assos
  | 'skiing-snowboard'         // Burton, Volcom, Oakley
  
  // ============ STREETWEAR CATEGORIES ============
  | 'streetwear-brands'        // Supreme box logo, Stüssy, BAPE
  | 'streetwear-korean'        // Ader Error, Andersson Bell, We11done
  | 'streetwear-japanese'      // Neighborhood, Fragment, WTAPS
  | 'streetwear-european'      // Palace, Carhartt WIP, Stone Island
  | 'hype-limited'             // Off-White, Fear of God, Essentials
  | 'graphic-tees'             // Online Ceramics, Brain Dead, Chinatown Market
  
  // ============ SKATE CULTURE ============
  | 'skate-brands'             // Palace, Thrasher, Independent
  | 'skate-heritage'           // Santa Cruz, Powell Peralta, Vision
  | 'skate-contemporary'       // Fucking Awesome, Hockey, Quasi
  | 'skate-shoes'              // Nike SB Dunk, Vans, DC Shoes, éS
  
  // ============ LUXURY & DESIGNER ============
  | 'luxury-fashion'           // Gucci, Louis Vuitton, Prada
  | 'luxury-italian'           // Brunello Cucinelli, Loro Piana, Kiton
  | 'luxury-french'            // Hermès, Dior, Saint Laurent
  | 'designer-contemporary'    // Comme des Garçons, Yohji, Rick Owens
  | 'designer-avant-garde'     // Margiela, Ann Demeulemeester, Raf Simons
  | 'designer-streetwear'      // Balenciaga, Vetements, Givenchy
  | 'designer-minimalist'      // Jil Sander, The Row, Lemaire
  
  // ============ ATHLETIC/SPORTSWEAR ============
  | 'performance-running'      // Nike Pegasus, Asics Gel, Brooks Ghost
  | 'performance-basketball'   // Air Jordan models, LeBron line, Kobe line
  | 'performance-football'     // Nike Vapor, Adidas Ultra Boost, cleats
  | 'performance-training'     // Nike Metcon, Reebok Nano, training shoes
  | 'performance-soccer'       // Nike Mercurial, Adidas Predator, Puma Future
  | 'performance-baseball'     // Nike Alpha Huarache, New Balance 4040, Under Armour
  | 'athleisure'               // Lululemon, Athleta, Outdoor Voices
  | 'yoga-pilates'             // Alo Yoga, Beyond Yoga, Spiritual Gangster
  
  // ============ SNEAKER CATEGORIES ============
  | 'lifestyle-sneakers'       // Air Force 1, Stan Smith, Old Skool
  | 'retro-runners'            // Air Max models, New Balance 990, Gel-Lyte
  | 'dad-shoes'                // New Balance 624, Nike Monarch, Asics Kayano
  | 'luxury-sneakers'          // Common Projects Achilles, Golden Goose
  | 'basketball-retro'         // Jordan Retro, Air More Uptempo, Foamposite
  | 'chunky-sneakers'          // Balenciaga Triple S, Yeezy 700, Fila Disruptor
  | 'minimalist-sneakers'      // Allbirds, Atoms, Vessi
  | 'skate-vulc'               // Vans Authentic, Converse Chuck Taylor, PF Flyers
  
  // ============ FOOTWEAR SPECIFIC ============
  | 'heritage-boots'           // Red Wing Iron Ranger, Wolverine 1000 Mile
  | 'work-boots'               // Timberland PRO, Carhartt boots, steel toe
  | 'western-boots'            // Lucchese, Tony Lama, Ariat
  | 'motorcycle-boots'         // Frye, Engineer boots, harness boots
  | 'hiking-boots'             // Danner, Vasque, Lowa
  | 'chelsea-boots'            // Blundstone, RM Williams, Story et Fall
  | 'combat-boots'             // Dr. Martens, Solovair, Grenson
  | 'dress-shoes'              // Allen Edmonds Park Avenue, Church's
  | 'loafers-moccasins'        // Alden penny loafer, Quoddy, Rancourt
  | 'boat-shoes'               // Sperry Top-Sider, Sebago, Timberland
  | 'sandals-slides'           // Birkenstock Arizona, Nike slides, Teva
  | 'espadrilles'              // Soludos, Castañer, Toms
  
  // ============ TEAMS/SPORTS MERCHANDISE ============
  | 'nfl-jerseys'              // Game jersey, Limited, Elite versions
  | 'nba-jerseys'              // Swingman, Authentic, City Edition
  | 'mlb-jerseys'              // Authentic, Replica, Cool Base
  | 'nhl-jerseys'              // Premier, Authentic, Reverse Retro
  | 'soccer-jerseys'           // Home, Away, Third kits
  | 'ncaa-apparel'             // College jerseys, Champion Reverse Weave
  | 'international-soccer'     // National teams, World Cup, Euro kits
  | 'minor-league'             // MiLB, G-League, AHL merchandise
  | 'team-snapbacks'           // New Era 59FIFTY, Mitchell & Ness
  | 'vintage-starter'          // Starter jackets, Apex One, Pro Line
  | 'vintage-logo-athletic'    // Logo Athletic satin jackets, 90s NBA
  | 'vintage-champion'         // Champion Reverse Weave, authentic collegiate
  
  // ============ BAND/MUSIC MERCH ============
  | 'band-tees-rock'           // Rock, metal, grunge band tees
  | 'band-tees-rap'            // Hip-hop, rap tour shirts
  | 'band-tees-punk'           // Punk, hardcore, DIY scene
  | 'band-tees-metal'          // Heavy metal, death metal, black metal
  | 'band-tees-electronic'     // EDM, techno, rave culture
  | 'band-tees-country'        // Country, folk, americana
  | 'band-tees-indie'          // Indie rock, alternative, college rock
  | 'tour-merch'               // Tour dates, venue specific
  | 'bootleg-merch'            // Unofficial vintage tees
  | 'festival-merch'           // Coachella, Bonnaroo, Lollapalooza
  | 'skateboard-band'          // Thrasher, Toy Machine crossover
  
  // ============ ACCESSORIES & BAGS ============
  | 'luxury-bags'              // Louis Vuitton, Gucci, Hermès
  | 'technical-bags'           // Arc'teryx, Patagonia, North Face
  | 'streetwear-bags'          // Supreme, Palace, BAPE accessories
  | 'vintage-bags'             // Coach, Dooney & Bourke legacy
  | 'messenger-bags'           // Timbuk2, Chrome Industries, Mission Workshop
  | 'backpacks-tactical'       // Mystery Ranch, Goruck, 5.11
  | 'camera-bags'              // Peak Design, Billingham, Domke
  | 'tote-canvas'              // L.L.Bean Boat & Tote, vintage canvas
  
  // ============ OUTERWEAR SPECIFIC ============
  | 'bomber-jackets'           // MA-1, flight jackets, souvenir
  | 'varsity-jackets'          // Letterman, DeLong, Holloway
  | 'leather-jackets'          // Schott Perfecto, Vanson, Aero
  | 'denim-jackets'            // Type I, II, III trucker styles
  | 'puffer-jackets'           // North Face Nuptse, Moncler, vintage puffers
  | 'fleece-technical'         // Patagonia Retro-X, Synchilla, fleece era
  | 'windbreakers'             // Vintage nylon, half-zip, pullover
  | 'parkas-shells'            // Gore-tex, technical outerwear
  | 'chore-coats'              // French workwear, utilitarian jackets
  | 'coach-jackets'            // Nylon coaches jackets, streetwear staple
  | 'blazers-sport-coats'      // Tailored jackets, unstructured
  | 'peacoats-overcoats'       // Classic wool coats, naval
  | 'trench-coats'             // Burberry, Aquascutum, classic rain
  | 'shackets-overshirts'      // Shirt-jacket hybrids, CPO shirts
  | 'harrington-jackets'       // Baracuta G9, mod culture
  | 'safari-field-jackets'     // M65 style, utility jackets
  | 'track-jackets'            // Adidas Firebird, Nike track tops
  
  // ============ SPECIFIC APPAREL TYPES ============
  | 'graphic-tees-vintage'     // Single stitch 80s/90s tees
  | 'souvenir-tees'            // Tourist tees, location specific
  | 'corporate-promo'          // Company merch, tech tees, conventions
  | 'hawaiian-shirts'          // Aloha shirts, Sun Surf, vintage rayon
  | 'bowling-shirts'           // Hilton, Nat Nast, vintage panel shirts
  | 'western-shirts'           // Pearl snap, Rockmount, H Bar C
  | 'flannel-shirts'           // Pendleton, Woolrich, vintage flannel
  | 'oxford-button-downs'      // Brooks Brothers OCBD, Gitman Vintage
  | 'chambray-work-shirts'     // Big Mac, Blue Bell, vintage work shirts
  | 'rugby-shirts'             // Ralph Lauren, Barbarian, vintage rugby
  | 'henley-shirts'            // Waffle knit, thermal, long sleeve
  | 'polo-shirts'              // Lacoste, Fred Perry, vintage Izod
  | 'mock-neck-turtleneck'     // 90s style, minimalist, layering
  | 'hoodies-sweatshirts'      // Reverse Weave, vintage crewneck
  | 'varsity-letterman'        // Authentic letterman sweaters, athletic
  | 'cardigan-sweaters'        // Vintage cardigan, shawl collar
  | 'fisherman-knits'          // Irish sweaters, Aran, cable knit
  | 'fair-isle-nordic'         // Scandinavian sweaters, vintage patterns
  | 'cargo-pants'              // Tactical pants, vintage cargo
  | 'painter-pants'            // Dickies painter, vintage workwear
  | 'corduroy-pants'           // Wide wale cord, vintage cords
  | 'chino-pants'              // Military chinos, vintage khakis
  | 'sweatpants-joggers'       // Champion Reverse Weave, athletic sweats
  | 'shorts-vintage'           // Patagonia Baggies, vintage athletic
  | 'overalls-coveralls'       // Vintage denim, hickory stripe
  
  // ============ SUBCULTURE SPECIFIC ============
  | 'punk-diy'                 // DIY punk, studded jackets, band patches
  | 'goth-alternative'         // Goth fashion, industrial, dark aesthetic
  | 'grunge-90s'               // Flannel, ripped jeans, 90s Seattle
  | 'preppy-ivy'               // Preppy, Ivy League, trad style
  | 'rockabilly-greaser'       // 50s style, pompadour culture, hot rod
  | 'mod-revival'              // Mod fashion, Fred Perry, Lambretta
  | 'teddy-boy'                // British Teddy Boy, drape jackets
  | 'rude-boy-ska'             // Ska culture, two-tone, checkered
  | 'hippie-bohemian'          // Hippie, tie-dye, boho, festival
  | 'hip-hop-streetwear'       // Hip-hop fashion, baggy, 90s rap
  | 'rave-culture'             // Rave, PLUR, candy kid, cyber goth
  | 'surfer-beach'             // Surf culture, beach vibes, OP, Quicksilver
  | 'skater-punk'              // Skate punk crossover, Vans, Thrasher
  | 'biker-motorcycle'         // Motorcycle culture, leather, patches
  | 'cowboy-western'           // Western wear, cowboy culture, rodeo
  | 'lumberjack-americana'     // Lumberjack style, heritage americana
  | 'normcore-minimal'         // Normcore, minimal, understated
  | 'techwear-urban'           // Techwear, Acronym, futuristic tactical
  | 'gorpcore-hiking'          // Gorpcore, hiking dad aesthetic
  
  // ============ FAST FASHION & MALL BRANDS ============
  | 'fast-fashion'             // H&M, Zara, Forever 21
  | 'mall-brands'              // Gap, Old Navy, American Eagle
  | 'department-store'         // Macy's, Nordstrom house brands
  | 'outlet-discount'          // TJ Maxx, Marshalls, Ross finds
  
  // ============ SUSTAINABLE & ECO ============
  | 'sustainable-eco'          // Patagonia worn wear, Reformation
  | 'recycled-upcycled'        // Upcycled vintage, remake culture
  | 'organic-natural'          // Organic cotton, natural fibers
  | 'fair-trade-ethical'       // Fair trade, ethical production
  
  // ============ COSTUME & NOVELTY ============
  | 'costume-halloween'        // Halloween costumes, cosplay
  | 'novelty-funny'            // Funny graphic tees, joke shirts
  | 'tourist-souvenir'         // Tourist tees, I ♥ NY style
  | 'sports-fan-generic'       // Generic sports fan gear, dad hats;

// ============================================================================
// MAKE/MODEL DATABASE - Specific Product Lines
// ============================================================================

export type ModelContext = {
  brand: string;
  modelName: string;
  modelNumber?: string;
  category: BrandCategory;
  yearIntroduced?: number;
  discontinued?: boolean;
  keywords: string[];
  identifyingFeatures: string[];
  priceRange: [number, number]; // Min, Max in USD
  collectibility: number; // 1-10
  sizes: string[];
  colorways: string[];
};

export const MODEL_DATABASE: Record<string, ModelContext> = {
  
  // ============ DENIM MODELS ============
  'levis-501-original': {
    brand: 'Levi\'s',
    modelName: '501 Original Fit',
    modelNumber: '501',
    category: 'heritage-denim',
    yearIntroduced: 1873,
    discontinued: false,
    keywords: ['501', 'original fit', 'button fly', 'straight leg', 'selvedge', 'shrink to fit'],
    identifyingFeatures: ['button fly', 'arcuate stitching', 'red tab', 'leather patch', 'straight leg'],
    priceRange: [60, 300],
    collectibility: 10,
    sizes: ['28', '29', '30', '31', '32', '33', '34', '36', '38', '40', '42'],
    colorways: ['rigid', 'stonewash', 'black', 'indigo', 'light wash', 'dark wash'],
  },

  'levis-505-regular': {
    brand: 'Levi\'s',
    modelName: '505 Regular Fit',
    modelNumber: '505',
    category: 'heritage-denim',
    yearIntroduced: 1967,
    discontinued: false,
    keywords: ['505', 'regular fit', 'zip fly', 'straight leg', 'classic'],
    identifyingFeatures: ['zip fly', 'straight leg', 'regular fit', 'red tab', 'arcuate'],
    priceRange: [50, 200],
    collectibility: 7,
    sizes: ['28', '29', '30', '31', '32', '33', '34', '36', '38', '40'],
    colorways: ['stonewash', 'black', 'indigo', 'light blue', 'dark rinse'],
  },

  'levis-517-bootcut': {
    brand: 'Levi\'s',
    modelName: '517 Bootcut',
    modelNumber: '517',
    category: 'heritage-denim',
    yearIntroduced: 1969,
    discontinued: true,
    keywords: ['517', 'bootcut', 'flare', 'western', 'cowboy', 'vintage'],
    identifyingFeatures: ['bootcut leg', 'orange tab', 'flare from knee', 'vintage styling'],
    priceRange: [80, 400],
    collectibility: 9,
    sizes: ['29', '30', '31', '32', '33', '34', '36', '38'],
    colorways: ['indigo', 'stonewash', 'black', 'light blue'],
  },

  'lee-101-riders': {
    brand: 'Lee',
    modelName: '101 Rider',
    modelNumber: '101',
    category: 'heritage-denim',
    yearIntroduced: 1920,
    discontinued: false,
    keywords: ['101', 'rider', 'cowboy', 'union made', 'vintage', 'sanforized'],
    identifyingFeatures: ['union made', 'lazy S pocket', 'Lee logo', 'button fly', 'cowboy cut'],
    priceRange: [70, 500],
    collectibility: 9,
    sizes: ['28', '29', '30', '31', '32', '33', '34', '36', '38', '40'],
    colorways: ['raw denim', 'stonewash', 'black', 'vintage wash'],
  },

  'wrangler-13mwz': {
    brand: 'Wrangler',
    modelName: '13MWZ Cowboy Cut',
    modelNumber: '13MWZ',
    category: 'heritage-denim',
    yearIntroduced: 1947,
    discontinued: false,
    keywords: ['13mwz', 'cowboy cut', 'rodeo', 'western', 'original fit', 'prca'],
    identifyingFeatures: ['cowboy cut', 'zip fly', 'W stitching', 'rodeo approved', 'bootcut'],
    priceRange: [40, 150],
    collectibility: 7,
    sizes: ['28x32', '30x32', '31x32', '32x32', '33x34', '34x34', '36x34', '38x32'],
    colorways: ['prewashed', 'rigid', 'stonewash', 'black', 'vintage'],
  },

  // ============ SNEAKER MODELS - NIKE ============
  'nike-air-force-1': {
    brand: 'Nike',
    modelName: 'Air Force 1',
    modelNumber: 'AF1',
    category: 'lifestyle-sneakers',
    yearIntroduced: 1982,
    discontinued: false,
    keywords: ['air force 1', 'af1', 'uptowns', 'classic', 'basketball', 'lifestyle'],
    identifyingFeatures: ['chunky silhouette', 'air unit', 'swoosh', 'AF1 branding', 'ankle strap'],
    priceRange: [90, 500],
    collectibility: 10,
    sizes: ['7', '7.5', '8', '8.5', '9', '9.5', '10', '10.5', '11', '11.5', '12', '13'],
    colorways: ['triple white', 'triple black', 'sail', 'off white', 'travis scott', 'custom'],
  },

  'nike-air-jordan-1': {
    brand: 'Nike',
    modelName: 'Air Jordan 1',
    modelNumber: 'AJ1',
    category: 'performance-basketball',
    yearIntroduced: 1985,
    discontinued: false,
    keywords: ['jordan 1', 'aj1', 'high', 'retro', 'banned', 'bred', 'chicago', 'royal'],
    identifyingFeatures: ['high top', 'wings logo', 'nike air', 'swoosh', 'jordan branding'],
    priceRange: [170, 10000],
    collectibility: 10,
    sizes: ['7', '8', '8.5', '9', '9.5', '10', '10.5', '11', '12', '13'],
    colorways: ['chicago', 'bred', 'royal', 'shadow', 'pine green', 'unc', 'off white', 'travis scott'],
  },

  'nike-air-max-90': {
    brand: 'Nike',
    modelName: 'Air Max 90',
    modelNumber: 'AM90',
    category: 'retro-runners',
    yearIntroduced: 1990,
    discontinued: false,
    keywords: ['air max 90', 'am90', 'infrared', 'visible air', 'runner', 'retro'],
    identifyingFeatures: ['visible air unit', 'infrared accents', 'paneled upper', 'waffle outsole'],
    priceRange: [130, 600],
    collectibility: 9,
    sizes: ['7', '8', '8.5', '9', '9.5', '10', '10.5', '11', '12', '13'],
    colorways: ['infrared', 'triple white', 'black', 'bacon', 'off white', 'laser blue'],
  },

  'nike-sb-dunk-low': {
    brand: 'Nike SB',
    modelName: 'Dunk Low Pro',
    modelNumber: 'SB Dunk',
    category: 'skate-shoes',
    yearIntroduced: 2002,
    discontinued: false,
    keywords: ['sb dunk', 'dunk low', 'skateboarding', 'pigeon', 'tiffany', 'supreme'],
    identifyingFeatures: ['padded tongue', 'zoom air', 'sb branding', 'thick tongue', 'skate durability'],
    priceRange: [110, 5000],
    collectibility: 10,
    sizes: ['7', '8', '8.5', '9', '9.5', '10', '10.5', '11', '12', '13'],
    colorways: ['panda', 'pigeon', 'tiffany', 'supreme', 'travis scott', 'ben & jerry'],
  },

  'nike-tech-fleece': {
    brand: 'Nike',
    modelName: 'Tech Fleece',
    modelNumber: 'Tech Fleece',
    category: 'athleisure',
    yearIntroduced: 2013,
    discontinued: false,
    keywords: ['tech fleece', 'joggers', 'hoodie', 'lightweight', 'modern', 'athletic'],
    identifyingFeatures: ['smooth exterior', 'thermal construction', 'sleek silhouette', 'zippered pockets'],
    priceRange: [60, 200],
    collectibility: 7,
    sizes: ['XS', 'S', 'M', 'L', 'XL', 'XXL'],
    colorways: ['black', 'grey', 'navy', 'olive', 'burgundy', 'carbon heather'],
  },

  // ============ SNEAKER MODELS - ADIDAS ============
  'adidas-stan-smith': {
    brand: 'Adidas',
    modelName: 'Stan Smith',
    modelNumber: 'Stan Smith',
    category: 'lifestyle-sneakers',
    yearIntroduced: 1965,
    discontinued: false,
    keywords: ['stan smith', 'tennis', 'classic', 'white', 'green tab', 'minimalist'],
    identifyingFeatures: ['clean white leather', 'green heel tab', 'perforated stripes', 'stan smith face'],
    priceRange: [80, 300],
    collectibility: 9,
    sizes: ['7', '8', '8.5', '9', '9.5', '10', '10.5', '11', '12', '13'],
    colorways: ['white/green', 'all white', 'black', 'primeknit', 'recon'],
  },

  'adidas-superstar': {
    brand: 'Adidas',
    modelName: 'Superstar',
    modelNumber: 'Superstar',
    category: 'lifestyle-sneakers',
    yearIntroduced: 1969,
    discontinued: false,
    keywords: ['superstar', 'shell toe', 'run dmc', 'hip hop', 'classic', 'stripes'],
    identifyingFeatures: ['rubber shell toe', 'three stripes', 'leather upper', 'herringbone sole'],
    priceRange: [80, 250],
    collectibility: 9,
    sizes: ['7', '8', '8.5', '9', '9.5', '10', '10.5', '11', '12'],
    colorways: ['white/black', 'all white', 'black/white', 'run dmc', 'pharrell'],
  },

  'adidas-yeezy-350': {
    brand: 'Adidas',
    modelName: 'Yeezy Boost 350 V2',
    modelNumber: 'Yeezy 350',
    category: 'luxury-sneakers',
    yearIntroduced: 2016,
    discontinued: false,
    keywords: ['yeezy', '350', 'boost', 'kanye', 'primeknit', 'hype', 'resale'],
    identifyingFeatures: ['primeknit upper', 'boost sole', 'heel tab', 'stripe', 'translucent sole'],
    priceRange: [220, 2000],
    collectibility: 9,
    sizes: ['4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14'],
    colorways: ['zebra', 'bred', 'cream', 'beluga', 'blue tint', 'static', 'sesame'],
  },

  // ============ SNEAKER MODELS - NEW BALANCE ============
  'new-balance-990v5': {
    brand: 'New Balance',
    modelName: '990v5',
    modelNumber: '990v5',
    category: 'retro-runners',
    yearIntroduced: 2019,
    discontinued: false,
    keywords: ['990', '990v5', 'made in usa', 'dad shoe', 'comfort', 'grey'],
    identifyingFeatures: ['ENCAP midsole', 'made in USA', 'suede/mesh upper', 'N logo', 'premium materials'],
    priceRange: [185, 400],
    collectibility: 8,
    sizes: ['7', '7.5', '8', '8.5', '9', '9.5', '10', '10.5', '11', '11.5', '12', '13'],
    colorways: ['grey', 'navy', 'black', 'cream', 'joe freshgoods', 'kith'],
  },

  'new-balance-574': {
    brand: 'New Balance',
    modelName: '574',
    modelNumber: '574',
    category: 'retro-runners',
    yearIntroduced: 1988,
    discontinued: false,
    keywords: ['574', 'classic', 'affordable', 'retro', 'lifestyle', 'everyday'],
    identifyingFeatures: ['ENCAP midsole', 'suede/mesh', 'chunky silhouette', 'N logo', 'versatile'],
    priceRange: [80, 200],
    collectibility: 6,
    sizes: ['7', '8', '8.5', '9', '9.5', '10', '10.5', '11', '12'],
    colorways: ['grey', 'navy', 'burgundy', 'green', 'black', 'tan'],
  },

  // ============ VANS MODELS ============
  'vans-old-skool': {
    brand: 'Vans',
    modelName: 'Old Skool',
    modelNumber: 'Old Skool',
    category: 'skate-shoes',
    yearIntroduced: 1977,
    discontinued: false,
    keywords: ['old skool', 'sidestripe', 'skate', 'classic', 'canvas', 'suede'],
    identifyingFeatures: ['jazz stripe', 'padded collar', 'waffle sole', 'reinforced toe', 'low top'],
    priceRange: [60, 150],
    collectibility: 8,
    sizes: ['6', '7', '7.5', '8', '8.5', '9', '9.5', '10', '10.5', '11', '12', '13'],
    colorways: ['black/white', 'all black', 'checkerboard', 'navy', 'green', 'off the wall'],
  },

  'vans-sk8-hi': {
    brand: 'Vans',
    modelName: 'Sk8-Hi',
    modelNumber: 'Sk8-Hi',
    category: 'skate-shoes',
    yearIntroduced: 1978,
    discontinued: false,
    keywords: ['sk8-hi', 'high top', 'skate', 'ankle support', 'classic', 'supreme'],
    identifyingFeatures: ['high top', 'padded ankle', 'jazz stripe', 'waffle sole', 'reinforced'],
    priceRange: [65, 300],
    collectibility: 8,
    sizes: ['6', '7', '8', '8.5', '9', '9.5', '10', '10.5', '11', '12'],
    colorways: ['black/white', 'all black', 'checkerboard', 'supreme', 'fear of god'],
  },

  // ============ WORKWEAR MODELS ============
  'carhartt-detroit-jacket': {
    brand: 'Carhartt',
    modelName: 'Detroit Jacket',
    modelNumber: 'J001',
    category: 'workwear-heritage',
    yearIntroduced: 1920,
    discontinued: false,
    keywords: ['detroit jacket', 'carhartt', 'blanket lined', 'brown duck', 'workwear', 'j001'],
    identifyingFeatures: ['blanket lining', 'corduroy collar', 'snap front', 'duck canvas', 'multiple pockets'],
    priceRange: [130, 400],
    collectibility: 9,
    sizes: ['S', 'M', 'L', 'XL', 'XXL', 'XXXL'],
    colorways: ['carhartt brown', 'black', 'moss', 'gravel', 'navy'],
  },

  'dickies-874-work-pant': {
    brand: 'Dickies',
    modelName: '874 Original Work Pant',
    modelNumber: '874',
    category: 'workwear-heritage',
    yearIntroduced: 1923,
    discontinued: false,
    keywords: ['874', 'dickies', 'work pant', 'khaki', 'black', 'skate', 'cholo'],
    identifyingFeatures: ['flat front', 'permanent crease', 'tunnel belt loops', 'stain release', 'classic fit'],
    priceRange: [30, 80],
    collectibility: 7,
    sizes: ['28x30', '30x30', '32x32', '33x32', '34x32', '36x32', '38x32', '40x32'],
    colorways: ['khaki', 'black', 'navy', 'charcoal', 'olive', 'brown'],
  },

  // ============ BOOTS MODELS ============
  'red-wing-iron-ranger': {
    brand: 'Red Wing',
    modelName: 'Iron Ranger',
    modelNumber: '8111',
    category: 'heritage-boots',
    yearIntroduced: 1930,
    discontinued: false,
    keywords: ['iron ranger', '8111', 'red wing', 'heritage', 'leather', 'made in usa', 'goodyear welt'],
    identifyingFeatures: ['cork sole', 'leather toe cap', 'speed hooks', 'oil-tanned leather', 'double layer toe'],
    priceRange: [350, 500],
    collectibility: 9,
    sizes: ['7D', '7.5D', '8D', '8.5D', '9D', '9.5D', '10D', '10.5D', '11D', '12D'],
    colorways: ['amber harness', 'black harness', 'oxblood', 'copper rough & tough'],
  },

  'timberland-6-inch-premium': {
    brand: 'Timberland',
    modelName: '6-Inch Premium Boot',
    modelNumber: '10061',
    category: 'work-boots',
    yearIntroduced: 1973,
    discontinued: false,
    keywords: ['timberland', '6 inch', 'wheat', 'premium boot', 'construction', 'waterproof', 'timbs'],
    identifyingFeatures: ['wheat nubuck', 'padded collar', 'lug sole', 'waterproof', 'tree logo'],
    priceRange: [190, 350],
    collectibility: 8,
    sizes: ['7', '7.5', '8', '8.5', '9', '9.5', '10', '10.5', '11', '12', '13'],
    colorways: ['wheat', 'black', 'grey', 'rust', 'navy'],
  },

  // ============ OUTERWEAR MODELS ============
  'alpha-industries-ma1': {
    brand: 'Alpha Industries',
    modelName: 'MA-1 Flight Jacket',
    modelNumber: 'MA-1',
    category: 'bomber-jackets',
    yearIntroduced: 1958,
    discontinued: false,
    keywords: ['ma-1', 'bomber', 'flight jacket', 'alpha industries', 'orange lining', 'military'],
    identifyingFeatures: ['orange lining', 'utility pocket', 'zip front', 'ribbed cuffs', 'nylon shell'],
    priceRange: [150, 300],
    collectibility: 9,
    sizes: ['XS', 'S', 'M', 'L', 'XL', 'XXL'],
    colorways: ['sage', 'black', 'navy', 'replica blue', 'woodland camo'],
  },

  'north-face-nuptse': {
    brand: 'The North Face',
    modelName: 'Nuptse Jacket',
    modelNumber: 'Nuptse',
    category: 'puffer-jackets',
    yearIntroduced: 1992,
    discontinued: false,
    keywords: ['nuptse', 'north face', 'puffer', 'down jacket', '700 fill', 'retro', 'supreme'],
    identifyingFeatures: ['boxy fit', 'oversized baffles', '700 fill down', 'stowable hood', 'retro styling'],
    priceRange: [280, 1200],
    collectibility: 9,
    sizes: ['XS', 'S', 'M', 'L', 'XL', 'XXL'],
    colorways: ['black', 'red', 'yellow', 'summit gold', 'supreme', 'vintage white'],
  },

  'patagonia-synchilla-snap-t': {
    brand: 'Patagonia',
    modelName: 'Synchilla Snap-T Fleece',
    modelNumber: 'Snap-T',
    category: 'fleece-technical',
    yearIntroduced: 1985,
    discontinued: false,
    keywords: ['synchilla', 'snap-t', 'patagonia', 'fleece', 'pullover', 'retro', 'vintage'],
    identifyingFeatures: ['snap placket', 'kangaroo pocket', 'fleece construction', 'y-joint sleeves', 'chest pocket'],
    priceRange: [120, 300],
    collectibility: 9,
    sizes: ['XS', 'S', 'M', 'L', 'XL', 'XXL'],
    colorways: ['pelican', 'stone blue', 'black', 'pesto', 'oatmeal heather', 'vintage patterns'],
  },

  // ============ JERSEYS - NBA ============
  'mitchell-ness-swingman': {
    brand: 'Mitchell & Ness',
    modelName: 'Swingman Jersey',
    modelNumber: 'Swingman',
    category: 'nba-jerseys',
    yearIntroduced: 2000,
    discontinued: false,
    keywords: ['swingman', 'mitchell & ness', 'throwback', 'vintage', 'nba', 'hardwood classics'],
    identifyingFeatures: ['tackle twill numbers', 'mesh construction', 'mitchell & ness tag', 'throwback styling'],
    priceRange: [130, 400],
    collectibility: 9,
    sizes: ['S', 'M', 'L', 'XL', 'XXL', '3XL'],
    colorways: ['team colors', 'throwback', 'hardwood classics', 'all-star'],
  },

  'nike-authentic-jersey': {
    brand: 'Nike',
    modelName: 'Authentic Jersey',
    modelNumber: 'Authentic',
    category: 'nba-jerseys',
    yearIntroduced: 2017,
    discontinued: false,
    keywords: ['authentic', 'nike', 'nba', 'game worn', 'pro cut', 'connected'],
    identifyingFeatures: ['dri-fit', 'nike connect', 'game cut', 'heat pressed graphics', 'premium construction'],
    priceRange: [200, 500],
    collectibility: 8,
    sizes: ['40', '44', '48', '52', '56'],
    colorways: ['home', 'away', 'city edition', 'statement', 'classic'],
  },

  // ============ STREETWEAR MODELS ============
  'supreme-box-logo-tee': {
    brand: 'Supreme',
    modelName: 'Box Logo Tee',
    modelNumber: 'Bogo Tee',
    category: 'streetwear-brands',
    yearIntroduced: 1994,
    discontinued: false,
    keywords: ['box logo', 'bogo', 'supreme', 'tee', 'screen print', 'hype'],
    identifyingFeatures: ['box logo print', 'single stitch', 'supreme tag', 'screen printed', 'cotton'],
    priceRange: [44, 5000],
    collectibility: 10,
    sizes: ['S', 'M', 'L', 'XL'],
    colorways: ['white', 'black', 'grey', 'navy', 'red', 'ash grey', 'vintage'],
  },

  'bape-shark-hoodie': {
    brand: 'A Bathing Ape',
    modelName: 'Shark Full Zip Hoodie',
    modelNumber: 'Shark Hoodie',
    category: 'streetwear-brands',
    yearIntroduced: 2004,
    discontinued: false,
    keywords: ['shark hoodie', 'bape', 'full zip', 'wgm', 'camo', 'streetwear'],
    identifyingFeatures: ['shark face hood', 'full zip', 'camo pattern', 'WGM logo', 'bape head'],
    priceRange: [400, 2000],
    collectibility: 9,
    sizes: ['S', 'M', 'L', 'XL', 'XXL'],
    colorways: ['1st camo', 'city camo', 'woodland', 'black', 'purple', 'tiger camo'],
  },

  // ============ JAPANESE STREETWEAR MODELS ============
  'neighborhood-specimen': {
    brand: 'Neighborhood',
    modelName: 'Specimen Research',
    modelNumber: 'NBHD',
    category: 'streetwear-japanese',
    yearIntroduced: 1994,
    discontinued: false,
    keywords: ['neighborhood', 'nbhd', 'japanese', 'biker', 'military', 'streetwear'],
    identifyingFeatures: ['military details', 'biker aesthetic', 'quality construction', 'skull logo'],
    priceRange: [200, 800],
    collectibility: 9,
    sizes: ['S', 'M', 'L', 'XL'],
    colorways: ['black', 'olive', 'navy', 'grey', 'camo'],
  },

  'wtaps-design-studio': {
    brand: 'WTAPS',
    modelName: 'Design Studio',
    modelNumber: 'WTAPS',
    category: 'streetwear-japanese',
    yearIntroduced: 1996,
    discontinued: false,
    keywords: ['wtaps', 'japanese', 'military', 'tactical', 'streetwear', 'tetsu nishiyama'],
    identifyingFeatures: ['military inspiration', 'quality fabrics', 'tactical details', 'crossbones'],
    priceRange: [180, 700],
    collectibility: 8,
    sizes: ['S', 'M', 'L', 'XL'],
    colorways: ['olive', 'black', 'khaki', 'navy', 'coyote brown'],
  },

  'visvim-fbr': {
    brand: 'Visvim',
    modelName: 'FBT',
    modelNumber: 'FBT',
    category: 'luxury-sneakers',
    yearIntroduced: 2001,
    discontinued: false,
    keywords: ['visvim', 'fbt', 'moccasin', 'hiroki nakamura', 'artisan', 'luxury'],
    identifyingFeatures: ['moccasin construction', 'hand-made details', 'elk leather', 'premium materials'],
    priceRange: [700, 2000],
    collectibility: 10,
    sizes: ['7', '8', '9', '10', '11', '12'],
    colorways: ['navy', 'black', 'brown', 'indigo', 'folk'],
  },

  // ============ KOREAN STREETWEAR MODELS ============
  'ader-error-oversized': {
    brand: 'Ader Error',
    modelName: 'Oversized Logo',
    modelNumber: 'ADER',
    category: 'streetwear-korean',
    yearIntroduced: 2014,
    discontinued: false,
    keywords: ['ader error', 'korean', 'oversized', 'minimalist', 'pastel', 'contemporary'],
    identifyingFeatures: ['oversized fit', 'minimalist logo', 'pastel colors', 'modern cut'],
    priceRange: [100, 300],
    collectibility: 7,
    sizes: ['S', 'M', 'L', 'XL'],
    colorways: ['white', 'black', 'pink', 'blue', 'yellow', 'green'],
  },

  // ============ VINTAGE WORKWEAR MODELS ============
  'pendleton-board-shirt': {
    brand: 'Pendleton',
    modelName: 'Board Shirt',
    modelNumber: 'Board Shirt',
    category: 'flannel-shirts',
    yearIntroduced: 1924,
    discontinued: false,
    keywords: ['pendleton', 'board shirt', 'wool', 'flannel', 'surf', 'made in usa'],
    identifyingFeatures: ['virgin wool', 'loop collar', 'surf styling', 'made in USA', 'quality weave'],
    priceRange: [150, 400],
    collectibility: 9,
    sizes: ['S', 'M', 'L', 'XL', 'XXL'],
    colorways: ['red/black', 'blue/grey', 'brown/tan', 'green/navy', 'vintage patterns'],
  },

  'filson-mackinaw-cruiser': {
    brand: 'Filson',
    modelName: 'Mackinaw Cruiser',
    modelNumber: '10043',
    category: 'workwear-heritage',
    yearIntroduced: 1914,
    discontinued: false,
    keywords: ['filson', 'mackinaw', 'wool', 'cruiser', 'pacific northwest', 'made in usa'],
    identifyingFeatures: ['mackinaw wool', 'double layer shoulders', 'made in USA', 'tin cloth pockets'],
    priceRange: [400, 600],
    collectibility: 9,
    sizes: ['S', 'M', 'L', 'XL', 'XXL'],
    colorways: ['red/black', 'charcoal', 'green/black', 'vintage plaid'],
  },

  // ============ VINTAGE ATHLETIC MODELS ============
  'champion-reverse-weave': {
    brand: 'Champion',
    modelName: 'Reverse Weave',
    modelNumber: 'RW',
    category: 'hoodies-sweatshirts',
    yearIntroduced: 1938,
    discontinued: false,
    keywords: ['champion', 'reverse weave', 'crewneck', 'hoodie', 'vintage', 'collegiate', 'made in usa'],
    identifyingFeatures: ['side panels', 'reverse weave', 'C logo', 'ribbed panels', 'minimal shrinkage'],
    priceRange: [70, 500],
    collectibility: 9,
    sizes: ['S', 'M', 'L', 'XL', 'XXL'],
    colorways: ['oxford grey', 'navy', 'black', 'burgundy', 'forest green', 'vintage wash'],
  },

  'russell-athletic-vintage': {
    brand: 'Russell Athletic',
    modelName: 'Cotton Fleece',
    modelNumber: 'Russell',
    category: 'hoodies-sweatshirts',
    yearIntroduced: 1902,
    discontinued: false,
    keywords: ['russell athletic', 'vintage', 'athletic', 'fleece', 'made in usa', 'collegiate'],
    identifyingFeatures: ['cotton fleece', 'athletic cut', 'vintage logo', 'quality construction'],
    priceRange: [40, 300],
    collectibility: 7,
    sizes: ['S', 'M', 'L', 'XL', 'XXL'],
    colorways: ['grey', 'navy', 'black', 'maroon', 'green'],
  },

  // ============ WESTERN WEAR MODELS ============
  'rockmount-ranch-wear': {
    brand: 'Rockmount Ranch Wear',
    modelName: 'Sawtooth Pocket Shirt',
    modelNumber: 'Western Shirt',
    category: 'western-shirts',
    yearIntroduced: 1946,
    discontinued: false,
    keywords: ['rockmount', 'western', 'pearl snap', 'sawtooth', 'cowboy', 'denver', 'papa jack'],
    identifyingFeatures: ['sawtooth pockets', 'pearl snaps', 'smile pockets', 'western yoke', 'made in USA'],
    priceRange: [150, 400],
    collectibility: 9,
    sizes: ['S', 'M', 'L', 'XL', 'XXL'],
    colorways: ['denim', 'black', 'white', 'red', 'paisley', 'vintage prints'],
  },

  'lucchese-cowboy-boots': {
    brand: 'Lucchese',
    modelName: 'Classics',
    modelNumber: 'Lucchese',
    category: 'western-boots',
    yearIntroduced: 1883,
    discontinued: false,
    keywords: ['lucchese', 'cowboy boots', 'western', 'handmade', 'texas', 'exotic leather'],
    identifyingFeatures: ['hand-lasted', 'lemonwood pegs', 'exotic leather', 'quality craftsmanship'],
    priceRange: [400, 3000],
    collectibility: 10,
    sizes: ['7D', '8D', '9D', '10D', '11D', '12D', '13D'],
    colorways: ['tan', 'black', 'brown', 'ostrich', 'alligator', 'python'],
  },

  // ============ OUTDOOR HERITAGE MODELS ============
  'barbour-beaufort': {
    brand: 'Barbour',
    modelName: 'Beaufort Jacket',
    modelNumber: 'Beaufort',
    category: 'parkas-shells',
    yearIntroduced: 1980,
    discontinued: false,
    keywords: ['barbour', 'beaufort', 'waxed cotton', 'british', 'heritage', 'motorcycle'],
    identifyingFeatures: ['waxed cotton', 'corduroy collar', 'tartan lining', 'game pocket', 'brass hardware'],
    priceRange: [400, 600],
    collectibility: 9,
    sizes: ['S', '36', '38', '40', '42', '44', '46'],
    colorways: ['sage', 'navy', 'black', 'olive', 'rustic'],
  },

  'll-bean-boat-tote': {
    brand: 'L.L.Bean',
    modelName: 'Boat and Tote',
    modelNumber: 'Boat Tote',
    category: 'tote-canvas',
    yearIntroduced: 1944,
    discontinued: false,
    keywords: ['ll bean', 'boat tote', 'canvas', 'made in usa', 'maine', 'preppy'],
    identifyingFeatures: ['canvas construction', 'rope handles', 'made in USA', 'open top', 'durable'],
    priceRange: [30, 100],
    collectibility: 7,
    sizes: ['small', 'medium', 'large', 'extra large'],
    colorways: ['natural', 'navy', 'red', 'green', 'khaki', 'personalized'],
  },

  // ============ HERITAGE FOOTWEAR MODELS ============
  'alden-indy-boot': {
    brand: 'Alden',
    modelName: 'Indy Boot',
    modelNumber: '405',
    category: 'heritage-boots',
    yearIntroduced: 1980,
    discontinued: false,
    keywords: ['alden', 'indy boot', '405', 'indiana jones', 'chromexcel', 'made in usa', 'trubalance'],
    identifyingFeatures: ['trubalance last', 'chromexcel leather', 'commando sole', 'flat welt', 'quality construction'],
    priceRange: [600, 900],
    collectibility: 10,
    sizes: ['7D', '7.5D', '8D', '8.5D', '9D', '9.5D', '10D', '11D', '12D'],
    colorways: ['brown chromexcel', 'black', 'natural chromexcel', 'color 8'],
  },

  'dr-martens-1460': {
    brand: 'Dr. Martens',
    modelName: '1460 Smooth',
    modelNumber: '1460',
    category: 'combat-boots',
    yearIntroduced: 1960,
    discontinued: false,
    keywords: ['doc martens', '1460', '8 eye', 'smooth', 'punk', 'skinhead', 'yellow stitching'],
    identifyingFeatures: ['8 eyelet', 'yellow stitching', 'air cushioned sole', 'heel loop', 'grooved sides'],
    priceRange: [150, 300],
    collectibility: 9,
    sizes: ['6', '7', '8', '9', '10', '11', '12', '13'],
    colorways: ['black smooth', 'cherry red', 'oxblood', 'white', 'navy', 'vintage'],
  },

  'blundstone-classic': {
    brand: 'Blundstone',
    modelName: 'Classic 550',
    modelNumber: '550',
    category: 'chelsea-boots',
    yearIntroduced: 1960,
    discontinued: false,
    keywords: ['blundstone', 'chelsea', 'elastic sided', 'australian', 'work boot', 'pull on'],
    identifyingFeatures: ['elastic sides', 'pull tabs', 'removable footbed', 'slip resistant', 'durable'],
    priceRange: [200, 300],
    collectibility: 7,
    sizes: ['6', '6.5', '7', '7.5', '8', '8.5', '9', '9.5', '10', '11', '12'],
    colorways: ['rustic brown', 'black', 'stout brown', 'voltan black', 'dress series'],
  },

  // ============ DESIGNER MINIMALIST MODELS ============
  'common-projects-achilles': {
    brand: 'Common Projects',
    modelName: 'Achilles Low',
    modelNumber: 'Achilles',
    category: 'luxury-sneakers',
    yearIntroduced: 2004,
    discontinued: false,
    keywords: ['common projects', 'achilles', 'minimalist', 'italian', 'gold numbers', 'luxury'],
    identifyingFeatures: ['gold numbers', 'minimalist design', 'italian leather', 'margom sole', 'clean aesthetic'],
    priceRange: [400, 600],
    collectibility: 9,
    sizes: ['39', '40', '41', '42', '43', '44', '45', '46'],
    colorways: ['white', 'black', 'grey', 'navy', 'blush', 'retro low'],
  },

  'margiela-gat-replica': {
    brand: 'Maison Margiela',
    modelName: 'Replica GAT',
    modelNumber: 'Replica',
    category: 'luxury-sneakers',
    yearIntroduced: 2000,
    discontinued: false,
    keywords: ['margiela', 'gat', 'replica', 'german army trainer', 'minimalist', 'designer'],
    identifyingFeatures: ['gum sole', 'pre-distressed', 'painted numbers', 'vintage aesthetic', 'quality leather'],
    priceRange: [450, 650],
    collectibility: 9,
    sizes: ['39', '40', '41', '42', '43', '44', '45'],
    colorways: ['white/grey', 'black', 'navy', 'all white', 'paint splatter'],
  },

  // ============ TECHNICAL OUTDOOR MODELS ============
  'arcteryx-beta-ar': {
    brand: 'Arc\'teryx',
    modelName: 'Beta AR',
    modelNumber: 'Beta AR',
    category: 'parkas-shells',
    yearIntroduced: 1998,
    discontinued: false,
    keywords: ['arcteryx', 'beta ar', 'gore-tex', 'all round', 'technical', 'canada', 'birds'],
    identifyingFeatures: ['gore-tex pro', 'helmet compatible hood', 'pit zips', 'trim fit', 'articulated'],
    priceRange: [600, 800],
    collectibility: 8,
    sizes: ['XS', 'S', 'M', 'L', 'XL', 'XXL'],
    colorways: ['black', 'pilot', 'dynasty', 'oracle', 'paradox'],
  },

  'arcteryx-atom-lt': {
    brand: 'Arc\'teryx',
    modelName: 'Atom LT Hoody',
    modelNumber: 'Atom LT',
    category: 'outdoor-technical',
    yearIntroduced: 2012,
    discontinued: false,
    keywords: ['arcteryx', 'atom lt', 'insulated', 'hoody', 'coreloft', 'midlayer', 'technical'],
    identifyingFeatures: ['coreloft insulation', 'tyono shell', 'stretch panels', 'trim fit', 'versatile'],
    priceRange: [300, 400],
    collectibility: 8,
    sizes: ['XS', 'S', 'M', 'L', 'XL', 'XXL'],
    colorways: ['black', 'pilot', 'neptune', 'paradox', 'firoza'],
  },

  // ============ RETRO ATHLETIC MODELS ============
  'asics-gel-lyte-iii': {
    brand: 'Asics',
    modelName: 'Gel-Lyte III',
    modelNumber: 'GL3',
    category: 'retro-runners',
    yearIntroduced: 1990,
    discontinued: false,
    keywords: ['asics', 'gel lyte', 'gl3', 'split tongue', 'retro', 'runner', 'kith'],
    identifyingFeatures: ['split tongue', 'gel cushioning', 'suede/mesh upper', 'retro styling'],
    priceRange: [120, 400],
    collectibility: 8,
    sizes: ['7', '7.5', '8', '8.5', '9', '9.5', '10', '10.5', '11', '12'],
    colorways: ['salmon toe', 'miami', 'volcano', 'og grey', 'kith collabs'],
  },

  'reebok-club-c': {
    brand: 'Reebok',
    modelName: 'Club C 85',
    modelNumber: 'Club C',
    category: 'lifestyle-sneakers',
    yearIntroduced: 1985,
    discontinued: false,
    keywords: ['reebok', 'club c', 'tennis', 'minimalist', 'clean', 'vintage'],
    identifyingFeatures: ['clean leather upper', 'die-cut eva midsole', 'low-cut design', 'terry cloth lining'],
    priceRange: [80, 200],
    collectibility: 7,
    sizes: ['7', '8', '8.5', '9', '9.5', '10', '10.5', '11', '12'],
    colorways: ['white/green', 'all white', 'vintage', 'grey', 'navy'],
  },

  // ============ SKATE HERITAGE MODELS ============
  'converse-chuck-taylor': {
    brand: 'Converse',
    modelName: 'Chuck Taylor All Star',
    modelNumber: 'Chuck 70',
    category: 'skate-vulc',
    yearIntroduced: 1917,
    discontinued: false,
    keywords: ['converse', 'chuck taylor', 'all star', 'canvas', 'chuck 70', 'vintage', 'high top'],
    identifyingFeatures: ['canvas upper', 'rubber toe cap', 'ankle patch', 'vulcanized sole', 'star logo'],
    priceRange: [50, 200],
    collectibility: 9,
    sizes: ['5', '6', '7', '8', '9', '10', '11', '12', '13'],
    colorways: ['black', 'white', 'natural', 'navy', 'red', 'comme des garcons'],
  },

  'pf-flyers-center-hi': {
    brand: 'PF Flyers',
    modelName: 'Center Hi',
    modelNumber: 'Center Hi',
    category: 'skate-vulc',
    yearIntroduced: 1937,
    discontinued: false,
    keywords: ['pf flyers', 'center hi', 'canvas', 'vintage', 'made in usa', 'sandlot'],
    identifyingFeatures: ['canvas upper', 'posture foundation', 'made in USA options', 'vintage styling'],
    priceRange: [65, 150],
    collectibility: 7,
    sizes: ['7', '8', '9', '10', '11', '12'],
    colorways: ['black', 'white', 'navy', 'brown', 'vintage'],
  },

  // ============ PREP/IVY MODELS ============
  'brooks-brothers-ocbd': {
    brand: 'Brooks Brothers',
    modelName: 'Oxford Button Down',
    modelNumber: 'OCBD',
    category: 'oxford-button-downs',
    yearIntroduced: 1896,
    discontinued: false,
    keywords: ['brooks brothers', 'ocbd', 'oxford', 'button down', 'preppy', 'ivy', 'golden fleece'],
    identifyingFeatures: ['button down collar', 'oxford cloth', 'box pleat', 'unlined', 'made in USA'],
    priceRange: [90, 250],
    collectibility: 8,
    sizes: ['14.5', '15', '15.5', '16', '16.5', '17', '17.5'],
    colorways: ['white', 'blue', 'pink', 'university stripe', 'must'],
  },

  'sperry-top-sider': {
    brand: 'Sperry',
    modelName: 'Authentic Original',
    modelNumber: 'AO',
    category: 'boat-shoes',
    yearIntroduced: 1935,
    discontinued: false,
    keywords: ['sperry', 'top-sider', 'boat shoe', 'preppy', 'deck shoe', 'leather', 'moc toe'],
    identifyingFeatures: ['moc toe', 'leather laces', 'non-marking sole', 'hand-sewn', 'wave-siping'],
    priceRange: [90, 150],
    collectibility: 7,
    sizes: ['7', '7.5', '8', '8.5', '9', '9.5', '10', '10.5', '11', '12'],
    colorways: ['sahara', 'navy', 'brown', 'black', 'two-eye', 'three-eye'],
  },

  // ============ TECHWEAR MODELS ============
  'acronym-j1a-gt': {
    brand: 'Acronym',
    modelName: 'J1A-GT',
    modelNumber: 'J1A',
    category: 'techwear-urban',
    yearIntroduced: 2010,
    discontinued: false,
    keywords: ['acronym', 'j1a', 'gore-tex', 'techwear', 'technical', 'future', 'errolson hugh'],
    identifyingFeatures: ['gore-tex', 'articulated fit', 'gravity pocket', 'modular system', 'technical details'],
    priceRange: [2000, 4000],
    collectibility: 10,
    sizes: ['S', 'M', 'L', 'XL'],
    colorways: ['black', 'navy', 'olive', 'camo'],
  },

};

// ============================================================================
// CATEGORY TAXONOMY - Hierarchical Organization
// ============================================================================

export const CATEGORY_HIERARCHY = {
  'DENIM': {
    subcategories: ['heritage-denim', 'japanese-denim', 'designer-denim', 'raw-selvedge', 'reproductions-vintage'],
    brands: ['Levi\'s', 'Lee', 'Wrangler', 'Edwin', 'Momotaro', 'Iron Heart', 'APC', 'Acne Studios', '3sixteen', 'RRL'],
    models: ['501', '505', '517', '101', '13MWZ', 'Petit Standard', 'Max', 'Thin Finn', 'Type I', 'Type II'],
  },
  'WORKWEAR': {
    subcategories: ['workwear-heritage', 'workwear-japanese', 'workwear-french', 'military-surplus', 'safety-industrial'],
    brands: ['Carhartt', 'Dickies', 'Red Kap', 'Osh Kosh', 'Alpha Industries', 'Kapital', 'Needles', 'Vetra', 'Le Laboureur'],
    models: ['Detroit Jacket', '874', 'Double Knee', 'MA-1', 'M65', 'BDU', 'Mackinaw Cruiser'],
  },
  'SNEAKERS': {
    subcategories: ['lifestyle-sneakers', 'retro-runners', 'performance-basketball', 'skate-shoes', 'luxury-sneakers', 'dad-shoes'],
    brands: ['Nike', 'Adidas', 'New Balance', 'Vans', 'Converse', 'Reebok', 'Asics', 'Common Projects', 'Visvim'],
    models: ['Air Force 1', 'Jordan 1', 'Stan Smith', 'Superstar', '990', 'Old Skool', 'Chuck Taylor', 'Achilles', 'FBT'],
  },
  'OUTERWEAR': {
    subcategories: ['bomber-jackets', 'puffer-jackets', 'fleece-technical', 'denim-jackets', 'leather-jackets', 'parkas-shells', 'varsity-jackets'],
    brands: ['Alpha Industries', 'The North Face', 'Patagonia', 'Schott', 'Canada Goose', 'Arc\'teryx', 'Barbour', 'Filson'],
    models: ['MA-1', 'Nuptse', 'Synchilla', 'Perfecto', 'Chilliwack', 'Beta AR', 'Beaufort', 'Mackinaw'],
  },
  'BOOTS': {
    subcategories: ['heritage-boots', 'work-boots', 'dress-shoes', 'western-boots', 'combat-boots', 'chelsea-boots', 'hiking-boots'],
    brands: ['Red Wing', 'Alden', 'Wolverine', 'Timberland', 'Dr. Martens', 'Danner', 'Lucchese', 'Blundstone', 'RM Williams'],
    models: ['Iron Ranger', '1000 Mile', 'Indy Boot', '6-Inch Premium', '1460', 'Mountain Light', 'Classic 550'],
  },
  'JERSEYS': {
    subcategories: ['nba-jerseys', 'nfl-jerseys', 'mlb-jerseys', 'nhl-jerseys', 'soccer-jerseys', 'vintage-starter', 'ncaa-apparel'],
    brands: ['Nike', 'Mitchell & Ness', 'Adidas', 'Fanatics', 'Majestic', 'Reebok', 'Starter', 'Champion'],
    models: ['Swingman', 'Authentic', 'Replica', 'Game Jersey', 'Elite', 'Limited', 'Reverse Weave'],
  },
  'STREETWEAR': {
    subcategories: ['streetwear-brands', 'streetwear-japanese', 'streetwear-korean', 'streetwear-european', 'skate-brands', 'hype-limited'],
    brands: ['Supreme', 'BAPE', 'Palace', 'Stüssy', 'Thrasher', 'Neighborhood', 'WTAPS', 'Ader Error', 'Off-White', 'Fear of God'],
    models: ['Box Logo', 'Shark Hoodie', 'Tri-Ferg', 'Script Logo', 'Flame Logo', 'Specimen', 'Essentials'],
  },
  'OUTDOOR_TECHNICAL': {
    subcategories: ['outdoor-technical', 'mountaineering-alpine', 'hiking-trail', 'camping-bushcraft', 'fishing-marine'],
    brands: ['Arc\'teryx', 'Patagonia', 'The North Face', 'Fjallraven', 'Salomon', 'Filson', 'Mountain Hardwear'],
    models: ['Beta AR', 'Atom LT', 'Synchilla', 'Nuptse', 'Kanken', 'Mackinaw', 'Ghost Whisperer'],
  },
  'DESIGNER': {
    subcategories: ['luxury-fashion', 'designer-contemporary', 'designer-avant-garde', 'designer-minimalist', 'luxury-italian', 'luxury-french'],
    brands: ['Comme des Garçons', 'Yohji Yamamoto', 'Rick Owens', 'Margiela', 'Jil Sander', 'The Row', 'Loro Piana', 'Hermès'],
    models: ['GAT Replica', 'Play Converse', 'Geobasket', 'Common Projects', 'Birkin', 'Ramones'],
  },
  'HERITAGE_AMERICANA': {
    subcategories: ['workwear-heritage', 'western-shirts', 'flannel-shirts', 'oxford-button-downs', 'prep-ivy'],
    brands: ['Pendleton', 'Filson', 'Rockmount', 'Brooks Brothers', 'L.L.Bean', 'Woolrich', 'Red Wing'],
    models: ['Board Shirt', 'Mackinaw', 'Sawtooth', 'OCBD', 'Boat Tote', 'Iron Ranger', 'Arctic Parka'],
  },
  'ATHLETIC_VINTAGE': {
    subcategories: ['vintage-starter', 'vintage-champion', 'vintage-logo-athletic', 'hoodies-sweatshirts'],
    brands: ['Starter', 'Champion', 'Russell Athletic', 'Logo Athletic', 'Mitchell & Ness', 'Majestic'],
    models: ['Reverse Weave', 'Starter Jacket', 'Pullover Jacket', 'Cotton Fleece', 'Satin Jacket'],
  },
};

export default {
  MODEL_DATABASE,
  CATEGORY_HIERARCHY,
};
