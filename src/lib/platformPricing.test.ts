import { describe, it, expect } from 'vitest';
import {
  applyPlatformPrice, formatPlatformPrice, toPriceNumber, isIdentityRule,
  platformSlug, describePlatformRule, pricingExample, normalizePlatformRules,
  selectablePlatforms, NO_ADJUSTMENT_PLATFORM, PLATFORM_PRESETS,
  MAX_PERCENT, MAX_FIXED,
  type PlatformPricingRule, type PriceRounding, type PriceAdjustmentType,
} from './platformPricing';

const rule = (o: Partial<PlatformPricingRule> & { name?: string } = {}): PlatformPricingRule => ({
  id: o.id ?? 'p',
  name: o.name ?? 'Platform',
  enabled: o.enabled ?? true,
  adjustment: o.adjustment ?? { type: 'percent', value: 0 },
  rounding: o.rounding ?? 'none',
  applyToCompareAt: o.applyToCompareAt ?? false,
});

const pct = (value: number, rounding: PriceRounding = 'none') =>
  rule({ adjustment: { type: 'percent', value }, rounding });
const fix = (value: number, rounding: PriceRounding = 'none') =>
  rule({ adjustment: { type: 'fixed', value }, rounding });

describe('applyPlatformPrice — the two invariants', () => {
  it('INVARIANT 1: $0 and unset prices pass through UNCHANGED under every rule', () => {
    // If a rule could turn 0 into 0.99, selecting a platform would silently
    // defeat the exporter's $0 gate. Exhaustive over the rule space.
    const roundings: PriceRounding[] = ['none', '.99', 'whole'];
    const types: PriceAdjustmentType[] = ['percent', 'fixed'];
    for (const rounding of roundings) {
      for (const type of types) {
        for (const value of [-50, -1, 0, 1, 12.5, 500]) {
          const r = rule({ adjustment: { type, value }, rounding });
          expect(applyPlatformPrice(0, r)).toBe(0);
          expect(applyPlatformPrice(-0, r)).toBe(-0);
          expect(applyPlatformPrice(NaN, r)).toBeNaN();
          expect(applyPlatformPrice(Infinity, r)).toBe(Infinity);
          // A negative price is data corruption, not a discount — leave it
          // visible to the gate rather than "fixing" it into a sellable number.
          expect(applyPlatformPrice(-5, r)).toBe(-5);
        }
      }
    }
  });

  it('INVARIANT 2: a rule can never manufacture a non-positive price', () => {
    expect(applyPlatformPrice(20, pct(-100))).toBe(0.01);
    expect(applyPlatformPrice(20, pct(-100, 'whole'))).toBe(1);
    expect(applyPlatformPrice(20, pct(-100, '.99'))).toBe(0.99);
    expect(applyPlatformPrice(20, fix(-50))).toBe(0.01);
    expect(applyPlatformPrice(20, fix(-50, 'whole'))).toBe(1);
    expect(applyPlatformPrice(0.4, fix(0, 'whole'))).toBe(1);  // would round to 0
    expect(applyPlatformPrice(0.2, fix(0, '.99'))).toBe(0.99); // would round to -0.01
  });
});

describe('applyPlatformPrice — percent', () => {
  it('adds the percentage', () => {
    expect(applyPlatformPrice(45, pct(0))).toBe(45);
    expect(applyPlatformPrice(45, pct(10))).toBe(49.5);
    expect(applyPlatformPrice(45, pct(13))).toBe(50.85);
    expect(applyPlatformPrice(100, pct(12.5))).toBe(112.5);
  });

  it('subtracts a negative percentage (a discount platform)', () => {
    expect(applyPlatformPrice(50, pct(-10))).toBe(45);
  });

  it('is free of binary-float dust', () => {
    // 0.1 + 0.2 arithmetic shows up immediately in money.
    expect(applyPlatformPrice(19.99, pct(15))).toBe(22.99);
    expect(applyPlatformPrice(0.07, pct(10))).toBe(0.08);
    expect(String(applyPlatformPrice(29.95, pct(7)))).not.toMatch(/0000|9999/);
  });

  it('clamps an absurd percentage rather than rescaling the export', () => {
    expect(applyPlatformPrice(10, pct(999999))).toBe(applyPlatformPrice(10, pct(MAX_PERCENT)));
  });
});

describe('applyPlatformPrice — fixed dollars', () => {
  it('adds and subtracts dollars', () => {
    expect(applyPlatformPrice(45, fix(5))).toBe(50);
    expect(applyPlatformPrice(45, fix(4.5))).toBe(49.5);
    expect(applyPlatformPrice(45, fix(-5))).toBe(40);
  });

  it('clamps an absurd fixed amount', () => {
    expect(applyPlatformPrice(10, fix(1e9))).toBe(applyPlatformPrice(10, fix(MAX_FIXED)));
  });
});

describe('applyPlatformPrice — rounding', () => {
  it(".99 takes the NEAREST whole dollar less a penny (the founder's example)", () => {
    // $45.00 +10% = $49.50 → $49.99. This is the worked example in the brief.
    expect(applyPlatformPrice(45, pct(10, '.99'))).toBe(49.99);
    expect(pricingExample(pct(10, '.99'))).toBe('$45.00 → $49.99');
  });

  it('.99 rounds down as well as up', () => {
    expect(applyPlatformPrice(50.4, fix(0, '.99'))).toBe(49.99);
    expect(applyPlatformPrice(50.6, fix(0, '.99'))).toBe(50.99);
    expect(applyPlatformPrice(50.5, fix(0, '.99'))).toBe(50.99); // ties go up
    expect(applyPlatformPrice(45, fix(0, '.99'))).toBe(44.99);
  });

  it('whole rounds to the nearest dollar with no cents', () => {
    expect(applyPlatformPrice(49.5, fix(0, 'whole'))).toBe(50);
    expect(applyPlatformPrice(49.49, fix(0, 'whole'))).toBe(49);
    expect(applyPlatformPrice(45, pct(13, 'whole'))).toBe(51); // 50.85 → 51
  });

  it('none keeps exact cents', () => {
    expect(applyPlatformPrice(45, pct(13, 'none'))).toBe(50.85);
  });

  it('an unknown rounding mode degrades to exact cents, never to a throw', () => {
    const weird = { ...pct(10), rounding: 'banker' as unknown as PriceRounding };
    expect(applyPlatformPrice(45, weird)).toBe(49.5);
  });
});

describe('applyPlatformPrice — absent and malformed rules', () => {
  it('no rule is a pass-through rounded to cents', () => {
    expect(applyPlatformPrice(45, null)).toBe(45);
    expect(applyPlatformPrice(45, undefined)).toBe(45);
    expect(applyPlatformPrice(45.005, null)).toBe(45.01);
  });

  it('the identity platform changes nothing', () => {
    for (const p of [0.01, 1, 45, 19.99, 1234.56]) {
      expect(applyPlatformPrice(p, NO_ADJUSTMENT_PLATFORM)).toBe(p);
    }
  });

  it('a NaN / missing adjustment is treated as zero, not as a throw', () => {
    const broken = { ...pct(0) } as PlatformPricingRule;
    (broken as unknown as Record<string, unknown>).adjustment = undefined;
    expect(applyPlatformPrice(45, broken)).toBe(45);
    expect(applyPlatformPrice(45, pct(NaN))).toBe(45);
  });
});

describe('formatPlatformPrice — the CSV/preview cell', () => {
  it('always emits two decimals', () => {
    expect(formatPlatformPrice(45, pct(10))).toBe('49.50');
    expect(formatPlatformPrice(45, pct(10, '.99'))).toBe('49.99');
    expect(formatPlatformPrice(50, fix(0, 'whole'))).toBe('50.00');
  });

  it('accepts the string prices the DB hands back', () => {
    expect(formatPlatformPrice('45', pct(10))).toBe('49.50');
    expect(formatPlatformPrice('45.00', null)).toBe('45.00');
  });

  it('returns an empty cell for no price — and 0.00 for a real zero', () => {
    expect(formatPlatformPrice(null, pct(10))).toBe('');
    expect(formatPlatformPrice(undefined, pct(10))).toBe('');
    expect(formatPlatformPrice('', pct(10))).toBe('');
    expect(formatPlatformPrice('abc', pct(10))).toBe('');
    // A real 0 still prints as 0.00 so the gate's message and the CSV agree.
    expect(formatPlatformPrice(0, pct(10, '.99'))).toBe('0.00');
  });
});

describe('compare-at handling', () => {
  it('applyToCompareAt is a flag the CALLER honours — the rule itself is one function', () => {
    const r = rule({ adjustment: { type: 'percent', value: 10 }, applyToCompareAt: true });
    // Caller passes compare-at through the same function only when the flag is set.
    expect(r.applyToCompareAt).toBe(true);
    expect(applyPlatformPrice(60, r)).toBe(66);
  });

  it('leaving compare-at unadjusted can make it fall below the sale price — the CSV drops it', () => {
    // 45 → 54 under +20%, while a 50 compare-at stays 50. The exporter only
    // emits compare-at when strictly greater, so this degrades to blank, not
    // to a Shopify import error.
    const sale = applyPlatformPrice(45, pct(20));
    expect(sale).toBe(54);
    expect(50 > sale).toBe(false);
  });
});

describe('isIdentityRule', () => {
  it('is true for no rule, the default platform, and 0% with no rounding', () => {
    expect(isIdentityRule(null)).toBe(true);
    expect(isIdentityRule(undefined)).toBe(true);
    expect(isIdentityRule(NO_ADJUSTMENT_PLATFORM)).toBe(true);
    expect(isIdentityRule(pct(0))).toBe(true);
    expect(isIdentityRule(fix(0))).toBe(true);
  });

  it('is false as soon as anything would change', () => {
    expect(isIdentityRule(pct(1))).toBe(false);
    expect(isIdentityRule(fix(-1))).toBe(false);
    expect(isIdentityRule(pct(0, '.99'))).toBe(false);
    expect(isIdentityRule(pct(0, 'whole'))).toBe(false);
  });
});

describe('platformSlug', () => {
  it('makes a filename-safe slug', () => {
    expect(platformSlug('eBay')).toBe('ebay');
    expect(platformSlug('Etsy — vintage shop')).toBe('etsy-vintage-shop');
    expect(platformSlug('  Depop  ')).toBe('depop');
    expect(platformSlug('Poshmark/US')).toBe('poshmark-us');
  });

  it('never returns an empty or path-traversing string', () => {
    expect(platformSlug('')).toBe('export');
    expect(platformSlug('///')).toBe('export');
    expect(platformSlug('../../etc/passwd')).toBe('etc-passwd');
    expect(platformSlug('日本')).toBe('export');
  });
});

describe('describePlatformRule — the one-line summary', () => {
  it('reads the way the brief specifies', () => {
    expect(describePlatformRule(rule({
      name: 'eBay', adjustment: { type: 'percent', value: 12 }, rounding: '.99',
    }))).toBe('Prices +12% rounded to .99 for eBay');
  });

  it('covers fixed, negative, whole and compare-at', () => {
    expect(describePlatformRule(rule({ name: 'Depop', adjustment: { type: 'fixed', value: 4 } })))
      .toBe('Prices +$4.00 for Depop');
    expect(describePlatformRule(rule({ name: 'Sale', adjustment: { type: 'percent', value: -10 } })))
      .toBe('Prices −10% for Sale');
    expect(describePlatformRule(rule({ name: 'Etsy', adjustment: { type: 'percent', value: 9 }, rounding: 'whole' })))
      .toBe('Prices +9% rounded to whole dollars for Etsy');
    expect(describePlatformRule(rule({ name: 'eBay', adjustment: { type: 'percent', value: 5 }, applyToCompareAt: true })))
      .toBe('Prices +5% for eBay (compare-at too)');
  });

  it('says so plainly when nothing changes', () => {
    expect(describePlatformRule(NO_ADJUSTMENT_PLATFORM)).toBe('Prices unchanged for Shopify');
    expect(describePlatformRule(null)).toBe('');
  });
});

describe('normalizePlatformRules — the JSONB is untrusted input', () => {
  it('returns [] for anything that is not an array', () => {
    for (const v of [null, undefined, {}, 'x', 7, true]) {
      expect(normalizePlatformRules(v)).toEqual([]);
    }
  });

  it('keeps well-formed rules and fills in defaults', () => {
    expect(normalizePlatformRules([{ id: 'ebay', name: 'eBay' }])).toEqual([{
      id: 'ebay', name: 'eBay', enabled: true,
      adjustment: { type: 'percent', value: 0 }, rounding: 'none', applyToCompareAt: false,
    }]);
  });

  it('drops entries with no usable name rather than inventing one', () => {
    expect(normalizePlatformRules([{ name: '   ' }, { name: 42 }, null, 'x', { id: 'a' }])).toEqual([]);
  });

  it('derives a missing id from the name and de-duplicates', () => {
    const out = normalizePlatformRules([{ name: 'eBay' }, { name: 'e bay' }, { name: 'eBay' }]);
    expect(out.map(r => r.id)).toEqual(['ebay', 'e-bay']);
  });

  it('coerces the adjustment and clamps it', () => {
    const [r] = normalizePlatformRules([{ name: 'X', adjustment: { type: 'nonsense', value: '12.5' } }]);
    expect(r.adjustment).toEqual({ type: 'percent', value: 12.5 });
    const [big] = normalizePlatformRules([{ name: 'X', adjustment: { type: 'percent', value: 1e9 } }]);
    expect(big.adjustment.value).toBe(MAX_PERCENT);
    const [nan] = normalizePlatformRules([{ name: 'X', adjustment: { value: 'abc' } }]);
    expect(nan.adjustment.value).toBe(0);
  });

  it('only accepts the three known rounding modes', () => {
    expect(normalizePlatformRules([{ name: 'A', rounding: '.99' }])[0].rounding).toBe('.99');
    expect(normalizePlatformRules([{ name: 'A', rounding: 'whole' }])[0].rounding).toBe('whole');
    expect(normalizePlatformRules([{ name: 'A', rounding: 'magic' }])[0].rounding).toBe('none');
  });

  it('truncates a hostile name and id instead of rendering them whole', () => {
    const [r] = normalizePlatformRules([{ id: 'z'.repeat(200), name: 'n'.repeat(200) }]);
    expect(r.name).toHaveLength(40);
    expect(r.id).toHaveLength(60);
  });

  it('treats enabled/applyToCompareAt strictly', () => {
    const [a] = normalizePlatformRules([{ name: 'A', enabled: false, applyToCompareAt: 'yes' }]);
    expect(a.enabled).toBe(false);
    expect(a.applyToCompareAt).toBe(false); // only a real `true` counts
  });
});

describe('selectablePlatforms', () => {
  it('always offers the no-adjustment platform first', () => {
    expect(selectablePlatforms(null)).toEqual([NO_ADJUSTMENT_PLATFORM]);
    expect(selectablePlatforms([])).toEqual([NO_ADJUSTMENT_PLATFORM]);
  });

  it('appends enabled platforms and hides disabled ones', () => {
    const list = selectablePlatforms([
      rule({ id: 'ebay', name: 'eBay' }),
      rule({ id: 'depop', name: 'Depop', enabled: false }),
    ]);
    expect(list.map(r => r.id)).toEqual(['shopify-direct', 'ebay']);
  });

  it("a configured platform that reuses the default's id replaces it", () => {
    const mine = rule({ id: NO_ADJUSTMENT_PLATFORM.id, name: 'Shopify', adjustment: { type: 'percent', value: 3 } });
    expect(selectablePlatforms([mine])).toEqual([mine]);
  });
});

describe('PLATFORM_PRESETS', () => {
  it('covers the marketplaces the founder named, Shopify first', () => {
    const names = PLATFORM_PRESETS.map(p => p.name);
    expect(names[0]).toBe('Shopify');
    for (const m of ['eBay', 'Depop', 'Poshmark', 'Mercari', 'Etsy', 'Grailed', 'Vinted']) {
      expect(names).toContain(m);
    }
  });

  it('every preset is a sane starting percentage and survives normalization', () => {
    for (const p of PLATFORM_PRESETS) {
      expect(p.percent).toBeGreaterThanOrEqual(0);
      expect(p.percent).toBeLessThan(100);
      const [r] = normalizePlatformRules([{ name: p.name, adjustment: { type: 'percent', value: p.percent } }]);
      expect(r.name).toBe(p.name);
    }
  });
});

describe('toPriceNumber', () => {
  it('parses what the DB and forms actually contain', () => {
    expect(toPriceNumber(45)).toBe(45);
    expect(toPriceNumber('45.50')).toBe(45.5);
    expect(toPriceNumber(null)).toBeNaN();
    expect(toPriceNumber('')).toBeNaN();
    expect(toPriceNumber('free')).toBeNaN();
    expect(toPriceNumber(Infinity)).toBeNaN();
  });
});
