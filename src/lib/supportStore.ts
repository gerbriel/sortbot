/**
 * supportStore — ONE copy of the support thread list, shared by every consumer.
 *
 * WHY IT EXISTS: support messaging has two front ends now — the floating
 * SupportWidget and the full-page MessagesView (CLAUDE.md §6, view 'messages').
 * Each used to be free to open its own Realtime channel and its own 45 s poll,
 * which would mean two channels, two timers and two thread lists that drift
 * apart the moment one of them writes.
 *
 * So the subscription is owned HERE and reference-counted: the first subscriber
 * starts the Realtime channel and the poll, the last one to leave stops them.
 * Mount the widget alone, the view alone, or both — there is exactly one
 * channel and one timer either way.
 *
 * Built on React's own `useSyncExternalStore`, mirroring `workflowStore.ts`.
 * No dependency, ~1 file.
 *
 * WHAT IT HOLDS: the thread list and the availability flag (the tables may not
 * exist yet — `fetchThreads` reports 'unavailable' and both front ends hide).
 * MESSAGES ARE NOT IN THE STORE: a conversation's messages belong to whoever
 * is reading it, and both consumers can be looking at different threads. They
 * reload theirs off `revision`, which ticks once per completed server refetch.
 *
 * SELECTOR RULE (same as workflowStore): components read the state object, and
 * derive with `useMemo` — never build an object inside the snapshot getter, or
 * `useSyncExternalStore` re-renders forever.
 */
import { useMemo, useSyncExternalStore } from 'react';
import {
  createThread, fetchMessages, fetchThreads, markThreadRead, sendMessage, setThreadStatus,
  subscribeToSupport, isUnread, sortThreads, unreadThreadCount,
  type NewThreadInput, type SupportMessage, type SupportRole, type SupportThread, type ThreadStatus,
} from './supportService';
import { log } from './debugLogger';

/** Fallback refresh interval — Realtime is the primary path, this covers the
 *  case where realtime is not enabled for the two tables (and DELETEs, which
 *  are deliberately not subscribed to; see supportService). */
export const SUPPORT_POLL_MS = 45_000;

export interface SupportStoreState {
  threads: SupportThread[];
  /** null = not checked yet · false = tables missing / unreachable · true = live. */
  available: boolean | null;
  /** Ticks once per COMPLETED server refetch. Consumers reload their open
   *  conversation's messages off this rather than off the array identity. */
  revision: number;
}

const emptyState: SupportStoreState = { threads: [], available: null, revision: 0 };

let state: SupportStoreState = emptyState;
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

function set(partial: Partial<SupportStoreState>): void {
  state = { ...state, ...partial };
  emit();
}

// ── Pure state transitions (unit-tested) ─────────────────────────────────────

/** Which column carries MY read marker. */
export function readStampKey(role: SupportRole): 'user_last_read_at' | 'founder_last_read_at' {
  return role === 'user' ? 'user_last_read_at' : 'founder_last_read_at';
}

/** Stamp my read marker on one thread. Returns the SAME array when nothing
 *  changed, so a no-op mark never re-renders anybody. */
export function applyReadStamp(
  threads: SupportThread[], threadId: string, role: SupportRole, at: string,
): SupportThread[] {
  const key = readStampKey(role);
  let touched = false;
  const next = threads.map(t => {
    if (t.id !== threadId) return t;
    touched = true;
    return { ...t, [key]: at };
  });
  return touched ? next : threads;
}

/**
 * The optimistic echo of the `support_after_message` trigger (migration
 * support_messaging.sql): a new message bumps the thread's last_* columns,
 * REOPENS a closed thread, and stamps the sender's own read marker. Mirroring
 * it here is what makes the list settle instantly instead of one refetch later.
 */
export function applySentMessage(
  threads: SupportThread[], threadId: string, body: string, role: SupportRole, at: string,
): SupportThread[] {
  return threads.map(t => (t.id === threadId ? {
    ...t,
    last_message_at: at,
    last_message_preview: body.slice(0, 140),
    last_sender_role: role,
    status: 'open' as ThreadStatus,
    [readStampKey(role)]: at,
  } : t));
}

export function applyStatus(
  threads: SupportThread[], threadId: string, status: ThreadStatus,
): SupportThread[] {
  return threads.map(t => (t.id === threadId ? { ...t, status } : t));
}

/**
 * The Messages view's list filter: an Open / Closed / All chip and one search
 * box over the four fields a founder actually scans — who wrote in, which
 * workspace they are from, the subject, and the last line of the conversation.
 * Order is preserved, so feed it an already-sorted list.
 */
export function filterThreads(
  threads: SupportThread[],
  opts: { query?: string; status?: ThreadStatus | 'all' } = {},
): SupportThread[] {
  const q = (opts.query ?? '').trim().toLowerCase();
  const status = opts.status ?? 'all';
  if (!q && status === 'all') return threads;
  return threads.filter(t => {
    if (status !== 'all' && t.status !== status) return false;
    if (!q) return true;
    return [t.user_email, t.org_name, t.subject, t.last_message_preview]
      .some(v => !!v && v.toLowerCase().includes(q));
  });
}

// ── Lifecycle: one channel + one timer, reference-counted ────────────────────

let unsubRealtime: (() => void) | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
/** Deduped in-flight refetch — a Realtime burst and the poll must not stampede. */
let inFlight: Promise<void> | null = null;

async function runRefresh(): Promise<void> {
  const r = await fetchThreads();
  if (r.status === 'unavailable') {
    // Deliberately does NOT stop the poll: fetchThreads reports 'unavailable'
    // for a transient network failure too, and stopping here would hide
    // messaging until the next full page load.
    set({ available: false, revision: state.revision + 1 });
    return;
  }
  set({ threads: r.threads, available: true, revision: state.revision + 1 });
}

/** Refetch the thread list. Concurrent callers share one round-trip. */
function refresh(): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = runRefresh().finally(() => { inFlight = null; });
  return inFlight;
}

function start(): void {
  void refresh();
  unsubRealtime = subscribeToSupport(() => { void refresh(); });
  pollTimer = setInterval(() => { void refresh(); }, SUPPORT_POLL_MS);
  log.service('supportStore | live updates started');
}

function stop(): void {
  unsubRealtime?.();
  unsubRealtime = null;
  if (pollTimer !== null) clearInterval(pollTimer);
  pollTimer = null;
  log.service('supportStore | live updates stopped');
}

export const supportStore = {
  /** Live read — safe inside any async callback. */
  getState(): SupportStoreState {
    return state;
  },

  /** Subscribing starts the shared channel + timer; the last unsubscribe stops them. */
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    if (listeners.size === 1) start();
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) stop();
    };
  },

  /** Signing out: drop the previous account's threads so nothing flashes on
   *  the next sign-in. Also the reset hook for tests. */
  reset(): void {
    if (listeners.size > 0) stop();
    listeners.clear();
    state = emptyState;
    inFlight = null;
  },

  /** Test/diagnostic view of the shared lifecycle. */
  isLive(): boolean {
    return pollTimer !== null;
  },
};

// ── Write actions: optimistic first, then reconcile with the server ──────────

export const supportActions = {
  refresh,

  /** Stamp my read marker — locally at once, then in the DB. No-op when the
   *  thread is already read for me, so it is safe to call on every poll. */
  markRead(threadId: string, role: SupportRole): void {
    const t = state.threads.find(x => x.id === threadId);
    if (!t || !isUnread(t, role)) return;
    set({ threads: applyReadStamp(state.threads, threadId, role, new Date().toISOString()) });
    void markThreadRead(threadId, role);
  },

  /** Open a conversation: its messages, and my read marker cleared. */
  async openThread(threadId: string, role: SupportRole): Promise<SupportMessage[]> {
    supportActions.markRead(threadId, role);
    return fetchMessages(threadId);
  },

  /** Reload one conversation without touching read state (polls, Realtime). */
  loadMessages(threadId: string): Promise<SupportMessage[]> {
    return fetchMessages(threadId);
  },

  /** Post into an existing thread. Returns null when the insert failed. */
  async send(threadId: string, body: string, role: SupportRole): Promise<SupportMessage | null> {
    const m = await sendMessage(threadId, body, role);
    if (!m) return null;
    set({ threads: applySentMessage(state.threads, threadId, m.body, role, m.created_at) });
    void refresh();
    log.app(`support | message sent as ${role}`);
    return m;
  },

  /** Start a new conversation (users only — founders always reply into one). */
  async startThread(input: NewThreadInput) {
    const r = await createThread(input);
    if (r.ok) {
      set({ threads: [r.thread, ...state.threads.filter(t => t.id !== r.thread.id)] });
      void refresh();
      log.app('support | conversation started');
    }
    return r;
  },

  /** Close / reopen (founders). */
  async setStatus(threadId: string, status: ThreadStatus): Promise<boolean> {
    const ok = await setThreadStatus(threadId, status);
    if (ok) {
      set({ threads: applyStatus(state.threads, threadId, status) });
      void refresh();
    }
    return ok;
  },
};

// ── React binding ────────────────────────────────────────────────────────────

export interface UseSupportThreads {
  /** Raw list, server order (newest activity first). */
  threads: SupportThread[];
  /** Ordered for `role`: open before closed, unread before read, newest first. */
  sorted: SupportThread[];
  available: boolean | null;
  /** How many threads are waiting on `role`. Drives both unread badges. */
  unreadCount: number;
  /** Ticks per completed refetch — the dependency for "reload my messages". */
  revision: number;
  refresh: () => Promise<void>;
}

/**
 * Subscribe to the shared thread list from `role`'s point of view.
 *
 * Mounting this hook is what starts the Realtime channel and the poll, so call
 * it only from components that are on screen for a signed-in user — a
 * logged-out visitor must not be querying `support_threads`.
 */
export function useSupportThreads(role: SupportRole): UseSupportThreads {
  const snapshot = useSyncExternalStore(
    supportStore.subscribe,
    supportStore.getState,
    supportStore.getState,
  );
  const { threads, available, revision } = snapshot;
  const sorted = useMemo(() => sortThreads(threads, role), [threads, role]);
  const unreadCount = useMemo(() => unreadThreadCount(threads, role), [threads, role]);
  return { threads, sorted, available, unreadCount, revision, refresh };
}
