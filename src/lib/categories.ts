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

// Default categories for new users.
// These colors are PERSISTED DB DATA (categories.color), not CSS — they cannot
// be tokens, so they are hex literals picked to sit on the dark canvas. Each is
// >= 6.7:1 against --ink-850 (#141418), well past the 3:1 non-text bar, so they
// stay legible as zone borders and swatch fills. Hues are spread around the
// wheel and no two list-adjacent entries share a family, so the seven read as
// distinct at swatch size.
export const DEFAULT_CATEGORIES: Omit<CategoryInput, 'user_id'>[] = [
  { name: 'sweatshirts', display_name: 'Sweatshirts', emoji: '🧥', color: '#a78bfa', sort_order: 1 },
  { name: 'outerwear', display_name: 'Outerwear', emoji: '🧥', color: '#38bdf8', sort_order: 2 },
  { name: 'tees', display_name: 'Tees', emoji: '👕', color: '#4ade80', sort_order: 3 },
  { name: 'bottoms', display_name: 'Bottoms', emoji: '👖', color: '#fbbf24', sort_order: 4 },
  { name: 'femme', display_name: 'Feminine', emoji: '👗', color: '#f472b6', sort_order: 5 },
  { name: 'hats', display_name: 'Hats', emoji: '🧢', color: '#fb923c', sort_order: 6 },
  { name: 'mystery boxes', display_name: 'Mystery Boxes', emoji: '📦', color: '#2dd4bf', sort_order: 7 },
];

// Emoji options for category selection
export const EMOJI_OPTIONS = [
  '🧥', '👕', '👖', '👗', '🧢', '👟', '👞', '👠', '👡', '👢', 
  '👔', '🎽', '🥼', '🦺', '👘', '🥻', '🩱', '🩲', '🩳', '👙',
  '💼', '👜', '🎒', '👝', '🛍️', '🎁', '📦', '🏷️', '✨', '⭐'
];
