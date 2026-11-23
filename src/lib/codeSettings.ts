/**
 * codeSettings: a workspace's SKU and barcode CONVENTIONS, as pure data.
 *
 * WHERE IT LIVES. `description_settings.codes` (JSONB on organizations), the
 * same seam `platformPricing` and `background` use: no migration, normalised
 * on every read by `normalizeCodeSettings`, and a workspace that never opens
 * the setting gets `DEFAULT_CODE_SETTINGS`, which reproduces exactly what the
 * app did before (random `ACD-XXXXXX`, barcode = SKU, assigned when labels
 * are printed).
 *
 * WHAT A SKU LOOKS LIKE.   [prefix][sep][category code][sep][body]
 *   prefix         1 to 8 characters A-Z 0-9 (default ACD)
 *   sep            '-' or '' (default '-')
 *   category code  optional, 2 to 4 letters derived from the listing's category
 *                  ("Tees" -> TEE, "Denim jackets" -> DEN), only when
 *                  `categoryCode` is on
 *   body           scheme 'random': 6 Crockford base32 characters (today's)
 *                  scheme 'sequential': a zero-padded counter of
 *                  `sequenceDigits` digits, numbers handed out by the
 *                  database (`next_code_numbers`, 073) so two people saving at
 *                  once never draw the same one
 *
 * WHAT A BARCODE IS.
 *   'sku'          the barcode column mirrors the SKU and the label prints the
 *                  SKU as Code 128 (today's behaviour)
 *   'ean13_store'  a 13-digit GS1 "in-store" number: a 2-digit restricted
 *                  prefix (20 to 29, reserved by GS1 for internal use so it
 *                  never collides with a retail product), a 10-digit number
 *                  from the same workspace counter, and the EAN-13 check digit.
 *                  Marketplaces accept it in the barcode field and any retail
 *                  scanner reads it. The label prints EAN-13 symbology.
 *   'manual'       the app never writes the barcode column; the person types
 *                  the manufacturer's code or leaves it blank
 *
 * WHEN CODES ARE ASSIGNED (`autoAssign`).
 *   'on_save'      the first time a listing is saved from Step 3
 *   'on_labels'    when the labels sheet or a Products row asks for one (today)
 *   'never'        only when a person presses Generate
 *
 * UNIQUENESS IS THE DATABASE'S JOB: `products_org_sku_uidx` (053) for SKUs; a
 * sequential body is unique by construction once the counter is atomic. This
 * module never asserts uniqueness; it only formats.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export type SkuScheme = 'random' | 'sequential';
export type BarcodeMode = 'sku' | 'ean13_store' | 'manual';
export type CodeAutoAssign = 'on_save' | 'on_labels' | 'never';
export type SkuSeparator = '-' | '';

export interface CodeSettings {
  skuPrefix: string;
  skuSeparator: SkuSeparator;
  skuScheme: SkuScheme;
  /** 4 to 8. Only read when skuScheme is 'sequential'. */
  sequenceDigits: number;
  /** Insert a short code derived from the category between prefix and body. */
  categoryCode: boolean;
  barcodeMode: BarcodeMode;
  /** '20' to '29'. Only read when barcodeMode is 'ean13_store'. */
  ean13Prefix: string;
  autoAssign: CodeAutoAssign;
}

export const DEFAULT_CODE_SETTINGS: CodeSettings = {
  skuPrefix: 'ACD',
  skuSeparator: '-',
  skuScheme: 'random',
  sequenceDigits: 5,
  categoryCode: false,
  barcodeMode: 'sku',
  ean13Prefix: '20',
  autoAssign: 'on_labels',
};

export const SKU_PREFIX_MIN = 1;
export const SKU_PREFIX_MAX = 8;
export const SEQUENCE_DIGITS_MIN = 4;
export const SEQUENCE_DIGITS_MAX = 8;
export const CATEGORY_CODE_LENGTH = 3;
/** Same alphabet as barcode.ts (Crockford base32, no I L O U). */
export const SKU_BODY_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const SKU_RANDOM_BODY_LENGTH = 6;

// ── Normalisation (never trust the JSONB) ────────────────────────────────────

const PREFIX_RE = /^[A-Z0-9]+$/;

export function normalizeSkuPrefix(raw: unknown): string {
  const s = String(raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, SKU_PREFIX_MAX);
  return s.length >= SKU_PREFIX_MIN ? s : DEFAULT_CODE_SETTINGS.skuPrefix;
}

export function normalizeEan13Prefix(raw: unknown): string {
  const s = String(raw ?? '').replace(/\D/g, '');
  return /^2[0-9]$/.test(s) ? s : DEFAULT_CODE_SETTINGS.ean13Prefix;
}

export function normalizeCodeSettings(raw: unknown): CodeSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const digits = Number(r.sequenceDigits);
  return {
    skuPrefix: normalizeSkuPrefix(r.skuPrefix),
    skuSeparator: r.skuSeparator === '' ? '' : '-',
    skuScheme: r.skuScheme === 'sequential' ? 'sequential' : 'random',
    sequenceDigits: Number.isInteger(digits)
      ? Math.min(SEQUENCE_DIGITS_MAX, Math.max(SEQUENCE_DIGITS_MIN, digits))
      : DEFAULT_CODE_SETTINGS.sequenceDigits,
    categoryCode: r.categoryCode === true,
    barcodeMode: r.barcodeMode === 'ean13_store' || r.barcodeMode === 'manual' ? r.barcodeMode : 'sku',
    ean13Prefix: normalizeEan13Prefix(r.ean13Prefix),
    autoAssign: r.autoAssign === 'on_save' || r.autoAssign === 'never' ? r.autoAssign : 'on_labels',
  };
}

/** Field-level problems for the settings form. Empty array = valid. */
export function validateCodeSettings(s: CodeSettings): { field: keyof CodeSettings; message: string }[] {
  const out: { field: keyof CodeSettings; message: string }[] = [];
  if (!PREFIX_RE.test(s.skuPrefix) || s.skuPrefix.length < SKU_PREFIX_MIN || s.skuPrefix.length > SKU_PREFIX_MAX) {
    out.push({ field: 'skuPrefix', message: `Prefix is 1 to ${SKU_PREFIX_MAX} letters or digits.` });
  }
  if (s.skuScheme === 'sequential' && (s.sequenceDigits < SEQUENCE_DIGITS_MIN || s.sequenceDigits > SEQUENCE_DIGITS_MAX)) {
    out.push({ field: 'sequenceDigits', message: `Digits is ${SEQUENCE_DIGITS_MIN} to ${SEQUENCE_DIGITS_MAX}.` });
  }
  if (s.barcodeMode === 'ean13_store' && !/^2[0-9]$/.test(s.ean13Prefix)) {
    out.push({ field: 'ean13Prefix', message: 'In-store prefix is 20 to 29.' });
  }
  return out;
}

// ── Formatting ───────────────────────────────────────────────────────────────

/** "Denim jackets" -> "DEN", "T-shirts" -> "TSH", "" -> "". Letters only, upper. */
export function categoryCodeFor(category: string | null | undefined): string {
  const letters = String(category ?? '').toUpperCase().replace(/[^A-Z]/g, '');
  return letters.slice(0, CATEGORY_CODE_LENGTH);
}

export function padSequence(n: number, digits: number): string {
  const s = String(Math.max(0, Math.floor(n)));
  return s.length >= digits ? s : '0'.repeat(digits - s.length) + s;
}

export interface SkuParts {
  /** The random body or the counter value. */
  body: string;
  category?: string | null;
}

/** Assemble a SKU from the convention and its parts. Pure. */
export function formatSku(s: CodeSettings, parts: SkuParts): string {
  const segs = [s.skuPrefix];
  if (s.categoryCode) {
    const code = categoryCodeFor(parts.category);
    if (code) segs.push(code);
  }
  segs.push(parts.body);
  return segs.join(s.skuSeparator);
}

/** Body for a sequential SKU from a counter value. */
export function sequentialBody(s: CodeSettings, n: number): string {
  return padSequence(n, s.sequenceDigits);
}

/**
 * The regular expression that recognises a SKU THIS workspace generated under
 * its current convention. Used by the scanner's confusable fold (barcode.ts
 * `skuLookupCandidates`): only a body that could have come from our alphabet
 * may have I/L/O folded to 1/1/0; a manufacturer SKU is left alone.
 */
export function generatedSkuPattern(s: CodeSettings): RegExp {
  const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');
  const sep = esc(s.skuSeparator);
  const cat = s.categoryCode ? `(?:[A-Z]{1,${CATEGORY_CODE_LENGTH}}${sep})?` : '';
  const body = s.skuScheme === 'sequential'
    ? `[0-9]{${s.sequenceDigits},}`
    : `[${SKU_BODY_ALPHABET}]{${SKU_RANDOM_BODY_LENGTH}}`;
  return new RegExp(`^${esc(s.skuPrefix)}${sep}${cat}${body}$`);
}

// ── EAN-13 numbers (the digits; bars live in ean13.ts) ───────────────────────

/** Check digit for the first 12 digits of an EAN-13. */
export function ean13CheckDigit(first12: string): string {
  if (!/^\d{12}$/.test(first12)) throw new Error('ean13CheckDigit: expected 12 digits');
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const d = first12.charCodeAt(i) - 48;
    sum += i % 2 === 0 ? d : d * 3;
  }
  return String((10 - (sum % 10)) % 10);
}

export function isValidEan13(code: string): boolean {
  return /^\d{13}$/.test(code) && ean13CheckDigit(code.slice(0, 12)) === code[12];
}

/** A GS1 in-store number: prefix (20 to 29) + 10-digit counter + check digit. */
export function ean13StoreNumber(s: CodeSettings, n: number): string {
  const prefix = normalizeEan13Prefix(s.ean13Prefix);
  const body = padSequence(n, 10);
  if (body.length > 10) throw new Error('ean13StoreNumber: counter exceeds 10 digits');
  const first12 = prefix + body;
  return first12 + ean13CheckDigit(first12);
}

/** What the barcode column should hold for a listing with this SKU, or
 *  undefined when the app must not write it ('manual'). */
export function barcodeFor(s: CodeSettings, sku: string, counter?: number): string | undefined {
  if (s.barcodeMode === 'manual') return undefined;
  if (s.barcodeMode === 'ean13_store') {
    if (counter === undefined) return undefined;
    return ean13StoreNumber(s, counter);
  }
  return sku;
}

// ── Preview for the settings form ────────────────────────────────────────────

export function previewCodes(s: CodeSettings, category = 'Tees'): { sku: string; barcode: string } {
  const body = s.skuScheme === 'sequential' ? sequentialBody(s, 12) : '7K3Q9M';
  const sku = formatSku(s, { body, category });
  const barcode = s.barcodeMode === 'manual' ? 'typed by you' : (barcodeFor(s, sku, 12) ?? '');
  return { sku, barcode };
}
