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
 * ── THE TWO RESTORE PATHS DISAGREED. TWO OF THE SEVEN ARE NOW CLOSED. ──
 *
 * `mergeProductRowIntoItem` was byte-identical to whichever copy it replaced,
 * selected by `MergeProductRowOptions`. Five divergences are still preserved
 * as-found; the two that were actively destroying user data were closed in the
 * grouping/persistence pass (docs/reviews/12-grouping-persistence.md):
 *
 *  1. `coerceEmptyStrings` — startup appended `|| ''` to ~30 string fields;
 *     open-batch left them `undefined`. So the two paths disagree about
 *     empty-vs-undefined for most of the item.
 *  2. `imageStrategy` — **CLOSED: both paths are now 'own-image-wins'.** Startup
 *     used to let the DB row's `product_images` list WIN over the item's own
 *     image, which is the rule commit 3a70b52 had already removed from the
 *     open-batch path for a reason: `saveBatchToDatabase` writes a GROUP's photos
 *     as N rows against the LEADER product, so a leader's row carries the whole
 *     group's list and preferring it showed another member's photo.
 *     It broke a second way too (founder report 16, "random images upside down
 *     at the dictation step"): `saveProductToDatabase` BAKES `imageRotation` into
 *     a fresh JPEG, uploads it and adds a row for it, but never clears
 *     `imageRotation` on the item. 'db-group-wins' could hand the item that
 *     already-rotated file while the merge left `imageRotation` at 90 — and the
 *     Step-2 card / Step-3 preview then CSS-rotate it a second time. 90 + 90 =
 *     180, i.e. exactly "upside down". Which of the two rows sorted first was a
 *     `position` tie, i.e. arbitrary DB row order — hence "randomly".
 *     `storagePath` is the authoritative image reference (CLAUDE.md §11); the
 *     DB list stays the fallback for items that have none.
 *  3. `descriptionStrategy` — startup: `plain(row) || item || ''` (falls back to
 *     the item when the row's HTML renders empty). open-batch:
 *     `plain(row ?? item ?? '')` (an empty row description wins).
 *  4. `defaultStatus` — startup defaulted to `'Active'`; open-batch had no
 *     default at all.
 *  5. `measurements` — startup defaulted to `{}`; open-batch left it undefined.
 *  6. `setProductGroup` — **CHANGED: open-batch is now 'item-wins'.** It used to
 *     re-derive `productGroup` from the matched row, i.e. `products.product_group`
 *     overwrote the grouping restored from `workflow_state` (founder report 29,
 *     "grouped photos don't stay grouped after a refresh"). Those two are written
 *     by SEPARATE 2 s debounces and the products one is the unreliable of the
 *     pair, so the row's value is routinely older; worse, the row is matched by
 *     group → image-url → TITLE, and the last two can match a different product
 *     entirely. Group membership now comes from the item, which is either the
 *     `workflow_state` value or — for DB-built and gap-filled items —
 *     `productRowToClothingItem`'s own `product_group || row.id`, so nothing is
 *     lost by not consulting the row twice.
 *  7. `setOriginalName` / `setAppliedPresetId` — open-batch set `originalName`
 *     and not `appliedPresetId`; startup did the exact opposite.
 *
 * Unifying the remaining five is a behaviour change and needs its own decision +
 * test; the options keep the disagreement visible and reversible instead of two
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
  /**
   * Whether (and how) to write `productGroup`.
   *
   *   false / undefined-off  — leave the item's value untouched (STARTUP).
   *   'row-wins' (or `true`) — `row.product_group || item.productGroup || item.id`.
   *                            The historical open-batch behaviour; kept as the
   *                            default so any other caller is unchanged.
   *   'item-wins'            — `item.productGroup || item.id`; the row is never
   *                            consulted. Used by handleOpenBatch: `workflow_state`
   *                            (and, for DB-built items, the value
   *                            `productRowToClothingItem` already derived) is the
   *                            authoritative grouping, and `products.product_group`
   *                            is a lagging mirror written by a different debounce.
   */
  setProductGroup?: boolean | 'row-wins' | 'item-wins';
  /** Only handleOpenBatch set `originalName` (item wins, row is the fallback). */
  setOriginalName?: boolean;
  /** Only STARTUP set `appliedPresetId`. */
  setAppliedPresetId?: boolean;
}

/**
 * Merge a DB row onto a restored (slim-hydrated) item. The DB row wins for
 * fields it has; the item is the fallback. See the module doc for the seven
 * documented differences between the two restore paths.
 *
 * ONE EXCEPTION: `brand`. The item wins there, because this merge runs on a
 * background hydration that would otherwise overwrite a brand the user is
 * typing right now. See the comment on the field.
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
    /**
     * THE ONE FIELD WHERE THE ITEM WINS (founder report 23).
     *
     * `products.vendor` is the storage column for `item.brand`, and this merge
     * runs on App's BACKGROUND hydration — after the UI is already interactive.
     * With the row first, a brand typed in the first second after load was
     * silently replaced by whatever the database happened to hold, which is how
     * a stale value (a 34-minute-lived build once wrote the SHOP name here)
     * kept coming back no matter how many times it was retyped.
     *
     * Flipping it is behaviour-neutral on a real restore: `brand` is not in the
     * slimForWorkflowState whitelist, so a freshly hydrated item has no brand
     * and the row is still what lands. It differs only when the item genuinely
     * holds a live value — which is exactly the case that must not be clobbered.
     */
    // `?? undefined` keeps the BOTH-EMPTY result identical to the old operand
    // order: `s` is `(a, b) => a || b`, which returns the SECOND operand when
    // both are falsy, so a null vendor would have started surfacing as `null`
    // where it used to be `undefined` (locked by the coerceEmptyStrings tests).
    brand:                     s(item.brand, r.vendor ?? undefined),
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

  if (setProductGroup) {
    merged.productGroup = setProductGroup === 'item-wins'
      ? (item.productGroup || item.id)
      : (r.product_group || item.productGroup || item.id);
  }
  if (setOriginalName) merged.originalName = item.originalName || rowOriginalName;
  if (setAppliedPresetId) merged.appliedPresetId = r.applied_preset_id || item.appliedPresetId || '';

  return merged as unknown as ClothingItem;
}

/** The exact option set the STARTUP restore path used before the extraction. */
export const STARTUP_MERGE_OPTIONS: MergeProductRowOptions = {
  coerceEmptyStrings: true,
  // Was 'db-group-wins'. See divergence 2 in the module doc: it served an item
  // the baked/rotated file (or another group member's photo) while leaving
  // imageRotation set, which the UI then applied a second time.
  imageStrategy: 'own-image-wins',
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
  // Was `true` ('row-wins'). See divergence 6: a stale/mismatched
  // products.product_group was silently un-grouping restored batches.
  setProductGroup: 'item-wins',
  setOriginalName: true,
  setAppliedPresetId: false,
};
