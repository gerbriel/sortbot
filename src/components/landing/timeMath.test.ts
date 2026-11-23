import { describe, it, expect } from 'vitest';
import {
  LISTINGS_PER_WEEK, MINUTES_TODAY, MINUTES_WITH_SQRL, WEEKS_PER_MONTH,
  clampTo, computeTime, formatCount, formatHours,
} from './timeMath';

describe('computeTime', () => {
  it('computes the defaults (40 a week, 12 min today, 3 with SQRL)', () => {
    const out = computeTime({ listingsPerWeek: 40, minutesToday: 12, minutesWithSqrl: 3 });
    // 40 * 52/12 = 173.33 listings a month
    expect(out.hoursTodayPerMonth).toBeCloseTo((40 * WEEKS_PER_MONTH * 12) / 60, 9); // 34.67
    expect(out.hoursWithSqrlPerMonth).toBeCloseTo((40 * WEEKS_PER_MONTH * 3) / 60, 9); // 8.67
    expect(out.hoursReclaimedPerMonth).toBeCloseTo(26, 9);
    expect(out.extraListingsPerMonth).toBe(520); // 1560 reclaimed minutes / 3
    expect(formatHours(out.hoursTodayPerMonth)).toBe('34.7');
    expect(formatHours(out.hoursWithSqrlPerMonth)).toBe('8.7');
    expect(formatHours(out.hoursReclaimedPerMonth)).toBe('26.0');
  });

  it('reclaims nothing (never a negative) when the SQRL pace is not faster', () => {
    const same = computeTime({ listingsPerWeek: 40, minutesToday: 3, minutesWithSqrl: 3 });
    expect(same.hoursReclaimedPerMonth).toBe(0);
    expect(same.extraListingsPerMonth).toBe(0);
    const slower = computeTime({ listingsPerWeek: 40, minutesToday: 2, minutesWithSqrl: 10 });
    expect(slower.hoursReclaimedPerMonth).toBe(0);
    expect(slower.extraListingsPerMonth).toBe(0);
  });

  it('rounds extra listings down, never up', () => {
    // 5 a week, 4 min today, 3 with: 5*52/12 = 21.667 listings, 21.667 min reclaimed, /3 = 7.22
    expect(computeTime({ listingsPerWeek: 5, minutesToday: 4, minutesWithSqrl: 3 }).extraListingsPerMonth).toBe(7);
  });

  it('clamps out-of-range and non-finite inputs to the published ranges', () => {
    const hi = computeTime({ listingsPerWeek: 9999, minutesToday: 999, minutesWithSqrl: 0 });
    const capped = computeTime({ listingsPerWeek: 300, minutesToday: 40, minutesWithSqrl: 1 });
    expect(hi).toEqual(capped);
    const nan = computeTime({ listingsPerWeek: NaN, minutesToday: Infinity, minutesWithSqrl: NaN });
    expect(nan).toEqual(computeTime({ listingsPerWeek: 40, minutesToday: 12, minutesWithSqrl: 3 }));
  });

  it('handles the top of the ranges', () => {
    const out = computeTime({ listingsPerWeek: 300, minutesToday: 40, minutesWithSqrl: 1 });
    expect(formatHours(out.hoursTodayPerMonth)).toBe('866.7');
    expect(formatHours(out.hoursReclaimedPerMonth)).toBe('845.0');
    expect(formatCount(out.extraListingsPerMonth)).toBe('50,700');
  });
});

describe('clampTo and formatting', () => {
  it('clamps to each range', () => {
    expect(clampTo(1, LISTINGS_PER_WEEK)).toBe(5);
    expect(clampTo(301, LISTINGS_PER_WEEK)).toBe(300);
    expect(clampTo(41, MINUTES_TODAY)).toBe(40);
    expect(clampTo(0.5, MINUTES_WITH_SQRL)).toBe(1);
    expect(clampTo(7, MINUTES_WITH_SQRL)).toBe(7);
  });

  it('formats hours with one decimal and counts as whole numbers', () => {
    expect(formatHours(0)).toBe('0.0');
    expect(formatHours(1234.56)).toBe('1,234.6');
    expect(formatCount(7.9)).toBe('7');
    expect(formatCount(1000)).toBe('1,000');
  });
});
