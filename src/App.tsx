import { useState } from 'react';
import Auth from './components/Auth';
import ImageUpload from './components/ImageUpload';
import ImageSorter from './components/ImageSorter';
import ImageGrouper from './components/ImageGrouper';
import ProductDescriptionGenerator from './components/ProductDescriptionGenerator';
import GoogleSheetExporter from './components/GoogleSheetExporter';
import './App.css';

export interface ClothingItem {
  id: string;
  file: File;
  preview: string;
  category?: string;
  productGroup?: string; // For grouping multiple images of same product
  voiceDescription?: string;
  generatedDescription?: string;
  price?: number;
  tags?: string[];
  seoTitle?: string;
  size?: string; // Size field (XS, S, M, L, XL, etc.)
}

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [uploadedImages, setUploadedImages] = useState<ClothingItem[]>([]);
  const [sortedImages, setSortedImages] = useState<ClothingItem[]>([]);
  const [groupedImages, setGroupedImages] = useState<ClothingItem[]>([]);
  const [processedItems, setProcessedItems] = useState<ClothingItem[]>([]);
  const [groupingVersion, setGroupingVersion] = useState(0); // Track grouping changes

  // Check if authentication is disabled (for development)
  const authDisabled = import.meta.env.VITE_DISABLE_AUTH === 'true';

  if (!isAuthenticated && !authDisabled) {
    return <Auth onAuthenticated={() => setIsAuthenticated(true)} />;
  }

  const handleImagesUploaded = (items: ClothingItem[]) => {
    setUploadedImages(items);
    // Reset downstream states when new images uploaded
    setGroupedImages([]);
    setSortedImages([]);
    setProcessedItems([]);
    setGroupingVersion(0);
  };

  const handleImagesSorted = (items: ClothingItem[]) => {
    setSortedImages(items);
  };

  const handleImagesGrouped = (items: ClothingItem[]) => {
    setGroupedImages(items);
    // Increment version to trigger re-render of downstream components
    setGroupingVersion(prev => prev + 1);
    
    // If we already have sorted images, update them with new grouping info
    if (sortedImages.length > 0) {
      // Merge new grouping info into sorted images
      const updatedSorted = items.map(item => {
        const existingSorted = sortedImages.find(s => s.id === item.id);
        return existingSorted ? { ...item, category: existingSorted.category } : item;
      });
      setSortedImages(updatedSorted);
    }
  };

  const handleItemsProcessed = (items: ClothingItem[]) => {
    setProcessedItems(items);
  };

  return (
    <div className="app-container">
      <header className="app-header">
        <h1>AI Clothing Sorting & Export</h1>
        <p>Upload, sort, describe, and export to Shopify</p>
      </header>

      <main className="app-main">
        {/* Step 1: Upload Images */}
        <section className="step-section">
          <h2>Step 1: Upload Images</h2>
          <ImageUpload onImagesUploaded={handleImagesUploaded} />
          {uploadedImages.length > 0 && (
            <p className="status-text">✓ {uploadedImages.length} images uploaded</p>
          )}
        </section>

        {/* Step 2: Group Images */}
        {uploadedImages.length > 0 && (
          <section className="step-section">
            <h2>Step 2: Group Product Images</h2>
            <p className="step-description">
              Group multiple images of the same product together. Each group will become one product listing.
            </p>
            <ImageGrouper 
              items={uploadedImages} 
              onGrouped={handleImagesGrouped}
            />
          </section>
        )}

        {/* Step 3: Categorize Products */}
        {groupedImages.length > 0 && (
          <section className="step-section">
            <h2>Step 3: Categorize Products</h2>
            <p className="step-description">
              Assign categories to your products (or product groups). This makes batch categorization easier.
              {sortedImages.length > 0 && (
                <span style={{ color: '#667eea', fontWeight: 'bold', marginLeft: '1rem' }}>
                  ✓ Categories saved
                </span>
              )}
            </p>
            <ImageSorter 
              key={`sorter-${groupingVersion}`}
              images={groupedImages} 
              onSorted={handleImagesSorted}
            />
          </section>
        )}

        {/* Step 4: Add Descriptions */}
        {sortedImages.length > 0 && (
          <section className="step-section">
            <h2>Step 4: Add Voice Descriptions & Generate Product Info</h2>
            <ProductDescriptionGenerator
              items={sortedImages}
              onProcessed={handleItemsProcessed}
            />
          </section>
        )}

        {/* Step 5: Export to Google Sheets/Shopify */}
        {processedItems.length > 0 && (
          <section className="step-section">
            <h2>Step 5: Export to Google Sheets</h2>
            <GoogleSheetExporter items={processedItems} />
          </section>
        )}
      </main>
    </div>
  );
}

export default App;
