-- ============================================================================
-- ORG SHOPIFY CONNECTIONS — per-workspace Shopify Admin API credentials
-- ============================================================================
-- Run AFTER multi_org_tenancy.sql (uses the user_org_ids / is_org_admin
-- helpers). Purely additive; idempotent; rollback at the bottom.
--
-- SECURITY MODEL (the whole point of this table):
--   * The Admin token is WRITE-ONLY for clients. `authenticated` gets INSERT
--     on the admin_token column but NO SELECT on it (column-level grants).
--     The token is read ONLY by the shopify-titles Edge Function via the
--     service role. No browser session can ever read a token back.
--   * Saves are replace-style (DELETE then INSERT with return=minimal) so
--     PostgREST never needs to echo the row.
--   * Only org owners/admins can connect or disconnect; all org members may
--     see THAT a store is connected and its domain (never the token).
--
-- FLOW:
--   1. An org admin creates a custom app in their own Shopify admin
--      (Settings → Apps and sales channels → Develop apps) with the
--      read_products Admin API scope, then pastes the store domain and
--      shpat_ token into the Workspace panel's Shopify section.
--   2. The shopify-titles Edge Function resolves the caller's org and uses
--      that org's token for the title/handle dedup. The global
--      SHOPIFY_STORE / SHOPIFY_ADMIN_TOKEN secrets remain as a fallback for
--      the Founding Workspace only; other orgs without a connection get an
--      empty result (DB-only dedup in the exporter, exactly as before).
-- ============================================================================

create table if not exists public.org_shopify_connections (
  org_id       uuid primary key references public.organizations(id) on delete cascade,
  store_domain text not null,
  admin_token  text not null,
  created_by   uuid references auth.users(id) default auth.uid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table public.org_shopify_connections enable row level security;

-- Column-level grants: the token is write-only for clients.
revoke all on public.org_shopify_connections from anon;
revoke all on public.org_shopify_connections from authenticated;
grant select (org_id, store_domain, created_at, updated_at)
  on public.org_shopify_connections to authenticated;
grant insert (org_id, store_domain, admin_token)
  on public.org_shopify_connections to authenticated;
grant delete on public.org_shopify_connections to authenticated;

-- RLS row policies
drop policy if exists shopify_conn_select on public.org_shopify_connections;
create policy shopify_conn_select on public.org_shopify_connections for select
  to authenticated
  using (org_id in (select public.user_org_ids()));

drop policy if exists shopify_conn_insert on public.org_shopify_connections;
create policy shopify_conn_insert on public.org_shopify_connections for insert
  to authenticated
  with check (public.is_org_admin(org_id));

drop policy if exists shopify_conn_delete on public.org_shopify_connections;
create policy shopify_conn_delete on public.org_shopify_connections for delete
  to authenticated
  using (public.is_org_admin(org_id));

-- ── VERIFY ──────────────────────────────────────────────────────────────────
-- (The SQL Editor runs as postgres and bypasses grants — test the token
--  lockout from the APP, e.g. the browser devtools console while signed in:)
--
--   const { error } = await supabase
--     .from('org_shopify_connections').select('admin_token');
--   // error.code must be '42501' (permission denied for column)
--
--   const { data } = await supabase
--     .from('org_shopify_connections').select('org_id, store_domain');
--   // works, shows your org's connection without the token

-- ── ROLLBACK ────────────────────────────────────────────────────────────────
-- drop table if exists public.org_shopify_connections;
