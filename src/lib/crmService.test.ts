import { describe, it, expect } from 'vitest';
import {
  parseTags, followUpStatus, filterContacts, sortContacts, stageCounts, todayKey, isEmail,
  type CrmContact,
} from './crmService';

/** The CRM list logic the panel relies on — filtering, follow-up urgency, ordering. */

const contact = (over: Partial<CrmContact>): CrmContact => ({
  id: over.id ?? Math.random().toString(36).slice(2),
  email: 'shop@example.com',
  name: null,
  company: null,
  source: 'manual',
  stage: 'lead',
  tags: [],
  next_follow_up: null,
  user_id: null,
  org_id: null,
  last_seen_at: null,
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-01T00:00:00Z',
  ...over,
});

describe('crmService — pure helpers', () => {
  it('parses tags: trims, de-dupes case-insensitively, keeps first spelling', () => {
    expect(parseTags('vip, LA , vip, la,, ')).toEqual(['vip', 'LA']);
    expect(parseTags('')).toEqual([]);
    expect(parseTags('a\nb')).toEqual(['a', 'b']);
  });

  it('classifies follow-up urgency from plain date strings', () => {
    expect(followUpStatus(null, '2026-09-13')).toBeNull();
    expect(followUpStatus('2026-09-12', '2026-09-13')).toBe('overdue');
    expect(followUpStatus('2026-09-13', '2026-09-13')).toBe('today');
    expect(followUpStatus('2026-09-20', '2026-09-13')).toBe('soon');
    expect(followUpStatus('2026-09-21', '2026-09-13')).toBe('later');
  });

  it('filters by stage and free text across email, name, company and tags', () => {
    const list = [
      contact({ id: 'a', email: 'a@x.com', name: 'Ana', company: 'Cool Shop', stage: 'active', tags: ['vip'] }),
      contact({ id: 'b', email: 'b@x.com', name: 'Bo', company: 'Rack City', stage: 'lead' }),
    ];
    expect(filterContacts(list, { stage: 'all', query: '' }).map(c => c.id)).toEqual(['a', 'b']);
    expect(filterContacts(list, { stage: 'lead', query: '' }).map(c => c.id)).toEqual(['b']);
    expect(filterContacts(list, { stage: 'all', query: 'VIP' }).map(c => c.id)).toEqual(['a']);
    expect(filterContacts(list, { stage: 'all', query: 'rack' }).map(c => c.id)).toEqual(['b']);
    expect(filterContacts(list, { stage: 'active', query: 'rack' })).toEqual([]);
  });

  it('sorts overdue → today → soon → later → none, then newest update first', () => {
    const list = [
      contact({ id: 'none-old', updated_at: '2026-09-01T00:00:00Z' }),
      contact({ id: 'later', next_follow_up: '2026-10-01' }),
      contact({ id: 'none-new', updated_at: '2026-09-10T00:00:00Z' }),
      contact({ id: 'today', next_follow_up: '2026-09-13' }),
      contact({ id: 'overdue', next_follow_up: '2026-09-01' }),
      contact({ id: 'soon', next_follow_up: '2026-09-15' }),
    ];
    expect(sortContacts(list, '2026-09-13').map(c => c.id))
      .toEqual(['overdue', 'today', 'soon', 'later', 'none-new', 'none-old']);
  });

  it('counts stages and validates emails', () => {
    const counts = stageCounts([contact({ stage: 'lead' }), contact({ stage: 'active' }), contact({ stage: 'active' })]);
    expect(counts).toEqual({ all: 3, lead: 1, approved: 0, active: 2, churned: 0, lost: 0 });
    expect(isEmail('shop@example.com')).toBe(true);
    expect(isEmail('nope')).toBe(false);
    expect(todayKey(new Date(2026, 8, 5))).toBe('2026-09-05');
  });
});
