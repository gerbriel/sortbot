import { describe, it, expect } from 'vitest';
import { clampLensPosition } from './magnifierPosition';

/** Report 17: the lens must never leave the viewport, at any cursor position. */
describe('clampLensPosition', () => {
  const W = 1000, H = 800, SIZE = 200, M = 8;

  it('sits to the right of the cursor and is vertically centred when there is room', () => {
    expect(clampLensPosition(400, 400, SIZE, W, H)).toEqual({ left: 420, top: 300 });
  });

  it('flips to the left of the cursor instead of overflowing the right edge', () => {
    // 980 + 20 + 200 would end at 1200, well past the 1000px viewport.
    expect(clampLensPosition(980, 400, SIZE, W, H).left).toBe(980 - 20 - 200);
  });

  it('clamps at the top and bottom edges', () => {
    expect(clampLensPosition(400, 0, SIZE, W, H).top).toBe(M);
    expect(clampLensPosition(400, H, SIZE, W, H).top).toBe(H - SIZE - M);
  });

  it('clamps at the left edge when the flip has nowhere to go', () => {
    // Narrow window: neither side fits, so it must still land on-screen.
    const p = clampLensPosition(5, 400, SIZE, 260, H);
    expect(p.left).toBeGreaterThanOrEqual(M);
    expect(p.left + SIZE).toBeLessThanOrEqual(260 - M);
  });

  it('never overflows any edge, sweeping the whole viewport and beyond', () => {
    for (const size of [80, 200, 400]) {
      for (let x = -50; x <= W + 50; x += 25) {
        for (let y = -50; y <= H + 50; y += 25) {
          const p = clampLensPosition(x, y, size, W, H);
          expect(p.left).toBeGreaterThanOrEqual(M);
          expect(p.top).toBeGreaterThanOrEqual(M);
          expect(p.left + size).toBeLessThanOrEqual(W - M);
          expect(p.top + size).toBeLessThanOrEqual(H - M);
        }
      }
    }
  });

  it('a lens larger than the viewport clamps to the margin rather than inverting', () => {
    const p = clampLensPosition(200, 200, 900, 400, 300);
    expect(p).toEqual({ left: M, top: M });
  });

  it('honours custom offset and margin', () => {
    expect(clampLensPosition(100, 100, 50, W, H, { offset: 0, margin: 0 }))
      .toEqual({ left: 100, top: 75 });
  });
});
