import { describe, it, expect } from 'vitest';
import { ALL_STEPS, STEP_LABELS, clampStep, furthestStep, isStepReachable, nextReachable, prevReachable, reachableSteps, type StepCounts, type WorkflowStep, resumeStep } from './phoneSteps';

const counts = (uploaded: number, sorted: number, processed: number): StepCounts =>
  ({ uploaded, sorted, processed });

/** Nothing uploaded yet — the state a fresh account and a cleared batch share. */
const EMPTY = counts(0, 0, 0);
/** Photos in, nothing categorized: Steps 1-2. */
const UPLOADED = counts(12, 0, 0);
/** Everything set together, which is what every restore path actually does. */
const FULL = counts(12, 12, 12);

describe('reachableSteps', () => {
  it('always offers Step 1, even with nothing at all', () => {
    expect(reachableSteps(EMPTY)).toEqual([1]);
  });

  it('adds Step 2 once anything is uploaded', () => {
    expect(reachableSteps(UPLOADED)).toEqual([1, 2]);
  });

  it('adds Step 3 once anything is sorted', () => {
    expect(reachableSteps(counts(12, 4, 0))).toEqual([1, 2, 3]);
  });

  it('adds Step 4 once anything is processed', () => {
    expect(reachableSteps(FULL)).toEqual([1, 2, 3, 4]);
  });

  it('mirrors the render conditions independently — one count does not imply another', () => {
    // The four arrays are set together in practice, but the render conditions in
    // App.tsx are three separate `length > 0` tests, so this must stay a filter
    // and not a "furthest wins" ramp.
    expect(reachableSteps(counts(0, 0, 3))).toEqual([1, 4]);
    expect(reachableSteps(counts(0, 3, 0))).toEqual([1, 3]);
  });

  it('treats a negative or fractional count as no items', () => {
    expect(reachableSteps(counts(-1, 0, 0))).toEqual([1]);
    expect(reachableSteps(counts(0.4, 0, 0))).toEqual([1, 2]);
  });
});

describe('isStepReachable', () => {
  it('answers per step', () => {
    expect(isStepReachable(1, EMPTY)).toBe(true);
    expect(isStepReachable(2, EMPTY)).toBe(false);
    expect(isStepReachable(2, UPLOADED)).toBe(true);
    expect(isStepReachable(3, UPLOADED)).toBe(false);
    expect(isStepReachable(4, FULL)).toBe(true);
  });
});

describe('furthestStep', () => {
  it('is 1 with nothing loaded', () => {
    expect(furthestStep(EMPTY)).toBe(1);
  });

  it('is 2 after an upload with no categories', () => {
    expect(furthestStep(UPLOADED)).toBe(2);
  });

  it('is 4 for a restored batch — every restore sets all four arrays at once', () => {
    expect(furthestStep(FULL)).toBe(4);
  });

  it('is the LAST reachable step, not the highest contiguous one', () => {
    expect(furthestStep(counts(0, 0, 3))).toBe(4);
  });
});

describe('clampStep', () => {
  it('leaves a reachable step alone', () => {
    expect(clampStep(1, EMPTY)).toBe(1);
    expect(clampStep(2, UPLOADED)).toBe(2);
    expect(clampStep(4, FULL)).toBe(4);
  });

  it('falls back to 1 when the batch is cleared out from under the user', () => {
    // Clear Batch / a Library delete of the active batch empties all four arrays.
    for (const step of ALL_STEPS) expect(clampStep(step, EMPTY)).toBe(1);
  });

  it('falls DOWN to the nearest reachable step, not all the way to 1', () => {
    // On Step 4, the last categorized item is removed: 3 and 4 both vanish.
    expect(clampStep(4, UPLOADED)).toBe(2);
    expect(clampStep(3, UPLOADED)).toBe(2);
  });

  it('keeps Step 4 when only Step 3 vanishes', () => {
    // sorted emptied but processed still populated: 4 is still rendered, so the
    // user stays on the step they are looking at.
    expect(clampStep(4, counts(12, 0, 12))).toBe(4);
  });

  it('never promotes the user past a gap', () => {
    // 3 is gone, 4 exists: a user sitting on 3 drops to 2 rather than jumping to 4.
    expect(clampStep(3, counts(12, 0, 12))).toBe(2);
  });

  it('is idempotent', () => {
    for (const step of ALL_STEPS) {
      const once = clampStep(step, UPLOADED);
      expect(clampStep(once, UPLOADED)).toBe(once);
    }
  });

  it('always returns a reachable step for every step/count combination', () => {
    const shapes = [EMPTY, UPLOADED, FULL, counts(1, 1, 0), counts(0, 0, 1), counts(0, 1, 1)];
    for (const shape of shapes) {
      for (const step of ALL_STEPS) {
        expect(reachableSteps(shape)).toContain(clampStep(step, shape));
      }
    }
  });
});

describe('nextReachable / prevReachable', () => {
  const reach = reachableSteps(FULL);

  it('walks forward one reachable step at a time', () => {
    expect(nextReachable(1, reach)).toBe(2);
    expect(nextReachable(3, reach)).toBe(4);
    expect(nextReachable(4, reach)).toBeUndefined();
  });

  it('walks backward one reachable step at a time', () => {
    expect(prevReachable(4, reach)).toBe(3);
    expect(prevReachable(2, reach)).toBe(1);
    expect(prevReachable(1, reach)).toBeUndefined();
  });

  it('skips a gap instead of offering a step that is not on the page', () => {
    const gappy: WorkflowStep[] = [1, 4];
    expect(nextReachable(1, gappy)).toBe(4);
    expect(prevReachable(4, gappy)).toBe(1);
  });

  it('has no Continue target when only Step 1 exists', () => {
    expect(nextReachable(1, reachableSteps(EMPTY))).toBeUndefined();
  });
});

describe('STEP_LABELS', () => {
  it('names all four steps short and long', () => {
    expect(STEP_LABELS).toEqual({
      1: { short: 'Upload',   long: 'Upload photos' },
      2: { short: 'Group',    long: 'Group & categorize' },
      3: { short: 'Describe', long: 'Describe listings' },
      4: { short: 'Export',   long: 'Export CSV' },
    });
  });

  it('covers every step in ALL_STEPS', () => {
    expect(ALL_STEPS).toEqual([1, 2, 3, 4]);
    for (const step of ALL_STEPS) expect(STEP_LABELS[step].short.length).toBeGreaterThan(0);
  });
});

describe('resumeStep', () => {
  it('opens an empty batch on Upload', () => {
    expect(resumeStep([])).toBe(1);
  });

  it('opens an uncategorized batch on Group', () => {
    expect(resumeStep([{}, { category: '' }, { category: null }])).toBe(2);
  });

  it('opens a batch with any category on Describe', () => {
    expect(resumeStep([{}, { category: 'tees' }])).toBe(3);
  });

  it('never lands on Export, even when everything is categorized', () => {
    expect(resumeStep([{ category: 'tees' }, { category: 'hats' }])).toBe(3);
  });
});
