import { supabase } from './supabase';
import type { ClothingItem } from '../App';

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

    // Get public URL
    const { data: { publicUrl } } = supabase.storage
      .from('product-images')
      .getPublicUrl(data.path);

    return {
      url: publicUrl,
      path: data.path,
    };
  } catch (error) {
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
  try {
    // 1. Insert product
    // Note: We don't check for existing products here because:
    // - Products may have duplicate titles/seo_titles (common with "Untitled Product")
    // - Each product is unique even if metadata is similar
    // - Image-level duplicate prevention handles the real duplicate issue
    const { data: productData, error: productError } = await supabase
      .from('products')
      .insert({
        user_id: userId,
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
        status: product.status || 'Draft',
        
        // Variants/Options
        size: product.size || '',
        color: product.color || '',
        secondary_color: product.secondaryColor || '',
        
        // Pricing
        price: product.price || 0,
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
        
        // SEO
        seo_title: product.seoTitle || '',
        seo_description: product.seoDescription || '',
        
        // Original voice description
        voice_description: product.voiceDescription || '',
      })
      .select()
      .single();

    if (productError) {
      return null;
    }

    // 2. Move images from temp folder and save URLs
    for (let i = 0; i < groupImages.length; i++) {
      const item = groupImages[i];
      
      let imageUrl = '';
      let storagePath = '';
      
      // Check if image was already uploaded
      if (item.storagePath && item.preview) {
        // Image already uploaded - reuse existing URL and path
        // No need to move/copy, just use what's already there
        imageUrl = item.preview;
        storagePath = item.storagePath;
      } else {
        // Image not uploaded yet - upload now
        const uploadResult = await uploadImageToStorage(
          item.file,
          userId,
          productData.id,
          i
        );
        
        if (uploadResult) {
          imageUrl = uploadResult.url;
          storagePath = uploadResult.path;
        }
      }

      // Save image record to database
      if (imageUrl && storagePath) {
        // Check if this image URL already exists for this product to prevent duplicates
        const { data: existing } = await supabase
          .from('product_images')
          .select('id')
          .eq('product_id', productData.id)
          .eq('image_url', imageUrl)
          .maybeSingle();
        
        // Only insert if it doesn't already exist
        if (!existing) {
          const { error: imageError } = await supabase
            .from('product_images')
            .insert({
              product_id: productData.id,
              user_id: userId,
              image_url: imageUrl,
              storage_path: storagePath,
              position: i,
              alt_text: `${product.seoTitle || 'Product'} - Image ${i + 1}`,
            });

          if (imageError) {
            throw imageError;
          }
        }
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
  for (const [, groupItems] of Object.entries(productGroups)) {
    const productData = groupItems[0]; // First item has all the product info
    
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
 */
export const fetchUserProducts = async () => {
  try {
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
      .order('created_at', { ascending: false });

    if (error) {
      return [];
    }

    return data || [];
  } catch (error) {
    return [];
  }
};

/**
 * Delete product and its images
 */
export const deleteProduct = async (productId: string): Promise<boolean> => {
  try {
    // 1. Get all image paths for this product
    const { data: images } = await supabase
      .from('product_images')
      .select('storage_path')
      .eq('product_id', productId);

    // 2. Delete images from storage
    if (images && images.length > 0) {
      const paths = images.map(img => img.storage_path);
      const { error: storageError } = await supabase.storage
        .from('product-images')
        .remove(paths);

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
 * Update product data
 */
export const updateProduct = async (
  productId: string,
  updates: Partial<ClothingItem>
): Promise<boolean> => {
  try {
    const { error } = await supabase
      .from('products')
      .update({
        title: updates.seoTitle,
        description: updates.generatedDescription,
        vendor: updates.brand,
        size: updates.size,
        color: updates.color,
        price: updates.price,
        condition: updates.condition,
        flaws: updates.flaws,
        material: updates.material,
        tags: updates.tags,
        // ... add other fields as needed
      })
      .eq('id', productId);

    if (error) {
      return false;
    }

    return true;
  } catch (error) {
    return false;
  }
};
