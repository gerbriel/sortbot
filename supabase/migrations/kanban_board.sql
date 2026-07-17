-- ============================================================================
-- KANBAN BOARD — per-workspace feature/todo tracking (columns, cards, tasks,
--                subtasks, assignees, comments)
-- ============================================================================
-- Run AFTER multi_org_tenancy.sql (reuses default_org_id() and user_org_ids()).
-- Purely additive; idempotent; rollback at the bottom. Nothing else in the app
-- reads or writes these tables — dropping them cannot affect the listing flow.
--
-- MODEL: ordinary ORG-SCOPED data, exactly like workflow_batches/products.
--   * Every table carries org_id with DEFAULT public.default_org_id(), so the
--     client NEVER passes org_id on insert — RLS + the default do the work.
--   * ANY member of the workspace can read AND write the whole board (create
--     cards, tick tasks, comment). This is deliberate: a board that only
--     admins can edit is not a team board. There is no is_org_admin() gate
--     anywhere below — contrast org_shopify_connections.sql, where the token
--     genuinely needs one.
--   * Cross-org isolation is total: org_id in (select public.user_org_ids()).
--   * AUTHORSHIP IS THE ONE THING YOU MAY NOT SELF-ASSERT. "Any member can
--     edit any content" must not extend to "any member can sign a comment as
--     someone else". A DEFAULT only applies when a column is OMITTED, so
--     created_by/author_id would otherwise be free-form on insert — a member
--     with devtools could post a comment as the founder. Two mechanisms close
--     it, because RLS alone cannot:
--       INSERT — the with-check pins the id to auth.uid() and the denormalized
--                email to the caller's own JWT email.
--       UPDATE — column-level grants simply omit the authorship columns, so
--                they are immutable after insert. (A with-check cannot do this
--                job: editing a TEAMMATE's card is legitimate, so the policy
--                can never require created_by = auth.uid() on update.)
--
-- The app currently only SHOWS the board to Founding Workspace members (the
-- header button is gated client-side, like the Vocabulary dashboard). The
-- schema is deliberately not founding-only — opening it to every workspace
-- later is a one-line change in App.tsx with no migration.
--
-- SHAPE:
--   kanban_columns   the lanes (Backlog / To do / In progress / Done).
--                    is_done marks the lane that means "finished" — a card's
--                    status IS its column, so there is exactly one source of
--                    truth for card completion (no status column on cards to
--                    disagree with it).
--   kanban_cards     one card per unit of work. is_epic is a display flag for
--                    big cards broken down into many tasks.
--   kanban_tasks     tasks belong to a card; a task with parent_task_id set IS
--                    a subtask (self-referencing, cascade). Tasks carry their
--                    OWN status because they are not in a lane.
--   kanban_comments  notes to each other. card_id is always set (so a card
--                    delete cascades every comment under it); task_id is set
--                    when the comment is on a task/subtask rather than the card.
--
-- ORDERING: rank is `double precision`, not an int position. Dropping a card
--   between two neighbours writes ONE row (the midpoint of their ranks) instead
--   of renumbering the column, so two people dragging at once cannot clobber
--   each other's order. src/lib/kanban/rank.ts owns the math and detects the
--   float-exhaustion case (~20 midpoints into the same slot) so the client can
--   rebalance the lane. See rank.test.ts.
--
-- ASSIGNEES: uuid[] rather than a join table. Multi-assign is a plain array
--   write, the board loads in 4 queries instead of 6, and org_members already
--   carries the denormalized email the UI needs to render a name. The tradeoff
--   is no FK on the array — a removed member leaves a dangling uuid, which the
--   client tolerates by skipping unknown ids (locked by tree.test.ts).
-- ============================================================================


-- ── 1. Tables ───────────────────────────────────────────────────────────────

create table if not exists public.kanban_columns (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations(id) on delete cascade default public.default_org_id(),
  name       text not null,
  rank       double precision not null default 1000,
  is_done    boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.kanban_cards (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade default public.default_org_id(),
  column_id    uuid not null references public.kanban_columns(id) on delete cascade,
  title        text not null,
  notes        text,
  is_epic      boolean not null default false,
  rank         double precision not null default 1000,
  assignee_ids uuid[] not null default '{}',
  start_date   date,
  due_date     date,
  end_date     date,
  completed_at timestamptz,
  created_by   uuid references auth.users(id) on delete set null default auth.uid(),
  created_by_email text,  -- denormalized for display (auth.users is not client-readable)
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists public.kanban_tasks (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations(id) on delete cascade default public.default_org_id(),
  card_id        uuid not null references public.kanban_cards(id) on delete cascade,
  parent_task_id uuid references public.kanban_tasks(id) on delete cascade,  -- set → this row is a SUBTASK
  title          text not null,
  notes          text,
  status         text not null default 'todo' check (status in ('todo','in_progress','done')),
  rank           double precision not null default 1000,
  assignee_ids   uuid[] not null default '{}',
  start_date     date,
  due_date       date,
  end_date       date,
  completed_at   timestamptz,
  created_by     uuid references auth.users(id) on delete set null default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table if not exists public.kanban_comments (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade default public.default_org_id(),
  card_id      uuid not null references public.kanban_cards(id) on delete cascade,
  task_id      uuid references public.kanban_tasks(id) on delete cascade,  -- set → comment is on a task/subtask
  body         text not null,
  author_id    uuid references auth.users(id) on delete set null default auth.uid(),
  author_email text,  -- denormalized for display (auth.users is not client-readable)
  created_at   timestamptz not null default now()
);


-- ── 2. Indexes ──────────────────────────────────────────────────────────────
-- Every board load filters by org_id; every child list filters by its parent.

create index if not exists kanban_columns_org_idx   on public.kanban_columns (org_id);
create index if not exists kanban_cards_org_idx     on public.kanban_cards (org_id);
create index if not exists kanban_cards_column_idx  on public.kanban_cards (column_id);
create index if not exists kanban_tasks_org_idx     on public.kanban_tasks (org_id);
create index if not exists kanban_tasks_card_idx    on public.kanban_tasks (card_id);
create index if not exists kanban_tasks_parent_idx  on public.kanban_tasks (parent_task_id);
create index if not exists kanban_comments_org_idx  on public.kanban_comments (org_id);
create index if not exists kanban_comments_card_idx on public.kanban_comments (card_id);

-- One lane per name per workspace. This is what makes the client's
-- "seed default columns when the board is empty" safe under React StrictMode:
-- a racing double-invoke hits 23505 on the second insert instead of creating
-- a duplicate set of lanes.
create unique index if not exists kanban_columns_org_name_uidx
  on public.kanban_columns (org_id, lower(name));


-- ── 3. RLS — org members only, all four verbs, no admin gate ────────────────

alter table public.kanban_columns  enable row level security;
alter table public.kanban_cards    enable row level security;
alter table public.kanban_tasks    enable row level security;
alter table public.kanban_comments enable row level security;

grant select, insert, delete on public.kanban_columns, public.kanban_cards,
  public.kanban_tasks, public.kanban_comments to authenticated;

-- UPDATE is granted per COLUMN: the authorship columns are deliberately absent,
-- which makes them immutable after insert. org_id is absent too, so a row can
-- never be moved into another workspace. Everything a teammate may legitimately
-- edit is listed.
--
-- The revoke is what makes the column grants idempotent: a table-wide UPDATE
-- grant left over from an earlier run of this file would otherwise survive and
-- silently re-open the authorship columns. Column grants do not replace it.
revoke update on public.kanban_columns, public.kanban_cards,
  public.kanban_tasks, public.kanban_comments from authenticated;

grant update (name, rank, is_done) on public.kanban_columns to authenticated;
grant update (column_id, title, notes, is_epic, rank, assignee_ids,
  start_date, due_date, end_date, completed_at, updated_at)
  on public.kanban_cards to authenticated;
grant update (parent_task_id, title, notes, status, rank, assignee_ids,
  start_date, due_date, end_date, completed_at, updated_at)
  on public.kanban_tasks to authenticated;
grant update (body) on public.kanban_comments to authenticated;

-- SELECT / DELETE / UPDATE: plain org membership — any member, any row.
-- The INSERT check also rejects org_id NULL (NULL in (...) is not true), so the
-- DEFAULT above is effectively mandatory — a client cannot insert an untagged row.
do $$
declare t text;
begin
  foreach t in array array['kanban_columns','kanban_cards','kanban_tasks','kanban_comments'] loop
    execute format('drop policy if exists %I on public.%I', 'kanban_select_'||t, t);
    execute format('drop policy if exists %I on public.%I', 'kanban_insert_'||t, t);
    execute format('drop policy if exists %I on public.%I', 'kanban_update_'||t, t);
    execute format('drop policy if exists %I on public.%I', 'kanban_delete_'||t, t);
    execute format('create policy %I on public.%I for select to authenticated using (org_id in (select public.user_org_ids()))', 'kanban_select_'||t, t);
    execute format('create policy %I on public.%I for update to authenticated using (org_id in (select public.user_org_ids())) with check (org_id in (select public.user_org_ids()))', 'kanban_update_'||t, t);
    execute format('create policy %I on public.%I for delete to authenticated using (org_id in (select public.user_org_ids()))', 'kanban_delete_'||t, t);
  end loop;
end $$;

-- INSERT: org membership AND self-asserted authorship only. `my_email()` keeps
-- the JWT lookup in one place; invited_role() in multi_org_tenancy.sql reads the
-- claim the same way.
create or replace function public.my_email()
returns text
language sql stable
set search_path = public
as $$
  select lower(coalesce(auth.jwt()->>'email',''))
$$;

grant execute on function public.my_email() to authenticated;

-- Lanes carry no authorship — membership is the whole check.
create policy kanban_insert_kanban_columns on public.kanban_columns for insert
  to authenticated
  with check (org_id in (select public.user_org_ids()));

create policy kanban_insert_kanban_cards on public.kanban_cards for insert
  to authenticated
  with check (
    org_id in (select public.user_org_ids())
    and (created_by is null or created_by = auth.uid())
    and (created_by_email is null or lower(created_by_email) = public.my_email())
  );

create policy kanban_insert_kanban_tasks on public.kanban_tasks for insert
  to authenticated
  with check (
    org_id in (select public.user_org_ids())
    and (created_by is null or created_by = auth.uid())
  );

create policy kanban_insert_kanban_comments on public.kanban_comments for insert
  to authenticated
  with check (
    org_id in (select public.user_org_ids())
    and (author_id is null or author_id = auth.uid())
    and (author_email is null or lower(author_email) = public.my_email())
  );


-- ── 4. Seed: default lanes for the Founding Workspace ───────────────────────
-- Only seeds an org that has NO lanes yet, so re-running never duplicates and
-- never resurrects a lane someone deliberately deleted. Other workspaces get
-- the same set created client-side on first open (kanbanService.ensureColumns).

insert into public.kanban_columns (org_id, name, rank, is_done)
select o.id, v.name, v.rank, v.is_done
from public.organizations o
cross join (values
  ('Backlog',     1000.0, false),
  ('To do',       2000.0, false),
  ('In progress', 3000.0, false),
  ('In review',   4000.0, false),
  ('Done',        5000.0, true)
) as v(name, rank, is_done)
where o.slug = 'founding'
  and not exists (select 1 from public.kanban_columns c where c.org_id = o.id)
on conflict do nothing;


-- ── VERIFY (run separately) ─────────────────────────────────────────────────
--   select name, rank, is_done from public.kanban_columns
--     where org_id = (select id from public.organizations where slug = 'founding')
--     order by rank;                                  -- 5 lanes, Backlog → Done
--   select count(*) from public.kanban_cards;         -- 0 on a fresh install
--   -- Cross-org leak check — must return 0 for a non-member:
--   select count(*) from public.kanban_cards
--     where org_id not in (select public.user_org_ids());
--   -- Authorship is immutable: this must FAIL with "permission denied for
--   -- column created_by" when run as an ordinary signed-in member, NOT succeed:
--   update public.kanban_cards set created_by = auth.uid() where true;

-- ── ROLLBACK ────────────────────────────────────────────────────────────────
-- Reverse creation order — children first (comments/tasks reference cards).
-- drop table if exists public.kanban_comments;
-- drop table if exists public.kanban_tasks;
-- drop table if exists public.kanban_cards;
-- drop table if exists public.kanban_columns;
-- drop function if exists public.my_email();
