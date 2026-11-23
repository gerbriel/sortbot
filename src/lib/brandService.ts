/**
 * The founder's write half of the runtime brand (070_runtime_brand.sql).
 * The read half, and the store every screen renders from, is brandStore.ts.
 *
 * `founding_set_brand(p_name, p_descriptor, p_tagline)` is founding admins only
 * and answers the new `public_brand()` payload, which is applied to the store
 * at once so the founder's own screens change on Save.
 *
 * Errors map the usageService way: a missing function is 'unavailable' (the
 * console shows "Run 070_runtime_brand.sql"), 42501 is 'forbidden', anything
 * else (22023 from the length checks included) is 'error' with the message.
 */
import { supabase } from './supabase';
import { log } from './debugLogger';
import { applyRemoteBrand, getBrand, BRAND_NAME_MAX, BRAND_TEXT_MAX, type RuntimeBrand } from './brandStore';

export type BrandSaveResult =
  | { status: 'ok'; brand: RuntimeBrand }
  | { status: 'unavailable' }
  | { status: 'forbidden' }
  | { status: 'error'; message: string };

const MISSING = new Set(['42883', 'PGRST202', 'PGRST302']);

export interface BrandDraft {
  name: string;
  descriptor: string;
  tagline: string;
}

/** Client-side mirror of the 070 checks, so Save can be disabled with a reason. */
export function validateBrandDraft(d: BrandDraft): string | null {
  const name = d.name.trim();
  if (!name) return 'The name cannot be empty.';
  if (name.length > BRAND_NAME_MAX) return `The name can be at most ${BRAND_NAME_MAX} characters.`;
  if (/[\r\n]/.test(d.name)) return 'The name must be one line.';
  if (d.descriptor.trim().length > BRAND_TEXT_MAX) return `The descriptor can be at most ${BRAND_TEXT_MAX} characters.`;
  if (d.tagline.trim().length > BRAND_TEXT_MAX) return `The tagline can be at most ${BRAND_TEXT_MAX} characters.`;
  if (/[\r\n]/.test(d.descriptor) || /[\r\n]/.test(d.tagline)) return 'The descriptor and tagline must be one line each.';
  return null;
}

/**
 * Is 070 installed? One `public_brand()` read, applied to the store on the way
 * (it is the same answer hydrateBrand would get). For the console's setup line.
 */
export async function probeBrand(): Promise<'ok' | 'unavailable' | 'error'> {
  const { data, error } = await supabase.rpc('public_brand');
  if (error) return error.code && MISSING.has(error.code) ? 'unavailable' : 'error';
  applyRemoteBrand(data);
  return 'ok';
}

export async function saveBrand(d: BrandDraft): Promise<BrandSaveResult> {
  const { data, error } = await supabase.rpc('founding_set_brand', {
    p_name: d.name.trim(),
    p_descriptor: d.descriptor.trim(),
    p_tagline: d.tagline.trim(),
  });
  if (error) {
    if (error.code && MISSING.has(error.code)) {
      log.db(`brandService | founding_set_brand unavailable (${error.code})`);
      return { status: 'unavailable' };
    }
    if (error.code === '42501') return { status: 'forbidden' };
    log.error(`brandService | founding_set_brand | ${error.code ?? ''} ${error.message}`);
    return { status: 'error', message: error.message || 'Something went wrong.' };
  }
  if (!applyRemoteBrand(data)) {
    return { status: 'error', message: 'Saved, but the server answered something unexpected. Reload to see the new name.' };
  }
  return { status: 'ok', brand: getBrand() };
}
