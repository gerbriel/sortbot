/**
 * ean13: a first-party EAN-13 encoder, the sibling of barcode.ts's Code 128.
 *
 * WHY: a workspace whose `codes.barcodeMode` is 'ean13_store' writes a GS1
 * in-store number (codeSettings.ts `ean13StoreNumber`) into the barcode
 * column, and the label must print it as EAN-13, the symbology every retail
 * scanner and marketplace expects for a 13-digit code. Same rules as
 * barcode.ts: no dependency, no network, no DOM; a string in, a string out.
 *
 * THE SYMBOLOGY, in one paragraph, so the tables can be checked by hand:
 *   95 modules: start guard 101, six LEFT digits of 7 modules each, centre
 *   guard 01010, six RIGHT digits of 7 modules each, end guard 101. The FIRST
 *   of the 13 digits is not drawn as bars at all: it is carried by which of
 *   two sets (L or G) each left digit is drawn from (EAN13_PARITY). Right
 *   digits always use the R set. R is the bitwise complement of L, and G is R
 *   reversed, so the three tables below are one table and two derivations;
 *   ean13.test.ts asserts both relationships, and that every L code has an
 *   odd number of bar modules and every G and R code an even number.
 *   Quiet zones: 11 modules left, 7 right (GS1 General Specifications).
 */

import { isValidEan13 } from './codeSettings';
import { patternToBars } from './barcode';

/** L set (odd parity), digit 0 to 9. '1' = bar module. */
export const EAN13_L: readonly string[] = [
  '0001101', '0011001', '0010011', '0111101', '0100011',
  '0110001', '0101111', '0111011', '0110111', '0001011',
];

/** G set (even parity) = R reversed. */
export const EAN13_G: readonly string[] = [
  '0100111', '0110011', '0011011', '0100001', '0011101',
  '0111001', '0000101', '0010001', '0001001', '0010111',
];

/** R set = L complemented. */
export const EAN13_R: readonly string[] = [
  '1110010', '1100110', '1101100', '1000010', '1011100',
  '1001110', '1010000', '1000100', '1001000', '1110100',
];

/** Which set each of the six left digits uses, by the first digit. */
export const EAN13_PARITY: readonly string[] = [
  'LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG',
  'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL',
];

export const EAN13_START = '101';
export const EAN13_CENTRE = '01010';
export const EAN13_END = '101';
export const EAN13_MODULES = 95;
export const EAN13_QUIET_LEFT = 11;
export const EAN13_QUIET_RIGHT = 7;

/** Module ranges of the three guards (inclusive start, exclusive end). Guard
 *  bars are drawn longer than data bars. */
export const EAN13_GUARDS: ReadonlyArray<readonly [number, number]> = [
  [0, 3], [45, 50], [92, 95],
];

function assertCode(digits13: string): string {
  const code = String(digits13 ?? '').trim();
  if (!/^\d{13}$/.test(code)) throw new Error('encodeEan13: expected 13 digits');
  if (!isValidEan13(code)) throw new Error(`encodeEan13: ${code} has the wrong check digit`);
  return code;
}

/** The 95-module pattern for a 13-digit EAN with a correct check digit. */
export function encodeEan13(digits13: string): string {
  const code = assertCode(digits13);
  const d = [...code].map(c => c.charCodeAt(0) - 48);
  const parity = EAN13_PARITY[d[0]];
  let out = EAN13_START;
  for (let i = 0; i < 6; i++) {
    const v = d[1 + i];
    out += parity[i] === 'L' ? EAN13_L[v] : EAN13_G[v];
  }
  out += EAN13_CENTRE;
  for (let i = 0; i < 6; i++) out += EAN13_R[d[7 + i]];
  out += EAN13_END;
  return out;
}

export interface Ean13SvgOptions {
  /** Pixels per module. */
  moduleWidth?: number;
  /** Data bar height in pixels; guard bars run 5 modules lower. */
  height?: number;
  /** Print the digits under the bars (first digit in the left quiet zone). */
  showText?: boolean;
  fontSize?: number;
  color?: string;
  title?: string;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const isGuardModule = (x: number): boolean => EAN13_GUARDS.some(([a, b]) => x >= a && x < b);

/**
 * A complete, self-contained `<svg>` string for a 13-digit EAN, quiet zones
 * included. Throws on anything that is not 13 digits with a correct check
 * digit: a mis-checked EAN prints a label no till will read.
 */
export function ean13Svg(code: string, options: Ean13SvgOptions = {}): string {
  const {
    moduleWidth = 2, height = 60, showText = true, fontSize = 12, color = '#000', title,
  } = options;
  const digits = assertCode(code);
  const pattern = encodeEan13(digits);
  const bars = patternToBars(pattern);
  const totalModules = EAN13_QUIET_LEFT + EAN13_MODULES + EAN13_QUIET_RIGHT;
  const width = totalModules * moduleWidth;
  const guardExtra = 5 * moduleWidth;
  const textGap = showText ? Math.max(fontSize + 2, guardExtra) : guardExtra;
  const totalHeight = height + textGap;
  const label = title ?? `Barcode ${digits}`;
  const x0 = EAN13_QUIET_LEFT * moduleWidth;

  const rects = bars.map(b => {
    const h = isGuardModule(b.x) ? height + guardExtra : height;
    return `<rect x="${(x0 + b.x * moduleWidth).toFixed(2)}" y="0" width="${(b.width * moduleWidth).toFixed(2)}" height="${h}" />`;
  }).join('');

  let caption = '';
  if (showText) {
    const y = totalHeight - 2;
    const font = `font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="${fontSize}" fill="${esc(color)}"`;
    // Centre of the left half (modules 3 to 45) and right half (50 to 92).
    const leftMid = x0 + 24 * moduleWidth;
    const rightMid = x0 + 71 * moduleWidth;
    caption =
      `<text x="${(x0 - 2 * moduleWidth).toFixed(2)}" y="${y}" text-anchor="end" ${font}>${digits[0]}</text>` +
      `<text x="${leftMid.toFixed(2)}" y="${y}" text-anchor="middle" ${font} letter-spacing="1">${digits.slice(1, 7)}</text>` +
      `<text x="${rightMid.toFixed(2)}" y="${y}" text-anchor="middle" ${font} letter-spacing="1">${digits.slice(7)}</text>`;
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${totalHeight}" ` +
    `viewBox="0 0 ${width} ${totalHeight}" role="img" aria-label="${esc(label)}">` +
    `<rect width="${width}" height="${totalHeight}" fill="#fff"/>` +
    `<g fill="${esc(color)}">${rects}</g>${caption}</svg>`
  );
}
