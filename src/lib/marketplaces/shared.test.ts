import { describe, it, expect } from 'vitest';
import {
  isBlank, collapseWs, coalesceGroup, cutTitle, cutText, toPlainText, toHtml,
  stripHashtagLines, buildTags, buildHashtags, tagSource, cleanPhotos, limitPhotos,
  photoIssues, issue, resolveControlled, applyPrice, buildAutoTitle, decadeFromEra,
  compactAttributes, feedDate, toCsv, baseFormat,
} from './shared';
import { NO_VOCAB, type MarketplaceSpec, type VocabResolver } from './types';
import type { ClothingItem } from '../../App';
import { FULL_GROUP, fullInput, stubVocab } from './fixtures';
import type { PlatformPricingRule } from '../platformPricing';

const item = (o: Partial<ClothingItem>): ClothingItem => ({ ...o } as ClothingItem);

const testSpec = (over: Partial<MarketplaceSpec> = {}): MarketplaceSpec => ({
  key: 'poshmark',
  name: 'Testplace',
  channels: ['pack'],
  title: { max: 40 },
  description: { max: 200, format: 'plain' },
  photos: { min: 1, max: 3 },
  tags: { max: 0, style: 'none' },
  brand: { controlled: false, fallback: null },
  color: { controlled: false, fallback: null },
  condition: {
    values: ['A', 'B'],
    map: { new_with_tags: 'A', new_without_tags: 'A', excellent: 'B', good: 'B', fair: 'B', poor: 'B' },
  },
  category: { kind: 'free' },
  verified: false,
  ...over,
});

const rule = (o: Partial<PlatformPricingRule>): PlatformPricingRule => ({
  id: 'p', name: 'P', enabled: true,
  adjustment: { type: 'percent', value: 0 }, rounding: 'none', applyToCompareAt: false,
  ...o,
});

describe('isBlank / collapseWs', () => {
  it('matches the exporter definition of blank', () => {
    for (const v of [undefined, null, '', [], {}]) expect(isBlank(v)).toBe(true);
    for (const v of [0, false, 'x', [1], { a: 1 }]) expect(isBlank(v)).toBe(false);
  });
  it('collapses every run of whitespace and trims', () => {
    expect(collapseWs('  a \n\t b  ')).toBe('a b');
    expect(collapseWs(undefined)).toBe('');
  });
});

describe('coalesceGroup', () => {
  it('takes the first non-blank value per field, leader first', () => {
    const merged = coalesceGroup(FULL_GROUP);
    expect(merged.id).toBe('grp-1');            // the leader's identity is kept
    expect(merged.brand).toBe('Nike');          // leader
    expect(merged.price).toBe(45);              // only on the SECOND photo
    expect(merged.material).toBe('80% cotton, 20% polyester'); // only on the THIRD
  });

  it('never lets a later member overwrite a value the leader has', () => {
    const merged = coalesceGroup([
      item({ id: 'a', brand: 'Nike', price: 45 }),
      item({ id: 'b', brand: 'Adidas', price: 10 }),
    ]);
    expect(merged.brand).toBe('Nike');
    expect(merged.price).toBe(45);
  });

  it('treats empty strings, arrays and objects as missing', () => {
    const merged = coalesceGroup([
      item({ id: 'a', brand: '', tags: [], measurements: {} }),
      item({ id: 'b', brand: 'Levi’s', tags: ['vintage'], measurements: { chest: '22' } }),
    ]);
    expect(merged.brand).toBe('Levi’s');
    expect(merged.tags).toEqual(['vintage']);
    expect(merged.measurements).toEqual({ chest: '22' });
  });

  it('does not mutate the members it read from', () => {
    const members = [item({ id: 'a' }), item({ id: 'b', brand: 'Nike' })];
    const merged = coalesceGroup(members);
    merged.brand = 'Changed';
    expect(members[1].brand).toBe('Nike');
    expect(members[0].brand).toBeUndefined();
  });

  it('survives an empty group instead of throwing', () => {
    expect(() => coalesceGroup([])).not.toThrow();
  });
});

describe('cutTitle', () => {
  it('leaves a title inside the limit alone', () => {
    expect(cutTitle('Vintage Nike Tee', 40)).toBe('Vintage Nike Tee');
  });
  it('cuts at a word boundary, never mid-word', () => {
    const out = cutTitle('Vintage 90s Nike Grey Embroidered Crewneck Sweatshirt', 30);
    expect(out.length).toBeLessThanOrEqual(30);
    expect(out).toBe('Vintage 90s Nike Grey');
    expect('Vintage 90s Nike Grey Embroidered Crewneck Sweatshirt').toContain(out);
  });
  it('never ends on a separator', () => {
    expect(cutTitle('Vintage Nike - Grey Crewneck', 16)).toBe('Vintage Nike');
    expect(cutTitle('Vintage Nike, Grey Crewneck', 14)).toBe('Vintage Nike');
  });
  it('hard-cuts a single word longer than the limit — an empty title is worse', () => {
    expect(cutTitle('Supercalifragilistic', 10)).toBe('Supercalif');
  });
  it('adds no ellipsis: every character is the seller’s budget', () => {
    expect(cutTitle('Vintage Nike Grey Crewneck', 15)).not.toContain('…');
  });
  it('handles nonsense limits without throwing', () => {
    expect(cutTitle('x', 0)).toBe('');
    expect(cutTitle('x', NaN)).toBe('');
    expect(cutTitle(undefined, 10)).toBe('');
  });
});

describe('cutText', () => {
  const body = 'First sentence here. Second sentence here. Third sentence runs on and on and on.';

  it('leaves text inside the limit alone', () => {
    expect(cutText(body, 500)).toBe(body);
  });

  it('ends on a sentence when one falls in the last 15% of the budget', () => {
    const out = cutText(body, 45);
    expect(out).toBe('First sentence here. Second sentence here.');
    expect(out.length).toBeLessThanOrEqual(45);
  });

  it('falls back to a word boundary when no sentence ends near the limit', () => {
    const out = cutText('one two three four five six seven eight nine ten', 20);
    expect(out).toBe('one two three four');
    expect(out.length).toBeLessThanOrEqual(20);
  });

  it('ends on a line break when that is the nearest boundary', () => {
    const out = cutText('line one\nline two\nline three is much much longer', 22);
    expect(out).toBe('line one\nline two');
  });

  it('never exceeds the limit', () => {
    for (const max of [5, 10, 20, 40, 78, 79, 80]) {
      expect(cutText(body, max).length).toBeLessThanOrEqual(max);
    }
  });
});

describe('toPlainText / toHtml', () => {
  it('reverses the Shopify Body (HTML) round trip', () => {
    expect(toPlainText('a<br><br>b<br>c')).toBe('a\n\nb\nc');
    expect(toPlainText('<p>a</p><p>b</p>')).toBe('a\n\nb');
  });
  it('decodes &amp; LAST so &amp;lt; stays a literal &lt;', () => {
    expect(toPlainText('Dolce &amp; Gabbana')).toBe('Dolce & Gabbana');
    expect(toPlainText('&amp;lt;')).toBe('&lt;');
  });
  it('escapes before converting, so a description cannot inject markup', () => {
    expect(toHtml('100% cotton <a steal>')).toBe('100% cotton &lt;a steal&gt;');
    expect(toHtml('a\n\nb\nc')).toBe('a<br><br>b<br>c');
  });
  it('round-trips plain text through HTML unchanged', () => {
    const plain = 'Line one\n\nLine two\nLine three';
    expect(toPlainText(toHtml(plain))).toBe(plain);
  });
});

describe('stripHashtagLines', () => {
  it('drops lines that are nothing but hashtags', () => {
    expect(stripHashtagLines('Body text.\n\n#vintage #nike #90s')).toBe('Body text.');
  });
  it('keeps a line where a hashtag sits inside a sentence', () => {
    const t = 'Great for #vintage lovers.';
    expect(stripHashtagLines(t)).toBe(t);
  });
});

describe('buildTags', () => {
  it('de-duplicates case-insensitively and respects the count limit', () => {
    expect(buildTags(['Vintage', 'vintage', 'nike', 'tee'], 2)).toEqual(['Vintage', 'nike']);
  });
  it('strips a leading # and collapses whitespace', () => {
    expect(buildTags(['#vintage', '  single   stitch '], 5)).toEqual(['vintage', 'single stitch']);
  });
  it('cuts a long tag at a word boundary to the per-tag limit', () => {
    expect(buildTags(['vintage nike crewneck sweatshirt'], 5, 20)).toEqual(['vintage nike']);
  });
  it('returns nothing when the marketplace has no tag field', () => {
    expect(buildTags(['vintage'], 0)).toEqual([]);
  });
});

describe('buildHashtags', () => {
  it('joins the words — a hashtag with a space in it is two hashtags', () => {
    expect(buildHashtags(['single stitch', '90s streetwear'], 5)).toEqual(['#singlestitch', '#90sstreetwear']);
  });
  it('de-duplicates and caps the count', () => {
    expect(buildHashtags(['Vintage', '#vintage', 'nike'], 2)).toEqual(['#Vintage', '#nike']);
  });
  it('counts maxLength against the word, not the #', () => {
    expect(buildHashtags(['abcdefghij'], 5, 4)).toEqual(['#abcd']);
  });
  it('drops anything with no letters or digits left', () => {
    expect(buildHashtags(['---', '!!!', 'ok'], 5)).toEqual(['#ok']);
  });
});

describe('tagSource', () => {
  it('prefers hashtags already written into the description (the exporter rule)', () => {
    const i = item({ generatedDescription: 'Body\n\n#vintage #nike', tags: ['ignored'] });
    expect(tagSource(i)).toEqual(['vintage', 'nike']);
  });
  it('falls back to the structured tag array', () => {
    expect(tagSource(item({ generatedDescription: 'Body', tags: ['vintage'] }))).toEqual(['vintage']);
  });
});

describe('photos', () => {
  const spec = testSpec();
  it('trims, drops blanks and de-duplicates, preserving order', () => {
    expect(cleanPhotos([' a ', '', 'b', 'a', undefined as unknown as string])).toEqual(['a', 'b']);
  });
  it('keeps the leader first and cuts to the limit', () => {
    expect(limitPhotos(['a', 'b', 'c', 'd'], spec)).toEqual(['a', 'b', 'c']);
  });
  it('errors below the minimum', () => {
    const [i] = photoIssues([], spec);
    expect(i.level).toBe('error');
    expect(i.field).toBe('photos');
    expect(i.message).toBe('No photos — Testplace needs at least 1 photo.');
  });
  it('warns above the maximum and says how many are dropped', () => {
    const [i] = photoIssues(['a', 'b', 'c', 'd', 'e'], spec);
    expect(i.level).toBe('warning');
    expect(i.message).toBe('2 photos will be dropped — Testplace accepts 3.');
  });
  it('says nothing when the count is fine', () => {
    expect(photoIssues(['a', 'b'], spec)).toEqual([]);
  });
});

describe('issue', () => {
  it('omits value and fixKind when there are none, so equal issues serialise equally', () => {
    expect(issue(testSpec(), 'warning', 'brand', 'msg')).toEqual({
      marketplace: 'poshmark', level: 'warning', field: 'brand', message: 'msg',
    });
  });
  it('carries what "remember this mapping" needs when there is a value', () => {
    expect(issue(testSpec(), 'warning', 'color', 'msg', { value: 'Forest Green', fixKind: 'color' }))
      .toMatchObject({ value: 'Forest Green', fixKind: 'color' });
  });
});

describe('resolveControlled', () => {
  const spec = testSpec();
  const listField = { controlled: true, values: ['Green', 'Blue'] as const, fallback: 'Multi' };

  it('matches the marketplace list through case, spacing and punctuation', () => {
    expect(resolveControlled('color', listField, ' green ', NO_VOCAB, spec).value).toBe('Green');
    expect(resolveControlled('color', { ...listField, values: ['Light blue'] }, 'LIGHT-BLUE', NO_VOCAB, spec).value)
      .toBe('Light blue');
  });

  it('falls to the workspace vocabulary when the list has no match', () => {
    const vocab: VocabResolver = stubVocab({ 'color:poshmark:forest green': 'Green' });
    const r = resolveControlled('color', listField, 'Forest Green', vocab, spec);
    expect(r.value).toBe('Green');
    expect(r.issue).toBeUndefined();
  });

  it('falls back and WARNS rather than letting the marketplace default silently', () => {
    const r = resolveControlled('color', listField, 'Forest Green', NO_VOCAB, spec);
    expect(r.value).toBe('Multi');
    expect(r.issue).toMatchObject({ level: 'warning', field: 'color', value: 'Forest Green', fixKind: 'color' });
    expect(r.issue?.message).toContain('is not on Testplace’s list'.replace('’', "'"));
  });

  it('passes an uncontrolled field through untouched', () => {
    const r = resolveControlled('color', { controlled: false, fallback: null }, 'Forest Green', NO_VOCAB, spec);
    expect(r).toEqual({ value: 'Forest Green' });
  });

  it('NEVER falls a brand back — it goes out as typed, with a warning', () => {
    const r = resolveControlled('brand', { controlled: true, fallback: 'Other' }, 'Ecko Unltd', NO_VOCAB, spec);
    expect(r.value).toBe('Ecko Unltd');       // not "Other"
    expect(r.issue).toMatchObject({ level: 'warning', field: 'brand', value: 'Ecko Unltd', fixKind: 'brand' });
  });

  it('says nothing about a brand the workspace has already mapped', () => {
    const vocab = stubVocab({ 'brand:poshmark:ecko unltd': 'Ecko Unlimited' });
    const r = resolveControlled('brand', { controlled: true, fallback: null }, 'Ecko Unltd', vocab, spec);
    expect(r).toEqual({ value: 'Ecko Unlimited' });
  });

  it('warns when a controlled field is empty, and names the fallback it will use', () => {
    const r = resolveControlled('color', listField, '', NO_VOCAB, spec);
    expect(r.value).toBe('Multi');
    expect(r.issue?.message).toBe('No color set — Testplace will list it as "Multi".');
  });

  it('is silent about an empty field the marketplace does not need', () => {
    expect(resolveControlled('color', { controlled: false, fallback: null }, '', NO_VOCAB, spec))
      .toEqual({ value: null });
  });
});

describe('applyPrice', () => {
  it('applies the platform rule', () => {
    expect(applyPrice({ price: 45 }, rule({ adjustment: { type: 'percent', value: 10 }, rounding: '.99' })))
      .toEqual({ price: 49.99, compareAtPrice: null });
  });

  it('a missing or $0 price is null — never handed to the rule', () => {
    const charm = rule({ adjustment: { type: 'percent', value: 10 }, rounding: '.99' });
    for (const price of [undefined, null, 0, -5, NaN]) {
      expect(applyPrice({ price: price as number | undefined }, charm))
        .toEqual({ price: null, compareAtPrice: null });
    }
  });

  it('emits a compare-at only when it is above the price actually charged', () => {
    expect(applyPrice({ price: 45, compareAtPrice: 60 }).compareAtPrice).toBe(60);
    expect(applyPrice({ price: 45, compareAtPrice: 40 }).compareAtPrice).toBeNull();
    expect(applyPrice({ price: 45, compareAtPrice: 45 }).compareAtPrice).toBeNull();
  });

  it('leaves compare-at alone unless the rule opts in', () => {
    const up = rule({ adjustment: { type: 'percent', value: 20 } });
    expect(applyPrice({ price: 45, compareAtPrice: 60 }, up)).toEqual({ price: 54, compareAtPrice: 60 });
    expect(applyPrice({ price: 45, compareAtPrice: 60 }, { ...up, applyToCompareAt: true }))
      .toEqual({ price: 54, compareAtPrice: 72 });
  });
});

describe('buildAutoTitle', () => {
  it('builds from the filled fields when no title was generated', () => {
    expect(buildAutoTitle(item({ brand: 'Nike', color: 'Grey', category: 'sweatshirts', size: 'L' })))
      .toBe('Nike Grey sweatshirts (L)');
  });
  it('falls back to the filename so every listing gets a handle', () => {
    expect(buildAutoTitle(item({ originalName: 'DSC_02175.jpg' }))).toBe('DSC 02175');
  });
  it('returns empty when there is nothing at all', () => {
    expect(buildAutoTitle(item({}))).toBe('');
  });
});

describe('decadeFromEra', () => {
  it('reads the decade a reseller means', () => {
    expect(decadeFromEra('90s')).toBe('1990s');
    expect(decadeFromEra('1990s')).toBe('1990s');
    expect(decadeFromEra('vintage 70s')).toBe('1970s');
    expect(decadeFromEra('2000s')).toBe('2000s');
    expect(decadeFromEra('00s')).toBe('2000s');
    expect(decadeFromEra('10s')).toBe('2010s');
    expect(decadeFromEra('y2k')).toBe('2000s');
  });
  it('is empty when there is no decade in the text', () => {
    expect(decadeFromEra('vintage')).toBe('');
    expect(decadeFromEra(undefined)).toBe('');
  });
});

describe('compactAttributes / feedDate / toCsv', () => {
  it('drops every blank attribute — an empty item specific is rejected, not ignored', () => {
    expect(compactAttributes({ a: 'x', b: '', c: undefined, d: null, e: '  ' })).toEqual({ a: 'x' });
  });
  it('uses the injected date and rejects anything that is not one', () => {
    expect(feedDate('2026-09-15')).toBe('2026-09-15');
    expect(feedDate('nonsense')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  it('escapes every cell through the formula-injection guard', () => {
    const csv = toCsv(['a', 'b'], [['=cmd()', 'x,y']]);
    expect(csv).toBe('a,b\n\'=cmd(),"x,y"');
  });
});

describe('baseFormat', () => {
  it('never throws on an item with nothing in it', () => {
    const empty = { group: [], item: {} as ClothingItem, imageUrls: [], vocab: NO_VOCAB };
    expect(() => baseFormat(testSpec(), empty)).not.toThrow();
    const out = baseFormat(testSpec(), empty);
    expect(out.title).toBe('');
    expect(out.price).toBeNull();
    expect(out.issues.some(i => i.level === 'error')).toBe(true);
  });

  it('reserves the hashtag block out of the description budget so tags are never cut off', () => {
    const spec = testSpec({ description: { max: 60, format: 'plain' }, tags: { max: 3, style: 'hashtags' } });
    const out = baseFormat(spec, fullInput());
    const block = out.tags.join(' ');
    expect(out.description.endsWith(block)).toBe(true);
    expect(out.description.length).toBeLessThanOrEqual(60);
  });

  it('converts the description to HTML only for an HTML marketplace', () => {
    const plain = baseFormat(testSpec(), fullInput());
    const html = baseFormat(testSpec({ description: { max: 2000, format: 'html' } }), fullInput());
    expect(plain.description).not.toContain('<br>');
    expect(html.description).toContain('<br>');
  });

  it('keys the listing on the group leader, not the photo it was called with', () => {
    expect(baseFormat(testSpec(), fullInput()).productGroupId).toBe('grp-1');
  });
});
