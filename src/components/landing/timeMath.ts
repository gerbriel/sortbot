/* ── timeMath: the arithmetic behind TimeCalculator ─────────────────────────
   Pure and tested. Every number is the visitor's own input; nothing here is
   measured from other shops, and there are no money figures on purpose. */

/** 52 weeks over 12 months: the average month, not a 4-week one. */
export const WEEKS_PER_MONTH = 52 / 12;

export interface Range { min: number; max: number; def: number }

export const LISTINGS_PER_WEEK: Range = { min: 5, max: 300, def: 40 };
export const MINUTES_TODAY: Range = { min: 2, max: 40, def: 12 };
export const MINUTES_WITH_SQRL: Range = { min: 1, max: 10, def: 3 };

/** Clamp to the range; a non-finite value falls back to the default. */
export function clampTo(value: number, r: Range): number {
  if (!Number.isFinite(value)) return r.def;
  return Math.min(r.max, Math.max(r.min, value));
}

export interface TimeInputs {
  listingsPerWeek: number;
  minutesToday: number;
  minutesWithSqrl: number;
}

export interface TimeOutputs {
  hoursTodayPerMonth: number;
  hoursWithSqrlPerMonth: number;
  /** Never negative: if SQRL is no faster at the numbers given, nothing is reclaimed. */
  hoursReclaimedPerMonth: number;
  /** Whole listings that fit in the reclaimed time at the SQRL pace (rounded down). */
  extraListingsPerMonth: number;
}

export function computeTime(input: TimeInputs): TimeOutputs {
  const listings = clampTo(input.listingsPerWeek, LISTINGS_PER_WEEK);
  const today = clampTo(input.minutesToday, MINUTES_TODAY);
  const sqrl = clampTo(input.minutesWithSqrl, MINUTES_WITH_SQRL);

  const listingsPerMonth = listings * WEEKS_PER_MONTH;
  const minutesToday = listingsPerMonth * today;
  const minutesSqrl = listingsPerMonth * sqrl;
  const minutesReclaimed = Math.max(0, minutesToday - minutesSqrl);

  return {
    hoursTodayPerMonth: minutesToday / 60,
    hoursWithSqrlPerMonth: minutesSqrl / 60,
    hoursReclaimedPerMonth: minutesReclaimed / 60,
    // The epsilon keeps float noise (299.99999) from costing a whole listing.
    extraListingsPerMonth: Math.floor(minutesReclaimed / sqrl + 1e-9),
  };
}

/** One decimal, grouped: 1,234.5 */
export function formatHours(h: number): string {
  return h.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

/** Whole number, grouped: 1,234 */
export function formatCount(n: number): string {
  return Math.floor(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
}
