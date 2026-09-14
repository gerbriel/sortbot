/**
 * First-party CRM (Founding Workspace only) — contacts, stages, tags,
 * follow-ups and notes, stored in our own Supabase project (`crm_contacts`,
 * `crm_notes`; migration crm.sql). There is no external CRM behind this.
 *
 * NOTE FOR LATER — `crm_sync_contacts()` could be INCREMENTAL, and is not.
 * It re-derives and re-upserts EVERY contact from beta_signups + auth.users +
 * organizations on every call (architecture review #18). A `where
 * greatest(u.created_at, o.created_at, b.created_at) > (select max(last_seen_at)
 * from crm_contacts)` — or simply a `p_since timestamptz default null` argument
 * the panel passes from the newest contact it holds — would turn an O(all users)
 * write into an O(new users) one. NOT rewritten here: it is a SECURITY DEFINER
 * body with its own correctness story (the `updated` count is "rows re-checked",
 * which an incremental version would silently change), and the throttle below
 * removes the repeat-call cost without touching the function's semantics. Do
 * that rewrite on its own, with its own before/after.
 *
 * `syncCrmContacts()` calls the `crm_sync_contacts()` RPC, which mirrors beta
 * requests and real accounts (+ their workspace) into contacts — that is how
 * new orgs and users show up by themselves. It never overwrites hand edits.
 *
 * FORWARD-COMPATIBLE: every read reports 'unavailable' when the tables are
 * missing (migration not run) so the panel can show the setup step instead.
 */
import { supabase } from './supabase';
import { log } from './debugLogger';

export const CRM_STAGES = ['lead', 'approved', 'active', 'churned', 'lost'] as const;
export type CrmStage = (typeof CRM_STAGES)[number];
export type CrmSource = 'manual' | 'beta_signup' | 'account';

export const CRM_STAGE_LABEL: Record<CrmStage, string> = {
  lead: 'Lead',
  approved: 'Approved',
  active: 'Active',
  churned: 'Churned',
  lost: 'Lost',
};

export interface CrmContact {
  id: string;
  email: string;
  name: string | null;
  company: string | null;
  source: CrmSource;
  stage: CrmStage;
  tags: string[];
  next_follow_up: string | null; // YYYY-MM-DD
  user_id: string | null;
  org_id: string | null;
  last_seen_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CrmNote {
  id: string;
  contact_id: string;
  author_id: string | null;
  author_email: string | null;
  body: string;
  created_at: string;
}

const CONTACT_COLS = 'id, email, name, company, source, stage, tags, next_follow_up, user_id, org_id, last_seen_at, created_at, updated_at';
const NOTE_COLS = 'id, contact_id, author_id, author_email, body, created_at';

export type CrmContactsResult = { status: 'ok'; contacts: CrmContact[] } | { status: 'unavailable' };
export type CrmSyncResult = { status: 'ok'; inserted: number; updated: number } | { status: 'unavailable'; message: string };

export async function fetchCrmContacts(): Promise<CrmContactsResult> {
  const { data, error } = await supabase
    .from('crm_contacts')
    .select(CONTACT_COLS)
    .order('updated_at', { ascending: false })
    .limit(2000);
  if (error) {
    log.service(`fetchCrmContacts | unavailable (${error.code ?? ''} ${error.message})`);
    return { status: 'unavailable' };
  }
  return { status: 'ok', contacts: (data ?? []) as CrmContact[] };
}

/**
 * How long an automatic (panel-open) sync stays "recent enough" that opening the
 * panel again should not re-run it. Session-scoped, in memory — a reload syncs.
 */
export const CRM_AUTO_SYNC_TTL_MS = 10 * 60_000;

/** null = this session has never auto-synced. Not 0: with a real epoch clock, 0
 *  happens to work, but a test (or a fake timer) starting near t=0 would read it
 *  as "synced a moment ago" and suppress the first sync. */
let lastAutoSyncAt: number | null = null;

/**
 * Should the AUTOMATIC sync on panel open actually run?
 *
 * `crm_sync_contacts()` is not cheap: it re-derives the whole contact list from
 * `beta_signups` + `auth.users` + `organizations` and upserts every row, every
 * time (architecture review #18). It is idempotent, which is exactly why running
 * it on every panel open was easy to miss — the result never changes, only the
 * CPU bill does. The founder opens the CRM tab repeatedly in a session; the data
 * it syncs FROM changes when somebody signs up, i.e. rarely.
 *
 * The MANUAL Sync button bypasses this entirely — a human asking for fresh data
 * gets fresh data, always. So does the post-approve/deny sync in OrgPanel, which
 * is user-triggered and follows a write that genuinely changed the source rows.
 *
 * Pure w.r.t. its arguments; the timestamp is module state set only by
 * `markCrmAutoSynced`.
 */
export function shouldAutoSyncCrm(now: number = Date.now()): boolean {
  if (lastAutoSyncAt === null) return true;
  return now - lastAutoSyncAt >= CRM_AUTO_SYNC_TTL_MS;
}

/** Record that an automatic sync ran. Call only after one actually succeeded. */
export function markCrmAutoSynced(now: number = Date.now()): void {
  lastAutoSyncAt = now;
}

/** Test hook. */
export function resetCrmAutoSync(): void {
  lastAutoSyncAt = null;
}

export async function syncCrmContacts(): Promise<CrmSyncResult> {
  const { data, error } = await supabase.rpc('crm_sync_contacts');
  if (error) {
    log.service(`syncCrmContacts | ${error.code ?? ''} ${error.message}`);
    return { status: 'unavailable', message: error.message };
  }
  const d = (data ?? {}) as { inserted?: number; updated?: number };
  return { status: 'ok', inserted: Number(d.inserted ?? 0), updated: Number(d.updated ?? 0) };
}

export async function createCrmContact(input: { email: string; name?: string; company?: string }): Promise<{ ok: true; contact: CrmContact } | { ok: false; error: string }> {
  const email = normalizeEmail(input.email);
  if (!isEmail(email)) return { ok: false, error: 'Enter a valid email address.' };
  const { data, error } = await supabase
    .from('crm_contacts')
    .insert({ email, name: input.name?.trim() || null, company: input.company?.trim() || null, source: 'manual' })
    .select(CONTACT_COLS)
    .single();
  if (error) {
    return { ok: false, error: error.code === '23505' ? 'That email is already a contact.' : error.message };
  }
  return { ok: true, contact: data as CrmContact };
}

export type CrmContactPatch = Partial<Pick<CrmContact, 'name' | 'company' | 'stage' | 'tags' | 'next_follow_up'>>;

export async function updateCrmContact(id: string, patch: CrmContactPatch): Promise<CrmContact | null> {
  const { data, error } = await supabase
    .from('crm_contacts')
    .update(patch)
    .eq('id', id)
    .select(CONTACT_COLS)
    .single();
  if (error) {
    log.error(`updateCrmContact | ${error.message}`);
    return null;
  }
  return data as CrmContact;
}

export async function deleteCrmContact(id: string): Promise<boolean> {
  const { error } = await supabase.from('crm_contacts').delete().eq('id', id);
  if (error) log.error(`deleteCrmContact | ${error.message}`);
  return !error;
}

export async function fetchCrmNotes(contactId: string): Promise<CrmNote[]> {
  const { data, error } = await supabase
    .from('crm_notes')
    .select(NOTE_COLS)
    .eq('contact_id', contactId)
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) {
    log.error(`fetchCrmNotes | ${error.message}`);
    return [];
  }
  return (data ?? []) as CrmNote[];
}

export async function addCrmNote(contactId: string, body: string): Promise<CrmNote | null> {
  const text = body.trim();
  if (!text) return null;
  const { data: { user } } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('crm_notes')
    .insert({ contact_id: contactId, body: text, author_id: user?.id, author_email: user?.email ?? null })
    .select(NOTE_COLS)
    .single();
  if (error) {
    log.error(`addCrmNote | ${error.message}`);
    return null;
  }
  return data as CrmNote;
}

export async function deleteCrmNote(id: string): Promise<boolean> {
  const { error } = await supabase.from('crm_notes').delete().eq('id', id);
  if (error) log.error(`deleteCrmNote | ${error.message}`);
  return !error;
}

// ── Pure helpers (unit-tested) ───────────────────────────────────────────────

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

/** "vip, LA , vip" → ['vip', 'LA'] (trimmed, de-duplicated case-insensitively, order kept). */
export function parseTags(input: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input.split(/[,\n]/)) {
    const t = raw.trim().slice(0, 30);
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out.slice(0, 20);
}

export type FollowUpStatus = 'overdue' | 'today' | 'soon' | 'later';

/** Where a follow-up date sits relative to `today` (YYYY-MM-DD strings, no time zones involved). */
export function followUpStatus(date: string | null, today: string): FollowUpStatus | null {
  if (!date) return null;
  if (date < today) return 'overdue';
  if (date === today) return 'today';
  const d = new Date(`${date}T00:00:00Z`).getTime();
  const t = new Date(`${today}T00:00:00Z`).getTime();
  return d - t <= 7 * 86_400_000 ? 'soon' : 'later';
}

export interface CrmFilter {
  stage: CrmStage | 'all';
  query: string;
}

export function filterContacts(contacts: CrmContact[], filter: CrmFilter): CrmContact[] {
  const q = filter.query.trim().toLowerCase();
  return contacts.filter(c => {
    if (filter.stage !== 'all' && c.stage !== filter.stage) return false;
    if (!q) return true;
    return [c.email, c.name ?? '', c.company ?? '', ...c.tags].some(v => v.toLowerCase().includes(q));
  });
}

const FOLLOW_UP_RANK: Record<FollowUpStatus, number> = { overdue: 0, today: 1, soon: 2, later: 3 };

/** Follow-ups that need attention first (overdue → today → soon), then most recently updated. */
export function sortContacts(contacts: CrmContact[], today: string): CrmContact[] {
  return [...contacts].sort((a, b) => {
    const fa = followUpStatus(a.next_follow_up, today);
    const fb = followUpStatus(b.next_follow_up, today);
    const ra = fa ? FOLLOW_UP_RANK[fa] : 9;
    const rb = fb ? FOLLOW_UP_RANK[fb] : 9;
    if (ra !== rb) return ra - rb;
    return b.updated_at.localeCompare(a.updated_at);
  });
}

export function stageCounts(contacts: CrmContact[]): Record<CrmStage | 'all', number> {
  const counts = { all: contacts.length, lead: 0, approved: 0, active: 0, churned: 0, lost: 0 };
  for (const c of contacts) counts[c.stage]++;
  return counts;
}

/** Local calendar date as YYYY-MM-DD (follow-ups are dates, not instants). */
export function todayKey(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
