import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo, memo } from 'react';
import type { ClothingItem } from '../App';
import { supabase } from '../lib/supabase';
import { Package, Image, ArrowDown, ArrowUpDown, Check, RotateCcw, CornerUpLeft,
         CornerUpRight, X, Camera, Circle, CircleDot, Crosshair, ClipboardPaste,
         Trash2, Scissors, Columns3, Layers, ChevronsDownUp, Filter,
         SlidersHorizontal } from 'lucide-react';
import {
  PHONE_BREAKPOINT_PX,
  clampGridColumns,
  clampGroupGridColumns,
  gridColumnBounds,
} from './responsiveGrid';
import LoadingProgress from './LoadingProgress';
import { log, isDebugEnabled } from '../lib/debugLogger';
import { publicImageUrl } from '../lib/storageUrls';
import './ImageGrouper.css';
import { createTransformQueue } from '../lib/imageTransforms';
import { isRepeatToggle as isRepeatToggleAt, isSelectionModeActive } from '../lib/selectionGesture';
import { stackLayers, stackReserve, stackOverflowBadge } from '../lib/stackLayout';
import './ProductDescriptionGenerator.css'; // crop-fs-* styles shared with PDG

/** Retry a failed image load up to 3 times with exponential backoff + cache-bust.
 *  Stores attempt count on the element itself via data-retry so no React state is needed.
 *  Called as onError handler on bare <img> tags that can't use LazyImg.
 *  After retries are exhausted we just show the broken placeholder — we do NOT delete
 *  the product_images row, because an <img> error also fires on transient failures and
 *  deleting on render-time error permanently destroys references to files that may
 *  still exist (and compounds across viewers in the shared workspace). */
function retryImg(e: React.SyntheticEvent<HTMLImageElement>) {
  const img = e.currentTarget;
  const attempt = parseInt(img.dataset.retry ?? '0', 10);
  if (attempt >= 3) {
    const rawSrc = (img.dataset.src ?? img.src).split('?')[0];
    log.img(`load failed after 3 retries | src=${rawSrc.split('/').pop()}`);
    return; // show broken placeholder — no destructive DB delete
  }
  img.dataset.retry = String(attempt + 1);
  const delay = 500 * Math.pow(3, attempt); // 500ms, 1500ms, 4500ms
  const originalSrc = img.dataset.src ?? img.src.split('?')[0];
  if (!img.dataset.src) img.dataset.src = img.src.split('?')[0];
  log.img(`load error → retry ${attempt + 1}/3 in ${delay}ms | src=${originalSrc.split('/').pop()}`);
  setTimeout(() => { img.src = `${originalSrc}?t=${Date.now()}`; }, delay);
}

/* ── Hoisted Intl instances (F1/F17) ────────────────────────────────────────────
 * `toLocaleDateString(undefined, {...})` / `localeCompare(x, undefined, {...})` miss
 * V8's formatter cache whenever an options object is passed, so each call resolves a
 * fresh Intl object. At 1,500 cards x 2 date calls that measured 82.5 ms of pure
 * formatting PER ImageGrouper render (and it re-renders on every App render); the sort
 * comparators built ~17,700 collators per sort. Reusing these instances is
 * spec-equivalent — identical output, one construction. */
const CARD_DATE_FMT   = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const CARD_TIME_FMT   = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const FILTER_DATE_FMT = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
const EN_CA_DATE_FMT  = new Intl.DateTimeFormat('en-CA');   // YYYY-MM-DD filter keys
const NAME_COLLATOR   = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/* ── Sort choices as DATA ─────────────────────────────────────────────────────
 * The View popover renders these as a radio-style list, so the four sort buttons
 * that used to sit in the toolbar exist once here instead of four times in JSX.
 * `as const` keeps each `value` a literal, so it stays assignable to SortOrder. */
const SORT_OPTIONS = [
  { value: 'date-asc'  as const, label: 'Date \u00b7 oldest first', title: 'Oldest first (capture date)' },
  { value: 'date-desc' as const, label: 'Date \u00b7 newest first', title: 'Newest first (capture date)' },
  { value: 'name-asc'  as const, label: 'Name \u00b7 A \u2192 Z',  title: 'Sort by filename A \u2192 Z' },
  { value: 'name-desc' as const, label: 'Name \u00b7 Z \u2192 A',  title: 'Sort by filename Z \u2192 A' },
];

/** "Mar 12, 2026 3:41 PM" for a capturedAt, memoized by timestamp so a re-render is a
 *  Map lookup instead of two Intl formats. Keyed by the raw number, so the cache is
 *  bounded by distinct capture times; cleared wholesale past a ceiling (it is a pure
 *  function of `ts`, so dropping entries only costs a re-derive). */
const CAPTURE_LABEL_CACHE_MAX = 5000;
const captureLabelCache = new Map<number, string>();
function captureLabel(ts: number): string {
  let label = captureLabelCache.get(ts);
  if (label === undefined) {
    if (captureLabelCache.size >= CAPTURE_LABEL_CACHE_MAX) captureLabelCache.clear();
    const d = new Date(ts);
    label = `${CARD_DATE_FMT.format(d)} ${CARD_TIME_FMT.format(d)}`;
    captureLabelCache.set(ts, label);
  }
  return label;
}

/** YYYY-MM-DD local date key for the date filter. Same output as
 *  `toLocaleDateString('en-CA')`, one hoisted formatter. */
const localDateKey = (ts: number): string => EN_CA_DATE_FMT.format(new Date(ts));

/* ── Sort helpers — module scope so they are one function per module, not one per
 *    render, and so the comparators reuse NAME_COLLATOR. Both are pure functions of
 *    the item; neither closes over component state. */
const nameKey = (item: ClothingItem): string => {
  if (item.originalName) return item.originalName.toLowerCase();
  if (item.storagePath) return item.storagePath.split('/').pop()?.toLowerCase() ?? item.id;
  return item.id.toLowerCase();
};
const naturalCompare = (a: string, b: string): number => NAME_COLLATOR.compare(a, b);

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
  /** Call this after a category preset is applied so pick-mode can advance to the next N. */
  onCategoryAssigned: () => void;
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
      log.grouper(`batchId changed: ${prevBatchIdRef.current} → ${batchId} — resetting internal state (had ${groupedItemsRef.current.length} items)`);
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
      log.grouper('[commitFunctional] prev.length=', prev.length, '→ next.length=', next.length, 'ref updated synchronously');
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
  /**
   * Founder report 30 — "when multi-selecting, don't allow double-click to zoom".
   *
   * The selection as it stood when the CURRENT click gesture began, i.e. before
   * the first mousedown toggled anything. A double-click's second mousedown must
   * not be mistaken for a fresh gesture, so this is only refreshed when the
   * mousedown is outside the `TOGGLE_REPEAT_MS` repeat window.
   *
   * Two things read it: whether the double-click should zoom at all (it must not
   * when the user was already selecting), and what to restore when it does zoom
   * (a double-click means "show me this", not "select this").
   */
  const selectionAtGestureStartRef = useRef<Set<string>>(new Set());
  const [draggedItem, setDraggedItem] = useState<ClothingItem | null>(null);
  const [draggedFromGroup, setDraggedFromGroup] = useState<string | null>(null);
  const [dragOverGroup, setDragOverGroup] = useState<string | null>(null);
  // Which group's ⋯ actions menu is open (Copy/Paste crop, Ungroup, Delete)
  const [openMenuGroupId, setOpenMenuGroupId] = useState<string | null>(null);
  // Photo tools pick mode — when ON, clicking any photo (including photos INSIDE
  // group cards) toggles its selection so the sidebar Photo tools (rotate/crop/
  // revert/delete) can act on it. Replaces the old per-photo hover buttons.
  const [photoSelectMode, setPhotoSelectMode] = useState(false);
  const photoSelectModeRef = useRef(false);

  // Photo reorder drag state (within a group)
  const [draggedPhotoId, setDraggedPhotoId] = useState<string | null>(null);
  const [draggedPhotoGroupId, setDraggedPhotoGroupId] = useState<string | null>(null);
  const [dragOverPhotoId, setDragOverPhotoId] = useState<string | null>(null);

  // Reorder drag state for the singles grid
  const [reorderDragId, setReorderDragId] = useState<string | null>(null);
  const [reorderOverId, setReorderOverId] = useState<string | null>(null);
  const [reorderOverSide, setReorderOverSide] = useState<'left' | 'right'>('left');
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

  // ── Filter / View popovers ───────────────────────────────────────────────
  // ONE at a time. They hold what used to be ~14 always-visible toolbar
  // controls (four sort buttons, the two view toggles, the date select, one
  // chip per category, the columns slider, the clear-originals action), so the
  // idle toolbar is a single line.
  const [openPanel, setOpenPanel] = useState<'filter' | 'view' | null>(null);
  const filterTriggerRef = useRef<HTMLButtonElement | null>(null);
  const viewTriggerRef   = useRef<HTMLButtonElement | null>(null);

  // Auto-group state — number of photos per product
  const [autoGroupN, setAutoGroupN] = useState<string>('4');
  // Pick-mode — auto-selects next N singletons after each manual group action
  const [pickMode, setPickMode] = useState(false);
  const pickModeRef = useRef(false);
  const pickCursorRef = useRef(0); // position in filename-sorted ungrouped list
  // Re-assigned every render so it always captures the latest autoGroupN value
  const advancePickSelectionRef = useRef<(items: ClothingItem[]) => void>(() => {});
  // Ref flag: set to true when pick needs to advance after the NEXT groupedItems change.
  // Using a ref (not state) means setting it never causes a render — the advance only
  // fires when groupedItems actually changes (i.e. after initializeItems has synced
  // the category metadata from the updated items prop into local state).
  const pendingPickRef = useRef(false);

  // Watch groupedItems: when pendingPickRef is set, advance pick selection.
  // Fires only when groupedItems state changes, so category data is always fresh.
  useEffect(() => {
    if (!pendingPickRef.current) return;
    if (!pickModeRef.current) { pendingPickRef.current = false; return; }
    log.grouper(`[PICK] groupedItems effect | groupedItems=${groupedItems.length} pickMode=true`);
    pendingPickRef.current = false;
    advancePickSelectionRef.current(groupedItems);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupedItems]);

  // When N changes while pick mode is active, immediately re-select from the
  // current cursor position so the highlighted images update in real time.
  useEffect(() => {
    if (!pickModeRef.current) return;
    // Reset cursor so new N selects from the top of the remaining ungrouped list
    pickCursorRef.current = 0;
    advancePickSelectionRef.current(groupedItemsRef.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoGroupN]);

  // ── Unmount cleanup for animation frames ─────────────────────────────────
  // The auto-scroll loop re-queues itself every frame and is only cancelled by
  // handleReorderDragEnd. A drag that ends abnormally (unmount mid-drag, a batch
  // switch remounting via the `key` prop, an aborted drop) left a 60 fps rAF
  // running for the tab's lifetime, calling startAutoScroll against a detached
  // node. Cancel on unmount, unconditionally.
  useEffect(() => () => {
    if (autoScrollRafRef.current !== null) {
      cancelAnimationFrame(autoScrollRafRef.current);
      autoScrollRafRef.current = null;
    }
  }, []);
  // (the rubber-band's own rAF is cancelled by its effect cleanup, which React
  //  runs on unmount as well as on every isSelecting change)

  // Grid columns per row (2–12 on desktop, 1–3 on a phone — see responsiveGrid.ts)
  const [columnsPerRow, setColumnsPerRow] = useState<number>(8);

  /* Phone layout flag. The grid's column count is applied as an INLINE style, so
   * a media query can never override it — the clamp has to happen in JS. Nothing
   * else here is JS-driven: every other phone adaptation is CSS. */
  const [isPhone, setIsPhone] = useState<boolean>(
    () => typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia(`(max-width: ${PHONE_BREAKPOINT_PX}px)`).matches
  );
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(`(max-width: ${PHONE_BREAKPOINT_PX}px)`);
    const onChange = (e: MediaQueryListEvent) => setIsPhone(e.matches);
    setIsPhone(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // Effective grid widths. The stored preference is never mutated, so rotating
  // back to a wide viewport restores the user's chosen density.
  const singlesGridColumns = clampGridColumns(columnsPerRow, isPhone);
  const groupsGridColumns = clampGroupGridColumns(columnsPerRow, isPhone);
  const columnSliderBounds = gridColumnBounds(isPhone);

  /* Which pile is fanned open. ONE at a time by default — a screen of expanded
   * groups is the old all-thumbnails grid this replaced. Keyed by group id, so
   * it survives a re-sort/re-filter; a group that stops existing simply stops
   * matching (no cleanup effect, nothing to go stale). */
  const [expandedGroupId, setExpandedGroupId] = useState<string | null>(null);

  // Format painter — copy crop/rotation style from one image and paste to others
  const [copiedRotation, setCopiedRotation] = useState<number | null>(null);
  const [copiedCrop, setCopiedCrop] = useState<{ x: number; y: number; w: number; h: number } | null | undefined>(undefined);
  // Aspect (w/h) of the frame the copied crop was DRAWN on. `crop` is percent of
  // frame, so it only transfers faithfully between images of the same shape —
  // recording the source shape lets a paste onto a differently-shaped image keep
  // the drawn rectangle instead of stretching it to the new aspect. Null (the
  // resolve failed, or nothing copied) falls back to plain percent-of-frame.
  const [copiedCropAspect, setCopiedCropAspect] = useState<number | null>(null);
  const [cropPasteProgress, setCropPasteProgress] = useState<{ done: number; total: number; status: 'running' | 'done'; failed: string[] } | null>(null);
  // Individual-crop upload indicator (shown while a single image is being cropped + uploaded)
  const [cropUploadInProgress, setCropUploadInProgress] = useState(false);

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
    publicImageUrl(item.storagePath) || item.imageUrls?.[0] || item.preview || '';

  /** Open lightbox by item ID — builds a pool of item IDs for navigation. */
  /**
   * Double-click entry point for the lightbox (report 30).
   *
   * While the user is building a selection — anything already selected when the
   * gesture started, or either pick mode on — a double-click must stay a
   * selection gesture: the click handlers have already applied exactly ONE
   * toggle (the repeat guard eats the second), so the correct thing to do here
   * is nothing at all.
   *
   * When it DOES zoom, the selection is put back the way it was before the
   * gesture: a double-click means "show me this photo", and silently leaving it
   * selected is how a later Group/Delete picks up a photo the user never chose.
   */
  const openLightboxFromDoubleClick = (itemId: string) => {
    if (selectionModeActive()) {
      log.grouper(`lightbox suppressed — selection mode active (item=${itemId})`);
      return;
    }
    const before = selectionAtGestureStartRef.current;
    if (selectedItemsRef.current.size !== before.size) updateSelection(new Set(before));
    openLightboxForItem(itemId);
  };

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

  // ── Crop concurrency control ───────────────────────────────────────────────
  // Every transform for a given item is chained behind the previous one. Two
  // pastes that overlap on the same item (double-clicked Paste, the Retry button
  // firing while the first pass is still draining, a group card and the toolbar
  // targeting the same photo) otherwise both read the same pre-crop baseItem,
  // upload to two paths, and race each other's storage delete — one of them wins
  // and the other's file is removed out from under the row that points at it.
  const itemTransformQueueRef = useRef(createTransformQueue());
  const queueItemTransform = (itemId: string, task: () => Promise<void>): Promise<void> =>
    itemTransformQueueRef.current.run(itemId, task);

  // One paste batch at a time — the Retry button and a second Paste click are
  // both reachable while a run is still draining.
  const cropPasteRunningRef = useRef(false);

  type CropApplyOptions = {
    /** Part of a bulk paste: the batch owns progress + the parent notification,
     *  failures must propagate, and pixels come from the cached original. */
    batched?: boolean;
    /** Aspect of the frame the pasted crop was drawn on, when known. */
    cropSourceAspect?: number | null;
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

  const applyAndPersistTransformGrouper = async (
    itemId: string,
    cropOverride: { x: number; y: number; w: number; h: number },
    rotationOverride?: number,
    opts: CropApplyOptions = {},
  ) => {
    const { batched = false, cropSourceAspect = null } = opts;
    const baseItem = groupedItemsRef.current.find(i => i.id === itemId);
    if (!baseItem) throw new Error(`[crop] baseItem not found: ${itemId}`);
    const rot = rotationOverride !== undefined ? rotationOverride : (baseItem.imageRotation || 0);
    const item = { ...baseItem, imageRotation: rot, crop: cropOverride };
    log.grouper('[crop] starting — item:', itemId, 'storagePath:', item.storagePath, 'crop:', cropOverride, 'batched:', batched);
    if (!batched) setCropUploadInProgress(true);
    try {
      const { createTransformedFile } = await import('../lib/imageTransforms');
      // A BULK PASTE reads the cached ORIGINAL: the pasted percentages describe a
      // full frame, so re-applying them to an item that was already cropped would
      // crop the crop and leave it framed differently from the rest of the batch.
      // An INTERACTIVE crop must read the current file — that is what the modal
      // displayed and what the percentages were drawn on.
      const file = await createTransformedFile(item, {
        sourceMode: batched ? 'original' : 'current',
        cropSourceAspect,
      });
      if (!file) throw new Error(`[crop] createTransformedFile returned null for ${itemId} — check CORS or image src`);
      log.grouper('[crop] transformed file ok, size:', file.size);

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
        log.grouper('[crop] uploading to new path:', freshPath);
        const { data, error } = await supabase.storage
          .from('product-images')
          .upload(freshPath, file, { cacheControl: '3600', upsert: false });
        if (error) {
          // Not fatal on its own — the uploadTransformedImage fallback below gets
          // a turn — but it must not silently leave the item uncropped.
          console.error('[crop] storage upload error:', error.message);
        } else {
          newPath = data.path;
          newUrl = publicImageUrl(data.path);
          log.grouper('[crop] upload ok — newPath:', newPath, 'newUrl:', newUrl);
        }
      }

      // Fallback: use uploadTransformedImage with explicit itemId
      if (!newUrl) {
        log.grouper('[crop] falling back to uploadTransformedImage');
        const { uploadTransformedImage } = await import('../lib/productService');
        const res = await uploadTransformedImage(file, userId, itemId);
        if (res) { newUrl = res.url; newPath = res.path; }
        else throw new Error(`[crop] upload failed for ${itemId} — uploadTransformedImage returned null`);
      }

      log.grouper('[crop] writing to DB — product_id:', itemId, 'newPath:', newPath);
      const { error: upsertErr } = await supabase.from('product_images').insert(
        { product_id: itemId, user_id: userId, image_url: newUrl, storage_path: newPath }
      );
      if (upsertErr) console.error('[crop] product_images insert error:', upsertErr.message);
      else log.grouper('[crop] product_images insert ok');

      // ── Delete the previous CROP (not the original) ─────────────────────────
      // If this is a re-crop, the intermediate cropped file is no longer needed.
      // The original file is intentionally kept in storage so the user can revert.
      if (prevCropPath && prevCropPath !== newPath && prevCropPath !== originalPathToCache) {
        const { error: storageDelErr } = await supabase.storage.from('product-images').remove([prevCropPath]);
        if (storageDelErr) console.warn('[crop] prev-crop storage delete error:', storageDelErr.message);
        const { error: dbDelErr } = await supabase.from('product_images').delete().eq('storage_path', prevCropPath);
        if (dbDelErr) console.warn('[crop] prev-crop DB row delete error:', dbDelErr.message);
        log.grouper('[crop] deleted previous crop:', prevCropPath);
      } else if (isFirstCrop) {
        log.grouper('[crop] first crop — original preserved in storage at:', originalPathToCache);
      }

      // ── Update React state via functional updater (race-condition safe) ──────
      log.grouper('[crop] commitFunctional — item:', itemId, 'newPath:', newPath, 'originalCached:', originalPathToCache);
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
      //
      // Inside a BATCH this notification is skipped entirely. Concurrent items
      // would each map that same pre-batch array through their OWN mapper, so
      // every payload dropped the other items' crops; App would store one, and
      // the stale storagePath coming back through the `items` prop trips the
      // `pathChanged` branch of initializeItems, which reverts the item's URLs
      // to the pre-crop file. runCropBatchPaste sends one payload at the end.
      if (!batched) onGrouped(groupedItemsRef.current.map(cropMapper));

      log.grouper('[crop] done ✅ item:', itemId, 'newUrl:', newUrl);
      // Evict the old URL from the session image cache so a subsequent re-crop
      // loads the freshly-cropped image rather than the stale pre-crop bitmap.
      const { evictCachedImage } = await import('../lib/imageTransforms');
      if (item.preview) evictCachedImage(item.preview);
      if (item.imageUrls?.[0]) evictCachedImage(item.imageUrls[0]);
    } catch (err) {
      // MUST propagate: runCropBatchPaste counts a resolved promise as a success,
      // so swallowing here reported failed items as done and left them uncropped
      // among hundreds of correct ones — with no retry offered.
      console.error('[crop] unexpected error:', err);
      throw err;
    }
    finally { if (!batched) setCropUploadInProgress(false); }
  };

  // ── Record what shape a copied crop was drawn on ───────────────────────────
  // Fire-and-forget: the aspect only refines the paste, and a failure degrades
  // to plain percent-of-frame, i.e. exactly the historical behaviour. The
  // resolve also warms the session image cache with the copy source, which a
  // paste from the original will read again.
  const captureCopiedCrop = (source: ClothingItem, crop: ClothingItem['crop']) => {
    setCopiedCrop(crop ?? null);
    setCopiedCropAspect(null);
    if (!crop) return;
    const url = source.preview || source.imageUrls?.[0] || '';
    if (!url) return;
    void (async () => {
      try {
        const { getSourceFrameAspect } = await import('../lib/imageTransforms');
        const aspect = await getSourceFrameAspect(url, source.imageRotation || 0);
        log.grouper('[paste] copied crop source aspect:', aspect, 'from', source.id);
        setCopiedCropAspect(aspect);
      } catch { /* percent-of-frame fallback */ }
    })();
  };

  // ── Revert a single item to its cached original ─────────────────────────────
  const revertToOriginal = async (itemId: string) => {
    const item = groupedItemsRef.current.find(i => i.id === itemId);
    if (!item?.originalStoragePath || !item.originalUrl) {
      console.warn('[revert] no original cached for item', itemId);
      return;
    }
    log.grouper('[revert] reverting item:', itemId, 'to', item.originalStoragePath);
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
      log.grouper('[revert] done for item:', itemId);
    } catch (err) { console.error('[revert] error:', err); }
  };

  // ── Shared batch crop paste helper ─────────────────────────────────────────
  // Applies crop (+ optional rotation) to a list of item IDs in parallel batches.
  // Tracks failures and exposes a retry button in the progress toast.
  const runCropBatchPaste = async (
    targetIds: string[],
    crop: { x: number; y: number; w: number; h: number },
    rotation: number | null = null,
    cropSourceAspect: number | null = null,
  ) => {
    if (cropPasteRunningRef.current) {
      console.warn('[paste] a paste batch is already running — ignoring this one');
      return;
    }
    log.grouper('[paste] runCropBatchPaste START — ids:', targetIds.length, 'crop:', crop, 'rotation:', rotation, 'srcAspect:', cropSourceAspect);
    log.grouper('[paste] groupedItemsRef.current.length at start:', groupedItemsRef.current.length);
    if (targetIds.length === 0) { console.warn('[paste] targetIds empty — nothing to do'); return; }
    // De-duplicate: a photo can be reachable from both the selection and a group
    // card, and applying the same crop twice is wasted uploads at best.
    const ids = [...new Set(targetIds)];
    const total = ids.length;
    const failed: string[] = [];
    cropPasteRunningRef.current = true;
    setCropPasteProgress({ done: 0, total, status: 'running', failed: [] });
    let wakeLock: WakeLockSentinel | null = null;
    try {
      if ('wakeLock' in navigator)
        wakeLock = await (navigator as Navigator & { wakeLock: { request(type: string): Promise<WakeLockSentinel> } }).wakeLock.request('screen');
    } catch { /* ignore */ }
    const BATCH = 8;
    let done = 0;
    try {
      for (let i = 0; i < ids.length; i += BATCH) {
        const chunk = ids.slice(i, i + BATCH);
        await Promise.all(chunk.map(id =>
          queueItemTransform(id, () => applyAndPersistTransformGrouper(
            id,
            crop,
            rotation !== null ? rotation : undefined,
            { batched: true, cropSourceAspect },
          ))
            .then(() => { done++; log.grouper('[paste] ✅ item done:', id, done, '/', total); setCropPasteProgress({ done, total, status: 'running', failed: [...failed] }); })
            .catch((err) => { done++; failed.push(id); console.error('[paste] ❌ item failed:', id, err); setCropPasteProgress({ done, total, status: 'running', failed: [...failed] }); })
        ));
      }
    } finally {
      if (wakeLock) { try { await wakeLock.release(); } catch { /* ignore */ } }
      cropPasteRunningRef.current = false;
    }
    log.grouper('[paste] all done — failed:', failed.length, 'groupedItemsRef.current.length:', groupedItemsRef.current.length);
    log.grouper('[paste] scheduling deferred onGrouped with', groupedItemsRef.current.length, 'items');
    // The ONLY parent notification for the whole batch. Per-item calls are
    // suppressed (see applyAndPersistTransformGrouper): each would have mapped a
    // pre-batch array through its own mapper and dropped its siblings' crops.
    setTimeout(() => {
      log.grouper('[paste] deferred onGrouped firing — ref.length:', groupedItemsRef.current.length);
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
  // SOURCE OF TRUTH for the in-progress rubber-band rect (F3). It used to be a
  // per-render mirror of `selectionBox` state; now it is the other way round —
  // mousemove writes only this ref, and the rAF loop below flushes it into state
  // at most ONCE PER FRAME. Before, `setSelectionBox` ran on every `mousemove`
  // AND on every rAF frame, each with a fresh object literal so React could never
  // bail out: 60-120 full reconciliations of a 1 500-card grid per second, each
  // one an order of magnitude over the frame budget.
  const selectionBoxRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null);
  /** Last rect actually committed to state — lets the frame flush skip a no-op render. */
  const paintedSelectionBoxRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null);
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
            selectionBoxRef.current = { x, y, width: Math.abs(currentX - start.x), height: Math.abs(currentY - start.y) };
          }
        }
      }
      // ── One state update per frame, max (F3) ───────────────────────────────
      // Every mousemove and every scroll step above has written the ref only.
      // This is the single place the rect reaches React, and it is skipped
      // entirely when the rect has not actually moved since the last commit.
      const next = selectionBoxRef.current;
      const painted = paintedSelectionBoxRef.current;
      const changed = next === null
        ? painted !== null
        : painted === null || next.x !== painted.x || next.y !== painted.y
          || next.width !== painted.width || next.height !== painted.height;
      if (changed) {
        paintedSelectionBoxRef.current = next;
        setSelectionBox(next);
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

      // Ref only — the rAF loop above commits it to state once per frame (F3).
      selectionBoxRef.current = { x, y, width, height };
    };

    const handleGlobalMouseUp = (e: MouseEvent) => {
      // Only perform selection if threshold was met
      const box = selectionBoxRef.current;
      if (!box || !currentContainerRef.current || !selectionThresholdMetRef.current) {
        selectionBoxRef.current = null;
        paintedSelectionBoxRef.current = null;
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
        // Loop-invariant reads hoisted: getBoundingClientRect() forces a layout
        // flush, and calling it on the container inside the loop doubled the count
        // (3 000 forced reflows for 1 500 cards instead of 1 501).
        const containerRect = containerRef.getBoundingClientRect();
        const scrollLeft = containerRef.scrollLeft;
        const scrollTop = containerRef.scrollTop;
        groupCards.forEach((element) => {
          const itemRect = element.getBoundingClientRect();
          const itemX = itemRect.left - containerRect.left + scrollLeft;
          const itemY = itemRect.top - containerRect.top + scrollTop;
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
        const containerRect = containerRef.getBoundingClientRect();   // see note above
        const scrollLeft = containerRef.scrollLeft;
        const scrollTop = containerRef.scrollTop;
        itemElements.forEach((element) => {
          const itemRect = element.getBoundingClientRect();
          const itemX = itemRect.left - containerRect.left + scrollLeft;
          const itemY = itemRect.top - containerRect.top + scrollTop;
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
      selectionBoxRef.current = null;
      paintedSelectionBoxRef.current = null;
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
  // Also do NOT clear when pick mode is active — pick mode owns the selection lifecycle.
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (pickModeRef.current) return; // pick mode manages its own selection — never clear on click-outside
      if (photoSelectModeRef.current) return; // photo pick mode: user is building a selection — never clear on click-outside
      const t = e.target as HTMLElement;
      const isSafeTarget = t.closest(
        '.single-item-card, .product-group-card, .group-header, .toolbar, button, [role="button"],' +
        '.category-zone, .category-zones-container, .category-zones, .category-list,' +
        '.grouper-actions-sidebar, .grouper-toolbar, .photo-toolbar'
        // .grouper-toolbar (which wraps .photo-toolbar) is a wide strip directly above
        // the grid, so a mis-tap anywhere on it — a divider, the padding between two
        // control clusters — must not silently wipe the selection. It replaced
        // .grouper-header when the sidebar became this toolbar (Sept 2026).
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
      if (e.repeat) return; // ignore key-repeat: holding ⌘Z must not chain-undo multiple steps
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

  // ⌘1–9 / ⌘0 — set Photos/item count (0 = 10)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.shiftKey || e.altKey) return;
      if (e.repeat) return;
      const active = document.activeElement;
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || (active as HTMLElement).isContentEditable)) return;
      const digit = e.key >= '1' && e.key <= '9' ? parseInt(e.key, 10)
                  : e.key === '0' ? 10 : null;
      if (digit === null) return;
      e.preventDefault();
      setAutoGroupN(String(digit));
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []); // stable — setAutoGroupN is stable

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
      log.grouper(`initializeItems fired: props.items=${items.length} existing=${existingIds.size} new=${newItems.length} batchId=${batchId}`);

      // If nothing is new, just sync categories/metadata that may have changed externally
      if (newItems.length === 0) {
        log.grouper('no new items — syncing metadata only');
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
        log.grouper(`FAST PATH: ${newItems.length} new items, toUpload=0`);
        const incoming = newItems
          .filter(item => !(item.preview?.startsWith('blob:') && !item.file))
          .map(item => ({ ...item, productGroup: item.productGroup || item.id }));
        log.grouper(`incoming after blob filter: ${incoming.length}`);
        if (incoming.length === 0) { log.grouper('FAST PATH: incoming=0, returning early'); return; }
        setGroupedItems(prev => {
          const existingIdSet = new Set(prev.map(i => i.id));
          const deduped = incoming.filter(i => !existingIdSet.has(i.id));
          log.grouper(`setGroupedItems: prev=${prev.length} deduped=${deduped.length}`);
          if (deduped.length === 0) return prev;
          const next = [...prev, ...deduped];
          // Update the ref synchronously inside the updater so the deferred onGrouped
          // call below reads the correct list. Without this, groupedItemsRef.current is
          // still the pre-update value (React hasn't re-rendered yet) when setTimeout fires.
          groupedItemsRef.current = next;
          return next;
        });
        setTimeout(() => { log.grouper('deferred onGrouped, groupedItemsRef.current.length=', groupedItemsRef.current.length); onGrouped(groupedItemsRef.current); }, 0);
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

      const publicUrl = publicImageUrl(data.path);

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
    if (isDebugEnabled()) log.grouper(`[PICK] updateSelection | size=${next.size} pickMode=${pickModeRef.current}`, new Error().stack?.split('\n').slice(1,4).join(' | '));
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

  /** True when this click is the tail of a double-click on the same target.
   *  Rules live in lib/selectionGesture.ts (report 30) so they are testable. */
  const isRepeatToggle = (targetId: string) =>
    isRepeatToggleAt(lastToggleTimeRef.current.get(targetId), Date.now());

  /**
   * Is the user mid-selection? Report 30: while this is true a double-click must
   * behave like a single click (one toggle) and must NOT open the lightbox.
   *
   * Reads refs, not state, because it runs from DOM handlers that may hold a
   * render-old closure — the same rule the rest of this file follows.
   */
  const selectionModeActive = () => isSelectionModeActive({
    selectedAtGestureStart: selectionAtGestureStartRef.current.size,
    pickMode: pickModeRef.current,
    photoSelectMode: photoSelectModeRef.current,
  });

  /** Record the pre-gesture selection, unless this mousedown is the second half
   *  of a double-click (in which case the first one already recorded it). */
  const noteGestureStart = (targetId: string) => {
    if (!isRepeatToggle(targetId)) {
      selectionAtGestureStartRef.current = new Set(selectedItemsRef.current);
    }
  };

  // Toggle a single (ungrouped) item, with Shift+click range and Ctrl/Cmd+click additive
  const toggleItemSelection = (itemId: string, e?: React.MouseEvent) => {
    // Guard: hardware double-clicks fire two mousedown events ~10–15ms apart.
    // If the same item was toggled within TOGGLE_REPEAT_MS, skip this call to
    // prevent the item bouncing back to its previous state.
    const now = Date.now();
    const lastTime = lastToggleTimeRef.current.get(itemId) ?? now;
    if (isRepeatToggle(itemId)) {
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
    selectionBoxRef.current = null;            // rect is ref-owned now (F3)
    paintedSelectionBoxRef.current = null;
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

    const grouped = items.filter(i => selected.has(i.id));
    // Leader convention (AGENTS.md §11): the group id is the FIRST member's item
    // id — not a fresh UUID. Fresh UUIDs broke Step 3's group navigation (every
    // item became its own listing) because nothing validated as the group leader.
    const groupId = grouped[0].id;
    if (isDebugEnabled()) {
      console.group(`%c[ImageGrouper] GROUP CREATED (${grouped.length} items → group ${groupId.slice(0,8)})`, 'color:#f59e0b;font-weight:bold');
      console.table(grouped.map(i => ({
        id:       i.id.slice(0,8),
        name:     i.originalName ?? '—',
        imageUrl: i.imageUrls?.[0] ? '✓ ' + i.imageUrls[0].split('/').pop()?.slice(0,40) : '✗',
        preview:  i.preview ? (i.preview.startsWith('blob:') ? '⚠ blob' : '✓') : '✗',
      })));
      console.groupEnd();
    }

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
    // Pick mode: signal that selection should advance once groupedItems flushes.
    if (pickModeRef.current) {
      pickCursorRef.current = 0;
      log.grouper(`[PICK] createGroupFromSelected — setting pendingPick`);
      updateSelection(new Set());
      pendingPickRef.current = true;
    } else {
      updateSelection(new Set());
    }
  };

  /* Escape closes an open pile. Registered only while one IS open, so it never
     competes with the lightbox / crop-tool Escape handlers when no pile is
     fanned out. `capture: false` + the early return means the lightbox (which
     mounts its own handler on the overlay) still wins while it is up. */
  useEffect(() => {
    if (!expandedGroupId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (lightboxSrc || cropModalRef.current.open) return;
      setExpandedGroupId(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [expandedGroupId, lightboxSrc]);

  /* Close the Filter / View popover on an outside mousedown or Escape — the same
     shape as the ⋯ group menu below, with Escape additionally returning focus to
     the trigger that opened the panel. A click INSIDE the panel is left alone so
     several filter chips can be toggled in one visit. */
  useEffect(() => {
    if (!openPanel) return;
    const closeOnDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('.gtb-panel-wrap')) setOpenPanel(null);
    };
    const closeOnKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const trigger = openPanel === 'filter' ? filterTriggerRef.current : viewTriggerRef.current;
      setOpenPanel(null);
      trigger?.focus();
    };
    document.addEventListener('mousedown', closeOnDown);
    document.addEventListener('keydown', closeOnKey);
    return () => {
      document.removeEventListener('mousedown', closeOnDown);
      document.removeEventListener('keydown', closeOnKey);
    };
  }, [openPanel]);

  // Close the ⋯ group menu when clicking anywhere outside it
  useEffect(() => {
    if (!openMenuGroupId) return;
    const close = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('.group-menu-wrap')) setOpenMenuGroupId(null);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [openMenuGroupId]);

  /**
   * Open / close one pile. ONE at a time: opening a pile closes whatever was
   * open, so the grid never degrades back into the wall of thumbnails this
   * replaced.
   *
   * The 200 ms repeat guard is the same one the selection surfaces use (report
   * 30, lib/selectionGesture): a hardware double-click emits two clicks, and
   * without the guard the pile would open and immediately close again before
   * the `dblclick` handler ran. Keyed `pile:<id>` rather than `<id>` so it
   * cannot eat a select-bar toggle on the same group, or vice versa.
   */
  const togglePile = (groupId: string) => {
    const key = `pile:${groupId}`;
    if (isRepeatToggle(key)) return;
    lastToggleTimeRef.current.set(key, Date.now());
    setExpandedGroupId(prev => (prev === groupId ? null : groupId));
  };

  /** ↩ on a photo in an open pile: it leaves the group and becomes its own
   *  item. Same operation as dropping it on the "individual items" zone. */
  const removeFromGroup = (itemId: string) => {
    log.grouper(`removeFromGroup | item=${itemId}`);
    commitUpdate(groupedItemsRef.current.map(i => (i.id === itemId ? { ...i, productGroup: i.id } : i)));
  };

  // Ungroup ONE group (⋯ menu action) — same semantics as selecting the group
  // and clicking "Ungroup Selected": members become singles, category cleared.
  const ungroupGroup = (groupId: string) => {
    log.grouper(`ungroupGroup | groupId=${groupId}`);
    const memberIds = new Set(
      groupedItemsRef.current
        .filter(i => (i.productGroup || i.id) === groupId)
        .map(i => i.id)
    );
    const updated = groupedItemsRef.current.map(item =>
      memberIds.has(item.id)
        ? { ...item, productGroup: item.id, category: undefined }
        : item
    );
    try {
      commitUpdate(updated);
    } catch (err) {
      console.error('[ungroupGroup] commitUpdate threw:', err);
    }
    updateSelection(new Set([...selectedItemsRef.current].filter(id => !memberIds.has(id))));
  };

  // Delete ONE group's images entirely (⋯ menu action; was the header × button)
  const deleteGroup = async (items: ClothingItem[]) => {
    if (!confirm(`Delete all ${items.length} images in this group? This cannot be undone.`)) return;
    const storagePaths = items.map(i => i.storagePath).filter(Boolean) as string[];
    const deletedIds = items.map(i => i.id);
    await Promise.all(storagePaths.map(p => deleteImageFromStorage(p)));
    if (storagePaths.length > 0) await supabase.from('product_images').delete().in('storage_path', storagePaths);
    if (deletedIds.length > 0) await supabase.from('products').delete().in('id', deletedIds);
    const updated = groupedItemsRef.current.filter(i => !deletedIds.includes(i.id));
    commitUpdate(updated, true); // delete is permanent — skip history
    updateSelection(new Set([...selectedItemsRef.current].filter(id => !deletedIds.includes(id))));
    onImageDeleted?.();
  };

  // Rotate every selected photo by ±90° (sidebar Photo tools — replaces the
  // old per-photo ⟲/⟳ hover buttons; works on singles AND group photos).
  const rotateSelected = (delta: 90 | -90) => {
    const ids = selectedItemsRef.current;
    if (ids.size === 0) return;
    log.grouper(`rotateSelected | delta=${delta} count=${ids.size}`);
    const updated = groupedItemsRef.current.map(i =>
      ids.has(i.id) ? { ...i, imageRotation: ((i.imageRotation || 0) + delta) % 360 } : i
    );
    setGroupedItems(updated);
    onGrouped(updated);
  };

  // Toggle one photo's selection (pick mode — used by photos inside group cards)
  const togglePhotoPick = (itemId: string) => {
    // Same double-click guard the singles grid has had since 7c4806f: without it
    // a double-click inside a group card fired TWO click events, toggled twice and
    // left the photo back where it started — the "half-toggled" half of report 30.
    if (isRepeatToggle(itemId)) {
      log.grouper(`togglePhotoPick | debounced item=${itemId}`);
      return;
    }
    lastToggleTimeRef.current.set(itemId, Date.now());
    const next = new Set(selectedItemsRef.current);
    if (next.has(itemId)) next.delete(itemId); else next.add(itemId);
    updateSelection(next);
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
    if (n < 1 || n > 50) return;

    // Sort ALL items: named files by filename (natural order), unnamed files by capturedAt, then id.
    // Named files always come before unnamed so camera-roll photos group correctly.
    const sorted = [...groupedItems].sort((a, b) => {
      const aHasName = !!a.originalName;
      const bHasName = !!b.originalName;
      if (aHasName && bHasName) return naturalCompare(nameKey(a), nameKey(b));
      if (aHasName) return -1;
      if (bHasName) return 1;
      return (a.capturedAt ?? 0) - (b.capturedAt ?? 0);
    });

    log.grouper(`applyAutoGrouping | n=${n} total=${sorted.length} chunks=${Math.ceil(sorted.length / n)}`);

    // Group id per chunk = the FIRST item of the chunk's id (leader convention,
    // AGENTS.md §11). Fresh UUIDs here broke Step 3's per-group navigation.
    const numChunks = Math.ceil(sorted.length / n);
    const chunkIds = Array.from({ length: numChunks }, (_, c) => sorted[c * n].id);

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
      // Built at runtime, so no stylesheet can reach it — tokens are referenced
      // inline. var() resolves fine here: the ghost is appended to <body>.
      ghost.style.cssText = 'position:fixed;top:-999px;left:-999px;background:var(--accent);color:var(--ink-950);padding:6px 12px;border-radius:20px;font:600 13px/1 sans-serif;pointer-events:none;';
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
  // (Single-photo handleDeleteImage removed with the per-photo × button —
  //  deletion now goes through handleDeleteSelected in the Photo tools cluster.)

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

  // Pick-mode helper — updated every render so autoGroupN + sortOrder are always current
  advancePickSelectionRef.current = (currentItems: ClothingItem[]) => {
    const n = Math.max(1, parseInt(autoGroupN, 10) || 1);
    log.grouper(`[PICK] advancePickSelection called | totalItems=${currentItems.length} n=${n} sortOrder=${sortOrder}`);
    // Sort using the same order the grid is currently displaying
    const sorted = [...currentItems].sort((a, b) => {
      switch (sortOrder) {
        case 'date-asc':  return (a.capturedAt ?? 0) - (b.capturedAt ?? 0);
        case 'date-desc': return (b.capturedAt ?? 0) - (a.capturedAt ?? 0);
        case 'name-desc': return naturalCompare(nameKey(b), nameKey(a));
        default:          return naturalCompare(nameKey(a), nameKey(b));
      }
    });
    // Pick pool = any SINGLETON (item whose productGroup is unique to itself).
    // We intentionally do NOT exclude categorized items: a very common workflow is to
    // group everything, ungroup to crop (categories are kept), then re-group — in which
    // case every item is a *categorized singleton* and must still be pickable. Excluding
    // categorized items here made pick mode select nothing and silently turn off.
    const groupFreq = new Map<string, number>();
    currentItems.forEach(i => {
      const gid = i.productGroup || i.id;
      groupFreq.set(gid, (groupFreq.get(gid) || 0) + 1);
    });
    const ungrouped = sorted.filter(i =>
      (groupFreq.get(i.productGroup || i.id) ?? 0) === 1
    );
    const cursor = pickCursorRef.current;
    const slice = ungrouped.slice(cursor, cursor + n);
    if (isDebugEnabled()) log.grouper(`[PICK] ungrouped=${ungrouped.length} cursor=${cursor} slice=${slice.length} ids=${slice.map(i=>i.id.slice(0,6)).join(',')}`);
    if (slice.length === 0) {
      // No more ungrouped items — turn off pick mode
      log.grouper('[PICK] no more ungrouped items — turning off pick mode');
      setPickMode(false);
      pickModeRef.current = false;
      pickCursorRef.current = 0;
      updateSelection(new Set());
      return;
    }
    updateSelection(new Set(slice.map(i => i.id)));
    pickCursorRef.current = cursor + slice.length;
    log.grouper(`[PICK] selection updated | new cursor=${pickCursorRef.current}`);
  };

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

    // Sort items WITHIN a group by filename first so the representative (index 0) is
    // always the first-shot image, regardless of workflow_state insertion order.
    const sortGroupItems = (its: ClothingItem[]): ClothingItem[] =>
      [...its].sort((a, b) => {
        // Named files first, sorted naturally; fallback to capturedAt, then id
        const aHasName = !!a.originalName;
        const bHasName = !!b.originalName;
        if (aHasName && bHasName) return naturalCompare(nameKey(a), nameKey(b));
        if (aHasName) return -1;
        if (bHasName) return 1;
        return (a.capturedAt ?? 0) - (b.capturedAt ?? 0);
      });

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
      // Sort items within every group first so representative is always consistent
      const withSorted: [string, ClothingItem[]][] = es.map(([gid, its]) => [gid, sortGroupItems(its)]);
      const copy = [...withSorted];
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
      if (item.capturedAt) dateSet.add(localDateKey(item.capturedAt));
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
  const itemPassesFilters = (item: ClothingItem): boolean => {
    if (filters.date && !(item.capturedAt && localDateKey(item.capturedAt) === filters.date)) return false;
    if (filters.category === 'uncategorized' && item.category) return false;
    if (filters.category && filters.category !== 'uncategorized' && item.category !== filters.category) return false;
    return true;
  };

  const { filteredSingleItems, filteredMultiItemGroups } = useMemo(() => ({
    filteredSingleItems:    filters.view === 'groups'   ? [] : singleItems.filter(item => itemPassesFilters(item)),
    filteredMultiItemGroups: filters.view === 'singles' ? [] : multiItemGroups.filter(([, its]) => its.some(i => itemPassesFilters(i))),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [singleItems, multiItemGroups, filters]);

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

  // ── Action bundle handed to the parent toolbar (perf finding F38) ──────────
  // This used to build a FRESH object literal on every `selectedItems` change and
  // push it into App state, so every selection click cost TWO full App render
  // passes: one for setSelectedItems/onSelectionChange, then a second for
  // setGrouperActions. The bundle's identity now changes only when `selectedCount`
  // actually changes — the one field the parent renders — so a selection change
  // that keeps the count (swapping which card is selected) makes
  // `setGrouperActions` a no-op that React bails out of.
  //
  // Every method delegates through a ref that is refreshed on EVERY render, so a
  // memoized bundle can never call a stale closure (the failure mode that produced
  // the stale-closure saga in AGENTS.md §15 — `aae35fc`, `993c0cf`, `b0a41a6`).
  const actionImplRef = useRef({
    createGroupFromSelected, ungroupSelected, ungroupAll, updateSelection, handleDeleteSelected,
  });
  actionImplRef.current = {
    createGroupFromSelected, ungroupSelected, ungroupAll, updateSelection, handleDeleteSelected,
  };

  const selectedCount = selectedItems.size;
  const grouperActionBundle = useMemo<GrouperActions>(() => ({
    groupSelected:   () => actionImplRef.current.createGroupFromSelected(),
    ungroupSelected: () => actionImplRef.current.ungroupSelected(),
    ungroupAll:      () => actionImplRef.current.ungroupAll(),
    clearSelection:  () => actionImplRef.current.updateSelection(new Set()),
    deleteSelected:  () => actionImplRef.current.handleDeleteSelected(),
    selectedCount,
    onCategoryAssigned: () => {
      log.grouper(`onCategoryAssigned called | pickMode=${pickModeRef.current}`);
      if (!pickModeRef.current) { actionImplRef.current.updateSelection(new Set()); return; }
      // Category applied — signal advance; useEffect([groupedItems, pendingPick])
      // will fire once initializeItems has synced the category into groupedItems.
      pickCursorRef.current = 0;
      actionImplRef.current.updateSelection(new Set());
      pendingPickRef.current = true;
    },
  }), [selectedCount]);

  useEffect(() => {
    onActionsReady?.(grouperActionBundle);
  }, [grouperActionBundle, onActionsReady]);

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
          zIndex: 99999, background: 'var(--ink-800)',
          border: '1.5px solid var(--accent-line)', borderRadius: 14,
          padding: '14px 22px 12px', minWidth: 320, maxWidth: 420,
          boxShadow: '0 8px 32px var(--accent-glow)',
          display: 'flex', flexDirection: 'column', gap: 8, fontFamily: 'inherit',
        }}>
          <div style={{ color: 'var(--text-primary)', fontSize: 'var(--fs-sm)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 7 }}>
            {cropPasteProgress.status === 'running' ? (
              <span style={{
                display: 'inline-block', width: 13, height: 13,
                border: '2px solid var(--accent-line)', borderTopColor: 'var(--accent)',
                borderRadius: '50%', animation: 'spin 0.7s linear infinite', flexShrink: 0,
              }} />
            ) : (
              <span style={{ color: 'var(--success)', display: 'inline-flex' }}><Check size={13} /></span>
            )}
            {cropPasteProgress.status === 'running'
              ? `Applying crop to ${cropPasteProgress.total} image${cropPasteProgress.total > 1 ? 's' : ''}…`
              : cropPasteProgress.failed.length > 0
                ? `Done — ${cropPasteProgress.failed.length} failed`
                : 'Crop applied successfully!'}
          </div>
          <div style={{ color: 'var(--text-secondary)', fontSize: 'var(--fs-xs)', marginTop: 1 }}>
            {cropPasteProgress.status === 'running'
              ? `${cropPasteProgress.done} / ${cropPasteProgress.total} complete (${Math.round((cropPasteProgress.done / cropPasteProgress.total) * 100)}%)`
              : cropPasteProgress.failed.length > 0
                ? `${cropPasteProgress.total - cropPasteProgress.failed.length} succeeded, ${cropPasteProgress.failed.length} failed`
                : `All ${cropPasteProgress.total} image${cropPasteProgress.total > 1 ? 's' : ''} processed.`}
          </div>
          <div style={{ background: 'var(--accent-dim)', borderRadius: 8, height: 10, width: '100%', overflow: 'hidden', marginTop: 2 }}>
            <div style={{
              height: '100%',
              background: 'linear-gradient(90deg,var(--accent-press) 0%,var(--accent) 100%)',
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
                  await runCropBatchPaste(ids, copiedCrop!, copiedRotation, copiedCropAspect);
                }}
                style={{ flex: 1, background: 'var(--warning)', color: 'var(--ink-950)', border: 'none', borderRadius: 8, padding: '0.4rem 0.7rem', cursor: 'pointer', fontWeight: 600, fontSize: 'var(--fs-xs)' }}
              >
                <RotateCcw size={12} style={{ flexShrink: 0 }} /> Retry {cropPasteProgress.failed.length} failed
              </button>
              <button
                onClick={() => setCropPasteProgress(null)}
                style={{ background: 'none', border: '1px solid var(--accent-line)', color: 'var(--accent)', borderRadius: 8, padding: '0.4rem 0.7rem', cursor: 'pointer', fontSize: 'var(--fs-xs)' }}
              >
                Dismiss
              </button>
            </div>
          )}
        </div>
      )}
      
      {/* ── Individual crop upload indicator ── */}
      {cropUploadInProgress && !cropPasteProgress && (
        <div style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          zIndex: 99999, background: 'var(--ink-800)',
          border: '1.5px solid var(--accent-line)', borderRadius: 14,
          padding: '12px 22px', minWidth: 260,
          boxShadow: '0 8px 32px var(--accent-glow)',
          display: 'flex', alignItems: 'center', gap: 10, fontFamily: 'inherit',
        }}>
          <span style={{
            display: 'inline-block', width: 14, height: 14,
            border: '2px solid var(--accent-line)', borderTopColor: 'var(--accent)',
            borderRadius: '50%', animation: 'spin 0.7s linear infinite', flexShrink: 0,
          }} />
          <span style={{ color: 'var(--text-primary)', fontSize: 'var(--fs-sm)', fontWeight: 600 }}>
            Uploading cropped image…
          </span>
        </div>
      )}

      <div className="image-grouper-container">
      <div className="grouper-scroll-content" ref={scrollContentRef}>

      {/* ══ ONE sticky toolbar block ═══════════════════════════════════════════
          Sept 2026, condensed: the IDLE row is one line at ≥1024px. Filter ▾ and
          View ▾ are popover triggers holding the ~14 controls that used to sit
          out in the open (four sort buttons, the two view toggles, the date
          select, one chip per category, the columns slider, the clear-originals
          action). Only what is touched on every pass stays visible: Photos/item
          + Apply + Pick, Pick photos, and the trailing selection/undo cluster.

          The photo-tools row below is CONTEXTUAL — it is not rendered at all
          unless something is selected or a rotation/crop is copied, which is
          what buys the single idle line. It keeps the class name `photo-toolbar`
          because the handlers and the click-outside safe list read it.

          The block sticks to the top of THIS scroll box, which is a position the
          black app nav can never cover (the reason the old phone toolbar could
          not be sticky). ≤640px the row scrolls sideways with scroll-snap
          instead of stacking into a wall of rows.

          THE PANELS ARE RENDERED INSIDE .grouper-toolbar, NEVER PORTALED:
          that selector is on the click-outside-deselect safe list, so a portaled
          panel would wipe the user's selection on every click inside it. ── */}
      <div className="grouper-toolbar">
      <div className={`gtb-row gtb-row--controls${openPanel ? ' gtb-row--panel-open' : ''}`}>

        {/* ── Filter ▾ — show / date / category, all combinable, all toggles ── */}
        <div className="gtb-panel-wrap">
          <button
            type="button"
            ref={filterTriggerRef}
            className={`sort-btn gtb-trigger${openPanel === 'filter' ? ' active' : ''}`}
            aria-haspopup="true"
            aria-expanded={openPanel === 'filter'}
            aria-controls="gtb-panel-filter"
            onClick={() => setOpenPanel(p => (p === 'filter' ? null : 'filter'))}
            title="Filter which photos are shown"
          >
            <Filter size={13} /> Filter
            {activeFilterCount > 0 && <span className="gtb-count">{activeFilterCount}</span>}
          </button>

          {openPanel === 'filter' && (
            <div className="gtb-panel" id="gtb-panel-filter" role="group" aria-label="Filter photos">
              <div className="gtb-panel-section">
                <span className="gtb-label">Show</span>
                <div className="gtb-panel-chips">
                  <button
                    type="button"
                    className={`sort-btn${filters.view === 'groups' ? ' active' : ''}`}
                    onClick={() => setFilter('view', filters.view === 'groups' ? 'all' : 'groups')}
                    title="Show only multi-image groups"
                  >
                    Groups
                  </button>
                  <button
                    type="button"
                    className={`sort-btn${filters.view === 'singles' ? ' active' : ''}`}
                    onClick={() => setFilter('view', filters.view === 'singles' ? 'all' : 'singles')}
                    title="Show only single items"
                  >
                    Singles
                  </button>
                </div>
              </div>

              {uniqueFilterDates.length > 0 && (
                <div className="gtb-panel-section">
                  <span className="gtb-label">Date</span>
                  <select
                    className="filter-select gtb-panel-select"
                    value={filters.date}
                    onChange={e => setFilter('date', e.target.value)}
                    title="Filter by capture date"
                  >
                    <option value="">All dates</option>
                    {uniqueFilterDates.map(d => (
                      <option key={d} value={d}>
                        {FILTER_DATE_FMT.format(new Date(d + 'T00:00:00'))}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {(uniqueFilterCategories.length > 0 || groupedItems.some(i => !i.category)) && (
                <div className="gtb-panel-section">
                  <span className="gtb-label">Category</span>
                  <div className="gtb-panel-chips">
                    {groupedItems.some(i => !i.category) && (
                      <button
                        type="button"
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
                        type="button"
                        className={`sort-btn${filters.category === c ? ' active' : ''}`}
                        onClick={() => setFilter('category', filters.category === c ? '' : c)}
                        title={`Filter by category: ${c}`}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {activeFilterCount > 0 && (
                <div className="gtb-panel-foot">
                  <button
                    type="button"
                    className="sort-btn filter-clear-btn"
                    onClick={() => setFilters({ date: '', view: 'all', category: '' })}
                    title="Clear all filters"
                  >
                    <X size={11} /> Clear filters
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── View ▾ — sort order, grid density, cached-originals storage ── */}
        <div className="gtb-panel-wrap">
          <button
            type="button"
            ref={viewTriggerRef}
            className={`sort-btn gtb-trigger${openPanel === 'view' ? ' active' : ''}`}
            aria-haspopup="true"
            aria-expanded={openPanel === 'view'}
            aria-controls="gtb-panel-view"
            onClick={() => setOpenPanel(p => (p === 'view' ? null : 'view'))}
            title="Sort order and grid density"
          >
            <SlidersHorizontal size={13} /> View
          </button>

          {openPanel === 'view' && (
            <div className="gtb-panel" id="gtb-panel-view" role="group" aria-label="View options">
              <div className="gtb-panel-section">
                <span className="gtb-label"><ArrowUpDown size={12} /> Sort</span>
                <div className="gtb-panel-opts">
                  {SORT_OPTIONS.map(o => (
                    <button
                      key={o.value}
                      type="button"
                      className={`gtb-opt${sortOrder === o.value ? ' active' : ''}`}
                      onClick={() => setSortOrder(o.value)}
                      title={o.title}
                    >
                      <span className="gtb-opt-mark">{sortOrder === o.value ? <Check size={13} /> : null}</span>
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="gtb-panel-section">
                <span className="gtb-label"><Columns3 size={12} /> Columns {singlesGridColumns}</span>
                <input
                  type="range"
                  min={columnSliderBounds.min}
                  max={columnSliderBounds.max}
                  value={Math.min(Math.max(columnsPerRow, columnSliderBounds.min), columnSliderBounds.max)}
                  onChange={e => setColumnsPerRow(Number(e.target.value))}
                  className="columns-slider"
                  title="Drag to change columns per row"
                />
              </div>

              {/* Cached originals — the clear-ALL variant. The selected-only
                  variant lives in the contextual row, where a selection exists. */}
              {selectedItems.size === 0 && groupedItems.some(i => i.originalStoragePath) && (
                <div className="gtb-panel-foot">
                  <span className="gtb-label">Storage</span>
                  <button
                    type="button"
                    className="ptb-btn ptb-btn--ghost"
                    title="Free up storage by permanently deleting cached original images. Revert will no longer be possible."
                    onClick={() => clearOriginalsCache('all')}
                  >
                    Clear {groupedItems.filter(i => i.originalStoragePath).length} originals
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        <span className="gtb-divider" />

        {/* Auto-group by N + pick mode */}
        <div className="gtb-group auto-group-control" title="Auto-group images by sequential filename order. Set how many photos you took per item, then click Apply.">
          <span className="gtb-label"><Camera size={13} /> Photos/item</span>
          <input
            type="number"
            min={1}
            max={50}
            value={autoGroupN}
            onChange={e => setAutoGroupN(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                const n = parseInt(autoGroupN, 10);
                if (!isNaN(n) && n >= 1 && n <= 50) applyAutoGrouping(n);
              }
            }}
            className="auto-group-input"
            title="Number of photos per product"
          />
          <button
            type="button"
            className="sort-btn auto-group-btn"
            onClick={() => {
              const n = parseInt(autoGroupN, 10);
              if (isNaN(n) || n < 1 || n > 50) {
                alert('Enter a number between 1 and 50');
                return;
              }
              if (!confirm(`Auto-group all ${groupedItems.length} images into sets of ${n}?\n\nThis will replace all current grouping. You can undo with ⌘Z.`)) return;
              applyAutoGrouping(n);
            }}
            title={`Group all images into sets of ${autoGroupN} by filename order`}
          >
            Apply
          </button>
          <button
            type="button"
            className={`sort-btn pick-mode-btn${pickMode ? ' pick-mode-active' : ''}`}
            onClick={() => {
              const next = !pickMode;
              log.grouper(`[PICK] toggle | ${pickMode ? 'ON→OFF' : 'OFF→ON'} n=${autoGroupN}`);
              setPickMode(next);
              pickModeRef.current = next;
              if (next) {
                // Turning on: start from beginning of ungrouped list
                pickCursorRef.current = 0;
                advancePickSelectionRef.current(groupedItemsRef.current);
              } else {
                // Turning off: clear selection and reset cursor
                pickCursorRef.current = 0;
                updateSelection(new Set());
              }
            }}
            title={pickMode
              ? `Pick mode ON — selecting ${autoGroupN} at a time. Click to turn off.`
              : `Pick mode: auto-select next ${autoGroupN} ungrouped images for manual grouping`}
          >
            {pickMode ? <><CircleDot size={12} /> Pick</> : <><Circle size={12} /> Pick</>}
          </button>
        </div>

        <span className="gtb-divider" />

        {/* Pick photos — the gate for the contextual photo-tools row below */}
        <button
          className={`ptb-btn photo-pick-toggle${photoSelectMode ? ' photo-pick-toggle--on' : ''}`}
          title={photoSelectMode
            ? 'Pick mode ON — click photos (even inside groups) to select them, then use the tools here. Click to turn off.'
            : 'Turn on to click-select photos (even inside groups), then rotate/crop/revert/delete them from this toolbar'}
          onClick={(e) => {
            e.stopPropagation();
            const next = !photoSelectMode;
            setPhotoSelectMode(next);
            photoSelectModeRef.current = next;
            if (!next) updateSelection(new Set());
          }}
        >
          {photoSelectMode ? <><Crosshair size={12} /> Picking… (stop)</> : <><Crosshair size={12} /> Pick photos</>}
        </button>

        {/* Selection readout + Undo/Redo — the only chips left from the old stats
            block (the groups/singles/listings/photos counts were removed Sept 2026;
            the section headings already carry them). Pinned to the END of the row
            so appearing and disappearing never shifts the controls before it. */}
        {(selectedItems.size > 0 || canUndo || canRedo) && (
          <div className="stats stats--trailing">
            {selectedItems.size > 0 && (
              <span className="stat--selected" title="Photos currently selected">
                <Check size={14} /> {selectedItems.size} <em>selected</em>
              </span>
            )}
            {canUndo && (
              <button type="button" className="sort-btn" onClick={handleUndo} title="Undo last grouping action (⌘Z)">
                <CornerUpLeft size={12} /> Undo
              </button>
            )}
            {canRedo && (
              <button type="button" className="sort-btn" onClick={handleRedo} title="Redo last undone action (⌘Shift+Z)">
                <CornerUpRight size={12} /> Redo
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── Contextual row: photo tools. Rendered ONLY while there is something
            to act on — a selection, or a copied rotation/crop waiting for
            targets. With nothing selected and nothing copied the row does not
            exist, so the idle toolbar is a single line. ── */}
      {(selectedItems.size > 0 || copiedRotation !== null || copiedCrop !== undefined) && (
      <div className="gtb-row photo-toolbar">
        <button
          className="ptb-btn"
          disabled={selectedItems.size === 0}
          title={selectedItems.size > 0 ? `Rotate ${selectedItems.size} selected left` : 'Select photos first'}
          onClick={(e) => { e.stopPropagation(); rotateSelected(-90); }}
        >
          ⟲ Rotate{selectedItems.size > 0 ? ` ${selectedItems.size}` : ''}
        </button>
        <button
          className="ptb-btn"
          disabled={selectedItems.size === 0}
          title={selectedItems.size > 0 ? `Rotate ${selectedItems.size} selected right` : 'Select photos first'}
          onClick={(e) => { e.stopPropagation(); rotateSelected(90); }}
        >
          ⟳ Rotate{selectedItems.size > 0 ? ` ${selectedItems.size}` : ''}
        </button>

        <span className="ptb-divider" />

        <button
          className={`ptb-btn${copiedRotation !== null ? ' ptb-btn--active' : ''}`}
          title="Select one image first, then click to copy its rotation"
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
          className={`ptb-btn${copiedCrop !== undefined ? ' ptb-btn--active' : ''}`}
          title="Select one image first, then click to copy its crop"
          onClick={(e) => {
            e.stopPropagation();
            const firstId = [...selectedItems][0];
            const source = firstId ? groupedItems.find(i => i.id === firstId) : null;
            if (!source) { alert('Select an image first to copy its crop.'); return; }
            captureCopiedCrop(source, source.crop);
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

        {(copiedRotation !== null || copiedCrop !== undefined) && (
          <>
            <span className="ptb-status">
              {copiedRotation !== null && copiedCrop !== undefined
                ? 'Rot + crop copied'
                : copiedRotation !== null
                ? 'Rotation copied'
                : 'Crop copied'}
              {' · '}
              <button className="ptb-link" onClick={() => { setCopiedRotation(null); setCopiedCrop(undefined); setCopiedCropAspect(null); }}>
                clear
              </button>
              {selectedItems.size === 0 && <em> — now select target photos</em>}
            </span>
            {selectedItems.size > 0 && (
              <button
                className="ptb-btn ptb-btn--primary"
                title="Paste to all selected images"
                onClick={async (e) => {
                  e.stopPropagation();
                  const targetIds = [...selectedItems];
                  log.grouper('[paste] Paste-to-selected clicked — selectedItems:', targetIds.length, 'copiedCrop:', copiedCrop, 'copiedRotation:', copiedRotation);
                  setSelectedItems(new Set());
                  if (copiedCrop !== undefined && copiedCrop !== null) {
                    await runCropBatchPaste(targetIds, copiedCrop, copiedRotation, copiedCropAspect);
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
                <ClipboardPaste size={12} style={{ flexShrink: 0 }} /> Paste to {selectedItems.size}
              </button>
            )}
          </>
        )}

        {selectedItems.size > 0 && groupedItems.some(i => selectedItems.has(i.id) && i.originalStoragePath) && (
          <button
            className="ptb-btn ptb-btn--warn"
            title="Revert selected cropped images back to their original un-cropped versions"
            onClick={() => revertToOriginalBatch([...selectedItems])}
          >
            <RotateCcw size={12} style={{ flexShrink: 0 }} /> Revert {groupedItems.filter(i => selectedItems.has(i.id) && i.originalStoragePath).length}
          </button>
        )}

        {selectedItems.size > 0 && (
          <button
            className="ptb-btn ptb-btn--danger"
            title={`Delete ${selectedItems.size} selected image${selectedItems.size > 1 ? 's' : ''}`}
            onClick={handleDeleteSelected}
          >
            <Trash2 size={12} style={{ flexShrink: 0 }} /> Delete {selectedItems.size}
          </button>
        )}

        {selectedItems.size > 0 && groupedItems.some(i => selectedItems.has(i.id) && i.originalStoragePath) && (
          <button
            className="ptb-btn ptb-btn--ghost"
            style={{ marginLeft: 'auto' }}
            title="Free up storage by permanently deleting cached original images. Revert will no longer be possible."
            onClick={() => clearOriginalsCache('selected')}
          >
            Clear {groupedItems.filter(i => selectedItems.has(i.id) && i.originalStoragePath).length} selected originals
          </button>
        )}
      </div>
      )}
      </div>{/* /grouper-toolbar */}

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
            style={{ gridTemplateColumns: `repeat(${singlesGridColumns}, minmax(0, 1fr))` }}
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
                      // Report 30: record the selection BEFORE this gesture toggles
                      // anything, so the double-click handler can tell "the user was
                      // already selecting" from "this click is what selected it".
                      noteGestureStart(item.id);
                      toggleItemSelection(item.id, e);
                    }
                  }}
                  onClick={(e) => e.stopPropagation()}
                  onDoubleClick={(e) => openLightboxFromDoubleClick((e.currentTarget as HTMLElement).dataset.itemId!)}
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
                      {/* Per-photo rotate/revert hover buttons removed — all photo
                          actions live in the sidebar Photo tools cluster now. */}
                    </div>
                  ) : (
                    <div className="lazy-skeleton lazy-skeleton--error" aria-hidden="true" />
                  )}
                  {selectedItems.has(item.id) && (
                    <div className="selection-indicator"><Check size={20} /></div>
                  )}
                  {/* Per-photo × delete removed — select photos and use the sidebar
                      "Delete N selected" button instead. */}
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
                      {item.capturedAt ? captureLabel(item.capturedAt) : null}
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
            style={{ gridTemplateColumns: `repeat(${groupsGridColumns}, minmax(0, 1fr))` }}
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
                  const t = e.target as HTMLElement;
                  // Selection target = the select bar + card padding ONLY. Photos are
                  // for drag-reorder / double-click lightbox, and buttons/menu do their
                  // own thing — clicking those must never toggle the group selection.
                  if (t.closest('button') || t.closest('.group-images') || t.closest('.group-stack') || t.closest('.group-menu-wrap')) return;
                  // Report 30: a double-click on the select bar used to fire two
                  // mousedowns and toggle the whole group twice — i.e. do nothing,
                  // visibly. One gesture, one toggle, keyed on the group id.
                  if (isRepeatToggle(groupId)) return;
                  lastToggleTimeRef.current.set(groupId, Date.now());
                  noteGestureStart(groupId);
                  toggleGroupSelection(groupId, items);
                }}
                onClick={(e) => e.stopPropagation()}
              >
                {items[0].category && (
                  <div className="category-indicator" style={{ display: 'none' }}>
                    <Check size={14} className="category-check" />
                    <span className="category-label">{items[0].category}</span>
                  </div>
                )}
                {/* Select bar — the whole bar (except the ⋯ menu) toggles group selection.
                    Actions live in the ⋯ dropdown so the bar is one big, safe click target
                    and the destructive delete is never a stray top-right × anymore. */}
                <div
                  className={`group-header group-select-bar${items.every(i => selectedItems.has(i.id)) ? ' all-selected' : items.some(i => selectedItems.has(i.id)) ? ' some-selected' : ''}`}
                  style={{ cursor: 'pointer', userSelect: 'none' }}
                  title="Click to select/deselect this group"
                >
                  <span className="group-select-check" aria-hidden="true">
                    {items.every(i => selectedItems.has(i.id)) ? <Check size={13} /> : items.some(i => selectedItems.has(i.id)) ? '–' : ''}
                  </span>
                  <span className="group-badge" title={`${items.length} photos in this group`}>
                    <Layers size={11} /> {items.length}
                  </span>
                  {/* Collapsed, the category chip lives ON the pile (the select bar
                      is only ~90px wide at the default 8 columns and clipped it to
                      one letter). Open, the pile is gone and the bar has the room. */}
                  {items[0].category && expandedGroupId === groupId && (
                    <span className="category-badge">{items[0].category}</span>
                  )}
                  <div className="group-menu-wrap" onMouseDown={(e) => e.stopPropagation()}>
                    <button
                      className="group-menu-btn"
                      title="Group actions"
                      aria-haspopup="menu"
                      aria-expanded={openMenuGroupId === groupId}
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpenMenuGroupId(openMenuGroupId === groupId ? null : groupId);
                      }}
                    >
                      ⋯
                    </button>
                    {openMenuGroupId === groupId && (
                      <div className="group-menu" role="menu">
                        <button
                          className="group-menu-item"
                          role="menuitem"
                          disabled={!items.some(i => i.crop)}
                          title={items.some(i => i.crop) ? 'Copy crop from this group' : 'No crop set on any image in this group'}
                          onClick={(e) => {
                            e.stopPropagation();
                            const source = items.find(i => i.crop) ?? items[0];
                            captureCopiedCrop(source, source.crop);
                            setCopiedRotation(source.imageRotation ?? null);
                            setOpenMenuGroupId(null);
                          }}
                        >
                          Copy crop
                        </button>
                        <button
                          className="group-menu-item"
                          role="menuitem"
                          disabled={copiedCrop === undefined || copiedCrop === null}
                          title={copiedCrop != null ? 'Paste copied crop to all images in this group' : 'Copy a crop first'}
                          onClick={async (e) => {
                            e.stopPropagation();
                            if (copiedCrop == null) return;
                            setOpenMenuGroupId(null);
                            const ids = items.map(i => i.id);
                            await runCropBatchPaste(ids, copiedCrop, copiedRotation, copiedCropAspect);
                          }}
                        >
                          Paste crop
                        </button>
                        <button
                          className="group-menu-item"
                          role="menuitem"
                          title="Split this group back into individual images"
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpenMenuGroupId(null);
                            ungroupGroup(groupId);
                          }}
                        >
                          Ungroup
                        </button>
                        <button
                          className="group-menu-item group-menu-item--danger"
                          role="menuitem"
                          title="Delete this entire group"
                          onClick={async (e) => {
                            e.stopPropagation();
                            setOpenMenuGroupId(null);
                            await deleteGroup(items);
                          }}
                        >
                          Delete group…
                        </button>
                      </div>
                    )}
                  </div>
                </div>
                {expandedGroupId === groupId ? (
                  /* ── Expanded: the fan. Every photo, drag-to-reorder,
                       double-click lightbox, ↩ remove-from-group. ── */
                  <>
                <div className="group-images">
                  {items.map((item) => (
                    <div
                      key={item.id}
                      data-item-id={item.id}
                      className={`group-image-item ${dragOverPhotoId === item.id && draggedPhotoGroupId === groupId ? 'photo-drag-over' : ''} ${draggedPhotoId === item.id ? 'photo-dragging' : ''} ${photoSelectMode && selectedItems.has(item.id) ? 'photo-picked' : ''}`}
                      draggable={!photoSelectMode}
                      onDragStart={(e) => { e.stopPropagation(); handlePhotoDragStart(e, item, groupId); }}
                      onDragOver={(e) => handlePhotoDragOver(e, item.id, groupId)}
                      onDrop={(e) => handlePhotoDrop(e, item.id, groupId)}
                      onDragEnd={handlePhotoDragEnd}
                      onDragLeave={() => setDragOverPhotoId(null)}
                      onDoubleClick={(e) => { e.stopPropagation(); openLightboxFromDoubleClick((e.currentTarget as HTMLElement).dataset.itemId!); }}
                      onMouseDown={() => noteGestureStart(item.id)}
                      onClick={(e) => {
                        e.stopPropagation(); // don't bubble to group-level toggle
                        // Pick mode: clicking a photo inside a group selects it for
                        // the photo toolbar (rotate/crop/revert/delete).
                        if (photoSelectModeRef.current) togglePhotoPick(item.id);
                      }}
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
                        </>
                      ) : (
                        <div className="lazy-skeleton lazy-skeleton--error" aria-hidden="true" />
                      )}
                      <button
                        type="button"
                        className="remove-from-group-btn"
                        title="Take this photo out of the group (it becomes its own item)"
                        aria-label="Remove photo from group"
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => { e.stopPropagation(); removeFromGroup(item.id); }}
                      >
                        ↩
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  className="gs-collapse"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => { e.stopPropagation(); setExpandedGroupId(null); }}
                  title="Close this pile (Esc)"
                >
                  <ChevronsDownUp size={13} /> Collapse
                </button>
                  </>
                ) : (
                  /* ── Collapsed: the pile. Leader on top at full card size, the
                       rest peeking behind it; geometry from lib/stackLayout. ── */
                  <div
                    className="group-stack"
                    style={{
                      paddingRight: `${stackReserve(items.length, { compact: isPhone }).right}px`,
                      paddingBottom: `${stackReserve(items.length, { compact: isPhone }).bottom}px`,
                    }}
                    role="button"
                    tabIndex={0}
                    aria-expanded={false}
                    aria-label={`Pile of ${items.length} photos — open`}
                    title={`${items.length} photos — click to open this pile`}
                    onMouseDown={(e) => { e.stopPropagation(); noteGestureStart(items[0].id); }}
                    onClick={(e) => {
                      e.stopPropagation();
                      // Photo pick mode: a tap on the TOP photo picks it, exactly as
                      // it would in the fan. The peeking layers are inert — open the
                      // pile to reach them (the founder's rule for stacks).
                      if (photoSelectModeRef.current && (e.target as HTMLElement).closest('.gs-layer--top')) {
                        togglePhotoPick(items[0].id);
                        return;
                      }
                      togglePile(groupId);
                    }}
                    onDoubleClick={(e) => { e.stopPropagation(); openLightboxFromDoubleClick(items[0].id); }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        e.stopPropagation();
                        togglePile(groupId);
                      }
                    }}
                  >
                    {/* Only the TOP layer carries an <img>. The peeking layers are
                        blank card edges: they show a 7px sliver at most, so loading
                        a full thumbnail for each was 3 fetches + 3 decodes per pile
                        for pixels nobody can see. A closed pile costs one image;
                        the other members load when the pile is opened. Step 3 and
                        the export read the store, not this render, so they are
                        unaffected. */}
                    {stackLayers(items.length, { compact: isPhone }).map((layer) => {
                      const item = items[layer.index];
                      const isTop = layer.index === 0;
                      const url = isTop ? (item.thumbnailUrl || item.preview || item.imageUrls?.[0]) : undefined;
                      return (
                        <div
                          key={item.id}
                          data-item-id={item.id}
                          className={`gs-layer${isTop ? ' gs-layer--top' : ' gs-layer--back'}${isTop && photoSelectMode && selectedItems.has(item.id) ? ' photo-picked' : ''}`}
                          style={{
                            transform: `translate(${layer.x}px, ${layer.y}px) rotate(${layer.rotate}deg)`,
                            zIndex: layer.z,
                          }}
                          aria-hidden={isTop ? undefined : true}
                        >
                          {!isTop ? null : url ? (
                            <img
                              src={url}
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
                      );
                    })}
                    {items[0].category && (
                      <span className="category-badge gs-cat">{items[0].category}</span>
                    )}
                    {stackOverflowBadge(items.length) && (
                      <span className="gs-count" aria-hidden="true">{stackOverflowBadge(items.length)}</span>
                    )}
                    <span className="gs-hint" aria-hidden="true"><Layers size={12} /> Open</span>
                  </div>
                )}
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
              <button className="lightbox-close" onClick={(e) => { e.stopPropagation(); setLightboxSrc(null); }}><X size={16} /></button>
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
                }}><Scissors size={12} /> Crop</button>
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
                    onClick={(e) => { e.stopPropagation(); captureCopiedCrop(lbItem, lbItem.crop); }}>
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
                      // The apply now rethrows so batch pastes can count failures;
                      // the interactive path reports and still tears the modal down.
                      try {
                        await queueItemTransform(cropModal.itemId, () =>
                          applyAndPersistTransformGrouper(cropModal.itemId!, tempCrop));
                      } catch (err) {
                        console.error('[crop] apply failed:', err);
                        alert('Could not apply the crop — the image could not be loaded or uploaded. Please try again.');
                      }
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

/* Memoized (perf finding F2). Steps 1-4 all mount at once and App re-renders on
 * any store/UI change, so without this a Step-3 keystroke re-rendered this whole
 * subtree. Every prop App passes is now referentially stable (see the
 * `useEventCallback` block in App.tsx), so the default shallow compare bails out
 * on renders that have nothing to do with this component. */
export default memo(ImageGrouper);