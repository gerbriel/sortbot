/**
 * GLOBAL MARKETPLACE VOCABULARY — seed generator.
 *
 * Reads each adapter's OWN colour and condition lists (src/lib/marketplaces)
 * plus the app's colour database and prints SQL that inserts GLOBAL rows
 * (org_id NULL) into public.marketplace_vocab, one per (marketplace, kind,
 * canonical). Nothing here talks to a database: the founder runs the output
 * in the Supabase SQL Editor as `postgres`, which is the house rule for every
 * write the client cannot make (global rows are is_beta_admin()-gated).
 *
 *   npm run seed:vocab        → supabase/seeds/marketplace_vocab.sql
 *
 * Re-run whenever an adapter's list changes; the SQL is `on conflict do
 * nothing`, so a founder's hand edits to an existing row survive.
 *
 * WHAT IS SEEDED
 *   color      every colour name and alias in COLOR_DNA → the closest word in a
 *              marketplace's fixed colour list (only the marketplaces that have
 *              one). Identity rows are skipped: the adapter already matches a
 *              canonical that equals a list value.
 *   condition  free-text phrasings the normaliser (conditions.ts) does not
 *              read → each marketplace's word for that grade, through the
 *              adapter's own condition map.
 *   brand      NOT seeded, deliberately: no marketplace publishes its brand
 *              picker, so any seed would be a guess that silences the "not
 *              confirmed" warning without confirming anything.
 */
import { COLOR_DNA } from '../src/lib/colorDatabase';
import { MARKETPLACE_KEYS, type ConditionGrade, type MarketplaceKey, type MarketplaceSpec } from '../src/lib/marketplaces/types';
import { spec as shopify } from '../src/lib/marketplaces/shopify';
import { spec as ebay } from '../src/lib/marketplaces/ebay';
import { spec as etsy } from '../src/lib/marketplaces/etsy';
import { spec as poshmark } from '../src/lib/marketplaces/poshmark';
import { spec as mercari } from '../src/lib/marketplaces/mercari';
import { spec as grailed } from '../src/lib/marketplaces/grailed';
import { spec as depop } from '../src/lib/marketplaces/depop';
import { spec as facebook } from '../src/lib/marketplaces/facebook';
import { spec as vinted } from '../src/lib/marketplaces/vinted';
import { spec as whatnot } from '../src/lib/marketplaces/whatnot';

const SPECS: Record<MarketplaceKey, MarketplaceSpec> = {
  shopify, ebay, etsy, poshmark, mercari, grailed, depop, facebook, vinted, whatnot,
};

/**
 * Which marketplace words a canonical colour may become, best first. The
 * generator takes the FIRST candidate that exists in a marketplace's list, so
 * one table serves every marketplace. Spelling variants (Gray/Grey) are both
 * listed; the comparison is case-insensitive anyway.
 */
const COLOR_CANDIDATES: Record<string, string[]> = {
  'black': ['Black'], 'jet black': ['Black'],
  'charcoal': ['Charcoal', 'Gray', 'Grey', 'Black'],
  'gray': ['Gray', 'Grey'], 'heather gray': ['Gray', 'Grey'],
  'silver': ['Silver', 'Gray', 'Grey'],
  'white': ['White'], 'ecru': ['Cream', 'Beige', 'White'], 'cream': ['Cream', 'Beige', 'White'],
  'stone': ['Beige', 'Tan', 'Gray', 'Grey'],
  'red': ['Red'], 'crimson': ['Red'], 'scarlet': ['Red'], 'cherry red': ['Red'],
  'burgundy': ['Burgundy', 'Red'], 'maroon': ['Burgundy', 'Red'],
  'rust': ['Rust', 'Orange', 'Brown'], 'burnt orange': ['Orange'], 'terracotta': ['Orange', 'Brown'],
  'orange': ['Orange'], 'neon orange': ['Orange'], 'coral': ['Coral', 'Orange', 'Pink'],
  'salmon': ['Coral', 'Pink', 'Orange'], 'peach': ['Peach', 'Orange', 'Pink'],
  'yellow': ['Yellow'], 'mustard': ['Mustard', 'Yellow'], 'gold': ['Gold', 'Yellow'],
  'green': ['Green'], 'forest green': ['Green'], 'kelly green': ['Green'], 'neon green': ['Green'],
  'mint': ['Mint', 'Green'], 'sage': ['Green'], 'olive': ['Khaki', 'Olive', 'Green'],
  'blue': ['Blue'], 'royal blue': ['Blue'], 'carolina blue': ['Blue'], 'light blue': ['Blue'],
  'sky blue': ['Blue'], 'denim': ['Blue'], 'indigo': ['Navy', 'Blue'], 'navy': ['Navy', 'Blue'],
  'teal': ['Turquoise', 'Teal', 'Blue', 'Green'], 'cyan': ['Turquoise', 'Blue'],
  'purple': ['Purple'], 'lavender': ['Purple'], 'lilac': ['Purple'], 'mauve': ['Purple', 'Pink'],
  'pink': ['Pink'], 'hot pink': ['Pink'], 'blush': ['Pink'],
  'brown': ['Brown'], 'chocolate': ['Brown'], 'caramel': ['Brown', 'Tan'],
  'tan': ['Tan', 'Beige', 'Brown'], 'beige': ['Beige', 'Tan', 'Cream'], 'taupe': ['Beige', 'Tan', 'Brown'],
  'camel': ['Tan', 'Beige', 'Brown'],
  'tie dye': ['Multi', 'Multicolor', 'Multicolour'], 'camo': ['Multi', 'Green'], 'plaid': ['Multi', 'Multicolor'],
};

/**
 * Condition phrasings the normaliser does not read (conditions.ts handles
 * "nwt", "excellent", "8/10" and friends itself; these are the looser ones a
 * seller actually says). All lower-case; the resolver lower-cases the lookup.
 */
const CONDITION_PHRASES: Record<ConditionGrade, string[]> = {
  new_with_tags: ['sealed', 'still in packaging', 'store fresh', 'unworn with tags'],
  new_without_tags: ['unworn', 'never worn', 'bnwot', 'never used', 'brand new no tags'],
  excellent: ['flawless', 'pristine', 'immaculate', 'barely worn', 'worn once', 'like brand new'],
  good: ['some wear', 'light wear', 'minor wear', 'gently worn', 'lightly worn', 'normal wear', 'good shape'],
  fair: ['decent', 'okay', 'ok condition', 'average', 'played', 'well worn', 'visible wear', 'shows wear'],
  poor: ['beat up', 'kinda beat up', 'thrashed', 'rough', 'well loved', 'lived in', 'trashed', 'wrecked', 'heavy wear', 'heavily worn'],
};

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
const q = (s: string) => `'${s.replace(/'/g, "''")}'`;

interface Row { marketplace: MarketplaceKey; kind: 'color' | 'condition'; canonical: string; value: string }
const rows: Row[] = [];
const seen = new Set<string>();
const add = (r: Row) => {
  const key = `${r.marketplace}|${r.kind}|${norm(r.canonical)}`;
  if (seen.has(key)) return;
  seen.add(key);
  rows.push(r);
};

// ── colours ─────────────────────────────────────────────────────────────────
for (const key of MARKETPLACE_KEYS) {
  const list = SPECS[key].color.values;
  if (!list || list.length === 0) continue;                     // free-text colour: nothing to map
  const byNorm = new Map(list.map(v => [norm(v), v]));
  for (const [name, dna] of Object.entries(COLOR_DNA)) {
    const candidates = COLOR_CANDIDATES[name];
    if (!candidates) continue;                                    // an unlisted colour is a warning, not a guess
    const hit = candidates.map(c => byNorm.get(norm(c))).find(Boolean);
    if (!hit) continue;                                           // this marketplace has no word for it → fallback + warning
    for (const canonical of [name, ...(dna.aliases ?? [])]) {
      if (norm(canonical) === norm(hit)) continue;                // identity — the adapter matches the list itself
      add({ marketplace: key, kind: 'color', canonical, value: hit });
    }
  }
}

// ── conditions ──────────────────────────────────────────────────────────────
for (const key of MARKETPLACE_KEYS) {
  const map = SPECS[key].condition.map;
  for (const grade of Object.keys(CONDITION_PHRASES) as ConditionGrade[]) {
    const value = map[grade];
    if (!value) continue;
    for (const phrase of CONDITION_PHRASES[grade]) add({ marketplace: key, kind: 'condition', canonical: phrase, value });
  }
}

// ── SQL ─────────────────────────────────────────────────────────────────────
const byMarketplace = new Map<MarketplaceKey, Row[]>();
for (const r of rows) byMarketplace.set(r.marketplace, [...(byMarketplace.get(r.marketplace) ?? []), r]);

const out: string[] = [];
out.push('-- GLOBAL marketplace vocabulary — GENERATED by scripts/seed-marketplace-vocab.ts.');
out.push('-- Do not hand-edit: change the adapter lists or the generator and re-run `npm run seed:vocab`.');
out.push('-- Run in the Supabase SQL Editor as postgres, AFTER supabase/migrations/marketplaces.sql.');
out.push("-- Rows are GLOBAL (org_id NULL) and `on conflict do nothing`, so a founder's edit to an");
out.push('-- existing row is never overwritten. Safe to re-run.');
out.push(`-- ${rows.length} rows: ${[...byMarketplace.entries()].map(([k, v]) => `${k} ${v.length}`).join(', ')}.`);
out.push('');
out.push('begin;');
for (const [key, list] of byMarketplace) {
  out.push('');
  out.push(`-- ${SPECS[key].name}`);
  out.push('insert into public.marketplace_vocab (org_id, marketplace, kind, canonical, marketplace_value) values');
  out.push(list.map((r, i) => `  (null, ${q(r.marketplace)}, ${q(r.kind)}, ${q(r.canonical)}, ${q(r.value)})${i === list.length - 1 ? '' : ','}`).join('\n'));
  out.push('on conflict (coalesce(org_id, \'00000000-0000-0000-0000-000000000000\'::uuid), marketplace, kind, lower(public.marketplace_vocab_trim(canonical))) do nothing;');
}
out.push('');
out.push('commit;');
out.push('');
out.push('-- VERIFY');
out.push("-- select marketplace, kind, count(*) from public.marketplace_vocab where org_id is null group by 1, 2 order by 1, 2;");
process.stdout.write(out.join('\n') + '\n');
