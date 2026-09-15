/**
 * HOME DASHBOARD — the pure half.
 *
 * Everything the landing dashboard counts, derived from data it is handed
 * rather than fetched. It lives here for the same reason `phoneSteps.ts` and
 * `libraryData.ts` do: the widget that renders these numbers has no component
 * harness worth the trouble, and a count that is wrong is invisible until a
 * founder notices the page disagrees with the Library.
 *
 * NOTHING HERE TOUCHES SUPABASE. The dashboard's fetches live in the component;
 * these functions only shape what came back.
 */

import type { ClothingItem } from '../App';
import { buildGroupArray } from './grouping';
import { makeBatchName } from './libraryData';
import type { WorkflowBatch } from './workflowBatchService';
import type { PublicationRow, PublicationStatus } from './marketplaceService';
import { PUBLICATION_STATUSES } from './marketplaceService';

/* ── The open batch ───────────────────────────────────────────────────────── */

export interface BatchSummary {
  /** Every item in the batch — one per photo. */
  photos: number;
  /** True multi-photo groups: how many cards in Step 2 hold more than one photo. */
  groups: number;
  /**
   * How many LISTINGS Step 3 would walk through — `buildGroupArray().length`,
   * i.e. the same visibility rule Steps 3 and 4 apply (categorized items plus
   * true multi-image groups). Deliberately the shared builder and not a second
   * count of its own, so the widget can never disagree with the step it links to.
   */
  listings: number;
  /** Items carrying a category. The signal `resumeStep` reads. */
  categorized: number;
}

const EMPTY_SUMMARY: BatchSummary = { photos: 0, groups: 0, listings: 0, categorized: 0 };

/** Counts for the Current-batch widget. Safe on an empty or absent list. */
export function batchSummary(items: readonly ClothingItem[] | null | undefined): BatchSummary {
  if (!items || items.length === 0) return EMPTY_SUMMARY;

  const perGroup = new Map<string, number>();
  let categorized = 0;
  for (const item of items) {
    if (item.category) categorized++;
    const key = item.productGroup || item.id;
    perGroup.set(key, (perGroup.get(key) ?? 0) + 1);
  }

  let groups = 0;
  for (const count of perGroup.values()) if (count > 1) groups++;

  return {
    photos: items.length,
    groups,
    listings: buildGroupArray(items as ClothingItem[]).length,
    categorized,
  };
}

/* ── Recent batches ───────────────────────────────────────────────────────── */

/** What `fetchWorkflowBatchesMeta` returns — the blob-free projection. */
export type BatchMeta = Omit<WorkflowBatch, 'workflow_state'>;

export interface RecentBatchRow {
  id: string;
  /** Display name: the user's own, else a date-stamped fallback. */
  name: string;
  /** ISO — the widget formats it through `formatRelative`. */
  updatedAt: string;
  /** 1-4, clamped. `current_step` is an int column with no CHECK behind it. */
  step: number;
  photos: number;
  listings: number;
}

/**
 * `batch_name` is nullable AND has historically been saved as the literal
 * four-character string "null" (AGENTS.md §14 #6), which `||` cannot catch —
 * a row like that would print "null" as a batch title on the landing page.
 */
function displayName(b: BatchMeta): string {
  const raw = typeof b.batch_name === 'string' ? b.batch_name.trim() : '';
  const named = raw && raw.toLowerCase() !== 'null' ? raw : undefined;
  return makeBatchName({ batch_name: named, created_at: b.created_at });
}

const clampStepNumber = (n: unknown): number => {
  const v = typeof n === 'number' && Number.isFinite(n) ? Math.round(n) : 1;
  return Math.min(4, Math.max(1, v));
};

/**
 * The N most recently touched batches, EXCLUDING the one already open — it has
 * a widget of its own directly above, and listing it twice makes the page look
 * like it has lost track of which batch you are in.
 *
 * Server order (`updated_at DESC`) is preserved rather than re-sorted: the
 * query already ordered, and re-sorting on a string date would quietly disagree
 * with the Library for two rows written in the same second.
 */
export function recentBatchRows(
  meta: readonly BatchMeta[] | null | undefined,
  activeBatchId: string | null | undefined,
  limit = 5,
): RecentBatchRow[] {
  if (!meta || meta.length === 0 || limit <= 0) return [];
  const rows: RecentBatchRow[] = [];
  for (const b of meta) {
    if (!b?.id) continue;
    if (activeBatchId && b.id === activeBatchId) continue;
    rows.push({
      id: b.id,
      name: displayName(b),
      updatedAt: b.updated_at ?? b.created_at,
      step: clampStepNumber(b.current_step),
      photos: typeof b.total_images === 'number' ? b.total_images : 0,
      listings: typeof b.product_groups_count === 'number' ? b.product_groups_count : 0,
    });
    if (rows.length >= limit) break;
  }
  return rows;
}

/* ── Marketplace publications ─────────────────────────────────────────────── */

export type PublicationCounts = Record<PublicationStatus, number> & {
  /** Every row counted, including statuses the widget does not render. */
  total: number;
  /** How many DISTINCT listings have at least one publication row. */
  listings: number;
};

const zeroCounts = (): PublicationCounts => {
  const out = { total: 0, listings: 0 } as PublicationCounts;
  for (const s of PUBLICATION_STATUSES) out[s] = 0;
  return out;
};

/**
 * Publication rows folded into one count per status.
 *
 * A row per (listing × marketplace) is the table's unit, so `total` counts
 * PLACEMENTS and `listings` counts products — the two are different numbers the
 * moment a shop cross-lists, and conflating them is how a "12 posted" reads as
 * twelve garments when it is four garments on three marketplaces.
 */
export function publicationCounts(
  rows: readonly PublicationRow[] | null | undefined,
): PublicationCounts {
  const counts = zeroCounts();
  if (!rows || rows.length === 0) return counts;
  const seen = new Set<string>();
  for (const row of rows) {
    if (!row) continue;
    if (Object.prototype.hasOwnProperty.call(counts, row.status)) counts[row.status]++;
    counts.total++;
    if (row.product_group_id) seen.add(row.product_group_id);
  }
  counts.listings = seen.size;
  return counts;
}

/* ── Storage meter ────────────────────────────────────────────────────────── */

export interface StorageReadout {
  usedGb: string;
  limitGb: number;
  /** 0-100, clamped — a bucket over its plan must not render a 310% bar. */
  percent: number;
  /** Over 85% of the plan: the meter turns and the hint says so. */
  nearLimit: boolean;
}

const GB = 1024 * 1024 * 1024;

/**
 * The same figures the workspace menu's storage row shows, formatted once.
 * `limitGb` comes from VITE_STORAGE_LIMIT_GB and may be anything, including 0
 * in a misconfigured env — which is why the percentage is guarded rather than
 * divided straight through.
 */
export function storageReadout(usedBytes: number, limitGb: number): StorageReadout {
  const used = Number.isFinite(usedBytes) && usedBytes > 0 ? usedBytes : 0;
  const limit = Number.isFinite(limitGb) && limitGb > 0 ? limitGb : 0;
  const usedGbNum = used / GB;
  const raw = limit > 0 ? (usedGbNum / limit) * 100 : 0;
  const percent = Math.min(100, Math.max(0, Math.round(raw)));
  return {
    usedGb: usedGbNum >= 10 ? usedGbNum.toFixed(0) : usedGbNum.toFixed(1),
    limitGb: limit,
    percent,
    // Read off the RAW ratio, not the clamped one: a bucket at 310% must still
    // say "nearly full", and 100 is also a legitimate exactly-full reading.
    nearLimit: limit > 0 && raw >= 85,
  };
}
