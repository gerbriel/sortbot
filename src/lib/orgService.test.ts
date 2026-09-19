import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { User } from '@supabase/supabase-js';

vi.mock('./supabase', async () => {
  const { createSupabaseMock } = await import('./testing/supabaseMock');
  return { supabase: createSupabaseMock() };
});

import { supabase } from './supabase';
import { ensureOrganization } from './orgService';
import type { MockedSupabaseClient, MockCall } from './testing/supabaseMock';

const mock = (supabase as unknown as MockedSupabaseClient).__mock;
const user = (id: string): User => ({ id, email: `${id}@example.com` } as User);

/**
 * The in-flight dedupe (StrictMode double-invokes the bootstrap effect) was a
 * SINGLE module-level promise handed to ANY caller regardless of which user was
 * passed. A sign-out/sign-in inside the bootstrap window therefore resolved user
 * B's effect with user A's { org, role } — which drives setCurrentOrg, the
 * admin-only buttons and setAnalyticsContext({ orgId }).
 */
describe('ensureOrganization — in-flight dedupe is keyed by user', () => {
  const membershipFor = (uid: string) => ({
    org_id: `org-${uid}`,
    role: uid === 'alice' ? 'owner' : 'member',
    created_at: '2026-01-01T00:00:00Z',
    organizations: { id: `org-${uid}`, name: `${uid} Workspace`, slug: uid, plan: 'beta', created_at: '2026-01-01T00:00:00Z' },
  });

  const userIdOf = (c: MockCall) =>
    c.filters.find(f => f.kind === 'eq' && f.column === 'user_id')?.value as string | undefined;

  beforeEach(() => {
    mock.reset();
    mock.responder = (c) => {
      if (c.table === 'org_members' && c.op === 'select') {
        const uid = userIdOf(c);
        return { data: uid ? [membershipFor(uid)] : [], error: null };
      }
      return undefined;
    };
  });

  it('gives each concurrent caller ITS OWN user\'s workspace', async () => {
    const [a, b] = await Promise.all([
      ensureOrganization(user('alice')),
      ensureOrganization(user('bob')),
    ]);
    expect(a.mode).toBe('org');
    expect(b.mode).toBe('org');
    expect(a.mode === 'org' && a.org.id).toBe('org-alice');
    expect(a.mode === 'org' && a.role).toBe('owner');
    expect(b.mode === 'org' && b.org.id).toBe('org-bob');
    expect(b.mode === 'org' && b.role).toBe('member');
  });

  it('still dedupes two concurrent calls for the SAME user into one query', async () => {
    const [a, b] = await Promise.all([
      ensureOrganization(user('alice')),
      ensureOrganization(user('alice')),
    ]);
    expect(a).toBe(b); // the identical resolved object — one shared promise
    expect(mock.callsFor('org_members', 'select')).toHaveLength(1);
  });

  it('releases the key so a later call re-resolves', async () => {
    await ensureOrganization(user('alice'));
    await ensureOrganization(user('alice'));
    expect(mock.callsFor('org_members', 'select')).toHaveLength(2);
  });

  it('falls back to legacy mode when the tenancy tables are missing', async () => {
    mock.responder = (c) => (c.table === 'org_members' && c.op === 'select'
      ? { data: null, error: { code: '42P01', message: 'relation does not exist' } }
      : undefined);
    const res = await ensureOrganization(user('carol'));
    expect(res.mode).toBe('legacy');
  });
});

/**
 * seedWorkspaceIfEmpty — the repair that makes a founder-created workspace
 * usable. founder_console.sql creates the organizations row before its owner
 * has ever signed in, so that workspace has no categories: Step 2 would open
 * with nothing to drag onto. The seed therefore runs on every branch of
 * ensureOrganization that RESOLVES a workspace, not only on the one that
 * creates one.
 *
 * The default list itself is NOT tested here — it lives in categoriesService
 * and has exactly one home. What is tested is the guard: one read per
 * workspace per session, and nothing written to a workspace that is already
 * set up.
 */
describe('seedWorkspaceIfEmpty', () => {
  beforeEach(() => { mock.reset(); });

  it('seeds the default categories into a workspace that has none', async () => {
    const { seedWorkspaceIfEmpty } = await import('./orgService');
    mock.responder = () => undefined; // default: select → [], i.e. empty workspace
    await seedWorkspaceIfEmpty('org-empty-1');
    expect(mock.callsFor('categories', 'select')).toHaveLength(1);
    expect(mock.callsFor('categories', 'insert').length).toBeGreaterThan(0);
  });

  it('writes NOTHING to a workspace that already has categories', async () => {
    const { seedWorkspaceIfEmpty } = await import('./orgService');
    mock.responder = (c) => (c.table === 'categories' && c.op === 'select'
      ? { data: [{ id: 'cat-1' }], error: null }
      : undefined);
    await seedWorkspaceIfEmpty('org-full-1');
    expect(mock.callsFor('categories', 'select')).toHaveLength(1);
    expect(mock.callsFor('categories', 'insert')).toHaveLength(0);
  });

  it('checks a given workspace at most once per session', async () => {
    const { seedWorkspaceIfEmpty } = await import('./orgService');
    mock.responder = (c) => (c.table === 'categories' && c.op === 'select'
      ? { data: [{ id: 'cat-1' }], error: null }
      : undefined);
    await seedWorkspaceIfEmpty('org-once-1');
    await seedWorkspaceIfEmpty('org-once-1');
    await seedWorkspaceIfEmpty('org-once-1');
    expect(mock.callsFor('categories', 'select')).toHaveLength(1);
  });

  it('is a no-op without a workspace id, and never throws', async () => {
    const { seedWorkspaceIfEmpty } = await import('./orgService');
    await seedWorkspaceIfEmpty(null);
    await seedWorkspaceIfEmpty('');
    await seedWorkspaceIfEmpty(undefined);
    expect(mock.calls).toHaveLength(0);
  });

  it('swallows a failed read — a broken repair must never block a sign-in', async () => {
    const { seedWorkspaceIfEmpty } = await import('./orgService');
    mock.responder = (c) => (c.table === 'categories' && c.op === 'select'
      ? { data: null, error: { code: '42P01', message: 'relation does not exist' } }
      : undefined);
    await expect(seedWorkspaceIfEmpty('org-broken-1')).resolves.toBeUndefined();
    expect(mock.callsFor('categories', 'insert')).toHaveLength(0);
  });
});
