import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { mount, cleanup, click, buttonByText, one } from './ui/testUtils';
import type { AccountDeletionPlan, DeleteAccountResult, WorkspacePlanRow } from '../lib/accountService';
import type { OrgMemberRow } from '../lib/orgService';

const fetchPlan = vi.fn<(userId: string) => Promise<AccountDeletionPlan | null>>();
const deleteAccount = vi.fn<() => Promise<DeleteAccountResult>>();

vi.mock('../lib/accountService', async () => {
  const actual = await vi.importActual<typeof import('../lib/accountService')>('../lib/accountService');
  return {
    ...actual,
    fetchAccountDeletionPlan: (userId: string) => fetchPlan(userId),
    deleteMyAccount: () => deleteAccount(),
  };
});

const updateRole = vi.fn<(orgId: string, userId: string, role: string) => Promise<boolean>>();
vi.mock('../lib/orgService', () => ({
  updateMemberRole: (orgId: string, userId: string, role: string) => updateRole(orgId, userId, role),
}));

import DeleteAccountDialog from './DeleteAccountDialog';

/** Let the plan promise (and any state it sets) settle inside act(). */
async function flush() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

/** Type into a React-controlled input the way the browser does. */
function type(input: HTMLInputElement, value: string) {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

type RowIn = Omit<WorkspacePlanRow, 'others'> & { others?: OrgMemberRow[] };
const plan = (rowsIn: RowIn[]): AccountDeletionPlan => {
  const rows = rowsIn.map(r => ({ ...r, others: r.others ?? [] }));
  return { rows, blocked: rows.some(r => r.fate === 'last_owner' || r.fate === 'founding_admin') };
};
const member = (org_id: string, user_id: string, role: OrgMemberRow['role'], email: string): OrgMemberRow =>
  ({ org_id, user_id, role, email, created_at: '2026-01-01T00:00:00Z' });

function render(extra: Partial<Parameters<typeof DeleteAccountDialog>[0]> = {}) {
  const props = {
    open: true,
    userId: 'me',
    email: 'me@example.test',
    onClose: vi.fn(),
    onDeleted: vi.fn(),
    onOpenWorkspace: vi.fn(),
    ...extra,
  };
  const m = mount(<DeleteAccountDialog {...props} />);
  return { ...m, props };
}

const deleteButton = () => buttonByText(document.body, 'Delete my account') as HTMLButtonElement;
const input = () => one(document.body, 'input') as HTMLInputElement;

describe('DeleteAccountDialog', () => {
  beforeEach(() => {
    fetchPlan.mockReset();
    deleteAccount.mockReset();
    updateRole.mockReset();
  });
  afterEach(() => cleanup());

  it('summarises each workspace: deleted, left', async () => {
    fetchPlan.mockResolvedValue(plan([
      { orgId: 'a', name: 'Solo Shop', role: 'owner', fate: 'delete', otherMembers: 0 },
      { orgId: 'b', name: 'Shared Shop', role: 'member', fate: 'leave', otherMembers: 3 },
    ]));
    render();
    await flush();
    const rows = Array.from(document.querySelectorAll('.dad-row'));
    expect(rows.map(r => r.getAttribute('data-fate'))).toEqual(['delete', 'leave']);
    expect(rows[0].textContent).toContain('Solo Shop');
    expect(rows[0].textContent).toContain('Will be deleted');
    expect(rows[1].textContent).toContain('3 other members keep');
    expect(fetchPlan).toHaveBeenCalledWith('me');
  });

  it('only enables Delete once DELETE is typed exactly', async () => {
    fetchPlan.mockResolvedValue(plan([{ orgId: 'a', name: 'Solo', role: 'owner', fate: 'delete', otherMembers: 0 }]));
    render();
    await flush();
    expect(deleteButton().disabled).toBe(true);
    type(input(), 'delete');
    expect(deleteButton().disabled).toBe(true);
    type(input(), 'DELETE ');
    expect(deleteButton().disabled).toBe(true);
    type(input(), 'DELETE');
    expect(deleteButton().disabled).toBe(false);
  });

  it('deletes and reports success', async () => {
    fetchPlan.mockResolvedValue(plan([]));
    deleteAccount.mockResolvedValue({ ok: true });
    const { props } = render();
    await flush();
    type(input(), 'DELETE');
    click(deleteButton());
    await flush();
    expect(deleteAccount).toHaveBeenCalledTimes(1);
    expect(props.onDeleted).toHaveBeenCalledTimes(1);
  });

  it('a last_owner workspace blocks, lists its members and resolves in place with Make owner', async () => {
    const blockedPlan = plan([{ orgId: 'a', name: 'Rack Room', role: 'owner', fate: 'last_owner', otherMembers: 1,
      others: [member('a', 'bea', 'admin', 'bea@shop.test')] }]);
    const clearPlan = plan([{ orgId: 'a', name: 'Rack Room', role: 'owner', fate: 'leave', otherMembers: 1 }]);
    fetchPlan.mockResolvedValueOnce(blockedPlan).mockResolvedValueOnce(clearPlan);
    updateRole.mockResolvedValue(true);
    render({ currentOrgId: 'somewhere-else' });
    await flush();
    const alert = one(document.body, '[role="alert"]');
    expect(alert.getAttribute('data-code')).toBe('last_owner');
    expect(alert.textContent).toContain('last owner of Rack Room');
    expect(alert.textContent).toContain('Transfer ownership first');
    expect(alert.textContent).toContain('bea@shop.test');
    // Not the current workspace: the Workspace page cannot help, so no link.
    expect(() => buttonByText(document.body, 'Open the Workspace page')).toThrow();
    expect(document.querySelector('input')).toBeNull();
    expect(deleteButton().disabled).toBe(true);

    // One tap only arms the confirmation; nothing is promoted yet.
    click(buttonByText(document.body, 'Make owner'));
    await flush();
    expect(updateRole).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('Make bea@shop.test an owner of Rack Room?');
    click(buttonByText(document.body, 'Make owner'));
    await flush();
    expect(updateRole).toHaveBeenCalledWith('a', 'bea', 'owner');
    expect(fetchPlan).toHaveBeenCalledTimes(2);
    expect(document.querySelector('[data-code="last_owner"]')).toBeNull();
    expect(document.querySelector('input')).not.toBeNull();
  });

  it('offers the Workspace page only when the blocking workspace is the current one', async () => {
    fetchPlan.mockResolvedValue(plan([{ orgId: 'a', name: 'Rack Room', role: 'owner', fate: 'last_owner', otherMembers: 1,
      others: [member('a', 'bea', 'member', 'bea@shop.test')] }]));
    const { props } = render({ currentOrgId: 'a' });
    await flush();
    click(buttonByText(document.body, 'Open the Workspace page'));
    expect(props.onOpenWorkspace).toHaveBeenCalledTimes(1);
  });

  it('a failed Make owner says so and keeps the block', async () => {
    fetchPlan.mockResolvedValue(plan([{ orgId: 'a', name: 'Rack Room', role: 'owner', fate: 'last_owner', otherMembers: 1,
      others: [member('a', 'bea', 'member', 'bea@shop.test')] }]));
    updateRole.mockResolvedValue(false);
    render();
    await flush();
    click(buttonByText(document.body, 'Make owner'));
    click(buttonByText(document.body, 'Make owner'));
    await flush();
    expect(document.body.textContent).toContain('did not save');
    expect(fetchPlan).toHaveBeenCalledTimes(1);
    expect(deleteButton().disabled).toBe(true);
  });

  it('a blocked answer asks for a founder, not for a better connection', async () => {
    fetchPlan.mockResolvedValue(plan([]));
    deleteAccount.mockResolvedValue({ ok: false, code: 'blocked' });
    render();
    await flush();
    type(input(), 'DELETE');
    click(deleteButton());
    await flush();
    expect(document.body.textContent).toContain("needs a founder's help");
    expect(document.body.textContent).not.toContain('Check your connection');
  });

  it('a last_owner refusal from the server replaces the preview', async () => {
    fetchPlan.mockResolvedValue(plan([{ orgId: 'a', name: 'Shop', role: 'owner', fate: 'leave', otherMembers: 1 }]));
    deleteAccount.mockResolvedValue({ ok: false, code: 'last_owner', detail: 'Shop' });
    const { props } = render();
    await flush();
    type(input(), 'DELETE');
    click(deleteButton());
    await flush();
    const alert = one(document.body, '[role="alert"]');
    expect(alert.getAttribute('data-code')).toBe('last_owner');
    expect(alert.textContent).toContain('last owner of Shop');
    expect(props.onDeleted).not.toHaveBeenCalled();
  });

  it('matches a server last_owner to its plan row by workspace id before name', async () => {
    fetchPlan.mockResolvedValue(plan([
      { orgId: 'x', name: 'Twin', role: 'member', fate: 'leave', otherMembers: 1,
        others: [member('x', 'wrong', 'owner', 'wrong@shop.test')] },
      { orgId: 'y', name: 'Twin', role: 'owner', fate: 'leave', otherMembers: 1,
        others: [member('y', 'right', 'admin', 'right@shop.test')] },
    ]));
    deleteAccount.mockResolvedValue({ ok: false, code: 'last_owner', detail: 'Twin', orgId: 'y' });
    render();
    await flush();
    type(input(), 'DELETE');
    click(deleteButton());
    await flush();
    const alert = one(document.body, '[data-code="last_owner"]');
    expect(alert.textContent).toContain('right@shop.test');
    expect(alert.textContent).not.toContain('wrong@shop.test');
  });

  it('says so when the function is not deployed', async () => {
    fetchPlan.mockResolvedValue(plan([]));
    deleteAccount.mockResolvedValue({ ok: false, code: 'unavailable' });
    render();
    await flush();
    type(input(), 'DELETE');
    click(deleteButton());
    await flush();
    expect(document.body.textContent).toContain('not switched on yet');
  });

  it('a founding admin is told to change their role first', async () => {
    fetchPlan.mockResolvedValue(plan([{ orgId: 'f', name: 'Founding Workspace', role: 'admin', fate: 'founding_admin', otherMembers: null }]));
    render();
    await flush();
    const alert = one(document.body, '[role="alert"]');
    expect(alert.getAttribute('data-code')).toBe('founding_admin');
    expect(alert.textContent).toContain('founding admin of Founding Workspace');
  });
});
