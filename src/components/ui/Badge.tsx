import type { ReactNode } from 'react';
import './Badge.css';

export type BadgeTone =
  | 'neutral'
  | 'accent'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'gold';

export interface BadgeProps {
  /**
   * Semantic colour. `neutral` for plain metadata, `accent` for identity
   * (plan, tag), `gold` for founder/owner marks, the rest for state.
   */
  tone?: BadgeTone;
  /** `sm` (11px) for dense rows, `md` (12px) for standalone marks. */
  size?: 'sm' | 'md';
  /** Uppercases the label. Only for fixed vocabularies, never for user data. */
  caps?: boolean;
  /** Drops the fill and keeps a 1px edge in the tone colour. */
  outline?: boolean;
  /** Leading glyph. A lucide icon; never an emoji. */
  icon?: ReactNode;
  /**
   * Adds a role so a state change is announced. Use `'status'` for a value that
   * updates in place (a sync state, an unread count); leave unset for a static
   * label, which needs no role at all.
   */
  live?: boolean;
  className?: string;
  children: ReactNode;
}

/**
 * Static pill for a label, role, plan, tag or state.
 *
 * ```tsx
 * <Badge tone="gold" caps>owner</Badge>
 * <Badge tone="accent">{org.plan}</Badge>
 * ```
 */
export function Badge({
  tone = 'neutral',
  size = 'sm',
  caps = false,
  outline = false,
  icon,
  live = false,
  className,
  children,
}: BadgeProps) {
  return (
    <span
      role={live ? 'status' : undefined}
      className={[
        'ui-badge',
        `ui-badge--${tone}`,
        `ui-badge--${size}`,
        caps ? 'ui-badge--caps' : '',
        outline ? 'ui-badge--outline' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {icon}
      {children}
    </span>
  );
}

export interface CountBadgeProps {
  /** The number. Rendered as `99+` above `max`. */
  count: number;
  /** Cap before the `+` suffix. Defaults to 99. */
  max?: number;
  /**
   * What is being counted, for the accessible name — e.g. `'unread messages'`.
   * A bare "3" tells a screen-reader user nothing.
   */
  label: string;
  className?: string;
}

/**
 * Solid counter pill for unread/pending marks (replaces `.sw-badge`).
 * Renders nothing at zero, so callers do not each need the guard.
 */
export function CountBadge({ count, max = 99, label, className }: CountBadgeProps) {
  if (count <= 0) return null;
  return (
    <span
      role="status"
      aria-label={`${count} ${label}`}
      className={['ui-badge', 'ui-badge--count', className].filter(Boolean).join(' ')}
    >
      {count > max ? `${max}+` : count}
    </span>
  );
}
