# Pricing and identification — the plan (Sept 20 2026)

## Why do it at all

Right now the slow, judgment-heavy part of Arcadian is research: dating a piece,
deciding what it is worth, and writing the listing. That is the part that limits how
many items go up in a day. Bidstitch showed the approach works, but it is a general
tool using generic comps. This shop has two things it does not: its own sales
history, and its own photo pipeline. Building this into Arcadian means the price
research happens inside the flow already in use, and it gets more accurate the more
the shop sells, rather than staying flat.

## What to build

A pricing and identification stage that sits between grouping and export. For each
listing it fills in price, era with the evidence behind it, condition and flaws,
rarity, title, description, tags, and metafields. Then it splits the batch into
"ready to export" and "needs a look", so attention goes to the pieces where being
wrong actually costs money. **It never publishes on its own.**

## Where the information comes from, cheapest first

1. The shop's own sold history, via image embeddings (free).
2. eBay active listings for what competitors are asking (free, 5,000 calls a day).
3. An LLM-backed web search for sold comps on the pieces that warrant it (about a
   cent a search plus tokens).

Code computes the final price from the comps rather than letting a model name a
number, so every price is explainable.

## When searches happen

After the voice-over, not at upload. The spoken notes make searches precise, and
often make them unnecessary. Search once per design rather than per item, cache
results for a month or two, and skip entirely for basics or anything already priced
out loud.

## Build order, and why

1. **Data capture first.** Log every suggestion, every correction, the sold price,
   and days to sell. Costs almost nothing now and is the only part that cannot be
   recreated later.
2. **Structured identification with evidence and a confidence score.** Useful
   immediately for titles and descriptions, before pricing works.
3. **Embeddings and pgvector over past listings.** Free; powers grouping, duplicate
   detection and the first comps.
4. **Comps and price calculation**, gated by the rules above.
5. **Review queue** based on confidence and value.
6. **Sales feedback loop** through a Shopify webhook.
7. **The shop's own price model**, much later, once there are thousands of sold
   items to train on, and only for categories where it beats the current approach
   on a held-out test set.

Each step is useful on its own, so the shop is never far from something working.
The free parts come before the paid parts. And the data collection that makes step
7 possible starts at step 1, which is the mistake that is expensive to fix later.

## What to watch out for

- Do not build on scraped marketplace data: it breaks and violates their terms.
- Keep asking prices and sold prices separate, always.
- If outside users ever upload here, sort out the terms around using their uploads
  for training before collecting anything for that purpose. Until then, everything
  captured is per workspace and used only for that workspace's own comps.

## What is buildable today, with no API keys

| Step | Now | Later (needs) |
|---|---|---|
| 1 Data capture | `pricing_events`, `listing_sales` (manual entry), the hooks in Step 3 and export | Shopify webhook (app secret) |
| 2 Identification | rule-based, from the voice notes, the brand knowledge base, the vocab tables, the descriptor chips; evidence list + confidence | a vision/LLM pass (keys) |
| 3 Embeddings | CLIP image embeddings on the self-hosted matting service (ONNX, no key), pgvector, nearest-neighbour RPC | — |
| 4 Comps + price | the price engine (pure, explainable) over the shop's OWN comps (embeddings + brand/category) | eBay Browse API (key), web search (key), the comps cache |
| 5 Review queue | confidence × value rule, Step 3 card, Step 4 split, readiness warnings | — |
| 6 Feedback loop | "Mark as sold" in Products | the webhook |
| 7 Own model | schema captures what it will need | thousands of sold items |

## Contracts between the two passes that build steps 1–5

**Migrations.** `supabase/migrations/pricing_research.sql` (steps 1, 2, 4, 5, 6-manual)
and `supabase/migrations/listing_embeddings.sql` (step 3). Both org-scoped through the
existing helpers, both additive, idempotent, rollback at the bottom, both verified on a
throwaway Postgres. Either may run first; the embeddings RPC reads `listing_sales`
only through `to_regclass`.

**`listing_sales`** (owned by the research migration; read by the embeddings RPC):
`id uuid`, `org_id uuid default default_org_id()`, `product_group_id uuid`,
`sku text`, `listed_price_cents bigint`, `sold_price_cents bigint not null`,
`listed_at timestamptz`, `sold_at timestamptz not null default now()`,
`marketplace text`, `source text check in ('manual','shopify_webhook')`,
`external_order_id text`, `created_by uuid`, `created_at`.
`days_to_sell` is computed at read time from `listed_at`/`sold_at`.

**`listing_embeddings`** (owned by the embeddings migration): `product_image_id uuid
primary key references product_images on delete cascade`, `product_id uuid`,
`product_group_id uuid`, `org_id uuid`, `embedding vector(512)` (L2-normalised),
`model text` (`clip-vit-base-patch32@onnx`), `created_at`. RPC
`match_listing_images(p_product_image_id uuid, p_limit int default 12)` →
`(product_image_id, product_id, product_group_id, similarity real, title text,
price numeric, sold_price_cents bigint, sold_at timestamptz)` — same workspace only,
excludes the query's own listing, joins `listing_sales` when that table exists.

**Service endpoint** (matting service, same auth as jobs): `POST /v1/embed`
`{ productImageIds: string[] }` → 202 `{ jobId, accepted, skipped }`; embeddings are
written by the service with the service role; the app never computes one.

**Client seams.** `lib/researchService.ts` (research tables, `'unavailable'`
pre-migration), `lib/identification.ts` + `lib/pricing.ts` (pure, tested),
`lib/embeddingsService.ts` (`ensureEmbeddings`, `findSimilar`), and one component
`components/SimilarListings.tsx` that renders nothing pre-migration and is mounted
inside Step 3's research card.
