/**
 * voiceGrammar — the Step-3 dictation grammar, as pure functions.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE GRAMMAR
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A dictation stream is a sequence of FIELD COMMANDS and NARRATION.
 *
 *   command  := <field title> <value> <boundary>
 *   boundary := "period"                      (spoken, or the "." key / Period button)
 *             | <field title>                 (the next command starts — no period needed)
 *             | <end of utterance>            (value is written optimistically, stays open)
 *
 *   So "brand nike size large price forty" writes THREE fields with no periods at
 *   all: each field title closes the previous command. A value spoken across two
 *   recognition results still accumulates — the end-of-utterance write is
 *   optimistic and the field is re-written, fuller, when more speech arrives.
 *
 * FIELD TITLES are the keys of VOICE_KEYWORD_TO_FIELD, matched on WORD BOUNDARIES
 * and longest-match-first. Word boundaries matter: without them "vintage" contains
 * "tag", "oversized" contains "size", and "scared" contains "care".
 *
 * THE DESCRIPTION IS SPECIAL. It is free-form narration, so words that double as
 * field titles ("long sleeve", "boxy style", "care label") must NOT chop it up:
 *
 *   description := "description" <everything> <description-boundary>
 *   description-boundary := "period"
 *                         | a NEW UTTERANCE that starts with a field title
 *                           followed by a plausible value
 *                         | (never: a field title mid-utterance)
 *
 *   "plausible value" = at least one more word after the title, and — for a
 *   measurement title (width/length/chest/…) — a word containing a digit. That
 *   is what separates "length 28" (a command) from "length of the sleeve"
 *   (narration continuing the description).
 *
 * THE FIELD TITLE IS NEVER PART OF THE VALUE. Every write strips the matched
 * title from the captured span — including in description mode, where the old
 * inline parser did not, which is how the literal word "description" ended up
 * inside titles, tags and description bodies.
 *
 * NOTHING IS DISCARDED. When recognition ends (silence timeout, Stop, navigating
 * to another listing) the caller calls `flushVoiceState`, which writes whatever
 * value is still open. An un-terminated description is kept, not dropped.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/** Map voice command keywords → ClothingItem field keys. The dictation vocabulary. */
export const VOICE_KEYWORD_TO_FIELD: Record<string, string> = {
  'title': 'seoTitle',
  'brand': 'brand',
  'size': 'size',
  'color': 'color',
  'colour': 'color',
  'secondary color': 'secondaryColor',
  'secondary colour': 'secondaryColor',
  'second color': 'secondaryColor',
  'second colour': 'secondaryColor',
  '2nd color': 'secondaryColor',
  'secondary': 'secondaryColor',
  'accent color': 'secondaryColor',
  'accent colour': 'secondaryColor',
  'accent': 'secondaryColor',
  'condition': 'condition',
  'price': 'price',
  'era': 'era',
  'style': 'style',
  'gender': 'gender',
  'material': 'material',
  'fabric': 'material',
  'tags': 'tags',
  'tag': 'tags',
  'flaws': 'flaws',
  'flaw': 'flaws',
  'care': 'care',
  'description': 'customDescription',
  'note': 'customDescription',
  'width': 'meas_width',
  'length': 'meas_length',
  'chest': 'meas_chest',
  'waist': 'meas_waist',
  'hip': 'meas_hip',
  'rise': 'meas_rise',
  'inseam': 'meas_inseam',
  'outseam': 'meas_outseam',
  'leg opening': 'meas_leg',
  'sleeve': 'meas_sleeve',
  'shoulder': 'meas_shoulder',
};

/** fieldKey → the spoken label used in "label value period" transcript lines. */
export const FIELD_TO_VOICE_LABEL: Record<string, string> = {
  seoTitle: 'title', brand: 'brand', size: 'size', color: 'color',
  secondaryColor: 'second color', condition: 'condition', price: 'price',
  era: 'era', style: 'style', gender: 'gender', material: 'material',
  tags: 'tags', flaws: 'flaws', care: 'care', customDescription: 'description',
  meas_width: 'width', meas_length: 'length', meas_chest: 'chest',
  meas_waist: 'waist', meas_hip: 'hip', meas_rise: 'rise',
  meas_inseam: 'inseam', meas_outseam: 'outseam', meas_leg: 'leg opening',
  meas_sleeve: 'sleeve', meas_shoulder: 'shoulder',
};

/**
 * fieldKey → every spoken title that maps to it, longest first. Built from the
 * one vocabulary above so it can never drift away from it.
 */
export const FIELD_TO_TITLES: Record<string, string[]> = (() => {
  const out: Record<string, string[]> = {};
  for (const [kw, field] of Object.entries(VOICE_KEYWORD_TO_FIELD)) {
    (out[field] ||= []).push(kw);
  }
  for (const f of Object.keys(out)) out[f].sort((a, b) => b.length - a.length);
  return out;
})();

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Remove a field's OWN spoken title from the front of its value: the brand
 * field must hold "Nike", never "brand Nike"; the description must hold
 * "super soft", never "description super soft" (founder report 9).
 *
 * Repeats, so a value that accumulated the title twice across sessions
 * ("description description super soft") heals in one pass, and returns '' when
 * the value was nothing but the title — callers treat that as "no value".
 *
 * ONLY the field's own titles (and its synonyms — "colour" for `color`) are
 * stripped. Stripping ANOTHER field's title here would corrupt legitimate
 * values: "Care Bears" is a real brand, "Second Skin" a real label. Other
 * titles are kept out of values structurally instead, by making every one of
 * them a value boundary in both the live parser (scanFieldTitles) and the
 * transcript extractor (ALL_FIELD_TRIGGERS in textAIService).
 */
export function stripFieldTitlePrefix(fieldKey: string, value: string): string {
  const titles = FIELD_TO_TITLES[fieldKey];
  let out = (value ?? '').trim();
  if (!titles || !out) return out;
  for (;;) {
    const before = out;
    for (const t of titles) {
      const re = new RegExp(`^${escapeRe(t)}\\b[\\s:,.;-]*`, 'i');
      if (re.test(out)) { out = out.replace(re, '').trim(); break; }
    }
    if (out === before) return out;
  }
}

/** The one free-form field. Its value runs to "period", not to the next title. */
export const DESCRIPTION_FIELD = 'customDescription';

/** The spoken boundary word. Also produced by the "." key and the Period button. */
export const PERIOD_WORD = 'period';

export interface VoiceParseState {
  /** Field currently accumulating a value, or null when between commands. */
  activeField: string | null;
  /** Value captured for `activeField` so far, across utterances. */
  pending: string;
}

export interface VoiceWrite {
  field: string;
  value: string;
}

export interface VoiceParseResult {
  writes: VoiceWrite[];
  state: VoiceParseState;
}

export const EMPTY_VOICE_STATE: VoiceParseState = { activeField: null, pending: '' };

interface Hit {
  pos: number;
  end: number;
  kw: string;
  field: string;
}

const isWordChar = (c: string | undefined) => !!c && /[a-z0-9]/.test(c);

/**
 * All field-title occurrences in `text`, word-boundary anchored, longest match
 * first, non-overlapping, in positional order.
 */
export function scanFieldTitles(text: string): Hit[] {
  const lower = text.toLowerCase();
  const hits: Hit[] = [];
  for (const kw of Object.keys(VOICE_KEYWORD_TO_FIELD)) {
    let from = 0;
    for (;;) {
      const idx = lower.indexOf(kw, from);
      if (idx === -1) break;
      const end = idx + kw.length;
      if (!isWordChar(lower[idx - 1]) && !isWordChar(lower[end])) {
        hits.push({ pos: idx, end, kw, field: VOICE_KEYWORD_TO_FIELD[kw] });
      }
      from = idx + 1;
    }
  }
  hits.sort((a, b) => a.pos - b.pos || b.kw.length - a.kw.length);
  const out: Hit[] = [];
  for (const h of hits) {
    if (out.length && h.pos < out[out.length - 1].end) continue;
    out.push(h);
  }
  return out;
}

/** Positions of the spoken boundary word "period". */
function scanPeriods(text: string): { pos: number; end: number }[] {
  const out: { pos: number; end: number }[] = [];
  const re = new RegExp(`\\b${PERIOD_WORD}\\b`, 'gi');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) out.push({ pos: m.index, end: m.index + m[0].length });
  return out;
}

const joinValue = (a: string, b: string) => `${a} ${b}`.replace(/\s+/g, ' ').trim();

const MEASUREMENT_FIELD = /^meas_/;

/**
 * Does `chunk` open with a field title followed by a plausible value?
 * Used only to decide whether a NEW utterance interrupts an open description.
 */
export function startsNewCommand(chunk: string): boolean {
  const trimmed = chunk.trimStart();
  if (!trimmed) return false;
  const hits = scanFieldTitles(trimmed);
  const first = hits[0];
  if (!first || first.pos !== 0) return false;
  // A description title always opens a description — never a "plausible value" test.
  if (first.field === DESCRIPTION_FIELD) return true;
  const rest = trimmed.slice(first.end).trim();
  if (!rest) return false;
  const firstWord = rest.split(/\s+/)[0];
  // Measurements must be followed by a number, or "length of the sleeve" would
  // look like a command and cut a description in half.
  if (MEASUREMENT_FIELD.test(first.field)) return /\d/.test(firstWord);
  return true;
}

/**
 * Parse one recognition result (one utterance) against the running state.
 *
 * `newUtterance` says this chunk is a fresh recognition result rather than a
 * continuation of the one that opened the current command; it is the only thing
 * that can close an un-terminated description (see the grammar above).
 */
export function parseVoiceChunk(
  chunk: string,
  state: VoiceParseState = EMPTY_VOICE_STATE,
  opts: { newUtterance?: boolean } = {},
): VoiceParseResult {
  const writes: VoiceWrite[] = [];
  let activeField = state.activeField;
  let pending = state.pending;

  // Every write goes through the title strip: the parser already excludes the
  // matched title from the span, so this is the belt-and-braces layer that also
  // heals a title that arrived inside an accumulated value (report 9).
  const emit = (field: string | null, value: string) => {
    const v = field ? stripFieldTitlePrefix(field, value) : value.trim();
    if (field && v) writes.push({ field, value: v });
  };

  let text = chunk;

  // ── Description already open ────────────────────────────────────────────
  if (activeField === DESCRIPTION_FIELD) {
    const periods = scanPeriods(text);
    if (opts.newUtterance && startsNewCommand(text)) {
      // A fresh utterance that opens with a real command ends the description.
      // Checked BEFORE "period" so "brand nike period" starts a command rather
      // than appending "brand nike" to the description and closing it there.
      emit(DESCRIPTION_FIELD, pending);
      activeField = null;
      pending = '';
    } else if (periods.length > 0) {
      // "period" closes it; whatever follows is parsed as normal commands.
      pending = joinValue(pending, text.slice(0, periods[0].pos));
      emit(DESCRIPTION_FIELD, pending);
      activeField = null;
      pending = '';
      text = text.slice(periods[0].end);
    } else {
      // Still narrating — keep accumulating, and write what we have so far so
      // the field is never empty if the session ends here.
      pending = joinValue(pending, text);
      emit(DESCRIPTION_FIELD, pending);
      return { writes, state: { activeField, pending } };
    }
  }

  // ── Normal command parsing ──────────────────────────────────────────────
  // Boundaries are field titles and "period", walked in positional order.
  for (;;) {
    const titles = scanFieldTitles(text);
    const periods = scanPeriods(text);
    type Boundary = { pos: number; end: number; hit?: Hit };
    const boundaries: Boundary[] = [
      ...titles.map(h => ({ pos: h.pos, end: h.end, hit: h })),
      ...periods.map(p => ({ pos: p.pos, end: p.end })),
    ].sort((a, b) => a.pos - b.pos);

    let cursor = 0;
    let restart: string | null = null;

    for (const b of boundaries) {
      if (b.pos < cursor) continue; // swallowed by a preceding boundary
      pending = joinValue(pending, text.slice(cursor, b.pos));
      emit(activeField, pending);
      pending = '';
      cursor = b.end;

      if (!b.hit) {
        // "period" — closes whatever was open.
        activeField = null;
        continue;
      }

      activeField = b.hit.field;

      if (activeField === DESCRIPTION_FIELD) {
        // The description swallows the rest of this utterance, up to a "period".
        const after = text.slice(cursor);
        const p = scanPeriods(after)[0];
        if (p) {
          emit(DESCRIPTION_FIELD, after.slice(0, p.pos));
          activeField = null;
          pending = '';
          restart = after.slice(p.end);
        } else {
          pending = after.trim();
          emit(DESCRIPTION_FIELD, pending);
          return { writes, state: { activeField, pending } };
        }
        break;
      }
    }

    if (restart !== null) {
      text = restart;
      continue;
    }

    // Tail of the utterance: write it optimistically but keep the field open so
    // a value continued in the next result replaces this partial one.
    pending = joinValue(pending, text.slice(cursor));
    emit(activeField, pending);
    return { writes, state: { activeField, pending } };
  }
}

/**
 * Close whatever command is open and write its value — the "." key, the Period
 * button, Stop Recording, and navigating to another listing all call this so no
 * dictated text is ever silently discarded.
 */
export function flushVoiceState(state: VoiceParseState): VoiceParseResult {
  const value = state.activeField
    ? stripFieldTitlePrefix(state.activeField, state.pending)
    : state.pending.trim();
  const writes: VoiceWrite[] = state.activeField && value
    ? [{ field: state.activeField, value }]
    : [];
  return { writes, state: { activeField: null, pending: '' } };
}

/**
 * Which column should light up while interim (not-yet-final) speech streams in.
 * Returns the CURRENT field when a description is open — narration must never
 * steal the highlight away from it.
 */
export function detectActiveField(interim: string, state: VoiceParseState): string | null {
  if (state.activeField === DESCRIPTION_FIELD) return DESCRIPTION_FIELD;
  const hits = scanFieldTitles(interim);
  return hits.length ? hits[hits.length - 1].field : state.activeField;
}

/**
 * Surgically sync ONE field edit into the voice transcript: rewrite that field's
 * existing "label value period" span if present, else append one. Everything
 * else — especially freeform narration and OTHER commands sharing the line — is
 * left byte-identical.
 *
 * The span ends at the first "period"/"." terminator OR at the next field title,
 * whichever comes first, so patching `brand` on "brand nike. description soft."
 * can no longer swallow the description. The description field is the exception:
 * its span runs to the terminator only, because its value legitimately contains
 * words that are field titles.
 */
export function patchVoiceLine(text: string, fieldKey: string, value: string): string {
  const label = FIELD_TO_VOICE_LABEL[fieldKey];
  if (!label) return text;
  const val = value.trim();

  const lines = text.split('\n');
  let patched = false;

  for (let li = 0; li < lines.length && !patched; li++) {
    const line = lines[li];
    const hits = scanFieldTitles(line);
    const idx = hits.findIndex(h => h.field === fieldKey);
    if (idx === -1) continue;

    const hit = hits[idx];
    const isDescription = fieldKey === DESCRIPTION_FIELD;
    // End of the value span.
    let end = line.length;
    if (!isDescription && hits[idx + 1]) end = hits[idx + 1].pos;
    const terminator = line
      .slice(hit.end, end)
      .match(new RegExp(`\\b${PERIOD_WORD}\\b|\\.(?=\\s|$)`, 'i'));
    if (terminator && terminator.index !== undefined) {
      end = hit.end + terminator.index + terminator[0].length;
    }

    const replacement = val ? `${label} ${val} ${PERIOD_WORD}` : '';
    lines[li] = (line.slice(0, hit.pos) + replacement + line.slice(end)).replace(/\s{2,}/g, ' ').trim();
    patched = true;
  }

  const next = lines.filter((l, i) => l.trim() !== '' || i === 0 || lines[i - 1].trim() !== '').join('\n');
  if (patched) return next.replace(/\n{2,}/g, '\n').trim();
  if (!val) return text;
  const base = text.trim();
  return base ? `${base}\n${label} ${val} ${PERIOD_WORD}` : `${label} ${val} ${PERIOD_WORD}`;
}

/**
 * Correct the speech-to-text misrecognitions this vocabulary runs into, before
 * any parsing happens. Measurement words are the worst offenders ("with 18" for
 * "width 18", "and seam" for "inseam") because the number that follows makes the
 * intent obvious to a human and invisible to the recogniser.
 */
export function fixTranscript(t: string): string {
  return t
    // "wits 18" / "what's 18" / "whats 18" before a number → "width 18"
    .replace(/\b(wits|what's|whats|wit's)\b(?=\s+\d)/gi, 'width')
    .replace(/\bwith\b(?=\s+\d)/gi, 'width')   // "with 18 inches" → "width 18 inches"
    .replace(/\bwidth\b(?=\s+(a|an|the)\b)/gi, 'with') // "width a great" → "with a great"
    .replace(/\bwidth\b(?=\s+[a-z]{3,}(?!\s*\d))/gi, 'with') // "width nice" → "with nice"
    // Common measurement word misrecognitions
    .replace(/\b(shows|shower|shoulder's|shoulders)\b(?=\s+\d)/gi, 'shoulder')
    .replace(/\b(waste|ways|waist's)\b(?=\s+\d)/gi, 'waist')
    // inseam: many STT engines mis-hear it ("and seam", "in seem", "in steam", etc.)
    .replace(/\b(in seam|in-seam|unseam|and seam|in seem|in steam|in-scene|in scene|in-team|inseams?)\b(?=\s+[\d])/gi, 'inseam')
    .replace(/\b(in seam|in-seam|unseam|and seam|in seem|in steam)\b/gi, 'inseam')
    .replace(/\b(out seam|out-seam|out seem|out-seem|outseams?)\b/gi, 'outseam')
    .replace(/\b(chest's|chess|jest)\b(?=\s+\d)/gi, 'chest')
    .replace(/\b(hip's|hips)\b(?=\s+\d)/gi, 'hip')
    .replace(/\b(sleeve's|sleeves)\b(?=\s+\d)/gi, 'sleeve')
    .replace(/\b(length's|lengths)\b(?=\s+\d)/gi, 'length')
    // "30 and a half" / "30 and half" → "30.5"
    .replace(/(\d+)\s+and\s+a?\s*half\b/gi, (_, n) => String(parseFloat(n) + 0.5))
    // Normalize "inches" / "inch" / "in." after a number so the number is clean
    .replace(/(\d+(?:\.\d+)?)\s*(?:inches|inch|in\.)\b/gi, '$1');
}
