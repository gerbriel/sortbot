import { useState, useEffect } from 'react';
import { supabase } from './lib/supabase';
import type { User } from '@supabase/supabase-js';
import { Tag, Settings, Package, ShoppingBag } from 'lucide-react';
import Auth from './components/Auth';
import ImageUpload from './components/ImageUpload';
import ImageGrouper from './components/ImageGrouper';
import CategoryZones from './components/CategoryZones';
import ProductDescriptionGenerator from './components/ProductDescriptionGenerator';
import GoogleSheetExporter from './components/GoogleSheetExporter';
import { Library } from './components/Library';
import CategoryPresetsManager from './components/CategoryPresetsManager';
import CategoriesManager from './components/CategoriesManager';
import { saveBatchToDatabase } from './lib/productService';
import { autoSaveWorkflowBatch, type WorkflowBatch } from './lib/workflowBatchService';
import type { BrandCategory } from './lib/brandCategorySystem';
import './App.css';

export interface ClothingItem {
  id: string;
  file: File;
  preview: string;
  category?: string;
  brandCategory?: BrandCategory; // Extended 160+ category system
  productGroup?: string; // For grouping multiple images of same product
  voiceDescription?: string;
  generatedDescription?: string;
  storagePath?: string; // Supabase Storage path for deletion
  
  // Category Preset Data (applied when category is assigned)
  _presetData?: {
    presetId: string;
    categoryName: string;
    productType?: string; // The product_type field for comparison
    displayName: string;
    description?: string;
    measurementTemplate: any;
    requiresShipping: boolean;
  };
  
  // Shopify Product Fields
  seoTitle?: string; // Title
  price?: number; // Price
  compareAtPrice?: number; // Compare-at price
  costPerItem?: number; // Cost per item
  tags?: string[];
  size?: string; // Option1 value (Size)
  color?: string; // Option2 value (Color) - can be extracted from voice
  brand?: string; // Vendor
  modelName?: string; // Specific model (e.g., "501 Original Fit", "Air Force 1")
  modelNumber?: string; // Model number (e.g., "501", "AF1", "MA-1")
  subculture?: string[]; // Subculture tags (e.g., "punk-diy", "gorpcore-hiking")
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
  
  // Additional Colors
  secondaryColor?: string;
  
  // Shipping & Packaging (from Category Presets)
  packageDimensions?: string; // e.g., "8 in - 6 in - 4 in"
  parcelSize?: 'Small' | 'Medium' | 'Large' | 'Extra Large';
  shipsFrom?: string; // Shipping address
  continueSellingOutOfStock?: boolean;
  requiresShipping?: boolean; // TRUE for physical items
  
  // Product Classification (from Category Presets)
  sizeType?: 'Regular' | 'Big & Tall' | 'Petite' | 'Plus Size' | 'One Size';
  style?: string; // "Vintage", "Modern", "Streetwear", etc.
  gender?: 'Men' | 'Women' | 'Unisex' | 'Kids';
  ageGroup?: string; // "Adult (13+ years old)", "Kids", "Infants", etc.
  
  // Policies & Marketplace Info (from Category Presets)
  policies?: string; // "No Returns; No Exchanges"
  renewalOptions?: string; // "Automatic", "Manual", etc.
  whoMadeIt?: string; // "Another Company Or Person", "I made it", etc.
  whatIsIt?: string; // "A Finished Product", "A supply", etc.
  listingType?: string; // "Physical Item", "Digital Download"
  discountedShipping?: string; // "No Discount", "10% Off", etc.
  
  // Google Shopping / Advanced Marketing
  mpn?: string; // Manufacturer Part Number
  customLabel0?: string; // "Top Seller", "New Arrival", "Clearance"
  
  // Optional Advanced Fields (rarely used)
  taxCode?: string;
  unitPriceTotalMeasure?: string;
  unitPriceTotalMeasureUnit?: string;
  unitPriceBaseMeasure?: string;
  unitPriceBaseMeasureUnit?: string;
  
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
  const [showLibrary, setShowLibrary] = useState(false);
  const [showCategoryPresets, setShowCategoryPresets] = useState(false);
  const [showCategoriesManager, setShowCategoriesManager] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [showStep2Info, setShowStep2Info] = useState(false);
  const [currentBatchId, setCurrentBatchId] = useState<string | null>(null);
  const [currentBatchNumber, setCurrentBatchNumber] = useState<string>(`batch-${Date.now()}`);

  // Helper to determine current workflow step

  // Real-time presence tracking for collaborative viewing

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
      // Pass the currentBatchId so products are linked to the workflow batch
      const result = await saveBatchToDatabase(processedItems, user.id, currentBatchId);
      
      if (result.success > 0) {
        setSaveMessage({
          type: 'success',
          text: `✅ Saved ${result.success} product(s)${result.failed > 0 ? `, ${result.failed} failed` : ''}!`,
        });
        
        // Broadcast action for real-time collaboration
        
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
    // APPEND new images to existing ones (don't replace)
    const newImages = [...uploadedImages, ...items];
    setUploadedImages(newImages);
    
    // If there are already grouped images, append to those too
    if (groupedImages.length > 0) {
      setGroupedImages(prev => [...prev, ...items]);
    }
    
    // Auto-save workflow state (Step 1 complete)
    autoSaveWorkflow({
      uploadedImages: newImages,
      groupedImages,
      sortedImages,
      processedItems,
    });

    // Broadcast action for real-time collaboration
  };

  const handleImagesSorted = (items: ClothingItem[]) => {
    setSortedImages(items);
    // Also update groupedImages so Step 2 shows the categories
    setGroupedImages(items);
    
    // Sync categories to processedItems (preserve voice descriptions if they exist)
    if (processedItems.length > 0) {
      // Update existing processedItems with new categories
      const updatedProcessed = processedItems.map(procItem => {
        const sortedItem = items.find(i => i.id === procItem.id);
        if (sortedItem) {
          return {
            ...procItem,
            category: sortedItem.category, // Update category from Step 3
            _presetData: sortedItem._presetData, // Update preset metadata
          };
        }
        return procItem;
      });
      setProcessedItems(updatedProcessed);
    } else {
      // Initialize processedItems with categorized items
      setProcessedItems(items);
    }
    
    // Auto-save workflow state (Step 3 complete)
    autoSaveWorkflow({
      uploadedImages,
      groupedImages: items,
      sortedImages: items,
      processedItems,
    });

    // Broadcast action for real-time collaboration
  };

  const handleImagesGrouped = async (items: ClothingItem[]) => {
    // Preserve existing categories when updating groups
    const itemsWithCategories = items.map(item => {
      const existingItem = groupedImages.find(g => g.id === item.id);
      return existingItem?.category ? { ...item, category: existingItem.category } : item;
    });
    
    setGroupedImages(itemsWithCategories);
    
    // If we already have sorted images, update them with new grouping info
    if (sortedImages.length > 0) {
      // Merge new grouping info into sorted images
      const updatedSorted = itemsWithCategories.map(item => {
        const existingSorted = sortedImages.find(s => s.id === item.id);
        return existingSorted ? { ...item, category: existingSorted.category } : item;
      });
      setSortedImages(updatedSorted);
    }
    
    // Auto-save workflow state (Step 2 complete - groups created)
    autoSaveWorkflow({
      uploadedImages,
      groupedImages: itemsWithCategories,
      sortedImages,
      processedItems,
    });

    // Broadcast action for real-time collaboration

    // Auto-save product groups to database
    if (!user) return;

    // Find items that are in multi-item groups (productGroup is set and matches other items)
    const groupedItemsMap = items.reduce((acc, item) => {
      if (item.productGroup) {
        if (!acc[item.productGroup]) acc[item.productGroup] = [];
        acc[item.productGroup].push(item);
      }
      return acc;
    }, {} as Record<string, ClothingItem[]>);

    // Filter to only groups with 2+ items
    const multiItemGroups = Object.values(groupedItemsMap).filter(group => group.length > 1);
    
    // Flatten back to array of items in product groups
    const itemsToSave = multiItemGroups.flat();

    if (itemsToSave.length > 0) {
      try {
        const result = await saveBatchToDatabase(itemsToSave, user.id, currentBatchId);
        
        if (result.success > 0) {
          // Show brief success message
          setSaveMessage({
            type: 'success',
            text: `✅ Saved ${result.success} product group(s) to database!`,
          });
          setTimeout(() => setSaveMessage(null), 2000);
        }
      } catch (error) {
        console.error('Auto-save error:', error);
      }
    }
  };

  const handleItemsProcessed = (items: ClothingItem[]) => {
    setProcessedItems(items);
    
    // Auto-save workflow state
    autoSaveWorkflow({
      uploadedImages,
      groupedImages,
      sortedImages,
      processedItems: items,
    });

    // Broadcast action for real-time collaboration
  };

  // Auto-save workflow state to batch
  const autoSaveWorkflow = async (workflowState: {
    uploadedImages: ClothingItem[];
    groupedImages: ClothingItem[];
    sortedImages: ClothingItem[];
    processedItems: ClothingItem[];
  }) => {
    if (!user) return;
    
    try {
      const batchId = await autoSaveWorkflowBatch(
        currentBatchId,
        currentBatchNumber,
        workflowState
      );
      
      if (batchId && !currentBatchId) {
        // First time saving - set the batch ID
        setCurrentBatchId(batchId);
      }
    } catch (error) {
      console.error('Auto-save failed:', error);
    }
  };

  // Handle opening a batch from Library
  const handleOpenBatch = async (batch: WorkflowBatch) => {
    if (!batch.workflow_state) {
      alert('This batch has no saved workflow state.');
      return;
    }

    // Restore workflow state
    const { uploadedImages, groupedImages, sortedImages, processedItems } = batch.workflow_state;
    
    // Fetch saved products from database to restore descriptions
    try {
      const { data: savedProducts } = await supabase
        .from('products')
        .select(`
          *,
          product_images (
            image_url,
            position
          )
        `)
        .eq('batch_id', batch.id)
        .order('created_at', { ascending: true });
      
      // If no products found with this batch_id, try to find orphaned products
      // (products saved around the same time with image URLs matching this batch)
      let potentialOrphans: any[] = [];
      if (!savedProducts || savedProducts.length === 0) {
        // Get the batch creation time
        const batchCreatedAt = new Date(batch.created_at);
        const timeWindow = 24 * 60 * 60 * 1000; // 24 hours
        const startTime = new Date(batchCreatedAt.getTime() - timeWindow);
        const endTime = new Date(batchCreatedAt.getTime() + timeWindow);
        
        const { data: recentProducts } = await supabase
          .from('products')
          .select(`
            *,
            product_images (
              image_url,
              position
            )
          `)
          .gte('created_at', startTime.toISOString())
          .lte('created_at', endTime.toISOString())
          .order('created_at', { ascending: true });
        
        if (recentProducts && recentProducts.length > 0) {
          // Try to match by image URLs from processedItems
          const workflowImageUrls = new Set(processedItems?.map(item => item.preview) || []);
          
          potentialOrphans = recentProducts.filter((product: any) => {
            return product.product_images?.some((img: any) => 
              workflowImageUrls.has(img.image_url)
            );
          });
        }
      }
      
      const productsToUse = savedProducts && savedProducts.length > 0 ? savedProducts : potentialOrphans;
      
      // Merge saved data back into processedItems
      let restoredProcessedItems = processedItems;
      if (processedItems && productsToUse && productsToUse.length > 0) {
        restoredProcessedItems = processedItems.map((item: ClothingItem, index: number) => {
          // Try to match by seoTitle first (most reliable for our use case)
          let savedProduct = productsToUse.find((p: any) => 
            p.seo_title && item.seoTitle && p.seo_title.trim() === item.seoTitle.trim()
          );
          
          // Fallback: match by image URL (preview)
          if (!savedProduct && item.preview) {
            savedProduct = productsToUse.find((p: any) => 
              p.product_images?.some((img: any) => img.image_url === item.preview)
            );
          }
          
          // Fallback: match by position in batch (if all else fails)
          if (!savedProduct && index < productsToUse.length) {
            savedProduct = productsToUse[index];
          }
          
          if (savedProduct) {
            return {
              ...item,
              // Restore voice description and AI-generated description
              voiceDescription: savedProduct.voice_description || item.voiceDescription || '',
              generatedDescription: savedProduct.description || item.generatedDescription || '',
              // Also restore other fields that might have been edited
              seoTitle: savedProduct.seo_title || item.seoTitle,
              seoDescription: savedProduct.seo_description || item.seoDescription,
              tags: savedProduct.tags || item.tags,
            };
          }
          
          return item;
        });
      }
      
      if (uploadedImages) {
        setUploadedImages(uploadedImages);
      }
      if (groupedImages) {
        setGroupedImages(groupedImages);
      }
      if (sortedImages) {
        setSortedImages(sortedImages);
      }
      if (restoredProcessedItems) {
        setProcessedItems(restoredProcessedItems);
      }
    } catch (error) {
      console.error('Error restoring saved product data:', error);
      // Fallback to basic workflow state
      if (uploadedImages) setUploadedImages(uploadedImages);
      if (groupedImages) setGroupedImages(groupedImages);
      if (sortedImages) setSortedImages(sortedImages);
      if (processedItems) setProcessedItems(processedItems);
    }
    
    // Set current batch info
    setCurrentBatchId(batch.id);
    setCurrentBatchNumber(batch.batch_number);
    
    // Close library
    setShowLibrary(false);
    
    // Show success message
    const defaultName = `Batch ${new Date(batch.created_at).toLocaleDateString()} ${new Date(batch.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    const batchDisplayName = batch.batch_name || defaultName;
    setSaveMessage({
      type: 'success',
      text: `✅ Opened "${batchDisplayName}" - Continue from Step ${batch.current_step}`,
    });
    
    // Clear message after 5 seconds
    setTimeout(() => setSaveMessage(null), 5000);
  };

  return (
    <div className="app-container">
      {/* Real-time collaboration: Show cursors and activity of other users */}
      
      <header className="app-header">
        <div className="header-content">
          <div>
            <h1 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <ShoppingBag size={32} /> Sortbot - AI Clothing Sorting & Export
            </h1>
            <p className="header-subtitle">Upload, sort, describe, and export to Shopify</p>
          </div>
          <div className="header-actions">
            <button 
              onClick={() => setShowCategoriesManager(true)} 
              className="button button-secondary"
              style={{ marginRight: '12px', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
              title="Manage your product categories"
            >
              <Tag size={18} /> Manage Categories
            </button>
            <button 
              onClick={() => setShowCategoryPresets(true)} 
              className="button button-secondary"
              style={{ marginRight: '12px', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
              title="Manage category presets for shipping weight, measurements, and default attributes"
            >
              <Settings size={18} /> Category Presets
            </button>
            <button 
              onClick={() => setShowLibrary(true)} 
              className="button button-secondary"
              style={{ marginRight: '12px', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
              title="View saved workflow batches"
            >
              <Package size={18} /> Library
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
          <p className="step-description" style={{ fontSize: '14px', color: '#666', marginBottom: '1rem' }}>
            💡 <strong>Tip:</strong> You can upload multiple batches! New images will be added to your current session.
          </p>
          <ImageUpload onImagesUploaded={handleImagesUploaded} userId={user.id} />
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
                  <li>👆 <strong>Click to select/unselect</strong> (click again to deselect)</li>
                  <li>⌨️ <strong>Shift+Click</strong> to select multiple at once</li>
                  <li>🔗 <strong>Click "Group Selected"</strong> - works with 1+ images</li>
                  <li>✂️ <strong>Click "Ungroup Selected"</strong> - removes selected images from groups</li>
                  <li>🖱️ <strong>Drag photos</strong> between groups or to make them individual</li>
                  <li>🗑️ <strong>Click × button</strong> to delete unwanted images</li>
                </ul>
              </div>
            )}
            <p className="step-description">
              Click to select images, group them, and organize your products. All images are auto-uploaded to your database.
            </p>
            <ImageGrouper 
              items={groupedImages.length > 0 ? groupedImages : uploadedImages} 
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
              items={processedItems}
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

      {/* Categories Manager Modal */}
      {showCategoriesManager && (
        <CategoriesManager 
          onClose={() => setShowCategoriesManager(false)} 
        />
      )}

      {/* Category Presets Modal */}
      {showCategoryPresets && (
        <CategoryPresetsManager 
          onClose={() => setShowCategoryPresets(false)} 
        />
      )}

      {/* Library Modal */}
      {showLibrary && user && (
        <Library 
          userId={user.id} 
          onClose={() => setShowLibrary(false)}
          onOpenBatch={handleOpenBatch}
        />
      )}
    </div>
  );
}

export default App;
