import { describe, it, expect, beforeEach, vi } from 'vitest';
import brandJson from '../../brand.json';

const rpc = vi.fn();
vi.mock('./supabase', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));

/**
 * The runtime brand store (070_runtime_brand.sql). Hydration order: build
 * (brand.json) → cache (localStorage, read at import) → remote (public_brand),
 * and every step fails quiet. Each test imports a FRESH module so the
 * import-time cache read is what is being tested.
 */
async function freshStore() {
  vi.resetModules();
  return import('./brandStore');
}

const remote = { name: 'Acorn', descriptor: 'Listings in a hurry', tagline: 'Acorn lists your rack.', updated_at: '2026-11-22T00:00:00Z' };

beforeEach(() => {
  rpc.mockReset();
  localStorage.clear();
});

describe('seed', () => {
  it('starts on the build values from brand.json, synchronously', async () => {
    const s = await freshStore();
    expect(s.getBrand()).toEqual({
      name: brandJson.name, descriptor: brandJson.descriptor, tagline: brandJson.tagline, source: 'build',
    });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('cache', () => {
  it('reads sortbot_brand at import, before any fetch', async () => {
    localStorage.setItem('sortbot_brand', JSON.stringify({ name: 'Acorn', descriptor: 'D', tagline: 'T' }));
    const s = await freshStore();
    expect(s.getBrand()).toEqual({ name: 'Acorn', descriptor: 'D', tagline: 'T', source: 'cache' });
  });

  it('ignores a corrupt or unusable cache and keeps the build value', async () => {
    localStorage.setItem('sortbot_brand', '{not json');
    expect((await freshStore()).getBrand().source).toBe('build');
    localStorage.setItem('sortbot_brand', JSON.stringify({ name: 'x'.repeat(25) }));
    expect((await freshStore()).getBrand().source).toBe('build');
    localStorage.setItem('sortbot_brand', JSON.stringify({ name: 'Two\nlines' }));
    expect((await freshStore()).getBrand().source).toBe('build');
  });

  it('keeps the build descriptor when only the name is cached', async () => {
    localStorage.setItem('sortbot_brand', JSON.stringify({ name: 'Acorn' }));
    const b = (await freshStore()).getBrand();
    expect(b.name).toBe('Acorn');
    expect(b.descriptor).toBe(brandJson.descriptor);
  });
});

describe('remote hydrate', () => {
  it('applies public_brand, notifies subscribers and writes the cache', async () => {
    rpc.mockResolvedValue({ data: remote, error: null });
    const s = await freshStore();
    const listener = vi.fn();
    s.brandStore.subscribe(listener);
    const b = await s.hydrateBrand();
    expect(rpc).toHaveBeenCalledWith('public_brand');
    expect(b).toEqual({ name: 'Acorn', descriptor: 'Listings in a hurry', tagline: 'Acorn lists your rack.', source: 'remote' });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(JSON.parse(localStorage.getItem('sortbot_brand')!)).toEqual({
      name: 'Acorn', descriptor: 'Listings in a hurry', tagline: 'Acorn lists your rack.',
    });
  });

  it('remote beats the cache', async () => {
    localStorage.setItem('sortbot_brand', JSON.stringify({ name: 'Old' }));
    rpc.mockResolvedValue({ data: remote, error: null });
    const s = await freshStore();
    expect(s.getBrand().name).toBe('Old');
    await s.hydrateBrand();
    expect(s.getBrand().name).toBe('Acorn');
  });

  it('asks once per page load unless forced', async () => {
    rpc.mockResolvedValue({ data: remote, error: null });
    const s = await freshStore();
    await Promise.all([s.hydrateBrand(), s.hydrateBrand()]);
    await s.hydrateBrand();
    expect(rpc).toHaveBeenCalledTimes(1);
    await s.hydrateBrand({ force: true });
    expect(rpc).toHaveBeenCalledTimes(2);
  });
});

describe('fail quiet', () => {
  it.each([
    ['a missing function', { data: null, error: { code: 'PGRST202', message: 'not found' } }],
    ['a server error', { data: null, error: { code: '500', message: 'boom' } }],
    ['an empty payload', { data: null, error: null }],
    ['a payload with no usable name', { data: { name: '', descriptor: 'x' }, error: null }],
  ])('keeps the build value on %s', async (_label, answer) => {
    rpc.mockResolvedValue(answer);
    const s = await freshStore();
    const b = await s.hydrateBrand();
    expect(b.source).toBe('build');
    expect(b.name).toBe(brandJson.name);
    expect(localStorage.getItem('sortbot_brand')).toBeNull();
  });

  it('keeps the cached value when the request rejects', async () => {
    localStorage.setItem('sortbot_brand', JSON.stringify({ name: 'Acorn' }));
    rpc.mockRejectedValue(new Error('offline'));
    const s = await freshStore();
    await expect(s.hydrateBrand()).resolves.toMatchObject({ name: 'Acorn', source: 'cache' });
  });

  it('survives a localStorage that throws', async () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    rpc.mockResolvedValue({ data: remote, error: null });
    const s = await freshStore();
    expect(s.getBrand().source).toBe('build');
    expect((await s.hydrateBrand()).name).toBe('Acorn');
    get.mockRestore();
    set.mockRestore();
  });
});

describe('landingTitleFor', () => {
  it('is brand.json landingTitle for the build name and swaps the name otherwise', async () => {
    const s = await freshStore();
    expect(s.landingTitleFor(brandJson.name)).toBe(brandJson.landingTitle);
    expect(s.landingTitleFor('Acorn')).toBe(brandJson.landingTitle.split(brandJson.name).join('Acorn'));
  });
});
