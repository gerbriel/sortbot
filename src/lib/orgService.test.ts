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
