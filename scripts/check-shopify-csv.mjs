#!/usr/bin/env node
/**
 * check-shopify-csv — pre-flight validate a Shopify product import CSV.
 *
 *   node scripts/check-shopify-csv.mjs ~/Downloads/shopify-products-YYYY-MM-DD.csv
 *
 * Catches the failure mode that killed 240 of 263 products on 2026-07-27:
 *
 *   "Validation failed: Owner subtype does not match the metafield
 *    definition's constraints."
 *
 * Shopify's standard metafields (shopify.color-pattern / fabric / target-gender)
 * are scoped BY product category. If "Product Category" holds a path Shopify
 * can't resolve — or is blank — those metafields have no valid owner subtype and
 * the ENTIRE product is rejected. Products that happen to have all three blank
 * squeak through with only a category warning, which is why a broken export can
 * still look partially successful.
 *
 * Exit code 0 = safe to upload, 1 = problems found. No dependencies.
 */

import { readFileSync } from 'node:fs';

// Mirrors KNOWN_TAXONOMY_PATHS in src/lib/csvExport.ts. Keep in sync if the maps
// there change — the invariant test in csvExport.test.ts guards the app side.
const VALID_PATHS = [
  "Apparel & Accessories > Clothing > Baby & Children's Clothing",
  "Apparel & Accessories > Clothing > Baby & Children's Clothing > Baby & Children's Bottoms",
  "Apparel & Accessories > Clothing > Baby & Children's Clothing > Baby & Children's Bottoms > Jeans",
  "Apparel & Accessories > Clothing > Baby & Children's Clothing > Baby & Children's Bottoms > Joggers",
  "Apparel & Accessories > Clothing > Baby & Children's Clothing > Baby & Children's Bottoms > Leggings",
  "Apparel & Accessories > Clothing > Baby & Children's Clothing > Baby & Children's Dresses",
  "Apparel & Accessories > Clothing > Baby & Children's Clothing > Baby & Children's Outerwear",
  "Apparel & Accessories > Clothing > Baby & Children's Clothing > Baby & Children's Outerwear > Baby & Children's Coats & Jackets",
  "Apparel & Accessories > Clothing > Baby & Children's Clothing > Baby & Children's Tops",
  "Apparel & Accessories > Clothing > Baby & Children's Clothing > Baby & Children's Tops > Hoodies",
  "Apparel & Accessories > Clothing > Baby & Children's Clothing > Baby & Children's Tops > Shirts",
  "Apparel & Accessories > Clothing > Baby & Children's Clothing > Baby & Children's Tops > Sweatshirts",
  "Apparel & Accessories > Clothing > Baby & Children's Clothing > Baby & Children's Tops > T-Shirts",
  'Apparel & Accessories > Clothing > Clothing Tops',
  'Apparel & Accessories > Clothing > Clothing Tops > Bodysuits',
  'Apparel & Accessories > Clothing > Clothing Tops > Cardigans',
  'Apparel & Accessories > Clothing > Clothing Tops > Hoodies',
  'Apparel & Accessories > Clothing > Clothing Tops > Polos',
  'Apparel & Accessories > Clothing > Clothing Tops > Shirts',
  'Apparel & Accessories > Clothing > Clothing Tops > Sweaters',
  'Apparel & Accessories > Clothing > Clothing Tops > Sweatshirts',
  'Apparel & Accessories > Clothing > Clothing Tops > T-Shirts',
  'Apparel & Accessories > Clothing > Dresses',
  'Apparel & Accessories > Clothing > Outerwear > Coats & Jackets',
  'Apparel & Accessories > Clothing > Pants',
  'Apparel & Accessories > Clothing > Pants > Chinos',
  'Apparel & Accessories > Clothing > Pants > Jeans',
  'Apparel & Accessories > Clothing > Pants > Joggers',
  'Apparel & Accessories > Clothing > Pants > Leggings',
  'Apparel & Accessories > Clothing > Pants > Trousers',
  'Apparel & Accessories > Clothing > Shorts',
  'Apparel & Accessories > Clothing > Skirts',
  'Apparel & Accessories > Clothing Accessories',
  "Apparel & Accessories > Clothing Accessories > Baby & Children's Clothing Accessories",
  "Apparel & Accessories > Clothing Accessories > Baby & Children's Clothing Accessories > Baby & Children's Hats",
  'Apparel & Accessories > Clothing Accessories > Hats',
  'Apparel & Accessories > Clothing Accessories > Hats > Baseball Caps',
  'Apparel & Accessories > Clothing Accessories > Hats > Beanies',
  'Apparel & Accessories > Shoes',
  "Apparel & Accessories > Shoes > Baby & Children's Shoes",
  "Apparel & Accessories > Shoes > Baby & Children's Shoes > Baby & Children's Boots",
  "Apparel & Accessories > Shoes > Baby & Children's Shoes > Baby & Children's Sneakers",
  'Apparel & Accessories > Shoes > Boots',
  'Apparel & Accessories > Shoes > Sneakers',
];

const norm = s => s.split('>').map(x => x.trim()).filter(Boolean).join(' > ').toLowerCase();
const VALID = new Set(VALID_PATHS.map(norm));

/** Minimal RFC4180 parser — handles quoted fields, embedded commas/newlines/"" . */
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const file = process.argv[2];
if (!file) {
  console.error('usage: node scripts/check-shopify-csv.mjs <export.csv>');
  process.exit(2);
}

const rows = parseCsv(readFileSync(file, 'utf8').replace(/^﻿/, ''));
if (!rows.length) { console.error('empty file'); process.exit(2); }

const head = rows[0];
const col = name => head.indexOf(name);
const iTitle = col('Title');
const iCat = col('Product Category');
const iHandle = col('Handle');
const iPrice = col('Variant Price');
const scoped = [
  ['Color', col('Color (product.metafields.shopify.color-pattern)')],
  ['Fabric', col('Fabric (product.metafields.shopify.fabric)')],
  ['Gender', col('Target gender (product.metafields.shopify.target-gender)')],
].filter(([, i]) => i >= 0);

if (iTitle < 0 || iCat < 0) {
  console.error('not a Shopify product CSV (missing Title / Product Category)');
  process.exit(2);
}

const willFail = [], warnOnly = [], noPrice = [];
let products = 0;

rows.slice(1).forEach((r, n) => {
  if (!r[iTitle]?.trim()) return; // continuation row (extra image)
  products++;
  const line = n + 2;
  const cat = (r[iCat] || '').trim();
  const catOk = cat !== '' && VALID.has(norm(cat));
  const set = scoped.filter(([, i]) => (r[i] || '').trim()).map(([n2]) => n2);
  const price = parseFloat(r[iPrice] || '');

  if (!catOk && set.length) willFail.push({ line, handle: r[iHandle], cat, set });
  else if (!catOk) warnOnly.push({ line, handle: r[iHandle], cat });
  if (!(price > 0)) noPrice.push({ line, handle: r[iHandle] });
});

const show = (arr, n = 8) => arr.slice(0, n).forEach(x =>
  console.log(`    line ${x.line}  ${x.handle}` + (x.cat !== undefined ? `\n      category: ${x.cat || '(blank)'}` : '') +
    (x.set ? `\n      metafields set: ${x.set.join(', ')}` : '')));

console.log(`\n${file}\n${products} products\n`);

if (willFail.length) {
  console.log(`✖ ${willFail.length} WILL BE REJECTED — unresolvable category + a category-scoped metafield`);
  console.log(`  → "Owner subtype does not match the metafield definition's constraints"`);
  show(willFail);
  if (willFail.length > 8) console.log(`    …and ${willFail.length - 8} more`);
  console.log();
}
if (warnOnly.length) {
  console.log(`⚠ ${warnOnly.length} will import WITH A WARNING — bad category, but no scoped metafield set`);
  show(warnOnly, 5);
  if (warnOnly.length > 5) console.log(`    …and ${warnOnly.length - 5} more`);
  console.log();
}
if (noPrice.length) {
  console.log(`⚠ ${noPrice.length} have no price (the app's export gate should have blocked these)`);
  show(noPrice, 5);
  console.log();
}
if (!willFail.length && !warnOnly.length && !noPrice.length) {
  console.log('✓ every product has a category Shopify resolves — safe to upload\n');
}

process.exit(willFail.length || warnOnly.length ? 1 : 0);
