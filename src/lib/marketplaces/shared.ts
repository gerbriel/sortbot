/**
 * marketplaces/shared — the helpers every adapter is built from.
 *
 * Ten adapters formatting the same listing ten ways is ten chances to cut a
 * title differently, count photos differently, or apply a price rule twice.
 * So the parts that must not vary live here once, and an adapter is the part
 * that genuinely differs: its spec, its attributes, its feed columns.
 *
 * Pure: no DOM, no network, no Supabase, no React, no Date, no randomness.
 */

import type { ClothingItem } from '../../App';
import { applyPlatformPrice, toPriceNumber, type PlatformPricingRule } from '../platformPricing';
import { baseSize, stripUnresolvedTokens, escapeCsvValue } from '../csvExport';
import { normalizeCondition } from './conditions';
import type {
  FormattedListing, IssueLevel, ListingInput, MarketplaceSpec,
  ReadinessIssue, VocabKind, VocabResolver,
} from './types';

// ── small string utilities ──────────────────────────────────────────────────

/** The exporter's blank test, verbatim: '', null, undefined, [], {}. */
export const isBlank = (v: unknown): boolean =>
  v === undefined || v === null || v === '' ||
  (Array.isArray(v) && v.length === 0) ||
  (typeof v === 'object' && v !== null && !Array.isArray(v) && Object.keys(v).length === 0);

/** Single-line: every run of whitespace becomes one space, ends trimmed. */
export const collapseWs = (raw: string | undefined | null): string =>
  String(raw ?? '').replace(/\s+/g, ' ').trim();

const normalizeNewlines = (raw: string | undefined | null): string =>
  String(raw ?? '').replace(/\r\n?/g, '\n');

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Trailing punctuation a cut may land on. `.` `!` `?` `"` `'` are deliberately
 * NOT here — a truncation that happens to land after a sentence should keep it.
 */
const SEPARATOR_TAIL = /[\s\-–—,;:|/\\&+([{]+$/;

// ── the group → one item rule ───────────────────────────────────────────────

const EMPTY_ITEM = {} as ClothingItem;

/**
 * One listing out of a photo group: for every field, the first member that has
 * a non-blank value, starting from the leader.
 *
 * This is `GoogleSheetExporter`'s coalescing rule reproduced exactly (base is a
 * shallow copy of `group[0]`, then each member in order fills only what is
 * still blank), and it is reproduced rather than imported because that copy
 * lives inside a React component. It exists because a group's fields are
 * written per-item by several different paths, so price may sit on member 3
 * and brand on member 1 — and which member happens to be first must never
 * decide what gets published.
 */
export function coalesceGroup(group: readonly ClothingItem[]): ClothingItem {
  const base = { ...(group[0] ?? EMPTY_ITEM) } as ClothingItem;
  const acc = base as unknown as Record<string, unknown>;
  for (const member of group) {
    const src = member as unknown as Record<string, unknown>;
    for (const k in src) {
      if (isBlank(acc[k]) && !isBlank(src[k])) acc[k] = src[k];
    }
  }
  return base;
}

// ── cutting to a limit ──────────────────────────────────────────────────────

/**
 * A title cut to `max`, never mid-word and never ending on a separator.
 *
 * No ellipsis: the seller pastes this string into the marketplace's own title
 * box, where a trailing "…" is a character of their budget spent on nothing.
 * A single word longer than the limit is hard-cut — there is no word boundary
 * to use, and dropping it would publish an empty title.
 */
export function cutTitle(raw: string | undefined | null, max: number): string {
  const text = collapseWs(raw);
  if (!text || !Number.isFinite(max) || max <= 0) return '';
  if (text.length <= max) return text;
  const slice = text.slice(0, max);
  // The cut landed exactly on a word boundary — the next character is a space,
  // so the whole slice is already whole words. Without this, a title that fits
  // the limit to the character loses its last word for nothing.
  if (text[max] === ' ') return slice.replace(SEPARATOR_TAIL, '').trim();
  const lastSpace = slice.lastIndexOf(' ');
  const cut = lastSpace > 0 ? slice.slice(0, lastSpace) : slice;
  return cut.replace(SEPARATOR_TAIL, '').trim() || slice.trim();
}

/**
 * A body cut to `max`, preferring a real ending.
 *
 * If a sentence end or a line break falls inside the last 15% of the budget,
 * the text ends there — a description that stops on "…ships next day." reads
 * finished, one that stops on "…ships next" reads broken. Otherwise it falls
 * back to a word boundary. No ellipsis, for the same reason as `cutTitle`.
 */
export function cutText(raw: string | undefined | null, max: number): string {
  const text = normalizeNewlines(raw).trim();
  if (!text || !Number.isFinite(max) || max <= 0) return '';
  if (text.length <= max) return text;

  const slice = text.slice(0, max);
  const window = Math.floor(max * 0.85);
  let best = -1;
  const boundary = /[.!?](?=\s|$)|\n/g;
  let m: RegExpExecArray | null;
  while ((m = boundary.exec(slice)) !== null) {
    // Exclusive end: keep the sentence's punctuation, drop the newline.
    const end = m[0] === '\n' ? m.index : m.index + 1;
    if (end >= window) best = end;
  }
  if (best > 0) return slice.slice(0, best).trim();

  // NOTE: no exact-fit shortcut here, unlike `cutTitle`. A body that fits to
  // the character still ends better at the paragraph break above than on a
  // dangling first word of the next paragraph — and it has 1,000 characters to
  // spend, where a 40-character Mercari title does not.
  const cut = Math.max(slice.lastIndexOf(' '), slice.lastIndexOf('\n'));
  return (cut > 0 ? slice.slice(0, cut) : slice).replace(SEPARATOR_TAIL, '').trim();
}

// ── HTML ↔ plain ────────────────────────────────────────────────────────────

/**
 * The generated description is stored plain but round-trips through Shopify's
 * Body (HTML) column, so what comes back carries `<br>` and `<p>` — the shape
 * `htmlDescToPlain` in App.tsx handles. This is that conversion for the seven
 * marketplaces whose description field is plain text.
 *
 * `&amp;` is decoded LAST on purpose: decoding it first turns `&amp;lt;` into
 * `<` instead of the literal `&lt;` the seller typed.
 */
export function toPlainText(html: string | undefined | null): string {
  return normalizeNewlines(html)
    .replace(/<br\s*\/?>\s*<br\s*\/?>/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&amp;/gi, '&')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Plain text → the HTML the HTML marketplaces render. Escapes first, so a
 *  garment described as "100% cotton <a steal>" cannot inject markup. */
export function toHtml(plain: string | undefined | null): string {
  return normalizeNewlines(plain)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n\n/g, '<br><br>')
    .replace(/\n/g, '<br>');
}

/** Lines that are nothing but hashtags — dropped before an adapter appends its
 *  own block, so a description that already ends in tags is not doubled. */
export function stripHashtagLines(text: string): string {
  return text
    .split('\n')
    .filter(line => !/^\s*(?:#[\p{L}\p{N}_]+[\s,]*)+$/u.test(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ── tags ────────────────────────────────────────────────────────────────────

/**
 * A tag list: de-duplicated case-insensitively, `#` stripped, each cut to the
 * marketplace's per-tag limit (Etsy's 20 characters) and the whole list to its
 * count limit (Etsy's 13).
 */
export function buildTags(
  tags: readonly string[] | undefined,
  max: number,
  maxLength?: number,
): string[] {
  if (!Number.isFinite(max) || max <= 0) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of tags ?? []) {
    let t = collapseWs(String(raw ?? '')).replace(/^#+/, '').trim();
    if (!t) continue;
    if (maxLength && t.length > maxLength) t = cutTitle(t, maxLength);
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * A hashtag list — "single stitch" becomes "#singlestitch", because a hashtag
 * with a space in it is two hashtags, and the second is usually nonsense.
 * `maxLength` counts the word, not the `#`.
 */
export function buildHashtags(
  tags: readonly string[] | undefined,
  max: number,
  maxLength?: number,
): string[] {
  if (!Number.isFinite(max) || max <= 0) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of tags ?? []) {
    let word = String(raw ?? '')
      .replace(/^#+/, '')
      .normalize('NFKD')
      .replace(/[^\p{L}\p{N}]+/gu, '');
    if (maxLength && word.length > maxLength) word = word.slice(0, maxLength);
    if (!word) continue;
    const key = word.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(`#${word}`);
    if (out.length >= max) break;
  }
  return out;
}

/** The exporter's tag source rule: hashtags already written into the generated
 *  description win, otherwise the structured `tags` array. */
export function tagSource(item: ClothingItem): string[] {
  const fromDescription = (item.generatedDescription || '').match(/#(\w+)/g)?.map(t => t.slice(1)) ?? [];
  return fromDescription.length > 0 ? fromDescription : (item.tags ?? []);
}

// ── photos ──────────────────────────────────────────────────────────────────

/** Trimmed, blank-free, de-duplicated, order preserved. */
export function cleanPhotos(urls: readonly string[] | undefined): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of urls ?? []) {
    const url = String(raw ?? '').trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return out;
}

/** Leader first, cut to the marketplace's photo limit. */
export function limitPhotos(urls: readonly string[] | undefined, spec: MarketplaceSpec): string[] {
  return cleanPhotos(urls).slice(0, Math.max(0, spec.photos.max));
}

/** Too few photos blocks the listing; too many only costs the extras, so it
 *  warns — and says how many will be dropped, because the seller chose them. */
export function photoIssues(urls: readonly string[] | undefined, spec: MarketplaceSpec): ReadinessIssue[] {
  const n = cleanPhotos(urls).length;
  if (n < spec.photos.min) {
    return [issue(spec, 'error', 'photos', n === 0
      ? `No photos — ${spec.name} needs at least ${plural(spec.photos.min, 'photo')}.`
      : `Only ${plural(n, 'photo')} — ${spec.name} needs at least ${spec.photos.min}.`)];
  }
  if (n > spec.photos.max) {
    return [issue(spec, 'warning', 'photos',
      `${plural(n - spec.photos.max, 'photo')} will be dropped — ${spec.name} accepts ${spec.photos.max}.`)];
  }
  return [];
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

// ── issues ──────────────────────────────────────────────────────────────────

/** Builds a ReadinessIssue, omitting `value`/`fixKind` when absent so two
 *  issues that mean the same thing serialise the same way. */
export function issue(
  spec: MarketplaceSpec,
  level: IssueLevel,
  field: string,
  message: string,
  extra?: { value?: string; fixKind?: VocabKind },
): ReadinessIssue {
  return {
    marketplace: spec.key,
    level,
    field,
    message,
    ...(extra?.value !== undefined ? { value: extra.value } : {}),
    ...(extra?.fixKind ? { fixKind: extra.fixKind } : {}),
  };
}

// ── controlled vocabulary ───────────────────────────────────────────────────

/** The shape of `spec.brand` / `spec.color` — and of the synthetic fields used
 *  for size and category, which `MarketplaceSpec` does not model directly. */
export interface ControlledField {
  controlled: boolean;
  values?: readonly string[];
  fallback: string | null;
}

export interface ControlledResult {
  value: string | null;
  issue?: ReadinessIssue;
}

const FIELD_LABEL: Readonly<Record<VocabKind, string>> = {
  brand: 'brand', color: 'color', condition: 'condition', size: 'size', category: 'category',
};

/**
 * Case-, space- and punctuation-insensitive key: "Forest Green" ≡ "forestgreen".
 *
 * ONE spelling is folded on top of that — `grey` → `gray` — and the line where
 * it stops is deliberate: those are two spellings of one word, so treating them
 * as different is a bug, and grey is the single most common colour in a rack of
 * vintage sweatshirts. Everything beyond orthography ("navy" → "Blue", "forest
 * green" → "Green") is a JUDGEMENT about what the marketplace means by its own
 * list, and judgements live in the workspace's vocabulary where a human made
 * them — not in a fold that silently reclassifies a colour.
 */
const vocabKey = (s: string): string =>
  s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '').replace(/grey/g, 'gray');

/**
 * Resolve a free-text value against a marketplace's own list.
 *
 * This is the whole answer to "things default to some prebuilt brand or colour"
 * (plan §2c): send "Forest green" to a marketplace whose picker only knows
 * "Green" and it silently defaults — so we resolve, and when we cannot, we say
 * so instead of letting the marketplace choose.
 *
 *   1. the spec's own list, matched loosely on case/spacing/punctuation
 *   2. the workspace's vocabulary (`marketplace_vocab`, incl. its fuzzy brand
 *      matching — the resolver decides how hard it tries)
 *   3. give up: the marketplace's documented fallback + a warning that carries
 *      the unresolved value and its `fixKind`, so "remember this mapping" has
 *      everything it needs.
 *
 * BRAND NEVER FALLS BACK. A brand is the single field a buyer searches by; a
 * listing that says "Other" when the garment says Carhartt is invisible, and
 * one that says the wrong brand is a takedown. So an unresolved brand goes out
 * EXACTLY as the seller typed it, with a warning attached — the marketplace can
 * reject it, which is recoverable, where a wrong brand is not.
 */
export function resolveControlled(
  kind: VocabKind,
  field: ControlledField,
  canonical: string | undefined | null,
  vocab: VocabResolver,
  spec: MarketplaceSpec,
): ControlledResult {
  const raw = collapseWs(canonical);
  const label = FIELD_LABEL[kind];

  if (!raw) {
    const value = field.fallback ?? null;
    if (!field.controlled && value === null) return { value: null };
    return {
      value,
      issue: issue(spec, 'warning', kind, value
        ? `No ${label} set — ${spec.name} will list it as "${value}".`
        : `No ${label} set — ${spec.name} needs one.`),
    };
  }

  if (field.values && field.values.length > 0) {
    const key = vocabKey(raw);
    const hit = field.values.find(v => vocabKey(v) === key);
    if (hit) return { value: hit };
  }

  const mapped = vocab.resolve(kind, spec.key, raw);
  if (mapped && mapped.trim()) return { value: mapped.trim() };

  if (!field.controlled) return { value: raw };

  if (kind === 'brand') {
    return {
      value: raw,
      issue: issue(spec, 'warning', 'brand',
        `Brand "${raw}" is not confirmed for ${spec.name} — map it once so every listing matches their picker.`,
        { value: raw, fixKind: 'brand' }),
    };
  }

  const value = field.fallback ?? raw;
  return {
    value,
    issue: issue(spec, 'warning', kind,
      `${capitalize(label)} "${raw}" is not on ${spec.name}'s list — it will go out as "${value}".`,
      { value: raw, fixKind: kind }),
  };
}

const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

// ── price ───────────────────────────────────────────────────────────────────

export interface ResolvedPrice {
  price: number | null;
  compareAtPrice: number | null;
}

/**
 * The listing's price under this marketplace's rule.
 *
 * Both invariants of `platformPricing` (AGENTS.md §18 #42) are preserved and
 * one is strengthened: a price that is not a positive finite number comes back
 * as `null` — "this listing has no price" — and is NEVER handed to the rule, so
 * no rounding mode can turn it into a sellable number behind the readiness
 * check's back. Compare-at follows `csvExport`: adjusted only when the rule
 * opts in, and emitted only when it is genuinely above the price charged.
 */
export function applyPrice(
  item: Pick<ClothingItem, 'price' | 'compareAtPrice'>,
  rule?: PlatformPricingRule | null,
): ResolvedPrice {
  const raw = toPriceNumber(item.price);
  if (!Number.isFinite(raw) || raw <= 0) return { price: null, compareAtPrice: null };

  const price = round2(applyPlatformPrice(raw, rule ?? null));

  const rawCompare = toPriceNumber(item.compareAtPrice);
  if (!Number.isFinite(rawCompare) || rawCompare <= 0) return { price, compareAtPrice: null };
  const compare = round2(rule?.applyToCompareAt ? applyPlatformPrice(rawCompare, rule) : rawCompare);
  return { price, compareAtPrice: compare > price ? compare : null };
}

// ── title ───────────────────────────────────────────────────────────────────

/** The exporter's fallback title, for a listing whose seoTitle was never
 *  generated: brand · model · colour · category · (size), then the filename. */
export function buildAutoTitle(item: ClothingItem): string {
  const parts = [item.brand, item.modelName, item.color, item.category].filter(Boolean) as string[];
  if (item.size) parts.push(`(${baseSize(item.size)})`);
  const built = collapseWs(parts.join(' '));
  if (built) return built;
  return collapseWs((item.originalName || '').replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' '));
}

/**
 * "90s" / "1990s" / "y2k" / "vintage 70s" → "1990s" / "2000s" / "1970s".
 *
 * eBay's Decade item specific and Etsy's `when_made` both want a decade and
 * neither takes prose, while the app stores `era` as whatever was dictated.
 * Two-digit decades are read the way a reseller means them: 20-90 is the
 * twentieth century, 00-10 the twenty-first — nobody selling vintage clothing
 * writes "20s" meaning 2020.
 */
export function decadeFromEra(era: string | undefined | null): string {
  const t = String(era ?? '').toLowerCase();
  if (!t) return '';
  const full = t.match(/\b(19|20)(\d)0s?\b/);
  if (full) return `${full[1]}${full[2]}0s`;
  const short = t.match(/\b(\d)0s\b/);
  if (short) {
    const n = Number(short[1]) * 10;
    return n >= 20 ? `19${short[1]}0s` : `20${short[1]}0s`;
  }
  if (/\by2k\b/.test(t)) return '2000s';
  return '';
}

// ── the common format pass ──────────────────────────────────────────────────

/**
 * Everything every marketplace needs, in one deterministic pass. Each adapter
 * calls this and then adds only what is its own: item specifics, feed columns,
 * a taxonomy path.
 *
 * Issues are appended in a FIXED order — title, description, price, photos,
 * brand, color, size, condition, category — so a golden snapshot means
 * something. Nothing in here can throw on a sparse item: every field is
 * optional, and a missing one becomes an issue.
 */
export function baseFormat(spec: MarketplaceSpec, input: ListingInput): FormattedListing {
  const { item, vocab } = input;
  const issues: ReadinessIssue[] = [];

  // Title
  const title = cutTitle(stripUnresolvedTokens(item.seoTitle) || buildAutoTitle(item), spec.title.max);
  if (!title) issues.push(issue(spec, 'error', 'title', `No title — ${spec.name} needs one.`));

  // Tags, then the description they may have to fit inside.
  const source = tagSource(item);
  const tags = spec.tags.style === 'hashtags'
    ? buildHashtags(source, spec.tags.max, spec.tags.maxLength)
    : spec.tags.style === 'tags'
      ? buildTags(source, spec.tags.max, spec.tags.maxLength)
      : [];

  const plain = toPlainText(item.generatedDescription || item.seoDescription || item.customDescription || '');
  const usesHashtagBlock = spec.tags.style === 'hashtags' && tags.length > 0;
  const body = usesHashtagBlock ? stripHashtagLines(plain) : plain;
  const block = usesHashtagBlock ? tags.join(' ') : '';
  // The block is reserved out of the budget FIRST, so the hashtags can never be
  // the part that gets cut off — they are the discovery surface on Depop and
  // Mercari, and a half-written one reads as a typo.
  const budget = block ? Math.max(0, spec.description.max - block.length - 2) : spec.description.max;
  const cutBody = cutText(body, budget);
  const plainDescription = block ? (cutBody ? `${cutBody}\n\n${block}` : block) : cutBody;
  const description = spec.description.format === 'html' ? toHtml(plainDescription) : plainDescription;
  if (!plainDescription) {
    issues.push(issue(spec, 'warning', 'description', `No description — ${spec.name} listings without one rarely sell.`));
  }

  // Price
  const { price, compareAtPrice } = applyPrice(item, input.pricingRule ?? null);
  if (price === null) issues.push(issue(spec, 'error', 'price', `No price set — ${spec.name} needs one.`));

  // Photos
  const photos = limitPhotos(input.imageUrls, spec);
  issues.push(...photoIssues(input.imageUrls, spec));

  // Brand
  const brand = resolveControlled('brand', spec.brand, item.brand, vocab, spec);
  if (brand.issue) issues.push(brand.issue);

  // Color
  const color = resolveControlled('color', spec.color, item.color, vocab, spec);
  if (color.issue) issues.push(color.issue);

  // Size — no marketplace's size list is modelled in the spec (they are huge and
  // per-category), so the workspace's vocabulary is the only mapping, and a
  // missing size is called out because it is what shoppers filter by.
  const sizeRaw = item.size ? baseSize(item.size) : '';
  const size = resolveControlled('size', { controlled: false, fallback: null }, sizeRaw, vocab, spec);
  if (!size.value) {
    issues.push(issue(spec, 'warning', 'size', `No size set — ${spec.name} shoppers filter by size.`));
  }

  // Condition — the canonical grade first, the workspace's own wording second.
  const rawCondition = collapseWs(item.condition);
  const grade = normalizeCondition(rawCondition);
  let condition: string | null = grade ? spec.condition.map[grade] ?? null : null;
  if (!condition && rawCondition) {
    const mapped = vocab.resolve('condition', spec.key, rawCondition);
    if (mapped && mapped.trim()) condition = mapped.trim();
  }
  if (!rawCondition) {
    issues.push(issue(spec, 'warning', 'condition',
      `No condition set — ${spec.name} asks for one (${spec.condition.values.join(' / ')}).`));
  } else if (!condition) {
    issues.push(issue(spec, 'warning', 'condition',
      `Condition "${rawCondition}" is not one of ${spec.name}'s grades (${spec.condition.values.join(' / ')}) — map it once.`,
      { value: rawCondition, fixKind: 'condition' }));
  }

  // Category — a coded taxonomy is controlled (only the marketplace's own ids
  // are valid); a path or free text passes through for the adapter to refine.
  const category = resolveControlled(
    'category',
    { controlled: spec.category.kind === 'taxonomy', fallback: spec.category.fallback ?? null },
    item.category,
    vocab,
    spec,
  );
  if (category.issue) issues.push(category.issue);

  return {
    marketplace: spec.key,
    productGroupId: item.productGroup || item.id || '',
    sku: collapseWs(item.sku) || null,
    title,
    description,
    tags,
    category: category.value,
    brand: brand.value,
    color: color.value,
    condition,
    size: size.value,
    price,
    compareAtPrice,
    photos,
    attributes: {},
    issues,
  };
}

/** `attributes` with every blank dropped — an empty item specific is a column
 *  the marketplace rejects, not a column it ignores. */
export function compactAttributes(attrs: Record<string, string | undefined | null>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(attrs)) {
    const value = collapseWs(v);
    if (value) out[k] = value;
  }
  return out;
}

/** `2026-09-15` — the date part of a feed filename. Injected by the caller in
 *  tests; the default is the only impure line in this folder and it is here,
 *  not scattered through ten adapters. */
export const feedDate = (date?: string): string =>
  (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) ? date : new Date().toISOString().slice(0, 10);

/**
 * Header line + rows, every cell through `escapeCsvValue` — csvExport's own
 * escaper, IMPORTED and not reimplemented, because it carries the CSV formula
 * injection guard (a cell starting `=`/`+`/`@`/`-` is prefixed with an
 * apostrophe so a spreadsheet cannot execute a product title).
 */
export function toCsv(headers: readonly string[], rows: readonly (readonly unknown[])[]): string {
  return [
    headers.map(escapeCsvValue).join(','),
    ...rows.map(row => row.map(escapeCsvValue).join(',')),
  ].join('\n');
}
