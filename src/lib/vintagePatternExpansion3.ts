// ============================================================================
// MASSIVE BRAND DATABASE EXPANSION - PART 4
// Consumer & Fashion Brands A (5th Avenue through Avirex)
// ============================================================================

type PatternContext = {
  keywords: string[];
  vibes: string[];
  categories: string[];
  eras: string[];
  subculture: string[];
  pricePoint: 'budget' | 'mid' | 'premium' | 'luxury';
};

export const BRAND_DNA_EXPANSION_3: Record<string, PatternContext> = {

  '5th-avenue': {
    keywords: ['5th avenue', 'fifth avenue', '5th ave'],
    vibes: ['classic', 'vintage', 'classic american'],
    categories: ['tees', 'sweatshirts', 'hoodies'],
    eras: ['1980s', '1990s'],
    subculture: ['americana', 'vintage'],
    pricePoint: 'budget',
  },

  'a-bathing-ape': {
    keywords: ['a bathing ape', 'bape', 'bathing ape', 'aape', 'bapesta', 'baby milo', 'shark hoodie', 'bape camo', 'ape shall never kill ape'],
    vibes: ['japanese streetwear', 'hypebeast', 'bold', 'graphic', 'camo', 'collectible', 'celebrity'],
    categories: ['hoodies', 'tees', 'jackets', 'shoes', 'accessories'],
    eras: ['1990s', '2000s', '2010s', '2020s'],
    subculture: ['streetwear', 'japanese streetwear', 'hip-hop', 'hypebeast'],
    pricePoint: 'premium',
  },

  'a-cold-wall': {
    keywords: ['a-cold-wall', 'a cold wall', 'acw', 'samuel ross', 'a cold wall asterisk'],
    vibes: ['avant-garde', 'industrial', 'british', 'architectural', 'technical', 'art-forward'],
    categories: ['jackets', 'tees', 'pants', 'accessories'],
    eras: ['2010s', '2020s'],
    subculture: ['streetwear', 'designer streetwear', 'techwear', 'art'],
    pricePoint: 'premium',
  },

  'apc': {
    keywords: ['a.p.c.', 'apc', 'atelier de production et de creation', 'apc jeans', 'apc new standard', 'apc petit standard'],
    vibes: ['french minimalism', 'understated', 'quality basics', 'parisian', 'clean', 'refined'],
    categories: ['jeans', 'tees', 'jackets', 'bags', 'accessories'],
    eras: ['1990s', '2000s', '2010s', '2020s'],
    subculture: ['minimalist', 'french fashion', 'designer denim'],
    pricePoint: 'premium',
  },

  'act-iii': {
    keywords: ['act iii', 'act3', 'act three'],
    vibes: ['classic', 'vintage', 'womens', 'formal'],
    categories: ['dresses', 'blouses', 'pants'],
    eras: ['1980s', '1990s'],
    subculture: ['vintage', 'womens fashion'],
    pricePoint: 'mid',
  },

  'ag-jeans': {
    keywords: ['ag jeans', 'adriano goldschmied', 'ag denim', 'ag adriano', 'the graduate', 'the prima'],
    vibes: ['premium denim', 'california', 'sleek', 'modern', 'fitted', 'clean'],
    categories: ['jeans', 'pants', 'denim'],
    eras: ['2000s', '2010s', '2020s'],
    subculture: ['premium denim', 'california', 'designer denim'],
    pricePoint: 'premium',
  },

  'activision': {
    keywords: ['activision', 'activision game', 'activision logo'],
    vibes: ['gaming', 'nostalgia', 'gamer', 'promo', 'corporate'],
    categories: ['tees', 'hoodies'],
    eras: ['1990s', '2000s', '2010s'],
    subculture: ['gaming', 'pop culture', 'corporate promo'],
    pricePoint: 'budget',
  },

  'ami-paris': {
    keywords: ['ami paris', 'ami alexandre mattiussi', 'ami de coeur', 'ami heart logo'],
    vibes: ['parisian', 'casual luxury', 'romantic', 'chic', 'french', 'heart logo'],
    categories: ['tees', 'sweatshirts', 'jackets', 'pants', 'accessories'],
    eras: ['2010s', '2020s'],
    subculture: ['french fashion', 'luxury casual', 'streetwear-adjacent'],
    pricePoint: 'premium',
  },

  'apt-9': {
    keywords: ['apt 9', 'apt. 9', 'apt9', 'apartment 9'],
    vibes: ['classic', 'casual', 'basics', 'mall brand', 'everyday'],
    categories: ['tees', 'pants', 'polos', 'sweaters'],
    eras: ['1990s', '2000s', '2010s'],
    subculture: ['mall brand', 'basics', 'american casual'],
    pricePoint: 'budget',
  },

  'asos': {
    keywords: ['asos', 'asos design', 'asos edition', 'asos marketplace'],
    vibes: ['fast fashion', 'trendy', 'youthful', 'affordable', 'online', 'british'],
    categories: ['tees', 'jeans', 'dresses', 'jackets', 'accessories'],
    eras: ['2000s', '2010s', '2020s'],
    subculture: ['fast fashion', 'online retail', 'youth fashion'],
    pricePoint: 'budget',
  },

  'abercrombie-fitch': {
    keywords: ['abercrombie', 'abercrombie & fitch', 'abercrombie and fitch', 'a&f', 'moose logo', 'af'],
    vibes: ['preppy', 'all-american', 'youthful', 'casual', 'logo-heavy', 'early 2000s'],
    categories: ['tees', 'hoodies', 'jeans', 'jackets', 'polos'],
    eras: ['1990s', '2000s', '2010s', '2020s'],
    subculture: ['preppy', 'mall brand', 'americana', 'youth'],
    pricePoint: 'mid',
  },

  'aberdeen': {
    keywords: ['aberdeen', 'aberdeen brand'],
    vibes: ['classic', 'vintage', 'american'],
    categories: ['tees', 'sweatshirts'],
    eras: ['1980s', '1990s'],
    subculture: ['vintage', 'americana'],
    pricePoint: 'budget',
  },

  'acne-studios': {
    keywords: ['acne studios', 'acne', 'face logo', 'acne paper', 'max johannson', 'emotional denim'],
    vibes: ['scandinavian', 'minimalist', 'conceptual', 'cool', 'intellectual', 'understated luxury'],
    categories: ['jeans', 'jackets', 'tees', 'sweaters', 'accessories', 'bags'],
    eras: ['2000s', '2010s', '2020s'],
    subculture: ['scandinavian fashion', 'minimalist', 'luxury casual', 'designer'],
    pricePoint: 'premium',
  },

  'adidas': {
    keywords: ['adidas', 'addidas', 'three stripes', 'trefoil', 'originals', 'superstar', 'stan smith', 'gazelle', 'samba', 'adicolor', 'adidas sport', 'performance', 'climacool', 'techfit', 'response', 'ultra boost', 'nmd', 'yeezy', 'adidas by stella', 'adidas neo', 'adidas adi-dassler', 'adi', 'the brand with three stripes'],
    vibes: ['sporty', 'classic', 'streetwear', 'athletic', 'iconic', 'German', 'global'],
    categories: ['tees', 'hoodies', 'jackets', 'shoes', 'pants', 'sweatshirts', 'accessories'],
    eras: ['1970s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['streetwear', 'athletic', 'hip-hop', 'skateboarding', 'fashion'],
    pricePoint: 'mid',
  },

  'admyra': {
    keywords: ['admyra', 'admyra brand'],
    vibes: ['vintage', 'classic', 'womens'],
    categories: ['dresses', 'blouses', 'tops'],
    eras: ['1980s', '1990s'],
    subculture: ['vintage', 'womens fashion'],
    pricePoint: 'budget',
  },

  'aeropostale': {
    keywords: ['aeropostale', 'aero', 'aeropostale logo', 'aero postale'],
    vibes: ['teen fashion', 'casual', 'mall brand', 'logo wear', 'american', 'preppy-casual'],
    categories: ['tees', 'hoodies', 'jeans', 'sweatshirts'],
    eras: ['1990s', '2000s', '2010s'],
    subculture: ['mall brand', 'teen fashion', 'american casual'],
    pricePoint: 'budget',
  },

  'affliction': {
    keywords: ['affliction', 'affliction clothing', 'affliction tee', 'affliction biker', 'affliction skull'],
    vibes: ['biker', 'skull graphics', 'bold', 'dark', 'rock', 'MMA', 'tattoo-inspired'],
    categories: ['tees', 'hoodies', 'jackets'],
    eras: ['2000s', '2010s'],
    subculture: ['biker', 'rock', 'MMA', 'alternative'],
    pricePoint: 'mid',
  },

  'akris': {
    keywords: ['akris', 'akris punto', 'albert kriemler'],
    vibes: ['swiss luxury', 'refined', 'minimalist', 'tailored', 'sophisticated', 'womens luxury'],
    categories: ['jackets', 'dresses', 'pants', 'blazers'],
    eras: ['1990s', '2000s', '2010s', '2020s'],
    subculture: ['luxury fashion', 'womens luxury', 'minimalist'],
    pricePoint: 'luxury',
  },

  'alaia': {
    keywords: ['alaia', 'alaïa', 'azzedine alaia', 'alaia paris', 'alaia logo', 'alaia bodycon'],
    vibes: ['french luxury', 'body-conscious', 'sculptural', 'sexy', 'architectural', 'iconic'],
    categories: ['dresses', 'tops', 'shoes', 'bags'],
    eras: ['1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['french luxury', 'luxury fashion', 'designer'],
    pricePoint: 'luxury',
  },

  'alexander-mcqueen': {
    keywords: ['alexander mcqueen', 'mcqueen', 'lee mcqueen', 'skull scarf', 'savage beauty', 'bumster', 'mcqueen logo', 'sarah burton'],
    vibes: ['british', 'dark', 'theatrical', 'sculptural', 'subversive', 'bold', 'fashion-forward'],
    categories: ['jackets', 'dresses', 'shoes', 'accessories', 'tees'],
    eras: ['1990s', '2000s', '2010s', '2020s'],
    subculture: ['luxury fashion', 'avant-garde', 'british fashion', 'designer'],
    pricePoint: 'luxury',
  },

  'alexander-wang': {
    keywords: ['alexander wang', 'wang', 'a. wang', 'alexander wang logo', 'wang gang'],
    vibes: ['downtown NYC', 'edgy', 'cool', 'minimalist', 'sporty-luxe', 'party', 'body-conscious'],
    categories: ['tees', 'dresses', 'jackets', 'bags', 'shoes'],
    eras: ['2000s', '2010s', '2020s'],
    subculture: ['designer streetwear', 'luxury casual', 'NYC fashion'],
    pricePoint: 'premium',
  },

  'alexo': {
    keywords: ['alexo', 'alexo athletica', 'carry concealed'],
    vibes: ['womens athletic', 'tactical', 'functional', 'active'],
    categories: ['pants', 'leggings', 'activewear'],
    eras: ['2010s', '2020s'],
    subculture: ['athletic', 'tactical', 'womens fitness'],
    pricePoint: 'mid',
  },

  'alfred-dunner': {
    keywords: ['alfred dunner', 'alfred dunner collection'],
    vibes: ['classic', 'womens', 'mature', 'comfortable', 'casual'],
    categories: ['pants', 'tops', 'blouses', 'dresses'],
    eras: ['1980s', '1990s', '2000s'],
    subculture: ['womens fashion', 'classic', 'department store'],
    pricePoint: 'budget',
  },

  'all-that-jazz': {
    keywords: ['all that jazz', 'all that jazz brand'],
    vibes: ['vintage', 'womens', 'classic', 'casual'],
    categories: ['dresses', 'tops', 'blouses'],
    eras: ['1980s', '1990s'],
    subculture: ['vintage', 'womens fashion'],
    pricePoint: 'budget',
  },

  'allsaints': {
    keywords: ['allsaints', 'all saints', 'allsaints spitalfields', 'allsaints logo', 'ramskull'],
    vibes: ['british', 'edgy', 'rock-inspired', 'dark', 'urban', 'cool', 'moto'],
    categories: ['jackets', 'tees', 'dresses', 'jeans', 'accessories'],
    eras: ['2000s', '2010s', '2020s'],
    subculture: ['british fashion', 'rock', 'alternative', 'urban'],
    pricePoint: 'mid',
  },

  'alpha-industries': {
    keywords: ['alpha industries', 'alpha', 'ma-1', 'ma1', 'flight jacket', 'bomber alpha', 'alpha MA-1', 'alpha n-3b', 'alpha m65', 'alpha parka'],
    vibes: ['military', 'classic', 'bomber', 'utilitarian', 'iconic', 'American', 'heritage'],
    categories: ['jackets', 'bombers', 'parkas', 'outerwear'],
    eras: ['1960s', '1970s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['military surplus', 'streetwear', 'heritage', 'americana'],
    pricePoint: 'mid',
  },

  'amanda-smith': {
    keywords: ['amanda smith', 'amanda smith brand'],
    vibes: ['womens', 'classic', 'casual', 'professional'],
    categories: ['dresses', 'blazers', 'pants', 'tops'],
    eras: ['1990s', '2000s'],
    subculture: ['womens fashion', 'classic', 'professional'],
    pricePoint: 'mid',
  },

  'american-apparel': {
    keywords: ['american apparel', 'made in usa', 'american apparel tee', 'aa tee', 'flexfleece'],
    vibes: ['basics', 'made in USA', 'cotton', 'minimal', 'controversial', 'retro', 'blank canvas'],
    categories: ['tees', 'hoodies', 'sweatshirts', 'leggings', 'basics'],
    eras: ['1990s', '2000s', '2010s'],
    subculture: ['basics', 'americana', 'youth fashion', 'streetwear'],
    pricePoint: 'mid',
  },

  'american-eagle': {
    keywords: ['american eagle', 'american eagle outfitters', 'aeo', 'ae', 'ae jeans', 'american eagle denim', 'next level stretch', 'aerie'],
    vibes: ['casual american', 'youthful', 'denim-focused', 'everyday', 'preppy-casual', 'comfortable'],
    categories: ['jeans', 'tees', 'hoodies', 'sweatshirts', 'accessories'],
    eras: ['1990s', '2000s', '2010s', '2020s'],
    subculture: ['mall brand', 'american casual', 'youth fashion'],
    pricePoint: 'budget',
  },

  'amiri': {
    keywords: ['amiri', 'mike amiri', 'amiri jeans', 'amiri mx1', 'amiri thrasher', 'amiri logo', 'amiri bones'],
    vibes: ['LA luxury', 'rock and roll', 'distressed', 'bold', 'celebrity', 'edgy', 'premium denim'],
    categories: ['jeans', 'tees', 'jackets', 'shoes', 'accessories'],
    eras: ['2010s', '2020s'],
    subculture: ['luxury streetwear', 'LA fashion', 'celebrity', 'rock luxury'],
    pricePoint: 'luxury',
  },

  'and1': {
    keywords: ['and1', 'and 1', 'and1 basketball', 'and1 streetball', 'and1 mixtape'],
    vibes: ['basketball', 'streetball', '90s-2000s', 'athletic', 'urban', 'competitive'],
    categories: ['tees', 'shorts', 'shoes', 'jerseys', 'athletic'],
    eras: ['1990s', '2000s'],
    subculture: ['basketball', 'streetball', 'urban athletic', 'hip-hop'],
    pricePoint: 'budget',
  },

  'ann-taylor': {
    keywords: ['ann taylor', 'ann taylor loft', 'loft', 'ann taylor factory', 'at ann taylor'],
    vibes: ['professional womens', 'classic', 'polished', 'workwear', 'feminine', 'timeless'],
    categories: ['blazers', 'pants', 'dresses', 'blouses', 'tops'],
    eras: ['1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['professional womens', 'classic', 'workwear'],
    pricePoint: 'mid',
  },

  'anne-klein': {
    keywords: ['anne klein', 'anne klein ii', 'ak anne klein', 'anne klein new york'],
    vibes: ['classic womens', 'professional', 'timeless', 'elegant', 'polished'],
    categories: ['blazers', 'pants', 'dresses', 'blouses', 'accessories'],
    eras: ['1970s', '1980s', '1990s', '2000s'],
    subculture: ['womens fashion', 'classic', 'professional'],
    pricePoint: 'mid',
  },

  'anthropologie': {
    keywords: ['anthropologie', 'anthro', 'anthropologie brand', 'urban outfitters group'],
    vibes: ['bohemian', 'eclectic', 'feminine', 'artsy', 'romantic', 'whimsical', 'vintage-inspired'],
    categories: ['dresses', 'tops', 'jeans', 'accessories', 'sweaters'],
    eras: ['2000s', '2010s', '2020s'],
    subculture: ['boho', 'romantic', 'artsy', 'feminine'],
    pricePoint: 'mid',
  },

  'aquascutum': {
    keywords: ['aquascutum', 'aquascutum london', 'aquascutum check', 'aquascutum trench'],
    vibes: ['british heritage', 'classic', 'trench coat', 'check pattern', 'formal', 'refined', 'old money'],
    categories: ['trench coats', 'jackets', 'scarves', 'accessories'],
    eras: ['1950s', '1960s', '1970s', '1980s', '1990s', '2000s'],
    subculture: ['british heritage', 'old money', 'classic menswear'],
    pricePoint: 'premium',
  },

  'arcteryx': {
    keywords: ['arcteryx', 'arc\'teryx', 'arc teryx', 'archaeopteryx', 'alpha sv', 'beta sv', 'zeta', 'gamma', 'atom lt', 'cerium', 'covert', 'phase', 'rush', 'bora', 'norvan', 'gore-tex arcteryx', 'bird logo', 'arcteryx bird'],
    vibes: ['technical', 'premium outdoor', 'Canadian', 'minimalist design', 'performance', 'gorpcore', 'functional'],
    categories: ['jackets', 'shells', 'fleece', 'pants', 'bags', 'accessories'],
    eras: ['1990s', '2000s', '2010s', '2020s'],
    subculture: ['outdoor technical', 'gorpcore', 'premium outdoor', 'streetwear'],
    pricePoint: 'premium',
  },

  'arcticwear': {
    keywords: ['arcticwear', 'arctic wear', 'arctic gear', 'thinsulate arcticwear'],
    vibes: ['cold weather', 'functional', 'vintage outdoor', 'warmth', 'hunting', 'practical'],
    categories: ['jackets', 'fleece', 'pants', 'outerwear'],
    eras: ['1980s', '1990s', '2000s'],
    subculture: ['outdoor', 'hunting', 'cold weather'],
    pricePoint: 'budget',
  },

  'armani': {
    keywords: ['armani', 'giorgio armani', 'ga logo', 'armani collezioni', 'armani logo'],
    vibes: ['italian luxury', 'tailored', 'sophisticated', 'clean lines', 'neutral tones', 'timeless'],
    categories: ['suits', 'blazers', 'tees', 'jeans', 'accessories'],
    eras: ['1970s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['italian luxury', 'fashion', 'professional'],
    pricePoint: 'luxury',
  },

  'armani-exchange': {
    keywords: ['armani exchange', 'a/x', 'ax armani exchange', 'ax logo', 'armani ax'],
    vibes: ['club-ready', 'trendy', 'logo-forward', 'Italian-American', 'sporty-chic', 'youthful luxury'],
    categories: ['tees', 'jeans', 'hoodies', 'jackets', 'accessories'],
    eras: ['1990s', '2000s', '2010s', '2020s'],
    subculture: ['club wear', 'luxury accessible', 'Italian fashion'],
    pricePoint: 'mid',
  },

  'armani-jeans': {
    keywords: ['armani jeans', 'aj armani', 'armani jeans logo', 'armani denim'],
    vibes: ['italian denim', 'stylish', 'sleek', 'logo denim', 'fashion-forward'],
    categories: ['jeans', 'tops', 'jackets'],
    eras: ['1980s', '1990s', '2000s', '2010s'],
    subculture: ['italian fashion', 'designer denim', 'fashion'],
    pricePoint: 'mid',
  },

  'army': {
    keywords: ['army', 'us army', 'u.s. army', 'army issue', 'military issued', 'army surplus', 'army logo', 'army strong', 'army tee'],
    vibes: ['military', 'utilitarian', 'americana', 'tough', 'patriotic', 'authentic surplus'],
    categories: ['tees', 'jackets', 'pants', 'surplus', 'hats'],
    eras: ['1940s', '1950s', '1960s', '1970s', '1980s', '1990s', '2000s'],
    subculture: ['military surplus', 'americana', 'vintage military'],
    pricePoint: 'budget',
  },

  'arthouse': {
    keywords: ['arthouse', 'arthouse brand', 'art house clothing'],
    vibes: ['artistic', 'graphic', 'creative', 'indie', 'expressive'],
    categories: ['tees', 'hoodies', 'accessories'],
    eras: ['2000s', '2010s'],
    subculture: ['art', 'indie', 'graphic tees'],
    pricePoint: 'budget',
  },

  'aruba': {
    keywords: ['aruba', 'aruba brand', 'aruba clothing'],
    vibes: ['tropical', 'beach', 'resort', 'souvenir', 'vacation'],
    categories: ['tees', 'shorts', 'resort wear'],
    eras: ['1990s', '2000s'],
    subculture: ['tourist', 'souvenir', 'beach'],
    pricePoint: 'budget',
  },

  'asics': {
    keywords: ['asics', 'asics gel', 'onitsuka', 'onitsuka tiger', 'gel-kayano', 'gel-nimbus', 'gel-lyte', 'gel-cumulus', 'asics tiger', 'anima sana in corpore sano'],
    vibes: ['japanese athletic', 'running', 'performance', 'retro runner', 'colorful', 'technical'],
    categories: ['shoes', 'tees', 'shorts', 'activewear', 'jackets'],
    eras: ['1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['running', 'athletic', 'streetwear', 'retro runner'],
    pricePoint: 'mid',
  },

  'askardis-lambis': {
    keywords: ['askardis lambis', 'askardis', 'lambis'],
    vibes: ['vintage', 'independent', 'regional'],
    categories: ['tees', 'apparel'],
    eras: ['1980s', '1990s'],
    subculture: ['vintage', 'independent'],
    pricePoint: 'budget',
  },

  'aston-martin': {
    keywords: ['aston martin', 'aston martin racing', 'aston martin merchandise', 'aston martin f1', 'am wings'],
    vibes: ['luxury automotive', 'british', 'racing', 'exclusive', 'sophisticated', 'motorsport'],
    categories: ['tees', 'jackets', 'accessories', 'caps'],
    eras: ['2000s', '2010s', '2020s'],
    subculture: ['motorsport', 'automotive', 'luxury', 'racing'],
    pricePoint: 'premium',
  },

  'athleta': {
    keywords: ['athleta', 'athleta logo', 'gap athleta', 'athleta womens', 'athleta yoga'],
    vibes: ['womens athletic', 'yoga', 'activewear', 'sustainable', 'functional', 'premium athletic'],
    categories: ['leggings', 'tops', 'sports bras', 'jackets', 'shorts', 'activewear'],
    eras: ['2010s', '2020s'],
    subculture: ['athleisure', 'yoga', 'womens fitness', 'sustainable'],
    pricePoint: 'mid',
  },

  'avirex': {
    keywords: ['avirex', 'avirex leather', 'avirex jacket', 'avirex flight', 'avirex bomber', 'avirex usa', 'avirex type a2', 'avirex g1'],
    vibes: ['vintage military', 'leather bomber', 'American', 'retro cool', 'bold', 'NYC street', 'hip-hop'],
    categories: ['leather jackets', 'bombers', 'jackets', 'tees'],
    eras: ['1980s', '1990s', '2000s'],
    subculture: ['hip-hop', 'military surplus', 'streetwear', 'leather jackets'],
    pricePoint: 'mid',
  },

  'avisu': {
    keywords: ['avisu', 'avisu jeans', 'avisu denim', 'avisu japan'],
    vibes: ['japanese denim', 'premium', 'vintage wash', 'detailed'],
    categories: ['jeans', 'pants'],
    eras: ['2000s', '2010s'],
    subculture: ['japanese denim', 'denim heads'],
    pricePoint: 'premium',
  },

  'awake-ny': {
    keywords: ['awake ny', 'awake new york', 'awake logo', 'awake brand'],
    vibes: ['new york streetwear', 'graphic', 'urban', 'bold', 'community-driven'],
    categories: ['tees', 'hoodies', 'jackets', 'accessories'],
    eras: ['2010s', '2020s'],
    subculture: ['streetwear', 'new york', 'community'],
    pricePoint: 'mid',
  },

  'bdg': {
    keywords: ['bdg', 'bdg urban outfitters', 'bdg denim', 'bdg jeans'],
    vibes: ['trendy', 'young', 'affordable', 'indie adjacent', 'casual'],
    categories: ['jeans', 'tees', 'hoodies', 'shorts', 'dresses'],
    eras: ['2010s', '2020s'],
    subculture: ['indie', 'affordable fashion', 'youth'],
    pricePoint: 'budget',
  },

  'bll': {
    keywords: ['bll', 'bll brand'],
    vibes: ['vintage', 'obscure'],
    categories: ['tees', 'shirts'],
    eras: ['1990s', '2000s'],
    subculture: ['vintage'],
    pricePoint: 'budget',
  },

  'boss-hugo-boss': {
    keywords: ['boss hugo boss', 'hugo boss', 'boss orange', 'boss black', 'boss green', 'boss hugo', 'boss logo', 'boss suit'],
    vibes: ['german precision', 'corporate chic', 'tailored', 'premium casual', 'bold logo'],
    categories: ['suits', 'tees', 'jackets', 'pants', 'accessories', 'polos'],
    eras: ['1990s', '2000s', '2010s', '2020s'],
    subculture: ['business casual', 'luxury casual', 'european fashion'],
    pricePoint: 'premium',
  },

  'balenciaga': {
    keywords: ['balenciaga', 'triple s', 'balenciaga speed trainer', 'balenciaga track', 'balenciaga hoodie', 'demna', 'balenciaga tee', 'balenciaga logo'],
    vibes: ['avant-garde', 'oversized', 'luxury streetwear', 'fashion-forward', 'bold', 'designer hype'],
    categories: ['tees', 'hoodies', 'jackets', 'shoes', 'bags', 'pants'],
    eras: ['2010s', '2020s'],
    subculture: ['luxury', 'designer streetwear', 'hypebeast', 'fashion'],
    pricePoint: 'luxury',
  },

  'bally': {
    keywords: ['bally', 'bally switzerland', 'bally shoes', 'bally leather', 'bally bags'],
    vibes: ['swiss luxury', 'heritage', 'refined', 'leather craftsmanship', 'understated'],
    categories: ['shoes', 'bags', 'accessories', 'jackets'],
    eras: ['1980s', '1990s', '2000s', '2010s'],
    subculture: ['luxury', 'swiss fashion', 'heritage'],
    pricePoint: 'luxury',
  },

  'balmain': {
    keywords: ['balmain', 'balmain paris', 'olivier rousteing', 'balmain logo', 'balmain jeans', 'balmain jacket'],
    vibes: ['french luxury', 'bold', 'embellished', 'rock chic', 'glamorous', 'powerful'],
    categories: ['jackets', 'jeans', 'tees', 'dresses', 'suits'],
    eras: ['2000s', '2010s', '2020s'],
    subculture: ['luxury', 'french fashion', 'designer', 'celebrity'],
    pricePoint: 'luxury',
  },

  'bamboo-and-moon': {
    keywords: ['bamboo and moon', 'bamboo moon'],
    vibes: ['bohemian', 'natural', 'feminine', 'casual'],
    categories: ['dresses', 'tops', 'pants'],
    eras: ['2000s', '2010s'],
    subculture: ['bohemian', 'casual feminine'],
    pricePoint: 'budget',
  },

  'banana-republic': {
    keywords: ['banana republic', 'banana republic logo', 'banana republic factory', 'br factory', 'banana republic gap'],
    vibes: ['smart casual', 'polished', 'travel-ready', 'classic', 'office-ready', 'adult contemporary'],
    categories: ['pants', 'shirts', 'jackets', 'dresses', 'suits', 'tees'],
    eras: ['1990s', '2000s', '2010s', '2020s'],
    subculture: ['smart casual', 'preppy', 'business casual'],
    pricePoint: 'mid',
  },

  'barbour': {
    keywords: ['barbour', 'barbour wax', 'barbour jacket', 'barbour international', 'barbour beaufort', 'barbour bedale', 'waxed cotton', 'barbour quilted'],
    vibes: ['british heritage', 'country', 'waxed cotton', 'classic', 'equestrian', 'outdoorsman'],
    categories: ['jackets', 'outerwear', 'shirts', 'accessories'],
    eras: ['1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['british heritage', 'country', 'preppy', 'outdoor'],
    pricePoint: 'premium',
  },

  'batik-bay': {
    keywords: ['batik bay', 'batick bay', 'batik bay shirt'],
    vibes: ['tropical', 'casual', 'resort wear', 'colorful'],
    categories: ['shirts', 'tees'],
    eras: ['1990s', '2000s'],
    subculture: ['resort', 'tropical', 'casual'],
    pricePoint: 'budget',
  },

  'bear-usa': {
    keywords: ['bear usa', 'bear usa logo', 'bear usa sportswear'],
    vibes: ['vintage sportswear', 'americana', 'collegiate', 'athletic'],
    categories: ['tees', 'hoodies', 'sweatshirts'],
    eras: ['1980s', '1990s'],
    subculture: ['americana', 'vintage sports', 'collegiate'],
    pricePoint: 'budget',
  },

  'belstaff': {
    keywords: ['belstaff', 'belstaff jacket', 'belstaff wax', 'belstaff trialmaster', 'belstaff roadmaster', 'belstaff icon'],
    vibes: ['british heritage', 'motorcycle', 'adventure', 'rugged', 'iconic', 'waxed'],
    categories: ['jackets', 'coats', 'pants', 'accessories'],
    eras: ['1970s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['motorcycle', 'british heritage', 'adventurer', 'biker'],
    pricePoint: 'premium',
  },

  'ben-sherman': {
    keywords: ['ben sherman', 'ben sherman logo', 'ben sherman mod', 'ben sherman shirt', 'ben sherman check'],
    vibes: ['british mod', 'classic', 'tailored casual', 'ska', 'heritage'],
    categories: ['shirts', 'polos', 'jackets', 'tees'],
    eras: ['1960s', '1970s', '1980s', '1990s', '2000s', '2010s'],
    subculture: ['mod', 'british fashion', 'ska', 'rude boy'],
    pricePoint: 'mid',
  },

  'bench': {
    keywords: ['bench', 'bench clothing', 'bench logo', 'bench sportswear', 'bench brand'],
    vibes: ['british casual', 'urban', 'affordable', 'youthful', 'street casual'],
    categories: ['hoodies', 'tees', 'jackets', 'sweatshirts'],
    eras: ['2000s', '2010s'],
    subculture: ['british street', 'casual', 'youth'],
    pricePoint: 'budget',
  },

  'bermuda-bay': {
    keywords: ['bermuda bay', 'bermuda bay clothing'],
    vibes: ['tropical', 'resort', 'casual', 'vacation'],
    categories: ['shirts', 'tees', 'shorts'],
    eras: ['1990s', '2000s'],
    subculture: ['resort', 'vacation', 'tourist'],
    pricePoint: 'budget',
  },

  'bernardo-collection': {
    keywords: ['bernardo collection', 'bernardo', 'bernardo clothing'],
    vibes: ['classic womens', 'elegant', 'timeless'],
    categories: ['coats', 'jackets', 'outerwear'],
    eras: ['1990s', '2000s', '2010s'],
    subculture: ['classic womens', 'elegant'],
    pricePoint: 'mid',
  },

  'bershka': {
    keywords: ['bershka', 'bershka logo', 'inditex bershka', 'bershka fashion'],
    vibes: ['fast fashion', 'trendy', 'youthful', 'european', 'affordable'],
    categories: ['tees', 'jeans', 'dresses', 'jackets', 'pants'],
    eras: ['2000s', '2010s', '2020s'],
    subculture: ['fast fashion', 'youth', 'european street'],
    pricePoint: 'budget',
  },

  'betsy-barclay': {
    keywords: ['betsy barclay', 'betsybarclay', 'betsy barclay dress', 'betsy barclay womens'],
    vibes: ['classic womens', 'formal', 'mature', 'elegant', 'occasion wear'],
    categories: ['dresses', 'blouses', 'suits'],
    eras: ['1990s', '2000s', '2010s'],
    subculture: ['classic womens', 'formal', 'occasion'],
    pricePoint: 'mid',
  },

  'bill-blass': {
    keywords: ['bill blass', 'billblass', 'bill blass jeans', 'bill blass collection', 'bill blass sport'],
    vibes: ['american designer', 'classic luxury', 'polished', 'manhattan chic', 'timeless'],
    categories: ['suits', 'dresses', 'jeans', 'blazers', 'tops'],
    eras: ['1970s', '1980s', '1990s', '2000s'],
    subculture: ['american designer', 'classic luxury', 'upscale'],
    pricePoint: 'premium',
  },

  'billabong': {
    keywords: ['billabong', 'billabong logo', 'billabong surf', 'billabong boardshorts', 'billabong jacket'],
    vibes: ['surf', 'beach', 'laid-back', 'california', 'australian', 'youth'],
    categories: ['boardshorts', 'tees', 'hoodies', 'wetsuits', 'jackets'],
    eras: ['1980s', '1990s', '2000s', '2010s'],
    subculture: ['surf', 'beach', 'skate', 'australian'],
    pricePoint: 'mid',
  },

  'billy-plains': {
    keywords: ['billy plains', 'billy plains western', 'billy plains shirt'],
    vibes: ['western', 'vintage', 'cowboy', 'country'],
    categories: ['shirts', 'western shirts'],
    eras: ['1970s', '1980s', '1990s'],
    subculture: ['western', 'country', 'cowboy'],
    pricePoint: 'budget',
  },

  'birkenstock': {
    keywords: ['birkenstock', 'birkenstock arizona', 'birkenstock boston', 'birkenstock gizeh', 'birkenstocks', 'birk'],
    vibes: ['german heritage', 'comfort', 'earthy', 'boho', 'normcore', 'sustainable'],
    categories: ['sandals', 'shoes', 'clogs'],
    eras: ['1970s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['normcore', 'bohemian', 'outdoor', 'comfort'],
    pricePoint: 'mid',
  },

  'black-scale': {
    keywords: ['black scale', 'blvck scvle', 'black scale logo', 'black scale tee'],
    vibes: ['dark streetwear', 'occult', 'graphic', 'bold', 'underground'],
    categories: ['tees', 'hoodies', 'jackets', 'accessories'],
    eras: ['2010s'],
    subculture: ['streetwear', 'underground', 'dark aesthetic'],
    pricePoint: 'mid',
  },

  'burton': {
    keywords: ['burton', 'burton snowboards', 'burton board', 'burton outerwear', 'burton jacket', 'burton ak'],
    vibes: ['snowboard', 'mountain', 'technical', 'freestyle', 'winter sports', 'iconic'],
    categories: ['jackets', 'pants', 'outerwear', 'accessories', 'boards'],
    eras: ['1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['snowboard', 'mountain sports', 'winter', 'outdoor'],
    pricePoint: 'premium',
  },

  'blank-nyc': {
    keywords: ['blank nyc', 'blanknyc', 'blank nyc jeans', 'blank nyc jacket', 'blank nyc vegan leather'],
    vibes: ['edgy', 'new york', 'modern', 'fashion-forward', 'affordable premium'],
    categories: ['jeans', 'jackets', 'pants', 'skirts', 'shorts'],
    eras: ['2010s', '2020s'],
    subculture: ['new york fashion', 'edgy', 'modern'],
    pricePoint: 'mid',
  },

  'bleu-de-paname': {
    keywords: ['bleu de paname', 'bleu de paname paris', 'bdp brand'],
    vibes: ['french workwear', 'parisian', 'heritage', 'artisanal', 'classic'],
    categories: ['jackets', 'pants', 'shirts', 'outerwear'],
    eras: ['2000s', '2010s', '2020s'],
    subculture: ['french workwear', 'heritage', 'parisian'],
    pricePoint: 'premium',
  },

  'blundstone': {
    keywords: ['blundstone', 'blundstone boots', 'blundstone 500', 'blundstone chelsea', 'blunnies'],
    vibes: ['australian heritage', 'sturdy', 'practical', 'chelsea boot', 'workwear'],
    categories: ['boots', 'shoes'],
    eras: ['1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['workwear', 'outdoor', 'australian', 'heritage boots'],
    pricePoint: 'mid',
  },

  'boden': {
    keywords: ['boden', 'boden uk', 'johnnie boden', 'mini boden', 'boden clothing'],
    vibes: ['british casual', 'colorful', 'fun', 'family-friendly', 'classic with a twist'],
    categories: ['tees', 'dresses', 'pants', 'shirts', 'jackets'],
    eras: ['2000s', '2010s', '2020s'],
    subculture: ['british casual', 'family', 'colorful prep'],
    pricePoint: 'mid',
  },

  'bonclar': {
    keywords: ['bonclar', 'bonclar outerwear', 'bonclar jacket', 'bonclar canada'],
    vibes: ['canadian outerwear', 'functional', 'cold weather', 'classic'],
    categories: ['jackets', 'outerwear', 'coats'],
    eras: ['1980s', '1990s', '2000s'],
    subculture: ['canadian', 'outdoor', 'cold weather'],
    pricePoint: 'mid',
  },

  'bonita': {
    keywords: ['bonita', 'bonita clothing', 'bonita fashion'],
    vibes: ['casual', 'feminine', 'affordable', 'everyday'],
    categories: ['tops', 'dresses', 'pants'],
    eras: ['1990s', '2000s'],
    subculture: ['casual feminine'],
    pricePoint: 'budget',
  },

  'bottega-veneta': {
    keywords: ['bottega veneta', 'bv', 'intrecciato', 'bottega bag', 'bottega veneta leather', 'daniel lee bottega', 'jodie bag'],
    vibes: ['italian luxury', 'understated', 'quiet luxury', 'craftsmanship', 'woven leather', 'refined'],
    categories: ['bags', 'shoes', 'accessories', 'jackets', 'knitwear'],
    eras: ['2000s', '2010s', '2020s'],
    subculture: ['luxury', 'quiet luxury', 'italian fashion', 'designer'],
    pricePoint: 'luxury',
  },

  'brandy-melville': {
    keywords: ['brandy melville', 'brandy m', 'brandy melville tee', 'brandy melville one size'],
    vibes: ['california casual', 'youthful', 'beachy', 'minimalist teen', 'trendy'],
    categories: ['tees', 'tops', 'dresses', 'pants', 'accessories'],
    eras: ['2010s', '2020s'],
    subculture: ['california casual', 'youth', 'beach'],
    pricePoint: 'budget',
  },

  'brooks-and-dunn': {
    keywords: ['brooks and dunn', 'brooks dunn', 'brooks & dunn', 'brooks dunn country', 'brooks dunn merch'],
    vibes: ['country music', 'western', 'concert merch', 'nashville', 'vintage country'],
    categories: ['tees', 'shirts', 'accessories'],
    eras: ['1990s', '2000s'],
    subculture: ['country music', 'western', 'concert merch'],
    pricePoint: 'budget',
  },

  'brooks-brothers': {
    keywords: ['brooks brothers', 'brooks brothers logo', 'brooks brothers oxford', 'bb fleece', 'brooks brothers suit', 'makers and merchants'],
    vibes: ['american heritage', 'preppy', 'ivy league', 'classic', 'tailored', 'traditional'],
    categories: ['suits', 'shirts', 'ties', 'pants', 'jackets', 'polos'],
    eras: ['1960s', '1970s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['preppy', 'ivy league', 'americana', 'traditional'],
    pricePoint: 'premium',
  },

  'brunello-cucinelli': {
    keywords: ['brunello cucinelli', 'cucinelli', 'brunello cashmere', 'bc logo', 'brunello jacket'],
    vibes: ['italian luxury', 'quiet luxury', 'cashmere', 'earthy tones', 'understated', 'artisanal'],
    categories: ['knitwear', 'jackets', 'pants', 'shirts', 'coats'],
    eras: ['2000s', '2010s', '2020s'],
    subculture: ['quiet luxury', 'italian fashion', 'luxury', 'lifestyle'],
    pricePoint: 'luxury',
  },

  'buffalo-david-bitton': {
    keywords: ['buffalo david bitton', 'buffalo jeans', 'buffalo david', 'buffalo denim'],
    vibes: ['canadian denim', 'edgy', 'trendy', 'bold', 'contemporary casual'],
    categories: ['jeans', 'pants', 'tees', 'jackets'],
    eras: ['2000s', '2010s'],
    subculture: ['canadian fashion', 'denim', 'casual'],
    pricePoint: 'mid',
  },

  'burberry': {
    keywords: ['burberry', 'burberry check', 'burberry nova check', 'burberry trench', 'burberry logo', 'thomas burberry', 'burberry plaid', 'burberry brit'],
    vibes: ['british heritage', 'iconic check', 'trench coat', 'luxury', 'classic', 'quintessentially british'],
    categories: ['trench coats', 'scarves', 'jackets', 'tees', 'bags', 'accessories', 'polos'],
    eras: ['1960s', '1970s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['british heritage', 'luxury', 'chav', 'designer'],
    pricePoint: 'luxury',
  },

  'butter-goods': {
    keywords: ['butter goods', 'butter skateboarding', 'butter skate'],
    vibes: ['skate', 'underground', 'west coast', 'laid back', 'graphic'],
    categories: ['tees', 'hoodies', 'pants', 'caps', 'accessories'],
    eras: ['2010s', '2020s'],
    subculture: ['skate', 'streetwear', 'underground'],
    pricePoint: 'mid',
  },

  'cp-company': {
    keywords: ['cp company', 'c.p. company', 'stone island cp', 'cp company goggle', 'massimo osti', 'cp lens jacket'],
    vibes: ['italian sportswear', 'goggle jacket', 'military inspired', 'technical', 'urban utility'],
    categories: ['jackets', 'hoodies', 'tees', 'pants', 'accessories'],
    eras: ['1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['football casual', 'streetwear', 'italian fashion', 'luxury sportswear'],
    pricePoint: 'premium',
  },

  'cdc': {
    keywords: ['cdc', 'cdc brand', 'cdc apparel'],
    vibes: ['casual', 'generic', 'basics'],
    categories: ['tees', 'tops'],
    eras: ['1990s', '2000s'],
    subculture: ['casual'],
    pricePoint: 'budget',
  },

  'ccm': {
    keywords: ['ccm', 'ccm hockey', 'canadian cycle and motor', 'ccm skates'],
    vibes: ['hockey', 'canadian', 'athletic', 'team sports'],
    categories: ['jerseys', 'jackets', 'hoodies', 'accessories'],
    eras: ['1970s', '1980s', '1990s', '2000s', '2010s'],
    subculture: ['hockey', 'canadian sports', 'team sports'],
    pricePoint: 'mid',
  },

  'cabelas': {
    keywords: ['cabelas', "cabela's", 'cabela', 'cabelas hunting', 'cabelas outdoor'],
    vibes: ['hunting', 'outdoors', 'americana', 'rugged', 'functional'],
    categories: ['jackets', 'vests', 'pants', 'shirts', 'boots'],
    eras: ['1980s', '1990s', '2000s', '2010s'],
    subculture: ['hunting', 'outdoors', 'americana', 'rural'],
    pricePoint: 'mid',
  },

  'calvin-klein': {
    keywords: ['calvin klein', 'ck', 'ck jeans', 'calvin klein jeans', 'klein', 'calvin klein underwear', 'ck one', 'calvin klein denim'],
    vibes: ['minimalist', 'american fashion', 'clean lines', 'iconic', 'sensual', 'designer basics'],
    categories: ['jeans', 'tees', 'underwear', 'jackets', 'dresses', 'suits', 'accessories'],
    eras: ['1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['american fashion', 'minimalism', 'designer', 'mainstream luxury'],
    pricePoint: 'mid',
  },

  'campagnolo': {
    keywords: ['campagnolo', 'campagnolo cycling', 'campy', 'campagnolo components'],
    vibes: ['italian cycling', 'road cycling', 'performance', 'heritage cycling'],
    categories: ['cycling', 'jerseys', 'accessories'],
    eras: ['1970s', '1980s', '1990s', '2000s'],
    subculture: ['cycling', 'italian sports', 'road cycling'],
    pricePoint: 'premium',
  },

  'canada-goose': {
    keywords: ['canada goose', 'canada goose jacket', 'canada goose parka', 'goose down', 'expedition parka', 'chilliwack', 'kensington parka'],
    vibes: ['luxury outerwear', 'canadian', 'arctic ready', 'premium down', 'status symbol', 'urban parka'],
    categories: ['parkas', 'jackets', 'vests', 'accessories'],
    eras: ['2000s', '2010s', '2020s'],
    subculture: ['luxury outerwear', 'canadian', 'streetwear', 'status'],
    pricePoint: 'luxury',
  },

  'cape-cod': {
    keywords: ['cape cod', 'cape cod brand', 'cape cod apparel', 'cape cod souvenir'],
    vibes: ['coastal', 'new england', 'preppy', 'souvenir', 'nautical'],
    categories: ['tees', 'sweatshirts', 'accessories'],
    eras: ['1980s', '1990s', '2000s'],
    subculture: ['new england', 'preppy', 'coastal', 'tourist'],
    pricePoint: 'budget',
  },

  'carhartt-wip': {
    keywords: ['carhartt wip', 'carhartt work in progress', 'wip carhartt', 'carhartt wip jacket', 'carhartt wip detroit'],
    vibes: ['workwear streetwear', 'european streetwear', 'utilitarian', 'urban workwear', 'elevated basics'],
    categories: ['jackets', 'pants', 'tees', 'hoodies', 'accessories', 'bags'],
    eras: ['1990s', '2000s', '2010s', '2020s'],
    subculture: ['streetwear', 'european streetwear', 'skateboarding', 'workwear'],
    pricePoint: 'mid',
  },

  'chase-authentics': {
    keywords: ['chase authentics', 'chase authentics nascar', 'nascar chase authentics', 'chase racing'],
    vibes: ['nascar', 'racing', 'americana', 'motorsport', 'vintage racing'],
    categories: ['jackets', 'tees', 'shirts'],
    eras: ['1990s', '2000s'],
    subculture: ['nascar', 'motorsport', 'americana', 'racing'],
    pricePoint: 'mid',
  },

  'caribbean-joe': {
    keywords: ['caribbean joe', 'caribbean joe shirt', 'caribbean brand', 'tropical caribbean'],
    vibes: ['tropical', 'resort wear', 'casual', 'island vibes', 'relaxed'],
    categories: ['shirts', 'tees', 'shorts', 'dresses'],
    eras: ['1990s', '2000s'],
    subculture: ['resort wear', 'tropical', 'casual'],
    pricePoint: 'budget',
  },

  'carolina-herrera': {
    keywords: ['carolina herrera', 'ch carolina herrera', 'herrera', 'carolina herrera dress'],
    vibes: ['luxury', 'elegant', 'feminine', 'latin fashion', 'couture', 'sophisticated'],
    categories: ['dresses', 'suits', 'bags', 'accessories', 'jackets'],
    eras: ['1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['luxury fashion', 'latin fashion', 'high society'],
    pricePoint: 'luxury',
  },

  'cartoon-network': {
    keywords: ['cartoon network', 'cartoon network tee', 'cartoon network shirt', 'dexter', 'powerpuff girls', 'johnny bravo', 'samurai jack'],
    vibes: ['nostalgia', 'animation', 'pop culture', '90s cartoons', 'graphic'],
    categories: ['tees', 'hoodies', 'accessories'],
    eras: ['1990s', '2000s'],
    subculture: ['pop culture', 'nostalgia', 'animation', 'streetwear'],
    pricePoint: 'budget',
  },

  'cartier': {
    keywords: ['cartier', 'cartier love', 'cartier ring', 'cartier watch', 'cartier bracelet', 'cartier sunglasses', 'les must de cartier'],
    vibes: ['french luxury', 'iconic jewelry', 'timeless elegance', 'prestige', 'heritage'],
    categories: ['accessories', 'jewelry', 'watches', 'sunglasses'],
    eras: ['1970s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['luxury', 'french fashion', 'high society', 'jewelry'],
    pricePoint: 'luxury',
  },

  'crazy-shirts': {
    keywords: ['crazy shirts', 'crazy shirts hawaii', 'crazy shirts tee', 'crazy shirts souvenir'],
    vibes: ['hawaiian', 'souvenir', 'colorful', 'novelty', 'tourist'],
    categories: ['tees', 'shirts'],
    eras: ['1980s', '1990s', '2000s'],
    subculture: ['hawaii', 'tourist', 'novelty'],
    pricePoint: 'budget',
  },

  'casablanca': {
    keywords: ['casablanca', 'casablanca paris', 'casablanca brand', 'casablanca tennis', 'charaf tajer'],
    vibes: ['luxury sportswear', 'moroccan influence', 'tennis aesthetic', 'colorful', 'art deco', 'resort luxury'],
    categories: ['tees', 'shirts', 'jackets', 'pants', 'accessories'],
    eras: ['2010s', '2020s'],
    subculture: ['luxury streetwear', 'designer', 'new luxury', 'tennis'],
    pricePoint: 'luxury',
  },

  'caterpillar': {
    keywords: ['caterpillar', 'cat workwear', 'cat footwear', 'cat equipment', 'caterpillar boots', 'cat brand'],
    vibes: ['workwear', 'construction', 'rugged', 'industrial', 'heavy duty'],
    categories: ['boots', 'jackets', 'pants', 'tees', 'accessories'],
    eras: ['1990s', '2000s', '2010s'],
    subculture: ['workwear', 'construction', 'industrial', 'streetwear'],
    pricePoint: 'mid',
  },

  'champion': {
    keywords: ['champion', 'champion reverse weave', 'champion hoodie', 'champion sweatshirt', 'champion crewneck', 'champion tee', 'champion c logo'],
    vibes: ['american athletic', 'collegiate', 'reverse weave', 'heritage sportswear', 'classic athletic'],
    categories: ['hoodies', 'sweatshirts', 'tees', 'shorts', 'pants', 'jackets'],
    eras: ['1970s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['athletic', 'streetwear', 'collegiate', 'heritage sportswear'],
    pricePoint: 'mid',
  },

  'chanel': {
    keywords: ['chanel', 'chanel logo', 'chanel jacket', 'chanel bag', 'chanel cc', 'coco chanel', 'chanel suit', 'chanel tweed', 'chanel no 5'],
    vibes: ['french luxury', 'iconic', 'timeless elegance', 'couture', 'interlocking cc', 'quilted'],
    categories: ['jackets', 'bags', 'accessories', 'dresses', 'shoes', 'jewelry', 'tees'],
    eras: ['1950s', '1960s', '1970s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['high fashion', 'french luxury', 'couture', 'luxury'],
    pricePoint: 'luxury',
  },

  'chaps-ralph-lauren': {
    keywords: ['chaps', 'chaps ralph lauren', 'chaps by ralph lauren', 'chaps brand'],
    vibes: ['affordable ralph lauren', 'preppy', 'classic american', 'department store'],
    categories: ['shirts', 'polos', 'pants', 'jackets', 'suits'],
    eras: ['1990s', '2000s', '2010s'],
    subculture: ['preppy', 'classic american', 'mainstream'],
    pricePoint: 'budget',
  },

  'charles-tyrwhitt': {
    keywords: ['charles tyrwhitt', 'tyrwhitt', 'ct shirts', 'charles tyrwhitt shirt', 'ct london'],
    vibes: ['british menswear', 'dress shirts', 'formal', 'tailored', 'classic british'],
    categories: ['shirts', 'suits', 'ties', 'accessories'],
    eras: ['2000s', '2010s', '2020s'],
    subculture: ['british fashion', 'formal wear', 'menswear'],
    pricePoint: 'mid',
  },

  'chaus': {
    keywords: ['chaus', 'chaus brand', 'chaus womens', 'chaus new york'],
    vibes: ['womens fashion', 'office wear', 'classic', 'professional'],
    categories: ['blouses', 'tops', 'jackets', 'pants', 'dresses'],
    eras: ['1980s', '1990s', '2000s'],
    subculture: ['womens fashion', 'professional', 'mainstream'],
    pricePoint: 'mid',
  },

  'christopher-banks': {
    keywords: ['christopher banks', 'christopher & banks', 'christopher and banks', 'cj banks'],
    vibes: ['womens casual', 'classic', 'modest', 'middle america', 'comfortable'],
    categories: ['tops', 'pants', 'jackets', 'dresses', 'cardigans'],
    eras: ['2000s', '2010s'],
    subculture: ['womens fashion', 'mainstream', 'casual'],
    pricePoint: 'mid',
  },

  'chrome-hearts': {
    keywords: ['chrome hearts', 'chrome hearts cross', 'chrome hearts ring', 'chrome hearts hoodie', 'chrome hearts belt', 'ch cross', 'chrome hearts leather'],
    vibes: ['gothic luxury', 'biker luxury', 'silver jewelry', 'rock and roll luxury', 'handcrafted', 'edgy premium'],
    categories: ['jewelry', 'hoodies', 'tees', 'leather', 'accessories', 'eyewear'],
    eras: ['1990s', '2000s', '2010s', '2020s'],
    subculture: ['rock', 'biker', 'luxury streetwear', 'gothic', 'celebrity fashion'],
    pricePoint: 'luxury',
  },

  'clarks': {
    keywords: ['clarks', 'clarks shoes', 'clarks originals', 'clarks desert boot', 'wallabee', 'desert boot clarks', 'clarks wallabee'],
    vibes: ['british heritage', 'classic footwear', 'desert boot', 'wallabee', 'casual classic'],
    categories: ['shoes', 'boots', 'accessories'],
    eras: ['1960s', '1970s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['british fashion', 'mod', 'hip hop', 'streetwear', 'heritage'],
    pricePoint: 'mid',
  },

  'coach': {
    keywords: ['coach', 'coach bag', 'coach purse', 'coach leather', 'coach legacy', 'coach signature', 'coach new york', 'coach outlet'],
    vibes: ['american leather goods', 'heritage accessories', 'classic', 'preppy', 'accessible luxury'],
    categories: ['bags', 'purses', 'wallets', 'accessories', 'shoes', 'jackets'],
    eras: ['1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['american fashion', 'accessible luxury', 'preppy', 'mainstream designer'],
    pricePoint: 'premium',
  },

  'columbia': {
    keywords: ['columbia', 'columbia sportswear', 'columbia jacket', 'columbia fleece', 'columbia pfg', 'columbia omni-tech', 'bugaboo'],
    vibes: ['outdoor casual', 'functional', 'pacific northwest', 'family outdoor', 'reliable'],
    categories: ['jackets', 'fleece', 'pants', 'shirts', 'shoes', 'accessories'],
    eras: ['1990s', '2000s', '2010s', '2020s'],
    subculture: ['outdoor', 'gorpcore', 'americana', 'family outdoors'],
    pricePoint: 'mid',
  },

  'comme-des-garcons': {
    keywords: ['comme des garcons', 'cdg', 'rei kawakubo', 'comme des garçons', 'cdg play', 'cdg heart', 'play comme des garcons', 'junya watanabe cdg'],
    vibes: ['avant-garde', 'japanese fashion', 'deconstructed', 'iconic', 'conceptual', 'heart logo'],
    categories: ['tees', 'jackets', 'dresses', 'pants', 'accessories', 'shoes'],
    eras: ['1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['avant-garde', 'japanese fashion', 'high fashion', 'designer', 'streetwear'],
    pricePoint: 'luxury',
  },

  'converse': {
    keywords: ['converse', 'chuck taylor', 'all star', 'chucks', 'converse one star', 'jack purcell', 'converse high top', 'converse low top'],
    vibes: ['classic american', 'canvas sneaker', 'rock and roll', 'basketball heritage', 'versatile', 'timeless'],
    categories: ['shoes', 'sneakers', 'tees', 'accessories'],
    eras: ['1960s', '1970s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['punk', 'rock', 'skate', 'basketball', 'casual', 'streetwear'],
    pricePoint: 'mid',
  },

  'coperni': {
    keywords: ['coperni', 'coperni paris', 'swipe bag', 'coperni brand'],
    vibes: ['contemporary luxury', 'french design', 'futuristic', 'feminine', 'innovative'],
    categories: ['bags', 'dresses', 'tops', 'accessories'],
    eras: ['2010s', '2020s'],
    subculture: ['contemporary luxury', 'french fashion', 'high fashion'],
    pricePoint: 'luxury',
  },

  'cos': {
    keywords: ['cos', 'cos brand', 'cos clothing', 'cos store', 'collection of style'],
    vibes: ['minimalist', 'scandinavian', 'architectural', 'modern basics', 'clean design'],
    categories: ['tees', 'shirts', 'pants', 'jackets', 'dresses', 'knitwear'],
    eras: ['2000s', '2010s', '2020s'],
    subculture: ['minimalism', 'scandinavian design', 'contemporary fashion'],
    pricePoint: 'mid',
  },

  'cotton-on': {
    keywords: ['cotton on', 'cotton on brand', 'cotton on tee', 'cottonon'],
    vibes: ['australian fast fashion', 'casual basics', 'affordable', 'youth'],
    categories: ['tees', 'hoodies', 'pants', 'jackets', 'accessories'],
    eras: ['2000s', '2010s', '2020s'],
    subculture: ['fast fashion', 'australian fashion', 'casual'],
    pricePoint: 'budget',
  },

  'courreges': {
    keywords: ['courrèges', 'courreges', 'courrèges paris', 'courreges brand', 'courreges space age'],
    vibes: ['space age', 'mod', 'futuristic', 'french design', '60s fashion', 'geometric'],
    categories: ['dresses', 'jackets', 'tops', 'accessories'],
    eras: ['1960s', '1970s', '2010s', '2020s'],
    subculture: ['mod', 'space age', 'french fashion', 'avant-garde'],
    pricePoint: 'luxury',
  },

  'covington': {
    keywords: ['covington', 'covington brand', 'covington sears', 'covington clothing'],
    vibes: ['department store', 'classic', 'affordable basics', 'middle america'],
    categories: ['shirts', 'pants', 'jackets', 'basics'],
    eras: ['1990s', '2000s', '2010s'],
    subculture: ['mainstream', 'department store', 'casual'],
    pricePoint: 'budget',
  },

  'cowboys-turtle': {
    keywords: ["cowboys' turtle", 'cowboys turtle', 'cowboys turtle brand'],
    vibes: ['western', 'rodeo', 'americana', 'casual'],
    categories: ['tees', 'shirts'],
    eras: ['1990s', '2000s'],
    subculture: ['western', 'americana', 'rodeo'],
    pricePoint: 'budget',
  },

  'craftsman': {
    keywords: ['craftsman', 'craftsman brand', 'craftsman tools', 'craftsman apparel'],
    vibes: ['americana', 'tools', 'workwear', 'rugged'],
    categories: ['tees', 'shirts', 'jackets'],
    eras: ['1990s', '2000s', '2010s'],
    subculture: ['workwear', 'americana', 'tools'],
    pricePoint: 'budget',
  },

  'crocs': {
    keywords: ['crocs', 'crocs shoes', 'crocs clogs', 'jibbitz', 'crocs brand'],
    vibes: ['comfort', 'casual', 'polarizing', 'fun', 'colorful', 'foam clog'],
    categories: ['shoes', 'sandals', 'accessories'],
    eras: ['2000s', '2010s', '2020s'],
    subculture: ['comfort', 'casual', 'streetwear', 'normcore'],
    pricePoint: 'budget',
  },

  'croft-barrow': {
    keywords: ['croft & barrow', 'croft and barrow', 'croft barrow', 'kohls croft barrow'],
    vibes: ['department store', 'classic basics', 'affordable', 'comfortable'],
    categories: ['shirts', 'pants', 'jackets', 'polos', 'sweaters'],
    eras: ['1990s', '2000s', '2010s'],
    subculture: ['mainstream', 'department store', 'casual'],
    pricePoint: 'budget',
  },

  'cutler-and-gross': {
    keywords: ['cutler and gross', 'cutler & gross', 'cutler gross eyewear', 'cutler gross glasses'],
    vibes: ['british luxury eyewear', 'handcrafted', 'designer glasses', 'elegant'],
    categories: ['accessories', 'eyewear', 'sunglasses'],
    eras: ['1990s', '2000s', '2010s', '2020s'],
    subculture: ['luxury', 'british fashion', 'eyewear'],
    pricePoint: 'luxury',
  },

  'dc-shoes': {
    keywords: ['dc shoes', 'dc shoe co', 'dc skate shoes', 'dc brand', 'dc logo'],
    vibes: ['skate', 'action sports', '90s skate', 'street', 'youth'],
    categories: ['shoes', 'tees', 'hoodies', 'pants', 'accessories'],
    eras: ['1990s', '2000s', '2010s'],
    subculture: ['skate', 'action sports', 'streetwear'],
    pricePoint: 'mid',
  },

  'dc-comics': {
    keywords: ['dc comics', 'dc comic', 'batman tee', 'superman shirt', 'wonder woman', 'dc superhero'],
    vibes: ['comic book', 'superhero', 'pop culture', 'nostalgia', 'graphic'],
    categories: ['tees', 'hoodies', 'accessories'],
    eras: ['1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['pop culture', 'comics', 'nostalgia', 'streetwear'],
    pricePoint: 'budget',
  },

  'ddp': {
    keywords: ['ddp', 'ddp brand', 'ddp jeans', 'ddp clothing'],
    vibes: ['french street', 'casual', 'youth', 'urban'],
    categories: ['jeans', 'pants', 'tees', 'jackets'],
    eras: ['2000s', '2010s'],
    subculture: ['french fashion', 'casual', 'urban'],
    pricePoint: 'budget',
  },

  'dkny-jeans': {
    keywords: ['dkny jeans', 'dkny', 'donna karan new york jeans', 'dkny denim'],
    vibes: ['new york fashion', 'urban', 'contemporary', 'accessible designer'],
    categories: ['jeans', 'pants', 'tees', 'jackets', 'dresses'],
    eras: ['1990s', '2000s', '2010s'],
    subculture: ['new york fashion', 'contemporary', 'mainstream designer'],
    pricePoint: 'mid',
  },

  'daily-paper': {
    keywords: ['daily paper', 'daily paper brand', 'daily paper amsterdam', 'dpaper'],
    vibes: ['african heritage', 'amsterdam streetwear', 'cultural pride', 'contemporary', 'graphic'],
    categories: ['tees', 'hoodies', 'jackets', 'pants', 'accessories'],
    eras: ['2010s', '2020s'],
    subculture: ['streetwear', 'african heritage', 'amsterdam fashion', 'contemporary'],
    pricePoint: 'premium',
  },

  'danielle-guizio': {
    keywords: ['danielle guizio', 'guizio', 'danielle guizio nyc'],
    vibes: ['ny fashion', 'feminine', 'contemporary', 'downtown cool', 'Y2K revival'],
    categories: ['dresses', 'tops', 'pants', 'tees', 'accessories'],
    eras: ['2010s', '2020s'],
    subculture: ['ny fashion', 'contemporary luxury', 'downtown'],
    pricePoint: 'premium',
  },

  'delong': {
    keywords: ['delong', 'de long', 'delong jacket', 'delong varsity', 'delong letterman'],
    vibes: ['varsity', 'letterman', 'americana', 'collegiate', 'sports'],
    categories: ['jackets', 'varsity jackets'],
    eras: ['1970s', '1980s', '1990s', '2000s'],
    subculture: ['varsity', 'americana', 'collegiate', 'sports'],
    pricePoint: 'mid',
  },

  'denim-supply-ralph-lauren': {
    keywords: ['denim & supply', 'denim and supply', 'denim supply ralph lauren', 'denim supply'],
    vibes: ['american heritage', 'casual ralph lauren', 'denim', 'vintage inspired', 'workwear casual'],
    categories: ['jeans', 'shirts', 'jackets', 'tees', 'accessories'],
    eras: ['2010s'],
    subculture: ['american heritage', 'ralph lauren', 'casual'],
    pricePoint: 'mid',
  },

  'denim-tears': {
    keywords: ['denim tears', 'denim tears brand', 'tremaine emory', 'denim tears cotton wreath'],
    vibes: ['black americana', 'cultural commentary', 'artistic', 'cotton wreath', 'heritage'],
    categories: ['jeans', 'tees', 'hoodies', 'jackets', 'accessories'],
    eras: ['2010s', '2020s'],
    subculture: ['streetwear', 'black americana', 'artistic', 'luxury streetwear'],
    pricePoint: 'premium',
  },

  'desigual': {
    keywords: ['desigual', 'desigual brand', 'desigual clothing', 'desigual colorful'],
    vibes: ['colorful', 'eclectic', 'spanish fashion', 'bold prints', 'bohemian'],
    categories: ['dresses', 'tops', 'jackets', 'bags', 'accessories'],
    eras: ['2000s', '2010s'],
    subculture: ['european fashion', 'bohemian', 'colorful'],
    pricePoint: 'mid',
  },

  'disney': {
    keywords: ['disney', 'disney tee', 'disney shirt', 'mickey mouse', 'disney world', 'disneyland', 'disney vintage'],
    vibes: ['nostalgia', 'family', 'pop culture', 'graphic', 'theme park'],
    categories: ['tees', 'hoodies', 'accessories', 'jackets'],
    eras: ['1970s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['pop culture', 'nostalgia', 'streetwear', 'family'],
    pricePoint: 'budget',
  },

  'diesel': {
    keywords: ['diesel', 'diesel jeans', 'diesel denim', 'diesel brand', 'diesel logo', 'only the brave'],
    vibes: ['italian denim', 'edgy', 'bold', 'Y2K', 'provocative advertising', 'premium denim'],
    categories: ['jeans', 'tees', 'jackets', 'pants', 'accessories', 'shoes'],
    eras: ['1990s', '2000s', '2010s', '2020s'],
    subculture: ['denim', 'italian fashion', 'Y2K', 'mainstream designer'],
    pricePoint: 'premium',
  },

  'dime': {
    keywords: ['dime', 'dime mtl', 'dime montreal', 'dime skate', 'dime brand'],
    vibes: ['skate', 'montreal', 'ironic', 'cult following', 'retro skate', 'graphic'],
    categories: ['tees', 'hoodies', 'pants', 'caps', 'accessories'],
    eras: ['2010s', '2020s'],
    subculture: ['skate', 'streetwear', 'underground', 'montreal'],
    pricePoint: 'mid',
  },

  'dior': {
    keywords: ['dior', 'christian dior', 'dior homme', 'dior oblique', 'dior logo', 'new look dior', 'dior saddle', 'dior book tote'],
    vibes: ['french couture', 'parisian luxury', 'iconic', 'feminine', 'new look', 'heritage'],
    categories: ['dresses', 'jackets', 'bags', 'accessories', 'shoes', 'tees', 'perfume'],
    eras: ['1950s', '1960s', '1970s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['french luxury', 'couture', 'high fashion', 'luxury'],
    pricePoint: 'luxury',
  },

  'dockers': {
    keywords: ['dockers', 'dockers pants', 'dockers khaki', 'docker brand', 'dockers trousers'],
    vibes: ['khaki classic', 'american casual', 'workwear casual', 'dad style', 'comfortable'],
    categories: ['pants', 'shorts', 'shirts', 'jackets'],
    eras: ['1990s', '2000s', '2010s'],
    subculture: ['mainstream', 'american casual', 'workwear', 'dad style'],
    pricePoint: 'mid',
  },

  'doen': {
    keywords: ['doen', 'doen brand', 'doen dress', 'doen clothing', 'doen floral'],
    vibes: ['feminine', 'vintage inspired', 'floral', 'romantic', 'california boho'],
    categories: ['dresses', 'tops', 'skirts', 'accessories'],
    eras: ['2010s', '2020s'],
    subculture: ['bohemian', 'california fashion', 'feminine', 'contemporary'],
    pricePoint: 'premium',
  },

  'dolce-gabbana': {
    keywords: ['dolce gabbana', 'dolce & gabbana', 'd&g', 'dolce and gabbana', 'dg logo', 'dolce gabbana sicily'],
    vibes: ['italian luxury', 'maximalist', 'sicilian inspired', 'bold', 'sensual', 'baroque'],
    categories: ['tees', 'jackets', 'dresses', 'bags', 'accessories', 'shoes', 'suits'],
    eras: ['1990s', '2000s', '2010s', '2020s'],
    subculture: ['italian fashion', 'luxury', 'maximalist', 'celebrity fashion'],
    pricePoint: 'luxury',
  },

  'dr-martens': {
    keywords: ['dr martens', 'doc martens', 'dr. martens', 'docs', '1460', 'dm boots', 'airwair', 'dr marten'],
    vibes: ['punk', 'subculture classic', 'british heritage', 'durable', 'chunky sole', 'yellow stitching'],
    categories: ['boots', 'shoes', 'sandals', 'accessories'],
    eras: ['1960s', '1970s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['punk', 'skinhead', 'goth', 'grunge', 'alternative', 'british subculture'],
    pricePoint: 'mid',
  },

  'dsquared2': {
    keywords: ['dsquared2', 'dsquared', 'dsq2', 'dsquared2 jeans', 'dean dan caten'],
    vibes: ['canadian italian luxury', 'rockstar', 'denim focused', 'bold', 'provocative'],
    categories: ['jeans', 'tees', 'jackets', 'suits', 'accessories'],
    eras: ['2000s', '2010s', '2020s'],
    subculture: ['luxury fashion', 'rockstar', 'italian fashion', 'denim'],
    pricePoint: 'luxury',
  },

  'duluth-trading': {
    keywords: ['duluth trading', 'duluth trading co', 'duluth trading company', 'duluth firehose', 'buck naked'],
    vibes: ['workwear', 'americana', 'rugged', 'functional', 'midwestern'],
    categories: ['pants', 'shirts', 'jackets', 'overalls', 'accessories'],
    eras: ['2000s', '2010s', '2020s'],
    subculture: ['workwear', 'americana', 'outdoor', 'midwestern'],
    pricePoint: 'mid',
  },

  'dunbrooke': {
    keywords: ['dunbrooke', 'dunbrooke jacket', 'dunbrooke varsity', 'dunbrooke sports'],
    vibes: ['varsity', 'sports', 'americana', 'team wear', 'vintage sports'],
    categories: ['jackets', 'varsity jackets', 'tees'],
    eras: ['1970s', '1980s', '1990s'],
    subculture: ['sports', 'americana', 'varsity'],
    pricePoint: 'mid',
  },

  'elle': {
    keywords: ['elle', 'elle brand', 'elle magazine brand', 'elle apparel'],
    vibes: ['fashion', 'feminine', 'magazine brand', 'trendy', 'european'],
    categories: ['tees', 'tops', 'accessories', 'dresses'],
    eras: ['2000s', '2010s'],
    subculture: ['fashion', 'feminine', 'mainstream'],
    pricePoint: 'mid',
  },

  'ecko': {
    keywords: ['ecko', 'ecko unltd', 'marc ecko', 'ecko unlimited', 'rhino logo ecko'],
    vibes: ['90s hip hop', 'urban', 'graphic', 'streetwear', 'rhino logo'],
    categories: ['tees', 'hoodies', 'pants', 'jackets', 'accessories'],
    eras: ['1990s', '2000s'],
    subculture: ['hip hop', 'urban streetwear', '90s fashion', 'streetwear'],
    pricePoint: 'mid',
  },

  'ed-hardy': {
    keywords: ['ed hardy', 'ed hardy brand', 'christian audigier', 'don ed hardy', 'ed hardy tattoo', 'love kills slowly'],
    vibes: ['tattoo art', 'Y2K excess', 'bold graphics', 'rhinestones', 'rock n roll', 'celebrity'],
    categories: ['tees', 'hoodies', 'jackets', 'jeans', 'accessories'],
    eras: ['2000s', '2010s'],
    subculture: ['Y2K', 'celebrity fashion', 'rock', 'tattoo culture'],
    pricePoint: 'premium',
  },

  'eddie-bauer': {
    keywords: ['eddie bauer', 'eddie bauer down', 'eddie bauer jacket', 'eb logo', 'goose down eddie bauer'],
    vibes: ['pacific northwest', 'outdoor heritage', 'down jackets', 'americana outdoors', 'classic outdoor'],
    categories: ['jackets', 'fleece', 'shirts', 'pants', 'accessories'],
    eras: ['1970s', '1980s', '1990s', '2000s', '2010s'],
    subculture: ['outdoor', 'americana', 'heritage outdoor', 'gorpcore'],
    pricePoint: 'mid',
  },

  'element': {
    keywords: ['element', 'element skateboards', 'element brand', 'element skate'],
    vibes: ['skate', 'eco conscious skate', 'nature inspired', 'action sports'],
    categories: ['tees', 'hoodies', 'pants', 'accessories', 'shoes'],
    eras: ['1990s', '2000s', '2010s'],
    subculture: ['skate', 'action sports', 'streetwear'],
    pricePoint: 'mid',
  },

  'ellesse': {
    keywords: ['ellesse', 'ellesse brand', 'ellesse logo', 'ellesse tracksuit', 'ellesse tennis'],
    vibes: ['italian sportswear', 'retro tennis', 'casual sportswear', '80s sport', 'heritage'],
    categories: ['tees', 'tracksuits', 'jackets', 'shorts', 'accessories'],
    eras: ['1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['tennis', 'italian sports', 'football casual', 'retro sportswear'],
    pricePoint: 'mid',
  },

  'ely-cattleman': {
    keywords: ['ely cattleman', 'ely & walker', 'ely western', 'ely cattleman shirt', 'ely brand'],
    vibes: ['western', 'cowboy', 'pearl snap', 'rodeo', 'americana'],
    categories: ['shirts', 'western shirts'],
    eras: ['1970s', '1980s', '1990s', '2000s'],
    subculture: ['western', 'cowboy', 'americana', 'rodeo'],
    pricePoint: 'mid',
  },

  'emilio-pucci': {
    keywords: ['emilio pucci', 'pucci', 'pucci print', 'pucci pattern', 'pucci dress'],
    vibes: ['italian luxury', 'psychedelic prints', 'colorful', '60s fashion', 'resort wear', 'bold pattern'],
    categories: ['dresses', 'tops', 'accessories', 'scarves', 'bags'],
    eras: ['1960s', '1970s', '1980s', '1990s', '2000s', '2010s'],
    subculture: ['italian fashion', 'luxury', 'resort wear', 'high fashion'],
    pricePoint: 'luxury',
  },

  'emporio-armani': {
    keywords: ['emporio armani', 'ea7', 'emporio armani logo', 'emporio armani jeans', 'eagle logo armani'],
    vibes: ['italian contemporary', 'accessible armani', 'clean modern', 'logo-forward', 'sporty luxury'],
    categories: ['tees', 'jeans', 'jackets', 'suits', 'accessories', 'underwear'],
    eras: ['1990s', '2000s', '2010s', '2020s'],
    subculture: ['italian fashion', 'mainstream designer', 'luxury', 'contemporary'],
    pricePoint: 'premium',
  },

  'end-clothing': {
    keywords: ['end clothing', 'end', 'end launches', 'end store'],
    vibes: ['british retailer', 'curated streetwear', 'menswear', 'sneaker culture'],
    categories: ['tees', 'jackets', 'sneakers', 'accessories'],
    eras: ['2010s', '2020s'],
    subculture: ['streetwear', 'sneaker culture', 'british fashion'],
    pricePoint: 'premium',
  },

  'energie': {
    keywords: ['energie', 'energie jeans', 'energie brand', 'energie denim'],
    vibes: ['italian denim', 'edgy', 'youth', 'bold', 'trendy'],
    categories: ['jeans', 'pants', 'tees', 'jackets'],
    eras: ['1990s', '2000s'],
    subculture: ['italian fashion', 'denim', 'youth'],
    pricePoint: 'mid',
  },

  'engineered-garments': {
    keywords: ['engineered garments', 'eg brand', 'daiki suzuki', 'engineered garments jacket', 'eg bedford'],
    vibes: ['americana workwear', 'japanese made in usa', 'utilitarian', 'eclectic', 'vintage inspired'],
    categories: ['jackets', 'shirts', 'pants', 'vests', 'accessories'],
    eras: ['2000s', '2010s', '2020s'],
    subculture: ['workwear', 'japanese americana', 'streetwear', 'menswear'],
    pricePoint: 'premium',
  },

  'ermenegildo-zegna': {
    keywords: ['ermenegildo zegna', 'zegna', 'zegna suit', 'zegna fabric', 'zegna cashmere'],
    vibes: ['italian luxury menswear', 'tailoring', 'cashmere', 'quiet luxury', 'heritage'],
    categories: ['suits', 'shirts', 'ties', 'knitwear', 'accessories', 'jackets'],
    eras: ['1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['italian luxury', 'menswear', 'tailoring', 'quiet luxury'],
    pricePoint: 'luxury',
  },

  'escada': {
    keywords: ['escada', 'escada brand', 'escada suit', 'escada sport', 'escada jacket'],
    vibes: ['german luxury fashion', 'feminine', 'bold color', 'power dressing', 'elegant'],
    categories: ['suits', 'jackets', 'dresses', 'tops', 'accessories'],
    eras: ['1980s', '1990s', '2000s', '2010s'],
    subculture: ['luxury fashion', 'german fashion', 'power dressing', 'feminine luxury'],
    pricePoint: 'luxury',
  },

  'esprit': {
    keywords: ['esprit', 'esprit brand', 'esprit clothing', 'esprit hong kong', 'esprit logo'],
    vibes: ['80s casual', 'colorful basics', 'accessible', 'youthful', 'preppy casual'],
    categories: ['tees', 'shirts', 'jackets', 'pants', 'accessories'],
    eras: ['1980s', '1990s', '2000s'],
    subculture: ['preppy', 'casual', 'mainstream', '80s fashion'],
    pricePoint: 'mid',
  },

  'evan-picone': {
    keywords: ['evan-picone', 'evan picone', 'evan picone brand', 'evan picone suit'],
    vibes: ['classic womens fashion', 'professional', 'tailored', 'department store'],
    categories: ['suits', 'blazers', 'pants', 'skirts', 'dresses'],
    eras: ['1970s', '1980s', '1990s', '2000s'],
    subculture: ['womens fashion', 'professional', 'classic'],
    pricePoint: 'mid',
  },

  'es-footwear': {
    keywords: ['es footwear', 'es skate shoes', 'es shoes', 'emerica es'],
    vibes: ['skate shoes', 'technical skate', '90s skate', 'action sports'],
    categories: ['shoes', 'sneakers'],
    eras: ['1990s', '2000s', '2010s'],
    subculture: ['skate', 'action sports'],
    pricePoint: 'mid',
  },

  'everlane': {
    keywords: ['everlane', 'everlane brand', 'everlane basics', 'everlane tee', 'radical transparency'],
    vibes: ['sustainable basics', 'minimalist', 'transparent pricing', 'ethical fashion', 'clean aesthetic'],
    categories: ['tees', 'shirts', 'pants', 'jackets', 'shoes', 'accessories'],
    eras: ['2010s', '2020s'],
    subculture: ['sustainable fashion', 'minimalism', 'ethical fashion', 'contemporary'],
    pricePoint: 'mid',
  },

  'express': {
    keywords: ['express', 'express clothing', 'express brand', 'express mens', 'express womens'],
    vibes: ['mall fashion', 'professional casual', 'going out', 'trendy basics', 'contemporary'],
    categories: ['shirts', 'pants', 'jackets', 'dresses', 'jeans', 'accessories'],
    eras: ['1990s', '2000s', '2010s', '2020s'],
    subculture: ['mall brand', 'mainstream', 'professional casual'],
    pricePoint: 'mid',
  },

  'fabletics': {
    keywords: ['fabletics', 'fabletics brand', 'fabletics leggings', 'kate hudson fabletics'],
    vibes: ['activewear', 'athleisure', 'affordable workout', 'colorful', 'subscription'],
    categories: ['leggings', 'sports bras', 'jackets', 'shorts', 'tops'],
    eras: ['2010s', '2020s'],
    subculture: ['athleisure', 'activewear', 'fitness'],
    pricePoint: 'mid',
  },

  'faded-glory': {
    keywords: ['faded glory', 'faded glory walmart', 'faded glory brand'],
    vibes: ['walmart basics', 'affordable casual', 'everyday wear', 'family basics'],
    categories: ['tees', 'pants', 'jeans', 'shorts', 'jackets'],
    eras: ['1990s', '2000s', '2010s'],
    subculture: ['mainstream', 'budget fashion', 'casual'],
    pricePoint: 'budget',
  },

  'fear-of-god': {
    keywords: ['fear of god', 'fog', 'jerry lorenzo', 'fear of god essentials', 'fog essentials', 'fear of god hoodie'],
    vibes: ['luxury streetwear', 'LA aesthetic', 'elevated basics', 'religious themes', 'oversized'],
    categories: ['hoodies', 'tees', 'pants', 'jackets', 'shoes', 'accessories'],
    eras: ['2010s', '2020s'],
    subculture: ['luxury streetwear', 'LA fashion', 'hype', 'contemporary luxury'],
    pricePoint: 'luxury',
  },

  'fendi': {
    keywords: ['fendi', 'fendi logo', 'ff logo', 'fendi baguette', 'fendi peekaboo', 'fendi zucca', 'fendi fur', 'karl lagerfeld fendi'],
    vibes: ['italian luxury', 'double f logo', 'fur heritage', 'roman fashion', 'iconic bags', 'craftsmanship'],
    categories: ['bags', 'accessories', 'jackets', 'tees', 'shoes', 'dresses', 'fur'],
    eras: ['1970s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['italian luxury', 'high fashion', 'luxury', 'roman heritage'],
    pricePoint: 'luxury',
  },

  'fila': {
    keywords: ['fila', 'fila brand', 'fila logo', 'fila sneakers', 'fila disruptor', 'fila tennis', 'fila tracksuit'],
    vibes: ['italian sportswear heritage', 'tennis classic', 'retro athletic', '90s revival', 'chunky sneakers'],
    categories: ['sneakers', 'tees', 'tracksuits', 'jackets', 'accessories'],
    eras: ['1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['tennis', 'italian sportswear', 'streetwear', 'retro athletic'],
    pricePoint: 'mid',
  },

  'fjallraven': {
    keywords: ['fjallraven', 'fjällräven', 'kanken', 'fjallraven kanken', 'fjallraven jacket', 'vidda', 'greenland jacket', 'g1000'],
    vibes: ['swedish outdoor', 'functional design', 'kanken backpack', 'nature inspired', 'sustainable'],
    categories: ['jackets', 'bags', 'pants', 'shirts', 'accessories'],
    eras: ['1990s', '2000s', '2010s', '2020s'],
    subculture: ['outdoor', 'gorpcore', 'scandinavian design', 'sustainable fashion'],
    pricePoint: 'premium',
  },

  'fubu': {
    keywords: ['fubu', 'fubu brand', 'fubu clothing', 'for us by us', 'fubu logo', 'fubu hip hop'],
    vibes: ['90s hip hop', 'black owned', 'urban fashion', 'streetwear', 'for us by us'],
    categories: ['tees', 'hoodies', 'jackets', 'pants', 'accessories'],
    eras: ['1990s', '2000s'],
    subculture: ['hip hop', 'urban streetwear', 'black fashion', '90s fashion'],
    pricePoint: 'mid',
  },

  'fox-racing': {
    keywords: ['fox racing', 'fox brand', 'fox moto', 'fox head logo', 'fox motocross'],
    vibes: ['motocross', 'action sports', 'dirt bike', 'aggressive', 'youth'],
    categories: ['tees', 'hoodies', 'jackets', 'pants', 'accessories'],
    eras: ['1990s', '2000s', '2010s'],
    subculture: ['motocross', 'action sports', 'extreme sports'],
    pricePoint: 'mid',
  },

  'ford-motorsport': {
    keywords: ['ford motorsport', 'ford racing', 'ford motor', 'ford performance', 'ford tee'],
    vibes: ['motorsport', 'americana', 'racing heritage', 'automotive'],
    categories: ['tees', 'jackets', 'hats', 'accessories'],
    eras: ['1980s', '1990s', '2000s'],
    subculture: ['motorsport', 'americana', 'car culture'],
    pricePoint: 'budget',
  },

  'forever-21': {
    keywords: ['forever 21', 'forever21', 'f21', 'forever 21 brand'],
    vibes: ['fast fashion', 'trendy', 'affordable', 'youth', 'mall'],
    categories: ['tees', 'dresses', 'tops', 'pants', 'jackets', 'accessories'],
    eras: ['2000s', '2010s', '2020s'],
    subculture: ['fast fashion', 'mall brand', 'youth fashion'],
    pricePoint: 'budget',
  },

  'frame': {
    keywords: ['frame', 'frame denim', 'frame brand', 'frame jeans', 'frame le skinny'],
    vibes: ['LA denim', 'clean minimalist', 'premium denim', 'effortless style', 'contemporary'],
    categories: ['jeans', 'pants', 'tops', 'dresses', 'shirts'],
    eras: ['2010s', '2020s'],
    subculture: ['LA fashion', 'premium denim', 'contemporary luxury'],
    pricePoint: 'premium',
  },

  'fred-perry': {
    keywords: ['fred perry', 'fred perry polo', 'laurel wreath', 'fred perry twin tip', 'fred perry mod'],
    vibes: ['british heritage', 'mod classic', 'tennis heritage', 'subcultural icon', 'twin tipped'],
    categories: ['polos', 'tees', 'tracksuits', 'jackets', 'accessories', 'shoes'],
    eras: ['1960s', '1970s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['mod', 'skinhead', 'british fashion', 'football casual', 'tennis'],
    pricePoint: 'mid',
  },

  'free-people': {
    keywords: ['free people', 'free people brand', 'fp brand', 'free people dress', 'urban outfitters free people'],
    vibes: ['bohemian', 'feminine', 'flowy', 'vintage inspired', 'festival fashion', 'eclectic'],
    categories: ['dresses', 'tops', 'jeans', 'jackets', 'accessories', 'sweaters'],
    eras: ['2000s', '2010s', '2020s'],
    subculture: ['bohemian', 'festival fashion', 'feminine', 'vintage inspired'],
    pricePoint: 'premium',
  },

  'fruit-of-the-loom': {
    keywords: ['fruit of the loom', 'fotl', 'fruit of loom', 'fruit loom tee', 'fruit of the loom hoodie'],
    vibes: ['american basics', 'blank canvas', 'affordable', 'everyday staple', 'classic'],
    categories: ['tees', 'underwear', 'hoodies', 'sweatshirts', 'socks'],
    eras: ['1970s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['basics', 'americana', 'streetwear blank'],
    pricePoint: 'budget',
  },

  'g-star-raw': {
    keywords: ['g-star', 'g star raw', 'g-star raw', 'gstar', 'g star denim', 'g star jacket', 'raw denim g star'],
    vibes: ['dutch denim', 'architectural design', 'raw denim', 'deconstructed', 'urban'],
    categories: ['jeans', 'jackets', 'tees', 'pants', 'accessories'],
    eras: ['2000s', '2010s', '2020s'],
    subculture: ['denim', 'european fashion', 'urban', 'contemporary'],
    pricePoint: 'premium',
  },

  'g-unit': {
    keywords: ['g-unit', 'g unit', 'g unit clothing', '50 cent brand', 'g unit records'],
    vibes: ['hip hop', 'early 2000s rap', 'urban', 'streetwear', '50 cent'],
    categories: ['tees', 'hoodies', 'jackets', 'pants', 'accessories'],
    eras: ['2000s'],
    subculture: ['hip hop', 'urban streetwear', 'rap culture'],
    pricePoint: 'mid',
  },

  'gap': {
    keywords: ['gap', 'gap brand', 'the gap', 'gap logo', 'gap tee', 'gap hoodie', 'gap jeans', 'gap kids'],
    vibes: ['american classic', 'clean basics', 'mall anchor', 'accessible', 'family staple'],
    categories: ['tees', 'jeans', 'hoodies', 'shirts', 'jackets', 'pants', 'accessories'],
    eras: ['1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['mainstream', 'american classic', 'mall brand', 'basics'],
    pricePoint: 'mid',
  },

  'gas-jeans': {
    keywords: ['gas', 'gas jeans', 'gas brand', 'gas denim'],
    vibes: ['italian denim', 'contemporary', 'premium denim', 'european'],
    categories: ['jeans', 'pants', 'tees', 'jackets'],
    eras: ['1990s', '2000s', '2010s'],
    subculture: ['italian fashion', 'denim', 'european'],
    pricePoint: 'premium',
  },

  'ganni': {
    keywords: ['ganni', 'ganni brand', 'ganni dress', 'ganni copenhagen', 'ganni floral'],
    vibes: ['scandinavian fashion', 'playful', 'colorful', 'feminine', 'contemporary', 'sustainable'],
    categories: ['dresses', 'tops', 'pants', 'jackets', 'accessories', 'shoes'],
    eras: ['2010s', '2020s'],
    subculture: ['scandinavian fashion', 'contemporary luxury', 'sustainable fashion'],
    pricePoint: 'premium',
  },

  'gildan': {
    keywords: ['gildan', 'gildan brand', 'gildan tee', 'gildan hoodie', 'gildan sweatshirt', 'gildan blank'],
    vibes: ['blank basics', 'affordable', 'screen print staple', 'event merch', 'classic'],
    categories: ['tees', 'hoodies', 'sweatshirts', 'tank tops', 'shorts'],
    eras: ['1990s', '2000s', '2010s', '2020s'],
    subculture: ['basics', 'merch', 'streetwear blank'],
    pricePoint: 'budget',
  },

  'givenchy': {
    keywords: ['givenchy', 'givenchy brand', 'givenchy logo', 'hubert de givenchy', 'givenchy rottweiler', 'givenchy tee', 'tisci givenchy'],
    vibes: ['french luxury', 'dark romantic', 'menswear edge', 'gothic luxury', 'couture heritage'],
    categories: ['tees', 'jackets', 'bags', 'dresses', 'accessories', 'shoes'],
    eras: ['1990s', '2000s', '2010s', '2020s'],
    subculture: ['french luxury', 'high fashion', 'luxury streetwear', 'gothic luxury'],
    pricePoint: 'luxury',
  },

  'gloria-vanderbilt': {
    keywords: ['gloria vanderbilt', 'gloria vanderbilt jeans', 'gloria vanderbilt brand', 'gv jeans'],
    vibes: ['american denim heritage', 'womens jeans', '80s jeans', 'classic fit', 'designer denim'],
    categories: ['jeans', 'pants', 'tops', 'accessories'],
    eras: ['1970s', '1980s', '1990s', '2000s'],
    subculture: ['american fashion', 'denim', 'classic'],
    pricePoint: 'mid',
  },

  'golden-goose': {
    keywords: ['golden goose', 'ggdb', 'golden goose sneakers', 'superstar golden goose', 'distressed sneakers golden goose'],
    vibes: ['italian luxury sneakers', 'pre-distressed', 'effortless cool', 'star patch', 'artisanal'],
    categories: ['sneakers', 'tees', 'jackets', 'accessories'],
    eras: ['2010s', '2020s'],
    subculture: ['luxury sneakers', 'italian fashion', 'contemporary luxury'],
    pricePoint: 'luxury',
  },

  'good-american': {
    keywords: ['good american', 'good american jeans', 'khloe kardashian jeans', 'good american denim'],
    vibes: ['inclusive sizing', 'LA denim', 'body positive', 'premium casual', 'celebrity brand'],
    categories: ['jeans', 'pants', 'tops', 'dresses', 'activewear'],
    eras: ['2010s', '2020s'],
    subculture: ['LA fashion', 'body positive', 'celebrity brand', 'denim'],
    pricePoint: 'premium',
  },

  'gucci': {
    keywords: ['gucci', 'gucci logo', 'gg logo', 'gucci monogram', 'gucci bag', 'gucci belt', 'gucci horsebit', 'gucci snake', 'gucci flora', 'tom ford gucci', 'alessandro michele'],
    vibes: ['italian luxury', 'maximalist', 'iconic monogram', 'eclectic', 'heritage meets modern', 'gg canvas'],
    categories: ['bags', 'accessories', 'tees', 'jackets', 'shoes', 'belts', 'hats', 'dresses'],
    eras: ['1970s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['italian luxury', 'high fashion', 'luxury', 'streetwear'],
    pricePoint: 'luxury',
  },

  'guess': {
    keywords: ['guess', 'guess brand', 'guess jeans', 'guess logo', 'guess triangle logo', 'guess by marciano'],
    vibes: ['american glamour', 'denim heritage', 'bold logo', '80s fashion', 'sexy casual'],
    categories: ['jeans', 'tees', 'jackets', 'accessories', 'dresses', 'bags'],
    eras: ['1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['american fashion', 'denim', 'mainstream designer', 'glamour'],
    pricePoint: 'mid',
  },

  'gymshark': {
    keywords: ['gymshark', 'gymshark brand', 'gymshark leggings', 'gymshark tee', 'gymshark hoodie'],
    vibes: ['fitness', 'bodybuilding', 'activewear', 'influencer brand', 'performance'],
    categories: ['leggings', 'tees', 'hoodies', 'shorts', 'sports bras', 'jackets'],
    eras: ['2010s', '2020s'],
    subculture: ['fitness', 'bodybuilding', 'activewear', 'gym culture'],
    pricePoint: 'mid',
  },

  'hm': {
    keywords: ['h&m', 'h and m', 'hm brand', 'hennes mauritz', 'h&m clothing'],
    vibes: ['swedish fast fashion', 'affordable trendy', 'high street', 'accessible fashion', 'basics'],
    categories: ['tees', 'pants', 'jackets', 'dresses', 'accessories', 'shoes'],
    eras: ['1990s', '2000s', '2010s', '2020s'],
    subculture: ['fast fashion', 'high street', 'mainstream', 'affordable fashion'],
    pricePoint: 'budget',
  },

  'hybrid-apparel': {
    keywords: ['hybrid', 'hybrid apparel', 'hybrid brand', 'hybrid tee'],
    vibes: ['sports licensing', 'fan apparel', 'casual', 'graphic'],
    categories: ['tees', 'hoodies', 'jackets', 'accessories'],
    eras: ['2000s', '2010s'],
    subculture: ['sports fan', 'casual', 'mainstream'],
    pricePoint: 'budget',
  },

  'hook-ups': {
    keywords: ['hook ups', 'hook-ups', 'hook ups skate', 'hook ups anime skate'],
    vibes: ['anime skate', '90s skate', 'graphic', 'underground', 'provocative'],
    categories: ['tees', 'hoodies', 'decks', 'accessories'],
    eras: ['1990s', '2000s'],
    subculture: ['skate', 'anime', 'underground', '90s nostalgia'],
    pricePoint: 'mid',
  },

  'hale-bob': {
    keywords: ['hale bob', 'hale bob dress', 'hale bob brand'],
    vibes: ['resort wear', 'colorful', 'feminine', 'beaded', 'bohemian luxury'],
    categories: ['dresses', 'tops', 'skirts', 'accessories'],
    eras: ['2000s', '2010s'],
    subculture: ['resort wear', 'feminine', 'boho luxury'],
    pricePoint: 'premium',
  },

  'hanes': {
    keywords: ['hanes', 'hanes brand', 'hanes tee', 'hanes hoodie', 'hanes underwear', 'hanes beefy'],
    vibes: ['american basics', 'everyday staple', 'affordable comfort', 'classic'],
    categories: ['tees', 'underwear', 'hoodies', 'sweatshirts', 'socks'],
    eras: ['1970s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['basics', 'americana', 'streetwear blank'],
    pricePoint: 'budget',
  },

  'hard-rock': {
    keywords: ['hard rock', 'hard rock cafe', 'hard rock hotel', 'hard rock tee', 'hard rock souvenir'],
    vibes: ['tourist souvenir', 'rock music', 'americana', 'collectible', 'city tee'],
    categories: ['tees', 'hoodies', 'accessories'],
    eras: ['1980s', '1990s', '2000s', '2010s'],
    subculture: ['tourist', 'rock music', 'nostalgia', 'souvenir'],
    pricePoint: 'mid',
  },

  'harley-davidson': {
    keywords: ['harley davidson', 'harley', 'hog', 'harley davidson tee', 'harley davidson jacket', 'motor harley', 'harley eagle'],
    vibes: ['biker culture', 'americana', 'freedom', 'motorcycle heritage', 'eagle logo', 'route 66'],
    categories: ['tees', 'jackets', 'hoodies', 'accessories', 'vests'],
    eras: ['1970s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['biker', 'motorcycle', 'americana', 'rock', 'freedom'],
    pricePoint: 'mid',
  },

  'helly-hansen': {
    keywords: ['helly hansen', 'hh logo', 'helly hansen jacket', 'helly hansen sailing', 'helly tech'],
    vibes: ['norwegian heritage', 'sailing', 'technical outdoor', 'waterproof', 'maritime'],
    categories: ['jackets', 'fleece', 'pants', 'shirts', 'accessories'],
    eras: ['1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['outdoor', 'sailing', 'norwegian heritage', 'streetwear', 'gorpcore'],
    pricePoint: 'premium',
  },

  'hermes': {
    keywords: ['hermès', 'hermes', 'birkin', 'kelly bag', 'hermes scarf', 'hermes belt', 'hermes tie', 'orange box hermes', 'hermes h logo'],
    vibes: ['french ultra-luxury', 'craftsmanship', 'iconic orange', 'birkin bag', 'equestrian heritage', 'timeless'],
    categories: ['bags', 'scarves', 'belts', 'ties', 'accessories', 'shoes', 'jackets'],
    eras: ['1950s', '1960s', '1970s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['ultra luxury', 'french fashion', 'old money', 'high society'],
    pricePoint: 'luxury',
  },

  'heron-preston': {
    keywords: ['heron preston', 'heron preston brand', 'hp logo', 'heron preston tape', 'heron hoodie'],
    vibes: ['workwear streetwear', 'tape logo', 'contemporary luxury', 'NY fashion', 'industrial'],
    categories: ['tees', 'hoodies', 'jackets', 'pants', 'accessories'],
    eras: ['2010s', '2020s'],
    subculture: ['luxury streetwear', 'NY fashion', 'contemporary', 'workwear aesthetic'],
    pricePoint: 'luxury',
  },

  'high-sierra': {
    keywords: ['high sierra', 'high sierra bag', 'high sierra backpack', 'high sierra brand'],
    vibes: ['outdoor gear', 'affordable adventure', 'functional', 'backpacking'],
    categories: ['bags', 'backpacks', 'jackets', 'accessories'],
    eras: ['1990s', '2000s', '2010s'],
    subculture: ['outdoor', 'adventure', 'affordable gear'],
    pricePoint: 'mid',
  },

  'hollister': {
    keywords: ['hollister', 'hollister co', 'hollister brand', 'hollister california', 'hco brand'],
    vibes: ['california casual', 'teen fashion', 'beach prep', 'abercrombie sister brand', 'laid back'],
    categories: ['tees', 'hoodies', 'jeans', 'shirts', 'jackets', 'shorts'],
    eras: ['2000s', '2010s', '2020s'],
    subculture: ['california casual', 'teen fashion', 'mall brand', 'preppy'],
    pricePoint: 'mid',
  },

  'house-of-cb': {
    keywords: ['house of cb', 'hocb', 'house of cb dress', 'house of cb brand'],
    vibes: ['bodycon', 'going out', 'feminine', 'fitted', 'occasion wear'],
    categories: ['dresses', 'tops', 'co-ords', 'accessories'],
    eras: ['2010s', '2020s'],
    subculture: ['going out', 'feminine fashion', 'occasion wear'],
    pricePoint: 'premium',
  },

  'hudson-jeans': {
    keywords: ['hudson jeans', 'hudson denim', 'hudson brand', 'hudson jeans la'],
    vibes: ['LA premium denim', 'flattering fit', 'contemporary denim', 'celebrity denim'],
    categories: ['jeans', 'pants', 'jackets'],
    eras: ['2000s', '2010s', '2020s'],
    subculture: ['LA fashion', 'premium denim', 'contemporary'],
    pricePoint: 'premium',
  },

  'hugo-boss': {
    keywords: ['hugo boss', 'boss', 'boss hugo boss', 'boss orange', 'boss green', 'boss black', 'hugo by hugo boss'],
    vibes: ['german fashion', 'sharp tailoring', 'business casual', 'contemporary menswear', 'logo-forward'],
    categories: ['suits', 'shirts', 'pants', 'jackets', 'tees', 'accessories'],
    eras: ['1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['business fashion', 'german menswear', 'mainstream designer', 'contemporary'],
    pricePoint: 'premium',
  },

  'hurley': {
    keywords: ['hurley', 'hurley brand', 'hurley surf', 'hurley phantom', 'hurley boardshorts'],
    vibes: ['surf', 'california beach', 'action sports', 'youth', 'nike surf'],
    categories: ['tees', 'boardshorts', 'hoodies', 'jackets', 'wetsuits', 'accessories'],
    eras: ['1990s', '2000s', '2010s'],
    subculture: ['surf', 'california beach', 'action sports', 'youth'],
    pricePoint: 'mid',
  },

  'inc-international-concepts': {
    keywords: ['inc international concepts', 'inc brand', 'inc macys', 'inc collection'],
    vibes: ['department store contemporary', 'professional casual', 'womens fashion'],
    categories: ['tops', 'pants', 'dresses', 'jackets', 'accessories'],
    eras: ['2000s', '2010s'],
    subculture: ['mainstream', 'department store', 'womens fashion'],
    pricePoint: 'mid',
  },

  'icebreaker': {
    keywords: ['icebreaker', 'icebreaker merino', 'icebreaker wool', 'icebreaker brand', 'icebreaker base layer'],
    vibes: ['new zealand merino', 'sustainable wool', 'outdoor performance', 'natural fiber', 'technical base layer'],
    categories: ['base layers', 'tees', 'hoodies', 'socks', 'accessories'],
    eras: ['2000s', '2010s', '2020s'],
    subculture: ['outdoor', 'sustainable fashion', 'merino wool', 'performance'],
    pricePoint: 'premium',
  },

  'independent-trading': {
    keywords: ['independent trading', 'independent trading co', 'itc brand', 'independent trading hoodie'],
    vibes: ['blank basics', 'wholesale staple', 'classic hoodie', 'screen print canvas'],
    categories: ['hoodies', 'tees', 'sweatshirts', 'jackets'],
    eras: ['2000s', '2010s', '2020s'],
    subculture: ['basics', 'merch', 'streetwear blank'],
    pricePoint: 'mid',
  },

  'isabel-marant': {
    keywords: ['isabel marant', 'marant', 'isabel marant etoile', 'marant brand', 'isabel marant sneakers'],
    vibes: ['french bohemian', 'effortless chic', 'parisian cool', 'mixed textures', 'eclectic'],
    categories: ['tops', 'jackets', 'pants', 'dresses', 'shoes', 'accessories'],
    eras: ['2000s', '2010s', '2020s'],
    subculture: ['french fashion', 'boho chic', 'contemporary luxury', 'parisian'],
    pricePoint: 'luxury',
  },

  'issey-miyake': {
    keywords: ['issey miyake', 'miyake', 'pleats please', 'a-poc', 'issey miyake pleats', 'bao bao'],
    vibes: ['japanese avant-garde', 'pleated innovation', 'sculptural', 'technical fabric', 'wearable art'],
    categories: ['tops', 'pants', 'dresses', 'jackets', 'bags', 'accessories'],
    eras: ['1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['japanese fashion', 'avant-garde', 'high fashion', 'innovative design'],
    pricePoint: 'luxury',
  },

  'j-crew': {
    keywords: ['j crew', 'j.crew', 'jcrew', 'j crew brand', 'j crew blazer', 'j crew chino', 'j crew stripe'],
    vibes: ['preppy american', 'classic casual', 'collegiate', 'colorful basics', 'new england'],
    categories: ['shirts', 'pants', 'jackets', 'tees', 'dresses', 'sweaters', 'accessories'],
    eras: ['1990s', '2000s', '2010s', '2020s'],
    subculture: ['preppy', 'american classic', 'collegiate', 'new england'],
    pricePoint: 'mid',
  },

  'jack-jones': {
    keywords: ['jack & jones', 'jack and jones', 'jack jones brand', 'jack jones denim'],
    vibes: ['scandinavian casual', 'affordable menswear', 'contemporary', 'denim focused'],
    categories: ['jeans', 'tees', 'shirts', 'jackets', 'pants', 'accessories'],
    eras: ['2000s', '2010s', '2020s'],
    subculture: ['scandinavian fashion', 'casual menswear', 'mainstream'],
    pricePoint: 'mid',
  },

  'jacquemus': {
    keywords: ['jacquemus', 'jacquemus brand', 'le chiquito', 'jacquemus bag', 'simon porte jacquemus', 'jacquemus hat'],
    vibes: ['french minimalism', 'provencal inspiration', 'oversized silhouettes', 'tiny bags', 'sun-drenched aesthetic'],
    categories: ['dresses', 'bags', 'tops', 'pants', 'accessories', 'hats'],
    eras: ['2010s', '2020s'],
    subculture: ['contemporary luxury', 'french fashion', 'instagram fashion', 'high fashion'],
    pricePoint: 'luxury',
  },

  'jnco': {
    keywords: ['jnco', 'jnco jeans', 'jnco wide leg', 'jnco brand', 'jnco logo'],
    vibes: ['90s wide leg', 'rave culture', 'skate', 'extreme baggy', 'nostalgia'],
    categories: ['jeans', 'pants'],
    eras: ['1990s', '2000s'],
    subculture: ['rave', 'skate', '90s nostalgia', 'streetwear'],
    pricePoint: 'mid',
  },

  'jansport': {
    keywords: ['jansport', 'jansport backpack', 'jansport brand', 'jansport right pack'],
    vibes: ['classic backpack', 'school essential', 'americana', 'durable', 'colorful'],
    categories: ['bags', 'backpacks', 'accessories'],
    eras: ['1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['outdoor', 'school', 'americana', 'youth'],
    pricePoint: 'mid',
  },

  'jean-paul-gaultier': {
    keywords: ['jean paul gaultier', 'jpg', 'gaultier brand', 'jean paul gaultier cone bra', 'gaultier mesh', 'le male'],
    vibes: ['french avant-garde', 'provocative', 'cone bra', 'punk meets couture', 'gender bending', 'sailor stripes'],
    categories: ['tops', 'dresses', 'jackets', 'accessories', 'fragrance'],
    eras: ['1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['avant-garde', 'french fashion', 'punk', 'high fashion', 'gender fluid'],
    pricePoint: 'luxury',
  },

  'jerzees': {
    keywords: ['jerzees', 'jerzees brand', 'jerzees hoodie', 'jerzees tee', 'jerzees sweatshirt'],
    vibes: ['blank basics', 'affordable', 'school merch', 'classic sweatshirt'],
    categories: ['tees', 'hoodies', 'sweatshirts', 'tank tops'],
    eras: ['1990s', '2000s', '2010s'],
    subculture: ['basics', 'merch', 'school'],
    pricePoint: 'budget',
  },

  'jil-sander': {
    keywords: ['jil sander', 'jil sander brand', 'jil sander minimalism', 'raf simons jil sander'],
    vibes: ['german minimalism', 'pure design', 'luxury basics', 'architectural', 'refined'],
    categories: ['tees', 'shirts', 'pants', 'jackets', 'dresses', 'accessories'],
    eras: ['1990s', '2000s', '2010s', '2020s'],
    subculture: ['minimalism', 'high fashion', 'german fashion', 'luxury'],
    pricePoint: 'luxury',
  },

  'john-elliott': {
    keywords: ['john elliott', 'john elliott brand', 'john elliott mercer', 'john elliott villain'],
    vibes: ['LA minimalism', 'elevated basics', 'premium casual', 'clean aesthetic', 'oversized'],
    categories: ['tees', 'hoodies', 'pants', 'jackets', 'shorts'],
    eras: ['2010s', '2020s'],
    subculture: ['LA fashion', 'luxury streetwear', 'minimalism', 'contemporary'],
    pricePoint: 'premium',
  },

  'jones-new-york': {
    keywords: ['jones new york', 'jones ny', 'jones new york brand', 'jones new york suit'],
    vibes: ['american professional', 'classic womens', 'office wear', 'tailored', 'timeless'],
    categories: ['suits', 'blazers', 'pants', 'tops', 'dresses', 'accessories'],
    eras: ['1980s', '1990s', '2000s', '2010s'],
    subculture: ['professional fashion', 'american classic', 'womens fashion'],
    pricePoint: 'mid',
  },

  'jordache': {
    keywords: ['jordache', 'jordache jeans', 'jordache brand', 'jordache horse logo'],
    vibes: ['80s denim', 'designer jeans', 'american fashion', 'horse logo', 'disco era'],
    categories: ['jeans', 'pants', 'tops', 'accessories'],
    eras: ['1970s', '1980s', '1990s'],
    subculture: ['american fashion', 'denim', '80s fashion', 'disco'],
    pricePoint: 'mid',
  },

  'jordan-brand': {
    keywords: ['jordan brand', 'jordan', 'air jordan', 'jumpman', 'jordan retro', 'jordan hoodie', 'jordan tee', 'jordan flight'],
    vibes: ['basketball legacy', 'sneaker culture', 'jumpman', 'chicago bulls', 'athletic premium', 'hype'],
    categories: ['sneakers', 'tees', 'hoodies', 'shorts', 'pants', 'jackets', 'accessories'],
    eras: ['1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['basketball', 'sneaker culture', 'streetwear', 'hip hop', 'hype'],
    pricePoint: 'premium',
  },

  'juicy-couture': {
    keywords: ['juicy couture', 'juicy', 'juicy couture tracksuit', 'juicy couture velour', 'juicy brand'],
    vibes: ['Y2K velour', 'celebrity casual', 'pink and bling', 'early 2000s', 'luxury casual'],
    categories: ['tracksuits', 'hoodies', 'pants', 'tops', 'accessories', 'bags'],
    eras: ['2000s', '2010s', '2020s'],
    subculture: ['Y2K', 'celebrity fashion', 'early 2000s', 'nostalgia'],
    pricePoint: 'premium',
  },

  'junya-watanabe': {
    keywords: ['junya watanabe', 'junya', 'junya watanabe cdg', 'junya watanabe man', 'junya watanabe comme des garcons'],
    vibes: ['japanese avant-garde', 'technical fashion', 'patchwork', 'reconstructed', 'cdg offshoot'],
    categories: ['jackets', 'pants', 'tops', 'dresses', 'accessories'],
    eras: ['1990s', '2000s', '2010s', '2020s'],
    subculture: ['japanese fashion', 'avant-garde', 'high fashion', 'streetwear'],
    pricePoint: 'luxury',
  },

  'just-cavalli': {
    keywords: ['just cavalli', 'roberto cavalli just', 'just cavalli brand', 'just cavalli jeans'],
    vibes: ['italian maximalism', 'animal print', 'rock glamour', 'sexy', 'bold'],
    categories: ['jeans', 'tops', 'dresses', 'jackets', 'accessories'],
    eras: ['2000s', '2010s'],
    subculture: ['italian fashion', 'celebrity fashion', 'maximalist', 'rock glamour'],
    pricePoint: 'premium',
  },

  'kappa': {
    keywords: ['kappa', 'kappa brand', 'kappa logo', 'kappa tracksuit', 'omini logo kappa', 'kappa banda'],
    vibes: ['italian sportswear', 'side tape', 'football casual', 'retro sport', 'omini logo'],
    categories: ['tracksuits', 'tees', 'jackets', 'shorts', 'accessories'],
    eras: ['1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['football casual', 'italian sports', 'streetwear', 'retro athletic'],
    pricePoint: 'mid',
  },

  'kate-spade': {
    keywords: ['kate spade', 'kate spade new york', 'kate spade bag', 'kate spade purse', 'spade logo'],
    vibes: ['american contemporary', 'colorful accessories', 'playful luxury', 'feminine', 'accessible luxury'],
    categories: ['bags', 'purses', 'accessories', 'shoes', 'clothing'],
    eras: ['2000s', '2010s', '2020s'],
    subculture: ['american fashion', 'accessible luxury', 'feminine', 'mainstream designer'],
    pricePoint: 'premium',
  },

  'kenzo': {
    keywords: ['kenzo', 'kenzo brand', 'kenzo tiger', 'kenzo flower', 'kenzo paris', 'kenzo logo', 'kenzo jungle'],
    vibes: ['parisian japanese', 'bold prints', 'tiger motif', 'colorful', 'multicultural luxury'],
    categories: ['tees', 'sweatshirts', 'jackets', 'dresses', 'accessories', 'bags'],
    eras: ['1970s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['french fashion', 'japanese influence', 'luxury', 'streetwear', 'contemporary luxury'],
    pricePoint: 'luxury',
  },

  'kith': {
    keywords: ['kith', 'kith brand', 'kith treats', 'kith nyc', 'ronnie fieg', 'kith hoodie', 'kith tee'],
    vibes: ['NY streetwear', 'premium sportswear', 'collaboration culture', 'elevated basics', 'sneaker adjacent'],
    categories: ['tees', 'hoodies', 'pants', 'jackets', 'sneakers', 'accessories'],
    eras: ['2010s', '2020s'],
    subculture: ['streetwear', 'NY fashion', 'sneaker culture', 'luxury streetwear'],
    pricePoint: 'premium',
  },

  'ksubi': {
    keywords: ['ksubi', 'ksubi jeans', 'ksubi denim', 'tsubi', 'ksubi brand'],
    vibes: ['australian denim', 'rock n roll', 'edgy', 'distressed', 'skinny jeans'],
    categories: ['jeans', 'pants', 'tees', 'jackets', 'accessories'],
    eras: ['2000s', '2010s', '2020s'],
    subculture: ['australian fashion', 'rock', 'denim', 'contemporary'],
    pricePoint: 'premium',
  },

  'llbean': {
    keywords: ['l.l. bean', 'll bean', 'llbean', 'l.l.bean', 'bean boot', 'll bean tote', 'll bean fleece', 'bean duck boot'],
    vibes: ['new england heritage', 'outdoor classic', 'preppy functional', 'duck boots', 'canvas tote', 'americana'],
    categories: ['boots', 'jackets', 'fleece', 'shirts', 'bags', 'pants', 'accessories'],
    eras: ['1970s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['new england', 'preppy', 'outdoor', 'americana', 'gorpcore'],
    pricePoint: 'mid',
  },

  'lacoste': {
    keywords: ['lacoste', 'lacoste polo', 'crocodile logo', 'lacoste brand', 'lacoste shirt', 'lacoste sneakers', 'rene lacoste'],
    vibes: ['french tennis heritage', 'preppy classic', 'crocodile logo', 'polo culture', 'clean sportswear'],
    categories: ['polos', 'tees', 'sneakers', 'jackets', 'tracksuits', 'accessories'],
    eras: ['1950s', '1960s', '1970s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['tennis', 'preppy', 'french fashion', 'football casual', 'streetwear'],
    pricePoint: 'premium',
  },

  'lands-end': {
    keywords: ["lands' end", 'lands end', 'landsend', 'lands end brand'],
    vibes: ['new england casual', 'quality basics', 'family staple', 'functional', 'classic americana'],
    categories: ['shirts', 'jackets', 'pants', 'sweaters', 'accessories'],
    eras: ['1980s', '1990s', '2000s', '2010s'],
    subculture: ['american classic', 'new england', 'preppy', 'family'],
    pricePoint: 'mid',
  },

  'lanvin': {
    keywords: ['lanvin', 'lanvin brand', 'lanvin paris', 'lanvin curb sneakers', 'lanvin logo'],
    vibes: ['french couture heritage', 'oldest fashion house', 'elegant', 'contemporary luxury'],
    categories: ['dresses', 'suits', 'bags', 'shoes', 'accessories', 'tees'],
    eras: ['1990s', '2000s', '2010s', '2020s'],
    subculture: ['french luxury', 'couture', 'high fashion', 'luxury'],
    pricePoint: 'luxury',
  },

  'lauren-jeans-ralph-lauren': {
    keywords: ['lauren jeans co', 'lauren jeans ralph lauren', 'lauren by ralph lauren', 'lauren ralph lauren'],
    vibes: ['accessible ralph lauren', 'american classic', 'preppy', 'department store'],
    categories: ['jeans', 'pants', 'shirts', 'jackets', 'accessories'],
    eras: ['1990s', '2000s', '2010s'],
    subculture: ['preppy', 'american classic', 'ralph lauren', 'mainstream'],
    pricePoint: 'mid',
  },

  'le-coq-sportif': {
    keywords: ['le coq sportif', 'le coq', 'french rooster brand', 'le coq sportif jacket', 'lcs brand'],
    vibes: ['french sportswear', 'retro athletic', 'rooster logo', 'tennis heritage', 'cycling history'],
    categories: ['tees', 'tracksuits', 'jackets', 'sneakers', 'accessories'],
    eras: ['1970s', '1980s', '1990s', '2000s', '2010s'],
    subculture: ['french sports', 'retro athletic', 'football casual', 'tennis'],
    pricePoint: 'mid',
  },

  'lego': {
    keywords: ['lego', 'lego brand', 'lego tee', 'lego clothing', 'lego shirt'],
    vibes: ['toy brand', 'nostalgia', 'colorful', 'pop culture', 'family'],
    categories: ['tees', 'hoodies', 'accessories'],
    eras: ['1990s', '2000s', '2010s', '2020s'],
    subculture: ['pop culture', 'nostalgia', 'family', 'toy culture'],
    pricePoint: 'budget',
  },

  'logo-athletic': {
    keywords: ['logo athletic', 'logo 7', 'logo athletic brand', 'logo athletic jacket', 'logo 7 jacket'],
    vibes: ['90s sports licensing', 'satin jacket', 'vintage sports', 'team apparel', 'nostalgia'],
    categories: ['jackets', 'tees', 'hoodies', 'accessories'],
    eras: ['1990s', '2000s'],
    subculture: ['sports fan', 'vintage sports', '90s nostalgia', 'americana'],
    pricePoint: 'mid',
  },

  'loewe': {
    keywords: ['loewe', 'loewe brand', 'loewe puzzle bag', 'loewe logo', 'jonathan anderson loewe', 'loewe anagram'],
    vibes: ['spanish luxury', 'craft heritage', 'puzzle bag', 'contemporary luxury', 'anagram logo'],
    categories: ['bags', 'accessories', 'jackets', 'tees', 'knitwear', 'shoes'],
    eras: ['2000s', '2010s', '2020s'],
    subculture: ['spanish luxury', 'high fashion', 'contemporary luxury', 'quiet luxury'],
    pricePoint: 'luxury',
  },

  'london-fog': {
    keywords: ['london fog', 'london fog brand', 'london fog coat', 'london fog trench', 'london fog jacket'],
    vibes: ['classic outerwear', 'americana heritage', 'trench coat', 'rain gear', 'timeless'],
    categories: ['coats', 'jackets', 'trench coats', 'accessories'],
    eras: ['1960s', '1970s', '1980s', '1990s', '2000s'],
    subculture: ['classic american', 'outerwear', 'timeless fashion'],
    pricePoint: 'mid',
  },

  'longchamp': {
    keywords: ['longchamp', 'le pliage', 'longchamp bag', 'longchamp tote', 'longchamp brand'],
    vibes: ['french accessible luxury', 'le pliage tote', 'equestrian heritage', 'practical chic', 'parisian'],
    categories: ['bags', 'purses', 'accessories', 'shoes'],
    eras: ['1990s', '2000s', '2010s', '2020s'],
    subculture: ['french fashion', 'accessible luxury', 'preppy', 'travel'],
    pricePoint: 'premium',
  },

  'loro-piana': {
    keywords: ['loro piana', 'loro piana cashmere', 'lp brand', 'loro piana vicuna', 'loro piana jacket'],
    vibes: ['ultra quiet luxury', 'italian cashmere', 'no logo', 'understated wealth', 'vicuña', 'artisanal'],
    categories: ['knitwear', 'jackets', 'pants', 'shirts', 'accessories', 'shoes'],
    eras: ['1990s', '2000s', '2010s', '2020s'],
    subculture: ['quiet luxury', 'italian luxury', 'old money', 'ultra premium'],
    pricePoint: 'luxury',
  },

  'louis-vuitton': {
    keywords: ['louis vuitton', 'lv', 'lv monogram', 'louis vuitton monogram', 'vuitton', 'lv bag', 'speedy bag', 'neverfull', 'damier', 'lv logo'],
    vibes: ['french ultra-luxury', 'iconic monogram', 'travel heritage', 'status symbol', 'lv canvas'],
    categories: ['bags', 'accessories', 'shoes', 'jackets', 'tees', 'belts', 'scarves'],
    eras: ['1970s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['french luxury', 'ultra luxury', 'streetwear luxury', 'high fashion'],
    pricePoint: 'luxury',
  },

  'lucky-brand': {
    keywords: ['lucky brand', 'lucky brand jeans', 'lucky brand tee', 'lucky jeans', 'four leaf clover lucky'],
    vibes: ['california denim', 'rock n roll casual', 'vintage inspired', 'americana', 'boho rock'],
    categories: ['jeans', 'tees', 'shirts', 'jackets', 'accessories'],
    eras: ['1990s', '2000s', '2010s'],
    subculture: ['california casual', 'rock', 'denim', 'americana'],
    pricePoint: 'mid',
  },

  'lululemon': {
    keywords: ['lululemon', 'lulu', 'lululemon align', 'lululemon abc', 'lululemon define', 'lululemon wunder under', 'lulu brand'],
    vibes: ['premium activewear', 'yoga culture', 'athleisure', 'technical fabric', 'west coast wellness'],
    categories: ['leggings', 'shorts', 'jackets', 'tees', 'hoodies', 'bags', 'accessories'],
    eras: ['2000s', '2010s', '2020s'],
    subculture: ['athleisure', 'yoga', 'fitness', 'west coast', 'premium activewear'],
    pricePoint: 'premium',
  },

  'msgm': {
    keywords: ['msgm', 'msgm brand', 'msgm milan', 'massimo giorgetti'],
    vibes: ['italian contemporary', 'bold graphic', 'youthful luxury', 'playful', 'colorful'],
    categories: ['tees', 'dresses', 'tops', 'pants', 'jackets'],
    eras: ['2010s', '2020s'],
    subculture: ['italian fashion', 'contemporary luxury', 'youth fashion'],
    pricePoint: 'luxury',
  },

  'mlb-apparel': {
    keywords: ['mlb', 'major league baseball', 'mlb jersey', 'mlb tee', 'baseball jersey', 'mlb cap'],
    vibes: ['baseball heritage', 'americana', 'sports fan', 'team pride', 'classic sports'],
    categories: ['jerseys', 'tees', 'hats', 'jackets', 'accessories'],
    eras: ['1970s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['baseball', 'americana', 'sports fan', 'team sports'],
    pricePoint: 'mid',
  },

  'maison-kitsune': {
    keywords: ['maison kitsuné', 'maison kitsune', 'kitsune brand', 'fox head logo kitsune', 'cafe kitsune'],
    vibes: ['parisian japanese', 'fox logo', 'cafe culture', 'clean aesthetic', 'contemporary luxury'],
    categories: ['tees', 'sweatshirts', 'jackets', 'accessories', 'bags'],
    eras: ['2010s', '2020s'],
    subculture: ['french fashion', 'japanese influence', 'contemporary luxury', 'lifestyle brand'],
    pricePoint: 'premium',
  },

  'marlboro': {
    keywords: ['marlboro', 'marlboro brand', 'marlboro classics', 'marlboro country', 'marlboro jacket', 'marlboro tee'],
    vibes: ['americana', 'cowboy', 'tobacco brand', 'vintage promo', 'rugged outdoors'],
    categories: ['jackets', 'tees', 'shirts', 'accessories'],
    eras: ['1980s', '1990s'],
    subculture: ['americana', 'cowboy', 'vintage promo', 'western'],
    pricePoint: 'budget',
  },

  'marvel': {
    keywords: ['marvel', 'marvel comics', 'marvel tee', 'marvel shirt', 'avengers shirt', 'spider-man tee', 'iron man shirt', 'x-men tee'],
    vibes: ['superhero', 'comic book', 'pop culture', 'nostalgia', 'graphic'],
    categories: ['tees', 'hoodies', 'accessories', 'jackets'],
    eras: ['1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['pop culture', 'comics', 'nostalgia', 'streetwear'],
    pricePoint: 'budget',
  },

  'maison-margiela': {
    keywords: ['maison margiela', 'margiela', 'mm6', 'martin margiela', 'four stitches', 'margiela tabi', 'margiela replica'],
    vibes: ['deconstructed luxury', 'anonymity', 'white label', 'avant-garde', 'tabi shoes', 'conceptual fashion'],
    categories: ['tees', 'jackets', 'shoes', 'bags', 'dresses', 'accessories', 'suits'],
    eras: ['1990s', '2000s', '2010s', '2020s'],
    subculture: ['avant-garde', 'high fashion', 'luxury', 'deconstructed', 'conceptual'],
    pricePoint: 'luxury',
  },

  'majestic': {
    keywords: ['majestic', 'majestic athletic', 'majestic brand', 'majestic mlb', 'majestic jersey'],
    vibes: ['sports licensing', 'baseball authentic', 'team apparel', 'americana sports'],
    categories: ['jerseys', 'tees', 'jackets', 'hoodies', 'accessories'],
    eras: ['1990s', '2000s', '2010s'],
    subculture: ['baseball', 'sports fan', 'americana', 'team sports'],
    pricePoint: 'mid',
  },

  'mammut': {
    keywords: ['mammut', 'mammut brand', 'mammut jacket', 'mammut climbing', 'mammut alpine'],
    vibes: ['swiss alpine', 'technical mountaineering', 'climbing heritage', 'precision outdoor gear'],
    categories: ['jackets', 'pants', 'fleece', 'accessories', 'climbing gear'],
    eras: ['1990s', '2000s', '2010s', '2020s'],
    subculture: ['mountaineering', 'alpine', 'outdoor', 'climbing'],
    pricePoint: 'premium',
  },

  'mango': {
    keywords: ['mango', 'mango brand', 'mango clothing', 'mng brand', 'mango zara'],
    vibes: ['spanish high street', 'european casual', 'affordable contemporary', 'feminine', 'trendy'],
    categories: ['dresses', 'tops', 'pants', 'jackets', 'accessories', 'shoes'],
    eras: ['2000s', '2010s', '2020s'],
    subculture: ['european fashion', 'high street', 'mainstream', 'contemporary'],
    pricePoint: 'mid',
  },

  'marc-jacobs': {
    keywords: ['marc jacobs', 'marc by marc jacobs', 'marc jacobs brand', 'mj logo', 'marc jacobs tote', 'the tote bag marc jacobs'],
    vibes: ['new york fashion', 'playful luxury', 'pop culture references', 'eclectic', 'accessible designer'],
    categories: ['bags', 'tees', 'dresses', 'accessories', 'shoes', 'jackets'],
    eras: ['1990s', '2000s', '2010s', '2020s'],
    subculture: ['new york fashion', 'contemporary luxury', 'mainstream designer', 'pop culture'],
    pricePoint: 'premium',
  },

  'marine-layer': {
    keywords: ['marine layer', 'marine layer brand', 'marine layer shirt', 'super soft tee marine layer'],
    vibes: ['california casual', 'super soft', 'weekend wear', 'laid back', 'coastal'],
    categories: ['tees', 'shirts', 'hoodies', 'pants', 'dresses', 'accessories'],
    eras: ['2010s', '2020s'],
    subculture: ['california casual', 'coastal', 'weekend wear'],
    pricePoint: 'mid',
  },

  'marks-spencer': {
    keywords: ['marks & spencer', 'marks and spencer', 'm&s', 'marks spencer brand', 'st michael label'],
    vibes: ['british staple', 'quality basics', 'middle england', 'reliable', 'classic'],
    categories: ['tees', 'shirts', 'pants', 'jackets', 'knitwear', 'underwear', 'accessories'],
    eras: ['1970s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['british fashion', 'mainstream', 'classic basics'],
    pricePoint: 'mid',
  },

  'marni': {
    keywords: ['marni', 'marni brand', 'marni print', 'marni flower', 'consuelo castiglioni marni'],
    vibes: ['italian avant-garde', 'bold prints', 'artistic', 'eclectic color', 'intellectual luxury'],
    categories: ['tops', 'jackets', 'pants', 'dresses', 'bags', 'accessories', 'shoes'],
    eras: ['2000s', '2010s', '2020s'],
    subculture: ['italian fashion', 'avant-garde', 'high fashion', 'intellectual luxury'],
    pricePoint: 'luxury',
  },

  'massimo-dutti': {
    keywords: ['massimo dutti', 'massimo dutti brand', 'md clothing', 'inditex massimo'],
    vibes: ['spanish premium', 'sophisticated casual', 'quality menswear', 'clean aesthetic', 'zara upscale'],
    categories: ['suits', 'shirts', 'pants', 'jackets', 'knitwear', 'accessories'],
    eras: ['2000s', '2010s', '2020s'],
    subculture: ['european fashion', 'premium mainstream', 'professional', 'contemporary'],
    pricePoint: 'mid',
  },

  'mavi': {
    keywords: ['mavi', 'mavi jeans', 'mavi denim', 'mavi brand'],
    vibes: ['turkish denim', 'premium fit', 'contemporary denim', 'european denim'],
    categories: ['jeans', 'pants', 'tees', 'jackets'],
    eras: ['2000s', '2010s', '2020s'],
    subculture: ['denim', 'contemporary', 'european fashion'],
    pricePoint: 'mid',
  },

  'max-mara': {
    keywords: ['max mara', 'maxmara', 'max mara coat', 'max mara brand', 'sportmax'],
    vibes: ['italian luxury', 'iconic camel coat', 'clean tailoring', 'timeless', 'sophisticated'],
    categories: ['coats', 'suits', 'dresses', 'pants', 'tops', 'accessories'],
    eras: ['1970s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['italian fashion', 'luxury', 'quiet luxury', 'professional fashion'],
    pricePoint: 'luxury',
  },

  'members-only': {
    keywords: ['members only', 'members only jacket', 'members only brand', 'racer jacket members only'],
    vibes: ['80s iconic', 'racer collar', 'americana nostalgia', 'retro casual', 'mainstream 80s'],
    categories: ['jackets', 'tees', 'accessories'],
    eras: ['1980s', '1990s', '2000s', '2010s'],
    subculture: ['80s nostalgia', 'americana', 'retro casual'],
    pricePoint: 'mid',
  },

  'merrell': {
    keywords: ['merrell', 'merrell shoes', 'merrell hiking', 'merrell moab', 'merrell brand'],
    vibes: ['trail footwear', 'hiking', 'outdoor performance', 'comfortable', 'functional'],
    categories: ['shoes', 'boots', 'sandals', 'accessories'],
    eras: ['1990s', '2000s', '2010s', '2020s'],
    subculture: ['hiking', 'outdoor', 'gorpcore', 'trail'],
    pricePoint: 'mid',
  },

  'michael-kors': {
    keywords: ['michael kors', 'mk logo', 'michael kors bag', 'michael kors watch', 'michael kors brand', 'mk brand'],
    vibes: ['american accessible luxury', 'jet set lifestyle', 'logo-forward', 'contemporary', 'aspirational'],
    categories: ['bags', 'watches', 'accessories', 'shoes', 'jackets', 'dresses'],
    eras: ['2000s', '2010s', '2020s'],
    subculture: ['american fashion', 'accessible luxury', 'mainstream designer', 'contemporary'],
    pricePoint: 'premium',
  },

  'mihara-yasuhiro': {
    keywords: ['mihara yasuhiro', 'maison mihara', 'mihara shoes', 'miharayasuhiro', 'my brand'],
    vibes: ['japanese designer', 'deconstructed footwear', 'avant-garde', 'distressed aesthetic', 'underground luxury'],
    categories: ['shoes', 'sneakers', 'tees', 'jackets', 'accessories'],
    eras: ['2000s', '2010s', '2020s'],
    subculture: ['japanese fashion', 'avant-garde', 'underground luxury', 'streetwear'],
    pricePoint: 'luxury',
  },

  'mtv': {
    keywords: ['mtv', 'mtv brand', 'mtv tee', 'mtv shirt', 'music television'],
    vibes: ['pop culture', 'music television', 'nostalgia', '80s 90s', 'graphic'],
    categories: ['tees', 'hoodies', 'accessories'],
    eras: ['1980s', '1990s', '2000s'],
    subculture: ['pop culture', 'music', 'nostalgia', 'streetwear'],
    pricePoint: 'budget',
  },

  'miss-sixty': {
    keywords: ['miss sixty', 'miss 60', 'miss sixty jeans', 'miss sixty brand'],
    vibes: ['Y2K denim', 'italian fashion', 'sexy fit', 'low rise', 'early 2000s'],
    categories: ['jeans', 'pants', 'tops', 'dresses', 'accessories'],
    eras: ['1990s', '2000s'],
    subculture: ['Y2K', 'italian fashion', 'denim', 'early 2000s'],
    pricePoint: 'mid',
  },

  'missguided': {
    keywords: ['missguided', 'missguided brand', 'missguided clothing'],
    vibes: ['british fast fashion', 'going out', 'affordable trendy', 'youth', 'bold'],
    categories: ['dresses', 'tops', 'pants', 'jackets', 'accessories'],
    eras: ['2010s', '2020s'],
    subculture: ['fast fashion', 'british fashion', 'youth fashion', 'going out'],
    pricePoint: 'budget',
  },

  'microsoft': {
    keywords: ['microsoft', 'microsoft brand', 'microsoft tee', 'xbox shirt', 'windows shirt'],
    vibes: ['tech brand', 'corporate', 'gaming', 'nostalgia', 'promo'],
    categories: ['tees', 'hoodies', 'accessories'],
    eras: ['1990s', '2000s', '2010s', '2020s'],
    subculture: ['tech culture', 'gaming', 'pop culture', 'nostalgia'],
    pricePoint: 'budget',
  },

  'miu-miu': {
    keywords: ['miu miu', 'miumiu', 'miu miu brand', 'miuccia prada miu', 'miu miu ballet flat'],
    vibes: ['playful luxury', 'feminine prada', 'quirky sophistication', 'girly luxury', 'intellectual chic'],
    categories: ['dresses', 'bags', 'shoes', 'accessories', 'tops', 'jackets'],
    eras: ['1990s', '2000s', '2010s', '2020s'],
    subculture: ['italian fashion', 'luxury', 'high fashion', 'feminine luxury'],
    pricePoint: 'luxury',
  },

  'moncler': {
    keywords: ['moncler', 'moncler jacket', 'moncler down', 'moncler puffer', 'moncler logo', 'moncler maya', 'moncler genius'],
    vibes: ['luxury puffer', 'alpine heritage', 'status outerwear', 'italian luxury sportswear', 'quilted down'],
    categories: ['jackets', 'vests', 'hoodies', 'tees', 'accessories'],
    eras: ['2000s', '2010s', '2020s'],
    subculture: ['luxury outerwear', 'status symbol', 'streetwear luxury', 'alpine'],
    pricePoint: 'luxury',
  },

  'mossimo': {
    keywords: ['mossimo', 'mossimo brand', 'mossimo supply co', 'mossimo target'],
    vibes: ['california casual', 'target basics', 'surf inspired', 'affordable'],
    categories: ['tees', 'shirts', 'shorts', 'swimwear', 'accessories'],
    eras: ['1990s', '2000s', '2010s'],
    subculture: ['california casual', 'surf', 'affordable fashion'],
    pricePoint: 'budget',
  },

  'mother-denim': {
    keywords: ['mother denim', 'mother jeans', 'mother brand', 'mother the looker', 'mother the tomcat'],
    vibes: ['LA premium denim', 'rock n roll', 'vintage wash', 'flattering fit', 'fun naming'],
    categories: ['jeans', 'pants', 'tees', 'accessories'],
    eras: ['2010s', '2020s'],
    subculture: ['LA fashion', 'premium denim', 'rock', 'contemporary'],
    pricePoint: 'premium',
  },

  'mountain-hardwear': {
    keywords: ['mountain hardwear', 'mountain hardwear jacket', 'mhw brand', 'mountain hardware'],
    vibes: ['technical mountaineering', 'alpine performance', 'serious outdoor', 'gore-tex', 'climbing'],
    categories: ['jackets', 'pants', 'fleece', 'base layers', 'accessories'],
    eras: ['1990s', '2000s', '2010s', '2020s'],
    subculture: ['mountaineering', 'alpine', 'outdoor', 'climbing'],
    pricePoint: 'premium',
  },

  'muji': {
    keywords: ['muji', 'muji brand', 'muji clothing', 'mujirushi', 'no brand quality goods'],
    vibes: ['japanese minimalism', 'no brand', 'functional design', 'natural materials', 'understated'],
    categories: ['tees', 'shirts', 'pants', 'knitwear', 'accessories'],
    eras: ['1990s', '2000s', '2010s', '2020s'],
    subculture: ['japanese fashion', 'minimalism', 'sustainable fashion', 'normcore'],
    pricePoint: 'mid',
  },

  'nfl-apparel': {
    keywords: ['nfl', 'national football league', 'nfl jersey', 'nfl tee', 'football jersey', 'nfl hoodie'],
    vibes: ['football heritage', 'americana', 'sports fan', 'team pride', 'classic sports'],
    categories: ['jerseys', 'tees', 'hats', 'jackets', 'hoodies', 'accessories'],
    eras: ['1970s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['football', 'americana', 'sports fan', 'team sports'],
    pricePoint: 'mid',
  },

  'naked-famous': {
    keywords: ['naked & famous', 'naked and famous', 'naked famous denim', 'nf denim', 'weird guy jeans'],
    vibes: ['canadian selvedge', 'raw denim', 'fun novelty denim', 'japanese fabric', 'glow in dark denim'],
    categories: ['jeans', 'pants'],
    eras: ['2000s', '2010s', '2020s'],
    subculture: ['raw denim', 'selvedge', 'denim enthusiast', 'japanese influenced'],
    pricePoint: 'premium',
  },

  'nasty-gal': {
    keywords: ['nasty gal', 'nastygal', 'nasty gal brand', 'sophia amoruso nasty gal'],
    vibes: ['LA rock glam', 'vintage inspired fashion', 'edgy feminine', 'bold', 'going out'],
    categories: ['dresses', 'tops', 'jackets', 'pants', 'shoes', 'accessories'],
    eras: ['2010s', '2020s'],
    subculture: ['LA fashion', 'rock glam', 'going out', 'feminine edge'],
    pricePoint: 'mid',
  },

  'nautica': {
    keywords: ['nautica', 'nautica brand', 'nautica logo', 'nautica sailing', 'nautica jacket', 'nautica polo'],
    vibes: ['nautical americana', 'sailing heritage', 'preppy casual', 'colorblock', 'east coast'],
    categories: ['polos', 'jackets', 'tees', 'pants', 'shorts', 'accessories'],
    eras: ['1990s', '2000s', '2010s', '2020s'],
    subculture: ['preppy', 'americana', 'sailing', 'east coast', 'hip hop'],
    pricePoint: 'mid',
  },

  'nascar-apparel': {
    keywords: ['nascar', 'nascar brand', 'nascar jacket', 'nascar tee', 'nascar racing'],
    vibes: ['motorsport', 'americana', 'racing heritage', 'sponsor logos', 'southern culture'],
    categories: ['jackets', 'tees', 'hats', 'accessories'],
    eras: ['1990s', '2000s', '2010s'],
    subculture: ['nascar', 'motorsport', 'americana', 'southern culture'],
    pricePoint: 'mid',
  },

  'neighborhood': {
    keywords: ['neighborhood', 'neighborhood brand', 'nhbd', 'shinsuke takizawa', 'neighborhood jacket', 'neighborhood tee'],
    vibes: ['japanese streetwear', 'biker meets workwear', 'dark aesthetic', 'military influence', 'detail oriented'],
    categories: ['jackets', 'tees', 'shirts', 'pants', 'accessories'],
    eras: ['1990s', '2000s', '2010s', '2020s'],
    subculture: ['japanese streetwear', 'biker', 'workwear', 'underground'],
    pricePoint: 'premium',
  },

  'new-balance': {
    keywords: ['new balance', 'nb', 'new balance 990', 'new balance 574', 'new balance 550', 'made in usa new balance', 'new balance dad shoe'],
    vibes: ['boston heritage', 'dad shoe pioneer', 'made in usa', 'running heritage', 'normcore icon'],
    categories: ['sneakers', 'tees', 'hoodies', 'shorts', 'pants', 'accessories'],
    eras: ['1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['running', 'dad shoes', 'normcore', 'streetwear', 'sneaker culture'],
    pricePoint: 'mid',
  },

  'nintendo': {
    keywords: ['nintendo', 'nintendo tee', 'nintendo shirt', 'mario shirt', 'zelda tee', 'pokemon shirt', 'nintendo brand'],
    vibes: ['gaming nostalgia', 'pop culture', 'Japanese gaming', 'childhood', 'graphic'],
    categories: ['tees', 'hoodies', 'accessories'],
    eras: ['1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['gaming', 'pop culture', 'nostalgia', 'streetwear'],
    pricePoint: 'budget',
  },

  'nike': {
    keywords: ['nike', 'swoosh', 'nike tee', 'nike hoodie', 'nike air', 'just do it', 'nike brand', 'nike sportswear', 'nsw', 'nike sb'],
    vibes: ['global sportswear giant', 'swoosh icon', 'athletic performance', 'streetwear staple', 'just do it'],
    categories: ['tees', 'hoodies', 'sneakers', 'pants', 'jackets', 'shorts', 'accessories'],
    eras: ['1970s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['athletic', 'streetwear', 'basketball', 'running', 'sneaker culture'],
    pricePoint: 'mid',
  },

  'nhl-apparel': {
    keywords: ['nhl', 'national hockey league', 'nhl jersey', 'nhl tee', 'hockey jersey'],
    vibes: ['hockey heritage', 'canadian sport', 'sports fan', 'team pride'],
    categories: ['jerseys', 'tees', 'hats', 'jackets', 'hoodies', 'accessories'],
    eras: ['1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['hockey', 'canadian sports', 'sports fan', 'team sports'],
    pricePoint: 'mid',
  },

  'nba-apparel': {
    keywords: ['nba', 'national basketball association', 'nba jersey', 'nba tee', 'basketball jersey', 'swingman'],
    vibes: ['basketball culture', 'americana', 'sports fan', 'team pride', 'hip hop adjacent'],
    categories: ['jerseys', 'tees', 'hats', 'jackets', 'hoodies', 'shorts', 'accessories'],
    eras: ['1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['basketball', 'hip hop', 'sports fan', 'streetwear'],
    pricePoint: 'mid',
  },

  'noah': {
    keywords: ['noah', 'noah brand', 'noah nyc', 'brendon babenzien noah', 'noah cross logo'],
    vibes: ['preppy streetwear', 'ethical production', 'anti-hype', 'classic americana', 'surf punk'],
    categories: ['tees', 'hoodies', 'shirts', 'pants', 'jackets', 'accessories'],
    eras: ['2010s', '2020s'],
    subculture: ['streetwear', 'preppy', 'surf', 'punk', 'ethical fashion'],
    pricePoint: 'premium',
  },

  'nudie-jeans': {
    keywords: ['nudie jeans', 'nudie', 'nudie jeans co', 'nudie denim', 'tight terry', 'thin finn nudie'],
    vibes: ['swedish organic denim', 'sustainable', 'raw denim', 'repair culture', 'quality over quantity'],
    categories: ['jeans', 'pants', 'tees', 'jackets', 'accessories'],
    eras: ['2000s', '2010s', '2020s'],
    subculture: ['denim', 'sustainable fashion', 'scandinavian', 'raw denim'],
    pricePoint: 'premium',
  },

  'oakley': {
    keywords: ['oakley', 'oakley brand', 'oakley sunglasses', 'oakley goggles', 'oakley frogskins', 'oakley juliet'],
    vibes: ['action sports eyewear', 'technical performance', 'california cool', 'ski goggles', 'futuristic'],
    categories: ['sunglasses', 'goggles', 'tees', 'jackets', 'accessories', 'shoes'],
    eras: ['1990s', '2000s', '2010s', '2020s'],
    subculture: ['action sports', 'skiing', 'cycling', 'motocross', 'california'],
    pricePoint: 'premium',
  },

  'ocean-pacific': {
    keywords: ['ocean pacific', 'op brand', 'op surf', 'ocean pacific tee', 'op shorts'],
    vibes: ['70s 80s surf', 'california beach', 'vintage surf', 'colorful', 'beach culture'],
    categories: ['tees', 'shorts', 'boardshorts', 'accessories'],
    eras: ['1970s', '1980s', '1990s'],
    subculture: ['surf', 'california beach', 'vintage surf', 'americana'],
    pricePoint: 'mid',
  },

  'off-white': {
    keywords: ['off-white', 'off white', 'virgil abloh', 'off white quotation marks', 'off white diagonal', 'off white industrial belt', 'owenby'],
    vibes: ['industrial luxury', 'quotation marks', 'deconstructed streetwear', 'virgil abloh', 'diagonal stripe', 'hype luxury'],
    categories: ['tees', 'hoodies', 'jackets', 'shoes', 'accessories', 'bags', 'belts'],
    eras: ['2010s', '2020s'],
    subculture: ['luxury streetwear', 'hype', 'high fashion', 'streetwear', 'contemporary luxury'],
    pricePoint: 'luxury',
  },

  'old-navy': {
    keywords: ['old navy', 'old navy brand', 'old navy gap', 'old navy fleece', 'old navy tee'],
    vibes: ['accessible american', 'family basics', 'affordable casual', 'colorful', 'gap family'],
    categories: ['tees', 'pants', 'jeans', 'hoodies', 'jackets', 'accessories'],
    eras: ['1990s', '2000s', '2010s', '2020s'],
    subculture: ['mainstream', 'american casual', 'family', 'affordable fashion'],
    pricePoint: 'budget',
  },

  'on-running': {
    keywords: ['on running', 'on brand', 'on cloud', 'cloudrunner', 'on shoes', 'swiss running'],
    vibes: ['swiss running tech', 'cloud sole', 'performance running', 'clean design', 'athleisure crossover'],
    categories: ['shoes', 'tees', 'shorts', 'jackets', 'accessories'],
    eras: ['2010s', '2020s'],
    subculture: ['running', 'athleisure', 'performance', 'contemporary'],
    pricePoint: 'premium',
  },

  'opening-ceremony': {
    keywords: ['opening ceremony', 'oc brand', 'opening ceremony store', 'opening ceremony fashion'],
    vibes: ['global fashion curation', 'eclectic', 'downtown NY', 'international inspiration', 'cool kid brand'],
    categories: ['tees', 'jackets', 'pants', 'dresses', 'accessories', 'shoes'],
    eras: ['2000s', '2010s'],
    subculture: ['NY fashion', 'downtown cool', 'eclectic', 'contemporary'],
    pricePoint: 'premium',
  },

  'oscar-de-la-renta': {
    keywords: ['oscar de la renta', 'odlr', 'oscar de la renta brand', 'oscar de la renta gown'],
    vibes: ['american couture', 'feminine elegance', 'garden party', 'floral luxury', 'society fashion'],
    categories: ['dresses', 'gowns', 'suits', 'accessories', 'bags'],
    eras: ['1970s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['american luxury', 'couture', 'high society', 'feminine luxury'],
    pricePoint: 'luxury',
  },

  'outdoor-voices': {
    keywords: ['outdoor voices', 'ov brand', 'outdoor voices tee', 'outdoor voices leggings', 'doing things'],
    vibes: ['joyful activewear', 'colorful', 'recreational activity', 'casual athletic', 'doing things'],
    categories: ['leggings', 'tees', 'shorts', 'jackets', 'sports bras', 'accessories'],
    eras: ['2010s', '2020s'],
    subculture: ['athleisure', 'outdoor lifestyle', 'fitness', 'casual active'],
    pricePoint: 'premium',
  },

  'pacsun': {
    keywords: ['pacsun', 'pacific sunwear', 'pac sun', 'pacsun brand'],
    vibes: ['california mall brand', 'teen surf skate', 'affordable california', 'youth fashion'],
    categories: ['tees', 'jeans', 'hoodies', 'shorts', 'accessories'],
    eras: ['1990s', '2000s', '2010s', '2020s'],
    subculture: ['california casual', 'surf', 'skate', 'mall brand', 'teen fashion'],
    pricePoint: 'mid',
  },

  'palace': {
    keywords: ['palace', 'palace skateboards', 'palace brand', 'palace tri-ferg', 'palace london', 'p3 logo'],
    vibes: ['london skate', 'tri-ferg logo', 'british humor', 'limited drops', 'skating heritage'],
    categories: ['tees', 'hoodies', 'jackets', 'pants', 'accessories', 'shoes'],
    eras: ['2010s', '2020s'],
    subculture: ['skate', 'british streetwear', 'london fashion', 'hype', 'streetwear'],
    pricePoint: 'premium',
  },

  'palm-angels': {
    keywords: ['palm angels', 'palm angels brand', 'palm angels tee', 'palm angels track', 'pa logo'],
    vibes: ['LA luxury streetwear', 'palm tree logo', 'italian luxury meets california', 'skate luxury', 'tracksuit culture'],
    categories: ['tees', 'tracksuits', 'hoodies', 'jackets', 'accessories', 'shoes'],
    eras: ['2010s', '2020s'],
    subculture: ['luxury streetwear', 'LA fashion', 'italian luxury', 'skate'],
    pricePoint: 'luxury',
  },

  'panhandle-slim': {
    keywords: ['panhandle slim', 'panhandle brand', 'panhandle western', 'panhandle shirt'],
    vibes: ['western heritage', 'cowboy', 'pearl snap', 'americana', 'texas style'],
    categories: ['shirts', 'western shirts', 'pants', 'jackets'],
    eras: ['1970s', '1980s', '1990s', '2000s'],
    subculture: ['western', 'cowboy', 'americana', 'texas'],
    pricePoint: 'mid',
  },

  'patagonia': {
    keywords: ['patagonia', 'patagucci', 'patagonia fleece', 'synchilla', 'retro-x', 'nano puff', 'better sweater', 'baggies patagonia'],
    vibes: ['environmental activism', 'outdoor heritage', 'fleece culture', 'yvon chouinard', 'sustainable outdoor'],
    categories: ['fleece', 'jackets', 'tees', 'shorts', 'pants', 'bags', 'accessories'],
    eras: ['1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['outdoor', 'gorpcore', 'environmental', 'sustainable fashion', 'streetwear'],
    pricePoint: 'premium',
  },

  'paul-shark': {
    keywords: ['paul & shark', 'paul and shark', 'paul shark brand', 'paul shark jacket'],
    vibes: ['italian yachting', 'nautical luxury', 'sailing heritage', 'waterproof luxury', 'preppy italian'],
    categories: ['jackets', 'knitwear', 'polos', 'shirts', 'accessories'],
    eras: ['1990s', '2000s', '2010s', '2020s'],
    subculture: ['italian fashion', 'nautical', 'luxury sportswear', 'sailing'],
    pricePoint: 'premium',
  },

  'paul-smith': {
    keywords: ['paul smith', 'paul smith brand', 'paul smith stripe', 'paul smith suit', 'paul smith multistripe'],
    vibes: ['british eccentric', 'classic with a twist', 'colorful stripe', 'playful tailoring', 'london fashion'],
    categories: ['suits', 'shirts', 'tees', 'accessories', 'shoes', 'bags'],
    eras: ['1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['british fashion', 'contemporary luxury', 'tailoring', 'eclectic'],
    pricePoint: 'luxury',
  },

  'pendleton': {
    keywords: ['pendleton', 'pendleton woolen mills', 'pendleton blanket', 'pendleton shirt', 'pendleton wool', 'pendleton plaid'],
    vibes: ['american wool heritage', 'native american inspired', 'pacific northwest', 'blanket stripe', 'classic americana'],
    categories: ['shirts', 'jackets', 'blankets', 'knitwear', 'accessories'],
    eras: ['1950s', '1960s', '1970s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['americana', 'pacific northwest', 'heritage', 'surf', 'outdoor'],
    pricePoint: 'premium',
  },

  'pepe-jeans': {
    keywords: ['pepe jeans', 'pepe jeans london', 'pepe brand', 'pepe jeans denim'],
    vibes: ['british denim', 'casual european', 'affordable denim', 'classic fit'],
    categories: ['jeans', 'pants', 'tees', 'jackets', 'accessories'],
    eras: ['1980s', '1990s', '2000s', '2010s'],
    subculture: ['british fashion', 'denim', 'casual', 'european fashion'],
    pricePoint: 'mid',
  },

  'perfect-moment': {
    keywords: ['perfect moment', 'perfect moment brand', 'perfect moment ski', 'pm brand'],
    vibes: ['luxury ski wear', 'apres ski', 'bold prints', 'mountain fashion', 'statement outerwear'],
    categories: ['ski jackets', 'pants', 'knitwear', 'accessories'],
    eras: ['2010s', '2020s'],
    subculture: ['ski', 'luxury outdoor', 'apres ski', 'mountain lifestyle'],
    pricePoint: 'luxury',
  },

  'peter-millar': {
    keywords: ['peter millar', 'peter millar brand', 'peter millar golf', 'crown sport', 'peter millar polo'],
    vibes: ['american luxury casual', 'golf lifestyle', 'preppy premium', 'southern luxury', 'country club'],
    categories: ['polos', 'shirts', 'jackets', 'pants', 'knitwear', 'accessories'],
    eras: ['2000s', '2010s', '2020s'],
    subculture: ['golf', 'preppy', 'american luxury', 'country club'],
    pricePoint: 'premium',
  },

  'philipp-plein': {
    keywords: ['philipp plein', 'pp brand', 'phillip plein', 'plein sport', 'philipp plein skull'],
    vibes: ['maximalist luxury', 'skull motifs', 'german ostentation', 'rhinestones', 'bold logo', 'rock luxury'],
    categories: ['tees', 'jeans', 'jackets', 'shoes', 'accessories'],
    eras: ['2000s', '2010s', '2020s'],
    subculture: ['luxury', 'maximalist', 'rock', 'celebrity fashion'],
    pricePoint: 'luxury',
  },

  'pierre-cardin': {
    keywords: ['pierre cardin', 'pierre cardin brand', 'pierre cardin suit', 'pierre cardin logo'],
    vibes: ['space age couture', 'french fashion legend', 'geometric', 'futuristic classic', 'licensed fashion'],
    categories: ['suits', 'shirts', 'accessories', 'tees', 'jackets'],
    eras: ['1960s', '1970s', '1980s', '1990s', '2000s'],
    subculture: ['french fashion', 'space age', 'mod', 'classic luxury'],
    pricePoint: 'mid',
  },

  'pink-victoria-secret': {
    keywords: ['pink', "victoria's secret pink", 'vs pink', 'pink brand', 'pink logo'],
    vibes: ['collegiate casual', 'lounge wear', 'feminine basics', 'logo sweatshirt', 'campus style'],
    categories: ['hoodies', 'sweatpants', 'tees', 'bras', 'accessories'],
    eras: ['2000s', '2010s', '2020s'],
    subculture: ['feminine fashion', 'collegiate', 'lounge wear', 'mainstream'],
    pricePoint: 'mid',
  },

  'polo-ralph-lauren': {
    keywords: ['polo ralph lauren', 'polo by ralph lauren', 'polo brand', 'polo shirt ralph lauren', 'polo bear', 'polo logo', 'rl polo', 'polo rl'],
    vibes: ['american preppy', 'ivy league', 'country club', 'classic americana', 'polo pony'],
    categories: ['polos', 'shirts', 'tees', 'knitwear', 'jackets', 'pants', 'accessories'],
    eras: ['1970s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['preppy', 'ivy league', 'americana', 'streetwear', 'hip hop'],
    pricePoint: 'premium',
  },

  'prada': {
    keywords: ['prada', 'prada brand', 'prada tee', 'prada jacket', 'prada nylon', 'prada logo', 'miu miu sister'],
    vibes: ['italian intellectual luxury', 'nylon heritage', 'minimal luxury', 'conceptual fashion', 'cerebral cool'],
    categories: ['tees', 'jackets', 'shirts', 'shoes', 'bags', 'accessories', 'knitwear'],
    eras: ['1990s', '2000s', '2010s', '2020s'],
    subculture: ['luxury', 'high fashion', 'italian luxury', 'minimalist luxury'],
    pricePoint: 'luxury',
  },

  'prettylittlething': {
    keywords: ['prettylittlething', 'pretty little thing', 'plt brand'],
    vibes: ['fast fashion', 'trendy', 'affordable glam', 'going out', 'influencer fashion'],
    categories: ['dresses', 'tops', 'jeans', 'accessories', 'shoes'],
    eras: ['2010s', '2020s'],
    subculture: ['fast fashion', 'club wear', 'influencer', 'affordable fashion'],
    pricePoint: 'budget',
  },

  'primitive': {
    keywords: ['primitive', 'primitive skateboarding', 'primitive brand', 'primitive skate'],
    vibes: ['skate culture', 'art-driven', 'california skate', 'graphic heavy', 'team riders'],
    categories: ['tees', 'hoodies', 'hats', 'accessories', 'shoes'],
    eras: ['2010s', '2020s'],
    subculture: ['skate', 'streetwear', 'california'],
    pricePoint: 'mid',
  },

  'pull-and-bear': {
    keywords: ['pull and bear', 'pull & bear', 'pull bear brand'],
    vibes: ['affordable european', 'zara sibling', 'teen casual', 'trendy basics'],
    categories: ['tees', 'jeans', 'hoodies', 'jackets', 'accessories'],
    eras: ['2000s', '2010s', '2020s'],
    subculture: ['fast fashion', 'european casual', 'mainstream', 'teen fashion'],
    pricePoint: 'budget',
  },

  'puma': {
    keywords: ['puma', 'puma brand', 'puma suede', 'puma tee', 'puma track', 'puma cat logo', 'puma classic'],
    vibes: ['german athletics', 'suede sneaker heritage', 'sporty casual', 'classic athletic', 'cat logo'],
    categories: ['sneakers', 'tees', 'tracksuits', 'shorts', 'jackets', 'accessories'],
    eras: ['1970s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['athletic', 'streetwear', 'sneaker culture', 'running'],
    pricePoint: 'mid',
  },

  'pro-player': {
    keywords: ['pro player', 'pro player brand', 'pro player tee', 'pro player jacket'],
    vibes: ['90s sports licensing', 'team tees', 'vintage sports', 'classic sportswear'],
    categories: ['tees', 'jackets', 'hats', 'jerseys'],
    eras: ['1990s', '2000s'],
    subculture: ['sports fan', 'nostalgia', '90s streetwear'],
    pricePoint: 'mid',
  },

  'quiksilver': {
    keywords: ['quiksilver', 'quiksilver brand', 'quik', 'quiksilver tee', 'quiksilver boardshorts', 'quiksilver hoodie'],
    vibes: ['california surf heritage', 'wave logo', 'boardshorts', 'beach culture', 'surf lifestyle'],
    categories: ['boardshorts', 'tees', 'hoodies', 'jackets', 'accessories', 'shoes'],
    eras: ['1980s', '1990s', '2000s', '2010s'],
    subculture: ['surf', 'california beach', 'skate', 'outdoor'],
    pricePoint: 'mid',
  },

  'r13': {
    keywords: ['r13', 'r13 denim', 'r13 jeans', 'r13 brand'],
    vibes: ['rock and roll denim', 'luxury grunge', 'NY cool', 'destroyed denim', 'premium casual'],
    categories: ['jeans', 'pants', 'tees', 'jackets'],
    eras: ['2010s', '2020s'],
    subculture: ['luxury denim', 'rock', 'NY fashion', 'contemporary luxury'],
    pricePoint: 'luxury',
  },

  'rvca': {
    keywords: ['rvca', 'rvca brand', 'rvca tee', 'rvca hoodie', 'va sport'],
    vibes: ['surf skate art', 'balance and chaos', 'california lifestyle', 'artistic', 'boardriders'],
    categories: ['tees', 'boardshorts', 'hoodies', 'shirts', 'accessories'],
    eras: ['2000s', '2010s', '2020s'],
    subculture: ['surf', 'skate', 'art', 'california'],
    pricePoint: 'mid',
  },

  'rag-and-bone': {
    keywords: ['rag and bone', 'rag & bone', 'rag bone brand', 'rag bone denim'],
    vibes: ['british meets NY', 'refined casual', 'quality basics', 'clean design', 'downtown luxury'],
    categories: ['tees', 'jeans', 'jackets', 'shirts', 'shoes', 'accessories', 'knitwear'],
    eras: ['2000s', '2010s', '2020s'],
    subculture: ['contemporary luxury', 'NY fashion', 'british fashion', 'minimalist'],
    pricePoint: 'luxury',
  },

  'ralph-lauren': {
    keywords: ['ralph lauren', 'ralph lauren brand', 'rrl', 'double rl', 'ralph lauren purple label', 'ralph lauren black label', 'chaps ralph lauren'],
    vibes: ['american dream', 'aspirational lifestyle', 'heritage americana', 'polo pony', 'preppy luxe'],
    categories: ['shirts', 'tees', 'knitwear', 'jackets', 'pants', 'accessories', 'shoes'],
    eras: ['1970s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['preppy', 'americana', 'luxury', 'heritage', 'ivy league'],
    pricePoint: 'premium',
  },

  'ray-ban': {
    keywords: ['ray ban', 'ray-ban', 'ray ban sunglasses', 'wayfarer', 'ray ban aviator', 'clubmaster'],
    vibes: ['classic American eyewear', 'wayfarer icon', 'aviator heritage', 'timeless cool', 'luxury eyewear'],
    categories: ['sunglasses', 'accessories'],
    eras: ['1950s', '1960s', '1970s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['classic style', 'americana', 'fashion accessory'],
    pricePoint: 'premium',
  },

  're-done': {
    keywords: ['re/done', 're done', 'redone brand', 'redone denim', 're/done levi'],
    vibes: ['reworked vintage levis', 'sustainable luxury denim', 'recycled heritage', 'LA cool'],
    categories: ['jeans', 'tees', 'jackets'],
    eras: ['2010s', '2020s'],
    subculture: ['sustainable fashion', 'luxury denim', 'LA fashion', 'upcycled'],
    pricePoint: 'luxury',
  },

  'realtree': {
    keywords: ['realtree', 'real tree', 'realtree camo', 'realtree ap', 'realtree xtra', 'realtree edge'],
    vibes: ['hunting camouflage', 'americana outdoors', 'deer season', 'nature pattern', 'country lifestyle'],
    categories: ['jackets', 'pants', 'tees', 'hoodies', 'accessories', 'hats'],
    eras: ['1990s', '2000s', '2010s', '2020s'],
    subculture: ['hunting', 'outdoor', 'americana', 'country'],
    pricePoint: 'mid',
  },

  'red-kap': {
    keywords: ['red kap', 'red kap brand', 'red kap work shirt', 'red kap uniform'],
    vibes: ['american workwear', 'uniform culture', 'blue collar', 'mechanic shirt', 'industrial'],
    categories: ['work shirts', 'pants', 'jackets', 'coveralls'],
    eras: ['1970s', '1980s', '1990s', '2000s', '2010s'],
    subculture: ['workwear', 'blue collar', 'americana', 'mechanic'],
    pricePoint: 'budget',
  },

  'reebok': {
    keywords: ['reebok', 'reebok brand', 'reebok classic', 'reebok freestyle', 'reebok pump', 'rbk'],
    vibes: ['80s aerobics heritage', 'classic runner', 'pump technology', 'fitness culture', 'sports legacy'],
    categories: ['sneakers', 'tees', 'tracksuits', 'shorts', 'accessories'],
    eras: ['1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['athletic', 'sneaker culture', 'fitness', 'streetwear'],
    pricePoint: 'mid',
  },

  'reiss': {
    keywords: ['reiss', 'reiss brand', 'reiss suit', 'reiss shirt', 'reiss jacket'],
    vibes: ['british smart casual', 'accessible luxury', 'sharp tailoring', 'grown up fashion', 'city professional'],
    categories: ['suits', 'shirts', 'jackets', 'trousers', 'dresses', 'accessories'],
    eras: ['2000s', '2010s', '2020s'],
    subculture: ['british fashion', 'smart casual', 'contemporary luxury', 'professional'],
    pricePoint: 'premium',
  },

  'replay': {
    keywords: ['replay', 'replay jeans', 'replay denim', 'replay brand', 'replay waitom'],
    vibes: ['italian denim', 'european casual', 'quality denim', 'fashion forward'],
    categories: ['jeans', 'pants', 'tees', 'jackets', 'accessories'],
    eras: ['1990s', '2000s', '2010s', '2020s'],
    subculture: ['italian fashion', 'european denim', 'contemporary casual'],
    pricePoint: 'premium',
  },

  'represent': {
    keywords: ['represent', 'represent clothing', 'represent brand', 'represent clo'],
    vibes: ['british luxury streetwear', 'biker influence', 'premium basics', 'distressed denim', 'mancunian cool'],
    categories: ['tees', 'hoodies', 'jeans', 'jackets', 'accessories'],
    eras: ['2010s', '2020s'],
    subculture: ['british streetwear', 'luxury casual', 'contemporary fashion'],
    pricePoint: 'premium',
  },

  'resistol-ranch': {
    keywords: ['resistol ranch', 'resistol', 'resistol hat', 'resistol western'],
    vibes: ['western heritage', 'cowboy hat', 'rodeo culture', 'texas western', 'ranchwear'],
    categories: ['hats', 'western shirts', 'jackets', 'accessories'],
    eras: ['1970s', '1980s', '1990s', '2000s', '2010s'],
    subculture: ['western', 'cowboy', 'rodeo', 'americana', 'texas'],
    pricePoint: 'premium',
  },

  'reyn-spooner': {
    keywords: ['reyn spooner', 'reyn spooner shirt', 'reyn spooner aloha', 'spooner kloth'],
    vibes: ['hawaiian heritage', 'aloha shirt', 'pacific island culture', 'surf tradition', 'reverse print'],
    categories: ['shirts', 'tees', 'accessories'],
    eras: ['1950s', '1960s', '1970s', '1980s', '1990s', '2000s', '2010s'],
    subculture: ['hawaiian', 'surf', 'americana', 'tropical'],
    pricePoint: 'premium',
  },

  'rick-owens': {
    keywords: ['rick owens', 'rick owens brand', 'rick owens drkshdw', 'rick owens shoes', 'rick owens jacket'],
    vibes: ['gothic avant-garde', 'dark minimalism', 'architectural fashion', 'california goth', 'drkshdw'],
    categories: ['tees', 'jackets', 'pants', 'shoes', 'accessories', 'knitwear'],
    eras: ['2000s', '2010s', '2020s'],
    subculture: ['avant-garde', 'goth', 'high fashion', 'minimalist', 'luxury'],
    pricePoint: 'luxury',
  },

  'rip-curl': {
    keywords: ['rip curl', 'ripcurl', 'rip curl brand', 'rip curl tee', 'rip curl wetsuit'],
    vibes: ['australian surf', 'big wave culture', 'beach lifestyle', 'wetsuit heritage', 'search for perfection'],
    categories: ['boardshorts', 'tees', 'hoodies', 'wetsuits', 'accessories'],
    eras: ['1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['surf', 'australian', 'beach', 'outdoor'],
    pricePoint: 'mid',
  },

  'river-island': {
    keywords: ['river island', 'river island brand', 'river island jeans', 'river island jacket'],
    vibes: ['british high street', 'trendy affordable', 'fashion forward basics', 'UK fashion'],
    categories: ['tees', 'jeans', 'jackets', 'dresses', 'shoes', 'accessories'],
    eras: ['2000s', '2010s', '2020s'],
    subculture: ['british fashion', 'high street', 'mainstream', 'fast fashion'],
    pricePoint: 'mid',
  },

  'robert-graham': {
    keywords: ['robert graham', 'robert graham brand', 'robert graham shirt', 'robert graham contrast cuff'],
    vibes: ['eclectic dress shirt', 'contrast cuffs', 'embroidered detail', 'fun formal', 'artistic shirt'],
    categories: ['shirts', 'tees', 'jackets', 'accessories'],
    eras: ['2000s', '2010s', '2020s'],
    subculture: ['eclectic', 'smart casual', 'american fashion'],
    pricePoint: 'premium',
  },

  'rocawear': {
    keywords: ['rocawear', 'roca wear', 'rocawear brand', 'jay-z brand', 'roc-a-wear'],
    vibes: ['2000s hip hop', 'jay-z label', 'urban fashion', 'logo heavy', 'rap lifestyle'],
    categories: ['tees', 'hoodies', 'jeans', 'jackets', 'accessories'],
    eras: ['1990s', '2000s', '2010s'],
    subculture: ['hip hop', '2000s streetwear', 'rap culture', 'urban fashion'],
    pricePoint: 'mid',
  },

  'rock-revival': {
    keywords: ['rock revival', 'rock revival jeans', 'rock revival brand'],
    vibes: ['embellished denim', 'rock and roll jeans', 'fleur de lis', 'bedazzled', 'premium casual'],
    categories: ['jeans', 'pants', 'tees', 'accessories'],
    eras: ['2000s', '2010s'],
    subculture: ['rock', 'premium denim', 'americana'],
    pricePoint: 'premium',
  },

  'roper': {
    keywords: ['roper', 'roper brand', 'roper western', 'roper boots', 'roper shirt'],
    vibes: ['western tradition', 'cowboy heritage', 'rodeo', 'ranch lifestyle', 'affordable western'],
    categories: ['boots', 'western shirts', 'pants', 'jackets', 'accessories'],
    eras: ['1970s', '1980s', '1990s', '2000s'],
    subculture: ['western', 'cowboy', 'rodeo', 'americana'],
    pricePoint: 'mid',
  },

  'route-66': {
    keywords: ['route 66', 'route 66 brand', 'route 66 tee', 'rt 66'],
    vibes: ['american highway nostalgia', 'tourist americana', 'roadtrip culture', 'kmart brand'],
    categories: ['tees', 'jeans', 'hoodies', 'accessories'],
    eras: ['1990s', '2000s'],
    subculture: ['americana', 'mainstream', 'budget brand'],
    pricePoint: 'budget',
  },

  'roxy': {
    keywords: ['roxy', 'roxy brand', 'roxy surf', 'roxy tee', 'roxy boardshorts', 'quiksilver roxy'],
    vibes: ['womens surf culture', 'california beach girl', 'tropical', 'colorful', 'boarding lifestyle'],
    categories: ['boardshorts', 'tees', 'hoodies', 'wetsuits', 'accessories', 'shoes'],
    eras: ['1990s', '2000s', '2010s', '2020s'],
    subculture: ['surf', 'womens action sports', 'california beach', 'outdoor'],
    pricePoint: 'mid',
  },

  'russell-athletic': {
    keywords: ['russell athletic', 'russell brand', 'russell sweatshirt', 'russell tee', 'russell hoodie'],
    vibes: ['classic american athletic', 'no-frills sportswear', 'made in usa heritage', 'blank canvas', 'vintage gym'],
    categories: ['tees', 'sweatshirts', 'hoodies', 'shorts', 'pants'],
    eras: ['1960s', '1970s', '1980s', '1990s', '2000s', '2010s'],
    subculture: ['athletic', 'americana', 'streetwear', 'vintage sportswear'],
    pricePoint: 'budget',
  },

  'rusty': {
    keywords: ['rusty', 'rusty brand', 'rusty surf', 'rusty tee', 'rusty boardshorts'],
    vibes: ['australian surf', 'surf culture', 'beach lifestyle', 'colorful', 'board brand'],
    categories: ['boardshorts', 'tees', 'hoodies', 'accessories'],
    eras: ['1990s', '2000s', '2010s'],
    subculture: ['surf', 'australian', 'beach', 'skate'],
    pricePoint: 'mid',
  },

  'rustler': {
    keywords: ['rustler', 'rustler jeans', 'rustler brand', 'rustler denim'],
    vibes: ['budget denim', 'walmart jeans', 'workingman', 'basic americana', 'affordable western'],
    categories: ['jeans', 'pants'],
    eras: ['1980s', '1990s', '2000s'],
    subculture: ['americana', 'western', 'workwear', 'budget fashion'],
    pricePoint: 'budget',
  },

  'saint-laurent': {
    keywords: ['saint laurent', 'ysl', 'yves saint laurent', 'saint laurent paris', 'slp', 'hedi slimane saint laurent'],
    vibes: ['french rock chic', 'skinny silhouette', 'parisian cool', 'rock and roll luxury', 'iconic french fashion'],
    categories: ['jackets', 'tees', 'shirts', 'jeans', 'shoes', 'bags', 'accessories'],
    eras: ['1960s', '1970s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['french luxury', 'rock', 'high fashion', 'luxury streetwear'],
    pricePoint: 'luxury',
  },

  'salvatore-ferragamo': {
    keywords: ['salvatore ferragamo', 'ferragamo', 'ferragamo brand', 'ferragamo shoes', 'ferragamo belt'],
    vibes: ['italian shoe heritage', 'florentine craftsmanship', 'classic luxury', 'vara bow', 'gancini buckle'],
    categories: ['shoes', 'bags', 'accessories', 'shirts', 'ties', 'belts'],
    eras: ['1970s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['italian luxury', 'classic luxury', 'high fashion'],
    pricePoint: 'luxury',
  },

  'sandro': {
    keywords: ['sandro', 'sandro paris', 'sandro brand', 'sandro maje'],
    vibes: ['french contemporary', 'parisian chic', 'accessible luxury', 'polished casual', 'left bank style'],
    categories: ['tees', 'jackets', 'dresses', 'pants', 'accessories'],
    eras: ['2000s', '2010s', '2020s'],
    subculture: ['french fashion', 'contemporary luxury', 'parisian'],
    pricePoint: 'premium',
  },

  'saucony': {
    keywords: ['saucony', 'saucony brand', 'saucony jazz', 'saucony shadow', 'saucony kinvara', 'saucony guide'],
    vibes: ['boston running heritage', 'serious runner', 'trail to road', 'classic runner silhouette', 'performance running'],
    categories: ['shoes', 'tees', 'shorts', 'accessories'],
    eras: ['1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['running', 'athletic', 'sneaker culture'],
    pricePoint: 'mid',
  },

  'schott-nyc': {
    keywords: ['schott nyc', 'schott', 'schott perfecto', 'schott leather', 'schott motorcycle', 'perfecto jacket'],
    vibes: ['original perfecto', 'american leather heritage', 'motorcycle icon', 'biker culture', 'rebel cool'],
    categories: ['leather jackets', 'jackets', 'tees', 'accessories'],
    eras: ['1940s', '1950s', '1960s', '1970s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['motorcycle', 'punk', 'rock', 'americana', 'biker'],
    pricePoint: 'premium',
  },

  'scotch-and-soda': {
    keywords: ['scotch and soda', 'scotch & soda', 'scotch soda brand', 'scotch soda amsterdam'],
    vibes: ['amsterdam lifestyle', 'eclectic casual', 'quality basics with flair', 'dutch fashion', 'artisanal feel'],
    categories: ['tees', 'shirts', 'jeans', 'jackets', 'accessories', 'knitwear'],
    eras: ['2000s', '2010s', '2020s'],
    subculture: ['european casual', 'dutch fashion', 'contemporary casual'],
    pricePoint: 'premium',
  },

  'sean-john': {
    keywords: ['sean john', 'sean combs brand', 'diddy brand', 'sean john clothing', 'sean john tee'],
    vibes: ['2000s hip hop luxury', 'puffy fashion', 'velour tracksuit', 'urban luxury', 'BET awards energy'],
    categories: ['tees', 'tracksuits', 'hoodies', 'jeans', 'jackets', 'accessories'],
    eras: ['1990s', '2000s', '2010s'],
    subculture: ['hip hop', '2000s streetwear', 'urban fashion', 'rap culture'],
    pricePoint: 'mid',
  },

  'see-by-chloe': {
    keywords: ['see by chloe', 'see by chloé', 'see by chloe brand'],
    vibes: ['bohemian feminine', 'chloe sister line', 'affordable romantic', 'whimsical fashion'],
    categories: ['dresses', 'tops', 'jackets', 'bags', 'accessories', 'shoes'],
    eras: ['2000s', '2010s', '2020s'],
    subculture: ['bohemian', 'feminine fashion', 'contemporary luxury'],
    pricePoint: 'premium',
  },

  'self-portrait': {
    keywords: ['self portrait', 'self-portrait brand', 'self portrait dress', 'self portrait lace'],
    vibes: ['occasion wear', 'lace midi dress', 'wedding guest', 'feminine luxury', 'event fashion'],
    categories: ['dresses', 'tops', 'jumpsuits', 'accessories'],
    eras: ['2010s', '2020s'],
    subculture: ['occasion wear', 'feminine luxury', 'contemporary'],
    pricePoint: 'premium',
  },

  'seven-for-all-mankind': {
    keywords: ['seven for all mankind', 'seven jeans', '7 for all mankind', 'seven brand denim', 'sfam'],
    vibes: ['LA premium denim', 'early 2000s denim boom', 'dark wash', 'celebrity denim', 'premium casual'],
    categories: ['jeans', 'pants', 'tees', 'jackets'],
    eras: ['2000s', '2010s', '2020s'],
    subculture: ['premium denim', 'LA fashion', 'celebrity style'],
    pricePoint: 'premium',
  },

  'shein': {
    keywords: ['shein', 'she in brand', 'shein clothing'],
    vibes: ['ultra fast fashion', 'trend at any price', 'social media fashion', 'disposable trend'],
    categories: ['tees', 'dresses', 'jeans', 'accessories', 'shoes'],
    eras: ['2010s', '2020s'],
    subculture: ['fast fashion', 'social media', 'ultra budget'],
    pricePoint: 'budget',
  },

  'shinola': {
    keywords: ['shinola', 'shinola detroit', 'shinola brand', 'shinola watch', 'shinola leather'],
    vibes: ['detroit made', 'american manufacturing revival', 'quality goods', 'watches and leather', 'craftsman brand'],
    categories: ['accessories', 'bags', 'watches', 'leather goods'],
    eras: ['2010s', '2020s'],
    subculture: ['americana', 'made in usa', 'quality craftsmanship'],
    pricePoint: 'premium',
  },

  'skechers': {
    keywords: ['skechers', 'skechers brand', 'skechers shoes', 'skechers d lites', 'skechers shape ups'],
    vibes: ['comfort footwear', 'dad shoe energy', 'accessible comfort', 'walking shoe', 'memory foam'],
    categories: ['shoes', 'sneakers', 'accessories'],
    eras: ['1990s', '2000s', '2010s', '2020s'],
    subculture: ['comfort', 'mainstream', 'dad shoe'],
    pricePoint: 'budget',
  },

  'skims': {
    keywords: ['skims', 'skims brand', 'kim kardashian skims', 'skims bodysuit', 'skims shapewear'],
    vibes: ['celebrity shapewear', 'inclusive sizing', 'body positive luxury', 'modern basics', 'neutral tones'],
    categories: ['shapewear', 'bras', 'underwear', 'loungewear', 'tees'],
    eras: ['2010s', '2020s'],
    subculture: ['celebrity brand', 'body positive', 'contemporary'],
    pricePoint: 'premium',
  },

  'smartwool': {
    keywords: ['smartwool', 'smartwool brand', 'smartwool socks', 'smartwool merino', 'smartwool base layer'],
    vibes: ['merino wool performance', 'outdoor comfort', 'base layer culture', 'itch free wool', 'hiking socks'],
    categories: ['socks', 'base layers', 'tees', 'accessories', 'knitwear'],
    eras: ['1990s', '2000s', '2010s', '2020s'],
    subculture: ['outdoor', 'hiking', 'gorpcore', 'performance'],
    pricePoint: 'premium',
  },

  'southpole': {
    keywords: ['southpole', 'south pole brand', 'southpole jeans', 'southpole tee', 'southpole hoodie'],
    vibes: ['2000s hip hop mall brand', 'urban casual', 'baggy jeans era', 'affordable streetwear'],
    categories: ['jeans', 'tees', 'hoodies', 'jackets', 'accessories'],
    eras: ['1990s', '2000s', '2010s'],
    subculture: ['hip hop', 'urban fashion', '2000s streetwear', 'mall brand'],
    pricePoint: 'budget',
  },

  'spanx': {
    keywords: ['spanx', 'spanx brand', 'spanx shapewear', 'spanx leggings'],
    vibes: ['shapewear pioneer', 'smoothing foundation', 'comfort meets function', 'body confidence'],
    categories: ['shapewear', 'leggings', 'underwear', 'bras'],
    eras: ['2000s', '2010s', '2020s'],
    subculture: ['comfort', 'mainstream', 'functional fashion'],
    pricePoint: 'premium',
  },

  'sports-specialties': {
    keywords: ['sports specialties', 'sports specialties brand', 'sports specialties cap', 'sports specialties hat'],
    vibes: ['vintage sports licensing', '90s wool snapbacks', 'pre-new era dominance', 'team cap heritage'],
    categories: ['hats', 'caps', 'accessories'],
    eras: ['1980s', '1990s'],
    subculture: ['sports fan', 'vintage sports', 'nostalgia', 'snapback culture'],
    pricePoint: 'mid',
  },

  'spyder': {
    keywords: ['spyder', 'spyder brand', 'spyder ski', 'spyder jacket', 'spyder activewear'],
    vibes: ['premium ski racing', 'technical ski wear', 'colorblock ski', 'performance mountain', 'race heritage'],
    categories: ['ski jackets', 'pants', 'base layers', 'accessories'],
    eras: ['1990s', '2000s', '2010s', '2020s'],
    subculture: ['skiing', 'outdoor', 'mountain lifestyle'],
    pricePoint: 'premium',
  },

  'st-johns-bay': {
    keywords: ["st john's bay", 'st johns bay', 'st john bay', 'jcp st johns'],
    vibes: ['jcpenney house brand', 'affordable basics', 'weekend casual', 'mainstream american'],
    categories: ['shirts', 'tees', 'pants', 'jackets', 'knitwear', 'accessories'],
    eras: ['1990s', '2000s', '2010s'],
    subculture: ['mainstream', 'affordable fashion', 'american casual'],
    pricePoint: 'budget',
  },

  'starter': {
    keywords: ['starter', 'starter brand', 'starter jacket', 'starter pullover', 'starter cap', 'starter satin'],
    vibes: ['90s sports licensing king', 'satin jacket', 'pullover anorak', 'sports team spirit', 'vintage authenticity'],
    categories: ['jackets', 'hats', 'tees', 'hoodies', 'accessories'],
    eras: ['1980s', '1990s', '2000s'],
    subculture: ['sports fan', 'hip hop', 'streetwear', 'nostalgia', '90s culture'],
    pricePoint: 'mid',
  },

  'stella-mccartney': {
    keywords: ['stella mccartney', 'stella brand', 'stella mccartney brand', 'stella adidas'],
    vibes: ['sustainable luxury', 'vegan fashion', 'british luxury', 'athletic luxury crossover', 'eco-conscious designer'],
    categories: ['jackets', 'tees', 'dresses', 'activewear', 'shoes', 'accessories', 'bags'],
    eras: ['2000s', '2010s', '2020s'],
    subculture: ['sustainable fashion', 'luxury', 'british fashion', 'vegan'],
    pricePoint: 'luxury',
  },

  'stone-island': {
    keywords: ['stone island', 'stone island brand', 'stone island badge', 'stone island compass', 'cp company stone'],
    vibes: ['italian research fabric', 'badge culture', 'garment dyed', 'football casual', 'technical outerwear'],
    categories: ['jackets', 'hoodies', 'tees', 'pants', 'accessories'],
    eras: ['1990s', '2000s', '2010s', '2020s'],
    subculture: ['football casual', 'italian fashion', 'streetwear', 'luxury streetwear'],
    pricePoint: 'premium',
  },

  'stussy': {
    keywords: ['stussy', 'stüssy', 'stussy brand', 'stussy tee', 'stussy hoodie', 'stussy 8 ball', 'stock logo'],
    vibes: ['OG streetwear', 'surf meets hip hop', 'laguna beach origins', 'shawn stussy signature', 'global street culture'],
    categories: ['tees', 'hoodies', 'hats', 'jackets', 'accessories', 'shorts'],
    eras: ['1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['streetwear', 'surf', 'hip hop', 'skate', 'california'],
    pricePoint: 'premium',
  },

  'sun-surf': {
    keywords: ['sun surf', 'sun surf brand', 'sun surf aloha', 'toyo enterprise', 'sun surf rayon'],
    vibes: ['japanese aloha heritage', 'rayon masterpiece', 'reproduction hawaiian', 'collector shirt', 'east meets aloha'],
    categories: ['shirts', 'accessories'],
    eras: ['1990s', '2000s', '2010s', '2020s'],
    subculture: ['hawaiian', 'japanese fashion', 'heritage', 'collector'],
    pricePoint: 'premium',
  },

  'supreme': {
    keywords: ['supreme', 'supreme brand', 'supreme box logo', 'supreme tee', 'supreme hoodie', 'bogo supreme', 'sup nyc'],
    vibes: ['NY skate institution', 'box logo drops', 'limited hype', 'downtown cool', 'collab culture'],
    categories: ['tees', 'hoodies', 'jackets', 'hats', 'accessories', 'shoes'],
    eras: ['1990s', '2000s', '2010s', '2020s'],
    subculture: ['streetwear', 'skate', 'hype', 'NY fashion', 'collector'],
    pricePoint: 'premium',
  },

  'swingster': {
    keywords: ['swingster', 'swingster brand', 'swingster jacket', 'swingster satin'],
    vibes: ['vintage satin jacket', 'team and corporate jackets', 'midwest americana', 'bowling jacket', 'retro outerwear'],
    categories: ['jackets', 'accessories'],
    eras: ['1970s', '1980s', '1990s'],
    subculture: ['americana', 'bowling', 'nostalgia', 'vintage sports'],
    pricePoint: 'mid',
  },

  'tna': {
    keywords: ['tna', 'tna brand', 'tna aritzia', 'tna hoodie', 'tna sweatpants'],
    vibes: ['aritzia sub-brand', 'canadian cozy', 'campus chic', 'premium lounge', 'clean basics'],
    categories: ['hoodies', 'sweatpants', 'tees', 'jackets', 'accessories'],
    eras: ['2000s', '2010s', '2020s'],
    subculture: ['canadian fashion', 'contemporary casual', 'campus'],
    pricePoint: 'premium',
  },

  'tapout': {
    keywords: ['tapout', 'tap out brand', 'tapout mma', 'tapout tee'],
    vibes: ['early 2000s MMA culture', 'Ed Hardy adjacent', 'cage fighter', 'affliction era', 'tough guy aesthetic'],
    categories: ['tees', 'shorts', 'hoodies', 'accessories'],
    eras: ['2000s', '2010s'],
    subculture: ['MMA', 'combat sports', '2000s streetwear'],
    pricePoint: 'mid',
  },

  'talbots': {
    keywords: ['talbots', 'talbots brand', 'talbots clothing', 'talbots petite'],
    vibes: ['classic american womens', 'petite specialist', 'polished conservative', 'suburban professional', 'timeless basics'],
    categories: ['pants', 'blouses', 'jackets', 'knitwear', 'dresses', 'accessories'],
    eras: ['1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['classic american', 'professional', 'mainstream'],
    pricePoint: 'mid',
  },

  'ted-baker': {
    keywords: ['ted baker', 'ted baker brand', 'ted baker shirt', 'ted baker london', 'ted baker suit'],
    vibes: ['british quirky smart', 'colorful tailoring', 'playful formal', 'british wit', 'floral detail'],
    categories: ['shirts', 'suits', 'tees', 'jackets', 'dresses', 'accessories'],
    eras: ['1990s', '2000s', '2010s', '2020s'],
    subculture: ['british fashion', 'smart casual', 'contemporary'],
    pricePoint: 'premium',
  },

  'the-hundreds': {
    keywords: ['the hundreds', 'the hundreds brand', 'adam bomb', 'the hundreds tee', 'the hundreds hoodie'],
    vibes: ['LA streetwear institution', 'adam bomb logo', 'skate influenced', 'west coast street', 'graphic heavy'],
    categories: ['tees', 'hoodies', 'hats', 'jackets', 'accessories'],
    eras: ['2000s', '2010s', '2020s'],
    subculture: ['streetwear', 'skate', 'LA fashion', 'california'],
    pricePoint: 'mid',
  },

  'the-kooples': {
    keywords: ['the kooples', 'kooples brand', 'the kooples jacket', 'the kooples tee'],
    vibes: ['french rock chic', 'couples brand', 'leather and lace', 'parisian edge', 'moto meets fashion'],
    categories: ['jackets', 'tees', 'shirts', 'dresses', 'accessories'],
    eras: ['2000s', '2010s', '2020s'],
    subculture: ['french fashion', 'rock', 'contemporary luxury'],
    pricePoint: 'premium',
  },

  'the-north-face': {
    keywords: ['the north face', 'north face', 'tnf', 'nuptse', 'north face fleece', 'north face jacket', 'denali jacket'],
    vibes: ['technical outdoor heritage', 'nuptse puffer icon', 'summit series', 'streetwear crossover', 'half dome logo'],
    categories: ['jackets', 'fleece', 'tees', 'pants', 'shoes', 'bags', 'accessories'],
    eras: ['1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['outdoor', 'gorpcore', 'streetwear', 'hiking', 'skiing'],
    pricePoint: 'premium',
  },

  'theory': {
    keywords: ['theory', 'theory brand', 'theory suit', 'theory pants', 'theory blazer'],
    vibes: ['modern minimalism', 'quality basics', 'work to weekend', 'clean tailoring', 'manhattan professional'],
    categories: ['suits', 'pants', 'blazers', 'tees', 'knitwear', 'jackets', 'accessories'],
    eras: ['2000s', '2010s', '2020s'],
    subculture: ['contemporary luxury', 'minimalist', 'professional', 'NY fashion'],
    pricePoint: 'premium',
  },

  'thom-browne': {
    keywords: ['thom browne', 'thom browne brand', 'thom browne suit', 'rwb stripe', 'thom browne grosgrain'],
    vibes: ['american grey flannel', 'shrunken proportions', 'rwb stripe', 'preppy reimagined', 'new formalism'],
    categories: ['suits', 'shirts', 'tees', 'knitwear', 'jackets', 'shoes', 'accessories'],
    eras: ['2000s', '2010s', '2020s'],
    subculture: ['american luxury', 'contemporary high fashion', 'avant-garde', 'preppy'],
    pricePoint: 'luxury',
  },

  'timberland': {
    keywords: ['timberland', 'timbs', 'timberland boots', 'wheat timbs', 'timberland 6 inch', 'timberland tee', 'timberland jacket'],
    vibes: ['wheat boot icon', 'hip hop adopted', 'rugged american', 'outdoor workwear', 'construction site to street'],
    categories: ['boots', 'shoes', 'tees', 'jackets', 'accessories'],
    eras: ['1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['workwear', 'hip hop', 'streetwear', 'outdoor', 'americana'],
    pricePoint: 'mid',
  },

  'tom-ford': {
    keywords: ['tom ford', 'tom ford brand', 'tom ford suit', 'tom ford sunglasses', 'tf logo'],
    vibes: ['sex and luxury', 'sleek modern glamour', 'gucci era revisited', 'sharp tailoring', 'bold sensuality'],
    categories: ['suits', 'shirts', 'sunglasses', 'accessories', 'bags', 'shoes', 'fragrance'],
    eras: ['2000s', '2010s', '2020s'],
    subculture: ['luxury', 'high fashion', 'menswear luxury', 'contemporary glamour'],
    pricePoint: 'luxury',
  },

  'tommy-bahama': {
    keywords: ['tommy bahama', 'tommy bahama brand', 'tommy bahama shirt', 'tommy bahama silk', 'tommy bahama camp'],
    vibes: ['resort lifestyle', 'island escapism', 'silk camp shirt', 'upscale beach', 'tropical luxury'],
    categories: ['shirts', 'tees', 'pants', 'shorts', 'accessories', 'knitwear'],
    eras: ['1990s', '2000s', '2010s', '2020s'],
    subculture: ['resort wear', 'tropical', 'americana', 'luxury casual'],
    pricePoint: 'premium',
  },

  'tommy-hilfiger': {
    keywords: ['tommy hilfiger', 'tommy hilfiger brand', 'tommy brand', 'tommy jeans', 'tommy flag logo', 'hilfiger'],
    vibes: ['all-american preppy', 'flag logo', 'nautical americana', '90s hip hop adopted', 'classic casual'],
    categories: ['tees', 'polos', 'shirts', 'jeans', 'jackets', 'accessories', 'knitwear'],
    eras: ['1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['preppy', 'americana', 'hip hop', 'casual luxury', 'mainstream'],
    pricePoint: 'mid',
  },

  'topman': {
    keywords: ['topman', 'topman brand', 'topman shirt', 'topman jeans', 'topshop topman'],
    vibes: ['british high street menswear', 'trend-forward basics', 'UK fashion', 'accessible style'],
    categories: ['tees', 'shirts', 'jeans', 'jackets', 'accessories'],
    eras: ['2000s', '2010s', '2020s'],
    subculture: ['british fashion', 'high street', 'mainstream', 'contemporary'],
    pricePoint: 'mid',
  },

  'topshop': {
    keywords: ['topshop', 'topshop brand', 'topshop jeans', 'topshop dress', 'arcadia topshop'],
    vibes: ['british high street queen', 'trend setting', 'Kate Moss collab', 'UK fashion institution', 'affordable fashion'],
    categories: ['tees', 'jeans', 'dresses', 'jackets', 'accessories', 'shoes'],
    eras: ['1990s', '2000s', '2010s', '2020s'],
    subculture: ['british fashion', 'high street', 'mainstream', 'contemporary'],
    pricePoint: 'mid',
  },

  'tory-burch': {
    keywords: ['tory burch', 'tory burch brand', 'tory burch logo', 'tory burch bag', 'tory burch flats', 'reva flats'],
    vibes: ['boho preppy', 'double-T logo', 'american bohemian luxury', 'colorful accessories', 'resort meets city'],
    categories: ['bags', 'shoes', 'dresses', 'tops', 'jackets', 'accessories'],
    eras: ['2000s', '2010s', '2020s'],
    subculture: ['american luxury', 'preppy', 'bohemian', 'contemporary luxury'],
    pricePoint: 'premium',
  },

  'true-religion': {
    keywords: ['true religion', 'true religion jeans', 'true religion brand', 'true religion horseshoe', 'tr jeans'],
    vibes: ['2000s premium denim', 'horseshoe logo', 'super t stitch', 'celebrity denim', 'bold branding'],
    categories: ['jeans', 'pants', 'tees', 'hoodies', 'jackets', 'accessories'],
    eras: ['2000s', '2010s', '2020s'],
    subculture: ['premium denim', 'hip hop', '2000s fashion', 'celebrity style'],
    pricePoint: 'premium',
  },

  'tultex': {
    keywords: ['tultex', 'tultex brand', 'tultex tee', 'tultex sweatshirt'],
    vibes: ['blank canvas brand', 'printable basics', 'american apparel alternative', 'affordable blank'],
    categories: ['tees', 'sweatshirts', 'hoodies'],
    eras: ['1990s', '2000s', '2010s', '2020s'],
    subculture: ['americana', 'blank brand', 'printmaking'],
    pricePoint: 'budget',
  },

  'us-polo-assn': {
    keywords: ['us polo assn', 'u.s. polo assn', 'us polo association', 'uspa brand', 'us polo tee'],
    vibes: ['accessible polo heritage', 'budget polo pony', 'americana casual', 'polo adjacent'],
    categories: ['polos', 'tees', 'shirts', 'jackets', 'accessories'],
    eras: ['1990s', '2000s', '2010s', '2020s'],
    subculture: ['american casual', 'mainstream', 'preppy adjacent'],
    pricePoint: 'budget',
  },

  'union-bay': {
    keywords: ['union bay', 'union bay brand', 'union bay jeans', 'ubco brand'],
    vibes: ['90s mall brand', 'affordable casual', 'teen americana', 'basic denim'],
    categories: ['jeans', 'pants', 'tees', 'jackets', 'accessories'],
    eras: ['1980s', '1990s', '2000s'],
    subculture: ['mall brand', 'americana', 'mainstream', 'teen fashion'],
    pricePoint: 'budget',
  },

  'under-armour': {
    keywords: ['under armour', 'under armour brand', 'ua brand', 'under armour compression', 'heat gear', 'cold gear'],
    vibes: ['performance compression', 'heatgear coldgear', 'american athletic', 'performance tech', 'sports innovation'],
    categories: ['tees', 'compression', 'hoodies', 'jackets', 'pants', 'shoes', 'accessories'],
    eras: ['2000s', '2010s', '2020s'],
    subculture: ['athletic', 'performance', 'american sports'],
    pricePoint: 'mid',
  },

  'uniqlo': {
    keywords: ['uniqlo', 'uniqlo brand', 'heattech', 'uniqlo tee', 'uniqlo fleece', 'airism', 'uniqlo u'],
    vibes: ['japanese functional basics', 'quality at scale', 'heattech innovation', 'minimalist wardrobe building', 'accessible perfection'],
    categories: ['tees', 'pants', 'jackets', 'knitwear', 'base layers', 'accessories', 'shoes'],
    eras: ['1990s', '2000s', '2010s', '2020s'],
    subculture: ['minimalist', 'japanese fashion', 'basics', 'sustainable fashion'],
    pricePoint: 'mid',
  },

  'urban-outfitters': {
    keywords: ['urban outfitters', 'urban outfitters brand', 'uo brand', 'urban outfitters exclusive'],
    vibes: ['alt mainstream', 'thrift store aesthetic curated', 'indie teen', 'boho eclectic', 'campus cool'],
    categories: ['tees', 'jeans', 'jackets', 'dresses', 'accessories', 'shoes'],
    eras: ['1990s', '2000s', '2010s', '2020s'],
    subculture: ['alternative', 'indie', 'boho', 'mainstream alternative', 'campus'],
    pricePoint: 'mid',
  },

  'valentino': {
    keywords: ['valentino', 'valentino brand', 'valentino garavani', 'valentino rockstud', 'vltn logo', 'red valentino'],
    vibes: ['roman glamour', 'rockstud hardware', 'red carpet luxury', 'italian couture', 'bold romantic'],
    categories: ['dresses', 'shoes', 'bags', 'jackets', 'tees', 'accessories'],
    eras: ['1960s', '1970s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['italian luxury', 'couture', 'high fashion', 'glamour'],
    pricePoint: 'luxury',
  },

  'vans': {
    keywords: ['vans', 'vans brand', 'vans off the wall', 'vans authentic', 'vans old skool', 'vans sk8 hi', 'vans era', 'vans slip on'],
    vibes: ['southern california skate heritage', 'checkerboard', 'off the wall', 'skate shoe OG', 'skate to street'],
    categories: ['shoes', 'tees', 'hoodies', 'hats', 'accessories'],
    eras: ['1970s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['skate', 'california', 'punk', 'streetwear', 'surf'],
    pricePoint: 'mid',
  },

  'varley': {
    keywords: ['varley', 'varley brand', 'varley activewear', 'varley leggings'],
    vibes: ['premium activewear', 'london meets LA', 'luxe athleisure', 'color-blocked fitness', 'yoga to brunch'],
    categories: ['leggings', 'sports bras', 'tees', 'jackets', 'accessories'],
    eras: ['2010s', '2020s'],
    subculture: ['athleisure', 'luxury active', 'contemporary'],
    pricePoint: 'premium',
  },

  'vera-bradley': {
    keywords: ['vera bradley', 'vera bradley brand', 'vera bradley bag', 'vera bradley pattern'],
    vibes: ['colorful quilted patterns', 'american accessories', 'floral prints', 'campus bag culture', 'practical color'],
    categories: ['bags', 'accessories', 'totes', 'backpacks'],
    eras: ['1990s', '2000s', '2010s', '2020s'],
    subculture: ['american casual', 'campus', 'mainstream', 'colorful fashion'],
    pricePoint: 'mid',
  },

  'versace': {
    keywords: ['versace', 'versace brand', 'gianni versace', 'versace medusa', 'versace print', 'versace jeans couture', 'versus versace'],
    vibes: ['italian maximalist luxury', 'medusa head', 'baroque prints', 'miami excess', 'rock star luxury'],
    categories: ['tees', 'jackets', 'jeans', 'accessories', 'shoes', 'bags', 'dresses'],
    eras: ['1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['italian luxury', 'maximalist', 'rock star', 'high fashion', 'luxury streetwear'],
    pricePoint: 'luxury',
  },

  'vetements': {
    keywords: ['vetements', 'vetements brand', 'demna gvasalia vetements', 'vtm brand'],
    vibes: ['post-ironic fashion', 'deconstructed basics', 'DHL tee energy', 'fashion as critique', 'oversized extreme'],
    categories: ['tees', 'hoodies', 'jackets', 'dresses', 'accessories'],
    eras: ['2010s', '2020s'],
    subculture: ['avant-garde', 'luxury streetwear', 'post-ironic', 'high fashion'],
    pricePoint: 'luxury',
  },

  'victorias-secret': {
    keywords: ["victoria's secret", 'victorias secret', 'vs brand', 'victoria secret lingerie', 'vs fashion show'],
    vibes: ['american lingerie giant', 'fashion show spectacle', 'bombshell', 'angels', 'mainstream femininity'],
    categories: ['lingerie', 'bras', 'underwear', 'loungewear', 'accessories'],
    eras: ['1990s', '2000s', '2010s', '2020s'],
    subculture: ['feminine fashion', 'mainstream', 'beauty'],
    pricePoint: 'mid',
  },

  'vince': {
    keywords: ['vince', 'vince brand', 'vince camuto', 'vince clothing', 'vince tee', 'vince cashmere'],
    vibes: ['LA minimalist luxury', 'soft basics', 'cashmere culture', 'everyday luxury', 'clean California'],
    categories: ['tees', 'knitwear', 'pants', 'jackets', 'dresses', 'accessories'],
    eras: ['2000s', '2010s', '2020s'],
    subculture: ['LA fashion', 'minimalist', 'contemporary luxury'],
    pricePoint: 'premium',
  },

  'vineyard-vines': {
    keywords: ['vineyard vines', 'vineyard vines brand', 'vv brand', 'every day should feel this good', 'vineyard vines whale'],
    vibes: ['nantucket prep', 'whale logo', 'east coast summer', 'regatta lifestyle', 'colorful americana prep'],
    categories: ['shirts', 'tees', 'pants', 'jackets', 'accessories', 'knitwear'],
    eras: ['2000s', '2010s', '2020s'],
    subculture: ['preppy', 'new england', 'americana', 'nautical'],
    pricePoint: 'premium',
  },

  'volcom': {
    keywords: ['volcom', 'volcom brand', 'volcom stone', 'volcom tee', 'volcom boardshorts', 'volcom snow'],
    vibes: ['surf skate snow triple threat', 'stone logo', 'youth culture', 'california alternative', 'action sports lifestyle'],
    categories: ['tees', 'boardshorts', 'hoodies', 'jackets', 'pants', 'accessories', 'shoes'],
    eras: ['1990s', '2000s', '2010s', '2020s'],
    subculture: ['surf', 'skate', 'snowboard', 'california', 'action sports'],
    pricePoint: 'mid',
  },

  'wales-bonner': {
    keywords: ['wales bonner', 'wales bonner brand', 'grace wales bonner', 'wales bonner adidas'],
    vibes: ['afro-atlantic luxury', 'intellectual fashion', 'cultural exploration', 'british luxury heritage mix', 'artisan craftsmanship'],
    categories: ['tees', 'jackets', 'shirts', 'knitwear', 'accessories', 'shoes'],
    eras: ['2010s', '2020s'],
    subculture: ['luxury', 'british fashion', 'contemporary high fashion', 'cultural'],
    pricePoint: 'luxury',
  },

  'woolrich': {
    keywords: ['woolrich', 'woolrich brand', 'woolrich wool', 'woolrich shirt', 'woolrich jacket', 'woolrich parka'],
    vibes: ['american wool heritage', 'outdoor original', 'buffalo plaid', 'oldest american outdoor brand', 'lumberjack tradition'],
    categories: ['shirts', 'jackets', 'knitwear', 'pants', 'accessories'],
    eras: ['1950s', '1960s', '1970s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['americana', 'outdoor', 'heritage', 'lumberjack', 'workwear'],
    pricePoint: 'premium',
  },

  'wrangler': {
    keywords: ['wrangler', 'wrangler jeans', 'wrangler brand', 'wrangler denim', 'wrangler western', 'wrangler 13mwz', 'wrangler cowboy cut'],
    vibes: ['western denim icon', 'rodeo authentic', 'cowboy cut', 'country music', 'blue collar americana'],
    categories: ['jeans', 'pants', 'shirts', 'jackets', 'accessories'],
    eras: ['1940s', '1950s', '1960s', '1970s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['western', 'cowboy', 'americana', 'workwear', 'country'],
    pricePoint: 'budget',
  },

  'xlarge': {
    keywords: ['xlarge', 'x-large brand', 'xlarge streetwear', 'xlarge gorilla logo', 'xl brand'],
    vibes: ['90s LA streetwear pioneer', 'gorilla logo', 'hip hop roots', 'skate adjacent', 'west coast cool'],
    categories: ['tees', 'hoodies', 'jackets', 'hats', 'accessories'],
    eras: ['1990s', '2000s', '2010s', '2020s'],
    subculture: ['streetwear', 'hip hop', 'skate', 'LA fashion', 'california'],
    pricePoint: 'mid',
  },

  'y-3': {
    keywords: ['y-3', 'y3 brand', 'yohji yamamoto adidas', 'y-3 shoes', 'y3 jacket', 'y three'],
    vibes: ['yohji meets adidas', 'fashion sport fusion', 'japanese avant-garde athletic', 'black preferred', 'deconstructed sport'],
    categories: ['shoes', 'tees', 'jackets', 'pants', 'accessories'],
    eras: ['2000s', '2010s', '2020s'],
    subculture: ['luxury streetwear', 'avant-garde', 'japanese fashion', 'athletic luxury'],
    pricePoint: 'luxury',
  },

  'yeezy': {
    keywords: ['yeezy', 'yeezy brand', 'kanye west yeezy', 'yeezy boost', 'yeezy gap', 'yeezy season', 'ye brand'],
    vibes: ['kanye west vision', 'post-apocalyptic earth tones', 'boost sole', 'limited drops', 'fashion as spectacle'],
    categories: ['shoes', 'tees', 'hoodies', 'jackets', 'accessories'],
    eras: ['2010s', '2020s'],
    subculture: ['hype', 'luxury streetwear', 'celebrity fashion', 'sneaker culture'],
    pricePoint: 'luxury',
  },

  'zadig-and-voltaire': {
    keywords: ['zadig and voltaire', 'zadig & voltaire', 'zadig voltaire brand', 'zv brand'],
    vibes: ['parisian rock chic', 'skull and stars', 'french cool', 'bohemian luxury', 'literary references'],
    categories: ['tees', 'jackets', 'dresses', 'bags', 'accessories', 'knitwear'],
    eras: ['2000s', '2010s', '2020s'],
    subculture: ['french fashion', 'rock', 'contemporary luxury', 'bohemian'],
    pricePoint: 'premium',
  },

  'zara': {
    keywords: ['zara', 'zara brand', 'zara tee', 'zara jacket', 'zara jeans', 'inditex zara'],
    vibes: ['fast fashion runway', 'trend speed champion', 'accessible designer looks', 'madrid origins', 'catwalk to store fast'],
    categories: ['tees', 'jeans', 'jackets', 'dresses', 'shoes', 'accessories', 'knitwear'],
    eras: ['1990s', '2000s', '2010s', '2020s'],
    subculture: ['fast fashion', 'mainstream', 'european casual', 'trend-driven'],
    pricePoint: 'mid',
  },

  'zimmermann': {
    keywords: ['zimmermann', 'zimmermann brand', 'zimmermann dress', 'zimmermann swim', 'zimmermann resort'],
    vibes: ['australian luxury resort', 'feminine prints', 'broderie anglaise', 'vacation luxury', 'romantic feminine'],
    categories: ['dresses', 'swimwear', 'tops', 'jackets', 'accessories'],
    eras: ['2000s', '2010s', '2020s'],
    subculture: ['australian fashion', 'luxury resort', 'feminine luxury', 'contemporary'],
    pricePoint: 'luxury',
  },

};

export default BRAND_DNA_EXPANSION_3;
