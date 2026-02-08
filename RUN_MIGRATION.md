# 🚀 Quick Start: Run Database Migration

## Step 1: Open Supabase Dashboard

1. Go to [supabase.com](https://supabase.com)
2. Sign in
3. Open your project: **AI Sorting App**
4. Click **SQL Editor** in the left sidebar

## Step 2: Run the Migration

1. Click **New Query**
2. Copy the contents of `supabase/migrations/extend_category_presets.sql`
3. Paste into the SQL Editor
4. Click **Run** (or press `Cmd + Enter`)

## Step 3: Verify Success

You should see output like:

```
=================================================================
Category Presets Extended - UPDATED ✓
=================================================================

📊 Columns Added:
  • Pricing: compare_at_price, cost_per_item
  • Details: color, secondary_color, model_name, model_number, era
  • Inventory: sku_prefix, barcode_prefix, default_inventory_quantity
  • Measurements: default_measurements (JSONB)
  • SEO: seo_description, mpn_prefix
  • Status: default_status, default_published
  • Advanced: tax_code, unit pricing fields (5 columns)

🎯 Total New Columns: 20
📋 Total Preset Fields: 49 (29 existing + 20 new)

✅ Category presets now support ALL 62 CSV fields!

=================================================================
```

## Step 4: Test in the App

1. Go to **Settings → Category Presets**
2. Create or edit a preset
3. Notice new fields available:
   - Compare At Price
   - Color
   - SKU Prefix (e.g., "TEE-")
   - Default Measurements
   - SEO Description
   - etc.

4. Save the preset
5. Upload images and group them
6. Drag group to your updated category
7. Go to **Step 4: Product Info**
8. **All 50+ fields should now be pre-filled!** ✅

## ✅ Done!

Your comprehensive fields system is now live!

---

## 🔍 Troubleshooting

### "Column already exists" error
- No problem! The migration uses `IF NOT EXISTS`
- Safe to run multiple times

### No new fields showing in UI
- Hard refresh the app: `Cmd + Shift + R`
- Check browser console for errors
- Verify migration ran successfully in Supabase

### Presets not applying
- Check browser console for errors
- Verify preset is marked as "Active"
- Check category name matches exactly (case-insensitive)

---

## 📚 More Info

See `COMPREHENSIVE_FIELDS_UPDATE.md` for complete documentation.
