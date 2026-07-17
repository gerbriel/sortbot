import { supabase } from './supabase';
import { log } from './debugLogger';
import { RANK_STEP, rebalance } from './kanban/rank';
import type {
  BoardMember,
  KanbanCardRow,
  KanbanColumnRow,
  KanbanCommentRow,
  KanbanTaskRow,
  TaskStatus,
} from './kanban/types';

/**
 * kanbanService — CRUD for the Kanban board (supabase/migrations/kanban_board.sql).
 *
 * SECURITY: every table is org-scoped with org_id DEFAULT default_org_id(), so
 * this module never PASSES org_id on insert — the DB tags the row. Any member of
 * the workspace can read and write the whole board.
 *
 * Reads DO filter by org_id, which is not the `.eq('user_id')` anti-pattern
 * CLAUDE.md §18 bans. RLS decides PERMISSION; it cannot decide SCOPE. Its test
 * is `org_id in (select user_org_ids())` — every org you belong to — so the day
 * anyone holds two memberships, an unfiltered read merges both boards into one
 * (two "Backlog" lanes, foreign cards interleaved by rank). The filter names the
 * workspace being VIEWED; RLS still decides whether you may see it at all.
 *
 * FORWARD-COMPATIBLE: if kanban_board.sql has not been run, fetchBoard reports
 * 'unavailable' and the board shows a "run the migration" panel instead of an
 * error. Shipping this code before running the SQL is safe.
 *
 * All the ordering/nesting logic lives in the pure, unit-tested modules under
 * src/lib/kanban/ — this file is only queries plus calls into them.
 */

const DEFAULT_COLUMNS: Array<{ name: string; is_done: boolean }> = [
  { name: 'Backlog', is_done: false },
  { name: 'To do', is_done: false },
  { name: 'In progress', is_done: false },
  { name: 'In review', is_done: false },
  { name: 'Done', is_done: true },
];

export interface BoardData {
  columns: KanbanColumnRow[];
  cards: KanbanCardRow[];
  tasks: KanbanTaskRow[];
  comments: KanbanCommentRow[];
  members: BoardMember[];
}

export type BoardResult =
  | { status: 'ok'; board: BoardData }
  | { status: 'unavailable' };

const COLUMN_COLS = 'id, name, rank, is_done';
const CARD_COLS =
  'id, column_id, title, notes, is_epic, rank, assignee_ids, start_date, due_date, end_date, completed_at, created_by, created_by_email, created_at, updated_at';
const TASK_COLS =
  'id, card_id, parent_task_id, title, notes, status, rank, assignee_ids, start_date, due_date, end_date, completed_at, created_by, created_at, updated_at';
const COMMENT_COLS = 'id, card_id, task_id, body, author_id, author_email, created_at';

/**
 * Load the whole board for the caller's workspace in four parallel queries,
 * plus the member roster (for assignee names). Any error at all — table missing
 * because the migration has not been run, or anything else — reports
 * 'unavailable' so the UI hides rather than showing a broken board.
 */
export async function fetchBoard(orgId: string): Promise<BoardResult> {
  try {
    const [columns, cards, tasks, comments, members] = await Promise.all([
      supabase.from('kanban_columns').select(COLUMN_COLS).eq('org_id', orgId).order('rank', { ascending: true }),
      supabase.from('kanban_cards').select(CARD_COLS).eq('org_id', orgId).order('rank', { ascending: true }),
      supabase.from('kanban_tasks').select(TASK_COLS).eq('org_id', orgId).order('rank', { ascending: true }),
      supabase.from('kanban_comments').select(COMMENT_COLS).eq('org_id', orgId).order('created_at', { ascending: true }),
      supabase.from('org_members').select('user_id, email').eq('org_id', orgId),
    ]);

    const failed = columns.error || cards.error || tasks.error || comments.error;
    if (failed) {
      // Table missing (migration not run) or any other failure → hide the UI.
      log.kanban(`fetchBoard | unavailable (${failed.code ?? ''} ${failed.message})`);
      return { status: 'unavailable' };
    }

    return {
      status: 'ok',
      board: {
        columns: (columns.data ?? []) as KanbanColumnRow[],
        cards: (cards.data ?? []) as KanbanCardRow[],
        tasks: (tasks.data ?? []) as KanbanTaskRow[],
        comments: (comments.data ?? []) as KanbanCommentRow[],
        // The roster is cosmetic (assignee names) — an error here must not take
        // the board down with it.
        members: (members.data ?? []) as BoardMember[],
      },
    };
  } catch (err) {
    log.error(`fetchBoard | unexpected: ${String(err)}`);
    return { status: 'unavailable' };
  }
}

/**
 * Create the default lanes for a workspace that has none. Called only when
 * fetchBoard returns zero columns. The unique index on (org_id, lower(name))
 * makes a StrictMode double-invoke land on 23505 instead of creating a second
 * set of lanes, so a duplicate-key error here is success, not a failure.
 */
export async function ensureColumns(): Promise<{ ok: boolean; error?: string }> {
  const rows = DEFAULT_COLUMNS.map((c, i) => ({ ...c, rank: (i + 1) * RANK_STEP }));
  const { error } = await supabase.from('kanban_columns').insert(rows);
  if (error) {
    if (error.code === '23505') return { ok: true }; // raced — the lanes exist
    log.kanban(`ensureColumns | ${error.message}`);
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

// ── Columns ─────────────────────────────────────────────────────────────────

export async function createColumn(name: string, rank: number): Promise<{ ok: boolean; error?: string }> {
  const cleaned = name.trim();
  if (!cleaned) return { ok: false, error: 'Lane name cannot be empty.' };
  const { error } = await supabase.from('kanban_columns').insert({ name: cleaned, rank });
  if (error) {
    if (error.code === '23505') return { ok: false, error: `A "${cleaned}" lane already exists.` };
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

export async function updateColumn(
  id: string,
  patch: Partial<Pick<KanbanColumnRow, 'name' | 'rank' | 'is_done'>>,
): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await supabase.from('kanban_columns').update(patch).eq('id', id).select('id');
  if (error) {
    if (error.code === '23505') return { ok: false, error: 'A lane with that name already exists.' };
    return { ok: false, error: error.message };
  }
  if (!data || data.length === 0) return { ok: false, error: 'No permission to edit this board.' };
  return { ok: true };
}

/** Deleting a lane cascades to its cards, their tasks and their comments. */
export async function deleteColumn(id: string): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await supabase.from('kanban_columns').delete().eq('id', id).select('id');
  if (error) { log.kanban(`deleteColumn | ${error.message}`); return { ok: false, error: error.message }; }
  if (!data || data.length === 0) return { ok: false, error: 'No permission to delete this lane.' };
  return { ok: true };
}

// ── Cards ───────────────────────────────────────────────────────────────────

export async function createCard(
  columnId: string,
  title: string,
  rank: number,
  createdByEmail: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const cleaned = title.trim();
  if (!cleaned) return { ok: false, error: 'Card title cannot be empty.' };
  const { error } = await supabase.from('kanban_cards').insert({
    column_id: columnId,
    title: cleaned,
    rank,
    created_by_email: createdByEmail,
  });
  if (error) { log.kanban(`createCard | ${error.message}`); return { ok: false, error: error.message }; }
  return { ok: true };
}

export type CardPatch = Partial<
  Pick<
    KanbanCardRow,
    'column_id' | 'title' | 'notes' | 'is_epic' | 'rank' | 'assignee_ids'
    | 'start_date' | 'due_date' | 'end_date' | 'completed_at'
  >
>;

export async function updateCard(id: string, patch: CardPatch): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await supabase
    .from('kanban_cards')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('id');
  if (error) { log.kanban(`updateCard | ${error.message}`); return { ok: false, error: error.message }; }
  if (!data || data.length === 0) return { ok: false, error: 'No permission to edit this board.' };
  return { ok: true };
}

/**
 * Move a card to a lane at a computed rank. `completedAt` is passed explicitly
 * by the caller (which knows whether the destination lane is the done lane) so
 * this stays a dumb write — the rule lives in one place in the component, not
 * split between the UI and the service.
 */
export async function moveCard(
  id: string,
  columnId: string,
  rank: number,
  completedAt: string | null,
): Promise<{ ok: boolean; error?: string }> {
  return updateCard(id, { column_id: columnId, rank, completed_at: completedAt });
}

export async function deleteCard(id: string): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await supabase.from('kanban_cards').delete().eq('id', id).select('id');
  if (error) { log.kanban(`deleteCard | ${error.message}`); return { ok: false, error: error.message }; }
  if (!data || data.length === 0) return { ok: false, error: 'No permission to delete this card.' };
  return { ok: true };
}

/** Rewrite a lane's ranks after needsRebalance() fires. One row per card. */
export async function rebalanceCards(
  laneCards: ReadonlyArray<{ id: string; rank: number }>,
): Promise<{ ok: boolean; error?: string }> {
  const fixed = rebalance(laneCards);
  for (const { id, rank } of fixed) {
    // .select('id') like every other write here: an RLS-blocked update returns
    // 0 rows with NO error, and a half-rebalanced lane is a scrambled lane.
    const { data, error } = await supabase
      .from('kanban_cards').update({ rank }).eq('id', id).select('id');
    if (error) { log.kanban(`rebalanceCards | ${error.message}`); return { ok: false, error: error.message }; }
    if (!data || data.length === 0) return { ok: false, error: 'No permission to reorder this board.' };
  }
  log.kanban(`rebalanceCards | rewrote ${fixed.length} ranks`);
  return { ok: true };
}

// ── Tasks and subtasks ──────────────────────────────────────────────────────

export async function createTask(
  cardId: string,
  title: string,
  rank: number,
  parentTaskId: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const cleaned = title.trim();
  if (!cleaned) return { ok: false, error: 'Task title cannot be empty.' };
  const { error } = await supabase.from('kanban_tasks').insert({
    card_id: cardId,
    parent_task_id: parentTaskId,
    title: cleaned,
    rank,
  });
  if (error) { log.kanban(`createTask | ${error.message}`); return { ok: false, error: error.message }; }
  return { ok: true };
}

export type TaskPatch = Partial<
  Pick<
    KanbanTaskRow,
    'title' | 'notes' | 'status' | 'rank' | 'assignee_ids'
    | 'start_date' | 'due_date' | 'end_date' | 'completed_at'
  >
>;

export async function updateTask(id: string, patch: TaskPatch): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await supabase
    .from('kanban_tasks')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('id');
  if (error) { log.kanban(`updateTask | ${error.message}`); return { ok: false, error: error.message }; }
  if (!data || data.length === 0) return { ok: false, error: 'No permission to edit this board.' };
  return { ok: true };
}

/**
 * Set a task's status, keeping completed_at consistent with it in the SAME
 * write — so a task can never be 'done' with no completion date, or carry a
 * stale one after being reopened (dates.ts treats any completed_at as "never
 * overdue", which would be wrong for a reopened task).
 */
export async function setTaskStatus(id: string, status: TaskStatus): Promise<{ ok: boolean; error?: string }> {
  return updateTask(id, {
    status,
    completed_at: status === 'done' ? new Date().toISOString() : null,
  });
}

/** Deleting a task cascades to its subtasks and to every comment on them. */
export async function deleteTask(id: string): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await supabase.from('kanban_tasks').delete().eq('id', id).select('id');
  if (error) { log.kanban(`deleteTask | ${error.message}`); return { ok: false, error: error.message }; }
  if (!data || data.length === 0) return { ok: false, error: 'No permission to delete this task.' };
  return { ok: true };
}

// ── Comments ────────────────────────────────────────────────────────────────

/** `taskId` null → the comment is on the card itself. card_id is always set so
 *  deleting the card cascades every comment beneath it. */
export async function createComment(
  cardId: string,
  taskId: string | null,
  body: string,
  authorEmail: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const cleaned = body.trim();
  if (!cleaned) return { ok: false, error: 'Comment cannot be empty.' };
  const { error } = await supabase.from('kanban_comments').insert({
    card_id: cardId,
    task_id: taskId,
    body: cleaned,
    author_email: authorEmail,
  });
  if (error) { log.kanban(`createComment | ${error.message}`); return { ok: false, error: error.message }; }
  return { ok: true };
}

export async function deleteComment(id: string): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await supabase.from('kanban_comments').delete().eq('id', id).select('id');
  if (error) { log.kanban(`deleteComment | ${error.message}`); return { ok: false, error: error.message }; }
  if (!data || data.length === 0) return { ok: false, error: 'No permission to delete this comment.' };
  return { ok: true };
}
