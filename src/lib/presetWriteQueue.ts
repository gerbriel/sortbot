/**
 * One serialised write queue for the preset editor's autosave.
 *
 * Every field in CategoryPresetsManager saves itself (blur, a 600 ms typing
 * debounce, or an immediate change). They all land here:
 *
 *   enqueue(id, patch)  merges the patch into that preset's PENDING patch and
 *                       schedules a flush on the next microtask, so edits made
 *                       in the same tick become one write.
 *   per preset, ONE write is in flight at a time. Patches that arrive while it
 *                       is in flight coalesce into one follow-up write, sent
 *                       when it settles. A slow write can never be overtaken
 *                       by a later one for the same key, so the last value
 *                       typed is always the one the database keeps.
 *   retry(id)           re-sends the keys whose last write failed (any newer
 *                       pending value for the same key wins).
 *
 * Framework-free and side-effect-free apart from the callbacks, so it is unit
 * tested on its own (presetWriteQueue.test.ts).
 */

export type PresetPatch = Record<string, unknown>;

export interface PresetWriteQueueOptions<Row> {
  write: (id: string, patch: PresetPatch) => Promise<Row>;
  /** A write is about to be sent. */
  onStart?: (id: string, patch: PresetPatch) => void;
  /** The write succeeded. `stillFailing` = keys from an earlier failure remain unsent. */
  onSuccess?: (id: string, row: Row, patch: PresetPatch, stillFailing: boolean) => void;
  /** The write failed. The patch is kept for `retry`. */
  onError?: (id: string, error: unknown, patch: PresetPatch) => void;
}

export interface PresetWriteQueue {
  enqueue: (id: string, patch: PresetPatch) => void;
  retry: (id: string) => void;
  /** True while a write for `id` is in flight or waiting. */
  busy: (id: string) => boolean;
  /** The keys whose last write failed, if any. */
  failed: (id: string) => PresetPatch | null;
}

interface Slot {
  pending: PresetPatch | null;
  failed: PresetPatch | null;
  inFlight: boolean;
  scheduled: boolean;
}

export function createPresetWriteQueue<Row>(opts: PresetWriteQueueOptions<Row>): PresetWriteQueue {
  const slots = new Map<string, Slot>();

  const slot = (id: string): Slot => {
    let s = slots.get(id);
    if (!s) {
      s = { pending: null, failed: null, inFlight: false, scheduled: false };
      slots.set(id, s);
    }
    return s;
  };

  const run = async (id: string): Promise<void> => {
    const s = slot(id);
    if (s.inFlight || !s.pending) return;
    const patch = s.pending;
    s.pending = null;
    s.inFlight = true;
    opts.onStart?.(id, patch);
    let ok = true;
    let row: Row | undefined;
    let error: unknown;
    try {
      row = await opts.write(id, patch);
    } catch (e) {
      ok = false;
      error = e;
    }
    // Settled before the callbacks run, so `busy()` inside them tells the
    // truth: true only when another patch is already waiting.
    s.inFlight = false;
    if (ok) {
      if (s.failed) {
        const rest = { ...s.failed };
        for (const k of Object.keys(patch)) delete rest[k];
        s.failed = Object.keys(rest).length > 0 ? rest : null;
      }
      opts.onSuccess?.(id, row as Row, patch, s.failed !== null);
    } else {
      s.failed = { ...(s.failed ?? {}), ...patch };
      opts.onError?.(id, error, patch);
    }
    if (s.pending) void run(id);
  };

  const schedule = (id: string) => {
    const s = slot(id);
    if (s.inFlight || s.scheduled) return;
    s.scheduled = true;
    queueMicrotask(() => {
      s.scheduled = false;
      void run(id);
    });
  };

  return {
    enqueue(id, patch) {
      if (Object.keys(patch).length === 0) return;
      const s = slot(id);
      s.pending = { ...(s.pending ?? {}), ...patch };
      schedule(id);
    },
    retry(id) {
      const s = slot(id);
      if (!s.failed) return;
      // A newer value for the same key, typed after the failure, wins.
      s.pending = { ...s.failed, ...(s.pending ?? {}) };
      s.failed = null;
      schedule(id);
    },
    busy(id) {
      const s = slots.get(id);
      return !!s && (s.inFlight || s.scheduled || s.pending !== null);
    },
    failed(id) {
      return slots.get(id)?.failed ?? null;
    },
  };
}

/**
 * A PostgREST / Supabase error as one readable line: the message, then the
 * code in brackets ("Could not find the 'x' column ... (PGRST204)").
 */
export function describeSaveError(error: unknown): string {
  if (error && typeof error === 'object') {
    const e = error as { message?: unknown; code?: unknown; details?: unknown };
    const message = typeof e.message === 'string' && e.message.trim() ? e.message.trim() : 'Save failed';
    const code = typeof e.code === 'string' && e.code ? ` (${e.code})` : '';
    return `${message}${code}`;
  }
  if (typeof error === 'string' && error.trim()) return error.trim();
  return 'Save failed';
}
