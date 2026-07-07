import { useEffect, useState } from 'react';
import { Users, X, Pencil, Check, Copy, LogOut, Trash2, RotateCcw, Mail, Search, ChevronRight, ChevronDown, Building2, ShoppingBag } from 'lucide-react';
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
  getShopifyConnection, saveShopifyConnection, deleteShopifyConnection,
  type ShopifyConnectionStatus,
} from '../lib/shopifyConnectionService';
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
}

type BetaFilter = 'pending' | 'approved' | 'denied' | 'all';

const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : null;

/**
 * Workspace panel — members with role management, email invites (join on next
 * sign-in), workspace rename, leave workspace, and (Founding admins only) the
 * beta request queue with approve/deny/reopen/delete, filtering, and search.
 */
export default function OrgPanel({ org, myRole, myUserId, onClose, onOrgUpdated, onMyRoleChanged, onLeftWorkspace }: OrgPanelProps) {
  const [members, setMembers] = useState<OrgMemberRow[]>([]);
  const [invites, setInvites] = useState<OrgInviteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<OrgRole>('member');
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
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

  // Click-to-expand member details (activity fetched lazily per member)
  const [expandedMemberId, setExpandedMemberId] = useState<string | null>(null);
  const [memberActivity, setMemberActivity] = useState<Record<string, MemberActivity | 'loading'>>({});

  // Per-org Shopify connection (token is write-only — see shopifyConnectionService)
  const [shopifyConn, setShopifyConn] = useState<ShopifyConnectionStatus | null>(null);
  const [shopifyDomain, setShopifyDomain] = useState('');
  const [shopifyToken, setShopifyToken] = useState('');
  const [editingShopify, setEditingShopify] = useState(false);

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
    const [m, i, b, dirs, shp] = await Promise.all([
      fetchOrgMembers(org.id),
      fetchOrgInvites(org.id),
      isBetaAdmin ? fetchBetaSignups() : Promise.resolve([] as BetaSignupRow[]),
      isBetaAdmin ? fetchBetaOrgDirectory() : Promise.resolve([] as BetaOrgDirectoryRow[]),
      isAdmin ? getShopifyConnection(org.id) : Promise.resolve<ShopifyConnectionStatus>({ status: 'none' }),
    ]);
    setMembers(m);
    setInvites(isAdmin ? i : []);
    setBetaSignups(b);
    setBetaOrgs(dirs);
    setShopifyConn(shp);
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

        {isAdmin && (
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

        {loading ? (
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
        )}

        {isAdmin && !loading && shopifyConn && shopifyConn.status !== 'unavailable' && (
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
                  Connect your store so CSV exports check for title collisions against your own catalog.
                  In Shopify: Settings → Apps and sales channels → Develop apps → create an app with the
                  <strong> read_products</strong> scope, then paste the Admin API token here. The token is
                  stored server side and can never be read back from the browser.
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

        {isBetaAdmin && !loading && (
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

        {isBetaAdmin && !loading && betaOrgs.length > 0 && (
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

        {!loading && canLeave && (
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
