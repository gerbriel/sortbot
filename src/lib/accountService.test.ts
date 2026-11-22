import { describe, it, expect, beforeEach, vi } from 'vitest';

const invoke = vi.fn();
const signOut = vi.fn();

vi.mock('./supabase', () => ({
  supabase: {
    functions: { invoke: (...args: unknown[]) => invoke(...args) },
    auth: { signOut: (...args: unknown[]) => signOut(...args) },
  },
}));

vi.mock('./orgService', () => ({
  fetchMyMemberships: vi.fn(),
  fetchOrgMembers: vi.fn(),
}));

import { deleteMyAccount, planAccountDeletion, fetchAccountDeletionPlan, clearDeletedAccountStorage } from './accountService';
import { fetchMyMemberships, fetchOrgMembers } from './orgService';
import type { MyMembership, OrgMemberRow, OrgRole } from './orgService';

/** What supabase-js hands back for a non-2xx answer: the Response is `context`. */
function httpError(status: number, body: unknown) {
  return {
    name: 'FunctionsHttpError',
    message: 'Edge Function returned a non-2xx status code',
    context: new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  };
}

describe('deleteMyAccount', () => {
  beforeEach(() => {
    invoke.mockReset();
    signOut.mockReset();
    signOut.mockResolvedValue({ error: null });
  });

  it('sends exactly { confirm: "DELETE" } and signs out locally on success', async () => {
    invoke.mockResolvedValue({ data: { ok: true }, error: null });
    await expect(deleteMyAccount()).resolves.toEqual({ ok: true });
    expect(invoke).toHaveBeenCalledWith('delete-account', { body: { confirm: 'DELETE' } });
    expect(signOut).toHaveBeenCalledWith({ scope: 'local' });
  });

  it('maps a 409 last_owner to its code and the workspace name', async () => {
    invoke.mockResolvedValue({ data: null, error: httpError(409, { code: 'last_owner', detail: 'Rack & Ruin' }) });
    await expect(deleteMyAccount()).resolves.toEqual({ ok: false, code: 'last_owner', detail: 'Rack & Ruin' });
    expect(signOut).not.toHaveBeenCalled();
  });

  it('passes the workspace id of a last_owner refusal through as orgId', async () => {
    invoke.mockResolvedValue({ data: null, error: httpError(409, { code: 'last_owner', detail: 'Shop', orgId: 'org-9' }) });
    await expect(deleteMyAccount()).resolves.toEqual({ ok: false, code: 'last_owner', detail: 'Shop', orgId: 'org-9' });
  });

  it('maps a 409 founding_admin to its code', async () => {
    invoke.mockResolvedValue({ data: null, error: httpError(409, { code: 'founding_admin', detail: 'Founding Workspace' }) });
    await expect(deleteMyAccount()).resolves.toEqual({ ok: false, code: 'founding_admin', detail: 'Founding Workspace' });
  });

  it('treats a 409 with an unknown code as a plain failure', async () => {
    invoke.mockResolvedValue({ data: null, error: httpError(409, { code: 'something_else' }) });
    await expect(deleteMyAccount()).resolves.toEqual({ ok: false, code: 'failed' });
  });

  it('reads a 404 as "not deployed yet"', async () => {
    invoke.mockResolvedValue({ data: null, error: httpError(404, { code: 'NOT_FOUND', message: 'Requested function was not found' }) });
    await expect(deleteMyAccount()).resolves.toEqual({ ok: false, code: 'unavailable' });
    expect(signOut).not.toHaveBeenCalled();
  });

  it('reads a network failure (no status) as failed', async () => {
    invoke.mockResolvedValue({ data: null, error: { name: 'FunctionsFetchError', message: 'Failed to send a request', context: new TypeError('fetch failed') } });
    await expect(deleteMyAccount()).resolves.toEqual({ ok: false, code: 'failed' });
    expect(signOut).not.toHaveBeenCalled();
  });

  it('reads a thrown invoke as failed', async () => {
    invoke.mockRejectedValue(new TypeError('Load failed'));
    await expect(deleteMyAccount()).resolves.toEqual({ ok: false, code: 'failed' });
  });

  it('maps a 500 carrying code "blocked" to blocked', async () => {
    invoke.mockResolvedValue({ data: null, error: httpError(500, { code: 'blocked', error: 'Account deletion needs help.' }) });
    await expect(deleteMyAccount()).resolves.toEqual({ ok: false, code: 'blocked' });
    expect(signOut).not.toHaveBeenCalled();
  });

  it('clears the account keys from localStorage on success, and keeps device preferences', async () => {
    localStorage.setItem('sortbot_workflow_backup', '{}');
    localStorage.setItem('sortbot_current_batch_id', 'b1');
    localStorage.setItem('sortbot_deleted_batch_ids', '[]');
    localStorage.setItem('sortbot_onboarding_org-1', '{}');
    localStorage.setItem('sortbot_onboarding_org-2', '{}');
    localStorage.setItem('sortbot_magnifier_settings', '{}');
    invoke.mockResolvedValue({ data: { ok: true }, error: null });
    await deleteMyAccount();
    expect(localStorage.getItem('sortbot_workflow_backup')).toBeNull();
    expect(localStorage.getItem('sortbot_current_batch_id')).toBeNull();
    expect(localStorage.getItem('sortbot_deleted_batch_ids')).toBeNull();
    expect(localStorage.getItem('sortbot_onboarding_org-1')).toBeNull();
    expect(localStorage.getItem('sortbot_onboarding_org-2')).toBeNull();
    expect(localStorage.getItem('sortbot_magnifier_settings')).toBe('{}');
    localStorage.clear();
  });

  it('clearDeletedAccountStorage never throws when storage is unavailable', () => {
    const spy = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(() => clearDeletedAccountStorage()).not.toThrow();
    spy.mockRestore();
  });

  it('a 500 is failed, and a 200 without ok:true is not a success', async () => {
    invoke.mockResolvedValueOnce({ data: null, error: httpError(500, { error: 'Account deletion failed.' }) });
    await expect(deleteMyAccount()).resolves.toEqual({ ok: false, code: 'failed' });
    invoke.mockResolvedValueOnce({ data: {}, error: null });
    await expect(deleteMyAccount()).resolves.toEqual({ ok: false, code: 'failed' });
    expect(signOut).not.toHaveBeenCalled();
  });

  it('still reports success when the local sign-out throws', async () => {
    invoke.mockResolvedValue({ data: { ok: true }, error: null });
    signOut.mockRejectedValue(new Error('storage unavailable'));
    await expect(deleteMyAccount()).resolves.toEqual({ ok: true });
  });
});

const ME = 'me';
const mem = (org_id: string, role: OrgRole, name: string, slug: string | null = null): MyMembership =>
  ({ org_id, role, name, slug, created_at: '2026-01-01T00:00:00Z' });
const member = (org_id: string, user_id: string, role: OrgRole): OrgMemberRow =>
  ({ org_id, user_id, role, email: null, created_at: '2026-01-01T00:00:00Z' });

describe('planAccountDeletion (mirrors delete_account_data)', () => {
  it('sole member: the workspace is deleted', () => {
    const plan = planAccountDeletion(ME, [mem('a', 'owner', 'Solo')], { a: [member('a', ME, 'owner')] });
    expect(plan.rows[0]).toMatchObject({ fate: 'delete', otherMembers: 0 });
    expect(plan.blocked).toBe(false);
  });

  it('another owner exists: the user leaves', () => {
    const plan = planAccountDeletion(ME, [mem('a', 'owner', 'Shared')],
      { a: [member('a', ME, 'owner'), member('a', 'b', 'owner'), member('a', 'c', 'member')] });
    expect(plan.rows[0]).toMatchObject({ fate: 'leave', otherMembers: 2 });
  });

  it('a non-owner leaves even when nobody else is an owner', () => {
    const plan = planAccountDeletion(ME, [mem('a', 'admin', 'Shared')], { a: [member('a', ME, 'admin'), member('a', 'b', 'member')] });
    expect(plan.rows[0].fate).toBe('leave');
  });

  it('last owner with other members blocks the deletion', () => {
    const plan = planAccountDeletion(ME, [mem('a', 'owner', 'Shop')], { a: [member('a', ME, 'owner'), member('a', 'b', 'admin')] });
    expect(plan.rows[0].fate).toBe('last_owner');
    expect(plan.rows[0].others.map(o => o.user_id)).toEqual(['b']);
    expect(plan.blocked).toBe(true);
  });

  it('a founding owner or admin blocks; a founding member leaves', () => {
    const fa = planAccountDeletion(ME, [mem('f', 'admin', 'Founding Workspace', 'founding')], {});
    expect(fa.rows[0].fate).toBe('founding_admin');
    expect(fa.blocked).toBe(true);
    const fm = planAccountDeletion(ME, [mem('f', 'member', 'Founding Workspace', 'founding')],
      { f: [member('f', ME, 'member'), member('f', 'o', 'owner')] });
    expect(fm.rows[0].fate).toBe('leave');
  });

  it('an unreadable member list (no row for me) is unknown, never "deleted"', () => {
    const plan = planAccountDeletion(ME, [mem('a', 'owner', 'Shop')], { a: [] });
    expect(plan.rows[0].fate).toBe('unknown');
    expect(plan.blocked).toBe(false);
  });
});

describe('fetchAccountDeletionPlan', () => {
  it('reads my memberships and each member list', async () => {
    vi.mocked(fetchMyMemberships).mockResolvedValue([mem('a', 'owner', 'Solo'), mem('b', 'member', 'Shared')]);
    vi.mocked(fetchOrgMembers).mockImplementation(async (orgId: string) =>
      orgId === 'a' ? [member('a', ME, 'owner')] : [member('b', ME, 'member'), member('b', 'o', 'owner')]);
    const plan = await fetchAccountDeletionPlan(ME);
    expect(plan?.rows.map(r => r.fate)).toEqual(['delete', 'leave']);
  });

  it('returns null when the memberships cannot be read', async () => {
    vi.mocked(fetchMyMemberships).mockResolvedValue(null);
    await expect(fetchAccountDeletionPlan(ME)).resolves.toBeNull();
  });
});
