import { useEffect, useRef, useState } from 'react';
import { Users, ChevronDown, LayoutDashboard, LogOut } from 'lucide-react';
import './WorkspaceMenu.css';

interface WorkspaceMenuProps {
  /** null → plain account menu (legacy mode / no org resolved yet) */
  orgName: string | null;
  role?: string;
  email?: string | null;
  /** undefined → no dashboard item (legacy mode) */
  onOpenDashboard?: () => void;
  onSignOut: () => void;
}

/**
 * The consolidated account/workspace control at the right end of the header:
 * replaces the old [workspace button][email][Sign Out] trio. The trigger shows
 * the workspace name; the dropdown carries identity (name, role, email),
 * opens the workspace dashboard, and signs out.
 */
export default function WorkspaceMenu({ orgName, role, email, onOpenDashboard, onSignOut }: WorkspaceMenuProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="wsmenu-wrap" ref={wrapRef}>
      <button
        className="button button-secondary wsmenu-trigger"
        onClick={() => setOpen(v => !v)}
        title="Workspace and account"
      >
        <Users size={18} />
        <span className="wsmenu-name">{orgName ?? 'Account'}</span>
        <ChevronDown size={14} className={`wsmenu-caret ${open ? 'wsmenu-caret--open' : ''}`} />
      </button>

      {open && (
        <div className="wsmenu-menu">
          <div className="wsmenu-id">
            <span className="wsmenu-id-org">
              {orgName ?? 'Signed in'}
              {role && <span className={`wsmenu-role wsmenu-role-${role}`}>{role}</span>}
            </span>
            {email && <span className="wsmenu-id-email">{email}</span>}
          </div>
          {onOpenDashboard && (
            <button className="wsmenu-item" onClick={() => { setOpen(false); onOpenDashboard(); }}>
              <LayoutDashboard size={15} /> Workspace dashboard
            </button>
          )}
          <button className="wsmenu-item wsmenu-item--danger" onClick={() => { setOpen(false); onSignOut(); }}>
            <LogOut size={15} /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}
