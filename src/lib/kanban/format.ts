/**
 * kanban/format — display helpers shared by the board and the card drawer.
 * Lives here rather than in a component file so both can import it without
 * breaking Fast Refresh (a component module must only export components).
 * Pure, so it is unit-tested. See format.test.ts.
 */

/**
 * Avatar initials from an email. auth.users is not client-readable, so an
 * email is the only name the board has: 'ada.lovelace@x.com' → 'AL',
 * 'gabriel@x.com' → 'GA'. Never throws, never renders empty — an unknown
 * member still gets a circle.
 */
export function initials(email: string | null): string {
  if (!email) return '?';
  const name = email.split('@')[0];
  const parts = name.split(/[._-]+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

/** 'Jul 16' for a 'YYYY-MM-DD' date. The badge colour already carries
 *  overdue/due-soon, so the text only has to say which day. Parsed as a LOCAL
 *  date — the Date string constructor would read it as UTC and show the
 *  previous day for anyone west of Greenwich. */
export function formatDueDate(date: string | null): string {
  if (!date) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  if (!m) return date;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
