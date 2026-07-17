/**
 * kanban/tree — flat DB rows → the nested board the UI renders, plus the
 * completion rollup.
 *
 * This is the Kanban analogue of lib/grouping.ts: the FULL flat lists go in,
 * a sorted nested structure comes out, and every reference that does not
 * resolve is dropped rather than crashing or duplicating. The rules, stated
 * once so the tests can lock them:
 *
 *   * A card whose column_id matches no column is DROPPED (its lane was
 *     deleted; the DB cascade normally deletes the card too, so this only
 *     covers a partial read).
 *   * A task whose card_id matches no card is DROPPED.
 *   * A task with parent_task_id set is a SUBTASK of that task. If the parent
 *     id resolves to no task IN THE SAME CARD, the row is promoted to a
 *     top-level task rather than vanishing — losing a real task is worse than
 *     showing it at the wrong depth.
 *   * Nesting is exactly two levels (task → subtask). A subtask's own children
 *     are promoted to subtasks of the same task, so a bad parent chain can
 *     never produce infinite depth or a cycle.
 *   * An assignee uuid with no matching member is SKIPPED (the member left the
 *     workspace; the array has no FK). Duplicate ids dedupe.
 *   * Every children array is [] when empty, never undefined.
 *
 * Pure, deterministic, non-mutating: the input arrays are copied before any
 * sort. Same input twice → deep-equal output. See tree.test.ts.
 */

import type {
  BoardMember,
  CardNode,
  ColumnNode,
  KanbanCardRow,
  KanbanColumnRow,
  KanbanCommentRow,
  KanbanTaskRow,
  Progress,
  TaskNode,
} from './types';
import { byRank } from './rank';

export interface BoardRows {
  columns: readonly KanbanColumnRow[];
  cards: readonly KanbanCardRow[];
  tasks: readonly KanbanTaskRow[];
  comments: readonly KanbanCommentRow[];
  members: readonly BoardMember[];
}

/** Resolve an assignee id list against the workspace roster: unknown ids are
 *  skipped (no FK on the array), duplicates collapse, order is preserved. */
function resolveAssignees(ids: readonly string[], byId: Map<string, BoardMember>): BoardMember[] {
  const out: BoardMember[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const m = byId.get(id);
    if (m) out.push(m);
  }
  return out;
}

/** Build the whole board. Columns sorted by rank; cards within a column sorted
 *  by rank; tasks and subtasks sorted by rank. */
export function buildBoardTree(rows: BoardRows): ColumnNode[] {
  const memberById = new Map<string, BoardMember>();
  for (const m of rows.members) memberById.set(m.user_id, m);

  // Comments split by target: card-level vs task-level.
  const cardComments = new Map<string, KanbanCommentRow[]>();
  const taskComments = new Map<string, KanbanCommentRow[]>();
  for (const c of rows.comments) {
    const bucket = c.task_id ? taskComments : cardComments;
    const key = c.task_id ?? c.card_id;
    const list = bucket.get(key);
    if (list) list.push(c);
    else bucket.set(key, [c]);
  }
  // Oldest first — a comment thread reads top-down.
  for (const list of cardComments.values()) list.sort(byCreatedAt);
  for (const list of taskComments.values()) list.sort(byCreatedAt);

  const cardIds = new Set(rows.cards.map(c => c.id));

  // Tasks grouped by card, with the parent/child split resolved per card so a
  // parent_task_id pointing into a DIFFERENT card cannot nest across cards.
  const tasksByCard = new Map<string, KanbanTaskRow[]>();
  for (const t of rows.tasks) {
    if (!cardIds.has(t.card_id)) continue; // orphan task — card is gone
    const list = tasksByCard.get(t.card_id);
    if (list) list.push(t);
    else tasksByCard.set(t.card_id, [t]);
  }

  const buildTasks = (cardId: string): TaskNode[] => {
    const all = tasksByCard.get(cardId) ?? [];
    const idsInCard = new Set(all.map(t => t.id));

    // ONE rule, applied twice — that is the whole depth/cycle story:
    //   A row is a SUBTASK iff its parent_task_id resolves to a TOP-LEVEL task
    //   in this same card. Everything else is top-level.
    // A row whose parent is itself a subtask (depth 3+), whose parent lives in
    // another card, or whose parent chain forms a cycle, is therefore promoted
    // to top-level: it stays visible and depth can never exceed 2.
    const isTop = (t: KanbanTaskRow) => !t.parent_task_id || !idsInCard.has(t.parent_task_id);
    const topIds = new Set(all.filter(isTop).map(t => t.id));

    const childrenOf = new Map<string, KanbanTaskRow[]>();
    const tops: KanbanTaskRow[] = [];
    for (const t of all) {
      const parent = t.parent_task_id;
      if (parent && topIds.has(parent)) {
        const list = childrenOf.get(parent);
        if (list) list.push(t);
        else childrenOf.set(parent, [t]);
      } else {
        tops.push(t);
      }
    }

    return tops
      .sort((a, b) => byRank(a, b))
      .map(t => ({
        ...t,
        subtasks: (childrenOf.get(t.id) ?? [])
          .slice()
          .sort((a, b) => byRank(a, b))
          .map(st => ({
            ...st,
            subtasks: [],
            assignees: resolveAssignees(st.assignee_ids ?? [], memberById),
            comments: taskComments.get(st.id) ?? [],
          })),
        assignees: resolveAssignees(t.assignee_ids ?? [], memberById),
        comments: taskComments.get(t.id) ?? [],
      }));
  };

  const columnIds = new Set(rows.columns.map(c => c.id));
  const cardsByColumn = new Map<string, CardNode[]>();
  for (const card of rows.cards) {
    if (!columnIds.has(card.column_id)) continue; // orphan card — lane is gone
    const node: CardNode = {
      ...card,
      tasks: buildTasks(card.id),
      assignees: resolveAssignees(card.assignee_ids ?? [], memberById),
      comments: cardComments.get(card.id) ?? [],
    };
    const list = cardsByColumn.get(card.column_id);
    if (list) list.push(node);
    else cardsByColumn.set(card.column_id, [node]);
  }

  return [...rows.columns]
    .sort((a, b) => byRank(a, b))
    .map(col => ({
      ...col,
      cards: (cardsByColumn.get(col.id) ?? []).slice().sort((a, b) => byRank(a, b)),
    }));
}

function byCreatedAt(a: KanbanCommentRow, b: KanbanCommentRow): number {
  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

// ── Progress rollup ─────────────────────────────────────────────────────────

/**
 * Completion of a card, counted over LEAVES.
 *
 * The rule, stated once because "2 tasks, one with 3 subtasks" has two
 * plausible answers and having both in different components is the bug:
 *   * A task WITH subtasks contributes its subtasks, not itself. Ticking the
 *     parent is not a shortcut past its children.
 *   * A task WITHOUT subtasks contributes itself, as one leaf.
 *   * `complete` is true only when total > 0 && done === total. A card with no
 *     tasks is NOT complete-by-vacuity — its completion is its lane, not this.
 */
export function cardProgress(card: Pick<CardNode, 'tasks'>): Progress {
  let done = 0;
  let total = 0;
  for (const t of card.tasks) {
    if (t.subtasks.length > 0) {
      for (const st of t.subtasks) {
        total++;
        if (st.status === 'done') done++;
      }
    } else {
      total++;
      if (t.status === 'done') done++;
    }
  }
  return progress(done, total);
}

/** Completion of one task over its subtasks. A task with no subtasks reports
 *  itself: 1/1 when done, 0/1 otherwise — so the UI can render one bar shape. */
export function taskProgress(task: Pick<TaskNode, 'status' | 'subtasks'>): Progress {
  if (task.subtasks.length === 0) {
    return progress(task.status === 'done' ? 1 : 0, 1);
  }
  const done = task.subtasks.filter(st => st.status === 'done').length;
  return progress(done, task.subtasks.length);
}

function progress(done: number, total: number): Progress {
  return {
    done,
    total,
    ratio: total === 0 ? 0 : done / total, // never NaN
    complete: total > 0 && done === total,
  };
}
