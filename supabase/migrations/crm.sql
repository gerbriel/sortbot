-- ============================================================================
-- CRM — first-party contact tracking for the Founding Workspace
-- ============================================================================
-- Run AFTER multi_org_tenancy.sql and beta_signups.sql (reuses is_beta_admin()
-- and the organizations table). Purely additive; idempotent; rollback at the
-- bottom. Nothing in the listing workflow reads or writes these tables.
--
-- MODEL: one contact per email, owned entirely by the Founding Workspace
-- admins (every policy is is_beta_admin()). Contacts are created three ways:
--   * crm_sync_contacts() mirrors beta requests and real accounts (with their
--     workspace) into contacts — this is how "new orgs and users" show up
--     without anyone typing. It preserves anything an admin edited by hand:
--     name/company only fill blanks, stage only moves forward from
--     lead/approved, tags/follow-ups/notes are never touched.
--   * manual "Add contact" in the panel (source = 'manual').
--   * (no third party — this replaces an external CRM outright)
--
-- STAGES: lead (asked / pending) → approved (beta approved, not signed in yet)
--         → active (has a workspace) → churned | lost (denied, or manual).
--
-- The Founding Workspace's own members are skipped by the sync — the CRM
-- tracks customers, not the team.
-- ============================================================================

create table if not exists public.crm_contacts (
  id             uuid primary key default gen_random_uuid(),
  email          text not null check (char_length(email) between 3 and 254),
  name           text,
  company        text,
  source         text not null default 'manual'
                   check (source in ('manual','beta_signup','account')),
  stage          text not null default 'lead'
                   check (stage in ('lead','approved','active','churned','lost')),
  tags           text[] not null default '{}',
  next_follow_up date,
  user_id        uuid references auth.users(id) on delete set null,
  org_id         uuid references public.organizations(id) on delete set null,
  last_seen_at   timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create unique index if not exists crm_contacts_email_uidx
  on public.crm_contacts (lower(email));
create index if not exists crm_contacts_stage_idx
  on public.crm_contacts (stage);
create index if not exists crm_contacts_follow_up_idx
  on public.crm_contacts (next_follow_up) where next_follow_up is not null;

create table if not exists public.crm_notes (
  id           uuid primary key default gen_random_uuid(),
  contact_id   uuid not null references public.crm_contacts(id) on delete cascade,
  author_id    uuid references auth.users(id) on delete set null default auth.uid(),
  author_email text,
  body         text not null check (char_length(body) between 1 and 4000),
  created_at   timestamptz not null default now()
);

create index if not exists crm_notes_contact_idx
  on public.crm_notes (contact_id, created_at desc);

-- updated_at bookkeeping
create or replace function public.crm_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists crm_contacts_touch on public.crm_contacts;
create trigger crm_contacts_touch
  before update on public.crm_contacts
  for each row execute function public.crm_touch_updated_at();

alter table public.crm_contacts enable row level security;
alter table public.crm_notes    enable row level security;

-- email is the dedup key and source/user/org links come from the sync, so
-- clients may only edit the hand-maintained columns.
grant select, insert, delete on public.crm_contacts to authenticated;
grant update (name, company, stage, tags, next_follow_up) on public.crm_contacts to authenticated;
grant select, insert, delete on public.crm_notes to authenticated;

drop policy if exists crm_contacts_select on public.crm_contacts;
create policy crm_contacts_select on public.crm_contacts for select
  to authenticated using (public.is_beta_admin());
drop policy if exists crm_contacts_insert on public.crm_contacts;
create policy crm_contacts_insert on public.crm_contacts for insert
  to authenticated with check (public.is_beta_admin());
drop policy if exists crm_contacts_update on public.crm_contacts;
create policy crm_contacts_update on public.crm_contacts for update
  to authenticated using (public.is_beta_admin()) with check (public.is_beta_admin());
drop policy if exists crm_contacts_delete on public.crm_contacts;
create policy crm_contacts_delete on public.crm_contacts for delete
  to authenticated using (public.is_beta_admin());

drop policy if exists crm_notes_select on public.crm_notes;
create policy crm_notes_select on public.crm_notes for select
  to authenticated using (public.is_beta_admin());
-- Authorship cannot be self-asserted: the author is the caller.
drop policy if exists crm_notes_insert on public.crm_notes;
create policy crm_notes_insert on public.crm_notes for insert
  to authenticated with check (
    public.is_beta_admin()
    and author_id = auth.uid()
    and (author_email is null or lower(author_email) = lower(auth.jwt() ->> 'email'))
  );
drop policy if exists crm_notes_delete on public.crm_notes;
create policy crm_notes_delete on public.crm_notes for delete
  to authenticated using (public.is_beta_admin());

-- ── Sync: beta requests + accounts → contacts ────────────────────────────────
-- Idempotent. Returns {"inserted": n, "updated": n} (updated = existing rows
-- re-checked, whether or not anything changed).
create or replace function public.crm_sync_contacts()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r       record;
  v_stage text;
  v_ins   int := 0;
  v_upd   int := 0;
begin
  if not public.is_beta_admin() then
    raise exception 'crm_sync_contacts: Founding Workspace admins only'
      using errcode = '42501';
  end if;

  -- 1. Beta requests → lead / approved / lost.
  for r in
    select lower(trim(email)) as email, contact_name, org_name, status
    from public.beta_signups
  loop
    v_stage := case r.status when 'approved' then 'approved'
                             when 'denied'   then 'lost'
                             else 'lead' end;
    update public.crm_contacts c set
      name    = coalesce(c.name, nullif(trim(r.contact_name), '')),
      company = coalesce(c.company, nullif(trim(r.org_name), '')),
      stage   = case when c.stage in ('lead','approved') then v_stage else c.stage end
    where lower(c.email) = r.email;
    if found then
      v_upd := v_upd + 1;
    else
      insert into public.crm_contacts (email, name, company, source, stage)
      values (r.email, nullif(trim(r.contact_name), ''), nullif(trim(r.org_name), ''),
              'beta_signup', v_stage);
      v_ins := v_ins + 1;
    end if;
  end loop;

  -- 2. Accounts → active once they have a (non-founding) workspace. Accounts
  --    that belong ONLY to the Founding Workspace are the team — skipped.
  for r in
    select lower(trim(u.email)) as email,
           u.id as user_id,
           u.last_sign_in_at,
           nullif(trim(coalesce(u.raw_user_meta_data ->> 'full_name',
                                u.raw_user_meta_data ->> 'name')), '') as meta_name,
           m.org_id,
           o.name as org_name,
           exists (
             select 1 from public.org_members fm
             join public.organizations fo on fo.id = fm.org_id
             where fm.user_id = u.id and fo.slug = 'founding'
           ) as is_team
    from auth.users u
    left join lateral (
      select om.org_id
      from public.org_members om
      join public.organizations oo on oo.id = om.org_id
      where om.user_id = u.id and coalesce(oo.slug, '') <> 'founding'
      order by om.created_at asc
      limit 1
    ) m on true
    left join public.organizations o on o.id = m.org_id
    where u.email is not null
  loop
    if r.is_team and r.org_id is null then
      continue;
    end if;
    update public.crm_contacts c set
      user_id      = r.user_id,
      org_id       = coalesce(r.org_id, c.org_id),
      company      = coalesce(r.org_name, c.company),
      name         = coalesce(c.name, r.meta_name),
      last_seen_at = greatest(c.last_seen_at, r.last_sign_in_at),
      stage        = case when r.org_id is not null and c.stage in ('lead','approved')
                          then 'active' else c.stage end
    where lower(c.email) = r.email;
    if found then
      v_upd := v_upd + 1;
    else
      insert into public.crm_contacts
        (email, name, company, source, stage, user_id, org_id, last_seen_at)
      values
        (r.email, r.meta_name, r.org_name, 'account',
         case when r.org_id is not null then 'active' else 'lead' end,
         r.user_id, r.org_id, r.last_sign_in_at);
      v_ins := v_ins + 1;
    end if;
  end loop;

  return jsonb_build_object('inserted', v_ins, 'updated', v_upd);
end;
$$;

grant execute on function public.crm_sync_contacts() to authenticated;

-- ============================================================================
-- ROLLBACK (manual)
-- ============================================================================
-- drop function if exists public.crm_sync_contacts();
-- drop trigger if exists crm_contacts_touch on public.crm_contacts;
-- drop function if exists public.crm_touch_updated_at();
-- drop table if exists public.crm_notes;
-- drop table if exists public.crm_contacts;
