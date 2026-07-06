import { useEffect, useState } from 'react';
import { Users, X } from 'lucide-react';
import {
  fetchOrgMembers, fetchOrgInvites, inviteToOrg, revokeInvite, removeMember,
  type Organization, type OrgRole, type OrgMemberRow, type OrgInviteRow,
} from '../lib/orgService';
import { fetchBetaSignups, setBetaStatus, type BetaSignupRow } from '../lib/betaService';
import './OrgPanel.css';

interface OrgPanelProps {
  org: Organization;
  myRole: OrgRole;
  myUserId: string;
  onClose: () => void;
}

/**
 * Workspace panel — shows who is in the org, lets admins invite teammates by
 * email (they join automatically on their next sign-in) and remove members.
 */
export default function OrgPanel({ org, myRole, myUserId, onClose }: OrgPanelProps) {
  const [members, setMembers] = useState<OrgMemberRow[]>([]);
  const [invites, setInvites] = useState<OrgInviteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<OrgRole>('member');
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isAdmin = myRole === 'owner' || myRole === 'admin';
  // Beta waitlist management lives with the Founding Workspace admins only.
  const isBetaAdmin = isAdmin && org.slug === 'founding';
  const [betaSignups, setBetaSignups] = useState<BetaSignupRow[]>([]);

  const reload = async () => {
    setLoading(true);
    const [m, i, b] = await Promise.all([
      fetchOrgMembers(org.id),
      fetchOrgInvites(org.id),
      isBetaAdmin ? fetchBetaSignups() : Promise.resolve([] as BetaSignupRow[]),
    ]);
    setMembers(m);
    setInvites(isAdmin ? i : []);
    setBetaSignups(b);
    setLoading(false);
  };

  const handleBetaDecision = async (id: string, status: 'approved' | 'denied') => {
    if (busy) return;
    setBusy(true);
    const ok = await setBetaStatus(id, status);
    if (!ok) setNotice('Could not update the request — check your permissions.');
    else setNotice(status === 'approved'
      ? 'Approved ✓ — their workspace is created automatically the next time they sign in. Let them know by email!'
      : 'Denied — they will see the “at capacity” message.');
    await reload();
    setBusy(false);
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [org.id]);

  const handleInvite = async () => {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    const res = await inviteToOrg(org.id, inviteEmail, inviteRole);
    if (res.ok) {
      setNotice(`Invited ${inviteEmail.trim().toLowerCase()} — they'll join automatically the next time they sign in (or when they sign up).`);
      setInviteEmail('');
      await reload();
    } else {
      setNotice(`Invite failed: ${res.error}`);
    }
    setBusy(false);
  };

  const handleRevoke = async (inviteId: string) => {
    if (busy) return;
    setBusy(true);
    await revokeInvite(inviteId);
    await reload();
    setBusy(false);
  };

  const handleRemove = async (userId: string, email: string | null) => {
    if (busy) return;
    if (!window.confirm(`Remove ${email || 'this member'} from "${org.name}"? They will lose access to this workspace's batches and products.`)) return;
    setBusy(true);
    const ok = await removeMember(org.id, userId);
    if (!ok) setNotice('Remove failed — you may not have permission.');
    await reload();
    setBusy(false);
  };

  return (
    <div className="org-panel-overlay" onClick={onClose}>
      <div className="org-panel" onClick={(e) => e.stopPropagation()}>
        <div className="org-panel-header">
          <div className="org-panel-title">
            <Users size={20} />
            <h2>{org.name}</h2>
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
              {members.map(m => (
                <li key={m.user_id} className="org-member-row">
                  <span className="org-member-email">{m.email || m.user_id.slice(0, 8)}{m.user_id === myUserId ? ' (you)' : ''}</span>
                  <span className={`org-role-badge org-role-${m.role}`}>{m.role}</span>
                  {isAdmin && m.user_id !== myUserId && (
                    <button className="org-member-remove" disabled={busy} title="Remove from workspace"
                      onClick={() => handleRemove(m.user_id, m.email)}>Remove</button>
                  )}
                </li>
              ))}
            </ul>

            {isAdmin && invites.length > 0 && (
              <>
                <h3 className="org-section-title">Pending invites ({invites.length})</h3>
                <ul className="org-member-list">
                  {invites.map(inv => (
                    <li key={inv.id} className="org-member-row">
                      <span className="org-member-email">{inv.email}</span>
                      <span className={`org-role-badge org-role-${inv.role}`}>{inv.role}</span>
                      <button className="org-member-remove" disabled={busy} title="Revoke invite"
                        onClick={() => handleRevoke(inv.id)}>Revoke</button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}

        {isBetaAdmin && !loading && (
          <>
            <h3 className="org-section-title">
              Beta requests ({betaSignups.filter(s => s.status === 'pending').length} pending)
            </h3>
            {betaSignups.length === 0 && (
              <p className="org-panel-loading">No requests yet — share the landing page: <code>/beta.html</code></p>
            )}
            <ul className="org-member-list">
              {betaSignups
                .slice()
                .sort((a, b) => (a.status === 'pending' ? -1 : 1) - (b.status === 'pending' ? -1 : 1))
                .map(s => (
                  <li key={s.id} className="org-member-row beta-request-row">
                    <div className="beta-request-info">
                      <span className="org-member-email">
                        <strong>{s.org_name}</strong> · {s.contact_name} · {s.email}
                      </span>
                      <span className="beta-request-meta">
                        {[s.store_url, s.volume && `${s.volume}/wk`, s.notes].filter(Boolean).join(' · ') || '—'}
                      </span>
                    </div>
                    {s.status === 'pending' ? (
                      <span className="beta-request-actions">
                        <button className="beta-approve" disabled={busy} onClick={() => handleBetaDecision(s.id, 'approved')}>Approve</button>
                        <button className="beta-deny" disabled={busy} onClick={() => handleBetaDecision(s.id, 'denied')}>Deny</button>
                      </span>
                    ) : (
                      <span className={`org-role-badge beta-status-${s.status}`}>{s.status}</span>
                    )}
                  </li>
                ))}
            </ul>
          </>
        )}

        <p className="org-panel-footnote">
          Everyone in this workspace shares its batches, products, categories, and presets.
          People outside it can't see any of them.
        </p>
      </div>
    </div>
  );
}
