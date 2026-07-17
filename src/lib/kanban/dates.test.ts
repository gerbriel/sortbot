import { describe, it, expect } from 'vitest';
import { daysUntilDue, deriveDateStatus, isOverdue, validateDateRange } from './dates';

/**
 * Locks the due/overdue rules. `now` is a hardcoded local instant in every test
 * — these can never go green-then-red as the calendar moves, which is the whole
 * reason dates.ts takes `now` as a parameter instead of reading Date.now().
 *
 * The headline rule: a COMPLETED item is never overdue, however far past its
 * due date it is. That is the bug every board ships at least once.
 */

// Local noon on 2026-07-16 — constructed via the local-date constructor, never
// a UTC-parsed string, so the assertions hold in any timezone.
const NOW = new Date(2026, 6, 16, 12, 0, 0).getTime();

describe('daysUntilDue', () => {
  it('is null (never NaN) when there is no date', () => {
    expect(daysUntilDue(null, NOW)).toBeNull();
    expect(daysUntilDue('', NOW)).toBeNull();
  });

  it('is null for an unparseable or impossible date', () => {
    expect(daysUntilDue('not-a-date', NOW)).toBeNull();
    expect(daysUntilDue('2026-02-31', NOW)).toBeNull(); // JS would roll this to Mar 3
    expect(daysUntilDue('2026-13-01', NOW)).toBeNull();
  });

  it('counts calendar days, not 24h blocks', () => {
    expect(daysUntilDue('2026-07-16', NOW)).toBe(0);
    expect(daysUntilDue('2026-07-17', NOW)).toBe(1);
    expect(daysUntilDue('2026-07-15', NOW)).toBe(-1);
    // Late at night, tomorrow is still 1 day away — not 0.
    const lateTonight = new Date(2026, 6, 16, 23, 0, 0).getTime();
    expect(daysUntilDue('2026-07-17', lateTonight)).toBe(1);
  });

  it('handles a due date months out', () => {
    expect(daysUntilDue('2026-08-16', NOW)).toBe(31);
  });
});

describe('isOverdue', () => {
  it('is true for a past due date on unfinished work', () => {
    expect(isOverdue('2026-07-15', NOW, null)).toBe(true);
  });

  it('is FALSE for a completed item, however late — the classic board bug', () => {
    expect(isOverdue('2020-01-01', NOW, '2026-07-16T10:00:00Z')).toBe(false);
  });

  it('is false on the due day itself (due today is not yet late)', () => {
    expect(isOverdue('2026-07-16', NOW, null)).toBe(false);
  });

  it('is false with no due date', () => {
    expect(isOverdue(null, NOW, null)).toBe(false);
  });
});

describe('deriveDateStatus', () => {
  const at = (due: string | null, completed: string | null = null) =>
    deriveDateStatus({ due_date: due, completed_at: completed }, NOW);

  it('none when there is no due date', () => {
    expect(at(null)).toBe('none');
  });

  it('done wins over every date state', () => {
    expect(at('2020-01-01', '2026-07-16T10:00:00Z')).toBe('done');
    expect(at(null, '2026-07-16T10:00:00Z')).toBe('done');
  });

  it('overdue / due-today / due-soon / upcoming across the boundaries', () => {
    expect(at('2026-07-15')).toBe('overdue');
    expect(at('2026-07-16')).toBe('due-today');
    expect(at('2026-07-17')).toBe('due-soon');
    expect(at('2026-07-19')).toBe('due-soon');   // edge of the default 3-day window
    expect(at('2026-07-20')).toBe('upcoming');   // just outside it
  });

  it('respects a custom due-soon window', () => {
    const item = { due_date: '2026-07-23', completed_at: null };
    expect(deriveDateStatus(item, NOW)).toBe('upcoming');
    expect(deriveDateStatus(item, NOW, { dueSoonDays: 10 })).toBe('due-soon');
  });
});

describe('validateDateRange', () => {
  it('rejects an end date before its start date', () => {
    const res = validateDateRange('2026-07-16', '2026-07-01');
    expect(res.valid).toBe(false);
    expect(res.reason).toBeTruthy();
  });

  it('accepts equal dates (same-day work)', () => {
    expect(validateDateRange('2026-07-16', '2026-07-16').valid).toBe(true);
  });

  it('accepts a normal range and any half-empty range', () => {
    expect(validateDateRange('2026-07-01', '2026-07-16').valid).toBe(true);
    expect(validateDateRange(null, '2026-07-16').valid).toBe(true);
    expect(validateDateRange('2026-07-16', null).valid).toBe(true);
    expect(validateDateRange(null, null).valid).toBe(true);
  });
});
