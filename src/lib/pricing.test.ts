import { describe, it, expect } from 'vitest';
import type { ClothingItem } from '../App';
import { identifyListing } from './identification';
import type { Identification } from './identification';
import { applyPlatformPrice } from './platformPricing';
import {
  computePrice, median, trimmedMedian, iqrBand, roundToCharm, formatCents,
  MIN_COMPS, MAX_SOLD_COMPS, ASKING_DISCOUNT, CONDITION_ADJUSTMENT,
  REVIEW_HIGH_VALUE_CENTS, METHOD_LABELS,
  type PriceComp, type ComputePriceInput,
} from './pricing';

/**
 * Characterization tests for the price engine.
 *
 * The properties, in order of how much damage breaking them does:
 *   1. ASKING AND SOLD ARE NEVER IN ONE MEDIAN. Asserted structurally (the
 *      comps the answer was built from are all one kind) and by construction
 *      (a set with three solds and twenty askings prices from the three solds).
 *   2. NO NUMBER IS INVENTED. Every figure in `explanation` appears in the
 *      inputs or is arithmetic over them — asserted by extracting every dollar
 *      figure from the sentences and checking it against the inputs.
 *   3. A SPOKEN PRICE WINS, and consults nothing.
 *   4. A SUGGESTION IS NEVER $0, because the export gate reads $0 as unpriced.
 */

const item = (o: Partial<ClothingItem> = {}): ClothingItem =>
  ({ id: 'i1', file: null as unknown as File, preview: '', ...o });

/** A real identification, built by the real module — not a hand-made stub. */
const ident = (o: Partial<ClothingItem> = {}, transcript = ''): Identification =>
  identifyListing({ item: item(o), transcript });

const sold = (cents: number, soldAt?: string, source: PriceComp['source'] = 'own_sales'): PriceComp =>
  ({ kind: 'sold', source, price_cents: cents, ...(soldAt ? { sold_at: soldAt } : {}) });
const asking = (cents: number, source: PriceComp['source'] = 'ebay_active'): PriceComp =>
  ({ kind: 'asking', source, price_cents: cents });

const run = (o: Partial<ComputePriceInput> = {}) => computePrice({
  comps: [], identification: ident(), item: item(), ...o,
});

/** Every `$1,234.56`-shaped figure in the explanation, as integer cents. */
const centsInExplanation = (lines: string[]): number[] =>
  lines.flatMap(l => [...l.matchAll(/\$([\d,]+\.\d{2})/g)]
    .map(m => Math.round(Number(m[1].replace(/,/g, '')) * 100)));

// ── Money helpers ───────────────────────────────────────────────────────────

describe('median', () => {
  it('is the middle of an odd set and the mean of the middle pair of an even one', () => {
    expect(median([100, 300, 200])).toBe(200);
    expect(median([100, 200, 300, 400])).toBe(250);
  });
  it('is 0 for nothing, and the value itself for one', () => {
    expect(median([])).toBe(0);
    expect(median([4242])).toBe(4242);
  });
  it('does not mutate its input', () => {
    const xs = [300, 100, 200];
    median(xs);
    expect(xs).toEqual([300, 100, 200]);
  });
});

describe('trimmedMedian', () => {
  it('leaves small sets alone — dropping two of four leaves nothing worth having', () => {
    expect(trimmedMedian([100, 200, 300, 400])).toBe(median([100, 200, 300, 400]));
  });
  it('drops the extremes once there are five, so one 10× outlier cannot be the answer', () => {
    const withOutlier = [3800, 4000, 4200, 4400, 99000];
    expect(trimmedMedian(withOutlier)).toBe(4200);
    expect(median(withOutlier)).toBe(4200);
    // And the outlier genuinely would have moved a MEAN:
    expect(Math.round(withOutlier.reduce((a, b) => a + b) / 5)).toBeGreaterThan(20000);
  });
  it('drops a low outlier too — a $2 flea-market giveaway is not the market', () => {
    expect(trimmedMedian([200, 4000, 4200, 4400, 4600])).toBe(4200);
  });
});

describe('iqrBand', () => {
  it('is the full spread below four values, honestly wide', () => {
    expect(iqrBand([1000, 5000, 9000])).toEqual({ low: 1000, high: 9000 });
  });
  it('is the interquartile range at four or more', () => {
    const band = iqrBand([1000, 3000, 5000, 7000, 9000]);
    expect(band.low).toBe(3000);
    expect(band.high).toBe(7000);
    // Narrower than min/max, which is the point.
    expect(band.low).toBeGreaterThan(1000);
    expect(band.high).toBeLessThan(9000);
  });
  it('is 0/0 for nothing', () => {
    expect(iqrBand([])).toEqual({ low: 0, high: 0 });
  });
});

describe('roundToCharm', () => {
  it('is the nearest whole dollar less a penny', () => {
    expect(roundToCharm(4950)).toBe(4999);
    expect(roundToCharm(5060)).toBe(5099);
    expect(roundToCharm(4200)).toBe(4199);
  });
  it('AGREES WITH platformPricing — the two .99 rules must not drift', () => {
    // platformPricing works in dollars on a PlatformPricingRule; this works in
    // cents on a suggestion. Same arithmetic, asserted against each other.
    const viaPlatform = applyPlatformPrice(45 * 1.1, {
      id: 'x', name: 'x', enabled: true,
      adjustment: { type: 'percent', value: 0 }, rounding: '.99', applyToCompareAt: false,
    });
    expect(Math.round(viaPlatform * 100)).toBe(roundToCharm(Math.round(45 * 1.1 * 100)));
    expect(viaPlatform).toBe(49.99);
  });
  it('floors at 99 cents, never 0 — a $0 suggestion is one the export gate blocks on', () => {
    expect(roundToCharm(10)).toBe(99);
    expect(roundToCharm(1)).toBe(99);
  });
  it('is 0 only for a non-positive or non-finite input', () => {
    expect(roundToCharm(0)).toBe(0);
    expect(roundToCharm(-500)).toBe(0);
    expect(roundToCharm(NaN)).toBe(0);
    expect(roundToCharm(Infinity)).toBe(0);
  });
});

describe('formatCents', () => {
  it('groups thousands and always shows cents', () => {
    expect(formatCents(4200)).toBe('$42.00');
    expect(formatCents(123456)).toBe('$1,234.56');
    expect(formatCents(0)).toBe('$0.00');
  });
});

// ── A spoken price wins ─────────────────────────────────────────────────────

describe('computePrice — a price said out loud', () => {
  it('wins outright, at full confidence, consulting nothing', () => {
    const r = run({
      spokenPriceCents: 4500,
      comps: [sold(1000), sold(1100), sold(1200), sold(1300)],
    });
    expect(r.method).toBe('spoken');
    expect(r.suggestedCents).toBe(4500);
    expect(r.lowCents).toBe(4500);
    expect(r.highCents).toBe(4500);
    expect(r.confidence).toBe(1);
    expect(r.needsReview).toBe(false);
    expect(r.compsUsed).toEqual([]);
    expect(r.explanation).toHaveLength(1);
    expect(r.explanation[0]).toContain('$45.00');
  });

  it('is not applied a condition adjustment — the seller already decided', () => {
    const r = run({
      spokenPriceCents: 4500,
      identification: ident({ condition: 'Fair' }),
    });
    expect(r.suggestedCents).toBe(4500);
    expect(r.explanation.join(' ')).not.toContain('Fair');
  });

  it('a zero or nonsense spoken price falls through to the comps', () => {
    for (const bad of [0, -100, NaN, Infinity, null, undefined]) {
      const r = run({
        spokenPriceCents: bad as number | null | undefined,
        comps: [sold(4000), sold(4200), sold(4400)],
      });
      expect(r.method).toBe('own_sold_median');
    }
  });
});

// ── Sold comps ──────────────────────────────────────────────────────────────

describe('computePrice — sold comps', () => {
  it('medians them and rounds to .99', () => {
    const r = run({ comps: [sold(4000), sold(4200), sold(4400)] });
    expect(r.method).toBe('own_sold_median');
    expect(r.suggestedCents).toBe(4199);        // median 4200 → $41.99
    expect(r.explanation[0]).toContain('$42.00');
    expect(r.explanation[0]).toContain('3 of your own sales');   // never "3 your own sales"
  });

  it('needs MIN_COMPS of them — two is not a market', () => {
    const r = run({ comps: [sold(4000), sold(4200)] });
    expect(r.method).toBe('insufficient');
    expect(r.suggestedCents).toBeNull();
    expect(MIN_COMPS).toBe(3);
  });

  it('uses only the newest MAX_SOLD_COMPS', () => {
    const many: PriceComp[] = [];
    for (let i = 0; i < 20; i++) {
      // The newest twelve are all $50; the older eight are all $10.
      const day = String(i + 1).padStart(2, '0');
      many.push(sold(i < 8 ? 1000 : 5000, `2026-01-${day}`));
    }
    const r = run({ comps: many });
    expect(r.compsUsed).toHaveLength(MAX_SOLD_COMPS);
    expect(r.compsUsed.every(c => c.price_cents === 5000)).toBe(true);
    expect(r.suggestedCents).toBe(4999);
  });

  it('orders newest first, and an undated comp sorts after every dated one', () => {
    const r = run({
      comps: [sold(1000), sold(2000, '2026-01-01'), sold(3000, '2026-06-01')],
    });
    expect(r.compsUsed.map(c => c.price_cents)).toEqual([3000, 2000, 1000]);
  });

  it('says out loud when it trimmed the extremes', () => {
    const r = run({ comps: [sold(200), sold(4000), sold(4200), sold(4400), sold(99000)] });
    expect(r.explanation.some(l => /highest and lowest were dropped/.test(l))).toBe(true);
    expect(r.suggestedCents).toBe(4199);
  });

  it('names each source separately in one sentence, with the right plural', () => {
    const r = run({
      comps: [sold(4000, undefined, 'own_sales'), sold(4200, undefined, 'web_sold'), sold(4400, undefined, 'web_sold')],
    });
    expect(r.explanation[0]).toContain('1 of your own sales');
    expect(r.explanation[0]).toContain('2 sold listings found on the web');
  });

  it('confidence rises with the number of solds and stays under 1', () => {
    const three = run({ comps: [sold(4000), sold(4100), sold(4200)] });
    const twelve = run({ comps: Array.from({ length: 12 }, (_, i) => sold(4000 + i * 10)) });
    expect(twelve.confidence).toBeGreaterThan(three.confidence);
    expect(twelve.confidence).toBeLessThan(1);
  });

  it('a non-positive or non-finite comp is dropped, not clamped', () => {
    const r = run({
      comps: [sold(4000), sold(4200), sold(4400), sold(0), sold(-500), sold(NaN)],
    });
    expect(r.compsUsed).toHaveLength(3);
    expect(r.suggestedCents).toBe(4199);
  });

  it('reports a range from the comps, low ≤ suggested ≤ high', () => {
    const r = run({ comps: [sold(2000), sold(3000), sold(4000), sold(5000), sold(6000)] });
    expect(r.lowCents).not.toBeNull();
    expect(r.lowCents!).toBeLessThanOrEqual(r.suggestedCents!);
    expect(r.highCents!).toBeGreaterThanOrEqual(r.suggestedCents!);
    expect(r.explanation.some(l => /Range from the comparables/.test(l))).toBe(true);
  });
});

// ── Asking comps, and the wall between them ─────────────────────────────────

describe('computePrice — asking prices', () => {
  it('is only reached with fewer than MIN_COMPS solds, and says so', () => {
    const r = run({ comps: [asking(5000), asking(5500), asking(6000)] });
    expect(r.method).toBe('asking_adjusted');
    expect(r.explanation[0]).toContain('No sold comparables');
  });

  it('discounts them, and states the reason in words', () => {
    const r = run({ comps: [asking(5000), asking(5500), asking(6000)] });
    // median 5500 × 0.85 = 4675 → $46.99
    expect(r.suggestedCents).toBe(4699);
    expect(r.explanation[1]).toContain('what sellers want, not what buyers paid');
    expect(r.explanation[1]).toContain('15%');
    expect(ASKING_DISCOUNT).toBe(0.85);
  });

  it('SOLD COMPS BEAT ASKING COMPS however many askings there are', () => {
    const r = run({
      comps: [
        sold(4000), sold(4200), sold(4400),
        ...Array.from({ length: 20 }, () => asking(20000)),
      ],
    });
    expect(r.method).toBe('own_sold_median');
    expect(r.compsUsed.every(c => c.kind === 'sold')).toBe(true);
    expect(r.suggestedCents).toBe(4199);        // untouched by the 20 askings
  });

  it('THE TWO ARE NEVER IN ONE MEDIAN — the comps used are all one kind, always', () => {
    const cases: PriceComp[][] = [
      [sold(4000), sold(4200), sold(4400), asking(9000), asking(9500)],
      [asking(5000), asking(5500), asking(6000), sold(1000), sold(1100)],
      [sold(1000), sold(1100), sold(1200), sold(1300), asking(9000)],
    ];
    for (const comps of cases) {
      const r = computePrice({ comps, identification: ident(), item: item() });
      const kinds = new Set(r.compsUsed.map(c => c.kind));
      expect(kinds.size).toBeLessThanOrEqual(1);
    }
  });

  it('mentions the sold comps it could NOT use, and why', () => {
    const r = run({
      comps: [sold(1000), sold(1100), asking(5000), asking(5500), asking(6000)],
    });
    expect(r.method).toBe('asking_adjusted');
    expect(r.explanation.some(l => /asking and sold are never mixed/.test(l))).toBe(true);
    expect(r.explanation.some(l => /2 sold comparables were found/.test(l))).toBe(true);
    // ...and it did not let them touch the number.
    expect(r.compsUsed.every(c => c.kind === 'asking')).toBe(true);
  });

  it('is structurally less confident than a sold median, and always flagged for review', () => {
    const askingRun = run({ comps: [asking(5000), asking(5500), asking(6000)] });
    const soldRun = run({ comps: [sold(5000), sold(5500), sold(6000)] });
    expect(askingRun.confidence).toBeLessThan(soldRun.confidence);
    expect(askingRun.needsReview).toBe(true);
    expect(askingRun.reviewReasons.some(t => /not sales/.test(t))).toBe(true);
  });
});

// ── Not enough to go on ─────────────────────────────────────────────────────

describe('computePrice — insufficient', () => {
  it('names no number at all, and NULL is never 0', () => {
    const r = run();
    expect(r.method).toBe('insufficient');
    expect(r.suggestedCents).toBeNull();
    expect(r.lowCents).toBeNull();
    expect(r.highCents).toBeNull();
    expect(r.confidence).toBe(0);
    expect(r.needsReview).toBe(true);
  });

  it('says what it did have, and what to do about it', () => {
    const r = run({ comps: [sold(4000), asking(5000)] });
    expect(r.explanation[0]).toContain('1 sold and 1 asking');
    expect(r.explanation[1]).toContain('mark similar pieces sold');
    expect(r.reviewReasons[0]).toContain('Not enough comparables');
  });

  it('keeps the unusable comps in compsUsed so the card can show what was found', () => {
    const r = run({ comps: [sold(4000), asking(5000)] });
    expect(r.compsUsed).toHaveLength(2);
  });

  it('distinguishes "none found" from "not enough"', () => {
    expect(run().explanation[0]).toContain('No comparables found');
    expect(run({ comps: [sold(1)] }).explanation[0]).toContain('Only 1 sold');
  });
});

// ── Condition ───────────────────────────────────────────────────────────────

describe('computePrice — the condition adjustment', () => {
  const comps = [sold(4000), sold(4200), sold(4400)];

  it('reads the identification, and states the change with both figures', () => {
    const r = computePrice({ comps, identification: ident({ condition: 'Fair' }), item: item() });
    // median 4200 × 0.75 = 3150 → $31.99
    expect(r.suggestedCents).toBe(3199);
    expect(r.explanation.some(l => /Fair condition: −25%/.test(l))).toBe(true);
    expect(r.explanation.some(l => /\$42\.00 → \$31\.50/.test(l))).toBe(true);
  });

  it('applies each grade at its documented multiplier', () => {
    const at = (condition: NonNullable<ClothingItem['condition']>) =>
      computePrice({ comps, identification: ident({ condition }), item: item() }).suggestedCents!;
    expect(at('Fair')).toBeLessThan(at('Good'));
    expect(at('Good')).toBeLessThan(at('Excellent'));
    expect(at('Excellent')).toBeLessThan(at('NWT'));
    expect(CONDITION_ADJUSTMENT.Excellent).toBe(1);
  });

  it('says nothing when the multiplier is 1', () => {
    const r = computePrice({ comps, identification: ident({ condition: 'Excellent' }), item: item() });
    expect(r.explanation.some(l => /condition:/.test(l))).toBe(false);
  });

  it('falls back to the item when the identification found no grade', () => {
    const r = computePrice({ comps, identification: ident(), item: item({ condition: 'Fair' }) });
    expect(r.suggestedCents).toBe(3199);
  });

  it('moves the whole band, not only the middle', () => {
    const wide = [sold(2000), sold(3000), sold(4000), sold(5000), sold(6000)];
    const plain = computePrice({ comps: wide, identification: ident(), item: item() });
    const fair = computePrice({ comps: wide, identification: ident({ condition: 'Fair' }), item: item() });
    expect(fair.lowCents!).toBeLessThan(plain.lowCents!);
    expect(fair.highCents!).toBeLessThan(plain.highCents!);
  });
});

// ── The review rule ─────────────────────────────────────────────────────────

describe('computePrice — needsReview', () => {
  it('fires on low confidence, in words', () => {
    const r = run({ comps: [sold(4000), sold(4200), sold(4400)] });
    // Three solds and a blank identification is a 0.42 — under the 0.6 bar.
    expect(r.needsReview).toBe(true);
    expect(r.reviewReasons.some(t => /Low confidence/.test(t))).toBe(true);
  });

  it('does not fire when both the comps and the identification are strong', () => {
    const strong = identifyListing({
      item: item({ era: '1990s', condition: 'Excellent' }),
      transcript: 'nineties tee, single stitch, deadstock',
    });
    const r = computePrice({
      comps: Array.from({ length: 12 }, (_, i) => sold(4000 + i * 10)),
      identification: strong,
      item: item(),
    });
    expect(r.needsReview).toBe(false);
    expect(r.reviewReasons).toEqual([]);
  });

  it('fires on a HIGH VALUE with merely-decent confidence — being wrong there costs money', () => {
    const decent = identifyListing({ item: item({ era: '1990s' }), transcript: 'nineties tee' });
    const r = computePrice({
      comps: Array.from({ length: 12 }, () => sold(20000)),
      identification: decent,
      item: item(),
    });
    expect(r.suggestedCents!).toBeGreaterThanOrEqual(REVIEW_HIGH_VALUE_CENTS);
    expect(r.needsReview).toBe(true);
    expect(r.reviewReasons.some(t => /high enough that being wrong costs real money/.test(t))).toBe(true);
  });

  it('fires when the piece itself is not confidently identified', () => {
    const r = computePrice({
      comps: Array.from({ length: 12 }, (_, i) => sold(4000 + i * 10)),
      identification: ident(),          // nothing known at all
      item: item(),
    });
    expect(r.reviewReasons.some(t => /not confidently identified/.test(t))).toBe(true);
  });
});

// ── The invariants ──────────────────────────────────────────────────────────

describe('computePrice — invariants', () => {
  it('NEVER suggests a non-positive price, over a wide sweep', () => {
    const conditions: Array<NonNullable<ClothingItem['condition']>> =
      ['Fair', 'Good', 'Used', 'Excellent', 'New', 'NWT'];
    for (const condition of conditions) {
      for (const cents of [1, 2, 50, 99, 100, 101, 999, 100000]) {
        for (const kind of ['sold', 'asking'] as const) {
          const comps = [1, 2, 3, 4, 5].map(n =>
            kind === 'sold' ? sold(cents * n) : asking(cents * n));
          const r = computePrice({ comps, identification: ident({ condition }), item: item() });
          expect(r.suggestedCents === null || r.suggestedCents > 0).toBe(true);
          if (r.suggestedCents !== null) {
            expect(r.lowCents!).toBeGreaterThan(0);
            expect(r.highCents!).toBeGreaterThan(0);
            expect(r.lowCents!).toBeLessThanOrEqual(r.suggestedCents);
            expect(r.suggestedCents).toBeLessThanOrEqual(r.highCents!);
          }
        }
      }
    }
  });

  it('EVERY dollar figure in the explanation traces back to the inputs', () => {
    const comps = [sold(3800), sold(4000), sold(4200), sold(4400), sold(4600)];
    const r = computePrice({ comps, identification: ident({ condition: 'Good' }), item: item() });
    const inputs = new Set(comps.map(c => c.price_cents));
    for (const figure of centsInExplanation(r.explanation)) {
      const derivable =
        inputs.has(figure) ||
        figure === r.suggestedCents || figure === r.lowCents || figure === r.highCents ||
        // the pre-adjustment median and the un-rounded adjusted figure
        [...inputs].some(v => Math.abs(figure - v) <= 1) ||
        figure === trimmedMedian([...inputs]) ||
        figure === Math.round(trimmedMedian([...inputs]) * CONDITION_ADJUSTMENT.Good);
      expect(derivable, `unexplained figure ${formatCents(figure)} in: ${r.explanation.join(' / ')}`).toBe(true);
    }
  });

  it('every confidence is within the column CHECK, 0..1', () => {
    const cases: Array<Partial<ComputePriceInput>> = [
      {},
      { spokenPriceCents: 4500 },
      { comps: [sold(4000), sold(4200), sold(4400)] },
      { comps: [asking(5000), asking(5500), asking(6000)] },
      { comps: Array.from({ length: 30 }, (_, i) => sold(1000 + i)) },
    ];
    for (const c of cases) {
      const r = run(c);
      expect(r.confidence).toBeGreaterThanOrEqual(0);
      expect(r.confidence).toBeLessThanOrEqual(1);
    }
  });

  it('is deterministic — the same input twice is byte-identical', () => {
    const args: ComputePriceInput = {
      comps: [sold(4000, '2026-01-01'), sold(4200, '2026-02-01'), sold(4400, '2026-03-01')],
      identification: ident({ condition: 'Good' }),
      item: item(),
    };
    expect(JSON.stringify(computePrice(args))).toBe(JSON.stringify(computePrice(args)));
  });

  it('does not mutate the comps it was given', () => {
    const comps = [sold(4400, '2026-01-01'), sold(4000, '2026-03-01'), sold(4200, '2026-02-01')];
    const before = JSON.stringify(comps);
    computePrice({ comps, identification: ident(), item: item() });
    expect(JSON.stringify(comps)).toBe(before);
  });

  it('names every method in words, for the card and the review list', () => {
    expect(Object.keys(METHOD_LABELS).sort())
      .toEqual(['asking_adjusted', 'insufficient', 'own_sold_median', 'spoken']);
    for (const label of Object.values(METHOD_LABELS)) expect(label.length).toBeGreaterThan(3);
  });

  it('every explanation line is a sentence a person can read', () => {
    const r = run({ comps: [sold(4000), sold(4200), sold(4400)] });
    for (const line of r.explanation) {
      expect(line).toMatch(/[.!]$/);
      expect(line).not.toMatch(/undefined|NaN|\[object/);
    }
  });
});
