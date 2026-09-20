import { useEffect, useMemo, useState } from 'react';
import {
  Award, Building2, Check, ChevronDown, ChevronRight, ClipboardList, CreditCard,
  History, LayoutDashboard, Mail, Pencil, PlusCircle, RotateCcw, Search, Trash2,
  UserCog, Users, X,
} from 'lucide-react';
import {
  Badge, Button, ConfirmAction, EmptyState, Skeleton,
  SelectField, StatGrid, StatTile, Tab, TabList, TabPanel, Tabs, TextField,
  type SelectOption,
} from './ui';
import FoundingUsersTab from './FoundingUsersTab';
import {
  fetchBetaSignups, setBetaStatus, deleteBetaSignup, fetchBetaOrgDirectory,
  type BetaSignupRow, type BetaOrgDirectoryRow,
} from '../lib/betaService';
import {
  fetchAllUsers, fetchFoundingAudit, setMembership, removeMembership, moveUser,
  createWorkspace, setOrgPlan, renameOrg, inviteMember, fetchOrgDetail,
  fetchPlanDirectory, upsertPlan, renamePlan, deletePlan,
  fetchOrgPlanHistory, fetchPlanAlumni,
  ORG_PLANS, PROTECTED_PLANS,
  type FoundingUserRow, type FoundingAuditRow, type OrgDetail, type OrgDetailResult, type OrgPlan,
  type FounderFailure, type PlanRow, type PlanHistoryRow, type PlanAlumniRow,
  type PlanDirectoryResult,
} from '../lib/foundingAdminService';
import type { OrgRole } from '../lib/orgService';
import { syncCrmContacts } from '../lib/crmService';
import { safeMailto } from '../lib/mailto';
import './OrgPanel.css';
import './FounderConsole.css';

/* ════════════════════════════════════════════════════════════════════════════
   FOUNDER CONSOLE — the page for running the beta, not for running a workspace.

   WHY IT EXISTS: approving a shop, seeing every workspace, and managing every
   account were three sections buried inside the Workspace dashboard — a page
   that is otherwise entirely about the workspace you are IN (its members, its
   Shopify connection, its description format, its marketplaces). Two audiences,
   one page. They are now one page each, and this is the founder's half.

   WHAT IS NEW HERE, rather than moved: creating a workspace before its owner
   has ever signed in, setting a workspace's plan, renaming one, inviting into
   one, and reading one workspace's roster. All five are RPCs in
   supabase/migrations/founder_console.sql — a founding admin is not a member of
   a tenant workspace, so organizations / org_invites RLS hides those rows
   entirely and no client-side query could ever do it.

   PRE-MIGRATION IT STILL WORKS. Requests, Workspaces and Users are the moved
   sections and behave exactly as they did in OrgPanel. Only the five new
   capabilities need founder_console.sql, and their absence shows one setup line
   naming the file — never an error wall.

   ONE SEQUENCING NOTE, because it looks like a bug and is not: approving a beta
   request and "Create workspace now" are not mutually exclusive, and doing both
   does NOT produce two workspaces. ensureOrganization resolves a membership
   first, then a pending invite, and only creates a workspace when it finds
   neither — so a founder-created workspace (which leaves the owner either a
   membership or an invite) always wins, and the approved-request branch never
   runs for that person.
   ════════════════════════════════════════════════════════════════════════════ */

type ConsoleTab = 'overview' | 'requests' | 'workspaces' | 'onboard' | 'plans' | 'alumni' | 'users';
type BetaFilter = 'pending' | 'approved' | 'denied' | 'all';
/** 'unknown' until the first founder_console.sql RPC answers. Only
 *  'unavailable' renders the setup line — 'error' and 'forbidden' are already
 *  reported as a notice by whatever call produced them. */
type ConsoleStatus = 'unknown' | 'ok' | FounderFailure;

/** The four editable cells of one catalog row, held as strings because they are
 *  what is in the inputs. Committed by one Save, for the same reason the
 *  workspace plan change is pick-then-Apply: a mis-click writes nothing. */
interface PlanDraft {
  display: string;
  price: string;
  active: boolean;
  sort: string;
}

export interface FounderConsoleProps {
  /** Marks "(you)" in the Users tab. */
  myUserId: string;
  /** The workspace the founder is currently signed in to, so a self-role change
   *  in the Users tab can tell App to repaint the header badge. */
  myOrgId?: string | null;
  onMyRoleChanged?: (role: OrgRole) => void;
}

const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : null;

/** `29900` → `$299.00`, for the "was …" note beside an edited price. Local for
 *  the same reason `fmtDate` above is: importing financeService's `formatMoney`
 *  pulls its whole 10.8 kB module into this page's chunk to render one string,
 *  and nothing else here is money. */
const fmtDollars = (cents: number) =>
  `$${(Math.round(cents) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Shown in the plan dropdowns ONLY when the catalog cannot be read — before
 *  plan_management.sql has been run. Never a filter on what the user may pick;
 *  that was the bug (a tier added in Finance could never be assigned). */
const FALLBACK_PLAN_OPTIONS: SelectOption[] = ORG_PLANS.map(p => ({ value: p, label: p }));

/** Mirrors the server's key rule so the reason is visible BEFORE the click. The
 *  server is still the gate: this key lands in `organizations.plan`, is compared
 *  in SQL and rendered as a badge, so it has to stay a plain slug. */
const PLAN_KEY_RE = /^[a-z][a-z0-9_-]{0,39}$/;

/**
 * Dollars typed by a human → integer cents, ZERO ALLOWED.
 *
 * financeService's `parseAmountToCents` is deliberately not reused: it rejects 0
 * because the ledger's CHECK requires `amount_cents > 0`, and a plan price of $0
 * is the free and beta tiers — the two rows that must always exist. Returns null
 * for anything that is not a non-negative number, which is what disables Save.
 */
function parsePlanCents(input: string): number | null {
  const cleaned = String(input ?? '').replace(/[$,\s]/g, '');
  if (!cleaned || cleaned === '.' || !/^\d*\.?\d*$/.test(cleaned)) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}

/** A catalog row as the four editable strings the inputs hold. */
function planDraftOf(p: PlanRow): PlanDraft {
  return {
    display: p.display_name ?? '',
    price: (Math.round(p.monthly_cents) / 100).toFixed(2),
    active: p.is_active,
    sort: String(p.sort_order),
  };
}

/** Has this row been edited? An unparseable price or sort counts as CHANGED, so
 *  Save appears and can explain itself, rather than the row looking untouched. */
function planDraftChanged(p: PlanRow, d: PlanDraft): boolean {
  return (d.display.trim() || null) !== (p.display_name ?? null)
    || parsePlanCents(d.price) !== p.monthly_cents
    || d.active !== p.is_active
    || Number(d.sort) !== p.sort_order;
}

function planDraftValid(d: PlanDraft): boolean {
  return parsePlanCents(d.price) !== null && Number.isInteger(Number(d.sort));
}

/**
 * One plan change as a sentence. Module scope: pure, and a component module may
 * only export components (ui/index.ts's rule, and react-refresh's).
 *
 * `source` CARRIES THE MEANING, and two of its three values are not plan moves:
 * - 'backfill' is the one row per workspace the migration wrote for state that
 *   predates the trigger. "Moved to" would invent an event that never happened.
 * - 'rename' is the cascade from renaming a TIER: that updates
 *   organizations.plan for every workspace on it, so the history trigger fires
 *   once per workspace. Those rows are recorded rather than suppressed
 *   (suppressing them needs an off switch on the trigger, which would hole the
 *   guarantee the trigger exists for) — so a single tier rename must not read
 *   as every shop in the workspace changing plan on the same afternoon.
 */
function planHistorySentence(r: PlanHistoryRow): string {
  if (r.source === 'backfill') return `on the ${r.plan} plan when the record starts`;
  if (r.source === 'rename') {
    return r.previous_plan
      ? `the plan was renamed ${r.previous_plan} → ${r.plan}`
      : `the plan was renamed to ${r.plan}`;
  }
  if (!r.previous_plan) return `created on the ${r.plan} plan`;
  return `moved to ${r.plan} from ${r.previous_plan}`;
}

/** Who made a plan change. A null email is not missing data — it is a change
 *  made straight in the SQL Editor, which the trigger catches and the audit
 *  table never could. Worth saying out loud. */
function planHistoryActor(r: PlanHistoryRow): string {
  if (r.source === 'backfill') return 'recorded when history started';
  return r.changed_by_email ?? 'from the SQL editor';
}

/** One audit row as a sentence. Module scope: it is pure, and a component
 *  module may only export components (ui/index.ts's rule, and react-refresh's). */
function auditSummary(a: FoundingAuditRow): string {
  const who = a.target_email ?? 'a user';
  switch (a.action) {
    case 'add_member':       return `added ${who} to ${a.to_org_name} as ${a.role}`;
    case 'set_role':         return `made ${who} ${a.role} in ${a.to_org_name}`;
    case 'remove_member':    return `removed ${who} from ${a.from_org_name}`;
    case 'move_user':        return `moved ${who} from ${a.from_org_name} to ${a.to_org_name}`;
    case 'create_workspace': return a.role === 'owner'
      ? `created the workspace "${a.to_org_name}" with ${who} as owner`
      : `created the workspace "${a.to_org_name}" and invited ${who} as admin`;
    case 'set_plan':         return `moved "${a.to_org_name}" onto the ${a.role} plan`;
    case 'rename_org':       return `renamed "${a.from_org_name}" to "${a.to_org_name}"`;
    case 'invite_member':    return `invited ${who} to ${a.to_org_name} as ${a.role}`;
    default:                 return `${a.action} ${who}`;
  }
}

/** Was this workspace touched in the last 7 days? Used for the Overview tile. */
function activeRecently(iso: string | null, now: number): boolean {
  if (!iso) return false;
  return now - new Date(iso).getTime() <= 7 * 24 * 60 * 60 * 1000;
}

export default function FounderConsole({ myUserId, myOrgId, onMyRoleChanged }: FounderConsoleProps) {
  const [tab, setTab] = useState<ConsoleTab>('overview');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [status, setStatus] = useState<ConsoleStatus>('unknown');

  const [signups, setSignups] = useState<BetaSignupRow[]>([]);
  const [orgs, setOrgs] = useState<BetaOrgDirectoryRow[]>([]);
  const [users, setUsers] = useState<FoundingUserRow[]>([]);
  const [audit, setAudit] = useState<FoundingAuditRow[]>([]);
  /* Counted in `reload` rather than derived at render: "in the last 7 days"
     needs the clock, and reading it during render is impure (react-hooks/purity
     rejects it). "As of when this page loaded" is also the truer statement. */
  const [activeCount, setActiveCount] = useState(0);

  const [betaFilter, setBetaFilter] = useState<BetaFilter>('all');
  const [betaSearch, setBetaSearch] = useState('');
  const [orgSearch, setOrgSearch] = useState('');

  // ── Workspace row expansion ───────────────────────────────────────────────
  const [expandedOrg, setExpandedOrg] = useState<string | null>(null);
  const [detail, setDetail] = useState<Record<string, OrgDetail | 'loading' | 'error'>>({});
  const [planDraft, setPlanDraft] = useState<Record<string, string>>({});
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [inviteDraft, setInviteDraft] = useState<Record<string, { email: string; role: 'member' | 'admin' }>>({});

  // ── Onboard form ──────────────────────────────────────────────────────────
  const [newName, setNewName] = useState('');
  const [newPlan, setNewPlan] = useState<OrgPlan>('beta');
  const [newEmail, setNewEmail] = useState('');

  // ── Plans (the catalog) ───────────────────────────────────────────────────
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [planStatus, setPlanStatus] = useState<ConsoleStatus>('unknown');
  const [planEdits, setPlanEdits] = useState<Record<string, PlanDraft>>({});
  const [planRenameId, setPlanRenameId] = useState<string | null>(null);
  const [planRenameDraft, setPlanRenameDraft] = useState('');
  const [newPlanKey, setNewPlanKey] = useState('');
  const [newPlanLabel, setNewPlanLabel] = useState('');
  const [newPlanPrice, setNewPlanPrice] = useState('');

  /** Per-workspace plan history, loaded when its row is expanded. */
  const [history, setHistory] = useState<Record<string, PlanHistoryRow[] | 'loading'>>({});

  // ── Alumni ────────────────────────────────────────────────────────────────
  const [alumniPlan, setAlumniPlan] = useState('beta');
  const [alumni, setAlumni] = useState<PlanAlumniRow[]>([]);
  const [alumniStatus, setAlumniStatus] = useState<'idle' | 'loading' | 'ok' | FounderFailure>('idle');

  /* The four lists, applied in one place so the mount effect and every
     post-write refresh cannot drift apart. `loading` is never set back to true:
     it starts true and the first load clears it, so a refresh after a write does
     not blank the page the founder is reading. */
  const applyLoad = (
    s: BetaSignupRow[], d: BetaOrgDirectoryRow[], u: FoundingUserRow[], a: FoundingAuditRow[],
  ) => {
    setSignups(s);
    setOrgs(d);
    setActiveCount(d.filter(o => activeRecently(o.last_active, Date.now())).length);
    setUsers(u);
    setAudit(a);
    setLoading(false);
  };

  /* Whether founder_console.sql has been run, answered with a REAL read rather
     than a guess — and the answer is kept as that workspace's detail, so
     expanding its row afterwards costs nothing. A database with no workspaces at
     all leaves the status 'unknown' and the Onboard tab simply tries; the RPC's
     own error is then what the founder sees. */
  const applyProbe = (orgId: string, res: OrgDetailResult) => {
    setStatus(res.status === 'ok' ? 'ok' : res.status);
    if (res.status === 'ok') setDetail(prev => ({ ...prev, [orgId]: res.detail }));
  };

  /* The catalog read doubles as the probe for plan_management.sql — the same
     trick applyProbe plays for founder_console.sql. Drafts are cleared on every
     load: a draft keyed to a row the server has since changed is stale, and
     silently re-offering it as "unsaved" would write the old values back. */
  const applyPlans = (res: PlanDirectoryResult) => {
    setPlanStatus(res.status);
    if (res.status === 'ok') {
      setPlans(res.plans);
      setPlanEdits({});
    }
  };

  /** Re-read everything after a write. Never called during render. */
  const reload = async () => {
    const [s, d, u, a, p] = await Promise.all([
      fetchBetaSignups(), fetchBetaOrgDirectory(), fetchAllUsers(), fetchFoundingAudit(),
      fetchPlanDirectory(),
    ]);
    applyLoad(s, d, u, a);
    applyPlans(p);
  };

  /* Load once, through an async IIFE with a cancel flag — the shape ProductsView
     and HomeDashboard already use. Every setState below happens after an await,
     which is what keeps react-hooks/set-state-in-effect satisfied AND is the
     actual correctness point: a console unmounted mid-fetch must not write.
     It repeats `reload`'s four calls rather than calling it, so the effect has
     no changing dependency at all — and it does one thing `reload` does not,
     which is probe whether founder_console.sql has been run. */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [s, d, u, a, p] = await Promise.all([
        fetchBetaSignups(), fetchBetaOrgDirectory(), fetchAllUsers(), fetchFoundingAudit(),
        // The catalog loads on MOUNT rather than when the Plans tab opens,
        // because two other tabs' dropdowns are built from it.
        fetchPlanDirectory(),
      ]);
      if (cancelled) return;
      applyLoad(s, d, u, a);
      applyPlans(p);
      if (d.length === 0) return;
      const res = await fetchOrgDetail(d[0].org_id);
      if (cancelled) return;
      applyProbe(d[0].org_id, res);
    })();
    return () => { cancelled = true; };
  }, []);

  // ── Derived ───────────────────────────────────────────────────────────────

  const betaCounts = useMemo(() => ({
    pending: signups.filter(s => s.status === 'pending').length,
    approved: signups.filter(s => s.status === 'approved').length,
    denied: signups.filter(s => s.status === 'denied').length,
  }), [signups]);

  const visibleSignups = useMemo(() => {
    const q = betaSearch.trim().toLowerCase();
    return signups
      .filter(s => betaFilter === 'all' || s.status === betaFilter)
      .filter(s => !q || [s.org_name, s.contact_name, s.email, s.store_url ?? ''].some(v => v.toLowerCase().includes(q)))
      .sort((a, b) => {
        if ((a.status === 'pending') !== (b.status === 'pending')) return a.status === 'pending' ? -1 : 1;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
  }, [signups, betaFilter, betaSearch]);

  const visibleOrgs = useMemo(() => {
    const q = orgSearch.trim().toLowerCase();
    if (!q) return orgs;
    return orgs.filter(o =>
      o.name.toLowerCase().includes(q)
      || (o.plan ?? '').toLowerCase().includes(q)
      || o.member_emails.some(e => e.toLowerCase().includes(q)));
  }, [orgs, orgSearch]);

  /** Every workspace we can offer as an add/move destination. Sourced from the
   *  directory, with any org seen on a membership folded in so the dropdowns
   *  still work if beta_org_directory() is unavailable. */
  const orgOptions = useMemo(() => {
    const map = new Map<string, string>();
    orgs.forEach(o => map.set(o.org_id, o.name));
    users.forEach(u => u.memberships.forEach(ms => {
      if (!map.has(ms.org_id)) map.set(ms.org_id, ms.org_name);
    }));
    return [...map].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [orgs, users]);

  const orgNameOf = (id: string) => orgOptions.find(o => o.id === id)?.name ?? 'that workspace';

  /**
   * WHAT EVERY PLAN DROPDOWN OFFERS — the catalog, not a constant.
   *
   * THIS IS THE BUG THIS PASS FIXES. Finance → Customers could always add a row
   * to finance_plan_prices, but the assignable list was a hardcoded array here
   * and a matching one in SQL, so a tier could be given a price and then be
   * impossible to put anybody on. ORG_PLANS is now only the fallback for the
   * single case where the catalog cannot be read at all.
   */
  const planOptions = useMemo((): SelectOption[] => {
    const active = plans.filter(p => p.is_active);
    if (active.length === 0) return FALLBACK_PLAN_OPTIONS;
    return active.map(p => ({ value: p.plan, label: p.display_name ?? p.plan }));
  }, [plans]);

  /**
   * The options for ONE select: the assignable list, plus whatever that select
   * is currently SET to even when the catalog no longer offers it.
   *
   * A `<select>` whose value is absent from its options renders as the FIRST
   * one, so without this a shop on a retired tier would read as "on free" and
   * be written to free by the next Apply.
   *
   * "not offered" rather than "retired" on purpose: the value may be a tier
   * that is priced but inactive, OR one deleted from the catalog outright and
   * surviving only in plan history. Both are true; only the second is not
   * "retired".
   */
  const planOptionsFor = (current: string | null | undefined): SelectOption[] => {
    const cur = current ?? 'free';
    if (planOptions.some(o => o.value === cur)) return planOptions;
    return [{ value: cur, label: `${cur} (not offered)` }, ...planOptions];
  };

  const planLabelOf = (key: string | null | undefined) =>
    plans.find(p => p.plan === key)?.display_name ?? key ?? 'free';

  const appUrl = `${window.location.origin}${import.meta.env.BASE_URL || '/'}`;

  // ── Beta requests ─────────────────────────────────────────────────────────

  const handleBetaDecision = async (id: string, next: 'approved' | 'denied' | 'pending') => {
    if (busy) return;
    setBusy(true);
    const ok = await setBetaStatus(id, next);
    if (!ok) setNotice('Could not update the request — check your permissions.');
    else if (next === 'approved') setNotice('Approved — their workspace is created automatically the next time they sign in. Use Create workspace now to set it up before then.');
    else if (next === 'denied') setNotice('Denied — they will see the "at capacity" message.');
    else setNotice('Moved back to pending. If they already signed in and got a workspace, it stays — the gate only applies before the first sign-in.');
    await reload();
    setBusy(false);
    // Keep the CRM stage current (lead → approved / lost). Best-effort.
    if (ok) void syncCrmContacts();
  };

  const handleBetaDelete = async (id: string) => {
    if (busy) return;
    setBusy(true);
    const ok = await deleteBetaSignup(id);
    if (!ok) setNotice('Delete failed — check your permissions.');
    await reload();
    setBusy(false);
  };

  const mailtoWelcome = (s: BetaSignupRow): string | null =>
    safeMailto(
      s.email,
      'Your Arcadian beta access is ready',
      `Hi ${s.contact_name},\n\nYour beta request for ${s.org_name} is approved. Sign in at ${appUrl} with this email address and your workspace will be ready.\n\nWelcome aboard!`,
    );

  const prefillOnboard = (s: BetaSignupRow) => {
    setNewName(s.org_name);
    setNewPlan('beta');
    setNewEmail(s.email);
    setNotice(null);
    setTab('onboard');
  };

  // ── Workspace lifecycle ───────────────────────────────────────────────────

  const loadDetail = async (orgId: string) => {
    setDetail(prev => ({ ...prev, [orgId]: 'loading' }));
    const res = await fetchOrgDetail(orgId);
    if (res.status === 'ok') {
      setStatus('ok');
      setDetail(prev => ({ ...prev, [orgId]: res.detail }));
    } else {
      setStatus(res.status);
      setDetail(prev => ({ ...prev, [orgId]: 'error' }));
    }
  };

  /** One workspace's plan changes. `fetchOrgPlanHistory` answers `[]` for every
   *  failure, so the panel reads `planStatus` to say what an empty list means. */
  const loadHistory = async (orgId: string) => {
    setHistory(prev => ({ ...prev, [orgId]: 'loading' }));
    const rows = await fetchOrgPlanHistory(orgId);
    setHistory(prev => ({ ...prev, [orgId]: rows }));
  };

  const toggleOrg = (orgId: string) => {
    const next = expandedOrg === orgId ? null : orgId;
    setExpandedOrg(next);
    if (next && !detail[next]) void loadDetail(next);
    if (next && !history[next]) void loadHistory(next);
  };

  const handleCreate = async () => {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    const res = await createWorkspace({ name: newName, plan: newPlan, ownerEmail: newEmail });
    if (res.ok) {
      setNotice(`Created "${newName.trim()}". ${newEmail.trim()} is either its owner already, or has an admin invite waiting — either way they land in it on their next sign-in.`);
      setNewName('');
      setNewEmail('');
      setNewPlan('beta');
      setStatus('ok');
      await reload();
      setTab('workspaces');
    } else {
      setStatus(res.reason === 'unavailable' ? 'unavailable' : status);
      setNotice(res.error ?? 'Could not create that workspace.');
    }
    setBusy(false);
  };

  /* No client-side membership test on `plan`. The catalog decides what exists
     and app_private.org_plan_list() is what refuses an unknown key — a guard
     here would just re-create the "priced but unassignable" tier. */
  const handleSetPlan = async (orgId: string, plan: string) => {
    if (busy || !plan) return;
    setBusy(true);
    setNotice(null);
    const res = await setOrgPlan(orgId, plan);
    setNotice(res.ok ? `${orgNameOf(orgId)} is on the ${plan} plan.` : (res.error ?? 'Could not change that plan.'));
    if (res.ok) {
      setPlanDraft(d => { const n = { ...d }; delete n[orgId]; return n; });
      await reload();
      await loadDetail(orgId);
      // The change just wrote a history row; the open panel should show it.
      await loadHistory(orgId);
    }
    setBusy(false);
  };

  const handleRename = async (orgId: string) => {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    const res = await renameOrg(orgId, renameDraft);
    setNotice(res.ok ? 'Workspace renamed.' : (res.error ?? 'Could not rename that workspace.'));
    if (res.ok) {
      setRenameId(null);
      await reload();
      await loadDetail(orgId);
    }
    setBusy(false);
  };

  const handleInvite = async (orgId: string) => {
    const draft = inviteDraft[orgId];
    if (busy || !draft?.email.trim()) return;
    setBusy(true);
    setNotice(null);
    const res = await inviteMember(orgId, draft.email, draft.role);
    setNotice(res.ok
      ? `Invited ${draft.email.trim()} to ${orgNameOf(orgId)} as ${draft.role}. They join on their next sign-in.`
      : (res.error ?? 'Could not send that invite.'));
    if (res.ok) {
      setInviteDraft(d => { const n = { ...d }; delete n[orgId]; return n; });
      await loadDetail(orgId);
    }
    setBusy(false);
  };

  // ── Plan catalog writes ───────────────────────────────────────────────────

  /* Every one of these ends in `reload()` rather than a narrower refetch: a
     rename moves workspaces between plans, so the directory, the catalog and the
     audit log all move together. Same shape as every other write on this page. */

  const newPlanKeyNorm = newPlanKey.trim().toLowerCase();
  const newPlanKeyValid = PLAN_KEY_RE.test(newPlanKeyNorm);
  const newPlanTaken = plans.some(p => p.plan === newPlanKeyNorm);

  const handleAddPlan = async () => {
    if (busy || !newPlanKeyValid || newPlanTaken) return;
    setBusy(true);
    setNotice(null);
    const res = await upsertPlan({
      plan: newPlanKeyNorm,
      displayName: newPlanLabel,
      monthlyCents: parsePlanCents(newPlanPrice) ?? 0,
      // Explicit, not omitted: `note` is REPLACED by this call, and the Add
      // button is gated on the key not existing, so there is nothing to
      // preserve. Saying it out loud is what keeps it a decision.
      note: null,
      isActive: true,
    });
    if (res.ok) {
      setNotice(`Added the ${newPlanKeyNorm} plan. It is assignable from the Workspaces tab straight away — that is the whole point of the catalog.`);
      setNewPlanKey('');
      setNewPlanLabel('');
      setNewPlanPrice('');
      await reload();
    } else {
      if (res.reason === 'unavailable') setPlanStatus('unavailable');
      setNotice(res.error ?? 'Could not add that plan.');
    }
    setBusy(false);
  };

  const handleSavePlan = async (p: PlanRow, d: PlanDraft) => {
    if (busy || !planDraftValid(d)) return;
    setBusy(true);
    setNotice(null);
    const res = await upsertPlan({
      plan: p.plan,
      displayName: d.display,
      monthlyCents: parsePlanCents(d.price) ?? p.monthly_cents,
      // Sent back unchanged. `note` has no cell in this table and the function
      // REPLACES it, so omitting it would blank a note written in Finance.
      // This is also why the Offered checkbox is part of the row draft rather
      // than a standalone toggle: a one-field writer here destroys two others.
      note: p.note,
      isActive: d.active,
      sortOrder: Number(d.sort),
    });
    setNotice(res.ok ? `Saved the ${p.plan} plan.` : (res.error ?? 'Could not save that plan.'));
    if (res.ok) await reload();
    else if (res.reason === 'unavailable') setPlanStatus('unavailable');
    setBusy(false);
  };

  /* A rename is refused server-side in BOTH directions: `free`/`beta` cannot be
     renamed, and no other plan may be renamed INTO one of them either — it
     would quietly inherit the column default, the waitlist path and the
     founding-discount rule. Mirrored here so the block shows before the round
     trip; the server's own sentence is what a bypass would print. */
  const planRenameBlocked = (to: string, from: string) =>
    !PLAN_KEY_RE.test(to) || to === from || PROTECTED_PLANS.includes(to);

  const handleRenamePlan = async (from: string) => {
    const to = planRenameDraft.trim().toLowerCase();
    if (busy || planRenameBlocked(to, from)) return;
    setBusy(true);
    setNotice(null);
    const res = await renamePlan(from, to);
    if (res.ok) {
      const moved = res.moved ?? 0;
      setNotice(
        `Renamed "${from}" to "${to}"${moved > 0 ? `, moving ${moved} workspace${moved === 1 ? '' : 's'} with it` : ''}. `
        + `Plan history still says "${from}" for anything that happened before now — it records what a plan was called at the time.`,
      );
      setPlanRenameId(null);
      await reload();
    } else {
      setNotice(res.error ?? 'Could not rename that plan.');
    }
    setBusy(false);
  };

  const handleDeletePlan = async (plan: string) => {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    const res = await deletePlan(plan);
    setNotice(res.ok
      ? `Deleted the ${plan} plan. Anything already recorded against it keeps the name.`
      : (res.error ?? 'Could not delete that plan.'));
    if (res.ok) await reload();
    setBusy(false);
  };

  // ── Alumni ────────────────────────────────────────────────────────────────

  /** Loaded when the tab is first opened and on every plan change, rather than
   *  on mount: it is a scan over every plan change ever recorded, and nothing
   *  else on the page needs it. */
  const loadAlumni = async (plan: string) => {
    setAlumniStatus('loading');
    const res = await fetchPlanAlumni(plan);
    if (res.status === 'ok') {
      setAlumni(res.rows);
      setAlumniStatus('ok');
    } else {
      setAlumni([]);
      setAlumniStatus(res.status);
      if (res.status === 'unavailable') setPlanStatus('unavailable');
    }
  };

  const handleTabChange = (value: string) => {
    const next = value as ConsoleTab;
    setTab(next);
    if (next === 'alumni' && alumniStatus === 'idle') void loadAlumni(alumniPlan);
  };

  const handleAlumniPlan = (plan: string) => {
    setAlumniPlan(plan);
    void loadAlumni(plan);
  };

  const alumniTotals = useMemo(() => ({
    total: alumni.length,
    still: alumni.filter(a => a.still_on).length,
    gone: alumni.filter(a => !a.exists_now).length,
  }), [alumni]);

  // ── Membership writes (Users tab + the expanded workspace's roster) ────────

  const handleSetMembership = async (u: FoundingUserRow, orgId: string, role: OrgRole) => {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    const res = await setMembership(u.user_id, orgId, role);
    setNotice(res.ok
      ? `${u.email ?? 'That user'} is now ${role} in ${orgNameOf(orgId)}.`
      : `Role change failed: ${res.error}`);
    if (res.ok && u.user_id === myUserId && orgId === myOrgId) onMyRoleChanged?.(role);
    await reload();
    if (res.ok && detail[orgId]) await loadDetail(orgId);
    setBusy(false);
  };

  const handleRemoveMembership = async (u: FoundingUserRow, orgId: string) => {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    const res = await removeMembership(u.user_id, orgId);
    setNotice(res.ok
      ? `Removed ${u.email ?? 'that user'} from ${orgNameOf(orgId)}. That workspace keeps all of its batches and products.`
      : `Remove failed: ${res.error}`);
    await reload();
    if (res.ok && detail[orgId]) await loadDetail(orgId);
    setBusy(false);
  };

  const handleMoveUser = async (u: FoundingUserRow, fromOrgId: string, toOrgId: string) => {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    const res = await moveUser(u.user_id, fromOrgId, toOrgId);
    setNotice(res.ok
      ? `Moved ${u.email ?? 'that user'} to ${orgNameOf(toOrgId)}. Their batches stayed in ${orgNameOf(fromOrgId)} — move them back to restore access.`
      : `Move failed: ${res.error}`);
    await reload();
    setBusy(false);
  };

  /** The roster inside an expanded workspace writes through the same RPCs, so it
   *  needs a FoundingUserRow-shaped stand-in for the member it is acting on. */
  const asUserRow = (userId: string, email: string | null): FoundingUserRow =>
    users.find(u => u.user_id === userId)
    ?? { user_id: userId, email, created_at: '', last_sign_in_at: null, memberships: [] };

  // ── Render ────────────────────────────────────────────────────────────────

  const setupHint = status === 'unavailable' && (
    <p className="fc-setup" role="status">
      Creating workspaces, changing plans, renaming and inviting need one more
      migration: run <code>supabase/migrations/founder_console.sql</code> in the
      Supabase SQL Editor. Everything else on this page already works.
    </p>
  );

  /* The SECOND setup line. Two migrations install this page's RPCs and they are
     run independently, so naming the wrong file is worse than naming none: it
     sends the founder to a file they have already run. Rendered inside the two
     surfaces it applies to rather than at the top of the console, because the
     rest of the page is unaffected — the plan dropdowns simply fall back to the
     nine seeded names. */
  const planSetupHint = planStatus === 'unavailable' && (
    <p className="fc-setup" role="status">
      Plan management and plan history need one more migration: run{' '}
      <code>supabase/migrations/plan_management.sql</code> in the Supabase SQL
      Editor. Until then the plan dropdowns offer the nine seeded tiers and
      nothing else on this page changes.
    </p>
  );

  return (
    <div className="fc-view">
      {notice && <div className="org-panel-notice">{notice}</div>}
      {setupHint}

      <Tabs value={tab} onValueChange={handleTabChange}>
        <TabList label="Founder console sections" appearance="underline">
          <Tab value="overview" icon={<LayoutDashboard size={14} />}>Overview</Tab>
          <Tab value="requests" icon={<ClipboardList size={14} />} count={betaCounts.pending}>Requests</Tab>
          <Tab value="workspaces" icon={<Building2 size={14} />} count={orgs.length}>Workspaces</Tab>
          <Tab value="onboard" icon={<PlusCircle size={14} />}>Onboard</Tab>
          <Tab value="plans" icon={<CreditCard size={14} />} count={plans.length}>Plans</Tab>
          <Tab value="alumni" icon={<Award size={14} />}>Alumni</Tab>
          <Tab value="users" icon={<UserCog size={14} />} count={users.length}>Users</Tab>
        </TabList>

        {/* ── Overview ─────────────────────────────────────────────────────── */}
        <TabPanel value="overview">
          {loading ? (
            <div className="fc-skeleton">
              <Skeleton shape="text" height="6rem" />
              <Skeleton shape="text" height="4rem" />
            </div>
          ) : (
            <>
              <StatGrid className="fc-stats">
                <StatTile label="Pending requests" value={betaCounts.pending}
                  hint={betaCounts.pending > 0 ? 'Waiting on you' : 'All caught up'} />
                <StatTile label="Workspaces" value={orgs.length} />
                <StatTile label="Accounts" value={users.length}
                  hint={`${users.filter(u => u.memberships.length === 0).length} with no workspace`} />
                <StatTile label="Active in 7 days" value={activeCount}
                  hint="Workspaces with a batch touched" />
              </StatGrid>

              <h3 className="org-section-title">
                <History size={13} /> Recent changes
              </h3>
              {audit.length === 0 ? (
                <EmptyState
                  inline
                  icon={<History size={22} />}
                  title="Nothing logged yet"
                  description="Every workspace and membership change made from this page is recorded here with your name on it."
                />
              ) : (
                <ul className="org-member-list fa-audit-list">
                  {audit.slice(0, 10).map(a => (
                    <li key={a.id} className="org-member-row fa-audit-row">
                      <span className="org-member-email">
                        <strong>{a.actor_email ?? 'someone'}</strong> {auditSummary(a)}
                        <span className="org-member-date">{fmtDate(a.created_at)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </TabPanel>

        {/* ── Requests ─────────────────────────────────────────────────────── */}
        <TabPanel value="requests">
          <h3 className="org-section-title">Beta requests ({betaCounts.pending} pending)</h3>
          {signups.length === 0 ? (
            <EmptyState
              icon={<ClipboardList size={22} />}
              title="No requests yet"
              description="Share the landing page with shops you want in. Anything they submit lands here."
            />
          ) : (
            <>
              <div className="beta-toolbar">
                <div className="beta-filter-chips">
                  {(['pending', 'approved', 'denied', 'all'] as const).map(f => (
                    <button
                      key={f}
                      type="button"
                      className={`beta-chip ${betaFilter === f ? 'beta-chip--active' : ''}`}
                      aria-pressed={betaFilter === f}
                      onClick={() => setBetaFilter(f)}
                    >
                      {f === 'all' ? `All ${signups.length}` : `${f[0].toUpperCase()}${f.slice(1)} ${betaCounts[f]}`}
                    </button>
                  ))}
                </div>
                <div className="beta-search">
                  <Search size={13} />
                  <input
                    placeholder="Search name, email, store"
                    value={betaSearch}
                    onChange={(e) => setBetaSearch(e.target.value)}
                  />
                </div>
              </div>

              {visibleSignups.length === 0 && (
                <p className="org-panel-loading">Nothing matches this filter.</p>
              )}

              <ul className="org-member-list">
                {visibleSignups.map(s => (
                  <li key={s.id} className="org-member-row beta-request-row">
                    <div className="beta-request-info">
                      <span className="org-member-email">
                        <strong>{s.org_name}</strong> · {s.contact_name} · {(() => {
                          const href = safeMailto(s.email);
                          return href
                            ? <a className="beta-email-link" href={href}>{s.email}</a>
                            : <span className="beta-email-link">{s.email}</span>;
                        })()}
                      </span>
                      {(s.store_url || s.volume || s.notes) && (
                        <span className="beta-request-meta">
                          {[s.store_url, s.volume && `${s.volume}/wk`, s.notes].filter(Boolean).join(' · ')}
                        </span>
                      )}
                      <span className="beta-request-dates">
                        requested {fmtDate(s.created_at)}
                        {s.reviewed_at ? ` · reviewed ${fmtDate(s.reviewed_at)}` : ''}
                      </span>
                    </div>
                    <span className="beta-request-actions">
                      {s.status === 'pending' ? (
                        <>
                          <button className="beta-approve" disabled={busy} onClick={() => handleBetaDecision(s.id, 'approved')}>Approve</button>
                          <button className="beta-deny" disabled={busy} onClick={() => handleBetaDecision(s.id, 'denied')}>Deny</button>
                        </>
                      ) : (
                        <>
                          <span className={`org-role-badge beta-status-${s.status}`}>{s.status}</span>
                          {s.status === 'approved' && (() => {
                            const href = mailtoWelcome(s);
                            return href
                              ? <a className="org-icon-btn" href={href} title="Compose welcome email"><Mail size={13} /></a>
                              : null;
                          })()}
                          <button className="org-icon-btn" title="Move back to pending" disabled={busy}
                            onClick={() => handleBetaDecision(s.id, 'pending')}><RotateCcw size={13} /></button>
                        </>
                      )}
                      {s.status !== 'denied' && (
                        <Button size="sm" icon={<PlusCircle size={12} />} disabled={busy}
                          onClick={() => prefillOnboard(s)}>
                          Create workspace now
                        </Button>
                      )}
                      <ConfirmAction
                        label="Delete"
                        icon={<Trash2 size={12} />}
                        prompt="Delete this request permanently?"
                        disabled={busy}
                        onConfirm={() => handleBetaDelete(s.id)}
                      />
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </TabPanel>

        {/* ── Workspaces ───────────────────────────────────────────────────── */}
        <TabPanel value="workspaces">
          <h3 className="org-section-title">Workspaces ({orgs.length})</h3>
          {orgs.length === 0 ? (
            <EmptyState
              icon={<Building2 size={22} />}
              title="No workspaces listed"
              description="beta_admin_directory.sql has not been run, or there is genuinely nothing here yet. Onboard a shop to start."
              actions={<Button variant="primary" onClick={() => setTab('onboard')}>Onboard a workspace</Button>}
            />
          ) : (
            <>
              <div className="beta-toolbar">
                <div className="beta-search">
                  <Search size={13} />
                  <input
                    placeholder="Search name, plan or member email"
                    value={orgSearch}
                    onChange={(e) => setOrgSearch(e.target.value)}
                  />
                </div>
                <Button icon={<PlusCircle size={13} />} onClick={() => setTab('onboard')}>Onboard a workspace</Button>
              </div>

              {visibleOrgs.length === 0 && <p className="org-panel-loading">Nothing matches that search.</p>}

              <ul className="org-member-list">
                {visibleOrgs.map(o => {
                  const open = expandedOrg === o.org_id;
                  const d = detail[o.org_id];
                  const draftPlan = planDraft[o.org_id] ?? (o.plan ?? 'free');
                  const inv = inviteDraft[o.org_id] ?? { email: '', role: 'member' as const };
                  return (
                    <li key={o.org_id} className="org-member-row org-dir-row fc-org-row">
                      <button
                        type="button"
                        className="fc-org-head"
                        aria-expanded={open}
                        onClick={() => toggleOrg(o.org_id)}
                      >
                        <span aria-hidden="true" className="fc-org-chev">
                          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        </span>
                        <span className="org-dir-info">
                          <span className="org-member-email">
                            <Building2 size={13} />
                            <strong>{o.name}</strong>
                            {o.slug === 'founding' && <span className="org-role-badge org-role-owner">founding</span>}
                            {o.plan && <Badge tone="neutral">{o.plan}</Badge>}
                          </span>
                          <span className="org-dir-stats">
                            {o.member_count} member{o.member_count === 1 ? '' : 's'} · {o.batch_count} batch{o.batch_count === 1 ? '' : 'es'} · {o.product_count} product{o.product_count === 1 ? '' : 's'} · {o.image_count} image{o.image_count === 1 ? '' : 's'}
                          </span>
                          <span className="beta-request-dates">
                            created {fmtDate(o.created_at)}
                            {o.last_active ? ` · last active ${fmtDate(o.last_active)}` : ' · no activity yet'}
                          </span>
                        </span>
                      </button>

                      {open && (
                        <div className="fc-org-body">
                          {/* Plan + rename */}
                          <div className="fc-org-controls">
                            <label className="fc-inline-field">
                              <span>Plan</span>
                              <select
                                value={draftPlan}
                                disabled={busy}
                                onChange={(e) => setPlanDraft(p => ({ ...p, [o.org_id]: e.target.value }))}
                              >
                                {/* From the CATALOG, plus this workspace's own
                                    plan if that tier has since been retired. */}
                                {planOptionsFor(o.plan).map(opt => (
                                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                                ))}
                              </select>
                            </label>
                            {draftPlan !== (o.plan ?? 'free') && (
                              draftPlan === 'free' ? (
                                /* Dropping a paying shop to free is the one plan
                                   change that silently stops billing them, so it
                                   is the one that asks twice. */
                                <ConfirmAction
                                  label="Apply"
                                  tone="neutral"
                                  confirmLabel="Move to free"
                                  prompt={`Move ${o.name} to the free plan?`}
                                  disabled={busy}
                                  onConfirm={() => handleSetPlan(o.org_id, draftPlan)}
                                />
                              ) : (
                                <Button size="sm" variant="primary" disabled={busy}
                                  onClick={() => handleSetPlan(o.org_id, draftPlan)}>
                                  Apply
                                </Button>
                              )
                            )}

                            {renameId === o.org_id ? (
                              <span className="org-rename-form">
                                <input
                                  value={renameDraft}
                                  maxLength={60}
                                  autoFocus
                                  aria-label="Workspace name"
                                  onChange={(e) => setRenameDraft(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') void handleRename(o.org_id);
                                    if (e.key === 'Escape') setRenameId(null);
                                  }}
                                />
                                <button className="org-icon-btn" title="Save name" disabled={busy || !renameDraft.trim()}
                                  onClick={() => handleRename(o.org_id)}><Check size={14} /></button>
                                <button className="org-icon-btn" title="Cancel" disabled={busy}
                                  onClick={() => setRenameId(null)}><X size={14} /></button>
                              </span>
                            ) : (
                              <Button size="sm" icon={<Pencil size={12} />} disabled={busy}
                                onClick={() => { setRenameId(o.org_id); setRenameDraft(o.name); }}>
                                Rename
                              </Button>
                            )}
                          </div>

                          {/* Plan history — the record organizations.plan cannot
                              keep, because it is one mutable column. Written by
                              a trigger, so a change made in the SQL Editor
                              appears here too (with no email against it). */}
                          {(() => {
                            const h = history[o.org_id];
                            if (h === 'loading') return <p className="org-panel-loading">Loading plan history…</p>;
                            const rows = h ?? [];
                            return (
                              <>
                                <h4 className="fc-sub">Plan history</h4>
                                {rows.length === 0 ? (
                                  <p className="org-panel-loading">
                                    {planStatus === 'unavailable'
                                      ? <>Plan history needs <code>plan_management.sql</code>.</>
                                      : 'No plan change recorded for this workspace yet.'}
                                  </p>
                                ) : (
                                  <ul className="fa-membership-list fc-history-list">
                                    {rows.map((r, i) => (
                                      <li key={`${r.changed_at}-${i}`} className="fa-membership-row fc-history-row">
                                        <span className="fa-ms-org">
                                          <History size={12} />
                                          {planHistorySentence(r)}
                                        </span>
                                        <span className="beta-request-dates">
                                          {fmtDate(r.changed_at)} · {planHistoryActor(r)}
                                        </span>
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </>
                            );
                          })()}

                          {d === 'loading' && <p className="org-panel-loading">Loading…</p>}
                          {d === 'error' && (
                            <p className="org-panel-loading">
                              Members and invites need <code>founder_console.sql</code>. The counts above come from
                              beta_org_directory and are current.
                            </p>
                          )}

                          {d && d !== 'loading' && d !== 'error' && (
                            <>
                              <h4 className="fc-sub">Members ({d.members.length})</h4>
                              <ul className="fa-membership-list">
                                {d.members.map(m => (
                                  <li key={m.user_id} className="fa-membership-row">
                                    <span className="fa-ms-org">
                                      <Users size={12} />
                                      {m.email ?? m.user_id.slice(0, 8)}
                                    </span>
                                    <select
                                      className="org-role-select"
                                      value={m.role}
                                      disabled={busy}
                                      aria-label={`Role for ${m.email ?? 'this member'}`}
                                      onChange={(e) => handleSetMembership(asUserRow(m.user_id, m.email), o.org_id, e.target.value as OrgRole)}
                                    >
                                      <option value="owner">Owner</option>
                                      <option value="admin">Admin</option>
                                      <option value="member">Member</option>
                                    </select>
                                    <ConfirmAction
                                      label="Remove"
                                      confirmLabel="Remove"
                                      prompt={`Remove them from ${o.name}? The workspace keeps all of its work.`}
                                      disabled={busy}
                                      onConfirm={() => handleRemoveMembership(asUserRow(m.user_id, m.email), o.org_id)}
                                    />
                                  </li>
                                ))}
                                {d.members.length === 0 && (
                                  <li className="fa-membership-row">
                                    <span className="fa-ms-org">Nobody has joined yet.</span>
                                  </li>
                                )}
                              </ul>

                              <h4 className="fc-sub">Pending invites ({d.invites.length})</h4>
                              {d.invites.length === 0 ? (
                                <p className="org-panel-loading">No open invites.</p>
                              ) : (
                                <ul className="fa-membership-list">
                                  {d.invites.map(i => (
                                    <li key={i.id} className="fa-membership-row">
                                      <span className="fa-ms-org"><Mail size={12} />{i.email}</span>
                                      <Badge tone="neutral">{i.role}</Badge>
                                      <span className="beta-request-dates">sent {fmtDate(i.created_at)}</span>
                                    </li>
                                  ))}
                                </ul>
                              )}

                              <div className="fc-invite-row">
                                <TextField
                                  label="Invite by email"
                                  type="email"
                                  placeholder="teammate@shop.com"
                                  value={inv.email}
                                  disabled={busy}
                                  onChange={(e) => setInviteDraft(dd => ({ ...dd, [o.org_id]: { ...inv, email: e.target.value } }))}
                                />
                                <SelectField
                                  label="Role"
                                  value={inv.role}
                                  disabled={busy}
                                  options={[{ value: 'member', label: 'Member' }, { value: 'admin', label: 'Admin' }]}
                                  onChange={(e) => setInviteDraft(dd => ({ ...dd, [o.org_id]: { ...inv, role: e.target.value as 'member' | 'admin' } }))}
                                />
                                <Button variant="primary" disabled={busy || !inv.email.trim()}
                                  onClick={() => handleInvite(o.org_id)}>
                                  Send invite
                                </Button>
                              </div>
                              <p className="shopify-conn-help">
                                An invite can only be member or admin — never owner. Add them, let them
                                sign in, then promote from the Members list above.
                              </p>

                              {d.marketplaces.length > 0 && (
                                <p className="fc-markets">
                                  Selling on: {d.marketplaces.join(', ')}
                                </p>
                              )}
                            </>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </TabPanel>

        {/* ── Onboard ──────────────────────────────────────────────────────── */}
        <TabPanel value="onboard">
          <h3 className="org-section-title">Onboard a workspace</h3>
          <p className="shopify-conn-help">
            Sets a shop up before they ever sign in. If the email already has an
            account they become the OWNER straight away; if it does not, they get
            an admin invite and join automatically on their first sign-in — you can
            promote them to owner from the Workspaces tab once they are in.
            Categories and presets are seeded for them the first time they open it.
          </p>

          <div className="fc-form">
            <TextField
              label="Workspace name"
              required
              maxLength={60}
              placeholder="Rack City Vintage"
              value={newName}
              disabled={busy}
              onChange={(e) => setNewName(e.target.value)}
            />
            <SelectField
              label="Plan"
              value={newPlan}
              disabled={busy}
              // The catalog again, not a constant — a tier added on the Plans
              // tab can be onboarded onto without a redeploy.
              options={planOptionsFor(newPlan)}
              hint="Beta shops keep founding pricing for life, so leave this on beta unless they are paying today."
              onChange={(e) => setNewPlan(e.target.value)}
            />
            <TextField
              label="Owner email"
              required
              type="email"
              placeholder="owner@shop.com"
              value={newEmail}
              disabled={busy}
              onChange={(e) => setNewEmail(e.target.value)}
            />
            <div className="fc-form-actions">
              <Button
                variant="primary"
                icon={<PlusCircle size={14} />}
                loading={busy}
                disabled={busy || !newName.trim() || !newEmail.trim()}
                onClick={handleCreate}
              >
                Create workspace
              </Button>
            </div>
          </div>
        </TabPanel>

        {/* ── Plans ────────────────────────────────────────────────────────── */}
        <TabPanel value="plans">
          <h3 className="org-section-title">Plans ({plans.length})</h3>
          {planSetupHint}
          <p className="shopify-conn-help">
            <code>finance_plan_prices</code> is the catalog. Everything that offers a
            plan reads it — the Workspaces tab, the Onboard form, and the server-side
            check that decides whether a plan may be written at all — so a tier added
            here can be assigned straight away. It used to be a hardcoded list in two
            hand-synced places, which is how a tier priced in Finance could end up
            impossible to put anybody on.
          </p>

          {plans.length === 0 ? (
            <EmptyState
              icon={<CreditCard size={22} />}
              title="No catalog to edit yet"
              description={
                planStatus === 'unavailable'
                  ? `Nothing is broken meanwhile: every plan dropdown still offers the nine seeded tiers — ${ORG_PLANS.join(', ')} — and setting a workspace's plan works exactly as it does today. Running the migration above is what makes them editable and starts recording plan history.`
                  : 'finance_plan_prices came back empty. Run finance.sql — or plan_management.sql, which re-creates and re-seeds the table — to get the nine starting tiers.'
              }
            />
          ) : (
            <table className="an-table an-table--cards fc-plan-table">
              <thead>
                <tr>
                  <th scope="col">Key</th>
                  <th scope="col">Name shown</th>
                  <th scope="col" className="an-num">Price / mo</th>
                  <th scope="col">Assignable</th>
                  <th scope="col" className="an-num">Order</th>
                  <th scope="col" className="an-num">Workspaces</th>
                  <th scope="col" className="an-num">Ever used</th>
                  <th scope="col"><span className="ui-sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {plans.map(p => {
                  const d = planEdits[p.plan] ?? planDraftOf(p);
                  const changed = planDraftChanged(p, d);
                  const valid = planDraftValid(d);
                  const renaming = planRenameId === p.plan;
                  const setD = (patch: Partial<PlanDraft>) =>
                    setPlanEdits(e => ({ ...e, [p.plan]: { ...d, ...patch } }));
                  return (
                    <tr key={p.plan} className="fc-plan-row">
                      <td data-label="Key">
                        <span className="fc-plan-key">
                          <code>{p.plan}</code>
                          {p.protected && <Badge tone="neutral">built in</Badge>}
                          {!p.is_active && <Badge tone="warning">retired</Badge>}
                        </span>
                      </td>
                      <td data-label="Name shown">
                        <input
                          className="fc-plan-input"
                          maxLength={60}
                          placeholder={p.plan}
                          aria-label={`Name shown for the ${p.plan} plan`}
                          value={d.display}
                          disabled={busy}
                          onChange={(e) => setD({ display: e.target.value })}
                        />
                      </td>
                      <td data-label="Price / mo" className="an-num">
                        <span className="fc-plan-money">
                          <span aria-hidden="true" className="fc-plan-money-mark">$</span>
                          <input
                            className="fc-plan-input fc-plan-input--num"
                            inputMode="decimal"
                            aria-label={`Monthly price in dollars for the ${p.plan} plan`}
                            value={d.price}
                            disabled={busy}
                            onChange={(e) => setD({ price: e.target.value })}
                          />
                        </span>
                        {changed && parsePlanCents(d.price) !== p.monthly_cents && (
                          <span className="fc-plan-was">was {fmtDollars(p.monthly_cents)}</span>
                        )}
                      </td>
                      <td data-label="Assignable">
                        {/* A retired tier stays PRICED so historical MRR still
                            joins; it just drops out of every dropdown. */}
                        <label className="fc-plan-check">
                          <input
                            type="checkbox"
                            checked={d.active}
                            disabled={busy}
                            aria-label={`Offer the ${p.plan} plan in the dropdowns`}
                            onChange={(e) => setD({ active: e.target.checked })}
                          />
                          <span>{d.active ? 'Offered' : 'Retired'}</span>
                        </label>
                      </td>
                      <td data-label="Order" className="an-num">
                        <input
                          className="fc-plan-input fc-plan-input--num"
                          inputMode="numeric"
                          aria-label={`Dropdown order for the ${p.plan} plan`}
                          value={d.sort}
                          disabled={busy}
                          onChange={(e) => setD({ sort: e.target.value })}
                        />
                      </td>
                      <td data-label="Workspaces" className="an-num">{p.workspaces}</td>
                      <td data-label="Ever used" className="an-num">{p.ever_used}</td>
                      <td>
                        <span className="fc-plan-actions">
                          {changed && (
                            <>
                              <Button size="sm" variant="primary" disabled={busy || !valid}
                                onClick={() => handleSavePlan(p, d)}>
                                Save
                              </Button>
                              <Button size="sm" variant="ghost" disabled={busy}
                                onClick={() => setPlanEdits(e => {
                                  const n = { ...e }; delete n[p.plan]; return n;
                                })}>
                                Cancel
                              </Button>
                              {!valid && (
                                <span className="fc-plan-why" role="alert">
                                  Price needs to be a number like 129 or 129.00, and order a whole number.
                                </span>
                              )}
                            </>
                          )}

                          {/* PROTECTED PLANS SAY WHY, rather than showing a
                              greyed control with no explanation. The server
                              refuses either way; this is so the founder knows
                              before the click instead of after it. */}
                          {p.protected ? (
                            <span className="fc-plan-why">
                              Built in — <code>organizations.plan</code> defaults to <code>free</code>,
                              new workspaces start on <code>beta</code>, and the founding-discount
                              test reads that name. Neither can be renamed or deleted.
                            </span>
                          ) : renaming ? (
                            <span className="org-rename-form">
                              <input
                                value={planRenameDraft}
                                maxLength={40}
                                autoFocus
                                aria-label={`New key for the ${p.plan} plan`}
                                onChange={(e) => setPlanRenameDraft(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') void handleRenamePlan(p.plan);
                                  if (e.key === 'Escape') setPlanRenameId(null);
                                }}
                              />
                              <button
                                className="org-icon-btn"
                                title={PROTECTED_PLANS.includes(planRenameDraft.trim().toLowerCase())
                                  ? `"${planRenameDraft.trim().toLowerCase()}" is built in and cannot be taken over by another plan`
                                  : 'Save key'}
                                disabled={busy || planRenameBlocked(planRenameDraft.trim().toLowerCase(), p.plan)}
                                onClick={() => handleRenamePlan(p.plan)}><Check size={14} /></button>
                              <button className="org-icon-btn" title="Cancel" disabled={busy}
                                onClick={() => setPlanRenameId(null)}><X size={14} /></button>
                            </span>
                          ) : (
                            <>
                              <Button size="sm" icon={<Pencil size={12} />} disabled={busy}
                                onClick={() => { setPlanRenameId(p.plan); setPlanRenameDraft(p.plan); }}>
                                Rename
                              </Button>
                              {/* Delete is for a tier created by mistake. Anything with a
                                  present OR a past is retired instead — the server refuses
                                  both (§8.4), and these say which rule you have hit. The
                                  history rule is not tidiness: the Alumni picker is built
                                  from the catalog, so deleting a used tier is what would
                                  make its alumni unreachable. */}
                              {p.workspaces > 0 ? (
                                <span className="fc-plan-why">
                                  {p.workspaces} workspace{p.workspaces === 1 ? '' : 's'} on it —
                                  move them off first, or untick Offered to retire it and keep it priced.
                                </span>
                              ) : p.ever_used > 0 ? (
                                <span className="fc-plan-why">
                                  {p.ever_used} workspace{p.ever_used === 1 ? ' has' : 's have'} been on it —
                                  a plan with history can’t be deleted. Untick Offered to retire it, which
                                  keeps its price and keeps its alumni findable.
                                </span>
                              ) : (
                                <ConfirmAction
                                  label="Delete"
                                  icon={<Trash2 size={12} />}
                                  prompt={`Delete the ${p.plan} plan?`}
                                  disabled={busy}
                                  onConfirm={() => handleDeletePlan(p.plan)}
                                />
                              )}
                            </>
                          )}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          <h4 className="fc-sub">Add a plan</h4>
          <div className="fc-plan-add">
            <TextField
              label="Key"
              placeholder="studio"
              maxLength={40}
              value={newPlanKey}
              disabled={busy}
              hint="Lower-case letters, digits, - and _. This is the value written into organizations.plan."
              error={
                newPlanKey.trim() !== '' && !newPlanKeyValid
                  ? 'Start with a letter, then letters, digits, - or _ (40 characters max).'
                  : newPlanTaken
                    ? `There is already a "${newPlanKeyNorm}" plan — edit its row above.`
                    : undefined
              }
              onChange={(e) => setNewPlanKey(e.target.value)}
            />
            <TextField
              label="Name shown"
              placeholder="Studio"
              maxLength={60}
              value={newPlanLabel}
              disabled={busy}
              hint="Optional. The dropdowns fall back to the key."
              onChange={(e) => setNewPlanLabel(e.target.value)}
            />
            <TextField
              label="Price / month"
              placeholder="299"
              inputMode="decimal"
              value={newPlanPrice}
              disabled={busy}
              hint="In dollars. Blank is $0, which is what free and beta are."
              onChange={(e) => setNewPlanPrice(e.target.value)}
            />
            <Button
              variant="primary"
              icon={<PlusCircle size={13} />}
              loading={busy}
              disabled={busy || !newPlanKeyValid || newPlanTaken}
              onClick={handleAddPlan}
            >
              Add plan
            </Button>
          </div>
        </TabPanel>

        {/* ── Alumni ───────────────────────────────────────────────────────── */}
        <TabPanel value="alumni">
          <h3 className="org-section-title">Plan alumni</h3>
          {planSetupHint}
          <p className="shopify-conn-help">
            Every workspace that has <strong>ever</strong> been on a plan, including the
            ones that no longer exist. <code>organizations.plan</code> is a single mutable
            column, so the moment a beta shop moves to pro the fact that they were a beta
            shop is gone — and <code>beta_signups</code> only ever held an email and a
            typed-in shop name. This reads <code>org_plan_history</code>, which a trigger
            writes on every plan change (a SQL-Editor edit included) and which keeps the
            workspace id and name with no foreign key, so the record outlives the
            workspace itself.
          </p>

          <div className="beta-toolbar fc-alumni-toolbar">
            <label className="fc-inline-field">
              <span>Plan</span>
              <select
                value={alumniPlan}
                disabled={alumniStatus === 'loading'}
                aria-label="Which plan's alumni to list"
                onChange={(e) => handleAlumniPlan(e.target.value)}
              >
                {planOptionsFor(alumniPlan).map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </label>
            <Button size="sm" icon={<RotateCcw size={12} />}
              disabled={alumniStatus === 'loading'}
              onClick={() => handleAlumniPlan(alumniPlan)}>
              Refresh
            </Button>
          </div>

          {alumniStatus === 'loading' && <p className="org-panel-loading">Reading plan history…</p>}
          {(alumniStatus === 'forbidden' || alumniStatus === 'error') && (
            <p className="org-panel-loading">
              That read did not come back. Founding Workspace admins only — check your
              role, then hit Refresh.
            </p>
          )}

          {alumniStatus === 'ok' && (alumni.length === 0 ? (
            <EmptyState
              icon={<Award size={22} />}
              title={`No workspace has been on ${planLabelOf(alumniPlan)}`}
              description="Once one is put on this plan — here, by the waitlist approval path, or straight from the SQL editor — it stays on this list for good."
            />
          ) : (
            <>
              <p className="fc-alumni-summary" role="status">
                <strong>{alumniTotals.total}</strong> workspace{alumniTotals.total === 1 ? '' : 's'}{' '}
                {alumniTotals.total === 1 ? 'has' : 'have'} been on{' '}
                <strong>{planLabelOf(alumniPlan)}</strong>
                {' · '}<strong>{alumniTotals.still}</strong> still{' '}
                {alumniTotals.still === 1 ? 'is' : 'are'}
                {alumniTotals.gone > 0 && (
                  <> · <strong>{alumniTotals.gone}</strong>{' '}
                    {alumniTotals.gone === 1 ? 'no longer exists' : 'no longer exist'}</>
                )}
              </p>

              <ul className="org-member-list">
                {alumni.map(a => (
                  <li
                    key={a.org_id}
                    className={`org-member-row org-dir-row fc-alumni-row${a.exists_now ? '' : ' fc-alumni-row--gone'}`}
                  >
                    <span className="org-dir-info">
                      <span className="org-member-email">
                        <Building2 size={13} />
                        <strong>{a.org_name || 'Unnamed workspace'}</strong>
                        {/* The headline case: this workspace is gone, and this
                            row is the only remaining record of what it was. */}
                        {!a.exists_now && <Badge tone="danger" icon={<Trash2 size={11} />}>workspace deleted</Badge>}
                        {a.still_on && <Badge tone="success">still on {planLabelOf(alumniPlan)}</Badge>}
                        {a.exists_now && !a.still_on && a.current_plan && (
                          <Badge tone="neutral">now on {planLabelOf(a.current_plan)}</Badge>
                        )}
                      </span>
                      <span className="org-dir-stats">
                        on {planLabelOf(alumniPlan)} from {fmtDate(a.first_on)}
                        {a.still_on ? ' — and still is' : ` until ${fmtDate(a.last_on)}`}
                      </span>
                      <span className="beta-request-dates">
                        {a.created_at ? `workspace created ${fmtDate(a.created_at)}` : 'creation date not recorded'}
                        {' · '}id {a.org_id.slice(0, 8)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ))}
        </TabPanel>

        {/* ── Users ────────────────────────────────────────────────────────── */}
        <TabPanel value="users">
          <FoundingUsersTab
            users={users}
            orgOptions={orgOptions}
            myUserId={myUserId}
            busy={busy}
            onSetMembership={handleSetMembership}
            onRemoveMembership={handleRemoveMembership}
            onMoveUser={handleMoveUser}
          />
        </TabPanel>
      </Tabs>
    </div>
  );
}
