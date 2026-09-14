import { createContext, useCallback, useContext, useId, useMemo, useRef } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import './base.css';
import './Tabs.css';

/**
 * Tabs — WAI-ARIA `tablist` pattern.
 *
 * Controlled only. The selected tab is nearly always already in the parent's
 * state (it drives what gets fetched), so an internal copy could only drift.
 *
 * KEYBOARD: exactly one tab is a tab stop (roving tabindex). Left/Right (and
 * Up/Down) move between tabs, Home/End jump to the ends, and movement wraps.
 * With `activationMode="automatic"` (the default) moving focus selects; with
 * `"manual"`, Enter or Space commits — use manual when a panel is expensive to
 * mount, so arrowing past it does not fire a fetch.
 */

interface TabsContextValue {
  value: string;
  onValueChange: (next: string) => void;
  baseId: string;
  activationMode: 'automatic' | 'manual';
}

// Not exported: the context is an implementation detail of this file, and
// exporting a non-component from a component module breaks Fast Refresh.
const TabsContext = createContext<TabsContextValue | null>(null);

function useTabsContext(who: string): TabsContextValue {
  const ctx = useContext(TabsContext);
  if (!ctx) throw new Error(`<${who}> must be rendered inside <Tabs>`);
  return ctx;
}

/** Stable id pair so a tab and its panel can point at each other. */
function tabId(baseId: string, value: string) { return `${baseId}-tab-${value}`; }
function panelId(baseId: string, value: string) { return `${baseId}-panel-${value}`; }

export interface TabsProps {
  /** `value` of the selected tab. */
  value: string;
  /** Called with the newly selected tab's `value`. */
  onValueChange: (next: string) => void;
  /**
   * `automatic` selects on focus move (default, correct for cheap panels).
   * `manual` requires Enter/Space — use it when selecting triggers a fetch.
   */
  activationMode?: 'automatic' | 'manual';
  className?: string;
  children: ReactNode;
}

export function Tabs({ value, onValueChange, activationMode = 'automatic', className, children }: TabsProps) {
  const baseId = useId();
  const ctx = useMemo<TabsContextValue>(
    () => ({ value, onValueChange, baseId, activationMode }),
    [value, onValueChange, baseId, activationMode],
  );

  return (
    <TabsContext.Provider value={ctx}>
      <div className={['ui-tabs', className].filter(Boolean).join(' ')}>{children}</div>
    </TabsContext.Provider>
  );
}

export interface TabListProps {
  /**
   * REQUIRED accessible name for the tablist — "Tabs" tells a screen-reader
   * user nothing about which set of tabs they landed in.
   */
  label: string;
  /** `pills` (default) or `underline` for a primary nav row. */
  appearance?: 'pills' | 'underline';
  className?: string;
  children: ReactNode;
}

export function TabList({ label, appearance = 'pills', className, children }: TabListProps) {
  const { value, onValueChange, activationMode } = useTabsContext('TabList');
  const listRef = useRef<HTMLDivElement | null>(null);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      const keys = ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Home', 'End'];
      if (!keys.includes(e.key)) return;
      const list = listRef.current;
      if (!list) return;

      // Queried from the DOM rather than tracked in a registry: the DOM is
      // already the source of truth for tab ORDER, and a registry would have to
      // be kept in sync with conditional tabs (the Users tab hides pre-migration).
      const tabs = Array.from(
        list.querySelectorAll<HTMLButtonElement>('[role="tab"]:not([disabled])'),
      );
      if (tabs.length === 0) return;

      const currentIndex = Math.max(0, tabs.findIndex((t) => t.dataset.value === value));
      let nextIndex = currentIndex;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') nextIndex = (currentIndex + 1) % tabs.length;
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
      else if (e.key === 'Home') nextIndex = 0;
      else if (e.key === 'End') nextIndex = tabs.length - 1;

      const next = tabs[nextIndex];
      if (!next) return;
      e.preventDefault();
      next.focus();
      if (activationMode === 'automatic') {
        const nextValue = next.dataset.value;
        if (nextValue && nextValue !== value) onValueChange(nextValue);
      }
    },
    [value, onValueChange, activationMode],
  );

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={label}
      // Arrows move within the list, so it is a single composite widget.
      aria-orientation="horizontal"
      onKeyDown={handleKeyDown}
      className={[
        'ui-tablist',
        appearance === 'underline' ? 'ui-tablist--underline' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </div>
  );
}

export interface TabProps {
  /** Identity of this tab. Matched against `Tabs.value` and the panel's `value`. */
  value: string;
  /** Leading glyph. A lucide icon; never an emoji. */
  icon?: ReactNode;
  /** Trailing count, rendered de-emphasised (Library's "Images 385"). */
  count?: number;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}

export function Tab({ value, icon, count, disabled = false, className, children }: TabProps) {
  const ctx = useTabsContext('Tab');
  const selected = ctx.value === value;

  return (
    <button
      type="button"
      role="tab"
      id={tabId(ctx.baseId, value)}
      data-value={value}
      aria-selected={selected}
      aria-controls={panelId(ctx.baseId, value)}
      // ROVING TABINDEX: one stop for the whole set, so Tab does not walk
      // through eight tabs before reaching the panel.
      tabIndex={selected ? 0 : -1}
      disabled={disabled}
      onClick={() => { if (!selected) ctx.onValueChange(value); }}
      onKeyDown={(e) => {
        // Manual activation commits the focused tab. Automatic mode already
        // selected on focus, and the native button click covers Enter/Space.
        if (ctx.activationMode === 'manual' && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          if (!selected) ctx.onValueChange(value);
        }
      }}
      className={['ui-tab', className].filter(Boolean).join(' ')}
    >
      {icon}
      {children}
      {count !== undefined && <span className="ui-tab__count">{count}</span>}
    </button>
  );
}

export interface TabPanelProps {
  /** Must match the `value` of its `Tab`. */
  value: string;
  /**
   * Keep the panel mounted (hidden) when not selected. Default is to unmount —
   * cheaper, and it resets transient panel state. Set `true` when the panel
   * holds a draft the user must not lose while switching tabs.
   */
  keepMounted?: boolean;
  className?: string;
  children: ReactNode;
}

export function TabPanel({ value, keepMounted = false, className, children }: TabPanelProps) {
  const ctx = useTabsContext('TabPanel');
  const selected = ctx.value === value;
  if (!selected && !keepMounted) return null;

  return (
    <div
      role="tabpanel"
      id={panelId(ctx.baseId, value)}
      aria-labelledby={tabId(ctx.baseId, value)}
      hidden={!selected}
      // 0, not -1: Tab from the selected tab must land on the panel content.
      tabIndex={0}
      className={['ui-tabpanel', className].filter(Boolean).join(' ')}
    >
      {children}
    </div>
  );
}
