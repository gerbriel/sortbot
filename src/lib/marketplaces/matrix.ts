/**
 * marketplaces/matrix — the pure arithmetic behind Step 4's readiness grid.
 *
 * Step 4 shows listings DOWN and marketplaces ACROSS. Everything that decides
 * what a cell says, what a column header says, and which marketplaces a batch
 * is aimed at is in here rather than in the component, for the usual two
 * reasons: `MarketplaceExport` has no way to assert a count without a render
 * harness, and the "empty means all" rule below is the kind of thing that gets
 * re-derived slightly differently the second time somebody needs it.
 *
 * Pure: no React, no DOM, no network, no Supabase. The adapters are pure too,
 * so `format()` is called by the component and only its OUTPUT reaches here.
 */

import {
  MARKETPLACE_KEYS,
  type FormattedListing,
  type IssueLevel,
  type MarketplaceKey,
  type ReadinessIssue,
  type VocabKind,
} from './types';

// ── Which marketplaces a batch is aimed at ──────────────────────────────────

/**
 * PURE. What the targets row actually shows as selected.
 *
 * `workflow_batches.target_marketplaces` defaults to `'{}'` and there is
 * nothing in the column that distinguishes "not chosen yet" from "chosen none"
 * (02-data.md §7.3 left this open). Step 4 answers it: **empty means every
 * enabled marketplace**, because a batch with no columns is a panel that says
 * nothing, and the seller who has never opened this control has not asked for
 * that. The explicit list is written the first time a toggle is changed, and
 * `nextTargets` refuses to write an empty one — so the ambiguous state can be
 * read but can never be created from here.
 *
 * A stored target the workspace has since DISABLED is dropped: §2b of the plan
 * says a marketplace the workspace has not enabled never appears in the
 * workflow. If that empties the list the batch falls back to "all enabled",
 * which is the same recovery as never having chosen.
 *
 * Order is always `MARKETPLACE_KEYS` order, so the columns do not move when a
 * toggle is flipped.
 */
export function effectiveTargets(
  batchTargets: readonly MarketplaceKey[] | null | undefined,
  enabled: readonly MarketplaceKey[],
): MarketplaceKey[] {
  const live = MARKETPLACE_KEYS.filter(k => enabled.includes(k));
  if (live.length === 0) return [];
  const chosen = MARKETPLACE_KEYS.filter(
    k => live.includes(k) && (batchTargets ?? []).includes(k),
  );
  return chosen.length > 0 ? chosen : live;
}

/**
 * PURE. The list to persist after one toggle, or `null` when the toggle is
 * refused.
 *
 * Refused in exactly one case: turning off the last remaining target. A batch
 * with zero targets has no columns, no readiness, no feeds and no packs — and
 * because `effectiveTargets` reads an empty array as "all", storing one would
 * also silently re-select everything on the next open, which looks like the
 * app undoing the click.
 *
 * `current` is the EFFECTIVE list (what the chips show), not the stored one, so
 * the first change on a never-chosen batch turns the implicit "all" into an
 * explicit list minus the one that was clicked.
 */
export function nextTargets(
  current: readonly MarketplaceKey[],
  key: MarketplaceKey,
  enabled: readonly MarketplaceKey[],
): MarketplaceKey[] | null {
  const live = MARKETPLACE_KEYS.filter(k => enabled.includes(k));
  if (!live.includes(key)) return null;
  const on = current.includes(key);
  const next = live.filter(k => (k === key ? !on : current.includes(k)));
  if (next.length === 0) return null;
  return next;
}

// ── Photo backgrounds ───────────────────────────────────────────────────────

/**
 * The message a listing gets when one of its photos is still waiting on a
 * background review.
 *
 * IT IS A CONSTANT, and that is the design. `summarizeMarketplace` collapses
 * issues whose `level|field|fixKind|value|message` match into ONE checklist
 * line with a count — so a fixed sentence gives "× 12" where "2 photos need a
 * review" / "1 photo needs a review" would give twelve near-identical lines.
 * The per-listing count is already visible in the cell.
 */
export const BACKGROUND_REVIEW_MESSAGE =
  'A photo is still waiting for a background review — Step 2 › Filter › Needs review.';

/**
 * PURE. The same listings, with a blocking `photos` issue added to any listing
 * that still has a photo awaiting review (or in flight).
 *
 * `level: 'error'` on purpose: an error is what `summarizeMarketplace` turns
 * into `blocked`, which is what refuses the feed download — exactly the rule
 * the $0 price gate already follows, and exactly the rule the Shopify CSV gate
 * follows. The alternative — letting it through as a warning — means a feed
 * that ships whichever photo happened to be current when the file was built,
 * which is the one outcome nobody can undo after an import.
 *
 * `failed` and `original` photos deliberately do NOT block: both export the
 * untouched photo, which is a settled answer.
 *
 * An issue is added at most ONCE per listing however many of its photos are
 * waiting — the count belongs to the cell, not to the checklist.
 */
export function withBackgroundIssues(
  listings: readonly FormattedListing[],
  blockingByListing: ReadonlyMap<string, number>,
): FormattedListing[] {
  if (blockingByListing.size === 0) return listings as FormattedListing[];
  return listings.map(listing => {
    const blocking = blockingByListing.get(listing.productGroupId) ?? 0;
    if (blocking <= 0) return listing;
    return {
      ...listing,
      issues: [
        ...listing.issues,
        {
          marketplace: listing.marketplace,
          level: 'error' as IssueLevel,
          field: 'photos',
          message: BACKGROUND_REVIEW_MESSAGE,
        },
      ],
    };
  });
}

// ── One cell ────────────────────────────────────────────────────────────────

export type CellLevel = 'clean' | 'warning' | 'error';

export interface CellSummary {
  level: CellLevel;
  errors: number;
  warnings: number;
}

/**
 * PURE. What one (listing × marketplace) cell says.
 *
 * An error outranks any number of warnings, because an error is what blocks a
 * feed download — the cell's colour has to mean the same thing the column's
 * Download button means.
 */
export function cellSummary(listing: Pick<FormattedListing, 'issues'> | null | undefined): CellSummary {
  let errors = 0;
  let warnings = 0;
  for (const i of listing?.issues ?? []) {
    if (i.level === 'error') errors++;
    else warnings++;
  }
  return { level: errors > 0 ? 'error' : warnings > 0 ? 'warning' : 'clean', errors, warnings };
}

// ── One column ──────────────────────────────────────────────────────────────

/**
 * One line of the readiness checklist: the same problem seen on N listings,
 * collapsed. `count` is how many LISTINGS have it, not how many issues were
 * emitted — an adapter never emits the same issue twice for one listing.
 */
export interface IssueSummary {
  /** Stable identity for a React key and for de-duplication. */
  id: string;
  level: IssueLevel;
  field: string;
  message: string;
  value?: string;
  fixKind?: VocabKind;
  count: number;
}

export interface MarketplaceSummary {
  marketplace: MarketplaceKey;
  listings: number;
  clean: number;
  /** Listings with warnings and no errors. */
  warning: number;
  /** Listings with at least one error. */
  error: number;
  /** True when at least one listing has an error — a feed must not be
   *  downloaded in that state, the same rule as the Shopify price gate. */
  blocked: boolean;
  issues: IssueSummary[];
}

/** The key two issues must share to be one line of the checklist. A value is
 *  part of it so "Brand «Ecko Unltd» did not resolve" and "Brand «Stussy» did
 *  not resolve" stay two rows — each needs its own mapping. */
const issueId = (i: ReadinessIssue): string =>
  `${i.level}|${i.field}|${i.fixKind ?? ''}|${(i.value ?? '').toLowerCase()}|${i.message}`;

/**
 * PURE. The column header's counts and the checklist under it.
 *
 * Issue ORDER follows first appearance, which is the adapters' own fixed order
 * (title, description, price, photos, brand, colour, size, condition,
 * category) — so the checklist reads the same way every time and a screenshot
 * of it is comparable.
 */
export function summarizeMarketplace(
  marketplace: MarketplaceKey,
  listings: readonly FormattedListing[],
): MarketplaceSummary {
  let clean = 0;
  let warning = 0;
  let error = 0;
  const seen = new Map<string, IssueSummary>();

  for (const listing of listings) {
    const cell = cellSummary(listing);
    if (cell.level === 'error') error++;
    else if (cell.level === 'warning') warning++;
    else clean++;

    // One listing counts once per distinct issue, even if an adapter ever
    // emitted a duplicate.
    const counted = new Set<string>();
    for (const i of listing.issues) {
      const id = issueId(i);
      if (counted.has(id)) continue;
      counted.add(id);
      const hit = seen.get(id);
      if (hit) { hit.count++; continue; }
      seen.set(id, {
        id,
        level: i.level,
        field: i.field,
        message: i.message,
        ...(i.value !== undefined ? { value: i.value } : {}),
        ...(i.fixKind ? { fixKind: i.fixKind } : {}),
        count: 1,
      });
    }
  }

  return {
    marketplace,
    listings: listings.length,
    clean,
    warning,
    error,
    blocked: error > 0,
    issues: [...seen.values()],
  };
}

/**
 * PURE. Every column at once, in the order the targets were given.
 *
 * A target with no formatted listings still gets a row (all zeros) rather than
 * being dropped, so the checklist and the matrix always have the same columns.
 */
export function summarizeMatrix(
  targets: readonly MarketplaceKey[],
  formatted: ReadonlyMap<MarketplaceKey, readonly FormattedListing[]>,
): MarketplaceSummary[] {
  return targets.map(key => summarizeMarketplace(key, formatted.get(key) ?? []));
}

/**
 * PURE. The distinct issues across the whole matrix that a vocabulary row
 * would fix, newest column last.
 *
 * Kept separate from `summarizeMarketplace` because a fix is written PER
 * MARKETPLACE (`marketplace_vocab` is keyed on one), so the UI shows these
 * under their own column and never merges two marketplaces' unresolved values
 * into one input.
 */
export function fixableIssues(summary: MarketplaceSummary): IssueSummary[] {
  return summary.issues.filter(i => i.fixKind && i.value);
}
