-- Migration: Add applied_preset_id column to products table
-- This persists which category preset was last applied to each product,
-- so that on reload the correct preset label is shown (e.g. "Mens Sweatshirts"
-- instead of "Kids Sweatshirts") even when multiple presets share the same
-- product_type value.
--
-- Run this in your Supabase SQL editor before deploying the code changes.

ALTER TABLE products ADD COLUMN IF NOT EXISTS applied_preset_id text;
