import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { KanbanSquare, X, Plus, Trash2, RefreshCw, ListTree, Search } from 'lucide-react';
import {
  createCard,
  createColumn,
  deleteColumn,
  ensureColumns,
  fetchBoard,
  moveCard,
  rebalanceCards,
  type BoardData,
} from '../lib/kanbanService';
import { buildBoardTree, cardProgress, taskProgress } from '../lib/kanban/tree';
import { computeDropRank, dropIndexBefore, needsRebalance, RANK_STEP } from '../lib/kanban/rank';
import { completionForMove } from '../lib/kanban/status';
import { deriveDateStatus } from '../lib/kanban/dates';
import { formatDueDate, initials, toggleInSet } from '../lib/kanban/format';
import { buildAtlas, laneKey, type AtlasCard } from '../lib/kanban/atlas';
import type { CardNode, ColumnNode } from '../lib/kanban/types';
import { log } from '../lib/debugLogger';
import KanbanCardDetail from './KanbanCardDetail';
import './KanbanBoard.css';

interface KanbanBoardProps {
  orgId: string;
  userId: string;
  userEmail: string | null;
  onClose: () => void;
}

/**
 * The team board — lanes of cards, each card broken into tasks and subtasks,
 * with assignees, dates and comments. App gates rendering to Founding Workspace
 * members; the schema itself is plain org-scoped, so any workspace could get it.
 *
 * Drag-and-drop is native HTML5 (no dnd library — new deps need sign-off), the
 * same shape CategoryZones uses: JSON payload with an `action` discriminator,
 * the dragged id mirrored in state as the Safari fallback, and hover state
 * cleared in onDragLeave/onDrop/onDragEnd alike.
 *
 * Every ordering/nesting/date decision comes from the pure modules under
 * lib/kanban/ — this component fetches, draws, and writes back.
 */
export default function KanbanBoard({ orgId, userId, userEmail, onClose }: KanbanBoardProps) {
  const [board, setBoard] = useState<BoardData | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const [openCardId, setOpenCardId] = useState<string | null>(null);
  const [addingIn, setAddingIn] = useState<string | null>(null); // column id
  // 'lanes' = the drag-and-drop board; 'atlas' = the Feature Atlas layout
  // (subsystem sections + wiring) derived LIVE from the same tree, so a lane
  // drag or task tick in one view is already reflected in the other.
  const [view, setView] = useState<'lanes' | 'atlas'>(() => {
    try { return localStorage.getItem('sortbot_kanban_view') === 'atlas' ? 'atlas' : 'lanes'; }
    catch { return 'lanes'; }
  });
  const switchView = (v: 'lanes' | 'atlas') => {
    setView(v);
    // Disarm transient lanes-view state on every switch: an armed lane-delete
    // confirm (or an autoFocus add-card composer) must not survive an Atlas
    // round-trip and remount ready to fire on a muscle-memory click.
    setConfirmKey(null);
    setAddingIn(null);
    setAddingLane(false);
    try { localStorage.setItem('sortbot_kanban_view', v); } catch { /* private mode */ }
  };
  // Atlas-view filters live HERE, not in KanbanAtlasView: the child unmounts on
  // every toggle to lanes, so component-local state would make the natural
  // round-trip (filter in Atlas → act in Lanes → return) lossy each time.
  const [atlasQ, setAtlasQ] = useState('');
  const [atlasHiddenLanes, setAtlasHiddenLanes] = useState<Set<string>>(new Set());
  const [newCardTitle, setNewCardTitle] = useState('');
  const [addingLane, setAddingLane] = useState(false);
  const [newLaneName, setNewLaneName] = useState('');
  const [confirmKey, setConfirmKey] = useState<string | null>(null);

  // Drag state. The id is mirrored here because dataTransfer.getData() is empty
  // during dragover in some browsers — CategoryZones relies on the same fallback.
  const [draggedCardId, setDraggedCardId] = useState<string | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);
  const [dragOverCardId, setDragOverCardId] = useState<string | null>(null);

  // `now` is state, not a Date.now() read during render: components must be
  // pure, and a clock read mid-render makes the due badges depend on when React
  // happened to re-render. It re-reads on every load, which is exactly when the
  // badges can change anyway.
  const [now, setNow] = useState(() => Date.now());

  // StrictMode double-invokes effects. This holds the IN-FLIGHT seeding promise
  // rather than a "started" boolean: a boolean makes the second caller skip the
  // branch and return the empty board it fetched BEFORE seeding, so the first
  // open renders zero lanes despite five existing. Both callers await the same
  // insert, then both re-read. (orgService.ensureOrganization dedupes the same
  // way, for the same reason.) The DB's unique index is the real backstop.
  const seedingRef = useRef<Promise<unknown> | null>(null);

  // The busy flag needs a REF, not just state: `run` is re-created each render
  // and closes over that render's `busy` const, so a second call from the same
  // render scope reads a stale `false` and the mutex silently disarms itself.
  const busyRef = useRef(false);

  /** Fetch only — no setState, so effects can call it and apply the result in
   *  a callback (the house pattern; a setState-ing function invoked straight
   *  from an effect body causes the cascading renders react-hooks warns about). */
  const fetchBoardData = useCallback(async (): Promise<BoardData | 'unavailable'> => {
    const res = await fetchBoard(orgId);
    if (res.status === 'unavailable') return 'unavailable';

    // A workspace with no lanes yet gets the default set.
    if (res.board.columns.length === 0) {
      if (!seedingRef.current) {
        log.kanban('load | no lanes — seeding defaults');
        seedingRef.current = ensureColumns();
      }
      await seedingRef.current;
      const seeded = await fetchBoard(orgId);
      return seeded.status === 'ok' ? seeded.board : 'unavailable';
    }
    return res.board;
  }, [orgId]);

  const applyBoardData = useCallback((data: BoardData | 'unavailable') => {
    if (data === 'unavailable') {
      setUnavailable(true);
    } else {
      setUnavailable(false);
      setBoard(data);
      setNow(Date.now());
    }
    setLoading(false);
  }, []);

  /** Re-read the board. Only ever called from event handlers / run(), never
   *  from an effect body. */
  const load = useCallback(async () => {
    applyBoardData(await fetchBoardData());
  }, [fetchBoardData, applyBoardData]);

  useEffect(() => {
    let cancelled = false;
    fetchBoardData().then(data => { if (!cancelled) applyBoardData(data); });
    return () => { cancelled = true; };
  }, [fetchBoardData, applyBoardData]);

  /**
   * Every mutation goes through here: one guard, one notice, one reload.
   *
   * The guard reads a REF, not the `busy` state — `run` closes over the `busy`
   * const of the render that created it, so a state read here is stale by
   * construction and the mutex would never actually fire.
   *
   * A skipped call is REPORTED, never swallowed. Silently dropping the write
   * while the caller has already cleared its input (or snapped a dragged card
   * back) is how a board loses a user's work with no error on screen.
   * Returns whether the mutation ran AND succeeded, so callers can keep a draft
   * on failure instead of throwing it away.
   */
  const run = async (
    fn: () => Promise<{ ok: boolean; error?: string }>,
    okMsg?: string,
  ): Promise<boolean> => {
    if (busyRef.current) {
      setNotice('Still saving the last change — give it a second and try again.');
      return false;
    }
    busyRef.current = true;
    setBusy(true);
    setNotice(null);
    try {
      const res = await fn();
      if (!res.ok) setNotice(res.error || 'That did not work — check your permissions.');
      else if (okMsg) setNotice(okMsg);
      await load();
      return res.ok;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const tree: ColumnNode[] = useMemo(
    () => (board ? buildBoardTree(board) : []),
    [board],
  );

  const openCard: CardNode | null = useMemo(() => {
    if (!openCardId) return null;
    for (const col of tree) {
      const found = col.cards.find(c => c.id === openCardId);
      if (found) return found;
    }
    // Deleted here or by a teammate — the drawer below simply stops rendering,
    // so a stale openCardId needs no cleanup effect.
    return null;
  }, [tree, openCardId]);

  // Declared AFTER openCard: the dep array is evaluated during render, so
  // referencing openCard above its own const would be a temporal-dead-zone
  // crash on first render, not just a lint nit.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Guard on the DERIVED card, not openCardId: if a teammate deletes the
      // open card, the drawer unmounts but a raw id would linger and silently
      // kill Escape for the rest of the session.
      if (openCard) setOpenCardId(null);
      else onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, openCard]);

  // ── Drag and drop ─────────────────────────────────────────────────────────

  const handleCardDragStart = (e: React.DragEvent, card: CardNode) => {
    e.stopPropagation();
    setDraggedCardId(card.id);
    e.dataTransfer.setData('application/json', JSON.stringify({
      action: 'move-card', cardId: card.id, fromColumnId: card.column_id,
    }));
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleCardDragEnd = () => {
    setDraggedCardId(null);
    setDragOverColumn(null);
    setDragOverCardId(null);
  };

  const readDraggedId = (e: React.DragEvent): string | null => {
    try {
      const raw = e.dataTransfer.getData('application/json');
      if (raw) {
        const data = JSON.parse(raw);
        if (data.action === 'move-card') return data.cardId as string;
      }
    } catch { /* ignore */ }
    return draggedCardId;
  };

  /** Land `cardId` at `toIndex` of `column`. toIndex is an index into the lane
   *  as the user sees it while dragging — computeDropRank owns the off-by-one. */
  const dropInto = async (column: ColumnNode, cardId: string, toIndex: number) => {
    const card = tree.flatMap(c => c.cards).find(c => c.id === cardId);
    if (!card) return;
    const sameLane = card.column_id === column.id;
    const rank = computeDropRank(column.cards, toIndex, sameLane ? cardId : null);
    const completedAt = completionForMove(column.is_done, card.completed_at, new Date().toISOString());

    log.kanban(`dropInto | card=${cardId} lane=${column.name} idx=${toIndex} sameLane=${sameLane}`);

    // The move AND its rebalance are ONE critical section. Two run() calls would
    // deadlock against the mutex (the second sees busy and skips), and worse:
    // run() hides the move's result, so a rebalance issued after a FAILED move
    // would rewrite ranks for a card that never moved, scrambling its real lane.
    await run(async () => {
      const res = await moveCard(cardId, column.id, rank, completedAt);
      if (!res.ok) return res;

      // Ranks in this lane have collapsed from repeated drops into one slot —
      // rewrite them once so ordering can never silently tie.
      const after = [...column.cards.filter(c => c.id !== cardId), { ...card, rank }];
      if (!needsRebalance(after.map(c => c.rank))) return res;
      log.kanban(`dropInto | lane=${column.name} needs rebalance`);
      return rebalanceCards(after.map(c => ({ id: c.id, rank: c.rank })));
    });
  };

  /** Atlas view's lane pill → move the card to the end of the chosen lane.
   *  Same dropInto critical section as a drag, so completion stamping and
   *  rebalance behave identically in both views. */
  const moveFromAtlas = async (card: CardNode, toColumnId: string) => {
    if (card.column_id === toColumnId) return;
    const column = tree.find(c => c.id === toColumnId);
    if (!column) return;
    await dropInto(column, card.id, column.cards.length);
  };

  const handleColumnDrop = async (e: React.DragEvent, column: ColumnNode) => {
    e.preventDefault();
    e.stopPropagation();
    const cardId = readDraggedId(e);
    setDragOverColumn(null);
    setDragOverCardId(null);
    setDraggedCardId(null);
    if (!cardId) return;
    // Dropped on the lane background → append to the end.
    await dropInto(column, cardId, column.cards.length);
  };

  /**
   * Dropped ON a card → land ABOVE it, which is what the drop indicator (a top
   * border on the hovered card) promises.
   *
   * The index must be measured against the lane WITHOUT the dragged card,
   * because that is the list computeDropRank reads its neighbours from. Passing
   * the target's index in the full lane would land the card one slot late on
   * every downward drag — the same off-by-one rank.test.ts pins in the math.
   */
  const handleCardDrop = async (e: React.DragEvent, column: ColumnNode, targetCardId: string) => {
    e.preventDefault();
    e.stopPropagation();
    const cardId = readDraggedId(e);
    setDragOverColumn(null);
    setDragOverCardId(null);
    setDraggedCardId(null);
    if (!cardId || cardId === targetCardId) return;

    await dropInto(column, cardId, dropIndexBefore(column.cards, cardId, targetCardId));
  };

  // ── Actions ───────────────────────────────────────────────────────────────

  // Drafts are cleared ONLY after the write lands. Clearing first means a fast
  // second Enter — while the previous save is still in flight — wipes the input
  // and drops the card with nothing on screen to say so.
  const handleAddCard = async (column: ColumnNode) => {
    const title = newCardTitle.trim();
    if (!title) return;
    const rank = column.cards.length
      ? column.cards[column.cards.length - 1].rank + RANK_STEP
      : RANK_STEP;
    // Functional clear: only wipe the text we saved. The board inputs stay
    // enabled during the save, so the user may have typed ahead — that newer
    // text is theirs, not ours to discard.
    if (await run(() => createCard(column.id, title, rank, userEmail))) {
      setNewCardTitle(prev => (prev === title ? '' : prev));
    }
  };

  const handleAddLane = async () => {
    const name = newLaneName.trim();
    if (!name) return;
    const rank = tree.length ? tree[tree.length - 1].rank + RANK_STEP : RANK_STEP;
    if (await run(() => createColumn(name, rank))) {
      let typedAhead = false;
      setNewLaneName(prev => { typedAhead = prev !== name; return typedAhead ? prev : ''; });
      // Don't tear the composer down over text the user is still writing.
      if (!typedAhead) setAddingLane(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="kanban-overlay" onClick={onClose}>
      <div className="kanban-panel" onClick={(e) => e.stopPropagation()}>
        <div className="kanban-header">
          <div className="kanban-title">
            <KanbanSquare size={20} />
            <h2>Board</h2>
            <span className="kanban-scope-badge">workspace — every member can edit</span>
          </div>
          <div className="kanban-header-actions">
            {!unavailable && (
              <div className="kanban-view-toggle" role="tablist" aria-label="Board view">
                <button
                  role="tab"
                  aria-selected={view === 'lanes'}
                  className={`kanban-view-btn ${view === 'lanes' ? 'kanban-view-btn--on' : ''}`}
                  disabled={loading}
                  onClick={() => switchView('lanes')}
                >
                  <KanbanSquare size={12} /> Lanes
                </button>
                <button
                  role="tab"
                  aria-selected={view === 'atlas'}
                  className={`kanban-view-btn ${view === 'atlas' ? 'kanban-view-btn--on' : ''}`}
                  disabled={loading}
                  onClick={() => switchView('atlas')}
                >
                  <ListTree size={12} /> Atlas
                </button>
              </div>
            )}
            <button className="kanban-icon-btn" title="Refresh" disabled={busy || loading} onClick={() => load()}>
              <RefreshCw size={13} />
            </button>
            <button className="kanban-close" onClick={onClose} aria-label="Close"><X size={18} /></button>
          </div>
        </div>

        {notice && <div className="kanban-notice">{notice}</div>}

        {loading ? (
          <p className="kanban-loading">Loading board…</p>
        ) : unavailable ? (
          <div className="kanban-unavailable">
            <p><strong>The board tables aren’t set up yet.</strong></p>
            <p>
              Run <code>supabase/migrations/kanban_board.sql</code> in the Supabase SQL editor,
              then reopen this panel. Nothing else in the app is affected until you do.
            </p>
          </div>
        ) : view === 'atlas' ? (
          <KanbanAtlasView
            tree={tree}
            busy={busy}
            q={atlasQ}
            onQChange={setAtlasQ}
            hiddenLanes={atlasHiddenLanes}
            onToggleLane={(id) => setAtlasHiddenLanes(prev => toggleInSet(prev, id))}
            onUnhideLane={(id) => setAtlasHiddenLanes(prev => {
              if (!prev.has(id)) return prev;
              const next = new Set(prev);
              next.delete(id);
              return next;
            })}
            onOpenCard={setOpenCardId}
            onMove={moveFromAtlas}
          />
        ) : (
          <div className="kanban-lanes">
            {tree.map(column => (
              <div
                key={column.id}
                className={`kanban-lane ${dragOverColumn === column.id ? 'kanban-lane--drag-over' : ''}`}
                onDragOver={(e) => { e.preventDefault(); setDragOverColumn(column.id); }}
                onDragLeave={() => setDragOverColumn(null)}
                onDrop={(e) => handleColumnDrop(e, column)}
              >
                <div className="kanban-lane-head">
                  <span className={`kanban-lane-name ${column.is_done ? 'kanban-lane-name--done' : ''}`}>
                    {column.name}
                  </span>
                  <span className="kanban-lane-count">{column.cards.length}</span>
                  {confirmKey === `lane:${column.id}` ? (
                    <span className="kanban-confirm">
                      <button className="kanban-confirm-yes" disabled={busy} onClick={() => {
                        setConfirmKey(null);
                        run(() => deleteColumn(column.id), 'Lane deleted.');
                      }}>Delete lane</button>
                      <button className="kanban-confirm-no" disabled={busy} onClick={() => setConfirmKey(null)}>Cancel</button>
                    </span>
                  ) : (
                    <button
                      className="kanban-icon-btn kanban-icon-danger kanban-lane-del"
                      title={column.cards.length ? `Delete lane and its ${column.cards.length} card(s)` : 'Delete lane'}
                      disabled={busy}
                      onClick={() => setConfirmKey(`lane:${column.id}`)}
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>

                <div className="kanban-lane-cards">
                  {column.cards.map(card => (
                    <KanbanCardMini
                      key={card.id}
                      card={card}
                      now={now}
                      busy={busy}
                      dragging={draggedCardId === card.id}
                      dragOver={dragOverCardId === card.id}
                      onOpen={() => setOpenCardId(card.id)}
                      onDragStart={(e) => handleCardDragStart(e, card)}
                      onDragEnd={handleCardDragEnd}
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        // Re-assert the lane tint: stopPropagation here starves
                        // the lane's own onDragOver, but its onDragLeave DID
                        // fire when the pointer crossed onto this card.
                        setDragOverColumn(column.id);
                        if (draggedCardId && draggedCardId !== card.id) setDragOverCardId(card.id);
                      }}
                      onDragLeave={() => setDragOverCardId(null)}
                      onDrop={(e) => handleCardDrop(e, column, card.id)}
                    />
                  ))}

                  {column.cards.length === 0 && (
                    <p className="kanban-lane-empty">Drop a card here</p>
                  )}
                </div>

                {addingIn === column.id ? (
                  <div className="kanban-add-card">
                    <input
                      autoFocus
                      placeholder="Card title…"
                      value={newCardTitle}
                      onChange={(e) => setNewCardTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleAddCard(column);
                        // stopPropagation: without it Escape reaches the
                        // document listener and closes the whole board.
                        if (e.key === 'Escape') { e.stopPropagation(); setAddingIn(null); setNewCardTitle(''); }
                      }}
                    />
                    <div className="kanban-add-card-actions">
                      <button className="kanban-add-btn" disabled={busy || !newCardTitle.trim()} onClick={() => handleAddCard(column)}>
                        Add
                      </button>
                      <button className="kanban-confirm-no" disabled={busy} onClick={() => { setAddingIn(null); setNewCardTitle(''); }}>
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    className="kanban-lane-add"
                    disabled={busy}
                    onClick={() => { setAddingIn(column.id); setNewCardTitle(''); }}
                  >
                    <Plus size={12} /> Add card
                  </button>
                )}
              </div>
            ))}

            <div className="kanban-lane kanban-lane--new">
              {addingLane ? (
                <div className="kanban-add-card">
                  <input
                    autoFocus
                    placeholder="Lane name…"
                    value={newLaneName}
                    onChange={(e) => setNewLaneName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleAddLane();
                      if (e.key === 'Escape') { e.stopPropagation(); setAddingLane(false); setNewLaneName(''); }
                    }}
                  />
                  <div className="kanban-add-card-actions">
                    <button className="kanban-add-btn" disabled={busy || !newLaneName.trim()} onClick={handleAddLane}>Add</button>
                    <button className="kanban-confirm-no" disabled={busy} onClick={() => { setAddingLane(false); setNewLaneName(''); }}>Cancel</button>
                  </div>
                </div>
              ) : (
                <button className="kanban-lane-add" disabled={busy} onClick={() => setAddingLane(true)}>
                  <Plus size={12} /> Add lane
                </button>
              )}
            </div>
          </div>
        )}

        {openCard && board && (
          <KanbanCardDetail
            // Remount on card switch so the text drafts re-initialise from the
            // new card — no prop-sync effects, no stale drafts.
            key={openCard.id}
            card={openCard}
            members={board.members}
            userId={userId}
            userEmail={userEmail}
            now={now}
            busy={busy}
            onClose={() => setOpenCardId(null)}
            onRun={run}
          />
        )}
      </div>
    </div>
  );
}

// ── Card mini ───────────────────────────────────────────────────────────────

interface KanbanCardMiniProps {
  card: CardNode;
  /** Passed in, never read from the clock here — components must be pure. */
  now: number;
  /** A drag begun mid-save would be skipped by run()'s mutex and silently snap
   *  back, so the card simply isn't draggable until the write lands. */
  busy: boolean;
  dragging: boolean;
  dragOver: boolean;
  onOpen: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
}

function KanbanCardMini({ card, now, busy, dragging, dragOver, onOpen, ...dnd }: KanbanCardMiniProps) {
  const progress = cardProgress(card);
  const dateStatus = deriveDateStatus(card, now);
  const commentCount = card.comments.length
    + card.tasks.reduce((n, t) => n + t.comments.length + t.subtasks.reduce((m, s) => m + s.comments.length, 0), 0);

  return (
    <div
      className={`kanban-card ${dragging ? 'kanban-card--dragging' : ''} ${dragOver ? 'kanban-card--drag-over' : ''}`}
      draggable={!busy}
      onClick={onOpen}
      {...dnd}
    >
      <div className="kanban-card-top">
        {card.is_epic && <span className="kanban-epic-badge">epic</span>}
        <span className="kanban-card-title">{card.title}</span>
      </div>

      {progress.total > 0 && (
        <div className="kanban-card-progress" title={`${progress.done} of ${progress.total} done`}>
          <div className="kanban-progress-track">
            <div
              className={`kanban-progress-fill ${progress.complete ? 'kanban-progress-fill--done' : ''}`}
              style={{ width: `${Math.round(progress.ratio * 100)}%` }}
            />
          </div>
          <span className="kanban-progress-label">{progress.done}/{progress.total}</span>
        </div>
      )}

      <div className="kanban-card-foot">
        {dateStatus !== 'none' && dateStatus !== 'done' && card.due_date && (
          <span className={`kanban-date-badge kanban-date-badge--${dateStatus}`}>
            {formatDueDate(card.due_date)}
          </span>
        )}
        {commentCount > 0 && <span className="kanban-comment-count">{commentCount} 💬</span>}
        <span className="kanban-card-avatars">
          {card.assignees.map(a => (
            <span key={a.user_id} className="kanban-avatar" title={a.email ?? a.user_id}>
              {initials(a.email)}
            </span>
          ))}
        </span>
      </div>
    </div>
  );
}

// ── Atlas view ──────────────────────────────────────────────────────────────
// The Feature Atlas layout (subsystem sections, status pills, wiring) rebuilt
// live from the same tree the lanes render — lib/kanban/atlas.ts owns the
// parsing/grouping, this draws it. Clicking a card opens the SAME drawer as
// the lanes view; the lane pill is a <select> that moves the card for real
// (debounced — see AtlasCardRow). Filter state (q/hiddenLanes) is owned by
// KanbanBoard so it survives view toggles.

interface KanbanAtlasViewProps {
  tree: ColumnNode[];
  busy: boolean;
  q: string;
  onQChange: (q: string) => void;
  hiddenLanes: Set<string>;
  onToggleLane: (id: string) => void;
  onUnhideLane: (id: string) => void;
  onOpenCard: (id: string) => void;
  onMove: (card: CardNode, toColumnId: string) => void;
}

function KanbanAtlasView({
  tree, busy, q, onQChange, hiddenLanes, onToggleLane, onUnhideLane, onOpenCard, onMove,
}: KanbanAtlasViewProps) {
  const atlas = useMemo(() => buildAtlas(tree), [tree]);
  const term = q.trim().toLowerCase();

  // Filter + per-group totals in ONE memo. The pre-filter total rides on the
  // group object itself (no parallel keyed Map to drift), lane visibility and
  // text search are separate passes, and search is a single .includes against
  // the haystack precomputed inside the memoized buildAtlas — nothing here
  // rebuilds strings per keystroke or recomputes on unrelated re-renders.
  const filtered = useMemo(
    () => atlas.map(g => ({
      ...g,
      total: g.cards.length,
      cards: g.cards
        .filter(c => !hiddenLanes.has(c.card.column_id))
        .filter(c => !term || c.haystack.includes(term)),
    })),
    [atlas, term, hiddenLanes],
  );
  const shown = filtered.reduce((n, g) => n + g.cards.length, 0);
  const total = atlas.reduce((n, g) => n + g.cards.length, 0);

  // Moving a card into a lane the user has hidden would make the row vanish
  // mid-interaction (indistinguishable from deletion) — reveal the destination
  // lane first so the moved card stays on screen.
  const moveAndReveal = (card: CardNode, toColumnId: string) => {
    onUnhideLane(toColumnId);
    onMove(card, toColumnId);
  };

  // behavior 'auto', not 'smooth': the cards use content-visibility, and a
  // smooth animation forces progressive render of every card it passes.
  const jump = (key: string) => {
    document.getElementById(`kanban-atlas-sec-${key}`)
      ?.scrollIntoView({ behavior: 'auto', block: 'start' });
  };

  return (
    <div className="kanban-atlas">
      <div className="kanban-atlas-controls">
        <label className="kanban-atlas-search">
          <Search size={12} />
          <input
            placeholder={total === 0 ? 'Search cards…' : `Search ${total} cards…`}
            value={q}
            onChange={e => onQChange(e.target.value)}
            onKeyDown={e => {
              // Clear-on-Escape, but let an empty search bubble so the board closes.
              if (e.key === 'Escape' && q) { e.stopPropagation(); onQChange(''); }
            }}
          />
        </label>
        <div className="kanban-atlas-lanechips">
          {tree.map(col => (
            <button
              key={col.id}
              className={`kanban-atlas-lanechip kanban-atlas-pill--${laneKey(col.name, col.is_done)} ${hiddenLanes.has(col.id) ? 'kanban-atlas-lanechip--off' : ''}`}
              title={hiddenLanes.has(col.id) ? `Show ${col.name} cards` : `Hide ${col.name} cards`}
              onClick={() => onToggleLane(col.id)}
            >
              {col.name} <span className="kanban-atlas-lanechip-n">{col.cards.length}</span>
            </button>
          ))}
        </div>
        <span className="kanban-atlas-showing">{shown} / {total}</span>
      </div>

      <div className="kanban-atlas-map">
        {filtered.filter(g => g.kind === 'step').map((g, i) => (
          <span key={g.key} className="kanban-atlas-map-step">
            {i > 0 && <span className="kanban-atlas-map-arrow">→</span>}
            <button
              className={`kanban-atlas-map-node kanban-atlas-map-node--${g.key}`}
              // A node whose section has no visible cards has nowhere to jump
              // (sections render only when non-empty) — disable, don't no-op.
              disabled={g.cards.length === 0}
              title={g.cards.length === 0 ? 'No visible cards in this subsystem' : `Jump to ${g.title}`}
              onClick={() => jump(g.key)}
            >
              <span className="kanban-atlas-map-kx">{g.step}</span> {g.title}
              <span className="kanban-atlas-map-n">{g.cards.length}</span>
            </button>
          </span>
        ))}
        <span className="kanban-atlas-map-divider" />
        {filtered.filter(g => g.kind === 'xcut' && g.total !== 0).map(g => (
          <button
            key={g.key}
            className={`kanban-atlas-map-node kanban-atlas-map-node--xcut kanban-atlas-map-node--${g.key}`}
            disabled={g.cards.length === 0}
            title={g.cards.length === 0 ? 'No visible cards in this subsystem' : `Jump to ${g.title}`}
            onClick={() => jump(g.key)}
          >
            {g.title}
            <span className="kanban-atlas-map-n">{g.cards.length}</span>
          </button>
        ))}
      </div>

      <div className="kanban-atlas-scroll">
        {filtered.filter(g => g.cards.length > 0).map(g => (
          <section key={g.key} id={`kanban-atlas-sec-${g.key}`} className={`kanban-atlas-sec kanban-atlas-sec--${g.key}`}>
            <div className="kanban-atlas-sec-head">
              {g.step && <span className="kanban-atlas-sec-step">STEP {g.step}</span>}
              <h3>{g.title}</h3>
              <span className="kanban-atlas-sec-count">
                {g.cards.length === g.total ? g.total : `${g.cards.length} / ${g.total}`}
              </span>
            </div>
            {g.cards.map(c => (
              <AtlasCardRow key={c.card.id} ac={c} tree={tree} busy={busy} onOpenCard={onOpenCard} onMove={moveAndReveal} />
            ))}
          </section>
        ))}
        {shown === 0 && (
          <p className="kanban-atlas-empty">
            {total === 0
              ? 'No cards on the board yet — switch to Lanes to add some, or run the feature-atlas seed migration.'
              : 'No cards match — clear the search or re-enable a lane.'}
          </p>
        )}
      </div>
    </div>
  );
}

interface AtlasCardRowProps {
  ac: AtlasCard;
  tree: ColumnNode[];
  busy: boolean;
  onOpenCard: (id: string) => void;
  onMove: (card: CardNode, toColumnId: string) => void;
}

const AtlasCardRow = memo(function AtlasCardRow({ ac, tree, busy, onOpenCard, onMove }: AtlasCardRowProps) {
  const { card } = ac;
  const progress = cardProgress(card);

  // The pill's selection is DEBOUNCED before committing: a closed, focused
  // native <select> fires change on EVERY arrow keypress on Windows/Linux, and
  // each commit here is a real DB move (landing on Done stamps completed_at).
  // Browsing coalesces to the resting choice; pendingLane shows the selection
  // immediately while the timer runs.
  const [pendingLane, setPendingLane] = useState<string | null>(null);
  const commitTimer = useRef<number | null>(null);
  useEffect(() => () => {
    if (commitTimer.current !== null) window.clearTimeout(commitTimer.current);
  }, []);
  const choose = (toColumnId: string) => {
    setPendingLane(toColumnId);
    if (commitTimer.current !== null) window.clearTimeout(commitTimer.current);
    commitTimer.current = window.setTimeout(() => {
      commitTimer.current = null;
      setPendingLane(null);
      if (toColumnId !== card.column_id) onMove(card, toColumnId);
    }, 400);
  };

  return (
    <div className="kanban-atlas-card" onClick={() => onOpenCard(card.id)}>
      <div className="kanban-atlas-card-head">
        {card.is_epic && <span className="kanban-epic-badge">epic</span>}
        <span className="kanban-atlas-card-name">{ac.name}</span>
        {progress.total > 0 && (
          // Same markup as KanbanCardMini so the two views can never disagree
          // on how completion looks (incl. the --done green fill).
          <div className="kanban-card-progress kanban-card-progress--atlas" title={`${progress.done} of ${progress.total} done`}>
            <div className="kanban-progress-track">
              <div
                className={`kanban-progress-fill ${progress.complete ? 'kanban-progress-fill--done' : ''}`}
                style={{ width: `${Math.round(progress.ratio * 100)}%` }}
              />
            </div>
            <span className="kanban-progress-label">{progress.done}/{progress.total}</span>
          </div>
        )}
        <select
          className={`kanban-atlas-lane-pill kanban-atlas-pill--${ac.laneKey}`}
          value={pendingLane ?? card.column_id}
          disabled={busy}
          title="Move to lane"
          onClick={e => e.stopPropagation()}
          onChange={e => choose(e.target.value)}
        >
          {tree.map(col => <option key={col.id} value={col.id}>{col.name}</option>)}
        </select>
      </div>
      {ac.notes.description && <p className="kanban-atlas-desc">{ac.notes.description}</p>}
      {card.tasks.length > 0 && (
        <div className="kanban-atlas-tasks">
          {card.tasks.map(t => {
            // Leaf-counted, like the progress badge beside it: a parent task
            // with subtasks reads done when its SUBTASKS are done — the two
            // indicators on this row must never contradict (tree.ts docstring).
            const tp = taskProgress(t);
            return (
              <span
                key={t.id}
                className={`kanban-atlas-task ${tp.complete ? 'kanban-atlas-task--done' : ''}`}
                title={[t.notes, t.subtasks.length ? `${tp.done}/${tp.total} subtasks` : ''].filter(Boolean).join(' — ') || undefined}
              >
                {tp.complete ? '✓' : '○'} {t.title}{t.subtasks.length > 0 && ` ${tp.done}/${tp.total}`}
              </span>
            );
          })}
        </div>
      )}
      {ac.notes.wiring.length > 0 && (
        <ul className="kanban-atlas-wiring">
          {ac.notes.wiring.map((w, i) => {
            const idx = w.indexOf(':');
            const verb = idx > 0 ? w.slice(0, idx) : '';
            const rest = idx > 0 ? w.slice(idx + 1).trim() : w;
            return <li key={i}>{verb && <b>{verb}:</b>} {rest}</li>;
          })}
        </ul>
      )}
    </div>
  );
}, (prev, next) =>
  // onOpenCard/onMove are deliberately excluded: they are behavior-stable
  // closures recreated per parent render — comparing them would defeat the
  // memo. ac identities survive filtering because buildAtlas is memoized.
  prev.ac === next.ac && prev.tree === next.tree && prev.busy === next.busy,
);
