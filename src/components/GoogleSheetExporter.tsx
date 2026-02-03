import { useState } from 'react';
import type { ClothingItem } from '../App';
import ExcelJS from 'exceljs';
import './GoogleSheetExporter.css';

interface GoogleSheetExporterProps {
  items: ClothingItem[];
}

const GoogleSheetExporter: React.FC<GoogleSheetExporterProps> = ({ items }) => {
  const [isExporting, setIsExporting] = useState(false);

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
      imageUrls: group.map(item => item.preview), // All images in the group
      imageCount: group.length
    };
  });

  // Helper function to format measurements
  const formatMeasurements = (measurements: any): string => {
    if (!measurements) return '';
    const parts = [];
    if (measurements.pitToPit) parts.push(`Pit-to-Pit: ${measurements.pitToPit}"`);
    if (measurements.length) parts.push(`Length: ${measurements.length}"`);
    if (measurements.sleeve) parts.push(`Sleeve: ${measurements.sleeve}"`);
    if (measurements.shoulder) parts.push(`Shoulder: ${measurements.shoulder}"`);
    if (measurements.waist) parts.push(`Waist: ${measurements.waist}"`);
    if (measurements.inseam) parts.push(`Inseam: ${measurements.inseam}"`);
    if (measurements.rise) parts.push(`Rise: ${measurements.rise}"`);
    return parts.join(' | ');
  };

  const handleDownloadCSV = () => {
    // Create CSV content for Shopify - EXACT format from template
    const headers = [
      'Title',
      'URL handle',
      'Description',
      'Vendor',
      'Product category',
      'Type',
      'Tags',
      'Published on online store',
      'Status',
      'SKU',
      'Barcode',
      'Option1 name',
      'Option1 value',
      'Option2 name',
      'Option2 value',
      'Price',
      'Compare-at price',
      'Cost per item',
      'Charge tax',
      'Weight value (grams)',
      'Weight unit for display',
      'Requires shipping',
      'Fulfillment service',
      'Product image URL',
      'Image position',
      'Image alt text',
      'SEO title',
      'SEO description',
      'Google Shopping / Condition'
    ];

    const rows: string[][] = [];
    
    products.forEach((product, idx) => {
      const handle = (product.seoTitle || `product-${idx + 1}`).toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
      const vendor = product.brand || 'Your Store';
      const productCategory = product.category || 'Apparel & Accessories > Clothing';
      const productType = product.productType || 'Clothing';
      const tags = product.tags?.join(', ') || '';
      const condition = product.condition === 'New' || product.condition === 'NWT' ? 'New' : 'Used';
      
      // First row with all main product info + first image
      rows.push([
        product.seoTitle || `Product ${idx + 1}`,
        handle,
        product.generatedDescription || '',
        vendor,
        productCategory,
        productType,
        tags,
        product.published === false ? 'FALSE' : 'TRUE',
        product.status || 'Draft',
        product.sku || `SKU-${idx + 1}`,
        product.barcode || '',
        'Size',
        product.size || 'One Size',
        'Color',
        product.color || 'N/A',
        String(product.price || '0'),
        String(product.compareAtPrice || ''),
        String(product.costPerItem || ''),
        'TRUE',
        product.weightValue || '150',
        'g',
        'TRUE',
        'manual',
        product.imageUrls?.[0] || '',
        '1',
        `${product.seoTitle || 'Product'} - Image 1`,
        product.seoTitle || '',
        product.seoDescription || product.generatedDescription?.substring(0, 160) || '',
        condition
      ]);
      
      // Additional rows for remaining images (if any)
      if (product.imageUrls) {
        for (let i = 1; i < product.imageUrls.length && i < 4; i++) {
          rows.push([
            '', // Empty title for variant rows
            handle,
            '', '', '', '', '', '', '', '', '', '', '', '', '',
            '', '', '', '', '', '', '', '',
            product.imageUrls[i],
            String(i + 1),
            `${product.seoTitle || 'Product'} - Image ${i + 1}`,
            '', '', ''
          ]);
        }
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

  const handleDownloadExcelWithImages = async () => {
    setIsExporting(true);
    try {
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Products');

      // Define columns with specific widths
      worksheet.columns = [
        { header: 'Image 1', key: 'image1', width: 20 },
        { header: 'Title', key: 'title', width: 30 },
        { header: 'Handle', key: 'handle', width: 25 },
        { header: 'Category', key: 'category', width: 15 },
        { header: 'Description', key: 'description', width: 40 },
        { header: 'Price', key: 'price', width: 10 },
        { header: 'Size', key: 'size', width: 12 },
        { header: 'Brand', key: 'brand', width: 15 },
        { header: 'Condition', key: 'condition', width: 12 },
        { header: 'Flaws', key: 'flaws', width: 30 },
        { header: 'Material', key: 'material', width: 15 },
        { header: 'Measurements', key: 'measurements', width: 35 },
        { header: 'Era', key: 'era', width: 12 },
        { header: 'Care', key: 'care', width: 25 },
        { header: 'Tags', key: 'tags', width: 25 },
        { header: 'Image 2', key: 'image2', width: 20 },
        { header: 'Image 3', key: 'image3', width: 20 },
        { header: 'Image 4', key: 'image4', width: 20 },
        { header: 'Status', key: 'status', width: 10 }
      ];

      // Style header row
      worksheet.getRow(1).font = { bold: true, size: 12 };
      worksheet.getRow(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF008060' } // Shopify green
      };
      worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
      worksheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };

      // Add products with embedded images
      for (let i = 0; i < products.length; i++) {
        const product = products[i];
        const rowNumber = i + 2; // +2 because Excel is 1-indexed and row 1 is header

        // Add text data
        const row = worksheet.addRow({
          title: product.seoTitle || '',
          handle: (product.seoTitle || '').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''),
          category: product.category || '',
          description: product.generatedDescription || '',
          price: product.price || '',
          size: product.size || '',
          brand: product.brand || '',
          condition: product.condition || '',
          flaws: product.flaws || '',
          material: product.material || '',
          measurements: formatMeasurements(product.measurements),
          era: product.era || '',
          care: product.care || '',
          tags: product.tags?.join(', ') || '',
          status: 'draft'
        });

        // Set row height for images
        row.height = 120;

        // Add images to cells (columns A, P, Q, R for images 1-4)
        const imageColumns = [
          { col: 'A', url: product.imageUrls[0] },
          { col: 'P', url: product.imageUrls[1] },
          { col: 'Q', url: product.imageUrls[2] },
          { col: 'R', url: product.imageUrls[3] }
        ];

        for (const { col, url } of imageColumns) {
          if (url) {
            try {
              // Fetch image and convert to buffer
              const response = await fetch(url);
              const blob = await response.blob();
              const arrayBuffer = await blob.arrayBuffer();

              // Determine image extension
              const extension = blob.type.split('/')[1] || 'jpeg';

              // Add image to workbook
              const imageId = workbook.addImage({
                buffer: arrayBuffer as any,
                extension: extension as any,
              });

              // Embed image in cell
              worksheet.addImage(imageId, {
                tl: { col: col.charCodeAt(0) - 65, row: rowNumber - 1 } as any,
                ext: { width: 150, height: 110 },
                editAs: 'oneCell'
              });
            } catch (error) {
              console.error(`Error adding image to cell ${col}${rowNumber}:`, error);
            }
          }
        }
      }

      // Generate Excel file
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { 
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' 
      });

      // Download file
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', `shopify-products-with-images-${new Date().toISOString().split('T')[0]}.xlsx`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      alert(`✅ Excel file downloaded successfully!\n\n${products.length} products with embedded images.`);
    } catch (error) {
      console.error('Excel export error:', error);
      alert('❌ Error creating Excel file. Please try again.');
    } finally {
      setIsExporting(false);
    }
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
          className="button button-secondary"
          onClick={handleDownloadCSV}
        >
          💾 Download CSV (with image filenames)
        </button>

        <button 
          className="button button-primary"
          onClick={handleDownloadExcelWithImages}
          disabled={isExporting}
          title="Download Excel file with embedded product images"
        >
          {isExporting ? (
            <span className="loading">
              <span className="spinner"></span>
              Creating Excel with images...
            </span>
          ) : (
            '🖼️ Download Excel with Embedded Images'
          )}
        </button>
      </div>

      <div className="export-instructions">
        <h3>Export Options:</h3>
        <div style={{ marginTop: '1rem', display: 'grid', gap: '1rem' }}>
          <div>
            <strong>📄 CSV Export:</strong>
            <p style={{ fontSize: '0.9rem', color: '#666', marginTop: '0.5rem' }}>
              Downloads a CSV file with all product data and image <em>filenames</em>. 
              Perfect for importing to Shopify or other platforms. You'll need to upload 
              images separately and match them by filename.
            </p>
          </div>
          <div>
            <strong>🖼️ Excel Export:</strong>
            <p style={{ fontSize: '0.9rem', color: '#666', marginTop: '0.5rem' }}>
              Downloads an Excel file with actual images <em>embedded</em> in cells. 
              Great for visual product reviews, printing catalogs, or sharing complete 
              product listings with your team.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default GoogleSheetExporter;
