import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Button } from './Button';
import type { ButtonSize, ButtonVariant } from './Button';
import './base.css';
import './ConfirmAction.css';

export interface ConfirmActionProps {
  /** Resting trigger label, e.g. `'Remove'`, `'Delete group'`. */
  label: string;
  /** Step-2 commit label. Defaults to `'Confirm'`. */
  confirmLabel?: string;
  /** Step-2 cancel label. Defaults to `'Cancel'`. */
  cancelLabel?: string;
  /**
   * Short sentence shown beside the armed buttons, e.g. `'Delete 12 images?'`.
   * Also becomes the armed group's accessible name, so a screen-reader user
   * hears WHAT they are confirming and not just "Confirm button".
   */
  prompt?: string;
  /** Runs on commit. The component disarms itself first. */
  onConfirm: () => void;
  /** `danger` (default) for destructive actions, `neutral` for a merely irreversible one. */
  tone?: 'danger' | 'neutral';
  /** Matches the surrounding button row. Defaults to `sm` — these live in dense rows. */
  size?: ButtonSize;
  /** Blocks both steps while an action is in flight. */
  disabled?: boolean;
  /** Leading glyph on the resting trigger. A lucide icon; never an emoji. */
  icon?: ReactNode;
  /**
   * Controlled arming, for a list that allows only ONE armed row at a time —
   * the existing `confirmKey` state maps straight onto this pair.
   * Omit both for self-contained behaviour.
   */
  armed?: boolean;
  onArmedChange?: (next: boolean) => void;
  className?: string;
}

/**
 * Two-step inline confirmation.
 *
 * WHY THIS EXISTS: `window.confirm()` is banned in this codebase (Do Not #12) —
 * it blocks the event loop mid-auto-save and cannot be styled or tested. Every
 * destructive control therefore grew its own `confirmKey` state plus a
 * copy-pasted yes/no pair. This is that pattern, once.
 *
 * BEHAVIOUR
 * - Click the trigger to arm; the commit button then takes focus, so Enter
 *   commits and Escape cancels without touching the mouse.
 * - Escape disarms (handled on the group, so it never reaches a parent Dialog).
 * - Blurring out of the group disarms it, so an abandoned confirm does not sit
 *   armed in a list forever.
 *
 * ```tsx
 * // self-contained
 * <ConfirmAction label="Remove" prompt="Remove this member?" onConfirm={() => remove(id)} disabled={busy} />
 *
 * // one-armed-at-a-time across a list (replaces the confirmKey ternaries)
 * <ConfirmAction label="Remove" onConfirm={() => remove(m.user_id)}
 *   armed={confirmKey === `remove:${m.user_id}`}
 *   onArmedChange={(on) => setConfirmKey(on ? `remove:${m.user_id}` : null)} />
 * ```
 */
export function ConfirmAction({
  label,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  prompt,
  onConfirm,
  tone = 'danger',
  size = 'sm',
  disabled = false,
  icon,
  armed: armedProp,
  onArmedChange,
  className,
}: ConfirmActionProps) {
  const [armedState, setArmedState] = useState(false);
  const isControlled = armedProp !== undefined;
  const armed = isControlled ? armedProp : armedState;

  const confirmRef = useRef<HTMLButtonElement | null>(null);
  const groupRef = useRef<HTMLSpanElement | null>(null);
  const promptId = useId();

  const setArmed = useCallback(
    (next: boolean) => {
      if (!isControlled) setArmedState(next);
      onArmedChange?.(next);
    },
    [isControlled, onArmedChange],
  );

  // Focus follows the arming so the keyboard path is Enter → Enter, and Escape
  // lands on a handler inside the group. Focusing in an effect (rather than in
  // the click handler) is what makes it work in the controlled case too, where
  // the button does not exist until the parent re-renders.
  useEffect(() => {
    if (armed) confirmRef.current?.focus();
  }, [armed]);

  if (!armed) {
    return (
      <Button
        variant={tone === 'danger' ? 'danger-quiet' : 'secondary'}
        size={size}
        icon={icon}
        disabled={disabled}
        onClick={() => setArmed(true)}
        className={className}
      >
        {label}
      </Button>
    );
  }

  return (
    <span
      ref={groupRef}
      role="group"
      aria-label={prompt ?? `Confirm: ${label}`}
      aria-describedby={prompt ? promptId : undefined}
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return;
        // Stopped so a surrounding Dialog does not also close on the same key.
        e.stopPropagation();
        setArmed(false);
      }}
      onBlur={(e) => {
        // relatedTarget is where focus is GOING. Null means focus left the
        // document entirely (window blur) — keep the armed state in that case.
        const next = e.relatedTarget as Node | null;
        if (next && !groupRef.current?.contains(next)) setArmed(false);
      }}
      className={[
        'ui-confirm',
        'ui-confirm--armed',
        tone === 'neutral' ? 'ui-confirm--armed-neutral' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {prompt && (
        <span id={promptId} className="ui-confirm__prompt">{prompt}</span>
      )}
      <Button
        ref={confirmRef}
        variant={(tone === 'danger' ? 'danger' : 'primary') as ButtonVariant}
        size={size}
        disabled={disabled}
        onClick={() => {
          setArmed(false);
          onConfirm();
        }}
      >
        {confirmLabel}
      </Button>
      <Button variant="ghost" size={size} disabled={disabled} onClick={() => setArmed(false)}>
        {cancelLabel}
      </Button>
    </span>
  );
}
