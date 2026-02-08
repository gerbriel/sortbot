#!/bin/bash

# Run Categories Migration Script
# This script will copy the SQL migration to your clipboard so you can paste it into Supabase Dashboard

echo "================================================"
echo "   Categories Table Migration Helper"
echo "================================================"
echo ""
echo "Steps to run the migration:"
echo ""
echo "1. The SQL has been copied to your clipboard!"
echo "2. Open Supabase Dashboard: https://supabase.com/dashboard"
echo "3. Select your 'sortingapp' project"
echo "4. Click 'SQL Editor' in the left sidebar"
echo "5. Click 'New Query'"
echo "6. Press Cmd+V (or Ctrl+V) to paste the SQL"
echo "7. Click 'Run' or press Cmd+Enter"
echo ""
echo "Copying SQL to clipboard..."

# Copy the SQL file to clipboard (macOS)
cat supabase/migrations/categories.sql | pbcopy

echo ""
echo "✅ SQL copied to clipboard!"
echo ""
echo "After running the migration, refresh your app and click"
echo "'🏷️ Manage Categories' to see the default categories."
echo ""
echo "================================================"
