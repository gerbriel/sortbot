import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Crown, Trash2 } from 'lucide-react';
import { Button, ConfirmAction, Dialog, TextField } from './ui';
import {
  DELETE_CONFIRMATION,
  deleteMyAccount,
  fetchAccountDeletionPlan,
} from '../lib/accountService';
import { updateMemberRole } from '../lib/orgService';
import type { AccountDeletionPlan, DeleteAccountErrorCode, WorkspacePlanRow } from '../lib/accountService';
import './DeleteAccountDialog.css';

interface DeleteAccountDialogProps {
  open: boolean;
  userId: string;
  email?: string | null;
  onClose: () => void;
  /** The account is gone and this device is signed out. */
  onDeleted: () => void;
  /** Opens the Workspace page (members and roles). Offered only for a blocking
   *  workspace that IS the current one: the app has no workspace switcher. */
  onOpenWorkspace?: () => void;
  /** The workspace App currently shows, so the Workspace-page link is offered
   *  only where it can help. */
  currentOrgId?: string | null;
}

/** One sentence per fate. Plain words, no em dashes (copy rule). */
function fateText(row: WorkspacePlanRow): string {
  switch (row.fate) {
    case 'delete':
      return 'You are the only member. The workspace and everything in it (batches, listings, photos, categories and settings) will be deleted.';
    case 'leave': {
      const n = row.otherMembers ?? 0;
      return `You will leave this workspace. Its ${n === 1 ? 'other member keeps' : `${n} other members keep`} every batch and listing, and the work you created moves to the workspace's owner, or another member if it has no owner.`;
    }
    case 'last_owner':
      return 'You are the last owner and other people still work here. Make one of them an owner below first.';
    case 'founding_admin':
      return 'You are a founding admin. Another founding admin has to change your role first.';
    default:
      return 'We could not read this workspace right now. The deletion checks it again before anything changes.';
  }
}

const FATE_LABEL: Record<WorkspacePlanRow['fate'], string> = {
  delete: 'Will be deleted',
  leave: 'You will leave',
  last_owner: 'Blocks deletion',
  founding_admin: 'Blocks deletion',
  unknown: 'Checked on delete',
};

/**
 * Delete account, reachable from the account menu (WorkspaceMenu). A modal
 * rather than a page: it is one decision, it has no state worth parking, and
 * it must sit over whatever view the menu was opened from.
 *
 * It explains what happens to each workspace (fetchAccountDeletionPlan), asks
 * for the word DELETE, and only then calls the Edge Function. The server is the
 * authority: a refusal it returns ('last_owner', 'founding_admin') replaces the
 * preview's guess.
 */
export default function DeleteAccountDialog({
  open, userId, email, onClose, onDeleted, onOpenWorkspace, currentOrgId = null,
}: DeleteAccountDialogProps) {
  const [plan, setPlan] = useState<AccountDeletionPlan | null>(null);
  const [planState, setPlanState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<{ code: DeleteAccountErrorCode; detail?: string; orgId?: string } | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  // Bumped after "Make owner" so the plan is read again; the old plan stays on
  // screen while the new one loads.
  const [reloadKey, setReloadKey] = useState(0);
  const [promoting, setPromoting] = useState<string | null>(null);
  const [promoteError, setPromoteError] = useState<string | null>(null);

  // App mounts this component only while it is open, so every open starts from
  // the initial state above; the effect only has to fetch.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetchAccountDeletionPlan(userId).then((p) => {
      if (cancelled) return;
      setPlan(p);
      setPlanState(p ? 'ready' : 'error');
    }).catch(() => {
      if (!cancelled) setPlanState('error');
    });
    return () => { cancelled = true; };
  }, [open, userId, reloadKey]);

  const makeOwner = async (orgId: string, memberId: string) => {
    if (promoting) return;
    setPromoting(`${orgId}:${memberId}`);
    setPromoteError(null);
    const ok = await updateMemberRole(orgId, memberId, 'owner');
    setPromoting(null);
    if (!ok) { setPromoteError('That change did not save. Try again, or use the Workspace page.'); return; }
    // The server's earlier refusal is out of date now.
    setFailure(null);
    setReloadKey(k => k + 1);
  };

  const close = useCallback(() => { if (!busy) onClose(); }, [busy, onClose]);

  const blocked = !!plan?.blocked;
  const canDelete = typed === DELETE_CONFIRMATION && !busy && !blocked;

  const submit = async () => {
    if (!canDelete) return;
    setBusy(true);
    setFailure(null);
    const result = await deleteMyAccount();
    setBusy(false);
    if (result.ok) { onDeleted(); return; }
    setFailure({ code: result.code, detail: result.detail, orgId: result.orgId });
  };

  type Refusal = { code: 'last_owner' | 'founding_admin'; name: string; row?: WorkspacePlanRow };
  const previewRefusals: Refusal[] = (plan?.rows ?? [])
    .filter(r => r.fate === 'last_owner' || r.fate === 'founding_admin')
    .map(r => ({ code: r.fate as Refusal['code'], name: r.name, row: r }));
  // A server refusal wins over the preview. Match it to a plan row by the
  // workspace id the server sends (hint), by name only as a fallback, so its
  // members can be offered too.
  const refusals: Refusal[] =
    failure && (failure.code === 'last_owner' || failure.code === 'founding_admin')
      ? [{
          code: failure.code,
          name: failure.detail ?? 'a workspace',
          row: plan?.rows.find(r => !!failure.orgId && r.orgId === failure.orgId)
            ?? plan?.rows.find(r => r.name === failure.detail),
        }]
      : previewRefusals;

  return (
    <Dialog
      open={open}
      onClose={close}
      title="Delete account"
      titleIcon={<Trash2 size={18} />}
      description="This cannot be undone."
      size="sm"
      initialFocusRef={cancelRef}
      closeOnOverlayClick={!busy}
      closeOnEscape={!busy}
      className="dad"
      footer={(
        <>
          <Button ref={cancelRef} onClick={close} disabled={busy}>Cancel</Button>
          <Button
            variant="danger"
            icon={<Trash2 size={16} />}
            loading={busy}
            disabled={!canDelete}
            onClick={() => { void submit(); }}
          >
            Delete my account
          </Button>
        </>
      )}
    >
      {/* ToolView's Escape-to-workflow skips while this attribute is in the DOM. */}
      <div className="dad-body" data-tv-modal>
        <p className="dad-lead">
          Your sign-in{email ? <> (<strong>{email}</strong>)</> : null} and your personal data will be removed.
          Here is what happens to each workspace you belong to.
        </p>

        {planState === 'loading' && <p className="dad-muted" role="status">Checking your workspaces...</p>}
        {planState === 'error' && (
          <p className="dad-muted" role="status">
            We could not load your workspaces. The deletion still checks every one of them before anything changes.
          </p>
        )}
        {planState === 'ready' && plan && plan.rows.length === 0 && (
          <p className="dad-muted">You are not in any workspace.</p>
        )}
        {planState === 'ready' && plan && plan.rows.length > 0 && (
          <ul className="dad-list" aria-label="Your workspaces">
            {plan.rows.map(row => (
              <li key={row.orgId} className={`dad-row dad-row--${row.fate}`} data-fate={row.fate}>
                <div className="dad-row-head">
                  <span className="dad-row-name">{row.name}</span>
                  <span className="dad-row-tag">{FATE_LABEL[row.fate]}</span>
                </div>
                <p className="dad-row-text">{fateText(row)}</p>
              </li>
            ))}
          </ul>
        )}

        {refusals.map(refusal => {
          const row = refusal.row;
          const others = row?.others ?? [];
          const isCurrent = !!row && row.orgId === currentOrgId;
          return (
            <div key={`${refusal.code}:${refusal.name}`} className="dad-alert" role="alert" data-code={refusal.code}>
              <AlertTriangle size={16} aria-hidden="true" />
              <div className="dad-alert-body">
                {refusal.code === 'last_owner' ? (
                  <>
                    <p>
                      You are the last owner of <strong>{refusal.name}</strong>. Transfer ownership first: make another
                      member an owner, then delete your account.
                    </p>
                    {row && others.length > 0 && (
                      <ul className="dad-members" aria-label={`Members of ${refusal.name}`}>
                        {others.map(m => {
                          const key = `${row.orgId}:${m.user_id}`;
                          return (
                            <li key={m.user_id} className="dad-member">
                              <span className="dad-member-name">{m.email ?? 'A member'}</span>
                              <span className="dad-member-role">{m.role}</span>
                              {/* Two steps, so one tap cannot hand a workspace to someone. */}
                              <ConfirmAction
                                label={promoting === key ? 'Saving...' : 'Make owner'}
                                confirmLabel="Make owner"
                                prompt={`Make ${m.email ?? 'this member'} an owner of ${refusal.name}?`}
                                tone="neutral"
                                icon={<Crown size={14} />}
                                disabled={!!promoting || busy}
                                onConfirm={() => { void makeOwner(row.orgId, m.user_id); }}
                              />
                            </li>
                          );
                        })}
                      </ul>
                    )}
                    {isCurrent && onOpenWorkspace && (
                      <Button size="sm" onClick={onOpenWorkspace} className="dad-alert-action">
                        Open the Workspace page
                      </Button>
                    )}
                  </>
                ) : (
                  <p>
                    You are a founding admin of <strong>{refusal.name}</strong>. Ask another founding admin to change
                    your role to member, then delete your account.
                  </p>
                )}
              </div>
            </div>
          );
        })}
        {promoteError && <p className="dad-error" role="alert">{promoteError}</p>}

        {failure?.code === 'unavailable' && (
          <p className="dad-error" role="alert">
            Account deletion is not switched on yet. Send us a message from the Messages page and we will delete
            your account for you.
          </p>
        )}
        {failure?.code === 'blocked' && (
          <p className="dad-error" role="alert">
            Something in your account needs a founder's help. Send us a message from the Messages page.
          </p>
        )}
        {failure?.code === 'failed' && (
          <p className="dad-error" role="alert">
            We could not delete your account. Check your connection and try again.
          </p>
        )}

        {!blocked && (
          <TextField
            label={`Type ${DELETE_CONFIRMATION} to confirm`}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            disabled={busy}
            inputClassName="dad-input"
          />
        )}
      </div>
    </Dialog>
  );
}
