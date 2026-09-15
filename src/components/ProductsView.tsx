import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  Search, Loader2, AlertTriangle, PackageSearch, QrCode, Printer, Tag,
  ArrowUpRight, Save, RefreshCw, Check, Pencil, X,
} from 'lucide-react';
import type { ClothingItem } from '../App';
import {
  searchProducts, fetchListing, fetchBatchNames, clearBatchNameCache,
  type ProductListing,
} from '../lib/productSearchService';
import {
  fetchLabels, fetchLabelsForProducts, countLabelUsage, updateLabel, deleteLabel,
  ensureSkus, setProductCodes, labelSwatch, sortLabels,
  LABEL_COLORS, LABEL_NAME_MAX,
  type ListingLabel, type LabelKind,
} from '../lib/labelsService';
import { syncGroupFieldsToDatabase } from '../lib/productService';
import { saveStatus } from '../lib/saveStatusStore';
import { code128Svg } from '../lib/barcode';
import { LABEL_TEMPLATES } from '../lib/labelTemplates';
import { baseSize } from '../lib/csvExport';
import { ConfirmAction } from './ui';
import ListingLabelsPicker from './ListingLabelsPicker';
import './ProductsView.css';

/**
 * ProductsView — find ONE listing, anywhere in the workspace, and work on it.
 *
 * WHY: every other surface in this app is batch-shaped. Step 3 pages through
 * the open batch, Labels prints the open batch, the Library opens batches. A
 * reseller looking for "that Carhartt jacket" has a garment in their hand and a
 * name in their head, and until now the only way to reach it was to remember
 * which batch it was photographed in. This is the search that does not care.
 *
 * WHAT IT OWNS, deliberately narrow:
 *   · search + filters over `products` (one read, RLS-scoped — §18 #1)
 *   · the seven fields a listing is usually corrected on, saved through the SAME
 *     `syncGroupFieldsToDatabase` Step 3 uses, so the leader row and every
 *     member row carry the value (§11 write-key-must-match-read-key)
 *   · SKU + barcode, with the 23505 shown in words
 *   · the labels on this listing, and the workspace's label vocabulary
 *   · a one-label print sheet, and a way back into the workflow
 *
 * WHAT IT DOES NOT OWN: the workflow store. It never writes an item — it writes
 * the DATABASE and then TELLS App, via `onListingEdited`, so App can mirror the
 * change into the open batch's store arrays. Reaching into the store from here
 * would be a second writer racing Step 3's two debounced saves.
 */

/** The fields this view edits. Everything else about a listing stays in Step 3. */
interface Draft {
  title: string;
  brand: string;
  size: string;
  color: string;
  price: string;
  condition: string;
  category: string;
}

const CONDITIONS = ['New', 'NWT', 'Excellent', 'Good', 'Used', 'Fair'] as const;

const emptyDraft: Draft = { title: '', brand: '', size: '', color: '', price: '', condition: '', category: '' };

function draftFrom(l: ProductListing): Draft {
  return {
    title: l.title,
    brand: l.brand,
    size: l.size,
    color: l.color,
    price: l.price == null ? '' : String(l.price),
    condition: l.condition,
    category: l.category,
  };
}

/** Listing id → the labels on it, unioned across its photos. */
function unionLabels(memberIds: readonly string[], byProduct: Record<string, ListingLabel[]>): ListingLabel[] {
  const seen = new Map<string, ListingLabel>();
  for (const id of memberIds) for (const l of byProduct[id] ?? []) seen.set(l.id, l);
  return sortLabels([...seen.values()]);
}

export interface ProductsViewProps {
  userId: string;
  /** The batch currently open in the workflow, so a row can say "open here". */
  currentBatchId: string | null;
  /**
   * Take this listing into Step 3. App decides whether that means focusing the
   * open batch or opening the listing's own batch first — this view only knows
   * which batch the listing is in.
   */
  onOpenInWorkflow: (productId: string, batchId: string | null) => void;
  /** A save landed; mirror it into the workflow store if this batch is open. */
  onListingEdited: (batchId: string | null, groupId: string, patch: Partial<ClothingItem>) => void;
}

export default function ProductsView({
  userId, currentBatchId, onOpenInWorkflow, onListingEdited,
}: ProductsViewProps) {
  // ── search ────────────────────────────────────────────────────────────────
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [listings, setListings] = useState<ProductListing[]>([]);
  const [truncated, setTruncated] = useState(false);
  /* "Is a search in flight?" is DERIVED, not stored: `loadedKey` records which
     (query, reload) pair the rows on screen belong to, so `searching` falls out
     of a comparison. Storing it would mean a setState in the effect body, i.e.
     the cascading render react-hooks/set-state-in-effect exists to stop — and
     the derived form cannot get stuck "searching" if an await throws. */
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [labelsByProduct, setLabelsByProduct] = useState<Record<string, ListingLabel[]>>({});
  const [batchNames, setBatchNames] = useState<Map<string, string>>(new Map());
  const [reloadKey, setReloadKey] = useState(0);

  // ── filters ───────────────────────────────────────────────────────────────
  const [skuFilter, setSkuFilter] = useState<'all' | 'with' | 'without'>('all');
  const [labelFilter, setLabelFilter] = useState<string | null>(null);
  const [vocabulary, setVocabulary] = useState<ListingLabel[]>([]);
  const [labelsUnavailable, setLabelsUnavailable] = useState(false);

  // ── detail ────────────────────────────────────────────────────────────────
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ProductListing | null>(null);
  /** Same derivation as `searching`, for the detail read. */
  const [detailLoadedId, setDetailLoadedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null);

  const [skuDraft, setSkuDraft] = useState('');
  const [barcodeDraft, setBarcodeDraft] = useState('');
  const [codeBusy, setCodeBusy] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [templateId, setTemplateId] = useState(LABEL_TEMPLATES[0].id);

  /** Bumped whenever the label vocabulary or an assignment changes, so the
   *  picker (which keys its fetch on the id list) is remounted and re-reads. */
  const [labelsRev, setLabelsRev] = useState(0);
  const [manageOpen, setManageOpen] = useState(false);

  const detailRef = useRef<HTMLDivElement>(null);

  // ── debounce ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(query), 250);
    return () => window.clearTimeout(t);
  }, [query]);

  // ── the search itself ─────────────────────────────────────────────────────
  const wantKey = `${debounced}::${reloadKey}`;
  const searching = loadedKey !== wantKey;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await searchProducts(debounced);
      if (cancelled) return;
      if (res.status !== 'ok') {
        setSearchError(res.error);
        setListings([]);
        setLoadedKey(wantKey);
        return;
      }
      setSearchError(null);
      setListings(res.listings);
      setTruncated(res.truncated);
      setLoadedKey(wantKey);

      // Labels for what is on screen. One chunked read per search, not per row.
      const ids = res.listings.flatMap(l => l.memberIds);
      const labelRes = await fetchLabelsForProducts(ids);
      if (cancelled) return;
      setLabelsByProduct(labelRes.status === 'ok' ? labelRes.byProduct : {});

      const names = await fetchBatchNames();
      if (!cancelled) setBatchNames(names);
    })();
    return () => { cancelled = true; };
  }, [debounced, reloadKey, wantKey]);

  // ── the label vocabulary (for the filter chips and the manager) ───────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetchLabels();
      if (cancelled) return;
      if (res.status === 'unavailable') { setLabelsUnavailable(true); setVocabulary([]); return; }
      setLabelsUnavailable(false);
      setVocabulary(res.labels);
    })();
    return () => { cancelled = true; };
  }, [labelsRev]);

  // ── the open listing ──────────────────────────────────────────────────────
  const detailBusy = !!selectedId && detailLoadedId !== selectedId;

  useEffect(() => {
    // Nothing selected is the initial state, not a transition — `detail` starts
    // null and only `openDetail` ever sets it, so there is nothing to clear.
    if (!selectedId) return;
    let cancelled = false;
    (async () => {
      const res = await fetchListing(selectedId);
      if (cancelled) return;
      setDetailLoadedId(selectedId);
      if (res.status !== 'ok') {
        setDetail(null);
        setNotice({ tone: 'warn', text: res.status === 'not_found' ? 'That listing is no longer in the workspace.' : res.error });
        return;
      }
      setDetail(res.listing);
      setDraft(draftFrom(res.listing));
      setSkuDraft(res.listing.sku);
      setBarcodeDraft(res.listing.barcode);
      setCodeError(null);
      setNotice(null);
    })();
    return () => { cancelled = true; };
  }, [selectedId, reloadKey]);

  const rows = useMemo(() => listings.filter(l => {
    if (skuFilter === 'with' && !l.sku) return false;
    if (skuFilter === 'without' && l.sku) return false;
    if (labelFilter && !unionLabels(l.memberIds, labelsByProduct).some(x => x.id === labelFilter)) return false;
    return true;
  }), [listings, skuFilter, labelFilter, labelsByProduct]);

  /* The picker keys its fetch on the JOINED id string, so a fresh array every
     render would re-read every label on every keystroke in this view (§18 #24's
     reasoning, applied to a fetch rather than a memo). */
  const detailIdKey = detail ? detail.memberIds.join(',') : '';
  const detailIds = useMemo(() => (detailIdKey ? detailIdKey.split(',') : []), [detailIdKey]);

  const template = LABEL_TEMPLATES.find(t => t.id === templateId) ?? LABEL_TEMPLATES[0];

  const openDetail = (listing: ProductListing) => {
    setSelectedId(listing.id);
    // Seed from the row we already have, so the panel paints before the read.
    setDetail(listing);
    setDraft(draftFrom(listing));
    setSkuDraft(listing.sku);
    setBarcodeDraft(listing.barcode);
    setNotice(null);
    setCodeError(null);
    // On a phone the panel is below the list; without this the tap looks inert.
    requestAnimationFrame(() => detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  /** Merge a saved patch into the row list without re-reading the world. */
  const applyLocalPatch = useCallback((groupId: string, next: Partial<ProductListing>) => {
    setListings(prev => prev.map(l => (l.groupId === groupId ? { ...l, ...next } : l)));
    setDetail(prev => (prev && prev.groupId === groupId ? { ...prev, ...next } : prev));
  }, []);

  // ── save the seven fields ─────────────────────────────────────────────────
  const handleSave = async () => {
    if (!detail || saving) return;
    setSaving(true);
    setNotice(null);

    const priceText = draft.price.trim();
    const priceNum = priceText === '' ? null : Number(priceText);
    if (priceNum !== null && (!Number.isFinite(priceNum) || priceNum < 0)) {
      setNotice({ tone: 'warn', text: 'Price must be a number, or empty for "not priced yet".' });
      setSaving(false);
      return;
    }

    const patch: Partial<ClothingItem> = {
      seoTitle: draft.title.trim(),
      brand: draft.brand.trim(),
      size: draft.size.trim(),
      color: draft.color.trim(),
      category: draft.category.trim(),
      condition: (draft.condition || undefined) as ClothingItem['condition'],
    };
    /* `null` on purpose, never 0: the export gate reads a 0 price as "priced at
       nothing" and blocks the whole CSV, and the restore merge would read that 0
       straight back (productService finding 20). Not expressible in
       Partial<ClothingItem>, which is why this one field is assigned through the
       record view. */
    (patch as Record<string, unknown>).price = priceNum;

    // syncGroupFieldsToDatabase wants ClothingItems; it reads only `id`,
    // `productGroup` and the patched fields, so minimal stand-ins write exactly
    // this patch and nothing else. The leader is found the same way it is in
    // Step 3 — by `id === productGroup`.
    const groupItems = detail.memberIds.map(id => ({
      id, productGroup: detail.groupId, ...patch,
    })) as ClothingItem[];

    saveStatus.begin();
    let ok = false;
    try {
      ok = await syncGroupFieldsToDatabase(groupItems, detail.batchId, userId);
    } catch (err) {
      saveStatus.end(false, err instanceof Error ? err.message : 'Save failed');
      setNotice({ tone: 'warn', text: 'Save failed — nothing was written.' });
      setSaving(false);
      return;
    }
    saveStatus.end(ok, ok ? undefined : 'Could not save this listing');

    if (ok) {
      applyLocalPatch(detail.groupId, {
        title: patch.seoTitle ?? '', brand: patch.brand ?? '', size: patch.size ?? '',
        color: patch.color ?? '', category: patch.category ?? '',
        condition: patch.condition ?? '', price: priceNum,
      });
      onListingEdited(detail.batchId, detail.groupId, patch);
      setNotice({ tone: 'ok', text: 'Saved.' });
    } else {
      setNotice({ tone: 'warn', text: 'Could not save — the listing may belong to a workspace you cannot write to.' });
    }
    setSaving(false);
  };

  // ── SKU / barcode ─────────────────────────────────────────────────────────
  const handleGenerateSku = async () => {
    if (!detail || codeBusy) return;
    setCodeBusy(true);
    setCodeError(null);
    const res = await ensureSkus([detail.id]);
    if (res.status === 'ok') {
      const sku = res.skus[detail.id] ?? '';
      setSkuDraft(sku);
      setBarcodeDraft(prev => prev || sku);
      applyLocalPatch(detail.groupId, { sku, barcode: detail.barcode || sku });
    } else if (res.status === 'unavailable') {
      setCodeError('SKUs need the listing_labels migration to be run first.');
    } else {
      setCodeError(res.error);
    }
    setCodeBusy(false);
  };

  const handleSaveCodes = async () => {
    if (!detail || codeBusy) return;
    setCodeBusy(true);
    setCodeError(null);
    const res = await setProductCodes(detail.id, { sku: skuDraft, barcode: barcodeDraft });
    if (res.ok) {
      applyLocalPatch(detail.groupId, { sku: skuDraft.trim(), barcode: barcodeDraft.trim() });
      setNotice({ tone: 'ok', text: 'Codes saved.' });
    } else {
      setCodeError(res.error);
    }
    setCodeBusy(false);
  };

  const codesDirty = !!detail && (skuDraft.trim() !== detail.sku || barcodeDraft.trim() !== detail.barcode);

  const batchNameFor = (id: string | null) => (id ? batchNames.get(id) ?? 'Batch' : null);

  // ── render ────────────────────────────────────────────────────────────────
  return (
    <div className="pv">
      {/* ── Finder ─────────────────────────────────────────────────────── */}
      <section className="pv-list" aria-label="Listings">
        <div className="pv-search">
          <Search size={15} aria-hidden="true" className="pv-search-icon" />
          <input
            className="pv-search-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search title, SKU, barcode, brand or category"
            aria-label="Search listings"
            autoComplete="off"
            spellCheck={false}
          />
          {query && (
            <button type="button" className="pv-search-clear" onClick={() => setQuery('')} aria-label="Clear search">
              <X size={13} />
            </button>
          )}
          <button
            type="button"
            className="pv-icon-btn"
            title="Refresh"
            aria-label="Refresh results"
            onClick={() => { clearBatchNameCache(); setReloadKey(k => k + 1); }}
          >
            <RefreshCw size={14} />
          </button>
        </div>

        <div className="pv-filters" role="group" aria-label="Filters">
          {(['all', 'with', 'without'] as const).map(mode => (
            <button
              key={mode}
              type="button"
              className={`pv-chip${skuFilter === mode ? ' pv-chip--on' : ''}`}
              aria-pressed={skuFilter === mode}
              onClick={() => setSkuFilter(mode)}
            >
              {mode === 'all' ? 'All' : mode === 'with' ? 'With SKU' : 'Without SKU'}
            </button>
          ))}
          {vocabulary.length > 0 && <span className="pv-filter-sep" aria-hidden="true" />}
          {vocabulary.map(l => {
            const sw = labelSwatch(l.color);
            const on = labelFilter === l.id;
            return (
              <button
                key={l.id}
                type="button"
                className={`pv-chip${on ? ' pv-chip--on' : ''}`}
                aria-pressed={on}
                style={on ? { background: sw.bg, color: sw.fg, borderColor: sw.bg } : undefined}
                onClick={() => setLabelFilter(on ? null : l.id)}
              >
                <span className="pv-dot" style={{ background: sw.bg }} aria-hidden="true" />
                {l.name}
              </button>
            );
          })}
        </div>

        <p className="pv-count" role="status">
          {searching
            ? <><Loader2 size={12} className="pv-spin" aria-hidden="true" /> Searching…</>
            : `${rows.length} listing${rows.length === 1 ? '' : 's'}`}
        </p>
        {/* Its own line, not a trailing clause: at phone width the clause wrapped
            and left a dangling separator reading as a bullet. */}
        {!searching && truncated && (
          <p className="pv-count-note">
            Showing the most recent matches only — narrow the search to see more.
          </p>
        )}

        {searchError && (
          <p className="pv-warn" role="alert"><AlertTriangle size={13} aria-hidden="true" /> {searchError}</p>
        )}

        {!searching && rows.length === 0 && !searchError && (
          <div className="pv-empty">
            <PackageSearch size={26} aria-hidden="true" />
            <p>{debounced ? `Nothing matches “${debounced}”.` : 'No listings in this workspace yet.'}</p>
            <p className="pv-empty-sub">
              Listings appear here once photos are grouped and categorized in Step 2.
            </p>
          </div>
        )}

        <ul className="pv-rows">
          {rows.map(l => {
            const labels = unionLabels(l.memberIds, labelsByProduct);
            const selected = detail?.groupId === l.groupId;
            return (
              <li key={l.groupId}>
                <button
                  type="button"
                  className={`pv-row${selected ? ' pv-row--on' : ''}`}
                  onClick={() => openDetail(l)}
                  aria-current={selected ? 'true' : undefined}
                >
                  <span className="pv-thumb">
                    {l.photos[0]
                      ? <img src={l.photos[0]} alt="" loading="lazy" decoding="async" />
                      : <PackageSearch size={18} aria-hidden="true" />}
                    {l.photos.length > 1 && <span className="pv-thumb-count">{l.photos.length}</span>}
                  </span>
                  <span className="pv-row-body">
                    <span className="pv-row-title">{l.title || 'Untitled listing'}</span>
                    <span className="pv-row-meta">
                      {l.brand && <span>{l.brand}</span>}
                      {l.size && <span>{baseSize(l.size)}</span>}
                      <span className={l.price == null ? 'pv-muted' : 'pv-price'}>
                        {l.price == null ? 'no price' : `$${l.price.toFixed(2)}`}
                      </span>
                      <span className={l.sku ? 'pv-sku' : 'pv-muted'}>{l.sku || 'no SKU'}</span>
                      {l.batchId
                        ? <span className="pv-muted">{batchNameFor(l.batchId)}</span>
                        : <span className="pv-muted">not in a batch</span>}
                    </span>
                    {labels.length > 0 && (
                      <span className="pv-row-labels">
                        {labels.map(x => {
                          const sw = labelSwatch(x.color);
                          return (
                            <span key={x.id} className="pv-tag" style={{ background: sw.bg, color: sw.fg }}>
                              {x.name}
                            </span>
                          );
                        })}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      {/* ── Detail ─────────────────────────────────────────────────────── */}
      <section className="pv-detail" ref={detailRef} aria-label="Listing detail">
        {!detail && (
          <div className="pv-detail-empty">
            <PackageSearch size={24} aria-hidden="true" />
            <p>Pick a listing to edit its fields, its barcode and its labels.</p>
          </div>
        )}

        {detail && (
          <>
            {detail.photos.length > 0 && (
              <div className="pv-photos">
                {detail.photos.map(src => (
                  <img key={src} src={src} alt="" loading="lazy" decoding="async" />
                ))}
              </div>
            )}

            <div className="pv-detail-head">
              <h2 className="pv-detail-title">{detail.title || 'Untitled listing'}</h2>
              <span className="pv-detail-sub">
                {detail.memberIds.length} photo{detail.memberIds.length === 1 ? '' : 's'}
                {detail.batchId
                  ? <> · {batchNameFor(detail.batchId)}{detail.batchId === currentBatchId ? ' (open)' : ''}</>
                  : ' · not in a batch'}
              </span>
              {detail.batchId ? (
                <button
                  type="button"
                  className="pv-btn pv-btn--primary pv-open-btn"
                  onClick={() => onOpenInWorkflow(detail.id, detail.batchId)}
                >
                  <ArrowUpRight size={14} aria-hidden="true" /> Open in workflow
                </button>
              ) : (
                <span className="pv-muted pv-open-note">Not in a batch, so there is nothing to open.</span>
              )}
              {detailBusy && <Loader2 size={13} className="pv-spin" aria-hidden="true" />}
            </div>

            {/* ── Fields ──────────────────────────────────────────────── */}
            <div className="pv-card">
              <h3 className="pv-card-title"><Pencil size={13} aria-hidden="true" /> Fields</h3>
              <div className="pv-grid">
                <label className="pv-field pv-field--wide">
                  <span>Title</span>
                  <input value={draft.title} onChange={(e) => setDraft(d => ({ ...d, title: e.target.value }))} />
                </label>
                <label className="pv-field">
                  <span>Brand</span>
                  <input value={draft.brand} onChange={(e) => setDraft(d => ({ ...d, brand: e.target.value }))} />
                </label>
                <label className="pv-field">
                  <span>Size</span>
                  <input value={draft.size} onChange={(e) => setDraft(d => ({ ...d, size: e.target.value }))} />
                </label>
                <label className="pv-field">
                  <span>Color</span>
                  <input value={draft.color} onChange={(e) => setDraft(d => ({ ...d, color: e.target.value }))} />
                </label>
                <label className="pv-field">
                  <span>Price</span>
                  <input
                    value={draft.price}
                    inputMode="decimal"
                    placeholder="—"
                    onChange={(e) => setDraft(d => ({ ...d, price: e.target.value }))}
                  />
                </label>
                <label className="pv-field">
                  <span>Condition</span>
                  <select value={draft.condition} onChange={(e) => setDraft(d => ({ ...d, condition: e.target.value }))}>
                    <option value="">—</option>
                    {CONDITIONS.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
                <label className="pv-field">
                  <span>Category</span>
                  <input value={draft.category} onChange={(e) => setDraft(d => ({ ...d, category: e.target.value }))} />
                </label>
              </div>
              <div className="pv-card-actions">
                <button type="button" className="pv-btn pv-btn--primary" onClick={() => void handleSave()} disabled={saving}>
                  {saving ? <Loader2 size={14} className="pv-spin" aria-hidden="true" /> : <Save size={14} aria-hidden="true" />}
                  {saving ? 'Saving…' : 'Save fields'}
                </button>
                <button
                  type="button" className="pv-btn"
                  onClick={() => setDraft(draftFrom(detail))}
                  disabled={saving}
                >
                  Revert
                </button>
                {notice && (
                  <span className={notice.tone === 'ok' ? 'pv-ok' : 'pv-warn-inline'} role="status">
                    {notice.tone === 'ok' && <Check size={12} aria-hidden="true" />} {notice.text}
                  </span>
                )}
              </div>
              <p className="pv-hint">
                Saved to every photo in this listing, the same way Step 3 saves — so the
                value survives a regroup.
              </p>
            </div>

            {/* ── Barcode ─────────────────────────────────────────────── */}
            <div className="pv-card">
              <h3 className="pv-card-title"><QrCode size={13} aria-hidden="true" /> Barcode</h3>
              <div className="pv-grid">
                <label className="pv-field">
                  <span>SKU</span>
                  <input
                    value={skuDraft}
                    autoCapitalize="characters"
                    spellCheck={false}
                    placeholder="ACD-7H2K9M"
                    onChange={(e) => setSkuDraft(e.target.value)}
                  />
                </label>
                <label className="pv-field">
                  <span>Barcode</span>
                  <input
                    value={barcodeDraft}
                    spellCheck={false}
                    placeholder="Manufacturer UPC / EAN"
                    onChange={(e) => setBarcodeDraft(e.target.value)}
                  />
                </label>
              </div>
              <p className="pv-hint">
                The CSV's <code>Variant Barcode</code> falls back to the SKU when the barcode
                is empty, so a listing is always scannable with one code or the other.
              </p>

              <div className="pv-card-actions">
                <button
                  type="button" className="pv-btn"
                  onClick={() => void handleGenerateSku()}
                  disabled={codeBusy || !!skuDraft.trim()}
                  title={skuDraft.trim() ? 'This listing already has a SKU' : undefined}
                >
                  {codeBusy ? <Loader2 size={14} className="pv-spin" aria-hidden="true" /> : <QrCode size={14} aria-hidden="true" />}
                  Generate SKU
                </button>
                <button
                  type="button" className="pv-btn pv-btn--primary"
                  onClick={() => void handleSaveCodes()}
                  disabled={codeBusy || !codesDirty}
                >
                  <Save size={14} aria-hidden="true" /> Save codes
                </button>
                <button
                  type="button" className="pv-btn"
                  onClick={() => window.print()}
                  disabled={!skuDraft.trim()}
                  title={skuDraft.trim() ? undefined : 'Assign a SKU first — a label with no barcode cannot be scanned'}
                >
                  <Printer size={14} aria-hidden="true" /> Print label
                </button>
                <label className="pv-field pv-field--inline">
                  <span>Stock</span>
                  <select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                    {LABEL_TEMPLATES.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </label>
              </div>

              {codeError && (
                <p className="pv-warn" role="alert"><AlertTriangle size={13} aria-hidden="true" /> {codeError}</p>
              )}

              <div className="pv-barcode-preview">
                {skuDraft.trim() ? (
                  <span
                    /* Generated by our own encoder from a code in this field —
                       never user HTML, and never a remote SVG. */
                    dangerouslySetInnerHTML={{
                      __html: code128Svg(skuDraft.trim().toUpperCase(), {
                        moduleWidth: 2, height: 48, quietZone: 10, showText: true, fontSize: 11,
                      }),
                    }}
                  />
                ) : (
                  <span className="pv-muted">No SKU yet — generate one to get a scannable barcode.</span>
                )}
              </div>
            </div>

            {/* ── Labels ──────────────────────────────────────────────── */}
            <div className="pv-card">
              <h3 className="pv-card-title"><Tag size={13} aria-hidden="true" /> Labels</h3>
              {labelsUnavailable ? (
                <p className="pv-warn">
                  <AlertTriangle size={13} aria-hidden="true" />
                  Labels need the <code>listing_labels</code> migration to be run first.
                </p>
              ) : (
                <>
                  <ListingLabelsPicker
                    key={`${detailIdKey}:${labelsRev}`}
                    productIds={detailIds}
                    onChanged={() => setLabelsRev(k => k + 1)}
                  />
                  <button
                    type="button"
                    className="pv-disclosure"
                    aria-expanded={manageOpen}
                    onClick={() => setManageOpen(o => !o)}
                  >
                    {manageOpen ? 'Hide label manager' : 'Manage labels'}
                  </button>
                  {manageOpen && (
                    <LabelManager
                      labels={vocabulary}
                      onChanged={() => setLabelsRev(k => k + 1)}
                    />
                  )}
                </>
              )}
            </div>
          </>
        )}
      </section>

      {/* ── The print sheet. Hidden on screen, and at print time it is the ONLY
             thing on the page (see the @media print block in ProductsView.css). */}
      {detail && skuDraft.trim() && (
        <div
          className="pv-print-wrap"
          aria-hidden="true"
          style={{
            '--pv-page-w': template.page.width,
            '--pv-page-h': template.page.height,
            '--pv-page-m': template.page.margin,
            '--pv-label-w': template.label.width,
            '--pv-label-h': template.label.height,
          } as CSSProperties}
        >
          <div className="pv-print-sheet">
            <div className="pv-print-label">
              <div className="pv-print-title">{(draft.title || 'Untitled listing').slice(0, 58)}</div>
              <div className="pv-print-meta">
                {draft.size && <span>{baseSize(draft.size)}</span>}
                {draft.price.trim() && <span className="pv-print-price">${Number(draft.price).toFixed(2)}</span>}
              </div>
              <div className="pv-print-chips">
                {unionLabels(detail.memberIds, labelsByProduct).map(l => {
                  const sw = labelSwatch(l.color);
                  return (
                    <span key={l.id} className="pv-print-chip" style={{ background: sw.bg, color: sw.fg }}>
                      {l.name}
                    </span>
                  );
                })}
              </div>
              <div
                className="pv-print-code"
                dangerouslySetInnerHTML={{
                  __html: code128Svg(skuDraft.trim().toUpperCase(), {
                    moduleWidth: template.moduleWidth,
                    height: template.barHeight,
                    quietZone: 10,
                    showText: true,
                    fontSize: 9,
                  }),
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── The workspace's label vocabulary ────────────────────────────────────────
   Rename, recolour, re-kind and delete. Creating is deliberately NOT duplicated
   here — ListingLabelsPicker's "New label" form above already does it, and a
   label created from inside a listing is applied to that listing, which is what
   a user reaching for a new label almost always wants. */
function LabelManager({ labels, onChanged }: { labels: ListingLabel[]; onChanged: () => void }) {
  const [usage, setUsage] = useState<Record<string, number> | null>(null);
  const [usageComplete, setUsageComplete] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [color, setColor] = useState(LABEL_COLORS[0].name);
  const [kind, setKind] = useState<LabelKind>('custom');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmKey, setConfirmKey] = useState<string | null>(null);
  const [usageKey, setUsageKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await countLabelUsage();
      if (cancelled) return;
      if (res.status === 'ok') { setUsage(res.counts); setUsageComplete(res.complete); }
      else setUsage({});
    })();
    return () => { cancelled = true; };
  }, [usageKey]);

  const startEdit = (l: ListingLabel) => {
    setEditingId(l.id); setName(l.name); setColor(l.color); setKind(l.kind); setError(null);
  };

  const commit = async (id: string) => {
    if (busyId) return;
    setBusyId(id);
    setError(null);
    const res = await updateLabel(id, { name, color, kind });
    setBusyId(null);
    if (!res.ok) { setError(res.error ?? 'Could not update that label.'); return; }
    setEditingId(null);
    onChanged();
  };

  const remove = async (id: string) => {
    setBusyId(id);
    setError(null);
    const res = await deleteLabel(id);
    setBusyId(null);
    if (!res.ok) { setError(res.error ?? 'Could not delete that label.'); return; }
    setUsageKey(k => k + 1);
    onChanged();
  };

  if (labels.length === 0) {
    return <p className="pv-hint">No labels yet — add one with “New label” above.</p>;
  }

  return (
    <div className="pv-manage">
      {!usageComplete && (
        <p className="pv-hint">Usage counts are capped — this workspace has more assignments than one read returns.</p>
      )}
      <ul className="pv-manage-list">
        {labels.map(l => {
          const sw = labelSwatch(l.color);
          const used = usage?.[l.id] ?? 0;
          const editing = editingId === l.id;
          return (
            <li key={l.id} className="pv-manage-row">
              {editing ? (
                <div className="pv-manage-edit">
                  <input
                    className="pv-manage-name"
                    value={name}
                    maxLength={LABEL_NAME_MAX}
                    aria-label="Label name"
                    autoFocus
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); void commit(l.id); }
                      if (e.key === 'Escape') { e.preventDefault(); setEditingId(null); }
                    }}
                  />
                  <div className="pv-manage-colors" role="radiogroup" aria-label="Label colour">
                    {LABEL_COLORS.map(c => (
                      <button
                        key={c.name}
                        type="button"
                        role="radio"
                        aria-checked={color === c.name}
                        aria-label={c.label}
                        title={c.label}
                        className={`pv-swatch${color === c.name ? ' pv-swatch--on' : ''}`}
                        style={{ background: c.bg }}
                        onClick={() => setColor(c.name)}
                      />
                    ))}
                  </div>
                  <label className="pv-manage-kind">
                    <input
                      type="checkbox"
                      checked={kind === 'vendor'}
                      onChange={(e) => setKind(e.target.checked ? 'vendor' : 'custom')}
                    />
                    This is a vendor
                  </label>
                  <div className="pv-manage-actions">
                    <button
                      type="button" className="pv-btn pv-btn--primary"
                      onClick={() => void commit(l.id)} disabled={busyId !== null || !name.trim()}
                    >
                      Save
                    </button>
                    <button type="button" className="pv-btn" onClick={() => setEditingId(null)}>Cancel</button>
                  </div>
                </div>
              ) : (
                <>
                  <span className="pv-tag" style={{ background: sw.bg, color: sw.fg }}>{l.name}</span>
                  {l.kind === 'vendor' && <span className="pv-manage-kindtag">vendor</span>}
                  <span className="pv-muted pv-manage-usage">
                    used on {used} listing{used === 1 ? '' : 's'}
                  </span>
                  <span className="pv-manage-actions">
                    <button type="button" className="pv-btn" onClick={() => startEdit(l)} disabled={busyId !== null}>
                      Rename
                    </button>
                    {/* Two-step, never confirm() (§18 #12). Deleting removes the
                        label from every listing it is on — product_labels
                        cascades — so the prompt says the number out loud. */}
                    <ConfirmAction
                      label="Delete"
                      prompt={used > 0
                        ? `Delete “${l.name}” and remove it from ${used} listing${used === 1 ? '' : 's'}?`
                        : `Delete “${l.name}”?`}
                      onConfirm={() => void remove(l.id)}
                      disabled={busyId !== null}
                      armed={confirmKey === l.id}
                      onArmedChange={(on) => setConfirmKey(on ? l.id : null)}
                    />
                  </span>
                </>
              )}
            </li>
          );
        })}
      </ul>
      {error && <p className="pv-warn" role="alert"><AlertTriangle size={13} aria-hidden="true" /> {error}</p>}
    </div>
  );
}
