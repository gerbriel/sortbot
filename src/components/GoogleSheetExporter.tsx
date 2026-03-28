import { forwardRef, useImperativeHandle } from 'react';
import type { ClothingItem } from '../App';
import './GoogleSheetExporter.css';

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
      return built || '';
    })();

    // Strip any remaining {tokens} from whichever title we use
    const bestTitle = stripUnresolvedTokens(resolvedTitle || autoTitle || productData.seoTitle || '');

    return {
      ...productData,
      seoTitle: bestTitle,
      // Use Supabase URLs if available, otherwise fall back to preview (blob URLs)
      imageUrls: group.map(item => item.imageUrls?.[0] || item.preview),
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

  const handleDownloadCSV = () => {
    const headers = [
      'Title',
      'URL handle',
      'Description',
      'Vendor / Brand',
      'Product category',
      'Type',
      'Tags',
      'Published on online store',
      'Status',
      'SKU',
      'Barcode',
      'Condition',
      'Size Type',
      'Size',
      'Price',
      'Currency',
      'Compare-at price',
      'Cost per item',
      'Primary Color',
      'Secondary Color',
      'Charge tax',
      'Tax code',
      'Unit price total measure',
      'Unit price total measure unit',
      'Unit price base measure',
      'Unit price base measure unit',
      'Inventory tracker',
      'Inventory quantity',
      'Continue selling when out of stock',
      'Weight Value (LB)',
      'Weight unit for display',
      'Package Dimensions',
      'Requires shipping',
      'Fulfillment service',
      'Ships From',
      'Product image URL',
      'Image position',
      'Image alt text',
      'Variant image URL',
      'Gift card',
      'SEO title',
      'SEO description',
      'Color (product.metafields.shopify.color-pattern)',
      'Discounted Shipping',
      'Material / Fabric',
      'Policies',
      'Renewal options \n',
      'Who Made It',
      'What Is It',
      'Listing Type',
      'Chest',
      'Length',
      'Parcel Size',
      'Describe your listing\'s style',
      'Google Shopping / Google product category',
      'Google Shopping / Gender',
      'Google Shopping / Age group',
      'Google Shopping / Manufacturer part number (MPN)',
      'Google Shopping / Ad group name',
      'Google Shopping / Ads labels',
      'Google Shopping / Condition',
      'Google Shopping / Custom product',
      'Google Shopping / Custom label 0'
    ];

    const rows: string[][] = [];
    const usedHandles = new Set<string>();
    
    products.forEach((product, idx) => {
      const vendor = product.brand || '';
      const productCategory = product.category || '';
      const productType = product.productType || '';
      const tags = product.tags?.join(', ') || '';
      const condition = product.condition || '';
      const primaryColor = product.color || '';
      const secondaryColor = product.secondaryColor || '';
      
      // Weight — round up to nearest whole number so Shopify doesn't reject decimals
      const rawWeight = parseFloat(product.weightValue || '');
      const weightLb = isNaN(rawWeight) ? '' : String(Math.ceil(rawWeight));
      
      // Package dimensions - only if provided
      const packageDims = product.packageDimensions || '';
      
      // Measurements - only what's provided
      const chest = product.measurements?.width || '';
      const length = product.measurements?.length || '';
      
      // Parcel size - only if provided (will come from presets)
      const parcelSize = product.parcelSize || '';
      
      // Size type - only if provided
      const sizeType = product.sizeType || '';
      
      // Google condition - only if provided
      const googleCondition = condition;

      // Clean the SEO title — strip any unresolved {placeholder} tokens
      // that may have come through from preset templates.
      // seoTitle is already deduplicated (e.g. "Nike Tee 2") by the pre-pass above.
      const rawTitle = product.seoTitle || '';
      const strippedTitle = /\{[a-z_]+\}/i.test(rawTitle)
        ? stripUnresolvedTokens(rawTitle) || `product-${idx + 1}`
        : rawTitle || `product-${idx + 1}`;

      // Prepend brand to title if it's not already present
      const brandPrefix = (product.brand || '').trim();
      const cleanTitle = (brandPrefix && !strippedTitle.toLowerCase().includes(brandPrefix.toLowerCase()))
        ? `${brandPrefix} ${strippedTitle}`
        : strippedTitle;

      // Build a rich image alt text: "Brand Title - Color - Size"
      const altParts = [cleanTitle];
      if (primaryColor && !cleanTitle.toLowerCase().includes(primaryColor.toLowerCase())) altParts.push(primaryColor);
      if (product.size) altParts.push(product.size);
      const imageAltText = altParts.filter(Boolean).join(' - ');

      // Build a URL handle and ensure it's globally unique within this export.
      let baseHandle = cleanTitle.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') || `product-${idx + 1}`;
      let handle = baseHandle;
      let handleSuffix = 2;
      while (usedHandles.has(handle)) {
        handle = `${baseHandle}-${handleSuffix++}`;
      }
      usedHandles.add(handle);

      //First row with all main product info + first image
      rows.push([
        cleanTitle, // Title
        handle, // URL handle
        product.generatedDescription || '', // Description
        vendor, // Vendor / Brand
        productCategory, // Product category
        productType, // Type
        tags, // Tags
        product.published === false ? 'FALSE' : 'TRUE', // Published on online store
        product.status || 'Active', // Status
        product.sku || '', // SKU
        product.barcode || '', // Barcode
        condition, // Condition
        sizeType, // Size Type
        product.size || '', // Size
        String(product.price || ''), // Price
        'USD', // Currency
        String(product.compareAtPrice || ''), // Compare-at price
        String(product.costPerItem || ''), // Cost per item
        primaryColor, // Primary Color
        secondaryColor, // Secondary Color
        'TRUE', // Charge tax
        '', // Tax code
        '', // Unit price total measure
        '', // Unit price total measure unit
        '', // Unit price base measure
        '', // Unit price base measure unit
        'shopify', // Inventory tracker
        '1', // Inventory quantity
        'DENY', // Continue selling when out of stock
        weightLb, // Weight Value (LB)
        'LB / OZ', // Weight unit for display
        packageDims, // Package Dimensions
        product.requiresShipping === false ? 'FALSE' : 'TRUE', // Requires shipping
        'manual', // Fulfillment service
        product.shipsFrom || '', // Ships From
        product.imageUrls?.[0] || '', // Product image URL
        '1', // Image position
        imageAltText || 'Product', // Image alt text (first image row)
        '', // Variant image URL
        'FALSE', // Gift card
        cleanTitle, // SEO title
        product.seoDescription || product.generatedDescription?.substring(0, 160) || '', // SEO description
        primaryColor + (secondaryColor ? `; ${secondaryColor}` : ''), // Color metafield
        product.discountedShipping || '', // Discounted Shipping
        product.material || '', // Material / Fabric
        product.policies || '', // Policies
        product.renewalOptions || '', // Renewal options
        product.whoMadeIt || '', // Who Made It
        product.whatIsIt || '', // What Is It
        product.listingType || '', // Listing Type
        chest, // Chest
        length, // Length
        parcelSize, // Parcel Size
        product.style || '', // Describe your listing's style
        productCategory, // Google Shopping / Google product category
        product.gender || '', // Google Shopping / Gender
        product.ageGroup || '', // Google Shopping / Age group
        product.mpn || '', // Google Shopping / MPN
        cleanTitle, // Google Shopping / Ad group name
        productType, // Google Shopping / Ads labels
        googleCondition, // Google Shopping / Condition
        'FALSE', // Google Shopping / Custom product
        product.customLabel0 || '' // Google Shopping / Custom label 0
      ]);
      
      // Additional rows for remaining images (if any)
      const productStatus = product.status || 'Active';
      const imageCount = product.imageUrls?.length || 0;
      for (let i = 1; i < imageCount; i++) {
        // Build a full 62-column row; only handle, status, image URL, position, and alt text are populated
        const imageRow = Array(headers.length).fill('') as string[];
        imageRow[1] = handle;            // URL handle
        imageRow[8] = productStatus;     // Status
        imageRow[35] = product.imageUrls[i] || ''; // Product image URL
        imageRow[36] = String(i + 1);   // Image position
        imageRow[37] = imageAltText || 'Product'; // Image alt text
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
            <div className="table-container">
              <table className="preview-table">
                <thead>
                  <tr>
                    <th>Title</th>
                    <th>Category</th>
                    <th>Price</th>
                    <th>Tags</th>
                    <th>Description</th>
                  </tr>
                </thead>
                <tbody>
                  {products.slice(0, 5).map(product => (
                    <tr key={product.id}>
                      <td>{product.seoTitle}</td>
                      <td>{product.category}</td>
                      <td>${product.price?.toFixed(2)}</td>
                      <td>{product.tags?.join(', ')}</td>
                      <td className="description-cell">
                        {product.generatedDescription?.substring(0, 100)}...
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {products.length > 5 && (
                <p className="preview-note">Showing 5 of {products.length} items</p>
              )}
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
