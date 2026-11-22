import { supabase } from './supabase';
import { log } from './debugLogger';
import { fetchMyMemberships, fetchOrgMembers } from './orgService';
import { WORKFLOW_BACKUP_KEY } from './workflowBackup';
import type { MyMembership, OrgMemberRow, OrgRole } from './orgService';

/**
 * accountService: in-app account deletion (App Store Review Guideline
 * 5.1.1(v)).
 *
 * The client never deletes anything itself. `deleteMyAccount` calls the
 * `delete-account` Edge Function, which proves the caller, runs
 * `delete_account_data` (supabase/migrations/066_account_deletion.sql) in one
 * transaction, removes the caller's storage prefixes and deletes the auth user.
 *
 * `planAccountDeletion` is a PREVIEW of that function's rules for the dialog,
 * computed from rows the caller can already read. The server decides; the
 * preview only explains. Keep the two in step (AGENTS.md section 7,
 * "Account deletion").
 */

/** 'blocked' = the database holds a row it cannot clear (the function's 500
 *  with code 'blocked'); a founder has to look. */
export type DeleteAccountErrorCode = 'last_owner' | 'founding_admin' | 'blocked' | 'unavailable' | 'failed';

export type DeleteAccountResult =
  | { ok: true }
  | { ok: false; code: DeleteAccountErrorCode; detail?: string; orgId?: string };

/** The exact body the function requires. */
export const DELETE_CONFIRMATION = 'DELETE';

interface HttpLikeError {
  name?: string;
  message?: string;
  context?: { status?: number; json?: () => Promise<unknown> };
}

type ErrorBody = { code?: unknown; detail?: unknown; orgId?: unknown };

async function readErrorBody(err: HttpLikeError): Promise<ErrorBody | null> {
  try {
    const body = await err.context?.json?.();
    return body && typeof body === 'object' ? (body as ErrorBody) : null;
  } catch {
    return null;
  }
}

/** Delete the signed-in user's account. Signs out locally on success. */
export async function deleteMyAccount(): Promise<DeleteAccountResult> {
  try {
    const { data, error } = await supabase.functions.invoke('delete-account', {
      body: { confirm: DELETE_CONFIRMATION },
    });
    if (error) {
      const err = error as HttpLikeError;
      const status = err.context?.status;
      if (status === 404) return { ok: false, code: 'unavailable' };
      if (status === 409) {
        const body = await readErrorBody(err);
        const code = body?.code;
        if (code === 'last_owner' || code === 'founding_admin') {
          const detail = typeof body?.detail === 'string' && body.detail ? body.detail : undefined;
          const orgId = typeof body?.orgId === 'string' && body.orgId ? body.orgId : undefined;
          return orgId ? { ok: false, code, detail, orgId } : { ok: false, code, detail };
        }
      }
      if (status === 500) {
        const body = await readErrorBody(err);
        if (body?.code === 'blocked') return { ok: false, code: 'blocked' };
      }
      log.error(`deleteMyAccount | ${err.name ?? 'error'} ${status ?? ''}`);
      return { ok: false, code: 'failed' };
    }
    if (!data || (data as { ok?: unknown }).ok !== true) return { ok: false, code: 'failed' };
  } catch (err) {
    log.error(`deleteMyAccount | unexpected: ${String(err)}`);
    return { ok: false, code: 'failed' };
  }
  // The auth user is gone. 'local' clears this device's session without asking
  // the server to revoke a session that no longer exists.
  try {
    await supabase.auth.signOut({ scope: 'local' });
  } catch (err) {
    log.error(`deleteMyAccount | signOut: ${String(err)}`);
  }
  clearDeletedAccountStorage();
  return { ok: true };
}

/** localStorage keys that belong to the account, not to the device (AGENTS.md
 *  section 1): the crash backup, the open batch, the delete tombstones and every
 *  per-workspace onboarding record. Device preferences (debug, magnifier,
 *  kanban view, card labels, the compressed-paths set) stay. */
export const ACCOUNT_STORAGE_KEYS = [
  WORKFLOW_BACKUP_KEY,
  'sortbot_current_batch_id',
  'sortbot_current_batch_number',
  'sortbot_deleted_batch_ids',
];
const ONBOARDING_PREFIX = 'sortbot_onboarding_';

export function clearDeletedAccountStorage(): void {
  try {
    for (const k of ACCOUNT_STORAGE_KEYS) localStorage.removeItem(k);
    const onboarding: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(ONBOARDING_PREFIX)) onboarding.push(k);
    }
    onboarding.forEach(k => localStorage.removeItem(k));
  } catch (err) {
    log.error(`clearDeletedAccountStorage | ${String(err)}`);
  }
}

/* ── The per-workspace preview ──────────────────────────────────────────── */

/** What happens to one workspace. Mirrors section 1 of delete_account_data. */
export type WorkspaceFate = 'delete' | 'leave' | 'last_owner' | 'founding_admin' | 'unknown';

export interface WorkspacePlanRow {
  orgId: string;
  name: string;
  role: OrgRole;
  fate: WorkspaceFate;
  /** Members other than me; null when the member list could not be read. */
  otherMembers: number | null;
  /** The other members themselves, so a last_owner block can be resolved in
   *  place ("Make owner"). Empty when unread. */
  others: OrgMemberRow[];
}

export interface AccountDeletionPlan {
  rows: WorkspacePlanRow[];
  /** True when any row refuses the deletion. */
  blocked: boolean;
}

/** Pure: apply the server's rules to what the caller can see. A member list
 *  that does not contain me is treated as unread (fetchOrgMembers returns []
 *  on an error), so a failed read can never preview as "deleted". */
export function planAccountDeletion(
  userId: string,
  memberships: MyMembership[],
  membersByOrg: Record<string, OrgMemberRow[] | undefined>,
): AccountDeletionPlan {
  const rows = memberships.map((m): WorkspacePlanRow => {
    const base = { orgId: m.org_id, name: m.name, role: m.role };
    if (m.slug === 'founding' && (m.role === 'owner' || m.role === 'admin')) {
      return { ...base, fate: 'founding_admin', otherMembers: null, others: [] };
    }
    const members = membersByOrg[m.org_id];
    if (!members || !members.some(x => x.user_id === userId)) {
      return { ...base, fate: 'unknown', otherMembers: null, others: [] };
    }
    const others = members.filter(x => x.user_id !== userId);
    if (others.length === 0) {
      return { ...base, fate: m.slug === 'founding' ? 'founding_admin' : 'delete', otherMembers: 0, others };
    }
    if (m.role === 'owner' && !others.some(x => x.role === 'owner')) {
      return { ...base, fate: 'last_owner', otherMembers: others.length, others };
    }
    return { ...base, fate: 'leave', otherMembers: others.length, others };
  });
  return { rows, blocked: rows.some(r => r.fate === 'last_owner' || r.fate === 'founding_admin') };
}

/** Read my memberships and each workspace's members, then plan. `null` when
 *  the memberships themselves could not be read. */
export async function fetchAccountDeletionPlan(userId: string): Promise<AccountDeletionPlan | null> {
  const memberships = await fetchMyMemberships(userId);
  if (!memberships) return null;
  const lists = await Promise.all(memberships.map(m => fetchOrgMembers(m.org_id)));
  const byOrg: Record<string, OrgMemberRow[]> = {};
  memberships.forEach((m, i) => { byOrg[m.org_id] = lists[i]; });
  return planAccountDeletion(userId, memberships, byOrg);
}
