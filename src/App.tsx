import React, { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo, Suspense, Component, type ReactNode } from 'react';
import { supabase } from './lib/supabase';
import type { User } from '@supabase/supabase-js';
import { Tag, Settings, Package, Boxes, Link2, Scissors, X, Trash2, BookMarked, KanbanSquare, AlertTriangle, Keyboard, Plus, Lightbulb, FolderOpen, FileArchive, MousePointerClick, Move, Save, BarChart3, Contact, Users, MessageSquare, Wallet, Printer, ScanLine, LayoutDashboard, ShieldCheck } from 'lucide-react';
import { log, isDebugEnabled } from './lib/debugLogger';
import BrandWordmark from './components/Wordmark';
import Auth from './components/Auth';
import ImageUpload, { type ImageUploadHandle } from './components/ImageUpload';
import ImageGrouper from './components/ImageGrouper';
import type { GrouperActions } from './components/ImageGrouper';
import CategoryZones from './components/CategoryZones';
import ProductDescriptionGenerator from './components/ProductDescriptionGenerator';
import GoogleSheetExporter from './components/GoogleSheetExporter';
import MarketplaceExport from './components/MarketplaceExport';
import type { GoogleSheetExporterHandle } from './components/GoogleSheetExporter';

import { saveBatchToDatabase } from './lib/productService';
import { publicImageUrl, thumbnailImageUrl } from './lib/storageUrls';
import { chunked } from './lib/chunk';
import { filterChangedForUpsert, rememberUpserted } from './lib/productUpsertDedupe';
import {
  productRowToClothingItem, mergeProductRowIntoItem,
  STARTUP_MERGE_OPTIONS, OPEN_BATCH_MERGE_OPTIONS, type ProductRowLite,
} from './lib/productRow';
import { autoSaveWorkflowBatchDetailed, autoSaveSucceeded, markBatchConfirmed, getWorkflowBatch, type WorkflowBatch } from './lib/workflowBatchService';
import { ensureOrganization, type Organization, type OrgRole } from './lib/orgService';
import { getOrgDescriptionSettings, type DescriptionSettings } from './lib/descriptionSettings';
import { writeOnboardingLocal } from './lib/onboarding';
import { slimForWorkflowState, ultraSlimForBackup, asClothingItems } from './lib/slimItems';
import { scheduleWorkflowBackup, flushWorkflowBackup, cancelWorkflowBackup, WORKFLOW_BACKUP_KEY } from './lib/workflowBackup';
import { readWorkflowBackup, resolveRestoreItems, workflowStateCapturedAt } from './lib/restoreSource';
import { saveStatus } from './lib/saveStatusStore';
import { buildProductImageRow, mergeProductImageRows, stage4ColumnsAvailable, type ExistingProductImageRow } from './lib/imageRowSync';
import { useStoreItemArray, liveArrayRef } from './lib/workflowStore';

// Live read-only views into workflowStore — replace the old ref-mirror pattern.
// .current always reads the CURRENT store state (assigned nowhere, stale never).
// Module-level so their identity is stable across renders.
const sortedImagesRef    = liveArrayRef('sortedImages');
const groupedImagesRef   = liveArrayRef('groupedImages');
const processedItemsRef  = liveArrayRef('processedItems');
const uploadedImagesRef  = liveArrayRef('uploadedImages');

/** exifr (~56 KB) is only reachable from the EXIF-rescan fallback, which runs for at
 *  most 30 items of an old batch that predates `capturedAt`. A static import put it in
 *  the main chunk for every visitor; this loads it the first time a rescan actually
 *  happens and reuses the module afterwards. (ImageUpload defers it the same way.) */
let exifrModulePromise: Promise<typeof import('exifr')> | null = null;
const loadExifr = () => (exifrModulePromise ??= import('exifr'));
import WorkspaceMenu, { type WorkspaceNavItem, type WorkspaceStorage } from './components/WorkspaceMenu';
import WaitlistGate from './components/WaitlistGate';
import Landing from './components/Landing';
import { getCategoryPresets } from './lib/categoryPresetsService';
import { track, trackPageview, setAnalyticsContext, clearAnalyticsContext } from './lib/analytics';
import { installErrorReporter, reportError, setErrorContext, clearErrorContext } from './lib/errorReporter';
import { purgeImageCache } from './lib/swCache';
import SupportWidget from './components/SupportWidget';
import ShortcutsPanel from './components/ShortcutsPanel';
import { supportStore, useSupportThreads } from './lib/supportStore';
import ToolView from './components/ToolView';
import { MobileTabBar } from './components/MobileNav';
import PhoneStepper, { PhoneStepNav } from './components/PhoneStepper';
import { clampStep, reachableSteps, resumeStep, type StepCounts, type WorkflowStep } from './lib/phoneSteps';
import { applyPresetDirectly } from './lib/applyPresetToGroup';
import type { BrandCategory } from './lib/brandCategorySystem';
import './App.css';

// First-party error tracking: window 'error' + 'unhandledrejection' → app_errors.
// Module scope so it is listening before the first render. No-op on localhost and
// until app_errors.sql has been run. Idempotent + typeof window-guarded, so
// StrictMode's double invoke is safe.
installErrorReporter();

/**
 * Stable-identity wrapper around a changing callback (React's "useEvent" pattern).
 *
 * The returned function NEVER changes identity, and always invokes the most recent
 * render's `fn`. That is the whole point: it is what lets `React.memo` bail out on
 * the big workflow children without any dependency-array archaeology, and — given
 * this codebase's history of stale-closure bugs (AGENTS.md §14 #14, §15's
 * `aae35fc`/`993c0cf`/`b0a41a6`) — it is strictly safer than `useCallback([...])`:
 * a `useCallback` with a wrong dep list silently freezes state, while this can only
 * ever call the newest closure. Semantics are identical to the inline arrow it
 * replaces; only the identity is now constant.
 *
 * Not for anything a child calls DURING ITS OWN RENDER — the ref is assigned in a
 * layout effect, so it is only guaranteed current after commit. Every use here is
 * an event/async handler.
 */
function useEventCallback<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const ref = useRef(fn);
  useLayoutEffect(() => { ref.current = fn; });
  // `useCallback(…, [])` is what makes the identity permanent; the ref read lives
  // INSIDE the returned function, so it happens at call time (an event) and never
  // during render — which is both correct and what keeps react-hooks/refs quiet.
  return useCallback((...args: A) => ref.current(...args), []);
}

/* ── PostgREST 1 000-row cap ──────────────────────────────────────────────────
 * Every PostgREST response is capped server-side (default `max-rows` = 1 000) and
 * the truncation is SILENT — no error, just a short array. Any `select` that can
 * match more rows than that must page with `.range()`, or it quietly returns a
 * partial view of the table. At the documented 1 500-image working set that was
 * not merely slow: the batch-open hydration saw 1 000 of 1 500 products (the rest
 * lost every DB-backed field), and pruneStaleProducts diffed against a partial set.
 * Same idiom as libraryService.fetchSavedImages. (perf finding F13) */
const PG_PAGE = 1000;
/** Hard stop so a server that keeps answering with full pages cannot spin forever. */
const PG_MAX_PAGES = 60;

/** Drain every page of a ranged Supabase select. `page(from, to)` must apply
 *  `.range(from, to)` and nothing else per call — all other filters are the
 *  caller's. Returns the rows read so far plus the first error encountered, so a
 *  mid-pagination failure degrades to "partial, and we know it" instead of
 *  pretending to be complete. */
async function readAllPages<Row>(
  page: (from: number, to: number) => PromiseLike<{ data: Row[] | null; error: { message: string } | null }>,
): Promise<{ rows: Row[]; error: { message: string } | null }> {
  const rows: Row[] = [];
  let from = 0;
  for (let guard = 0; guard < PG_MAX_PAGES; guard++) {
    const { data, error } = await page(from, from + PG_PAGE - 1);
    if (error) return { rows, error };
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PG_PAGE) break;   // short page = last page
    from += PG_PAGE;
  }
  return { rows, error: null };
}

/* ── Lazily-loaded overlays (perf finding F24) ────────────────────────────────
 * None of these is part of the four-step flow; each renders only behind its own
 * `show*` flag, and three of them (KanbanBoard, VocabDashboard, the OrgPanel
 * cluster) are founder-only. Statically imported they contributed ~143 KB of
 * source — plus everything they pull in — to the main chunk that every visitor
 * parses before first paint, including logged-out ones on the landing page.
 * Analytics / CRM / Errors are their own chunks now that they are top-level
 * views rather than tabs inside OrgPanel. Landing / Auth / WaitlistGate are
 * deliberately NOT lazy: they ARE the first paint. */
const HomeDashboard = React.lazy(() => import('./components/HomeDashboard'));
const Library = React.lazy(() => import('./components/Library').then(m => ({ default: m.Library })));
const CategoriesManager = React.lazy(() => import('./components/CategoriesManager'));
const CategoryPresetsManager = React.lazy(() => import('./components/CategoryPresetsManager'));
const OrgPanel = React.lazy(() => import('./components/OrgPanel'));
const VocabDashboard = React.lazy(() => import('./components/VocabDashboard'));
const KanbanBoard = React.lazy(() => import('./components/KanbanBoard'));
const AnalyticsPanel = React.lazy(() => import('./components/AnalyticsPanel'));
const CrmPanel = React.lazy(() => import('./components/CrmPanel'));
const FinanceView = React.lazy(() => import('./components/FinanceView'));
const FounderConsole = React.lazy(() => import('./components/FounderConsole'));
const ErrorsPanel = React.lazy(() => import('./components/ErrorsPanel'));
const MessagesView = React.lazy(() => import('./components/MessagesView'));
const LabelPrintView = React.lazy(() => import('./components/LabelPrintView'));
const BarcodeScannerView = React.lazy(() => import('./components/BarcodeScannerView'));
const ProductsView = React.lazy(() => import('./components/ProductsView'));

/** Every destination the app can be showing. The four workflow steps are one
 *  view ('workflow'); each header tool is a full page of its own. */
export type ActiveView =
  | 'home' | 'workflow' | 'library' | 'categories' | 'presets'
  | 'vocabulary' | 'analytics' | 'crm' | 'finance' | 'board' | 'workspace' | 'messages'
  | 'labels' | 'scan' | 'products' | 'founder';

/** Fallback shown while a view's chunk is in flight. Reuses the existing
 *  `.loading-screen` + `.spinner` styles, so there is no new CSS. */
const ViewFallback = () => (
  <div className="loading-screen" style={{ minHeight: '40vh' }}>
    <div className="spinner" />
  </div>
);

/**
 * The header's ONE control: the workspace trigger and the menu that is now the
 * app's entire navigation.
 *
 * A component of its own, NOT a branch inside App's header, because mounting
 * `useSupportThreads` is what starts the shared Realtime channel and the 45 s
 * poll. App renders this only inside the signed-in header, so a logged-out
 * visitor on the landing page never queries `support_threads`. (It is the same
 * reason the old Messages nav button was its own component; the unread count
 * simply moved from that button to this trigger and to the Inbox menu row.)
 */
function AccountNav(
  { isFounder, userId, items, ...rest }: {
    isFounder: boolean;
    /** Team conversations have N sides, so "waiting on me" is answered by my own
     *  participant row rather than a user/founder column — the badge needs the id. */
    userId: string;
    items: WorkspaceNavItem[];
    orgName: string | null;
    role?: string;
    email?: string | null;
    activeView: string;
    showBackToWorkflow: boolean;
    onSelect: (id: string, opener: HTMLElement | null) => void;
    onSignOut: () => void;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    storage?: WorkspaceStorage | null;
  },
) {
  const { available, unreadCount } = useSupportThreads(isFounder ? 'founder' : 'user', userId);
  // Same rule as the floating widget: no messaging tables, no messaging UI —
  // the row disappears from the menu rather than opening a broken view.
  const resolved = available === false
    ? items.filter(i => i.id !== 'messages')
    : items.map(i => (i.id === 'messages' ? { ...i, badge: unreadCount } : i));
  return (
    <WorkspaceMenu
      {...rest}
      items={resolved}
      unreadCount={available === false ? 0 : unreadCount}
    />
  );
}

/** Strip HTML <br> tags (from Shopify-formatted descriptions) back to plain-text newlines for the dashboard editor. */
function htmlDescToPlain(html: string): string {
  let text = html
    .replace(/<br\s*\/?>\s*<br\s*\/?>/gi, '\n\n')  // double <br> → paragraph break
    .replace(/<br\s*\/?>/gi, '\n')                   // single <br> → line break
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  // Ensure proper paragraph breaks before structural sections
  // (handles cases where Shopify collapses them to single \n or no break)
  text = text
    .replace(/([^\n])\n(BUNDLE AND SAVE)/g, '$1\n\n$2')
    .replace(/(BUNDLE AND SAVE[!]*)\n([^\n])/g, '$1\n\n$2')
    .replace(/([^\n])\n(#\w)/g, '$1\n\n$2')
    .replace(/(#\w[^\n]*)\n(\*\s)/g, '$1\n\n$2')
    .replace(/([^\n])\n(\*\s)/g, (_, before, star) =>
      /[.!?]$/.test(before) || before.startsWith('*') ? `${before}\n${star}` : `${before}\n\n${star}`
    )
    .replace(/\n{3,}/g, '\n\n');

  return text;
}

export interface ClothingItem {
  id: string;
  file: File;
  preview: string;
  thumbnailUrl?: string; // CDN URL with Supabase Storage transform (300px). Used for card display. Full-res URL in imageUrls[0].
  originalName?: string; // Original filename from the user's device (e.g. "DSC02175.jpg") — used for name-sort in Step 2
  capturedAt?: number; // EXIF DateTimeOriginal (ms) or file.lastModified — used to sort by photo date
  category?: string;
  brandCategory?: BrandCategory; // Extended 160+ category system
  productGroup?: string; // For grouping multiple images of same product
  voiceDescription?: string;
  customDescription?: string; // Voice-dictated freeform note injected into AI description
  generatedDescription?: string;
  descriptionEdited?: boolean; // true when user has manually edited the AI description
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
    chest?: string;
    width?: string;
    length?: string;
    waist?: string;
    hip?: string;
    inseam?: string;
    outseam?: string;
    rise?: string;
    shoulder?: string;
    sleeve?: string;
    leg_opening?: string;
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
  shopifyProductType?: string; // Full Shopify taxonomy path for "Standardized Product Type" CSV column
                               // e.g. "Apparel & Accessories > Clothing > Clothing Tops > T-Shirts"
  
  // Status
  status?: 'Active' | 'Draft' | 'Archived';
  published?: boolean;
  
  // Image URLs (for Shopify import)
  imageUrls?: string[];
  // UI transforms applied locally (not stored in DB yet)
  imageRotation?: number; // degrees, clockwise
  crop?: { x: number; y: number; w: number; h: number }; // percentages (0-100) relative to image

  // Which category preset was last applied (preset.id). Persisted to DB as applied_preset_id.
  // Survives reload and is the primary signal for PRESET NAV + autoApplyDefaultPreset.
  appliedPresetId?: string;

  // Original-image cache — preserved when a crop is applied so the user can revert.
  // Set on the FIRST crop; unchanged by subsequent re-crops (always points to the
  // very first upload).  Cleared once "Clear originals cache" is run.
  originalStoragePath?: string; // Supabase Storage path of the pre-crop original
  originalUrl?: string;         // Public URL of the pre-crop original
}

/**
 * Error boundary wrapping the Step 2 image grouper.
 * Catches render errors silently — logs to console and immediately resets
 * so the grouper re-mounts without any visible error screen.
 */
interface GrouperBoundaryState { error: Error | null }
class GrouperErrorBoundary extends Component<{ children: ReactNode }, GrouperBoundaryState> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[GrouperErrorBoundary] caught render error:', error, info);
    // The boundary is the ONLY place a render crash is observable.
    reportError(error, {
      source: 'boundary',
      component: info.componentStack?.split('\n')[1]?.trim().replace(/^at\s+/, '') ?? 'ImageGrouper',
    });
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: '1rem', background: 'var(--danger-dim)', border: '1px solid var(--danger)', borderRadius: 8, minHeight: 200 }}>
          <strong style={{ color: 'var(--danger)' }}>Render error (please report this message):</strong>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: 'var(--fs-lg)', marginTop: 8 }}>{this.state.error.message}{'\n'}{this.state.error.stack}</pre>
          <button onClick={() => this.setState({ error: null })} style={{ marginTop: 8 }}>Retry</button>
        </div>
      );
    }
    return this.props.children;
  }
}

/**
 * Startup-restore guard (finding 22). The auth effect's getSession().then(...)
 * chain is not abortable, so React StrictMode's dev double-mount ran the WHOLE
 * restore twice concurrently — including registerItemsInDB's delete-then-reinsert
 * and the EXIF rescan, racing them against each other. Module-level (not a ref)
 * so the second mount sees the first mount's flag. Same shape as
 * isOpeningBatchRef, which guards handleOpenBatch for exactly this reason.
 */
let startupRestoreInFlight = false;

/**
 * Supabase workflow_state debounce. AGENTS.md §11: never below 1 000 ms.
 *
 * Raised 2 000 → 5 000 (DB CPU). §11's rail is a FLOOR, not a target, and the
 * two things it protects are both still in place and were re-read before this
 * change:
 *   1. The synchronous-loss guarantee belongs to `scheduleWorkflowBackup`
 *      (lib/workflowBackup.ts) — a 1 s TRAILING THROTTLE, i.e. it fires during a
 *      continuous stream of edits rather than being pushed out by them — plus
 *      `flushWorkflowBackup()` wired to BOTH `pagehide` and `beforeunload` and
 *      to the teardown effect. A refresh never loses grouping regardless of what
 *      this constant says.
 *   2. Switching or clearing a batch USED to just drop the pending timer; the
 *      wider window made that a real (if small) loss, so `flushPendingAutoSave()`
 *      below now fires it first.
 * What 5 s buys: Step-2 grouping bursts and Step-3 typing coalesce into ~40 % as
 * many round-trips, each of which is a full JSONB rewrite of the batch blob.
 */
const AUTOSAVE_DEBOUNCE_MS = 5000;
/** How long a fire that collided with an in-flight save waits before retrying.
 *  Still ≥ 1 000 ms, and it re-arms rather than dropping the newest state. */
const AUTOSAVE_RETRY_MS = 1000;
/** Debounce for the `products.product_group` mirror upsert. Separate timer from
 *  the workflow_state save so rapid group/ungroup clicks don't fire an 800-row
 *  upsert each (aae35fc) — which is also why the two mirrors can disagree. */
const GROUP_UPSERT_DEBOUNCE_MS = 2000;

/**
 * The bucket walk this used to be, and still is when the RPC is absent:
 * one `list()` for the user's product folders, then one MORE per folder.
 * The founder's prefix holds 2 517 folders, so drawing the meter was ~2 518
 * authenticated round trips — each one a `storage.objects` query under RLS,
 * and that RLS calls `storage_prefix_writable()`, which runs its own
 * `exists (select … from org_members …)`. Kept verbatim as the fallback so
 * the meter still works on a project where perf_storage_usage.sql has not
 * been run.
 */
async function walkStorageUsage(userId: string): Promise<{ usedBytes: number; fileCount: number }> {
  let totalBytes = 0;
  let totalFiles = 0;
  const { data: productFolders } = await supabase.storage
    .from('product-images')
    .list(userId, { limit: 10000 });
  for (const folder of (productFolders ?? [])) {
    if (folder.metadata) {
      totalBytes += (folder.metadata as { size?: number }).size ?? 0;
      totalFiles++;
    } else {
      const { data: files } = await supabase.storage
        .from('product-images')
        .list(`${userId}/${folder.name}`, { limit: 1000 });
      for (const f of (files ?? [])) {
        totalBytes += (f.metadata as { size?: number } | null)?.size ?? 0;
        totalFiles++;
      }
    }
  }
  return { usedBytes: totalBytes, fileCount: totalFiles };
}

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  // Which user id ensureOrganization has finished resolving (see the pageview effect).
  const [orgResolvedFor, setOrgResolvedFor] = useState<string | null>(null);
  // Multi-org tenancy: the signed-in user's workspace. null = not resolved yet
  // OR the tenancy migration hasn't been run (legacy shared-workspace mode —
  // the app works exactly as before and no org UI is shown).
  const [currentOrg, setCurrentOrg] = useState<Organization | null>(null);
  const [orgRole, setOrgRole] = useState<OrgRole>('member');
  /* ── Top-level view ────────────────────────────────────────────────────────
     The header tools used to be fixed-position modals stacked over the
     workflow. They are full PAGES now (ToolView), and exactly one is showing
     at a time — 'workflow' is the four steps. The workflow itself is never
     unmounted; it is parked behind the `hidden` attribute on <main>, so an
     upload in flight, the grouper's selection, and Step 3's debounced saves
     all survive opening a tool and coming back. */
  const [activeView, setActiveView] = useState<ActiveView>('home');
  /** Which tab the Workspace dashboard opens on. Only Step 4's marketplaces
   *  panel sets it (its "Manage marketplaces" link), and it is cleared on the
   *  way back so the dashboard's own default returns next time. */
  const [workspaceTab, setWorkspaceTab] = useState<'members' | 'marketplaces'>('members');
  // The header button that opened the current view. Focus returns to it on Back
  // so a keyboard user is put back exactly where they left off.
  const viewTriggerRef = useRef<HTMLButtonElement | null>(null);
  // Stable identity: ToolView registers its Escape listener against it, and a
  // new function every render would re-register the listener every render.
  const goToWorkflow = useCallback(() => {
    setActiveView('workflow');
    // Clear the one-shot Workspace tab hint (Step 4 → Marketplaces), so the
    // dashboard opens on its own default the next time it is reached normally.
    setWorkspaceTab('members');
    const trigger = viewTriggerRef.current;
    viewTriggerRef.current = null;
    // Deferred: the view is still mounted this tick, and focusing a node that is
    // about to be detached silently drops focus to <body>.
    requestAnimationFrame(() => trigger?.focus());
  }, []);
  /** Whether the workspace menu is showing. Lifted out of WorkspaceMenu because
   *  the phone tab bar's "More" opens the SAME menu — one component, one list. */
  const [navMenuOpen, setNavMenuOpen] = useState(false);
  /** A pick from the workspace menu. `opener` is the control the menu was opened
   *  from (the header trigger, or More); parking it in `viewTriggerRef` is what
   *  lets ToolView's Back and Escape return focus to where the trip started. */
  /** The shortcuts panel's open state, lifted so the workspace menu can open it on phones. */
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const handleNavSelect = (id: string, opener: HTMLElement | null) => {
    if (id !== 'shortcuts') setShortcutsOpen(false);
    viewTriggerRef.current = opener instanceof HTMLButtonElement ? opener : null;
    if (id === 'workflow') { goToWorkflow(); return; }
    // Not a view: the phone-only menu row that stands in for the shortcuts gear.
    if (id === 'shortcuts') { setShortcutsOpen(true); return; }
    setActiveView(id as ActiveView);
  };
  /** `useState`-shaped setter over activeView, so existing `setShowX(false)`
   *  call sites read exactly as they did. Turning a view OFF only returns to
   *  the workflow when that view is the one actually showing. The other five
   *  tools open/close purely from the header and their Back button, so
   *  `setShowLibrary` — used by handleOpenBatch and the close callback — is
   *  the only flag-shaped setter still worth having. */
  const viewSetter = (view: Exclude<ActiveView, 'workflow'>) => (on: boolean) =>
    setActiveView(cur => (on ? view : cur === view ? 'workflow' : cur));
  const setShowLibrary = viewSetter('library');
  // Analytics is one view with two sub-tabs; Errors used to be a third
  // Founder-tools sibling inside the Workspace modal.
  const [analyticsTab, setAnalyticsTab] = useState<'overview' | 'errors'>('overview');
  // Per-workspace description format — fetched with the org, passed to Step 3
  const [orgDescSettings, setOrgDescSettings] = useState<DescriptionSettings | null>(null);
  // CSV Vendor column = the SELLER: explicit setting → workspace name.
  // Undefined (legacy mode) → exporter falls back to the garment brand, the
  // pre-tenancy behavior.
  //
  // The Founding Workspace used to fall back to a literal shop name instead of
  // its own. It is a demo and testing workspace now — that shop is becoming its
  // own tenant — so it resolves exactly like every other workspace, and a shop
  // that wants a Vendor different from its workspace name types one into
  // Workspace → Settings, which is what that field is for.
  const resolvedVendorName =
    orgDescSettings?.vendorName?.trim()
    || currentOrg?.name
    || undefined;
  // Private beta: non-null → signed in but not approved yet; the waitlist
  // screen replaces the dashboard (RLS already hides all data regardless).
  const [betaWaitlist, setBetaWaitlist] = useState<'none' | 'pending' | 'denied' | null>(null);
  // Logged-out visitors see the marketing landing at the main URL; "Log in"
  // switches to the Auth screen. Logged-in users skip both (session restore).
  const [showLogin, setShowLogin] = useState(false);
  // The four item arrays live in workflowStore — the single source of truth
  // (refactor Stage 2). useStoreItemArray keeps the exact useState API, so
  // every setter call site (value AND functional-update forms) is unchanged.
  const [uploadedImages, setUploadedImages] = useStoreItemArray('uploadedImages');
  const [sortedImages, setSortedImages] = useStoreItemArray('sortedImages');
  const [groupedImages, setGroupedImages] = useStoreItemArray('groupedImages');
  const [processedItems, setProcessedItems] = useStoreItemArray('processedItems');
  /* ── ONE STEP AT A TIME ON A PHONE (≤640px) ──────────────────────────────
     The four step sections all stay mounted and rendered — this only decides
     which one is VISIBLE, and only below 640px, where App.css hides the others
     off `data-phone-step`. Above that breakpoint those rules do not exist, so
     this state is inert: nothing here is behind a matchMedia or a resize
     listener, and nothing unmounts (AGENTS.md §6).

     The stored value is what the user last asked for; `shownStep` is what is
     actually on screen. Deriving the clamp at render rather than correcting the
     state in an effect means it can never be stale for a frame, and a batch
     cleared out from under the user (sign-out, Clear Batch, the 3s auto-clear
     after Save) needs no teardown code of its own. */
  const [phoneStep, setPhoneStep] = useState<WorkflowStep>(1);
  const stepCounts: StepCounts = {
    uploaded: uploadedImages.length,
    sorted: sortedImages.length,
    processed: processedItems.length,
  };
  const phoneReachable = reachableSteps(stepCounts);
  const shownStep = clampStep(phoneStep, stepCounts);
  /** The shortcuts control (gear on desktop, menu row on phones) exists only where
   *  the shortcuts apply: Step 2 and Step 3 of the workflow. */
  const showShortcuts = activeView === 'workflow' && (shownStep === 2 || shownStep === 3);
  /** Every user-driven step change (the stepper chips and the Back / Continue rows). */
  const goToPhoneStep = (step: WorkflowStep) => {
    setShortcutsOpen(false);
    setPhoneStep(step);
    // The sections swap in place, so the page would otherwise keep the offset
    // the previous step was scrolled to and open the next one part-way down.
    window.scrollTo({ top: 0 });
  };
  const [selectedGroupItems, setSelectedGroupItems] = useState<Set<string>>(new Set());
  const [grouperActions, setGrouperActions] = useState<GrouperActions | null>(null);
  // Ref mirror so onCategoryAssigned closures always call the current clearSelection
  const grouperActionsRef = useRef<GrouperActions | null>(null);
  grouperActionsRef.current = grouperActions;
  const showLibrary = activeView === 'library';
  // Ref mirror so the autoSave closure (inside setTimeout) can read the live value
  // without capturing a stale boolean from the render where autoSave was scheduled.
  const showLibraryRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const [libraryRefreshTrigger, setLibraryRefreshTrigger] = useState(0);
  const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // ── Storage usage meter (lifted from ImageUpload) ─────────────────────────
  const [storageInfo, setStorageInfo] = useState<{
    usedBytes: number;
    fileCount: number;
    loading: boolean;
  } | null>(null);

  // Session cache: the meter's number cannot change except through this tab's
  // own uploads and deletes, and both of those already call fetchStorageUsage
  // with `force`. Without this, every re-render path that touched the effect
  // re-ran the whole walk.
  const storageUsageCacheRef = useRef<{ usedBytes: number; fileCount: number } | null>(null);
  // Set once the RPC has answered with 42883 (undefined_function) — i.e. the
  // migration is not run on this project. Stops us paying for a failed RPC
  // before every fallback walk.
  const storageRpcMissingRef = useRef(false);

  const fetchStorageUsage = async (userId: string, force = false) => {
    if (!force && storageUsageCacheRef.current) {
      setStorageInfo({ ...storageUsageCacheRef.current, loading: false });
      return;
    }
    setStorageInfo(prev => ({
      usedBytes: prev?.usedBytes ?? 0,
      fileCount: prev?.fileCount ?? 0,
      loading: true,
    }));

    let result: { usedBytes: number; fileCount: number } | null = null;

    // One query (perf_storage_usage.sql). Sums the SAME rows the walk visits —
    // objects under this user's own uid prefix in the product-images bucket.
    if (!storageRpcMissingRef.current) {
      const { data, error } = await supabase.rpc('storage_usage_bytes');
      if (error) {
        // 42883 = the migration has not been run here. Anything else (a network
        // blip) is transient, so don't latch the flag for it.
        if (error.code === '42883') storageRpcMissingRef.current = true;
        log.app(`fetchStorageUsage | RPC unavailable (${error.code ?? ''}) — falling back to the bucket walk`);
      } else if (data) {
        const d = data as { used_bytes?: number | string; file_count?: number | string };
        result = { usedBytes: Number(d.used_bytes ?? 0), fileCount: Number(d.file_count ?? 0) };
      }
    }

    if (!result) result = await walkStorageUsage(userId);

    storageUsageCacheRef.current = result;
    setStorageInfo({ ...result, loading: false });
  };
  // ─────────────────────────────────────────────────────────────────────────

  // ── Toast notifications ───────────────────────────────────────────────────
  const [toasts, setToasts] = useState<{ id: number; msg: string }[]>([]);
  const toastCounterRef = useRef(0);

  const addToast = (msg: string) => {
    const id = ++toastCounterRef.current;
    setToasts(prev => [...prev, { id, msg }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000);
  };

  const dismissToast = (id: number) => setToasts(prev => prev.filter(t => t.id !== id));
  // ─────────────────────────────────────────────────────────────────────────

  // Ref to GoogleSheetExporter so Step 3 sidebar can trigger the download
  const exporterRef = useRef<GoogleSheetExporterHandle>(null);
  const uploadRef = useRef<ImageUploadHandle>(null);
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
  // In-flight guard — prevents two concurrent autoSaveWorkflowBatch calls from both
  // hitting "0 rows updated → INSERT new batch" when the row doesn't exist yet.
  const autoSaveInFlightRef = useRef(false);
  // The pending debounced save's own `fire`, so a batch switch / clear can run it
  // instead of silently dropping it. Set whenever the timer is armed, cleared
  // when it fires. See flushPendingAutoSave.
  const pendingAutoSaveFireRef = useRef<(() => void) | null>(null);
  // Per-item fingerprint of what the products mirror upsert last WROTE, so the
  // 2 s group-upsert can send only the rows that actually changed. See
  // lib/productUpsertDedupe.ts.
  const upsertedProductKeysRef = useRef(new Map<string, string>());
  // Debounce timer for the products-table upsert in handleImagesGrouped.
  // Separate from autoSaveTimerRef so the workflow_state save and the products upsert
  // can debounce independently. Both fire after 2 s of inactivity.
  const groupUpsertTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Chunk-ready debounce: accumulate items from successive onChunkReady calls and
  // flush to state at most every 150 ms so we don't trigger a full ImageGrouper
  // re-render for every 10-image chunk (385 images = 39 chunks = 39 repaints without this).
  const pendingChunkRef = useRef<ClothingItem[]>([]);
  const chunkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // True if the workflow_batches DB row has been pre-inserted for the current session.
  // Initialized to true when localStorage already has a batch ID — the row was created
  // in a prior session so we must not INSERT it again (would 409 Conflict on reload).
  const batchRowInsertedRef = useRef(!!localStorage.getItem('sortbot_current_batch_id'));
  // Tracks whether an upload is actively in progress. Set true on the first chunk,
  // cleared when all chunks are done (handleImagesUploaded). Used to suppress the
  // handleImagesGrouped → setGroupedImages cascade that fires via onGrouped during
  // upload and causes a second O(n) re-render per 150ms debounce flush.
  const isUploadingRef = useRef(false);

  // NOTE: the old per-render ref mirrors of the four item arrays are gone —
  // sortedImagesRef & co. are now module-level LIVE views into workflowStore
  // (see liveArrayRef imports at the top of this file).

  // ── Teardown: flush the backup, then drop every pending timer ─────────────
  // The three debounce timers below outlived the component: a tab close or an
  // unmount mid-debounce left them queued to fire against a torn-down tree.
  // The unload flush is what preserves the "a refresh never loses grouping"
  // guarantee now that the localStorage backup is throttled (see autoSaveWorkflow):
  // whatever is still inside the throttle window is written before the page goes.
  // `pagehide` is the dependable one — `beforeunload` does not fire reliably on
  // back-button navigation or when a mobile browser freezes the page into bfcache.
  useEffect(() => {
    const flushOnUnload = () => flushWorkflowBackup();
    window.addEventListener('beforeunload', flushOnUnload);
    window.addEventListener('pagehide', flushOnUnload);
    return () => {
      window.removeEventListener('beforeunload', flushOnUnload);
      window.removeEventListener('pagehide', flushOnUnload);
      flushWorkflowBackup();
      if (autoSaveTimerRef.current)    { clearTimeout(autoSaveTimerRef.current);    autoSaveTimerRef.current = null; }
      if (groupUpsertTimerRef.current) { clearTimeout(groupUpsertTimerRef.current); groupUpsertTimerRef.current = null; }
      if (chunkTimerRef.current)       { clearTimeout(chunkTimerRef.current);       chunkTimerRef.current = null; }
    };
  }, []);
  const [currentBatchNumber, setCurrentBatchNumber] = useState<string>(() => {
    return localStorage.getItem('sortbot_current_batch_number') || `batch-${Date.now()}`;
  });

  // Keep showLibraryRef in sync so the autoSave closure always reads the live value
  useEffect(() => { showLibraryRef.current = showLibrary; }, [showLibrary]);

  // When a category preset is updated in CategoryPresetsManager, re-apply the new
  // preset values to all processedItems that already belong to that category.
  useEffect(() => {
    const handler = async (e: Event) => {
      const updatedCategoryName = (e as CustomEvent).detail?.categoryName as string | undefined;
      const current = processedItemsRef.current;
      if (!current.length) return;
      try {
        const allPresets = await getCategoryPresets();
        // Build a lookup by preset id for fast matching
        const presetsById = Object.fromEntries(allPresets.map(p => [p.id, p]));
        const updated = current.map(item => {
          // Primary match: use the presetId stored on the item when the preset was applied
          const presetId = (item._presetData as any)?.presetId as string | undefined;
          let preset = presetId ? presetsById[presetId] : undefined;

          // Secondary match: fall back to matching by category_name from the event
          if (!preset && updatedCategoryName) {
            preset = allPresets.find(p => p.category_name === updatedCategoryName && p.is_active !== false);
          }

          // Skip items not belonging to the updated preset
          if (!preset) return item;
          // Skip if this item's preset wasn't the one that was just updated
          if (updatedCategoryName && preset.category_name !== updatedCategoryName) return item;

          // Strip preset-owned fields before re-applying so the fresh preset values
          // always win (these fields use `item.field || preset.field` internally,
          // meaning the old baked-in value would otherwise block the update).
          const PRESET_OWNED: (keyof typeof item)[] = [
            'productType', 'shopifyProductType', 'policies', 'shipsFrom',
            'gender', 'whoMadeIt', 'whatIsIt', 'listingType', 'discountedShipping',
            'renewalOptions', 'sizeType', 'style', 'ageGroup', 'customLabel0',
            'mpn', 'taxCode', 'weightValue', 'packageDimensions', 'parcelSize',
            'continueSellingOutOfStock', 'requiresShipping', 'status', 'published',
            '_presetData',
          ];
          const stripped = { ...item } as typeof item;
          PRESET_OWNED.forEach(f => { (stripped as any)[f] = undefined; });
          // Re-apply preset — preset-owned fields now come fresh from the updated preset
          return applyPresetDirectly([stripped], item.category!, preset)[0];
        });
        setProcessedItems(updated);
      } catch (err) {
        console.error('[presetsUpdated] failed to re-apply presets:', err);
      }
    };
    window.addEventListener('presetsUpdated', handler);
    return () => window.removeEventListener('presetsUpdated', handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounced onChunkReady handler — batches up chunk results so the UI repaints
  // at most every 150 ms instead of once per 10-image chunk.
  // ALSO mints the batchId on the very first call so that by the time
  // handleImagesUploaded fires (after all chunks), currentBatchId is already the
  // stable UUID — preventing ImageGrouper's batchId prop from changing mid-upload
  // and wiping any groups the user formed while images were still uploading.
  // Called at the very start of a new upload (before chunk 1 is processed).
  // Mints the batchId synchronously so it's available for the first per-chunk DB write.
  const handleUploadStart = useCallback(() => {
    isUploadingRef.current = true;
    if (!currentBatchIdRef.current) {
      const newBatchId = crypto.randomUUID();
      currentBatchIdRef.current = newBatchId;
      setCurrentBatchId(newBatchId);
      localStorage.setItem('sortbot_current_batch_id', newBatchId);
    }
  }, []);

  const handleChunkReady = useCallback((newItems: ClothingItem[]) => {
    // Mark upload in progress so handleImagesGrouped skips the cascade-triggering
    // setGroupedImages update for every intermediate onGrouped call during upload.
    isUploadingRef.current = true;
    // Fallback: mint batch ID if handleUploadStart somehow didn't fire first.
    if (!currentBatchIdRef.current) {
      const newBatchId = crypto.randomUUID();
      currentBatchIdRef.current = newBatchId;
      setCurrentBatchId(newBatchId);
      localStorage.setItem('sortbot_current_batch_id', newBatchId);
      // DB row insert happens once in handleImagesUploaded after all chunks complete
    }
    pendingChunkRef.current.push(...newItems);
    if (chunkTimerRef.current) clearTimeout(chunkTimerRef.current);
    chunkTimerRef.current = setTimeout(() => {
      const batch = pendingChunkRef.current;
      pendingChunkRef.current = [];
      chunkTimerRef.current = null;
      setUploadedImages(prev => [...prev, ...batch]);
      // If a batch is already open (add-more scenario), stream each chunk into
      // groupedImages/sortedImages/processedItems immediately so the user can
      // start grouping the new images as they arrive — same as the first upload.
      if (currentBatchIdRef.current && groupedImagesRef.current.length > 0) {
        const existingGroupedIds = new Set(groupedImagesRef.current.map(i => i.id));
        const freshItems = batch.filter(i => !existingGroupedIds.has(i.id));
        if (freshItems.length > 0) {
          setGroupedImages(prev => [...prev, ...freshItems]);
          setSortedImages(prev => [...prev, ...freshItems]);
          setProcessedItems(prev => [...prev, ...freshItems]);
        }
      }
    }, 150);
    // Store setters have stable identity (workflowStore) — listed to satisfy exhaustive-deps.
  }, [setUploadedImages, setGroupedImages, setSortedImages, setProcessedItems]);

  /**
   * Called by ImageUpload when the user cancels a partially-finished upload
   * (finding 3). The cancel path deletes the Storage objects and the DB rows it
   * wrote; these items must also leave the in-memory arrays, or the session is
   * left holding items whose CDN URLs 404 — which then get re-registered by the
   * next group action and, once they outgrow the gap-fill cap, silently deleted.
   */
  const handleUploadCancelled = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    const drop = new Set(ids);
    const prune = (arr: ClothingItem[]) => arr.filter(i => !drop.has(i.id));
    setUploadedImages(prune);
    setGroupedImages(prune);
    setSortedImages(prune);
    setProcessedItems(prune);
    pendingChunkRef.current = pendingChunkRef.current.filter(i => !drop.has(i.id));
    log.upload(`handleUploadCancelled | dropped ${ids.length} cancelled items from state`);
    // Store setters have stable identity (workflowStore) — listed to satisfy exhaustive-deps.
  }, [setUploadedImages, setGroupedImages, setSortedImages, setProcessedItems]);

  // Fetch storage usage once the user is known
  useEffect(() => {
    if (!user) return;
    fetchStorageUsage(user.id);
  }, [user]);

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
    if (registerable.length === 0) return;
    log.db(`registerItemsInDB | start | items=${liveItems.length} registerable=${registerable.length} batchId=${batchId}`);
    try {
      await supabase.from('products').upsert(
        registerable.map(item => ({
          id: item.id,
          user_id: activeUser.id,
          batch_id: batchId,
          title: item.seoTitle || null,
          status: 'Active',
          product_group: item.productGroup || item.id,
        })),
        // ignoreDuplicates: true — NEVER overwrite batch_id on an existing products row.
        // Using ignoreDuplicates: false caused batch_id to be silently stolen: when
        // restoredProcessedItems included gap-filled items from other batches,
        // registerItemsInDB would re-tag ALL of them with the current batch's id.
        // On the next open, those items appeared in the DB query (.eq('batch_id', X))
        // making the gap-fill grow unboundedly (38 items → 1003 items after one open).
        // batch_id is set authoritatively at upload time (handleImagesUploaded) and must
        // not be changed here.
        //
        // NOTE what `ignoreDuplicates: true` actually means: for a row that ALREADY
        // EXISTS this upsert writes nothing at all — not batch_id (the point), but not
        // product_group or title either. It only ever INSERTS rows that are missing.
        // The single writer of `product_group` on an existing row is the debounced
        // upsert in handleImagesGrouped (plus saveBatchToDatabase /
        // syncGroupFieldsToDatabase in Step 3), which is exactly why that column runs
        // stale — and why the restore merge must NOT treat it as authoritative for
        // grouping (see OPEN_BATCH_MERGE_OPTIONS in lib/productRow.ts).
        { onConflict: 'id', ignoreDuplicates: true }
      );
      // Build product_images rows. For image_url: prefer imageUrls[0], fall back to publicImageUrl(storagePath).
      // storage_path may be null for legacy items — that's fine, the column is nullable.
      // Conflict key: (product_id, image_url) — matches the existing composite unique constraint.
      // Stage 4 dual-write: rows include transforms + captured_at + original_storage_path
      // (the latter two only once the stage4_slim_fields migration has been run).
      const stage4 = await stage4ColumnsAvailable();
      // position 0: each of these rows is the PRIMARY image of its own product.
      // (It used to be the item's index in `registerable`, which made every
      // product's single row claim a different, meaningless position.)
      const productImageRows = registerable.flatMap((item) => {
        const imageUrl = item.imageUrls?.[0] || publicImageUrl(item.storagePath) || null;
        if (!imageUrl) return []; // no image_url available at all — skip
        return [buildProductImageRow(item, activeUser.id, 0, imageUrl, stage4)];
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

        // Read the FULL existing row set before wiping it. Two reasons:
        //  1. original_name: in-memory items from pre-originalName batches have none,
        //     and re-inserting null would erase a previously backfilled filename.
        //  2. finding 16 — a group's photos live as N rows against the LEADER product
        //     (written by saveBatchToDatabase with real `position` values), while this
        //     function only knows one row per item. Re-inserting just our rows
        //     collapsed the group's photo list and flattened every position on every
        //     batch open. mergeProductImageRows carries those rows across the wipe.
        //     The wipe itself STAYS (AGENTS.md §18 #3) — it is still what clears a
        //     stale row whose CDN URL changed for a file we are re-writing.
        const existingRowSelect = 'product_id, image_url, storage_path, position, alt_text, original_name, transforms, user_id'
          + (stage4 ? ', captured_at, original_storage_path' : '');
        const existingRows: ExistingProductImageRow[] = [];
        let existingReadOk = true;
        for (const chunk of chunked(productIds)) {
          const { data, error: readErr } = await supabase
            .from('product_images')
            .select(existingRowSelect)
            .in('product_id', chunk);
          if (readErr) {
            // Could not see the current rows — do NOT wipe what we cannot re-create.
            console.warn('[App] registerItemsInDB | existing product_images read error:', readErr.message);
            existingReadOk = false;
            break;
          }
          for (const row of (data ?? []) as unknown as ExistingProductImageRow[]) {
            existingRows.push({ ...row, user_id: row.user_id || activeUser.id });
          }
        }

        // Carry original_name forward for items whose in-memory value is missing.
        const existingNameMap = new Map<string, string>();
        for (const row of existingRows) {
          if (row.original_name && !existingNameMap.has(row.product_id)) {
            existingNameMap.set(row.product_id, row.original_name);
          }
        }
        if (existingNameMap.size > 0) {
          for (const row of productImageRows) {
            if (!row.original_name && existingNameMap.has(row.product_id)) {
              row.original_name = existingNameMap.get(row.product_id)!;
            }
          }
          log.db(`registerItemsInDB | preserved original_name for ${existingNameMap.size} items from DB`);
        }

        const rowsToWrite = existingReadOk
          ? mergeProductImageRows(productImageRows, existingRows)
          : productImageRows;
        const carriedOver = rowsToWrite.length - productImageRows.length;
        if (carriedOver > 0) {
          log.db(`registerItemsInDB | carried ${carriedOver} existing group photo row(s) across the wipe`);
        }

        if (existingReadOk) {
          for (const chunk of chunked(productIds)) {
            const { error: delErr } = await supabase
              .from('product_images')
              .delete()
              .in('product_id', chunk);
            if (delErr) {
              console.warn('[App] registerItemsInDB | product_images delete error:', delErr.message);
            }
          }
        }

        // Use upsert with ignoreDuplicates to handle concurrent calls:
        // DELETE already ran above to clear stale URLs. If a concurrent
        // registerItemsInDB call already re-inserted the rows (race), the
        // upsert simply skips them rather than throwing a 409 conflict.
        const { error: imgErr } = await supabase.from('product_images').upsert(
          rowsToWrite,
          { onConflict: 'product_id,image_url', ignoreDuplicates: true }
        );
        if (imgErr) {
          console.warn('[App] registerItemsInDB | product_images upsert error:', imgErr.message, imgErr.code, imgErr.details);
        }
      }
      log.db(`registerItemsInDB | done | registered=${registerable.length}`);
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
      if (startupRestoreInFlight) {
        log.auth('app startup | restore already in flight (StrictMode double-mount) — skipping');
        return;
      }
      startupRestoreInFlight = true;

      // Auto-restore last batch on page load so users don't lose progress on reload
      const savedBatchId = localStorage.getItem('sortbot_current_batch_id');
      log.auth(`app startup | user=${session?.user?.email ?? 'none'} | savedBatchId=${savedBatchId ?? 'none'}`);
      if (savedBatchId && session?.user) {
        try {
          const { data: batch } = await supabase
            .from('workflow_batches')
            .select('*')
            .eq('id', savedBatchId)
            .maybeSingle(); // .single() throws a 406 when the row doesn't exist; .maybeSingle() returns null
          if (!batch) {
            // Batch was deleted — clear stale localStorage so we start fresh
            log.app(`startup restore | batchId=${savedBatchId} NOT FOUND — clearing localStorage`);
            currentBatchIdRef.current = null;
            setCurrentBatchId(null);
            localStorage.removeItem('sortbot_current_batch_id');
            localStorage.removeItem('sortbot_current_batch_number');
          } else {
            // Batch exists — sync ref+state immediately regardless of workflow_state presence,
            // so any autoSave that fires in the next 2s updates this batch instead of creating a new orphan.
            currentBatchIdRef.current = savedBatchId;
            setCurrentBatchId(savedBatchId);
            markBatchConfirmed(savedBatchId); // row verified — if it vanishes later, it was deleted (never re-create)

            if (batch.workflow_state) {
              const { uploadedImages, groupedImages, sortedImages, processedItems } = batch.workflow_state;
              // processedItems is now the single saved list (others are empty arrays).
              // Fall back through all arrays in case an older batch format is loaded.
              let rawItems: any[] =
                processedItems?.length  ? processedItems  :
                sortedImages?.length    ? sortedImages     :
                groupedImages?.length   ? groupedImages    :
                uploadedImages          ? uploadedImages   : [];

              // Which copy is newer — the Supabase blob or the throttled localStorage
              // backup? Decided by lib/restoreSource.ts, which compares the backup's
              // savedAt against when the BLOB'S CONTENT was captured
              // (workflow_state.lastEditedAt), not against `last_opened_at`.
              // `last_opened_at` dates the round trip, not the payload, and is bumped
              // by writes that touch no workflow_state at all — so it systematically
              // over-stated the DB's freshness and threw away newer grouping work.
              // When the backup wins the two are MERGED (it carries 7 fields, the blob
              // carries 15) so winning the race no longer costs customDescription /
              // originalName / brandCategory for the whole batch.
              {
                const backup = readWorkflowBackup(
                  localStorage.getItem(WORKFLOW_BACKUP_KEY), savedBatchId,
                );
                const decision = resolveRestoreItems({
                  dbItems: rawItems,
                  dbCapturedAt: workflowStateCapturedAt(batch),
                  backup,
                });
                if (decision.source !== 'db') {
                  log.app(`startup restore | source=${decision.source} — ${decision.reason}`);
                  rawItems = decision.items;
                }
              }
              // Re-hydrate preview — stripped before saving to reduce payload size.
              // imageUrls may also be empty for older items; reconstruct from storagePath
              // (synchronous, no extra DB query) as the final fallback.
              // IMPORTANT: reject any saved blob: URL — they are only valid for the browser
              // session in which they were created and will 404 after any page reload.
              // ALSO: imageUrls[0] can end up pointing to a different item's path due to
              // merge bugs — storagePath is always authoritative, so always rebuild from it.
              const liveItems = rawItems.map((item: any) => {
                const canonical = publicImageUrl(item.storagePath);
                // If we have a storagePath, rebuild imageUrls entirely from it (ignore saved value)
                const imageUrls = canonical ? [canonical] : (item.imageUrls?.length ? item.imageUrls : []);
                const preview = canonical || (item.preview?.startsWith('blob:') ? '' : (item.preview || ''));
                const thumbnailUrl = thumbnailImageUrl(item.storagePath) || imageUrls[0] || '';
                return {
                  ...item,
                  preview,
                  imageUrls,
                  thumbnailUrl,
                };
              });

              // Backfill originalName from the DB for any item that doesn't already have it.
              // One query covering all items, then merge in. Covers items saved before
              // originalName was tracked in workflow_state.
              const itemsMissingName = liveItems.filter((i: any) => !i.originalName);
              if (itemsMissingName.length > 0) {
                // Chunk the product_id IN() list — PostgREST returns a 400 when the URL
                // gets too long (~794+ IDs). Large batches (800+ images) hit this.
                const missingNameIds = itemsMissingName.map((i: any) => i.id);
                const nameRows: any[] = [];
                for (const idChunk of chunked(missingNameIds)) {
                  const { data } = await supabase
                    .from('product_images')
                    .select('product_id, original_name')
                    .in('product_id', idChunk)
                    .not('original_name', 'is', null)
                    .order('position', { ascending: true });
                  if (data) nameRows.push(...data);
                }
                if (nameRows && nameRows.length > 0) {
                  const nameMap = new Map<string, string>();
                  for (const row of nameRows) {
                    if (row.original_name && !nameMap.has(row.product_id)) nameMap.set(row.product_id, row.original_name);
                  }
                  for (const item of liveItems) {
                    if (!item.originalName && nameMap.has(item.id)) {
                      item.originalName = nameMap.get(item.id);
                    }
                  }
                }
              }
              let noUrlCount = liveItems.filter((i: any) => !i.thumbnailUrl && !i.preview && !i.imageUrls?.[0]).length;

              // For items that still have no URL (storagePath was also absent in slim data),
              // fall back to product_images DB rows — one query for all missing items at once.
              // These are legacy items uploaded before storagePath was tracked in slim data.
              let hydratedItems = liveItems;
              if (noUrlCount > 0) {
                const missingIds = liveItems
                  .filter((i: any) => !i.thumbnailUrl && !i.preview && !i.imageUrls?.[0])
                  .map((i: any) => i.id);
                const missingGroupIds = [...new Set(
                  liveItems
                    .filter((i: any) => missingIds.includes(i.id))
                    .map((i: any) => i.productGroup)
                    .filter(Boolean)
                )];
                log.app(`startup restore | DB fallback | missingIds=${missingIds.length} distinctGroups=${missingGroupIds.length} sampleIds=${missingIds.slice(0,3).join(',')}`);

                // Primary: look up product_images directly by product_id.
                // Chunked to stay under PostgREST's URL-length limit on large batches.
                const dbImages: any[] = [];
                let dbImgErr: any = null;
                for (const idChunk of chunked(missingIds)) {
                  const { data, error } = await supabase
                    .from('product_images')
                    .select('product_id, image_url, storage_path, position, original_name')
                    .in('product_id', idChunk)
                    .order('position', { ascending: true });
                  if (error) dbImgErr = error;
                  if (data) dbImages.push(...data);
                }
                log.app(`startup restore | DB fallback stage1 | rows=${dbImages?.length ?? 0}${dbImgErr ? ` err=${dbImgErr.message}` : ''}`);

                // Secondary: for items still missing, look up their productGroup peers in product_images.
                // Legacy items that were secondary photos in a group may share a productGroup with an item
                // that does have images — use the group leader's first image as the fallback.
                const imgMap = new Map<string, string[]>();
                const pathMap = new Map<string, string>();
                const origNameMap = new Map<string, string>();
                if (dbImages && dbImages.length > 0) {
                  for (const row of dbImages) {
                    if (!imgMap.has(row.product_id)) imgMap.set(row.product_id, []);
                    if (row.image_url) imgMap.get(row.product_id)!.push(row.image_url);
                    if (row.storage_path && !pathMap.has(row.product_id)) pathMap.set(row.product_id, row.storage_path);
                    if (row.original_name && !origNameMap.has(row.product_id)) origNameMap.set(row.product_id, row.original_name);
                  }
                }
                // Find items still without a hit and try their productGroup
                const stillMissingItems = liveItems.filter((i: any) =>
                  missingIds.includes(i.id) && !imgMap.has(i.id)
                );
                if (stillMissingItems.length > 0) {
                  const groupIds = [...new Set(stillMissingItems
                    .map((i: any) => i.productGroup)
                    .filter(Boolean)
                  )] as string[];
                  log.app(`startup restore | DB fallback stage2 | stillMissing=${stillMissingItems.length} groupIds=${groupIds.length} sampleGroups=${groupIds.slice(0,3).join(',')}`);
                  if (groupIds.length > 0) {
                    // Fetch product_images for ALL items that share these productGroups,
                    // so we can map group leader → images and hand them to orphan items.
                    // Both IN() lists are chunked at 100: unchunked, a large batch
                    // builds a multi-KB URL that PostgREST answers with a 400/414
                    // (the same limit lib/chunk.ts's ID_CHUNK exists for).
                    const groupProducts = [];
                    let gpErr: { message: string } | null = null;
                    for (const groupChunk of chunked(groupIds)) {
                      const { data, error } = await supabase
                        .from('products')
                        .select('id, product_group')
                        .in('product_group', groupChunk);
                      if (error) { gpErr = error; break; }
                      if (data) groupProducts.push(...data);
                    }
                    log.app(`startup restore | DB fallback stage2 products | rows=${groupProducts.length}${gpErr ? ` err=${gpErr.message}` : ''}`);
                    if (groupProducts.length > 0) {
                      const groupMemberIds = groupProducts.map((p: any) => p.id);
                      const groupImages = [];
                      let giErr: { message: string } | null = null;
                      for (const memberChunk of chunked(groupMemberIds)) {
                        const { data, error } = await supabase
                          .from('product_images')
                          .select('product_id, image_url, storage_path, position')
                          .in('product_id', memberChunk)
                          .order('position', { ascending: true });
                        if (error) { giErr = error; break; }
                        if (data) groupImages.push(...data);
                      }
                      log.app(`startup restore | DB fallback stage2 images | rows=${groupImages.length}${giErr ? ` err=${giErr.message}` : ''}`);
                      if (groupImages.length > 0) {
                        // Build a map: productGroup → image_url list (from any member that has images)
                        const groupImgMap = new Map<string, string[]>();
                        const groupPathMap = new Map<string, string>();
                        for (const gp of groupProducts) {
                          const imgs = groupImages.filter((gi: any) => gi.product_id === gp.id);
                          if (imgs.length > 0) {
                            const g = gp.product_group;
                            if (!groupImgMap.has(g)) groupImgMap.set(g, []);
                            for (const gi of imgs) {
                              if (gi.image_url) groupImgMap.get(g)!.push(gi.image_url);
                              if (gi.storage_path && !groupPathMap.has(g)) groupPathMap.set(g, gi.storage_path);
                            }
                          }
                        }
                        // Apply group images to the orphan items
                        for (const item of stillMissingItems) {
                          const g = item.productGroup;
                          if (g && groupImgMap.has(g)) {
                            imgMap.set(item.id, groupImgMap.get(g)!);
                            if (groupPathMap.has(g)) pathMap.set(item.id, groupPathMap.get(g)!);
                          }
                        }
                      }
                    }
                  } else {
                    log.app(`startup restore | DB fallback stage2 | SKIPPED — no productGroup set on missing items`);
                  }
                }
                const afterFallback = imgMap.size > 0
                  ? liveItems.filter((i: any) => missingIds.includes(i.id) && !imgMap.has(i.id)).length
                  : noUrlCount;
                log.app(`startup restore | DB fallback result | imgMapSize=${imgMap.size} fixed=${noUrlCount - afterFallback} stillMissing=${afterFallback}`);
                if (imgMap.size > 0) {
                  hydratedItems = liveItems.map((item: any) => {
                    if (item.thumbnailUrl || item.preview || item.imageUrls?.[0]) return item;
                    const urls = imgMap.get(item.id) ?? [];
                    const sp = pathMap.get(item.id) ?? item.storagePath ?? '';
                    const reconstructed = publicImageUrl(sp) || (urls[0] ?? '');
                    const thumbUrl = thumbnailImageUrl(sp) || (urls[0] ?? '');
                    return {
                      ...item,
                      storagePath: sp || item.storagePath,
                      preview: urls[0] || reconstructed,
                      imageUrls: urls.length ? urls : (reconstructed ? [reconstructed] : []),
                      thumbnailUrl: thumbUrl || urls[0] || reconstructed,
                      originalName: item.originalName || origNameMap.get(item.id) || undefined,
                    };
                  });
                  noUrlCount = hydratedItems.filter((i: any) => !i.thumbnailUrl && !i.preview && !i.imageUrls?.[0]).length;
                }
              }

              if (hydratedItems.length) {
                // ── Report 16 tripwire ────────────────────────────────────────
                // Every item that still declares a rotation, and whether its URL
                // is derived from storagePath (safe — that file is NOT baked) or
                // came from a product_images row (which CAN be a baked, already-
                // rotated file, so a CSS rotate on top of it shows 180°).
                if (isDebugEnabled()) {
                  const rotated = (hydratedItems as ClothingItem[]).filter(i => i.imageRotation);
                  if (rotated.length) {
                    log.img(`[rot] ${rotated.length} restored item(s) still declare a rotation:`,
                      rotated.slice(0, 10).map(i => ({
                        id: i.id,
                        rotation: i.imageRotation,
                        urlFrom: i.storagePath && i.preview === publicImageUrl(i.storagePath) ? 'storagePath (safe)' : 'DB row (suspect)',
                        preview: i.preview?.slice(-40),
                      })));
                  }
                }
                const restoredFrom = processedItems?.length ? 'processedItems' : sortedImages?.length ? 'sortedImages' : groupedImages?.length ? 'groupedImages' : 'uploadedImages';
                log.app(`startup restore | HYDRATED | batchId=${savedBatchId} | rawItems=${rawItems.length} liveItems=${hydratedItems.length} | restoredFrom=${restoredFrom}${noUrlCount ? ` | noUrl=${noUrlCount}` : ''}`);
                setUploadedImages(hydratedItems);
                setGroupedImages(hydratedItems);
                setSortedImages(hydratedItems);
                setProcessedItems(hydratedItems);
                // Phone: open on the step that has work left (never Export — see
                // resumeStep). Read through the liveArrayRef view, which is fresh
                // the instant a store setter returns.
                setPhoneStep(resumeStep(processedItemsRef.current));
                // Pass session.user explicitly — React `user` state hasn't been set yet at this point
                // (setUser(session.user) queues a re-render but doesn't run synchronously)
                // NOTE: registerItemsInDB is called ONLY if products are missing from DB
                // (checked inside the hydration block below). Calling it unconditionally
                // caused 10 heavy queries (400-row delete+upsert) on every page load.

                // ── Background DB hydration ──────────────────────────────────────────
                // workflow_state now stores only slim items (non-DB fields).
                // Re-fill all DB-backed fields (descriptions, prices, tags, etc.) from
                // the products table after the UI is already visible. Fire-and-forget.
                (async () => {
                  try {
                    const hydrateSelect = `id, description, seo_title, seo_description, voice_description, vendor, product_category, product_type, tags, published, status, size, color, secondary_color, price, compare_at_price, cost_per_item, sku, barcode, inventory_quantity, weight_value, requires_shipping, continue_selling_out_of_stock, package_dimensions, parcel_size, ships_from, condition, flaws, material, era, care_instructions, measurements, model_name, model_number, size_type, style, gender, age_group, policies, renewal_options, who_made_it, what_is_it, listing_type, discounted_shipping, mpn, custom_label_0, product_group, applied_preset_id, product_images(image_url, storage_path, position, original_name)`;
                    // Paged: a 1 500-item batch used to hydrate only its first 1 000
                    // items, so 500 items silently lost every DB-backed field (F13).
                    const { rows: dbProds } = await readAllPages((from, to) => supabase
                      .from('products')
                      .select(hydrateSelect)
                      .eq('batch_id', savedBatchId)
                      .order('created_at', { ascending: true })
                      .range(from, to));
                    // If no DB products found, items haven’t been registered yet — do it now.
                    // This covers fresh uploads that haven’t been through handleImagesUploaded yet.
                    if (dbProds.length === 0) {
                      registerItemsInDB(hydratedItems, savedBatchId, session.user);
                      return;
                    }
                    log.app(`startup restore | DB hydration | merging ${dbProds.length} products into live state`);
                    // O(1) lookup maps — byId is primary (most reliable)
                    const byId    = new Map<string, any>();
                    const byTitle = new Map<string, any>();
                    const byImgUrl = new Map<string, any>();
                    for (const p of dbProds) {
                      if (p.id)       byId.set(p.id, p);
                      if (p.seo_title) byTitle.set(p.seo_title.trim(), p);
                      for (const img of (p.product_images || [])) {
                        if (img.image_url) byImgUrl.set(img.image_url, p);
                      }
                    }
                    const mergeDB = (arr: ClothingItem[]): ClothingItem[] =>
                      arr.map((item) => {
                        const p: any =
                          byId.get(item.id) ??
                          (item.seoTitle ? byTitle.get(item.seoTitle.trim()) : undefined) ??
                          (item.preview  ? byImgUrl.get(item.preview)        : undefined) ??
                          (item.imageUrls?.[0] ? byImgUrl.get(item.imageUrls[0]) : undefined);
                        // These two ran UNCONDITIONALLY, once per item per array — 4 arrays
                        // x 1 500 items = 6 000 console calls on every page restore, each
                        // building a 15-field object with .slice() calls. log.* alone is not
                        // enough: its arguments are evaluated eagerly at the call site, so the
                        // object literal would still be built with debug off. Hence the guard.
                        if (!p) {
                          if (isDebugEnabled()) log.app(`hydrate | no DB record for item ${item.id} seoTitle="${item.seoTitle ?? ''}"`);
                          return item;
                        }
                        if (isDebugEnabled()) {
                          log.app(`hydrate | MATCH ${item.id}`, {
                            p_seo_title: p.seo_title,
                            p_description_snippet: p.description?.slice(0, 60),
                            p_voice_description: p.voice_description?.slice(0, 60),
                            p_vendor: p.vendor,
                            p_size: p.size,
                            p_color: p.color,
                            p_price: p.price,
                            p_condition: p.condition,
                            p_era: p.era,
                            p_style: p.style,
                            p_gender: p.gender,
                            p_material: p.material,
                            p_measurements: p.measurements,
                          });
                        }
                        // ONE merge, shared with handleOpenBatch (lib/productRow.ts).
                        // STARTUP_MERGE_OPTIONS reproduces THIS path exactly — it
                        // differs from the open-batch path in seven documented ways
                        // (empty-string coercion, DB-group images winning, the
                        // description fallback, the 'Active'/{} defaults, and which
                        // of productGroup/originalName/appliedPresetId it sets).
                        const merged = mergeProductRowIntoItem(item, p, htmlDescToPlain, STARTUP_MERGE_OPTIONS);
                        // ── Report 16 tripwire ────────────────────────────────
                        // "Random images upside down at the dictation step" is a
                        // rotation applied TWICE: once baked into the stored file
                        // by saveProductToDatabase's createTransformedFile, once
                        // by the `rotate(Ndeg)` CSS on the card/preview. It can
                        // only happen when a restored item still declares a
                        // rotation AND is now pointing at a file it did not point
                        // at before the merge. 'own-image-wins' makes that
                        // impossible for any item with a storagePath; this line
                        // catches the legacy remainder (no storagePath, so the
                        // DB list is still the only source) in the field.
                        if (merged.imageRotation && merged.preview !== item.preview) {
                          log.img(`[rot] item ${item.id} kept rotation ${merged.imageRotation}° but its image CHANGED in the DB merge `
                            + `(${item.preview || 'none'} → ${merged.preview}) — storagePath=${item.storagePath ?? 'NONE'}. `
                            + `If this photo looks upside down, this is why.`);
                        }
                        return merged;
                      });
                    setUploadedImages(prev => mergeDB(prev));
                    setGroupedImages(prev => mergeDB(prev));
                    setSortedImages(prev => mergeDB(prev));
                    setProcessedItems(prev => mergeDB(prev));
                    log.app(`startup restore | DB hydration done`);
                  } catch (e) {
                    log.app(`startup restore | DB hydration error: ${e}`);
                  }
                })();

                // Auto-rescan EXIF for items missing capturedAt (old batches uploaded before ac06e11).
                // Fire-and-forget — runs after state is set and UI is visible.
                // SAFETY CAP: skip rescan for large batches — downloading full-res images for 400+
                // items freezes the browser. 30 is a safe limit; dates are non-critical sort hints.
                const missingDate = hydratedItems.filter((i: any) => !i.capturedAt && (i.imageUrls?.[0] || i.thumbnailUrl || i.preview));
                if (missingDate.length > 0 && missingDate.length <= 30) {
                  log.app(`startup restore | auto-EXIF rescan | ${missingDate.length} items missing capturedAt`);
                  (async () => {
                    const { default: exifr } = await loadExifr();
                    const updatedMap = new Map<string, number>();
                    // 5 bounds CONCURRENT image downloads, not URL length.
                    for (const chunk of chunked(missingDate, 5)) {
                      await Promise.all(chunk.map(async (item: any) => {
                        const url = item.imageUrls?.[0] || item.thumbnailUrl || item.preview || '';
                        if (!url) return;
                        try {
                          const resp = await fetch(url);
                          if (!resp.ok) return;
                          const blob = await resp.blob();
                          const f = new File([blob], 'img.jpg', { type: blob.type });
                          const exif = await exifr.parse(f, ['DateTimeOriginal']);
                          if (exif?.DateTimeOriginal instanceof Date) {
                            updatedMap.set(item.id, exif.DateTimeOriginal.getTime());
                          }
                        } catch { /* non-fatal */ }
                      }));
                    }
                    if (updatedMap.size > 0) {
                      log.app(`startup restore | auto-EXIF rescan done | updated=${updatedMap.size}`);
                      const patch = (arr: ClothingItem[]) =>
                        arr.map(i => updatedMap.has(i.id) ? { ...i, capturedAt: updatedMap.get(i.id) } : i);
                      setUploadedImages(prev => patch(prev));
                      setGroupedImages(prev => patch(prev));
                      setSortedImages(prev => patch(prev));
                      setProcessedItems(prev => patch(prev));
                      // Auto-save AFTER the setters, never inside an updater (finding 14):
                      // updaters must be pure and StrictMode double-invokes them, which
                      // wrote the localStorage backup twice and reset the 2 s debounce twice.
                      // liveArrayRef `.current` is already fresh here (store, not render).
                      autoSaveWorkflow({
                        uploadedImages: uploadedImagesRef.current,
                        groupedImages: groupedImagesRef.current,
                        sortedImages: sortedImagesRef.current,
                        processedItems: processedItemsRef.current,
                      });
                    }
                  })();
                }
              }
            } else {
              // workflow_state is null (batch row exists but has never been auto-saved,
              // e.g. user refreshed within the first 2s after uploading). Check the
              // instant localStorage backup written by autoSaveWorkflow.
              {
                const backup = readWorkflowBackup(
                  localStorage.getItem(WORKFLOW_BACKUP_KEY), savedBatchId,
                );
                if (backup) {
                  log.app(`startup restore | workflow_state null — using localStorage backup (${backup.items.length} items, saved ${Math.round((Date.now() - backup.savedAt) / 1000)}s ago)`);
                  const backupItems = (backup.items as any[]).map((item: any) => {
                    const canonical = publicImageUrl(item.storagePath);
                    const imageUrls = canonical ? [canonical] : (item.imageUrls?.length ? item.imageUrls : []);
                    const preview = canonical || (item.preview?.startsWith('blob:') ? '' : (item.preview || ''));
                    const thumbnailUrl = thumbnailImageUrl(item.storagePath) || imageUrls[0] || '';
                    return { ...item, preview, imageUrls, thumbnailUrl };
                  });
                  setUploadedImages(backupItems);
                  setGroupedImages(backupItems);
                  setSortedImages(backupItems);
                  setProcessedItems(backupItems);
                  setPhoneStep(resumeStep(processedItemsRef.current));
                  registerItemsInDB(backupItems, savedBatchId, session.user);
                }
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
      startupRestoreInFlight = false;
    });

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      log.auth(`onAuthStateChange | user=${session?.user?.email ?? 'signed out'}`);
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Resolve the user's workspace once per sign-in. If the tenancy migration
  // hasn't been run, ensureOrganization returns legacy mode and currentOrg
  // stays null — no org UI renders and the app behaves exactly as before.
  useEffect(() => {
    if (!user) { setCurrentOrg(null); setActiveView('home'); setBetaWaitlist(null); clearAnalyticsContext(); clearErrorContext(); return; }
    let cancelled = false;
    ensureOrganization(user).then(res => {
      if (cancelled) return;
      // Records WHICH user's workspace is resolved, so the pageview effect can
      // wait for it (betaWaitlist === null is ambiguous: it means both "not
      // waitlisted" and "not resolved yet"). Set here, never reset — it is only
      // ever compared against the current user's id. (finding 19)
      setOrgResolvedFor(user.id);
      if (res.mode === 'org') {
        setCurrentOrg(res.org);
        setOrgRole(res.role);
        setBetaWaitlist(null);
        // Per-workspace description format (defaults if the migration or the
        // setting doesn't exist yet)
        getOrgDescriptionSettings(res.org.id).then(s => {
          if (!cancelled) setOrgDescSettings(s);
        });
        // First-party analytics: events from here on carry the user + workspace.
        setAnalyticsContext({ userId: user.id, orgId: res.org.id });
        setErrorContext({ userId: user.id, orgId: res.org.id });
      } else if (res.mode === 'waitlist') {
        setCurrentOrg(null);
        setBetaWaitlist(res.betaStatus);
        setAnalyticsContext({ userId: user.id, orgId: null });
        setErrorContext({ userId: user.id, orgId: null });
      } else {
        setCurrentOrg(null);
        setBetaWaitlist(null);
        setAnalyticsContext({ userId: user.id, orgId: null });
        setErrorContext({ userId: user.id, orgId: null });
      }
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // First-party analytics: one pageview per top-level view change (landing →
  // auth → waitlist → app; the app has no router). Must stay ABOVE the early
  // returns below so the hook order never changes.
  // Depends on user?.id, NOT the user object: onAuthStateChange hands us a fresh
  // object on every hourly TOKEN_REFRESHED, which re-fired this effect and logged a
  // duplicate pageview per tab per hour. It also used to fire before the workspace
  // bootstrap resolved, recording 'app' and then 'waitlist' for every waitlisted
  // sign-in. (finding 19)
  const signedInUserId = user?.id;
  useEffect(() => {
    if (loading) return;
    if (signedInUserId && orgResolvedFor !== signedInUserId) return;
    const view = !signedInUserId ? (showLogin ? 'auth' : 'landing') : betaWaitlist ? 'waitlist' : 'app';
    // setErrorContext is a plain module function, not setState — effect-safe.
    setErrorContext({ view });
    trackPageview(view);
  }, [loading, signedInUserId, orgResolvedFor, showLogin, betaWaitlist]);

  /* The setup checklist's one un-observable fact: whether this person has
     LOOKED at their categories or presets. It is recorded HERE rather than on
     the checklist's own buttons because the workspace menu, the Tools grid and
     a keyboard walk all reach those pages too, and a step that only ticks when
     you arrive by one particular door is a step that never ticks.

     Per workspace, cosmetic, localStorage-backed and wrapped — losing it just
     shows the checklist again (AGENTS.md §1). */
  const resolvedOrgId = currentOrg?.id ?? null;
  useEffect(() => {
    if (!resolvedOrgId) return;
    if (activeView === 'categories') writeOnboardingLocal(resolvedOrgId, { visitedCategories: true });
    else if (activeView === 'presets') writeOnboardingLocal(resolvedOrgId, { visitedPresets: true });
  }, [activeView, resolvedOrgId]);

  const handleSignOut = async () => {
    log.auth('handleSignOut');
    await supabase.auth.signOut();
    // Drop every cached tenant image from shared Cache Storage: the SW cache is
    // keyed by URL only, so without this the next person on the machine can still
    // pull the previous workspace's photos (security audit 05, finding #21).
    await purgeImageCache();
    clearAnalyticsContext();
    clearErrorContext();
    // Support threads are per-account: drop them so the next person to sign in
    // on this machine never sees a flash of the previous one's conversations.
    supportStore.reset();
    // Same reasoning: the save indicator must not carry one account's state into
    // the next sign-in on the same machine.
    saveStatus.reset();
    setUser(null);
    setCurrentOrg(null);
    setActiveView('home');
    // Reset all data
    setUploadedImages([]);
    setSortedImages([]);
    setGroupedImages([]);
    setProcessedItems([]);
    localStorage.removeItem('sortbot_current_batch_id');
    localStorage.removeItem('sortbot_current_batch_number');
  };

  /**
   * Prune stale `products` rows for a batch.
   * Strategy: fetch current DB ids for the batch, diff against keepIds,
   * then delete only the orphans in chunks of 100.
   * This avoids a giant NOT IN(...) clause that hits PostgREST's URL-length 400 limit.
   */
  const pruneStaleProducts = async (batchId: string, keepIds: string[]) => {
    const keepSet = new Set(keepIds);
    // Paged — unpaginated this saw at most 1 000 of the batch's rows, so stale rows
    // beyond that were never diffed and never pruned (F13).
    const { rows: dbRows, error: fetchErr } = await readAllPages((from, to) => supabase
      .from('products')
      .select('id')
      .eq('batch_id', batchId)
      .order('created_at', { ascending: true })
      .range(from, to));
    if (fetchErr) {
      console.warn('[App] pruneStaleProducts | fetch error:', fetchErr.message);
      return;
    }
    const staleIds = dbRows.map(r => r.id).filter(id => !keepSet.has(id));
    if (staleIds.length === 0) return;
    for (const chunk of chunked(staleIds)) {
      const { error: delErr } = await supabase
        .from('products')
        .delete()
        .in('id', chunk);
      if (delErr) console.warn('[App] pruneStaleProducts | delete error:', delErr.message);
    }
  };

  const handleSaveBatch = async () => {
    if (!user || processedItems.length === 0) {
      alert('No products to save!');
      return;
    }
    log.app(`handleSaveBatch | items=${processedItems.length} batchId=${currentBatchId}`);

    setSaving(true);
    setSaveMessage(null);
    saveStatus.begin();

    try {
      // Pass the currentBatchId so products are linked to the workflow batch
      const result = await saveBatchToDatabase(processedItems, user.id, currentBatchId);

      if (result.success > 0) {
        // A partial save is NOT a clean save — the indicator must say so.
        if (result.failed > 0) saveStatus.end(false, `${result.failed} product(s) failed to save.`);
        else saveStatus.end(true);
        setSaveMessage({
          type: 'success',
          text: `Saved ${result.success} product(s)${result.failed > 0 ? `, ${result.failed} failed` : ''}!`,
        });

        // products/product_images rows were just written — prune stale rows then refresh Library
        if (currentBatchId) {
          await pruneStaleProducts(currentBatchId, processedItems.map(i => i.id));
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
        saveStatus.end(false, 'Failed to save products.');
        setSaveMessage({
          type: 'error',
          text: 'Failed to save products. Please try again.',
        });
      }
    } catch (error) {
      console.error('Save error:', error);
      saveStatus.end(false, error instanceof Error ? error.message : 'An error occurred while saving.');
      setSaveMessage({
        type: 'error',
        text: 'An error occurred while saving.',
      });
    } finally {
      setSaving(false);
    }
  };

  /**
   * PUT THE BATCH DOWN. Clears the four store arrays, detaches the session from
   * its batch id and cancels every pending debounced write — WITHOUT a
   * `window.confirm`, so a caller that has already asked (the home dashboard's
   * two-step ConfirmAction) does not ask twice, and Do Not #12 is respected on
   * the new surface. The batch ROW survives; only this session detaches, which
   * is why the pending auto-save is FLUSHED rather than dropped.
   *
   * `handleClearBatch` below is this plus the Step-4 button's own confirm.
   */
  const startNewBatch = () => {
    log.app(`startNewBatch | items=${uploadedImages.length} batchId=${currentBatchId}`);
    setProcessedItems([]);
    setGroupedImages([]);
    setSortedImages([]);
    setUploadedImages([]);
    setPhoneStep(1);
    setSaveMessage(null);
    // Clear persisted batch so reload starts fresh
    currentBatchIdRef.current = null;
    setCurrentBatchId(null);
    setCurrentBatchNumber(`batch-${Date.now()}`);
    localStorage.removeItem('sortbot_current_batch_id');
    localStorage.removeItem('sortbot_current_batch_number');
    // Reset upload-session state so the next file drop gets a fresh batch row
    batchRowInsertedRef.current = false;
    isUploadingRef.current = false;
    pendingChunkRef.current = [];
    if (chunkTimerRef.current) { clearTimeout(chunkTimerRef.current); chunkTimerRef.current = null; }
    // Same reason handleOpenBatch drops it: this timer's callback prunes
    // products rows for whatever batch is current when it FIRES.
    if (groupUpsertTimerRef.current) { clearTimeout(groupUpsertTimerRef.current); groupUpsertTimerRef.current = null; }
    // The batch ROW survives a clear (only the session detaches), so the last
    // few seconds of edits are still worth writing — flush, don't drop.
    flushPendingAutoSave();
    if (autoSaveTimerRef.current) { clearTimeout(autoSaveTimerRef.current); autoSaveTimerRef.current = null; }
    // No batch left to save — don't leave a stale 'saved'/'error' on the indicator.
    saveStatus.reset();
  };

  /** The Step-4 "Clear Batch" button: the same teardown, behind its own confirm. */
  const handleClearBatch = () => {
    if (confirm('Are you sure you want to clear this batch? Unsaved products will be lost.')) {
      startNewBatch();
    }
  };

  // Called by Library after a batch is successfully deleted. If it was the ACTIVE
  // batch, tear the session down completely: cancel pending debounced saves and
  // drop all in-memory items. Without this, the still-loaded session auto-saves
  // the deleted batch's content right back into the DB (the "deleted batch
  // returns" bug) — the service-level tombstone blocks the write, but the UI
  // would still show a batch that no longer exists.
  const handleBatchDeleted = (batchId: string) => {
    const isActive = batchId === currentBatchIdRef.current;
    log.app(`handleBatchDeleted | batchId=${batchId} active=${isActive}`);
    // A batch delete removes its storage files, so the cached meter number is
    // stale whether or not the deleted batch was the active one — re-read it
    // (one RPC now, not a 2 500-call walk).
    if (user) void fetchStorageUsage(user.id, true);
    if (!isActive) return;
    if (autoSaveTimerRef.current) { clearTimeout(autoSaveTimerRef.current); autoSaveTimerRef.current = null; }
    if (groupUpsertTimerRef.current) { clearTimeout(groupUpsertTimerRef.current); groupUpsertTimerRef.current = null; }
    if (chunkTimerRef.current) { clearTimeout(chunkTimerRef.current); chunkTimerRef.current = null; }
    // DROPPED, never flushed: the row is gone, and firing the pending save is
    // exactly the "deleted batch comes back" bug. (The service tombstone would
    // refuse the write anyway; this keeps the intent visible at the call site.)
    pendingAutoSaveFireRef.current = null;
    pendingChunkRef.current = [];
    isUploadingRef.current = false;
    batchRowInsertedRef.current = false;
    currentBatchIdRef.current = null;
    setCurrentBatchId(null);
    setCurrentBatchNumber(`batch-${Date.now()}`);
    // Cancel BEFORE the removeItem: a queued throttled write landing afterwards
    // would put the deleted batch's backup straight back (the "deleted batch
    // returns" bug, via a different door).
    cancelWorkflowBackup();
    localStorage.removeItem('sortbot_current_batch_id');
    localStorage.removeItem('sortbot_current_batch_number');
    localStorage.removeItem(WORKFLOW_BACKUP_KEY);
    // The batch is gone — a leftover 'saving'/'error' on the indicator would be
    // about a batch that no longer exists.
    saveStatus.reset();
    setUploadedImages([]);
    setGroupedImages([]);
    setSortedImages([]);
    setProcessedItems([]);
    setPhoneStep(1);
  };

  /* ── Stable props for the memoized workflow children (perf finding F2) ──────
   * Steps 1-4 are sections of ONE page and all mount simultaneously, and App
   * subscribes to all four store arrays plus `toasts`, `storageInfo`,
   * `saveMessage`, `selectedGroupItems` and `grouperActions`. So before this,
   * a single keystroke in a Step-3 field re-rendered the 1 500-card Step-2 grid,
   * CategoryZones AND the 54-column export preview — every callback prop was a
   * fresh inline arrow and every list prop a fresh array, so `React.memo` could
   * not have bailed out even if it had been there.
   *
   * Everything below is referentially constant for the life of the component;
   * `useEventCallback` guarantees each one still runs the newest closure. */
  // The handlers themselves are declared further down the component body (after the
  // early `loading`/`!user` returns, where no hook may go), so each wrapper calls
  // through a thin arrow — resolved at call time, which is always post-mount.
  const onGroupedStable         = useEventCallback((items: ClothingItem[]) => handleImagesGrouped(items));
  const onCategorizedStable     = useEventCallback((items: ClothingItem[]) => handleImagesSorted(items));
  const onProcessedStable       = useEventCallback((items: ClothingItem[]) => handleItemsProcessed(items));
  const onStatsChangeStable     = useEventCallback(() => {});   // stats come from processedItems now
  const onImageDeletedStable    = useEventCallback(() => setLibraryRefreshTrigger(prev => prev + 1));
  const onCategoryAssignedStable = useEventCallback(() => {
    setSelectedGroupItems(new Set());
    grouperActionsRef.current?.onCategoryAssigned();
  });
  const onDownloadCSVStable     = useEventCallback(() => exporterRef.current?.downloadCSV());
  const onLibraryCloseStable    = useEventCallback(() => setShowLibrary(false));
  const onOpenBatchStable       = useEventCallback((batch: WorkflowBatch) => handleOpenBatch(batch));
  const onBatchDeletedStable    = useEventCallback((batchId: string) => handleBatchDeleted(batchId));
  const onToastStable           = useEventCallback((msg: string) => addToast(msg));
  /* ── Home dashboard ──────────────────────────────────────────────────────
     Resume is a REVEAL, not a re-open: the workflow has been mounted the whole
     time behind `hidden`, so this only decides which step the phone shows and
     un-parks <main>. Nothing is fetched and nothing is rebuilt. */
  const onHomeResumeStable = useEventCallback((step: WorkflowStep) => {
    goToPhoneStep(step);
    setActiveView('workflow');
  });
  /* The home widget has already asked, with a two-step ConfirmAction — so this
     goes to the confirm-free half of the teardown, not to handleClearBatch. */
  const onStartNewBatchStable = useEventCallback(() => startNewBatch());
  const onHomeNavigateStable  = useEventCallback((id: string) => setActiveView(id as ActiveView));
  /* Opening a batch from Home must also LEAVE Home. `handleOpenBatch` ends in
     `setShowLibrary(false)`, which only returns to the workflow when the
     Library is the view actually showing — from here it is a no-op, and the
     user would sit on the dashboard watching nothing happen. Switched first so
     the workflow is on screen while the (async) open runs; handleOpenBatch
     sets the step itself, from `resumeStep`. */
  const onHomeOpenBatchStable = useEventCallback((batch: WorkflowBatch) => {
    setActiveView('workflow');
    void handleOpenBatch(batch);
  });
  /* The Workspace dashboard's one link out to the founder half, and Home's
     founder widget. Stable for the same reason as everything else here. */
  const onOpenFounderStable = useEventCallback(() => setActiveView('founder'));
  /* Step 4's marketplaces panel → the Workspace dashboard, on its Marketplaces
     tab. Stable, because the panel is memo'd (§18 #24). */
  const onOpenWorkspaceMarketplaces = useEventCallback(() => {
    setWorkspaceTab('marketplaces');
    setActiveView('workspace');
  });

  /* The listing a scan asked for, handed to PDG for one render and then cleared.
     It has to be cleared: PDG focuses on a CHANGE of the prop, so if the id stuck
     around, scanning the same label again after navigating away with Next would
     pass an unchanged value and do nothing. Clearing makes every scan a
     null → id transition. */
  const [focusListingId, setFocusListingId] = useState<string | null>(null);

  /* Scanned or printed label → the listing, for LabelPrintView and
     BarcodeScannerView.

     A scan identifies a `products` row; Step 3 navigates by GROUP INDEX. PDG now
     takes `focusProductId` and maps the id through buildGroupArray to that
     index, so this both scrolls Step 3 into view AND selects the listing.

     What it refuses to do is pretend. If the scanned product is not in the open
     batch, scrolling to Step 3 would park the user on an unrelated listing and
     look like a successful jump — so we say where it actually is instead. The
     live store view is read (never the render-captured array) per §14. */
  const openListingInStep3 = useEventCallback((productId: string, batchId?: string | null) => {
    const items = processedItemsRef.current;
    const inOpenBatch = items.some(i => i.id === productId || i.productGroup === productId);
    if (inOpenBatch) {
      setActiveView('workflow');
      setFocusListingId(productId);
      // Deferred: the workflow is parked behind `hidden` until this render
      // commits, and scrolling to a hidden element is a no-op.
      requestAnimationFrame(() => {
        document.getElementById('step-3')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        // PDG's focus effect has already run for this commit; release the id so the
        // next scan is a fresh transition (see the note on the state above).
        setFocusListingId(null);
      });
      return;
    }
    /* Not in the open batch. When the caller knows which batch it IS in — the
       Products view reads it off the row, the scanner off the matched product —
       open that batch and land on the listing. This is what §14 #45 used to
       refuse to do; refusing was right only while the batch was unknown, because
       jumping to Step 3 anyway parks the user on an unrelated listing. */
    if (batchId) { void openProductInWorkflow(batchId, productId); return; }
    addToast('That listing is not in a batch yet, so there is nothing to open — it will appear once its batch is saved.');
  });

  /**
   * Open another batch and land on one listing inside it.
   *
   * Sequenced, not fired-and-forgotten: `handleOpenBatch` repopulates the four
   * store arrays, and PDG is keyed on `currentBatchId`, so the focus id is only
   * meaningful once that has happened. It is released on a timer rather than the
   * next frame because the remount plus the group rebuild take more than one —
   * and PDG's focus effect re-runs on `groupArray`, so leaving the id set for a
   * moment lets a late hydration land on the right listing instead of listing 1.
   */
  const openProductInWorkflow = useEventCallback(async (batchId: string, productId: string) => {
    if (batchId === currentBatchIdRef.current) { openListingInStep3(productId); return; }
    setActiveView('workflow');
    const batch = await getWorkflowBatch(batchId);
    if (!batch) {
      addToast('That batch could not be opened — it may have been deleted.');
      return;
    }
    await handleOpenBatch(batch);
    setFocusListingId(productId);
    requestAnimationFrame(() => {
      document.getElementById('step-3')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    window.setTimeout(() => setFocusListingId(null), 1200);
  });

  /**
   * A Products-view save landed in the database; mirror it into memory.
   *
   * ONLY when that listing's batch is the one open — otherwise there is nothing
   * in the store to correct, and patching by group id alone could touch a
   * same-id row from another batch. The Products view never writes the store
   * itself (it would be a third writer racing Step 3's two debounced saves); it
   * writes `products` through the same syncGroupFieldsToDatabase Step 3 uses and
   * then tells App, which is the one place that owns these arrays.
   *
   * No auto-save is triggered: the fields patched here are all DB-recoverable and
   * none of them is in the slimForWorkflowState whitelist, so `workflow_state`
   * has nothing to say about them.
   */
  const handleListingEdited = useEventCallback(
    (batchId: string | null, groupId: string, patch: Partial<ClothingItem>) => {
      if (!batchId || batchId !== currentBatchIdRef.current) return;
      const apply = (list: ClothingItem[]) => {
        let touched = false;
        const next = list.map(item => {
          if ((item.productGroup || item.id) !== groupId) return item;
          touched = true;
          return { ...item, ...patch };
        });
        return touched ? next : list;
      };
      setUploadedImages(apply);
      setGroupedImages(apply);
      setSortedImages(apply);
      setProcessedItems(apply);
    },
  );

  // Step 2's list: both branches are store arrays whose identity is already stable
  // between store updates, so naming it is enough — no new array per render.
  const step2Items = groupedImages.length > 0 ? groupedImages : uploadedImages;

  // Step 4's list was an inline IIFE, i.e. a brand-new array on every App render,
  // which alone defeated any memo on the exporter and re-ran its whole
  // group/coalesce/dedup/54-column-preview pipeline. Same filter, memoized.
  const step4ExportItems = useMemo(() => {
    const groupCounts: Record<string, number> = {};
    processedItems.forEach(i => { const k = i.productGroup || i.id; groupCounts[k] = (groupCounts[k] || 0) + 1; });
    return processedItems.filter(i => i.category || groupCounts[i.productGroup || i.id] > 1);
  }, [processedItems]);

  // SupportWidget's props: primitives, but derived — memoize the two computed ones
  // so the value is stable while `currentOrg`/`orgRole` are unchanged.
  const supportIsFounder = currentOrg?.slug === 'founding' && (orgRole === 'owner' || orgRole === 'admin');
  const supportOrgName = currentOrg?.name ?? null;

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="spinner"></div>
        <p>Loading...</p>
      </div>
    );
  }

  if (!user) {
    // Marketing landing is the front door; Auth only when "Log in" is clicked.
    if (!showLogin) {
      return <Landing onLoginClick={() => setShowLogin(true)} />;
    }
    return (
      <div style={{ position: 'relative' }}>
        <button
          onClick={() => setShowLogin(false)}
          style={{
            position: 'absolute',
            /* max() against the notch: on a phone this is the only control
               above the card, and it must not land under the status bar. */
            top: 'max(16px, env(safe-area-inset-top, 0px))',
            left: 'max(16px, env(safe-area-inset-left, 0px))',
            zIndex: 10,
            background: 'var(--ink-800)', border: '1px solid var(--border-control)',
            borderRadius: 8, padding: '8px 16px', fontSize: 'var(--fs-lg)', fontWeight: 700,
            /* 8px of padding on an 18px label is a 40px control — under the
               44px touch floor this pass holds everything to. */
            minHeight: 44,
            color: 'var(--text-primary)', cursor: 'pointer',
          }}
        >
          ← Back
        </button>
        <Auth onAuthenticated={() => {}} />
      </div>
    );
  }

  // Private beta gate — signed in but not approved: waitlist screen, no dashboard.
  if (betaWaitlist) {
    return (
      <>
        <WaitlistGate
          status={betaWaitlist}
          email={user.email ?? ''}
          onSignOut={handleSignOut}
          onRequested={() => setBetaWaitlist('pending')}
        />
        {/* Waitlisted users can still message the founders. */}
        <SupportWidget userEmail={user.email ?? null} orgName={null} isFounder={false} />
      </>
    );
  }

  const handleImagesUploaded = async (items: ClothingItem[]) => {
    // Upload is complete — allow handleImagesGrouped to resume normal operation
    // from this point onward (user-initiated or final-sync calls).
    isUploadingRef.current = false;
    log.upload(`handleImagesUploaded | newItems=${items.length} totalAfter=${uploadedImagesRef.current.length + items.length}`);
    // onChunkReady already appended each item progressively — deduplicate using the ref
    // (always current) so we don't double-add anything now that all chunks are done.
    const existingIds = new Set(uploadedImagesRef.current.map(i => i.id));
    const brandNew = items.filter(i => !existingIds.has(i.id));
    const newImages = [...uploadedImagesRef.current, ...brandNew];
    setUploadedImages(newImages);
    // Phone: the one auto-advance. Step 2 has just become reachable and there is
    // nothing left to do in Step 1, so carry the user across. Deliberately NOT
    // done for 2 → 3 or 3 → 4: Step 3 becomes reachable the moment the first
    // category is assigned, and yanking someone out of the grid mid-grouping is
    // exactly the wrong move. Those are the Continue tap.
    setPhoneStep(s => (s === 1 ? 2 : s));

    // Ensure we have a batch ID. handleChunkReady mints it on the first chunk so that
    // ImageGrouper's batchId prop is stable during the upload and no group-wipe fires.
    // If somehow we arrive here without one (e.g. very small upload that races past
    // handleChunkReady), mint it now.
    if (!currentBatchIdRef.current) {
      const newBatchId = crypto.randomUUID();
      currentBatchIdRef.current = newBatchId;
      setCurrentBatchId(newBatchId);
      localStorage.setItem('sortbot_current_batch_id', newBatchId);
    }

    // Pre-insert the workflow_batches row exactly once per upload session.
    // autoSaveWorkflowBatch uses a blind UPDATE — it needs this row to exist.
    // Without the guard, a session where handleChunkReady already minted the ID
    // would skip insertion and autoSave would silently drop all state.
    if (!batchRowInsertedRef.current && user) {
      batchRowInsertedRef.current = true;
      await supabase.from('workflow_batches').insert({
        id: currentBatchIdRef.current,
        user_id: user.id,
        batch_number: currentBatchNumber,
        current_step: 1,
        total_images: 0,
        product_groups_count: 0,
        categorized_count: 0,
        processed_count: 0,
        workflow_state: { uploadedImages: [], groupedImages: [], sortedImages: [], processedItems: [] },
      });
      log.app(`handleImagesUploaded | pre-inserted batch row | batchId=${currentBatchIdRef.current}`);
      track('Batch Created');
    }
    
    // If there are already grouped images, append to those too.
    // Build the updated array explicitly so we can pass it to autoSaveWorkflow.
    // IMPORTANT: read from refs, not closure values — if the batch was just opened
    // from the Library, React may not have committed the new state yet before the
    // upload callback fires, and the closure would still see empty arrays.
    const liveGrouped   = groupedImagesRef.current;
    const liveSorted    = sortedImagesRef.current;
    const liveProcessed = processedItemsRef.current;
    let newGrouped  = liveGrouped;
    let newSorted   = liveSorted;
    let newProcessed = liveProcessed;
    if (liveGrouped.length > 0) {
      // handleChunkReady already appended each chunk to groupedImages progressively.
      // Dedup against liveGrouped so we don't double-add items that arrived via chunks.
      const alreadyGroupedIds = new Set(liveGrouped.map(i => i.id));
      const groupedBrandNew = brandNew.filter(i => !alreadyGroupedIds.has(i.id));
      if (groupedBrandNew.length > 0) {
        newGrouped   = [...liveGrouped,   ...groupedBrandNew];
        setGroupedImages(newGrouped);
        newSorted    = [...liveSorted,    ...groupedBrandNew];
        newProcessed = [...liveProcessed, ...groupedBrandNew];
        setSortedImages(newSorted);
        setProcessedItems(newProcessed);
      } else {
        // All items already streamed in — just sync the computed refs for autoSave
        newGrouped   = liveGrouped;
        newSorted    = liveSorted;
        newProcessed = liveProcessed;
      }
    }
    
    // Auto-save workflow state (Step 1 complete)
    autoSaveWorkflow({
      uploadedImages: newImages,
      groupedImages:  newGrouped,
      sortedImages:   newSorted,
      processedItems: newProcessed,
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
          status: 'Active',
          product_group: item.productGroup || item.id,
        })),
        { onConflict: 'id', ignoreDuplicates: true }
      );
      // Upsert product_images rows; ignore duplicate rows (already uploaded)
      // Stage 4 dual-write: same shared row builder as registerItemsInDB.
      const stage4Upload = await stage4ColumnsAvailable();
      const { error: imgErr2 } = await supabase.from('product_images').upsert(
        // position 0 — one image per product here, so the array index was meaningless.
        uploadedItems.map(item =>
          buildProductImageRow(item, user.id, 0, item.imageUrls![0], stage4Upload)
        ),
        // ignoreDuplicates: true — never overwrite/conflict with registerItemsInDB's
        // delete-then-insert strategy. This write is best-effort to keep the Library
        // in sync immediately; the authoritative write is in registerItemsInDB.
        { onConflict: 'product_id,image_url', ignoreDuplicates: true }
      );
      if (imgErr2) {
        console.warn('[App] upload | product_images upsert error:', imgErr2.message, imgErr2.code);
      }
      // Refresh Library immediately — images are now in the DB
      setLibraryRefreshTrigger(prev => prev + 1);

      // Toast: "N images uploaded"
      const totalCount = uploadedImages.length + items.length;
      addToast(`${totalCount} image${totalCount !== 1 ? 's' : ''} uploaded`);

      // Refresh storage meter after new upload — `force`, because this tab is
      // exactly what made the cached number stale.
      fetchStorageUsage(user.id, true);
    }
  };

  /**
   * Called by ImageUpload after an EXIF rescan completes.
   * `updatedItems` is a full replacement of the current batch's items with
   * corrected `capturedAt` values. We patch all four workflow arrays (by id)
   * so the sort order in Step 2 reflects the real shot times, then autosave
   * so the corrected timestamps survive a page reload.
   */
  const handleCapturedAtUpdated = (updatedItems: ClothingItem[]) => {
    const byId = new Map(updatedItems.map(i => [i.id, i]));
    const patch = (arr: ClothingItem[]) =>
      arr.map(item => byId.has(item.id) ? { ...item, capturedAt: byId.get(item.id)!.capturedAt } : item);

    const newUploaded   = patch(uploadedImages);
    const newGrouped    = patch(groupedImages);
    const newSorted     = patch(sortedImages);
    const newProcessed  = patch(processedItems);

    setUploadedImages(newUploaded);
    setGroupedImages(newGrouped);
    setSortedImages(newSorted);
    setProcessedItems(newProcessed);

    autoSaveWorkflow({
      uploadedImages: newUploaded,
      groupedImages: newGrouped,
      sortedImages: newSorted,
      processedItems: newProcessed,
    });

    log.upload(`handleCapturedAtUpdated | patched ${updatedItems.length} items across all 4 arrays`);
  };

  const handleImagesSorted = async (items: ClothingItem[]) => {
    log.app(`handleImagesSorted | items=${items.length} categories=${[...new Set(items.map(i => i.category).filter(Boolean))].join(', ')}`);
    setSortedImages(items);
    // Also update groupedImages so Step 2 shows the categories
    setGroupedImages(items);
    
    // Sync categories AND productGroup to processedItems (preserve voice descriptions if they exist)
    // IMPORTANT: read from processedItemsRef (not the processedItems closure) so we always
    // merge against the latest state, even when handleImagesSorted is called in rapid succession
    // (e.g. applying presets to multiple groups back-to-back).
    const liveProcessed = processedItemsRef.current;
    let finalProcessed: ClothingItem[];
    if (liveProcessed.length > 0) {
      // O(1) map — avoids O(n²) .find() inside .map() for large batches
      const sortedMap = new Map(items.map(i => [i.id, i]));
      // Update existing processedItems with the full preset-applied sorted item, but
      // preserve any user-entered fields (voice descriptions, manually typed values)
      // by re-overlaying non-nullish values from the existing procItem on top.
      // This means: preset fields always come through from sortedItem, but anything
      // the user already typed/spoke takes precedence (same || priority as applyPresetFields).
      finalProcessed = liveProcessed.map(procItem => {
        const sortedItem = sortedMap.get(procItem.id);
        if (sortedItem) {
          // Start from the preset-enriched sortedItem, then re-apply user-entered
          // overrides from procItem (only if they actually have a value).
          const userOverrides: Partial<ClothingItem> = {};
          const userFields: (keyof ClothingItem)[] = [
            // User-entered / voice fields
            'voiceDescription', 'generatedDescription', 'size', 'brand', 'color',
            'secondaryColor', 'material', 'condition', 'era', 'modelName',
            'modelNumber', 'seoTitle', 'seoDescription', 'tags', 'price',
            'compareAtPrice', 'costPerItem', 'sku', 'measurements', 'style',
            'care',
            // Preset-applied fields — must be preserved so re-categorization doesn't wipe them.
            // applyPresetFields writes all of these; without them in the whitelist,
            // handleImagesSorted rebuilds processedItems from sortedItem (no preset data)
            // and the PDG reset effect receives items without preset fields → preset gone.
            'policies', 'shipsFrom', 'gender', 'whoMadeIt', 'whatIsIt', 'listingType',
            'discountedShipping', 'renewalOptions', 'productType', 'shopifyProductType',
            'sizeType', 'ageGroup', 'weightValue', 'packageDimensions', 'parcelSize',
            'continueSellingOutOfStock', 'requiresShipping', 'barcode', 'inventoryQuantity',
            'customLabel0', 'mpn', 'taxCode', 'status', 'published', '_presetData',
          ];
          userFields.forEach(field => {
            const v = procItem[field];
            if (v !== undefined && v !== null && v !== '') {
              (userOverrides as any)[field] = v;
            }
          });
          return {
            ...sortedItem,
            ...userOverrides,
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

    // Upsert category + group changes to products table immediately so Library reflects them
    // We upsert ALL items (not just those with category) so productGroup reassignments
    // from the category-click merge path are also persisted to the DB.
    if (user && currentBatchId) {
      const registerable = items.filter(i => i.imageUrls?.[0] || i.storagePath);
      if (registerable.length > 0) {
        await supabase.from('products').upsert(
          // NO batch_id (finding 6 / AGENTS.md §18 #3): batch_id is assigned
          // authoritatively at upload time. Re-asserting it here with
          // ignoreDuplicates:false silently re-tags any row that belongs to
          // another batch — the batch_id theft that made gap-fill grow
          // unboundedly. user_id stays because this upsert must still be able
          // to CREATE a row (user_id is NOT NULL and RLS-checked on insert).
          registerable.map(item => ({
            id: item.id,
            product_category: item.category ?? null,
            product_group: item.productGroup || item.id,
            user_id: user.id,
          })),
          { onConflict: 'id', ignoreDuplicates: false }
        );
        setLibraryRefreshTrigger(prev => prev + 1);
      }
    }
  };

  const handleImagesGrouped = async (items: ClothingItem[]) => {
    // NOTE: We intentionally do NOT skip this during upload (isUploadingRef.current).
    // The previous guard caused all user group actions during an active upload to be
    // silently dropped — local state showed the group, but it was never persisted,
    // so a page reload lost all grouping work.  The cascade concern (onGrouped firing
    // per chunk → setGroupedImages → initializeItems loop) terminates in ≤2 iterations
    // thanks to initializeItems' dedup logic, so the guard is not needed for correctness.
    const groups = new Set(items.map(i => i.productGroup).filter(Boolean));
    log.grouper(`handleImagesGrouped | items=${items.length} groups=${groups.size}`);
    // Preserve existing categories when updating groups.
    // Read from groupedImagesRef (not groupedImages closure) so rapid calls always
    // see the latest categories, not a stale snapshot from the render that fired.
    const liveCurrent = groupedImagesRef.current;
    // O(1) lookup map — avoids O(n²) .find() inside .map() for large batches
    const liveCategoryMap = new Map(liveCurrent.filter(g => g.category).map(g => [g.id, g.category!]));
    const itemsWithCategories = items.map(item => {
      const cat = liveCategoryMap.get(item.id);
      return cat ? { ...item, category: cat } : item;
    });
    
    setGroupedImages(itemsWithCategories);

    // Keep uploadedImages in sync — remove any items that were deleted in Step 2
    const remainingIds = new Set(itemsWithCategories.map(i => i.id));
    const prunedUploaded = uploadedImagesRef.current.filter(i => remainingIds.has(i.id));
    if (prunedUploaded.length !== uploadedImagesRef.current.length) {
      setUploadedImages(prunedUploaded);
    }
    
    // Sync sortedImages by FILTERING DOWN to only IDs still in itemsWithCategories,
    // then merging in the latest grouping state. This ensures Step-2 deletes propagate
    // to Steps 3 & 4 instead of re-inflating the old full set.
    // Read from sortedImagesRef so we always merge against the LATEST sorted state,
    // not a stale closure value (critical when handleImagesSorted just ran and set
    // sortedImages, but handleImagesGrouped was already captured before that update).
    const liveSorted = sortedImagesRef.current;
    // O(1) map for grouped items lookup
    const groupedMap = new Map(itemsWithCategories.map(i => [i.id, i]));
    const updatedSorted = liveSorted
      .filter(s => remainingIds.has(s.id))
      .map(s => {
        const grouped = groupedMap.get(s.id);
        return grouped ? { ...s, ...grouped, category: s.category || grouped.category } : s;
      });
    // For items not yet in sortedImages (newly added), include them from itemsWithCategories
    const sortedIds = new Set(updatedSorted.map(s => s.id));
    const newItems = itemsWithCategories.filter(i => !sortedIds.has(i.id));
    const finalSorted = [...updatedSorted, ...newItems];

    setSortedImages(finalSorted);
    // Rebuild processedItems: merge finalSorted (updated grouping/categories) with the
    // LIVE processedItems so preset fields and user-entered data are not wiped.
    // processedItemsRef reflects any preset application done in Step 3; finalSorted
    // is derived from sortedImages which only carries structural fields (no preset data).
    const liveProcessedForGroup = processedItemsRef.current;
    // O(1) map for processed items lookup
    const processedMap = new Map(liveProcessedForGroup.map(p => [p.id, p]));
    const mergedProcessed = finalSorted.map(sortedItem => {
      const existing = processedMap.get(sortedItem.id);
      // For image URL fields, storagePath is always the authoritative source.
      // Rebuild canonical URL and thumbnailUrl from storagePath to avoid using
      // imageUrls[0] values that may have been corrupted by earlier merges.
      const sp = sortedItem.storagePath || existing?.storagePath || '';
      const canonicalUrl = publicImageUrl(sp)
        || sortedItem.imageUrls?.[0] || existing?.imageUrls?.[0] || '';
      const canonicalThumb = thumbnailImageUrl(sp) || canonicalUrl;
      const imageFields = {
        storagePath: sp || undefined,
        imageUrls:   canonicalUrl ? [canonicalUrl] : [],
        preview:     canonicalUrl,
        thumbnailUrl: canonicalThumb,
      };
      if (existing) {
        return {
          ...existing,
          productGroup:        sortedItem.productGroup        || existing.productGroup,
          category:            sortedItem.category            || existing.category,
          imageRotation:       sortedItem.imageRotation       ?? existing.imageRotation,
          crop:                sortedItem.crop                ?? existing.crop,
          // Carry originalStoragePath/originalUrl forward from sortedItem (ImageGrouper ref)
          // so that crop-paste "revert to original" survives the onGrouped merge into processedItems.
          originalStoragePath: sortedItem.originalStoragePath || existing.originalStoragePath,
          originalUrl:         sortedItem.originalUrl         || existing.originalUrl,
          ...imageFields,
        };
      }
      return { ...sortedItem, ...imageFields };
    });
    setProcessedItems(mergedProcessed);
    
    // Auto-save workflow state (Step 2 complete - groups created)
    autoSaveWorkflow({
      uploadedImages: prunedUploaded,
      groupedImages: itemsWithCategories,
      sortedImages: finalSorted,
      processedItems: mergedProcessed,
    });

    // Broadcast action for real-time collaboration

    // Debounced DB upsert: update product_group for all items in the products table.
    // Debounced separately from autoSave so rapid group/ungroup actions don't fire
    // a 800-item Supabase upsert on every click — only after 2 s of inactivity.
    if (!user) return;
    if (groupUpsertTimerRef.current) clearTimeout(groupUpsertTimerRef.current);
    // Pin the batch this payload belongs to. `currentBatchIdRef.current` is read
    // at FIRE time, two seconds later, by which point the user may have opened a
    // different batch from the Library — and `pruneStaleProducts` DELETES every
    // products row of the given batch that is not in the keep-list, so a stale
    // timer was capable of deleting the newly-opened batch's rows wholesale.
    const upsertBatchId = currentBatchIdRef.current;
    groupUpsertTimerRef.current = setTimeout(async () => {
      groupUpsertTimerRef.current = null;
      if (currentBatchIdRef.current !== upsertBatchId) {
        log.app(`handleImagesGrouped | products upsert abandoned — batch changed (${upsertBatchId} → ${currentBatchIdRef.current})`);
        return;
      }
      const allRegisterable = itemsWithCategories.filter(i => i.imageUrls?.[0] || i.storagePath);
      if (allRegisterable.length === 0) return;

      // Only the rows whose mirrored content actually differs from what this
      // session last wrote (lib/productUpsertDedupe.ts). One photo moving groups
      // used to re-upsert all 800 items in the batch; now it upserts the handful
      // that changed. `allRegisterable` is still what pruneStaleProducts gets —
      // handing IT the filtered list would delete every unchanged row.
      const changed = filterChangedForUpsert(allRegisterable, upsertedProductKeysRef.current);
      if (changed.length === 0) {
        log.app(`handleImagesGrouped | products upsert skipped — 0 of ${allRegisterable.length} rows changed`);
        // The prune still runs: "no row changed" says nothing about rows that
        // were DELETED from the batch since the last fire.
        if (upsertBatchId) await pruneStaleProducts(upsertBatchId, allRegisterable.map(i => i.id));
        return;
      }
      log.app(`handleImagesGrouped | products upsert | ${changed.length} of ${allRegisterable.length} rows changed`);

      // This write is the `products.product_group` MIRROR. It used to fail with
      // nothing but a console.warn, and a silent failure here is what leaves the
      // mirror stale (report 29) — so it reports into the same indicator.
      saveStatus.begin();
      // Upsert in chunks to avoid PostgREST URL-length limit (lib/chunk.ts)
      let hadError = false;
      for (const chunk of chunked(changed)) {
        const { error: grpErr } = await supabase.from('products').upsert(
          // NO batch_id — see the note in handleImagesSorted (finding 6).
          chunk.map(item => ({
            id: item.id,
            user_id: user.id,
            product_group: item.productGroup || item.id,
            title: item.seoTitle || null,
            status: 'Active',
          })),
          { onConflict: 'id', ignoreDuplicates: false }
        );
        if (grpErr) {
          console.warn('[App] handleImagesGrouped | products upsert error:', grpErr.message);
          hadError = true;
          break;
        }
      }
      if (hadError) {
        saveStatus.end(false, 'Could not save the grouping to the products table.');
      }
      if (!hadError) {
        // Also upsert product_images rows for items that were uploaded directly by
        // ImageGrouper (bypassing handleImagesUploaded).  Without this, those items
        // have products rows but no product_images rows — so Library / open-item
        // views show blank images after the first group action.
        const withImages = changed.filter(i => i.imageUrls?.[0] || i.storagePath);
        if (withImages.length > 0) {
          const productImageRows = withImages.map((item) => {
            const imageUrl = item.imageUrls?.[0] || publicImageUrl(item.storagePath) || null;
            if (!imageUrl) return null;
            return {
              image_url: imageUrl,
              storage_path: item.storagePath ?? null,
              product_id: item.id,
              user_id: user.id,
              position: 0,
              alt_text: item.seoTitle || 'Uploaded image',
              original_name: item.originalName ?? null,
            };
          }).filter(Boolean) as { image_url: string; storage_path: string | null; product_id: string; user_id: string; position: number; alt_text: string; original_name: string | null }[];

          if (productImageRows.length > 0) {
            await supabase.from('product_images').upsert(
              productImageRows,
              { onConflict: 'product_id,image_url', ignoreDuplicates: true }
            );
          }
        }

        // Prune any stale products rows for this batch that are no longer in the current item set.
        // Uses the PINNED id, never the live ref — see the note where the timer is armed.
        if (upsertBatchId) {
          await pruneStaleProducts(upsertBatchId, allRegisterable.map(i => i.id));
        }
        // Only now, after the round-trip landed: a remembered key whose write
        // failed would suppress the retry and leave the mirror stale forever.
        rememberUpserted(changed, upsertedProductKeysRef.current);
        setLibraryRefreshTrigger(prev => prev + 1);
        saveStatus.end(true);
      }
    }, GROUP_UPSERT_DEBOUNCE_MS);
  };

  const handleItemsProcessed = (items: ClothingItem[]) => {
    log.pdg(`handleItemsProcessed | items=${items.length}`);

    // Stage 2b: PDG reads/writes workflowStore directly — `items` IS the full,
    // already-current store list (uncategorized singles included). The old
    // filtered-subset merge + setProcessedItems are gone; this callback only
    // schedules the workflow_state auto-save.
    autoSaveWorkflow({
      uploadedImages: uploadedImagesRef.current,
      groupedImages: groupedImagesRef.current,
      sortedImages: sortedImagesRef.current,
      processedItems: items,
    });
  };

  // Auto-save workflow state to batch (debounced — 2 s after last call)
  const autoSaveWorkflow = (workflowState: {
    uploadedImages: ClothingItem[];
    groupedImages: ClothingItem[];
    sortedImages: ClothingItem[];
    processedItems: ClothingItem[];
  }) => {
    if (!user) return;

    // ── localStorage backup (throttled ~1 s trailing) ────────────────────
    // Still far ahead of the 2 s Supabase write — winning that refresh race is its
    // only job — but no longer a 1 500-element map + ~393 KB JSON.stringify + a
    // BLOCKING setItem on every one of the seven call sites (i.e. on every group
    // click, category assignment and Step-3 keystroke). A 50-click burst used to pay
    // that 50 times; it now pays it once. `flushWorkflowBackup` is wired to
    // pagehide/beforeunload below, so "a refresh never loses pending grouping" holds.
    // Ultra-slim: only the fields that are NOT in products/product_images and so
    // cannot be recovered by the DB merge in handleOpenBatch / startup hydration.
    scheduleWorkflowBackup(() => {
      const liveNow =
        workflowState.processedItems.length > 0 ? workflowState.processedItems :
        workflowState.sortedImages.length    > 0 ? workflowState.sortedImages    :
        workflowState.groupedImages.length   > 0 ? workflowState.groupedImages   :
        workflowState.uploadedImages;
      if (liveNow.length === 0 || !currentBatchIdRef.current) return null;
      return {
        batchId: currentBatchIdRef.current,
        savedAt: Date.now(),
        items:   liveNow.map(ultraSlimForBackup),
      };
    });

    // Cancel any pending save
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);

    const fire = async () => {
      autoSaveTimerRef.current = null;
      pendingAutoSaveFireRef.current = null;
      // Guard: if session hasn't resolved yet (getSession().then() still in flight),
      // currentBatchIdRef.current will be null and we'd create a spurious new batch.
      // This happens when PDG mounts immediately and calls handleItemsProcessed before
      // getSession() completes. Safe to skip — the session resolving will trigger another
      // autoSave call with the correct batchId.
      if (!currentBatchIdRef.current) {
        return;
      }

      // In-flight guard: if a save round-trip is already pending, this fire must NOT
      // run concurrently — two calls that both see "0 rows updated" (row not yet in
      // DB) would both INSERT a batch row, which is the duplicate-batch bug.
      //
      // But it must not be DROPPED either, which is what it used to be. The in-flight
      // save is carrying a payload captured BEFORE these changes, so dropping this
      // fire meant the newest grouping never reached Supabase at all — and the restore
      // then preferred that older blob because `last_opened_at` records when the older
      // write LANDED. Re-arm instead: the newest state always gets a turn.
      if (autoSaveInFlightRef.current) {
        log.app('autoSaveWorkflow | save already in flight — re-arming');
        pendingAutoSaveFireRef.current = fire;
        autoSaveTimerRef.current = setTimeout(fire, AUTOSAVE_RETRY_MS);
        return;
      }
      autoSaveInFlightRef.current = true;
      saveStatus.begin();

      // True slim — only the fields that CANNOT be recovered from the products/product_images
      // DB tables (slimForWorkflowState — extracted to lib/slimItems.ts, tested there).
      const slim = slimForWorkflowState;

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
        // Stamp who last edited this batch (collaborative workspace) so the Library
        // can show "last edited by X".
        lastEditedBy:   user?.email ?? undefined,
        lastEditedAt:   new Date().toISOString(),
      };

      try {
        // Use ref so we always get the latest batchId regardless of closure age
        log.app(`autoSaveWorkflow | fire | batchId=${currentBatchIdRef.current} | items=${slim(live).length}`);
        // Detailed variant: the plain one hands back the batch id even when RLS
        // silently refused the UPDATE, so a total write failure looked like a
        // success. The indicator has to show the difference.
        const result = await autoSaveWorkflowBatchDetailed(
          currentBatchIdRef.current,
          currentBatchNumber,
          safeState
        );
        const { batchId } = result;

        if (batchId && batchId !== currentBatchIdRef.current) {
          // First save OR old batch was deleted and a new one was created
          currentBatchIdRef.current = batchId;
          setCurrentBatchId(batchId);
          localStorage.setItem('sortbot_current_batch_id', batchId);
          localStorage.setItem('sortbot_current_batch_number', currentBatchNumber);
        }
        if (autoSaveSucceeded(result)) {
          saveStatus.end(true);
        } else {
          // Was silently console.warn'd inside the service and reported to the user
          // as nothing at all. rls-blocked in particular means the edit is GONE.
          console.warn(`[App] auto-save did not persist (${result.outcome}):`, result.message);
          saveStatus.end(false, result.message ?? `Auto-save failed (${result.outcome}).`);
        }
        // NOTE: No Library refresh here — auto-save only writes to workflow_state,
        // NOT to products/product_images. The Library re-fetches on real DB changes only
        // (explicit Save Batch or image delete), preventing the auto-save → loadAll loop.
      } catch (error) {
        console.error('Auto-save failed:', error);
        saveStatus.end(false, error instanceof Error ? error.message : 'Auto-save failed.');
      } finally {
        autoSaveInFlightRef.current = false;
      }
    };

    pendingAutoSaveFireRef.current = fire;
    autoSaveTimerRef.current = setTimeout(fire, AUTOSAVE_DEBOUNCE_MS); // wait for quiet before hitting Supabase
  };

  /**
   * Run a pending debounced save NOW instead of dropping it.
   *
   * `handleOpenBatch` and `handleClearBatch` both clear `autoSaveTimerRef` —
   * they have to, because the callback prunes and writes against whatever batch
   * is current when it fires. But clearing it also threw away every edit made
   * inside the debounce window, and widening that window to 5 s made the loss
   * worth fixing rather than tolerating.
   *
   * MUST be called BEFORE `currentBatchIdRef.current` is reassigned: `fire`
   * reads that ref at call time, which is the whole reason the drop existed.
   * Fire-and-forget by design — the outgoing batch's write does not block the
   * incoming batch's open.
   */
  const flushPendingAutoSave = () => {
    const pending = pendingAutoSaveFireRef.current;
    if (!pending) return;
    pendingAutoSaveFireRef.current = null;
    if (autoSaveTimerRef.current) { clearTimeout(autoSaveTimerRef.current); autoSaveTimerRef.current = null; }
    log.app('autoSaveWorkflow | flushing pending save before batch switch');
    pending();
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
      log.app(`[OPEN] SKIPPED — already in progress | batchId=${batch.id}`);
      return;
    }
    log.app(`[OPEN] ▶ START batchId=${batch.id} name="${batch.batch_name}" step=${batch.current_step}`);
    // Object.keys allocates — only do it when someone is looking.
    if (isDebugEnabled()) log.app('[OPEN] workflow_state keys:', batch.workflow_state ? Object.keys(batch.workflow_state) : 'NULL');
    if (isDebugEnabled()) {
      const wsLengths = batch.workflow_state ? {
        processedItems: batch.workflow_state.processedItems?.length ?? 0,
        sortedImages:   batch.workflow_state.sortedImages?.length ?? 0,
        groupedImages:  batch.workflow_state.groupedImages?.length ?? 0,
        uploadedImages: batch.workflow_state.uploadedImages?.length ?? 0,
      } : 'none';
      log.app('[OPEN] workflow_state array lengths:', wsLengths);
    }
    log.app(`handleOpenBatch | batchId=${batch.id} batchName="${batch.batch_name}" step=${batch.current_step}`);
    isOpeningBatchRef.current = true;
    try {
    // ── Set batch identity FIRST (before any state clears or async work) ──────────
    // 1. currentBatchIdRef drives autoSave — must be set before ImageGrouper's
    //    onGrouped fires during initializeItems (which happens synchronously below).
    // 2. setCurrentBatchId changes the `key` on ImageGrouper, unmounting the old
    //    instance so its stale internal state can't contaminate the new batch.
    //    (key={currentBatchId} is set on the ImageGrouper JSX element)
    // 3. Compute isAlreadyActiveBatch against the OLD ref BEFORE we update it.
    const isAlreadyActiveBatch = batch.id === currentBatchIdRef.current;
    // Before the ref moves: run any save still sitting in the debounce window
    // for the OUTGOING batch, rather than dropping it with the timer below.
    if (!isAlreadyActiveBatch) flushPendingAutoSave();
    currentBatchIdRef.current = batch.id;
    batchRowInsertedRef.current = true;
    markBatchConfirmed(batch.id); // row verified — if it vanishes later, it was deleted (never re-create)
    pendingChunkRef.current = [];
    if (chunkTimerRef.current) { clearTimeout(chunkTimerRef.current); chunkTimerRef.current = null; }
    // The outgoing batch's debounced products upsert must not fire against the
    // incoming one. Its callback now also re-checks the pinned id, so this is
    // belt-and-braces — but it saves a pointless round trip on every open.
    if (groupUpsertTimerRef.current) { clearTimeout(groupUpsertTimerRef.current); groupUpsertTimerRef.current = null; }
    setCurrentBatchId(batch.id);
    setCurrentBatchNumber(batch.batch_number);
    localStorage.setItem('sortbot_current_batch_id', batch.id);
    localStorage.setItem('sortbot_current_batch_number', batch.batch_number);
    // ── Now clear in-flight image state ─────────────────────────────────────────
    log.app(`[OPEN] Clearing current state and setting batchId=${batch.id}`);
    setUploadedImages([]);
    setGroupedImages([]);
    setSortedImages([]);
    setProcessedItems([]);

    // Restore workflow state
    const { uploadedImages, groupedImages, sortedImages, processedItems } = batch.workflow_state ?? {};

    // processedItems is now the single saved list (others are empty arrays in new format).
    // Fall back through all arrays for older batch formats. DO NOT break this chain
    // without updating the startup restore too (AGENTS.md §18 #4).
    // asClothingItems is the ONE documented widening: a persisted item has no `file`
    // and (since the slimming) no `preview`; both are rebuilt from `storagePath` below.
    const rawWorkflowItems = asClothingItems(
      processedItems?.length  ? processedItems  :
      sortedImages?.length    ? sortedImages     :
      groupedImages?.length   ? groupedImages    :
      uploadedImages?.length  ? uploadedImages   : []
    );
    log.app(`[OPEN] rawWorkflowItems=${rawWorkflowItems.length} (source: ${processedItems?.length ? 'processedItems' : sortedImages?.length ? 'sortedImages' : groupedImages?.length ? 'groupedImages' : uploadedImages?.length ? 'uploadedImages' : 'NONE'})`);

    // Re-hydrate preview — stripped before saving to reduce payload size.
    // imageUrls may also be empty for older items; reconstruct from storagePath
    // (synchronous, no extra DB query) as the final fallback.
    // thumbnailUrl: Supabase Storage transform (300px) — used by ImageGrouper/PDG card display.
    // Falls back to full-res URL for legacy items that lack storagePath.
    // IMPORTANT: reject any saved blob: URL — they are only valid for the browser
    // session in which they were created and will 404 after any page reload.
    const workflowItems: ClothingItem[] = rawWorkflowItems.map(item => {
      const reconstructed = publicImageUrl(item.storagePath);
      const savedPreview = item.preview?.startsWith('blob:') ? '' : (item.preview || '');
      const thumbnailUrl = thumbnailImageUrl(item.storagePath)
        || item.imageUrls?.[0] || reconstructed;
      return {
        ...item,
        preview: savedPreview || item.imageUrls?.[0] || reconstructed,
        imageUrls: item.imageUrls?.length ? item.imageUrls : (reconstructed ? [reconstructed] : []),
        thumbnailUrl,
      };
    });
    
    log.app(`[OPEN] workflowItems after hydration=${workflowItems.length}`);
    // A full .filter() over the batch plus a per-item object literal — both were
    // running on every batch open in production purely to feed the log.
    if (isDebugEnabled()) {
      const withPreview = workflowItems.filter(i => i.preview || i.imageUrls?.length || i.thumbnailUrl);
      log.app(`[OPEN] items with image URL: ${withPreview.length}/${workflowItems.length}`);
      if (workflowItems[0]) log.app('[OPEN] first item sample:', { id: workflowItems[0].id, preview: workflowItems[0].preview?.slice(0,80), storagePath: workflowItems[0].storagePath, imageUrls: workflowItems[0].imageUrls?.length });
    }

    // Set state immediately from workflow_state so images render right away.
    // DB product descriptions will merge in after the fetch below.
    if (workflowItems.length > 0) {
      log.app('[OPEN] ✓ Setting initial state from workflow_state');
      setUploadedImages(workflowItems);
      setGroupedImages(workflowItems);
      setSortedImages(workflowItems);
      setProcessedItems(workflowItems);
    } else {
      log.app('[OPEN] ⚠ workflow_state was empty — will try DB reconstruction below');
    }

    // Fetch saved products from database to restore descriptions
    // Hoisted so registerItemsInDB (called after try/catch) can always access the final items.
    // Only select the columns that are actually needed for restoration — skip the 20+ rarely-set
    // columns to keep the payload small and the query fast.
    let restoredProcessedItems: ClothingItem[] = workflowItems;
    let foundInDB = false; // set true when productsToUse has rows — skip registerItemsInDB in that case
    // isAlreadyActiveBatch was computed and currentBatchIdRef was set at the top of this function.
    try {
      const slimProductSelect = `
        id,
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
          storage_path,
          position,
          original_name
        )
      `;

      log.app(`handleOpenBatch | fetching products from DB for batch ${batch.id}`);
      // Paged — unpaginated, a 1 500-item batch restored only its first 1 000
      // products, and the gap-fill safety cap then judged the remaining 500 against
      // that partial view (F13).
      const { rows: savedProducts, error: prodErr } = await readAllPages((from, to) => supabase
        .from('products')
        .select(slimProductSelect)
        .eq('batch_id', batch.id)
        .order('created_at', { ascending: true })
        .range(from, to));
      log.app(`handleOpenBatch | DB products fetch: count=${savedProducts.length} error=${prodErr?.message ?? 'none'}`);
      
      // If no products found with this batch_id, try to find orphaned products
      // (products saved around the same time with image URLs matching this batch)
      let potentialOrphans: any[] = [];
      if (!savedProducts || savedProducts.length === 0) {
        // Get the batch creation time
        const batchCreatedAt = new Date(batch.created_at);
        const timeWindow = 24 * 60 * 60 * 1000; // 24 hours
        const startTime = new Date(batchCreatedAt.getTime() - timeWindow);
        const endTime = new Date(batchCreatedAt.getTime() + timeWindow);
        
        // SCOPED + BOUNDED (finding 7). This used to be an unfiltered, unlimited
        // select over a 48-hour window: under shared-workspace RLS it returned
        // every product ANY user created in that window, and a URL-matched row
        // that legitimately belongs to another batch would then be re-tagged into
        // this one on the next group action. Only genuinely unassigned rows
        // (batch_id IS NULL) owned by this user can be adopted, and never more
        // than the batch could plausibly need.
        let orphanQuery = supabase
          .from('products')
          .select(slimProductSelect)
          .is('batch_id', null)
          .gte('created_at', startTime.toISOString())
          .lte('created_at', endTime.toISOString())
          .order('created_at', { ascending: true })
          .limit(Math.max(workflowItems.length * 2, 100));
        if (user?.id) orphanQuery = orphanQuery.eq('user_id', user.id);
        const { data: recentProducts } = await orphanQuery;
        
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
      
      log.app(`[OPEN] potentialOrphans=${potentialOrphans.length} productsToUse=${savedProducts?.length ? savedProducts.length + ' (from DB)' : potentialOrphans.length + ' (orphans)'}`);
      const productsToUse = savedProducts && savedProducts.length > 0 ? savedProducts : potentialOrphans;
      if (productsToUse.length > 0) foundInDB = true;
      
      // Always derive baseItems from the most-progressed single list (workflowItems),
      // not from the stale individual arrays. This handles both the new single-list
      // format and old multi-array formats via the fallback chain above.
      // When there is NO workflow_state at all, reconstruct ClothingItems from DB products.
      let baseItems: ClothingItem[] = workflowItems;

      log.app(`[OPEN] baseItems from workflow_state=${baseItems.length}`);
      if (baseItems.length === 0 && productsToUse && productsToUse.length > 0) {
        log.app(`[OPEN] workflow_state empty — reconstructing ${productsToUse.length} items from DB products`);
        // No workflow_state — build items from the DB products table
        // ONE builder, shared with the gap-fill path below (lib/productRow.ts).
        // These two blocks were byte-identical 70-line copies.
        baseItems = productsToUse.map((p: ProductRowLite) =>
          productRowToClothingItem(p, htmlDescToPlain));
      }

      // Gap-fill: if workflow_state existed but was saved when only categorized items
      // were persisted (pre-dbd5d43 bug), the DB may have products that are missing
      // from workflowItems. Append any DB product whose id is not already in baseItems.
      // Safety cap: if the DB has more than 2× the workflow_state item count as
      // "missing", those extras are almost certainly stolen from other batches by a
      // previous registerItemsInDB(ignoreDuplicates:false) call. Skip the gap-fill in
      // that case to prevent loading hundreds of items that don't belong here.
      if (workflowItems.length > 0 && productsToUse && productsToUse.length > 0) {
        const baseIds = new Set(baseItems.map(i => i.id));
        const missing = productsToUse.filter((p: any) => !baseIds.has(p.id));
        const gapFillCap = Math.max(workflowItems.length * 2, 50); // allow at most 2× or 50, whichever is larger
        if (missing.length > 0 && missing.length <= gapFillCap) {
          log.app(`handleOpenBatch | gap-fill | adding ${missing.length} DB items missing from workflow_state`);
          // capturedAt is intentionally absent on gap-filled items: no products
          // column holds it, so they have no date until the EXIF rescan runs.
          const missingItems: ClothingItem[] = missing.map((p: ProductRowLite) =>
            productRowToClothingItem(p, htmlDescToPlain));
          baseItems = [...baseItems, ...missingItems];
        } else if (missing.length > gapFillCap) {
          log.app(`handleOpenBatch | gap-fill SKIPPED — ${missing.length} DB items exceed cap (${gapFillCap}); likely stolen batch_ids from a previous session. Deleting in background.`);
          // Fire-and-forget cleanup: DELETE stolen products entirely so they never
          // reappear. These are duplicate rows cloned by the old ignoreDuplicates:false
          // bug — the real items already live in workflow_state. Nullifying batch_id
          // only hides them until someone re-assigns them; deletion is permanent.
          const stolenIds = missing.map((p: any) => p.id);
          (async () => {
            for (const chunk of chunked(stolenIds)) {
              // Delete associated product_images first (FK constraint)
              await supabase.from('product_images').delete().in('product_id', chunk);
              // Then delete the product rows
              await supabase.from('products').delete().in('id', chunk);
            }
            log.app(`handleOpenBatch | gap-fill cleanup done | deleted ${stolenIds.length} stolen products`);
          })();
        }
      }

      // Merge saved data back into processedItems
      restoredProcessedItems = baseItems;
      if (baseItems.length > 0 && productsToUse && productsToUse.length > 0) {
        // Build O(1) lookup Maps — avoids O(n²) .find() inside .map() for large batches.
        // productsByGroup is the ONLY collision-free key: saveBatchToDatabase writes exactly
        // one products row per unique product_group, so matching item.productGroup → product
        // never mismatches. Title and image_url are unreliable fallbacks (group members share
        // a title; URLs can change between sessions) and must never run before the group match.
        const productsByGroup = new Map<string, any>();
        const productsByTitle = new Map<string, any>();
        const productsByImageUrl = new Map<string, any>();
        for (const p of productsToUse) {
          const g = p.product_group || p.id;
          // Prefer the LEADER row (id === product_group) — that is the row the
          // Step-3 save path writes (syncGroupFieldsToDatabase / saveBatchToDatabase).
          // "first created_at wins" resolved to a different row as soon as
          // processedItems order diverged from insertion order, and the group's
          // description/price were then read off a stub. (finding 2)
          if (g && (!productsByGroup.has(g) || p.id === g)) productsByGroup.set(g, p);
          if (p.seo_title) productsByTitle.set(p.seo_title.trim(), p);
          for (const img of (p.product_images || [])) {
            if (img.image_url) productsByImageUrl.set(img.image_url, p);
          }
        }

        let groupMirrorDrift = 0;
        restoredProcessedItems = baseItems.map((item: ClothingItem) => {
          // Match by productGroup FIRST — the only collision-free key. This is what
          // prevents the "mixed up images" bug: matching by shared title or by list
          // position pulled the wrong product, whose images then overwrote this item's.
          let savedProduct: any = productsByGroup.get(item.productGroup || item.id);

          // Fallback: match by this item's own image URL (still per-item reliable).
          if (!savedProduct && item.preview) {
            savedProduct = productsByImageUrl.get(item.preview);
          }

          // Last resort: match by title. Group members share a title so this can be
          // wrong, but it only runs when group + image both failed, and (below) we no
          // longer let a matched product overwrite this item's own image.
          if (!savedProduct && item.seoTitle) {
            savedProduct = productsByTitle.get(item.seoTitle.trim());
          }
          // NOTE: the old position-index fallback (productsToUse[index]) was removed —
          // it aligned two differently-ordered lists and bled unrelated products' data.

          if (savedProduct && isDebugEnabled()) {
            // Report 29 tripwire: products.product_group is a LAGGING mirror of
            // workflow_state (separate 2 s debounce, and registerItemsInDB's
            // ignoreDuplicates:true upsert never updates it). It no longer wins
            // the merge — this counts how far behind it actually was, so a
            // founder capture shows whether the mirror is the problem.
            const rowGroup = savedProduct.product_group || savedProduct.id;
            const liveGroup = item.productGroup || item.id;
            if (rowGroup !== liveGroup) {
              groupMirrorDrift++;
              if (groupMirrorDrift <= 5) {
                log.app(`[group] item ${item.id}: workflow_state says "${liveGroup}", products.product_group says "${rowGroup}" — keeping workflow_state`);
              }
            }
          }

          if (savedProduct) {
            // DB row wins — it was written by an explicit Save which is authoritative.
            // workflow_state (item) is the fallback for fields not yet in the DB.
            // Reconstruct imageUrls from DB product_images rows if the workflow_state
            // item's imageUrls are empty (slim() strips them before saving).
            // CRITICAL (commit 3a70b52): prefer THIS item's own image. savedProduct is
            // matched at the GROUP level, so its product_images is the whole group's
            // photo list — preferring it made every member of a group show the same
            // photo. OPEN_BATCH_MERGE_OPTIONS encodes that ('own-image-wins'), plus
            // the six other ways this path differs from the startup restore.
            return mergeProductRowIntoItem(item, savedProduct, htmlDescToPlain, OPEN_BATCH_MERGE_OPTIONS);
          }
          
          return item;
        });
        if (groupMirrorDrift > 0) {
          log.app(`[group] products.product_group disagreed with workflow_state on ${groupMirrorDrift}/${baseItems.length} items (workflow_state won)`);
        }
      }

      // Set all 4 arrays from the single restored list so every step stays in sync.
      log.app(`[OPEN] ✓ Final state set: restoredProcessedItems=${restoredProcessedItems.length}`);
      // Same shape as the hydration log above: a full .filter() plus an object
      // literal, previously unconditional.
      if (isDebugEnabled()) {
        const finalWithImg = restoredProcessedItems.filter(i => i.preview || i.imageUrls?.length || i.thumbnailUrl);
        log.app(`[OPEN] final items with images: ${finalWithImg.length}/${restoredProcessedItems.length}`);
        if (restoredProcessedItems[0]) log.app('[OPEN] first final item:', { id: restoredProcessedItems[0].id, preview: restoredProcessedItems[0].preview?.slice(0,80), category: restoredProcessedItems[0].category });
      }
      setUploadedImages(restoredProcessedItems);
      setGroupedImages(restoredProcessedItems);
      setSortedImages(restoredProcessedItems);
      setProcessedItems(restoredProcessedItems);
    } catch (error) {
      console.error('[OPEN] ❌ CATCH — Error restoring saved product data:', error);
      log.app(`[OPEN] Falling back to workflowItems: ${workflowItems.length}`);
      // Fallback to basic workflow state — restoredProcessedItems stays as workflowItems (hoisted default)
      setUploadedImages(workflowItems);
      setGroupedImages(workflowItems);
      setSortedImages(workflowItems);
      setProcessedItems(workflowItems);
    }

    // Phone: open the batch on the step that has work left (never Export —
    // see resumeStep). Both branches above (and the DB-reconstruction path
    // inside the try) have settled by now, and the ref reads the store.
    setPhoneStep(resumeStep(processedItemsRef.current));

    // Fire registerItemsInDB in the background — don't await it.
    // The UI is already showing images at this point (set above). registerItemsInDB
    // only matters for Library consistency, which is non-blocking from the user's perspective.
    // Skip entirely if this batch was already the active one (checked before updating currentBatchIdRef).
    if (!isAlreadyActiveBatch) {
      // Only register items that are genuinely missing from the DB.
      // foundInDB is true when the DB query above returned products for this batch —
      // items are already registered so the expensive delete+upsert loop is unnecessary.
      if (!foundInDB) {
        registerItemsInDB(restoredProcessedItems, batch.id);
      }
    }

    // Auto-rescan EXIF for any items missing capturedAt — fires in background after open.
    // Old batches (uploaded before ac06e11) never had capturedAt set. This silently
    // downloads each image and reads DateTimeOriginal so dates appear on Step 2 cards
    // without the user having to manually click the rescan button in Step 1.
    // SAFETY CAP: skip for large batches — downloading 400+ full-res images freezes the browser.
    const itemsMissingDate = restoredProcessedItems.filter(i => !i.capturedAt && (i.imageUrls?.[0] || i.thumbnailUrl || i.preview));
    if (itemsMissingDate.length > 0 && itemsMissingDate.length <= 30) {
      log.app(`handleOpenBatch | auto-EXIF rescan | ${itemsMissingDate.length} items missing capturedAt`);
      (async () => {
        const { default: exifr } = await loadExifr();
        const updatedMap = new Map<string, number>();
        // 5 bounds CONCURRENT image downloads, not URL length.
        for (const chunk of chunked(itemsMissingDate, 5)) {
          await Promise.all(chunk.map(async (item) => {
            const url = item.imageUrls?.[0] || item.thumbnailUrl || item.preview || '';
            if (!url) return;
            try {
              const resp = await fetch(url);
              if (!resp.ok) return;
              const blob = await resp.blob();
              const file = new File([blob], 'img.jpg', { type: blob.type });
              const exif = await exifr.parse(file, ['DateTimeOriginal']);
              if (exif?.DateTimeOriginal instanceof Date) {
                updatedMap.set(item.id, exif.DateTimeOriginal.getTime());
              }
            } catch { /* non-fatal */ }
          }));
        }
        if (updatedMap.size > 0) {
          log.app(`handleOpenBatch | auto-EXIF rescan done | updated=${updatedMap.size}`);
          const patch = (arr: ClothingItem[]) =>
            arr.map(i => updatedMap.has(i.id) ? { ...i, capturedAt: updatedMap.get(i.id) } : i);
          setUploadedImages(prev => patch(prev));
          setGroupedImages(prev => patch(prev));
          setSortedImages(prev => patch(prev));
          setProcessedItems(prev => patch(prev));
          // Auto-save AFTER the setters so the corrected dates survive reload — never
          // inside an updater (finding 14): updaters must be pure, and StrictMode
          // double-invokes them. liveArrayRef `.current` is already fresh here.
          autoSaveWorkflow({
            uploadedImages: uploadedImagesRef.current,
            groupedImages: groupedImagesRef.current,
            sortedImages: sortedImagesRef.current,
            processedItems: processedItemsRef.current,
          });
        }
      })();
    }

    // Batch identity already set at the top of this function — nothing to do here.
    
    log.app(`[OPEN] ✓ DONE — closing library, isAlreadyActiveBatch=${isAlreadyActiveBatch}`);
    // Close library and refresh it so new registrations are visible next open
    setShowLibrary(false);
    setLibraryRefreshTrigger(prev => prev + 1);
    
    // Show success message
    const defaultName = `Batch ${new Date(batch.created_at).toLocaleDateString()} ${new Date(batch.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    const batchDisplayName = batch.batch_name || defaultName;
    setSaveMessage({
      type: 'success',
      text: `Opened "${batchDisplayName}" — drop more images in Step 1 to add to this batch`,
    });
    
    // Clear message after 5 seconds
    setTimeout(() => setSaveMessage(null), 5000);

    // Release the guard so the next open can proceed
    isOpeningBatchRef.current = false;
  } finally {
    isOpeningBatchRef.current = false;
  }
  };

  const Wordmark = activeView === 'workflow' ? 'h1' : 'p';

  /* ── The navigation's single source of truth ──────────────────────────────
     Every destination this user may open, in the order the workspace menu
     renders them, each tagged with the band it belongs to. ONE list feeds the
     menu at every width, so a role gate, a label and an icon are declared
     exactly once — the header row, the tablet rail and the phone's More sheet
     that used to re-render this list are all gone.

     `messages` is declared here like anything else; <AccountNav> is what knows
     whether the messaging tables exist, and drops the row (and the trigger's
     badge) when they do not.

     Not memoized on purpose: it is a handful of object literals rebuilt during
     a render that is already happening, and the consumer is not memo'd, so a
     useMemo here would buy nothing but a dependency array to get wrong. */
  const isFoundingAdmin = currentOrg?.slug === 'founding' && (orgRole === 'owner' || orgRole === 'admin');
  const navItems: WorkspaceNavItem[] = [
    /* WORK — the things you do to a batch. Labels and Scan are the physical
       half of the workflow and belong to EVERY workspace, not just founding
       admins, which is why they sit beside Library rather than under Setup. */
    { id: 'home', label: 'Home', icon: <LayoutDashboard size={16} />, title: 'Home — your batches, tools and messages in one place', group: 'work' },
    { id: 'library', label: 'Library', icon: <Package size={16} />, title: 'View saved workflow batches', group: 'work' },
    { id: 'products', label: 'Products', icon: <Boxes size={16} />, title: 'Products — find any listing across every batch, and edit its fields, barcode and labels', group: 'work' },
    { id: 'labels', label: 'Labels', icon: <Printer size={16} />, title: 'Labels — print shelf labels with barcodes for the open batch', group: 'work' },
    { id: 'scan', label: 'Scan', icon: <ScanLine size={16} />, title: 'Scan — find a listing by its barcode or SKU', group: 'work' },
    { id: 'messages', label: supportIsFounder ? 'Inbox' : 'Messages', icon: <MessageSquare size={16} />,
      title: supportIsFounder
        ? 'Inbox — every conversation, from every workspace'
        : 'Messages — talk to the Arcadian team',
      group: 'work' },
    /* SETUP — the things you configure once and forget. */
    { id: 'categories', label: 'Manage Categories', icon: <Tag size={16} />, title: 'Manage your product categories', group: 'setup' },
    { id: 'presets', label: 'Category Presets', icon: <Settings size={16} />, title: 'Manage category presets for shipping weight, measurements, and default attributes', group: 'setup' },
    ...(currentOrg ? [{ id: 'workspace', label: 'Workspace dashboard', icon: <Users size={16} />, title: 'Workspace — members, invites and settings', group: 'setup' as const }] : []),
    // Phone only: stands in for the bottom-left gear, which is hidden below 640px.
    ...(showShortcuts ? [{ id: 'shortcuts', label: 'Keyboard shortcuts', icon: <Keyboard size={16} />, title: 'Every keyboard shortcut, by screen', group: 'setup' as const, phoneOnly: true }] : []),
    /* FOUNDER — Founding Workspace only, and all but Board admin-only. */
    ...(isFoundingAdmin ? [
      { id: 'founder', label: 'Founder console', icon: <ShieldCheck size={16} />, title: 'Founder console — beta requests, every workspace, plans and accounts (Founding Workspace)', group: 'founder' as const },
      { id: 'vocabulary', label: 'Vocabulary', icon: <BookMarked size={16} />, title: 'Vocabulary — curate quick keyword chips and brand keywords (all workspaces)', group: 'founder' as const },
      { id: 'analytics', label: 'Analytics', icon: <BarChart3 size={16} />, title: 'Analytics — first-party pageviews, funnel, referrers, errors (Founding Workspace)', group: 'founder' as const },
      { id: 'crm', label: 'CRM', icon: <Contact size={16} />, title: 'CRM — every beta request and account as a contact, with stages, follow-ups and notes (Founding Workspace)', group: 'founder' as const },
      { id: 'finance', label: 'Finance', icon: <Wallet size={16} />, title: 'Finance — income, expenses, profit, customers and reports (Founding Workspace)', group: 'founder' as const },
    ] : []),
    ...(currentOrg?.slug === 'founding' ? [
      { id: 'board', label: 'Board', icon: <KanbanSquare size={16} />, title: 'Board — features and todos for this workspace', group: 'founder' as const },
    ] : []),
  ];
  /* The phone's two named tabs navigate straight to a view. Tapping the tab you
     are already on must be inert, not a trip somewhere else. */
  const navigateToView = (id: string) => setActiveView(id as ActiveView);

  return (
    <div className="app-container">
      {/* Real-time collaboration: Show cursors and activity of other users */}
      
      <header className="app-header">
        <div className="header-content">
          <div>
            {/* Wordmark, not a sentence — the descriptor lives in the subtitle
                below. Tight tracking is what separates a mark from a label.
                It is the page's <h1> on the workflow; inside a tool view
                ToolView's title takes that role, so the mark steps down to a
                <p> and every view keeps exactly one h1. */}
            <Wordmark className="app-wordmark" style={{ display: 'flex', alignItems: 'center', marginBottom: '0.2rem' }}>
              {/* The mark is the way home, the way a masthead is on any site.
                  A <button>, not an <a>: there is no router and no URL to point
                  at, and a hrefless anchor is not focusable. */}
              <button
                type="button"
                className="app-wordmark-link"
                onClick={() => setActiveView('home')}
                aria-current={activeView === 'home' ? 'page' : undefined}
                title="Home"
              >
                <BrandWordmark />
              </button>
            </Wordmark>
            <p className="header-subtitle">Upload, sort, describe, and export to Shopify</p>
          </div>
          <div className="header-actions">
            {/* THE HEADER'S ONLY CONTROL. It used to be eleven tool buttons
                wrapping onto a second line plus this trigger; every one of them
                is now a row in the menu below it, at every width. The trigger
                carries the unread count so the one signal that cannot wait for
                a menu to be opened is still on the bar. */}
            <AccountNav
              isFounder={supportIsFounder}
              userId={user.id}
              items={navItems}
              orgName={currentOrg?.name ?? null}
              role={currentOrg ? orgRole : undefined}
              email={user.email}
              activeView={activeView}
              showBackToWorkflow={activeView !== 'workflow'}
              onSelect={handleNavSelect}
              onSignOut={handleSignOut}
              open={navMenuOpen}
              onOpenChange={setNavMenuOpen}
              /* The storage meter (was a bar under the header) is a row in the
                 menu now. Clicking the row forces a re-read — one RPC. */
              storage={storageInfo && user ? {
                ...storageInfo,
                limitGb: parseFloat(import.meta.env.VITE_STORAGE_LIMIT_GB || '100'),
                onRefresh: () => { void fetchStorageUsage(user.id, true); },
              } : null}
            />
          </div>
        </div>
      </header>

      {/* The workflow is PARKED, never unmounted: an upload in flight, the
          grouper's selection, and Step 3's debounced saves all keep running
          while a tool view is open. `hidden` (not an inline display:none) so
          it is removed from the a11y tree too — App.css pins the flex
          display off, since `display:flex` would otherwise beat the UA rule. */}
      <main className="app-main" hidden={activeView !== 'workflow'} data-phone-step={shownStep}>
        {/* The four sections are one step at a time at every width: this
            stepper picks the step, and the data-phone-step rules in App.css
            hide the other three (they stay mounted). */}
        <PhoneStepper step={shownStep} reachable={phoneReachable} onSelect={goToPhoneStep} />

        {/* Save Message */}
        {saveMessage && (
          <div className={`save-message ${saveMessage.type}`}>
            {saveMessage.text}
          </div>
        )}

        {/* Step 1: Upload Images */}
        <section className="step-section" data-step="1">
          <div className="step1-header">
            <div>
              <h2>Step 1: Upload Images</h2>
              {uploadedImages.length > 0 && currentBatchId ? (
                <p className="step-description" style={{ fontSize: 'var(--fs-lg)', color: 'var(--success)', margin: 0 }}>
                  <Plus size={11} style={{ flexShrink: 0 }} /> <strong>Batch active</strong> — drop more images here to add them to this batch ({uploadedImages.length} image{uploadedImages.length !== 1 ? 's' : ''} already loaded)
                </p>
              ) : (
                <p className="step-description" style={{ fontSize: 'var(--fs-lg)', color: 'var(--text-secondary)', margin: 0 }}>
                  <Lightbulb size={11} style={{ flexShrink: 0 }} /> <strong>Tip:</strong> You can upload multiple batches! New images will be added to your current session.
                </p>
              )}
            </div>
            <div className="step1-header-actions">
              <button
                className="step1-import-btn step1-folder-btn"
                onClick={() => uploadRef.current?.triggerFolder()}
                disabled={uploadRef.current?.isBusy ?? false}
              >
                <FolderOpen size={13} style={{ flexShrink: 0 }} /> Import Folder
              </button>
              <button
                className="step1-import-btn step1-zip-btn"
                onClick={() => uploadRef.current?.triggerZip()}
                disabled={uploadRef.current?.isBusy ?? false}
              >
                <FileArchive size={13} style={{ flexShrink: 0 }} /> Import ZIP
              </button>
            </div>
          </div>
          <ImageUpload ref={uploadRef} onImagesUploaded={handleImagesUploaded} userId={user.id} existingItems={uploadedImages} onCapturedAtUpdated={handleCapturedAtUpdated} onToast={addToast} onChunkReady={handleChunkReady} onUploadCancelled={handleUploadCancelled} onUploadStart={handleUploadStart} getBatchId={() => currentBatchIdRef.current} />
          {/* "N images uploaded" moved to toast — see handleImagesUploaded */}
          <PhoneStepNav step={1} reachable={phoneReachable} onSelect={goToPhoneStep} />
        </section>

        {/* Steps 2 & 3 Combined: Group Images + Drag to Categories */}
        {uploadedImages.length > 0 && (
          <section className="step-section" data-step="2">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <h2>Step 2: Group & Categorize</h2>
              <button 
                onClick={() => setShowStep2Info(!showStep2Info)}
                style={{
                  background: 'var(--accent)',
                  border: 'none',
                  borderRadius: '50%',
                  width: '24px',
                  height: '24px',
                  cursor: 'pointer',
                  // Dark label on a solid accent fill — --text-primary on --accent is only 2.46:1.
                  color: 'var(--ink-950)',
                  fontSize: 'var(--fs-lg)',
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
                background: 'var(--accent-dim)',
                padding: '1rem',
                borderRadius: '8px',
                marginTop: '0.5rem',
                marginBottom: '1rem',
                borderLeft: '4px solid var(--accent)',
                fontSize: 'var(--fs-lg)'
              }}>
                <ul style={{ margin: 0, paddingLeft: '1.5rem' }}>
                  <li><MousePointerClick size={11} /> <strong>Click to select/unselect</strong> (click again to deselect)</li>
                  <li>⌨️ <strong>Shift+Click</strong> to select multiple at once</li>
                  <li><Link2 size={11} /> <strong>Click "Group Selected"</strong> - works with 1+ images</li>
                  <li><Scissors size={11} /> <strong>Click "Ungroup Selected"</strong> - removes selected images from groups</li>
                  <li><Move size={11} /> <strong>Drag photos</strong> onto a group card to add them to that group</li>
                  <li><Tag size={11} /> <strong>Drag a group card</strong> onto a category (right panel) to categorize it</li>
                  <li><Trash2 size={11} /> <strong>Click × button</strong> to delete unwanted images</li>
                </ul>
              </div>
            )}
            {/* Split pane: ImageGrouper left, CategoryZones right */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: '1fr 227px',
              gap: '3rem',
              alignItems: 'start',
            }} className="step2-split">
              {/* Left: Group images — ImageGrouper manages its own internal sidebar+scroll */}
              <div style={{ borderRadius: '8px', paddingBottom: '1rem' }}>
                <p className="step-description" style={{ marginTop: 0 }}>
                  Select &amp; group your product images, then drag groups to a category on the right.
                </p>
                <GrouperErrorBoundary>
                <ImageGrouper 
                  key={currentBatchId || 'no-batch'}
                  items={step2Items}
                  onGrouped={onGroupedStable}
                  onStatsChange={onStatsChangeStable} // stats now computed directly from processedItems
                  userId={user.id}
                  batchId={currentBatchId || undefined}
                  onImageDeleted={onImageDeletedStable}
                  onSelectionChange={setSelectedGroupItems}
                  onActionsReady={setGrouperActions}
                />
                </GrouperErrorBoundary>
              </div>
              {/* Right: Category drop zones — sticky so always visible */}
              <div className="step2-right-panel">
                <p className="step-description" style={{ marginTop: 0 }}>
                  Drag a group here to assign a category.
                </p>
                <GrouperErrorBoundary>
                <CategoryZones 
                  items={step2Items}
                  onCategorized={onCategorizedStable}
                  compactMode
                  selectedItemIds={selectedGroupItems}
                  onCategoryAssigned={onCategoryAssignedStable}
                />
                </GrouperErrorBoundary>
                {/* The selection actions (Group / Ungroup / Delete / Clear / Ungroup all)
                    live in ImageGrouper's toolbar now (Sept 15 2026). */}
                {/* Category Preset picker removed — presets applied via right-click or category drag */}
              </div>
            </div>
            {/* After .step2-split, so the sticky category dock (whose containing
                block is that div) has already settled into flow by the time this
                row is on screen and can never cover it. */}
            <PhoneStepNav step={2} reachable={phoneReachable} onSelect={goToPhoneStep} />
          </section>
        )}

        {/* Step 3: Add Descriptions */}
        {sortedImages.length > 0 && (
          /* id is the scroll target for openListingInStep3 (a scanned label). */
          <section className="step-section" id="step-3" data-step="3">
            <h2>Step 3: Add Voice Descriptions & Generate Product Info</h2>
            {(() => {
              // Always compute from processedItems — same source PDG uses for navigation.
              // grouperStats (from ImageGrouper) can diverge from processedItems when
              // groupedImages and processedItems are briefly out of sync.
              // Only count items that qualify for Step 3 (category set OR part of a multi-image group).
              const allGroupCounts: Record<string, number> = {};
              processedItems.forEach(i => { const k = i.productGroup || i.id; allGroupCounts[k] = (allGroupCounts[k] || 0) + 1; });
              const step3Items = processedItems.filter(i => i.category || allGroupCounts[i.productGroup || i.id] > 1);
              const groupMap: Record<string, number> = {};
              step3Items.forEach(i => { const k = i.productGroup || i.id; groupMap[k] = (groupMap[k] || 0) + 1; });
              const multiGroups = Object.values(groupMap).filter(c => c > 1).length;
              const singles = Object.values(groupMap).filter(c => c === 1).length;
              const totalListings = multiGroups + singles;
              const imageCount = step3Items.length;
              const excluded = processedItems.length - step3Items.length;

              if (multiGroups > 0 && singles > 0) {
                return (
                  <p style={{ color: 'var(--accent)', fontWeight: 500, marginBottom: '0.5rem', fontSize: 'var(--fs-sm)' }}>
                    <Package size={11} style={{ flexShrink: 0 }} /> {totalListings} total listing{totalListings !== 1 ? 's' : ''}: {multiGroups} multi-image group{multiGroups !== 1 ? 's' : ''} + {singles} single{singles !== 1 ? 's' : ''} ({imageCount} images) — use Next/Previous to navigate{excluded > 0 ? ` · ${excluded} uncategorized single${excluded !== 1 ? 's' : ''} hidden` : ''}
                  </p>
                );
              } else if (multiGroups > 0) {
                return (
                  <p style={{ color: 'var(--accent)', fontWeight: 500, marginBottom: '0.5rem', fontSize: 'var(--fs-sm)' }}>
                    <Package size={11} style={{ flexShrink: 0 }} /> {multiGroups} product group{multiGroups !== 1 ? 's' : ''} ({imageCount} images grouped) — use Next/Previous to navigate listings{excluded > 0 ? ` · ${excluded} uncategorized single${excluded !== 1 ? 's' : ''} hidden` : ''}
                  </p>
                );
              } else if (singles > 0) {
                return (
                  <p style={{ color: 'var(--accent)', fontWeight: 500, marginBottom: '0.5rem', fontSize: 'var(--fs-sm)' }}>
                    <Package size={11} style={{ flexShrink: 0 }} /> {singles} categorized listing{singles !== 1 ? 's' : ''} ({imageCount} image{imageCount !== 1 ? 's' : ''}) — use Next/Previous to navigate{excluded > 0 ? ` · ${excluded} uncategorized single${excluded !== 1 ? 's' : ''} hidden` : ''}
                  </p>
                );
              } else {
                return (
                  <p style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-sm)', marginBottom: '0.5rem' }}>
                    <AlertTriangle size={11} style={{ flexShrink: 0 }} /> No categorized items yet — go back to Step 2 and drag items to a category zone.
                  </p>
                );
              }
            })()}
            <ProductDescriptionGenerator
              key={currentBatchId ?? 'new'}
              onProcessed={onProcessedStable}
              onDownloadCSV={onDownloadCSVStable}
              batchId={currentBatchId}
              descriptionSettings={orgDescSettings}
              focusProductId={focusListingId}
            />
            <PhoneStepNav step={3} reachable={phoneReachable} onSelect={goToPhoneStep} />
          </section>
        )}

        {/* Step 4: Save & Export */}
        {processedItems.length > 0 && (
          <section className="step-section" data-step="4">
            {/* Multi-marketplace: which marketplaces this batch goes to, a
                readiness grid, a feed CSV per feed marketplace and a copy-ready
                pack per pack marketplace. Hides itself entirely until
                marketplaces.sql has been run, so Step 4 is unchanged until then.
                SHOPIFY'S CSV STAYS BELOW — GoogleSheetExporter dedups titles
                against the live store and runs the price gate, which the
                adapter's serialize() cannot (docs/marketplaces/03-step4.md). */}
            {user && (
              <MarketplaceExport
                orgId={currentOrg?.id ?? null}
                batchId={currentBatchId}
                items={step4ExportItems}
                vendorName={resolvedVendorName}
                descriptionSettings={orgDescSettings}
                isOrgAdmin={orgRole === 'owner' || orgRole === 'admin'}
                onToast={onToastStable}
                onOpenWorkspaceMarketplaces={onOpenWorkspaceMarketplaces}
              />
            )}
            <details>
              <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: 'var(--fs-md)', userSelect: 'none', padding: '0.25rem 0' }}>
                Step 4: Review &amp; Export ▾
              </summary>

              <div style={{ marginTop: '1rem' }}>
                <div className="batch-actions">
                  <button 
                    onClick={handleSaveBatch} 
                    className="button button-primary"
                    disabled={saving}
                  >
                    {saving ? <><Save size={13} /> Saving...</> : <><Save size={13} /> Save Batch to Database</>}
                  </button>
                  
                  <button 
                    onClick={handleClearBatch} 
                    className="button button-secondary"
                    disabled={saving}
                  >
                    <Trash2 size={13} style={{ flexShrink: 0 }} /> Clear Batch
                  </button>
                </div>

                <div className="export-section">
                  <h3>Export Options</h3>
                  {/* platformPricing: the workspace's marketplace price rules.
                      Undefined until settings resolve, which the exporter reads
                      as "not known yet" and falls back to no adjustment. */}
                  <GoogleSheetExporter
                    ref={exporterRef}
                    vendorName={resolvedVendorName}
                    platformPricing={orgDescSettings?.platformPricing}
                    items={step4ExportItems}
                  />
                </div>
              </div>
            </details>
            <PhoneStepNav step={4} reachable={phoneReachable} onSelect={goToPhoneStep} />
          </section>
        )}
      </main>

      {/* ══ Tool views ══════════════════════════════════════════════════════
          Formerly fixed-position modals over the workflow; each is now a full
          page under the header, inside the shared ToolView shell (title block,
          Back to workflow, Escape, one calm spacing scale). Every component
          keeps its `onClose` prop — Back is what calls it. */}

      {/* ── Home ────────────────────────────────────────────────────────────
          The landing page after sign-in. NOT inside <ToolView>: every tool view
          leads with "Back to workflow", and there is nothing to go back from on
          the page you arrive at. The workflow is parked behind <main hidden>
          exactly as it is behind every tool, so "exit batch" costs nothing and
          Resume is a re-reveal. */}
      {activeView === 'home' && user && (
        <Suspense fallback={<ViewFallback />}>
          <HomeDashboard
            userEmail={user.email ?? null}
            userId={user.id}
            orgName={currentOrg?.name ?? null}
            orgId={currentOrg?.id ?? null}
            isFounder={supportIsFounder}
            orgPlan={currentOrg?.plan ?? null}
            orgRole={currentOrg ? orgRole : null}
            descriptionSettings={orgDescSettings}
            navItems={navItems}
            activeBatchId={currentBatchId}
            activeBatchNumber={currentBatchNumber}
            items={processedItems}
            refreshTrigger={libraryRefreshTrigger}
            storage={storageInfo ? {
              ...storageInfo,
              limitGb: parseFloat(import.meta.env.VITE_STORAGE_LIMIT_GB || '100'),
            } : null}
            onResume={onHomeResumeStable}
            onStartNewBatch={onStartNewBatchStable}
            onOpenBatch={onHomeOpenBatchStable}
            onNavigate={onHomeNavigateStable}
            onOpenMarketplaces={onOpenWorkspaceMarketplaces}
          />
        </Suspense>
      )}

      {activeView === 'categories' && (
        <Suspense fallback={<ViewFallback />}>
          <ToolView
            icon={<Tag size={26} />}
            title="Categories"
            description="The categories you drag groups onto in Step 2. Each one carries an icon, a colour and its place in the list."
            onBack={goToWorkflow}
          >
            <CategoriesManager onClose={goToWorkflow} />
          </ToolView>
        </Suspense>
      )}

      {activeView === 'presets' && (
        <Suspense fallback={<ViewFallback />}>
          <ToolView
            icon={<Settings size={26} />}
            title="Category presets"
            description="Defaults applied the moment a category is assigned — shipping weight, which measurements to ask for, and the SEO title template."
            onBack={goToWorkflow}
          >
            <CategoryPresetsManager onClose={goToWorkflow} />
          </ToolView>
        </Suspense>
      )}

      {activeView === 'library' && user && (
        <Suspense fallback={<ViewFallback />}>
          <ToolView
            icon={<Package size={26} />}
            title="Library"
            description="Every batch, listing and image in this workspace. Open a batch to pick it back up where you left it."
            onBack={goToWorkflow}
            wide
          >
            <Library
              userId={user.id}
              onClose={onLibraryCloseStable}
              onOpenBatch={onOpenBatchStable}
              onBatchDeleted={onBatchDeletedStable}
              refreshTrigger={libraryRefreshTrigger}
              currentBatchId={currentBatchId}
            />
          </ToolView>
        </Suspense>
      )}

      {/* Products — the one surface that is not batch-shaped: search every
          listing in the workspace, correct its fields, give it a SKU and a
          barcode, put labels on it, print its label, or take it back into the
          workflow. `wide` because it is two columns of list and detail. */}
      {activeView === 'products' && user && (
        <Suspense fallback={<ViewFallback />}>
          <ToolView
            icon={<Boxes size={26} />}
            title="Products"
            description="Find any listing across every batch — then edit its fields, its barcode and its labels without leaving this page."
            onBack={goToWorkflow}
            wide
          >
            <ProductsView
              userId={user.id}
              currentBatchId={currentBatchId}
              onOpenInWorkflow={openListingInStep3}
              onListingEdited={handleListingEdited}
            />
          </ToolView>
        </Suspense>
      )}

      {activeView === 'workspace' && currentOrg && user && (
        <Suspense fallback={<ViewFallback />}>
          <ToolView
            icon={<Users size={26} />}
            title="Workspace"
            description="Who is in this workspace, what they can do, and how its listings are written and exported."
            onBack={goToWorkflow}
          >
            <OrgPanel
              org={currentOrg}
              myRole={orgRole}
              myUserId={user.id}
              initialTab={workspaceTab}
              onClose={goToWorkflow}
              onOrgUpdated={(org) => setCurrentOrg(org)}
              onMyRoleChanged={(role) => setOrgRole(role)}
              onLeftWorkspace={() => {
                // Membership is gone; reload so ensureOrganization re-bootstraps
                // into their next org (or the waitlist / a fresh workspace).
                setActiveView('workflow');
                window.location.reload();
              }}
              onDescriptionSettingsChanged={(s) => setOrgDescSettings(s)}
              onOpenFounder={isFoundingAdmin ? onOpenFounderStable : undefined}
            />
          </ToolView>
        </Suspense>
      )}

      {/* Founder console (founding admins only) — running the BETA, as opposed
          to running a workspace: requests, every workspace, plans, invites and
          every account. The three sections it consolidated used to be tabs
          inside the Workspace dashboard above. */}
      {activeView === 'founder' && user && currentOrg?.slug === 'founding' && (orgRole === 'owner' || orgRole === 'admin') && (
        <Suspense fallback={<ViewFallback />}>
          <ToolView
            wide
            icon={<ShieldCheck size={26} />}
            title="Founder console"
            description="Approve shops, onboard a workspace before its owner signs in, set plans, and manage every account across every workspace."
            onBack={goToWorkflow}
          >
            <FounderConsole
              myUserId={user.id}
              myOrgId={currentOrg.id}
              onMyRoleChanged={(role) => setOrgRole(role)}
            />
          </ToolView>
        </Suspense>
      )}

      {/* Vocabulary (founding admins only — chips + brand keywords, global content) */}
      {activeView === 'vocabulary' && currentOrg?.slug === 'founding' && (orgRole === 'owner' || orgRole === 'admin') && (
        <Suspense fallback={<ViewFallback />}>
          <ToolView
            icon={<BookMarked size={26} />}
            title="Vocabulary"
            description="The quick keyword chips and brand words every workspace's descriptions are written from. Edited here, used everywhere."
            onBack={goToWorkflow}
          >
            <VocabDashboard />
          </ToolView>
        </Suspense>
      )}

      {/* Analytics + Errors — one view, two tabs. Both read this project's own
          tables (analytics_events, app_errors); no third-party service. */}
      {activeView === 'analytics' && currentOrg?.slug === 'founding' && (orgRole === 'owner' || orgRole === 'admin') && (
        <Suspense fallback={<ViewFallback />}>
          <ToolView
            icon={<BarChart3 size={26} />}
            title="Analytics"
            description="First-party pageviews, funnel, referrers and devices — plus everything that threw, in the Errors tab."
            onBack={goToWorkflow}
            tabs={
              <>
                <button
                  role="tab"
                  aria-selected={analyticsTab === 'overview'}
                  className={`tool-view-tab${analyticsTab === 'overview' ? ' tool-view-tab--on' : ''}`}
                  onClick={() => setAnalyticsTab('overview')}
                >
                  <BarChart3 size={14} /> Overview
                </button>
                <button
                  role="tab"
                  aria-selected={analyticsTab === 'errors'}
                  className={`tool-view-tab${analyticsTab === 'errors' ? ' tool-view-tab--on' : ''}`}
                  onClick={() => setAnalyticsTab('errors')}
                >
                  <AlertTriangle size={14} /> Errors
                </button>
              </>
            }
          >
            {analyticsTab === 'overview' ? <AnalyticsPanel /> : <ErrorsPanel />}
          </ToolView>
        </Suspense>
      )}

      {activeView === 'crm' && currentOrg?.slug === 'founding' && (orgRole === 'owner' || orgRole === 'admin') && (
        <Suspense fallback={<ViewFallback />}>
          <ToolView
            icon={<Contact size={26} />}
            title="CRM"
            description="Every beta request and account as a contact, with stages, follow-ups and notes."
            onBack={goToWorkflow}
          >
            <CrmPanel />
          </ToolView>
        </Suspense>
      )}

      {/* Finance — the founder's books. Same first-party model as Analytics and
          the CRM: our own tables, one SECURITY DEFINER aggregate, no vendor. */}
      {activeView === 'finance' && currentOrg?.slug === 'founding' && (orgRole === 'owner' || orgRole === 'admin') && (
        <Suspense fallback={<ViewFallback />}>
          <ToolView
            icon={<Wallet size={26} />}
            title="Finance"
            description="Income, expenses and profit over any range, what the customer base is worth, and reports you can download or print."
            onBack={goToWorkflow}
          >
            <FinanceView />
          </ToolView>
        </Suspense>
      )}

      {/* Team board (Founding Workspace — EVERY member, not just admins: the
          whole point is that anyone can add and pick up work) */}
      {activeView === 'board' && currentOrg && user && currentOrg.slug === 'founding' && (
        <Suspense fallback={<ViewFallback />}>
          <ToolView
            icon={<KanbanSquare size={26} />}
            title="Board"
            description="Features and todos for this workspace. Anyone here can add a card and pick one up."
            onBack={goToWorkflow}
            wide
            /* KanbanBoard owns Escape: it closes an open card drawer first. */
            escapeToBack={false}
          >
            <KanbanBoard
              orgId={currentOrg.id}
              userId={user.id}
              userEmail={user.email ?? null}
              onClose={goToWorkflow}
            />
          </ToolView>
        </Suspense>
      )}

      {/* Messages — the full-page half of support messaging. The floating
          widget below is unchanged; both read ONE thread list from
          supportStore, which owns the single Realtime channel + poll. */}
      {activeView === 'messages' && (
        <Suspense fallback={<ViewFallback />}>
          <ToolView
            icon={<MessageSquare size={26} />}
            title={supportIsFounder ? 'Inbox' : 'Messages'}
            description={supportIsFounder
              ? 'Every support conversation with every workspace, plus your own workspace’s team threads. Reply, close what is handled, reopen what is not.'
              : 'Talk to the Arcadian team, or message people in your workspace. Ask anything — we read everything and usually reply within a day.'}
            onBack={goToWorkflow}
            wide
          >
            <MessagesView
              userEmail={user.email ?? null}
              orgName={supportOrgName}
              userId={user.id}
              /* Only my OWN workspace's members can be added to a team thread —
                 org_members' SELECT policy already scopes this to what I may
                 read, and the INSERT policy proves it again server-side. */
              orgId={currentOrg?.id ?? null}
              isFounder={supportIsFounder}
            />
          </ToolView>
        </Suspense>
      )}

      {/* Labels — printable shelf labels for the open batch. `wide` because the
          sheet preview is a letter page and the reading measure would crop it.
          The view reads workflowStore directly and never writes an item back;
          its only write is assigning SKUs to `products`. */}
      {activeView === 'labels' && user && (
        <Suspense fallback={<ViewFallback />}>
          <ToolView
            icon={<Printer size={26} />}
            title="Labels"
            description="Print shelf labels for this batch — title, size, price, your colour and vendor labels, and a scannable barcode."
            onBack={goToWorkflow}
            wide
          >
            <LabelPrintView onOpenListing={openListingInStep3} />
          </ToolView>
        </Suspense>
      )}

      {/* Scan — camera, USB scanner or a typed SKU, back to the listing. */}
      {activeView === 'scan' && user && (
        <Suspense fallback={<ViewFallback />}>
          <ToolView
            icon={<ScanLine size={26} />}
            title="Scan"
            description="Point the camera at a label, use a USB scanner, or type a SKU to pull up the listing."
            onBack={goToWorkflow}
          >
            <BarcodeScannerView onOpenListing={openListingInStep3} />
          </ToolView>
        </Suspense>
      )}

      {/* ── Phone navigation (≤640px) ───────────────────────────────────────
          The fixed bottom tab bar. Deliberately OUTSIDE <header>: the header is
          `position: sticky; z-index: 100`, which makes it a stacking context,
          and a fixed child of it would be trapped at that level. (The workspace
          menu escapes the same trap by portaling to <body>.) */}
      <MobileTabBar
        activeView={activeView}
        onSelect={navigateToView}
        onGoWorkflow={goToWorkflow}
        isFounder={supportIsFounder}
        /* "More" opens the SAME workspace menu the header trigger does — it
           renders as a bottom sheet at this width. One component, one list. */
        onOpenMore={() => setNavMenuOpen(true)}
        moreOpen={navMenuOpen}
      />

      {/* ── Bottom-left corner: keyboard shortcuts + the debug-logging switch.
          One control where the floating debug button used to be, mirroring the
          support FAB in the opposite corner. */}
      {showShortcuts && <ShortcutsPanel open={shortcutsOpen} onOpenChange={setShortcutsOpen} />}

      {/* ── Support messaging (first-party): every signed-in user can message
          the founders; Founding admins get the inbox of every conversation. */}
      <SupportWidget
        userEmail={user.email ?? null}
        orgName={supportOrgName}
        isFounder={supportIsFounder}
      />

      {/* ── Toast notifications ─────────────────────────────────────────────── */}
      {toasts.length > 0 && (
        <div className="toast-stack">
          {toasts.map(t => (
            <div key={t.id} className="toast-item">
              <span>{t.msg}</span>
              <button className="toast-dismiss" onClick={() => dismissToast(t.id)}><X size={11} /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default App;
