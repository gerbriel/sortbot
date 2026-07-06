import { supabase } from './supabase';
import type { User } from '@supabase/supabase-js';
import { log } from './debugLogger';
import { initializeDefaultCategories } from './categoriesService';
import { getMyBetaSignup } from './betaService';

/**
 * orgService — multi-org tenancy bootstrap and workspace management.
 *
 * Designed to be FORWARD-COMPATIBLE: if the tenancy migration
 * (supabase/migrations/multi_org_tenancy.sql) has NOT been run yet, every
 * function here fails soft and `ensureOrganization` returns { mode: 'legacy' },
 * in which case the app behaves exactly as the pre-tenancy shared workspace.
 * Deploying this code before running the migration is safe.
 */

export interface Organization {
  id: string;
  name: string;
  slug?: string | null;
  plan?: string;
  created_at?: string;
}

export type OrgRole = 'owner' | 'admin' | 'member';

export interface OrgMemberRow {
  org_id: string;
  user_id: string;
  role: OrgRole;
  email: string | null;
  created_at: string;
}

export interface OrgInviteRow {
  id: string;
  org_id: string;
  email: string;
  role: OrgRole;
  created_at: string;
  accepted_at: string | null;
}

export type OrgBootstrapResult =
  | { mode: 'org'; org: Organization; role: OrgRole }
  | { mode: 'legacy' } // tenancy migration not applied — shared-workspace behavior
  // Private beta gate: signed in, no workspace, and their beta request is
  // not (yet) approved. The app shows the waitlist screen instead of the
  // dashboard. Never applies to existing members or invited teammates.
  | { mode: 'waitlist'; betaStatus: 'none' | 'pending' | 'denied' };

/**
 * Resolve the signed-in user's workspace, in order:
 *   1. Existing membership → use it (existing users land in the Founding
 *      Workspace they were backfilled into — nothing changes for them).
 *   2. Pending invite for their email → accept it and join that org.
 *   3. An org they created earlier whose membership insert failed → self-repair.
 *   4. Otherwise → create a fresh personal workspace (isolated, empty) and
 *      seed the default categories.
 * Any unexpected error → { mode: 'legacy' } so tenancy can never brick the app.
 */
// Dedupe concurrent calls (React StrictMode double-invokes effects in dev;
// two racing bootstraps could otherwise create two personal workspaces).
let inFlight: Promise<OrgBootstrapResult> | null = null;

export function ensureOrganization(user: User): Promise<OrgBootstrapResult> {
  if (!inFlight) {
    inFlight = ensureOrganizationInner(user).finally(() => { inFlight = null; });
  }
  return inFlight;
}

async function ensureOrganizationInner(user: User): Promise<OrgBootstrapResult> {
  try {
    // 1. Existing membership (oldest first — founding org wins over later ones)
    const { data: memberships, error: memErr } = await supabase
      .from('org_members')
      .select('org_id, role, created_at, organizations ( id, name, slug, plan, created_at )')
      .eq('user_id', user.id)
      .order('created_at', { ascending: true })
      .limit(1);
    if (memErr) {
      // Table missing (migration not run) or any other failure → legacy mode.
      log.auth(`ensureOrganization | legacy mode (${memErr.code ?? ''} ${memErr.message})`);
      return { mode: 'legacy' };
    }
    if (memberships && memberships.length > 0) {
      const m = memberships[0] as unknown as { role: OrgRole; organizations: Organization | Organization[] | null };
      const org = Array.isArray(m.organizations) ? m.organizations[0] : m.organizations;
      if (org) {
        log.auth(`ensureOrganization | member of "${org.name}" as ${m.role}`);
        return { mode: 'org', org, role: m.role };
      }
    }

    // 2. Pending invite for my email? (RLS only shows invites addressed to me)
    const { data: invites } = await supabase
      .from('org_invites')
      .select('id, org_id, role')
      .is('accepted_at', null)
      .order('created_at', { ascending: false })
      .limit(1);
    if (invites && invites.length > 0) {
      const inv = invites[0] as { id: string; org_id: string; role: OrgRole };
      const { error: joinErr } = await supabase.from('org_members').insert({
        org_id: inv.org_id,
        user_id: user.id,
        role: inv.role,
        email: user.email ?? null,
      });
      if (!joinErr) {
        await supabase.from('org_invites')
          .update({ accepted_at: new Date().toISOString() })
          .eq('id', inv.id);
        const { data: org } = await supabase
          .from('organizations').select('*').eq('id', inv.org_id).maybeSingle();
        if (org) {
          log.auth(`ensureOrganization | joined "${(org as Organization).name}" via invite as ${inv.role}`);
          return { mode: 'org', org: org as Organization, role: inv.role };
        }
      } else {
        log.error(`ensureOrganization | invite join failed: ${joinErr.message}`);
      }
    }

    // 3. Self-repair: an org I created before whose membership insert failed
    //    (prevents orphan-org accumulation on retry).
    const { data: myOrgs } = await supabase
      .from('organizations')
      .select('*')
      .order('created_at', { ascending: true })
      .limit(1);
    if (myOrgs && myOrgs.length > 0) {
      const org = myOrgs[0] as Organization;
      const { error: repairErr } = await supabase.from('org_members').insert({
        org_id: org.id, user_id: user.id, role: 'owner', email: user.email ?? null,
      });
      if (!repairErr) {
        log.auth(`ensureOrganization | repaired membership in "${org.name}"`);
        return { mode: 'org', org, role: 'owner' };
      }
    }

    // 4. Beta gate — brand-new users only get a workspace once a Founding
    //    Workspace admin approves their beta request. If the beta_signups
    //    migration hasn't been run ('unavailable'), skip the gate entirely
    //    (pre-beta behavior). Members and invitees never reach this point.
    const beta = await getMyBetaSignup();
    if (beta.status === 'none' || beta.status === 'pending' || beta.status === 'denied') {
      log.auth(`ensureOrganization | waitlist (betaStatus=${beta.status})`);
      return { mode: 'waitlist', betaStatus: beta.status };
    }

    // 5. Approved (or gate unavailable) → fresh workspace. Approved beta shops
    //    get their requested shop name and plan='beta' — the future billing
    //    migration targets these rows precisely (WHERE plan='beta').
    const name = beta.status === 'approved' && beta.row?.org_name
      ? beta.row.org_name
      : `${(user.email || 'My').split('@')[0]}'s workspace`;
    const { data: org, error: orgErr } = await supabase
      .from('organizations')
      .insert(beta.status === 'approved' ? { name, plan: 'beta' } : { name })
      .select().single();
    if (orgErr || !org) {
      log.error(`ensureOrganization | org create failed: ${orgErr?.message}`);
      return { mode: 'legacy' };
    }
    const { error: ownErr } = await supabase.from('org_members').insert({
      org_id: (org as Organization).id, user_id: user.id, role: 'owner', email: user.email ?? null,
    });
    if (ownErr) {
      // Step 3 will repair this on the next sign-in.
      log.error(`ensureOrganization | owner membership failed: ${ownErr.message}`);
      return { mode: 'legacy' };
    }
    // Seed default categories so Step 2 isn't empty in a brand-new workspace.
    try { await initializeDefaultCategories(); } catch { /* best-effort */ }
    log.auth(`ensureOrganization | created personal workspace "${name}"`);
    return { mode: 'org', org: org as Organization, role: 'owner' };
  } catch (err) {
    log.error(`ensureOrganization | unexpected: ${String(err)}`);
    return { mode: 'legacy' };
  }
}

export async function fetchOrgMembers(orgId: string): Promise<OrgMemberRow[]> {
  const { data, error } = await supabase
    .from('org_members')
    .select('org_id, user_id, role, email, created_at')
    .eq('org_id', orgId)
    .order('created_at', { ascending: true });
  if (error) { log.error(`fetchOrgMembers | ${error.message}`); return []; }
  return (data ?? []) as OrgMemberRow[];
}

export async function fetchOrgInvites(orgId: string): Promise<OrgInviteRow[]> {
  const { data, error } = await supabase
    .from('org_invites')
    .select('id, org_id, email, role, created_at, accepted_at')
    .eq('org_id', orgId)
    .is('accepted_at', null)
    .order('created_at', { ascending: false });
  if (error) { log.error(`fetchOrgInvites | ${error.message}`); return []; }
  return (data ?? []) as OrgInviteRow[];
}

/** Invite an email to the org. They join automatically on their next sign-in
 *  (or first sign-up) with the given role. Admin/owner only (enforced by RLS). */
export async function inviteToOrg(orgId: string, email: string, role: OrgRole = 'member'): Promise<{ ok: boolean; error?: string }> {
  const cleaned = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleaned)) return { ok: false, error: 'Enter a valid email address.' };
  const { error } = await supabase.from('org_invites').insert({ org_id: orgId, email: cleaned, role });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function revokeInvite(inviteId: string): Promise<boolean> {
  const { error } = await supabase.from('org_invites').delete().eq('id', inviteId);
  if (error) { log.error(`revokeInvite | ${error.message}`); return false; }
  return true;
}

/** Remove a member from the org (admin/owner only, enforced by RLS).
 *  Also used to leave a workspace — the delete policy allows self-removal. */
export async function removeMember(orgId: string, userId: string): Promise<boolean> {
  const { error } = await supabase
    .from('org_members').delete().eq('org_id', orgId).eq('user_id', userId);
  if (error) { log.error(`removeMember | ${error.message}`); return false; }
  return true;
}

/** Rename the workspace (admin/owner only, enforced by RLS). The `.select()`
 *  check catches RLS-blocked updates, which return 0 rows without an error. */
export async function renameOrganization(orgId: string, name: string): Promise<{ ok: boolean; error?: string }> {
  const cleaned = name.trim();
  if (!cleaned) return { ok: false, error: 'Name cannot be empty.' };
  if (cleaned.length > 60) return { ok: false, error: 'Keep the name under 60 characters.' };
  const { data, error } = await supabase
    .from('organizations').update({ name: cleaned }).eq('id', orgId).select('id');
  if (error) { log.error(`renameOrganization | ${error.message}`); return { ok: false, error: error.message }; }
  if (!data || data.length === 0) return { ok: false, error: 'You do not have permission to rename this workspace.' };
  return { ok: true };
}

/** Change a member's role (admin/owner only, enforced by RLS). The caller is
 *  responsible for the last-owner guard — the DB happily allows zero owners. */
export async function updateMemberRole(orgId: string, userId: string, role: OrgRole): Promise<boolean> {
  const { data, error } = await supabase
    .from('org_members')
    .update({ role })
    .eq('org_id', orgId).eq('user_id', userId)
    .select('user_id');
  if (error) { log.error(`updateMemberRole | ${error.message}`); return false; }
  return !!data && data.length > 0;
}
