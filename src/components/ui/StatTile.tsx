import type { ReactNode } from 'react';
import './StatTile.css';

export type StatDirection = 'up' | 'down' | 'flat';

export interface StatTileProps {
  /** What is being counted — `'Listings created'`. */
  label: string;
  /** The number. Pre-format it (currency, thousands separators) at the call site. */
  value: ReactNode;
  /** Optional glyph beside the label. A lucide icon; never an emoji. */
  icon?: ReactNode;
  /**
   * Change indicator. `direction` is the arrow; `sentiment` is the colour.
   * They are separate because "up" is not always good — a rising error count
   * should be red while a rising listing count is green.
   */
  delta?: {
    text: string;
    direction: StatDirection;
    /** Defaults to `up` = good, `down` = bad. Pass `'inverse'` when up is bad. */
    sentiment?: 'normal' | 'inverse' | 'neutral';
  };
  /** Extra context under the value, e.g. `'vs. last 30 days'`. */
  hint?: ReactNode;
  /** Smaller value type, for a tile in a dense sidebar. */
  compact?: boolean;
  /** Transparent fill, for a tile placed on a card surface. */
  quiet?: boolean;
  className?: string;
}

const ARROW: Record<StatDirection, string> = { up: '↑', down: '↓', flat: '→' };

function deltaClass(direction: StatDirection, sentiment: 'normal' | 'inverse' | 'neutral') {
  if (sentiment === 'neutral' || direction === 'flat') return 'ui-stat__delta--flat';
  const good = sentiment === 'normal' ? direction === 'up' : direction === 'down';
  return good ? 'ui-stat__delta--good' : 'ui-stat__delta--bad';
}

/**
 * A single KPI tile.
 *
 * ```tsx
 * <StatGrid>
 *   <StatTile label="Listings" value={counts.products}
 *     delta={{ text: '+12%', direction: 'up' }} hint="vs. last 30 days" />
 *   <StatTile label="Failed exports" value={counts.failed}
 *     delta={{ text: '+3', direction: 'up', sentiment: 'inverse' }} />
 * </StatGrid>
 * ```
 */
export function StatTile({
  label, value, icon, delta, hint, compact = false, quiet = false, className,
}: StatTileProps) {
  const sentiment = delta?.sentiment ?? 'normal';

  return (
    <div className={['ui-stat', quiet ? 'ui-stat--quiet' : '', className].filter(Boolean).join(' ')}>
      <div className="ui-stat__head">
        {icon && <span aria-hidden="true" className="ui-stat__icon">{icon}</span>}
        <span className="ui-stat__label">{label}</span>
      </div>
      <span className={['ui-stat__value', compact ? 'ui-stat__value--sm' : ''].filter(Boolean).join(' ')}>
        {value}
      </span>
      {(delta || hint) && (
        <div className="ui-stat__foot">
          {delta && (
            <span className={['ui-stat__delta', deltaClass(delta.direction, sentiment)].join(' ')}>
              {/* The arrow is decorative; the direction is already in the text
                  (a "+12%" / "-3" style string), so it is not announced twice. */}
              <span aria-hidden="true">{ARROW[delta.direction]}</span>
              {delta.text}
            </span>
          )}
          {hint && <span>{hint}</span>}
        </div>
      )}
    </div>
  );
}

export interface StatGridProps {
  className?: string;
  children: ReactNode;
}

/** Responsive auto-fit grid for a row of `StatTile`s. */
export function StatGrid({ className, children }: StatGridProps) {
  return <div className={['ui-stat-grid', className].filter(Boolean).join(' ')}>{children}</div>;
}
