#!/usr/bin/env node
/**
 * npm run brand:apply
 *
 * Reads brand.json and rewrites the brand name in every static file that
 * cannot import src/brand.ts. Each replacement is a targeted regex anchored on
 * its tag, attribute or key, so nothing else in a file is touched, and the
 * script is idempotent: on an already-applied tree it changes nothing.
 *
 * It never touches identifiers (the arcadian.ltd URLs, appId ltd.arcadian.app,
 * android package_name / custom_url_scheme, sortbot_* keys) or artwork
 * (assets/, public/favicon.svg, icons, splash, og.png; those are
 * `npm run assets:generate`).
 *
 * Info.plist is edited by regex on the <key>, not plutil, because plutil
 * re-serialises the whole file and does not exist on the Linux CI runners.
 * CFBundleName is left alone: it is $(PRODUCT_NAME), the Xcode target name.
 *
 * Usage: node scripts/apply-brand.mjs [--root <dir>] [--check]
 *   --root   tree to rewrite (default: the repo root). brand.json is read from it.
 *   --check  report what would change and exit 1 if anything would, write nothing.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const rootIdx = args.indexOf('--root');
const ROOT = rootIdx >= 0 ? resolve(args[rootIdx + 1]) : resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = args.includes('--check');

const brand = JSON.parse(readFileSync(join(ROOT, 'brand.json'), 'utf8'));
for (const k of ['name', 'tagline', 'landingTitle', 'mark']) {
  if (typeof brand[k] !== 'string' || !brand[k].trim()) {
    console.error(`brand.json: "${k}" must be a non-empty string`);
    process.exit(2);
  }
}

/** Escape for HTML/XML text and attribute values. */
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** Escape for a single-quoted JS/YAML string. */
const sq = (s) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

const name = esc(brand.name);
const tagline = esc(brand.tagline);
const landingTitle = esc(brand.landingTitle);
const ogAlt = esc(`The ${brand.name} logo: a black ${brand.mark} tile beside the word ${brand.name}.`);

/** Replace the value of <meta (name|property)="key" content="…">. */
const meta = (attr, key, value) => [
  new RegExp(`(<meta\\s+${attr}="${key.replace(/[.:]/g, '\\$&')}"\\s+content=")[^"]*(")`, 'g'),
  value,
  `${attr}=${key}`,
];

/** file -> list of [regex, value, label]. Each regex captures (open)(close) around the value it replaces, so the anchors are kept and a "$" in the brand is literal. */
const RULES = {
  'index.html': [
    [/(<title>)[^<]*(<\/title>)/g, name, '<title>'],
    meta('name', 'description', tagline),
    meta('property', 'og:site_name', name),
    meta('property', 'og:title', landingTitle),
    meta('property', 'og:description', tagline),
    meta('property', 'og:image:alt', ogAlt),
    meta('name', 'twitter:title', landingTitle),
    meta('name', 'twitter:description', tagline),
  ],
  'public/site.webmanifest': [
    [/("name"\s*:\s*")[^"]*(")/, brand.name.replace(/"/g, '\\"'), 'name'],
    [/("short_name"\s*:\s*")[^"]*(")/, brand.name.replace(/"/g, '\\"'), 'short_name'],
  ],
  'public/beta.html': [
    [/(<title>)[^<]*(<\/title>)/g, name, '<title>'],
    [/(<a href="\.\/">)[^<]*(<\/a>)/g, name, 'redirect link'],
  ],
  'capacitor.config.ts': [
    [/(\bappName:\s*')(?:[^'\\]|\\.)*(')/, sq(brand.name), 'appName'],
  ],
  'ios/App/App/Info.plist': [
    [/(<key>CFBundleDisplayName<\/key>\s*<string>)[^<]*(<\/string>)/, name, 'CFBundleDisplayName'],
    // Permission prompts open with the app name ("X uses the camera …"): swap the words before the verb.
    [/(<key>NS\w+UsageDescription<\/key>\s*<string>)[^<]*?(\s(?:uses|reads|turns|needs|records|scans)\s)/g, name, 'NS*UsageDescription'],
  ],
  'android/app/src/main/res/values/strings.xml': [
    [/(<string name="app_name">)[^<]*(<\/string>)/, name, 'app_name'],
    [/(<string name="title_activity_main">)[^<]*(<\/string>)/, name, 'title_activity_main'],
  ],
  // The deploy smoke test / uptime probe assert the built <title>.
  '.github/workflows/ci.yml': [
    [/(<title>)[^<]*(<\/title>)/g, name, '<title> assertion'],
  ],
  '.github/workflows/uptime.yml': [
    [/(<title>)[^<]*(<\/title>)/g, name, '<title> probe'],
  ],
  '.github/workflows/deploy.yml': [
    [/(<title>)[^<]*(<\/title>)/g, name, '<title> check'],
  ],
};

let changed = 0;
for (const [rel, rules] of Object.entries(RULES)) {
  const file = join(ROOT, rel);
  if (!existsSync(file)) {
    console.log(`skip     ${rel} (not found)`);
    continue;
  }
  const before = readFileSync(file, 'utf8');
  let after = before;
  const labels = [];
  for (const [re, value, label] of rules) {
    const next = after.replace(re, (_m, open, close) => open + value + close);
    if (next !== after) labels.push(label);
    after = next;
  }
  if (after === before) {
    console.log(`ok       ${rel}`);
    continue;
  }
  changed++;
  console.log(`${CHECK ? 'stale   ' : 'updated '} ${rel} (${labels.join(', ')})`);
  if (!CHECK) writeFileSync(file, after);
}

console.log(changed ? `${CHECK ? 'would update' : 'updated'} ${changed} file(s) for "${brand.name}"` : `all static files already say "${brand.name}"`);
if (CHECK && changed) process.exit(1);
