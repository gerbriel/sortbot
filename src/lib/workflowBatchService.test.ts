import { describe, it, expect } from 'vitest';
import { markBatchDeleted, isBatchDeleted } from './workflowBatchService';

/**
 * Characterization tests for the deleted-batch tombstone registry — the July
 * 2026 fix for "deleted batches keep coming back". If these break, auto-save
 * can resurrect deleted batches again.
 */

describe('deleted-batch tombstones', () => {
  it('marks a batch deleted and reports it', () => {
    const id = `tomb-${crypto.randomUUID()}`;
    expect(isBatchDeleted(id)).toBe(false);
    markBatchDeleted(id);
    expect(isBatchDeleted(id)).toBe(true);
  });

  it('treats null/undefined/unknown ids as not deleted', () => {
    expect(isBatchDeleted(null)).toBe(false);
    expect(isBatchDeleted(undefined)).toBe(false);
    expect(isBatchDeleted('never-seen-before')).toBe(false);
  });

  it('persists tombstones to localStorage under sortbot_deleted_batch_ids', () => {
    const id = `tomb-${crypto.randomUUID()}`;
    markBatchDeleted(id);
    const stored = JSON.parse(localStorage.getItem('sortbot_deleted_batch_ids') || '[]');
    expect(Array.isArray(stored)).toBe(true);
    expect(stored).toContain(id);
  });

  it('caps the persisted list at 200 entries', () => {
    for (let i = 0; i < 230; i++) markBatchDeleted(`cap-test-${i}`);
    const stored = JSON.parse(localStorage.getItem('sortbot_deleted_batch_ids') || '[]');
    expect(stored.length).toBeLessThanOrEqual(200);
    // The most recent tombstones must be the ones kept
    expect(stored).toContain('cap-test-229');
  });
});
