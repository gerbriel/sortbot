import { useEffect, useMemo, useState } from 'react';
import {
  Building2, Check, ChevronDown, ChevronRight, ClipboardList, History, LayoutDashboard,
  Mail, Pencil, PlusCircle, RotateCcw, Search, Trash2, UserCog, Users, X,
} from 'lucide-react';
import {
  Badge, Button, ConfirmAction, EmptyState, Skeleton,
  SelectField, StatGrid, StatTile, Tab, TabList, TabPanel, Tabs, TextField,
} from './ui';
import FoundingUsersTab from './FoundingUsersTab';
import {
  fetchBetaSignups, setBetaStatus, deleteBetaSignup, fetchBetaOrgDirectory,
  type BetaSignupRow, type BetaOrgDirectoryRow,
} from '../lib/betaService';
import {
  fetchAllUsers, fetchFoundingAudit, setMembership, removeMembership, moveUser,
  createWorkspace, setOrgPlan, renameOrg, inviteMember, fetchOrgDetail,
  ORG_PLANS, isOrgPlan,
  type FoundingUserRow, type FoundingAuditRow, type OrgDetail, type OrgDetailResult, type OrgPlan,
  type FounderFailure,
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

type ConsoleTab = 'overview' | 'requests' | 'workspaces' | 'onboard' | 'users';
type BetaFilter = 'pending' | 'approved' | 'denied' | 'all';
/** 'unknown' until the first founder_console.sql RPC answers. Only
 *  'unavailable' renders the setup line — 'error' and 'forbidden' are already
 *  reported as a notice by whatever call produced them. */
type ConsoleStatus = 'unknown' | 'ok' | FounderFailure;

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

const PLAN_OPTIONS = ORG_PLANS.map(p => ({ value: p, label: p }));

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

  /** Re-read everything after a write. Never called during render. */
  const reload = async () => {
    const [s, d, u, a] = await Promise.all([
      fetchBetaSignups(), fetchBetaOrgDirectory(), fetchAllUsers(), fetchFoundingAudit(),
    ]);
    applyLoad(s, d, u, a);
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
      const [s, d, u, a] = await Promise.all([
        fetchBetaSignups(), fetchBetaOrgDirectory(), fetchAllUsers(), fetchFoundingAudit(),
      ]);
      if (cancelled) return;
      applyLoad(s, d, u, a);
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

  const toggleOrg = (orgId: string) => {
    const next = expandedOrg === orgId ? null : orgId;
    setExpandedOrg(next);
    if (next && !detail[next]) void loadDetail(next);
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

  const handleSetPlan = async (orgId: string, plan: string) => {
    if (busy || !isOrgPlan(plan)) return;
    setBusy(true);
    setNotice(null);
    const res = await setOrgPlan(orgId, plan);
    setNotice(res.ok ? `${orgNameOf(orgId)} is on the ${plan} plan.` : (res.error ?? 'Could not change that plan.'));
    if (res.ok) {
      setPlanDraft(d => { const n = { ...d }; delete n[orgId]; return n; });
      await reload();
      await loadDetail(orgId);
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

  return (
    <div className="fc-view">
      {notice && <div className="org-panel-notice">{notice}</div>}
      {setupHint}

      <Tabs value={tab} onValueChange={(v) => setTab(v as ConsoleTab)}>
        <TabList label="Founder console sections" appearance="underline">
          <Tab value="overview" icon={<LayoutDashboard size={14} />}>Overview</Tab>
          <Tab value="requests" icon={<ClipboardList size={14} />} count={betaCounts.pending}>Requests</Tab>
          <Tab value="workspaces" icon={<Building2 size={14} />} count={orgs.length}>Workspaces</Tab>
          <Tab value="onboard" icon={<PlusCircle size={14} />}>Onboard</Tab>
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
                                {ORG_PLANS.map(p => <option key={p} value={p}>{p}</option>)}
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
              options={PLAN_OPTIONS}
              hint="Beta shops keep founding pricing for life, so leave this on beta unless they are paying today."
              onChange={(e) => { if (isOrgPlan(e.target.value)) setNewPlan(e.target.value); }}
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
