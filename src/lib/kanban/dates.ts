/**
 * kanban/dates — due/overdue derivation.
 *
 * `now` is ALWAYS a parameter, never Date.now() read inside. That is the same
 * discipline imageRowSync.ts uses for its migration probe: push the impure
 * value to the caller and the module stays deterministic, so the tests pin a
 * fixed clock and can never go green-then-red with the calendar.
 *
 * Dates are DATE columns ('2026-07-16'), not timestamps — a due date is a
 * calendar day, not an instant. Everything here compares calendar days in the
 * VIEWER's local zone, because "due today" must mean today on the wall behind
 * you, not in UTC. See dates.test.ts.
 */

export type DateStatus =
  | 'none'      // no due date
  | 'done'      // finished — a completed card is never overdue
  | 'overdue'   // due date is in the past
  | 'due-today'
  | 'due-soon'  // within the window (default 3 days)
  | 'upcoming';

/** Days from `now` until a 'YYYY-MM-DD' date, counted in CALENDAR days, local
 *  zone. 11pm today → 1am tomorrow is 1 day, not 0. Null when there is no date
 *  or it does not parse — never NaN. */
export function daysUntilDue(dueDate: string | null, now: number): number | null {
  const due = parseLocalDate(dueDate);
  if (due === null) return null;
  const today = startOfLocalDay(new Date(now));
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  return Math.round((due - today) / MS_PER_DAY);
}

/** A finished item is never overdue, however far past its due date it is —
 *  the single most common board bug. `completedAt` wins over the calendar. */
export function isOverdue(dueDate: string | null, now: number, completedAt: string | null): boolean {
  if (completedAt) return false;
  const days = daysUntilDue(dueDate, now);
  return days !== null && days < 0;
}

export interface DateStatusInput {
  due_date: string | null;
  completed_at: string | null;
}

/** Resolve one item's date badge. `dueSoonDays` is the "due soon" window. */
export function deriveDateStatus(
  item: DateStatusInput,
  now: number,
  opts?: { dueSoonDays?: number },
): DateStatus {
  if (item.completed_at) return 'done';
  const days = daysUntilDue(item.due_date, now);
  if (days === null) return 'none';
  if (days < 0) return 'overdue';
  if (days === 0) return 'due-today';
  const window = opts?.dueSoonDays ?? 3;
  return days <= window ? 'due-soon' : 'upcoming';
}

/** Editor validation: an end date before its start date is always a typo.
 *  Equal is fine (same-day work); either side being empty is fine. */
export function validateDateRange(
  startDate: string | null,
  endDate: string | null,
): { valid: boolean; reason?: string } {
  const s = parseLocalDate(startDate);
  const e = parseLocalDate(endDate);
  if (s === null || e === null) return { valid: true };
  if (e < s) return { valid: false, reason: 'End date is before the start date.' };
  return { valid: true };
}

/** Parse 'YYYY-MM-DD' as LOCAL midnight. `new Date('2026-07-16')` parses as
 *  UTC midnight, which lands on the 15th for anyone west of Greenwich — that
 *  is why this does not use the Date string constructor. */
function parseLocalDate(value: string | null): number | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(year, month - 1, day);
  // Reject non-dates that JS rolls over (2026-02-31 → Mar 3).
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
  return d.getTime();
}

function startOfLocalDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}
