/**
 * nativePlugin.ts: "is this native plugin actually linked into this build?"
 *
 * isNative() alone is not enough. Today every plugin in package.json is linked
 * on both platforms (iOS through CocoaPods, Android through Gradle), but a
 * plugin can be installed in node_modules and still be missing from a native
 * build (removed from the Podfile or Gradle settings, or skipped by `cap sync`,
 * which is what happened while the iOS project was on Swift Package Manager).
 * Calling such a plugin rejects with "not implemented". The adapters in this
 * folder ask here first and fall back to the web path when the answer is
 * false, so a missing native plugin degrades to exactly what the web build
 * does. The iOS plugin paths are untested on a device.
 *
 * Always false on the web, in vitest and in the web build.
 */
import { Capacitor } from '@capacitor/core';
import { isNative } from '../platform';

export function hasNativePlugin(name: string): boolean {
  return isNative() && Capacitor.isPluginAvailable(name);
}
