import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { act } from 'react';
import BarcodeScannerView from './BarcodeScannerView';
import { mount, cleanup } from './ui/testUtils';
import { usesNativeBarcodeScanner } from '../lib/native/barcode';
import { hasNativePlugin } from '../lib/native/nativePlugin';
import { findProductBySku } from '../lib/labelsService';

/**
 * Android can kill the webview while ML Kit's scanner is open; the scan then
 * comes back as @capacitor/app's appRestoredResult. Locked here: on native the
 * restored barcode goes into the normal lookup, anything else is ignored, and
 * the web build never imports @capacitor/app.
 */

type RestoredHandler = (event: { pluginId: string; methodName: string; success: boolean; data?: unknown }) => void;
const listeners: RestoredHandler[] = [];
const remove = vi.fn(async () => {});
const addListener = vi.fn(async (_name: string, cb: RestoredHandler) => {
  listeners.push(cb);
  return { remove };
});

vi.mock('@capacitor/app', () => ({ App: { addListener: (name: string, cb: RestoredHandler) => addListener(name, cb) } }));
vi.mock('../lib/native/nativePlugin', () => ({ hasNativePlugin: vi.fn(() => false) }));
vi.mock('../lib/native/barcode', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/native/barcode')>();
  return { ...actual, usesNativeBarcodeScanner: vi.fn(() => false) };
});
vi.mock('../lib/labelsService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/labelsService')>();
  return { ...actual, findProductBySku: vi.fn(async () => ({ status: 'not_found', tried: ['x'] })) };
});

async function flush() {
  await act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); });
}

describe('BarcodeScannerView restored scan result', () => {
  beforeEach(() => {
    listeners.length = 0;
    addListener.mockClear();
    remove.mockClear();
    vi.mocked(findProductBySku).mockClear();
    vi.mocked(usesNativeBarcodeScanner).mockReturnValue(false);
    vi.mocked(hasNativePlugin).mockReturnValue(false);
  });
  afterEach(() => cleanup());

  it('web: registers nothing', async () => {
    mount(<BarcodeScannerView />);
    await flush();
    expect(addListener).not.toHaveBeenCalled();
  });

  it('native: a restored ML Kit scan is looked up; other plugins are ignored', async () => {
    vi.mocked(usesNativeBarcodeScanner).mockReturnValue(true);
    vi.mocked(hasNativePlugin).mockReturnValue(true);
    const { unmount } = mount(<BarcodeScannerView />);
    await flush();
    expect(addListener).toHaveBeenCalledWith('appRestoredResult', expect.any(Function));
    const fire = listeners[0];

    await act(async () => { fire({ pluginId: 'Camera', methodName: 'takePhoto', success: true, data: {} }); });
    await act(async () => { fire({ pluginId: 'BarcodeScanner', methodName: 'scan', success: false }); });
    expect(findProductBySku).not.toHaveBeenCalled();

    await act(async () => {
      fire({ pluginId: 'BarcodeScanner', methodName: 'scan', success: true, data: { barcodes: [{ rawValue: ' ACD-7H2K9M ', format: 'CODE_128' }] } });
    });
    await flush();
    expect(findProductBySku).toHaveBeenCalledWith('ACD-7H2K9M');

    unmount();
    expect(remove).toHaveBeenCalled();
  });
});
