import { useEffect, useState } from 'react';
import { BookMarked, X, Plus, Pencil, Check, Trash2, Search } from 'lucide-react';
import {
  fetchAllChips, createChip, updateChip, deleteChip,
  fetchAllBrandKeywords, createBrandKeywords, updateBrandKeywords, deleteBrandKeywords,
  fetchAllModels, createModel, updateModel, deleteModel,
  parseKeywordList, termMatchesChip,
  type DescriptorChip, type BrandKeywordRow, type ModelRow, type ModelInput,
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

  // Built-in model knowledge base (MODEL_DATABASE: Levi's 501 etc.) —
  // read-only reference importable into the editable table, lazy-loaded.
  const [builtinModels, setBuiltinModels] = useState<(ModelContext & { key: string })[] | null>(null);
  useEffect(() => {
    if (tab !== 'models' || builtinModels !== null) return;
    let cancelled = false;
    import('../lib/brandCategorySystem').then(m => {
      if (cancelled) return;
      const list = Object.entries(m.MODEL_DATABASE)
        .map(([key, v]) => ({ key, ...v }))
        .sort((a, b) => a.brand.localeCompare(b.brand) || a.modelName.localeCompare(b.modelName));
      setBuiltinModels(list);
    });
    return () => { cancelled = true; };
  }, [tab, builtinModels]);

  // Editable models (vocab_models table) + the add/edit form
  const [dbModels, setDbModels] = useState<ModelRow[]>([]);
  const emptyModelForm = {
    brand: '', model_name: '', model_number: '', category: '', year: '',
    price_min: '', price_max: '', collectibility: '', features: '', keywords: '',
    discontinued: false,
  };
  const [modelForm, setModelForm] = useState(emptyModelForm);
  const [modelEditId, setModelEditId] = useState<string | null>(null);
  const setMF = (key: keyof typeof emptyModelForm, value: string | boolean) =>
    setModelForm(f => ({ ...f, [key]: value }));

  // Used by action handlers (never synchronously inside an effect — the
  // initial load below awaits before any setState to satisfy render purity).
  const reload = async () => {
    const [c, b, m] = await Promise.all([fetchAllChips(), fetchAllBrandKeywords(), fetchAllModels()]);
    setChips(c);
    setBrands(b);
    setDbModels(m);
    setLoading(false);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [c, b, m] = await Promise.all([fetchAllChips(), fetchAllBrandKeywords(), fetchAllModels()]);
      if (cancelled) return;
      setChips(c);
      setBrands(b);
      setDbModels(m);
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

  // ── Brand keyword coverage (Chips tab) ────────────────────────────────────
  // Every distinct word across the ACTIVE editable brand entries, with how
  // many brands use it and whether an active chip already covers it (same
  // loose matching Step 3 uses). Uncovered words get a one-click "make chip".
  const brandWordCoverage = (() => {
    const counts = new Map<string, number>();
    // ALL brand entries count, active or not — the founder curates against
    // the full word universe regardless of which brands are toggled on.
    brands.forEach(b => {
      new Set(b.keywords.map(k => k.toLowerCase().trim()).filter(Boolean))
        .forEach(w => counts.set(w, (counts.get(w) ?? 0) + 1));
    });
    return Array.from(counts.entries())
      .map(([word, count]) => ({
        word,
        count,
        covered: chips.some(c => c.is_active && termMatchesChip(word, c.label, c.output_text || c.label)),
      }))
      .sort((a, b) => Number(a.covered) - Number(b.covered) || b.count - a.count || a.word.localeCompare(b.word));
  })();

  // ── Models: form save / edit / import ─────────────────────────────────────
  const modelFormToInput = (): Omit<ModelInput, 'is_active'> => ({
    brand: modelForm.brand.trim(),
    model_name: modelForm.model_name.trim(),
    model_number: modelForm.model_number.trim() || null,
    category: modelForm.category.trim() || null,
    year_introduced: modelForm.year.trim() ? (parseInt(modelForm.year, 10) || null) : null,
    discontinued: modelForm.discontinued,
    keywords: parseKeywordList(modelForm.keywords),
    identifying_features: modelForm.features.split(',').map(s => s.trim()).filter(Boolean),
    price_min: modelForm.price_min.trim() ? (parseFloat(modelForm.price_min) || null) : null,
    price_max: modelForm.price_max.trim() ? (parseFloat(modelForm.price_max) || null) : null,
    collectibility: modelForm.collectibility.trim()
      ? Math.min(10, Math.max(1, parseInt(modelForm.collectibility, 10) || 1))
      : null,
  });

  const handleSaveModel = () => run(
    () => {
      const input = modelFormToInput();
      const op = modelEditId
        ? updateModel(modelEditId, input)
        : createModel({ ...input, is_active: true });
      return op.then(r => {
        if (r.ok) { setModelForm(emptyModelForm); setModelEditId(null); }
        return r;
      });
    },
    modelEditId ? 'Model updated.' : 'Model added.',
  );

  const startEditModel = (m: ModelRow) => {
    setModelEditId(m.id);
    setModelForm({
      brand: m.brand,
      model_name: m.model_name,
      model_number: m.model_number ?? '',
      category: m.category ?? '',
      year: m.year_introduced != null ? String(m.year_introduced) : '',
      price_min: m.price_min != null ? String(m.price_min) : '',
      price_max: m.price_max != null ? String(m.price_max) : '',
      collectibility: m.collectibility != null ? String(m.collectibility) : '',
      features: m.identifying_features.join(', '),
      keywords: m.keywords.join(', '),
      discontinued: m.discontinued,
    });
    setConfirmDeleteId(null);
  };

  const handleImportBuiltinModel = (mo: ModelContext & { key: string }) => run(
    () => createModel({
      brand: mo.brand,
      model_name: mo.modelName,
      model_number: mo.modelNumber ?? null,
      category: String(mo.category),
      year_introduced: mo.yearIntroduced ?? null,
      discontinued: !!mo.discontinued,
      keywords: mo.keywords.map(k => k.toLowerCase()),
      identifying_features: mo.identifyingFeatures,
      price_min: mo.priceRange[0],
      price_max: mo.priceRange[1],
      collectibility: mo.collectibility,
      is_active: true,
    }),
    `${mo.brand} ${mo.modelName} copied to your editable list above.`,
  );

  const dbModelKeys = new Set(dbModels.map(m => `${m.brand.toLowerCase()}|${m.model_name.toLowerCase()}`));

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
            Models ({dbModels.length})
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
              The model knowledge base — the recognition checklist and pricing data for the
              future photo scanning feature. Add models as you handle notable items;
              features and keywords are comma separated.
            </p>

            <div className="vocab-model-form">
              <label className="vocab-mf-field"><span>Brand</span>
                <input value={modelForm.brand} onChange={(e) => setMF('brand', e.target.value)} placeholder="Levi's" /></label>
              <label className="vocab-mf-field"><span>Model name</span>
                <input value={modelForm.model_name} onChange={(e) => setMF('model_name', e.target.value)} placeholder="501 Original Fit" /></label>
              <label className="vocab-mf-field"><span>Model number</span>
                <input value={modelForm.model_number} onChange={(e) => setMF('model_number', e.target.value)} placeholder="501" /></label>
              <label className="vocab-mf-field"><span>Category</span>
                <input value={modelForm.category} onChange={(e) => setMF('category', e.target.value)} placeholder="heritage-denim" /></label>
              <label className="vocab-mf-field"><span>Year introduced</span>
                <input value={modelForm.year} onChange={(e) => setMF('year', e.target.value)} placeholder="1873" inputMode="numeric" /></label>
              <label className="vocab-mf-field"><span>Collectibility (1–10)</span>
                <input value={modelForm.collectibility} onChange={(e) => setMF('collectibility', e.target.value)} placeholder="10" inputMode="numeric" /></label>
              <label className="vocab-mf-field"><span>Price min ($)</span>
                <input value={modelForm.price_min} onChange={(e) => setMF('price_min', e.target.value)} placeholder="60" inputMode="decimal" /></label>
              <label className="vocab-mf-field"><span>Price max ($)</span>
                <input value={modelForm.price_max} onChange={(e) => setMF('price_max', e.target.value)} placeholder="300" inputMode="decimal" /></label>
              <label className="vocab-mf-field vocab-mf-check"><span>Discontinued</span>
                <input type="checkbox" checked={modelForm.discontinued} onChange={(e) => setMF('discontinued', e.target.checked)} /></label>
              <label className="vocab-mf-field vocab-mf-wide"><span>Identifying features (comma separated)</span>
                <input value={modelForm.features} onChange={(e) => setMF('features', e.target.value)} placeholder="button fly, red tab, arcuate stitching" /></label>
              <label className="vocab-mf-field vocab-mf-wide"><span>Keywords (comma separated)</span>
                <input value={modelForm.keywords} onChange={(e) => setMF('keywords', e.target.value)} placeholder="501, original fit, selvedge" /></label>
              <div className="vocab-mf-actions">
                <button className="vocab-add-btn" disabled={busy || !modelForm.brand.trim() || !modelForm.model_name.trim()} onClick={handleSaveModel}>
                  {modelEditId ? <><Check size={13} /> Save model</> : <><Plus size={13} /> Add model</>}
                </button>
                {modelEditId && (
                  <button className="vocab-confirm-no" disabled={busy}
                    onClick={() => { setModelEditId(null); setModelForm(emptyModelForm); }}>Cancel edit</button>
                )}
              </div>
            </div>

            <ul className="vocab-list">
              {dbModels
                .filter(m => !q
                  || m.brand.toLowerCase().includes(q)
                  || m.model_name.toLowerCase().includes(q)
                  || (m.model_number ?? '').toLowerCase().includes(q)
                  || m.keywords.some(k => k.includes(q))
                  || m.identifying_features.some(f => f.toLowerCase().includes(q)))
                .map(m => (
                  <li key={m.id} className={`vocab-row vocab-model-row ${!m.is_active ? 'vocab-row--off' : ''}`}>
                    <div className="vocab-model-info">
                      <span>
                        <span className="vocab-brand-name">{m.brand} {m.model_name}</span>
                        {m.model_number ? <span className="vocab-model-number">#{m.model_number}</span> : null}
                        {m.discontinued ? <span className="vocab-model-number">discontinued</span> : null}
                      </span>
                      <span className="vocab-row-detail" title={m.identifying_features.join(', ')}>
                        {m.identifying_features.join(', ') || <span className="vocab-muted">no features listed</span>}
                      </span>
                      <span className="vocab-model-meta">
                        {m.category ?? '—'}
                        {m.year_introduced ? ` · since ${m.year_introduced}` : ''}
                        {m.price_min != null && m.price_max != null ? ` · $${m.price_min}–$${m.price_max}` : ''}
                        {m.collectibility != null ? ` · collectibility ${m.collectibility}/10` : ''}
                      </span>
                    </div>
                    <label className="vocab-toggle" title={m.is_active ? 'Active' : 'Disabled'}>
                      <input type="checkbox" checked={m.is_active} disabled={busy}
                        onChange={() => run(() => updateModel(m.id, { is_active: !m.is_active }), m.is_active ? 'Model disabled.' : 'Model active again.')} />
                      {m.is_active ? 'on' : 'off'}
                    </label>
                    <button className="vocab-icon-btn" title="Edit" disabled={busy} onClick={() => startEditModel(m)}><Pencil size={13} /></button>
                    {confirmDeleteId === m.id ? (
                      <span className="vocab-confirm">
                        <button className="vocab-confirm-yes" disabled={busy}
                          onClick={() => { setConfirmDeleteId(null); run(() => deleteModel(m.id), 'Model deleted.'); }}>Delete</button>
                        <button className="vocab-confirm-no" disabled={busy} onClick={() => setConfirmDeleteId(null)}>Cancel</button>
                      </span>
                    ) : (
                      <button className="vocab-icon-btn vocab-icon-danger" title="Delete model" disabled={busy} onClick={() => setConfirmDeleteId(m.id)}><Trash2 size={13} /></button>
                    )}
                  </li>
                ))}
              {dbModels.length === 0 && <p className="vocab-loading">No editable models yet — add one above or copy from the built-in library below.</p>}
            </ul>

            <h3 className="vocab-builtin-title">
              Built-in model library ({builtinModels ? builtinModels.length : '…'})
            </h3>
            <p className="vocab-help">
              Read only. Copy a model up into your editable list to use or tweak it.
            </p>
            {!builtinModels ? (
              <p className="vocab-loading">Loading model database…</p>
            ) : (() => {
              const filteredModels = builtinModels.filter(mo => !q
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
                      {dbModelKeys.has(`${mo.brand.toLowerCase()}|${mo.modelName.toLowerCase()}`) ? (
                        <span className="vocab-customized-badge">customized</span>
                      ) : (
                        <button className="vocab-icon-btn" title="Copy to your editable list" disabled={busy}
                          onClick={() => handleImportBuiltinModel(mo)}><Plus size={13} /></button>
                      )}
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

            {brandWordCoverage.length > 0 && (
              <>
                <h3 className="vocab-builtin-title">
                  Brand keyword coverage ({brandWordCoverage.filter(w => !w.covered).length} without a chip)
                </h3>
                <p className="vocab-help">
                  Every word your brand entries output, and whether a chip already covers it —
                  promote the uncovered ones so they're one tap away for every listing, not just
                  listings of that brand.
                </p>
                <div className="vocab-coverage-wrap">
                  {brandWordCoverage
                    .filter(w => !q || w.word.includes(q))
                    .map(w => (
                      <span key={w.word} className={`vocab-coverage-pill ${w.covered ? 'vocab-coverage-pill--covered' : ''}`}>
                        {w.word}
                        <span className="vocab-coverage-count" title={`Used by ${w.count} brand${w.count === 1 ? '' : 's'}`}>{w.count}</span>
                        {w.covered ? (
                          <Check size={11} className="vocab-coverage-check" />
                        ) : (
                          <button
                            className="vocab-coverage-make"
                            title={`Make "${w.word}" a quick keyword chip`}
                            disabled={busy}
                            onClick={() => run(() => createChip(w.word), `"${w.word}" is now a chip — it shows in Step 3 for every workspace.`)}
                          >
                            <Plus size={11} /> chip
                          </button>
                        )}
                      </span>
                    ))}
                </div>
              </>
            )}
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
