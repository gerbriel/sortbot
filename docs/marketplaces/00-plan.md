# Multi-marketplace publishing — the plan

Target: eBay, Etsy, Poshmark, Mercari, Grailed, Depop, Facebook (Marketplace / Shops),
Shopify, Vinted, Whatnot. Every one accepts a product differently, so the app is being
built around **one canonical listing and one adapter per marketplace**, with **three
delivery channels** because the marketplaces themselves fall into three groups.

## 1. The shape

```
canonical listing (ClothingItem + its photo group, already ~60 fields)
        │
        ▼
marketplace adapter  ── spec (limits + vocab, as DATA)
                     ── validate(listing) → readiness issues
                     ── format(listing)   → title / body / tags / category / attributes / photos / price
                     ── serialize(...)    → CSV / feed row, when the marketplace takes files
        │
        ▼
delivery channel     ── A. file feed      (Shopify CSV today; Facebook catalog, Whatnot, Depop bulk)
                     ── B. official API   (eBay, Etsy, Shopify write) — Edge Function + per-workspace OAuth
                     ── C. listing pack   (Poshmark, Mercari, Grailed, Vinted: formatted text + ordered photos, copy per field)
        │
        ▼
listing_publications (product group × marketplace: draft / exported / posted / live / sold, external id, url)
```

**What already exists and is reused, not rebuilt**
- `src/lib/csvExport.ts` — the Shopify adapter in all but name: pure, golden-tested, 54 columns,
  taxonomy maps, title cleaning, formula-injection guard. It becomes `marketplaces/shopify.ts`
  with the golden snapshot unchanged.
- `src/lib/platformPricing.ts` — per-marketplace price rules with fee presets for Shopify, eBay,
  Depop, Poshmark, Mercari, Etsy, Grailed, Vinted. `format()` calls it; the `$0` and non-positive
  invariants (AGENTS.md §18 #42) stay.
- `org_shopify_connections` — the per-workspace, client-write-only credential pattern every API
  connector copies (token readable only by the Edge Function's service role; §18 #17).
- `descriptionSettings` — per-workspace voice; adapters take the same generated description and
  re-flow it to each marketplace's format (plain text, line breaks, hashtag block or none).
- Listing labels / SKUs — the SKU is the cross-marketplace key; `listing_publications` joins on it.

## 2. Per-marketplace constraints are data, not code

Each adapter's `spec` holds the numbers below. **Every value here must be confirmed against the
marketplace's current seller documentation before that adapter ships** — they change, and several
are from memory. Because they are data, a correction is a one-line edit with a test.

| Marketplace | Title | Description | Photos | Tags / hashtags | Category | Condition vocab | Channel |
|---|---|---|---|---|---|---|---|
| Shopify | 255 | HTML | many | free tags | Shopify taxonomy path (have) | free text | A (have) · B (write later) |
| eBay | 80 | HTML ok | 24 | none (item specifics instead) | eBay category id + item specifics | New / Pre-owned + condition descriptors | B (Sell API) · C |
| Etsy | 140 | plain text | 10 | 13 tags × 20 chars | Etsy taxonomy id | new / vintage (20+ yrs) / handmade | B (Open API v3) · C |
| Poshmark | 80 | 1,500 plain | 16 | none | Poshmark category + size | NWT / NWOT / pre-owned | C |
| Mercari | 40 | 1,000 plain | 12 | 3 hashtags | Mercari category | 5-step condition | C |
| Grailed | 60 | plain | 25 | none | designer + category + size | 5-step (New / Gently used / Used / Very worn) | C |
| Depop | 60 | 1,000 plain | 8 | 5 hashtags | Depop category + size | New / Like new / Used excellent / good / fair | A (bulk CSV, verified sellers) · C |
| Facebook Marketplace / Shops | 150 | 5,000 plain | 20 | none | Google product category | new / used (4 grades) | A (catalog feed) · B (Commerce API, later) |
| Vinted | 60 | plain | 20 | none | Vinted catalog + size | New with tags / New without tags / Very good / Good / Satisfactory | C |
| Whatnot | 80 | plain | 12 | none | Whatnot category | free text | A (bulk CSV) · C |

Shared vocab the canonical model needs, mapped once per adapter:
- **condition** — one canonical scale (`new_with_tags`, `new_without_tags`, `excellent`, `good`,
  `fair`, `poor`) with a per-marketplace mapping table; the voice grammar already captures
  condition words, the mapping is new.
- **size** — the nine size families from `normalizeSizeValue` plus a size-system flag (US/UK/EU)
  and department (men / women / kids — presets carry gender already).
- **category** — canonical category (the workspace's own) → each marketplace's taxonomy, the way
  `SHOPIFY_CATEGORY_MAP` does it today; unmapped = a readiness issue, never a silent blank.

## 3. Delivery channels

**A. File feed** — the seller downloads and uploads. Shopify exists. Facebook Commerce Manager
takes a catalog CSV/XML; Whatnot and Depop (verified sellers) take bulk-listing CSVs. Each is a
`serialize()` with a golden test, exported from Step 4 exactly like the Shopify file, with the
marketplace in the filename (the pricing pass already established that rule).

**B. Official API** — only three of the ten have a real listing API: eBay (Sell Inventory + Offer
APIs), Etsy (Open API v3), Shopify (Admin `productSet`). Each is an Edge Function that holds the
workspace's OAuth token (a `org_<marketplace>_connections` table on the Shopify pattern), publishes
one listing, and writes back `external_id` + `url` to `listing_publications`. The client never
holds a token. Each needs a developer account with that marketplace (eBay developer program,
Etsy app approval, Shopify custom app) — those are the founder's accounts, requested once.

**C. Listing pack** — for the marketplaces with no import at all (Poshmark, Mercari, Grailed,
Vinted, and Depop/Whatnot when not using CSV). Step 4 shows, per listing and per marketplace, the
title, body, tags and attributes already cut to that marketplace's limits, each with a copy button,
and the photos in order (count-limited, already compressed) as a zip. The seller pastes into the
marketplace's own app; the app records "posted" so the cross-listing matrix stays true. This is not
a compromise — it is how every cross-lister works for these four, because they forbid automation.

## 4. Cross-listing state — `listing_publications`

`(product_group_id, marketplace) → status, external_id, url, price_cents, posted_at, sold_at`,
org-scoped RLS on the existing membership helper, written by Step 4's actions and by the API
connectors. It gives Step 4 a matrix (listings × marketplaces), a "sold on X → mark the rest"
action later, and the founder's analytics a per-marketplace export count.

## 5. Phases

1. **Framework + packs (no external dependency).** Adapter interface and spec table; Shopify
   moved onto it (golden unchanged); canonical condition + size-system fields with voice and form
   support; `validate()` readiness checklist in Step 4; listing packs for every marketplace; the
   `listing_publications` table and the matrix. This alone covers all ten at the copy/export level.
2. **Feeds.** Facebook catalog, Whatnot and Depop CSVs, each golden-tested.
3. **Connectors.** eBay, then Etsy, then Shopify write — one Edge Function + connection table each,
   OAuth in the Workspace dashboard, publish button in the matrix.
4. **Sync back.** Sold / delisted status from the API marketplaces; "mark sold everywhere" for the
   pack marketplaces.

## 6. Decisions needed from the founder

1. **External marketplace APIs.** The standing rule is "100% self-reliant, no external APIs" for
   founder tooling. Publishing to eBay / Etsy / Shopify cannot be done without their APIs. Phase 1
   and 2 need nothing external; phase 3 does — say yes to it explicitly, or stop at packs + feeds.
2. **Order.** Suggested by vintage-resale volume: eBay, Depop, Poshmark first, then Etsy, Mercari,
   Grailed, Vinted, Facebook, Whatnot. Shopify is already served.
3. **Photo hosting.** Feeds and APIs pull photos by URL from the app's public storage bucket
   (Shopify CSV already does). If the bucket ever goes private, the connectors need signed URLs —
   `storageUrls.ts` is the one seam (§18 #20).
