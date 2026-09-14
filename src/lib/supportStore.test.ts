import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('./supabase', async () => {
  const { createSupabaseMock } = await import('./testing/supabaseMock');
  return { supabase: createSupabaseMock() };
});

import { supabase } from './supabase';
import {
  supportStore, supportActions, applyReadStamp, applySentMessage, applyStatus, filterThreads, readStampKey,
} from './supportStore';
import { isUnread, unreadThreadCount, type SupportThread } from './supportService';
import type { MockedSupabaseClient } from './testing/supabaseMock';

const mock = (supabase as unknown as MockedSupabaseClient).__mock;

/**
 * supportStore — the ONE Realtime channel + ONE poll timer shared by the
 * floating widget and the Messages view, and the optimistic writes that keep
 * the thread list from lagging a round-trip behind the composer.
 */

const thread = (over: Partial<SupportThread> = {}): SupportThread => ({
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

/** Make every `support_threads` SELECT resolve to `rows`. */
function serveThreads(rows: SupportThread[]) {
  mock.responder = call =>
    (call.table === 'support_threads' && call.op === 'select' ? { data: rows, error: null } : undefined);
}

beforeEach(() => {
  mock.reset();
  supportStore.reset();
});

afterEach(() => {
  // Never leave the 45 s interval running between test files.
  supportStore.reset();
});

describe('supportStore — pure state transitions', () => {
  it('stamps the read marker on the right column, and returns the SAME array when nothing matched', () => {
    expect(readStampKey('user')).toBe('user_last_read_at');
    expect(readStampKey('founder')).toBe('founder_last_read_at');

    const list = [thread({ id: 'a' }), thread({ id: 'b' })];
    const next = applyReadStamp(list, 'a', 'founder', '2026-09-13T12:00:00Z');
    expect(next[0].founder_last_read_at).toBe('2026-09-13T12:00:00Z');
    expect(next[0].user_last_read_at).toBe('2026-09-13T10:00:00Z'); // other side untouched
    expect(next[1]).toBe(list[1]);                                   // unrelated row not cloned
    expect(applyReadStamp(list, 'missing', 'founder', 'x')).toBe(list);
  });

  it('mirrors the support_after_message trigger: last_*, reopen, and the sender reads their own message', () => {
    const list = [thread({ id: 'a', status: 'closed', last_sender_role: 'user', founder_last_read_at: null })];
    const next = applySentMessage(list, 'a', 'here is the fix', 'founder', '2026-09-13T12:00:00Z');
    expect(next[0]).toMatchObject({
      last_message_at: '2026-09-13T12:00:00Z',
      last_message_preview: 'here is the fix',
      last_sender_role: 'founder',
      status: 'open',                                     // the trigger reopens on any message
      founder_last_read_at: '2026-09-13T12:00:00Z',       // my own message is read by me
      user_last_read_at: '2026-09-13T10:00:00Z',          // theirs is not
    });
    expect(isUnread(next[0], 'founder')).toBe(false);
    expect(isUnread(next[0], 'user')).toBe(true);
  });

  it('truncates the optimistic preview at 140 chars, exactly like left(body, 140)', () => {
    const body = 'x'.repeat(300);
    const next = applySentMessage([thread({ id: 'a' })], 'a', body, 'user', '2026-09-13T12:00:00Z');
    expect(next[0].last_message_preview).toHaveLength(140);
  });

  it('flips one thread’s status and leaves the rest alone', () => {
    const list = [thread({ id: 'a' }), thread({ id: 'b' })];
    const next = applyStatus(list, 'a', 'closed');
    expect(next[0].status).toBe('closed');
    expect(next[1]).toBe(list[1]);
  });

  it('filters the list by status chip and by search across email / workspace / subject / preview', () => {
    const list = [
      thread({ id: 'a', user_email: 'ana@shop.com', org_name: 'Rack City', subject: 'CSV import', last_message_preview: 'the export failed' }),
      thread({ id: 'b', user_email: 'bo@vintage.co', org_name: 'Cool Shop', subject: null, last_message_preview: 'how do I group photos?' }),
      thread({ id: 'c', status: 'closed', user_email: 'cy@shop.com', org_name: null, subject: null, last_message_preview: null }),
    ];
    expect(filterThreads(list)).toBe(list);                                        // no work, same array
    expect(filterThreads(list, { status: 'open' }).map(t => t.id)).toEqual(['a', 'b']);
    expect(filterThreads(list, { status: 'closed' }).map(t => t.id)).toEqual(['c']);
    expect(filterThreads(list, { query: 'rack' }).map(t => t.id)).toEqual(['a']);   // workspace
    expect(filterThreads(list, { query: 'CSV' }).map(t => t.id)).toEqual(['a']);    // subject, case-insensitive
    expect(filterThreads(list, { query: 'group photos' }).map(t => t.id)).toEqual(['b']); // preview
    expect(filterThreads(list, { query: '@shop.com' }).map(t => t.id)).toEqual(['a', 'c']); // email
    expect(filterThreads(list, { query: 'shop', status: 'open' }).map(t => t.id)).toEqual(['a', 'b']);
    expect(filterThreads(list, { query: '  ' })).toBe(list);                        // blank search is not a filter
    expect(filterThreads(list, { query: 'nothing here' })).toEqual([]);
  });
});

describe('supportStore — subscriber ref-counting', () => {
  it('the FIRST subscriber starts one channel + one timer; the LAST one stops them', async () => {
    expect(supportStore.isLive()).toBe(false);

    const a = supportStore.subscribe(() => {});
    expect(supportStore.isLive()).toBe(true);
    expect(mock.channels).toHaveLength(1);

    // The widget and the Messages view can be mounted at the same time.
    const b = supportStore.subscribe(() => {});
    const c = supportStore.subscribe(() => {});
    expect(mock.channels).toHaveLength(1);       // still ONE realtime channel
    expect(mock.removedChannels).toBe(0);

    a();
    b();
    expect(supportStore.isLive()).toBe(true);    // one subscriber left — keep it live
    expect(mock.removedChannels).toBe(0);

    c();
    expect(supportStore.isLive()).toBe(false);
    expect(mock.removedChannels).toBe(1);

    // Re-subscribing later opens a fresh channel, not a second one on top.
    const d = supportStore.subscribe(() => {});
    expect(mock.channels).toHaveLength(2);
    expect(supportStore.isLive()).toBe(true);
    d();
    await vi.waitFor(() => expect(supportStore.isLive()).toBe(false));
  });

  it('starting fetches the thread list once and notifies subscribers', async () => {
    serveThreads([thread({ id: 'a' }), thread({ id: 'b' })]);
    let notified = 0;
    const unsub = supportStore.subscribe(() => { notified++; });

    await vi.waitFor(() => expect(supportStore.getState().threads).toHaveLength(2));
    expect(supportStore.getState().available).toBe(true);
    expect(supportStore.getState().revision).toBe(1);
    expect(notified).toBeGreaterThan(0);
    expect(mock.callsFor('support_threads', 'select')).toHaveLength(1);
    unsub();
  });

  it('reports unavailable (and keeps polling) when the tables are missing', async () => {
    mock.responder = call =>
      (call.table === 'support_threads'
        ? { data: null, error: { code: '42P01', message: 'relation does not exist' } }
        : undefined);
    const unsub = supportStore.subscribe(() => {});
    await vi.waitFor(() => expect(supportStore.getState().available).toBe(false));
    // Deliberate: a transient network failure reports 'unavailable' too, so the
    // poll must survive it or messaging stays hidden until a page reload.
    expect(supportStore.isLive()).toBe(true);
    unsub();
  });

  it('dedupes concurrent refreshes into a single round-trip', async () => {
    serveThreads([thread({ id: 'a' })]);
    await Promise.all([supportActions.refresh(), supportActions.refresh(), supportActions.refresh()]);
    expect(mock.callsFor('support_threads', 'select')).toHaveLength(1);
    // …and a later refresh is a new round-trip, not a cached promise.
    await supportActions.refresh();
    expect(mock.callsFor('support_threads', 'select')).toHaveLength(2);
  });
});

describe('supportStore — optimistic writes and reconciliation', () => {
  it('markRead clears my unread immediately, writes the stamp, and no-ops when already read', async () => {
    serveThreads([thread({ id: 'a', last_sender_role: 'user', founder_last_read_at: null })]);
    await supportActions.refresh();
    expect(unreadThreadCount(supportStore.getState().threads, 'founder')).toBe(1);

    supportActions.markRead('a', 'founder');
    expect(unreadThreadCount(supportStore.getState().threads, 'founder')).toBe(0);
    await vi.waitFor(() => expect(mock.callsFor('support_threads', 'update')).toHaveLength(1));
    expect(mock.callsFor('support_threads', 'update')[0].payload)
      .toHaveProperty('founder_last_read_at');

    const before = supportStore.getState().threads;
    supportActions.markRead('a', 'founder');   // already read
    supportActions.markRead('nope', 'founder'); // unknown id
    expect(supportStore.getState().threads).toBe(before);
    expect(mock.callsFor('support_threads', 'update')).toHaveLength(1);
  });

  it('send patches the thread before the refetch lands, then reconciles with the server row', async () => {
    const server = thread({ id: 'a', status: 'closed', last_message_preview: 'hi', last_sender_role: 'user' });
    serveThreads([server]);
    await supportActions.refresh();

    // The insert returns the stored message; the SELECT keeps serving the STALE
    // row, so anything correct in the list afterwards came from the optimistic patch.
    mock.responder = call => {
      if (call.table === 'support_messages' && call.op === 'insert') {
        return { data: { id: 'm1', thread_id: 'a', sender_id: null, sender_role: 'founder', body: 'on it', created_at: '2026-09-13T12:00:00Z' }, error: null };
      }
      if (call.table === 'support_threads' && call.op === 'select') return { data: [server], error: null };
      return undefined;
    };

    const m = await supportActions.send('a', 'on it', 'founder');
    expect(m?.id).toBe('m1');
    const patched = supportStore.getState().threads[0];
    expect(patched.last_message_preview).toBe('on it');
    expect(patched.last_sender_role).toBe('founder');
    expect(patched.status).toBe('open');

    // The background refetch then puts the authoritative row back.
    await vi.waitFor(() => expect(supportStore.getState().threads[0].last_message_preview).toBe('hi'));
    expect(supportStore.getState().revision).toBeGreaterThan(1);
  });

  it('send returns null and leaves the list untouched when the insert fails', async () => {
    serveThreads([thread({ id: 'a' })]);
    await supportActions.refresh();
    const before = supportStore.getState().threads;
    mock.responder = call => (call.table === 'support_messages'
      ? { data: null, error: { message: 'rls' } }
      : { data: before, error: null });

    expect(await supportActions.send('a', 'nope', 'user')).toBeNull();
    expect(supportStore.getState().threads).toBe(before);
  });

  it('setStatus applies locally only when the update succeeded', async () => {
    serveThreads([thread({ id: 'a', status: 'open' })]);
    await supportActions.refresh();

    mock.responder = call => {
      if (call.table === 'support_threads' && call.op === 'update') return { data: null, error: null };
      if (call.table === 'support_threads' && call.op === 'select') return { data: supportStore.getState().threads, error: null };
      return undefined;
    };
    expect(await supportActions.setStatus('a', 'closed')).toBe(true);
    expect(supportStore.getState().threads[0].status).toBe('closed');

    mock.responder = call => (call.op === 'update'
      ? { data: null, error: { message: 'not allowed' } }
      : { data: supportStore.getState().threads, error: null });
    expect(await supportActions.setStatus('a', 'open')).toBe(false);
    expect(supportStore.getState().threads[0].status).toBe('closed');
  });

  it('startThread prepends the new conversation without duplicating it after the refetch', async () => {
    const fresh = thread({ id: 'new', last_message_preview: 'hello there' });
    mock.responder = call => {
      if (call.table === 'support_threads' && call.op === 'insert') return { data: fresh, error: null };
      if (call.table === 'support_messages' && call.op === 'insert') {
        return { data: { id: 'm1', thread_id: 'new', sender_id: null, sender_role: 'user', body: 'hello there', created_at: '2026-09-13T12:00:00Z' }, error: null };
      }
      if (call.table === 'support_threads' && call.op === 'select') return { data: [fresh], error: null };
      return undefined;
    };

    const r = await supportActions.startThread({ body: 'hello there', userEmail: 'shop@example.com', orgName: 'Cool Shop' });
    expect(r.ok).toBe(true);
    expect(supportStore.getState().threads.map(t => t.id)).toEqual(['new']);
    await vi.waitFor(() => expect(supportStore.getState().revision).toBeGreaterThan(0));
    expect(supportStore.getState().threads.map(t => t.id)).toEqual(['new']); // still one
  });

  it('reset drops the previous account’s threads and stops the shared lifecycle', async () => {
    serveThreads([thread({ id: 'a' })]);
    const unsub = supportStore.subscribe(() => {});
    await vi.waitFor(() => expect(supportStore.getState().threads).toHaveLength(1));

    supportStore.reset();
    expect(supportStore.getState().threads).toEqual([]);
    expect(supportStore.getState().available).toBeNull();
    expect(supportStore.isLive()).toBe(false);
    unsub(); // the component's cleanup still runs later — must not throw or re-stop
    expect(supportStore.isLive()).toBe(false);
  });
});
