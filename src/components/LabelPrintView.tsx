import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Printer, QrCode, CheckSquare, Square, Loader2, AlertTriangle } from 'lucide-react';
import { useStoreItemArray } from '../lib/workflowStore';
import { buildGroupArray } from '../lib/grouping';
import { code128Svg } from '../lib/barcode';
import {
  ensureSkus, fetchLabelsForProducts, labelSwatch,
  type ListingLabel, type LabelsByProduct,
} from '../lib/labelsService';
import { baseSize } from '../lib/csvExport';
import { LABEL_TEMPLATES } from '../lib/labelTemplates';
import './LabelPrintView.css';

/**
 * LabelPrintView — printable shelf labels for the batch that is open.
 *
 * WHAT IT IS FOR: the physical half of the workflow. A garment on a rack needs
 * a tag that says what it is, what it costs, which vendor it came from and
 * which drop it belongs to — and a barcode so the phone can find the listing
 * again without anyone typing a UUID.
 *
 * READ-ONLY ON THE WORKFLOW. It consumes workflowStore's processedItems through
 * the same hook Step 3 uses, but never writes an item back (CLAUDE.md §18.11) —
 * the one mutation it performs is `ensureSkus`, which writes `products.sku`
 * directly and touches no in-memory item. So printing labels can never disturb
 * a batch mid-edit.
 *
 * THE TEMPLATES are real stationery, and each is described by physical
 * dimensions only (LABEL_TEMPLATES). The print stylesheet drives `@page` from
 * the selected template, so what comes out of the printer lines up with the
 * sheet in the tray rather than with a screen-pixel guess.
 */

/** One printable listing, derived from a Step-3 display group. */
interface LabelRow {
  /** The group's leader id — the `products` row the SKU and labels hang off. */
  productId: string;
  title: string;
  size: string;
  price: string;
  sku: string;
  photos: number;
}

/** Keep a title on the label instead of letting it reflow the whole grid. */
function truncate(s: string, max: number): string {
  const t = (s ?? '').trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

export interface LabelPrintViewProps {
  /** Optional: jump to a listing in Step 3. Supplied by App; without it the
   *  view is purely a printer. */
  onOpenListing?: (productId: string) => void;
}

export default function LabelPrintView({ onOpenListing }: LabelPrintViewProps) {
  // Read-only view of the same list Step 3 edits. Never written back.
  const [processedItems] = useStoreItemArray('processedItems');
  const [templateId, setTemplateId] = useState<string>(LABEL_TEMPLATES[0].id);
  /* DESELECTION, not selection. The default is "print the whole batch", and
     storing that as a set of ids needs an effect to re-seed it whenever the
     batch changes — the cascading-render pattern react-hooks warns about, and
     one that silently drops listings arriving after the first render. Tracking
     the EXCLUSIONS makes "everything" the empty set, so the selection is
     derived from `rows` on every render and is always complete. */
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [labelsBy, setLabelsBy] = useState<LabelsByProduct>({});
  const [skus, setSkus] = useState<Record<string, string>>({});
  const [assigning, setAssigning] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [labelsUnavailable, setLabelsUnavailable] = useState(false);

  const template = LABEL_TEMPLATES.find(t => t.id === templateId) ?? LABEL_TEMPLATES[0];

  /* One row per LISTING, not per photo. buildGroupArray is the same builder
     Step 3 navigates with (leader-convention tolerant, §11), so a label sheet
     and the description screen can never disagree about what a listing is. */
  const rows: LabelRow[] = useMemo(() => {
    return buildGroupArray(processedItems).map(group => {
      // Coalesce across the group the way the CSV exporter does: the field
      // belongs to the LISTING, not to whichever photo happens to be first.
      const pick = <K extends keyof (typeof group)[number]>(key: K): string => {
        for (const item of group) {
          const v = item[key];
          if (v !== undefined && v !== null && String(v).trim() !== '') return String(v);
        }
        return '';
      };
      const leader = group.find(i => i.productGroup === i.id) ?? group[0];
      const rawPrice = pick('price');
      const priceNum = parseFloat(rawPrice);
      return {
        productId: leader.id,
        title: pick('seoTitle') || pick('brand') || pick('originalName') || 'Untitled listing',
        size: baseSize(pick('size')),
        price: Number.isFinite(priceNum) && priceNum > 0 ? `$${priceNum.toFixed(2)}` : '',
        sku: pick('sku'),
        photos: group.length,
      };
    });
  }, [processedItems]);

  const rowKey = rows.map(r => r.productId).join(',');

  /* Bumped by an event handler to re-read labels after SKUs are assigned —
     one loader, one dependency list, no second copy of the fetch. */
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    // `rowKey` (not the rows array) is the dependency: the array is rebuilt on
    // every store change, but the SET of listings rarely moves, and re-fetching
    // labels on each keystroke in another tab would be a request per character.
    let cancelled = false;
    (async () => {
      // fetchLabelsForProducts short-circuits an empty list itself, so there is
      // no synchronous branch here: every setState below follows the await.
      const res = await fetchLabelsForProducts(rowKey ? rowKey.split(',') : []);
      if (cancelled) return;
      if (res.status === 'unavailable') { setLabelsUnavailable(true); return; }
      setLabelsUnavailable(false);
      setLabelsBy(res.byProduct);
    })();
    return () => { cancelled = true; };
  }, [rowKey, reloadKey]);

  const isSelected = (id: string) => !excluded.has(id);

  const toggle = (id: string) => setExcluded(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const allSelected = rows.length > 0 && rows.every(r => isSelected(r.productId));
  const toggleAll = () =>
    setExcluded(allSelected ? new Set(rows.map(r => r.productId)) : new Set());

  /** The rows that will actually print, in list order. */
  const printable = rows.filter(r => isSelected(r.productId));
  const skuFor = (r: LabelRow) => skus[r.productId] || r.sku;
  const missingSku = printable.filter(r => !skuFor(r)).length;

  const handleAssignSkus = async () => {
    const need = printable.filter(r => !skuFor(r)).map(r => r.productId);
    if (need.length === 0 || assigning) return;
    setAssigning(true);
    setNotice(null);
    const res = await ensureSkus(need);
    if (res.status === 'ok') {
      // Held in local state rather than written back into the workflow store:
      // this view is read-only on the batch by design, and the value is
      // already durable in `products`.
      setSkus(prev => ({ ...prev, ...res.skus }));
      setNotice(`Assigned ${Object.keys(res.skus).length} SKU${Object.keys(res.skus).length === 1 ? '' : 's'}.`);
      setReloadKey(k => k + 1);
    } else if (res.status === 'unavailable') {
      setNotice('The labels migration has not been run yet, so SKUs cannot be assigned.');
    } else {
      setNotice(res.error);
    }
    setAssigning(false);
  };

  if (rows.length === 0) {
    return (
      <div className="lpv-empty">
        <QrCode size={28} aria-hidden="true" />
        <p>No listings in the open batch yet.</p>
        <p className="lpv-empty-sub">
          Group and categorize photos in Step 2, and they will appear here ready to label.
        </p>
      </div>
    );
  }

  return (
    <div className="lpv" style={{
      // The template's geometry drives both the on-screen sheet preview and the
      // @page rule, from one source, via custom properties.
      '--lpv-page-w': template.page.width,
      '--lpv-page-h': template.page.height,
      '--lpv-page-m': template.page.margin,
      '--lpv-label-w': template.label.width,
      '--lpv-label-h': template.label.height,
      '--lpv-cols': String(template.columns),
      '--lpv-gap-x': template.gap.x,
      '--lpv-gap-y': template.gap.y,
    } as CSSProperties}>

      {/* ── Controls (screen only) ─────────────────────────────────────── */}
      <div className="lpv-controls">
        <label className="lpv-control">
          <span>Label stock</span>
          <select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
            {LABEL_TEMPLATES.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
        <p className="lpv-template-note">{template.note}</p>

        <div className="lpv-actions">
          <button type="button" className="lpv-btn" onClick={toggleAll}>
            {allSelected ? <Square size={14} /> : <CheckSquare size={14} />}
            {allSelected ? 'Select none' : 'Select all'}
          </button>
          <button
            type="button"
            className="lpv-btn"
            onClick={() => void handleAssignSkus()}
            disabled={assigning || missingSku === 0 || labelsUnavailable}
            title={missingSku === 0 ? 'Every selected listing already has a SKU' : undefined}
          >
            {assigning ? <Loader2 size={14} className="lpv-spin" /> : <QrCode size={14} />}
            Assign SKUs to selected{missingSku > 0 ? ` (${missingSku})` : ''}
          </button>
          <button
            type="button"
            className="lpv-btn lpv-btn--primary"
            onClick={() => window.print()}
            disabled={printable.length === 0}
          >
            <Printer size={14} /> Print {printable.length} label{printable.length === 1 ? '' : 's'}
          </button>
        </div>

        {missingSku > 0 && (
          <p className="lpv-warn">
            <AlertTriangle size={13} aria-hidden="true" />
            {missingSku} selected listing{missingSku === 1 ? '' : 's'} {missingSku === 1 ? 'has' : 'have'} no SKU —
            {' '}those labels print without a barcode. Assign SKUs first to make them scannable.
          </p>
        )}
        {labelsUnavailable && (
          <p className="lpv-warn">
            <AlertTriangle size={13} aria-hidden="true" />
            Labels and SKUs need the <code>listing_labels</code> migration. Titles and prices still print.
          </p>
        )}
        {notice && <p className="lpv-notice" role="status">{notice}</p>}
      </div>

      {/* ── Pick list (screen only) ────────────────────────────────────── */}
      <ul className="lpv-picklist">
        {rows.map(r => {
          const on = isSelected(r.productId);
          const sku = skuFor(r);
          return (
            <li key={r.productId} className={`lpv-pick${on ? ' lpv-pick--on' : ''}`}>
              <label className="lpv-pick-main">
                <input type="checkbox" checked={on} onChange={() => toggle(r.productId)} />
                <span className="lpv-pick-title">{truncate(r.title, 70)}</span>
              </label>
              <span className="lpv-pick-meta">
                {r.size && <span className="lpv-pill">{r.size}</span>}
                {r.price && <span className="lpv-pill lpv-pill--price">{r.price}</span>}
                {r.photos > 1 && <span className="lpv-pill">{r.photos} photos</span>}
                <span className={`lpv-pill${sku ? ' lpv-pill--sku' : ' lpv-pill--muted'}`}>
                  {sku || 'no SKU'}
                </span>
                {(labelsBy[r.productId] ?? []).map((l: ListingLabel) => {
                  const sw = labelSwatch(l.color);
                  return (
                    <span key={l.id} className="lpv-pill" style={{ background: sw.bg, color: sw.fg }}>
                      {l.name}
                    </span>
                  );
                })}
              </span>
              {onOpenListing && (
                <button
                  type="button"
                  className="lpv-pick-open"
                  onClick={() => onOpenListing(r.productId)}
                >
                  Open
                </button>
              )}
            </li>
          );
        })}
      </ul>

      {/* ── The sheet. On screen it is a preview; at print time this is the
             ONLY thing on the page (see the @media print block). ────────── */}
      <div className="lpv-sheet-wrap">
        <h2 className="lpv-sheet-heading">Sheet preview</h2>
        <div className="lpv-sheet">
          {printable.map(r => {
            const sku = skuFor(r);
            const labels = labelsBy[r.productId] ?? [];
            return (
              <div className="lpv-label" key={r.productId}>
                <div className="lpv-label-title">{truncate(r.title, 58)}</div>
                <div className="lpv-label-meta">
                  {r.size && <span className="lpv-label-size">{r.size}</span>}
                  {r.price && <span className="lpv-label-price">{r.price}</span>}
                </div>
                {labels.length > 0 && (
                  <div className="lpv-label-chips">
                    {labels.map(l => {
                      const sw = labelSwatch(l.color);
                      return (
                        <span
                          key={l.id}
                          className="lpv-label-chip"
                          /* Inline because it is DATA and because a printed
                             chip cannot resolve a theme token. */
                          style={{ background: sw.bg, color: sw.fg }}
                        >
                          {l.name}
                        </span>
                      );
                    })}
                  </div>
                )}
                <div className="lpv-label-code">
                  {sku ? (
                    <span
                      className="lpv-barcode"
                      /* The SVG is generated by our own encoder from a SKU we
                         minted — never user HTML. */
                      dangerouslySetInnerHTML={{
                        __html: code128Svg(sku, {
                          moduleWidth: template.moduleWidth,
                          height: template.barHeight,
                          quietZone: 10,
                          showText: true,
                          fontSize: 9,
                        }),
                      }}
                    />
                  ) : (
                    <span className="lpv-nosku">no SKU</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
