import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('./supabase', async () => {
  const { createSupabaseMock } = await import('./testing/supabaseMock');
  return { supabase: createSupabaseMock() };
});

import { supabase } from './supabase';
import {
  createTeamThread, fetchThreads, isUnread, messageRole, otherParticipants, participantLabel,
  sortThreads, unreadThreadCount, formatRelative,
  type SupportThread, type ThreadMember,
} from './supportService';
import type { MockedSupabaseClient } from './testing/supabaseMock';

const mock = (supabase as unknown as MockedSupabaseClient).__mock;
beforeEach(() => mock.reset());

/** Unread + ordering rules for both sides of a conversation, and the time stamps. */

const thread = (over: Partial<SupportThread>): SupportThread => ({
  id: over.id ?? Math.random().toString(36).slice(2),
  user_id: 'u1',
  user_email: 'shop@example.com',
  org_id: null,
  org_name: 'Cool Shop',
  subject: null,
  kind: 'support',
  status: 'open',
  last_message_at: '2026-09-13T10:00:00Z',
  last_message_preview: 'hi',
  last_sender_role: 'user',
  last_sender_id: 'u1',
  members: [],
  user_last_read_at: '2026-09-13T10:00:00Z',
  founder_last_read_at: null,
  created_at: '2026-09-13T09:00:00Z',
  updated_at: '2026-09-13T10:00:00Z',
  ...over,
});

describe('supportService — unread', () => {
  it('a founder sees a user message as unread until they read it', () => {
    const t = thread({ last_sender_role: 'user', founder_last_read_at: null });
    expect(isUnread(t, 'founder')).toBe(true);
    expect(isUnread(t, 'user')).toBe(false);
    expect(isUnread({ ...t, founder_last_read_at: '2026-09-13T10:00:00Z' }, 'founder')).toBe(false);
    expect(isUnread({ ...t, founder_last_read_at: '2026-09-13T09:59:00Z' }, 'founder')).toBe(true);
  });

  it('a user sees a founder reply as unread until they read it', () => {
    const t = thread({ last_sender_role: 'founder', last_message_at: '2026-09-13T11:00:00Z', user_last_read_at: '2026-09-13T10:00:00Z' });
    expect(isUnread(t, 'user')).toBe(true);
    expect(isUnread(t, 'founder')).toBe(false);
    expect(isUnread({ ...t, user_last_read_at: '2026-09-13T11:00:00Z' }, 'user')).toBe(false);
    expect(unreadThreadCount([t, thread({}), thread({ last_sender_role: null })], 'user')).toBe(1);
  });
});

describe('supportService — ordering + stamps', () => {
  it('sorts open before closed, unread before read, then newest first', () => {
    const list = [
      thread({ id: 'closed', status: 'closed', last_message_at: '2026-09-13T12:00:00Z', founder_last_read_at: '2026-09-13T12:00:00Z' }),
      thread({ id: 'read-old', last_message_at: '2026-09-13T08:00:00Z', founder_last_read_at: '2026-09-13T08:00:00Z' }),
      thread({ id: 'unread', last_message_at: '2026-09-13T09:00:00Z', founder_last_read_at: null }),
      thread({ id: 'read-new', last_message_at: '2026-09-13T11:00:00Z', founder_last_read_at: '2026-09-13T11:00:00Z' }),
    ];
    expect(sortThreads(list, 'founder').map(t => t.id)).toEqual(['unread', 'read-new', 'read-old', 'closed']);
  });

  it('formats relative times', () => {
    const now = Date.parse('2026-09-13T12:00:00Z');
    expect(formatRelative('2026-09-13T11:59:40Z', now)).toBe('just now');
    expect(formatRelative('2026-09-13T11:55:00Z', now)).toBe('5m');
    expect(formatRelative('2026-09-13T09:00:00Z', now)).toBe('3h');
    expect(formatRelative('2026-09-11T12:00:00Z', now)).toBe('2d');
    expect(formatRelative('2026-08-01T12:00:00Z', now)).toMatch(/Aug 1/);
    expect(formatRelative('garbage', now)).toBe('');
  });
});

// ── Team threads ─────────────────────────────────────────────────────────────

const member = (user_id: string, last_read_at: string | null): ThreadMember =>
  ({ user_id, email: `${user_id}@shop.test`, last_read_at });

const team = (over: Partial<SupportThread> = {}): SupportThread => thread({
  kind: 'team',
  user_id: 'ana',
  last_sender_role: 'member',
  last_sender_id: 'ben',
  members: [member('ana', '2026-09-13T09:00:00Z'), member('ben', '2026-09-13T10:00:00Z')],
  ...over,
});

describe('supportService — team unread', () => {
  it('is "not mine, and newer than my own participant row"', () => {
    const t = team();                                   // ben wrote at 10:00, ana read to 09:00
    expect(isUnread(t, 'member', 'ana')).toBe(true);
    expect(isUnread(t, 'member', 'ben')).toBe(false);   // my own message is never unread
  });

  it('clears when my participant row catches up', () => {
    const t = team({ members: [member('ana', '2026-09-13T10:00:00Z'), member('ben', '2026-09-13T10:00:00Z')] });
    expect(isUnread(t, 'member', 'ana')).toBe(false);
    expect(isUnread(team({ members: [{ ...member('ana', null) }, member('ben', null)] }), 'member', 'ana')).toBe(true);
  });

  it('reads as READ when the id or the roster is missing — a badge you cannot clear is worse than none', () => {
    expect(isUnread(team(), 'member')).toBe(false);
    expect(isUnread(team(), 'member', null)).toBe(false);
    expect(isUnread(team({ members: [member('ben', null)] }), 'member', 'ana')).toBe(false);
    expect(isUnread(team({ last_sender_id: null }), 'member', 'ana')).toBe(false);
  });

  it('a founder never inherits team unread from the founder rule', () => {
    // last_sender_role is 'member', so the support branch could not fire anyway —
    // but the kind check is what actually keeps a founder out of it.
    expect(isUnread(team({ last_sender_id: 'ben' }), 'founder', 'someone-else')).toBe(false);
    expect(unreadThreadCount([team(), thread({ last_sender_role: 'user', founder_last_read_at: null })], 'founder', 'zed')).toBe(1);
  });

  it('sorts team and support threads together, unread first', () => {
    const list = [
      thread({ id: 'support-read', last_message_at: '2026-09-13T11:00:00Z', last_sender_role: 'founder', user_last_read_at: '2026-09-13T11:00:00Z' }),
      team({ id: 'team-unread', last_message_at: '2026-09-13T10:00:00Z' }),
    ];
    expect(sortThreads(list, 'user', 'ana').map(t => t.id)).toEqual(['team-unread', 'support-read']);
  });
});

describe('supportService — participants and roles', () => {
  it('names everyone but me, and falls back to the subject alone in a conversation', () => {
    const t = team({ subject: 'Rack 4' });
    expect(otherParticipants(t, 'ana').map(m => m.user_id)).toEqual(['ben']);
    expect(participantLabel(t, 'ana')).toBe('ben@shop.test');
    expect(participantLabel(team({ members: [member('ana', null)], subject: 'Rack 4' }), 'ana')).toBe('Rack 4');
  });

  it('posts as member in a team thread — including a founder, who is a colleague there', () => {
    expect(messageRole({ kind: 'team' }, true)).toBe('member');
    expect(messageRole({ kind: 'team' }, false)).toBe('member');
    expect(messageRole({ kind: 'support' }, true)).toBe('founder');
    expect(messageRole({ kind: 'support' }, false)).toBe('user');
  });
});

describe('supportService — pre-migration fallback', () => {
  it('retries without the team columns when team_messaging.sql has not run', async () => {
    const row = { id: 't1', user_id: 'u1', status: 'open', last_message_at: '2026-09-13T10:00:00Z' };
    mock.responder = call => {
      if (call.table !== 'support_threads' || call.op !== 'select') return undefined;
      return call.columns?.includes('support_thread_members')
        ? { data: null, error: { code: 'PGRST200', message: 'Could not find a relationship' } }
        : { data: [row], error: null };
    };
    const r = await fetchThreads();
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    expect(r.teamAvailable).toBe(false);
    // Normalized so the rest of the app has ONE shape either way.
    expect(r.threads[0]).toMatchObject({ kind: 'support', last_sender_id: null, members: [] });
    expect(mock.callsFor('support_threads', 'select')).toHaveLength(2);
  });

  it('a real failure is still "unavailable", not a silent downgrade', async () => {
    mock.responder = call =>
      (call.table === 'support_threads' && call.op === 'select'
        ? { data: null, error: { code: '42P01', message: 'relation does not exist' } }
        : undefined);
    expect((await fetchThreads()).status).toBe('unavailable');
    expect(mock.callsFor('support_threads', 'select')).toHaveLength(1);   // no pointless retry
  });
});

describe('supportService — createTeamThread', () => {
  const input = {
    me: { user_id: 'ana', email: 'ana@shop.test' },
    recipients: [{ user_id: 'ben', email: 'ben@shop.test' }],
    body: 'rack 4 is priced',
    orgName: 'Cool Shop',
  };
  const threadRow = { id: 'T', user_id: 'ana', kind: 'team', status: 'open', last_message_at: '2026-09-13T10:00:00Z' };

  it('writes the thread, the whole roster INCLUDING me, then the first message', async () => {
    mock.responder = call => {
      if (call.table === 'support_threads' && call.op === 'insert') return { data: threadRow, error: null };
      if (call.table === 'support_thread_members' && call.op === 'insert') return { data: null, error: null };
      if (call.table === 'support_messages' && call.op === 'insert') {
        return { data: { id: 'm1', thread_id: 'T', sender_id: 'ana', sender_role: 'member', body: input.body, created_at: '2026-09-13T10:00:01Z' }, error: null };
      }
      return undefined;
    };
    const r = await createTeamThread(input);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const roster = mock.callsFor('support_thread_members', 'insert')[0].payload as { user_id: string }[];
    expect(roster.map(m => m.user_id)).toEqual(['ana', 'ben']);
    expect(mock.callsFor('support_threads', 'delete')).toHaveLength(0);
    expect(r.thread.last_sender_id).toBe('ana');
    // I have read my own opening message; the other side has not.
    expect(r.thread.members.find(m => m.user_id === 'ana')?.last_read_at).toBe('2026-09-13T10:00:01Z');
    expect(r.thread.members.find(m => m.user_id === 'ben')?.last_read_at).not.toBe('2026-09-13T10:00:01Z');
  });

  it('deletes the thread when the roster write fails — no half-built conversation survives', async () => {
    mock.responder = call => {
      if (call.table === 'support_threads' && call.op === 'insert') return { data: threadRow, error: null };
      if (call.table === 'support_thread_members' && call.op === 'insert') {
        return { data: null, error: { code: '42501', message: 'new row violates row-level security policy' } };
      }
      return undefined;
    };
    const r = await createTeamThread(input);
    expect(r.ok).toBe(false);
    const deletes = mock.callsFor('support_threads', 'delete');
    expect(deletes).toHaveLength(1);
    expect(deletes[0].filters).toContainEqual({ kind: 'eq', column: 'id', value: 'T' });
    expect(mock.callsFor('support_messages', 'insert')).toHaveLength(0);
  });

  it('deletes the thread when the first message fails too', async () => {
    mock.responder = call => {
      if (call.table === 'support_threads' && call.op === 'insert') return { data: threadRow, error: null };
      if (call.table === 'support_thread_members' && call.op === 'insert') return { data: null, error: null };
      if (call.table === 'support_messages' && call.op === 'insert') return { data: null, error: { message: 'rate limited' } };
      return undefined;
    };
    expect((await createTeamThread(input)).ok).toBe(false);
    expect(mock.callsFor('support_threads', 'delete')).toHaveLength(1);
  });

  it('refuses an empty body or an empty roster before touching the network', async () => {
    expect(await createTeamThread({ ...input, body: '   ' })).toMatchObject({ ok: false });
    expect(await createTeamThread({ ...input, recipients: [] })).toMatchObject({ ok: false });
    expect(mock.calls).toHaveLength(0);
  });
});
