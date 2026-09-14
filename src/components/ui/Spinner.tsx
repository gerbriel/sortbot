import type { CSSProperties } from 'react';
import './base.css';
import './Spinner.css';

export type SpinnerSize = 'sm' | 'md' | 'lg';

export interface SpinnerProps {
  /** Diameter step. Defaults to `md`. */
  size?: SpinnerSize;
  /**
   * Text announced to assistive tech. Rendered visually hidden alongside a
   * `role="status"` wrapper. Defaults to `'Loading'`.
   */
  label?: string;
  /**
   * Set when the spinner sits inside something that already announces the
   * busy state (a `<Button loading>`, a container with `aria-busy`). Drops the
   * status role and the label so the state is not announced twice.
   */
  decorative?: boolean;
  /** Recolours the spinner for placement on a solid accent fill. */
  onFill?: boolean;
  className?: string;
}

/**
 * Indeterminate activity indicator.
 *
 * Announce-once rule: exactly one thing per region should own the busy
 * announcement. Use `decorative` for every spinner nested inside a control or
 * container that already carries `aria-busy` / `role="status"`.
 */
export function Spinner({
  size = 'md',
  label = 'Loading',
  decorative = false,
  onFill = false,
  className,
}: SpinnerProps) {
  const circle = (
    <span
      className={[
        'ui-spinner',
        `ui-spinner--${size}`,
        onFill ? 'ui-spinner--on-fill' : '',
        decorative ? (className ?? '') : '',
      ]
        .filter(Boolean)
        .join(' ')}
    />
  );

  if (decorative) return circle;

  return (
    <span role="status" className={className}>
      {circle}
      <span className="ui-sr-only">{label}</span>
    </span>
  );
}

export type SkeletonShape = 'text' | 'rect' | 'circle';

export interface SkeletonProps {
  /** Geometry preset. `text` is an em-tall line, `rect` a block, `circle` an avatar. */
  shape?: SkeletonShape;
  /** Any CSS width (`'8rem'`, `'60%'`). */
  width?: string;
  /** Any CSS height. Ignored for `text`, which is 1em tall by design. */
  height?: string;
  /** Radius override for `rect` (e.g. to match a card). */
  radius?: string;
  className?: string;
}

/**
 * Shimmering placeholder for content that is still loading.
 *
 * Always `aria-hidden`: a skeleton is a picture of absent content, so the
 * announcement belongs to the region's own `aria-busy` / status text, not to
 * every grey box inside it.
 */
export function Skeleton({ shape = 'text', width, height, radius, className }: SkeletonProps) {
  const style: CSSProperties = {};
  if (width) style.width = width;
  if (height && shape !== 'text') style.height = height;
  if (radius) style.borderRadius = radius;

  return (
    <span
      aria-hidden="true"
      className={['ui-skeleton', `ui-skeleton--${shape}`, className].filter(Boolean).join(' ')}
      style={style}
    />
  );
}

export interface SkeletonTextProps {
  /** Number of placeholder lines. The last one is short so it reads as prose. */
  lines?: number;
  className?: string;
}

/** Convenience stack of `Skeleton` text lines for paragraph-shaped loading. */
export function SkeletonText({ lines = 3, className }: SkeletonTextProps) {
  return (
    <span
      aria-hidden="true"
      className={['ui-skeleton-lines', className].filter(Boolean).join(' ')}
    >
      {Array.from({ length: Math.max(1, lines) }, (_, i) => (
        <span key={i} className="ui-skeleton ui-skeleton--text" />
      ))}
    </span>
  );
}
