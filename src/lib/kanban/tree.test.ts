import { describe, it, expect } from 'vitest';
import { buildBoardTree, cardProgress, taskProgress } from './tree';
import type {
  BoardMember,
  KanbanCardRow,
  KanbanColumnRow,
  KanbanCommentRow,
  KanbanTaskRow,
  TaskNode,
} from './types';

/**
 * Locks the flat-rows → nested-board transform, the Kanban analogue of
 * grouping.test.ts. The failures these exist to catch are the ones that lose
 * a user's work silently: an orphaned task vanishing, a bad parent chain
 * nesting forever, a removed teammate turning an assignee list into
 * [undefined], and the rollup counting branches instead of leaves.
 */

const col = (id: string, o: Partial<KanbanColumnRow> = {}): KanbanColumnRow =>
  ({ id, name: id, rank: 1000, is_done: false, ...o });

const card = (id: string, column_id: string, o: Partial<KanbanCardRow> = {}): KanbanCardRow =>
  ({
    id, column_id, title: id, notes: null, is_epic: false, rank: 1000,
    assignee_ids: [], start_date: null, due_date: null, end_date: null,
    completed_at: null, created_by: null, created_by_email: null,
    created_at: '2026-07-01T00:00:00Z', updated_at: '2026-07-01T00:00:00Z', ...o,
  });

const task = (id: string, card_id: string, o: Partial<KanbanTaskRow> = {}): KanbanTaskRow =>
  ({
    id, card_id, parent_task_id: null, title: id, notes: null, status: 'todo',
    rank: 1000, assignee_ids: [], start_date: null, due_date: null, end_date: null,
    completed_at: null, created_by: null,
    created_at: '2026-07-01T00:00:00Z', updated_at: '2026-07-01T00:00:00Z', ...o,
  });

const comment = (id: string, card_id: string, o: Partial<KanbanCommentRow> = {}): KanbanCommentRow =>
  ({
    id, card_id, task_id: null, body: id, author_id: null, author_email: null,
    created_at: '2026-07-01T00:00:00Z', ...o,
  });

const member = (user_id: string, email: string | null = `${user_id}@example.com`): BoardMember =>
  ({ user_id, email });

const empty = { columns: [], cards: [], tasks: [], comments: [], members: [] };

describe('buildBoardTree — happy path', () => {
  it('nests columns → cards → tasks → subtasks, each rank-sorted', () => {
    const tree = buildBoardTree({
      ...empty,
      columns: [col('done', { rank: 2000, is_done: true }), col('todo', { rank: 1000 })],
      cards: [card('c2', 'todo', { rank: 2000 }), card('c1', 'todo', { rank: 1000 })],
      tasks: [
        task('t2', 'c1', { rank: 2000 }),
        task('t1', 'c1', { rank: 1000 }),
        task('s2', 'c1', { parent_task_id: 't1', rank: 2000 }),
        task('s1', 'c1', { parent_task_id: 't1', rank: 1000 }),
      ],
    });

    expect(tree.map(c => c.id)).toEqual(['todo', 'done']);
    expect(tree[0].cards.map(c => c.id)).toEqual(['c1', 'c2']);
    expect(tree[0].cards[0].tasks.map(t => t.id)).toEqual(['t1', 't2']);
    expect(tree[0].cards[0].tasks[0].subtasks.map(t => t.id)).toEqual(['s1', 's2']);
    expect(tree[0].cards[1].tasks).toEqual([]);
  });

  it('returns [] not undefined for every empty children array', () => {
    const tree = buildBoardTree({ ...empty, columns: [col('a')], cards: [card('c1', 'a')] });
    expect(tree[0].cards[0].tasks).toEqual([]);
    expect(tree[0].cards[0].comments).toEqual([]);
    expect(tree[0].cards[0].assignees).toEqual([]);
  });

  it('is deterministic — same input twice gives a deep-equal tree', () => {
    const rows = {
      ...empty,
      columns: [col('a'), col('b', { rank: 2000 })],
      cards: [card('c1', 'a'), card('c2', 'b')],
      tasks: [task('t1', 'c1')],
    };
    expect(buildBoardTree(rows)).toEqual(buildBoardTree(rows));
  });

  it('never mutates the input rows', () => {
    const rows = {
      ...empty,
      columns: [col('b', { rank: 2000 }), col('a', { rank: 1000 })],
      cards: [card('c2', 'a', { rank: 2000 }), card('c1', 'a', { rank: 1000 })],
      tasks: [task('t2', 'c1', { rank: 2000 }), task('t1', 'c1', { rank: 1000 })],
    };
    const snapshot = JSON.parse(JSON.stringify(rows));
    buildBoardTree(rows);
    expect(rows).toEqual(snapshot);
  });
});

describe('buildBoardTree — orphans and bad references', () => {
  it('drops a card whose column is gone', () => {
    const tree = buildBoardTree({
      ...empty,
      columns: [col('a')],
      cards: [card('c1', 'a'), card('ghost', 'deleted-column')],
    });
    expect(tree[0].cards.map(c => c.id)).toEqual(['c1']);
  });

  it('drops a task whose card is gone', () => {
    const tree = buildBoardTree({
      ...empty,
      columns: [col('a')],
      cards: [card('c1', 'a')],
      tasks: [task('t1', 'c1'), task('ghost', 'deleted-card')],
    });
    expect(tree[0].cards[0].tasks.map(t => t.id)).toEqual(['t1']);
  });

  it('PROMOTES a subtask whose parent is missing rather than losing it', () => {
    const tree = buildBoardTree({
      ...empty,
      columns: [col('a')],
      cards: [card('c1', 'a')],
      tasks: [task('t1', 'c1'), task('orphan', 'c1', { parent_task_id: 'no-such-task', rank: 2000 })],
    });
    expect(tree[0].cards[0].tasks.map(t => t.id)).toEqual(['t1', 'orphan']);
  });

  it('never nests across cards — a parent in another card promotes instead', () => {
    const tree = buildBoardTree({
      ...empty,
      columns: [col('a')],
      cards: [card('c1', 'a'), card('c2', 'a', { rank: 2000 })],
      tasks: [task('t1', 'c1'), task('x', 'c2', { parent_task_id: 't1' })],
    });
    expect(tree[0].cards[0].tasks[0].subtasks).toEqual([]);
    expect(tree[0].cards[1].tasks.map(t => t.id)).toEqual(['x']);
  });

  it('caps nesting at two levels — a sub-subtask is promoted, never lost', () => {
    const tree = buildBoardTree({
      ...empty,
      columns: [col('a')],
      cards: [card('c1', 'a')],
      tasks: [
        task('t1', 'c1'),
        task('s1', 'c1', { parent_task_id: 't1' }),
        task('deep', 'c1', { parent_task_id: 's1', rank: 3000 }),
      ],
    });
    const tasks = tree[0].cards[0].tasks;
    expect(tasks.map(t => t.id)).toEqual(['t1', 'deep']); // deep promoted, still visible
    expect(tasks[0].subtasks.map(t => t.id)).toEqual(['s1']);
    expect(tasks[0].subtasks[0].subtasks).toEqual([]); // depth never exceeds 2
  });

  it('survives a parent cycle without hanging or dropping rows', () => {
    const tree = buildBoardTree({
      ...empty,
      columns: [col('a')],
      cards: [card('c1', 'a')],
      tasks: [
        task('x', 'c1', { parent_task_id: 'y', rank: 1000 }),
        task('y', 'c1', { parent_task_id: 'x', rank: 2000 }),
      ],
    });
    // Both rows survive; neither nests under the other.
    const ids = tree[0].cards[0].tasks.map(t => t.id).sort();
    expect(ids).toEqual(['x', 'y']);
  });
});

describe('buildBoardTree — assignees', () => {
  it('hydrates multiple assignees in order', () => {
    const tree = buildBoardTree({
      ...empty,
      columns: [col('a')],
      cards: [card('c1', 'a', { assignee_ids: ['u2', 'u1'] })],
      members: [member('u1'), member('u2')],
    });
    expect(tree[0].cards[0].assignees.map(m => m.user_id)).toEqual(['u2', 'u1']);
  });

  it('SKIPS an id with no matching member — a member who left leaves a dangling uuid', () => {
    const tree = buildBoardTree({
      ...empty,
      columns: [col('a')],
      cards: [card('c1', 'a', { assignee_ids: ['u1', 'gone'] })],
      members: [member('u1')],
    });
    expect(tree[0].cards[0].assignees.map(m => m.user_id)).toEqual(['u1']);
  });

  it('dedupes a repeated id', () => {
    const tree = buildBoardTree({
      ...empty,
      columns: [col('a')],
      cards: [card('c1', 'a', { assignee_ids: ['u1', 'u1'] })],
      members: [member('u1')],
    });
    expect(tree[0].cards[0].assignees).toHaveLength(1);
  });

  it('hydrates assignees on tasks and subtasks too', () => {
    const tree = buildBoardTree({
      ...empty,
      columns: [col('a')],
      cards: [card('c1', 'a')],
      tasks: [
        task('t1', 'c1', { assignee_ids: ['u1'] }),
        task('s1', 'c1', { parent_task_id: 't1', assignee_ids: ['u2'] }),
      ],
      members: [member('u1'), member('u2')],
    });
    expect(tree[0].cards[0].tasks[0].assignees.map(m => m.user_id)).toEqual(['u1']);
    expect(tree[0].cards[0].tasks[0].subtasks[0].assignees.map(m => m.user_id)).toEqual(['u2']);
  });
});

describe('buildBoardTree — comments', () => {
  it('routes card comments to the card and task comments to the task', () => {
    const tree = buildBoardTree({
      ...empty,
      columns: [col('a')],
      cards: [card('c1', 'a')],
      tasks: [task('t1', 'c1'), task('s1', 'c1', { parent_task_id: 't1' })],
      comments: [
        comment('cc', 'c1'),
        comment('tc', 'c1', { task_id: 't1' }),
        comment('sc', 'c1', { task_id: 's1' }),
      ],
    });
    const card1 = tree[0].cards[0];
    expect(card1.comments.map(c => c.id)).toEqual(['cc']);
    expect(card1.tasks[0].comments.map(c => c.id)).toEqual(['tc']);
    expect(card1.tasks[0].subtasks[0].comments.map(c => c.id)).toEqual(['sc']);
  });

  it('orders a thread oldest-first', () => {
    const tree = buildBoardTree({
      ...empty,
      columns: [col('a')],
      cards: [card('c1', 'a')],
      comments: [
        comment('second', 'c1', { created_at: '2026-07-02T00:00:00Z' }),
        comment('first', 'c1', { created_at: '2026-07-01T00:00:00Z' }),
      ],
    });
    expect(tree[0].cards[0].comments.map(c => c.id)).toEqual(['first', 'second']);
  });
});

describe('cardProgress — counts LEAVES, not branches', () => {
  const node = (tasks: Partial<TaskNode>[]) =>
    ({ tasks: tasks.map(t => ({ status: 'todo', subtasks: [], ...t })) } as Pick<import('./types').CardNode, 'tasks'>);

  it('a card with no tasks is 0 of 0, ratio 0 (never NaN) and NOT complete', () => {
    const p = cardProgress({ tasks: [] });
    expect(p).toEqual({ done: 0, total: 0, ratio: 0, complete: false });
    expect(Number.isNaN(p.ratio)).toBe(false);
  });

  it('counts subtasks, not the parent task — 2 tasks x 3 subtasks with 3 done is 3 of 6', () => {
    const p = cardProgress(node([
      { subtasks: [{ status: 'done' }, { status: 'done' }, { status: 'done' }] as TaskNode[] },
      { subtasks: [{ status: 'todo' }, { status: 'todo' }, { status: 'todo' }] as TaskNode[] },
    ]));
    expect(p.done).toBe(3);
    expect(p.total).toBe(6);
    expect(p.ratio).toBe(0.5);
  });

  it('a task WITHOUT subtasks counts as one leaf, alongside tasks that have them', () => {
    const p = cardProgress(node([
      { status: 'done' },                                              // leaf itself
      { subtasks: [{ status: 'done' }, { status: 'todo' }] as TaskNode[] }, // 2 leaves
    ]));
    expect(p.done).toBe(2);
    expect(p.total).toBe(3);
  });

  it('a done parent does NOT shortcut its unfinished subtasks', () => {
    const p = cardProgress(node([
      { status: 'done', subtasks: [{ status: 'todo' }, { status: 'todo' }] as TaskNode[] },
    ]));
    expect(p).toMatchObject({ done: 0, total: 2, complete: false });
  });

  it('complete only when total > 0 and every leaf is done', () => {
    expect(cardProgress(node([{ status: 'done' }])).complete).toBe(true);
    expect(cardProgress(node([{ status: 'done' }, { status: 'in_progress' }])).complete).toBe(false);
  });
});

describe('taskProgress', () => {
  it('a task with no subtasks reports itself as one leaf', () => {
    expect(taskProgress({ status: 'done', subtasks: [] })).toMatchObject({ done: 1, total: 1, complete: true });
    expect(taskProgress({ status: 'todo', subtasks: [] })).toMatchObject({ done: 0, total: 1, complete: false });
    expect(taskProgress({ status: 'in_progress', subtasks: [] })).toMatchObject({ done: 0, total: 1 });
  });

  it('a task with subtasks reports its subtasks', () => {
    const p = taskProgress({
      status: 'todo',
      subtasks: [{ status: 'done' }, { status: 'todo' }] as TaskNode[],
    });
    expect(p).toMatchObject({ done: 1, total: 2, ratio: 0.5, complete: false });
  });
});
