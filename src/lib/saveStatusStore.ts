/**
 * Save status — one small shared store (same useSyncExternalStore pattern as
 * workflowStore) so every persistence path in the app can report into ONE
 * visible indicator: App's debounced workflow_state auto-save, Step 3's
 * debounced products save, the manual Save button, and Save Batch.
 *
 *   saveStatus.begin()            → status 'saving' (ref-counted: N writers in flight)
 *   saveStatus.end(ok, message?)  → 'saved' with lastSavedAt when the last writer
 *                                    finishes, or 'error' with the message
 *   useSaveStatus()               → { status, lastSavedAt, pending, message }
 *
 * Deliberately dependency-free and side-effect-free: it never writes anything
 * itself; it only mirrors what the writers tell it.
 */
import { useSyncExternalStore } from 'react';

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export interface SaveStatus {
  status: SaveState;
  /** Unix ms of the last successful end(); null until the first save. */
  lastSavedAt: number | null;
  /** Writers currently in flight. */
  pending: number;
  /** Last error message, cleared by the next successful end(). */
  message: string | null;
}

const initial: SaveStatus = { status: 'idle', lastSavedAt: null, pending: 0, message: null };
let state: SaveStatus = initial;
const listeners = new Set<() => void>();

function set(next: SaveStatus): void {
  state = next;
  listeners.forEach((l) => l());
}

export const saveStatus = {
  getState: (): SaveStatus => state,
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
  /** A writer started. */
  begin(): void {
    set({ ...state, status: 'saving', pending: state.pending + 1 });
  },
  /** A writer finished. Errors win over concurrent successes until the next success. */
  end(ok: boolean, message?: string): void {
    const pending = Math.max(0, state.pending - 1);
    if (!ok) {
      set({ status: 'error', lastSavedAt: state.lastSavedAt, pending, message: message ?? 'Save failed' });
      return;
    }
    if (pending > 0) {
      set({ ...state, pending });
      return;
    }
    set({ status: 'saved', lastSavedAt: Date.now(), pending: 0, message: null });
  },
  /** Test/sign-out helper. */
  reset(): void {
    set(initial);
  },
};

export function useSaveStatus(): SaveStatus {
  return useSyncExternalStore(saveStatus.subscribe, saveStatus.getState, saveStatus.getState);
}
