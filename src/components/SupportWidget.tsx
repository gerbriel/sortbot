import { useCallback, useEffect, useMemo, useRef, useState, memo } from 'react';
import { MessageSquare, X, ChevronLeft, Send, CheckCircle2, RotateCcw, Plus } from 'lucide-react';
import {
  fetchThreads, fetchMessages, sendMessage, createThread, markThreadRead, setThreadStatus,
  subscribeToSupport, isUnread, unreadThreadCount, sortThreads, formatRelative,
  type SupportThread, type SupportMessage, type SupportRole, type ThreadStatus,
} from '../lib/supportService';
import { log } from '../lib/debugLogger';
import './SupportWidget.css';

interface SupportWidgetProps {
  userId: string;
  userEmail: string | null;
  orgName: string | null;
  /** Founding Workspace owner/admin → the same button opens the inbox of every conversation. */
  isFounder: boolean;
}

const POLL_MS = 45_000;

/**
 * The floating "Messages" button (bottom-right) and its panel — first-party
 * support messaging on our own Supabase project, no chat vendor.
 *
 *   user     sees their own conversations, starts new ones, posts as 'user'
 *   founder  sees every conversation (open / closed), replies as 'founder',
 *            closes and reopens threads
 *
 * Live updates come from Supabase Realtime (postgres_changes on the two
 * tables) with a 45 s poll as the fallback, so it keeps working even when
 * realtime is not enabled for the tables. Hidden entirely when the migration
 * has not been run (fetchThreads → 'unavailable').
 */
function SupportWidget({ userId, userEmail, orgName, isFounder }: SupportWidgetProps) {
  const role: SupportRole = isFounder ? 'founder' : 'user';
  const [available, setAvailable] = useState<boolean | null>(null);
  const [open, setOpen] = useState(false);
  const [threads, setThreads] = useState<SupportThread[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [composingNew, setComposingNew] = useState(false);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<ThreadStatus>('open');
  const listEndRef = useRef<HTMLDivElement | null>(null);
  const activeIdRef = useRef<string | null>(null);
  const openRef = useRef(false);

  useEffect(() => { activeIdRef.current = activeId; }, [activeId]);
  useEffect(() => { openRef.current = open; }, [open]);

  /** Stamp my read marker on a thread that is unread for me (local + DB). */
  const markReadIfNeeded = useCallback((list: SupportThread[], id: string | null) => {
    if (!id) return;
    const t = list.find(x => x.id === id);
    if (!t || !isUnread(t, role)) return;
    const stamp = new Date().toISOString();
    const key = role === 'user' ? 'user_last_read_at' : 'founder_last_read_at';
    setThreads(prev => prev.map(x => (x.id === id ? { ...x, [key]: stamp } : x)));
    void markThreadRead(id, role);
  }, [role]);

  const loadThreads = useCallback(async (): Promise<SupportThread[] | null> => {
    const r = await fetchThreads();
    if (r.status === 'unavailable') {
      setAvailable(false);
      return null;
    }
    setAvailable(true);
    setThreads(r.threads);
    return r.threads;
  }, []);

  const loadMessages = useCallback(async (threadId: string) => {
    setMessages(await fetchMessages(threadId));
  }, []);

  // Initial load, live updates, polling fallback.
  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      const list = await loadThreads();
      if (cancelled || !list) return;
      const id = activeIdRef.current;
      if (id) {
        await loadMessages(id);
        if (openRef.current) markReadIfNeeded(list, id);
      }
    };
    void refresh();
    const unsub = subscribeToSupport(() => { void refresh(); });
    const timer = window.setInterval(() => { void refresh(); }, POLL_MS);
    return () => {
      cancelled = true;
      unsub();
      window.clearInterval(timer);
    };
  }, [loadThreads, loadMessages, markReadIfNeeded, userId]);

  // Keep the newest message in view.
  useEffect(() => {
    if (open) listEndRef.current?.scrollIntoView({ block: 'end' });
  }, [messages, open, activeId]);

  const sorted = useMemo(() => sortThreads(threads, role), [threads, role]);
  const unread = useMemo(() => unreadThreadCount(threads, role), [threads, role]);
  const openCount = useMemo(() => threads.filter(t => t.status === 'open').length, [threads]);
  const active = activeId ? threads.find(t => t.id === activeId) ?? null : null;
  const visibleThreads = isFounder ? sorted.filter(t => t.status === filter) : sorted;

  const openThread = (id: string) => {
    setActiveId(id);
    setComposingNew(false);
    setError(null);
    setMessages([]);
    void loadMessages(id);
    markReadIfNeeded(threads, id);
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
        const m = await sendMessage(activeId, body, role);
        if (!m) {
          setError('Could not send — please try again.');
          return;
        }
        setMessages(prev => [...prev, m]);
        setDraft('');
        void loadThreads();
      } else {
        const r = await createThread({ body, userEmail, orgName });
        if (!r.ok) {
          setError(r.error);
          return;
        }
        setThreads(prev => [r.thread, ...prev]);
        setActiveId(r.thread.id);
        setComposingNew(false);
        setMessages([r.message]);
        setDraft('');
        void loadThreads();
      }
      log.app(`support | message sent as ${role}`);
    } finally {
      setBusy(false);
    }
  };

  const handleStatus = async (status: ThreadStatus) => {
    if (!activeId || busy) return;
    setBusy(true);
    const ok = await setThreadStatus(activeId, status);
    if (ok) setThreads(prev => prev.map(t => (t.id === activeId ? { ...t, status } : t)));
    setBusy(false);
  };

  if (available !== true) return null;

  const showList = !activeId && !composingNew;
  const title = isFounder ? 'Support inbox' : 'Messages';
  const subtitle = active
    ? (isFounder
        ? `${active.user_email ?? 'user'}${active.org_name ? ` · ${active.org_name}` : ''}`
        : 'Acadia team')
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
                  const who = mine ? 'You' : m.sender_role === 'founder' ? 'Acadia' : (active?.user_email ?? 'User');
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
        {unread > 0 && <span className="sw-badge">{unread > 99 ? '99+' : unread}</span>}
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
