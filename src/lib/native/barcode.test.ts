import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  const listeners: Record<string, (data: unknown) => void> = {};
  const plugin = {
    isSupported: vi.fn(async () => ({ supported: true })),
    isGoogleBarcodeScannerModuleAvailable: vi.fn(async () => ({ available: true })),
    installGoogleBarcodeScannerModule: vi.fn(async () => {}),
    checkPermissions: vi.fn(async () => ({ camera: 'granted' })),
    requestPermissions: vi.fn(async () => ({ camera: 'granted' })),
    scan: vi.fn(async (o?: unknown) => { void o; return { barcodes: [{ rawValue: ' ACD-7H2K9M ', format: 'CODE_128' }] }; }),
    addListener: vi.fn(async (name: string, fn: (data: unknown) => void) => {
      listeners[name] = fn;
      return { remove: vi.fn(async () => { delete listeners[name]; }) };
    }),
  };
  return { listeners, plugin, native: { value: false }, os: { value: 'android' as 'android' | 'ios' | 'web' } };
});

vi.mock('./nativePlugin', () => ({ hasNativePlugin: () => h.native.value }));
vi.mock('../platform', () => ({ isNative: () => h.native.value, platform: () => h.os.value }));
vi.mock('@capacitor-mlkit/barcode-scanning', () => ({ BarcodeScanner: h.plugin }));

import {
  scanBarcodes, isBarcodeScanAvailable, usesNativeBarcodeScanner, getBarcodeDetectorCtor,
  BarcodeScanError, MODULE_INSTALL_TIMEOUT_MS, __resetBarcodePluginForTests,
} from './barcode';

class FakeDetector {
  static made: Array<{ formats?: string[] }> = [];
  static next: Array<{ rawValue: string; format: string }> = [];
  constructor(opts?: { formats?: string[] }) { FakeDetector.made.push(opts ?? {}); }
  detect = vi.fn(async () => FakeDetector.next);
}

beforeEach(() => {
  h.native.value = false;
  h.os.value = 'android';
  FakeDetector.made = [];
  FakeDetector.next = [];
  __resetBarcodePluginForTests();
  vi.clearAllMocks();
  for (const k of Object.keys(h.listeners)) delete h.listeners[k];
});

afterEach(() => {
  delete (window as unknown as Record<string, unknown>).BarcodeDetector;
});

describe('web path', () => {
  it('reports no reader when BarcodeDetector is missing', async () => {
    expect(usesNativeBarcodeScanner()).toBe(false);
    expect(getBarcodeDetectorCtor()).toBeNull();
    expect(await isBarcodeScanAvailable()).toBe(false);
    const err = await scanBarcodes({ source: {} as CanvasImageSource }).catch(e => e);
    expect(err).toBeInstanceOf(BarcodeScanError);
    expect(err.code).toBe('unsupported');
    expect(h.plugin.scan).not.toHaveBeenCalled();
  });

  it('needs a frame to decode', async () => {
    (window as unknown as Record<string, unknown>).BarcodeDetector = FakeDetector;
    await expect(scanBarcodes()).rejects.toMatchObject({ code: 'unsupported' });
  });

  it('decodes a frame with code_128 by default, trims, drops empties, reuses the detector', async () => {
    (window as unknown as Record<string, unknown>).BarcodeDetector = FakeDetector;
    expect(await isBarcodeScanAvailable()).toBe(true);
    FakeDetector.next = [{ rawValue: ' ACD-1 ', format: 'code_128' }, { rawValue: '  ', format: 'code_128' }];
    const res = await scanBarcodes({ source: {} as CanvasImageSource });
    expect(res).toEqual({ barcodes: [{ rawValue: 'ACD-1', format: 'code_128' }], cancelled: false });
    await scanBarcodes({ source: {} as CanvasImageSource });
    expect(FakeDetector.made).toEqual([{ formats: ['code_128'] }]);
    await scanBarcodes({ source: {} as CanvasImageSource, formats: ['qr_code'] });
    expect(FakeDetector.made).toHaveLength(2);
  });
});

describe('native path', () => {
  beforeEach(() => { h.native.value = true; });

  it('Android with the module present: scans with ML Kit format names and normalizes the result', async () => {
    expect(usesNativeBarcodeScanner()).toBe(true);
    const res = await scanBarcodes({ formats: ['code_128', 'qr_code'] });
    expect(h.plugin.scan).toHaveBeenCalledWith({ formats: ['CODE_128', 'QR_CODE'] });
    expect(res).toEqual({ barcodes: [{ rawValue: 'ACD-7H2K9M', format: 'code_128' }], cancelled: false });
    expect(h.plugin.installGoogleBarcodeScannerModule).not.toHaveBeenCalled();
    // Android's scan() needs no camera permission, so none is requested.
    expect(h.plugin.requestPermissions).not.toHaveBeenCalled();
  });

  it('Android without the module: installs it, reports progress, then scans', async () => {
    h.plugin.isGoogleBarcodeScannerModuleAvailable.mockResolvedValueOnce({ available: false });
    h.plugin.installGoogleBarcodeScannerModule.mockImplementationOnce(async () => {
      setTimeout(() => {
        h.listeners.googleBarcodeScannerModuleInstallProgress({ state: 2, progress: 40 });
        h.listeners.googleBarcodeScannerModuleInstallProgress({ state: 4, progress: 100 });
      }, 0);
    });
    const progress = vi.fn();
    const res = await scanBarcodes({ onModuleInstallProgress: progress });
    expect(progress.mock.calls.map(c => c[0])).toEqual([undefined, 40, 100]);
    expect(res.barcodes).toHaveLength(1);
    expect(h.listeners.googleBarcodeScannerModuleInstallProgress).toBeUndefined();
  });

  it('Android module install failure rejects module-install-failed without scanning', async () => {
    h.plugin.isGoogleBarcodeScannerModuleAvailable.mockResolvedValueOnce({ available: false });
    h.plugin.installGoogleBarcodeScannerModule.mockImplementationOnce(async () => {
      setTimeout(() => h.listeners.googleBarcodeScannerModuleInstallProgress({ state: 5 }), 0);
    });
    await expect(scanBarcodes()).rejects.toMatchObject({ code: 'module-install-failed' });
    expect(h.plugin.scan).not.toHaveBeenCalled();
  });

  it('Android install timeout before addListener resolves still removes the listener', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      h.plugin.isGoogleBarcodeScannerModuleAvailable.mockResolvedValueOnce({ available: false });
      const remove = vi.fn(async () => {});
      let resolveAdd: (v: { remove: typeof remove }) => void = () => {};
      h.plugin.addListener.mockImplementationOnce(() => new Promise(res => { resolveAdd = res; }));
      const p = scanBarcodes().catch(e => e);
      await vi.advanceTimersByTimeAsync(MODULE_INSTALL_TIMEOUT_MS);
      const err = await p;
      expect(err).toMatchObject({ code: 'module-install-failed' });
      resolveAdd({ remove }); // the handle arrives after the wait is over
      await vi.advanceTimersByTimeAsync(0);
      expect(remove).toHaveBeenCalledTimes(1);
      expect(h.plugin.installGoogleBarcodeScannerModule).not.toHaveBeenCalled();
      expect(h.plugin.scan).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('iOS requests the camera permission and refuses on denial', async () => {
    h.os.value = 'ios';
    h.plugin.checkPermissions.mockResolvedValueOnce({ camera: 'prompt' });
    h.plugin.requestPermissions.mockResolvedValueOnce({ camera: 'denied' });
    await expect(scanBarcodes()).rejects.toMatchObject({ code: 'permission-denied' });
    expect(h.plugin.scan).not.toHaveBeenCalled();
    expect(h.plugin.isGoogleBarcodeScannerModuleAvailable).not.toHaveBeenCalled();
  });

  it('iOS with permission granted scans', async () => {
    h.os.value = 'ios';
    const res = await scanBarcodes();
    expect(res.cancelled).toBe(false);
    expect(h.plugin.requestPermissions).not.toHaveBeenCalled();
  });

  it('closing the scanner is a cancel, not an error', async () => {
    h.plugin.scan.mockRejectedValueOnce(new Error('scan canceled.'));
    expect(await scanBarcodes()).toEqual({ barcodes: [], cancelled: true });
    h.plugin.scan.mockResolvedValueOnce({ barcodes: [] });
    expect(await scanBarcodes()).toEqual({ barcodes: [], cancelled: true });
  });

  it('other scan failures reject failed; an unsupported device rejects unsupported', async () => {
    h.plugin.scan.mockRejectedValueOnce(new Error('boom'));
    await expect(scanBarcodes()).rejects.toMatchObject({ code: 'failed' });
    h.plugin.isSupported.mockResolvedValueOnce({ supported: false });
    await expect(scanBarcodes()).rejects.toMatchObject({ code: 'unsupported' });
  });

  it('isBarcodeScanAvailable asks the plugin and never rejects', async () => {
    expect(await isBarcodeScanAvailable()).toBe(true);
    h.plugin.isSupported.mockRejectedValueOnce(new Error('not implemented'));
    expect(await isBarcodeScanAvailable()).toBe(false);
  });
});
