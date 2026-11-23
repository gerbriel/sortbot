import { useState } from 'react';
import { Barcode, Plus, Pencil } from 'lucide-react';
import {
  previewCodes, validateCodeSettings,
  SKU_PREFIX_MAX, SEQUENCE_DIGITS_MIN, SEQUENCE_DIGITS_MAX,
  type CodeSettings, type BarcodeMode, type CodeAutoAssign, type SkuScheme,
} from '../lib/codeSettings';
import { countMissingCodes, regenerateMissingCodes } from '../lib/labelsService';
import {
  LABEL_TEMPLATES, LABEL_TEMPLATE_LIMITS, LABEL_TEMPLATE_NAME_MAX,
  validateLabelTemplate, labelTemplateFromInput, labelTemplateToInput, newLabelTemplateId,
  type LabelTemplate, type LabelTemplateInput,
} from '../lib/labelTemplates';
import { Badge, Button, ConfirmAction, FieldCell, FieldGrid, FieldGroup } from './ui';

/* ── Workspace → Settings: SKUs and barcodes, and Label sizes ──────────────
   Both live in `description_settings` (`codes`, `labelTemplates`) and are
   saved by OrgPanel's one writer, so this file holds no persistence of its
   own beyond the two code-assignment calls. State stays in OrgPanel: a save
   writes the whole JSONB, and the form state for every section must be in
   one place for that write to be whole. */

const EAN_PREFIXES = ['20', '21', '22', '23', '24', '25', '26', '27', '28', '29'];

function errorFor(errors: { field: string; message: string }[], field: string): string | undefined {
  return errors.find(e => e.field === field)?.message;
}

/** A hint that turns into the field's error when there is one. */
function hintOrError(error: string | undefined, hint?: string) {
  if (error) return <span className="org-codes-error" role="alert">{error}</span>;
  return hint;
}

export interface CodesSettingsGroupProps {
  orgId: string;
  /** The form draft. */
  value: CodeSettings;
  /** What is saved; Assign codes uses this, never an unsaved draft. */
  saved: CodeSettings;
  onChange: (next: CodeSettings) => void;
  onSave: () => void;
  busy: boolean;
  onNotice: (text: string) => void;
}

export function CodesSettingsGroup({ orgId, value, saved, onChange, onSave, busy, onNotice }: CodesSettingsGroupProps) {
  const errors = validateCodeSettings(value);
  const preview = previewCodes(value);
  const dirty = JSON.stringify(value) !== JSON.stringify(saved);
  const patch = (p: Partial<CodeSettings>) => onChange({ ...value, ...p });

  const [missing, setMissing] = useState<number | null>(null);
  const [assigning, setAssigning] = useState(false);

  const handleCount = async () => {
    if (assigning) return;
    setAssigning(true);
    const res = await countMissingCodes(orgId);
    setAssigning(false);
    if (res.status === 'ok') {
      if (res.count === 0) { onNotice('Every listing already has a code.'); return; }
      setMissing(res.count);
    } else if (res.status === 'unavailable') {
      onNotice('Codes need the code sequences migration to be run first.');
    } else {
      onNotice(`Could not count listings: ${res.error}`);
    }
  };

  const handleAssign = async () => {
    setMissing(null);
    setAssigning(true);
    const res = await regenerateMissingCodes(orgId, saved);
    setAssigning(false);
    if (res.status === 'ok') {
      onNotice(`Assigned ${res.assigned} code${res.assigned === 1 ? '' : 's'}.`);
    } else if (res.status === 'unavailable') {
      onNotice('Codes need the code sequences migration to be run first.');
    } else {
      onNotice(`Assigning codes failed: ${res.error}`);
    }
  };

  return (
    <div className="org-codes">
      <FieldGroup caption="SKUs and barcodes" className="org-codes-group">
        <FieldGrid columns={3}>
          <FieldCell label="Prefix" hint={hintOrError(errorFor(errors, 'skuPrefix'), `Up to ${SKU_PREFIX_MAX} letters or digits.`)}>
            {(c) => (
              <input
                {...c}
                type="text"
                value={value.skuPrefix}
                maxLength={SKU_PREFIX_MAX}
                autoCapitalize="characters"
                spellCheck={false}
                aria-invalid={!!errorFor(errors, 'skuPrefix')}
                onChange={(e) => patch({ skuPrefix: e.target.value.toUpperCase() })}
              />
            )}
          </FieldCell>
          <FieldCell label="Separator">
            {(c) => (
              <select {...c} value={value.skuSeparator === '' ? 'none' : 'dash'}
                onChange={(e) => patch({ skuSeparator: e.target.value === 'none' ? '' : '-' })}>
                <option value="dash">Dash</option>
                <option value="none">None</option>
              </select>
            )}
          </FieldCell>
          <FieldCell label="Scheme">
            {(c) => (
              <select {...c} value={value.skuScheme}
                onChange={(e) => patch({ skuScheme: e.target.value as SkuScheme })}>
                <option value="random">Random letters and digits</option>
                <option value="sequential">Sequential number</option>
              </select>
            )}
          </FieldCell>
          {value.skuScheme === 'sequential' && (
            <FieldCell label="Digits" hint={hintOrError(errorFor(errors, 'sequenceDigits'), `${SEQUENCE_DIGITS_MIN} to ${SEQUENCE_DIGITS_MAX}.`)}>
              {(c) => (
                <input
                  {...c}
                  type="number"
                  inputMode="numeric"
                  min={SEQUENCE_DIGITS_MIN}
                  max={SEQUENCE_DIGITS_MAX}
                  value={Number.isFinite(value.sequenceDigits) ? value.sequenceDigits : ''}
                  aria-invalid={!!errorFor(errors, 'sequenceDigits')}
                  onChange={(e) => patch({ sequenceDigits: e.target.value === '' ? NaN : Number(e.target.value) })}
                />
              )}
            </FieldCell>
          )}
          <FieldCell label="Category code" hint="ACD-TEE-00012 style">
            {(c) => (
              <span className="ui-fieldcell__check">
                <input {...c} type="checkbox" checked={value.categoryCode}
                  onChange={(e) => patch({ categoryCode: e.target.checked })} />
                <span>{value.categoryCode ? 'On' : 'Off'}</span>
              </span>
            )}
          </FieldCell>
          <FieldCell label="Barcode">
            {(c) => (
              <select {...c} value={value.barcodeMode}
                onChange={(e) => patch({ barcodeMode: e.target.value as BarcodeMode })}>
                <option value="sku">Same as the SKU (Code 128)</option>
                <option value="ean13_store">In-store EAN-13 (GS1 20 to 29)</option>
                <option value="manual">Typed by hand</option>
              </select>
            )}
          </FieldCell>
          {value.barcodeMode === 'ean13_store' && (
            <FieldCell label="In-store prefix" hint={hintOrError(errorFor(errors, 'ean13Prefix'), 'Reserved by GS1 for use inside one shop.')}>
              {(c) => (
                <select {...c} value={value.ean13Prefix}
                  onChange={(e) => patch({ ean13Prefix: e.target.value })}>
                  {EAN_PREFIXES.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              )}
            </FieldCell>
          )}
          <FieldCell label="Assign codes">
            {(c) => (
              <select {...c} value={value.autoAssign}
                onChange={(e) => patch({ autoAssign: e.target.value as CodeAutoAssign })}>
                <option value="on_save">When a listing is first saved</option>
                <option value="on_labels">When labels are printed</option>
                <option value="never">Only when I press Generate</option>
              </select>
            )}
          </FieldCell>
        </FieldGrid>
      </FieldGroup>
      <p className="org-codes-preview" aria-live="polite">
        Example: {preview.sku}, barcode {preview.barcode}
      </p>
      <div className="org-codes-actions">
        <Button variant="primary" size="sm" disabled={busy || errors.length > 0 || !dirty} onClick={onSave}>
          Save codes
        </Button>
        {missing === null ? (
          <Button
            size="sm"
            icon={<Barcode size={14} />}
            loading={assigning}
            disabled={busy || dirty}
            title={dirty ? 'Save the convention first' : undefined}
            onClick={() => void handleCount()}
          >
            Assign codes to listings without one
          </Button>
        ) : (
          <ConfirmAction
            label="Assign codes"
            confirmLabel="Assign"
            tone="neutral"
            armed
            onArmedChange={(next) => { if (!next) setMissing(null); }}
            prompt={`Assign codes to ${missing} listing${missing === 1 ? '' : 's'}?`}
            onConfirm={() => void handleAssign()}
          />
        )}
      </div>
      <p className="org-codes-note">
        Changing the convention never rewrites existing SKUs; only listings without a code get one.
      </p>
    </div>
  );
}

/* ── Label sizes ───────────────────────────────────────────────────────── */

type DraftKey = keyof LabelTemplateInput;

/* A new stock starts from the first built-in, which is known to fit. */
const EMPTY_INPUT: LabelTemplateInput = { ...labelTemplateToInput(LABEL_TEMPLATES[0]), id: undefined, name: '', note: '' };

const L = LABEL_TEMPLATE_LIMITS;
const NUMBER_FIELDS: { key: Exclude<DraftKey, 'name' | 'note' | 'id'>; label: string; step: string; lim: { min: number; max: number } }[] = [
  { key: 'pageWidth', label: 'Page width (in)', step: '0.01', lim: L.pageWidth },
  { key: 'pageHeight', label: 'Page height (in)', step: '0.01', lim: L.pageHeight },
  { key: 'marginBlock', label: 'Margin top and bottom (in)', step: '0.01', lim: L.margin },
  { key: 'marginInline', label: 'Margin sides (in)', step: '0.01', lim: L.margin },
  { key: 'columns', label: 'Columns', step: '1', lim: L.columns },
  { key: 'labelWidth', label: 'Label width (in)', step: '0.01', lim: L.labelWidth },
  { key: 'labelHeight', label: 'Label height (in)', step: '0.01', lim: L.labelHeight },
  { key: 'gapX', label: 'Gap across (in)', step: '0.01', lim: L.gap },
  { key: 'gapY', label: 'Gap down (in)', step: '0.01', lim: L.gap },
  { key: 'moduleWidth', label: 'Bar module width', step: '1', lim: L.moduleWidth },
  { key: 'barHeight', label: 'Bar height (px)', step: '1', lim: L.barHeight },
];

export interface LabelSizesGroupProps {
  templates: LabelTemplate[];
  busy: boolean;
  /** Persist the next list; resolves true when saved. */
  onSave: (next: LabelTemplate[], message: string) => Promise<boolean>;
}

export function LabelSizesGroup({ templates, busy, onSave }: LabelSizesGroupProps) {
  /* null = form closed, 'new' = adding, otherwise the id being edited. */
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<LabelTemplateInput>(EMPTY_INPUT);
  const [touched, setTouched] = useState(false);

  const errors = validateLabelTemplate(draft);
  const errorOf = (k: DraftKey): string | undefined => (touched ? errorFor(errors, k) : undefined);

  const open = (id: string | null, input: LabelTemplateInput) => {
    setEditing(id);
    setDraft(input);
    setTouched(false);
  };

  const handleSave = async () => {
    setTouched(true);
    if (validateLabelTemplate(draft).length > 0) return;
    const isNew = editing === 'new';
    const template = labelTemplateFromInput(draft, isNew ? newLabelTemplateId() : (editing as string));
    const next = isNew
      ? [...templates, template]
      : templates.map(t => (t.id === editing ? template : t));
    const ok = await onSave(next, isNew ? `Label size “${template.name}” added.` : `Label size “${template.name}” saved.`);
    if (ok) setEditing(null);
  };

  const handleDelete = (id: string) => {
    const gone = templates.find(t => t.id === id);
    void onSave(templates.filter(t => t.id !== id), `Label size “${gone?.name ?? ''}” deleted.`);
    if (editing === id) setEditing(null);
  };

  return (
    <div className="org-labelsizes">
      <FieldGroup caption="Label sizes" className="org-labelsizes-group">
        <ul className="org-labelsizes-list">
          {LABEL_TEMPLATES.map(t => (
            <li key={t.id} className="org-labelsizes-row">
              <span className="org-labelsizes-name">{t.name}</span>
              <span className="org-labelsizes-note">{t.note}</span>
              <Badge>Built in</Badge>
            </li>
          ))}
          {templates.map(t => (
            <li key={t.id} className="org-labelsizes-row">
              <span className="org-labelsizes-name">{t.name}</span>
              <span className="org-labelsizes-note">{t.note}</span>
              <span className="org-labelsizes-actions">
                <Button size="sm" variant="ghost" icon={<Pencil size={13} />} disabled={busy}
                  onClick={() => open(t.id, labelTemplateToInput(t))}>
                  Edit
                </Button>
                <ConfirmAction
                  label="Delete"
                  confirmLabel="Delete"
                  prompt={`Delete “${t.name}”?`}
                  disabled={busy}
                  onConfirm={() => handleDelete(t.id)}
                />
              </span>
            </li>
          ))}
        </ul>
      </FieldGroup>

      {editing === null ? (
        <div className="org-codes-actions">
          <Button size="sm" icon={<Plus size={14} />} disabled={busy} onClick={() => open('new', EMPTY_INPUT)}>
            Add a label size
          </Button>
        </div>
      ) : (
        <div className="org-labelsizes-form">
          <FieldGroup caption={editing === 'new' ? 'New label size' : 'Edit label size'}>
            <FieldGrid columns={3}>
              <FieldCell label="Name" span="full" hint={hintOrError(errorOf('name'))}>
                {(c) => (
                  <input {...c} type="text" value={draft.name} maxLength={LABEL_TEMPLATE_NAME_MAX}
                    placeholder="e.g. 3 x 2 thermal roll"
                    aria-invalid={!!errorOf('name')}
                    onChange={(e) => setDraft(d => ({ ...d, name: e.target.value }))} />
                )}
              </FieldCell>
              {NUMBER_FIELDS.map(f => (
                <FieldCell key={f.key} label={f.label} hint={hintOrError(errorOf(f.key))}>
                  {(c) => (
                    <input
                      {...c}
                      type="number"
                      inputMode="decimal"
                      step={f.step}
                      min={f.lim.min}
                      max={f.lim.max}
                      value={Number.isFinite(draft[f.key]) ? String(draft[f.key]) : ''}
                      aria-invalid={!!errorOf(f.key)}
                      onChange={(e) => {
                        const n = e.target.value === '' ? NaN : Number(e.target.value);
                        setDraft(d => ({ ...d, [f.key]: n }));
                      }}
                    />
                  )}
                </FieldCell>
              ))}
            </FieldGrid>
          </FieldGroup>
          <div className="org-codes-actions">
            <Button variant="primary" size="sm" disabled={busy} onClick={() => void handleSave()}>
              {editing === 'new' ? 'Add label size' : 'Save label size'}
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setEditing(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
