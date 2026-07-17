import { useEffect, useMemo, useState } from 'react';
import { Users, X, Pencil, Check, Copy, LogOut, Trash2, RotateCcw, Mail, Search, ChevronRight, ChevronDown, Building2, ShoppingBag, UserCog, History } from 'lucide-react';
import {
  fetchOrgMembers, fetchOrgInvites, inviteToOrg, revokeInvite, removeMember,
  renameOrganization, updateMemberRole, fetchMemberActivity,
  type Organization, type OrgRole, type OrgMemberRow, type OrgInviteRow, type MemberActivity,
} from '../lib/orgService';
import {
  fetchBetaSignups, setBetaStatus, deleteBetaSignup, fetchBetaOrgDirectory,
  type BetaSignupRow, type BetaOrgDirectoryRow,
} from '../lib/betaService';
import {
  fetchAllUsers, setMembership, removeMembership, moveUser, fetchFoundingAudit,
  type FoundingUserRow, type FoundingAuditRow,
} from '../lib/foundingAdminService';
import {
  getShopifyConnection, saveShopifyConnection, deleteShopifyConnection,
  type ShopifyConnectionStatus,
} from '../lib/shopifyConnectionService';
import {
  getOrgDescriptionSettings, saveOrgDescriptionSettings,
  DEFAULT_DESCRIPTION_SETTINGS, type DescriptionSettings,
} from '../lib/descriptionSettings';
import './OrgPanel.css';

interface OrgPanelProps {
  org: Organization;
  myRole: OrgRole;
  myUserId: string;
  onClose: () => void;
  /** Fired after a successful rename so App can refresh the header button. */
  onOrgUpdated?: (org: Organization) => void;
  /** Fired when the signed-in user's own role changes (promote/demote self). */
  onMyRoleChanged?: (role: OrgRole) => void;
  /** Fired after the user leaves the workspace — App should re-bootstrap. */
  onLeftWorkspace?: () => void;
  /** Fired after description format settings are saved so App can refresh
   *  what it passes to Step 3's generator. */
  onDescriptionSettingsChanged?: (settings: DescriptionSettings) => void;
}

type BetaFilter = 'pending' | 'approved' | 'denied' | 'all';

const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : null;

/**
 * Workspace panel — members with role management, email invites (join on next
 * sign-in), workspace rename, leave workspace, and (Founding admins only) the
 * beta request queue with approve/deny/reopen/delete, filtering, and search.
 */
export default function OrgPanel({ org, myRole, myUserId, onClose, onOrgUpdated, onMyRoleChanged, onLeftWorkspace, onDescriptionSettingsChanged }: OrgPanelProps) {
  const [members, setMembers] = useState<OrgMemberRow[]>([]);
  const [invites, setInvites] = useState<OrgInviteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<OrgRole>('member');
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Dashboard tabs — Members (everyone), Settings (org admins),
  // Beta program + Users (Founding admins)
  const [panelTab, setPanelTab] = useState<'members' | 'settings' | 'beta' | 'users'>('members');
  // Inline two-step confirm (no native confirm() — Do Not #12). Holds a key
  // like `remove:<userId>`, `leave`, or `beta-delete:<id>`; second click acts.
  const [confirmKey, setConfirmKey] = useState<string | null>(null);

  // Workspace rename
  const [displayName, setDisplayName] = useState(org.name);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(org.name);
  useEffect(() => { setDisplayName(org.name); }, [org.name]);

  const isAdmin = myRole === 'owner' || myRole === 'admin';
  const isOwner = myRole === 'owner';
  const ownerCount = members.filter(m => m.role === 'owner').length;
  // Leaving is blocked for the last owner and for the only member (their data
  // would be stranded in a workspace nobody can reach).
  const canLeave = members.length > 1 && !(isOwner && ownerCount <= 1);

  // Beta waitlist management lives with the Founding Workspace admins only.
  const isBetaAdmin = isAdmin && org.slug === 'founding';
  const [betaSignups, setBetaSignups] = useState<BetaSignupRow[]>([]);
  const [betaFilter, setBetaFilter] = useState<BetaFilter>('all');
  const [betaSearch, setBetaSearch] = useState('');
  // Aggregate directory of ALL workspaces (Founding admins; empty pre-migration)
  const [betaOrgs, setBetaOrgs] = useState<BetaOrgDirectoryRow[]>([]);

  // Cross-workspace user management (Founding admins; empty until
  // founding_user_admin.sql is run, which hides the Users tab entirely).
  const [allUsers, setAllUsers] = useState<FoundingUserRow[]>([]);
  const [audit, setAudit] = useState<FoundingAuditRow[]>([]);
  const [userSearch, setUserSearch] = useState('');
  // Pending move, keyed `${userId}:${fromOrgId}` → target org id. Picking a
  // destination arms the confirm; it does not move anyone on its own.
  const [moveDraft, setMoveDraft] = useState<Record<string, string>>({});
  // Pending "add to workspace", keyed by user id.
  const [addDraft, setAddDraft] = useState<Record<string, { orgId: string; role: OrgRole }>>({});

  // Click-to-expand member details (activity fetched lazily per member)
  const [expandedMemberId, setExpandedMemberId] = useState<string | null>(null);
  const [memberActivity, setMemberActivity] = useState<Record<string, MemberActivity | 'loading'>>({});

  // Per-org Shopify connection (token is write-only — see shopifyConnectionService)
  const [shopifyConn, setShopifyConn] = useState<ShopifyConnectionStatus | null>(null);
  const [shopifyDomain, setShopifyDomain] = useState('');
  const [shopifyToken, setShopifyToken] = useState('');
  const [editingShopify, setEditingShopify] = useState(false);

  // Listing description format (loaded ONCE — action reloads must not clobber
  // unsaved edits in the form below)
  const [descLoaded, setDescLoaded] = useState(false);
  const [descSymbol, setDescSymbol] = useState(DEFAULT_DESCRIPTION_SETTINGS.measurementPrefix);
  const [descWashing, setDescWashing] = useState(DEFAULT_DESCRIPTION_SETTINGS.washingLine);
  const [descClosing, setDescClosing] = useState(DEFAULT_DESCRIPTION_SETTINGS.closingLine);
  const [descDisclaimers, setDescDisclaimers] = useState(DEFAULT_DESCRIPTION_SETTINGS.disclaimerLines.join('\n'));
  const [descHashtags, setDescHashtags] = useState(DEFAULT_DESCRIPTION_SETTINGS.includeHashtags);
  const [descVendor, setDescVendor] = useState(DEFAULT_DESCRIPTION_SETTINGS.vendorName);
  const [descProseEnabled, setDescProseEnabled] = useState(DEFAULT_DESCRIPTION_SETTINGS.proseEnabled);
  const [descProseStyle, setDescProseStyle] = useState(DEFAULT_DESCRIPTION_SETTINGS.proseStyle);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    getOrgDescriptionSettings(org.id).then(s => {
      if (cancelled) return;
      setDescSymbol(s.measurementPrefix);
      setDescWashing(s.washingLine);
      setDescClosing(s.closingLine);
      setDescDisclaimers(s.disclaimerLines.join('\n'));
      setDescHashtags(s.includeHashtags);
      setDescVendor(s.vendorName);
      setDescProseEnabled(s.proseEnabled);
      setDescProseStyle(s.proseStyle);
      setDescLoaded(true);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [org.id]);

  const handleSaveDescSettings = async () => {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    const settings: DescriptionSettings = {
      measurementPrefix: descSymbol.trim() || DEFAULT_DESCRIPTION_SETTINGS.measurementPrefix,
      washingLine: descWashing.trim(),
      closingLine: descClosing.trim(),
      includeHashtags: descHashtags,
      vendorName: descVendor.trim(),
      proseEnabled: descProseEnabled,
      proseStyle: descProseStyle.trim(),
      disclaimerLines: descDisclaimers.split('\n').map(l => l.trim()).filter(Boolean),
    };
    const res = await saveOrgDescriptionSettings(org.id, settings);
    if (res.ok) {
      setNotice('Description format saved — it applies to every listing this workspace generates from now on.');
      onDescriptionSettingsChanged?.(settings);
    } else {
      setNotice(`Save failed: ${res.error}`);
    }
    setBusy(false);
  };

  const handleResetDescSettings = () => {
    setDescSymbol(DEFAULT_DESCRIPTION_SETTINGS.measurementPrefix);
    setDescWashing(DEFAULT_DESCRIPTION_SETTINGS.washingLine);
    setDescClosing(DEFAULT_DESCRIPTION_SETTINGS.closingLine);
    setDescDisclaimers(DEFAULT_DESCRIPTION_SETTINGS.disclaimerLines.join('\n'));
    setDescHashtags(DEFAULT_DESCRIPTION_SETTINGS.includeHashtags);
    setDescVendor(DEFAULT_DESCRIPTION_SETTINGS.vendorName);
    setDescProseEnabled(DEFAULT_DESCRIPTION_SETTINGS.proseEnabled);
    setDescProseStyle(DEFAULT_DESCRIPTION_SETTINGS.proseStyle);
    setNotice('Reset to the default format — click Save format to apply it.');
  };

  const toggleMember = (userId: string) => {
    const next = expandedMemberId === userId ? null : userId;
    setExpandedMemberId(next);
    if (next && !memberActivity[next]) {
      setMemberActivity(prev => ({ ...prev, [next]: 'loading' }));
      fetchMemberActivity(next).then(act =>
        setMemberActivity(prev => ({ ...prev, [next]: act }))
      );
    }
  };

  const reload = async (silent = false) => {
    if (!silent) setLoading(true);
    const [m, i, b, dirs, shp, users, aud] = await Promise.all([
      fetchOrgMembers(org.id),
      fetchOrgInvites(org.id),
      isBetaAdmin ? fetchBetaSignups() : Promise.resolve([] as BetaSignupRow[]),
      isBetaAdmin ? fetchBetaOrgDirectory() : Promise.resolve([] as BetaOrgDirectoryRow[]),
      isAdmin ? getShopifyConnection(org.id) : Promise.resolve<ShopifyConnectionStatus>({ status: 'none' }),
      isBetaAdmin ? fetchAllUsers() : Promise.resolve([] as FoundingUserRow[]),
      isBetaAdmin ? fetchFoundingAudit() : Promise.resolve([] as FoundingAuditRow[]),
    ]);
    setMembers(m);
    setInvites(isAdmin ? i : []);
    setBetaSignups(b);
    setBetaOrgs(dirs);
    setShopifyConn(shp);
    setAllUsers(users);
    setAudit(aud);
    setLoading(false);
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [org.id]);

  const appUrl = `${window.location.origin}${import.meta.env.BASE_URL || '/'}`;

  // ── Workspace rename ──────────────────────────────────────────────────────
  const handleRenameSave = async () => {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    const res = await renameOrganization(org.id, nameDraft);
    if (res.ok) {
      const cleaned = nameDraft.trim();
      setDisplayName(cleaned);
      setEditingName(false);
      setNotice('Workspace renamed.');
      onOrgUpdated?.({ ...org, name: cleaned });
    } else {
      setNotice(`Rename failed: ${res.error}`);
    }
    setBusy(false);
  };

  // ── Members ───────────────────────────────────────────────────────────────
  const handleRoleChange = async (m: OrgMemberRow, newRole: OrgRole) => {
    if (busy || newRole === m.role) return;
    if (m.role === 'owner' && newRole !== 'owner' && ownerCount <= 1) {
      setNotice('A workspace needs at least one owner. Make someone else an owner first.');
      return;
    }
    setBusy(true);
    setNotice(null);
    const ok = await updateMemberRole(org.id, m.user_id, newRole);
    if (!ok) {
      setNotice('Role change failed — you may not have permission.');
    } else {
      setNotice(`${m.email || 'Member'} is now ${newRole === 'owner' ? 'an owner' : newRole === 'admin' ? 'an admin' : 'a member'}.`);
      if (m.user_id === myUserId) onMyRoleChanged?.(newRole);
    }
    await reload(true);
    setBusy(false);
  };

  const handleRemove = async (userId: string) => {
    if (busy) return;
    setBusy(true);
    setConfirmKey(null);
    const ok = await removeMember(org.id, userId);
    if (!ok) setNotice('Remove failed — you may not have permission.');
    await reload(true);
    setBusy(false);
  };

  const handleLeave = async () => {
    if (busy) return;
    setBusy(true);
    setConfirmKey(null);
    const ok = await removeMember(org.id, myUserId);
    setBusy(false);
    if (ok) {
      onLeftWorkspace?.();
      onClose();
    } else {
      setNotice('Could not leave the workspace — try again.');
    }
  };

  // ── Invites ───────────────────────────────────────────────────────────────
  const handleInvite = async () => {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    const res = await inviteToOrg(org.id, inviteEmail, inviteRole);
    if (res.ok) {
      setNotice(`Invited ${inviteEmail.trim().toLowerCase()}. No email is sent automatically — use the copy button next to the invite to send them the link.`);
      setInviteEmail('');
      await reload(true);
    } else {
      setNotice(`Invite failed: ${res.error}`);
    }
    setBusy(false);
  };

  const handleRevoke = async (inviteId: string) => {
    if (busy) return;
    setBusy(true);
    await revokeInvite(inviteId);
    await reload(true);
    setBusy(false);
  };

  const handleCopyInvite = async (inv: OrgInviteRow) => {
    const msg = `You're invited to the "${displayName}" workspace on Sortbot.\n\nSign in (or create an account) at ${appUrl} using this email address: ${inv.email}\n\nYou'll join the workspace automatically.`;
    try {
      await navigator.clipboard.writeText(msg);
      setNotice('Invite message copied. Paste it into an email or text to your teammate.');
    } catch {
      setNotice(msg); // clipboard blocked — surface the text so it can be copied manually
    }
  };

  // ── Shopify connection ────────────────────────────────────────────────────
  const handleShopifySave = async () => {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    const res = await saveShopifyConnection(org.id, shopifyDomain, shopifyToken);
    if (res.ok) {
      setNotice('Shopify connected. CSV exports now check titles against this store’s catalog.');
      setShopifyToken('');
      setEditingShopify(false);
      setShopifyConn(await getShopifyConnection(org.id));
    } else {
      setNotice(`Shopify connection failed: ${res.error}`);
    }
    setBusy(false);
  };

  const handleShopifyDisconnect = async () => {
    if (busy) return;
    setBusy(true);
    setConfirmKey(null);
    const ok = await deleteShopifyConnection(org.id);
    if (ok) {
      setNotice('Shopify disconnected. Exports fall back to checking the app database only.');
      setShopifyConn({ status: 'none' });
    } else {
      setNotice('Disconnect failed — check your permissions.');
    }
    setBusy(false);
  };

  // ── Beta requests ─────────────────────────────────────────────────────────
  const handleBetaDecision = async (id: string, status: 'approved' | 'denied' | 'pending') => {
    if (busy) return;
    setBusy(true);
    const ok = await setBetaStatus(id, status);
    if (!ok) setNotice('Could not update the request — check your permissions.');
    else if (status === 'approved') setNotice('Approved ✓ — their workspace is created automatically the next time they sign in. Use the mail button to send them a welcome note.');
    else if (status === 'denied') setNotice('Denied — they will see the “at capacity” message.');
    else setNotice('Moved back to pending. If they already signed in and got a workspace, it stays — the gate only applies before the first sign-in.');
    await reload(true);
    setBusy(false);
  };

  const handleBetaDelete = async (id: string) => {
    if (busy) return;
    setBusy(true);
    setConfirmKey(null);
    const ok = await deleteBetaSignup(id);
    if (!ok) setNotice('Delete failed — check your permissions.');
    await reload(true);
    setBusy(false);
  };

  const mailtoWelcome = (s: BetaSignupRow) => {
    const subject = encodeURIComponent('Your Sortbot beta access is ready');
    const body = encodeURIComponent(
      `Hi ${s.contact_name},\n\nYour beta request for ${s.org_name} is approved. Sign in at ${appUrl} with this email address and your workspace will be ready.\n\nWelcome aboard!`
    );
    return `mailto:${s.email}?subject=${subject}&body=${body}`;
  };

  // ── Cross-workspace user management (Founding admins) ─────────────────────
  // Every workspace we can offer as a move/add destination. Sourced from the
  // aggregate directory, with any org seen on a membership folded in so the
  // dropdowns still work if beta_org_directory() is unavailable.
  const orgOptions = useMemo(() => {
    const map = new Map<string, string>();
    betaOrgs.forEach(o => map.set(o.org_id, o.name));
    allUsers.forEach(u => u.memberships.forEach(ms => {
      if (!map.has(ms.org_id)) map.set(ms.org_id, ms.org_name);
    }));
    return [...map].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [betaOrgs, allUsers]);

  const orgNameOf = (id: string) => orgOptions.find(o => o.id === id)?.name ?? 'that workspace';

  const uq = userSearch.trim().toLowerCase();
  const matchingUsers = allUsers.filter(u =>
    !uq || (u.email ?? '').toLowerCase().includes(uq)
        || u.memberships.some(ms => ms.org_name.toLowerCase().includes(uq))
  );
  const USER_RENDER_CAP = 50;
  const visibleUsers = matchingUsers.slice(0, USER_RENDER_CAP);

  const clearMoveDraft = (key: string) =>
    setMoveDraft(d => { const n = { ...d }; delete n[key]; return n; });

  const handleSetMembership = async (u: FoundingUserRow, orgId: string, role: OrgRole) => {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    const res = await setMembership(u.user_id, orgId, role);
    if (res.ok) {
      setNotice(`${u.email ?? 'That user'} is now ${role} in ${orgNameOf(orgId)}.`);
      // Keep the header badge honest if they just changed their own role here.
      if (u.user_id === myUserId && orgId === org.id) onMyRoleChanged?.(role);
    } else {
      setNotice(`Role change failed: ${res.error}`);
    }
    await reload(true);
    setBusy(false);
  };

  const handleAddToOrg = async (u: FoundingUserRow) => {
    const draft = addDraft[u.user_id];
    if (busy || !draft?.orgId) return;
    setBusy(true);
    setNotice(null);
    const res = await setMembership(u.user_id, draft.orgId, draft.role);
    setNotice(res.ok
      ? `Added ${u.email ?? 'that user'} to ${orgNameOf(draft.orgId)} as ${draft.role}. They'll see it next time they sign in.`
      : `Add failed: ${res.error}`);
    setAddDraft(d => { const n = { ...d }; delete n[u.user_id]; return n; });
    await reload(true);
    setBusy(false);
  };

  const handleRemoveMembership = async (u: FoundingUserRow, orgId: string) => {
    if (busy) return;
    setBusy(true);
    setConfirmKey(null);
    setNotice(null);
    const res = await removeMembership(u.user_id, orgId);
    setNotice(res.ok
      ? `Removed ${u.email ?? 'that user'} from ${orgNameOf(orgId)}. That workspace keeps all of its batches and products.`
      : `Remove failed: ${res.error}`);
    await reload(true);
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
    clearMoveDraft(`${u.user_id}:${fromOrgId}`);
    await reload(true);
    setBusy(false);
  };

  const auditSummary = (a: FoundingAuditRow) => {
    const who = a.target_email ?? 'a user';
    switch (a.action) {
      case 'add_member':    return `added ${who} to ${a.to_org_name} as ${a.role}`;
      case 'set_role':      return `made ${who} ${a.role} in ${a.to_org_name}`;
      case 'remove_member': return `removed ${who} from ${a.from_org_name}`;
      case 'move_user':     return `moved ${who} from ${a.from_org_name} to ${a.to_org_name}`;
      default:              return `${a.action} ${who}`;
    }
  };

  const betaCounts = {
    pending: betaSignups.filter(s => s.status === 'pending').length,
    approved: betaSignups.filter(s => s.status === 'approved').length,
    denied: betaSignups.filter(s => s.status === 'denied').length,
  };
  const q = betaSearch.trim().toLowerCase();
  const visibleSignups = betaSignups
    .filter(s => betaFilter === 'all' || s.status === betaFilter)
    .filter(s => !q || [s.org_name, s.contact_name, s.email, s.store_url ?? ''].some(v => v.toLowerCase().includes(q)))
    .sort((a, b) => {
      if ((a.status === 'pending') !== (b.status === 'pending')) return a.status === 'pending' ? -1 : 1;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

  return (
    <div className="org-panel-overlay" onClick={onClose}>
      <div className="org-panel" onClick={(e) => e.stopPropagation()}>
        <div className="org-panel-header">
          <div className="org-panel-title">
            <Users size={20} />
            {editingName ? (
              <span className="org-rename-form">
                <input
                  value={nameDraft}
                  maxLength={60}
                  autoFocus
                  onChange={(e) => setNameDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleRenameSave();
                    if (e.key === 'Escape') setEditingName(false);
                  }}
                />
                <button className="org-icon-btn" title="Save name" disabled={busy || !nameDraft.trim()} onClick={handleRenameSave}><Check size={14} /></button>
                <button className="org-icon-btn" title="Cancel" disabled={busy} onClick={() => setEditingName(false)}><X size={14} /></button>
              </span>
            ) : (
              <>
                <h2>{displayName}</h2>
                {org.plan && org.plan !== 'free' && <span className="org-plan-badge">{org.plan}</span>}
                {isAdmin && (
                  <button className="org-icon-btn" title="Rename workspace"
                    onClick={() => { setNameDraft(displayName); setEditingName(true); }}>
                    <Pencil size={13} />
                  </button>
                )}
              </>
            )}
            <span className={`org-role-badge org-role-${myRole}`}>{myRole}</span>
          </div>
          <button className="org-panel-close" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>

        {notice && <div className="org-panel-notice">{notice}</div>}

        <div className="org-tabs">
          <button className={`org-tab ${panelTab === 'members' ? 'org-tab--on' : ''}`} onClick={() => setPanelTab('members')}>
            Members ({members.length})
          </button>
          {isAdmin && (
            <button className={`org-tab ${panelTab === 'settings' ? 'org-tab--on' : ''}`} onClick={() => setPanelTab('settings')}>
              Settings
            </button>
          )}
          {isBetaAdmin && (
            <button className={`org-tab ${panelTab === 'beta' ? 'org-tab--on' : ''}`} onClick={() => setPanelTab('beta')}>
              Beta program{betaCounts.pending > 0 ? ` (${betaCounts.pending})` : ''}
            </button>
          )}
          {/* Hidden until founding_user_admin.sql is run — the RPC returns zero
              rows before that, and there is always at least one user after. */}
          {isBetaAdmin && allUsers.length > 0 && (
            <button className={`org-tab ${panelTab === 'users' ? 'org-tab--on' : ''}`} onClick={() => setPanelTab('users')}>
              Users ({allUsers.length})
            </button>
          )}
        </div>

        {isAdmin && panelTab === 'members' && (
          <div className="org-invite-form">
            <input
              type="email"
              placeholder="teammate@email.com"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleInvite(); }}
            />
            <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value as OrgRole)}>
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
            <button className="org-invite-btn" disabled={busy || !inviteEmail.trim()} onClick={handleInvite}>
              Invite
            </button>
          </div>
        )}

        {panelTab === 'members' && (loading ? (
          <p className="org-panel-loading">Loading members…</p>
        ) : (
          <>
            <h3 className="org-section-title">Members ({members.length})</h3>
            <ul className="org-member-list">
              {members.map(m => {
                const expanded = expandedMemberId === m.user_id;
                const act = memberActivity[m.user_id];
                const signup = isBetaAdmin && m.email
                  ? betaSignups.find(s => s.email.toLowerCase() === m.email!.toLowerCase())
                  : undefined;
                return (
                  <li key={m.user_id} className="org-member-row org-member-row--expandable">
                    <div className="org-member-head">
                      <button
                        className="org-member-toggle"
                        title={expanded ? 'Hide details' : 'Show details'}
                        onClick={() => toggleMember(m.user_id)}
                      >
                        {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                      </button>
                      <span className="org-member-email" role="button" onClick={() => toggleMember(m.user_id)}>
                        {m.email || m.user_id.slice(0, 8)}{m.user_id === myUserId ? ' (you)' : ''}
                        <span className="org-member-date">joined {fmtDate(m.created_at)}</span>
                      </span>
                      {isAdmin && (isOwner || m.role !== 'owner') ? (
                        <select
                          className="org-role-select"
                          value={m.role}
                          disabled={busy}
                          title="Change role"
                          onChange={(e) => handleRoleChange(m, e.target.value as OrgRole)}
                        >
                          {isOwner && <option value="owner">Owner</option>}
                          <option value="admin">Admin</option>
                          <option value="member">Member</option>
                        </select>
                      ) : (
                        <span className={`org-role-badge org-role-${m.role}`}>{m.role}</span>
                      )}
                      {isAdmin && m.user_id !== myUserId && (
                        confirmKey === `remove:${m.user_id}` ? (
                          <span className="org-confirm-actions">
                            <button className="org-confirm-yes" disabled={busy} onClick={() => handleRemove(m.user_id)}>Confirm</button>
                            <button className="org-confirm-no" disabled={busy} onClick={() => setConfirmKey(null)}>Cancel</button>
                          </span>
                        ) : (
                          <button className="org-member-remove" disabled={busy} title="Remove from workspace"
                            onClick={() => setConfirmKey(`remove:${m.user_id}`)}>Remove</button>
                        )
                      )}
                    </div>
                    {expanded && (
                      <div className="org-member-detail">
                        {act === 'loading' || !act ? (
                          <span className="org-member-detail-loading">Loading activity…</span>
                        ) : (
                          <div className="org-member-stats">
                            <span><strong>{act.batchCount}</strong> batch{act.batchCount === 1 ? '' : 'es'} created</span>
                            <span><strong>{act.productCount}</strong> product{act.productCount === 1 ? '' : 's'} created</span>
                            <span>last active {act.lastActive ? fmtDate(act.lastActive) : 'no activity yet'}</span>
                          </div>
                        )}
                        {signup && (
                          <div className="org-member-signup">
                            Beta application: <strong>{signup.org_name}</strong> · {signup.contact_name}
                            {signup.store_url ? <> · {signup.store_url}</> : null}
                            {signup.volume ? <> · {signup.volume}/wk</> : null}
                            {signup.notes ? <> · “{signup.notes}”</> : null}
                            <span className={`org-role-badge beta-status-${signup.status}`}>{signup.status}</span>
                          </div>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>

            {isAdmin && invites.length > 0 && (
              <>
                <h3 className="org-section-title">Pending invites ({invites.length})</h3>
                <ul className="org-member-list">
                  {invites.map(inv => (
                    <li key={inv.id} className="org-member-row">
                      <span className="org-member-email">
                        {inv.email}
                        <span className="org-member-date">invited {fmtDate(inv.created_at)}</span>
                      </span>
                      <span className={`org-role-badge org-role-${inv.role}`}>{inv.role}</span>
                      <button className="org-icon-btn" title="Copy invite message to send them" disabled={busy}
                        onClick={() => handleCopyInvite(inv)}><Copy size={13} /></button>
                      <button className="org-member-remove" disabled={busy} title="Revoke invite"
                        onClick={() => handleRevoke(inv.id)}>Revoke</button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        ))}

        {panelTab === 'settings' && isAdmin && !loading && shopifyConn && shopifyConn.status !== 'unavailable' && (
          <>
            <h3 className="org-section-title">Shopify connection</h3>
            {shopifyConn.status === 'connected' && !editingShopify ? (
              <div className="shopify-conn-row">
                <span className="org-member-email">
                  <ShoppingBag size={13} /> <strong>{shopifyConn.info.store_domain}</strong>
                  <span className="org-member-date">
                    connected {fmtDate(shopifyConn.info.updated_at)} · token stored server side, never shown again
                  </span>
                </span>
                <button className="org-icon-btn" title="Replace store or token" disabled={busy}
                  onClick={() => {
                    setShopifyDomain(shopifyConn.info.store_domain);
                    setShopifyToken('');
                    setEditingShopify(true);
                  }}><Pencil size={13} /></button>
                {confirmKey === 'shopify-disconnect' ? (
                  <span className="org-confirm-actions">
                    <button className="org-confirm-yes" disabled={busy} onClick={handleShopifyDisconnect}>Disconnect</button>
                    <button className="org-confirm-no" disabled={busy} onClick={() => setConfirmKey(null)}>Cancel</button>
                  </span>
                ) : (
                  <button className="org-member-remove" disabled={busy} title="Disconnect this store"
                    onClick={() => setConfirmKey('shopify-disconnect')}>Disconnect</button>
                )}
              </div>
            ) : (
              <div className="shopify-conn-form">
                <p className="shopify-conn-help">
                  Connect your store so CSV exports check for title collisions against your own catalog
                  and carry your store’s color, fabric, and gender metafield ids.
                  In Shopify: Settings → Apps and sales channels → Develop apps → create an app with the
                  <strong> read_products</strong> and <strong>read_metaobjects</strong> scopes, then paste
                  the Admin API token here. The token is stored server side and can never be read back
                  from the browser.
                </p>
                <div className="org-invite-form">
                  <input
                    placeholder="my-store.myshopify.com"
                    value={shopifyDomain}
                    onChange={(e) => setShopifyDomain(e.target.value)}
                  />
                  <input
                    type="password"
                    placeholder="shpat_…"
                    autoComplete="off"
                    value={shopifyToken}
                    onChange={(e) => setShopifyToken(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleShopifySave(); }}
                  />
                  <button className="org-invite-btn" disabled={busy || !shopifyDomain.trim() || !shopifyToken.trim()}
                    onClick={handleShopifySave}>Connect</button>
                  {editingShopify && (
                    <button className="org-confirm-no" disabled={busy} onClick={() => setEditingShopify(false)}>Cancel</button>
                  )}
                </div>
              </div>
            )}
          </>
        )}

        {panelTab === 'settings' && isAdmin && !loading && descLoaded && (
          <>
            <h3 className="org-section-title">Listing description format</h3>
            <p className="shopify-conn-help">
              How generated descriptions read for everyone in this workspace.
              Leave a line empty to leave it out of your descriptions.
            </p>
            <div className="desc-settings-form">
              <label className="desc-settings-field">
                <span>Vendor name (Shopify CSV Vendor column — your shop, not the garment brand)</span>
                <input value={descVendor} placeholder={org.slug === 'founding' ? 'C&D Vintage' : org.name}
                  onChange={(e) => setDescVendor(e.target.value)} />
              </label>
              <label className="desc-settings-field desc-settings-field--narrow">
                <span>Measurement symbol</span>
                <input value={descSymbol} maxLength={4}
                  onChange={(e) => setDescSymbol(e.target.value)} />
              </label>
              <label className="desc-settings-field">
                <span>Garment prep line</span>
                <input value={descWashing} placeholder="e.g. All items washed before shipping"
                  onChange={(e) => setDescWashing(e.target.value)} />
              </label>
              <label className="desc-settings-field">
                <span>Closing line</span>
                <input value={descClosing} placeholder="e.g. BUNDLE AND SAVE"
                  onChange={(e) => setDescClosing(e.target.value)} />
              </label>
              <label className="desc-settings-field">
                <span>Closing disclaimers (one per line)</span>
                <textarea rows={4} value={descDisclaimers}
                  onChange={(e) => setDescDisclaimers(e.target.value)} />
              </label>
              <label className="desc-settings-check">
                <input type="checkbox" checked={descHashtags}
                  onChange={(e) => setDescHashtags(e.target.checked)} />
                Include #hashtags at the end
              </label>
              <label className="desc-settings-check">
                <input type="checkbox" checked={descProseEnabled}
                  onChange={(e) => setDescProseEnabled(e.target.checked)} />
                Write a selling paragraph automatically (language model, checked before use;
                falls back to the plain keyword note if unavailable)
              </label>
              {descProseEnabled && (
                <label className="desc-settings-field">
                  <span>Selling paragraph voice (style notes for the writer)</span>
                  <textarea rows={2} value={descProseStyle}
                    placeholder="e.g. Punchy streetwear voice, short sentences, no fluff"
                    onChange={(e) => setDescProseStyle(e.target.value)} />
                </label>
              )}
              <div className="desc-settings-actions">
                <button className="org-invite-btn" disabled={busy} onClick={handleSaveDescSettings}>Save format</button>
                <button className="org-confirm-no" disabled={busy} onClick={handleResetDescSettings}>Reset to defaults</button>
              </div>
            </div>
          </>
        )}

        {panelTab === 'beta' && isBetaAdmin && !loading && (
          <>
            <h3 className="org-section-title">
              Beta requests ({betaCounts.pending} pending)
            </h3>
            {betaSignups.length === 0 ? (
              <p className="org-panel-loading">No requests yet — share the landing page with shops you want in.</p>
            ) : (
              <>
                <div className="beta-toolbar">
                  <div className="beta-filter-chips">
                    {(['pending', 'approved', 'denied', 'all'] as const).map(f => (
                      <button
                        key={f}
                        className={`beta-chip ${betaFilter === f ? 'beta-chip--active' : ''}`}
                        onClick={() => setBetaFilter(f)}
                      >
                        {f === 'all' ? `All ${betaSignups.length}` : `${f[0].toUpperCase()}${f.slice(1)} ${betaCounts[f]}`}
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
                          <strong>{s.org_name}</strong> · {s.contact_name} · <a className="beta-email-link" href={`mailto:${s.email}`}>{s.email}</a>
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
                            {s.status === 'approved' && (
                              <a className="org-icon-btn" href={mailtoWelcome(s)} title="Compose welcome email"><Mail size={13} /></a>
                            )}
                            <button className="org-icon-btn" title="Move back to pending" disabled={busy}
                              onClick={() => handleBetaDecision(s.id, 'pending')}><RotateCcw size={13} /></button>
                            {confirmKey === `beta-delete:${s.id}` ? (
                              <span className="org-confirm-actions">
                                <button className="org-confirm-yes" disabled={busy} onClick={() => handleBetaDelete(s.id)}>Delete</button>
                                <button className="org-confirm-no" disabled={busy} onClick={() => setConfirmKey(null)}>Cancel</button>
                              </span>
                            ) : (
                              <button className="org-icon-btn org-icon-danger" title="Delete request" disabled={busy}
                                onClick={() => setConfirmKey(`beta-delete:${s.id}`)}><Trash2 size={13} /></button>
                            )}
                          </>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}

        {panelTab === 'beta' && isBetaAdmin && !loading && betaOrgs.length > 0 && (
          <>
            <h3 className="org-section-title">
              Beta workspaces ({betaOrgs.length})
            </h3>
            <ul className="org-member-list">
              {betaOrgs.map(o => (
                <li key={o.org_id} className="org-member-row org-dir-row">
                  <div className="org-dir-info">
                    <span className="org-member-email">
                      <Building2 size={13} />
                      <strong>{o.name}</strong>
                      {o.slug === 'founding' && <span className="org-role-badge org-role-owner">founding</span>}
                      {o.plan && o.plan !== 'free' && <span className="org-plan-badge">{o.plan}</span>}
                    </span>
                    <span className="org-dir-stats">
                      {o.member_count} member{o.member_count === 1 ? '' : 's'} · {o.batch_count} batch{o.batch_count === 1 ? '' : 'es'} · {o.product_count} product{o.product_count === 1 ? '' : 's'} · {o.image_count} image{o.image_count === 1 ? '' : 's'}
                    </span>
                    {o.member_emails.length > 0 && (
                      <span className="org-dir-emails" title={o.member_emails.join(', ')}>
                        {o.member_emails.join(', ')}
                      </span>
                    )}
                    <span className="beta-request-dates">
                      created {fmtDate(o.created_at)}
                      {o.last_active ? ` · last active ${fmtDate(o.last_active)}` : ' · no activity yet'}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}

        {panelTab === 'users' && isBetaAdmin && !loading && (
          <>
            <h3 className="org-section-title">All users ({allUsers.length})</h3>
            <p className="shopify-conn-help">
              Every account across every workspace. Changing someone's workspace changes
              what they can open — their batches, products, and images stay with the
              workspace that has them today, so a move is always reversible by moving
              them back. Every change here is logged below with your name on it.
            </p>
            <div className="beta-toolbar">
              <div className="beta-search">
                <Search size={13} />
                <input
                  placeholder="Search by email or workspace"
                  value={userSearch}
                  onChange={(e) => setUserSearch(e.target.value)}
                />
              </div>
            </div>
            {matchingUsers.length === 0 && (
              <p className="org-panel-loading">Nobody matches that search.</p>
            )}
            <ul className="org-member-list">
              {visibleUsers.map(u => {
                const joinable = orgOptions.filter(o => !u.memberships.some(ms => ms.org_id === o.id));
                const draft = addDraft[u.user_id];
                return (
                  <li key={u.user_id} className="org-member-row fa-user-row">
                    <div className="fa-user-head">
                      <span className="org-member-email">
                        <UserCog size={13} />
                        <strong>{u.email ?? u.user_id.slice(0, 8)}</strong>
                        {u.user_id === myUserId ? ' (you)' : ''}
                        <span className="org-member-date">
                          signed up {fmtDate(u.created_at)}
                          {u.last_sign_in_at ? ` · last sign-in ${fmtDate(u.last_sign_in_at)}` : ' · never signed in'}
                        </span>
                      </span>
                      {u.memberships.length === 0 && (
                        <span className="org-role-badge beta-status-denied" title="Signed up but has no workspace — they see the waitlist screen.">
                          no workspace
                        </span>
                      )}
                    </div>

                    {u.memberships.length > 0 && (
                      <ul className="fa-membership-list">
                        {u.memberships.map(ms => {
                          const key = `${u.user_id}:${ms.org_id}`;
                          const target = moveDraft[key];
                          return (
                            <li key={ms.org_id} className="fa-membership-row">
                              <span className="fa-ms-org">
                                <Building2 size={12} />
                                {ms.org_name}
                                {ms.org_slug === 'founding' && (
                                  <span className="org-role-badge org-role-owner">founding</span>
                                )}
                              </span>
                              <select
                                className="org-role-select"
                                value={ms.role}
                                disabled={busy}
                                title="Change their role in this workspace"
                                onChange={(e) => handleSetMembership(u, ms.org_id, e.target.value as OrgRole)}
                              >
                                <option value="owner">Owner</option>
                                <option value="admin">Admin</option>
                                <option value="member">Member</option>
                              </select>
                              {target ? (
                                <span className="org-confirm-actions">
                                  <span className="fa-move-label">Move to {orgNameOf(target)}?</span>
                                  <button className="org-confirm-yes" disabled={busy}
                                    onClick={() => handleMoveUser(u, ms.org_id, target)}>Move</button>
                                  <button className="org-confirm-no" disabled={busy}
                                    onClick={() => clearMoveDraft(key)}>Cancel</button>
                                </span>
                              ) : (
                                <select
                                  className="fa-move-select"
                                  value=""
                                  disabled={busy || orgOptions.length < 2}
                                  title="Move them to another workspace"
                                  onChange={(e) => {
                                    if (e.target.value) setMoveDraft(d => ({ ...d, [key]: e.target.value }));
                                  }}
                                >
                                  <option value="">Move to…</option>
                                  {orgOptions.filter(o => o.id !== ms.org_id).map(o => (
                                    <option key={o.id} value={o.id}>{o.name}</option>
                                  ))}
                                </select>
                              )}
                              {confirmKey === `fa-remove:${key}` ? (
                                <span className="org-confirm-actions">
                                  <button className="org-confirm-yes" disabled={busy}
                                    onClick={() => handleRemoveMembership(u, ms.org_id)}>Remove</button>
                                  <button className="org-confirm-no" disabled={busy}
                                    onClick={() => setConfirmKey(null)}>Cancel</button>
                                </span>
                              ) : (
                                <button className="org-member-remove" disabled={busy}
                                  title="Remove them from this workspace"
                                  onClick={() => setConfirmKey(`fa-remove:${key}`)}>Remove</button>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    )}

                    {joinable.length > 0 && (
                      <div className="fa-add-row">
                        <select
                          value={draft?.orgId ?? ''}
                          disabled={busy}
                          onChange={(e) => setAddDraft(d => ({
                            ...d,
                            [u.user_id]: { orgId: e.target.value, role: d[u.user_id]?.role ?? 'member' },
                          }))}
                        >
                          <option value="">Add to workspace…</option>
                          {joinable.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                        </select>
                        <select
                          value={draft?.role ?? 'member'}
                          disabled={busy || !draft?.orgId}
                          onChange={(e) => setAddDraft(d => ({
                            ...d,
                            [u.user_id]: { orgId: d[u.user_id]?.orgId ?? '', role: e.target.value as OrgRole },
                          }))}
                        >
                          <option value="member">Member</option>
                          <option value="admin">Admin</option>
                          <option value="owner">Owner</option>
                        </select>
                        <button className="org-invite-btn" disabled={busy || !draft?.orgId}
                          onClick={() => handleAddToOrg(u)}>Add</button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            {matchingUsers.length > USER_RENDER_CAP && (
              <p className="org-panel-loading">
                Showing the first {USER_RENDER_CAP} of {matchingUsers.length} — search to narrow it down.
              </p>
            )}

            {audit.length > 0 && (
              <>
                <h3 className="org-section-title">
                  <History size={13} /> Recent user changes ({audit.length})
                </h3>
                <ul className="org-member-list fa-audit-list">
                  {audit.map(a => (
                    <li key={a.id} className="org-member-row fa-audit-row">
                      <span className="org-member-email">
                        <strong>{a.actor_email ?? 'someone'}</strong> {auditSummary(a)}
                        <span className="org-member-date">{fmtDate(a.created_at)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}

        {panelTab === 'members' && !loading && canLeave && (
          <div className="org-leave-section">
            {confirmKey === 'leave' ? (
              <span className="org-confirm-actions">
                <span className="org-leave-warning">You'll lose access to everything in this workspace.</span>
                <button className="org-confirm-yes" disabled={busy} onClick={handleLeave}>Leave workspace</button>
                <button className="org-confirm-no" disabled={busy} onClick={() => setConfirmKey(null)}>Cancel</button>
              </span>
            ) : (
              <button className="org-leave-btn" disabled={busy} onClick={() => setConfirmKey('leave')}>
                <LogOut size={13} /> Leave this workspace
              </button>
            )}
          </div>
        )}

        <p className="org-panel-footnote">
          Everyone in this workspace shares its batches, products, categories, and presets.
          People outside it can't see any of them.
        </p>
      </div>
    </div>
  );
}
