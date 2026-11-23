import { useEffect, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import {
  Users, UserRound, Baby, Pencil, Plus, Copy, Trash2, ChevronUp, ChevronDown, RotateCcw,
} from 'lucide-react';
import type {
  CategoryPreset,
  CategoryPresetInput,
  CustomFieldDefinition,
  CustomSection,
  CustomFieldType,
  MeasurementTemplate,
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
import { createPresetWriteQueue, describeSaveError } from '../lib/presetWriteQueue';
import type { PresetPatch, PresetWriteQueue } from '../lib/presetWriteQueue';
import { saveStatus } from '../lib/saveStatusStore';
import { log } from '../lib/debugLogger';
import {
  Badge, Button, ConfirmAction, Dialog, IconButton, TextField, TextareaField, SelectField,
  FieldGroup, FieldGrid, FieldCell,
} from './ui';
import type { FieldCellControlProps } from './ui';
import './CategoryPresetsManager.css';

interface CategoryPresetsManagerProps {
  onClose: () => void;
}

/* ════════════════════════════════════════════════════════════════════════════
   THE AUTOSAVE MODEL (owner report, Nov 2026: "I want to type in it and have
   it apply, or as soon as I click out of it. No X or close button.")

   The editor is simply "the selected preset". There is no submit, no Cancel
   and nothing to close. Every field saves itself:
     text, number, textarea   on blur AND on a 600 ms typing debounce,
                              whichever comes first; one write per changed
                              value, nothing when the value is unchanged
     select, checkbox, the    immediately on change
     measurement toggles
     custom sections/fields   on each structural change
   All of them go through ONE per-preset write queue (lib/presetWriteQueue.ts):
   writes are serialised per preset, patches coalesce while one is in flight,
   and only the changed keys reach updateCategoryPreset. Every write reports
   into saveStatusStore and into the editor's own status line; a failed field
   keeps what was typed and the status line offers Retry.
   ════════════════════════════════════════════════════════════════════════════ */

const TYPING_DEBOUNCE_MS = 600;
const SAVED_FADE_MS = 1500;
const ANNOUNCE_DEBOUNCE_MS = 400;

// ─── helpers ────────────────────────────────────────────────────────────────

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

/** A unique category_name: the slug of the display name plus a uid suffix,
 *  so a create or a duplicate never trips 061's (org_id, category_name) index. */
function uniqueCategoryName(displayName: string): string {
  const slug = (displayName || 'preset')
    .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').substring(0, 40);
  return `${slug || 'preset'}_${uid()}`;
}

const FIELD_TYPES: { value: CustomFieldType; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'textarea', label: 'Text area' },
  { value: 'select', label: 'Dropdown' },
  { value: 'checkbox', label: 'Checkbox' },
];

// Fixed IDs for the built-in sections. Their custom fields persist in the same
// custom_sections array; the ids are data and must not change. The editor now
// shows five groups, so several ids render inside one group.
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
const isBuiltin = (id: string) => BUILTIN_SECTIONS.some(b => b.id === id);

function mergeAllSections(existing: CustomSection[]): CustomSection[] {
  const builtins = BUILTIN_SECTIONS.map((bs, i) => existing.find(s => s.id === bs.id) ?? { id: bs.id, title: bs.title, order: i, fields: [] });
  const customs = existing.filter(s => !isBuiltin(s.id));
  return [...builtins, ...customs];
}

/** What is stored: a built-in section only when it holds a field; a section
 *  the person made always (an empty one is still theirs to fill). */
function persistableSections(sections: CustomSection[]): CustomSection[] {
  return sections.filter(s => !isBuiltin(s.id) || s.fields.length > 0);
}

const MEASURE_KEYS = ['width', 'length', 'sleeve', 'shoulder', 'waist', 'inseam', 'rise'] as const;
const MEASURE_LABEL: Record<string, string> = { pitToPit: 'Pit to pit' };
const measureLabel = (k: string) => MEASURE_LABEL[k] ?? k.charAt(0).toUpperCase() + k.slice(1);
const EMPTY_TEMPLATE: MeasurementTemplate = {
  width: false, length: false, sleeve: false, shoulder: false, waist: false, inseam: false, rise: false,
};

// ─── Ship-from ───────────────────────────────────────────────────────────────
// The ship-from address belongs to ONE workspace. A new workspace is seeded with
// the founding set of presets minus this field, so every shop sets its own, and
// these rules are the same ones the onboarding checklist counts with
// (OnboardingChecklist.tsx): a preset ships unless it says it does not, and it
// needs a ship-from when it ships, is active and has a blank one.

function presetShips(p: CategoryPreset): boolean {
  return p.requires_shipping !== false && p.is_active !== false;
}

function presetNeedsShipFrom(p: CategoryPreset): boolean {
  return presetShips(p) && (p.ships_from ?? '').trim() === '';
}

/** The ship-from most presets already carry, to prefill the apply-to-all field. */
function mostCommonShipFrom(presets: readonly CategoryPreset[]): string {
  const counts = new Map<string, number>();
  for (const p of presets) {
    const v = (p.ships_from ?? '').trim();
    if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  let best = '';
  let bestCount = 0;
  for (const [v, n] of counts) {
    if (n > bestCount) { best = v; bestCount = n; }
  }
  return best;
}

// ─── Field values: what the input shows, what the column stores ─────────────

type TextKind = 'text' | 'textarea' | 'number' | 'list';

/** Every typed field and how its text maps onto its column. */
const TEXT_KIND = {
  display_name: 'text',
  description: 'textarea',
  suggested_price_min: 'number',
  suggested_price_max: 'number',
  default_material: 'text',
  default_care_instructions: 'textarea',
  default_weight_value: 'text',
  package_dimensions: 'text',
  ships_from: 'text',
  discounted_shipping: 'text',
  vendor: 'text',
  shopify_product_type: 'text',
  style: 'text',
  age_group: 'text',
  who_made_it: 'text',
  what_is_it: 'text',
  listing_type: 'text',
  renewal_options: 'text',
  policies: 'text',
  custom_label_0: 'text',
  default_tags: 'list',
  seo_keywords: 'list',
  seo_title_template: 'text',
  seo_description: 'textarea',
} as const satisfies Record<string, TextKind>;
type TextKey = keyof typeof TEXT_KIND;

const SELECT_KEYS = [
  'product_type', 'default_weight_unit', 'typical_condition', 'parcel_size', 'size_type', 'gender', 'default_status',
] as const;
type SelectKey = (typeof SELECT_KEYS)[number];

type FlagKey = 'requires_shipping' | 'continue_selling_out_of_stock';

/** Not a value to send: an empty required field, or a number that is not one. */
const SKIP = Symbol('skip');

function showText(kind: TextKind, v: unknown): string {
  if (kind === 'list') return Array.isArray(v) ? v.join(', ') : '';
  return v === null || v === undefined ? '' : String(v);
}

function parseText(key: TextKey, raw: string): unknown {
  const kind: TextKind = TEXT_KIND[key];
  if (key === 'display_name') return raw.trim() === '' ? SKIP : raw.trim();
  if (kind === 'list') return raw.split(',').map(t => t.trim()).filter(Boolean);
  if (kind === 'number') {
    if (raw.trim() === '') return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : SKIP;
  }
  return raw === '' ? null : raw;
}

function parseSelect(key: SelectKey, raw: string): unknown {
  if (raw !== '') return raw;
  return key === 'product_type' || key === 'default_weight_unit' ? SKIP : null;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

function selectInitial(p: CategoryPreset, key: SelectKey): string {
  const v = (p as unknown as Record<string, unknown>)[key];
  if (key === 'default_weight_unit') return typeof v === 'string' && v ? v : 'lb';
  if (key === 'default_status') return typeof v === 'string' && v ? v : 'Active';
  return typeof v === 'string' ? v : '';
}

// ─── Save status (per preset) ───────────────────────────────────────────────

type SaveView =
  | { state: 'idle' }
  | { state: 'saving' }
  | { state: 'saved' }
  | { state: 'error'; message: string };

const IDLE: SaveView = { state: 'idle' };

/** Header status: "Saving…", "Saved" (fades), or a persistent error + Retry. */
function SaveLine({ view, onRetry }: { view: SaveView; onRetry: () => void }) {
  if (view.state === 'error') {
    return (
      <div className="preset-save preset-save--error" role="alert">
        <span className="preset-save-text">Could not save: {view.message}</span>
        <Button size="sm" variant="secondary" icon={<RotateCcw size={14} />} onClick={onRetry}>Retry</Button>
      </div>
    );
  }
  return (
    <div
      className={`preset-save${view.state === 'saved' ? ' preset-save--saved' : ''}${view.state === 'idle' ? ' preset-save--idle' : ''}`}
      role="status"
    >
      {view.state === 'saving' ? 'Saving…' : view.state === 'saved' ? 'Saved' : ''}
    </div>
  );
}

// ─── Field modal (a sub-form: adds or edits ONE custom field) ───────────────

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

  const submit = () => {
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
    /* data-tv-modal parks ToolView's Escape-to-back while the sub-form is up. */
    <div data-tv-modal>
      <Dialog
        open
        onClose={onClose}
        title={initial ? 'Edit field' : 'Add field'}
        size="sm"
        hideCloseButton
        className="preset-field-dialog"
        footer={(
          <>
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button variant="primary" onClick={submit} disabled={!label.trim() || !key.trim()}>Save field</Button>
          </>
        )}
      >
        <form
          className="preset-field-form"
          onSubmit={e => { e.preventDefault(); submit(); }}
        >
          <TextField
            label="Label"
            required
            value={label}
            onChange={e => handleLabelChange(e.target.value)}
            placeholder="e.g., Graphic theme"
            autoFocus
          />
          <TextField
            label="Key"
            required
            value={key}
            onChange={e => handleKeyChange(e.target.value)}
            placeholder="e.g., graphic_theme"
            hint="Used as a data identifier. Lowercase letters, numbers and underscores only."
          />
          <SelectField
            label="Field type"
            value={type}
            onChange={e => setType(e.target.value as CustomFieldType)}
            options={FIELD_TYPES}
          />
          {type === 'select' && (
            <TextareaField
              label="Options (one per line)"
              value={optionsText}
              onChange={e => setOptionsText(e.target.value)}
              placeholder={'Vintage\nModern\nStreetwear'}
              rows={4}
            />
          )}
          {type !== 'checkbox' && (
            <TextField
              label="Default value"
              type={type === 'number' ? 'number' : 'text'}
              value={defaultValue}
              onChange={e => setDefaultValue(e.target.value)}
              placeholder="Optional"
            />
          )}
          {/* Enter in a field submits, like any form. */}
          <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
        </form>
      </Dialog>
    </div>
  );
};

// ─── Section title: an inline input that saves itself ───────────────────────

const SectionTitle: React.FC<{ value: string; onCommit: (title: string) => void }> = ({ value, onCommit }) => {
  const [draft, setDraft] = useState(value);
  const timer = useRef<number | null>(null);
  const committed = useRef(value);
  const commit = (raw: string) => {
    if (timer.current !== null) { window.clearTimeout(timer.current); timer.current = null; }
    const t = raw.trim();
    if (!t || t === committed.current) return;
    committed.current = t;
    onCommit(t);
  };
  return (
    <input
      type="text"
      className="ui-input preset-section-title"
      aria-label="Section name"
      value={draft}
      onChange={e => {
        const v = e.target.value;
        setDraft(v);
        if (timer.current !== null) window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => commit(v), TYPING_DEBOUNCE_MS);
      }}
      onBlur={e => commit(e.target.value)}
    />
  );
};

// ─── Custom fields block ──────────────────────────────────────────────────────

interface CustomFieldsBlockProps {
  fields: CustomFieldDefinition[];
  onAdd?: () => void;
  onEdit: (f: CustomFieldDefinition) => void;
  onDelete: (id: string) => void;
  onMoveUp: (id: string) => void;
  onMoveDown: (id: string) => void;
}

const CustomFieldsBlock: React.FC<CustomFieldsBlockProps> = ({
  fields, onAdd, onEdit, onDelete, onMoveUp, onMoveDown,
}) => {
  if (fields.length === 0 && !onAdd) return null;
  return (
    <div className="custom-fields-block">
      {fields.map((f, idx) => (
        <div key={f.id} className="custom-field-row">
          <span className="custom-field-label">{f.label}</span>
          <span className="custom-field-type">{FIELD_TYPES.find(t => t.value === f.type)?.label}</span>
          {f.defaultValue && <span className="custom-field-default">Default: {f.defaultValue}</span>}
          <div className="custom-field-actions">
            {idx > 0 && (
              <IconButton size="sm" variant="ghost" label={`Move ${f.label} up`} icon={<ChevronUp size={14} />} onClick={() => onMoveUp(f.id)} />
            )}
            {idx < fields.length - 1 && (
              <IconButton size="sm" variant="ghost" label={`Move ${f.label} down`} icon={<ChevronDown size={14} />} onClick={() => onMoveDown(f.id)} />
            )}
            <IconButton size="sm" variant="ghost" label={`Edit ${f.label}`} icon={<Pencil size={13} />} onClick={() => onEdit(f)} />
            <ConfirmAction
              label="Delete"
              icon={<Trash2 size={13} />}
              confirmLabel="Delete"
              prompt={`Delete the field "${f.label}"?`}
              onConfirm={() => onDelete(f.id)}
            />
          </div>
        </div>
      ))}
      {onAdd && (
        <Button size="sm" variant="ghost" icon={<Plus size={14} />} onClick={onAdd} className="custom-field-add">
          Add custom field
        </Button>
      )}
    </div>
  );
};

// ─── The editor: the selected preset, every field saving itself ─────────────

interface PresetEditorProps {
  preset: CategoryPreset;
  categories: Category[];
  queue: PresetWriteQueue;
  status: SaveView;
  autoFocusName: boolean;
}

/** The five groups' custom fields: the built-in section ids each one shows. */
const GROUP_SECTIONS = {
  basics: ['__basic__', '__pricing__', '__attributes__'],
  shipping: ['__shipping__', '__shipping_csv__'],
  classification: ['__classification__', '__classification_csv__', '__policies__'],
  measurements: ['__measurements__'],
  seo: ['__tags__'],
} as const;

/* Keyed by preset id in the parent, so its state starts from the preset on
   mount and a different selection is a fresh editor: no effect copies props
   into state. */
const PresetEditor: React.FC<PresetEditorProps> = ({ preset, categories, queue, status, autoFocusName }) => {
  const id = preset.id;
  const row = preset as unknown as Record<string, unknown>;

  const [init] = useState(() => {
    const text = {} as Record<TextKey, string>;
    const committed: Record<string, unknown> = {};
    for (const k of Object.keys(TEXT_KIND) as TextKey[]) {
      text[k] = showText(TEXT_KIND[k], row[k]);
      committed[k] = parseText(k, text[k]);
    }
    const selects = {} as Record<SelectKey, string>;
    for (const k of SELECT_KEYS) {
      selects[k] = selectInitial(preset, k);
      committed[k] = parseSelect(k, selects[k]);
    }
    return { text, selects, committed };
  });

  const [text, setText] = useState(init.text);
  const [selects, setSelects] = useState(init.selects);
  const [flags, setFlags] = useState<Record<FlagKey, boolean>>(() => ({
    requires_shipping: preset.requires_shipping ?? true,
    continue_selling_out_of_stock: preset.continue_selling_out_of_stock ?? false,
  }));
  const [measure, setMeasure] = useState<Record<string, boolean>>(() => ({
    ...EMPTY_TEMPLATE, ...((preset.measurement_template as unknown as Record<string, boolean>) ?? {}),
  }));
  const [sections, setSections] = useState<CustomSection[]>(() => mergeAllSections(preset.custom_sections ?? []));

  // What has been handed to the queue per key, so an unchanged value (a blur
  // right after the debounce fired) is never written twice.
  const committedRef = useRef<Record<string, unknown>>(init.committed);
  const draftRef = useRef<Record<string, string>>({ ...init.text });
  const timersRef = useRef<Map<string, number>>(new Map());
  const sectionsRef = useRef<CustomSection[]>(sections);
  const nameRef = useRef<HTMLInputElement | null>(null);

  const [fieldModal, setFieldModal] = useState<{ sectionId: string; editing?: CustomFieldDefinition } | null>(null);

  const send = (patch: PresetPatch) => queue.enqueue(id, patch);

  const commitText = (key: TextKey) => {
    const t = timersRef.current.get(key);
    if (t !== undefined) { window.clearTimeout(t); timersRef.current.delete(key); }
    const value = parseText(key, draftRef.current[key] ?? '');
    if (value === SKIP || same(committedRef.current[key], value)) return;
    committedRef.current[key] = value;
    send({ [key]: value });
  };

  const typeText = (key: TextKey, raw: string) => {
    draftRef.current[key] = raw;
    setText(prev => ({ ...prev, [key]: raw }));
    const t = timersRef.current.get(key);
    if (t !== undefined) window.clearTimeout(t);
    timersRef.current.set(key, window.setTimeout(() => commitText(key), TYPING_DEBOUNCE_MS));
  };

  const changeSelect = (key: SelectKey, raw: string) => {
    setSelects(prev => ({ ...prev, [key]: raw }));
    const value = parseSelect(key, raw);
    if (value === SKIP || same(committedRef.current[key], value)) return;
    committedRef.current[key] = value;
    send({ [key]: value });
  };

  const changeFlag = (key: FlagKey, checked: boolean) => {
    setFlags(prev => ({ ...prev, [key]: checked }));
    send({ [key]: checked });
  };

  const setTemplate = (next: Record<string, boolean>) => {
    setMeasure(next);
    send({ measurement_template: next });
  };

  const changeSections = (fn: (prev: CustomSection[]) => CustomSection[]) => {
    const next = fn(sectionsRef.current);
    if (next === sectionsRef.current) return;
    sectionsRef.current = next;
    setSections(next);
    send({ custom_sections: persistableSections(next) });
  };

  // Leaving the preset (another row selected, the page closed) flushes any
  // value still waiting on its debounce, so nothing typed is dropped.
  useEffect(() => {
    const timers = timersRef.current;
    const committed = committedRef.current;
    const drafts = draftRef.current;
    return () => {
      for (const [key, t] of timers) {
        window.clearTimeout(t);
        const value = parseText(key as TextKey, drafts[key] ?? '');
        if (value !== SKIP && !same(committed[key], value)) queue.enqueue(id, { [key]: value });
      }
      timers.clear();
    };
  }, [queue, id]);

  // A preset made by "Add preset" or "Duplicate" opens with its name selected,
  // so the person just types.
  useEffect(() => {
    if (!autoFocusName) return;
    const el = nameRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, [autoFocusName]);

  // ── custom sections and fields ────────────────────────────────────────────

  const addSection = () => {
    changeSections(prev => [...prev, { id: uid(), title: 'New section', order: prev.length, fields: [] }]);
  };
  const renameSection = (sid: string, title: string) => {
    changeSections(prev => prev.map(s => s.id === sid ? { ...s, title } : s));
  };
  const deleteSection = (sid: string) => {
    changeSections(prev => prev.filter(s => s.id !== sid));
  };
  const moveSection = (sid: string, dir: -1 | 1) => {
    changeSections(prev => {
      const idx = prev.findIndex(s => s.id === sid);
      const to = idx + dir;
      if (idx < 0 || to < 0 || to >= prev.length || isBuiltin(prev[to].id)) return prev;
      const next = [...prev];
      [next[idx], next[to]] = [next[to], next[idx]];
      return next.map((s, i) => ({ ...s, order: i }));
    });
  };
  const saveField = (sectionId: string, f: CustomFieldDefinition) => {
    changeSections(prev => prev.map(s => {
      if (s.id !== sectionId) return s;
      const existing = s.fields.find(fl => fl.id === f.id);
      const fields = existing
        ? s.fields.map(fl => fl.id === f.id ? { ...f, order: fl.order } : fl)
        : [...s.fields, { ...f, order: s.fields.length }];
      return { ...s, fields };
    }));
    setFieldModal(null);
  };
  const deleteField = (sectionId: string, fieldId: string) => {
    changeSections(prev => prev.map(s => s.id !== sectionId ? s
      : { ...s, fields: s.fields.filter(f => f.id !== fieldId).map((f, i) => ({ ...f, order: i })) }));
  };
  const moveField = (sectionId: string, fieldId: string, dir: -1 | 1) => {
    changeSections(prev => prev.map(s => {
      if (s.id !== sectionId) return s;
      const idx = s.fields.findIndex(f => f.id === fieldId);
      const to = idx + dir;
      if (idx < 0 || to < 0 || to >= s.fields.length) return s;
      const fields = [...s.fields];
      [fields[idx], fields[to]] = [fields[to], fields[idx]];
      return { ...s, fields: fields.map((f, i) => ({ ...f, order: i })) };
    }));
  };

  const fieldsBlock = (sectionId: string, withAdd: boolean) => (
    <CustomFieldsBlock
      key={sectionId}
      fields={sections.find(s => s.id === sectionId)?.fields ?? []}
      onAdd={withAdd ? () => setFieldModal({ sectionId }) : undefined}
      onEdit={f => setFieldModal({ sectionId, editing: f })}
      onDelete={fid => deleteField(sectionId, fid)}
      onMoveUp={fid => moveField(sectionId, fid, -1)}
      onMoveDown={fid => moveField(sectionId, fid, 1)}
    />
  );
  const groupFields = (ids: readonly string[]) => (
    <div className="preset-group-custom">
      {ids.map((sid, i) => fieldsBlock(sid, i === 0))}
    </div>
  );

  // ── cell renderers (plain helpers, not components: react-hooks purity) ────

  const reqLabel = (label: string) => (
    <>
      {label}
      <span className="field-required-star" aria-hidden="true">*</span>
      <span className="ui-sr-only"> (required)</span>
    </>
  );
  const needed = <span className="field-required-note">Needed</span>;

  const textCell = (
    key: TextKey,
    label: ReactNode,
    opts: { placeholder?: string; hint?: ReactNode; span?: 2 | 'full'; meta?: ReactNode; controlId?: string;
      required?: boolean; inputRef?: RefObject<HTMLInputElement | null>; hintId?: string } = {},
  ) => {
    const kind = TEXT_KIND[key];
    const value = text[key];
    const empty = opts.required && value.trim() === '';
    const controlProps = (c: FieldCellControlProps) => ({
      id: c.id,
      className: `${c.className}${empty ? ' field-required-empty' : ''}`,
      'aria-describedby': opts.hintId ?? c['aria-describedby'],
      'aria-required': opts.required || undefined,
      'data-field': key,
      value,
      placeholder: opts.placeholder,
      onBlur: () => commitText(key),
    });
    return (
      <FieldCell
        key={key}
        label={label}
        span={opts.span ?? (kind === 'textarea' ? 2 : undefined)}
        meta={empty ? needed : opts.meta}
        controlId={opts.controlId}
        hint={opts.hintId ? undefined : opts.hint}
        footer={opts.hintId ? <span id={opts.hintId} className="ui-fieldcell__hint preset-hint">{opts.hint}</span> : undefined}
      >
        {(c) => kind === 'textarea' ? (
          <textarea {...controlProps(c)} rows={3} onChange={e => typeText(key, e.target.value)} />
        ) : (
          <input
            {...controlProps(c)}
            ref={opts.inputRef}
            type={kind === 'number' ? 'number' : 'text'}
            step={kind === 'number' ? '0.01' : undefined}
            inputMode={kind === 'number' ? 'decimal' : undefined}
            onChange={e => typeText(key, e.target.value)}
          />
        )}
      </FieldCell>
    );
  };

  const selectCell = (
    key: SelectKey,
    label: ReactNode,
    options: { value: string; label: string }[],
    opts: { placeholder?: string; required?: boolean } = {},
  ) => {
    const value = selects[key];
    const empty = opts.required && value === '';
    return (
      <FieldCell key={key} label={label} meta={empty ? needed : undefined}>
        {(c) => (
          <select
            {...c}
            className={`${c.className}${empty ? ' field-required-empty' : ''}`}
            aria-required={opts.required || undefined}
            data-field={key}
            value={value}
            onChange={e => changeSelect(key, e.target.value)}
          >
            {opts.placeholder !== undefined && (
              <option value="" disabled={opts.required && value !== ''}>{opts.placeholder}</option>
            )}
            {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        )}
      </FieldCell>
    );
  };

  const flagCell = (key: FlagKey, label: string, valueText: string) => (
    <FieldCell key={key} label={label}>
      {(c) => (
        <label className="ui-fieldcell__check">
          <input
            {...c}
            type="checkbox"
            data-field={key}
            checked={flags[key]}
            onChange={e => changeFlag(key, e.target.checked)}
          />
          <span>{valueText}</span>
        </label>
      )}
    </FieldCell>
  );

  // The category list, plus the preset's current product_type when it is not
  // one of this workspace's categories, so the select never drops a value.
  const categoryOptions = categories.map(c => ({ value: c.name, label: `${c.emoji ? `${c.emoji} ` : ''}${c.display_name}` }));
  if (selects.product_type && !categoryOptions.some(o => o.value === selects.product_type)) {
    categoryOptions.unshift({ value: selects.product_type, label: selects.product_type });
  }

  const measureKeys = [...new Set([...MEASURE_KEYS, ...Object.keys(measure)])];
  const defaultTemplate = DEFAULT_MEASUREMENT_TEMPLATES[selects.product_type] ?? DEFAULT_MEASUREMENT_TEMPLATES[preset.category_name];
  const customSections = sections.filter(s => !isBuiltin(s.id));

  return (
    <div className="preset-editor-inner">
      <div className="preset-editor-head">
        <h2 className="tv-section-title preset-editor-title">{preset.display_name || 'Untitled preset'}</h2>
        <SaveLine view={status} onRetry={() => queue.retry(id)} />
      </div>

      <div className="preset-editor-groups">
        <FieldGroup caption="Basics">
          <FieldGrid columns={3}>
            {textCell('display_name', reqLabel('Display name'), {
              placeholder: 'e.g., Sweatshirts and hoodies', required: true, span: 2,
              inputRef: nameRef,
            })}
            {selectCell('product_type', reqLabel('Category'), categoryOptions, { placeholder: 'Choose a category', required: true })}
            {textCell('description', 'Description')}
            {textCell('suggested_price_min', 'Min price ($)', { placeholder: '25.00' })}
            {textCell('suggested_price_max', 'Max price ($)', { placeholder: '75.00' })}
            {textCell('default_material', 'Default material', { placeholder: 'e.g., Cotton, polyester' })}
            {selectCell('typical_condition', 'Typical condition', [
              { value: 'NWT', label: 'NWT' }, { value: 'Like New', label: 'Like new' },
              { value: 'Excellent', label: 'Excellent' }, { value: 'Good', label: 'Good' }, { value: 'Fair', label: 'Fair' },
            ], { placeholder: 'None' })}
            {textCell('default_care_instructions', 'Care instructions')}
          </FieldGrid>
          {groupFields(GROUP_SECTIONS.basics)}
        </FieldGroup>

        <FieldGroup caption="Shipping and packaging">
          <FieldGrid columns={3}>
            {textCell('default_weight_value', 'Default weight', { placeholder: 'e.g., 1.2' })}
            {selectCell('default_weight_unit', 'Weight unit', [
              { value: 'lb', label: 'Pounds (lb)' }, { value: 'oz', label: 'Ounces (oz)' },
              { value: 'kg', label: 'Kilograms (kg)' }, { value: 'g', label: 'Grams (g)' },
            ])}
            {flagCell('requires_shipping', 'Shipping', 'Requires shipping')}
            {textCell('package_dimensions', 'Package dimensions', { placeholder: '12 in x 10 in x 4 in' })}
            {selectCell('parcel_size', 'Parcel size', [
              { value: 'Small', label: 'Small' }, { value: 'Medium', label: 'Medium' },
              { value: 'Large', label: 'Large' }, { value: 'Extra Large', label: 'Extra large' },
            ], { placeholder: 'Not set' })}
            {flagCell('continue_selling_out_of_stock', 'Out of stock', 'Keep selling')}
            {textCell('ships_from', 'Ships from', {
              span: 2,
              placeholder: 'Street, city, state and ZIP',
              hintId: 'preset-ships-from-hint',
              hint: 'Used on every listing made from this preset. This workspace’s only; never shared with other shops.',
            })}
            {textCell('discounted_shipping', 'Discounted shipping', { placeholder: 'No discount' })}
          </FieldGrid>
          {groupFields(GROUP_SECTIONS.shipping)}
        </FieldGroup>

        <FieldGroup caption="Classification">
          <FieldGrid columns={3}>
            {selectCell('gender', 'Gender', [
              { value: 'Men', label: 'Men' }, { value: 'Women', label: 'Women' },
              { value: 'Unisex', label: 'Unisex' }, { value: 'Kids', label: 'Kids' },
            ], { placeholder: 'Not set' })}
            {selectCell('size_type', 'Size type', [
              { value: 'Regular', label: 'Regular' }, { value: 'Big & Tall', label: 'Big and tall' },
              { value: 'Petite', label: 'Petite' }, { value: 'Plus Size', label: 'Plus size' }, { value: 'One Size', label: 'One size' },
            ], { placeholder: 'Not set' })}
            {textCell('style', 'Style', { placeholder: 'Vintage, modern, streetwear' })}
            {textCell('age_group', 'Age group', { placeholder: 'Adult (13+ years old)' })}
            {textCell('shopify_product_type', 'Shopify product type', { placeholder: 'For Shopify' })}
            {textCell('vendor', 'Default vendor', { placeholder: 'Optional' })}
            {textCell('who_made_it', 'Who made it', { placeholder: 'Another company or person' })}
            {textCell('what_is_it', 'What is it', { placeholder: 'A finished product' })}
            {textCell('listing_type', 'Listing type', { placeholder: 'Physical item' })}
            {textCell('renewal_options', 'Renewal options', { placeholder: 'Automatic' })}
            {textCell('custom_label_0', 'Custom label (Google Shopping)', { placeholder: 'Top seller' })}
            {textCell('policies', 'Policies', { placeholder: 'No returns; no exchanges' })}
          </FieldGrid>
          {groupFields(GROUP_SECTIONS.classification)}
        </FieldGroup>

        <FieldGroup caption="Measurements">
          <FieldGrid columns={4}>
            {measureKeys.map(k => (
              <FieldCell key={k} label={measureLabel(k)}>
                {(c) => (
                  <label className="ui-fieldcell__check">
                    <input
                      {...c}
                      type="checkbox"
                      data-field={`measure-${k}`}
                      checked={!!measure[k]}
                      onChange={e => setTemplate({ ...measure, [k]: e.target.checked })}
                    />
                    <span>Measured</span>
                  </label>
                )}
              </FieldCell>
            ))}
          </FieldGrid>
          {defaultTemplate && (
            <div className="preset-group-actions">
              <Button size="sm" variant="ghost" onClick={() => setTemplate({ ...measure, ...defaultTemplate })}>
                Use the default template for {selects.product_type || preset.category_name}
              </Button>
            </div>
          )}
          {groupFields(GROUP_SECTIONS.measurements)}
        </FieldGroup>

        <FieldGroup caption="SEO and defaults">
          <FieldGrid columns={3}>
            {textCell('default_tags', 'Default tags', { placeholder: 'sweatshirt, pullover, vintage', hint: 'Separate with commas.' })}
            {textCell('seo_keywords', 'SEO keywords', { placeholder: 'vintage, retro, streetwear', hint: 'Separate with commas.' })}
            {selectCell('default_status', 'Default status', [
              { value: 'Active', label: 'Active' }, { value: 'Draft', label: 'Draft' }, { value: 'Archived', label: 'Archived' },
            ])}
            {textCell('seo_title_template', 'SEO title template', {
              span: 2,
              placeholder: '{size} {brand} {category} {color}',
              hint: 'Placeholders: {size}, {brand}, {category}, {color}, {era}',
            })}
            {textCell('seo_description', 'SEO description', {
              span: 'full',
              placeholder: 'Default meta description for every product in this category',
              hint: 'Applied to new products made from this preset. A value already on the item wins.',
            })}
          </FieldGrid>
          {groupFields(GROUP_SECTIONS.seo)}
        </FieldGroup>

        {/* ── Sections the person made ──────────────────────────────────── */}
        <section className="custom-sections-wrapper" aria-labelledby={`custom-sections-${id}`}>
          <div className="custom-sections-header">
            <h3 id={`custom-sections-${id}`}>Custom sections</h3>
            <Button size="sm" variant="secondary" icon={<Plus size={14} />} onClick={addSection}>Add section</Button>
          </div>
          {customSections.length === 0 && (
            <p className="form-hint">No custom sections yet. Add one to group fields of your own.</p>
          )}
          {customSections.map((section, i) => (
            <div key={section.id} className="custom-section-block">
              <div className="section-header-row">
                <SectionTitle value={section.title} onCommit={t => renameSection(section.id, t)} />
                <div className="section-controls">
                  {i > 0 && (
                    <IconButton size="sm" variant="ghost" label="Move section up" icon={<ChevronUp size={14} />} onClick={() => moveSection(section.id, -1)} />
                  )}
                  {i < customSections.length - 1 && (
                    <IconButton size="sm" variant="ghost" label="Move section down" icon={<ChevronDown size={14} />} onClick={() => moveSection(section.id, 1)} />
                  )}
                  <ConfirmAction
                    label="Delete"
                    icon={<Trash2 size={13} />}
                    confirmLabel="Delete"
                    prompt={`Delete "${section.title}" and its fields?`}
                    onConfirm={() => deleteSection(section.id)}
                  />
                </div>
              </div>
              {fieldsBlock(section.id, true)}
            </div>
          ))}
        </section>
      </div>

      {fieldModal && (
        <FieldModal
          initial={fieldModal.editing}
          onSave={f => saveField(fieldModal.sectionId, f)}
          onClose={() => setFieldModal(null)}
        />
      )}
    </div>
  );
};

// ─── Main component ───────────────────────────────────────────────────────────

type ListMessage = { tone: 'error' | 'info'; text: string } | null;

const CategoryPresetsManager: React.FC<CategoryPresetsManagerProps> = () => {
  const [presets, setPresets] = useState<CategoryPreset[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [listMessage, setListMessage] = useState<ListMessage>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusNameFor, setFocusNameFor] = useState<string | null>(null);
  const [statusById, setStatusById] = useState<Record<string, SaveView>>({});
  const [busy, setBusy] = useState(false);
  // Bumped when the list is reloaded from the server (apply-to-all), so the
  // editor re-reads the preset instead of keeping drafts of the old values.
  const [epoch, setEpoch] = useState(0);

  // Gender filter toggle, persisted in localStorage
  const [genderFilter, setGenderFilter] = useState<'Men' | 'Women' | 'Kids'>(() => {
    try {
      return (localStorage.getItem('presets_gender_filter') as 'Men' | 'Women' | 'Kids') || 'Men';
    } catch {
      return 'Men';
    }
  });

  const setGender = (g: 'Men' | 'Women' | 'Kids') => {
    setGenderFilter(g);
    setSelectedId(null);
    try { localStorage.setItem('presets_gender_filter', g); } catch { /* private mode */ }
  };

  const filteredPresets = presets.filter(p => p.gender === genderFilter);
  // The editor is "the selected preset": the chosen row, otherwise the tab's
  // first row. Derived, never synced in an effect. The chosen row stays open
  // even when an edit to its Gender moves it off this tab; changing the tab
  // clears the choice.
  const selected = presets.find(p => p.id === selectedId) ?? filteredPresets[0] ?? null;

  // Apply-to-all ship-from. `null` = untouched, so the field shows the most
  // common existing value (derived at render, never copied in an effect).
  const [bulkShipFrom, setBulkShipFrom] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkMessage, setBulkMessage] = useState<string | null>(null);
  const bulkValue = bulkShipFrom ?? mostCommonShipFrom(presets);

  // ── the write queue ───────────────────────────────────────────────────────

  const fadeTimers = useRef<Map<string, number>>(new Map());
  const announceTimer = useRef<number | null>(null);
  const announceNames = useRef<Set<string>>(new Set());

  const [queue] = useState<PresetWriteQueue>(() => {
    const setView = (pid: string, view: SaveView) => setStatusById(prev => ({ ...prev, [pid]: view }));
    const clearFade = (pid: string) => {
      const t = fadeTimers.current.get(pid);
      if (t !== undefined) { window.clearTimeout(t); fadeTimers.current.delete(pid); }
    };
    // One presetsUpdated per burst of saves: items already in the workflow
    // re-read their preset once, not once per keystroke-debounce.
    const announce = (categoryName: string | undefined) => {
      if (categoryName) announceNames.current.add(categoryName);
      if (announceTimer.current !== null) window.clearTimeout(announceTimer.current);
      announceTimer.current = window.setTimeout(() => {
        announceTimer.current = null;
        const names = [...announceNames.current];
        announceNames.current.clear();
        window.dispatchEvent(new CustomEvent('presetsUpdated', {
          detail: names.length === 1 ? { categoryName: names[0] } : {},
        }));
      }, ANNOUNCE_DEBOUNCE_MS);
    };

    const q = createPresetWriteQueue<CategoryPreset>({
      write: (pid, patch) => updateCategoryPreset(pid, patch as Partial<CategoryPresetInput>),
      onStart: (pid) => {
        saveStatus.begin();
        clearFade(pid);
        setView(pid, { state: 'saving' });
      },
      onSuccess: (pid, saved, patch, stillFailing) => {
        saveStatus.end(true);
        let categoryName: string | undefined = saved?.category_name;
        setPresets(prev => prev.map(p => {
          if (p.id !== pid) return p;
          categoryName = categoryName ?? p.category_name;
          return { ...p, ...patch, ...(saved ?? {}) } as CategoryPreset;
        }));
        announce(categoryName);
        if (stillFailing || q.busy(pid)) return;
        setView(pid, { state: 'saved' });
        clearFade(pid);
        fadeTimers.current.set(pid, window.setTimeout(() => {
          fadeTimers.current.delete(pid);
          setStatusById(prev => prev[pid]?.state === 'saved' ? { ...prev, [pid]: IDLE } : prev);
        }, SAVED_FADE_MS));
      },
      onError: (pid, error, patch) => {
        const message = describeSaveError(error);
        log.error(`Preset save failed (${Object.keys(patch).join(', ')}): ${message}`, error);
        console.error('Error saving preset:', error);
        saveStatus.end(false, `Preset not saved: ${message}`);
        clearFade(pid);
        setView(pid, { state: 'error', message });
      },
    });
    return q;
  });

  useEffect(() => {
    const fades = fadeTimers.current;
    return () => {
      for (const t of fades.values()) window.clearTimeout(t);
      fades.clear();
      if (announceTimer.current !== null) window.clearTimeout(announceTimer.current);
    };
  }, []);

  // ── loading ───────────────────────────────────────────────────────────────

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [presetsData, categoriesData] = await Promise.all([getCategoryPresets(), getCategories()]);
        if (!alive) return;
        setPresets(presetsData);
        setCategories(categoriesData);
      } catch (error) {
        if (!alive) return;
        const message = describeSaveError(error);
        log.error(`Loading presets failed: ${message}`, error);
        console.error('Error loading data:', error);
        setListMessage({ tone: 'error', text: `Could not load presets: ${message}` });
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const reloadPresets = async () => {
    try {
      const data = await getCategoryPresets();
      setPresets(data);
      setEpoch(e => e + 1);
    } catch (error) {
      const message = describeSaveError(error);
      log.error(`Reloading presets failed: ${message}`, error);
      console.error('Error loading presets:', error);
      setListMessage({ tone: 'error', text: `Could not reload presets: ${message}` });
    }
  };

  /* Writes the one address onto every preset through the same update the
     editor uses, one at a time: a workspace has tens of presets, not
     thousands, and sequential writes keep a partial failure countable. */
  const applyShipFromToAll = async () => {
    const value = bulkValue.trim();
    if (!value || presets.length === 0) return;
    setBulkBusy(true);
    setBulkMessage(null);
    let failed = 0;
    let lastError = '';
    for (const p of presets) {
      try {
        await updateCategoryPreset(p.id, { ships_from: value });
      } catch (error) {
        failed++;
        lastError = describeSaveError(error);
        log.error(`Setting ship-from failed: ${lastError}`, error);
        console.error('Error setting ship-from on preset:', error);
      }
    }
    const total = presets.length;
    setBulkBusy(false);
    setBulkShipFrom(value);
    setBulkMessage(failed === 0
      ? `Ship-from set on ${total} preset${total === 1 ? '' : 's'}.`
      : `Ship-from set on ${total - failed} of ${total} presets. ${failed} could not be saved: ${lastError}`);
    // No category in the detail: every listing built from a preset re-reads it.
    window.dispatchEvent(new CustomEvent('presetsUpdated', { detail: {} }));
    await reloadPresets();
  };

  // ── list actions ──────────────────────────────────────────────────────────

  const selectPreset = (pid: string) => {
    setSelectedId(pid);
    setFocusNameFor(null);
  };

  /** Inserts a row, puts it in the list and opens it with the name selected. */
  const insertAndSelect = async (input: CategoryPresetInput, what: string) => {
    setBusy(true);
    setListMessage(null);
    saveStatus.begin();
    try {
      const created = await createCategoryPreset(input);
      saveStatus.end(true);
      setPresets(prev => [...prev, created]);
      // A duplicate keeps its gender; show the tab it lives on.
      const g = created.gender;
      if ((g === 'Men' || g === 'Women' || g === 'Kids') && g !== genderFilter) setGender(g);
      setSelectedId(created.id);
      setFocusNameFor(created.id);
    } catch (error) {
      const message = describeSaveError(error);
      log.error(`${what} failed: ${message}`, error);
      console.error(`Error (${what}):`, error);
      saveStatus.end(false, `${what} failed: ${message}`);
      setListMessage({ tone: 'error', text: `${what} failed: ${message}` });
    } finally {
      setBusy(false);
    }
  };

  const handleAdd = () => {
    void insertAndSelect({
      category_name: uniqueCategoryName('New preset'),
      display_name: 'New preset',
      gender: genderFilter,
      is_active: true,
      requires_shipping: true,
      default_weight_unit: 'lb',
      measurement_template: { ...EMPTY_TEMPLATE },
    }, 'Adding a preset');
  };

  const handleDuplicate = (preset: CategoryPreset) => {
    const displayName = `${preset.display_name} (copy)`;
    // The whitelist in the service drops id, user_id and the timestamps, and
    // anything that is not a column; is_default stays with the original.
    void insertAndSelect({
      ...(preset as unknown as CategoryPresetInput),
      category_name: uniqueCategoryName(displayName),
      display_name: displayName,
      is_default: false,
    }, 'Duplicating');
  };

  const handleDelete = async (preset: CategoryPreset) => {
    setListMessage(null);
    saveStatus.begin();
    try {
      await deleteCategoryPreset(preset.id);
      saveStatus.end(true);
      setPresets(prev => prev.filter(p => p.id !== preset.id));
      window.dispatchEvent(new CustomEvent('presetsUpdated', { detail: { categoryName: preset.category_name } }));
    } catch (error) {
      const message = describeSaveError(error);
      log.error(`Deleting preset failed: ${message}`, error);
      console.error('Error deleting preset:', error);
      saveStatus.end(false, `Delete failed: ${message}`);
      setListMessage({ tone: 'error', text: `Could not delete "${preset.display_name}": ${message}` });
    }
  };

  // ── render ─────────────────────────────────────────────────────────────────

  if (loading) {
    return <p className="presets-page-loading">Loading category presets…</p>;
  }

  return (
    /* Page layout: the preset list is the left column and the selected preset
       is the right one; on a phone they stack, the editor first. */
    <div className={`presets-page${selected ? ' presets-page--editing' : ''}`}>
      <div className="presets-toolbar">
        {/* ──────────── Gender Toggle ──────────── */}
        <div className="presets-gender-tabs">
          {(['Men', 'Women', 'Kids'] as const).map(g => (
            <button
              key={g}
              type="button"
              className="presets-gender-tab"
              aria-pressed={genderFilter === g}
              onClick={() => setGender(g)}
            >
              {g === 'Men' ? <Users size={14} /> : g === 'Women' ? <UserRound size={14} /> : <Baby size={14} />}
              <span>{g}</span>
            </button>
          ))}
        </div>
        <Button variant="primary" icon={<Plus size={16} />} onClick={handleAdd} disabled={busy}>Add preset</Button>
      </div>

      {listMessage && (
        <p
          className={`presets-list-message${listMessage.tone === 'error' ? ' presets-list-message--error' : ''}`}
          role={listMessage.tone === 'error' ? 'alert' : 'status'}
        >
          {listMessage.text}
        </p>
      )}

      <div className="presets-body tv-cols">
        {/* ──────────── The selected preset ──────────── */}
        {selected && (
          <div className="preset-editor">
            <PresetEditor
              key={`${selected.id}:${epoch}`}
              preset={selected}
              categories={categories}
              queue={queue}
              status={statusById[selected.id] ?? IDLE}
              autoFocusName={focusNameFor === selected.id}
            />
          </div>
        )}

        {/* ──────────── Preset list ──────────── */}
        <div className="presets-grid">
          {/* Every preset, not just the gender tab on screen: the address is
              the workspace's, so one write covers the lot. */}
          {presets.length > 0 && (
            <section className="presets-shipfrom" aria-labelledby="presets-shipfrom-title">
              <h2 className="presets-shipfrom-title" id="presets-shipfrom-title">Ship-from for every preset</h2>
              <div className="presets-shipfrom-row">
                <TextField
                  label="Ship-from address"
                  labelHidden
                  className="presets-shipfrom-field"
                  value={bulkValue}
                  onChange={e => setBulkShipFrom(e.target.value)}
                  placeholder="Street, city, state and ZIP"
                  hint="This workspace’s only; never shared with other shops."
                  disabled={bulkBusy}
                />
                <ConfirmAction
                  label={bulkBusy ? 'Applying…' : 'Apply to all presets'}
                  tone="neutral"
                  size="md"
                  confirmLabel="Apply"
                  prompt={`Set the ship-from on ${presets.length} preset${presets.length === 1 ? '' : 's'}? Presets that already have one are overwritten.`}
                  disabled={bulkBusy || bulkValue.trim() === ''}
                  onConfirm={() => { void applyShipFromToAll(); }}
                />
              </div>
              {bulkMessage && <p className="presets-shipfrom-status" role="status">{bulkMessage}</p>}
            </section>
          )}
          {filteredPresets.length === 0 ? (
            <div className="empty-state">
              <p>No {genderFilter} presets yet. Add one to get started.</p>
            </div>
          ) : (
            filteredPresets.map(preset => {
              const isSelected = selected?.id === preset.id;
              return (
                <div
                  key={preset.id}
                  className={`preset-card${isSelected ? ' preset-card--selected' : ''}`}
                  onClick={e => {
                    if ((e.target as HTMLElement).closest('button, a, input, select, textarea')) return;
                    selectPreset(preset.id);
                  }}
                >
                  <div className="preset-header">
                    <h3>
                      <button
                        type="button"
                        className="preset-card-select"
                        aria-pressed={isSelected}
                        onClick={() => selectPreset(preset.id)}
                      >
                        {preset.display_name}
                      </button>
                    </h3>
                    <span className="preset-category">{preset.product_type || preset.category_name}</span>
                  </div>
                  {presetNeedsShipFrom(preset) && (
                    <div className="preset-flags">
                      <Badge tone="warning">No ship-from</Badge>
                    </div>
                  )}
                  {preset.description && <p className="preset-description">{preset.description}</p>}
                  <div className="preset-details">
                    {preset.default_weight_value && (
                      <div className="preset-detail"><strong>Weight:</strong> {preset.default_weight_value} {preset.default_weight_unit}</div>
                    )}
                    {preset.suggested_price_min && preset.suggested_price_max && (
                      <div className="preset-detail"><strong>Price:</strong> ${preset.suggested_price_min} to ${preset.suggested_price_max}</div>
                    )}
                    {preset.default_tags && preset.default_tags.length > 0 && (
                      <div className="preset-detail"><strong>Tags:</strong> {preset.default_tags.join(', ')}</div>
                    )}
                    <div className="preset-detail">
                      <strong>Measurements:</strong>{' '}
                      {Object.entries(preset.measurement_template ?? {}).filter(([, v]) => v).map(([k]) => measureLabel(k).toLowerCase()).join(', ') || 'None'}
                    </div>
                    {preset.custom_sections && preset.custom_sections.length > 0 && (
                      <div className="preset-detail">
                        <strong>Custom fields:</strong> {preset.custom_sections.reduce((n, s) => n + s.fields.length, 0)}
                      </div>
                    )}
                  </div>
                  <div className="preset-actions">
                    <Button size="sm" variant="secondary" icon={<Copy size={14} />} onClick={() => handleDuplicate(preset)} disabled={busy}>
                      Duplicate
                    </Button>
                    <ConfirmAction
                      label="Delete"
                      icon={<Trash2 size={14} />}
                      confirmLabel="Delete"
                      prompt={`Delete "${preset.display_name}"?`}
                      onConfirm={() => { void handleDelete(preset); }}
                    />
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};

export default CategoryPresetsManager;
