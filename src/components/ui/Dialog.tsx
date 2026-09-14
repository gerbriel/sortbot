import { useCallback, useEffect, useId, useRef } from 'react';
import type { KeyboardEvent, MouseEvent, ReactNode, RefObject } from 'react';
import { X } from 'lucide-react';
import { IconButton } from './IconButton';
import './base.css';
import './Dialog.css';

/* ── Module-level modal bookkeeping ─────────────────────────────────────────
   Two things have to be global rather than per-component:

   1. THE STACK. Escape must close only the TOPMOST dialog. Every open dialog
      listens on document, so without a stack a nested confirm and its parent
      both close on one keypress.
   2. THE SCROLL LOCK COUNT. Two dialogs open, the inner one closes, and a
      per-dialog lock would restore body scroll while a modal is still up. */

const dialogStack: HTMLDivElement[] = [];

let scrollLockCount = 0;
let scrollLockPrevious = '';

function lockBodyScroll() {
  if (scrollLockCount === 0) {
    scrollLockPrevious = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  scrollLockCount += 1;
}

function unlockBodyScroll() {
  scrollLockCount = Math.max(0, scrollLockCount - 1);
  if (scrollLockCount === 0) document.body.style.overflow = scrollLockPrevious;
}

/* Order matters: this is document order, which is what Tab follows.
   `:not([tabindex="-1"])` excludes programmatic-only stops such as the
   dialog panel itself. */
const FOCUSABLE =
  'a[href], area[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]),' +
  ' select:not([disabled]), textarea:not([disabled]), iframe, object, embed,' +
  ' [contenteditable="true"], [tabindex]:not([tabindex="-1"])';

function focusableWithin(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    // offsetParent is null for display:none subtrees — a hidden TabPanel's
    // controls must not become invisible tab stops inside the trap.
    (el) => el.offsetParent !== null || el === document.activeElement,
  );
}

export type DialogSize = 'sm' | 'md' | 'lg' | 'xl' | 'full';

export interface DialogProps {
  /** Mount/unmount the dialog. Renders nothing when false. */
  open: boolean;
  /**
   * Called for every dismissal route: Escape, the close button, and a click on
   * the scrim. The parent owns `open`, so this is the only way it closes.
   */
  onClose: () => void;
  /** Accessible name. Rendered as the heading and wired via `aria-labelledby`. */
  title: string;
  /** Optional glyph beside the title. A lucide icon; never an emoji. */
  titleIcon?: ReactNode;
  /** One line of context under the title. Wired via `aria-describedby`. */
  description?: string;
  /** Panel width step. Defaults to `md` (640px, matching the current OrgPanel). */
  size?: DialogSize;
  /** Footer row — put action buttons here, primary last. */
  footer?: ReactNode;
  /**
   * What receives focus on open. Defaults to the first focusable element in the
   * panel. Point it at a safe control (Cancel) for a destructive dialog, so a
   * stray Enter cannot commit the damage.
   */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** Set false for a dialog with unsaved work that must not vanish on a stray Escape. */
  closeOnEscape?: boolean;
  /** Set false for the same reason — a mis-click on the scrim should not discard a draft. */
  closeOnOverlayClick?: boolean;
  /** Hides the header × (for a dialog whose only exits are explicit footer actions). */
  hideCloseButton?: boolean;
  /** Extra classes for the panel. */
  className?: string;
  children?: ReactNode;
}

/**
 * Modal dialog.
 *
 * Portal-free on purpose: the overlay is `position: fixed`, so it already
 * escapes every ancestor's layout, and staying in place keeps React context
 * (auth, org, toasts) available to the contents without a provider re-mount.
 * The one thing a portal would buy — escaping an ancestor `overflow: hidden` —
 * does not apply to a fixed element.
 *
 * ```tsx
 * <Dialog open={show} onClose={close} title="Workspace" titleIcon={<Building2 />}
 *   footer={<><Button onClick={close}>Cancel</Button>
 *            <Button variant="primary" onClick={save}>Save</Button></>}>
 *   …
 * </Dialog>
 * ```
 */
export function Dialog({
  open,
  onClose,
  title,
  titleIcon,
  description,
  size = 'md',
  footer,
  initialFocusRef,
  closeOnEscape = true,
  closeOnOverlayClick = true,
  hideCloseButton = false,
  className,
  children,
}: DialogProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  // Set on mousedown, read on click: a drag that STARTS inside the panel and
  // ends on the scrim (text selection, slider) must not close the dialog.
  const overlayPointerDownRef = useRef(false);
  const baseId = useId();
  const titleId = `${baseId}-title`;
  const descriptionId = `${baseId}-description`;

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    dialogStack.push(panel);
    lockBodyScroll();

    // Focus must land inside the dialog or a screen reader keeps reading the
    // page behind it. Panel itself (tabindex -1) is the last resort.
    const first = initialFocusRef?.current ?? focusableWithin(panel)[0] ?? panel;
    first.focus();

    const onDocumentKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape' || !closeOnEscape) return;
      // Topmost only. Bubble phase (not capture) so an inner control can still
      // stopPropagation to protect its own draft — the convention already used
      // in KanbanCardDetail.
      if (dialogStack[dialogStack.length - 1] !== panel) return;
      e.stopPropagation();
      onClose();
    };

    document.addEventListener('keydown', onDocumentKeyDown);

    return () => {
      document.removeEventListener('keydown', onDocumentKeyDown);
      const i = dialogStack.indexOf(panel);
      if (i >= 0) dialogStack.splice(i, 1);
      unlockBodyScroll();
      // Return focus where the user left it, so closing a modal does not dump
      // the caret at the top of the document.
      if (previouslyFocused && document.contains(previouslyFocused)) previouslyFocused.focus();
    };
  }, [open, onClose, closeOnEscape, initialFocusRef]);

  // FOCUS TRAP. Handled on the panel rather than on document so nested dialogs
  // each trap their own subtree with no coordination.
  const handlePanelKeyDown = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab') return;
    const panel = panelRef.current;
    if (!panel) return;
    const items = focusableWithin(panel);
    if (items.length === 0) {
      e.preventDefault();
      panel.focus();
      return;
    }
    const firstItem = items[0];
    const lastItem = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === firstItem || active === panel)) {
      e.preventDefault();
      lastItem.focus();
    } else if (!e.shiftKey && active === lastItem) {
      e.preventDefault();
      firstItem.focus();
    }
  }, []);

  if (!open) return null;

  const handleOverlayMouseDown = (e: MouseEvent<HTMLDivElement>) => {
    overlayPointerDownRef.current = e.target === e.currentTarget;
  };

  const handleOverlayClick = (e: MouseEvent<HTMLDivElement>) => {
    if (!closeOnOverlayClick) return;
    if (e.target === e.currentTarget && overlayPointerDownRef.current) onClose();
    overlayPointerDownRef.current = false;
  };

  return (
    <div
      className="ui-dialog-overlay"
      onMouseDown={handleOverlayMouseDown}
      onClick={handleOverlayClick}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        onKeyDown={handlePanelKeyDown}
        className={['ui-dialog', `ui-dialog--${size}`, className].filter(Boolean).join(' ')}
      >
        <div className="ui-dialog__header">
          <div className="ui-dialog__heading">
            <h2 id={titleId} className="ui-dialog__title">
              {titleIcon && <span className="ui-dialog__title-icon">{titleIcon}</span>}
              {title}
            </h2>
            {description && (
              <p id={descriptionId} className="ui-dialog__description">{description}</p>
            )}
          </div>
          {!hideCloseButton && (
            <IconButton label="Close" icon={<X />} variant="ghost" size="sm" onClick={onClose} />
          )}
        </div>

        <div className="ui-dialog__body">{children}</div>

        {footer && <div className="ui-dialog__footer">{footer}</div>}
      </div>
    </div>
  );
}

/**
 * Left-aligns whatever follows it in a `Dialog` footer — the standard place for
 * a destructive action that must sit away from the confirm button.
 */
export function DialogFooterSpacer() {
  return <span className="ui-dialog__footer-spacer" />;
}
