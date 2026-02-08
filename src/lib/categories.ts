// Category Types
export interface Category {
  id: string;
  user_id: string;
  name: string; // Internal name (lowercase)
  display_name: string; // Display name
  emoji: string; // Icon emoji
  color: string; // Hex color
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CategoryInput {
  name: string;
  display_name: string;
  emoji?: string;
  color?: string;
  sort_order?: number;
  is_active?: boolean;
}

// Default categories for new users
export const DEFAULT_CATEGORIES: Omit<CategoryInput, 'user_id'>[] = [
  { name: 'sweatshirts', display_name: 'Sweatshirts', emoji: '🧥', color: '#667eea', sort_order: 1 },
  { name: 'outerwear', display_name: 'Outerwear', emoji: '🧥', color: '#764ba2', sort_order: 2 },
  { name: 'tees', display_name: 'Tees', emoji: '👕', color: '#f093fb', sort_order: 3 },
  { name: 'bottoms', display_name: 'Bottoms', emoji: '👖', color: '#4facfe', sort_order: 4 },
  { name: 'femme', display_name: 'Feminine', emoji: '👗', color: '#fa709a', sort_order: 5 },
  { name: 'hats', display_name: 'Hats', emoji: '🧢', color: '#30cfd0', sort_order: 6 },
  { name: 'mystery boxes', display_name: 'Mystery Boxes', emoji: '📦', color: '#a8edea', sort_order: 7 },
];

// Emoji options for category selection
export const EMOJI_OPTIONS = [
  '🧥', '👕', '👖', '👗', '🧢', '👟', '👞', '👠', '👡', '👢', 
  '👔', '🎽', '🥼', '🦺', '👘', '🥻', '🩱', '🩲', '🩳', '👙',
  '💼', '👜', '🎒', '👝', '🛍️', '🎁', '📦', '🏷️', '✨', '⭐'
];
