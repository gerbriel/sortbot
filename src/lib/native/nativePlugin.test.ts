import { describe, expect, it, vi } from 'vitest';
import { Capacitor } from '@capacitor/core';

const h = vi.hoisted(() => ({ native: { value: false } }));
vi.mock('../platform', () => ({ isNative: () => h.native.value }));

import { hasNativePlugin } from './nativePlugin';

describe('hasNativePlugin', () => {
  it('is false on the web even if the plugin registry would say yes', () => {
    const spy = vi.spyOn(Capacitor, 'isPluginAvailable').mockReturnValue(true);
    h.native.value = false;
    expect(hasNativePlugin('Camera')).toBe(false);
    spy.mockRestore();
  });

  it('on native, follows whether the plugin is linked into this build', () => {
    h.native.value = true;
    const spy = vi.spyOn(Capacitor, 'isPluginAvailable');
    spy.mockReturnValueOnce(true);
    expect(hasNativePlugin('BarcodeScanner')).toBe(true);
    spy.mockReturnValueOnce(false); // e.g. a CocoaPods-only plugin in the SPM iOS project
    expect(hasNativePlugin('BarcodeScanner')).toBe(false);
    expect(spy).toHaveBeenCalledWith('BarcodeScanner');
    spy.mockRestore();
  });
});
