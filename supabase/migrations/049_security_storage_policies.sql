-- ============================================================================
-- SECURITY: STORAGE OBJECT POLICIES for the `product-images` bucket
-- ============================================================================
-- Run AFTER multi_org_tenancy.sql (uses user_org_ids()). Additive, idempotent,
-- rollback at the bottom. Nothing here changes who can READ an image.
--
-- ⚠️ THIS MIGRATION IS INERT UNTIL YOU DROP THE PRE-EXISTING PERMISSIVE POLICY.
--    Postgres RLS policies are OR'ed together. Uploads work today, and this
--    repo contains no storage.objects policy, so one was created in the
--    Supabase dashboard and its name is unknown here. If that policy is the
--    usual `bucket_id = 'product-images'` for role `authenticated`, adding the
--    scoped policies below changes NOTHING — the permissive one still allows
--    everything. Run the inventory query in section 0, then uncomment the
--    matching drop in section 4.
--
-- THE HOLE (security audit 05, finding #4 — High, write/delete half):
--   Object paths are `{userId}/{productId}/{file}`. With a bucket-wide
--   `authenticated` write policy, ANY signed-in user of ANY workspace can
--   overwrite or delete ANY other tenant's photos by path — RLS scopes the
--   product_images ROWS, never the bytes.
--
-- SCOPE CHOSEN: THE CALLER'S ORG, NOT THE CALLER ALONE.
--   A strict `(storage.foldername(name))[1] = auth.uid()::text` check is what
--   the audit drafted, but it would break three shipped, intentional flows,
--   because a shared workspace's objects sit under whichever MEMBER uploaded
--   them:
--     * Step 3 crop re-upload writes `<dir>/cropped-<ts>.jpg` where <dir> is
--       taken from the EXISTING item's storagePath — a teammate's uid prefix
--       (ImageGrouper.tsx `commitCrop`, and ProductDescriptionGenerator's
--       paste-crop which upserts to the SAME path).
--     * "Compress N Images" / "Compress All Batches" re-upload with
--       upsert:true over every path in the workspace (ImageUpload.tsx).
--     * "Delete a teammate's batch" removes their storage files
--       (workflowBatchService.ts, libraryService.ts, Library.tsx) — a shipped
--       feature of the collaboration model.
--   So write access is granted for any path prefixed by the uid of a user who
--   shares an organization with the caller. That is exactly the app's existing
--   trust boundary (any member can already delete any batch in the workspace)
--   and it closes the CROSS-TENANT hole, which is the actual finding.
--
-- READS STAY PUBLIC — DELIBERATELY, FOR NOW.
--   The bucket is public and every read goes through
--   /storage/v1/object/public/product-images/… which bypasses RLS entirely.
--   Two hard dependencies keep it that way: the exported Shopify CSV's
--   `Image Src` column must be fetchable by Shopify's importer, and Step 2
--   renders hundreds of images per batch. Flipping to a private bucket +
--   signed URLs is a separate project (audit 05 §4.2: one getImageUrl()
--   indirection, batch signing with a TTL cache, a Service-Worker cache key
--   that strips the token, and an export story). Treat every existing image URL
--   as already public.
--
-- NOTE ON PATH SHAPE: `(storage.foldername(name))[1]` is compared as TEXT
--   against `user_id::text`. Never cast the path segment to uuid — a legacy or
--   hand-made object whose first segment is not a uuid would raise inside the
--   policy and break the whole bucket.
-- ============================================================================


-- ── 0. INVENTORY — run this FIRST and read the output ───────────────────────
--   select policyname, cmd, roles, qual, with_check
--   from pg_policies where schemaname = 'storage' and tablename = 'objects';
--   select id, public from storage.buckets where id = 'product-images';
-- Anything with `cmd` in (INSERT, UPDATE, DELETE, ALL) for role `authenticated`
-- whose expression is only `bucket_id = 'product-images'` is the hole. Note its
-- exact policyname — you need it in section 4.


-- ── 1. Who may write under a given uid prefix? ──────────────────────────────
-- The caller, plus anyone who shares an organization with the caller.
-- SECURITY DEFINER: org_members' own RLS would otherwise recurse/filter here.
create or replace function public.storage_prefix_writable(p_prefix text)
returns boolean
language sql security definer stable
set search_path = public
as $$
  select p_prefix is not null
     and (
       p_prefix = auth.uid()::text
       or exists (
         select 1 from public.org_members m
         where m.user_id::text = p_prefix
           and m.org_id in (select public.user_org_ids())
       )
     )
$$;

grant execute on function public.storage_prefix_writable(text) to authenticated;


-- ── 2. Scoped write policies on the bucket ──────────────────────────────────
-- INSERT covers fresh uploads (including the TUS resumable endpoint) and the
-- first write of an upsert; UPDATE covers the overwrite half of upsert:true.
drop policy if exists product_images_insert_scoped on storage.objects;
create policy product_images_insert_scoped on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'product-images'
    and public.storage_prefix_writable((storage.foldername(name))[1])
  );

drop policy if exists product_images_update_scoped on storage.objects;
create policy product_images_update_scoped on storage.objects for update
  to authenticated
  using (
    bucket_id = 'product-images'
    and public.storage_prefix_writable((storage.foldername(name))[1])
  )
  with check (
    bucket_id = 'product-images'
    and public.storage_prefix_writable((storage.foldername(name))[1])
  );

drop policy if exists product_images_delete_scoped on storage.objects;
create policy product_images_delete_scoped on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'product-images'
    and public.storage_prefix_writable((storage.foldername(name))[1])
  );


-- ── 3. SELECT for signed-in listing ─────────────────────────────────────────
-- Public reads do not need a policy (the /object/public/ route skips RLS), but
-- storage.list() from the browser does — "Compress All Batches" walks the
-- bucket with supabase.storage.list(userId). Grant that at the same org scope.
-- This is ADDITIVE: if a broader SELECT policy already exists, listing keeps
-- working exactly as it does today, and reads are public regardless.
drop policy if exists product_images_select_scoped on storage.objects;
create policy product_images_select_scoped on storage.objects for select
  to authenticated
  using (
    bucket_id = 'product-images'
    and public.storage_prefix_writable((storage.foldername(name))[1])
  );


-- ── 4. Remove the permissive dashboard policy (THE ACTUAL FIX) ─────────────
-- Fill in the name(s) from section 0 and uncomment. Do this ONLY after the
-- policies above exist, and exercise all four flows immediately afterwards:
--   upload a folder · crop a photo in Step 3 · "Compress N Images" ·
--   delete a TEAMMATE's batch from the Library.
--
-- drop policy if exists "<exact name from section 0>" on storage.objects;
--
-- Common Supabase dashboard defaults, safe to attempt if they exist:
-- drop policy if exists "Allow authenticated uploads"  on storage.objects;
-- drop policy if exists "Allow authenticated updates"  on storage.objects;
-- drop policy if exists "Allow authenticated deletes"  on storage.objects;
-- drop policy if exists "Enable insert for authenticated users only" on storage.objects;
-- drop policy if exists "Enable update for authenticated users only" on storage.objects;
-- drop policy if exists "Enable delete for authenticated users only" on storage.objects;


-- ============================================================================
-- VERIFY (run separately)
-- ============================================================================
-- -- (a) Only the scoped policies should remain for writes:
-- select policyname, cmd, qual, with_check from pg_policies
-- where schemaname='storage' and tablename='objects' order by cmd, policyname;
--
-- -- (b) As a signed-in user: true for your own prefix and a teammate's,
-- --     false for a stranger's:
-- select public.storage_prefix_writable(auth.uid()::text);            -- true
-- select public.storage_prefix_writable('00000000-0000-0000-0000-000000000000'); -- false
--
-- -- (c) Cross-tenant write attempt from the browser console of workspace A,
-- --     against a path from workspace B — must fail with a 403 / RLS error:
-- --     await supabase.storage.from('product-images')
-- --       .upload('<foreign-uid>/<pid>/x.jpg', new Blob(['x']), { upsert: true })
--
-- -- (d) Orphan prefixes nobody can write any more (a uid with no membership —
-- --     e.g. an account removed from every workspace). Files stay readable; a
-- --     founder can still clean them up with the service role:
-- select distinct (storage.foldername(name))[1] as prefix
-- from storage.objects o
-- where o.bucket_id = 'product-images'
--   and not exists (select 1 from public.org_members m
--                   where m.user_id::text = (storage.foldername(o.name))[1]);


-- ============================================================================
-- ROLLBACK — back to whatever the dashboard policy allowed.
-- ============================================================================
-- drop policy if exists product_images_select_scoped on storage.objects;
-- drop policy if exists product_images_delete_scoped on storage.objects;
-- drop policy if exists product_images_update_scoped on storage.objects;
-- drop policy if exists product_images_insert_scoped on storage.objects;
-- drop function if exists public.storage_prefix_writable(text);
-- -- then re-create the permissive policy you dropped in section 4, e.g.
-- -- create policy "Allow authenticated uploads" on storage.objects for insert
-- --   to authenticated with check (bucket_id = 'product-images');
