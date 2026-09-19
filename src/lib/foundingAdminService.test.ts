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
  ORG_PLANS, isOrgPlan,
  createWorkspace, setOrgPlan, renameOrg, inviteMember, fetchOrgDetail,
} from './foundingAdminService';

const ok = (data: unknown = null) => { response = { data, error: null }; };
const fail = (code: string, message = 'boom') => { response = { data: null, error: { code, message } }; };

beforeEach(() => {
  calls.length = 0;
  ok();
});

describe('ORG_PLANS', () => {
  it('is exactly the set finance.sql seeds finance_plan_prices with', () => {
    // A plan outside this list prices at nothing and silently drops out of
    // projected MRR. app_private.org_plan_list() carries the same nine.
    expect([...ORG_PLANS]).toEqual([
      'free', 'beta', 'starter', 'basic', 'growth',
      'pro', 'business', 'scale', 'enterprise',
    ]);
  });

  it('isOrgPlan accepts a member and rejects everything else', () => {
    expect(isOrgPlan('pro')).toBe(true);
    expect(isOrgPlan('platinum')).toBe(false);
    expect(isOrgPlan('')).toBe(false);
    expect(isOrgPlan(null)).toBe(false);
    expect(isOrgPlan(undefined)).toBe(false);
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
