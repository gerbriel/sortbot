import { describe, it, expect } from 'vitest';
import {
  CATEGORY_PRESET_COLUMNS,
  CATEGORY_PRESET_UPDATE_STRIPPED,
  toCategoryPresetPayload,
} from './categoryPresets';

/**
 * The owner's "Failed to save preset": PostgREST rejects the WHOLE write with
 * PGRST204 / 42703 when one key is not a column. The editor used to send
 * `custom_sections` (no migration before 075) on every save. Locked here: only
 * real columns leave the client, and identity, tenancy and timestamps never
 * go on an UPDATE.
 */

// The exact shape the old handleEdit wrote into formData, plus what the old
// submit added and what a full row read back from select('*') carries.
const handleEditPayload = {
  category_name: 'tees_ab12cd34',
  display_name: 'Tees',
  description: 'Short sleeve',
  default_weight_value: '0.5',
  default_weight_unit: 'lb',
  requires_shipping: true,
  product_type: 'Tees',
  vendor: undefined,
  suggested_price_min: 20,
  suggested_price_max: 40,
  default_material: 'Cotton',
  default_care_instructions: 'Cold wash',
  measurement_template: { width: true, length: true },
  seo_title_template: '{size} {brand}',
  seo_keywords: ['vintage'],
  shopify_product_type: 'Shirts',
  shopify_collection_id: undefined,
  default_tags: ['tee'],
  typical_condition: 'Good',
  is_active: true,
  package_dimensions: '10 x 8 x 2',
  parcel_size: '',
  ships_from: '1 Main St',
  continue_selling_out_of_stock: false,
  size_type: '',
  style: 'Vintage',
  gender: 'Men',
  age_group: 'Adult (13+ years old)',
  policies: 'No returns',
  renewal_options: 'Automatic',
  who_made_it: 'Another company or person',
  what_is_it: 'A finished product',
  listing_type: 'Physical item',
  discounted_shipping: 'No discount',
  custom_label_0: 'Top seller',
  default_status: 'Active',
  seo_description: 'Meta',
  custom_sections: [],
  // read-back row keys
  id: 'p1',
  org_id: 'org-1',
  user_id: 'u1',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-02T00:00:00Z',
  is_default: false,
  // things that are NOT columns
  _presetData: { displayName: 'x' },
  editing: true,
  pitToPit: true,
};

describe('category_presets payload whitelist', () => {
  it('sends no key outside CATEGORY_PRESET_COLUMNS', () => {
    const out = toCategoryPresetPayload(handleEditPayload, 'update');
    const cols = new Set<string>(CATEGORY_PRESET_COLUMNS);
    for (const k of Object.keys(out)) expect(cols.has(k), `unknown key ${k}`).toBe(true);
    expect(out).not.toHaveProperty('_presetData');
    expect(out).not.toHaveProperty('editing');
    expect(out).not.toHaveProperty('pitToPit');
  });

  it('never sends id, org_id, user_id, created_at or updated_at on UPDATE', () => {
    const out = toCategoryPresetPayload(handleEditPayload, 'update');
    for (const k of CATEGORY_PRESET_UPDATE_STRIPPED) expect(out).not.toHaveProperty(k);
  });

  it('keeps org_id on INSERT but drops id, user_id and the timestamps', () => {
    const out = toCategoryPresetPayload(handleEditPayload, 'insert');
    expect(out.org_id).toBe('org-1');
    for (const k of ['id', 'user_id', 'created_at', 'updated_at']) expect(out).not.toHaveProperty(k);
  });

  it('keeps every real column the editor writes, including the ones the old types lied about', () => {
    const out = toCategoryPresetPayload(handleEditPayload, 'update');
    for (const k of ['custom_sections', 'default_status', 'seo_description', 'age_group', 'measurement_template', 'is_default']) {
      expect(out).toHaveProperty(k);
    }
  });

  it('drops undefined and turns an empty CHECK or numeric value into NULL', () => {
    const out = toCategoryPresetPayload(handleEditPayload, 'update');
    expect(out).not.toHaveProperty('vendor');
    expect(out.parcel_size).toBeNull();
    expect(out.size_type).toBeNull();
    expect(toCategoryPresetPayload({ suggested_price_min: '' }, 'update')).toEqual({ suggested_price_min: null });
    // A plain text column keeps its empty string.
    expect(toCategoryPresetPayload({ description: '' }, 'update')).toEqual({ description: '' });
  });

  it('has no duplicate column names', () => {
    expect(new Set(CATEGORY_PRESET_COLUMNS).size).toBe(CATEGORY_PRESET_COLUMNS.length);
  });
});
