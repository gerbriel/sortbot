import { describe, expect, it } from 'vitest';
import { isKeyboardOpen, keyboardInsetFrom, KEYBOARD_OPEN_THRESHOLD_PX } from './keyboardInset';

describe('keyboardInsetFrom', () => {
  it('is 0 when the visual viewport fills the layout viewport (keyboard closed)', () => {
    expect(keyboardInsetFrom({ height: 800, offsetTop: 0 }, 800)).toBe(0);
    expect(isKeyboardOpen(0)).toBe(false);
  });

  it('is the covered height when the keyboard is open', () => {
    const inset = keyboardInsetFrom({ height: 460, offsetTop: 0 }, 800);
    expect(inset).toBe(340);
    expect(isKeyboardOpen(inset)).toBe(true);
  });

  it('subtracts how far the visual viewport is panned down', () => {
    expect(keyboardInsetFrom({ height: 460, offsetTop: 120 }, 800)).toBe(220);
  });

  it('rounds fractional device pixels', () => {
    expect(keyboardInsetFrom({ height: 459.6, offsetTop: 0.2 }, 800)).toBe(340);
  });

  it('a browser chrome change is an inset, but not an open keyboard', () => {
    const inset = keyboardInsetFrom({ height: 744, offsetTop: 0 }, 800);
    expect(inset).toBe(56);
    expect(isKeyboardOpen(inset)).toBe(false);
    expect(isKeyboardOpen(KEYBOARD_OPEN_THRESHOLD_PX)).toBe(true);
  });

  it('never goes negative (visual viewport taller than the layout one, or junk input)', () => {
    expect(keyboardInsetFrom({ height: 900, offsetTop: 0 }, 800)).toBe(0);
    expect(keyboardInsetFrom({ height: 800, offsetTop: 40 }, 800)).toBe(0);
    expect(keyboardInsetFrom({ height: Number.NaN, offsetTop: 0 }, 800)).toBe(0);
  });
});
