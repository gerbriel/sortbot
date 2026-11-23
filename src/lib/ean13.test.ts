import { describe, it, expect } from 'vitest';
import {
  EAN13_L, EAN13_G, EAN13_R, EAN13_PARITY, EAN13_MODULES, EAN13_QUIET_LEFT, EAN13_QUIET_RIGHT,
  encodeEan13, ean13Svg,
} from './ean13';
import { ean13StoreNumber, DEFAULT_CODE_SETTINGS } from './codeSettings';

const ones = (s: string) => [...s].filter(c => c === '1').length;
const complement = (s: string) => [...s].map(c => (c === '1' ? '0' : '1')).join('');
const reverse = (s: string) => [...s].reverse().join('');

/**
 * The tables are one table and two derivations (R = not L, G = reverse R), and
 * each set has a fixed parity. Asserting those three facts is what makes a
 * transcription typo in any one row impossible to ship.
 */
describe('EAN-13 tables', () => {
  it('R is L complemented and G is R reversed, for every digit', () => {
    for (let d = 0; d < 10; d++) {
      expect(EAN13_R[d], `R${d}`).toBe(complement(EAN13_L[d]));
      expect(EAN13_G[d], `G${d}`).toBe(reverse(EAN13_R[d]));
    }
  });

  it('every code is 7 modules; L has odd bar parity, G and R even', () => {
    for (let d = 0; d < 10; d++) {
      for (const t of [EAN13_L, EAN13_G, EAN13_R]) expect(t[d]).toMatch(/^[01]{7}$/);
      expect(ones(EAN13_L[d]) % 2).toBe(1);
      expect(ones(EAN13_G[d]) % 2).toBe(0);
      expect(ones(EAN13_R[d]) % 2).toBe(0);
    }
  });

  it('the parity table: first digit 0 is all L, every other row starts L and has three G', () => {
    expect(EAN13_PARITY[0]).toBe('LLLLLL');
    expect(new Set(EAN13_PARITY).size).toBe(10);
    for (let d = 1; d < 10; d++) {
      expect(EAN13_PARITY[d][0]).toBe('L');
      expect([...EAN13_PARITY[d]].filter(c => c === 'G')).toHaveLength(3);
    }
  });
});

/** A decoder written from the spec, independent of the encoder's loop. */
function decode(pattern: string): string {
  expect(pattern.slice(0, 3)).toBe('101');
  expect(pattern.slice(45, 50)).toBe('01010');
  expect(pattern.slice(92, 95)).toBe('101');
  let parity = '';
  let left = '';
  for (let i = 0; i < 6; i++) {
    const chunk = pattern.slice(3 + i * 7, 10 + i * 7);
    const l = EAN13_L.indexOf(chunk);
    const g = EAN13_G.indexOf(chunk);
    expect(l >= 0 || g >= 0, `left digit ${i}: ${chunk}`).toBe(true);
    parity += l >= 0 ? 'L' : 'G';
    left += String(l >= 0 ? l : g);
  }
  let right = '';
  for (let i = 0; i < 6; i++) {
    const chunk = pattern.slice(50 + i * 7, 57 + i * 7);
    const r = EAN13_R.indexOf(chunk);
    expect(r, `right digit ${i}: ${chunk}`).toBeGreaterThanOrEqual(0);
    right += String(r);
  }
  const first = EAN13_PARITY.indexOf(parity);
  expect(first, `parity ${parity}`).toBeGreaterThanOrEqual(0);
  return `${first}${left}${right}`;
}

describe('encodeEan13', () => {
  it('4006381333931: 95 modules, guards in place, left parity from the first digit', () => {
    const p = encodeEan13('4006381333931');
    expect(p).toHaveLength(EAN13_MODULES);
    expect(p).toMatch(/^[01]+$/);
    expect(p.slice(0, 3)).toBe('101');
    expect(p.slice(45, 50)).toBe('01010');
    expect(p.slice(92)).toBe('101');
    // First digit 4 -> LGLLGG for the six left digits 0 0 6 3 8 1.
    expect(EAN13_PARITY[4]).toBe('LGLLGG');
    const leftDigits = [0, 0, 6, 3, 8, 1];
    const sets = { L: EAN13_L, G: EAN13_G };
    leftDigits.forEach((d, i) => {
      const chunk = p.slice(3 + i * 7, 10 + i * 7);
      expect(chunk).toHaveLength(7);
      expect(chunk, `left ${i}`).toBe(sets[EAN13_PARITY[4][i] as 'L' | 'G'][d]);
    });
    // Right half 3 3 3 9 3 1, all R.
    [3, 3, 3, 9, 3, 1].forEach((d, i) => {
      expect(p.slice(50 + i * 7, 57 + i * 7), `right ${i}`).toBe(EAN13_R[d]);
    });
    // The known literal, assembled from the tables above by hand.
    expect(p).toBe(
      '101' + '0001101' + '0100111' + '0101111' + '0111101' + '0001001' + '0110011' +
      '01010' + '1000010' + '1000010' + '1000010' + '1110100' + '1000010' + '1100110' + '101',
    );
  });

  it('round-trips through an independent decoder, for every first digit', () => {
    const codes = ['4006381333931', '9780306406157', '5901234123457'];
    for (let n = 0; n < 10; n++) {
      const s = ean13StoreNumber(DEFAULT_CODE_SETTINGS, n * 1111);
      codes.push(s);
      // A store number starts with 2; build one per leading digit as well.
      const first12 = `${n}${s.slice(1, 12)}`;
      let sum = 0;
      for (let i = 0; i < 12; i++) sum += (first12.charCodeAt(i) - 48) * (i % 2 ? 3 : 1);
      codes.push(first12 + String((10 - (sum % 10)) % 10));
    }
    for (const c of codes) expect(decode(encodeEan13(c)), c).toBe(c);
  });

  it('throws on a wrong check digit, the wrong length, or non-digits', () => {
    expect(() => encodeEan13('4006381333932')).toThrow(/check digit/);
    expect(() => encodeEan13('400638133393')).toThrow();
    expect(() => encodeEan13('40063813339A1')).toThrow();
    expect(() => encodeEan13('')).toThrow();
  });
});

describe('ean13Svg', () => {
  it('draws the bars inside the quiet zones and prints the digits', () => {
    const svg = ean13Svg('4006381333931', { moduleWidth: 2, height: 50 });
    const width = (EAN13_QUIET_LEFT + EAN13_MODULES + EAN13_QUIET_RIGHT) * 2;
    expect(svg).toContain(`width="${width}"`);
    expect(svg).toContain('aria-label="Barcode 4006381333931"');
    expect(svg).toContain('>4<');
    expect(svg).toContain('>006381<');
    expect(svg).toContain('>333931<');
    const xs = [...svg.matchAll(/<rect x="([\d.]+)" y="0" width="([\d.]+)" height="(\d+)"/g)]
      .map(m => ({ x: Number(m[1]), w: Number(m[2]), h: Number(m[3]) }));
    // 3 guards = 2 + 2 + 2 bars; each of the 12 digits has exactly 2 bars.
    expect(xs).toHaveLength(6 + 24);
    expect(Math.min(...xs.map(b => b.x))).toBe(EAN13_QUIET_LEFT * 2);
    expect(Math.max(...xs.map(b => b.x + b.w))).toBe((EAN13_QUIET_LEFT + EAN13_MODULES) * 2);
    // Guard bars run longer than data bars.
    expect(xs.filter(b => b.h > 50)).toHaveLength(6);
  });

  it('omits the digits when asked and rejects an invalid code', () => {
    expect(ean13Svg('5901234123457', { showText: false })).not.toContain('<text');
    expect(() => ean13Svg('5901234123458')).toThrow();
    expect(() => ean13Svg('ACD-7H2K9M')).toThrow();
  });
});
