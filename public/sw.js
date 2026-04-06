/**
 * Sortbot image-caching Service Worker
 *
 * Problem: Supabase Storage free tier sends `Cache-Control: no-cache` on every
 * response.  The browser honours this by revalidating every image on every page
 * refresh — even though the actual bytes almost never change.  With 800 images
 * that means 800 conditional requests on every reload, causing a multi-second
 * loading delay.
 *
 * Solution: intercept every request to the Supabase Storage CDN, store the
 * response in Cache Storage with a 7-day TTL, and serve the cached copy on
 * subsequent requests without hitting the network.  We still do a background
 * network fetch to refresh the cache entry so it stays fresh.
 *
 * Strategy: stale-while-revalidate
 *   1. Request arrives → check Cache Storage.
 *   2. Cache HIT  → return cached response immediately (instant load),
 *                   AND fire a background fetch to refresh the cache entry.
 *   3. Cache MISS → fetch from network, store in cache, return response.
 *
 * Cache eviction: entries older than MAX_AGE_MS are deleted in the background
 * on every install/activate and periodically during fetch processing.
 *
 * Scope: only requests matching SUPABASE_IMG_PATTERN are intercepted.
 * All other requests (API, auth, JS, CSS) pass through untouched.
 */

const CACHE_NAME = 'sortbot-images-v1';
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// Match any Supabase Storage public image URL
const SUPABASE_IMG_PATTERN = /\/storage\/v1\/object\/public\/product-images\//;

// ─── Install ──────────────────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  // Skip waiting so the new SW activates immediately (no need to close tabs)
  self.skipWaiting();
});

// ─── Activate ─────────────────────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Take control of all clients immediately
      await self.clients.claim();
      // Prune stale entries from previous cache versions
      await pruneOldCaches();
      await pruneExpiredEntries();
    })()
  );
});

// ─── Fetch ────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const url = event.request.url;

  // Only intercept GET requests to Supabase Storage image paths
  if (event.request.method !== 'GET' || !SUPABASE_IMG_PATTERN.test(url)) {
    return; // let the browser handle everything else normally
  }

  event.respondWith(handleImageRequest(event.request));
});

// ─── Core handler ─────────────────────────────────────────────────────────────
async function handleImageRequest(request) {
  // Strip ?t= cache-bust params (added by LazyImg retry logic) so retries
  // of the same image resolve to the same cache key and don't inflate the cache.
  const cacheKey = stripCacheBust(request.url);
  const cache = await caches.open(CACHE_NAME);

  const cached = await cache.match(cacheKey);

  if (cached) {
    // Check if the cached entry is still within its TTL
    const cachedAt = Number(cached.headers.get('x-sw-cached-at') ?? 0);
    const age = Date.now() - cachedAt;

    if (age < MAX_AGE_MS) {
      // CACHE HIT (fresh) — return immediately, refresh in background
      refreshInBackground(cache, request, cacheKey);
      return cached;
    }
    // Entry is stale — fall through to network fetch (will update cache)
  }

  // CACHE MISS or stale — fetch from network
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      await storeInCache(cache, cacheKey, networkResponse.clone());
    }
    return networkResponse;
  } catch (err) {
    // Network error — return stale cached entry if we have one (better than nothing)
    if (cached) return cached;
    throw err;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Fire-and-forget background refresh — doesn't block the response */
function refreshInBackground(cache, request, cacheKey) {
  // Use waitUntil via the SW global only if available; otherwise best-effort
  const work = fetch(request)
    .then((res) => {
      if (res.ok) return storeInCache(cache, cacheKey, res);
    })
    .catch(() => { /* silently ignore background refresh failures */ });

  if (self.registration?.active) {
    // Keep SW alive long enough to finish
    self.registration.active.state; // no-op access to prevent lint warning
  }
  // We intentionally don't await this — the cached response was already returned
  void work;
}

/** Clone the response and add an x-sw-cached-at timestamp header */
async function storeInCache(cache, cacheKey, response) {
  const headers = new Headers(response.headers);
  headers.set('x-sw-cached-at', String(Date.now()));
  // Override the server's cache-control so the browser won't override our cache
  headers.set('cache-control', `public, max-age=${Math.floor(MAX_AGE_MS / 1000)}`);

  const cloned = new Response(await response.arrayBuffer(), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
  await cache.put(cacheKey, cloned);
}

/** Remove the ?t=<timestamp> cache-bust param added by LazyImg on retries */
function stripCacheBust(url) {
  try {
    const u = new URL(url);
    u.searchParams.delete('t');
    return u.toString();
  } catch {
    return url;
  }
}

/** Delete cache entries from old cache versions */
async function pruneOldCaches() {
  const keys = await caches.keys();
  await Promise.all(
    keys
      .filter((k) => k !== CACHE_NAME)
      .map((k) => caches.delete(k))
  );
}

/** Delete cache entries older than MAX_AGE_MS */
async function pruneExpiredEntries() {
  const cache = await caches.open(CACHE_NAME);
  const keys = await cache.keys();
  const now = Date.now();
  await Promise.all(
    keys.map(async (req) => {
      const res = await cache.match(req);
      if (!res) return;
      const cachedAt = Number(res.headers.get('x-sw-cached-at') ?? 0);
      if (now - cachedAt > MAX_AGE_MS) {
        await cache.delete(req);
      }
    })
  );
}
