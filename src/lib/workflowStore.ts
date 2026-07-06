import { useSyncExternalStore } from 'react';
import type { ClothingItem } from '../App';

/**
 * workflowStore — dependency-free shared store (refactor Stage 2 foundation).
 *
 * WHY: the item arrays currently live in App.tsx state AND a duplicated copy
 * inside ProductDescriptionGenerator, synced by prop-down/callback-up with
 * suppression flags (isResettingRef) — the source of a whole bug family.
 * Async handlers additionally need ref mirrors (uploadedImagesRef, …) because
 * closures capture stale state.
 *
 * This store fixes both by construction:
 *   - ONE copy of the data; every component reads it via useWorkflowStore().
 *   - workflowStore.getState() always returns the LIVE state — async
 *     callbacks, setTimeout handlers, and event listeners can read it
 *     directly. No more ref mirrors, ever.
 *
 * It is ~40 lines on React's built-in useSyncExternalStore — no library.
 *
 * MIGRATION PLAN (one consumer per PR, app works identically after each):
 *   1. PDG drops its local processedItems copy + isResettingRef.
 *   2. App.tsx handlers move from setState+refs to store updates.
 *   3. The four xxxRef mirrors in App.tsx are deleted.
 *
 * SELECTOR RULE: selectors passed to useWorkflowStore must return values that
 * are referentially stable when unchanged (i.e. return state slices directly,
 * like s => s.processedItems — never build a new object/array in a selector,
 * or the component re-renders on every store change).
 */

export interface WorkflowStoreState {
  uploadedImages: ClothingItem[];
  groupedImages: ClothingItem[];
  sortedImages: ClothingItem[];
  processedItems: ClothingItem[];
  currentBatchId: string | null;
}

type Updater = Partial<WorkflowStoreState>
  | ((prev: WorkflowStoreState) => Partial<WorkflowStoreState>);

const initialState: WorkflowStoreState = {
  uploadedImages: [],
  groupedImages: [],
  sortedImages: [],
  processedItems: [],
  currentBatchId: null,
};

let state: WorkflowStoreState = initialState;
const listeners = new Set<() => void>();

export const workflowStore = {
  /** Live read — safe inside any async callback (replaces the ref-mirror pattern). */
  getState(): WorkflowStoreState {
    return state;
  },

  /** Merge a partial update (object or updater function) and notify subscribers. */
  setState(update: Updater): void {
    const partial = typeof update === 'function' ? update(state) : update;
    state = { ...state, ...partial };
    for (const l of listeners) l();
  },

  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  /** Reset to empty — sign-out, active-batch deletion, tests. */
  reset(): void {
    workflowStore.setState(initialState);
  },
};

/** React hook: subscribe a component to a slice of the store. */
export function useWorkflowStore<T>(selector: (s: WorkflowStoreState) => T): T {
  return useSyncExternalStore(
    workflowStore.subscribe,
    () => selector(state),
    () => selector(state),
  );
}
