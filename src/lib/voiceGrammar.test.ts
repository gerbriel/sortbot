import { describe, it, expect } from 'vitest';
import {
  parseVoiceChunk,
  flushVoiceState,
  detectActiveField,
  patchVoiceLine,
  scanFieldTitles,
  startsNewCommand,
  stripFieldTitlePrefix,
  VOICE_KEYWORD_TO_FIELD,
  EMPTY_VOICE_STATE,
  type VoiceParseState,
} from './voiceGrammar';
import { generateProductDescription, formatVoiceTranscript } from './textAIService';

/** Feed a sequence of utterances through the parser, collecting every write. */
function dictate(chunks: string[], start: VoiceParseState = EMPTY_VOICE_STATE) {
  let state = start;
  const writes: { field: string; value: string }[] = [];
  for (const c of chunks) {
    const r = parseVoiceChunk(c, state, { newUtterance: true });
    writes.push(...r.writes);
    state = r.state;
  }
  return { writes, state };
}

/** Last value written for each field — what the form ends up showing. */
function fields(writes: { field: string; value: string }[]) {
  const out: Record<string, string> = {};
  for (const w of writes) out[w.field] = w.value;
  return out;
}

describe('scanFieldTitles — word boundaries', () => {
  it('does not match a field title inside a longer word', () => {
    // "vintage" contains "tag", "oversized" contains "size", "scared" contains "care"
    expect(scanFieldTitles('vintage oversized scared')).toEqual([]);
  });

  it('prefers the longest title at the same position', () => {
    const hits = scanFieldTitles('secondary color blue');
    expect(hits).toHaveLength(1);
    expect(hits[0].field).toBe('secondaryColor');
  });

  it('returns hits in positional order', () => {
    expect(scanFieldTitles('brand nike size large').map(h => h.field))
      .toEqual(['brand', 'size']);
  });
});

describe('report 4 — a field title ends the previous command, no "period" needed', () => {
  it('parses "brand nike size large price forty" with no periods at all', () => {
    const { writes } = dictate(['brand nike size large price forty']);
    expect(fields(writes)).toMatchObject({ brand: 'nike', size: 'large', price: 'forty' });
  });

  it('still honours "period" as a boundary', () => {
    const { writes } = dictate(['brand nike period size large period']);
    expect(fields(writes)).toMatchObject({ brand: 'nike', size: 'large' });
  });

  it('mixes both boundary styles in one utterance', () => {
    const { writes } = dictate(['brand nike period size large color blue period']);
    expect(fields(writes)).toMatchObject({ brand: 'nike', size: 'large', color: 'blue' });
  });

  it('writes a trailing value optimistically but keeps the field open', () => {
    const r = parseVoiceChunk('brand nike', EMPTY_VOICE_STATE, { newUtterance: true });
    expect(r.writes).toEqual([{ field: 'brand', value: 'nike' }]);
    expect(r.state).toEqual({ activeField: 'brand', pending: 'nike' });
  });

  it('continues a value across utterances and rewrites it fuller', () => {
    const { writes, state } = dictate(['brand polo', 'ralph lauren period']);
    expect(writes).toEqual([
      { field: 'brand', value: 'polo' },
      { field: 'brand', value: 'polo ralph lauren' },
    ]);
    expect(state.activeField).toBeNull();
  });

  it('parses several measurements in one breath', () => {
    const { writes } = dictate(['chest 38 waist 32 sleeve 25']);
    expect(fields(writes)).toMatchObject({
      meas_chest: '38', meas_waist: '32', meas_sleeve: '25',
    });
  });
});

describe('report 10 — the field title is never part of the value', () => {
  it('strips "description" from the captured description (titles/tags/body leak)', () => {
    const { writes } = dictate(['description super soft faded boxy fit period']);
    expect(writes).toEqual([{ field: 'customDescription', value: 'super soft faded boxy fit' }]);
  });

  it('strips it when the description was already open from an earlier utterance', () => {
    // The interim-highlight pass opens the field; the final result still carries
    // the spoken title. It must not survive into the value.
    const opened = parseVoiceChunk('description super soft', EMPTY_VOICE_STATE, { newUtterance: true });
    expect(opened.writes.at(-1)).toEqual({ field: 'customDescription', value: 'super soft' });
    const closed = parseVoiceChunk('and faded period', opened.state, { newUtterance: true });
    expect(closed.writes.at(-1)).toEqual({ field: 'customDescription', value: 'super soft and faded' });
  });

  it('never emits a value that is only the title', () => {
    const { writes } = dictate(['description period']);
    expect(writes).toEqual([]);
  });

  it('strips titles for every other field too', () => {
    const { writes } = dictate(['color blue period material cotton period']);
    expect(fields(writes)).toMatchObject({ color: 'blue', material: 'cotton' });
  });
});

describe('the description is free-form — narration is never a command', () => {
  it('keeps narration words that double as field titles', () => {
    const { writes } = dictate(['description long sleeve boxy style great care label period']);
    expect(writes).toEqual([{
      field: 'customDescription',
      value: 'long sleeve boxy style great care label',
    }]);
  });

  it('does not split mid-utterance on a narration word', () => {
    const { writes } = dictate(['description nice length on this one']);
    expect(fields(writes)).toEqual({ customDescription: 'nice length on this one' });
  });

  it('ends when a NEW utterance starts with a title and a plausible value', () => {
    const { writes, state } = dictate([
      'description super soft and faded',
      'brand nike period',
    ]);
    expect(fields(writes)).toMatchObject({
      customDescription: 'super soft and faded',
      brand: 'nike',
    });
    expect(state.activeField).toBeNull();
  });

  it('does NOT end on a new utterance whose measurement title has no number', () => {
    const { writes } = dictate([
      'description super soft',
      'length of the sleeve is generous',
    ]);
    expect(fields(writes)).toEqual({
      customDescription: 'super soft length of the sleeve is generous',
    });
  });

  it('DOES end on a new utterance whose measurement title has a number', () => {
    const { writes } = dictate(['description super soft', 'length 28 period']);
    expect(fields(writes)).toMatchObject({ customDescription: 'super soft', meas_length: '28' });
  });

  it('parses commands that follow the closing "period" in the same utterance', () => {
    const { writes } = dictate(['description super soft period brand nike period size large period']);
    expect(fields(writes)).toMatchObject({
      customDescription: 'super soft', brand: 'nike', size: 'large',
    });
  });

  it('swallows the rest of the utterance after a mid-utterance "description"', () => {
    const { writes } = dictate(['brand nike description super soft long sleeve']);
    expect(fields(writes)).toMatchObject({
      brand: 'nike', customDescription: 'super soft long sleeve',
    });
  });
});

describe('report 7 / 4 — nothing dictated is ever discarded', () => {
  it('flushVoiceState writes an un-terminated description (silence timeout / Stop)', () => {
    const state: VoiceParseState = { activeField: 'customDescription', pending: 'super soft and faded' };
    const r = flushVoiceState(state);
    expect(r.writes).toEqual([{ field: 'customDescription', value: 'super soft and faded' }]);
    expect(r.state).toEqual(EMPTY_VOICE_STATE);
  });

  it('flushVoiceState is the "period" key — it closes an open field', () => {
    const open = parseVoiceChunk('size extra large', EMPTY_VOICE_STATE, { newUtterance: true });
    const r = flushVoiceState(open.state);
    expect(r.writes).toEqual([{ field: 'size', value: 'extra large' }]);
    expect(r.state.activeField).toBeNull();
  });

  it('flushing an empty state writes nothing', () => {
    expect(flushVoiceState(EMPTY_VOICE_STATE).writes).toEqual([]);
  });

  it('a description is written even when recognition never sees a "period"', () => {
    const { writes } = dictate(['description really soft cotton tee']);
    expect(writes).toEqual([{ field: 'customDescription', value: 'really soft cotton tee' }]);
  });
});

describe('detectActiveField — interim highlighting', () => {
  it('highlights the last title spoken', () => {
    expect(detectActiveField('brand nike size', EMPTY_VOICE_STATE)).toBe('size');
  });

  it('never switches away from an open description', () => {
    const state: VoiceParseState = { activeField: 'customDescription', pending: 'soft' };
    expect(detectActiveField('with a nice long sleeve', state)).toBe('customDescription');
  });

  it('does not highlight on a substring match', () => {
    expect(detectActiveField('vintage oversized', EMPTY_VOICE_STATE)).toBeNull();
  });
});

describe('startsNewCommand', () => {
  it('needs a value after the title', () => {
    expect(startsNewCommand('brand')).toBe(false);
    expect(startsNewCommand('brand nike')).toBe(true);
  });
  it('needs a number after a measurement title', () => {
    expect(startsNewCommand('length of the sleeve')).toBe(false);
    expect(startsNewCommand('length 28')).toBe(true);
  });
  it('is false when the title is not at the start', () => {
    expect(startsNewCommand('really nice brand nike')).toBe(false);
  });
});

describe('report 8 — patchVoiceLine edits one command without eating its neighbours', () => {
  it('rewrites a field that shares a line with other commands', () => {
    const text = 'brand nike. description super soft.';
    expect(patchVoiceLine(text, 'brand', 'Champion'))
      .toBe('brand Champion period description super soft.');
  });

  it('keeps a description whose value contains field-title words', () => {
    const text = 'brand nike. description long sleeve boxy style.';
    expect(patchVoiceLine(text, 'customDescription', 'long sleeve boxy style cropped'))
      .toBe('brand nike. description long sleeve boxy style cropped period');
  });

  it('patches the matching line and leaves the others byte-identical', () => {
    const text = 'brand nike.\nsize large.\ncolor blue.';
    expect(patchVoiceLine(text, 'size', 'XL'))
      .toBe('brand nike.\nsize XL period\ncolor blue.');
  });

  it('appends a new line when the field is absent', () => {
    expect(patchVoiceLine('brand nike.', 'color', 'blue'))
      .toBe('brand nike.\ncolor blue period');
  });

  it('drops the line when the field is cleared', () => {
    expect(patchVoiceLine('brand nike.\nsize large.', 'size', '')).toBe('brand nike.');
  });

  it('is a no-op for an unknown field key', () => {
    expect(patchVoiceLine('brand nike.', 'notAField', 'x')).toBe('brand nike.');
  });

  it('matches a synonym title (colour) but writes the canonical label', () => {
    expect(patchVoiceLine('colour blue period', 'color', 'green'))
      .toBe('color green period');
  });

  it('does not treat a decimal point as a terminator', () => {
    expect(patchVoiceLine('size 10.5 period', 'size', '11')).toBe('size 11 period');
  });

  it('round-trips: patching every field leaves all of them readable', () => {
    let t = '';
    t = patchVoiceLine(t, 'brand', 'Nike');
    t = patchVoiceLine(t, 'size', 'L');
    t = patchVoiceLine(t, 'customDescription', 'super soft long sleeve');
    t = patchVoiceLine(t, 'brand', 'Champion');
    expect(t).toContain('brand Champion period');
    expect(t).toContain('size L period');
    expect(t).toContain('description super soft long sleeve period');
  });
});

describe('end to end — dictation reaches the title/tags the way the user said it', () => {
  // Mirrors the real Step-3 chain: speech → parseVoiceChunk → patchVoiceLine into
  // the transcript → formatVoiceTranscript for display → extract + generate.
  async function speak(utterances: string[]) {
    let state = EMPTY_VOICE_STATE;
    let transcript = '';
    const fieldValues: Record<string, string> = {};
    for (const u of utterances) {
      transcript = formatVoiceTranscript(`${transcript} ${u}`.trim());
      const r = parseVoiceChunk(u, state, { newUtterance: true });
      state = r.state;
      for (const w of r.writes) {
        fieldValues[w.field] = w.value;
        transcript = patchVoiceLine(transcript, w.field, w.value);
      }
    }
    const flushed = flushVoiceState(state);
    for (const w of flushed.writes) {
      fieldValues[w.field] = w.value;
      transcript = patchVoiceLine(transcript, w.field, w.value);
    }
    const generated = await generateProductDescription({
      voiceDescription: transcript,
      customDescription: fieldValues.customDescription,
      brand: fieldValues.brand,
      size: fieldValues.size,
      category: 'tees',
    });
    return { fieldValues, transcript, generated };
  }

  it('never puts the word "description" in the title, the tags or the body', async () => {
    const { fieldValues, generated } = await speak([
      'brand nike period',
      'description super soft faded boxy fit period',
      'size large period',
    ]);
    expect(fieldValues.customDescription).toBe('super soft faded boxy fit');
    expect(generated.suggestedTitle).not.toMatch(/\bdescription\b/i);
    expect(generated.description).not.toMatch(/\bdescription\b/i);
    for (const tag of generated.suggestedTags || []) expect(tag).not.toMatch(/description/i);
  });

  it('keeps every field when the speaker never says "period" once', async () => {
    const { fieldValues } = await speak([
      'brand nike size large price forty',
      'description really soft cotton tee',
    ]);
    expect(fieldValues).toMatchObject({
      brand: 'nike',
      size: 'large',
      price: 'forty',
      customDescription: 'really soft cotton tee',
    });
  });

  it('editing one field afterwards leaves the others in the transcript', async () => {
    const { transcript } = await speak([
      'brand nike period description super soft long sleeve period size large period',
    ]);
    const edited = patchVoiceLine(transcript, 'brand', 'Champion');
    expect(edited).toMatch(/brand Champion period/);
    expect(edited).toMatch(/super soft long sleeve/);
    expect(edited).toMatch(/size large/i);
  });
});

// ── Report 9: no field value may carry a field title ────────────────────────
describe('report 9 — field titles never reach field values', () => {
  it('strips the field’s own title, repeatedly, and collapses a bare title to ""', () => {
    expect(stripFieldTitlePrefix('brand', 'brand nike')).toBe('nike');
    expect(stripFieldTitlePrefix('customDescription', 'description description super soft')).toBe('super soft');
    expect(stripFieldTitlePrefix('color', 'colour red')).toBe('red');       // synonym
    expect(stripFieldTitlePrefix('secondaryColor', 'secondary color blue')).toBe('blue');
    expect(stripFieldTitlePrefix('brand', 'brand')).toBe('');
    expect(stripFieldTitlePrefix('brand', 'brand: Nike')).toBe('Nike');
  });

  it('never strips ANOTHER field’s title — "Care Bears" is a real brand', () => {
    expect(stripFieldTitlePrefix('brand', 'Care Bears')).toBe('Care Bears');
    expect(stripFieldTitlePrefix('brand', 'Size Matters')).toBe('Size Matters');
    expect(stripFieldTitlePrefix('style', 'hip hop')).toBe('hip hop');
  });

  it('leaves a title that is not at the front alone', () => {
    expect(stripFieldTitlePrefix('customDescription', 'great description on the tag'))
      .toBe('great description on the tag');
  });

  // The report asks for one per field title in the vocabulary.
  const titles = Object.entries(VOICE_KEYWORD_TO_FIELD);
  it.each(titles)('"%s <value> period" writes a value free of every field title', (kw, field) => {
    const value = field.startsWith('meas_') ? '18' : 'zebra';
    const { writes } = parseVoiceChunk(`${kw} ${value} period`);
    const w = writes.find(x => x.field === field);
    expect(w, `no write for ${kw}`).toBeTruthy();
    expect(w!.value).toBe(value);
    // and no OTHER title leaked in either
    for (const other of Object.keys(VOICE_KEYWORD_TO_FIELD)) {
      expect(w!.value.toLowerCase()).not.toMatch(new RegExp(`^${other}\\b`));
    }
  });

  it('a value spoken with no period still loses its title on the optimistic write', () => {
    const { writes } = parseVoiceChunk('brand nike');
    expect(writes).toEqual([{ field: 'brand', value: 'nike' }]);
  });

  it('flushVoiceState strips the title of a value left open', () => {
    const state: VoiceParseState = { activeField: 'customDescription', pending: 'description super soft' };
    expect(flushVoiceState(state).writes).toEqual([
      { field: 'customDescription', value: 'super soft' },
    ]);
  });
});
