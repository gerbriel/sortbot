import type { ClothingItem } from '../App';

const LOAD_RETRIES = 3;
const RETRY_DELAY_MS = 500;

// ─── Session image cache ──────────────────────────────────────────────────────
// Keeps loaded HTMLImageElements in memory for the lifetime of the browser tab.
// This eliminates re-fetches from Supabase CDN when paste-crop is applied to
// hundreds/thousands of images on a slow connection — the canvas transform
// works entirely from this in-memory copy.
// Keys are the original image URL (before any cache-busting suffix).
// The cache is intentionally not bounded: a user doing 1500 images needs them
// all available without eviction during a single paste-crop batch. Each decoded
// HTMLImageElement is a reference to GPU-decoded bitmap data (not the raw JPEG
// bytes), so memory footprint is manageable. If memory ever becomes a concern,
// close/reload the tab — the cache is fully ephemeral.
const _imgCache = new Map<string, HTMLImageElement>();

/** Expose for cache-warming from upload flow (optional future use). */
export function cacheImage(url: string, img: HTMLImageElement) {
  _imgCache.set(url, img);
}

/** Remove a cached entry when the underlying storage path changes (e.g. after re-crop). */
export function evictCachedImage(url: string) {
  _imgCache.delete(url);
}
// ─────────────────────────────────────────────────────────────────────────────

/** Load an HTMLImageElement from a URL, retrying on transient network/TLS errors. */
const loadImageWithRetry = (src: string): Promise<HTMLImageElement> => {
  // Return the cached element immediately — avoids any network round-trip.
  const cached = _imgCache.get(src);
  if (cached) {
    console.log('[imgCache] ✅ HIT — no network fetch needed for', src.split('/').pop());
    return Promise.resolve(cached);
  }

  console.log('[imgCache] ⬇️  MISS — fetching from network:', src.split('/').pop() ?? src);

  return new Promise((resolve, reject) => {
    let attempt = 0;

    const tryLoad = () => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        _imgCache.set(src, img); // store for future paste-crop calls
        console.log('[imgCache] 📥 Cached after load:', src.split('/').pop(), `(cache size: ${_imgCache.size})`);
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
  console.log('[transform] 🖼️  createTransformedFile — item:', item.id, 'src:', src ? src.split('/').pop() : '⚠️ MISSING');
  if (!src) {
    console.error('[transform] ❌ No src URL on item — cannot transform:', item.id);
    return null;
  }

  let img: HTMLImageElement;
  try {
    img = await loadImageWithRetry(src);
    console.log('[transform] ✅ Image ready for canvas:', item.id, `${img.naturalWidth}×${img.naturalHeight}`);
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

      const sx = crop ? Math.round((crop.x / 100) * srcW) : 0;
      const sy = crop ? Math.round((crop.y / 100) * srcH) : 0;
      const sW = crop ? Math.round((crop.w / 100) * srcW) : srcW;
      const sH = crop ? Math.round((crop.h / 100) * srcH) : srcH;

      console.log('[transform] ✂️  Canvas params — rotation:', rot, 'crop region:', crop
        ? `x=${crop.x.toFixed(1)}% y=${crop.y.toFixed(1)}% w=${crop.w.toFixed(1)}% h=${crop.h.toFixed(1)}%`
        : 'none (full frame)',
        `→ src rect: ${sW}×${sH}px`);

      const radians = (rot * Math.PI) / 180;
      const cos = Math.abs(Math.cos(radians));
      const sin = Math.abs(Math.sin(radians));

      const canvasW = Math.round(sW * cos + sH * sin);
      const canvasH = Math.round(sW * sin + sH * cos);

      const canvas = document.createElement('canvas');
      canvas.width = canvasW;
      canvas.height = canvasH;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        console.error('[transform] ❌ Could not get 2D canvas context — browser issue?');
        return resolve(null);
      }

      ctx.translate(canvasW / 2, canvasH / 2);
      ctx.rotate(radians);
      ctx.drawImage(img, sx, sy, sW, sH, -sW / 2, -sH / 2, sW, sH);

      canvas.toBlob((blob) => {
        if (!blob) {
          console.error('[transform] ❌ canvas.toBlob returned null — memory issue?');
          return resolve(null);
        }
        const file = new File([blob], `${item.id}-transformed.jpg`, { type: blob.type });
        console.log('[transform] 🗜️  Blob ready:', item.id, `${(blob.size / 1024).toFixed(0)} KB`, `(canvas: ${canvasW}×${canvasH}px)`);
        console.log('[transform] ⏭️  NEXT: this blob will be uploaded to Supabase Storage as a new cropped file, then the DB row updated.');
        resolve(file);
      }, 'image/jpeg', 0.92);
    } catch (err) {
      console.error('[transform] ❌ Unexpected canvas error for item:', item.id, err);
      resolve(null);
    }
  });
};
