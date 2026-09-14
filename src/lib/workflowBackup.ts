/**
 * workflowBackup — the synchronous localStorage safety net for in-flight work.
 *
 * WHY IT EXISTS: the Supabase `workflow_state` write is debounced 2 s (AGENTS.md §11:
 * never below 1 000 ms). A page refresh inside that window would lose every grouping /
 * category change made since the last successful round trip, so App also mirrors the
 * items into `localStorage` under the key below and reads them back on startup restore.
 *
 * WHY IT IS THROTTLED (perf finding F7): the write was deliberately un-debounced and
 * ran on all seven `autoSaveWorkflow` call sites — i.e. on every group click, every
 * category assignment and every Step-3 keystroke. At 1 500 items the payload measured
 * **393 KB**, so each one was a 1 500-element `map` + a 393 KB `JSON.stringify` + a
 * *blocking* `setItem`, on the main thread, in the middle of a drag. A 50-click burst
 * paid that 50 times over.
 *
 * The throttle is TRAILING and does NOT reset on later calls: the first schedule opens
 * a window, the newest payload in that window is what gets written when it closes, and
 * the window is at most BACKUP_THROTTLE_MS long. A debounce would have been wrong here —
 * a continuous stream of clicks would keep pushing the write out indefinitely and the
 * guarantee would evaporate exactly when the user is busiest.
 *
 * WHAT KEEPS THE GUARANTEE INTACT: `flushWorkflowBackup()` writes the pending payload
 * immediately, and App wires it to `pagehide` + `beforeunload`. So the worst case is
 * still "everything up to the moment the tab went away", as before — the only thing
 * that changed is that the write now happens once per second instead of once per click.
 *
 * `sortbot_workflow_backup` MUST NOT be renamed (AGENTS.md §1 naming table) — renaming
 * it silently drops every user's in-progress batch on their next load.
 */

/** The localStorage key. Load-bearing name — see AGENTS.md §1. */
export const WORKFLOW_BACKUP_KEY = 'sortbot_workflow_backup';

/** Trailing-throttle window. Kept well under the 2 s Supabase debounce: the backup's
 *  only job is winning a refresh race against that write. */
export const BACKUP_THROTTLE_MS = 1000;

export interface WorkflowBackupPayload {
  batchId: string;
  savedAt: number;
  items: unknown[];
}

/** Builds the payload lazily, so the throttle window writes the NEWEST snapshot
 *  scheduled inside it rather than the one that happened to open it. Returning
 *  `null` means "nothing worth backing up" (no items, or no batch id yet). */
type PayloadBuilder = () => WorkflowBackupPayload | null;

let pendingBuild: PayloadBuilder | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

/** Number of `setItem` calls actually issued — test-only observability. */
let writeCount = 0;

function writeNow(): void {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  const build = pendingBuild;
  pendingBuild = null;
  if (!build) return;

  let payload: WorkflowBackupPayload | null;
  try {
    payload = build();
  } catch (err) {
    // A throw here means the caller's snapshot was unusable; the next scheduled
    // write will try again. Never let it escape into a mousemove handler.
    console.warn('[workflowBackup] could not build payload:', err);
    return;
  }
  if (!payload) return;

  try {
    localStorage.setItem(WORKFLOW_BACKUP_KEY, JSON.stringify(payload));
    writeCount++;
  } catch (err) {
    // QuotaExceededError used to be swallowed by a bare `catch {}`, so the safety
    // net could be dead for a whole session with nothing to show for it. Log it —
    // the Supabase write is still the authoritative save, so this stays non-fatal.
    console.warn('[workflowBackup] backup skipped (localStorage full or unavailable):', err);
  }
}

/**
 * Queue a backup write. At most one `setItem` per BACKUP_THROTTLE_MS; the last
 * builder handed in before the window closes is the one that gets written.
 */
export function scheduleWorkflowBackup(build: PayloadBuilder): void {
  pendingBuild = build;
  if (timer !== null) return;   // window already open — do NOT restart it (trailing throttle)
  timer = setTimeout(() => {
    timer = null;
    writeNow();
  }, BACKUP_THROTTLE_MS);
}

/** Write any pending payload right now. Wired to `pagehide` / `beforeunload` so a
 *  refresh inside the throttle window still persists the newest state. No-op when
 *  nothing is pending. */
export function flushWorkflowBackup(): void {
  writeNow();
}

/** Drop a pending write without performing it. Used when the active batch is deleted:
 *  a queued write landing after `localStorage.removeItem` would resurrect the backup
 *  for a batch that no longer exists. */
export function cancelWorkflowBackup(): void {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  pendingBuild = null;
}

/** Test hook — clears the pending write, the timer and the write counter. */
export function __resetWorkflowBackupForTests(): void {
  cancelWorkflowBackup();
  writeCount = 0;
}

/** Test hook — how many `setItem` calls have been issued, and whether one is queued. */
export function __workflowBackupStatsForTests(): { writes: number; pending: boolean } {
  return { writes: writeCount, pending: pendingBuild !== null };
}
