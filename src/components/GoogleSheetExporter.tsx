import type { ClothingItem } from '../App';
import './GoogleSheetExporter.css';

interface GoogleSheetExporterProps {
  items: ClothingItem[];
}

const GoogleSheetExporter: React.FC<GoogleSheetExporterProps> = ({ items }) => {

  // Group items by productGroup - each group is ONE product
  const productGroups = items.reduce((groups, item) => {
    const groupId = item.productGroup || item.id; // If no group, item becomes its own product
    if (!groups[groupId]) {
      groups[groupId] = [];
    }
    groups[groupId].push(item);
    return groups;
  }, {} as Record<string, ClothingItem[]>);

  const products = Object.values(productGroups).map(group => {
    // Use the first item in the group as the product data (all should have same data)
    const productData = group[0];
    return {
      ...productData,
      // Use Supabase URLs if available, otherwise fall back to preview (blob URLs)
      imageUrls: group.map(item => item.imageUrls?.[0] || item.preview), // All images in the group
      imageCount: group.length
    };
  });

  const handleDownloadCSV = () => {
    // Create CSV content for Shopify - EXACT format from template (all 69 columns)
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
    
    products.forEach((product, idx) => {
      const handle = (product.seoTitle || `product-${idx + 1}`).toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
      const vendor = product.brand || '';
      const productCategory = product.category || '';
      const productType = product.productType || '';
      const tags = product.tags?.join(', ') || '';
      const condition = product.condition || '';
      const primaryColor = product.color || '';
      const secondaryColor = product.secondaryColor || '';
      
      // Weight format - only if provided
      const weightLb = product.weightValue || '';
      
      // Package dimensions - only if provided
      const packageDims = product.packageDimensions || '';
      
      // Measurements - only what's provided
      const chest = product.measurements?.pitToPit || '';
      const length = product.measurements?.length || '';
      
      // Parcel size - only if provided (will come from presets)
      const parcelSize = product.parcelSize || '';
      
      // Size type - only if provided
      const sizeType = product.sizeType || '';
      
      // Google condition - only if provided
      const googleCondition = condition;
      
      //First row with all main product info + first image
      rows.push([
        product.seoTitle || '', // Title
        handle, // URL handle
        product.generatedDescription || '', // Description
        vendor, // Vendor / Brand
        productCategory, // Product category
        productType, // Type
        tags, // Tags
        product.published === false ? 'FALSE' : 'TRUE', // Published on online store
        product.status || '', // Status
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
        `${product.seoTitle || 'Product'}`, // Image alt text
        '', // Variant image URL
        'FALSE', // Gift card
        product.seoTitle || '', // SEO title
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
        product.seoTitle || '', // Google Shopping / Ad group name
        productType, // Google Shopping / Ads labels
        googleCondition, // Google Shopping / Condition
        'FALSE', // Google Shopping / Custom product
        product.customLabel0 || '' // Google Shopping / Custom label 0
      ]);
      
      // Additional rows for remaining images (if any)
      const imageCount = product.imageUrls?.length || 0;
      for (let i = 1; i < imageCount; i++) {
        rows.push([
          '', // Empty title for image rows
          handle, // URL handle
          ...Array(33).fill(''), // Empty columns 3-35
          product.imageUrls[i] || '', // Product image URL (column 36)
          String(i + 1), // Image position (column 37)
          `${product.seoTitle || 'Product'}`, // Image alt text (column 38)
          ...Array(31).fill('') // Empty remaining columns
        ]);
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

  return (
    <div className="google-sheet-exporter">
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

      <div className="export-actions">
        <button 
          className="button button-primary"
          onClick={handleDownloadCSV}
        >
          💾 Download CSV for Shopify Import
        </button>
      </div>

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
    </div>
  );
};

export default GoogleSheetExporter;
