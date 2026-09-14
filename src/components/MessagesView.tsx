import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronLeft, CheckCircle2, RotateCcw, Search, Send, MessageSquare, Plus, Inbox,
} from 'lucide-react';
import {
  formatRelative, isUnread,
  type SupportMessage, type SupportRole, type SupportThread, type ThreadStatus,
} from '../lib/supportService';
import { filterThreads, supportActions, useSupportThreads } from '../lib/supportStore';
import { Button, EmptyState } from './ui';
import './MessagesView.css';

export interface MessagesViewProps {
  userEmail: string | null;
  orgName: string | null;
  /** Founding Workspace owner/admin — the same page becomes the inbox of every
   *  conversation, with the Open/Closed chips and Close/Reopen. Same flag App
   *  already computes for the floating widget, so the two never disagree. */
  isFounder: boolean;
}

type ChipFilter = ThreadStatus | 'all';

/** Who wrote a message, from the reader's point of view. */
function senderName(m: SupportMessage, role: SupportRole, thread: SupportThread | null): string {
  if (m.sender_role === role) return 'You';
  return m.sender_role === 'founder' ? 'Arcadian' : (thread?.user_email ?? 'User');
}

/**
 * The full-page Messages view — "i like the inbox window but also want new
 * messages view i can access".
 *
 * The floating SupportWidget is untouched and still does what it did; this is
 * the same conversations with room to work: a searchable thread list beside a
 * full-height conversation, keyboard navigation, and the founder's Open/Closed
 * triage. Both front ends read ONE list from `supportStore`, which owns the
 * single Realtime subscription and the single poll timer — send from the widget
 * and this page updates, and vice versa, with no second channel.
 *
 * Rendered inside ToolView (App supplies the title: "Inbox" for founders,
 * "Messages" for everyone else), so spacing follows the shell's scale.
 */
export default function MessagesView({ userEmail, orgName, isFounder }: MessagesViewProps) {
  const role: SupportRole = isFounder ? 'founder' : 'user';
  const { threads, sorted, available, revision } = useSupportThreads(role);

  const [activeId, setActiveId] = useState<string | null>(null);
  const [composingNew, setComposingNew] = useState(false);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [subject, setSubject] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [chip, setChip] = useState<ChipFilter>('open');

  const listRef = useRef<HTMLDivElement>(null);
  const msgsRef = useRef<HTMLDivElement>(null);

  const visible = useMemo(
    () => filterThreads(sorted, { query, status: isFounder ? chip : 'all' }),
    [sorted, query, chip, isFounder],
  );
  const openCount = useMemo(() => threads.filter(t => t.status === 'open').length, [threads]);
  const active = activeId ? threads.find(t => t.id === activeId) ?? null : null;

  /* The open conversation's messages. `revision` ticks once per completed store
     refetch (Realtime ping or the 45 s poll), so this single effect covers
     opening a thread, a reply arriving, and a send reconciling. */
  useEffect(() => {
    if (!activeId) return;
    let cancelled = false;
    void (async () => {
      const list = await supportActions.loadMessages(activeId);
      if (cancelled) return;
      setMessages(list);
      // Looking at a conversation is what marks it read for my role — the same
      // rule the widget uses, and a no-op when it was already read.
      supportActions.markRead(activeId, role);
    })();
    return () => { cancelled = true; };
  }, [activeId, revision, role]);

  // Newest message in view. Scrolling the container directly, not
  // `scrollIntoView`, so a full page never jumps under the reader.
  useEffect(() => {
    const el = msgsRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, activeId, composingNew]);

  /* NOTE: a search or a chip change can filter the open conversation out of
     the list. It deliberately stays open — `active` is looked up in the full
     thread list, not the filtered one. Clearing it would mean a setState
     inside an effect (react-hooks v7 forbids it) AND would throw away what the
     reader was in the middle of. */

  const selectThread = (id: string) => {
    setActiveId(id);
    setComposingNew(false);
    setError(null);
    setMessages([]);
  };

  const backToList = () => {
    setActiveId(null);
    setComposingNew(false);
    setMessages([]);
    setError(null);
  };

  const startNew = () => {
    setActiveId(null);
    setMessages([]);
    setError(null);
    setSubject('');
    setComposingNew(true);
  };

  /** Up/Down walk the list while focus is inside it. */
  const onListKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    if (visible.length === 0) return;
    e.preventDefault();
    const ids = visible.map(t => t.id);
    const focusedId = (document.activeElement as HTMLElement | null)?.dataset.threadId ?? activeId;
    const at = focusedId ? ids.indexOf(focusedId) : -1;
    const step = e.key === 'ArrowDown' ? 1 : -1;
    const next = at === -1
      ? (step === 1 ? 0 : ids.length - 1)
      : Math.min(ids.length - 1, Math.max(0, at + step));
    selectThread(ids[next]);
    listRef.current
      ?.querySelector<HTMLElement>(`[data-thread-id="${CSS.escape(ids[next])}"]`)
      ?.focus();
  };

  const send = async () => {
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
        const r = await supportActions.startThread({ body, subject, userEmail, orgName });
        if (!r.ok) {
          setError(r.error);
          return;
        }
        setActiveId(r.thread.id);
        setComposingNew(false);
        setMessages([r.message]);
        setDraft('');
        setSubject('');
      }
    } finally {
      setBusy(false);
    }
  };

  const setStatus = async (status: ThreadStatus) => {
    if (!activeId || busy) return;
    setBusy(true);
    const ok = await supportActions.setStatus(activeId, status);
    if (!ok) setError('Could not change the status — please try again.');
    setBusy(false);
  };

  if (available === null) {
    return <p className="mv-loading">Loading conversations…</p>;
  }

  if (available === false) {
    return (
      <EmptyState
        icon={<MessageSquare />}
        title="Messaging isn’t available"
        description="The support tables haven’t been created in this project yet, so there is nothing to show. Once the migration is run, your conversations appear here."
      />
    );
  }

  const showConversation = !!activeId || composingNew;
  const closed = active?.status === 'closed';

  return (
    <div className="mv" data-open={showConversation ? 'true' : 'false'}>
      {/* ── Thread list ─────────────────────────────────────────────────── */}
      <aside className="mv-list" aria-label="Conversations">
        <div className="mv-list-head">
          <div className="mv-search">
            <Search size={15} aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={isFounder ? 'Search email, workspace, subject…' : 'Search your conversations'}
              aria-label="Search conversations"
            />
          </div>
          {isFounder && (
            <div className="mv-chips" role="group" aria-label="Filter by status">
              {([
                ['open', `Open ${openCount}`],
                ['closed', `Closed ${threads.length - openCount}`],
                ['all', `All ${threads.length}`],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={`mv-chip${chip === value ? ' mv-chip--on' : ''}`}
                  aria-pressed={chip === value}
                  onClick={() => setChip(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="mv-threads" ref={listRef} onKeyDown={onListKeyDown}>
          {visible.length === 0 ? (
            <EmptyState
              inline
              icon={<Inbox />}
              title={query ? 'Nothing matches' : isFounder ? 'Nothing here' : 'No conversations yet'}
              description={
                query
                  ? 'Try a different search.'
                  : isFounder
                    ? 'No conversations with this status.'
                    : 'Start one below — we read everything.'
              }
            />
          ) : visible.map(t => {
            const unread = isUnread(t, role);
            return (
              <button
                key={t.id}
                type="button"
                data-thread-id={t.id}
                className={`mv-thread${t.id === activeId ? ' mv-thread--on' : ''}${unread ? ' mv-thread--unread' : ''}`}
                aria-current={t.id === activeId ? 'true' : undefined}
                onClick={() => selectThread(t.id)}
              >
                <span className="mv-thread-top">
                  <span className="mv-thread-who">
                    {unread && <span className="mv-dot" aria-hidden="true" />}
                    {/* The label is its own element: ellipsis does not apply to
                        a bare text node inside a flex container. */}
                    <span className="mv-thread-label">
                      {isFounder ? (t.user_email ?? 'user') : (t.subject || 'Conversation')}
                    </span>
                    {unread && <span className="mv-sr"> (unread)</span>}
                  </span>
                  <span className="mv-thread-when">{formatRelative(t.last_message_at)}</span>
                </span>
                <span className="mv-thread-preview">
                  {isFounder && t.org_name ? `${t.org_name} · ` : ''}
                  {t.last_sender_role === role ? 'You: ' : ''}
                  {t.last_message_preview ?? ''}
                </span>
                {t.status === 'closed' && <span className="mv-thread-closed">Closed</span>}
              </button>
            );
          })}
        </div>

        {!isFounder && (
          <div className="mv-list-foot">
            <Button variant="secondary" fullWidth icon={<Plus size={15} />} onClick={startNew}>
              New conversation
            </Button>
          </div>
        )}
      </aside>

      {/* ── Conversation ────────────────────────────────────────────────── */}
      <section className="mv-conv" aria-label="Conversation">
        {!showConversation ? (
          <EmptyState
            icon={<MessageSquare />}
            title={isFounder ? 'Pick a conversation' : 'Nothing open'}
            description={
              isFounder
                ? 'Choose a conversation on the left to read it and reply.'
                : 'Open one of your conversations, or start a new one.'
            }
            actions={!isFounder
              ? <Button variant="primary" icon={<Plus size={15} />} onClick={startNew}>New conversation</Button>
              : undefined}
          />
        ) : (
          <>
            <header className="mv-conv-head">
              <button type="button" className="mv-back" onClick={backToList}>
                <ChevronLeft size={15} /> All conversations
              </button>
              <div className="mv-conv-who">
                <strong>
                  {composingNew
                    ? 'New conversation'
                    : isFounder
                      ? (active?.user_email ?? 'user')
                      : (active?.subject || 'Arcadian team')}
                </strong>
                <span className="mv-conv-meta">
                  {composingNew
                    ? 'We reply here, usually within a day.'
                    : isFounder
                      ? [active?.org_name, active?.status === 'closed' ? 'closed' : 'open'].filter(Boolean).join(' · ')
                      : `Arcadian team${closed ? ' · closed' : ''}`}
                </span>
              </div>
              {isFounder && active && (
                <Button
                  variant="secondary"
                  disabled={busy}
                  icon={closed ? <RotateCcw size={15} /> : <CheckCircle2 size={15} />}
                  onClick={() => void setStatus(closed ? 'open' : 'closed')}
                >
                  {closed ? 'Reopen' : 'Close'}
                </Button>
              )}
              {!isFounder && !composingNew && (
                <Button variant="secondary" icon={<Plus size={15} />} onClick={startNew}>
                  New
                </Button>
              )}
            </header>

            <div className="mv-msgs" ref={msgsRef}>
              {composingNew && messages.length === 0 && (
                <p className="mv-note">What can we help with? Include as much detail as you like — screenshots can follow in a reply.</p>
              )}
              {messages.map(m => {
                const mine = m.sender_role === role;
                return (
                  <div key={m.id} className={`mv-msg${mine ? ' mv-msg--mine' : ''}`}>
                    <div className="mv-bubble">{m.body}</div>
                    <span className="mv-stamp">{senderName(m, role, active)} · {formatRelative(m.created_at)}</span>
                  </div>
                );
              })}
              {closed && (
                <p className="mv-note">
                  This conversation is closed{isFounder ? '.' : ' — sending a message reopens it.'}
                </p>
              )}
            </div>

            {error && <p className="mv-error" role="status">{error}</p>}

            <div className="mv-composer">
              {composingNew && (
                <input
                  className="mv-subject"
                  value={subject}
                  onChange={e => setSubject(e.target.value)}
                  placeholder="Subject (optional)"
                  maxLength={140}
                  aria-label="Subject"
                />
              )}
              <div className="mv-composer-row">
                <textarea
                  value={draft}
                  onChange={e => setDraft(e.target.value)}
                  placeholder={isFounder ? 'Reply…' : 'Write a message…'}
                  rows={3}
                  maxLength={4000}
                  aria-label="Message"
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void send();
                    }
                  }}
                />
                <Button
                  variant="primary"
                  loading={busy}
                  disabled={!draft.trim()}
                  icon={<Send size={15} />}
                  onClick={() => void send()}
                >
                  Send
                </Button>
              </div>
              <p className="mv-hint">Enter sends · Shift + Enter starts a new line</p>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
