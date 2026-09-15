import { describe, it, expect } from 'vitest';
import {
  STACK_MAX_LAYERS,
  STACK_OFFSET_X,
  STACK_OFFSET_Y,
  STACK_COMPACT_SCALE,
  stackLayers,
  stackReserve,
  stackOverflowBadge,
} from './stackLayout';

/**
 * Step 2 piles. The component has no harness, so the geometry the JSX and the
 * CSS both depend on is locked here: layer order (back-to-front, leader last),
 * the offset reserve that keeps the deepest layer from being clipped, and the
 * "+N" badge counting HIDDEN photos rather than total.
 */

describe('stackLayers — order and z', () => {
  it('returns back-to-front, leader last', () => {
    const layers = stackLayers(3);
    expect(layers.map(l => l.index)).toEqual([2, 1, 0]);
  });

  it('the leader is un-offset, un-rotated and on top', () => {
    const layers = stackLayers(5);
    const leader = layers[layers.length - 1];
    expect(leader.index).toBe(0);
    expect(leader.x).toBe(0);
    expect(leader.y).toBe(0);
    expect(leader.rotate).toBe(0);
    expect(leader.z).toBe(Math.max(...layers.map(l => l.z)));
  });

  it('z increases monotonically towards the leader', () => {
    const z = stackLayers(3).map(l => l.z);
    expect(z).toEqual([...z].sort((a, b) => a - b));
    expect(new Set(z).size).toBe(z.length);
  });
});

describe('stackLayers — the visible cap', () => {
  it('never draws more than STACK_MAX_LAYERS', () => {
    expect(stackLayers(40)).toHaveLength(STACK_MAX_LAYERS);
    expect(stackLayers(4)).toHaveLength(STACK_MAX_LAYERS);
  });

  it('draws fewer layers than the cap when the group is small', () => {
    expect(stackLayers(2)).toHaveLength(2);
    expect(stackLayers(1)).toHaveLength(1);
  });

  it('a one-photo pile degrades to a plain un-offset card', () => {
    expect(stackLayers(1)).toEqual([{ index: 0, x: 0, y: 0, rotate: 0, z: 1 }]);
  });

  it('returns nothing for an empty or nonsense count', () => {
    expect(stackLayers(0)).toEqual([]);
    expect(stackLayers(-3)).toEqual([]);
    expect(stackLayers(NaN)).toEqual([]);
  });

  it('honours an explicit maxLayers override', () => {
    expect(stackLayers(9, { maxLayers: 2 })).toHaveLength(2);
    expect(stackLayers(9, { maxLayers: 0 })).toEqual([]);
  });
});

describe('stackLayers — offsets', () => {
  it('offsets one step per layer of depth', () => {
    const layers = stackLayers(3);
    const byIndex = Object.fromEntries(layers.map(l => [l.index, l]));
    expect(byIndex[1].x).toBe(STACK_OFFSET_X);
    expect(byIndex[1].y).toBe(STACK_OFFSET_Y);
    expect(byIndex[2].x).toBe(STACK_OFFSET_X * 2);
    expect(byIndex[2].y).toBe(STACK_OFFSET_Y * 2);
  });

  it('alternates the rotation sign by depth so a pile looks tossed, not sheared', () => {
    const byIndex = Object.fromEntries(stackLayers(3).map(l => [l.index, l]));
    expect(byIndex[1].rotate).toBeLessThan(0);
    expect(byIndex[2].rotate).toBeGreaterThan(0);
  });

  it('compact shrinks every offset by STACK_COMPACT_SCALE and never grows one', () => {
    const wide = stackLayers(3);
    const tight = stackLayers(3, { compact: true });
    for (let i = 0; i < wide.length; i++) {
      expect(Math.abs(tight[i].x)).toBeLessThanOrEqual(Math.abs(wide[i].x));
      expect(Math.abs(tight[i].y)).toBeLessThanOrEqual(Math.abs(wide[i].y));
      expect(Math.abs(tight[i].rotate)).toBeLessThanOrEqual(Math.abs(wide[i].rotate));
    }
    const deepest = tight[0];
    expect(deepest.x).toBeCloseTo(STACK_OFFSET_X * 2 * STACK_COMPACT_SCALE, 5);
  });
});

describe('stackReserve — the padding the pile box must keep free', () => {
  it('equals the deepest layer offset, so nothing is clipped', () => {
    expect(stackReserve(3)).toEqual({ right: STACK_OFFSET_X * 2, bottom: STACK_OFFSET_Y * 2 });
    expect(stackReserve(9)).toEqual({ right: STACK_OFFSET_X * 2, bottom: STACK_OFFSET_Y * 2 });
  });

  it('a two-photo pile only reserves one step', () => {
    expect(stackReserve(2)).toEqual({ right: STACK_OFFSET_X, bottom: STACK_OFFSET_Y });
  });

  it('reserves nothing for a single card or an empty pile', () => {
    expect(stackReserve(1)).toEqual({ right: 0, bottom: 0 });
    expect(stackReserve(0)).toEqual({ right: 0, bottom: 0 });
  });

  it('shrinks with compact', () => {
    expect(stackReserve(3, { compact: true }).right)
      .toBeLessThan(stackReserve(3).right);
  });
});

describe('stackOverflowBadge — counts HIDDEN photos', () => {
  it('is null while every photo is drawn', () => {
    expect(stackOverflowBadge(1)).toBeNull();
    expect(stackOverflowBadge(2)).toBeNull();
    expect(stackOverflowBadge(STACK_MAX_LAYERS)).toBeNull();
  });

  it('counts only what the pile could not draw', () => {
    expect(stackOverflowBadge(4)).toBe('+1');
    expect(stackOverflowBadge(12)).toBe('+9');
  });

  it('tracks a maxLayers override', () => {
    expect(stackOverflowBadge(4, { maxLayers: 2 })).toBe('+2');
  });

  it('is null for a nonsense count', () => {
    expect(stackOverflowBadge(NaN)).toBeNull();
  });
});
