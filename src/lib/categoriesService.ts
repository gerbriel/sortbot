import { supabase } from './supabase';
import type { Category, CategoryInput } from './categories';

/**
 * Get all active categories for the current user
 */
export async function getCategories(): Promise<Category[]> {
  const { data: { user } } = await supabase.auth.getUser();
  
  if (!user) {
    throw new Error('User not authenticated');
  }

  const { data, error } = await supabase
    .from('categories')
    .select('*')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .order('sort_order', { ascending: true });

  if (error) {
    console.error('Error fetching categories:', error);
    throw error;
  }

  return data || [];
}

/**
 * Get a specific category by name
 */
export async function getCategoryByName(name: string): Promise<Category | null> {
  const { data: { user } } = await supabase.auth.getUser();
  
  if (!user) {
    throw new Error('User not authenticated');
  }

  const { data, error } = await supabase
    .from('categories')
    .select('*')
    .eq('user_id', user.id)
    .eq('name', name)
    .single();

  if (error) {
    console.error('Error fetching category:', error);
    return null;
  }

  return data;
}

/**
 * Create a new category
 */
export async function createCategory(category: CategoryInput): Promise<Category> {
  const { data: { user } } = await supabase.auth.getUser();
  
  if (!user) {
    throw new Error('User not authenticated');
  }

  // Normalize the name (lowercase, trim spaces)
  const normalizedName = category.name.toLowerCase().trim();

  const { data, error } = await supabase
    .from('categories')
    .insert({
      user_id: user.id,
      name: normalizedName,
      display_name: category.display_name,
      emoji: category.emoji || '📦',
      color: category.color || '#667eea',
      sort_order: category.sort_order || 999,
      is_active: category.is_active !== false,
    })
    .select()
    .single();

  if (error) {
    console.error('Error creating category:', error);
    throw error;
  }

  return data;
}

/**
 * Update an existing category
 */
export async function updateCategory(id: string, updates: Partial<CategoryInput>): Promise<Category> {
  const { data: { user } } = await supabase.auth.getUser();
  
  if (!user) {
    throw new Error('User not authenticated');
  }

  // If name is being updated, normalize it
  const updateData: any = { ...updates };
  if (updates.name) {
    updateData.name = updates.name.toLowerCase().trim();
  }

  const { data, error } = await supabase
    .from('categories')
    .update(updateData)
    .eq('id', id)
    .eq('user_id', user.id)
    .select()
    .single();

  if (error) {
    console.error('Error updating category:', error);
    throw error;
  }

  return data;
}

/**
 * Delete a category (soft delete - sets is_active to false)
 */
export async function deleteCategory(id: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  
  if (!user) {
    throw new Error('User not authenticated');
  }

  const { error } = await supabase
    .from('categories')
    .update({ is_active: false })
    .eq('id', id)
    .eq('user_id', user.id);

  if (error) {
    console.error('Error deleting category:', error);
    throw error;
  }
}

/**
 * Reorder categories by updating their sort_order
 */
export async function reorderCategories(categoryIds: string[]): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  
  if (!user) {
    throw new Error('User not authenticated');
  }

  // Update each category's sort_order based on array index
  const updates = categoryIds.map((id, index) => ({
    id,
    sort_order: index + 1,
  }));

  for (const update of updates) {
    await supabase
      .from('categories')
      .update({ sort_order: update.sort_order })
      .eq('id', update.id)
      .eq('user_id', user.id);
  }
}

/**
 * Initialize default categories for a new user
 */
export async function initializeDefaultCategories(): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  
  if (!user) {
    throw new Error('User not authenticated');
  }

  // Check if user already has categories
  const { data: existing, error: checkError } = await supabase
    .from('categories')
    .select('id')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .limit(1);

  if (checkError) {
    console.error('Error checking existing categories:', checkError);
  }

  if (existing && existing.length > 0) {
    console.log('User already has categories, skipping initialization');
    return; // User already has categories
  }

  // Insert default categories
  const defaultCategories = [
    { name: 'sweatshirts', display_name: 'Sweatshirts', emoji: '🧥', sort_order: 1 },
    { name: 'outerwear', display_name: 'Outerwear', emoji: '🧥', sort_order: 2 },
    { name: 'tees', display_name: 'Tees', emoji: '👕', sort_order: 3 },
    { name: 'bottoms', display_name: 'Bottoms', emoji: '👖', sort_order: 4 },
    { name: 'femme', display_name: 'Feminine', emoji: '👗', sort_order: 5 },
    { name: 'hats', display_name: 'Hats', emoji: '🧢', sort_order: 6 },
    { name: 'mystery boxes', display_name: 'Mystery Boxes', emoji: '📦', sort_order: 7 },
  ];

  // Insert categories one by one to handle conflicts gracefully
  for (const cat of defaultCategories) {
    try {
      await supabase
        .from('categories')
        .insert({
          user_id: user.id,
          name: cat.name,
          display_name: cat.display_name,
          emoji: cat.emoji,
          color: '#667eea',
          sort_order: cat.sort_order,
          is_active: true,
        });
    } catch (err) {
      // Ignore conflicts (category already exists)
      console.log(`Category ${cat.name} might already exist, skipping...`);
    }
  }
}
