import { describe, it, expect, beforeEach } from 'vitest';
import {
  cacheImage,
  evictCachedImage,
  __imgCacheStatsForTests,
  __resetImgCacheForTests,
  __readCachedImageForTests,
  __IMG_CACHE_MAX_BYTES_FOR_TESTS as BUDGET,
} from './imageTransforms';

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
