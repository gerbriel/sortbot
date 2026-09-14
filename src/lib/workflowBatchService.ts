import { supabase } from './supabase';
import { log } from './debugLogger';
import { filterUnreferencedStoragePaths } from './storageSafety';
import { publicImageUrl } from './storageUrls';
import { chunked } from './chunk';
import type { PersistedWorkflowItem } from './slimItems';

/**
 * The persisted-item type lives in `lib/slimItems.ts`, beside the function that
 * writes it. This module used to declare its own 5-field `SlimItem` while
 * `slimForWorkflowState` had been persisting 15 fields for a year — the type said
 * the blob held less than it did, so every consumer papered over the gap with
 * `as ClothingItem` (architecture review finding #13). Re-exported here because
 * this is where `WorkflowBatch` lives and most consumers import it alongside.
 */
export type { PersistedWorkflowItem, SlimWorkflowItem } from './slimItems';

export interface WorkflowBatch {
  id: string;
  user_id: string;
  batch_name?: string;
  batch_number: string;
  current_step: number;
  is_completed: boolean;
  total_images: number;
  product_groups_count: number;
  categorized_count: number;
  processed_count: number;
  saved_products_count: number;
  workflow_state?: {
    // All four are PersistedWorkflowItem[]: new saves hold slim items, legacy
    // batches hold whole ClothingItems, and the type admits both. In practice
    // autoSaveWorkflowBatch writes only `processedItems` and leaves the other
    // three empty (AGENTS.md §11) — but every restore path still falls back
    // through all four, so they are all typed.
    uploadedImages?: PersistedWorkflowItem[];
    groupedImages?: PersistedWorkflowItem[];
    sortedImages?: PersistedWorkflowItem[];
    processedItems?: PersistedWorkflowItem[];
    lastEditedBy?: string;   // email of the user who last saved this batch
    lastEditedAt?: string;   // ISO timestamp of the last save
  };
  thumbnail_url?: string;
  created_at: string;
  updated_at: string;
  last_opened_at?: string;
  tags?: string[];
  notes?: string;
  // Surfaced from workflow_state JSONB for the Library list (collaborative edit note).
  lastEditedBy?: string;
  lastEditedAt?: string;
}

// ── Deleted-batch tombstones ─────────────────────────────────────────────────
// Once a batch is confirmed deleted, its id goes here (memory + localStorage).
// autoSaveWorkflowBatch checks this so a session that still holds the batch in
// memory can never resurrect it — the root cause of "I deleted the batch and it
// came back": auto-save saw the row missing and re-created it with the same content.
const TOMBSTONES_KEY = 'sortbot_deleted_batch_ids';
const deletedBatchIds = new Set<string>((() => {
  try {
    const v = JSON.parse(localStorage.getItem(TOMBSTONES_KEY) || '[]');
    return Array.isArray(v) ? (v as string[]) : [];
  } catch { return []; }
})());

export function markBatchDeleted(batchId: string): void {
  deletedBatchIds.add(batchId);
  forgetAutoSaveFingerprint(batchId);
  try {
    // Keep the persisted list bounded — 200 most recent is far more than enough.
    localStorage.setItem(TOMBSTONES_KEY, JSON.stringify([...deletedBatchIds].slice(-200)));
  } catch { /* localStorage unavailable — in-memory set still protects this session */ }
}

export function isBatchDeleted(batchId: string | null | undefined): boolean {
  return !!batchId && deletedBatchIds.has(batchId);
}

// Batches whose row this session has CONFIRMED exists in the DB (a successful
// UPDATE or fetch). If a confirmed batch's row later vanishes, it was deleted —
// possibly by ANOTHER user in the shared workspace, so the local tombstone set
// won't know about it. In that case auto-save must NOT re-create it.
const confirmedBatchIds = new Set<string>();

/** Call when a batch row has been fetched/opened successfully outside this module
 *  (App.tsx startup restore and handleOpenBatch fetch rows directly). */
export function markBatchConfirmed(batchId: string): void {
  confirmedBatchIds.add(batchId);
}
// ─────────────────────────────────────────────────────────────────────────────

// ── Unchanged-payload skip (DB CPU) ──────────────────────────────────────────
// Step 3 is the worst offender the profiler found: every keystroke in a product
// field fires `onProcessed` → `autoSaveWorkflow`, and the resulting UPDATE
// rewrites the WHOLE `workflow_state` JSONB — up to ~500 KB after the slim pass
// — even though none of those fields is IN the slim payload (they live in
// `products`, written separately by PDG's own 500 ms save). Postgres pays for
// that twice: a TOAST rewrite and a full WAL record, per save, per user.
//
// So: hash the payload, and if it is byte-identical to the last one Postgres
// ACCEPTED for this batch, don't send the UPDATE at all.
//
// WHAT IS DELIBERATELY EXCLUDED FROM THE HASH: `lastEditedAt`, which
// `autoSaveWorkflow` stamps with `new Date().toISOString()` on every single
// call. Include it and nothing is ever equal. `lastEditedBy` IS included, so a
// different teammate editing the same batch always writes (the Library's
// "edited by X" stays correct).
//
// AND THE ONE OBSERVABLE DIFFERENCE, STATED PLAINLY: a skipped save does not
// advance `updated_at` / `last_opened_at`. A long Step-3 session that only
// edits `products` fields therefore no longer re-sorts the batch to the top of
// the Library on every keystroke. `AUTOSAVE_FINGERPRINT_MAX_AGE_MS` bounds that:
// after this long, the next save goes through even if nothing changed, so the
// timestamps still advance during an active session — just once every few
// minutes instead of once every few seconds.
export const AUTOSAVE_FINGERPRINT_MAX_AGE_MS = 5 * 60_000;

const lastSavedFingerprints = new Map<string, { hash: string; at: number }>();

/**
 * cyrb53 — a fast, well-distributed non-cryptographic 53-bit hash. Prefixed with
 * the serialized length so two payloads must collide in BOTH to be treated as
 * equal. This is a write-elision optimisation, not a security boundary.
 */
function cyrb53(str: string): number {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/** Stable fingerprint of a workflow_state payload, ignoring `lastEditedAt`. Pure. */
export function workflowStateFingerprint(state: WorkflowBatch['workflow_state']): string {
  const json = JSON.stringify(state, (k, v) => (k === 'lastEditedAt' ? undefined : v)) ?? '';
  return `${json.length}:${cyrb53(json).toString(36)}`;
}

/**
 * True when this exact payload was already accepted for this batch recently
 * enough that re-sending it would be pure waste. Pure w.r.t. its arguments —
 * the registry is module state, seeded only by `rememberAutoSaveFingerprint`.
 */
export function shouldSkipAutoSave(
  batchId: string | null,
  hash: string,
  now: number = Date.now(),
): boolean {
  if (!batchId) return false;
  const prev = lastSavedFingerprints.get(batchId);
  if (!prev || prev.hash !== hash) return false;
  return now - prev.at < AUTOSAVE_FINGERPRINT_MAX_AGE_MS;
}

/** Record a payload Postgres ACCEPTED. Never call this for a failed/blocked write. */
export function rememberAutoSaveFingerprint(
  batchId: string,
  hash: string,
  now: number = Date.now(),
): void {
  lastSavedFingerprints.set(batchId, { hash, at: now });
}

/** Drop a batch's fingerprint — deletion, or any path that invalidates the row. */
export function forgetAutoSaveFingerprint(batchId: string): void {
  lastSavedFingerprints.delete(batchId);
}

/** Test hook. */
export function resetAutoSaveFingerprints(): void {
  lastSavedFingerprints.clear();
}
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch all workflow batches (collaborative - all users see all batches)
 */
/**
 * The columns `fetchWorkflowBatches` returns. Every field any consumer reads off
 * one of these rows, and nothing else.
 *
 * Consumers, all verified by grep: `deriveLibraryData` (`id`, `created_at`,
 * `workflow_state`), Library's batch cards (`batch_name`, `batch_number`,
 * `created_at`, `updated_at`, `current_step`, `is_completed`, `total_images`,
 * `product_groups_count`, and `lastEditedBy` — which it reads out of
 * `workflow_state` when the projected alias is absent), and `handleOpenBatch`
 * (`batch_number`, `last_opened_at`).
 *
 * DELIBERATELY OMITTED because nothing reads them here: `thumbnail_url` (a long
 * URL per row), `tags` and `notes` (AGENTS.md §7 marks both "not used"). The
 * three remaining count columns are kept only because `WorkflowBatch` declares
 * them non-optional, so dropping them would make the type a lie.
 *
 * Keep in sync with `deriveLibraryData` (lib/libraryData.ts) and `handleOpenBatch`
 * (App.tsx) if either grows a new field.
 */
const WORKFLOW_BATCH_RESTORE_COLUMNS = [
  'id', 'user_id', 'batch_name', 'batch_number', 'current_step', 'is_completed',
  'total_images', 'product_groups_count', 'categorized_count', 'processed_count',
  'saved_products_count', 'created_at', 'updated_at', 'last_opened_at', 'workflow_state',
].join(', ');

export async function fetchWorkflowBatches(): Promise<WorkflowBatch[]> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      console.warn('[fetchWorkflowBatches] no authenticated user — returning []');
      return []; // not authenticated or network unavailable — silently return empty
    }

    // NARROWED + PAGINATED (architecture review finding #14). This was
    // `select('*')` with no limit, which:
    //   • pulled `thumbnail_url`, `tags` and `notes`, which no consumer of this
    //     function reads, and
    //   • SILENTLY TRUNCATED at PostgREST's 1000-row max-rows cap, so a workspace
    //     past 1000 batches simply stopped seeing its oldest ones in the Library.
    // See WORKFLOW_BATCH_RESTORE_COLUMNS for who reads what.
    const PAGE = 1000;
    const rows: WorkflowBatch[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from('workflow_batches')
        .select(WORKFLOW_BATCH_RESTORE_COLUMNS)
        .order('updated_at', { ascending: false })
        .range(from, from + PAGE - 1);

      if (error) throw error;
      const page = (data || []) as unknown as WorkflowBatch[];
      rows.push(...page);
      // A short page means we reached the end. A full page could still be the end,
      // in which case the next request returns 0 rows and costs one round trip —
      // the same trade fetchSavedProducts/fetchSavedImages already make.
      if (page.length < PAGE) break;
    }
    log.service(`fetchWorkflowBatches | rows=${rows.length}`);
    return rows;
  } catch (error: any) {
    if (error?.name === 'AbortError') return []; // expected from React 18 Strict Mode cleanup
    if (error?.message === 'Failed to fetch') return []; // network down / Supabase unreachable
    console.error('Error fetching workflow batches:', error);
    return [];
  }
}

/**
 * Fetch only batch metadata — excludes the heavy workflow_state JSONB blob.
 * Used for Phase 1 of Library load so the batch list renders immediately.
 */
export async function fetchWorkflowBatchesMeta(): Promise<Omit<WorkflowBatch, 'workflow_state'>[]> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return [];
    const { data, error } = await supabase
      .from('workflow_batches')
      .select('id, user_id, batch_name, batch_number, current_step, is_completed, total_images, product_groups_count, categorized_count, processed_count, saved_products_count, created_at, updated_at, lastEditedBy:workflow_state->>lastEditedBy, lastEditedAt:workflow_state->>lastEditedAt')
      .order('updated_at', { ascending: false });
    if (error) throw error;
    log.service(`fetchWorkflowBatchesMeta | rows=${(data || []).length}`);
    return (data || []) as Omit<WorkflowBatch, 'workflow_state'>[];
  } catch (error: any) {
    if (error?.name === 'AbortError') return [];
    if (error?.message === 'Failed to fetch') return [];
    console.error('Error fetching workflow batch metadata:', error);
    return [];
  }
}

/**
 * Create a new workflow batch
 */
export async function createWorkflowBatch(
  batchNumber: string,
  workflowState: WorkflowBatch['workflow_state'],
  stats: {
    total_images: number;
    product_groups_count: number;
    categorized_count: number;
    processed_count: number;
  }
): Promise<WorkflowBatch | null> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    // Get thumbnail from first image — only slim items are stored, so imageUrls when
    // present, else rebuilt from storagePath. slimForWorkflowState now omits imageUrls
    // for any item that HAS a storagePath (perf finding F8: it was a byte-identical
    // re-derivation and half the autosave payload), so this column would otherwise
    // have started coming out null for every new batch.
    const firstItem = workflowState?.processedItems?.[0];
    const thumbnail_url = firstItem?.imageUrls?.[0]
      ?? (publicImageUrl(firstItem?.storagePath) || undefined);

    const { data, error } = await supabase
      .from('workflow_batches')
      .insert({
        user_id: user.id,
        batch_number: batchNumber,
        current_step: determineCurrentStep(workflowState),
        total_images: stats.total_images,
        product_groups_count: stats.product_groups_count,
        categorized_count: stats.categorized_count,
        processed_count: stats.processed_count,
        workflow_state: workflowState,
        thumbnail_url,
        last_opened_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Error creating workflow batch:', error);
    return null;
  }
}

/**
 * Update an existing workflow batch
 */
export async function updateWorkflowBatch(
  batchId: string,
  updates: Partial<WorkflowBatch>
): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('workflow_batches')
      .update({
        ...updates,
        last_opened_at: new Date().toISOString(),
      })
      .eq('id', batchId);

    if (error) {
      console.error('Error updating workflow batch:', error);
      throw error;
    }
    
    return true;
  } catch (error) {
    console.error('❌ Error updating workflow batch:', error);
    return false;
  }
}

/**
 * Remove specific item IDs from all workflow_state arrays of a batch.
 * Call this after deleting individual images or product groups from the Library
 * so the items don't resurrect on the next loadAll() (which reads from workflow_state).
 */
/**
 * Remove items from a batch's `workflow_state` blob.
 *
 * ── WHY THIS IS COMPARE-AND-SET (architecture review finding #2) ──
 *
 * `workflow_batches.workflow_state` has TWO unsynchronised writers: App's
 * auto-save does a blind whole-blob UPDATE every 2 s, and this function does a
 * read-modify-write. Unguarded, the interleaving
 *
 *     Library READ blob → App UPDATE blob (new grouping) → Library UPDATE blob
 *
 * silently discards everything App wrote in between, because Library's write
 * carries the blob it read before App's write existed. With a 2 s debounce on one
 * side and a network round trip on the other, that window is easy to hit.
 *
 * So the UPDATE is now guarded on the `updated_at` value we read: a BEFORE UPDATE
 * trigger stamps `updated_at = NOW()` on every write to this table
 * (`create_workflow_batches.sql:98-109`), which makes it a reliable version token.
 * If the guard matches nothing, someone wrote in between — we re-read and re-apply
 * ONCE, then give up rather than loop.
 *
 * On the normal path (no concurrent writer) the guard matches on the first try and
 * behaviour is exactly what it was, one extra column in the SELECT aside.
 *
 * STILL NOT FIXED, and it is the user-visible half: App's in-memory store is not
 * told about the deletion, so if the batch is OPEN its next auto-save re-adds the
 * items ("resurrection"). That needs an `onItemsDeleted` callback into App —
 * written up as a proposal in docs/reviews/01-architecture-refactors.md because it
 * is a deliberate behaviour change, not a refactor.
 *
 * @returns true when the blob was updated (or there was nothing to update).
 */
export async function removeItemsFromWorkflowBatch(
  batchId: string,
  itemIds: string[]
): Promise<boolean> {
  if (!batchId || itemIds.length === 0) return true;
  const idSet = new Set(itemIds);
  const filter = (arr: any[] | undefined) => (arr ?? []).filter((i: any) => !idSet.has(i.id));

  /** One read-modify-write attempt. null = nothing to do; false = lost the race. */
  const attempt = async (): Promise<boolean | null> => {
    const { data } = await supabase
      .from('workflow_batches')
      .select('workflow_state, updated_at')
      .eq('id', batchId)
      .maybeSingle();
    if (!data?.workflow_state) return null;
    const ws = data.workflow_state;
    const { data: updated } = await supabase
      .from('workflow_batches')
      .update({
        workflow_state: {
          ...ws,
          uploadedImages:  filter(ws.uploadedImages),
          groupedImages:   filter(ws.groupedImages),
          sortedImages:    filter(ws.sortedImages),
          processedItems:  filter(ws.processedItems),
        }
      })
      .eq('id', batchId)
      // The compare-and-set. Dropping this line restores the lost-update bug.
      .eq('updated_at', data.updated_at)
      .select('id');
    return (updated?.length ?? 0) > 0;
  };

  try {
    const first = await attempt();
    if (first === null || first === true) return true;
    log.service(`removeItemsFromWorkflowBatch | CAS miss on ${batchId} — retrying once`);
    const second = await attempt();
    if (second === false) {
      console.warn(`[removeItemsFromWorkflowBatch] lost the race twice on ${batchId}; workflow_state not updated`);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[removeItemsFromWorkflowBatch] error:', err);
    return false;
  }
}

/**
 * Delete a workflow batch: its products, their product_images rows, and the
 * storage objects no other batch still references.
 *
 * ORDER MATTERS (findings 4 & 5, F13):
 *  - the product id lookup is PAGINATED at 1,000 (F13). Unpaginated it stopped at
 *    PostgREST's row cap, so a 1,500-product batch silently kept 500 products'
 *    image rows and storage files — and the partial id list also made the
 *    reference count keep files it should have deleted;
 *  - the product_images lookup is CHUNKED at 100. Unchunked, a >~700-image batch
 *    blew past PostgREST's URL length limit: `imageRows` came back undefined, the
 *    error was not even destructured, and the storage phase silently no-op'd —
 *    every file in the batch leaked into the bucket forever (the DB still came out
 *    clean via the products cascade, which is why it went unnoticed);
 *  - `filterUnreferencedStoragePaths` MUST run while the product_images rows still
 *    exist (AGENTS.md §18 #15), so safePaths is computed FIRST;
 *  - nothing destructive happens until the authoritative `workflow_batches` delete
 *    is CONFIRMED. Previously storage and products were destroyed before it, so an
 *    RLS-blocked batch delete returned false to a Library that had already lost the
 *    images, leaving an un-deletable husk.
 */
export async function deleteWorkflowBatch(batchId: string): Promise<boolean> {

  const PAGE = 1000;      // PostgREST caps every response at 1,000 rows
  const MAX_PAGES = 50;   // 50,000 products — a server that keeps answering with
                          // full pages must never spin this loop forever
  try {
    // ── 1. Read everything we need BEFORE deleting anything ──────────────────
    // PAGINATED (finding F13 — this was a DATA-LOSS bug, not a slow query): an
    // unpaginated select silently stops at the 1,000-row cap, so deleting a
    // 1,500-product batch left 500 products' product_images rows AND their storage
    // files behind forever — and handed filterUnreferencedStoragePaths a partial
    // deletion set, which then also KEPT files it should have deleted. Same idiom
    // as libraryService.fetchSavedImages.
    const batchProductIds: string[] = [];
    let productIdsComplete = true;
    for (let page = 0; ; page++) {
      if (page >= MAX_PAGES) {
        console.warn(`[deleteWorkflowBatch] products id lookup hit the ${MAX_PAGES}-page guard — treating the id list as incomplete`);
        productIdsComplete = false;
        break;
      }
      const from = page * PAGE;
      const { data, error } = await supabase
        .from('products')
        .select('id')
        .eq('batch_id', batchId)
        .range(from, from + PAGE - 1);
      if (error) {
        console.warn('[deleteWorkflowBatch] products id lookup failed:', error.message);
        productIdsComplete = false;
        break;
      }
      const rows = (data ?? []) as Array<{ id: string }>;
      if (rows.length === 0) break;
      batchProductIds.push(...rows.map(r => r.id));
      if (rows.length < PAGE) break;   // short page — that was the last one
    }

    const imageRows: Array<{ id: string; storage_path: string | null }> = [];
    let imageLookupComplete = true;
    for (const idChunk of chunked(batchProductIds)) {
      const { data, error } = await supabase
        .from('product_images')
        .select('id, storage_path')
        .in('product_id', idChunk);
      if (error) {
        console.warn('[deleteWorkflowBatch] product_images lookup failed:', error.message);
        imageLookupComplete = false;
        break;
      }
      imageRows.push(...((data ?? []) as Array<{ id: string; storage_path: string | null }>));
    }

    // Also collect originalStoragePath values cached in the workflow_state JSON
    // (these are NOT product_images rows — they're backup copies of pre-crop
    // originals and would be orphaned in Storage if we only delete row paths).
    const { data: batchRow } = await supabase
      .from('workflow_batches')
      .select('workflow_state')
      .eq('id', batchId)
      .maybeSingle();
    const ws = batchRow?.workflow_state;
    const workflowItems: Array<{ originalStoragePath?: string }> = [
      ...(ws?.processedItems ?? []),
      ...(ws?.sortedImages ?? []),
      ...(ws?.groupedImages ?? []),
      ...(ws?.uploadedImages ?? []),
    ];
    const originalPaths = workflowItems
      .map(i => i.originalStoragePath)
      .filter(Boolean) as string[];

    // Reference-count the candidate paths NOW, while this batch's own
    // product_images rows still exist to be distinguished from other batches'.
    // Both lookups must be COMPLETE for this to be trustworthy: an incomplete
    // product id list makes `batchProductIds` (the deletion set) partial, so paths
    // that really are unreferenced would look like another batch's files, and paths
    // belonging to the missing products would not be considered at all.
    let safePaths: string[] = [];
    if (imageLookupComplete && productIdsComplete) {
      const allPaths = [...new Set([
        ...(imageRows.map(r => r.storage_path).filter(Boolean) as string[]),
        ...originalPaths,
      ])];
      if (allPaths.length > 0) {
        safePaths = await filterUnreferencedStoragePaths(allPaths, batchProductIds);
        const sharedCount = allPaths.length - safePaths.length;
        if (sharedCount > 0) {
          console.warn(`[deleteWorkflowBatch] kept ${sharedCount} storage file(s) still referenced by other batches`);
        }
      }
    }

    // ── 2. Claim ownership so the owner-scoped DELETE policies permit removal ──
    // UPDATE is collaborative (collaborative_edit_policies.sql), so this works for
    // a batch created by another account in the shared workspace. If we cannot even
    // claim the batch row, the DELETE cannot succeed either — refuse, and destroy
    // nothing (this is the check that used to be missing).
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      console.warn('[deleteWorkflowBatch] no authenticated user — refusing to delete');
      return false;
    }
    const { data: claimed, error: claimErr } = await supabase
      .from('workflow_batches')
      .update({ user_id: user.id })
      .eq('id', batchId)
      .select('id');
    if (claimErr || !claimed || claimed.length === 0) {
      console.warn(`[deleteWorkflowBatch] cannot claim batch ${batchId} (${claimErr?.message ?? '0 rows'}) — refusing to delete anything`);
      return false;
    }
    const { error: prodClaimErr } = await supabase
      .from('products').update({ user_id: user.id }).eq('batch_id', batchId);
    if (prodClaimErr) console.warn('[deleteWorkflowBatch] products claim failed:', prodClaimErr.message);
    for (const idChunk of chunked(batchProductIds)) {
      const { error: imgClaimErr } = await supabase
        .from('product_images')
        .update({ user_id: user.id })
        .in('product_id', idChunk);
      if (imgClaimErr) console.warn('[deleteWorkflowBatch] product_images claim failed:', imgClaimErr.message);
    }

    // ── 3. The authoritative delete, confirmed, before anything destructive ──
    const { data: deletedRows, error } = await supabase
      .from('workflow_batches')
      .delete()
      .eq('id', batchId)
      .select('id');
    if (error) throw error;
    if (!deletedRows || deletedRows.length === 0) {
      console.warn(`[deleteWorkflowBatch] batch ${batchId} delete affected 0 rows — not removed`);
      return false;
    }

    // ── 4. Now the rest of the DB, in FK order, chunked and checked ──────────
    for (const idChunk of chunked(batchProductIds)) {
      const { error: imgDelErr } = await supabase
        .from('product_images')
        .delete()
        .in('product_id', idChunk);
      if (imgDelErr) console.warn('[deleteWorkflowBatch] product_images delete failed:', imgDelErr.message);
    }
    const { error: prodDelErr } = await supabase.from('products').delete().eq('batch_id', batchId);
    if (prodDelErr) console.warn('[deleteWorkflowBatch] products delete failed:', prodDelErr.message);

    // ── 5. Storage last, and only when the reference lookup was complete ─────
    if (!imageLookupComplete || !productIdsComplete) {
      console.warn(`[deleteWorkflowBatch] ${!productIdsComplete ? 'product id' : 'image'} lookup was incomplete — leaving storage untouched rather than guessing`);
    } else {
      for (const pathChunk of chunked(safePaths)) {
        const { error: rmErr } = await supabase.storage
          .from('product-images')
          .remove(pathChunk);
        if (rmErr) console.warn('[deleteWorkflowBatch] storage remove failed:', rmErr.message);
      }
    }

    // Tombstone the id so no auto-save in this browser can ever re-create it.
    markBatchDeleted(batchId);
    return true;
  } catch (error) {
    console.error('Error deleting workflow batch:', error);
    return false;
  }
}

/**
 * Get a single workflow batch by ID
 */
export async function getWorkflowBatch(batchId: string): Promise<WorkflowBatch | null> {
  try {
    const { data, error } = await supabase
      .from('workflow_batches')
      .select('*')
      .eq('id', batchId)
      .maybeSingle(); // .single() returns a 406 error when row doesn't exist; .maybeSingle() returns null

    if (error) throw error;
    if (!data) return null;

    // Row confirmed to exist — if it later vanishes, auto-save treats it as deleted.
    confirmedBatchIds.add(batchId);

    // Update last_opened_at
    await updateWorkflowBatch(batchId, {});

    return data;
  } catch (error) {
    console.error('Error fetching workflow batch:', error);
    return null;
  }
}

/**
 * Why an auto-save ended the way it did.
 *
 * `autoSaveWorkflowBatch` returns only an id, and three DIFFERENT outcomes all
 * hand back a non-null id or null with no way to tell them apart — most
 * dangerously `rls-blocked`, where the row exists, the UPDATE wrote NOTHING, and
 * the caller was handed back its own batch id (i.e. a silent data loss reported
 * as a success). The Step-3 save indicator has to show the truth, so the detailed
 * entry point below reports which of these actually happened.
 */
export type AutoSaveOutcome =
  /** The batch row was updated. */
  | 'updated'
  /** No row existed for a never-confirmed id; a fresh batch was created. */
  | 'created'
  /** The payload was byte-identical to the last one Postgres accepted for this
   *  batch, so no UPDATE was sent. The DB already holds this state — this is a
   *  SUCCESS, and `autoSaveSucceeded` reports it as one. */
  | 'unchanged'
  /** The row exists but RLS refused the UPDATE — NOTHING WAS SAVED. */
  | 'rls-blocked'
  /** The batch is tombstoned or was deleted elsewhere; the save was dropped. */
  | 'deleted'
  /** A DB/network error, or the create attempt failed. */
  | 'error';

export interface AutoSaveResult {
  batchId: string | null;
  outcome: AutoSaveOutcome;
  /** Human-readable reason for the non-success outcomes. */
  message?: string;
}

/** True when the caller's state is what Postgres holds — including the
 *  `unchanged` case, where it already was and no write was needed. */
export function autoSaveSucceeded(r: AutoSaveResult): boolean {
  return r.outcome === 'updated' || r.outcome === 'created' || r.outcome === 'unchanged';
}

/**
 * Auto-save workflow state. Back-compat wrapper: returns the batch id only.
 * `null` still means "nothing to point at"; note that an `rls-blocked` save
 * returns the id even though nothing was written — use
 * `autoSaveWorkflowBatchDetailed` when the caller needs to know.
 */
export async function autoSaveWorkflowBatch(
  batchId: string | null,
  batchNumber: string,
  workflowState: WorkflowBatch['workflow_state']
): Promise<string | null> {
  return (await autoSaveWorkflowBatchDetailed(batchId, batchNumber, workflowState)).batchId;
}

/**
 * Auto-save workflow state, reporting WHY it ended as it did.
 * Call this periodically (every 30 seconds) or on major actions
 */
export async function autoSaveWorkflowBatchDetailed(
  batchId: string | null,
  batchNumber: string,
  workflowState: WorkflowBatch['workflow_state']
): Promise<AutoSaveResult> {
  try {
    // Never write to (or resurrect) a batch this browser knows was deleted.
    if (isBatchDeleted(batchId)) {
      console.warn(`autoSaveWorkflowBatch: batch ${batchId} was deleted — skipping save (no resurrection)`);
      return { batchId: null, outcome: 'deleted', message: 'This batch was deleted — changes are not being saved.' };
    }

    const stats = calculateWorkflowStats(workflowState);
    const currentStep = determineCurrentStep(workflowState);

    // Elide the UPDATE entirely when this exact payload is already in the row.
    // Computed BEFORE the round-trip and only trusted for a batch whose write
    // this session has previously seen SUCCEED (rememberAutoSaveFingerprint is
    // called nowhere else), so a first save, a re-opened batch and a recovery
    // INSERT all still go through.
    const fingerprint = workflowStateFingerprint(workflowState);
    if (batchId && shouldSkipAutoSave(batchId, fingerprint)) {
      return { batchId, outcome: 'unchanged' };
    }

    if (batchId) {
      // Blind UPDATE — no pre-flight SELECT round-trip.
      // If the batch no longer exists the update silently affects 0 rows; we
      // detect that by checking the returned data array length.
      const { data: updated, error: updateError } = await supabase
        .from('workflow_batches')
        .update({
          workflow_state: workflowState,
          current_step: currentStep,
          last_opened_at: new Date().toISOString(),
          ...stats,
        })
        .eq('id', batchId)
        .select('id');

      if (!updateError && updated && updated.length > 0) {
        // Update succeeded — remember that this row is known to exist.
        confirmedBatchIds.add(batchId);
        rememberAutoSaveFingerprint(batchId, fingerprint);
        return { batchId, outcome: 'updated' };
      } else if (!updateError && (!updated || updated.length === 0)) {
        // UPDATE affected 0 rows. Two very different causes:
        //  (a) the batch row was genuinely DELETED → create a fresh one.
        //  (b) the row still EXISTS but RLS blocked our UPDATE because we don't own it.
        //      Shared workspace: anyone can open/SELECT any batch, but only the owner
        //      can UPDATE. Creating a new batch here would silently FORK the batch into
        //      a duplicate under the current user — the exact duplicate-spawning bug.
        // SELECT is open to all authenticated users, so it finds the row in case (b)
        // but returns nothing in case (a) — that's how we tell them apart.
        const { data: existing } = await supabase
          .from('workflow_batches')
          .select('id')
          .eq('id', batchId)
          .maybeSingle();
        if (existing) {
          // Case (b): batch exists but isn't ours — do NOT fork a duplicate.
          // Keep pointing at the same batch; this edit just won't persist.
          confirmedBatchIds.add(batchId);
          console.warn(
            `autoSaveWorkflowBatch: batch ${batchId} exists but UPDATE affected 0 rows ` +
            `(not owned by current user) — skipping save, NOT creating a duplicate`,
          );
          return {
            batchId,
            outcome: 'rls-blocked',
            message: 'This batch belongs to another user — your changes are not being saved.',
          };
        }
        // Case (a): the row is genuinely gone. Two sub-cases:
        //  (a1) This session previously CONFIRMED the row existed → it was deleted
        //       (possibly by another user in the shared workspace). Re-creating it
        //       is exactly the "deleted batch keeps coming back" bug — tombstone it
        //       and drop the save instead.
        //  (a2) The row was never confirmed in this session → the stub INSERT at
        //       upload time likely failed (offline blip). Creating a fresh row here
        //       is the legitimate recovery path for brand-new batches.
        if (confirmedBatchIds.has(batchId)) {
          console.warn(
            `autoSaveWorkflowBatch: batch ${batchId} existed earlier this session but is now gone ` +
            `— treating as deleted, NOT re-creating it`,
          );
          markBatchDeleted(batchId);
          return { batchId: null, outcome: 'deleted', message: 'This batch was deleted — changes are not being saved.' };
        }
        console.warn(`Batch ${batchId} never confirmed and not found — creating new batch (stub insert recovery)`);
        const batch = await createWorkflowBatch(batchNumber, workflowState, stats);
        if (batch?.id) rememberAutoSaveFingerprint(batch.id, fingerprint);
        return batch?.id
          ? { batchId: batch.id, outcome: 'created' }
          : { batchId: null, outcome: 'error', message: 'Could not create the batch row.' };
      } else {
        // Real DB error — surface it so outer catch logs it
        throw updateError;
      }
    } else {
      // Create new batch
      const batch = await createWorkflowBatch(batchNumber, workflowState, stats);
      if (batch?.id) rememberAutoSaveFingerprint(batch.id, fingerprint);
      return batch?.id
        ? { batchId: batch.id, outcome: 'created' }
        : { batchId: null, outcome: 'error', message: 'Could not create the batch row.' };
    }
  } catch (error) {
    console.error('Error auto-saving workflow batch:', error);
    // NOT `error instanceof Error`: the throw above re-raises supabase-js's
    // PostgrestError, which is a plain object with a `message` string.
    const message = typeof error === 'object' && error !== null && typeof (error as { message?: unknown }).message === 'string'
      ? (error as { message: string }).message
      : 'Auto-save failed.';
    return { batchId: null, outcome: 'error', message };
  }
}

/**
 * Calculate workflow statistics from state.
 * Uses the most-progressed image list as the source of truth so counts
 * always match what is actually loaded when the batch is opened.
 */
function calculateWorkflowStats(workflowState: WorkflowBatch['workflow_state']) {
  const uploadedImages = workflowState?.uploadedImages || [];
  const groupedImages  = workflowState?.groupedImages  || [];
  const sortedImages   = workflowState?.sortedImages   || [];
  const processedItems = workflowState?.processedItems || [];

  // Pick the most-progressed list as the single source of truth for counts.
  // This prevents the card from showing uploadedImages.length (all individual images)
  // when the user has already grouped them into fewer listings.
  const liveItems =
    processedItems.length > 0 ? processedItems :
    sortedImages.length   > 0 ? sortedImages   :
    groupedImages.length  > 0 ? groupedImages  :
    uploadedImages;

  // Count unique product groups from the live list
  const productGroups = new Set<string>();
  liveItems.forEach(item => {
    const groupId = item.productGroup || item.id;
    productGroups.add(groupId);
  });

  // Total images = all individual images across every group
  const totalImages = liveItems.length || uploadedImages.length;

  // Count categorized items
  const categorizedCount = liveItems.filter(item => item.category).length;

  // Count processed items (with descriptions) — slim items don't carry descriptions,
  // so we use category as a proxy for "processed"
  const processedCount = processedItems.filter(
    item => item.category
  ).length;

  return {
    total_images: totalImages,
    product_groups_count: productGroups.size,
    categorized_count: categorizedCount,
    processed_count: processedCount,
  };
}

/**
 * Determine which step the workflow is currently on.
 * Steps (post-merge of old Steps 2+3):
 *   1 = Upload Images
 *   2 = Group & Categorize  (groupedImages exist)
 *   3 = Add Descriptions    (processedItems exist with voice/generated descriptions)
 *   4 = Save & Export       (processedItems with descriptions complete)
 */
function determineCurrentStep(workflowState: WorkflowBatch['workflow_state']): number {
  if (!workflowState) return 1;

  const { uploadedImages, groupedImages, sortedImages, processedItems } = workflowState;

  // Step 4: All items are categorized (descriptions done — we no longer store descriptions
  // in workflow_state, so use "all items have a category" as the step-4 signal)
  if (processedItems && processedItems.length > 0 &&
      processedItems.every(item => item.category)) {
    return 4;
  }

  // Step 3: Some items started but not all categorized
  if (processedItems && processedItems.length > 0 &&
      processedItems.some(item => item.category)) {
    return 3;
  }

  // Step 2: Items exist (grouping started)
  if (processedItems && processedItems.length > 0) {
    return 2;
  }

  // Legacy format fallbacks
  if ((groupedImages && groupedImages.length > 0) ||
      (sortedImages && sortedImages.length > 0)) {
    return 2;
  }

  if (uploadedImages && uploadedImages.length > 0) {
    return 1;
  }

  return 1;
}
