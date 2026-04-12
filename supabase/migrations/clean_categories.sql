-- ============================================================
-- CLEAN CATEGORIES TABLE
-- Removes femme / kids, keeps correct drop-zone categories
--
-- Run in: supabase.com/dashboard/project/raaenaqjsmihimegflhj/sql/new
-- ============================================================

-- Remove femme and kids from the categories table (drop zone)
DELETE FROM categories
WHERE name IN ('femme', 'kids')
  AND user_id = '00000000-0000-0000-0000-000000000000';

-- Rename "Mystery Boxes" to "Bags" if it exists
UPDATE categories
SET name = 'bags', display_name = 'Bags', emoji = '👜', sort_order = 6
WHERE name = 'mystery boxes'
  AND user_id = '00000000-0000-0000-0000-000000000000';

-- Add Accessories if missing
INSERT INTO categories (user_id, name, display_name, emoji, sort_order)
VALUES ('00000000-0000-0000-0000-000000000000', 'accessories', 'Accessories', '🕶️', 7)
ON CONFLICT (user_id, name) DO NOTHING;

-- Verify
SELECT name, display_name, emoji, sort_order
FROM categories
WHERE user_id = '00000000-0000-0000-0000-000000000000'
ORDER BY sort_order;
