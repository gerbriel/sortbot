/**
 * WHICH WORKFLOW STEP A PHONE IS SHOWING — the pure half.
 *
 * Steps 1-4 are four <section>s of ONE page and all four are mounted at once
 * (AGENTS.md §6: the workflow is never unmounted). Below 640px only one of them
 * is on screen at a time: App stamps `data-phone-step` on <main> and App.css
 * hides the other sections with `display: none` inside a `max-width: 640px`
 * block. Nothing unmounts, nothing re-fetches, and above 640px those CSS rules
 * do not exist — so this module is inert on a desktop.
 *
 * REACHABILITY MIRRORS THE RENDER CONDITIONS IN App.tsx, deliberately and by
 * hand: Step 1 always renders, Step 2 renders when `uploadedImages.length > 0`,
 * Step 3 when `sortedImages.length > 0`, Step 4 when `processedItems.length > 0`.
 * A step that is not rendered has no section to show, so the stepper must not
 * offer it. If one of those conditions ever changes, change it here too — the
 * tests are the reminder.
 *
 * REACHABILITY IS NOT ASSUMED CONTIGUOUS. In practice the four arrays are
 * always set together, but `reachableSteps` is a plain filter and every helper
 * here walks the list it returns rather than doing arithmetic on step numbers,
 * so a list like [1, 2, 4] degrades into "never jump the user forward" instead
 * of into a step that is not on the page.
 */

export type WorkflowStep = 1 | 2 | 3 | 4;

/** The three array lengths the render conditions in App.tsx are written against. */
export interface StepCounts {
  uploaded: number;
  sorted: number;
  processed: number;
}

/** `short` is the stepper chip; `long` is its title/description. */
export const STEP_LABELS: Record<WorkflowStep, { short: string; long: string }> = {
  1: { short: 'Upload',   long: 'Upload photos' },
  2: { short: 'Group',    long: 'Group & categorize' },
  3: { short: 'Describe', long: 'Describe listings' },
  4: { short: 'Export',   long: 'Export CSV' },
};

export const ALL_STEPS: readonly WorkflowStep[] = [1, 2, 3, 4];

/** The steps that actually have a section on the page, in order. Always includes 1. */
export function reachableSteps(counts: StepCounts): WorkflowStep[] {
  const steps: WorkflowStep[] = [1];
  if (counts.uploaded > 0) steps.push(2);
  if (counts.sorted > 0) steps.push(3);
  if (counts.processed > 0) steps.push(4);
  return steps;
}

export function isStepReachable(step: WorkflowStep, counts: StepCounts): boolean {
  return reachableSteps(counts).includes(step);
}

/** The last reachable step. Never below 1. */
export function furthestStep(counts: StepCounts): WorkflowStep {
  const steps = reachableSteps(counts);
  return steps[steps.length - 1];
}

/**
 * Where a RESTORED batch should open on a phone.
 *
 * Not `furthestStep`: every restore path sets all four arrays from one list, so
 * every reopened batch would land on Export. This reads the work instead —
 * the same signal `workflow_batches.current_step` is derived from — and it
 * never returns 4: the slim state cannot say whether the descriptions are
 * finished, Export is the one step with nothing to resume, and it is one
 * Continue tap away from Describe.
 *
 *   no items                → 1  (nothing to group yet)
 *   items, none categorized → 2  (grouping is the work in progress)
 *   any item categorized    → 3  (describing is)
 */
export function resumeStep(items: ReadonlyArray<{ category?: string | null }>): WorkflowStep {
  if (items.length === 0) return 1;
  return items.some(i => !!i.category) ? 3 : 2;
}

/**
 * Keep the shown step on a step that exists. A batch cleared out from under the
 * user (Clear Batch, a Library delete, an ungroup that drops the last category)
 * must never leave `data-phone-step` pointing at a section that no longer
 * renders — every section would then be hidden and the page would look empty.
 *
 * Falls back DOWNWARD, to the furthest reachable step below the requested one,
 * so losing Step 4 lands on Step 3 and not on Step 1, and a gap never promotes
 * the user past work they have not done.
 */
export function clampStep(step: WorkflowStep, counts: StepCounts): WorkflowStep {
  const steps = reachableSteps(counts);
  if (steps.includes(step)) return step;
  for (let i = steps.length - 1; i >= 0; i--) {
    if (steps[i] < step) return steps[i];
  }
  return 1;
}

/** The next reachable step after `step`, or undefined at the end of the line. */
export function nextReachable(step: WorkflowStep, reachable: readonly WorkflowStep[]): WorkflowStep | undefined {
  return reachable.find(s => s > step);
}

/** The nearest reachable step before `step`, or undefined on the first one. */
export function prevReachable(step: WorkflowStep, reachable: readonly WorkflowStep[]): WorkflowStep | undefined {
  let found: WorkflowStep | undefined;
  for (const s of reachable) { if (s < step) found = s; }
  return found;
}
