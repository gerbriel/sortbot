import { supabase } from './supabase';
import { log } from './debugLogger';

/**
 * vocabService — founder-curated global vocabulary.
 *
 * Two tables (vocab_tables.sql): descriptor_chips (Step 3 quick-keyword chips)
 * and brand_keywords (words merged into generated tags when the item's brand
 * matches). READ is open to every signed-in user in every workspace; WRITE is
 * Founding Workspace owners/admins only (RLS via is_beta_admin()).
 *
 * FORWARD-COMPATIBLE: every fetch fails soft. If the migration hasn't been
 * run, chips fall back to the hardcoded list in ProductDescriptionGenerator
 * and brand terms are simply absent.
 */

export interface DescriptorChip {
  id: string;
  label: string;
  output_text: string | null; // what gets inserted; null → label
  sort_order: number;
  is_active: boolean;
}

export interface BrandKeywordRow {
  id: string;
  brand: string;
  keywords: string[];
  is_active: boolean;
}

// ── Descriptor chips ────────────────────────────────────────────────────────

/** Active chips for Step 3, sorted. 'unavailable' → caller uses its fallback list. */
export async function fetchActiveChips(): Promise<{ status: 'ok'; chips: DescriptorChip[] } | { status: 'unavailable' }> {
  try {
    const { data, error } = await supabase
      .from('descriptor_chips')
      .select('id, label, output_text, sort_order, is_active')
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .order('label', { ascending: true });
    if (error) {
      log.service(`fetchActiveChips | unavailable (${error.code ?? ''} ${error.message})`);
      return { status: 'unavailable' };
    }
    return { status: 'ok', chips: (data ?? []) as DescriptorChip[] };
  } catch (err) {
    log.error(`fetchActiveChips | unexpected: ${String(err)}`);
    return { status: 'unavailable' };
  }
}

/** ALL chips (inactive included) for the founder dashboard. */
export async function fetchAllChips(): Promise<DescriptorChip[]> {
  const { data, error } = await supabase
    .from('descriptor_chips')
    .select('id, label, output_text, sort_order, is_active')
    .order('sort_order', { ascending: true })
    .order('label', { ascending: true });
  if (error) { log.error(`fetchAllChips | ${error.message}`); return []; }
  return (data ?? []) as DescriptorChip[];
}

export async function createChip(label: string, outputText?: string, sortOrder?: number): Promise<{ ok: boolean; error?: string }> {
  const cleaned = label.trim().toLowerCase();
  if (!cleaned) return { ok: false, error: 'Chip label cannot be empty.' };
  const { error } = await supabase.from('descriptor_chips').insert({
    label: cleaned,
    output_text: outputText?.trim() || null,
    ...(sortOrder !== undefined ? { sort_order: sortOrder } : {}),
  });
  if (error) {
    if (error.code === '23505') return { ok: false, error: `"${cleaned}" already exists.` };
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

export async function updateChip(
  id: string,
  patch: Partial<Pick<DescriptorChip, 'label' | 'output_text' | 'sort_order' | 'is_active'>>,
): Promise<{ ok: boolean; error?: string }> {
  const cleaned = { ...patch };
  if (cleaned.label !== undefined) cleaned.label = cleaned.label.trim().toLowerCase();
  if (cleaned.output_text !== undefined) cleaned.output_text = cleaned.output_text?.trim() || null;
  const { data, error } = await supabase
    .from('descriptor_chips').update(cleaned).eq('id', id).select('id');
  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) return { ok: false, error: 'No permission to edit the vocabulary.' };
  return { ok: true };
}

export async function deleteChip(id: string): Promise<boolean> {
  const { error } = await supabase.from('descriptor_chips').delete().eq('id', id);
  if (error) { log.error(`deleteChip | ${error.message}`); return false; }
  return true;
}

// ── Brand keywords ──────────────────────────────────────────────────────────

/** Founder-curated words for ONE brand (case-insensitive), for tag generation. */
export async function getBrandTerms(brand: string | undefined): Promise<string[]> {
  const cleaned = (brand ?? '').trim();
  if (!cleaned) return [];
  try {
    const { data, error } = await supabase
      .from('brand_keywords')
      .select('keywords, is_active')
      .ilike('brand', cleaned)
      .limit(1);
    if (error || !data || data.length === 0) return [];
    const row = data[0] as { keywords: string[]; is_active: boolean };
    return row.is_active ? (row.keywords ?? []) : [];
  } catch {
    return [];
  }
}

/** ALL brand keyword rows for the founder dashboard. Paginated — PostgREST
 *  caps a single request at 1000 rows and the built-in library alone has 917
 *  importable brands, so one page would silently truncate the list. */
export async function fetchAllBrandKeywords(): Promise<BrandKeywordRow[]> {
  const PAGE = 1000;
  const all: BrandKeywordRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('brand_keywords')
      .select('id, brand, keywords, is_active')
      .order('brand', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) { log.error(`fetchAllBrandKeywords | ${error.message}`); return all; }
    all.push(...((data ?? []) as BrandKeywordRow[]));
    if (!data || data.length < PAGE) break;
  }
  return all;
}

/** Comma/space-separated input → clean keyword array. */
export function parseKeywordList(raw: string): string[] {
  return Array.from(new Set(
    raw.split(',').map(k => k.trim().toLowerCase()).filter(Boolean)
  ));
}

export async function createBrandKeywords(brand: string, keywords: string[]): Promise<{ ok: boolean; error?: string }> {
  const cleaned = brand.trim();
  if (!cleaned) return { ok: false, error: 'Brand name cannot be empty.' };
  if (keywords.length === 0) return { ok: false, error: 'Add at least one keyword.' };
  const { error } = await supabase.from('brand_keywords').insert({ brand: cleaned, keywords });
  if (error) {
    if (error.code === '23505') return { ok: false, error: `"${cleaned}" already has keywords — edit that row instead.` };
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

export async function updateBrandKeywords(
  id: string,
  patch: Partial<Pick<BrandKeywordRow, 'brand' | 'keywords' | 'is_active'>>,
): Promise<{ ok: boolean; error?: string }> {
  const cleaned = { ...patch };
  if (cleaned.brand !== undefined) cleaned.brand = cleaned.brand.trim();
  const { data, error } = await supabase
    .from('brand_keywords').update(cleaned).eq('id', id).select('id');
  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) return { ok: false, error: 'No permission to edit the vocabulary.' };
  return { ok: true };
}

export async function deleteBrandKeywords(id: string): Promise<boolean> {
  const { error } = await supabase.from('brand_keywords').delete().eq('id', id);
  if (error) { log.error(`deleteBrandKeywords | ${error.message}`); return false; }
  return true;
}
