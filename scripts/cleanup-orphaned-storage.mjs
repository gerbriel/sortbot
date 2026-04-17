/**
 * cleanup-orphaned-storage.mjs
 *
 * One-shot script: finds every file in the `product-images` Storage bucket
 * whose storage_path has NO matching row in the `product_images` DB table
 * (i.e. files from cancelled uploads), then deletes them.
 *
 * Run with:
 *   node scripts/cleanup-orphaned-storage.mjs
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL     = 'https://raaenaqjsmihimegflhj.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJhYWVuYXFqc21paGltZWdmbGhqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAwNzM0MjEsImV4cCI6MjA4NTY0OTQyMX0.96JNL3Xe8F71H5A1-9xKWCsHj8szh48nnY3ydLsU14o';

const BUCKET = 'product-images';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ── 1. Sign in ────────────────────────────────────────────────────────────────
// The anon key can read/list public storage but storage.remove() requires an
// authenticated session with RLS allowing the user to delete their own files.
// Enter the same email/password you log in with in the app.

import readline from 'readline';
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(res => rl.question(q, res));

const email    = await ask('App login email:    ');
const password = await ask('App login password: ');
rl.close();

const { error: authErr } = await supabase.auth.signInWithPassword({ email, password });
if (authErr) { console.error('❌ Auth failed:', authErr.message); process.exit(1); }
console.log('✅ Signed in\n');

// ── 2. Get the logged-in user id ──────────────────────────────────────────────
const { data: { user } } = await supabase.auth.getUser();
const userId = user.id;
console.log(`User ID: ${userId}\n`);

// ── 3. List every file in Storage under this user's folder ───────────────────
console.log('📂 Listing storage files…');

// Top-level folders are product UUIDs: userId/productId/filename
const { data: topFolders, error: listErr } = await supabase.storage
  .from(BUCKET)
  .list(userId, { limit: 10000 });

if (listErr) { console.error('❌ List error:', listErr.message); process.exit(1); }

// Collect all full storage paths
const allPaths = [];
for (const folder of (topFolders ?? [])) {
  if (folder.metadata) {
    // It's a direct file (unusual layout) — path is userId/filename
    allPaths.push(`${userId}/${folder.name}`);
  } else {
    // It's a folder (productId) — list files inside it
    const { data: files } = await supabase.storage
      .from(BUCKET)
      .list(`${userId}/${folder.name}`, { limit: 1000 });
    for (const f of (files ?? [])) {
      allPaths.push(`${userId}/${folder.name}/${f.name}`);
    }
  }
}

console.log(`   Found ${allPaths.length} files in Storage\n`);

// ── 4. Fetch every storage_path registered in product_images DB table ─────────
console.log('🗄️  Querying product_images table…');

// Fetch ALL storage_paths for this user in pages — avoids URL-length limits
// from using .in() with hundreds of paths.
const knownPaths = new Set();
const PAGE = 1000;
let from = 0;
while (true) {
  const { data: rows, error: dbErr } = await supabase
    .from('product_images')
    .select('storage_path')
    .eq('user_id', userId)
    .range(from, from + PAGE - 1);
  if (dbErr) { console.error('❌ DB query error:', dbErr.message); process.exit(1); }
  for (const row of (rows ?? [])) {
    if (row.storage_path) knownPaths.add(row.storage_path);
  }
  if (!rows || rows.length < PAGE) break;
  from += PAGE;
}

console.log(`   Found ${knownPaths.size} paths in product_images table`);

// ── 4b. Also protect images still referenced in workflow_batches ──────────────
console.log('🗄️  Querying workflow_batches for in-progress image URLs…');

const { data: batches, error: batchErr } = await supabase
  .from('workflow_batches')
  .select('workflow_state')
  .eq('user_id', userId);

if (batchErr) {
  console.warn('⚠️  Could not query workflow_batches:', batchErr.message);
} else {
  const SUPABASE_STORAGE_PREFIX = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/`;
  for (const batch of (batches ?? [])) {
    const state = batch.workflow_state;
    const items = state?.processedItems ?? state?.items ?? [];
    for (const item of items) {
      for (const url of (item.imageUrls ?? [])) {
        if (typeof url === 'string' && url.startsWith(SUPABASE_STORAGE_PREFIX)) {
          // Strip the base URL to get the storage path (without query params)
          const path = url.replace(SUPABASE_STORAGE_PREFIX, '').split('?')[0];
          knownPaths.add(path);
        }
      }
    }
  }
  console.log(`   Protected ${knownPaths.size} total paths (including in-progress batches)\n`);
}

// ── 5. Diff: orphans are in Storage but not in DB or active batches ───────────
const orphans = allPaths.filter(p => !knownPaths.has(p));
console.log(`🔍 Orphaned files (in Storage, not in DB): ${orphans.length}`);

if (orphans.length === 0) {
  console.log('✅ Nothing to clean up!');
  process.exit(0);
}

orphans.forEach(p => console.log(`   • ${p}`));
console.log('');

// ── 6. Confirm then delete ────────────────────────────────────────────────────
const rl2 = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask2 = (q) => new Promise(res => rl2.question(q, res));
const answer = await ask2(`Delete all ${orphans.length} orphaned file(s)? [yes/no]: `);
rl2.close();

if (answer.trim().toLowerCase() !== 'yes') {
  console.log('Aborted — nothing deleted.');
  process.exit(0);
}

// Delete in chunks of 100 (Supabase Storage remove limit)
let deleted = 0;
for (let i = 0; i < orphans.length; i += 100) {
  const chunk = orphans.slice(i, i + 100);
  const { error: delErr } = await supabase.storage.from(BUCKET).remove(chunk);
  if (delErr) {
    console.error(`❌ Delete error on chunk ${i}:`, delErr.message);
  } else {
    deleted += chunk.length;
    console.log(`   Deleted chunk ${i / 100 + 1} (${deleted}/${orphans.length})`);
  }
}

console.log(`\n✅ Done — deleted ${deleted} orphaned file(s) from Storage.`);
