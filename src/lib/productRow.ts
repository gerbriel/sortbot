import type { ClothingItem } from '../App';
import { publicImageUrl, thumbnailImageUrl } from './storageUrls';

/**
 * productRow — the ONE mapping between a `products` row (with its joined
 * `product_images`) and a `ClothingItem`.
 *
 * It replaces four copies that lived in App.tsx (architecture review findings
 * #10 and #11):
 *   • build items when `workflow_state` is empty (handleOpenBatch)  ─┐ byte-identical
 *   • build items during gap-fill (handleOpenBatch)                 ─┘ (verified by diff)
 *   • merge a DB row into a restored item — STARTUP restore          ─┐ same 45 fields,
 *   • merge a DB row into a restored item — handleOpenBatch          ─┘ SEVEN divergences
 *
 * ── THE TWO RESTORE PATHS DISAGREE. THAT IS PRESERVED, NOT FIXED. ──
 *
 * `mergeProductRowIntoItem` is byte-identical to whichever copy it replaces,
 * selected by `MergeProductRowOptions`. The divergences, all real and all
 * load-bearing until someone decides which is right:
 *
 *  1. `coerceEmptyStrings` — startup appended `|| ''` to ~30 string fields;
 *     open-batch left them `undefined`. So the two paths disagree about
 *     empty-vs-undefined for most of the item.
 *  2. `imageStrategy` — startup let the DB row's `product_images` list WIN over
 *     the item's own images; open-batch makes the item's OWN image win and uses
 *     the DB list only as a fallback. The open-batch rule is the one commit
 *     3a70b52 introduced deliberately: the row is matched at the GROUP level, so
 *     its `product_images` is the whole group's photo list, and preferring it
 *     made every member of a group show the same photo.
 *  3. `descriptionStrategy` — startup: `plain(row) || item || ''` (falls back to
 *     the item when the row's HTML renders empty). open-batch:
 *     `plain(row ?? item ?? '')` (an empty row description wins).
 *  4. `defaultStatus` — startup defaulted to `'Active'`; open-batch had no
 *     default at all.
 *  5. `measurements` — startup defaulted to `{}`; open-batch left it undefined.
 *  6. `setProductGroup` — only open-batch re-derived `productGroup` from the row.
 *  7. `setOriginalName` / `setAppliedPresetId` — open-batch set `originalName`
 *     and not `appliedPresetId`; startup did the exact opposite.
 *
 * Unifying them is a behaviour change and needs its own decision + test; the
 * options make the disagreement visible and reversible instead of being two
 * 90-line blocks nobody diffs.
 *
 * `htmlToPlain` is INJECTED rather than imported so this module stays free of
 * App.tsx (which imports it — that would be a cycle).
 */

/**
 * A `products` row read by column name. The table has ~60 columns and this module
 * exists precisely to map all of them, so the index signature is the point rather
 * than a shortcut — naming 60 column types here would duplicate the Database type
 * in `lib/supabase.ts` and drift from it.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- see above
type DynamicRow = Record<string, any>;

/** Shape of the joined `product_images` rows both restore queries select. */
export interface ProductImageRowLite {
  image_url?: string | null;
  storage_path?: string | null;
  position?: number | null;
  original_name?: string | null;
}

/** Shape of a `products` row. Columns beyond the two we name are read dynamically. */
export interface ProductRowLite {
  id: string;
  product_group?: string | null;
  product_images?: ProductImageRowLite[] | null;
  [column: string]: unknown;
}

/**
 * Images for a row, ordered by `position`, plus the first storage path and
 * original filename found in that order.
 *
 * NOTE the sort is `(a.position ?? 0) - (b.position ?? 0)`, matching the four
 * original copies' `a.position - b.position` for real rows while not producing
 * `NaN` when the column is null (post-migration rows always have it).
 */
export function imagesFromRow(row: ProductRowLite) {
  const sorted = [...(row.product_images ?? [])].sort(
    (a, b) => (a.position ?? 0) - (b.position ?? 0),
  );
  const urls = sorted.map(i => i.image_url).filter((u): u is string => !!u);
  const storagePath = sorted.find(i => i.storage_path)?.storage_path ?? undefined;
  const originalName = sorted.find(i => i.original_name)?.original_name ?? undefined;
  return { urls, storagePath, originalName };
}

/**
 * Strip the garbled "sz" title artifact so the title regenerates cleanly.
 * Present in all four original copies.
 */
export function cleanSzTitle(title: string): string {
  return /\bsz\b/i.test(title) ? '' : title;
}

/**
 * Build a FRESH ClothingItem from a DB row — used when `workflow_state` is empty
 * and during gap-fill. Both original copies were byte-identical.
 *
 * `capturedAt` is deliberately absent: no `products` column holds it, so
 * DB-built items have no date until the EXIF rescan runs (CLAUDE.md §14 #17).
 */
export function productRowToClothingItem(
  row: ProductRowLite,
  htmlToPlain: (html: string) => string,
): ClothingItem {
  const r = row as DynamicRow;
  const { urls, storagePath, originalName } = imagesFromRow(row);
  const reconstructed = publicImageUrl(storagePath);
  const resolvedPreview = urls[0] || reconstructed;

  return {
    id: row.id,
    preview: resolvedPreview,
    imageUrls: urls.length ? urls : (reconstructed ? [reconstructed] : []),
    thumbnailUrl: thumbnailImageUrl(storagePath) || resolvedPreview,
    // DB-built items have no File object. Pre-existing hole in the type, not new here.
    file: null as unknown as File,
    storagePath,
    originalName,
    productGroup: r.product_group || row.id,
    voiceDescription:          r.voice_description   || '',
    generatedDescription:      htmlToPlain(r.description || ''),
    seoTitle:                  cleanSzTitle(r.seo_title || ''),
    seoDescription:            r.seo_description     || '',
    tags:                      r.tags                || [],
    brand:                     r.vendor              || '',
    category:                  r.product_category    || '',
    productType:               r.product_type        || '',
    published:                 r.published           ?? true,
    status:                    r.status              || 'active',
    size:                      r.size                || '',
    color:                     r.color               || '',
    secondaryColor:            r.secondary_color     || '',
    price:                     r.price               ?? undefined,
    compareAtPrice:            r.compare_at_price    ?? undefined,
    costPerItem:               r.cost_per_item       ?? undefined,
    sku:                       r.sku                 || '',
    barcode:                   r.barcode             || '',
    inventoryQuantity:         r.inventory_quantity  ?? undefined,
    weightValue:               r.weight_value        || '',
    requiresShipping:          r.requires_shipping   ?? true,
    continueSellingOutOfStock: r.continue_selling_out_of_stock ?? false,
    packageDimensions:         r.package_dimensions  || '',
    parcelSize:                r.parcel_size         || '',
    shipsFrom:                 r.ships_from          || '',
    condition:                 r.condition           || '',
    flaws:                     r.flaws               || '',
    material:                  r.material            || '',
    era:                       r.era                 || '',
    care:                      r.care_instructions   || '',
    measurements:              r.measurements        || {},
    modelName:                 r.model_name          || '',
    modelNumber:               r.model_number        || '',
    sizeType:                  r.size_type           || '',
    style:                     r.style               || '',
    gender:                    r.gender              || '',
    ageGroup:                  r.age_group           || '',
    policies:                  r.policies            || '',
    renewalOptions:            r.renewal_options     || '',
    whoMadeIt:                 r.who_made_it         || '',
    whatIsIt:                  r.what_is_it          || '',
    listingType:               r.listing_type        || '',
    discountedShipping:        r.discounted_shipping || '',
    mpn:                       r.mpn                 || '',
    customLabel0:              r.custom_label_0      || '',
  } as ClothingItem;
}

export interface MergeProductRowOptions {
  /** true reproduces the STARTUP copy's `|| ''` tail on ~30 string fields. */
  coerceEmptyStrings?: boolean;
  /**
   * 'db-group-wins' = STARTUP: the row's product_images list wins over the item's
   * own images. 'own-image-wins' = handleOpenBatch: the item's own image wins and
   * the row's group list is only a fallback (commit 3a70b52 — see the module doc).
   */
  imageStrategy?: 'db-group-wins' | 'own-image-wins';
  /**
   * 'row-or-item' = STARTUP: `plain(row) || item || ''`.
   * 'row-else-item-then-plain' = handleOpenBatch: `plain(row ?? item ?? '')`.
   */
  descriptionStrategy?: 'row-or-item' | 'row-else-item-then-plain';
  /** STARTUP passed 'Active'; handleOpenBatch passed nothing. */
  defaultStatus?: string;
  /** STARTUP defaulted measurements to `{}`; handleOpenBatch left it undefined. */
  defaultEmptyMeasurements?: boolean;
  /** Only handleOpenBatch re-derived `productGroup` from the row. */
  setProductGroup?: boolean;
  /** Only handleOpenBatch set `originalName` (item wins, row is the fallback). */
  setOriginalName?: boolean;
  /** Only STARTUP set `appliedPresetId`. */
  setAppliedPresetId?: boolean;
}

/**
 * Merge a DB row onto a restored (slim-hydrated) item. The DB row wins for
 * fields it has; the item is the fallback. See the module doc for the seven
 * documented differences between the two restore paths.
 */
export function mergeProductRowIntoItem(
  item: ClothingItem,
  row: ProductRowLite,
  htmlToPlain: (html: string) => string,
  opts: MergeProductRowOptions = {},
): ClothingItem {
  const {
    coerceEmptyStrings = false,
    imageStrategy = 'own-image-wins',
    descriptionStrategy = 'row-else-item-then-plain',
    defaultStatus,
    defaultEmptyMeasurements = false,
    setProductGroup = true,
    setOriginalName = true,
    setAppliedPresetId = false,
  } = opts;

  const r = row as DynamicRow;
  const { urls: groupUrls, originalName: rowOriginalName } = imagesFromRow(row);

  /**
   * The `|| ''` tail, applied only when the caller asked for it.
   *
   * NOTE the two branches are written out rather than `(a || b || e)` with
   * `e = undefined`: when BOTH sides are `''` (which happens constantly, because
   * the startup path coerces every string field to `''`), `a || b` yields `''`
   * while `a || b || undefined` yields `undefined`. The open-batch copy produced
   * the former, so this must too.
   */
  const s = coerceEmptyStrings
    ? (a: unknown, b: unknown) => (a || b || '') as string | undefined
    : (a: unknown, b: unknown) => (a || b) as string | undefined;

  let imageUrls: string[];
  let preview: string;
  if (imageStrategy === 'db-group-wins') {
    imageUrls = groupUrls.length ? groupUrls : (item.imageUrls ?? []);
    preview = imageUrls[0] || item.preview || '';
  } else {
    const ownPathUrl = publicImageUrl(item.storagePath);
    const ownUrls = item.imageUrls?.length ? item.imageUrls : (ownPathUrl ? [ownPathUrl] : []);
    imageUrls = ownUrls.length ? ownUrls : groupUrls;
    preview = item.preview || imageUrls[0] || ownPathUrl;
  }

  const generatedDescription = descriptionStrategy === 'row-or-item'
    ? (htmlToPlain(r.description ?? '') || item.generatedDescription || '')
    : htmlToPlain(r.description ?? item.generatedDescription ?? '');

  const merged: Record<string, unknown> = {
    ...item,
    imageUrls,
    preview,
    generatedDescription,
    voiceDescription:          r.voice_description ?? item.voiceDescription ?? '',
    seoTitle:                  cleanSzTitle(r.seo_title || item.seoTitle || ''),
    seoDescription:            s(r.seo_description, item.seoDescription),
    tags:                      r.tags?.length ? r.tags : (item.tags || []),
    brand:                     s(r.vendor, item.brand),
    category:                  s(r.product_category, item.category),
    productType:               s(r.product_type, item.productType),
    published:                 r.published ?? item.published,
    // Same falsy-exactness care as `s()`: no `|| undefined` tail when there is no default.
    status:                    defaultStatus === undefined
                                 ? (r.status || item.status)
                                 : (r.status || item.status || defaultStatus),
    size:                      s(r.size, item.size),
    color:                     s(r.color, item.color),
    secondaryColor:            s(r.secondary_color, item.secondaryColor),
    price:                     r.price            ?? item.price,
    compareAtPrice:            r.compare_at_price ?? item.compareAtPrice,
    costPerItem:               r.cost_per_item    ?? item.costPerItem,
    sku:                       s(r.sku, item.sku),
    barcode:                   s(r.barcode, item.barcode),
    inventoryQuantity:         r.inventory_quantity ?? item.inventoryQuantity,
    weightValue:               s(r.weight_value, item.weightValue),
    requiresShipping:          r.requires_shipping ?? item.requiresShipping,
    continueSellingOutOfStock: r.continue_selling_out_of_stock ?? item.continueSellingOutOfStock,
    packageDimensions:         s(r.package_dimensions, item.packageDimensions),
    parcelSize:                s(r.parcel_size, item.parcelSize),
    shipsFrom:                 s(r.ships_from, item.shipsFrom),
    condition:                 s(r.condition, item.condition),
    flaws:                     s(r.flaws, item.flaws),
    material:                  s(r.material, item.material),
    era:                       s(r.era, item.era),
    care:                      s(r.care_instructions, item.care),
    measurements:              defaultEmptyMeasurements
                                 ? (r.measurements || item.measurements || {})
                                 : (r.measurements || item.measurements),
    modelName:                 s(r.model_name, item.modelName),
    modelNumber:               s(r.model_number, item.modelNumber),
    sizeType:                  s(r.size_type, item.sizeType),
    style:                     s(r.style, item.style),
    // gender took NO `|| ''` tail in either copy — both were `row || item`.
    gender:                    r.gender || item.gender,
    ageGroup:                  s(r.age_group, item.ageGroup),
    policies:                  s(r.policies, item.policies),
    renewalOptions:            s(r.renewal_options, item.renewalOptions),
    whoMadeIt:                 s(r.who_made_it, item.whoMadeIt),
    whatIsIt:                  s(r.what_is_it, item.whatIsIt),
    listingType:               s(r.listing_type, item.listingType),
    discountedShipping:        s(r.discounted_shipping, item.discountedShipping),
    mpn:                       s(r.mpn, item.mpn),
    customLabel0:              s(r.custom_label_0, item.customLabel0),
  };

  if (setProductGroup) merged.productGroup = r.product_group || item.productGroup || item.id;
  if (setOriginalName) merged.originalName = item.originalName || rowOriginalName;
  if (setAppliedPresetId) merged.appliedPresetId = r.applied_preset_id || item.appliedPresetId || '';

  return merged as unknown as ClothingItem;
}

/** The exact option set the STARTUP restore path used before the extraction. */
export const STARTUP_MERGE_OPTIONS: MergeProductRowOptions = {
  coerceEmptyStrings: true,
  imageStrategy: 'db-group-wins',
  descriptionStrategy: 'row-or-item',
  defaultStatus: 'Active',
  defaultEmptyMeasurements: true,
  setProductGroup: false,
  setOriginalName: false,
  setAppliedPresetId: true,
};

/** The exact option set `handleOpenBatch` used before the extraction. */
export const OPEN_BATCH_MERGE_OPTIONS: MergeProductRowOptions = {
  coerceEmptyStrings: false,
  imageStrategy: 'own-image-wins',
  descriptionStrategy: 'row-else-item-then-plain',
  defaultStatus: undefined,
  defaultEmptyMeasurements: false,
  setProductGroup: true,
  setOriginalName: true,
  setAppliedPresetId: false,
};
