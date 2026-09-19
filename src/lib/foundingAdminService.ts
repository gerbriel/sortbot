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
  /** The four membership verbs from founding_user_admin.sql, plus the four
 *  workspace verbs from founder_console.sql. `founding_admin_audit.action`
 *  is plain text with no CHECK, so a row written by a newer migration than
 *  this build still renders — auditSummary falls through to the raw verb. */
  action:
    | 'add_member' | 'set_role' | 'remove_member' | 'move_user'
    | 'create_workspace' | 'set_plan' | 'rename_org' | 'invite_member'
    | (string & {});
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

/* ════════════════════════════════════════════════════════════════════════════
   FOUNDER CONSOLE — workspace lifecycle (supabase/migrations/founder_console.sql)

   Same shape and the same reason as everything above: a founding admin is not a
   member of a tenant workspace, so `organizations` and `org_invites` RLS
   (is_org_admin(org_id)) hides those rows from them completely. Creating a
   workspace, moving it between plans, renaming it, inviting into it and reading
   its roster are therefore RPCs, gated on is_beta_admin() and audited.

   THREE FAILURES ARE DISTINGUISHED, because the UI does something different
   with each: 'forbidden' (42501 — not a founding admin) is a permission
   message, 'unavailable' (the function is not installed) is a setup hint naming
   the migration, and 'error' is the database's own sentence, which these
   functions deliberately write in plain English ("There is already an invite
   for that address in this workspace.") so it can be shown as-is.
   ════════════════════════════════════════════════════════════════════════════ */

/** The plans `finance_plan_prices` is seeded with — MIRRORS
 *  app_private.org_plan_list() in founder_console.sql. A plan outside this list
 *  prices at nothing and silently drops out of projected MRR, which is why both
 *  sides reject one. Change this and change the SQL in the same commit. */
export const ORG_PLANS = [
  'free', 'beta', 'starter', 'basic', 'growth',
  'pro', 'business', 'scale', 'enterprise',
] as const;

export type OrgPlan = (typeof ORG_PLANS)[number];

export function isOrgPlan(value: string | null | undefined): value is OrgPlan {
  return !!value && (ORG_PLANS as readonly string[]).includes(value);
}

export type FounderFailure = 'forbidden' | 'unavailable' | 'error';

export interface FounderWriteResult {
  ok: boolean;
  /** The row the function returned — an org id, or an invite id. */
  id?: string;
  reason?: FounderFailure;
  error?: string;
}

export interface OrgDetailMember {
  user_id: string;
  email: string | null;
  role: OrgRole;
  created_at: string;
}

export interface OrgDetailInvite {
  id: string;
  email: string;
  role: OrgRole;
  created_at: string;
}

export interface OrgDetail {
  org: { id: string; name: string; slug: string | null; plan: string | null; created_at: string };
  members: OrgDetailMember[];
  invites: OrgDetailInvite[];
  counts: { batches: number; products: number; images: number };
  last_active: string | null;
  /** Enabled marketplace keys. Always [] when marketplaces.sql has not run. */
  marketplaces: string[];
}

export type OrgDetailResult =
  | { status: 'ok'; detail: OrgDetail }
  | { status: FounderFailure; error?: string };

/** PostgREST reports a missing function as 42883 (Postgres) or PGRST202 (its
 *  own "no function matches" schema-cache answer). Either one means the
 *  migration has not been run — never that the caller did something wrong. */
function classify(error: { code?: string; message: string }): FounderFailure {
  if (error.code === '42501') return 'forbidden';
  if (error.code === '42883' || error.code === 'PGRST202' || error.code === 'PGRST302') return 'unavailable';
  return 'error';
}

const FAILURE_TEXT: Record<FounderFailure, string> = {
  forbidden: 'Founding Workspace admins only.',
  unavailable: 'Run supabase/migrations/founder_console.sql to turn this on.',
  error: '',
};

function failure(error: { code?: string; message: string }, what: string): FounderWriteResult {
  const reason = classify(error);
  log.error(`${what} | ${error.code ?? ''} ${error.message}`);
  return { ok: false, reason, error: FAILURE_TEXT[reason] || error.message };
}

/**
 * Create a workspace and attach its owner.
 *
 * If `ownerEmail` already has an account they are made OWNER outright. If it
 * does not, they get an ADMIN invite and join on their first sign-in — an
 * invite may never mint an owner (security_invites_hardening.sql), so the
 * founder promotes them afterwards. Categories and presets are NOT seeded here:
 * orgService seeds an empty workspace on that first sign-in, so the default
 * list keeps exactly one home (src/lib/categories.ts).
 */
export async function createWorkspace(fields: {
  name: string; plan: OrgPlan; ownerEmail: string;
}): Promise<FounderWriteResult> {
  const { data, error } = await supabase.rpc('founding_create_workspace', {
    p_name: fields.name.trim(),
    p_plan: fields.plan,
    p_owner_email: fields.ownerEmail.trim().toLowerCase(),
  });
  if (error) return failure(error, 'createWorkspace');
  return { ok: true, id: (data as string | null) ?? undefined };
}

/** Move a workspace onto another plan. Rejected server-side if it is not one of
 *  ORG_PLANS, so a stale client cannot write a plan the books cannot price. */
export async function setOrgPlan(orgId: string, plan: OrgPlan): Promise<FounderWriteResult> {
  const { error } = await supabase.rpc('founding_set_org_plan', { p_org: orgId, p_plan: plan });
  if (error) return failure(error, 'setOrgPlan');
  return { ok: true };
}

/** Rename any workspace. `renameOrganization` in orgService does the same thing
 *  for the workspace you are IN; this one reaches the ones you are not. */
export async function renameOrg(orgId: string, name: string): Promise<FounderWriteResult> {
  const { error } = await supabase.rpc('founding_rename_org', { p_org: orgId, p_name: name.trim() });
  if (error) return failure(error, 'renameOrg');
  return { ok: true };
}

/** Invite an email into any workspace. member/admin only — see createWorkspace. */
export async function inviteMember(
  orgId: string, email: string, role: 'member' | 'admin',
): Promise<FounderWriteResult> {
  const { data, error } = await supabase.rpc('founding_invite_member', {
    p_org: orgId, p_email: email.trim().toLowerCase(), p_role: role,
  });
  if (error) return failure(error, 'inviteMember');
  return { ok: true, id: (data as string | null) ?? undefined };
}

/** One workspace's roster, open invites, counts and enabled marketplaces.
 *  Aggregates and membership only — the same boundary beta_org_directory drew,
 *  so no batch, product or image row ever crosses it. */
export async function fetchOrgDetail(orgId: string): Promise<OrgDetailResult> {
  try {
    const { data, error } = await supabase.rpc('founding_org_detail', { p_org: orgId });
    if (error) {
      const reason = classify(error);
      log.db(`founding_org_detail | ${error.code ?? ''} ${error.message}`);
      return { status: reason, error: FAILURE_TEXT[reason] || error.message };
    }
    if (!data) return { status: 'error', error: 'That workspace returned nothing.' };
    const raw = data as Partial<OrgDetail>;
    return {
      status: 'ok',
      detail: {
        org: raw.org as OrgDetail['org'],
        members: raw.members ?? [],
        invites: raw.invites ?? [],
        counts: raw.counts ?? { batches: 0, products: 0, images: 0 },
        last_active: raw.last_active ?? null,
        marketplaces: raw.marketplaces ?? [],
      },
    };
  } catch (err) {
    return { status: 'error', error: String(err) };
  }
}
