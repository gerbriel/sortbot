-- ============================================================================
-- BETA ADMIN DIRECTORY — aggregate view of all workspaces for Founding admins
-- ============================================================================
-- Run AFTER beta_signups.sql (uses is_beta_admin()). Additive; idempotent.
--
-- WHY A FUNCTION (not wider RLS): Founding Workspace admins need oversight of
-- the beta program — which shops have workspaces, how many members, how active.
-- Widening SELECT policies on organizations/org_members/workflow_batches would
-- expose other tenants' actual DATA to founding admins. This SECURITY DEFINER
-- function returns AGGREGATES ONLY (counts, member emails, last-activity
-- timestamp) — no batch contents, no products, no images. Non-admin callers
-- get zero rows.
-- ============================================================================

create or replace function public.beta_org_directory()
returns table (
  org_id        uuid,
  name          text,
  slug          text,
  plan          text,
  created_at    timestamptz,
  member_count  bigint,
  member_emails text[],
  batch_count   bigint,
  product_count bigint,
  image_count   bigint,
  last_active   timestamptz
)
language sql security definer stable
set search_path = public
as $$
  select
    o.id,
    o.name,
    o.slug,
    o.plan,
    o.created_at,
    (select count(*) from public.org_members m where m.org_id = o.id),
    (select coalesce(array_agg(m.email order by m.created_at) filter (where m.email is not null), '{}')
       from public.org_members m where m.org_id = o.id),
    (select count(*) from public.workflow_batches b where b.org_id = o.id),
    (select count(*) from public.products p where p.org_id = o.id),
    (select count(*) from public.product_images pi where pi.org_id = o.id),
    (select max(b.updated_at) from public.workflow_batches b where b.org_id = o.id)
  from public.organizations o
  where public.is_beta_admin()   -- non-admins: zero rows, no error
  order by o.created_at desc
$$;

grant execute on function public.beta_org_directory() to authenticated;

-- ── VERIFY (run separately, signed in as a Founding admin via the app) ──────
--   select * from public.beta_org_directory();

-- ── ROLLBACK ────────────────────────────────────────────────────────────────
-- drop function if exists public.beta_org_directory();
