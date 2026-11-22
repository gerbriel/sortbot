-- ============================================================================
-- CREATE DEFAULT PRESETS FOR EXISTING CATEGORIES
-- ============================================================================
-- This script creates default presets for all existing categories that don't have one
-- Run this AFTER running extend_category_presets.sql migration

-- First, let's see what categories exist without default presets
DO $$
DECLARE
  category_record RECORD;
  new_preset_id UUID;
  random_suffix TEXT;
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '=================================================================';
  RAISE NOTICE 'Creating Default Presets for Existing Categories';
  RAISE NOTICE '=================================================================';
  RAISE NOTICE '';

  -- Loop through all active categories
  FOR category_record IN 
    SELECT 
      c.id,
      c.user_id,
      c.name,
      c.display_name
    FROM categories c
    WHERE c.is_active = true
      -- Only categories that don't have a default preset yet
      AND NOT EXISTS (
        SELECT 1 
        FROM category_presets cp 
        WHERE cp.product_type = c.name 
          AND cp.is_default = true
          AND cp.user_id = c.user_id
      )
  LOOP
    -- Generate random suffix for unique category_name
    random_suffix := substr(md5(random()::text), 1, 6);
    
    -- Create default preset for this category
    INSERT INTO category_presets (
      user_id,
      category_name,
      display_name,
      description,
      product_type,
      default_weight_unit,
      requires_shipping,
      is_active,
      is_default,
      measurement_template
    ) VALUES (
      category_record.user_id,
      category_record.name || '_default_' || random_suffix,
      category_record.display_name || ' (Default)',
      'Default preset for ' || category_record.display_name || ' category',
      category_record.name,
      'lb',
      true,
      true,
      true, -- Mark as default
      '{"pitToPit":false,"length":false,"sleeve":false,"shoulder":false,"waist":false,"inseam":false,"rise":false}'::jsonb
    )
    RETURNING id INTO new_preset_id;
    
    RAISE NOTICE '✅ Created default preset for: % (ID: %)', category_record.display_name, new_preset_id;
  END LOOP;

  RAISE NOTICE '';
  RAISE NOTICE '=================================================================';
  RAISE NOTICE 'Default Presets Creation Complete!';
  RAISE NOTICE '=================================================================';
  RAISE NOTICE '';
END $$;

-- Verify the results
SELECT 
  c.display_name as category,
  cp.display_name as preset_name,
  cp.is_default,
  cp.is_active
FROM categories c
LEFT JOIN category_presets cp ON cp.product_type = c.name AND cp.is_default = true
WHERE c.is_active = true
ORDER BY c.display_name;
