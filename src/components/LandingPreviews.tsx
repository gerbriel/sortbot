import type { ReactNode } from 'react';
import { Camera, Images, Layers, Check, Shirt, X } from 'lucide-react';
import PhoneStepper from './PhoneStepper';
import { FieldGroup, FieldGrid, FieldCell } from './ui/FieldGrid';
import { RemovableChip } from './ui/Chip';
import { Badge } from './ui/Badge';
import { StatGrid, StatTile } from './ui/StatTile';
import { stackLayers, stackReserve } from '../lib/stackLayout';
/* App stylesheets the previews draw with. Every one of these is already in
 * the main CSS bundle (App imports ImageUpload, ImageGrouper, CategoryZones,
 * ProductDescriptionGenerator, MarketplaceExport and PhoneStepper eagerly),
 * so these imports add no first paint bytes; they are here so the previews
 * still render correctly if App's import graph ever changes. */
import './ImageUpload.css';
import './ImageGrouper.css';
import './CategoryZones.css';
import './KeywordPicker.css';
import './MarketplaceExport.css';

/* ════════════════════════════════════════════════════════════════════════════
   LANDING PREVIEWS: snippets of the real product, not marketing drawings.

   Each preview is the app's own markup and classes (or the real component
   where it is pure: PhoneStepper, FieldGrid, Chip, Badge, StatTile) rendered
   with neutral placeholder tiles instead of photos and fixture values instead
   of a workspace's data. Nothing here calls Supabase.

   Every preview is INERT: the body is `inert` (no focus, no clicks) and
   aria-hidden (decorative), with pointer-events off as a belt for browsers
   without `inert`. The caption under it is real text, so a screen reader
   hears "Step 2, grouping" and skips the mock. Fixture numbers are captioned
   as sample data: they are screenshots, never claims (Landing.tsx COPY RULES).
   ════════════════════════════════════════════════════════════════════════════ */

const noop = () => {};

export function PreviewFrame({ caption, className, children }: {
  caption: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <figure className={['ld-preview', className].filter(Boolean).join(' ')}>
      <div className="ld-preview-body" aria-hidden="true" inert>
        {children}
      </div>
      <figcaption className="ld-preview-caption">{caption}</figcaption>
    </figure>
  );
}

/** A neutral stand in for a garment photo: a token grey tile with a glyph. */
function Placeholder({ tone = 0 }: { tone?: number }) {
  return (
    <span className={`ld-ph ld-ph--${tone % 3}`}>
      <Shirt size={22} strokeWidth={1.5} />
    </span>
  );
}

/* ── Hero: the Step 2 workbench ───────────────────────────────────────────── */

interface PileFixture { id: string; count: number; category?: string; selected?: boolean }

const PILES: PileFixture[] = [
  { id: 'a', count: 4, category: 'tees' },
  { id: 'b', count: 3, category: 'jackets' },
  { id: 'c', count: 5, selected: true },
  { id: 'd', count: 2 },
];

/** One collapsed pile, with the same geometry helper the grouper uses. */
function Pile({ pile, index }: { pile: PileFixture; index: number }) {
  const reserve = stackReserve(pile.count);
  return (
    <div className={`product-group-card${pile.category ? ' has-category' : ''}${pile.selected ? ' all-selected' : ''}`}>
      <div className={`group-header group-select-bar${pile.selected ? ' all-selected' : ''}`}>
        <span className="group-select-check">{pile.selected ? <Check size={13} /> : null}</span>
        <span className="group-badge"><Layers size={11} /> {pile.count}</span>
      </div>
      <div className="group-stack" style={{ paddingRight: `${reserve.right}px`, paddingBottom: `${reserve.bottom}px` }}>
        {stackLayers(pile.count).map(layer => (
          <div
            key={layer.index}
            className={`gs-layer${layer.index === 0 ? ' gs-layer--top' : ' gs-layer--back'}`}
            style={{ transform: `translate(${layer.x}px, ${layer.y}px) rotate(${layer.rotate}deg)`, zIndex: layer.z }}
          >
            {layer.index === 0 && <Placeholder tone={index} />}
          </div>
        ))}
        {pile.category && <span className="category-badge gs-cat">{pile.category}</span>}
      </div>
    </div>
  );
}

const DOCK: { name: string; count: number }[] = [
  { name: 'Tees', count: 4 },
  { name: 'Jackets', count: 3 },
  { name: 'Denim', count: 0 },
  { name: 'Knitwear', count: 0 },
];

/** Eager and light: plain markup on stylesheets the main bundle already has. */
export function WorkbenchPreview() {
  return (
    <PreviewFrame caption="Step 2, grouping and categorizing" className="ld-preview--hero">
      <div className="ld-wb">
        <div className="groups-grid ld-wb-grid">
          {PILES.map((p, i) => <Pile key={p.id} pile={p} index={i} />)}
        </div>
        <div className="category-zones-container compact ld-wb-dock">
          <div className="ld-dock">
            {DOCK.map(c => (
              <div key={c.name} className="category-zone">
                <span className="category-icon"><Shirt size={20} /></span>
                <span className="category-name">{c.name}</span>
                <span className="category-count">({c.count})</span>
              </div>
            ))}
            <div className="category-zone category-zone-clear">
              <span className="category-icon"><X size={20} /></span>
              <span className="category-name">Clear Category</span>
            </div>
          </div>
        </div>
      </div>
    </PreviewFrame>
  );
}

/* ── How it works: one preview per step ──────────────────────────────────── */

/** Step 1: the real drop zone and the two capture buttons (ImageUpload). */
function UploadPreview() {
  return (
    <PreviewFrame caption="Step 1, upload">
      <div className="dropzone ld-dz">
        <div className="dropzone-content">
          <p className="dropzone-title">Drag &amp; drop clothing images here</p>
          <p className="dropzone-subtext">or click to select files</p>
          <div className="ld-dz-actions">
            <span className="dz-action dz-action--primary"><Camera size={18} /> Take photos</span>
            <span className="dz-action"><Images size={18} /> Choose from library</span>
          </div>
        </div>
      </div>
    </PreviewFrame>
  );
}

/** Step 2: the real PhoneStepper, on step 2 with steps 1 to 3 open. */
function StepperPreview() {
  return (
    <PreviewFrame caption="Step 2, the four step stepper" className="ld-preview--stepper">
      <PhoneStepper step={2} reachable={[1, 2, 3]} onSelect={noop} />
    </PreviewFrame>
  );
}

const FIELDS: { label: string; value: string; source: 'Preset' | 'Dictated'; span?: 2 }[] = [
  { label: 'Brand', value: 'Carhartt', source: 'Dictated' },
  { label: 'Size', value: 'L', source: 'Dictated' },
  { label: 'Pit to pit', value: '24 in', source: 'Dictated' },
  { label: 'Weight', value: '1.2 lb', source: 'Preset' },
  { label: 'Flaws', value: 'Small mark on left cuff', source: 'Dictated', span: 2 },
];

/** Step 3: real FieldGrid cells and the keyword chips KeywordPicker renders. */
function DetailsPreview() {
  return (
    <PreviewFrame caption="Step 3, dictated details">
      <FieldGroup caption="Details">
        <FieldGrid columns={2}>
          {FIELDS.map(f => (
            <FieldCell key={f.label} label={f.label} span={f.span} meta={<Badge tone={f.source === 'Preset' ? 'neutral' : 'accent'}>{f.source}</Badge>}>
              {c => <input {...c} readOnly tabIndex={-1} defaultValue={f.value} />}
            </FieldCell>
          ))}
        </FieldGrid>
      </FieldGroup>
      <ul className="kwp-applied ui-chip-group ld-kw">
        {['Workwear', 'Canvas', 'Made in USA'].map(k => (
          <li key={k}>
            <RemovableChip size="sm" removeLabel={`Remove keyword ${k}`} onRemove={noop}>{k}</RemovableChip>
          </li>
        ))}
      </ul>
    </PreviewFrame>
  );
}

const EXPORT_ROWS: { name: string; ready: number; warn?: number }[] = [
  { name: 'Shopify', ready: 12 },
  { name: 'eBay', ready: 11, warn: 1 },
  { name: 'Depop', ready: 12 },
];

/** Step 4: StatTiles and three readiness rows from MarketplaceExport. */
function ExportPreview() {
  return (
    <PreviewFrame caption="Step 4, export (sample data)">
      <StatGrid className="ld-stats-row">
        <StatTile quiet compact label="Listings" value={12} />
        <StatTile quiet compact label="Photos" value={47} />
        <StatTile quiet compact label="Marketplaces" value={3} />
      </StatGrid>
      <div className="mkx-checks ld-mkx">
        {EXPORT_ROWS.map(r => (
          <article className="mkx-check" key={r.name}>
            <header className="mkx-check-head">
              <h4>{r.name}</h4>
              <span className="mkx-counts">
                <span className="mkx-count mkx-count--clean">{r.ready} ready</span>
                {r.warn ? <span className="mkx-count mkx-count--warn">{r.warn} with warnings</span> : null}
              </span>
            </header>
          </article>
        ))}
      </div>
    </PreviewFrame>
  );
}

const STEP_PREVIEWS = [UploadPreview, StepperPreview, DetailsPreview, ExportPreview];

/** The preview for How it works step `index` (0 based, in STEPS order). */
export function StepPreview({ index }: { index: number }) {
  const Preview = STEP_PREVIEWS[index];
  return Preview ? <Preview /> : null;
}
