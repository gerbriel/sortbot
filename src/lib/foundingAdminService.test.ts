import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * The founder-console half of foundingAdminService.
 *
 * WHAT IS WORTH ASSERTING HERE is not the happy path — it is the CONTRACT with
 * PostgREST, which has no compiler behind it: an RPC is resolved by its
 * function NAME and its ARGUMENT NAMES, so a renamed key in one of these
 * objects is a silent 404 at runtime with nothing in the type system to catch
 * it. `supabase/migrations/founder_console.sql` spells the same names in its
 * wrappers; these tests are the other end of that pair.
 *
 * The three error classifications matter for the same reason: 42501, a missing
 * function and an ordinary failure look identical to a `.catch()`, and the UI
 * does something different with each (a permission line, a setup hint naming
 * the migration, the database's own sentence).
 */

interface RpcCall { fn: string; args: unknown }
const calls: RpcCall[] = [];
let response: { data: unknown; error: { code?: string; message: string } | null } = { data: null, error: null };

vi.mock('./supabase', () => ({
  supabase: {
    rpc: (fn: string, args?: unknown) => {
      calls.push({ fn, args });
      return Promise.resolve(response);
    },
  },
}));

import {
  ORG_PLANS, PROTECTED_PLANS,
  createWorkspace, setOrgPlan, renameOrg, inviteMember, fetchOrgDetail,
  fetchPlanDirectory, upsertPlan, renamePlan, deletePlan,
  fetchOrgPlanHistory, fetchPlanAlumni,
} from './foundingAdminService';

const ok = (data: unknown = null) => { response = { data, error: null }; };
const fail = (code: string, message = 'boom') => { response = { data: null, error: { code, message } }; };

beforeEach(() => {
  calls.length = 0;
  ok();
});

describe('ORG_PLANS', () => {
  it('is the nine finance_plan_prices is SEEDED with — the fallback, not the set', () => {
    // Since plan_management.sql, the catalog is a table and org_plan_list()
    // reads it. This list is only what a dropdown shows when the catalog cannot
    // be read at all. Adding a tenth plan is a row, not an edit to this array.
    expect([...ORG_PLANS]).toEqual([
      'free', 'beta', 'starter', 'basic', 'growth',
      'pro', 'business', 'scale', 'enterprise',
    ]);
  });

  it('names the two plans neither half of the app may rename or delete', () => {
    // organizations.plan DEFAULTs to 'free'; the waitlist path and the
    // console's new-workspace default write 'beta'; finance_summary's founding
    // test reads the literal 'beta'. The server refuses too — this is so the
    // UI can say WHY before the click.
    expect([...PROTECTED_PLANS]).toEqual(['free', 'beta']);
  });
});

describe('RPC names and argument names', () => {
  it('createWorkspace sends p_name / p_plan / p_owner_email, trimmed and lower-cased', async () => {
    ok('new-org-id');
    const res = await createWorkspace({ name: '  Rack City  ', plan: 'pro', ownerEmail: '  OWNER@Shop.Test ' });
    expect(res).toEqual({ ok: true, id: 'new-org-id' });
    expect(calls).toEqual([{
      fn: 'founding_create_workspace',
      // The email is normalised HERE as well as in SQL: the function looks the
      // account up with lower(email), so a client that sent mixed case would
      // silently take the invite branch for a user that already exists.
      args: { p_name: 'Rack City', p_plan: 'pro', p_owner_email: 'owner@shop.test' },
    }]);
  });

  it('setOrgPlan sends p_org / p_plan', async () => {
    await setOrgPlan('org-1', 'growth');
    expect(calls[0]).toEqual({ fn: 'founding_set_org_plan', args: { p_org: 'org-1', p_plan: 'growth' } });
  });

  it('renameOrg sends p_org / p_name, trimmed', async () => {
    await renameOrg('org-1', '  Shop A  ');
    expect(calls[0]).toEqual({ fn: 'founding_rename_org', args: { p_org: 'org-1', p_name: 'Shop A' } });
  });

  it('inviteMember sends p_org / p_email / p_role and returns the invite id', async () => {
    ok('invite-id');
    const res = await inviteMember('org-1', '  New.Person@Shop.test ', 'admin');
    expect(res).toEqual({ ok: true, id: 'invite-id' });
    expect(calls[0]).toEqual({
      fn: 'founding_invite_member',
      args: { p_org: 'org-1', p_email: 'new.person@shop.test', p_role: 'admin' },
    });
  });

  it('fetchOrgDetail sends p_org', async () => {
    ok({ org: { id: 'org-1', name: 'Shop A', slug: null, plan: 'pro', created_at: 'x' } });
    await fetchOrgDetail('org-1');
    expect(calls[0]).toEqual({ fn: 'founding_org_detail', args: { p_org: 'org-1' } });
  });
});

describe('error classification', () => {
  it('42501 is "forbidden", with a permission sentence rather than the raw message', async () => {
    fail('42501', 'Not authorized — Founding Workspace admins only.');
    const res = await setOrgPlan('org-1', 'pro');
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('forbidden');
    expect(res.error).toBe('Founding Workspace admins only.');
  });

  it('a missing function is "unavailable" and names the migration', async () => {
    for (const code of ['42883', 'PGRST202']) {
      fail(code, 'function does not exist');
      const res = await createWorkspace({ name: 'X', plan: 'beta', ownerEmail: 'a@b.com' });
      expect(res.reason, code).toBe('unavailable');
      expect(res.error, code).toContain('founder_console.sql');
    }
  });

  it('anything else is "error" and shows the database\'s own sentence', async () => {
    // These functions write their messages in plain English on purpose, so the
    // right thing to do with one is print it.
    fail('23505', 'There is already an invite for that address in this workspace.');
    const res = await inviteMember('org-1', 'a@b.com', 'member');
    expect(res.reason).toBe('error');
    expect(res.error).toBe('There is already an invite for that address in this workspace.');
  });
});

describe('fetchOrgDetail', () => {
  it('fills in every optional branch of the payload', async () => {
    ok({ org: { id: 'org-1', name: 'Shop A', slug: null, plan: 'beta', created_at: 'x' } });
    const res = await fetchOrgDetail('org-1');
    expect(res.status).toBe('ok');
    if (res.status !== 'ok') throw new Error('unreachable');
    // A pre-marketplaces database returns no key at all; [] is the contract the
    // view renders against, so the service supplies it rather than the caller.
    expect(res.detail.marketplaces).toEqual([]);
    expect(res.detail.members).toEqual([]);
    expect(res.detail.invites).toEqual([]);
    expect(res.detail.counts).toEqual({ batches: 0, products: 0, images: 0 });
    expect(res.detail.last_active).toBeNull();
  });

  it('passes the whole payload through when it is complete', async () => {
    ok({
      org: { id: 'org-1', name: 'Shop A', slug: 'founding', plan: 'pro', created_at: 'x' },
      members: [{ user_id: 'u1', email: 'a@b.com', role: 'owner', created_at: 'y' }],
      invites: [{ id: 'i1', email: 'c@d.com', role: 'member', created_at: 'z' }],
      counts: { batches: 2, products: 1, images: 5 },
      last_active: '2026-09-12T00:00:00Z',
      marketplaces: ['ebay', 'poshmark'],
    });
    const res = await fetchOrgDetail('org-1');
    if (res.status !== 'ok') throw new Error('expected ok');
    expect(res.detail.members[0].role).toBe('owner');
    expect(res.detail.invites[0].email).toBe('c@d.com');
    expect(res.detail.counts.images).toBe(5);
    expect(res.detail.marketplaces).toEqual(['ebay', 'poshmark']);
  });

  it('reports forbidden and unavailable as statuses, not as thrown errors', async () => {
    fail('42501');
    expect((await fetchOrgDetail('org-1')).status).toBe('forbidden');
    fail('PGRST202');
    expect((await fetchOrgDetail('org-1')).status).toBe('unavailable');
  });
});

/* ── Plan management (supabase/migrations/plan_management.sql) ───────────────
   Same reasoning as the block above, plus one thing that only applies here:
   the `unavailable` sentence must name plan_management.sql and NOT
   founder_console.sql. A founder who has run one file and not the other gets
   sent to the wrong SQL Editor tab otherwise, and both look identically
   "broken" from the UI. */

describe('plan RPC names and argument names', () => {
  it('fetchPlanDirectory calls founding_plan_directory with no arguments', async () => {
    ok([]);
    await fetchPlanDirectory();
    expect(calls[0]).toEqual({ fn: 'founding_plan_directory', args: undefined });
  });

  it('upsertPlan sends all six p_ arguments, key normalised', async () => {
    await upsertPlan({
      plan: '  Studio ', displayName: '  Studio  ', monthlyCents: 29900,
      note: ' launch tier ', isActive: true, sortOrder: 40,
    });
    expect(calls[0]).toEqual({
      fn: 'founding_upsert_plan',
      args: {
        // lower+trim here as well as in SQL: the function compares
        // lower(btrim(p_plan)), so ' Studio ' would look like a CREATE when it
        // is an update of the row that already exists.
        p_plan: 'studio', p_display_name: 'Studio', p_monthly_cents: 29900,
        p_note: 'launch tier', p_is_active: true, p_sort_order: 40,
      },
    });
  });

  it('sends null for an omitted FLAG, and requires the two REPLACE fields', async () => {
    // The two halves of this argument list behave differently, and the type
    // enforces the dangerous one: `displayName` and `note` are REPLACED by the
    // function — null CLEARS them — so they are required rather than optional,
    // and a partial writer that posted only { plan, isActive } cannot compile.
    // `isActive` / `sortOrder` are the opposite: null means "column default on
    // insert, leave the existing value alone on update", and an OMITTED key
    // would be dropped from the JSON body so the RPC would not resolve at all.
    await upsertPlan({ plan: 'studio', displayName: null, monthlyCents: 0, note: null });
    expect(calls[0].args).toEqual({
      p_plan: 'studio', p_display_name: null, p_monthly_cents: 0,
      p_note: null, p_is_active: null, p_sort_order: null,
    });
  });

  it('upsertPlan rounds cents and trims the two replace fields to null when blank', async () => {
    await upsertPlan({
      plan: 'studio', displayName: '   ', monthlyCents: 4999.6, note: '  ',
    });
    // '' would be a stored empty string where the column means "unset", and the
    // UI falls back to the key on null, not on ''.
    expect(calls[0].args).toEqual({
      p_plan: 'studio', p_display_name: null, p_monthly_cents: 5000,
      p_note: null, p_is_active: null, p_sort_order: null,
    });
  });

  it('renamePlan sends p_from / p_to and reports the workspaces moved', async () => {
    ok(7);
    const res = await renamePlan(' Growth ', '  SCALE-UP ');
    expect(calls[0]).toEqual({ fn: 'founding_rename_plan', args: { p_from: 'growth', p_to: 'scale-up' } });
    // The count rides its own field rather than being smuggled through `error`,
    // which the UI prints verbatim.
    expect(res).toEqual({ ok: true, moved: 7 });
  });

  it('deletePlan sends p_plan', async () => {
    await deletePlan('Studio');
    expect(calls[0]).toEqual({ fn: 'founding_delete_plan', args: { p_plan: 'studio' } });
  });

  it('fetchOrgPlanHistory sends p_org', async () => {
    ok([]);
    await fetchOrgPlanHistory('org-1');
    expect(calls[0]).toEqual({ fn: 'founding_org_plan_history', args: { p_org: 'org-1' } });
  });

  it('fetchPlanAlumni defaults to beta and sends p_plan either way', async () => {
    ok([]);
    await fetchPlanAlumni();
    expect(calls[0]).toEqual({ fn: 'founding_plan_alumni', args: { p_plan: 'beta' } });
    ok([]);
    await fetchPlanAlumni('Pro');
    expect(calls[1]).toEqual({ fn: 'founding_plan_alumni', args: { p_plan: 'pro' } });
  });
});

describe('fetchPlanDirectory', () => {
  it('coerces the bigint counts, which PostgREST may hand back as strings', async () => {
    // monthly_cents feeds a `!==` dirty-check in the plans editor: '4900' would
    // never equal 4900 and every row would show unsaved changes forever.
    ok([{
      plan: 'pro', display_name: 'Pro', monthly_cents: '25000', note: null,
      is_active: true, sort_order: '60', workspaces: '3', ever_used: '9', protected: false,
    }]);
    const res = await fetchPlanDirectory();
    if (res.status !== 'ok') throw new Error('expected ok');
    expect(res.plans[0]).toEqual({
      plan: 'pro', display_name: 'Pro', monthly_cents: 25000, note: null,
      is_active: true, sort_order: 60, workspaces: 3, ever_used: 9, protected: false,
    });
  });

  it('fills the optional fields and infers `protected` from the key', async () => {
    // A server that predates the `protected` column must not let the UI offer a
    // Delete on `free` — the client knows the same two names.
    ok([{ plan: 'free' }, { plan: 'beta' }, { plan: 'studio' }]);
    const res = await fetchPlanDirectory();
    if (res.status !== 'ok') throw new Error('expected ok');
    expect(res.plans.map(p => p.protected)).toEqual([true, true, false]);
    expect(res.plans[2]).toEqual({
      plan: 'studio', display_name: null, monthly_cents: 0, note: null,
      is_active: true, sort_order: 100, workspaces: 0, ever_used: 0, protected: false,
    });
  });

  it('reports a missing function as unavailable, naming plan_management.sql', async () => {
    for (const code of ['42883', 'PGRST202']) {
      fail(code, 'function does not exist');
      const res = await fetchPlanDirectory();
      if (res.status === 'ok') throw new Error(`expected a failure for ${code}`);
      expect(res.status, code).toBe('unavailable');
      expect(res.error, code).toContain('plan_management.sql');
      // Naming the wrong migration is worse than naming none: founder_console.sql
      // may well already have been run.
      expect(res.error, code).not.toContain('founder_console.sql');
    }
  });

  it('reports 42501 as forbidden and anything else as error', async () => {
    fail('42501');
    expect((await fetchPlanDirectory()).status).toBe('forbidden');
    fail('P0001', 'Something went wrong.');
    const res = await fetchPlanDirectory();
    if (res.status === 'ok') throw new Error('expected a failure');
    expect(res.status).toBe('error');
    expect(res.error).toBe('Something went wrong.');
  });
});

describe('plan write failures', () => {
  it('a missing function names plan_management.sql on every write', async () => {
    fail('42883', 'function does not exist');
    for (const res of [
      await upsertPlan({ plan: 'x', displayName: null, monthlyCents: 0, note: null }),
      await renamePlan('a', 'b'),
      await deletePlan('x'),
    ]) {
      expect(res.reason).toBe('unavailable');
      expect(res.error).toContain('plan_management.sql');
    }
  });

  it('the database\'s own refusal is shown as-is', async () => {
    // These functions write their messages in plain English on purpose: "free
    // and beta are built in and cannot be renamed" is the whole explanation.
    fail('P0001', 'The free plan is built in and cannot be renamed.');
    const res = await renamePlan('free', 'gratis');
    expect(res.reason).toBe('error');
    expect(res.error).toBe('The free plan is built in and cannot be renamed.');
    expect(res.moved).toBeUndefined();
  });

  it('forbidden still reads as a permission sentence, not a setup hint', async () => {
    fail('42501', 'permission denied');
    const res = await deletePlan('studio');
    expect(res.reason).toBe('forbidden');
    expect(res.error).toBe('Founding Workspace admins only.');
  });
});

describe('fetchOrgPlanHistory', () => {
  it('returns [] rather than throwing on a missing function', async () => {
    fail('42883', 'function does not exist');
    await expect(fetchOrgPlanHistory('org-1')).resolves.toEqual([]);
  });

  it('returns [] on a permission failure too — the panel decides what empty means', async () => {
    fail('42501');
    await expect(fetchOrgPlanHistory('org-1')).resolves.toEqual([]);
  });

  it('passes the rows through untouched', async () => {
    const rows = [{
      plan: 'pro', previous_plan: 'beta', changed_at: '2027-03-12T00:00:00Z',
      changed_by_email: 'me@shop.test', source: 'trigger',
    }];
    ok(rows);
    await expect(fetchOrgPlanHistory('org-1')).resolves.toEqual(rows);
  });
});

describe('fetchPlanAlumni', () => {
  it('carries a workspace that no longer exists', async () => {
    // The point of the whole table: organizations.plan cannot answer this, and
    // a foreign key would have deleted the answer with the workspace.
    ok([{
      org_id: 'gone-1', org_name: 'Closed Shop', current_plan: null,
      first_on: '2026-02-01T00:00:00Z', last_on: '2026-11-01T00:00:00Z',
      still_on: false, created_at: null, exists_now: false,
    }]);
    const res = await fetchPlanAlumni('beta');
    if (res.status !== 'ok') throw new Error('expected ok');
    expect(res.rows[0].exists_now).toBe(false);
    expect(res.rows[0].org_name).toBe('Closed Shop');
  });

  it('reports unavailable with the right migration named', async () => {
    fail('PGRST202', 'no function matches');
    const res = await fetchPlanAlumni();
    if (res.status === 'ok') throw new Error('expected a failure');
    expect(res.status).toBe('unavailable');
    expect(res.error).toContain('plan_management.sql');
  });
});
