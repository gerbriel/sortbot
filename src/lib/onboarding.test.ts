import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  deriveOnboardingSteps, onboardingProgress, onboardingLocalKey,
  readOnboardingLocal, writeOnboardingLocal, UNKNOWN_FACTS,
  type OnboardingFacts, type OnboardingStepId,
} from './onboarding';

/**
 * The checklist's whole value is that it disappears when it is finished and
 * never asks for something already done — so the two things worth locking are
 * each step's `done` rule and which steps are on the list at all.
 *
 * Two invariants run through the file and each has its own test: an UNKNOWN
 * fact is never "done" (a failed read must not tick a step off), and a step the
 * caller could not perform — a missing migration, or an RLS policy that would
 * refuse them — is absent rather than permanently red.
 */

const ids = (f: Partial<OnboardingFacts>): OnboardingStepId[] =>
  deriveOnboardingSteps(f).map(s => s.id);

const step = (f: Partial<OnboardingFacts>, id: OnboardingStepId) => {
  const found = deriveOnboardingSteps(f).find(s => s.id === id);
  if (!found) throw new Error(`step ${id} is not on the list`);
  return found;
};

/** An owner of a workspace where every optional feature has been migrated. */
const owner: Partial<OnboardingFacts> = {
  role: 'owner', canInvite: true, marketplaces: 0, shopify: false,
};

describe('deriveOnboardingSteps — which steps appear', () => {
  it('gives a fresh owner the full list, in order', () => {
    expect(ids(owner)).toEqual([
      'shop-name', 'categories', 'marketplaces', 'shopify',
      'team', 'first-batch', 'first-export',
    ]);
  });

  it('omits the marketplaces step entirely before the migration has run', () => {
    // Absent, not undone: a feature that is not installed must not read as
    // something the shop has failed to do.
    expect(ids({ ...owner, marketplaces: 'unavailable' })).not.toContain('marketplaces');
  });

  it('omits the Shopify step entirely before the migration has run', () => {
    expect(ids({ ...owner, shopify: 'unavailable' })).not.toContain('shopify');
  });

  it('omits Invite your team for someone who cannot send an invite', () => {
    expect(ids({ ...owner, canInvite: false })).not.toContain('team');
  });

  it('hides the three admin-only steps from a plain member', () => {
    // organizations, org_marketplaces and org_shopify_connections are all
    // admin/owner on write — a member shown these could only fail at them.
    const list = ids({ role: 'member', canInvite: false, marketplaces: 2, shopify: true });
    expect(list).toEqual(['categories', 'first-batch', 'first-export']);
  });

  it('shows them to an admin, not only an owner', () => {
    expect(ids({ ...owner, role: 'admin' })).toContain('shop-name');
  });

  it('defaults every unsupplied fact to unknown, so nothing is ticked off', () => {
    const steps = deriveOnboardingSteps({});
    expect(steps.every(s => !s.done)).toBe(true);
  });

  it('UNKNOWN_FACTS is genuinely all-undone', () => {
    expect(deriveOnboardingSteps(UNKNOWN_FACTS).every(s => !s.done)).toBe(true);
  });
});

describe('deriveOnboardingSteps — the done rules', () => {
  it('Name your shop is done once a vendor name is set', () => {
    expect(step(owner, 'shop-name').done).toBe(false);
    expect(step({ ...owner, hasVendorName: true }, 'shop-name').done).toBe(true);
  });

  it('Review categories is done by VISITING either view', () => {
    // "Reviewed" is a human judgement; the only thing observable is that the
    // page was opened. Either page counts — they are two halves of one idea.
    expect(step(owner, 'categories').done).toBe(false);
    expect(step({ ...owner, visitedCategories: true }, 'categories').done).toBe(true);
    expect(step({ ...owner, visitedPresets: true }, 'categories').done).toBe(true);
  });

  it('a workspace with categories but no visit is still not reviewed', () => {
    // Deliberate: counts inform the sentence, they do not tick the box — and
    // gating on a count would deadlock a workspace whose preset seed failed.
    const s = step({ ...owner, categoryCount: 9, presetCount: 9 }, 'categories');
    expect(s.done).toBe(false);
    expect(s.why).toContain('9 categories and 9 presets');
  });

  it('singularises the counts it prints', () => {
    expect(step({ ...owner, categoryCount: 1, presetCount: 1 }, 'categories').why)
      .toContain('1 category and 1 preset');
  });

  it('Choose where you sell is done at one enabled marketplace', () => {
    expect(step({ ...owner, marketplaces: 0 }, 'marketplaces').done).toBe(false);
    expect(step({ ...owner, marketplaces: 1 }, 'marketplaces').done).toBe(true);
  });

  it('Connect Shopify is done when a connection row exists, and is optional', () => {
    expect(step({ ...owner, shopify: false }, 'shopify').done).toBe(false);
    expect(step({ ...owner, shopify: true }, 'shopify').done).toBe(true);
    expect(step({ ...owner, shopify: true }, 'shopify').optional).toBe(true);
  });

  it('Invite your team is done at a SECOND member, not the first', () => {
    // memberCount includes the caller, so 1 is a workspace of one.
    expect(step({ ...owner, memberCount: 1 }, 'team').done).toBe(false);
    expect(step({ ...owner, memberCount: 2 }, 'team').done).toBe(true);
    expect(step({ ...owner, memberCount: 2 }, 'team').optional).toBe(true);
  });

  it('the first batch and the first export are done at one each', () => {
    expect(step({ ...owner, batchCount: 1 }, 'first-batch').done).toBe(true);
    expect(step({ ...owner, exportedCount: 1 }, 'first-export').done).toBe(true);
    expect(step({ ...owner, batchCount: 3 }, 'first-export').done).toBe(false);
  });
});

describe('deriveOnboardingSteps — where each button goes', () => {
  it('routes every step somewhere reachable', () => {
    for (const s of deriveOnboardingSteps(owner)) {
      expect(s.action.label.length).toBeGreaterThan(0);
      if (s.action.kind === 'navigate') expect(s.action.view).toBeTruthy();
      if (s.action.kind === 'workflow') expect([1, 2, 3, 4]).toContain(s.action.step);
    }
  });

  it('marketplaces is not a view of its own — it has its own action kind', () => {
    expect(step(owner, 'marketplaces').action.kind).toBe('marketplaces');
  });

  it('the export step opens the workflow on Step 4, not Step 1', () => {
    const action = step(owner, 'first-export').action;
    expect(action).toEqual({ kind: 'workflow', label: 'Go to export', step: 4 });
  });
});

describe('onboardingProgress', () => {
  it('counts every step for the readout, required steps for completeness', () => {
    const steps = deriveOnboardingSteps(owner);
    expect(onboardingProgress(steps)).toEqual({ done: 0, total: 7, complete: false });
  });

  it('is complete when the REQUIRED steps are done, with optionals outstanding', () => {
    const steps = deriveOnboardingSteps({
      ...owner,
      hasVendorName: true, visitedCategories: true, marketplaces: 2,
      batchCount: 1, exportedCount: 1,
      // Both optional steps left undone.
      shopify: false, memberCount: 1,
    });
    const p = onboardingProgress(steps);
    expect(p.complete).toBe(true);
    expect(p.done).toBe(5);
    expect(p.total).toBe(7);
  });

  it('is not complete while any required step is outstanding', () => {
    const steps = deriveOnboardingSteps({
      ...owner, hasVendorName: true, visitedPresets: true, marketplaces: 2,
      shopify: true, memberCount: 4, batchCount: 1,
      // first-export outstanding.
    });
    expect(onboardingProgress(steps).complete).toBe(false);
  });

  it('an empty list is complete rather than stuck', () => {
    expect(onboardingProgress([])).toEqual({ done: 0, total: 0, complete: true });
  });
});

describe('the per-workspace local record', () => {
  beforeEach(() => { localStorage.clear(); });
  afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });

  it('keys on the workspace, so two workspaces cannot share a dismissal', () => {
    expect(onboardingLocalKey('abc')).toBe('sortbot_onboarding_abc');
    writeOnboardingLocal('abc', { hidden: true });
    expect(readOnboardingLocal('abc').hidden).toBe(true);
    expect(readOnboardingLocal('def').hidden).toBeUndefined();
  });

  it('round-trips and MERGES rather than replacing', () => {
    writeOnboardingLocal('o1', { visitedCategories: true });
    writeOnboardingLocal('o1', { visitedPresets: true });
    expect(readOnboardingLocal('o1')).toEqual({ visitedCategories: true, visitedPresets: true });
  });

  it('reads nothing for an absent workspace id, and writes nothing', () => {
    expect(readOnboardingLocal(null)).toEqual({});
    writeOnboardingLocal(null, { hidden: true });
    expect(localStorage.length).toBe(0);
  });

  it('ignores a value that is not the shape it wrote', () => {
    localStorage.setItem(onboardingLocalKey('o1'), '["hidden"]');
    expect(readOnboardingLocal('o1')).toEqual({});
    localStorage.setItem(onboardingLocalKey('o1'), '{"hidden":"yes","visitedPresets":true}');
    // Only the literal `true` counts — a truthy string is not a dismissal.
    expect(readOnboardingLocal('o1')).toEqual({ visitedPresets: true });
  });

  it('survives unparseable JSON', () => {
    localStorage.setItem(onboardingLocalKey('o1'), 'not json {');
    expect(readOnboardingLocal('o1')).toEqual({});
  });

  it('survives an accessor that THROWS, which is the private-window case', () => {
    // localStorage.getItem itself throws with site data blocked — the try/catch
    // is round the accessor, not just the parse.
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('The operation is insecure.');
    });
    expect(readOnboardingLocal('o1')).toEqual({});
    getItem.mockRestore();

    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(() => writeOnboardingLocal('o1', { hidden: true })).not.toThrow();
    setItem.mockRestore();
  });
});
