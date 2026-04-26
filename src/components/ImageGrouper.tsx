import { useState, useEffect, useRef } from 'react';
import type { ClothingItem } from '../App';
import { supabase } from '../lib/supabase';
import { Package, Image, ArrowDown, ArrowUp, ArrowUpDown, Check } from 'lucide-react';
import LoadingProgress from './LoadingProgress';
import { log } from '../lib/debugLogger';
import './ImageGrouper.css';

/** Retry a failed image load up to 3 times with exponential backoff + cache-bust.
 *  Stores attempt count on the element itself via data-retry so no React state is needed.
 *  Called as onError handler on bare <img> tags that can't use LazyImg. */
function retryImg(e: React.SyntheticEvent<HTMLImageElement>) {
  const img = e.currentTarget;
  const attempt = parseInt(img.dataset.retry ?? '0', 10);
  if (attempt >= 3) {
    log.img(`load failed after 3 retries | src=${img.src.split('/').pop()?.split('?')[0]}`);
    return; // give up, show broken placeholder
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

  // Lightbox state  — pool stores item IDs (not URLs) so we can look up rotation
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [lightboxItemId, setLightboxItemId] = useState<string | null>(null);
  const [lightboxPool, setLightboxPool] = useState<string[]>([]); // array of item IDs
  const [lightboxIndex, setLightboxIndex] = useState<number>(0);

  // Crop UI state (full-screen iOS-style, same as Step 3)
  const [cropModal, setCropModal] = useState<{ open: boolean; itemId?: string }>({ open: false });
  const [tempCrop, setTempCrop] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [aspectLock, setAspectLock] = useState<number | null>(null);
  const [activePreset, setActivePreset] = useState<string>('FREE');
  const cropContainerRef = useRef<HTMLDivElement | null>(null);
  const cropImgRef = useRef<HTMLImageElement | null>(null);
  type CropDragMode = 'new' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw' | 'move';
  const cropDragRef = useRef<{ mode: CropDragMode; startX: number; startY: number; startCrop: { x: number; y: number; w: number; h: number } } | null>(null);

  // ── Debug helper — always-on, readable in DevTools console ──────────────────
  const imgDebug = (event: string, itemId: string, extra?: Record<string, unknown>) => {
    const live = groupedItemsRef.current.find(i => i.id === itemId);
    console.group(`%c[ImageGrouper] ${event}`, 'color:#f59e0b;font-weight:bold');
    console.log('item id      :', itemId);
    console.log('imageUrls[0] :', live?.imageUrls?.[0] ?? '—');
    console.log('preview      :', live?.preview ?? '—');
    console.log('thumbnailUrl :', live?.thumbnailUrl ?? '—');
    console.log('storagePath  :', live?.storagePath ?? '—');
    console.log('productGroup :', live?.productGroup ?? '—');
    if (extra) console.log('extra        :', extra);
    console.groupEnd();
  };

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

    imgDebug('LIGHTBOX OPEN', itemId, { resolvedSrc: src, poolSize: pool.length, isGrouped });
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

  const handleGCPointerDown = (e: React.PointerEvent, mode: CropDragMode) => {
    e.preventDefault(); e.stopPropagation();
    if (!cropContainerRef.current) return;
    const rect = cropContainerRef.current.getBoundingClientRect();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    cropDragRef.current = {
      mode,
      startX: (e.clientX - rect.left) / rect.width,
      startY: (e.clientY - rect.top) / rect.height,
      startCrop: tempCrop ? { ...tempCrop } : { x: 0, y: 0, w: 100, h: 100 },
    };
  };

  const handleGCPointerMove = (e: React.PointerEvent) => {
    const drag = cropDragRef.current;
    if (!drag || !cropContainerRef.current) return;
    const rect = cropContainerRef.current.getBoundingClientRect();
    const cx = gcClamp((e.clientX - rect.left) / rect.width, 0, 1);
    const cy = gcClamp((e.clientY - rect.top) / rect.height, 0, 1);
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
    if (!ratio || !cropContainerRef.current) return;
    const rect = cropContainerRef.current.getBoundingClientRect();
    let pw = 1, ph = 1;
    if (rect.width / rect.height > ratio) { ph = 1; pw = ratio * rect.height / rect.width; }
    else { pw = 1; ph = (rect.width / rect.height) / ratio; }
    setTempCrop({ x: (1-pw)/2*100, y: (1-ph)/2*100, w: pw*100, h: ph*100 });
  };

  const applyAndPersistTransformGrouper = async (itemId: string, cropOverride: { x: number; y: number; w: number; h: number }) => {
    const baseItem = groupedItemsRef.current.find(i => i.id === itemId);
    if (!baseItem) return;
    const item = { ...baseItem, crop: cropOverride };
    try {
      const { createTransformedFile } = await import('../lib/imageTransforms');
      const file = await createTransformedFile(item);
      if (!file) { console.error('[ImageGrouper] createTransformedFile returned null'); return; }
      const { uploadFileToPath, uploadTransformedImage } = await import('../lib/productService');
      let newUrl = '', newPath = '';
      if (item.storagePath) {
        const res = await uploadFileToPath(file, item.storagePath, true);
        if (res) { newUrl = res.url; newPath = res.path; }
      }
      if (!newUrl) {
        const res2 = await uploadTransformedImage(file);
        if (res2) {
          if (item.storagePath) {
            try { await supabase.storage.from('product-images').remove([item.storagePath]); } catch { /* ignore */ }
          }
          newUrl = res2.url; newPath = res2.path;
        }
      }
      if (newUrl) {
        const updated = groupedItemsRef.current.map(i =>
          i.id === itemId ? { ...i, preview: newUrl, storagePath: newPath, imageRotation: 0, crop: undefined } : i
        );
        commitUpdate(updated);
      }
    } catch (err) { console.error('[ImageGrouper] applyAndPersistTransformGrouper error:', err); }
  };

  // ── Log full item table whenever groupedItems changes ───────────────────────
  useEffect(() => {
    if (groupedItems.length === 0) return;
    console.group(`%c[ImageGrouper] ITEMS STATE (${groupedItems.length} total)`, 'color:#f59e0b;font-weight:bold');
    console.table(groupedItems.map(i => ({
      id:          i.id.slice(0, 8),
      name:        i.originalName ?? '—',
      group:       i.productGroup ? i.productGroup.slice(0, 8) : '—',
      imageUrl0:   i.imageUrls?.[0] ? '✓ ' + i.imageUrls[0].split('/').pop()?.split('?')[0].slice(0, 30) : '✗',
      preview:     i.preview ? (i.preview.startsWith('blob:') ? '⚠ blob' : '✓ ' + i.preview.split('/').pop()?.slice(0,30)) : '✗',
      storagePath: i.storagePath ? '✓' : '✗',
    })));
    console.groupEnd();
  }, [groupedItems]);

  // Selection box state
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

  // Global mouse handlers for rubber-band selection.
  //
  // CRITICAL: dep array is [isSelecting] ONLY.
  // All mutable values (selectionStart, selectionBox, selectedItems, etc.) are read
  // through refs that are updated every render. If those values were in the dep array,
  // every setSelectionBox() call during a drag would re-register the listeners on every
  // pixel of movement — causing dropped events and making the selector feel unreliable.
  useEffect(() => {
    if (!isSelecting) return;

    const handleGlobalMouseMove = (e: MouseEvent) => {
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

      // If nothing is new, just sync categories/metadata that may have changed externally
      // (e.g. category assigned via CategoryZones, or group merge from category click).
      if (newItems.length === 0) {
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
            // storagePath, imageUrls, preview, thumbnailUrl from `existing` are always correct
            // because they were set during upload or derived from storagePath at upload time.
            return {
              ...updated,
              productGroup: newGroup,
              // Keep authoritative image fields from existing
              storagePath:  existing.storagePath  || updated.storagePath,
              imageUrls:    existing.imageUrls?.length    ? existing.imageUrls    : (updated.imageUrls    ?? []),
              preview:      existing.preview      || updated.preview,
              thumbnailUrl: existing.thumbnailUrl || updated.thumbnailUrl,
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

      if (toUpload.length > 0) {
        setIsLoading(true);
        setLoadingProgress(0);
        setLoadingMessage(`Uploading ${toUpload.length} image${toUpload.length > 1 ? 's' : ''}...`);
      }

      const incoming: ClothingItem[] = [];
      let processedCount = 0;

      for (const item of newItems) {
        const hasSupabaseUrl = item.imageUrls?.length || (item.preview && item.preview.startsWith('https://'));

        if (uploadedImages.has(item.id) || hasSupabaseUrl) {
          incoming.push({ ...item, productGroup: item.productGroup || item.id });
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
            incoming.push({ ...uploaded, productGroup: uploaded.productGroup || uploaded.id });
          } else {
            incoming.push({ ...item, productGroup: item.productGroup || item.id });
          }
        } else {
          incoming.push({ ...item, productGroup: item.productGroup || item.id });
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

      // Append new items; deduplicate by ID to prevent React key collisions
      setGroupedItems(prev => {
        const existingIdSet = new Set(prev.map(i => i.id));
        const deduped = incoming.filter(i => !existingIdSet.has(i.id));
        return [...prev, ...deduped];
      });

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

  const getGroups = () => {
    const groups: Record<string, ClothingItem[]> = {};
    groupedItems.forEach(item => {
      const groupId = item.productGroup || item.id;
      if (!groups[groupId]) {
        groups[groupId] = [];
      }
      groups[groupId].push(item);
    });
    return groups;
  };

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
    imgDebug(`SELECT ${wasSelected ? 'OFF' : 'ON'}`, itemId, { totalSelected: newSelected.size });
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

    commitUpdate(updated);
    updateSelection(new Set());
  };

  // Ungroup selected items
  const ungroupSelected = () => {
    if (selectedItems.size === 0) {
      alert('Please select items to ungroup');
      return;
    }
    log.grouper(`ungroupSelected | selected=${selectedItems.size}`);

    const updated = groupedItems.map(item =>
      selectedItems.has(item.id)
        ? { ...item, productGroup: item.id, category: undefined }
        : item
    );

    commitUpdate(updated);
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

  const groups = getGroups();
  const groupEntries = Object.entries(groups);

  // ── Sort helpers ─────────────────────────────────────────────────────────
  // Name key: prefer originalName (e.g. "DSC02175.jpg") so numeric sequence is correct.
  // Falls back to the filename portion of storagePath, then to id.
  const nameKey = (item: ClothingItem): string => {
    if (item.originalName) return item.originalName.toLowerCase();
    if (item.storagePath) return item.storagePath.split('/').pop()?.toLowerCase() ?? item.id;
    return item.id.toLowerCase();
  };

  // Natural (numeric-aware) comparator so DSC02175 < DSC02176 < DSC02177 etc.
  const naturalCompare = (a: string, b: string) =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

  const sortItems = (arr: ClothingItem[]): ClothingItem[] => {
    const copy = [...arr];
    switch (sortOrder) {
      case 'date-asc':  return copy.sort((a, b) => (a.capturedAt ?? 0) - (b.capturedAt ?? 0));
      case 'date-desc': return copy.sort((a, b) => (b.capturedAt ?? 0) - (a.capturedAt ?? 0));
      case 'name-asc':  return copy.sort((a, b) => naturalCompare(nameKey(a), nameKey(b)));
      case 'name-desc': return copy.sort((a, b) => naturalCompare(nameKey(b), nameKey(a)));
    }
  };

  // Sort group entries by the representative item (first item, lowest capturedAt, or name)
  const sortGroupEntries = (entries: [string, ClothingItem[]][]): [string, ClothingItem[]][] => {
    const copy = [...entries];
    switch (sortOrder) {
      case 'date-asc':
        return copy.sort(([, a], [, b]) =>
          Math.min(...a.map(i => i.capturedAt ?? 0)) - Math.min(...b.map(i => i.capturedAt ?? 0)));
      case 'date-desc':
        return copy.sort(([, a], [, b]) =>
          Math.min(...b.map(i => i.capturedAt ?? 0)) - Math.min(...a.map(i => i.capturedAt ?? 0)));
      case 'name-asc':
        return copy.sort(([, a], [, b]) => naturalCompare(nameKey(a[0]), nameKey(b[0])));
      case 'name-desc':
        return copy.sort(([, a], [, b]) => naturalCompare(nameKey(b[0]), nameKey(a[0])));
    }
  };

  const multiItemGroups = sortGroupEntries(groupEntries.filter(([_, items]) => items.length > 1));
  const singleItems = sortItems(
    groupEntries
      .filter(([_, items]) => items.length === 1)
      .flatMap(([_, items]) => items)
  );

  // Build a sorted list of unique calendar dates (YYYY-MM-DD) from all items for the filter dropdown
  const uniqueFilterDates: string[] = (() => {
    const dateSet = new Set<string>();
    groupedItems.forEach(item => {
      if (item.capturedAt) {
        dateSet.add(new Date(item.capturedAt).toLocaleDateString('en-CA')); // YYYY-MM-DD
      }
    });
    return [...dateSet].sort();
  })();

  // Build sorted unique category values across all items
  const uniqueFilterCategories: string[] = (() => {
    const cats = new Set<string>();
    groupedItems.forEach(item => { if (item.category) cats.add(item.category); });
    return [...cats].sort();
  })();

  // Apply all filters to both lists (AND logic)
  const toLocalDate = (ts: number) => new Date(ts).toLocaleDateString('en-CA');

  const itemPassesFilters = (item: ClothingItem): boolean => {
    if (filters.date && !(item.capturedAt && toLocalDate(item.capturedAt) === filters.date)) return false;
    if (filters.category === 'uncategorized' && item.category) return false;
    if (filters.category && filters.category !== 'uncategorized' && item.category !== filters.category) return false;
    return true;
  };

  const filteredSingleItems = (() => {
    if (filters.view === 'groups') return [];
    return singleItems.filter(item => itemPassesFilters(item));
  })();

  const filteredMultiItemGroups = (() => {
    if (filters.view === 'singles') return [];
    return multiItemGroups.filter(([, items]) => items.some(i => itemPassesFilters(i)));
  })();

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
        </div>

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
      <div className="grouper-scroll-content">

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
            
            {filteredSingleItems.map((item) => {
              const itemGroupId = item.productGroup || item.id;
              return (
                <div
                  key={item.id}
                  data-item-id={item.id}
                  className={`single-item-card ${dragOverGroup === itemGroupId ? 'drag-over' : ''} ${item.category ? 'has-category' : ''} ${selectedItems.has(item.id) ? 'selected' : ''}`}
                  draggable={!selectionThresholdMet}
                  onDragStart={(e) => {
                    // If selection threshold is met, don't allow dragging
                    if (selectionThresholdMet) {
                      e.preventDefault();
                      return;
                    }
                    handleDragStart(e, item, itemGroupId);
                  }}
                  onDragEnd={handleDragEnd}
                  onDragOver={(e) => handleDragOver(e, itemGroupId)}
                  onDrop={(e) => handleDrop(e, itemGroupId)}
                  onDragLeave={handleDragLeave}
                  onMouseDown={(e) => {
                    // Stop propagation so the container's rubber-band handler doesn't fire.
                    // Handle selection on mousedown so dragging a card still registers the selection
                    // even if the drag cancels the subsequent click event.
                    e.stopPropagation();
                    if (!(e.target as HTMLElement).closest('.delete-image-btn')) {
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
                        <img
                          src={item.thumbnailUrl || item.preview || item.imageUrls?.[0]}
                          alt="Product"
                          draggable={false}
                          loading="lazy"
                          decoding="async"
                          onError={retryImg}
                          style={{ transform: `rotate(${item.imageRotation || 0}deg)` }}
                        />
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
        return (
          <div
            className="lightbox-overlay"
            onClick={() => setLightboxSrc(null)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setLightboxSrc(null);
              if (e.key === 'ArrowLeft') { e.preventDefault(); navigateLightboxGrouper(-1); }
              if (e.key === 'ArrowRight') { e.preventDefault(); navigateLightboxGrouper(1); }
            }}
            tabIndex={0}
            ref={(el) => el?.focus()}
          >
            {/* Standalone close */}
            <button className="lightbox-close" onClick={(e) => { e.stopPropagation(); setLightboxSrc(null); }}>✕</button>
            {/* Toolbar pill */}
            <div className="lightbox-toolbar" onClick={(e) => e.stopPropagation()}>
              <button className="lightbox-tool-btn" title="Rotate left" onClick={() => {
                if (!lbItem) return;
                const updated = groupedItemsRef.current.map(i =>
                  i.id === lbItem.id ? { ...i, imageRotation: ((i.imageRotation || 0) - 90) % 360 } : i
                );
                commitUpdate(updated);
              }}>⟲ Rotate L</button>
              <button className="lightbox-tool-btn" title="Rotate right" onClick={() => {
                if (!lbItem) return;
                const updated = groupedItemsRef.current.map(i =>
                  i.id === lbItem.id ? { ...i, imageRotation: ((i.imageRotation || 0) + 90) % 360 } : i
                );
                commitUpdate(updated);
              }}>⟳ Rotate R</button>
              <button className="lightbox-tool-btn" title="Crop image" onClick={(e) => {
                e.stopPropagation();
                if (!lbItem) return;
                setCropModal({ open: true, itemId: lbItem.id });
                setActivePreset('FREE'); setAspectLock(null);
                setTempCrop({ x: 5, y: 5, w: 90, h: 90 });
              }}>✂ Crop</button>
            </div>
            {/* Nav arrows */}
            {canNav && (
              <button className="lightbox-nav lightbox-nav--prev" onClick={(e) => { e.stopPropagation(); navigateLightboxGrouper(-1); }}>‹</button>
            )}
            <img
              src={lightboxSrc}
              alt="Full size preview"
              className="lightbox-image"
              style={{ transform: `rotate(${lbItem?.imageRotation || 0}deg)` }}
              onClick={(e) => e.stopPropagation()}
            />
            {canNav && (
              <button className="lightbox-nav lightbox-nav--next" onClick={(e) => { e.stopPropagation(); navigateLightboxGrouper(1); }}>›</button>
            )}
            {canNav && (
              <div className="lightbox-counter">{lightboxIndex + 1} / {lightboxPool.length}</div>
            )}
          </div>
        );
      })()}

      {/* Full-screen crop UI — same iOS-style as Step 3 */}
      {cropModal.open && (() => {
        const cropItem = groupedItemsRef.current.find(i => i.id === cropModal.itemId)
          ?? singleItemsRef.current.find(i => i.id === cropModal.itemId);
        const imgSrc = cropItem?.preview || cropItem?.imageUrls?.[0] || '';
        const rot = cropItem?.imageRotation || 0;
        return (
          <div className="crop-fullscreen">
            <div className="crop-fs-topbar">
              <button className="crop-fs-btn crop-fs-cancel" onClick={() => { setCropModal({ open: false }); setTempCrop(null); setActivePreset('FREE'); setAspectLock(null); }}>Cancel</button>
              <span className="crop-fs-title">Crop</span>
              <button className="crop-fs-btn crop-fs-done" disabled={!tempCrop} onClick={async () => {
                if (!cropModal.itemId || !tempCrop) return;
                await applyAndPersistTransformGrouper(cropModal.itemId, tempCrop);
                setCropModal({ open: false }); setTempCrop(null); setActivePreset('FREE'); setAspectLock(null);
                setLightboxSrc(null); // close stale lightbox after crop changes the image
              }}>Done</button>
            </div>
            <div
              className="crop-fs-stage"
              ref={cropContainerRef}
              onPointerDown={(e) => handleGCPointerDown(e, 'new')}
              onPointerMove={handleGCPointerMove}
              onPointerUp={handleGCPointerUp}
            >
              <img ref={cropImgRef} src={imgSrc} alt="Crop target" className="crop-fs-image"
                style={{ transform: `rotate(${rot}deg)` }} draggable={false} />
              {tempCrop && (<>
                <div className="crop-fs-mask" style={{ top: 0, left: 0, right: 0, height: `${tempCrop.y}%` }} />
                <div className="crop-fs-mask" style={{ top: `${tempCrop.y + tempCrop.h}%`, left: 0, right: 0, bottom: 0 }} />
                <div className="crop-fs-mask" style={{ top: `${tempCrop.y}%`, left: 0, width: `${tempCrop.x}%`, height: `${tempCrop.h}%` }} />
                <div className="crop-fs-mask" style={{ top: `${tempCrop.y}%`, left: `${tempCrop.x + tempCrop.w}%`, right: 0, height: `${tempCrop.h}%` }} />
                <div className="crop-fs-rect" style={{ left: `${tempCrop.x}%`, top: `${tempCrop.y}%`, width: `${tempCrop.w}%`, height: `${tempCrop.h}%` }}>
                  <div className="crop-fs-move-zone" onPointerDown={(e) => { e.stopPropagation(); handleGCPointerDown(e, 'move'); }} />
                  <div className="crop-fs-grid-h" style={{ top: '33.33%' }} /><div className="crop-fs-grid-h" style={{ top: '66.66%' }} />
                  <div className="crop-fs-grid-v" style={{ left: '33.33%' }} /><div className="crop-fs-grid-v" style={{ left: '66.66%' }} />
                  {(['nw','ne','sw','se'] as const).map(h => (
                    <div key={h} className={`crop-fs-handle crop-fs-corner crop-fs-corner-${h}`}
                      onPointerDown={(e) => { e.stopPropagation(); handleGCPointerDown(e, h); }} />
                  ))}
                  {(['n','s','e','w'] as const).map(h => (
                    <div key={h} className={`crop-fs-handle crop-fs-edge crop-fs-edge-${h}`}
                      onPointerDown={(e) => { e.stopPropagation(); handleGCPointerDown(e, h); }} />
                  ))}
                </div>
              </>)}
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
    </>
  );
};

export default ImageGrouper;