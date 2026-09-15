import { supabase } from './supabase';
import { log } from './debugLogger';
import { normalizeBrand } from './brandSpelling';
import {
  MARKETPLACE_KEYS, isMarketplaceKey,
  type MarketplaceKey, type VocabKind, type VocabResolver,
} from './marketplaces/types';

/**
 * marketplaceService — the data half of multi-marketplace publishing.
 *
 * Backed by supabase/migrations/marketplaces.sql. Four things live here and
 * nowhere else:
 *
 *   1. WHICH marketplaces a workspace sells on (`org_marketplaces`), and that
 *      marketplace's defaults — its price rule, its default condition.
 *   2. WHAT each marketplace calls a brand / colour / condition / size /
 *      category (`marketplace_vocab`), in two scopes: global rows the founder
 *      curates and workspace rows that override them.
 *   3. WHICH of those marketplaces a given batch is aimed at
 *      (`workflow_batches.target_marketplaces`).
 *   4. WHAT actually happened (`listing_publications`) — the cross-listing
 *      matrix, one row per listing per marketplace.
 *
 * FORWARD-COMPATIBLE in the house style (labelsService, brandAliasService,
 * shopifyConnectionService): every read reports `unavailable` when the
 * migration has not been run, and the UI hides itself rather than showing an
 * error to someone who has done nothing wrong. The code ships before the SQL.
 *
 * The RESOLVER is pure and synchronous on purpose. An adapter
 * (src/lib/marketplaces/*) formats a listing with no network and no Supabase —
 * it is handed a `VocabResolver` built once from rows already fetched, so
 * formatting 375 listings costs zero round trips.
 */

// ── Shared plumbing ─────────────────────────────────────────────────────────

/** Table missing (migration not run), or the column set is older than this code. */
function isMissingSchema(error: { code?: string | null } | null): boolean {
  return error?.code === '42P01' || error?.code === '42703' || error?.code === 'PGRST205';
}

/** Display names for the ten keys — the one place the UI gets a label from. */
export const MARKETPLACE_NAMES: Readonly<Record<MarketplaceKey, string>> = {
  shopify: 'Shopify',
  ebay: 'eBay',
  etsy: 'Etsy',
  poshmark: 'Poshmark',
  mercari: 'Mercari',
  grailed: 'Grailed',
  depop: 'Depop',
  facebook: 'Facebook',
  vinted: 'Vinted',
  whatnot: 'Whatnot',
};

export function marketplaceName(key: string): string {
  return isMarketplaceKey(key) ? MARKETPLACE_NAMES[key] : key;
}

// ── 1. org_marketplaces — the workspace's opt-in ────────────────────────────

/**
 * The per-marketplace defaults, stored as free JSONB.
 *
 * `pricingRuleId` POINTS AT a rule id in
 * `organizations.description_settings.platformPricing`; the numbers are not
 * copied here, so editing a markup in one place changes every marketplace that
 * uses it. An id that no longer resolves falls back to no adjustment, the same
 * way Step 4's platform selector already derives its selection rather than
 * storing it (AGENTS.md §10, feature 21).
 */
export interface MarketplaceSettings {
  pricingRuleId?: string;
  /** A ConditionGrade — the grade to assume when a listing has none. */
  defaultCondition?: string;
  shippingProfile?: string;
  notes?: string;
}

export interface OrgMarketplaceRow {
  org_id: string;
  marketplace: MarketplaceKey;
  enabled: boolean;
  settings: MarketplaceSettings;
  created_at?: string;
  updated_at?: string;
}

const ORG_MARKETPLACE_COLUMNS = 'org_id, marketplace, enabled, settings, created_at, updated_at';

const NOTES_MAX = 500;
const SHORT_TEXT_MAX = 120;

const cleanShort = (v: unknown, max = SHORT_TEXT_MAX): string | undefined => {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t ? t.slice(0, max) : undefined;
};

/**
 * PURE. Run on EVERY read, for the same reason `normalizePlatformRules` is:
 * the column is free-form JSONB, it may have been written by an older build or
 * by hand, and it feeds a price lookup. A malformed value is dropped once,
 * centrally, rather than defended against at every call site.
 */
export function normalizeMarketplaceSettings(raw: unknown): MarketplaceSettings {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const r = raw as Record<string, unknown>;
  const out: MarketplaceSettings = {};
  const pricingRuleId = cleanShort(r.pricingRuleId);
  if (pricingRuleId) out.pricingRuleId = pricingRuleId;
  const defaultCondition = cleanShort(r.defaultCondition, 40);
  if (defaultCondition) out.defaultCondition = defaultCondition;
  const shippingProfile = cleanShort(r.shippingProfile);
  if (shippingProfile) out.shippingProfile = shippingProfile;
  const notes = cleanShort(r.notes, NOTES_MAX);
  if (notes) out.notes = notes;
  return out;
}

export type OrgMarketplacesResult =
  | { status: 'ok'; rows: OrgMarketplaceRow[] }
  | { status: 'unavailable' };

/**
 * Every marketplace row for a workspace, enabled or not — the settings page
 * needs the disabled ones too. Callers that want "what can this batch target"
 * filter on `enabled`.
 *
 * `orgId` is passed because the caller already knows it and the page is about
 * one specific workspace; RLS is still what decides, so passing a foreign id
 * yields zero rows rather than a leak (AGENTS.md §18 #1 — the filter is not the
 * permission).
 */
export async function fetchOrgMarketplaces(orgId: string): Promise<OrgMarketplacesResult> {
  if (!orgId) return { status: 'ok', rows: [] };
  try {
    const { data, error } = await supabase
      .from('org_marketplaces')
      .select(ORG_MARKETPLACE_COLUMNS)
      .eq('org_id', orgId)
      .order('marketplace', { ascending: true });
    if (error) {
      log.service(`fetchOrgMarketplaces | unavailable (${error.code ?? ''} ${error.message})`);
      return { status: 'unavailable' };
    }
    const rows = ((data ?? []) as Array<Record<string, unknown>>)
      .filter(r => isMarketplaceKey(r.marketplace))
      .map(r => ({
        org_id: String(r.org_id),
        marketplace: r.marketplace as MarketplaceKey,
        enabled: r.enabled !== false,
        settings: normalizeMarketplaceSettings(r.settings),
        created_at: r.created_at as string | undefined,
        updated_at: r.updated_at as string | undefined,
      }));
    return { status: 'ok', rows };
  } catch (err) {
    log.error(`fetchOrgMarketplaces | unexpected: ${String(err)}`);
    return { status: 'unavailable' };
  }
}

export type WriteResult = { ok: true } | { ok: false; error: string };

const NOT_SET_UP = 'The marketplaces migration has not been run yet.';
// One message for both shapes of 42501 this module can meet: a policy refusing
// an INSERT, and a column-grant refusing an UPDATE. Naming the admin gate is the
// useful half — it is the only one a user can act on.
const NOT_ADMIN = 'You do not have permission for that — enabling a marketplace is an admin action.';

function writeFailure(error: { code?: string | null; message: string }): WriteResult {
  if (isMissingSchema(error)) return { ok: false, error: NOT_SET_UP };
  // 42501 is the column-grant denial; a policy refusal on INSERT surfaces as
  // 42501 too ("new row violates row-level security policy").
  if (error.code === '42501') return { ok: false, error: NOT_ADMIN };
  return { ok: false, error: error.message };
}

/**
 * Turn a marketplace on or off for a workspace.
 *
 * Upsert on the primary key, because the button is a single toggle the user may
 * hit twice and because "enable something already enabled" must be a no-op
 * rather than a 23505 they have to read. `org_id` IS sent here — it is half the
 * key, so there is no conflict target without it; `is_org_admin(org_id)` in the
 * policy is what makes that safe, and it is strictly stronger than the
 * `default_org_id()` column default used elsewhere.
 */
export async function setMarketplaceEnabled(
  orgId: string, key: MarketplaceKey, enabled: boolean,
): Promise<WriteResult> {
  if (!orgId) return { ok: false, error: 'No workspace.' };
  if (!isMarketplaceKey(key)) return { ok: false, error: `Unknown marketplace "${key}".` };
  const { error } = await supabase
    .from('org_marketplaces')
    .upsert({ org_id: orgId, marketplace: key, enabled }, { onConflict: 'org_id,marketplace' });
  if (error) {
    log.service(`setMarketplaceEnabled | ${key} ${enabled} | ${error.code ?? ''} ${error.message}`);
    return writeFailure(error);
  }
  return { ok: true };
}

/**
 * Replace a marketplace's defaults. Normalised before the write as well as
 * after the read, so a hand-edited or stale key never reaches the column.
 */
export async function updateMarketplaceSettings(
  orgId: string, key: MarketplaceKey, settings: MarketplaceSettings,
): Promise<WriteResult> {
  if (!orgId) return { ok: false, error: 'No workspace.' };
  if (!isMarketplaceKey(key)) return { ok: false, error: `Unknown marketplace "${key}".` };
  const clean = normalizeMarketplaceSettings(settings);
  const { error } = await supabase
    .from('org_marketplaces')
    .upsert({ org_id: orgId, marketplace: key, settings: clean }, { onConflict: 'org_id,marketplace' });
  if (error) {
    log.service(`updateMarketplaceSettings | ${key} | ${error.code ?? ''} ${error.message}`);
    return writeFailure(error);
  }
  return { ok: true };
}

// ── 2. marketplace_vocab — what THEY call it ────────────────────────────────

export interface VocabRow {
  id: string;
  /** null = a global row every workspace reads. */
  org_id: string | null;
  marketplace: MarketplaceKey;
  kind: VocabKind;
  canonical: string;
  marketplace_value: string;
  created_by_email?: string | null;
  created_at?: string;
  updated_at?: string;
}

export const VOCAB_KINDS: readonly VocabKind[] = ['brand', 'color', 'condition', 'size', 'category'];

export const VOCAB_KIND_LABELS: Readonly<Record<VocabKind, string>> = {
  brand: 'Brand',
  color: 'Colour',
  condition: 'Condition',
  size: 'Size',
  category: 'Category',
};

const VOCAB_COLUMNS =
  'id, org_id, marketplace, kind, canonical, marketplace_value, created_by_email, created_at, updated_at';

const isVocabKind = (v: unknown): v is VocabKind =>
  typeof v === 'string' && (VOCAB_KINDS as readonly string[]).includes(v);

function toVocabRows(data: unknown): VocabRow[] {
  return ((data ?? []) as Array<Record<string, unknown>>)
    .filter(r => isMarketplaceKey(r.marketplace) && isVocabKind(r.kind))
    .map(r => ({
      id: String(r.id),
      org_id: (r.org_id as string | null) ?? null,
      marketplace: r.marketplace as MarketplaceKey,
      kind: r.kind as VocabKind,
      canonical: String(r.canonical ?? ''),
      marketplace_value: String(r.marketplace_value ?? ''),
      created_by_email: (r.created_by_email as string | null) ?? null,
      created_at: r.created_at as string | undefined,
      updated_at: r.updated_at as string | undefined,
    }));
}

export type VocabResult =
  | { status: 'ok'; rows: VocabRow[] }
  | { status: 'unavailable' };

/**
 * The global rows plus this workspace's overrides, in one result.
 *
 * TWO QUERIES, not one `.or()`: PostgREST's `or` takes a string filter
 * expression that is parsed server-side, which means a workspace id becomes
 * part of a mini-language rather than a bound parameter. Two plain filters are
 * the same round-trip cost in practice (they run in parallel), and they keep
 * the "global" and "mine" halves separable for the manager UI, which shows them
 * under different scope badges.
 *
 * RLS already hides another workspace's overrides — the `.eq('org_id')` here is
 * a projection, not the permission (AGENTS.md §18 #1).
 */
export async function fetchVocab(orgId: string | null): Promise<VocabResult> {
  try {
    const globalQ = supabase.from('marketplace_vocab').select(VOCAB_COLUMNS).is('org_id', null);
    const ownQ = orgId
      ? supabase.from('marketplace_vocab').select(VOCAB_COLUMNS).eq('org_id', orgId)
      : null;
    const [globalRes, ownRes] = await Promise.all([globalQ, ownQ ?? Promise.resolve({ data: [], error: null })]);
    if (globalRes.error) {
      log.service(`fetchVocab | unavailable (${globalRes.error.code ?? ''} ${globalRes.error.message})`);
      return { status: 'unavailable' };
    }
    if (ownRes.error) {
      log.service(`fetchVocab | unavailable (${ownRes.error.code ?? ''} ${ownRes.error.message})`);
      return { status: 'unavailable' };
    }
    return { status: 'ok', rows: [...toVocabRows(globalRes.data), ...toVocabRows(ownRes.data)] };
  } catch (err) {
    log.error(`fetchVocab | unexpected: ${String(err)}`);
    return { status: 'unavailable' };
  }
}

export interface VocabInput {
  /** null writes a GLOBAL row — founding admins only, enforced by RLS. */
  orgId: string | null;
  marketplace: MarketplaceKey;
  kind: VocabKind;
  canonical: string;
  marketplaceValue: string;
}

/**
 * THE canonical form the database's CHECK and unique index agree on.
 *
 * `.trim()` strips the whole Unicode White_Space set, which is exactly what
 * `marketplace_vocab_trim()` strips in SQL — see that function's header for why
 * `btrim/1` alone is not enough. Case is PRESERVED: `canonical` is display text
 * the seller reads back. Case-insensitive uniqueness is the index's job.
 */
export const canonicalizeVocabValue = (raw: string): string => (raw || '').trim();

/** The key the unique index enforces, reproduced client-side for the lookup. */
const vocabKey = (raw: string): string => canonicalizeVocabValue(raw).toLowerCase();

/**
 * Add or re-point one mapping.
 *
 * FIND-THEN-UPDATE-ELSE-INSERT, not upsert, for the same two reasons
 * `saveBrandAlias` is: the uniqueness is an EXPRESSION index, which PostgREST
 * cannot address with `onConflict`, and re-pointing an existing mapping must
 * replace the answer rather than fail. A racing 23505 is treated as a win — the
 * other writer got there first with the same key, which is the outcome asked
 * for.
 *
 * The find reads the (scope, marketplace, kind) slice and matches in JS rather
 * than with `ilike`, because the index is on `lower(trim(canonical))` and only
 * the JS side knows the full Unicode trim rule. These slices are tens of rows.
 */
export async function upsertVocab(input: VocabInput): Promise<WriteResult> {
  const { orgId, marketplace, kind } = input;
  if (!isMarketplaceKey(marketplace)) return { ok: false, error: `Unknown marketplace "${marketplace}".` };
  if (!isVocabKind(kind)) return { ok: false, error: `Unknown field "${kind}".` };
  const canonical = canonicalizeVocabValue(input.canonical);
  const marketplaceValue = canonicalizeVocabValue(input.marketplaceValue);
  if (!canonical) return { ok: false, error: 'Enter the value the app holds.' };
  if (!marketplaceValue) return { ok: false, error: `Enter what ${marketplaceName(marketplace)} calls it.` };

  try {
    let find = supabase
      .from('marketplace_vocab')
      .select('id, canonical')
      .eq('marketplace', marketplace)
      .eq('kind', kind);
    find = orgId ? find.eq('org_id', orgId) : find.is('org_id', null);
    const { data: slice, error: findErr } = await find;
    if (findErr) {
      log.service(`upsertVocab | unavailable (${findErr.code ?? ''} ${findErr.message})`);
      return writeFailure(findErr);
    }

    const wanted = vocabKey(canonical);
    const existing = ((slice ?? []) as Array<{ id: string; canonical: string }>)
      .find(r => vocabKey(r.canonical) === wanted);

    if (existing) {
      const { error } = await supabase
        .from('marketplace_vocab')
        .update({ canonical, marketplace_value: marketplaceValue })
        .eq('id', existing.id);
      if (error) return writeFailure(error);
      return { ok: true };
    }

    const { error } = await supabase.from('marketplace_vocab').insert({
      org_id: orgId,
      marketplace,
      kind,
      canonical,
      marketplace_value: marketplaceValue,
    });
    if (error) {
      if (error.code === '23505') return { ok: true };   // someone beat us to it
      return writeFailure(error);
    }
    return { ok: true };
  } catch (err) {
    log.error(`upsertVocab | unexpected: ${String(err)}`);
    return { ok: false, error: 'Could not save that mapping.' };
  }
}

/**
 * Edit one mapping IN PLACE, by row id.
 *
 * Separate from `upsertVocab` on purpose. That function keys on the canonical
 * value, so using it to rename one ("Forest Green" → "Forrest Green") would
 * find nothing under the NEW spelling, insert, and leave the old row behind —
 * two mappings where the user made one edit. An edit is addressed by id; only
 * a "remember this" write is addressed by value.
 *
 * A 23505 here means the edit would collide with a mapping that already exists
 * in the same scope. That is a message, not a merge: silently folding two rows
 * together would discard the other one's marketplace value.
 */
export async function updateVocab(
  id: string, canonicalRaw: string, marketplaceValueRaw: string,
): Promise<WriteResult> {
  if (!id) return { ok: false, error: 'No mapping.' };
  const canonical = canonicalizeVocabValue(canonicalRaw);
  const marketplaceValue = canonicalizeVocabValue(marketplaceValueRaw);
  if (!canonical) return { ok: false, error: 'Enter the value the app holds.' };
  if (!marketplaceValue) return { ok: false, error: 'Enter what the marketplace calls it.' };

  const { data, error } = await supabase
    .from('marketplace_vocab')
    .update({ canonical, marketplace_value: marketplaceValue })
    .eq('id', id)
    .select('id');
  if (error) {
    if (error.code === '23505') {
      return { ok: false, error: `There is already a mapping for "${canonical}" here.` };
    }
    return writeFailure(error);
  }
  // 0 rows is a failure, not a success — an RLS refusal (a member editing a
  // global row) returns no error and no rows.
  if (!data || data.length === 0) {
    return { ok: false, error: 'That mapping is not yours to edit.' };
  }
  return { ok: true };
}

export async function deleteVocab(id: string): Promise<WriteResult> {
  const { error } = await supabase.from('marketplace_vocab').delete().eq('id', id);
  if (error) return writeFailure(error);
  return { ok: true };
}

/**
 * Build the synchronous resolver every adapter is handed.
 *
 * PURE — no network, no Supabase, no Date. Rules, in order:
 *
 *   1. A WORKSPACE row beats a GLOBAL row for the same key. That is the whole
 *      point of the two scopes: the founder seeds "Ecko Unltd → Ecko Unlimited"
 *      from each marketplace's published list, and a shop that knows better
 *      corrects it for itself without asking anyone.
 *   2. `brand` matches through `normalizeBrand` — the same normalisation the
 *      Step 3 brand-spelling memory uses, so "levi's", "Levis" and "LEVI'S"
 *      resolve to one mapping and the seller never has to guess which spelling
 *      the row was saved under.
 *   3. Every other kind matches case- and space-insensitively. A colour list
 *      has no apostrophes to fold and a condition is a controlled word; folding
 *      further would make "2X" and "2 X" the same key, which for `size` they
 *      are NOT (§10, the nine size families).
 *   4. No match returns null. The resolver NEVER guesses — a guess is how a
 *      listing ends up under the marketplace's own default brand, which is the
 *      problem the vocabulary exists to solve (plan §2c). The adapter turns a
 *      null into its documented fallback plus a readiness warning.
 *
 * Later rows win within a scope, which is why `fetchVocab` returns globals
 * first: with the unique index in place there can only be one row per key per
 * scope anyway, so the ordering matters only for a caller that concatenates
 * lists by hand.
 */
export function buildVocabResolver(rows: readonly VocabRow[]): VocabResolver {
  // kind|marketplace|normalised-canonical → marketplace_value
  const global = new Map<string, string>();
  const own = new Map<string, string>();

  const keyFor = (kind: VocabKind, marketplace: MarketplaceKey, canonical: string): string => {
    const value = kind === 'brand'
      ? normalizeBrand(canonical)
      : canonicalizeVocabValue(canonical).toLowerCase().replace(/\s+/g, ' ');
    return `${kind}|${marketplace}|${value}`;
  };

  for (const row of rows) {
    if (!row || !row.canonical || !row.marketplace_value) continue;
    if (!isMarketplaceKey(row.marketplace) || !isVocabKind(row.kind)) continue;
    const target = row.org_id === null ? global : own;
    target.set(keyFor(row.kind, row.marketplace, row.canonical), row.marketplace_value);
  }

  return {
    resolve(kind, marketplace, canonical) {
      if (!canonical) return null;
      const k = keyFor(kind, marketplace, canonical);
      return own.get(k) ?? global.get(k) ?? null;
    },
  };
}

// ── 3. workflow_batches.target_marketplaces ─────────────────────────────────

/**
 * PURE. The batch's targets, filtered to keys this build knows about.
 *
 * The database CHECK guards what goes IN; this guards what comes OUT, because a
 * key could have been retired between the write and the read (and because a
 * batch saved before the migration has no column at all — `undefined`, not
 * `[]`). Order is preserved and duplicates are dropped, so a stored `{ebay,
 * ebay}` renders one toggle.
 */
export function readBatchTargets(
  row: { target_marketplaces?: string[] | null } | null | undefined,
): MarketplaceKey[] {
  const raw = row?.target_marketplaces;
  if (!Array.isArray(raw)) return [];
  const out: MarketplaceKey[] = [];
  for (const v of raw) if (isMarketplaceKey(v) && !out.includes(v)) out.push(v);
  return out;
}

/**
 * Store which marketplaces a batch is aimed at.
 *
 * Keys are validated here as well as by the CHECK, so an unknown one is a
 * message the caller can show rather than a 23514 they have to decode — and so
 * the whole array is never rejected because of one stale key. Written in
 * MARKETPLACE_KEYS order rather than click order, so the stored value is stable
 * and two people toggling the same set produce the same row.
 */
export async function setBatchTargets(
  batchId: string, keys: readonly MarketplaceKey[],
): Promise<WriteResult> {
  if (!batchId) return { ok: false, error: 'No batch.' };
  const unknown = keys.filter(k => !isMarketplaceKey(k));
  if (unknown.length > 0) return { ok: false, error: `Unknown marketplace: ${unknown.join(', ')}.` };
  const ordered = MARKETPLACE_KEYS.filter(k => keys.includes(k));

  const { data, error } = await supabase
    .from('workflow_batches')
    .update({ target_marketplaces: ordered })
    .eq('id', batchId)
    .select('id');
  if (error) {
    log.service(`setBatchTargets | ${error.code ?? ''} ${error.message}`);
    return writeFailure(error);
  }
  // 0 rows is a failure, not a success (AGENTS.md §18 #41 / productService's
  // checked updateProduct): an RLS refusal returns no error and no rows.
  if (!data || data.length === 0) return { ok: false, error: 'That batch is not in this workspace.' };
  return { ok: true };
}

// ── 4. listing_publications — the cross-listing matrix ──────────────────────

export type PublicationStatus =
  | 'draft' | 'exported' | 'posted' | 'live' | 'sold' | 'removed';

export const PUBLICATION_STATUSES: readonly PublicationStatus[] = [
  'draft', 'exported', 'posted', 'live', 'sold', 'removed',
];

const isPublicationStatus = (v: unknown): v is PublicationStatus =>
  typeof v === 'string' && (PUBLICATION_STATUSES as readonly string[]).includes(v);

export interface PublicationRow {
  id: string;
  batch_id: string | null;
  product_group_id: string;
  sku: string | null;
  marketplace: MarketplaceKey;
  status: PublicationStatus;
  external_id: string | null;
  url: string | null;
  price_cents: number | null;
  posted_at: string | null;
  sold_at: string | null;
  updated_at?: string;
}

const PUBLICATION_COLUMNS =
  'id, batch_id, product_group_id, sku, marketplace, status, external_id, url, price_cents, posted_at, sold_at, updated_at';

export type PublicationsResult =
  | { status: 'ok'; rows: PublicationRow[] }
  | { status: 'unavailable' };

function toPublicationRows(data: unknown): PublicationRow[] {
  return ((data ?? []) as Array<Record<string, unknown>>)
    .filter(r => isMarketplaceKey(r.marketplace) && isPublicationStatus(r.status))
    .map(r => ({
      id: String(r.id),
      batch_id: (r.batch_id as string | null) ?? null,
      product_group_id: String(r.product_group_id),
      sku: (r.sku as string | null) ?? null,
      marketplace: r.marketplace as MarketplaceKey,
      status: r.status as PublicationStatus,
      external_id: (r.external_id as string | null) ?? null,
      url: (r.url as string | null) ?? null,
      price_cents: typeof r.price_cents === 'number' ? r.price_cents : null,
      posted_at: (r.posted_at as string | null) ?? null,
      sold_at: (r.sold_at as string | null) ?? null,
      updated_at: r.updated_at as string | undefined,
    }));
}

/**
 * The workspace's publication records, optionally narrowed to one batch.
 *
 * Without `batchId` this is every record the workspace has — which is what the
 * founder's per-marketplace counts want. Step 4 always passes a batch.
 */
export async function fetchPublications(
  orgId: string, batchId?: string,
): Promise<PublicationsResult> {
  if (!orgId) return { status: 'ok', rows: [] };
  try {
    let q = supabase
      .from('listing_publications')
      .select(PUBLICATION_COLUMNS)
      .eq('org_id', orgId);
    if (batchId) q = q.eq('batch_id', batchId);
    const { data, error } = await q;
    if (error) {
      log.service(`fetchPublications | unavailable (${error.code ?? ''} ${error.message})`);
      return { status: 'unavailable' };
    }
    return { status: 'ok', rows: toPublicationRows(data) };
  } catch (err) {
    log.error(`fetchPublications | unexpected: ${String(err)}`);
    return { status: 'unavailable' };
  }
}

export interface PublicationInput {
  batchId?: string | null;
  productGroupId: string;
  sku?: string | null;
  marketplace: MarketplaceKey;
  status: PublicationStatus;
  externalId?: string | null;
  url?: string | null;
  priceCents?: number | null;
  postedAt?: string | null;
  soldAt?: string | null;
}

/**
 * Record (or update) what happened to one listing on one marketplace.
 *
 * FIND-THEN-UPDATE on the unique triple `(org, product_group_id, marketplace)`.
 * Not an upsert: `org_id` is placed by the column DEFAULT and must never be
 * sent from the client, so it cannot appear in a conflict target — and an
 * export re-run must UPDATE the existing cell rather than fail, because the
 * whole value of the matrix is that it stays true.
 *
 * Only the fields the caller supplies are written. A feed export knows the
 * status and the price; an API connector later fills in `external_id` and
 * `url`; neither should blank what the other wrote.
 */
export async function upsertPublication(input: PublicationInput): Promise<WriteResult> {
  const { productGroupId, marketplace, status } = input;
  if (!productGroupId) return { ok: false, error: 'No listing.' };
  if (!isMarketplaceKey(marketplace)) return { ok: false, error: `Unknown marketplace "${marketplace}".` };
  if (!isPublicationStatus(status)) return { ok: false, error: `Unknown status "${status}".` };

  const patch: Record<string, unknown> = { status };
  if (input.batchId !== undefined) patch.batch_id = input.batchId;
  if (input.sku !== undefined) patch.sku = input.sku;
  if (input.externalId !== undefined) patch.external_id = input.externalId;
  if (input.url !== undefined) patch.url = input.url;
  if (input.priceCents !== undefined) patch.price_cents = input.priceCents;
  if (input.postedAt !== undefined) patch.posted_at = input.postedAt;
  if (input.soldAt !== undefined) patch.sold_at = input.soldAt;

  try {
    const { data: found, error: findErr } = await supabase
      .from('listing_publications')
      .select('id')
      .eq('product_group_id', productGroupId)
      .eq('marketplace', marketplace)
      .limit(1);
    if (findErr) {
      log.service(`upsertPublication | unavailable (${findErr.code ?? ''} ${findErr.message})`);
      return writeFailure(findErr);
    }

    const hit = ((found ?? []) as Array<{ id: string }>)[0];
    if (hit) {
      const { data, error } = await supabase
        .from('listing_publications').update(patch).eq('id', hit.id).select('id');
      if (error) return writeFailure(error);
      if (!data || data.length === 0) return { ok: false, error: 'That record is not in this workspace.' };
      return { ok: true };
    }

    // org_id is deliberately absent — the column DEFAULT default_org_id() and
    // the RLS with-check place the row (AGENTS.md §18 #20's sibling rule).
    const { error } = await supabase
      .from('listing_publications')
      .insert({ ...patch, product_group_id: productGroupId, marketplace });
    if (error) {
      if (error.code === '23505') return { ok: true };   // a concurrent writer won
      return writeFailure(error);
    }
    return { ok: true };
  } catch (err) {
    log.error(`upsertPublication | unexpected: ${String(err)}`);
    return { ok: false, error: 'Could not record that publication.' };
  }
}

/** Move one publication to a new status — the matrix's one-cell action. */
export async function markPublicationStatus(
  id: string, status: PublicationStatus,
): Promise<WriteResult> {
  if (!id) return { ok: false, error: 'No record.' };
  if (!isPublicationStatus(status)) return { ok: false, error: `Unknown status "${status}".` };
  const { data, error } = await supabase
    .from('listing_publications').update({ status }).eq('id', id).select('id');
  if (error) return writeFailure(error);
  if (!data || data.length === 0) return { ok: false, error: 'That record is not in this workspace.' };
  return { ok: true };
}

/**
 * PURE. The cross-listing matrix: listing → marketplace → its record.
 *
 * A Map of Maps rather than a flat lookup on a composite string key, because
 * the consumer renders ROWS (one per listing) and needs "what does this listing
 * have anywhere" as a first-class question. Insertion order follows the input,
 * so a caller that sorted its rows keeps that order.
 *
 * A later row for the same cell wins. That cannot happen with the unique index
 * in place; it is defined anyway so the function is total, and so it stays
 * correct if a caller ever concatenates two fetches.
 */
export function publicationMatrix(
  rows: readonly PublicationRow[],
): Map<string, Map<MarketplaceKey, PublicationRow>> {
  const matrix = new Map<string, Map<MarketplaceKey, PublicationRow>>();
  for (const row of rows) {
    if (!row?.product_group_id || !isMarketplaceKey(row.marketplace)) continue;
    let cells = matrix.get(row.product_group_id);
    if (!cells) {
      cells = new Map<MarketplaceKey, PublicationRow>();
      matrix.set(row.product_group_id, cells);
    }
    cells.set(row.marketplace, row);
  }
  return matrix;
}
