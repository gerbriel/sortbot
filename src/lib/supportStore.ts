/**
 * supportStore — ONE copy of the support thread list, shared by every consumer.
 *
 * WHY IT EXISTS: support messaging has two front ends now — the floating
 * SupportWidget and the full-page MessagesView (AGENTS.md §6, view 'messages').
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
  createTeamThread, createThread, fetchMessages, fetchThreads, markThreadRead, sendMessage, setThreadStatus,
  subscribeToSupport, isUnread, sortThreads, unreadThreadCount,
  type NewTeamThreadInput, type NewThreadInput, type SupportMessage, type SupportRole,
  type SupportThread, type ThreadKind, type ThreadStatus,
} from './supportService';
import { log } from './debugLogger';

/** Fallback refresh interval — Realtime is the primary path, this covers the
 *  case where realtime is not enabled for the two tables (and DELETEs, which
 *  are deliberately not subscribed to; see supportService). */
export const SUPPORT_POLL_MS = 45_000;

/** Poll interval once the Realtime channel reports SUBSCRIBED. At that point the
 *  channel delivers every INSERT and thread UPDATE within milliseconds and the
 *  timer's only remaining job is covering DELETEs (not subscribed) and a channel
 *  that dies without telling us — a 3-minute backstop, not a refresh loop. */
export const SUPPORT_POLL_SUBSCRIBED_MS = 180_000;

/**
 * How often to re-read the thread list, given what the channel and the tab are
 * doing. Pure — this is the whole decision, and it is unit-tested.
 *
 * `null` means DO NOT POLL AT ALL: a hidden tab has nothing to render and
 * nobody to render it for, and browsers already throttle its timers to ~1/min
 * — so the only thing a background poll reliably produces is Postgres load,
 * multiplied by every stale tab every user has left open. The store refetches
 * immediately on visibility regain, so a returning tab is never stale.
 */
export function supportPollInterval(
  visible: boolean,
  realtimeSubscribed: boolean,
): number | null {
  if (!visible) return null;
  return realtimeSubscribed ? SUPPORT_POLL_SUBSCRIBED_MS : SUPPORT_POLL_MS;
}

export interface SupportStoreState {
  threads: SupportThread[];
  /** null = not checked yet · false = tables missing / unreachable · true = live. */
  available: boolean | null;
  /** false = team_messaging.sql has not been run. Support messaging still works
   *  in full; the team surface (the picker, the kind chips) hides itself. */
  teamAvailable: boolean;
  /** Ticks once per COMPLETED server refetch. Consumers reload their open
   *  conversation's messages off this rather than off the array identity. */
  revision: number;
}

const emptyState: SupportStoreState = { threads: [], available: null, teamAvailable: false, revision: 0 };

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

/** Stamp my read marker on one thread — a COLUMN on a support thread, a ROW in
 *  the participant list on a team one. Returns the SAME array when nothing
 *  changed, so a no-op mark never re-renders anybody. */
export function applyReadStamp(
  threads: SupportThread[], threadId: string, role: SupportRole, at: string, myUserId?: string | null,
): SupportThread[] {
  let touched = false;
  const next = threads.map(t => {
    if (t.id !== threadId) return t;
    if (t.kind === 'team') {
      // Without an id there is no row of mine to stamp; leave the list alone
      // rather than guess (the same rule isUnread applies).
      if (!myUserId || !t.members.some(m => m.user_id === myUserId)) return t;
      touched = true;
      return { ...t, members: t.members.map(m => (m.user_id === myUserId ? { ...m, last_read_at: at } : m)) };
    }
    touched = true;
    return { ...t, [readStampKey(role)]: at };
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
  senderId: string | null = null,
): SupportThread[] {
  return threads.map(t => {
    if (t.id !== threadId) return t;
    const base: SupportThread = {
      ...t,
      last_message_at: at,
      last_message_preview: body.slice(0, 140),
      last_sender_role: role,
      last_sender_id: senderId,
      status: 'open' as ThreadStatus,
    };
    // A team thread has no user/founder read columns: the sender's own
    // participant row is what the trigger stamps.
    if (role === 'member') {
      return senderId
        ? { ...base, members: base.members.map(m => (m.user_id === senderId ? { ...m, last_read_at: at } : m)) }
        : base;
    }
    return { ...base, [readStampKey(role)]: at };
  });
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
  opts: { query?: string; status?: ThreadStatus | 'all'; kind?: ThreadKind | 'all' } = {},
): SupportThread[] {
  const q = (opts.query ?? '').trim().toLowerCase();
  const status = opts.status ?? 'all';
  const kind = opts.kind ?? 'all';
  if (!q && status === 'all' && kind === 'all') return threads;
  return threads.filter(t => {
    if (status !== 'all' && t.status !== status) return false;
    if (kind !== 'all' && t.kind !== kind) return false;
    if (!q) return true;
    // Participants are searched too — on a team thread the emails ARE the name
    // of the conversation, and nothing else in the row carries them.
    return [t.user_email, t.org_name, t.subject, t.last_message_preview, ...t.members.map(m => m.email)]
      .some(v => !!v && v.toLowerCase().includes(q));
  });
}

// ── Lifecycle: one channel + one timer, reference-counted ────────────────────

let unsubRealtime: (() => void) | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
/** Deduped in-flight refetch — a Realtime burst and the poll must not stampede. */
let inFlight: Promise<void> | null = null;
/** Last interval `applyPollInterval` installed, so a no-op change doesn't churn
 *  the timer (and reset its phase) on every visibility flicker. */
let pollIntervalMs: number | null = null;
let realtimeSubscribed = false;
let onVisibility: (() => void) | null = null;

function documentVisible(): boolean {
  // `document` is absent in a non-DOM test env; treat that as visible so the
  // store behaves exactly as it does today when nothing is driving visibility.
  return typeof document === 'undefined' || document.visibilityState === 'visible';
}

async function runRefresh(): Promise<void> {
  const r = await fetchThreads();
  if (r.status === 'unavailable') {
    // Deliberately does NOT stop the poll: fetchThreads reports 'unavailable'
    // for a transient network failure too, and stopping here would hide
    // messaging until the next full page load.
    set({ available: false, revision: state.revision + 1 });
    return;
  }
  set({ threads: r.threads, available: true, teamAvailable: r.teamAvailable, revision: state.revision + 1 });
}

/** Refetch the thread list. Concurrent callers share one round-trip. */
function refresh(): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = runRefresh().finally(() => { inFlight = null; });
  return inFlight;
}

/** Install the interval the current (visibility, channel) state calls for. */
function applyPollInterval(): void {
  const next = supportPollInterval(documentVisible(), realtimeSubscribed);
  if (next === pollIntervalMs) return;
  pollIntervalMs = next;
  if (pollTimer !== null) { clearInterval(pollTimer); pollTimer = null; }
  if (next !== null) pollTimer = setInterval(() => { void refresh(); }, next);
  log.service(`supportStore | poll interval → ${next === null ? 'paused (tab hidden)' : `${next / 1000}s`}`);
}

function start(): void {
  void refresh();
  realtimeSubscribed = false;
  unsubRealtime = subscribeToSupport(
    () => { void refresh(); },
    subscribed => { realtimeSubscribed = subscribed; applyPollInterval(); },
  );
  onVisibility = () => {
    // Coming back to the tab: refetch at once, so "paused while hidden" can
    // never show a stale list. Then re-install the right interval.
    if (documentVisible()) void refresh();
    applyPollInterval();
  };
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibility);
  }
  applyPollInterval();
  log.service('supportStore | live updates started');
}

function stop(): void {
  unsubRealtime?.();
  unsubRealtime = null;
  if (typeof document !== 'undefined' && onVisibility) {
    document.removeEventListener('visibilitychange', onVisibility);
  }
  onVisibility = null;
  realtimeSubscribed = false;
  if (pollTimer !== null) clearInterval(pollTimer);
  pollTimer = null;
  pollIntervalMs = null;
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
    // Unconditional: every branch of stop() is null-guarded, so it is a no-op
    // when nothing is running — and it is the only thing that removes the
    // visibilitychange listener.
    stop();
    listeners.clear();
    state = emptyState;
    inFlight = null;
  },

  /** Test/diagnostic view of the shared lifecycle. `isLive` means "subscribed",
   *  which is no longer the same as "a timer is running" — a hidden tab is
   *  still live, it just is not polling. */
  isLive(): boolean {
    return unsubRealtime !== null;
  },

  /** Test/diagnostic: the interval currently installed (null = not polling). */
  pollIntervalMs(): number | null {
    return pollIntervalMs;
  },
};

// ── Write actions: optimistic first, then reconcile with the server ──────────

export const supportActions = {
  refresh,

  /** Stamp my read marker — locally at once, then in the DB. No-op when the
   *  thread is already read for me, so it is safe to call on every poll. */
  markRead(threadId: string, role: SupportRole, myUserId?: string | null): void {
    const t = state.threads.find(x => x.id === threadId);
    if (!t || !isUnread(t, role, myUserId)) return;
    set({ threads: applyReadStamp(state.threads, threadId, role, new Date().toISOString(), myUserId) });
    void markThreadRead(t, role, myUserId);
  },

  /** Open a conversation: its messages, and my read marker cleared. */
  async openThread(threadId: string, role: SupportRole, myUserId?: string | null): Promise<SupportMessage[]> {
    supportActions.markRead(threadId, role, myUserId);
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
    set({ threads: applySentMessage(state.threads, threadId, m.body, role, m.created_at, m.sender_id) });
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

  /** Start a conversation with people in my own workspace (kind 'team'). */
  async startTeamThread(input: NewTeamThreadInput) {
    const r = await createTeamThread(input);
    if (r.ok) {
      set({ threads: [r.thread, ...state.threads.filter(t => t.id !== r.thread.id)] });
      void refresh();
      log.app(`support | team conversation started with ${input.recipients.length}`);
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
  /** false until team_messaging.sql has been run (support still works). */
  teamAvailable: boolean;
  /** Everything waiting on me, support and team. The header trigger and the
   *  Inbox row count this. */
  unreadCount: number;
  /** SUPPORT threads only — the floating widget's badge, which never shows
   *  team conversations (they live on the Messages page). */
  supportUnreadCount: number;
  /** Ticks per completed refetch — the dependency for "reload my messages". */
  revision: number;
  refresh: () => Promise<void>;
}

/**
 * Subscribe to the shared thread list from `role`'s point of view. `myUserId`
 * is what makes team unread computable — a team conversation has N sides, so
 * "is this waiting on me?" is answered by my own participant row, not by a
 * user/founder column. Omit it and team threads simply never read as unread.
 *
 * Mounting this hook is what starts the Realtime channel and the poll, so call
 * it only from components that are on screen for a signed-in user — a
 * logged-out visitor must not be querying `support_threads`.
 */
export function useSupportThreads(role: SupportRole, myUserId?: string | null): UseSupportThreads {
  const snapshot = useSyncExternalStore(
    supportStore.subscribe,
    supportStore.getState,
    supportStore.getState,
  );
  const { threads, available, teamAvailable, revision } = snapshot;
  const sorted = useMemo(() => sortThreads(threads, role, myUserId), [threads, role, myUserId]);
  const unreadCount = useMemo(() => unreadThreadCount(threads, role, myUserId), [threads, role, myUserId]);
  const supportUnreadCount = useMemo(
    () => unreadThreadCount(threads.filter(t => t.kind !== 'team'), role, myUserId),
    [threads, role, myUserId],
  );
  return { threads, sorted, available, teamAvailable, unreadCount, supportUnreadCount, revision, refresh };
}
