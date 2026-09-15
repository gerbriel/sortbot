/**
 * marketplaces/fixtures — TEST-ONLY. Imported by no app code.
 *
 * Ten adapters snapshot the SAME two listings, which is the only way the
 * goldens are comparable: when Mercari's title is shorter than eBay's it is
 * because Mercari's limit is 40, not because the fixtures differed. Same
 * reason `src/lib/testing/supabaseMock.ts` exists — the shared stand-in is
 * what makes the assertions mean something.
 *
 * TWO FIXTURES, on purpose:
 *   FULL   — three photos, every field populated, values deliberately spread
 *            across the group's members so `coalesceGroup` is exercised on
 *            every adapter rather than in one unit test.
 *   SPARSE — one photo, no price, no brand, a colour no picker lists, and a
 *            condition a human understands and a lexicon cannot ("kinda beat
 *            up"). This is the listing that proves `format()` produces issues
 *            instead of exceptions.
 */

import type { ClothingItem } from '../../App';
import { coalesceGroup } from './shared';
import { NO_VOCAB, type FormattedListing, type ListingInput, type MarketplaceKey, type VocabKind, type VocabResolver } from './types';

/**
 * `file` and `preview` are required on ClothingItem and meaningless here, and
 * `condition` is typed as a union while the dictation grammar writes free text
 * into it at runtime — so the fixture builder casts once, in one place, rather
 * than every call site lying about a different field.
 */
type ItemSeed = Omit<Partial<ClothingItem>, 'condition'> & { id: string; condition?: string };

const item = (o: ItemSeed): ClothingItem =>
  ({ file: null, preview: '', ...o } as unknown as ClothingItem);

const FULL_DESCRIPTION = [
  'Vintage 90s Nike grey crewneck sweatshirt. Heavyweight brushed fleece with an embroidered swoosh on the chest and a boxy, cropped fit that sits right on the waist.',
  '✠ CHEST- 22 in',
  '✠ LENGTH- 27 in',
  '✠ SLEEVE- 24 in',
  'Every Garment goes through a thorough washing process before being photographed.',
  'Condition: excellent, with a small mark on the left cuff.',
  'BUNDLE AND SAVE!!!!!!',
].join('\n\n');

/**
 * A complete listing. Note where the values sit: the title, category and
 * condition are on the leader, the PRICE is only on the second photo and the
 * MATERIAL and FLAWS only on the third. That is exactly how a real group looks
 * after Step 3 — fields are written per-item by several paths — and it is why
 * the export coalesces instead of reading `group[0]`.
 */
export const FULL_GROUP: readonly ClothingItem[] = [
  item({
    id: 'grp-1',
    productGroup: 'grp-1',
    originalName: 'DSC02175.jpg',
    capturedAt: 1_700_000_000_000,
    storagePath: 'user/grp-1/a.jpg',
    seoTitle: 'Vintage 90s Nike Grey Embroidered Swoosh Crewneck Sweatshirt',
    generatedDescription: FULL_DESCRIPTION,
    seoDescription: 'Vintage 90s Nike grey crewneck sweatshirt, size L.',
    category: 'sweatshirts',
    productType: 'Sweatshirt',
    brand: 'Nike',
    color: 'Grey',
    size: 'L',
    condition: 'Excellent',
    era: '90s',
    style: 'Vintage',
    gender: 'Men',
    sizeType: 'Regular',
    ageGroup: 'Adult (13+ years old)',
    whoMadeIt: 'Another Company Or Person',
    whatIsIt: 'A Finished Product',
    sku: 'ACD-7K2M9Q',
    barcode: '',
    weightValue: '600',
    parcelSize: 'Medium',
    packageDimensions: '12 in - 10 in - 3 in',
    inventoryQuantity: 1,
    costPerItem: 12,
    compareAtPrice: 60,
    status: 'Active',
    requiresShipping: true,
    tags: [
      'vintage', 'nike', 'crewneck', '90s streetwear', 'single stitch',
      'oversized fit', 'grey sweatshirt', 'made in usa', 'y2k', 'skater',
      'surf', 'embroidered swoosh', 'gift for him',
      // 14 tags, and this one is 34 characters — Etsy caps the list at 13 and
      // each tag at 20, so both limits bite in the golden.
      'vintage nike crewneck sweatshirt',
    ],
  }),
  item({
    id: 'grp-2',
    productGroup: 'grp-1',
    originalName: 'DSC02176.jpg',
    capturedAt: 1_700_000_001_000,
    storagePath: 'user/grp-1/b.jpg',
    price: 45,
  }),
  item({
    id: 'grp-3',
    productGroup: 'grp-1',
    originalName: 'DSC02177.jpg',
    capturedAt: 1_700_000_002_000,
    storagePath: 'user/grp-1/c.jpg',
    material: '80% cotton, 20% polyester',
    flaws: 'small mark on the left cuff',
  }),
];

export const FULL_PHOTOS: readonly string[] = [
  'https://cdn.example.com/storage/v1/object/public/product-images/user/grp-1/a.jpg',
  'https://cdn.example.com/storage/v1/object/public/product-images/user/grp-1/b.jpg',
  'https://cdn.example.com/storage/v1/object/public/product-images/user/grp-1/c.jpg',
];

/** One photo, no price, no brand, a colour no picker lists, and a condition
 *  only a human can read. */
export const SPARSE_GROUP: readonly ClothingItem[] = [
  item({
    id: 'sparse-1',
    originalName: 'IMG_0042.jpg',
    storagePath: 'user/sparse-1/a.jpg',
    seoTitle: 'Faded Single Stitch Tee',
    generatedDescription: 'Soft faded single stitch tee.',
    category: 'tees',
    color: 'Forest Green',
    size: 'M',
    condition: 'kinda beat up',
  }),
];

export const SPARSE_PHOTOS: readonly string[] = [
  'https://cdn.example.com/storage/v1/object/public/product-images/user/sparse-1/a.jpg',
];

/** A resolver backed by a plain map, for the vocabulary paths. Keys are
 *  `kind:marketplace:canonical`, lowercased. */
export function stubVocab(entries: Record<string, string>): VocabResolver {
  return {
    resolve(kind: VocabKind, marketplace: MarketplaceKey, canonical: string) {
      return entries[`${kind}:${marketplace}:${canonical}`.toLowerCase()] ?? null;
    },
  };
}

export function fullInput(overrides: Partial<ListingInput> = {}): ListingInput {
  return {
    group: FULL_GROUP,
    item: coalesceGroup(FULL_GROUP),
    imageUrls: FULL_PHOTOS,
    vendorName: 'C&D Vintage',
    vocab: NO_VOCAB,
    ...overrides,
  };
}

export function sparseInput(overrides: Partial<ListingInput> = {}): ListingInput {
  return {
    group: SPARSE_GROUP,
    item: coalesceGroup(SPARSE_GROUP),
    imageUrls: SPARSE_PHOTOS,
    vendorName: 'C&D Vintage',
    vocab: NO_VOCAB,
    ...overrides,
  };
}

/**
 * What a golden snapshot covers: everything except `source`, which is the whole
 * ~60-field ClothingItem the Shopify adapter needs at serialize time. Snapshot
 * it and every Shopify golden becomes an unreadable dump of the fixture, and
 * any unrelated field added to ClothingItem breaks it.
 */
export function snapshotOf(l: FormattedListing) {
  return {
    marketplace: l.marketplace,
    productGroupId: l.productGroupId,
    sku: l.sku,
    title: l.title,
    description: l.description,
    tags: l.tags,
    category: l.category,
    brand: l.brand,
    color: l.color,
    condition: l.condition,
    size: l.size,
    price: l.price,
    compareAtPrice: l.compareAtPrice,
    photos: l.photos,
    attributes: l.attributes,
    issues: l.issues,
  };
}

/**
 * A minimal RFC 4180 reader, for the feed tests.
 *
 * It exists because a description legitimately contains newlines, so a quoted
 * cell spans several physical lines and `body.split('\n')` does NOT give one
 * row per listing — a test that assumes it does passes for the wrong reason
 * and would miss a real column drift.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else quoted = false;
      } else cell += c;
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === ',') { row.push(cell); cell = ''; continue; }
    if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; continue; }
    if (c === '\r') continue;
    cell += c;
  }
  row.push(cell);
  rows.push(row);
  return rows;
}
