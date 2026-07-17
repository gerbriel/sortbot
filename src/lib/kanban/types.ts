/**
 * kanban/types — the Kanban domain model. TYPE-ONLY: no runtime code, no
 * imports, no dependency on App.tsx. Every other module under src/lib/kanban
 * is a leaf that imports only from here, which is what keeps them unit-testable
 * without a network, a DOM, or a Supabase client.
 *
 * Row types mirror the DB columns from supabase/migrations/kanban_board.sql
 * exactly (snake_case). Node types are the nested shape the UI renders, built
 * by tree.ts. Keep the two apart — the flat rows are what we read/write, the
 * nodes are what we draw.
 */

// ── Flat DB rows ────────────────────────────────────────────────────────────

export interface KanbanColumnRow {
  id: string;
  name: string;
  rank: number;
  /** The lane that means "finished". A card's completion IS its lane. */
  is_done: boolean;
}

export interface KanbanCardRow {
  id: string;
  column_id: string;
  title: string;
  notes: string | null;
  is_epic: boolean;
  rank: number;
  assignee_ids: string[];
  start_date: string | null;
  due_date: string | null;
  end_date: string | null;
  completed_at: string | null;
  created_by: string | null;
  created_by_email: string | null;
  created_at: string;
  updated_at: string;
}

export type TaskStatus = 'todo' | 'in_progress' | 'done';

export interface KanbanTaskRow {
  id: string;
  card_id: string;
  /** Set → this row is a SUBTASK of that task. Null → a top-level task. */
  parent_task_id: string | null;
  title: string;
  notes: string | null;
  status: TaskStatus;
  rank: number;
  assignee_ids: string[];
  start_date: string | null;
  due_date: string | null;
  end_date: string | null;
  completed_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface KanbanCommentRow {
  id: string;
  card_id: string;
  /** Set → the comment is on that task/subtask. Null → on the card itself. */
  task_id: string | null;
  body: string;
  author_id: string | null;
  author_email: string | null;
  created_at: string;
}

/** A workspace member, as the board needs them: id → display name. Sourced
 *  from org_members (which denormalizes email, since auth.users is not
 *  client-readable). */
export interface BoardMember {
  user_id: string;
  email: string | null;
}

// ── Nested display nodes (built by tree.ts) ─────────────────────────────────

export interface TaskNode extends KanbanTaskRow {
  /** Always an array — never undefined, so the UI never needs `?.` */
  subtasks: TaskNode[];
  assignees: BoardMember[];
  comments: KanbanCommentRow[];
}

export interface CardNode extends KanbanCardRow {
  tasks: TaskNode[];
  assignees: BoardMember[];
  /** Comments on the CARD itself. Task comments hang off their TaskNode. */
  comments: KanbanCommentRow[];
}

export interface ColumnNode extends KanbanColumnRow {
  cards: CardNode[];
}

/** Leaf-counted completion rollup. `total === 0` is a real state (a card with
 *  no tasks), so `ratio` is 0 rather than NaN — see progress() in tree.ts. */
export interface Progress {
  done: number;
  total: number;
  ratio: number;
  complete: boolean;
}
