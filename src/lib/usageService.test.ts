import { describe, it, expect, beforeEach, vi } from 'vitest';

const rpc = vi.fn();
const select = vi.fn();

vi.mock('./supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    from: (table: string) => ({ select: (cols: string) => select(table, cols) }),
  },
}));

import {
  fetchOrgUsage, fetchProjectUsage, fetchPlanLimits, setPlanLimits,
  usageReadout, limitLabel, listingBasisCopy, planDisplayName, parseLimitInput,
  formatGb, formatCount, normalizeOrgUsage, normalizeProjectUsage, BYTES_PER_GB,
} from './usageService';

/**
 * The 069 contract, coded against before the SQL exists. What matters most is
 * the error mapping: a missing function must read as 'unavailable' (every meter
 * hides), 42501 as 'forbidden', and anything else as 'error' with the message.
 */

const GB = BYTES_PER_GB;

const orgPayload = {
  org_id: 'org-1',
  plan: 'pro',
  limits: { listings_per_month: 500, storage_gb: 10, seats: 5 },
  usage: { storage_bytes: 2 * GB, files: 1234, listings_this_month: 42, members: 3, month_start: '2026-11-01' },
  listing_basis: 'exported',
};

beforeEach(() => {
  rpc.mockReset();
  select.mockReset();
});

describe('fetchOrgUsage', () => {
  it('calls org_usage with p_org and returns the normalised row', async () => {
    rpc.mockResolvedValue({ data: orgPayload, error: null });
    const res = await fetchOrgUsage('org-1');
    expect(rpc).toHaveBeenCalledWith('org_usage', { p_org: 'org-1' });
    expect(res).toEqual({ status: 'ok', data: orgPayload });
  });

  it.each(['42883', 'PGRST202', 'PGRST302'])('reads a missing function (%s) as unavailable', async (code) => {
    rpc.mockResolvedValue({ data: null, error: { code, message: 'nope' } });
    expect(await fetchOrgUsage('org-1')).toEqual({ status: 'unavailable' });
  });

  it('reads 22023 (a founder asking for a missing org) as an error', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '22023', message: 'no such workspace' } });
    expect(await fetchOrgUsage('missing')).toEqual({ status: 'error', message: 'no such workspace' });
  });

  it('reads 42501 as forbidden', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'not a member' } });
    expect(await fetchOrgUsage('org-1')).toEqual({ status: 'forbidden' });
  });

  it('reads anything else as an error with the message', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'XX000', message: 'boom' } });
    expect(await fetchOrgUsage('org-1')).toEqual({ status: 'error', message: 'boom' });
  });

  it('treats an empty answer as an error, not a zero reading', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    expect((await fetchOrgUsage('org-1')).status).toBe('error');
  });
});

describe('normalizeOrgUsage', () => {
  it('coerces bigint strings, keeps null limits as unlimited and defaults the basis', () => {
    const n = normalizeOrgUsage({
      org_id: 'o', plan: 'beta',
      limits: { listings_per_month: null, storage_gb: '25', seats: 'junk' },
      usage: { storage_bytes: '1073741824', files: '7', listings_this_month: null, members: 2, month_start: '2026-11-01' },
      listing_basis: 'weird',
    });
    expect(n.limits).toEqual({ listings_per_month: null, storage_gb: 25, seats: null });
    expect(n.usage.storage_bytes).toBe(GB);
    expect(n.usage.files).toBe(7);
    expect(n.usage.listings_this_month).toBe(0);
    expect(n.listing_basis).toBe('created');
  });

  it('survives a null payload', () => {
    const n = normalizeOrgUsage(null);
    expect(n.limits).toEqual({ listings_per_month: null, storage_gb: null, seats: null });
    expect(n.usage.members).toBe(0);
  });

  it('keeps the exported basis', () => {
    expect(normalizeOrgUsage({ listing_basis: 'exported' }).listing_basis).toBe('exported');
  });
});

describe('fetchProjectUsage', () => {
  it('calls project_usage and sorts workspaces by storage, largest first', async () => {
    rpc.mockResolvedValue({
      data: {
        project: {
          storage_gb_quota: 100, storage_bytes_total: 3 * GB, files_total: 10, orgs: 2,
          members_total: 4, listings_this_month_total: 9, month_start: '2026-11-01', listing_basis: 'created',
        },
        orgs: [
          { org_id: 'a', name: 'Small', plan: 'beta', storage_bytes: 1, files: 1, listings_this_month: 1, members: 1, limits: {} },
          { org_id: 'b', name: 'Big', plan: 'pro', storage_bytes: 3 * GB, files: 9, listings_this_month: 8, members: 3, limits: { seats: 5 } },
        ],
      },
      error: null,
    });
    const res = await fetchProjectUsage();
    expect(rpc).toHaveBeenCalledWith('project_usage');
    expect(res.status).toBe('ok');
    if (res.status !== 'ok') return;
    expect(res.data.orgs.map(o => o.name)).toEqual(['Big', 'Small']);
    expect(res.data.orgs[0].limits.seats).toBe(5);
    expect(res.data.orgs[1].limits.storage_gb).toBeNull();
    expect(res.data.project.listing_basis).toBe('created');
    expect(res.data.project.storage_gb_quota).toBe(100);
  });

  it('maps errors the same way', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'x' } });
    expect(await fetchProjectUsage()).toEqual({ status: 'unavailable' });
    rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'x' } });
    expect(await fetchProjectUsage()).toEqual({ status: 'forbidden' });
    rpc.mockResolvedValue({ data: null, error: null });
    expect((await fetchProjectUsage()).status).toBe('error');
  });

  it('normalises a payload with no orgs array and an unset quota', () => {
    const n = normalizeProjectUsage({ project: { storage_gb_quota: null } });
    expect(n.orgs).toEqual([]);
    expect(n.project.storage_gb_quota).toBeNull();
  });
});

describe('fetchPlanLimits', () => {
  it('reads the three limit columns off the catalog', async () => {
    select.mockResolvedValue({ data: [{ plan: 'pro', listings_per_month: 500, storage_gb: null, seats: 5 }], error: null });
    const res = await fetchPlanLimits();
    expect(select).toHaveBeenCalledWith('finance_plan_prices', 'plan, listings_per_month, storage_gb, seats');
    expect(res).toEqual({ status: 'ok', data: [{ plan: 'pro', listings_per_month: 500, storage_gb: null, seats: 5 }] });
  });

  it('reads a missing column as unavailable', async () => {
    select.mockResolvedValue({ data: null, error: { code: '42703', message: 'column does not exist' } });
    expect(await fetchPlanLimits()).toEqual({ status: 'unavailable' });
  });

  it('returns [] for a null data array', async () => {
    select.mockResolvedValue({ data: null, error: null });
    expect(await fetchPlanLimits()).toEqual({ status: 'ok', data: [] });
  });
});

describe('setPlanLimits', () => {
  it('sends the four parameters, nulls meaning unlimited', async () => {
    rpc.mockResolvedValue({ data: { plan: 'pro', listings_per_month: null, storage_gb: 25, seats: 3 }, error: null });
    const res = await setPlanLimits({ plan: ' Pro ', listingsPerMonth: null, storageGb: 25, seats: 3 });
    expect(rpc).toHaveBeenCalledWith('founding_set_plan_limits', {
      p_plan: 'pro', p_listings_per_month: null, p_storage_gb: 25, p_seats: 3,
    });
    expect(res).toEqual({ status: 'ok', data: { plan: 'pro', listings_per_month: null, storage_gb: 25, seats: 3 } });
  });

  it('accepts a one-row array and falls back to the input when the row is empty', async () => {
    rpc.mockResolvedValue({ data: [{ plan: 'pro', listings_per_month: 1, storage_gb: 2, seats: 3 }], error: null });
    expect((await setPlanLimits({ plan: 'pro', listingsPerMonth: 1, storageGb: 2, seats: 3 })).status).toBe('ok');
    rpc.mockResolvedValue({ data: null, error: null });
    expect(await setPlanLimits({ plan: 'pro', listingsPerMonth: 9, storageGb: null, seats: 1 })).toEqual({
      status: 'ok', data: { plan: 'pro', listings_per_month: 9, storage_gb: null, seats: 1 },
    });
  });

  it('maps errors', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'x' } });
    expect(await setPlanLimits({ plan: 'pro', listingsPerMonth: 1, storageGb: 1, seats: 1 })).toEqual({ status: 'forbidden' });
    rpc.mockResolvedValue({ data: null, error: { code: '42883', message: 'x' } });
    expect(await setPlanLimits({ plan: 'pro', listingsPerMonth: 1, storageGb: 1, seats: 1 })).toEqual({ status: 'unavailable' });
    rpc.mockResolvedValue({ data: null, error: { code: '23514', message: 'check failed' } });
    expect(await setPlanLimits({ plan: 'pro', listingsPerMonth: 1, storageGb: 1, seats: 1 }))
      .toEqual({ status: 'error', message: 'check failed' });
  });
});

describe('usageReadout', () => {
  it('formats a storage meter in GB with one decimal', () => {
    const r = usageReadout(2.54 * GB, 10, 'bytes');
    expect(r.usedText).toBe('2.5 GB');
    expect(r.limitText).toBe('10 GB');
    expect(r.text).toBe('2.5 GB of 10 GB');
    expect(r.percent).toBe(25);
    expect(r).toMatchObject({ nearLimit: false, over: false, unlimited: false, tone: 'ok' });
  });

  it('formats counts with thousands separators', () => {
    const r = usageReadout(1234, 5000);
    expect(r.text).toBe('1,234 of 5,000');
  });

  it('is nearLimit at 85%', () => {
    expect(usageReadout(84, 100).nearLimit).toBe(false);
    const r = usageReadout(85, 100);
    expect(r).toMatchObject({ nearLimit: true, over: false, tone: 'warn' });
  });

  it('is over at 100% and clamps the bar', () => {
    expect(usageReadout(100, 100)).toMatchObject({ over: true, tone: 'over', percent: 100 });
    const r = usageReadout(310, 100);
    expect(r.percent).toBe(100);
    expect(r.over).toBe(true);
    expect(r.nearLimit).toBe(true);
  });

  it('is unlimited when the limit is null', () => {
    const r = usageReadout(2 * GB, null, 'bytes');
    expect(r).toMatchObject({ unlimited: true, percent: 0, nearLimit: false, over: false, limitText: 'Unlimited' });
    expect(r.text).toBe('2.0 GB · Unlimited');
  });

  it('treats a zero limit as a real one', () => {
    expect(usageReadout(0, 0)).toMatchObject({ over: false, percent: 0 });
    expect(usageReadout(1, 0)).toMatchObject({ over: true, percent: 100 });
  });

  it('survives junk', () => {
    expect(usageReadout(Number.NaN, 10).usedText).toBe('0');
    expect(usageReadout(-5, 10).percent).toBe(0);
    expect(usageReadout(5, Number.NaN).unlimited).toBe(true);
  });
});

describe('formatters and copy', () => {
  it('formatGb and formatCount', () => {
    expect(formatGb(0)).toBe('0.0 GB');
    expect(formatGb(1500 * GB)).toBe('1,500.0 GB');
    expect(formatGb(Number.NaN)).toBe('0.0 GB');
    expect(formatCount(12345)).toBe('12,345');
    expect(formatCount(Number.NaN)).toBe('0');
  });

  it('limitLabel', () => {
    expect(limitLabel(null, 'GB')).toBe('Unlimited');
    expect(limitLabel(10, 'GB')).toBe('10 GB');
    expect(limitLabel(1, 'GB')).toBe('1 GB');
    expect(limitLabel(1500, 'listings')).toBe('1,500 listings');
    expect(limitLabel(1, 'seats')).toBe('1 seat');
    expect(limitLabel(5)).toBe('5');
  });

  it('listingBasisCopy', () => {
    expect(listingBasisCopy('exported')).toBe('listings exported this month');
    expect(listingBasisCopy('created')).toBe('listings created this month');
  });

  it('planDisplayName', () => {
    expect(planDisplayName('founding_pro')).toBe('Founding pro');
    expect(planDisplayName('beta')).toBe('Beta');
    expect(planDisplayName(null)).toBe('No plan');
  });

  it('parseLimitInput', () => {
    expect(parseLimitInput('')).toBeNull();
    expect(parseLimitInput('  ')).toBeNull();
    expect(parseLimitInput('1,000')).toBe(1000);
    expect(parseLimitInput('2.5')).toBe(2.5);
    expect(parseLimitInput('-1')).toBeUndefined();
    expect(parseLimitInput('abc')).toBeUndefined();
  });
});
