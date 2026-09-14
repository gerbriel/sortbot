/**
 * barcode — a first-party Code 128 encoder and SKU generator.
 *
 * WHY WE WROTE OUR OWN (CLAUDE.md §9, the self-reliant rule): a barcode is a
 * lookup table and a modulo-103 checksum. Every JS barcode library is a
 * dependency, a bundle, and a supply-chain surface for ~150 lines of arithmetic
 * that has not changed since ISO/IEC 15417 was published. Nothing here touches
 * the network, the DOM, or Supabase — it is a string in, a string out.
 *
 * WHAT IT IMPLEMENTS
 *   Code 128, subsets B and C, chosen automatically (§ "Subset selection").
 *   Subset A (control characters) is deliberately NOT implemented: this encoder
 *   exists to print SKUs, which are ASCII 32–126 by construction, and an unused
 *   code path in a checksum is a place for a bug to live unobserved.
 *
 * THE SYMBOLOGY, in one paragraph, so the table below can be checked by hand:
 *   A Code 128 symbol is a run of characters, each 11 modules wide, drawn as
 *   bar–space–bar–space–bar–space. CODE128_WIDTHS[v] gives those six widths for
 *   symbol value v; the stop character (value 106) is the one exception at 13
 *   modules / 7 elements. A barcode is START + data + checksum + STOP, where
 *   checksum = (start + Σ vᵢ·i) mod 103 with i starting at 1 for the first data
 *   symbol. Self-check: every character's three BAR widths sum to an even
 *   number and its three SPACE widths to an odd one — barcode.test.ts asserts
 *   that for all 107 rows, which is what makes a transcription typo in the
 *   table impossible to ship.
 *
 * The four published anchor patterns are also asserted in the test, since they
 * are the values a reader can verify against any Code 128 reference:
 *   Start A 11010000100 · Start B 11010010000 · Start C 11010011100
 *   Stop 1100011101011
 */

/** Element widths (bar, space, bar, space, bar, space) for symbol values 0–106.
 *  Value 106 is STOP and carries a seventh element (13 modules total). */
export const CODE128_WIDTHS: readonly string[] = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];

/** Symbol values that are not data. */
export const CODE128_START_B = 104;
export const CODE128_START_C = 105;
export const CODE128_STOP = 106;
/** In subset B this switches to C; in subset C it switches to B. */
const SWITCH_TO_C = 99;
const SWITCH_TO_B = 100;

/** Longest data a single symbol may carry. Well past any SKU; the bound exists
 *  so a pasted paragraph cannot produce a metre-wide SVG. */
export const CODE128_MAX_LENGTH = 80;

export interface Code128Encoding {
  /** The text that was encoded (after trimming). */
  readonly text: string;
  /** Every symbol value in order: START, data…, checksum, STOP. */
  readonly values: readonly number[];
  /** The modulo-103 check character (also present in `values`). */
  readonly checksum: number;
  /** '1' = bar module, '0' = space module. Length === `modules`. */
  readonly pattern: string;
  /** Total module count including the stop character, excluding quiet zones. */
  readonly modules: number;
}

/** A drawable bar: where it starts (in modules) and how wide it is. */
export interface BarSegment {
  readonly x: number;
  readonly width: number;
}

const isDigit = (c: string): boolean => c >= '0' && c <= '9';

/** How many consecutive digits start at `i`. */
function digitRun(text: string, i: number): number {
  let n = 0;
  while (i + n < text.length && isDigit(text[i + n])) n++;
  return n;
}

/**
 * Subset selection — valid always, minimal nearly always.
 *
 * Subset C packs TWO digits into one symbol, so a digit run pays for the
 * switch symbol as soon as it is four long. The rule:
 *   - start in C when the leading digit run is ≥ 4, or when the whole string
 *     is an even number of digits (the two-digit case the spec calls out);
 *   - inside B, switch to C at any digit run ≥ 4, consuming an even number of
 *     its digits (an odd run leaves its last digit to be encoded back in B);
 *   - inside C, switch back to B as soon as two digits are not available.
 *
 * A run of exactly 5 comes out the same length either way; we take the switch.
 * Correctness never depends on the choice — only width does.
 */
function planValues(text: string): number[] {
  const values: number[] = [];
  const n = text.length;
  const lead = digitRun(text, 0);
  let mode: 'B' | 'C' = (lead >= 4 || (lead === n && n >= 2 && n % 2 === 0)) ? 'C' : 'B';
  values.push(mode === 'C' ? CODE128_START_C : CODE128_START_B);

  let i = 0;
  while (i < n) {
    const run = digitRun(text, i);
    if (mode === 'C') {
      if (run >= 2) {
        const take = run - (run % 2);
        for (let k = 0; k < take; k += 2) values.push(Number(text.slice(i + k, i + k + 2)));
        i += take;
      } else {
        values.push(SWITCH_TO_B);
        mode = 'B';
      }
      continue;
    }
    // mode B
    const take = run - (run % 2);
    if (take >= 4) {
      values.push(SWITCH_TO_C);
      mode = 'C';
      continue;
    }
    values.push(text.charCodeAt(i) - 32);
    i++;
  }
  return values;
}

/**
 * Encode `text` as Code 128 (auto subset B/C).
 *
 * Throws on empty input, on anything outside printable ASCII 32–126 (a SKU is
 * never outside it, and silently dropping a character would print a barcode
 * that scans as the wrong product), and past CODE128_MAX_LENGTH.
 */
export function encodeCode128(text: string): Code128Encoding {
  const data = String(text ?? '').trim();
  if (!data) throw new Error('encodeCode128: nothing to encode');
  if (data.length > CODE128_MAX_LENGTH) {
    throw new Error(`encodeCode128: ${data.length} characters exceeds the ${CODE128_MAX_LENGTH}-character limit`);
  }
  for (const ch of data) {
    const c = ch.charCodeAt(0);
    if (c < 32 || c > 126) {
      throw new Error(`encodeCode128: unsupported character ${JSON.stringify(ch)} (printable ASCII only)`);
    }
  }

  const values = planValues(data);
  // Checksum: the start value weighs 1, then each data symbol weighs its
  // 1-based position. values[0] IS the start, so its index 0 → weight 1 falls
  // out of `Math.max(idx, 1)`.
  let sum = 0;
  values.forEach((v, idx) => { sum += v * Math.max(idx, 1); });
  const checksum = sum % 103;

  const all = [...values, checksum, CODE128_STOP];
  let pattern = '';
  for (const v of all) {
    const widths = CODE128_WIDTHS[v];
    for (let k = 0; k < widths.length; k++) {
      // Elements alternate bar, space, bar, … starting with a bar.
      pattern += (k % 2 === 0 ? '1' : '0').repeat(Number(widths[k]));
    }
  }

  return { text: data, values: all, checksum, pattern, modules: pattern.length };
}

/** Collapse a module pattern into drawable bars (runs of '1'). */
export function patternToBars(pattern: string): BarSegment[] {
  const bars: BarSegment[] = [];
  let i = 0;
  while (i < pattern.length) {
    if (pattern[i] === '1') {
      const start = i;
      while (i < pattern.length && pattern[i] === '1') i++;
      bars.push({ x: start, width: i - start });
    } else {
      i++;
    }
  }
  return bars;
}

export interface Code128SvgOptions {
  /** Pixels per module. 2 is the print default (≈0.5 mm at 96 dpi). */
  moduleWidth?: number;
  /** Bar height in pixels (excluding the human-readable line). */
  height?: number;
  /** Quiet zone on each side, in modules. The spec's minimum is 10. */
  quietZone?: number;
  /** Print the value underneath the bars. */
  showText?: boolean;
  /** Font size for that line, in px. */
  fontSize?: number;
  /** Bar colour. Keep it near-black: scanners read contrast, not hue. */
  color?: string;
  /** Accessible name for the <svg>. Defaults to "Barcode <value>". */
  title?: string;
}

/** XML-escape a value destined for SVG text / attributes. */
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * A complete, self-contained `<svg>` string for `text`.
 *
 * Returned as a STRING rather than JSX so the same function serves the print
 * sheet, a future PDF, and any test that wants to assert on the geometry. The
 * caller injects it (the content is generated here, never user HTML).
 */
export function code128Svg(text: string, options: Code128SvgOptions = {}): string {
  const {
    moduleWidth = 2, height = 60, quietZone = 10,
    showText = true, fontSize = 12, color = '#000', title,
  } = options;

  const enc = encodeCode128(text);
  const bars = patternToBars(enc.pattern);
  const totalModules = enc.modules + quietZone * 2;
  const width = totalModules * moduleWidth;
  const textGap = showText ? fontSize + 4 : 0;
  const totalHeight = height + textGap;
  const label = title ?? `Barcode ${enc.text}`;

  const rects = bars
    .map(b => `<rect x="${((b.x + quietZone) * moduleWidth).toFixed(2)}" y="0" width="${(b.width * moduleWidth).toFixed(2)}" height="${height}" />`)
    .join('');

  const caption = showText
    ? `<text x="${(width / 2).toFixed(2)}" y="${totalHeight - 2}" text-anchor="middle" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="${fontSize}" fill="${esc(color)}" letter-spacing="1">${esc(enc.text)}</text>`
    : '';

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${totalHeight}" ` +
    `viewBox="0 0 ${width} ${totalHeight}" role="img" aria-label="${esc(label)}">` +
    `<rect width="${width}" height="${totalHeight}" fill="#fff"/>` +
    `<g fill="${esc(color)}">${rects}</g>${caption}</svg>`
  );
}

// ── SKU generation ──────────────────────────────────────────────────────────

/**
 * Crockford base32: the digits plus the letters, minus I, L, O and U.
 *
 * I/L/O go because a SKU gets read aloud across a table and typed off a
 * printed label — 1/I/L and 0/O are the classic mistypes. U goes because
 * Crockford drops it so the alphabet cannot spell an obscenity by accident.
 * 32 symbols over 6 characters = 32⁶ ≈ 1.07 billion codes per workspace.
 */
export const SKU_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const SKU_PREFIX = 'ACD';
export const SKU_BODY_LENGTH = 6;

const SKU_RE = new RegExp(`^${SKU_PREFIX}-[${SKU_ALPHABET}]{${SKU_BODY_LENGTH}}$`);

/** True for a SKU this app generated (prefix, separator, alphabet and length). */
export function isGeneratedSku(sku: string | null | undefined): boolean {
  return !!sku && SKU_RE.test(sku);
}

/**
 * Six random Crockford characters behind the ACD- prefix.
 *
 * Randomness comes from `crypto.getRandomValues` where it exists, with
 * `Math.random` behind it only so a non-browser test environment still runs.
 * Rejection sampling (`byte < 256 - 256 % 32`, i.e. < 256) keeps the
 * distribution flat — 256 is an exact multiple of 32, so every byte is usable
 * and the modulo introduces no bias.
 *
 * UNIQUENESS IS NOT ASSERTED HERE. This function is a candidate generator; the
 * `(org_id, sku)` unique index in listing_labels.sql is the authority, and
 * labelsService retries on 23505. A pure function cannot know what the database
 * already holds, and pretending otherwise is how duplicate SKUs ship.
 */
export function generateSkuCandidate(): string {
  const n = SKU_BODY_LENGTH;
  let body = '';
  const g = typeof globalThis.crypto?.getRandomValues === 'function' ? globalThis.crypto : null;
  if (g) {
    const bytes = new Uint8Array(n);
    g.getRandomValues(bytes);
    for (let i = 0; i < n; i++) body += SKU_ALPHABET[bytes[i] % SKU_ALPHABET.length];
  } else {
    for (let i = 0; i < n; i++) body += SKU_ALPHABET[Math.floor(Math.random() * SKU_ALPHABET.length)];
  }
  return `${SKU_PREFIX}-${body}`;
}

/**
 * Normalize something a human typed or a USB scanner emitted: upper-cased and
 * stripped of all whitespace (a scanner emits a trailing Enter, and a phone
 * keyboard likes to add a space). Nothing else is changed — see
 * `skuLookupCandidates` for why the confusable fold is kept separate.
 */
export function normalizeSkuInput(raw: string): string {
  return String(raw ?? '').trim().toUpperCase().replace(/\s+/g, '');
}

/**
 * The SKU spellings worth looking up for a typed/scanned string, best first.
 *
 * A generated SKU's body cannot contain I, L or O, so when a human keys one off
 * a printed label those letters are always a mistype for 1, 1 and 0. Folding
 * them is therefore free ACCURACY on our own codes — but it would silently
 * corrupt a manufacturer SKU that legitimately contains them, so the fold is a
 * SECOND candidate rather than an edit to the first. The caller tries them in
 * order and stops at the first hit.
 */
export function skuLookupCandidates(raw: string): string[] {
  const exact = normalizeSkuInput(raw);
  if (!exact) return [];
  const dash = exact.indexOf('-');
  // Fold the body only; the prefix is ours and contains none of these letters.
  const head = dash >= 0 ? exact.slice(0, dash + 1) : '';
  const body = dash >= 0 ? exact.slice(dash + 1) : exact;
  const folded = head + body.replace(/[IL]/g, '1').replace(/O/g, '0');
  return folded === exact ? [exact] : [exact, folded];
}
