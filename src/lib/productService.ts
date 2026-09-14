import { supabase } from './supabase';
import type { ClothingItem } from '../App';
import { createTransformedFile } from './imageTransforms';
import { buildTransforms, stage4ColumnsAvailable, stage4ColumnsKnownAvailable } from './imageRowSync';
import { log } from './debugLogger';
import { publicImageUrl } from './storageUrls';
import { chunked } from './chunk';

/**
 * Return the public CDN URL for a storage path.
 *
 * Re-exported from `lib/storageUrls` — the ONE seam between a storage path and a
 * loadable URL (architecture review finding #12). Kept under this name because
 * App.tsx already imports it from here; new code should import
 * `thumbnailImageUrl` / `publicImageUrl` from `lib/storageUrls` directly.
 */
export { thumbnailImageUrl as getThumbnailUrl } from './storageUrls';

/**
 * Upload image to Supabase Storage and return public URL
 */
export const uploadImageToStorage = async (
  file: File,
  userId: string,
  productId: string,
  position: number
): Promise<{ url: string; path: string } | null> => {
  try {
    // Create unique filename: userId/productId/position_timestamp.ext
    const fileExt = file.name.split('.').pop();
    const fileName = `${position}_${Date.now()}.${fileExt}`;
    const filePath = `${userId}/${productId}/${fileName}`;

    // Upload to Supabase Storage
    const { data, error } = await supabase.storage
      .from('product-images')
      .upload(filePath, file, {
        cacheControl: '3600',
        upsert: false,
      });

    if (error) {
      return null;
    }

    return {
      url: publicImageUrl(data.path),
      path: data.path,
    };
  } catch (error) {
    return null;
  }
};

/**
 * Upload a File to an explicit storage path. If upsert=true, overwrite existing file.
 */
export const uploadFileToPath = async (
  file: File,
  path: string,
  upsert = false
): Promise<{ url: string; path: string } | null> => {
  try {
    const { data, error } = await supabase.storage
      .from('product-images')
      .upload(path, file, { cacheControl: '3600', upsert });

    if (error) {
      console.error('uploadFileToPath error', error.message);
      return null;
    }

    return { url: publicImageUrl(data.path), path: data.path };
  } catch (err) {
    console.error('uploadFileToPath exception', err);
    return null;
  }
};

/**
 * Upload a transformed image to a generated path under the user's folder.
 */
export const uploadTransformedImage = async (
  file: File,
  userId?: string,
  itemId?: string
): Promise<{ url: string; path: string } | null> => {
  try {
    let resolvedUserId = userId;
    if (!resolvedUserId) {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      resolvedUserId = user.id;
    }

    const fileExt = file.name.split('.').pop();
    const fileName = `${itemId || 'transformed'}-${Date.now()}.${fileExt}`;
    const filePath = `${resolvedUserId}/${itemId || 'unassigned'}/${fileName}`;

    return await uploadFileToPath(file, filePath, false);
  } catch (err) {
    return null;
  }
};

/**
 * Save product and its images to database
 */
export const saveProductToDatabase = async (
  product: ClothingItem,
  userId: string,
  groupImages: ClothingItem[],
  batchId?: string
): Promise<string | null> => {
  // Stage 4 dual-write: are the new columns available yet? (cached probe)
  const stage4 = await stage4ColumnsAvailable();
  // Guard: if userId is missing, fetch from auth session
  let resolvedUserId = userId;
  if (!resolvedUserId) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      console.error('saveProductToDatabase: no authenticated user');
      return null;
    }
    resolvedUserId = user.id;
  }

  try {
    // 1. Upsert product on id so calling "Save Batch" more than once
    // updates the existing row instead of creating a duplicate.
    const { data: productData, error: productError } = await supabase
      .from('products')
      .upsert({
        id: product.id,
        user_id: resolvedUserId,
        batch_id: batchId || null,
        
        // Core product info
        title: product.seoTitle || 'Untitled Product',
        url_handle: (product.seoTitle || 'product')
          .toLowerCase()
          .replace(/\s+/g, '-')
          .replace(/[^a-z0-9-]/g, ''),
        description: product.generatedDescription || '',
        
        // Shopify fields
        vendor: product.brand || '',
        product_category: product.category || '',
        product_type: product.productType || 'Clothing',
        tags: product.tags || [],
        published: product.published || false,
        status: product.status || 'Active',
        
        // Variants/Options
        size: product.size || '',
        color: product.color || '',
        secondary_color: product.secondaryColor || '',
        
        // Pricing
        // NULL, not 0 — writing 0 for "not priced yet" is indistinguishable from a
        // real free item, and the CSV exporter's price gate then hard-blocks the
        // export forever (the restore merge reads the 0 straight back). (finding 20)
        price: typeof product.price === 'number' ? product.price : null,
        compare_at_price: product.compareAtPrice || null,
        cost_per_item: product.costPerItem || null,
        
        // Inventory
        sku: product.sku || '',
        barcode: product.barcode || '',
        inventory_quantity: product.inventoryQuantity || 0,
        
        // Shipping
        weight_value: product.weightValue || '150',
        weight_unit: 'g',
        requires_shipping: product.requiresShipping ?? true,
        
        // Product details
        condition: product.condition || 'Good',
        flaws: product.flaws || '',
        material: product.material || '',
        era: product.era || '',
        care_instructions: product.care || '',
        measurements: product.measurements || {},
        
        // Product Details (Extended)
        model_name: product.modelName || '',
        model_number: product.modelNumber || '',
        subculture: product.subculture || [],
        
        // Shipping & Packaging
        package_dimensions: product.packageDimensions || '',
        parcel_size: product.parcelSize || null,
        ships_from: product.shipsFrom || '',
        continue_selling_out_of_stock: product.continueSellingOutOfStock ?? false,
        
        // Product Classification
        size_type: product.sizeType || '',
        style: product.style || '',
        gender: product.gender || '',
        age_group: product.ageGroup || '',
        
        // Policies & Marketplace
        policies: product.policies || '',
        renewal_options: product.renewalOptions || '',
        who_made_it: product.whoMadeIt || '',
        what_is_it: product.whatIsIt || '',
        listing_type: product.listingType || '',
        discounted_shipping: product.discountedShipping || '',
        
        // Marketing
        mpn: product.mpn || '',
        custom_label_0: product.customLabel0 || '',
        
        // Advanced fields
        tax_code: product.taxCode || '',
        unit_price_total_measure: product.unitPriceTotalMeasure || '',
        unit_price_total_measure_unit: product.unitPriceTotalMeasureUnit || '',
        unit_price_base_measure: product.unitPriceBaseMeasure || '',
        unit_price_base_measure_unit: product.unitPriceBaseMeasureUnit || '',
        
        // Brand Category
        brand_category: product.brandCategory || '',

        // Stage 4 dual-write — only once the stage4_slim_fields migration ran
        ...(stage4 ? { description_edited: !!product.descriptionEdited } : {}),
        
        // SEO
        seo_title: product.seoTitle || '',
        seo_description: product.seoDescription || '',
        
        // Original voice description
        voice_description: product.voiceDescription || '',
        
        // Product group (Step 2 grouping)
        product_group: product.productGroup || product.id || '',
      }, { onConflict: 'id' })
      .select()
      .single();

    if (productError) {
      return null;
    }

    // 2. Move images from temp folder and save URLs.
    //
    // The DB write is BATCHED (finding F4): this loop used to await one
    // product_images upsert PER IMAGE inside a per-group loop that is itself
    // serial — ~1,875 serial round trips (≈150 s) for a 1,500-image Save Batch.
    // The loop now only PREPARES rows; one chunked upsert runs after it. The
    // per-item awaits below (canvas re-encode + Storage PUT) are inherently
    // per-item and are unchanged, as is the row content itself.
    const imageRows: Record<string, unknown>[] = [];

    for (let i = 0; i < groupImages.length; i++) {
      const item = groupImages[i];
      
      let imageUrl = '';
      let storagePath = '';
      
      // If the item has transforms (rotation/crop), create transformed file client-side and upload that.
      if ((item.imageRotation || item.crop) && item.preview) {
        // Create transformed file from the preview
        const transformedFile = await createTransformedFile(item);
        if (transformedFile) {
          const uploadResult = await uploadImageToStorage(
            transformedFile as unknown as File,
            resolvedUserId,
            productData.id,
            i
          );
          if (uploadResult) {
            imageUrl = uploadResult.url;
            storagePath = uploadResult.path;
          }
        }
      }

      // If no transformed upload happened, fall back to existing storagePath or upload original file
      if (!imageUrl) {
        // Check if image was already uploaded
        if (item.storagePath && item.preview) {
          imageUrl = item.preview;
          storagePath = item.storagePath;
        } else {
          const uploadResult = await uploadImageToStorage(item.file, resolvedUserId, productData.id, i);
          if (uploadResult) {
            imageUrl = uploadResult.url;
            storagePath = uploadResult.path;
          }
        }
      }

      // Collect the image row — written after the loop, in one request per 100.
      // NOTE: deliberately NOT buildProductImageRow() from imageRowSync: that
      // builder keys the row on `item.id` and `item.storagePath` with a different
      // alt_text, whereas this path must write the group LEADER (productData.id)
      // and the path it just uploaded to. Using it here would change what lands
      // in the DB, which this fix must not do.
      if (imageUrl && storagePath) {
        imageRows.push({
          product_id: productData.id,
          user_id: resolvedUserId,
          image_url: imageUrl,
          storage_path: storagePath,
          position: i,
          alt_text: `${product.seoTitle || 'Product'} - Image ${i + 1}`,
          transforms: buildTransforms(item),
          // Stage 4 dual-write — gated until the migration has been run
          ...(stage4 ? {
            captured_at: item.capturedAt ?? null,
            original_storage_path: item.originalStoragePath ?? null,
          } : {}),
        });
      }
    }

    // One upsert per ≤100 rows instead of one per image. Same conflict target and
    // same ignore semantics as before, and an error still throws — the enclosing
    // catch turns that into `null`, which saveBatchToDatabase counts as `failed`.
    // Chunked because an upsert body of 1,500 rows is a request no other write path
    // in this app sends (every neighbouring bulk write is capped at 100).
    const UPSERT_CHUNK = 100;
    for (let i = 0; i < imageRows.length; i += UPSERT_CHUNK) {
      const { error: imageError } = await supabase
        .from('product_images')
        .upsert(
          imageRows.slice(i, i + UPSERT_CHUNK),
          { onConflict: 'product_id,image_url', ignoreDuplicates: false }
        );

      if (imageError) {
        throw imageError;
      }
    }

    return productData.id;
  } catch (error) {
    return null;
  }
};

/**
 * Save batch of products (entire session)
 */
export const saveBatchToDatabase = async (
  items: ClothingItem[],
  userId: string,
  workflowBatchId?: string | null
): Promise<{ success: number; failed: number }> => {
  let success = 0;
  let failed = 0;

  // Use the workflow batch ID if provided, otherwise generate a new one
  const batchId = workflowBatchId || crypto.randomUUID();

  // Group items by productGroup
  const productGroups = items.reduce((groups, item) => {
    const groupId = item.productGroup || item.id;
    if (!groups[groupId]) {
      groups[groupId] = [];
    }
    groups[groupId].push(item);
    return groups;
  }, {} as Record<string, ClothingItem[]>);

  // Save each product group with the same batch_id
  for (const [groupId, groupItems] of Object.entries(productGroups)) {
    // Write to the LEADER row (id === product_group) — the one handleOpenBatch
    // reads back for the group. Keying on groupItems[0] instead let the group's
    // fields land on a row the restore path never looks at. (finding 2)
    const productData = groupItems.find(i => i.id === groupId) ?? groupItems[0];
    
    const productId = await saveProductToDatabase(
      productData,
      userId,
      groupItems,
      batchId
    );

    if (productId) {
      success++;
    } else {
      failed++;
    }
  }

  return { success, failed };
};

/**
 * Fetch all products from database (collaborative - all users see all products)
 *
 * PAGINATED (F13): PostgREST caps a response at 1,000 rows, so this silently
 * returned the 1,000 newest products of a larger workspace. Same idiom as
 * libraryService.fetchSavedImages, including the partial-result-on-error return.
 */
export const fetchUserProducts = async () => {
  const PAGE = 1000;
  const MAX_PAGES = 50;   // 50,000 products — never spin forever on full pages
  const all: unknown[] = [];
  try {
    for (let page = 0; page < MAX_PAGES; page++) {
      const from = page * PAGE;
      const { data, error } = await supabase
        .from('products')
        .select(`
          id,
          title,
          description,
          vendor,
          size,
          price,
          status,
          condition,
          color,
          created_at,
          updated_at,
          batch_id,
          product_images (
            id,
            image_url,
            storage_path,
            position,
            alt_text
          )
        `)
        .order('created_at', { ascending: false })
        .range(from, from + PAGE - 1);

      if (error) {
        console.error('Error fetching products:', error);
        break;
      }
      if (!data || data.length === 0) break;
      all.push(...data);
      if (data.length < PAGE) break;   // short page — that was the last one
    }
    return all;
  } catch {
    return all;   // whatever was read before the failure
  }
};

/**
 * Delete product and its images
 */
export const deleteProduct = async (productId: string): Promise<boolean> => {
  const PAGE = 1000;      // PostgREST row cap (F13)
  const MAX_PAGES = 50;
  try {
    // 1. Get all image paths for this product. Paginated: a leader row can hold
    // one row per photo in its group, so this is not provably under 1,000.
    const paths: string[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const from = page * PAGE;
      const { data: images, error } = await supabase
        .from('product_images')
        .select('storage_path')
        .eq('product_id', productId)
        .range(from, from + PAGE - 1);
      if (error || !images || images.length === 0) break;
      paths.push(...images.map((img: { storage_path: string }) => img.storage_path).filter(Boolean));
      if (images.length < PAGE) break;
    }

    // 2. Delete images from storage, chunked
    for (const pathChunk of chunked(paths)) {
      const { error: storageError } = await supabase.storage
        .from('product-images')
        .remove(pathChunk);

      if (storageError) {
        // Failed to delete from storage
      }
    }

    // 3. Delete product (CASCADE will delete image records)
    const { error: deleteError } = await supabase
      .from('products')
      .delete()
      .eq('id', productId);

    if (deleteError) {
      return false;
    }

    return true;
  } catch (error) {
    return false;
  }
};

/**
 * Map a ClothingItem patch onto products-table column names.
 *
 * Pure and exported so three callers share one mapping: updateProduct (the
 * normal path), the Step-3 keepalive unload flush (which cannot await a
 * supabase-js round trip), and the unit tests.
 *
 * `stage4` gates the columns added by supabase/migrations/stage4_slim_fields.sql —
 * writing an unknown column fails the WHOLE request with PGRST204.
 */
export const buildProductPatch = (
  updates: Partial<ClothingItem>,
  stage4: boolean,
): Record<string, unknown> => {
  // Build url_handle if seoTitle changed
  const urlHandle = updates.seoTitle
    ? updates.seoTitle.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
    : undefined;

  const patch: Record<string, unknown> = {};

  // Core
  if (updates.seoTitle !== undefined)              patch.title               = updates.seoTitle;
  if (urlHandle !== undefined)                     patch.url_handle          = urlHandle;
  if (updates.generatedDescription !== undefined)  patch.description         = updates.generatedDescription;
  if (updates.brand !== undefined)                 patch.vendor              = updates.brand;
  if (updates.category !== undefined)              patch.product_category    = updates.category;
  if (updates.productType !== undefined)           patch.product_type        = updates.productType;
  if (updates.tags !== undefined)                  patch.tags                = updates.tags;
  if (updates.published !== undefined)             patch.published           = updates.published;
  if (updates.status !== undefined)                patch.status              = updates.status;

  // Variants
  if (updates.size !== undefined)                  patch.size                = updates.size;
  if (updates.color !== undefined)                 patch.color               = updates.color;
  if (updates.secondaryColor !== undefined)        patch.secondary_color     = updates.secondaryColor;

  // Pricing
  if (updates.price !== undefined)                 patch.price               = updates.price;
  if (updates.compareAtPrice !== undefined)        patch.compare_at_price    = updates.compareAtPrice;
  if (updates.costPerItem !== undefined)           patch.cost_per_item       = updates.costPerItem;

  // Inventory
  if (updates.sku !== undefined)                   patch.sku                 = updates.sku;
  if (updates.barcode !== undefined)               patch.barcode             = updates.barcode;
  if (updates.inventoryQuantity !== undefined)     patch.inventory_quantity  = updates.inventoryQuantity;

  // Shipping
  if (updates.weightValue !== undefined)           patch.weight_value        = updates.weightValue;
  if (updates.requiresShipping !== undefined)      patch.requires_shipping   = updates.requiresShipping;
  if (updates.continueSellingOutOfStock !== undefined) patch.continue_selling_out_of_stock = updates.continueSellingOutOfStock;
  if (updates.packageDimensions !== undefined)     patch.package_dimensions  = updates.packageDimensions;
  if (updates.parcelSize !== undefined)            patch.parcel_size         = updates.parcelSize;
  if (updates.shipsFrom !== undefined)             patch.ships_from          = updates.shipsFrom;

  // Product details
  if (updates.condition !== undefined)             patch.condition           = updates.condition;
  if (updates.flaws !== undefined)                 patch.flaws               = updates.flaws;
  if (updates.material !== undefined)              patch.material            = updates.material;
  if (updates.era !== undefined)                   patch.era                 = updates.era;
  if (updates.care !== undefined)                  patch.care_instructions   = updates.care;
  if (updates.measurements !== undefined)          patch.measurements        = updates.measurements;
  if (updates.modelName !== undefined)             patch.model_name          = updates.modelName;
  if (updates.modelNumber !== undefined)           patch.model_number        = updates.modelNumber;
  if (updates.subculture !== undefined)            patch.subculture          = updates.subculture;

  // Classification
  if (updates.sizeType !== undefined)              patch.size_type           = updates.sizeType;
  if (updates.style !== undefined)                 patch.style               = updates.style;
  if (updates.gender !== undefined)                patch.gender              = updates.gender;
  if (updates.ageGroup !== undefined)              patch.age_group           = updates.ageGroup;

  // Policies & marketplace
  if (updates.policies !== undefined)              patch.policies            = updates.policies;
  if (updates.renewalOptions !== undefined)        patch.renewal_options     = updates.renewalOptions;
  if (updates.whoMadeIt !== undefined)             patch.who_made_it         = updates.whoMadeIt;
  if (updates.whatIsIt !== undefined)              patch.what_is_it          = updates.whatIsIt;
  if (updates.listingType !== undefined)           patch.listing_type        = updates.listingType;
  if (updates.discountedShipping !== undefined)    patch.discounted_shipping = updates.discountedShipping;

  // Marketing / SEO
  if (updates.mpn !== undefined)                   patch.mpn                 = updates.mpn;
  if (updates.customLabel0 !== undefined)          patch.custom_label_0      = updates.customLabel0;
  if (updates.seoTitle !== undefined)              patch.seo_title           = updates.seoTitle;
  if (updates.seoDescription !== undefined)        patch.seo_description     = updates.seoDescription;
  if (updates.voiceDescription !== undefined)      patch.voice_description   = updates.voiceDescription;

  // Advanced
  if (updates.taxCode !== undefined)               patch.tax_code            = updates.taxCode;
  if (updates.unitPriceTotalMeasure !== undefined) patch.unit_price_total_measure = updates.unitPriceTotalMeasure;
  if (updates.unitPriceTotalMeasureUnit !== undefined) patch.unit_price_total_measure_unit = updates.unitPriceTotalMeasureUnit;
  if (updates.unitPriceBaseMeasure !== undefined)  patch.unit_price_base_measure = updates.unitPriceBaseMeasure;
  if (updates.unitPriceBaseMeasureUnit !== undefined) patch.unit_price_base_measure_unit = updates.unitPriceBaseMeasureUnit;
  if (updates.brandCategory !== undefined)         patch.brand_category      = updates.brandCategory;
  // Stage 4 dual-write — gated until the migration has been run
  if (stage4 && updates.descriptionEdited !== undefined) patch.description_edited = updates.descriptionEdited;
  // Only write applied_preset_id when we have a real UUID — never overwrite with '' which would clear the DB value
  if (updates.appliedPresetId)                     patch.applied_preset_id   = updates.appliedPresetId;

  return patch;
};

/**
 * Update product data — syncs all ClothingItem fields back to the products table.
 * Called whenever fields change (preset apply, voice extract, manual edit).
 *
 * IMPORTANT (July 2026 fix): a PostgREST `UPDATE ... WHERE id = $1` that matches
 * NOTHING is not an error, so this used to report success when the products row
 * did not exist (a failed per-chunk upload upsert) or when RLS blocked the write.
 * The edit was then lost forever, because workflow_state is slim and carries no
 * description/title/price. `.select('id')` proves a row was actually touched; on
 * 0 rows we create the row instead (upsert on `id`, which is the item id and can
 * never collide across batches — and deliberately carries NO batch_id, per
 * CLAUDE.md §18 #3).
 */
export const updateProduct = async (
  productId: string,
  updates: Partial<ClothingItem>,
  userId?: string,
): Promise<boolean> => {
  try {
    // Stage 4 dual-write: are the new columns available yet? (cached probe)
    const stage4 = await stage4ColumnsAvailable();
    const patch = buildProductPatch(updates, stage4);

    if (Object.keys(patch).length === 0) {
      log.db(`updateProduct: empty patch, nothing to write for id ${productId}`);
      return true;
    }

    const { data, error } = await supabase
      .from('products')
      .update(patch)
      .eq('id', productId)
      .select('id');

    if (error) {
      console.error('[SAVE] updateProduct error:', error);
      return false;
    }
    if (data && data.length > 0) return true;

    // 0 rows affected: the row is missing, or RLS blocked the UPDATE. Either way
    // the caller's data is NOT saved — never report success (that is what made
    // Step-3 edits vanish silently).
    if (!userId) {
      console.error('[SAVE] updateProduct: UPDATE affected 0 rows and no userId to insert with — id:', productId);
      return false;
    }
    const { data: inserted, error: upErr } = await supabase
      .from('products')
      .upsert({ id: productId, user_id: userId, ...patch }, { onConflict: 'id' })
      .select('id');
    if (upErr || !inserted || inserted.length === 0) {
      console.error('[SAVE] updateProduct: row missing and recovery upsert failed for', productId, upErr);
      return false;
    }
    log.db(`updateProduct: row was missing — created products row for ${productId}`);
    return true;
  } catch (error) {
    console.error('[SAVE] updateProduct exception:', error);
    return false;
  }
};

/**
 * Sync all preset/voice/manual field changes for a group of items back to the
 * products table.
 *
 * WRITE KEY MUST MATCH READ KEY (July 2026 fix). handleOpenBatch reads ONE row
 * per product_group — the leader row (`id === product_group`). This used to write
 * `groupItems[0]`, i.e. whichever member happens to come first in processedItems
 * order, which diverges from the leader as soon as the user sorts in Step 2,
 * re-forms a group, or items are gap-filled and appended. When they diverged the
 * row holding the user's work was never read back and the listing returned blank.
 *
 * So: write the leader first (checked), then mirror the same fields onto the
 * other members in ONE extra request per 100 members, so no ordering anywhere can
 * lose the edit (chunked at 100 like every other bulk write — F14).
 */
export const syncGroupFieldsToDatabase = async (
  groupItems: ClothingItem[],
  _batchId: string | null,   // kept for API compatibility; not used in lookup
  userId?: string,
): Promise<boolean> => {
  if (!groupItems.length) return false;

  const groupId = groupItems[0].productGroup || groupItems[0].id;
  // The leader is the row handleOpenBatch reads. Fall back to the first member
  // for legacy groups that never had a leader (fresh-UUID productGroup era).
  const leader = groupItems.find(i => i.id === groupId) ?? groupItems[0];
  if (!leader.id) return false;

  log.db(`syncGroupFieldsToDatabase | group=${groupId} leader=${leader.id} members=${groupItems.length}`);

  try {
    const ok = await updateProduct(leader.id, leader, userId);

    // Mirror onto the remaining members so a later leader change (regroup) still
    // finds the data. One request per 100 members — not one per member. (The
    // chunking is F14: a select-all-then-group makes `others` as long as the batch,
    // and ~1,500 UUIDs in one .in() is a ~55 KB URL, i.e. an HTTP 414.)
    const others = groupItems.filter(i => i.id && i.id !== leader.id).map(i => i.id);
    if (others.length > 0) {
      const stage4 = await stage4ColumnsAvailable();
      const patch = buildProductPatch(leader, stage4);
      if (Object.keys(patch).length > 0) {
        for (const idChunk of chunked(others)) {
          const { error } = await supabase.from('products').update(patch).in('id', idChunk);
          if (error) console.warn('[SAVE] syncGroupFieldsToDatabase | mirror update failed:', error.message);
        }
      }
    }
    if (!ok) console.warn('[SAVE] syncGroupFieldsToDatabase | leader write did NOT persist:', leader.id);
    return ok;
  } catch (e) {
    console.error('[SAVE] syncGroupFieldsToDatabase THREW:', e);
    return false;
  }
};

/**
 * Write one product patch in a way that SURVIVES page teardown (finding 9).
 *
 * The Step-3 unload flush used to call syncGroupFieldsToDatabase, i.e. supabase-js,
 * i.e. a plain `fetch` — which the browser cancels the moment the document is
 * discarded (and `pagehide`/bfcache never gives it a chance at all), despite the
 * code comment claiming a sendBeacon-style approach. Every edit made inside the
 * debounce window was lost, with no slim-state fallback to recover it from.
 *
 * `keepalive` is the only option that works here: sendBeacon cannot send PATCH,
 * and PostgREST has no POST-shaped update. Synchronous and fire-and-forget by
 * design — there is no time to await anything during teardown, which is also why
 * the Stage 4 column probe is read from its cached, synchronous view.
 *
 * Returns whether a request was actually dispatched.
 */
export const flushProductPatchKeepalive = (
  productId: string,
  updates: Partial<ClothingItem>,
  accessToken: string | null | undefined,
): boolean => {
  if (!productId || !accessToken) return false;
  const baseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (!baseUrl || !anonKey) return false;
  const patch = buildProductPatch(updates, stage4ColumnsKnownAvailable());
  if (Object.keys(patch).length === 0) return false;
  try {
    void fetch(`${baseUrl}/rest/v1/products?id=eq.${encodeURIComponent(productId)}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        apikey: anonKey,
        Authorization: `Bearer ${accessToken}`,
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(patch),
      keepalive: true,
    }).catch(() => { /* teardown — nothing we can do or report */ });
    return true;
  } catch {
    return false;
  }
};
