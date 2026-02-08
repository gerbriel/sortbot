# Category Presets - Quick Start Guide

## 🚀 Get Started in 5 Minutes

### Step 1: Run Database Migration (2 min)

**Go to Supabase Dashboard:**
1. Open your Supabase project: https://app.supabase.com
2. Click "SQL Editor" in left sidebar
3. Click "+ New query"
4. Copy the entire contents of `/supabase/migrations/category_presets.sql`
5. Paste into the query editor
6. Click "Run" button

**✅ You should see:** "Success. No rows returned"

---

### Step 2: Add to Your App (1 min)

**Option A - Add to App.tsx:**

```typescript
import CategoryPresetsManager from './components/CategoryPresetsManager';

// Add somewhere in your app:
<CategoryPresetsManager />
```

**Option B - Add as Route (if using React Router):**

```typescript
<Route path="/presets" element={<CategoryPresetsManager />} />
```

**Option C - Add to Settings/Admin Section:**

```typescript
{showSettings && <CategoryPresetsManager />}
```

---

### Step 3: Create Your First Preset (2 min)

1. **Open the Category Presets Manager** in your app
2. **Click "+ Create New Preset"**
3. **Fill in the form** (minimum required):
   - Category Name: `Sweatshirts`
   - Display Name: `Sweatshirts & Hoodies`
   - Default Weight: `1.2`
   - Weight Unit: `lb`
4. **Optional but recommended:**
   - Product Type: `Apparel`
   - Price Range: Min `$35`, Max `$85`
   - Check these measurements: Pit to Pit, Length, Sleeve
   - Default Tags: `sweatshirt, hoodie, pullover`
5. **Click "Create Preset"**

**✅ You should see:** Your new preset card appear in the grid!

---

### Step 4: Test It! (Bonus - 1 min)

**To see your preset in action**, integrate into ProductDescriptionGenerator:

```typescript
// At the top of ProductDescriptionGenerator.tsx
import { getCategoryPresetByName } from '../lib/categoryPresetsService';

// Inside handleGenerateProductInfo, after determining category:
const category = currentItem.category || 'clothing';

// Load preset
const preset = await getCategoryPresetByName(category);

if (preset && preset.default_weight_value) {
  console.log('✅ Preset loaded:', preset.display_name);
  console.log('  Auto-filling weight:', preset.default_weight_value, preset.default_weight_unit);
  
  // You can now access:
  // preset.default_weight_value
  // preset.default_tags
  // preset.suggested_price_min
  // preset.measurement_template
  // etc.
}
```

---

## 🎓 Common Presets to Create

### 1. Sweatshirts
```
Category Name: Sweatshirts
Weight: 1.2 lb
Measurements: ✓ Pit to Pit, ✓ Length, ✓ Sleeve
Price Range: $35 - $85
Tags: sweatshirt, hoodie, pullover
```

### 2. Outerwear
```
Category Name: Outerwear  
Weight: 1.5 lb
Measurements: ✓ Pit to Pit, ✓ Length, ✓ Sleeve, ✓ Shoulder
Price Range: $50 - $150
Tags: jacket, outerwear, coat
```

### 3. Tees
```
Category Name: Tees
Weight: 0.5 lb
Measurements: ✓ Pit to Pit, ✓ Length, ✓ Shoulder
Price Range: $15 - $45
Tags: tee, tshirt, shirt
```

### 4. Bottoms
```
Category Name: Bottoms
Weight: 1.0 lb
Measurements: ✓ Waist, ✓ Inseam, ✓ Rise
Price Range: $40 - $120
Tags: pants, jeans, bottoms, denim
Material: Denim
```

### 5. Hats
```
Category Name: Hats
Weight: 0.3 lb
Measurements: (none)
Price Range: $15 - $45
Tags: hat, cap, headwear
Product Type: Accessories
```

### 6. Accessories
```
Category Name: Accessories
Weight: 0.5 lb
Measurements: (none)
Price Range: $20 - $75
Tags: accessories
Product Type: Accessories
```

---

## 📋 Checklist

- [ ] Database migration run successfully
- [ ] CategoryPresetsManager added to app
- [ ] Can see the manager interface
- [ ] Created first preset (Sweatshirts)
- [ ] Preset shows up in card grid
- [ ] Can edit the preset
- [ ] (Optional) Integrated auto-apply logic

---

## ❓ Troubleshooting

**Can't see SQL Editor in Supabase?**
- Make sure you're in the correct project
- Check you have proper permissions

**Migration error?**
- Copy the ENTIRE file contents
- Make sure no syntax errors in paste
- Try running line by line if needed

**Can't see CategoryPresetsManager?**
- Check import path is correct
- Make sure component is exported
- Check console for errors

**Preset not saving?**
- Check you're logged in (RLS policies require auth)
- Verify category name and display name filled
- Check browser console for errors

**Preset cards empty?**
- Check you clicked "Create Preset"
- Verify database migration ran
- Check browser console for errors
- Try refreshing the page

---

## 🎉 Next Steps

Once you have presets working:

1. **Create presets for all your categories**
   - Sweatshirts, Outerwear, Tees, Bottoms, Hats, Accessories, etc.

2. **Integrate auto-apply**
   - See `/CATEGORY_PRESETS_INTEGRATION_EXAMPLE.txt` for code examples
   - Apply presets when category is selected
   - Show preset indicator in UI

3. **Customize for your business**
   - Adjust price ranges to match your market
   - Add your common materials
   - Set your typical conditions

4. **Train your team**
   - Show them how to create/edit presets
   - Explain when to create new ones
   - Share best practices

---

## 📚 Full Documentation

- **Complete Guide**: `/CATEGORY_PRESETS_GUIDE.md`
- **Implementation Details**: `/CATEGORY_PRESETS_COMPLETE.md`
- **Integration Examples**: `/CATEGORY_PRESETS_INTEGRATION_EXAMPLE.txt`

---

## 🆘 Need Help?

Common issues and solutions:

**Issue**: "Missing Supabase environment variables"
**Solution**: Check your `.env` file has `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`

**Issue**: "Users can view their own category presets" policy error
**Solution**: Make sure you're logged in to your Supabase account

**Issue**: Preset not applying to products
**Solution**: Check category name matches exactly (case-sensitive)

---

## ✅ You're Done!

You now have a working category presets system. Every time you create a new Sweatshirt product, you can apply the preset and instantly get:
- ⚖️ Weight: 1.2 lb
- 📏 Relevant measurements
- 🏷️ Auto-tags
- 💰 Price guidance

**Time saved per product: ~30 seconds**
**Over 100 products: 50 minutes saved!**

Happy sorting! 🎉
