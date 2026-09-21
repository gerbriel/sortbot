import type { ClothingItem } from '../App';
import type { ModelRow } from './vocabService';

/**
 * identification — dating a garment, judging its condition and guessing how
 * rare it is, from what the seller already said out loud.
 *
 * WHY IT IS RULES AND NOT A MODEL. The plan (docs/pricing/00-plan.md, step 2)
 * puts identification before pricing because it is useful the moment it exists:
 * era and condition go straight into titles, descriptions and tags. And it is
 * rule-based first because the inputs are already in the app — the dictation,
 * the 917-brand knowledge base, `vocab_models`, the descriptor chips — so this
 * needs no key, no network and no per-listing cost, and it runs in under a
 * millisecond on a listing.
 *
 * WHY EVERY ANSWER CARRIES EVIDENCE. A bare "1990s" is a claim a reseller
 * cannot check and will not trust. `{ era: '1990s', evidence: [single stitch →
 * pre-1995, brand active from 1971] }` is a claim they can argue with — and
 * arguing with it is exactly the correction this app wants to capture
 * (`pricing_events.corrected`). The evidence list is not decoration; it is what
 * makes the suggestion auditable, and it is what the Step 3 card's "Why" shows.
 *
 * DETERMINISTIC. No Date, no Math.random, no network, no DOM. The same input
 * always produces the same output, byte for byte — which is what lets the
 * captured runs be compared against each other later (plan step 7).
 *
 * AND DEPENDENCY-FREE, which is load-bearing rather than tidy. The brand
 * knowledge base (`vintagePatternEngine`'s `BRAND_DNA`) is ~113 kB and its only
 * other importer, `builtinBrandVocab`, is reached by DYNAMIC import precisely so
 * it stays out of the first paint (§14 #47). A static import here — measured —
 * moved the main bundle from 1,046 kB to 1,160 kB. So the two facts this module
 * wants from it are an INPUT (`brandFacts`), and `loadBrandFacts` at the bottom
 * fetches them behind the same dynamic import, cached for the session. That also
 * means the tests state the brand facts they are testing instead of depending on
 * which brands happen to be in a 1,400-line table.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THE RULES, AND WHAT EACH ONE IS WORTH
 *
 * Weights are a rough confidence in the SIGNAL, not a probability. They are
 * chosen so that one strong signal is not outvoted by two weak ones, and so
 * that a field the seller typed by hand always wins.
 *
 * ERA
 *   kind          signal                                             weight
 *   field         `item.era` is set (the seller typed or dictated it)  1.00
 *   voice         a decade said out loud ("eighties", "'90s", "y2k")   0.60
 *   construction  single stitch              → not after 1995          0.45
 *   construction  union made / ILGWU label   → not after 1998          0.45
 *   construction  talon / conmar / crown zip → not after 1975          0.40
 *   construction  tagless / printed neck tag → not before 2000         0.30
 *   construction  paper thin / paper tag     → not after 1999          0.25
 *   construction  double stitch              → not before 1990         0.20
 *   construction  printed care label         → not before 1972         0.15
 *
 *   A bound is a YEAR and a candidate is a DECADE, so a cue agrees when the two
 *   OVERLAP — "single stitch, not after 1995" agrees with the 1990s.
 *   brand         BRAND_DNA.eras narrows to a single decade            0.30
 *   brand         BRAND_DNA.eras merely CONTAINS the candidate         0.15
 *   model         vocab_models.year_introduced brackets the candidate  0.35
 *
 *   `year_introduced` is the one HARD constraint: a decade that ends before the
 *   model existed is ruled out, not marked down. Everything else is a weight.
 *   A construction cue that CONTRADICTS the chosen era subtracts its weight
 *   instead of adding it, and its line still appears — a low-confidence answer
 *   that shows both sides is worth more than a confident answer that hid one.
 *   A REJECTED candidate's own spoken proposal is carried onto the winner as a
 *   dissenting line for the same reason, unless the winner is the field the
 *   seller typed, which is never second-guessed.
 *
 * CONDITION
 *   field         `item.condition` already set                         1.00
 *   voice         "nwt" / "new with tags" / "deadstock" → NWT          0.80
 *   voice         "excellent" / "like new" / "mint"     → Excellent    0.60
 *   voice         "good condition" / "solid"            → Good         0.50
 *   voice         "fair" / "rough" / "beater"           → Fair         0.55
 *   voice         a flaw word (holes, stains, cracked print, …)        0.35
 *                 — three or more distinct flaws pull the grade to Fair
 *                 — a WORN flaw (holes/stains/pilling/fraying/thin/odour)
 *                   overrides a SPOKEN claim of NWT, down to Excellent
 *   voice         a wear word (faded, distressed, …) with no flaw      0.25 → Good
 *
 *   FLAWS ARE COLLECTED SEPARATELY FROM THE GRADE, always. "Faded" is a look a
 *   buyer pays for; "pit stains" is a defect that must be disclosed. Folding
 *   them into one letter grade loses the disclosure, which is the half that
 *   matters legally and for returns.
 *
 * RARITY (0..1)
 *   model         vocab_models.collectibility ÷ 10                     0.70
 *   voice         "deadstock" / "rare" / "grail" / "holy grail" / "1 of 1"  0.45
 *   brand         BRAND_DNA.pricePoint luxury .85 / premium .65 / mid .40 / budget .25  0.40
 *   era           the chosen era is pre-1990                           0.25
 *
 *   The score is a weighted mean of whatever fired, so a piece with no signal
 *   scores 0 with zero confidence rather than a made-up middle.
 * ────────────────────────────────────────────────────────────────────────────
 */

// ── Types ───────────────────────────────────────────────────────────────────

/** Where one line of reasoning came from. `field` is the seller's own typing. */
export type EvidenceKind = 'voice' | 'brand' | 'model' | 'tag' | 'construction' | 'field';

export interface Evidence {
  kind: EvidenceKind;
  /** One short sentence, shown verbatim in the card's "Why" list. */
  text: string;
  /** 0..1. Negative is not used — a contradiction is recorded by `agrees`. */
  weight: number;
  /** false when this line argues AGAINST the answer above it. */
  agrees?: boolean;
}

export interface Facet<T> {
  value: T;
  evidence: Evidence[];
  /** 0..1 */
  confidence: number;
}

export type ConditionValue = NonNullable<ClothingItem['condition']>;

export interface Identification {
  era: Facet<string | null>;
  condition: Facet<ConditionValue | null> & { flaws: string[] };
  rarity: { score: number; evidence: Evidence[]; confidence: number };
  /** Weighted mean of the three facets — what the review rule reads. */
  confidence: number;
  suggestions: {
    title?: string;
    tags?: string[];
    metafields?: Record<string, string>;
  };
}

/**
 * The two things this pass wants from the brand knowledge base. Injected rather
 * than imported — see the header note about the bundle.
 */
export interface BrandFacts {
  /** Canonical `'1990s'`-shaped decades the brand is recorded in. */
  eras: string[];
  pricePoint: 'budget' | 'mid' | 'premium' | 'luxury';
}

export interface IdentifyInput {
  item: ClothingItem;
  /** The dictation, the generated description, the descriptor chips — whatever
   *  words exist about this piece. Concatenated by the caller. */
  transcript: string;
  /** Words the founder vocabulary associates with the brand (`brand_keywords`). */
  brandTerms?: string[];
  /** The matching `vocab_models` row, when the brand + model are known. */
  model?: ModelRow | null;
  /** What the knowledge base knows about this brand, if the caller has loaded it. */
  brandFacts?: BrandFacts | null;
}

/** The engine's own version, stored in `listing_identifications.model` so two
 *  eras of suggestion can be compared on a held-out set later (plan step 7). */
export const IDENTIFICATION_ENGINE = 'rules@1';

// ── Small helpers ───────────────────────────────────────────────────────────

const clamp01 = (n: number): number =>
  !Number.isFinite(n) ? 0 : n < 0 ? 0 : n > 1 ? 1 : n;

/** Two decimals, the precision `listing_identifications.rarity` stores. */
const round2 = (n: number): number => Math.round(n * 100) / 100;
/** Three decimals, the precision every `confidence` column stores. */
const round3 = (n: number): number => Math.round(n * 1000) / 1000;

/**
 * Lower-cased, punctuation-flattened text with single spaces and a leading and
 * trailing space, so every lookup below can use ` word ` and get a real word
 * boundary without a RegExp per phrase. The apostrophe is kept, because `'90s`
 * and `80's` are how a decade is actually written.
 */
function normalizeText(...parts: Array<string | null | undefined>): string {
  const joined = parts.filter(Boolean).join(' ').toLowerCase();
  return ` ${joined.replace(/[^a-z0-9''\s-]+/g, ' ').replace(/\s+/g, ' ').trim()} `;
}

const has = (hay: string, phrase: string): boolean => hay.includes(` ${phrase} `);
const hasAny = (hay: string, phrases: readonly string[]): boolean =>
  phrases.some(p => has(hay, p));
/** The first phrase in `phrases` that appears — order is the priority. */
const firstOf = (hay: string, phrases: readonly string[]): string | null =>
  phrases.find(p => has(hay, p)) ?? null;

// ── Era ─────────────────────────────────────────────────────────────────────

/**
 * Spoken and written forms of a decade → the canonical label.
 *
 * Longest-first matching is not needed here because the keys are word-bounded
 * and none is a prefix of another — but `y2k` deliberately maps to `2000s`
 * rather than being its own era, because that is what `normalizeEra` in
 * textAIService and every downstream title formula already understand.
 */
const ERA_WORDS: ReadonlyArray<readonly [string, string]> = [
  ['1900s', '1900s'], ["00s", '1900s'],
  ['nineteen tens', '1910s'], ['1910s', '1910s'],
  ['twenties', '1920s'], ['1920s', '1920s'], ["20's", '1920s'], ["'20s", '1920s'],
  ['thirties', '1930s'], ['1930s', '1930s'], ["30's", '1930s'], ["'30s", '1930s'],
  ['forties', '1940s'], ['1940s', '1940s'], ["40's", '1940s'], ["'40s", '1940s'],
  ['fifties', '1950s'], ['1950s', '1950s'], ["50's", '1950s'], ["'50s", '1950s'],
  ['sixties', '1960s'], ['1960s', '1960s'], ["60's", '1960s'], ["'60s", '1960s'],
  ['seventies', '1970s'], ['1970s', '1970s'], ["70's", '1970s'], ["'70s", '1970s'],
  ['eighties', '1980s'], ['1980s', '1980s'], ["80's", '1980s'], ["'80s", '1980s'],
  ['nineties', '1990s'], ['1990s', '1990s'], ["90's", '1990s'], ["'90s", '1990s'],
  ['y2k', '2000s'], ['two thousands', '2000s'], ['2000s', '2000s'], ["00's", '2000s'],
  ['twenty tens', '2010s'], ['2010s', '2010s'], ["10's", '2010s'],
  ['twenty twenties', '2020s'], ['2020s', '2020s'],
];

/** Canonical era label → the decade it starts in, for arithmetic. */
export function eraStartYear(era: string | null | undefined): number | null {
  const m = /^(\d{4})s$/.exec((era ?? '').trim());
  return m ? Number(m[1]) : null;
}

/**
 * A construction cue: the words that trigger it, and the years it implies.
 *
 * THE BOUNDS ARE YEARS AND THE CANDIDATES ARE DECADES, so the test is OVERLAP,
 * not comparison — a cue agrees with a decade when the two share any year at
 * all. Comparing the bound against the decade's START instead (the first way
 * this was written) made "single stitch, pre-1995" CONTRADICT the 1990s, because
 * 1990 is not before 1995 by that test — which is wrong about the single most
 * used dating cue in resale, and wrong in the direction that makes the app argue
 * with a seller who is right.
 */
interface ConstructionCue {
  phrases: readonly string[];
  /** The latest plausible year. A decade agrees while `start <= notAfter`. */
  notAfter?: number;
  /** The earliest plausible year. A decade agrees while `start + 9 >= notBefore`. */
  notBefore?: number;
  weight: number;
  text: string;
}

/**
 * The construction cues, in the order a reseller would reach for them.
 *
 * These are the ones with a real, widely-agreed date boundary. Deliberately
 * NOT included: "made in usa" on its own (plenty of brands still do), tag
 * fonts, and copyright dates — the first is not a signal, and the other two are
 * not in the words this app has.
 */
const CONSTRUCTION_CUES: readonly ConstructionCue[] = [
  {
    phrases: ['single stitch', 'single-stitch', 'single stitched'],
    notAfter: 1995, weight: 0.45,
    text: 'Single stitch hem — mass-market tees moved to double stitch by the mid 1990s',
  },
  {
    phrases: ['union made', 'union label', 'ilgwu', 'amalgamated'],
    notAfter: 1998, weight: 0.45,
    text: 'Union label — US garment union labels are pre-late-1990s',
  },
  {
    phrases: ['talon zipper', 'talon', 'conmar', 'crown zipper', 'scovill'],
    notAfter: 1975, weight: 0.4,
    text: 'Talon / Conmar / Crown zipper — those makers were displaced through the 1970s',
  },
  {
    phrases: ['paper thin', 'paper tag', 'butter soft', 'buttery soft'],
    notAfter: 1999, weight: 0.25,
    text: 'Paper-thin, well-worn cotton — consistent with decades of wear',
  },
  {
    phrases: ['double stitch', 'double-stitch', 'double stitched'],
    notBefore: 1990, weight: 0.2,
    text: 'Double stitch hem — the norm from the mid 1990s on',
  },
  {
    phrases: ['tagless', 'tagless tag', 'heat transfer tag', 'printed tag'],
    notBefore: 2000, weight: 0.3,
    text: 'Tagless / printed neck label — 2000s and later',
  },
  {
    phrases: ['rn number', 'ca number', 'care tag', 'care label'],
    notBefore: 1972, weight: 0.15,
    text: 'Printed care label — US care labelling became standard in the 1970s',
  },
];

interface EraCandidate {
  era: string;
  evidence: Evidence[];
  score: number;
  /** A decade that ENDS before the model existed. Not a low score — ruled out. */
  impossible?: boolean;
}

/**
 * PURE. Date the piece.
 *
 * The shape of the algorithm matters more than any one weight: candidates are
 * PROPOSED by the strong signals (the typed field, a spoken decade, a brand
 * whose whole history is one decade), then every construction cue is scored
 * FOR or AGAINST each candidate, and the best total wins. A cue can therefore
 * never invent an era on its own — "single stitch" says pre-1995, which is five
 * decades, and picking one of them would be a guess dressed as a finding.
 */
export function identifyEra(input: IdentifyInput): Facet<string | null> {
  const { item, transcript, model, brandFacts } = input;
  const text = normalizeText(transcript, item.customDescription, item.generatedDescription,
    (item.tags ?? []).join(' '));

  const candidates = new Map<string, EraCandidate>();
  const add = (era: string, ev: Evidence) => {
    const hit = candidates.get(era);
    if (hit) { hit.evidence.push(ev); hit.score += ev.weight; return; }
    candidates.set(era, { era, evidence: [ev], score: ev.weight });
  };

  // 1. The seller's own field. Nothing outranks it.
  const typed = (item.era ?? '').trim();
  if (typed) {
    const canonical = /^\d{4}s$/.test(typed) ? typed : null;
    add(canonical ?? typed, {
      kind: 'field', weight: 1,
      text: `You set the era to ${typed}`,
      agrees: true,
    });
  }

  // 2. A decade said out loud.
  for (const [phrase, era] of ERA_WORDS) {
    if (!has(text, phrase)) continue;
    add(era, { kind: 'voice', weight: 0.6, text: `Heard "${phrase}" in the notes`, agrees: true });
    break;   // one spoken decade is the claim; a second is narration
  }

  // 3. A brand whose whole recorded history is one decade is a proposal; a
  //    brand with a long history can only corroborate (step 5).
  // A `BRAND_DNA` eras entry is already `'1990s'`-shaped; anything else in the
  // table (a decade-less note) is not a decade and is ignored.
  const eras = (brandFacts?.eras ?? []).filter(e => /^\d{4}s$/.test(e));
  if (eras.length === 1) {
    add(eras[0], {
      kind: 'brand', weight: 0.3,
      text: `${item.brand} is recorded only in the ${eras[0]}`,
      agrees: true,
    });
  }

  // 4. A model with a known introduction year proposes its own decade.
  if (model?.year_introduced && model.year_introduced > 1900) {
    const decade = `${Math.floor(model.year_introduced / 10) * 10}s`;
    add(decade, {
      kind: 'model', weight: 0.35,
      text: `${model.brand} ${model.model_name} was introduced in ${model.year_introduced}`,
      agrees: true,
    });
  }

  if (candidates.size === 0) {
    // Cues with no candidate to attach to are still worth SAYING — they are the
    // reason a seller can be asked "is this from before 1995?" — but they cannot
    // name an era, so the value stays null.
    const orphan: Evidence[] = [];
    for (const cue of CONSTRUCTION_CUES) {
      if (hasAny(text, cue.phrases)) {
        orphan.push({ kind: 'construction', weight: cue.weight, text: cue.text, agrees: true });
      }
    }
    return { value: null, evidence: orphan, confidence: 0 };
  }

  // 5. Score every construction cue and every brand-history mention against
  //    each candidate. This is where a contradiction costs the answer.
  for (const cand of candidates.values()) {
    const start = eraStartYear(cand.era);
    for (const cue of CONSTRUCTION_CUES) {
      if (!hasAny(text, cue.phrases)) continue;
      if (start === null) continue;
      // OVERLAP, not comparison — see the ConstructionCue comment.
      const agrees =
        (cue.notAfter === undefined || start <= cue.notAfter) &&
        (cue.notBefore === undefined || start + 9 >= cue.notBefore);
      cand.evidence.push({ kind: 'construction', weight: cue.weight, text: cue.text, agrees });
      cand.score += agrees ? cue.weight : -cue.weight;
    }
    if (eras.length > 1) {
      const inHistory = eras.includes(cand.era);
      cand.evidence.push({
        kind: 'brand', weight: 0.15, agrees: inHistory,
        text: inHistory
          ? `${item.brand} was active in the ${cand.era}`
          : `${item.brand} is not recorded in the ${cand.era} (${eras[0]}–${eras[eras.length - 1]})`,
      });
      cand.score += inHistory ? 0.15 : -0.15;
    }
    if (model?.year_introduced && model.year_introduced > 1900 && start !== null) {
      // A DOCUMENTED INTRODUCTION YEAR IS A HARD CONSTRAINT, not a weight. A
      // garment cannot predate the model it is — so a decade that ends before
      // that year is ruled OUT rather than merely marked down.
      //
      // Scoring it as a penalty instead was a double-count and got the answer
      // wrong: the same model fact both proposed its own decade (+0.35) and
      // penalised the spoken one (−0.35), which let a 0.35 model proposal beat a
      // 0.60 spoken decade — one piece of evidence casting two votes. Ruling the
      // impossible candidate out uses the fact exactly once, and the spoken
      // decade still survives as DISSENT on the winner (see below), so the
      // seller is told their own words were overruled and why.
      if (start + 9 < model.year_introduced) {
        cand.evidence.push({
          kind: 'model', weight: 0.35, agrees: false,
          text: `${model.model_name} did not exist until ${model.year_introduced}`,
        });
        cand.impossible = true;
      }
    }
  }

  // Best score; ties break toward the EARLIER decade, because the signals that
  // tie are almost always "spoken decade" vs "brand history", and a reseller
  // who said a decade out loud was looking at the garment.
  // A ruled-out candidate sorts last whatever it scored — but it stays in the
  // list, because its own evidence is carried onto the winner below.
  const ranked = [...candidates.values()].sort((a, b) =>
    Number(a.impossible ?? false) - Number(b.impossible ?? false)
    || b.score - a.score
    || (eraStartYear(a.era) ?? 9999) - (eraStartYear(b.era) ?? 9999));
  const best = ranked[0];

  // Everything was ruled out: say nothing rather than name a decade the evidence
  // refuses. The lines still come back, so the card can show why.
  //
  // UNREACHABLE TODAY, and kept deliberately. `year_introduced` is the only hard
  // constraint, and it always proposes its OWN decade, which it can never rule
  // out — so whenever some candidate is impossible there is a possible one to
  // fall back to. It is here so that adding a second hard constraint fails by
  // saying nothing rather than by naming a decade the evidence refuses. There is
  // no test for it because there is no input that reaches it.
  if (best.impossible) {
    return {
      value: null,
      evidence: ranked.flatMap(c => c.evidence),
      confidence: 0,
    };
  }

  // THE REJECTED CANDIDATES STILL HAVE SOMETHING TO SAY. Without this, the most
  // useful sentence this whole pass can produce — "you said the eighties, but
  // this model did not exist until 1998" — was computed and then thrown away,
  // because it lived on the candidate that LOST. A seller reading "1990s" with
  // no mention of the eighties they just said out loud has been contradicted
  // silently, which is the one thing an evidence list exists to prevent.
  //
  // Only `voice` and `field` proposals are carried across: `brand` and `model`
  // proposals are already scored against the winner above (step 5), so carrying
  // them too would count the same objection twice.
  //
  // A winner the seller TYPED is not second-guessed, and keeps confidence 1 —
  // an explicit field is an answer, not a signal, and the house rule everywhere
  // else in this app is that it wins outright (§11, "a user-typed title is
  // respected"). Old narration in a transcript must not cast doubt on it.
  const bestIsTyped = best.evidence.some(e => e.kind === 'field' && e.agrees !== false);
  if (!bestIsTyped) {
    for (const rival of ranked.slice(1)) {
      const proposal = rival.evidence
        .filter(e => e.agrees !== false && (e.kind === 'voice' || e.kind === 'field'))
        .sort((a, b) => b.weight - a.weight)[0];
      if (!proposal) continue;
      // The REASON the rival lost belongs in the same sentence. Carried as two
      // lines it would either double-count the winner's own proposer (the model
      // fact proposed the winner AND ruled the rival out) or need a weightless
      // "context" line, which is a second kind of evidence nobody asked for. One
      // sentence, one weight, the whole story.
      const ruledOut = rival.impossible
        ? rival.evidence.find(e => e.agrees === false && e.kind === 'model')
        : undefined;
      best.evidence.push({
        kind: proposal.kind,
        weight: proposal.weight,
        agrees: false,
        text: ruledOut
          ? `${proposal.text} — but ${ruledOut.text}, so the ${best.era} is used instead`
          : `${proposal.text} — which points at the ${rival.era} instead`,
      });
      best.score -= proposal.weight;
    }
  }

  // Confidence: agreeing weight minus disagreeing, capped. A single 0.6 spoken
  // decade with nothing else is 0.6 — deliberately not 1.0, because one person
  // saying "nineties" over a photo is a good guess and not a dated label.
  const agreeing = best.evidence.filter(e => e.agrees !== false).reduce((s, e) => s + e.weight, 0);
  const against = best.evidence.filter(e => e.agrees === false).reduce((s, e) => s + e.weight, 0);
  return {
    value: best.era,
    evidence: best.evidence,
    confidence: round3(clamp01(agreeing - against)),
  };
}

// ── Condition and flaws ─────────────────────────────────────────────────────

/**
 * Defects, in the words a reseller dictates. The KEY is the canonical flaw the
 * listing records; the phrases are what triggers it.
 *
 * These are disclosures, not descriptions — everything here is something a
 * buyer would be annoyed not to have been told. Wear words that a buyer PAYS
 * for (faded, distressed, broken-in) live in `WEAR_WORDS` below and never
 * become a flaw.
 */
const FLAW_PHRASES: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['holes', ['hole', 'holes', 'holey', 'moth holes', 'moth hole']],
  ['stains', ['stain', 'stains', 'stained', 'pit stains', 'pit stain', 'discoloration', 'discolouration']],
  ['cracked print', ['cracked print', 'cracking print', 'cracked graphic', 'peeling print', 'print cracking']],
  ['pilling', ['pilling', 'pilled']],
  ['fraying', ['fraying', 'frayed', 'frays']],
  ['repairs', ['repair', 'repaired', 'repairs', 'mended', 'patched', 'darned']],
  ['missing button', ['missing button', 'missing buttons', 'button missing']],
  ['broken zipper', ['broken zipper', 'zipper broken', 'stuck zipper', 'zipper sticks']],
  ['pulls', ['pull', 'pulls', 'snag', 'snags', 'snagged']],
  ['thin spots', ['thin spot', 'thin spots', 'worn thin', 'see through', 'see-through']],
  ['odor', ['odor', 'odour', 'smoke smell', 'musty']],
  ['yellowing', ['yellowing', 'yellowed', 'age spots']],
];

/**
 * Flaws that are INCOMPATIBLE WITH UNWORN. "New with tags" is a claim that the
 * garment was never used; a hole, a stain, pilling or an odour says otherwise,
 * whatever was said out loud, and a listing that reads "NWT · holes, stains" is
 * one a buyer opens a case over.
 *
 * Deliberately NOT the whole flaw list: a cracked print, a missing button, a
 * snag or age yellowing all happen to genuinely deadstock pieces sitting in a
 * warehouse for thirty years, and downgrading those would throw away the
 * premium the seller is entitled to.
 */
const WORN_FLAWS: readonly string[] =
  ['holes', 'stains', 'pilling', 'fraying', 'thin spots', 'odor'];

/** Wear a buyer is buying, not a defect. Nudges the grade to Good at most. */
const WEAR_WORDS = [
  'faded', 'fading', 'distressed', 'worn in', 'broken in', 'broken-in',
  'sun faded', 'soft', 'vintage wear', 'patina',
] as const;

const NWT_WORDS = ['nwt', 'new with tags', 'deadstock', 'nos', 'new old stock', 'brand new'] as const;
const EXCELLENT_WORDS = ['excellent', 'excellent condition', 'like new', 'mint', 'near mint', 'pristine'] as const;
const GOOD_WORDS = ['good condition', 'solid', 'very good', 'vgc', 'great condition', 'nice shape'] as const;
const FAIR_WORDS = ['fair', 'fair condition', 'rough', 'beater', 'thrashed', 'as is', 'as-is', 'project piece', 'rough shape'] as const;

/**
 * PURE. Grade the piece and list its defects.
 *
 * Grade and flaws are computed SEPARATELY and both are returned: a listing can
 * be "Good" with three named flaws, and it must be, because the grade is what a
 * buyer filters on and the flaws are what stops a return.
 */
export function identifyCondition(
  input: IdentifyInput,
): Facet<ConditionValue | null> & { flaws: string[] } {
  const { item, transcript } = input;
  const text = normalizeText(transcript, item.customDescription, item.flaws,
    item.generatedDescription, (item.tags ?? []).join(' '));

  const evidence: Evidence[] = [];

  // Flaws first — they inform the grade.
  const flaws: string[] = [];
  for (const [canonical, phrases] of FLAW_PHRASES) {
    const hit = firstOf(text, phrases);
    if (!hit) continue;
    flaws.push(canonical);
    evidence.push({
      kind: 'voice', weight: 0.35, agrees: true,
      text: `Heard "${hit}" — recorded as a flaw`,
    });
  }

  // The seller's own grade wins outright, but the flaws above still stand.
  const typed = item.condition;
  if (typed) {
    return {
      value: typed,
      flaws,
      evidence: [
        { kind: 'field', weight: 1, agrees: true, text: `You set the condition to ${typed}` },
        ...evidence,
      ],
      confidence: 1,
    };
  }

  let value: ConditionValue | null = null;
  let stated = 0;

  // A stated grade, strongest claim first. NWT outranks everything because
  // "new with tags" is a fact about the garment, not an opinion about it.
  const nwt = firstOf(text, NWT_WORDS);
  const fair = firstOf(text, FAIR_WORDS);
  const excellent = firstOf(text, EXCELLENT_WORDS);
  const good = firstOf(text, GOOD_WORDS);
  if (nwt) {
    value = 'NWT'; stated = 0.8;
    evidence.unshift({ kind: 'voice', weight: 0.8, agrees: true, text: `Heard "${nwt}" — new, unworn` });
  } else if (fair) {
    value = 'Fair'; stated = 0.55;
    evidence.unshift({ kind: 'voice', weight: 0.55, agrees: true, text: `Heard "${fair}"` });
  } else if (excellent) {
    value = 'Excellent'; stated = 0.6;
    evidence.unshift({ kind: 'voice', weight: 0.6, agrees: true, text: `Heard "${excellent}"` });
  } else if (good) {
    value = 'Good'; stated = 0.5;
    evidence.unshift({ kind: 'voice', weight: 0.5, agrees: true, text: `Heard "${good}"` });
  }

  // A claim of NEW cannot survive a flaw that only comes from wear. The grade
  // drops to Excellent (not Fair — the piece may still be lovely) and the line
  // names the flaw that did it, so the seller can disagree in one glance.
  // Only NWT is tested, and that is not an oversight: the spoken vocabulary
  // reaches NWT / Fair / Excellent / Good and never 'New', and a condition the
  // seller TYPED returned above with its flaws intact — a typed field wins
  // outright everywhere else in this app and does not stop doing so here.
  const wornFlaw = flaws.find(f => WORN_FLAWS.includes(f));
  if (value === 'NWT' && wornFlaw) {
    evidence.push({
      kind: 'voice', weight: 0.5, agrees: false,
      text: `Heard "new"/"deadstock", but ${wornFlaw} means it has been worn — graded Excellent`,
    });
    value = 'Excellent';
    stated = 0.45;
  }

  // Three or more distinct defects is a Fair piece whatever was said, and the
  // line says so — this is the one place a rule overrides a spoken grade,
  // because "excellent, couple of holes, stains, cracked print" is a listing
  // that gets returned.
  if (flaws.length >= 3 && value !== 'Fair' && value !== 'NWT') {
    evidence.push({
      kind: 'voice', weight: 0.4, agrees: true,
      text: `${flaws.length} separate flaws — graded Fair`,
    });
    value = 'Fair';
    stated = Math.max(stated, 0.4);
  } else if (!value && flaws.length > 0) {
    value = 'Good';
    stated = 0.3;
    evidence.push({
      kind: 'voice', weight: 0.3, agrees: true,
      text: `${flaws.length === 1 ? 'A flaw' : `${flaws.length} flaws`} noted, nothing structural — graded Good`,
    });
  }

  if (!value) {
    const wear = firstOf(text, WEAR_WORDS);
    if (wear) {
      value = 'Good'; stated = 0.25;
      evidence.push({
        kind: 'voice', weight: 0.25, agrees: true,
        text: `Heard "${wear}" — wear a buyer is looking for, not a defect`,
      });
    }
  }

  // Confidence is the STATED claim's weight plus a small amount for each flaw
  // that corroborates it, never the flaws alone: five flaws and no grade word
  // is a piece somebody should look at, not a confident Fair.
  const support = value ? stated + Math.min(0.2, flaws.length * 0.05) : 0;
  return { value, flaws, evidence, confidence: round3(clamp01(support)) };
}

// ── Rarity ──────────────────────────────────────────────────────────────────

const RARITY_WORDS = ['deadstock', 'rare', 'grail', 'holy grail', 'hard to find', 'one of one', '1 of 1', 'sample', 'promo'] as const;

const PRICE_POINT_RARITY: Readonly<Record<string, number>> = {
  luxury: 0.85, premium: 0.65, mid: 0.4, budget: 0.25,
};

/**
 * PURE. How hard this is to find again, 0..1.
 *
 * A WEIGHTED MEAN of whatever fired, not a sum: a piece with one strong signal
 * should score where that signal points, and a piece with no signal should
 * score 0 with zero confidence rather than landing on a made-up middle. The
 * score and the confidence are separate numbers on purpose — "probably common,
 * and we are sure" and "unknown" must not render the same.
 */
export function identifyRarity(input: IdentifyInput, era: string | null): {
  score: number; evidence: Evidence[]; confidence: number;
} {
  const { item, transcript, model, brandFacts } = input;
  const text = normalizeText(transcript, item.customDescription, (item.tags ?? []).join(' '));

  const parts: Array<{ value: number; weight: number; ev: Evidence }> = [];

  if (typeof model?.collectibility === 'number' && model.collectibility > 0) {
    const value = clamp01(model.collectibility / 10);
    parts.push({
      value, weight: 0.7,
      ev: {
        kind: 'model', weight: 0.7, agrees: true,
        text: `${model.brand} ${model.model_name} is rated ${model.collectibility}/10 for collectibility`,
      },
    });
  }

  const word = firstOf(text, RARITY_WORDS);
  if (word) {
    parts.push({
      value: 0.8, weight: 0.45,
      ev: { kind: 'voice', weight: 0.45, agrees: true, text: `Heard "${word}"` },
    });
  }

  if (brandFacts) {
    const value = PRICE_POINT_RARITY[brandFacts.pricePoint] ?? 0.4;
    parts.push({
      value, weight: 0.4,
      ev: {
        kind: 'brand', weight: 0.4, agrees: true,
        text: `${item.brand} sits at the ${brandFacts.pricePoint} price point`,
      },
    });
  }

  const start = eraStartYear(era);
  if (start !== null && start < 1990) {
    parts.push({
      value: 0.6, weight: 0.25,
      ev: { kind: 'construction', weight: 0.25, agrees: true, text: `Dated to the ${era} — fewer survive` },
    });
  }

  if (parts.length === 0) return { score: 0, evidence: [], confidence: 0 };

  const totalWeight = parts.reduce((s, p) => s + p.weight, 0);
  const score = parts.reduce((s, p) => s + p.value * p.weight, 0) / totalWeight;
  return {
    score: round2(clamp01(score)),
    evidence: parts.map(p => p.ev),
    // Confidence in the SCORE, which is how much signal there was. Capped at
    // 0.9: rarity is a judgement and this engine has never seen the garment.
    confidence: round3(clamp01(Math.min(0.9, totalWeight))),
  };
}

// ── Suggestions ─────────────────────────────────────────────────────────────

/**
 * Tags and metafields the run is confident enough to offer.
 *
 * DELIBERATELY SMALL. The title/tag engine in textAIService is already very
 * good at this and owns the 60-character title rules, the synonym groups and
 * the stop-word set; duplicating any of that here would produce a second
 * opinion the app would then have to choose between. What this adds is only
 * what identification KNOWS and the text engine cannot infer: the era as a tag,
 * the condition, and the named flaws.
 */
function buildSuggestions(
  item: ClothingItem,
  era: string | null,
  condition: ConditionValue | null,
  flaws: string[],
  brandTerms: readonly string[],
): Identification['suggestions'] {
  const tags = new Set<string>();
  if (era) tags.add(era);
  if (era === '2000s') tags.add('y2k');
  if (condition === 'NWT') tags.add('deadstock');
  for (const t of brandTerms.slice(0, 4)) {
    const cleaned = t.trim().toLowerCase();
    if (cleaned) tags.add(cleaned);
  }

  const metafields: Record<string, string> = {};
  if (era) metafields.era = era;
  if (condition) metafields.condition = condition;
  if (flaws.length) metafields.flaws = flaws.join(', ');

  const out: Identification['suggestions'] = {};
  if (tags.size) out.tags = [...tags];
  if (Object.keys(metafields).length) out.metafields = metafields;
  // A title is suggested ONLY when the listing has none — never as a competing
  // rewrite of one the seller already has (§11's "a user-typed title is
  // respected" rule).
  if (!(item.seoTitle ?? '').trim()) {
    const parts = [era, item.brand, item.productType || item.category].filter(Boolean);
    if (parts.length >= 2) out.title = parts.join(' ');
  }
  return out;
}

// ── The whole pass ──────────────────────────────────────────────────────────

/**
 * PURE. One run of identification over one listing.
 *
 * The overall confidence is a WEIGHTED MEAN across the three facets — era 0.4,
 * condition 0.4, rarity 0.2 — because era and condition are the two that change
 * what a buyer pays, and rarity is the one this engine is least able to judge
 * without having seen the garment.
 */
export function identifyListing(input: IdentifyInput): Identification {
  const era = identifyEra(input);
  const condition = identifyCondition(input);
  const rarity = identifyRarity(input, era.value);

  const confidence = round3(clamp01(
    era.confidence * 0.4 + condition.confidence * 0.4 + rarity.confidence * 0.2,
  ));

  return {
    era,
    condition,
    rarity,
    confidence,
    suggestions: buildSuggestions(
      input.item, era.value, condition.value, condition.flaws, input.brandTerms ?? [],
    ),
  };
}

/** Human wording for a 0..1 confidence — the chip in the Step 3 card. */
export function confidenceLabel(confidence: number): 'High' | 'Medium' | 'Low' {
  if (confidence >= 0.75) return 'High';
  if (confidence >= 0.45) return 'Medium';
  return 'Low';
}

// ── The brand knowledge base, loaded only if it is wanted ───────────────────

/**
 * `BrandFacts` for one brand, from `BRAND_DNA`.
 *
 * DYNAMIC IMPORT, cached for the session. The table is ~113 kB and its other
 * importer (`builtinBrandVocab`, which `brandAliasService` reaches on the first
 * unknown brand) is already lazy for the same reason — so this shares that chunk
 * rather than adding one, and a session that never opens Step 3 never pays for
 * it. An unknown brand, or a failed load, resolves to `null`, and the pass above
 * simply has one fewer signal.
 */
const brandFactsCache = new Map<string, BrandFacts | null>();
let brandDnaModule: Promise<Record<string, BrandFacts>> | null = null;

export async function loadBrandFacts(
  brand: string | null | undefined,
): Promise<BrandFacts | null> {
  const key = (brand ?? '').trim().toLowerCase();
  if (!key) return null;
  if (brandFactsCache.has(key)) return brandFactsCache.get(key) ?? null;
  try {
    brandDnaModule ??= import('./vintagePatternEngine')
      .then(m => m.BRAND_DNA as unknown as Record<string, BrandFacts>);
    const table = await brandDnaModule;
    const hit = table[key] ?? null;
    const facts = hit ? { eras: hit.eras ?? [], pricePoint: hit.pricePoint } : null;
    brandFactsCache.set(key, facts);
    return facts;
  } catch {
    // A failed chunk fetch is not a failed identification — it is one fewer
    // signal, and the caller must not see a rejected promise for it.
    brandFactsCache.set(key, null);
    return null;
  }
}

/** Test hook — clears the session cache. */
export function __resetBrandFactsForTests(): void {
  brandFactsCache.clear();
  brandDnaModule = null;
}
