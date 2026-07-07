import { BRAND_DNA } from './vintagePatternEngine';
import { BRAND_DNA_EXPANSION } from './vintagePatternExpansion';
import { BRAND_DNA_EXPANSION_2 } from './vintagePatternExpansion2';
import { BRAND_DNA_EXPANSION_3 } from './vintagePatternExpansion3';
import { BRAND_DNA_EXPANSION_4 } from './vintagePatternExpansion4';

/**
 * builtinBrandVocab — the hardcoded 5,000+ brand knowledge base (BRAND_DNA +
 * its four expansions) distilled into the vocab library's brand → keywords
 * shape, so founders can browse it in the Vocabulary dashboard and copy any
 * brand into the editable brand_keywords table with one click.
 *
 * ONLY the `vibes` + `subculture` fields are used as keywords — they're
 * tag-quality words ("workwear", "skate", "americana"). The raw `keywords`
 * field is deliberately excluded: it's matching bait (player names, stadium
 * nicknames, logo descriptions) that would pollute hashtags.
 *
 * IMPORTANT: import this module DYNAMICALLY (await import(...)). Nothing else
 * in the app imports the BRAND_DNA files — pulling them statically into a
 * main-bundle module would add several hundred KB for a founder-only feature.
 */

export interface BuiltinBrandEntry {
  brand: string;       // display/title case
  keywords: string[];  // deduped, lowercased vibes + subculture
}

const toTitleCase = (s: string): string =>
  s.replace(/\b\w/g, c => c.toUpperCase());

const MAX_KEYWORDS_PER_BRAND = 10;

let cache: BuiltinBrandEntry[] | null = null;

export function getBuiltinBrandVocab(): BuiltinBrandEntry[] {
  if (cache) return cache;

  // Later spreads win on duplicate keys — same merge order as brandMatcher.
  const merged: Record<string, { vibes?: string[]; subculture?: string[] }> = {
    ...BRAND_DNA,
    ...BRAND_DNA_EXPANSION,
    ...BRAND_DNA_EXPANSION_2,
    ...BRAND_DNA_EXPANSION_3,
    ...BRAND_DNA_EXPANSION_4,
  } as Record<string, { vibes?: string[]; subculture?: string[] }>;

  cache = Object.entries(merged)
    .map(([name, dna]) => {
      const words = Array.from(new Set(
        [...(dna.vibes ?? []), ...(dna.subculture ?? [])]
          .map(w => String(w).toLowerCase().trim())
          .filter(Boolean)
      )).slice(0, MAX_KEYWORDS_PER_BRAND);
      return { brand: toTitleCase(name), keywords: words };
    })
    .filter(e => e.keywords.length > 0)
    .sort((a, b) => a.brand.localeCompare(b.brand));

  return cache;
}
