import type { ClothingItem } from '../App';
import { log, isDebugEnabled } from './debugLogger';
import { IMAGE_CACHE_NAME } from './swCache';

const LOAD_RETRIES = 3;
const RETRY_DELAY_MS = 500;

// ─── Session image cache (byte-budgeted LRU) ─────────────────────────────────
// Keeps loaded HTMLImageElements in memory for the lifetime of the browser tab.
// This eliminates re-fetches from Supabase CDN when paste-crop is applied to
// hundreds/thousands of images on a slow connection — the canvas transform
// works entirely from this in-memory copy.
// Keys are the original image URL (before any cache-busting suffix).
//
// MEMORY REALITY (the old comment here claimed the footprint was "manageable" —
// it was factually wrong): a decoded HTMLImageElement holds an UNCOMPRESSED
// RGBA bitmap in the renderer process, i.e. naturalWidth * naturalHeight * 4
// bytes — not the raw JPEG bytes. At the app's COMPRESS_MAX_PX = 2000 that is
// 2000*2000*4 = 16 MB per square image (12 MB for a 4:3). An unbounded cache
// therefore needed ~24 GB for a 1,500-image paste-crop batch and OOM-crashed
// the tab at roughly 130–250 images (Chrome renderers die around 2–4 GB).
//
// So the cache is now an LRU bounded by a BYTE BUDGET, not an entry count —
// entry count is meaningless when one entry can be 16 MB. Eviction is purely a
// memory optimisation: every read path treats a miss as "re-fetch from the CDN",
// which is exactly what happens for a URL that was never cached, so no
// correctness (paste-crop included) depends on an entry still being resident.
const IMG_CACHE_MAX_BYTES = 512 * 1024 * 1024; // 512 MB
// Why 512 MB: ~32 images at 2000×2000 (16 MB) or ~42 at 2000×1500 (12 MB)
// resident at once — far more than the working set of a paste-crop pass, which
// touches images one at a time — while leaving the renderer several GB of
// headroom for the React tree, the two transient canvases createTransformedFile
// allocates per image (each up to w*h*4 again), the encoded blobs in flight and
// the Service Worker image cache.

// Used when naturalWidth/naturalHeight are 0/unknown (element not decoded yet,
// or a non-DOM stand-in). Deliberately conservative: over-charging an unknown
// entry evicts slightly early, under-charging it would let the budget drift.
const IMG_CACHE_UNKNOWN_BYTES = 4 * 1024 * 1024; // 4 MB

/** URLs whose bytes were replaced in place; each gets ONE cache-defeating
 *  load next time it is read. See invalidateImageUrl. */
const _forceFreshUrls = new Set<string>();

type ImgCacheEntry = { img: HTMLImageElement; bytes: number };

// Map iteration follows insertion order, which is what makes this an LRU:
// the FIRST key is the least-recently-used and reads re-insert their key at the
// most-recently-used end (see touchCachedImage).
const _imgCache = new Map<string, ImgCacheEntry>();
let _imgCacheBytes = 0;

/** Estimated resident cost of a decoded image: RGBA, 4 bytes per pixel. */
function estimateImageBytes(img: HTMLImageElement): number {
  const w = img.naturalWidth || 0;
  const h = img.naturalHeight || 0;
  if (w <= 0 || h <= 0) return IMG_CACHE_UNKNOWN_BYTES;
  return w * h * 4;
}

/** Read + refresh recency. Returns undefined on a miss (caller re-fetches). */
function touchCachedImage(url: string): HTMLImageElement | undefined {
  const entry = _imgCache.get(url);
  if (!entry) return undefined;
  // delete + re-set moves the key to the most-recently-used end of the Map.
  _imgCache.delete(url);
  _imgCache.set(url, entry);
  return entry.img;
}

/** Expose for cache-warming from upload flow (optional future use). */
export function cacheImage(url: string, img: HTMLImageElement) {
  // Drop any existing entry for this key FIRST so re-inserting the same URL
  // (a retry, a second concurrent load, an explicit warm) can never
  // double-count its bytes.
  const existing = _imgCache.get(url);
  if (existing) {
    _imgCache.delete(url);
    _imgCacheBytes -= existing.bytes;
  }

  const bytes = estimateImageBytes(img);
  // A single image bigger than the whole budget is simply not cached: emptying
  // the cache still would not make it fit, and the evict loop must never spin.
  // The caller already holds the element — it just won't be there next time.
  if (bytes > IMG_CACHE_MAX_BYTES) return;

  while (_imgCacheBytes + bytes > IMG_CACHE_MAX_BYTES && _imgCache.size > 0) {
    const oldestKey: string | undefined = _imgCache.keys().next().value;
    if (oldestKey === undefined) break;
    const oldest = _imgCache.get(oldestKey);
    _imgCache.delete(oldestKey);
    if (oldest) _imgCacheBytes -= oldest.bytes;
  }

  _imgCache.set(url, { img, bytes });
  _imgCacheBytes += bytes;
}

/** Remove a cached entry when the underlying storage path changes (e.g. after re-crop). */
export function evictCachedImage(url: string) {
  const entry = _imgCache.get(url);
  if (!entry) return;
  _imgCache.delete(url);
  _imgCacheBytes -= entry.bytes;
}

/** Test hook — current LRU occupancy. */
export function __imgCacheStatsForTests(): { entries: number; bytes: number } {
  return { entries: _imgCache.size, bytes: _imgCacheBytes };
}

/** Test hook — empties the cache, the byte total, and the forced-refetch marks. */
export function __resetImgCacheForTests(): void {
  _imgCache.clear();
  _imgCacheBytes = 0;
  _forceFreshUrls.clear();
}

/** Test hook — the exact read path production uses (recency-refreshing), so the
 *  LRU can be exercised without a DOM image decoder. */
export function __readCachedImageForTests(url: string): HTMLImageElement | undefined {
  return touchCachedImage(url);
}

/** Test hook — the byte budget, so tests never hardcode it. */
export const __IMG_CACHE_MAX_BYTES_FOR_TESTS = IMG_CACHE_MAX_BYTES;
// ─────────────────────────────────────────────────────────────────────────────

// ─── Pure crop geometry ──────────────────────────────────────────────────────
// Everything below is pure arithmetic with no DOM dependency, so the rules that
// decide WHERE a crop lands are unit-testable. `createTransformedFile` is the
// only caller that turns the result into pixels.
//
// CROP REPRESENTATION (unchanged): `ClothingItem.crop` is `{x,y,w,h}` in
// PERCENT (0–100) of the frame the user drew on. The frame is the image AFTER
// `imageRotation` is applied — the crop modal renders the <img> with a CSS
// `rotate()` and measures it with getBoundingClientRect(), which returns the
// rotated (axis-aligned) box — so the canvas must rotate first and crop second.
//
// EXIF: the browser applies EXIF orientation on decode (`image-orientation:
// from-image` is the initial value for <img> in every modern engine), and
// naturalWidth/naturalHeight report the ORIENTED size. drawImage paints that
// same oriented bitmap. So both the modal and the canvas see one consistent
// frame and no manual EXIF handling is needed or wanted here.

export interface CropPercent { x: number; y: number; w: number; h: number }
export interface SourceSize { width: number; height: number }
export interface CropRect { sx: number; sy: number; sw: number; sh: number }

const isNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/** Axis-aligned bounding box of `srcW × srcH` rotated by `rot` degrees. */
export function rotatedSize(srcW: number, srcH: number, rot: number): SourceSize {
  if (!isNum(srcW) || !isNum(srcH) || srcW <= 0 || srcH <= 0) return { width: 0, height: 0 };
  const radians = ((isNum(rot) ? rot : 0) % 360 * Math.PI) / 180;
  const cos = Math.abs(Math.cos(radians));
  const sin = Math.abs(Math.sin(radians));
  return {
    width:  Math.round(srcW * cos + srcH * sin),
    height: Math.round(srcW * sin + srcH * cos),
  };
}

export interface CropRectOptions {
  /**
   * width/height of the frame the crop percentages were DRAWN on, when that is
   * a DIFFERENT image from the one being cropped (a bulk paste).
   *
   * Percent-of-frame is the historical mapping and is correct as long as source
   * and target share an aspect ratio — which is why a paste across one camera
   * roll is ~99 % right. Pasted onto an image of a different aspect (a landscape
   * frame in a portrait shoot, or an item that was already cropped once so its
   * frame is now the crop's shape) the same percentages describe a DIFFERENT
   * SHAPE, which is what "1–3 are cropped weird" looks like.
   *
   * When this is supplied and differs from the target aspect, the drawn SHAPE is
   * preserved instead of the raw percentages. When it matches — or is absent —
   * the arithmetic below is the original code, unchanged, down to the rounding.
   */
  sourceAspect?: number | null;
}

/** Relative tolerance for "these two frames are the same shape". */
const ASPECT_EPSILON = 1e-3;

/**
 * Clamp a pixel rect into `W × H`, SLIDING rather than shrinking where it can.
 * A rect is never allowed to be empty or to run past the source: `drawImage`
 * silently pads out-of-bounds source rects with transparent pixels, which JPEG
 * then encodes as a black edge.
 */
function clampRect(sx: number, sy: number, sw: number, sh: number, W: number, H: number): CropRect {
  const cw = Math.min(Math.max(1, sw), W);
  const ch = Math.min(Math.max(1, sh), H);
  return {
    sx: Math.min(Math.max(0, sx), W - cw),
    sy: Math.min(Math.max(0, sy), H - ch),
    sw: cw,
    sh: ch,
  };
}

/**
 * Percent crop → integer source rect, total and clamped for every orientation,
 * aspect and degenerate input. No crop (or an unusable one) means the full frame.
 */
export function computeCropRect(
  source: SourceSize,
  crop?: CropPercent | null,
  opts: CropRectOptions = {},
): CropRect {
  const W = isNum(source?.width)  ? Math.floor(source.width)  : 0;
  const H = isNum(source?.height) ? Math.floor(source.height) : 0;
  if (W <= 0 || H <= 0) return { sx: 0, sy: 0, sw: 0, sh: 0 };

  const full: CropRect = { sx: 0, sy: 0, sw: W, sh: H };
  if (!crop) return full;
  const { x, y, w, h } = crop;
  if (!isNum(x) || !isNum(y) || !isNum(w) || !isNum(h)) return full;
  if (w <= 0 || h <= 0) return full;

  // The historical percent-of-frame mapping, verbatim.
  let sx = Math.round((x / 100) * W);
  let sy = Math.round((y / 100) * H);
  let sw = Math.round((w / 100) * W);
  let sh = Math.round((h / 100) * H);

  const srcAspect = opts.sourceAspect;
  const targetAspect = W / H;
  if (isNum(srcAspect) && srcAspect > 0 && Math.abs(srcAspect - targetAspect) > ASPECT_EPSILON * targetAspect) {
    // Shape of the drawn rect, expressed as an aspect. Only the RATIO of the
    // source frame matters, so it normalises to height 1.
    const cropAspect = (w * srcAspect) / h;
    // Two ways to land that shape on this frame: keep the vertical extent, or
    // keep the horizontal one. When the aspects match these are algebraically
    // the SAME rect as the percent mapping above, which is what makes this
    // branch a no-op for the images that already paste correctly.
    const byHeight = { sw: ((h / 100) * H) * cropAspect, sh: (h / 100) * H };
    const byWidth  = { sw: (w / 100) * W, sh: ((w / 100) * W) / cropAspect };
    const fits = (r: { sw: number; sh: number }) => r.sw <= W + 1e-6 && r.sh <= H + 1e-6;
    let pick: { sw: number; sh: number };
    if (fits(byHeight) && fits(byWidth)) {
      // Both land inside the frame — keep the larger, i.e. lose as little of the
      // photo as the shape allows.
      pick = byHeight.sw * byHeight.sh >= byWidth.sw * byWidth.sh ? byHeight : byWidth;
    } else if (fits(byHeight)) {
      pick = byHeight;
    } else if (fits(byWidth)) {
      pick = byWidth;
    } else {
      const s = Math.min(W / byHeight.sw, H / byHeight.sh);
      pick = { sw: byHeight.sw * s, sh: byHeight.sh * s };
    }
    // Anchor on the crop's relative centre; clampRect slides it fully into frame.
    const cx = ((x + w / 2) / 100) * W;
    const cy = ((y + h / 2) / 100) * H;
    sw = Math.round(pick.sw);
    sh = Math.round(pick.sh);
    sx = Math.round(cx - pick.sw / 2);
    sy = Math.round(cy - pick.sh / 2);
  }

  return clampRect(sx, sy, sw, sh, W, H);
}

/**
 * Serialises async work per key. Every task for a key runs strictly after the
 * previous one for that key has settled; different keys stay parallel.
 *
 * Two transforms overlapping on ONE image is the failure this exists for: both
 * read the same pre-crop item, both upload (to different timestamped paths),
 * both write a product_images row, and each deletes what it believes is the
 * "previous crop" — which can be the other's freshly-uploaded file, leaving a
 * row pointing at a deleted object. Reachable from a double-clicked Paste, the
 * Retry button firing while the first pass drains, and a group card and the
 * photo toolbar naming the same photo.
 *
 * The stored tail never rejects, so one failure cannot poison later work for
 * that key, while the promise returned to each caller still rejects so a batch
 * can count it as failed.
 */
export function createTransformQueue() {
  const tails = new Map<string, Promise<void>>();
  return {
    run(key: string, task: () => Promise<void>): Promise<void> {
      const prev = tails.get(key) ?? Promise.resolve();
      const next = prev.then(task);
      const tail = next.then(() => {}, () => {});
      tails.set(key, tail);
      void tail.then(() => { if (tails.get(key) === tail) tails.delete(key); });
      return next;
    },
    /** Number of keys with work still queued — for tests and diagnostics. */
    get pending() { return tails.size; },
  };
}

/** Which stored file a transform should read its pixels from. */
export type TransformSourceMode = 'current' | 'original';

export interface ResolvedTransformSource { url: string; fromOriginal: boolean }

/**
 * `'current'` — the file the item currently shows. This is what an INTERACTIVE
 * crop must use: the modal displayed that file, so the percentages are relative
 * to it.
 *
 * `'original'` — the pre-crop file cached by the first crop. This is what a BULK
 * PASTE must use: the pasted percentages describe a full frame, so re-applying
 * them to an already-cropped file crops the crop (each paste zooming further in)
 * and leaves the previously-cropped items framed differently from every other
 * item in the batch. Falls back to the current file when no original is cached.
 */
export function resolveTransformSource(
  item: { preview?: string; imageUrls?: string[]; originalUrl?: string },
  mode: TransformSourceMode = 'current',
): ResolvedTransformSource {
  if (mode === 'original' && item.originalUrl) return { url: item.originalUrl, fromOriginal: true };
  return { url: item.preview || item.imageUrls?.[0] || '', fromOriginal: false };
}

// ─── Deterministic invalidation for IN-PLACE overwrites ──────────────────────
// public/sw.js states its correctness assumption out loud: "Product images are
// immutable per storage_path (a re-crop writes a NEW path)". ImageGrouper honours
// that — it uploads every crop to a fresh `cropped-<ts>` path. PDG's crop path
// does NOT: it re-uploads over the SAME storage path, so the public URL is
// unchanged while its bytes are not, and three layers can then serve the
// pre-crop image: this module's LRU, the Service Worker's 7-day entry, and the
// HTTP cache (Supabase uploads with `cacheControl: '3600'`).
//
// A second paste then re-crops the ORIGINAL for whichever items are still being
// served stale, and the freshly-cropped file for the rest — per-item
// nondeterminism, i.e. a handful of differently-framed images in a batch that is
// otherwise uniform.
//
// URLs marked here get ONE cache-defeating load next time they are read. The
// suffix is deliberately NOT one of the params sw.js strips (`t`, `_retry`), so
// it misses at every layer; the decoded element is then cached under the CLEAN
// url, and the mark is cleared, so only the first read after an overwrite pays.

/** Test hook — URLs still awaiting their one forced re-fetch. */
export function __forceFreshCountForTests(): number {
  return _forceFreshUrls.size;
}

/**
 * Drop every cached copy of `url` after its bytes were replaced in place.
 * Never throws: invalidation is best-effort everywhere except the LRU, and a
 * missing Cache Storage (private mode, no SW) must not fail a crop.
 */
export async function invalidateImageUrl(url: string): Promise<void> {
  if (!url) return;
  evictCachedImage(url);
  _forceFreshUrls.add(url);
  try {
    if (typeof caches === 'undefined') return;
    const cache = await caches.open(IMAGE_CACHE_NAME);
    await cache.delete(url);
  } catch {
    // Cache Storage unavailable or blocked — the _forceFreshUrls mark above
    // still guarantees the next read bypasses it.
  }
}

/** Load an HTMLImageElement from a URL, retrying on transient network/TLS errors. */
const loadImageWithRetry = (src: string): Promise<HTMLImageElement> => {
  // Return the cached element immediately — avoids any network round-trip.
  const cached = touchCachedImage(src);
  if (cached) {
    // A cached element must be fully DECODED before it may reach drawImage.
    // `cacheImage` is exported for warming and the entry can also have been
    // invalidated by the browser, so residency alone is not proof of a usable
    // bitmap — drawing a half-loaded element paints a blank frame, which on a
    // paste-crop batch shows up as a handful of ruined images among hundreds of
    // correct ones. An unusable entry is dropped and re-fetched, which is
    // exactly the never-cached path.
    if (cached.complete && cached.naturalWidth > 0 && cached.naturalHeight > 0) {
      if (isDebugEnabled()) log.img(`[imgCache] ✅ HIT — no network fetch needed for ${src.split('/').pop()}`);
      return Promise.resolve(cached);
    }
    if (isDebugEnabled()) log.img(`[imgCache] ♻️  STALE ENTRY — cached element not decoded, re-fetching: ${src.split('/').pop()}`);
    evictCachedImage(src);
  }

  if (isDebugEnabled()) log.img(`[imgCache] ⬇️  MISS — fetching from network: ${src.split('/').pop() ?? src}`);

  // Consume the one-shot mark: the load below bypasses every cache, and the
  // decoded result is cached under the clean `src`, so later reads are normal.
  const forceFresh = _forceFreshUrls.delete(src);
  if (forceFresh && isDebugEnabled()) log.img(`[imgCache] 🔄 FORCED FRESH — bytes were replaced in place: ${src.split('/').pop()}`);

  return new Promise((resolve, reject) => {
    let attempt = 0;

    const tryLoad = () => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        cacheImage(src, img); // store for future paste-crop calls (may evict LRU entries)
        if (isDebugEnabled()) log.img(`[imgCache] 📥 Cached after load: ${src.split('/').pop()} (cache: ${_imgCache.size} imgs, ${(_imgCacheBytes / 1048576).toFixed(0)} MB)`);
        resolve(img);
      };
      img.onerror = () => {
        attempt += 1;
        if (attempt < LOAD_RETRIES) {
          console.warn(`[imgCache] ⚠️  Load attempt ${attempt} failed, retrying in ${RETRY_DELAY_MS}ms:`, src.split('/').pop());
          setTimeout(tryLoad, RETRY_DELAY_MS);
        } else {
          console.error(`[imgCache] ❌ All ${LOAD_RETRIES} load attempts failed:`, src);
          reject(new Error(`Failed to load image after ${LOAD_RETRIES} attempts: ${src}`));
        }
      };
      // Cache-bust on retries so the browser doesn't replay a corrupted cached
      // response, and on the first read after an in-place overwrite so no layer
      // can hand back the pre-crop bytes (see invalidateImageUrl).
      const sep = src.includes('?') ? '&' : '?';
      img.src = attempt > 0
        ? `${src}${sep}_retry=${attempt}`
        : forceFresh
          ? `${src}${sep}_fresh=${Date.now()}`
          : src;
    };

    tryLoad();
  });
};

/**
 * Natural frame aspect (width/height) of `url` AFTER `rot` degrees, or null when
 * it cannot be determined. Used to record what shape a copied crop was drawn on
 * so a paste onto a differently-shaped image can preserve that shape. Side
 * benefit: it warms the session cache with the very image a paste will read.
 */
export async function getSourceFrameAspect(url: string, rot = 0): Promise<number | null> {
  if (!url) return null;
  try {
    const img = await loadImageWithRetry(url);
    const { width, height } = rotatedSize(img.naturalWidth, img.naturalHeight, rot);
    return width > 0 && height > 0 ? width / height : null;
  } catch {
    return null;
  }
}

export interface TransformOptions {
  /** Which stored file supplies the pixels. See `resolveTransformSource`. */
  sourceMode?: TransformSourceMode;
  /** Aspect of the frame `item.crop` was drawn on, when that was another image. */
  cropSourceAspect?: number | null;
}

/**
 * Create a transformed File (JPEG) applying rotation and crop from ClothingItem.
 * crop: percent values { x,y,w,h } relative to the ROTATED frame (see the
 * geometry notes above). Retries up to LOAD_RETRIES times on transient failures.
 *
 * Defaults reproduce the historical behaviour exactly: pixels come from the
 * item's current file and the crop is mapped percent-of-frame.
 */
export const createTransformedFile = async (
  item: ClothingItem,
  opts: TransformOptions = {},
): Promise<File | null> => {
  const { url: src, fromOriginal } = resolveTransformSource(item, opts.sourceMode ?? 'current');
  if (isDebugEnabled()) log.img(`[transform] 🖼️  createTransformedFile — item: ${item.id} src: ${src ? src.split('/').pop() : '⚠️ MISSING'}${fromOriginal ? ' (from cached ORIGINAL — un-compounding a repeat crop)' : ''}`);
  if (!src) {
    console.error('[transform] ❌ No src URL on item — cannot transform:', item.id);
    return null;
  }

  let img: HTMLImageElement;
  try {
    img = await loadImageWithRetry(src);
  } catch (err) {
    console.error('[transform] ❌ Image load failed after retries — item:', item.id, err);
    console.warn('[transform] ⚠️  EXPECTED: image should load from cache or CDN. MISSING: check CORS headers on Supabase bucket and whether the URL is still valid.');
    return null;
  }

  // `onload` guarantees the bytes arrived, not that the bitmap is decoded.
  // drawImage would force a synchronous decode anyway, but an element that
  // FAILED to decode silently paints nothing — so decode explicitly and verify
  // the dimensions before committing to a canvas.
  if (typeof img.decode === 'function') {
    try { await img.decode(); } catch { /* some engines reject for an already-decoded element; the size check below is the real gate */ }
  }
  if (!img.naturalWidth || !img.naturalHeight) {
    console.error('[transform] ❌ Image decoded to a zero-size bitmap — refusing to crop:', item.id, src);
    return null;
  }
  log.img(`[transform] ✅ Image ready for canvas: ${item.id} ${img.naturalWidth}×${img.naturalHeight}`);

  return new Promise((resolve) => {
    try {
      const rot = (item.imageRotation || 0) % 360;
      const crop = item.crop;

      const srcW = img.naturalWidth;
      const srcH = img.naturalHeight;

      if (isDebugEnabled()) {
        log.img(`[transform] ✂️  Canvas params — rotation: ${rot} crop region: ${crop
          ? `x=${crop.x.toFixed(1)}% y=${crop.y.toFixed(1)}% w=${crop.w.toFixed(1)}% h=${crop.h.toFixed(1)}%`
          : 'none (full frame)'}`);
      }

      // ── Step 1: rotate the full image onto an intermediate canvas ─────────
      // The crop modal shows the image with CSS rotate(), so crop percentages
      // are drawn relative to the VISUALLY ROTATED image.  We must apply the
      // rotation first so that crop x/y/w/h map to the correct pixels.
      const radians = (rot * Math.PI) / 180;
      const { width: rotW, height: rotH } = rotatedSize(srcW, srcH, rot);
      if (rotW <= 0 || rotH <= 0) {
        console.error('[transform] ❌ Degenerate rotated frame — refusing to crop:', item.id);
        return resolve(null);
      }

      const rotCanvas = document.createElement('canvas');
      rotCanvas.width  = rotW;
      rotCanvas.height = rotH;
      const rotCtx = rotCanvas.getContext('2d');
      if (!rotCtx) { console.error('[transform] ❌ Could not get 2D canvas context'); return resolve(null); }
      rotCtx.translate(rotW / 2, rotH / 2);
      rotCtx.rotate(radians);
      rotCtx.drawImage(img, -srcW / 2, -srcH / 2, srcW, srcH);

      // ── Step 2: crop from the rotated canvas ─────────────────────────────
      const { sx, sy, sw: sW, sh: sH } = computeCropRect(
        { width: rotW, height: rotH },
        crop,
        { sourceAspect: opts.cropSourceAspect },
      );

      log.img(`[transform] 🖼️  Rotated canvas: ${rotW}×${rotH} → crop rect: ${sW}×${sH} px @ ${sx},${sy}`);

      const canvas = document.createElement('canvas');
      canvas.width  = sW;
      canvas.height = sH;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        console.error('[transform] ❌ Could not get 2D canvas context — browser issue?');
        return resolve(null);
      }

      ctx.drawImage(rotCanvas, sx, sy, sW, sH, 0, 0, sW, sH);

      canvas.toBlob((blob) => {
        if (!blob) {
          console.error('[transform] ❌ canvas.toBlob returned null — memory issue?');
          return resolve(null);
        }
        const file = new File([blob], `${item.id}-transformed.jpg`, { type: blob.type });
        if (isDebugEnabled()) {
          log.img(`[transform] 🗜️  Blob ready: ${item.id} ${(blob.size / 1024).toFixed(0)} KB (canvas: ${sW}×${sH}px)`);
          log.img('[transform] ⏭️  NEXT: this blob will be uploaded to Supabase Storage as a new cropped file, then the DB row updated.');
        }
        resolve(file);
      }, 'image/jpeg', 0.92);
    } catch (err) {
      console.error('[transform] ❌ Unexpected canvas error for item:', item.id, err);
      resolve(null);
    }
  });
};
