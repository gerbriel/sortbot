/**
 * labelTemplates — the physical stationery LabelPrintView can print onto.
 *
 * A separate module from the component for two reasons: the geometry is data,
 * not UI (and is unit-tested as such — a label wider than its page is a stack
 * of wasted Avery sheets discovered at the printer), and exporting a constant
 * from a component file breaks Vite's Fast Refresh.
 *
 * Every dimension is a CSS length in INCHES, because that is how label stock is
 * sold and how `@page` wants it. The component turns these into custom
 * properties so one source drives both the on-screen sheet preview and the
 * print stylesheet — a preview that looks wrong IS wrong.
 */

export interface LabelTemplate {
  id: string;
  name: string;
  /** What the user will recognise it by in a stationery drawer. */
  note: string;
  /** Page size for the `@page` rule. */
  page: { width: string; height: string; margin: string };
  /** Grid of labels on that page. */
  columns: number;
  /** One label's box. */
  label: { width: string; height: string };
  /** Column/row gutters between labels. */
  gap: { x: string; y: string };
  /** Module width (px) for the Code 128 bars — narrower stock needs thinner
   *  bars, and a barcode that overflows its label does not scan. */
  moduleWidth: number;
  barHeight: number;
}

export const LABEL_TEMPLATES: readonly LabelTemplate[] = [
  {
    id: 'sheet-4x2',
    // 2 across × 5 down. The two columns BUTT TOGETHER (8in of label across an
    // 8.5in page leaves exactly 0.25in each side) — an invented gutter here
    // pushes the right-hand column off the sheet, which is what the geometry
    // test in labelTemplates.test.ts exists to catch.
    name: '4" × 2" — 10 per sheet',
    note: 'Letter sheet, 2 across × 5 down (Avery 5163 / 8163)',
    page: { width: '8.5in', height: '11in', margin: '0.5in 0.25in' },
    columns: 2,
    label: { width: '4in', height: '2in' },
    gap: { x: '0in', y: '0in' },
    moduleWidth: 2,
    barHeight: 44,
  },
  {
    id: 'avery-5160',
    // 3 × 2.625in of label + 2 × 0.125in gutters = 8.125in, inside 8.5in less
    // two 0.1875in margins. Avery's own spec, to the sixteenth of an inch.
    name: 'Avery 5160 — 30 per sheet',
    note: 'Letter sheet, 3 across × 10 down, 2.625" × 1"',
    page: { width: '8.5in', height: '11in', margin: '0.5in 0.1875in' },
    columns: 3,
    label: { width: '2.625in', height: '1in' },
    gap: { x: '0.125in', y: '0in' },
    moduleWidth: 1,
    barHeight: 22,
  },
  {
    id: 'thermal-2x125',
    name: '2.25" × 1.25" thermal',
    note: 'One label per page — Dymo / Zebra roll printers',
    page: { width: '2.25in', height: '1.25in', margin: '0.06in' },
    columns: 1,
    label: { width: '2.13in', height: '1.13in' },
    gap: { x: '0in', y: '0in' },
    moduleWidth: 1,
    barHeight: 26,
  },
];

/** Page area actually available to labels, after the page margin. Exported for
 *  the geometry test; the component lays out with CSS, not with this. */
export function usableWidthInches(t: LabelTemplate): number {
  const inches = (v: string) => parseFloat(v) || 0;
  const page = inches(t.page.width);
  // `margin` is CSS shorthand: one value = all sides, two = block then inline.
  const parts = t.page.margin.trim().split(/\s+/).map(inches);
  const inline = parts.length === 1 ? parts[0] : parts[1];
  return page - inline * 2;
}
