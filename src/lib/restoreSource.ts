import type { PersistedWorkflowItem } from './slimItems';

/**
 * restoreSource — decide what the startup restore actually loads: the Supabase
 * `workflow_state` blob, the throttled localStorage backup, or a merge of both.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 *
 * Two writers hold the in-flight batch, and they are NOT synchronised:
 *
 *   1. `workflow_state` — a 2 s debounced Supabase UPDATE (App.autoSaveWorkflow).
 *   2. `sortbot_workflow_backup` — a 1 s trailing-throttled localStorage write
 *      (lib/workflowBackup.ts), flushed on pagehide/beforeunload.
 *
 * A refresh can land anywhere between the two, so startup has to decide which
 * one is newer. The original arbitration compared the backup's `savedAt`
 * against the batch row's `last_opened_at`, and that comparison is wrong in a
 * way that silently loses grouping work:
 *
 *   • `last_opened_at` is stamped when a write LANDS, not when its payload was
 *     BUILT. A save whose payload was captured at T but whose round trip
 *     finished at T+3 s reports T+3 s — so a backup written at T+1 s, holding
 *     strictly newer grouping, is judged "older" and discarded.
 *   • `updateWorkflowBatch(id, {})` bumps `last_opened_at` while writing no
 *     `workflow_state` at all (getWorkflowBatch, libraryService), so the column
 *     can advance with no content change whatsoever.
 *
 * `workflow_state.lastEditedAt` is the honest answer: App stamps it into the
 * blob at the moment the payload is assembled, so it dates the CONTENT.
 *
 * ── WHY IT MERGES INSTEAD OF REPLACING ──────────────────────────────────────
 *
 * `ultraSlimForBackup` carries 7 fields; `slimForWorkflowState` carries 15. The
 * old code replaced the DB list wholesale with the backup list, so winning the
 * race also threw away `originalName`, `customDescription` (which has NO
 * products column — the blob is its only home), `brandCategory`,
 * `originalStoragePath`, `originalUrl` and `descriptionEdited` for the entire
 * batch. Merging keeps the backup authoritative for what it knows and the DB
 * blob authoritative for everything else.
 */

/** The localStorage backup payload, after validation. */
export interface WorkflowBackup {
  savedAt: number;
  items: PersistedWorkflowItem[];
}

/** Shape of the parts of a `workflow_batches` row this module reads. */
export interface RestoreBatchTimestamps {
  workflow_state?: { lastEditedAt?: string } | null;
  last_opened_at?: string | null;
  updated_at?: string | null;
}

/**
 * When was this batch's `workflow_state` CONTENT captured?
 *
 * `lastEditedAt` (stamped by App.autoSaveWorkflow as it builds the payload) is
 * the only timestamp that dates the content rather than the round trip. The two
 * column fallbacks are for batches saved before that field existed; they
 * over-state freshness, which is exactly the bias this function exists to avoid,
 * so they are last resorts only.
 */
export function workflowStateCapturedAt(batch: RestoreBatchTimestamps | null | undefined): number {
  if (!batch) return 0;
  const parse = (v: string | null | undefined): number => {
    if (!v) return 0;
    const t = new Date(v).getTime();
    return Number.isFinite(t) ? t : 0;
  };
  return parse(batch.workflow_state?.lastEditedAt)
    || parse(batch.last_opened_at)
    || parse(batch.updated_at);
}

/**
 * Parse + validate the raw `sortbot_workflow_backup` string for one batch.
 * Returns null for anything unusable: corrupt JSON, another batch's backup, no
 * items, or a missing/NaN `savedAt` (which would otherwise compare as "older
 * than everything" and be silently ignored — better to say so explicitly).
 */
export function readWorkflowBackup(raw: string | null, batchId: string): WorkflowBackup | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const b = parsed as { batchId?: unknown; savedAt?: unknown; items?: unknown };
  if (b.batchId !== batchId) return null;
  if (!Array.isArray(b.items) || b.items.length === 0) return null;
  if (typeof b.savedAt !== 'number' || !Number.isFinite(b.savedAt)) return null;
  return { savedAt: b.savedAt, items: b.items as PersistedWorkflowItem[] };
}

export type RestoreSourceKind = 'db' | 'backup' | 'backup-merged';

export interface RestoreDecision {
  items: PersistedWorkflowItem[];
  source: RestoreSourceKind;
  /** Human-readable, for the restore log line. */
  reason: string;
}

/**
 * The fields `ultraSlimForBackup` persists, split by how a missing value must be
 * read.
 *
 * `productGroup` / `category` / `imageRotation` / `crop`: `undefined` is DATA.
 * An ungroup sets `productGroup` back to the item's own id, "clear category"
 * sets `category` to undefined, and "revert to original" clears `crop`. If the
 * newer backup says undefined, the older DB value must NOT resurface — that is
 * precisely the "I ungrouped them and the refresh put them back" report.
 *
 * `storagePath` / `capturedAt`: `undefined` can only ever be a gap. Losing the
 * storage path loses the picture, and losing `capturedAt` loses an EXIF backfill
 * that no products column holds — so the DB blob is allowed to fill those in.
 */
const BACKUP_AUTHORITATIVE = ['productGroup', 'category', 'imageRotation', 'crop'] as const;

/**
 * Choose between the DB blob and the localStorage backup, merging when the
 * backup wins so the wider DB field set survives.
 *
 * Rules, in order:
 *   1. no usable backup → DB.
 *   2. DB blob empty → backup verbatim (it is the only copy).
 *   3. backup captured AFTER the DB content → merge: the backup's item list
 *      decides membership and the six ultra-slim fields; the DB blob supplies
 *      every other field for ids it also holds.
 *   4. otherwise → DB.
 *
 * Membership comes from the backup in case 3 on purpose: a deletion made after
 * the last successful Supabase write must not be undone by the restore.
 */
export function resolveRestoreItems(args: {
  dbItems: PersistedWorkflowItem[] | undefined;
  dbCapturedAt: number;
  backup: WorkflowBackup | null;
}): RestoreDecision {
  const dbItems = args.dbItems ?? [];
  const { backup, dbCapturedAt } = args;

  if (!backup) return { items: dbItems, source: 'db', reason: 'no usable backup' };

  if (dbItems.length === 0) {
    return {
      items: backup.items,
      source: 'backup',
      reason: `workflow_state empty — backup is the only copy (${backup.items.length} items)`,
    };
  }

  if (!(backup.savedAt > dbCapturedAt)) {
    return {
      items: dbItems,
      source: 'db',
      reason: `workflow_state is newer (captured ${dbCapturedAt}, backup ${backup.savedAt})`,
    };
  }

  const byId = new Map(dbItems.map(i => [i.id, i]));
  const items = backup.items.map((b) => {
    const db = byId.get(b.id);
    if (!db) return b;
    const merged: PersistedWorkflowItem = {
      ...db,
      // Gaps the DB blob may legitimately fill (see BACKUP_AUTHORITATIVE doc).
      storagePath: b.storagePath ?? db.storagePath,
      capturedAt:  b.capturedAt  ?? db.capturedAt,
    };
    for (const key of BACKUP_AUTHORITATIVE) {
      // Assigned unconditionally — `undefined` from the newer backup is data.
      (merged as unknown as Record<string, unknown>)[key] = b[key];
    }
    return merged;
  });

  return {
    items,
    source: 'backup-merged',
    reason: `backup is newer (${backup.savedAt} > ${dbCapturedAt}) — ${items.length} items, `
      + `${items.length - backup.items.filter(b => byId.has(b.id)).length} backup-only`,
  };
}
