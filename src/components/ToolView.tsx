import { useEffect, useRef, type ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import './ToolView.css';

export interface ToolViewProps {
  /** Lucide icon element rendered beside the title. */
  icon: ReactNode;
  /** The view's name. Rendered as the page's single <h1>. */
  title: string;
  /** One line of plain English saying what this view is for. */
  description?: string;
  /** Returns to the workflow. Wired to Back, Escape, and the components' onClose. */
  onBack: () => void;
  /** Optional controls pinned to the right of the title row. */
  actions?: ReactNode;
  /** Optional tab strip rendered under the title block. */
  tabs?: ReactNode;
  /** Drop the 1400px reading measure — for grid-heavy views (Library, Board). */
  wide?: boolean;
  /** Set false when the child owns Escape itself (KanbanBoard closes its drawer). */
  escapeToBack?: boolean;
  children: ReactNode;
}

/** Editable targets must keep Escape for themselves (cancel an inline rename). */
function isEditable(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

/**
 * Full-page shell for the header tools, which used to be fixed-position modals.
 *
 * The workflow stays mounted underneath (App parks it behind `hidden`), so this
 * is pure navigation chrome: a title block, a Back affordance, and a calm,
 * centred content measure. All spacing comes from ToolView.css against the app's
 * 9px root, so every view inherits the same rhythm instead of modal-scale padding.
 */
export default function ToolView({
  icon, title, description, onBack, actions, tabs, wide, escapeToBack = true, children,
}: ToolViewProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Landing in a new view should read like a page load: top of the document,
  // caret on the heading so screen readers announce where they are.
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' });
    headingRef.current?.focus({ preventScroll: true });
  }, [title]);

  useEffect(() => {
    if (!escapeToBack) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (isEditable(e.target)) return;
      // A view may open a nested dialog of its own (the preset editor, Library's
      // rename prompt). That dialog owns Escape until it is dismissed.
      if (document.querySelector('[data-tv-modal]')) return;
      onBack();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [escapeToBack, onBack]);

  return (
    <div className={`tool-view${wide ? ' tool-view--wide' : ''}`}>
      <div className="tool-view-inner">
        <header className="tool-view-head">
          {/* First in tab order, before the heading, so Back is one Tab away. */}
          <button type="button" className="tool-view-back" onClick={onBack}>
            <ArrowLeft size={14} /> Back to workflow
          </button>
          <div className="tool-view-titlerow">
            <div className="tool-view-title">
              <span className="tool-view-icon" aria-hidden="true">{icon}</span>
              <h1 ref={headingRef} tabIndex={-1}>{title}</h1>
            </div>
            {actions && <div className="tool-view-actions">{actions}</div>}
          </div>
          {description && <p className="tool-view-desc">{description}</p>}
        </header>
        {tabs && <div className="tool-view-tabs" role="tablist">{tabs}</div>}
        <div className="tool-view-body">{children}</div>
      </div>
    </div>
  );
}
