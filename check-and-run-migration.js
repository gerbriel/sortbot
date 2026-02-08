#!/usr/bin/env node

/**
 * Check if workflow_batches table exists and run migration if needed
 */

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://raaenaqjsmihimegflhj.supabase.co';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseServiceKey) {
  console.error('❌ No Supabase service key found in environment');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function checkAndRunMigration() {
  console.log('🔍 Checking if workflow_batches table exists...\n');

  try {
    // Try to query the workflow_batches table
    const { data, error } = await supabase
      .from('workflow_batches')
      .select('id')
      .limit(1);

    if (error) {
      if (error.code === '42P01' || error.message.includes('does not exist')) {
        console.log('⚠️  Table does not exist. Need to run migration.\n');
        console.log('📋 INSTRUCTIONS:');
        console.log('1. Go to your Supabase Dashboard: https://supabase.com/dashboard');
        console.log('2. Select your project');
        console.log('3. Go to SQL Editor');
        console.log('4. Click "New Query"');
        console.log('5. Copy and paste the contents of:');
        console.log('   supabase/migrations/create_workflow_batches.sql');
        console.log('6. Click "Run" button\n');
        console.log('Or run this command if you have Supabase CLI:');
        console.log('   supabase db push\n');
        return false;
      }
      
      console.error('❌ Unexpected error:', error);
      return false;
    }

    console.log('✅ workflow_batches table exists!');
    console.log(`   Found ${data?.length || 0} batch(es)\n`);
    return true;

  } catch (error) {
    console.error('❌ Error checking table:', error.message);
    return false;
  }
}

checkAndRunMigration();
