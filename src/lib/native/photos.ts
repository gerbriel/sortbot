/**
 * photos.ts: pick or shoot item photos with the native camera plugin, as Files.
 *
 * ON THE WEB both functions resolve to null without touching any plugin. null
 * means "no native picker here, use the existing <input type=file>", so a
 * caller (ImageUpload) keeps its web path as the default branch:
 *
 *   const files = await pickPhotos({ limit: 0 });
 *   if (files === null) inputRef.current?.click();   // web: unchanged
 *   else if (files.length) handleFiles(files);        // native; [] means the user cancelled
 *
 * ON NATIVE (isNative() and @capacitor/camera linked, which it is on both
 * platforms) they use the plugin's current API, `chooseFromGallery` and
 * `takePhoto` (8.1+). The older `pickImages` / `getPhoto` named in the task
 * still exist but are deprecated in @capacitor/camera 8.2 and lack the
 * creation date, so they are not used. The plugin is imported dynamically.
 *
 * WHAT THE FILE LOOKS LIKE:
 *   bytes         fetched from the result's webPath (or the converted file
 *                 uri), so it is the full image, not the base64 thumbnail.
 *   name          the original file name when the uri ends in one
 *                 (IMG_1234.JPG), else `photo-<capture time>-<n>.<ext>`.
 *   type          the blob's own type, else derived from the format.
 *   lastModified  the photo's CAPTURE time when known: EXIF DateTimeOriginal
 *                 from the plugin's metadata, else its creationDate, else now.
 *
 * EXIF: the app reads capture time with exifr and falls back to
 * file.lastModified (ImageUpload.getCaptureTime). The plugin re-encodes the
 * image (it applies orientation by default, correctOrientation: true), and on
 * some platforms that drops the EXIF block from the bytes. Setting
 * lastModified to the capture time is what keeps the sort-by-photo-date order
 * correct either way. Orientation is left to the plugin on purpose: the pixels
 * come back upright, so nothing downstream has to apply an EXIF rotation
 * (AGENTS.md §18 #34).
 */
import type { CameraPlugin, MediaResult } from '@capacitor/camera';
import { Capacitor } from '@capacitor/core';
import { hasNativePlugin } from './nativePlugin';

export interface PickPhotosOptions {
  /** Maximum number of photos. 0 or less means no limit (Android 13+ and iOS honor it). */
  limit?: number;
}

const PLUGIN_NAME = 'Camera';

let pluginPromise: Promise<CameraPlugin> | null = null;
function loadPlugin(): Promise<CameraPlugin> {
  return (pluginPromise ??= import('@capacitor/camera').then(m => m.Camera));
}

/** True when pickPhotos/takePhoto will use the native plugin (sync). */
export function nativePhotosAvailable(): boolean {
  return hasNativePlugin(PLUGIN_NAME);
}

/** Cancels resolve quietly; the plugin reports them as errors. */
function isCancel(err: unknown): boolean {
  const e = err as { code?: string; message?: string };
  // OS-PLUG-CAMR-0006 TakePhotoCancelled, -0013 EditPhotoCancelled, -0020 ChooseMediaCancelled
  if (e?.code === 'OS-PLUG-CAMR-0006' || e?.code === 'OS-PLUG-CAMR-0013' || e?.code === 'OS-PLUG-CAMR-0020') return true;
  return /cancel/i.test(String(e?.message ?? ''));
}

const MIME_BY_FORMAT: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
  webp: 'image/webp', heic: 'image/heic', heif: 'image/heif',
};
const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif',
  'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heif',
};

/** EXIF "YYYY:MM:DD HH:MM:SS" (local time, as cameras write it) to ms. */
export function parseExifDate(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const m = /^(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(value.trim());
  if (!m) return null;
  const t = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
  return Number.isFinite(t) ? t : null;
}

/** The plugin's metadata.exif is a string (JSON on both platforms); tolerate an object too. */
function exifCaptureTime(exif: unknown): number | null {
  let obj: unknown = exif;
  if (typeof exif === 'string') {
    try { obj = JSON.parse(exif); } catch { return null; }
  }
  if (!obj || typeof obj !== 'object') return null;
  const o = obj as Record<string, unknown>;
  const nested = (o['{Exif}'] ?? o.Exif ?? o.exif) as Record<string, unknown> | undefined;
  return parseExifDate(o.DateTimeOriginal ?? nested?.DateTimeOriginal ?? o.DateTime);
}

function captureTime(r: MediaResult, fallback: number): number {
  const fromExif = exifCaptureTime(r.metadata?.exif);
  if (fromExif !== null) return fromExif;
  const created = r.metadata?.creationDate ? Date.parse(r.metadata.creationDate) : NaN;
  return Number.isFinite(created) ? created : fallback;
}

function originalName(uri: string | undefined): string | null {
  if (!uri) return null;
  const last = decodeURIComponent(uri.split(/[?#]/)[0].split('/').pop() ?? '');
  return /\.[a-z0-9]{2,5}$/i.test(last) ? last : null;
}

/** Turn one plugin result into a File. Exported for tests. */
export async function mediaResultToFile(r: MediaResult, index: number, now = Date.now()): Promise<File> {
  const src = r.webPath || (r.uri ? Capacitor.convertFileSrc(r.uri) : '');
  let blob: Blob;
  if (src) {
    const res = await fetch(src);
    if (!res.ok) throw new Error(`Could not read the photo (${res.status}).`);
    blob = await res.blob();
  } else if (r.thumbnail) {
    // Last resort: the base64 payload. On native it is a thumbnail, so it is
    // only used when the plugin gave no path at all.
    const bin = atob(r.thumbnail.replace(/^data:[^,]*,/, ''));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    blob = new Blob([bytes], { type: MIME_BY_FORMAT[(r.metadata?.format ?? 'jpeg').toLowerCase()] ?? 'image/jpeg' });
  } else {
    throw new Error('The camera returned no image.');
  }

  const format = (r.metadata?.format ?? '').toLowerCase();
  const type = blob.type || MIME_BY_FORMAT[format] || 'image/jpeg';
  const lastModified = captureTime(r, now);
  const name = originalName(r.uri) ?? originalName(r.webPath)
    ?? `photo-${lastModified}-${index + 1}.${EXT_BY_MIME[type] ?? (format || 'jpg')}`;
  return new File([blob], name, { type, lastModified });
}

/**
 * Pick photos from the library. null on the web (use the file input), [] when
 * the user cancels on native, else the chosen photos as Files.
 */
export async function pickPhotos(options: PickPhotosOptions = {}): Promise<File[] | null> {
  if (!nativePhotosAvailable()) return null;
  const Camera = await loadPlugin();
  try {
    const { results } = await Camera.chooseFromGallery({
      allowMultipleSelection: true,
      limit: options.limit ?? 0,
      includeMetadata: true,
      quality: 100,
    });
    const now = Date.now();
    return await Promise.all((results ?? []).map((r, i) => mediaResultToFile(r, i, now)));
  } catch (err) {
    if (isCancel(err)) return [];
    throw err;
  }
}

/**
 * Take one photo with the camera. null on the web (use the file input with
 * capture) and null when the user cancels on native; check
 * nativePhotosAvailable() first if the two must be told apart.
 */
export async function takePhoto(): Promise<File | null> {
  if (!nativePhotosAvailable()) return null;
  const Camera = await loadPlugin();
  try {
    const r = await Camera.takePhoto({ includeMetadata: true });
    return await mediaResultToFile(r, 0);
  } catch (err) {
    if (isCancel(err)) return null;
    throw err;
  }
}

/** Test hook: forget the cached dynamic import. */
export function __resetPhotosPluginForTests(): void {
  pluginPromise = null;
}
