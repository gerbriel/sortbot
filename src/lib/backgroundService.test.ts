import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('./supabase', async () => {
  const { createSupabaseMock } = await import('./testing/supabaseMock');
  return { supabase: createSupabaseMock() };
});

import { supabase } from './supabase';
import type { MockedSupabaseClient } from './testing/supabaseMock';
import { DEFAULT_BACKGROUND_PRESET } from './descriptionSettings';
import {
  BACKGROUND_BILLING_HINT,
  BACKGROUND_ROW_COLUMNS,
  JOB_GONE_MESSAGE,
  __resetBackgroundProbeForTests,
  backgroundFailureHint,
  backgroundsAvailable,
  backgroundsKnownAvailable,
  failureReasonFor,
  fetchImageRowsForProducts,
  isBackgroundBlocking,
  isJobGone,
  isProcessableStatus,
  maskFailureReason,
  maskFlagLabel,
  sharedFailureReason,
  mattingBaseUrl,
  pollBackgroundJob,
  rerunImage,
  resolveCatalogPath,
  setMaskStatus,
  setMaskStatusMany,
  submitBackgroundJob,
  summarizeMaskStatuses,
  type BackgroundImageRow,
} from './backgroundService';

const mock = (supabase as unknown as MockedSupabaseClient).__mock;

const row = (o: Partial<BackgroundImageRow> & { id: string }): BackgroundImageRow => ({
  product_id: 'prod-1',
  storage_path: 'u/p/orig.jpg',
  mask_status: null,
  mask_score: null,
  mask_flags: null,
  cutout_storage_path: null,
  composite_storage_path: null,
  bg_preset: null,
  ...o,
});

/** A fetch stub that records every call and answers from a queue. */
function stubFetch(responses: Array<{ ok?: boolean; status?: number; body?: unknown } | Error>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  let i = 0;
  const fn = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = responses[Math.min(i++, responses.length - 1)];
    if (next instanceof Error) throw next;
    return {
      ok: next.ok !== false,
      status: next.status ?? 200,
      json: async () => next.body,
    } as unknown as Response;
  });
  vi.stubGlobal('fetch', fn);
  return calls;
}

beforeEach(() => {
  mock.reset();
  __resetBackgroundProbeForTests();
  vi.stubEnv('VITE_MATTING_URL', 'https://matting.test');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

// ── resolveCatalogPath — THE rule, exhaustively ─────────────────────────────

describe('resolveCatalogPath', () => {
  const both = { storage_path: 'u/p/orig.jpg', composite_storage_path: 'u/p/bg.jpg' };

  it('serves the COMPOSITE for the two statuses that mean "this is the catalogue photo"', () => {
    expect(resolveCatalogPath({ ...both, mask_status: 'auto' })).toBe('u/p/bg.jpg');
    expect(resolveCatalogPath({ ...both, mask_status: 'approved' })).toBe('u/p/bg.jpg');
  });

  it('serves the ORIGINAL for every other status', () => {
    for (const status of ['queued', 'review', 'original', 'failed']) {
      expect(resolveCatalogPath({ ...both, mask_status: status })).toBe('u/p/orig.jpg');
    }
  });

  it('serves the original when the photo was never processed (status null/absent)', () => {
    expect(resolveCatalogPath({ ...both, mask_status: null })).toBe('u/p/orig.jpg');
    expect(resolveCatalogPath({ storage_path: 'u/p/orig.jpg' })).toBe('u/p/orig.jpg');
  });

  it('falls back to the original when an auto/approved row has NO composite — a dead path in a shop CSV is worse than an un-matted photo', () => {
    expect(resolveCatalogPath({ storage_path: 'u/p/orig.jpg', composite_storage_path: null, mask_status: 'auto' }))
      .toBe('u/p/orig.jpg');
    expect(resolveCatalogPath({ storage_path: 'u/p/orig.jpg', composite_storage_path: '', mask_status: 'approved' }))
      .toBe('u/p/orig.jpg');
  });

  it('reads the camelCase spelling a ClothingItem carries', () => {
    expect(resolveCatalogPath({ storagePath: 'u/p/orig.jpg', compositeStoragePath: 'u/p/bg.jpg', maskStatus: 'approved' }))
      .toBe('u/p/bg.jpg');
    expect(resolveCatalogPath({ storagePath: 'u/p/orig.jpg', compositeStoragePath: 'u/p/bg.jpg', maskStatus: 'review' }))
      .toBe('u/p/orig.jpg');
  });

  it('prefers the camelCase field when a row carries both spellings', () => {
    expect(resolveCatalogPath({
      storagePath: 'camel.jpg', storage_path: 'snake.jpg', maskStatus: 'original',
    })).toBe('camel.jpg');
  });

  it("returns '' rather than throwing for null, undefined and an empty object", () => {
    expect(resolveCatalogPath(null)).toBe('');
    expect(resolveCatalogPath(undefined)).toBe('');
    expect(resolveCatalogPath({})).toBe('');
  });

  it('an unknown future status is treated as "not the catalogue photo"', () => {
    expect(resolveCatalogPath({ ...both, mask_status: 'reprocessing' })).toBe('u/p/orig.jpg');
  });
});

describe('isBackgroundBlocking', () => {
  it('blocks on review and queued only — the two states where the answer is not settled', () => {
    expect(isBackgroundBlocking({ mask_status: 'review' })).toBe(true);
    expect(isBackgroundBlocking({ mask_status: 'queued' })).toBe(true);
  });

  it('does NOT block on failed or original — both export the untouched photo', () => {
    expect(isBackgroundBlocking({ mask_status: 'failed' })).toBe(false);
    expect(isBackgroundBlocking({ mask_status: 'original' })).toBe(false);
  });

  it('does not block on auto, approved, never-processed, or nothing at all', () => {
    expect(isBackgroundBlocking({ mask_status: 'auto' })).toBe(false);
    expect(isBackgroundBlocking({ mask_status: 'approved' })).toBe(false);
    expect(isBackgroundBlocking({ mask_status: null })).toBe(false);
    expect(isBackgroundBlocking(null)).toBe(false);
  });
});

// ── summarizeMaskStatuses ───────────────────────────────────────────────────

describe('summarizeMaskStatuses', () => {
  it('counts every status, and null as unprocessed', () => {
    const s = summarizeMaskStatuses([
      { mask_status: 'queued' }, { mask_status: 'auto' }, { mask_status: 'auto' },
      { mask_status: 'review' }, { mask_status: 'review' }, { mask_status: 'review' },
      { mask_status: 'approved' }, { mask_status: 'original' }, { mask_status: 'failed' },
      { mask_status: null }, {},
    ]);
    expect(s).toEqual({
      total: 11, queued: 1, auto: 2, review: 3, approved: 1, original: 1,
      failed: 1, unprocessed: 2,
      blocking: 4,      // review ×3 + queued ×1
      processable: 4,   // unprocessed ×2 + failed ×1 + queued ×1
    });
  });

  it('is all zeros for an empty, null or undefined list', () => {
    const zero = summarizeMaskStatuses([]);
    expect(zero.total).toBe(0);
    expect(zero.blocking).toBe(0);
    expect(summarizeMaskStatuses(null)).toEqual(zero);
    expect(summarizeMaskStatuses(undefined)).toEqual(zero);
  });

  it('`processable` includes failures — a failure is usually transient and a second pass is cheap', () => {
    expect(summarizeMaskStatuses([{ mask_status: 'failed' }]).processable).toBe(1);
    expect(summarizeMaskStatuses([{ mask_status: 'auto' }]).processable).toBe(0);
  });

  it('reads the camelCase spelling too', () => {
    expect(summarizeMaskStatuses([{ maskStatus: 'review' }]).review).toBe(1);
  });
});

/**
 * NEVER STRAND A PHOTO. Fly stops an idle machine after a few minutes, so the
 * first real run left rows sitting at `queued` with the job that owned them
 * gone from memory — and while this rule excluded `queued`, there was no press
 * left anywhere in the UI that could pick them up.
 */
describe('isProcessableStatus', () => {
  it('processes a photo that has never been looked at', () => {
    expect(isProcessableStatus(null, false)).toBe(true);
    expect(isProcessableStatus(undefined, false)).toBe(true);
    expect(isProcessableStatus('', false)).toBe(true);
  });

  it('retries a failure — pressing Process again IS the retry', () => {
    expect(isProcessableStatus('failed', false)).toBe(true);
  });

  it('picks up a STRANDED queued row when no job is running here', () => {
    expect(isProcessableStatus('queued', false)).toBe(true);
  });

  it('leaves a queued row alone while this session is watching a job', () => {
    expect(isProcessableStatus('queued', true)).toBe(false);
  });

  it('never re-processes a settled photo, or one waiting on a person', () => {
    for (const status of ['auto', 'approved', 'original', 'review']) {
      expect(isProcessableStatus(status, false)).toBe(false);
      expect(isProcessableStatus(status, true)).toBe(false);
    }
  });

  it('agrees with summarizeMaskStatuses about what is processable when idle', () => {
    // `processable` has counted queued since the beginning; the two must not
    // disagree, or the panel's count and its button's count differ by the
    // stranded rows.
    const rows = [
      { mask_status: null }, { mask_status: 'failed' }, { mask_status: 'queued' },
      { mask_status: 'auto' }, { mask_status: 'review' }, { mask_status: 'approved' },
      { mask_status: 'original' },
    ];
    const byRule = rows.filter(r => isProcessableStatus(r.mask_status, false)).length;
    expect(byRule).toBe(summarizeMaskStatuses(rows).processable);
  });
});

describe('maskFlagLabel', () => {
  it('renders each known flag as a sentence', () => {
    expect(maskFlagLabel('edge')).toBe('Cut off at an edge of the photo');
    expect(maskFlagLabel('contrast')).toBe('Low contrast with the backdrop');
    expect(maskFlagLabel('soft')).toBe('Soft edges');
  });

  it('unwraps error:<reason> with a COLON, not an em dash', () => {
    // The reason frequently contains an em dash of its own (upstream messages
    // are written that way), and two in one line reads as a broken sentence.
    expect(maskFlagLabel('error:fetch_failed')).toBe('Could not be processed: fetch failed');
    expect(maskFlagLabel('error:')).toBe('Could not be processed');
  });

  it('passes an unknown flag through — a newer service must not lose its warning', () => {
    expect(maskFlagLabel('halo')).toBe('halo');
  });
});

/**
 * THE FIRST REAL RUN. Every row came back `failed` carrying
 * `error:RuntimeError: replicate create failed (429)` — a billing gate on the
 * matting backend — and the only thing on screen was "1 could not be processed".
 * The reason had to be read out of the database by hand. These are the rules
 * that make it readable, and the one thing they must not do is paraphrase a
 * message nobody has seen before.
 */
describe('maskFailureReason', () => {
  it('passes a real sentence through verbatim, em dash and all', () => {
    const msg = 'replicate 402 Insufficient credit — You have insufficient credit to run this model';
    expect(maskFailureReason(`error:${msg}`)).toBe(msg);
    expect(maskFlagLabel(`error:${msg}`)).toBe(`Could not be processed: ${msg}`);
  });

  it('keeps status codes, brackets and vendor names — the parts that identify the fault', () => {
    expect(maskFailureReason('error:replicate create failed (429)'))
      .toBe('replicate create failed (429)');
  });

  it('drops a leading Python exception class, which a reseller can neither read nor act on', () => {
    expect(maskFailureReason('error:RuntimeError: replicate create failed (429)'))
      .toBe('replicate create failed (429)');
    expect(maskFailureReason('error:HTTPError: 402 Payment Required')).toBe('402 Payment Required');
    expect(maskFailureReason('error:ValueError: mask was empty')).toBe('mask was empty');
  });

  it('does NOT drop a colon that is part of the message', () => {
    expect(maskFailureReason('error:upstream said: try later')).toBe('upstream said: try later');
    expect(maskFailureReason('error:model: birefnet unavailable')).toBe('model: birefnet unavailable');
  });

  it('turns a bare machine token into words — the shape the older flags took', () => {
    expect(maskFailureReason('error:fetch_failed')).toBe('fetch failed');
    expect(maskFailureReason('error:no-mask')).toBe('no mask');
  });

  it('is empty for a non-error flag and for an empty reason', () => {
    expect(maskFailureReason('coverage')).toBe('');
    expect(maskFailureReason('error:')).toBe('');
    expect(maskFailureReason('error:   ')).toBe('');
  });
});

describe('failureReasonFor', () => {
  it('reads the first error flag, in either spelling', () => {
    expect(failureReasonFor({ mask_flags: ['coverage', 'error:fetch_failed'] })).toBe('fetch failed');
    expect(failureReasonFor({ maskFlags: ['error:no credit'] })).toBe('no credit');
  });

  it('is empty when nothing said why', () => {
    expect(failureReasonFor({ mask_flags: ['coverage'] })).toBe('');
    expect(failureReasonFor({ mask_flags: [] })).toBe('');
    expect(failureReasonFor({})).toBe('');
    expect(failureReasonFor(null)).toBe('');
  });
});

describe('sharedFailureReason', () => {
  const failed = (reason?: string) => ({
    mask_status: 'failed',
    mask_flags: reason ? [`error:${reason}`] : [],
  });

  it('is the one reason when every failure agrees — the normal case', () => {
    expect(sharedFailureReason([
      failed('replicate 402 Insufficient credit'),
      failed('replicate 402 Insufficient credit'),
      { mask_status: 'auto' },
    ])).toBe('replicate 402 Insufficient credit');
  });

  it('is null when the failures DISAGREE — one photo\u2019s story is not all of them', () => {
    expect(sharedFailureReason([failed('no credit'), failed('fetch failed')])).toBeNull();
  });

  it('is null when any failure said nothing, so the panel keeps its bare count', () => {
    expect(sharedFailureReason([failed('no credit'), failed()])).toBeNull();
  });

  it('ignores every status but failed — a review flag is not a failure reason', () => {
    expect(sharedFailureReason([
      { mask_status: 'review', mask_flags: ['error:ignored'] },
      failed('no credit'),
    ])).toBe('no credit');
  });

  it('is null for an empty, absent or all-clean batch', () => {
    expect(sharedFailureReason([])).toBeNull();
    expect(sharedFailureReason(null)).toBeNull();
    expect(sharedFailureReason([{ mask_status: 'auto' }])).toBeNull();
  });
});

describe('backgroundFailureHint', () => {
  it('names the one fix that lives outside this app', () => {
    expect(backgroundFailureHint('replicate 402 Insufficient credit')).toBe(BACKGROUND_BILLING_HINT);
    expect(backgroundFailureHint('BILLING disabled for this account')).toBe(BACKGROUND_BILLING_HINT);
  });

  it('says nothing for a fault the seller cannot act on, or no reason at all', () => {
    expect(backgroundFailureHint('replicate create failed (429)')).toBeNull();
    expect(backgroundFailureHint('')).toBeNull();
    expect(backgroundFailureHint(null)).toBeNull();
  });
});

describe('isJobGone', () => {
  it('is true only for a 404 — the job the service forgot', () => {
    expect(isJobGone({ ok: false, error: 'x', status: 404 })).toBe(true);
    expect(isJobGone({ ok: false, error: 'x', status: 500 })).toBe(false);
    expect(isJobGone({ ok: false, error: 'x', status: 401 })).toBe(false);
    expect(isJobGone({ ok: false, error: 'could not reach it' })).toBe(false);
    expect(isJobGone({ ok: true, value: 1 })).toBe(false);
  });

  it('says what to do about it — the rows are still queued and Process re-accepts them', () => {
    expect(JOB_GONE_MESSAGE).toContain('Process again');
  });
});

// ── Availability ────────────────────────────────────────────────────────────

describe('backgroundsAvailable', () => {
  it('is false with no VITE_MATTING_URL, and never touches the database', async () => {
    vi.stubEnv('VITE_MATTING_URL', '');
    __resetBackgroundProbeForTests();
    expect(await backgroundsAvailable()).toBe(false);
    expect(mock.calls).toHaveLength(0);
  });

  it('is false when the columns are missing (migration not run)', async () => {
    mock.responder = () => ({ data: null, error: { code: '42703', message: 'column does not exist' } });
    expect(await backgroundsAvailable()).toBe(false);
    expect(backgroundsKnownAvailable()).toBe(false);
  });

  it('is true when the probe reads the column, and probes exactly once per session', async () => {
    expect(await backgroundsAvailable()).toBe(true);
    expect(await backgroundsAvailable()).toBe(true);
    expect(await backgroundsAvailable()).toBe(true);
    expect(mock.callsFor('product_images', 'select')).toHaveLength(1);
    expect(backgroundsKnownAvailable()).toBe(true);
  });

  it('probes ONE projected row, never select(*)', async () => {
    await backgroundsAvailable();
    const [call] = mock.callsFor('product_images', 'select');
    expect(call.columns).toBe('cutout_storage_path');
    expect(call.limit).toBe(1);
  });

  it('mattingBaseUrl strips a trailing slash', () => {
    vi.stubEnv('VITE_MATTING_URL', 'https://matting.test/');
    expect(mattingBaseUrl()).toBe('https://matting.test');
    vi.stubEnv('VITE_MATTING_URL', '  https://matting.test///  ');
    expect(mattingBaseUrl()).toBe('https://matting.test');
  });
});

// ── fetchImageRowsForProducts ───────────────────────────────────────────────

describe('fetchImageRowsForProducts', () => {
  it('reads the projected column list, never select(*)', async () => {
    await fetchImageRowsForProducts(['p1']);
    const [call] = mock.callsFor('product_images', 'select');
    expect(call.columns).toBe(BACKGROUND_ROW_COLUMNS);
    expect(call.columns).not.toContain('*');
  });

  it('carries the product_images.id — the id the matting service takes', () => {
    expect(BACKGROUND_ROW_COLUMNS.split(',').map(c => c.trim())).toContain('id');
  });

  it('adds no user_id or org_id filter — RLS scopes it', async () => {
    await fetchImageRowsForProducts(['p1']);
    const [call] = mock.callsFor('product_images', 'select');
    expect(call.filters.map(f => f.column)).toEqual(['product_id']);
  });

  it('chunks a long id list at 100', async () => {
    const ids = Array.from({ length: 250 }, (_, i) => `p${i}`);
    await fetchImageRowsForProducts(ids);
    expect(mock.inSizes('product_images', 'select')).toEqual([100, 100, 50]);
  });

  it('de-duplicates ids before chunking', async () => {
    await fetchImageRowsForProducts(['p1', 'p1', 'p2', '', 'p2']);
    expect(mock.inSizes('product_images', 'select')).toEqual([2]);
  });

  it('does not query at all for an empty list', async () => {
    expect(await fetchImageRowsForProducts([])).toEqual({ status: 'ok', rows: [] });
    expect(mock.calls).toHaveLength(0);
  });

  it('concatenates the chunks into one row list', async () => {
    mock.responder = (call) => ({
      data: (call.filters[0].value as string[]).map(id => row({ id: `img-${id}`, product_id: id })),
      error: null,
    });
    const res = await fetchImageRowsForProducts(['p1', 'p2']);
    expect(res.status).toBe('ok');
    if (res.status === 'ok') expect(res.rows.map(r => r.id)).toEqual(['img-p1', 'img-p2']);
  });

  it('reports unavailable when the columns are missing', async () => {
    mock.responder = () => ({ data: null, error: { code: '42703', message: 'no column' } });
    expect(await fetchImageRowsForProducts(['p1'])).toEqual({ status: 'unavailable' });
  });
});

// ── setMaskStatus — the ONE column the app writes ───────────────────────────

describe('setMaskStatus', () => {
  it('writes only mask_status, keyed on the row id', async () => {
    mock.responder = () => ({ data: [{ id: 'img-1' }], error: null });
    expect(await setMaskStatus('img-1', 'approved')).toEqual({ ok: true });
    const [call] = mock.callsFor('product_images', 'update');
    expect(call.payload).toEqual({ mask_status: 'approved' });
    expect(call.filters).toEqual([{ kind: 'eq', column: 'id', value: 'img-1' }]);
  });

  it('never writes a path, a score or a flag — those belong to the service', async () => {
    mock.responder = () => ({ data: [{ id: 'img-1' }], error: null });
    await setMaskStatus('img-1', 'original');
    const payload = mock.callsFor('product_images', 'update')[0].payload as Record<string, unknown>;
    expect(Object.keys(payload)).toEqual(['mask_status']);
  });

  it('chains .select() so 0 rows is observable at all', async () => {
    mock.responder = () => ({ data: [{ id: 'img-1' }], error: null });
    await setMaskStatus('img-1', 'review');
    expect(mock.callsFor('product_images', 'update')[0].returning).toBe(true);
  });

  it('0 rows updated is a FAILURE, not a success (§18 #41)', async () => {
    mock.responder = () => ({ data: [], error: null });
    const res = await setMaskStatus('img-1', 'approved');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/permission/i);
  });

  it('names the migration when the column is missing', async () => {
    mock.responder = () => ({ data: null, error: { code: '42703', message: 'no column' } });
    const res = await setMaskStatus('img-1', 'approved');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/migration/i);
  });

  it('refuses an empty id without a round trip', async () => {
    expect((await setMaskStatus('', 'approved')).ok).toBe(false);
    expect(mock.calls).toHaveLength(0);
  });

  it('setMaskStatusMany is serial and counts the failures', async () => {
    let n = 0;
    mock.responder = () => (++n === 2 ? { data: [], error: null } : { data: [{ id: 'x' }], error: null });
    expect(await setMaskStatusMany(['a', 'b', 'c'], 'approved')).toEqual({ failed: 1 });
    expect(mock.callsFor('product_images', 'update')).toHaveLength(3);
  });
});

// ── The matting service calls ───────────────────────────────────────────────

describe('submitBackgroundJob', () => {
  it('POSTs the ids, the preset and force, with the session bearer token', async () => {
    const calls = stubFetch([{ body: { jobId: 'job-1', accepted: 2, skipped: 0 } }]);
    const res = await submitBackgroundJob(['img-1', 'img-2'], DEFAULT_BACKGROUND_PRESET, false);
    expect(res).toEqual({ ok: true, value: { jobId: 'job-1', accepted: 2, skipped: 0 } });
    expect(calls[0].url).toBe('https://matting.test/v1/jobs');
    expect(calls[0].init.method).toBe('POST');
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer test-token');
    expect(headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(calls[0].init.body as string)).toEqual({
      productImageIds: ['img-1', 'img-2'],
      preset: DEFAULT_BACKGROUND_PRESET,
      force: false,
    });
  });

  it('de-duplicates and drops empty ids', async () => {
    const calls = stubFetch([{ body: { jobId: 'j', accepted: 1, skipped: 0 } }]);
    await submitBackgroundJob(['a', 'a', '', 'b'], DEFAULT_BACKGROUND_PRESET, true);
    expect(JSON.parse(calls[0].init.body as string).productImageIds).toEqual(['a', 'b']);
  });

  it('refuses an empty list without a network call', async () => {
    const calls = stubFetch([{ body: {} }]);
    expect((await submitBackgroundJob([], DEFAULT_BACKGROUND_PRESET, false)).ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('refuses without a session, before any network call', async () => {
    mock.authSession = null;
    const calls = stubFetch([{ body: {} }]);
    const res = await submitBackgroundJob(['img-1'], DEFAULT_BACKGROUND_PRESET, false);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/signed in/i);
    expect(calls).toHaveLength(0);
  });

  it('refuses when VITE_MATTING_URL is unset', async () => {
    vi.stubEnv('VITE_MATTING_URL', '');
    const calls = stubFetch([{ body: {} }]);
    const res = await submitBackgroundJob(['img-1'], DEFAULT_BACKGROUND_PRESET, false);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/not configured/i);
    expect(calls).toHaveLength(0);
  });

  it('turns 401/403 into a message a person can act on, and does not echo the body', async () => {
    stubFetch([{ ok: false, status: 403, body: { detail: 'org mismatch for user 9f3a…' } }]);
    const res = await submitBackgroundJob(['img-1'], DEFAULT_BACKGROUND_PRESET, false);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe(403);
      expect(res.error).toMatch(/Sign out and back in/);
      expect(res.error).not.toContain('org mismatch');
    }
  });

  it('reports a 500 as an error rather than resolving with junk', async () => {
    stubFetch([{ ok: false, status: 500, body: null }]);
    const res = await submitBackgroundJob(['img-1'], DEFAULT_BACKGROUND_PRESET, false);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('500');
  });

  it('a thrown fetch (service down, CORS, offline) is an error, not a rejection', async () => {
    stubFetch([new Error('network')]);
    const res = await submitBackgroundJob(['img-1'], DEFAULT_BACKGROUND_PRESET, false);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/Could not reach/);
  });
});

describe('pollBackgroundJob', () => {
  it('GETs the job and returns its progress', async () => {
    const progress = { jobId: 'job-1', status: 'running', total: 10, done: 4, failed: 0, review: 1, auto: 3 };
    const calls = stubFetch([{ body: progress }]);
    expect(await pollBackgroundJob('job-1')).toEqual({ ok: true, value: progress });
    expect(calls[0].url).toBe('https://matting.test/v1/jobs/job-1');
    expect(calls[0].init.method).toBe('GET');
    expect(calls[0].init.body).toBeUndefined();
  });

  it('URL-encodes the job id', async () => {
    const calls = stubFetch([{ body: {} }]);
    await pollBackgroundJob('job/1 2');
    expect(calls[0].url).toBe('https://matting.test/v1/jobs/job%2F1%202');
  });

  it('refuses an empty job id without a network call', async () => {
    const calls = stubFetch([{ body: {} }]);
    expect((await pollBackgroundJob('')).ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  /* The 404 half of the stranded-photo fix: the caller ENDS the poll on a lost
     job and says "press Process again", instead of counting to 0/12 for ever.
     `isJobGone` can only answer that if the status survives the call. */
  it('carries a 404 through as a status, which is how a lost job is recognised', async () => {
    stubFetch([{ ok: false, status: 404, body: {} }]);
    const res = await pollBackgroundJob('job-gone');
    expect(res.ok).toBe(false);
    expect(isJobGone(res)).toBe(true);
  });

  it('a network failure is NOT a lost job — it has no status and must keep its own message', async () => {
    stubFetch([new Error('offline')]);
    const res = await pollBackgroundJob('job-1');
    expect(res.ok).toBe(false);
    expect(isJobGone(res)).toBe(false);
  });
});

describe('rerunImage', () => {
  it('POSTs the preset and the resolution to the image endpoint', async () => {
    const calls = stubFetch([{ body: { jobId: 'job-9' } }]);
    const res = await rerunImage('img-7', DEFAULT_BACKGROUND_PRESET, 2048);
    expect(res).toEqual({ ok: true, value: { jobId: 'job-9' } });
    expect(calls[0].url).toBe('https://matting.test/v1/images/img-7/rerun');
    expect(JSON.parse(calls[0].init.body as string))
      .toEqual({ preset: DEFAULT_BACKGROUND_PRESET, resolution: 2048 });
  });

  it('refuses an empty photo id without a network call', async () => {
    const calls = stubFetch([{ body: {} }]);
    expect((await rerunImage('', DEFAULT_BACKGROUND_PRESET, 1024)).ok).toBe(false);
    expect(calls).toHaveLength(0);
  });
});
