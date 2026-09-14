/**
 * First-party error tracking — uncaught errors, rejected promises and caught
 * render errors are written into OUR OWN Supabase project (`app_errors`). No
 * Sentry, no third-party script: nothing leaves the database we already run.
 *
 * WHY: today a render crash outside Step 2 is a white screen plus a console
 * message nobody sees, and silent failure is the codebase's documented default
 * (CLAUDE.md §13). The only other error signal is a user writing into the
 * support inbox — hours late, from the few who bother, with no stack.
 *
 * PRIVACY MODEL: the same random per-tab session id analytics uses
 * (sessionStorage — gone when the tab closes), `location.pathname` with no query
 * string, a COARSE browser family instead of the user agent, and — for
 * signed-in users — their own user/org id. Messages and stacks are scrubbed
 * (emails, UUID-ish tokens, long opaque tokens) before they are sent.
 *
 * TRACKING vs DIAGNOSTICS: this module deliberately does NOT honor Do Not
 * Track. DNT is a request not to be *tracked across sites*; a crash report about
 * our own broken code is neither behavioural nor cross-site. It does skip
 * localhost (set localStorage `sortbot_analytics_force=1` to override while
 * testing) so dev crashes never pollute production numbers.
 *
 * FORWARD-COMPATIBLE: if app_errors.sql has not been run, the first failed
 * insert marks the reporter unavailable and every later call is a no-op. A rate
 * limit rejection does NOT latch it off — only a missing table does.
 *
 * VOLUME GUARDS (three, because the app is broken when this code runs):
 *   1. one row per fingerprint per 60 s   (a loop reports once a minute)
 *   2. at most 20 reports per page load   (a loop stops reporting entirely)
 *   3. a 20-rows-per-10-minutes trigger in the database itself
 *
 * The founder dashboard reads `app_errors_summary(days)` (one RPC round-trip,
 * Founding admins only) — see ErrorsPanel.tsx.
 */
import { supabase } from './supabase';
import { getSessionId, FORCE_KEY } from './analytics';
import { log } from './debugLogger';

/** Where the report came from. Mirrors the `source` CHECK in app_errors.sql. */
export type ErrorSource = 'window' | 'unhandledrejection' | 'boundary' | 'manual';

/** Coarse browser families. Mirrors the `user_agent_class` CHECK. */
export type BrowserFamily =
  | 'chrome' | 'edge' | 'safari' | 'firefox' | 'opera' | 'samsung' | 'webview' | 'other';

export interface ErrorContext {
  userId: string | null;
  orgId: string | null;
  /** The top-level screen, same vocabulary as analytics: landing/auth/waitlist/app. */
  view: string | null;
}

export interface ErrorRow {
  source: ErrorSource;
  message: string;
  stack: string | null;
  component: string | null;
  view: string | null;
  path: string | null;
  fingerprint: string;
  user_agent_class: BrowserFamily | null;
  app_version: string | null;
  session_id: string;
  user_id: string | null;
  org_id: string | null;
}

export interface ReportOptions {
  source?: ErrorSource;
  component?: string | null;
}

/** One row per fingerprint per minute. */
export const DEDUPE_MS = 60_000;
/** Hard ceiling per page load — a render loop must not DoS the table. */
export const MAX_PER_LOAD = 20;
const MESSAGE_MAX = 500;
const STACK_MAX = 4000;

// ── Pure helpers (unit-tested) ───────────────────────────────────────────────

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
/** Candidate long opaque blobs: JWT segments, access tokens, hex digests. */
const TOKEN_RE = /\b[A-Za-z0-9_-]{32,}\b/g;
/**
 * A 32-char run is only a *candidate*: minified and hand-written identifiers get
 * long too (`handleCapturedAtUpdatedForSelection`), and replacing those would
 * shred the stack frames that make a fingerprint useful. A real token either
 * mixes in digits or is absurdly long.
 */
const isOpaqueToken = (s: string): boolean => /\d/.test(s) || s.length >= 40;

/**
 * Remove anything that could identify a person or authenticate as one. Runs on
 * the message AND the stack before either leaves the browser.
 */
export function scrubPII(text: string): string {
  return text
    .replace(EMAIL_RE, '[email]')
    .replace(UUID_RE, '[id]')
    .replace(TOKEN_RE, m => (isOpaqueToken(m) ? '[token]' : m));
}

/**
 * Fold the per-occurrence noise out of a message so one bug is one group:
 * digits become '#' and quoted single-word ids collapse. Fingerprint input
 * only — the stored message keeps its real text.
 */
export function normalizeMessage(message: string): string {
  return message
    .replace(/\d+/g, '#')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

/**
 * The first real stack frame, stripped of everything that changes between
 * deploys and users: the origin, the Vite content hash, and the line:column.
 * Without this, every redeploy would split one bug into a new group.
 */
export function normalizeFrame(stack: string | undefined | null): string {
  const lines = (stack ?? '').split('\n').map(l => l.trim()).filter(Boolean);
  const frame = lines.find(l => l.startsWith('at ') || /\(?https?:\/\//.test(l) || l.includes('@'));
  if (!frame) return '';
  return frame
    .replace(/https?:\/\/[^/)\s]+/g, '')            // origin
    .replace(/-[A-Za-z0-9_]{6,}(\.[cm]?js)/g, '$1') // index-BQ3f7x.js -> index.js
    .replace(/:\d+:\d+/g, '')                       // :120:31
    .replace(/\?[^)\s]*/g, '')                      // ?t=169… cache busters
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

/**
 * Stable group key: source + normalized message + normalized top frame, as two
 * independent 32-bit hashes (djb2 and sdbm) concatenated in base36 — ~13 chars,
 * which satisfies the table's 8..64 CHECK and makes an accidental collision
 * between two different bugs vanishingly unlikely.
 */
export function fingerprintError(source: ErrorSource, message: string, stack?: string | null): string {
  const input = `${source}|${normalizeMessage(message)}|${normalizeFrame(stack)}`;
  let djb2 = 5381;
  let sdbm = 0;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    djb2 = ((djb2 << 5) + djb2 + c) | 0;
    sdbm = (c + (sdbm << 6) + (sdbm << 16) - sdbm) | 0;
  }
  const a = (djb2 >>> 0).toString(36).padStart(7, '0');
  const b = (sdbm >>> 0).toString(36).padStart(7, '0');
  return `fp${a}${b}`;
}

/**
 * Browser family from a user agent — the ONLY thing we keep from it. Order
 * matters: every Chromium browser also claims "Chrome", and every iOS browser
 * also claims "Safari".
 */
export function browserFamily(ua: string): BrowserFamily {
  const s = ua.toLowerCase();
  if (!s) return 'other';
  if (/\bedg(?:e|a|ios)?\//.test(s)) return 'edge';
  if (/\b(opr|opera)\//.test(s)) return 'opera';
  if (/samsungbrowser\//.test(s)) return 'samsung';
  if (/\bfxios\/|firefox\//.test(s)) return 'firefox';
  if (/\bwv\b|; wv\)/.test(s)) return 'webview';
  if (/\bcrios\/|chrome\/|chromium\//.test(s)) return 'chrome';
  if (/safari\//.test(s)) return 'safari';
  return 'other';
}

export interface ReportEnv {
  hostname: string;
  forced: boolean;
}

/**
 * Errors are reported everywhere EXCEPT local dev (unless forced with the same
 * localStorage override analytics uses). Deliberately no Do Not Track check —
 * see the module header.
 */
export function shouldReport(env: ReportEnv): boolean {
  const local = env.hostname === 'localhost' || env.hostname === '127.0.0.1' || env.hostname === '[::1]';
  return !local || env.forced;
}

/**
 * Which build this came from. There is no build-time version define, so the
 * hash Vite puts in the entry chunk's filename IS the version: it changes on
 * every build and is visible without touching the build config. A
 * `<meta name="app-version">` wins if one is ever added.
 */
export function appVersionFrom(scriptSrcs: string[], metaVersion?: string | null): string | null {
  const meta = (metaVersion ?? '').trim();
  if (meta) return meta.slice(0, 60);
  // The entry chunk is the version. Look for it across ALL scripts first, so a
  // hashed vendor chunk earlier in the document cannot win.
  const passes = [/\/[A-Za-z0-9_.]*index-([A-Za-z0-9_-]{6,})\.[cm]?js/, /-([A-Za-z0-9_-]{8,})\.[cm]?js/];
  for (const re of passes) {
    for (const src of scriptSrcs) {
      const hash = re.exec(src)?.[1];
      if (hash) return hash.slice(0, 60);
    }
  }
  return null;
}

/** Gate state for the dedupe window + per-load cap. Exported for tests. */
export interface ReportGate {
  seen: Map<string, number>;
  sent: number;
}

export function createGate(): ReportGate {
  return { seen: new Map(), sent: 0 };
}

/**
 * Decide whether this fingerprint may be sent now, and record the decision.
 * Duplicates inside DEDUPE_MS are dropped; the cap is absolute for the page
 * load. Both counters only advance on an ALLOWED report, so a crash loop
 * reports its first occurrence and then goes quiet.
 */
export function allowReport(gate: ReportGate, fingerprint: string, now: number): boolean {
  if (gate.sent >= MAX_PER_LOAD) return false;
  const last = gate.seen.get(fingerprint);
  if (last !== undefined && now - last < DEDUPE_MS) return false;
  gate.seen.set(fingerprint, now);
  gate.sent += 1;
  return true;
}

export interface RowEnv {
  sessionId: string;
  path: string;
  userAgentClass: BrowserFamily | null;
  appVersion: string | null;
}

/** Build the row that goes over the wire. Scrubs, truncates, never throws. */
export function buildErrorRow(
  source: ErrorSource,
  err: { message: string; stack?: string | null },
  ctx: ErrorContext,
  env: RowEnv,
  component?: string | null,
): ErrorRow {
  const message = scrubPII(err.message || 'Unknown error').slice(0, MESSAGE_MAX);
  const rawStack = err.stack ? scrubPII(err.stack).slice(0, STACK_MAX) : null;
  return {
    source,
    message: message || 'Unknown error',
    stack: rawStack,
    component: component ? component.slice(0, 120) : null,
    view: ctx.view ? ctx.view.slice(0, 30) : null,
    path: env.path.slice(0, 200),
    fingerprint: fingerprintError(source, message, err.stack ?? null),
    user_agent_class: env.userAgentClass,
    app_version: env.appVersion,
    session_id: env.sessionId,
    user_id: ctx.userId,
    org_id: ctx.orgId,
  };
}

/** Anything thrown can reach us — unwrap it into a message + stack. */
export function toErrorLike(err: unknown): { message: string; stack?: string | null } {
  if (err instanceof Error) return { message: err.message || err.name, stack: err.stack ?? null };
  if (typeof err === 'string') return { message: err };
  if (err && typeof err === 'object') {
    const o = err as { message?: unknown; stack?: unknown };
    if (typeof o.message === 'string') {
      return { message: o.message, stack: typeof o.stack === 'string' ? o.stack : null };
    }
    try {
      return { message: JSON.stringify(err).slice(0, MESSAGE_MAX) };
    } catch {
      return { message: 'Unserializable error' };
    }
  }
  return { message: String(err) };
}

// ── Runtime ──────────────────────────────────────────────────────────────────

let context: ErrorContext = { userId: null, orgId: null, view: null };
let available = true;
let installed = false;
const gate = createGate();
let cachedVersion: string | null | undefined;
let cachedFamily: BrowserFamily | null | undefined;

function safeSessionStorage(): Storage | null {
  try {
    return typeof sessionStorage !== 'undefined' ? sessionStorage : null;
  } catch {
    return null;
  }
}

function currentEnv(): ReportEnv {
  let forced = false;
  try {
    forced = localStorage.getItem(FORCE_KEY) === '1';
  } catch {
    // storage blocked — treat as not forced
  }
  return { hostname: window.location.hostname, forced };
}

function appVersion(): string | null {
  if (cachedVersion !== undefined) return cachedVersion;
  try {
    const meta = document.querySelector('meta[name="app-version"]')?.getAttribute('content') ?? null;
    const srcs = Array.from(document.querySelectorAll('script[src]')).map(s => s.getAttribute('src') ?? '');
    cachedVersion = appVersionFrom(srcs, meta);
  } catch {
    cachedVersion = null;
  }
  return cachedVersion;
}

function userAgentClass(): BrowserFamily | null {
  if (cachedFamily !== undefined) return cachedFamily;
  try {
    cachedFamily = browserFamily(navigator.userAgent ?? '');
  } catch {
    cachedFamily = null;
  }
  return cachedFamily;
}

function isMissingTable(error: { code?: string; message?: string }): boolean {
  return error.code === '42P01' || error.code === 'PGRST205' ||
    /relation .* does not exist|could not find the table/i.test(error.message ?? '');
}

/** Attach the signed-in identity and current screen to every later report. */
export function setErrorContext(patch: Partial<ErrorContext>): void {
  context = { ...context, ...patch };
}

export function clearErrorContext(): void {
  context = { userId: null, orgId: null, view: null };
}

/**
 * Record one error. Never throws, never awaits — reporting must not be able to
 * break the thing it is reporting on.
 *
 *   reportError(err, { source: 'boundary', component: 'ImageGrouper' })
 */
export function reportError(err: unknown, options: ReportOptions = {}): void {
  if (!available || typeof window === 'undefined') return;
  try {
    if (!shouldReport(currentEnv())) return;
    const source = options.source ?? 'manual';
    const errorLike = toErrorLike(err);
    const row = buildErrorRow(source, errorLike, context, {
      sessionId: getSessionId(safeSessionStorage()),
      path: window.location.pathname,
      userAgentClass: userAgentClass(),
      appVersion: appVersion(),
    }, options.component ?? null);

    if (!allowReport(gate, row.fingerprint, Date.now())) return;

    void supabase.from('app_errors').insert(row).then(({ error }) => {
      if (!error) return;
      if (isMissingTable(error)) {
        available = false;
        log.service('errorReporter | app_errors missing — reporting disabled until the migration runs');
      } else {
        // Includes the 54000 rate limit: not our problem to retry, and NOT a
        // reason to stop reporting for the rest of the session.
        log.service(`errorReporter | insert failed: ${error.message}`);
      }
    });
  } catch (unexpected) {
    // A throw in here would turn a handled error into an unhandled one.
    log.error(`errorReporter | unexpected: ${String(unexpected)}`);
  }
}

/**
 * Install the two global listeners. Idempotent — safe under StrictMode's double
 * invoke and safe to call from more than one boot path.
 */
export function installErrorReporter(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('error', (ev: ErrorEvent) => {
    // ev.error is absent for cross-origin script errors ("Script error.") and
    // for resource load failures; the message is all we get.
    reportError(ev.error ?? ev.message ?? 'Unknown window error', { source: 'window' });
  });
  window.addEventListener('unhandledrejection', (ev: PromiseRejectionEvent) => {
    reportError(ev.reason ?? 'Unhandled rejection', { source: 'unhandledrejection' });
  });
}

/** TEST ONLY — reset the module latches between cases. */
export function __resetErrorReporter(): void {
  context = { userId: null, orgId: null, view: null };
  available = true;
  installed = false;
  gate.seen.clear();
  gate.sent = 0;
  cachedVersion = undefined;
  cachedFamily = undefined;
}

// ── Founder dashboard ────────────────────────────────────────────────────────

export interface ErrorGroup {
  fingerprint: string;
  count: number;
  sessions: number;
  users: number;
  message: string;
  source: string;
  component: string | null;
  view: string | null;
  app_version: string | null;
  first_seen: string;
  last_seen: string;
}

export interface ErrorSummary {
  days: number;
  from: string;
  totals: { errors: number; fingerprints: number; sessions: number; users: number; last_seen: string | null };
  groups: ErrorGroup[];
  daily: Array<{ day: string; errors: number; fingerprints: number }>;
  views: Array<{ view: string; errors: number; sessions: number }>;
}

export type ErrorSummaryResult =
  | { status: 'ok'; summary: ErrorSummary }
  | { status: 'unavailable' }
  | { status: 'forbidden' };

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

export async function fetchErrorSummary(days: number): Promise<ErrorSummaryResult> {
  try {
    const { data, error } = await supabase.rpc('app_errors_summary', { p_days: days });
    if (error) {
      log.service(`fetchErrorSummary | ${error.code ?? ''} ${error.message}`);
      return error.code === '42501' ? { status: 'forbidden' } : { status: 'unavailable' };
    }
    const d = (data ?? {}) as Partial<ErrorSummary>;
    return {
      status: 'ok',
      summary: {
        days: num(d.days) || days,
        from: String(d.from ?? ''),
        totals: {
          errors: num(d.totals?.errors),
          fingerprints: num(d.totals?.fingerprints),
          sessions: num(d.totals?.sessions),
          users: num(d.totals?.users),
          last_seen: str(d.totals?.last_seen),
        },
        groups: (d.groups ?? []).map(g => ({
          fingerprint: String(g.fingerprint ?? ''),
          count: num(g.count),
          sessions: num(g.sessions),
          users: num(g.users),
          message: String(g.message ?? ''),
          source: String(g.source ?? ''),
          component: str(g.component),
          view: str(g.view),
          app_version: str(g.app_version),
          first_seen: String(g.first_seen ?? ''),
          last_seen: String(g.last_seen ?? ''),
        })),
        daily: (d.daily ?? []).map(x => ({ day: String(x.day), errors: num(x.errors), fingerprints: num(x.fingerprints) })),
        views: (d.views ?? []).map(x => ({ view: String(x.view), errors: num(x.errors), sessions: num(x.sessions) })),
      },
    };
  } catch (err) {
    log.error(`fetchErrorSummary | unexpected: ${String(err)}`);
    return { status: 'unavailable' };
  }
}

/** "3 minutes ago" / "2 days ago" — the last-seen column in the panel. */
export function relativeTime(iso: string | null, now: number = Date.now()): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '—';
  const secs = Math.max(0, Math.round((now - t) / 1000));
  if (secs < 60) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}
