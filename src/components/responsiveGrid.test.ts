import { describe, it, expect } from 'vitest';
import {
  clampGridColumns,
  clampGroupGridColumns,
  gridColumnBounds,
  DESKTOP_MAX_COLUMNS,
  DESKTOP_MIN_COLUMNS,
  PHONE_MAX_COLUMNS,
  PHONE_MAX_GROUP_COLUMNS,
  PHONE_MIN_COLUMNS,
} from './responsiveGrid';

describe('gridColumnBounds', () => {
  it('gives phones a 1–3 slider range', () => {
    expect(gridColumnBounds(true)).toEqual({ min: PHONE_MIN_COLUMNS, max: PHONE_MAX_COLUMNS });
  });

  it('leaves the desktop range untouched', () => {
    expect(gridColumnBounds(false)).toEqual({ min: DESKTOP_MIN_COLUMNS, max: DESKTOP_MAX_COLUMNS });
  });
});

describe('clampGridColumns', () => {
  it('passes desktop values through unchanged', () => {
    // The stored default is 8 — the desktop layout must not shift.
    expect(clampGridColumns(8, false)).toBe(8);
    expect(clampGridColumns(2, false)).toBe(2);
    expect(clampGridColumns(12, false)).toBe(12);
  });

  it('clamps a desktop preference down to 3 on a phone', () => {
    expect(clampGridColumns(8, true)).toBe(3);
    expect(clampGridColumns(12, true)).toBe(3);
  });

  it('keeps the slider meaningful inside the phone range', () => {
    expect(clampGridColumns(1, true)).toBe(1);
    expect(clampGridColumns(2, true)).toBe(2);
    expect(clampGridColumns(3, true)).toBe(3);
  });

  it('raises values below the viewport minimum', () => {
    expect(clampGridColumns(0, true)).toBe(1);
    expect(clampGridColumns(1, false)).toBe(2);
    expect(clampGridColumns(-5, false)).toBe(2);
  });

  it('never emits a fractional or non-finite column count', () => {
    expect(clampGridColumns(2.4, false)).toBe(2);
    expect(clampGridColumns(2.6, false)).toBe(3);
    expect(clampGridColumns(NaN, true)).toBe(PHONE_MIN_COLUMNS);
    expect(clampGridColumns(Infinity, false)).toBe(DESKTOP_MIN_COLUMNS);
  });
});

describe('clampGroupGridColumns', () => {
  it('caps group cards tighter than singles on phones', () => {
    expect(clampGroupGridColumns(8, true)).toBe(PHONE_MAX_GROUP_COLUMNS);
    expect(clampGroupGridColumns(3, true)).toBe(2);
    expect(clampGroupGridColumns(1, true)).toBe(1);
  });

  it('matches the singles grid on desktop', () => {
    expect(clampGroupGridColumns(8, false)).toBe(8);
    expect(clampGroupGridColumns(12, false)).toBe(12);
  });
});
