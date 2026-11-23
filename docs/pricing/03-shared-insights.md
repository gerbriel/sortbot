# Shared insights: other shops' prices and eras, as aggregates only

22 Nov 2026. Migration `supabase/migrations/071_shared_insights.sql`, client
`src/lib/insightsService.ts`. Follows [`00-plan.md`](./00-plan.md),
[`01-research-stage.md`](./01-research-stage.md) and [`02-embeddings.md`](./02-embeddings.md).

## Why

The Step 3 research card prices and dates a piece from the shop's OWN comps, which RLS
keeps inside one workspace. A new shop has no sold history, so its card says "Not enough
comparables" for months. The pooled history of every shop is worth more than any one
shop's, as long as nothing about any one listing or any one shop leaves its workspace.

## What crosses the workspace line

**Aggregates only.** For prices: a median, a 25th and 75th percentile, a count of
listings and a count of contributing workspaces, per `(brand, category)`,
`(category, era)` and `(category)`, separately for SOLD prices (`listing_sales`) and
ASKING prices (`products.price`). For dating: a count of listings and of workspaces per
`(brand, era)`, from human-set eras only (`products.era`, never the engine's own
`listing_identifications`, which would feed its guesses back to itself).

## What never crosses

Photos, titles, descriptions, SKUs, customers, marketplaces, the price of any single
listing, listing or product ids, workspace ids and names, who contributed, and the CLIP
vectors. "Similar past listings" (`match_listing_images`, 065) stays same-workspace only.
The 071 functions also EXCLUDE the caller's own workspaces, so the aggregate is always
"other shops"; the shop's own comps keep coming through RLS (`fetchOwnComps`).

## Thresholds (k-anonymity)

A row is returned only when at least **5 listings** (`K_ANON_ROWS`) from at least
**2 different workspaces** (`K_ANON_ORGS`) stand behind it. A bucket with 4 listings, or
50 listings from one shop, is withheld entirely, not rounded. The server is the
authority; `normalizeMarketStat` / `normalizeEraSignal` refuse an under-threshold row
anyway, so a misconfigured threshold cannot leak a number, and the engines filter again.

## Opt-out

`organizations.share_insights boolean not null default true`. An owner or admin turns it
off on Workspace, Settings, "Shared insights" (`setShareInsights`, through the existing
`organizations` update policy; 0 rows updated reads as 'forbidden'). An opted-out
workspace neither CONTRIBUTES (its rows are filtered out at the source) nor RECEIVES
(a caller with no sharing workspace gets zero rows, never an error). The card hides
until 071 has run (the org row has no `share_insights` key).

## The ladder

`computePrice` (`src/lib/pricing.ts`), in order:

1. A price said out loud: `spoken`.
2. At least 3 of the shop's own sold comps: `own_sold_median`.
3. A usable market SOLD aggregate: `market_sold_median` ("Other shops' sales").
4. At least 3 own asking comps: `asking_adjusted`, discounted 15%, and said so.
5. A usable market ASKING aggregate: `market_asking_adjusted`, discounted the same.
6. Otherwise `insufficient`, and no number is named.

Within the market, the most specific level wins: `brand_category`, then `category_era`,
then `category`. Market confidence is capped (0.55 sold, 0.34 asking) below a shop's
own comps. The aggregate is recorded as ONE `PriceComp` with `source: 'market'`
(its median as `price_cents`, the support label as `note`), so `listing_prices.comps`
keeps the evidence with no new column. A market-only price at or above the high-value
line is flagged for review.

For dating, `identifyListing` takes `eraSignals`. When one decade has at least 60% of a
brand's signals (`ERA_SIGNAL_PROPOSE_SHARE`), it is proposed as a candidate with the
evidence "Other shops date this brand to the 1990s (N of M listings, K shops)";
otherwise the signals can only support an era something else proposed.

## The client

- `insightsAvailable()` probes once per session with the empty-parameter call (zero rows).
- `ResearchCard` reads `fetchMarketPriceStats({ brand, category, era })` and
  `fetchBrandEraSignals(brand)` beside `fetchOwnComps`, cached per key per session,
  re-read on Refresh comps, failing quiet to an empty list. The capture effect waits for
  both reads so a run is logged once. The price block shows "From other shops: 14 sold
  across 4 shops" (`marketSupportLabel`) when a market tier was used.
- `FounderConsole`, Usage tab: an "Insights" StatGrid from `fetchFoundingInsightsSummary()`
  (sharing workspaces of total, sold, asking, dated listings, brands).

## The migration and its functions

Every function is the section 18 #45 shape: an `app_private` SECURITY DEFINER body
(`search_path = public, pg_temp`) behind a `public` SECURITY INVOKER wrapper with the
identical signature; EXECUTE revoked from PUBLIC and anon, granted to authenticated and
service_role on both halves.

| RPC | Who | Returns |
|---|---|---|
| `market_price_stats(p_brand, p_category, p_era)` | any member of a sharing workspace | `kind, level, n, orgs, median_cents, low_cents, high_cents, newest_at` |
| `brand_era_signals(p_brand)` | same | `era, n, orgs`, most supported first |
| `founding_insights_summary()` | founding admins (42501 otherwise) | `{ sharing_orgs, total_orgs, sold_listings, asking_listings, dated_listings, brands }` |

Plus the internal helper `app_private.insights_era_decade(text)` ('90s' to '1990s').

## How to verify in SQL

```sql
-- The column, and who shares.
select share_insights, count(*) from public.organizations group by 1;

-- The six functions, and that anon cannot run them.
select p.oid::regprocedure::text,
       has_function_privilege('anon', p.oid, 'execute')          as anon,
       has_function_privilege('authenticated', p.oid, 'execute') as authed
from pg_proc p
where p.proname in ('market_price_stats', 'brand_era_signals',
                    'founding_insights_summary', 'insights_era_decade');
select has_schema_privilege('anon', 'app_private', 'usage');   -- false

-- The era normaliser.
select x, app_private.insights_era_decade(x)
from unnest(array['1990s', '90s', '00s', 'vintage', '1994']) x;
```

From the app, signed in: `supabase.rpc('market_price_stats', { p_brand: '', p_category: '', p_era: '' })`
returns `[]` (the probe); a real brand and category returns only rows with `n >= 5` and
`orgs >= 2`; `founding_insights_summary` answers 42501 outside the founders.

## Notes

- `listing_prices.method` had a CHECK from 064 that listed only `spoken`,
  `own_sold_median`, `asking_adjusted` and `insufficient`. 071 widens it to the two
  market methods (section 1a of the file), so a market-priced run's row saves. Until
  071 has run, the engine still shows the price and the row insert fails quiet.
- 072_plan_column_lockdown.sql (a side finding of this build, not required by it)
  narrows the client UPDATE grant on organizations to `name`, `description_settings`
  and `share_insights`, so a workspace admin can no longer set their own `plan`.
