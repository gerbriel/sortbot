import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://raaenaqjsmihimegflhj.supabase.co';
const ANON_KEY = 'REDACTED_ANON_KEY';
const USER_ID = '18c356d9-2b6a-45c6-ae41-c6d360e9663f';

const supabase = createClient(SUPABASE_URL, ANON_KEY);

async function run() {
  console.log('\n=== 1. List buckets ===');
  const { data: buckets, error: bucketsErr } = await supabase.storage.listBuckets();
  if (bucketsErr) {
    console.error('listBuckets error:', bucketsErr.message);
  } else {
    for (const b of buckets) {
      console.log(`  bucket: ${b.name}  public: ${b.public}  id: ${b.id}`);
    }
  }

  console.log('\n=== 2. List files under user folder (first 10) ===');
  const { data: files, error: listErr } = await supabase.storage
    .from('product-images')
    .list(USER_ID, { limit: 10 });
  if (listErr) {
    console.error('list error:', listErr.message);
  } else if (!files || files.length === 0) {
    console.log('  ❌ NO FILES FOUND under', USER_ID);
    console.log('  → The bucket folder for this user is empty. The uploads likely never completed or wrote to a different path.');
  } else {
    console.log(`  ✅ Found ${files.length} folders/files:`);
    for (const f of files) console.log('  ', f.name, f.metadata ? `(${f.metadata.size} bytes)` : '');
  }

  console.log('\n=== 3. Check product_images DB rows for this user ===');
  const { data: dbRows, error: dbErr, count } = await supabase
    .from('product_images')
    .select('storage_path, image_url', { count: 'exact' })
    .eq('user_id', USER_ID)
    .limit(5);
  if (dbErr) {
    console.error('product_images query error:', dbErr.message);
  } else {
    console.log(`  DB has ${count} product_images rows for this user`);
    if (dbRows?.length) {
      console.log('  Sample rows:');
      for (const r of dbRows) console.log('   ', r.storage_path, '|', r.image_url?.slice(0, 80));
    }
  }

  console.log('\n=== 4. Fetch one failing URL directly ===');
  const testUrl = `${SUPABASE_URL}/storage/v1/object/public/product-images/${USER_ID}/1454e57d-cc66-47f5-bac8-582f0426dafb/1779693292097-khfze4rrw7e.jpg`;
  console.log('  URL:', testUrl);
  const res = await fetch(testUrl);
  console.log('  HTTP status:', res.status, res.statusText);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.log('  Response body:', body.slice(0, 300));
  }
}

run().catch(console.error);
