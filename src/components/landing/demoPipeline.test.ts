import { describe, it, expect } from 'vitest';
import { DEMO_SAMPLES, markTranscript, parseTranscript, runDemo } from './demoPipeline';

describe('demoPipeline (the real engine on the sample inputs)', () => {
  it.each(DEMO_SAMPLES.map((s) => [s.name, s] as const))('%s: produces a title, description and CSV row', async (_name, sample) => {
    const r = await runDemo(sample);
    expect(r.title.trim().length).toBeGreaterThan(10);
    expect(r.description.trim().length).toBeGreaterThan(r.title.length);
    // The description opens with the generated title (the template engine's opener line).
    expect(r.description.startsWith(r.title)).toBe(true);
    const csv = Object.fromEntries(r.csv.map((c) => [c.column, c.value]));
    expect(Object.keys(csv)).toEqual(['Handle', 'Title', 'Vendor', 'Type', 'Tags', 'Variant Price']);
    expect(csv.Title).toBe(r.title);
    expect(csv.Handle).toMatch(/^[a-z0-9-]+$/);
    expect(csv.Vendor).toBe(sample.vendorName);
    expect(csv['Variant Price']).toBe(Number(sample.preset.suggested_price_min).toFixed(2));
    expect(csv.Tags.length).toBeGreaterThan(0);
  });

  it('every sample transcript parses into the dictated fields, with no field title left in a value', () => {
    for (const s of DEMO_SAMPLES) {
      const writes = parseTranscript(s.transcript);
      expect(writes.brand).toBeTruthy();
      expect(writes.customDescription).toBeTruthy();
      expect(writes.customDescription).not.toMatch(/^description\b|\bperiod\b/i);
    }
  });

  it('marks field titles with the grammar scanner and keeps the transcript text intact', () => {
    const s = DEMO_SAMPLES[0];
    const parts = markTranscript(s.transcript);
    expect(parts.map((p) => p.text).join('')).toBe(s.transcript);
    expect(parts.filter((p) => p.field).map((p) => p.text)).toContain('brand');
    expect(parts.find((p) => p.text === 'description')?.field).toBe('customDescription');
  });

  it('labels preset-filled values as preset, dictated values as voice', async () => {
    const r = await runDemo(DEMO_SAMPLES[1]);
    expect(r.fields.find((f) => f.key === 'brand')?.source).toBe('voice');
    expect(r.fields.find((f) => f.key === 'modelName')).toMatchObject({ value: 'Detroit', source: 'preset' });
    expect(r.fields.find((f) => f.key === 'price')).toMatchObject({ value: '145', source: 'preset' });
  });

  it('is deterministic: same input, same listing', async () => {
    const a = await runDemo(DEMO_SAMPLES[2]);
    const b = await runDemo(DEMO_SAMPLES[2]);
    expect(b).toEqual(a);
  });
});
