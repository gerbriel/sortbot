import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, Plus, Search, ChevronDown, ChevronRight, Trash2, Send, X } from 'lucide-react';
import {
  fetchCrmContacts, syncCrmContacts, createCrmContact, updateCrmContact, deleteCrmContact,
  fetchCrmNotes, addCrmNote, deleteCrmNote,
  filterContacts, sortContacts, stageCounts, followUpStatus, parseTags, todayKey,
  CRM_STAGES, CRM_STAGE_LABEL,
  type CrmContact, type CrmNote, type CrmStage, type CrmContactPatch, type CrmContactsResult,
} from '../lib/crmService';

const RENDER_CAP = 100;

interface CrmLoad {
  note: string | null;
  result: CrmContactsResult;
}

/** Optional sync, then the contact list. No React state here — callers apply it. */
async function loadCrm(withSync: boolean): Promise<CrmLoad> {
  let note: string | null = null;
  if (withSync) {
    const s = await syncCrmContacts();
    note = s.status === 'ok' ? `${s.inserted} new · ${s.updated} refreshed` : null;
  }
  return { note, result: await fetchCrmContacts() };
}
const SOURCE_LABEL: Record<CrmContact['source'], string> = { manual: 'manual', beta_signup: 'beta request', account: 'account' };

const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : null;

/**
 * First-party CRM (Founding admins): every beta request and account (with its
 * workspace) becomes a contact automatically via `crm_sync_contacts()`; admins
 * add stage, tags, a follow-up date and notes by hand. Nothing external.
 */
export default function CrmPanel() {
  const [state, setState] = useState<'loading' | 'ok' | 'unavailable'>('loading');
  const [contacts, setContacts] = useState<CrmContact[]>([]);
  const [stage, setStage] = useState<CrmStage | 'all'>('all');
  const [onlyDue, setOnlyDue] = useState(false);
  const [query, setQuery] = useState('');
  const [syncing, setSyncing] = useState(true); // the first load always syncs
  const [syncNote, setSyncNote] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [newName, setNewName] = useState('');
  const [newCompany, setNewCompany] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, CrmNote[]>>({});
  const [noteDraft, setNoteDraft] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const today = todayKey();

  // Sync + fetch as a promise; state is applied only in .then callbacks so the
  // mount effect never sets state synchronously (react-hooks/set-state-in-effect).
  const applyLoad = useCallback(({ note, result }: CrmLoad) => {
    setSyncing(false);
    if (result.status === 'unavailable') {
      setState('unavailable');
      return;
    }
    setContacts(result.contacts);
    setState('ok');
    setSyncNote(note);
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadCrm(true).then(x => { if (!cancelled) applyLoad(x); });
    return () => { cancelled = true; };
  }, [applyLoad]);

  const handleSync = () => {
    if (syncing) return;
    setSyncing(true);
    setSyncNote(null);
    loadCrm(true).then(applyLoad);
  };

  const counts = useMemo(() => stageCounts(contacts), [contacts]);
  const dueCount = useMemo(
    () => contacts.filter(c => { const s = followUpStatus(c.next_follow_up, today); return s === 'overdue' || s === 'today'; }).length,
    [contacts, today],
  );
  const visible = useMemo(() => {
    const base = onlyDue
      ? contacts.filter(c => { const s = followUpStatus(c.next_follow_up, today); return s === 'overdue' || s === 'today'; })
      : contacts;
    return sortContacts(filterContacts(base, { stage, query }), today);
  }, [contacts, stage, query, onlyDue, today]);

  const patch = async (id: string, p: CrmContactPatch) => {
    const updated = await updateCrmContact(id, p);
    if (updated) setContacts(prev => prev.map(c => (c.id === id ? updated : c)));
  };

  const toggleExpand = async (id: string) => {
    if (expandedId === id) { setExpandedId(null); return; }
    setExpandedId(id);
    setNoteDraft('');
    setConfirmDelete(null);
    if (!notes[id]) {
      const rows = await fetchCrmNotes(id);
      setNotes(prev => ({ ...prev, [id]: rows }));
    }
  };

  const handleAdd = async () => {
    if (busy) return;
    setBusy(true);
    setAddError(null);
    const r = await createCrmContact({ email: newEmail, name: newName, company: newCompany });
    setBusy(false);
    if (!r.ok) { setAddError(r.error); return; }
    setContacts(prev => [r.contact, ...prev]);
    setNewEmail(''); setNewName(''); setNewCompany('');
    setAdding(false);
  };

  const handleAddNote = async (contactId: string) => {
    if (busy || !noteDraft.trim()) return;
    setBusy(true);
    const n = await addCrmNote(contactId, noteDraft);
    setBusy(false);
    if (!n) return;
    setNotes(prev => ({ ...prev, [contactId]: [n, ...(prev[contactId] ?? [])] }));
    setNoteDraft('');
  };

  const handleDeleteNote = async (contactId: string, noteId: string) => {
    if (await deleteCrmNote(noteId)) {
      setNotes(prev => ({ ...prev, [contactId]: (prev[contactId] ?? []).filter(n => n.id !== noteId) }));
    }
  };

  const handleDelete = async (id: string) => {
    if (busy) return;
    setBusy(true);
    const ok = await deleteCrmContact(id);
    setBusy(false);
    if (ok) {
      setContacts(prev => prev.filter(c => c.id !== id));
      if (expandedId === id) setExpandedId(null);
    }
    setConfirmDelete(null);
  };

  if (state === 'unavailable') {
    return (
      <section className="ft-card">
        <p className="ft-setup">
          The CRM is not set up yet — run <code>supabase/migrations/crm.sql</code> in the SQL Editor.
          Contacts are then built from beta requests and accounts automatically; nothing leaves this project.
        </p>
      </section>
    );
  }

  return (
    <section className="ft-card">
      <div className="ft-toolbar">
        <div className="ft-chips">
          {(['all', ...CRM_STAGES] as const).map(s => (
            <button key={s} className={`beta-chip ${stage === s ? 'beta-chip--active' : ''}`} onClick={() => setStage(s)}>
              {s === 'all' ? `All ${counts.all}` : `${CRM_STAGE_LABEL[s]} ${counts[s]}`}
            </button>
          ))}
          {dueCount > 0 && (
            <button className={`beta-chip crm-chip-due ${onlyDue ? 'beta-chip--active' : ''}`} onClick={() => setOnlyDue(v => !v)}>
              Due {dueCount}
            </button>
          )}
        </div>
        <div className="beta-search">
          <Search size={13} />
          <input placeholder="Search name, email, company, tag" value={query} onChange={e => setQuery(e.target.value)} />
        </div>
        <button className="org-icon-btn" title="Sync from beta requests + accounts" disabled={syncing} onClick={handleSync}>
          <RefreshCw size={13} className={syncing ? 'ft-spin' : ''} />
        </button>
        <button className="org-icon-btn" title="Add contact" onClick={() => { setAdding(v => !v); setAddError(null); }}>
          {adding ? <X size={13} /> : <Plus size={13} />}
        </button>
      </div>
      {syncNote && <p className="ft-result">Synced: {syncNote}</p>}

      {adding && (
        <div className="org-invite-form crm-add">
          <input placeholder="email@shop.com" value={newEmail} onChange={e => setNewEmail(e.target.value)} />
          <input placeholder="Name" value={newName} onChange={e => setNewName(e.target.value)} />
          <input placeholder="Shop / company" value={newCompany} onChange={e => setNewCompany(e.target.value)} />
          <button className="org-invite-btn" disabled={busy || !newEmail.trim()} onClick={() => void handleAdd()}>Add</button>
          {addError && <span className="ft-error">{addError}</span>}
        </div>
      )}

      {state === 'loading' && <p className="org-panel-loading">Loading contacts…</p>}
      {state === 'ok' && contacts.length === 0 && (
        <p className="ft-help">No contacts yet. Beta requests and new accounts appear here automatically; use + to add one by hand.</p>
      )}
      {state === 'ok' && contacts.length > 0 && visible.length === 0 && <p className="org-panel-loading">Nothing matches this filter.</p>}

      <ul className="org-member-list">
        {visible.slice(0, RENDER_CAP).map(c => {
          const fu = followUpStatus(c.next_follow_up, today);
          const expanded = expandedId === c.id;
          return (
            <li key={c.id} className={`org-member-row crm-row ${expanded ? 'crm-row--open' : ''}`}>
              <div className="crm-head">
                <button className="org-member-toggle" onClick={() => void toggleExpand(c.id)} aria-label={expanded ? 'Collapse' : 'Expand'}>
                  {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                </button>
                <div className="crm-id" onClick={() => void toggleExpand(c.id)}>
                  <span className="crm-name">{c.name || c.email}</span>
                  <span className="crm-meta">
                    {c.name ? `${c.email} · ` : ''}{c.company || 'no company'}
                    <span className="crm-source">{SOURCE_LABEL[c.source]}</span>
                    {c.tags.map(t => <span key={t} className="crm-tag">{t}</span>)}
                  </span>
                </div>
                <select className="org-role-select crm-stage" value={c.stage} onChange={e => void patch(c.id, { stage: e.target.value as CrmStage })} title="Stage">
                  {CRM_STAGES.map(s => <option key={s} value={s}>{CRM_STAGE_LABEL[s]}</option>)}
                </select>
                <input
                  type="date"
                  className={`crm-date ${fu ? `crm-date--${fu}` : ''}`}
                  value={c.next_follow_up ?? ''}
                  onChange={e => void patch(c.id, { next_follow_up: e.target.value || null })}
                  title={fu ? `Follow-up ${fu}` : 'Next follow-up'}
                />
              </div>

              {expanded && (
                <div className="crm-detail" key={c.updated_at}>
                  <div className="crm-fields">
                    <label>Name
                      <input defaultValue={c.name ?? ''} onBlur={e => { const v = e.target.value.trim() || null; if (v !== c.name) void patch(c.id, { name: v }); }} />
                    </label>
                    <label>Company
                      <input defaultValue={c.company ?? ''} onBlur={e => { const v = e.target.value.trim() || null; if (v !== c.company) void patch(c.id, { company: v }); }} />
                    </label>
                    <label>Tags
                      <input defaultValue={c.tags.join(', ')} placeholder="comma separated"
                        onBlur={e => { const v = parseTags(e.target.value); if (v.join('|') !== c.tags.join('|')) void patch(c.id, { tags: v }); }} />
                    </label>
                  </div>
                  <p className="crm-stats">
                    {c.last_seen_at ? `Last seen ${fmtDate(c.last_seen_at)} · ` : ''}
                    Added {fmtDate(c.created_at)}{c.org_id ? ' · has a workspace' : ''}
                    {' · '}<a className="beta-email-link" href={`mailto:${c.email}`}>email</a>
                  </p>

                  <div className="crm-notes">
                    {(notes[c.id] ?? []).map(n => (
                      <div key={n.id} className="crm-note">
                        <span className="crm-note-body">{n.body}</span>
                        <span className="crm-note-meta">
                          {n.author_email ?? 'you'} · {fmtDate(n.created_at)}
                          <button className="org-icon-btn org-icon-danger" title="Delete note" onClick={() => void handleDeleteNote(c.id, n.id)}><Trash2 size={11} /></button>
                        </span>
                      </div>
                    ))}
                    <div className="crm-note-add">
                      <textarea rows={2} placeholder="Add a note…" value={noteDraft} onChange={e => setNoteDraft(e.target.value)} maxLength={4000} />
                      <button className="org-invite-btn" disabled={busy || !noteDraft.trim()} onClick={() => void handleAddNote(c.id)} aria-label="Save note"><Send size={13} /></button>
                    </div>
                  </div>

                  <div className="crm-danger">
                    {confirmDelete === c.id ? (
                      <span className="org-confirm-actions">
                        <button className="org-confirm-yes" disabled={busy} onClick={() => void handleDelete(c.id)}>Delete contact</button>
                        <button className="org-confirm-no" disabled={busy} onClick={() => setConfirmDelete(null)}>Cancel</button>
                      </span>
                    ) : (
                      <button className="org-leave-btn" onClick={() => setConfirmDelete(c.id)}><Trash2 size={12} /> Delete contact</button>
                    )}
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {visible.length > RENDER_CAP && (
        <p className="org-panel-loading">Showing the first {RENDER_CAP} of {visible.length} — search to narrow it down.</p>
      )}
    </section>
  );
}
