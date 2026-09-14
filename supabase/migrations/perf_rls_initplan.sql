-- ============================================================================
-- PERF: RLS InitPlan — stop re-evaluating auth/helper functions once PER ROW
-- ============================================================================
-- Run in the Supabase SQL Editor (as `postgres`) AFTER security_function_hardening.sql
-- and security_rpc_wrappers.sql. Purely a policy rewrite: NO table, column,
-- function, trigger, grant or DATA change. Idempotent. Rollback at the bottom.
--
-- ── WHAT THIS FIXES ─────────────────────────────────────────────────────────
-- A policy expression is evaluated for every candidate row. When the expression
-- calls a function with NO reference to the row — `auth.uid()`,
-- `public.is_beta_admin()`, `public.auth_email_verified()`, `auth.jwt()` — the
-- planner still has to call it once per row, because a bare function call in a
-- qual is just a filter expression:
--
--     Seq Scan on analytics_events (actual rows=20100)
--       Filter: ((created_at > …) AND app_private.is_beta_admin())   ← 20 100 calls
--
-- Wrapping the SAME call in a scalar subquery — `(select public.is_beta_admin())`
-- — makes it an uncorrelated sub-select, which Postgres turns into an **InitPlan**:
-- executed ONCE per statement, before the scan, its result substituted as a
-- constant. Nothing about WHO CAN SEE WHAT changes; only how many times the
-- function runs.
--
--     Seq Scan on analytics_events (actual rows=20100)
--       Filter: ((InitPlan 1).col1 AND (created_at > …))
--       InitPlan 1
--         ->  Result (actual rows=1 loops=1)                        ← 1 call
--
-- Measured on the throwaway PG 14 harness, 20 100 rows, founder identity:
--   before  Execution Time: 94.545 ms   (Function Scan per row)
--   after   Execution Time:  3.512 ms   (InitPlan)                  ~27× on this query
--
-- Every helper here is SQL/plpgsql, STABLE and SECURITY DEFINER, and most of
-- them run their own `exists (select … from org_members …)`. On a t4g.nano
-- (2 shared vCPU, 0.5 GB) that per-row cost is the single biggest self-inflicted
-- CPU line the app has.
--
-- ── THE ONE HONEST CAVEAT: CORRELATED ARGUMENTS ─────────────────────────────
-- `is_org_admin(org_id)`, `invited_role(org_id)`, `org_has_members(org_id)` and
-- `storage_prefix_writable((storage.foldername(name))[1])` take the ROW as an
-- argument. Wrapping those produces a correlated **SubPlan**, not an InitPlan —
-- still once per row. They are wrapped anyway because (a) it is semantically
-- identical, (b) it makes the whole policy set uniform so the next reader does
-- not have to re-derive which ones are safe, and (c) the Supabase linter's
-- `auth_rls_initplan` rule reads the text, not the plan. The REAL win for those
-- is the index work in section 9 (`org_members(user_id)` already exists and is
-- what `user_org_ids()` / `is_org_admin()` / `is_beta_admin()` all probe), plus
-- the fact that every one of those policies sits on a table with tens of rows,
-- not tens of thousands. Do not expect a plan change there; do not "fix" it by
-- inlining the function body into the policy — that duplicates a security
-- boundary in two places (CLAUDE.md §18).
--
-- ── `org_id in (select public.user_org_ids())` IS ALREADY OPTIMAL ───────────
-- Every org-scoped policy from multi_org_tenancy.sql / listing_labels.sql /
-- brand_aliases.sql / kanban_board.sql already spells the set-returning helper
-- as `in (select …)`, which is ALREADY an InitPlan (hashed SubPlan). Those
-- fragments are reproduced here VERBATIM and deliberately unchanged.
--
-- ── WHICH POLICIES ARE IN SCOPE ─────────────────────────────────────────────
-- `grep -c 'create policy' supabase/migrations/*.sql` → 111 statements. They are
-- not 111 live policies; the older files are superseded. The determination:
--
--   * SUPERSEDED — every policy in create_workflow_batches.sql, categories.sql,
--     category_presets.sql, collaborative_edit_policies.sql, shared_workspace_rls.sql,
--     convert_to_shared_collaborative{,_FIXED}.sql, fix_rls_categories_and_presets.sql,
--     fix_rls_policies_complete.sql, fix_rls_show_system_defaults.sql lands on one
--     of the five data tables, and `multi_org_tenancy.sql` section 6 DROPS every
--     policy on those five and replaces them with the org_* set. Recreating any of
--     them here would re-open the pre-tenancy sharing model. Excluded on purpose.
--   * ALREADY WRAPPED — export_library.sql (export_batches / export_batch_items)
--     and fix_linter_issues.sql (user_profiles, and its copies for the five data
--     tables) already spell `(SELECT auth.uid())`. Nothing to do.
--   * IN SCOPE — everything below: the live org/tenancy set, the founder-only
--     tables, support messaging, telemetry, vocab, labels, aliases, kanban,
--     shopify connections, and storage.objects.
--
-- Every section is guarded with `to_regclass` so this file is correct against
-- ANY subset of the migrations (e.g. app_errors.sql and kanban_board.sql are not
-- applied in production today).
--
-- ── RE-RUN ORDER (IMPORTANT) ────────────────────────────────────────────────
-- Any migration that recreates a policy also un-does this file for that policy.
-- Re-run THIS FILE LAST, after replaying any of:
--   multi_org_tenancy.sql · beta_signups.sql · crm.sql · finance.sql ·
--   support_messaging.sql · analytics_events.sql · app_errors.sql ·
--   security_invites_hardening.sql · security_verified_email.sql ·
--   security_storage_policies.sql · brand_aliases.sql · listing_labels.sql ·
--   kanban_board.sql · vocab_tables.sql · vocab_models.sql ·
--   org_shopify_connections.sql · founding_user_admin.sql
-- It is independent of security_function_hardening.sql / security_rpc_wrappers.sql
-- (those move FUNCTIONS, not policies) but should be run after them so the
-- policies bind `public.<helper>` — the SECURITY INVOKER wrapper — which is the
-- name every source migration uses and the one that file's rollback expects.
-- ============================================================================


-- ── 1. organizations / org_members / org_invites ────────────────────────────
-- Source: multi_org_tenancy.sql §3, security_invites_hardening.sql §2,
--         security_verified_email.sql §1.

do $$
begin
if to_regclass('public.organizations') is null then
  raise notice 'perf_rls_initplan: public.organizations absent — skipping section 1';
  return;
end if;

drop policy if exists org_rows_select on public.organizations;
create policy org_rows_select on public.organizations for select to authenticated
  using (id in (select public.user_org_ids()) or created_by = (select auth.uid()));

drop policy if exists org_rows_insert on public.organizations;
create policy org_rows_insert on public.organizations for insert to authenticated
  with check (coalesce(created_by, (select auth.uid())) = (select auth.uid()));

drop policy if exists org_rows_update on public.organizations;
create policy org_rows_update on public.organizations for update to authenticated
  using ((select public.is_org_admin(id))) with check ((select public.is_org_admin(id)));

drop policy if exists org_rows_delete on public.organizations;
create policy org_rows_delete on public.organizations for delete to authenticated
  using ((select public.is_org_admin(id)));

drop policy if exists org_members_select on public.org_members;
create policy org_members_select on public.org_members for select to authenticated
  using (org_id in (select public.user_org_ids()));

-- Clause (2) is the security_invites_hardening.sql form (role pinned to
-- admin/member, never owner). Do NOT restore the multi_org_tenancy version.
drop policy if exists org_members_insert on public.org_members;
create policy org_members_insert on public.org_members for insert to authenticated
  with check (
    (user_id = (select auth.uid()) and role = 'owner'
       and not (select public.org_has_members(org_id))
       and exists (select 1 from public.organizations o
                   where o.id = org_id and o.created_by = (select auth.uid())))
    or (user_id = (select auth.uid())
        and role = (select public.invited_role(org_id))
        and role in ('admin','member'))
    or (select public.is_org_admin(org_id))
  );

drop policy if exists org_members_update on public.org_members;
create policy org_members_update on public.org_members for update to authenticated
  using ((select public.is_org_admin(org_id))) with check ((select public.is_org_admin(org_id)));

drop policy if exists org_members_delete on public.org_members;
create policy org_members_delete on public.org_members for delete to authenticated
  using ((select public.is_org_admin(org_id)) or user_id = (select auth.uid()));

-- org_invites: the security_verified_email.sql form (verified-email gate).
drop policy if exists org_invites_select on public.org_invites;
create policy org_invites_select on public.org_invites for select to authenticated
  using (
    (select public.is_org_admin(org_id))
    or ((select public.auth_email_verified())
        and lower(email) = (select lower(coalesce(auth.jwt()->>'email',''))))
  );

drop policy if exists org_invites_insert on public.org_invites;
create policy org_invites_insert on public.org_invites for insert to authenticated
  with check ((select public.is_org_admin(org_id)));

drop policy if exists org_invites_update on public.org_invites;
create policy org_invites_update on public.org_invites for update to authenticated
  using (
    (select public.is_org_admin(org_id))
    or ((select public.auth_email_verified())
        and lower(email) = (select lower(coalesce(auth.jwt()->>'email',''))))
  )
  with check (
    (select public.is_org_admin(org_id))
    or ((select public.auth_email_verified())
        and lower(email) = (select lower(coalesce(auth.jwt()->>'email',''))))
  );

drop policy if exists org_invites_delete on public.org_invites;
create policy org_invites_delete on public.org_invites for delete to authenticated
  using ((select public.is_org_admin(org_id)));
end $$;


-- ── 2. The five data tables ─────────────────────────────────────────────────
-- Source: multi_org_tenancy.sql §6. These are ALREADY InitPlan-shaped
-- (`in (select …)`), so they are reproduced verbatim and NOT rewritten — listed
-- here only so a future reader can see they were audited, not overlooked.
-- (No statements. Intentionally.)


-- ── 3. beta_signups ─────────────────────────────────────────────────────────
-- Source: beta_signups.sql §RLS + security_verified_email.sql §2.
-- `beta_insert` (anon/authenticated, `status = 'pending'`) calls nothing and is
-- left alone.

do $$
begin
if to_regclass('public.beta_signups') is null then
  raise notice 'perf_rls_initplan: public.beta_signups absent — skipping section 3';
  return;
end if;

drop policy if exists beta_select on public.beta_signups;
create policy beta_select on public.beta_signups for select
  to authenticated
  using (
    (select public.is_beta_admin())
    or ((select public.auth_email_verified())
        and lower(email) = (select lower(coalesce(auth.jwt()->>'email',''))))
  );

drop policy if exists beta_update on public.beta_signups;
create policy beta_update on public.beta_signups for update
  to authenticated
  using ((select public.is_beta_admin()))
  with check ((select public.is_beta_admin()));

drop policy if exists beta_delete on public.beta_signups;
create policy beta_delete on public.beta_signups for delete
  to authenticated
  using ((select public.is_beta_admin()));
end $$;


-- ── 4. founding_admin_audit ─────────────────────────────────────────────────
-- Source: founding_user_admin.sql §1.

do $$
begin
if to_regclass('public.founding_admin_audit') is null then
  raise notice 'perf_rls_initplan: public.founding_admin_audit absent — skipping section 4';
  return;
end if;

drop policy if exists founding_audit_select on public.founding_admin_audit;
create policy founding_audit_select on public.founding_admin_audit for select to authenticated
  using ((select public.is_beta_admin()));
end $$;


-- ── 5. Telemetry: analytics_events, app_errors ──────────────────────────────
-- Source: analytics_events.sql, app_errors.sql. The `*_insert_anon` policies
-- (role `anon`, `user_id is null and org_id is null`) call nothing — untouched.
-- These two SELECT policies are the hottest `is_beta_admin()` sites in the app:
-- the founder dashboard scans the whole table.

do $$
begin
if to_regclass('public.analytics_events') is not null then
  drop policy if exists analytics_insert_auth on public.analytics_events;
  create policy analytics_insert_auth on public.analytics_events for insert
    to authenticated with check (user_id is null or user_id = (select auth.uid()));

  drop policy if exists analytics_select on public.analytics_events;
  create policy analytics_select on public.analytics_events for select
    to authenticated using ((select public.is_beta_admin()));
else
  raise notice 'perf_rls_initplan: public.analytics_events absent — skipped';
end if;

if to_regclass('public.app_errors') is not null then
  drop policy if exists app_errors_insert_auth on public.app_errors;
  create policy app_errors_insert_auth on public.app_errors for insert
    to authenticated
    with check (user_id is null or user_id = (select auth.uid()));

  drop policy if exists app_errors_select on public.app_errors;
  create policy app_errors_select on public.app_errors for select
    to authenticated
    using ((select public.is_beta_admin()));
else
  raise notice 'perf_rls_initplan: public.app_errors absent — skipped';
end if;
end $$;


-- ── 6. CRM ──────────────────────────────────────────────────────────────────
-- Source: crm.sql §RLS + security_verified_email.sql §4 (crm_notes_insert).

do $$
begin
if to_regclass('public.crm_contacts') is null then
  raise notice 'perf_rls_initplan: crm tables absent — skipping section 6';
  return;
end if;

drop policy if exists crm_contacts_select on public.crm_contacts;
create policy crm_contacts_select on public.crm_contacts for select
  to authenticated using ((select public.is_beta_admin()));
drop policy if exists crm_contacts_insert on public.crm_contacts;
create policy crm_contacts_insert on public.crm_contacts for insert
  to authenticated with check ((select public.is_beta_admin()));
drop policy if exists crm_contacts_update on public.crm_contacts;
create policy crm_contacts_update on public.crm_contacts for update
  to authenticated using ((select public.is_beta_admin())) with check ((select public.is_beta_admin()));
drop policy if exists crm_contacts_delete on public.crm_contacts;
create policy crm_contacts_delete on public.crm_contacts for delete
  to authenticated using ((select public.is_beta_admin()));

drop policy if exists crm_notes_select on public.crm_notes;
create policy crm_notes_select on public.crm_notes for select
  to authenticated using ((select public.is_beta_admin()));

drop policy if exists crm_notes_insert on public.crm_notes;
create policy crm_notes_insert on public.crm_notes for insert
  to authenticated with check (
    (select public.is_beta_admin())
    and author_id = (select auth.uid())
    and (
      author_email is null
      or ((select public.auth_email_verified())
          and lower(author_email) = (select lower(auth.jwt() ->> 'email')))
    )
  );

drop policy if exists crm_notes_delete on public.crm_notes;
create policy crm_notes_delete on public.crm_notes for delete
  to authenticated using ((select public.is_beta_admin()));
end $$;


-- ── 7. Finance ──────────────────────────────────────────────────────────────
-- Source: finance.sql §RLS.

do $$
begin
if to_regclass('public.finance_transactions') is null then
  raise notice 'perf_rls_initplan: finance tables absent — skipping section 7';
  return;
end if;

drop policy if exists finance_tx_select on public.finance_transactions;
create policy finance_tx_select on public.finance_transactions for select
  to authenticated using ((select public.is_beta_admin()));
drop policy if exists finance_tx_insert on public.finance_transactions;
create policy finance_tx_insert on public.finance_transactions for insert
  to authenticated with check (
    (select public.is_beta_admin()) and (created_by is null or created_by = (select auth.uid()))
  );
drop policy if exists finance_tx_update on public.finance_transactions;
create policy finance_tx_update on public.finance_transactions for update
  to authenticated using ((select public.is_beta_admin())) with check ((select public.is_beta_admin()));
drop policy if exists finance_tx_delete on public.finance_transactions;
create policy finance_tx_delete on public.finance_transactions for delete
  to authenticated using ((select public.is_beta_admin()));

drop policy if exists finance_plan_prices_select on public.finance_plan_prices;
create policy finance_plan_prices_select on public.finance_plan_prices for select
  to authenticated using ((select public.is_beta_admin()));
drop policy if exists finance_plan_prices_insert on public.finance_plan_prices;
create policy finance_plan_prices_insert on public.finance_plan_prices for insert
  to authenticated with check ((select public.is_beta_admin()));
drop policy if exists finance_plan_prices_update on public.finance_plan_prices;
create policy finance_plan_prices_update on public.finance_plan_prices for update
  to authenticated using ((select public.is_beta_admin())) with check ((select public.is_beta_admin()));
drop policy if exists finance_plan_prices_delete on public.finance_plan_prices;
create policy finance_plan_prices_delete on public.finance_plan_prices for delete
  to authenticated using ((select public.is_beta_admin()));

drop policy if exists finance_settings_select on public.finance_settings;
create policy finance_settings_select on public.finance_settings for select
  to authenticated using ((select public.is_beta_admin()));
drop policy if exists finance_settings_insert on public.finance_settings;
create policy finance_settings_insert on public.finance_settings for insert
  to authenticated with check ((select public.is_beta_admin()));
drop policy if exists finance_settings_update on public.finance_settings;
create policy finance_settings_update on public.finance_settings for update
  to authenticated using ((select public.is_beta_admin())) with check ((select public.is_beta_admin()));
drop policy if exists finance_settings_delete on public.finance_settings;
create policy finance_settings_delete on public.finance_settings for delete
  to authenticated using ((select public.is_beta_admin()));
end $$;


-- ── 8. Support messaging ────────────────────────────────────────────────────
-- Source: support_messaging.sql §RLS + security_verified_email.sql §3
-- (support_threads_insert).
-- NOTE the shape of support_messages_select / _insert: `auth.uid()` there sits
-- inside an `exists (select 1 from support_threads t …)` sub-select, which is
-- ALREADY only evaluated once per outer row. Wrapping it changes it from one
-- call per sub-scan to one per statement — still worth it, because the inner
-- scan runs per candidate message row.

do $$
begin
if to_regclass('public.support_threads') is null then
  raise notice 'perf_rls_initplan: support tables absent — skipping section 8';
  return;
end if;

drop policy if exists support_threads_select on public.support_threads;
create policy support_threads_select on public.support_threads for select
  to authenticated using (user_id = (select auth.uid()) or (select public.is_beta_admin()));

drop policy if exists support_threads_insert on public.support_threads;
create policy support_threads_insert on public.support_threads for insert
  to authenticated with check (
    user_id = (select auth.uid())
    and (
      user_email is null
      or ((select public.auth_email_verified())
          and lower(user_email) = (select lower(auth.jwt() ->> 'email')))
    )
  );

drop policy if exists support_threads_update on public.support_threads;
create policy support_threads_update on public.support_threads for update
  to authenticated
  using (user_id = (select auth.uid()) or (select public.is_beta_admin()))
  with check (user_id = (select auth.uid()) or (select public.is_beta_admin()));

drop policy if exists support_messages_select on public.support_messages;
create policy support_messages_select on public.support_messages for select
  to authenticated using (
    exists (select 1 from public.support_threads t
            where t.id = thread_id
              and (t.user_id = (select auth.uid()) or (select public.is_beta_admin())))
  );

drop policy if exists support_messages_insert on public.support_messages;
create policy support_messages_insert on public.support_messages for insert
  to authenticated with check (
    sender_id = (select auth.uid())
    and (
      (sender_role = 'user' and exists (
         select 1 from public.support_threads t
         where t.id = thread_id and t.user_id = (select auth.uid())))
      or
      (sender_role = 'founder' and (select public.is_beta_admin()))
    )
  );
end $$;


-- ── 9. Vocabulary (global tables, founder-write) ────────────────────────────
-- Source: vocab_tables.sql, vocab_models.sql. The `*_select` policies are
-- `using (true)` — nothing to do.

do $$
begin
if to_regclass('public.descriptor_chips') is not null then
  drop policy if exists chips_insert on public.descriptor_chips;
  create policy chips_insert on public.descriptor_chips for insert
    to authenticated with check ((select public.is_beta_admin()));
  drop policy if exists chips_update on public.descriptor_chips;
  create policy chips_update on public.descriptor_chips for update
    to authenticated using ((select public.is_beta_admin())) with check ((select public.is_beta_admin()));
  drop policy if exists chips_delete on public.descriptor_chips;
  create policy chips_delete on public.descriptor_chips for delete
    to authenticated using ((select public.is_beta_admin()));
end if;

if to_regclass('public.brand_keywords') is not null then
  drop policy if exists brandkw_insert on public.brand_keywords;
  create policy brandkw_insert on public.brand_keywords for insert
    to authenticated with check ((select public.is_beta_admin()));
  drop policy if exists brandkw_update on public.brand_keywords;
  create policy brandkw_update on public.brand_keywords for update
    to authenticated using ((select public.is_beta_admin())) with check ((select public.is_beta_admin()));
  drop policy if exists brandkw_delete on public.brand_keywords;
  create policy brandkw_delete on public.brand_keywords for delete
    to authenticated using ((select public.is_beta_admin()));
end if;

if to_regclass('public.vocab_models') is not null then
  drop policy if exists models_insert on public.vocab_models;
  create policy models_insert on public.vocab_models for insert
    to authenticated with check ((select public.is_beta_admin()));
  drop policy if exists models_update on public.vocab_models;
  create policy models_update on public.vocab_models for update
    to authenticated using ((select public.is_beta_admin())) with check ((select public.is_beta_admin()));
  drop policy if exists models_delete on public.vocab_models;
  create policy models_delete on public.vocab_models for delete
    to authenticated using ((select public.is_beta_admin()));
end if;
end $$;


-- ── 10. brand_aliases ───────────────────────────────────────────────────────
-- Source: brand_aliases.sql. Only the INSERT check calls anything per row:
-- `auth.uid()` and `public.my_email()`. `my_email()` is SECURITY INVOKER and
-- not in the original brief's list, but it is the same class of call (STABLE,
-- reads only the JWT) sitting in the same expression, so leaving it bare would
-- leave a per-row function call inside a policy this file claims to have fixed.
-- The three org-scoped policies are already `in (select …)` — untouched.

do $$
begin
if to_regclass('public.brand_aliases') is null then
  raise notice 'perf_rls_initplan: public.brand_aliases absent — skipping section 10';
  return;
end if;

drop policy if exists brand_aliases_insert on public.brand_aliases;
create policy brand_aliases_insert on public.brand_aliases for insert
  to authenticated
  with check (
    org_id in (select public.user_org_ids())
    and (created_by is null or created_by = (select auth.uid()))
    and (created_by_email is null or lower(created_by_email) = (select public.my_email()))
  );
end $$;


-- ── 11. listing_labels / product_labels ─────────────────────────────────────
-- Source: listing_labels.sql. All org-scoped `in (select …)` — already optimal.
-- `labels_insert_product_labels` additionally EXISTS-joins products with the
-- same already-wrapped helper. Nothing to rewrite; audited, left alone.
-- (No statements. Intentionally.)


-- ── 12. org_shopify_connections ─────────────────────────────────────────────
-- Source: org_shopify_connections.sql.

do $$
begin
if to_regclass('public.org_shopify_connections') is null then
  raise notice 'perf_rls_initplan: public.org_shopify_connections absent — skipped';
  return;
end if;

drop policy if exists shopify_conn_insert on public.org_shopify_connections;
create policy shopify_conn_insert on public.org_shopify_connections for insert
  to authenticated
  with check ((select public.is_org_admin(org_id)));

drop policy if exists shopify_conn_delete on public.org_shopify_connections;
create policy shopify_conn_delete on public.org_shopify_connections for delete
  to authenticated
  using ((select public.is_org_admin(org_id)));
end $$;


-- ── 13. Kanban ──────────────────────────────────────────────────────────────
-- Source: kanban_board.sql §3 + security_verified_email.sql §5 (cards/comments
-- carry the verified-email gate; columns/tasks do not).

do $$
begin
if to_regclass('public.kanban_cards') is not null then
  drop policy if exists kanban_insert_kanban_cards on public.kanban_cards;
  create policy kanban_insert_kanban_cards on public.kanban_cards for insert
    to authenticated
    with check (
      org_id in (select public.user_org_ids())
      and (created_by is null or created_by = (select auth.uid()))
      and (created_by_email is null
           or ((select public.auth_email_verified())
               and lower(created_by_email) = (select public.my_email())))
    );
end if;

if to_regclass('public.kanban_comments') is not null then
  drop policy if exists kanban_insert_kanban_comments on public.kanban_comments;
  create policy kanban_insert_kanban_comments on public.kanban_comments for insert
    to authenticated
    with check (
      org_id in (select public.user_org_ids())
      and (author_id is null or author_id = (select auth.uid()))
      and (author_email is null
           or ((select public.auth_email_verified())
               and lower(author_email) = (select public.my_email())))
    );
end if;

if to_regclass('public.kanban_tasks') is not null then
  drop policy if exists kanban_insert_kanban_tasks on public.kanban_tasks;
  create policy kanban_insert_kanban_tasks on public.kanban_tasks for insert
    to authenticated
    with check (
      org_id in (select public.user_org_ids())
      and (created_by is null or created_by = (select auth.uid()))
    );
end if;
end $$;


-- ── 14. storage.objects ─────────────────────────────────────────────────────
-- Source: security_storage_policies.sql §2–3.
-- `storage_prefix_writable((storage.foldername(name))[1])` is correlated, so
-- this becomes a SubPlan and NOT an InitPlan — see the caveat in the header.
-- Rewritten anyway for uniformity and for the linter. `bucket_id = 'product-images'`
-- stays FIRST in every expression: it is the cheap constant test, and keeping it
-- leftmost is what stops the function from running at all on objects in other
-- buckets.
-- Requires ownership of storage.objects (the Supabase SQL Editor has it).

do $$
begin
if to_regclass('storage.objects') is null then
  raise notice 'perf_rls_initplan: storage.objects absent — skipping section 14';
  return;
end if;

drop policy if exists product_images_insert_scoped on storage.objects;
create policy product_images_insert_scoped on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'product-images'
    and (select public.storage_prefix_writable((storage.foldername(name))[1]))
  );

drop policy if exists product_images_update_scoped on storage.objects;
create policy product_images_update_scoped on storage.objects for update
  to authenticated
  using (
    bucket_id = 'product-images'
    and (select public.storage_prefix_writable((storage.foldername(name))[1]))
  )
  with check (
    bucket_id = 'product-images'
    and (select public.storage_prefix_writable((storage.foldername(name))[1]))
  );

drop policy if exists product_images_delete_scoped on storage.objects;
create policy product_images_delete_scoped on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'product-images'
    and (select public.storage_prefix_writable((storage.foldername(name))[1]))
  );

drop policy if exists product_images_select_scoped on storage.objects;
create policy product_images_select_scoped on storage.objects for select
  to authenticated
  using (
    bucket_id = 'product-images'
    and (select public.storage_prefix_writable((storage.foldername(name))[1]))
  );
end $$;


-- ── 15. Indexes the policies and the hot queries need ───────────────────────
-- `create index if not exists` only. Each one is justified; the ones that were
-- checked and found ALREADY PRESENT are listed in the comment block so nobody
-- re-derives them.
--
-- ALREADY PRESENT — deliberately not created:
--   org_members(user_id)                  → org_members_user_idx. This is THE
--     index behind user_org_ids(), is_org_admin(), is_beta_admin() and
--     storage_prefix_writable(); it already exists, which is why the correlated
--     helpers are survivable.
--   support_threads(user_id, last_message_at desc) → support_threads_user_idx.
--   brand_aliases(org_id, lower(heard))   → brand_aliases_org_heard_uidx is
--     (org_id, lower(btrim(heard))); `heard` carries a CHECK that it equals
--     canonical_heard(heard) (= lower+btrim), so the two expressions are equal
--     on every stored row. NOTE for later: brandAliasService.saveBrandAlias
--     looks the row up with `.ilike('heard', …)`, which cannot use EITHER index
--     — the table is org-scoped and tiny, so this is a note, not a fix.
--   product_labels(product_id)            → the primary key is
--     (product_id, label_id); product_id is its leading column, so a lookup by
--     product_id already uses it. A second index would only add write cost.
--   workflow_batches(org_id), products(org_id), product_images(org_id) →
--     created by multi_org_tenancy.sql §4.

-- (a) The two abuse-limit triggers count rows for one session inside a time
--     window: `where session_id = … and created_at > now() - interval …`.
--     Today only `(session_id)` exists, so every insert re-reads EVERY row that
--     session ever wrote and filters by time in the heap. These fire on EVERY
--     analytics event and EVERY client error — the highest-frequency writes in
--     the app. The composite turns the count into one index range scan.
create index if not exists analytics_events_session_created_idx
  on public.analytics_events (session_id, created_at desc);

-- (b) Same trigger shape on app_errors. Guarded: app_errors.sql is not applied
--     in production today.
do $$
begin
  if to_regclass('public.app_errors') is not null then
    execute 'create index if not exists app_errors_session_created_idx
               on public.app_errors (session_id, created_at desc)';
  end if;
end $$;

-- (c) products.batch_id has NO index. Four hot paths filter on it:
--     pruneStaleProducts (every 2 s group-upsert), handleOpenBatch's gap-fill,
--     registerItemsInDB, and deleteWorkflowBatch's paginated id read. On a
--     workspace with thousands of products each of those is a full seq scan.
create index if not exists products_batch_id_idx
  on public.products (batch_id);

-- (d) product_images.product_id has NO index, yet it is the FK target of the
--     delete-then-upsert in registerItemsInDB (chunked `in (…)` of up to 100
--     ids, run on every batch open) and of every products→images join in the
--     Library. It is also the parent side of the ON DELETE CASCADE, which
--     Postgres executes as a lookup per deleted product row.
create index if not exists product_images_product_id_idx
  on public.product_images (product_id);

-- (e) fetchWorkflowBatches selects the caller's org's batches ordered
--     updated_at DESC. `workflow_batches_org_idx` is (org_id) alone, so the
--     sort is a separate step over the whole org's batches — and the row width
--     here includes the workflow_state JSONB. The composite gives the ordering
--     for free.
create index if not exists workflow_batches_org_updated_idx
  on public.workflow_batches (org_id, updated_at desc);

-- (f) crm_sync_contacts() and the CRM panel group/filter contacts by workspace;
--     crm_contacts has indexes on lower(email), stage and next_follow_up, but
--     none on org_id.
do $$
begin
  if to_regclass('public.crm_contacts') is not null then
    execute 'create index if not exists crm_contacts_org_idx
               on public.crm_contacts (org_id)';
  end if;
end $$;


-- ── 16. VERIFY (run separately, after the file) ─────────────────────────────
-- 16a. No live policy should still call a helper as a BARE expression. Expect 0:
--   select schemaname, tablename, policyname
--   from pg_policies
--   where (
--       coalesce(qual,'') ~ '(?<!select )(auth\.uid|auth\.jwt|is_beta_admin|is_org_admin|auth_email_verified|invited_role|storage_prefix_writable|my_email)\('
--    or coalesce(with_check,'') ~ '(?<!select )(auth\.uid|auth\.jwt|is_beta_admin|is_org_admin|auth_email_verified|invited_role|storage_prefix_writable|my_email)\('
--   )
--   and schemaname in ('public','storage')
--   order by 1,2,3;
--
-- 16b. The plan actually changed (run as a founding admin, via the app or with
--      request.jwt.claim.sub set):
--   explain (analyze, costs off)
--   select count(*) from public.analytics_events where created_at > now() - interval '30 days';
--   -- expect "InitPlan 1" + "(InitPlan 1).col1" in the Filter, NOT a bare
--   -- "app_private.is_beta_admin()".
--
-- 16c. Access is unchanged. Sign in as a non-founder and confirm:
--   select count(*) from public.crm_contacts;         -- 0 rows, no error
--   select count(*) from public.analytics_events;     -- 0
--   select count(*) from public.workflow_batches;     -- their own workspace only


-- ============================================================================
-- ROLLBACK — restores the ORIGINAL policy texts exactly as the source
-- migrations wrote them (multi_org_tenancy + security_invites_hardening +
-- security_verified_email + beta_signups + founding_user_admin +
-- analytics_events + app_errors + crm + finance + support_messaging +
-- vocab_tables + vocab_models + brand_aliases + org_shopify_connections +
-- kanban_board + security_storage_policies), and drops the six indexes.
-- Uncomment the whole block and run it.
-- ============================================================================
--
-- do $$
-- begin
-- if to_regclass('public.organizations') is not null then
--   drop policy if exists org_rows_select on public.organizations;
--   create policy org_rows_select on public.organizations for select to authenticated
--     using (id in (select public.user_org_ids()) or created_by = auth.uid());
--   drop policy if exists org_rows_insert on public.organizations;
--   create policy org_rows_insert on public.organizations for insert to authenticated
--     with check (coalesce(created_by, auth.uid()) = auth.uid());
--   drop policy if exists org_rows_update on public.organizations;
--   create policy org_rows_update on public.organizations for update to authenticated
--     using (public.is_org_admin(id)) with check (public.is_org_admin(id));
--   drop policy if exists org_rows_delete on public.organizations;
--   create policy org_rows_delete on public.organizations for delete to authenticated
--     using (public.is_org_admin(id));
--   drop policy if exists org_members_select on public.org_members;
--   create policy org_members_select on public.org_members for select to authenticated
--     using (org_id in (select public.user_org_ids()));
--   drop policy if exists org_members_insert on public.org_members;
--   create policy org_members_insert on public.org_members for insert to authenticated
--     with check (
--       (user_id = auth.uid() and role = 'owner'
--          and not public.org_has_members(org_id)
--          and exists (select 1 from public.organizations o
--                      where o.id = org_id and o.created_by = auth.uid()))
--       or (user_id = auth.uid()
--           and role = public.invited_role(org_id)
--           and role in ('admin','member'))
--       or public.is_org_admin(org_id)
--     );
--   drop policy if exists org_members_update on public.org_members;
--   create policy org_members_update on public.org_members for update to authenticated
--     using (public.is_org_admin(org_id)) with check (public.is_org_admin(org_id));
--   drop policy if exists org_members_delete on public.org_members;
--   create policy org_members_delete on public.org_members for delete to authenticated
--     using (public.is_org_admin(org_id) or user_id = auth.uid());
--   drop policy if exists org_invites_select on public.org_invites;
--   create policy org_invites_select on public.org_invites for select to authenticated
--     using (
--       public.is_org_admin(org_id)
--       or (public.auth_email_verified()
--           and lower(email) = lower(coalesce(auth.jwt()->>'email','')))
--     );
--   drop policy if exists org_invites_insert on public.org_invites;
--   create policy org_invites_insert on public.org_invites for insert to authenticated
--     with check (public.is_org_admin(org_id));
--   drop policy if exists org_invites_update on public.org_invites;
--   create policy org_invites_update on public.org_invites for update to authenticated
--     using (
--       public.is_org_admin(org_id)
--       or (public.auth_email_verified()
--           and lower(email) = lower(coalesce(auth.jwt()->>'email','')))
--     )
--     with check (
--       public.is_org_admin(org_id)
--       or (public.auth_email_verified()
--           and lower(email) = lower(coalesce(auth.jwt()->>'email','')))
--     );
--   drop policy if exists org_invites_delete on public.org_invites;
--   create policy org_invites_delete on public.org_invites for delete to authenticated
--     using (public.is_org_admin(org_id));
-- end if;
--
-- if to_regclass('public.beta_signups') is not null then
--   drop policy if exists beta_select on public.beta_signups;
--   create policy beta_select on public.beta_signups for select to authenticated
--     using (
--       public.is_beta_admin()
--       or (public.auth_email_verified()
--           and lower(email) = lower(coalesce(auth.jwt()->>'email','')))
--     );
--   drop policy if exists beta_update on public.beta_signups;
--   create policy beta_update on public.beta_signups for update to authenticated
--     using (public.is_beta_admin()) with check (public.is_beta_admin());
--   drop policy if exists beta_delete on public.beta_signups;
--   create policy beta_delete on public.beta_signups for delete to authenticated
--     using (public.is_beta_admin());
-- end if;
--
-- if to_regclass('public.founding_admin_audit') is not null then
--   drop policy if exists founding_audit_select on public.founding_admin_audit;
--   create policy founding_audit_select on public.founding_admin_audit for select to authenticated
--     using (public.is_beta_admin());
-- end if;
--
-- if to_regclass('public.analytics_events') is not null then
--   drop policy if exists analytics_insert_auth on public.analytics_events;
--   create policy analytics_insert_auth on public.analytics_events for insert
--     to authenticated with check (user_id is null or user_id = auth.uid());
--   drop policy if exists analytics_select on public.analytics_events;
--   create policy analytics_select on public.analytics_events for select
--     to authenticated using (public.is_beta_admin());
-- end if;
--
-- if to_regclass('public.app_errors') is not null then
--   drop policy if exists app_errors_insert_auth on public.app_errors;
--   create policy app_errors_insert_auth on public.app_errors for insert
--     to authenticated with check (user_id is null or user_id = auth.uid());
--   drop policy if exists app_errors_select on public.app_errors;
--   create policy app_errors_select on public.app_errors for select
--     to authenticated using (public.is_beta_admin());
-- end if;
--
-- if to_regclass('public.crm_contacts') is not null then
--   drop policy if exists crm_contacts_select on public.crm_contacts;
--   create policy crm_contacts_select on public.crm_contacts for select
--     to authenticated using (public.is_beta_admin());
--   drop policy if exists crm_contacts_insert on public.crm_contacts;
--   create policy crm_contacts_insert on public.crm_contacts for insert
--     to authenticated with check (public.is_beta_admin());
--   drop policy if exists crm_contacts_update on public.crm_contacts;
--   create policy crm_contacts_update on public.crm_contacts for update
--     to authenticated using (public.is_beta_admin()) with check (public.is_beta_admin());
--   drop policy if exists crm_contacts_delete on public.crm_contacts;
--   create policy crm_contacts_delete on public.crm_contacts for delete
--     to authenticated using (public.is_beta_admin());
--   drop policy if exists crm_notes_select on public.crm_notes;
--   create policy crm_notes_select on public.crm_notes for select
--     to authenticated using (public.is_beta_admin());
--   drop policy if exists crm_notes_insert on public.crm_notes;
--   create policy crm_notes_insert on public.crm_notes for insert
--     to authenticated with check (
--       public.is_beta_admin()
--       and author_id = auth.uid()
--       and (
--         author_email is null
--         or (public.auth_email_verified()
--             and lower(author_email) = lower(auth.jwt() ->> 'email'))
--       )
--     );
--   drop policy if exists crm_notes_delete on public.crm_notes;
--   create policy crm_notes_delete on public.crm_notes for delete
--     to authenticated using (public.is_beta_admin());
-- end if;
--
-- if to_regclass('public.finance_transactions') is not null then
--   drop policy if exists finance_tx_select on public.finance_transactions;
--   create policy finance_tx_select on public.finance_transactions for select
--     to authenticated using (public.is_beta_admin());
--   drop policy if exists finance_tx_insert on public.finance_transactions;
--   create policy finance_tx_insert on public.finance_transactions for insert
--     to authenticated with check (
--       public.is_beta_admin() and (created_by is null or created_by = auth.uid())
--     );
--   drop policy if exists finance_tx_update on public.finance_transactions;
--   create policy finance_tx_update on public.finance_transactions for update
--     to authenticated using (public.is_beta_admin()) with check (public.is_beta_admin());
--   drop policy if exists finance_tx_delete on public.finance_transactions;
--   create policy finance_tx_delete on public.finance_transactions for delete
--     to authenticated using (public.is_beta_admin());
--   drop policy if exists finance_plan_prices_select on public.finance_plan_prices;
--   create policy finance_plan_prices_select on public.finance_plan_prices for select
--     to authenticated using (public.is_beta_admin());
--   drop policy if exists finance_plan_prices_insert on public.finance_plan_prices;
--   create policy finance_plan_prices_insert on public.finance_plan_prices for insert
--     to authenticated with check (public.is_beta_admin());
--   drop policy if exists finance_plan_prices_update on public.finance_plan_prices;
--   create policy finance_plan_prices_update on public.finance_plan_prices for update
--     to authenticated using (public.is_beta_admin()) with check (public.is_beta_admin());
--   drop policy if exists finance_plan_prices_delete on public.finance_plan_prices;
--   create policy finance_plan_prices_delete on public.finance_plan_prices for delete
--     to authenticated using (public.is_beta_admin());
--   drop policy if exists finance_settings_select on public.finance_settings;
--   create policy finance_settings_select on public.finance_settings for select
--     to authenticated using (public.is_beta_admin());
--   drop policy if exists finance_settings_insert on public.finance_settings;
--   create policy finance_settings_insert on public.finance_settings for insert
--     to authenticated with check (public.is_beta_admin());
--   drop policy if exists finance_settings_update on public.finance_settings;
--   create policy finance_settings_update on public.finance_settings for update
--     to authenticated using (public.is_beta_admin()) with check (public.is_beta_admin());
--   drop policy if exists finance_settings_delete on public.finance_settings;
--   create policy finance_settings_delete on public.finance_settings for delete
--     to authenticated using (public.is_beta_admin());
-- end if;
--
-- if to_regclass('public.support_threads') is not null then
--   drop policy if exists support_threads_select on public.support_threads;
--   create policy support_threads_select on public.support_threads for select
--     to authenticated using (user_id = auth.uid() or public.is_beta_admin());
--   drop policy if exists support_threads_insert on public.support_threads;
--   create policy support_threads_insert on public.support_threads for insert
--     to authenticated with check (
--       user_id = auth.uid()
--       and (
--         user_email is null
--         or (public.auth_email_verified()
--             and lower(user_email) = lower(auth.jwt() ->> 'email'))
--       )
--     );
--   drop policy if exists support_threads_update on public.support_threads;
--   create policy support_threads_update on public.support_threads for update
--     to authenticated
--     using (user_id = auth.uid() or public.is_beta_admin())
--     with check (user_id = auth.uid() or public.is_beta_admin());
--   drop policy if exists support_messages_select on public.support_messages;
--   create policy support_messages_select on public.support_messages for select
--     to authenticated using (
--       exists (select 1 from public.support_threads t
--               where t.id = thread_id and (t.user_id = auth.uid() or public.is_beta_admin()))
--     );
--   drop policy if exists support_messages_insert on public.support_messages;
--   create policy support_messages_insert on public.support_messages for insert
--     to authenticated with check (
--       sender_id = auth.uid()
--       and (
--         (sender_role = 'user' and exists (
--            select 1 from public.support_threads t where t.id = thread_id and t.user_id = auth.uid()))
--         or
--         (sender_role = 'founder' and public.is_beta_admin())
--       )
--     );
-- end if;
--
-- if to_regclass('public.descriptor_chips') is not null then
--   drop policy if exists chips_insert on public.descriptor_chips;
--   create policy chips_insert on public.descriptor_chips for insert
--     to authenticated with check (public.is_beta_admin());
--   drop policy if exists chips_update on public.descriptor_chips;
--   create policy chips_update on public.descriptor_chips for update
--     to authenticated using (public.is_beta_admin()) with check (public.is_beta_admin());
--   drop policy if exists chips_delete on public.descriptor_chips;
--   create policy chips_delete on public.descriptor_chips for delete
--     to authenticated using (public.is_beta_admin());
-- end if;
--
-- if to_regclass('public.brand_keywords') is not null then
--   drop policy if exists brandkw_insert on public.brand_keywords;
--   create policy brandkw_insert on public.brand_keywords for insert
--     to authenticated with check (public.is_beta_admin());
--   drop policy if exists brandkw_update on public.brand_keywords;
--   create policy brandkw_update on public.brand_keywords for update
--     to authenticated using (public.is_beta_admin()) with check (public.is_beta_admin());
--   drop policy if exists brandkw_delete on public.brand_keywords;
--   create policy brandkw_delete on public.brand_keywords for delete
--     to authenticated using (public.is_beta_admin());
-- end if;
--
-- if to_regclass('public.vocab_models') is not null then
--   drop policy if exists models_insert on public.vocab_models;
--   create policy models_insert on public.vocab_models for insert
--     to authenticated with check (public.is_beta_admin());
--   drop policy if exists models_update on public.vocab_models;
--   create policy models_update on public.vocab_models for update
--     to authenticated using (public.is_beta_admin()) with check (public.is_beta_admin());
--   drop policy if exists models_delete on public.vocab_models;
--   create policy models_delete on public.vocab_models for delete
--     to authenticated using (public.is_beta_admin());
-- end if;
--
-- if to_regclass('public.brand_aliases') is not null then
--   drop policy if exists brand_aliases_insert on public.brand_aliases;
--   create policy brand_aliases_insert on public.brand_aliases for insert
--     to authenticated
--     with check (
--       org_id in (select public.user_org_ids())
--       and (created_by is null or created_by = auth.uid())
--       and (created_by_email is null or lower(created_by_email) = public.my_email())
--     );
-- end if;
--
-- if to_regclass('public.org_shopify_connections') is not null then
--   drop policy if exists shopify_conn_insert on public.org_shopify_connections;
--   create policy shopify_conn_insert on public.org_shopify_connections for insert
--     to authenticated with check (public.is_org_admin(org_id));
--   drop policy if exists shopify_conn_delete on public.org_shopify_connections;
--   create policy shopify_conn_delete on public.org_shopify_connections for delete
--     to authenticated using (public.is_org_admin(org_id));
-- end if;
--
-- if to_regclass('public.kanban_cards') is not null then
--   drop policy if exists kanban_insert_kanban_cards on public.kanban_cards;
--   create policy kanban_insert_kanban_cards on public.kanban_cards for insert
--     to authenticated with check (
--       org_id in (select public.user_org_ids())
--       and (created_by is null or created_by = auth.uid())
--       and (created_by_email is null
--            or (public.auth_email_verified()
--                and lower(created_by_email) = public.my_email()))
--     );
-- end if;
-- if to_regclass('public.kanban_comments') is not null then
--   drop policy if exists kanban_insert_kanban_comments on public.kanban_comments;
--   create policy kanban_insert_kanban_comments on public.kanban_comments for insert
--     to authenticated with check (
--       org_id in (select public.user_org_ids())
--       and (author_id is null or author_id = auth.uid())
--       and (author_email is null
--            or (public.auth_email_verified()
--                and lower(author_email) = public.my_email()))
--     );
-- end if;
-- if to_regclass('public.kanban_tasks') is not null then
--   drop policy if exists kanban_insert_kanban_tasks on public.kanban_tasks;
--   create policy kanban_insert_kanban_tasks on public.kanban_tasks for insert
--     to authenticated with check (
--       org_id in (select public.user_org_ids())
--       and (created_by is null or created_by = auth.uid())
--     );
-- end if;
--
-- if to_regclass('storage.objects') is not null then
--   drop policy if exists product_images_insert_scoped on storage.objects;
--   create policy product_images_insert_scoped on storage.objects for insert
--     to authenticated
--     with check (
--       bucket_id = 'product-images'
--       and public.storage_prefix_writable((storage.foldername(name))[1])
--     );
--   drop policy if exists product_images_update_scoped on storage.objects;
--   create policy product_images_update_scoped on storage.objects for update
--     to authenticated
--     using (
--       bucket_id = 'product-images'
--       and public.storage_prefix_writable((storage.foldername(name))[1])
--     )
--     with check (
--       bucket_id = 'product-images'
--       and public.storage_prefix_writable((storage.foldername(name))[1])
--     );
--   drop policy if exists product_images_delete_scoped on storage.objects;
--   create policy product_images_delete_scoped on storage.objects for delete
--     to authenticated
--     using (
--       bucket_id = 'product-images'
--       and public.storage_prefix_writable((storage.foldername(name))[1])
--     );
--   drop policy if exists product_images_select_scoped on storage.objects;
--   create policy product_images_select_scoped on storage.objects for select
--     to authenticated
--     using (
--       bucket_id = 'product-images'
--       and public.storage_prefix_writable((storage.foldername(name))[1])
--     );
-- end if;
-- end $$;
--
-- drop index if exists public.analytics_events_session_created_idx;
-- drop index if exists public.app_errors_session_created_idx;
-- drop index if exists public.products_batch_id_idx;
-- drop index if exists public.product_images_product_id_idx;
-- drop index if exists public.workflow_batches_org_updated_idx;
-- drop index if exists public.crm_contacts_org_idx;
