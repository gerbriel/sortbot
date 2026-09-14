/**
 * Service-Worker image cache control.
 *
 * WHY (security audit 05, finding #21): public/sw.js caches every
 * product-images response in shared Cache Storage for 7 days, keyed by URL
 * only, and nothing ever clears it. On a shared workstation the next person to
 * sign in — a different workspace entirely — can still pull the previous
 * tenant's photos out of the browser's cache. Signing out must take the bytes
 * with it.
 *
 * The cache lives in the Service Worker's origin storage, so the purge is asked
 * for by message and the SW does the delete (public/sw.js, 'PURGE_IMAGE_CACHE').
 * When no SW controls the page — first load, SW unregistered, or a browser with
 * Cache Storage but no SW support — the page deletes the cache itself, so the
 * guarantee holds either way.
 */
import { log } from './debugLogger';

/** Must match CACHE_NAME in public/sw.js. */
export const IMAGE_CACHE_NAME = 'sortbot-images-v1';

export const PURGE_MESSAGE = 'PURGE_IMAGE_CACHE';
export const PURGE_DONE_MESSAGE = 'PURGE_IMAGE_CACHE_DONE';

/** How long to wait for the SW to confirm before falling back. */
const PURGE_TIMEOUT_MS = 2000;

/** Delete the cache from this page. Used as the fallback and after a timeout. */
async function deleteDirectly(): Promise<boolean> {
  try {
    if (typeof caches === 'undefined') return false;
    return await caches.delete(IMAGE_CACHE_NAME);
  } catch {
    return false;
  }
}

/**
 * Drop every cached tenant image. Safe to call when there is no Service Worker,
 * no Cache Storage, or nothing cached — it never throws and never rejects.
 * Call it on sign-out, before/after `supabase.auth.signOut()`.
 */
export async function purgeImageCache(): Promise<void> {
  const controller =
    typeof navigator !== 'undefined' && 'serviceWorker' in navigator
      ? navigator.serviceWorker.controller
      : null;

  if (!controller) {
    const dropped = await deleteDirectly();
    log.app(`purgeImageCache | no SW controller | deletedDirectly=${dropped}`);
    return;
  }

  const confirmed = await new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    try {
      const channel = new MessageChannel();
      channel.port1.onmessage = (event: MessageEvent) => {
        finish((event.data as { type?: string } | null)?.type === PURGE_DONE_MESSAGE);
      };
      controller.postMessage({ type: PURGE_MESSAGE }, [channel.port2]);
      setTimeout(() => finish(false), PURGE_TIMEOUT_MS);
    } catch {
      finish(false);
    }
  });

  if (!confirmed) {
    // The SW did not answer (asleep, updating, or an older build without the
    // handler). Do it from here instead — same origin, same Cache Storage.
    const dropped = await deleteDirectly();
    log.app(`purgeImageCache | SW silent | deletedDirectly=${dropped}`);
    return;
  }
  log.app('purgeImageCache | SW confirmed');
}
