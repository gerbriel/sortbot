-- ============================================================================
-- move_ships_from_to_cd_vintage.sql   (one-off, 22 Nov 2026, NOT RUN)
-- The street address on the Founding Workspace's presets belongs to C&D
-- Vintage, not to the founding shop.
-- ============================================================================
-- WHY
--   017_populate_preset_defaults.sql (single-shop era) wrote one ship-from
--   address onto every preset. After 031 those presets became the Founding
--   Workspace's, and the owner has said the address is C&D Vintage's only.
--   The ship-from is per workspace (AGENTS.md section 7 "Workspace defaults",
--   section 18 #64): 074 already blanks it when a NEW workspace is seeded, so
--   this file only has to put the existing rows right.
--
-- WHAT IT DOES, in one transaction
--   1. Refuses unless the workspace with slug 'cd-vintage' exists. The split
--      (split_cd_vintage.sql) COPIES the founding presets, address included,
--      into that workspace; blanking the founding rows first would lose the
--      address before the copy. Run the split first, then this.
--   2. C&D Vintage: every active preset that ships and has no ship-from gets
--      the address. Presets that already carry one are left alone.
--   3. Founding Workspace: every preset whose ship-from IS that address is set
--      to NULL. A different address a founder typed later is left alone.
--   4. Prints the counts. Products are untouched: the split moves C&D's
--      inventory whole, and a founding demo listing that still shows the
--      address is a Step 3 field the founder can clear by hand.
--
-- RUN as postgres in the SQL Editor. SAFE TO RE-RUN: step 2 only fills blanks
-- and step 3 only clears the exact string, so a second run changes nothing.
-- ROLLBACK at the bottom.
-- ============================================================================

do $$
declare
  v_addr     constant text := '601 W. Lincoln Ave, Fresno CA 93706';
  v_cd       uuid;
  v_founding uuid;
  n_cd       int;
  n_founding int;
begin
  select id into v_cd       from public.organizations where slug = 'cd-vintage';
  select id into v_founding from public.organizations where slug = 'founding';

  if v_founding is null then
    raise exception 'No organization with slug = ''founding''. Run 031_multi_org_tenancy.sql first.';
  end if;
  if v_cd is null then
    raise exception 'No organization with slug = ''cd-vintage'' yet. Run supabase/oneoff/split_cd_vintage.sql first, then re-run this file.';
  end if;

  -- 2. C&D Vintage: fill the blanks on presets that ship.
  update public.category_presets
     set ships_from = v_addr,
         updated_at = now()
   where org_id = v_cd
     and coalesce(is_active, true)
     and coalesce(requires_shipping, true)
     and (ships_from is null or btrim(ships_from) = '');
  get diagnostics n_cd = row_count;

  -- 3. Founding Workspace: clear exactly that address, nothing else.
  update public.category_presets
     set ships_from = null,
         updated_at = now()
   where org_id = v_founding
     and btrim(coalesce(ships_from, '')) = v_addr;
  get diagnostics n_founding = row_count;

  raise notice 'C&D Vintage presets given the address: %', n_cd;
  raise notice 'Founding Workspace presets cleared of it: %', n_founding;
end $$;


-- ============================================================================
-- VERIFY (run separately)
-- ============================================================================
-- select o.slug, count(*) filter (where p.ships_from is not null) as with_address,
--        count(*) as presets
--   from public.category_presets p join public.organizations o on o.id = p.org_id
--  where o.slug in ('founding', 'cd-vintage')
--  group by o.slug;
-- -- expect: founding 0 with_address (unless a founder typed a different one),
-- --         cd-vintage with_address = its shipping presets


-- ============================================================================
-- ROLLBACK (puts the address back on the founding presets that ship, and
-- clears it from C&D Vintage; only if the owner changes their mind)
-- ============================================================================
-- update public.category_presets p set ships_from = '601 W. Lincoln Ave, Fresno CA 93706'
--   from public.organizations o where o.id = p.org_id and o.slug = 'founding'
--   and coalesce(p.requires_shipping, true) and p.ships_from is null;
-- update public.category_presets p set ships_from = null
--   from public.organizations o where o.id = p.org_id and o.slug = 'cd-vintage'
--   and btrim(coalesce(p.ships_from, '')) = '601 W. Lincoln Ave, Fresno CA 93706';
