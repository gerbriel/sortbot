import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import './base.css';
import './IconButton.css';

export type IconButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type IconButtonSize = 'sm' | 'md' | 'lg';

export interface IconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'aria-label' | 'children'> {
  /**
   * REQUIRED. The control's accessible name — a glyph has none. Also used as
   * the `title` (hover tooltip) unless `title` is given explicitly, so the
   * label is discoverable by mouse users too.
   */
  label: string;
  /** The glyph. A lucide icon element; never an emoji (AGENTS.md §1). */
  icon: ReactNode;
  variant?: IconButtonVariant;
  size?: IconButtonSize;
  /** Pill shape, for floating controls. */
  round?: boolean;
  className?: string;
}

/**
 * A square, glyph-only button.
 *
 * `label` is required at the type level: this is the single most common a11y
 * regression in an icon-heavy UI, and making it a required prop means the
 * compiler catches it instead of an audit.
 *
 * ```tsx
 * <IconButton label="Close" icon={<X />} variant="ghost" onClick={onClose} />
 * ```
 *
 * For a toggle, pass `aria-pressed` — the CSS keys the "on" look off that
 * attribute, so the visual state and the announced state cannot drift apart.
 */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, variant = 'ghost', size = 'md', round = false,
    className, title, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      {...rest}
      ref={ref}
      type={type}
      aria-label={label}
      title={title ?? label}
      className={[
        'ui-icon-btn',
        `ui-icon-btn--${variant}`,
        `ui-icon-btn--${size}`,
        round ? 'ui-icon-btn--round' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {icon}
    </button>
  );
});
