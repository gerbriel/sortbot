import { describe, it, expect } from 'vitest';
import { isUnread, unreadThreadCount, sortThreads, formatRelative, type SupportThread } from './supportService';

/** Unread + ordering rules for both sides of a conversation, and the time stamps. */

const thread = (over: Partial<SupportThread>): SupportThread => ({
  id: over.id ?? Math.random().toString(36).slice(2),
  user_id: 'u1',
  user_email: 'shop@example.com',
  org_id: null,
  org_name: 'Cool Shop',
  subject: null,
  status: 'open',
  last_message_at: '2026-09-13T10:00:00Z',
  last_message_preview: 'hi',
  last_sender_role: 'user',
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
