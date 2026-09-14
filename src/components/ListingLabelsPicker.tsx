import { useCallback, useEffect, useState } from 'react';
import { Tag, Plus, X, Check, Loader2 } from 'lucide-react';
import {
  fetchLabels, fetchLabelsForProducts, createLabel, assignLabel, unassignLabel,
  LABEL_COLORS, LABEL_NAME_MAX, labelSwatch, sortLabels,
  type ListingLabel, type LabelKind, type LabelsByProduct,
} from '../lib/labelsService';
import './ListingLabelsPicker.css';

/** label id → how many of `ids` carry it. A label is "on" for the listing only
 *  when every one of its photos has it; anything between is `partial`. */
function countByLabel(ids: readonly string[], byProduct: LabelsByProduct): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const id of ids) {
    for (const l of byProduct[id] ?? []) counts[l.id] = (counts[l.id] ?? 0) + 1;
  }
  return counts;
}

export interface ListingLabelsPickerProps {
  /** The product ids this picker applies to. In Step 3 that is every item in
   *  the current group — one listing, several photos — so a label applied here
   *  sticks to the listing however its photos are later regrouped. */
  productIds: string[];
  /** Compact chips only, no "new label" form (used inside the print sheet). */
  readOnly?: boolean;
  /** Fired after any assign/unassign so a parent can refresh its own copy. */
  onChanged?: () => void;
}

/**
 * ListingLabelsPicker — the colour/word/vendor labels on one listing.
 *
 * WHAT A LABEL IS FOR: the founder's shop sorts physical garments by things the
 * Shopify fields cannot hold — which vendor a piece came from, which drop it
 * belongs to ("bad kids club"), whether it still needs a repair. Those live
 * beside the listing, get printed on its label, and are scanned back later.
 *
 * MIXED SELECTIONS ARE FIRST-CLASS. A group's photos are separate `products`
 * rows, so a label can genuinely be on some and not others (a regroup, a
 * partially-failed write). A chip therefore has THREE states — on, off, and
 * partial — and tapping a partial chip applies it to the rest rather than
 * clearing it, which is the only non-destructive reading of that tap.
 *
 * Pre-migration this renders nothing at all (fetchLabels → 'unavailable'), in
 * the house style: code ships before the SQL is run.
 */
export default function ListingLabelsPicker({ productIds, readOnly, onChanged }: ListingLabelsPickerProps) {
  const [available, setAvailable] = useState<ListingLabel[] | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState(LABEL_COLORS[0].name);
  const [newKind, setNewKind] = useState<LabelKind>('custom');

  // A stable dependency: the array identity changes every render in Step 3, but
  // the SET of ids rarely does, and re-fetching on every keystroke there would
  // be a request per character typed into the description.
  const idKey = productIds.join(',');

  const reloadAssignments = useCallback(async (ids: string[]) => {
    const res = await fetchLabelsForProducts(ids);
    if (res.status !== 'ok') return;
    setCounts(countByLabel(ids, res.byProduct));
  }, []);

  useEffect(() => {
    let cancelled = false;
    const ids = idKey ? idKey.split(',') : [];
    (async () => {
      const res = await fetchLabels();
      if (cancelled) return;
      if (res.status === 'unavailable') { setUnavailable(true); return; }
      setAvailable(res.labels);
      // fetchLabelsForProducts short-circuits an empty list, so this is safe to
      // call unconditionally — and every setState here follows an await, which
      // is what keeps the effect off the cascading-render path.
      const byProduct = await fetchLabelsForProducts(ids);
      if (cancelled || byProduct.status !== 'ok') return;
      setCounts(countByLabel(ids, byProduct.byProduct));
    })();
    return () => { cancelled = true; };
  }, [idKey]);

  const ids = idKey ? idKey.split(',') : [];
  const total = ids.length;

  const toggle = async (label: ListingLabel) => {
    if (readOnly || busyId || total === 0) return;
    const on = counts[label.id] ?? 0;
    setBusyId(label.id);
    setError(null);
    // Fully applied → remove. Not applied OR partially applied → apply to all.
    // "Partial means finish the job" is the only reading that cannot destroy a
    // label the user already put on some of these photos by accident.
    const res = on === total
      ? await unassignLabel(ids, label.id)
      : await assignLabel(ids, label.id);
    if (!res.ok) setError(res.error ?? 'Could not update that label.');
    else await reloadAssignments(ids);
    setBusyId(null);
  };

  const submitNew = async () => {
    const name = newName.trim();
    if (!name || busyId) return;
    setBusyId('new');
    setError(null);
    const res = await createLabel(name, newColor, newKind);
    if (!res.ok) {
      setError(res.error);
    } else {
      setAvailable(prev => sortLabels([...(prev ?? []), res.label]));
      setNewName('');
      setAdding(false);
      if (total) {
        // A label made from inside a listing is meant for that listing.
        const assigned = await assignLabel(ids, res.label.id);
        if (assigned.ok) await reloadAssignments(ids);
      }
    }
    setBusyId(null);
    onChanged?.();
  };

  // Pre-migration, or a workspace with no labels and no way to add one here.
  if (unavailable) return null;
  if (readOnly && (!available || available.length === 0)) return null;

  return (
    <div className="llp">
      <div className="llp-head">
        <Tag size={13} aria-hidden="true" />
        <span className="llp-title">Labels</span>
        {!readOnly && total > 1 && (
          <span className="llp-scope">{total} photos in this listing</span>
        )}
      </div>

      <div className="llp-chips" role="group" aria-label="Listing labels">
        {(available ?? []).map(label => {
          const on = counts[label.id] ?? 0;
          const state = on === 0 ? 'off' : on === total && total > 0 ? 'on' : 'partial';
          const swatch = labelSwatch(label.color);
          return (
            <button
              key={label.id}
              type="button"
              className={`llp-chip llp-chip--${state}${readOnly ? ' llp-chip--static' : ''}`}
              // A colour swatch is data, not chrome — it is the one place in
              // this app where an inline colour is correct (CLAUDE.md §1's
              // carve-out for data colours), and it must survive printing.
              style={state === 'off' ? undefined : { background: swatch.bg, color: swatch.fg, borderColor: swatch.bg }}
              onClick={() => toggle(label)}
              disabled={readOnly || busyId !== null}
              aria-pressed={readOnly ? undefined : state === 'on'}
              title={label.kind === 'vendor' ? `Vendor: ${label.name}` : label.name}
            >
              <span className="llp-dot" style={{ background: swatch.bg }} aria-hidden="true" />
              {label.name}
              {label.kind === 'vendor' && <span className="llp-kind">vendor</span>}
              {state === 'partial' && <span className="llp-partial">{on}/{total}</span>}
              {busyId === label.id && <Loader2 size={11} className="llp-spin" aria-hidden="true" />}
              {state === 'on' && !readOnly && <Check size={11} aria-hidden="true" />}
            </button>
          );
        })}

        {!readOnly && !adding && (
          <button type="button" className="llp-chip llp-chip--add" onClick={() => setAdding(true)}>
            <Plus size={12} aria-hidden="true" /> New label
          </button>
        )}
      </div>

      {!readOnly && adding && (
        <div className="llp-new">
          <input
            className="llp-new-name"
            value={newName}
            maxLength={LABEL_NAME_MAX}
            placeholder="Label name (e.g. bad kids club)"
            autoFocus
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); void submitNew(); }
              if (e.key === 'Escape') { e.preventDefault(); setAdding(false); setNewName(''); }
            }}
          />
          <div className="llp-new-colors" role="radiogroup" aria-label="Label colour">
            {LABEL_COLORS.map(c => (
              <button
                key={c.name}
                type="button"
                role="radio"
                aria-checked={newColor === c.name}
                aria-label={c.label}
                title={c.label}
                className={`llp-swatch${newColor === c.name ? ' llp-swatch--on' : ''}`}
                style={{ background: c.bg }}
                onClick={() => setNewColor(c.name)}
              />
            ))}
          </div>
          <div className="llp-new-row">
            <label className="llp-new-kind">
              <input
                type="checkbox"
                checked={newKind === 'vendor'}
                onChange={(e) => setNewKind(e.target.checked ? 'vendor' : 'custom')}
              />
              This is a vendor
            </label>
            <div className="llp-new-actions">
              <button
                type="button" className="llp-btn llp-btn--primary"
                onClick={() => void submitNew()} disabled={!newName.trim() || busyId !== null}
              >
                {busyId === 'new' ? 'Adding…' : 'Add label'}
              </button>
              <button
                type="button" className="llp-btn"
                onClick={() => { setAdding(false); setNewName(''); setError(null); }}
              >
                <X size={12} aria-hidden="true" /> Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {error && <p className="llp-error" role="alert">{error}</p>}
    </div>
  );
}
