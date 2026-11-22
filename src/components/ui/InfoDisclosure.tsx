import { useId, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { Info } from 'lucide-react';
import { IconButton } from './IconButton';
import './base.css';
import './InfoDisclosure.css';

export interface InfoDisclosureProps {
  /**
   * REQUIRED. The info button's accessible name, and the panel's region label
   * ("How dictation works"). A bare Info glyph says nothing on its own.
   */
  label: string;
  /** The row's title, rendered just before the info button. */
  heading: ReactNode;
  /** Controls on the right of the header row (kept as the caller built them). */
  actions?: ReactNode;
  /** The help itself, shown inline directly under the header row. */
  children: ReactNode;
  /** Start expanded. Uncontrolled after the first render. */
  defaultOpen?: boolean;
  /** Fires after every open or close. */
  onOpenChange?: (open: boolean) => void;
  className?: string;
  /** Extra class on the header row (a layout hook for the caller's CSS). */
  headClassName?: string;
  /** Extra class on the panel, e.g. to step its surface on a grey section. */
  panelClassName?: string;
}

/**
 * A header row with an info button that expands a help panel IN PLACE.
 *
 * It is a disclosure, not a popover: the panel is ordinary flow content right
 * after the header row, so there is no positioning logic, nothing to clip at
 * phone width, and nothing to portal. The panel stays mounted (hidden while
 * closed) so `aria-controls` always points at a real element.
 *
 * Closing paths: a second click on the button, or Escape while focus is
 * anywhere inside the component. Every close puts focus back on the button.
 *
 * ```tsx
 * <InfoDisclosure label="How dictation works" heading={<strong>Voice description</strong>}
 *   actions={<Tools />}>
 *   <p>Say a field name, then its value.</p>
 * </InfoDisclosure>
 * ```
 */
export function InfoDisclosure({
  label, heading, actions, children, defaultOpen = false, onOpenChange,
  className, headClassName, panelClassName,
}: InfoDisclosureProps) {
  const [open, setOpen] = useState(defaultOpen);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  const setAndNotify = (next: boolean) => {
    setOpen(next);
    onOpenChange?.(next);
    if (!next) buttonRef.current?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Escape' || !open) return;
    // Handled here, so a screen-level Escape listener does not also act on it.
    e.stopPropagation();
    e.preventDefault();
    setAndNotify(false);
  };

  return (
    <div className={['ui-info-disclosure', className].filter(Boolean).join(' ')} onKeyDown={onKeyDown}>
      <div className={['ui-info-disclosure__head', headClassName].filter(Boolean).join(' ')}>
        <div className="ui-info-disclosure__title">
          {heading}
          <IconButton
            ref={buttonRef}
            label={label}
            icon={<Info size={14} aria-hidden="true" />}
            size="sm"
            variant="ghost"
            className="ui-info-disclosure__btn"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setAndNotify(!open)}
          />
        </div>
        {actions}
      </div>
      <div
        id={panelId}
        role="region"
        aria-label={label}
        hidden={!open}
        tabIndex={-1}
        className={['ui-info-disclosure__panel', panelClassName].filter(Boolean).join(' ')}
      >
        {children}
      </div>
    </div>
  );
}
