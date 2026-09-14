import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info, XCircle, X } from 'lucide-react';
import { IconButton } from './IconButton';
import './base.css';
import './Toast.css';

export type ToastTone = 'info' | 'success' | 'warning' | 'danger';

export type ToastPosition = 'bottom-right' | 'bottom-left' | 'top-right' | 'top-center';

const TONE_ICON: Record<ToastTone, ReactNode> = {
  info: <Info />,
  success: <CheckCircle2 />,
  warning: <AlertTriangle />,
  danger: <XCircle />,
};

export interface ToastViewportProps {
  /** Corner the stack occupies. Defaults to `bottom-right`, matching today's `.toast-stack`. */
  position?: ToastPosition;
  /**
   * Politeness of the live region. `polite` waits for a pause (right for
   * confirmations); `assertive` interrupts (right for a failure stack).
   */
  politeness?: 'polite' | 'assertive';
  className?: string;
  children: ReactNode;
}

/**
 * The fixed stack that holds toasts.
 *
 * DELIBERATELY STATE-FREE — no provider, no context, no hook. App.tsx already
 * owns a `toasts` array and an `addToast`, and every other screen that needs a
 * toast is inside it. Making these primitives presentational means a migration
 * is a JSX swap with zero change to how toasts are created, and it keeps the
 * queue policy (dedupe, cap, ordering) in app code where the product decisions
 * live.
 *
 * ONE live region wraps the whole stack rather than one per toast: a screen
 * reader announces additions to a region, so a region per toast would
 * re-announce the entire stack every time one is added.
 *
 * ```tsx
 * <ToastViewport>
 *   {toasts.map((t) => (
 *     <Toast key={t.id} tone={t.tone} message={t.message}
 *       onDismiss={() => dismiss(t.id)} duration={4000} />
 *   ))}
 * </ToastViewport>
 * ```
 */
export function ToastViewport({
  position = 'bottom-right',
  politeness = 'polite',
  className,
  children,
}: ToastViewportProps) {
  return (
    <div
      role={politeness === 'assertive' ? 'alert' : 'status'}
      aria-live={politeness}
      // Additions must be announced with their surrounding text, otherwise a
      // toast whose message spans two nodes is read as fragments.
      aria-atomic="false"
      className={[
        'ui-toast-viewport',
        `ui-toast-viewport--${position}`,
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </div>
  );
}

export interface ToastProps {
  /** Colour + icon. Defaults to `info`. */
  tone?: ToastTone;
  /** Optional bold first line. Use when the message alone is ambiguous. */
  title?: string;
  /** The body text. */
  message: ReactNode;
  /**
   * Called by the dismiss button and by the auto-dismiss timer. Omit to render a
   * toast the caller dismisses some other way (no × is shown without it).
   */
  onDismiss?: () => void;
  /**
   * Auto-dismiss delay in ms. `0` pins the toast open — ALWAYS pin a `danger`
   * toast that reports lost work, and any toast with an `action`, so the user is
   * not racing a timer to reach the button.
   */
  duration?: number;
  /** A single follow-up control (Retry, Undo, View). */
  action?: ReactNode;
  className?: string;
}

/**
 * One notification in a `ToastViewport`.
 *
 * The auto-dismiss timer lives here, not in the parent: it has to be cleared on
 * unmount, and the component that owns the unmount is the one that can do that
 * reliably. Passing `duration={0}` opts out entirely.
 */
export function Toast({
  tone = 'info', title, message, onDismiss, duration = 4000, action, className,
}: ToastProps) {
  // Ref, not a dep: a parent that re-creates its dismiss closure on every render
  // would otherwise restart the timer forever and the toast would never close.
  // Synced in an effect rather than during render — writing a ref while
  // rendering is unsafe under concurrent rendering (react-hooks/refs), and the
  // timer only reads it from inside the timeout callback, long after commit.
  const onDismissRef = useRef(onDismiss);
  useEffect(() => { onDismissRef.current = onDismiss; }, [onDismiss]);

  useEffect(() => {
    if (!duration || duration <= 0) return;
    const id = window.setTimeout(() => { onDismissRef.current?.(); }, duration);
    return () => window.clearTimeout(id);
  }, [duration]);

  return (
    <div className={['ui-toast', `ui-toast--${tone}`, className].filter(Boolean).join(' ')}>
      <span aria-hidden="true" className="ui-toast__icon">{TONE_ICON[tone]}</span>
      <div className="ui-toast__body">
        {title && <span className="ui-toast__title">{title}</span>}
        <span className="ui-toast__message">{message}</span>
        {action && <span className="ui-toast__action">{action}</span>}
      </div>
      {onDismiss && (
        <IconButton label="Dismiss notification" icon={<X />} variant="ghost" size="sm" onClick={onDismiss} />
      )}
    </div>
  );
}
