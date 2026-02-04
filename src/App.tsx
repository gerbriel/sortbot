import { useState, useEffect } from 'react';
import { supabase } from './lib/supabase';
import type { User } from '@supabase/supabase-js';
import Auth from './components/Auth';
import ImageUpload from './components/ImageUpload';
import ImageGrouper from './components/ImageGrouper';
import CategoryZones from './components/CategoryZones';
import ProductDescriptionGenerator from './components/ProductDescriptionGenerator';
import GoogleSheetExporter from './components/GoogleSheetExporter';
import { SavedProducts } from './components/SavedProducts';
import { saveBatchToDatabase } from './lib/productService';
import './App.css';

export interface ClothingItem {
  id: string;
  file: File;
  preview: string;
  category?: string;
  productGroup?: string; // For grouping multiple images of same product
  voiceDescription?: string;
  generatedDescription?: string;
  storagePath?: string; // Supabase Storage path for deletion
  
  // Shopify Product Fields
  seoTitle?: string; // Title
  price?: number; // Price
  compareAtPrice?: number; // Compare-at price
  costPerItem?: number; // Cost per item
  tags?: string[];
  size?: string; // Option1 value (Size)
  color?: string; // Option2 value (Color) - can be extracted from voice
  brand?: string; // Vendor
  condition?: 'New' | 'Used' | 'NWT' | 'Excellent' | 'Good' | 'Fair';
  flaws?: string;
  material?: string;
  
  // Shopify Inventory & Shipping
  sku?: string;
  barcode?: string;
  weightValue?: string; // in grams
  inventoryQuantity?: number;
  
  // Product Details
  measurements?: {
    pitToPit?: string;
    length?: string;
    waist?: string;
    inseam?: string;
    rise?: string;
    shoulder?: string;
    sleeve?: string;
  };
  era?: string; // vintage, modern, etc.
  care?: string; // Care instructions
  
  // SEO & Marketing
  seoDescription?: string;
  productType?: string; // Type (e.g., "Graphic shirt")
  
  // Status
  status?: 'Active' | 'Draft' | 'Archived';
  published?: boolean;
  
  // Image URLs (for Shopify import)
  imageUrls?: string[];
}

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploadedImages, setUploadedImages] = useState<ClothingItem[]>([]);
  const [sortedImages, setSortedImages] = useState<ClothingItem[]>([]);
  const [groupedImages, setGroupedImages] = useState<ClothingItem[]>([]);
  const [processedItems, setProcessedItems] = useState<ClothingItem[]>([]);
  const [showSavedProducts, setShowSavedProducts] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [showStep2Info, setShowStep2Info] = useState(false);

  // Check authentication status on mount
  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setLoading(false);
    });

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    // Reset all data
    setUploadedImages([]);
    setSortedImages([]);
    setGroupedImages([]);
    setProcessedItems([]);
  };

  const handleSaveBatch = async () => {
    if (!user || processedItems.length === 0) {
      alert('No products to save!');
      return;
    }

    setSaving(true);
    setSaveMessage(null);

    try {
      const result = await saveBatchToDatabase(processedItems, user.id);
      
      if (result.success > 0) {
        setSaveMessage({
          type: 'success',
          text: `✅ Saved ${result.success} product(s)${result.failed > 0 ? `, ${result.failed} failed` : ''}!`,
        });
        
        // Clear the batch after successful save
        setTimeout(() => {
          setProcessedItems([]);
          setGroupedImages([]);
          setSortedImages([]);
          setUploadedImages([]);
          setSaveMessage(null);
        }, 3000);
      } else {
        setSaveMessage({
          type: 'error',
          text: '❌ Failed to save products. Please try again.',
        });
      }
    } catch (error) {
      console.error('Save error:', error);
      setSaveMessage({
        type: 'error',
        text: '❌ An error occurred while saving.',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleClearBatch = () => {
    if (confirm('Are you sure you want to clear this batch? Unsaved products will be lost.')) {
      setProcessedItems([]);
      setGroupedImages([]);
      setSortedImages([]);
      setUploadedImages([]);
      setSaveMessage(null);
    }
  };

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="spinner"></div>
        <p>Loading...</p>
      </div>
    );
  }

  if (!user) {
    return <Auth onAuthenticated={() => {}} />;
  }

  const handleImagesUploaded = (items: ClothingItem[]) => {
    setUploadedImages(items);
    // Reset downstream states when new images uploaded
    setGroupedImages([]);
    setSortedImages([]);
    setProcessedItems([]);
  };

  const handleImagesSorted = (items: ClothingItem[]) => {
    setSortedImages(items);
    // Also update groupedImages so Step 2 shows the categories
    setGroupedImages(items);
  };

  const handleImagesGrouped = (items: ClothingItem[]) => {
    setGroupedImages(items);
    
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
        <div className="header-content">
          <div>
            <h1>🛍️ Sortbot - AI Clothing Sorting & Export</h1>
            <p className="header-subtitle">Upload, sort, describe, and export to Shopify</p>
          </div>
          <div className="header-actions">
            <button 
              onClick={() => setShowSavedProducts(true)} 
              className="button button-secondary"
              style={{ marginRight: '12px' }}
            >
              📦 Saved Products
            </button>
            <span className="user-email">{user.email}</span>
            <button onClick={handleSignOut} className="button button-secondary">
              Sign Out
            </button>
          </div>
        </div>
      </header>

      <main className="app-main">
        {/* Save Message */}
        {saveMessage && (
          <div className={`save-message ${saveMessage.type}`}>
            {saveMessage.text}
          </div>
        )}

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
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <h2>Step 2: Group Product Images</h2>
              <button 
                onClick={() => setShowStep2Info(!showStep2Info)}
                style={{
                  background: '#667eea',
                  border: 'none',
                  borderRadius: '50%',
                  width: '24px',
                  height: '24px',
                  cursor: 'pointer',
                  color: 'white',
                  fontSize: '14px',
                  fontWeight: 'bold',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: 0
                }}
                title="How to use"
              >
                i
              </button>
            </div>
            {showStep2Info && (
              <div style={{
                background: '#f0f4ff',
                padding: '1rem',
                borderRadius: '8px',
                marginTop: '0.5rem',
                marginBottom: '1rem',
                borderLeft: '4px solid #667eea',
                fontSize: '14px'
              }}>
                <ul style={{ margin: 0, paddingLeft: '1.5rem' }}>
                  <li>👆 <strong>Click images</strong> to select them (green checkmark appears)</li>
                  <li>🔗 <strong>Click "Group Selected"</strong> to create a product from 2+ images</li>
                  <li>🖱️ <strong>Drag images</strong> between groups to reorganize</li>
                  <li>🗑️ <strong>Click × button</strong> to delete unwanted images</li>
                </ul>
              </div>
            )}
            <p className="step-description">
              Click to select images, group them, and organize your products. All images are auto-uploaded to your database.
            </p>
            <ImageGrouper 
              items={uploadedImages} 
              onGrouped={handleImagesGrouped}
              userId={user.id}
            />
          </section>
        )}

        {/* Step 3: Drag & Drop Categorization */}
        {groupedImages.length > 0 && (
          <section className="step-section">
            <h2>Step 3: Drag Groups to Categories</h2>
            <p className="step-description">
              Drag your product groups onto category buttons to categorize them.
            </p>
            <CategoryZones 
              items={groupedImages} 
              onCategorized={handleImagesSorted}
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

        {/* Step 5: Save & Export */}
        {processedItems.length > 0 && (
          <section className="step-section">
            <h2>Step 5: Save & Export</h2>
            
            <div className="batch-actions">
              <button 
                onClick={handleSaveBatch} 
                className="button button-primary"
                disabled={saving}
              >
                {saving ? '💾 Saving...' : '💾 Save Batch to Database'}
              </button>
              
              <button 
                onClick={handleClearBatch} 
                className="button button-secondary"
                disabled={saving}
              >
                🗑️ Clear Batch
              </button>
            </div>

            <div className="export-section">
              <h3>Export Options</h3>
              <GoogleSheetExporter items={processedItems} />
            </div>
          </section>
        )}
      </main>

      {/* Saved Products Modal */}
      {showSavedProducts && user && (
        <SavedProducts 
          userId={user.id} 
          onClose={() => setShowSavedProducts(false)} 
        />
      )}
    </div>
  );
}

export default App;
