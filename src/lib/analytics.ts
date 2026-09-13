/**
 * First-party analytics — cookieless pageview + funnel-event tracking stored
 * in OUR OWN Supabase project (`analytics_events`). No third-party script, no
 * external API: nothing leaves the database we already run.
 *
 * PRIVACY MODEL: a random per-tab session id (sessionStorage — gone when the
 * tab closes), the referrer's HOST only, a coarse device class, and — for
 * signed-in users — their own user/org id. No cookies, no IP, no user agent.
 * Honors the browser's Do Not Track signal. Skips localhost so dev sessions
 * never pollute the numbers (set localStorage `sortbot_analytics_force=1` to
 * override while testing).
 *
 * FORWARD-COMPATIBLE: if analytics_events.sql has not been run, the first
 * failed insert marks the tracker unavailable and every later call is a no-op.
 *
 * Events fired by the app:
 *   pageview         top-level view change (landing / auth / waitlist / app)
 *   Beta Signup      landing form submitted OK
 *   Account Created  Auth sign-up succeeded
 *   Batch Created    first upload of a new session minted a batch
 *   CSV Exported     Shopify CSV downloaded   { products }
 *
 * The founder dashboard reads `analytics_summary(days)` (one RPC round-trip,
 * Founding admins only) — see AnalyticsPanel.tsx.
 */
import { supabase } from './supabase';
import { log } from './debugLogger';

export type AnalyticsProps = Record<string, string | number | boolean>;
export type DeviceClass = 'mobile' | 'tablet' | 'desktop';
export type AnalyticsView = 'landing' | 'auth' | 'waitlist' | 'app';

export interface AnalyticsContext {
  userId: string | null;
  orgId: string | null;
}

export interface AnalyticsEventRow {
  event: string;
  props: AnalyticsProps;
  session_id: string;
  user_id: string | null;
  org_id: string | null;
  view: string | null;
  path: string | null;
  referrer: string | null;
  device: DeviceClass | null;
}

export const SESSION_KEY = 'sortbot_analytics_session';
export const FORCE_KEY = 'sortbot_analytics_force';
/** The funnel the dashboard draws, in order. */
export const FUNNEL_STEPS = ['Beta Signup', 'Account Created', 'Batch Created', 'CSV Exported'] as const;

let context: AnalyticsContext = { userId: null, orgId: null };
let currentView: AnalyticsView | null = null;
let available = true;

// ── Pure helpers (unit-tested) ───────────────────────────────────────────────

function randomId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch {
    // fall through
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** Per-tab session id: created once, then stable for the life of the tab. */
export function getSessionId(storage: Pick<Storage, 'getItem' | 'setItem'> | null): string {
  try {
    const existing = storage?.getItem(SESSION_KEY);
    if (existing && existing.length >= 8) return existing;
    const fresh = randomId();
    storage?.setItem(SESSION_KEY, fresh);
    return fresh;
  } catch {
    return randomId();
  }
}

export interface TrackEnv {
  hostname: string;
  doNotTrack: string | null;
  forced: boolean;
}

/** Respect DNT; skip local dev unless explicitly forced. */
export function shouldTrack(env: TrackEnv): boolean {
  if (env.doNotTrack === '1' || env.doNotTrack === 'yes') return false;
  const local = env.hostname === 'localhost' || env.hostname === '127.0.0.1' || env.hostname === '[::1]';
  if (local && !env.forced) return false;
  return true;
}

export function deviceClass(width: number): DeviceClass {
  if (width <= 640) return 'mobile';
  if (width <= 1024) return 'tablet';
  return 'desktop';
}

/** The referrer's host only — never the full URL — and never our own site. */
export function referrerHost(referrer: string, ownHost: string): string | null {
  if (!referrer) return null;
  try {
    const host = new URL(referrer).hostname.replace(/^www\./, '');
    if (!host || host === ownHost.replace(/^www\./, '')) return null;
    return host.slice(0, 200);
  } catch {
    return null;
  }
}

export interface PageEnv {
  sessionId: string;
  path: string;
  referrer: string | null;
  device: DeviceClass;
  view: AnalyticsView | null;
}

export function buildEvent(event: string, props: AnalyticsProps, ctx: AnalyticsContext, page: PageEnv): AnalyticsEventRow {
  const cleanProps: AnalyticsProps = {};
  for (const [k, v] of Object.entries(props)) {
    if (typeof v === 'string') cleanProps[k.slice(0, 40)] = v.slice(0, 200);
    else if (typeof v === 'number' || typeof v === 'boolean') cleanProps[k.slice(0, 40)] = v;
  }
  return {
    event: event.slice(0, 60),
    props: cleanProps,
    session_id: page.sessionId,
    user_id: ctx.userId,
    org_id: ctx.orgId,
    view: page.view,
    path: page.path.slice(0, 200),
    referrer: page.referrer,
    device: page.device,
  };
}

// ── Runtime ──────────────────────────────────────────────────────────────────

function safeSessionStorage(): Storage | null {
  try {
    return typeof sessionStorage !== 'undefined' ? sessionStorage : null;
  } catch {
    return null;
  }
}

function currentEnv(): TrackEnv {
  let forced = false;
  try {
    forced = localStorage.getItem(FORCE_KEY) === '1';
  } catch {
    // ignore
  }
  return {
    hostname: window.location.hostname,
    doNotTrack: navigator.doNotTrack ?? null,
    forced,
  };
}

function currentPage(): PageEnv {
  return {
    sessionId: getSessionId(safeSessionStorage()),
    path: window.location.pathname,
    referrer: referrerHost(document.referrer, window.location.hostname),
    device: deviceClass(window.innerWidth),
    view: currentView,
  };
}

function isMissingTable(error: { code?: string; message?: string }): boolean {
  return error.code === '42P01' || error.code === 'PGRST205' ||
    /relation .* does not exist|could not find the table/i.test(error.message ?? '');
}

export function setAnalyticsContext(patch: Partial<AnalyticsContext>): void {
  context = { ...context, ...patch };
}

export function clearAnalyticsContext(): void {
  context = { userId: null, orgId: null };
}

/** Fire an event. Never throws, never awaits — analytics must not slow or break the app. */
export function track(event: string, props: AnalyticsProps = {}): void {
  if (!available || typeof window === 'undefined') return;
  if (!shouldTrack(currentEnv())) return;
  try {
    const row = buildEvent(event, props, context, currentPage());
    void supabase.from('analytics_events').insert(row).then(({ error }) => {
      if (!error) return;
      if (isMissingTable(error)) {
        available = false;
        log.service('analytics | analytics_events missing — tracking disabled until the migration runs');
      } else {
        log.service(`analytics | insert failed: ${error.message}`);
      }
    });
  } catch (err) {
    log.error(`analytics | unexpected: ${String(err)}`);
  }
}

/** One pageview per top-level view change (the app has no router). */
export function trackPageview(view: AnalyticsView): void {
  if (view === currentView) return;
  currentView = view;
  track('pageview');
}

// ── Founder dashboard ────────────────────────────────────────────────────────

export interface AnalyticsSummary {
  days: number;
  from: string;
  totals: { pageviews: number; sessions: number; users: number; events: number; beta_signups: number };
  previous: { pageviews: number; sessions: number };
  daily: Array<{ day: string; pageviews: number; sessions: number }>;
  events: Array<{ event: string; count: number; sessions: number }>;
  referrers: Array<{ referrer: string; sessions: number }>;
  devices: Array<{ device: string; sessions: number }>;
  views: Array<{ view: string; pageviews: number }>;
}

export type AnalyticsSummaryResult =
  | { status: 'ok'; summary: AnalyticsSummary }
  | { status: 'unavailable' }
  | { status: 'forbidden' };

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);

export async function fetchAnalyticsSummary(days: number): Promise<AnalyticsSummaryResult> {
  try {
    const { data, error } = await supabase.rpc('analytics_summary', { p_days: days });
    if (error) {
      log.service(`fetchAnalyticsSummary | ${error.code ?? ''} ${error.message}`);
      return error.code === '42501' ? { status: 'forbidden' } : { status: 'unavailable' };
    }
    const d = (data ?? {}) as Partial<AnalyticsSummary>;
    return {
      status: 'ok',
      summary: {
        days: num(d.days) || days,
        from: String(d.from ?? ''),
        totals: {
          pageviews: num(d.totals?.pageviews), sessions: num(d.totals?.sessions), users: num(d.totals?.users),
          events: num(d.totals?.events), beta_signups: num(d.totals?.beta_signups),
        },
        previous: { pageviews: num(d.previous?.pageviews), sessions: num(d.previous?.sessions) },
        daily: (d.daily ?? []).map(x => ({ day: String(x.day), pageviews: num(x.pageviews), sessions: num(x.sessions) })),
        events: (d.events ?? []).map(x => ({ event: String(x.event), count: num(x.count), sessions: num(x.sessions) })),
        referrers: (d.referrers ?? []).map(x => ({ referrer: String(x.referrer), sessions: num(x.sessions) })),
        devices: (d.devices ?? []).map(x => ({ device: String(x.device), sessions: num(x.sessions) })),
        views: (d.views ?? []).map(x => ({ view: String(x.view), pageviews: num(x.pageviews) })),
      },
    };
  } catch (err) {
    log.error(`fetchAnalyticsSummary | unexpected: ${String(err)}`);
    return { status: 'unavailable' };
  }
}

export interface FunnelStep {
  step: string;
  count: number;
  /** share of the first step, 0-1 (null for the first step) */
  ofFirst: number | null;
  /** share of the previous step, 0-1 (null for the first step or when the previous is 0) */
  ofPrevious: number | null;
}

/** The four-step funnel in FUNNEL_STEPS order, from the summary's event counts. */
export function buildFunnel(events: Array<{ event: string; count: number }>): FunnelStep[] {
  const counts = new Map(events.map(e => [e.event, e.count]));
  const out: FunnelStep[] = [];
  let first = 0;
  let prev = 0;
  FUNNEL_STEPS.forEach((step, i) => {
    const count = counts.get(step) ?? 0;
    if (i === 0) {
      first = count;
      out.push({ step, count, ofFirst: null, ofPrevious: null });
    } else {
      out.push({
        step,
        count,
        ofFirst: first > 0 ? count / first : null,
        ofPrevious: prev > 0 ? count / prev : null,
      });
    }
    prev = count;
  });
  return out;
}

/** 1,284 · 12.9K · 4.2M — the stat-tile number format. */
export function compactNumber(n: number): string {
  const abs = Math.abs(n);
  if (abs < 10_000) return n.toLocaleString('en-US');
  if (abs < 1_000_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
}

/** Signed change vs the previous period as a fraction, or null when there is no baseline. */
export function percentDelta(current: number, previous: number): number | null {
  if (!previous) return null;
  return (current - previous) / previous;
}

/** Round a max up to a clean tick ceiling: 1 / 2 / 5 × 10^k. */
export function niceCeiling(max: number): number {
  if (max <= 0) return 1;
  const exp = Math.floor(Math.log10(max));
  const base = Math.pow(10, exp);
  const m = max / base;
  const step = m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10;
  return step * base;
}
