import { describe, it, expect } from 'vitest';
import {
  BACKGROUND_CANVAS_MAX,
  BACKGROUND_CANVAS_MIN,
  BACKGROUND_PADDING_MAX,
  DEFAULT_BACKGROUND_PRESET,
  DEFAULT_DESCRIPTION_SETTINGS,
  backgroundPresetCanonical,
  normalizeBackgroundColor,
  normalizeBackgroundPreset,
  presetHash,
  resolveDescriptionSettings,
  type BackgroundPreset,
} from './descriptionSettings';

/**
 * The background preset is the CONTRACT between this app and the self-hosted
 * matting service (AGENTS.md §9): the service composites from the same six
 * values and stamps `product_images.bg_preset` with the same 8-hex hash. The
 * three vectors at the bottom are the ones both sides are checked against —
 * when a hash disagrees, the canonical STRING is what to diff, which is why it
 * is asserted here in full rather than only its digest.
 */

describe('normalizeBackgroundColor', () => {
  it('upper-cases a full #RRGGBB', () => {
    expect(normalizeBackgroundColor('#f4f4f4')).toBe('#F4F4F4');
  });

  it('accepts a bare six-digit hex without the hash', () => {
    expect(normalizeBackgroundColor('aabbcc')).toBe('#AABBCC');
  });

  it('expands #abc shorthand — a colour input emits either spelling and the hash must see one', () => {
    expect(normalizeBackgroundColor('#abc')).toBe('#AABBCC');
  });

  it('falls back to the default for junk, empty and non-strings', () => {
    expect(normalizeBackgroundColor('rebeccapurple')).toBe(DEFAULT_BACKGROUND_PRESET.color);
    expect(normalizeBackgroundColor('')).toBe(DEFAULT_BACKGROUND_PRESET.color);
    expect(normalizeBackgroundColor(null)).toBe(DEFAULT_BACKGROUND_PRESET.color);
    expect(normalizeBackgroundColor(0xffffff)).toBe(DEFAULT_BACKGROUND_PRESET.color);
  });

  it('trims — a pasted swatch carries whitespace', () => {
    expect(normalizeBackgroundColor('  #fafafa  ')).toBe('#FAFAFA');
  });
});

describe('normalizeBackgroundPreset', () => {
  it('returns the default for anything that is not an object', () => {
    for (const junk of [null, undefined, 'white', 42, [], [{ canvas: 1 }]]) {
      expect(normalizeBackgroundPreset(junk)).toEqual(DEFAULT_BACKGROUND_PRESET);
    }
  });

  it('keeps a well-formed preset field for field', () => {
    const preset: BackgroundPreset = {
      id: 'studio', canvas: 1536, color: '#F4F4F4',
      padding: 0.08, anchor: 'top', shadow: true, quality: 85,
    };
    expect(normalizeBackgroundPreset(preset)).toEqual(preset);
  });

  it('clamps the canvas into range and rounds it to whole pixels', () => {
    expect(normalizeBackgroundPreset({ canvas: 99 }).canvas).toBe(BACKGROUND_CANVAS_MIN);
    expect(normalizeBackgroundPreset({ canvas: 99999 }).canvas).toBe(BACKGROUND_CANVAS_MAX);
    expect(normalizeBackgroundPreset({ canvas: 1024.7 }).canvas).toBe(1025);
  });

  it('clamps padding to 0…0.4 — a 90% margin is a preset that renders nothing', () => {
    expect(normalizeBackgroundPreset({ padding: -1 }).padding).toBe(0);
    expect(normalizeBackgroundPreset({ padding: 0.9 }).padding).toBe(BACKGROUND_PADDING_MAX);
    expect(normalizeBackgroundPreset({ padding: 0.12 }).padding).toBe(0.12);
  });

  it('clamps quality to 60…95', () => {
    expect(normalizeBackgroundPreset({ quality: 5 }).quality).toBe(60);
    expect(normalizeBackgroundPreset({ quality: 100 }).quality).toBe(95);
  });

  it('falls back rather than failing on a junk number — this drives an unattended pipeline', () => {
    expect(normalizeBackgroundPreset({ padding: 'lots' }).padding).toBe(DEFAULT_BACKGROUND_PRESET.padding);
    expect(normalizeBackgroundPreset({ canvas: NaN }).canvas).toBe(DEFAULT_BACKGROUND_PRESET.canvas);
    expect(normalizeBackgroundPreset({ quality: Infinity }).quality).toBe(DEFAULT_BACKGROUND_PRESET.quality);
  });

  it('parses a numeric string, because a form control hands back strings', () => {
    expect(normalizeBackgroundPreset({ canvas: '2048', quality: '85' }))
      .toMatchObject({ canvas: 2048, quality: 85 });
  });

  it('only "top" is top; anything else is centered', () => {
    expect(normalizeBackgroundPreset({ anchor: 'top' }).anchor).toBe('top');
    expect(normalizeBackgroundPreset({ anchor: 'bottom' }).anchor).toBe('center');
    expect(normalizeBackgroundPreset({ anchor: 'TOP' }).anchor).toBe('center');
  });

  it('shadow is strictly true — a truthy string must not turn it on', () => {
    expect(normalizeBackgroundPreset({ shadow: true }).shadow).toBe(true);
    expect(normalizeBackgroundPreset({ shadow: 'yes' }).shadow).toBe(false);
    expect(normalizeBackgroundPreset({ shadow: 1 }).shadow).toBe(false);
  });

  it('keeps a custom id and defaults a blank one', () => {
    expect(normalizeBackgroundPreset({ id: '  bone  ' }).id).toBe('bone');
    expect(normalizeBackgroundPreset({ id: '   ' }).id).toBe(DEFAULT_BACKGROUND_PRESET.id);
    expect(normalizeBackgroundPreset({ id: 42 }).id).toBe(DEFAULT_BACKGROUND_PRESET.id);
  });
});

describe('resolveDescriptionSettings — background', () => {
  it('defaults the whole preset when the key is absent (every existing workspace)', () => {
    expect(resolveDescriptionSettings({}).background).toEqual(DEFAULT_BACKGROUND_PRESET);
    expect(resolveDescriptionSettings(null).background).toEqual(DEFAULT_BACKGROUND_PRESET);
  });

  it('normalises a stored preset on every read, like platformPricing', () => {
    const resolved = resolveDescriptionSettings({
      background: { canvas: 99999, color: '#abc', padding: 9, anchor: 'top' },
    } as never);
    expect(resolved.background).toEqual({
      id: DEFAULT_BACKGROUND_PRESET.id,
      canvas: BACKGROUND_CANVAS_MAX,
      color: '#AABBCC',
      padding: BACKGROUND_PADDING_MAX,
      anchor: 'top',
      shadow: false,
      quality: DEFAULT_BACKGROUND_PRESET.quality,
    });
  });

  it('leaves every other description field exactly as it was (the golden output is unaffected)', () => {
    const resolved = resolveDescriptionSettings({});
    expect(resolved.measurementPrefix).toBe(DEFAULT_DESCRIPTION_SETTINGS.measurementPrefix);
    expect(resolved.washingLine).toBe(DEFAULT_DESCRIPTION_SETTINGS.washingLine);
    expect(resolved.closingLine).toBe(DEFAULT_DESCRIPTION_SETTINGS.closingLine);
    expect(resolved.disclaimerLines).toEqual(DEFAULT_DESCRIPTION_SETTINGS.disclaimerLines);
  });

  it('does not share the default preset object — a form edit must not mutate the module constant', () => {
    const a = resolveDescriptionSettings({});
    a.background.canvas = 512;
    expect(DEFAULT_BACKGROUND_PRESET.canvas).toBe(2048);
    expect(resolveDescriptionSettings({}).background.canvas).toBe(2048);
  });
});

describe('backgroundPresetCanonical', () => {
  it('is six keys in a fixed order with no whitespace, and no id', () => {
    expect(backgroundPresetCanonical(DEFAULT_BACKGROUND_PRESET)).toBe(
      '{"anchor":"center","canvas":2048,"color":"#FFFFFF","padding":0.1,"quality":90,"shadow":false}',
    );
  });

  it('upper-cases the colour, so two spellings of one backdrop are one preset', () => {
    const lower = backgroundPresetCanonical({ ...DEFAULT_BACKGROUND_PRESET, color: '#ffffff' });
    expect(lower).toBe(backgroundPresetCanonical(DEFAULT_BACKGROUND_PRESET));
  });

  it('writes padding with at most 3 decimals — 0.1 and 0.100 are the same preset', () => {
    expect(backgroundPresetCanonical({ ...DEFAULT_BACKGROUND_PRESET, padding: 0.1 }))
      .toBe(backgroundPresetCanonical({ ...DEFAULT_BACKGROUND_PRESET, padding: 0.100 }));
    expect(backgroundPresetCanonical({ ...DEFAULT_BACKGROUND_PRESET, padding: 0.10004 }))
      .toContain('"padding":0.1');
  });

  it('ignores `id` — renaming a preset must not invalidate every composite made with it', () => {
    expect(backgroundPresetCanonical({ ...DEFAULT_BACKGROUND_PRESET, id: 'renamed' }))
      .toBe(backgroundPresetCanonical(DEFAULT_BACKGROUND_PRESET));
  });
});

/**
 * THE THREE VECTORS. The matting service computes these independently; if a
 * digest here ever stops matching the service's, the canonical string above it
 * is the thing to compare, not the hash.
 */
describe('presetHash — the three shared vectors', () => {
  it('vector 1 — the default preset', async () => {
    expect(backgroundPresetCanonical(DEFAULT_BACKGROUND_PRESET)).toBe(
      '{"anchor":"center","canvas":2048,"color":"#FFFFFF","padding":0.1,"quality":90,"shadow":false}',
    );
    expect(await presetHash(DEFAULT_BACKGROUND_PRESET)).toBe('7abc910f');
  });

  it('vector 2 — 1536 / #f4f4f4 / 0.08 / top / shadow / 85', async () => {
    const preset = normalizeBackgroundPreset({
      canvas: 1536, color: '#f4f4f4', padding: 0.08, anchor: 'top', shadow: true, quality: 85,
    });
    expect(backgroundPresetCanonical(preset)).toBe(
      '{"anchor":"top","canvas":1536,"color":"#F4F4F4","padding":0.08,"quality":85,"shadow":true}',
    );
    expect(await presetHash(preset)).toBe('c7e0869c');
  });

  it('vector 3 — padding 0.1 and 0.100 hash identically', async () => {
    const a = await presetHash({ ...DEFAULT_BACKGROUND_PRESET, padding: 0.1 });
    const b = await presetHash({ ...DEFAULT_BACKGROUND_PRESET, padding: 0.100 });
    expect(a).toBe(b);
    expect(a).toBe('7abc910f');
  });

  it('is 8 lower-case hex characters', async () => {
    expect(await presetHash(DEFAULT_BACKGROUND_PRESET)).toMatch(/^[0-9a-f]{8}$/);
  });

  it('a different preset hashes differently', async () => {
    const other = { ...DEFAULT_BACKGROUND_PRESET, color: '#111111' };
    expect(await presetHash(other)).not.toBe(await presetHash(DEFAULT_BACKGROUND_PRESET));
  });
});
