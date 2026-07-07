import { supabase } from './supabase';
import { log } from './debugLogger';

/**
 * betaService — the private-beta waitlist.
 *
 * Public form (beta.html) inserts pending rows; Founding Workspace admins
 * approve/deny from the Workspace panel; ensureOrganization consults
 * getMyBetaSignup before creating a workspace for a brand-new user.
 *
 * FORWARD-COMPATIBLE: if the beta_signups migration hasn't been run, every
 * function fails soft and reports 'unavailable' — the app then behaves as
 * before the beta gate existed (new users get a workspace immediately).
 */

export type BetaStatus = 'none' | 'pending' | 'approved' | 'denied' | 'unavailable';

export interface BetaSignupRow {
  id: string;
  org_name: string;
  contact_name: string;
  email: string;
  store_url: string | null;
  volume: string | null;
  notes: string | null;
  status: 'pending' | 'approved' | 'denied';
  created_at: string;
  reviewed_at: string | null;
}

/** The signed-in user's own beta request (RLS restricts to own row). */
export async function getMyBetaSignup(): Promise<{ status: BetaStatus; row?: BetaSignupRow }> {
  try {
    const { data, error } = await supabase
      .from('beta_signups')
      .select('*')
      .limit(1);
    if (error) {
      // Table missing (migration not run) or any other failure → gate disabled.
      log.auth(`getMyBetaSignup | unavailable (${error.code ?? ''} ${error.message})`);
      return { status: 'unavailable' };
    }
    if (!data || data.length === 0) return { status: 'none' };
    const row = data[0] as BetaSignupRow;
    return { status: row.status, row };
  } catch (err) {
    log.error(`getMyBetaSignup | unexpected: ${String(err)}`);
    return { status: 'unavailable' };
  }
}

/** Submit a beta request (used by the in-app waitlist screen; the landing page
 *  has its own inline handler). */
export async function requestBetaAccess(fields: {
  org_name: string;
  contact_name: string;
  email: string;
  store_url?: string;
  volume?: string;
  notes?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from('beta_signups').insert({
    org_name: fields.org_name.trim(),
    contact_name: fields.contact_name.trim(),
    email: fields.email.trim().toLowerCase(),
    store_url: fields.store_url?.trim() || null,
    volume: fields.volume?.trim() || null,
    notes: fields.notes?.trim() || null,
  });
  if (!error) return { ok: true };
  if (error.code === '23505') return { ok: true }; // already on the list — same outcome
  return { ok: false, error: error.message };
}

/** All requests, newest first — Founding Workspace admins only (RLS). */
export async function fetchBetaSignups(): Promise<BetaSignupRow[]> {
  const { data, error } = await supabase
    .from('beta_signups')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) { log.error(`fetchBetaSignups | ${error.message}`); return []; }
  return (data ?? []) as BetaSignupRow[];
}

/** Approve, deny, or reopen (back to pending) a request — Founding Workspace
 *  admins only (RLS). Reopening clears the review stamp. Note: reopening an
 *  approved request does NOT remove a workspace that was already created on
 *  their first sign-in — the gate only applies to users without one. */
export async function setBetaStatus(id: string, status: 'approved' | 'denied' | 'pending'): Promise<boolean> {
  const { data: { user } } = await supabase.auth.getUser();
  const patch = status === 'pending'
    ? { status, reviewed_by: null, reviewed_at: null }
    : { status, reviewed_by: user?.id ?? null, reviewed_at: new Date().toISOString() };
  const { data, error } = await supabase
    .from('beta_signups')
    .update(patch)
    .eq('id', id)
    .select('id');
  if (error) { log.error(`setBetaStatus | ${error.message}`); return false; }
  return !!data && data.length > 0; // RLS-blocked updates return 0 rows, no error
}

/** Permanently delete a request (spam, duplicates) — Founding admins only (RLS). */
export async function deleteBetaSignup(id: string): Promise<boolean> {
  const { error } = await supabase.from('beta_signups').delete().eq('id', id);
  if (error) { log.error(`deleteBetaSignup | ${error.message}`); return false; }
  return true;
}

// ── Beta workspaces directory (Founding admins) ─────────────────────────────

export interface BetaOrgDirectoryRow {
  org_id: string;
  name: string;
  slug: string | null;
  plan: string | null;
  created_at: string;
  member_count: number;
  member_emails: string[];
  batch_count: number;
  product_count: number;
  image_count: number;
  last_active: string | null;
}

/** Aggregate stats for EVERY workspace (counts + member emails only — never
 *  tenant data). Backed by the beta_org_directory() SECURITY DEFINER function;
 *  non-admins and pre-migration environments get an empty array, which hides
 *  the directory section entirely. */
export async function fetchBetaOrgDirectory(): Promise<BetaOrgDirectoryRow[]> {
  try {
    const { data, error } = await supabase.rpc('beta_org_directory');
    if (error) {
      log.db(`beta_org_directory unavailable (${error.code ?? ''} ${error.message})`);
      return [];
    }
    return (data ?? []) as BetaOrgDirectoryRow[];
  } catch {
    return [];
  }
}
