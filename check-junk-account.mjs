import { createClient } from '@supabase/supabase-js';
const sb = createClient(
  'https://raaenaqjsmihimegflhj.supabase.co',
  'REDACTED_SERVICE_ROLE_KEY',
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const JUNK_ID = '18c356d9-2b6a-45c6-ae41-c6d360e9663f';
const MAIN_ID = 'b3fb80c0-2310-424e-86ae-bba9a03bfdee';

const { data: rows } = await sb.from('workflow_batches')
  .select('id, batch_name, user_id, current_step')
  .order('created_at', { ascending: false }).limit(30);

console.log('All batches (service role, bypasses RLS):');
rows?.forEach(b =>
  console.log(`  "${b.batch_name}" | step:${b.current_step} | user:${b.user_id?.slice(0,8)}${b.user_id === JUNK_ID ? ' [JUNK]' : b.user_id === MAIN_ID ? ' [MAIN]' : ''}`)
);
console.log(`\nJUNK-owned: ${rows?.filter(b => b.user_id === JUNK_ID).length}`);
console.log(`MAIN-owned: ${rows?.filter(b => b.user_id === MAIN_ID).length}`);


// 1. Find the user
const { data: users } = await sb.auth.admin.listUsers();
const junk = users?.users?.find(u => u.email === JUNK_EMAIL);
console.log('junk user id:', junk?.id ?? 'NOT FOUND');

// 2. Check workflow_batches RLS policy
const { data: policies } = await sb.rpc('pg_policies_for_table', { table_name: 'workflow_batches' }).catch(() => null);
// Fallback: use raw SQL
const { data: policyRows } = await sb.from('pg_policies').select('*').eq('tablename', 'workflow_batches').catch(() => ({ data: null }));

// 3. Check batches directly as service role (bypasses RLS)
const { data: allBatches } = await sb.from('workflow_batches').select('id, batch_name, user_id, current_step').order('created_at', { ascending: false }).limit(20);
console.log('\nAll batches (service role, bypasses RLS):');
allBatches?.forEach(b => console.log(`  "${b.batch_name}" | step:${b.current_step} | user:${b.user_id?.slice(0,8)}`));

// 4. Check RLS policies on workflow_batches
const { data: wbPolicies, error: wbErr } = await sb
  .rpc('exec_sql', { sql: "SELECT policyname, cmd, qual, with_check FROM pg_policies WHERE tablename='workflow_batches'" })
  .catch(() => ({ data: null }));
if (wbPolicies) {
  console.log('\nworkflow_batches RLS policies:', JSON.stringify(wbPolicies, null, 2));
} else {
  // Try information_schema
  const { data: iRows } = await sb.from('information_schema.table_privileges')
    .select('*').eq('table_name', 'workflow_batches').catch(() => ({ data: null }));
  console.log('\nworkflow_batches privileges:', iRows);
}

// 5. Simulate what myjunkemaila would see — query filtered by user_id
if (junk?.id) {
  const { data: junkBatches } = await sb
    .from('workflow_batches')
    .select('id, batch_name, user_id')
    .eq('user_id', junk.id);
  console.log(`\nBatches owned by junk account (${junk.id.slice(0,8)}):`, junkBatches?.length ?? 0);
  junkBatches?.forEach(b => console.log(`  "${b.batch_name}"`));
}
