// ============================================================================
// MASSIVE BRAND DATABASE EXPANSION - PART 3
// More NCAA (100+), International Brands, Vintage Categories, Regional Brands
// ============================================================================

type PatternContext = {
  keywords: string[];
  vibes: string[];
  categories: string[];
  eras: string[];
  subculture: string[];
  pricePoint: 'budget' | 'mid' | 'premium' | 'luxury';
};

export const BRAND_DNA_EXPANSION_2: Record<string, PatternContext> = {
  
  // ============ MORE NCAA / COLLEGES (100+) ============
  
  // ACC Schools
  'duke university': {
    keywords: ['duke', 'blue devils', 'durham', 'north carolina', 'blue', 'white', 'cameron indoor', 'coach k', 'krzyzewski', 'laettner', 'grant hill', 'ACC', 'basketball school'],
    vibes: ['North Carolina', 'ACC', 'basketball', 'prestigious', 'academic', 'champion'],
    categories: ['jerseys', 'tees', 'hoodies', 'sweatshirts', 'vintage', 'champion'],
    eras: ['1830s', '1920s', '1930s', '1940s', '1950s', '1960s', '1970s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['college', 'North Carolina', 'ACC', 'basketball'],
    pricePoint: 'mid',
  },

  'university of north carolina': {
    keywords: ['UNC', 'north carolina', 'tar heels', 'chapel hill', 'carolina blue', 'white', 'dean dome', 'dean smith', 'michael jordan', 'ACC', 'basketball'],
    vibes: ['North Carolina', 'ACC', 'basketball', 'prestigious', 'traditional', 'jordan'],
    categories: ['jerseys', 'tees', 'hoodies', 'sweatshirts', 'vintage', 'champion', 'nike'],
    eras: ['1780s', '1920s', '1930s', '1940s', '1950s', '1960s', '1970s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['college', 'North Carolina', 'ACC', 'basketball'],
    pricePoint: 'mid',
  },

  'nc state university': {
    keywords: ['NC state', 'wolfpack', 'raleigh', 'red', 'white', 'jimmy valvano', 'jim valvano', 'ACC', 'engineering'],
    vibes: ['North Carolina', 'ACC', 'underdog', 'engineering', 'loyal', 'gritty'],
    categories: ['tees', 'hoodies', 'sweatshirts', 'vintage', 'champion'],
    eras: ['1880s', '1920s', '1940s', '1960s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['college', 'North Carolina', 'ACC', 'engineering'],
    pricePoint: 'budget',
  },

  'wake forest university': {
    keywords: ['wake forest', 'demon deacons', 'winston salem', 'gold', 'black', 'ACC', 'small school'],
    vibes: ['North Carolina', 'ACC', 'small', 'prestigious', 'traditional', 'academic'],
    categories: ['tees', 'hoodies', 'sweatshirts', 'vintage'],
    eras: ['1830s', '1950s', '1960s', '1970s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['college', 'North Carolina', 'ACC', 'small school'],
    pricePoint: 'mid',
  },

  'virginia tech': {
    keywords: ['virginia tech', 'hokies', 'VT', 'blacksburg', 'maroon', 'orange', 'enter sandman', 'beamer', 'frank beamer', 'ACC'],
    vibes: ['Virginia', 'ACC', 'engineering', 'passionate', 'loyal', 'enter sandman'],
    categories: ['jerseys', 'tees', 'hoodies', 'sweatshirts', 'vintage', 'champion'],
    eras: ['1870s', '1960s', '1970s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['college', 'Virginia', 'ACC', 'engineering'],
    pricePoint: 'mid',
  },

  'university of virginia': {
    keywords: ['virginia', 'cavaliers', 'UVA', 'charlottesville', 'orange', 'blue', 'ACC', 'jefferson', 'thomas jefferson', 'prestigious'],
    vibes: ['Virginia', 'ACC', 'prestigious', 'traditional', 'academic', 'southern'],
    categories: ['tees', 'hoodies', 'sweatshirts', 'vintage', 'champion'],
    eras: ['1810s', '1900s', '1920s', '1940s', '1960s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['college', 'Virginia', 'ACC', 'academic'],
    pricePoint: 'mid',
  },

  'louisville': {
    keywords: ['louisville', 'cardinals', 'kentucky', 'red', 'black', 'ACC', 'basketball', 'pitino'],
    vibes: ['Kentucky', 'ACC', 'basketball', 'urban', 'gritty', 'competitive'],
    categories: ['jerseys', 'tees', 'hoodies', 'sweatshirts', 'vintage'],
    eras: ['1790s', '1960s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['college', 'Kentucky', 'ACC', 'basketball'],
    pricePoint: 'mid',
  },

  'syracuse university': {
    keywords: ['syracuse', 'orange', 'cuse', 'new york', 'orange', 'blue', 'carrier dome', 'boeheim', 'ACC', 'basketball'],
    vibes: ['New York', 'ACC', 'basketball', 'snow', 'passionate', 'loud'],
    categories: ['jerseys', 'tees', 'hoodies', 'sweatshirts', 'vintage', 'champion'],
    eras: ['1870s', '1960s', '1970s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['college', 'New York', 'ACC', 'basketball'],
    pricePoint: 'mid',
  },

  'boston college': {
    keywords: ['boston college', 'eagles', 'BC', 'chestnut hill', 'maroon', 'gold', 'ACC', 'boston', 'catholic'],
    vibes: ['Boston', 'ACC', 'catholic', 'traditional', 'academic', 'new england'],
    categories: ['tees', 'hoodies', 'sweatshirts', 'vintage', 'champion'],
    eras: ['1860s', '1940s', '1960s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['college', 'Boston', 'ACC', 'catholic'],
    pricePoint: 'mid',
  },

  'university of pittsburgh': {
    keywords: ['pitt', 'pittsburgh', 'panthers', 'pennsylvania', 'blue', 'gold', 'ACC', 'steel city', 'tony dorsett'],
    vibes: ['Pittsburgh', 'ACC', 'urban', 'blue collar', 'steel city', 'gritty'],
    categories: ['jerseys', 'tees', 'hoodies', 'sweatshirts', 'vintage', 'champion'],
    eras: ['1780s', '1960s', '1970s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['college', 'Pittsburgh', 'ACC', 'urban'],
    pricePoint: 'mid',
  },

  // SEC Schools
  'university of kentucky': {
    keywords: ['kentucky', 'wildcats', 'UK', 'lexington', 'blue', 'white', 'rupp arena', 'basketball', 'SEC', 'blue blood'],
    vibes: ['Kentucky', 'SEC', 'basketball', 'passionate', 'traditional', 'blue blood'],
    categories: ['jerseys', 'tees', 'hoodies', 'sweatshirts', 'vintage', 'champion', 'nike'],
    eras: ['1860s', '1930s', '1940s', '1950s', '1960s', '1970s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['college', 'Kentucky', 'SEC', 'basketball'],
    pricePoint: 'mid',
  },

  'university of arkansas': {
    keywords: ['arkansas', 'razorbacks', 'hogs', 'fayetteville', 'cardinal', 'white', 'calling the hogs', 'SEC', 'jerry jones'],
    vibes: ['Arkansas', 'SEC', 'southern', 'passionate', 'loud', 'razorback'],
    categories: ['jerseys', 'tees', 'hoodies', 'sweatshirts', 'vintage', 'champion'],
    eras: ['1870s', '1960s', '1970s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['college', 'Arkansas', 'SEC', 'southern'],
    pricePoint: 'mid',
  },

  'university of missouri': {
    keywords: ['missouri', 'tigers', 'mizzou', 'columbia', 'gold', 'black', 'SEC', 'midwest'],
    vibes: ['Missouri', 'SEC', 'midwest', 'underdog', 'passionate', 'tiger'],
    categories: ['jerseys', 'tees', 'hoodies', 'sweatshirts', 'vintage', 'champion'],
    eras: ['1830s', '1960s', '1970s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['college', 'Missouri', 'SEC', 'midwest'],
    pricePoint: 'mid',
  },

  'university of south carolina': {
    keywords: ['south carolina', 'gamecocks', 'USC', 'columbia', 'garnet', 'black', 'SEC', 'spurs up', 'sandstorm'],
    vibes: ['South Carolina', 'SEC', 'southern', 'underdog', 'passionate', 'gamecock'],
    categories: ['jerseys', 'tees', 'hoodies', 'sweatshirts', 'vintage', 'champion'],
    eras: ['1800s', '1960s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['college', 'South Carolina', 'SEC', 'southern'],
    pricePoint: 'mid',
  },

  'vanderbilt university': {
    keywords: ['vanderbilt', 'commodores', 'vandy', 'nashville', 'gold', 'black', 'SEC', 'academic', 'prestigious'],
    vibes: ['Tennessee', 'SEC', 'academic', 'prestigious', 'small', 'music city'],
    categories: ['tees', 'hoodies', 'sweatshirts', 'vintage', 'champion'],
    eras: ['1870s', '1950s', '1960s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['college', 'Tennessee', 'SEC', 'academic'],
    pricePoint: 'mid',
  },

  'ole miss': {
    keywords: ['ole miss', 'mississippi', 'rebels', 'oxford', 'navy', 'red', 'SEC', 'hotty toddy', 'grove', 'southern charm'],
    vibes: ['Mississippi', 'SEC', 'southern', 'preppy', 'party', 'traditional'],
    categories: ['jerseys', 'tees', 'hoodies', 'sweatshirts', 'vintage', 'champion'],
    eras: ['1840s', '1960s', '1970s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['college', 'Mississippi', 'SEC', 'southern'],
    pricePoint: 'mid',
  },

  'mississippi state': {
    keywords: ['mississippi state', 'bulldogs', 'state', 'starkville', 'maroon', 'white', 'SEC', 'cowbells', 'hail state'],
    vibes: ['Mississippi', 'SEC', 'southern', 'agricultural', 'cowbells', 'gritty'],
    categories: ['jerseys', 'tees', 'hoodies', 'sweatshirts', 'vintage', 'champion'],
    eras: ['1870s', '1960s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['college', 'Mississippi', 'SEC', 'agricultural'],
    pricePoint: 'budget',
  },

  // Big 12 Schools
  'kansas university': {
    keywords: ['kansas', 'jayhawks', 'KU', 'lawrence', 'crimson', 'blue', 'big 12', 'basketball', 'allen fieldhouse', 'rock chalk'],
    vibes: ['Kansas', 'big 12', 'basketball', 'traditional', 'blue blood', 'passionate'],
    categories: ['jerseys', 'tees', 'hoodies', 'sweatshirts', 'vintage', 'champion', 'adidas'],
    eras: ['1860s', '1920s', '1940s', '1950s', '1960s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['college', 'Kansas', 'Big 12', 'basketball'],
    pricePoint: 'mid',
  },

  'kansas state university': {
    keywords: ['kansas state', 'wildcats', 'KSU', 'manhattan', 'purple', 'white', 'big 12', 'bill snyder', 'powercat'],
    vibes: ['Kansas', 'big 12', 'agricultural', 'underdog', 'loyal', 'purple wizard'],
    categories: ['jerseys', 'tees', 'hoodies', 'sweatshirts', 'vintage', 'champion'],
    eras: ['1860s', '1960s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['college', 'Kansas', 'Big 12', 'agricultural'],
    pricePoint: 'budget',
  },

  'iowa state university': {
    keywords: ['iowa state', 'cyclones', 'ISU', 'ames', 'cardinal', 'gold', 'big 12', 'agricultural', 'midwest'],
    vibes: ['Iowa', 'big 12', 'agricultural', 'midwest', 'underdog', 'loyal'],
    categories: ['jerseys', 'tees', 'hoodies', 'sweatshirts', 'vintage', 'champion'],
    eras: ['1850s', '1960s', '1970s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['college', 'Iowa', 'Big 12', 'agricultural'],
    pricePoint: 'budget',
  },

  'oklahoma state': {
    keywords: ['oklahoma state', 'cowboys', 'OSU', 'stillwater', 'orange', 'black', 'big 12', 'boone pickens', 'gundy'],
    vibes: ['Oklahoma', 'big 12', 'cowboys', 'orange', 'loyal', 'passionate'],
    categories: ['jerseys', 'tees', 'hoodies', 'sweatshirts', 'vintage', 'champion'],
    eras: ['1890s', '1940s', '1960s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['college', 'Oklahoma', 'Big 12', 'cowboys'],
    pricePoint: 'mid',
  },

  'texas tech': {
    keywords: ['texas tech', 'red raiders', 'TTU', 'lubbock', 'red', 'black', 'big 12', 'guns up', 'tortilla'],
    vibes: ['Texas', 'big 12', 'west texas', 'guns up', 'tortilla throwing', 'passionate'],
    categories: ['jerseys', 'tees', 'hoodies', 'sweatshirts', 'vintage', 'champion'],
    eras: ['1920s', '1960s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['college', 'Texas', 'Big 12', 'west texas'],
    pricePoint: 'mid',
  },

  'tcu': {
    keywords: ['TCU', 'horned frogs', 'texas christian', 'fort worth', 'purple', 'white', 'big 12', 'frogs', 'small school'],
    vibes: ['Texas', 'big 12', 'small school', 'underdog', 'purple', 'fort worth'],
    categories: ['jerseys', 'tees', 'hoodies', 'sweatshirts', 'vintage'],
    eras: ['1870s', '1960s', '1980s', '2000s', '2010s', '2020s'],
    subculture: ['college', 'Texas', 'Big 12', 'small school'],
    pricePoint: 'mid',
  },

  'baylor university': {
    keywords: ['baylor', 'bears', 'waco', 'green', 'gold', 'big 12', 'baptist', 'texas', 'sic em'],
    vibes: ['Texas', 'big 12', 'baptist', 'southern', 'underdog', 'passionate'],
    categories: ['jerseys', 'tees', 'hoodies', 'sweatshirts', 'vintage', 'champion'],
    eras: ['1840s', '1960s', '1980s', '2000s', '2010s', '2020s'],
    subculture: ['college', 'Texas', 'Big 12', 'baptist'],
    pricePoint: 'mid',
  },

  'west virginia university': {
    keywords: ['west virginia', 'mountaineers', 'WVU', 'morgantown', 'gold', 'blue', 'big 12', 'country roads', 'couch burning'],
    vibes: ['West Virginia', 'big 12', 'mountaineer', 'party', 'loyal', 'rowdy'],
    categories: ['jerseys', 'tees', 'hoodies', 'sweatshirts', 'vintage', 'champion'],
    eras: ['1860s', '1960s', '1970s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['college', 'West Virginia', 'Big 12', 'party'],
    pricePoint: 'mid',
  },

  // Pac-12 Schools
  'stanford university': {
    keywords: ['stanford', 'cardinal', 'palo alto', 'california', 'cardinal red', 'pac 12', 'academic', 'silicon valley', 'tree'],
    vibes: ['California', 'pac 12', 'academic', 'prestigious', 'silicon valley', 'elite'],
    categories: ['tees', 'hoodies', 'sweatshirts', 'vintage', 'champion', 'nike'],
    eras: ['1880s', '1920s', '1940s', '1960s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['college', 'California', 'Pac-12', 'academic'],
    pricePoint: 'mid',
  },

  'university of california berkeley': {
    keywords: ['cal', 'UC berkeley', 'golden bears', 'berkeley', 'california', 'blue', 'gold', 'pac 12', 'academic', 'liberal'],
    vibes: ['California', 'pac 12', 'academic', 'liberal', 'bay area', 'activist'],
    categories: ['tees', 'hoodies', 'sweatshirts', 'vintage', 'champion'],
    eras: ['1860s', '1920s', '1940s', '1960s', '1970s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['college', 'California', 'Pac-12', 'liberal'],
    pricePoint: 'mid',
  },

  'university of arizona': {
    keywords: ['arizona', 'wildcats', 'UA', 'tucson', 'red', 'blue', 'pac 12', 'basketball', 'bear down', 'desert'],
    vibes: ['Arizona', 'pac 12', 'basketball', 'desert', 'party', 'hot'],
    categories: ['jerseys', 'tees', 'hoodies', 'sweatshirts', 'vintage', 'champion'],
    eras: ['1880s', '1960s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['college', 'Arizona', 'Pac-12', 'basketball'],
    pricePoint: 'mid',
  },

  'arizona state': {
    keywords: ['arizona state', 'sun devils', 'ASU', 'tempe', 'maroon', 'gold', 'pac 12', 'party school', 'fork em'],
    vibes: ['Arizona', 'pac 12', 'party', 'hot', 'desert', 'fun'],
    categories: ['jerseys', 'tees', 'hoodies', 'sweatshirts', 'vintage'],
    eras: ['1880s', '1960s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['college', 'Arizona', 'Pac-12', 'party'],
    pricePoint: 'mid',
  },

  'university of utah': {
    keywords: ['utah', 'utes', 'salt lake city', 'red', 'white', 'pac 12', 'mountains', 'skiing'],
    vibes: ['Utah', 'pac 12', 'mountains', 'mormon', 'outdoor', 'underdog'],
    categories: ['jerseys', 'tees', 'hoodies', 'sweatshirts', 'vintage'],
    eras: ['1850s', '1960s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['college', 'Utah', 'Pac-12', 'outdoor'],
    pricePoint: 'mid',
  },

  'university of colorado': {
    keywords: ['colorado', 'buffaloes', 'CU', 'boulder', 'gold', 'black', 'pac 12', 'skiing', 'party', 'ralphie'],
    vibes: ['Colorado', 'pac 12', 'mountains', 'party', 'skiing', 'outdoor'],
    categories: ['jerseys', 'tees', 'hoodies', 'sweatshirts', 'vintage', 'champion'],
    eras: ['1870s', '1960s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['college', 'Colorado', 'Pac-12', 'outdoor'],
    pricePoint: 'mid',
  },

  'oregon state': {
    keywords: ['oregon state', 'beavers', 'OSU', 'corvallis', 'orange', 'black', 'pac 12', 'engineering', 'underdog'],
    vibes: ['Oregon', 'pac 12', 'underdog', 'PNW', 'engineering', 'beaver'],
    categories: ['jerseys', 'tees', 'hoodies', 'sweatshirts', 'vintage'],
    eras: ['1860s', '1960s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['college', 'Oregon', 'Pac-12', 'engineering'],
    pricePoint: 'budget',
  },

  'washington state': {
    keywords: ['washington state', 'cougars', 'WSU', 'pullman', 'crimson', 'gray', 'pac 12', 'rural', 'go cougs'],
    vibes: ['Washington', 'pac 12', 'rural', 'PNW', 'underdog', 'loyal'],
    categories: ['jerseys', 'tees', 'hoodies', 'sweatshirts', 'vintage'],
    eras: ['1890s', '1960s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['college', 'Washington', 'Pac-12', 'rural'],
    pricePoint: 'budget',
  },

  // Big Ten Schools
  'university of iowa': {
    keywords: ['iowa', 'hawkeyes', 'UI', 'iowa city', 'black', 'gold', 'big ten', 'kinnick stadium', 'wave', 'midwest'],
    vibes: ['Iowa', 'big ten', 'midwest', 'passionate', 'loyal', 'traditional'],
    categories: ['jerseys', 'tees', 'hoodies', 'sweatshirts', 'vintage', 'champion'],
    eras: ['1840s', '1920s', '1960s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['college', 'Iowa', 'Big Ten', 'midwest'],
    pricePoint: 'mid',
  },

  'northwestern university': {
    keywords: ['northwestern', 'wildcats', 'NU', 'evanston', 'purple', 'white', 'big ten', 'academic', 'chicago', 'private'],
    vibes: ['Illinois', 'big ten', 'academic', 'prestigious', 'private', 'underdog'],
    categories: ['tees', 'hoodies', 'sweatshirts', 'vintage', 'champion'],
    eras: ['1850s', '1920s', '1960s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['college', 'Illinois', 'Big Ten', 'academic'],
    pricePoint: 'mid',
  },

  'university of illinois': {
    keywords: ['illinois', 'fighting illini', 'UI', 'urbana champaign', 'orange', 'blue', 'big ten', 'chief', 'midwest'],
    vibes: ['Illinois', 'big ten', 'midwest', 'agricultural', 'traditional', 'passionate'],
    categories: ['jerseys', 'tees', 'hoodies', 'sweatshirts', 'vintage', 'champion'],
    eras: ['1860s', '1920s', '1960s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['college', 'Illinois', 'Big Ten', 'midwest'],
    pricePoint: 'mid',
  },

  'purdue university': {
    keywords: ['purdue', 'boilermakers', 'west lafayette', 'indiana', 'gold', 'black', 'big ten', 'engineering', 'boiler up'],
    vibes: ['Indiana', 'big ten', 'engineering', 'nerdy', 'midwest', 'traditional'],
    categories: ['jerseys', 'tees', 'hoodies', 'sweatshirts', 'vintage', 'champion'],
    eras: ['1860s', '1920s', '1960s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['college', 'Indiana', 'Big Ten', 'engineering'],
    pricePoint: 'mid',
  },

  'indiana university': {
    keywords: ['indiana', 'hoosiers', 'IU', 'bloomington', 'cream', 'crimson', 'big ten', 'basketball', 'bobby knight', 'candy stripes'],
    vibes: ['Indiana', 'big ten', 'basketball', 'traditional', 'passionate', 'candy stripes'],
    categories: ['jerseys', 'tees', 'hoodies', 'sweatshirts', 'vintage', 'champion', 'adidas'],
    eras: ['1820s', '1920s', '1940s', '1960s', '1970s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['college', 'Indiana', 'Big Ten', 'basketball'],
    pricePoint: 'mid',
  },

  'michigan state': {
    keywords: ['michigan state', 'spartans', 'MSU', 'east lansing', 'green', 'white', 'big ten', 'izzo', 'magic johnson', 'basketball'],
    vibes: ['Michigan', 'big ten', 'basketball', 'passionate', 'underdog', 'green'],
    categories: ['jerseys', 'tees', 'hoodies', 'sweatshirts', 'vintage', 'champion', 'nike'],
    eras: ['1850s', '1920s', '1960s', '1970s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['college', 'Michigan', 'Big Ten', 'basketball'],
    pricePoint: 'mid',
  },

  'university of minnesota': {
    keywords: ['minnesota', 'golden gophers', 'UMN', 'minneapolis', 'maroon', 'gold', 'big ten', 'ski u mah', 'midwest'],
    vibes: ['Minnesota', 'big ten', 'midwest', 'cold', 'hockey', 'underdog'],
    categories: ['jerseys', 'tees', 'hoodies', 'sweatshirts', 'vintage', 'champion'],
    eras: ['1850s', '1920s', '1960s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['college', 'Minnesota', 'Big Ten', 'hockey'],
    pricePoint: 'mid',
  },

  'rutgers university': {
    keywords: ['rutgers', 'scarlet knights', 'RU', 'new brunswick', 'scarlet', 'black', 'big ten', 'new jersey', 'first college'],
    vibes: ['New Jersey', 'big ten', 'historic', 'underdog', 'northeast', 'scrappy'],
    categories: ['jerseys', 'tees', 'hoodies', 'sweatshirts', 'vintage'],
    eras: ['1760s', '1920s', '1960s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['college', 'New Jersey', 'Big Ten', 'historic'],
    pricePoint: 'budget',
  },

  'university of maryland': {
    keywords: ['maryland', 'terrapins', 'terps', 'UMD', 'college park', 'red', 'black', 'gold', 'big ten', 'under armour', 'flag'],
    vibes: ['Maryland', 'big ten', 'under armour', 'basketball', 'DMV', 'flag pattern'],
    categories: ['jerseys', 'tees', 'hoodies', 'sweatshirts', 'vintage', 'under armour'],
    eras: ['1850s', '1920s', '1960s', '1980s', '2000s', '2010s', '2020s'],
    subculture: ['college', 'Maryland', 'Big Ten', 'DMV'],
    pricePoint: 'mid',
  },

  // More Regional Schools
  'georgetown university': {
    keywords: ['georgetown', 'hoyas', 'washington dc', 'gray', 'blue', 'big east', 'basketball', 'thompson', 'iverson', 'catholic'],
    vibes: ['DC', 'big east', 'basketball', 'prestigious', 'catholic', 'urban'],
    categories: ['jerseys', 'tees', 'hoodies', 'sweatshirts', 'vintage', 'champion', 'nike'],
    eras: ['1780s', '1940s', '1960s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['college', 'DC', 'Big East', 'basketball'],
    pricePoint: 'mid',
  },

  'villanova university': {
    keywords: ['villanova', 'wildcats', 'nova', 'philadelphia', 'blue', 'white', 'big east', 'basketball', 'catholic', 'main line'],
    vibes: ['Philadelphia', 'big east', 'basketball', 'catholic', 'champion', 'nova nation'],
    categories: ['jerseys', 'tees', 'hoodies', 'sweatshirts', 'vintage', 'champion', 'nike'],
    eras: ['1840s', '1960s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['college', 'Philadelphia', 'Big East', 'basketball'],
    pricePoint: 'mid',
  },

  'uconn': {
    keywords: ['connecticut', 'huskies', 'UConn', 'storrs', 'navy', 'white', 'big east', 'basketball', 'calhoun', 'geno auriemma'],
    vibes: ['Connecticut', 'big east', 'basketball', 'champion', 'dynasty', 'womens basketball'],
    categories: ['jerseys', 'tees', 'hoodies', 'sweatshirts', 'vintage', 'champion', 'nike'],
    eras: ['1880s', '1960s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['college', 'Connecticut', 'Big East', 'basketball'],
    pricePoint: 'mid',
  },

  'san diego state': {
    keywords: ['san diego state', 'aztecs', 'SDSU', 'san diego', 'scarlet', 'black', 'mountain west', 'socal', 'beach'],
    vibes: ['San Diego', 'mountain west', 'beach', 'party', 'socal', 'underdog'],
    categories: ['jerseys', 'tees', 'hoodies', 'sweatshirts', 'vintage'],
    eras: ['1890s', '1960s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['college', 'San Diego', 'Mountain West', 'beach'],
    pricePoint: 'budget',
  },

  'fresno state': {
    keywords: ['fresno state', 'bulldogs', 'fresno', 'california', 'red', 'blue', 'mountain west', 'central valley'],
    vibes: ['California', 'mountain west', 'agricultural', 'central valley', 'underdog', 'hot'],
    categories: ['jerseys', 'tees', 'hoodies', 'sweatshirts', 'vintage'],
    eras: ['1910s', '1960s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['college', 'California', 'Mountain West', 'agricultural'],
    pricePoint: 'budget',
  },

  'boise state': {
    keywords: ['boise state', 'broncos', 'idaho', 'blue', 'orange', 'mountain west', 'blue turf', 'underdog'],
    vibes: ['Idaho', 'mountain west', 'underdog', 'blue turf', 'giant killer', 'scrappy'],
    categories: ['jerseys', 'tees', 'hoodies', 'sweatshirts', 'vintage'],
    eras: ['1930s', '2000s', '2010s', '2020s'],
    subculture: ['college', 'Idaho', 'Mountain West', 'underdog'],
    pricePoint: 'budget',
  },

  'university of nevada': {
    keywords: ['nevada', 'wolf pack', 'reno', 'silver', 'blue', 'mountain west', 'skiing', 'tahoe'],
    vibes: ['Nevada', 'mountain west', 'skiing', 'tahoe', 'mountain', 'underdog'],
    categories: ['jerseys', 'tees', 'hoodies', 'sweatshirts', 'vintage'],
    eras: ['1870s', '1960s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['college', 'Nevada', 'Mountain West', 'skiing'],
    pricePoint: 'budget',
  },

  'unlv': {
    keywords: ['UNLV', 'rebels', 'runnin rebels', 'las vegas', 'scarlet', 'gray', 'mountain west', 'basketball', 'tark', 'hey reb'],
    vibes: ['Las Vegas', 'mountain west', 'basketball', 'party', 'desert', 'runnin rebels'],
    categories: ['jerseys', 'tees', 'hoodies', 'sweatshirts', 'vintage', 'champion'],
    eras: ['1950s', '1970s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['college', 'Las Vegas', 'Mountain West', 'basketball'],
    pricePoint: 'budget',
  },

  'memphis': {
    keywords: ['memphis', 'tigers', 'tennessee', 'blue', 'gray', 'american athletic', 'basketball', 'calipari', 'penny hardaway'],
    vibes: ['Tennessee', 'american athletic', 'basketball', 'urban', 'gritty', 'memphis'],
    categories: ['jerseys', 'tees', 'hoodies', 'sweatshirts', 'vintage'],
    eras: ['1910s', '1960s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['college', 'Tennessee', 'American Athletic', 'basketball'],
    pricePoint: 'budget',
  },

  'cincinnati': {
    keywords: ['cincinnati', 'bearcats', 'UC', 'ohio', 'red', 'black', 'big 12', 'basketball', 'huggins', 'cronin'],
    vibes: ['Ohio', 'big 12', 'basketball', 'urban', 'gritty', 'underdog'],
    categories: ['jerseys', 'tees', 'hoodies', 'sweatshirts', 'vintage', 'champion'],
    eras: ['1810s', '1960s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['college', 'Ohio', 'Big 12', 'basketball'],
    pricePoint: 'mid',
  },

  'university of houston': {
    keywords: ['houston', 'cougars', 'UH', 'texas', 'red', 'white', 'big 12', 'basketball', 'phi slama jama', 'hakeem'],
    vibes: ['Houston', 'big 12', 'basketball', 'urban', 'phi slama jama', 'champion'],
    categories: ['jerseys', 'tees', 'hoodies', 'sweatshirts', 'vintage', 'champion'],
    eras: ['1920s', '1960s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['college', 'Houston', 'Big 12', 'basketball'],
    pricePoint: 'mid',
  },

  'temple university': {
    keywords: ['temple', 'owls', 'philadelphia', 'cherry', 'white', 'american athletic', 'urban', 'gritty', 'chaney'],
    vibes: ['Philadelphia', 'american athletic', 'urban', 'gritty', 'underdog', 'basketball'],
    categories: ['jerseys', 'tees', 'hoodies', 'sweatshirts', 'vintage'],
    eras: ['1880s', '1960s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['college', 'Philadelphia', 'American Athletic', 'urban'],
    pricePoint: 'budget',
  },

  'byu': {
    keywords: ['BYU', 'brigham young', 'cougars', 'provo', 'utah', 'blue', 'white', 'big 12', 'mormon', 'lds'],
    vibes: ['Utah', 'big 12', 'mormon', 'religious', 'clean cut', 'underdog'],
    categories: ['jerseys', 'tees', 'hoodies', 'sweatshirts', 'vintage'],
    eras: ['1870s', '1960s', '1980s', '1990s', '2000s', '2010s', '2020s'],
    subculture: ['college', 'Utah', 'Big 12', 'mormon'],
    pricePoint: 'mid',
  },

};

export default BRAND_DNA_EXPANSION_2;
