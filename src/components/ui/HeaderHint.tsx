import { useId, useRef, useState } from 'react';
import type { FocusEvent, KeyboardEvent, ReactNode } from 'react';
import { Info } from 'lucide-react';
import { IconButton } from './IconButton';
import './base.css';
import './HeaderHint.css';

export interface HeaderHintProps {
  /** The column header's own text ("Assignable"). Rendered before the button. */
  children: ReactNode;
  /**
   * REQUIRED. The info button's accessible name ("What Assignable means"). A
   * bare Info glyph says nothing on its own.
   */
  label: string;
  /** The explanation itself, shown in the tooltip under the header. */
  hint: ReactNode;
  /**
   * Which edge the tooltip lines up with. 'start' (default) hangs it from the
   * header's left edge; 'end' from its right edge, for the last columns, so a
   * tooltip never runs past the right of the page.
   */
  align?: 'start' | 'end';
  className?: string;
}

/**
 * A column header with an info button that explains the column.
 *
 * The explanation is a `role="tooltip"` element, always mounted (hidden while
 * closed) and linked to the button by `aria-describedby`, so a screen reader
 * hears it on focus whether or not it is showing. It opens on hover and on
 * focus, and a click or tap TOGGLES it, because a phone has no hover. Escape
 * and blur close it. Hovering the tooltip itself keeps it open, so the text
 * can be read with the pointer resting on it.
 *
 * ```tsx
 * <th scope="col">
 *   <HeaderHint label="What Order means" hint="Position in every plan dropdown.">Order</HeaderHint>
 * </th>
 * ```
 */
export function HeaderHint({ children, label, hint, align = 'start', className }: HeaderHintProps) {
  const [open, setOpen] = useState(false);
  // Set by a click or tap; a pinned tooltip ignores the pointer leaving.
  const pinned = useRef(false);
  const tipId = useId();

  const close = () => {
    pinned.current = false;
    setOpen(false);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLSpanElement>) => {
    if (e.key !== 'Escape' || !open) return;
    // Handled here, so ToolView's Escape-to-back does not also act on it.
    e.stopPropagation();
    e.preventDefault();
    close();
  };

  const onBlur = (e: FocusEvent<HTMLButtonElement>) => {
    const next = e.relatedTarget as Node | null;
    if (next && e.currentTarget.parentElement?.contains(next)) return;
    close();
  };

  return (
    <span
      className={['ui-header-hint', className].filter(Boolean).join(' ')}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => { if (!pinned.current) setOpen(false); }}
      onKeyDown={onKeyDown}
    >
      <span className="ui-header-hint__text">{children}</span>
      <IconButton
        label={label}
        title=""
        icon={<Info size={16} aria-hidden="true" />}
        size="sm"
        variant="ghost"
        className="ui-header-hint__btn"
        aria-describedby={tipId}
        data-open={open ? 'true' : undefined}
        onFocus={() => setOpen(true)}
        onBlur={onBlur}
        onClick={() => {
          if (pinned.current) { close(); return; }
          pinned.current = true;
          setOpen(true);
        }}
      />
      <span
        id={tipId}
        role="tooltip"
        hidden={!open}
        className={`ui-header-hint__tip ui-header-hint__tip--${align}`}
      >
        {hint}
      </span>
    </span>
  );
}
