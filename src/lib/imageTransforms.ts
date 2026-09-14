import type { ClothingItem } from '../App';
import { log, isDebugEnabled } from './debugLogger';

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

/** Test hook — empties the cache and resets the byte total. */
export function __resetImgCacheForTests(): void {
  _imgCache.clear();
  _imgCacheBytes = 0;
}

/** Test hook — the exact read path production uses (recency-refreshing), so the
 *  LRU can be exercised without a DOM image decoder. */
export function __readCachedImageForTests(url: string): HTMLImageElement | undefined {
  return touchCachedImage(url);
}

/** Test hook — the byte budget, so tests never hardcode it. */
export const __IMG_CACHE_MAX_BYTES_FOR_TESTS = IMG_CACHE_MAX_BYTES;
// ─────────────────────────────────────────────────────────────────────────────

/** Load an HTMLImageElement from a URL, retrying on transient network/TLS errors. */
const loadImageWithRetry = (src: string): Promise<HTMLImageElement> => {
  // Return the cached element immediately — avoids any network round-trip.
  const cached = touchCachedImage(src);
  if (cached) {
    if (isDebugEnabled()) log.img(`[imgCache] ✅ HIT — no network fetch needed for ${src.split('/').pop()}`);
    return Promise.resolve(cached);
  }

  if (isDebugEnabled()) log.img(`[imgCache] ⬇️  MISS — fetching from network: ${src.split('/').pop() ?? src}`);

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
      // Cache-bust on retries so the browser doesn't replay a corrupted cached response
      img.src = attempt === 0 ? src : `${src}${src.includes('?') ? '&' : '?'}_retry=${attempt}`;
    };

    tryLoad();
  });
};

/**
 * Create a transformed File (JPEG) applying rotation and crop from ClothingItem.
 * crop: percent values { x,y,w,h } relative to image.
 * Retries up to LOAD_RETRIES times on transient network/TLS failures.
 */
export const createTransformedFile = async (item: ClothingItem): Promise<File | null> => {
  const src = item.preview || item.imageUrls?.[0] || '';
  if (isDebugEnabled()) log.img(`[transform] 🖼️  createTransformedFile — item: ${item.id} src: ${src ? src.split('/').pop() : '⚠️ MISSING'}`);
  if (!src) {
    console.error('[transform] ❌ No src URL on item — cannot transform:', item.id);
    return null;
  }

  let img: HTMLImageElement;
  try {
    img = await loadImageWithRetry(src);
    log.img(`[transform] ✅ Image ready for canvas: ${item.id} ${img.naturalWidth}×${img.naturalHeight}`);
  } catch (err) {
    console.error('[transform] ❌ Image load failed after retries — item:', item.id, err);
    console.warn('[transform] ⚠️  EXPECTED: image should load from cache or CDN. MISSING: check CORS headers on Supabase bucket and whether the URL is still valid.');
    return null;
  }

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
      const cos = Math.abs(Math.cos(radians));
      const sin = Math.abs(Math.sin(radians));
      const rotW = Math.round(srcW * cos + srcH * sin);
      const rotH = Math.round(srcW * sin + srcH * cos);

      const rotCanvas = document.createElement('canvas');
      rotCanvas.width  = rotW;
      rotCanvas.height = rotH;
      const rotCtx = rotCanvas.getContext('2d');
      if (!rotCtx) { console.error('[transform] ❌ Could not get 2D canvas context'); return resolve(null); }
      rotCtx.translate(rotW / 2, rotH / 2);
      rotCtx.rotate(radians);
      rotCtx.drawImage(img, -srcW / 2, -srcH / 2, srcW, srcH);

      // ── Step 2: crop from the rotated canvas ─────────────────────────────
      const sx = crop ? Math.round((crop.x / 100) * rotW) : 0;
      const sy = crop ? Math.round((crop.y / 100) * rotH) : 0;
      const sW = crop ? Math.round((crop.w / 100) * rotW) : rotW;
      const sH = crop ? Math.round((crop.h / 100) * rotH) : rotH;

      log.img(`[transform] 🖼️  Rotated canvas: ${rotW}×${rotH} → crop rect: ${sW}×${sH} px`);

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
