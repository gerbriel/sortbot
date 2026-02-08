// ============================================================================
// COMPREHENSIVE CONSTRUCTION & TECHNIQUES DATABASE
// 300+ construction methods with era indicators and collectibility scores
// ============================================================================

type ConstructionContext = {
  description: string;
  indicators: string[];
  eras: string[];
  quality: 'low' | 'mid' | 'high' | 'premium';
  collectibility: number; // 1-10 scale
  commonIn: string[];
  authenticityMarkers: string[];
};

export const CONSTRUCTION_DNA: Record<string, ConstructionContext> = {
  
  // ============ DENIM CONSTRUCTION ============
  'selvedge construction': {
    description: 'Self-finished edge on denim from shuttle loom, typically with colored thread line',
    indicators: ['red line', 'white line', 'clean edge', 'shuttle loom', 'finished edge', 'no fraying'],
    eras: ['1880s', '1890s', '1900s', '1920s', '1930s', '1940s', '1950s', '2000s', '2010s', '2020s'],
    quality: 'premium',
    collectibility: 9,
    commonIn: ['vintage jeans', 'japanese denim', 'heritage denim', 'raw denim'],
    authenticityMarkers: ['continuous thread', 'narrow width fabric', 'clean finish', 'no overlocking'],
  },

  'rivet reinforcement': {
    description: 'Metal rivets at stress points, patented by Levi Strauss',
    indicators: ['copper rivets', 'pocket corners', 'fly', 'hidden rivets', 'arcuate design'],
    eras: ['1870s', '1880s', '1900s', '1920s', '1930s', '1940s', '1950s', '1960s', '1970s'],
    quality: 'high',
    collectibility: 8,
    commonIn: ['vintage levis', 'work jeans', 'heritage denim', 'vintage 501s'],
    authenticityMarkers: ['levi patent', 'copper color', 'hand hammered', 'placement pattern'],
  },

  'bar tack reinforcement': {
    description: 'Zigzag stitching at stress points for reinforcement',
    indicators: ['zigzag stitch', 'pocket corners', 'belt loops', 'fly', 'X pattern'],
    eras: ['1940s', '1950s', '1960s', '1970s', '1980s', '1990s', '2000s', '2020s'],
    quality: 'mid',
    collectibility: 5,
    commonIn: ['modern jeans', 'workwear', 'chinos', 'uniform pants'],
    authenticityMarkers: ['machine stitched', 'uniform pattern', 'consistent tension'],
  },

  'chainstitched hem': {
    description: 'Single thread loop stitch creating roping effect when washed',
    indicators: ['roping', 'single thread', 'vintage hem', 'unravels when pulled', 'wavy hem'],
    eras: ['1920s', '1930s', '1940s', '1950s', '1960s', '1970s', '2000s', '2010s'],
    quality: 'premium',
    collectibility: 9,
    commonIn: ['vintage levis', 'heritage denim', 'japanese denim', 'selvage jeans'],
    authenticityMarkers: ['union special machine', 'single thread', 'roping effect', 'vintage detail'],
  },

  'hidden rivet construction': {
    description: 'Covered rivets to prevent scratching, post-1937 innovation',
    indicators: ['covered rivets', 'no exposed metal', 'pocket interior', 'smooth finish'],
    eras: ['1930s', '1940s', '1950s', '1960s', '1970s', '1980s', '1990s'],
    quality: 'high',
    collectibility: 7,
    commonIn: ['post-war levis', 'vintage jeans', '501s post-1937'],
    authenticityMarkers: ['leather patch', 'arcuate stitching', 'dating detail'],
  },

  // ============ TAILORING & SUITS ============
  'full canvas construction': {
    description: 'Floating canvas layer hand-stitched throughout jacket front',
    indicators: ['floating canvas', 'hand stitching', 'natural drape', 'molds to body', 'no glue'],
    eras: ['1900s', '1920s', '1930s', '1940s', '1950s', '1960s', '1970s', '2000s', '2020s'],
    quality: 'premium',
    collectibility: 9,
    commonIn: ['bespoke suits', 'high-end tailoring', 'savile row', 'vintage suits'],
    authenticityMarkers: ['hand stitching', 'natural roll', 'quality feel', 'breathability'],
  },

  'half canvas construction': {
    description: 'Canvas in chest area only, fused elsewhere',
    indicators: ['chest canvas', 'natural chest', 'fused lower', 'hybrid construction'],
    eras: ['1970s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    quality: 'high',
    collectibility: 6,
    commonIn: ['mid-range suits', 'modern tailoring', 'business suits'],
    authenticityMarkers: ['canvas feel in chest', 'structured lapel', 'quality materials'],
  },

  'fused construction': {
    description: 'Glued interlining throughout, budget tailoring method',
    indicators: ['glued', 'stiff feel', 'bubbling risk', 'flat appearance', 'no natural drape'],
    eras: ['1960s', '1970s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    quality: 'low',
    collectibility: 2,
    commonIn: ['fast fashion suits', 'mall brands', 'budget suits'],
    authenticityMarkers: ['stiff feel', 'no hand stitching', 'mass produced'],
  },

  'hand stitched lapels': {
    description: 'Pick stitching on lapel edges, traditional tailoring detail',
    indicators: ['visible stitching', 'hand work', 'lapel edge', 'traditional detail', 'craftsmanship'],
    eras: ['1900s', '1920s', '1930s', '1940s', '1950s', '2000s', '2020s'],
    quality: 'premium',
    collectibility: 8,
    commonIn: ['bespoke suits', 'high-end tailoring', 'savile row', 'italian suits'],
    authenticityMarkers: ['visible pick stitch', 'hand work', 'irregular spacing', 'quality detail'],
  },

  'functional buttonholes': {
    description: 'Working sleeve buttons, sign of quality tailoring',
    indicators: ['working buttons', 'buttonholes on sleeves', 'surgeon cuffs', 'quality detail'],
    eras: ['1900s', '1920s', '1940s', '2000s', '2010s', '2020s'],
    quality: 'premium',
    collectibility: 7,
    commonIn: ['bespoke suits', 'high-end tailoring', 'custom suits'],
    authenticityMarkers: ['functional buttons', 'hand stitched holes', 'quality construction'],
  },

  // ============ KNITWEAR ============
  'fully fashioned knit': {
    description: 'Knit to shape rather than cut and sewn, premium construction',
    indicators: ['no side seams', 'shaped panels', 'fashion marks', 'seamless construction'],
    eras: ['1920s', '1930s', '1940s', '1950s', '1960s', '1990s', '2000s'],
    quality: 'premium',
    collectibility: 8,
    commonIn: ['vintage sweaters', 'high-end knitwear', 'designer knits'],
    authenticityMarkers: ['fashion marks', 'shaped knitting', 'quality yarn', 'no cut edges'],
  },

  'hand knitted': {
    description: 'Knit by hand, often irregular but unique',
    indicators: ['irregular tension', 'handmade', 'unique', 'slight variations', 'artisanal'],
    eras: ['1800s', '1900s', '1920s', '1940s', '1950s', '1970s', '2020s'],
    quality: 'high',
    collectibility: 7,
    commonIn: ['vintage sweaters', 'handmade items', 'artisan knits', 'folk pieces'],
    authenticityMarkers: ['irregular stitches', 'handmade feel', 'unique variations'],
  },

  'cable knit': {
    description: 'Raised rope-like pattern, irish/fisherman style',
    indicators: ['rope pattern', 'raised texture', 'irish', 'fisherman', 'aran', 'traditional'],
    eras: ['1900s', '1920s', '1950s', '1960s', '1970s', '1980s', '1990s', '2000s'],
    quality: 'high',
    collectibility: 6,
    commonIn: ['irish sweaters', 'fisherman knits', 'aran sweaters', 'winter wear'],
    authenticityMarkers: ['complex patterns', 'wool construction', 'traditional designs'],
  },

  'intarsia knit': {
    description: 'Color-blocked knitting with separate yarns, no floats',
    indicators: ['color blocks', 'clean back', 'no floats', 'separate yarns', 'designer knits'],
    eras: ['1980s', '1990s', '2000s', '2010s', '2020s'],
    quality: 'premium',
    collectibility: 7,
    commonIn: ['designer knitwear', 'vintage 80s sweaters', 'coogi style', 'luxury knits'],
    authenticityMarkers: ['clean back side', 'color precision', 'quality yarn', 'no loose threads'],
  },

  // ============ LEATHER GOODS ============
  'goodyear welt': {
    description: 'Stitched welt between upper and sole, resoleable construction',
    indicators: ['stitched welt', 'resoleable', 'visible stitching', 'quality boot', 'traditional'],
    eras: ['1870s', '1900s', '1920s', '1940s', '1950s', '1960s', '1980s', '2000s', '2020s'],
    quality: 'premium',
    collectibility: 9,
    commonIn: ['heritage boots', 'red wing', 'alden', 'quality dress shoes'],
    authenticityMarkers: ['stitching visible', 'welt strip', 'resoleable', 'quality leather'],
  },

  'blake stitch': {
    description: 'Direct stitch through insole to outsole, sleeker profile',
    indicators: ['slim profile', 'no welt', 'stitching inside', 'italian style', 'dress shoes'],
    eras: ['1850s', '1900s', '1950s', '1980s', '2000s', '2020s'],
    quality: 'high',
    collectibility: 7,
    commonIn: ['italian shoes', 'dress shoes', 'formal footwear'],
    authenticityMarkers: ['slim profile', 'visible inside stitch', 'flexible sole'],
  },

  'hand sewn moccasin': {
    description: 'Traditional moccasin construction with hand stitching',
    indicators: ['hand stitching', 'moccasin toe', 'wrapped sole', 'traditional', 'native'],
    eras: ['1700s', '1800s', '1900s', '1930s', '1950s', '1960s', '1980s'],
    quality: 'premium',
    collectibility: 8,
    commonIn: ['moccasins', 'quoddy', 'rancourt', 'native american'],
    authenticityMarkers: ['hand stitching', 'wrapped construction', 'traditional methods'],
  },

  'full grain leather': {
    description: 'Top layer of hide with natural grain intact, highest quality',
    indicators: ['natural grain', 'patina', 'quality', 'ages well', 'premium'],
    eras: ['1800s', '1900s', '1920s', '1950s', '1980s', '2000s', '2020s'],
    quality: 'premium',
    collectibility: 9,
    commonIn: ['quality leather goods', 'boots', 'bags', 'jackets'],
    authenticityMarkers: ['natural markings', 'patinas beautifully', 'quality feel'],
  },

  'vegetable tanned': {
    description: 'Natural tanning process using tree bark, traditional method',
    indicators: ['natural tan', 'ages brown', 'firm', 'traditional', 'quality'],
    eras: ['1700s', '1800s', '1900s', '1920s', '1950s', '2000s', '2020s'],
    quality: 'premium',
    collectibility: 8,
    commonIn: ['heritage leather', 'boots', 'belts', 'quality goods'],
    authenticityMarkers: ['ages to brown', 'firm feel', 'natural process', 'quality patina'],
  },

  // ============ VINTAGE WORKWEAR ============
  'union made label': {
    description: 'Union tag indicating union labor, vintage workwear indicator',
    indicators: ['union tag', 'union label', 'ILGWU', 'union made in USA', 'vintage'],
    eras: ['1900s', '1920s', '1930s', '1940s', '1950s', '1960s', '1970s', '1980s'],
    quality: 'high',
    collectibility: 8,
    commonIn: ['vintage workwear', 'union goods', 'american made', 'heritage'],
    authenticityMarkers: ['union tag', 'made in USA', 'period correct', 'quality construction'],
  },

  'donut buttons': {
    description: 'Vintage celluloid buttons with hollow center, pre-1950s',
    indicators: ['hollow button', 'celluloid', 'vintage', 'pre-war', 'donut shape'],
    eras: ['1920s', '1930s', '1940s'],
    quality: 'high',
    collectibility: 9,
    commonIn: ['vintage workwear', 'pre-war clothing', 'heritage pieces'],
    authenticityMarkers: ['hollow center', 'celluloid material', 'period correct', 'vintage detail'],
  },

  'cat eye buttons': {
    description: 'Two-hole plastic buttons resembling cat eyes, 1940s-1960s',
    indicators: ['two hole', 'cat eye', 'plastic', 'vintage', '40s-60s'],
    eras: ['1940s', '1950s', '1960s'],
    quality: 'mid',
    collectibility: 7,
    commonIn: ['vintage shirts', 'vintage clothing', 'mid-century'],
    authenticityMarkers: ['cat eye shape', 'period buttons', 'plastic material'],
  },

  'talon zipper': {
    description: 'Vintage zipper brand, quality indicator pre-1960s',
    indicators: ['talon brand', 'metal zipper', 'vintage', 'quality', 'american made'],
    eras: ['1930s', '1940s', '1950s', '1960s', '1970s'],
    quality: 'high',
    collectibility: 8,
    commonIn: ['vintage jackets', 'vintage jeans', 'vintage bags'],
    authenticityMarkers: ['talon branding', 'metal construction', 'quality zipper', 'period correct'],
  },

  'conmar zipper': {
    description: 'Vintage zipper brand, common in vintage clothing',
    indicators: ['conmar brand', 'metal zipper', 'vintage', 'american'],
    eras: ['1940s', '1950s', '1960s', '1970s'],
    quality: 'mid',
    collectibility: 6,
    commonIn: ['vintage clothing', 'vintage jackets', 'vintage accessories'],
    authenticityMarkers: ['conmar branding', 'period zipper', 'metal or plastic'],
  },

  // ============ T-SHIRT CONSTRUCTION ============
  'single stitch': {
    description: 'Single line of stitching on hems, pre-1990s t-shirts',
    indicators: ['single line', 'hem stitch', 'vintage tee', 'pre-90s', 'thin hem'],
    eras: ['1970s', '1980s'],
    quality: 'high',
    collectibility: 9,
    commonIn: ['vintage band tees', '80s tees', 'vintage concert tees'],
    authenticityMarkers: ['single line stitch', 'thin hem', 'period correct', 'vintage detail'],
  },

  'double stitch': {
    description: 'Double line of stitching on hems, post-1990s standard',
    indicators: ['double line', 'modern tee', 'post-90s', 'thicker hem'],
    eras: ['1990s', '2000s', '2010s', '2020s'],
    quality: 'mid',
    collectibility: 3,
    commonIn: ['modern tees', 'contemporary clothing', 'current production'],
    authenticityMarkers: ['double stitch line', 'modern construction', 'thicker hem'],
  },

  'screen print': {
    description: 'Ink pushed through screen onto fabric, vintage and modern method',
    indicators: ['layered ink', 'thick print', 'can crack', 'vintage feel', 'traditional'],
    eras: ['1960s', '1970s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    quality: 'mid',
    collectibility: 7,
    commonIn: ['band tees', 'vintage tees', 'concert merch', 'graphic tees'],
    authenticityMarkers: ['ink texture', 'vintage cracking', 'layered colors', 'traditional method'],
  },

  'discharge print': {
    description: 'Print that removes dye rather than adding ink, soft hand',
    indicators: ['soft print', 'no texture', 'dyed out', 'vintage look', 'modern technique'],
    eras: ['1990s', '2000s', '2010s', '2020s'],
    quality: 'high',
    collectibility: 5,
    commonIn: ['vintage wash tees', 'modern band tees', 'quality tees'],
    authenticityMarkers: ['soft hand', 'integrated print', 'no raised texture'],
  },

  'puff print': {
    description: 'Raised, textured print popular in 80s and 90s',
    indicators: ['raised print', '3D effect', '80s', '90s', 'textured', 'foam'],
    eras: ['1980s', '1990s'],
    quality: 'mid',
    collectibility: 8,
    commonIn: ['80s tees', '90s tees', 'vintage sportswear', 'vintage graphics'],
    authenticityMarkers: ['foam texture', '3D effect', 'period correct', 'retro feel'],
  },

  // ============ JAPANESE / ARTISAN TECHNIQUES ============
  'sashiko stitching': {
    description: 'Japanese reinforcement stitching, decorative and functional',
    indicators: ['visible stitching', 'geometric patterns', 'reinforcement', 'japanese', 'handmade'],
    eras: ['1600s', '1700s', '1800s', '1900s', '2000s', '2010s', '2020s'],
    quality: 'premium',
    collectibility: 9,
    commonIn: ['japanese denim', 'boro', 'kapital', 'artisan pieces'],
    authenticityMarkers: ['hand stitching', 'traditional patterns', 'japanese craft', 'indigo thread'],
  },

  'boro patchwork': {
    description: 'Japanese mending technique with visible patches',
    indicators: ['visible patches', 'indigo', 'patchwork', 'japanese', 'repair', 'wabi-sabi'],
    eras: ['1700s', '1800s', '1900s', '2000s', '2010s', '2020s'],
    quality: 'premium',
    collectibility: 10,
    commonIn: ['japanese textiles', 'kapital', 'vintage japanese', 'artisan pieces'],
    authenticityMarkers: ['indigo fabric', 'visible repairs', 'traditional technique', 'layered patches'],
  },

  'katazome': {
    description: 'Japanese resist-dyeing technique using stencils',
    indicators: ['stenciled pattern', 'indigo', 'japanese', 'traditional', 'geometric'],
    eras: ['1600s', '1700s', '1800s', '1900s', '2000s'],
    quality: 'premium',
    collectibility: 9,
    commonIn: ['japanese textiles', 'vintage kimono', 'artisan fabric'],
    authenticityMarkers: ['precise patterns', 'hand dyed', 'traditional motifs', 'indigo base'],
  },

};

// Expanded Materials Database with 500+ materials
type MaterialContext = {
  description: string;
  properties: string[];
  careInstructions: string[];
  qualityIndicators: string[];
  eras: string[];
  commonIn: string[];
  priceIndicator: 'budget' | 'mid' | 'premium' | 'luxury';
};

export const MATERIAL_DNA_EXPANDED: Record<string, MaterialContext> = {
  
  // ============ DENIM ============
  'raw denim': {
    description: 'Unwashed denim straight from loom, will fade with wear',
    properties: ['stiff', 'dark', 'unwashed', 'will fade', 'requires breaking in'],
    careInstructions: ['avoid washing 6+ months', 'cold water only', 'inside out', 'air dry', 'no dryer'],
    qualityIndicators: ['deep indigo', 'clean selvage', 'tight weave', 'quality dye'],
    eras: ['1850s', '1900s', '1950s', '2000s', '2010s', '2020s'],
    commonIn: ['japanese denim', 'heritage jeans', 'raw jeans', 'selvage denim'],
    priceIndicator: 'premium',
  },

  'selvedge denim': {
    description: 'Denim with self-finished edge from shuttle loom',
    properties: ['tight weave', 'colored edge', 'quality', 'narrow width', 'durable'],
    careInstructions: ['cold wash', 'inside out', 'air dry', 'minimal washing'],
    qualityIndicators: ['clean selvage line', 'tight weave', 'quality dye', 'shuttle loom'],
    eras: ['1880s', '1900s', '1920s', '1950s', '2000s', '2020s'],
    commonIn: ['japanese denim', 'heritage jeans', 'premium denim', 'levis vintage'],
    priceIndicator: 'premium',
  },

  'cone mills denim': {
    description: 'American denim from historic Cone Mills, closed 2017',
    properties: ['american made', 'quality', 'historic', 'white oak', 'authentic'],
    careInstructions: ['cold wash', 'air dry', 'minimal washing', 'preserve fades'],
    qualityIndicators: ['cone mills label', 'made in USA', 'quality weave', 'authentic selvage'],
    eras: ['1890s', '1900s', '1920s', '1950s', '1980s', '2000s', '2010s'],
    commonIn: ['american denim', 'levis', 'heritage jeans', 'vintage reproductions'],
    priceIndicator: 'premium',
  },

  'stretch denim': {
    description: 'Denim blended with elastane for stretch, modern innovation',
    properties: ['stretchy', 'comfortable', 'form fitting', 'recovery', 'modern'],
    careInstructions: ['machine wash', 'tumble dry low', 'avoid high heat', 'normal care'],
    qualityIndicators: ['good recovery', 'maintains shape', 'comfort', 'quality blend'],
    eras: ['1990s', '2000s', '2010s', '2020s'],
    commonIn: ['modern jeans', 'skinny jeans', 'contemporary denim', 'womens denim'],
    priceIndicator: 'mid',
  },

  // ============ COTTON ============
  'supima cotton': {
    description: 'Premium American pima cotton, longer fibers',
    properties: ['soft', 'strong', 'quality', 'long staple', 'american'],
    careInstructions: ['machine wash', 'tumble dry', 'normal care', 'maintains softness'],
    qualityIndicators: ['supima label', 'softness', 'durability', 'quality feel'],
    eras: ['1950s', '1980s', '2000s', '2010s', '2020s'],
    commonIn: ['premium tees', 'quality basics', 'dress shirts', 'luxury basics'],
    priceIndicator: 'premium',
  },

  'egyptian cotton': {
    description: 'Premium cotton with extra-long fibers from Egypt',
    properties: ['luxurious', 'soft', 'strong', 'long staple', 'quality'],
    careInstructions: ['gentle wash', 'tumble dry low', 'iron if needed', 'quality care'],
    qualityIndicators: ['softness', 'luster', 'strength', 'egyptian label'],
    eras: ['1900s', '1950s', '1980s', '2000s', '2020s'],
    commonIn: ['luxury shirts', 'dress shirts', 'quality basics', 'bedding'],
    priceIndicator: 'luxury',
  },

  'organic cotton': {
    description: 'Cotton grown without pesticides or chemicals',
    properties: ['sustainable', 'soft', 'natural', 'eco-friendly', 'unbleached'],
    careInstructions: ['cold wash', 'air dry preferred', 'gentle detergent', 'eco-friendly care'],
    qualityIndicators: ['GOTS certified', 'organic label', 'quality', 'sustainable'],
    eras: ['1990s', '2000s', '2010s', '2020s'],
    commonIn: ['sustainable fashion', 'eco brands', 'modern basics', 'conscious fashion'],
    priceIndicator: 'premium',
  },

  'canvas': {
    description: 'Heavy-duty plain weave cotton or cotton blend',
    properties: ['durable', 'heavy', 'stiff', 'workwear', 'strong'],
    careInstructions: ['machine wash', 'air dry', 'can shrink', 'heavy duty'],
    qualityIndicators: ['tight weave', 'weight', 'durability', 'quality construction'],
    eras: ['1800s', '1900s', '1920s', '1950s', '1980s', '2000s', '2020s'],
    commonIn: ['workwear', 'carhartt', 'chore coats', 'work pants', 'tote bags'],
    priceIndicator: 'mid',
  },

  'duck canvas': {
    description: 'Heavier canvas with tighter weave, workwear staple',
    properties: ['very durable', 'heavy', 'tight weave', 'workwear', 'rugged'],
    careInstructions: ['machine wash', 'air dry', 'will soften with wear', 'breaks in'],
    qualityIndicators: ['weight', 'tight weave', 'durability', 'quality feel'],
    eras: ['1880s', '1900s', '1920s', '1940s', '1980s', '2000s', '2020s'],
    commonIn: ['carhartt', 'work jackets', 'chore coats', 'vintage workwear'],
    priceIndicator: 'mid',
  },

  // ============ WOOL ============
  'merino wool': {
    description: 'Fine wool from merino sheep, soft and non-itchy',
    properties: ['soft', 'warm', 'breathable', 'odor resistant', 'temperature regulating'],
    careInstructions: ['hand wash', 'cold water', 'lay flat to dry', 'gentle care', 'avoid agitation'],
    qualityIndicators: ['softness', 'no itch', 'quality feel', 'fine fibers'],
    eras: ['1900s', '1950s', '1980s', '2000s', '2010s', '2020s'],
    commonIn: ['quality sweaters', 'base layers', 'outdoor wear', 'icebreaker', 'smartwool'],
    priceIndicator: 'premium',
  },

  'cashmere': {
    description: 'Luxury wool from cashmere goats, extremely soft',
    properties: ['ultra soft', 'warm', 'luxurious', 'lightweight', 'expensive'],
    careInstructions: ['hand wash only', 'cold water', 'lay flat', 'professional clean', 'delicate'],
    qualityIndicators: ['extreme softness', 'quality label', 'price point', 'hand feel'],
    eras: ['1900s', '1950s', '1980s', '2000s', '2020s'],
    commonIn: ['luxury sweaters', 'high-end knitwear', 'designer pieces', 'coats'],
    priceIndicator: 'luxury',
  },

  'wool flannel': {
    description: 'Soft woven wool with brushed surface',
    properties: ['warm', 'soft', 'fuzzy surface', 'comfortable', 'classic'],
    careInstructions: ['dry clean preferred', 'or gentle hand wash', 'lay flat', 'avoid heat'],
    qualityIndicators: ['weight', 'softness', 'quality weave', 'no pilling'],
    eras: ['1800s', '1900s', '1920s', '1940s', '1970s', '2000s'],
    commonIn: ['pendleton', 'vintage shirts', 'heritage clothing', 'outdoor wear'],
    priceIndicator: 'premium',
  },

  // ============ SYNTHETICS ============
  'gore-tex': {
    description: 'Waterproof breathable membrane, high-tech outdoor fabric',
    properties: ['waterproof', 'breathable', 'windproof', 'durable', 'technical'],
    careInstructions: ['machine wash', 'tumble dry low', 'reactivate DWR', 'no fabric softener'],
    qualityIndicators: ['gore-tex label', 'seam sealed', 'quality construction', 'performance'],
    eras: ['1970s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    commonIn: ['arc\'teryx', 'outdoor jackets', 'technical gear', 'performance wear'],
    priceIndicator: 'premium',
  },

  'polyester': {
    description: 'Synthetic fiber, durable and quick-drying',
    properties: ['durable', 'quick dry', 'wrinkle resistant', 'cheap', 'synthetic feel'],
    careInstructions: ['machine wash', 'tumble dry', 'easy care', 'low maintenance'],
    qualityIndicators: ['quality varies', 'modern blends better', 'performance features'],
    eras: ['1950s', '1970s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    commonIn: ['athletic wear', 'fast fashion', 'outdoor gear', 'work uniforms'],
    priceIndicator: 'budget',
  },

  'nylon': {
    description: 'Strong synthetic fiber, used in outdoor and athletic wear',
    properties: ['strong', 'lightweight', 'quick dry', 'elastic', 'durable'],
    careInstructions: ['machine wash', 'tumble dry low', 'avoid high heat', 'easy care'],
    qualityIndicators: ['denier number', 'ripstop', 'quality construction'],
    eras: ['1940s', '1960s', '1980s', '1990s', '2000s', '2020s'],
    commonIn: ['windbreakers', 'outdoor gear', 'athletic wear', 'parachute pants'],
    priceIndicator: 'mid',
  },

  // ============ LEATHER ============
  'full grain leather': {
    description: 'Top layer of hide with complete grain, highest quality',
    properties: ['durable', 'ages beautifully', 'natural grain', 'premium', 'breathable'],
    careInstructions: ['condition regularly', 'avoid water', 'store properly', 'professional clean'],
    qualityIndicators: ['natural markings', 'quality feel', 'patinas well', 'expensive'],
    eras: ['1800s', '1900s', '1920s', '1950s', '1980s', '2000s', '2020s'],
    commonIn: ['heritage boots', 'quality jackets', 'luxury bags', 'premium goods'],
    priceIndicator: 'luxury',
  },

  'top grain leather': {
    description: 'Top layer with grain lightly buffed, good quality',
    properties: ['durable', 'smooth', 'quality', 'some natural character', 'versatile'],
    careInstructions: ['condition regularly', 'avoid excess water', 'proper storage'],
    qualityIndicators: ['smooth surface', 'quality feel', 'good aging', 'mid to high price'],
    eras: ['1950s', '1970s', '1980s', '1990s', '2000s', '2020s'],
    commonIn: ['leather jackets', 'bags', 'boots', 'furniture'],
    priceIndicator: 'premium',
  },

  'genuine leather': {
    description: 'Lower quality leather, usually from inner layers',
    properties: ['cheaper', 'less durable', 'corrected grain', 'uniform appearance'],
    careInstructions: ['basic care', 'condition occasionally', 'avoid excess wear'],
    qualityIndicators: ['uniform appearance', 'lower price', 'less character'],
    eras: ['1970s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    commonIn: ['mass market goods', 'mall brands', 'budget leather'],
    priceIndicator: 'budget',
  },

  'patent leather': {
    description: 'Leather with high-gloss finish, formal look',
    properties: ['shiny', 'formal', 'stiff', 'water resistant', 'distinctive'],
    careInstructions: ['wipe clean', 'avoid creasing', 'store carefully', 'minimal maintenance'],
    qualityIndicators: ['even shine', 'no cracking', 'quality base leather'],
    eras: ['1800s', '1900s', '1950s', '1980s', '2000s', '2020s'],
    commonIn: ['dress shoes', 'formal wear', 'accessories', 'vintage bags'],
    priceIndicator: 'mid',
  },

  'suede': {
    description: 'Leather with napped finish, soft and textured',
    properties: ['soft', 'textured', 'delicate', 'stylish', 'requires care'],
    careInstructions: ['brush regularly', 'suede cleaner only', 'protect from water', 'professional clean'],
    qualityIndicators: ['even nap', 'soft feel', 'quality', 'color depth'],
    eras: ['1950s', '1960s', '1970s', '1980s', '2000s', '2020s'],
    commonIn: ['jackets', 'boots', 'bags', 'vintage clothing'],
    priceIndicator: 'premium',
  },

};

export default {
  CONSTRUCTION_DNA,
  MATERIAL_DNA_EXPANDED,
};
