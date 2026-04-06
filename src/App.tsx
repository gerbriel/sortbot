import { useState, useEffect, useRef } from 'react';
import { supabase } from './lib/supabase';
import type { User } from '@supabase/supabase-js';
import { Tag, Settings, Package, ShoppingBag, Link2, Scissors, X, Trash2 } from 'lucide-react';
import Auth from './components/Auth';
import ImageUpload from './components/ImageUpload';
import ImageGrouper from './components/ImageGrouper';
import type { GrouperActions } from './components/ImageGrouper';
import CategoryZones from './components/CategoryZones';
import ProductDescriptionGenerator from './components/ProductDescriptionGenerator';
import GoogleSheetExporter from './components/GoogleSheetExporter';
import type { GoogleSheetExporterHandle } from './components/GoogleSheetExporter';
import { Library } from './components/Library';
import CategoryPresetsManager from './components/CategoryPresetsManager';
import CategoriesManager from './components/CategoriesManager';
import { saveBatchToDatabase, getThumbnailUrl } from './lib/productService';
import { autoSaveWorkflowBatch, type WorkflowBatch } from './lib/workflowBatchService';
import type { BrandCategory } from './lib/brandCategorySystem';
import './App.css';

export interface ClothingItem {
  id: string;
  file: File;
  preview: string;
  thumbnailUrl?: string; // CDN URL with Supabase Storage transform (300px). Used for card display. Full-res URL in imageUrls[0].
  capturedAt?: number; // file.lastModified — used to sort by photo date
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
    width?: string;
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
  const [selectedGroupItems, setSelectedGroupItems] = useState<Set<string>>(new Set());
  const [grouperActions, setGrouperActions] = useState<GrouperActions | null>(null);
  const [showLibrary, setShowLibrary] = useState(false);
  // Ref mirror so the autoSave closure (inside setTimeout) can read the live value
  // without capturing a stale boolean from the render where autoSave was scheduled.
  const showLibraryRef = useRef(false);
  const [showCategoryPresets, setShowCategoryPresets] = useState(false);
  const [showCategoriesManager, setShowCategoriesManager] = useState(false);
  const [saving, setSaving] = useState(false);
  const [libraryRefreshTrigger, setLibraryRefreshTrigger] = useState(0);
  const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Ref to GoogleSheetExporter so Step 3 sidebar can trigger the download
  const exporterRef = useRef<GoogleSheetExporterHandle>(null);
  const [showStep2Info, setShowStep2Info] = useState(false);
  const [currentBatchId, setCurrentBatchId] = useState<string | null>(() => {
    // Restore batch ID from localStorage so reloads don't lose progress
    return localStorage.getItem('sortbot_current_batch_id') || null;
  });
  // Ref mirror so async callbacks always read the latest batchId without closure staleness
  const currentBatchIdRef = useRef<string | null>(localStorage.getItem('sortbot_current_batch_id') || null);
  // Guard: prevents handleOpenBatch from running twice simultaneously (React Strict Mode double-invoke)
  const isOpeningBatchRef = useRef(false);
  // Debounce timer for auto-save — prevents a PATCH on every rapid grouping action
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [currentBatchNumber, setCurrentBatchNumber] = useState<string>(() => {
    return localStorage.getItem('sortbot_current_batch_number') || `batch-${Date.now()}`;
  });

  // Keep showLibraryRef in sync so the autoSave closure always reads the live value
  useEffect(() => { showLibraryRef.current = showLibrary; }, [showLibrary]);

  // Register restored workflow items in products + product_images so Library sees them.
  // Called after startup restore and handleOpenBatch. No-ops if rows already exist.
  // Handles legacy items (pre-storagePath era) that only have imageUrls, and newer items
  // that have storagePath but may have empty imageUrls after restore.
  // forceUser: pass the session user explicitly when calling from startup restore, because
  // the `user` React state hasn't been set yet (setUser is async via onAuthStateChange).
  // IMPORTANT: must be defined BEFORE the auth useEffect([]) that calls it at startup.
  const registerItemsInDB = async (liveItems: ClothingItem[], batchId: string | null, forceUser?: User | null) => {
    const activeUser = forceUser ?? user;
    if (!activeUser || liveItems.length === 0) return;
    // Accept items that have either imageUrls[0] OR storagePath — covers both legacy and new items
    const registerable = liveItems.filter(i => i.imageUrls?.[0] || (i.storagePath && i.storagePath !== ''));
    const withStoragePath = registerable.filter(i => i.storagePath).length;
    const withImageUrls = registerable.filter(i => i.imageUrls?.[0]).length;
    console.log(`[App] registerItemsInDB | total=${liveItems.length} registerable=${registerable.length} withStoragePath=${withStoragePath} withImageUrls=${withImageUrls} | batchId=${batchId}`);
    if (registerable.length === 0) return;
    try {
      await supabase.from('products').upsert(
        registerable.map(item => ({
          id: item.id,
          user_id: activeUser.id,
          batch_id: batchId,
          title: item.seoTitle || null,
          status: 'Draft',
          product_group: item.productGroup || item.id,
        })),
        // ignoreDuplicates: false — allows updating batch_id on existing rows so products
        // are correctly attributed to the current batch when restored from a new session.
        { onConflict: 'id', ignoreDuplicates: false }
      );
      // Build product_images rows. For image_url: prefer imageUrls[0], fall back to getPublicUrl(storagePath).
      // storage_path may be null for legacy items — that's fine, the column is nullable.
      // Conflict key: (product_id, image_url) — matches the existing composite unique constraint.
      const productImageRows = registerable.flatMap((item, idx) => {
        const imageUrl = item.imageUrls?.[0] ||
          (item.storagePath
            ? supabase.storage.from('product-images').getPublicUrl(item.storagePath).data.publicUrl
            : null);
        if (!imageUrl) return []; // no image_url available at all — skip
        return [{
          image_url: imageUrl,
          storage_path: item.storagePath ?? null,
          product_id: item.id,
          user_id: activeUser.id,
          position: idx,
          alt_text: item.seoTitle || 'Uploaded image',
        }];
      });
      if (productImageRows.length > 0) {
        // Delete-then-insert strategy: wipe ALL product_images rows for the
        // products in this batch first, then insert the canonical set.
        // This prevents stale rows accumulating when image_url changes between
        // sessions (e.g. storage URL regenerated), which the upsert conflict key
        // can't catch — it only matches (product_id, image_url) exactly.
        // Chunk into groups of 100 to avoid PostgREST URL length limits (400 error)
        // that occur when passing hundreds of IDs in a single IN() clause.
        const productIds = registerable.map(i => i.id);
        const DELETE_CHUNK_SIZE = 100;
        for (let i = 0; i < productIds.length; i += DELETE_CHUNK_SIZE) {
          const chunk = productIds.slice(i, i + DELETE_CHUNK_SIZE);
          const { error: delErr } = await supabase
            .from('product_images')
            .delete()
            .in('product_id', chunk);
          if (delErr) {
            console.warn('[App] registerItemsInDB | product_images delete error:', delErr.message);
          }
        }
        console.log(`[App] registerItemsInDB | deleted old product_images for ${productIds.length} products`);

        const { error: imgErr, count: imgCount } = await supabase.from('product_images').insert(
          productImageRows,
          { count: 'exact' }
        );
        if (imgErr) {
          console.warn('[App] registerItemsInDB | product_images insert error:', imgErr.message, imgErr.code, imgErr.details);
        } else {
          console.log(`[App] registerItemsInDB | product_images insert OK | attempted=${productImageRows.length} affected=${imgCount}`);
        }
      }
      console.log(`[App] registerItemsInDB | registered ${registerable.length} products, ${productImageRows.length} product_images | batchId=${batchId}`);
    } catch (err) {
      console.error('[App] registerItemsInDB failed:', err);
    }
  };

  // Helper to determine current workflow step

  // Real-time presence tracking for collaborative viewing

  // Check authentication status on mount
  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      setUser(session?.user ?? null);
      setLoading(false);

      // Auto-restore last batch on page load so users don't lose progress on reload
      const savedBatchId = localStorage.getItem('sortbot_current_batch_id');
      if (savedBatchId && session?.user) {
        try {
          const { data: batch } = await supabase
            .from('workflow_batches')
            .select('*')
            .eq('id', savedBatchId)
            .maybeSingle(); // .single() throws a 406 when the row doesn't exist; .maybeSingle() returns null
          if (!batch) {
            // Batch was deleted — clear stale localStorage so we start fresh
            currentBatchIdRef.current = null;
            setCurrentBatchId(null);
            localStorage.removeItem('sortbot_current_batch_id');
            localStorage.removeItem('sortbot_current_batch_number');
          } else {
            // Batch exists — sync ref+state immediately regardless of workflow_state presence,
            // so any autoSave that fires in the next 2s updates this batch instead of creating a new orphan.
            console.log(`[App] startup restore | batch FOUND | batchId=${savedBatchId} | hasWorkflowState=${!!batch.workflow_state}`);
            currentBatchIdRef.current = savedBatchId;
            setCurrentBatchId(savedBatchId);

            if (batch.workflow_state) {
              const { uploadedImages, groupedImages, sortedImages, processedItems } = batch.workflow_state;
              // processedItems is now the single saved list (others are empty arrays).
              // Fall back through all arrays in case an older batch format is loaded.
              const rawItems =
                processedItems?.length  ? processedItems  :
                sortedImages?.length    ? sortedImages     :
                groupedImages?.length   ? groupedImages    :
                uploadedImages          ? uploadedImages   : [];
              // Re-hydrate preview — stripped before saving to reduce payload size.
              // imageUrls may also be empty for older items; reconstruct from storagePath
              // (synchronous, no extra DB query) as the final fallback.
              const liveItems = rawItems.map((item: any) => {
                const reconstructed = item.storagePath
                  ? supabase.storage.from('product-images').getPublicUrl(item.storagePath).data.publicUrl
                  : '';
                const thumbnailUrl = item.storagePath
                  ? getThumbnailUrl(item.storagePath, 300)
                  : (item.imageUrls?.[0] || reconstructed);
                return {
                  ...item,
                  preview: item.preview || item.imageUrls?.[0] || reconstructed,
                  imageUrls: item.imageUrls?.length ? item.imageUrls : (reconstructed ? [reconstructed] : []),
                  thumbnailUrl,
                };
              });
              if (liveItems.length) {
                console.log(`[App] startup restore | batchId=${savedBatchId} | items=${liveItems.length}`);
                setUploadedImages(liveItems);
                setGroupedImages(liveItems);
                setSortedImages(liveItems);
                setProcessedItems(liveItems);
                // Pass session.user explicitly — React `user` state hasn't been set yet at this point
                // (setUser(session.user) queues a re-render but doesn't run synchronously)
                registerItemsInDB(liveItems, savedBatchId, session.user);
              }
            }
          }
        } catch (err) {
          console.error('[App] startup restore CATCH — Error:', err);
          if (!currentBatchIdRef.current) {
            // Ref was never set — batch fetch itself failed, safe to clear stale localStorage
            setCurrentBatchId(null);
            localStorage.removeItem('sortbot_current_batch_id');
            localStorage.removeItem('sortbot_current_batch_number');
          }
          // If ref was already set, keep localStorage intact so next reload can retry
        }
      }
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
    localStorage.removeItem('sortbot_current_batch_id');
    localStorage.removeItem('sortbot_current_batch_number');
  };

  const handleSaveBatch = async () => {
    console.log(`[App] handleSaveBatch | processedItems=${processedItems.length} | batchId=${currentBatchId}`);
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

        // products/product_images rows were just written — prune stale rows then refresh Library
        console.log('[App] setLibraryRefreshTrigger → Save Batch (Step 4)');
        if (currentBatchId) {
          const savedIds = processedItems.map(i => i.id);
          const { error: pruneErr } = await supabase
            .from('products')
            .delete()
            .eq('batch_id', currentBatchId)
            .not('id', 'in', `(${savedIds.join(',')})`);
          if (pruneErr) console.warn('[App] handleSaveBatch | prune stale products error:', pruneErr.message);
        }
        setLibraryRefreshTrigger(prev => prev + 1);

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
    console.log(`[App] handleClearBatch | uploadedImages=${uploadedImages.length} | batchId=${currentBatchId}`);
    if (confirm('Are you sure you want to clear this batch? Unsaved products will be lost.')) {
      setProcessedItems([]);
      setGroupedImages([]);
      setSortedImages([]);
      setUploadedImages([]);
      setSaveMessage(null);
      // Clear persisted batch so reload starts fresh
      currentBatchIdRef.current = null;
      setCurrentBatchId(null);
      setCurrentBatchNumber(`batch-${Date.now()}`);
      localStorage.removeItem('sortbot_current_batch_id');
      localStorage.removeItem('sortbot_current_batch_number');
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

  const handleImagesUploaded = async (items: ClothingItem[]) => {
    console.log(`[App] handleImagesUploaded | newItems=${items.length} | totalAfter=${uploadedImages.length + items.length}`);
    // APPEND new images to existing ones (don't replace)
    const newImages = [...uploadedImages, ...items];
    setUploadedImages(newImages);

    // If this is the very first upload of a brand-new session (e.g. localStorage was cleared),
    // currentBatchIdRef.current will still be null and every autoSave would be skipped by the
    // null-guard below. Create and pin a new batch ID immediately so the debounced save fires.
    if (!currentBatchIdRef.current) {
      const newBatchId = crypto.randomUUID();
      currentBatchIdRef.current = newBatchId;
      setCurrentBatchId(newBatchId);
      localStorage.setItem('sortbot_current_batch_id', newBatchId);
      console.log(`[App] handleImagesUploaded | no batchId — created new batchId=${newBatchId}`);
    }
    
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

    // Write uploaded images to product_images immediately so Library stays in sync.
    // Step 1: upsert a stub products row (one per item — no group yet) so product_images FK is valid.
    // Step 2: upsert product_images rows linked to those products.
    const uploadedItems = items.filter(i => i.storagePath && i.imageUrls?.[0]);
    if (uploadedItems.length > 0 && user) {
      // Upsert stub products rows (keyed on id — the item's own id)
      await supabase.from('products').upsert(
        uploadedItems.map(item => ({
          id: item.id,
          user_id: user.id,
          batch_id: currentBatchIdRef.current,   // use ref — state may still be null this render
          title: item.seoTitle || null,
          status: 'Draft',
          product_group: item.productGroup || item.id,
        })),
        { onConflict: 'id', ignoreDuplicates: true }
      );
      // Upsert product_images rows; ignore duplicate rows (already uploaded)
      const { error: imgErr2 } = await supabase.from('product_images').upsert(
        uploadedItems.map((item, idx) => ({
          image_url: item.imageUrls![0],
          storage_path: item.storagePath!,
          product_id: item.id,
          user_id: user.id,
          position: idx,
          alt_text: item.seoTitle || 'Uploaded image',
        })),
        { onConflict: 'product_id,image_url', ignoreDuplicates: false }
      );
      if (imgErr2) {
        console.warn('[App] upload | product_images upsert error:', imgErr2.message, imgErr2.code);
      }
      // Refresh Library immediately — images are now in the DB
      console.log('[App] setLibraryRefreshTrigger → upload complete (Step 1)');
      setLibraryRefreshTrigger(prev => prev + 1);
    }
  };

  const handleImagesSorted = async (items: ClothingItem[]) => {
    console.log(`[App] handleImagesSorted | items=${items.length} | categories=${[...new Set(items.map(i => i.category).filter(Boolean))].join(', ')}`);
    setSortedImages(items);
    // Also update groupedImages so Step 2 shows the categories
    setGroupedImages(items);
    
    // Sync categories to processedItems (preserve voice descriptions if they exist)
    let finalProcessed: ClothingItem[];
    if (processedItems.length > 0) {
      // Update existing processedItems with new categories
      finalProcessed = processedItems.map(procItem => {
        const sortedItem = items.find(i => i.id === procItem.id);
        if (sortedItem) {
          return {
            ...procItem,
            category: sortedItem.category,
            _presetData: sortedItem._presetData,
          };
        }
        return procItem;
      });
      setProcessedItems(finalProcessed);
    } else {
      // Initialize processedItems with categorized items
      finalProcessed = items;
      setProcessedItems(items);
    }
    
    // Auto-save workflow state (Step 3 complete)
    autoSaveWorkflow({
      uploadedImages,
      groupedImages: items,
      sortedImages: items,
      processedItems: finalProcessed,
    });

    // Upsert category changes to products table immediately so Library reflects them
    if (user && currentBatchId) {
      const itemsWithCategory = items.filter(i => i.category);
      if (itemsWithCategory.length > 0) {
        await supabase.from('products').upsert(
          itemsWithCategory.map(item => ({
            id: item.id,
            product_category: item.category,
            product_group: item.productGroup || item.id,
            batch_id: currentBatchId,
            user_id: user.id,
          })),
          { onConflict: 'id', ignoreDuplicates: false }
        );
        setLibraryRefreshTrigger(prev => prev + 1);
      }
    }
  };

  const handleImagesGrouped = async (items: ClothingItem[]) => {
    const groups = new Set(items.map(i => i.productGroup).filter(Boolean));
    console.log(`[App] handleImagesGrouped | items=${items.length} | groups=${groups.size}`);
    // Preserve existing categories when updating groups
    const itemsWithCategories = items.map(item => {
      const existingItem = groupedImages.find(g => g.id === item.id);
      return existingItem?.category ? { ...item, category: existingItem.category } : item;
    });
    
    setGroupedImages(itemsWithCategories);

    // Keep uploadedImages in sync — remove any items that were deleted in Step 2
    const remainingIds = new Set(itemsWithCategories.map(i => i.id));
    const prunedUploaded = uploadedImages.filter(i => remainingIds.has(i.id));
    if (prunedUploaded.length !== uploadedImages.length) {
      console.log(`[App] handleImagesGrouped pruned uploadedImages | ${uploadedImages.length} → ${prunedUploaded.length}`);
      setUploadedImages(prunedUploaded);
    }
    
    // Sync sortedImages by FILTERING DOWN to only IDs still in itemsWithCategories,
    // then merging in the latest grouping state. This ensures Step-2 deletes propagate
    // to Steps 3 & 4 instead of re-inflating the old full set.
    const updatedSorted = sortedImages
      .filter(s => remainingIds.has(s.id))
      .map(s => {
        const grouped = itemsWithCategories.find(i => i.id === s.id);
        return grouped ? { ...s, ...grouped, category: s.category || grouped.category } : s;
      });
    // For items not yet in sortedImages (newly added), include them from itemsWithCategories
    const sortedIds = new Set(updatedSorted.map(s => s.id));
    const newItems = itemsWithCategories.filter(i => !sortedIds.has(i.id));
    const finalSorted = [...updatedSorted, ...newItems];

    console.log(`[App] handleImagesGrouped sortedImages | ${sortedImages.length} → ${finalSorted.length} | deleted=${sortedImages.length - finalSorted.length + newItems.length}`);
    setSortedImages(finalSorted);
    // Reset processedItems to the new grouping so Step 3 nav reflects current groups
    setProcessedItems(finalSorted);
    
    // Auto-save workflow state (Step 2 complete - groups created)
    autoSaveWorkflow({
      uploadedImages: prunedUploaded,
      groupedImages: itemsWithCategories,
      sortedImages: finalSorted,
      processedItems: finalSorted,
    });

    // Broadcast action for real-time collaboration

    // Auto-save product groups to database
    if (!user) return;

    // Upsert ALL items' products rows with their current productGroup so the Library
    // Groups tab stays in sync with every drag/group change in Step 2.
    // Accept items with imageUrls[0] OR storagePath (same as registerItemsInDB).
    const allRegisterable = itemsWithCategories.filter(i => i.imageUrls?.[0] || i.storagePath);
    if (allRegisterable.length > 0) {
      const { error: grpErr } = await supabase.from('products').upsert(
        allRegisterable.map(item => ({
          id: item.id,
          user_id: user.id,
          batch_id: currentBatchId,
          product_group: item.productGroup || item.id,
          title: item.seoTitle || null,
          status: 'Draft',
        })),
        { onConflict: 'id', ignoreDuplicates: false }
      );
      if (grpErr) {
        console.warn('[App] handleImagesGrouped | products upsert error:', grpErr.message);
      } else {
        // Prune any stale products rows for this batch that are no longer in the current item set.
        // This clears out orphaned rows from previous sessions / deleted items.
        const currentIds = allRegisterable.map(i => i.id);
        const { error: pruneErr } = await supabase
          .from('products')
          .delete()
          .eq('batch_id', currentBatchId)
          .not('id', 'in', `(${currentIds.join(',')})`);
        if (pruneErr) console.warn('[App] handleImagesGrouped | prune stale products error:', pruneErr.message);
        setLibraryRefreshTrigger(prev => prev + 1);
      }
    }
  };

  const handleItemsProcessed = (items: ClothingItem[]) => {
    console.log(`[App] handleItemsProcessed | items=${items.length}`);
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

  // Auto-save workflow state to batch (debounced — 2 s after last call)
  const autoSaveWorkflow = (workflowState: {
    uploadedImages: ClothingItem[];
    groupedImages: ClothingItem[];
    sortedImages: ClothingItem[];
    processedItems: ClothingItem[];
  }) => {
    if (!user) return;

    // Cancel any pending save
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);

    autoSaveTimerRef.current = setTimeout(async () => {
      // Guard: if session hasn't resolved yet (getSession().then() still in flight),
      // currentBatchIdRef.current will be null and we'd create a spurious new batch.
      // This happens when PDG mounts immediately and calls handleItemsProcessed before
      // getSession() completes. Safe to skip — the session resolving will trigger another
      // autoSave call with the correct batchId.
      if (!currentBatchIdRef.current) {
        console.log(`[App] autoSave SKIPPED — session not resolved yet (batchId ref null)`);
        return;
      }
      console.log(`[App] autoSave fired | batchId=${currentBatchIdRef.current} | items=${
        workflowState.processedItems.length || workflowState.sortedImages.length || workflowState.groupedImages.length || workflowState.uploadedImages.length
      }`);
      // Strip only runtime-only fields (File objects, blob URLs, preset cache) before saving.
      // generatedDescription and voiceDescription ARE kept so export works after a page reload
      // without requiring a separate DB fetch.
      const slim = (items: ClothingItem[]): ClothingItem[] =>
        items.map(({ file: _f, preview: _p, _presetData: _pr, ...rest }) => rest as ClothingItem);

      // Only persist ONE list — the most progressed one — to avoid 4x duplication.
      // On restore, all four arrays are set from this single list.
      const live =
        workflowState.processedItems.length > 0 ? workflowState.processedItems :
        workflowState.sortedImages.length    > 0 ? workflowState.sortedImages    :
        workflowState.groupedImages.length   > 0 ? workflowState.groupedImages   :
        workflowState.uploadedImages;

      const safeState = {
        uploadedImages: [] as ClothingItem[],
        groupedImages:  [] as ClothingItem[],
        sortedImages:   [] as ClothingItem[],
        processedItems: slim(live),
      };

      try {
        // Use ref so we always get the latest batchId regardless of closure age
        const batchId = await autoSaveWorkflowBatch(
          currentBatchIdRef.current,
          currentBatchNumber,
          safeState
        );

        if (batchId && batchId !== currentBatchIdRef.current) {
          // First save OR old batch was deleted and a new one was created
          currentBatchIdRef.current = batchId;
          setCurrentBatchId(batchId);
          localStorage.setItem('sortbot_current_batch_id', batchId);
          localStorage.setItem('sortbot_current_batch_number', currentBatchNumber);
        }
        // NOTE: No Library refresh here — auto-save only writes to workflow_state,
        // NOT to products/product_images. The Library re-fetches on real DB changes only
        // (explicit Save Batch or image delete), preventing the auto-save → loadAll loop.
      } catch (error) {
        console.error('Auto-save failed:', error);
      }
    }, 2000); // wait 2 s of inactivity before hitting Supabase
  };

  // Register restored workflow items in products + product_images so Library sees them.
  // Called after startup restore and handleOpenBatch. No-ops if rows already exist.
  // Handles legacy items (pre-storagePath era) that only have imageUrls, and newer items
  // that have storagePath but may have empty imageUrls after restore.
  // forceUser: pass the session user explicitly when calling from startup restore, because
  // the `user` React state hasn't been set yet (setUser is async via onAuthStateChange).
  // Handle opening a batch from Library
  const handleOpenBatch = async (batch: WorkflowBatch) => {
    // Guard against double-fire (React Strict Mode, or rapid double-click)
    if (isOpeningBatchRef.current) {
      console.log(`[App] handleOpenBatch SKIPPED — already in progress | batchId=${batch.id}`);
      return;
    }
    isOpeningBatchRef.current = true;
    try {
    console.log(`[App] handleOpenBatch | batchId=${batch.id} | batchName="${batch.batch_name}" | step=${batch.current_step}`);
    // ── Clear ALL current state first so nothing from the active session bleeds in ──
    setUploadedImages([]);
    setGroupedImages([]);
    setSortedImages([]);
    setProcessedItems([]);

    // Restore workflow state
    const { uploadedImages, groupedImages, sortedImages, processedItems } = batch.workflow_state ?? {};

    // processedItems is now the single saved list (others are empty arrays in new format).
    // Fall back through all arrays for older batch formats.
    // Cast as ClothingItem[] — SlimItems have the same fields minus file/preview (which are runtime-only anyway).
    const rawWorkflowItems = (
      processedItems?.length  ? processedItems  :
      sortedImages?.length    ? sortedImages     :
      groupedImages?.length   ? groupedImages    :
      uploadedImages?.length  ? uploadedImages   : []
    ) as ClothingItem[];

    // Re-hydrate preview — stripped before saving to reduce payload size.
    // imageUrls may also be empty for older items; reconstruct from storagePath
    // (synchronous, no extra DB query) as the final fallback.
    // thumbnailUrl: Supabase Storage transform (300px) — used by ImageGrouper/PDG card display.
    // Falls back to full-res URL for legacy items that lack storagePath.
    const workflowItems: ClothingItem[] = rawWorkflowItems.map(item => {
      const reconstructed = item.storagePath
        ? supabase.storage.from('product-images').getPublicUrl(item.storagePath).data.publicUrl
        : '';
      const thumbnailUrl = item.storagePath
        ? getThumbnailUrl(item.storagePath, 300)
        : (item.imageUrls?.[0] || reconstructed);
      return {
        ...item,
        preview: item.preview || item.imageUrls?.[0] || reconstructed,
        imageUrls: item.imageUrls?.length ? item.imageUrls : (reconstructed ? [reconstructed] : []),
        thumbnailUrl,
      };
    });
    
    // Set state immediately from workflow_state so images render right away.
    // DB product descriptions will merge in after the fetch below.
    if (workflowItems.length > 0) {
      setUploadedImages(workflowItems);
      setGroupedImages(workflowItems);
      setSortedImages(workflowItems);
      setProcessedItems(workflowItems);
    }

    // Fetch saved products from database to restore descriptions
    // Hoisted so registerItemsInDB (called after try/catch) can always access the final items.
    let restoredProcessedItems: ClothingItem[] = workflowItems;
    try {
      const fullProductSelect = `
        id,
        title,
        url_handle,
        description,
        vendor,
        product_category,
        product_type,
        tags,
        published,
        status,
        size,
        color,
        secondary_color,
        price,
        compare_at_price,
        cost_per_item,
        sku,
        barcode,
        inventory_quantity,
        weight_value,
        requires_shipping,
        continue_selling_out_of_stock,
        package_dimensions,
        parcel_size,
        ships_from,
        condition,
        flaws,
        material,
        era,
        care_instructions,
        measurements,
        model_name,
        model_number,
        size_type,
        style,
        gender,
        age_group,
        policies,
        renewal_options,
        who_made_it,
        what_is_it,
        listing_type,
        discounted_shipping,
        mpn,
        custom_label_0,
        seo_title,
        seo_description,
        voice_description,
        batch_id,
        product_group,
        created_at,
        product_images (
          image_url,
          position
        )
      `;

      const { data: savedProducts } = await supabase
        .from('products')
        .select(fullProductSelect)
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
          .select(fullProductSelect)
          .gte('created_at', startTime.toISOString())
          .lte('created_at', endTime.toISOString())
          .order('created_at', { ascending: true });
        
        if (recentProducts && recentProducts.length > 0) {
          // Try to match by image URLs from workflowItems
          const workflowImageUrls = new Set(workflowItems.map(item => item.preview).filter(Boolean));
          
          potentialOrphans = recentProducts.filter((product: any) => {
            return product.product_images?.some((img: any) => 
              workflowImageUrls.has(img.image_url)
            );
          });
        }
      }
      
      const productsToUse = savedProducts && savedProducts.length > 0 ? savedProducts : potentialOrphans;
      
      // Always derive baseItems from the most-progressed single list (workflowItems),
      // not from the stale individual arrays. This handles both the new single-list
      // format and old multi-array formats via the fallback chain above.
      // When there is NO workflow_state at all, reconstruct ClothingItems from DB products.
      let baseItems: ClothingItem[] = workflowItems;

      if (baseItems.length === 0 && productsToUse && productsToUse.length > 0) {
        // No workflow_state — build items from the DB products table
        baseItems = productsToUse.map((p: any): ClothingItem => {
          const images: string[] = (p.product_images || [])
            .sort((a: any, b: any) => a.position - b.position)
            .map((img: any) => img.image_url)
            .filter(Boolean);
          return {
            id: p.id,
            preview: images[0] || '',
            imageUrls: images,
            file: null as any,
            productGroup: p.product_group || p.id,
            voiceDescription:          p.voice_description   || '',
            generatedDescription:      p.description         || '',
            seoTitle:                  p.seo_title           || '',
            seoDescription:            p.seo_description     || '',
            tags:                      p.tags                || [],
            brand:                     p.vendor              || '',
            category:                  p.product_category    || '',
            productType:               p.product_type        || '',
            published:                 p.published           ?? true,
            status:                    p.status              || 'active',
            size:                      p.size                || '',
            color:                     p.color               || '',
            secondaryColor:            p.secondary_color     || '',
            price:                     p.price               ?? undefined,
            compareAtPrice:            p.compare_at_price    ?? undefined,
            costPerItem:               p.cost_per_item       ?? undefined,
            sku:                       p.sku                 || '',
            barcode:                   p.barcode             || '',
            inventoryQuantity:         p.inventory_quantity  ?? undefined,
            weightValue:               p.weight_value        || '',
            requiresShipping:          p.requires_shipping   ?? true,
            continueSellingOutOfStock: p.continue_selling_out_of_stock ?? false,
            packageDimensions:         p.package_dimensions  || '',
            parcelSize:                p.parcel_size         || '',
            shipsFrom:                 p.ships_from          || '',
            condition:                 p.condition           || '',
            flaws:                     p.flaws               || '',
            material:                  p.material            || '',
            era:                       p.era                 || '',
            care:                      p.care_instructions   || '',
            measurements:              p.measurements        || {},
            modelName:                 p.model_name          || '',
            modelNumber:               p.model_number        || '',
            sizeType:                  p.size_type           || '',
            style:                     p.style               || '',
            gender:                    (p.gender             || '') as any,
            ageGroup:                  p.age_group           || '',
            policies:                  p.policies            || '',
            renewalOptions:            p.renewal_options     || '',
            whoMadeIt:                 p.who_made_it         || '',
            whatIsIt:                  p.what_is_it          || '',
            listingType:               p.listing_type        || '',
            discountedShipping:        p.discounted_shipping || '',
            mpn:                       p.mpn                 || '',
            customLabel0:              p.custom_label_0      || '',
          };
        });
      }

      // Merge saved data back into processedItems
      restoredProcessedItems = baseItems;
      if (baseItems.length > 0 && productsToUse && productsToUse.length > 0) {
        restoredProcessedItems = baseItems.map((item: ClothingItem, index: number) => {
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
            // DB row wins — it was written by an explicit Save which is authoritative.
            // workflow_state (item) is the fallback for fields not yet in the DB.
            // Reconstruct imageUrls from DB product_images rows if the workflow_state
            // item's imageUrls are empty (slim() strips them before saving).
            const dbImageUrls: string[] = (savedProduct.product_images || [])
              .sort((a: any, b: any) => a.position - b.position)
              .map((img: any) => img.image_url)
              .filter(Boolean);
            const resolvedImageUrls = dbImageUrls.length ? dbImageUrls : (item.imageUrls?.length ? item.imageUrls : []);
            const resolvedPreview = resolvedImageUrls[0] || item.preview ||
              (item.storagePath ? supabase.storage.from('product-images').getPublicUrl(item.storagePath).data.publicUrl : '');
            return {
              ...item,
              // Images — must be set before any other field that depends on them
              imageUrls: resolvedImageUrls,
              preview:   resolvedPreview,
              // Core
              productGroup:             savedProduct.product_group       || item.productGroup       || item.id,
              voiceDescription:         savedProduct.voice_description   ?? item.voiceDescription   ?? '',
              generatedDescription:     savedProduct.description         ?? item.generatedDescription ?? '',
              seoTitle:                 savedProduct.seo_title           || item.seoTitle,
              seoDescription:           savedProduct.seo_description     || item.seoDescription,
              tags:                     savedProduct.tags?.length        ? savedProduct.tags        : (item.tags || []),
              // Shopify fields
              brand:                    savedProduct.vendor              || item.brand,
              category:                 savedProduct.product_category    || item.category,
              productType:              savedProduct.product_type        || item.productType,
              published:                savedProduct.published           ?? item.published,
              status:                   savedProduct.status              || item.status,
              // Variants
              size:                     savedProduct.size                || item.size,
              color:                    savedProduct.color               || item.color,
              secondaryColor:           savedProduct.secondary_color     || item.secondaryColor,
              // Pricing
              price:                    savedProduct.price               ?? item.price,
              compareAtPrice:           savedProduct.compare_at_price    ?? item.compareAtPrice,
              costPerItem:              savedProduct.cost_per_item       ?? item.costPerItem,
              // Inventory
              sku:                      savedProduct.sku                 || item.sku,
              barcode:                  savedProduct.barcode             || item.barcode,
              inventoryQuantity:        savedProduct.inventory_quantity  ?? item.inventoryQuantity,
              // Shipping
              weightValue:              savedProduct.weight_value        || item.weightValue,
              requiresShipping:         savedProduct.requires_shipping   ?? item.requiresShipping,
              continueSellingOutOfStock:savedProduct.continue_selling_out_of_stock ?? item.continueSellingOutOfStock,
              packageDimensions:        savedProduct.package_dimensions  || item.packageDimensions,
              parcelSize:               savedProduct.parcel_size         || item.parcelSize,
              shipsFrom:                savedProduct.ships_from          || item.shipsFrom,
              // Details
              condition:                savedProduct.condition           || item.condition,
              flaws:                    savedProduct.flaws               || item.flaws,
              material:                 savedProduct.material            || item.material,
              era:                      savedProduct.era                 || item.era,
              care:                     savedProduct.care_instructions   || item.care,
              measurements:             savedProduct.measurements        || item.measurements,
              modelName:                savedProduct.model_name          || item.modelName,
              modelNumber:              savedProduct.model_number        || item.modelNumber,
              // Classification
              sizeType:                 savedProduct.size_type           || item.sizeType,
              style:                    savedProduct.style               || item.style,
              gender:                   savedProduct.gender              || item.gender,
              ageGroup:                 savedProduct.age_group           || item.ageGroup,
              // Policies
              policies:                 savedProduct.policies            || item.policies,
              renewalOptions:           savedProduct.renewal_options     || item.renewalOptions,
              whoMadeIt:                savedProduct.who_made_it         || item.whoMadeIt,
              whatIsIt:                 savedProduct.what_is_it          || item.whatIsIt,
              listingType:              savedProduct.listing_type        || item.listingType,
              discountedShipping:       savedProduct.discounted_shipping || item.discountedShipping,
              // Marketing
              mpn:                      savedProduct.mpn                 || item.mpn,
              customLabel0:             savedProduct.custom_label_0      || item.customLabel0,
            };
          }
          
          return item;
        });
      }
      
      // Set all 4 arrays from the single restored list so every step stays in sync.
      console.log(`[App] handleOpenBatch RESTORED | items=${restoredProcessedItems.length} | fromDB=${productsToUse?.length ?? 0} | fromWorkflowState=${workflowItems.length}`);
      setUploadedImages(restoredProcessedItems);
      setGroupedImages(restoredProcessedItems);
      setSortedImages(restoredProcessedItems);
      setProcessedItems(restoredProcessedItems);
    } catch (error) {
      console.error('Error restoring saved product data:', error);
      // Fallback to basic workflow state — restoredProcessedItems stays as workflowItems (hoisted default)
      setUploadedImages(workflowItems);
      setGroupedImages(workflowItems);
      setSortedImages(workflowItems);
      setProcessedItems(workflowItems);
    }

    // Register items in DB so Library sees them — outside the product-data try/catch so
    // registerItemsInDB errors surface separately and don't get silently swallowed above.
    // restoredProcessedItems is always populated (either merged DB data or workflowItems fallback).
    // Skip if this batch is already the active one — avoids wasteful delete-then-insert on re-open.
    if (batch.id !== currentBatchIdRef.current) {
      await registerItemsInDB(restoredProcessedItems, batch.id);
    } else {
      console.log(`[App] handleOpenBatch | registerItemsInDB SKIPPED — batch already active | batchId=${batch.id}`);
    }

    // Sync product_group values from workflow_state → DB immediately after restore.
    // registerItemsInDB uses ignoreDuplicates:false but doesn't fire if rows already exist
    // with the same id (it only upserts, not updates-all-fields). This targeted pass
    // ensures every row's product_group reflects the live session state.
    if (user) {
      const registerable = restoredProcessedItems.filter(i => i.imageUrls?.[0] || i.storagePath);
      if (registerable.length > 0) {
        const { error: pgErr } = await supabase.from('products').upsert(
          registerable.map(item => ({
            id: item.id,
            user_id: user.id,
            batch_id: batch.id,
            product_group: item.productGroup || item.id,
            title: item.seoTitle || null,
            status: 'Draft',
          })),
          { onConflict: 'id', ignoreDuplicates: false }
        );
        if (pgErr) console.warn('[App] handleOpenBatch | product_group sync upsert error:', pgErr.message);
        else console.log(`[App] handleOpenBatch | synced product_group for ${registerable.length} items`);
      }
    }
    // Set current batch info and persist for reload survival
    currentBatchIdRef.current = batch.id;
    setCurrentBatchId(batch.id);
    setCurrentBatchNumber(batch.batch_number);
    localStorage.setItem('sortbot_current_batch_id', batch.id);
    localStorage.setItem('sortbot_current_batch_number', batch.batch_number);
    
    // Close library and refresh it so new registrations are visible next open
    setShowLibrary(false);
    setLibraryRefreshTrigger(prev => prev + 1);
    
    // Show success message
    const defaultName = `Batch ${new Date(batch.created_at).toLocaleDateString()} ${new Date(batch.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    const batchDisplayName = batch.batch_name || defaultName;
    setSaveMessage({
      type: 'success',
      text: `✅ Opened "${batchDisplayName}" - Continue from Step ${batch.current_step}`,
    });
    
    // Clear message after 5 seconds
    setTimeout(() => setSaveMessage(null), 5000);

    // Release the guard so the next open can proceed
    isOpeningBatchRef.current = false;
  } finally {
    isOpeningBatchRef.current = false;
  }
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

        {/* Steps 2 & 3 Combined: Group Images + Drag to Categories */}
        {uploadedImages.length > 0 && (
          <section className="step-section">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <h2>Step 2: Group & Categorize</h2>
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
                  <li>🖱️ <strong>Drag photos</strong> onto a group card to add them to that group</li>
                  <li>🏷️ <strong>Drag a group card</strong> onto a category (right panel) to categorize it</li>
                  <li>🗑️ <strong>Click × button</strong> to delete unwanted images</li>
                </ul>
              </div>
            )}
            {/* Split pane: ImageGrouper left, CategoryZones right */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: '1fr 340px',
              gap: '1.5rem',
              alignItems: 'start',
            }} className="step2-split">
              {/* Left: Group images — scrollable panel so page doesn't grow tall */}
              <div style={{ maxHeight: '75vh', overflowY: 'auto', borderRadius: '8px' }}>
                <p className="step-description" style={{ marginTop: 0 }}>
                  Select &amp; group your product images, then drag groups to a category on the right.
                </p>
                <ImageGrouper 
                  items={groupedImages.length > 0 ? groupedImages : uploadedImages} 
                  onGrouped={handleImagesGrouped}
                  onStatsChange={() => {}} // stats now computed directly from processedItems
                  userId={user.id}
                  onImageDeleted={() => {
                    console.log('[App] setLibraryRefreshTrigger → image deleted (Step 2)');
                    setLibraryRefreshTrigger(prev => prev + 1);
                  }}
                  onSelectionChange={setSelectedGroupItems}
                  onActionsReady={setGrouperActions}
                />
              </div>
              {/* Right: Category drop zones — sticky so always visible */}
              <div style={{ position: 'sticky', top: '1rem' }}>
                <p className="step-description" style={{ marginTop: 0 }}>
                  Drag a group here to assign a category.
                </p>
                <CategoryZones 
                  items={groupedImages.length > 0 ? groupedImages : uploadedImages}
                  onCategorized={handleImagesSorted}
                  compactMode
                  selectedItemIds={selectedGroupItems}
                  onCategoryAssigned={() => setSelectedGroupItems(new Set())}
                />
                {/* Selection action buttons — rendered here so they stay visible while scrolling left panel */}
                {grouperActions && (
                  <div className="grouper-actions-sidebar">
                    <button
                      className="button button-primary"
                      onClick={grouperActions.groupSelected}
                      disabled={grouperActions.selectedCount < 2}
                      style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                    >
                      <Link2 size={16} /> Group Selected ({grouperActions.selectedCount})
                    </button>
                    <button
                      className="button button-secondary"
                      onClick={grouperActions.ungroupSelected}
                      disabled={grouperActions.selectedCount === 0}
                      title="Remove selected images from their groups"
                      style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                    >
                      <Scissors size={16} /> Ungroup Selected
                    </button>
                    <button
                      className="button button-secondary"
                      onClick={grouperActions.clearSelection}
                      disabled={grouperActions.selectedCount === 0}
                      style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                    >
                      <X size={16} /> Clear Selection
                    </button>
                    <button
                      className="button"
                      onClick={grouperActions.deleteSelected}
                      disabled={grouperActions.selectedCount === 0}
                      style={{
                        display: 'flex', alignItems: 'center', gap: '0.5rem',
                        background: grouperActions.selectedCount > 0 ? '#ef4444' : undefined,
                        color: grouperActions.selectedCount > 0 ? '#fff' : undefined,
                        border: 'none',
                      }}
                      title="Permanently delete all selected images"
                    >
                      <Trash2 size={16} /> Delete Selected ({grouperActions.selectedCount})
                    </button>
                  </div>
                )}
              </div>
            </div>
          </section>
        )}

        {/* Step 3: Add Descriptions */}
        {sortedImages.length > 0 && (
          <section className="step-section">
            <h2>Step 3: Add Voice Descriptions & Generate Product Info</h2>
            {(() => {
              // Always compute from processedItems — same source PDG uses for navigation.
              // grouperStats (from ImageGrouper) can diverge from processedItems when
              // groupedImages and processedItems are briefly out of sync.
              const groupMap: Record<string, number> = {};
              processedItems.forEach(i => { const k = i.productGroup || i.id; groupMap[k] = (groupMap[k] || 0) + 1; });
              const multiGroups = Object.values(groupMap).filter(c => c > 1).length;
              const singles = Object.values(groupMap).filter(c => c === 1).length;
              const totalListings = multiGroups + singles;
              const imageCount = processedItems.length;

              if (multiGroups > 0 && singles > 0) {
                return (
                  <p style={{ color: '#6366f1', fontWeight: 500, marginBottom: '0.5rem', fontSize: '0.9rem' }}>
                    📦 {totalListings} total listing{totalListings !== 1 ? 's' : ''}: {multiGroups} multi-image group{multiGroups !== 1 ? 's' : ''} + {singles} single{singles !== 1 ? 's' : ''} ({imageCount} images) — use Next/Previous to navigate
                  </p>
                );
              } else if (multiGroups > 0) {
                return (
                  <p style={{ color: '#6366f1', fontWeight: 500, marginBottom: '0.5rem', fontSize: '0.9rem' }}>
                    📦 {multiGroups} product group{multiGroups !== 1 ? 's' : ''} ({imageCount} images grouped) — use Next/Previous to navigate listings
                  </p>
                );
              } else {
                return (
                  <p style={{ color: '#888', fontSize: '0.85rem', marginBottom: '0.5rem' }}>
                    ⚠️ {singles} image{singles !== 1 ? 's' : ''} — each is its own listing. Go back to Step 2 to group multi-image products.
                  </p>
                );
              }
            })()}
            <ProductDescriptionGenerator
              key={currentBatchId ?? 'new'}
              items={processedItems}
              onProcessed={handleItemsProcessed}
              onDownloadCSV={() => exporterRef.current?.downloadCSV()}
              batchId={currentBatchId}
            />
          </section>
        )}

        {/* Step 4: Save & Export */}
        {processedItems.length > 0 && (
          <section className="step-section">
            <details>
              <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '1.1rem', userSelect: 'none', padding: '0.25rem 0' }}>
                Step 4: Review &amp; Export ▾
              </summary>

              <div style={{ marginTop: '1rem' }}>
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
                  <GoogleSheetExporter ref={exporterRef} items={processedItems} />
                </div>
              </div>
            </details>
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
          refreshTrigger={libraryRefreshTrigger}
        />
      )}
    </div>
  );
}

export default App;
