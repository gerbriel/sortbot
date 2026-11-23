import { describe, it, expect } from 'vitest';
import {
  DEFAULT_CODE_SETTINGS, normalizeCodeSettings, normalizeSkuPrefix, normalizeEan13Prefix,
  validateCodeSettings, formatSku, sequentialBody, padSequence, categoryCodeFor,
  generatedSkuPattern, ean13CheckDigit, isValidEan13, ean13StoreNumber, barcodeFor,
  previewCodes, SKU_BODY_ALPHABET, type CodeSettings,
} from './codeSettings';
import { generateSkuCandidate, SKU_ALPHABET } from './barcode';

const S = (o: Partial<CodeSettings> = {}): CodeSettings => ({ ...DEFAULT_CODE_SETTINGS, ...o });

describe('normalizeCodeSettings', () => {
  it('turns any junk into the defaults (the pre-conventions behaviour)', () => {
    for (const junk of [undefined, null, 0, 'ACD', [], true, { skuPrefix: 42 }]) {
      const n = normalizeCodeSettings(junk);
      expect(n.skuScheme).toBe('random');
      expect(n.barcodeMode).toBe('sku');
      expect(n.autoAssign).toBe('on_labels');
      expect(n.skuSeparator).toBe('-');
    }
    expect(normalizeCodeSettings(undefined)).toEqual(DEFAULT_CODE_SETTINGS);
  });

  it('drops unknown enum values and keeps known ones', () => {
    const n = normalizeCodeSettings({
      skuScheme: 'sequential', barcodeMode: 'ean13_store', autoAssign: 'on_save',
      skuSeparator: '', categoryCode: true, ean13Prefix: '27', sequenceDigits: 6,
    });
    expect(n).toEqual({
      skuPrefix: 'ACD', skuSeparator: '', skuScheme: 'sequential', sequenceDigits: 6,
      categoryCode: true, barcodeMode: 'ean13_store', ean13Prefix: '27', autoAssign: 'on_save',
    });
    const bad = normalizeCodeSettings({ skuScheme: 'uuid', barcodeMode: 'qr', autoAssign: 'always', skuSeparator: '/', categoryCode: 'yes' });
    expect(bad.skuScheme).toBe('random');
    expect(bad.barcodeMode).toBe('sku');
    expect(bad.autoAssign).toBe('on_labels');
    expect(bad.skuSeparator).toBe('-');
    expect(bad.categoryCode).toBe(false);     // only a real `true` turns it on
  });

  it('clamps sequence digits to 4 to 8 and defaults a non-integer', () => {
    expect(normalizeCodeSettings({ sequenceDigits: 2 }).sequenceDigits).toBe(4);
    expect(normalizeCodeSettings({ sequenceDigits: 99 }).sequenceDigits).toBe(8);
    expect(normalizeCodeSettings({ sequenceDigits: 5.5 }).sequenceDigits).toBe(5);
    expect(normalizeCodeSettings({ sequenceDigits: 'seven' }).sequenceDigits).toBe(5);
  });
});

describe('prefix rules', () => {
  it('upper-cases, strips non-alphanumerics and truncates to 8', () => {
    expect(normalizeSkuPrefix('shop')).toBe('SHOP');
    expect(normalizeSkuPrefix(' c&d-vin ')).toBe('CDVIN');
    expect(normalizeSkuPrefix('ABCDEFGHIJ')).toBe('ABCDEFGH');
    expect(normalizeSkuPrefix('7')).toBe('7');
  });

  it('falls back to ACD when nothing usable is left', () => {
    expect(normalizeSkuPrefix('')).toBe('ACD');
    expect(normalizeSkuPrefix('---')).toBe('ACD');
    expect(normalizeSkuPrefix(null)).toBe('ACD');
  });

  it('accepts only 20 to 29 as the in-store EAN prefix', () => {
    expect(normalizeEan13Prefix('29')).toBe('29');
    expect(normalizeEan13Prefix(' 2 4 ')).toBe('24');
    expect(normalizeEan13Prefix('30')).toBe('20');
    expect(normalizeEan13Prefix('19')).toBe('20');
    expect(normalizeEan13Prefix('2')).toBe('20');
  });

  it('validateCodeSettings names each bad field', () => {
    expect(validateCodeSettings(DEFAULT_CODE_SETTINGS)).toEqual([]);
    const errs = validateCodeSettings(S({
      skuPrefix: 'ab-c', skuScheme: 'sequential', sequenceDigits: 3,
      barcodeMode: 'ean13_store', ean13Prefix: '31',
    }));
    expect(errs.map(e => e.field)).toEqual(['skuPrefix', 'sequenceDigits', 'ean13Prefix']);
    expect(validateCodeSettings(S({ skuPrefix: 'ABCDEFGHI' }))[0].field).toBe('skuPrefix');
    // Digits are only checked for the scheme that reads them.
    expect(validateCodeSettings(S({ sequenceDigits: 3 }))).toEqual([]);
  });
});

describe('formatSku', () => {
  it('default: ACD-<body>', () => {
    expect(formatSku(DEFAULT_CODE_SETTINGS, { body: '7K3Q9M' })).toBe('ACD-7K3Q9M');
  });

  it('separator empty', () => {
    expect(formatSku(S({ skuSeparator: '' }), { body: '7K3Q9M' })).toBe('ACD7K3Q9M');
  });

  it('category code on, with and without a category', () => {
    const s = S({ categoryCode: true });
    expect(formatSku(s, { body: '7K3Q9M', category: 'Denim jackets' })).toBe('ACD-DEN-7K3Q9M');
    expect(formatSku(s, { body: '7K3Q9M', category: null })).toBe('ACD-7K3Q9M');
    expect(formatSku(s, { body: '7K3Q9M', category: '123' })).toBe('ACD-7K3Q9M');
    expect(formatSku(S({ categoryCode: true, skuSeparator: '' }), { body: '7K3Q9M', category: 'Tees' })).toBe('ACDTEE7K3Q9M');
  });

  it('category code off ignores the category', () => {
    expect(formatSku(DEFAULT_CODE_SETTINGS, { body: '7K3Q9M', category: 'Tees' })).toBe('ACD-7K3Q9M');
  });

  it('sequential padding', () => {
    const s = S({ skuPrefix: 'SHOP', skuScheme: 'sequential', sequenceDigits: 5 });
    expect(sequentialBody(s, 12)).toBe('00012');
    expect(formatSku(s, { body: sequentialBody(s, 12) })).toBe('SHOP-00012');
    expect(sequentialBody(S({ sequenceDigits: 4 }), 123456)).toBe('123456');   // never truncated
    expect(padSequence(-3, 4)).toBe('0000');
    expect(padSequence(7.9, 4)).toBe('0007');
    const cat = S({ skuScheme: 'sequential', sequenceDigits: 6, categoryCode: true });
    expect(formatSku(cat, { body: sequentialBody(cat, 1), category: 'T-shirts' })).toBe('ACD-TSH-000001');
  });

  it('random body from the shared alphabet', () => {
    expect(SKU_BODY_ALPHABET).toBe(SKU_ALPHABET);
    const sku = formatSku(S({ skuPrefix: 'XY' }), { body: generateSkuCandidate().slice(4) });
    expect(sku).toMatch(/^XY-[0-9A-HJKMNP-TV-Z]{6}$/);
  });

  it('categoryCodeFor', () => {
    expect(categoryCodeFor('Tees')).toBe('TEE');
    expect(categoryCodeFor('Denim jackets')).toBe('DEN');
    expect(categoryCodeFor('T-shirts')).toBe('TSH');
    expect(categoryCodeFor('')).toBe('');
    expect(categoryCodeFor(undefined)).toBe('');
  });
});

describe('generatedSkuPattern', () => {
  it('accepts what the default convention generates and rejects manufacturer SKUs', () => {
    const re = generatedSkuPattern(DEFAULT_CODE_SETTINGS);
    for (let i = 0; i < 50; i++) expect(re.test(generateSkuCandidate())).toBe(true);
    for (const foreign of ['ACD-7H2K9I', 'ACD-7H2K9', 'ACD-7H2K9MM', 'XYZ-7H2K9M', 'acd-7h2k9m', 'ACD7H2K9M', 'LEVIS-501-0115']) {
      expect(re.test(foreign), foreign).toBe(false);
    }
  });

  it('sequential: at least sequenceDigits digits, nothing else', () => {
    const s = S({ skuPrefix: 'SHOP', skuScheme: 'sequential', sequenceDigits: 5 });
    const re = generatedSkuPattern(s);
    expect(re.test(formatSku(s, { body: sequentialBody(s, 1) }))).toBe(true);
    expect(re.test(formatSku(s, { body: sequentialBody(s, 1234567) }))).toBe(true);
    expect(re.test('SHOP-0001')).toBe(false);
    expect(re.test('SHOP-0001A')).toBe(false);
    expect(re.test('SHOP-00O12')).toBe(false);
  });

  it('category code optional segment, and no separator', () => {
    const s = S({ categoryCode: true });
    const re = generatedSkuPattern(s);
    expect(re.test(formatSku(s, { body: '7K3Q9M', category: 'Tees' }))).toBe(true);
    expect(re.test(formatSku(s, { body: '7K3Q9M', category: null }))).toBe(true);
    expect(re.test('ACD-TOOLONG-7K3Q9M')).toBe(false);
    const n = S({ skuSeparator: '', skuScheme: 'sequential' });
    expect(generatedSkuPattern(n).test(formatSku(n, { body: sequentialBody(n, 42) }))).toBe(true);
    expect(generatedSkuPattern(n).test('ACD-00042')).toBe(false);
  });

  it('escapes a prefix that a regex would misread', () => {
    // A normalised prefix is A-Z0-9 only, but the pattern must not depend on that.
    const re = generatedSkuPattern(S({ skuPrefix: 'A.C' }));
    expect(re.test('A.C-7K3Q9M')).toBe(true);
    expect(re.test('ABC-7K3Q9M')).toBe(false);
  });
});

describe('EAN-13 numbers', () => {
  it('check digits match published examples', () => {
    expect(ean13CheckDigit('400638133393')).toBe('1');
    expect(ean13CheckDigit('978030640615')).toBe('7');
    expect(ean13CheckDigit('590123412345')).toBe('7');
    for (const ok of ['4006381333931', '9780306406157', '5901234123457']) expect(isValidEan13(ok)).toBe(true);
  });

  it('rejects a wrong check digit and the wrong length', () => {
    expect(isValidEan13('4006381333932')).toBe(false);
    expect(isValidEan13('400638133393')).toBe(false);
    expect(isValidEan13('40063813339311')).toBe(false);
    expect(isValidEan13('400638133393A')).toBe(false);
    expect(() => ean13CheckDigit('12345')).toThrow();
  });

  it('a store number always starts 20 to 29 and validates', () => {
    for (const prefix of ['20', '21', '25', '29', 'junk', '30']) {
      for (const n of [0, 1, 12, 99999, 1234567890]) {
        const code = ean13StoreNumber(S({ ean13Prefix: prefix }), n);
        expect(code, `${prefix}/${n}`).toMatch(/^2[0-9]\d{11}$/);
        expect(isValidEan13(code)).toBe(true);
      }
    }
    expect(ean13StoreNumber(S({ ean13Prefix: '24' }), 12).slice(0, 12)).toBe('240000000012');
  });

  it('refuses a counter wider than 10 digits rather than truncating it', () => {
    expect(() => ean13StoreNumber(DEFAULT_CODE_SETTINGS, 12345678901)).toThrow();
  });
});

describe('barcodeFor', () => {
  it('sku mode mirrors the SKU', () => {
    expect(barcodeFor(DEFAULT_CODE_SETTINGS, 'ACD-7K3Q9M')).toBe('ACD-7K3Q9M');
    expect(barcodeFor(DEFAULT_CODE_SETTINGS, 'ACD-7K3Q9M', 5)).toBe('ACD-7K3Q9M');
  });

  it('ean13_store needs a counter and returns a valid in-store EAN', () => {
    const s = S({ barcodeMode: 'ean13_store', ean13Prefix: '21' });
    expect(barcodeFor(s, 'ACD-7K3Q9M')).toBeUndefined();
    const code = barcodeFor(s, 'ACD-7K3Q9M', 7)!;
    expect(code.startsWith('210000000007')).toBe(true);
    expect(isValidEan13(code)).toBe(true);
  });

  it('manual never writes', () => {
    expect(barcodeFor(S({ barcodeMode: 'manual' }), 'ACD-7K3Q9M', 7)).toBeUndefined();
  });
});

describe('previewCodes', () => {
  it('default', () => {
    expect(previewCodes(DEFAULT_CODE_SETTINGS)).toEqual({ sku: 'ACD-7K3Q9M', barcode: 'ACD-7K3Q9M' });
  });

  it('sequential with category code and an in-store EAN', () => {
    const s = S({ skuPrefix: 'SHOP', skuScheme: 'sequential', categoryCode: true, barcodeMode: 'ean13_store' });
    const p = previewCodes(s, 'Denim jackets');
    expect(p.sku).toBe('SHOP-DEN-00012');
    expect(isValidEan13(p.barcode)).toBe(true);
    expect(p.barcode.startsWith('200000000012')).toBe(true);
  });

  it('manual says the person types it', () => {
    expect(previewCodes(S({ barcodeMode: 'manual' })).barcode).toBe('typed by you');
  });
});
