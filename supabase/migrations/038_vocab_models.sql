-- ============================================================================
-- VOCAB MODELS — founder-curated model knowledge base (editable MODEL_DATABASE)
-- ============================================================================
-- Run AFTER multi_org_tenancy.sql and beta_signups.sql (reuses is_beta_admin(),
-- the "Founding Workspace owner/admin" check). Purely additive; idempotent;
-- rollback at the bottom. Companion to vocab_tables.sql.
--
-- MODEL: same as descriptor_chips / brand_keywords — GLOBAL content.
--   * Every authenticated user (all workspaces) can READ.
--   * Only Founding Workspace owners/admins can WRITE (the Vocabulary
--     dashboard's Models tab).
--
-- Nothing in the app CONSUMES these rows yet — they're the growing knowledge
-- base for the future photo-scanning feature (identifying features are its
-- recognition checklist; price ranges feed pricing suggestions). The 65
-- hardcoded MODEL_DATABASE entries are importable one-click from the
-- dashboard; imported/edited rows are the source of truth going forward.
-- ============================================================================

create table if not exists public.vocab_models (
  id                   uuid primary key default gen_random_uuid(),
  brand                text not null,
  model_name           text not null,
  model_number         text,
  category             text,
  year_introduced      int,
  discontinued         boolean not null default false,
  keywords             text[] not null default '{}',
  identifying_features text[] not null default '{}',
  price_min            numeric,
  price_max            numeric,
  collectibility       int check (collectibility between 1 and 10),
  is_active            boolean not null default true,
  created_at           timestamptz not null default now()
);

create unique index if not exists vocab_models_brand_model_uidx
  on public.vocab_models (lower(brand), lower(model_name));

alter table public.vocab_models enable row level security;

grant select, insert, update, delete on public.vocab_models to authenticated;

-- READ: everyone signed in.
drop policy if exists models_select on public.vocab_models;
create policy models_select on public.vocab_models for select
  to authenticated using (true);

-- WRITE: Founding Workspace owners/admins only.
drop policy if exists models_insert on public.vocab_models;
create policy models_insert on public.vocab_models for insert
  to authenticated with check (public.is_beta_admin());
drop policy if exists models_update on public.vocab_models;
create policy models_update on public.vocab_models for update
  to authenticated using (public.is_beta_admin()) with check (public.is_beta_admin());
drop policy if exists models_delete on public.vocab_models;
create policy models_delete on public.vocab_models for delete
  to authenticated using (public.is_beta_admin());

-- ── VERIFY (run separately) ─────────────────────────────────────────────────
--   select count(*) from public.vocab_models;  -- 0 until models are imported/added

-- ── ROLLBACK ────────────────────────────────────────────────────────────────
-- drop table if exists public.vocab_models;
