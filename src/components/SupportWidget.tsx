import { useEffect, useMemo, useRef, useState, memo } from 'react';
import { MessageSquare, X, ChevronLeft, Send, CheckCircle2, RotateCcw, Plus } from 'lucide-react';
import {
  isUnread, formatRelative,
  type SupportMessage, type SupportRole, type ThreadStatus,
} from '../lib/supportService';
import { supportActions, useSupportThreads } from '../lib/supportStore';
import './SupportWidget.css';

interface SupportWidgetProps {
  userEmail: string | null;
  orgName: string | null;
  /** Founding Workspace owner/admin → the same button opens the inbox of every conversation. */
  isFounder: boolean;
}

/**
 * The floating "Messages" button (bottom-right) and its panel — first-party
 * support messaging on our own Supabase project, no chat vendor.
 *
 *   user     sees their own conversations, starts new ones, posts as 'user'
 *   founder  sees every conversation (open / closed), replies as 'founder',
 *            closes and reopens threads
 *
 * The thread list, the Realtime subscription and the 45 s polling fallback all
 * live in `supportStore` now, because the full-page MessagesView shows the same
 * conversations: two front ends, ONE channel, ONE timer, ONE list that can
 * never drift. This component owns only what is genuinely local to the panel —
 * whether it is open, which thread is showing, and that thread's messages.
 * Hidden entirely when the migration has not been run (store `available`).
 */
function SupportWidget({ userEmail, orgName, isFounder }: SupportWidgetProps) {
  const role: SupportRole = isFounder ? 'founder' : 'user';
  const { threads, sorted, available, unreadCount, revision } = useSupportThreads(role);
  const [open, setOpen] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [composingNew, setComposingNew] = useState(false);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<ThreadStatus>('open');
  const listEndRef = useRef<HTMLDivElement | null>(null);
  const openRef = useRef(false);

  useEffect(() => { openRef.current = open; }, [open]);

  /* The open conversation's messages. `revision` ticks once per completed
     store refetch (realtime ping or poll), which is exactly when a reply may
     have arrived — so this one effect covers open, poll and live update. */
  useEffect(() => {
    if (!activeId) return;
    let cancelled = false;
    void (async () => {
      const list = await supportActions.loadMessages(activeId);
      if (cancelled) return;
      setMessages(list);
      // Reading it with the panel open is what clears the unread marker.
      if (openRef.current) supportActions.markRead(activeId, role);
    })();
    return () => { cancelled = true; };
  }, [activeId, revision, role]);

  // Keep the newest message in view.
  useEffect(() => {
    if (open) listEndRef.current?.scrollIntoView({ block: 'end' });
  }, [messages, open, activeId]);

  const openCount = useMemo(() => threads.filter(t => t.status === 'open').length, [threads]);
  const active = activeId ? threads.find(t => t.id === activeId) ?? null : null;
  const visibleThreads = isFounder ? sorted.filter(t => t.status === filter) : sorted;

  const openThread = (id: string) => {
    setActiveId(id);
    setComposingNew(false);
    setError(null);
    setMessages([]);   // the effect above loads them
    supportActions.markRead(id, role);
  };

  const backToList = () => {
    setActiveId(null);
    setComposingNew(false);
    setMessages([]);
    setError(null);
  };

  const openPanel = () => {
    setOpen(true);
    // A user with exactly one conversation lands straight in it.
    if (!isFounder && !activeId && !composingNew) {
      if (sorted.length === 1) openThread(sorted[0].id);
      else if (sorted.length === 0) setComposingNew(true);
    }
  };

  const handleSend = async () => {
    const body = draft.trim();
    if (!body || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (activeId) {
        const m = await supportActions.send(activeId, body, role);
        if (!m) {
          setError('Could not send — please try again.');
          return;
        }
        setMessages(prev => [...prev, m]);
        setDraft('');
      } else {
        const r = await supportActions.startThread({ body, userEmail, orgName });
        if (!r.ok) {
          setError(r.error);
          return;
        }
        setActiveId(r.thread.id);
        setComposingNew(false);
        setMessages([r.message]);
        setDraft('');
      }
    } finally {
      setBusy(false);
    }
  };

  const handleStatus = async (status: ThreadStatus) => {
    if (!activeId || busy) return;
    setBusy(true);
    await supportActions.setStatus(activeId, status);
    setBusy(false);
  };

  if (available !== true) return null;

  const showList = !activeId && !composingNew;
  const title = isFounder ? 'Support inbox' : 'Messages';
  const subtitle = active
    ? (isFounder
        ? `${active.user_email ?? 'user'}${active.org_name ? ` · ${active.org_name}` : ''}`
        : 'Arcadian team')
    : (isFounder ? `${openCount} open` : 'We reply here, usually within a day');

  return (
    <div className="sw-root">
      {open && (
        <div className="sw-panel" role="dialog" aria-label={title}>
          <div className="sw-head">
            {!showList && (isFounder || threads.length > 0) && (
              <button className="sw-icon-btn" onClick={backToList} aria-label="Back to conversations">
                <ChevronLeft size={16} />
              </button>
            )}
            <div className="sw-title">
              <strong>{title}</strong>
              <span className="sw-sub">{subtitle}</span>
            </div>
            {isFounder && active && (
              <button
                className="sw-icon-btn"
                disabled={busy}
                title={active.status === 'open' ? 'Close conversation' : 'Reopen conversation'}
                onClick={() => void handleStatus(active.status === 'open' ? 'closed' : 'open')}
              >
                {active.status === 'open' ? <CheckCircle2 size={16} /> : <RotateCcw size={16} />}
              </button>
            )}
            {!isFounder && activeId && (
              <button className="sw-icon-btn" title="New conversation" onClick={() => { setActiveId(null); setMessages([]); setComposingNew(true); }}>
                <Plus size={16} />
              </button>
            )}
            <button className="sw-icon-btn" onClick={() => setOpen(false)} aria-label="Close"><X size={16} /></button>
          </div>

          {showList ? (
            <div className="sw-list">
              {isFounder && (
                <div className="sw-filter">
                  <button className={`sw-chip ${filter === 'open' ? 'sw-chip--on' : ''}`} onClick={() => setFilter('open')}>
                    Open {openCount}
                  </button>
                  <button className={`sw-chip ${filter === 'closed' ? 'sw-chip--on' : ''}`} onClick={() => setFilter('closed')}>
                    Closed {threads.length - openCount}
                  </button>
                </div>
              )}
              {visibleThreads.length === 0 && (
                <p className="sw-empty">
                  {isFounder ? 'Nothing here.' : 'No conversations yet. Say hello — we read everything.'}
                </p>
              )}
              {visibleThreads.map(t => (
                <button
                  key={t.id}
                  className={`sw-thread ${isUnread(t, role) ? 'sw-thread--unread' : ''}`}
                  onClick={() => openThread(t.id)}
                >
                  <span className="sw-thread-top">
                    <span className="sw-thread-who">{isFounder ? (t.user_email ?? 'user') : (t.subject || 'Conversation')}</span>
                    <span className="sw-thread-when">{formatRelative(t.last_message_at)}</span>
                  </span>
                  <span className="sw-thread-preview">
                    {isFounder && t.org_name ? `${t.org_name} · ` : ''}
                    {t.last_sender_role === role ? 'You: ' : ''}
                    {t.last_message_preview ?? ''}
                  </span>
                </button>
              ))}
              {!isFounder && (
                <button className="sw-new" onClick={() => setComposingNew(true)}>
                  <Plus size={14} /> New conversation
                </button>
              )}
            </div>
          ) : (
            <>
              <div className="sw-messages">
                {composingNew && messages.length === 0 && (
                  <p className="sw-empty">What can we help with? Include as much detail as you like.</p>
                )}
                {messages.map(m => {
                  const mine = m.sender_role === role;
                  const who = mine ? 'You' : m.sender_role === 'founder' ? 'Arcadian' : (active?.user_email ?? 'User');
                  return (
                    <div key={m.id} className={`sw-msg ${mine ? 'sw-msg--mine' : ''}`}>
                      <div className="sw-bubble">{m.body}</div>
                      <span className="sw-stamp">{who} · {formatRelative(m.created_at)}</span>
                    </div>
                  );
                })}
                {active?.status === 'closed' && (
                  <p className="sw-empty">This conversation is closed{isFounder ? '.' : ' — sending a message reopens it.'}</p>
                )}
                <div ref={listEndRef} />
              </div>
              {error && <p className="sw-error">{error}</p>}
              <div className="sw-composer">
                <textarea
                  value={draft}
                  onChange={e => setDraft(e.target.value)}
                  placeholder={isFounder ? 'Reply…' : 'Write a message…'}
                  rows={2}
                  maxLength={4000}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void handleSend();
                    }
                  }}
                />
                <button className="sw-send" disabled={busy || !draft.trim()} onClick={() => void handleSend()} aria-label="Send">
                  <Send size={15} />
                </button>
              </div>
            </>
          )}
        </div>
      )}

      <button
        className={`sw-fab ${open ? 'sw-fab--open' : ''}`}
        onClick={() => (open ? setOpen(false) : openPanel())}
        aria-label={title}
        aria-expanded={open}
      >
        <MessageSquare size={18} />
        <span>{isFounder ? 'Inbox' : 'Messages'}</span>
        {unreadCount > 0 && <span className="sw-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>}
      </button>
    </div>
  );
}

/* Memoized (perf finding F2). Steps 1-4 all mount at once and App re-renders on
 * any store/UI change, so without this a Step-3 keystroke re-rendered this whole
 * subtree. Every prop App passes is now referentially stable (see the
 * `useEventCallback` block in App.tsx), so the default shallow compare bails out
 * on renders that have nothing to do with this component. */
/* SupportWidget is mounted unconditionally for every signed-in user and takes only
 * primitive props, so this memo is free. */
export default memo(SupportWidget);
