/**
 * kanban/status — the one place that decides what a card's completion date
 * becomes when it is dragged.
 *
 * A card has no status column: its status IS its lane, so there is exactly one
 * source of truth and nothing to disagree with. The only derived field is
 * completed_at, and it has exactly three rules:
 *
 *   * Dropped into the done lane, not already complete → stamp it now.
 *   * Dropped into the done lane, ALREADY complete → leave the original stamp
 *     alone. Re-ordering a finished card inside Done must not rewrite the day
 *     it was finished.
 *   * Dropped into any other lane → clear it. A card dragged back out of Done
 *     is not done, and a leftover stamp would make dates.ts call it "never
 *     overdue" forever.
 *
 * `nowIso` is a parameter, never read inside — same discipline as dates.ts.
 * See status.test.ts.
 */

/** The completed_at to write for a card moving into `destIsDone`'s lane. */
export function completionForMove(
  destIsDone: boolean,
  currentCompletedAt: string | null,
  nowIso: string,
): string | null {
  if (!destIsDone) return null;
  return currentCompletedAt ?? nowIso;
}
