import { forwardRef } from 'react';
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from 'react';
import { Spinner } from './Spinner';
import './base.css';
import './Button.css';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-quiet';
export type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonVisualProps {
  /**
   * `primary` for the one committing action in a view, `secondary` for
   * alternatives, `ghost` for low-emphasis row actions, `danger` for a solid
   * destructive commit, `danger-quiet` for the outlined destructive trigger
   * used in dense list rows. Defaults to `secondary` — the safe default, so a
   * forgotten prop never promotes a button to primary.
   */
  variant?: ButtonVariant;
  /** 24 / 32 / 40px target heights. Defaults to `md`. */
  size?: ButtonSize;
  /** Icon element rendered before the label. Pass a lucide icon; never an emoji. */
  icon?: ReactNode;
  /** Icon element rendered after the label (chevrons, external-link marks). */
  iconTrailing?: ReactNode;
  /** Stretches to the container width — for stacked dialog footers and mobile. */
  fullWidth?: boolean;
}

export interface ButtonProps
  extends ButtonVisualProps,
    Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  /**
   * Swaps the leading icon for a spinner, sets `aria-busy`, and blocks
   * activation. The label stays mounted so the button keeps its width.
   */
  loading?: boolean;
  /** Extra classes are appended, never replaced. */
  className?: string;
  children?: ReactNode;
}

function visualClasses(
  { variant = 'secondary', size = 'md', fullWidth }: ButtonVisualProps,
  extra: Array<string | false | undefined>,
  className?: string,
): string {
  return [
    'ui-btn',
    `ui-btn--${variant}`,
    `ui-btn--${size}`,
    fullWidth ? 'ui-btn--full' : '',
    // Solid fills have no darker token to hover to; base.css washes them instead.
    variant === 'danger' ? 'ui-solid-hover' : '',
    ...extra,
    className,
  ]
    .filter(Boolean)
    .join(' ');
}

/**
 * The one button in the system.
 *
 * Deliberately NOT polymorphic: a control that navigates is an anchor and
 * needs different semantics, so it is a separate export (`LinkButton`) rather
 * than an `as` / `asChild` escape hatch that can silently produce a
 * non-focusable div.
 *
 * ```tsx
 * <Button variant="primary" icon={<Download />} loading={busy} onClick={save}>
 *   Save batch
 * </Button>
 * ```
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon, iconTrailing, fullWidth, loading = false,
    className, children, disabled, type = 'button', ...rest },
  ref,
) {
  const isDisabled = disabled === true || loading;

  return (
    <button
      {...rest}
      ref={ref}
      // Omitting type on a <button> inside a form submits it. Default to the
      // inert kind and let callers opt into "submit".
      type={type}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      className={visualClasses({ variant, size, fullWidth }, [loading && 'ui-btn--loading'], className)}
    >
      {loading ? (
        // decorative: aria-busy on the button already announces the state.
        <Spinner size="sm" decorative onFill={variant === 'primary' || variant === 'danger'} />
      ) : (
        icon
      )}
      {children}
      {iconTrailing}
    </button>
  );
});

export interface LinkButtonProps
  extends ButtonVisualProps,
    Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'className'> {
  className?: string;
  children?: ReactNode;
  /**
   * Anchors cannot be disabled. This renders `aria-disabled`, strips `href`
   * and suppresses activation so the control is still reachable and announced.
   */
  disabled?: boolean;
}

/**
 * A link that looks like a `Button`. Use whenever activation NAVIGATES —
 * external docs, `mailto:`, a download URL. Keyboard users get anchor
 * semantics (Enter, open-in-new-tab) instead of a lie.
 */
export const LinkButton = forwardRef<HTMLAnchorElement, LinkButtonProps>(function LinkButton(
  { variant = 'secondary', size = 'md', icon, iconTrailing, fullWidth,
    className, children, disabled = false, href, target, rel, ...rest },
  ref,
) {
  // target=_blank without noopener hands the opened page a window reference.
  const safeRel = target === '_blank' ? [rel, 'noopener', 'noreferrer'].filter(Boolean).join(' ') : rel;

  return (
    <a
      {...rest}
      ref={ref}
      href={disabled ? undefined : href}
      target={target}
      rel={safeRel}
      aria-disabled={disabled || undefined}
      role={disabled ? 'link' : undefined}
      className={visualClasses({ variant, size, fullWidth }, [], className)}
    >
      {icon}
      {children}
      {iconTrailing}
    </a>
  );
});
