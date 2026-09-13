import { describe, it, expect } from 'vitest';
import {
  getSessionId, shouldTrack, deviceClass, referrerHost, buildEvent, buildFunnel,
  compactNumber, percentDelta, niceCeiling, SESSION_KEY,
} from './analytics';

/**
 * The privacy contract of the first-party tracker (what a row may contain,
 * when nothing is sent at all) and the dashboard math. Nothing here touches
 * the network — track() itself is exercised only through its pure pieces.
 */

const memStorage = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } };
};

describe('analytics — session + gating', () => {
  it('creates one session id per tab and reuses it', () => {
    const s = memStorage();
    const a = getSessionId(s);
    expect(a.length).toBeGreaterThanOrEqual(8);
    expect(getSessionId(s)).toBe(a);
    expect(s.getItem(SESSION_KEY)).toBe(a);
    expect(getSessionId(memStorage())).not.toBe(a);
    expect(getSessionId(null).length).toBeGreaterThanOrEqual(8); // storage blocked still works
  });

  it('honors Do Not Track and skips localhost unless forced', () => {
    expect(shouldTrack({ hostname: 'gerbriel.github.io', doNotTrack: null, forced: false })).toBe(true);
    expect(shouldTrack({ hostname: 'gerbriel.github.io', doNotTrack: '1', forced: false })).toBe(false);
    expect(shouldTrack({ hostname: 'gerbriel.github.io', doNotTrack: 'yes', forced: true })).toBe(false);
    expect(shouldTrack({ hostname: 'localhost', doNotTrack: null, forced: false })).toBe(false);
    expect(shouldTrack({ hostname: '127.0.0.1', doNotTrack: null, forced: false })).toBe(false);
    expect(shouldTrack({ hostname: 'localhost', doNotTrack: null, forced: true })).toBe(true);
  });

  it('classifies devices by width', () => {
    expect(deviceClass(390)).toBe('mobile');
    expect(deviceClass(800)).toBe('tablet');
    expect(deviceClass(1440)).toBe('desktop');
  });

  it('keeps only the referrer host, drops self-referrals and garbage', () => {
    expect(referrerHost('https://www.google.com/search?q=acadia', 'gerbriel.github.io')).toBe('google.com');
    expect(referrerHost('https://gerbriel.github.io/sortbot/', 'gerbriel.github.io')).toBeNull();
    expect(referrerHost('https://www.gerbriel.github.io/x', 'gerbriel.github.io')).toBeNull();
    expect(referrerHost('', 'x')).toBeNull();
    expect(referrerHost('not a url', 'x')).toBeNull();
  });

  it('builds a row with only the allowed fields, clamped', () => {
    const row = buildEvent(
      'CSV Exported',
      { products: 12, note: 'x'.repeat(500), nested: { a: 1 } as unknown as string, flag: true },
      { userId: 'u1', orgId: 'o1' },
      { sessionId: 'sess-12345678', path: '/sortbot/', referrer: 'google.com', device: 'desktop', view: 'app' },
    );
    expect(row).toEqual({
      event: 'CSV Exported',
      props: { products: 12, note: 'x'.repeat(200), flag: true },
      session_id: 'sess-12345678',
      user_id: 'u1',
      org_id: 'o1',
      view: 'app',
      path: '/sortbot/',
      referrer: 'google.com',
      device: 'desktop',
    });
    expect(Object.keys(row)).not.toContain('user_agent');
  });
});

describe('analytics — dashboard math', () => {
  it('builds the funnel in order with conversion rates', () => {
    const f = buildFunnel([
      { event: 'CSV Exported', count: 5 },
      { event: 'Beta Signup', count: 40 },
      { event: 'Batch Created', count: 10 },
      { event: 'Account Created', count: 20 },
      { event: 'Something Else', count: 99 },
    ]);
    expect(f.map(s => s.step)).toEqual(['Beta Signup', 'Account Created', 'Batch Created', 'CSV Exported']);
    expect(f.map(s => s.count)).toEqual([40, 20, 10, 5]);
    expect(f[0]).toMatchObject({ ofFirst: null, ofPrevious: null });
    expect(f[1]).toMatchObject({ ofFirst: 0.5, ofPrevious: 0.5 });
    expect(f[3]).toMatchObject({ ofFirst: 0.125, ofPrevious: 0.5 });
  });

  it('funnel tolerates missing steps and a zero first step', () => {
    const f = buildFunnel([{ event: 'Batch Created', count: 3 }]);
    expect(f.map(s => s.count)).toEqual([0, 0, 3, 0]);
    expect(f[2].ofFirst).toBeNull();
    expect(f[2].ofPrevious).toBeNull();
  });

  it('formats stat-tile numbers compactly', () => {
    expect(compactNumber(0)).toBe('0');
    expect(compactNumber(1284)).toBe('1,284');
    expect(compactNumber(12_900)).toBe('12.9K');
    expect(compactNumber(120_000)).toBe('120K');
    expect(compactNumber(4_200_000)).toBe('4.2M');
  });

  it('computes signed deltas and a clean tick ceiling', () => {
    expect(percentDelta(120, 100)).toBeCloseTo(0.2);
    expect(percentDelta(80, 100)).toBeCloseTo(-0.2);
    expect(percentDelta(5, 0)).toBeNull();
    expect(niceCeiling(0)).toBe(1);
    expect(niceCeiling(7)).toBe(10);
    expect(niceCeiling(13)).toBe(20);
    expect(niceCeiling(42)).toBe(50);
    expect(niceCeiling(1200)).toBe(2000);
  });
});
