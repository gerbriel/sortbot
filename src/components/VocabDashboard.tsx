import { useEffect, useState } from 'react';
import { BookMarked, X, Plus, Pencil, Check, Trash2, Search } from 'lucide-react';
import {
  fetchAllChips, createChip, updateChip, deleteChip,
  fetchAllBrandKeywords, createBrandKeywords, updateBrandKeywords, deleteBrandKeywords,
  parseKeywordList,
  type DescriptorChip, type BrandKeywordRow,
} from '../lib/vocabService';
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
  const [tab, setTab] = useState<'chips' | 'brands'>('chips');
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
          <div className="vocab-search">
            <Search size={13} />
            <input placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>

        {notice && <div className="vocab-notice">{notice}</div>}

        {loading ? (
          <p className="vocab-loading">Loading vocabulary…</p>
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
