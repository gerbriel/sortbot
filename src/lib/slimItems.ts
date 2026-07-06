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
}

export const slimForWorkflowState = (items: ClothingItem[]): SlimWorkflowItem[] =>
  items.map(item => ({
    id:                  item.id,
    storagePath:         item.storagePath,
    imageUrls:           item.imageUrls,
    thumbnailUrl:        item.thumbnailUrl,
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
  }));

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
