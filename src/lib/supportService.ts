/**
 * In-app support messaging — conversations between a signed-in user and the
 * founders, stored in our own Supabase project (`support_threads`,
 * `support_messages`; migration support_messaging.sql). No third-party chat
 * service: the widget, the founder inbox and the live updates all run here.
 *
 * ROLES: a user sees only their own threads and posts as 'user'; Founding
 * Workspace owners/admins see every thread (the inbox) and post as 'founder'.
 * RLS enforces both — the role passed from the client is checked server-side.
 *
 * FORWARD-COMPATIBLE: fetchThreads() reports 'unavailable' when the tables
 * are missing, and the widget hides itself entirely.
 */
import { supabase } from './supabase';
import { log } from './debugLogger';

export type SupportRole = 'user' | 'founder';
export type ThreadStatus = 'open' | 'closed';

export interface SupportThread {
  id: string;
  user_id: string;
  user_email: string | null;
  org_id: string | null;
  org_name: string | null;
  subject: string | null;
  status: ThreadStatus;
  last_message_at: string;
  last_message_preview: string | null;
  last_sender_role: SupportRole | null;
  user_last_read_at: string | null;
  founder_last_read_at: string | null;
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

const THREAD_COLS = 'id, user_id, user_email, org_id, org_name, subject, status, last_message_at, last_message_preview, last_sender_role, user_last_read_at, founder_last_read_at, created_at, updated_at';
const MESSAGE_COLS = 'id, thread_id, sender_id, sender_role, body, created_at';

export type ThreadsResult = { status: 'ok'; threads: SupportThread[] } | { status: 'unavailable' };

/** Own threads for users, every thread for founders — RLS decides, one query. */
export async function fetchThreads(): Promise<ThreadsResult> {
  const { data, error } = await supabase
    .from('support_threads')
    .select(THREAD_COLS)
    .order('last_message_at', { ascending: false })
    .limit(300);
  if (error) {
    log.service(`fetchThreads | unavailable (${error.code ?? ''} ${error.message})`);
    return { status: 'unavailable' };
  }
  return { status: 'ok', threads: (data ?? []) as SupportThread[] };
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

export async function createThread(input: NewThreadInput): Promise<{ ok: true; thread: SupportThread; message: SupportMessage } | { ok: false; error: string }> {
  const body = input.body.trim();
  if (!body) return { ok: false, error: 'Write a message first.' };
  const { data, error } = await supabase
    .from('support_threads')
    .insert({
      user_email: input.userEmail,
      org_name: input.orgName,
      subject: input.subject?.trim().slice(0, 140) || null,
    })
    .select(THREAD_COLS)
    .single();
  if (error || !data) {
    log.error(`createThread | ${error?.message ?? 'no row'}`);
    return { ok: false, error: error?.message ?? 'Could not start the conversation.' };
  }
  const thread = data as SupportThread;
  const message = await sendMessage(thread.id, body, 'user');
  if (!message) return { ok: false, error: 'The conversation was created but the message failed to send — try again.' };
  return { ok: true, thread, message };
}

export async function markThreadRead(threadId: string, role: SupportRole): Promise<void> {
  const stamp = new Date().toISOString();
  const patch = role === 'user' ? { user_last_read_at: stamp } : { founder_last_read_at: stamp };
  const { error } = await supabase.from('support_threads').update(patch).eq('id', threadId);
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
 */
export function subscribeToSupport(onChange: () => void): () => void {
  const channel = supabase
    .channel(`support-${Math.random().toString(36).slice(2, 8)}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'support_messages' }, () => onChange())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'support_threads' }, () => onChange())
    .subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}

// ── Pure helpers (unit-tested) ───────────────────────────────────────────────

/** Unread for `role` = the last message came from the other side and is newer than my read stamp. */
export function isUnread(thread: SupportThread, role: SupportRole): boolean {
  if (role === 'user') {
    if (thread.last_sender_role !== 'founder') return false;
    return !thread.user_last_read_at || thread.last_message_at > thread.user_last_read_at;
  }
  if (thread.last_sender_role !== 'user') return false;
  return !thread.founder_last_read_at || thread.last_message_at > thread.founder_last_read_at;
}

export function unreadThreadCount(threads: SupportThread[], role: SupportRole): number {
  return threads.reduce((n, t) => n + (isUnread(t, role) ? 1 : 0), 0);
}

/** Open before closed, unread before read, then newest activity first. */
export function sortThreads(threads: SupportThread[], role: SupportRole): SupportThread[] {
  return [...threads].sort((a, b) => {
    if (a.status !== b.status) return a.status === 'open' ? -1 : 1;
    const ua = isUnread(a, role) ? 0 : 1;
    const ub = isUnread(b, role) ? 0 : 1;
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
