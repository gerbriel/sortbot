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

/**
 * THE FALLBACK / SEED LIST — not the set of plans.
 *
 * Plans are DATA now: `finance_plan_prices` is the catalog, `founding_plan_directory`
 * reads it, and `app_private.org_plan_list()` (which is what actually gates a write)
 * reads the same table. These nine are only what the table is SEEDED with, and
 * therefore what a plan dropdown shows in the one situation where the catalog cannot
 * be read — before `plan_management.sql` has been run, or if the directory read fails.
 *
 * DO NOT use this list to decide what the user may pick. The server is the gate; a
 * client-side membership test here is exactly what made a tier added in Finance →
 * Customers impossible to assign to anybody.
 */
export const ORG_PLANS = [
  'free', 'beta', 'starter', 'basic', 'growth',
  'pro', 'business', 'scale', 'enterprise',
] as const;

/** A plan key. Deliberately open: it is whatever string is in the catalog, and
 *  `organizations.plan` is plain text. It was a closed union while the list was
 *  hardcoded in two hand-synced places; closing it again would re-create that. */
export type OrgPlan = string;

/** `free` and `beta` cannot be renamed or deleted, and both halves of the app
 *  need to say so: `organizations.plan` DEFAULTs to `'free'`, the waitlist
 *  approval path and this console's new-workspace default write `'beta'`, and
 *  `finance_summary`'s founding-discount test reads the literal `'beta'`.
 *  The server refuses either way — this is what lets the UI explain WHY before
 *  the click rather than after it. */
export const PROTECTED_PLANS: readonly string[] = ['free', 'beta'];

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

/** `unavailableText` is a parameter because two migrations install the RPCs on
 *  this page independently — a founder whose founder_console.sql is fine still
 *  has to be told which OTHER file to run. Omitted, the behaviour is unchanged. */
function failure(
  error: { code?: string; message: string },
  what: string,
  unavailableText: string = FAILURE_TEXT.unavailable,
): FounderWriteResult {
  const reason = classify(error);
  log.error(`${what} | ${error.code ?? ''} ${error.message}`);
  const text = reason === 'unavailable' ? unavailableText : FAILURE_TEXT[reason];
  return { ok: false, reason, error: text || error.message };
}

/** The same three-way classification for a READ, which reports a status rather
 *  than an ok/error pair. `log.db` rather than `log.error`: a read that finds no
 *  function is a setup fact, not a failure of something the user asked for. */
function readFailure(
  error: { code?: string; message: string },
  what: string,
  unavailableText: string = FAILURE_TEXT.unavailable,
): { status: FounderFailure; error: string } {
  const reason = classify(error);
  log.db(`${what} | ${error.code ?? ''} ${error.message}`);
  const text = reason === 'unavailable' ? unavailableText : FAILURE_TEXT[reason];
  return { status: reason, error: text || error.message };
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

/** Move a workspace onto another plan. The plan key is validated server-side
 *  against `app_private.org_plan_list()`, which reads the catalog — so a plan
 *  created through `upsertPlan` (or in Finance → Customers) is assignable
 *  immediately, and a plan the books cannot price is still refused. */
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

/* ════════════════════════════════════════════════════════════════════════════
   PLAN MANAGEMENT — the catalog, and the record of who has been on what
   (supabase/migrations/plan_management.sql)

   TWO PROBLEMS, ONE FILE.

   1. PLANS WERE A HARDCODED LIST IN TWO HAND-SYNCED PLACES —
      app_private.org_plan_list() and ORG_PLANS above. Finance → Customers has
      always been able to add a row to finance_plan_prices, so a tier could be
      given a price and then never assigned to anybody, silently. The fix is
      that finance_plan_prices IS the catalog: org_plan_list() reads it, so
      founding_set_org_plan and founding_create_workspace inherit data-driven
      plans with no edit to founder_console.sql at all.

   2. "WHO WAS A BETA USER" WAS NOT RECORDED ANYWHERE DURABLE.
      organizations.plan is one mutable column — the moment a beta shop moves to
      pro, the fact is gone. beta_signups has no org_id, founding_admin_audit
      only sees changes made through this console, and `created_at <= cutoff` is
      a lossy proxy. org_plan_history is written by a TRIGGER on organizations,
      which is the one thing that also catches a SQL-Editor edit, and it keeps
      org_id and org_name WITHOUT a foreign key so the record outlives the
      workspace itself.

   Same three-failure contract as everything above; only the `unavailable`
   sentence differs, because it names a different migration.
   ════════════════════════════════════════════════════════════════════════════ */

const PLAN_SETUP_TEXT = 'Run supabase/migrations/plan_management.sql to turn this on.';

/** One row of the catalog, with the two usage counts that decide what may be
 *  done to it. `workspaces` is how many are on it NOW (blocks a delete);
 *  `ever_used` is how many have ever been (does NOT block one — retiring a tier
 *  is fine, and history keeps the name it had at the time). */
export interface PlanRow {
  plan: string;
  display_name: string | null;
  monthly_cents: number;
  note: string | null;
  is_active: boolean;
  sort_order: number;
  workspaces: number;
  ever_used: number;
  /** `free` / `beta` — see PROTECTED_PLANS. */
  protected: boolean;
}

/** One plan change for one workspace. `changed_by_email` is null for a change
 *  made in the SQL Editor, which is a fact worth showing rather than hiding. */
export interface PlanHistoryRow {
  plan: string;
  previous_plan: string | null;
  changed_at: string;
  changed_by_email: string | null;
  /**
   * 'trigger' — a real plan change for this workspace.
   * 'backfill' — the one row per org the migration wrote for state that
   *   predates the trigger.
   * 'rename'  — the cascade from renaming a TIER. Renaming a plan updates
   *   organizations.plan for every workspace on it, which fires the trigger
   *   once per workspace; those rows are recorded rather than suppressed, so a
   *   reader MUST render them as "renamed X → Y" and not as a plan move.
   *
   * Typed `string`, not a union: the column is free text and a newer migration
   * may add a value, which must render rather than crash.
   */
  source: string;
}

/** A workspace that has ever been on a given plan. `exists_now` is false for a
 *  workspace that has since been deleted — the whole point of the table, and
 *  why `org_name` is denormalised rather than joined. */
export interface PlanAlumniRow {
  org_id: string;
  org_name: string | null;
  current_plan: string | null;
  first_on: string;
  last_on: string;
  still_on: boolean;
  created_at: string | null;
  exists_now: boolean;
}

export type PlanDirectoryResult =
  | { status: 'ok'; plans: PlanRow[] }
  | { status: FounderFailure; error?: string };

export type PlanAlumniResult =
  | { status: 'ok'; rows: PlanAlumniRow[] }
  | { status: FounderFailure; error?: string };

/** `renamePlan` answers with the number of workspaces it moved. A separate
 *  field rather than a count smuggled through `error`, which the UI prints. */
export interface PlanRenameResult extends FounderWriteResult {
  moved?: number;
}

/** PostgREST renders a `bigint` (`count(*)`, `monthly_cents`) as a JSON number
 *  today, but it is entitled to hand one back as a string. Two of these feed a
 *  `!==` dirty-check in the plans editor, where `'4900' !== 4900` would leave
 *  every row permanently showing unsaved changes. Coerce once, here. */
function num(value: unknown, fallback = 0): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toPlanRow(raw: Partial<PlanRow>): PlanRow {
  return {
    plan: String(raw.plan ?? ''),
    display_name: raw.display_name ?? null,
    monthly_cents: num(raw.monthly_cents),
    note: raw.note ?? null,
    is_active: raw.is_active !== false,
    sort_order: num(raw.sort_order, 100),
    workspaces: num(raw.workspaces),
    ever_used: num(raw.ever_used),
    protected: raw.protected === true || PROTECTED_PLANS.includes(String(raw.plan ?? '')),
  };
}

/** The plan catalog, already ordered by the server (`sort_order, plan`).
 *
 *  THIS IS WHAT EVERY PLAN DROPDOWN READS. Falling back to ORG_PLANS is the
 *  caller's job and only on `unavailable`, because a catalog that answered
 *  `forbidden` or errored is not evidence about what plans exist. */
export async function fetchPlanDirectory(): Promise<PlanDirectoryResult> {
  try {
    const { data, error } = await supabase.rpc('founding_plan_directory');
    if (error) return readFailure(error, 'founding_plan_directory', PLAN_SETUP_TEXT);
    return { status: 'ok', plans: ((data ?? []) as Partial<PlanRow>[]).map(toPlanRow) };
  } catch (err) {
    return { status: 'error', error: String(err) };
  }
}

/**
 * Create a plan, or change one that exists.
 *
 * THE TWO HALVES OF THIS ARGUMENT LIST BEHAVE DIFFERENTLY, and getting it wrong
 * destroys data silently:
 *
 * - `displayName` and `note` are REPLACED. Sending null CLEARS them. They are
 *   therefore REQUIRED here, nullable rather than optional, so that every call
 *   site has to state what it means — a partial writer that posted only
 *   `{ plan, isActive }` would wipe that tier's label and the note Finance
 *   wrote against it, with nothing failing anywhere.
 * - `monthlyCents` is required for the same reason (it is a REPLACE too).
 * - `isActive` and `sortOrder` are sent as null when omitted, which the
 *   function reads as "column default on insert, leave alone on update".
 *
 * A caller that wants to flip one field reads the row it is editing and sends
 * the whole record back. That is what the Plans tab's one-Save-per-row does.
 *
 * The key is normalised here as well as in SQL for the same reason
 * `createWorkspace` lower-cases the email: the function compares
 * `lower(btrim(p_plan))`, so a client sending ` Pro ` would otherwise look like
 * a create when it is an update.
 */
export async function upsertPlan(fields: {
  plan: string;
  /** REPLACED — null clears it. Required so no caller forgets. */
  displayName: string | null;
  monthlyCents: number;
  /** REPLACED — null clears it. Required so no caller forgets. */
  note: string | null;
  isActive?: boolean;
  sortOrder?: number;
}): Promise<FounderWriteResult> {
  const { error } = await supabase.rpc('founding_upsert_plan', {
    p_plan: fields.plan.trim().toLowerCase(),
    p_display_name: fields.displayName?.trim() || null,
    p_monthly_cents: Math.round(fields.monthlyCents),
    p_note: fields.note?.trim() || null,
    p_is_active: fields.isActive ?? null,
    p_sort_order: fields.sortOrder ?? null,
  });
  if (error) return failure(error, 'upsertPlan', PLAN_SETUP_TEXT);
  return { ok: true };
}

/**
 * Rename a plan, cascading to every workspace on it in one transaction —
 * `finance_plan_prices.plan` and `organizations.plan` move together, which is
 * why this is an RPC and not a table write (the `plan` column is deliberately
 * outside the client's UPDATE grant).
 *
 * The server refuses to rename `free` or `beta`, and refuses a key that already
 * exists. History is NOT rewritten: it records what a plan was called at the
 * time, which is the only version of it that was ever true.
 */
export async function renamePlan(from: string, to: string): Promise<PlanRenameResult> {
  const { data, error } = await supabase.rpc('founding_rename_plan', {
    p_from: from.trim().toLowerCase(),
    p_to: to.trim().toLowerCase(),
  });
  if (error) return failure(error, 'renamePlan', PLAN_SETUP_TEXT);
  return { ok: true, moved: num(data) };
}

/** Delete a plan. Refused server-side when it is protected or any workspace is
 *  on it — in that case the answer is `is_active = false`, which keeps the row
 *  PRICED so historical MRR still joins. */
export async function deletePlan(plan: string): Promise<FounderWriteResult> {
  const { error } = await supabase.rpc('founding_delete_plan', { p_plan: plan.trim().toLowerCase() });
  if (error) return failure(error, 'deletePlan', PLAN_SETUP_TEXT);
  return { ok: true };
}

/** One workspace's plan changes, newest first. `[]` on ANY failure — this is a
 *  detail line inside an already-rendered row, so the surrounding panel decides
 *  what an empty list means (it knows whether the migration has been run). */
export async function fetchOrgPlanHistory(orgId: string): Promise<PlanHistoryRow[]> {
  try {
    const { data, error } = await supabase.rpc('founding_org_plan_history', { p_org: orgId });
    if (error) {
      log.db(`founding_org_plan_history unavailable (${error.code ?? ''} ${error.message})`);
      return [];
    }
    return (data ?? []) as PlanHistoryRow[];
  } catch {
    return [];
  }
}

/** Every workspace that has ever been on `plan`, oldest first — INCLUDING the
 *  ones that no longer exist. This is the question `organizations.plan` can
 *  never answer, and the reason org_plan_history exists. */
export async function fetchPlanAlumni(plan: string = 'beta'): Promise<PlanAlumniResult> {
  try {
    const { data, error } = await supabase.rpc('founding_plan_alumni', { p_plan: plan.trim().toLowerCase() });
    if (error) return readFailure(error, 'founding_plan_alumni', PLAN_SETUP_TEXT);
    return { status: 'ok', rows: (data ?? []) as PlanAlumniRow[] };
  } catch (err) {
    return { status: 'error', error: String(err) };
  }
}
