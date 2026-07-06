-- ============================================================================
-- MULTI-ORG TENANCY — organizations, members, invites, org-scoped RLS
-- ============================================================================
-- ⚠️ DO NOT RUN without reading this header and taking a database backup first
--    (Dashboard → Database → Backups → confirm a recent backup exists).
--
-- WHAT THIS DOES (in order):
--   A. Creates organizations / org_members / org_invites (purely additive).
--   B. Adds a nullable org_id column to workflow_batches, products,
--      product_images, categories, category_presets (purely additive).
--   C. Creates a "Founding Workspace" org, makes EVERY existing auth user a
--      member of it, and tags EVERY existing row with its id (UPDATEs only —
--      no rows are deleted or otherwise modified).
--   D. Sets org_id DEFAULT so all future inserts are tagged automatically —
--      the app code does not need to pass org_id anywhere.
--   E. Replaces the shared-workspace / collaborative RLS policies with
--      org-membership policies: users see and edit ONLY their org's rows.
--
-- DATA SAFETY:
--   * Nothing is deleted. Nothing is overwritten except the new org_id column
--     (only where it is NULL). Every step is idempotent — safe to re-run.
--   * Because ALL existing users become members of the founding org, everyone
--     sees exactly the same data after this migration as before it.
--   * Full rollback SQL is at the bottom (restores the current collaborative
--     policies; the new tables/columns are left in place, unused and harmless).
--
-- AFTER RUNNING:
--   1. Run the verification queries (section 7). All three counts must be 0.
--   2. Review the founding-org member list (section 7b) — REMOVE any account
--      you don't recognize (they were sharing your workspace until today).
--   3. New signups from now on get their own empty, isolated workspace.
--      Teammates are added via the in-app Workspace panel (email invites).
--
-- KNOWN LIMITS (deliberate, later phases):
--   * Storage bucket stays public — image URLs remain unguessable-but-public.
--   * export_batches / export_batch_items are untouched (feature has no UI).
--   * Shopify secret stays global (per-org connections are Phase 2).
-- ============================================================================


-- ── 1. Tables ───────────────────────────────────────────────────────────────

create table if not exists public.organizations (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  slug       text unique,
  plan       text not null default 'free',
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now()
);

create table if not exists public.org_members (
  org_id     uuid not null references public.organizations(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       text not null default 'member' check (role in ('owner','admin','member')),
  email      text,  -- denormalized for display (auth.users is not client-readable)
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

create table if not exists public.org_invites (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  email       text not null,
  role        text not null default 'member' check (role in ('owner','admin','member')),
  invited_by  uuid references auth.users(id) default auth.uid(),
  created_at  timestamptz not null default now(),
  accepted_at timestamptz
);

create index if not exists org_members_user_idx  on public.org_members (user_id);
create index if not exists org_invites_email_idx on public.org_invites (lower(email));

alter table public.organizations enable row level security;
alter table public.org_members   enable row level security;
alter table public.org_invites   enable row level security;

grant select, insert, update, delete on public.organizations, public.org_members, public.org_invites to authenticated;


-- ── 2. Helper functions (SECURITY DEFINER — avoid RLS recursion) ────────────

create or replace function public.user_org_ids()
returns setof uuid
language sql security definer stable
set search_path = public
as $$
  select org_id from public.org_members where user_id = auth.uid()
$$;

create or replace function public.default_org_id()
returns uuid
language sql security definer stable
set search_path = public
as $$
  select org_id from public.org_members
  where user_id = auth.uid()
  order by created_at asc
  limit 1
$$;

create or replace function public.is_org_admin(p_org uuid)
returns boolean
language sql security definer stable
set search_path = public
as $$
  select exists (
    select 1 from public.org_members
    where org_id = p_org and user_id = auth.uid() and role in ('owner','admin')
  )
$$;

create or replace function public.org_has_members(p_org uuid)
returns boolean
language sql security definer stable
set search_path = public
as $$
  select exists (select 1 from public.org_members where org_id = p_org)
$$;

create or replace function public.invited_role(p_org uuid)
returns text
language sql security definer stable
set search_path = public
as $$
  select role from public.org_invites
  where org_id = p_org
    and lower(email) = lower(coalesce(auth.jwt()->>'email',''))
    and accepted_at is null
  order by created_at desc
  limit 1
$$;

grant execute on function public.user_org_ids(), public.default_org_id(),
  public.is_org_admin(uuid), public.org_has_members(uuid), public.invited_role(uuid)
  to authenticated;


-- ── 3. RLS for the org tables themselves ────────────────────────────────────

-- organizations
drop policy if exists org_rows_select on public.organizations;
create policy org_rows_select on public.organizations for select to authenticated
  using (id in (select public.user_org_ids()) or created_by = auth.uid());

drop policy if exists org_rows_insert on public.organizations;
create policy org_rows_insert on public.organizations for insert to authenticated
  with check (coalesce(created_by, auth.uid()) = auth.uid());

drop policy if exists org_rows_update on public.organizations;
create policy org_rows_update on public.organizations for update to authenticated
  using (public.is_org_admin(id)) with check (public.is_org_admin(id));

drop policy if exists org_rows_delete on public.organizations;
create policy org_rows_delete on public.organizations for delete to authenticated
  using (public.is_org_admin(id));

-- org_members
drop policy if exists org_members_select on public.org_members;
create policy org_members_select on public.org_members for select to authenticated
  using (org_id in (select public.user_org_ids()));

drop policy if exists org_members_insert on public.org_members;
create policy org_members_insert on public.org_members for insert to authenticated
  with check (
    -- (1) creator bootstraps as owner of their brand-new empty org
    (user_id = auth.uid() and role = 'owner'
       and not public.org_has_members(org_id)
       and exists (select 1 from public.organizations o
                   where o.id = org_id and o.created_by = auth.uid()))
    -- (2) invitee joins with exactly the invited role
    or (user_id = auth.uid() and role = public.invited_role(org_id))
    -- (3) org admins add members directly
    or public.is_org_admin(org_id)
  );

drop policy if exists org_members_update on public.org_members;
create policy org_members_update on public.org_members for update to authenticated
  using (public.is_org_admin(org_id)) with check (public.is_org_admin(org_id));

drop policy if exists org_members_delete on public.org_members;
create policy org_members_delete on public.org_members for delete to authenticated
  using (public.is_org_admin(org_id) or user_id = auth.uid());

-- org_invites
drop policy if exists org_invites_select on public.org_invites;
create policy org_invites_select on public.org_invites for select to authenticated
  using (public.is_org_admin(org_id)
         or lower(email) = lower(coalesce(auth.jwt()->>'email','')));

drop policy if exists org_invites_insert on public.org_invites;
create policy org_invites_insert on public.org_invites for insert to authenticated
  with check (public.is_org_admin(org_id));

drop policy if exists org_invites_update on public.org_invites;
create policy org_invites_update on public.org_invites for update to authenticated
  using (public.is_org_admin(org_id)
         or lower(email) = lower(coalesce(auth.jwt()->>'email','')))
  with check (public.is_org_admin(org_id)
         or lower(email) = lower(coalesce(auth.jwt()->>'email','')));

drop policy if exists org_invites_delete on public.org_invites;
create policy org_invites_delete on public.org_invites for delete to authenticated
  using (public.is_org_admin(org_id));


-- ── 4. org_id columns on the data tables (additive, nullable) ───────────────

alter table public.workflow_batches add column if not exists org_id uuid references public.organizations(id);
alter table public.products         add column if not exists org_id uuid references public.organizations(id);
alter table public.product_images   add column if not exists org_id uuid references public.organizations(id);
alter table public.categories       add column if not exists org_id uuid references public.organizations(id);
alter table public.category_presets add column if not exists org_id uuid references public.organizations(id);

create index if not exists workflow_batches_org_idx on public.workflow_batches (org_id);
create index if not exists products_org_idx         on public.products (org_id);
create index if not exists product_images_org_idx   on public.product_images (org_id);
create index if not exists categories_org_idx       on public.categories (org_id);
create index if not exists category_presets_org_idx on public.category_presets (org_id);


-- ── 5. Founding org: every existing user joins, every existing row is tagged ─
-- UPDATE-only backfill. Nothing is deleted; org_id is set only where NULL.

do $$
declare founding uuid;
begin
  select id into founding from public.organizations where slug = 'founding';
  if founding is null then
    insert into public.organizations (name, slug, created_by)
    values ('Founding Workspace', 'founding', null)
    returning id into founding;
  end if;

  -- Every user that exists RIGHT NOW keeps seeing everything they see today.
  -- (Review this member list afterwards — section 7b — and remove strangers.)
  insert into public.org_members (org_id, user_id, role, email)
  select founding, u.id, 'admin', u.email
  from auth.users u
  on conflict (org_id, user_id) do nothing;

  update public.workflow_batches set org_id = founding where org_id is null;
  update public.products         set org_id = founding where org_id is null;
  update public.product_images   set org_id = founding where org_id is null;
  update public.categories       set org_id = founding where org_id is null;
  update public.category_presets set org_id = founding where org_id is null;
end $$;


-- ── 6. Defaults + org-scoped RLS on the data tables ─────────────────────────
-- The default means the app never has to pass org_id on INSERT — every new row
-- is automatically tagged with the inserting user's org.

alter table public.workflow_batches alter column org_id set default public.default_org_id();
alter table public.products         alter column org_id set default public.default_org_id();
alter table public.product_images   alter column org_id set default public.default_org_id();
alter table public.categories       alter column org_id set default public.default_org_id();
alter table public.category_presets alter column org_id set default public.default_org_id();

-- Drop ALL existing policies on the five data tables (shared-workspace,
-- collaborative-edit, owner-scoped — whatever is there), then create the
-- org-membership set. NOTE: the INSERT check also rejects org_id NULL
-- (NULL in (...) is not true), so client inserts are effectively forced
-- to carry a valid org via the DEFAULT above.
do $$
declare r record; t text;
begin
  for r in
    select tablename, policyname from pg_policies
    where schemaname = 'public'
      and tablename in ('workflow_batches','products','product_images','categories','category_presets')
  loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;

  -- Workflow data: strictly org-scoped.
  foreach t in array array['workflow_batches','products','product_images'] loop
    execute format('create policy %I on public.%I for select to authenticated using (org_id in (select public.user_org_ids()))', 'org_select_'||t, t);
    execute format('create policy %I on public.%I for insert to authenticated with check (org_id in (select public.user_org_ids()))', 'org_insert_'||t, t);
    execute format('create policy %I on public.%I for update to authenticated using (org_id in (select public.user_org_ids())) with check (org_id in (select public.user_org_ids()))', 'org_update_'||t, t);
    execute format('create policy %I on public.%I for delete to authenticated using (org_id in (select public.user_org_ids()))', 'org_delete_'||t, t);
  end loop;

  -- Categories/presets: org-scoped, but rows with org_id IS NULL are readable
  -- by everyone (reserved for future system defaults; none exist after backfill).
  foreach t in array array['categories','category_presets'] loop
    execute format('create policy %I on public.%I for select to authenticated using (org_id in (select public.user_org_ids()) or org_id is null)', 'org_select_'||t, t);
    execute format('create policy %I on public.%I for insert to authenticated with check (org_id in (select public.user_org_ids()))', 'org_insert_'||t, t);
    execute format('create policy %I on public.%I for update to authenticated using (org_id in (select public.user_org_ids())) with check (org_id in (select public.user_org_ids()))', 'org_update_'||t, t);
    execute format('create policy %I on public.%I for delete to authenticated using (org_id in (select public.user_org_ids()))', 'org_delete_'||t, t);
  end loop;
end $$;


-- ── 7. VERIFY (run as separate queries after the migration) ─────────────────
-- 7a. All three must return 0:
--   select count(*) from public.workflow_batches where org_id is null;
--   select count(*) from public.products         where org_id is null;
--   select count(*) from public.product_images   where org_id is null;
--
-- 7b. Review who is in the founding workspace (remove strangers!):
--   select m.email, m.role, m.created_at
--   from public.org_members m
--   join public.organizations o on o.id = m.org_id
--   where o.slug = 'founding' order by m.created_at;
--
--   To remove an unknown account from the founding workspace:
--   delete from public.org_members
--   where user_id = '<their-user-uuid>'
--     and org_id = (select id from public.organizations where slug = 'founding');
--
-- 7c. Pick your owner (everyone was backfilled as 'admin'):
--   update public.org_members set role = 'owner'
--   where email = 'gabrielriosemail@gmail.com'
--     and org_id = (select id from public.organizations where slug = 'founding');


-- ============================================================================
-- ROLLBACK — restores the pre-tenancy collaborative policies.
-- The org tables/columns are left in place (unused, harmless).
-- Uncomment and run if the app misbehaves after the swap.
-- ============================================================================
-- do $$
-- declare r record; t text;
-- begin
--   for r in select tablename, policyname from pg_policies
--            where schemaname='public'
--              and tablename in ('workflow_batches','products','product_images','categories','category_presets')
--   loop execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename); end loop;
--
--   -- Shared workspace: everyone reads everything; INSERT/UPDATE collaborative
--   -- (matches shared_workspace_rls.sql + collaborative_edit_policies.sql);
--   -- DELETE owner-scoped, as before.
--   foreach t in array array['workflow_batches','products','product_images','categories','category_presets'] loop
--     execute format('create policy %I on public.%I for select to authenticated using (true)', 'legacy_select_'||t, t);
--     execute format('create policy %I on public.%I for insert to authenticated with check (true)', 'legacy_insert_'||t, t);
--     execute format('create policy %I on public.%I for update to authenticated using (true) with check (true)', 'legacy_update_'||t, t);
--     execute format('create policy %I on public.%I for delete to authenticated using (auth.uid() = user_id)', 'legacy_delete_'||t, t);
--   end loop;
--
--   -- Remove the org_id defaults so inserts stop depending on org membership
--   foreach t in array array['workflow_batches','products','product_images','categories','category_presets'] loop
--     execute format('alter table public.%I alter column org_id drop default', t);
--   end loop;
-- end $$;
