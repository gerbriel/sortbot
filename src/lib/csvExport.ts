import type { ClothingItem } from '../App';
import { smartSeoTruncate, primaryMaterial, normalizeSizeValue } from './textAIService';

/**
 * csvExport — pure Shopify CSV generation, extracted verbatim from
 * GoogleSheetExporter.tsx (refactor Stage 3) so the export money-path is
 * unit-testable. NO behavior changes were made during the move; the golden
 * test in csvExport.test.ts locks the output format.
 *
 * The component keeps: data fetching (existingTitles), group coalescing,
 * title dedup, the price gate, the preview table, and the blob download.
 * This module owns: taxonomy/type/GID mappings and products → CSV text.
 */

/** A coalesced, title-deduped product group ready for export. */
export type ExportProduct = ClothingItem & { imageUrls: string[]; imageCount?: number };

/** Clean base size for CSV/titles/alt-text — strips any "(fits like …)" note,
 *  which belongs only in the description SIZE line. */
export const baseSize = (s?: string): string => (s ? normalizeSizeValue(s) : '');

/**
 * Strip any unresolved {placeholder} tokens from a string.
 * Used as a safety net so raw templates like "{brand} {model} Hat - Vintage"
 * never appear in the exported CSV.
 */
export function stripUnresolvedTokens(value: string | undefined): string {
  if (!value) return '';
  return value
    .replace(/\{[a-z_]+\}/gi, '')  // Remove {brand}, {model}, etc.
    .replace(/\s{2,}/g, ' ')        // Collapse multiple spaces
    .replace(/(^[\s\-–]+|[\s\-–]+$)/g, '') // Trim leading/trailing dashes & spaces
    .trim();
}

/**
 * Shopify metaobject GIDs — fetched once from the store via Admin API.
 * These are stable permanent IDs; they never change.
 */
const COLOR_GID_MAP: Record<string, string> = {
  'brown':       'gid://shopify/Metaobject/128362479801',
  'gold':        'gid://shopify/Metaobject/128362545337',
  'navy':        'gid://shopify/Metaobject/128362643641',
  'black':       'gid://shopify/Metaobject/155011809465',
  'blue':        'gid://shopify/Metaobject/155011842233',
  'white':       'gid://shopify/Metaobject/155011875001',
  'yellow':      'gid://shopify/Metaobject/155011907769',
  'beige':       'gid://shopify/Metaobject/161892204729',
  'cream':       'gid://shopify/Metaobject/161892204729', // map to Beige
  'tan':         'gid://shopify/Metaobject/161892204729', // map to Beige
  'green':       'gid://shopify/Metaobject/161892237497',
  'olive':       'gid://shopify/Metaobject/161892237497', // map to Green
  'orange':      'gid://shopify/Metaobject/166265684153',
  'red':         'gid://shopify/Metaobject/166265716921',
  'maroon':      'gid://shopify/Metaobject/166265716921', // map to Red
  'burgundy':    'gid://shopify/Metaobject/166265716921', // map to Red
  'gray':        'gid://shopify/Metaobject/166878085305',
  'grey':        'gid://shopify/Metaobject/166878085305',
  'silver':      'gid://shopify/Metaobject/166878085305', // map to Gray
  // Colors not yet in the store — add GIDs when Shopify adds them:
  // 'pink', 'purple', 'multicolor', 'plaid', 'striped', 'camouflage', 'tie-dye'
};

const FABRIC_GID_MAP: Record<string, string> = {
  'corduroy':    'gid://shopify/Metaobject/128362610873',
  'cashmere':    'gid://shopify/Metaobject/128362676409',
  'vinyl':       'gid://shopify/Metaobject/128362709177',
  'denim':       'gid://shopify/Metaobject/178561745081',
  'nylon':       'gid://shopify/Metaobject/178698911929',
  'polyester':   'gid://shopify/Metaobject/178700255417',
};

const GENDER_GID_MAP: Record<string, string> = {
  'male':    'gid://shopify/Metaobject/128362447033',
  'men':     'gid://shopify/Metaobject/128362447033',
  'mens':    'gid://shopify/Metaobject/128362447033',
  'other':   'gid://shopify/Metaobject/128362512569',
  'unisex':  'gid://shopify/Metaobject/128362512569',
  'female':  'gid://shopify/Metaobject/128362578105',
  'women':   'gid://shopify/Metaobject/128362578105',
  'womens':  'gid://shopify/Metaobject/128362578105',
};

export function resolveColorGid(color: string | undefined): string {
  if (!color) return '';
  return COLOR_GID_MAP[color.toLowerCase().trim()] || '';
}

export function resolveFabricGid(material: string | undefined): string {
  if (!material) return '';
  // Strip percentage composition (e.g. "50% Cotton 25% Nylon") → "Cotton" before GID lookup
  const clean = primaryMaterial(material).toLowerCase().trim();
  return FABRIC_GID_MAP[clean] || FABRIC_GID_MAP[material.toLowerCase().trim()] || '';
}

export function resolveGenderGid(gender: string | undefined): string {
  if (!gender) return '';
  return GENDER_GID_MAP[gender.toLowerCase().trim()] || '';
}

/**
 * Maps short internal category names → full Shopify taxonomy path strings.
 * Used for "Product category" and "Google Shopping / Google product category" columns.
 * Paths verified against Shopify Standard Product Taxonomy (github.com/Shopify/product-taxonomy).
 * When no mapping is found the column is left blank — Shopify accepts blank; it rejects free-form text.
 */
// ─── Shopify Taxonomy Notes ──────────────────────────────────────────────────
// Men's vs Women's: Shopify's taxonomy does NOT have gender-specific paths for
// clothing (no "Men's T-Shirts" category). Gender differentiation is handled
// entirely by the "Target gender" metafield. So mens-tees and womens-tees both
// correctly map to the same taxonomy path. The resolver strips the gender prefix
// ("mens"/"womens") and matches the category type segment.
//
// Kids: Shopify uses the Baby & Toddler root for children's clothing.
// Kids items must be explicitly routed — otherwise the resolver would strip
// "kids" and fall through to the adult path. We handle this by checking for the
// "kids" prefix FIRST in resolveCategoryPath, before the general segment lookup.
// ─────────────────────────────────────────────────────────────────────────────

// Adult / unisex taxonomy paths (also used for mens- and womens- prefixed categories)
export const SHOPIFY_CATEGORY_MAP: Record<string, string> = {
  // Tops
  tees:        'Apparel & Accessories > Clothing > Clothing Tops > T-Shirts',
  tee:         'Apparel & Accessories > Clothing > Clothing Tops > T-Shirts',
  't-shirt':   'Apparel & Accessories > Clothing > Clothing Tops > T-Shirts',
  't-shirts':  'Apparel & Accessories > Clothing > Clothing Tops > T-Shirts',
  tshirt:      'Apparel & Accessories > Clothing > Clothing Tops > T-Shirts',
  tshirts:     'Apparel & Accessories > Clothing > Clothing Tops > T-Shirts',
  tops:        'Apparel & Accessories > Clothing > Clothing Tops',
  top:         'Apparel & Accessories > Clothing > Clothing Tops',
  shirts:      'Apparel & Accessories > Clothing > Clothing Tops > Shirts',
  shirt:       'Apparel & Accessories > Clothing > Clothing Tops > Shirts',
  polo:        'Apparel & Accessories > Clothing > Clothing Tops > Polos',
  polos:       'Apparel & Accessories > Clothing > Clothing Tops > Polos',
  sweater:     'Apparel & Accessories > Clothing > Clothing Tops > Sweaters',
  sweaters:    'Apparel & Accessories > Clothing > Clothing Tops > Sweaters',
  cardigan:    'Apparel & Accessories > Clothing > Clothing Tops > Cardigans',
  cardigans:   'Apparel & Accessories > Clothing > Clothing Tops > Cardigans',
  // Sweatshirts & hoodies
  sweatshirts: 'Apparel & Accessories > Clothing > Clothing Tops > Sweatshirts',
  sweatshirt:  'Apparel & Accessories > Clothing > Clothing Tops > Sweatshirts',
  hoodies:     'Apparel & Accessories > Clothing > Clothing Tops > Hoodies',
  hoodie:      'Apparel & Accessories > Clothing > Clothing Tops > Hoodies',
  // Outerwear
  outerwear:   'Apparel & Accessories > Clothing > Outerwear > Coats & Jackets',
  jacket:      'Apparel & Accessories > Clothing > Outerwear > Coats & Jackets',
  jackets:     'Apparel & Accessories > Clothing > Outerwear > Coats & Jackets',
  coat:        'Apparel & Accessories > Clothing > Outerwear > Coats & Jackets',
  coats:       'Apparel & Accessories > Clothing > Outerwear > Coats & Jackets',
  // Bottoms / pants
  bottoms:     'Apparel & Accessories > Clothing > Pants',
  pants:       'Apparel & Accessories > Clothing > Pants',
  pant:        'Apparel & Accessories > Clothing > Pants',
  trousers:    'Apparel & Accessories > Clothing > Pants > Trousers',
  chinos:      'Apparel & Accessories > Clothing > Pants > Chinos',
  joggers:     'Apparel & Accessories > Clothing > Pants > Joggers',
  sweatpants:  'Apparel & Accessories > Clothing > Pants',
  sweats:      'Apparel & Accessories > Clothing > Pants',
  leggings:    'Apparel & Accessories > Clothing > Pants > Leggings',
  jeans:       'Apparel & Accessories > Clothing > Pants > Jeans',
  jean:        'Apparel & Accessories > Clothing > Pants > Jeans',
  denim:       'Apparel & Accessories > Clothing > Pants > Jeans',
  shorts:      'Apparel & Accessories > Clothing > Shorts',
  short:       'Apparel & Accessories > Clothing > Shorts',
  // Jerseys (no specific Jerseys subcategory in Shopify taxonomy — use parent Clothing Tops)
  jerseys:     'Apparel & Accessories > Clothing > Clothing Tops',
  jersey:      'Apparel & Accessories > Clothing > Clothing Tops',
  // Bodysuits
  bodysuits:   'Apparel & Accessories > Clothing > Clothing Tops > Bodysuits',
  bodysuit:    'Apparel & Accessories > Clothing > Clothing Tops > Bodysuits',
  // Dresses & skirts
  dresses:     'Apparel & Accessories > Clothing > Dresses',
  dress:       'Apparel & Accessories > Clothing > Dresses',
  skirts:      'Apparel & Accessories > Clothing > Skirts',
  skirt:       'Apparel & Accessories > Clothing > Skirts',
  // Femme / feminine (broad catch-all)
  femme:       'Apparel & Accessories > Clothing > Dresses',
  feminine:    'Apparel & Accessories > Clothing > Dresses',
  // Hats
  hats:        'Apparel & Accessories > Clothing Accessories > Hats',
  hat:         'Apparel & Accessories > Clothing Accessories > Hats',
  cap:         'Apparel & Accessories > Clothing Accessories > Hats > Baseball Caps',
  caps:        'Apparel & Accessories > Clothing Accessories > Hats > Baseball Caps',
  beanie:      'Apparel & Accessories > Clothing Accessories > Hats > Beanies',
  beanies:     'Apparel & Accessories > Clothing Accessories > Hats > Beanies',
  // Shoes
  shoes:       'Apparel & Accessories > Shoes',
  shoe:        'Apparel & Accessories > Shoes',
  sneakers:    'Apparel & Accessories > Shoes > Sneakers',
  sneaker:     'Apparel & Accessories > Shoes > Sneakers',
  boots:       'Apparel & Accessories > Shoes > Boots',
  boot:        'Apparel & Accessories > Shoes > Boots',
  // Accessories
  accessories: 'Apparel & Accessories > Clothing Accessories',
  accessory:   'Apparel & Accessories > Clothing Accessories',
  // Mystery boxes / bundles → no valid Shopify taxonomy; leave blank
  'mystery boxes': '',
  'mystery box':   '',
  bundle:          '',
  bundles:         '',
};

// Kids-specific taxonomy paths
// Shopify taxonomy: kids clothing lives under Apparel & Accessories > Clothing > Baby & Children's Clothing
// (NOT under Baby & Toddler — that root is for strollers, car seats, etc.)
// Keyed by the TYPE segment only (e.g. "tees", "hoodies") — looked up after
// confirming the full category key starts with "kids"
export const SHOPIFY_KIDS_CATEGORY_MAP: Record<string, string> = {
  // Tops
  tees:        "Apparel & Accessories > Clothing > Baby & Children's Clothing > Baby & Children's Tops > T-Shirts",
  tee:         "Apparel & Accessories > Clothing > Baby & Children's Clothing > Baby & Children's Tops > T-Shirts",
  't-shirt':   "Apparel & Accessories > Clothing > Baby & Children's Clothing > Baby & Children's Tops > T-Shirts",
  tshirt:      "Apparel & Accessories > Clothing > Baby & Children's Clothing > Baby & Children's Tops > T-Shirts",
  shirts:      "Apparel & Accessories > Clothing > Baby & Children's Clothing > Baby & Children's Tops > Shirts",
  shirt:       "Apparel & Accessories > Clothing > Baby & Children's Clothing > Baby & Children's Tops > Shirts",
  tops:        "Apparel & Accessories > Clothing > Baby & Children's Clothing > Baby & Children's Tops",
  top:         "Apparel & Accessories > Clothing > Baby & Children's Clothing > Baby & Children's Tops",
  sweatshirts: "Apparel & Accessories > Clothing > Baby & Children's Clothing > Baby & Children's Tops > Sweatshirts",
  sweatshirt:  "Apparel & Accessories > Clothing > Baby & Children's Clothing > Baby & Children's Tops > Sweatshirts",
  hoodies:     "Apparel & Accessories > Clothing > Baby & Children's Clothing > Baby & Children's Tops > Hoodies",
  hoodie:      "Apparel & Accessories > Clothing > Baby & Children's Clothing > Baby & Children's Tops > Hoodies",
  // Outerwear
  jackets:     "Apparel & Accessories > Clothing > Baby & Children's Clothing > Baby & Children's Outerwear > Baby & Children's Coats & Jackets",
  jacket:      "Apparel & Accessories > Clothing > Baby & Children's Clothing > Baby & Children's Outerwear > Baby & Children's Coats & Jackets",
  coats:       "Apparel & Accessories > Clothing > Baby & Children's Clothing > Baby & Children's Outerwear > Baby & Children's Coats & Jackets",
  coat:        "Apparel & Accessories > Clothing > Baby & Children's Clothing > Baby & Children's Outerwear > Baby & Children's Coats & Jackets",
  outerwear:   "Apparel & Accessories > Clothing > Baby & Children's Clothing > Baby & Children's Outerwear",
  // Bottoms
  pants:       "Apparel & Accessories > Clothing > Baby & Children's Clothing > Baby & Children's Bottoms",
  pant:        "Apparel & Accessories > Clothing > Baby & Children's Clothing > Baby & Children's Bottoms",
  bottoms:     "Apparel & Accessories > Clothing > Baby & Children's Clothing > Baby & Children's Bottoms",
  jeans:       "Apparel & Accessories > Clothing > Baby & Children's Clothing > Baby & Children's Bottoms > Jeans",
  jean:        "Apparel & Accessories > Clothing > Baby & Children's Clothing > Baby & Children's Bottoms > Jeans",
  leggings:    "Apparel & Accessories > Clothing > Baby & Children's Clothing > Baby & Children's Bottoms > Leggings",
  joggers:     "Apparel & Accessories > Clothing > Baby & Children's Clothing > Baby & Children's Bottoms > Joggers",
  shorts:      "Apparel & Accessories > Clothing > Baby & Children's Clothing > Baby & Children's Bottoms",
  short:       "Apparel & Accessories > Clothing > Baby & Children's Clothing > Baby & Children's Bottoms",
  // Dresses
  dresses:     "Apparel & Accessories > Clothing > Baby & Children's Clothing > Baby & Children's Dresses",
  dress:       "Apparel & Accessories > Clothing > Baby & Children's Clothing > Baby & Children's Dresses",
  // Hats / accessories
  hats:        "Apparel & Accessories > Clothing Accessories > Baby & Children's Clothing Accessories > Baby & Children's Hats",
  hat:         "Apparel & Accessories > Clothing Accessories > Baby & Children's Clothing Accessories > Baby & Children's Hats",
  cap:         "Apparel & Accessories > Clothing Accessories > Baby & Children's Clothing Accessories > Baby & Children's Hats",
  caps:        "Apparel & Accessories > Clothing Accessories > Baby & Children's Clothing Accessories > Baby & Children's Hats",
  accessories: "Apparel & Accessories > Clothing Accessories > Baby & Children's Clothing Accessories",
  accessory:   "Apparel & Accessories > Clothing Accessories > Baby & Children's Clothing Accessories",
  // Shoes (same as adult — taxonomy doesn't split kids shoes differently at top level)
  shoes:       'Apparel & Accessories > Shoes > Baby & Children\'s Shoes',
  shoe:        'Apparel & Accessories > Shoes > Baby & Children\'s Shoes',
  sneakers:    'Apparel & Accessories > Shoes > Baby & Children\'s Shoes > Baby & Children\'s Sneakers',
  sneaker:     'Apparel & Accessories > Shoes > Baby & Children\'s Shoes > Baby & Children\'s Sneakers',
  boots:       'Apparel & Accessories > Shoes > Baby & Children\'s Shoes > Baby & Children\'s Boots',
  boot:        'Apparel & Accessories > Shoes > Baby & Children\'s Shoes > Baby & Children\'s Boots',
};

// Maps the stored category key (or its type segment) to your store's custom Product Type.
// These values must match what's already in Shopify (case-sensitive) or they'll create
// a new type on import. Existing store types: Clothing, Hats, Hats & Caps,
// Outerwear & Coats, Pants, Sweatshirts.
// New types (Dresses, Shoes, Accessories, etc.) will be created in Shopify on first import.
export const SHOPIFY_TYPE_MAP: Record<string, string> = {
  // Tops → Clothing
  tee: 'Clothing', tees: 'Clothing',
  't-shirt': 'Clothing', tshirt: 'Clothing',
  shirt: 'Clothing', shirts: 'Clothing',
  top: 'Clothing', tops: 'Clothing',
  polo: 'Clothing', polos: 'Clothing',
  jersey: 'Clothing', jerseys: 'Clothing',
  bodysuit: 'Clothing', bodysuits: 'Clothing',
  sweater: 'Clothing', sweaters: 'Clothing',
  cardigan: 'Clothing', cardigans: 'Clothing',
  // Sweatshirts & hoodies
  sweatshirt: 'Sweatshirts', sweatshirts: 'Sweatshirts',
  hoodie: 'Sweatshirts', hoodies: 'Sweatshirts',
  // Outerwear
  jacket: 'Outerwear & Coats', jackets: 'Outerwear & Coats',
  coat: 'Outerwear & Coats', coats: 'Outerwear & Coats',
  outerwear: 'Outerwear & Coats',
  // Bottoms
  pant: 'Pants', pants: 'Pants',
  bottom: 'Pants', bottoms: 'Pants',
  jean: 'Pants', jeans: 'Pants', denim: 'Pants',
  short: 'Pants', shorts: 'Pants',
  legging: 'Pants', leggings: 'Pants',
  jogger: 'Pants', joggers: 'Pants',
  sweatpant: 'Pants', sweatpants: 'Pants',
  trouser: 'Pants', trousers: 'Pants',
  chino: 'Pants', chinos: 'Pants',
  // Hats
  hat: 'Hats', hats: 'Hats',
  beanie: 'Hats', beanies: 'Hats',
  cap: 'Hats & Caps', caps: 'Hats & Caps',
  // Dresses & skirts (new type — will be created on import)
  dress: 'Dresses', dresses: 'Dresses',
  skirt: 'Dresses', skirts: 'Dresses',
  femme: 'Dresses', feminine: 'Dresses',
  // Shoes (new type — will be created on import)
  shoe: 'Shoes', shoes: 'Shoes',
  sneaker: 'Shoes', sneakers: 'Shoes',
  boot: 'Shoes', boots: 'Shoes',
  // Accessories (new type — will be created on import)
  accessory: 'Accessories', accessories: 'Accessories',
};

/**
 * Resolve the Shopify taxonomy path from the category.
 * Categories are often compound like "mens-tees", "womens-shirts", "kids-hoodies".
 * Strategy:
 *  1. If the key starts with "kids", look up the type segment in the Kids map.
 *     (Shopify uses Baby & Toddler root for children's clothing.)
 *  2. Otherwise try the full key in the adult map, then each segment last→first.
 *     "mens"/"womens" prefixes are intentionally ignored — Shopify taxonomy has no
 *     gender-specific clothing paths; gender lives in the Target Gender metafield.
 */
export const resolveCategoryPath = (key: string): string => {
  if (!key) return '';
  const isKids = /^kids[\s-]/.test(key);
  if (isKids) {
    // Extract the type segment (everything after "kids-" / "kids ")
    const typeSegment = key.replace(/^kids[\s-]+/, '').split(/[-\s]+/).pop() ?? '';
    return SHOPIFY_KIDS_CATEGORY_MAP[typeSegment] ?? "Apparel & Accessories > Clothing > Baby & Children's Clothing";
  }
  if (key in SHOPIFY_CATEGORY_MAP) return SHOPIFY_CATEGORY_MAP[key];
  // Split on hyphens and spaces, try segments from last to first
  // (strips gender prefixes like "mens", "womens" automatically)
  const segments = key.split(/[-\s]+/).filter(Boolean);
  for (let i = segments.length - 1; i >= 0; i--) {
    const seg = segments[i];
    if (seg in SHOPIFY_CATEGORY_MAP) return SHOPIFY_CATEGORY_MAP[seg];
  }
  return '';
};

/**
 * Resolve the store Product Type from the category key.
 * Uses the same segment-stripping strategy as the category resolver so
 * "mens-sweatshirts" → type segment "sweatshirts" → "Sweatshirts".
 */
export const resolveProductType = (key: string): string => {
  if (!key) return '';
  // For kids, strip prefix then look up type segment
  const cleanKey = key.replace(/^(kids|mens|womens)[\s-]+/, '');
  const segments = cleanKey.split(/[-\s]+/).filter(Boolean);
  // Try full clean key first, then last segment
  if (cleanKey in SHOPIFY_TYPE_MAP) return SHOPIFY_TYPE_MAP[cleanKey];
  for (let i = segments.length - 1; i >= 0; i--) {
    if (segments[i] in SHOPIFY_TYPE_MAP) return SHOPIFY_TYPE_MAP[segments[i]];
  }
  return '';
};

/** Build a clean, display-ready title for a product — shared by preview table and CSV export. */
export const buildCleanTitle = (p: { seoTitle?: string }, idx: number): string => {
  const rawTitle = p.seoTitle || '';
  const strippedTitle = /\{[a-z_]+\}/i.test(rawTitle)
    ? stripUnresolvedTokens(rawTitle) || `product-${idx + 1}`
    : rawTitle || `product-${idx + 1}`;
  // Use the title exactly as the user typed it — do NOT prepend brand.
  // Brand is already its own "Vendor / Brand" column in the CSV.
  return strippedTitle;
};

/** Column order matches Shopify's own product export format exactly. */
export const SHOPIFY_CSV_HEADERS = [
  'Handle',
  'Title',
  'Body (HTML)',
  'Vendor',
  'Product Category',
  'Type',
  'Tags',
  'Published',
  'Option1 Name',
  'Option1 Value',
  'Option1 Linked To',
  'Option2 Name',
  'Option2 Value',
  'Option2 Linked To',
  'Option3 Name',
  'Option3 Value',
  'Option3 Linked To',
  'Variant SKU',
  'Variant Grams',
  'Variant Inventory Tracker',
  'Variant Inventory Qty',
  'Variant Inventory Policy',
  'Variant Fulfillment Service',
  'Variant Price',
  'Variant Compare At Price',
  'Variant Requires Shipping',
  'Variant Taxable',
  'Unit Price Total Measure',
  'Unit Price Total Measure Unit',
  'Unit Price Base Measure',
  'Unit Price Base Measure Unit',
  'Variant Barcode',
  'Image Src',
  'Image Position',
  'Image Alt Text',
  'Gift Card',
  'SEO Title',
  'SEO Description',
  'Color (product.metafields.shopify.color-pattern)',
  'Fabric (product.metafields.shopify.fabric)',
  'Target gender (product.metafields.shopify.target-gender)',
  'Complementary products (product.metafields.shopify--discovery--product_recommendation.complementary_products)',
  'Related products (product.metafields.shopify--discovery--product_recommendation.related_products)',
  'Related products settings (product.metafields.shopify--discovery--product_recommendation.related_products_display)',
  'Search product boosts (product.metafields.shopify--discovery--product_search_boost.queries)',
  'Variant Image',
  'Variant Weight Unit',
  'Variant Tax Code',
  'Cost per item',
  'Status',
  'Size (product.metafields.custom.size)',
  'Condition (product.metafields.custom.condition)',
  'Parcel Size (product.metafields.custom.parcel_size)',
  'Package Dimensions (product.metafields.custom.package_dimensions)',
];

/** Escape CSV values properly. */
export const escapeCsvValue = (value: unknown): string => {
  const str = String(value || '');
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
};

/**
 * Build the Shopify import rows for a list of coalesced, title-deduped
 * products. The caller is responsible for the price gate (no $0 products)
 * and for title dedup — this function is pure formatting.
 */
export function buildShopifyCsvRows(products: ExportProduct[]): string[][] {
  const headers = SHOPIFY_CSV_HEADERS;
  const rows: string[][] = [];
  const usedHandles = new Set<string>();

  products.forEach((product, idx) => {
    const vendor = product.brand || '';
    const catKey = product.category?.toLowerCase() ?? '';

    // Only use taxonomy paths from the map — never pass raw category names to Shopify (they'll fail validation)
    const productCategory = resolveCategoryPath(catKey);
    const productType = resolveProductType(catKey);

    // Tags: extract #hashtags from generated description first, fall back to product.tags array
    const hashtagsFromDesc = (product.generatedDescription || '')
      .match(/#(\w+)/g)?.map((t: string) => t.slice(1)) || [];
    const tags = hashtagsFromDesc.length > 0
      ? hashtagsFromDesc.join(', ')
      : (product.tags?.join(', ') || '');
    const primaryColor = product.color || '';
    // weightValue is stored in grams — use directly, no conversion needed.
    const rawWeight = parseFloat(product.weightValue || '');
    const variantGrams = isNaN(rawWeight) ? '' : String(rawWeight);

    const cleanTitle = buildCleanTitle(product, idx);

    // Build image alt text: "Title - Color - Size"
    const altParts = [cleanTitle];
    if (primaryColor && !cleanTitle.toLowerCase().includes(primaryColor.toLowerCase())) altParts.push(primaryColor);
    if (product.size) altParts.push(baseSize(product.size));
    const imageAltText = altParts.filter(Boolean).join(' - ');

    // Build a URL handle unique within this export
    const baseHandle = cleanTitle
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '')
      .replace(/-{2,}/g, '-')
      .replace(/^-+|-+$/g, '')
      || `product-${idx + 1}`;
    let handle = baseHandle;
    let handleSuffix = 2;
    while (usedHandles.has(handle)) {
      handle = `${baseHandle}-${handleSuffix++}`;
    }
    usedHandles.add(handle);

    rows.push([
      handle,                                                          // Handle
      cleanTitle,                                                      // Title
      (product.generatedDescription || '').replace(/\n\n/g, '<br><br>').replace(/\n/g, '<br>'), // Body (HTML)
      vendor,                                                          // Vendor
      productCategory,                                                 // Product Category
      productType,                                                     // Type
      tags,                                                            // Tags
      product.published === false ? 'false' : 'true',                 // Published
      'Title',                                                         // Option1 Name
      'Default Title',                                                 // Option1 Value
      '',                                                              // Option1 Linked To
      '',                                                              // Option2 Name
      '',                                                              // Option2 Value
      '',                                                              // Option2 Linked To
      '',                                                              // Option3 Name
      '',                                                              // Option3 Value
      '',                                                              // Option3 Linked To
      product.sku || '',                                               // Variant SKU
      variantGrams,                                                    // Variant Grams
      'shopify',                                                       // Variant Inventory Tracker
      String(product.inventoryQuantity ?? 1),                         // Variant Inventory Qty
      product.continueSellingOutOfStock ? 'continue' : 'deny',        // Variant Inventory Policy
      'manual',                                                        // Variant Fulfillment Service
      product.price != null ? parseFloat(String(product.price)).toFixed(2) : '', // Variant Price
      (() => { // Variant Compare At Price — only output if strictly greater than sale price
        const sale = parseFloat(String(product.price ?? 0));
        const compare = parseFloat(String(product.compareAtPrice ?? 0));
        return (compare > sale && compare > 0) ? compare.toFixed(2) : '';
      })(),
      product.requiresShipping === false ? 'false' : 'true',          // Variant Requires Shipping
      'true',                                                          // Variant Taxable
      '',                                                              // Unit Price Total Measure
      '',                                                              // Unit Price Total Measure Unit
      '',                                                              // Unit Price Base Measure
      '',                                                              // Unit Price Base Measure Unit
      product.barcode || '',                                           // Variant Barcode
      product.imageUrls?.[0] || '',                                    // Image Src
      '1',                                                             // Image Position
      imageAltText || cleanTitle,                                      // Image Alt Text
      'false',                                                         // Gift Card
      cleanTitle,                                                      // SEO Title
      product.seoDescription || (product.generatedDescription ? smartSeoTruncate(product.generatedDescription) : ''), // SEO Description
      resolveColorGid(primaryColor),                                   // Color (product.metafields.shopify.color-pattern)
      resolveFabricGid(product.material),                              // Fabric (product.metafields.shopify.fabric)
      resolveGenderGid(product.gender),                                // Target gender (product.metafields.shopify.target-gender)
      '',                                                              // Complementary products
      '',                                                              // Related products
      '',                                                              // Related products settings
      '',                                                              // Search product boosts
      '',                                                              // Variant Image
      'g',                                                             // Variant Weight Unit
      product.taxCode || '',                                           // Variant Tax Code
      String(product.costPerItem || '0.00'),                          // Cost per item
      (product.status || 'active').toLowerCase(),                       // Status
      baseSize(product.size) || '',                                    // Size (product.metafields.custom.size)
      product.condition || '',                                         // Condition (product.metafields.custom.condition)
      product.parcelSize || '',                                        // Parcel Size (product.metafields.custom.parcel_size)
      product.packageDimensions || '',                                 // Package Dimensions (product.metafields.custom.package_dimensions)
    ]);

    // Additional image rows — only Handle, Image Src, Image Position, Image Alt Text, Status
    const productStatus = (product.status || 'active').toLowerCase();
    const imageCount = product.imageUrls?.length || 0;
    for (let i = 1; i < imageCount; i++) {
      const imageRow = Array(headers.length).fill('') as string[];
      imageRow[headers.indexOf('Handle')]         = handle;
      imageRow[headers.indexOf('Status')]         = productStatus;
      imageRow[headers.indexOf('Image Src')]      = product.imageUrls[i] || '';
      imageRow[headers.indexOf('Image Position')] = String(i + 1);
      imageRow[headers.indexOf('Image Alt Text')] = imageAltText || cleanTitle;
      rows.push(imageRow);
    }
  });

  return rows;
}

/** Full CSV text: escaped header line + escaped data rows. */
export function buildShopifyCsv(products: ExportProduct[]): string {
  return [
    SHOPIFY_CSV_HEADERS.map(escapeCsvValue).join(','),
    ...buildShopifyCsvRows(products).map(row => row.map(escapeCsvValue).join(',')),
  ].join('\n');
}
