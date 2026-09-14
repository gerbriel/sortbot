import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  cacheImage,
  computeCropRect,
  rotatedSize,
  resolveTransformSource,
  createTransformQueue,
  invalidateImageUrl,
  __forceFreshCountForTests,
  type CropPercent,
  evictCachedImage,
  __imgCacheStatsForTests,
  __resetImgCacheForTests,
  __readCachedImageForTests,
  __IMG_CACHE_MAX_BYTES_FOR_TESTS as BUDGET,
} from './imageTransforms';
import { IMAGE_CACHE_NAME } from './swCache';

/**
 * The session image cache is a byte-budgeted LRU (F5). A decoded
 * HTMLImageElement costs naturalWidth * naturalHeight * 4 bytes of RGBA in the
 * renderer, so the bound has to be BYTES, not entries — the unbounded Map it
 * replaced needed ~24 GB for a 1,500-image paste-crop and OOM-crashed the tab.
 *
 * Eviction is a memory optimisation only: every read treats a miss as "re-fetch
 * from the CDN" (identical to a URL that was never cached), so nothing here
 * asserts that a batch keeps its entries — it asserts the ACCOUNTING stays
 * exact, which is what keeps the budget from drifting into the OOM zone again.
 *
 * Images are plain objects with naturalWidth/naturalHeight: the LRU only ever
 * reads those two fields, so no DOM image decoder is needed.
 */
const img = (w: number, h: number): HTMLImageElement =>
  ({ naturalWidth: w, naturalHeight: h } as unknown as HTMLImageElement);

/** An image that costs exactly `bytes` of RGBA (bytes/4 pixels in one row).
 *  Callers pass powers-of-two fractions of the budget so the arithmetic is exact. */
const imgOfBytes = (bytes: number): HTMLImageElement => img(bytes / 4, 1);

const MB = 1024 * 1024;
const QUARTER = BUDGET / 4; // 128 MB — four of these fill the budget exactly

beforeEach(() => {
  __resetImgCacheForTests();
});

describe('image cache — accounting', () => {
  it('caches an entry and charges it naturalWidth*naturalHeight*4 bytes', () => {
    cacheImage('a.jpg', img(2000, 2000));
    expect(__imgCacheStatsForTests()).toEqual({ entries: 1, bytes: 2000 * 2000 * 4 });
    expect(__readCachedImageForTests('a.jpg')).toBeDefined();
  });

  it('charges a conservative 4 MB when the dimensions are unknown (0)', () => {
    cacheImage('undecoded.jpg', img(0, 0));
    expect(__imgCacheStatsForTests()).toEqual({ entries: 1, bytes: 4 * MB });
  });

  it('re-inserting the same key never double-counts its bytes', () => {
    cacheImage('a.jpg', img(1000, 1000));
    cacheImage('a.jpg', img(1000, 1000));
    cacheImage('a.jpg', img(500, 500));
    expect(__imgCacheStatsForTests()).toEqual({ entries: 1, bytes: 500 * 500 * 4 });
  });

  it('returns undefined for a URL that was never cached (caller re-fetches)', () => {
    expect(__readCachedImageForTests('never-seen.jpg')).toBeUndefined();
  });
});

describe('image cache — LRU eviction', () => {
  it('evicts the least-recently-used entry, not the most-recently-used', () => {
    cacheImage('oldest', imgOfBytes(QUARTER));
    cacheImage('second', imgOfBytes(QUARTER));
    cacheImage('third', imgOfBytes(QUARTER));
    cacheImage('newest', imgOfBytes(QUARTER));
    expect(__imgCacheStatsForTests()).toEqual({ entries: 4, bytes: BUDGET });

    // One more quarter does not fit → the oldest key is dropped, nothing else.
    cacheImage('incoming', imgOfBytes(QUARTER));

    expect(__readCachedImageForTests('oldest')).toBeUndefined();
    expect(__readCachedImageForTests('second')).toBeDefined();
    expect(__readCachedImageForTests('third')).toBeDefined();
    expect(__readCachedImageForTests('newest')).toBeDefined();
    expect(__readCachedImageForTests('incoming')).toBeDefined();
    expect(__imgCacheStatsForTests()).toEqual({ entries: 4, bytes: BUDGET });
  });

  it('evicts as many entries as the incoming image needs', () => {
    cacheImage('q1', imgOfBytes(QUARTER));
    cacheImage('q2', imgOfBytes(QUARTER));
    cacheImage('q3', imgOfBytes(QUARTER));
    cacheImage('q4', imgOfBytes(QUARTER));

    cacheImage('big', imgOfBytes(BUDGET / 2)); // needs two quarters freed

    expect(__readCachedImageForTests('q1')).toBeUndefined();
    expect(__readCachedImageForTests('q2')).toBeUndefined();
    expect(__readCachedImageForTests('q3')).toBeDefined();
    expect(__readCachedImageForTests('q4')).toBeDefined();
    expect(__imgCacheStatsForTests()).toEqual({ entries: 3, bytes: BUDGET });
  });

  it('a READ refreshes recency, so the refreshed entry survives the next eviction', () => {
    cacheImage('q1', imgOfBytes(QUARTER));
    cacheImage('q2', imgOfBytes(QUARTER));
    cacheImage('q3', imgOfBytes(QUARTER));
    cacheImage('q4', imgOfBytes(QUARTER));

    // Touch the oldest — it becomes most-recently-used, so q2 is now the victim.
    expect(__readCachedImageForTests('q1')).toBeDefined();

    cacheImage('incoming', imgOfBytes(QUARTER));

    expect(__readCachedImageForTests('q1')).toBeDefined();
    expect(__readCachedImageForTests('q2')).toBeUndefined();
    expect(__readCachedImageForTests('q3')).toBeDefined();
    expect(__readCachedImageForTests('q4')).toBeDefined();
    expect(__imgCacheStatsForTests()).toEqual({ entries: 4, bytes: BUDGET });
  });

  it('never exceeds the budget across a long sequence of inserts', () => {
    for (let i = 0; i < 200; i += 1) {
      cacheImage(`img-${i}.jpg`, img(2000, 2000)); // 16 MB each → 3.2 GB unbounded
      expect(__imgCacheStatsForTests().bytes).toBeLessThanOrEqual(BUDGET);
    }
    const { entries, bytes } = __imgCacheStatsForTests();
    expect(entries).toBe(Math.floor(BUDGET / (2000 * 2000 * 4)));
    expect(bytes).toBe(entries * 2000 * 2000 * 4);
  });
});

describe('evictCachedImage', () => {
  it('removes the entry AND its bytes', () => {
    cacheImage('a.jpg', img(1000, 1000));
    cacheImage('b.jpg', img(1000, 1000));
    evictCachedImage('a.jpg');
    expect(__readCachedImageForTests('a.jpg')).toBeUndefined();
    expect(__imgCacheStatsForTests()).toEqual({ entries: 1, bytes: 1000 * 1000 * 4 });
  });

  it('is a no-op for an unknown URL (byte total untouched)', () => {
    cacheImage('a.jpg', img(1000, 1000));
    evictCachedImage('not-cached.jpg');
    evictCachedImage('a.jpg');
    evictCachedImage('a.jpg'); // double-evict must not go negative
    expect(__imgCacheStatsForTests()).toEqual({ entries: 0, bytes: 0 });
  });
});

describe('image cache — oversized single image', () => {
  it('is not cached, does not evict the cache, and leaves the byte total exact', () => {
    cacheImage('keeper.jpg', img(1000, 1000));
    const before = __imgCacheStatsForTests();

    cacheImage('huge.jpg', imgOfBytes(BUDGET + MB)); // one byte-budget + 1 MB

    expect(__readCachedImageForTests('huge.jpg')).toBeUndefined();
    expect(__readCachedImageForTests('keeper.jpg')).toBeDefined();
    expect(__imgCacheStatsForTests()).toEqual(before);
  });

  it('drops a previously cached entry that is re-inserted oversized', () => {
    cacheImage('grows.jpg', img(1000, 1000));
    cacheImage('grows.jpg', imgOfBytes(BUDGET * 2));
    expect(__readCachedImageForTests('grows.jpg')).toBeUndefined();
    expect(__imgCacheStatsForTests()).toEqual({ entries: 0, bytes: 0 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Crop geometry — the rules that decide WHERE a pasted crop lands.
//
// Background: a bulk paste-crop was "99 % accurate but 1–3 are cropped weird".
// `crop` is PERCENT of the frame, so it only transfers faithfully between images
// of the SAME aspect ratio. The outliers in a batch are the differently-shaped
// ones: a landscape frame in a portrait shoot, a rotated item (rotation swaps
// the frame's w/h), and an item that was already cropped once — whose current
// frame is the previous crop's shape, so pasting again crops the crop.
//
// These tests pin both halves of the fix: the percent mapping is preserved
// EXACTLY for same-aspect targets (the 99 %), and the shape is preserved when
// the aspect differs (the 1–3 %).
// ─────────────────────────────────────────────────────────────────────────────

/** The arithmetic `createTransformedFile` used before this fix, verbatim. */
const legacyRect = (W: number, H: number, c: CropPercent) => ({
  sx: Math.round((c.x / 100) * W),
  sy: Math.round((c.y / 100) * H),
  sw: Math.round((c.w / 100) * W),
  sh: Math.round((c.h / 100) * H),
});

const CROP: CropPercent = { x: 10, y: 15, w: 70, h: 60 };

describe('rotatedSize', () => {
  it('leaves the frame alone at 0°', () => {
    expect(rotatedSize(4000, 3000, 0)).toEqual({ width: 4000, height: 3000 });
  });

  it('swaps width and height at 90° and 270° (EXIF 6/8 photos rotated in-app)', () => {
    expect(rotatedSize(4000, 3000, 90)).toEqual({ width: 3000, height: 4000 });
    expect(rotatedSize(4000, 3000, 270)).toEqual({ width: 3000, height: 4000 });
  });

  it('is unchanged at 180°, and handles the negative degrees rotateSelected produces', () => {
    expect(rotatedSize(4000, 3000, 180)).toEqual({ width: 4000, height: 3000 });
    expect(rotatedSize(4000, 3000, -90)).toEqual({ width: 3000, height: 4000 });
    expect(rotatedSize(4000, 3000, -270)).toEqual({ width: 3000, height: 4000 });
  });

  it('returns a zero frame for unusable dimensions instead of NaN', () => {
    expect(rotatedSize(0, 3000, 0)).toEqual({ width: 0, height: 0 });
    expect(rotatedSize(NaN, 3000, 0)).toEqual({ width: 0, height: 0 });
    expect(rotatedSize(4000, 3000, NaN)).toEqual({ width: 4000, height: 3000 });
  });
});

describe('computeCropRect — the 99 % that already worked must not move', () => {
  it('reproduces the pre-fix arithmetic exactly, with no source aspect', () => {
    for (const [W, H] of [[4000, 3000], [3000, 4000], [2000, 2000], [1999, 1501]] as const) {
      expect(computeCropRect({ width: W, height: H }, CROP)).toEqual(legacyRect(W, H, CROP));
    }
  });

  it('reproduces it for a SAME-ASPECT paste, even though an aspect was supplied', () => {
    // 4000×3000 copied onto 2000×1500 — the ordinary case across one camera roll.
    const same = computeCropRect({ width: 2000, height: 1500 }, CROP, { sourceAspect: 4000 / 3000 });
    expect(same).toEqual(legacyRect(2000, 1500, CROP));
    expect(same).toEqual({ sx: 200, sy: 225, sw: 1400, sh: 900 });
  });

  it('treats a hair of floating-point aspect drift as the same shape', () => {
    const drift = computeCropRect({ width: 4000, height: 3000 }, CROP, { sourceAspect: 4000 / 3000 + 1e-9 });
    expect(drift).toEqual(legacyRect(4000, 3000, CROP));
  });

  it('is the full frame when there is no crop', () => {
    expect(computeCropRect({ width: 4000, height: 3000 })).toEqual({ sx: 0, sy: 0, sw: 4000, sh: 3000 });
    expect(computeCropRect({ width: 4000, height: 3000 }, null)).toEqual({ sx: 0, sy: 0, sw: 4000, sh: 3000 });
  });
});

describe('computeCropRect — differently-shaped targets (the 1–3 %)', () => {
  it('landscape crop → portrait target keeps the drawn SHAPE, not the percentages', () => {
    // Drawn on 4000×3000 (4:3): 70 % × 60 % ⇒ 2800×1800 px ⇒ aspect 14:9.
    const r = computeCropRect({ width: 3000, height: 4000 }, CROP, { sourceAspect: 4000 / 3000 });
    expect(r.sw / r.sh).toBeCloseTo(2800 / 1800, 2);
    // The raw percentages would have produced 2100×2400 — a PORTRAIT rect from a
    // landscape drawing. That inversion is the visible "cropped weird".
    expect(legacyRect(3000, 4000, CROP).sw / legacyRect(3000, 4000, CROP).sh).toBeCloseTo(0.875, 3);
    expect(r).toEqual({ sx: 300, sy: 1125, sw: 2100, sh: 1350 });
  });

  it('portrait crop → landscape target likewise keeps the shape', () => {
    const portraitCrop: CropPercent = { x: 20, y: 10, w: 60, h: 80 };
    const r = computeCropRect({ width: 4000, height: 3000 }, portraitCrop, { sourceAspect: 3000 / 4000 });
    // Drawn on 3:4: 60 % × 80 % ⇒ 1800×3200 px ⇒ aspect 0.5625.
    expect(r.sw / r.sh).toBeCloseTo(1800 / 3200, 2);
    expect(r.sw).toBeLessThanOrEqual(4000);
    expect(r.sh).toBeLessThanOrEqual(3000);
  });

  it('a rotated target is a different frame, and the shape survives that too', () => {
    // Target is 4000×3000 rotated 90° ⇒ the frame the crop lands on is 3000×4000.
    const frame = rotatedSize(4000, 3000, 90);
    const r = computeCropRect(frame, CROP, { sourceAspect: 4000 / 3000 });
    expect(frame).toEqual({ width: 3000, height: 4000 });
    expect(r.sw / r.sh).toBeCloseTo(2800 / 1800, 2);
  });

  it('keeps the crop centred where the user put it', () => {
    // A crop hugging the top-left stays top-left; one hugging bottom-right stays there.
    const topLeft = computeCropRect({ width: 3000, height: 4000 }, { x: 0, y: 0, w: 40, h: 30 }, { sourceAspect: 4 / 3 });
    const botRight = computeCropRect({ width: 3000, height: 4000 }, { x: 60, y: 70, w: 40, h: 30 }, { sourceAspect: 4 / 3 });
    expect(topLeft.sx).toBe(0);
    expect(topLeft.sy).toBe(0);
    expect(botRight.sx + botRight.sw).toBe(3000);
    expect(botRight.sy + botRight.sh).toBeLessThanOrEqual(4000);
  });

  it('shrinks to fit when the drawn shape cannot fit the target at either extent', () => {
    // A full-frame 4:3 crop pasted onto a very tall 1:4 frame.
    const r = computeCropRect({ width: 1000, height: 4000 }, { x: 0, y: 0, w: 100, h: 100 }, { sourceAspect: 4 / 3 });
    expect(r.sw).toBeLessThanOrEqual(1000);
    expect(r.sh).toBeLessThanOrEqual(4000);
    expect(r.sw / r.sh).toBeCloseTo(4 / 3, 2);
  });
});

describe('computeCropRect — clamping and degenerate input', () => {
  it('never lets the rect run past the source frame (drawImage pads those with black)', () => {
    const over = computeCropRect({ width: 1000, height: 1000 }, { x: 60, y: 60, w: 80, h: 80 });
    expect(over.sx + over.sw).toBeLessThanOrEqual(1000);
    expect(over.sy + over.sh).toBeLessThanOrEqual(1000);
  });

  it('absorbs the independent-rounding overflow the old code could emit', () => {
    // x=10.05 % and w=89.95 % of 1000 each round UP: 101 + 900 = 1001 > 1000.
    const legacy = legacyRect(1000, 1000, { x: 10.05, y: 0, w: 89.95, h: 100 });
    expect(legacy.sx + legacy.sw).toBe(1001);
    const r = computeCropRect({ width: 1000, height: 1000 }, { x: 10.05, y: 0, w: 89.95, h: 100 });
    expect(r.sx + r.sw).toBe(1000);
    expect(r.sw).toBe(900); // slid into frame rather than shrunk
  });

  it('clamps negative and over-100 percentages into the frame', () => {
    const r = computeCropRect({ width: 1000, height: 800 }, { x: -50, y: -20, w: 200, h: 200 });
    expect(r).toEqual({ sx: 0, sy: 0, sw: 1000, sh: 800 });
  });

  it('never produces an empty rect from a sub-pixel crop', () => {
    const r = computeCropRect({ width: 1000, height: 1000 }, { x: 50, y: 50, w: 0.01, h: 0.01 });
    expect(r.sw).toBe(1);
    expect(r.sh).toBe(1);
  });

  it('falls back to the full frame for NaN / zero-size crops instead of a 0×0 canvas', () => {
    const full = { sx: 0, sy: 0, sw: 1000, sh: 1000 };
    expect(computeCropRect({ width: 1000, height: 1000 }, { x: NaN, y: 0, w: 50, h: 50 })).toEqual(full);
    expect(computeCropRect({ width: 1000, height: 1000 }, { x: 0, y: 0, w: 0, h: 50 })).toEqual(full);
  });

  it('returns a zero rect for an unusable source so the caller can bail', () => {
    expect(computeCropRect({ width: 0, height: 0 }, CROP)).toEqual({ sx: 0, sy: 0, sw: 0, sh: 0 });
    expect(computeCropRect({ width: NaN, height: 100 }, CROP)).toEqual({ sx: 0, sy: 0, sw: 0, sh: 0 });
  });

  it('ignores a nonsensical source aspect rather than warping the crop', () => {
    for (const bad of [0, -2, NaN, null, undefined]) {
      expect(computeCropRect({ width: 4000, height: 3000 }, CROP, { sourceAspect: bad as number }))
        .toEqual(legacyRect(4000, 3000, CROP));
    }
  });
});

describe('resolveTransformSource — where a repeat crop reads its pixels', () => {
  const virgin = { preview: 'https://cdn/a.jpg', imageUrls: ['https://cdn/a.jpg'] };
  const cropped = {
    preview: 'https://cdn/cropped-2.jpg',
    imageUrls: ['https://cdn/cropped-2.jpg'],
    originalUrl: 'https://cdn/a.jpg',
  };

  it('an interactive crop always reads the file the modal displayed', () => {
    expect(resolveTransformSource(virgin)).toEqual({ url: 'https://cdn/a.jpg', fromOriginal: false });
    expect(resolveTransformSource(cropped, 'current'))
      .toEqual({ url: 'https://cdn/cropped-2.jpg', fromOriginal: false });
  });

  it('a bulk paste reads the cached ORIGINAL, so a second paste cannot crop the crop', () => {
    expect(resolveTransformSource(cropped, 'original'))
      .toEqual({ url: 'https://cdn/a.jpg', fromOriginal: true });
  });

  it('falls back to the current file when no original was ever cached', () => {
    expect(resolveTransformSource(virgin, 'original'))
      .toEqual({ url: 'https://cdn/a.jpg', fromOriginal: false });
  });

  it('falls back through imageUrls[0] when preview is empty', () => {
    expect(resolveTransformSource({ imageUrls: ['https://cdn/b.jpg'] }))
      .toEqual({ url: 'https://cdn/b.jpg', fromOriginal: false });
    expect(resolveTransformSource({})).toEqual({ url: '', fromOriginal: false });
  });

  it('pasting twice from the original is idempotent — the second paste is not zoomed in', () => {
    // First paste: 70 %×60 % of the 4000×3000 original.
    const first = computeCropRect(rotatedSize(4000, 3000, 0), CROP);
    // Item now shows a 2800×1800 file; a second identical paste resolves the
    // ORIGINAL again, so the rect is the same one — not 70 % of 2800×1800.
    const src = resolveTransformSource(
      { preview: 'https://cdn/cropped.jpg', originalUrl: 'https://cdn/a.jpg' }, 'original');
    expect(src.fromOriginal).toBe(true);
    const second = computeCropRect(rotatedSize(4000, 3000, 0), CROP);
    expect(second).toEqual(first);
    // What the un-fixed path did instead: crop the crop, losing 30 % more each time.
    expect(computeCropRect({ width: first.sw, height: first.sh }, CROP).sw).toBe(1960);
  });
});

describe('createTransformQueue — two pastes must never overlap on one image', () => {
  /** A task that resolves only when the test says so. */
  const deferred = () => {
    let resolve!: () => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
  };

  it('runs same-key tasks strictly in sequence, never concurrently', async () => {
    const q = createTransformQueue();
    const order: string[] = [];
    const a = deferred();
    const b = deferred();

    const p1 = q.run('item-1', async () => { order.push('a:start'); await a.promise; order.push('a:end'); });
    const p2 = q.run('item-1', async () => { order.push('b:start'); await b.promise; order.push('b:end'); });

    await Promise.resolve();
    // b must not have started while a is still in flight.
    expect(order).toEqual(['a:start']);

    a.resolve();
    await p1;
    await Promise.resolve();
    expect(order).toEqual(['a:start', 'a:end', 'b:start']);

    b.resolve();
    await p2;
    expect(order).toEqual(['a:start', 'a:end', 'b:start', 'b:end']);
  });

  it('lets different keys run in parallel — a batch is not serialised into one lane', async () => {
    const q = createTransformQueue();
    const started: string[] = [];
    const gates = [deferred(), deferred(), deferred()];
    const ps = gates.map((g, i) => q.run(`item-${i}`, async () => { started.push(`${i}`); await g.promise; }));

    await Promise.resolve();
    expect(started).toEqual(['0', '1', '2']);
    gates.forEach(g => g.resolve());
    await Promise.all(ps);
  });

  it('a failure rejects only its own caller and does not poison the key', async () => {
    const q = createTransformQueue();
    const ran: string[] = [];

    const failing = q.run('item-1', async () => { ran.push('first'); throw new Error('upload died'); });
    await expect(failing).rejects.toThrow('upload died');

    const after = q.run('item-1', async () => { ran.push('second'); });
    await expect(after).resolves.toBeUndefined();
    expect(ran).toEqual(['first', 'second']);
  });

  it('drains its bookkeeping so a long batch does not leak one entry per image', async () => {
    const q = createTransformQueue();
    await Promise.all(
      Array.from({ length: 50 }, (_, i) => q.run(`item-${i}`, async () => {})),
    );
    // Let the cleanup microtask attached to each tail run.
    await new Promise(r => setTimeout(r, 0));
    expect(q.pending).toBe(0);
  });

  it('keeps a key queued while work is outstanding', async () => {
    const q = createTransformQueue();
    const g = deferred();
    const p = q.run('item-1', async () => { await g.promise; });
    expect(q.pending).toBe(1);
    g.resolve();
    await p;
    await new Promise(r => setTimeout(r, 0));
    expect(q.pending).toBe(0);
  });
});

describe('invalidateImageUrl — in-place overwrites must not serve pre-crop bytes', () => {
  const realCaches = (globalThis as { caches?: CacheStorage }).caches;

  afterEach(() => {
    if (realCaches === undefined) delete (globalThis as { caches?: CacheStorage }).caches;
    else (globalThis as { caches?: CacheStorage }).caches = realCaches;
  });

  it('drops the LRU entry AND its bytes', async () => {
    cacheImage('https://cdn/a.jpg', img(1000, 1000));
    expect(__imgCacheStatsForTests().entries).toBe(1);
    await invalidateImageUrl('https://cdn/a.jpg');
    expect(__imgCacheStatsForTests()).toEqual({ entries: 0, bytes: 0 });
  });

  it('deletes the Service Worker entry under the same cache name sw.js uses', async () => {
    const deleted: string[] = [];
    const opened: string[] = [];
    (globalThis as unknown as { caches: unknown }).caches = {
      open: async (name: string) => { opened.push(name); return { delete: async (u: string) => { deleted.push(u); return true; } }; },
    };
    await invalidateImageUrl('https://cdn/a.jpg');
    expect(opened).toEqual([IMAGE_CACHE_NAME]);
    expect(deleted).toEqual(['https://cdn/a.jpg']);
  });

  it('marks the url for one forced re-fetch, and only one', async () => {
    expect(__forceFreshCountForTests()).toBe(0);
    await invalidateImageUrl('https://cdn/a.jpg');
    expect(__forceFreshCountForTests()).toBe(1);
    // Marking the same url twice must not queue two forced loads.
    await invalidateImageUrl('https://cdn/a.jpg');
    expect(__forceFreshCountForTests()).toBe(1);
  });

  it('still marks the url when Cache Storage is unavailable, and never throws', async () => {
    delete (globalThis as { caches?: CacheStorage }).caches;
    await expect(invalidateImageUrl('https://cdn/b.jpg')).resolves.toBeUndefined();
    expect(__forceFreshCountForTests()).toBeGreaterThan(0);
  });

  it('never throws when Cache Storage rejects (private mode, blocked storage)', async () => {
    (globalThis as unknown as { caches: unknown }).caches = { open: async () => { throw new Error('blocked'); } };
    await expect(invalidateImageUrl('https://cdn/c.jpg')).resolves.toBeUndefined();
  });

  it('is a no-op for an empty url', async () => {
    await invalidateImageUrl('');
    expect(__forceFreshCountForTests()).toBe(0);
  });
});
