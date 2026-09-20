import { describe, it, expect } from 'vitest';
import {
  BACKDROPS_MAX,
  BACKGROUND_CANVAS_MAX,
  BACKGROUND_CANVAS_MIN,
  BACKGROUND_PADDING_MAX,
  DEFAULT_BACKGROUND_PRESET,
  DEFAULT_DESCRIPTION_SETTINGS,
  backdropStoragePath,
  backgroundPresetCanonical,
  isBackdropStoragePath,
  normalizeBackdropLibrary,
  normalizeBackgroundBackdrop,
  normalizeBackgroundColor,
  normalizeBackgroundPreset,
  presetHash,
  resolveDescriptionSettings,
  type BackgroundPreset,
} from './descriptionSettings';

/**
 * The background preset is the CONTRACT between this app and the self-hosted
 * matting service (AGENTS.md §9): the service composites from the same seven
 * values and stamps `product_images.bg_preset` with the same 8-hex hash. The
 * three vectors at the bottom are the ones both sides are checked against —
 * when a hash disagrees, the canonical STRING is what to diff, which is why it
 * is asserted here in full rather than only its digest.
 *
 * THE VECTORS MOVED ONCE, when `backdrop` became the seventh key: the
 * pre-backdrop digests (`7abc910f`, `c7e0869c`) are RETIRED and deliberately not
 * kept as legacy cases. Nothing had been processed under them — the migration
 * was unrun and no service was deployed — so no stored composite was
 * invalidated, and keeping a dead vector around only invites someone to make
 * the canonical string satisfy both.
 */

/** A stand-in path. Deliberately short so the canonical strings below stay
 *  readable; `normalizeBackgroundPreset` would drop it (see its own tests),
 *  which is a separate rule — the hash function validates nothing, by design,
 *  because the two languages must agree on bytes and not on policy. */
const VECTOR_BACKDROP = 'u1/backdrops/1700000000000-linen.jpg';

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
      id: 'studio', canvas: 1536, color: '#F4F4F4', backdrop: null,
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

/* ── Photo backdrops ───────────────────────────────────────────────────────
   A backdrop is a STORAGE PATH handed to a service that fetches it with the
   service role, so the shape is checked rather than trusted, and anything else
   is DROPPED (which falls back to the flat colour — the one safe backdrop)
   rather than repaired into a guess. */

const UID = '18c356d9-1111-4222-8333-444455556666';
const GOOD_PATH = `${UID}/backdrops/1700000000000-linen.jpg`;

describe('isBackdropStoragePath', () => {
  it('accepts `<uuid>/backdrops/<file>` — the uid prefix the storage policies scope on', () => {
    expect(isBackdropStoragePath(GOOD_PATH)).toBe(true);
    expect(isBackdropStoragePath(`${UID.toUpperCase()}/backdrops/a.png`)).toBe(true);
  });

  it('rejects a product-photo path, a missing uuid, a nested file and a traversal', () => {
    expect(isBackdropStoragePath(`${UID}/some-product-id/photo.jpg`)).toBe(false);
    expect(isBackdropStoragePath('backdrops/linen.jpg')).toBe(false);
    expect(isBackdropStoragePath('u1/backdrops/linen.jpg')).toBe(false);
    expect(isBackdropStoragePath(`${UID}/backdrops/sub/linen.jpg`)).toBe(false);
    expect(isBackdropStoragePath(`${UID}/backdrops/`)).toBe(false);
    expect(isBackdropStoragePath(`../${UID}/backdrops/linen.jpg`)).toBe(false);
  });

  it('rejects anything that is not a string', () => {
    for (const junk of [null, undefined, 42, {}, [GOOD_PATH]]) {
      expect(isBackdropStoragePath(junk)).toBe(false);
    }
  });
});

describe('normalizeBackgroundBackdrop', () => {
  it('keeps a good path and pins fit to cover', () => {
    expect(normalizeBackgroundBackdrop({ storagePath: GOOD_PATH, fit: 'cover' }))
      .toEqual({ storagePath: GOOD_PATH, fit: 'cover' });
    // `fit` is not read from the stored value: there is one mode, and a stored
    // 'contain' from a future build must not silently change today's geometry.
    expect(normalizeBackgroundBackdrop({ storagePath: GOOD_PATH, fit: 'contain' }))
      .toEqual({ storagePath: GOOD_PATH, fit: 'cover' });
  });

  it('trims, because a hand-edited JSONB value carries whitespace', () => {
    expect(normalizeBackgroundBackdrop({ storagePath: `  ${GOOD_PATH}  ` })?.storagePath)
      .toBe(GOOD_PATH);
  });

  it('drops a bad path, a missing path, and anything that is not an object', () => {
    expect(normalizeBackgroundBackdrop({ storagePath: 'http://evil.example/x.jpg' })).toBeNull();
    expect(normalizeBackgroundBackdrop({ storagePath: '' })).toBeNull();
    expect(normalizeBackgroundBackdrop({})).toBeNull();
    for (const junk of [null, undefined, GOOD_PATH, 42, [{ storagePath: GOOD_PATH }]]) {
      expect(normalizeBackgroundBackdrop(junk)).toBeNull();
    }
  });
});

describe('normalizeBackgroundPreset — backdrop', () => {
  it('defaults to null, so every existing workspace keeps its flat colour', () => {
    expect(normalizeBackgroundPreset({}).backdrop).toBeNull();
    expect(DEFAULT_BACKGROUND_PRESET.backdrop).toBeNull();
  });

  it('keeps a valid backdrop and DROPS an invalid one', () => {
    expect(normalizeBackgroundPreset({ backdrop: { storagePath: GOOD_PATH } }).backdrop)
      .toEqual({ storagePath: GOOD_PATH, fit: 'cover' });
    expect(normalizeBackgroundPreset({ backdrop: { storagePath: 'u1/backdrops/x.jpg' } }).backdrop)
      .toBeNull();
    expect(normalizeBackgroundPreset({ backdrop: 'linen' }).backdrop).toBeNull();
  });
});

describe('normalizeBackdropLibrary', () => {
  const entry = (over: Record<string, unknown> = {}) => ({
    id: 'a', storagePath: GOOD_PATH, name: 'Linen', width: 2048, height: 1365,
    addedAt: '2026-09-20T10:00:00.000Z', ...over,
  });

  it('keeps a well-formed row field for field', () => {
    expect(normalizeBackdropLibrary([entry()])).toEqual([{
      id: 'a', storagePath: GOOD_PATH, name: 'Linen',
      width: 2048, height: 1365, addedAt: '2026-09-20T10:00:00.000Z',
    }]);
  });

  it('returns [] for anything that is not an array', () => {
    for (const junk of [null, undefined, {}, 'linen', 42]) {
      expect(normalizeBackdropLibrary(junk)).toEqual([]);
    }
  });

  it('drops a row with no usable path — a chip with no file is a broken thumbnail', () => {
    expect(normalizeBackdropLibrary([
      entry({ storagePath: 'u1/backdrops/x.jpg' }),
      entry({ storagePath: '' }),
      { name: 'orphan' },
      null,
      [entry()],
      entry({ storagePath: `${UID}/backdrops/keeper.jpg` }),
    ]).map(b => b.storagePath)).toEqual([`${UID}/backdrops/keeper.jpg`]);
  });

  it('collapses duplicates — two rows for one file are two chips that do the same thing', () => {
    expect(normalizeBackdropLibrary([entry(), entry({ id: 'b', name: 'Linen again' })]))
      .toHaveLength(1);
  });

  it(`caps at ${BACKDROPS_MAX}, keeping the FIRST (the ones a preset is likeliest to point at)`, () => {
    const many = Array.from({ length: BACKDROPS_MAX + 4 }, (_, i) => entry({
      id: `id-${i}`, storagePath: `${UID}/backdrops/${i}.jpg`,
    }));
    const out = normalizeBackdropLibrary(many);
    expect(out).toHaveLength(BACKDROPS_MAX);
    expect(out[0].storagePath).toBe(`${UID}/backdrops/0.jpg`);
    expect(out[BACKDROPS_MAX - 1].storagePath).toBe(`${UID}/backdrops/${BACKDROPS_MAX - 1}.jpg`);
  });

  it('falls back to the file name when the name is missing or junk', () => {
    expect(normalizeBackdropLibrary([entry({ name: '   ' })])[0].name).toBe('1700000000000-linen');
    expect(normalizeBackdropLibrary([entry({ name: 42 })])[0].name).toBe('1700000000000-linen');
  });

  it('falls back to the path as the id, so React has a key and Remove has a target', () => {
    expect(normalizeBackdropLibrary([entry({ id: '' })])[0].id).toBe(GOOD_PATH);
  });

  it('zeroes unusable dimensions instead of printing NaN in the list', () => {
    const out = normalizeBackdropLibrary([entry({ width: 'wide', height: -8 })])[0];
    expect(out.width).toBe(0);
    expect(out.height).toBe(0);
  });

  it('drops an unparseable addedAt rather than showing "Invalid Date"', () => {
    expect(normalizeBackdropLibrary([entry({ addedAt: 'yesterday' })])[0].addedAt).toBe('');
    expect(normalizeBackdropLibrary([entry({ addedAt: 1700000000000 })])[0].addedAt).toBe('');
  });
});

describe('backdropStoragePath', () => {
  it('builds a path its own validator accepts', () => {
    expect(isBackdropStoragePath(backdropStoragePath(UID, 'Linen Sheet.PNG'))).toBe(true);
  });

  it('slugs the name, always ends .jpg (the upload is re-encoded), and stays one segment', () => {
    const path = backdropStoragePath(UID, 'Linen Sheet (2).png');
    expect(path).toMatch(new RegExp(`^${UID}/backdrops/\\d+-linen-sheet-2\\.jpg$`));
    expect(path.split('/')).toHaveLength(3);
  });

  it('survives a name with nothing usable in it', () => {
    expect(isBackdropStoragePath(backdropStoragePath(UID, '###.png'))).toBe(true);
    expect(backdropStoragePath(UID, '###.png')).toContain('-backdrop.jpg');
  });
});

describe('resolveDescriptionSettings — backdrops library', () => {
  it('defaults to an empty shelf', () => {
    expect(resolveDescriptionSettings({}).backdrops).toEqual([]);
    expect(resolveDescriptionSettings(null).backdrops).toEqual([]);
  });

  it('normalises on every read, like platformPricing and the preset', () => {
    const resolved = resolveDescriptionSettings({
      backdrops: [{ storagePath: GOOD_PATH, name: 'Linen' }, { storagePath: 'nope' }],
    } as never);
    expect(resolved.backdrops).toHaveLength(1);
    expect(resolved.backdrops[0]).toEqual({
      id: GOOD_PATH, storagePath: GOOD_PATH, name: 'Linen', width: 0, height: 0, addedAt: '',
    });
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
      backdrop: null,
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
  it('is seven keys in alphabetical order with no whitespace, and no id', () => {
    expect(backgroundPresetCanonical(DEFAULT_BACKGROUND_PRESET)).toBe(
      '{"anchor":"center","backdrop":"","canvas":2048,"color":"#FFFFFF","padding":0.1,"quality":90,"shadow":false}',
    );
  });

  it('writes the backdrop as a bare PATH STRING, and "" when there is none', () => {
    expect(backgroundPresetCanonical({
      ...DEFAULT_BACKGROUND_PRESET,
      backdrop: { storagePath: VECTOR_BACKDROP, fit: 'cover' },
    })).toBe(
      '{"anchor":"center","backdrop":"u1/backdrops/1700000000000-linen.jpg","canvas":2048,' +
      '"color":"#FFFFFF","padding":0.1,"quality":90,"shadow":false}',
    );
    expect(backgroundPresetCanonical(DEFAULT_BACKGROUND_PRESET)).toContain('"backdrop":""');
  });

  it('ignores `fit` — there is one mode, so it is not part of the look', () => {
    // If a second fit mode is ever added it MUST enter the canonical string:
    // two composites fitted differently do not look the same.
    const a = backgroundPresetCanonical({
      ...DEFAULT_BACKGROUND_PRESET, backdrop: { storagePath: VECTOR_BACKDROP, fit: 'cover' },
    });
    const b = backgroundPresetCanonical({
      ...DEFAULT_BACKGROUND_PRESET,
      backdrop: { storagePath: VECTOR_BACKDROP, fit: 'cover' as const },
    });
    expect(a).toBe(b);
  });

  it('a photo backdrop and the flat colour are DIFFERENT presets', () => {
    expect(backgroundPresetCanonical({
      ...DEFAULT_BACKGROUND_PRESET, backdrop: { storagePath: VECTOR_BACKDROP, fit: 'cover' },
    })).not.toBe(backgroundPresetCanonical(DEFAULT_BACKGROUND_PRESET));
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
      '{"anchor":"center","backdrop":"","canvas":2048,"color":"#FFFFFF","padding":0.1,"quality":90,"shadow":false}',
    );
    expect(await presetHash(DEFAULT_BACKGROUND_PRESET)).toBe('6300e6dc');
  });

  it('vector 2 — 1536 / #f4f4f4 / 0.08 / top / shadow / 85', async () => {
    const preset = normalizeBackgroundPreset({
      canvas: 1536, color: '#f4f4f4', padding: 0.08, anchor: 'top', shadow: true, quality: 85,
    });
    expect(backgroundPresetCanonical(preset)).toBe(
      '{"anchor":"top","backdrop":"","canvas":1536,"color":"#F4F4F4","padding":0.08,"quality":85,"shadow":true}',
    );
    expect(await presetHash(preset)).toBe('a4c629a4');
  });

  it('vector 3 — the default preset with a photo backdrop', async () => {
    const preset: BackgroundPreset = {
      ...DEFAULT_BACKGROUND_PRESET,
      backdrop: { storagePath: VECTOR_BACKDROP, fit: 'cover' },
    };
    expect(backgroundPresetCanonical(preset)).toBe(
      '{"anchor":"center","backdrop":"u1/backdrops/1700000000000-linen.jpg","canvas":2048,' +
      '"color":"#FFFFFF","padding":0.1,"quality":90,"shadow":false}',
    );
    expect(await presetHash(preset)).toBe('6218c54a');
  });

  it('padding 0.1 and 0.100 still hash identically — the float rule survived the new key', async () => {
    const a = await presetHash({ ...DEFAULT_BACKGROUND_PRESET, padding: 0.1 });
    const b = await presetHash({ ...DEFAULT_BACKGROUND_PRESET, padding: 0.100 });
    expect(a).toBe(b);
    expect(a).toBe('6300e6dc');
  });

  it('is 8 lower-case hex characters', async () => {
    expect(await presetHash(DEFAULT_BACKGROUND_PRESET)).toMatch(/^[0-9a-f]{8}$/);
  });

  it('a different preset hashes differently', async () => {
    const other = { ...DEFAULT_BACKGROUND_PRESET, color: '#111111' };
    expect(await presetHash(other)).not.toBe(await presetHash(DEFAULT_BACKGROUND_PRESET));
  });
});
