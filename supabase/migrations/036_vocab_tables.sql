-- ============================================================================
-- VOCABULARY TABLES — founder-curated descriptor chips + brand keywords
-- ============================================================================
-- Run AFTER multi_org_tenancy.sql and beta_signups.sql (reuses is_beta_admin(),
-- the "Founding Workspace owner/admin" check). Purely additive; idempotent;
-- rollback at the bottom.
--
-- MODEL: this vocabulary is GLOBAL content, not per-org data.
--   * Every authenticated user (all workspaces) READS it — chips render in
--     Step 3 and brand words flow into generated tags for everyone.
--   * Only Founding Workspace owners/admins can WRITE it, via the in-app
--     Vocabulary dashboard. Beta users use the features; founders curate them.
--
-- descriptor_chips — the Step 3 "Quick keywords" chips.
--   label       what the chip button says
--   output_text what actually gets inserted into the description when tapped
--               (NULL → the label itself). Lets a short chip emit richer
--               keywords, e.g. label "sports" → output "sports athletic gym".
--
-- brand_keywords — words associated with a brand.
--   When an item's brand matches (case-insensitive), the keywords are merged
--   into the generated tags (and therefore the #hashtags in the description),
--   exactly like category-preset tags. Augments the hardcoded BRAND_DNA
--   engine — it does not replace it.
-- ============================================================================

create table if not exists public.descriptor_chips (
  id          uuid primary key default gen_random_uuid(),
  label       text not null,
  output_text text,
  sort_order  int not null default 999,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

create unique index if not exists descriptor_chips_label_uidx
  on public.descriptor_chips (lower(label));

create table if not exists public.brand_keywords (
  id         uuid primary key default gen_random_uuid(),
  brand      text not null,
  keywords   text[] not null default '{}',
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index if not exists brand_keywords_brand_uidx
  on public.brand_keywords (lower(brand));

alter table public.descriptor_chips enable row level security;
alter table public.brand_keywords   enable row level security;

grant select, insert, update, delete on public.descriptor_chips, public.brand_keywords to authenticated;

-- READ: everyone signed in (all workspaces use the vocabulary).
drop policy if exists chips_select on public.descriptor_chips;
create policy chips_select on public.descriptor_chips for select
  to authenticated using (true);

drop policy if exists brandkw_select on public.brand_keywords;
create policy brandkw_select on public.brand_keywords for select
  to authenticated using (true);

-- WRITE: Founding Workspace owners/admins only (is_beta_admin() is exactly
-- that check — the name comes from the beta_signups migration that created it).
drop policy if exists chips_insert on public.descriptor_chips;
create policy chips_insert on public.descriptor_chips for insert
  to authenticated with check (public.is_beta_admin());
drop policy if exists chips_update on public.descriptor_chips;
create policy chips_update on public.descriptor_chips for update
  to authenticated using (public.is_beta_admin()) with check (public.is_beta_admin());
drop policy if exists chips_delete on public.descriptor_chips;
create policy chips_delete on public.descriptor_chips for delete
  to authenticated using (public.is_beta_admin());

drop policy if exists brandkw_insert on public.brand_keywords;
create policy brandkw_insert on public.brand_keywords for insert
  to authenticated with check (public.is_beta_admin());
drop policy if exists brandkw_update on public.brand_keywords;
create policy brandkw_update on public.brand_keywords for update
  to authenticated using (public.is_beta_admin()) with check (public.is_beta_admin());
drop policy if exists brandkw_delete on public.brand_keywords;
create policy brandkw_delete on public.brand_keywords for delete
  to authenticated using (public.is_beta_admin());

-- ── Seed: current hardcoded chip list (client falls back to the same list
--    when this table is missing or empty, so behavior is identical either way)
insert into public.descriptor_chips (label, sort_order)
values
  ('faded', 1), ('distressed', 2), ('boxy', 3), ('oversized', 4),
  ('cropped', 5), ('baggy', 6), ('graphic', 7), ('embroidered', 8),
  ('single stitch', 9), ('double stitch', 10), ('streetwear', 11),
  ('skater', 12), ('grunge', 13), ('y2k', 14), ('workwear', 15),
  ('sports', 16), ('hooded', 17), ('zip up', 18), ('quarter zip', 19),
  ('snap button', 20), ('color block', 21), ('plaid', 22), ('flannel', 23),
  ('striped', 24), ('tie dye', 25), ('camo', 26), ('heavyweight', 27),
  ('lightweight', 28), ('made in usa', 29), ('deadstock', 30), ('rare', 31)
on conflict (lower(label)) do nothing;

-- ── VERIFY (run separately) ─────────────────────────────────────────────────
--   select count(*) from public.descriptor_chips;      -- 31 after first run
--   select public.is_beta_admin();                     -- true as founding admin

-- ── ROLLBACK ────────────────────────────────────────────────────────────────
-- drop table if exists public.descriptor_chips;
-- drop table if exists public.brand_keywords;
