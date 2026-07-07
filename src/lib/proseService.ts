import { supabase } from './supabase';
import { log } from './debugLogger';

/**
 * proseService — the model-written selling paragraph (hybrid architecture).
 *
 * The generate-prose Edge Function (Cloudflare Workers AI, open Llama model)
 * writes ONLY the short prose paragraph; the rule-based template engine keeps
 * owning the description skeleton. This module requests the paragraph and
 * VALIDATES it before anyone uses it:
 *   - length bounds (a paragraph, not an essay or a fragment)
 *   - banned phrases (marketing slop and "AI" tells)
 *   - the numbers guard: any digit sequence in the prose must appear somewhere
 *     in the provided facts — a model that invents a measurement is discarded
 * Anything invalid returns null and the caller falls back to today's output.
 */

export const PROSE_BANNED_PHRASES = [
  'as an ai', 'language model', 'i cannot', "i can't", 'i am unable',
  'elevate your wardrobe', 'elevate your style', 'timeless classic',
  'must-have', 'wardrobe staple', 'look no further', 'step up your',
  'make a statement', "don't miss out", 'perfect addition to any',
  'sure to turn heads', 'crafted with care', 'unleash',
];

const MIN_WORDS = 15;
const MAX_WORDS = 120;

/** Validate + clean a model paragraph. Returns the cleaned prose, or null when
 *  it fails any gate (caller falls back to the rule-based output). */
export function validateProse(raw: string | undefined | null, allowedFacts: string[]): string | null {
  if (!raw) return null;
  const prose = raw.replace(/\s*\n+\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();
  if (!prose) return null;

  const wordCount = prose.split(/\s+/).length;
  if (wordCount < MIN_WORDS || wordCount > MAX_WORDS) return null;

  const lower = prose.toLowerCase();
  if (PROSE_BANNED_PHRASES.some(p => lower.includes(p))) return null;
  if (/[#@]|https?:\/\//.test(prose)) return null; // no hashtags/handles/links

  // Numbers guard: every digit sequence must exist somewhere in the facts.
  const factBlob = allowedFacts.filter(Boolean).join(' ').toLowerCase();
  const numbers = prose.match(/\d+(?:\.\d+)?/g) ?? [];
  for (const n of numbers) {
    if (!factBlob.includes(n)) return null;
  }

  return prose;
}

/** Ask the Edge Function for a selling paragraph. Best-effort: any error,
 *  missing secrets, or invalid output → null (silent fallback). */
export async function requestProse(
  fields: Record<string, string | undefined>,
  style: string | undefined,
): Promise<string | null> {
  const cleanFields: Record<string, string> = {};
  for (const [k, v] of Object.entries(fields)) {
    const val = (v ?? '').trim();
    if (val) cleanFields[k] = val;
  }
  if (Object.keys(cleanFields).length === 0) return null;

  try {
    const { data, error } = await supabase.functions.invoke('generate-prose', {
      body: { fields: cleanFields, style: style?.trim() || undefined },
    });
    if (error || !data?.prose) {
      log.service(`requestProse | unavailable (${error?.message ?? 'no prose'})`);
      return null;
    }
    return validateProse(String(data.prose), Object.values(cleanFields));
  } catch (err) {
    log.error(`requestProse | unexpected: ${String(err)}`);
    return null;
  }
}
