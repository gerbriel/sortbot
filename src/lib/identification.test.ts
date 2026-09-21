import { describe, it, expect } from 'vitest';
import type { ClothingItem } from '../App';
import type { ModelRow } from './vocabService';
import {
  identifyListing, identifyEra, identifyCondition, identifyRarity,
  eraStartYear, confidenceLabel, IDENTIFICATION_ENGINE, loadBrandFacts,
  __resetBrandFactsForTests,
  type IdentifyInput, type BrandFacts,
} from './identification';

/**
 * Characterization tests for the identification pass.
 *
 * Two things are being locked in, and they are different in kind:
 *   1. THE ANSWERS — "single stitch" dates a piece before 1995, three flaws make
 *      it Fair, a typed field beats everything.
 *   2. THE EVIDENCE — every answer carries lines a person can argue with, and a
 *      CONTRADICTION shows BOTH sides rather than quietly picking one. That is
 *      the property the whole feature rests on; a confident wrong answer with no
 *      visible reasoning is worse than no answer.
 */

const item = (o: Partial<ClothingItem> = {}): ClothingItem =>
  ({ id: 'i1', file: null as unknown as File, preview: '', ...o });

const input = (o: Partial<IdentifyInput> = {}): IdentifyInput =>
  ({ item: item(), transcript: '', ...o });

const model = (o: Partial<ModelRow> = {}): ModelRow => ({
  id: 'm1', brand: 'Nike', model_name: 'Air Force 1', model_number: null,
  category: null, year_introduced: null, discontinued: false,
  keywords: [], identifying_features: [], price_min: null, price_max: null,
  collectibility: null, is_active: true, ...o,
});

const texts = (ev: { text: string }[]) => ev.map(e => e.text).join(' | ');

/** Brand facts are INJECTED (see the module header), so a test states the facts
 *  it is about instead of depending on which brands the 1,400-line table holds. */
const facts = (o: Partial<BrandFacts> = {}): BrandFacts =>
  ({ eras: [], pricePoint: 'mid', ...o });

// ── eraStartYear ────────────────────────────────────────────────────────────

describe('eraStartYear', () => {
  it('parses a canonical decade label', () => {
    expect(eraStartYear('1990s')).toBe(1990);
    expect(eraStartYear('2000s')).toBe(2000);
  });
  it('refuses anything that is not one', () => {
    expect(eraStartYear('vintage')).toBeNull();
    expect(eraStartYear('90s')).toBeNull();
    expect(eraStartYear(null)).toBeNull();
    expect(eraStartYear(undefined)).toBeNull();
    expect(eraStartYear('')).toBeNull();
  });
});

// ── Era ─────────────────────────────────────────────────────────────────────

describe('identifyEra — spoken decades', () => {
  it('hears a decade word', () => {
    const r = identifyEra(input({ transcript: 'nice boxy tee, eighties for sure' }));
    expect(r.value).toBe('1980s');
    expect(r.confidence).toBeCloseTo(0.6, 3);
    expect(texts(r.evidence)).toContain('eighties');
  });

  it("hears an apostrophe decade", () => {
    expect(identifyEra(input({ transcript: "this is a '90s crewneck" })).value).toBe('1990s');
    expect(identifyEra(input({ transcript: "80's mesh jersey" })).value).toBe('1980s');
  });

  it('maps y2k to 2000s, because that is what every downstream formula understands', () => {
    const r = identifyEra(input({ transcript: 'total y2k moment' }));
    expect(r.value).toBe('2000s');
  });

  it('hears seventies and forties too', () => {
    expect(identifyEra(input({ transcript: 'seventies western shirt' })).value).toBe('1970s');
    expect(identifyEra(input({ transcript: 'forties workwear' })).value).toBe('1940s');
  });

  it('does not fire on a substring — "sixties" inside another word is not a decade', () => {
    // No era word here at all; "nineties" must be word-bounded.
    expect(identifyEra(input({ transcript: 'ninetieskjh notaword' })).value).toBeNull();
  });

  it('reads the tags and the descriptions, not only the transcript', () => {
    expect(identifyEra(input({ item: item({ tags: ['y2k', 'baggy'] }) })).value).toBe('2000s');
    expect(identifyEra(input({ item: item({ customDescription: 'proper nineties fit' }) })).value).toBe('1990s');
  });
});

describe('identifyEra — the typed field wins', () => {
  it('a typed era outranks a spoken one', () => {
    const r = identifyEra(input({
      item: item({ era: '1970s' }),
      transcript: 'looks like the nineties to me',
    }));
    expect(r.value).toBe('1970s');
    expect(r.confidence).toBe(1);
    expect(r.evidence[0].kind).toBe('field');
  });

  it('a free-text era the seller typed is kept verbatim rather than discarded', () => {
    const r = identifyEra(input({ item: item({ era: 'vintage' }) }));
    expect(r.value).toBe('vintage');
    expect(r.evidence[0].text).toContain('vintage');
  });
});

describe('identifyEra — construction cues score, never propose', () => {
  it('single stitch alone names no era, but the line is still shown', () => {
    const r = identifyEra(input({ transcript: 'single stitch hem, no tag' }));
    expect(r.value).toBeNull();
    expect(r.confidence).toBe(0);
    expect(texts(r.evidence)).toContain('Single stitch');
  });

  it('single stitch AGREES with a spoken 1980s and raises confidence', () => {
    const spoken = identifyEra(input({ transcript: 'eighties tee' }));
    const withCue = identifyEra(input({ transcript: 'eighties tee, single stitch hem' }));
    expect(withCue.value).toBe('1980s');
    expect(withCue.confidence).toBeGreaterThan(spoken.confidence);
    expect(withCue.evidence.every(e => e.agrees !== false)).toBe(true);
  });

  it('single stitch CONTRADICTS a spoken 2010s, and both lines are shown', () => {
    const r = identifyEra(input({ transcript: 'twenty tens piece, single stitch hem' }));
    expect(r.value).toBe('2010s');
    const against = r.evidence.filter(e => e.agrees === false);
    expect(against.length).toBe(1);
    expect(against[0].text).toContain('Single stitch');
    // The contradiction is subtracted, so this is LESS confident than the bare
    // spoken decade — which is the whole point of showing both sides.
    expect(r.confidence).toBeLessThan(0.6);
  });

  it('double stitch agrees with a post-1990 era and contradicts a pre-1990 one', () => {
    const modern = identifyEra(input({ transcript: 'y2k tee with a double stitch hem' }));
    expect(modern.evidence.filter(e => e.agrees === false)).toHaveLength(0);
    const old = identifyEra(input({ transcript: 'seventies tee with a double stitch hem' }));
    expect(old.evidence.some(e => e.agrees === false)).toBe(true);
  });

  it('a talon zipper contradicts anything after 1970', () => {
    const r = identifyEra(input({ transcript: 'eighties jacket, talon zipper' }));
    expect(r.evidence.some(e => e.agrees === false && /Talon/.test(e.text))).toBe(true);
  });

  it('a union label agrees with a pre-1990 era', () => {
    const r = identifyEra(input({ transcript: 'seventies shirt, union made label' }));
    expect(r.value).toBe('1970s');
    expect(r.evidence.some(e => /Union label/.test(e.text) && e.agrees !== false)).toBe(true);
  });

  it('a tagless neck label contradicts the nineties', () => {
    const r = identifyEra(input({ transcript: 'nineties hoodie, tagless tag' }));
    expect(r.evidence.some(e => e.agrees === false && /Tagless/.test(e.text))).toBe(true);
  });

  it('A CUE AGREES WHEN IT OVERLAPS THE DECADE, not when it precedes its first year', () => {
    // The bug this pins: "single stitch, not after 1995" compared against the
    // decade's START made it CONTRADICT the 1990s, because 1990 is not < 1995.
    // Single stitch is the most used dating cue in resale and 1990-1994 is
    // squarely inside it, so the app was arguing with a seller who was right.
    const nineties = identifyEra(input({ transcript: 'nineties tee, single stitch hem' }));
    expect(nineties.value).toBe('1990s');
    expect(nineties.evidence.filter(e => e.agrees === false)).toHaveLength(0);
    expect(nineties.confidence).toBeGreaterThan(0.6);

    // ...and it still rules out the decade that shares no year with it.
    const noughties = identifyEra(input({ transcript: 'y2k tee, single stitch hem' }));
    expect(noughties.evidence.some(e => e.agrees === false && /Single stitch/.test(e.text))).toBe(true);
  });

  it('every cue boundary is asserted on both sides', () => {
    const fires = (transcript: string) =>
      identifyEra(input({ transcript })).evidence.filter(e => e.agrees === false).length === 0;
    // union made, not after 1998
    expect(fires('nineties, union made label')).toBe(true);
    expect(fires('y2k, union made label')).toBe(false);
    // talon zipper, not after 1975
    expect(fires('seventies jacket, talon zipper')).toBe(true);
    expect(fires('eighties jacket, talon zipper')).toBe(false);
    // double stitch, not before 1990
    expect(fires('nineties tee, double stitch')).toBe(true);
    expect(fires('eighties tee, double stitch')).toBe(false);
    // tagless, not before 2000
    expect(fires('y2k hoodie, tagless tag')).toBe(true);
    expect(fires('nineties hoodie, tagless tag')).toBe(false);
    // printed care label, not before 1972
    expect(fires('seventies shirt, care label')).toBe(true);
    expect(fires('sixties shirt, care label')).toBe(false);
    // paper thin, not after 1999
    expect(fires('nineties tee, paper thin')).toBe(true);
    expect(fires('y2k tee, paper thin')).toBe(false);
  });

  it('several agreeing cues can push confidence to 1', () => {
    const r = identifyEra(input({
      transcript: 'eighties tee, single stitch, union made, paper thin',
    }));
    expect(r.value).toBe('1980s');
    expect(r.confidence).toBe(1);
  });
});

describe('identifyEra — brand history', () => {
  it('a brand with a long recorded history corroborates a decade it was active in', () => {
    const r = identifyEra(input({
      item: item({ brand: 'Champion' }),
      transcript: 'nineties jersey',
      brandFacts: facts({ eras: ['1980s', '1990s', '2000s'] }),
    }));
    expect(r.value).toBe('1990s');
    expect(texts(r.evidence)).toContain('was active in the 1990s');
  });

  it('a decade the brand is NOT recorded in is shown as a contradiction', () => {
    const r = identifyEra(input({
      item: item({ brand: 'Champion' }),
      transcript: 'this one is from the 1910s',
      brandFacts: facts({ eras: ['1980s', '1990s', '2000s'] }),
    }));
    expect(r.value).toBe('1910s');
    expect(r.evidence.some(e => e.agrees === false && /not recorded/.test(e.text))).toBe(true);
  });

  it('a brand recorded in ONE decade proposes it', () => {
    const r = identifyEra(input({
      item: item({ brand: 'A One-Season Label' }),
      brandFacts: facts({ eras: ['1970s'] }),
    }));
    expect(r.value).toBe('1970s');
    expect(texts(r.evidence)).toContain('recorded only in the 1970s');
  });

  it('a non-decade entry in the brand table is ignored rather than treated as an era', () => {
    const r = identifyEra(input({
      item: item({ brand: 'Odd Label' }),
      brandFacts: facts({ eras: ['vintage', 'modern'] }),
    }));
    expect(r.value).toBeNull();
  });

  it('an unknown brand contributes nothing either way', () => {
    const a = identifyEra(input({ transcript: 'nineties tee' }));
    const b = identifyEra(input({ item: item({ brand: 'Totally Made Up Label' }), transcript: 'nineties tee' }));
    expect(b.confidence).toBe(a.confidence);
    expect(b.evidence.filter(e => e.kind === 'brand')).toHaveLength(0);
  });
});

describe('identifyEra — the model knowledge base', () => {
  it("a model's introduction year proposes its decade", () => {
    const r = identifyEra(input({ model: model({ year_introduced: 1982, model_name: 'Air Force 1' }) }));
    expect(r.value).toBe('1980s');
    expect(texts(r.evidence)).toContain('introduced in 1982');
  });

  it('a spoken decade that PREDATES the model is ruled out, not merely marked down', () => {
    const r = identifyEra(input({
      transcript: 'seventies for sure',
      model: model({ year_introduced: 1998, model_name: 'Air Max Plus' }),
    }));
    // A garment cannot predate the model it is, so the 1970s is impossible and
    // the model's own decade stands — but the seller's words are still on the
    // record as dissent, which is the whole contract of this evidence list.
    expect(r.value).toBe('1990s');
    expect(r.evidence.some(e => e.agrees === false && /seventies/.test(e.text))).toBe(true);
  });

  it('even a TYPED era is overruled when the model rules it out — and the seller is told', () => {
    // The one place a typed field does not simply win: a garment cannot predate
    // the model it is. The field's own line survives as dissent and confidence
    // collapses, so this lands in the review queue rather than passing quietly.
    const r = identifyEra(input({
      item: item({ era: '1960s' }),
      model: model({ year_introduced: 2005, model_name: 'Dunk Low SB' }),
    }));
    expect(r.value).toBe('2000s');
    expect(r.confidence).toBeLessThan(0.1);
    expect(r.evidence.some(e => e.agrees === false && /did not exist until 2005/.test(e.text))).toBe(true);
    expect(r.evidence.some(e => e.agrees === false && /1960s/.test(e.text))).toBe(true);
  });

  it('THE CONTRADICTION CASE FROM THE SPEC: "eighties" spoken, model from 1998 — low confidence, both lines shown', () => {
    const r = identifyEra(input({
      transcript: 'eighties graphic tee',
      model: model({ brand: 'Ecko Unltd', model_name: 'Rhino', year_introduced: 1998 }),
    }));
    // The 1980s is impossible for a 1998 design, so the answer is the 1990s —
    // held at LOW confidence and carrying both sides: the model's date, and the
    // seller's own "eighties" marked as dissent. A confident answer that hid
    // one of those is the failure this list exists to prevent.
    expect(r.value).toBe('1990s');
    expect(r.confidence).toBeLessThan(0.45);
    expect(r.evidence.some(e => e.agrees !== false && /introduced in 1998/.test(e.text))).toBe(true);
    expect(r.evidence.some(e => e.agrees === false && /eighties/.test(e.text))).toBe(true);
  });
});

// ── Condition ───────────────────────────────────────────────────────────────

describe('identifyCondition — stated grades', () => {
  it('NWT outranks everything, because it is a fact and not an opinion', () => {
    const r = identifyCondition(input({ transcript: 'deadstock, excellent, good condition' }));
    expect(r.value).toBe('NWT');
    expect(r.confidence).toBeCloseTo(0.8, 3);
  });

  it('"new with tags" and "nos" both reach NWT', () => {
    expect(identifyCondition(input({ transcript: 'new with tags' })).value).toBe('NWT');
    expect(identifyCondition(input({ transcript: 'new old stock' })).value).toBe('NWT');
  });

  it('excellent / like new / mint reach Excellent', () => {
    for (const w of ['excellent condition', 'like new', 'mint']) {
      expect(identifyCondition(input({ transcript: w })).value).toBe('Excellent');
    }
  });

  it('good condition reaches Good', () => {
    expect(identifyCondition(input({ transcript: 'good condition overall' })).value).toBe('Good');
    expect(identifyCondition(input({ transcript: 'nice shape' })).value).toBe('Good');
  });

  it('fair / rough / beater reach Fair, and Fair outranks Excellent when both are said', () => {
    expect(identifyCondition(input({ transcript: 'rough shape' })).value).toBe('Fair');
    expect(identifyCondition(input({ transcript: 'beater' })).value).toBe('Fair');
    expect(identifyCondition(input({ transcript: 'excellent graphic but fair overall' })).value).toBe('Fair');
  });

  it('a typed condition wins outright, at confidence 1', () => {
    const r = identifyCondition(input({
      item: item({ condition: 'Excellent' }),
      transcript: 'beater with holes',
    }));
    expect(r.value).toBe('Excellent');
    expect(r.confidence).toBe(1);
    expect(r.evidence[0].kind).toBe('field');
  });

  it('nothing said at all leaves the grade null rather than guessing', () => {
    const r = identifyCondition(input({ transcript: 'blue crewneck, cotton' }));
    expect(r.value).toBeNull();
    expect(r.flaws).toEqual([]);
    expect(r.confidence).toBe(0);
  });
});

describe('identifyCondition — flaws are collected separately from the grade', () => {
  it('a named defect becomes a flaw and is disclosed', () => {
    const r = identifyCondition(input({ transcript: 'small hole in the shoulder' }));
    expect(r.flaws).toEqual(['holes']);
    expect(r.value).toBe('Good');
  });

  it('WEAR IS NOT A FLAW — faded and distressed are what the buyer is paying for', () => {
    const r = identifyCondition(input({ transcript: 'beautifully faded and distressed' }));
    expect(r.flaws).toEqual([]);
    expect(r.value).toBe('Good');
    expect(texts(r.evidence)).toContain('not a defect');
  });

  it('a typed condition keeps the flaws — the grade and the disclosure are different jobs', () => {
    const r = identifyCondition(input({
      item: item({ condition: 'Excellent' }),
      transcript: 'pit stains and a cracked print',
    }));
    expect(r.value).toBe('Excellent');
    expect(r.flaws).toEqual(['stains', 'cracked print']);
  });

  it('three or more distinct flaws pull the grade down to Fair whatever was said', () => {
    const r = identifyCondition(input({
      transcript: 'excellent condition, couple of holes, pit stains, cracked print',
    }));
    expect(r.value).toBe('Fair');
    expect(r.flaws).toEqual(['holes', 'stains', 'cracked print']);
    expect(texts(r.evidence)).toContain('3 separate flaws');
  });

  it('A WORN FLAW OVERRIDES A CLAIM OF NEW — "NWT · holes, stains" is a case waiting to happen', () => {
    const r = identifyCondition(input({ transcript: 'deadstock, small hole and pit stains' }));
    expect(r.value).toBe('Excellent');
    expect(r.flaws).toEqual(['holes', 'stains']);
    expect(r.evidence.some(e => e.agrees === false && /has been worn/.test(e.text))).toBe(true);
  });

  it('...but a flaw a warehouse piece can genuinely have does NOT override it', () => {
    // A cracked print, a missing button and age yellowing all happen to
    // genuinely deadstock stock sitting for thirty years.
    const r = identifyCondition(input({
      transcript: 'deadstock, cracked print, missing button, yellowing at the collar',
    }));
    expect(r.value).toBe('NWT');
    expect(r.flaws).toEqual(['cracked print', 'missing button', 'yellowing']);
  });

  it('each flaw phrase maps to its canonical name, once', () => {
    const r = identifyCondition(input({
      transcript: 'moth holes, discoloration, peeling print, pilling, frayed cuffs, ' +
        'mended seam, missing button, broken zipper, snags, worn thin, musty, yellowed',
    }));
    expect(r.flaws).toEqual([
      'holes', 'stains', 'cracked print', 'pilling', 'fraying', 'repairs',
      'missing button', 'broken zipper', 'pulls', 'thin spots', 'odor', 'yellowing',
    ]);
  });

  it('a duplicate phrase does not double-count the flaw', () => {
    const r = identifyCondition(input({ transcript: 'hole here, holes there, another hole' }));
    expect(r.flaws).toEqual(['holes']);
  });

  it('reads the flaws field as well as the transcript', () => {
    const r = identifyCondition(input({ item: item({ flaws: 'pit stains under both arms' }) }));
    expect(r.flaws).toEqual(['stains']);
  });

  it('flaws with no grade word is a listing somebody should look at, not a confident Fair', () => {
    const r = identifyCondition(input({ transcript: 'holes, stains, fraying, pilling, snags' }));
    expect(r.value).toBe('Fair');
    expect(r.confidence).toBeLessThan(0.65);
  });
});

// ── Rarity ──────────────────────────────────────────────────────────────────

describe('identifyRarity', () => {
  it('no signal is 0 with zero confidence, not a made-up middle', () => {
    const r = identifyRarity(input({ transcript: 'blue tee' }), null);
    expect(r.score).toBe(0);
    expect(r.confidence).toBe(0);
    expect(r.evidence).toEqual([]);
  });

  it("a model's collectibility divides by ten", () => {
    const r = identifyRarity(input({ model: model({ collectibility: 9 }) }), null);
    expect(r.score).toBe(0.9);
    expect(texts(r.evidence)).toContain('9/10');
  });

  it('a spoken rarity word scores high', () => {
    const r = identifyRarity(input({ transcript: 'absolute grail piece' }), null);
    expect(r.score).toBe(0.8);
    expect(texts(r.evidence)).toContain('grail');
  });

  it("the brand's price point contributes, and the four bands are ordered", () => {
    const at = (pricePoint: BrandFacts['pricePoint']) =>
      identifyRarity(input({ item: item({ brand: 'B' }), brandFacts: facts({ pricePoint }) }), null).score;
    expect(at('budget')).toBeLessThan(at('mid'));
    expect(at('mid')).toBeLessThan(at('premium'));
    expect(at('premium')).toBeLessThan(at('luxury'));
    const r = identifyRarity(input({ item: item({ brand: 'B' }), brandFacts: facts({ pricePoint: 'luxury' }) }), null);
    expect(texts(r.evidence)).toContain('luxury price point');
  });

  it('a pre-1990 era nudges it up', () => {
    const modern = identifyRarity(input({ model: model({ collectibility: 5 }) }), '2010s');
    const old = identifyRarity(input({ model: model({ collectibility: 5 }) }), '1970s');
    expect(old.score).toBeGreaterThan(modern.score);
    expect(texts(old.evidence)).toContain('fewer survive');
  });

  it('is a weighted MEAN, so one strong signal is not diluted to nothing', () => {
    const r = identifyRarity(input({ model: model({ collectibility: 10 }) }), null);
    expect(r.score).toBe(1);
  });

  it('confidence is capped below certainty — rarity is a judgement', () => {
    const r = identifyRarity(input({
      item: item({ brand: 'B' }),
      brandFacts: facts({ pricePoint: 'luxury' }),
      transcript: 'deadstock grail',
      model: model({ collectibility: 10 }),
    }), '1970s');
    expect(r.confidence).toBeLessThanOrEqual(0.9);
  });
});

// ── The whole pass ──────────────────────────────────────────────────────────

describe('identifyListing', () => {
  it('is deterministic — the same input twice is byte-identical', () => {
    const i = input({
      item: item({ brand: 'Champion', tags: ['y2k'] }),
      transcript: 'nineties jersey, single stitch, small hole, deadstock',
      brandFacts: facts({ eras: ['1980s', '1990s'], pricePoint: 'mid' }),
      model: model({ collectibility: 7, year_introduced: 1991 }),
    });
    expect(JSON.stringify(identifyListing(i))).toBe(JSON.stringify(identifyListing(i)));
  });

  it('blends the three facets, era and condition weighted above rarity', () => {
    const r = identifyListing(input({
      item: item({ era: '1990s', condition: 'Good' }),
    }));
    // era 1.0 × 0.4 + condition 1.0 × 0.4 + rarity 0 × 0.2
    expect(r.confidence).toBeCloseTo(0.8, 3);
  });

  it('an empty listing is honestly empty, not a set of defaults', () => {
    const r = identifyListing(input());
    expect(r.era.value).toBeNull();
    expect(r.condition.value).toBeNull();
    expect(r.rarity.score).toBe(0);
    expect(r.confidence).toBe(0);
    expect(r.suggestions).toEqual({});
  });

  it('suggests the era as a tag, and y2k alongside 2000s', () => {
    const r = identifyListing(input({ transcript: 'y2k baby tee' }));
    expect(r.suggestions.tags).toContain('2000s');
    expect(r.suggestions.tags).toContain('y2k');
    expect(r.suggestions.metafields?.era).toBe('2000s');
  });

  it('puts the named flaws in a metafield so the disclosure survives', () => {
    const r = identifyListing(input({ transcript: 'holes and pit stains' }));
    expect(r.suggestions.metafields?.flaws).toBe('holes, stains');
  });

  it('NEVER suggests a title over one the seller already has', () => {
    const r = identifyListing(input({
      item: item({ seoTitle: 'My Own Title', brand: 'Nike', era: '1990s', productType: 'Tee' }),
    }));
    expect(r.suggestions.title).toBeUndefined();
  });

  it('suggests a title only when there is none and there is enough to build one', () => {
    const r = identifyListing(input({
      item: item({ brand: 'Nike', productType: 'Tee', era: '1990s' }),
    }));
    expect(r.suggestions.title).toBe('1990s Nike Tee');
  });

  it('folds the brand vocabulary into the suggested tags, capped', () => {
    const r = identifyListing(input({
      item: item({ era: '1990s' }),
      brandTerms: ['skate', 'surf', 'grunge', 'pnw', 'fifth', 'sixth'],
    }));
    expect(r.suggestions.tags).toContain('skate');
    expect(r.suggestions.tags).not.toContain('fifth');
  });

  it('names the engine version, so two eras of suggestion can be compared later', () => {
    expect(IDENTIFICATION_ENGINE).toBe('rules@1');
  });

  it('every confidence it produces is within the columns 0..1 CHECK', () => {
    const cases: IdentifyInput[] = [
      input(),
      input({ item: item({ era: '1980s', condition: 'NWT' }), transcript: 'deadstock grail single stitch union made' }),
      input({ transcript: 'twenty tens single stitch union made talon zipper' }),
      input({ item: item({ brand: 'B' }), brandFacts: facts({ pricePoint: 'luxury' }), transcript: 'holes stains fraying pilling snags odor' }),
    ];
    for (const c of cases) {
      const r = identifyListing(c);
      for (const n of [r.confidence, r.era.confidence, r.condition.confidence, r.rarity.confidence, r.rarity.score]) {
        expect(n).toBeGreaterThanOrEqual(0);
        expect(n).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('confidenceLabel', () => {
  it('names the three bands at their boundaries', () => {
    expect(confidenceLabel(1)).toBe('High');
    expect(confidenceLabel(0.75)).toBe('High');
    expect(confidenceLabel(0.749)).toBe('Medium');
    expect(confidenceLabel(0.45)).toBe('Medium');
    expect(confidenceLabel(0.449)).toBe('Low');
    expect(confidenceLabel(0)).toBe('Low');
  });
});

// ── loadBrandFacts ──────────────────────────────────────────────────────────

describe('loadBrandFacts', () => {
  it('reads a real brand out of the knowledge base, behind a DYNAMIC import', async () => {
    __resetBrandFactsForTests();
    // Loaded this way rather than statically because the table is ~113 kB and a
    // static import here put it in the first paint (see the module header).
    const r = await loadBrandFacts('new york yankees');
    expect(r).not.toBeNull();
    expect(r!.eras).toContain('1990s');
    expect(['budget', 'mid', 'premium', 'luxury']).toContain(r!.pricePoint);
  });

  it('is null for an unknown brand and for nothing at all, never a throw', async () => {
    expect(await loadBrandFacts('Totally Made Up Label')).toBeNull();
    expect(await loadBrandFacts('')).toBeNull();
    expect(await loadBrandFacts(null)).toBeNull();
    expect(await loadBrandFacts(undefined)).toBeNull();
  });

  it('is case- and space-insensitive, and cached', async () => {
    const a = await loadBrandFacts('New York Yankees');
    const b = await loadBrandFacts('  new york yankees  ');
    expect(a).toBe(b);          // the very same cached object
  });
});
