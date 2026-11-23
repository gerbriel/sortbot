import React, { useLayoutEffect, useRef, useState } from 'react';
import type { ClothingItem } from '../App';
import { FieldCell, FieldGrid, FieldGroup } from './ui/FieldGrid';

interface VoiceCommandTableProps {
  currentItem: ClothingItem;
  isRecording: boolean;
  activeField: string | null;          // column currently being listened to
  interimValue: string;                // what's currently being spoken (for active cell preview)
  onChange: (field: string, value: string) => void;
}

// ── Field definitions ──────────────────────────────────────────────────────
interface VoiceTableField {
  label: string;
  key: string;
  placeholder: string;
  getValue: (item: ClothingItem) => string;
}

interface VoiceTableGroup {
  id: string;
  /** Quiet caption above the group's grid. Omitted for the lead block. */
  caption?: string;
  /** One column at every width (Title, Description). */
  full?: boolean;
  fields: VoiceTableField[];
}

const meas = (i: ClothingItem, k: string): string =>
  ((i.measurements as Record<string, string | undefined> | undefined)?.[k]) || '';

// Field keys are what PDG's handleTableFieldChange and the dictation grammar
// write; they must not change. Labels are sentence case and are display only.
const VOICE_TABLE_GROUPS: VoiceTableGroup[] = [
  // Title and Description: one full-width cell each, labelled by the field
  // itself, so there is no separate group caption above them.
  {
    id: 'lead',
    full: true,
    fields: [
      { label: 'Title',       key: 'seoTitle',          placeholder: 'Vintage Nike Tee…',                     getValue: i => i.seoTitle || '' },
      { label: 'Description', key: 'customDescription', placeholder: 'e.g. Great for layering, rare colourway…', getValue: i => (i as { customDescription?: string }).customDescription || '' },
    ],
  },
  {
    id: 'core',
    caption: 'Core info',
    fields: [
      { label: 'Brand',     key: 'brand',          placeholder: 'Nike',      getValue: i => i.brand || '' },
      { label: 'Size',      key: 'size',           placeholder: 'XL',        getValue: i => i.size || '' },
      { label: 'Color',     key: 'color',          placeholder: 'Blue',      getValue: i => i.color || '' },
      { label: '2nd color', key: 'secondaryColor', placeholder: 'White',     getValue: i => i.secondaryColor || '' },
      { label: 'Condition', key: 'condition',      placeholder: 'Excellent', getValue: i => i.condition || '' },
      { label: 'Price',     key: 'price',          placeholder: '$25',       getValue: i => i.price != null ? String(i.price) : '' },
    ],
  },
  {
    id: 'style',
    caption: 'Style and details',
    fields: [
      { label: 'Era',      key: 'era',      placeholder: '2000s',           getValue: i => i.era || '' },
      { label: 'Style',    key: 'style',    placeholder: 'Casual',          getValue: i => i.style || '' },
      { label: 'Gender',   key: 'gender',   placeholder: "Men's",           getValue: i => i.gender || '' },
      { label: 'Material', key: 'material', placeholder: 'Cotton',          getValue: i => i.material || '' },
      { label: 'Tags',     key: 'tags',     placeholder: 'y2k streetwear…', getValue: i => (i.tags || []).join(', ') },
      { label: 'Flaws',    key: 'flaws',    placeholder: 'small hole',      getValue: i => i.flaws || '' },
      { label: 'Care',     key: 'care',     placeholder: 'hand wash',       getValue: i => i.care || '' },
    ],
  },
  // One group, top of the garment to the bottom. The keys are unchanged
  // (meas_leg still maps to measurements.leg_opening).
  {
    id: 'measurements',
    caption: 'Measurements',
    fields: [
      { label: 'Chest',       key: 'meas_chest',    placeholder: '38"', getValue: i => meas(i, 'chest') },
      { label: 'Width',       key: 'meas_width',    placeholder: '18"', getValue: i => meas(i, 'width') },
      { label: 'Length',      key: 'meas_length',   placeholder: '28"', getValue: i => meas(i, 'length') },
      { label: 'Sleeve',      key: 'meas_sleeve',   placeholder: '24"', getValue: i => meas(i, 'sleeve') },
      { label: 'Shoulder',    key: 'meas_shoulder', placeholder: '17"', getValue: i => meas(i, 'shoulder') },
      { label: 'Waist',       key: 'meas_waist',    placeholder: '32"', getValue: i => meas(i, 'waist') },
      { label: 'Hip',         key: 'meas_hip',      placeholder: '40"', getValue: i => meas(i, 'hip') },
      { label: 'Rise',        key: 'meas_rise',     placeholder: '10"', getValue: i => meas(i, 'rise') },
      { label: 'Inseam',      key: 'meas_inseam',   placeholder: '30"', getValue: i => meas(i, 'inseam') },
      { label: 'Outseam',     key: 'meas_outseam',  placeholder: '40"', getValue: i => meas(i, 'outseam') },
      { label: 'Leg opening', key: 'meas_leg',      placeholder: '18"', getValue: i => meas(i, 'leg_opening') },
    ],
  },
];

const FIELD_LABEL: Record<string, string> = Object.fromEntries(
  VOICE_TABLE_GROUPS.flatMap(g => g.fields.map(f => [f.key, f.label.toLowerCase()])),
);

/** The cell being edited: what the user has typed, and what it held on focus. */
interface Editing { itemId: string; key: string; draft: string; original: string }

// Map voice command keywords → field keys (for active-column detection).
// The vocabulary itself lives in lib/voiceGrammar.ts, next to the parser that
// consumes it; re-exported here because this is where callers have always
// imported it from.
export { VOICE_KEYWORD_TO_FIELD } from '../lib/voiceGrammar';

/**
 * The voice field table: labelled cells (small label above its value) in a
 * responsive grid per group, under a quiet group caption.
 *
 * Editing contract. Every value is a real <input>, so Tab walks the cells in
 * order natively and a click or tap anywhere in a cell focuses it. While a cell
 * is focused it holds a local draft and nothing is written: Enter commits and
 * leaves the cell, leaving it any other way (Tab, a click elsewhere) commits,
 * and Escape puts the value back the way it was on focus. `onChange` fires only
 * on a commit that actually changed the value. Key events never bubble past a
 * cell, so the Step 3 window shortcuts (the "." boundary key) stand down.
 *
 * While dictating, the cell named by `activeField` is marked and shows the
 * interim words in its value slot until the final lands, unless the user is
 * typing in that very cell, in which case their draft wins.
 */
const VoiceCommandTable: React.FC<VoiceCommandTableProps> = ({
  currentItem,
  isRecording,
  activeField,
  interimValue,
  onChange,
}) => {
  const [editing, setEditingState] = useState<Editing | null>(null);
  // A ref mirror, so a blur that follows an Enter or Escape in the same tick
  // sees the cleared state instead of committing twice.
  const editingRef = useRef<Editing | null>(null);
  const setEditing = (next: Editing | null) => {
    editingRef.current = next;
    setEditingState(next);
  };

  const commit = () => {
    const e = editingRef.current;
    setEditing(null);
    if (e && e.draft !== e.original) onChange(e.key, e.draft);
  };

  // ── Drafts that would otherwise be lost without a blur ────────────────────
  // The listing this table last rendered for, and the onChange it rendered
  // with. LIMIT: onChange(field, value) cannot name an item, so a draft is
  // committed to the OLD listing by calling the OLD onChange, which is only
  // correct because the caller's handler closes over the listing it was
  // rendered for (PDG's handleTableFieldChange reads its render's
  // currentGroupIndex). A caller whose onChange reads "the current item" from
  // a ref or store at call time would misdirect this write.
  const renderedRef = useRef({ itemId: currentItem.id, onChange });

  // No deps on purpose: runs after every commit, before paint and before any
  // passive effect. On an item change it flushes the draft through the
  // previous render's onChange and drops it from the ref. The state copy is
  // left alone (no setState in an effect): render ignores a draft whose
  // itemId is not the current item, so the new listing's values show.
  useLayoutEffect(() => {
    const prev = renderedRef.current;
    if (prev.itemId !== currentItem.id) {
      const e = editingRef.current;
      if (e && e.itemId === prev.itemId) {
        editingRef.current = null;
        if (e.draft !== e.original) prev.onChange(e.key, e.draft);
      }
    }
    renderedRef.current = { itemId: currentItem.id, onChange };
  });

  // Unmount (a batch switch remounts Step 3). A layout cleanup, not a passive
  // one: it runs before the parent's passive unmount flush, so PDG's own
  // flush already sees the save this write schedules.
  useLayoutEffect(() => {
    const editingBox = editingRef;
    const renderedBox = renderedRef;
    return () => {
      const e = editingBox.current;
      editingBox.current = null;
      if (e && e.draft !== e.original) renderedBox.current.onChange(e.key, e.draft);
    };
  }, []);

  const renderCell = (field: VoiceTableField) => {
    const isActive = activeField === field.key;
    const listening = isActive && isRecording;
    const rawValue = field.getValue(currentItem);
    const liveEditing = editing && editing.itemId === currentItem.id ? editing : null;
    const isEditing = liveEditing?.key === field.key;
    const showInterim = listening && !!interimValue && !isEditing;
    const value = isEditing && liveEditing ? liveEditing.draft : showInterim ? interimValue : rawValue;
    const inputId = `vct-${field.key}`;
    const className = [
      'vct-col',
      listening ? 'vct-col--active' : '',
      rawValue ? 'vct-col--filled' : '',
      isEditing ? 'vct-col--editing' : '',
    ].filter(Boolean).join(' ');

    // FieldCell owns the anatomy and the click-anywhere-focuses behaviour;
    // the .vct-* classes stay as hooks for the tests and the local
    // active/listening styles.
    return (
      <FieldCell
        key={field.key}
        className={className}
        data-field={field.key}
        label={field.label}
        labelClassName="vct-header"
        controlId={inputId}
      >
        {c => (
          <input
            id={c.id}
            className={`${c.className} vct-cell${showInterim ? ' vct-cell--listening' : ''}`}
            value={value}
            placeholder={field.placeholder}
            autoComplete="off"
            onFocus={() => setEditing({ itemId: currentItem.id, key: field.key, draft: rawValue, original: rawValue })}
            onChange={e => setEditing({
              itemId: currentItem.id,
              key: field.key,
              draft: e.target.value,
              original: editingRef.current?.key === field.key && editingRef.current.itemId === currentItem.id
                ? editingRef.current.original
                : rawValue,
            })}
            onBlur={commit}
            onKeyDown={e => {
              e.stopPropagation();
              if (e.key === 'Enter') {
                e.preventDefault();
                commit();
                e.currentTarget.blur();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                const cur = editingRef.current;
                if (cur && cur.key === field.key) setEditing({ ...cur, draft: cur.original });
              }
            }}
          />
        )}
      </FieldCell>
    );
  };

  return (
    <div className="vct-wrapper">
      {VOICE_TABLE_GROUPS.map(group => (
        // FieldGroup's frame clips the grid's outer hairlines, so rules show
        // only BETWEEN cells at any column count (ui/FieldGrid.css).
        <FieldGroup
          key={group.id}
          className={`vct-row-group${group.full ? ' vct-row-group--title' : ''}`}
          data-group={group.id}
          caption={group.caption}
          captionClassName="vct-row-label"
          frameClassName="vct-frame"
        >
          <FieldGrid full={group.full} className={`vct-grid${group.full ? ' vct-grid--full' : ''}`}>
            {group.fields.map(renderCell)}
          </FieldGrid>
        </FieldGroup>
      ))}

      {isRecording && activeField && (
        <div className="vct-status">
          <span className="vct-status-dot" />
          Listening for <strong>{FIELD_LABEL[activeField] ?? activeField.replace('meas_', '')}</strong>. Say the value, then the next field name, or say <strong>"period"</strong> or press the <strong>.</strong> key.
        </div>
      )}
      {isRecording && !activeField && (
        <div className="vct-status vct-status--idle">
          <span className="vct-status-dot vct-status-dot--idle" />
          Say a field name to fill its cell (e.g. <em>"brand"</em>, <em>"color"</em>…)
        </div>
      )}
    </div>
  );
};

export default VoiceCommandTable;
