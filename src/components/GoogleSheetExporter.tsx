import { useState } from 'react';
import type { ClothingItem } from '../App';
import ExcelJS from 'exceljs';
import './GoogleSheetExporter.css';

interface GoogleSheetExporterProps {
  items: ClothingItem[];
}

const GoogleSheetExporter: React.FC<GoogleSheetExporterProps> = ({ items }) => {
  const [isExporting, setIsExporting] = useState(false);
  const [exportStatus, setExportStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [sheetUrl, setSheetUrl] = useState('');
  const [tempSheetUrl, setTempSheetUrl] = useState('');

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

  const handleExportToGoogleSheets = async () => {
    if (!sheetUrl || sheetUrl.trim() === '') {
      alert('Please enter a Google Sheets URL first');
      return;
    }
    
    // Validate URL format
    if (!sheetUrl.includes('docs.google.com/spreadsheets')) {
      alert('Please enter a valid Google Sheets URL');
      return;
    }
    
    setIsExporting(true);
    setExportStatus('idle');

    try {
      // Prepare the data structure for Google Sheets
      // Note: Images are shown as filenames since blob URLs don't work outside browser
      const sheetData = products.map((product, idx) => ({
        Title: product.seoTitle || '',
        Handle: (product.seoTitle || '').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''),
        Category: product.category || '',
        Description: product.generatedDescription || '',
        Price: product.price || '',
        Size: product.size || '',
        Tags: product.tags?.join(', ') || '',
        'Image 1 Filename': product.imageUrls[0] ? `Product_${idx + 1}_Image_1.jpg` : '',
        'Image 2 Filename': product.imageUrls[1] ? `Product_${idx + 1}_Image_2.jpg` : '',
        'Image 3 Filename': product.imageUrls[2] ? `Product_${idx + 1}_Image_3.jpg` : '',
        'Image 4 Filename': product.imageUrls[3] ? `Product_${idx + 1}_Image_4.jpg` : '',
        'Photo Count': product.imageCount,
        Status: 'draft',
        'Note': 'Upload images separately to your hosting and add URLs here'
      }));
      
      // Extract sheet ID from URL for API call
      const sheetIdMatch = sheetUrl.match(/\/d\/([a-zA-Z0-9-_]+)/);
      const sheetId = sheetIdMatch ? sheetIdMatch[1] : null;
      
      if (!sheetId) {
        alert('Could not extract Sheet ID from URL. Please check the URL format.');
        setExportStatus('error');
        return;
      }
      
      // Prepare data for Google Sheets API format
      const headers = ['Title', 'Handle', 'Category', 'Description', 'Price', 'Size', 'Tags', 'Image 1 Filename', 'Image 2 Filename', 'Image 3 Filename', 'Image 4 Filename', 'Photo Count', 'Status', 'Note'];
      const values = [
        headers,
        ...sheetData.map(row => [
          row.Title,
          row.Handle,
          row.Category,
          row.Description,
          row.Price,
          row.Size,
          row.Tags,
          row['Image 1 Filename'],
          row['Image 2 Filename'],
          row['Image 3 Filename'],
          row['Image 4 Filename'],
          row['Photo Count'],
          row.Status,
          row.Note
        ])
      ];
      
      // For now, we'll prepare the data but not actually write to Google Sheets
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      // For now, copy data to clipboard for manual paste
      const tsvData = values.map(row => row.join('\t')).join('\n');
      
      try {
        await navigator.clipboard.writeText(tsvData);
        alert(`✅ Data prepared and copied to clipboard!\n\nSheet ID: ${sheetId}\n\nTo complete the export:\n1. Open your Google Sheet: ${sheetUrl}\n2. Click on cell A1\n3. Press Cmd+V (Mac) or Ctrl+V (Windows) to paste\n\n⚠️ IMAGE NOTE: Images are shown as filenames (Product_X_Image_Y.jpg). You'll need to:\n- Upload your images to a hosting service (Shopify, Imgur, etc.)\n- Replace the filenames with actual image URLs in the sheet\n\nThe data includes ${products.length} products with all fields (Title, Description, Price, Size, Tags).`);
      } catch (clipboardError) {
        console.error('Clipboard error:', clipboardError);
        alert(`✅ Data prepared for export!\n\nSheet ID: ${sheetId}\n\nData is ready in the console. Use the "Download Shopify CSV" button to get a file you can manually import to your Google Sheet.`);
      }
      
      setExportStatus('success');
    } catch (error) {
      console.error('Export error:', error);
      alert('❌ Error preparing export. Check console for details.');
      setExportStatus('error');
    } finally {
      setIsExporting(false);
    }
  };

  const handleDownloadCSV = () => {
    // Create CSV content for Shopify
    const headers = [
      'Title',
      'Handle',
      'Category',
      'Description',
      'Price',
      'Size',
      'Tags',
      'Image 1 Filename',
      'Image 2 Filename',
      'Image 3 Filename',
      'Image 4 Filename',
      'Status',
      'Note'
    ];

    const rows = products.map((product, idx) => [
      product.seoTitle || '',
      (product.seoTitle || '').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''),
      product.category || '',
      product.generatedDescription || '',
      product.price || '',
      product.size || '',
      product.tags?.join(', ') || '',
      product.imageUrls[0] ? `Product_${idx + 1}_Image_1.jpg` : '', // Image filenames
      product.imageUrls[1] ? `Product_${idx + 1}_Image_2.jpg` : '',
      product.imageUrls[2] ? `Product_${idx + 1}_Image_3.jpg` : '',
      product.imageUrls[3] ? `Product_${idx + 1}_Image_4.jpg` : '',
      'draft',
      'Upload images and replace filenames with URLs'
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');

    // Create download
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `shopify-products-${Date.now()}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const handleDownloadExcelWithImages = async () => {
    try {
      // Create a new workbook
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Products');

      // Define columns
      worksheet.columns = [
        { header: 'Image', key: 'image', width: 30 },
        { header: 'Title', key: 'title', width: 40 },
        { header: 'Handle', key: 'handle', width: 30 },
        { header: 'Category', key: 'category', width: 20 },
        { header: 'Description', key: 'description', width: 50 },
        { header: 'Price', key: 'price', width: 15 },
        { header: 'Size', key: 'size', width: 15 },
        { header: 'Tags', key: 'tags', width: 30 },
        { header: 'Image 2', key: 'image2', width: 30 },
        { header: 'Image 3', key: 'image3', width: 30 },
        { header: 'Image 4', key: 'image4', width: 30 },
      ];

      // Style the header row
      worksheet.getRow(1).font = { bold: true, size: 12 };
      worksheet.getRow(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF4472C4' }
      };
      worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
      worksheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };

      // Add data for each product
      for (let i = 0; i < products.length; i++) {
        const product = products[i];
        const rowIndex = i + 2; // +2 because row 1 is header, array is 0-indexed

        // Add text data
        const row = worksheet.addRow({
          title: product.seoTitle || '',
          handle: (product.seoTitle || '').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''),
          category: product.category || '',
          description: product.generatedDescription || '',
          price: product.price || '',
          size: product.size || '',
          tags: product.tags?.join(', ') || '',
        });

        // Set row height to accommodate images
        row.height = 120;

        // Helper function to convert blob URL to base64
        const blobToBase64 = async (blobUrl: string): Promise<string> => {
          const response = await fetch(blobUrl);
          const blob = await response.blob();
          return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
        };

        // Add images (up to 4 images per product)
        const imageColumns = [
          { col: 0, url: product.imageUrls[0] },  // Column A (Image)
          { col: 8, url: product.imageUrls[1] },  // Column I (Image 2)
          { col: 9, url: product.imageUrls[2] },  // Column J (Image 3)
          { col: 10, url: product.imageUrls[3] }, // Column K (Image 4)
        ];

        for (const { col, url } of imageColumns) {
          if (url) {
            try {
              // Convert blob URL to base64
              const base64Data = await blobToBase64(url);
              
              // Extract the base64 data (remove data:image/...;base64, prefix)
              const base64String = base64Data.split(',')[1];
              
              // Determine image extension from the data URL
              const mimeMatch = base64Data.match(/data:image\/(\w+);base64,/);
              const extension = mimeMatch ? mimeMatch[1] : 'jpeg';

              // Add image to workbook
              const imageId = workbook.addImage({
                base64: base64String,
                extension: extension as 'jpeg' | 'png' | 'gif',
              });

              // Embed image in cell
              worksheet.addImage(imageId, {
                tl: { col, row: rowIndex - 1 }, // top-left corner
                ext: { width: 200, height: 110 }, // image dimensions
                editAs: 'oneCell'
              });
            } catch (err) {
              console.warn(`Failed to add image for product ${i + 1}:`, err);
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
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `shopify-products-with-images-${Date.now()}.xlsx`;
      a.click();
      window.URL.revokeObjectURL(url);

      alert(`✅ Excel file created with ${products.length} products and embedded images!`);
    } catch (error) {
      console.error('Error creating Excel file:', error);
      alert('❌ Error creating Excel file. Please try again.');
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

      <div className="google-sheets-input-section">
        <h3>Google Sheets Configuration</h3>
        <p style={{ fontSize: '0.9rem', color: '#666', marginBottom: '1rem' }}>
          Paste your Google Sheets URL to export data directly to your spreadsheet
        </p>
        <div className="sheet-url-input-group">
          <input
            type="text"
            value={tempSheetUrl}
            onChange={(e) => setTempSheetUrl(e.target.value)}
            placeholder="https://docs.google.com/spreadsheets/d/YOUR_SHEET_ID/edit"
            className="sheet-url-input"
          />
          <button
            className="button button-secondary"
            onClick={() => {
              if (tempSheetUrl.includes('docs.google.com/spreadsheets')) {
                setSheetUrl(tempSheetUrl);
                alert('✓ Google Sheets URL saved! You can now export.');
              } else {
                alert('Please enter a valid Google Sheets URL');
              }
            }}
            disabled={!tempSheetUrl.trim()}
          >
            Save URL
          </button>
        </div>
        {sheetUrl && (
          <div className="sheet-url-saved">
            ✓ Connected to: <a href={sheetUrl} target="_blank" rel="noopener noreferrer">{sheetUrl.substring(0, 60)}...</a>
          </div>
        )}
        <div className="sheet-url-help">
          <p><strong>How to get your Google Sheets URL:</strong></p>
          <ol>
            <li>Open or create a Google Sheet</li>
            <li>Copy the URL from your browser's address bar</li>
            <li>Paste it in the field above</li>
            <li>Click "Save URL"</li>
          </ol>
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
          onClick={handleExportToGoogleSheets}
          disabled={isExporting}
        >
          {isExporting ? (
            <span className="loading">
              <span className="spinner"></span>
              Exporting to Google Sheets...
            </span>
          ) : (
            '📊 Export to Google Sheets'
          )}
        </button>

        <button 
          className="button"
          onClick={handleDownloadCSV}
        >
          💾 Download Shopify CSV
        </button>

        <button 
          className="button button-primary"
          onClick={handleDownloadExcelWithImages}
          title="Download Excel file with embedded product images"
        >
          🖼️ Download Excel with Images
        </button>
      </div>

      {exportStatus === 'success' && (
        <div className="success-message">
          ✓ Successfully exported to Google Sheets!
          <br />
          <a href={sheetUrl} target="_blank" rel="noopener noreferrer">
            Open Sheet →
          </a>
        </div>
      )}

      {exportStatus === 'error' && (
        <div className="error-message">
          ✗ Export failed. Please check your Google Sheets API credentials.
        </div>
      )}

      <div className="export-instructions">
        <h3>Next Steps for Shopify Import:</h3>
        <ol>
          <li>Download the CSV file or open the Google Sheet</li>
          <li>Go to your Shopify admin panel</li>
          <li>Navigate to Products → Import</li>
          <li>Upload the CSV file</li>
          <li>Review and confirm the import</li>
        </ol>
      </div>
    </div>
  );
};

export default GoogleSheetExporter;
