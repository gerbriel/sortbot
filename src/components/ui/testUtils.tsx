/* ── Test harness for the ui/ primitives ────────────────────────────────────
   NOT a test file (no `.test.` in the name, so Vitest does not collect it).

   There is no @testing-library here and none may be added — the project's rule
   is no new dependencies. React 19 ships everything needed: `createRoot` from
   react-dom/client plus `act` from react, running against happy-dom.

   `act` is what makes assertions deterministic: it flushes effects and state
   updates before returning, so a test can read the DOM immediately after a
   click instead of waiting on a microtask. */

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import type { ReactNode } from 'react';

// React only flushes act() work when it knows it is in a test environment.
// Without this, every act() call logs a warning and updates leak past it.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export interface Mounted {
  container: HTMLElement;
  /** Re-render with new props/children, flushed. */
  rerender: (next: ReactNode) => void;
  unmount: () => void;
}

const active: Array<{ root: Root; container: HTMLElement }> = [];

/** Mounts `ui` into a detached-but-attached container and flushes effects. */
export function mount(ui: ReactNode): Mounted {
  const container = document.createElement('div');
  // Must be IN the document: focus(), :focus-visible and offsetParent (the
  // Dialog focus trap's visibility filter) all return nothing for a detached tree.
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => { root.render(ui); });
  active.push({ root, container });

  return {
    container,
    rerender: (next: ReactNode) => { act(() => { root.render(next); }); },
    unmount: () => { act(() => { root.unmount(); }); container.remove(); },
  };
}

/** Unmounts everything `mount` created. Call from `afterEach`. */
export function cleanup() {
  while (active.length > 0) {
    const entry = active.pop();
    if (!entry) break;
    act(() => { entry.root.unmount(); });
    entry.container.remove();
  }
  document.body.innerHTML = '';
}

/** Clicks an element the way a user would, inside act(). */
export function click(el: Element | null | undefined) {
  if (!el) throw new Error('click(): element not found');
  act(() => {
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

/** Dispatches a keydown from `el` (defaults to the focused element). */
export function keyDown(
  key: string,
  el?: Element | null,
  init: Partial<KeyboardEventInit> = {},
) {
  const target = el ?? document.activeElement ?? document.body;
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init }));
  });
}

/** Moves focus and fires the focusout/focusin pair React needs for onBlur. */
export function focusElement(el: HTMLElement | null | undefined, related?: HTMLElement | null) {
  if (!el) throw new Error('focusElement(): element not found');
  const previous = document.activeElement as HTMLElement | null;
  act(() => {
    el.focus();
    if (previous && previous !== el) {
      previous.dispatchEvent(
        new FocusEvent('focusout', { bubbles: true, relatedTarget: related ?? el }),
      );
    }
  });
}

/** All elements matching `selector` inside `container`. */
export function all(container: HTMLElement, selector: string): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(selector));
}

/** First element matching `selector`, or throws — keeps tests free of `!`. */
export function one(container: ParentNode, selector: string): HTMLElement {
  const el = container.querySelector<HTMLElement>(selector);
  if (!el) throw new Error(`one(): no element matched ${selector}`);
  return el;
}

/** Finds a button by its exact trimmed text. */
export function buttonByText(container: ParentNode, text: string): HTMLElement {
  const match = Array.from(container.querySelectorAll<HTMLElement>('button')).find(
    (b) => (b.textContent ?? '').trim() === text,
  );
  if (!match) throw new Error(`buttonByText(): no button labelled "${text}"`);
  return match;
}
