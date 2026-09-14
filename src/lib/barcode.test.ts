import { describe, it, expect } from 'vitest';
import {
  CODE128_WIDTHS, CODE128_START_B, CODE128_START_C, CODE128_STOP,
  CODE128_MAX_LENGTH, encodeCode128, patternToBars, code128Svg,
  SKU_ALPHABET, SKU_PREFIX, SKU_BODY_LENGTH,
  generateSkuCandidate, isGeneratedSku, normalizeSkuInput, skuLookupCandidates,
} from './barcode';

/**
 * Code 128 is a lookup table plus a modulo — which means a single mistyped
 * digit anywhere in the 107-row table produces a barcode that still LOOKS like
 * a barcode and scans as the wrong product (or not at all). Three independent
 * checks make that unshippable:
 *
 *   1. SPEC PROPERTIES of the table (§"table"): widths, element counts, the
 *      even-bars/odd-spaces parity that Code 128 self-checks on, uniqueness.
 *   2. PUBLISHED ANCHORS: the four patterns any reference prints verbatim.
 *   3. A DECODER (§"round trip"): reads our own bars back into symbol values
 *      and re-validates the checksum. Bar/space inversion, an off-by-one in the
 *      alternation, or a wrong width all fail here even when (1) passes.
 */

// ── An independent reader, written from the symbology rather than from the
//    encoder, so it cannot share a bug with it. ───────────────────────────────
function decodeModules(pattern: string): number[] {
  // Runs of identical modules → element widths.
  const widths: number[] = [];
  let i = 0;
  while (i < pattern.length) {
    let j = i;
    while (j < pattern.length && pattern[j] === pattern[i]) j++;
    widths.push(j - i);
    i = j;
  }
  // The stop character is 7 elements; everything before it is 6 at a time.
  expect((widths.length - 7) % 6).toBe(0);
  const values: number[] = [];
  for (let k = 0; k + 6 <= widths.length; k += 6) {
    const chunk = widths.slice(k, k + (widths.length - k === 7 ? 7 : 6)).join('');
    const v = CODE128_WIDTHS.indexOf(chunk);
    expect(v, `unknown symbol "${chunk}"`).toBeGreaterThanOrEqual(0);
    values.push(v);
    if (widths.length - k === 7) break;
  }
  return values;
}

describe('CODE128_WIDTHS table', () => {
  it('has 107 rows: 106 data/control symbols plus STOP', () => {
    expect(CODE128_WIDTHS).toHaveLength(107);
  });

  it('every symbol is 11 modules over 6 elements — except STOP at 13 over 7', () => {
    CODE128_WIDTHS.forEach((w, v) => {
      const digits = [...w].map(Number);
      const expectedElements = v === CODE128_STOP ? 7 : 6;
      const expectedModules = v === CODE128_STOP ? 13 : 11;
      expect(digits, `value ${v}`).toHaveLength(expectedElements);
      expect(digits.reduce((a, b) => a + b, 0), `value ${v}`).toBe(expectedModules);
      // No element may be wider than 4 modules in Code 128.
      for (const d of digits) expect(d, `value ${v}`).toBeGreaterThanOrEqual(1);
      for (const d of digits) expect(d, `value ${v}`).toBeLessThanOrEqual(4);
    });
  });

  it('satisfies the even-bars / odd-spaces parity the symbology self-checks on', () => {
    // THE transcription guard: a single mistyped digit flips one of these two
    // sums to the wrong parity in almost every case.
    CODE128_WIDTHS.forEach((w, v) => {
      const digits = [...w].map(Number);
      const bars = digits.filter((_, i) => i % 2 === 0).reduce((a, b) => a + b, 0);
      const spaces = digits.filter((_, i) => i % 2 === 1).reduce((a, b) => a + b, 0);
      expect(bars % 2, `bars of value ${v} must be even`).toBe(0);
      expect(spaces % 2, `spaces of value ${v} must be odd`).toBe(1);
    });
  });

  it('has no duplicate patterns (every symbol must be distinguishable)', () => {
    expect(new Set(CODE128_WIDTHS).size).toBe(CODE128_WIDTHS.length);
  });

  it('matches the four published anchor patterns verbatim', () => {
    const modules = (v: number) =>
      [...CODE128_WIDTHS[v]].map((d, i) => (i % 2 === 0 ? '1' : '0').repeat(Number(d))).join('');
    expect(modules(103)).toBe('11010000100');       // Start A
    expect(modules(CODE128_START_B)).toBe('11010010000');  // Start B
    expect(modules(CODE128_START_C)).toBe('11010011100');  // Start C
    expect(modules(CODE128_STOP)).toBe('1100011101011');   // Stop
    expect(modules(0)).toBe('11011001100');         // value 0 (space in A/B, "00" in C)
  });
});

describe('encodeCode128 — known vectors', () => {
  it('"ABC123" stays in subset B and checksums to 67', () => {
    // StartB(104) A(33) B(34) C(35) 1(17) 2(18) 3(19)
    //   104 + 33·1 + 34·2 + 35·3 + 17·4 + 18·5 + 19·6 = 582 ; 582 mod 103 = 67
    const enc = encodeCode128('ABC123');
    expect(enc.values).toEqual([104, 33, 34, 35, 17, 18, 19, 67, 106]);
    expect(enc.checksum).toBe(67);
    // 8 symbols × 11 modules + the 13-module stop.
    expect(enc.modules).toBe(8 * 11 + 13);
  });

  it('"12345678" is packed two digits per symbol in subset C, checksum 47', () => {
    //   StartC(105) 12 34 56 78 → 105 + 12·1 + 34·2 + 56·3 + 78·4 = 665 ; mod 103 = 47
    const enc = encodeCode128('12345678');
    expect(enc.values).toEqual([105, 12, 34, 56, 78, 47, 106]);
    expect(enc.modules).toBe(6 * 11 + 13);
    // Proof it is worth doing: subset B would need 8 data symbols, not 4.
    expect(enc.values.length).toBeLessThan(encodeCode128('ABCDEFGH').values.length);
  });

  it('a mixed string switches into C for the long digit run and back out', () => {
    const enc = encodeCode128('AB1234567890CD');
    // StartB, A, B, →C, 12,34,56,78,90, →B, C, D, check, stop
    expect(enc.values.slice(0, 4)).toEqual([104, 33, 34, 99]);
    expect(enc.values.slice(4, 9)).toEqual([12, 34, 56, 78, 90]);
    expect(enc.values[9]).toBe(100); // switch back to B
    expect(enc.values.slice(10, 12)).toEqual([35, 36]); // C, D
  });

  it('an ODD digit run encodes its even part in C and the last digit in B', () => {
    const enc = encodeCode128('A12345');
    expect(enc.values[0]).toBe(104);
    expect(enc.values[1]).toBe(33);           // A
    expect(enc.values[2]).toBe(99);           // → C
    expect(enc.values.slice(3, 5)).toEqual([12, 34]);
    expect(enc.values[5]).toBe(100);          // → B
    expect(enc.values[6]).toBe(21);           // '5' = 53 - 32
  });

  it('a short digit run is NOT worth a switch and stays in B', () => {
    const enc = encodeCode128('A12');
    expect(enc.values).toEqual([104, 33, 17, 18, expect.any(Number), 106]);
    expect(enc.values).not.toContain(99);
  });

  it('starts in subset C for an all-digit even string, even a 2-digit one', () => {
    expect(encodeCode128('42').values[0]).toBe(CODE128_START_C);
    expect(encodeCode128('4242').values[0]).toBe(CODE128_START_C);
    // …but an odd all-digit string shorter than 4 is not worth it
    expect(encodeCode128('424').values[0]).toBe(CODE128_START_B);
  });

  it('encodes a generated SKU (the actual production input)', () => {
    const enc = encodeCode128('ACD-7H2K9M');
    expect(enc.values[0]).toBe(CODE128_START_B);
    expect(enc.values.at(-1)).toBe(CODE128_STOP);
    expect(enc.checksum).toBeGreaterThanOrEqual(0);
    expect(enc.checksum).toBeLessThan(103);
    expect(enc.pattern).toMatch(/^1/);   // a symbol always opens with a bar
    expect(enc.pattern).toMatch(/1$/);   // the stop character closes with one
  });
});

describe('encodeCode128 — round trip through an independent decoder', () => {
  const cases = [
    'ABC123', '12345678', 'ACD-7H2K9M', 'A12345', 'Bad Kids Club',
    'a', '0', '00', '999999999999', 'x-1', 'ACD-00000Z',
    '~!@#$%^&*()_+{}|:"<>?', 'Mixed 42 Case 1234 Text',
  ];
  for (const text of cases) {
    it(`decodes back to the same symbols and a valid checksum: ${JSON.stringify(text)}`, () => {
      const enc = encodeCode128(text);
      const decoded = decodeModules(enc.pattern);
      expect(decoded).toEqual([...enc.values]);
      // Re-derive the checksum from the decoded stream, independently.
      const body = decoded.slice(0, -2);
      const sum = body.reduce((acc, v, idx) => acc + v * Math.max(idx, 1), 0);
      expect(sum % 103).toBe(decoded[decoded.length - 2]);
      expect(decoded[decoded.length - 1]).toBe(CODE128_STOP);
    });
  }
});

describe('encodeCode128 — rejections', () => {
  it('refuses empty or whitespace-only input', () => {
    expect(() => encodeCode128('')).toThrow(/nothing to encode/);
    expect(() => encodeCode128('   ')).toThrow(/nothing to encode/);
  });

  it('refuses characters outside printable ASCII rather than dropping them', () => {
    // Dropping would print a barcode that scans as a DIFFERENT product.
    expect(() => encodeCode128('CAFÉ')).toThrow(/unsupported character/);
    expect(() => encodeCode128('a\tb')).toThrow(/unsupported character/);
    expect(() => encodeCode128('emoji 🏷')).toThrow(/unsupported character/);
  });

  it('refuses input past the length bound', () => {
    expect(() => encodeCode128('A'.repeat(CODE128_MAX_LENGTH))).not.toThrow();
    expect(() => encodeCode128('A'.repeat(CODE128_MAX_LENGTH + 1))).toThrow(/exceeds/);
  });
});

describe('patternToBars', () => {
  it('collapses module runs into bars with the right offsets', () => {
    expect(patternToBars('11010010000')).toEqual([
      { x: 0, width: 2 }, { x: 3, width: 1 }, { x: 6, width: 1 },
    ]);
  });

  it('bar module count equals the number of 1s in the pattern', () => {
    const enc = encodeCode128('ACD-7H2K9M');
    const bars = patternToBars(enc.pattern);
    const drawn = bars.reduce((a, b) => a + b.width, 0);
    expect(drawn).toBe([...enc.pattern].filter(c => c === '1').length);
  });
});

describe('code128Svg', () => {
  it('produces a self-contained svg sized from the module count', () => {
    const enc = encodeCode128('ACD-7H2K9M');
    const svg = code128Svg('ACD-7H2K9M', { moduleWidth: 2, height: 50, quietZone: 10, fontSize: 12 });
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg.endsWith('</svg>')).toBe(true);
    const width = (enc.modules + 20) * 2;
    expect(svg).toContain(`width="${width}"`);
    expect(svg).toContain(`height="${50 + 16}"`); // bars + fontSize + 4
    expect(svg).toContain('ACD-7H2K9M');
    expect(svg).toContain('role="img"');
  });

  it('offsets the first bar by the quiet zone so scanners see clear margin', () => {
    const svg = code128Svg('12345678', { moduleWidth: 3, quietZone: 10, showText: false });
    expect(svg).toContain('<rect x="30.00"');
    expect(svg).not.toContain('<text');
  });

  it('escapes the value it prints (the label is generated, never raw HTML)', () => {
    const svg = code128Svg('A&B<C', { showText: true });
    expect(svg).toContain('A&amp;B&lt;C');
    expect(svg).not.toContain('B<C');
  });
});

describe('SKU generation', () => {
  it('excludes the four Crockford confusables and has 32 symbols', () => {
    expect(SKU_ALPHABET).toHaveLength(32);
    for (const c of 'ILOU') expect(SKU_ALPHABET).not.toContain(c);
    expect(new Set(SKU_ALPHABET).size).toBe(32);
  });

  it('generates ACD-XXXXXX from the alphabet, every time', () => {
    for (let i = 0; i < 500; i++) {
      const sku = generateSkuCandidate();
      expect(sku).toMatch(new RegExp(`^${SKU_PREFIX}-[${SKU_ALPHABET}]{${SKU_BODY_LENGTH}}$`));
      expect(isGeneratedSku(sku)).toBe(true);
      expect(() => encodeCode128(sku)).not.toThrow();
    }
  });

  it('is not obviously degenerate — 500 draws are effectively all distinct', () => {
    const seen = new Set(Array.from({ length: 500 }, generateSkuCandidate));
    expect(seen.size).toBeGreaterThan(495);
  });

  it('isGeneratedSku rejects foreign spellings', () => {
    expect(isGeneratedSku('ACD-7H2K9M')).toBe(true);
    expect(isGeneratedSku('ACD-7H2K9')).toBe(false);      // too short
    expect(isGeneratedSku('ACD-7H2K9MM')).toBe(false);    // too long
    expect(isGeneratedSku('ACD-7H2K9I')).toBe(false);     // confusable
    expect(isGeneratedSku('XYZ-7H2K9M')).toBe(false);     // foreign prefix
    expect(isGeneratedSku('acd-7h2k9m')).toBe(false);     // we store upper
    expect(isGeneratedSku(null)).toBe(false);
    expect(isGeneratedSku('')).toBe(false);
  });
});

describe('scanner input normalization', () => {
  it('strips the whitespace a USB scanner and a phone keyboard add', () => {
    expect(normalizeSkuInput('  acd-7h2k9m\n')).toBe('ACD-7H2K9M');
    expect(normalizeSkuInput('ACD- 7H2 K9M')).toBe('ACD-7H2K9M');
    expect(normalizeSkuInput('   ')).toBe('');
  });

  it('offers the confusable fold as a SECOND candidate, never as an edit', () => {
    // A human keying our own SKU off a printed label types I for 1, O for 0.
    expect(skuLookupCandidates('acd-7hIk9O')).toEqual(['ACD-7HIK9O', 'ACD-7H1K90']);
  });

  it('leaves a foreign SKU containing I/L/O findable by its exact spelling first', () => {
    const [first] = skuLookupCandidates('LOT-IL0');
    expect(first).toBe('LOT-IL0');
  });

  it('returns one candidate when folding changes nothing, and none for empty', () => {
    expect(skuLookupCandidates('ACD-7H2K9M')).toEqual(['ACD-7H2K9M']);
    expect(skuLookupCandidates('  ')).toEqual([]);
  });

  it('never folds the prefix, only the body', () => {
    expect(skuLookupCandidates('LOT-I')[1]).toBe('LOT-1');
  });
});
