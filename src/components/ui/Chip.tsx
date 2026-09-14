import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import './base.css';
import './Chip.css';

export type ChipSize = 'sm' | 'md';

interface ChipVisualProps {
  /** `sm` (11px) for toolbars, `md` (12px) default. */
  size?: ChipSize;
  /** Leading glyph. A lucide icon; never an emoji. */
  icon?: ReactNode;
  /** Transparent at rest — for chips over a card surface. */
  quiet?: boolean;
  className?: string;
}

export interface ChipProps
  extends ChipVisualProps,
    Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  children: ReactNode;
}

/**
 * A clickable pill with NO persistent state — "Clear filter", "Add tag",
 * "Copy to editable". For an on/off control use `ToggleChip` instead: a chip
 * that stays lit after a click owes the user an `aria-pressed`.
 */
export const Chip = forwardRef<HTMLButtonElement, ChipProps>(function Chip(
  { size = 'md', icon, quiet = false, className, children, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      {...rest}
      ref={ref}
      type={type}
      className={[
        'ui-chip',
        size === 'sm' ? 'ui-chip--sm' : '',
        quiet ? 'ui-chip--quiet' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {icon}
      {children}
    </button>
  );
});

export interface ToggleChipProps
  extends ChipVisualProps,
    Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'onChange' | 'aria-pressed'> {
  /** Controlled on/off. Rendered as `aria-pressed`, which is also what the CSS keys off. */
  pressed: boolean;
  /** Called with the NEXT state. Fires on click and on Enter/Space (native button). */
  onPressedChange: (next: boolean) => void;
  /** Solid accent fill when on, for a chip that must win a busy toolbar. */
  strong?: boolean;
  children: ReactNode;
}

/**
 * A two-state filter / option toggle.
 *
 * ```tsx
 * <ToggleChip pressed={status === 'pending'} onPressedChange={(on) => setStatus(on ? 'pending' : 'all')}>
 *   Pending
 * </ToggleChip>
 * ```
 *
 * `aria-pressed` — not `aria-selected` — because these are independent
 * toggles, not one-of-N tabs. When the options ARE mutually exclusive and each
 * swaps a panel, use `Tabs`; when they filter a list in place, this is right.
 */
export const ToggleChip = forwardRef<HTMLButtonElement, ToggleChipProps>(function ToggleChip(
  { pressed, onPressedChange, size = 'md', icon, quiet = false, strong = false,
    className, children, onClick, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      {...rest}
      ref={ref}
      type={type}
      aria-pressed={pressed}
      onClick={(e) => {
        onClick?.(e);
        if (!e.defaultPrevented) onPressedChange(!pressed);
      }}
      className={[
        'ui-chip',
        size === 'sm' ? 'ui-chip--sm' : '',
        quiet ? 'ui-chip--quiet' : '',
        strong ? 'ui-chip--strong' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {icon}
      {children}
    </button>
  );
});

export interface RemovableChipProps extends ChipVisualProps {
  /** Chip label. */
  children: ReactNode;
  /** Accessible name for the dismiss control, e.g. `'Remove tag vintage'`. */
  removeLabel: string;
  onRemove: () => void;
  /** Optional primary action for the label itself (filter by this tag). */
  onClick?: () => void;
  disabled?: boolean;
}

/**
 * Chip with a separate dismiss control (tags, applied filters).
 *
 * TWO SIBLING BUTTONS, visually joined — never a button nested inside a
 * button. Interactive content inside a `<button>` is invalid HTML and the
 * inner control becomes unreachable in several screen readers; "use this" and
 * "remove this" are different actions and each needs its own tab stop.
 */
export function RemovableChip({
  children, removeLabel, onRemove, onClick, disabled = false,
  size = 'md', icon, quiet = false, className,
}: RemovableChipProps) {
  return (
    <span className={['ui-chip-pair', className].filter(Boolean).join(' ')}>
      {onClick ? (
        <Chip size={size} icon={icon} quiet={quiet} disabled={disabled} onClick={onClick}
          className="ui-chip--paired">
          {children}
        </Chip>
      ) : (
        <span
          className={[
            'ui-chip', 'ui-chip--static', 'ui-chip--paired',
            size === 'sm' ? 'ui-chip--sm' : '',
            quiet ? 'ui-chip--quiet' : '',
          ].filter(Boolean).join(' ')}
        >
          {icon}
          {children}
        </span>
      )}
      <button
        type="button"
        aria-label={removeLabel}
        title={removeLabel}
        disabled={disabled}
        className="ui-chip__remove"
        onClick={onRemove}
      >
        &times;
      </button>
    </span>
  );
}
