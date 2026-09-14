import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * The contract of the first-party error reporter: what a row may contain (no
 * PII, no full user agent), when nothing is sent at all (localhost, dedupe
 * window, per-load cap), and that one bug stays one fingerprint across
 * sessions, users and redeploys.
 *
 * The supabase client is stubbed the same way the service tests stub it — a
 * chainable recorder, never a network call. `rpc` is included because the
 * shared testing/supabaseMock helper does not model it.
 */

interface Recorded { table: string; payload: unknown }
const recorded: Recorded[] = [];
let insertError: { code?: string; message?: string } | null = null;

vi.mock('./supabase', () => {
  const insert = (table: string) => (payload: unknown) => ({
    then: (resolve: (r: { error: unknown }) => unknown) => {
      recorded.push({ table, payload });
      return Promise.resolve(resolve({ error: insertError }));
    },
  });
  return {
    supabase: {
      from: (table: string) => ({ insert: insert(table) }),
      rpc: async () => ({ data: null, error: { code: '42P01', message: 'relation does not exist' } }),
    },
  };
});

import {
  scrubPII, normalizeMessage, normalizeFrame, fingerprintError, browserFamily,
  shouldReport, appVersionFrom, createGate, allowReport, buildErrorRow, toErrorLike,
  reportError, setErrorContext, installErrorReporter, relativeTime,
  __resetErrorReporter, DEDUPE_MS, MAX_PER_LOAD,
  type ErrorContext, type ErrorRow, type RowEnv,
} from './errorReporter';
import { FORCE_KEY } from './analytics';

const ctx = (over: Partial<ErrorContext> = {}): ErrorContext =>
  ({ userId: null, orgId: null, view: null, ...over });

const env = (over: Partial<RowEnv> = {}): RowEnv =>
  ({ sessionId: 'session-abcdefgh', path: '/sortbot/', userAgentClass: 'chrome', appVersion: 'BQ3f7x', ...over });

const flush = () => new Promise(r => setTimeout(r, 0));

describe('errorReporter — PII scrubbing', () => {
  it('removes emails, UUIDs and long opaque tokens', () => {
    expect(scrubPII('failed for gabriel@example.com')).toBe('failed for [email]');
    expect(scrubPII('batch 3fa85f64-5717-4562-b3fc-2c963f66afa6 missing')).toBe('batch [id] missing');
    expect(scrubPII('Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9abcdefghij'))
      .toBe('Bearer [token]');
  });

  it('leaves ordinary messages untouched', () => {
    const msg = "Cannot read properties of undefined (reading 'category')";
    expect(scrubPII(msg)).toBe(msg);
  });

  it('scrubs the stack as well as the message (storage paths carry user ids)', () => {
    const row = buildErrorRow(
      'window',
      {
        message: 'upload failed for b3fb80c0-1111-2222-3333-444455556666',
        stack: 'Error: x\n    at up (https://cdn/storage/3fa85f64-5717-4562-b3fc-2c963f66afa6/a.jpg:1:1)',
      },
      ctx(), env(),
    );
    expect(row.message).not.toMatch(/b3fb80c0/);
    expect(row.stack).not.toMatch(/3fa85f64/);
    expect(row.stack).toContain('[id]');
  });

  it('truncates to the column limits', () => {
    const row = buildErrorRow(
      'manual',
      { message: 'a long failure message '.repeat(60), stack: 'at frame (a.js) '.repeat(600) },
      ctx(), env(),
    );
    expect(row.message.length).toBe(500);
    expect(row.stack?.length).toBe(4000);
  });

  it('leaves long identifiers alone — only digit-bearing or absurd runs are tokens', () => {
    // A 35-char function name in a stack frame is not a secret, and blanking it
    // would destroy the frame the fingerprint is built from.
    expect(scrubPII('at handleCapturedAtUpdatedSelection (a.js:1:1)'))
      .toBe('at handleCapturedAtUpdatedSelection (a.js:1:1)');
    expect(scrubPII('sb-access-token=abc123def456ghi789jkl012mno345pqr')).toContain('[token]');
    expect(scrubPII('x'.repeat(40))).toBe('[token]');
  });
});

describe('errorReporter — fingerprint stability', () => {
  const stack = (file: string, line: string) =>
    `TypeError: boom\n    at handleClick (https://gerbriel.github.io/sortbot/assets/${file}:${line})\n    at other (x.js:1:1)`;

  it('is identical for the same bug in different sessions and users', () => {
    const a = fingerprintError('boundary', 'boom', stack('index-BQ3f7x.js', '120:31'));
    const b = fingerprintError('boundary', 'boom', stack('index-BQ3f7x.js', '120:31'));
    expect(a).toBe(b);
  });

  it('survives a redeploy: the build hash and line:col are normalized away', () => {
    const before = fingerprintError('boundary', 'boom', stack('index-BQ3f7x.js', '120:31'));
    const after = fingerprintError('boundary', 'boom', stack('index-Zk91ab.js', '204:7'));
    expect(after).toBe(before);
  });

  it('folds per-occurrence numbers out of the message', () => {
    expect(fingerprintError('manual', 'batch 417 failed'))
      .toBe(fingerprintError('manual', 'batch 9981 failed'));
  });

  it('separates different bugs, different frames and different sources', () => {
    const base = fingerprintError('window', 'boom', stack('index-BQ3f7x.js', '1:1'));
    expect(fingerprintError('window', 'different message', stack('index-BQ3f7x.js', '1:1'))).not.toBe(base);
    expect(fingerprintError('window', 'boom', 'TypeError: boom\n    at elsewhere (a.js:1:1)')).not.toBe(base);
    expect(fingerprintError('boundary', 'boom', stack('index-BQ3f7x.js', '1:1'))).not.toBe(base);
  });

  it('always satisfies the table CHECK (8..64 chars)', () => {
    for (const m of ['', 'a', 'x'.repeat(400), 'boom']) {
      const fp = fingerprintError('manual', m);
      expect(fp.length).toBeGreaterThanOrEqual(8);
      expect(fp.length).toBeLessThanOrEqual(64);
    }
  });

  it('normalizes a frame to a stable, origin-free form', () => {
    expect(normalizeFrame('Error\n    at f (https://host.io/sortbot/assets/index-AbCdEf12.js:9:4)'))
      .toBe('at f (/sortbot/assets/index.js)');
    expect(normalizeFrame(null)).toBe('');
    expect(normalizeMessage('  saw 42  and  7 ')).toBe('saw # and #');
  });
});

describe('errorReporter — gating', () => {
  it('skips localhost unless the analytics force override is set', () => {
    expect(shouldReport({ hostname: 'gerbriel.github.io', forced: false })).toBe(true);
    expect(shouldReport({ hostname: 'localhost', forced: false })).toBe(false);
    expect(shouldReport({ hostname: '127.0.0.1', forced: false })).toBe(false);
    expect(shouldReport({ hostname: '[::1]', forced: false })).toBe(false);
    expect(shouldReport({ hostname: 'localhost', forced: true })).toBe(true);
  });

  it('does NOT honor Do Not Track — a crash report is not tracking', () => {
    // There is deliberately no doNotTrack input; the only gate is the host.
    expect(shouldReport({ hostname: 'gerbriel.github.io', forced: false })).toBe(true);
  });

  it('dedupes one fingerprint to once per 60 s window', () => {
    const gate = createGate();
    expect(allowReport(gate, 'fpA', 1_000)).toBe(true);
    expect(allowReport(gate, 'fpA', 1_000 + DEDUPE_MS - 1)).toBe(false);
    expect(allowReport(gate, 'fpB', 1_000)).toBe(true);           // a different bug still reports
    expect(allowReport(gate, 'fpA', 1_000 + DEDUPE_MS)).toBe(true); // window elapsed
    expect(gate.sent).toBe(3);
  });

  it('caps a page load at MAX_PER_LOAD reports even with distinct fingerprints', () => {
    const gate = createGate();
    for (let i = 0; i < MAX_PER_LOAD; i++) {
      expect(allowReport(gate, `fp${i}`, i)).toBe(true);
    }
    expect(allowReport(gate, 'fpOverflow', 10_000)).toBe(false);
    expect(gate.sent).toBe(MAX_PER_LOAD);
  });

  it('does not spend the cap on a report it suppressed', () => {
    const gate = createGate();
    allowReport(gate, 'fpA', 0);
    allowReport(gate, 'fpA', 10);     // suppressed
    allowReport(gate, 'fpA', 20);     // suppressed
    expect(gate.sent).toBe(1);
  });
});

describe('errorReporter — browser family and app version', () => {
  it('keeps only a coarse family, and picks the right one for Chromium/iOS spoofing', () => {
    const ua = {
      chrome: 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
      edge: 'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/126.0 Safari/537.36 Edg/126.0',
      opera: 'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/125.0 Safari/537.36 OPR/111.0',
      samsung: 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 SamsungBrowser/23.0 Chrome/115.0 Safari/537.36',
      firefox: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:127.0) Gecko/20100101 Firefox/127.0',
      safari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1',
    };
    expect(browserFamily(ua.chrome)).toBe('chrome');
    expect(browserFamily(ua.edge)).toBe('edge');
    expect(browserFamily(ua.opera)).toBe('opera');
    expect(browserFamily(ua.samsung)).toBe('samsung');
    expect(browserFamily(ua.firefox)).toBe('firefox');
    expect(browserFamily(ua.safari)).toBe('safari');
    expect(browserFamily('Mozilla/5.0 (iPhone) CriOS/126.0 Mobile/15E148 Safari/604.1')).toBe('chrome');
    expect(browserFamily('Mozilla/5.0 (iPhone) FxiOS/127.0 Mobile/15E148 Safari/604.1')).toBe('firefox');
    expect(browserFamily('')).toBe('other');
    expect(browserFamily('curl/8.4.0')).toBe('other');
  });

  it('derives the app version from the entry chunk hash, and prefers a meta tag', () => {
    expect(appVersionFrom(['/sortbot/assets/index-BQ3f7xLm.js'])).toBe('BQ3f7xLm');
    expect(appVersionFrom(['/sortbot/assets/vendor-AAAAAAAA.js', '/sortbot/assets/index-Zk91abCD.js']))
      .toBe('Zk91abCD');
    expect(appVersionFrom(['/sortbot/assets/index-BQ3f7xLm.js'], '2026.09.13')).toBe('2026.09.13');
    expect(appVersionFrom([])).toBeNull();
    expect(appVersionFrom(['/src/main.tsx'])).toBeNull();
  });
});

describe('errorReporter — row shape', () => {
  it('unwraps anything that can be thrown', () => {
    expect(toErrorLike(new TypeError('bad')).message).toBe('bad');
    expect(toErrorLike('plain string').message).toBe('plain string');
    expect(toErrorLike({ message: 'object with message' }).message).toBe('object with message');
    expect(toErrorLike({ weird: 1 }).message).toBe('{"weird":1}');
    expect(toErrorLike(undefined).message).toBe('undefined');
    expect(toErrorLike(new Error('')).message).toBe('Error');
  });

  it('carries the context identity and never the full user agent', () => {
    const row: ErrorRow = buildErrorRow(
      'boundary', { message: 'boom', stack: 'Error: boom\n at f (a.js:1:1)' },
      ctx({ userId: 'u1', orgId: 'o1', view: 'app' }),
      env({ path: '/sortbot/' }),
      'ImageGrouper',
    );
    expect(row).toMatchObject({
      source: 'boundary', message: 'boom', component: 'ImageGrouper', view: 'app',
      path: '/sortbot/', user_id: 'u1', org_id: 'o1', session_id: 'session-abcdefgh',
      user_agent_class: 'chrome', app_version: 'BQ3f7x',
    });
    expect(Object.keys(row)).not.toContain('user_agent');
    expect(JSON.stringify(row)).not.toMatch(/Mozilla/);
  });

  it('never produces an empty message (the column is NOT NULL, 1..500)', () => {
    expect(buildErrorRow('manual', { message: '' }, ctx(), env()).message).toBe('Unknown error');
  });

  it('truncates an over-long component and view to their column limits', () => {
    const row = buildErrorRow('manual', { message: 'x' }, ctx({ view: 'v'.repeat(80) }), env(), 'C'.repeat(400));
    expect(row.component?.length).toBe(120);
    expect(row.view?.length).toBe(30);
  });
});

describe('errorReporter — insert path', () => {
  beforeEach(() => {
    recorded.length = 0;
    insertError = null;
    __resetErrorReporter();
    localStorage.removeItem(FORCE_KEY);
  });

  it('sends nothing from localhost (the test host) unless forced', () => {
    reportError(new Error('local only'));
    expect(recorded).toHaveLength(0);

    localStorage.setItem(FORCE_KEY, '1');
    reportError(new Error('local only'));
    expect(recorded).toHaveLength(1);
    expect(recorded[0].table).toBe('app_errors');
  });

  it('applies the dedupe window and the context to real reports', () => {
    localStorage.setItem(FORCE_KEY, '1');
    setErrorContext({ userId: 'u9', orgId: 'o9', view: 'app' });
    const err = new Error('repeated boom');
    reportError(err, { source: 'boundary', component: 'Step2' });
    reportError(err, { source: 'boundary', component: 'Step2' });
    expect(recorded).toHaveLength(1);
    expect(recorded[0].payload).toMatchObject({
      user_id: 'u9', org_id: 'o9', view: 'app', source: 'boundary', component: 'Step2',
    });
  });

  it('latches off when app_errors does not exist, but not on a rate-limit rejection', async () => {
    localStorage.setItem(FORCE_KEY, '1');

    insertError = { code: '54000', message: 'app_errors: rate limit for this session' };
    reportError(new Error('rate limited'));
    await flush();
    insertError = null;
    reportError(new Error('still reporting'));
    expect(recorded).toHaveLength(2);

    insertError = { code: '42P01', message: 'relation "app_errors" does not exist' };
    reportError(new Error('table missing'));
    await flush();
    insertError = null;
    reportError(new Error('after the latch'));
    expect(recorded).toHaveLength(3);
  });

  it('installs the global listeners once and reports through them', async () => {
    localStorage.setItem(FORCE_KEY, '1');
    installErrorReporter();
    installErrorReporter();  // idempotent — a second install must not double-report

    window.dispatchEvent(new ErrorEvent('error', { error: new Error('window boom'), message: 'window boom' }));
    await flush();
    const windowRows = recorded.filter(r => (r.payload as ErrorRow).source === 'window');
    expect(windowRows).toHaveLength(1);
  });
});

describe('errorReporter — relativeTime', () => {
  const now = Date.parse('2026-09-13T12:00:00Z');
  it('formats the last-seen column', () => {
    expect(relativeTime(null)).toBe('—');
    expect(relativeTime('not a date')).toBe('—');
    expect(relativeTime('2026-09-13T11:59:30Z', now)).toBe('just now');
    expect(relativeTime('2026-09-13T11:45:00Z', now)).toBe('15 min ago');
    expect(relativeTime('2026-09-13T09:00:00Z', now)).toBe('3 hr ago');
    expect(relativeTime('2026-09-12T12:00:00Z', now)).toBe('yesterday');
    expect(relativeTime('2026-09-08T12:00:00Z', now)).toBe('5 days ago');
  });
});
