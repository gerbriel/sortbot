import { describe, it, expect, vi } from 'vitest';

vi.mock('./supabase', async () => {
  const { createSupabaseMock } = await import('./testing/supabaseMock');
  return { supabase: createSupabaseMock() };
});

import type { ClothingItem } from '../App';
import {
  readWorkflowBackup,
  resolveRestoreItems,
  workflowStateCapturedAt,
} from './restoreSource';
import { slimForWorkflowState, ultraSlimForBackup, asClothingItems } from './slimItems';
import { buildGroupArray } from './grouping';
import { mergeProductRowIntoItem, OPEN_BATCH_MERGE_OPTIONS } from './productRow';

/**
 * Founder report 29 — "when you group photos and refresh, the images don't
 * persist in the same group randomly".
 *
 * These are characterization tests over the REAL persistence functions
 * (`slimForWorkflowState`, `ultraSlimForBackup`, the restore arbitration and the
 * open-batch merge), written to reproduce the loss at each of the refresh
 * timings that used to produce it. Each "reproduces …" test below FAILS against
 * the pre-fix arbitration/merge.
 */

const item = (id: string, over: Partial<ClothingItem> = {}): ClothingItem => ({
  id,
  file: null as unknown as File,
  preview: `https://cdn.test/${id}.jpg`,
  imageUrls: [`https://cdn.test/${id}.jpg`],
  storagePath: `u/${id}/${id}.jpg`,
  originalName: `${id}.jpg`,
  capturedAt: 1_700_000_000_000,
  customDescription: `notes for ${id}`,
  ...over,
} as ClothingItem);

/** Three photos of one garment, grouped under the leader convention. */
const groupedThree = (): ClothingItem[] => [
  item('a', { productGroup: 'a', category: 'tees' }),
  item('b', { productGroup: 'a', category: 'tees' }),
  item('c', { productGroup: 'a', category: 'tees' }),
];

/** What the batch row looks like after a save whose payload was built at `at`. */
const dbBatch = (items: ClothingItem[], at: number, landedAt = at) => ({
  workflow_state: {
    processedItems: slimForWorkflowState(items),
    lastEditedAt: new Date(at).toISOString(),
  },
  last_opened_at: new Date(landedAt).toISOString(),
  updated_at: new Date(landedAt).toISOString(),
});

/** What the localStorage backup looks like, written at `savedAt`. */
const backupBlob = (batchId: string, items: ClothingItem[], savedAt: number) =>
  JSON.stringify({ batchId, savedAt, items: items.map(ultraSlimForBackup) });

const groupIdsOf = (items: ClothingItem[]) =>
  items.map(i => `${i.id}→${i.productGroup ?? 'none'}`);

// ── workflowStateCapturedAt ──────────────────────────────────────────────────

describe('workflowStateCapturedAt', () => {
  it('dates the CONTENT (lastEditedAt), not the round trip (last_opened_at)', () => {
    const built = Date.parse('2026-07-01T10:00:00.000Z');
    const landed = Date.parse('2026-07-01T10:00:03.000Z');
    expect(workflowStateCapturedAt(dbBatch(groupedThree(), built, landed))).toBe(built);
  });

  it('falls back to last_opened_at for batches saved before lastEditedAt existed', () => {
    const t = Date.parse('2026-07-01T10:00:00.000Z');
    expect(workflowStateCapturedAt({
      workflow_state: {}, last_opened_at: new Date(t).toISOString(),
    })).toBe(t);
  });

  it('falls back to updated_at, then to 0', () => {
    const t = Date.parse('2026-07-01T10:00:00.000Z');
    expect(workflowStateCapturedAt({ updated_at: new Date(t).toISOString() })).toBe(t);
    expect(workflowStateCapturedAt({})).toBe(0);
    expect(workflowStateCapturedAt(null)).toBe(0);
    expect(workflowStateCapturedAt({ last_opened_at: 'not a date' })).toBe(0);
  });
});

// ── readWorkflowBackup ───────────────────────────────────────────────────────

describe('readWorkflowBackup', () => {
  it('reads a well-formed backup for the right batch', () => {
    const b = readWorkflowBackup(backupBlob('batch-1', groupedThree(), 123), 'batch-1');
    expect(b?.savedAt).toBe(123);
    expect(b?.items).toHaveLength(3);
  });

  it('rejects another batch, empty items, corrupt JSON, null and a missing savedAt', () => {
    expect(readWorkflowBackup(backupBlob('batch-2', groupedThree(), 1), 'batch-1')).toBeNull();
    expect(readWorkflowBackup(backupBlob('batch-1', [], 1), 'batch-1')).toBeNull();
    expect(readWorkflowBackup('{not json', 'batch-1')).toBeNull();
    expect(readWorkflowBackup(null, 'batch-1')).toBeNull();
    expect(readWorkflowBackup('null', 'batch-1')).toBeNull();
    expect(readWorkflowBackup(
      JSON.stringify({ batchId: 'batch-1', items: [{ id: 'a' }] }), 'batch-1',
    )).toBeNull();
  });
});

// ── the arbitration ──────────────────────────────────────────────────────────

describe('resolveRestoreItems', () => {
  const T = 1_700_000_000_000;

  it('uses the DB blob when there is no backup', () => {
    const db = slimForWorkflowState(groupedThree());
    const d = resolveRestoreItems({ dbItems: db, dbCapturedAt: T, backup: null });
    expect(d.source).toBe('db');
    expect(d.items).toBe(db);
  });

  it('uses the backup verbatim when the DB blob is empty', () => {
    const backup = readWorkflowBackup(backupBlob('b', groupedThree(), T), 'b')!;
    const d = resolveRestoreItems({ dbItems: [], dbCapturedAt: T + 999, backup });
    expect(d.source).toBe('backup');
    expect(d.items).toHaveLength(3);
  });

  it('uses the DB blob when it is the newer of the two', () => {
    const db = slimForWorkflowState(groupedThree());
    const backup = readWorkflowBackup(backupBlob('b', groupedThree(), T - 1), 'b')!;
    const d = resolveRestoreItems({ dbItems: db, dbCapturedAt: T, backup });
    expect(d.source).toBe('db');
  });

  it('REPRODUCES report 29: a newer backup grouping survives a slower Supabase round trip', () => {
    // The user grouped a,b,c at T. The save that was already in flight — carrying
    // the PRE-group state — lands at T+3 s and stamps last_opened_at with T+3 s.
    // Against `last_opened_at` the backup (T+1 s) looked older and was thrown away.
    const before = [item('a'), item('b'), item('c')];
    const after = groupedThree();
    const batch = dbBatch(before, T - 500, T + 3000);
    const backup = readWorkflowBackup(backupBlob('b', after, T + 1000), 'b')!;

    const d = resolveRestoreItems({
      dbItems: batch.workflow_state.processedItems,
      dbCapturedAt: workflowStateCapturedAt(batch),
      backup,
    });

    expect(d.source).toBe('backup-merged');
    expect(groupIdsOf(asClothingItems(d.items)))
      .toEqual(['a→a', 'b→a', 'c→a']);
    expect(buildGroupArray(asClothingItems(d.items))).toHaveLength(1);
  });

  it('merging keeps the wide DB fields the 7-field backup does not carry', () => {
    const db = slimForWorkflowState(groupedThree());
    const backup = readWorkflowBackup(backupBlob('b', groupedThree(), T + 1), 'b')!;
    const d = resolveRestoreItems({ dbItems: db, dbCapturedAt: T, backup });
    expect(d.source).toBe('backup-merged');
    // customDescription has NO products column — the blob is its only home, and
    // a wholesale replace by the backup used to erase it for the whole batch.
    expect(d.items.map(i => i.customDescription)).toEqual(['notes for a', 'notes for b', 'notes for c']);
    expect(d.items.map(i => i.originalName)).toEqual(['a.jpg', 'b.jpg', 'c.jpg']);
  });

  it('a newer UNGROUP wins — undefined from the backup is data, not a gap', () => {
    const db = slimForWorkflowState(groupedThree());
    const ungrouped = groupedThree().map(i => ({ ...i, productGroup: i.id, category: undefined }));
    const backup = readWorkflowBackup(backupBlob('b', ungrouped, T + 1), 'b')!;
    const d = resolveRestoreItems({ dbItems: db, dbCapturedAt: T, backup });
    expect(groupIdsOf(asClothingItems(d.items))).toEqual(['a→a', 'b→b', 'c→c']);
    expect(d.items.every(i => i.category === undefined)).toBe(true);
  });

  it('a newer DELETE wins — the backup decides membership', () => {
    const db = slimForWorkflowState(groupedThree());
    const backup = readWorkflowBackup(backupBlob('b', [item('a', { productGroup: 'a' })], T + 1), 'b')!;
    const d = resolveRestoreItems({ dbItems: db, dbCapturedAt: T, backup });
    expect(d.items.map(i => i.id)).toEqual(['a']);
  });

  it('a newer ADD wins — backup-only items are kept', () => {
    const db = slimForWorkflowState([item('a', { productGroup: 'a' })]);
    const backup = readWorkflowBackup(
      backupBlob('b', [item('a', { productGroup: 'a' }), item('d', { productGroup: 'd' })], T + 1), 'b',
    )!;
    const d = resolveRestoreItems({ dbItems: db, dbCapturedAt: T, backup });
    expect(d.items.map(i => i.id)).toEqual(['a', 'd']);
  });

  it('never drops storagePath or capturedAt just because the backup lacks them', () => {
    const db = slimForWorkflowState(groupedThree());
    const thin = groupedThree().map(i => ({ ...i, storagePath: undefined, capturedAt: undefined }));
    const backup = readWorkflowBackup(backupBlob('b', thin, T + 1), 'b')!;
    const d = resolveRestoreItems({ dbItems: db, dbCapturedAt: T, backup });
    expect(d.items.map(i => i.storagePath)).toEqual(['u/a/a.jpg', 'u/b/b.jpg', 'u/c/c.jpg']);
    expect(d.items.every(i => i.capturedAt === 1_700_000_000_000)).toBe(true);
  });
});

// ── the whole save → refresh → restore contract ──────────────────────────────

describe('report 29 — group membership survives any refresh timing', () => {
  const T = 1_700_000_000_000;
  const BATCH = 'batch-29';

  /** Replays the startup restore: arbitration, then the open-batch DB merge. */
  const restore = (opts: {
    dbItems: ReturnType<typeof slimForWorkflowState>;
    dbCapturedAt: number;
    backupRaw: string | null;
    /** `products` rows, i.e. the LAGGING product_group mirror. */
    rows?: Record<string, string>;
  }): ClothingItem[] => {
    const decision = resolveRestoreItems({
      dbItems: opts.dbItems,
      dbCapturedAt: opts.dbCapturedAt,
      backup: readWorkflowBackup(opts.backupRaw, BATCH),
    });
    const items = asClothingItems(decision.items);
    if (!opts.rows) return items;
    return items.map(i => mergeProductRowIntoItem(
      i,
      { id: i.id, product_group: opts.rows![i.id] ?? i.id },
      (h: string) => h,
      OPEN_BATCH_MERGE_OPTIONS,
    ));
  };

  it('both writes landed → one group of three', () => {
    const items = groupedThree();
    const restored = restore({
      dbItems: slimForWorkflowState(items),
      dbCapturedAt: T,
      backupRaw: backupBlob(BATCH, items, T - 1),
      rows: { a: 'a', b: 'a', c: 'a' },
    });
    expect(buildGroupArray(restored)).toHaveLength(1);
  });

  it('REPRODUCES report 29: workflow_state landed but the products upsert did not', () => {
    // The two mirrors are written by SEPARATE 2 s debounces. Refresh between them
    // and products.product_group still holds the pre-group value — which the merge
    // used to stamp back over the restored grouping.
    const items = groupedThree();
    const restored = restore({
      dbItems: slimForWorkflowState(items),
      dbCapturedAt: T,
      backupRaw: backupBlob(BATCH, items, T - 1),
      rows: { a: 'a', b: 'b', c: 'c' }, // stale: never grouped
    });
    expect(groupIdsOf(restored)).toEqual(['a→a', 'b→a', 'c→a']);
    expect(buildGroupArray(restored)).toHaveLength(1);
  });

  it('REPRODUCES report 29: neither write landed — the backup carries the grouping through the merge', () => {
    const before = [item('a'), item('b'), item('c')];
    const after = groupedThree();
    const batch = dbBatch(before, T - 500, T + 3000); // slow round trip, old payload
    const restored = restore({
      dbItems: batch.workflow_state.processedItems,
      dbCapturedAt: workflowStateCapturedAt(batch),
      backupRaw: backupBlob(BATCH, after, T + 1000),
      rows: { a: 'a', b: 'b', c: 'c' },
    });
    expect(buildGroupArray(restored)).toHaveLength(1);
  });

  it('REPRODUCES report 29: an ungroup is not undone by the lagging products mirror', () => {
    const ungrouped = groupedThree().map(i => ({ ...i, productGroup: i.id, category: undefined }));
    const restored = restore({
      dbItems: slimForWorkflowState(ungrouped),
      dbCapturedAt: T,
      backupRaw: backupBlob(BATCH, ungrouped, T - 1),
      rows: { a: 'a', b: 'a', c: 'a' }, // stale: still says "one group"
    });
    expect(groupIdsOf(restored)).toEqual(['a→a', 'b→b', 'c→c']);
    expect(buildGroupArray(restored)).toHaveLength(0); // uncategorized singles, Step-2 only
  });

  it('a DB-built (gap-filled) item still gets its group from the row it was built from', () => {
    // productRowToClothingItem already derived productGroup from the row, so
    // 'item-wins' preserves it — the row is simply not consulted twice.
    const gapFilled = item('z', { productGroup: 'a' });
    const merged = mergeProductRowIntoItem(
      gapFilled, { id: 'z', product_group: 'a' }, (h: string) => h, OPEN_BATCH_MERGE_OPTIONS,
    );
    expect(merged.productGroup).toBe('a');
  });

  it('slim + ultraSlim both persist productGroup — the whitelist contract still holds', () => {
    const items = groupedThree();
    expect(slimForWorkflowState(items).map(i => i.productGroup)).toEqual(['a', 'a', 'a']);
    expect(items.map(ultraSlimForBackup).map(i => i.productGroup)).toEqual(['a', 'a', 'a']);
  });
});
