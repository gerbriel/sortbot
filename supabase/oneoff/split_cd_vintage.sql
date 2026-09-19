-- ============================================================================
-- ONE-OFF — split C&D Vintage out of the Founding Workspace into its own tenant
-- ============================================================================
-- This is NOT a migration. It is a one-shop data edit, run once, by hand, in
-- the Supabase SQL Editor (as `postgres`). It changes no schema, no policy and
-- no function. It lives in supabase/oneoff/ for the same reason the vendor
-- repair in docs/reviews/12-step3-fields-brands-sizes.md is not a migration:
-- a migration describes the database every environment must have, and this
-- describes one afternoon in one of them.
--
-- WHAT IT DOES
--   1. Creates the workspace "C&D Vintage" (plan beta, slug cd-vintage) with
--      the Founding Workspace's description-format settings copied across and
--      the Vendor name pinned to "C&D Vintage".
--   2. Makes thecreatendestroy@gmail.com its OWNER and removes that account
--      from the Founding Workspace. cjdub2004@icloud.com is NOT touched — it
--      stays in the Founding Workspace on purpose, so CJ can see what a demo
--      member sees next to what a founding admin sees.
--   3. Moves that account's work — every batch it created, every product in
--      those batches (whoever uploaded it), every image of those products,
--      plus its unassigned products — into the new workspace. A batch is moved
--      WHOLE: products are selected by batch, not by uploader, so a batch is
--      never split between two workspaces.
--   4. COPIES (does not move) the Founding Workspace's shared vocabulary into
--      the new one — categories, presets, marketplace opt-ins and vocabulary,
--      brand aliases, listing labels — because both workspaces keep needing
--      them and a copy is what "preseeded" means. Copied presets keep their
--      meaning for moved products: applied_preset_id is remapped to the copy.
--   5. Re-points the account's support threads and CRM contact at the new
--      workspace, moves the Founding Workspace's Shopify connection row
--      (it is C&D's store) if one exists, and writes one founding_admin_audit
--      row naming the actor.
--
-- WHY A SCRIPT AND NOT THE APP
--   AGENTS.md §18 #16: the app's "move user" deliberately moves MEMBERSHIPS,
--   never data, because a workspace's batches belong to the workspace, not to
--   whoever pressed Upload. That rule is right for the general tool. It is
--   also exactly why this one-off exists: here the founder has decided that
--   one person's work in the shared Founding Workspace IS his shop's work and
--   should follow him — and that decision is written here, once, with counts
--   printed at every step, and a rollback that puts every row back.
--
-- WHAT "HIS WORK" MEANS — read the PREVIEW first
--   Section 0 prints, per creator, how many batches / products / images the
--   Founding Workspace holds. By default the move takes batches CREATED BY the
--   gmail account. If the preview shows that other founding members uploaded
--   C&D's inventory under their own accounts, set v_move_all_founding_batches
--   to true and EVERY batch in the Founding Workspace moves instead — the
--   Founding Workspace then starts over as a demo workspace with no batches.
--
-- SAFE TO RE-RUN. The org is looked up by slug, every insert is
-- `on conflict do nothing`, and every update is filtered on "still in the
-- Founding Workspace", so a second run moves only what the first one missed
-- and copies nothing twice.
--
-- PREREQUISITE: supabase/migrations/tenant_scoped_uniqueness.sql (the script
-- refuses to run until it has — see step 1.2).
--
-- OPTIONAL TABLES are read through to_regclass(), so the script runs the same
-- whether or not brand_aliases.sql, listing_labels.sql, crm.sql,
-- support_messaging.sql, marketplaces.sql, org_shopify_connections.sql,
-- org_description_settings.sql or founding_user_admin.sql have been applied.
--
-- AFTER RUNNING (things SQL cannot do)
--   • CJ signs out and back in on the gmail account. He lands in C&D Vintage
--     as owner; the batch that was open stays open (it moved with him).
--   • Shopify title dedup for C&D exports: if section 1 printed
--     "shopify connection: moved" nothing more is needed. If it printed
--     "none", the Founding Workspace was using the global SHOPIFY_* Edge
--     Function secrets, which fire ONLY for the founding slug — so CJ (or a
--     founding admin who adds themself to C&D Vintage as admin for a minute)
--     connects the store in Workspace → Shopify. Afterwards consider unsetting
--     the global secrets, since the Founding Workspace is now a demo.
--   • Storage: nothing moves. The bucket is public and paths are keyed by
--     user id; CJ's files stay under his prefix, which is now read from the
--     new workspace. security_storage_policies.sql (if/when run) scopes writes
--     by ORG membership, and CJ is a member of the org his files belong to.
--   • The client's "C&D Vintage" fallback for the Founding Workspace's Vendor
--     column was removed in the same change (App.tsx); the Founding Workspace
--     now exports under its own name, and C&D Vintage under the setting
--     pinned by this script.
-- ============================================================================


-- ── 0. PREVIEW (read-only — run this block first, on its own) ──────────────
-- What the Founding Workspace holds, per creator. Decide from this whether
-- v_move_all_founding_batches below should be true.

select
  coalesce(u.email, b.user_id::text)                       as creator,
  count(distinct b.id)                                     as batches,
  count(distinct p.id)                                     as products,
  count(distinct i.id)                                     as images,
  min(b.created_at)::date                                  as first_batch,
  max(b.updated_at)::date                                  as last_touched
from public.workflow_batches b
join public.organizations o on o.id = b.org_id and o.slug = 'founding'
left join auth.users u on u.id = b.user_id
left join public.products p on p.batch_id = b.id
left join public.product_images i on i.product_id = p.id
group by 1
order by 2 desc;

-- Products in the Founding Workspace with no batch at all (Library "Unassigned"):
select coalesce(u.email, p.user_id::text) as creator, count(*) as unassigned_products
from public.products p
join public.organizations o on o.id = p.org_id and o.slug = 'founding'
left join auth.users u on u.id = p.user_id
where p.batch_id is null
group by 1 order by 2 desc;

-- Who is in the Founding Workspace today (the guard below needs at least one
-- owner/admin to REMAIN after the gmail account leaves):
select m.email, m.role, m.created_at::date
from public.org_members m
join public.organizations o on o.id = m.org_id and o.slug = 'founding'
order by m.role, m.email;


-- ── 1. THE MOVE (one transaction; every step prints its count) ─────────────

do $$
declare
  -- ▼▼ PARAMETERS — the only lines you should need to edit ▼▼
  v_owner_email               text    := 'thecreatendestroy@gmail.com';
  v_stay_email                text    := 'cjdub2004@icloud.com';   -- asserted UNTOUCHED
  v_new_name                  text    := 'C&D Vintage';
  v_new_slug                  text    := 'cd-vintage';             -- the idempotency key
  v_new_plan                  text    := 'beta';                   -- founding pricing for life
  v_vendor_name               text    := 'C&D Vintage';            -- the CSV Vendor column
  v_actor_email               text    := 'gabrielriosemail@gmail.com'; -- who is running this
  v_move_all_founding_batches boolean := false;                    -- see the header
  -- ▲▲ PARAMETERS ▲▲

  v_founding    uuid;
  v_new         uuid;
  v_user        uuid;
  v_stay_user   uuid;
  v_actor       uuid;
  v_created     boolean := false;
  v_old_role    text;
  v_settings    jsonb;
  v_cols        text;
  n             bigint;
  n2            bigint;
  remaining     int;
begin
  -- 1.1 Resolve the parties ---------------------------------------------------
  select id into v_founding from public.organizations where slug = 'founding';
  if v_founding is null then
    raise exception 'No organization with slug = ''founding'' — multi_org_tenancy.sql has not been run here.';
  end if;

  select id into v_user from auth.users where lower(email) = lower(v_owner_email) limit 1;
  if v_user is null then
    raise exception 'No auth.users row for % — the account must exist before its work can move.', v_owner_email;
  end if;

  select id into v_stay_user from auth.users where lower(email) = lower(v_stay_email) limit 1;
  select id into v_actor     from auth.users where lower(email) = lower(v_actor_email) limit 1;

  if not exists (select 1 from public.org_members where org_id = v_founding and user_id = v_user)
     and not exists (select 1 from public.organizations where slug = v_new_slug) then
    raise exception '% is not a member of the Founding Workspace and % does not exist yet — nothing to split.', v_owner_email, v_new_slug;
  end if;

  -- 1.2 PRE-FLIGHT: names must be unique PER WORKSPACE, not database-wide -----
  -- categories.name and category_presets.category_name still carry the
  -- single-workspace era's global UNIQUE unless tenant_scoped_uniqueness.sql
  -- has run. Under the global rule the copies in 1.9 / 1.10 cannot exist ("tees"
  -- is taken by the Founding Workspace), and the new workspace would open with
  -- no categories at all — so refuse now rather than build a broken tenant.
  if exists (
    select 1
    from pg_index i
    join pg_class c on c.oid = i.indrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and i.indisunique and i.indpred is null
      and ((c.relname = 'categories'       and i.indnkeyatts = 1 and i.indkey[0] = (select attnum from pg_attribute where attrelid = c.oid and attname = 'name'))
        or (c.relname = 'category_presets' and i.indnkeyatts = 1 and i.indkey[0] = (select attnum from pg_attribute where attrelid = c.oid and attname = 'category_name')))
  ) then
    raise exception 'Refusing: category names are still unique across the WHOLE database. Run supabase/migrations/tenant_scoped_uniqueness.sql first, then re-run this script.';
  end if;

  -- 1.3 The Founding Workspace must keep at least one owner/admin ------------
  select count(*) into remaining
  from public.org_members
  where org_id = v_founding and role in ('owner', 'admin') and user_id <> v_user;
  if remaining = 0 then
    raise exception 'Refusing: removing % would leave the Founding Workspace with no owner or admin (AGENTS.md §18 #16).', v_owner_email;
  end if;

  -- 1.4 The workspace (idempotent on slug) -----------------------------------
  select id into v_new from public.organizations where slug = v_new_slug;
  if v_new is null then
    v_settings := null;
    if exists (select 1 from information_schema.columns
               where table_schema = 'public' and table_name = 'organizations'
                 and column_name = 'description_settings') then
      execute 'select description_settings from public.organizations where id = $1'
        into v_settings using v_founding;
      v_settings := coalesce(v_settings, '{}'::jsonb) || jsonb_build_object('vendorName', v_vendor_name);
      execute 'insert into public.organizations (name, slug, plan, created_by, description_settings)
               values ($1, $2, $3, $4, $5) returning id'
        into v_new using v_new_name, v_new_slug, v_new_plan, v_user, v_settings;
    else
      insert into public.organizations (name, slug, plan, created_by)
      values (v_new_name, v_new_slug, v_new_plan, v_user)
      returning id into v_new;
    end if;
    v_created := true;
    raise notice '[1.4] created workspace "%" (%) plan=%', v_new_name, v_new, v_new_plan;
  else
    raise notice '[1.4] workspace "%" already exists (%) — reusing it', v_new_name, v_new;
  end if;

  -- 1.5 Membership: owner of the new workspace, out of the Founding one ------
  insert into public.org_members (org_id, user_id, role, email)
  values (v_new, v_user, 'owner', lower(v_owner_email))
  on conflict (org_id, user_id) do update set role = 'owner';

  select role into v_old_role from public.org_members where org_id = v_founding and user_id = v_user;
  delete from public.org_members where org_id = v_founding and user_id = v_user;
  get diagnostics n = row_count;
  raise notice '[1.5] % is owner of "%"; founding membership removed: % (was: %) — the ROLLBACK restores this role', v_owner_email, v_new_name, n, coalesce(v_old_role, 'not a member');

  -- any founding invite still addressed to that email is stale now
  delete from public.org_invites where org_id = v_founding and lower(email) = lower(v_owner_email);

  -- 1.6 Batches ----------------------------------------------------------------
  create temp table if not exists mv_batches (id uuid primary key) on commit drop;
  insert into mv_batches
  select id from public.workflow_batches
  where org_id = v_founding
    and (v_move_all_founding_batches or user_id = v_user)
  on conflict do nothing;

  update public.workflow_batches set org_id = v_new
  where id in (select id from mv_batches) and org_id = v_founding;
  get diagnostics n = row_count;
  raise notice '[1.6] batches moved: % (mode: %)', n,
    case when v_move_all_founding_batches then 'EVERY founding batch' else 'batches created by ' || v_owner_email end;

  -- 1.7 Products — by BATCH, plus the account's own unassigned rows -----------
  create temp table if not exists mv_products (id uuid primary key) on commit drop;
  insert into mv_products
  select id from public.products
  where org_id = v_founding
    and (batch_id in (select id from mv_batches)
         or (batch_id is null and user_id = v_user))
  on conflict do nothing;

  update public.products set org_id = v_new
  where id in (select id from mv_products) and org_id = v_founding;
  get diagnostics n = row_count;
  raise notice '[1.7] products moved: %', n;

  -- 1.8 Images — by product ----------------------------------------------------
  update public.product_images set org_id = v_new
  where product_id in (select id from mv_products)
    and (org_id = v_founding or org_id is null);
  get diagnostics n = row_count;
  raise notice '[1.8] product_images moved: %', n;

  -- 1.9 Categories — COPY the Founding Workspace's list (only into an empty one)
  if not exists (select 1 from public.categories where org_id = v_new) then
    select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into v_cols
    from information_schema.columns
    where table_schema = 'public' and table_name = 'categories'
      and column_name not in ('id', 'org_id', 'user_id', 'created_at', 'updated_at');
    execute format(
      'insert into public.categories (org_id, user_id, %1$s)
       select $1, $2, %1$s from public.categories where org_id = $3',
      v_cols) using v_new, v_user, v_founding;
    get diagnostics n = row_count;
    raise notice '[1.9] categories copied: %', n;
  else
    raise notice '[1.9] categories already present in the new workspace — not copied';
  end if;

  -- 1.10 Presets — COPY with an id map, then remap applied_preset_id -----------
  create temp table if not exists preset_map (old_id uuid primary key, new_id uuid not null) on commit drop;
  if not exists (select 1 from public.category_presets where org_id = v_new) then
    insert into preset_map (old_id, new_id)
    select id, gen_random_uuid() from public.category_presets where org_id = v_founding;

    select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into v_cols
    from information_schema.columns
    where table_schema = 'public' and table_name = 'category_presets'
      and column_name not in ('id', 'org_id', 'user_id', 'created_at', 'updated_at');
    execute format(
      'insert into public.category_presets (id, org_id, user_id, %1$s)
       select m.new_id, $1, $2, %1$s
       from public.category_presets p join preset_map m on m.old_id = p.id
       where p.org_id = $3',
      v_cols) using v_new, v_user, v_founding;
    get diagnostics n = row_count;

    n2 := 0;
    if exists (select 1 from information_schema.columns
               where table_schema = 'public' and table_name = 'products'
                 and column_name = 'applied_preset_id') then
      execute 'update public.products p set applied_preset_id = m.new_id
               from preset_map m
               where p.applied_preset_id = m.old_id
                 and p.id in (select id from mv_products)';
      get diagnostics n2 = row_count;
    end if;
    raise notice '[1.10] presets copied: %; applied_preset_id remapped on % products', n, n2;
  else
    raise notice '[1.10] presets already present in the new workspace — not copied';
  end if;

  -- 1.11 Marketplaces (marketplaces.sql) — copy opt-ins + workspace vocabulary,
  --      move the publication records of the moved listings
  if to_regclass('public.org_marketplaces') is not null then
    execute 'insert into public.org_marketplaces (org_id, marketplace, enabled, settings, created_by)
             select $1, marketplace, enabled, settings, $2
             from public.org_marketplaces where org_id = $3
             on conflict do nothing' using v_new, v_user, v_founding;
    get diagnostics n = row_count;
    raise notice '[1.11] marketplace opt-ins copied: %', n;
  end if;
  if to_regclass('public.marketplace_vocab') is not null then
    execute 'insert into public.marketplace_vocab
               (org_id, marketplace, kind, canonical, marketplace_value, created_by, created_by_email)
             select $1, marketplace, kind, canonical, marketplace_value, $2, $3
             from public.marketplace_vocab where org_id = $4
             on conflict do nothing' using v_new, v_user, lower(v_owner_email), v_founding;
    get diagnostics n = row_count;
    raise notice '[1.11] workspace marketplace vocabulary copied: %', n;
  end if;
  if to_regclass('public.listing_publications') is not null then
    execute 'update public.listing_publications set org_id = $1
             where org_id = $2
               and (batch_id in (select id from mv_batches)
                    or product_group_id in (select id from mv_products))'
      using v_new, v_founding;
    get diagnostics n = row_count;
    raise notice '[1.11] publication records moved: %', n;
  end if;

  -- 1.12 Brand aliases (brand_aliases.sql) — copy
  if to_regclass('public.brand_aliases') is not null then
    execute 'insert into public.brand_aliases (org_id, heard, preferred, created_by, created_by_email)
             select $1, heard, preferred, $2, $3
             from public.brand_aliases where org_id = $4
             on conflict do nothing' using v_new, v_user, lower(v_owner_email), v_founding;
    get diagnostics n = row_count;
    raise notice '[1.12] brand aliases copied: %', n;
  end if;

  -- 1.13 Listing labels (listing_labels.sql) — copy the vocabulary, re-point the
  --      moved products' assignments at the copies
  if to_regclass('public.listing_labels') is not null then
    create temp table if not exists label_map (old_id uuid primary key, new_id uuid not null) on commit drop;
    execute 'insert into label_map (old_id, new_id)
             select id, gen_random_uuid() from public.listing_labels where org_id = $1
               and lower(btrim(name)) not in
                 (select lower(btrim(name)) from public.listing_labels where org_id = $2)'
      using v_founding, v_new;
    execute 'insert into public.listing_labels (id, org_id, name, color, kind, sort_order, created_by)
             select m.new_id, $1, l.name, l.color, l.kind, l.sort_order, $2
             from public.listing_labels l join label_map m on m.old_id = l.id
             on conflict do nothing' using v_new, v_user;
    get diagnostics n = row_count;
    -- labels that already existed in the new workspace (same name) map onto those
    execute 'insert into label_map (old_id, new_id)
             select f.id, t.id
             from public.listing_labels f
             join public.listing_labels t on t.org_id = $1 and lower(btrim(t.name)) = lower(btrim(f.name))
             where f.org_id = $2
             on conflict do nothing' using v_new, v_founding;
    if to_regclass('public.product_labels') is not null then
      execute 'update public.product_labels pl set org_id = $1, label_id = m.new_id
               from label_map m
               where pl.label_id = m.old_id and pl.org_id = $2
                 and pl.product_id in (select id from mv_products)'
        using v_new, v_founding;
      get diagnostics n2 = row_count;
    else
      n2 := 0;
    end if;
    raise notice '[1.13] listing labels copied: %; assignments re-pointed: %', n, n2;
  end if;

  -- 1.14 Support threads + CRM contact follow the account -------------------
  if to_regclass('public.support_threads') is not null then
    execute 'update public.support_threads set org_id = $1, org_name = $2
             where user_id = $3 and (org_id = $4 or org_id is null)'
      using v_new, v_new_name, v_user, v_founding;
    get diagnostics n = row_count;
    raise notice '[1.14] support threads re-pointed: %', n;
  end if;
  if to_regclass('public.crm_contacts') is not null then
    execute 'update public.crm_contacts set org_id = $1, company = coalesce(nullif(company, ''''), $2)
             where (user_id = $3 or lower(email) = $4) and (org_id = $5 or org_id is null)'
      using v_new, v_new_name, v_user, lower(v_owner_email), v_founding;
    get diagnostics n = row_count;
    raise notice '[1.14] CRM contacts re-pointed: %', n;
  end if;

  -- 1.15 Shopify connection: the Founding Workspace's per-org row IS C&D's store
  if to_regclass('public.org_shopify_connections') is not null then
    if exists (select 1 from public.org_shopify_connections where org_id = v_new) then
      raise notice '[1.15] shopify connection: the new workspace already has one — founding row left alone';
    else
      execute 'update public.org_shopify_connections set org_id = $1 where org_id = $2'
        using v_new, v_founding;
      get diagnostics n = row_count;
      raise notice '[1.15] shopify connection: %', case when n > 0 then 'moved' else 'none (see the header — connect it from Workspace → Shopify)' end;
    end if;
  end if;

  -- 1.16 The guard the header promised: the icloud account is untouched -------
  if v_stay_user is not null
     and not exists (select 1 from public.org_members where org_id = v_founding and user_id = v_stay_user) then
    raise exception 'Invariant broken: % is no longer in the Founding Workspace — rolling back.', v_stay_email;
  end if;

  -- 1.17 Audit ----------------------------------------------------------------
  if to_regclass('public.founding_admin_audit') is not null then
    execute 'insert into public.founding_admin_audit
               (actor_id, actor_email, action, target_user, target_email,
                from_org, from_org_name, to_org, to_org_name, role)
             values ($1, $2, $3, $4, $5, $6, ''Founding Workspace'', $7, $8, ''owner'')'
      using v_actor, lower(v_actor_email),
            case when v_created then 'split_workspace' else 'split_workspace_rerun' end,
            v_user, lower(v_owner_email), v_founding, v_new, v_new_name;
    raise notice '[1.17] audit row written';
  end if;

  raise notice '[done] "%" (%) — sign out and back in on % to land in it.', v_new_name, v_new, v_owner_email;
end $$;


-- ── 2. VERIFY ────────────────────────────────────────────────────────────────
-- (a) Both workspaces, with counts. Founding should show the icloud account
--     still there; the new one should show the gmail account as owner.
select o.name, o.slug, o.plan,
       (select count(*) from public.org_members m where m.org_id = o.id)      as members,
       (select string_agg(m.email || ':' || m.role, ', ' order by m.role)
          from public.org_members m where m.org_id = o.id)                    as roster,
       (select count(*) from public.workflow_batches b where b.org_id = o.id) as batches,
       (select count(*) from public.products p where p.org_id = o.id)         as products,
       (select count(*) from public.product_images i where i.org_id = o.id)   as images,
       (select count(*) from public.categories c where c.org_id = o.id)       as categories,
       (select count(*) from public.category_presets p where p.org_id = o.id) as presets
from public.organizations o
where o.slug in ('founding', 'cd-vintage')
order by o.slug;

-- (b) No product may sit in a different workspace from its batch, and no image
--     in a different workspace from its product — expect ZERO rows from both:
select p.id from public.products p
join public.workflow_batches b on b.id = p.batch_id
where p.org_id is distinct from b.org_id;
select i.id from public.product_images i
join public.products p on p.id = i.product_id
where i.org_id is distinct from p.org_id;

-- (c) The Vendor name the new workspace will export under:
select name, description_settings ->> 'vendorName' as vendor_name
from public.organizations where slug = 'cd-vintage';


-- ============================================================================
-- ROLLBACK — puts every moved row back and deletes the copies + the workspace.
-- Also one transaction; also prints counts. The copied presets are deleted, so
-- applied_preset_id on the returned products is re-pointed to the Founding
-- Workspace's preset with the same product_type / category_name (the copy was
-- field-for-field identical, so this is exact unless a preset was edited in
-- the new workspace in between).
-- ============================================================================
/*
do $$
declare
  v_owner_email  text := 'thecreatendestroy@gmail.com';
  v_new_slug     text := 'cd-vintage';
  v_restore_role text := 'admin';   -- what section 1.5 printed as "(was: …)"
  v_founding uuid; v_new uuid; v_user uuid; n bigint;
begin
  select id into v_founding from public.organizations where slug = 'founding';
  select id into v_new      from public.organizations where slug = v_new_slug;
  select id into v_user     from auth.users where lower(email) = lower(v_owner_email) limit 1;
  if v_new is null then raise notice 'nothing to roll back'; return; end if;

  -- presets: re-point moved products at the founding twin, then drop the copies
  if exists (select 1 from information_schema.columns where table_schema='public'
             and table_name='products' and column_name='applied_preset_id') then
    execute 'update public.products p set applied_preset_id = f.id
             from public.category_presets c
             join public.category_presets f
               on f.org_id = $1
              and f.category_name is not distinct from c.category_name
              and f.product_type  is not distinct from c.product_type
             where c.org_id = $2 and p.applied_preset_id = c.id and p.org_id = $2'
      using v_founding, v_new;
  end if;
  delete from public.category_presets where org_id = v_new;
  delete from public.categories       where org_id = v_new;

  if to_regclass('public.product_labels') is not null then
    execute 'update public.product_labels pl set org_id = $1, label_id = f.id
             from public.listing_labels c
             join public.listing_labels f on f.org_id = $1 and lower(btrim(f.name)) = lower(btrim(c.name))
             where c.org_id = $2 and pl.label_id = c.id' using v_founding, v_new;
  end if;
  if to_regclass('public.listing_labels')       is not null then execute 'delete from public.listing_labels where org_id = $1' using v_new; end if;
  if to_regclass('public.brand_aliases')        is not null then execute 'delete from public.brand_aliases  where org_id = $1' using v_new; end if;
  if to_regclass('public.marketplace_vocab')    is not null then execute 'delete from public.marketplace_vocab where org_id = $1' using v_new; end if;
  if to_regclass('public.org_marketplaces')     is not null then execute 'delete from public.org_marketplaces  where org_id = $1' using v_new; end if;
  if to_regclass('public.listing_publications') is not null then execute 'update public.listing_publications set org_id = $1 where org_id = $2' using v_founding, v_new; end if;
  if to_regclass('public.support_threads')      is not null then execute 'update public.support_threads set org_id = $1, org_name = ''Founding Workspace'' where org_id = $2' using v_founding, v_new; end if;
  if to_regclass('public.crm_contacts')         is not null then execute 'update public.crm_contacts set org_id = $1 where org_id = $2' using v_founding, v_new; end if;
  if to_regclass('public.org_shopify_connections') is not null then execute 'update public.org_shopify_connections set org_id = $1 where org_id = $2 and not exists (select 1 from public.org_shopify_connections where org_id = $1)' using v_founding, v_new; end if;

  update public.product_images   set org_id = v_founding where org_id = v_new; get diagnostics n = row_count; raise notice 'images back: %', n;
  update public.products         set org_id = v_founding where org_id = v_new; get diagnostics n = row_count; raise notice 'products back: %', n;
  update public.workflow_batches set org_id = v_founding where org_id = v_new; get diagnostics n = row_count; raise notice 'batches back: %', n;

  insert into public.org_members (org_id, user_id, role, email)
  values (v_founding, v_user, v_restore_role, lower(v_owner_email))
  on conflict (org_id, user_id) do nothing;
  delete from public.org_members where org_id = v_new;
  delete from public.organizations where id = v_new;
  raise notice 'rolled back: "%" deleted, % restored to the Founding Workspace as %', v_new_slug, v_owner_email, v_restore_role;
end $$;
*/
