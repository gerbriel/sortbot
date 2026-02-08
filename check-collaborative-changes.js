#!/usr/bin/env node

/**
 * Script to check for user_id filtering in service files
 * Run this to find all locations that need to be updated for collaborative system
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const servicePath = path.join(__dirname, 'src', 'lib');

const serviceFiles = [
  'productService.ts',
  'libraryService.ts',
  'categoriesService.ts',
  'categoryPresetsService.ts',
  'exportLibraryService.ts',
  'workflowBatchService.ts',
];

console.log('🔍 Searching for user_id filtering in service files...\n');

let totalOccurrences = 0;

serviceFiles.forEach(fileName => {
  const filePath = path.join(servicePath, fileName);
  
  if (!fs.existsSync(filePath)) {
    console.log(`⚠️  ${fileName} - NOT FOUND`);
    return;
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  
  const occurrences = [];
  
  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    
    // Look for .eq('user_id', ...) in SELECT/DELETE/UPDATE queries
    if (line.includes(".eq('user_id'") && !line.includes('INSERT')) {
      occurrences.push({
        line: lineNumber,
        code: line.trim(),
        type: 'FILTER',
        action: '❌ REMOVE - No longer needed for collaborative system'
      });
    }
    
    // Look for user_id in INSERT statements (should be kept)
    if (line.includes('user_id:') && line.includes('userId')) {
      occurrences.push({
        line: lineNumber,
        code: line.trim(),
        type: 'INSERT',
        action: '✅ KEEP - For audit trail'
      });
    }
    
    // Look for get_next_batch_number with user_id parameter
    if (line.includes('get_next_batch_number') && line.includes('p_user_id')) {
      occurrences.push({
        line: lineNumber,
        code: line.trim(),
        type: 'RPC',
        action: '❌ REMOVE - Function no longer takes user_id parameter'
      });
    }

    // Look for system vs user checks (00000000-0000-0000-0000-000000000000)
    if (line.includes('00000000-0000-0000-0000-000000000000')) {
      occurrences.push({
        line: lineNumber,
        code: line.trim(),
        type: 'SYSTEM_CHECK',
        action: '❌ REMOVE - No distinction between system/user in collaborative mode'
      });
    }
  });
  
  if (occurrences.length > 0) {
    console.log(`📄 ${fileName}`);
    console.log('─'.repeat(80));
    
    occurrences.forEach(occ => {
      console.log(`  Line ${occ.line}: ${occ.action}`);
      console.log(`  ${occ.code}`);
      console.log('');
    });
    
    totalOccurrences += occurrences.length;
  } else {
    console.log(`✅ ${fileName} - No changes needed\n`);
  }
});

console.log('─'.repeat(80));
console.log(`\n📊 Summary: Found ${totalOccurrences} locations that need attention\n`);

console.log('📋 Next Steps:');
console.log('1. Run database migration: node run-migration-interactive.js');
console.log('2. Update service files based on output above');
console.log('3. Test thoroughly before deployment\n');
