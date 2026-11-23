import { describe, it, expect } from 'vitest';
import {
  LABEL_TEMPLATES, usableWidthInches, type LabelTemplate,
  normalizeLabelTemplates, allLabelTemplates, validateLabelTemplate,
  labelTemplateFromInput, labelTemplateToInput, labelTemplateFits, newLabelTemplateId,
  CUSTOM_LABEL_TEMPLATES_MAX, type LabelTemplateInput,
} from './labelTemplates';
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

// ── Custom stocks ───────────────────────────────────────────────────────────

const custom = (o: Partial<LabelTemplate> = {}): LabelTemplate => ({
  id: 'custom-abc123',
  name: '3" x 2" roll',
  note: 'Rollo',
  page: { width: '3in', height: '2in', margin: '0.05in' },
  columns: 1,
  label: { width: '2.9in', height: '1.9in' },
  gap: { x: '0in', y: '0in' },
  moduleWidth: 2,
  barHeight: 40,
  ...o,
});

const input = (o: Partial<LabelTemplateInput> = {}): LabelTemplateInput => ({
  name: 'Two up', pageWidth: 8.5, pageHeight: 11, marginBlock: 0.5, marginInline: 0.25,
  columns: 2, labelWidth: 4, labelHeight: 2, gapX: 0, gapY: 0, moduleWidth: 2, barHeight: 44, ...o,
});

describe('normalizeLabelTemplates', () => {
  it('keeps a well-formed stock and every built-in survives its own normaliser', () => {
    expect(normalizeLabelTemplates([custom()])).toEqual([{ ...custom(), page: { ...custom().page, margin: '0.05in 0.05in' } }]);
    const round = normalizeLabelTemplates([...LABEL_TEMPLATES]);
    expect(round.map(t => t.id)).toEqual(LABEL_TEMPLATES.map(t => t.id));
  });

  it('drops junk, entries without id or name, and other units', () => {
    const junk = [
      null, 'x', 42, [], {},
      custom({ id: '' }), custom({ name: '   ' }), custom({ id: 'has space' }),
      custom({ label: { width: '70mm', height: '1in' } }),
      custom({ page: { width: 'wide', height: '2in', margin: '0in' } }),
      custom({ page: { width: '3in', height: '2in', margin: '1in 2in 3in' } }),
      custom({ columns: Number.NaN }),
    ];
    expect(normalizeLabelTemplates(junk)).toEqual([]);
    expect(normalizeLabelTemplates('nope')).toEqual([]);
    expect(normalizeLabelTemplates(undefined)).toEqual([]);
  });

  it('clamps module width, bar height and columns into range', () => {
    const [t] = normalizeLabelTemplates([custom({ moduleWidth: 9, barHeight: 4 })]);
    expect(t.moduleWidth).toBe(3);
    expect(t.barHeight).toBe(16);
    const [u] = normalizeLabelTemplates([custom({ moduleWidth: 0, barHeight: 500 })]);
    expect(u.moduleWidth).toBe(1);
    expect(u.barHeight).toBe(80);
    const [w] = normalizeLabelTemplates([custom({ columns: 0 })]);
    expect(w.columns).toBe(1);
  });

  it('rejects a stock whose labels run off the page', () => {
    // 3 x 3in on an 8.5in page with 0.25in margins = 9in of label in 8in.
    const wide = custom({
      page: { width: '8.5in', height: '11in', margin: '0.5in 0.25in' },
      columns: 3, label: { width: '3in', height: '1in' },
    });
    expect(normalizeLabelTemplates([wide])).toEqual([]);
    const tall = custom({ label: { width: '2.9in', height: '1.95in' } });   // 2in page less 0.1in
    expect(normalizeLabelTemplates([tall])).toEqual([]);
    // Clamping columns 12 -> 6 can still not fit, and is then dropped, not shrunk.
    expect(normalizeLabelTemplates([custom({ columns: 12 })])).toEqual([]);
  });

  it('collapses duplicate ids (first wins) and caps the list', () => {
    const out = normalizeLabelTemplates([custom({ name: 'A' }), custom({ name: 'B' })]);
    expect(out.map(t => t.name)).toEqual(['A']);
    const many = Array.from({ length: 30 }, (_, i) => custom({ id: `c${i}` }));
    expect(normalizeLabelTemplates(many)).toHaveLength(CUSTOM_LABEL_TEMPLATES_MAX);
  });
});

describe('allLabelTemplates', () => {
  it('built-ins first, then custom, de-duplicated by id', () => {
    const shadow = custom({ id: 'avery-5160', name: 'Fake 5160' });
    const out = allLabelTemplates([custom(), shadow, custom()]);
    expect(out.map(t => t.id)).toEqual(['sheet-4x2', 'avery-5160', 'thermal-2x125', 'custom-abc123']);
    expect(out.find(t => t.id === 'avery-5160')!.name).not.toBe('Fake 5160');
    expect(allLabelTemplates([])).toEqual([...LABEL_TEMPLATES]);
  });
});

describe('validateLabelTemplate', () => {
  it('accepts every built-in as form input', () => {
    for (const t of LABEL_TEMPLATES) expect(validateLabelTemplate(labelTemplateToInput(t)), t.id).toEqual([]);
  });

  it('names the field that is out of range', () => {
    const errs = validateLabelTemplate(input({
      name: ' ', columns: 7, moduleWidth: 1.5, barHeight: 10, pageWidth: 30, gapX: -1,
    }));
    expect(errs.map(e => e.field).sort()).toEqual(['barHeight', 'columns', 'gapX', 'moduleWidth', 'name', 'pageWidth'].sort());
    expect(validateLabelTemplate(input({ labelWidth: Number.NaN }))[0].field).toBe('labelWidth');
  });

  it('reports a row that does not fit, in inches', () => {
    const errs = validateLabelTemplate(input({ columns: 3, labelWidth: 3 }));
    expect(errs).toHaveLength(1);
    expect(errs[0].field).toBe('labelWidth');
    expect(errs[0].message).toContain('9"');
    expect(errs[0].message).toContain('8"');
    expect(validateLabelTemplate(input({ labelHeight: 10.5 }))[0].field).toBe('labelHeight');
  });

  it('a validated input builds a template that fits and survives normalisation', () => {
    const t = labelTemplateFromInput(input({ name: '  Two up  ' }), newLabelTemplateId());
    expect(t.id).toMatch(/^custom-[0-9a-z]{6}$/);
    expect(t.name).toBe('Two up');
    expect(t.page).toEqual({ width: '8.5in', height: '11in', margin: '0.5in 0.25in' });
    expect(labelTemplateFits(t)).toBe(true);
    expect(normalizeLabelTemplates([t])).toEqual([t]);
    expect(labelTemplateToInput(t)).toMatchObject(input({ id: t.id, name: 'Two up', note: '' }));
  });
});
