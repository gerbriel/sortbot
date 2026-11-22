-- ============================================================================
-- SECURITY: ORG INVITES HARDENING — close the invitee self-promotion path
-- ============================================================================
-- Run AFTER multi_org_tenancy.sql. Additive, idempotent, rollback at the
-- bottom. Run this BEFORE security_verified_email.sql (that migration layers
-- a verified-email requirement onto the same two invite policies).
--
-- THE HOLE (security audit 05, finding #2 — High):
--   multi_org_tenancy.sql grants table-wide UPDATE on org_invites to
--   `authenticated`, and org_invites_update lets the INVITEE update their own
--   row. invited_role() reads `role` straight off that row, and
--   org_members_insert clause (2) accepts any membership whose role equals it.
--   Three PostgREST calls therefore promote an invited member to OWNER:
--     1. PATCH org_invites  → {"role":"owner","accepted_at":null}
--     2. DELETE org_members → my own row (self-removal is allowed)
--     3. POST   org_members → {"role":"owner"}   -- invited_role() now says owner
--   From there is_org_admin() is true: remove the real owner, rewrite
--   description_settings, replace the Shopify connection, invite outsiders.
--
-- THE FIX (three independent layers — any one of them stops the chain):
--   1. COLUMN-LEVEL UPDATE GRANT. `authenticated` may update only
--      org_invites.accepted_at. `role`, `org_id` and `email` become
--      unwritable from any client, for admins too (Postgres column grants are
--      not role-conditional). orgService only ever writes accepted_at, so no
--      app path changes. Changing a pending invite's role is now
--      revoke + re-invite, which the Workspace panel already supports.
--   2. An invite may never mint an OWNER. The invite UI only offers
--      member/admin, so this costs nothing and removes the escalation target.
--   3. The invite must still be OPEN at the moment of joining — invited_role()
--      already requires accepted_at IS NULL; making it explicit in the policy
--      means a replayed/legacy row cannot be reused.
--
--   Plus: one open invite per (org, email). A duplicate-invite pile is what
--   makes "most recent row wins" ambiguous in the first place.
-- ============================================================================


-- ── 1. role / org_id / email are not client-writable ────────────────────────
-- revoke is a no-op the second time; the grant re-states the allowed column.
revoke update on public.org_invites from authenticated;
grant  update (accepted_at) on public.org_invites to authenticated;


-- ── 2. One invite row per (org, lower(email)) ───────────────────────────────
-- Guarded: if duplicates already exist the index cannot be built, and a failed
-- CREATE INDEX must not abort the rest of this migration. Clean the duplicates
-- (query in VERIFY below) and re-run to pick the index up.
do $$
begin
  create unique index if not exists org_invites_org_email_uidx
    on public.org_invites (org_id, lower(email));
exception when others then
  raise notice 'org_invites_org_email_uidx not created (duplicate invites exist?): %', sqlerrm;
end $$;


-- ── 3. Membership insert: no owner via invite, invite must be open ──────────
-- Clause (1) (creator bootstraps as owner of their own brand-new org) and
-- clause (3) (org admins add members) are unchanged.
drop policy if exists org_members_insert on public.org_members;
create policy org_members_insert on public.org_members for insert to authenticated
  with check (
    -- (1) creator bootstraps as owner of their brand-new empty org
    (user_id = auth.uid() and role = 'owner'
       and not public.org_has_members(org_id)
       and exists (select 1 from public.organizations o
                   where o.id = org_id and o.created_by = auth.uid()))
    -- (2) invitee joins with exactly the invited role — never as owner, and
    --     only while an unaccepted invite for them still exists
    or (user_id = auth.uid()
        and role = public.invited_role(org_id)
        and role in ('admin','member'))
    -- (3) org admins add members directly
    or public.is_org_admin(org_id)
  );


-- ============================================================================
-- VERIFY (run separately)
-- ============================================================================
-- -- (a) The grant must list accepted_at ONLY:
-- select privilege_type, column_name
-- from information_schema.column_privileges
-- where table_schema='public' and table_name='org_invites'
--   and grantee='authenticated' and privilege_type='UPDATE';
--
-- -- (b) As an invited member, this must FAIL ("permission denied for column role"):
-- update public.org_invites set role='owner' where lower(email)=lower(auth.jwt()->>'email');
--
-- -- (c) Duplicate invites blocking the unique index (should be empty):
-- select org_id, lower(email), count(*) from public.org_invites
-- group by 1,2 having count(*) > 1;
--
-- -- (d) Structural invariant — every org still has at least one owner/admin:
-- select o.id, o.name from public.organizations o
-- where not exists (select 1 from public.org_members m
--                   where m.org_id=o.id and m.role in ('owner','admin'));


-- ============================================================================
-- ROLLBACK
-- ============================================================================
-- grant update on public.org_invites to authenticated;
-- drop index if exists public.org_invites_org_email_uidx;
-- drop policy if exists org_members_insert on public.org_members;
-- create policy org_members_insert on public.org_members for insert to authenticated
--   with check (
--     (user_id = auth.uid() and role = 'owner'
--        and not public.org_has_members(org_id)
--        and exists (select 1 from public.organizations o
--                    where o.id = org_id and o.created_by = auth.uid()))
--     or (user_id = auth.uid() and role = public.invited_role(org_id))
--     or public.is_org_admin(org_id)
--   );
