import React, { useState } from 'react';
import { Check, X, Undo2, BookMarked, Trash2, Plus, Pencil } from 'lucide-react';
import type { BrandAlias } from '../lib/brandAliasService';
import './BrandSpelling.css';

/**
 * BrandSpelling — the Step 3 brand-correction surface (founder report 14).
 *
 * Three states, at most one at a time, shown directly under the Brand field:
 *
 *   applied   an exact saved alias fired. The field is ALREADY rewritten; this
 *             just says so and offers Undo. No decision is asked for, because
 *             the workspace already made it.
 *   suggest   a strong phonetic/fuzzy match, nothing saved. The field is NOT
 *             touched — "Did you mean …?" with Use / Ignore.
 *   remember  the seller corrected a brand that came from voice. One tap turns
 *             that correction into an alias for the whole workspace.
 *
 * Plus the manager itself: `variant="inline"` is the compact panel any member
 * can open from the brand field; `variant="full"` is the same list without the
 * toggle, for the founders' Vocabulary dashboard. NOT a modal — a modal over
 * Step 3 would hide the listing the correction is about.
 */

export type BrandNotice =
  | { kind: 'applied'; heard: string; preferred: string }
  | { kind: 'suggest'; heard: string; preferred: string }
  | { kind: 'remember'; heard: string; preferred: string };

interface Props {
  variant?: 'inline' | 'full';
  /** False when the brand_aliases migration has not been run — renders nothing. */
  available: boolean;
  aliases: BrandAlias[];
  notice?: BrandNotice | null;
  busy?: boolean;
  error?: string | null;
  onDismissNotice?: () => void;
  /** applied → put the heard spelling back. */
  onUndo?: () => void;
  /** suggest → accept the suggested spelling. */
  onUseSuggestion?: (preferred: string) => void;
  onSaveAlias: (heard: string, preferred: string) => void;
  onDeleteAlias: (id: string) => void;
}

const BrandSpelling: React.FC<Props> = ({
  variant = 'inline',
  available,
  aliases,
  notice = null,
  busy = false,
  error = null,
  onDismissNotice,
  onUndo,
  onUseSuggestion,
  onSaveAlias,
  onDeleteAlias,
}) => {
  const [open, setOpen] = useState(variant === 'full');
  const [heard, setHeard] = useState('');
  const [preferred, setPreferred] = useState('');
  // Two-step delete — no confirm() anywhere in this app.
  const [confirmKey, setConfirmKey] = useState<string | null>(null);
  // Inline edit of one row's preferred spelling. Re-saving the same `heard`
  // re-points it, so this is the add form in place rather than a second path.
  const [editId, setEditId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  if (!available) return null;

  const panelOpen = variant === 'full' || open;

  const submit = () => {
    if (!heard.trim() || !preferred.trim()) return;
    onSaveAlias(heard, preferred);
    setHeard('');
    setPreferred('');
  };

  return (
    <div className={`brand-spelling brand-spelling--${variant}`}>
      {notice && (
        <div className={`bs-notice bs-notice--${notice.kind}`} role="status">
          {notice.kind === 'applied' && (
            <>
              <span className="bs-notice-text">
                Corrected “{notice.heard}” &rarr; <strong>{notice.preferred}</strong>
              </span>
              <button type="button" className="bs-link" onClick={onUndo}>
                <Undo2 size={11} style={{ flexShrink: 0 }} /> Undo
              </button>
            </>
          )}
          {notice.kind === 'suggest' && (
            <>
              <span className="bs-notice-text">
                Did you mean <strong>{notice.preferred}</strong>?
              </span>
              <button
                type="button"
                className="bs-link bs-link--primary"
                onClick={() => onUseSuggestion?.(notice.preferred)}
              >
                <Check size={11} style={{ flexShrink: 0 }} /> Use
              </button>
              <button type="button" className="bs-link" onClick={onDismissNotice}>Ignore</button>
            </>
          )}
          {notice.kind === 'remember' && (
            <>
              <span className="bs-notice-text">
                Remember “{notice.heard}” &rarr; <strong>{notice.preferred}</strong> for this workspace?
              </span>
              <button
                type="button"
                className="bs-link bs-link--primary"
                disabled={busy}
                onClick={() => onSaveAlias(notice.heard, notice.preferred)}
              >
                <BookMarked size={11} style={{ flexShrink: 0 }} /> Remember
              </button>
              <button type="button" className="bs-link" onClick={onDismissNotice}>No</button>
            </>
          )}
          {notice.kind !== 'suggest' && notice.kind !== 'remember' && (
            <button
              type="button"
              className="bs-close"
              onClick={onDismissNotice}
              aria-label="Dismiss"
            >
              <X size={10} />
            </button>
          )}
        </div>
      )}

      {variant === 'inline' && (
        <button type="button" className="bs-toggle" onClick={() => setOpen(o => !o)}>
          <BookMarked size={11} style={{ flexShrink: 0 }} />
          Brand spellings{aliases.length ? ` (${aliases.length})` : ''}
        </button>
      )}

      {panelOpen && (
        <div className="bs-panel">
          <p className="bs-hint">
            What the microphone hears &rarr; what to write. Saved for everyone in this workspace.
          </p>

          {error && <p className="bs-error">{error}</p>}

          {aliases.length === 0 && <p className="bs-empty">No spellings saved yet.</p>}

          {aliases.length > 0 && (
            <ul className="bs-list">
              {aliases.map(a => (
                <li key={a.id} className="bs-row">
                  <span className="bs-heard" title={a.heard}>{a.heard}</span>
                  <span className="bs-arrow">&rarr;</span>
                  {editId === a.id ? (
                    <>
                      <input
                        className="bs-input"
                        value={editValue}
                        autoFocus
                        onChange={e => setEditValue(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter' && editValue.trim()) { onSaveAlias(a.heard, editValue); setEditId(null); }
                          if (e.key === 'Escape') setEditId(null);
                        }}
                      />
                      <button
                        type="button"
                        className="bs-link bs-link--primary"
                        disabled={!editValue.trim()}
                        onClick={() => { onSaveAlias(a.heard, editValue); setEditId(null); }}
                      ><Check size={11} /></button>
                      <button type="button" className="bs-link" onClick={() => setEditId(null)}>
                        <X size={11} />
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="bs-preferred" title={a.preferred}>{a.preferred}</span>
                      {confirmKey === a.id ? (
                        <span className="bs-confirm">
                          <button
                            type="button"
                            className="bs-link bs-link--danger"
                            onClick={() => { onDeleteAlias(a.id); setConfirmKey(null); }}
                          >Delete</button>
                          <button type="button" className="bs-link" onClick={() => setConfirmKey(null)}>Keep</button>
                        </span>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="bs-icon-btn"
                            title="Change what this is written as"
                            onClick={() => { setEditId(a.id); setEditValue(a.preferred); setConfirmKey(null); }}
                          >
                            <Pencil size={11} />
                          </button>
                          <button
                            type="button"
                            className="bs-icon-btn"
                            title="Remove this spelling"
                            onClick={() => { setConfirmKey(a.id); setEditId(null); }}
                          >
                            <Trash2 size={11} />
                          </button>
                        </>
                      )}
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}

          <div className="bs-add">
            <input
              className="bs-input"
              value={heard}
              placeholder="heard, e.g. echo unlimited"
              onChange={e => setHeard(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') submit(); }}
            />
            <span className="bs-arrow">&rarr;</span>
            <input
              className="bs-input"
              value={preferred}
              placeholder="write, e.g. Ecko Unltd"
              onChange={e => setPreferred(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') submit(); }}
            />
            <button
              type="button"
              className="bs-add-btn"
              onClick={submit}
              disabled={busy || !heard.trim() || !preferred.trim()}
            >
              <Plus size={11} style={{ flexShrink: 0 }} /> Add
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default BrandSpelling;
