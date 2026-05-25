import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://raaenaqjsmihimegflhj.supabase.co';
const ANON_KEY = 'REDACTED_ANON_KEY';
const USER_ID = '18c356d9-2b6a-45c6-ae41-c6d360e9663f';

// product IDs from failing URLs in the console log
const FAILING_IDS = [
  '1454e57d-cc66-47f5-bac8-582f0426dafb',
  'fa29e192-1a3e-4929-abf7-22737f64e157',
  '4f2ff855-9f61-45df-a48e-f8d1d3d1707b',
];

const supabase = createClient(SUPABASE_URL, ANON_KEY);

async function run() {
  console.log('\n=== Check if failing product ID folders exist in Storage ===');
  for (const id of FAILING_IDS) {
    const { data, error } = await supabase.storage
      .from('product-images')
      .list(`${USER_ID}/${id}`);
    if (error) {
      console.log(`  ${id}: LIST ERROR — ${error.message}`);
    } else if (!data || data.length === 0) {
      console.log(`  ${id}: ❌ folder is EMPTY or does not exist`);
    } else {
      console.log(`  ${id}: ✅ has ${data.length} file(s):`);
      for (const f of data) console.log(`    ${f.name}`);
    }
  }

  console.log('\n=== Check workflow_batches for this user (where the 770 items come from) ===');
  const { data: batches, error: batchErr } = await supabase
    .from('workflow_batches')
    .select('id, batch_number, created_at, total_images')
    .eq('user_id', USER_ID)
    .order('created_at', { ascending: false })
    .limit(5);
  if (batchErr) {
    console.error('workflow_batches error:', batchErr.message);
  } else {
    console.log(`  Found ${batches?.length ?? 0} batches:`);
    for (const b of batches ?? []) {
      console.log(`  batch #${b.batch_number}  id=${b.id}  total_images=${b.total_images}  created=${b.created_at}`);
    }
  }

  console.log('\n=== Sample one workflow_batch state to inspect image URLs ===');
  const { data: batchState, error: stateErr } = await supabase
    .from('workflow_batches')
    .select('id, workflow_state')
    .eq('user_id', USER_ID)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  if (stateErr) {
    console.error('workflow_state error:', stateErr.message);
  } else {
    const imgs = batchState?.workflow_state?.uploadedImages ?? [];
    console.log(`  Batch ${batchState?.id} has ${imgs.length} uploadedImages in state`);
    if (imgs.length > 0) {
      const sample = imgs[0];
      console.log('  Sample item:');
      console.log('    id:', sample.id);
      console.log('    storagePath:', sample.storagePath);
      console.log('    preview:', sample.preview?.slice(0, 100));
      console.log('    imageUrls[0]:', sample.imageUrls?.[0]?.slice(0, 100));
      // Check if this storage path exists
      if (sample.storagePath) {
        const dir = sample.storagePath.substring(0, sample.storagePath.lastIndexOf('/'));
        const file = sample.storagePath.split('/').pop();
        const { data: fileList } = await supabase.storage.from('product-images').list(dir);
        const exists = fileList?.some(f => f.name === file);
        console.log('    file exists in Storage:', exists ? '✅ YES' : '❌ NO');
      }
    }
  }
}

run().catch(console.error);
