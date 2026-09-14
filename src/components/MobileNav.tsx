import { LayoutGrid, Package, MessageSquare, MoreHorizontal } from 'lucide-react';
import { useSupportThreads } from '../lib/supportStore';
import './MobileNav.css';

/* ════════════════════════════════════════════════════════════════════════════
   The ≤640px navigation: one fixed bottom tab bar, and nothing else.

   HISTORY, BECAUSE THIS FILE USED TO BE THREE THINGS. It also owned a tablet
   <NavRail> (a scrolling second header row, 641-1024px) and a "More" bottom
   sheet with its own copy of the tool list. Both are gone: every tool now lives
   in the workspace menu (WorkspaceMenu.tsx), which renders as a dropdown on a
   desktop and as a bottom sheet on a phone. The rail duplicated a header row
   that no longer exists, and the sheet duplicated a menu that does — two
   renderings of one list is how a role gate drifts. "More" is now just a button
   that opens that menu.

   WHAT STAYS TRUE: the bar is decided by CSS (`display: none` above 640px), not
   by matchMedia — no resize listener, no first-paint flash, and it drops out of
   the accessibility tree rather than merely off-screen.

   IT IS RENDERED OUTSIDE <header> ON PURPOSE. `.app-header` is
   `position: sticky; z-index: 100`, i.e. a stacking context, and a fixed child
   of it is trapped at that level relative to the page.

   THE BAR IS PART OF THE BLACK NAV, so per AGENTS.md §1 every foreground in it
   is a literal light value, never an --ink- or --text- token: those resolve to
   page-black and would vanish.

   (Write token names out in full in these comments. A glob such as --ink-
   followed by a slash and another glob puts a comment terminator in the middle
   of the sentence, which ends the comment early and silently eats the first
   rule below it. That cost a debugging round here already.)
   ════════════════════════════════════════════════════════════════════════════ */

/** The views that have a tab of their own. Anything else is behind "More". */
const TAB_IDS = new Set(['workflow', 'library', 'messages']);

export function MobileTabBar(
  { activeView, onSelect, onGoWorkflow, isFounder, onOpenMore, moreOpen }: {
    activeView: string;
    onSelect: (id: string) => void;
    /** Back to the four workflow steps. */
    onGoWorkflow: () => void;
    /** Drives the Messages tab's label and badge, exactly as the menu does. */
    isFounder: boolean;
    /** Opens the workspace menu as a bottom sheet — the phone's whole "More". */
    onOpenMore: () => void;
    moreOpen: boolean;
  },
) {
  const { available, unreadCount } = useSupportThreads(isFounder ? 'founder' : 'user');

  // Same rule as the menu item and the floating widget: no messaging tables
  // (migration not run) means no messaging UI anywhere.
  const showMessages = available !== false;
  // "More" reads as active whenever the view showing lives behind it, so the
  // bar always says where the user is instead of going blank on, say, CRM.
  const moreActive = !TAB_IDS.has(activeView);

  return (
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
        aria-haspopup="menu"
        aria-expanded={moreOpen}
        onClick={onOpenMore}
      >
        <MoreHorizontal size={20} />
        <span>More</span>
      </button>
    </nav>
  );
}
