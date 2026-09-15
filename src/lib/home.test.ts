import { describe, it, expect } from 'vitest';
import {
  batchSummary, recentBatchRows, publicationCounts, storageReadout,
  type BatchMeta,
} from './home';
import type { ClothingItem } from '../App';
import type { PublicationRow } from './marketplaceService';

/**
 * The home dashboard's arithmetic. These are the numbers a user reads on the
 * page they land on, so the point of the suite is that they agree with the
 * screens they link to: `listings` is `buildGroupArray().length` (what Step 3
 * actually walks), the open batch never appears twice, and a placement is never
 * mistaken for a garment.
 */

const item = (id: string, o: Partial<ClothingItem> = {}): ClothingItem =>
  ({ id, ...o } as unknown as ClothingItem);

const meta = (id: string, o: Partial<BatchMeta> = {}): BatchMeta =>
  ({
    id,
    user_id: 'u1',
    batch_number: `batch-${id}`,
    current_step: 2,
    is_completed: false,
    total_images: 10,
    product_groups_count: 3,
    categorized_count: 2,
    processed_count: 2,
    saved_products_count: 0,
    created_at: '2026-09-01T10:00:00Z',
    updated_at: '2026-09-02T10:00:00Z',
    ...o,
  } as BatchMeta);

const pub = (o: Partial<PublicationRow> = {}): PublicationRow => ({
  id: o.id ?? 'p1',
  batch_id: 'b1',
  product_group_id: o.product_group_id ?? 'g1',
  sku: null,
  marketplace: o.marketplace ?? 'ebay',
  status: o.status ?? 'posted',
  external_id: null,
  url: null,
  price_cents: null,
  posted_at: null,
  sold_at: null,
  ...o,
});

describe('batchSummary', () => {
  it('returns all zeros for an empty, null or undefined list', () => {
    const zero = { photos: 0, groups: 0, listings: 0, categorized: 0 };
    expect(batchSummary([])).toEqual(zero);
    expect(batchSummary(null)).toEqual(zero);
    expect(batchSummary(undefined)).toEqual(zero);
  });

  it('counts photos, true multi-photo groups, listings and categorized items', () => {
    // Two photos in one group + one categorized single + one loose uncategorized single.
    const s = batchSummary([
      item('a', { productGroup: 'a', category: 'tees' }),
      item('b', { productGroup: 'a', category: 'tees' }),
      item('c', { category: 'hats' }),
      item('d'),
    ]);
    expect(s.photos).toBe(4);
    expect(s.groups).toBe(1);
    expect(s.categorized).toBe(3);
    // The loose uncategorized single is NOT a listing — same rule Step 3 applies.
    expect(s.listings).toBe(2);
  });

  it('a multi-photo group counts as a listing even with no category (Step 3 visibility)', () => {
    const s = batchSummary([
      item('a', { productGroup: 'uuid-1' }),
      item('b', { productGroup: 'uuid-1' }),
    ]);
    expect(s.groups).toBe(1);
    expect(s.categorized).toBe(0);
    expect(s.listings).toBe(1);
  });

  it('counts singles as photos but not as groups', () => {
    const s = batchSummary([item('a', { category: 'tees' }), item('b', { category: 'tees' })]);
    expect(s.photos).toBe(2);
    expect(s.groups).toBe(0);
    expect(s.listings).toBe(2);
  });
});

describe('recentBatchRows', () => {
  it('returns nothing for empty input or a non-positive limit', () => {
    expect(recentBatchRows([], null)).toEqual([]);
    expect(recentBatchRows(null, null)).toEqual([]);
    expect(recentBatchRows([meta('a')], null, 0)).toEqual([]);
  });

  it('SKIPS the open batch — it has a widget of its own', () => {
    const rows = recentBatchRows([meta('a'), meta('b'), meta('c')], 'b');
    expect(rows.map(r => r.id)).toEqual(['a', 'c']);
  });

  it('caps at the limit, counting only rows it kept', () => {
    const rows = recentBatchRows([meta('a'), meta('b'), meta('c'), meta('d')], 'a', 2);
    expect(rows.map(r => r.id)).toEqual(['b', 'c']);
  });

  it('preserves server order (updated_at DESC) rather than re-sorting', () => {
    const rows = recentBatchRows(
      [meta('new', { updated_at: '2026-09-09T00:00:00Z' }), meta('old', { updated_at: '2026-01-01T00:00:00Z' })],
      null,
    );
    expect(rows.map(r => r.id)).toEqual(['new', 'old']);
  });

  it('uses the batch name when there is one', () => {
    expect(recentBatchRows([meta('a', { batch_name: 'Fall drop' })], null)[0].name).toBe('Fall drop');
  });

  it('treats the literal string "null" as no name (AGENTS.md §14 #6)', () => {
    // A row saved as the four-character string would otherwise print "null".
    const name = recentBatchRows([meta('a', { batch_name: 'null' })], null)[0].name;
    expect(name).not.toBe('null');
    expect(name.startsWith('Batch ')).toBe(true);
  });

  it('treats a whitespace-only name as no name', () => {
    expect(recentBatchRows([meta('a', { batch_name: '   ' })], null)[0].name.startsWith('Batch ')).toBe(true);
  });

  it('clamps current_step into 1-4 — the column has no CHECK behind it', () => {
    expect(recentBatchRows([meta('a', { current_step: 0 })], null)[0].step).toBe(1);
    expect(recentBatchRows([meta('a', { current_step: 9 })], null)[0].step).toBe(4);
    expect(recentBatchRows([meta('a', { current_step: undefined as unknown as number })], null)[0].step).toBe(1);
  });

  it('falls back to created_at when a row has no updated_at', () => {
    const rows = recentBatchRows(
      [meta('a', { updated_at: undefined as unknown as string, created_at: '2026-05-05T00:00:00Z' })],
      null,
    );
    expect(rows[0].updatedAt).toBe('2026-05-05T00:00:00Z');
  });
});

describe('publicationCounts', () => {
  it('returns zeros for empty input', () => {
    const c = publicationCounts([]);
    expect(c.total).toBe(0);
    expect(c.listings).toBe(0);
    expect(c.posted).toBe(0);
    expect(c.sold).toBe(0);
  });

  it('counts one per status', () => {
    const c = publicationCounts([
      pub({ id: '1', status: 'posted' }),
      pub({ id: '2', status: 'posted' }),
      pub({ id: '3', status: 'exported' }),
      pub({ id: '4', status: 'sold' }),
      pub({ id: '5', status: 'draft' }),
    ]);
    expect(c.posted).toBe(2);
    expect(c.exported).toBe(1);
    expect(c.sold).toBe(1);
    expect(c.draft).toBe(1);
    expect(c.total).toBe(5);
  });

  it('separates PLACEMENTS from LISTINGS — four garments on three marketplaces is not twelve garments', () => {
    const rows: PublicationRow[] = [];
    for (const g of ['g1', 'g2', 'g3', 'g4']) {
      for (const m of ['ebay', 'depop', 'poshmark'] as const) {
        rows.push(pub({ id: `${g}-${m}`, product_group_id: g, marketplace: m, status: 'posted' }));
      }
    }
    const c = publicationCounts(rows);
    expect(c.posted).toBe(12);
    expect(c.total).toBe(12);
    expect(c.listings).toBe(4);
  });

  it('counts an unknown status toward the total but not toward a bucket', () => {
    const c = publicationCounts([pub({ status: 'wat' as PublicationRow['status'] })]);
    expect(c.total).toBe(1);
    expect(c.posted).toBe(0);
  });
});

describe('storageReadout', () => {
  const gb = 1024 * 1024 * 1024;

  it('formats gigabytes and a percentage of the plan', () => {
    const r = storageReadout(2.5 * gb, 100);
    expect(r.usedGb).toBe('2.5');
    expect(r.limitGb).toBe(100);
    expect(r.percent).toBe(3);
    expect(r.nearLimit).toBe(false);
  });

  it('drops the decimal once the figure is large enough not to need it', () => {
    expect(storageReadout(42.7 * gb, 100).usedGb).toBe('43');
  });

  it('CLAMPS the bar at 100% but still reports nearLimit for an over-plan bucket', () => {
    // The dashboard's founder once saw a 310% reading; a 310%-wide bar is a bug.
    const r = storageReadout(310 * gb, 100);
    expect(r.percent).toBe(100);
    expect(r.nearLimit).toBe(true);
  });

  it('flags nearLimit from 85% up', () => {
    expect(storageReadout(84 * gb, 100).nearLimit).toBe(false);
    expect(storageReadout(85 * gb, 100).nearLimit).toBe(true);
  });

  it('never divides by a zero or negative limit', () => {
    const r = storageReadout(5 * gb, 0);
    expect(r.percent).toBe(0);
    expect(r.nearLimit).toBe(false);
    expect(Number.isFinite(Number(r.usedGb))).toBe(true);
  });

  it('treats a negative or non-finite byte count as zero', () => {
    expect(storageReadout(-1, 100).usedGb).toBe('0.0');
    expect(storageReadout(Number.NaN, 100).percent).toBe(0);
  });
});
