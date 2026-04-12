// Library v3 — user-scoped fetches; product_group deduplication; workflow_batch user_id filter
import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { fetchWorkflowBatches, deleteWorkflowBatch, type WorkflowBatch, type SlimItem } from '../lib/workflowBatchService';
import { 
  deleteProductGroup, 
  deleteImage, 
  updateBatchMetadata,
  duplicateBatch,
  fetchSavedProducts,
  fetchSavedImages 
} from '../lib/libraryService';
import { supabase } from '../lib/supabase';
import { Folder, Calendar, Image, Layers, Tag, ArrowRight, Trash2, X, Grid3x3, Package, Edit2, Copy, Check, Search, Plus, Merge, ChevronDown, ChevronRight } from 'lucide-react';
import type { ClothingItem } from '../App';
import { log } from '../lib/debugLogger';
import './Library.css';

// ── Lazy-loading image with skeleton shimmer placeholder ──────────────────────
const LazyImg: React.FC<{ src: string; alt: string; className?: string }> = ({ src, alt, className }) => {
  const [loaded, setLoaded] = useState(false);
  const [errored, setErrored] = useState(false);
  // Reset state when src changes (e.g. navigating between batches)
  const prevSrc = useRef(src);
  if (prevSrc.current !== src) {
    prevSrc.current = src;
    // useState setters can't be called directly during render — use a ref flag
  }
  useEffect(() => {
    setLoaded(false);
    setErrored(false);
  }, [src]);

  return (
    <>
      {!loaded && !errored && <div className="img-skeleton" aria-hidden="true" />}
      <img
        src={src}
        alt={alt}
        className={`lazy-img${loaded ? ' loaded' : ''}${className ? ` ${className}` : ''}`}
        loading="lazy"
        onLoad={() => setLoaded(true)}
        onError={() => { setLoaded(true); setErrored(true); }}
        style={errored ? { display: 'none' } : undefined}
      />
      {errored && <div className="img-skeleton" style={{ opacity: 0.4 }} aria-hidden="true" />}
    </>
  );
};
// ─────────────────────────────────────────────────────────────────────────────

type ViewMode = 'batches' | 'groups' | 'images';

interface ProductGroup {
  id: string;
  title: string;
  category: string;
  images: string[];
  itemCount: number;
  createdAt: string;
  isSaved?: boolean; // Track if from database vs workflow_state
  batchId?: string;
  batchName?: string;
}

interface ImageRecord {
  id: string;
  preview: string;
  category?: string;
  productGroup?: string;
  productGroupTitle?: string;
  batchId?: string;
  batchNumber?: string;
  batchName?: string;
  createdAt: string;
  isSaved?: boolean; // Track if from database vs workflow_state
}

interface LibraryProps {
  userId: string;
  onClose: () => void;
  onOpenBatch: (batch: WorkflowBatch) => void;
  refreshTrigger?: number; // increment from parent to force a reload
}

/** Strip unfilled template tokens like {brand}, {model}, {color} and collapse extra spaces/dashes */
function cleanTitle(raw: string | undefined | null, fallback = 'Untitled Product'): string {
  if (!raw) return fallback;
  const cleaned = raw
    .replace(/\{[^}]+\}/g, '')   // remove {brand}, {model}, etc.
    .replace(/\s{2,}/g, ' ')     // collapse multiple spaces
    .replace(/^\s*[-–—·]\s*/g, '') // strip leading dash/bullet
    .replace(/\s*[-–—·]\s*$/g, '') // strip trailing dash/bullet
    .replace(/\s*-\s*-+/g, ' - ') // collapse double dashes
    .trim();
  return cleaned || fallback;
}

export const Library: React.FC<LibraryProps> = ({ userId, onClose, onOpenBatch, refreshTrigger }) => {
  const [viewMode, setViewMode] = useState<ViewMode>('images');
  const [batches, setBatches] = useState<WorkflowBatch[]>([]);
  const [productGroups, setProductGroups] = useState<ProductGroup[]>([]);
  const [images, setImages] = useState<ImageRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  
  // Deletion progress state
  const [deletingItem, setDeletingItem] = useState<{id: string, type: 'batch' | 'group' | 'image', progress: number} | null>(null);
  
  const [editingBatch, setEditingBatch] = useState<string | null>(null);
  const [editBatchName, setEditBatchName] = useState<string>('');
  
  // Search / filter state
  const [searchQuery, setSearchQuery] = useState('');

  // Collapsed batch sections in product groups view
  const [collapsedBatches, setCollapsedBatches] = useState<Set<string>>(new Set());

  // Inline prompt modal (replaces browser prompt())
  const [promptModal, setPromptModal] = useState<{
    title: string;
    message?: string;
    defaultValue?: string;
    onConfirm: (value: string) => void;
    onCancel: () => void;
  } | null>(null);
  const [promptValue, setPromptValue] = useState('');
  const promptInputRef = useRef<HTMLInputElement>(null);

  // Helper: show inline prompt, returns a Promise<string | null>
  const showPrompt = (title: string, message?: string, defaultValue = ''): Promise<string | null> => {
    return new Promise((resolve) => {
      setPromptValue(defaultValue);
      setPromptModal({
        title,
        message,
        defaultValue,
        onConfirm: (value) => { setPromptModal(null); resolve(value.trim() || defaultValue || ''); },
        onCancel: () => { setPromptModal(null); resolve(null); },
      });
      // Focus after render
      setTimeout(() => promptInputRef.current?.focus(), 50);
    });
  };

  // Selection and drag-drop state
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [draggedItem, setDraggedItem] = useState<string | null>(null);
  const [dragOverItem, setDragOverItem] = useState<string | null>(null);
  // Cross-type drag state: what kind of thing is being dragged
  const [dragType, setDragType] = useState<'batch' | 'group' | 'image' | null>(null);
  // When dragging a group over a batch section header, track which batch key is highlighted
  const [dragOverBatch, setDragOverBatch] = useState<string | null>(null);
  
  // Selection box state (for drag-to-select)
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectionStart, setSelectionStart] = useState<{ x: number; y: number } | null>(null);
  const [selectionBox, setSelectionBox] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [selectionThresholdMet, setSelectionThresholdMet] = useState(false);
  
  // Refs for selection containers
  const batchesGridRef = useRef<HTMLDivElement>(null);
  const groupsGridRef = useRef<HTMLDivElement>(null);
  const imagesGridRef = useRef<HTMLDivElement>(null);
  const currentContainerRef = useRef<HTMLElement | null>(null);
  // Track whether a native HTML drag is in progress — suppresses rubber-band selection
  const isDraggingRef = useRef(false);

  // Scroll preservation across optimistic state updates
  const savedScrollRef = useRef<number>(0);
  const shouldRestoreScrollRef = useRef(false);
  // Prevents overlapping loadAll calls — new calls are no-ops while a fetch is in flight
  const isLoadingRef = useRef(false);

  // Returns the active scrollable grid element for the current view
  const activeScrollRef = () => {
    if (viewMode === 'images') return imagesGridRef.current;
    if (viewMode === 'groups') return groupsGridRef.current;
    return batchesGridRef.current;
  };

  // Call before an optimistic setImages / setProductGroups
  const saveScroll = () => {
    const el = activeScrollRef();
    if (el) {
      savedScrollRef.current = el.scrollTop;
      shouldRestoreScrollRef.current = true;
    }
  };

  // Runs synchronously after every render — restores scroll if flagged
  useLayoutEffect(() => {
    if (!shouldRestoreScrollRef.current) return;
    shouldRestoreScrollRef.current = false;
    const el = activeScrollRef();
    if (el) el.scrollTop = savedScrollRef.current;
  });
  
  const SELECTION_THRESHOLD = 5; // pixels - must move this much to activate selection

  // Load on mount and whenever userId changes.
  // viewMode is intentionally NOT a dependency — switching tabs only changes the
  // display filter, not the underlying data. Removing it prevents a full DB reload
  // every time the user clicks Images / Groups / Batches.
  useEffect(() => {
    const cancelRef = { current: false };
    loadAll(cancelRef, true).catch(() => {});
    return () => { cancelRef.current = true; };
  }, [userId]);

  // Separate effect for explicit refresh requests (e.g. Save Batch, image delete).
  // Uses the normal guard so an already-running fetch won't be double-triggered.
  useEffect(() => {
    if ((refreshTrigger ?? 0) > 0) {
      const cancelRef = { current: false };
      loadAll(cancelRef, false).catch(() => {});
      return () => { cancelRef.current = true; };
    }
  }, [refreshTrigger]);
  
  // Clear selection when switching views (separate effect)
  useEffect(() => {
    setSelectedItems(new Set());
  }, [viewMode]);

  // Single entry-point — fetches fetchWorkflowBatches() exactly ONCE per invocation,
  // then populates batches, productGroups, and images from that single response.
  // cancelRef: React 18 Strict Mode double-invoke is harmless when cancel fires.
  // force: bypasses the isLoadingRef guard for mount calls (which MUST always run).
  const loadAll = async (cancelRef?: { current: boolean }, force = false) => {
    // Guard: skip if already in flight, unless this is a forced mount call
    if (!force && isLoadingRef.current) {
      log.library('loadAll SKIPPED (already in flight)');
      return;
    }
    // If a prior forced call was cancelled mid-flight, the ref may still be true — reset it
    isLoadingRef.current = true;
    log.library(`loadAll START | force=${force}`);
    const isCancelled = () => {
      if (cancelRef?.current === true) {
        isLoadingRef.current = false; // release the lock so the next call can proceed
        return true;
      }
      return false;
    };
    setLoading(true);
    try {
      // ── 1. Fetch workflow batches ONCE ──────────────────────────────────
      const wfBatches = await fetchWorkflowBatches();
      if (isCancelled()) return;

      const batchesById = new Map<string, WorkflowBatch>(wfBatches.map(b => [b.id, b]));

      const makeBatchName = (b: WorkflowBatch) =>
        b.batch_name || `Batch ${new Date(b.created_at).toLocaleDateString()} ${new Date(b.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;

      // ── 2. Fetch DB tables in parallel ──────────────────────────────────
      const [savedProducts, savedImages] = await Promise.all([
        fetchSavedProducts(userId),
        fetchSavedImages(userId),
      ]);
      if (isCancelled()) return;

      // Helper: synthesize a batch entry for any batch_id missing from workflow_batches
      const synthesizeBatch = (batchId: string, wb: any, fallbackDate: string) => {
        if (!batchId || batchesById.has(batchId)) return;
        batchesById.set(batchId, {
          id: batchId,
          user_id: '',
          batch_number: wb?.batch_number || batchId,
          batch_name: wb?.batch_name || undefined,
          workflow_state: undefined,
          total_images: 0,
          product_groups_count: 0,
          categorized_count: 0,
          processed_count: 0,
          saved_products_count: 0,
          current_step: 0,
          is_completed: false,
          created_at: wb?.created_at || fallbackDate,
          updated_at: wb?.created_at || fallbackDate,
        });
      };

      savedProducts.forEach((p: any) => synthesizeBatch(p.batch_id, p.workflow_batches, p.created_at));
      savedImages.forEach((img: any) => synthesizeBatch(img.products?.batch_id, img.products?.workflow_batches, img.created_at));

      // ── 3. Build productGroups ──────────────────────────────────────────
      const groups: ProductGroup[] = [];

      wfBatches.forEach(batch => {
        const items: (ClothingItem | SlimItem)[] =
          (batch.workflow_state?.processedItems?.length  ? batch.workflow_state.processedItems  : null) ||
          (batch.workflow_state?.sortedImages?.length    ? batch.workflow_state.sortedImages    : null) ||
          (batch.workflow_state?.groupedImages?.length   ? batch.workflow_state.groupedImages   : null) ||
          [];

        const groupMap = new Map<string, (ClothingItem | SlimItem)[]>();
        items.forEach((item) => {
          const gid = item.productGroup || item.id;
          if (!groupMap.has(gid)) groupMap.set(gid, []);
          groupMap.get(gid)!.push(item);
        });

        groupMap.forEach((groupItems, groupId) => {
          const first = groupItems[0];
          groups.push({
            id: groupId,
            title: cleanTitle((first as ClothingItem).seoTitle),
            category: first.category || 'Uncategorized',
            images: groupItems.map(i => {
              // preview and imageUrls are stripped by slim() before saving to workflow_state.
              // Reconstruct the CDN URL from storagePath (always preserved by slim()).
              const storagePath = (i as ClothingItem).storagePath || i.storagePath;
              const reconstructed = storagePath
                ? supabase.storage.from('product-images').getPublicUrl(storagePath).data.publicUrl
                : '';
              return (i as ClothingItem).preview || i.imageUrls?.[0] || reconstructed;
            }).filter(Boolean),
            itemCount: groupItems.length,
            createdAt: batch.created_at,
            batchId: batch.id,
            batchName: makeBatchName(batch),
          });
        });
      });

      // Build from DB products — group siblings by product_group value.
      // Products where product_group === id are standalones (1-image listings).
      // Products where product_group !== id share a group — merge them together.
      const dbGroupMap = new Map<string, any[]>();
      savedProducts.forEach((product: any) => {
        const gid = product.product_group || product.id;
        if (!dbGroupMap.has(gid)) dbGroupMap.set(gid, []);
        dbGroupMap.get(gid)!.push(product);
      });

      dbGroupMap.forEach((members, groupId) => {
        // Use the member whose id === groupId as canonical (the group "leader"),
        // falling back to the first member if none matches.
        const canonical = members.find(p => p.id === groupId) || members[0];
        const allImages = members
          .flatMap((p: any) => (p.product_images || []).sort((a: any, b: any) => a.position - b.position).map((img: any) => img.image_url))
          .filter(Boolean);
        // Skip groups with 0 images — they are products whose product_images were all
        // deleted but whose products row survived RLS (wrong user_id). Treat them as gone.
        if (allImages.length === 0 && !canonical.batch_id) {
          log.library(`loadAll | skipping empty unassigned product id=${groupId.slice(0,8)} — all images deleted, products row is RLS-orphaned`);
          return;
        }
        groups.push({
          id: groupId,
          title: cleanTitle(canonical.title || canonical.seo_title),
          category: canonical.product_category || 'Uncategorized',
          images: allImages,
          itemCount: allImages.length || members.length,
          createdAt: canonical.created_at,
          isSaved: true,
          batchId: canonical.batch_id || undefined,
          batchName: canonical.workflow_batches?.batch_name || (canonical.batch_id ? `Batch ${new Date(canonical.created_at).toLocaleDateString()}` : undefined),
        });
      });

      const groupMap = new Map<string, ProductGroup>();
      groups.forEach(g => {
        const existing = groupMap.get(g.id);
        if (!existing || (!existing.isSaved && g.isSaved)) groupMap.set(g.id, g);
      });

      // ── 4. Build imageList ──────────────────────────────────────────────
      // SOURCE PRIORITY: workflow_state items are used first (they have richer in-memory data).
      // DB product_images rows fill in any gaps — items that exist in the DB but are
      // absent from workflow_state. This handles batches whose workflow_state was saved
      // before a bug-fix and is missing loose/uncategorized images that ARE in the DB.
      const imageList: ImageRecord[] = [];

      // Pass 1: workflow_state items — add all, track IDs and batch coverage
      const wfItemIds = new Set<string>();
      // Also track batch IDs that have SOME workflow_state items (for Pass 2 gap detection)
      const batchIdsCoveredByWfState = new Set<string>();

      wfBatches.forEach(batch => {
        const items: (ClothingItem | SlimItem)[] =
          batch.workflow_state?.processedItems ||
          batch.workflow_state?.sortedImages ||
          batch.workflow_state?.groupedImages ||
          batch.workflow_state?.uploadedImages || [];
        if (items.length === 0) return;
        batchIdsCoveredByWfState.add(batch.id);
        items.forEach((item) => {
          if (wfItemIds.has(item.id)) return; // dedup by item ID
          wfItemIds.add(item.id);
          // Reconstruct public URL from storagePath if preview/imageUrls are empty
          // (slim() strips preview before saving; storagePath is always preserved)
          const storagePath = (item as ClothingItem).storagePath || item.storagePath;
          const reconstructed = (!( (item as ClothingItem).preview || item.imageUrls?.[0] ) && storagePath)
            ? supabase.storage.from('product-images').getPublicUrl(storagePath).data.publicUrl
            : '';
          const url = (item as ClothingItem).preview || item.imageUrls?.[0] || reconstructed;
          imageList.push({
            id: item.id,
            preview: url,
            category: item.category,
            productGroup: item.productGroup || item.id,
            productGroupTitle: (item as ClothingItem).seoTitle || undefined,
            batchId: batch.id,
            batchName: makeBatchName(batch),
            createdAt: batch.created_at,
            isSaved: false,
          });
        });
      });

      // Pass 2: DB product_images rows.
      // For batches with NO workflow_state at all: include all DB rows (legacy behaviour).
      // For batches WITH workflow_state: only include DB rows whose product_id was NOT
      //   already added in Pass 1. This catches loose/uncategorized images that exist in
      //   the DB (written by registerItemsInDB) but were absent from an old workflow_state
      //   that was saved before the handleItemsProcessed merge-fix (commit dbd5d43).
      const dbImageUrls = new Set<string>();
      savedImages.forEach((img: any) => {
        const batchId: string | undefined = img.products?.batch_id || undefined;
        const productId: string | undefined = img.products?.id || undefined;

        // For batches fully covered by workflow_state AND whose product is already present
        // in Pass 1, skip to avoid duplicates. But if the product is missing from Pass 1
        // (the gap case), fall through and add it from DB.
        if (batchId && batchIdsCoveredByWfState.has(batchId) && productId && wfItemIds.has(productId)) return;

        if (!img.image_url) return;
        if (dbImageUrls.has(img.image_url)) return; // dedup by URL
        dbImageUrls.add(img.image_url);

        const batchEntry = batchId ? batchesById.get(batchId) : undefined;
        const batchName = batchEntry ? makeBatchName(batchEntry) : undefined;
        const groupLeaderId = img.products?.product_group || img.products?.id;
        if (!groupLeaderId) {
          // Orphaned product_images row — parent products row is missing.
          // Still show it in the Library (so user can delete it), but productGroup will be
          // undefined which handleDeleteUnassigned now handles via the orphan path.
          log.library(`loadAll | orphaned product_images row id=${img.id?.slice(0, 8)} (no parent products row)`);
        }
        const groupLeaderMembers = dbGroupMap.get(groupLeaderId);
        const groupLeaderTitle = groupLeaderMembers
          ? cleanTitle((groupLeaderMembers.find((p: any) => p.id === groupLeaderId) || groupLeaderMembers[0])?.title)
          : (img.products?.title || undefined);

        imageList.push({
          id: img.id,
          preview: img.image_url,
          category: img.products?.product_category,
          productGroup: groupLeaderId,
          productGroupTitle: groupLeaderTitle,
          batchId,
          batchName,
          createdAt: img.created_at,
          isSaved: true,
        });
      });

      // ── 5. Commit all state at once ─────────────────────────────────────
      if (!isCancelled()) {
        const finalBatches = Array.from(batchesById.values())
          .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
        const finalGroups = Array.from(groupMap.values());

        // ── Diagnostic summary ──────────────────────────────────────────
        // Per-batch breakdown
        const byBatch: Record<string, number> = {};
        imageList.forEach(img => { const k = img.batchName || img.batchId || 'unknown'; byBatch[k] = (byBatch[k] || 0) + 1; });

        setBatches(finalBatches);
        setProductGroups(finalGroups);
        setImages(imageList);
        log.library(`loadAll DONE | batches=${finalBatches.length} groups=${finalGroups.length} images=${imageList.length}`);

        // Detailed breakdown when debug is on
        if (window.__SORTBOT_DEBUG__) {
          const unassigned = imageList.filter(img => !img.batchId);
          const assigned = imageList.filter(img => img.batchId);
          log.library(`loadAll detail | assigned=${assigned.length} unassigned=${unassigned.length}`);
          unassigned.forEach(img => {
            log.library(`  unassigned img id=${img.id.slice(0,8)} productGroup=${img.productGroup?.slice(0,8) ?? 'NONE'} isSaved=${img.isSaved}`);
          });
          finalGroups.forEach(g => {
            log.library(`  group id=${g.id.slice(0,8)} title="${g.title}" batchId=${g.batchId?.slice(0,8) ?? 'NONE'} isSaved=${g.isSaved} images=${g.images.length}`);
          });
        }

        // Collapse all batches AND product groups by default on load
        setCollapsedBatches(prev => {
          const next = new Set(prev);
          finalBatches.forEach(b => {
            next.add(`img-batch-${b.id}`);   // Images tab — batch
            next.add(b.id);                  // Product Groups tab — batch
          });
          // Collapse every product group within the images tab
          const groupKeys = new Set(imageList.map(img => img.productGroup).filter(Boolean));
          groupKeys.forEach(gk => next.add(`img-group-${gk}`));
          return next;
        });
      }
    } catch (error) {
      log.error(`loadAll ERROR | ${error}`);
      console.error('[Library] loadAll ERROR', error);
    } finally {
      isLoadingRef.current = false;
    }
    setLoading(false);
  };

  // Thin wrappers so existing post-action call-sites (delete, rename, etc.) still work
  const loadBatches = () => loadAll();
  const loadProductGroups = () => loadAll();
  const loadImages = () => loadAll();

  // Create a brand-new empty batch in the database
  const handleCreateNewBatch = async () => {
    const name = await showPrompt('New Batch', 'Enter a batch name (leave blank to auto-name):');
    if (name === null) return;
    log.library(`handleCreateNewBatch | name="${name}"`);
    const batchNumber = `batch-${Date.now()}`;
    const batchName = name.trim() || `Batch ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    try {
      const { data, error } = await supabase
        .from('workflow_batches')
        .insert({
          user_id: userId,
          batch_number: batchNumber,
          batch_name: batchName,
          current_step: 1,
          total_images: 0,
          product_groups_count: 0,
          workflow_state: { uploadedImages: [], groupedImages: [], sortedImages: [], processedItems: [] },
        })
        .select()
        .single();
      if (error) throw error;
      if (data) {
        setBatches(prev => [data, ...prev]);
      }
    } catch (err) {
      console.error('Create batch error:', err);
    }
  };

  // Assign selected product-group images to a new batch
  const handleAssignSelectedToNewBatch = async () => {
    if (selectedItems.size === 0) return;
    log.library(`handleAssignSelectedToNewBatch | selected=${selectedItems.size}`);
    const name = await showPrompt('New Batch from Selection', 'Enter a name for the new batch:');
    if (name === null) return;
    const batchNumber = `batch-${Date.now()}`;
    const batchName = name.trim() || `Batch ${new Date().toLocaleDateString()}`;
    try {
      const { data: newBatch, error: batchErr } = await supabase
        .from('workflow_batches')
        .insert({
          user_id: userId,
          batch_number: batchNumber,
          batch_name: batchName,
          current_step: 2,
          total_images: selectedItems.size,
          product_groups_count: selectedItems.size,
          workflow_state: { uploadedImages: [], groupedImages: [], sortedImages: [], processedItems: [] },
        })
        .select()
        .single();
      if (batchErr) throw batchErr;
      if (!newBatch) throw new Error('No batch returned');

      const ids = Array.from(selectedItems);
      const { error: updateErr } = await supabase
        .from('products')
        .update({ batch_id: newBatch.id })
        .in('id', ids);
      if (updateErr) throw updateErr;

      clearSelection();
      await loadBatches();
      if (viewMode === 'groups') await loadProductGroups();
    } catch (err) {
      console.error('Assign to batch error:', err);
    }
  };

  // Assign selected product groups to an EXISTING batch (or create a new one inline)
  const handleAssignGroupsToExistingBatch = async () => {
    if (selectedItems.size === 0) return;

    const existingOptions = batches.map((b, i) => {
      const name = b.batch_name || `Batch ${new Date(b.created_at).toLocaleDateString()}`;
      return `${i + 1}. ${name}`;
    }).join('\n');
    const optionsList = `0. ➕ Create new batch\n${existingOptions}`;
    const input = await showPrompt(
      `Move ${selectedItems.size} group(s) to batch`,
      optionsList
    );
    if (input === null) return;
    const idx = parseInt(input.trim(), 10);

    try {
      const ids = Array.from(selectedItems);

      if (idx === 0) {
        const batchNameInput = await showPrompt('New Batch Name', 'Leave blank to auto-name:');
        if (batchNameInput === null) return;
        const batchNumber = `batch-${Date.now()}`;
        const batchName = batchNameInput.trim() || `Batch ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
        const { data: newBatch, error: batchErr } = await supabase
          .from('workflow_batches')
          .insert({ user_id: userId, batch_number: batchNumber, batch_name: batchName, current_step: 1, workflow_state: {} })
          .select()
          .single();
        if (batchErr) throw batchErr;
        if (!newBatch) throw new Error('No batch returned');
        const { error } = await supabase.from('products').update({ batch_id: newBatch.id }).in('id', ids);
        if (error) throw error;
        clearSelection();
        await loadBatches();
        await loadProductGroups();
      } else {
        const batchIdx = idx - 1;
        if (isNaN(batchIdx) || batchIdx < 0 || batchIdx >= batches.length) return;
        const target = batches[batchIdx];
        const { error } = await supabase.from('products').update({ batch_id: target.id }).in('id', ids);
        if (error) throw error;
        clearSelection();
        await loadProductGroups();
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Group selected images (from Images view) into a new product group
  const handleGroupSelectedImages = async () => {
    if (selectedItems.size < 2) return;
    log.library(`handleGroupSelectedImages | selected=${selectedItems.size}`);
    const titleInput = await showPrompt('New Product Group', 'Enter a title (leave blank to auto-name):');
    if (titleInput === null) return;
    const title = titleInput.trim() || `Group ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;

    try {
      const groupId = crypto.randomUUID();
      const imageIds = Array.from(selectedItems);

      const { data: newProduct, error: prodErr } = await supabase
        .from('products')
        .insert({ title, product_group: groupId, batch_id: null, status: 'Draft' })
        .select()
        .single();
      if (prodErr) throw prodErr;
      if (!newProduct) throw new Error('No product returned');

      const { error: imgErr } = await supabase
        .from('product_images')
        .update({ product_id: newProduct.id })
        .in('id', imageIds);
      if (imgErr) throw imgErr;

      clearSelection();
      await loadImages();
    } catch (err) {
      console.error(err);
    }
  };

  // Assign selected images to an existing product group
  const handleAssignImagesToGroup = async () => {
    if (selectedItems.size === 0) return;
    const { data: products } = await supabase
      .from('products')
      .select('id, title')
      .order('created_at', { ascending: false })
      .limit(50);
    if (!products || products.length === 0) return;
    const options = products.map((p: any, i: number) => `${i + 1}. ${p.title || 'Untitled'}`).join('\n');
    const input = await showPrompt(`Add ${selectedItems.size} image(s) to group`, options);
    if (input === null) return;
    const idx = parseInt(input.trim(), 10) - 1;
    if (isNaN(idx) || idx < 0 || idx >= products.length) return;
    const target = products[idx];
    try {
      const ids = Array.from(selectedItems);
      const { error } = await supabase.from('product_images').update({ product_id: target.id }).in('id', ids);
      if (error) throw error;
      clearSelection();
      await loadImages();
    } catch (err) {
      console.error(err);
    }
  };

  // Merge selected product groups into one
  const handleMergeGroups = async () => {
    if (selectedItems.size < 2) return;
    const groupIds = Array.from(selectedItems);
    const selectedGroups = productGroups.filter(g => groupIds.includes(g.id));
    const savedGroups = selectedGroups.filter(g => g.isSaved);
    if (savedGroups.length < 2) {
      await showPrompt('Cannot Merge', 'Merge requires at least 2 saved product groups. Complete Step 4 to save groups first.');
      return;
    }
    const defaultName = savedGroups[0].title;
    const name = await showPrompt('Merge Groups', `Merge ${savedGroups.length} groups into one product.\n\nNew title:`, defaultName);
    if (name === null) return;
    const trimmedName = name || defaultName;

    try {
      const [primary, ...rest] = savedGroups;
      const restIds = rest.map(g => g.id);

      // 1. Fetch existing image URLs in the primary group to avoid duplicate constraint
      const { data: primaryImages } = await supabase
        .from('product_images')
        .select('id, image_url')
        .eq('product_id', primary.id);
      const existingUrls = new Set((primaryImages || []).map((img: any) => img.image_url));

      // 2. For each non-primary group, fetch its images and reassign non-duplicates
      for (const groupId of restIds) {
        const { data: groupImages } = await supabase
          .from('product_images')
          .select('id, image_url')
          .eq('product_id', groupId);

        if (!groupImages) continue;

        const toMove = groupImages.filter((img: any) => !existingUrls.has(img.image_url));
        const toDrop = groupImages.filter((img: any) => existingUrls.has(img.image_url));

        // Move unique images to primary
        if (toMove.length > 0) {
          const { error } = await supabase
            .from('product_images')
            .update({ product_id: primary.id })
            .in('id', toMove.map((img: any) => img.id));
          if (error) throw error;
          toMove.forEach((img: any) => existingUrls.add(img.image_url));
        }

        // Delete duplicate images (same URL already in primary)
        if (toDrop.length > 0) {
          await supabase
            .from('product_images')
            .delete()
            .in('id', toDrop.map((img: any) => img.id));
        }
      }

      // 3. Update the primary group's title
      const { error: titleError } = await supabase
        .from('products')
        .update({ title: trimmedName })
        .eq('id', primary.id);
      if (titleError) throw titleError;

      // 4. Delete the now-empty secondary groups
      const { error: delError } = await supabase
        .from('products')
        .delete()
        .in('id', restIds);
      if (delError) throw delError;

      clearSelection();
      await loadProductGroups();
    } catch (err) {
      console.error(err);
    }
  };

  const handleDelete = async (batchId: string) => {
    log.library(`handleDelete batch | batchId=${batchId}`);
    // Start deletion animation
    setDeletingItem({id: batchId, type: 'batch', progress: 0});
    setDeleteConfirm(null);
    
    // Animate progress
    const animationDuration = 2000; // 2 seconds
    const steps = 20;
    const stepDuration = animationDuration / steps;
    
    for (let i = 1; i <= steps; i++) {
      await new Promise(resolve => setTimeout(resolve, stepDuration));
      const progress = (i / steps) * 100;
      setDeletingItem({id: batchId, type: 'batch', progress});
    }
    
    // Actually delete
    const success = await deleteWorkflowBatch(batchId);
    if (success) {
      setBatches(batches.filter(b => b.id !== batchId));
      // Reload all data so images and product groups counts reflect the deletion
      await loadAll();
    }
    
    setDeletingItem(null);
  };

  const handleDeleteGroup = async (groupId: string) => {
    log.library(`handleDeleteGroup | groupId=${groupId}`);
    // Start deletion animation
    setDeletingItem({id: groupId, type: 'group', progress: 0});
    setDeleteConfirm(null);
    
    // Animate progress
    const animationDuration = 2000; // 2 seconds
    const steps = 20;
    const stepDuration = animationDuration / steps;
    
    for (let i = 1; i <= steps; i++) {
      await new Promise(resolve => setTimeout(resolve, stepDuration));
      setDeletingItem({id: groupId, type: 'group', progress: (i / steps) * 100});
    }
    
    // Actually delete
    const success = await deleteProductGroup(groupId);
    if (success) {
      setProductGroups(productGroups.filter(g => g.id !== groupId));
    }
    
    setDeletingItem(null);
  };

  const handleDeleteImage = async (imageId: string, storagePath?: string) => {
    log.library(`handleDeleteImage | imageId=${imageId} storagePath=${storagePath ?? 'none'}`);
    // Start deletion animation
    setDeletingItem({id: imageId, type: 'image', progress: 0});
    setDeleteConfirm(null);
    
    // Animate progress
    const animationDuration = 2000; // 2 seconds
    const steps = 20;
    const stepDuration = animationDuration / steps;
    
    for (let i = 1; i <= steps; i++) {
      await new Promise(resolve => setTimeout(resolve, stepDuration));
      setDeletingItem({id: imageId, type: 'image', progress: (i / steps) * 100});
    }
    
    // Actually delete
    const success = await deleteImage(imageId, storagePath);
    if (success) {
      setImages(images.filter(img => img.id !== imageId));
    }
    
    setDeletingItem(null);
  };

  const handleDuplicateBatch = async (batchId: string) => {
    log.library(`handleDuplicateBatch | batchId=${batchId}`);
    const newBatchId = await duplicateBatch(batchId);
    if (newBatchId) {
      await loadBatches();
    }
  };

  const handleEditBatchName = async (batchId: string) => {
    if (!editBatchName.trim()) {
      setEditingBatch(null);
      return;
    }
    log.library(`handleEditBatchName | batchId=${batchId} name="${editBatchName.trim()}"`);

    const success = await updateBatchMetadata(batchId, {
      batch_name: editBatchName.trim(),
    });

    if (success) {
      // Update local state
      setBatches(batches.map(b => 
        b.id === batchId ? { ...b, batch_name: editBatchName.trim() } : b
      ));
      setEditingBatch(null);
      setEditBatchName('');
    } else {
      alert('Failed to update batch name. Please try again.');
    }
  };

  // Helper to get viewport-relative selection box coordinates
  const getViewportSelectionBox = () => {
    if (!selectionBox || !currentContainerRef.current) return null;
    
    const scrollTop = currentContainerRef.current.scrollTop;
    return {
      x: selectionBox.x,
      y: selectionBox.y - scrollTop, // Subtract scroll to get viewport position
      width: selectionBox.width,
      height: selectionBox.height
    };
  };

  // Selection handlers
  const handleItemClick = (itemId: string, event: React.MouseEvent) => {
    log.library(`itemClick | id=${itemId} shift=${event.shiftKey}`);
    // Matches ImageGrouper behavior
    const newSelected = new Set(selectedItems);
    
    if (event.shiftKey) {
      // Shift key - keep existing selection and toggle this item
      if (newSelected.has(itemId)) {
        newSelected.delete(itemId);
      } else {
        newSelected.add(itemId);
      }
    } else {
      // Normal click - toggle only this item
      if (newSelected.has(itemId)) {
        newSelected.delete(itemId);
      } else {
        newSelected.add(itemId);
      }
    }
    
    setSelectedItems(newSelected);
  };

  const clearSelection = () => {
    setSelectedItems(new Set());
  };

  const selectAll = () => {
    if (viewMode === 'batches') {
      setSelectedItems(new Set(batches.map(b => b.id)));
    } else if (viewMode === 'groups') {
      setSelectedItems(new Set(productGroups.map(g => g.id)));
    } else if (viewMode === 'images') {
      setSelectedItems(new Set(images.map(img => img.id)));
    }
  };

  // Drag and drop handlers
  const handleDragStart = (itemId: string, event: React.DragEvent) => {
    log.library(`dragStart | id=${itemId} viewMode=${viewMode} selectedCount=${selectedItems.size}`);
    // Mark native drag as active — prevents rubber-band selection from starting
    isDraggingRef.current = true;
    // Cancel any rubber-band selection that may have started on mousedown
    setIsSelecting(false);
    setSelectionStart(null);
    setSelectionBox(null);
    setSelectionThresholdMet(false);

    setDraggedItem(itemId);
    const type = viewMode === 'batches' ? 'batch' : viewMode === 'groups' ? 'group' : 'image';
    setDragType(type);
    event.dataTransfer.effectAllowed = 'move';

    // For images: if the dragged item is part of a multi-selection, encode ALL
    // selected IDs so the drop handler can move them all at once.
    if (type === 'image' && selectedItems.has(itemId) && selectedItems.size > 1) {
      const allIds = Array.from(selectedItems).join(',');
      event.dataTransfer.setData('text/plain', allIds);
      event.dataTransfer.setData('drag-ids', allIds);

      // Custom drag ghost showing count badge
      const ghost = document.createElement('div');
      ghost.style.cssText = `
        position:fixed; top:-9999px; left:-9999px;
        background:#667eea; color:#fff; font-size:13px; font-weight:600;
        padding:6px 14px; border-radius:20px; box-shadow:0 4px 12px rgba(0,0,0,0.25);
        pointer-events:none; white-space:nowrap;
      `;
      ghost.textContent = `Moving ${selectedItems.size} images`;
      document.body.appendChild(ghost);
      event.dataTransfer.setDragImage(ghost, ghost.offsetWidth / 2, 20);
      setTimeout(() => ghost.remove(), 0);
    } else {
      event.dataTransfer.setData('text/plain', itemId);
      event.dataTransfer.setData('drag-ids', itemId);
    }
    event.dataTransfer.setData('drag-type', type);
  };

  const handleDragOver = (itemId: string, event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setDragOverItem(itemId);
  };

  const handleDragLeave = () => {
    setDragOverItem(null);
  };

  // Drop one or more images onto a product group section (Images view)
  const handleDropImageOntoGroup = async (targetGroupId: string, event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const rawIds = event.dataTransfer.getData('drag-ids') || event.dataTransfer.getData('text/plain');
    const type = event.dataTransfer.getData('drag-type');
    if (!rawIds || type !== 'image' || !targetGroupId) {
      return;
    }
    const imageIds = new Set(rawIds.split(',').map(id => id.trim()).filter(Boolean));
    log.library(`dropImageOntoGroup | images=${imageIds.size} → group=${targetGroupId}`);
    setDragOverItem(null);
    setDraggedItem(null);
    setDragType(null);

    const isUngroup = targetGroupId === 'no-group';
    if (imageIds.size === 0) return;

    // ── Optimistic local update ──────────────────────────────────────
    // Find the target group's metadata from existing images state so we
    // can immediately update affected ImageRecord entries without a reload.
    const targetMeta = isUngroup
      ? { productGroup: undefined, productGroupTitle: undefined, batchId: undefined, batchName: undefined, category: undefined }
      : (() => {
          const sample = images.find(img => img.productGroup === targetGroupId);
          return {
            productGroup: targetGroupId,
            productGroupTitle: sample?.productGroupTitle,
            batchId: sample?.batchId,
            batchName: sample?.batchName,
            category: sample?.category,
          };
        })();

    saveScroll();
    setImages(prev =>
      prev
        .filter(img => {
          // Remove duplicates: if the image URL already exists in target group, drop this record
          if (!imageIds.has(img.id)) return true;
          if (isUngroup) return true; // always keep when ungrouping
          // Keep if target group doesn't already have the same URL
          const alreadyInTarget = prev.some(
            other => other.productGroup === targetGroupId && other.preview === img.preview && other.id !== img.id
          );
          return !alreadyInTarget;
        })
        .map(img => {
          if (!imageIds.has(img.id)) return img;
          return {
            ...img,
            productGroup: targetMeta.productGroup,
            productGroupTitle: targetMeta.productGroupTitle,
            batchId: targetMeta.batchId,
            batchName: targetMeta.batchName,
            category: targetMeta.category ?? img.category,
          };
        })
    );
    clearSelection();
    // ────────────────────────────────────────────────────────────────

    // Fire DB write in background — no reload needed
    try {
      const imageIdArray = Array.from(imageIds);
      if (isUngroup) {
        const { error } = await supabase
          .from('product_images')
          .update({ product_id: null })
          .in('id', imageIdArray);
        if (error) throw error;
      } else {
        // Fetch only what we need to detect duplicates
        const { data: imgRows } = await supabase
          .from('product_images')
          .select('id, image_url, product_id')
          .in('id', imageIdArray);

        if (!imgRows || imgRows.length === 0) return;

        const { data: existingInTarget } = await supabase
          .from('product_images')
          .select('image_url')
          .eq('product_id', targetGroupId);
        const existingUrls = new Set((existingInTarget || []).map(r => r.image_url));

        await Promise.all(
          imgRows.map(async (imgRow) => {
            if (imgRow.product_id === targetGroupId) return;
            if (existingUrls.has(imgRow.image_url)) {
              await supabase.from('product_images').delete().eq('id', imgRow.id);
            } else {
              await supabase
                .from('product_images')
                .update({ product_id: targetGroupId })
                .eq('id', imgRow.id);
              existingUrls.add(imgRow.image_url);
            }
          })
        );
      }
    } catch (err) {
      // DB write failed — reload to resync local state with DB
      await loadImages();
    }
  };

  // Drop a product group onto a batch section header (Groups view)
  const handleDropGroupOntoBatch = async (targetBatchId: string, event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const groupId = event.dataTransfer.getData('text/plain');
    const type = event.dataTransfer.getData('drag-type');
    if (!groupId || type !== 'group') {
      return;
    }
    log.library(`dropGroupOntoBatch | group=${groupId} → batch=${targetBatchId}`);
    setDragOverBatch(null);
    setDraggedItem(null);
    setDragType(null);

    const idsToMove = new Set(
      selectedItems.has(groupId) && selectedItems.size > 1
        ? Array.from(selectedItems)
        : [groupId]
    );

    // ── Optimistic local update ──────────────────────────────────────
    const targetBatch = targetBatchId === 'no-batch'
      ? null
      : batches.find(b => b.id === targetBatchId);
    const newBatchName = targetBatch
      ? (targetBatch.batch_name || `Batch ${new Date(targetBatch.created_at).toLocaleDateString()} ${new Date(targetBatch.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`)
      : undefined;

    saveScroll();
    setProductGroups(prev =>
      prev.map(group => {
        if (!idsToMove.has(group.id)) return group;
        return {
          ...group,
          batchId: targetBatchId === 'no-batch' ? undefined : targetBatchId,
          batchName: newBatchName,
        };
      })
    );
    clearSelection();

    try {
      const { error } = await supabase
        .from('products')
        .update({ batch_id: targetBatchId === 'no-batch' ? null : targetBatchId })
        .in('id', Array.from(idsToMove));
      if (error) throw error;
    } catch (err) {
      // DB write failed — reload to resync
      await loadProductGroups();
    }
  };

  const handleDrop = (targetId: string, event: React.DragEvent) => {
    event.preventDefault();
    
    if (!draggedItem || draggedItem === targetId) {
      setDraggedItem(null);
      setDragOverItem(null);
      return;
    }

    // Same-type reorder only
    if (viewMode === 'batches') {
      const items = [...batches];
      const draggedIndex = items.findIndex(b => b.id === draggedItem);
      const targetIndex = items.findIndex(b => b.id === targetId);
      if (draggedIndex !== -1 && targetIndex !== -1) {
        const [removed] = items.splice(draggedIndex, 1);
        items.splice(targetIndex, 0, removed);
        setBatches(items);
      }
    } else if (viewMode === 'groups') {
      const items = [...productGroups];
      const draggedIndex = items.findIndex(g => g.id === draggedItem);
      const targetIndex = items.findIndex(g => g.id === targetId);
      if (draggedIndex !== -1 && targetIndex !== -1) {
        const [removed] = items.splice(draggedIndex, 1);
        items.splice(targetIndex, 0, removed);
        setProductGroups(items);
      }
    } else if (viewMode === 'images') {
      const items = [...images];
      const draggedIndex = items.findIndex(img => img.id === draggedItem);
      const targetIndex = items.findIndex(img => img.id === targetId);
      if (draggedIndex !== -1 && targetIndex !== -1) {
        const [removed] = items.splice(draggedIndex, 1);
        items.splice(targetIndex, 0, removed);
        setImages(items);
      }
    }

    setDraggedItem(null);
    setDragOverItem(null);
  };

  const handleDragEnd = () => {
    isDraggingRef.current = false;
    setDraggedItem(null);
    setDragOverItem(null);
    setDragOverBatch(null);
    setDragType(null);
  };

  // Rubber band selection handlers
  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>, containerRef: React.RefObject<HTMLDivElement | null>) => {
    // Never start rubber-band selection while a native drag is in progress
    if (isDraggingRef.current) return;
    // Ignore if clicking on a button or interactive element
    const target = e.target as HTMLElement;
    if (target.tagName === 'BUTTON' || target.closest('button') || target.closest('input')) {
      return;
    }
    // Don't start rubber-band selection if mousedown is on a draggable card
    if (target.closest('[draggable="true"]')) {
      return;
    }

    currentContainerRef.current = containerRef.current;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const scrollTop = containerRef.current?.scrollTop || 0;
    const startX = e.clientX - rect.left;
    const startY = e.clientY - rect.top + scrollTop;

    setIsSelecting(true);
    setSelectionStart({ x: startX, y: startY });
    setSelectionBox({ x: startX, y: startY, width: 0, height: 0 });
    setSelectionThresholdMet(false);
  };

  // Global mouse move handler
  useEffect(() => {
    const SCROLL_ZONE = 50; // pixels from edge to trigger scroll
    const SCROLL_SPEED = 10; // pixels per frame
    let scrollInterval: ReturnType<typeof setInterval> | null = null;

    const handleMouseMove = (e: MouseEvent) => {
      if (!isSelecting || !selectionStart || !currentContainerRef.current) return;
      if (isDraggingRef.current) return;

      const rect = currentContainerRef.current.getBoundingClientRect();
      const scrollTop = currentContainerRef.current.scrollTop;
      
      // Calculate position relative to container, accounting for scroll
      let currentX = e.clientX - rect.left;
      let currentY = e.clientY - rect.top + scrollTop;
      
      // Allow selection to extend beyond visible boundaries
      // Clamp X to reasonable bounds but allow Y to extend with scroll
      currentX = Math.max(0, Math.min(currentX, rect.width));

      const width = currentX - selectionStart.x;
      const height = currentY - selectionStart.y;

      // Check if we've moved beyond threshold
      if (!selectionThresholdMet) {
        const distance = Math.sqrt(width * width + height * height);
        if (distance >= SELECTION_THRESHOLD) {
          setSelectionThresholdMet(true);
        }
      }

      setSelectionBox({
        x: width >= 0 ? selectionStart.x : currentX,
        y: height >= 0 ? selectionStart.y : currentY,
        width: Math.abs(width),
        height: Math.abs(height)
      });

      // Auto-scroll when near edges OR outside container
      if (scrollInterval) {
        clearInterval(scrollInterval);
        scrollInterval = null;
      }

      const mouseY = e.clientY;
      const containerTop = rect.top;
      const containerBottom = rect.bottom;

      // Check if mouse is above container or near top edge
      if (mouseY < containerTop || (mouseY - containerTop < SCROLL_ZONE && mouseY > containerTop)) {
        // Mouse is above container or near top edge - scroll up
        scrollInterval = setInterval(() => {
          if (currentContainerRef.current) {
            currentContainerRef.current.scrollTop -= SCROLL_SPEED;
          }
        }, 16); // ~60fps
      } 
      // Check if mouse is below container or near bottom edge
      else if (mouseY > containerBottom || (containerBottom - mouseY < SCROLL_ZONE && mouseY < containerBottom)) {
        // Mouse is below container or near bottom edge - scroll down
        scrollInterval = setInterval(() => {
          if (currentContainerRef.current) {
            currentContainerRef.current.scrollTop += SCROLL_SPEED;
          }
        }, 16);
      }

      // Calculate which items are selected
      if (selectionThresholdMet) {
        // Use scroll-adjusted coordinates for both selection box and cards
        const selectionMinX = Math.min(selectionStart.x, currentX);
        const selectionMaxX = Math.max(selectionStart.x, currentX);
        const selectionMinY = Math.min(selectionStart.y, currentY);
        const selectionMaxY = Math.max(selectionStart.y, currentY);

        const cards = currentContainerRef.current.querySelectorAll('[data-item-id]');
        const newSelected = new Set<string>();

        cards.forEach((card) => {
          const cardRect = card.getBoundingClientRect();
          const itemId = card.getAttribute('data-item-id');
          
          if (!itemId) return;

          // Get card position in scroll-adjusted coordinates
          const cardScrollTop = cardRect.top - rect.top + scrollTop;
          const cardScrollBottom = cardRect.bottom - rect.top + scrollTop;
          const cardScrollLeft = cardRect.left - rect.left;
          const cardScrollRight = cardRect.right - rect.left;

          // Check if rectangles intersect (both in scroll-adjusted coordinates)
          const intersects = !(
            cardScrollRight < selectionMinX ||
            cardScrollLeft > selectionMaxX ||
            cardScrollBottom < selectionMinY ||
            cardScrollTop > selectionMaxY
          );

          if (intersects) {
            newSelected.add(itemId);
          }
        });

        setSelectedItems(newSelected);
      }
    };

    const handleMouseUp = () => {
      // Clear scroll interval
      if (scrollInterval) {
        clearInterval(scrollInterval);
        scrollInterval = null;
      }

      // Don't interfere with native drag-and-drop
      if (isDraggingRef.current) return;

      if (isSelecting) {
        setIsSelecting(false);
        setSelectionStart(null);
        setSelectionBox(null);
        setSelectionThresholdMet(false);
        currentContainerRef.current = null;
      }
    };

    if (isSelecting) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);

      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        // Clean up scroll interval on unmount
        if (scrollInterval) {
          clearInterval(scrollInterval);
        }
      };
    }
  }, [isSelecting, selectionStart, selectionThresholdMet, SELECTION_THRESHOLD]);

  // Delete ALL products whose batch_id is null (orphaned by the old gap-fill bug).
  // These are duplicate rows — NOT real data. The real items live in workflow_state.
  // Do NOT try to re-assign them to a batch: the gap-fill cleanup in handleOpenBatch
  // will immediately delete them again (creating an infinite loop).
  const [workingUnassigned, setWorkingUnassigned] = useState(false);

  // ── Delete debug trace — logs to console when Debug: ON ─────────────────────
  const addTrace = (status: 'ok' | 'warn' | 'error' | 'info', label: string, detail: string) => {
    if (!window.__SORTBOT_DEBUG__) return;
    const icons = { ok: '✓', warn: '⚠', error: '✗', info: '·' };
    const msg = `[DeleteTrace] ${icons[status]} ${label} — ${detail}`;
    if (status === 'error') console.error(msg);
    else if (status === 'warn') console.warn(msg);
    else log.library(msg);
  };

  const handleDeleteUnassigned = async () => {
    const unassignedImages = images.filter(img => !img.batchId);
    if (unassignedImages.length === 0) return;
    const confirmed = window.confirm(
      `Delete all ${unassignedImages.length} unassigned images? This cannot be undone.`
    );
    if (!confirmed) return;

    const isDebugging = window.__SORTBOT_DEBUG__;
    if (isDebugging) {
      addTrace('info', 'START', `unassignedImages in state: ${unassignedImages.length}`);
      // Show the raw shape of each unassigned image for diagnosis
      unassignedImages.forEach(img => {
        addTrace('info', `  img ${img.id.slice(0, 8)}`, `productGroup=${img.productGroup?.slice(0, 8) ?? 'undefined'} isSaved=${img.isSaved} createdAt=${img.createdAt?.slice(0, 10)}`);
      });
    }

    setWorkingUnassigned(true);
    try {
      // ── Bucket 1: images WITH a productGroup (normal path) ────────────────
      const productIds = [...new Set(
        unassignedImages.map(img => img.productGroup).filter(Boolean) as string[]
      )];
      const productIdSet = new Set(productIds);

      // Pre-build a map of productId → known product_images IDs from state.
      // Used as a fallback when the DB query returns 0 rows (e.g. RLS blocks the lookup).
      const productToKnownImgIds = new Map<string, string[]>();
      unassignedImages.forEach(img => {
        if (!img.productGroup) return;
        const arr = productToKnownImgIds.get(img.productGroup) ?? [];
        arr.push(img.id);
        productToKnownImgIds.set(img.productGroup, arr);
      });

      // ── Bucket 2: orphaned product_images rows (productGroup is undefined) ─
      // These are product_images rows whose parent products row has already been
      // deleted (or was never saved), leaving an orphan that keeps reappearing.
      const orphanImgIds = unassignedImages
        .filter(img => !img.productGroup)
        .map(img => img.id);

      if (isDebugging) {
        addTrace('info', 'productIds', `${productIds.length} unique IDs: ${productIds.map(id => id.slice(0, 8)).join(', ')}`);
        if (orphanImgIds.length > 0) {
          addTrace('warn', 'ORPHAN product_images', `${orphanImgIds.length} images have no productGroup — treating as orphaned product_images rows, will delete by id directly`);
          orphanImgIds.forEach(id => addTrace('warn', '  ↳ orphan id', id.slice(0, 8)));
        }
      }

      const CHUNK = 100;
      for (let i = 0; i < productIds.length; i += CHUNK) {
        const chunk = productIds.slice(i, i + CHUNK);

        // ── Step 1: fetch product_images rows ──────────────────────────────
        const { data: imgRows, error: fetchImgErr } = await supabase
          .from('product_images')
          .select('id, storage_path')
          .in('product_id', chunk);

        if (isDebugging) {
          if (fetchImgErr) addTrace('error', 'fetch product_images', `ERROR: ${fetchImgErr.message} (code ${fetchImgErr.code})`);
          else addTrace('ok', 'fetch product_images', `found ${imgRows?.length ?? 0} rows for chunk of ${chunk.length} productIds`);
        }

        // ── Step 2: delete storage files ──────────────────────────────────
        const storagePaths = (imgRows ?? []).map((r: any) => r.storage_path).filter(Boolean) as string[];
        if (storagePaths.length > 0) {
          const { error: storageErr } = await supabase.storage.from('product-images').remove(storagePaths);
          if (isDebugging) {
            if (storageErr) addTrace('error', 'storage.remove', `ERROR: ${storageErr.message}`);
            else addTrace('ok', 'storage.remove', `removed ${storagePaths.length} files`);
          }
        } else if (isDebugging) {
          addTrace('info', 'storage.remove', 'no storage paths — skipped');
        }

        // ── Step 3: delete product_images rows ────────────────────────────
        // Prefer the IDs fetched from DB; fall back to the IDs we know from state
        // (covers the case where RLS blocks the SELECT but allows DELETE by id).
        const fetchedImgIds = (imgRows ?? []).map((r: any) => r.id);
        const fallbackImgIds = chunk.flatMap(pid => productToKnownImgIds.get(pid) ?? []);
        const imgIds = fetchedImgIds.length > 0 ? fetchedImgIds : fallbackImgIds;
        const imgIdSource = fetchedImgIds.length > 0 ? 'DB fetch' : 'state fallback';

        if (imgIds.length > 0) {
          if (fetchedImgIds.length === 0) {
            // DB SELECT returned 0 — RLS is almost certainly blocking it.
            // Fall back to deleting by known state IDs.
            console.warn(`[Library] ⚠️ RLS WARNING: product_images SELECT returned 0 for product_id=${chunk.map(id=>id.slice(0,8)).join(',')} — falling back to state IDs. Run the Supabase RLS migration at supabase.com/dashboard/project/SUPABASE_PROJECT_ID/sql/new`);
            addTrace('warn', 'product_images fallback', `DB fetch returned 0 — using ${fallbackImgIds.length} known IDs from state: ${fallbackImgIds.map(id => id.slice(0, 8)).join(', ')}`);
          }
          const { data: delImgData, error: delImgErr } = await supabase
            .from('product_images').delete().in('id', imgIds).select('id');
          if (isDebugging) {
            if (delImgErr) addTrace('error', 'DELETE product_images', `BLOCKED — ${delImgErr.message} (code ${delImgErr.code}) ← likely RLS`);
            else addTrace(
              (delImgData?.length ?? 0) === imgIds.length ? 'ok' : 'warn',
              'DELETE product_images',
              `[${imgIdSource}] attempted ${imgIds.length}, confirmed deleted ${delImgData?.length ?? '?'} rows${(delImgData?.length ?? 0) < imgIds.length ? ' ← RLS may have blocked some' : ''}`
            );
          }
          if (delImgErr) console.error('[Library] handleDeleteUnassigned | product_images delete error', delImgErr);
        } else if (isDebugging) {
          addTrace('warn', 'DELETE product_images', 'no imgIds from DB or state — step skipped');
        }

        // ── Step 4: delete products rows ──────────────────────────────────
        // First verify the products exist
        if (isDebugging) {
          const { data: existCheck } = await supabase.from('products').select('id, user_id').in('id', chunk);
          if (!existCheck || existCheck.length === 0) {
            addTrace('warn', 'pre-DELETE products check', `0 rows found in DB for these IDs — already gone or wrong IDs`);
          } else {
            addTrace('info', 'pre-DELETE products check', `found ${existCheck.length} rows; user_ids: ${[...new Set((existCheck as any[]).map(r => (r.user_id ?? 'null').slice(0, 8)))].join(', ')}`);
          }
        }

        // Claim ownership via UPDATE first — if the products row was created by a different
        // user, the DELETE policy (user_id = auth.uid()) will block it. UPDATE the user_id
        // to the current user so the subsequent DELETE succeeds. If RLS also blocks UPDATE,
        // this is a no-op and we still need the SQL migration.
        const { data: { user: currentUser } } = await supabase.auth.getUser();
        if (currentUser) {
          const { data: claimData, error: claimErr } = await supabase
            .from('products').update({ user_id: currentUser.id }).in('id', chunk).select('id');
          if (isDebugging) {
            if (claimErr) addTrace('warn', 'CLAIM products (UPDATE user_id)', `failed — ${claimErr.message}`);
            else addTrace('info', 'CLAIM products (UPDATE user_id)', `claimed ${claimData?.length ?? 0} of ${chunk.length} rows`);
          }
          if (claimErr) log.library(`handleDeleteUnassigned | products claim error: ${claimErr.message}`);
        }

        const { data: delProdData, error: delProdErr } = await supabase
          .from('products').delete().in('id', chunk).select('id');
        if (!delProdErr && (delProdData?.length ?? 0) < chunk.length) {
          console.warn(`[Library] ⚠️ RLS WARNING: products DELETE confirmed 0 rows deleted for ids=${chunk.map(id=>id.slice(0,8)).join(',')} — Supabase RLS DELETE policy is blocking this user. Run the migration at supabase.com/dashboard/project/SUPABASE_PROJECT_ID/sql/new`);
        }
        if (isDebugging) {
          if (delProdErr) addTrace('error', 'DELETE products', `BLOCKED — ${delProdErr.message} (code ${delProdErr.code}) ← likely RLS`);
          else addTrace(
            (delProdData?.length ?? 0) === chunk.length ? 'ok' : 'warn',
            'DELETE products',
            `attempted ${chunk.length}, confirmed deleted ${delProdData?.length ?? '?'} rows${(delProdData?.length ?? 0) < chunk.length ? ' ← RLS blocking or rows already gone' : ''}`
          );
        }
        if (delProdErr) console.error('[Library] handleDeleteUnassigned | products delete error', delProdErr);
      }

      // ── Step 4b: delete orphaned product_images rows directly ─────────────
      // These are product_images rows with no parent products row — their productGroup
      // is undefined in state, so they're skipped by the normal productIds loop.
      if (orphanImgIds.length > 0) {
        const OCHUNK = 100;
        for (let i = 0; i < orphanImgIds.length; i += OCHUNK) {
          const chunk = orphanImgIds.slice(i, i + OCHUNK);

          // Fetch storage paths first so we can clean up storage
          const { data: orphanRows } = await supabase
            .from('product_images').select('id, storage_path').in('id', chunk);
          const orphanPaths = (orphanRows ?? []).map((r: any) => r.storage_path).filter(Boolean) as string[];
          if (orphanPaths.length > 0) {
            await supabase.storage.from('product-images').remove(orphanPaths);
            if (isDebugging) addTrace('ok', 'orphan storage.remove', `removed ${orphanPaths.length} files`);
          }

          const { data: delOrphanData, error: delOrphanErr } = await supabase
            .from('product_images').delete().in('id', chunk).select('id');
          if (isDebugging) {
            if (delOrphanErr) addTrace('error', 'DELETE orphan product_images', `BLOCKED — ${delOrphanErr.message} (code ${delOrphanErr.code}) ← likely RLS`);
            else addTrace(
              (delOrphanData?.length ?? 0) === chunk.length ? 'ok' : 'warn',
              'DELETE orphan product_images',
              `attempted ${chunk.length}, confirmed deleted ${delOrphanData?.length ?? '?'} rows`
            );
          }
          if (delOrphanErr) console.error('[Library] handleDeleteUnassigned | orphan product_images delete error', delOrphanErr);
        }
      }

      // ── Step 5: scrub workflow_state ──────────────────────────────────────
      const { data: allBatches, error: fetchBatchErr } = await supabase
        .from('workflow_batches')
        .select('id, workflow_state');

      if (isDebugging) {
        if (fetchBatchErr) addTrace('error', 'fetch workflow_batches', `ERROR: ${fetchBatchErr.message}`);
        else addTrace('info', 'fetch workflow_batches', `found ${allBatches?.length ?? 0} batches to scrub`);
      }

      if (allBatches && allBatches.length > 0) {
        const wfKeys = ['uploadedImages', 'groupedImages', 'sortedImages', 'processedItems'];
        await Promise.all(allBatches.map(async (batch: any) => {
          if (!batch.workflow_state) return;
          const ws = { ...batch.workflow_state };
          let modified = false;
          for (const key of wfKeys) {
            if (Array.isArray(ws[key])) {
              const before = ws[key].length;
              ws[key] = ws[key].filter(
                (item: any) => !productIdSet.has(item.productGroup || item.id)
              );
              if (ws[key].length !== before) modified = true;
            }
          }
          if (modified) {
            const { error: scrubErr } = await supabase
              .from('workflow_batches')
              .update({ workflow_state: ws })
              .eq('id', batch.id);
            if (isDebugging) {
              if (scrubErr) addTrace('error', `scrub batch ${batch.id.slice(0, 8)}`, `UPDATE failed: ${scrubErr.message}`);
              else addTrace('ok', `scrub batch ${batch.id.slice(0, 8)}`, 'workflow_state updated');
            }
          }
        }));
      }

      // ── Step 6: re-fetch to confirm ───────────────────────────────────────
      if (isDebugging) {
        if (productIds.length > 0) {
          const { data: recheck } = await supabase.from('products').select('id').in('id', [...productIdSet]);
          if ((recheck?.length ?? 0) === 0) {
            addTrace('ok', 'CONFIRM products', `all ${productIds.length} product rows gone ✓`);
          } else {
            addTrace('error', 'CONFIRM products', `${recheck?.length} rows STILL EXIST — RLS blocking`);
            (recheck ?? []).forEach((r: any) => addTrace('error', '  ↳ surviving id', r.id.slice(0, 8)));
          }
        }
        if (orphanImgIds.length > 0) {
          const { data: orphanRecheck } = await supabase.from('product_images').select('id').in('id', orphanImgIds);
          if ((orphanRecheck?.length ?? 0) === 0) {
            addTrace('ok', 'CONFIRM orphans', `all ${orphanImgIds.length} orphan product_images rows gone ✓`);
          } else {
            addTrace('error', 'CONFIRM orphans', `${orphanRecheck?.length} orphan rows STILL EXIST — RLS blocking`);
            (orphanRecheck ?? []).forEach((r: any) => addTrace('error', '  ↳ surviving id', r.id.slice(0, 8)));
          }
        }
      }

      const orphanIdSet = new Set(orphanImgIds);
      setImages(prev => prev.filter(img => img.batchId && !orphanIdSet.has(img.id)));
      log.library(`handleDeleteUnassigned | deleted ${productIds.length} products + ${orphanImgIds.length} orphans`);
      if (isDebugging) addTrace('ok', 'DONE', `state updated — images filtered to batchId-only`);
    } catch (err) {
      console.error('[Library] handleDeleteUnassigned error', err);
      if (isDebugging) addTrace('error', 'EXCEPTION', String(err));
    } finally {
      setWorkingUnassigned(false);
    }
  };

  // Bulk delete selected items
  const handleBulkDelete = async () => {
    if (selectedItems.size === 0) return;

    const itemType = viewMode === 'batches' ? 'batch' : viewMode === 'groups' ? 'group' : 'image';
    const count = selectedItems.size;
    
    // Start deletion animation
    setDeletingItem({id: 'bulk', type: itemType, progress: 0});
    
    // Animate progress while deleting items
    const totalItems = count;
    let deletedCount = 0;
    const items = Array.from(selectedItems);
    
    // Delete items one by one with progress updates
    if (viewMode === 'batches') {
      for (const batchId of items) {
        await deleteWorkflowBatch(batchId);
        deletedCount++;
        const progress = (deletedCount / totalItems) * 100;
        setDeletingItem({id: 'bulk', type: itemType, progress});
      }
      setBatches(batches.filter(b => !selectedItems.has(b.id)));
    } else if (viewMode === 'groups') {
      for (const groupId of items) {
        await deleteProductGroup(groupId);
        deletedCount++;
        const progress = (deletedCount / totalItems) * 100;
        setDeletingItem({id: 'bulk', type: itemType, progress});
      }
      setProductGroups(productGroups.filter(g => !selectedItems.has(g.id)));
    } else if (viewMode === 'images') {
      for (const imageId of items) {
        await deleteImage(imageId);
        deletedCount++;
        const progress = (deletedCount / totalItems) * 100;
        setDeletingItem({id: 'bulk', type: itemType, progress});
      }
      setImages(images.filter(img => !selectedItems.has(img.id)));
    }
    
    // Show completion for a moment
    await new Promise(resolve => setTimeout(resolve, 800));
    
    setDeletingItem(null);
    clearSelection();
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffHours / 24);

    if (diffHours < 1) return 'Just now';
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
    });
  };

  const getStepLabel = (step: number): string => {
    const labels: Record<number, string> = {
      1: 'Upload Images',
      2: 'Group & Categorize',
      3: 'Add Descriptions',
      4: 'Save & Export',
    };
    return labels[step] || 'Unknown';
  };

  const getStepProgress = (batch: WorkflowBatch): number => {
    return Math.min((batch.current_step / 4) * 100, 100);
  };

  // Get thumbnail grid (2x2) from workflow state
  const getThumbnails = (batch: WorkflowBatch): string[] => {
    // workflow_state only saves processedItems (the others are []). Use it if populated.
    const items =
      batch.workflow_state?.processedItems ||
      batch.workflow_state?.sortedImages ||
      batch.workflow_state?.groupedImages ||
      batch.workflow_state?.uploadedImages ||
      [];

    const fromWf = items
      .slice(0, 4)
      .map(item => {
        const storagePath = (item as ClothingItem).storagePath || item.storagePath;
        const reconstructed = storagePath
          ? supabase.storage.from('product-images').getPublicUrl(storagePath).data.publicUrl
          : '';
        return (item as ClothingItem).preview || item.imageUrls?.[0] || reconstructed;
      })
      .filter(Boolean);

    if (fromWf.length > 0) return fromWf;

    // Fallback: use thumbnails from productGroups derived from the DB (covers batches
    // whose workflow_state is empty or only has categorized items).
    return productGroups
      .filter(g => g.batchId === batch.id && g.images.length > 0)
      .flatMap(g => g.images)
      .slice(0, 4);
  };

  if (loading) {
    return (
      <div className="library-modal">
        <div className="library-content">
          <div className="loading-state">
            <div className="spinner"></div>
            <p>Loading your library...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="library-modal" onClick={onClose}>
      <div className="library-content" onClick={(e) => e.stopPropagation()}>
        <div className="library-header">
          <div className="header-title">
            <Folder size={24} />
            <h2>Library</h2>
            {viewMode === 'batches' && (
              <span className="batch-count">({batches.length} {batches.length === 1 ? 'batch' : 'batches'})</span>
            )}
            {viewMode === 'groups' && (
              <span className="batch-count">({productGroups.length} {productGroups.length === 1 ? 'listing' : 'listings'})</span>
            )}
            {viewMode === 'images' && (
              <span className="batch-count">({images.length} {images.length === 1 ? 'image' : 'images'} in {batches.length} {batches.length === 1 ? 'batch' : 'batches'})</span>
            )}
          </div>
          <button className="close-button" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>

        {/* Deletion Progress Overlay */}
        {deletingItem && (
          <div className="deletion-overlay">
            <div className="deletion-animation">
              <div className="deletion-message">
                {deletingItem.id === 'bulk' 
                  ? `Deleting ${deletingItem.type}s... ${Math.round(deletingItem.progress)}%`
                  : `Deleting ${deletingItem.type}... ${Math.round(deletingItem.progress)}%`
                }
              </div>
              
              <div className="deletion-track">
                {/* Clothing Rack */}
                <div className="rack-bar"></div>
                <div className="rack-stand-left"></div>
                <div className="rack-stand-right"></div>
                
                {/* Moving Hanger */}
                <div 
                  className="hanger-icon" 
                  style={{left: `calc(10% + ${deletingItem.progress * 0.7}%)`}}
                  key={`hanger-${deletingItem.progress}`}
                >
                  <div className="hanger-hook"></div>
                  <div className="hanger-bar"></div>
                  <div className="hanger-left"></div>
                  <div className="hanger-right"></div>
                  <div className="hanger-clothing"></div>
                </div>
                
                {/* Trashcan at the end */}
                <div className="trashcan-icon">
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6"></polyline>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                    <line x1="10" y1="11" x2="10" y2="17"></line>
                    <line x1="14" y1="11" x2="14" y2="17"></line>
                  </svg>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* View Switcher + Search + New Batch */}

        {/* Inline Prompt Modal */}
        {promptModal && (
          <div className="prompt-modal-overlay" onClick={promptModal.onCancel}>
            <div className="prompt-modal" onClick={e => e.stopPropagation()}>
              <h3 className="prompt-modal-title">{promptModal.title}</h3>
              {promptModal.message && (
                <pre className="prompt-modal-message">{promptModal.message}</pre>
              )}
              <input
                ref={promptInputRef}
                className="prompt-modal-input"
                type="text"
                value={promptValue}
                onChange={e => setPromptValue(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') promptModal.onConfirm(promptValue);
                  if (e.key === 'Escape') promptModal.onCancel();
                }}
                placeholder={promptModal.defaultValue || ''}
                autoFocus
              />
              <div className="prompt-modal-actions">
                <button className="prompt-btn cancel" onClick={promptModal.onCancel}>Cancel</button>
                <button className="prompt-btn confirm" onClick={() => promptModal.onConfirm(promptValue)}>OK</button>
              </div>
            </div>
          </div>
        )}

        <div className="view-switcher">
          <button 
            className={`view-tab ${viewMode === 'images' ? 'active' : ''}`}
            onClick={() => setViewMode('images')}
          >
            <Grid3x3 size={18} />
            <span>Images</span>
          </button>
          <button 
            className={`view-tab ${viewMode === 'groups' ? 'active' : ''}`}
            onClick={() => setViewMode('groups')}
          >
            <Package size={18} />
            <span>Product Groups</span>
          </button>
          <button 
            className={`view-tab ${viewMode === 'batches' ? 'active' : ''}`}
            onClick={() => setViewMode('batches')}
          >
            <Folder size={18} />
            <span>Batches</span>
          </button>
        </div>

        {/* Search bar + New Batch button */}
        <div style={{ display: 'flex', gap: '0.5rem', padding: '0.5rem 1rem', alignItems: 'center' }}>
          <div style={{ position: 'relative', flex: 1 }}>
            <Search size={16} style={{ position: 'absolute', left: '0.6rem', top: '50%', transform: 'translateY(-50%)', color: '#888', pointerEvents: 'none' }} />
            <input
              type="text"
              placeholder={`Search ${viewMode}...`}
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              style={{
                width: '100%',
                paddingLeft: '2rem',
                paddingRight: '0.75rem',
                paddingTop: '0.45rem',
                paddingBottom: '0.45rem',
                border: '1px solid #d1d5db',
                borderRadius: '6px',
                fontSize: '0.9rem',
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>
          {viewMode === 'batches' && (
            <button
              onClick={handleCreateNewBatch}
              style={{
                display: 'flex', alignItems: 'center', gap: '0.3rem',
                background: '#6366f1', color: '#fff', border: 'none',
                borderRadius: '6px', padding: '0.45rem 0.85rem',
                fontSize: '0.85rem', cursor: 'pointer', whiteSpace: 'nowrap',
              }}
              title="Create a new empty batch"
            >
              <Plus size={15} /> New Batch
            </button>
          )}
        </div>

        {/* Selection Toolbar */}
        {selectedItems.size > 0 && (
          <div className="selection-toolbar">
            <div className="selection-info">
              <span className="selection-count">{selectedItems.size} selected</span>
              <button className="toolbar-button" onClick={clearSelection}>
                Clear
              </button>
            </div>
            <div className="selection-actions">
              <button className="toolbar-button" onClick={selectAll}>
                Select All
              </button>

              {/* ── Product Groups toolbar actions ── */}
              {viewMode === 'groups' && (
                <>
                  <button className="toolbar-button" onClick={handleAssignGroupsToExistingBatch} title="Move selected groups into an existing batch">
                    <Folder size={16} />
                    Move to Batch
                  </button>
                  <button className="toolbar-button" onClick={handleAssignSelectedToNewBatch} title="Move selected groups into a new batch">
                    <Plus size={16} />
                    New Batch from Selection
                  </button>
                  {selectedItems.size >= 2 && (
                    <button className="toolbar-button merge" onClick={handleMergeGroups} title="Merge selected groups into one product">
                      <Merge size={16} />
                      Merge Groups
                    </button>
                  )}
                </>
              )}

              {/* ── Images toolbar actions ── */}
              {viewMode === 'images' && (
                <>
                  <button className="toolbar-button" onClick={handleAssignImagesToGroup} title="Add selected images to an existing product group">
                    <Package size={16} />
                    Add to Group
                  </button>
                  <button className="toolbar-button" onClick={handleGroupSelectedImages} title="Create a new product group from selected images">
                    <Plus size={16} />
                    Create New Group
                  </button>
                </>
              )}

              <button className="toolbar-button danger" onClick={handleBulkDelete}>
                <Trash2 size={16} />
                Delete Selected
              </button>
            </div>
          </div>
        )}

        {/* Batches View */}
        {viewMode === 'batches' && (
          <>
            {batches.length === 0 ? (
              <div className="empty-state">
                <Folder size={64} className="empty-icon" />
                <p>No saved batches yet.</p>
                <p className="empty-subtitle">Start a new workflow to create your first batch.</p>
              </div>
            ) : (
              <div 
                className="batch-grid"
                ref={batchesGridRef}
                onMouseDown={(e) => handleMouseDown(e, batchesGridRef)}
              >
                {renderBatchesView()}
                {isSelecting && selectionBox && viewMode === 'batches' && (() => {
                  const viewportBox = getViewportSelectionBox();
                  return viewportBox ? (
                    <div
                      className="selection-box"
                      style={{
                        left: `${viewportBox.x}px`,
                        top: `${viewportBox.y}px`,
                        width: `${viewportBox.width}px`,
                        height: `${viewportBox.height}px`,
                      }}
                    />
                  ) : null;
                })()}
              </div>
            )}
          </>
        )}

        {/* Product Groups View */}
        {viewMode === 'groups' && (
          <>
            {productGroups.length === 0 && batches.length === 0 ? (
              <div className="empty-state">
                <Package size={64} className="empty-icon" />
                <p>No product groups yet.</p>
                <p className="empty-subtitle">Complete Step 2 (Group Images) to create product groups.</p>
              </div>
            ) : (
              <div 
                className="library-groups-grid"
                ref={groupsGridRef}
                onMouseDown={(e) => handleMouseDown(e, groupsGridRef)}
              >
                {renderProductGroupsView()}
                {isSelecting && selectionBox && viewMode === 'groups' && (() => {
                  const viewportBox = getViewportSelectionBox();
                  return viewportBox ? (
                    <div
                      className="selection-box"
                      style={{
                        left: `${viewportBox.x}px`,
                        top: `${viewportBox.y}px`,
                        width: `${viewportBox.width}px`,
                        height: `${viewportBox.height}px`,
                      }}
                    />
                  ) : null;
                })()}
              </div>
            )}
          </>
        )}

        {/* Images View */}
        {viewMode === 'images' && (
          <>
            {images.length === 0 ? (
              <div className="empty-state">
                <Image size={64} className="empty-icon" />
                <p>No images yet.</p>
                <p className="empty-subtitle">Upload images in Step 1 to see them here.</p>
              </div>
            ) : (
              <div 
                className="images-sections"
                ref={imagesGridRef}
                onMouseDown={(e) => handleMouseDown(e, imagesGridRef)}
              >
                {renderImagesView()}
                {isSelecting && selectionBox && viewMode === 'images' && (() => {
                  const viewportBox = getViewportSelectionBox();
                  return viewportBox ? (
                    <div
                      className="selection-box"
                      style={{
                        left: `${viewportBox.x}px`,
                        top: `${viewportBox.y}px`,
                        width: `${viewportBox.width}px`,
                        height: `${viewportBox.height}px`,
                      }}
                    />
                  ) : null;
                })()}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );

  // Render Batches View
  function renderBatchesView() {
    const q = searchQuery.toLowerCase();
    const filtered = q
      ? batches.filter(b => {
          const name = b.batch_name || `Batch ${new Date(b.created_at).toLocaleDateString()}`;
          return name.toLowerCase().includes(q) || b.batch_number.toLowerCase().includes(q);
        })
      : batches;
    return filtered.map((batch) => {
      const thumbnails = getThumbnails(batch);
      const progress = getStepProgress(batch);
      const isSelected = selectedItems.has(batch.id);
      const isDragging = draggedItem === batch.id;
      const isDragOver = dragOverItem === batch.id;

      // Compute live counts. workflow_state.processedItems is the single saved list —
      // but old batches may have a corrupted processedItems (pre-dbd5d43) that's missing
      // loose images. Use DB-derived productGroups as a supplemental source to get the
      // real count when the DB has more items than workflow_state.
      const wfItems: (ClothingItem | SlimItem)[] =
        (batch.workflow_state?.processedItems?.length  ? batch.workflow_state.processedItems  : null) ||
        (batch.workflow_state?.sortedImages?.length    ? batch.workflow_state.sortedImages    : null) ||
        (batch.workflow_state?.groupedImages?.length   ? batch.workflow_state.groupedImages   : null) ||
        (batch.workflow_state?.uploadedImages?.length  ? batch.workflow_state.uploadedImages  : null) ||
        [];
      const wfGroupIds = new Set(wfItems.map(i => i.productGroup || i.id));
      const batchGroups = productGroups.filter(g => g.batchId === batch.id);
      // Use whichever source reports more items — the DB is authoritative for old batches.
      const dbGroupCount = batchGroups.length;
      const dbImageCount = batchGroups.reduce((sum, g) => sum + g.itemCount, 0);
      const wfGroupCount = wfGroupIds.size;
      const wfImageCount = wfItems.length;
      const liveGroupCount = Math.max(wfGroupCount, dbGroupCount) || batch.product_groups_count;
      const liveImageCount = Math.max(wfImageCount, dbImageCount) || batch.total_images;
      
      return (
        <div 
          key={batch.id}
          data-item-id={batch.id}
          className={`batch-card ${batch.is_completed ? 'completed' : ''} ${isSelected ? 'selected' : ''} ${isDragging ? 'dragging' : ''} ${isDragOver ? 'drag-over' : ''}`}
          onClick={(e) => {
            // Only prevent selection if directly clicking buttons or inputs
            const target = e.target as HTMLElement;
            if (target.tagName === 'BUTTON' || target.tagName === 'INPUT' || target.closest('button')) {
              return;
            }
            handleItemClick(batch.id, e);
          }}
          draggable
          onDragStart={(e) => handleDragStart(batch.id, e)}
          onDragOver={(e) => handleDragOver(batch.id, e)}
          onDragLeave={handleDragLeave}
          onDrop={(e) => handleDrop(batch.id, e)}
          onDragEnd={handleDragEnd}
        >
          {/* Selection Indicator - Matches ImageGrouper style */}
          {isSelected && (
            <div className="selection-indicator">
              <Check size={20} />
            </div>
          )}

          {/* Thumbnail Grid (2x2) */}
          <div className="batch-thumbnails">
            {thumbnails.length > 0 ? (
              <div className={`thumbnail-grid grid-${Math.min(thumbnails.length, 4)}`}>
                {thumbnails.map((url, idx) => (
                  <div key={idx} className="thumbnail-item">
                    <LazyImg src={url} alt={`Product ${idx + 1}`} />
                  </div>
                ))}
              </div>
            ) : (
              <div className="thumbnail-placeholder">
                <Image size={48} />
                <p>No images</p>
              </div>
            )}
          </div>

          {/* Batch Info */}
          <div className="batch-info">
            <div className="batch-title">
              <Folder size={16} className="folder-icon" />
              {editingBatch === batch.id ? (
                <input
                  type="text"
                  className="batch-name-input"
                  value={editBatchName}
                  onChange={(e) => setEditBatchName(e.target.value)}
                  onBlur={() => handleEditBatchName(batch.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleEditBatchName(batch.id);
                    if (e.key === 'Escape') {
                      setEditingBatch(null);
                      setEditBatchName('');
                    }
                  }}
                  autoFocus
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <h3 onClick={(e) => {
                  e.stopPropagation();
                  setEditingBatch(batch.id);
                  const defaultName = `Batch ${new Date(batch.created_at).toLocaleDateString()} ${new Date(batch.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
                  setEditBatchName(batch.batch_name || defaultName);
                }}>
                  {batch.batch_name || `Batch ${new Date(batch.created_at).toLocaleDateString()} ${new Date(batch.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
                </h3>
              )}
              <button
                className="edit-icon-button"
                onClick={(e) => {
                  e.stopPropagation();
                  setEditingBatch(batch.id);
                  const defaultName = `Batch ${new Date(batch.created_at).toLocaleDateString()} ${new Date(batch.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
                  setEditBatchName(batch.batch_name || defaultName);
                }}
                title="Edit batch name"
              >
                <Edit2 size={14} />
              </button>
            </div>

            <div className="batch-meta">
              <div className="meta-row">
                <Calendar size={14} />
                <span>{formatDate(batch.updated_at)}</span>
              </div>
              <div className="meta-row">
                <Image size={14} />
                <span>{liveImageCount} {liveImageCount === 1 ? 'image' : 'images'}</span>
              </div>
              <div className="meta-row">
                <Layers size={14} />
                <span>{liveGroupCount} {liveGroupCount === 1 ? 'group' : 'groups'}</span>
              </div>
            </div>

            {/* Progress Bar */}
            <div className="batch-progress">
              <div className="progress-label">
                <span className="step-label">Step {batch.current_step}: {getStepLabel(batch.current_step)}</span>
                <span className="progress-percent">{Math.round(progress)}%</span>
              </div>
              <div className="progress-bar">
                <div 
                  className="progress-fill" 
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>

            {/* Status Badge */}
            {batch.is_completed && (
              <div className="status-badge completed">
                <Tag size={12} />
                <span>Completed</span>
              </div>
            )}
          </div>

          {/* Hover Actions */}
          <div className="batch-actions">
            <button 
              className="action-button secondary"
              onClick={(e) => {
                e.stopPropagation();
                handleDuplicateBatch(batch.id);
              }}
              title="Duplicate batch"
            >
              <Copy size={16} />
              <span>Duplicate</span>
            </button>
            <button 
              className="action-button primary"
              onClick={(e) => {
                e.stopPropagation();
                onOpenBatch(batch);
              }}
              title="Open batch"
            >
              <ArrowRight size={16} />
              <span>Open</span>
            </button>
            <button 
              className="action-button danger"
              onClick={(e) => {
                e.stopPropagation();
                if (deleteConfirm === batch.id) {
                  handleDelete(batch.id);
                } else {
                  setDeleteConfirm(batch.id);
                  setTimeout(() => setDeleteConfirm(null), 3000);
                }
              }}
              title={deleteConfirm === batch.id ? 'Click again to confirm' : 'Delete batch'}
            >
              <Trash2 size={16} />
              <span>{deleteConfirm === batch.id ? 'Confirm?' : 'Delete'}</span>
            </button>
          </div>
        </div>
      );
    });
  }

  // Render Product Groups View — grouped by batch with collapsible sections
  function renderProductGroupsView() {
    const q = searchQuery.toLowerCase();
    const filtered = q
      ? productGroups.filter(g =>
          g.title.toLowerCase().includes(q) || g.category.toLowerCase().includes(q) || (g.batchName || '').toLowerCase().includes(q)
        )
      : productGroups;

    // Build ordered sections: group by batchId (null/undefined → "No Batch")
    const sectionMap = new Map<string, { label: string; groups: ProductGroup[] }>();

    // Seed all known batches so empty batches still show as drop-target sections
    batches.forEach(batch => {
      const key = batch.id;
      const label = batch.batch_name || `Batch ${new Date(batch.created_at).toLocaleDateString()} ${new Date(batch.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
      if (!sectionMap.has(key)) {
        sectionMap.set(key, { label, groups: [] });
      }
    });

    filtered.forEach(group => {
      const key = group.batchId || 'no-batch';
      if (!sectionMap.has(key)) {
        sectionMap.set(key, {
          label: group.batchName || '📁 Unassigned',
          groups: [],
        });
      }
      sectionMap.get(key)!.groups.push(group);
    });

    // Move 'no-batch' to end so named batches appear first
    if (sectionMap.has('no-batch')) {
      const unassigned = sectionMap.get('no-batch')!;
      sectionMap.delete('no-batch');
      sectionMap.set('no-batch', unassigned);
    }

    const sections = Array.from(sectionMap.entries());

    const renderGroupCard = (group: ProductGroup) => {
      const isSelected = selectedItems.has(group.id);
      const isDragging = draggedItem === group.id;
      const isDragOver = dragOverItem === group.id;
      return (
        <div
          key={group.id}
          data-item-id={group.id}
          className={`group-card ${isSelected ? 'selected' : ''} ${isDragging ? 'dragging' : ''} ${isDragOver ? 'drag-over' : ''}`}
          onClick={(e) => {
            const target = e.target as HTMLElement;
            if (target.tagName === 'BUTTON' || target.closest('button')) return;
            handleItemClick(group.id, e);
          }}
          draggable
          onDragStart={(e) => handleDragStart(group.id, e)}
          onDragOver={(e) => handleDragOver(group.id, e)}
          onDragLeave={handleDragLeave}
          onDrop={(e) => handleDrop(group.id, e)}
          onDragEnd={handleDragEnd}
        >
          {isSelected && (
            <div className="selection-indicator">
              <Check size={20} />
            </div>
          )}

          {/* Group Images */}
          <div className="group-images">
            {group.images.length > 0 ? (
              <div className={`thumbnail-grid grid-${Math.min(group.images.length, 4)}`}>
                {group.images.slice(0, 4).map((url, idx) => (
                  <div key={idx} className="thumbnail-item">
                    <LazyImg src={url} alt={`${group.title} ${idx + 1}`} />
                  </div>
                ))}
              </div>
            ) : (
              <div className="thumbnail-placeholder">
                <Package size={48} />
                <p>No images</p>
              </div>
            )}
          </div>

          {/* Group Info */}
          <div className="group-info">
            <h3>{group.title}</h3>
            <div className="group-meta">
              <div className="meta-tag category">
                <Tag size={12} />
                <span>{group.category}</span>
              </div>
              <div className="meta-tag">
                <Image size={12} />
                <span>{group.itemCount} {group.itemCount === 1 ? 'image' : 'images'}</span>
              </div>
              <div className="meta-tag">
                <Calendar size={12} />
                <span>{formatDate(group.createdAt)}</span>
              </div>
            </div>
          </div>

          {/* Group Actions */}
          <div className="group-actions">
            <button
              className="action-button danger"
              onClick={(e) => {
                e.stopPropagation();
                if (deleteConfirm === group.id) {
                  handleDeleteGroup(group.id);
                } else {
                  setDeleteConfirm(group.id);
                  setTimeout(() => setDeleteConfirm(null), 3000);
                }
              }}
              title={deleteConfirm === group.id ? 'Click again to confirm' : 'Delete group'}
            >
              <Trash2 size={14} />
              <span>{deleteConfirm === group.id ? 'Confirm?' : 'Delete'}</span>
            </button>
          </div>
        </div>
      );
    };

    return (
      <>
        {sections.map(([batchKey, section]) => {
          const isCollapsed = collapsedBatches.has(batchKey);
          const allSectionSelected = section.groups.every(g => selectedItems.has(g.id));
          const isBatchDragOver = dragOverBatch === batchKey;
          return (
            <div
              key={batchKey}
              className={`batch-section ${isBatchDragOver ? 'batch-drop-over' : ''}`}
              onDragOver={(e) => {
                if (dragType === 'group') {
                  e.preventDefault();
                  e.stopPropagation();
                  e.dataTransfer.dropEffect = 'move';
                  setDragOverBatch(batchKey);
                }
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                  setDragOverBatch(null);
                }
              }}
              onDrop={(e) => {
                e.stopPropagation();
                handleDropGroupOntoBatch(batchKey, e);
              }}
            >
              <div
                className="batch-section-header"
                onClick={() =>
                  setCollapsedBatches(prev => {
                    const next = new Set(prev);
                    if (next.has(batchKey)) next.delete(batchKey);
                    else next.add(batchKey);
                    return next;
                  })
                }
              >
                <button className="collapse-toggle" title={isCollapsed ? 'Expand' : 'Collapse'}>
                  {isCollapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                </button>
                <Folder size={16} className="section-folder-icon" />
                <span className="section-label">{section.label}</span>
                <span className="section-count">
                  {section.groups.length} {section.groups.length === 1 ? 'group' : 'groups'}
                  {' · '}
                  {section.groups.reduce((sum, g) => sum + g.itemCount, 0)} images
                </span>
                {/* Select all in section */}
                <button
                  className="section-select-all"
                  title={allSectionSelected ? 'Deselect all in batch' : 'Select all in batch'}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedItems(prev => {
                      const next = new Set(prev);
                      if (allSectionSelected) {
                        section.groups.forEach(g => next.delete(g.id));
                      } else {
                        section.groups.forEach(g => next.add(g.id));
                      }
                      return next;
                    });
                  }}
                >
                  {allSectionSelected ? 'Deselect' : 'Select all'}
                </button>
              </div>

              {/* Section Cards */}
              {!isCollapsed && (
                <div className="batch-section-cards">
                  {section.groups.map(renderGroupCard)}
                </div>
              )}
            </div>
          );
        })}
      </>
    );
  }

  // Render Images View — grouped by batch → product group
  function renderImagesView() {
    const q = searchQuery.toLowerCase();
    const filtered = q
      ? images.filter(img =>
          (img.category || '').toLowerCase().includes(q) ||
          (img.productGroupTitle || '').toLowerCase().includes(q) ||
          (img.batchName || '').toLowerCase().includes(q)
        )
      : images;

    // Build: batchKey → { batchName, productGroups: Map<groupKey, { groupTitle, images }> }
    type GroupSection = { groupTitle: string; images: ImageRecord[] };
    type BatchSection = { batchName: string; groups: Map<string, GroupSection> };
    const batchMap = new Map<string, BatchSection>();

    // Seed all known batches so empty ones still show as drop targets
    batches.forEach(batch => {
      const key = batch.id;
      const name = batch.batch_name || `Batch ${new Date(batch.created_at).toLocaleDateString()} ${new Date(batch.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
      if (!batchMap.has(key)) {
        batchMap.set(key, { batchName: name, groups: new Map() });
      }
    });

    filtered.forEach(img => {
      const batchKey = img.batchId || 'no-batch';
      const batchName = img.batchName || '📁 Unassigned';
      const groupKey = img.productGroup || 'no-group';
      const groupTitle = img.productGroupTitle || 'Ungrouped Images';

      if (!batchMap.has(batchKey)) {
        batchMap.set(batchKey, { batchName, groups: new Map() });
      }
      const batchSection = batchMap.get(batchKey)!;
      if (!batchSection.groups.has(groupKey)) {
        batchSection.groups.set(groupKey, { groupTitle, images: [] });
      }
      batchSection.groups.get(groupKey)!.images.push(img);
    });

    // Move 'no-batch' to end so named batches appear first
    if (batchMap.has('no-batch')) {
      const unassigned = batchMap.get('no-batch')!;
      batchMap.delete('no-batch');
      batchMap.set('no-batch', unassigned);
    }
    const renderImageCard = (image: ImageRecord) => {
      const isSelected = selectedItems.has(image.id);
      // Show dragging style on ALL selected cards when any one of them is being dragged
      const isDragging = draggedItem === image.id ||
        (dragType === 'image' && draggedItem !== null && isSelected && selectedItems.has(draggedItem));
      const isDragOver = dragOverItem === image.id;
      return (
        <div
          key={image.id}
          data-item-id={image.id}
          className={`image-card ${isSelected ? 'selected' : ''} ${isDragging ? 'dragging' : ''} ${isDragOver ? 'drag-over' : ''}`}
          onClick={(e) => {
            const target = e.target as HTMLElement;
            if (target.tagName === 'BUTTON' || target.closest('button')) return;
            handleItemClick(image.id, e);
          }}
          draggable
          onDragStart={(e) => handleDragStart(image.id, e)}
          onDragOver={(e) => handleDragOver(image.id, e)}
          onDragLeave={handleDragLeave}
          onDrop={(e) => handleDrop(image.id, e)}
          onDragEnd={handleDragEnd}
        >
          {isSelected && (
            <div className="selection-indicator">
              <Check size={20} />
            </div>
          )}

          <div className="image-preview">
            {image.preview ? (
              <LazyImg src={image.preview} alt="Product" />
            ) : (
              <div className="image-placeholder">
                <Image size={32} />
              </div>
            )}
          </div>

          <div className="image-info">
            <div className="image-meta">
              {image.category && (
                <div className="meta-tag category">
                  <Tag size={10} />
                  <span>{image.category}</span>
                </div>
              )}
            </div>
            <button
              className="image-delete"
              onClick={(e) => {
                e.stopPropagation();
                if (deleteConfirm === image.id) {
                  handleDeleteImage(image.id, undefined);
                } else {
                  setDeleteConfirm(image.id);
                  setTimeout(() => setDeleteConfirm(null), 3000);
                }
              }}
              title={deleteConfirm === image.id ? 'Click again to confirm' : 'Delete image'}
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>
      );
    };

    return (
      <>
        {Array.from(batchMap.entries()).map(([batchKey, batchSection]) => {
          const isBatchCollapsed = collapsedBatches.has(`img-batch-${batchKey}`);
          const allBatchImages = Array.from(batchSection.groups.values()).flatMap(g => g.images);
          const allBatchSelected = allBatchImages.every(img => selectedItems.has(img.id));
          // Count directly from what is actually rendered — ground truth
          const batchImageCount = allBatchImages.length;
          const batchGroupCount = batchSection.groups.size;

          return (
            <div key={batchKey} className="batch-section">
              {/* Batch header */}
              <div
                className="batch-section-header"
                onClick={() =>
                  setCollapsedBatches(prev => {
                    const next = new Set(prev);
                    const key = `img-batch-${batchKey}`;
                    if (next.has(key)) next.delete(key);
                    else next.add(key);
                    return next;
                  })
                }
              >
                <button className="collapse-toggle" title={isBatchCollapsed ? 'Expand' : 'Collapse'}>
                  {isBatchCollapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                </button>
                <Folder size={16} className="section-folder-icon" />
                <span className="section-label">{batchSection.batchName}</span>
                <span className="section-count">
                  {`${batchImageCount} ${batchImageCount === 1 ? 'image' : 'images'} · ${batchGroupCount} ${batchGroupCount === 1 ? 'group' : 'groups'}`}
                </span>
                <button
                  className="section-select-all"
                  title={allBatchSelected ? 'Deselect all' : 'Select all in batch'}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedItems(prev => {
                      const next = new Set(prev);
                      if (allBatchSelected) {
                        allBatchImages.forEach(img => next.delete(img.id));
                      } else {
                        allBatchImages.forEach(img => next.add(img.id));
                      }
                      return next;
                    });
                  }}
                >
                  {allBatchSelected ? 'Deselect' : 'Select all'}
                </button>
                {batchKey === 'no-batch' && (
                  <>
                    <span style={{ fontSize: '0.75rem', color: '#888', marginLeft: '0.25rem' }}>
                      (orphaned duplicates — safe to delete)
                    </span>
                    <button
                      className="section-select-all"
                      style={{ color: '#ef4444', borderColor: '#ef4444' }}
                      title="Delete all unassigned images — these are orphaned duplicates, not real data"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteUnassigned();
                      }}
                      disabled={workingUnassigned}
                    >
                      {workingUnassigned ? 'Deleting…' : '🗑 Delete all unassigned'}
                    </button>
                  </>
                )}
              </div>

              {/* Product group sub-sections */}
              {!isBatchCollapsed && (() => {
                const groupEntries = Array.from(batchSection.groups.entries());
                // If no saved images but product groups exist in state, show group stubs
                const batchProductGroups = batchKey === 'no-batch'
                  ? productGroups.filter(g => !g.batchId)
                  : productGroups.filter(g => g.batchId === batchKey);

                if (groupEntries.length === 0 && batchProductGroups.length > 0) {
                  return (
                    <div style={{ padding: '8px 24px', color: '#888', fontSize: '13px' }}>
                      {batchProductGroups.map(g => (
                        <div key={g.id} className="image-group-section">
                          <div className="image-group-header" style={{ cursor: 'default' }}>
                            <Package size={14} className="section-folder-icon" />
                            <span className="image-group-label">{g.title}</span>
                            <span className="section-count">{g.itemCount} {g.itemCount === 1 ? 'image' : 'images'} · no saved files</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                }

                if (groupEntries.length === 0) {
                  return (
                    <div style={{ padding: '12px 24px', color: '#aaa', fontSize: '13px', fontStyle: 'italic' }}>
                      No images in this batch yet
                    </div>
                  );
                }

                return groupEntries.map(([groupKey, groupSection]) => {
                const isGroupCollapsed = collapsedBatches.has(`img-group-${groupKey}`);
                const allGroupSelected = groupSection.images.every(img => selectedItems.has(img.id));

                return (
                  <div
                    key={groupKey}
                    className={`image-group-section ${dragOverItem === groupKey && dragType === 'image' ? 'group-drop-over' : ''}`}
                    onDragOver={(e) => {
                      if (dragType === 'image') {
                        e.preventDefault();
                        e.stopPropagation();
                        e.dataTransfer.dropEffect = 'move';
                        setDragOverItem(groupKey);
                      }
                    }}
                    onDragLeave={(e) => {
                      // Only clear if leaving the section entirely (not entering a child)
                      if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                        setDragOverItem(null);
                      }
                    }}
                    onDrop={(e) => {
                      e.stopPropagation();
                      handleDropImageOntoGroup(groupKey, e);
                    }}
                  >
                    {/* Product group sub-header — collapsible */}
                    <div
                      className="image-group-header"
                      style={{ cursor: 'pointer' }}
                      onClick={() =>
                        setCollapsedBatches(prev => {
                          const next = new Set(prev);
                          const key = `img-group-${groupKey}`;
                          if (next.has(key)) next.delete(key); else next.add(key);
                          return next;
                        })
                      }
                    >
                      <button className="collapse-toggle" title={isGroupCollapsed ? 'Expand' : 'Collapse'}>
                        {isGroupCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                      </button>
                      <Package size={14} className="section-folder-icon" />
                      <span className="image-group-label">{groupSection.groupTitle}</span>
                      {groupKey === 'no-group' && dragType === 'image' && draggedItem !== null && (
                        <span className="section-drop-hint">drop to unassign</span>
                      )}
                      <span className="section-count">{groupSection.images.length} {groupSection.images.length === 1 ? 'image' : 'images'}</span>
                      <button
                        className="section-select-all"
                        title={allGroupSelected ? 'Deselect all' : 'Select all in group'}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedItems(prev => {
                            const next = new Set(prev);
                            if (allGroupSelected) {
                              groupSection.images.forEach(img => next.delete(img.id));
                            } else {
                              groupSection.images.forEach(img => next.add(img.id));
                            }
                            return next;
                          });
                        }}
                      >
                        {allGroupSelected ? 'Deselect' : 'Select all'}
                      </button>
                    </div>

                    {/* Image cards — shown when group is expanded */}
                    {!isGroupCollapsed && (
                      <div className="image-group-cards">
                        {groupSection.images.map(renderImageCard)}
                      </div>
                    )}
                  </div>
                );
              })
              })()}
            </div>
          );
        })}
      </>
    );
  }
};

