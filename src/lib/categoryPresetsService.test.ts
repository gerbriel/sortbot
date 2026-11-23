import { describe, it, expect, vi, beforeEach } from 'vitest';

const calls: { table?: string; update?: unknown; insert?: unknown; eq?: unknown[] } = {};
let result: { data: unknown; error: unknown } = { data: { id: 'p1' }, error: null };

vi.mock('./supabase', () => {
  const chain = {
    update: (p: unknown) => { calls.update = p; return chain; },
    insert: (p: unknown) => { calls.insert = p; return chain; },
    eq: (...a: unknown[]) => { calls.eq = a; return chain; },
    select: () => chain,
    single: async () => result,
  };
  return {
    supabase: {
      from: (t: string) => { calls.table = t; return chain; },
      auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    },
  };
});

import { createCategoryPreset, updateCategoryPreset } from './categoryPresetsService';
import type { CategoryPresetInput } from './categoryPresets';

beforeEach(() => {
  for (const k of Object.keys(calls)) delete (calls as Record<string, unknown>)[k];
  result = { data: { id: 'p1' }, error: null };
});

describe('categoryPresetsService', () => {
  it('updateCategoryPreset sends only whitelisted, non-identity keys', async () => {
    await updateCategoryPreset('p1', {
      display_name: 'Tees',
      org_id: 'org-1',
      id: 'p1',
      user_id: 'u1',
      created_at: 'x',
      updated_at: 'y',
      not_a_column: 1,
    } as unknown as Partial<CategoryPresetInput>);
    expect(calls.table).toBe('category_presets');
    expect(calls.update).toEqual({ display_name: 'Tees' });
    expect(calls.eq).toEqual(['id', 'p1']);
  });

  it('throws the PostgREST error as is, code and message intact', async () => {
    result = { data: null, error: { code: 'PGRST204', message: "Could not find the 'x' column" } };
    await expect(updateCategoryPreset('p1', { display_name: 'A' })).rejects.toMatchObject({ code: 'PGRST204' });
  });

  it('refuses an update with no column in it instead of sending an empty PATCH', async () => {
    await expect(updateCategoryPreset('p1', { nope: 1 } as unknown as Partial<CategoryPresetInput>)).rejects.toThrow(/Nothing to save/);
    expect(calls.update).toBeUndefined();
  });

  it('createCategoryPreset strips id and timestamps and stamps the caller', async () => {
    await createCategoryPreset({
      category_name: 'tees_1', display_name: 'Tees', id: 'old', created_at: 'x', custom_sections: [],
    } as unknown as CategoryPresetInput);
    expect(calls.insert).toEqual({ category_name: 'tees_1', display_name: 'Tees', custom_sections: [], user_id: 'u1' });
  });
});
