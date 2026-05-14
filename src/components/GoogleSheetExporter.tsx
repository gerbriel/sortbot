import { forwardRef, useImperativeHandle } from 'react';
import type { ClothingItem } from '../App';
import { supabase } from '../lib/supabase';
import './GoogleSheetExporter.css';

/**
 * Returns a full https:// Supabase public URL for an item, or '' if unavailable.
 * Rejects blob: URLs because Shopify can't fetch those.
 */
function resolvePublicUrl(item: ClothingItem): string {
  // imageUrls[0] is the authoritative full-res URL — use it if it's a real https URL
  const candidate = item.imageUrls?.[0] || '';
  if (candidate.startsWith('https://')) return candidate;

  // Fall back to reconstructing from storagePath
  if (item.storagePath) {
    return supabase.storage.from('product-images').getPublicUrl(item.storagePath).data.publicUrl;
  }

  // preview may be a blob URL (in-session before page reload) — reject it
  const preview = item.preview || '';
  if (preview.startsWith('https://')) return preview;

  return '';
}

/**
 * Strip any unresolved {placeholder} tokens from a string.
 * Used as a safety net so raw templates like "{brand} {model} Hat - Vintage"
 * never appear in the exported CSV.
 */
function stripUnresolvedTokens(value: string | undefined): string {
  if (!value) return '';
  return value
    .replace(/\{[a-z_]+\}/gi, '')  // Remove {brand}, {model}, etc.
    .replace(/\s{2,}/g, ' ')        // Collapse multiple spaces
    .replace(/(^[\s\-–]+|[\s\-–]+$)/g, '') // Trim leading/trailing dashes & spaces
    .trim();
}

/**
 * Maps short internal category names → full Shopify taxonomy path strings.
 * Used for "Product category" and "Google Shopping / Google product category" columns.
 * Paths verified against Shopify Standard Product Taxonomy (github.com/Shopify/product-taxonomy).
 * When no mapping is found the column is left blank — Shopify accepts blank; it rejects free-form text.
 */
const SHOPIFY_CATEGORY_MAP: Record<string, string> = {
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
  // Jerseys
  jerseys:     'Apparel & Accessories > Clothing > Clothing Tops > Jerseys',
  jersey:      'Apparel & Accessories > Clothing > Clothing Tops > Jerseys',
  // Bodysuits
  bodysuits:   'Apparel & Accessories > Clothing > Bodysuits',
  bodysuit:    'Apparel & Accessories > Clothing > Bodysuits',
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
  sneakers:    'Apparel & Accessories > Shoes > Athletic Shoes',
  sneaker:     'Apparel & Accessories > Shoes > Athletic Shoes',
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

interface GoogleSheetExporterProps {
  items: ClothingItem[];
  compactMode?: boolean;
}

export interface GoogleSheetExporterHandle {
  downloadCSV: () => void;
}

const GoogleSheetExporter = forwardRef<GoogleSheetExporterHandle, GoogleSheetExporterProps>(
  ({ items, compactMode = false }, ref) => {

  // Group items by productGroup - each group is ONE product
  const productGroups = items.reduce((groups, item) => {
    const groupId = item.productGroup || item.id; // If no group, item becomes its own product
    if (!groups[groupId]) {
      groups[groupId] = [];
    }
    groups[groupId].push(item);
    return groups;
  }, {} as Record<string, ClothingItem[]>);

  // Build products, then deduplicate titles/handles in a second pass
  const rawProducts = Object.values(productGroups).map(group => {
    // Use the first item in the group as the base product data
    const productData = group[0];

    // Find the best seoTitle from any item in the group:
    // prefer a real title (no unresolved {tokens}) over a raw template
    const resolvedTitle = group
      .map(item => item.seoTitle || '')
      .find(t => t.trim() && !/\{[a-z_]+\}/i.test(t));

    // If no real title exists, build one from filled fields
    const autoTitle = (() => {
      const src = group.find(i => i.brand || i.color || i.category || i.modelName) || productData;
      const parts: string[] = [];
      if (src.brand) parts.push(src.brand);
      if (src.modelName) parts.push(src.modelName);
      if (src.color) parts.push(src.color);
      if (src.category) parts.push(src.category);
      if (src.size) parts.push(`(${src.size})`);
      const built = parts.filter(Boolean).join(' ');
      // If we have nothing distinctive, fall back to the filename (minus extension)
      // so every product gets a unique title/handle even without AI-generated data.
      if (!built) {
        const nameSource = group.find(i => i.originalName) || productData;
        const filename = (nameSource.originalName || '').replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
        return filename || '';
      }
      return built;
    })();

    // Strip any remaining {tokens} from whichever title we use
    const bestTitle = stripUnresolvedTokens(resolvedTitle || autoTitle || productData.seoTitle || '');

    return {
      ...productData,
      seoTitle: bestTitle,
      // Resolve full https:// Supabase URLs for each item in the group.
      // Rejects blob: URLs (in-session previews) — Shopify can't fetch those.
      // Falls back to storagePath reconstruction if imageUrls is missing/blob.
      imageUrls: group.map(item => resolvePublicUrl(item)).filter(Boolean),
      imageCount: group.length
    };
  });

  // Second pass: make every title and URL handle unique.
  // If two products share the same title, append " 2", " 3", etc.
  const titleCounts: Record<string, number> = {};
  const titleSeen: Record<string, number> = {};
  rawProducts.forEach(p => {
    const key = (p.seoTitle || '').toLowerCase();
    titleCounts[key] = (titleCounts[key] || 0) + 1;
  });

  const products = rawProducts.map((p, idx) => {
    const baseTitle = p.seoTitle || `product-${idx + 1}`;
    const key = baseTitle.toLowerCase();
    let uniqueTitle = baseTitle;

    if (titleCounts[key] > 1) {
      titleSeen[key] = (titleSeen[key] || 0) + 1;
      if (titleSeen[key] > 1) {
        uniqueTitle = `${baseTitle} ${titleSeen[key]}`;
      }
    }

    return { ...p, seoTitle: uniqueTitle };
  });

  // Build a clean, display-ready title for a product — shared by preview table and CSV export
  const buildCleanTitle = (p: typeof rawProducts[0], idx: number): string => {
    const rawTitle = p.seoTitle || '';
    const strippedTitle = /\{[a-z_]+\}/i.test(rawTitle)
      ? stripUnresolvedTokens(rawTitle) || `product-${idx + 1}`
      : rawTitle || `product-${idx + 1}`;
    // Use the title exactly as the user typed it — do NOT prepend brand.
    // Brand is already its own "Vendor / Brand" column in the CSV.
    return strippedTitle;
  };

  const handleDownloadCSV = () => {
    const headers = [
      'Handle',                   // Shopify: unique URL slug
      'Title',
      'Body (HTML)',               // Shopify: product description
      'Vendor',                   // Shopify: brand/vendor
      'Product Category',         // Shopify: full taxonomy path
      'Type',                     // Shopify: product type (short)
      'Tags',
      'Published',
      'Option1 Name',             // Shopify: variant option name (e.g. "Size")
      'Option1 Value',            // Shopify: variant option value (e.g. "L")
      'Variant SKU',
      'Variant Grams',            // Shopify: weight in grams
      'Variant Inventory Tracker',
      'Variant Inventory Qty',
      'Variant Inventory Policy', // Shopify: 'deny' or 'continue'
      'Variant Fulfillment Service',
      'Variant Price',
      'Variant Compare At Price',
      'Variant Requires Shipping',
      'Variant Taxable',
      'Variant Barcode',
      'Image Src',                // Shopify: product image URL
      'Image Position',
      'Image Alt Text',
      'Variant Image',
      'Gift Card',
      'SEO Title',
      'SEO Description',
      'Standard Product Type',    // Shopify: standardised taxonomy path
      'Cost per item',
      'Status',
      // Google Shopping columns (exact Shopify names)
      'Google Shopping / Google Product Category',
      'Google Shopping / Gender',
      'Google Shopping / Age Group',
      'Google Shopping / MPN',
      'Google Shopping / AdWords Grouping',
      'Google Shopping / AdWords Labels',
      'Google Shopping / Condition',
      'Google Shopping / Custom Product',
      'Google Shopping / Custom Label 0',
    ];

    const rows: string[][] = [];
    const usedHandles = new Set<string>();
    
    products.forEach((product, idx) => {
      const vendor = product.brand || '';
      const catKey = product.category?.toLowerCase() ?? '';

      // Resolve the Shopify taxonomy path from the category.
      // Categories are often compound like "mens-tees", "womens-shirts", "kids-hoodies".
      // Strategy: try the full key first, then each hyphen/space segment from last → first.
      const resolveCategoryPath = (key: string): string => {
        if (!key) return '';
        if (key in SHOPIFY_CATEGORY_MAP) return SHOPIFY_CATEGORY_MAP[key];
        // Split on hyphens and spaces, try segments from last to first
        const segments = key.split(/[-\s]+/).filter(Boolean);
        for (let i = segments.length - 1; i >= 0; i--) {
          const seg = segments[i];
          if (seg in SHOPIFY_CATEGORY_MAP) return SHOPIFY_CATEGORY_MAP[seg];
        }
        return '';
      };

      // Only use taxonomy paths from the map — never pass raw category names to Shopify (they'll fail validation)
      const productCategory = resolveCategoryPath(catKey);

      // Type column: derive from the last segment of the taxonomy path (e.g. "T-Shirts", "Shirts")
      // so it's always consistent with the category. Fall back to preset's productType if no path.
      const productType = productCategory
        ? productCategory.split(' > ').pop() || product.productType || ''
        : product.productType || '';
      // Standard Product Type: always use productCategory from SHOPIFY_CATEGORY_MAP — it's the
      // only guaranteed-valid Shopify taxonomy path. The stale shopifyProductType from the DB
      // (e.g. "Apparel & Accessories > Clothing > Jeans") can contain invalid paths that cause
      // Shopify to silently reject the whole product row on import. Leave blank if no map entry.
      const standardizedProductType = productCategory;
      const tags = product.tags?.join(', ') || '';
      const condition = (product.condition || '').trim();
      const primaryColor = product.color || '';
      
      // Weight — convert lbs to grams (Shopify's Variant Grams column expects grams)
      const rawWeight = parseFloat(product.weightValue || '');
      const variantGrams = isNaN(rawWeight) ? '' : String(Math.round(rawWeight * 453.592));
      
      const cleanTitle = buildCleanTitle(product, idx);

      // Build image alt text: "Title - Color - Size"
      const altParts = [cleanTitle];
      if (primaryColor && !cleanTitle.toLowerCase().includes(primaryColor.toLowerCase())) altParts.push(primaryColor);
      if (product.size) altParts.push(product.size);
      const imageAltText = altParts.filter(Boolean).join(' - ');

      // Build a URL handle unique within this export
      let baseHandle = cleanTitle
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
        product.generatedDescription || '',                              // Body (HTML)
        vendor,                                                          // Vendor
        productCategory,                                                 // Product Category
        productType,                                                     // Type
        tags,                                                            // Tags
        product.published === false ? 'false' : 'true',                 // Published
        product.size ? 'Size' : '',                                      // Option1 Name
        product.size || '',                                              // Option1 Value
        product.sku || '',                                               // Variant SKU
        variantGrams,                                                    // Variant Grams
        'shopify',                                                       // Variant Inventory Tracker
        String(product.inventoryQuantity ?? 1),                         // Variant Inventory Qty
        product.continueSellingOutOfStock ? 'continue' : 'deny',        // Variant Inventory Policy
        'manual',                                                        // Variant Fulfillment Service
        String(product.price || ''),                                     // Variant Price
        String(product.compareAtPrice || ''),                            // Variant Compare At Price
        product.requiresShipping === false ? 'false' : 'true',          // Variant Requires Shipping
        'true',                                                          // Variant Taxable
        product.barcode || '',                                           // Variant Barcode
        product.imageUrls?.[0] || '',                                    // Image Src
        '1',                                                             // Image Position
        imageAltText || cleanTitle,                                      // Image Alt Text
        '',                                                              // Variant Image
        'false',                                                         // Gift Card
        cleanTitle,                                                      // SEO Title
        product.seoDescription || product.generatedDescription?.substring(0, 320) || '', // SEO Description
        standardizedProductType,                                         // Standard Product Type
        String(product.costPerItem || ''),                               // Cost per item
        product.status || 'draft',                                       // Status
        // Google Shopping
        productCategory,                                                 // Google Shopping / Google Product Category
        product.gender || '',                                            // Google Shopping / Gender
        product.ageGroup || '',                                          // Google Shopping / Age Group
        product.mpn || '',                                               // Google Shopping / MPN
        cleanTitle,                                                      // Google Shopping / AdWords Grouping
        productType,                                                     // Google Shopping / AdWords Labels
        condition,                                                       // Google Shopping / Condition
        'false',                                                         // Google Shopping / Custom Product
        product.customLabel0 || '',                                      // Google Shopping / Custom Label 0
      ]);
      
      // Additional image rows — only Handle, Image Src, Image Position, Image Alt Text, Status
      const productStatus = product.status || 'draft';
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

    // Escape CSV values properly
    const escapeCsvValue = (value: any): string => {
      const str = String(value || '');
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const csvContent = [
      headers.map(escapeCsvValue).join(','),
      ...rows.map(row => row.map(escapeCsvValue).join(','))
    ].join('\n');

    // Create and download the file
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    
    link.setAttribute('href', url);
    link.setAttribute('download', `shopify-products-${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Expose downloadCSV so a parent can trigger it via ref
  useImperativeHandle(ref, () => ({ downloadCSV: handleDownloadCSV }));

  return (
    <div className="google-sheet-exporter">
      {!compactMode && (
        <>
          <div className="export-summary">
            <h3>Export Summary</h3>
            <div className="summary-stats">
              <div className="stat-card">
                <span className="stat-number">{products.length}</span>
                <span className="stat-label">Total Products</span>
              </div>
              <div className="stat-card">
                <span className="stat-number">
                  {products.filter(p => p.price).length}
                </span>
                <span className="stat-label">Priced Items</span>
              </div>
              <div className="stat-card">
                <span className="stat-number">
                  {new Set(products.map(p => p.category)).size}
                </span>
                <span className="stat-label">Categories</span>
              </div>
            </div>
          </div>

          <div className="export-preview">
            <h3>Preview (Shopify Format)</h3>
            <div className="table-container" style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: '420px', borderRadius: '8px', border: '1px solid #e5e7eb' }}>
              <table className="preview-table" style={{ minWidth: '4800px', borderCollapse: 'collapse', fontSize: '0.78rem', whiteSpace: 'nowrap' }}>
                <thead>
                  <tr style={{ position: 'sticky', top: 0, zIndex: 2, background: '#f8fafc' }}>
                    {[
                      'Handle','Title','Body (HTML)','Vendor','Product Category','Type','Tags','Published',
                      'Option1 Name','Option1 Value','Variant SKU','Variant Grams','Variant Inventory Tracker',
                      'Variant Inventory Qty','Variant Inventory Policy','Variant Fulfillment Service',
                      'Variant Price','Variant Compare At Price','Variant Requires Shipping','Variant Taxable',
                      'Variant Barcode','Image Src','Image Position','Image Alt Text','Variant Image','Gift Card',
                      'SEO Title','SEO Description','Standard Product Type','Cost per item','Status',
                      'GS / Product Category','GS / Gender','GS / Age Group','GS / MPN',
                      'GS / AdWords Grouping','GS / AdWords Labels','GS / Condition','GS / Custom Product','GS / Custom Label 0'
                    ].map((col, i) => (
                      <th key={i} style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 600, borderBottom: '2px solid #e5e7eb', background: '#f8fafc', color: '#374151', minWidth: i <= 2 ? '180px' : '110px' }}>
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {products.map((product, idx) => {
                    const cleanTitle = buildCleanTitle(product, idx);
                    const catKey = product.category?.toLowerCase() ?? '';
                    const resolveCategoryPathPreview = (key: string): string => {
                      if (!key) return '';
                      if (key in SHOPIFY_CATEGORY_MAP) return SHOPIFY_CATEGORY_MAP[key];
                      const segments = key.split(/[-\s]+/).filter(Boolean);
                      for (let i = segments.length - 1; i >= 0; i--) {
                        const seg = segments[i];
                        if (seg in SHOPIFY_CATEGORY_MAP) return SHOPIFY_CATEGORY_MAP[seg];
                      }
                      return '';
                    };
                    const productCategory = resolveCategoryPathPreview(catKey);
                    const previewProductType = productCategory
                      ? productCategory.split(' > ').pop() || product.productType || ''
                      : product.productType || '';
                    const vendor = product.brand || '';
                    const tags = product.tags?.join(', ') || '';
                    const condition = (product.condition || '').trim();
                    const primaryColor = product.color || '';
                    const rawWeight = parseFloat(product.weightValue || '');
                    const variantGrams = isNaN(rawWeight) ? '' : String(Math.round(rawWeight * 453.592));
                    const altParts = [cleanTitle];
                    if (primaryColor && !cleanTitle.toLowerCase().includes(primaryColor.toLowerCase())) altParts.push(primaryColor);
                    if (product.size) altParts.push(product.size);
                    const imageAltText = altParts.filter(Boolean).join(' - ');
                    // Standard Product Type: always from SHOPIFY_CATEGORY_MAP (always valid).
                    const standardizedProductType = productCategory;
                    const tr = (v: string | undefined | null, maxLen = 40) => {
                      const s = v ?? '—';
                      return s.length > maxLen ? <span title={s}>{s.substring(0, maxLen)}…</span> : <>{s || '—'}</>;
                    };
                    const cols: (string | null | undefined)[] = [
                      cleanTitle.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') || `product-${idx + 1}`, // Handle
                      cleanTitle,                                                    // Title
                      product.generatedDescription || '',                            // Body (HTML)
                      vendor,                                                        // Vendor
                      productCategory,                                               // Product Category
                      previewProductType,                                            // Type
                      tags,                                                          // Tags
                      product.published === false ? 'false' : 'true',               // Published
                      product.size ? 'Size' : '',                                   // Option1 Name
                      product.size || '',                                            // Option1 Value
                      product.sku || '',                                             // Variant SKU
                      variantGrams,                                                  // Variant Grams
                      'shopify',                                                     // Variant Inventory Tracker
                      String(product.inventoryQuantity ?? 1),                       // Variant Inventory Qty
                      product.continueSellingOutOfStock ? 'continue' : 'deny',      // Variant Inventory Policy
                      'manual',                                                      // Variant Fulfillment Service
                      product.price != null ? `$${Number(product.price).toFixed(2)}` : '', // Variant Price
                      String(product.compareAtPrice || ''),                          // Variant Compare At Price
                      product.requiresShipping === false ? 'false' : 'true',        // Variant Requires Shipping
                      'true',                                                        // Variant Taxable
                      product.barcode || '',                                         // Variant Barcode
                      product.imageUrls?.[0] || '',                                 // Image Src
                      '1',                                                           // Image Position
                      imageAltText || cleanTitle,                                   // Image Alt Text
                      '',                                                            // Variant Image
                      'false',                                                       // Gift Card
                      cleanTitle,                                                    // SEO Title
                      product.seoDescription || product.generatedDescription?.substring(0, 320) || '', // SEO Description
                      standardizedProductType,                                       // Standard Product Type
                      String(product.costPerItem || ''),                            // Cost per item
                      product.status || 'draft',                                    // Status
                      productCategory,                                               // Google Shopping / Google Product Category
                      product.gender || '',                                          // Google Shopping / Gender
                      product.ageGroup || '',                                        // Google Shopping / Age Group
                      product.mpn || '',                                             // Google Shopping / MPN
                      cleanTitle,                                                    // Google Shopping / AdWords Grouping
                      previewProductType,                                            // Google Shopping / AdWords Labels
                      condition,                                                     // Google Shopping / Condition
                      'false',                                                       // Google Shopping / Custom Product
                      product.customLabel0 || '',                                    // Google Shopping / Custom Label 0
                    ];
                    return (
                      <tr key={product.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                        {cols.map((val, ci) => (
                          <td key={ci} style={{ padding: '5px 10px', color: val ? '#111827' : '#9ca3af', verticalAlign: 'top' }}>
                            {tr(val, ci === 0 || ci === 1 || ci === 40 ? 50 : ci === 2 || ci === 41 ? 60 : 35)}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* Download button removed — triggered via ref from Step 3 sidebar */}

      {!compactMode && (
        <div className="export-instructions">
          <h3>📄 CSV Export</h3>
          <p style={{ fontSize: '0.95rem', color: '#666', marginTop: '0.5rem', lineHeight: '1.5' }}>
            Downloads a CSV file with <strong>all product data and fields</strong> ready for Shopify import. 
            The CSV includes image URLs that Shopify will automatically fetch during import.
          </p>
          <div style={{ marginTop: '1rem', padding: '1rem', background: '#f0f9ff', borderRadius: '8px', fontSize: '0.9rem' }}>
            <strong>✅ Includes all fields:</strong>
            <ul style={{ marginTop: '0.5rem', marginBottom: 0, paddingLeft: '1.5rem' }}>
              <li>Product details (title, description, brand, category)</li>
              <li>Pricing (price, compare-at price, cost)</li>
              <li>Variants (size, color, secondary color)</li>
              <li>Inventory (SKU, barcode, quantity)</li>
              <li>Shipping (weight, dimensions, parcel size)</li>
              <li>Product classification (style, gender, age group, size type)</li>
              <li>Policies & marketplace info</li>
              <li>SEO fields (title, description)</li>
              <li>Google Shopping fields (MPN, custom labels)</li>
              <li>Image URLs (automatically fetched by Shopify)</li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
});

GoogleSheetExporter.displayName = 'GoogleSheetExporter';

export default GoogleSheetExporter;
