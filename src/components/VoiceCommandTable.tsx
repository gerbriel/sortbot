import React from 'react';
import type { ClothingItem } from '../App';

interface VoiceCommandTableProps {
  currentItem: ClothingItem;
  isRecording: boolean;
  activeField: string | null;          // column currently being listened to
  interimValue: string;                // what's currently being spoken (for active cell preview)
  onChange: (field: string, value: string) => void;
}

// ── Field definitions ──────────────────────────────────────────────────────
const TITLE_FIELD = { label: 'title', key: 'seoTitle', placeholder: 'Vintage Nike Tee…', getValue: (i: ClothingItem) => i.seoTitle || '' };

// Three rows of columns, grouped by category
const ROWS: { label: string; key: string; placeholder: string; getValue: (item: ClothingItem) => string }[][] = [
  // Row 1 — Core info (title moved to its own row above)
  [
    { label: 'brand',     key: 'brand',           placeholder: 'Nike',              getValue: i => i.brand || '' },
    { label: 'size',      key: 'size',            placeholder: 'XL',                getValue: i => i.size || '' },
    { label: 'color',     key: 'color',           placeholder: 'Blue',              getValue: i => i.color || '' },
    { label: '2nd color', key: 'secondaryColor',  placeholder: 'White',             getValue: i => i.secondaryColor || '' },
    { label: 'condition', key: 'condition',       placeholder: 'Excellent',         getValue: i => i.condition || '' },
    { label: 'price',     key: 'price',           placeholder: '$25',               getValue: i => i.price != null ? String(i.price) : '' },
  ],
  // Row 2 — Style & details
  [
    { label: 'era',       key: 'era',             placeholder: '2000s',             getValue: i => i.era || '' },
    { label: 'style',     key: 'style',           placeholder: 'Casual',            getValue: i => i.style || '' },
    { label: 'gender',    key: 'gender',          placeholder: "Men's",             getValue: i => i.gender || '' },
    { label: 'material',  key: 'material',        placeholder: 'Cotton',            getValue: i => i.material || '' },
    { label: 'tags',      key: 'tags',            placeholder: 'y2k streetwear…',   getValue: i => (i.tags || []).join(', ') },
    { label: 'flaws',     key: 'flaws',           placeholder: 'small hole',        getValue: i => i.flaws || '' },
    { label: 'care',      key: 'care',            placeholder: 'hand wash',         getValue: i => i.care || '' },
  ],
  // Row 3 — Measurements (upper body / flat-lay)
  [
    { label: 'chest',      key: 'meas_chest',     placeholder: '38"', getValue: i => (i.measurements as any)?.chest || '' },
    { label: 'width',      key: 'meas_width',     placeholder: '18"', getValue: i => (i.measurements as any)?.width || '' },
    { label: 'length',     key: 'meas_length',    placeholder: '28"', getValue: i => (i.measurements as any)?.length || '' },
    { label: 'sleeve',     key: 'meas_sleeve',    placeholder: '24"', getValue: i => (i.measurements as any)?.sleeve || '' },
    { label: 'shoulder',   key: 'meas_shoulder',  placeholder: '17"', getValue: i => (i.measurements as any)?.shoulder || '' },
  ],
  // Row 4 — Measurements (lower body)
  [
    { label: 'waist',      key: 'meas_waist',     placeholder: '32"', getValue: i => (i.measurements as any)?.waist || '' },
    { label: 'hip',        key: 'meas_hip',       placeholder: '40"', getValue: i => (i.measurements as any)?.hip || '' },
    { label: 'rise',       key: 'meas_rise',      placeholder: '10"', getValue: i => (i.measurements as any)?.rise || '' },
    { label: 'inseam',     key: 'meas_inseam',    placeholder: '30"', getValue: i => (i.measurements as any)?.inseam || '' },
    { label: 'outseam',    key: 'meas_outseam',   placeholder: '40"', getValue: i => (i.measurements as any)?.outseam || '' },
    { label: 'leg opening',key: 'meas_leg',       placeholder: '18"', getValue: i => (i.measurements as any)?.leg_opening || '' },
  ],
];

// Map voice command keywords → field keys (for active-column detection)
export const VOICE_KEYWORD_TO_FIELD: Record<string, string> = {
  'title': 'seoTitle',
  'brand': 'brand',
  'size': 'size',
  'color': 'color',
  'colour': 'color',
  'secondary color': 'secondaryColor',
  'secondary colour': 'secondaryColor',
  'second color': 'secondaryColor',
  'second colour': 'secondaryColor',
  '2nd color': 'secondaryColor',
  'secondary': 'secondaryColor',
  'accent color': 'secondaryColor',
  'accent colour': 'secondaryColor',
  'accent': 'secondaryColor',
  'condition': 'condition',
  'price': 'price',
  'era': 'era',
  'style': 'style',
  'gender': 'gender',
  'material': 'material',
  'fabric': 'material',
  'tags': 'tags',
  'tag': 'tags',
  'flaws': 'flaws',
  'flaw': 'flaws',
  'care': 'care',
  'width': 'meas_width',
  'length': 'meas_length',
  'chest': 'meas_chest',
  'waist': 'meas_waist',
  'hip': 'meas_hip',
  'rise': 'meas_rise',
  'inseam': 'meas_inseam',
  'outseam': 'meas_outseam',
  'leg opening': 'meas_leg',
  'sleeve': 'meas_sleeve',
  'shoulder': 'meas_shoulder',
};

const ROW_LABELS = ['Core Info', 'Style & Details', 'Measurements (upper)', 'Measurements (lower)'];

const VoiceCommandTable: React.FC<VoiceCommandTableProps> = ({
  currentItem,
  isRecording,
  activeField,
  interimValue,
  onChange,
}) => {
  return (
    <div className="vct-wrapper">
      {/* Title — full-width row */}
      <div className="vct-row-group vct-row-group--title">
        <div className="vct-row-label">Title</div>
        <div className="vct-grid vct-grid--full">
          {(() => {
            const col = TITLE_FIELD;
            const isActive = activeField === col.key;
            const rawValue = col.getValue(currentItem);
            const displayValue = isActive && isRecording && interimValue ? interimValue : rawValue;
            return (
              <div className={`vct-col${isActive ? ' vct-col--active' : ''}${rawValue ? ' vct-col--filled' : ''}`}>
                <div className="vct-header">
                  {isActive && isRecording && <span className="vct-listening-dot" />}
                  {col.label}
                </div>
                <input
                  className={`vct-cell${isActive && isRecording ? ' vct-cell--listening' : ''}`}
                  value={displayValue}
                  placeholder={col.placeholder}
                  onChange={e => onChange(col.key, e.target.value)}
                  onKeyDown={e => e.stopPropagation()}
                />
              </div>
            );
          })()}
        </div>
      </div>

      {ROWS.map((cols, rowIdx) => (
        <div key={rowIdx} className="vct-row-group">
          <div className="vct-row-label">{ROW_LABELS[rowIdx]}</div>
          <div className="vct-grid" style={{ gridTemplateColumns: `repeat(${cols.length}, minmax(90px, 1fr))` }}>
            {cols.map(col => {
              const isActive = activeField === col.key;
              const rawValue = col.getValue(currentItem);
              const displayValue = isActive && isRecording && interimValue
                ? interimValue
                : rawValue;
              const isFilled = !!rawValue;

              return (
                <div
                  key={col.key}
                  className={`vct-col${isActive ? ' vct-col--active' : ''}${isFilled ? ' vct-col--filled' : ''}`}
                >
                  {/* Header cell */}
                  <div className="vct-header">
                    {isActive && isRecording && (
                      <span className="vct-listening-dot" />
                    )}
                    {col.label}
                  </div>
                  {/* Value cell */}
                  <input
                    className={`vct-cell${isActive && isRecording ? ' vct-cell--listening' : ''}`}
                    value={displayValue}
                    placeholder={col.placeholder}
                    onChange={e => onChange(col.key, e.target.value)}
                    onKeyDown={e => e.stopPropagation()}
                  />
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {isRecording && activeField && (
        <div className="vct-status">
          <span className="vct-status-dot" />
          Listening for <strong>{activeField.replace('meas_', '').replace('seoTitle', 'title')}</strong> value — say value then <strong>.</strong>
        </div>
      )}
      {isRecording && !activeField && (
        <div className="vct-status vct-status--idle">
          <span className="vct-status-dot vct-status-dot--idle" />
          Say a field name to activate its column (e.g. <em>"brand"</em>, <em>"color"</em>…)
        </div>
      )}
    </div>
  );
};

export default VoiceCommandTable;
