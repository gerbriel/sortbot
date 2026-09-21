# The research stage — data capture, identification, price, review queue

*Sept 20 2026. Steps 1, 2, 4 and 5 of `00-plan.md`. Step 3 (embeddings) is a
separate pass; the slot it mounts into is left empty in the Step 3 card.*

---

## 1. What was built, and what it costs

| Plan step | Built here | Migration |
|---|---|---|
| 1 Data capture | `pricing_events`, `listing_identifications`, `listing_prices`, `listing_sales`, `price_comps_cache` + `lib/researchService.ts` | `pricing_research.sql` |
| 2 Identification | `lib/identification.ts` — era, condition, flaws, rarity, each with evidence and a confidence | — |
| 4 Comps + price | `lib/pricing.ts` over the workspace's OWN sold history (`fetchOwnComps`) | — |
| 5 Review queue | `ResearchCard` in Step 3, the split in Step 4, a `warning` in every marketplace column | — |
| 6 (manual half) | **Mark as sold** in Products | — |

**`supabase/migrations/pricing_research.sql` is WRITTEN AND NOT RUN.** Until it
is, `researchAvailable()` is false, the Step 3 card renders nothing, the Step 4
split renders nothing, no marketplace column gains a warning and the Sold card
is absent. Steps 1–4 behave exactly as they do today.

**Bundle:** main JS 1,046.50 → 1,081.99 kB raw (315.31 → 326.67 kB gzip), +11.4
kB gzip for the whole feature. `vintagePatternEngine` (113 kB) became its own
lazy chunk on the way — see §3.

---

## 2. The five tables, and the decisions inside them

Ordinary org-scoped data, the `listing_labels.sql` / `brand_aliases.sql` shape:
`org_id default default_org_id()` so the client never sends it, membership RLS
on all four verbs, **no admin gate**. The person who corrects a price or marks a
piece sold is whoever is listing that day; a feedback loop only an admin can
close is a feedback loop that does not close.

**`product_group_id` is deliberately NOT a foreign key**, in all four tables
that carry it — the decision `listing_publications` already made. A listing's
leader `products` row can be deleted, re-created by a restore, or re-grouped
while the garment is still on a rack and still sold last Tuesday. A cascade
there would destroy the only row in this file that cannot be reconstructed.
`batch_id` IS a foreign key, `on delete set null`, for the same reason.

**UPDATE is granted per column, and on three tables not at all.**

| Table | Grants | Why |
|---|---|---|
| `pricing_events` | select, insert, delete | **Append-only.** "At 14:02 the app proposed $38 and the seller typed $55" is a fact about a moment. Editing it does not correct history, it destroys the signal step 7 needs. A correction is a new row — which is what `corrected` is for. |
| `listing_prices` | select, insert, delete | Each run is a row; re-running writes a new one and the newest wins. |
| `listing_identifications` | + `update (reviewed)` | "I have looked at this" is a fact about a person, not about the run, and must not require re-running the pass. |
| `listing_sales` | + `update (sku, prices, dates, marketplace, order id)` | A mistyped sold price is the likeliest error in the whole file and it poisons every future comp. `org_id`, `product_group_id`, `source` and `created_by` stay outside: a sale cannot move workspace or listing, and a webhook row cannot be relabelled as hand-entered. |
| `price_comps_cache` | + `update (comps, fetched_at, expires_at)` | The payload and its clock. The key columns stay out so a refresh cannot move a cached answer onto another workspace. |

Three more that are load-bearing:

- **`suggested_cents` may be NULL but never 0.** `insufficient` means we decline
  to name a number; 0 IS a number, and the export price gate reads $0 as
  "unpriced". A CHECK refuses it and `savePrice` maps 0 → NULL on the way in.
- **`listing_sales` uniqueness is `(org_id, product_group_id, coalesce(external_order_id, ''))`** —
  an EXPRESSION index, which PostgREST cannot address with `onConflict`, so
  `recordSale` inserts and translates 23505 into words. The `coalesce` is what
  makes two hand-entered sales of one listing collide (the second is a mistake,
  not a resale to capture; a genuine resale carries an order id).
- **`price_comps_cache` has no writer yet, on purpose.** The eBay Browse API and
  web search arrive with a key. The shape and the read path (`expires_at >
  now()`, applied in the QUERY) exist now so the first paid call needs no
  migration, and `expires_at` is NOT NULL because a cache row with no expiry is
  a permanent wrong answer.

### Verification — 33 scenarios on a throwaway Postgres 14

Applied in order: a stub `auth` schema + the five base tables →
`multi_org_tenancy.sql` → a two-workspace fixture → `pricing_research.sql`.
**Nothing was run against Supabase.**

| # | Scenario | Result |
|---|---|---|
| 1 | Apply on a tenancy database | clean, `exit=0` |
| 2–3 | Re-apply twice | clean; rows and grants unchanged |
| 4 | A member inserts into all five | `org_id` defaulted from `default_org_id()`, `created_by` from `auth.uid()` |
| 5 | Another workspace's owner reads all five | 0 rows each |
| 6 | Another workspace's owner inserts into workspace A | RLS refusal |
| 7 | Workspace A's owner reads | 1 row each |
| 8 | Second sale with the same order id | 23505 |
| 9 | Second sale with a DIFFERENT order id | accepted |
| 10 | Two hand-entered sales (both NULL order ids) | second refused — the `coalesce` collision, intended |
| 11–14 | `listing_sales.created_by` / `org_id` / `source` / `product_group_id` update | 42501 each |
| 15–16 | `pricing_events` / `listing_prices` update at all | 42501 each |
| 17–18 | `listing_identifications.confidence` / `created_by` | 42501 each |
| 19 | `price_comps_cache.query_key` | 42501 |
| 20 | `listing_identifications.reviewed = true` | accepted — the one human column |
| 21 | Sale price / marketplace corrected | accepted |
| 22 | Cache payload + expiry refreshed | accepted |
| 23 | `listing_prices.suggested_cents = 0` | 23514 |
| 24 | `low_cents > high_cents` | 23514 |
| 25 | unknown `method` / `field` / `source` | 23514 each |
| 26 | `confidence > 1`, `rarity > 1` | 23514 each |
| 27 | `sold_price_cents = 0`, sold before listed | 23514 each |
| 28 | `expires_at < fetched_at` | 23514 |
| 29 | non-array `era_evidence` | 23514 |
| 30 | NULL `org_id` insert | RLS refusal — the DEFAULT is effectively mandatory |
| 31 | Delete the batch | research kept, `batch_id` NULL |
| 32 | Delete the leader `products` row | the sale survives (no FK) |
| 33 | Rollback → re-apply | 5 tables gone, 20 policies back |

Plus the upgrade path: a stale table-wide `UPDATE` grant left from an earlier
run is revoked by the re-apply and the column grants survive intact.

---

## 3. Identification — rules, evidence, and the three bugs the pass found

`identifyListing(input)` is pure, deterministic and **dependency-free**. The
weights and rules are a table in the module header; the interesting part is the
shape:

**Candidates are PROPOSED by strong signals and SCORED by cues.** The typed
field, a spoken decade, a brand whose whole history is one decade and a model's
introduction year each propose an era; every construction cue is then scored FOR
or AGAINST each candidate. A cue can therefore never invent an era on its own —
"single stitch" says pre-1995, which is five decades, and picking one of them
would be a guess dressed as a finding.

**A rejected candidate still has something to say.** Without this, the single
most useful sentence the pass can produce — *"you said the eighties, but this
model did not exist until 1998"* — was computed and thrown away with the
candidate that lost. It is now carried onto the winner as one dissenting line,
weight and all. A winner the seller TYPED is not second-guessed.

**Flaws are collected separately from the grade, always.** "Faded" is a look a
buyer pays for; "pit stains" is a defect that must be disclosed. Folding them
into one letter loses the disclosure, which is the half that matters for returns.

### Three defects found while building, all fixed

1. **`year_introduced` was double-counting.** The same model fact both proposed
   its own decade (+0.35) and penalised the spoken one (−0.35), letting a 0.35
   model proposal beat a 0.60 spoken decade — one piece of evidence casting two
   votes. A documented introduction year is now a **hard constraint**: a decade
   that ends before the model existed is ruled OUT, and the spoken decade
   survives as dissent on the winner.

2. **Construction cues compared a YEAR against the decade's START**, so "single
   stitch, not after 1995" *contradicted* the 1990s, because 1990 is not < 1995.
   That is wrong about the most used dating cue in resale, and wrong in the
   direction that makes the app argue with a seller who is right. The test is
   now OVERLAP, and every cue boundary is asserted on both sides.

3. **`NWT · holes, stains`** — found in the first screenshot, with a +15%
   condition adjustment on top of it. A claim of new cannot survive a flaw that
   only comes from wear (holes, stains, pilling, fraying, thin spots, odour);
   the grade drops to Excellent and the line says why. A cracked print, a
   missing button or age yellowing do NOT override it — those happen to
   genuinely deadstock stock sitting for thirty years.

### Why it is dependency-free

A static `import BRAND_DNA from './vintagePatternEngine'` moved the main bundle
from **1,046 → 1,160 kB** (measured). That table's only other importer,
`builtinBrandVocab`, is reached by dynamic import precisely so it stays out of
the first paint (§14 #47). So the two facts the pass wants are an INPUT
(`brandFacts`), and `loadBrandFacts` fetches them behind the same dynamic
import, cached for the session. The table is now its own 78 kB chunk shared with
`builtinBrandVocab`, and the tests state the brand facts they are about instead
of depending on which brands a 1,400-line table happens to hold.

---

## 4. The price engine

`computePrice(input)` is pure. Order is the design:

1. **a price said out loud** → `spoken`, confidence 1, nothing else consulted
2. **≥ 3 sold comps** → `own_sold_median`
3. **≥ 3 asking comps** → `asking_adjusted`, discounted 15%, and it says so
4. **otherwise** → `insufficient`, and it names no number

**Asking and sold are never in one median.** Asserted structurally (the comps
the answer was built from are all one kind, over three mixed sets) and by
construction: three solds beat twenty askings and the twenty do not move the
number by a cent. When asking prices ARE used, the sold comps that were too few
to median are named in the explanation along with the reason they were not used.

**No number is invented.** A test extracts every `$1,234.56`-shaped figure from
the explanation and checks each one against the comps, the item, or arithmetic
over them. That is what stands between this and "let the model suggest a price".

**Never a non-positive price** — swept over six conditions × eight magnitudes ×
both comp kinds, asserting `suggestedCents === null || > 0` and `low ≤ suggested
≤ high`. `roundToCharm` is a deliberate replica of `platformPricing`'s `.99`
branch (that one takes dollars and a `PlatformPricingRule`, which a suggestion
is not) and a test asserts the two agree on $45.00 + 10% → $49.99.

**Review rule:** `insufficient`, OR confidence < 0.6, OR ≥ $75.00 with
confidence < 0.8, OR the identification below 0.5 — each with its reason in
words, which is what Step 4 prints.

### The comps

`fetchOwnComps` narrows in three steps and stops at the first that finds
anything: brand + category → category + era → category. **There is no
"everything the shop ever sold" step**, deliberately: the median of a whole
inventory is not a comparable, it is an average price, and presenting it as a
comp would be the model naming a number by another route. `insufficient` is the
honest answer instead. Two reads rather than an embed, because
`listing_sales.product_group_id` is not a foreign key.

---

## 5. The surfaces

**Step 3 — `ResearchCard`**, under the preset controls. Era / condition + flaws
/ rarity / price, each with a confidence chip and an expandable **Why** list; a
"Needs a look" flag with its reasons and a Mark reviewed button. It **suggests
and never applies**: every value is behind a button, and the button writes
through `handleTableFieldChange` — the same path a typed value takes — so an
applied price inherits the group patch, the transcript line, the debounced save
and the `saveStatusStore` report, and the card never touches the workflow store.

Capture: one identification row and one price row per run (keyed on the
SUGGESTION, so re-rendering while the seller types does not append a row per
keystroke), `pricing_events` for every suggested field, and on the way out a
`corrected`/`accepted` event per tracked field whose live value differs — once
per (listing, field, snapshot). All of it fails quiet; nothing here can
interrupt a dictation. The `SimilarListings` slot is left empty for the
embeddings pass.

**Step 4 — the split**, above the price gate in `GoogleSheetExporter`: *N ready
to export · M need a look*, each flagged listing with its reasons and **Open in
Step 3**. **It is not a gate** — the CSV still downloads. A $0 price is a file
that is definitely wrong; a review flag is advice, and a research pass that can
stop an export is one that gets switched off the first time it is wrong. The
same rows drive a **`warning`-level** `ReadinessIssue` in every marketplace
column (`withResearchIssues` in `matrix.ts`), which is why it does not block a
feed either. Both surfaces read the same `fetchLatestPrices`, so "flagged"
means one thing in Step 4, not two.

**Products — Mark as sold.** Sold price, date (today by default), where (the ten
marketplace keys + `other`, free text in the column so a flea market is
recordable), optional order number; plus the listing's sales history with days
to sell and a two-step Remove. Keyed on the listing, so switching listings resets
every draft — a price typed for one garment must never be submittable against the
next one.

---

## 6. Screenshots (`img-01/`)

Rendered with the REAL components into the live dev page, so the CSS is the
app's own bundle. `products-sold-*` is wrapped in `.tool-view > .pv` because
that view's phone rules are scoped there (unwrapped, it measures a layout the
app never renders — the first attempt did, and reported false 36px controls).

| Shot | What it shows |
|---|---|
| `research-card-1280.png` | Two-column facets, price spanning, the explanation |
| `research-card-390.png` | One column, full-width actions |
| `research-card-flagged-1280.png` | `insufficient`-adjacent: low confidence, the review block, Mark reviewed |
| `step4-research-split-1280.png` / `-390.png` | 1 ready / 2 need a look, reasons, Open in Step 3 |
| `products-sold-1280.png` / `-390.png` | The Sold card with one recorded sale |

**Measured:** `scrollWidth === clientWidth` at 1280 and 390 on every fixture;
zero sub-44px controls at 390; form controls 16px at 390 (the iOS zoom floor).

**Two visual defects the screenshots found and fixed:** the facet grid stretched
every facet to the tallest sibling, so a one-line "Not dated" rendered as an
empty panel the seller was apparently meant to fill in (`align-items: start`);
and a rarity of 0 drew five empty dots, which reads as a measured zero rather
than as an absence (it now says "Nothing to go on yet").

---

## 7. Gates

| Gate | Result |
|---|---|
| `npx vitest run` | **2217 / 88 files green** (1949 / 83 before this pass and the embeddings pass; +183 from these three files) |
| `npm run build` | clean |
| `npx eslint .` | **252** — the recorded baseline, unchanged |

Two lint errors this pass introduced were fixed rather than absorbed: a
render-time ref write in `ResearchCard` (moved to a layout effect, the
`useEventCallback` construction) and setState inside effects (per-listing UI
state is now KEYED rather than reset, the Sold panel is keyed on the listing, and
the brand facts carry the brand they are about so a mismatch reads as "not
loaded").

---

## 8. Not done, and open questions

- **`price_comps_cache` has no writer.** Phase 4's paid sources fill it.
- **Two reads of `listing_prices` at Step 4 open** — the exporter and the
  marketplaces panel each own their fetch (the house pattern). They agree by
  construction because it is the same function; collapsing them means new App
  state and a prop, which §18 #24 makes non-trivial.
- **`markIdentificationReviewed` needs the run's row id**, which arrives from
  the fire-and-forget insert. Press Mark reviewed inside that window and the
  verdict is recorded as a `pricing_events` row instead. Recorded either way;
  the shapes differ.
- **"deadstock print" claims deadstock.** The word is matched anywhere in the
  notes, so a phrase about the PRINT reads as a claim about the garment. The
  worn-flaw override catches the damaging half of it; a phrase-level fix belongs
  in `voiceGrammar` rather than here.
- **Nothing was verified in a signed-in browser**, and nothing was run against
  Supabase.
