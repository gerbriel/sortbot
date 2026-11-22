/**
 * platform.ts: which shell is this build running in?
 *
 * The same dist/ bundle ships to the web (GitHub Pages, arcadian.ltd) and inside
 * the Capacitor native shell (iOS + Android, capacitor.config.ts). Code that
 * needs a native-only path asks here, and must keep the web path working when
 * the answer is "web" (a plugin absent is the normal case on the web).
 *
 * API (keep it this small):
 *   isNative()    true inside the iOS or Android app, false in any browser.
 *   platform()    'ios' | 'android' | 'web'.
 *   nativeOrigin  the webview origin of the native app on this platform
 *                 ('capacitor://localhost' on iOS, 'https://localhost' on
 *                 Android), or null on the web. NATIVE_ORIGINS lists both.
 *
 * Safe to import anywhere: @capacitor/core only reads window.Capacitor, which
 * the native runtime injects; in a browser, in vitest/happy-dom and in the web
 * build it reports 'web' and touches no plugin.
 */
import { Capacitor } from '@capacitor/core';

export type Platform = 'ios' | 'android' | 'web';

/** The webview origins the native shell serves the app from (capacitor.config.ts). */
export const NATIVE_ORIGINS = {
  ios: 'capacitor://localhost',
  android: 'https://localhost',
} as const;

export function isNative(): boolean {
  return Capacitor.isNativePlatform();
}

export function platform(): Platform {
  const p = Capacitor.getPlatform();
  return p === 'ios' || p === 'android' ? p : 'web';
}

/** Origin of the native webview on this platform; null on the web. */
export const nativeOrigin: string | null = (() => {
  const p = platform();
  return p === 'web' ? null : NATIVE_ORIGINS[p];
})();
