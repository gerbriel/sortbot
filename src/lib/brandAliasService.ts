import { supabase } from './supabase';
import { log } from './debugLogger';
import { normalizeBrand, type BrandCandidate } from './brandSpelling';

/**
 * brandAliasService — the `brand_aliases` table (brand_aliases.sql).
 *
 * PER WORKSPACE, WRITABLE BY ANY MEMBER. Unlike descriptor_chips and
 * brand_keywords (founder-only global vocabulary), this is one shop's own record
 * of how its own inventory is spelled, so the whole team maintains it. org_id is
 * never passed from the client — the column DEFAULT plus org RLS place the row.
 *
 * FORWARD-COMPATIBLE, like every other service here: if the migration has not
 * been run, every call reports 'unavailable' and Step 3 simply behaves as it
 * does today. Nothing in the dictation path depends on this table existing.
 */

export interface BrandAlias {
  id: string;
  /** What the recogniser produced, as the lookup key (stored lower-cased). */
  heard: string;
  /** What to write into the brand field instead, in display capitalisation. */
  preferred: string;
  created_by_email: string | null;
  created_at: string;
  updated_at: string;
}

export type AliasFetch =
  | { status: 'ok'; aliases: BrandAlias[] }
  | { status: 'unavailable' };

const SELECT = 'id, heard, preferred, created_by_email, created_at, updated_at';

/** Every alias for the caller's workspace. RLS decides which that is. */
export async function fetchBrandAliases(): Promise<AliasFetch> {
  try {
    const { data, error } = await supabase
      .from('brand_aliases')
      .select(SELECT)
      .order('heard', { ascending: true });
    if (error) {
      log.service(`fetchBrandAliases | unavailable (${error.code ?? ''} ${error.message})`);
      return { status: 'unavailable' };
    }
    return { status: 'ok', aliases: (data ?? []) as BrandAlias[] };
  } catch (err) {
    log.error(`fetchBrandAliases | unexpected: ${String(err)}`);
    return { status: 'unavailable' };
  }
}

/**
 * Remember (or re-point) one correction.
 *
 * Upsert on the misheard phrase, because the button that calls this is a single
 * tap the seller may hit twice, and because re-correcting a phrase to a
 * different brand must replace the old answer rather than fail. `heard` is
 * lower-cased here so it matches the unique index on lower(btrim(heard)) and so
 * the client-side lookup never has to care about case.
 */
export async function saveBrandAlias(
  heard: string,
  preferred: string,
  createdByEmail?: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const h = (heard || '').trim().toLowerCase();
  const p = (preferred || '').trim();
  if (!h) return { ok: false, error: 'Nothing was heard to correct.' };
  if (!p) return { ok: false, error: 'Enter the spelling to use.' };
  if (normalizeBrand(h) === normalizeBrand(p)) {
    return { ok: false, error: 'That is already the spelling being used.' };
  }

  try {
    // Look first so we can UPDATE an existing row: an upsert would need
    // onConflict on an expression index, which PostgREST cannot address, and
    // org_id must never be sent from the client.
    const { data: existing, error: findErr } = await supabase
      .from('brand_aliases').select('id').ilike('heard', h).limit(1);
    if (findErr) {
      log.service(`saveBrandAlias | unavailable (${findErr.code ?? ''} ${findErr.message})`);
      return { ok: false, error: 'Brand spellings are not set up for this workspace yet.' };
    }

    if (existing && existing.length > 0) {
      const { error } = await supabase
        .from('brand_aliases')
        .update({ preferred: p, updated_at: new Date().toISOString() })
        .eq('id', existing[0].id);
      if (error) return { ok: false, error: error.message };
      return { ok: true };
    }

    const { error } = await supabase.from('brand_aliases').insert({
      heard: h,
      preferred: p,
      ...(createdByEmail ? { created_by_email: createdByEmail.toLowerCase() } : {}),
    });
    if (error) {
      // 23505: someone else (or a double tap) inserted it first — that is a win.
      if (error.code === '23505') return { ok: true };
      return { ok: false, error: error.message };
    }
    return { ok: true };
  } catch (err) {
    log.error(`saveBrandAlias | unexpected: ${String(err)}`);
    return { ok: false, error: 'Could not save that correction.' };
  }
}

export async function deleteBrandAlias(id: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from('brand_aliases').delete().eq('id', id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// ── Candidate assembly ─────────────────────────────────────────────────────

/** Saved aliases as matcher candidates (highest-priority source). */
export function aliasCandidates(aliases: BrandAlias[]): BrandCandidate[] {
  return aliases.map(a => ({ brand: a.preferred, source: 'alias' as const, heard: a.heard }));
}

let builtinCache: BrandCandidate[] | null = null;
let builtinInFlight: Promise<BrandCandidate[]> | null = null;

/**
 * The hardcoded 900-brand library as candidates.
 *
 * DYNAMICALLY IMPORTED AND ONLY ON DEMAND. builtinBrandVocab pulls in BRAND_DNA
 * and its four expansions — its own ~361 KB chunk. It must never appear in a
 * main-bundle import path (AGENTS.md §15), so this is awaited lazily, at most
 * once per session, and only after the cheap sources have failed to produce a
 * confident match. Failure is silent: no library, no suggestion.
 */
export async function builtinBrandCandidates(): Promise<BrandCandidate[]> {
  if (builtinCache) return builtinCache;
  if (builtinInFlight) return builtinInFlight;
  builtinInFlight = (async () => {
    try {
      const mod = await import('./builtinBrandVocab');
      builtinCache = mod.getBuiltinBrandVocab().map(e => ({ brand: e.brand, source: 'builtin' as const }));
    } catch (err) {
      log.error(`builtinBrandCandidates | ${String(err)}`);
      builtinCache = [];
    } finally {
      builtinInFlight = null;
    }
    return builtinCache;
  })();
  return builtinInFlight;
}

/** Test/sign-out helper — drops the lazily loaded library. */
export function resetBuiltinBrandCache(): void {
  builtinCache = null;
  builtinInFlight = null;
}
