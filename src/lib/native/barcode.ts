/**
 * native/barcode.ts: read a barcode with the camera, in the browser or the app.
 *
 * Not to be confused with src/lib/barcode.ts, which ENCODES our Code 128 labels
 * and owns the SKU rules. This module only READS codes and hands back the raw
 * text; parsing and lookup stay where they are (labelsService.findProductBySku).
 *
 * TWO PATHS, one result shape ({ rawValue, format }):
 *   web     the browser's own BarcodeDetector, run on a frame the caller
 *           supplies (a <video> fed by getUserMedia). Chrome and Edge have it;
 *           Safari and Firefox do not. No polyfill, see BarcodeScannerView.
 *   native  Google ML Kit through @capacitor-mlkit/barcode-scanning, using the
 *           plugin's ready-made full-screen scanner (`scan()`), so the webview
 *           never holds a camera stream. Dynamically imported: the web bundle
 *           does not carry it.
 *
 * WHICH PATH: native when isNative() AND the plugin is linked into this build
 * (hasNativePlugin('BarcodeScanner')). The plugin is linked on both platforms
 * (iOS through CocoaPods, Android through Gradle). hasNativePlugin() remains
 * the guard for a build where it was removed: this module then reports the web
 * path (inside WKWebView there is no BarcodeDetector, so the scanner view shows
 * its "no built-in reader" note and the USB scanner and typed SKU inputs
 * remain). The iOS path is untested on a device. See docs/mobile/00-capacitor.md.
 *
 * NATIVE FLOW (scanBarcodes):
 *   Android  scan() runs in the Google code scanner module from Play services,
 *            which needs NO camera permission but may not be installed yet.
 *            isGoogleBarcodeScannerModuleAvailable() is checked first; if it is
 *            missing, installGoogleBarcodeScannerModule() starts the download
 *            and we wait for the progress event to report COMPLETED (or FAILED,
 *            CANCELED, or the timeout), reporting progress to the caller.
 *   iOS      the camera permission is checked and requested before scan().
 *   Cancel   the user closing the scanner resolves { cancelled: true }.
 *
 * FORMATS use the web spelling everywhere ('code_128', 'qr_code', 'ean_13').
 * ML Kit's names are the same words upper-cased, which is how they are mapped.
 */
import type { PluginListenerHandle } from '@capacitor/core';
import type { BarcodeScannerPlugin, BarcodeFormat } from '@capacitor-mlkit/barcode-scanning';
import { hasNativePlugin } from './nativePlugin';
import { platform } from '../platform';

export interface ScannedBarcode {
  rawValue: string;
  /** Web spelling, lower case: 'code_128', 'qr_code', ... */
  format: string;
}

export interface ScanBarcodesOptions {
  /** Formats to look for, web spelling. Default ['code_128'] (our labels). */
  formats?: string[];
  /** Web only: the frame to decode (usually a playing <video>). Required on the web. */
  source?: CanvasImageSource;
  /** Native Android only: download progress of the Google scanner module, 0-100 when known. */
  onModuleInstallProgress?: (progress: number | undefined) => void;
}

export interface ScanBarcodesResult {
  barcodes: ScannedBarcode[];
  /** Native only: the user closed the scanner without reading anything. */
  cancelled: boolean;
}

export type BarcodeScanErrorCode =
  | 'unsupported'           // no reader on this device or browser
  | 'permission-denied'     // camera permission refused
  | 'module-install-failed' // Android could not install the Google scanner module
  | 'failed';               // anything else

export class BarcodeScanError extends Error {
  readonly code: BarcodeScanErrorCode;
  constructor(code: BarcodeScanErrorCode, message: string) {
    super(message);
    this.name = 'BarcodeScanError';
    this.code = code;
  }
}

const PLUGIN_NAME = 'BarcodeScanner';
const DEFAULT_FORMATS = ['code_128'];
/** How long to wait for the Android scanner module download before giving up. */
export const MODULE_INSTALL_TIMEOUT_MS = 120_000;

// ── Web path ────────────────────────────────────────────────────────────────

/** The subset of the BarcodeDetector API used. It is not in lib.dom yet. */
export interface BarcodeDetectorLike { detect(source: CanvasImageSource): Promise<ScannedBarcode[]> }
export type BarcodeDetectorCtor = new (opts?: { formats?: string[] }) => BarcodeDetectorLike;

export function getBarcodeDetectorCtor(): BarcodeDetectorCtor | null {
  if (typeof window === 'undefined') return null;
  const ctor = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
  return typeof ctor === 'function' ? ctor : null;
}

/** Detectors are cheap to keep and not free to build; one per format set. */
const detectorCache = new Map<string, BarcodeDetectorLike>();
function webDetector(formats: string[]): BarcodeDetectorLike {
  const Ctor = getBarcodeDetectorCtor();
  if (!Ctor) throw new BarcodeScanError('unsupported', 'This browser has no built-in barcode reader.');
  const key = formats.join(',');
  let d = detectorCache.get(key);
  if (!d) {
    d = new Ctor({ formats });
    detectorCache.set(key, d);
  }
  return d;
}

async function scanWeb(options: ScanBarcodesOptions): Promise<ScanBarcodesResult> {
  if (!options.source) {
    throw new BarcodeScanError('unsupported', 'A camera frame is needed to scan in the browser.');
  }
  const detector = webDetector(options.formats ?? DEFAULT_FORMATS);
  const codes = await detector.detect(options.source);
  return {
    barcodes: codes
      .map(c => ({ rawValue: (c.rawValue ?? '').trim(), format: String(c.format ?? '').toLowerCase() }))
      .filter(c => c.rawValue !== ''),
    cancelled: false,
  };
}

// ── Native path ─────────────────────────────────────────────────────────────

let pluginPromise: Promise<BarcodeScannerPlugin> | null = null;
function loadPlugin(): Promise<BarcodeScannerPlugin> {
  return (pluginPromise ??= import('@capacitor-mlkit/barcode-scanning').then(m => m.BarcodeScanner));
}

/** GoogleBarcodeScannerModuleInstallState values (plugin enum, not imported to keep it type-only). */
const INSTALL_CANCELED = 3;
const INSTALL_COMPLETED = 4;
const INSTALL_FAILED = 5;

async function ensureAndroidModule(plugin: BarcodeScannerPlugin, onProgress?: (p: number | undefined) => void) {
  const { available } = await plugin.isGoogleBarcodeScannerModuleAvailable();
  if (available) return;

  let handle: PluginListenerHandle | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  // Set once the wait is over. A listener handle that only arrives after that
  // (the timeout fired before addListener resolved) is removed on arrival
  // instead of being assigned after `finally` has already run.
  let done = false;
  try {
    await new Promise<void>((resolve, reject) => {
      const fail = () => reject(new BarcodeScanError(
        'module-install-failed',
        'The barcode scanner could not be installed. Check your connection and try again.',
      ));
      timer = setTimeout(fail, MODULE_INSTALL_TIMEOUT_MS);
      plugin.addListener('googleBarcodeScannerModuleInstallProgress', (event) => {
        if (done) return;
        onProgress?.(event.progress);
        if (event.state === INSTALL_COMPLETED) resolve();
        else if (event.state === INSTALL_FAILED || event.state === INSTALL_CANCELED) fail();
      }).then((h) => {
        if (done) {
          void h.remove().catch(() => undefined);
          return;
        }
        handle = h;
        onProgress?.(undefined);
        return plugin.installGoogleBarcodeScannerModule();
      }).catch(fail);
    });
  } finally {
    done = true;
    if (timer) clearTimeout(timer);
    await (handle as PluginListenerHandle | null)?.remove().catch(() => undefined);
  }
}

async function ensureCameraPermission(plugin: BarcodeScannerPlugin) {
  let { camera } = await plugin.checkPermissions();
  if (camera !== 'granted' && camera !== 'limited') {
    ({ camera } = await plugin.requestPermissions());
  }
  if (camera !== 'granted' && camera !== 'limited') {
    throw new BarcodeScanError(
      'permission-denied',
      'Camera permission was denied. Allow it in Settings, or use a USB scanner or type the SKU.',
    );
  }
}

function isCancel(err: unknown): boolean {
  const msg = String((err as { message?: string })?.message ?? err ?? '');
  return /cancel/i.test(msg);
}

async function scanNative(options: ScanBarcodesOptions): Promise<ScanBarcodesResult> {
  const plugin = await loadPlugin();
  const { supported } = await plugin.isSupported().catch(() => ({ supported: false }));
  if (!supported) throw new BarcodeScanError('unsupported', 'This device has no camera that can scan barcodes.');

  // Android's scan() needs the Play services module and no permission; iOS's
  // needs the permission. Asking Android users for a permission scan() does not
  // use would be a prompt for nothing.
  if (platform() === 'android') await ensureAndroidModule(plugin, options.onModuleInstallProgress);
  else await ensureCameraPermission(plugin);

  const formats = (options.formats ?? DEFAULT_FORMATS).map(f => f.toUpperCase() as BarcodeFormat);
  try {
    const { barcodes } = await plugin.scan({ formats });
    const out = (barcodes ?? [])
      .map(b => ({ rawValue: (b.rawValue ?? '').trim(), format: String(b.format ?? '').toLowerCase() }))
      .filter(b => b.rawValue !== '');
    return { barcodes: out, cancelled: out.length === 0 };
  } catch (err) {
    if (isCancel(err)) return { barcodes: [], cancelled: true };
    throw new BarcodeScanError('failed', (err as Error)?.message || 'The barcode scan failed.');
  }
}

// ── Public entry points ─────────────────────────────────────────────────────

/** Synchronous: will scanBarcodes() use the native full-screen scanner here? */
export function usesNativeBarcodeScanner(): boolean {
  return hasNativePlugin(PLUGIN_NAME);
}

/** True when a camera scan can work here. Never rejects. */
export async function isBarcodeScanAvailable(): Promise<boolean> {
  if (usesNativeBarcodeScanner()) {
    try {
      const plugin = await loadPlugin();
      return (await plugin.isSupported()).supported;
    } catch {
      return false;
    }
  }
  return getBarcodeDetectorCtor() !== null;
}

/**
 * Read barcodes. Native: opens the full-screen scanner and resolves when the
 * user scans or closes it. Web: decodes `options.source` once (call it per
 * sampled frame). Rejects with BarcodeScanError.
 */
export async function scanBarcodes(options: ScanBarcodesOptions = {}): Promise<ScanBarcodesResult> {
  return usesNativeBarcodeScanner() ? scanNative(options) : scanWeb(options);
}

/** Test hook: forget the cached dynamic import and detectors. */
export function __resetBarcodePluginForTests(): void {
  pluginPromise = null;
  detectorCache.clear();
}
