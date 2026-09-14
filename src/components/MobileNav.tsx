import { useState, type ReactNode } from 'react';
import { LayoutGrid, Package, MessageSquare, MoreHorizontal } from 'lucide-react';
import { Dialog } from './ui';
import { useSupportThreads } from '../lib/supportStore';
import './MobileNav.css';

/** One destination in the nav. `id` is an `ActiveView` (App owns the union). */
export interface NavTool {
  id: string;
  label: string;
  icon: ReactNode;
  /** Hover tooltip, same string the desktop header button carries. */
  title: string;
}

/* ════════════════════════════════════════════════════════════════════════════
   The ≤1024px navigation.

   The desktop header is a single row of 7-9 tool buttons plus the account menu.
   That row cannot fit a phone, so below 1024px App.css hides the tools there
   and they reappear in one of two shapes:

     641-1024px  <NavRail> — a horizontally scrollable, scroll-snapped row under
                 the header's top line. Every tool stays one tap away and the
                 header keeps a fixed height however many tools a role can see.
     ≤640px      <MobileTabBar> — a fixed bottom bar (Workflow / Library /
                 Messages / More) with the long tail of tools behind More,
                 which opens a bottom sheet.

   WHICH ONE SHOWS IS DECIDED PURELY BY CSS, not by matchMedia state. Both are
   in the DOM and the inactive one is `display: none`, which also removes it
   from the accessibility tree — so a screen reader never meets a tool twice,
   there is no flash of the wrong nav on first paint, and there is no resize
   listener to keep in sync.

   THEY ARE TWO COMPONENTS RATHER THAN ONE because of stacking, not styling.
   `.app-header` is `position: sticky; z-index: 100`, which makes it a stacking
   context: anything rendered inside it — including a `position: fixed` child —
   is trapped at z-index 100 relative to the page. The rail belongs inside the
   header (it IS the header's second row, on the same black surface); the tab
   bar and its sheet must sit outside it, or the sheet would paint underneath
   the support widget (5000) and the toasts (9000).
   ════════════════════════════════════════════════════════════════════════════ */

/* ── Tablet rail — render INSIDE <header className="app-header"> ──────────── */

export function NavRail(
  { tools, activeView, onSelect }: {
    tools: NavTool[];
    activeView: string;
    onSelect: (id: string) => void;
  },
) {
  return (
    <nav className="nav-rail" aria-label="Tools">
      {tools.map(t => {
        const on = activeView === t.id;
        return (
          <button
            key={t.id}
            type="button"
            className={`nav-rail-btn${on ? ' nav-rail-btn--on' : ''}`}
            aria-current={on ? 'page' : undefined}
            title={t.title}
            onClick={() => onSelect(t.id)}
          >
            {t.icon}
            <span>{t.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

/** Library and Messages are first-class tabs, so they are not repeated in the sheet. */
const TAB_IDS = new Set(['library', 'messages']);

/* ── Phone tab bar + More sheet — render OUTSIDE the header ───────────────── */

export function MobileTabBar(
  { tools, activeView, onSelect, onGoWorkflow, isFounder }: {
    /** Every tool this user may see. Messages is excluded — it has its own tab. */
    tools: NavTool[];
    activeView: string;
    onSelect: (id: string) => void;
    /** Back to the four workflow steps. */
    onGoWorkflow: () => void;
    /** Drives the Messages tab's label and badge, exactly as the header does. */
    isFounder: boolean;
  },
) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const { available, unreadCount } = useSupportThreads(isFounder ? 'founder' : 'user');

  // Same rule as the header button and the floating widget: no messaging
  // tables (migration not run) means no messaging UI anywhere.
  const showMessages = available !== false;
  const sheetTools = tools.filter(t => !TAB_IDS.has(t.id));
  // "More" is the active tab whenever the view showing lives behind it, so the
  // bar always says where the user is instead of going blank on, say, CRM.
  const moreActive = sheetTools.some(t => t.id === activeView);

  const go = (id: string) => {
    setSheetOpen(false);
    onSelect(id);
  };

  return (
    <>
      <nav className="tabbar" aria-label="Primary">
        <button
          type="button"
          className={`tabbar-btn${activeView === 'workflow' ? ' tabbar-btn--on' : ''}`}
          aria-current={activeView === 'workflow' ? 'page' : undefined}
          onClick={onGoWorkflow}
        >
          <LayoutGrid size={20} />
          <span>Workflow</span>
        </button>

        <button
          type="button"
          className={`tabbar-btn${activeView === 'library' ? ' tabbar-btn--on' : ''}`}
          aria-current={activeView === 'library' ? 'page' : undefined}
          onClick={() => onSelect('library')}
        >
          <Package size={20} />
          <span>Library</span>
        </button>

        {showMessages && (
          <button
            type="button"
            className={`tabbar-btn${activeView === 'messages' ? ' tabbar-btn--on' : ''}`}
            aria-current={activeView === 'messages' ? 'page' : undefined}
            onClick={() => onSelect('messages')}
          >
            <span className="tabbar-icon">
              <MessageSquare size={20} />
              {unreadCount > 0 && (
                <span className="tabbar-badge" aria-label={`${unreadCount} unread`}>
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </span>
            <span>{isFounder ? 'Inbox' : 'Messages'}</span>
          </button>
        )}

        <button
          type="button"
          className={`tabbar-btn${moreActive ? ' tabbar-btn--on' : ''}`}
          aria-haspopup="dialog"
          aria-expanded={sheetOpen}
          onClick={() => setSheetOpen(true)}
        >
          <MoreHorizontal size={20} />
          <span>More</span>
        </button>
      </nav>

      {/* The sheet is the shared Dialog primitive, not a hand-rolled panel: it
          already carries role="dialog", the focus trap, Escape, scrim-click
          dismissal, the body-scroll lock and focus restoration. Only its
          geometry is overridden — MobileNav.css pins the panel to the bottom. */}
      <Dialog
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title="All tools"
        className="nav-sheet"
      >
        <ul className="nav-sheet-list">
          {sheetTools.map(t => {
            const on = activeView === t.id;
            return (
              <li key={t.id}>
                <button
                  type="button"
                  className={`nav-sheet-item${on ? ' nav-sheet-item--on' : ''}`}
                  aria-current={on ? 'page' : undefined}
                  onClick={() => go(t.id)}
                >
                  <span className="nav-sheet-icon">{t.icon}</span>
                  <span className="nav-sheet-label">{t.label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </Dialog>
    </>
  );
}
