import { supabase } from './supabase';
import { log } from './debugLogger';

/**
 * descriptionSettings — per-workspace control over how the generated listing
 * description is formatted (the rule-based text engine in textAIService).
 *
 * Stored as a JSONB column on organizations (org_description_settings.sql).
 * Org owners/admins edit it in the Workspace panel; existing RLS already
 * covers it (members SELECT their org, admins UPDATE it). Every field has a
 * default matching today's output, so a missing column, missing row, or empty
 * object produces byte-identical descriptions (locked by the golden test).
 */

export interface DescriptionSettings {
  /** Symbol prefixed to the SIZE / measurement lines. */
  measurementPrefix: string;
  /** Line shown above Condition (garment prep disclosure). Empty = omitted. */
  washingLine: string;
  /** Call-to-action line near the end. Empty = omitted. */
  closingLine: string;
  /** Append #hashtags built from the tags. */
  includeHashtags: boolean;
  /** Closing disclaimer lines, one per array entry. Empty array = omitted. */
  disclaimerLines: string[];
  /** The shop/reseller name written to the Shopify CSV Vendor column.
   *  Empty → App falls back to the workspace name ("C&D Vintage" for the
   *  Founding Workspace). This is the SELLER, not the garment's brand. */
  vendorName: string;
}

export const DEFAULT_DESCRIPTION_SETTINGS: DescriptionSettings = {
  measurementPrefix: '✠',
  washingLine: 'Every Garment goes through a thorough washing process before being photographed.',
  closingLine: 'BUNDLE AND SAVE!!!!!!',
  includeHashtags: true,
  vendorName: '',
  disclaimerLines: [
    '* We note major imperfections—minor signs of age or wear may not be listed, adding to the vintage character.',
    '* High-quality piece, perfect for streetwear.',
    '* Ships next day.',
    '* All sales final.',
  ],
};

/** Merge a stored partial over the defaults (tolerates old/missing keys). */
export function resolveDescriptionSettings(partial?: Partial<DescriptionSettings> | null): DescriptionSettings {
  return { ...DEFAULT_DESCRIPTION_SETTINGS, ...(partial ?? {}) };
}

/** The org's settings, defaults when unset. Fails soft to defaults if the
 *  migration hasn't been run (missing column) or anything else goes wrong. */
export async function getOrgDescriptionSettings(orgId: string): Promise<DescriptionSettings> {
  try {
    const { data, error } = await supabase
      .from('organizations')
      .select('description_settings')
      .eq('id', orgId)
      .maybeSingle();
    if (error) {
      log.service(`getOrgDescriptionSettings | defaults (${error.code ?? ''} ${error.message})`);
      return { ...DEFAULT_DESCRIPTION_SETTINGS };
    }
    return resolveDescriptionSettings((data?.description_settings ?? null) as Partial<DescriptionSettings> | null);
  } catch (err) {
    log.error(`getOrgDescriptionSettings | unexpected: ${String(err)}`);
    return { ...DEFAULT_DESCRIPTION_SETTINGS };
  }
}

/** Save the org's settings (admin/owner only — organizations UPDATE RLS). */
export async function saveOrgDescriptionSettings(
  orgId: string,
  settings: DescriptionSettings,
): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await supabase
    .from('organizations')
    .update({ description_settings: settings })
    .eq('id', orgId)
    .select('id');
  if (error) {
    log.error(`saveOrgDescriptionSettings | ${error.message}`);
    if (error.code === '42703') return { ok: false, error: 'The description settings migration has not been run yet.' };
    return { ok: false, error: error.message };
  }
  if (!data || data.length === 0) return { ok: false, error: 'You do not have permission to change workspace settings.' };
  return { ok: true };
}
