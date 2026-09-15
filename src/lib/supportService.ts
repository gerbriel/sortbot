/**
 * In-app messaging, stored in our own Supabase project (`support_threads`,
 * `support_messages`, `support_thread_members`; migrations support_messaging.sql
 * and team_messaging.sql). No third-party chat service: the widget, the founder
 * inbox, the Messages page and the live updates all run here.
 *
 * TWO KINDS OF CONVERSATION share the tables, distinguished by `kind`:
 *
 *   'support'  one user ↔ the founders' shared inbox. Roles 'user' / 'founder'.
 *              A user sees only their own; Founding Workspace owners/admins see
 *              every one of them. Unchanged since the first version.
 *   'team'     a direct message between people in ONE workspace. Participants
 *              are enumerated in `support_thread_members` (the creator included,
 *              so membership is one rule), everybody posts as 'member', and
 *              FOUNDERS OF OTHER WORKSPACES CANNOT SEE IT — `is_beta_admin()`
 *              is gated on `kind = 'support'` in every policy. A founder reaches
 *              a team thread only as a participant of their own workspace.
 *
 * UNREAD is therefore two rules. Support has exactly two sides, so it is "the
 * other side wrote last, after my stamp" (user_last_read_at /
 * founder_last_read_at). A team thread has N sides, so it is "the last message
 * is not MINE, and it is newer than my stamp" — `last_sender_id` answers the
 * first half and my own `support_thread_members.last_read_at` the second.
 *
 * FORWARD-COMPATIBLE, TWICE OVER: fetchThreads() reports 'unavailable' when the
 * support tables are missing (both front ends hide), and reports
 * `teamAvailable: false` when only team_messaging.sql has not been run — the
 * support half then works exactly as it always did and the team surface hides.
 */
import { supabase } from './supabase';
import { log } from './debugLogger';

export type SupportRole = 'user' | 'founder' | 'member';
export type ThreadKind = 'support' | 'team';
export type ThreadStatus = 'open' | 'closed';

/** One participant of a team thread. Support threads carry an empty list. */
export interface ThreadMember {
  user_id: string;
  email: string | null;
  last_read_at: string | null;
}

export interface SupportThread {
  id: string;
  user_id: string;
  user_email: string | null;
  org_id: string | null;
  org_name: string | null;
  subject: string | null;
  kind: ThreadKind;
  status: ThreadStatus;
  last_message_at: string;
  last_message_preview: string | null;
  last_sender_role: SupportRole | null;
  /** Who wrote the last message. The team half of the unread test. */
  last_sender_id: string | null;
  user_last_read_at: string | null;
  founder_last_read_at: string | null;
  /** Team threads only; `[]` for support threads and pre-migration reads. */
  members: ThreadMember[];
  created_at: string;
  updated_at: string;
}

export interface SupportMessage {
  id: string;
  thread_id: string;
  sender_id: string | null;
  sender_role: SupportRole;
  body: string;
  created_at: string;
}

/** The columns support_messaging.sql shipped — the fallback select. */
const BASE_THREAD_COLS = 'id, user_id, user_email, org_id, org_name, subject, status, last_message_at, last_message_preview, last_sender_role, user_last_read_at, founder_last_read_at, created_at, updated_at';
/** …plus the two columns team_messaging.sql added. Used on writes, where the
 *  roster is either empty or about to be written by the very next statement. */
const TEAM_THREAD_WRITE_COLS = `${BASE_THREAD_COLS}, kind, last_sender_id`;
/** …and the roster, aliased to `members`. Used on reads. */
const TEAM_THREAD_COLS = `${TEAM_THREAD_WRITE_COLS}, members:support_thread_members(user_id, email, last_read_at)`;
const MESSAGE_COLS = 'id, thread_id, sender_id, sender_role, body, created_at';

/**
 * What PostgREST answers with when `team_messaging.sql` has not been run.
 *   42703    undefined column — `support_threads.kind` does not exist
 *   PGRST200 no relationship found — the embedded `support_thread_members`
 *   PGRST204 / PGRST100  column missing from the schema cache / parse failure
 * Any of them means "old schema", not "broken" — retry with the old columns.
 */
const TEAM_MISSING_CODES = new Set(['42703', 'PGRST200', 'PGRST204', 'PGRST100']);

type ThreadRow = Partial<SupportThread> & { members?: ThreadMember[] | null };

/** Fill in what an old schema cannot answer, so the rest of the app has one shape. */
function normalizeThread(row: ThreadRow): SupportThread {
  return {
    ...(row as SupportThread),
    kind: row.kind === 'team' ? 'team' : 'support',
    last_sender_id: row.last_sender_id ?? null,
    members: Array.isArray(row.members) ? row.members : [],
  };
}

export type ThreadsResult =
  | { status: 'ok'; threads: SupportThread[]; teamAvailable: boolean }
  | { status: 'unavailable' };

/**
 * Every thread RLS lets me see, in one query: my support threads (plus all of
 * them for a founder) and every team thread I am a participant of.
 */
export async function fetchThreads(): Promise<ThreadsResult> {
  const first = await supabase
    .from('support_threads')
    .select(TEAM_THREAD_COLS)
    .order('last_message_at', { ascending: false })
    .limit(300);

  if (!first.error) {
    return { status: 'ok', threads: (first.data ?? []).map(r => normalizeThread(r as ThreadRow)), teamAvailable: true };
  }

  if (!TEAM_MISSING_CODES.has(String(first.error.code ?? ''))) {
    log.service(`fetchThreads | unavailable (${first.error.code ?? ''} ${first.error.message})`);
    return { status: 'unavailable' };
  }

  // team_messaging.sql has not been run: the support half still works.
  log.service(`fetchThreads | team messaging not migrated (${first.error.code}) — support only`);
  const { data, error } = await supabase
    .from('support_threads')
    .select(BASE_THREAD_COLS)
    .order('last_message_at', { ascending: false })
    .limit(300);
  if (error) {
    log.service(`fetchThreads | unavailable (${error.code ?? ''} ${error.message})`);
    return { status: 'unavailable' };
  }
  return { status: 'ok', threads: (data ?? []).map(r => normalizeThread(r as ThreadRow)), teamAvailable: false };
}

export async function fetchMessages(threadId: string): Promise<SupportMessage[]> {
  const { data, error } = await supabase
    .from('support_messages')
    .select(MESSAGE_COLS)
    .eq('thread_id', threadId)
    .order('created_at', { ascending: true })
    .limit(500);
  if (error) {
    log.error(`fetchMessages | ${error.message}`);
    return [];
  }
  return (data ?? []) as SupportMessage[];
}

/** Which role I post as in this conversation. RLS checks it server-side too. */
export function messageRole(thread: Pick<SupportThread, 'kind'>, isFounder: boolean): SupportRole {
  if (thread.kind === 'team') return 'member';
  return isFounder ? 'founder' : 'user';
}

export async function sendMessage(threadId: string, body: string, role: SupportRole): Promise<SupportMessage | null> {
  const text = body.trim();
  if (!text) return null;
  const { data, error } = await supabase
    .from('support_messages')
    .insert({ thread_id: threadId, sender_role: role, body: text.slice(0, 4000) })
    .select(MESSAGE_COLS)
    .single();
  if (error) {
    log.error(`sendMessage | ${error.message}`);
    return null;
  }
  return data as SupportMessage;
}

export interface NewThreadInput {
  body: string;
  subject?: string;
  userEmail: string | null;
  orgName: string | null;
}

export type NewThreadResult =
  | { ok: true; thread: SupportThread; message: SupportMessage }
  | { ok: false; error: string };

/** Open a conversation with the founders (kind 'support'). */
export async function createThread(input: NewThreadInput): Promise<NewThreadResult> {
  const body = input.body.trim();
  if (!body) return { ok: false, error: 'Write a message first.' };
  const { data, error } = await supabase
    .from('support_threads')
    .insert({
      user_email: input.userEmail,
      org_name: input.orgName,
      subject: input.subject?.trim().slice(0, 140) || null,
    })
    .select(BASE_THREAD_COLS)
    .single();
  if (error || !data) {
    log.error(`createThread | ${error?.message ?? 'no row'}`);
    return { ok: false, error: error?.message ?? 'Could not start the conversation.' };
  }
  const thread = normalizeThread(data as ThreadRow);
  const message = await sendMessage(thread.id, body, 'user');
  if (!message) return { ok: false, error: 'The conversation was created but the message failed to send — try again.' };
  return { ok: true, thread, message };
}

export interface NewTeamThreadInput {
  /** Everyone except me. Each must really be in my workspace — the INSERT
   *  policy proves it against org_members, so a guessed id is rejected. */
  recipients: { user_id: string; email: string | null }[];
  /** My own participant row — the creator is a participant like anybody else. */
  me: { user_id: string; email: string | null };
  body: string;
  subject?: string;
  orgName: string | null;
}

/**
 * Start a team conversation: the thread, then the participants, then the first
 * message. Three writes, because the participant rows cannot exist before the
 * thread they hang off and the message must land after the roster (a
 * participant's `last_read_at` defaults to now(), so anyone added afterwards
 * would miss it from their unread count).
 *
 * If step 2 or 3 fails the thread is DELETED rather than left behind — a
 * half-built conversation with no participants is visible to its creator
 * forever and cannot be recovered from the UI. `support_threads_delete` exists
 * for exactly this, scoped to a team thread I created, and the FK cascade takes
 * the rows with it.
 */
export async function createTeamThread(input: NewTeamThreadInput): Promise<NewThreadResult> {
  const body = input.body.trim();
  if (!body) return { ok: false, error: 'Write a message first.' };
  if (input.recipients.length === 0) return { ok: false, error: 'Choose at least one teammate.' };

  const { data, error } = await supabase
    .from('support_threads')
    .insert({
      kind: 'team',
      user_email: input.me.email,
      org_name: input.orgName,
      subject: input.subject?.trim().slice(0, 140) || null,
    })
    .select(TEAM_THREAD_WRITE_COLS)
    .single();
  if (error || !data) {
    log.error(`createTeamThread | thread | ${error?.message ?? 'no row'}`);
    return { ok: false, error: error?.message ?? 'Could not start the conversation.' };
  }
  const thread = normalizeThread(data as ThreadRow);

  const roster = [input.me, ...input.recipients.filter(r => r.user_id !== input.me.user_id)];
  const { error: memberError } = await supabase
    .from('support_thread_members')
    .insert(roster.map(r => ({ thread_id: thread.id, user_id: r.user_id, email: r.email })));
  if (memberError) {
    log.error(`createTeamThread | members | ${memberError.message}`);
    await discardThread(thread.id);
    return { ok: false, error: 'Could not add everyone to the conversation — nothing was created.' };
  }

  const message = await sendMessage(thread.id, body, 'member');
  if (!message) {
    await discardThread(thread.id);
    return { ok: false, error: 'The message failed to send — nothing was created.' };
  }

  const at = message.created_at;
  return {
    ok: true,
    message,
    thread: {
      ...thread,
      last_message_at: at,
      last_message_preview: message.body.slice(0, 140),
      last_sender_role: 'member',
      last_sender_id: message.sender_id,
      members: roster.map(r => ({
        user_id: r.user_id,
        email: r.email,
        // I have read my own opening message; nobody else has.
        last_read_at: r.user_id === input.me.user_id ? at : thread.created_at,
      })),
    },
  };
}

/** Undo a half-built team thread. Never throws — the caller is already failing. */
async function discardThread(threadId: string): Promise<void> {
  const { error } = await supabase.from('support_threads').delete().eq('id', threadId);
  if (error) log.error(`discardThread | ${error.message}`);
}

/** Move MY read marker on one thread — a column for support, a row for team. */
export async function markThreadRead(
  thread: SupportThread, role: SupportRole, myUserId?: string | null,
): Promise<void> {
  const stamp = new Date().toISOString();
  if (thread.kind === 'team') {
    if (!myUserId) return;
    const { error } = await supabase
      .from('support_thread_members')
      .update({ last_read_at: stamp })
      .eq('thread_id', thread.id)
      .eq('user_id', myUserId);
    if (error) log.service(`markThreadRead | ${error.message}`);
    return;
  }
  const patch = role === 'founder' ? { founder_last_read_at: stamp } : { user_last_read_at: stamp };
  const { error } = await supabase.from('support_threads').update(patch).eq('id', thread.id);
  if (error) log.service(`markThreadRead | ${error.message}`);
}

export async function setThreadStatus(threadId: string, status: ThreadStatus): Promise<boolean> {
  const { error } = await supabase.from('support_threads').update({ status }).eq('id', threadId);
  if (error) log.error(`setThreadStatus | ${error.message}`);
  return !error;
}

/**
 * Live updates: any new message or thread change (that RLS lets this user
 * see) calls `onChange`. Returns the unsubscribe. If realtime is not enabled
 * for these tables nothing fires — the widget's polling covers that.
 *
 * INSERT and UPDATE only — never `'*'` (security audit 05, finding #11).
 * support_threads has `replica identity full`, and Supabase Realtime does not
 * apply RLS to DELETE payloads: subscribing to DELETE would ship a deleted
 * thread's whole OLD row (user_email, subject, last_message_preview) to every
 * subscriber the moment a founder cleans up the inbox. Deletions are picked up
 * by the widget's polling instead.
 *
 * `support_thread_members` is deliberately NOT subscribed although
 * team_messaging.sql publishes it: the only thing that changes on it is a read
 * marker, which is not news worth a render. It arrives with the next poll.
 */
export function subscribeToSupport(
  onChange: () => void,
  /** Reports the channel's own view of whether it is live. `supportStore` uses
   *  it to decide whether the poll is the PRIMARY path (Realtime is down: keep
   *  it fast) or a mere backstop (Realtime is up: stretch it right out). */
  onStatus?: (subscribed: boolean) => void,
): () => void {
  const channel = supabase
    .channel(`support-${Math.random().toString(36).slice(2, 8)}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'support_messages' }, () => onChange())
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'support_threads' }, () => onChange())
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'support_threads' }, () => onChange())
    .subscribe(status => onStatus?.(status === 'SUBSCRIBED'));
  return () => {
    void supabase.removeChannel(channel);
  };
}

// ── Pure helpers (unit-tested) ───────────────────────────────────────────────

/** My participant row on a team thread, if I have one. */
export function myMember(thread: SupportThread, myUserId?: string | null): ThreadMember | null {
  if (!myUserId) return null;
  return thread.members.find(m => m.user_id === myUserId) ?? null;
}

/** Everyone in a team conversation except me — what the row and header show. */
export function otherParticipants(thread: SupportThread, myUserId?: string | null): ThreadMember[] {
  return thread.members.filter(m => m.user_id !== myUserId);
}

/** "ana@shop.com, ben@shop.com" — or a fallback when the roster is not loaded. */
export function participantLabel(thread: SupportThread, myUserId?: string | null): string {
  const others = otherParticipants(thread, myUserId);
  if (others.length === 0) return thread.subject || 'Team conversation';
  return others.map(m => m.email ?? 'teammate').join(', ');
}

/**
 * Unread for me.
 *   support  the OTHER SIDE wrote last and it is newer than my stamp.
 *   team     the last message is NOT MINE and it is newer than my stamp. There
 *            is no "other side" to name when a conversation has four people in
 *            it, which is why `last_sender_id` exists.
 * Without a user id a team thread reads as read — a badge that cannot be
 * cleared is worse than no badge.
 */
export function isUnread(thread: SupportThread, role: SupportRole, myUserId?: string | null): boolean {
  if (thread.kind === 'team') {
    if (!myUserId || !thread.last_sender_id || thread.last_sender_id === myUserId) return false;
    const mine = myMember(thread, myUserId);
    if (!mine) return false;
    return !mine.last_read_at || thread.last_message_at > mine.last_read_at;
  }
  if (role === 'founder') {
    if (thread.last_sender_role !== 'user') return false;
    return !thread.founder_last_read_at || thread.last_message_at > thread.founder_last_read_at;
  }
  if (thread.last_sender_role !== 'founder') return false;
  return !thread.user_last_read_at || thread.last_message_at > thread.user_last_read_at;
}

export function unreadThreadCount(threads: SupportThread[], role: SupportRole, myUserId?: string | null): number {
  return threads.reduce((n, t) => n + (isUnread(t, role, myUserId) ? 1 : 0), 0);
}

/** Open before closed, unread before read, then newest activity first. */
export function sortThreads(threads: SupportThread[], role: SupportRole, myUserId?: string | null): SupportThread[] {
  return [...threads].sort((a, b) => {
    if (a.status !== b.status) return a.status === 'open' ? -1 : 1;
    const ua = isUnread(a, role, myUserId) ? 0 : 1;
    const ub = isUnread(b, role, myUserId) ? 0 : 1;
    if (ua !== ub) return ua - ub;
    return b.last_message_at.localeCompare(a.last_message_at);
  });
}

/** "just now" · "5m" · "3h" · "2d" · "Mar 3" — for thread rows and message stamps. */
export function formatRelative(iso: string, now: number = Date.now()): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
