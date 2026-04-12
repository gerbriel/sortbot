import { useState, useEffect } from 'react';
import type {
  CategoryPreset,
  CategoryPresetInput,
  CustomFieldDefinition,
  CustomSection,
  CustomFieldType,
} from '../lib/categoryPresets';
import { DEFAULT_MEASUREMENT_TEMPLATES } from '../lib/categoryPresets';
import {
  getCategoryPresets,
  createCategoryPreset,
  updateCategoryPreset,
  deleteCategoryPreset,
} from '../lib/categoryPresetsService';
import { getCategories } from '../lib/categoriesService';
import type { Category } from '../lib/categories';
import './CategoryPresetsManager.css';

interface CategoryPresetsManagerProps {
  onClose: () => void;
}

// ─── helpers ────────────────────────────────────────────────────────────────

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

const FIELD_TYPES: { value: CustomFieldType; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'textarea', label: 'Text Area' },
  { value: 'select', label: 'Dropdown' },
  { value: 'checkbox', label: 'Checkbox' },
];

// Fixed IDs for the 9 built-in sections so their custom fields persist in the
// same customSections array but cannot be renamed/deleted/reordered.
const BUILTIN_SECTIONS: { id: string; title: string }[] = [
  { id: '__basic__',           title: 'Basic Information' },
  { id: '__shipping__',        title: 'Shipping & Physical Attributes' },
  { id: '__classification__',  title: 'Product Classification' },
  { id: '__pricing__',         title: 'Pricing Guidance' },
  { id: '__attributes__',      title: 'Product Attributes' },
  { id: '__shipping_csv__',    title: 'Shipping & Packaging (CSV Export)' },
  { id: '__classification_csv__', title: 'Product Classification (CSV Export)' },
  { id: '__policies__',        title: 'Policies & Marketplace (CSV Export)' },
  { id: '__measurements__',    title: 'Measurement Template' },
  { id: '__tags__',            title: 'Tags & SEO' },
];

function initBuiltinSections(existing: CustomSection[]): CustomSection[] {
  return BUILTIN_SECTIONS.map((bs, i) => {
    const found = existing.find(s => s.id === bs.id);
    return found ?? { id: bs.id, title: bs.title, order: i, fields: [] };
  });
}

function mergeAllSections(existing: CustomSection[]): CustomSection[] {
  const builtins = initBuiltinSections(existing);
  const customs = existing.filter(s => !BUILTIN_SECTIONS.some(b => b.id === s.id));
  return [...builtins, ...customs];
}

// ─── Field modal ─────────────────────────────────────────────────────────────

interface FieldModalProps {
  initial?: CustomFieldDefinition;
  onSave: (f: CustomFieldDefinition) => void;
  onClose: () => void;
}

const FieldModal: React.FC<FieldModalProps> = ({ initial, onSave, onClose }) => {
  const [label, setLabel] = useState(initial?.label ?? '');
  const [key, setKey] = useState(initial?.key ?? '');
  const [type, setType] = useState<CustomFieldType>(initial?.type ?? 'text');
  const [defaultValue, setDefaultValue] = useState(initial?.defaultValue ?? '');
  const [optionsText, setOptionsText] = useState(initial?.options?.join('\n') ?? '');
  const [keyTouched, setKeyTouched] = useState(!!initial);

  // auto-generate key from label
  const handleLabelChange = (v: string) => {
    setLabel(v);
    if (!keyTouched) {
      setKey(v.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''));
    }
  };

  const handleKeyChange = (v: string) => {
    setKeyTouched(true);
    setKey(v.toLowerCase().replace(/[^a-z0-9_]/g, ''));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!label.trim() || !key.trim()) return;
    onSave({
      id: initial?.id ?? uid(),
      label: label.trim(),
      key: key.trim(),
      type,
      defaultValue: defaultValue.trim(),
      options: type === 'select' ? optionsText.split('\n').map(o => o.trim()).filter(Boolean) : undefined,
      order: initial?.order ?? 0,
    });
  };

  return (
    <div className="field-modal-overlay">
      <div className="field-modal">
        <div className="field-modal-header">
          <h4>{initial ? 'Edit Field' : 'Add Field'}</h4>
          <button type="button" className="button-close" onClick={onClose}>✕</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Label *</label>
            <input
              type="text"
              value={label}
              onChange={e => handleLabelChange(e.target.value)}
              placeholder="e.g., Graphic Theme"
              required
              autoFocus
            />
          </div>
          <div className="form-group">
            <label>Key *</label>
            <input
              type="text"
              value={key}
              onChange={e => handleKeyChange(e.target.value)}
              placeholder="e.g., graphic_theme"
              required
            />
            <small>Used as a data identifier. Lowercase letters, numbers, underscores only.</small>
          </div>
          <div className="form-group">
            <label>Field Type</label>
            <select value={type} onChange={e => setType(e.target.value as CustomFieldType)}>
              {FIELD_TYPES.map(ft => (
                <option key={ft.value} value={ft.value}>{ft.label}</option>
              ))}
            </select>
          </div>
          {type === 'select' && (
            <div className="form-group">
              <label>Options (one per line)</label>
              <textarea
                value={optionsText}
                onChange={e => setOptionsText(e.target.value)}
                placeholder={"Vintage\nModern\nStreetWear"}
                rows={4}
              />
            </div>
          )}
          {type !== 'checkbox' && (
            <div className="form-group">
              <label>Default Value</label>
              <input
                type={type === 'number' ? 'number' : 'text'}
                value={defaultValue}
                onChange={e => setDefaultValue(e.target.value)}
                placeholder="Optional default value"
              />
            </div>
          )}
          <div className="form-actions">
            <button type="button" className="button button-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="button">Save Field</button>
          </div>
        </form>
      </div>
    </div>
  );
};

// ─── Section header with CRUD ─────────────────────────────────────────────────

interface SectionHeaderProps {
  title: string;
  isCustom: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onRename?: () => void;
  onDelete?: () => void;
}

const SectionHeader: React.FC<SectionHeaderProps> = ({
  title, isCustom, canMoveUp, canMoveDown,
  onMoveUp, onMoveDown, onRename, onDelete,
}) => (
  <div className="section-header-row">
    <h4>{title}</h4>
    {isCustom && (
      <div className="section-controls">
        {canMoveUp && (
          <button type="button" className="btn-icon" title="Move section up" onClick={onMoveUp}>↑</button>
        )}
        {canMoveDown && (
          <button type="button" className="btn-icon" title="Move section down" onClick={onMoveDown}>↓</button>
        )}
        <button type="button" className="btn-icon" title="Rename section" onClick={onRename}>✏️</button>
        <button type="button" className="btn-icon btn-danger" title="Delete section" onClick={onDelete}>🗑</button>
      </div>
    )}
  </div>
);

// ─── Custom fields block ──────────────────────────────────────────────────────

interface CustomFieldsBlockProps {
  fields: CustomFieldDefinition[];
  onAdd: () => void;
  onEdit: (f: CustomFieldDefinition) => void;
  onDelete: (id: string) => void;
  onMoveUp: (id: string) => void;
  onMoveDown: (id: string) => void;
}

const CustomFieldsBlock: React.FC<CustomFieldsBlockProps> = ({
  fields, onAdd, onEdit, onDelete, onMoveUp, onMoveDown,
}) => (
  <div className="custom-fields-block">
    {fields.map((f, idx) => (
      <div key={f.id} className="custom-field-row">
        <span className="custom-field-label">{f.label}</span>
        <span className="custom-field-type">{FIELD_TYPES.find(t => t.value === f.type)?.label}</span>
        {f.defaultValue && <span className="custom-field-default">default: {f.defaultValue}</span>}
        <div className="custom-field-actions">
          {idx > 0 && (
            <button type="button" className="btn-icon" onClick={() => onMoveUp(f.id)}>↑</button>
          )}
          {idx < fields.length - 1 && (
            <button type="button" className="btn-icon" onClick={() => onMoveDown(f.id)}>↓</button>
          )}
          <button type="button" className="btn-icon" onClick={() => onEdit(f)}>✏️</button>
          <button type="button" className="btn-icon btn-danger" onClick={() => onDelete(f.id)}>🗑</button>
        </div>
      </div>
    ))}
    <button type="button" className="button button-secondary button-sm" onClick={onAdd}>
      + Add Custom Field
    </button>
  </div>
);

// ─── Main component ───────────────────────────────────────────────────────────

const CategoryPresetsManager: React.FC<CategoryPresetsManagerProps> = ({ onClose }) => {
  const [presets, setPresets] = useState<CategoryPreset[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingPreset, setEditingPreset] = useState<CategoryPreset | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState<Partial<CategoryPresetInput>>({
    default_weight_unit: 'lb',
    requires_shipping: true,
    is_active: true,
  });

  // Gender filter toggle — persisted in localStorage
  const [genderFilter, setGenderFilter] = useState<'Men' | 'Women' | 'Kids'>(() => {
    return (localStorage.getItem('presets_gender_filter') as 'Men' | 'Women' | 'Kids') || 'Men';
  });

  const setGender = (g: 'Men' | 'Women' | 'Kids') => {
    setGenderFilter(g);
    localStorage.setItem('presets_gender_filter', g);
  };

  // Filtered presets by active gender
  const filteredPresets = presets.filter(p => (p as any).gender === genderFilter);

  // Custom sections state
  const [customSections, setCustomSections] = useState<CustomSection[]>([]);

  // Field modal state
  const [fieldModalOpen, setFieldModalOpen] = useState(false);
  const [fieldModalSectionId, setFieldModalSectionId] = useState<string>('');
  const [fieldModalEditing, setFieldModalEditing] = useState<CustomFieldDefinition | undefined>(undefined);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const [presetsData, categoriesData] = await Promise.all([
        getCategoryPresets(),
        getCategories(),
      ]);
      setPresets(presetsData);
      setCategories(categoriesData);
    } catch (error) {
      console.error('Error loading data:', error);
      alert('Failed to load category presets');
    } finally {
      setLoading(false);
    }
  };

  const loadPresets = async () => {
    try {
      setLoading(true);
      const data = await getCategoryPresets();
      setPresets(data);
    } catch (error) {
      console.error('Error loading presets:', error);
    } finally {
      setLoading(false);
    }
  };

  // ── form open helpers ──────────────────────────────────────────────────────

  const handleCreate = () => {
    setEditingPreset(null);
    setFormData({
      default_weight_unit: 'lb',
      requires_shipping: true,
      is_active: true,
      measurement_template: {
        width: false, length: false, sleeve: false,
        shoulder: false, waist: false, inseam: false, rise: false,
      },
    });
    setCustomSections(mergeAllSections([]));
    setShowForm(true);
  };

  const handleEdit = (preset: CategoryPreset) => {
    setEditingPreset(preset);
    setFormData({
      category_name: preset.category_name,
      display_name: preset.display_name,
      description: preset.description,
      default_weight_value: preset.default_weight_value,
      default_weight_unit: preset.default_weight_unit,
      requires_shipping: preset.requires_shipping,
      product_type: preset.product_type,
      vendor: preset.vendor,
      suggested_price_min: preset.suggested_price_min,
      suggested_price_max: preset.suggested_price_max,
      default_material: preset.default_material,
      default_care_instructions: preset.default_care_instructions,
      measurement_template: preset.measurement_template,
      seo_title_template: preset.seo_title_template,
      seo_keywords: preset.seo_keywords,
      shopify_product_type: preset.shopify_product_type,
      shopify_collection_id: preset.shopify_collection_id,
      default_tags: preset.default_tags,
      typical_condition: preset.typical_condition,
      is_active: preset.is_active,
      package_dimensions: (preset as any).package_dimensions,
      parcel_size: (preset as any).parcel_size,
      ships_from: (preset as any).ships_from,
      continue_selling_out_of_stock: (preset as any).continue_selling_out_of_stock,
      size_type: (preset as any).size_type,
      style: (preset as any).style,
      gender: (preset as any).gender,
      age_group: (preset as any).age_group,
      policies: (preset as any).policies,
      renewal_options: (preset as any).renewal_options,
      who_made_it: (preset as any).who_made_it,
      what_is_it: (preset as any).what_is_it,
      listing_type: (preset as any).listing_type,
      discounted_shipping: (preset as any).discounted_shipping,
      custom_label_0: (preset as any).custom_label_0,
      default_status: (preset as any).default_status ?? 'Active',
    });
    setCustomSections(mergeAllSections(preset.custom_sections ?? []));
    setShowForm(true);
  };

  const handleDelete = async (id: string, displayName: string) => {
    if (!confirm(`Delete "${displayName}"?`)) return;
    try {
      await deleteCategoryPreset(id);
      await loadPresets();
    } catch (error) {
      console.error('Error deleting preset:', error);
      alert('Failed to delete preset');
    }
  };

  const handleDuplicate = async (preset: CategoryPreset) => {
    const newDisplayName = prompt('Enter display name for the duplicated preset:', `${preset.display_name} (Copy)`);
    if (!newDisplayName) return;
    const suffix = uid();
    const newCategoryName = newDisplayName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').substring(0, 40) + '_' + suffix;
    const duplicateData: CategoryPresetInput = {
      category_name: newCategoryName,
      display_name: newDisplayName,
      description: preset.description,
      default_weight_value: preset.default_weight_value,
      default_weight_unit: preset.default_weight_unit,
      requires_shipping: preset.requires_shipping,
      product_type: preset.product_type,
      vendor: preset.vendor,
      suggested_price_min: preset.suggested_price_min,
      suggested_price_max: preset.suggested_price_max,
      default_material: preset.default_material,
      default_care_instructions: preset.default_care_instructions,
      measurement_template: preset.measurement_template,
      seo_title_template: preset.seo_title_template,
      seo_keywords: preset.seo_keywords,
      shopify_product_type: preset.shopify_product_type,
      shopify_collection_id: preset.shopify_collection_id,
      default_tags: preset.default_tags,
      typical_condition: preset.typical_condition,
      is_active: preset.is_active,
      custom_sections: preset.custom_sections,
      ...(preset as any),
      id: undefined,
      user_id: undefined,
      created_at: undefined,
      updated_at: undefined,
    };
    try {
      await createCategoryPreset(duplicateData);
      await loadPresets();
      alert(`✅ Duplicated: "${newDisplayName}"`);
    } catch (error) {
      console.error('Error duplicating preset:', error);
      alert('Failed to duplicate preset');
    }
  };

  // ── submit ─────────────────────────────────────────────────────────────────

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.display_name) { alert('Display name is required'); return; }
    if (!editingPreset && !formData.product_type) { alert('Please select a category'); return; }

    const dataToSave: Partial<CategoryPresetInput> = {
      ...formData,
      // Only persist sections that have at least one field
      custom_sections: customSections.filter(s => s.fields.length > 0),
    };

    try {
      if (editingPreset) {
        await updateCategoryPreset(editingPreset.id, dataToSave);
        alert('Preset updated ✅');
      } else {
        const suffix = uid();
        const uniqueName = (formData.display_name || 'preset')
          .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').substring(0, 40) + '_' + suffix;
        await createCategoryPreset({ ...dataToSave, category_name: uniqueName } as CategoryPresetInput);
        alert('Preset created ✅');
      }
      await loadPresets();
      setShowForm(false);
      setEditingPreset(null);
    } catch (error) {
      console.error('Error saving preset:', error);
      alert('Failed to save preset');
    }
  };

  // ── measurement helpers ────────────────────────────────────────────────────

  const handleMeasurementToggle = (field: string) => {
    setFormData(prev => ({
      ...prev,
      measurement_template: {
        ...prev.measurement_template!,
        [field]: !(prev.measurement_template as any)?.[field],
      },
    }));
  };

  const handleTagsChange = (value: string) => {
    setFormData(prev => ({ ...prev, default_tags: value.split(',').map(t => t.trim()).filter(Boolean) }));
  };

  const handleKeywordsChange = (value: string) => {
    setFormData(prev => ({ ...prev, seo_keywords: value.split(',').map(k => k.trim()).filter(Boolean) }));
  };

  const loadDefaultTemplate = (categoryName: string) => {
    const template = DEFAULT_MEASUREMENT_TEMPLATES[categoryName];
    if (template) setFormData(prev => ({ ...prev, measurement_template: template }));
  };

  // ── custom sections CRUD ──────────────────────────────────────────────────

  const addSection = () => {
    const title = prompt('Section name:');
    if (!title?.trim()) return;
    setCustomSections(prev => [
      ...prev,
      { id: uid(), title: title.trim(), order: prev.length, fields: [] },
    ]);
  };

  const renameSection = (id: string) => {
    const section = customSections.find(s => s.id === id);
    if (!section) return;
    const title = prompt('New section name:', section.title);
    if (!title?.trim()) return;
    setCustomSections(prev => prev.map(s => s.id === id ? { ...s, title: title.trim() } : s));
  };

  const deleteSection = (id: string) => {
    if (!confirm('Delete this section and all its fields?')) return;
    setCustomSections(prev => prev.filter(s => s.id !== id));
  };

  const moveSectionUp = (id: string) => {
    setCustomSections(prev => {
      const idx = prev.findIndex(s => s.id === id);
      if (idx <= 0) return prev;
      const next = [...prev];
      [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
      return next.map((s, i) => ({ ...s, order: i }));
    });
  };

  const moveSectionDown = (id: string) => {
    setCustomSections(prev => {
      const idx = prev.findIndex(s => s.id === id);
      if (idx < 0 || idx >= prev.length - 1) return prev;
      const next = [...prev];
      [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
      return next.map((s, i) => ({ ...s, order: i }));
    });
  };

  // ── custom field CRUD ─────────────────────────────────────────────────────

  const openAddField = (sectionId: string) => {
    setFieldModalSectionId(sectionId);
    setFieldModalEditing(undefined);
    setFieldModalOpen(true);
  };

  const openEditField = (sectionId: string, field: CustomFieldDefinition) => {
    setFieldModalSectionId(sectionId);
    setFieldModalEditing(field);
    setFieldModalOpen(true);
  };

  const handleFieldSave = (f: CustomFieldDefinition) => {
    setCustomSections(prev => prev.map(s => {
      if (s.id !== fieldModalSectionId) return s;
      const existing = s.fields.find(fl => fl.id === f.id);
      const fields = existing
        ? s.fields.map(fl => fl.id === f.id ? { ...f, order: fl.order } : fl)
        : [...s.fields, { ...f, order: s.fields.length }];
      return { ...s, fields };
    }));
    setFieldModalOpen(false);
  };

  const deleteField = (sectionId: string, fieldId: string) => {
    if (!confirm('Delete this field?')) return;
    setCustomSections(prev => prev.map(s => {
      if (s.id !== sectionId) return s;
      return { ...s, fields: s.fields.filter(f => f.id !== fieldId).map((f, i) => ({ ...f, order: i })) };
    }));
  };

  const moveFieldUp = (sectionId: string, fieldId: string) => {
    setCustomSections(prev => prev.map(s => {
      if (s.id !== sectionId) return s;
      const idx = s.fields.findIndex(f => f.id === fieldId);
      if (idx <= 0) return s;
      const fields = [...s.fields];
      [fields[idx - 1], fields[idx]] = [fields[idx], fields[idx - 1]];
      return { ...s, fields: fields.map((f, i) => ({ ...f, order: i })) };
    }));
  };

  const moveFieldDown = (sectionId: string, fieldId: string) => {
    setCustomSections(prev => prev.map(s => {
      if (s.id !== sectionId) return s;
      const idx = s.fields.findIndex(f => f.id === fieldId);
      if (idx < 0 || idx >= s.fields.length - 1) return s;
      const fields = [...s.fields];
      [fields[idx], fields[idx + 1]] = [fields[idx + 1], fields[idx]];
      return { ...s, fields: fields.map((f, i) => ({ ...f, order: i })) };
    }));
  };

  // ── render ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="presets-manager-overlay">
        <div className="presets-manager">
          <div className="presets-header">
            <h2>Category Presets Manager</h2>
            <button className="button-close" onClick={onClose} title="Close">✕</button>
          </div>
          <p style={{ padding: '2rem', textAlign: 'center', color: '#666' }}>Loading category presets…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="presets-manager-overlay">
      <div className="presets-manager">
        <div className="presets-header">
          <h2>Category Presets Manager</h2>
          <div className="header-actions">
            <button className="button" onClick={handleCreate}>+ Create New Preset</button>
            <button className="button-close" onClick={onClose} title="Close">✕</button>
          </div>
        </div>

        {/* ──────────── Form Modal ──────────── */}
        {showForm && (
          <div className="preset-form-overlay">
            <div className="preset-form-modal">
              <h3>{editingPreset ? 'Edit' : 'Create'} Category Preset</h3>

              <form onSubmit={handleSubmit}>

                {/* Basic Info */}
                <div className="form-section">
                  <h4>Basic Information</h4>
                  <div className="form-group">
                    <label>Category *</label>
                    {editingPreset ? (
                      <input type="text" value={formData.category_name || ''} disabled />
                    ) : (
                      <select
                        value={formData.product_type || ''}
                        onChange={e => {
                          const sel = categories.find(c => c.name === e.target.value);
                          setFormData(prev => ({
                            ...prev,
                            product_type: e.target.value,
                            category_name: e.target.value,
                            display_name: sel?.display_name || e.target.value,
                          }));
                        }}
                        required
                      >
                        <option value="">-- Select a Category --</option>
                        {categories.map(cat => (
                          <option key={cat.id} value={cat.name}>{cat.emoji} {cat.display_name}</option>
                        ))}
                      </select>
                    )}
                  </div>
                  <div className="form-group">
                    <label>Display Name *</label>
                    <input type="text" value={formData.display_name || ''} onChange={e => setFormData(prev => ({ ...prev, display_name: e.target.value }))} placeholder="e.g., Sweatshirts & Hoodies" required />
                  </div>
                  <div className="form-group">
                    <label>Description</label>
                    <textarea value={formData.description || ''} onChange={e => setFormData(prev => ({ ...prev, description: e.target.value }))} rows={2} />
                  </div>
                  <CustomFieldsBlock
                    fields={customSections.find(s => s.id === '__basic__')?.fields ?? []}
                    onAdd={() => openAddField('__basic__')}
                    onEdit={f => openEditField('__basic__', f)}
                    onDelete={fieldId => deleteField('__basic__', fieldId)}
                    onMoveUp={fieldId => moveFieldUp('__basic__', fieldId)}
                    onMoveDown={fieldId => moveFieldDown('__basic__', fieldId)}
                  />
                </div>

                {/* Shipping */}
                <div className="form-section">
                  <h4>Shipping & Physical Attributes</h4>
                  <div className="form-row">
                    <div className="form-group">
                      <label>Default Weight</label>
                      <input type="text" value={formData.default_weight_value || ''} onChange={e => setFormData(prev => ({ ...prev, default_weight_value: e.target.value }))} placeholder="e.g., 1.2" />
                    </div>
                    <div className="form-group">
                      <label>Weight Unit</label>
                      <select value={formData.default_weight_unit || 'lb'} onChange={e => setFormData(prev => ({ ...prev, default_weight_unit: e.target.value as any }))}>
                        <option value="lb">Pounds (lb)</option>
                        <option value="oz">Ounces (oz)</option>
                        <option value="kg">Kilograms (kg)</option>
                        <option value="g">Grams (g)</option>
                      </select>
                    </div>
                  </div>
                  <div className="form-group checkbox-group">
                    <label>
                      <input type="checkbox" checked={formData.requires_shipping ?? true} onChange={e => setFormData(prev => ({ ...prev, requires_shipping: e.target.checked }))} />
                      Requires Shipping
                    </label>
                  </div>
                  <CustomFieldsBlock
                    fields={customSections.find(s => s.id === '__shipping__')?.fields ?? []}
                    onAdd={() => openAddField('__shipping__')}
                    onEdit={f => openEditField('__shipping__', f)}
                    onDelete={fieldId => deleteField('__shipping__', fieldId)}
                    onMoveUp={fieldId => moveFieldUp('__shipping__', fieldId)}
                    onMoveDown={fieldId => moveFieldDown('__shipping__', fieldId)}
                  />
                </div>

                {/* Classification */}
                <div className="form-section">
                  <h4>Product Classification</h4>
                  <div className="form-group">
                    <label>Product Type</label>
                    <input type="text" value={formData.product_type || ''} onChange={e => setFormData(prev => ({ ...prev, product_type: e.target.value }))} placeholder="e.g., Apparel" />
                  </div>
                  <div className="form-group">
                    <label>Default Vendor/Brand</label>
                    <input type="text" value={formData.vendor || ''} onChange={e => setFormData(prev => ({ ...prev, vendor: e.target.value }))} placeholder="Optional" />
                  </div>
                  <div className="form-group">
                    <label>Shopify Product Type</label>
                    <input type="text" value={formData.shopify_product_type || ''} onChange={e => setFormData(prev => ({ ...prev, shopify_product_type: e.target.value }))} placeholder="For Shopify integration" />
                  </div>
                  <CustomFieldsBlock
                    fields={customSections.find(s => s.id === '__classification__')?.fields ?? []}
                    onAdd={() => openAddField('__classification__')}
                    onEdit={f => openEditField('__classification__', f)}
                    onDelete={fieldId => deleteField('__classification__', fieldId)}
                    onMoveUp={fieldId => moveFieldUp('__classification__', fieldId)}
                    onMoveDown={fieldId => moveFieldDown('__classification__', fieldId)}
                  />
                </div>

                {/* Pricing */}
                <div className="form-section">
                  <h4>Pricing Guidance</h4>
                  <div className="form-row">
                    <div className="form-group">
                      <label>Min Price ($)</label>
                      <input type="number" step="0.01" value={formData.suggested_price_min || ''} onChange={e => setFormData(prev => ({ ...prev, suggested_price_min: parseFloat(e.target.value) || undefined }))} placeholder="25.00" />
                    </div>
                    <div className="form-group">
                      <label>Max Price ($)</label>
                      <input type="number" step="0.01" value={formData.suggested_price_max || ''} onChange={e => setFormData(prev => ({ ...prev, suggested_price_max: parseFloat(e.target.value) || undefined }))} placeholder="75.00" />
                    </div>
                  </div>
                  <CustomFieldsBlock
                    fields={customSections.find(s => s.id === '__pricing__')?.fields ?? []}
                    onAdd={() => openAddField('__pricing__')}
                    onEdit={f => openEditField('__pricing__', f)}
                    onDelete={fieldId => deleteField('__pricing__', fieldId)}
                    onMoveUp={fieldId => moveFieldUp('__pricing__', fieldId)}
                    onMoveDown={fieldId => moveFieldDown('__pricing__', fieldId)}
                  />
                </div>

                {/* Attributes */}
                <div className="form-section">
                  <h4>Product Attributes</h4>
                  <div className="form-group">
                    <label>Default Material</label>
                    <input type="text" value={formData.default_material || ''} onChange={e => setFormData(prev => ({ ...prev, default_material: e.target.value }))} placeholder="e.g., Cotton, Polyester" />
                  </div>
                  <div className="form-group">
                    <label>Default Care Instructions</label>
                    <textarea value={formData.default_care_instructions || ''} onChange={e => setFormData(prev => ({ ...prev, default_care_instructions: e.target.value }))} rows={2} />
                  </div>
                  <div className="form-group">
                    <label>Typical Condition</label>
                    <select value={formData.typical_condition || ''} onChange={e => setFormData(prev => ({ ...prev, typical_condition: e.target.value }))}>
                      <option value="">None</option>
                      <option value="NWT">NWT</option>
                      <option value="Like New">Like New</option>
                      <option value="Excellent">Excellent</option>
                      <option value="Good">Good</option>
                      <option value="Fair">Fair</option>
                    </select>
                  </div>
                  <CustomFieldsBlock
                    fields={customSections.find(s => s.id === '__attributes__')?.fields ?? []}
                    onAdd={() => openAddField('__attributes__')}
                    onEdit={f => openEditField('__attributes__', f)}
                    onDelete={fieldId => deleteField('__attributes__', fieldId)}
                    onMoveUp={fieldId => moveFieldUp('__attributes__', fieldId)}
                    onMoveDown={fieldId => moveFieldDown('__attributes__', fieldId)}
                  />
                </div>

                {/* Shipping CSV */}
                <div className="form-section">
                  <h4>Shipping & Packaging (CSV Export)</h4>
                  <div className="form-group">
                    <label>Package Dimensions</label>
                    <input type="text" value={(formData as any).package_dimensions || ''} onChange={e => setFormData(prev => ({ ...prev, package_dimensions: e.target.value } as any))} placeholder="12 in - 10 in - 4 in" />
                  </div>
                  <div className="form-row">
                    <div className="form-group">
                      <label>Parcel Size</label>
                      <select value={(formData as any).parcel_size || ''} onChange={e => setFormData(prev => ({ ...prev, parcel_size: e.target.value } as any))}>
                        <option value="">-- Select --</option>
                        <option value="Small">Small</option>
                        <option value="Medium">Medium</option>
                        <option value="Large">Large</option>
                        <option value="Extra Large">Extra Large</option>
                      </select>
                    </div>
                    <div className="form-group checkbox-group">
                      <label>
                        <input type="checkbox" checked={(formData as any).continue_selling_out_of_stock ?? false} onChange={e => setFormData(prev => ({ ...prev, continue_selling_out_of_stock: e.target.checked } as any))} />
                        Continue Selling OOS
                      </label>
                    </div>
                  </div>
                  <div className="form-group">
                    <label>Ships From</label>
                    <input type="text" value={(formData as any).ships_from || ''} onChange={e => setFormData(prev => ({ ...prev, ships_from: e.target.value } as any))} placeholder="601 W. Lincoln Ave, Fresno CA 93706" />
                  </div>
                  <CustomFieldsBlock
                    fields={customSections.find(s => s.id === '__shipping_csv__')?.fields ?? []}
                    onAdd={() => openAddField('__shipping_csv__')}
                    onEdit={f => openEditField('__shipping_csv__', f)}
                    onDelete={fieldId => deleteField('__shipping_csv__', fieldId)}
                    onMoveUp={fieldId => moveFieldUp('__shipping_csv__', fieldId)}
                    onMoveDown={fieldId => moveFieldDown('__shipping_csv__', fieldId)}
                  />
                </div>

                {/* Classification CSV */}
                <div className="form-section">
                  <h4>Product Classification (CSV Export)</h4>
                  <div className="form-row">
                    <div className="form-group">
                      <label>Size Type</label>
                      <select value={(formData as any).size_type || ''} onChange={e => setFormData(prev => ({ ...prev, size_type: e.target.value } as any))}>
                        <option value="">-- Select --</option>
                        <option value="Regular">Regular</option>
                        <option value="Big & Tall">Big & Tall</option>
                        <option value="Petite">Petite</option>
                        <option value="Plus Size">Plus Size</option>
                        <option value="One Size">One Size</option>
                      </select>
                    </div>
                    <div className="form-group">
                      <label>Gender</label>
                      <select value={(formData as any).gender || ''} onChange={e => setFormData(prev => ({ ...prev, gender: e.target.value } as any))}>
                        <option value="">-- Select --</option>
                        <option value="Men">Men</option>
                        <option value="Women">Women</option>
                        <option value="Unisex">Unisex</option>
                        <option value="Kids">Kids</option>
                      </select>
                    </div>
                  </div>
                  <div className="form-row">
                    <div className="form-group">
                      <label>Style</label>
                      <input type="text" value={(formData as any).style || ''} onChange={e => setFormData(prev => ({ ...prev, style: e.target.value } as any))} placeholder="Vintage, Modern, Streetwear" />
                    </div>
                    <div className="form-group">
                      <label>Age Group</label>
                      <input type="text" value={(formData as any).age_group || ''} onChange={e => setFormData(prev => ({ ...prev, age_group: e.target.value } as any))} placeholder="Adult (13+ years old)" />
                    </div>
                  </div>
                  <div className="form-group">
                    <label>Default Status</label>
                    <select value={(formData as any).default_status || 'Active'} onChange={e => setFormData(prev => ({ ...prev, default_status: e.target.value } as any))}>
                      <option value="Active">Active</option>
                      <option value="Draft">Draft</option>
                      <option value="Archived">Archived</option>
                    </select>
                  </div>
                  <CustomFieldsBlock
                    fields={customSections.find(s => s.id === '__classification_csv__')?.fields ?? []}
                    onAdd={() => openAddField('__classification_csv__')}
                    onEdit={f => openEditField('__classification_csv__', f)}
                    onDelete={fieldId => deleteField('__classification_csv__', fieldId)}
                    onMoveUp={fieldId => moveFieldUp('__classification_csv__', fieldId)}
                    onMoveDown={fieldId => moveFieldDown('__classification_csv__', fieldId)}
                  />
                </div>

                {/* Policies */}
                <div className="form-section">
                  <h4>Policies & Marketplace (CSV Export)</h4>
                  <div className="form-group">
                    <label>Policies</label>
                    <input type="text" value={(formData as any).policies || ''} onChange={e => setFormData(prev => ({ ...prev, policies: e.target.value } as any))} placeholder="No Returns; No Exchanges" />
                  </div>
                  <div className="form-row">
                    <div className="form-group">
                      <label>Who Made It</label>
                      <input type="text" value={(formData as any).who_made_it || ''} onChange={e => setFormData(prev => ({ ...prev, who_made_it: e.target.value } as any))} placeholder="Another Company Or Person" />
                    </div>
                    <div className="form-group">
                      <label>What Is It</label>
                      <input type="text" value={(formData as any).what_is_it || ''} onChange={e => setFormData(prev => ({ ...prev, what_is_it: e.target.value } as any))} placeholder="A Finished Product" />
                    </div>
                  </div>
                  <div className="form-row">
                    <div className="form-group">
                      <label>Listing Type</label>
                      <input type="text" value={(formData as any).listing_type || ''} onChange={e => setFormData(prev => ({ ...prev, listing_type: e.target.value } as any))} placeholder="Physical Item" />
                    </div>
                    <div className="form-group">
                      <label>Renewal Options</label>
                      <input type="text" value={(formData as any).renewal_options || ''} onChange={e => setFormData(prev => ({ ...prev, renewal_options: e.target.value } as any))} placeholder="Automatic" />
                    </div>
                  </div>
                  <div className="form-row">
                    <div className="form-group">
                      <label>Discounted Shipping</label>
                      <input type="text" value={(formData as any).discounted_shipping || ''} onChange={e => setFormData(prev => ({ ...prev, discounted_shipping: e.target.value } as any))} placeholder="No Discount" />
                    </div>
                    <div className="form-group">
                      <label>Custom Label (Google Shopping)</label>
                      <input type="text" value={(formData as any).custom_label_0 || ''} onChange={e => setFormData(prev => ({ ...prev, custom_label_0: e.target.value } as any))} placeholder="Top Seller" />
                    </div>
                  </div>
                  <CustomFieldsBlock
                    fields={customSections.find(s => s.id === '__policies__')?.fields ?? []}
                    onAdd={() => openAddField('__policies__')}
                    onEdit={f => openEditField('__policies__', f)}
                    onDelete={fieldId => deleteField('__policies__', fieldId)}
                    onMoveUp={fieldId => moveFieldUp('__policies__', fieldId)}
                    onMoveDown={fieldId => moveFieldDown('__policies__', fieldId)}
                  />
                </div>

                {/* Measurements */}
                <div className="form-section">
                  <h4>Measurement Template</h4>
                  <p className="form-hint">Select which measurements apply to this category</p>
                  {formData.category_name && DEFAULT_MEASUREMENT_TEMPLATES[formData.category_name] && (
                    <button type="button" className="button button-secondary" onClick={() => loadDefaultTemplate(formData.category_name!)} style={{ marginBottom: '1rem' }}>
                      Load Default Template for {formData.category_name}
                    </button>
                  )}
                  <div className="measurement-checkboxes">
                    {Object.keys(formData.measurement_template || {}).map(field => (
                      <label key={field} className="checkbox-label">
                        <input
                          type="checkbox"
                          checked={formData.measurement_template?.[field as keyof typeof formData.measurement_template] || false}
                          onChange={() => handleMeasurementToggle(field)}
                        />
                        {field.charAt(0).toUpperCase() + field.slice(1)}
                      </label>
                    ))}
                  </div>
                  <CustomFieldsBlock
                    fields={customSections.find(s => s.id === '__measurements__')?.fields ?? []}
                    onAdd={() => openAddField('__measurements__')}
                    onEdit={f => openEditField('__measurements__', f)}
                    onDelete={fieldId => deleteField('__measurements__', fieldId)}
                    onMoveUp={fieldId => moveFieldUp('__measurements__', fieldId)}
                    onMoveDown={fieldId => moveFieldDown('__measurements__', fieldId)}
                  />
                </div>

                {/* Tags & SEO */}
                <div className="form-section">
                  <h4>Tags & SEO</h4>
                  <div className="form-group">
                    <label>Default Tags (comma-separated)</label>
                    <input type="text" value={formData.default_tags?.join(', ') || ''} onChange={e => handleTagsChange(e.target.value)} placeholder="sweatshirt, pullover, vintage" />
                  </div>
                  <div className="form-group">
                    <label>SEO Keywords (comma-separated)</label>
                    <input type="text" value={formData.seo_keywords?.join(', ') || ''} onChange={e => handleKeywordsChange(e.target.value)} placeholder="vintage, retro, streetwear" />
                  </div>
                  <div className="form-group">
                    <label>SEO Title Template</label>
                    <input type="text" value={formData.seo_title_template || ''} onChange={e => setFormData(prev => ({ ...prev, seo_title_template: e.target.value }))} placeholder="{size} {brand} {category} {color}" />
                    <small>Placeholders: {'{size}'}, {'{brand}'}, {'{category}'}, {'{color}'}, {'{era}'}</small>
                  </div>
                  <CustomFieldsBlock
                    fields={customSections.find(s => s.id === '__tags__')?.fields ?? []}
                    onAdd={() => openAddField('__tags__')}
                    onEdit={f => openEditField('__tags__', f)}
                    onDelete={fieldId => deleteField('__tags__', fieldId)}
                    onMoveUp={fieldId => moveFieldUp('__tags__', fieldId)}
                    onMoveDown={fieldId => moveFieldDown('__tags__', fieldId)}
                  />
                </div>

                {/* ── Custom Sections ─────────────────────────────────────── */}
                <div className="form-section custom-sections-wrapper">
                  <div className="custom-sections-header">
                    <h4>Custom Sections</h4>
                    <button type="button" className="button button-secondary button-sm" onClick={addSection}>
                      + Add Section
                    </button>
                  </div>

                  {customSections.length === 0 && (
                    <p className="form-hint">No custom sections yet. Click "+ Add Section" to create one.</p>
                  )}

                  {customSections.map((section, sIdx) => (
                    <div key={section.id} className="custom-section-block">
                      <SectionHeader
                        title={section.title}
                        isCustom={true}
                        canMoveUp={sIdx > 0}
                        canMoveDown={sIdx < customSections.length - 1}
                        onMoveUp={() => moveSectionUp(section.id)}
                        onMoveDown={() => moveSectionDown(section.id)}
                        onRename={() => renameSection(section.id)}
                        onDelete={() => deleteSection(section.id)}
                      />
                      <CustomFieldsBlock
                        fields={section.fields}
                        onAdd={() => openAddField(section.id)}
                        onEdit={f => openEditField(section.id, f)}
                        onDelete={fieldId => deleteField(section.id, fieldId)}
                        onMoveUp={fieldId => moveFieldUp(section.id, fieldId)}
                        onMoveDown={fieldId => moveFieldDown(section.id, fieldId)}
                      />
                    </div>
                  ))}
                </div>

                <div className="form-actions">
                  <button type="button" className="button button-secondary" onClick={() => setShowForm(false)}>Cancel</button>
                  <button type="submit" className="button">{editingPreset ? 'Update' : 'Create'} Preset</button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Field Modal */}
        {fieldModalOpen && (
          <FieldModal
            initial={fieldModalEditing}
            onSave={handleFieldSave}
            onClose={() => setFieldModalOpen(false)}
          />
        )}

        {/* ──────────── Gender Toggle ──────────── */}
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
          {(['Men', 'Women', 'Kids'] as const).map(g => (
            <button
              key={g}
              onClick={() => setGender(g)}
              style={{
                padding: '0.4rem 1.2rem',
                borderRadius: '999px',
                border: '2px solid',
                borderColor: genderFilter === g ? '#6366f1' : '#d1d5db',
                background: genderFilter === g ? '#6366f1' : '#fff',
                color: genderFilter === g ? '#fff' : '#374151',
                fontWeight: 600,
                fontSize: '0.9rem',
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              {g === 'Men' ? '👔 Men' : g === 'Women' ? '👗 Women' : '🧒 Kids'}
            </button>
          ))}
        </div>

        {/* ──────────── Preset Cards ──────────── */}
        <div className="presets-grid">
          {filteredPresets.length === 0 ? (
            <div className="empty-state">
              <p>No {genderFilter} presets yet. Create one or use the seed SQL to add defaults.</p>
            </div>
          ) : (
            filteredPresets.map(preset => (
              <div key={preset.id} className="preset-card">
                <div className="preset-header">
                  <h3>{preset.display_name}</h3>
                  <span className="preset-category">{preset.product_type || preset.category_name}</span>
                </div>
                {preset.description && <p className="preset-description">{preset.description}</p>}
                <div className="preset-details">
                  {preset.default_weight_value && (
                    <div className="preset-detail"><strong>Weight:</strong> {preset.default_weight_value} {preset.default_weight_unit}</div>
                  )}
                  {preset.product_type && (
                    <div className="preset-detail"><strong>Type:</strong> {preset.product_type}</div>
                  )}
                  {preset.suggested_price_min && preset.suggested_price_max && (
                    <div className="preset-detail"><strong>Price:</strong> ${preset.suggested_price_min} – ${preset.suggested_price_max}</div>
                  )}
                  {preset.default_tags && preset.default_tags.length > 0 && (
                    <div className="preset-detail"><strong>Tags:</strong> {preset.default_tags.join(', ')}</div>
                  )}
                  <div className="preset-detail">
                    <strong>Measurements:</strong>{' '}
                    {Object.entries(preset.measurement_template).filter(([, v]) => v).map(([k]) => k).join(', ') || 'None'}
                  </div>
                  {preset.custom_sections && preset.custom_sections.length > 0 && (
                    <div className="preset-detail">
                      <strong>Custom Sections:</strong> {preset.custom_sections.map(s => `${s.title} (${s.fields.length} field${s.fields.length !== 1 ? 's' : ''})`).join(', ')}
                    </div>
                  )}
                </div>
                <div className="preset-actions">
                  <button className="button button-secondary" onClick={() => handleEdit(preset)}>Edit</button>
                  <button className="button" onClick={() => handleDuplicate(preset)}>Duplicate</button>
                  <button className="button button-danger" onClick={() => handleDelete(preset.id, preset.display_name)}>Delete</button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default CategoryPresetsManager;
