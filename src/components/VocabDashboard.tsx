import { useEffect, useState } from 'react';
import { BookMarked, X, Plus, Pencil, Check, Trash2, Search } from 'lucide-react';
import {
  fetchAllChips, createChip, updateChip, deleteChip,
  fetchAllBrandKeywords, createBrandKeywords, updateBrandKeywords, deleteBrandKeywords,
  parseKeywordList,
  type DescriptorChip, type BrandKeywordRow,
} from '../lib/vocabService';
// type-only imports — the heavy BRAND_DNA / MODEL_DATABASE data is loaded
// dynamically when its tab opens (see the lazy-load effects below)
import type { BuiltinBrandEntry } from '../lib/builtinBrandVocab';
import type { ModelContext } from '../lib/brandCategorySystem';
import './VocabDashboard.css';

interface VocabDashboardProps {
  onClose: () => void;
}

/**
 * Vocabulary dashboard — Founding Workspace admins only (App gates rendering;
 * RLS enforces writes server-side). Curates the GLOBAL vocabulary every
 * workspace consumes:
 *   Chips tab  — the Step 3 "Quick keywords" chips: label shown on the button
 *                vs output text inserted into the description (blank = label).
 *   Brands tab — words associated with a brand, merged into generated tags
 *                (and the #hashtags) whenever an item's brand matches.
 * Beta users see and use all of it; only founders can change it.
 */
export default function VocabDashboard({ onClose }: VocabDashboardProps) {
  const [tab, setTab] = useState<'chips' | 'brands' | 'models'>('chips');
  const [chips, setChips] = useState<DescriptorChip[]>([]);
  const [brands, setBrands] = useState<BrandKeywordRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');
  // `add:<tab>` form values
  const [newChipLabel, setNewChipLabel] = useState('');
  const [newChipOutput, setNewChipOutput] = useState('');
  const [newBrand, setNewBrand] = useState('');
  const [newBrandWords, setNewBrandWords] = useState('');
  // Row being edited + its draft values
  const [editId, setEditId] = useState<string | null>(null);
  const [draftA, setDraftA] = useState(''); // chip label / brand name
  const [draftB, setDraftB] = useState(''); // chip output / brand keywords
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Built-in brand library (the hardcoded BRAND_DNA knowledge base) — loaded
  // lazily so its several-hundred-KB of data never enters the main bundle.
  const [builtins, setBuiltins] = useState<BuiltinBrandEntry[] | null>(null);
  const [showAllBuiltins, setShowAllBuiltins] = useState(false);
  useEffect(() => {
    if (tab !== 'brands' || builtins !== null) return;
    let cancelled = false;
    import('../lib/builtinBrandVocab').then(m => {
      if (!cancelled) setBuiltins(m.getBuiltinBrandVocab());
    });
    return () => { cancelled = true; };
  }, [tab, builtins]);

  // Model knowledge base (MODEL_DATABASE: Levi's 501 etc. with identifying
  // features, price ranges, collectibility) — read-only reference, lazy-loaded.
  const [models, setModels] = useState<(ModelContext & { key: string })[] | null>(null);
  useEffect(() => {
    if (tab !== 'models' || models !== null) return;
    let cancelled = false;
    import('../lib/brandCategorySystem').then(m => {
      if (cancelled) return;
      const list = Object.entries(m.MODEL_DATABASE)
        .map(([key, v]) => ({ key, ...v }))
        .sort((a, b) => a.brand.localeCompare(b.brand) || a.modelName.localeCompare(b.modelName));
      setModels(list);
    });
    return () => { cancelled = true; };
  }, [tab, models]);

  // Used by action handlers (never synchronously inside an effect — the
  // initial load below awaits before any setState to satisfy render purity).
  const reload = async () => {
    const [c, b] = await Promise.all([fetchAllChips(), fetchAllBrandKeywords()]);
    setChips(c);
    setBrands(b);
    setLoading(false);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [c, b] = await Promise.all([fetchAllChips(), fetchAllBrandKeywords()]);
      if (cancelled) return;
      setChips(c);
      setBrands(b);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const run = async (fn: () => Promise<{ ok: boolean; error?: string } | boolean>, okMsg: string) => {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    const res = await fn();
    const ok = typeof res === 'boolean' ? res : res.ok;
    const err = typeof res === 'boolean' ? undefined : res.error;
    setNotice(ok ? okMsg : (err || 'That did not work — check your permissions.'));
    await reload();
    setBusy(false);
  };

  // ── Chips ────────────────────────────────────────────────────────────────
  const handleAddChip = () => run(
    () => createChip(newChipLabel, newChipOutput || undefined).then(r => { if (r.ok) { setNewChipLabel(''); setNewChipOutput(''); } return r; }),
    'Chip added — it appears in Step 3 for every workspace.',
  );

  const startEditChip = (c: DescriptorChip) => {
    setEditId(c.id);
    setDraftA(c.label);
    setDraftB(c.output_text ?? '');
    setConfirmDeleteId(null);
  };

  const handleSaveChip = (id: string) => run(
    () => updateChip(id, { label: draftA, output_text: draftB }).then(r => { if (r.ok) setEditId(null); return r; }),
    'Chip updated.',
  );

  // ── Brands ───────────────────────────────────────────────────────────────
  const handleAddBrand = () => run(
    () => createBrandKeywords(newBrand, parseKeywordList(newBrandWords)).then(r => { if (r.ok) { setNewBrand(''); setNewBrandWords(''); } return r; }),
    'Brand keywords added — they merge into tags whenever that brand is set.',
  );

  const startEditBrand = (b: BrandKeywordRow) => {
    setEditId(b.id);
    setDraftA(b.brand);
    setDraftB(b.keywords.join(', '));
    setConfirmDeleteId(null);
  };

  const handleSaveBrand = (id: string) => run(
    () => updateBrandKeywords(id, { brand: draftA, keywords: parseKeywordList(draftB) }).then(r => { if (r.ok) setEditId(null); return r; }),
    'Brand keywords updated.',
  );

  const q = search.trim().toLowerCase();
  const visibleChips = chips.filter(c => !q || c.label.includes(q) || (c.output_text ?? '').toLowerCase().includes(q));
  const visibleBrands = brands.filter(b => !q || b.brand.toLowerCase().includes(q) || b.keywords.some(k => k.includes(q)));

  // Built-in library: filter by the same search box; cap the render so 5,000
  // rows never mount at once. Brands already copied to the editable table get
  // a "customized" badge instead of the import button.
  const editableBrandSet = new Set(brands.map(b => b.brand.toLowerCase()));
  const BUILTIN_RENDER_CAP = q ? 100 : 50;
  const matchingBuiltins = (builtins ?? []).filter(
    e => !q || e.brand.toLowerCase().includes(q) || e.keywords.some(k => k.includes(q))
  );
  const visibleBuiltins = showAllBuiltins ? matchingBuiltins : matchingBuiltins.slice(0, BUILTIN_RENDER_CAP);

  const handleImportBuiltin = (entry: BuiltinBrandEntry) => run(
    () => createBrandKeywords(entry.brand, entry.keywords),
    `${entry.brand} copied to your editable list above.`,
  );

  return (
    <div className="vocab-overlay" onClick={onClose}>
      <div className="vocab-panel" onClick={(e) => e.stopPropagation()}>
        <div className="vocab-header">
          <div className="vocab-title">
            <BookMarked size={20} />
            <h2>Vocabulary</h2>
            <span className="vocab-scope-badge">global — all workspaces</span>
          </div>
          <button className="vocab-close" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>

        <div className="vocab-tabs">
          <button className={`vocab-tab ${tab === 'chips' ? 'vocab-tab--on' : ''}`} onClick={() => { setTab('chips'); setEditId(null); setConfirmDeleteId(null); }}>
            Quick keyword chips ({chips.length})
          </button>
          <button className={`vocab-tab ${tab === 'brands' ? 'vocab-tab--on' : ''}`} onClick={() => { setTab('brands'); setEditId(null); setConfirmDeleteId(null); }}>
            Brand keywords ({brands.length})
          </button>
          <button className={`vocab-tab ${tab === 'models' ? 'vocab-tab--on' : ''}`} onClick={() => { setTab('models'); setEditId(null); setConfirmDeleteId(null); }}>
            Models ({models ? models.length : '…'})
          </button>
          <div className="vocab-search">
            <Search size={13} />
            <input placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>

        {notice && <div className="vocab-notice">{notice}</div>}

        {loading ? (
          <p className="vocab-loading">Loading vocabulary…</p>
        ) : tab === 'models' ? (
          <>
            <p className="vocab-help">
              The model knowledge base — read only. It powers model matching today and is the
              checklist for the future photo scanning feature (identifying features, price
              ranges, collectibility).
            </p>
            {!models ? (
              <p className="vocab-loading">Loading model database…</p>
            ) : (() => {
              const filteredModels = models.filter(mo => !q
                || mo.brand.toLowerCase().includes(q)
                || mo.modelName.toLowerCase().includes(q)
                || (mo.modelNumber ?? '').toLowerCase().includes(q)
                || mo.keywords.some(k => k.toLowerCase().includes(q))
                || mo.identifyingFeatures.some(f => f.toLowerCase().includes(q)));
              return (
              <ul className="vocab-list">
                {filteredModels
                  .map(mo => (
                    <li key={mo.key} className="vocab-row vocab-row--builtin vocab-model-row">
                      <div className="vocab-model-info">
                        <span>
                          <span className="vocab-brand-name">{mo.brand} {mo.modelName}</span>
                          {mo.modelNumber ? <span className="vocab-model-number">#{mo.modelNumber}</span> : null}
                          {mo.discontinued ? <span className="vocab-model-number">discontinued</span> : null}
                        </span>
                        <span className="vocab-row-detail" title={mo.identifyingFeatures.join(', ')}>
                          {mo.identifyingFeatures.join(', ')}
                        </span>
                        <span className="vocab-model-meta">
                          {String(mo.category)}
                          {mo.yearIntroduced ? ` · since ${mo.yearIntroduced}` : ''}
                          {` · $${mo.priceRange[0]}–$${mo.priceRange[1]}`}
                          {` · collectibility ${mo.collectibility}/10`}
                        </span>
                      </div>
                    </li>
                  ))}
                {filteredModels.length === 0 && (
                  <p className="vocab-loading">No models match.</p>
                )}
              </ul>
              );
            })()}
          </>
        ) : tab === 'chips' ? (
          <>
            <p className="vocab-help">
              Chips show in Step 3 for every workspace. <strong>Label</strong> is the button text;
              <strong> output</strong> is what gets inserted into the description (leave blank to insert the label itself).
              Toggle a chip off to hide it without deleting it.
            </p>
            <div className="vocab-add-form">
              <input placeholder="label (e.g. sun faded)" value={newChipLabel}
                onChange={(e) => setNewChipLabel(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleAddChip(); }} />
              <input placeholder="output (optional — defaults to label)" value={newChipOutput}
                onChange={(e) => setNewChipOutput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleAddChip(); }} />
              <button className="vocab-add-btn" disabled={busy || !newChipLabel.trim()} onClick={handleAddChip}>
                <Plus size={13} /> Add chip
              </button>
            </div>
            <ul className="vocab-list">
              {visibleChips.map(c => (
                <li key={c.id} className={`vocab-row ${!c.is_active ? 'vocab-row--off' : ''}`}>
                  {editId === c.id ? (
                    <>
                      <input className="vocab-edit-input" value={draftA} onChange={(e) => setDraftA(e.target.value)} placeholder="label" autoFocus />
                      <input className="vocab-edit-input vocab-edit-input--wide" value={draftB} onChange={(e) => setDraftB(e.target.value)} placeholder="output (blank = label)" />
                      <button className="vocab-icon-btn" title="Save" disabled={busy || !draftA.trim()} onClick={() => handleSaveChip(c.id)}><Check size={13} /></button>
                      <button className="vocab-icon-btn" title="Cancel" disabled={busy} onClick={() => setEditId(null)}><X size={13} /></button>
                    </>
                  ) : (
                    <>
                      <span className="vocab-chip-preview">{c.label}</span>
                      <span className="vocab-row-detail">
                        {c.output_text && c.output_text !== c.label ? <>inserts “{c.output_text}”</> : <span className="vocab-muted">inserts the label</span>}
                      </span>
                      <label className="vocab-toggle" title={c.is_active ? 'Shown in Step 3' : 'Hidden'}>
                        <input type="checkbox" checked={c.is_active} disabled={busy}
                          onChange={() => run(() => updateChip(c.id, { is_active: !c.is_active }), c.is_active ? 'Chip hidden.' : 'Chip visible again.')} />
                        {c.is_active ? 'on' : 'off'}
                      </label>
                      <button className="vocab-icon-btn" title="Edit" disabled={busy} onClick={() => startEditChip(c)}><Pencil size={13} /></button>
                      {confirmDeleteId === c.id ? (
                        <span className="vocab-confirm">
                          <button className="vocab-confirm-yes" disabled={busy}
                            onClick={() => { setConfirmDeleteId(null); run(() => deleteChip(c.id), 'Chip deleted.'); }}>Delete</button>
                          <button className="vocab-confirm-no" disabled={busy} onClick={() => setConfirmDeleteId(null)}>Cancel</button>
                        </span>
                      ) : (
                        <button className="vocab-icon-btn vocab-icon-danger" title="Delete" disabled={busy} onClick={() => setConfirmDeleteId(c.id)}><Trash2 size={13} /></button>
                      )}
                    </>
                  )}
                </li>
              ))}
              {visibleChips.length === 0 && <p className="vocab-loading">No chips match.</p>}
            </ul>
          </>
        ) : (
          <>
            <p className="vocab-help">
              When an item's <strong>brand</strong> matches a row here (case-insensitive), its keywords merge
              into the generated tags and #hashtags for every workspace — same treatment as preset tags.
              Keywords are comma separated.
            </p>
            <div className="vocab-add-form">
              <input placeholder="brand (e.g. Harley Davidson)" value={newBrand}
                onChange={(e) => setNewBrand(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleAddBrand(); }} />
              <input placeholder="keywords: biker, moto, americana" value={newBrandWords}
                onChange={(e) => setNewBrandWords(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleAddBrand(); }} />
              <button className="vocab-add-btn" disabled={busy || !newBrand.trim() || !newBrandWords.trim()} onClick={handleAddBrand}>
                <Plus size={13} /> Add brand
              </button>
            </div>
            <ul className="vocab-list">
              {visibleBrands.map(b => (
                <li key={b.id} className={`vocab-row ${!b.is_active ? 'vocab-row--off' : ''}`}>
                  {editId === b.id ? (
                    <>
                      <input className="vocab-edit-input" value={draftA} onChange={(e) => setDraftA(e.target.value)} placeholder="brand" autoFocus />
                      <input className="vocab-edit-input vocab-edit-input--wide" value={draftB} onChange={(e) => setDraftB(e.target.value)} placeholder="keywords, comma separated" />
                      <button className="vocab-icon-btn" title="Save" disabled={busy || !draftA.trim() || !draftB.trim()} onClick={() => handleSaveBrand(b.id)}><Check size={13} /></button>
                      <button className="vocab-icon-btn" title="Cancel" disabled={busy} onClick={() => setEditId(null)}><X size={13} /></button>
                    </>
                  ) : (
                    <>
                      <span className="vocab-brand-name">{b.brand}</span>
                      <span className="vocab-row-detail">{b.keywords.join(', ') || <span className="vocab-muted">no keywords</span>}</span>
                      <label className="vocab-toggle" title={b.is_active ? 'Active' : 'Disabled'}>
                        <input type="checkbox" checked={b.is_active} disabled={busy}
                          onChange={() => run(() => updateBrandKeywords(b.id, { is_active: !b.is_active }), b.is_active ? 'Brand keywords disabled.' : 'Brand keywords active again.')} />
                        {b.is_active ? 'on' : 'off'}
                      </label>
                      <button className="vocab-icon-btn" title="Edit" disabled={busy} onClick={() => startEditBrand(b)}><Pencil size={13} /></button>
                      {confirmDeleteId === b.id ? (
                        <span className="vocab-confirm">
                          <button className="vocab-confirm-yes" disabled={busy}
                            onClick={() => { setConfirmDeleteId(null); run(() => deleteBrandKeywords(b.id), 'Brand keywords deleted.'); }}>Delete</button>
                          <button className="vocab-confirm-no" disabled={busy} onClick={() => setConfirmDeleteId(null)}>Cancel</button>
                        </span>
                      ) : (
                        <button className="vocab-icon-btn vocab-icon-danger" title="Delete" disabled={busy} onClick={() => setConfirmDeleteId(b.id)}><Trash2 size={13} /></button>
                      )}
                    </>
                  )}
                </li>
              ))}
              {visibleBrands.length === 0 && <p className="vocab-loading">No brand keywords yet — add the first one above.</p>}
            </ul>

            <h3 className="vocab-builtin-title">
              Built-in brand library ({builtins ? matchingBuiltins.length : '…'})
            </h3>
            <p className="vocab-help">
              The knowledge base already shipped with the app — read only. Copy a brand up into
              your editable list to use or tweak its words; edited copies always win.
              {builtins && matchingBuiltins.length > visibleBuiltins.length
                ? ` Showing ${visibleBuiltins.length} of ${matchingBuiltins.length}.`
                : ''}
              {builtins && matchingBuiltins.length > BUILTIN_RENDER_CAP && (
                <button className="vocab-showall-btn" onClick={() => setShowAllBuiltins(v => !v)}>
                  {showAllBuiltins ? 'Show fewer' : `Show all ${matchingBuiltins.length}`}
                </button>
              )}
            </p>
            {!builtins ? (
              <p className="vocab-loading">Loading built-in library…</p>
            ) : (
              <ul className="vocab-list">
                {visibleBuiltins.map(e => (
                  <li key={e.brand} className="vocab-row vocab-row--builtin">
                    <span className="vocab-brand-name">{e.brand}</span>
                    <span className="vocab-row-detail">{e.keywords.join(', ')}</span>
                    {editableBrandSet.has(e.brand.toLowerCase()) ? (
                      <span className="vocab-customized-badge">customized</span>
                    ) : (
                      <button className="vocab-icon-btn" title="Copy to your editable list" disabled={busy}
                        onClick={() => handleImportBuiltin(e)}><Plus size={13} /></button>
                    )}
                  </li>
                ))}
                {visibleBuiltins.length === 0 && <p className="vocab-loading">No built-in brands match.</p>}
              </ul>
            )}
          </>
        )}

        <p className="vocab-footnote">
          Changes apply to every workspace the next time they open Step 3 or generate a description.
          Only Founding Workspace admins can edit; everyone else just gets the results.
        </p>
      </div>
    </div>
  );
}
