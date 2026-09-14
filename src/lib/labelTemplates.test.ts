import { describe, it, expect } from 'vitest';
import { LABEL_TEMPLATES, usableWidthInches, type LabelTemplate } from './labelTemplates';
import { encodeCode128 } from './barcode';

const inches = (v: string) => parseFloat(v);

/**
 * Label geometry is the one thing in this feature you cannot check by reading
 * the screen: a template that is a tenth of an inch too wide looks fine in the
 * preview and comes out of the printer as a stack of ruined Avery sheets. These
 * assert the arithmetic that the CSS grid then trusts.
 */
describe('LABEL_TEMPLATES', () => {
  it('has unique ids and the three stocks the brief named', () => {
    expect(new Set(LABEL_TEMPLATES.map(t => t.id)).size).toBe(LABEL_TEMPLATES.length);
    expect(LABEL_TEMPLATES.map(t => t.id)).toEqual(['sheet-4x2', 'avery-5160', 'thermal-2x125']);
  });

  it('every dimension is a positive inch measurement', () => {
    for (const t of LABEL_TEMPLATES) {
      for (const v of [t.page.width, t.page.height, t.label.width, t.label.height]) {
        expect(v, `${t.id}: ${v}`).toMatch(/^[\d.]+in$/);
        expect(inches(v)).toBeGreaterThan(0);
      }
      expect(t.columns).toBeGreaterThanOrEqual(1);
      expect(t.moduleWidth).toBeGreaterThanOrEqual(1);
      expect(t.barHeight).toBeGreaterThan(0);
    }
  });

  it('a full row of labels plus its gutters FITS the printable width', () => {
    for (const t of LABEL_TEMPLATES) {
      const row = inches(t.label.width) * t.columns + inches(t.gap.x) * (t.columns - 1);
      // Within a thousandth of an inch — floating point, not slack.
      expect(row, `${t.id} row is ${row}in`).toBeLessThanOrEqual(usableWidthInches(t) + 0.001);
    }
  });

  it('a label is never taller than its own page', () => {
    for (const t of LABEL_TEMPLATES) {
      expect(inches(t.label.height), t.id).toBeLessThanOrEqual(inches(t.page.height));
    }
  });

  it('matches the real stationery it names', () => {
    const avery = LABEL_TEMPLATES.find(t => t.id === 'avery-5160')!;
    expect(avery.label).toEqual({ width: '2.625in', height: '1in' });
    expect(avery.columns).toBe(3);   // 5160 is 3 across × 10 down = 30-up
    const thermal = LABEL_TEMPLATES.find(t => t.id === 'thermal-2x125')!;
    expect(thermal.page.width).toBe('2.25in');
    expect(thermal.columns).toBe(1); // roll printers are one label per page
  });

  it("a generated SKU's barcode fits the narrowest label at that template's module width", () => {
    // ACD- plus six characters: 11 data symbols in subset B, plus start, check
    // and the 13-module stop.
    const enc = encodeCode128('ACD-7H2K9M');
    for (const t of LABEL_TEMPLATES) {
      const widthPx = (enc.modules + 20) * t.moduleWidth;   // + the 2×10 quiet zone
      // Labels are laid out in CSS inches; 96 CSS px = 1in.
      const widthIn = widthPx / 96;
      expect(widthIn, `${t.id}: barcode ${widthIn.toFixed(2)}in`)
        .toBeLessThan(inches(t.label.width));
    }
  });
});

describe('usableWidthInches', () => {
  it('subtracts a one-value margin from both sides', () => {
    const t = { page: { width: '8.5in', height: '11in', margin: '0.5in' } } as LabelTemplate;
    expect(usableWidthInches(t)).toBeCloseTo(7.5, 5);
  });

  it('reads the INLINE half of a two-value margin shorthand', () => {
    // "0.5in 0.19in" is block then inline — the horizontal one is the second.
    const t = { page: { width: '8.5in', height: '11in', margin: '0.5in 0.19in' } } as LabelTemplate;
    expect(usableWidthInches(t)).toBeCloseTo(8.12, 5);
  });
});
