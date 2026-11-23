import { useId } from 'react';
import type { CSSProperties, HTMLAttributes, MouseEvent, ReactNode } from 'react';
import './FieldGrid.css';

/* ── Labelled cells ─────────────────────────────────────────────────────────
   The Step 3 cell language, defined once (AGENTS.md §10, Step 3):

     <FieldGroup caption="Pricing">
       <FieldGrid columns={3}>
         <FieldCell label="Price ($)" meta={<Badge>Preset</Badge>}>
           {(c) => <input {...c} value={price} onChange={...} />}
         </FieldCell>
       </FieldGrid>
     </FieldGroup>

   A group is a quiet sentence-case caption over one framed grid; hairlines run
   only BETWEEN cells; each cell is a small label above a control that reads as
   plain text at rest and becomes the app's input (radius and focus ring) when
   focused. VoiceCommandTable is the approved reference rendering. */

export interface FieldGroupProps extends Omit<HTMLAttributes<HTMLElement>, 'children'> {
  /** Quiet caption above the frame. Omit for a captionless lead block. */
  caption?: ReactNode;
  /** Extra classes for the caption (kept for callers with existing hooks). */
  captionClassName?: string;
  /** Extra classes for the frame. */
  frameClassName?: string;
  /** Usually one `FieldGrid`. */
  children: ReactNode;
}

/**
 * Caption + frame. The frame owns the outer edge and clips the grid's
 * overhang, so the outer hairlines vanish at any column count. It uses
 * `overflow: clip`, never `hidden` or `auto`: clip creates no scroll
 * container, so the page stays the one scroller (report 36).
 */
export function FieldGroup({
  caption, captionClassName, frameClassName, className, children, ...rest
}: FieldGroupProps) {
  const captionId = `${useId()}-caption`;
  return (
    <section
      {...rest}
      className={['ui-fieldgroup', className].filter(Boolean).join(' ')}
      aria-labelledby={caption ? captionId : undefined}
    >
      {caption && (
        <div id={captionId} className={['ui-fieldgroup__caption', captionClassName].filter(Boolean).join(' ')}>
          {caption}
        </div>
      )}
      <div className={['ui-fieldgroup__frame', frameClassName].filter(Boolean).join(' ')}>
        {children}
      </div>
    </section>
  );
}

export interface FieldGridProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  /**
   * The most columns the grid may use on a wide screen. Without it the grid
   * fits as many 12rem tracks as there is room for. Phones are two columns
   * regardless.
   */
  columns?: number;
  /** One column at every width (Title, Description). */
  full?: boolean;
  children: ReactNode;
}

/** The auto-fit grid: `repeat(auto-fit, minmax(12rem, 1fr))`. */
export function FieldGrid({ columns, full = false, className, style, children, ...rest }: FieldGridProps) {
  const capped = !full && typeof columns === 'number' && columns > 0;
  return (
    <div
      {...rest}
      className={[
        'ui-fieldgrid',
        full ? 'ui-fieldgrid--full' : '',
        capped ? 'ui-fieldgrid--capped' : '',
        className,
      ].filter(Boolean).join(' ')}
      style={capped ? ({ ...style, '--ui-fieldgrid-cols': columns } as CSSProperties) : style}
    >
      {children}
    </div>
  );
}

/** Props a `FieldCell` hands to its control. Spread them onto it. */
export interface FieldCellControlProps {
  id: string;
  className: string;
  'aria-describedby': string | undefined;
}

export interface FieldCellProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  /** The small label above the control. Sentence case, no trailing colon. */
  label: ReactNode;
  /** The control's id. Defaults to a generated one. */
  controlId?: string;
  /** Trailing slot in the label row: a counter, a badge, a small action. */
  meta?: ReactNode;
  /** Helper text under the control, wired to it with aria-describedby. */
  hint?: ReactNode;
  /** Anything else under the control (Brand's spelling surface). */
  footer?: ReactNode;
  /** Two tracks, or the whole row. */
  span?: 2 | 'full';
  /** Extra classes for the label (kept for callers with existing hooks). */
  labelClassName?: string;
  /**
   * The control. Pass a function to receive the wired props
   * (`{(c) => <input {...c} />}`), the same contract as `Field`; pass an
   * element to wire `controlId` and the `ui-fieldcell__control` class yourself.
   */
  children: ReactNode | ((control: FieldCellControlProps) => ReactNode);
}

const INTERACTIVE = 'button, a, input, select, textarea, label, [role="button"], .ui-fieldcell__footer';

/**
 * One labelled cell. A click anywhere in the cell that is not on something
 * interactive focuses its control, so the whole cell is the target.
 */
export function FieldCell({
  label, controlId, meta, hint, footer, span, labelClassName,
  className, onClick, children, ...rest
}: FieldCellProps) {
  const baseId = useId();
  const id = controlId ?? `${baseId}-control`;
  const hintId = `${baseId}-hint`;

  const control: FieldCellControlProps = {
    id,
    className: 'ui-fieldcell__control',
    'aria-describedby': hint ? hintId : undefined,
  };

  const handleClick = (e: MouseEvent<HTMLDivElement>) => {
    onClick?.(e);
    if (e.defaultPrevented) return;
    const target = e.target as HTMLElement;
    if (target.closest(INTERACTIVE)) return;
    const el = document.getElementById(id);
    if (el && e.currentTarget.contains(el)) el.focus();
  };

  const labelEl = (
    <label htmlFor={id} className={['ui-fieldcell__label', labelClassName].filter(Boolean).join(' ')}>
      {label}
    </label>
  );

  return (
    <div
      {...rest}
      className={[
        'ui-fieldcell',
        span === 2 ? 'ui-fieldcell--span2' : '',
        span === 'full' ? 'ui-fieldcell--full' : '',
        className,
      ].filter(Boolean).join(' ')}
      onClick={handleClick}
    >
      {meta ? (
        <div className="ui-fieldcell__head">
          {labelEl}
          <span className="ui-fieldcell__meta">{meta}</span>
        </div>
      ) : labelEl}
      {typeof children === 'function' ? children(control) : children}
      {hint && <div id={hintId} className="ui-fieldcell__hint">{hint}</div>}
      {footer && <div className="ui-fieldcell__footer">{footer}</div>}
    </div>
  );
}
