#!/usr/bin/env node

/**
 * Run the collaborative migration
 */

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Get Supabase credentials from environment
const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing Supabase credentials');
  console.error('Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function runMigration() {
  console.log('🚀 Starting collaborative system migration...\n');

  const migrationPath = path.join(__dirname, 'supabase', 'migrations', '013_convert_to_shared_collaborative.sql');
  const migrationSQL = fs.readFileSync(migrationPath, 'utf-8');

  // Split by statement (rough split on semicolons outside of function bodies)
  const statements = migrationSQL
    .split('\n\n')
    .filter(stmt => {
      const trimmed = stmt.trim();
      return trimmed && 
             !trimmed.startsWith('--') && 
             trimmed !== '-- ============================================================================';
    });

  console.log(`📝 Running ${statements.length} migration statements...\n`);

  let successCount = 0;
  let errorCount = 0;

  for (let i = 0; i < statements.length; i++) {
    const statement = statements[i].trim();
    
    if (!statement || statement.startsWith('--')) {
      continue;
    }

    // Extract a short description for logging
    let description = statement.split('\n')[0];
    if (description.startsWith('--')) {
      description = description.substring(2).trim();
    } else {
      description = statement.substring(0, 60) + '...';
    }

    try {
      const { error } = await supabase.rpc('exec_sql', { sql: statement });
      
      if (error) {
        // Try direct query if RPC fails
        const { error: queryError } = await supabase.from('_').select('*').limit(0);
        
        if (queryError && queryError.message.includes('does not exist')) {
          // Table doesn't exist, which might be expected for some DROP statements
          console.log(`⚠️  Skipped: ${description}`);
        } else {
          console.log(`❌ Error: ${description}`);
          console.log(`   ${error.message}\n`);
          errorCount++;
        }
      } else {
        console.log(`✅ ${description}`);
        successCount++;
      }
    } catch (err) {
      console.log(`⚠️  ${description}`);
      console.log(`   ${err.message}\n`);
    }
  }

  console.log('\n' + '─'.repeat(80));
  console.log(`\n📊 Migration Summary:`);
  console.log(`   ✅ Successful: ${successCount}`);
  console.log(`   ❌ Errors: ${errorCount}`);
  console.log(`   Total: ${statements.length}\n`);

  if (errorCount === 0) {
    console.log('🎉 Migration completed successfully!');
    console.log('\n📋 Next Steps:');
    console.log('   1. Update service files (removing user_id filters)');
    console.log('   2. Test the application');
    console.log('   3. Verify all users can see shared data\n');
  } else {
    console.log('⚠️  Migration completed with some errors');
    console.log('   Review errors above and run verification queries\n');
  }
}

runMigration().catch(console.error);
