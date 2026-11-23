/* ── The landing demo's pipeline: the real engine, on sample inputs ─────────
   NOT a mock. Every value LandingDemo shows comes out of the same pure modules
   Step 3 and Step 4 run (AGENTS.md section 10):

     1. lib/voiceGrammar    parseVoiceChunk + flushVoiceState turn the transcript
                            into field writes (the live dictation path).
     2. lib/applyPresetToGroup  applyPresetDirectly fills the gaps from the
                            category preset (voice values always win).
     3. lib/textAIService   generateProductDescription re-extracts the
                            transcript and runs the template engine for the
                            title and description. It is rule-based and local.
     4. lib/csvExport       buildShopifyCsvRows builds the export row.

   If a sample needs a value the engine reads (a price, a vendor), it goes in
   the SAMPLE, never in hard-coded output text.

   WHY EVERY COMMAND ENDS IN "period". The live grammar parses the run-on form
   ("brand nike size large ... chest 24 length 28") correctly, but the
   transcript re-parse inside generateProductDescription (extractFieldsFromVoice)
   does not, and its values win the merge: without periods "chest 24 length 28"
   came back as width 24 and length 24, "waist 32 inseam 30" as 32x32, and the
   material line swallowed the rest of the sentence. The samples use the
   documented period boundary so the demo shows the engine working as intended;
   the run-on gap is an engine issue, not something to paper over here. This module is what pulls
   textAIService (about 2000 lines) into the landing page, which is why the
   component that uses it is lazy-loaded. */

import type { ClothingItem } from '../../App';
import type { CategoryPreset } from '../../lib/categoryPresets';
import type { DescriptionSettings } from '../../lib/descriptionSettings';
import { applyPresetDirectly } from '../../lib/applyPresetToGroup';
import { buildShopifyCsvRows, SHOPIFY_CSV_HEADERS } from '../../lib/csvExport';
import { generateProductDescription } from '../../lib/textAIService';
import {
  EMPTY_VOICE_STATE,
  FIELD_TO_VOICE_LABEL,
  flushVoiceState,
  parseVoiceChunk,
  scanFieldTitles,
} from '../../lib/voiceGrammar';

export interface DemoSample {
  id: string;
  /** Chip label and placeholder tile text. */
  name: string;
  /** Step 2 category the preset is applied under. */
  categoryName: string;
  /** A real-shape category preset, built inline (no network). */
  preset: CategoryPreset;
  /** A dictation transcript in the real grammar. */
  transcript: string;
  /** The seller name the CSV Vendor column carries. */
  vendorName: string;
}

/**
 * The sample shop's description format: the same per-workspace settings a shop
 * edits in Settings (lib/descriptionSettings). The demo passes them so the
 * listing reads like a configured shop, not like the factory defaults.
 */
export const DEMO_DESCRIPTION_SETTINGS: Partial<DescriptionSettings> = {
  washingLine: 'Washed before it was photographed.',
  closingLine: 'Bundle two or more and save.',
  includeHashtags: true,
  disclaimerLines: [
    '* Major flaws are noted. Light wear from age is part of the piece.',
    '* Ships next business day.',
  ],
};

const NOW = '2026-11-01T00:00:00.000Z';

/** The preset fields every sample shares; each sample overrides the rest. */
const basePreset = (p: Partial<CategoryPreset> & Pick<CategoryPreset, 'id' | 'category_name' | 'display_name'>): CategoryPreset => ({
  user_id: 'demo',
  default_weight_unit: 'g',
  requires_shipping: true,
  is_active: true,
  is_default: true,
  measurement_template: {
    width: true, length: true, sleeve: false, shoulder: false,
    waist: false, inseam: false, rise: false,
  },
  created_at: NOW,
  updated_at: NOW,
  ...p,
});

export const DEMO_SAMPLES: DemoSample[] = [
  {
    id: 'nike-hoodie',
    name: 'Vintage Nike hoodie',
    categoryName: 'Hoodies',
    vendorName: 'Your Shop',
    preset: basePreset({
      id: 'demo-hoodies',
      category_name: 'Hoodies',
      display_name: 'Hoodies',
      product_type: 'Hoodie',
      seo_title_template: '{brand} {color} {category} {size}',
      default_weight_value: '650',
      suggested_price_min: 48,
      default_tags: ['vintage', 'hoodie'],
      typical_condition: 'Good',
      measurement_template: {
        width: true, length: true, sleeve: true, shoulder: false,
        waist: false, inseam: false, rise: false,
      },
    }),
    transcript:
      'brand Nike period size large period color grey period condition good period era 90s period material cotton period width 24 period length 28 period description super soft boxy fit period',
  },
  {
    id: 'carhartt-detroit',
    name: 'Carhartt Detroit jacket',
    categoryName: 'Jackets',
    vendorName: 'Your Shop',
    preset: basePreset({
      id: 'demo-jackets',
      category_name: 'Jackets',
      display_name: 'Jackets',
      product_type: 'Jacket',
      seo_title_template: '{brand} {model} {color} {category} {size}',
      model_name: 'Detroit',
      default_weight_value: '1400',
      suggested_price_min: 145,
      default_material: 'Cotton duck',
      default_tags: ['vintage', 'workwear', 'jacket'],
      measurement_template: {
        width: true, length: true, sleeve: true, shoulder: true,
        waist: false, inseam: false, rise: false,
      },
    }),
    transcript:
      'brand Carhartt period size medium period color brown period condition great period era 80s period width 23 period length 25 period description blanket lined with a corduroy collar and light fading on the cuffs period',
  },
  {
    id: 'levis-501',
    name: "Levi's 501",
    categoryName: 'Jeans',
    vendorName: 'Your Shop',
    preset: basePreset({
      id: 'demo-jeans',
      category_name: 'Jeans',
      display_name: 'Jeans',
      product_type: 'Jeans',
      seo_title_template: '{brand} {model} {category} {size}',
      model_name: '501',
      default_weight_value: '700',
      suggested_price_min: 68,
      default_material: 'Denim',
      default_tags: ['vintage', 'denim', 'jeans'],
      measurement_template: {
        width: false, length: false, sleeve: false, shoulder: false,
        waist: true, inseam: true, rise: true,
      },
    }),
    transcript:
      "brand Levi's period color blue period condition good period era 90s period waist 32 period inseam 30 period description straight leg button fly with an even fade period",
  },
];

/* ── Step 1: the transcript, split into marked field titles and plain text ── */

export interface TranscriptPart {
  text: string;
  /** Present when this span is a recognised field title. */
  field?: string;
}

/** Splits the transcript with the grammar's own field-title scanner. */
export function markTranscript(transcript: string): TranscriptPart[] {
  const parts: TranscriptPart[] = [];
  let at = 0;
  for (const hit of scanFieldTitles(transcript)) {
    if (hit.pos > at) parts.push({ text: transcript.slice(at, hit.pos) });
    parts.push({ text: transcript.slice(hit.pos, hit.end), field: hit.field });
    at = hit.end;
  }
  if (at < transcript.length) parts.push({ text: transcript.slice(at) });
  return parts;
}

/* ── Step 2: parsed fields ─────────────────────────────────────────────── */

export interface DemoField {
  /** The grammar's field key (`brand`, `meas_chest`, `customDescription`). */
  key: string;
  /** Sentence-case label for the cell. */
  label: string;
  value: string;
  /** Where the value came from: dictated, or filled by the preset. */
  source: 'voice' | 'preset';
}

const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const LABELS: Record<string, string> = {
  customDescription: 'Description',
  productType: 'Type',
  price: 'Price ($)',
  modelName: 'Model',
};

const labelFor = (key: string) =>
  LABELS[key] ?? sentence(FIELD_TO_VOICE_LABEL[key] ?? key);

/** Runs the live dictation grammar over the transcript, as one utterance plus Stop. */
export function parseTranscript(transcript: string): Record<string, string> {
  const first = parseVoiceChunk(transcript, EMPTY_VOICE_STATE, { newUtterance: true });
  const last = flushVoiceState(first.state);
  const out: Record<string, string> = {};
  for (const w of [...first.writes, ...last.writes]) out[w.field] = w.value;
  return out;
}

/** Grammar writes onto an item, the way Step 3's field writer maps them. */
function itemFromWrites(id: string, writes: Record<string, string>): ClothingItem {
  const item = { id, preview: '', productGroup: id } as unknown as ClothingItem;
  const measurements: Record<string, string> = {};
  for (const [field, value] of Object.entries(writes)) {
    if (field.startsWith('meas_')) measurements[field.slice(5)] = value;
    else if (field === 'price') {
      const n = parseFloat(value.replace(/[^0-9.]/g, ''));
      if (!isNaN(n)) item.price = n;
    } else (item as unknown as Record<string, unknown>)[field] = value;
  }
  if (Object.keys(measurements).length) item.measurements = measurements;
  return item;
}

/* ── The whole run ─────────────────────────────────────────────────────── */

/** LandingDemo's staged reveal: each step appears this long after the last. */
export const STEP_DELAY_MS = 250;

/** The columns step 4 shows, in this order. */
export const DEMO_CSV_COLUMNS = ['Handle', 'Title', 'Vendor', 'Type', 'Tags', 'Variant Price'] as const;

export interface DemoResult {
  transcript: TranscriptPart[];
  fields: DemoField[];
  title: string;
  description: string;
  csv: { column: string; value: string }[];
}

/** The preset-owned values worth showing in step 2, when the preset filled them. */
const PRESET_SHOWN: Array<keyof ClothingItem> = ['productType', 'modelName', 'material', 'condition', 'price'];

export async function runDemo(sample: DemoSample): Promise<DemoResult> {
  const writes = parseTranscript(sample.transcript);
  const dictated = itemFromWrites(sample.id, writes);
  const [item] = applyPresetDirectly([dictated], sample.categoryName, sample.preset);

  const fields: DemoField[] = Object.entries(writes).map(([key, value]) => ({
    key, label: labelFor(key), value, source: 'voice',
  }));
  for (const key of PRESET_SHOWN) {
    const v = item[key];
    if (v === undefined || v === null || v === '' || dictated[key] !== undefined) continue;
    fields.push({ key, label: labelFor(String(key)), value: String(v), source: 'preset' });
  }

  // The same context Step 3's Regenerate passes (ProductDescriptionGenerator).
  const generated = await generateProductDescription({
    voiceDescription: sample.transcript,
    title: item.seoTitle || '',
    brand: item.brand || '',
    color: item.color || '',
    size: item.size || '',
    material: item.material || '',
    condition: item.condition || undefined,
    era: item.era || '',
    style: item.style || '',
    gender: item.gender || '',
    modelName: item.modelName || '',
    type: item.productType || '',
    category: item._presetData?.productType || item.category || '',
    presetTags: sample.preset.default_tags || [],
    customDescription: item.customDescription || '',
    measurements: item.measurements || undefined,
    flaws: item.flaws || '',
    care: item.care || '',
    price: item.price,
    descriptionSettings: DEMO_DESCRIPTION_SETTINGS,
  });

  const title = generated.suggestedTitle || item.seoTitle || '';
  const listed: ClothingItem = {
    ...item,
    seoTitle: title,
    generatedDescription: generated.description,
    tags: generated.suggestedTags?.length ? generated.suggestedTags : item.tags,
  };
  const [row] = buildShopifyCsvRows([{ ...listed, imageUrls: [] }], undefined, sample.vendorName);
  const csv = DEMO_CSV_COLUMNS.map((column) => ({
    column,
    value: row[SHOPIFY_CSV_HEADERS.indexOf(column)] ?? '',
  }));

  return { transcript: markTranscript(sample.transcript), fields, title, description: generated.description, csv };
}
