import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronLeft, CheckCircle2, RotateCcw, Search, Send, MessageSquare, Plus, Inbox, LifeBuoy, Users,
} from 'lucide-react';
import {
  formatRelative, isUnread, messageRole, participantLabel,
  type SupportMessage, type SupportRole, type SupportThread, type ThreadKind, type ThreadStatus,
} from '../lib/supportService';
import { filterThreads, supportActions, useSupportThreads } from '../lib/supportStore';
import { fetchOrgMembers, type OrgMemberRow } from '../lib/orgService';
import { Button, EmptyState } from './ui';
import './MessagesView.css';

export interface MessagesViewProps {
  userEmail: string | null;
  orgName: string | null;
  /** My auth user id. Team unread is "the last message is not mine, and it is
   *  newer than my own participant row", so it is not computable without it. */
  userId: string;
  /** The workspace whose members can be added to a team conversation. */
  orgId: string | null;
  /** Founding Workspace owner/admin — the same page becomes the inbox of every
   *  SUPPORT conversation, with the Open/Closed chips and Close/Reopen. Same
   *  flag App already computes for the floating widget, so the two never
   *  disagree. It grants nothing on a team thread: there a founder is an
   *  ordinary participant of their own workspace, or not in it at all. */
  isFounder: boolean;
}

type ChipFilter = ThreadStatus | 'all';
type KindFilter = ThreadKind | 'all';

/** Who wrote a message, from the reader's point of view. */
function senderName(m: SupportMessage, myUserId: string, thread: SupportThread | null): string {
  if (m.sender_id === myUserId) return 'You';
  if (thread?.kind === 'team') {
    return thread.members.find(p => p.user_id === m.sender_id)?.email ?? 'Teammate';
  }
  return m.sender_role === 'founder' ? 'Arcadian' : (thread?.user_email ?? 'User');
}

/**
 * The full-page Messages view — "i like the inbox window but also want new
 * messages view i can access".
 *
 * The floating SupportWidget is untouched and still does what it did (support
 * conversations only); this is the same conversations with room to work, PLUS
 * the second kind: team threads with people in your own workspace. A searchable
 * list beside a full-height conversation, keyboard navigation, the founder's
 * Open/Closed triage, and one compose panel that starts either kind.
 *
 * Both front ends read ONE list from `supportStore`, which owns the single
 * Realtime subscription and the single poll timer — send from the widget and
 * this page updates, and vice versa, with no second channel.
 *
 * Rendered inside ToolView (App supplies the title: "Inbox" for founders,
 * "Messages" for everyone else), so spacing follows the shell's scale.
 */
export default function MessagesView({ userEmail, orgName, userId, orgId, isFounder }: MessagesViewProps) {
  const role: SupportRole = isFounder ? 'founder' : 'user';
  const { threads, sorted, available, teamAvailable, revision } = useSupportThreads(role, userId);

  const [activeId, setActiveId] = useState<string | null>(null);
  const [composingNew, setComposingNew] = useState(false);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [subject, setSubject] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [chip, setChip] = useState<ChipFilter>('open');
  const [kindChip, setKindChip] = useState<KindFilter>('all');

  /* Compose state: who the new conversation is for. `toSupport` and `picked`
     are mutually exclusive — a message either goes to the support desk or to
     named teammates, never both, because they are different tables' worth of
     rules and a mixed thread has no coherent unread story. */
  const [toSupport, setToSupport] = useState(!isFounder);
  /* A founder's default is a team message (they read the support desk, they do
     not write to it) — unless team messaging is not migrated, in which case the
     support desk is the only thing the panel could possibly send to. */
  const [picked, setPicked] = useState<string[]>([]);
  const [orgMembers, setOrgMembers] = useState<OrgMemberRow[] | null>(null);

  const listRef = useRef<HTMLDivElement>(null);
  const msgsRef = useRef<HTMLDivElement>(null);

  const visible = useMemo(
    () => filterThreads(sorted, { query, status: isFounder ? chip : 'all', kind: kindChip }),
    [sorted, query, chip, kindChip, isFounder],
  );
  const openCount = useMemo(() => threads.filter(t => t.status === 'open').length, [threads]);
  const teamCount = useMemo(() => threads.filter(t => t.kind === 'team').length, [threads]);
  const active = activeId ? threads.find(t => t.id === activeId) ?? null : null;

  /* The open conversation's messages. `revision` ticks once per completed store
     refetch (Realtime ping or the poll), so this single effect covers opening a
     thread, a reply arriving, and a send reconciling. */
  useEffect(() => {
    if (!activeId) return;
    let cancelled = false;
    void (async () => {
      const list = await supportActions.loadMessages(activeId);
      if (cancelled) return;
      setMessages(list);
      // Looking at a conversation is what marks it read for me — the same rule
      // the widget uses, and a no-op when it was already read.
      supportActions.markRead(activeId, role, userId);
    })();
    return () => { cancelled = true; };
  }, [activeId, revision, role, userId]);

  /* The people I can start a team conversation with. Loaded when the compose
     panel opens rather than on mount — most visits never compose, and
     org_members is a query every member is allowed to run only for their OWN
     workspace (its SELECT policy is `org_id in (select user_org_ids())`). */
  useEffect(() => {
    if (!composingNew || !teamAvailable || !orgId || orgMembers !== null) return;
    let cancelled = false;
    void (async () => {
      const rows = await fetchOrgMembers(orgId);
      if (!cancelled) setOrgMembers(rows);
    })();
    return () => { cancelled = true; };
  }, [composingNew, teamAvailable, orgId, orgMembers]);

  const teammates = useMemo(
    () => (orgMembers === null ? null : orgMembers.filter(m => m.user_id !== userId)),
    [orgMembers, userId],
  );
  /* My OWN participant row carries the email the members INSERT policy checks
     against org_members — so take it from that table rather than from the JWT,
     which is the same string today but need not stay so. */
  const myEmail = useMemo(
    () => orgMembers?.find(m => m.user_id === userId)?.email ?? userEmail,
    [orgMembers, userId, userEmail],
  );

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
    setPicked([]);
    setToSupport(!isFounder || !teamAvailable);
    setComposingNew(true);
  };

  const pickSupport = () => { setToSupport(true); setPicked([]); };
  const togglePick = (id: string) => {
    setToSupport(false);
    setPicked(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));
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

  const canSend = !!draft.trim() && (!composingNew || toSupport || picked.length > 0);

  const send = async () => {
    const body = draft.trim();
    if (!body || busy || !canSend) return;
    setBusy(true);
    setError(null);
    try {
      if (activeId) {
        if (!active) {
          setError('That conversation is no longer in your list — reload the page.');
          return;
        }
        const m = await supportActions.send(active.id, body, messageRole(active, isFounder));
        if (!m) {
          setError('Could not send — please try again.');
          return;
        }
        setMessages(prev => [...prev, m]);
        setDraft('');
        return;
      }
      if (toSupport) {
        const r = await supportActions.startThread({ body, subject, userEmail, orgName });
        if (!r.ok) { setError(r.error); return; }
        setActiveId(r.thread.id);
        setComposingNew(false);
        setMessages([r.message]);
      } else {
        const chosen = (teammates ?? []).filter(m => picked.includes(m.user_id));
        const r = await supportActions.startTeamThread({
          me: { user_id: userId, email: myEmail },
          recipients: chosen.map(m => ({ user_id: m.user_id, email: m.email })),
          body,
          subject,
          orgName,
        });
        if (!r.ok) { setError(r.error); return; }
        setActiveId(r.thread.id);
        setComposingNew(false);
        setMessages([r.message]);
      }
      setDraft('');
      setSubject('');
      setPicked([]);
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
  const isTeam = active?.kind === 'team';
  /** The conversation's name, from my side of it. */
  const convTitle = active
    ? (active.kind === 'team'
        ? participantLabel(active, userId)
        : isFounder ? (active.user_email ?? 'user') : (active.subject || 'Arcadian team'))
    : 'New message';

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
          {/* The kind row is shown even with no team threads yet: it is how the
              second kind of conversation announces that it exists. */}
          {teamAvailable && (
            <div className="mv-chips" role="group" aria-label="Filter by conversation type">
              {([
                ['all', 'All', null],
                ['support', `Support ${threads.length - teamCount}`, <LifeBuoy key="s" size={13} aria-hidden="true" />],
                ['team', `Team ${teamCount}`, <Users key="t" size={13} aria-hidden="true" />],
              ] as const).map(([value, label, icon]) => (
                <button
                  key={value}
                  type="button"
                  className={`mv-chip${kindChip === value ? ' mv-chip--on' : ''}`}
                  aria-pressed={kindChip === value}
                  onClick={() => setKindChip(value)}
                >
                  {icon}{label}
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
                    ? 'No conversations with this filter.'
                    : 'Start one below — message the team here, or your workspace.'
              }
            />
          ) : visible.map(t => {
            const unread = isUnread(t, role, userId);
            const team = t.kind === 'team';
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
                    {teamAvailable && (
                      <span className="mv-kind" aria-hidden="true">
                        {team ? <Users size={13} /> : <LifeBuoy size={13} />}
                      </span>
                    )}
                    {/* The label is its own element: ellipsis does not apply to
                        a bare text node inside a flex container. */}
                    <span className="mv-thread-label">
                      {team
                        ? participantLabel(t, userId)
                        : isFounder ? (t.user_email ?? 'user') : (t.subject || 'Conversation')}
                    </span>
                    {unread && <span className="mv-sr"> (unread)</span>}
                  </span>
                  <span className="mv-thread-when">{formatRelative(t.last_message_at)}</span>
                </span>
                <span className="mv-thread-preview">
                  {team && t.subject ? `${t.subject} · ` : ''}
                  {!team && isFounder && t.org_name ? `${t.org_name} · ` : ''}
                  {/* Pre-migration rows have no last_sender_id; fall back to the
                      two-sided test so the prefix does not silently disappear. */}
                  {(t.last_sender_id ? t.last_sender_id === userId : t.last_sender_role === role) ? 'You: ' : ''}
                  {t.last_message_preview ?? ''}
                </span>
                {t.status === 'closed' && <span className="mv-thread-closed">Closed</span>}
              </button>
            );
          })}
        </div>

        <div className="mv-list-foot">
          <Button variant="secondary" fullWidth icon={<Plus size={15} />} onClick={startNew}>
            New message
          </Button>
        </div>
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
            actions={<Button variant="primary" icon={<Plus size={15} />} onClick={startNew}>New message</Button>}
          />
        ) : (
          <>
            <header className="mv-conv-head">
              <button type="button" className="mv-back" onClick={backToList}>
                <ChevronLeft size={15} /> All conversations
              </button>
              <div className="mv-conv-who">
                <strong>{convTitle}</strong>
                <span className="mv-conv-meta">
                  {composingNew
                    ? (toSupport ? 'We reply here, usually within a day.' : 'Everyone you choose can read and reply.')
                    : isTeam
                      ? [active?.subject, `${active ? active.members.length : 0} people`, closed ? 'closed' : null]
                          .filter(Boolean).join(' · ')
                      : isFounder
                        ? [active?.org_name, closed ? 'closed' : 'open'].filter(Boolean).join(' · ')
                        : `Arcadian team${closed ? ' · closed' : ''}`}
                </span>
              </div>
              {/* Close/Reopen is support triage. A team thread has no desk to
                  close it, so the control is not offered there. */}
              {isFounder && active && !isTeam && (
                <Button
                  variant="secondary"
                  disabled={busy}
                  icon={closed ? <RotateCcw size={15} /> : <CheckCircle2 size={15} />}
                  onClick={() => void setStatus(closed ? 'open' : 'closed')}
                >
                  {closed ? 'Reopen' : 'Close'}
                </Button>
              )}
              {!composingNew && (
                <Button variant="secondary" icon={<Plus size={15} />} onClick={startNew}>
                  New
                </Button>
              )}
            </header>

            <div className="mv-msgs" ref={msgsRef}>
              {composingNew && (
                <div className="mv-compose">
                  <span className="mv-compose-label" id="mv-to-label">To</span>
                  <div className="mv-chips" role="group" aria-labelledby="mv-to-label">
                    {/* Offered to founders too: it is the only way to see the
                        support side of the product from the inside, and
                        security_abuse_limits.sql already exempts them from the
                        open-thread quota for exactly that. */}
                    <button
                      type="button"
                      className={`mv-chip${toSupport ? ' mv-chip--on' : ''}`}
                      aria-pressed={toSupport}
                      onClick={pickSupport}
                    >
                      <LifeBuoy size={13} aria-hidden="true" />Arcadian support
                    </button>
                    {(teammates ?? []).map(m => (
                      <button
                        key={m.user_id}
                        type="button"
                        className={`mv-chip${picked.includes(m.user_id) ? ' mv-chip--on' : ''}`}
                        aria-pressed={picked.includes(m.user_id)}
                        onClick={() => togglePick(m.user_id)}
                      >
                        <Users size={13} aria-hidden="true" />{m.email ?? 'teammate'}
                      </button>
                    ))}
                  </div>
                  {teamAvailable && orgId && teammates !== null && teammates.length === 0 && (
                    <p className="mv-note">
                      No teammates yet — invite people from the Workspace dashboard and they appear here.
                    </p>
                  )}
                  {/* Legacy mode: multi_org_tenancy.sql has not been run, so there
                      is no workspace to draw a roster from. */}
                  {teamAvailable && !orgId && (
                    <p className="mv-note">
                      Team conversations need a workspace — set one up from the Workspace dashboard.
                    </p>
                  )}
                  {!teamAvailable && (
                    <p className="mv-note">
                      Team conversations aren’t set up in this project yet, so this goes to Arcadian support.
                    </p>
                  )}
                </div>
              )}
              {composingNew && messages.length === 0 && (
                <p className="mv-note">
                  {toSupport
                    ? 'What can we help with? Include as much detail as you like — screenshots can follow in a reply.'
                    : 'Everyone you picked gets this conversation in their own Messages page.'}
                </p>
              )}
              {messages.map(m => {
                const mine = m.sender_id === userId;
                return (
                  <div key={m.id} className={`mv-msg${mine ? ' mv-msg--mine' : ''}`}>
                    <div className="mv-bubble">{m.body}</div>
                    <span className="mv-stamp">{senderName(m, userId, active)} · {formatRelative(m.created_at)}</span>
                  </div>
                );
              })}
              {closed && !isTeam && (
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
                  placeholder={isFounder && !isTeam ? 'Reply…' : 'Write a message…'}
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
                  disabled={!canSend}
                  icon={<Send size={15} />}
                  onClick={() => void send()}
                >
                  Send
                </Button>
              </div>
              <p className="mv-hint">
                {composingNew && !toSupport && picked.length === 0
                  ? 'Choose who this goes to · Enter sends · Shift + Enter starts a new line'
                  : 'Enter sends · Shift + Enter starts a new line'}
              </p>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
