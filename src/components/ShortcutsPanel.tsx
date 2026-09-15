import { useCallback, useEffect, useRef, useState, memo } from 'react';
import { Settings, X, Bug } from 'lucide-react';
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
  /** Current state of the debug logger (App owns it — this is a view of it). */
  debugEnabled: boolean;
  /** App's existing toggleDebug handler, moved in here unchanged. */
  onToggleDebug: () => void;
  /** Optional controlled open state. On phones the gear FAB is hidden and the
   *  workspace menu's "Shortcuts & debug" row opens this panel through App. */
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
 * The debug-logging switch lives at the bottom of the panel. It used to be its
 * own floating button in this corner, which meant a developer affordance was
 * permanently occupying prime screen real estate (and was simply hidden on
 * phones, where the tab bar wanted the same pixels). One corner, one control.
 *
 * The shortcut rows are DATA, from lib/keyboardShortcuts.ts — this component
 * renders whatever is in that list and knows nothing about what any key does.
 */
function ShortcutsPanel({ debugEnabled, onToggleDebug, open: openProp, onOpenChange }: ShortcutsPanelProps) {
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

          {/* Developer row — the old floating debug button, rehoused. */}
          <div className="ks-foot">
            <span className="ks-foot-label">
              <Bug size={13} /> Debug logging
            </span>
            <button
              className={`ks-switch${debugEnabled ? ' ks-switch--on' : ''}`}
              role="switch"
              aria-checked={debugEnabled}
              onClick={onToggleDebug}
              title={
                debugEnabled
                  ? 'Debug logging ON — click to disable'
                  : 'Debug logging OFF — click to enable'
              }
            >
              <span className="ks-switch-knob" />
            </button>
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

/* App re-renders on every store and UI change; both props here are primitives
   and `onToggleDebug` is stable, so the shallow compare bails out on everything
   that is not an actual debug-state change. Same reasoning as SupportWidget. */
export default memo(ShortcutsPanel);
