import { useCallback, useEffect, useRef, useState, memo } from 'react';
import { Settings, X } from 'lucide-react';
import {
  groupedShortcuts,
  platformKeys,
  splitKeys,
  detectIsMac,
  SHORTCUT_FOOTNOTE,
} from '../lib/keyboardShortcuts';
import './ShortcutsPanel.css';

/* Read once. `navigator.platform` is deprecated but still the most accurate
   answer on desktop Safari/Firefox; the UA is the fallback, and iPadOS reports
   "MacIntel" either way — both routes land on ⌘, which is correct. */
const IS_MAC =
  typeof navigator !== 'undefined' &&
  detectIsMac(navigator.platform || navigator.userAgent || '');

interface ShortcutsPanelProps {
  /** Optional controlled open state. On phones the gear FAB is hidden and the
   *  workspace menu's "Keyboard shortcuts" row opens this panel through App. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/**
 * The bottom-LEFT corner control: a gear FAB that expands a compact panel of
 * every keyboard shortcut in the app, grouped by where it applies.
 *
 * It is the mirror image of SupportWidget (bottom-right) on purpose — same FAB
 * size, same shadow, same `--tabbar-h` lift on phones — so the two bottom
 * corners read as one system rather than two accidents.
 *
 * There is no debug switch here (removed 15 Sept 2026): the logger is a
 * developer tool and is turned on from the console — `localStorage` key
 * `sortbot_debug_enabled`, see lib/debugLogger.ts — not from product UI.
 *
 * The shortcut rows are DATA, from lib/keyboardShortcuts.ts — this component
 * renders whatever is in that list and knows nothing about what any key does.
 */
function ShortcutsPanel({ open: openProp, onOpenChange }: ShortcutsPanelProps) {
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const setOpen = useCallback((next: boolean | ((prev: boolean) => boolean)) => {
    const value = typeof next === 'function' ? next(open) : next;
    setOpenState(value);
    onOpenChange?.(value);
  }, [open, onOpenChange]);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const fabRef = useRef<HTMLButtonElement | null>(null);

  /* Escape closes, and focus goes back to the button that opened it — a panel
     that closes while focus is still inside it strands keyboard users on a
     detached node. */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setOpen(false);
      fabRef.current?.focus();
    };
    const onDown = (e: MouseEvent) => {
      if (rootRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [open, setOpen]);

  /* Move focus into the panel on open so the next Tab walks its contents. */
  useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open]);

  const groups = groupedShortcuts();

  return (
    <div className="ks-root" ref={rootRef}>
      {open && (
        <div
          className="ks-panel"
          role="dialog"
          aria-label="Keyboard shortcuts"
          ref={panelRef}
          tabIndex={-1}
        >
          <div className="ks-head">
            <strong>Keyboard shortcuts</strong>
            <button
              className="ks-icon-btn"
              onClick={() => {
                setOpen(false);
                fabRef.current?.focus();
              }}
              aria-label="Close"
            >
              <X size={16} />
            </button>
          </div>

          <div className="ks-body">
            {groups.map((group) => (
              <section className="ks-group" key={group.scope}>
                <h3 className="ks-group-title">{group.label}</h3>
                {group.items.map((s) => (
                  <div className="ks-row" key={`${group.scope}-${s.keys}-${s.action}`}>
                    <span className="ks-keys">
                      {splitKeys(platformKeys(s.keys, IS_MAC)).map((token, i) => (
                        <kbd key={i}>{token}</kbd>
                      ))}
                    </span>
                    <span className="ks-action">
                      {s.action}
                      {s.when && <span className="ks-when"> — {s.when}</span>}
                    </span>
                  </div>
                ))}
              </section>
            ))}
            <p className="ks-footnote">{SHORTCUT_FOOTNOTE}</p>
          </div>
        </div>
      )}

      <button
        className={`ks-fab${open ? ' ks-fab--open' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-label="Keyboard shortcuts"
        aria-expanded={open}
        ref={fabRef}
      >
        <Settings size={18} />
      </button>
    </div>
  );
}

/* App re-renders on every store and UI change; the only props here are the
   optional `open` boolean and App's stable state setter, so the shallow compare
   bails out on everything that is not an actual open-state change. Same
   reasoning as SupportWidget. */
export default memo(ShortcutsPanel);
