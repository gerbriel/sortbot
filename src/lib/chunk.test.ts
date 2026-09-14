import { describe, it, expect } from 'vitest';
import { chunked, ID_CHUNK } from './chunk';

/**
 * The chunking bound is load-bearing: PostgREST 400s when an `IN(...)` list makes
 * the URL too long (~794 ids), which is why several call sites carry comments
 * warning not to remove their loop. These tests pin the partitioning exactly so
 * the ~18 hand-written copies could be replaced with confidence.
 */
describe('chunked', () => {
  const ids = (n: number) => Array.from({ length: n }, (_, i) => i);

  it('defaults to the PostgREST IN() bound', () => {
    expect(ID_CHUNK).toBe(100);
    expect(chunked(ids(250)).map(c => c.length)).toEqual([100, 100, 50]);
  });

  it('partitions in order with no gaps and no duplicates', () => {
    const out = chunked(ids(250));
    expect(out.flat()).toEqual(ids(250));
    expect(out[0][0]).toBe(0);
    expect(out[2][49]).toBe(249);
  });

  it('handles the boundary sizes the old loops had to get right', () => {
    expect(chunked(ids(0))).toEqual([]);                       // no requests at all
    expect(chunked(ids(1)).map(c => c.length)).toEqual([1]);
    expect(chunked(ids(99)).map(c => c.length)).toEqual([99]);
    expect(chunked(ids(100)).map(c => c.length)).toEqual([100]); // NOT [100, 0]
    expect(chunked(ids(101)).map(c => c.length)).toEqual([100, 1]);
    expect(chunked(ids(200)).map(c => c.length)).toEqual([100, 100]);
  });

  it('honours an explicit size — the EXIF rescan bounds concurrency at 5', () => {
    expect(chunked(ids(12), 5).map(c => c.length)).toEqual([5, 5, 2]);
    expect(chunked(ids(3), 1).map(c => c.length)).toEqual([1, 1, 1]);
  });

  it('never returns an empty trailing chunk', () => {
    for (const n of [0, 1, 5, 99, 100, 101, 199, 200, 201]) {
      expect(chunked(ids(n)).every(c => c.length > 0)).toBe(true);
    }
  });

  it('does not mutate or alias the input', () => {
    const input = ids(150);
    const out = chunked(input);
    out[0][0] = -1;
    expect(input[0]).toBe(0);
    expect(input).toHaveLength(150);
  });

  it('rejects a nonsense size loudly instead of looping forever', () => {
    expect(() => chunked(ids(5), 0)).toThrow(/positive integer/);
    expect(() => chunked(ids(5), -1)).toThrow(/positive integer/);
    expect(() => chunked(ids(5), 1.5)).toThrow(/positive integer/);
  });
});
