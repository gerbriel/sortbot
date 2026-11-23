/**
 * PLAN LIMITS AND WORKSPACE USAGE: the client half of
 * `supabase/migrations/069_plan_limits_and_usage.sql`.
 *
 * Three RPCs and a catalog read:
 * - `org_usage(p_org)`: one workspace's plan, its three limits and what it has
 *   used (storage, files, listings this month, members). Any member may read
 *   their own workspace; anyone else gets 42501.
 * - `project_usage()`: founding admins only. The whole project against the
 *   Supabase storage quota, plus one row per workspace, sorted by storage.
 * - `founding_set_plan_limits(...)`: founding admins only. Writes the three
 *   limits on one catalog row; null means unlimited.
 * - `finance_plan_prices` limit columns, read for the Founder console's
 *   limits editor (`fetchPlanLimits`).
 *
 * FORWARD-COMPATIBLE, the Finance way: a missing function or column (the
 * migration has not been run) reads as 'unavailable' and every meter that
 * depends on it hides. 'forbidden' is 42501. Anything else is 'error' with the
 * server's message, which no widget shows to a member (they fail quiet).
 *
 * THE PURE HELPERS below (`usageReadout`, `limitLabel`, `listingBasisCopy`,
 * `planDisplayName`) are what every surface formats through, so Home, the
 * Workspace page and the Founder console can never print the same number two
 * different ways.
 */
import { supabase } from './supabase';
import { log } from './debugLogger';

// ── Types (the 069 contract) ─────────────────────────────────────────────────

/** Null on any of the three means unlimited. Storage is in GB, not bytes. */
export interface PlanLimits {
  listings_per_month: number | null;
  storage_gb: number | null;
  seats: number | null;
}

/** What counts as a "listing this month": exported (CSV / marketplace) or
 *  merely created. The server decides; the copy says which. */
export type ListingBasis = 'exported' | 'created';

export interface OrgUsage {
  org_id: string;
  plan: string;
  limits: PlanLimits;
  usage: {
    storage_bytes: number;
    files: number;
    listings_this_month: number;
    members: number;
    /** YYYY-MM-DD, the first day of the counting month. */
    month_start: string;
  };
  listing_basis: ListingBasis;
}

export interface ProjectUsageOrg {
  org_id: string;
  name: string;
  plan: string;
  storage_bytes: number;
  files: number;
  listings_this_month: number;
  members: number;
  limits: PlanLimits;
}

export interface ProjectUsage {
  project: {
    /** The Supabase project's storage quota in GB (finance_settings). Null when unset. */
    storage_gb_quota: number | null;
    storage_bytes_total: number;
    files_total: number;
    orgs: number;
    members_total: number;
    listings_this_month_total: number;
    month_start: string;
    listing_basis: ListingBasis;
  };
  /** Sorted by storage_bytes, largest first (the server sorts; so do we). */
  orgs: ProjectUsageOrg[];
}

/** One catalog row's limits, as the editor reads them. */
export interface PlanLimitsRow extends PlanLimits {
  plan: string;
}

export type UsageResult<T> =
  | { status: 'ok'; data: T }
  | { status: 'unavailable' }
  | { status: 'forbidden' }
  | { status: 'error'; message: string };

// ── Error mapping ────────────────────────────────────────────────────────────

interface PgError { code?: string; message: string }

/** Codes that mean "069 has not been run": a missing function (42883, PostgREST's
 *  PGRST202 / PGRST302), a missing column (42703, PGRST204) or table (42P01,
 *  PGRST205). None of them is the caller's fault. */
const MISSING = new Set(['42883', 'PGRST202', 'PGRST302', '42703', 'PGRST204', '42P01', 'PGRST205']);

function failure<T>(error: PgError, what: string): UsageResult<T> {
  if (error.code && MISSING.has(error.code)) {
    log.db(`usageService | ${what} unavailable (${error.code})`);
    return { status: 'unavailable' };
  }
  if (error.code === '42501') return { status: 'forbidden' };
  log.error(`usageService | ${what} | ${error.code ?? ''} ${error.message}`);
  return { status: 'error', message: error.message || 'Something went wrong.' };
}

// ── Normalisers ──────────────────────────────────────────────────────────────

/** PostgREST may hand a bigint back as a string. Coerce once, here. */
function num(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** A limit: null (or anything unparseable) is unlimited; a number is clamped at 0. */
function limit(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? Math.max(0, n) : null;
}

function toLimits(raw: unknown): PlanLimits {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    listings_per_month: limit(r.listings_per_month),
    storage_gb: limit(r.storage_gb),
    seats: limit(r.seats),
  };
}

/** 069 answers 'created'; anything unrecognised reads as that, the shipped basis. */
const toBasis = (v: unknown): ListingBasis => (v === 'exported' ? 'exported' : 'created');

export function normalizeOrgUsage(raw: unknown): OrgUsage {
  const r = (raw ?? {}) as Record<string, unknown>;
  const u = (r.usage ?? {}) as Record<string, unknown>;
  return {
    org_id: String(r.org_id ?? ''),
    plan: String(r.plan ?? ''),
    limits: toLimits(r.limits),
    usage: {
      storage_bytes: num(u.storage_bytes),
      files: num(u.files),
      listings_this_month: num(u.listings_this_month),
      members: num(u.members),
      month_start: String(u.month_start ?? ''),
    },
    listing_basis: toBasis(r.listing_basis),
  };
}

export function normalizeProjectUsage(raw: unknown): ProjectUsage {
  const r = (raw ?? {}) as Record<string, unknown>;
  const p = (r.project ?? {}) as Record<string, unknown>;
  const rows = Array.isArray(r.orgs) ? r.orgs : [];
  const orgs = rows.map((o): ProjectUsageOrg => {
    const x = (o ?? {}) as Record<string, unknown>;
    return {
      org_id: String(x.org_id ?? ''),
      name: String(x.name ?? ''),
      plan: String(x.plan ?? ''),
      storage_bytes: num(x.storage_bytes),
      files: num(x.files),
      listings_this_month: num(x.listings_this_month),
      members: num(x.members),
      limits: toLimits(x.limits),
    };
  });
  // Stable re-sort: the contract says the server sorts, and a table that
  // claims "sorted by storage" must be, whatever came over the wire.
  orgs.sort((a, b) => b.storage_bytes - a.storage_bytes);
  return {
    project: {
      storage_gb_quota: limit(p.storage_gb_quota),
      storage_bytes_total: num(p.storage_bytes_total),
      files_total: num(p.files_total),
      orgs: num(p.orgs),
      members_total: num(p.members_total),
      listings_this_month_total: num(p.listings_this_month_total),
      month_start: String(p.month_start ?? ''),
      listing_basis: toBasis(p.listing_basis),
    },
    orgs,
  };
}

// ── Reads and the one write ──────────────────────────────────────────────────

/** One workspace's plan, limits and usage. Members of the workspace only. */
export async function fetchOrgUsage(orgId: string): Promise<UsageResult<OrgUsage>> {
  const { data, error } = await supabase.rpc('org_usage', { p_org: orgId });
  if (error) return failure(error, 'fetchOrgUsage');
  if (!data) return { status: 'error', message: 'No usage came back.' };
  return { status: 'ok', data: normalizeOrgUsage(data) };
}

/** The whole project. Founding admins only. */
export async function fetchProjectUsage(): Promise<UsageResult<ProjectUsage>> {
  const { data, error } = await supabase.rpc('project_usage');
  if (error) return failure(error, 'fetchProjectUsage');
  if (!data) return { status: 'error', message: 'No usage came back.' };
  return { status: 'ok', data: normalizeProjectUsage(data) };
}

/** The three limit columns of every catalog row, for the limits editor. */
export async function fetchPlanLimits(): Promise<UsageResult<PlanLimitsRow[]>> {
  const { data, error } = await supabase
    .from('finance_plan_prices')
    .select('plan, listings_per_month, storage_gb, seats');
  if (error) return failure(error, 'fetchPlanLimits');
  const rows = (Array.isArray(data) ? data : []) as Array<Record<string, unknown>>;
  return {
    status: 'ok',
    data: rows.map(r => ({ plan: String(r.plan ?? ''), ...toLimits(r) })),
  };
}

export interface PlanLimitsInput {
  plan: string;
  listingsPerMonth: number | null;
  storageGb: number | null;
  seats: number | null;
}

/** Write one plan's three limits. Null means unlimited. Founding admins only. */
export async function setPlanLimits(input: PlanLimitsInput): Promise<UsageResult<PlanLimitsRow>> {
  const { data, error } = await supabase.rpc('founding_set_plan_limits', {
    p_plan: input.plan.trim().toLowerCase(),
    p_listings_per_month: input.listingsPerMonth,
    p_storage_gb: input.storageGb,
    p_seats: input.seats,
  });
  if (error) return failure(error, 'setPlanLimits');
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null | undefined;
  return {
    status: 'ok',
    data: { plan: String(row?.plan ?? input.plan), ...toLimits(row ?? {
      listings_per_month: input.listingsPerMonth, storage_gb: input.storageGb, seats: input.seats,
    }) },
  };
}

// ── Pure helpers ─────────────────────────────────────────────────────────────

export const BYTES_PER_GB = 1024 ** 3;

/** `1234` → `1,234`. */
export function formatCount(n: number): string {
  const v = Number.isFinite(n) ? n : 0;
  return v.toLocaleString('en-US', { maximumFractionDigits: 1 });
}

/** Bytes → `1.2 GB`, always one decimal, with thousands separators. */
export function formatGb(bytes: number): string {
  const v = Number.isFinite(bytes) && bytes > 0 ? bytes / BYTES_PER_GB : 0;
  return `${v.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} GB`;
}

export type UsageUnit = 'bytes' | 'count';

export interface UsageReadout {
  /** 0-100, clamped and rounded. 0 when unlimited. */
  percent: number;
  /** At or over 85% of the limit (read off the RAW ratio). */
  nearLimit: boolean;
  /** At or over 100% of the limit. */
  over: boolean;
  /** The limit is null: no bar, the value stands alone. */
  unlimited: boolean;
  /** `1.2 GB` / `1,234`. */
  usedText: string;
  /** `10 GB` / `500` / `Unlimited`. */
  limitText: string;
  /** `1.2 GB of 10 GB` / `42 of 500` / `1.2 GB · Unlimited`. */
  text: string;
  /** `'ok' | 'warn' | 'over'`, the tint every surface maps to a class. */
  tone: 'ok' | 'warn' | 'over';
}

/**
 * One meter's numbers. `unit: 'bytes'` reads `used` as BYTES and `limit` as GB
 * (the catalog stores storage in GB); `unit: 'count'` reads both as counts.
 *
 * A zero limit is a real limit ("no seats"): any use of it is over, none is not.
 */
export function usageReadout(used: number, limitValue: number | null, unit: UsageUnit = 'count'): UsageReadout {
  const u = Number.isFinite(used) && used > 0 ? used : 0;
  const usedText = unit === 'bytes' ? formatGb(u) : formatCount(u);
  const unlimited = limitValue === null || limitValue === undefined || !Number.isFinite(limitValue);
  if (unlimited) {
    return {
      percent: 0, nearLimit: false, over: false, unlimited: true,
      usedText, limitText: 'Unlimited', text: `${usedText} · Unlimited`, tone: 'ok',
    };
  }
  const lim = Math.max(0, limitValue as number);
  const usedUnits = unit === 'bytes' ? u / BYTES_PER_GB : u;
  const raw = lim > 0 ? (usedUnits / lim) * 100 : (usedUnits > 0 ? Infinity : 0);
  const percent = Math.min(100, Math.max(0, Math.round(Number.isFinite(raw) ? raw : 100)));
  const over = raw >= 100;
  const nearLimit = raw >= 85;
  const limitText = unit === 'bytes' ? `${formatCount(lim)} GB` : formatCount(lim);
  return {
    percent, nearLimit, over, unlimited: false,
    usedText, limitText, text: `${usedText} of ${limitText}`,
    tone: over ? 'over' : nearLimit ? 'warn' : 'ok',
  };
}

/**
 * A limit for a label: `null` → `Unlimited`, `10, 'GB'` → `10 GB`,
 * `500, 'listings'` → `500 listings`, `1, 'seats'` → `1 seat`.
 */
export function limitLabel(value: number | null, unit = ''): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'Unlimited';
  const n = formatCount(Math.max(0, value));
  if (!unit) return n;
  const word = value === 1 && unit !== 'GB' && unit.endsWith('s') ? unit.slice(0, -1) : unit;
  return `${n} ${word}`;
}

/**
 * What the listings count counts, for the hint under it. 069 ships 'created'
 * (a listing is a product group, counted in the UTC calendar month its first
 * row was created; the Shopify CSV export writes no publication row, so an
 * 'exported' basis would read zero for most shops). 'exported' is kept for a
 * server that ever switches.
 */
export function listingBasisCopy(basis: ListingBasis): string {
  return basis === 'exported' ? 'listings exported this month' : 'listings created this month';
}

/** `organizations.plan` key → a display name: `founding_pro` → `Founding pro`.
 *  The catalog's display names are founder-readable only, so members see the
 *  key, cased. */
export function planDisplayName(plan: string | null | undefined): string {
  const key = String(plan ?? '').trim();
  if (!key) return 'No plan';
  const spaced = key.replace(/[_-]+/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** A limit typed into an editor cell: blank → null (unlimited), a whole
 *  non-negative number → that number, anything else → undefined (invalid). */
export function parseLimitInput(input: string): number | null | undefined {
  const s = String(input ?? '').replace(/[,\s]/g, '');
  if (s === '') return null;
  if (!/^\d+(\.\d+)?$/.test(s)) return undefined;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}
