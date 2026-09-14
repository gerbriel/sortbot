import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('./supabase', async () => {
  const { createSupabaseMock } = await import('./testing/supabaseMock');
  return { supabase: createSupabaseMock() };
});

// tus.Upload must never actually start a transfer in a unit test.
vi.mock('tus-js-client', () => ({
  Upload: class {
    findPreviousUploads() { return Promise.resolve([]); }
    resumeFromPreviousUpload() { /* no-op */ }
    start() { /* no-op */ }
  },
}));

import { supabase } from './supabase';
import { tusUploadFile } from './tusUpload';
import type { MockedSupabaseClient } from './testing/supabaseMock';

const mock = (supabase as unknown as MockedSupabaseClient).__mock;
const file = new File([new Uint8Array([1, 2, 3])], 'x.jpg', { type: 'image/jpeg' });

/**
 * The executor used to be `new Promise(async (resolve, reject) => …)`. An async
 * executor swallows its own throws — the rejection lands on the executor's own,
 * unheld promise — so a rejecting auth.getSession() left the returned promise
 * NEVER SETTLED: the awaiting upload chunk, and with it the whole 1500-image
 * loop, stalled silently with no error, no retry and no progress. The 5-attempt
 * backoff in ImageUpload could not help because the first attempt never returned.
 */
describe('tusUploadFile', () => {
  beforeEach(() => mock.reset());

  it('REJECTS (never hangs) when the session lookup throws', async () => {
    mock.getSessionThrows = true;
    await expect(
      Promise.race([
        tusUploadFile(file, 'u/p/x.jpg'),
        new Promise((_r, rej) => setTimeout(() => rej(new Error('HUNG — promise never settled')), 250)),
      ]),
    ).rejects.toThrow(/session lookup failed/);
  });

  it('rejects when there is no session at all', async () => {
    mock.authSession = null;
    await expect(tusUploadFile(file, 'u/p/x.jpg')).rejects.toThrow(/no auth session/);
  });
});
