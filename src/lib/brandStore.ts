/**
 * The RUNTIME brand: the product name, descriptor and tagline the app renders.
 *
 * Same dependency-free useSyncExternalStore shape as workflowStore and
 * saveStatusStore. Hydration order, each step overriding the last only with a
 * usable value:
 *
 *   1. build   brand.json via src/brand.ts, synchronously at import, so the first
 *              paint never flashes a placeholder.
 *   2. cache   localStorage `sortbot_brand`, synchronously at import (before the
 *              first render), so a renamed product does not flash its old name
 *              on the second visit. Losing the key just costs one fetch.
 *   3. remote  `supabase.rpc('public_brand')` (070_runtime_brand.sql), started
 *              once from main.tsx. It is anon-callable, so the logged-out landing
 *              page gets it too. FAILS QUIET: a missing function, a network
 *              error or a malformed payload keeps whatever is already shown.
 *
 * The founder console writes through `founding_set_brand` and hands the answer
 * to `applyRemoteBrand`, so the founder sees the change at once; everyone else
 * sees it on their next load.
 *
 * WHAT THIS DOES NOT COVER: the HTML <title>, the manifest, the native app
 * names and the artwork. Those are static files rewritten from brand.json by
 * `npm run brand:apply` / `brand:assets` and shipped by a deploy (AGENTS.md §1).
 */
import { useSyncExternalStore } from 'react';
import { BRAND, BRAND_DESCRIPTOR, BRAND_TAGLINE, BRAND_TITLE_LANDING } from '../brand';
import { supabase } from './supabase';
import { log } from './debugLogger';

export type BrandSource = 'build' | 'cache' | 'remote';

export interface RuntimeBrand {
  name: string;
  descriptor: string;
  tagline: string;
  source: BrandSource;
}

/** localStorage key for the last remote brand. Cosmetic (AGENTS.md §1). */
export const BRAND_CACHE_KEY = 'sortbot_brand';

/** The server's limits (070), mirrored so a bad cache or payload is dropped. */
export const BRAND_NAME_MAX = 24;
export const BRAND_TEXT_MAX = 120;

export const BUILD_BRAND: RuntimeBrand = Object.freeze({
  name: BRAND,
  descriptor: BRAND_DESCRIPTOR,
  tagline: BRAND_TAGLINE,
  source: 'build',
}) as RuntimeBrand;

const oneLine = (s: string) => !/[\r\n]/.test(s);

/**
 * A raw `{ name, descriptor, tagline }` (from the RPC or the cache) laid over
 * `base`. The name must be a usable one-line string of 1 to 24 characters or
 * the whole payload is ignored; a descriptor or tagline that is not a one-line
 * string up to 120 characters keeps the base value. Returns null when nothing
 * usable arrived.
 */
export function normalizeBrand(raw: unknown, base: RuntimeBrand, source: BrandSource): RuntimeBrand | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const name = typeof r.name === 'string' ? r.name.trim() : '';
  if (!name || name.length > BRAND_NAME_MAX || !oneLine(name)) return null;
  const text = (v: unknown, fallback: string) => {
    if (typeof v !== 'string') return fallback;
    const t = v.trim();
    return t.length <= BRAND_TEXT_MAX && oneLine(t) ? t : fallback;
  };
  return {
    name,
    descriptor: text(r.descriptor, base.descriptor),
    tagline: text(r.tagline, base.tagline),
    source,
  };
}

function readCache(): RuntimeBrand | null {
  try {
    const raw = localStorage.getItem(BRAND_CACHE_KEY);
    if (!raw) return null;
    return normalizeBrand(JSON.parse(raw), BUILD_BRAND, 'cache');
  } catch {
    return null;
  }
}

function writeCache(b: RuntimeBrand): void {
  try {
    localStorage.setItem(BRAND_CACHE_KEY, JSON.stringify({ name: b.name, descriptor: b.descriptor, tagline: b.tagline }));
  } catch {
    /* private mode or quota: the next load just fetches again */
  }
}

let state: RuntimeBrand = readCache() ?? BUILD_BRAND;
const listeners = new Set<() => void>();
let inflight: Promise<RuntimeBrand> | null = null;

function set(next: RuntimeBrand): void {
  const same = next.name === state.name && next.descriptor === state.descriptor
    && next.tagline === state.tagline && next.source === state.source;
  state = next;
  if (!same) listeners.forEach((l) => l());
}

export const brandStore = {
  getState: (): RuntimeBrand => state,
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
  /** Test helper: back to the build value, re-reading the cache when asked. */
  reset(opts: { readCache?: boolean } = {}): void {
    inflight = null;
    set(opts.readCache ? (readCache() ?? BUILD_BRAND) : BUILD_BRAND);
  },
};

/** The brand for non-React code (the description generator, email subjects). */
export function getBrand(): RuntimeBrand {
  return state;
}

/** The brand for components; re-renders when the founder renames the product. */
export function useBrand(): RuntimeBrand {
  return useSyncExternalStore(brandStore.subscribe, brandStore.getState, brandStore.getState);
}

/**
 * A `public_brand()` / `founding_set_brand()` answer, applied to the store and
 * the cache. Returns false (and changes nothing) when the payload is unusable.
 */
export function applyRemoteBrand(raw: unknown): boolean {
  const next = normalizeBrand(raw, BUILD_BRAND, 'remote');
  if (!next) return false;
  set(next);
  writeCache(next);
  return true;
}

/**
 * Fetch the runtime brand once per page load (concurrent callers share one
 * request; `force` asks again). Never rejects: any failure keeps the current
 * value.
 */
export function hydrateBrand(opts: { force?: boolean } = {}): Promise<RuntimeBrand> {
  if (inflight && !opts.force) return inflight;
  inflight = (async () => {
    try {
      const { data, error } = await supabase.rpc('public_brand');
      if (error) {
        log.db(`brandStore | public_brand unavailable (${error.code ?? ''})`);
      } else if (!applyRemoteBrand(data)) {
        log.db('brandStore | public_brand answered nothing usable; keeping the current brand');
      }
    } catch (err) {
      log.db(`brandStore | public_brand failed: ${String(err)}`);
    }
    return state;
  })();
  return inflight;
}

/**
 * The marketing tab title for a runtime name. brand.json's `landingTitle`
 * carries the build name ("SQRL: vintage clothing photos ..."); a renamed
 * product swaps that word and keeps the rest.
 */
export function landingTitleFor(name: string): string {
  if (name === BRAND) return BRAND_TITLE_LANDING;
  return BRAND_TITLE_LANDING.includes(BRAND)
    ? BRAND_TITLE_LANDING.split(BRAND).join(name)
    : `${name}: ${BRAND_TITLE_LANDING}`;
}
