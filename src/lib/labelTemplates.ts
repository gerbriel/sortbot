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

// ── Custom stocks (a workspace's own label sizes) ──────────────────────────
//
// A workspace defines its own stock in Workspace settings; the list lives at
// `description_settings.labelTemplates` (JSONB, no migration), next to
// `codes`, and is NORMALISED on every read by `normalizeLabelTemplates`, the
// same way `platformPricing` and `background` are. A malformed entry is
// DROPPED, never repaired into a different stock: a "fixed" template that
// prints a tenth of an inch off is worse than one that is missing.
//
// The symbology is not part of a template. The label prints Code 128 or
// EAN-13 according to the workspace's `codes.barcodeMode` at render time, so
// one stock serves either convention.

/** Inclusive bounds for every number a custom template may carry. Exported so
 *  the settings form can put the same min/max on its inputs. */
export const LABEL_TEMPLATE_LIMITS = {
  pageWidth: { min: 0.5, max: 17 },
  pageHeight: { min: 0.5, max: 22 },
  margin: { min: 0, max: 2 },
  labelWidth: { min: 0.5, max: 17 },
  labelHeight: { min: 0.25, max: 22 },
  gap: { min: 0, max: 2 },
  columns: { min: 1, max: 6 },
  moduleWidth: { min: 1, max: 3 },
  barHeight: { min: 16, max: 80 },
} as const;

/** At most this many custom stocks per workspace. */
export const CUSTOM_LABEL_TEMPLATES_MAX = 20;
export const LABEL_TEMPLATE_NAME_MAX = 60;
export const LABEL_TEMPLATE_NOTE_MAX = 120;
const TEMPLATE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
/** Floating point, not slack: the same thousandth the geometry test allows. */
const FIT_EPSILON = 0.001;

/** What the settings form edits: plain numbers in inches. */
export interface LabelTemplateInput {
  /** Absent for a new stock; `newLabelTemplateId()` mints one on save. */
  id?: string;
  name: string;
  note?: string;
  pageWidth: number;
  pageHeight: number;
  /** Top and bottom page margin. */
  marginBlock: number;
  /** Left and right page margin. */
  marginInline: number;
  columns: number;
  labelWidth: number;
  labelHeight: number;
  gapX: number;
  gapY: number;
  moduleWidth: number;
  barHeight: number;
}

export type LabelTemplateFieldError = { field: keyof LabelTemplateInput; message: string };

/** "2.625in" / "2.625" / 2.625 -> 2.625. Anything in another unit -> NaN. */
function parseInches(raw: unknown): number {
  if (typeof raw === 'number') return raw;
  const s = String(raw ?? '').trim();
  if (!/^\d*\.?\d+(in)?$/.test(s)) return NaN;
  return parseFloat(s);
}

/** Round to a thousandth so stored values stay readable ("2.625in"). */
function inch(n: number): string {
  return `${Math.round(n * 1000) / 1000}in`;
}

function clamp(n: number, lim: { min: number; max: number }): number {
  return Math.min(lim.max, Math.max(lim.min, n));
}

/** The page margin shorthand as [block, inline]; null when unparseable. */
function parseMargin(raw: unknown): [number, number] | null {
  const parts = String(raw ?? '').trim().split(/\s+/).filter(Boolean).map(parseInches);
  if (parts.length < 1 || parts.length > 2 || parts.some(p => !Number.isFinite(p))) return null;
  return parts.length === 1 ? [parts[0], parts[0]] : [parts[0], parts[1]];
}

/** The page height left for labels after the block margins. */
function usableHeightInches(t: LabelTemplate): number {
  const m = parseMargin(t.page.margin);
  return parseInches(t.page.height) - (m ? m[0] * 2 : 0);
}

/** Width of one full row of labels plus its gutters. */
function rowWidthInches(t: LabelTemplate): number {
  return parseInches(t.label.width) * t.columns + parseInches(t.gap.x) * (t.columns - 1);
}

/** Does a row of labels fit the printable width, and one label the printable height? */
export function labelTemplateFits(t: LabelTemplate): boolean {
  return rowWidthInches(t) <= usableWidthInches(t) + FIT_EPSILON
    && parseInches(t.label.height) <= usableHeightInches(t) + FIT_EPSILON;
}

/** A template from the form's numbers. Pure; does not validate (call
 *  `validateLabelTemplate` first) and needs an id. */
export function labelTemplateFromInput(input: LabelTemplateInput, id: string): LabelTemplate {
  return {
    id,
    name: String(input.name ?? '').trim().slice(0, LABEL_TEMPLATE_NAME_MAX),
    note: String(input.note ?? '').trim().slice(0, LABEL_TEMPLATE_NOTE_MAX),
    page: {
      width: inch(input.pageWidth),
      height: inch(input.pageHeight),
      margin: `${inch(input.marginBlock)} ${inch(input.marginInline)}`,
    },
    columns: Math.round(input.columns),
    label: { width: inch(input.labelWidth), height: inch(input.labelHeight) },
    gap: { x: inch(input.gapX), y: inch(input.gapY) },
    moduleWidth: Math.round(input.moduleWidth),
    barHeight: Math.round(input.barHeight),
  };
}

/** The form's numbers for an existing template (built-in or custom), so
 *  "Start from Avery 5160" is one call. */
export function labelTemplateToInput(t: LabelTemplate): LabelTemplateInput {
  const m = parseMargin(t.page.margin) ?? [0, 0];
  return {
    id: t.id,
    name: t.name,
    note: t.note,
    pageWidth: parseInches(t.page.width),
    pageHeight: parseInches(t.page.height),
    marginBlock: m[0],
    marginInline: m[1],
    columns: t.columns,
    labelWidth: parseInches(t.label.width),
    labelHeight: parseInches(t.label.height),
    gapX: parseInches(t.gap.x),
    gapY: parseInches(t.gap.y),
    moduleWidth: t.moduleWidth,
    barHeight: t.barHeight,
  };
}

/** A fresh id for a custom stock. Never collides with a built-in (those have
 *  no `custom-` prefix). */
export function newLabelTemplateId(): string {
  const g = typeof globalThis.crypto?.getRandomValues === 'function' ? globalThis.crypto : null;
  let s = '';
  if (g) {
    const bytes = new Uint8Array(6);
    g.getRandomValues(bytes);
    for (const b of bytes) s += (b % 36).toString(36);
  } else {
    for (let i = 0; i < 6; i++) s += Math.floor(Math.random() * 36).toString(36);
  }
  return `custom-${s}`;
}

/** Field-level problems for the custom stock form. Empty array = valid. */
export function validateLabelTemplate(input: LabelTemplateInput): LabelTemplateFieldError[] {
  const out: LabelTemplateFieldError[] = [];
  const L = LABEL_TEMPLATE_LIMITS;
  const name = String(input.name ?? '').trim();
  if (!name) out.push({ field: 'name', message: 'Give the stock a name.' });
  else if (name.length > LABEL_TEMPLATE_NAME_MAX) {
    out.push({ field: 'name', message: `Name is at most ${LABEL_TEMPLATE_NAME_MAX} characters.` });
  }
  if (String(input.note ?? '').trim().length > LABEL_TEMPLATE_NOTE_MAX) {
    out.push({ field: 'note', message: `Note is at most ${LABEL_TEMPLATE_NOTE_MAX} characters.` });
  }
  if (input.id !== undefined && !TEMPLATE_ID_RE.test(input.id)) {
    out.push({ field: 'id', message: 'That stock has a malformed id.' });
  }

  const range = (field: keyof LabelTemplateInput, value: number, lim: { min: number; max: number }, what: string, integer = false) => {
    if (!Number.isFinite(value) || value < lim.min || value > lim.max || (integer && !Number.isInteger(value))) {
      const unit = integer ? '' : ' inches';
      out.push({ field, message: `${what} is ${lim.min} to ${lim.max}${unit}${integer ? ', a whole number' : ''}.` });
      return false;
    }
    return true;
  };
  const ok = [
    range('pageWidth', input.pageWidth, L.pageWidth, 'Page width'),
    range('pageHeight', input.pageHeight, L.pageHeight, 'Page height'),
    range('marginBlock', input.marginBlock, L.margin, 'Top and bottom margin'),
    range('marginInline', input.marginInline, L.margin, 'Side margin'),
    range('columns', input.columns, L.columns, 'Labels across', true),
    range('labelWidth', input.labelWidth, L.labelWidth, 'Label width'),
    range('labelHeight', input.labelHeight, L.labelHeight, 'Label height'),
    range('gapX', input.gapX, L.gap, 'Gap between columns'),
    range('gapY', input.gapY, L.gap, 'Gap between rows'),
    range('moduleWidth', input.moduleWidth, L.moduleWidth, 'Bar thickness', true),
    range('barHeight', input.barHeight, L.barHeight, 'Bar height', true),
  ].every(Boolean);
  if (!ok) return out;

  const t = labelTemplateFromInput(input, input.id ?? 'draft');
  const usableW = usableWidthInches(t);
  const row = rowWidthInches(t);
  if (row > usableW + FIT_EPSILON) {
    out.push({
      field: 'labelWidth',
      message: `${t.columns} across is ${Math.round(row * 1000) / 1000}" wide but the page leaves ${Math.round(usableW * 1000) / 1000}" between the margins.`,
    });
  }
  const usableH = usableHeightInches(t);
  if (input.labelHeight > usableH + FIT_EPSILON) {
    out.push({
      field: 'labelHeight',
      message: `A label is ${input.labelHeight}" tall but the page leaves ${Math.round(usableH * 1000) / 1000}" between the margins.`,
    });
  }
  return out;
}

/** One stored entry -> a template, or null to drop it. */
function normalizeOne(raw: unknown): LabelTemplate | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === 'string' ? r.id.trim() : '';
  const name = typeof r.name === 'string' ? r.name.trim().slice(0, LABEL_TEMPLATE_NAME_MAX) : '';
  if (!TEMPLATE_ID_RE.test(id) || !name) return null;

  const page = (r.page && typeof r.page === 'object' ? r.page : {}) as Record<string, unknown>;
  const label = (r.label && typeof r.label === 'object' ? r.label : {}) as Record<string, unknown>;
  const gap = (r.gap && typeof r.gap === 'object' ? r.gap : {}) as Record<string, unknown>;
  const margin = parseMargin(page.margin ?? '0in');
  const nums = {
    pageWidth: parseInches(page.width),
    pageHeight: parseInches(page.height),
    labelWidth: parseInches(label.width),
    labelHeight: parseInches(label.height),
    gapX: parseInches(gap.x ?? '0in'),
    gapY: parseInches(gap.y ?? '0in'),
    columns: Number(r.columns),
    moduleWidth: Number(r.moduleWidth),
    barHeight: Number(r.barHeight),
  };
  if (!margin || Object.values(nums).some(n => !Number.isFinite(n))) return null;

  const L = LABEL_TEMPLATE_LIMITS;
  const t = labelTemplateFromInput({
    name,
    note: typeof r.note === 'string' ? r.note : '',
    pageWidth: clamp(nums.pageWidth, L.pageWidth),
    pageHeight: clamp(nums.pageHeight, L.pageHeight),
    marginBlock: clamp(margin[0], L.margin),
    marginInline: clamp(margin[1], L.margin),
    columns: clamp(Math.round(nums.columns), L.columns),
    labelWidth: clamp(nums.labelWidth, L.labelWidth),
    labelHeight: clamp(nums.labelHeight, L.labelHeight),
    gapX: clamp(nums.gapX, L.gap),
    gapY: clamp(nums.gapY, L.gap),
    moduleWidth: clamp(Math.round(nums.moduleWidth), L.moduleWidth),
    barHeight: clamp(Math.round(nums.barHeight), L.barHeight),
  }, id);
  // Clamping can make a stock fit differently from what was saved; a stock
  // whose labels do not fit the page is dropped, never printed.
  return labelTemplateFits(t) ? t : null;
}

/** The workspace's custom stocks from the JSONB: malformed entries dropped,
 *  numbers clamped to LABEL_TEMPLATE_LIMITS, anything that does not fit its
 *  page rejected, duplicate ids collapsed (first wins), at most
 *  CUSTOM_LABEL_TEMPLATES_MAX kept. */
export function normalizeLabelTemplates(raw: unknown): LabelTemplate[] {
  if (!Array.isArray(raw)) return [];
  const out: LabelTemplate[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    const t = normalizeOne(entry);
    if (!t || seen.has(t.id)) continue;
    seen.add(t.id);
    out.push(t);
    if (out.length >= CUSTOM_LABEL_TEMPLATES_MAX) break;
  }
  return out;
}

/** Every stock the print sheet offers: the built-ins first, then the
 *  workspace's own, de-duplicated by id (a custom stock can never shadow a
 *  built-in). */
export function allLabelTemplates(custom: readonly LabelTemplate[]): LabelTemplate[] {
  const out: LabelTemplate[] = [];
  const seen = new Set<string>();
  for (const t of [...LABEL_TEMPLATES, ...custom]) {
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    out.push(t);
  }
  return out;
}
