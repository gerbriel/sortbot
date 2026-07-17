import { describe, it, expect } from 'vitest';
import { completionForMove } from './status';

/**
 * Locks the completion-date rules for a dragged card. Two bugs live here:
 * a card dragged out of Done keeping a stale completed_at (which makes
 * dates.ts call it "never overdue" forever), and re-ordering a finished card
 * inside Done silently rewriting the day it was finished.
 */

const NOW = '2026-07-16T12:00:00.000Z';
const EARLIER = '2026-07-01T09:00:00.000Z';

describe('completionForMove', () => {
  it('stamps now when a card lands in the done lane', () => {
    expect(completionForMove(true, null, NOW)).toBe(NOW);
  });

  it('KEEPS the original stamp when re-ordering a card already in the done lane', () => {
    expect(completionForMove(true, EARLIER, NOW)).toBe(EARLIER);
  });

  it('CLEARS the stamp when a card is dragged back out of the done lane', () => {
    expect(completionForMove(false, EARLIER, NOW)).toBeNull();
  });

  it('leaves an unfinished card unfinished when moving between two normal lanes', () => {
    expect(completionForMove(false, null, NOW)).toBeNull();
  });

  it('is idempotent — re-applying to its own result never churns the date', () => {
    const first = completionForMove(true, null, NOW);
    const second = completionForMove(true, first, '2026-09-09T00:00:00.000Z');
    expect(second).toBe(first);
  });
});
