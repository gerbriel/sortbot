import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('./supabase', async () => {
  const { createSupabaseMock } = await import('./testing/supabaseMock');
  return { supabase: createSupabaseMock() };
});

import { supabase } from './supabase';
import {
  MARKETPLACE_NAMES, marketplaceName,
  normalizeMarketplaceSettings, canonicalizeVocabValue,
  fetchOrgMarketplaces, setMarketplaceEnabled, updateMarketplaceSettings,
  fetchVocab, upsertVocab, updateVocab, deleteVocab, buildVocabResolver,
  readBatchTargets, setBatchTargets,
  fetchPublications, upsertPublication, markPublicationStatus, publicationMatrix,
  VOCAB_KINDS, PUBLICATION_STATUSES,
  type VocabRow, type PublicationRow,
} from './marketplaceService';
import { MARKETPLACE_KEYS, CONDITION_GRADES } from './marketplaces/types';
import type { MockedSupabaseClient } from './testing/supabaseMock';

const mock = (supabase as unknown as MockedSupabaseClient).__mock;

const ORG = 'a0000000-0000-0000-0000-00000000000a';

const vocab = (o: Partial<VocabRow> & { id: string; canonical: string; marketplace_value: string }): VocabRow => ({
  org_id: null, marketplace: 'poshmark', kind: 'color', ...o,
});

const pub = (o: Partial<PublicationRow> & { id: string; product_group_id: string }): PublicationRow => ({
  batch_id: null, sku: null, marketplace: 'ebay', status: 'draft',
  external_id: null, url: null, price_cents: null, posted_at: null, sold_at: null, ...o,
});

beforeEach(() => mock.reset());

// ── The keys are the contract ───────────────────────────────────────────────

describe('marketplace identity', () => {
  it('names every key the contract declares — a missing one would render as a raw slug', () => {
    for (const key of MARKETPLACE_KEYS) {
      expect(MARKETPLACE_NAMES[key]).toBeTruthy();
      expect(marketplaceName(key)).toBe(MARKETPLACE_NAMES[key]);
    }
    expect(Object.keys(MARKETPLACE_NAMES).sort()).toEqual([...MARKETPLACE_KEYS].sort());
  });

  it('an unknown key falls through as itself rather than throwing', () => {
    expect(marketplaceName('tiktok')).toBe('tiktok');
  });
});

// ── org_marketplaces ────────────────────────────────────────────────────────

describe('normalizeMarketplaceSettings', () => {
  it('keeps the four known keys, trimmed', () => {
    expect(normalizeMarketplaceSettings({
      pricingRuleId: '  pf-ebay ', defaultCondition: 'excellent',
      shippingProfile: ' Flat 5.99 ', notes: ' watch the fees ',
    })).toEqual({
      pricingRuleId: 'pf-ebay', defaultCondition: 'excellent',
      shippingProfile: 'Flat 5.99', notes: 'watch the fees',
    });
  });

  it('drops unknown keys, blanks and wrong types — the column is free JSONB and may be hand-edited', () => {
    expect(normalizeMarketplaceSettings({
      pricingRuleId: 42, defaultCondition: '   ', shippingProfile: null,
      notes: { nested: true }, somethingElse: 'x',
    })).toEqual({});
  });

  it('a non-object (null, array, string, an older build) normalises to {}', () => {
    expect(normalizeMarketplaceSettings(null)).toEqual({});
    expect(normalizeMarketplaceSettings(undefined)).toEqual({});
    expect(normalizeMarketplaceSettings(['x'])).toEqual({});
    expect(normalizeMarketplaceSettings('{}')).toEqual({});
  });

  it('caps notes so one paste cannot bloat every read of the settings page', () => {
    const out = normalizeMarketplaceSettings({ notes: 'x'.repeat(5000) });
    expect(out.notes?.length).toBe(500);
  });
});

describe('fetchOrgMarketplaces', () => {
  it('projects named columns, filters to the org, and normalises settings on the way out', async () => {
    mock.responder = () => ({
      data: [
        { org_id: ORG, marketplace: 'ebay', enabled: true, settings: { pricingRuleId: 'pf-ebay', junk: 1 } },
        { org_id: ORG, marketplace: 'depop', enabled: false, settings: null },
      ],
      error: null,
    });
    const res = await fetchOrgMarketplaces(ORG);
    expect(res.status).toBe('ok');
    if (res.status !== 'ok') return;
    expect(res.rows.map(r => r.marketplace)).toEqual(['ebay', 'depop']);
    expect(res.rows[0].settings).toEqual({ pricingRuleId: 'pf-ebay' });
    expect(res.rows[1].settings).toEqual({});
    expect(res.rows[1].enabled).toBe(false);

    const call = mock.callsFor('org_marketplaces', 'select')[0];
    expect(call.columns).not.toBe('*');
    expect(call.filters).toEqual([{ kind: 'eq', column: 'org_id', value: ORG }]);
  });

  it('drops a row whose marketplace this build does not know — a retired key must not reach the UI', async () => {
    mock.responder = () => ({
      data: [
        { org_id: ORG, marketplace: 'ebay', enabled: true, settings: {} },
        { org_id: ORG, marketplace: 'tiktok', enabled: true, settings: {} },
      ],
      error: null,
    });
    const res = await fetchOrgMarketplaces(ORG);
    expect(res.status === 'ok' && res.rows.map(r => r.marketplace)).toEqual(['ebay']);
  });

  it('reports unavailable — not an error — when the migration has not been run', async () => {
    mock.responder = () => ({ data: null, error: { code: '42P01', message: 'relation does not exist' } });
    expect((await fetchOrgMarketplaces(ORG)).status).toBe('unavailable');
  });

  it('asks nothing at all without a workspace', async () => {
    expect(await fetchOrgMarketplaces('')).toEqual({ status: 'ok', rows: [] });
    expect(mock.calls.length).toBe(0);
  });
});

describe('setMarketplaceEnabled / updateMarketplaceSettings', () => {
  it('upserts on the composite key, sending org_id — it is half the conflict target', async () => {
    expect(await setMarketplaceEnabled(ORG, 'ebay', true)).toEqual({ ok: true });
    const call = mock.callsFor('org_marketplaces', 'upsert')[0];
    expect(call.payload).toEqual({ org_id: ORG, marketplace: 'ebay', enabled: true });
    expect(call.options).toEqual({ onConflict: 'org_id,marketplace' });
  });

  it('normalises settings BEFORE the write as well as after the read', async () => {
    await updateMarketplaceSettings(ORG, 'depop', {
      pricingRuleId: ' pf-depop ', notes: '  ',
    } as never);
    const call = mock.callsFor('org_marketplaces', 'upsert')[0];
    expect((call.payload as { settings: unknown }).settings).toEqual({ pricingRuleId: 'pf-depop' });
  });

  it('turns an RLS refusal into the admin-gate message, not a raw Postgres string', async () => {
    mock.responder = () => ({ data: null, error: { code: '42501', message: 'new row violates row-level security policy' } });
    expect(await setMarketplaceEnabled(ORG, 'ebay', true))
      .toEqual({ ok: false, error: expect.stringContaining('admin') });
  });

  it('turns a missing table into the setup message', async () => {
    mock.responder = () => ({ data: null, error: { code: '42P01', message: 'nope' } });
    expect(await setMarketplaceEnabled(ORG, 'ebay', true))
      .toEqual({ ok: false, error: expect.stringContaining('migration') });
  });

  it('refuses an unknown key before any query — the CHECK would reject it anyway, unreadably', async () => {
    expect(await setMarketplaceEnabled(ORG, 'tiktok' as never, true)).toEqual({
      ok: false, error: 'Unknown marketplace "tiktok".',
    });
    expect(mock.calls.length).toBe(0);
  });
});

// ── marketplace_vocab ───────────────────────────────────────────────────────

describe('canonicalizeVocabValue', () => {
  it('strips the whole Unicode whitespace set, as the SQL CHECK does — but never lower-cases', () => {
    expect(canonicalizeVocabValue('  Forest Green  ')).toBe('Forest Green');
    expect(canonicalizeVocabValue('\tEcko Unltd\n')).toBe('Ecko Unltd');
    expect(canonicalizeVocabValue(' Red ')).toBe('Red');
    expect(canonicalizeVocabValue('﻿Red')).toBe('Red');
    // Case survives: `canonical` is display text the seller reads back.
    expect(canonicalizeVocabValue('FOREST GREEN')).toBe('FOREST GREEN');
  });
});

describe('fetchVocab', () => {
  it('reads the global rows and the workspace rows and returns both, globals first', async () => {
    mock.responder = (call) => {
      const isGlobal = call.filters.some(f => f.kind === 'is' && f.column === 'org_id');
      return {
        data: isGlobal
          ? [{ id: 'g1', org_id: null, marketplace: 'poshmark', kind: 'color', canonical: 'Forest Green', marketplace_value: 'Multi' }]
          : [{ id: 'o1', org_id: ORG, marketplace: 'poshmark', kind: 'color', canonical: 'Forest Green', marketplace_value: 'Green' }],
        error: null,
      };
    };
    const res = await fetchVocab(ORG);
    expect(res.status).toBe('ok');
    if (res.status !== 'ok') return;
    expect(res.rows.map(r => r.id)).toEqual(['g1', 'o1']);
    expect(res.rows[0].org_id).toBeNull();

    const selects = mock.callsFor('marketplace_vocab', 'select');
    expect(selects.length).toBe(2);
    expect(selects[0].filters).toEqual([{ kind: 'is', column: 'org_id', value: null }]);
    expect(selects[1].filters).toEqual([{ kind: 'eq', column: 'org_id', value: ORG }]);
  });

  it('reads only the global rows when there is no workspace yet', async () => {
    mock.responder = () => ({ data: [], error: null });
    await fetchVocab(null);
    expect(mock.callsFor('marketplace_vocab', 'select').length).toBe(1);
  });

  it('reports unavailable when either half fails', async () => {
    mock.responder = (call) =>
      call.filters.some(f => f.kind === 'eq')
        ? { data: null, error: { code: '42P01', message: 'nope' } }
        : { data: [], error: null };
    expect((await fetchVocab(ORG)).status).toBe('unavailable');
  });
});

describe('upsertVocab', () => {
  it('inserts when nothing matches, sending org_id explicitly — null means GLOBAL, so it is never defaulted', async () => {
    mock.responder = (call) => (call.op === 'select' ? { data: [], error: null } : undefined);
    expect(await upsertVocab({
      orgId: ORG, marketplace: 'depop', kind: 'brand',
      canonical: '  Ecko Unltd  ', marketplaceValue: ' Ecko Unlimited ',
    })).toEqual({ ok: true });

    const insert = mock.callsFor('marketplace_vocab', 'insert')[0];
    expect(insert.payload).toEqual({
      org_id: ORG, marketplace: 'depop', kind: 'brand',
      canonical: 'Ecko Unltd', marketplace_value: 'Ecko Unlimited',
    });
  });

  it('a global row is written with org_id null, and the find looks in the global scope', async () => {
    mock.responder = (call) => (call.op === 'select' ? { data: [], error: null } : undefined);
    await upsertVocab({
      orgId: null, marketplace: 'poshmark', kind: 'condition',
      canonical: 'excellent', marketplaceValue: 'Excellent Used Condition',
    });
    const find = mock.callsFor('marketplace_vocab', 'select')[0];
    expect(find.filters).toEqual([
      { kind: 'eq', column: 'marketplace', value: 'poshmark' },
      { kind: 'eq', column: 'kind', value: 'condition' },
      { kind: 'is', column: 'org_id', value: null },
    ]);
    expect((mock.callsFor('marketplace_vocab', 'insert')[0].payload as { org_id: unknown }).org_id).toBeNull();
  });

  it('RE-POINTS an existing mapping by id — matched case-insensitively, the way the unique index does', async () => {
    mock.responder = (call) => (call.op === 'select'
      ? { data: [{ id: 'v1', canonical: 'Forest Green' }], error: null }
      : undefined);
    expect(await upsertVocab({
      orgId: ORG, marketplace: 'poshmark', kind: 'color',
      canonical: 'FOREST GREEN', marketplaceValue: 'Olive',
    })).toEqual({ ok: true });

    expect(mock.callsFor('marketplace_vocab', 'insert').length).toBe(0);
    const update = mock.callsFor('marketplace_vocab', 'update')[0];
    expect(update.payload).toEqual({ canonical: 'FOREST GREEN', marketplace_value: 'Olive' });
    expect(update.filters).toEqual([{ kind: 'eq', column: 'id', value: 'v1' }]);
  });

  it('matches through padding too — the row the index would collide with is the row we edit', async () => {
    mock.responder = (call) => (call.op === 'select'
      ? { data: [{ id: 'v1', canonical: 'Forest Green' }], error: null }
      : undefined);
    await upsertVocab({
      orgId: ORG, marketplace: 'poshmark', kind: 'color',
      canonical: '\tforest green ', marketplaceValue: 'Olive',
    });
    expect(mock.callsFor('marketplace_vocab', 'update').length).toBe(1);
  });

  it('a racing 23505 is a WIN — the other writer stored the same key', async () => {
    mock.responder = (call) => (call.op === 'select'
      ? { data: [], error: null }
      : { data: null, error: { code: '23505', message: 'duplicate key' } });
    expect(await upsertVocab({
      orgId: ORG, marketplace: 'depop', kind: 'brand', canonical: 'Ecko', marketplaceValue: 'Ecko Unltd',
    })).toEqual({ ok: true });
  });

  it('refuses blanks and unknown keys before any query', async () => {
    expect(await upsertVocab({ orgId: ORG, marketplace: 'depop', kind: 'brand', canonical: '  ', marketplaceValue: 'x' }).then(r => r.ok)).toBe(false);
    expect(await upsertVocab({ orgId: ORG, marketplace: 'depop', kind: 'brand', canonical: 'x', marketplaceValue: ' \t ' }).then(r => r.ok)).toBe(false);
    expect(await upsertVocab({ orgId: ORG, marketplace: 'tiktok' as never, kind: 'brand', canonical: 'x', marketplaceValue: 'y' }).then(r => r.ok)).toBe(false);
    expect(await upsertVocab({ orgId: ORG, marketplace: 'depop', kind: 'flavour' as never, canonical: 'x', marketplaceValue: 'y' }).then(r => r.ok)).toBe(false);
    expect(mock.calls.length).toBe(0);
  });

  it('updateVocab edits BY ROW ID — renaming a canonical must not leave a second row behind', async () => {
    mock.responder = () => ({ data: [{ id: 'v1' }], error: null });
    expect(await updateVocab('v1', '  Forrest Green ', ' Green ')).toEqual({ ok: true });
    // No find, no insert: exactly one statement, addressed by id.
    expect(mock.callsFor('marketplace_vocab', 'select').length).toBe(0);
    expect(mock.callsFor('marketplace_vocab', 'insert').length).toBe(0);
    const update = mock.callsFor('marketplace_vocab', 'update')[0];
    expect(update.payload).toEqual({ canonical: 'Forrest Green', marketplace_value: 'Green' });
    expect(update.filters).toEqual([{ kind: 'eq', column: 'id', value: 'v1' }]);
  });

  it('updateVocab reports a collision rather than merging two mappings together', async () => {
    mock.responder = () => ({ data: null, error: { code: '23505', message: 'duplicate key' } });
    expect(await updateVocab('v1', 'Forest Green', 'Green')).toEqual({
      ok: false, error: 'There is already a mapping for "Forest Green" here.',
    });
  });

  it('updateVocab treats 0 rows as a failure — a member editing a global row gets no error and no rows', async () => {
    mock.responder = () => ({ data: [], error: null });
    expect(await updateVocab('v1', 'Forest Green', 'Green')).toEqual({
      ok: false, error: 'That mapping is not yours to edit.',
    });
  });

  it('updateVocab refuses blanks before the query', async () => {
    expect((await updateVocab('v1', '  ', 'Green')).ok).toBe(false);
    expect((await updateVocab('v1', 'Forest Green', '\t ')).ok).toBe(false);
    expect((await updateVocab('', 'Forest Green', 'Green')).ok).toBe(false);
    expect(mock.calls.length).toBe(0);
  });

  it('deleteVocab keys on the row id and nothing else', async () => {
    expect(await deleteVocab('v1')).toEqual({ ok: true });
    expect(mock.callsFor('marketplace_vocab', 'delete')[0].filters)
      .toEqual([{ kind: 'eq', column: 'id', value: 'v1' }]);
  });
});

describe('buildVocabResolver', () => {
  it('a WORKSPACE row beats a GLOBAL row for the same key — that is the point of the two scopes', () => {
    const r = buildVocabResolver([
      vocab({ id: 'g', org_id: null, canonical: 'Forest Green', marketplace_value: 'Multi' }),
      vocab({ id: 'o', org_id: ORG, canonical: 'Forest Green', marketplace_value: 'Green' }),
    ]);
    expect(r.resolve('color', 'poshmark', 'Forest Green')).toBe('Green');
  });

  it('order does not decide it — the workspace row wins even when the global row comes last', () => {
    const r = buildVocabResolver([
      vocab({ id: 'o', org_id: ORG, canonical: 'Forest Green', marketplace_value: 'Green' }),
      vocab({ id: 'g', org_id: null, canonical: 'Forest Green', marketplace_value: 'Multi' }),
    ]);
    expect(r.resolve('color', 'poshmark', 'Forest Green')).toBe('Green');
  });

  it('brand matches through normalizeBrand — the Step 3 spelling memory and this agree', () => {
    const r = buildVocabResolver([
      vocab({ id: 'b', org_id: ORG, marketplace: 'depop', kind: 'brand', canonical: "Levi's", marketplace_value: 'Levi Strauss & Co.' }),
    ]);
    for (const spelling of ["Levi's", 'levis', 'LEVI’S', '  LEVIS  ']) {
      expect(r.resolve('brand', 'depop', spelling)).toBe('Levi Strauss & Co.');
    }
    // ...but the fold is normalizeBrand's, not a free-for-all: a space where
    // the brand has none is a DIFFERENT brand, and the resolver says so rather
    // than guessing (plan section 2c).
    expect(r.resolve('brand', 'depop', 'Levi s')).toBeNull();
  });

  it('other kinds fold case and whitespace but nothing else — "2X" and "2 X" stay different sizes', () => {
    const r = buildVocabResolver([
      vocab({ id: 'c', org_id: ORG, kind: 'color', canonical: 'Forest  Green', marketplace_value: 'Green' }),
      vocab({ id: 's', org_id: ORG, kind: 'size', marketplace: 'vinted', canonical: '2X', marketplace_value: 'XXL' }),
    ]);
    expect(r.resolve('color', 'poshmark', '  forest green ')).toBe('Green');
    expect(r.resolve('size', 'vinted', '2x')).toBe('XXL');
    expect(r.resolve('size', 'vinted', '2 X')).toBeNull();
  });

  it('is keyed per marketplace and per kind — a Poshmark colour is not a Vinted colour', () => {
    const r = buildVocabResolver([
      vocab({ id: 'p', org_id: null, marketplace: 'poshmark', kind: 'color', canonical: 'Forest Green', marketplace_value: 'Green' }),
    ]);
    expect(r.resolve('color', 'poshmark', 'Forest Green')).toBe('Green');
    expect(r.resolve('color', 'vinted', 'Forest Green')).toBeNull();
    expect(r.resolve('brand', 'poshmark', 'Forest Green')).toBeNull();
  });

  it('NEVER guesses — an unmapped value, a blank and a malformed row all resolve to null', () => {
    const r = buildVocabResolver([
      vocab({ id: 'ok', org_id: ORG, canonical: 'Red', marketplace_value: 'Red' }),
      vocab({ id: 'blank', org_id: ORG, canonical: 'Blue', marketplace_value: '' }),
      { id: 'bad', org_id: ORG, marketplace: 'tiktok' as never, kind: 'color', canonical: 'Teal', marketplace_value: 'Teal' },
      { id: 'bad2', org_id: ORG, marketplace: 'poshmark', kind: 'flavour' as never, canonical: 'Sour', marketplace_value: 'Sour' },
    ]);
    expect(r.resolve('color', 'poshmark', 'Red')).toBe('Red');
    expect(r.resolve('color', 'poshmark', 'Blue')).toBeNull();
    expect(r.resolve('color', 'poshmark', 'Teal')).toBeNull();
    expect(r.resolve('color', 'poshmark', '')).toBeNull();
    expect(r.resolve('color', 'poshmark', 'Chartreuse')).toBeNull();
  });

  it('an empty table resolves everything to null — the pre-migration state is not a crash', () => {
    const r = buildVocabResolver([]);
    for (const kind of VOCAB_KINDS) {
      for (const key of MARKETPLACE_KEYS) expect(r.resolve(kind, key, 'anything')).toBeNull();
    }
  });

  it('maps every canonical condition grade when the rows are there', () => {
    const r = buildVocabResolver(CONDITION_GRADES.map((g, i) => vocab({
      id: `c${i}`, org_id: null, marketplace: 'mercari', kind: 'condition',
      canonical: g, marketplace_value: `Mercari ${i + 1}`,
    })));
    for (const g of CONDITION_GRADES) expect(r.resolve('condition', 'mercari', g)).toBeTruthy();
  });
});

// ── workflow_batches.target_marketplaces ────────────────────────────────────

describe('readBatchTargets', () => {
  it('a batch saved before the migration has no column at all — that is [], not a crash', () => {
    expect(readBatchTargets(undefined)).toEqual([]);
    expect(readBatchTargets(null)).toEqual([]);
    expect(readBatchTargets({})).toEqual([]);
    expect(readBatchTargets({ target_marketplaces: null })).toEqual([]);
  });

  it('keeps order, drops unknown keys and de-duplicates', () => {
    expect(readBatchTargets({ target_marketplaces: ['depop', 'tiktok', 'ebay', 'depop'] }))
      .toEqual(['depop', 'ebay']);
  });
});

describe('setBatchTargets', () => {
  it('writes in MARKETPLACE_KEYS order, so two people toggling the same set store the same row', async () => {
    mock.responder = () => ({ data: [{ id: 'b1' }], error: null });
    expect(await setBatchTargets('b1', ['depop', 'ebay'])).toEqual({ ok: true });
    const call = mock.callsFor('workflow_batches', 'update')[0];
    expect(call.payload).toEqual({ target_marketplaces: ['ebay', 'depop'] });
    expect(call.filters).toEqual([{ kind: 'eq', column: 'id', value: 'b1' }]);
    expect(call.returning).toBe(true);
  });

  it('0 rows updated is a FAILURE, not a success — an RLS refusal returns no error and no rows', async () => {
    mock.responder = () => ({ data: [], error: null });
    expect(await setBatchTargets('b1', ['ebay'])).toEqual({
      ok: false, error: 'That batch is not in this workspace.',
    });
  });

  it('refuses an unknown key before the query rather than letting the CHECK reject the whole array', async () => {
    expect(await setBatchTargets('b1', ['ebay', 'tiktok'] as never)).toEqual({
      ok: false, error: 'Unknown marketplace: tiktok.',
    });
    expect(mock.calls.length).toBe(0);
  });

  it('clearing every target is a legitimate write', async () => {
    mock.responder = () => ({ data: [{ id: 'b1' }], error: null });
    expect(await setBatchTargets('b1', [])).toEqual({ ok: true });
    expect(mock.callsFor('workflow_batches', 'update')[0].payload).toEqual({ target_marketplaces: [] });
  });
});

// ── listing_publications ────────────────────────────────────────────────────

describe('fetchPublications', () => {
  it('narrows to one batch when asked, and to the workspace either way', async () => {
    mock.responder = () => ({ data: [], error: null });
    await fetchPublications(ORG, 'b1');
    expect(mock.callsFor('listing_publications', 'select')[0].filters).toEqual([
      { kind: 'eq', column: 'org_id', value: ORG },
      { kind: 'eq', column: 'batch_id', value: 'b1' },
    ]);
  });

  it('drops rows with an unknown marketplace or an unknown status', async () => {
    mock.responder = () => ({
      data: [
        { id: '1', product_group_id: 'g1', marketplace: 'ebay', status: 'live' },
        { id: '2', product_group_id: 'g1', marketplace: 'tiktok', status: 'live' },
        { id: '3', product_group_id: 'g1', marketplace: 'depop', status: 'shipped' },
      ],
      error: null,
    });
    const res = await fetchPublications(ORG);
    expect(res.status === 'ok' && res.rows.map(r => r.id)).toEqual(['1']);
  });

  it('reports unavailable pre-migration', async () => {
    mock.responder = () => ({ data: null, error: { code: 'PGRST205', message: 'not found' } });
    expect((await fetchPublications(ORG)).status).toBe('unavailable');
  });
});

describe('upsertPublication', () => {
  it('finds on the (group, marketplace) pair and INSERTS without org_id — the column default places the row', async () => {
    mock.responder = (call) => (call.op === 'select' ? { data: [], error: null } : undefined);
    expect(await upsertPublication({
      batchId: 'b1', productGroupId: 'g1', sku: 'ACD-3F7K2Q',
      marketplace: 'ebay', status: 'exported', priceCents: 4999,
    })).toEqual({ ok: true });

    const find = mock.callsFor('listing_publications', 'select')[0];
    expect(find.filters).toEqual([
      { kind: 'eq', column: 'product_group_id', value: 'g1' },
      { kind: 'eq', column: 'marketplace', value: 'ebay' },
    ]);
    const insert = mock.callsFor('listing_publications', 'insert')[0];
    expect(insert.payload).toEqual({
      status: 'exported', batch_id: 'b1', sku: 'ACD-3F7K2Q', price_cents: 4999,
      product_group_id: 'g1', marketplace: 'ebay',
    });
    expect(insert.payload).not.toHaveProperty('org_id');
  });

  it('UPDATES the existing cell, writing only the fields supplied — a connector must not blank what the feed wrote', async () => {
    mock.responder = (call) => {
      if (call.op === 'select') return { data: [{ id: 'p1' }], error: null };
      return { data: [{ id: 'p1' }], error: null };
    };
    expect(await upsertPublication({
      productGroupId: 'g1', marketplace: 'ebay', status: 'live',
      externalId: '1234567890', url: 'https://ebay.test/itm/1234567890',
    })).toEqual({ ok: true });

    expect(mock.callsFor('listing_publications', 'insert').length).toBe(0);
    const update = mock.callsFor('listing_publications', 'update')[0];
    expect(update.payload).toEqual({
      status: 'live', external_id: '1234567890', url: 'https://ebay.test/itm/1234567890',
    });
    expect(update.payload).not.toHaveProperty('price_cents');
    expect(update.payload).not.toHaveProperty('sku');
  });

  it('an explicit null IS written — clearing a url is different from not mentioning it', async () => {
    mock.responder = (call) => (call.op === 'select'
      ? { data: [{ id: 'p1' }], error: null }
      : { data: [{ id: 'p1' }], error: null });
    await upsertPublication({ productGroupId: 'g1', marketplace: 'ebay', status: 'removed', url: null });
    expect(mock.callsFor('listing_publications', 'update')[0].payload)
      .toEqual({ status: 'removed', url: null });
  });

  it('0 rows updated is a failure', async () => {
    mock.responder = (call) => (call.op === 'select'
      ? { data: [{ id: 'p1' }], error: null }
      : { data: [], error: null });
    expect((await upsertPublication({ productGroupId: 'g1', marketplace: 'ebay', status: 'live' })).ok).toBe(false);
  });

  it('a racing 23505 on the unique triple is a win', async () => {
    mock.responder = (call) => (call.op === 'select'
      ? { data: [], error: null }
      : { data: null, error: { code: '23505', message: 'duplicate key' } });
    expect(await upsertPublication({ productGroupId: 'g1', marketplace: 'ebay', status: 'draft' }))
      .toEqual({ ok: true });
  });

  it('refuses an unknown status or marketplace before any query', async () => {
    expect((await upsertPublication({ productGroupId: 'g1', marketplace: 'ebay', status: 'shipped' as never })).ok).toBe(false);
    expect((await upsertPublication({ productGroupId: 'g1', marketplace: 'tiktok' as never, status: 'live' })).ok).toBe(false);
    expect((await upsertPublication({ productGroupId: '', marketplace: 'ebay', status: 'live' })).ok).toBe(false);
    expect(mock.calls.length).toBe(0);
  });

  it('markPublicationStatus checks the row count too', async () => {
    mock.responder = () => ({ data: [{ id: 'p1' }], error: null });
    expect(await markPublicationStatus('p1', 'sold')).toEqual({ ok: true });
    expect(mock.callsFor('listing_publications', 'update')[0].payload).toEqual({ status: 'sold' });

    mock.reset();
    mock.responder = () => ({ data: [], error: null });
    expect((await markPublicationStatus('p1', 'sold')).ok).toBe(false);
  });

  it('every status in the union is accepted — the client list and the CHECK must not drift', async () => {
    for (const status of PUBLICATION_STATUSES) {
      mock.reset();
      mock.responder = (call) => (call.op === 'select' ? { data: [], error: null } : undefined);
      expect(await upsertPublication({ productGroupId: 'g1', marketplace: 'ebay', status })).toEqual({ ok: true });
    }
  });
});

describe('publicationMatrix', () => {
  it('groups listing → marketplace → row, keeping input order', () => {
    const m = publicationMatrix([
      pub({ id: '1', product_group_id: 'g1', marketplace: 'ebay', status: 'live' }),
      pub({ id: '2', product_group_id: 'g1', marketplace: 'depop', status: 'posted' }),
      pub({ id: '3', product_group_id: 'g2', marketplace: 'ebay', status: 'sold' }),
    ]);
    expect([...m.keys()]).toEqual(['g1', 'g2']);
    expect([...(m.get('g1') ?? new Map()).keys()]).toEqual(['ebay', 'depop']);
    expect(m.get('g1')?.get('ebay')?.status).toBe('live');
    expect(m.get('g2')?.get('depop')).toBeUndefined();
  });

  it('is total — an empty list, a malformed row and a missing group id do not throw', () => {
    expect(publicationMatrix([]).size).toBe(0);
    const m = publicationMatrix([
      pub({ id: '1', product_group_id: '' }),
      { ...pub({ id: '2', product_group_id: 'g1' }), marketplace: 'tiktok' as never },
      pub({ id: '3', product_group_id: 'g1', marketplace: 'etsy' }),
    ]);
    expect(m.size).toBe(1);
    expect([...(m.get('g1') ?? new Map()).keys()]).toEqual(['etsy']);
  });

  it('a later row for the same cell wins, so concatenating two fetches is safe', () => {
    const m = publicationMatrix([
      pub({ id: 'old', product_group_id: 'g1', marketplace: 'ebay', status: 'draft' }),
      pub({ id: 'new', product_group_id: 'g1', marketplace: 'ebay', status: 'live' }),
    ]);
    expect(m.get('g1')?.get('ebay')?.id).toBe('new');
  });
});
