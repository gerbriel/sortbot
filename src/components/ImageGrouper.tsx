import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from 'react';
import type { ClothingItem } from '../App';
import { supabase } from '../lib/supabase';
import { Package, Image, ArrowDown, ArrowUp, ArrowUpDown, Check } from 'lucide-react';
import LoadingProgress from './LoadingProgress';
import { log } from '../lib/debugLogger';
import './ImageGrouper.css';
import './ProductDescriptionGenerator.css'; // crop-fs-* styles shared with PDG

// Buckets prefix for parsing storage paths out of public URLs
const STORAGE_PUBLIC_PREFIX = '/storage/v1/object/public/product-images/';

/** Retry a failed image load up to 3 times with exponential backoff + cache-bust.
 *  Stores attempt count on the element itself via data-retry so no React state is needed.
 *  Called as onError handler on bare <img> tags that can't use LazyImg.
 *  After all retries are exhausted the broken product_images row is deleted from
 *  the DB so it never poisons the session again on next reload. */
function retryImg(e: React.SyntheticEvent<HTMLImageElement>) {
  const img = e.currentTarget;
  const attempt = parseInt(img.dataset.retry ?? '0', 10);
  if (attempt >= 3) {
    const rawSrc = (img.dataset.src ?? img.src).split('?')[0];
    log.img(`load failed after 3 retries | src=${rawSrc.split('/').pop()}`);
    // Extract storage_path from the public URL and delete the orphaned DB row.
    const idx = rawSrc.indexOf(STORAGE_PUBLIC_PREFIX);
    if (idx !== -1) {
      const storagePath = rawSrc.slice(idx + STORAGE_PUBLIC_PREFIX.length);
      supabase.from('product_images').delete().eq('storage_path', storagePath).then(({ error }) => {
        if (error) {
          console.warn('[img] failed to delete orphaned product_images row:', storagePath, error.message);
        } else {
          console.log('[img] 🗑️ deleted orphaned product_images row for missing file:', storagePath);
        }
      });
    }
    return; // show broken placeholder
  }
  img.dataset.retry = String(attempt + 1);
  const delay = 500 * Math.pow(3, attempt); // 500ms, 1500ms, 4500ms
  const originalSrc = img.dataset.src ?? img.src.split('?')[0];
  if (!img.dataset.src) img.dataset.src = img.src.split('?')[0];
  log.img(`load error → retry ${attempt + 1}/3 in ${delay}ms | src=${originalSrc.split('/').pop()}`);
  setTimeout(() => { img.src = `${originalSrc}?t=${Date.now()}`; }, delay);
}

export interface ImageGrouperStats {
  multiImageGroups: number;
  singles: number;
  totalListings: number;
  totalImages: number;
}

export interface GrouperActions {
  groupSelected: () => void;
  ungroupSelected: () => void;
  ungroupAll: () => void;
  clearSelection: () => void;
  deleteSelected: () => void;
  selectedCount: number;
}

interface ImageGrouperProps {
  items: ClothingItem[];
  onGrouped: (items: ClothingItem[]) => void;
  onStatsChange?: (stats: ImageGrouperStats) => void;
  userId?: string;
  batchId?: string; // used to detect batch switches and reset internal state
  onImageDeleted?: () => void; // called after any delete syncs to DB, so Library can refresh
  onSelectionChange?: (selectedIds: Set<string>) => void; // lift selection state so parent can pass to CategoryZones
  onActionsReady?: (actions: GrouperActions) => void; // lift action callbacks so parent can render buttons elsewhere
}

const ImageGrouper: React.FC<ImageGrouperProps> = ({ items, onGrouped, onStatsChange, userId, batchId, onImageDeleted, onSelectionChange, onActionsReady }) => {
  const [groupedItems, setGroupedItems] = useState<ClothingItem[]>([]);
  // Ref mirror so the initializeItems effect always reads the live groupedItems value
  // without capturing a stale closure (the effect only depends on [items]).
  const groupedItemsRef = useRef<ClothingItem[]>([]);
  groupedItemsRef.current = groupedItems;

  // ── Batch switch reset ────────────────────────────────────────────────────
  // When batchId changes (user opens a different batch from Library), wipe all
  // internal state so the old batch's items don't bleed into the new batch.
  // This runs BEFORE initializeItems so groupedItemsRef is empty when the new
  // batch items arrive and they are treated as fresh rather than duplicates.
  const prevBatchIdRef = useRef<string | undefined>(batchId);
  useEffect(() => {
    if (batchId && batchId !== prevBatchIdRef.current) {
      console.log(`[GROUPER] batchId changed: ${prevBatchIdRef.current} → ${batchId} — resetting internal state (had ${groupedItemsRef.current.length} items)`);
      prevBatchIdRef.current = batchId;
      groupedItemsRef.current = [];
      setGroupedItems([]);
      historyRef.current = [];
      redoStackRef.current = [];
      setCanUndo(false);
      setCanRedo(false);
      updateSelection(new Set());
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batchId]);

  // ── Undo/Redo history (Cmd+Z / Cmd+Shift+Z) ──────────────────────────────
  // Keep up to 50 previous groupedItems snapshots.  commitUpdate() is the single
  // write path for every user-driven grouping action; it pushes the CURRENT state
  // onto the undo stack before applying the new one, and clears the redo stack.
  const MAX_HISTORY = 50;
  const historyRef = useRef<ClothingItem[][]>([]);
  const redoStackRef = useRef<ClothingItem[][]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const commitUpdate = (newItems: ClothingItem[], skipHistory = false) => {
    if (!skipHistory) {
      historyRef.current = [
        ...historyRef.current.slice(-MAX_HISTORY + 1),
        groupedItemsRef.current.map(i => ({ ...i })), // deep-clone snapshot
      ];
      redoStackRef.current = []; // new action clears redo
      setCanUndo(true);
      setCanRedo(false);
    }
    setGroupedItems(newItems);
    onGrouped(newItems);
  };

  /**
   * Concurrent-safe state update using React's functional setState.
   * Each call sees the LATEST state regardless of how many other setGroupedItems
   * calls are queued — no race condition even with parallel async crop operations.
   *
   * NOTE: Does NOT push to undo history and does NOT call onGrouped.
   * Callers handling batches should call onGrouped(groupedItemsRef.current) once
   * the entire batch completes (after all awaits resolve, groupedItemsRef.current
   * will reflect the final merged state).
   */
  const commitFunctional = (mapper: (prev: ClothingItem[]) => ClothingItem[]) => {
    setGroupedItems(prev => {
      const next = mapper(prev);
      console.log('[commitFunctional] prev.length=', prev.length, '→ next.length=', next.length, 'ref updated synchronously');
      groupedItemsRef.current = next;
      return next;
    });
  };

  const handleUndo = () => {
    if (historyRef.current.length === 0) return;
    const prev = historyRef.current[historyRef.current.length - 1];
    redoStackRef.current = [...redoStackRef.current, groupedItemsRef.current.map(i => ({ ...i }))];
    historyRef.current = historyRef.current.slice(0, -1);
    setCanUndo(historyRef.current.length > 0);
    setCanRedo(true);
    setGroupedItems(prev);
    onGrouped(prev);
  };

  const handleRedo = () => {
    if (redoStackRef.current.length === 0) return;
    const next = redoStackRef.current[redoStackRef.current.length - 1];
    historyRef.current = [...historyRef.current, groupedItemsRef.current.map(i => ({ ...i }))];
    redoStackRef.current = redoStackRef.current.slice(0, -1);
    setCanUndo(true);
    setCanRedo(redoStackRef.current.length > 0);
    setGroupedItems(next);
    onGrouped(next);
  };

  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  // Guard against double-fire: hardware double-clicks emit two rapid mousedown events
  // (mousedown→mouseup→mousedown→mouseup→dblclick), causing toggleItemSelection to run
  // twice within ~15ms and leave the item in the wrong state.  Track the last toggle
  // timestamp per item; ignore any second call within 200ms of the first.
  const lastToggleTimeRef = useRef<Map<string, number>>(new Map());
  const [draggedItem, setDraggedItem] = useState<ClothingItem | null>(null);
  const [draggedFromGroup, setDraggedFromGroup] = useState<string | null>(null);
  const [dragOverGroup, setDragOverGroup] = useState<string | null>(null);

  // Photo reorder drag state (within a group)
  const [draggedPhotoId, setDraggedPhotoId] = useState<string | null>(null);
  const [draggedPhotoGroupId, setDraggedPhotoGroupId] = useState<string | null>(null);
  const [dragOverPhotoId, setDragOverPhotoId] = useState<string | null>(null);

  // Reorder drag state for the singles grid
  const [reorderDragId, setReorderDragId] = useState<string | null>(null);
  const [reorderOverId, setReorderOverId] = useState<string | null>(null);
  const [reorderOverSide, setReorderOverSide] = useState<'left' | 'right'>('left');

  // Progressive rendering for singles — mount 150 at a time so the initial
  // render with hundreds of items doesn’t block the main thread.
  const SINGLES_PAGE = 150;
  const [visibleSingleCount, setVisibleSingleCount] = useState(SINGLES_PAGE);
  // Callback ref: creates/destroys IntersectionObserver when sentinel mounts/unmounts.
  // No useEffect needed — avoids hook-count instability from array-dep changes.
  const sentinelCallbackRef = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => { if (entries[0]?.isIntersecting) setVisibleSingleCount(prev => prev + SINGLES_PAGE); },
      { rootMargin: '400px' }
    );
    observer.observe(el);
    // Cleanup is automatic when the element unmounts (next sentinel replaces it)
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // Manual order: array of item IDs. Empty = use default sort.
  const [manualOrder, setManualOrder] = useState<string[]>([]);
  const scrollContentRef = useRef<HTMLDivElement | null>(null);
  const autoScrollRafRef = useRef<number | null>(null);
  const [uploadedImages, setUploadedImages] = useState<Set<string>>(new Set());
  
  // Loading progress state
  const [isLoading, setIsLoading] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [loadingMessage, setLoadingMessage] = useState('');

  // Sort order for individual items and product groups
  type SortOrder = 'date-asc' | 'date-desc' | 'name-asc' | 'name-desc';
  const [sortOrder, setSortOrder] = useState<SortOrder>('date-asc');

  // Filters — all combinable (AND logic).
  // date:     '' = all dates | YYYY-MM-DD = specific day
  // view:     'all' | 'groups' | 'singles'
  // category: '' = all | 'uncategorized' | any category string
  interface Filters { date: string; view: 'all' | 'groups' | 'singles'; category: string; }
  const [filters, setFilters] = useState<Filters>({ date: '', view: 'all', category: '' });
  const setFilter = <K extends keyof Filters>(key: K, val: Filters[K]) =>
    setFilters(prev => ({ ...prev, [key]: val }));

  // Auto-group state — number of photos per product
  const [autoGroupN, setAutoGroupN] = useState<string>('4');

  // Grid columns per row (2–12)
  const [columnsPerRow, setColumnsPerRow] = useState<number>(8);

  // Format painter — copy crop/rotation style from one image and paste to others
  const [copiedRotation, setCopiedRotation] = useState<number | null>(null);
  const [copiedCrop, setCopiedCrop] = useState<{ x: number; y: number; w: number; h: number } | null | undefined>(undefined);
  const [cropPasteProgress, setCropPasteProgress] = useState<{ done: number; total: number; status: 'running' | 'done'; failed: string[] } | null>(null);

  // Lightbox state  — pool stores item IDs (not URLs) so we can look up rotation
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [lightboxItemId, setLightboxItemId] = useState<string | null>(null);
  const [lightboxPool, setLightboxPool] = useState<string[]>([]); // array of item IDs
  const [lightboxIndex, setLightboxIndex] = useState<number>(0);

  // Crop UI state (full-screen iOS-style, same as Step 3)
  const [cropModal, setCropModal] = useState<{ open: boolean; itemId?: string }>({ open: false });
  // Ref mirror — lets the overlay onClick/onKeyDown always read the LIVE crop state
  // without depending on a potentially-stale render-time closure.
  const cropModalRef = useRef<{ open: boolean; itemId?: string }>({ open: false });
  cropModalRef.current = cropModal;
  // Synchronous guard: set to true IMMEDIATELY when the ✂ Crop button fires,
  // before any re-render, so the overlay onClick can't slip through the window
  // between setState and the re-render committing cropModalRef.current.open = true.
  const cropRequestedRef = useRef(false);
  const [tempCrop, setTempCrop] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [aspectLock, setAspectLock] = useState<number | null>(null);
  const [activePreset, setActivePreset] = useState<string>('FREE');
  const cropImgRef  = useRef<HTMLImageElement | null>(null);
  const cropStageRef = useRef<HTMLDivElement | null>(null);
  const [cropImgBounds, setCropImgBounds] = useState<{ l: number; t: number; w: number; h: number } | null>(null);
  const pendingCropModeRef = useRef<CropDragMode | null>(null);
  type CropDragMode = 'new' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw' | 'move';
  const cropDragRef = useRef<{ mode: CropDragMode; startX: number; startY: number; startCrop: { x: number; y: number; w: number; h: number } } | null>(null);

  const getItemUrl = (item: ClothingItem) =>
    item.storagePath
      ? supabase.storage.from('product-images').getPublicUrl(item.storagePath).data.publicUrl
      : (item.imageUrls?.[0] || item.preview || '');

  /** Open lightbox by item ID — builds a pool of item IDs for navigation. */
  const openLightboxForItem = (itemId: string) => {
    const live = groupedItemsRef.current.find(i => i.id === itemId);
    if (!live) { console.warn('[ImageGrouper] openLightboxForItem: item not found', itemId); return; }

    const isGrouped = live.productGroup && live.productGroup !== live.id
      && groupedItemsRef.current.filter(i => i.productGroup === live.productGroup).length > 1;

    const poolItems = isGrouped
      ? groupedItemsRef.current.filter(i => i.productGroup === live.productGroup)
      : singleItemsRef.current;

    const pool = poolItems.map(i => i.id);
    const src = getItemUrl(live);
    const idx = pool.indexOf(live.id);

    if (src) {
      setLightboxPool(pool);
      setLightboxIndex(idx >= 0 ? idx : 0);
      setLightboxItemId(live.id);
      setLightboxSrc(src);
    } else console.warn('[ImageGrouper] openLightboxForItem: no URL found for item', itemId);
  };

  const navigateLightboxGrouper = (dir: 1 | -1) => {
    setLightboxIndex(prev => {
      const ni = (prev + dir + lightboxPool.length) % lightboxPool.length;
      const nextId = lightboxPool[ni];
      const nextItem = groupedItemsRef.current.find(i => i.id === nextId)
        ?? singleItemsRef.current.find(i => i.id === nextId);
      if (nextItem) { setLightboxItemId(nextId); setLightboxSrc(getItemUrl(nextItem)); }
      return ni;
    });
  };

  // ── Crop helpers (mirrors ProductDescriptionGenerator) ────────────────────
  const gcClamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

  const measureGCImg = useCallback(() => {
    if (!cropImgRef.current || !cropStageRef.current) return;
    const ir = cropImgRef.current.getBoundingClientRect();
    const sr = cropStageRef.current.getBoundingClientRect();
    if (ir.width > 0) setCropImgBounds({ l: ir.left - sr.left, t: ir.top - sr.top, w: ir.width, h: ir.height });
  }, []);

  const handleGCPointerDown = (e: React.PointerEvent) => {
    e.preventDefault(); e.stopPropagation();
    const mode: CropDragMode = pendingCropModeRef.current ?? 'new';
    pendingCropModeRef.current = null;
    // If bounds haven't been measured yet (can happen if image was memory-cached),
    // compute them synchronously right now rather than bailing.
    let bounds = cropImgBounds;
    if (!bounds && cropImgRef.current && cropStageRef.current) {
      const ir = cropImgRef.current.getBoundingClientRect();
      const sr = cropStageRef.current.getBoundingClientRect();
      if (ir.width > 0) {
        bounds = { l: ir.left - sr.left, t: ir.top - sr.top, w: ir.width, h: ir.height };
        setCropImgBounds(bounds);
      }
    }
    if (!bounds || !cropStageRef.current) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const sr = cropStageRef.current.getBoundingClientRect();
    const rx = (e.clientX - sr.left - bounds.l) / bounds.w;
    const ry = (e.clientY - sr.top - bounds.t) / bounds.h;
    if (mode === 'new' && (rx < 0 || rx > 1 || ry < 0 || ry > 1)) return;
    cropDragRef.current = {
      mode,
      startX: rx,
      startY: ry,
      startCrop: tempCrop ? { ...tempCrop } : { x: 0, y: 0, w: 100, h: 100 },
    };
  };

  const handleGCPointerMove = (e: React.PointerEvent) => {
    const drag = cropDragRef.current;
    if (!drag || !cropImgBounds || !cropStageRef.current) return;
    const sr = cropStageRef.current.getBoundingClientRect();
    const cx = gcClamp((e.clientX - sr.left - cropImgBounds.l) / cropImgBounds.w, 0, 1);
    const cy = gcClamp((e.clientY - sr.top - cropImgBounds.t) / cropImgBounds.h, 0, 1);
    const dx = (cx - drag.startX) * 100, dy = (cy - drag.startY) * 100;
    const sc = drag.startCrop;
    let { x, y, w, h } = sc;
    if (drag.mode === 'new') {
      const nx = gcClamp(cx * 100, 0, 100), ny = gcClamp(cy * 100, 0, 100);
      const sx = drag.startX * 100, sy = drag.startY * 100;
      x = Math.min(nx, sx); y = Math.min(ny, sy); w = Math.abs(nx - sx); h = Math.abs(ny - sy);
      if (aspectLock) { h = w / aspectLock; if (y + h > 100) { h = 100 - y; w = h * aspectLock; } }
    } else if (drag.mode === 'move') {
      x = gcClamp(sc.x + dx, 0, 100 - sc.w); y = gcClamp(sc.y + dy, 0, 100 - sc.h);
    } else {
      if (drag.mode.includes('e')) { w = gcClamp(sc.w + dx, 5, 100 - sc.x); }
      if (drag.mode.includes('s')) { h = gcClamp(sc.h + dy, 5, 100 - sc.y); }
      if (drag.mode.includes('w')) { const nx = gcClamp(sc.x + dx, 0, sc.x + sc.w - 5); w = sc.x + sc.w - nx; x = nx; }
      if (drag.mode.includes('n')) { const ny = gcClamp(sc.y + dy, 0, sc.y + sc.h - 5); h = sc.y + sc.h - ny; y = ny; }
      if (aspectLock) {
        if (Math.abs(dx) >= Math.abs(dy)) { h = w / aspectLock; } else { w = h * aspectLock; }
        x = gcClamp(x, 0, 100 - w); y = gcClamp(y, 0, 100 - h);
      }
    }
    setTempCrop({ x: gcClamp(x,0,100), y: gcClamp(y,0,100), w: gcClamp(w,1,100-x), h: gcClamp(h,1,100-y) });
  };

  const handleGCPointerUp = () => { cropDragRef.current = null; };

  const GC_PRESETS: { label: string; ratio: number | null }[] = [
    { label: 'FREE', ratio: null }, { label: '1:1', ratio: 1 },
    { label: '9:16', ratio: 9/16 }, { label: '16:9', ratio: 16/9 }, { label: '4:5', ratio: 4/5 }, { label: '3:2', ratio: 3/2 },
  ];

  const applyGCPreset = (label: string, ratio: number | null) => {
    setActivePreset(label); setAspectLock(ratio);
    if (!ratio || !cropImgBounds) return;
    const { w: cw, h: ch } = cropImgBounds;
    let pw = 1, ph = 1;
    if (cw / ch > ratio) { ph = 1; pw = ratio * ch / cw; }
    else { pw = 1; ph = (cw / ch) / ratio; }
    setTempCrop({ x: (1-pw)/2*100, y: (1-ph)/2*100, w: pw*100, h: ph*100 });
  };

  useEffect(() => {
    if (!cropModal.open) { setCropImgBounds(null); return; }
    // Crop is now open — clear the synchronous guard so overlay onClick works normally again
    cropRequestedRef.current = false;
    let id = requestAnimationFrame(() => { id = requestAnimationFrame(measureGCImg); });
    return () => cancelAnimationFrame(id);
  }, [cropModal.open, lightboxSrc, measureGCImg]);

  // Measure immediately after the crop UI commits to the DOM (handles memory-cached images
  // that don't fire onLoad). useLayoutEffect runs after DOM commit, before paint, so
  // getBoundingClientRect returns real layout values.
  useLayoutEffect(() => {
    if (!cropModal.open) return;
    measureGCImg();
  }, [cropModal.open, measureGCImg]);

  const applyAndPersistTransformGrouper = async (itemId: string, cropOverride: { x: number; y: number; w: number; h: number }, rotationOverride?: number) => {
    const baseItem = groupedItemsRef.current.find(i => i.id === itemId);
    if (!baseItem) { console.error('[crop] baseItem not found', itemId); return; }
    const rot = rotationOverride !== undefined ? rotationOverride : (baseItem.imageRotation || 0);
    const item = { ...baseItem, imageRotation: rot, crop: cropOverride };
    console.log('[crop] starting — item:', itemId, 'storagePath:', item.storagePath, 'crop:', cropOverride);
    try {
      const { createTransformedFile } = await import('../lib/imageTransforms');
      const file = await createTransformedFile(item);
      if (!file) { console.error('[crop] createTransformedFile returned null — check CORS or image src'); return; }
      console.log('[crop] transformed file ok, size:', file.size);

      // ── Determine original path to cache ────────────────────────────────────
      // On the FIRST crop the item's storagePath IS the original.
      // On subsequent re-crops, item.originalStoragePath is already set.
      const isFirstCrop = !item.originalStoragePath;
      const originalPathToCache  = isFirstCrop ? (item.storagePath ?? null)   : item.originalStoragePath ?? null;
      const originalUrlToCache   = isFirstCrop ? (item.imageUrls?.[0] || item.preview || '') : item.originalUrl ?? '';
      // The "previous crop" — if re-cropping, this is the intermediate cropped
      // file that should be deleted (NOT the original).
      const prevCropPath = isFirstCrop ? null : item.storagePath ?? null;

      // ── Upload the newly-cropped image ──────────────────────────────────────
      const oldPath = item.storagePath;
      let newUrl = '';
      let newPath = '';

      if (oldPath) {
        const dir = oldPath.substring(0, oldPath.lastIndexOf('/') + 1);
        const ext = oldPath.split('.').pop() || 'jpg';
        const freshPath = `${dir}cropped-${Date.now()}.${ext}`;
        console.log('[crop] uploading to new path:', freshPath);
        const { data, error } = await supabase.storage
          .from('product-images')
          .upload(freshPath, file, { cacheControl: '3600', upsert: false });
        if (error) {
          console.error('[crop] storage upload error:', error.message);
        } else {
          newPath = data.path;
          newUrl = supabase.storage.from('product-images').getPublicUrl(data.path).data.publicUrl;
          console.log('[crop] upload ok — newPath:', newPath, 'newUrl:', newUrl);
        }
      }

      // Fallback: use uploadTransformedImage with explicit itemId
      if (!newUrl) {
        console.log('[crop] falling back to uploadTransformedImage');
        const { uploadTransformedImage } = await import('../lib/productService');
        const res = await uploadTransformedImage(file, userId, itemId);
        if (res) { newUrl = res.url; newPath = res.path; }
        else { console.error('[crop] uploadTransformedImage also failed'); return; }
      }

      console.log('[crop] writing to DB — product_id:', itemId, 'newPath:', newPath);
      const { error: upsertErr } = await supabase.from('product_images').insert(
        { product_id: itemId, user_id: userId, image_url: newUrl, storage_path: newPath }
      );
      if (upsertErr) console.error('[crop] product_images insert error:', upsertErr.message);
      else console.log('[crop] product_images insert ok');

      // ── Delete the previous CROP (not the original) ─────────────────────────
      // If this is a re-crop, the intermediate cropped file is no longer needed.
      // The original file is intentionally kept in storage so the user can revert.
      if (prevCropPath && prevCropPath !== newPath && prevCropPath !== originalPathToCache) {
        const { error: storageDelErr } = await supabase.storage.from('product-images').remove([prevCropPath]);
        if (storageDelErr) console.warn('[crop] prev-crop storage delete error:', storageDelErr.message);
        const { error: dbDelErr } = await supabase.from('product_images').delete().eq('storage_path', prevCropPath);
        if (dbDelErr) console.warn('[crop] prev-crop DB row delete error:', dbDelErr.message);
        console.log('[crop] deleted previous crop:', prevCropPath);
      } else if (isFirstCrop) {
        console.log('[crop] first crop — original preserved in storage at:', originalPathToCache);
      }

      // ── Update React state via functional updater (race-condition safe) ──────
      console.log('[crop] commitFunctional — item:', itemId, 'newPath:', newPath, 'originalCached:', originalPathToCache);
      const cropMapper = (i: ClothingItem): ClothingItem =>
        i.id === itemId
          ? {
              ...i,
              preview: newUrl,
              thumbnailUrl: newUrl,
              imageUrls: [newUrl],
              storagePath: newPath,
              imageRotation: 0,
              crop: cropOverride,
              // Cache originals on first crop; preserve on re-crops
              originalStoragePath: originalPathToCache ?? i.originalStoragePath,
              originalUrl: (originalUrlToCache || i.originalUrl) as string | undefined,
            }
          : i;
      commitFunctional(prev => prev.map(cropMapper));
      // Notify parent (autoSave) with the computed new items.
      // We CANNOT use groupedItemsRef.current here — it reflects the pre-crop
      // state until React processes the setGroupedItems call above.
      onGrouped(groupedItemsRef.current.map(cropMapper));

      console.log('[crop] done ✅ item:', itemId, 'newUrl:', newUrl);
      // Evict the old URL from the session image cache so a subsequent re-crop
      // loads the freshly-cropped image rather than the stale pre-crop bitmap.
      const { evictCachedImage } = await import('../lib/imageTransforms');
      if (item.preview) evictCachedImage(item.preview);
      if (item.imageUrls?.[0]) evictCachedImage(item.imageUrls[0]);
    } catch (err) { console.error('[crop] unexpected error:', err); }
  };

  // ── Revert a single item to its cached original ─────────────────────────────
  const revertToOriginal = async (itemId: string) => {
    const item = groupedItemsRef.current.find(i => i.id === itemId);
    if (!item?.originalStoragePath || !item.originalUrl) {
      console.warn('[revert] no original cached for item', itemId);
      return;
    }
    console.log('[revert] reverting item:', itemId, 'to', item.originalStoragePath);
    try {
      // Delete the current cropped file from storage (only if it differs from the original)
      if (item.storagePath && item.storagePath !== item.originalStoragePath) {
        await supabase.storage.from('product-images').remove([item.storagePath]);
        await supabase.from('product_images').delete().eq('storage_path', item.storagePath);
      }
      // Restore state to original
      const revertMapper = (i: ClothingItem): ClothingItem =>
        i.id === itemId
          ? {
              ...i,
              preview: item.originalUrl!,
              thumbnailUrl: item.originalUrl!,
              imageUrls: [item.originalUrl!],
              storagePath: item.originalStoragePath,
              imageRotation: 0,
              crop: undefined,
              originalStoragePath: undefined,
              originalUrl: undefined,
            }
          : i;
      commitFunctional(prev => prev.map(revertMapper));
      // Pass computed new items — groupedItemsRef.current is still pre-revert here
      onGrouped(groupedItemsRef.current.map(revertMapper));
      console.log('[revert] done for item:', itemId);
    } catch (err) { console.error('[revert] error:', err); }
  };

  // ── Shared batch crop paste helper ─────────────────────────────────────────
  // Applies crop (+ optional rotation) to a list of item IDs in parallel batches.
  // Tracks failures and exposes a retry button in the progress toast.
  const runCropBatchPaste = async (
    targetIds: string[],
    crop: { x: number; y: number; w: number; h: number },
    rotation: number | null = null,
  ) => {
    console.log('[paste] runCropBatchPaste START — ids:', targetIds.length, 'crop:', crop, 'rotation:', rotation);
    console.log('[paste] groupedItemsRef.current.length at start:', groupedItemsRef.current.length);
    if (targetIds.length === 0) { console.warn('[paste] targetIds empty — nothing to do'); return; }
    const total = targetIds.length;
    const failed: string[] = [];
    setCropPasteProgress({ done: 0, total, status: 'running', failed: [] });
    let wakeLock: WakeLockSentinel | null = null;
    try {
      if ('wakeLock' in navigator)
        wakeLock = await (navigator as Navigator & { wakeLock: { request(type: string): Promise<WakeLockSentinel> } }).wakeLock.request('screen');
    } catch { /* ignore */ }
    const BATCH = 8;
    let done = 0;
    for (let i = 0; i < targetIds.length; i += BATCH) {
      const chunk = targetIds.slice(i, i + BATCH);
      await Promise.all(chunk.map(id =>
        applyAndPersistTransformGrouper(id, crop, rotation !== null ? rotation : undefined)
          .then(() => { done++; console.log('[paste] ✅ item done:', id, done, '/', total); setCropPasteProgress({ done, total, status: 'running', failed: [...failed] }); })
          .catch((err) => { done++; failed.push(id); console.error('[paste] ❌ item failed:', id, err); setCropPasteProgress({ done, total, status: 'running', failed: [...failed] }); })
      ));
    }
    if (wakeLock) { try { await wakeLock.release(); } catch { /* ignore */ } }
    console.log('[paste] all done — failed:', failed.length, 'groupedItemsRef.current.length:', groupedItemsRef.current.length);
    console.log('[paste] scheduling deferred onGrouped with', groupedItemsRef.current.length, 'items');
    setTimeout(() => {
      console.log('[paste] deferred onGrouped firing — ref.length:', groupedItemsRef.current.length);
      onGrouped(groupedItemsRef.current);
    }, 0);
    const snapshot = [...failed];
    setCropPasteProgress({ done: total, total, status: 'done', failed: snapshot });
    if (snapshot.length === 0) setTimeout(() => setCropPasteProgress(null), 3500);
  };

  // Revert multiple items (selected or all cropped)
  const revertToOriginalBatch = async (itemIds: string[]) => {
    const toDo = itemIds.filter(id => {
      const it = groupedItemsRef.current.find(i => i.id === id);
      return it?.originalStoragePath && it.originalUrl;
    });
    if (toDo.length === 0) { alert('None of the selected images have a cached original to revert to.'); return; }
    if (!window.confirm(`Revert ${toDo.length} image${toDo.length > 1 ? 's' : ''} to their original (un-cropped) versions? The cropped copies will be deleted.`)) return;
    for (const id of toDo) {
      await revertToOriginal(id);
    }
    // Each revertToOriginal call already passed the correct updated state via onGrouped.
    // Schedule one final call after React flushes all the setGroupedItems updates
    // so App.tsx auto-save captures the fully merged post-revert state.
    setTimeout(() => onGrouped(groupedItemsRef.current), 0);
  };

  // ── Clear the originals cache ────────────────────────────────────────────────
  // Permanently deletes the preserved original files from Supabase Storage for
  // items that have been cropped.  After clearing, revert is no longer possible.
  const clearOriginalsCache = async (scope: 'selected' | 'all') => {
    const items = groupedItemsRef.current;
    const toProcess = scope === 'selected'
      ? items.filter(i => selectedItems.has(i.id) && i.originalStoragePath)
      : items.filter(i => i.originalStoragePath);
    if (toProcess.length === 0) { alert('No cached originals found to clear.'); return; }
    if (!window.confirm(
      `Permanently delete the original (pre-crop) files for ${toProcess.length} image${toProcess.length > 1 ? 's' : ''} from storage?\n\nThis frees up storage but means you can no longer revert those images. This cannot be undone.`
    )) return;

    for (const item of toProcess) {
      try {
        await supabase.storage.from('product-images').remove([item.originalStoragePath!]);
        await supabase.from('product_images').delete().eq('storage_path', item.originalStoragePath!);
      } catch (err) { console.warn('[clearCache] error deleting original for', item.id, err); }
    }
    // Clear cache fields from state (skip undo — this is a storage-level operation)
    const clearCacheMapper = (i: ClothingItem): ClothingItem =>
      toProcess.find(t => t.id === i.id)
        ? { ...i, originalStoragePath: undefined, originalUrl: undefined }
        : i;
    commitFunctional(prev => prev.map(clearCacheMapper));
    // Pass computed new items — groupedItemsRef.current is still pre-clear here
    onGrouped(groupedItemsRef.current.map(clearCacheMapper));
    alert(`Cleared ${toProcess.length} original${toProcess.length > 1 ? 's' : ''} from cache.`);
  };

  // ── Selection box state ──────────────────────────────────────────────────────
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectionStart, setSelectionStart] = useState<{ x: number; y: number } | null>(null);
  const [selectionBox, setSelectionBox] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [activeContainer, setActiveContainer] = useState<'singles' | 'groups' | null>(null);
  const [selectionThresholdMet, setSelectionThresholdMet] = useState(false);

  // Refs for selection containers
  const singlesContainerRef = useRef<HTMLDivElement>(null);
  const groupsContainerRef = useRef<HTMLDivElement>(null);
  const currentContainerRef = useRef<HTMLElement | null>(null);

  // Stable ref so the rubber-band mouseup closure always calls the current callback
  // even though it was captured during the render that started the drag.
  const onSelectionChangeRef = useRef(onSelectionChange);
  onSelectionChangeRef.current = onSelectionChange;

  // Refs that let the rubber-band useEffect read live state without being in the dep array.
  // This is critical: every setSelectionBox() call would otherwise re-register mousemove/mouseup
  // listeners on every pixel of movement, causing event drops and an unreliable drag.
  const selectionStartRef = useRef(selectionStart);
  selectionStartRef.current = selectionStart;
  const selectionBoxRef = useRef(selectionBox);
  selectionBoxRef.current = selectionBox;
  const selectionThresholdMetRef = useRef(selectionThresholdMet);
  selectionThresholdMetRef.current = selectionThresholdMet;
  const activeContainerRef = useRef(activeContainer);
  activeContainerRef.current = activeContainer;
  const selectedItemsRef = useRef(selectedItems);
  selectedItemsRef.current = selectedItems;
  // groupedItemsRef already mirrors groupedItems on every render (defined at line ~38)

  const SELECTION_THRESHOLD = 5; // pixels - must move this much to activate selection
  const AUTO_SCROLL_ZONE = 60;   // px from edge that triggers auto-scroll
  const AUTO_SCROLL_MAX  = 18;   // max px per frame at full edge

  // Stores latest mouse position so the RAF scroll loop always has fresh coords
  // without adding to the effect's dep array.
  const lastMouseClientRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // Global mouse handlers for rubber-band selection.
  //
  // CRITICAL: dep array is [isSelecting] ONLY.
  // All mutable values (selectionStart, selectionBox, selectedItems, etc.) are read
  // through refs that are updated every render. If those values were in the dep array,
  // every setSelectionBox() call during a drag would re-register the listeners on every
  // pixel of movement — causing dropped events and making the selector feel unreliable.
  useEffect(() => {
    if (!isSelecting) return;

    // ── Auto-scroll RAF loop ──────────────────────────────────────────────────
    // Runs every animation frame while drag is active. When the mouse is within
    // AUTO_SCROLL_ZONE px of the container's top or bottom visible edge, scrolls
    // the container and re-fires the selection-box update so items below/above the
    // fold get included as the user drags.
    let rafId: number;
    const scrollLoop = () => {
      // scrollEl is the actual scrollable outer wrapper (grouper-scroll-content).
      // gridContainer is the inner items grid used for selection-box coordinate math.
      const scrollEl       = scrollContentRef.current;
      const gridContainer  = currentContainerRef.current;
      if (scrollEl && gridContainer) {
        const rect   = scrollEl.getBoundingClientRect();
        const mouseY = lastMouseClientRef.current.y;
        const distFromBottom = rect.bottom - mouseY;
        const distFromTop    = mouseY - rect.top;

        let scrollDelta = 0;
        if (distFromBottom <= 0) {
          // Cursor is past the bottom edge — scroll at full speed
          scrollDelta = AUTO_SCROLL_MAX;
        } else if (distFromBottom < AUTO_SCROLL_ZONE) {
          // Near bottom — scroll down, faster the closer to the edge
          scrollDelta = Math.round(AUTO_SCROLL_MAX * (1 - distFromBottom / AUTO_SCROLL_ZONE));
        } else if (distFromTop <= 0) {
          // Cursor is past the top edge — scroll up at full speed
          scrollDelta = -AUTO_SCROLL_MAX;
        } else if (distFromTop < AUTO_SCROLL_ZONE) {
          // Near top — scroll up
          scrollDelta = -Math.round(AUTO_SCROLL_MAX * (1 - distFromTop / AUTO_SCROLL_ZONE));
        }

        if (scrollDelta !== 0) {
          scrollEl.scrollTop += scrollDelta;
          // Re-trigger the move handler with the synthetic current mouse position
          // so the selection box grows to cover newly revealed items.
          const start = selectionStartRef.current;
          if (start && selectionThresholdMetRef.current) {
            const gridRect  = gridContainer.getBoundingClientRect();
            const currentX  = lastMouseClientRef.current.x - gridRect.left + gridContainer.scrollLeft;
            const currentY  = lastMouseClientRef.current.y - gridRect.top  + gridContainer.scrollTop;
            const x = Math.min(start.x, currentX);
            const y = Math.min(start.y, currentY);
            setSelectionBox({ x, y, width: Math.abs(currentX - start.x), height: Math.abs(currentY - start.y) });
          }
        }
      }
      rafId = requestAnimationFrame(scrollLoop);
    };
    rafId = requestAnimationFrame(scrollLoop);
    // ─────────────────────────────────────────────────────────────────────────

    const handleGlobalMouseMove = (e: MouseEvent) => {
      lastMouseClientRef.current = { x: e.clientX, y: e.clientY };
      const start = selectionStartRef.current;
      if (!start || !currentContainerRef.current) return;

      const containerRef = currentContainerRef.current;
      const rect = containerRef.getBoundingClientRect();
      const currentX = e.clientX - rect.left + containerRef.scrollLeft;
      const currentY = e.clientY - rect.top + containerRef.scrollTop;

      // Calculate distance moved
      const distanceMoved = Math.sqrt(
        Math.pow(currentX - start.x, 2) +
        Math.pow(currentY - start.y, 2)
      );

      // Only show selection box if moved beyond threshold
      if (distanceMoved < SELECTION_THRESHOLD) {
        return;
      }

      // Threshold met — activate selection box (idempotent setState is fine here)
      if (!selectionThresholdMetRef.current) {
        setSelectionThresholdMet(true);
      }

      // Calculate selection box — ensure positive dimensions
      const x = Math.min(start.x, currentX);
      const y = Math.min(start.y, currentY);
      const width = Math.abs(currentX - start.x);
      const height = Math.abs(currentY - start.y);

      setSelectionBox({ x, y, width, height });
    };

    const handleGlobalMouseUp = (e: MouseEvent) => {
      // Only perform selection if threshold was met
      const box = selectionBoxRef.current;
      if (!box || !currentContainerRef.current || !selectionThresholdMetRef.current) {
        setIsSelecting(false);
        setSelectionStart(null);
        setSelectionBox(null);
        setActiveContainer(null);
        setSelectionThresholdMet(false);
        currentContainerRef.current = null;
        return;
      }

      const containerRef = currentContainerRef.current;
      const container = activeContainerRef.current;

      // In the singles section: rubber-band selects individual items.
      // In the groups section: rubber-band selects whole group cards.
      const newSelected = new Set(e.shiftKey ? selectedItemsRef.current : new Set<string>());

      if (container === 'groups') {
        // Select whole group cards that intersect the rubber-band
        const groupCards = containerRef.querySelectorAll<HTMLElement>('.product-group-card[data-group-id]');
        groupCards.forEach((element) => {
          const itemRect = element.getBoundingClientRect();
          const containerRect = containerRef.getBoundingClientRect();
          const itemX = itemRect.left - containerRect.left + containerRef.scrollLeft;
          const itemY = itemRect.top - containerRect.top + containerRef.scrollTop;
          const intersects = !(
            box.x + box.width < itemX ||
            box.x > itemX + itemRect.width ||
            box.y + box.height < itemY ||
            box.y > itemY + itemRect.height
          );
          if (intersects) {
            const gId = element.getAttribute('data-group-id');
            if (gId) {
              // Add all photo IDs in this group
              groupedItemsRef.current
                .filter(i => (i.productGroup || i.id) === gId)
                .forEach(i => newSelected.add(i.id));
            }
          }
        });
      } else {
        // Singles section: select individual item cards
        const itemElements = containerRef.querySelectorAll('.single-item-card[data-item-id]');
        itemElements.forEach((element) => {
          const itemRect = element.getBoundingClientRect();
          const containerRect = containerRef.getBoundingClientRect();
          const itemX = itemRect.left - containerRect.left + containerRef.scrollLeft;
          const itemY = itemRect.top - containerRect.top + containerRef.scrollTop;
          const intersects = !(
            box.x + box.width < itemX ||
            box.x > itemX + itemRect.width ||
            box.y + box.height < itemY ||
            box.y > itemY + itemRect.height
          );
          if (intersects) {
            const itemId = element.getAttribute('data-item-id');
            if (itemId) newSelected.add(itemId);
          }
        });
      }

      log.grouper(`rubberBandSelect | selected=${newSelected.size}`);
      setSelectedItems(newSelected);
      onSelectionChangeRef.current?.(newSelected);
      setIsSelecting(false);
      setSelectionStart(null);
      setSelectionBox(null);
      setActiveContainer(null);
      setSelectionThresholdMet(false);
      currentContainerRef.current = null;
    };

    document.addEventListener('mousemove', handleGlobalMouseMove);
    document.addEventListener('mouseup', handleGlobalMouseUp);

    return () => {
      cancelAnimationFrame(rafId);
      document.removeEventListener('mousemove', handleGlobalMouseMove);
      document.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSelecting]);

  // Click-outside: deselect everything when clicking on neutral canvas area.
  // IMPORTANT: Do NOT clear selection when the user clicks inside the CategoryZones
  // panel (category-zone, preset buttons, etc.) — those clicks are meant to consume
  // the current selection (assign category / apply preset), not discard it.
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      const isSafeTarget = t.closest(
        '.single-item-card, .product-group-card, .group-header, .toolbar, button, [role="button"],' +
        '.category-zone, .category-zones-container, .category-zones, .category-list,' +
        '.grouper-actions-sidebar'
      );
      if (!isSafeTarget) {
        if (selectedItems.size > 0) updateSelection(new Set());
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [selectedItems]);

  // ⌘Enter / Ctrl+Enter — group selected items keyboard shortcut
  // (⌘G is intercepted by Chrome/Safari as "Find Next" before JS can prevent it)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        createGroupFromSelected();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [selectedItems]); // re-bind when selectedItems changes so createGroupFromSelected closure is fresh

  // ⌘A            — select ALL singles (individual images only, not grouped items)
  // ⌘Shift+A      — select ALL multi-image groups only (not singles)
  // ⌘D            — deselect everything
  // ⌘A / ⌘Shift+A are toggles: pressing again when everything targeted is already selected → deselects
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      // Only fire when Step 2 (the grouper) is on-screen — skip if an input/textarea has focus
      const active = document.activeElement;
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || (active as HTMLElement).isContentEditable)) return;

      if (e.key === 'd') {
        // ⌘D — deselect all
        if (selectedItemsRef.current.size === 0) return;
        e.preventDefault();
        updateSelection(new Set());
      } else if (e.key === 'a') {
        e.preventDefault();
        if (e.shiftKey) {
          // ⌘Shift+A — select all multi-image groups
          const allGroupItemIds = multiItemGroupsRef.current.flatMap(([, items]) => items.map(i => i.id));
          if (allGroupItemIds.length === 0) return;
          const alreadyAllSelected = allGroupItemIds.every(id => selectedItemsRef.current.has(id));
          updateSelection(alreadyAllSelected ? new Set() : new Set(allGroupItemIds));
        } else {
          // ⌘A — select all singles only
          const allSingleIds = singleItemsRef.current.map(i => i.id);
          if (allSingleIds.length === 0) return;
          const alreadyAllSelected = allSingleIds.every(id => selectedItemsRef.current.has(id));
          updateSelection(alreadyAllSelected ? new Set() : new Set(allSingleIds));
        }
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // stable — reads live values via refs, no closure deps needed

  // ⌘Z — undo last grouping action
  // ⌘Shift+Z — redo
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key !== 'z') return;
      const active = document.activeElement;
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || (active as HTMLElement).isContentEditable)) return;
      e.preventDefault();
      if (e.shiftKey) {
        handleRedo();
      } else {
        handleUndo();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []); // stable — reads historyRef/redoStackRef directly

  // ⌘Backspace — ungroup selected items
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key !== 'Backspace') return;
      const active = document.activeElement;
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || (active as HTMLElement).isContentEditable)) return;
      if (selectedItemsRef.current.size === 0) return;
      e.preventDefault();
      // Inline ungroup using stable refs — avoids stale closure over selectedItems/groupedItems
      const updated = groupedItemsRef.current.map(item =>
        selectedItemsRef.current.has(item.id)
          ? { ...item, productGroup: item.id, category: undefined }
          : item
      );
      commitUpdate(updated);
      updateSelection(new Set());
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []); // stable — reads live values via refs

  // Initialize items with individual groups and auto-upload.
  // IMPORTANT: Only process items that are genuinely new (not already in groupedItems).
  // This prevents the items prop feedback loop from resetting group state every time
  // onGrouped() is called (which triggers a re-render with updated items).
  // Uses groupedItemsRef (not groupedItems state) so the closure always sees the
  // latest local state — prevents stale-closure false-positives that made every
  // group/ungroup action re-trigger the loading spinner.
  useEffect(() => {
    const initializeItems = async () => {
      // Read the LIVE groupedItems via ref (avoids stale closure from [items] dep)
      const existingIds = new Set(groupedItemsRef.current.map(i => i.id));
      // Only process truly new items
      const newItems = items.filter(item => !existingIds.has(item.id));
      console.log(`[GROUPER] initializeItems fired: props.items=${items.length} existing=${existingIds.size} new=${newItems.length} batchId=${batchId}`);

      // If nothing is new, just sync categories/metadata that may have changed externally
      if (newItems.length === 0) {
        console.log('[GROUPER] no new items — syncing metadata only');
        // Skip the setGroupedItems call entirely when the item set AND all
        // grouping/category metadata are identical — avoids a spurious re-render
        // cascade after deletions or upload-only prop changes.
        // NOTE: must NOT skip when productGroup or category changed (e.g. after
        // a group action or category preset click), otherwise those changes are
        // never propagated into ImageGrouper's internal state.
        const propsIdSet = new Set(items.map(i => i.id));
        const existingArr = groupedItemsRef.current;
        const itemsByPropId = new Map(items.map(i => [i.id, i]));
        const hasGroupOrCategoryChange = existingArr.some(i => {
          const incoming = itemsByPropId.get(i.id);
          if (!incoming) return true; // item removed — not a "same set" scenario
          return (incoming.productGroup || incoming.id) !== (i.productGroup || i.id)
              || incoming.category !== i.category;
        });
        if (
          !hasGroupOrCategoryChange &&
          existingArr.length === items.length &&
          existingArr.every(i => propsIdSet.has(i.id))
        ) {
          return;
        }
        setGroupedItems(prev =>
          prev.map(existing => {
            const updated = items.find(i => i.id === existing.id);
            if (!updated) return existing;
            // Allow productGroup to update from props ONLY when the incoming value differs
            // from the item's own id — meaning an external merge/group was applied.
            const incomingGroup = updated.productGroup || updated.id;
            const newGroup = incomingGroup !== updated.id ? incomingGroup : existing.productGroup;
            // IMPORTANT: keep existing image URL fields — do NOT overwrite with incoming
            // imageUrls from props, which may be corrupted by App.tsx merge operations.
            // EXCEPTIONS: (1) if storagePath changed (e.g. after a crop), the incoming item
            // is authoritative and its image fields should win. (2) if the existing preview
            // is still a blob: URL but the incoming one is a real https:// URL, the upload
            // just completed — let the fresh URL win so the thumbnail renders.
            const pathChanged = updated.storagePath && updated.storagePath !== existing.storagePath;
            const existingIsBlob = existing.preview?.startsWith('blob:') || (!existing.imageUrls?.length && !existing.preview?.startsWith('https://'));
            const incomingHasReal = updated.preview?.startsWith('https://') || (updated.imageUrls && updated.imageUrls.length > 0);
            const uploadJustFinished = existingIsBlob && incomingHasReal;
            return {
              ...updated,
              productGroup: newGroup,
              // If storagePath changed (crop applied) or upload just finished, trust incoming fields.
              // Otherwise keep existing fields which are authoritative from upload time.
              storagePath:  (pathChanged || uploadJustFinished) ? updated.storagePath  : (existing.storagePath  || updated.storagePath),
              imageUrls:    (pathChanged || uploadJustFinished) ? (updated.imageUrls ?? []) : (existing.imageUrls?.length ? existing.imageUrls : (updated.imageUrls ?? [])),
              preview:      (pathChanged || uploadJustFinished) ? updated.preview      : (existing.preview      || updated.preview),
              thumbnailUrl: (pathChanged || uploadJustFinished) ? updated.thumbnailUrl : (existing.thumbnailUrl || updated.thumbnailUrl),
              // Always preserve crop-related fields from existing — these live in ImageGrouper
              // state and App.tsx may not have received them yet via onGrouped when this
              // effect re-runs (e.g. items prop update races with a just-applied crop).
              // Only fall back to updated if existing has nothing set.
              crop:                 existing.crop                 ?? updated.crop,
              originalStoragePath: existing.originalStoragePath  ?? updated.originalStoragePath,
              originalUrl:         existing.originalUrl           ?? updated.originalUrl,
            };
          })
        );
        return;
      }


      // Find truly new images that need uploading (have file but not uploaded yet)
      const toUpload = newItems.filter(item => {
        if (uploadedImages.has(item.id)) return false;
        const hasSupabaseUrl = item.imageUrls?.length || (item.preview && item.preview.startsWith('https://'));
        if (hasSupabaseUrl) return false;
        if (!item.file) return false;
        return true;
      });

      // ── FAST PATH ──────────────────────────────────────────────────────────
      // All new items already have Supabase URLs (came from ImageUpload onChunkReady).
      // Skip the async upload loop entirely and append synchronously via a functional
      // updater so concurrent effect invocations chain correctly and never race.
      if (toUpload.length === 0) {
        console.log(`[GROUPER] FAST PATH: ${newItems.length} new items, toUpload=0`);
        const incoming = newItems
          .filter(item => !(item.preview?.startsWith('blob:') && !item.file))
          .map(item => ({ ...item, productGroup: item.productGroup || item.id }));
        console.log(`[GROUPER] incoming after blob filter: ${incoming.length}`);
        if (incoming.length === 0) { console.log('[GROUPER] FAST PATH: incoming=0, returning early'); return; }
        setGroupedItems(prev => {
          const existingIdSet = new Set(prev.map(i => i.id));
          const deduped = incoming.filter(i => !existingIdSet.has(i.id));
          console.log(`[GROUPER] setGroupedItems: prev=${prev.length} deduped=${deduped.length}`);
          if (deduped.length === 0) return prev;
          const next = [...prev, ...deduped];
          // Update the ref synchronously inside the updater so the deferred onGrouped
          // call below reads the correct list. Without this, groupedItemsRef.current is
          // still the pre-update value (React hasn't re-rendered yet) when setTimeout fires.
          groupedItemsRef.current = next;
          return next;
        });
        setTimeout(() => { console.log('[GROUPER] deferred onGrouped, groupedItemsRef.current.length=', groupedItemsRef.current.length); onGrouped(groupedItemsRef.current); }, 0);
        return;
      }
      // ── END FAST PATH ──────────────────────────────────────────────────────

      if (toUpload.length > 0) {
        setIsLoading(true);
        setLoadingProgress(0);
        setLoadingMessage(`Uploading ${toUpload.length} image${toUpload.length > 1 ? 's' : ''}...`);
      }

      // STEP 1: Immediately show ALL new items with their current (blob) URLs so thumbnails
      // appear right away rather than waiting for the full upload loop to finish.
      const initialItems = (() => {
        const existingItems = groupedItemsRef.current;
        const existingIdSet = new Set(existingItems.map(i => i.id));
        const initialIncoming = newItems
          .filter(item => {
            if (existingIdSet.has(item.id)) return false;
            if (item.preview?.startsWith('blob:') && !item.file) return false; // expired blob, skip
            return true;
          })
          .map(item => ({ ...item, productGroup: item.productGroup || item.id }));
        return [...existingItems, ...initialIncoming];
      })();
      setGroupedItems(initialItems);

      // STEP 2: Upload each item and update it in-place as its URL resolves.
      // Track results in a Map so step 3 can compute the authoritative final state
      // without relying on groupedItemsRef.current (which may lag behind pending setState calls).
      const uploadResultMap = new Map<string, ClothingItem>();
      let processedCount = 0;

      for (const item of newItems) {
        const hasSupabaseUrl = item.imageUrls?.length || (item.preview && item.preview.startsWith('https://'));

        if (uploadedImages.has(item.id) || hasSupabaseUrl) {
          // Already has a real URL — nothing to do (already rendered in step 1).
          continue;
        }

        if (item.preview && item.preview.startsWith('blob:') && !item.file) {
          console.warn('⚠️ Item has expired blob URL but no file to re-upload:', item.id);
          continue;
        }

        if (userId && item.file) {
          const uploaded = await uploadImageImmediately(item, userId);
          if (uploaded) {
            setUploadedImages(prev => new Set(prev).add(item.id));
            const uploadedWithGroup = { ...uploaded, productGroup: uploaded.productGroup || uploaded.id };
            uploadResultMap.set(item.id, uploadedWithGroup);
            // Update this item in-place so its blob URL is swapped for the real Supabase URL.
            setGroupedItems(prev =>
              prev.map(existing => existing.id === item.id ? { ...existing, ...uploadedWithGroup } : existing)
            );
          }
        }

        if (toUpload.length > 0) {
          processedCount++;
          const progress = (processedCount / toUpload.length) * 100;
          setLoadingProgress(progress);
          setLoadingMessage(progress < 100
            ? `Uploading image ${processedCount} of ${toUpload.length}...`
            : 'Upload complete!');
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      }

      // STEP 3: After all uploads done, propagate the final authoritative state upstream
      // so App.tsx / workflow state / DB all have the real Supabase URLs.
      // Build deterministically — don't rely on React render timing:
      //   • initialItems is the authoritative list of items (existing + newly added)
      //   • groupedItemsRef may have productGroup changes from mid-upload group actions
      //   • uploadResultMap has real Supabase URLs for every item we just uploaded
      const groupRefMap = new Map(groupedItemsRef.current.map(i => [i.id, i]));
      const finalItems = initialItems.map(item => {
        const fromRef = groupRefMap.get(item.id);
        const fromUpload = uploadResultMap.get(item.id);
        return {
          ...item,
          // Preserve any productGroup change made mid-upload
          productGroup: fromRef?.productGroup ?? item.productGroup,
          // Apply real Supabase URLs (overrides any stale blob URL)
          ...(fromUpload ?? {}),
        };
      });
      setGroupedItems(finalItems);
      onGrouped(finalItems);

      if (toUpload.length > 0) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        setIsLoading(false);
        setLoadingProgress(0);
      }
    };

    initializeItems();
  }, [items]);

  // Auto-upload image to Supabase Storage
  const uploadImageImmediately = async (item: ClothingItem, userId: string) => {
    try {
      // Safety check: if no valid file with name, return item as-is (already uploaded or corrupted)
      if (!item.file || !item.file.name || typeof item.file.name !== 'string') {
        return item;
      }
      
      const fileExt = item.file.name.split('.').pop();
      const randomId = Math.random().toString(36).substring(2, 15);
      const fileName = `${Date.now()}-${randomId}.${fileExt}`;
      // Use permanent path (userId/productId/...) so the URL in DB remains valid indefinitely.
      const filePath = `${userId}/${item.id}/${fileName}`;

      const { data, error } = await supabase.storage
        .from('product-images')
        .upload(filePath, item.file, {
          cacheControl: '3600',
          upsert: true, // Allow overwriting if exists
        });

      if (error) {
        console.error('Upload failed:', error.message);
        return item;
      }

      const { data: { publicUrl } } = supabase.storage
        .from('product-images')
        .getPublicUrl(data.path);

      return {
        ...item,
        preview: publicUrl,
        imageUrls: [publicUrl],
        storagePath: data.path,
      };
    } catch (error) {
      console.error('Upload failed:', error);
      return item;
    }
  };

  // Delete image from Supabase Storage
  const deleteImageFromStorage = async (storagePath?: string) => {
    if (!storagePath) return;
    
    try {
      await supabase.storage
        .from('product-images')
        .remove([storagePath]);
    } catch (error) {
      console.error('Storage delete error:', error);
    }
  };

  // ── Memoized group/sort/filter computations start below ──

  // Click-to-Select functionality (with Shift+Click for multi-select)
  // Helper: update selection state and notify parent so CategoryZones can use it
  // Tracks the last-clicked single item id for Shift+click range selection
  const lastClickedSingleRef = useRef<string | null>(null);

  const updateSelection = (next: Set<string>) => {
    setSelectedItems(next);
    onSelectionChange?.(next);
  };

  // Toggle a whole product group in/out of selection (groups are selected as a unit)
  const toggleGroupSelection = (_groupId: string, groupItems: ClothingItem[]) => {
    const groupIds = groupItems.map(i => i.id);
    const allSelected = groupIds.every(id => selectedItems.has(id));
    const next = new Set(selectedItems);
    if (allSelected) {
      groupIds.forEach(id => next.delete(id));
    } else {
      groupIds.forEach(id => next.add(id));
    }
    log.grouper(`toggleGroupSelection | ${allSelected ? 'deselect' : 'select'} group | groupSize=${groupIds.length} totalSelected=${next.size}`);
    updateSelection(next);
  };

  // Toggle a single (ungrouped) item, with Shift+click range and Ctrl/Cmd+click additive
  const toggleItemSelection = (itemId: string, e?: React.MouseEvent) => {
    // Guard: hardware double-clicks fire two mousedown events ~10–15ms apart.
    // If the same item was toggled within 200ms, skip this call to prevent
    // the item bouncing back to its previous state.
    const now = Date.now();
    const lastTime = lastToggleTimeRef.current.get(itemId) ?? 0;
    if (now - lastTime < 200) {
      log.grouper(`toggleItemSelection | debounced (${now - lastTime}ms) item=${itemId}`);
      return;
    }
    lastToggleTimeRef.current.set(itemId, now);

    const newSelected = new Set(selectedItems);

    if (e?.shiftKey && lastClickedSingleRef.current && singleItemsRef.current.length > 0) {
      // Shift+click: select the range between last clicked and this one
      const ids = singleItemsRef.current.map(i => i.id);
      const fromIdx = ids.indexOf(lastClickedSingleRef.current);
      const toIdx = ids.indexOf(itemId);
      if (fromIdx !== -1 && toIdx !== -1) {
        const [lo, hi] = fromIdx < toIdx ? [fromIdx, toIdx] : [toIdx, fromIdx];
        for (let i = lo; i <= hi; i++) newSelected.add(ids[i]);
        log.grouper(`toggleItemSelection | shift-range | from=${fromIdx} to=${toIdx} totalSelected=${newSelected.size}`);
        updateSelection(newSelected);
        return;
      }
    }

    // Ctrl/Cmd+click or plain click: toggle this item without clearing others
    const wasSelected = newSelected.has(itemId);
    if (wasSelected) {
      newSelected.delete(itemId);
    } else {
      newSelected.add(itemId);
      lastClickedSingleRef.current = itemId;
    }
    log.grouper(`toggleItemSelection | ${wasSelected ? 'deselect' : 'select'} item=${itemId} | totalSelected=${newSelected.size}`);
    updateSelection(newSelected);
  };

  // Eject a single photo from its group back to the singles section
  // Rectangle selection box handlers
  const handleMouseDown = (e: React.MouseEvent, containerRef: HTMLElement | null, containerType: 'singles' | 'groups') => {
    const target = e.target as HTMLElement;
    
    // Don't start selection if clicking on interactive elements OR on singles cards
    if (target.closest('button') || 
        target.closest('input') || 
        target.closest('a') ||
        target.closest('.single-item-card') ||
        target.tagName === 'BUTTON' ||
        target.tagName === 'INPUT' ||
        target.tagName === 'A' ||
        target.tagName === 'IMG') {
      return;
    }

    if (!containerRef) return;
    
    const rect = containerRef.getBoundingClientRect();
    const startX = e.clientX - rect.left + containerRef.scrollLeft;
    const startY = e.clientY - rect.top + containerRef.scrollTop;
    
    currentContainerRef.current = containerRef;
    setIsSelecting(true);
    setSelectionStart({ x: startX, y: startY });
    setActiveContainer(containerType);
    
    // Clear selection if not holding shift
    if (!e.shiftKey) {
      updateSelection(new Set());
    }
  };

  // Create group from selected items — requires at least 2 items to be meaningful
  const createGroupFromSelected = () => {
    // Read live values via refs so this function never has a stale closure
    // regardless of how/when it was captured (onActionsReady, keyboard handler, etc.)
    const selected = selectedItemsRef.current;
    const items = groupedItemsRef.current;
    if (selected.size < 2) {
      alert('Please select at least 2 items to group together');
      return;
    }
    log.grouper(`createGroup | selected=${selected.size}`);

    const groupId = crypto.randomUUID();
    const grouped = items.filter(i => selected.has(i.id));
    console.group(`%c[ImageGrouper] GROUP CREATED (${grouped.length} items → group ${groupId.slice(0,8)})`, 'color:#f59e0b;font-weight:bold');
    console.table(grouped.map(i => ({
      id:       i.id.slice(0,8),
      name:     i.originalName ?? '—',
      imageUrl: i.imageUrls?.[0] ? '✓ ' + i.imageUrls[0].split('/').pop()?.slice(0,40) : '✗',
      preview:  i.preview ? (i.preview.startsWith('blob:') ? '⚠ blob' : '✓') : '✗',
    })));
    console.groupEnd();

    const updated = items.map(item =>
      selected.has(item.id)
        ? { ...item, productGroup: groupId }
        : item
    );

    try {
      commitUpdate(updated);
    } catch (err) {
      console.error('[createGroup] commitUpdate threw — state may be inconsistent:', err);
    }
    updateSelection(new Set());
  };

  // Ungroup selected items
  const ungroupSelected = () => {
    if (selectedItems.size === 0) {
      alert('Please select items to ungroup');
      return;
    }
    log.grouper(`ungroupSelected | selected=${selectedItems.size}`);

    // Use the ref (always latest) instead of the state snapshot to avoid stale-closure misses
    const updated = groupedItemsRef.current.map(item =>
      selectedItems.has(item.id)
        ? { ...item, productGroup: item.id, category: undefined }
        : item
    );

    try {
      commitUpdate(updated);
    } catch (err) {
      console.error('[ungroupSelected] commitUpdate threw:', err);
    }
    updateSelection(new Set());
  };

  // Ungroup ALL items in one atomic operation — no selection required
  const ungroupAll = () => {
    const grouped = groupedItemsRef.current;
    const hasAnyGroup = grouped.some(item => item.productGroup && item.productGroup !== item.id);
    if (!hasAnyGroup) return;
    const updated = grouped.map(item => ({ ...item, productGroup: item.id }));
    log.grouper(`ungroupAll | total=${updated.length}`);
    try {
      commitUpdate(updated);
    } catch (err) {
      console.error('[ungroupAll] commitUpdate threw:', err);
    }
    updateSelection(new Set());
  };

  /**
   * Auto-group all items by sequential filename order.
   * Sorts all current items by originalName (natural numeric order),
   * then chunks them into consecutive groups of `n` — exactly as the user
   * photographed them (e.g. 4 shots per item → DSC0001–0004 = group 1, etc.).
   * Existing grouping is completely replaced by this operation.
   */
  const applyAutoGrouping = (n: number) => {
    if (n < 2 || n > 50) return;

    // Sort ALL items by filename in natural (numeric) ascending order
    const sorted = [...groupedItems].sort((a, b) => naturalCompare(nameKey(a), nameKey(b)));

    log.grouper(`applyAutoGrouping | n=${n} total=${sorted.length} chunks=${Math.ceil(sorted.length / n)}`);

    // Pre-generate a stable group UUID per chunk (one per product)
    const numChunks = Math.ceil(sorted.length / n);
    const chunkIds = Array.from({ length: numChunks }, () => crypto.randomUUID());

    const updated: ClothingItem[] = sorted.map((item, i) => ({
      ...item,
      productGroup: chunkIds[Math.floor(i / n)],
    }));

    commitUpdate(updated);
    updateSelection(new Set());
  };


  // Drag and Drop Handlers for Images
  const handleDragStart = (e: React.DragEvent, item: ClothingItem, fromGroup: string) => {
    log.grouper(`dragStart | item=${item.id} fromGroup=${fromGroup}`);
    setDraggedItem(item);
    setDraggedFromGroup(fromGroup);
    // Set data for cross-component dragging (Step 2 -> Step 3)
    const dragData = {
      item,
      productGroup: item.productGroup || item.id,
      source: 'ImageGrouper'
    };
    e.dataTransfer.setData('application/json', JSON.stringify(dragData));
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, targetGroup: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverGroup(targetGroup);
  };

  const handleDrop = (e: React.DragEvent, targetGroup: string) => {
    e.preventDefault();
    e.stopPropagation();

    // Resolve which item is being dragged — could come from:
    //   1. handleDragStart (whole-card drag) → draggedItem is set
    //   2. handlePhotoDragStart (photo inside a group) → draggedPhotoId is set
    let movingItem = draggedItem;
    let sourceGroup = draggedFromGroup;

    if (!movingItem && draggedPhotoId) {
      movingItem = groupedItems.find(i => i.id === draggedPhotoId) || null;
      sourceGroup = draggedPhotoGroupId;
    }

    // Also check the dataTransfer payload (cross-component / cross-render safety)
    if (!movingItem) {
      try {
        const data = JSON.parse(e.dataTransfer.getData('application/json'));
        if (data.action === 'reorder-photo' && data.photoId) {
          movingItem = groupedItems.find(i => i.id === data.photoId) || null;
          sourceGroup = data.groupId;
        } else if (data.item?.id) {
          movingItem = groupedItems.find(i => i.id === data.item.id) || null;
          sourceGroup = data.productGroup || data.item.productGroup || data.item.id;
        }
      } catch { /* ignore */ }
    }

    if (!movingItem) {
      setDragOverGroup(null);
      return;
    }

    // No-op: dropped on its own group
    if (sourceGroup === targetGroup) {
      setDragOverGroup(null);
      setDraggedItem(null);
      setDraggedFromGroup(null);
      setDraggedPhotoId(null);
      setDraggedPhotoGroupId(null);
      return;
    }

    const afterMove = groupedItems.map(item =>
      item.id === movingItem!.id
        ? { ...item, productGroup: targetGroup }
        : item
    );
    log.grouper(`drop | item=${movingItem.id} from=${sourceGroup} → to=${targetGroup}`);

    // If the source group is now down to 1 item, dissolve it back to a singleton
    const sourceGroupItems = afterMove.filter(i => (i.productGroup || i.id) === sourceGroup);
    const updated = sourceGroupItems.length === 1
      ? afterMove.map(item =>
          (item.productGroup || item.id) === sourceGroup
            ? { ...item, productGroup: item.id }
            : item
        )
      : afterMove;

    commitUpdate(updated);
    updateSelection(new Set());
    setDraggedItem(null);
    setDraggedFromGroup(null);
    setDraggedPhotoId(null);
    setDraggedPhotoGroupId(null);
    setDragOverGroup(null);
    setDragOverPhotoId(null);
  };

  const handleDragEnd = () => {
    setDraggedItem(null);
    setDraggedFromGroup(null);
    setDragOverGroup(null);
  };

  // ── Singles grid reorder drag ──────────────────────────────────────────────
  // Separate from the existing handleDragStart/Drop which move items INTO groups.
  // These fire only when dragging within the singles grid.

  const startAutoScroll = (clientY: number) => {
    const el = scrollContentRef.current;
    if (!el) return;
    const ZONE = 80; // px from edge that triggers scrolling
    const MAX_SPEED = 14;
    const { top, bottom } = el.getBoundingClientRect();
    const distTop = clientY - top;
    const distBottom = bottom - clientY;
    let speed = 0;
    if (distTop < ZONE) speed = -MAX_SPEED * (1 - distTop / ZONE);
    else if (distBottom < ZONE) speed = MAX_SPEED * (1 - distBottom / ZONE);
    if (speed !== 0) el.scrollTop += speed;
  };

  const handleReorderDragStart = (e: React.DragEvent, itemId: string) => {
    e.stopPropagation();
    // Use the pre-drag snapshot (captured on mousedown, before toggle fires).
    // selectedItemsRef.current may have already deselected the dragged card by this point.
    const preDragSelection = reorderPreDragSelectionRef.current;
    const idsToMove: string[] = preDragSelection.has(itemId) && preDragSelection.size > 1
      ? singleItemsRef.current.filter(i => preDragSelection.has(i.id)).map(i => i.id)
      : [itemId];
    setReorderDragId(itemId);
    e.dataTransfer.setData('application/reorder-single', JSON.stringify(idsToMove));
    e.dataTransfer.effectAllowed = 'move';
    // Custom ghost: show count badge when moving multiple
    if (idsToMove.length > 1) {
      const ghost = document.createElement('div');
      ghost.style.cssText = 'position:fixed;top:-999px;left:-999px;background:#667eea;color:#fff;padding:6px 12px;border-radius:20px;font:600 13px/1 sans-serif;pointer-events:none;';
      ghost.textContent = `Moving ${idsToMove.length} photos`;
      document.body.appendChild(ghost);
      e.dataTransfer.setDragImage(ghost, 60, 16);
      setTimeout(() => ghost.remove(), 0);
    } else {
      const el = e.currentTarget as HTMLElement;
      e.dataTransfer.setDragImage(el, el.offsetWidth / 2, el.offsetHeight / 2);
    }
    // Kick off auto-scroll RAF loop
    const loop = () => {
      startAutoScroll(reorderMouseYRef.current);
      autoScrollRafRef.current = requestAnimationFrame(loop);
    };
    autoScrollRafRef.current = requestAnimationFrame(loop);
  };

  const reorderMouseYRef = useRef(0);
  // Snapshot of selected IDs taken on mousedown — before toggleItemSelection fires.
  // By the time dragstart runs, the dragged card may already be deselected.
  const reorderPreDragSelectionRef = useRef<Set<string>>(new Set());

  const handleReorderDragOver = (e: React.DragEvent, overId: string) => {
    if (!e.dataTransfer.types.includes('application/reorder-single')) return;
    e.preventDefault();
    e.stopPropagation();
    reorderMouseYRef.current = e.clientY;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const side = e.clientX < rect.left + rect.width / 2 ? 'left' : 'right';
    setReorderOverId(overId);
    setReorderOverSide(side);
  };

  const handleReorderDrop = (e: React.DragEvent, overId: string) => {
    e.preventDefault();
    e.stopPropagation();
    let idsToMove: string[];
    try { idsToMove = JSON.parse(e.dataTransfer.getData('application/reorder-single')); }
    catch { setReorderDragId(null); setReorderOverId(null); return; }
    if (!idsToMove.length) { setReorderDragId(null); setReorderOverId(null); return; }

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const dropBefore = e.clientX < rect.left + rect.width / 2;

    // Build the base order
    const base = singleItemsRef.current.map(i => i.id);
    const order = manualOrder.length > 0 ? [...manualOrder] : base;

    // Skip if dropping the entire selection onto itself
    if (idsToMove.includes(overId) && idsToMove.length === 1) {
      setReorderDragId(null); setReorderOverId(null); return;
    }

    // Remove all moving items from order, preserving their relative order
    const moveSet = new Set(idsToMove);
    const filtered = order.filter(id => !moveSet.has(id));

    // Find insertion point relative to overId in the filtered array
    let insertAt = filtered.indexOf(overId);
    if (insertAt === -1) insertAt = filtered.length;
    else if (!dropBefore) insertAt += 1;

    // Reinsert moving items as a block, preserving their original relative order
    // (sort them by their position in the current order)
    const orderedMoved = idsToMove.slice().sort((a, b) => order.indexOf(a) - order.indexOf(b));
    filtered.splice(insertAt, 0, ...orderedMoved);

    setManualOrder(filtered);
    setReorderDragId(null);
    setReorderOverId(null);
  };

  const handleReorderDragEnd = () => {
    setReorderDragId(null);
    setReorderOverId(null);
    if (autoScrollRafRef.current) { cancelAnimationFrame(autoScrollRafRef.current); autoScrollRafRef.current = null; }
  };

  // ── Photo reorder handlers (drag photos within a group) ──────────────────
  const handlePhotoDragStart = (e: React.DragEvent, item: ClothingItem, groupId: string) => {
    e.stopPropagation();
    setDraggedPhotoId(item.id);
    setDraggedPhotoGroupId(groupId);
    e.dataTransfer.setData('application/json', JSON.stringify({ action: 'reorder-photo', photoId: item.id, groupId }));
    e.dataTransfer.effectAllowed = 'move';
  };

  const handlePhotoDragOver = (e: React.DragEvent, photoId: string, groupId: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (draggedPhotoGroupId === groupId && draggedPhotoId !== photoId) {
      setDragOverPhotoId(photoId);
    }
  };

  const handlePhotoDrop = (e: React.DragEvent, targetPhotoId: string, groupId: string) => {
    e.preventDefault();
    e.stopPropagation();

    let srcPhotoId: string | null = null;
    let srcGroupId: string | null = null;
    try {
      const data = JSON.parse(e.dataTransfer.getData('application/json'));
      if (data.action === 'reorder-photo') { srcPhotoId = data.photoId; srcGroupId = data.groupId; }
    } catch { /* ignore */ }

    srcPhotoId = srcPhotoId || draggedPhotoId;
    srcGroupId = srcGroupId || draggedPhotoGroupId;

    // Cross-group drop — delegate to handleDrop which now resolves photo drags too
    if (srcGroupId && srcGroupId !== groupId) {
      handleDrop(e, groupId);
      return;
    }

    // Same-group reorder
    if (!srcPhotoId || !srcGroupId || srcGroupId !== groupId || srcPhotoId === targetPhotoId) {
      setDraggedPhotoId(null); setDraggedPhotoGroupId(null); setDragOverPhotoId(null);
      return;
    }

    const photoList = [...groupedItems.filter(i => (i.productGroup || i.id) === groupId)];
    const fromIdx = photoList.findIndex(p => p.id === srcPhotoId);
    const toIdx = photoList.findIndex(p => p.id === targetPhotoId);
    if (fromIdx === -1 || toIdx === -1) return;

    const moved = photoList.splice(fromIdx, 1)[0];
    photoList.splice(toIdx, 0, moved);

    let slot = 0;
    const updated = groupedItems.map(i => {
      if ((i.productGroup || i.id) !== groupId) return i;
      return photoList[slot++];
    });
    commitUpdate(updated);
    setDraggedPhotoId(null); setDraggedPhotoGroupId(null); setDragOverPhotoId(null);
  };

  const handlePhotoDragEnd = () => {
    setDraggedPhotoId(null);
    setDraggedPhotoGroupId(null);
    setDragOverPhotoId(null);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    // Only clear drag over if we're leaving the container, not just moving between children
    if (e.currentTarget === e.target) {
      setDragOverGroup(null);
    }
  };

  // Delete image handler
  const handleDeleteImage = async (item: ClothingItem) => {
    if (!confirm('Delete this image? This cannot be undone.')) return;
    log.grouper(`deleteImage | item=${item.id} storagePath=${item.storagePath}`);

    // Delete from storage if it was uploaded
    if (item.storagePath) {
      await deleteImageFromStorage(item.storagePath);
      // Delete the product_images row
      await supabase.from('product_images').delete().eq('storage_path', item.storagePath);
    }
    // Delete the products row (cleans up orphaned DB entries)
    await supabase.from('products').delete().eq('id', item.id);

    // Remove from UI — delete doesn't go on undo stack (can't un-delete)
    const updated = groupedItems.filter(i => i.id !== item.id);
    commitUpdate(updated, true); // skipHistory=true — delete is permanent
    setUploadedImages(prev => {
      const next = new Set(prev);
      next.delete(item.id);
      return next;
    });

    // Notify parent that a real DB change happened — Library should refresh
    onImageDeleted?.();
  };

  // Bulk delete selected items
  const handleDeleteSelected = async () => {
    if (selectedItems.size === 0) return;
    if (!confirm(`Delete ${selectedItems.size} selected image${selectedItems.size > 1 ? 's' : ''}? This cannot be undone.`)) return;
    log.grouper(`deleteSelected | count=${selectedItems.size}`);

    const toDelete = groupedItems.filter(i => selectedItems.has(i.id));
    const storagePaths = toDelete.map(i => i.storagePath).filter(Boolean) as string[];
    const deletedIds = toDelete.map(i => i.id);

    // Delete from storage in parallel
    await Promise.all(storagePaths.map(p => deleteImageFromStorage(p)));

    // Delete product_images rows by storage_path
    if (storagePaths.length > 0) {
      await supabase.from('product_images').delete().in('storage_path', storagePaths);
    }
    // Delete products rows by id (removes orphaned DB entries)
    if (deletedIds.length > 0) {
      await supabase.from('products').delete().in('id', deletedIds);
    }

    const updated = groupedItems.filter(i => !selectedItems.has(i.id));
    commitUpdate(updated, true); // skipHistory=true — delete is permanent
    updateSelection(new Set());

    // Notify parent that real DB changes happened — Library should refresh
    onImageDeleted?.();
  };

  // ── Sort helpers — defined once, stable references ────────────────────────
  const nameKey = (item: ClothingItem): string => {
    if (item.originalName) return item.originalName.toLowerCase();
    if (item.storagePath) return item.storagePath.split('/').pop()?.toLowerCase() ?? item.id;
    return item.id.toLowerCase();
  };
  const naturalCompare = (a: string, b: string) =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

  // ── Memoized derived data — only recomputes when groupedItems / sortOrder /
  //    filters / manualOrder actually change, not on hover/scroll/selection. ──
  const { multiItemGroups, singleItems, uniqueFilterDates, uniqueFilterCategories } = useMemo(() => {
    // Build group map
    const grps: Record<string, ClothingItem[]> = {};
    groupedItems.forEach(item => {
      const gid = item.productGroup || item.id;
      if (!grps[gid]) grps[gid] = [];
      grps[gid].push(item);
    });
    const entries = Object.entries(grps);

    const sortArr = (arr: ClothingItem[]): ClothingItem[] => {
      const copy = [...arr];
      switch (sortOrder) {
        case 'date-asc':  return copy.sort((a, b) => (a.capturedAt ?? 0) - (b.capturedAt ?? 0));
        case 'date-desc': return copy.sort((a, b) => (b.capturedAt ?? 0) - (a.capturedAt ?? 0));
        case 'name-asc':  return copy.sort((a, b) => naturalCompare(nameKey(a), nameKey(b)));
        case 'name-desc': return copy.sort((a, b) => naturalCompare(nameKey(b), nameKey(a)));
      }
    };
    const sortGroups = (es: [string, ClothingItem[]][]): [string, ClothingItem[]][] => {
      const copy = [...es];
      switch (sortOrder) {
        case 'date-asc':
          return copy.sort(([, a], [, b]) => Math.min(...a.map(i => i.capturedAt ?? 0)) - Math.min(...b.map(i => i.capturedAt ?? 0)));
        case 'date-desc':
          return copy.sort(([, a], [, b]) => Math.min(...b.map(i => i.capturedAt ?? 0)) - Math.min(...a.map(i => i.capturedAt ?? 0)));
        case 'name-asc':
          return copy.sort(([, a], [, b]) => naturalCompare(nameKey(a[0]), nameKey(b[0])));
        case 'name-desc':
          return copy.sort(([, a], [, b]) => naturalCompare(nameKey(b[0]), nameKey(a[0])));
      }
    };

    const multi = sortGroups(entries.filter(([, its]) => its.length > 1));
    const baseSingles = sortArr(entries.filter(([, its]) => its.length === 1).flatMap(([, its]) => its));
    const singles = manualOrder.length > 0
      ? (() => {
          const byId = Object.fromEntries(baseSingles.map(i => [i.id, i]));
          const ordered = manualOrder.map(id => byId[id]).filter(Boolean) as ClothingItem[];
          const inOrder = new Set(manualOrder);
          return [...ordered, ...baseSingles.filter(i => !inOrder.has(i.id))];
        })()
      : baseSingles;

    const dateSet = new Set<string>();
    const catSet  = new Set<string>();
    groupedItems.forEach(item => {
      if (item.capturedAt) dateSet.add(new Date(item.capturedAt).toLocaleDateString('en-CA'));
      if (item.category)   catSet.add(item.category);
    });

    return {
      multiItemGroups:       multi,
      singleItems:           singles,
      uniqueFilterDates:     [...dateSet].sort() as string[],
      uniqueFilterCategories: [...catSet].sort()  as string[],
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupedItems, sortOrder, manualOrder]);

  // Apply all filters to both lists (AND logic)
  const toLocalDate = (ts: number) => new Date(ts).toLocaleDateString('en-CA');
  const itemPassesFilters = (item: ClothingItem): boolean => {
    if (filters.date && !(item.capturedAt && toLocalDate(item.capturedAt) === filters.date)) return false;
    if (filters.category === 'uncategorized' && item.category) return false;
    if (filters.category && filters.category !== 'uncategorized' && item.category !== filters.category) return false;
    return true;
  };

  const { filteredSingleItems, filteredMultiItemGroups } = useMemo(() => ({
    filteredSingleItems:    filters.view === 'groups'   ? [] : singleItems.filter(item => itemPassesFilters(item)),
    filteredMultiItemGroups: filters.view === 'singles' ? [] : multiItemGroups.filter(([, its]) => its.some(i => itemPassesFilters(i))),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [singleItems, multiItemGroups, filters]);

  // Reset visible page when filters change (stable string avoids object-identity re-fires)
  const filterKey = `${filters.view}|${filters.date ?? ''}|${filters.category ?? ''}`;
  useEffect(() => { setVisibleSingleCount(SINGLES_PAGE); }, [filterKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const activeFilterCount = [filters.date, filters.view !== 'all' ? filters.view : '', filters.category]
    .filter(Boolean).length;

  // Keep a ref so event-handler closures always see the current singleItems list
  const singleItemsRef = useRef<ClothingItem[]>(singleItems);
  singleItemsRef.current = singleItems;

  // Ref mirrors for select-all shortcut closures
  const multiItemGroupsRef = useRef<[string, ClothingItem[]][]>(multiItemGroups);
  multiItemGroupsRef.current = multiItemGroups;

  // Notify parent whenever the group stats change so Step 3 can show matching numbers
  useEffect(() => {
    onStatsChange?.({
      multiImageGroups: multiItemGroups.length,
      singles: singleItems.length,
      totalListings: multiItemGroups.length + singleItems.length,
      totalImages: groupedItems.length,
    });
  }, [multiItemGroups.length, singleItems.length, groupedItems.length, onStatsChange]);

  // Notify parent of current action callbacks + selected count so it can render the toolbar
  useEffect(() => {
    onActionsReady?.({
      groupSelected: createGroupFromSelected,
      ungroupSelected,
      ungroupAll,
      clearSelection: () => updateSelection(new Set()),
      deleteSelected: handleDeleteSelected,
      selectedCount: selectedItems.size,
    });
  // createGroupFromSelected now reads via refs so it's safe to keep a stable dep here;
  // selectedItems is still needed so selectedCount stays up-to-date.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedItems, onActionsReady]);

  return (
    <>
      {isLoading && (
        <LoadingProgress 
          progress={loadingProgress} 
          message={loadingMessage} 
        />
      )}

      {/* ── Crop paste progress overlay ── */}
      {cropPasteProgress && (
        <div style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          zIndex: 99999, background: 'rgba(20,16,40,0.97)',
          border: '1.5px solid #6366f1', borderRadius: 14,
          padding: '14px 22px 12px', minWidth: 320, maxWidth: 420,
          boxShadow: '0 8px 32px rgba(99,102,241,0.25)',
          display: 'flex', flexDirection: 'column', gap: 8, fontFamily: 'inherit',
        }}>
          <div style={{ color: '#e0e7ff', fontSize: '0.85rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 7 }}>
            {cropPasteProgress.status === 'running' ? (
              <span style={{
                display: 'inline-block', width: 13, height: 13,
                border: '2px solid #6366f1', borderTopColor: '#a78bfa',
                borderRadius: '50%', animation: 'spin 0.7s linear infinite', flexShrink: 0,
              }} />
            ) : (
              <span style={{ color: '#4ade80', fontSize: 15 }}>✓</span>
            )}
            {cropPasteProgress.status === 'running'
              ? `Applying crop to ${cropPasteProgress.total} image${cropPasteProgress.total > 1 ? 's' : ''}…`
              : cropPasteProgress.failed.length > 0
                ? `Done — ${cropPasteProgress.failed.length} failed`
                : 'Crop applied successfully!'}
          </div>
          <div style={{ color: '#a5b4fc', fontSize: '0.78rem', marginTop: 1 }}>
            {cropPasteProgress.status === 'running'
              ? `${cropPasteProgress.done} / ${cropPasteProgress.total} complete (${Math.round((cropPasteProgress.done / cropPasteProgress.total) * 100)}%)`
              : cropPasteProgress.failed.length > 0
                ? `${cropPasteProgress.total - cropPasteProgress.failed.length} succeeded, ${cropPasteProgress.failed.length} failed`
                : `All ${cropPasteProgress.total} image${cropPasteProgress.total > 1 ? 's' : ''} processed.`}
          </div>
          <div style={{ background: 'rgba(99,102,241,0.18)', borderRadius: 8, height: 10, width: '100%', overflow: 'hidden', marginTop: 2 }}>
            <div style={{
              height: '100%',
              background: 'linear-gradient(90deg,#6366f1 0%,#a78bfa 100%)',
              borderRadius: 8,
              width: `${Math.round((cropPasteProgress.done / cropPasteProgress.total) * 100)}%`,
              transition: 'width 0.25s ease',
            }} />
          </div>
          {cropPasteProgress.status === 'done' && cropPasteProgress.failed.length > 0 && copiedCrop && (
            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <button
                onClick={async () => {
                  const ids = [...cropPasteProgress.failed];
                  await runCropBatchPaste(ids, copiedCrop!, copiedRotation);
                }}
                style={{ flex: 1, background: '#f59e0b', color: '#111', border: 'none', borderRadius: 8, padding: '0.4rem 0.7rem', cursor: 'pointer', fontWeight: 600, fontSize: '0.78rem' }}
              >
                ↺ Retry {cropPasteProgress.failed.length} failed
              </button>
              <button
                onClick={() => setCropPasteProgress(null)}
                style={{ background: 'none', border: '1px solid #6366f1', color: '#a5b4fc', borderRadius: 8, padding: '0.4rem 0.7rem', cursor: 'pointer', fontSize: '0.78rem' }}
              >
                Dismiss
              </button>
            </div>
          )}
        </div>
      )}
      
      <div className="image-grouper-container">
      <div className="grouper-header">
        <div className="stats">
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Package size={20} /> {multiItemGroups.length} Multi-Image Groups
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Image size={20} /> {singleItems.length} Single Items
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: '#6366f1' }}>
            <Package size={20} /> {multiItemGroups.length + singleItems.length} Total Listings
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Image size={20} /> {groupedItems.length} Total Images
          </span>
          {selectedItems.size > 0 && (
            <span style={{ background: '#10b981', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Check size={16} /> {selectedItems.size} Selected
            </span>
          )}
          {canUndo && (
            <span
              onClick={handleUndo}
              title="Undo last grouping action (⌘Z)"
              style={{
                background: '#6b7280', cursor: 'pointer', display: 'flex',
                alignItems: 'center', gap: '0.4rem', userSelect: 'none',
              }}
            >
              ↩ Undo
            </span>
          )}
          {canRedo && (
            <span
              onClick={handleRedo}
              title="Redo last undone action (⌘Shift+Z)"
              style={{
                background: '#6b7280', cursor: 'pointer', display: 'flex',
                alignItems: 'center', gap: '0.4rem', userSelect: 'none',
              }}
            >
              ↪ Redo
            </span>
          )}
        </div>
        {/* Sort control */}
        <div className="sort-control">
          <ArrowUpDown size={15} style={{ flexShrink: 0 }} />
          <span>Sort:</span>
          <button
            className={`sort-btn${sortOrder === 'date-asc' ? ' active' : ''}`}
            onClick={() => setSortOrder('date-asc')}
            title="Oldest first (capture date)"
          >
            <ArrowUp size={13} /> Date
          </button>
          <button
            className={`sort-btn${sortOrder === 'date-desc' ? ' active' : ''}`}
            onClick={() => setSortOrder('date-desc')}
            title="Newest first (capture date)"
          >
            <ArrowDown size={13} /> Date
          </button>
          <button
            className={`sort-btn${sortOrder === 'name-asc' ? ' active' : ''}`}
            onClick={() => setSortOrder('name-asc')}
            title="Sort by filename A → Z"
          >
            <ArrowUp size={13} /> Name
          </button>
          <button
            className={`sort-btn${sortOrder === 'name-desc' ? ' active' : ''}`}
            onClick={() => setSortOrder('name-desc')}
            title="Sort by filename Z → A"
          >
            <ArrowDown size={13} /> Name
          </button>
        </div>
        {/* Filter bar — view type, date, category (all combinable, all toggle buttons) */}
        <div className="filter-bar">
          <span className="filter-bar-label">
            🔎 Filter{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}:
          </span>

          {/* View type toggle buttons */}
          <div className="filter-btn-group">
            <button
              className={`sort-btn${filters.view === 'groups' ? ' active' : ''}`}
              onClick={() => setFilter('view', filters.view === 'groups' ? 'all' : 'groups')}
              title="Show only multi-image groups"
            >
              Groups
            </button>
            <button
              className={`sort-btn${filters.view === 'singles' ? ' active' : ''}`}
              onClick={() => setFilter('view', filters.view === 'singles' ? 'all' : 'singles')}
              title="Show only single items"
            >
              Singles
            </button>
          </div>

          {/* Date dropdown */}
          {uniqueFilterDates.length > 0 && (
            <select
              className="filter-select"
              value={filters.date}
              onChange={e => setFilter('date', e.target.value)}
              title="Filter by capture date"
            >
              <option value="">All dates</option>
              {uniqueFilterDates.map(d => (
                <option key={d} value={d}>
                  {new Date(d + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
                </option>
              ))}
            </select>
          )}

          {/* Category toggle buttons */}
          {(uniqueFilterCategories.length > 0 || groupedItems.some(i => !i.category)) && (
            <div className="filter-btn-group">
              {groupedItems.some(i => !i.category) && (
                <button
                  className={`sort-btn${filters.category === 'uncategorized' ? ' active' : ''}`}
                  onClick={() => setFilter('category', filters.category === 'uncategorized' ? '' : 'uncategorized')}
                  title="Show only uncategorized items"
                >
                  Uncategorized
                </button>
              )}
              {uniqueFilterCategories.map(c => (
                <button
                  key={c}
                  className={`sort-btn${filters.category === c ? ' active' : ''}`}
                  onClick={() => setFilter('category', filters.category === c ? '' : c)}
                  title={`Filter by category: ${c}`}
                >
                  {c}
                </button>
              ))}
            </div>
          )}

          {activeFilterCount > 0 && (
            <button
              className="sort-btn filter-clear-btn"
              onClick={() => setFilters({ date: '', view: 'all', category: '' })}
              title="Clear all filters"
            >
              ✕ Clear
            </button>
          )}

          {/* ── Auto-group by N ─────────────────────────────────────────────── */}
          <div className="auto-group-control" title="Auto-group images by sequential filename order. Type how many photos you took per item, then click Apply.">
            <span className="auto-group-label">📸 Photos/item:</span>
            <input
              type="number"
              min={2}
              max={50}
              value={autoGroupN}
              onChange={e => setAutoGroupN(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  const n = parseInt(autoGroupN, 10);
                  if (!isNaN(n) && n >= 2 && n <= 50) applyAutoGrouping(n);
                }
              }}
              className="auto-group-input"
              title="Number of photos per product"
            />
            <button
              className="sort-btn auto-group-btn"
              onClick={() => {
                const n = parseInt(autoGroupN, 10);
                if (isNaN(n) || n < 2 || n > 50) {
                  alert('Enter a number between 2 and 50');
                  return;
                }
                if (!confirm(`Auto-group all ${groupedItems.length} images into sets of ${n}?\n\nThis will replace all current grouping. You can undo by refreshing.`)) return;
                applyAutoGrouping(n);
              }}
              title={`Group all images into sets of ${autoGroupN} by filename order`}
            >
              Apply
            </button>
          </div>

          {/* ── Columns per row slider ──────────────────────────────────────── */}
          <div className="auto-group-control" title="Adjust how many images appear per row">
            <span className="auto-group-label">⊞ Columns: {columnsPerRow}</span>
            <input
              type="range"
              min={2}
              max={12}
              value={columnsPerRow}
              onChange={e => setColumnsPerRow(Number(e.target.value))}
              className="columns-slider"
              title="Drag to change columns per row"
            />
          </div>

          {/* ── Format painter copy buttons ──────────────────────────────────── */}
          <div className="auto-group-control" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '0.35rem' }}>
            <span className="auto-group-label" style={{ marginBottom: '0.1rem' }}>Format Painter</span>
            <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
              <button
                className="rotate-btn"
                title="Select one image first, then click to copy its rotation"
                style={{ fontSize: '0.72rem', padding: '0.25rem 0.5rem', display: 'flex', alignItems: 'center', gap: '0.25rem', height: 'auto', background: copiedRotation !== null ? '#6366f1' : undefined, color: copiedRotation !== null ? '#fff' : undefined }}
                onClick={(e) => {
                  e.stopPropagation();
                  const firstId = [...selectedItems][0];
                  const source = firstId ? groupedItems.find(i => i.id === firstId) : null;
                  if (!source) { alert('Select an image first to copy its rotation.'); return; }
                  setCopiedRotation(source.imageRotation || 0);
                  // Deselect the source so user can now select targets
                  setSelectedItems(new Set());
                }}
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.27"/>
                </svg>
                Copy Rot
              </button>
              <button
                className="rotate-btn"
                title="Select one image first, then click to copy its crop"
                style={{ fontSize: '0.72rem', padding: '0.25rem 0.5rem', display: 'flex', alignItems: 'center', gap: '0.25rem', height: 'auto', background: copiedCrop !== undefined ? '#6366f1' : undefined, color: copiedCrop !== undefined ? '#fff' : undefined }}
                onClick={(e) => {
                  e.stopPropagation();
                  const firstId = [...selectedItems][0];
                  const source = firstId ? groupedItems.find(i => i.id === firstId) : null;
                  if (!source) { alert('Select an image first to copy its crop.'); return; }
                  setCopiedCrop(source.crop ?? null);
                  // Deselect the source so user can now select targets
                  setSelectedItems(new Set());
                }}
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="6 2 6 6 2 6"/><polyline points="18 22 18 18 22 18"/>
                  <path d="M6 6h12v12H6z" strokeDasharray="2 2"/>
                </svg>
                Copy Crop
              </button>
            </div>

            {/* Status + Paste — shown once something is in clipboard */}
            {(copiedRotation !== null || copiedCrop !== undefined) && (
              <div style={{ fontSize: '0.67rem', color: '#e0e7ff', lineHeight: 1.4, marginTop: '0.1rem' }}>
                <div>
                  {copiedRotation !== null && copiedCrop !== undefined
                    ? 'Rot + crop copied'
                    : copiedRotation !== null
                    ? 'Rotation copied'
                    : 'Crop copied'}
                  {' · '}
                  <button onClick={() => { setCopiedRotation(null); setCopiedCrop(undefined); }}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#c4b5fd', fontSize: '0.72rem', padding: 0 }}>
                    clear
                  </button>
                </div>
                <div style={{ color: '#c4b5fd', marginTop: '0.15rem' }}>
                  {selectedItems.size > 0
                    ? `${selectedItems.size} image${selectedItems.size > 1 ? 's' : ''} selected`
                    : 'Now select target images →'}
                </div>
                {selectedItems.size > 0 && (
                  <button
                    className="rotate-btn"
                    title="Paste to all selected images"
                    style={{
                      marginTop: '0.3rem',
                      fontSize: '0.72rem', padding: '0.3rem 0.6rem',
                      display: 'flex', alignItems: 'center', gap: '0.25rem',
                      height: 'auto', background: '#6366f1', color: '#fff', width: '100%',
                      justifyContent: 'center',
                    }}
                    onClick={async (e) => {
                      e.stopPropagation();
                      const targetIds = [...selectedItems];
                      console.log('[paste] Paste-to-selected clicked — selectedItems:', targetIds.length, 'copiedCrop:', copiedCrop, 'copiedRotation:', copiedRotation);
                      setSelectedItems(new Set());
                      if (copiedCrop !== undefined && copiedCrop !== null) {
                        await runCropBatchPaste(targetIds, copiedCrop, copiedRotation);
                      } else {
                        // Rotation only — just update state
                        const updated = groupedItems.map(i => {
                          if (!targetIds.includes(i.id)) return i;
                          return { ...i, ...(copiedRotation !== null ? { imageRotation: copiedRotation } : {}) };
                        });
                        setGroupedItems(updated);
                        onGrouped(updated);
                      }
                    }}
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                    </svg>
                    Paste to selected
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── Delete selected ── */}
        {selectedItems.size > 0 && (
          <div style={{ padding: '0 0.5rem', marginTop: '0.5rem' }}>
            <button
              onClick={handleDeleteSelected}
              className="rotate-btn"
              title={`Delete ${selectedItems.size} selected image${selectedItems.size > 1 ? 's' : ''}`}
              style={{
                width: '100%', fontSize: '0.72rem',
                padding: '0.3rem 0.6rem', height: 'auto',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.3rem',
                background: '#dc2626', color: '#fff', border: 'none', borderRadius: 6,
                cursor: 'pointer',
              }}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
              </svg>
              Delete {selectedItems.size} selected
            </button>
          </div>
        )}

        {/* ── Revert selected to originals ── */}
        {selectedItems.size > 0 && groupedItems.some(i => selectedItems.has(i.id) && i.originalStoragePath) && (
          <div style={{ padding: '0 0.5rem', marginTop: '0.4rem' }}>
            <button
              className="rotate-btn"
              title="Revert selected cropped images back to their original un-cropped versions"
              onClick={() => revertToOriginalBatch([...selectedItems])}
              style={{
                width: '100%', fontSize: '0.72rem',
                padding: '0.3rem 0.6rem', height: 'auto',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.3rem',
                background: '#b45309', color: '#fff', border: 'none', borderRadius: 6,
                cursor: 'pointer',
              }}
            >
              ↺ Revert {groupedItems.filter(i => selectedItems.has(i.id) && i.originalStoragePath).length} to original
            </button>
          </div>
        )}

        {/* ── Clear originals cache ── */}
        {groupedItems.some(i => i.originalStoragePath) && (
          <div style={{ padding: '0 0.5rem', marginTop: '0.4rem' }}>
            <button
              className="rotate-btn"
              title="Free up storage by permanently deleting cached original images. Revert will no longer be possible."
              onClick={() => clearOriginalsCache(selectedItems.size > 0 && groupedItems.some(i => selectedItems.has(i.id) && i.originalStoragePath) ? 'selected' : 'all')}
              style={{
                width: '100%', fontSize: '0.68rem',
                padding: '0.25rem 0.6rem', height: 'auto',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.3rem',
                background: 'transparent', color: '#f87171', border: '1px solid #7f1d1d', borderRadius: 6,
                cursor: 'pointer',
              }}
            >
              🗑 Clear {
                selectedItems.size > 0 && groupedItems.some(i => selectedItems.has(i.id) && i.originalStoragePath)
                  ? `${groupedItems.filter(i => selectedItems.has(i.id) && i.originalStoragePath).length} selected`
                  : `${groupedItems.filter(i => i.originalStoragePath).length} all`
              } originals cache
            </button>
          </div>
        )}

        {/* ── Keyboard shortcuts cheat sheet ── */}
        <div className="keyboard-cheatsheet">
          <div className="cheatsheet-title">⌨ Shortcuts</div>
          <div className="cheatsheet-row"><kbd>⌘ Enter</kbd><span>Group selected</span></div>
          <div className="cheatsheet-row"><kbd>⌘ ⌫</kbd><span>Ungroup selected</span></div>
          <div className="cheatsheet-row"><kbd>⌘A</kbd><span>Select singles</span></div>
          <div className="cheatsheet-row"><kbd>⌘ Shift A</kbd><span>Select groups</span></div>
          <div className="cheatsheet-row"><kbd>⌘D</kbd><span>Deselect all</span></div>
          <div className="cheatsheet-row"><kbd>⌘Z</kbd><span>Undo</span></div>
          <div className="cheatsheet-row"><kbd>⌘ Shift Z</kbd><span>Redo</span></div>
        </div>
      </div>

      {/* ── Image grid — scrollable content to the right of the sidebar ── */}
      <div className="grouper-scroll-content" ref={scrollContentRef}>

      {/* Individual Items Section - Always Visible Drop Zone */}
      <div 
        className="singles-section"
        onMouseDown={(e) => {
          // Allow selection to start from section wrapper area (margins, padding, etc)
          const target = e.target as HTMLElement;
          // Don't interfere with buttons, but handle empty areas
          if (!target.closest('button') && 
              !target.closest('.delete-image-btn') &&
              !target.closest('.drop-zone-placeholder')) {
            handleMouseDown(e, singlesContainerRef.current, 'singles');
          }
        }}
      >
        <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Image size={20} /> Individual Items ({filteredSingleItems.length}{activeFilterCount > 0 ? ` of ${singleItems.length}` : ''})
        </h3>
        
        {/* Drop Zone - Always visible */}
        <div 
          className={`drop-zone-placeholder ${dragOverGroup === 'individuals' ? 'drag-over' : ''}`}
          onDragOver={(e) => handleDragOver(e, 'individuals')}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            
            if (!draggedItem) return;
            
            // Make the item individual by giving it its own productGroup (its ID)
            const updated = groupedItems.map(item =>
              item.id === draggedItem.id
                ? { ...item, productGroup: item.id }
                : item
            );
            
            commitUpdate(updated);
            setDraggedItem(null);
            setDraggedFromGroup(null);
            setDragOverGroup(null);
          }}
          onDragLeave={handleDragLeave}
        >
          <div className="drop-zone-content">
            <ArrowDown size={24} className="drop-zone-icon" />
            <p>Drag photos here to make them individual items</p>
          </div>
        </div>

        {/* Items Grid */}
        {singleItems.length > 0 && (
          <div 
            ref={singlesContainerRef}
            className="items-grid selection-container"
            style={{ gridTemplateColumns: `repeat(${columnsPerRow}, 1fr)` }}
            onMouseDown={(e) => handleMouseDown(e, singlesContainerRef.current, 'singles')}
          >
            {/* Selection Box Visualization */}
            {isSelecting && selectionBox && activeContainer === 'singles' && selectionThresholdMet && (
              <div
                className="selection-box"
                style={{
                  position: 'absolute',
                  left: `${selectionBox.x}px`,
                  top: `${selectionBox.y}px`,
                  width: `${selectionBox.width}px`,
                  height: `${selectionBox.height}px`,
                  pointerEvents: 'none'
                }}
              />
            )}
            
            {filteredSingleItems.slice(0, visibleSingleCount).map((item) => {
              const itemGroupId = item.productGroup || item.id;
              const isReorderTarget = reorderOverId === item.id;
              return (
                <div
                  key={item.id}
                  data-item-id={item.id}
                  className={`single-item-card ${dragOverGroup === itemGroupId ? 'drag-over' : ''} ${item.category ? 'has-category' : ''} ${selectedItems.has(item.id) ? 'selected' : ''} ${reorderDragId !== null && (reorderDragId === item.id || selectedItems.has(item.id)) ? 'reorder-dragging' : ''} ${isReorderTarget ? (reorderOverSide === 'left' ? 'reorder-over-left' : 'reorder-over-right') : ''}`}
                  draggable={!selectionThresholdMet}
                  onDragStart={(e) => {
                    if (selectionThresholdMet) { e.preventDefault(); return; }
                    // Use reorder drag (within singles grid)
                    handleReorderDragStart(e, item.id);
                    // Also set up group-drag so dropping ON a group card still works
                    handleDragStart(e, item, itemGroupId);
                  }}
                  onDragEnd={() => { handleDragEnd(); handleReorderDragEnd(); }}
                  onDragOver={(e) => {
                    // If this is a reorder drag, handle reorder hover
                    if (e.dataTransfer.types.includes('application/reorder-single')) {
                      handleReorderDragOver(e, item.id);
                    } else {
                      handleDragOver(e, itemGroupId);
                    }
                  }}
                  onDrop={(e) => {
                    if (e.dataTransfer.types.includes('application/reorder-single')) {
                      handleReorderDrop(e, item.id);
                    } else {
                      handleDrop(e, itemGroupId);
                    }
                  }}
                  onDragLeave={handleDragLeave}
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    // Snapshot selection BEFORE toggleItemSelection fires — used by
                    // handleReorderDragStart so multi-select drags work correctly.
                    reorderPreDragSelectionRef.current = new Set(selectedItemsRef.current);
                    if (!(e.target as HTMLElement).closest('.delete-image-btn') && !(e.target as HTMLElement).closest('.rotate-btn')) {
                      toggleItemSelection(item.id, e);
                    }
                  }}
                  onClick={(e) => e.stopPropagation()}
                  onDoubleClick={(e) => openLightboxForItem((e.currentTarget as HTMLElement).dataset.itemId!)}
                >
                  {item.category && (
                    <div className="category-indicator-small" style={{ display: 'none' }}>
                      <Check size={12} className="category-check" />
                    </div>
                  )}
                  {(item.thumbnailUrl || item.preview || item.imageUrls?.[0]) ? (
                    <div className="image-with-controls">
                      <img 
                        src={item.thumbnailUrl || item.preview || item.imageUrls?.[0]} 
                        alt="Product" 
                        draggable={false}
                        loading="lazy"
                        decoding="async"
                        onError={retryImg}
                        style={{ transform: `rotate(${item.imageRotation || 0}deg)` }}
                      />
                      <div className="image-controls">
                        <button
                          className="rotate-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            const updated = groupedItems.map(i => i.id === item.id ? { ...i, imageRotation: ((i.imageRotation || 0) - 90) % 360 } : i);
                            setGroupedItems(updated);
                            onGrouped(updated);
                          }}
                          title="Rotate left"
                        >⟲</button>
                        <button
                          className="rotate-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            const updated = groupedItems.map(i => i.id === item.id ? { ...i, imageRotation: ((i.imageRotation || 0) + 90) % 360 } : i);
                            setGroupedItems(updated);
                            onGrouped(updated);
                          }}
                          title="Rotate right"
                        >⟳</button>
                        {selectedItems.has(item.id) && selectedItems.size > 1 && (<>
                          <button
                            className="rotate-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              const ids = [...selectedItems];
                              const updated = groupedItems.map(i => ids.includes(i.id) ? { ...i, imageRotation: ((i.imageRotation || 0) - 90) % 360 } : i);
                              setGroupedItems(updated);
                              onGrouped(updated);
                            }}
                            title={`Rotate all ${selectedItems.size} selected left`}
                            style={{ fontSize: '0.6rem', padding: '0 0.25rem' }}
                          >⟲ All</button>
                          <button
                            className="rotate-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              const ids = [...selectedItems];
                              const updated = groupedItems.map(i => ids.includes(i.id) ? { ...i, imageRotation: ((i.imageRotation || 0) + 90) % 360 } : i);
                              setGroupedItems(updated);
                              onGrouped(updated);
                            }}
                            title={`Rotate all ${selectedItems.size} selected right`}
                            style={{ fontSize: '0.6rem', padding: '0 0.25rem' }}
                          >⟳ All</button>
                        </>)}
                        {/* Revert-to-original — only visible when this image has been cropped */}
                        {item.originalStoragePath && (
                          <button
                            className="rotate-btn"
                            title="Revert to original (un-cropped) image"
                            style={{ fontSize: '0.6rem', padding: '0 0.25rem', background: '#b45309', color: '#fff' }}
                            onClick={(e) => { e.stopPropagation(); revertToOriginal(item.id); }}
                          >↺ Orig</button>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="lazy-skeleton lazy-skeleton--error" aria-hidden="true" />
                  )}
                  {selectedItems.has(item.id) && (
                    <div className="selection-indicator"><Check size={20} /></div>
                  )}
                  <button
                    className="delete-image-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteImage(item);
                    }}
                    title="Delete image"
                  >
                    ×
                  </button>
                  {item.category && (
                    <div className="item-info">
                      <span className="category-badge">{item.category}</span>
                    </div>
                  )}
                  {(item.originalName || item.capturedAt) ? (
                    <div className="capture-date-label">
                      {item.originalName && (
                        <div className="original-name-label">{item.originalName}</div>
                      )}
                      {item.capturedAt ? (
                        <>
                          {new Date(item.capturedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                          {' '}
                          {new Date(item.capturedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                        </>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
            {/* Sentinel — triggers next page load when scrolled into view */}
            {visibleSingleCount < filteredSingleItems.length && (
              <div
                ref={sentinelCallbackRef}
                style={{ gridColumn: '1 / -1', height: 1, pointerEvents: 'none' }}
              />
            )}
          </div>
        )}
      </div>

      {/* Product Groups */}
      {filteredMultiItemGroups.length > 0 && (
        <div 
          className="groups-section"
          onMouseDown={(e) => {
            // Allow selection to start from section wrapper area (margins, padding, etc)
            const target = e.target as HTMLElement;
            // Don't interfere with buttons, but handle empty areas
            if (!target.closest('button') &&
                !target.closest('.groups-grid')) {
              handleMouseDown(e, groupsContainerRef.current, 'groups');
            }
          }}
        >
          <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Package size={20} /> Product Groups ({filteredMultiItemGroups.length}{activeFilterCount > 0 ? ` of ${multiItemGroups.length}` : ''})
          </h3>
          <div 
            ref={groupsContainerRef}
            className="groups-grid selection-container"
            style={{ gridTemplateColumns: `repeat(${columnsPerRow}, 1fr)` }}
            onMouseDown={(e) => handleMouseDown(e, groupsContainerRef.current, 'groups')}
          >
            {/* Selection Box Visualization */}
            {isSelecting && selectionBox && activeContainer === 'groups' && selectionThresholdMet && (
              <div
                className="selection-box"
                style={{
                  position: 'absolute',
                  left: `${selectionBox.x}px`,
                  top: `${selectionBox.y}px`,
                  width: `${selectionBox.width}px`,
                  height: `${selectionBox.height}px`,
                  pointerEvents: 'none'
                }}
              />
            )}
            
            {filteredMultiItemGroups.map(([groupId, items]) => (
              <div
                key={groupId}
                data-group-id={groupId}
                className={`product-group-card ${dragOverGroup === groupId ? 'drag-over' : ''} ${items[0].category ? 'has-category' : ''} ${items.every(i => selectedItems.has(i.id)) ? 'all-selected' : items.some(i => selectedItems.has(i.id)) ? 'some-selected' : ''}`}
                draggable={!selectionThresholdMet}
                onDragStart={(e) => {
                  if (selectionThresholdMet) { e.preventDefault(); return; }
                  // Drag the whole group to a CategoryZone
                  const dragData = {
                    item: items[0],
                    productGroup: groupId,
                    source: 'ImageGrouper',
                  };
                  e.dataTransfer.setData('application/json', JSON.stringify(dragData));
                  e.dataTransfer.effectAllowed = 'move';
                }}
                onDragEnd={handleDragEnd}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setDragOverGroup(groupId);
                }}
                onDrop={(e) => handleDrop(e, groupId)}
                onDragLeave={handleDragLeave}
                onMouseDown={(e) => {
                  // Handle selection on mousedown so dragging still registers the selection
                  // even if the drag cancels the subsequent click event.
                  e.stopPropagation();
                  if (!(e.target as HTMLElement).closest('button')) {
                    toggleGroupSelection(groupId, items);
                  }
                }}
                onClick={(e) => e.stopPropagation()}
              >
                {items[0].category && (
                  <div className="category-indicator" style={{ display: 'none' }}>
                    <Check size={14} className="category-check" />
                    <span className="category-label">{items[0].category}</span>
                  </div>
                )}
                <div
                  className={`group-header${items.every(i => selectedItems.has(i.id)) ? ' all-selected' : items.some(i => selectedItems.has(i.id)) ? ' some-selected' : ''}`}
                  style={{ cursor: 'pointer', userSelect: 'none' }}
                  title="Click to select/deselect this group"
                >
                  <span className="group-badge">
                    {items.length} images
                  </span>
                  {items[0].category && (
                    <span className="category-badge">{items[0].category}</span>
                  )}
                  {/* Group-level selection indicator */}
                  {items.every(i => selectedItems.has(i.id)) && (
                    <div className="group-selected-indicator"><Check size={14} /></div>
                  )}
                  {/* Copy crop from first cropped image in this group */}
                  <button
                    className="delete-image-btn"
                    title={items.some(i => i.crop) ? 'Copy crop from this group' : 'No crop set on any image in this group'}
                    style={{
                      marginLeft: 4, borderRadius: 6, border: 'none',
                      padding: '0.15rem 0.42rem', fontSize: '0.68rem', cursor: 'pointer', fontWeight: 600,
                      background: copiedCrop !== undefined && items.some(i => i.id === ([...selectedItems][0]) && i.crop)
                        ? '#6366f1' : 'rgba(99,102,241,0.18)',
                      color: '#c4b5fd',
                      opacity: items.some(i => i.crop) ? 1 : 0.4,
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      const source = items.find(i => i.crop) ?? items[0];
                      setCopiedCrop(source.crop ?? null);
                      setCopiedRotation(source.imageRotation ?? null);
                    }}
                  >
                    Copy
                  </button>
                  {/* Paste crop to entire group — only visible when a crop is in clipboard */}
                  {copiedCrop !== undefined && copiedCrop !== null && (
                    <button
                      className="delete-image-btn"
                      title="Paste copied crop to all images in this group"
                      style={{ marginLeft: 2, background: '#6366f1', color: '#fff', borderRadius: 6, border: 'none', padding: '0.15rem 0.42rem', fontSize: '0.68rem', cursor: 'pointer', fontWeight: 600 }}
                      onClick={async (e) => {
                        e.stopPropagation();
                        const ids = items.map(i => i.id);
                        console.log('[paste] Group Paste clicked — groupId:', groupId, 'items:', ids.length, 'copiedCrop:', copiedCrop, 'copiedRotation:', copiedRotation);
                        console.log('[paste] item storagePathes:', items.map(i => i.storagePath));
                        await runCropBatchPaste(ids, copiedCrop!, copiedRotation);
                      }}
                    >
                      Paste
                    </button>
                  )}
                  {/* Delete entire group button */}
                  <button
                    className="delete-image-btn group-delete-btn"
                    onClick={async (e) => {
                      e.stopPropagation();
                      if (!confirm(`Delete all ${items.length} images in this group? This cannot be undone.`)) return;
                      const storagePaths = items.map(i => i.storagePath).filter(Boolean) as string[];
                      const deletedIds = items.map(i => i.id);
                      await Promise.all(storagePaths.map(p => deleteImageFromStorage(p)));
                      if (storagePaths.length > 0) await supabase.from('product_images').delete().in('storage_path', storagePaths);
                      if (deletedIds.length > 0) await supabase.from('products').delete().in('id', deletedIds);
                      const updated = groupedItems.filter(i => !deletedIds.includes(i.id));
                      commitUpdate(updated, true); // delete is permanent — skip history
                      updateSelection(new Set([...selectedItems].filter(id => !deletedIds.includes(id))));
                      onImageDeleted?.();
                    }}
                    title="Delete this entire group"
                    style={{ marginLeft: 'auto' }}
                  >
                    ×
                  </button>
                </div>
                <div className="group-images">
                  {items.map((item) => (
                    <div
                      key={item.id}
                      data-item-id={item.id}
                      className={`group-image-item ${dragOverPhotoId === item.id && draggedPhotoGroupId === groupId ? 'photo-drag-over' : ''} ${draggedPhotoId === item.id ? 'photo-dragging' : ''}`}
                      draggable
                      onDragStart={(e) => { e.stopPropagation(); handlePhotoDragStart(e, item, groupId); }}
                      onDragOver={(e) => handlePhotoDragOver(e, item.id, groupId)}
                      onDrop={(e) => handlePhotoDrop(e, item.id, groupId)}
                      onDragEnd={handlePhotoDragEnd}
                      onDragLeave={() => setDragOverPhotoId(null)}
                      onDoubleClick={(e) => { e.stopPropagation(); openLightboxForItem((e.currentTarget as HTMLElement).dataset.itemId!); }}
                      onClick={(e) => e.stopPropagation()} // don't bubble to group-level toggle
                    >
                      {(item.thumbnailUrl || item.preview || item.imageUrls?.[0]) ? (
                        <>
                          <img
                            src={item.thumbnailUrl || item.preview || item.imageUrls?.[0]}
                            alt="Product"
                            draggable={false}
                            loading="lazy"
                            decoding="async"
                            onError={retryImg}
                            style={{ transform: `rotate(${item.imageRotation || 0}deg)` }}
                          />
                          {item.originalStoragePath && (
                            <button
                              className="rotate-btn"
                              title="Revert to original (un-cropped) image"
                              style={{ position: 'absolute', bottom: 2, right: 2, fontSize: '0.55rem', padding: '0 0.2rem', background: '#b45309', color: '#fff', zIndex: 10 }}
                              onClick={(e) => { e.stopPropagation(); revertToOriginal(item.id); }}
                            >↺ Orig</button>
                          )}
                        </>
                      ) : (
                        <div className="lazy-skeleton lazy-skeleton--error" aria-hidden="true" />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      </div>{/* /grouper-scroll-content */}
      </div>{/* /image-grouper-container */}

      {/* Lightbox modal */}
      {lightboxSrc && (() => {
        const lbItem = groupedItemsRef.current.find(i => i.id === lightboxItemId)
          ?? singleItemsRef.current.find(i => i.id === lightboxItemId)
          ?? null;
        const canNav = lightboxPool.length > 1;
        const cropping = cropModal.open;
        return (
          <div
            className="lightbox-overlay"
            onClick={() => {
              if (cropModalRef.current.open || cropRequestedRef.current) return;
              setLightboxSrc(null);
            }}
            onKeyDown={(e) => {
              if (cropModalRef.current.open || cropRequestedRef.current) return;
              if (e.key === 'Escape') { setLightboxSrc(null); }
              if (e.key === 'ArrowLeft') { e.preventDefault(); navigateLightboxGrouper(-1); }
              if (e.key === 'ArrowRight') { e.preventDefault(); navigateLightboxGrouper(1); }
            }}
            tabIndex={0}
            ref={(el) => { if (el && !cropModalRef.current.open) el.focus(); }}
          >
            {/* Lightbox content — hidden while crop is active */}
            {!cropping && <>
              <button className="lightbox-close" onClick={(e) => { e.stopPropagation(); setLightboxSrc(null); }}>✕</button>
              <div className="lightbox-toolbar" onClick={(e) => e.stopPropagation()}>
                <button className="lightbox-tool-btn" title="Rotate left" onClick={() => {
                  if (!lbItem) return;
                  commitUpdate(groupedItemsRef.current.map(i =>
                    i.id === lbItem.id ? { ...i, imageRotation: ((i.imageRotation || 0) - 90) % 360 } : i
                  ));
                }}>⟲ Rotate L</button>
                <button className="lightbox-tool-btn" title="Rotate right" onClick={() => {
                  if (!lbItem) return;
                  commitUpdate(groupedItemsRef.current.map(i =>
                    i.id === lbItem.id ? { ...i, imageRotation: ((i.imageRotation || 0) + 90) % 360 } : i
                  ));
                }}>⟳ Rotate R</button>
                <button className="lightbox-tool-btn" title="Crop image" onClick={(e) => {
                  cropRequestedRef.current = true; // synchronous guard — set before any re-render
                  e.stopPropagation();
                  if (!lbItem) { cropRequestedRef.current = false; return; }
                  setCropModal({ open: true, itemId: lbItem.id });
                  setActivePreset('FREE'); setAspectLock(null);
                  setTempCrop({ x: 5, y: 5, w: 90, h: 90 });
                }}>✂ Crop</button>
                {lbItem && (
                  <button className="lightbox-tool-btn" title="Copy rotation"
                    onClick={(e) => { e.stopPropagation(); setCopiedRotation(lbItem.imageRotation || 0); }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{verticalAlign:'middle'}}>
                      <polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.27"/>
                    </svg>
                    {' '}Copy Rotation
                  </button>
                )}
                {lbItem && (
                  <button className="lightbox-tool-btn" title="Copy crop"
                    onClick={(e) => { e.stopPropagation(); setCopiedCrop(lbItem.crop ?? null); }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{verticalAlign:'middle'}}>
                      <polyline points="6 2 6 6 2 6"/><polyline points="18 22 18 18 22 18"/>
                      <path d="M6 6h12v12H6z" strokeDasharray="2 2"/>
                    </svg>
                    {' '}Copy Crop
                  </button>
                )}
              </div>
              {canNav && <button className="lightbox-nav lightbox-nav--prev" onClick={(e) => { e.stopPropagation(); navigateLightboxGrouper(-1); }}>‹</button>}
              <img src={lightboxSrc} alt="Full size preview" className="lightbox-image"
                crossOrigin="anonymous"
                style={{ transform: `rotate(${lbItem?.imageRotation || 0}deg)` }}
                onClick={(e) => e.stopPropagation()} />
              {canNav && <button className="lightbox-nav lightbox-nav--next" onClick={(e) => { e.stopPropagation(); navigateLightboxGrouper(1); }}>›</button>}
              {canNav && <div className="lightbox-counter">{lightboxIndex + 1} / {lightboxPool.length}</div>}
            </>}

            {/* Crop UI — absolutely fills the lightbox overlay */}
            {cropping && (() => {
              const cropItem = groupedItemsRef.current.find(i => i.id === cropModal.itemId)
                ?? singleItemsRef.current.find(i => i.id === cropModal.itemId);
              const imgSrc = lightboxSrc || cropItem?.preview || cropItem?.imageUrls?.[0] || '';
              const rot = cropItem?.imageRotation || 0;
              return (
                <div className="crop-fullscreen" onClick={(e) => e.stopPropagation()}>
                  <div className="crop-fs-topbar">
                    <button className="crop-fs-btn crop-fs-cancel" onClick={() => { setCropModal({ open: false }); setTempCrop(null); setActivePreset('FREE'); setAspectLock(null); }}>Cancel</button>
                    <span className="crop-fs-title">Crop</span>
                    <button className="crop-fs-btn crop-fs-done" disabled={!tempCrop} onClick={async () => {
                      if (!cropModal.itemId || !tempCrop) return;
                      await applyAndPersistTransformGrouper(cropModal.itemId, tempCrop);
                      // onGrouped is now called inside applyAndPersistTransformGrouper
                      // with the correct post-crop items — no need to call it here.
                      setCropModal({ open: false }); setTempCrop(null); setActivePreset('FREE'); setAspectLock(null);
                      setLightboxSrc(null);
                    }}>Done</button>
                  </div>
                  <div className="crop-fs-stage" ref={cropStageRef}
                    onPointerDown={handleGCPointerDown}
                    onPointerMove={handleGCPointerMove}
                    onPointerUp={handleGCPointerUp}
                  >
                    <div className="crop-fs-img-wrap">
                      <img ref={cropImgRef} src={imgSrc} alt="Crop target" className="crop-fs-image"
                        crossOrigin="anonymous"
                        style={{ transform: `rotate(${rot}deg)`, maxHeight: 'calc(100vh - 120px)' }} draggable={false}
                        onLoad={measureGCImg} />
                    </div>
                    {tempCrop && cropImgBounds && (() => {
                      const { l: iL, t: iT, w: iW, h: iH } = cropImgBounds;
                      const rx = iL + tempCrop.x / 100 * iW;
                      const ry = iT + tempCrop.y / 100 * iH;
                      const rw = tempCrop.w / 100 * iW;
                      const rh = tempCrop.h / 100 * iH;
                      return (<>
                        <div className="crop-fs-mask" style={{ top: iT, left: iL, width: iW, height: tempCrop.y / 100 * iH }} />
                        <div className="crop-fs-mask" style={{ top: ry + rh, left: iL, width: iW, height: iH - (tempCrop.y + tempCrop.h) / 100 * iH }} />
                        <div className="crop-fs-mask" style={{ top: ry, left: iL, width: tempCrop.x / 100 * iW, height: rh }} />
                        <div className="crop-fs-mask" style={{ top: ry, left: rx + rw, width: iW - (tempCrop.x + tempCrop.w) / 100 * iW, height: rh }} />
                        <div className="crop-fs-rect" style={{ left: rx, top: ry, width: rw, height: rh }}>
                          <div className="crop-fs-move-zone"
                            onPointerDown={() => { pendingCropModeRef.current = 'move'; }} />
                          <div className="crop-fs-grid-h" style={{ top: '33.33%' }} />
                          <div className="crop-fs-grid-h" style={{ top: '66.66%' }} />
                          <div className="crop-fs-grid-v" style={{ left: '33.33%' }} />
                          <div className="crop-fs-grid-v" style={{ left: '66.66%' }} />
                          {(['nw','ne','sw','se'] as const).map(hh => (
                            <div key={hh} className={`crop-fs-handle crop-fs-corner crop-fs-corner-${hh}`}
                              onPointerDown={() => { pendingCropModeRef.current = hh; }} />
                          ))}
                          {(['n','s','e','w'] as const).map(hh => (
                            <div key={hh} className={`crop-fs-handle crop-fs-edge crop-fs-edge-${hh}`}
                              onPointerDown={() => { pendingCropModeRef.current = hh; }} />
                          ))}
                        </div>
                      </>);
                    })()}
                  </div>
                  <div className="crop-fs-ratiobar">
                    {GC_PRESETS.map(({ label, ratio }) => (
                      <button key={label} className={`crop-fs-pill${activePreset === label ? ' crop-fs-pill--active' : ''}`}
                        onClick={() => applyGCPreset(label, ratio)}>{label}</button>
                    ))}
                  </div>
                </div>
              );
            })()}
          </div>
        );
      })()}
    </>
  );
};

export default ImageGrouper;