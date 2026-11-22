-- ============================================================================
-- 066_account_deletion.sql
-- In-app account deletion (App Store Review Guideline 5.1.1(v)): an app that
-- lets people sign up must let them delete the account from inside the app.
--
-- WHAT THIS FILE ADDS
--   app_private.delete_account_data(p_user uuid) returns jsonb
--     SECURITY DEFINER. Does every database step of deleting one account in
--     ONE transaction, and returns
--       { "deleted_orgs": [{id, name}], "left_orgs": [{id, name}],
--         "storage_prefixes": ["<uid>/", ...] }
--     for the caller to finish: delete the auth user, then remove those
--     storage prefixes from the product-images bucket (best effort).
--   public.support_thread_before_update() re-created from 050 with one added
--     IF: it steps aside while the transaction-local setting
--     app.account_deletion is 'on' (see section 3 of the function).
--   public.delete_account_data(p_user uuid) returns jsonb
--     SECURITY INVOKER wrapper with an identical signature (AGENTS.md section
--     18 #45/#46 shape). It exists ONLY because the edge function reaches the
--     database through PostgREST, which serves `public` and not `app_private`.
--     EXECUTE on both halves is granted to service_role ONLY; public, anon and
--     authenticated are revoked, so no browser session can call either one.
--
-- WHO CALLS IT
--   supabase/functions/delete-account/index.ts, with the service role, after
--   it has proved the caller through /auth/v1/user and read { confirm: "DELETE" }.
--   p_user is therefore always the caller's own id, resolved server side.
--
-- STABLE ERROR CONVENTION (the edge function maps these to HTTP 409)
--   raise exception using errcode = 'P0001', message = 'last_owner',
--                         detail = <workspace name>, hint = <workspace id>
--   raise exception using errcode = 'P0001', message = 'founding_admin',
--                         detail = <workspace name>
--   raise exception using errcode = 'P0001', message = 'blocked',
--                         detail = <constraint or table>
--     -> HTTP 500 { code: 'blocked' }; the detail is logged, never returned.
--   Anything else is a generic failure. Nothing is changed when any of them is raised: the whole
--   function is one transaction.
--
-- SEMANTICS, PER WORKSPACE THE USER BELONGS TO
--   * Founding admin (owner/admin of the org whose slug is 'founding', the
--     is_beta_admin() rule) -> refuse 'founding_admin'. The founder removes
--     that status first; guard_founding_admins() keeps the founding org from
--     ever reaching zero admins, so this is never decided here.
--   * The founding org itself is never deleted, even with one member left.
--   * Sole member -> the workspace is DELETED with every org-scoped row.
--   * Other members, and the user is the LAST owner -> refuse 'last_owner'.
--   * Other members otherwise -> the user LEAVES: membership removed, rows the
--     user created reassigned to the SUCCESSOR, chosen as the longest-standing
--     remaining owner (org_members.created_at, then user_id as a tie break).
--     An org can hold zero owners (updateMemberRole allows it), so when the
--     user is not an owner and no owner remains the successor falls back to the
--     longest-standing admin, then the longest-standing member.
--   * Workspaces the user is NO LONGER a member of but still owns rows in
--     (removeMember and the founding tools move memberships, never data):
--     never refused. Every surviving workspace holding a row of this user gets
--     a successor: owner, else admin, else member, else organizations.created_by
--     when that account still exists, else the Founding Workspace's
--     longest-standing owner, else its longest-standing admin, as CUSTODIAN.
--     user_id there is provenance only; org_id decides who can see the row, so
--     the custodian gains no access. The one refusal ('blocked', detail
--     'no custodian') needs a founding org with no owner or admin, which
--     guard_founding_admins() does not allow.
--   * organizations.created_by is NOT provenance: org_rows_select lets the
--     creator read the org row and org_members_insert lets the creator of a
--     memberless workspace add themselves as owner (056, 047). It moves only
--     in a workspace the user is LEAVING now, to that workspace's member
--     successor; in every other workspace it becomes NULL. Never the custodian.
--   * Rows with org_id NULL are legacy only: 031 backfilled every such row
--     into the Founding Workspace and the org-scoped insert RLS rejects a NULL
--     org_id, so none should exist. Any that do are not reassigned and still
--     go with the account's CASCADE; no workspace can read them.
--
-- PER TABLE: what the FK to auth.users does today, and what this function does
--   (FK actions read from 005, 007, 031-065 and schema.sql; NO ACTION means
--   the FK has no ON DELETE clause, so a remaining row BLOCKS auth deletion.
--   "kept org" = every workspace that survives and holds a row of this user,
--   whether or not the user is still a member of it.)
--
--   Core shop tables (org_id FK to organizations has NO ON DELETE clause, so a
--   workspace cannot be deleted while they hold rows):
--     workflow_batches.user_id   CASCADE (007)      kept org: reassign to successor
--     products.user_id           CASCADE (schema)   kept org: reassign
--     product_images.user_id     CASCADE (schema)   kept org: reassign
--     categories.user_id         no FK in repo      kept org: reassign; on a
--     category_presets.user_id   no FK in repo        legacy (user_id, name)
--                                                     unique clash the row is left
--                                                     as is (no FK = nothing is lost)
--     deleted org: all five DELETED explicitly (images, products, batches,
--     categories, presets), which cascades product_labels and listing_embeddings.
--
--   Workspace tables that cascade from organizations (deleted with a deleted
--   org, untouched in a left org; their user column is ON DELETE SET NULL so
--   the shop keeps the row): kanban_columns/cards/tasks/comments,
--   listing_labels, product_labels, brand_aliases, org_marketplaces,
--   marketplace_vocab (org rows), listing_publications, pricing_events,
--   listing_identifications, listing_prices, listing_sales, price_comps_cache,
--   listing_embeddings, org_shopify_connections, org_invites, org_members.
--     created_by / author_id     SET NULL           left as the FK does it
--     *_email copies of the user ANONYMISED: kanban_cards.created_by_email,
--       kanban_comments.author_email, brand_aliases.created_by_email,
--       marketplace_vocab.created_by_email set to NULL for this user's rows.
--     kanban_cards/tasks.assignee_ids  the user's id is REMOVED from the array.
--
--   Rows with NO ACTION FKs (they would block auth.admin.deleteUser):
--     organizations.created_by          org being LEFT now -> its member successor;
--                                         every other org -> NULL (never the custodian)
--     org_invites.invited_by            NULL (a pending invite the user sent stays valid)
--     org_shopify_connections.created_by NULL
--     beta_signups.reviewed_by          NULL
--     founding_admin_audit.actor_id     NULL; actor_email / target_email are KEPT:
--                                         it is the founders' append-only audit
--                                         trail and is readable by founders only
--     user_profiles.id (schema.sql)     row DELETED when the table exists
--
--   Membership and invites:
--     org_members row                   DELETED (CASCADE would do it too)
--     org_invites addressed to the user's email, any org, accepted or not: DELETED
--
--   Messaging (045, 058):
--     support_threads kind 'support' the user opened  DELETED with their messages
--       (it is the user's own conversation with the founders)
--     support_threads kind 'team' the user created:
--       other participants remain -> user_id and user_email REASSIGNED to the
--       longest-standing remaining participant, so the CASCADE cannot take a
--       conversation the colleagues are still in. The BEFORE UPDATE trigger
--       pins user_id; it steps aside only while app.account_deletion is 'on',
--       a setting this function sets with set_config(..., true), which is
--       local to the transaction.
--       no participant remains -> DELETED
--     support_thread_members rows       DELETED (CASCADE would do it too)
--     support_messages.sender_id        SET NULL by the FK; the body stays in the
--                                         thread, authored by nobody
--     support_threads.last_sender_id    SET NULL by the FK
--
--   Personal rows outside workspaces:
--     beta_signups (by email)           DELETED. It is contact name, email and
--                                         store URL, nothing else.
--     crm_contacts (user_id or email)   DELETED, crm_notes cascade. Otherwise the
--                                         next crm_sync_contacts() would keep the
--                                         email. Notes the user WROTE as a founder
--                                         keep the body; author_email -> NULL.
--     analytics_events.user_id          SET NULL (explicit here, also the FK). The
--                                         row keeps only a random per-tab session id
--                                         (AGENTS.md section 9 privacy note), so it
--                                         is anonymous once the id is gone.
--     app_errors.user_id                SET NULL, same reasoning; message and stack
--                                         were PII-scrubbed in the browser.
--     finance_transactions.created_by   SET NULL by the FK (founders only).
--     org_plan_history.changed_by(_email) left as is: no FK by design (062), a
--                                         founders-only history of plan changes.
--     export_batches (005)              CASCADE by the FK. Per user, no org_id.
--
--   Storage (product-images bucket), returned as storage_prefixes for the edge
--   function to remove. Server-side equivalent of filterUnreferencedStoragePaths
--   (AGENTS.md section 18 #15), computed BEFORE any row is deleted:
--     * When no surviving row anywhere (product_images in any workspace that is
--       not being deleted, INCLUDING workspaces the user left earlier, or a
--       surviving organization's description_settings
--       backdrops) references a path under "<uid>/", the whole "<uid>/" prefix
--       is returned. That also takes backdrops and orphaned uploads.
--     * Otherwise only the "<uid>/<folder>/" product folders used by the deleted
--       workspaces are returned, minus any folder a surviving row references.
--       Photos the user uploaded into a workspace they LEFT stay where they are.
--     * Files other people uploaded into a deleted workspace live under THEIR
--       prefixes and are not returned.
--
--   PRE-CHECK (before any write): every FK to auth.users in ANY schema is read
--   from pg_constraint; a NO ACTION/RESTRICT column that is NOT NULL and holds
--   a row for this user raises 'blocked' naming the constraint, because it
--   would make auth.admin.deleteUser fail after this transaction committed.
--   Backstop (after the explicit steps): a nullable NO ACTION/RESTRICT column
--   in any schema still pointing at the user is set to NULL (a permission
--   failure becomes 'blocked' naming the table), and a CASCADE column on a
--   public table with org_id is reassigned to the successor in every
--   surviving workspace, so a table added after this file cannot silently
--   take a shop's rows with the account.
--
--   PRE-DEPLOY CHECK, run in the SQL Editor and read every row:
--     select conrelid::regclass, conname, confdeltype
--     from pg_constraint where confrelid = 'auth.users'::regclass;
--   confdeltype: a = no action, r = restrict, c = cascade, n = set null.
--   Any a/r row outside the tables listed above needs a line in this file.
--   Two more one-time checks, run as the role that runs this migration:
--     select rolbypassrls from pg_roles where rolname = current_user;
--       must be true: the pre-check's exists() reads on an RLS table the
--       definer cannot bypass silently return false.
--     select oid::regprocedure from pg_proc where proname = 'exec_sql';
--       must return no row, or one whose EXECUTE is service_role only
--       (run-collaborative-migration.js once called such a function with the
--       anon key).
--
-- IDEMPOTENT: create or replace + revoke/grant only; safe to re-run. Calling the
--   function twice for one user is also safe: the second call finds no
--   memberships and returns empty arrays plus at most the "<uid>/" prefix.
--
-- Run AFTER 031 through 065. Do not run without approval (AGENTS.md, rule 5).
-- ============================================================================

create schema if not exists app_private;

create or replace function app_private.delete_account_data(p_user uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid_text     text;
  v_email        text;
  r              record;
  fk             record;
  v_others       int;
  v_succ         uuid;
  v_succ_email   text;
  v_found_org    text;
  v_delete_ids   uuid[] := '{}';
  v_delete_names text[] := '{}';
  v_left_ids     uuid[] := '{}';
  v_left_names   text[] := '{}';
  v_left_succ    uuid[] := '{}';
  v_keep_ids     uuid[] := '{}';
  v_keep_succ    uuid[] := '{}';
  v_extra        uuid[];
  v_prefixes     text[] := '{}';
  v_whole        boolean;
  v_block        boolean;
  i              int;
begin
  if p_user is null then
    raise exception using errcode = '22023', message = 'invalid_user';
  end if;
  v_uid_text := p_user::text;

  -- One deletion per account at a time.
  perform pg_advisory_xact_lock(hashtext('delete_account_data'), hashtext(v_uid_text));

  select u.email::text into v_email from auth.users u where u.id = p_user;

  -- ── 1. Refusals first. Nothing has been written yet. ─────────────────────
  select o.name into v_found_org
  from public.org_members m
  join public.organizations o on o.id = m.org_id
  where m.user_id = p_user and o.slug = 'founding' and m.role in ('owner', 'admin')
  limit 1;
  if v_found_org is not null then
    raise exception using errcode = 'P0001', message = 'founding_admin', detail = v_found_org;
  end if;

  -- PRE-CHECK, before any write: a NOT NULL column whose FK to auth.users has
  -- no ON DELETE clause (NO ACTION / RESTRICT) and still holds this user would
  -- make auth.admin.deleteUser fail AFTER this transaction committed. Any
  -- schema, not only public. user_profiles.id is deleted below, so it is the
  -- one public exception.
  for fk in
    select c.conrelid::regclass as tbl, c.conname, a.attname as col
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f'
      and c.confrelid = 'auth.users'::regclass
      and array_length(c.conkey, 1) = 1
      and c.confdeltype in ('a', 'r')
      and a.attnotnull
      and c.conrelid is distinct from to_regclass('public.user_profiles')
  loop
    begin
      execute format('select exists (select 1 from %s where %I = $1)', fk.tbl, fk.col)
        into v_block using p_user;
    exception when insufficient_privilege then
      raise exception using errcode = 'P0001', message = 'blocked',
        detail = format('cannot read %s (%s)', fk.tbl, fk.conname);
    end;
    if v_block then
      raise exception using errcode = 'P0001', message = 'blocked', detail = fk.conname::text;
    end if;
  end loop;

  -- Lock the memberships of every workspace involved, in org id order (two
  -- co-owners deleting at once must not deadlock), so a concurrent role change
  -- cannot turn a "leave" into a workspace with no owner.
  perform 1 from public.org_members x
  where x.org_id in (select m.org_id from public.org_members m where m.user_id = p_user)
  order by x.org_id, x.user_id
  for update;

  for r in
    select m.org_id, m.role, o.name, o.slug
    from public.org_members m
    join public.organizations o on o.id = m.org_id
    where m.user_id = p_user
    order by m.created_at, m.org_id
  loop
    select count(*) into v_others
    from public.org_members x where x.org_id = r.org_id and x.user_id <> p_user;

    if v_others = 0 then
      if r.slug = 'founding' then
        raise exception using errcode = 'P0001', message = 'founding_admin', detail = r.name;
      end if;
      v_delete_ids   := v_delete_ids || r.org_id;
      v_delete_names := v_delete_names || r.name;
      continue;
    end if;

    select x.user_id into v_succ
    from public.org_members x
    where x.org_id = r.org_id and x.user_id <> p_user and x.role = 'owner'
    order by x.created_at, x.user_id
    limit 1;

    if v_succ is null and r.role = 'owner' then
      raise exception using errcode = 'P0001', message = 'last_owner', detail = r.name,
        hint = r.org_id::text;
    end if;

    if v_succ is null then
      select x.user_id into v_succ
      from public.org_members x
      where x.org_id = r.org_id and x.user_id <> p_user
      order by case x.role when 'admin' then 0 else 1 end, x.created_at, x.user_id
      limit 1;
    end if;

    v_left_ids   := v_left_ids || r.org_id;
    v_left_names := v_left_names || r.name;
    v_left_succ  := v_left_succ || v_succ;
  end loop;

  -- ── 1b. Every workspace that keeps rows this user owns. ─────────────────
  -- Not only current memberships: removeMember and the founding tools move
  -- MEMBERSHIPS and leave data, so a user removed from a workspace earlier
  -- still owns rows there, and the CASCADE on auth.users would take them.
  -- Every surviving workspace with such a row gets a successor.
  v_keep_ids := array(
    select distinct o from (
      select org_id as o from public.workflow_batches where user_id = p_user
      union select org_id from public.products         where user_id = p_user
      union select org_id from public.product_images   where user_id = p_user
      union select org_id from public.categories       where user_id = p_user
      union select org_id from public.category_presets where user_id = p_user
      union select id     from public.organizations    where created_by = p_user
      union select unnest(v_left_ids)
    ) s
    where o is not null and not (o = any (v_delete_ids))
  );
  -- Plus any other table with org_id and a CASCADE FK to auth.users.
  for fk in
    select c.conrelid::regclass as tbl, a.attname as col
    from pg_constraint c
    join pg_class cl on cl.oid = c.conrelid
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f' and c.confrelid = 'auth.users'::regclass
      and c.confdeltype = 'c' and array_length(c.conkey, 1) = 1
      and cl.relnamespace = 'public'::regnamespace
      and cl.relname not in ('org_members', 'support_thread_members', 'support_threads')
      and exists (select 1 from pg_attribute oa where oa.attrelid = c.conrelid
                  and oa.attname = 'org_id' and not oa.attisdropped)
  loop
    execute format('select array(select distinct org_id from %s where %I = $1 and org_id is not null)',
                   fk.tbl, fk.col) into v_extra using p_user;
    v_keep_ids := array(
      select distinct x from unnest(v_keep_ids || v_extra) x where not (x = any (v_delete_ids)));
  end loop;

  -- Successor per kept workspace. Provenance only: org_id decides access.
  --   longest-standing owner, else admin, else member (never this user),
  --   else organizations.created_by when that account still exists,
  --   else the Founding Workspace's longest-standing owner as custodian.
  for i in 1 .. coalesce(array_length(v_keep_ids, 1), 0) loop
    v_succ := null;
    select x.user_id into v_succ
    from public.org_members x
    where x.org_id = v_keep_ids[i] and x.user_id <> p_user
    order by case x.role when 'owner' then 0 when 'admin' then 1 else 2 end, x.created_at, x.user_id
    limit 1;
    if v_succ is null then
      select o.created_by into v_succ
      from public.organizations o
      join auth.users u on u.id = o.created_by
      where o.id = v_keep_ids[i] and o.created_by <> p_user;
    end if;
    if v_succ is null then
      select x.user_id into v_succ
      from public.org_members x
      join public.organizations o on o.id = x.org_id
      where o.slug = 'founding' and x.role in ('owner', 'admin') and x.user_id <> p_user
      order by case x.role when 'owner' then 0 else 1 end, x.created_at, x.user_id
      limit 1;
    end if;
    if v_succ is null then
      -- Only possible with no founding owner or admin at all, which
      -- guard_founding_admins() rules out. Refusing is the one way
      -- to keep the CASCADE from taking the rows.
      raise exception using errcode = 'P0001', message = 'blocked', detail = 'no custodian';
    end if;
    v_keep_succ := v_keep_succ || v_succ;
  end loop;

  -- ── 2. Storage prefixes, computed while every row still exists. ──────────
  -- A path is referenced by a SURVIVING row when its product_images row is in
  -- a workspace that is not being deleted (or has no workspace), or when a
  -- surviving organization's settings JSON mentions it (backdrops).
  select not exists (
           select 1
           from public.product_images pi
           cross join lateral (values
             (to_jsonb(pi) ->> 'storage_path'),
             (to_jsonb(pi) ->> 'cutout_storage_path'),
             (to_jsonb(pi) ->> 'composite_storage_path'),
             (to_jsonb(pi) ->> 'original_storage_path')) as p(path)
           where (pi.org_id is null or not (pi.org_id = any (v_delete_ids)))
             and left(p.path, length(v_uid_text) + 1) = v_uid_text || '/'
         )
     and not exists (
           select 1 from public.organizations o
           where not (o.id = any (v_delete_ids))
             and strpos(coalesce(to_jsonb(o) ->> 'description_settings', ''), v_uid_text || '/') > 0
         )
    into v_whole;

  if v_whole then
    v_prefixes := array[v_uid_text || '/'];
  elsif cardinality(v_delete_ids) > 0 then
    select coalesce(array_agg(distinct f.prefix order by f.prefix), '{}')
      into v_prefixes
    from (
      select split_part(p.path, '/', 1) || '/' || split_part(p.path, '/', 2) || '/' as prefix
      from public.product_images pi
      cross join lateral (values
        (to_jsonb(pi) ->> 'storage_path'),
        (to_jsonb(pi) ->> 'cutout_storage_path'),
        (to_jsonb(pi) ->> 'composite_storage_path'),
        (to_jsonb(pi) ->> 'original_storage_path')) as p(path)
      where pi.org_id = any (v_delete_ids)
        and split_part(p.path, '/', 1) = v_uid_text
        and split_part(p.path, '/', 2) <> ''
        and split_part(p.path, '/', 3) <> ''
    ) f
    where not exists (
      select 1
      from public.product_images pi2
      cross join lateral (values
        (to_jsonb(pi2) ->> 'storage_path'),
        (to_jsonb(pi2) ->> 'cutout_storage_path'),
        (to_jsonb(pi2) ->> 'composite_storage_path'),
        (to_jsonb(pi2) ->> 'original_storage_path')) as p2(path)
      where (pi2.org_id is null or not (pi2.org_id = any (v_delete_ids)))
        and left(p2.path, length(f.prefix)) = f.prefix
    );
  end if;

  -- ── 3. Every surviving workspace: hand this user's rows to its successor.
  for i in 1 .. coalesce(array_length(v_keep_ids, 1), 0) loop
    update public.workflow_batches set user_id = v_keep_succ[i]
      where org_id = v_keep_ids[i] and user_id = p_user;
    update public.products set user_id = v_keep_succ[i]
      where org_id = v_keep_ids[i] and user_id = p_user;
    update public.product_images set user_id = v_keep_succ[i]
      where org_id = v_keep_ids[i] and user_id = p_user;
    begin
      update public.categories set user_id = v_keep_succ[i]
        where org_id = v_keep_ids[i] and user_id = p_user;
    exception when unique_violation then
      raise notice 'delete_account_data: categories kept their user_id in % (legacy unique clash)', v_keep_ids[i];
    end;
    begin
      update public.category_presets set user_id = v_keep_succ[i]
        where org_id = v_keep_ids[i] and user_id = p_user;
    exception when unique_violation then
      raise notice 'delete_account_data: category_presets kept their user_id in % (legacy unique clash)', v_keep_ids[i];
    end;

    -- created_by is an ACCESS column, not provenance: org_rows_select lets the
    -- creator read the org row, and org_members_insert lets the creator of a
    -- memberless workspace add themselves as owner. So it moves ONLY in a
    -- workspace the user is leaving right now, and only to that workspace's
    -- member successor. Everywhere else step 5 sets it to NULL. It is never
    -- handed to the custodian.
    if v_keep_ids[i] = any (v_left_ids) then
      update public.organizations set created_by = v_keep_succ[i]
        where id = v_keep_ids[i] and created_by = p_user;
    end if;

    if to_regclass('public.kanban_cards') is not null then
      update public.kanban_cards set assignee_ids = array_remove(assignee_ids, p_user)
        where org_id = v_keep_ids[i] and p_user = any (assignee_ids);
      update public.kanban_tasks set assignee_ids = array_remove(assignee_ids, p_user)
        where org_id = v_keep_ids[i] and p_user = any (assignee_ids);
    end if;
  end loop;

  delete from public.org_members where user_id = p_user and org_id = any (v_left_ids);

  -- Team conversations the user started that colleagues are still in. The
  -- BEFORE UPDATE trigger pins user_id/user_email against clients; it steps
  -- aside only while the transaction-local app.account_deletion flag is on
  -- (set here, reset at commit or rollback; see the trigger below).
  if to_regclass('public.support_thread_members') is not null
     and exists (
       select 1 from public.support_threads t
       where t.user_id = p_user and t.kind = 'team'
         and exists (select 1 from public.support_thread_members sm
                     where sm.thread_id = t.id and sm.user_id <> p_user)
     ) then
    perform set_config('app.account_deletion', 'on', true);
    for r in
      select t.id as thread_id, s.user_id as new_user, s.email as new_email
      from public.support_threads t
      cross join lateral (
        select sm.user_id, sm.email
        from public.support_thread_members sm
        where sm.thread_id = t.id and sm.user_id <> p_user
        order by sm.added_at, sm.user_id
        limit 1
      ) s
      where t.user_id = p_user and t.kind = 'team'
    loop
      select coalesce(r.new_email, u.email::text) into v_succ_email
      from auth.users u where u.id = r.new_user;
      update public.support_threads
        set user_id = r.new_user, user_email = coalesce(v_succ_email, r.new_email)
        where id = r.thread_id;
    end loop;
    perform set_config('app.account_deletion', 'off', true);
  end if;

  -- ── 4. Workspaces the user was ALONE in: delete them outright. ───────────
  for i in 1 .. coalesce(array_length(v_delete_ids, 1), 0) loop
    delete from public.product_images   where org_id = v_delete_ids[i];
    delete from public.products         where org_id = v_delete_ids[i];
    delete from public.workflow_batches where org_id = v_delete_ids[i];
    delete from public.categories       where org_id = v_delete_ids[i];
    delete from public.category_presets where org_id = v_delete_ids[i];

    -- Any other table whose org_id FK has no ON DELETE clause would block the
    -- organizations delete below. Clear it generically.
    for fk in
      select c.conrelid::regclass as tbl, a.attname as col
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
      where c.contype = 'f'
        and c.confrelid = 'public.organizations'::regclass
        and array_length(c.conkey, 1) = 1
        and c.confdeltype in ('a', 'r')
    loop
      execute format('delete from %s where %I = $1', fk.tbl, fk.col) using v_delete_ids[i];
    end loop;

    -- Cascades members, invites, kanban, labels, aliases, marketplaces,
    -- publications, research, embeddings, the Shopify connection; sets NULL in
    -- analytics_events, app_errors, crm_contacts, support_threads, finance.
    delete from public.organizations where id = v_delete_ids[i];
  end loop;

  -- ── 5. Rows about the person, outside any one workspace. ─────────────────
  delete from public.org_members where user_id = p_user;
  if v_email is not null then
    delete from public.org_invites where lower(email) = lower(v_email);
  end if;
  update public.org_invites   set invited_by = null where invited_by = p_user;
  update public.organizations set created_by = null where created_by = p_user;

  if to_regclass('public.org_shopify_connections') is not null then
    update public.org_shopify_connections set created_by = null where created_by = p_user;
  end if;

  if to_regclass('public.support_threads') is not null then
    delete from public.support_threads where user_id = p_user;  -- support kind, and team threads nobody else is in
  end if;
  if to_regclass('public.support_thread_members') is not null then
    delete from public.support_thread_members where user_id = p_user;
  end if;

  if to_regclass('public.kanban_cards') is not null then
    update public.kanban_cards set created_by_email = null where created_by = p_user;
    update public.kanban_comments set author_email = null where author_id = p_user;
  end if;
  if to_regclass('public.brand_aliases') is not null then
    update public.brand_aliases set created_by_email = null where created_by = p_user;
  end if;
  if to_regclass('public.marketplace_vocab') is not null then
    update public.marketplace_vocab set created_by_email = null where created_by = p_user;
  end if;

  if to_regclass('public.beta_signups') is not null then
    update public.beta_signups set reviewed_by = null where reviewed_by = p_user;
    if v_email is not null then
      delete from public.beta_signups where lower(email) = lower(v_email);
    end if;
  end if;

  if to_regclass('public.crm_contacts') is not null then
    delete from public.crm_contacts
      where user_id = p_user or (v_email is not null and lower(email) = lower(v_email));
    update public.crm_notes set author_email = null where author_id = p_user;
  end if;

  if to_regclass('public.analytics_events') is not null then
    update public.analytics_events set user_id = null where user_id = p_user;
  end if;
  if to_regclass('public.app_errors') is not null then
    update public.app_errors set user_id = null where user_id = p_user;
  end if;
  if to_regclass('public.founding_admin_audit') is not null then
    update public.founding_admin_audit set actor_id = null where actor_id = p_user;
  end if;
  if to_regclass('public.user_profiles') is not null then
    execute 'delete from public.user_profiles where id = $1' using p_user;
  end if;

  -- ── 6. Backstop over every FK to auth.users, in any schema. ──────────────
  for fk in
    select c.conrelid::regclass as tbl, cl.relname as relname, a.attname as col,
           (cl.relnamespace = 'public'::regnamespace) as is_public,
           a.attnotnull as notnull, c.confdeltype as action,
           exists (select 1 from pg_attribute oa
                   where oa.attrelid = c.conrelid and oa.attname = 'org_id'
                     and not oa.attisdropped) as has_org
    from pg_constraint c
    join pg_class cl on cl.oid = c.conrelid
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f'
      and c.confrelid = 'auth.users'::regclass
      and array_length(c.conkey, 1) = 1
  loop
    if fk.action in ('a', 'r') then
      if fk.notnull then
        -- The pre-check already refused any row; this re-check covers a row
        -- written by this transaction.
        execute format('select exists (select 1 from %s where %I = $1)', fk.tbl, fk.col)
          into v_block using p_user;
        if v_block then
          raise exception using errcode = 'P0001', message = 'blocked', detail = fk.tbl::text;
        end if;
      else
        begin
          execute format('update %s set %I = null where %I = $1', fk.tbl, fk.col, fk.col)
            using p_user;
        exception when insufficient_privilege then
          raise exception using errcode = 'P0001', message = 'blocked',
            detail = format('cannot clear %s.%s', fk.tbl, fk.col);
        end;
      end if;
    elsif fk.action = 'c' and fk.is_public and fk.has_org
          and fk.relname not in ('org_members', 'support_thread_members', 'support_threads') then
      for i in 1 .. coalesce(array_length(v_keep_ids, 1), 0) loop
        execute format('update %s set %I = $1 where %I = $2 and org_id = $3', fk.tbl, fk.col, fk.col)
          using v_keep_succ[i], p_user, v_keep_ids[i];
      end loop;
    end if;
  end loop;

  return jsonb_build_object(
    'deleted_orgs', coalesce((
      select jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name) order by d.ord)
      from unnest(v_delete_ids, v_delete_names) with ordinality as d(id, name, ord)), '[]'::jsonb),
    'left_orgs', coalesce((
      select jsonb_agg(jsonb_build_object('id', l.id, 'name', l.name) order by l.ord)
      from unnest(v_left_ids, v_left_names) with ordinality as l(id, name, ord)), '[]'::jsonb),
    'storage_prefixes', to_jsonb(v_prefixes)
  );
end $$;

-- The PostgREST-facing half. SECURITY INVOKER, identical signature (section
-- 18 #46): it runs as service_role, which holds EXECUTE on the body above.
create or replace function public.delete_account_data(p_user uuid)
returns jsonb
language sql
volatile
security invoker
set search_path = app_private, public
as $$ select app_private.delete_account_data(p_user) $$;

-- support_threads BEFORE UPDATE trigger, from 050_security_abuse_limits.sql,
-- re-created byte for byte except for the first IF: while the transaction-local
-- setting app.account_deletion is 'on' it returns NEW untouched, so
-- delete_account_data can hand a team thread to another participant without
-- ALTER TABLE ... DISABLE TRIGGER (which locks the table and fails if the
-- trigger is ever renamed). Clients cannot set it: PostgREST runs no SET from a
-- request and pg_catalog.set_config is not an exposed RPC. The setting is
-- written with is_local = true, so it ends with the transaction.
create or replace function public.support_thread_before_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_setting('app.account_deletion', true) = 'on' then
    return new;
  end if;
  -- Only a founder may move the FOUNDER's read stamp (else the thread owner
  -- clears the founder's unread badge and the message is never noticed).
  if not public.is_beta_admin() then
    new.founder_last_read_at := old.founder_last_read_at;
  end if;
  -- Only the thread's owner may move the USER's read stamp.
  if old.user_id is distinct from auth.uid() then
    new.user_last_read_at := old.user_last_read_at;
  end if;
  -- Identity and inbox-display columns are immutable from any client. (The
  -- column grant already excludes them; this is the belt-and-braces half, and
  -- it also covers any future grant widening.)
  new.user_id    := old.user_id;
  new.user_email := old.user_email;
  new.org_id     := old.org_id;
  new.org_name   := old.org_name;
  return new;
end $$;

-- Same treatment 054 gives it: a trigger needs no EXECUTE from the caller.
do $$
declare r text;
begin
  revoke all on function public.support_thread_before_update() from public;
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on function public.support_thread_before_update() from %I', r);
    end if;
  end loop;
end $$;

-- EXECUTE for service_role only. CREATE FUNCTION grants PUBLIC by default.
do $$
declare r text;
begin
  revoke all on function app_private.delete_account_data(uuid) from public;
  revoke all on function public.delete_account_data(uuid) from public;
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on function app_private.delete_account_data(uuid) from %I', r);
      execute format('revoke all on function public.delete_account_data(uuid) from %I', r);
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant usage on schema app_private to service_role';
    execute 'grant execute on function app_private.delete_account_data(uuid) to service_role';
    execute 'grant execute on function public.delete_account_data(uuid) to service_role';
  end if;
end $$;


-- ============================================================================
-- VERIFY (run separately, as postgres, on a throwaway database first)
-- ============================================================================
-- -- (a) Only service_role (and the owner) can execute either half:
-- select p.oid::regprocedure, r.rolname,
--        has_function_privilege(r.rolname, p.oid, 'execute') as can_execute
-- from pg_proc p cross join pg_roles r
-- where p.proname = 'delete_account_data'
--   and r.rolname in ('anon', 'authenticated', 'service_role');
-- -- expect: anon false, authenticated false, service_role true, for both rows.
--
-- -- (b) Dry run inside a transaction that is rolled back:
-- begin;
--   select public.delete_account_data('<a test user id>');
-- rollback;


-- ============================================================================
-- ROLLBACK (drops the function; deletes already performed are not undone)
-- ============================================================================
-- drop function if exists public.delete_account_data(uuid);
-- drop function if exists app_private.delete_account_data(uuid);
-- -- Restore the trigger function exactly as 050_security_abuse_limits.sql
-- -- wrote it (the same body without the app.account_deletion IF), then
-- -- re-apply its privileges:
-- create or replace function public.support_thread_before_update()
-- returns trigger language plpgsql security definer set search_path = public
-- as $$
-- begin
--   if not public.is_beta_admin() then
--     new.founder_last_read_at := old.founder_last_read_at;
--   end if;
--   if old.user_id is distinct from auth.uid() then
--     new.user_last_read_at := old.user_last_read_at;
--   end if;
--   new.user_id    := old.user_id;
--   new.user_email := old.user_email;
--   new.org_id     := old.org_id;
--   new.org_name   := old.org_name;
--   return new;
-- end $$;
-- revoke all on function public.support_thread_before_update() from public, anon, authenticated, service_role;
