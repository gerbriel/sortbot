import { describe, it, expect } from 'vitest';
import { aliasCandidates, saveBrandAlias } from './brandAliasService';
import { rankBrandMatches, resolveHeardBrand } from './brandSpelling';
import type { BrandAlias } from './brandAliasService';

const alias = (heard: string, preferred: string): BrandAlias => ({
  id: `${heard}-id`, heard, preferred,
  created_by_email: null, created_at: '', updated_at: '',
});

/**
 * The alias APPLICATION path — saved rows become matcher candidates, and an
 * exact hit on the misheard phrase is applied rather than suggested.
 * (The Supabase calls themselves are covered by the migration verification;
 * these are the guards that run before any network call.)
 */
describe('alias application', () => {
  const rows = [alias('echo unlimited', 'Ecko Unltd'), alias('foo boo', 'FUBU')];

  it('turns saved rows into alias-source candidates that keep the heard key', () => {
    expect(aliasCandidates(rows)).toEqual([
      { brand: 'Ecko Unltd', source: 'alias', heard: 'echo unlimited' },
      { brand: 'FUBU', source: 'alias', heard: 'foo boo' },
    ]);
  });

  it('an exact heard hit is APPLIED (not merely suggested), whatever the casing', () => {
    for (const spoken of ['echo unlimited', 'Echo Unlimited', '  ECHO UNLIMITED ']) {
      const r = resolveHeardBrand(spoken, aliasCandidates(rows));
      expect(r.brand, spoken).toBe('Ecko Unltd');
      expect(r.applied?.reason, spoken).toBe('alias');
    }
  });

  it('a near-miss on a saved phrase still only suggests', () => {
    const r = resolveHeardBrand('echo unlimited co', aliasCandidates(rows));
    expect(r.applied).toBeUndefined();
    expect(r.suggestion?.brand).toBe('Ecko Unltd');
  });

  it('a workspace alias outranks a same-scoring global candidate', () => {
    const [top] = rankBrandMatches('foo boo', [
      ...aliasCandidates(rows),
      { brand: 'Foo Boo Apparel', source: 'builtin' },
    ]);
    expect(top).toMatchObject({ brand: 'FUBU', source: 'alias' });
  });

  it('refuses to save a blank or circular correction before touching the network', async () => {
    expect(await saveBrandAlias('', 'Ecko Unltd')).toMatchObject({ ok: false });
    expect(await saveBrandAlias('echo unlimited', '   ')).toMatchObject({ ok: false });
    // "Ecko Unltd" → "ecko unltd." is the same brand; storing it would make the
    // matcher chase its own tail on every dictation.
    expect(await saveBrandAlias('Ecko Unltd', 'ecko unltd.')).toMatchObject({ ok: false });
  });
});
