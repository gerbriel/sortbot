import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('./supabase', async () => {
  const { createSupabaseMock } = await import('./testing/supabaseMock');
  return { supabase: createSupabaseMock() };
});

import { supabase } from './supabase';
import { duplicateBatch } from './libraryService';
import type { MockedSupabaseClient } from './testing/supabaseMock';

const mock = (supabase as unknown as MockedSupabaseClient).__mock;

/**
 * duplicateBatch copied `workflow_state.uploadedImages` — which autoSaveWorkflow
 * ALWAYS leaves empty (it persists the single most-progressed list under
 * `processedItems`). So every duplicate came out empty while still advertising
 * the original's `total_images`, and opening it fell through to the ±24 h orphan
 * query with nothing to match.
 */
describe('duplicateBatch', () => {
  const sourceBatch = (workflow_state: unknown) => ({
    id: 'src', user_id: 'u1', batch_name: 'Spring pickup', total_images: 42,
    thumbnail_url: 'https://cdn/t.jpg', tags: null, notes: null, workflow_state,
  });

  const insertedRow = () => mock.callsFor('workflow_batches', 'insert')[0].payload as Record<string, unknown>;
  const insertedState = () => insertedRow().workflow_state as Record<string, unknown[]>;

  beforeEach(() => mock.reset());

  it('copies processedItems and recomputes the counters from what it copied', async () => {
    const items = [
      { id: 'a', productGroup: 'a', category: 'tees' },
      { id: 'b', productGroup: 'a', category: 'tees' },
      { id: 'c', productGroup: 'c' },           // uncategorized single
    ];
    mock.responder = (c) => {
      if (c.table === 'workflow_batches' && c.op === 'select') {
        return { data: sourceBatch({ uploadedImages: [], groupedImages: [], sortedImages: [], processedItems: items }), error: null };
      }
      if (c.table === 'workflow_batches' && c.op === 'insert') return { data: { id: 'copy-1' }, error: null };
      return undefined;
    };

    expect(await duplicateBatch('src')).toBe('copy-1');
    expect(insertedState().processedItems).toHaveLength(3);
    expect(insertedState().uploadedImages).toEqual([]);
    const row = insertedRow();
    expect(row.total_images).toBe(3);              // NOT the source's stale 42
    expect(row.product_groups_count).toBe(2);      // groups a + c
    expect(row.categorized_count).toBe(2);
    expect(row.batch_name).toBe('Spring pickup (Copy)');
  });

  it('falls back through the older array formats', async () => {
    mock.responder = (c) => {
      if (c.table === 'workflow_batches' && c.op === 'select') {
        return { data: sourceBatch({ uploadedImages: [{ id: 'legacy' }], groupedImages: [], sortedImages: [], processedItems: [] }), error: null };
      }
      if (c.table === 'workflow_batches' && c.op === 'insert') return { data: { id: 'copy-2' }, error: null };
      return undefined;
    };
    expect(await duplicateBatch('src')).toBe('copy-2');
    expect(insertedState().processedItems).toEqual([{ id: 'legacy' }]);
    expect(insertedRow().total_images).toBe(1);
  });

  it('reports an empty source honestly instead of promising N images', async () => {
    mock.responder = (c) => {
      if (c.table === 'workflow_batches' && c.op === 'select') return { data: sourceBatch(null), error: null };
      if (c.table === 'workflow_batches' && c.op === 'insert') return { data: { id: 'copy-3' }, error: null };
      return undefined;
    };
    await duplicateBatch('src');
    expect(insertedRow().total_images).toBe(0);
    expect(insertedState().processedItems).toEqual([]);
  });
});
