/**
 * brandSpelling — "the microphone heard *echo unlimited*, the tag says **Ecko
 * Unltd**" (founder report 14).
 *
 * Speech-to-text has no idea that clothing labels are deliberately misspelled.
 * Ecko Unltd, Fubu, Kappa, Le Tigre, Guess?, Stüssy, Dickies, Hurley — the
 * recogniser returns the ENGLISH word it heard, so the brand field fills with
 * something plausible and wrong, and that wrong string then flows into the
 * title, the tags and the CSV.
 *
 * This module is the pure half of the fix: normalisation, a phonetic code, edit
 * distance, and a ranker that puts a workspace's own saved spellings first. The
 * IO half (the `brand_aliases` table) is brandAliasService.ts; the UX is in
 * Step 3 and the Vocabulary dashboard.
 *
 * DEPENDENCY-FREE BY REQUIREMENT — Levenshtein and the Soundex-style phonetic
 * code are implemented here rather than pulled from npm.
 */

// ── Normalisation ──────────────────────────────────────────────────────────

/**
 * The comparison form of a brand name. Case, punctuation and the &/and
 * alternation all vary freely between what a person says, what the tag prints
 * and what a previous session stored, and none of them change the brand.
 *
 *   "Ecko Unltd."  "ECKO UNLTD"  "ecko unltd"   → "ecko unltd"
 *   "Dolce & Gabbana"  "Dolce and Gabbana"      → "dolce and gabbana"
 *   "Levi's"  "Levis"                           → "levis"
 */
export function normalizeBrand(raw: string): string {
  return (raw || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')   // stüssy → stussy
    .replace(/&/g, ' and ')
    .replace(/['’`]/g, '')                          // levi's → levis
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Words that carry no identity and must not dominate a similarity score. */
const NOISE_WORDS = new Set(['the', 'co', 'company', 'inc', 'llc', 'ltd', 'brand', 'clothing', 'apparel']);

const brandTokens = (raw: string): string[] =>
  normalizeBrand(raw).split(' ').filter(w => w && !NOISE_WORDS.has(w));

// ── Edit distance ──────────────────────────────────────────────────────────

/** Classic Levenshtein, two-row (O(min) memory). */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array<number>(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

/** 1 = identical, 0 = nothing in common. */
export function similarity(a: string, b: string): number {
  const longest = Math.max(a.length, b.length);
  if (longest === 0) return 1;
  return 1 - levenshtein(a, b) / longest;
}

// ── Phonetic code ──────────────────────────────────────────────────────────

const SOUNDEX_CODE: Record<string, string> = {
  b: '1', f: '1', p: '1', v: '1',
  c: '2', g: '2', j: '2', k: '2', q: '2', s: '2', x: '2', z: '2',
  d: '3', t: '3',
  l: '4',
  m: '5', n: '5',
  r: '6',
};

/**
 * A Soundex code with a metaphone-style digraph pass in front of it — enough
 * "sounds like" to pair echo with ecko, kappa with capa, hurley with hurly and
 * phat with fat, without the size (or the dependency) of a full double
 * metaphone.
 *
 * The digraph pass is what plain Soundex cannot do: `x`→`ks`, `kn`→`n`,
 * `wr`→`r` and the hard/soft `c` fold genuinely change the code — and those are
 * exactly the spellings fashion labels like to use.
 */
export function phoneticCode(word: string): string {
  const w = (word || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z]/g, '')
    .replace(/^kn/, 'n').replace(/^gn/, 'n').replace(/^wr/, 'r').replace(/^ps/, 's')
    .replace(/sch/g, 'sk').replace(/ph/g, 'f').replace(/ck/g, 'k').replace(/gh/g, 'g')
    .replace(/x/g, 'ks')
    // Hard/soft C. Soundex keeps the first LETTER verbatim, so "Kappa" and
    // "Capa" — the single most common way a recogniser mangles a fashion label —
    // would never pair. Folding c onto k or s by the vowel that follows is
    // ordinary metaphone and fixes it at the source.
    .replace(/c(?=[eiy])/g, 's')
    .replace(/c/g, 'k');
  if (!w) return '';
  const first = w[0].toUpperCase();
  let prev = SOUNDEX_CODE[w[0]] ?? '';
  let out = '';
  for (let i = 1; i < w.length; i++) {
    const c = w[i];
    const code = SOUNDEX_CODE[c] ?? '';
    if (code && code !== prev) out += code;
    // h and w are transparent: "ashcroft" must not gain a code from the h.
    if (c !== 'h' && c !== 'w') prev = code;
  }
  return (first + out + '000').slice(0, 4);
}

/** Per-word phonetic codes, noise words dropped. */
export function phoneticKey(brand: string): string {
  return brandTokens(brand).map(phoneticCode).join(' ');
}

// ── Matching ───────────────────────────────────────────────────────────────

export type BrandSource = 'alias' | 'vocab' | 'builtin';

export interface BrandCandidate {
  /** The preferred spelling, exactly as it should be written into the field. */
  brand: string;
  source: BrandSource;
  /**
   * For an alias row: the misheard form this candidate is registered under.
   * An exact hit on it is a certainty, not a guess.
   */
  heard?: string;
}

export interface BrandMatch {
  brand: string;
  source: BrandSource;
  score: number;
  /** `alias` and `exact` are certainties; `phonetic`/`fuzzy` are suggestions. */
  reason: 'alias' | 'exact' | 'phonetic' | 'fuzzy';
}

/** Below this, a candidate is not offered at all. */
export const SUGGEST_THRESHOLD = 0.72;

/** Source order breaks ties: what this workspace saved beats the global library. */
const SOURCE_RANK: Record<BrandSource, number> = { alias: 3, vocab: 2, builtin: 1 };

/**
 * Word-aligned similarity. Names are compared token by token (in order), each
 * pair scored as the BETTER of its spelling similarity and its phonetic
 * similarity, and the result averaged over the longer name.
 *
 * Why not one distance over the whole string: "echo unlimited" → "ecko unltd"
 * is 6 edits out of 14 characters (0.57 — under any sane threshold), but per
 * word it is a perfect phonetic hit on *echo/ecko* and a 0.75 phonetic hit on
 * *unlimited/unltd*, i.e. 0.87. The abbreviation is concentrated in one word,
 * and averaging per word is what stops it from drowning the match.
 */
export function brandSimilarity(a: string, b: string): number {
  const ta = brandTokens(a);
  const tb = brandTokens(b);
  if (!ta.length || !tb.length) return 0;

  const joinedA = ta.join('');
  const joinedB = tb.join('');
  // "ecko unltd" vs "eckounltd" — spacing is not a difference.
  const whole = similarity(joinedA, joinedB);

  const n = Math.max(ta.length, tb.length);
  let total = 0;
  for (let i = 0; i < n; i++) {
    const wa = ta[i];
    const wb = tb[i];
    if (wa === undefined || wb === undefined) continue;   // extra word scores 0
    const spell = similarity(wa, wb);
    const ca = phoneticCode(wa);
    const cb = phoneticCode(wb);
    // A word with no letters ("47", "212") has an EMPTY code, and two empty
    // codes would otherwise compare as a perfect phonetic match — scoring the
    // brands "47" and "212 NYC" as identical. Spelling is the only evidence
    // there is for such a word.
    if (!ca || !cb) { total += spell; continue; }
    total += Math.max(spell, ca === cb ? 1 : similarity(ca, cb));
  }
  return Math.max(whole, total / n);
}

/**
 * Rank candidate spellings for something the microphone heard, best first.
 *
 * An alias row whose `heard` matches exactly is returned with score 1 and
 * reason `alias` — that is a decision the workspace already made, and the UI
 * applies it without asking. Everything else is a suggestion.
 */
export function rankBrandMatches(
  heard: string,
  candidates: BrandCandidate[],
  limit = 5,
): BrandMatch[] {
  const key = normalizeBrand(heard);
  if (!key) return [];

  const scored: BrandMatch[] = [];
  const seen = new Set<string>();

  for (const c of candidates) {
    if (!c.brand) continue;
    const brandKey = normalizeBrand(c.brand);
    if (!brandKey) continue;

    let score: number;
    let reason: BrandMatch['reason'];

    if (c.heard && normalizeBrand(c.heard) === key) {
      score = 1; reason = 'alias';
    } else if (brandKey === key) {
      score = 1; reason = 'exact';
    } else {
      score = brandSimilarity(key, brandKey);
      reason = phoneticKey(key) === phoneticKey(brandKey) ? 'phonetic' : 'fuzzy';
      if (reason === 'phonetic') score = Math.max(score, 0.9);
    }
    if (score < SUGGEST_THRESHOLD) continue;

    // Keep only the strongest entry per preferred spelling.
    const dedupeKey = `${brandKey}`;
    const existing = seen.has(dedupeKey)
      ? scored.find(m => normalizeBrand(m.brand) === brandKey)
      : undefined;
    if (existing) {
      if (score > existing.score || (score === existing.score && SOURCE_RANK[c.source] > SOURCE_RANK[existing.source])) {
        existing.score = score; existing.source = c.source; existing.reason = reason; existing.brand = c.brand;
      }
      continue;
    }
    seen.add(dedupeKey);
    scored.push({ brand: c.brand, source: c.source, score, reason });
  }

  scored.sort((a, b) =>
    b.score - a.score ||
    SOURCE_RANK[b.source] - SOURCE_RANK[a.source] ||
    a.brand.localeCompare(b.brand));
  return scored.slice(0, limit);
}

export interface BrandResolution {
  /** What the field should hold. Equal to `heard` when nothing better is known. */
  brand: string;
  /** Set when an alias fired: apply silently, offer Undo. */
  applied?: BrandMatch;
  /** Set when a strong-but-unconfirmed match exists: ask "Did you mean …?". */
  suggestion?: BrandMatch;
}

/**
 * The one call Step 3 makes when a brand arrives from voice.
 *
 *   exact alias        → applied  (field rewritten, "Corrected … · Undo")
 *   already correct    → neither  (an exact candidate means the heard spelling IS the brand)
 *   strong near match  → suggestion ("Did you mean …?" Use / Ignore)
 *   nothing            → neither
 */
export function resolveHeardBrand(heard: string, candidates: BrandCandidate[]): BrandResolution {
  const trimmed = (heard || '').trim();
  if (!trimmed) return { brand: trimmed };
  const matches = rankBrandMatches(trimmed, candidates, 3);
  const best = matches[0];
  if (!best) return { brand: trimmed };

  if (best.reason === 'alias') return { brand: best.brand, applied: best };
  // An exact hit means the recogniser got it right — say nothing.
  if (best.reason === 'exact') return { brand: best.brand };
  if (normalizeBrand(best.brand) === normalizeBrand(trimmed)) return { brand: trimmed };
  return { brand: trimmed, suggestion: best };
}

// ── The seller name is not a garment brand (founder report 23) ─────────────

/**
 * True when `brand` is really the SHOP's name. The CSV Vendor column carries the
 * reseller ("C&D Vintage"); the brand field carries what is printed on the tag.
 * A value that is both is always the former leaking into the latter.
 */
export function isSellerName(brand: string | undefined, sellerNames: (string | undefined)[]): boolean {
  const b = normalizeBrand(brand || '');
  if (!b) return false;
  return sellerNames.some(n => {
    const s = normalizeBrand(n || '');
    return !!s && s === b;
  });
}

/** `brand` unless it is a seller name, in which case nothing. */
export function scrubSellerBrand(
  brand: string | undefined,
  sellerNames: (string | undefined)[],
): string | undefined {
  return isSellerName(brand, sellerNames) ? undefined : (brand || undefined);
}
