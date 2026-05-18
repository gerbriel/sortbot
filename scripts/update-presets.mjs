/**
 * Update all system category presets (user_id = 00000000-...) in Supabase:
 *  - Set is_default = TRUE
 *  - Set typical_condition = 'Good' (where blank)
 *  - Set parcel_size based on default_weight_value
 *
 * Run: node scripts/update-presets.mjs
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL   = 'https://raaenaqjsmihimegflhj.supabase.co';
const SUPABASE_ANON  = 'REDACTED_ANON_KEY';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);

// Parcel size by weight (lbs)
function parcelSize(weightLb) {
  const w = parseFloat(weightLb) || 0;
  if (w <= 0.3)  return 'Small';
  if (w <= 0.8)  return 'Medium';
  if (w <= 1.5)  return 'Large';
  return 'Extra Large';
}

// Per-preset overrides (from CSV analysis)
// Keys match category_name column
const OVERRIDES = {
  // Tees (light)
  'mens-tees':        { parcel_size: 'Small',  typical_condition: 'Good' },
  'womens-tees':      { parcel_size: 'Small',  typical_condition: 'Good' },
  'kids-tees':        { parcel_size: 'Small',  typical_condition: 'Good' },
  // Shirts
  'mens-shirts':      { parcel_size: 'Small',  typical_condition: 'Good' },
  'kids-shirts':      { parcel_size: 'Small',  typical_condition: 'Good' },
  // Sweatshirts
  'mens-sweatshirts':   { parcel_size: 'Medium', typical_condition: 'Good' },
  'womens-sweatshirts': { parcel_size: 'Medium', typical_condition: 'Good' },
  'kids-sweatshirts':   { parcel_size: 'Small',  typical_condition: 'Good' },
  // Hoodies
  'mens-hoodies':     { parcel_size: 'Medium', typical_condition: 'Good' },
  'womens-hoodies':   { parcel_size: 'Medium', typical_condition: 'Good' },
  'kids-hoodies':     { parcel_size: 'Small',  typical_condition: 'Good' },
  // Pants / Jeans
  'mens-pants':       { parcel_size: 'Medium', typical_condition: 'Good' },
  'womens-pants':     { parcel_size: 'Medium', typical_condition: 'Good' },
  'kids-pants':       { parcel_size: 'Small',  typical_condition: 'Good' },
  'mens-jeans':       { parcel_size: 'Medium', typical_condition: 'Good' },
  'womens-jeans':     { parcel_size: 'Medium', typical_condition: 'Good' },
  // Shorts
  'mens-shorts':      { parcel_size: 'Small',  typical_condition: 'Good' },
  'womens-shorts':    { parcel_size: 'Small',  typical_condition: 'Good' },
  'kids-shorts':      { parcel_size: 'Small',  typical_condition: 'Good' },
  // Jackets / Coats
  'mens-jackets':     { parcel_size: 'Large',  typical_condition: 'Good' },
  'womens-jackets':   { parcel_size: 'Large',  typical_condition: 'Good' },
  'kids-jackets':     { parcel_size: 'Medium', typical_condition: 'Good' },
  // Jerseys
  'mens-jerseys':     { parcel_size: 'Medium', typical_condition: 'Good' },
  // Dresses / Skirts / Bodysuits / Tops
  'womens-dresses':   { parcel_size: 'Medium', typical_condition: 'Good' },
  'kids-dresses':     { parcel_size: 'Small',  typical_condition: 'Good' },
  'womens-skirts':    { parcel_size: 'Small',  typical_condition: 'Good' },
  'womens-bodysuits': { parcel_size: 'Small',  typical_condition: 'Good' },
  'womens-tops':      { parcel_size: 'Small',  typical_condition: 'Good' },
  // Shoes
  'mens-shoes':       { parcel_size: 'Large',  typical_condition: 'Good' },
  'womens-shoes':     { parcel_size: 'Large',  typical_condition: 'Good' },
  'kids-shoes':       { parcel_size: 'Medium', typical_condition: 'Good' },
  // Hats
  'mens-hats':        { parcel_size: 'Small',  typical_condition: 'Good' },
  'womens-hats':      { parcel_size: 'Small',  typical_condition: 'Good' },
  'kids-hats':        { parcel_size: 'Small',  typical_condition: 'Good' },
  // Accessories
  'mens-accessories':   { parcel_size: 'Small', typical_condition: 'Good' },
  'womens-accessories': { parcel_size: 'Small', typical_condition: 'Good' },
  'kids-accessories':   { parcel_size: 'Small', typical_condition: 'Good' },
};

async function main() {
  console.log('Fetching system presets...');
  const { data: presets, error } = await supabase
    .from('category_presets')
    .select('id, category_name, default_weight_value, typical_condition, parcel_size, is_default')
    .eq('user_id', '00000000-0000-0000-0000-000000000000');

  if (error) { console.error('Fetch error:', error); process.exit(1); }
  console.log(`Found ${presets.length} system presets.`);

  let successCount = 0;
  let errorCount = 0;

  for (const p of presets) {
    const override = OVERRIDES[p.category_name] || {};
    const updates = {
      is_default:        true,
      typical_condition: override.typical_condition ?? p.typical_condition ?? 'Good',
      parcel_size:       override.parcel_size ?? p.parcel_size ?? parcelSize(p.default_weight_value),
    };

    console.log(`  Updating [${p.category_name}]:`, updates);

    const { error: upErr } = await supabase
      .from('category_presets')
      .update(updates)
      .eq('id', p.id);

    if (upErr) {
      console.error(`  ❌ Failed [${p.category_name}]:`, upErr.message);
      errorCount++;
    } else {
      console.log(`  ✅ Done [${p.category_name}]`);
      successCount++;
    }
  }

  console.log(`\nDone. ${successCount} updated, ${errorCount} failed.`);
}

main();
