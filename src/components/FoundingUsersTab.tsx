import { useMemo, useState } from 'react';
import { Building2, Search, UserCog } from 'lucide-react';
import { Button, ConfirmAction, EmptyState } from './ui';
import type { OrgRole } from '../lib/orgService';
import type { FoundingUserRow } from '../lib/foundingAdminService';

/* ════════════════════════════════════════════════════════════════════════════
   USERS — every account, across every workspace.

   Lifted out of OrgPanel's "Users" tab unchanged in behaviour (Sept 2026): the
   Workspace dashboard is the page for the workspace you are IN, and this list
   is the opposite of that. Markup and class names are the originals, so
   FounderConsole.css inherits the styling that was already tuned for them; the
   one substitution is ConfirmAction for the hand-rolled confirmKey yes/no pair
   (AGENTS.md §18 #12), which is why this component no longer needs a
   confirm-key prop from its parent.

   MEMBERSHIPS MOVE, DATA DOES NOT — the notice below is not decoration. A move
   re-points a person at another workspace and re-points nothing else, which is
   what makes it reversible; the founding_* RPCs enforce it (and the rail that
   the Founding Workspace can never be left with no owner or admin).
   ════════════════════════════════════════════════════════════════════════════ */

export interface FoundingUsersTabProps {
  users: FoundingUserRow[];
  /** Every workspace we can offer as an add/move destination. */
  orgOptions: Array<{ id: string; name: string }>;
  /** Marks "(you)" on your own row. */
  myUserId: string;
  /** A write is in flight somewhere in the console. */
  busy: boolean;
  onSetMembership: (user: FoundingUserRow, orgId: string, role: OrgRole) => void;
  onRemoveMembership: (user: FoundingUserRow, orgId: string) => void;
  onMoveUser: (user: FoundingUserRow, fromOrgId: string, toOrgId: string) => void;
}

const USER_RENDER_CAP = 50;

const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : null;

export default function FoundingUsersTab({
  users, orgOptions, myUserId, busy,
  onSetMembership, onRemoveMembership, onMoveUser,
}: FoundingUsersTabProps) {
  const [search, setSearch] = useState('');
  /** Two-step move, keyed `${userId}:${fromOrgId}` — picking a destination arms
   *  it, a second click commits. Same shape it had in OrgPanel. */
  const [moveDraft, setMoveDraft] = useState<Record<string, string>>({});
  const [addDraft, setAddDraft] = useState<Record<string, { orgId: string; role: OrgRole }>>({});

  const orgNameOf = (id: string) => orgOptions.find(o => o.id === id)?.name ?? 'that workspace';

  const matching = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter(u =>
      (u.email ?? '').toLowerCase().includes(q)
      || u.memberships.some(ms => ms.org_name.toLowerCase().includes(q)));
  }, [users, search]);

  const visible = matching.slice(0, USER_RENDER_CAP);

  const clearMoveDraft = (key: string) =>
    setMoveDraft(d => { const n = { ...d }; delete n[key]; return n; });

  if (users.length === 0) {
    return (
      <EmptyState
        icon={<UserCog size={22} />}
        title="No accounts to manage yet"
        description="This list is empty until founding_user_admin.sql has been run. Until then every other tab still works."
      />
    );
  }

  return (
    <>
      <h3 className="org-section-title">All users ({users.length})</h3>
      <p className="shopify-conn-help">
        Every account across every workspace. Changing someone's workspace changes
        what they can open — their batches, products and images stay with the
        workspace that has them today, so a move is always reversible by moving
        them back. Every change here is logged on the Overview tab with your name on it.
      </p>

      <div className="beta-toolbar">
        <div className="beta-search">
          <Search size={13} />
          <input
            placeholder="Search by email or workspace"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {matching.length === 0 && (
        <p className="org-panel-loading">Nobody matches that search.</p>
      )}

      <ul className="org-member-list">
        {visible.map(u => {
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
                          onChange={(e) => onSetMembership(u, ms.org_id, e.target.value as OrgRole)}
                        >
                          <option value="owner">Owner</option>
                          <option value="admin">Admin</option>
                          <option value="member">Member</option>
                        </select>
                        {target ? (
                          <span className="org-confirm-actions">
                            <span className="fa-move-label">Move to {orgNameOf(target)}?</span>
                            <Button size="sm" variant="primary" disabled={busy}
                              onClick={() => { onMoveUser(u, ms.org_id, target); clearMoveDraft(key); }}>
                              Move
                            </Button>
                            <Button size="sm" disabled={busy} onClick={() => clearMoveDraft(key)}>Cancel</Button>
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
                        <ConfirmAction
                          label="Remove"
                          confirmLabel="Remove"
                          prompt={`Remove them from ${ms.org_name}? That workspace keeps all of its work.`}
                          disabled={busy}
                          onConfirm={() => onRemoveMembership(u, ms.org_id)}
                        />
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
                    aria-label={`Add ${u.email ?? 'this user'} to a workspace`}
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
                    aria-label="Role in that workspace"
                    onChange={(e) => setAddDraft(d => ({
                      ...d,
                      [u.user_id]: { orgId: d[u.user_id]?.orgId ?? '', role: e.target.value as OrgRole },
                    }))}
                  >
                    <option value="member">Member</option>
                    <option value="admin">Admin</option>
                    <option value="owner">Owner</option>
                  </select>
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={busy || !draft?.orgId}
                    onClick={() => {
                      if (!draft?.orgId) return;
                      onSetMembership(u, draft.orgId, draft.role);
                      setAddDraft(d => { const n = { ...d }; delete n[u.user_id]; return n; });
                    }}
                  >
                    Add
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {matching.length > USER_RENDER_CAP && (
        <p className="org-panel-loading">
          Showing the first {USER_RENDER_CAP} of {matching.length} — search to narrow it down.
        </p>
      )}
    </>
  );
}
