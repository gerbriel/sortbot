// Character limits for product fields (Shopify compatible)
export const FIELD_LIMITS = {
  SEO_TITLE: 70,           // Shopify page title limit
  TAGS: 255,                // Combined tags length
  SIZE: 50,                 // Size field
  BRAND: 255,               // Vendor/brand field
  CONDITION: 50,            // Condition dropdown
  FLAWS: 500,               // Flaws description
  MATERIAL: 255,            // Material field
  ERA_VIBE: 100,            // Era/vibe field
  CARE_INSTRUCTIONS: 500,   // Care instructions
  PRICE: 10,                // Price (as string)
  PRODUCT_DESCRIPTION: 5000 // Shopify product description limit
};

// Helper function to truncate text
export const truncateText = (text: string, limit: number): string => {
  if (text.length <= limit) return text;
  return text.substring(0, limit);
};

// Helper to show character count
export const getCharacterCount = (text: string, limit: number): string => {
  return `${text.length}/${limit}`;
};

// Helper to check if over limit
export const isOverLimit = (text: string, limit: number): boolean => {
  return text.length > limit;
};
