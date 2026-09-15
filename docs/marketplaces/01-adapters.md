# Marketplace adapters — what each one does, and what is still a guess

Phases 1 and 2 of `00-plan.md`, library half. `src/lib/marketplaces/` is ten
adapters, the helpers they share, a registry and the listing-pack builder —
**pure modules: no DOM, no network, no Supabase, no React**. Step 4's UI, the
`marketplace_vocab` service and `listing_publications` are wired on top of this
in a later pass; nothing here knows they exist.

```
src/lib/marketplaces/
  types.ts        the contract (owned jointly — additive changes only)
  shared.ts       coalesce · cut · plain↔html · tags · photos · price · issues
                  · resolveControlled · baseFormat · toCsv
  conditions.ts   free text → one canonical ConditionGrade, or null
  <marketplace>.ts × 10   spec (data) + format + serialize (feeds only)
  registry.ts     ADAPTERS · getAdapter · listAdapters · adaptersWithChannel
  pack.ts         buildListingPack · packToText
  fixtures.ts     TEST-ONLY. One full listing + one sparse one, shared by all ten
```

**314 tests across 14 files.** Every adapter has a golden snapshot of `format()`
for both fixtures; the four feed adapters have a `serialize` golden with an
injected date.

---

## 1. The shape every adapter has

`spec` is data — limits, vocabularies, channels — so correcting a number is a
one-line edit plus a snapshot update, never a code change. `format()` is the
same pass for all ten (`baseFormat`) plus what is genuinely that marketplace's
own: its item specifics, its feed columns, its taxonomy. `validate()` is
literally `format(input).issues`, so the readiness checklist and the published
listing can never disagree about what is wrong.

**`format()` never throws.** Every field of a `ClothingItem` is optional and the
sparse fixture proves it: no price, no brand, one photo, a condition no lexicon
can read. Those come back as `issues`, not exceptions.

Issues are appended in a fixed order — title, description, price, photos, brand,
color, size, condition, category — so a golden snapshot means something.

### The rules that are shared, and why

| Helper | Rule |
|---|---|
| `coalesceGroup` | First non-blank value per field across the group, leader first. Reproduces `GoogleSheetExporter`'s inline rule exactly (that copy lives inside a React component, so it is reproduced rather than imported). Price sits on photo 2 and material on photo 3 in the fixture, deliberately. |
| `cutTitle` | Word boundary, never mid-word, never ending on a separator, **no ellipsis** — the seller pastes this into a title box where a "…" is a character of their budget spent on nothing. A single word longer than the limit is hard-cut; an empty title is worse. An exact fit keeps its last word. |
| `cutText` | Prefers a sentence end or line break inside the last 15% of the budget, else a word boundary. No exact-fit shortcut, unlike `cutTitle`: a body has 1,000 characters to spend and reads better ending at the paragraph break than on a dangling first word of the next one. |
| `toPlainText` / `toHtml` | The generated description round-trips through Shopify's Body (HTML), so `<br>`/`<p>` come back. `&amp;` is decoded LAST (decoding it first turns `&amp;lt;` into `<`). `toHtml` escapes before converting, so "100% cotton \<a steal\>" cannot inject markup. |
| `buildTags` / `buildHashtags` | De-duplicated case-insensitively, both limits respected. A hashtag has its spaces removed — "single stitch" → `#singlestitch`, because a hashtag with a space in it is two hashtags and the second is nonsense. |
| `limitPhotos` / `photoIssues` | Leader first, cut to the limit. Below the minimum is an **error**; above the maximum is a **warning that says how many will be dropped** — the seller chose those photos. |
| `applyPrice` | Through `platformPricing.applyPlatformPrice`. A price that is not positive and finite comes back as `null` and is **never handed to the rule**, so no rounding mode can turn a $0 into a sellable number behind the readiness check (AGENTS.md §18 #42). Compare-at is adjusted only when the rule opts in, and emitted only when it is above the price actually charged. |
| `toCsv` | Every cell through `escapeCsvValue` **imported from `csvExport`** — that is the CSV formula-injection guard, and it is not reimplemented here. |

### Controlled vocabularies — the "it defaulted to some prebuilt brand" fix

`resolveControlled(kind, field, canonical, vocab, spec)`:

1. the spec's own list, matched through case, spacing and punctuation;
2. the workspace's vocabulary (`VocabResolver` — the service decides how hard it
   tries, including the fuzzy brand matcher);
3. give up → the marketplace's documented fallback **plus a warning carrying the
   unresolved value and its `fixKind`**, which is everything "remember this
   mapping" needs.

One orthographic fold is built in — `grey` ≡ `gray` — because those are two
spellings of one word and grey is the commonest colour on a rack of vintage
sweatshirts. It stops there on purpose: "navy" → Blue and "forest green" → Green
are *judgements* about what a marketplace means by its own list, and judgements
belong in the workspace's vocabulary where a human made them.

**Brand never falls back.** An unresolved brand goes out **exactly as the seller
typed it**, with a warning. A listing that says "Other" where the garment says
Carhartt is invisible to search, and one that says the wrong brand is a
takedown; the marketplace rejecting a brand is recoverable, a wrong brand is not.

### Condition

`normalizeCondition` reads free text — the dictation grammar writes whatever was
said into `condition` — into one of six canonical grades, and each adapter maps
that through `spec.condition.map`. It returns `null` rather than guessing:
"kinda beat up" reads like `poor` to a human and like nothing to a lexicon, and
inventing a match is how a listing goes out saying "Good" about a garment with a
hole in it. A `null` becomes a warning naming the raw text (an **error** on
Facebook, where the column is required and a blank loses the row).

Ordering inside the lexicon is load-bearing and tested: "like new" → excellent,
"very good" → excellent, "heavily worn" → poor, "well worn" → fair, "new w/o
tags" → new_without_tags. Bare words are the last tier, because every one of
them is a substring of a phrase that means something else. `10/10` → **excellent,
never new** — a 10/10 vintage tee is still a used garment, and that is the one
direction of this mapping a buyer disputes.

---

## 2. Per marketplace

Every `verified` flag is **`false`**. Section 3 lists exactly what is unconfirmed.

### Shopify — `feed`

| | |
|---|---|
| Title / description | 255 · unlimited HTML |
| Photos | 1–250 |
| Tags | 250, 255 chars each |
| Brand / colour | free text (Vendor is the **seller**, §18 #37) |
| Condition | canonical labels, free text |
| Category | Shopify taxonomy path |

`serialize` calls **`buildShopifyCsv` verbatim**, so the 54-column golden in
`src/lib/__snapshots__/csvExport.test.ts.snap` is untouched and the Shopify
import this shop runs on does not move. A test asserts the output is the same
string the exporter would have produced. The price rule is applied by `format()`
and **not again** by the builder — a +13% marketplace applied twice ships +27.7%.

`format()` exists so Shopify appears in the matrix beside the other nine, and it
mirrors `buildShopifyCsvRows`' category rule exactly (a preset's full taxonomy
path wins, canonicalised, and only when Shopify knows it), warning when a
category has no path instead of exporting a blank column.

**`attributes`**: `vendor`, `productType`, `productCategory`.
**`source`**: set — the 54 columns need ~30 fields no marketplace-shaped listing
carries. Shopify is the only adapter that sets it.
**By hand afterwards**: upload the CSV in Shopify admin; the gid metafield
overrides fetched per store are not yet threaded through `serialize` (see §4).

### eBay — `pack` (Sell API is plan phase 3)

| | |
|---|---|
| Title / description | 80 · 500,000 HTML |
| Photos | 1–24 |
| Tags | none — eBay discovery runs on item specifics |
| Brand | free text, falls back to eBay's own `Unbranded` |
| Condition | New with tags / New without tags / New with defects / Pre-owned |
| Category | numeric eBay category id (via workspace vocabulary) |

**`attributes`** are the item specifics, and they are the point of this adapter:
`Brand`, `Department`, `Size`, `Size Type`, `Style`, `Type`, `Color`, `Material`,
`Decade`, `Vintage`, `MPN`. Blank ones are dropped — an empty specific is
rejected, not ignored. Every used grade maps to `Pre-owned`.
**By hand afterwards**: pick the eBay category (or map it once in the workspace
vocabulary and it stops asking), set shipping and returns, upload the photos.

### Etsy — `pack` (Open API v3 is plan phase 3)

| | |
|---|---|
| Title / description | 140 · 13,000 plain |
| Photos | 1–10 |
| Tags | 13, **20 chars each** |
| Brand / colour | free text |
| Condition | New / Vintage / Handmade — Etsy has no wear scale |
| Category | Etsy taxonomy id (via workspace vocabulary) |

**`attributes`**: `who_made` (`someone_else`, or `i_did` when the listing says
so), `when_made` (a decade from `era`; anything before 1920 buckets to
`before_1920`), `is_supply`, `materials`, `item_type`. Etsy polices what may be
sold — vintage means 20+ years old — so a missing era is a warning rather than a
guessed decade.
**By hand afterwards**: pick the Etsy category, set shipping profile and
quantity, upload photos.

### Poshmark — `pack`

| | |
|---|---|
| Title / description | 80 · 1,500 plain |
| Photos | 1–16 |
| Tags | none |
| Brand | **controlled** (picker), no fallback |
| Colour | **controlled**, 15-value list |
| Condition | NWT / NWOT / Pre-owned |
| Category | Poshmark path (Department → Category → Subcategory) |

**`attributes`**: `Department` (Unisex is left blank rather than guessed into
Men's), `Original price` (the struck-through compare-at), `Style tags`.
**By hand afterwards**: everything — Poshmark has no import and forbids
automating the app. The pack is the deliverable.

### Mercari — `pack`

| | |
|---|---|
| Title / description | **40** · 1,000 plain |
| Photos | 1–12 |
| Tags | 3 hashtags, in the description |
| Brand | controlled (picker) |
| Condition | New / Like new / Good / Fair / Poor |

The tightest title in the set. The three hashtags are **reserved out of the
1,000-character budget before the body is cut**, so they are never the part that
gets truncated — they are the discovery surface, and a half-written one reads as
a typo. **`attributes`**: `Material`, `Weight (g)`, `Package size`.

### Grailed — `pack`

| | |
|---|---|
| Title / description | 60 · 5,000 plain |
| Photos | 1–25 |
| Tags | none |
| Brand | **controlled** — Grailed calls it the Designer |
| Condition | New / Gently used / Used / Very worn |

**`attributes`**: `Designer`, `Department` (Menswear / Womenswear; Unisex left
blank), `Material`, `Era`.

### Depop — `feed` + `pack`

| | |
|---|---|
| Title / description | 60 · 1,000 plain |
| Photos | 1–8 |
| Tags | 5 hashtags, in the description |
| Brand | **controlled** (picker) |
| Condition | Brand new / Like new / Used - excellent / Used - good / Used - fair |

Six canonical grades into five Depop words: `poor` doubles up on `Used - fair`,
the lowest Depop offers. **`attributes`**: `style`, `source` (Vintage /
Deadstock / Thrifted — claimed only when the listing says so), `age` (decade),
`subcategory`, `currency`.

**Feed columns (⚠️ UNCONFIRMED, `DEPOP_COLUMNS`)**:
`sku, title, description, hashtags, category, subcategory, brand, colour,
condition, size, style, source, age, price, currency, photo_1 … photo_8`.

### Facebook — `feed` + `pack`

| | |
|---|---|
| Title / description | 150 · 5,000 plain |
| Photos | 1–20 |
| Tags | none |
| Brand | free text, falls back to `Unbranded` (the column is **required**) |
| Colour | free text — the *catalog feed* takes free text; Marketplace's own listing form has a picker, which is a different surface |
| Condition | `new` / `refurbished` / `used` (the catalog's vocabulary) |
| Category | Google product category, fallback `Apparel & Accessories > Clothing` |

Nine required columns, so **a missing condition is an `error` here**, not a
warning: Commerce Manager rejects the row in a summary screen nobody reads.

**Feed columns (`FACEBOOK_COLUMNS`)**: `id, title, description, availability,
condition, price, link, image_link, brand, additional_image_link,
google_product_category, color, size, gender, age_group, product_type`.
`price` carries its currency in the cell (`45.00 USD`), `availability` is
`in stock`, `image_link` is the first photo and `additional_image_link` the rest
comma-joined, `id` is the SKU falling back to the group id.

**`link` is deliberately blank** — it is the product's page on the seller's own
site and this shop has none. Commerce Manager accepts the row and the item
checks out inside Facebook. If the workspace ever gets a storefront, this is the
one column to fill.

**By hand afterwards**: upload in Commerce Manager, set the catalog's shipping
and returns, review the rejected-rows report.

### Vinted — `pack`

| | |
|---|---|
| Title / description | 60 · 3,000 plain |
| Photos | 1–20 |
| Tags | none |
| Brand | **controlled** (picker) |
| Colour | **controlled**, 22-value list, fallback `Multi` |
| Condition | New with tags / New without tags / Very good / Good / Satisfactory |

The one lossy mapping in the folder: Vinted has no word for a garment in poor
condition, so `poor` rounds **up** to `Satisfactory` — which is why `Flaws` is
surfaced as an attribute, so what is wrong with it is in the text.
**`attributes`**: `Department`, `Material`, `Flaws`, `Package size`.

### Whatnot — `feed` + `pack`

| | |
|---|---|
| Title / description | 80 · 2,000 plain |
| Photos | 1–12 |
| Tags | none |
| Brand / colour | free text |
| Condition | free text — the canonical labels pass through unchanged |

**`attributes`**: `Sub Category`, `Quantity`, `Type` (`Buy it Now` — an auction
is a per-stream decision, not an export default), `Offerable`, `Hazmat`,
`Cost Per Item`, `Shipping Profile` (blank).

**Feed columns (⚠️ UNCONFIRMED, `WHATNOT_COLUMNS`)**: `Category, Sub Category,
Title, Description, Quantity, Type, Price, Shipping Profile, Offerable, Hazmat,
Condition, Cost Per Item, SKU, Image URL 1 … Image URL 12`.

**By hand afterwards**: the Shipping Profile is named inside the seller's own
account and cannot be guessed; set it in the sheet or in Whatnot before going
live.

---

## 3. What is NOT confirmed

Everything in this list is `spec` **data**, so each correction is one line plus
`npx vitest run -u`. Nothing in the code changes.

**Every `verified` flag is `false`.** Set one true only after reading that
marketplace's live seller documentation.

| Where | What is a guess |
|---|---|
| `depop.ts` `DEPOP_COLUMNS` | **The whole column list.** Depop's bulk upload is granted per seller and the template is not published openly; these are the fields Depop's own listing form collects. The pack channel is the one to trust until a real template is seen. |
| `whatnot.ts` `WHATNOT_COLUMNS` | **The whole column list**, from memory of Whatnot's seller template. Also whether `Offerable`/`Hazmat` want `TRUE`/`FALSE` or words. |
| `poshmark.ts` `POSHMARK_COLORS` | The 15-value colour picker, from memory. |
| `vinted.ts` `VINTED_COLORS` | The 22-value colour picker, from memory. Vinted's real list is longer and localised. |
| `grailed.ts` condition | The plan's table says "5-step" but names four. Four is what the listing form shows — confirm which. |
| `ebay.ts` condition | eBay has been rolling out graded pre-owned conditions for clothing; `Pre-owned` may now be several values. Also the `Department` values (`Unisex Adults`, `Kids`) and the `Size Type` spellings. |
| `facebook.ts` colour | Recorded as free text because the **catalog feed** accepts free text; the plan's §2c lists Facebook among the fixed colour lists, which is Marketplace's listing form. Confirm which surface this feed actually uploads to. |
| Description limits | `etsy` 13,000 · `grailed` 5,000 · `vinted` 3,000 · `whatnot` 2,000 · `ebay` 500,000 · `shopify` 65,535 are all from memory — the plan's table gives no number for four of them. Poshmark 1,500, Mercari 1,000, Depop 1,000 and Facebook 5,000 come from the plan. |
| Title limits | All ten come from the plan's table and are unverified there too. |
| `docsUrl` on every spec | Written from memory; several will have moved. |

---

## 4. Known gaps, deliberately left

1. **Shopify gid overrides.** `GoogleSheetExporter` fetches per-store metaobject
   GIDs and passes them to `buildShopifyCsv`; `shopify.serialize` cannot, because
   `SerializeOptions` has no field for them and adding one would couple
   `types.ts` to `csvExport`. Until Step 4 is wired, the adapter uses the
   founding-store defaults — the same behaviour as an export with no overrides.
2. **No `api` channel.** `adaptersWithChannel('api')` is empty by design; the
   eBay / Etsy / Shopify connectors are plan phase 3 and need the founder's
   explicit yes on external APIs (`00-plan.md` §6.1).
3. **Size is never resolved against a marketplace's list.** Size lists are huge
   and per-category, so `MarketplaceSpec` does not model one; the workspace's
   vocabulary is the only mapping, and a missing size is a warning because it is
   what shoppers filter by.
4. **`listing_publications`, `org_marketplaces` and `marketplace_vocab`** are the
   other half of phase 1 and are not in this folder. Adapters reach the
   workspace's corrections only through the `VocabResolver` they are handed, so
   they never learn where the rows live.
5. **Photo zipping** for the pack channel is a delivery concern and lives outside
   the adapter — `ListingPack.photos` is the ordered, count-limited URL list it
   will be built from.
