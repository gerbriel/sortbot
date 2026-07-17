import { useState } from 'react';
import { X, Plus, Trash2, ChevronRight, ChevronDown, Check, Circle, CircleDot } from 'lucide-react';
import {
  createComment,
  createTask,
  deleteCard,
  deleteComment,
  deleteTask,
  setTaskStatus,
  updateCard,
  updateTask,
  type CardPatch,
  type TaskPatch,
} from '../lib/kanbanService';
import { taskProgress } from '../lib/kanban/tree';
import { RANK_STEP } from '../lib/kanban/rank';
import { deriveDateStatus, validateDateRange } from '../lib/kanban/dates';
import type { BoardMember, CardNode, KanbanCommentRow, TaskNode, TaskStatus } from '../lib/kanban/types';
import { initials } from '../lib/kanban/format';

interface KanbanCardDetailProps {
  card: CardNode;
  members: readonly BoardMember[];
  userId: string;
  userEmail: string | null;
  /** Passed in, never read from the clock here — components must be pure. */
  now: number;
  busy: boolean;
  onClose: () => void;
  /** The board's single mutation path: busy guard + notice + reload. */
  onRun: (fn: () => Promise<{ ok: boolean; error?: string }>, okMsg?: string) => Promise<boolean>;
}

/**
 * The card drawer: rename, epic flag, assignees, dates, notes, the task /
 * subtask tree, and comment threads on the card and on every task.
 *
 * The card prop is always the freshly-derived node from the board tree, so
 * there is no second copy of the data to drift — text inputs keep a local
 * draft and commit on blur.
 *
 * Drafts are seeded from the card ONCE, at mount. The parent keys this
 * component on card.id, so opening a different card remounts it and re-seeds
 * them — no prop-sync effect, and a board reload mid-typing can never yank the
 * text out from under you. (That heuristic prop-sync pattern is what the PDG
 * spent June 2026 unpicking; not repeating it here.)
 */
export default function KanbanCardDetail({
  card, members, userId, userEmail, now, busy, onClose, onRun,
}: KanbanCardDetailProps) {
  const [titleDraft, setTitleDraft] = useState(card.title);
  const [notesDraft, setNotesDraft] = useState(card.notes ?? '');
  const [newTask, setNewTask] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [confirmKey, setConfirmKey] = useState<string | null>(null);

  const patchCard = (patch: CardPatch, okMsg?: string) => onRun(() => updateCard(card.id, patch), okMsg);

  const toggleExpanded = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAssignee = (targetIds: string[], memberId: string): string[] =>
    targetIds.includes(memberId) ? targetIds.filter(i => i !== memberId) : [...targetIds, memberId];

  const handleAddTask = async () => {
    const title = newTask.trim();
    if (!title) return;
    const rank = card.tasks.length ? card.tasks[card.tasks.length - 1].rank + RANK_STEP : RANK_STEP;
    // Cleared only once the write lands — see run() in KanbanBoard.
    if (await onRun(() => createTask(card.id, title, rank, null))) setNewTask('');
  };

  const dateRange = validateDateRange(card.start_date, card.end_date);

  return (
    <div className="kanban-detail" onClick={(e) => e.stopPropagation()}>
      <div className="kanban-detail-head">
        <input
          className="kanban-detail-title"
          value={titleDraft}
          disabled={busy}
          onChange={(e) => setTitleDraft(e.target.value)}
          onBlur={() => { if (titleDraft.trim() && titleDraft !== card.title) patchCard({ title: titleDraft.trim() }); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            // Escape here must not bubble to the board's document listener,
            // which would close the drawer and discard this draft.
            if (e.key === 'Escape') { e.stopPropagation(); setTitleDraft(card.title); }
          }}
        />
        <button className="kanban-close" onClick={onClose} aria-label="Close"><X size={16} /></button>
      </div>

      <div className="kanban-detail-meta">
        <label className="kanban-epic-toggle">
          <input
            type="checkbox"
            checked={card.is_epic}
            disabled={busy}
            onChange={(e) => patchCard({ is_epic: e.target.checked })}
          />
          Epic
        </label>
        {card.created_by_email && (
          <span className="kanban-detail-byline">added by {card.created_by_email}</span>
        )}
      </div>

      <section className="kanban-detail-section">
        <h4>Assigned to</h4>
        <AssigneePicker
          members={members}
          selected={card.assignee_ids ?? []}
          userId={userId}
          busy={busy}
          onToggle={(memberId) => patchCard({ assignee_ids: toggleAssignee(card.assignee_ids ?? [], memberId) })}
        />
      </section>

      <section className="kanban-detail-section">
        <h4>Dates</h4>
        <div className="kanban-date-row">
          <DateField label="Start" value={card.start_date} busy={busy}
            onChange={(v) => patchCard({ start_date: v })} />
          <DateField label="Due" value={card.due_date} busy={busy}
            onChange={(v) => patchCard({ due_date: v })} />
          <DateField label="End" value={card.end_date} busy={busy}
            onChange={(v) => patchCard({ end_date: v })} />
        </div>
        {!dateRange.valid && <p className="kanban-date-warn">{dateRange.reason}</p>}
        {card.completed_at && (
          <p className="kanban-detail-hint">
            Completed {new Date(card.completed_at).toLocaleDateString()} — drag the card out of the done lane to reopen it.
          </p>
        )}
      </section>

      <section className="kanban-detail-section">
        <h4>Notes</h4>
        <textarea
          className="kanban-notes"
          rows={3}
          placeholder="Anything the team should know…"
          value={notesDraft}
          disabled={busy}
          onChange={(e) => setNotesDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') e.stopPropagation(); }}
          onBlur={() => { if (notesDraft !== (card.notes ?? '')) patchCard({ notes: notesDraft.trim() || null }); }}
        />
      </section>

      <section className="kanban-detail-section">
        <h4>Tasks</h4>
        <div className="kanban-task-list">
          {card.tasks.map(task => (
            <TaskRow
              key={task.id}
              task={task}
              cardId={card.id}
              members={members}
              userId={userId}
              userEmail={userEmail}
              now={now}
              busy={busy}
              depth={0}
              expanded={expanded}
              confirmKey={confirmKey}
              setConfirmKey={setConfirmKey}
              onToggleExpanded={toggleExpanded}
              onRun={onRun}
            />
          ))}
          {card.tasks.length === 0 && (
            <p className="kanban-detail-hint">No tasks yet — break the work down below.</p>
          )}
        </div>
        <div className="kanban-add-inline">
          <input
            placeholder="Add a task…"
            value={newTask}
            disabled={busy}
            onChange={(e) => setNewTask(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAddTask();
              if (e.key === 'Escape') e.stopPropagation(); // don't close the drawer over a draft
            }}
          />
          <button className="kanban-add-btn" disabled={busy || !newTask.trim()} onClick={handleAddTask}>
            <Plus size={12} /> Add task
          </button>
        </div>
      </section>

      <section className="kanban-detail-section">
        <h4>Comments</h4>
        <CommentThread
          comments={card.comments}
          cardId={card.id}
          taskId={null}
          userEmail={userEmail}
          busy={busy}
          confirmKey={confirmKey}
          setConfirmKey={setConfirmKey}
          onRun={onRun}
        />
      </section>

      <div className="kanban-detail-danger">
        {confirmKey === `card:${card.id}` ? (
          <span className="kanban-confirm">
            <button className="kanban-confirm-yes" disabled={busy} onClick={() => {
              setConfirmKey(null);
              onClose();
              onRun(() => deleteCard(card.id), 'Card deleted.');
            }}>Delete card, its tasks and comments</button>
            <button className="kanban-confirm-no" disabled={busy} onClick={() => setConfirmKey(null)}>Cancel</button>
          </span>
        ) : (
          <button className="kanban-danger-btn" disabled={busy} onClick={() => setConfirmKey(`card:${card.id}`)}>
            <Trash2 size={12} /> Delete card
          </button>
        )}
      </div>
    </div>
  );
}

// ── Task row (recursive one level: task → subtasks) ─────────────────────────

interface TaskRowProps {
  task: TaskNode;
  cardId: string;
  members: readonly BoardMember[];
  userId: string;
  userEmail: string | null;
  now: number;
  busy: boolean;
  depth: number;
  expanded: Set<string>;
  confirmKey: string | null;
  setConfirmKey: (k: string | null) => void;
  onToggleExpanded: (id: string) => void;
  onRun: (fn: () => Promise<{ ok: boolean; error?: string }>, okMsg?: string) => Promise<boolean>;
}

function TaskRow({
  task, cardId, members, userId, userEmail, now, busy, depth,
  expanded, confirmKey, setConfirmKey, onToggleExpanded, onRun,
}: TaskRowProps) {
  const [newSub, setNewSub] = useState('');
  const isOpen = expanded.has(task.id);
  const progress = taskProgress(task);
  const dateStatus = deriveDateStatus(task, now);
  const patchTask = (patch: TaskPatch) => onRun(() => updateTask(task.id, patch));

  const handleAddSub = async () => {
    const title = newSub.trim();
    if (!title) return;
    const rank = task.subtasks.length ? task.subtasks[task.subtasks.length - 1].rank + RANK_STEP : RANK_STEP;
    if (await onRun(() => createTask(cardId, title, rank, task.id))) setNewSub('');
  };

  return (
    <div className={`kanban-task ${depth > 0 ? 'kanban-task--sub' : ''}`}>
      <div className="kanban-task-row">
        <StatusButton status={task.status} busy={busy}
          onCycle={(next) => onRun(() => setTaskStatus(task.id, next))} />

        <span className={`kanban-task-title ${task.status === 'done' ? 'kanban-task-title--done' : ''}`}>
          {task.title}
        </span>

        {task.subtasks.length > 0 && (
          <span className="kanban-task-progress" title={`${progress.done} of ${progress.total} subtasks done`}>
            {progress.done}/{progress.total}
          </span>
        )}

        {dateStatus !== 'none' && dateStatus !== 'done' && task.due_date && (
          <span className={`kanban-date-badge kanban-date-badge--${dateStatus}`}>{task.due_date.slice(5)}</span>
        )}

        {task.assignees.map(a => (
          <span key={a.user_id} className="kanban-avatar kanban-avatar--sm" title={a.email ?? a.user_id}>
            {initials(a.email)}
          </span>
        ))}

        {task.comments.length > 0 && <span className="kanban-comment-count">{task.comments.length} 💬</span>}

        <button className="kanban-icon-btn" title={isOpen ? 'Collapse' : 'Details, dates, comments'}
          disabled={busy} onClick={() => onToggleExpanded(task.id)}>
          {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>

        {confirmKey === `task:${task.id}` ? (
          <span className="kanban-confirm">
            <button className="kanban-confirm-yes" disabled={busy} onClick={() => {
              setConfirmKey(null);
              onRun(() => deleteTask(task.id));
            }}>Delete</button>
            <button className="kanban-confirm-no" disabled={busy} onClick={() => setConfirmKey(null)}>Cancel</button>
          </span>
        ) : (
          <button className="kanban-icon-btn kanban-icon-danger"
            title={task.subtasks.length ? `Delete task and its ${task.subtasks.length} subtask(s)` : 'Delete task'}
            disabled={busy} onClick={() => setConfirmKey(`task:${task.id}`)}>
            <Trash2 size={12} />
          </button>
        )}
      </div>

      {isOpen && (
        <div className="kanban-task-detail">
          <div className="kanban-date-row">
            <DateField label="Start" value={task.start_date} busy={busy} onChange={(v) => patchTask({ start_date: v })} />
            <DateField label="Due" value={task.due_date} busy={busy} onChange={(v) => patchTask({ due_date: v })} />
            <DateField label="End" value={task.end_date} busy={busy} onChange={(v) => patchTask({ end_date: v })} />
          </div>

          <AssigneePicker
            members={members}
            selected={task.assignee_ids ?? []}
            userId={userId}
            busy={busy}
            onToggle={(memberId) => patchTask({
              assignee_ids: (task.assignee_ids ?? []).includes(memberId)
                ? (task.assignee_ids ?? []).filter(i => i !== memberId)
                : [...(task.assignee_ids ?? []), memberId],
            })}
          />

          <CommentThread
            comments={task.comments}
            cardId={cardId}
            taskId={task.id}
            userEmail={userEmail}
            busy={busy}
            confirmKey={confirmKey}
            setConfirmKey={setConfirmKey}
            onRun={onRun}
          />

          {depth === 0 && (
            <div className="kanban-add-inline">
              <input
                placeholder="Add a subtask…"
                value={newSub}
                disabled={busy}
                onChange={(e) => setNewSub(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAddSub();
                  if (e.key === 'Escape') e.stopPropagation();
                }}
              />
              <button className="kanban-add-btn" disabled={busy || !newSub.trim()} onClick={handleAddSub}>
                <Plus size={12} /> Add subtask
              </button>
            </div>
          )}
        </div>
      )}

      {task.subtasks.map(sub => (
        <TaskRow
          key={sub.id}
          task={sub}
          cardId={cardId}
          members={members}
          userId={userId}
          userEmail={userEmail}
          now={now}
          busy={busy}
          depth={depth + 1}
          expanded={expanded}
          confirmKey={confirmKey}
          setConfirmKey={setConfirmKey}
          onToggleExpanded={onToggleExpanded}
          onRun={onRun}
        />
      ))}
    </div>
  );
}

// ── Small shared pieces ─────────────────────────────────────────────────────

/** todo → in progress → done → todo. setTaskStatus keeps completed_at in step. */
function StatusButton({ status, busy, onCycle }: {
  status: TaskStatus;
  busy: boolean;
  onCycle: (next: TaskStatus) => void;
}) {
  const next: TaskStatus = status === 'todo' ? 'in_progress' : status === 'in_progress' ? 'done' : 'todo';
  const label = status === 'todo' ? 'To do' : status === 'in_progress' ? 'In progress' : 'Done';
  return (
    <button
      className={`kanban-status-btn kanban-status-btn--${status.replace('_', '-')}`}
      title={`${label} — click for ${next.replace('_', ' ')}`}
      disabled={busy}
      onClick={() => onCycle(next)}
    >
      {status === 'done' ? <Check size={11} /> : status === 'in_progress' ? <CircleDot size={11} /> : <Circle size={11} />}
    </button>
  );
}

function DateField({ label, value, busy, onChange }: {
  label: string;
  value: string | null;
  busy: boolean;
  onChange: (v: string | null) => void;
}) {
  return (
    <label className="kanban-date-field">
      <span>{label}</span>
      <input
        type="date"
        value={value ?? ''}
        disabled={busy}
        onChange={(e) => onChange(e.target.value || null)}
      />
    </label>
  );
}

function AssigneePicker({ members, selected, userId, busy, onToggle }: {
  members: readonly BoardMember[];
  selected: readonly string[];
  userId: string;
  busy: boolean;
  onToggle: (memberId: string) => void;
}) {
  if (members.length === 0) {
    return <p className="kanban-detail-hint">No teammates in this workspace yet.</p>;
  }
  return (
    <div className="kanban-assignees">
      {members.map(m => {
        const on = selected.includes(m.user_id);
        return (
          <button
            key={m.user_id}
            className={`kanban-assignee-pill ${on ? 'kanban-assignee-pill--on' : ''}`}
            disabled={busy}
            title={m.email ?? m.user_id}
            onClick={() => onToggle(m.user_id)}
          >
            <span className="kanban-avatar kanban-avatar--sm">{initials(m.email)}</span>
            {m.user_id === userId ? 'you' : (m.email?.split('@')[0] ?? 'member')}
          </button>
        );
      })}
    </div>
  );
}

function CommentThread({ comments, cardId, taskId, userEmail, busy, confirmKey, setConfirmKey, onRun }: {
  comments: readonly KanbanCommentRow[];
  cardId: string;
  taskId: string | null;
  userEmail: string | null;
  busy: boolean;
  confirmKey: string | null;
  setConfirmKey: (k: string | null) => void;
  onRun: (fn: () => Promise<{ ok: boolean; error?: string }>, okMsg?: string) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState('');

  const handlePost = async () => {
    const body = draft.trim();
    if (!body) return;
    // A typed-out comment is the most painful thing on this board to lose —
    // it survives until the insert actually succeeds.
    if (await onRun(() => createComment(cardId, taskId, body, userEmail))) setDraft('');
  };

  return (
    <div className="kanban-comments">
      {comments.map(c => (
        <div key={c.id} className="kanban-comment">
          <div className="kanban-comment-head">
            <span className="kanban-avatar kanban-avatar--sm">{initials(c.author_email)}</span>
            <span className="kanban-comment-author">{c.author_email ?? 'someone'}</span>
            <span className="kanban-comment-when">{new Date(c.created_at).toLocaleString()}</span>
            {confirmKey === `comment:${c.id}` ? (
              <span className="kanban-confirm">
                <button className="kanban-confirm-yes" disabled={busy} onClick={() => {
                  setConfirmKey(null);
                  onRun(() => deleteComment(c.id));
                }}>Delete</button>
                <button className="kanban-confirm-no" disabled={busy} onClick={() => setConfirmKey(null)}>Cancel</button>
              </span>
            ) : (
              <button className="kanban-icon-btn kanban-icon-danger" title="Delete comment"
                disabled={busy} onClick={() => setConfirmKey(`comment:${c.id}`)}>
                <Trash2 size={11} />
              </button>
            )}
          </div>
          <p className="kanban-comment-body">{c.body}</p>
        </div>
      ))}

      <div className="kanban-add-inline">
        <input
          placeholder={taskId ? 'Comment on this task…' : 'Leave a note for the team…'}
          value={draft}
          disabled={busy}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handlePost();
            // A typed-out comment is the most painful thing here to lose.
            if (e.key === 'Escape') e.stopPropagation();
          }}
        />
        <button className="kanban-add-btn" disabled={busy || !draft.trim()} onClick={handlePost}>Post</button>
      </div>
    </div>
  );
}
