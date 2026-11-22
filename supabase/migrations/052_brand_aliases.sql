-- ============================================================================
-- BRAND ALIASES — per-workspace "the mic heard X, the tag says Y"
-- ============================================================================
-- Run AFTER multi_org_tenancy.sql (reuses default_org_id(), user_org_ids() and
-- my_email() from kanban_board.sql). Purely additive; idempotent; rollback at
-- the bottom. Nothing else in the app reads or writes this table — dropping it
-- degrades Step 3 back to today's behaviour and breaks nothing.
--
-- WHY: speech-to-text returns the ENGLISH word it heard, and clothing labels are
-- deliberately misspelled. "Ecko Unltd" comes back as "echo unlimited", "Fubu"
-- as "foo boo", "Le Tigre" as "la tiger". The wrong string then flows into the
-- title, the tags and the CSV, so the seller retypes the same correction on
-- every listing. One row here ends that for the whole workspace.
--
-- MODEL: ordinary ORG-SCOPED USER DATA, exactly like kanban_board.
--   * org_id carries DEFAULT public.default_org_id(), so the client NEVER passes
--     org_id on insert — RLS plus the default do the work.
--   * ANY member of the workspace may add, edit and delete an alias. This is
--     deliberate and is the difference from descriptor_chips / brand_keywords
--     (vocab_tables.sql), which are FOUNDER chrome gated on is_beta_admin():
--     those are the global vocabulary every tenant consumes, this is one shop's
--     own spelling of its own inventory. There is no is_org_admin() gate below.
--   * Cross-org isolation is total: org_id in (select public.user_org_ids()).
--   * AUTHORSHIP IS NOT SELF-ASSERTABLE. "Any member can edit any row" must not
--     become "any member can sign a row as the founder". As in kanban_board:
--       INSERT — the with-check pins created_by to auth.uid() and the
--                denormalized email to the caller's own JWT email.
--       UPDATE — column-level grants omit the authorship columns (and org_id),
--                making them immutable after insert. A with-check cannot do this
--                job, because editing a TEAMMATE's alias is legitimate.
--
-- SHAPE:
--   heard      what the recogniser produced, lower-cased by the client before
--              insert. The lookup key.
--   preferred  what to write into the brand field instead. Stored with the
--              seller's own capitalisation ("Ecko Unltd", not "ecko unltd") —
--              it is display text, and the match is done on a normalised form
--              in src/lib/brandSpelling.ts, not by the database.
--
-- UNIQUENESS is on (org_id, lower(btrim(heard))): one misheard phrase resolves
--   to exactly one brand per workspace, so the client can apply an exact hit
--   without asking. Two workspaces may disagree, which is the point.
--   It is also what makes the client's "remember this correction" button safe
--   under a double tap: PostgREST cannot address an EXPRESSION index with
--   onConflict, so brandAliasService does find-then-update and simply treats a
--   racing 23505 as success. Nothing upserts — the index is the referee, not the
--   mechanism.
--   The `heard_is_canonical` CHECK is what makes that index trustworthy. Without
--   it a row could be stored as "  La Tiger  " — matched by the btrimmed index
--   but NOT by the client's lookup, so "re-point this correction" would find
--   nothing, insert, trip 23505, and report success having changed nothing. The
--   client always lower-cases and trims; canonical_heard() makes every other
--   writer (SQL seeds, imports, service_role) do exactly the same, across the
--   whole Unicode whitespace set rather than just ASCII space.
-- ============================================================================


-- ── 1. Functions ────────────────────────────────────────────────────────────
-- Declared FIRST because the table below defaults a column to my_email() and
-- constrains a column with canonical_heard().

-- Shared with kanban_board.sql; recreated here so this file can be applied on
-- its own.
create or replace function public.my_email()
returns text
language sql stable
set search_path = public
as $$
  select lower(coalesce(auth.jwt()->>'email',''))
$$;

grant execute on function public.my_email() to authenticated;

-- THE canonical form of a misheard phrase — one definition, used by the CHECK
-- below and by the unique index, so they can never disagree.
--
-- btrim/1 strips U+0020 ONLY. JavaScript's String.trim() strips the whole
-- Unicode White_Space set, so a row stored as E'\tla tiger' would satisfy a
-- btrim/1-based constraint, take its own unique-index slot, and yet never be
-- found by the client's lookup (which trims the tab away first) — the exact
-- unreachable row the constraint exists to prevent, just narrowed rather than
-- removed. The explicit character set below is what JS trims: space, tab, LF,
-- CR, FF, VT, NBSP, the line/paragraph separators and the BOM.
create or replace function public.canonical_heard(t text)
returns text
language sql immutable strict
set search_path = public
as $$
  select lower(btrim($1, E' \t\n\r\f\u000B\u00A0\u2028\u2029\uFEFF'))
$$;

grant execute on function public.canonical_heard(text) to authenticated;


-- ── 2. Table ────────────────────────────────────────────────────────────────

create table if not exists public.brand_aliases (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations(id) on delete cascade default public.default_org_id(),
  heard            text not null,
  preferred        text not null,
  created_by       uuid references auth.users(id) on delete set null default auth.uid(),
  -- Denormalized for display (auth.users is not client-readable). It DEFAULTS to
  -- the caller's own email because the UPDATE grant below deliberately excludes
  -- it: a row inserted without this column could otherwise never be backfilled by
  -- any client, only by the table owner. nullif keeps it NULL rather than ''
  -- when there is no JWT email (a SQL seed, a service_role import).
  created_by_email text default nullif(public.my_email(), ''),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint brand_aliases_heard_not_blank     check (length(btrim(heard)) > 0),
  constraint brand_aliases_preferred_not_blank check (length(btrim(preferred)) > 0),
  -- The canonical form the unique index and the client lookup both assume.
  constraint brand_aliases_heard_is_canonical  check (heard = public.canonical_heard(heard))
);

-- The canonical-form CHECK and the created_by_email DEFAULT again, for a table
-- an EARLIER version of this file already created. `create table if not exists`
-- skips the whole statement, so re-running alone would never add them.
do $$
declare collisions int;
begin
  alter table public.brand_aliases
    alter column created_by_email set default nullif(public.my_email(), '');
  if not exists (select 1 from pg_constraint
                 where conrelid = 'public.brand_aliases'::regclass
                   and conname = 'brand_aliases_heard_is_canonical') then
    -- Two rows that differ ONLY in case or padding would collapse onto one
    -- another. Refuse with an actionable message rather than leave the table
    -- half-migrated: this file is not wrapped in a transaction, so a mid-way
    -- failure would strand the new CHECK on a table with no unique index.
    -- (Unreachable from anything either version of this file produces — the
    -- unique index is always created in the same run as the table — but the
    -- UPDATE below is what would hit it, so it is guarded here.)
    select count(*) - count(distinct (org_id, public.canonical_heard(heard)))
      into collisions from public.brand_aliases;
    if collisions > 0 then
      raise exception
        'brand_aliases: % row(s) differ only in case or padding. De-duplicate them, then re-run: '
        'select org_id, public.canonical_heard(heard), count(*) from public.brand_aliases '
        'group by 1,2 having count(*) > 1;', collisions;
    end if;
    -- Canonicalise any pre-existing rows, or the constraint cannot be added.
    update public.brand_aliases set heard = public.canonical_heard(heard)
      where heard <> public.canonical_heard(heard);
    alter table public.brand_aliases
      add constraint brand_aliases_heard_is_canonical check (heard = public.canonical_heard(heard));
  end if;
end $$;


-- ── 3. Indexes ──────────────────────────────────────────────────────────────
-- Every read is "all aliases for my workspace"; every write is keyed on the
-- misheard phrase.

create index if not exists brand_aliases_org_idx on public.brand_aliases (org_id);

-- The index expression stays lower(btrim(heard)) rather than canonical_heard():
-- `create unique index if not exists` matches on NAME, so re-expressing it would
-- be a silent no-op on an existing database. It does not matter — the CHECK above
-- guarantees `heard` is ALREADY canonical, and for such a value
-- lower(btrim(heard)) = canonical_heard(heard) = heard. Changing it would need an
-- explicit drop-and-recreate, which is churn for no behavioural difference.
create unique index if not exists brand_aliases_org_heard_uidx
  on public.brand_aliases (org_id, lower(btrim(heard)));


-- ── 4. RLS — org members only, all four verbs, no admin gate ────────────────

alter table public.brand_aliases enable row level security;

grant select, insert, delete on public.brand_aliases to authenticated;

-- UPDATE is granted per COLUMN. org_id, created_by, created_by_email and
-- created_at are deliberately absent, so a row can never change workspace and
-- can never be re-signed. The revoke is what keeps the column grants idempotent:
-- a table-wide UPDATE grant left over from an earlier run would otherwise
-- survive and silently re-open those columns.
revoke update on public.brand_aliases from authenticated;
grant update (heard, preferred, updated_at) on public.brand_aliases to authenticated;

drop policy if exists brand_aliases_select on public.brand_aliases;
drop policy if exists brand_aliases_insert on public.brand_aliases;
drop policy if exists brand_aliases_update on public.brand_aliases;
drop policy if exists brand_aliases_delete on public.brand_aliases;

create policy brand_aliases_select on public.brand_aliases for select
  to authenticated
  using (org_id in (select public.user_org_ids()));

create policy brand_aliases_update on public.brand_aliases for update
  to authenticated
  using (org_id in (select public.user_org_ids()))
  with check (org_id in (select public.user_org_ids()));

create policy brand_aliases_delete on public.brand_aliases for delete
  to authenticated
  using (org_id in (select public.user_org_ids()));

-- INSERT: membership AND self-asserted authorship only. The check also rejects
-- org_id NULL (NULL in (...) is never true), so the DEFAULT above is effectively
-- mandatory — a client cannot insert an untagged row, and a user who belongs to
-- no workspace at all (default_org_id() → NULL) is refused outright.
create policy brand_aliases_insert on public.brand_aliases for insert
  to authenticated
  with check (
    org_id in (select public.user_org_ids())
    and (created_by is null or created_by = auth.uid())
    and (created_by_email is null or lower(created_by_email) = public.my_email())
  );


-- ── VERIFY (run separately) ─────────────────────────────────────────────────
--   -- Cross-org leak check — must return 0 rows:
--   select count(*) from public.brand_aliases
--     where org_id not in (select public.user_org_ids());
--   -- One misheard phrase per workspace — this must FAIL with 23505:
--   insert into public.brand_aliases (heard, preferred) values ('echo unlimited','Ecko');
--   insert into public.brand_aliases (heard, preferred) values ('Echo Unlimited','Other');
--   -- Authorship and org are immutable: each of these must FAIL with SQLSTATE
--   -- 42501 when run as an ordinary signed-in member, NOT succeed. (Postgres 14
--   -- reports "permission denied for TABLE brand_aliases" — it does not name the
--   -- column on an UPDATE column-privilege denial. Match on the SQLSTATE.)
--   update public.brand_aliases set created_by = auth.uid() where true;
--   update public.brand_aliases set created_by_email = 'x@y.z' where true;
--   update public.brand_aliases set org_id = org_id where true;
--   -- ... while an ordinary edit SUCCEEDS:
--   update public.brand_aliases set preferred = 'Ecko Unltd.', updated_at = now() where true;
--   -- Blank guards — both must FAIL with 23514:
--   insert into public.brand_aliases (heard, preferred) values ('   ', 'Ecko Unltd');
--   insert into public.brand_aliases (heard, preferred) values ('echo', '  ');
--   -- Canonical-form guard — all three must FAIL with 23514 (heard_is_canonical),
--   -- including the non-ASCII whitespace that btrim/1 alone would let through:
--   insert into public.brand_aliases (heard, preferred) values ('  La Tiger ', 'Le Tigre');
--   insert into public.brand_aliases (heard, preferred) values ('LA TIGER', 'Le Tigre');
--   insert into public.brand_aliases (heard, preferred) values (E'\tla tiger', 'Le Tigre');
--
-- RUN THESE AS A SIGNED-IN MEMBER, not as the table owner: org_id defaults to
-- default_org_id(), which is NULL without a JWT, so an owner-run insert fails
-- 23502 on org_id before reaching any of the checks above.

-- ── ROLLBACK ────────────────────────────────────────────────────────────────
-- my_email() is shared with kanban_board.sql and is deliberately NOT dropped.
-- canonical_heard() is used only by this table, so it goes with it.
-- drop table if exists public.brand_aliases;
-- drop function if exists public.canonical_heard(text);
