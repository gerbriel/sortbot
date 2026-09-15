import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Users, ChevronDown, LogOut, ArrowLeft, Check, Cloud, RefreshCw, AlertTriangle } from 'lucide-react';
import './WorkspaceMenu.css';

/** The three bands the menu is divided into, in render order. */
export type NavGroup = 'work' | 'setup' | 'founder';

const GROUP_ORDER: NavGroup[] = ['work', 'setup', 'founder'];
const GROUP_LABEL: Record<NavGroup, string> = {
  work: 'Work',
  setup: 'Setup',
  founder: 'Founder',
};

/** One destination. `id` is an `ActiveView` — App owns the union. */
export interface WorkspaceNavItem {
  id: string;
  label: string;
  icon: ReactNode;
  /** The long-form tooltip the old header button carried. */
  title: string;
  group: NavGroup;
  /** Resolved unread count. Rendered as a badge when > 0. */
  badge?: number;
}

/**
 * The storage meter's inputs. It used to be a full-width bar under the header
 * on every page; it is account status, so it is a row in this menu now. The
 * whole row is the Refresh action, which is how it joins the arrow-key order.
 */
export interface WorkspaceStorage {
  usedBytes: number;
  fileCount: number;
  /** A re-read is in flight — the row keeps its last figures and spins. */
  loading: boolean;
  /** The denominator (VITE_STORAGE_LIMIT_GB). */
  limitGb: number;
  onRefresh: () => void;
}

interface WorkspaceMenuProps {
  /** null → plain account menu (legacy mode / no org resolved yet) */
  orgName: string | null;
  role?: string;
  email?: string | null;
  /** Every destination this user may open, already role-gated by App. */
  items: WorkspaceNavItem[];
  /** The `ActiveView` currently showing, so the menu can mark it. */
  activeView: string;
  /** Count on the TRIGGER itself — the one signal that survives the menu being shut. */
  unreadCount?: number;
  /** True while a tool view is open, which is the only time "Back to workflow" makes sense. */
  showBackToWorkflow: boolean;
  /**
   * Fires with the chosen view and the element that opened the menu (the header
   * trigger, or the phone's More tab). App parks that element in `viewTriggerRef`
   * so ToolView's Back and Escape land focus back where the journey started.
   */
  onSelect: (id: string, opener: HTMLElement | null) => void;
  onSignOut: () => void;
  /** Controlled: the phone tab bar's "More" opens this same menu. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The storage meter row; null until the first read has been requested. */
  storage?: WorkspaceStorage | null;
}

/**
 * The app's ONE navigation surface.
 *
 * The header used to carry eleven tool buttons that wrapped onto a second line,
 * plus a tablet rail and a phone "More" sheet that each re-rendered the same
 * list. All of it now lives in this dropdown: identity, every tool grouped and
 * dividered, and sign out. The header is back to a wordmark and this trigger at
 * every width.
 *
 * TWO THINGS ARE LOAD-BEARING HERE:
 *
 * 1. IT IS PORTALED TO `document.body`. `.app-header` is
 *    `position: sticky; z-index: 100`, which makes it a stacking context — a
 *    `position: fixed` child of it is trapped at 100 relative to the page, and
 *    the phone tab bar is a sibling at 200. Rendered in place, the bottom sheet
 *    would paint UNDERNEATH the very tab bar that opened it. Portaling also
 *    drops the popover out of the nav's forced-white cascade, so the
 *    `.app-header .wsmenu-menu` opt-outs this file used to need are gone; the
 *    popover states its own token colours like any other white surface.
 * 2. ITS GEOMETRY IS CSS-ONLY. The desktop anchor is handed to CSS as two
 *    custom properties rather than as `top`/`right` inline styles, because an
 *    inline declaration would beat the `@media (max-width: 640px)` sheet rules.
 *    Custom properties are inert until something reads them, so the phone
 *    simply ignores them. No matchMedia, no resize state, no wrong-nav flash.
 */
export default function WorkspaceMenu({
  orgName, role, email, items, activeView, unreadCount = 0,
  showBackToWorkflow, onSelect, onSignOut, open, onOpenChange, storage = null,
}: WorkspaceMenuProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  /** Where focus was when the menu opened — Escape and selection put it back. */
  const openerRef = useRef<HTMLElement | null>(null);
  /** Set by a KEYBOARD open only; a pointer open must not move focus. */
  const pendingFocusRef = useRef<'first' | 'last' | null>(null);
  const [anchor, setAnchor] = useState({ top: 0, right: 0 });
  const menuId = `${useId()}-menu`;

  const menuItems = useCallback(
    () => Array.from(popRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []),
    [],
  );

  const close = useCallback((restoreFocus: boolean) => {
    const opener = openerRef.current;
    openerRef.current = null;
    onOpenChange(false);
    // Deferred: the item that fired this is still mounted for one more tick,
    // and focusing a node that is about to detach drops focus to <body>.
    if (restoreFocus) {
      requestAnimationFrame(() => (opener ?? triggerRef.current)?.focus());
    }
  }, [onOpenChange]);

  /* Remember the opener and run the one-shot keyboard focus. Also covers the
     externally-controlled open (the phone's More tab), where this component
     never saw the click. */
  useEffect(() => {
    if (!open) return;
    if (!openerRef.current) openerRef.current = (document.activeElement as HTMLElement) ?? null;
    const want = pendingFocusRef.current;
    pendingFocusRef.current = null;
    if (!want) return;
    const list = menuItems();
    (want === 'last' ? list[list.length - 1] : list[0])?.focus();
  }, [open, menuItems]);

  /* Desktop anchor, republished on scroll and resize so a sticky header that
     moves under the popover cannot leave it floating. Phone ignores both vars. */
  useLayoutEffect(() => {
    if (!open) return;
    const measure = () => {
      const r = triggerRef.current?.getBoundingClientRect();
      if (!r) return;
      setAnchor({ top: Math.round(r.bottom + 6), right: Math.round(window.innerWidth - r.right) });
    };
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [open]);

  /* Dismissal routes that the browser owns: a press anywhere else, Escape and
     Tab. The popover is portaled, so "outside" has to clear BOTH subtrees. */
  useEffect(() => {
    if (!open) return;
    const isInside = (n: Node | null) =>
      !!n && (!!wrapRef.current?.contains(n) || !!popRef.current?.contains(n));
    const onDown = (e: MouseEvent) => { if (!isInside(e.target as Node)) close(false); };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); close(true); return; }
      // Tab leaves the menu behind. Focus is handed back to the trigger only
      // when it was inside the popover, which is about to be unmounted.
      if (e.key === 'Tab') close(isInside(document.activeElement));
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);

  /** Roving focus inside the open menu. Wraps at both ends. */
  const onListKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const list = menuItems();
    if (list.length === 0) return;
    const i = list.indexOf(document.activeElement as HTMLElement);
    const next =
      e.key === 'Home' ? 0
      : e.key === 'End' ? list.length - 1
      : e.key === 'ArrowDown' ? (i + 1) % list.length
      : (i - 1 + list.length) % list.length;
    list[next]?.focus();
  };

  const openFrom = (focus: 'first' | 'last' | null) => {
    openerRef.current = triggerRef.current;
    pendingFocusRef.current = focus;
    onOpenChange(true);
  };

  const onTriggerClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (open) { close(true); return; }
    // detail === 0 is a keyboard-activated click (Enter/Space). A real pointer
    // press must not yank focus into the menu.
    openFrom(e.detail === 0 ? 'first' : null);
  };

  const onTriggerKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    if (open) menuItems()[e.key === 'ArrowDown' ? 0 : menuItems().length - 1]?.focus();
    else openFrom(e.key === 'ArrowDown' ? 'first' : 'last');
  };

  const choose = (id: string) => {
    const opener = openerRef.current ?? triggerRef.current;
    // Re-selecting the view you are already on is a no-op beyond closing.
    if (id === activeView) { close(true); return; }
    close(true);
    onSelect(id, opener);
  };

  const renderItem = (item: WorkspaceNavItem) => {
    const on = activeView === item.id;
    return (
      <button
        key={item.id}
        type="button"
        role="menuitem"
        tabIndex={-1}
        className={`wsmenu-item${on ? ' wsmenu-item--on' : ''}`}
        aria-current={on ? 'page' : undefined}
        title={item.title}
        onClick={() => choose(item.id)}
      >
        <span className="wsmenu-item-icon">{item.icon}</span>
        <span className="wsmenu-item-label">{item.label}</span>
        {!!item.badge && item.badge > 0 && (
          <span className="wsmenu-badge" aria-label={`${item.badge} unread`}>
            {item.badge > 99 ? '99+' : item.badge}
          </span>
        )}
        {on && <Check size={15} className="wsmenu-item-check" aria-hidden="true" />}
      </button>
    );
  };

  const groups = GROUP_ORDER
    .map(g => ({ group: g, list: items.filter(i => i.group === g) }))
    .filter(g => g.list.length > 0);

  /* The storage meter as ONE menu row. Label + figures, a track, the file
     count and the almost-full flag; clicking the row re-reads the number
     (one RPC — perf_storage_usage.sql) and the menu stays open so the update
     is seen. The visual figures are aria-hidden and restated in the row's
     accessible name so a screen reader hears one sentence, not five spans. */
  const renderStorage = () => {
    if (!storage) return null;
    const limitBytes = storage.limitGb * 1024 ** 3;
    const calculating = storage.loading && storage.usedBytes === 0;
    const pct = limitBytes > 0 ? storage.usedBytes / limitBytes : 0;
    const tone = pct > 0.85 ? 'danger' : pct > 0.6 ? 'warning' : 'success';
    const gb = (storage.usedBytes / 1024 ** 3).toFixed(2);
    const pctText = `${(pct * 100).toFixed(0)}%`;
    const files = storage.fileCount.toLocaleString();
    const spoken = calculating
      ? 'calculating'
      : `${gb} GB of ${storage.limitGb} GB used (${pctText}), ${files} files${pct > 0.85 ? ', almost full' : ''}`;
    return (
      <>
        <button
          type="button"
          role="menuitem"
          tabIndex={-1}
          className={`wsmenu-item wsmenu-storage wsmenu-storage--${tone}${storage.loading ? ' wsmenu-storage--busy' : ''}`}
          aria-label={`Storage: ${spoken}. Refresh`}
          aria-busy={storage.loading || undefined}
          title="Refresh storage usage"
          onClick={() => { if (!storage.loading) storage.onRefresh(); }}
        >
          <span className="wsmenu-item-icon"><Cloud size={16} /></span>
          <span className="wsmenu-storage-body" aria-hidden="true">
            <span className="wsmenu-storage-line">
              <span className="wsmenu-item-label">Storage</span>
              <span className="wsmenu-storage-figures">
                {calculating ? 'Calculating…' : <>{gb} / {storage.limitGb} GB <b>{pctText}</b></>}
              </span>
            </span>
            <span className="wsmenu-storage-track">
              <span className="wsmenu-storage-fill" style={{ width: `${Math.min(100, pct * 100).toFixed(1)}%` }} />
            </span>
            <span className="wsmenu-storage-meta">
              {!calculating && <span>{files} files</span>}
              {pct > 0.85 && (
                <span className="wsmenu-storage-warn"><AlertTriangle size={11} /> Almost full</span>
              )}
            </span>
          </span>
          <RefreshCw size={14} className="wsmenu-storage-refresh" aria-hidden="true" />
        </button>
        <div role="separator" className="wsmenu-sep" />
      </>
    );
  };

  return (
    <div className="wsmenu-wrap" ref={wrapRef}>
      <button
        ref={triggerRef}
        className="button button-secondary wsmenu-trigger"
        onClick={onTriggerClick}
        onKeyDown={onTriggerKeyDown}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        title="Workspace, tools and account"
      >
        <Users size={18} />
        <span className="wsmenu-name">{orgName ?? 'Account'}</span>
        {unreadCount > 0 && (
          <span className="nav-badge" aria-label={`${unreadCount} unread`}>
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
        <ChevronDown size={14} className={`wsmenu-caret ${open ? 'wsmenu-caret--open' : ''}`} />
      </button>

      {open && createPortal(
        <>
          {/* Scrim exists only at phone width, where the menu is a sheet. Above
              that the press-outside listener is the whole dismissal story and a
              full-screen layer would swallow the user's next click. */}
          <div className="wsmenu-scrim" aria-hidden="true" />
          <div
            className="wsmenu-pop"
            ref={popRef}
            /* ToolView's Escape-to-workflow is a document listener registered
               before this one, and `stopPropagation` cannot stop a sibling
               listener on the same node. `data-tv-modal` is the codebase's
               existing park signal: while this attribute is in the DOM,
               ToolView leaves Escape alone, so Escape closes the MENU and does
               not also navigate out of the view behind it. */
            data-tv-modal
            style={{
              '--wsmenu-top': `${anchor.top}px`,
              '--wsmenu-right': `${anchor.right}px`,
            } as React.CSSProperties}
            onKeyDown={onListKeyDown}
          >
            <div className="wsmenu-id">
              <span className="wsmenu-id-org">
                {orgName ?? 'Signed in'}
                {role && <span className={`wsmenu-role wsmenu-role-${role}`}>{role}</span>}
              </span>
              {email && <span className="wsmenu-id-email">{email}</span>}
            </div>

            <div className="wsmenu-list" id={menuId} role="menu" aria-label="Navigation">
              {renderStorage()}
              {showBackToWorkflow && (
                <>
                  <button
                    type="button"
                    role="menuitem"
                    tabIndex={-1}
                    className="wsmenu-item wsmenu-item--back"
                    onClick={() => choose('workflow')}
                  >
                    <span className="wsmenu-item-icon"><ArrowLeft size={16} /></span>
                    <span className="wsmenu-item-label">Back to workflow</span>
                  </button>
                  <div role="separator" className="wsmenu-sep" />
                </>
              )}

              {groups.map(({ group, list }, i) => (
                <div key={group} role="group" aria-label={GROUP_LABEL[group]}>
                  {i > 0 && <div role="separator" className="wsmenu-sep" />}
                  <p className="wsmenu-group-label" aria-hidden="true">{GROUP_LABEL[group]}</p>
                  {list.map(renderItem)}
                </div>
              ))}

              <div role="separator" className="wsmenu-sep" />
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                className="wsmenu-item wsmenu-item--danger"
                onClick={() => { close(false); onSignOut(); }}
              >
                <span className="wsmenu-item-icon"><LogOut size={16} /></span>
                <span className="wsmenu-item-label">Sign out</span>
              </button>
            </div>
          </div>
        </>,
        document.body,
      )}
    </div>
  );
}
