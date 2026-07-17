import { describe, it, expect } from 'vitest';
import { formatDueDate, initials } from './format';

describe('initials', () => {
  it('takes both parts of a separated name', () => {
    expect(initials('ada.lovelace@example.com')).toBe('AL');
    expect(initials('ada_lovelace@example.com')).toBe('AL');
    expect(initials('ada-lovelace@example.com')).toBe('AL');
  });

  it('takes the first two letters of a single-word name', () => {
    expect(initials('gabriel@example.com')).toBe('GA');
  });

  it('never renders empty for a missing or degenerate email', () => {
    expect(initials(null)).toBe('?');
    expect(initials('')).toBe('?');
    expect(initials('...@example.com')).toBe('?');
  });

  it('handles a one-letter name without throwing', () => {
    expect(initials('g@example.com')).toBe('G');
  });
});

describe('formatDueDate', () => {
  it('formats a date as a short month and day in the LOCAL zone', () => {
    // The bug this guards: new Date('2026-07-16') is UTC midnight, which is
    // Jul 15 for anyone west of Greenwich.
    const expected = new Date(2026, 6, 16).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    expect(formatDueDate('2026-07-16')).toBe(expected);
  });

  it('is empty for no date, and passes through anything unparseable', () => {
    expect(formatDueDate(null)).toBe('');
    expect(formatDueDate('whenever')).toBe('whenever');
  });
});
