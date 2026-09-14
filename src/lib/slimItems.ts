import type { ClothingItem } from '../App';

/**
 * slimItems — the two "strip an item down for persistence" shapes, extracted
 * verbatim from App.tsx:autoSaveWorkflow (refactor Stage 3) so the
 * save→reload contract is unit-testable.
 *
 * INVARIANT (CLAUDE.md §11): anything NOT preserved here must be recoverable
 * from the products/product_images tables or reconstructible from storagePath.
 * Adding a field to ClothingItem that can't be recovered from the DB means
 * adding it here too — otherwise it silently vanishes on reload.
 */

/** What survives in workflow_state.processedItems (the Supabase JSONB blob).
 *  Only fields that CANNOT be recovered from the products/product_images DB
 *  tables. All text content (generatedDescription, voiceDescription, seoTitle,
 *  price, tags, …) lives in products and is merged back in handleOpenBatch /
 *  startup hydration. This keeps the blob ~10x smaller (2000 items:
 *  ~10 MB → ~800 KB). */
export interface SlimWorkflowItem {
  id: string;
  storagePath?: string;
  imageUrls?: string[];
  thumbnailUrl?: string;
  productGroup?: string;
  category?: string;
  capturedAt?: number;
  originalName?: string;
  imageRotation?: number;
  crop?: ClothingItem['crop'];
  originalStoragePath?: string;
  originalUrl?: string;
  brandCategory?: ClothingItem['brandCategory'];
  descriptionEdited?: boolean;
  customDescription?: string;
}

/**
 * What a restore path ACTUALLY finds in `workflow_state`.
 *
 * `slimForWorkflowState` has written `SlimWorkflowItem`s since Stage 3, but the
 * blob is years old: batches saved before the slimming still hold whole
 * `ClothingItem`s, and `duplicateBatch` copies whatever the source had. So the
 * honest type is "at least a SlimWorkflowItem, possibly any ClothingItem field
 * as well" — which is also what lets consumers read `preview` / `seoTitle` off a
 * persisted item without an `as ClothingItem` cast on every access.
 *
 * This replaced `SlimItem` in workflowBatchService.ts, which claimed the blob
 * held 5 fields while the writer had been persisting 15 (architecture review
 * finding #13).
 */
export type PersistedWorkflowItem = SlimWorkflowItem & Partial<ClothingItem>;

/**
 * Widen persisted items to `ClothingItem` for the restore paths.
 *
 * This IS a lie and it is deliberately in one place: a persisted item has no
 * `file` (File objects cannot be serialized, CLAUDE.md §18 #6) and, since the
 * slimming, no `preview` either — both are required on `ClothingItem`. Every
 * caller immediately rebuilds `preview`/`imageUrls`/`thumbnailUrl` from
 * `storagePath` (§11) and nothing reads `file` off a restored item, so the cast
 * is safe; it was previously spelled `as ClothingItem[]` at each call site with
 * a comment explaining the same thing.
 *
 * Runtime-identical to that cast: it does not add or normalise any field.
 */
export const asClothingItems = (
  items: readonly PersistedWorkflowItem[] | undefined,
): ClothingItem[] => (items ?? []) as unknown as ClothingItem[];

export const slimForWorkflowState = (items: ClothingItem[]): SlimWorkflowItem[] =>
  items.map(item => {
    // ── imageUrls / thumbnailUrl are DERIVED, so they are only persisted for items
    //    that have nothing to derive them FROM (perf finding F8).
    //
    // Both are `getPublicUrl(storagePath)` — `getThumbnailUrl` ignores its `_size`
    // argument and returns the same plain CDN URL (Storage transforms need a paid
    // plan), so with a storagePath present all three fields are the same string.
    // Together they measured **51 % of the 1 067 KB autosave payload** at 1 500
    // items, re-uploaded on every 2 s debounce fire, TOASTed and WAL-logged by
    // Postgres each time.
    //
    // Every restore path already rebuilds them from `storagePath` and DISCARDS
    // whatever was saved (verified before this change was made):
    //   - App.tsx startup restore — "If we have a storagePath, rebuild imageUrls
    //     entirely from it (ignore saved value)"; thumbnailUrl via getThumbnailUrl.
    //   - App.tsx handleOpenBatch — `item.imageUrls?.length ? … : [reconstructed]`,
    //     thumbnailUrl from storagePath.
    //   - App.tsx handleImagesGrouped — collapses imageUrls to `[canonicalUrl]` built
    //     from storagePath on every Step-2 action.
    //   - lib/libraryData.ts pass 1 (both the group and imageList builders) —
    //     `getPublicUrl(storagePath)` when preview/imageUrls are empty.
    // `ultraSlimForBackup` has never carried either field, which is the same bet.
    //
    // LEGACY ITEMS KEEP THEIRS. An item with no storagePath (uploaded before the
    // field was preserved) has no other image reference at all — dropping its
    // imageUrls would lose the picture permanently, which is exactly the case the
    // two-stage DB fallback in startup restore exists to repair.
    const derivable = !!item.storagePath;
    return {
      id:                  item.id,
      storagePath:         item.storagePath,
      imageUrls:           derivable ? undefined : item.imageUrls,
      thumbnailUrl:        derivable ? undefined : item.thumbnailUrl,
      productGroup:        item.productGroup,
      category:            item.category,
      capturedAt:          item.capturedAt,
      originalName:        item.originalName,
      imageRotation:       item.imageRotation,
      crop:                item.crop,
      originalStoragePath: item.originalStoragePath,
      originalUrl:         item.originalUrl,
      brandCategory:       item.brandCategory,
      descriptionEdited:   item.descriptionEdited,
      // Voice/chip-entered freeform note — no products column holds it, so the
      // workflow_state blob is its only home across reloads.
      customDescription:   item.customDescription,
    };
  });

/** What survives in the synchronous localStorage backup written on every
 *  auto-save call (no debounce) — only the 7 fields needed to detect and win
 *  a race against Supabase after a quick page refresh. Everything else is
 *  recovered from the DB merge in handleOpenBatch / startup hydration. */
export const ultraSlimForBackup = (item: ClothingItem) => ({
  id:                  item.id,
  storagePath:         item.storagePath,
  productGroup:        item.productGroup,
  category:            item.category,
  capturedAt:          item.capturedAt,
  imageRotation:       item.imageRotation,
  crop:                item.crop,
});
