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
      console.error('Storage upload error:', error);
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
    console.error('Error uploading image:', error);
    return null;
  }
};

/**
 * Save product and its images to database
 */
export const saveProductToDatabase = async (
  product: ClothingItem,
  userId: string,
  groupImages: ClothingItem[]
): Promise<string | null> => {
  try {
    // 1. Insert product
    const { data: productData, error: productError } = await supabase
      .from('products')
      .insert({
        user_id: userId,
        title: product.seoTitle || 'Untitled Product',
        url_handle: (product.seoTitle || 'product')
          .toLowerCase()
          .replace(/\s+/g, '-')
          .replace(/[^a-z0-9-]/g, ''),
        description: product.generatedDescription || '',
        vendor: product.brand || '',
        product_category: product.category || '',
        product_type: product.productType || 'Clothing',
        tags: product.tags || [],
        published: product.published || false,
        status: product.status || 'Draft',
        size: product.size || '',
        color: product.color || '',
        price: product.price || 0,
        compare_at_price: product.compareAtPrice || null,
        cost_per_item: product.costPerItem || null,
        sku: product.sku || '',
        barcode: product.barcode || '',
        inventory_quantity: product.inventoryQuantity || 0,
        weight_value: product.weightValue || '150',
        weight_unit: 'g',
        requires_shipping: true,
        condition: product.condition || 'Good',
        flaws: product.flaws || '',
        material: product.material || '',
        era: product.era || '',
        care_instructions: product.care || '',
        measurements: product.measurements || {},
        seo_title: product.seoTitle || '',
        seo_description: product.seoDescription || '',
        voice_description: product.voiceDescription || '',
      })
      .select()
      .single();

    if (productError) {
      console.error('Product insert error:', productError);
      return null;
    }

    console.log('✅ Product saved:', productData.id);

    // 2. Upload images and save URLs
    for (let i = 0; i < groupImages.length; i++) {
      const item = groupImages[i];
      
      // Upload image to storage
      const uploadResult = await uploadImageToStorage(
        item.file,
        userId,
        productData.id,
        i
      );

      if (uploadResult) {
        // Save image record to database
        const { error: imageError } = await supabase
          .from('product_images')
          .insert({
            product_id: productData.id,
            user_id: userId,
            image_url: uploadResult.url,
            storage_path: uploadResult.path,
            position: i,
            alt_text: `${product.seoTitle || 'Product'} - Image ${i + 1}`,
          });

        if (imageError) {
          console.error('Image record insert error:', imageError);
        } else {
          console.log(`✅ Image ${i + 1} saved:`, uploadResult.url);
        }
      }
    }

    return productData.id;
  } catch (error) {
    console.error('Error saving product:', error);
    return null;
  }
};

/**
 * Save batch of products (entire session)
 */
export const saveBatchToDatabase = async (
  items: ClothingItem[],
  userId: string
): Promise<{ success: number; failed: number }> => {
  console.log('📦 saveBatchToDatabase called');
  console.log('Items to save:', items.length);
  console.log('User ID:', userId);
  
  let success = 0;
  let failed = 0;

  // Group items by productGroup
  const productGroups = items.reduce((groups, item) => {
    const groupId = item.productGroup || item.id;
    if (!groups[groupId]) {
      groups[groupId] = [];
    }
    groups[groupId].push(item);
    return groups;
  }, {} as Record<string, ClothingItem[]>);

  console.log('Product groups:', Object.keys(productGroups).length);
  console.log('Groups:', productGroups);

  // Save each product group
  for (const [groupId, groupItems] of Object.entries(productGroups)) {
    console.log(`\n💾 Saving product group: ${groupId} (${groupItems.length} images)`);
    const productData = groupItems[0]; // First item has all the product info
    
    console.log('Product data:', {
      title: productData.seoTitle,
      category: productData.category,
      price: productData.price,
      hasFile: !!productData.file
    });
    
    const productId = await saveProductToDatabase(
      productData,
      userId,
      groupItems
    );

    if (productId) {
      console.log(`✅ Product saved with ID: ${productId}`);
      success++;
    } else {
      console.error(`❌ Failed to save product group: ${groupId}`);
      failed++;
    }
  }

  console.log(`\n📊 Final results: ${success} succeeded, ${failed} failed`);
  return { success, failed };
};

/**
 * Fetch user's products from database
 */
export const fetchUserProducts = async (userId: string) => {
  try {
    const { data, error } = await supabase
      .from('products')
      .select(`
        *,
        product_images (
          id,
          image_url,
          storage_path,
          position,
          alt_text
        )
      `)
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching products:', error);
      return [];
    }

    return data || [];
  } catch (error) {
    console.error('Error fetching products:', error);
    return [];
  }
};

/**
 * Delete product and its images
 */
export const deleteProduct = async (productId: string, userId: string): Promise<boolean> => {
  try {
    // 1. Get all image paths for this product
    const { data: images } = await supabase
      .from('product_images')
      .select('storage_path')
      .eq('product_id', productId)
      .eq('user_id', userId);

    // 2. Delete images from storage
    if (images && images.length > 0) {
      const paths = images.map(img => img.storage_path);
      const { error: storageError } = await supabase.storage
        .from('product-images')
        .remove(paths);

      if (storageError) {
        console.error('Storage delete error:', storageError);
      }
    }

    // 3. Delete product (CASCADE will delete image records)
    const { error: deleteError } = await supabase
      .from('products')
      .delete()
      .eq('id', productId)
      .eq('user_id', userId);

    if (deleteError) {
      console.error('Product delete error:', deleteError);
      return false;
    }

    console.log('✅ Product deleted:', productId);
    return true;
  } catch (error) {
    console.error('Error deleting product:', error);
    return false;
  }
};

/**
 * Update product data
 */
export const updateProduct = async (
  productId: string,
  userId: string,
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
      .eq('id', productId)
      .eq('user_id', userId);

    if (error) {
      console.error('Product update error:', error);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Error updating product:', error);
    return false;
  }
};
