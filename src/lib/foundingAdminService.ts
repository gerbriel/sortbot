import { supabase } from './supabase';
import { log } from './debugLogger';
import type { OrgRole } from './orgService';

/**
 * foundingAdminService — cross-workspace user management for Founding
 * Workspace admins, backed by the SECURITY DEFINER functions in
 * supabase/migrations/founding_user_admin.sql.
 *
 * WHY RPCs AND NOT TABLE WRITES: org_members RLS is scoped to workspaces the
 * caller belongs to (is_org_admin), so a founding admin cannot see or write a
 * tenant workspace's memberships directly. The functions gate on
 * is_beta_admin(), enforce the "founding workspace always has an admin" rail,
 * and write an audit row for every change.
 *
 * MEMBERSHIPS MOVE, DATA DOES NOT. Batches/products/images keep their org_id —
 * in this schema data belongs to the WORKSPACE, not to whoever created it.
 * Moving someone out leaves that workspace's work intact and is reversible.
 *
 * FORWARD-COMPATIBLE: if the migration hasn't been run, reads return [] and
 * the UI hides the section entirely (same contract as fetchBetaOrgDirectory).
 */

export interface FoundingMembership {
  org_id: string;
  org_name: string;
  org_slug: string | null;
  role: OrgRole;
  joined_at: string;
}

export interface FoundingUserRow {
  user_id: string;
  email: string | null;
  created_at: string;
  last_sign_in_at: string | null;
  /** Empty for waitlisted signups and users removed from every workspace. */
  memberships: FoundingMembership[];
}

export interface FoundingAuditRow {
  id: string;
  actor_email: string | null;
  action: 'add_member' | 'set_role' | 'remove_member' | 'move_user';
  target_email: string | null;
  from_org_name: string | null;
  to_org_name: string | null;
  role: string | null;
  created_at: string;
}

type Result = { ok: boolean; error?: string };

/** Every user and the workspaces they belong to. Non-admins and pre-migration
 *  environments get an empty array, which hides the Users tab. */
export async function fetchAllUsers(): Promise<FoundingUserRow[]> {
  try {
    const { data, error } = await supabase.rpc('founding_list_users');
    if (error) {
      log.db(`founding_list_users unavailable (${error.code ?? ''} ${error.message})`);
      return [];
    }
    return (data ?? []) as FoundingUserRow[];
  } catch {
    return [];
  }
}

/** Add a user to a workspace, or change the role they already have there. */
export async function setMembership(userId: string, orgId: string, role: OrgRole): Promise<Result> {
  const { error } = await supabase.rpc('founding_set_membership', {
    p_user: userId, p_org: orgId, p_role: role,
  });
  if (error) { log.error(`setMembership | ${error.message}`); return { ok: false, error: error.message }; }
  return { ok: true };
}

/** Remove a user from a workspace. Their work stays with the workspace. */
export async function removeMembership(userId: string, orgId: string): Promise<Result> {
  const { error } = await supabase.rpc('founding_remove_membership', {
    p_user: userId, p_org: orgId,
  });
  if (error) { log.error(`removeMembership | ${error.message}`); return { ok: false, error: error.message }; }
  return { ok: true };
}

/** Move a user between workspaces. Membership only — no data is re-tagged.
 *  Omit `role` to keep the role they had in the old workspace. */
export async function moveUser(
  userId: string, fromOrgId: string, toOrgId: string, role?: OrgRole,
): Promise<Result> {
  const { error } = await supabase.rpc('founding_move_user', {
    p_user: userId, p_from_org: fromOrgId, p_to_org: toOrgId, p_role: role ?? null,
  });
  if (error) { log.error(`moveUser | ${error.message}`); return { ok: false, error: error.message }; }
  return { ok: true };
}

/** Recent cross-workspace admin actions, newest first. */
export async function fetchFoundingAudit(limit = 50): Promise<FoundingAuditRow[]> {
  try {
    const { data, error } = await supabase
      .from('founding_admin_audit')
      .select('id, actor_email, action, target_email, from_org_name, to_org_name, role, created_at')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) {
      log.db(`founding_admin_audit unavailable (${error.code ?? ''} ${error.message})`);
      return [];
    }
    return (data ?? []) as FoundingAuditRow[];
  } catch {
    return [];
  }
}
