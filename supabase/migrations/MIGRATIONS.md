# Migration ledger

Migrations are numbered `NNN_name.sql` (same convention as 559flawless) and are tracked by the
Supabase CLI. The number is the CLI "version", so `supabase migration list` shows local vs remote
and `supabase db push` applies only versions the remote history does not have yet.

Renamed on 2026-11-22 from unnumbered files. Order follows the git add date and each file's own
"Run AFTER" header. Contents were not changed; `git log --follow` works on every file.

Before 2026-11-22 every file was run by hand in the SQL Editor and the remote history table was
empty. On that date the history was repaired to list 001-065 (except 046) as applied, after
probing the live database. Evidence column: **object** = a table, column or index the file creates
exists; **function** = a function it creates answers over PostgREST; **inferred** = a later,
verified migration lists it as a prerequisite; **lineage** = policy-only or data-only fix from the
single-workspace era, superseded by 031 and never to be re-run.

| #   | file | formerly | remote | evidence |
|-----|------|----------|--------|----------|
| 001 | add_batch_id | add_batch_id.sql | applied | object |
| 002 | categories | categories.sql | applied | object |
| 003 | category_presets | category_presets.sql | applied | object |
| 004 | fix_linter_issues | fix_linter_issues.sql | applied | lineage |
| 005 | export_library | export_library.sql | applied | object |
| 006 | extend_category_presets | extend_category_presets.sql | applied | object |
| 007 | create_workflow_batches | create_workflow_batches.sql | applied | object |
| 008 | create_default_presets | create_default_presets.sql | applied | lineage |
| 009 | fix_rls_categories_and_presets | fix_rls_categories_and_presets.sql | applied | lineage |
| 010 | fix_rls_show_system_defaults | fix_rls_show_system_defaults.sql | applied | lineage |
| 011 | fix_rls_policies_complete | fix_rls_policies_complete.sql | applied | lineage |
| 012 | fix_product_images_duplicates | fix_product_images_duplicates.sql | applied | object |
| 013 | convert_to_shared_collaborative | convert_to_shared_collaborative.sql | applied | lineage (superseded by 014) |
| 014 | convert_to_shared_collaborative_FIXED | convert_to_shared_collaborative_FIXED.sql | applied | function |
| 015 | add_all_clothing_fields | add_all_clothing_fields.sql | applied | object |
| 016 | sync_category_presets_with_products | sync_category_presets_with_products.sql | applied | object |
| 017 | populate_preset_defaults | populate_preset_defaults.sql | applied | lineage |
| 018 | fix_missing_product_columns | fix_missing_product_columns.sql | applied | empty file (0 bytes) |
| 019 | cleanup_orphan_batches | cleanup_orphan_batches.sql | applied | lineage |
| 020 | fix_product_images_unique_index | fix_product_images_unique_index.sql | applied | object |
| 021 | add_product_group_column | add_product_group_column.sql | applied | object |
| 022 | backfill_product_images_user_id | backfill_product_images_user_id.sql | applied | lineage |
| 023 | drop_duplicate_product_images_constraint | drop_duplicate_product_images_constraint.sql | applied | lineage |
| 024 | allow_null_storage_path | allow_null_storage_path.sql | applied | lineage |
| 025 | shared_workspace_rls | shared_workspace_rls.sql | applied | lineage (AGENTS.md: run) |
| 026 | add_original_name_to_product_images | add_original_name_to_product_images.sql | applied | object |
| 027 | seed_gender_category_presets | seed_gender_category_presets.sql | applied | lineage |
| 028 | clean_categories | clean_categories.sql | applied | lineage |
| 029 | add_transforms_to_product_images | 20260426_add_transforms_to_product_images.sql | applied | object |
| 030 | collaborative_edit_policies | collaborative_edit_policies.sql | applied | lineage |
| 031 | multi_org_tenancy | multi_org_tenancy.sql | applied | object |
| 032 | beta_signups | beta_signups.sql | applied | object |
| 033 | stage4_slim_fields | stage4_slim_fields.sql | applied | object |
| 034 | beta_admin_directory | beta_admin_directory.sql | applied | function |
| 035 | org_shopify_connections | org_shopify_connections.sql | applied | object |
| 036 | vocab_tables | vocab_tables.sql | applied | object |
| 037 | org_description_settings | org_description_settings.sql | applied | object |
| 038 | vocab_models | vocab_models.sql | applied | object |
| 039 | founding_user_admin | founding_user_admin.sql | applied | object |
| 040 | kanban_board | kanban_board.sql | applied | object |
| 041 | fix_invalid_preset_taxonomy_paths | fix_invalid_preset_taxonomy_paths.sql | applied | lineage (data fix) |
| 042 | seed_kanban_feature_atlas | seed_kanban_feature_atlas.sql | applied | lineage (seed) |
| 043 | analytics_events | analytics_events.sql | applied | object |
| 044 | crm | crm.sql | applied | object |
| 045 | support_messaging | support_messaging.sql | applied | object |
| 046 | app_errors | app_errors.sql | applied | object (pushed via `supabase db push` on 2026-11-22; 054-056 then replayed via repair --status reverted + db push --include-all, which moved app_errors_summary into app_private) |
| 047 | security_invites_hardening | security_invites_hardening.sql | applied | object (org_invites_org_email_uidx) |
| 048 | security_verified_email | security_verified_email.sql | applied | function (auth_email_verified) |
| 049 | security_storage_policies | security_storage_policies.sql | applied | function (storage_prefix_writable) |
| 050 | security_abuse_limits | security_abuse_limits.sql | applied | inferred (prerequisite of 058) |
| 051 | finance | finance.sql | applied | object |
| 052 | brand_aliases | brand_aliases.sql | applied | object |
| 053 | listing_labels | listing_labels.sql | applied | object (products_org_sku_uidx was NOT created: duplicate SKUs, see file) |
| 054 | security_function_hardening | security_function_hardening.sql | applied | function (helpers deny anon; app_private exists) |
| 055 | security_rpc_wrappers | security_rpc_wrappers.sql | applied | inferred (prerequisite of 057) |
| 056 | perf_rls_initplan | perf_rls_initplan.sql | applied | object (workflow_batches_org_updated_idx) |
| 057 | perf_storage_usage | perf_storage_usage.sql | applied | function (storage_usage_bytes) |
| 058 | team_messaging | team_messaging.sql | applied | object |
| 059 | marketplaces | marketplaces.sql | applied | object |
| 060 | founder_console | founder_console.sql | applied | object (org_plan_history via 062) |
| 061 | tenant_scoped_uniqueness | tenant_scoped_uniqueness.sql | applied | object (categories_org_name_uidx) |
| 062 | plan_management | plan_management.sql | applied | object |
| 063 | image_backgrounds | image_backgrounds.sql | applied | object (product_images.mask_status) |
| 064 | pricing_research | pricing_research.sql | applied | object |
| 065 | listing_embeddings | listing_embeddings.sql | applied | object (listing_embeddings_vec_hnsw) |
| 066 | account_deletion | (new: 066_account_deletion.sql) | applied | pushed via `supabase db push` on 2026-11-22 (verified on a throwaway PG 14 first; the `delete-account` edge function was deployed the same day with `supabase functions deploy delete-account --use-api`). Pre-deploy checks run in the SQL Editor on 2026-11-22, all clear: the only no-action FKs to auth.users are the six tables the function handles (user_profiles, organizations.created_by, org_invites.invited_by, beta_signups.reviewed_by, org_shopify_connections.created_by, founding_admin_audit.actor_id); rolbypassrls is true; no exec_sql function exists. Pre-deploy check: `select conrelid::regclass, conname, confdeltype from pg_constraint where confrelid = 'auth.users'::regclass;` and read every a/r row; `select rolbypassrls from pg_roles where rolname = current_user;` (as the migration role, must be true); `select oid::regprocedure from pg_proc where proname = 'exec_sql';` (must be absent or service_role-only). Also re-creates `support_thread_before_update` (050) with the `app.account_deletion` IF. Run before deploying the delete-account function |
| 067 | fix_signup_trigger | (new: 067_fix_signup_trigger.sql) | applied | sign-up has returned "Database error saving new user" since fix_security_warnings.sql (June 2026) made handle_new_user SECURITY INVOKER; this restores SECURITY DEFINER, makes the profile insert non-blocking and backfills. Run in the SQL Editor on 2026-11-22 and recorded with `migration repair --status applied 067`; an anonymous sign-up and an admin createUser both succeed again, and the trigger writes the profile row |
| 068 | user_profiles_cascade | (new: 068_user_profiles_cascade.sql) | **pending** | user_profiles.id -> auth.users had no ON DELETE action, so once 067 made profile rows exist again, auth.admin.deleteUser and the dashboard Delete user fail on the FK (in-app deletion is unaffected: 066 deletes the profile first). Re-creates the FK ON DELETE CASCADE. Apply with `supabase db push` or paste in the SQL Editor then `migration repair --status applied 068` |

## Working with the history

- `supabase migration list` shows local files against the remote history.
- New migration: next number, `NNN_short_name.sql`, then `supabase db push` (or run it in the SQL
  Editor and `supabase migration repair --status applied NNN`). Either way, add a row above.
- Every file through 065 is applied on the linked project (046 was pushed on 2026-11-22). To replay an
  idempotent file through the CLI: `supabase migration repair --status reverted NNN`, then `supabase db push --include-all`.
- Never re-run 004-030 (single-workspace era). 031 replaced their policies.
- Marking a version: `supabase migration repair --status applied NNN`; undo with `--status reverted`.
