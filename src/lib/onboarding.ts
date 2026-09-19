/**
 * ONBOARDING — the pure half of the first-run checklist.
 *
 * An approved shop signs in, `ensureOrganization` creates their workspace and
 * seeds its categories, and they land on Home. Nothing on that page told them
 * what to do next: the shop name that becomes the Shopify Vendor column, the
 * marketplaces Step 4 offers, the teammate who is going to do the photographing
 * — all of it lives behind a menu row somebody has to think to open.
 *
 * This module answers one question — "what is left to set up?" — from facts the
 * widget has already read. It lives here for the same reason `home.ts` and
 * `phoneSteps.ts` do: a checklist that tells a paying shop to do something it
 * has already done is worse than no checklist, and that is only testable if the
 * rule is a function.
 *
 * NOTHING HERE TOUCHES SUPABASE. Every fetch lives in the component.
 *
 * TWO RULES RUN THROUGH THE WHOLE FILE:
 *
 *   1. UNKNOWN IS NOT DONE. Every fact defaults to its "we could not find out"
 *      value and every `done` test is written so that value reads as undone. A
 *      failed read therefore leaves a step on the list — visible, dismissible —
 *      rather than quietly ticking it off and hiding the whole widget.
 *
 *   2. A STEP YOU CANNOT DO IS NOT SHOWN. A feature whose migration has not run
 *      is absent, not undone; and so is a step whose write RLS would refuse the
 *      caller (`organizations`, `org_marketplaces` and `org_shopify_connections`
 *      are all admin/owner). A plain member's checklist is therefore shorter and
 *      every line on it is something they can actually finish.
 */

import type { OrgRole } from './orgService';
import type { WorkflowStep } from './phoneSteps';

/* ── Facts ────────────────────────────────────────────────────────────────── */

/**
 * What the widget found out. `'unavailable'` is the house shape for "that
 * migration has not been run" (labelsService, brandAliasService,
 * marketplaceService all report it the same way) and it HIDES its step rather
 * than failing it.
 */
export interface OnboardingFacts {
  /** `description_settings.vendorName` is non-blank. */
  hasVendorName: boolean;
  categoryCount: number;
  presetCount: number;
  /** The Categories view has been opened at least once in this workspace. */
  visitedCategories: boolean;
  /** The Category presets view has been opened at least once. */
  visitedPresets: boolean;
  /** How many marketplaces are ENABLED, or `'unavailable'` pre-migration. */
  marketplaces: 'unavailable' | number;
  /** Whether a connection row exists, or `'unavailable'` pre-migration. */
  shopify: 'unavailable' | boolean;
  /** Members of this workspace, including the caller. */
  memberCount: number;
  /** Owner/admin — the only roles `org_invites` INSERT accepts. */
  canInvite: boolean;
  batchCount: number;
  /**
   * Batches that reached Export, plus (where the table exists) any listing with
   * a publication row. Either one proves the shop has got a file out.
   */
  exportedCount: number;
  role: OrgRole;
}

/** Every fact at its "we do not know" value — see rule 1 in the header. */
export const UNKNOWN_FACTS: OnboardingFacts = {
  hasVendorName: false,
  categoryCount: 0,
  presetCount: 0,
  visitedCategories: false,
  visitedPresets: false,
  marketplaces: 'unavailable',
  shopify: 'unavailable',
  memberCount: 0,
  canInvite: false,
  batchCount: 0,
  exportedCount: 0,
  role: 'member',
};

/* ── Steps ────────────────────────────────────────────────────────────────── */

export type OnboardingStepId =
  | 'shop-name' | 'categories' | 'marketplaces' | 'shopify'
  | 'team' | 'first-batch' | 'first-export';

/**
 * Where a step's button goes. A union rather than a bare callback so the rule
 * and the routing are both testable without rendering anything: `navigate`
 * carries an `ActiveView` id, `marketplaces` is the Workspace dashboard on a
 * particular tab (not a view of its own), and `workflow` un-parks `<main>` on
 * the given step.
 */
export type OnboardingAction =
  | { kind: 'navigate'; label: string; view: string }
  | { kind: 'marketplaces'; label: string }
  | { kind: 'workflow'; label: string; step: WorkflowStep };

export interface OnboardingStep {
  id: OnboardingStepId;
  title: string;
  /** One line saying why it is worth doing. Never a scolding. */
  why: string;
  done: boolean;
  /** Worth doing, but it does not hold the checklist open. */
  optional?: boolean;
  action: OnboardingAction;
}

const isAdminRole = (role: OrgRole): boolean => role === 'owner' || role === 'admin';

/**
 * The checklist for one workspace, in the order it should be worked through.
 *
 * Accepts a partial so a caller can fill only what it managed to read; anything
 * missing falls back to `UNKNOWN_FACTS`, which is undone by construction.
 */
export function deriveOnboardingSteps(input: Partial<OnboardingFacts>): OnboardingStep[] {
  const f: OnboardingFacts = { ...UNKNOWN_FACTS, ...input };
  const admin = isAdminRole(f.role);
  const steps: OnboardingStep[] = [];

  // 1. The shop name. It is the Vendor column on every Shopify row, and it is
  //    also what `scrubSellerBrand` matches against so the shop's own name can
  //    never end up in a garment's brand (AGENTS.md §11, report 23) — which is
  //    why this is first and not cosmetic.
  if (admin) {
    steps.push({
      id: 'shop-name',
      title: 'Name your shop',
      why: 'It becomes the Vendor on every listing you export, and it keeps your own shop name out of a garment’s brand.',
      done: f.hasVendorName,
      action: { kind: 'navigate', label: 'Open workspace settings', view: 'workspace' },
    });
  }

  // 2. Categories and presets. A VISIT is the whole signal, deliberately:
  //    "reviewed" is a human judgement and the database cannot observe it, and
  //    gating on a count instead would deadlock a workspace whose preset seed
  //    failed. The counts go in the sentence, where they are information rather
  //    than a lock.
  steps.push({
    id: 'categories',
    title: 'Review your categories and presets',
    why: f.categoryCount > 0
      ? `You have ${f.categoryCount} categor${f.categoryCount === 1 ? 'y' : 'ies'} and ${f.presetCount} preset${f.presetCount === 1 ? '' : 's'} — Step 2 drags photos onto these, and a preset fills shipping, measurements and the SEO title in one click.`
      : 'Step 2 drags photos onto these, and a preset fills shipping, measurements and the SEO title in one click.',
    done: f.visitedCategories || f.visitedPresets,
    action: { kind: 'navigate', label: 'Review categories', view: 'categories' },
  });

  // 3. Where you sell. Absent — not undone — before marketplaces.sql has run.
  if (admin && f.marketplaces !== 'unavailable') {
    steps.push({
      id: 'marketplaces',
      title: 'Choose where you sell',
      why: 'Step 4 only offers the marketplaces this workspace has turned on, and each one gets its own feed or copy-ready pack.',
      done: f.marketplaces > 0,
      action: { kind: 'marketplaces', label: 'Choose marketplaces' },
    });
  }

  // 4. Shopify. Optional: the CSV import works without it. What connecting buys
  //    is the dedup against the live catalogue at export time.
  if (admin && f.shopify !== 'unavailable') {
    steps.push({
      id: 'shopify',
      title: 'Connect your Shopify store',
      why: 'Lets the export check your live catalogue, so a title or handle can never collide with one you already have.',
      done: f.shopify === true,
      optional: true,
      action: { kind: 'navigate', label: 'Connect Shopify', view: 'workspace' },
    });
  }

  // 5. The team. Only shown to someone who can actually send an invite.
  if (f.canInvite) {
    steps.push({
      id: 'team',
      title: 'Invite your team',
      why: 'Everyone in the workspace shares the same batches, labels and listings — one person can shoot while another describes.',
      done: f.memberCount > 1,
      optional: true,
      action: { kind: 'navigate', label: 'Invite a teammate', view: 'workspace' },
    });
  }

  steps.push({
    id: 'first-batch',
    title: 'Upload your first batch',
    why: 'Drop in a folder of photos — or take them on your phone — and Arcadian walks you through grouping, describing and exporting them.',
    done: f.batchCount > 0,
    // Deliberately NOT "Upload photos": while this step is undone the Current
    // batch widget directly below is showing its own "Upload photos" button to
    // the same place, and two identical buttons a card apart read as a bug.
    action: { kind: 'workflow', label: 'Start uploading', step: 1 },
  });

  steps.push({
    id: 'first-export',
    title: 'Export your first listings',
    why: 'Download the Shopify CSV — or a feed for one of your marketplaces — and your first batch is live work, not a rehearsal.',
    done: f.exportedCount > 0,
    action: { kind: 'workflow', label: 'Go to export', step: 4 },
  });

  return steps;
}

/* ── Progress ─────────────────────────────────────────────────────────────── */

export interface OnboardingProgress {
  /** Steps ticked off, INCLUDING optional ones — it is what the user sees. */
  done: number;
  /** Steps on the list, including optional ones. */
  total: number;
  /**
   * Every REQUIRED step is done. This is what retires the widget, so an optional
   * step left undone never holds the checklist on the page forever — and a
   * workspace with no required steps left (a member who has done everything) is
   * complete even with an invite it never sent.
   */
  complete: boolean;
}

export function onboardingProgress(steps: readonly OnboardingStep[]): OnboardingProgress {
  let done = 0;
  let required = 0;
  let requiredDone = 0;
  for (const s of steps) {
    if (s.done) done++;
    if (!s.optional) { required++; if (s.done) requiredDone++; }
  }
  return { done, total: steps.length, complete: required === 0 || requiredDone === required };
}

/* ── The per-workspace local record ───────────────────────────────────────────
   Two things the database genuinely cannot answer: whether this person has
   LOOKED at their categories, and whether they have asked us to stop showing
   the checklist. Both are cosmetic, per-browser preferences — losing them just
   shows the checklist again — so localStorage is the right home and every
   access is wrapped: the accessor itself throws in a private window or with
   site data blocked (AGENTS.md §1). */

export interface OnboardingLocal {
  /** The user dismissed the checklist. */
  hidden?: true;
  visitedCategories?: true;
  visitedPresets?: true;
}

/** `sortbot_onboarding_<orgId>` — per workspace, because setup is per workspace. */
export const onboardingLocalKey = (orgId: string): string => `sortbot_onboarding_${orgId}`;

const EMPTY_LOCAL: OnboardingLocal = {};

export function readOnboardingLocal(orgId: string | null | undefined): OnboardingLocal {
  if (!orgId) return EMPTY_LOCAL;
  try {
    const raw = localStorage.getItem(onboardingLocalKey(orgId));
    if (!raw) return EMPTY_LOCAL;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return EMPTY_LOCAL;
    const r = parsed as Record<string, unknown>;
    const out: OnboardingLocal = {};
    if (r.hidden === true) out.hidden = true;
    if (r.visitedCategories === true) out.visitedCategories = true;
    if (r.visitedPresets === true) out.visitedPresets = true;
    return out;
  } catch {
    // Unparseable, blocked, or absent — the checklist simply shows.
    return EMPTY_LOCAL;
  }
}

/** Merges `patch` over what is stored. Silent on failure: this is a preference. */
export function writeOnboardingLocal(
  orgId: string | null | undefined,
  patch: OnboardingLocal,
): void {
  if (!orgId) return;
  try {
    const next = { ...readOnboardingLocal(orgId), ...patch };
    localStorage.setItem(onboardingLocalKey(orgId), JSON.stringify(next));
  } catch {
    /* quota, private mode, blocked site data — nothing to recover, nothing lost */
  }
}
