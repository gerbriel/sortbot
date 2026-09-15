# Multi-marketplace, phase 1 + 2 — the Step 4 half

What this pass built: `src/components/MarketplaceExport.tsx`, the pure grid
arithmetic it runs on (`src/lib/marketplaces/matrix.ts`), one additive read on
`marketplaceService`, and the Step 4 wiring in `App.tsx`. It is the "do the
thing" half of `00-plan.md` §5 phases 1 and 2 — the adapters (`01-adapters.md`)
and the data layer (`02-data.md`) were built by the two passes before it and are
consumed unchanged.

**Nothing needs an API key.** A seller can pick which marketplaces this batch
goes to, read a readiness grid of listings × marketplaces, download the feed CSV
for a feed marketplace, open a copy-ready pack for a pack marketplace, fix a
vocabulary gap in place, and mark what has been posted. The connectors (eBay,
Etsy, Shopify write) are plan phase 3 and still need the founder's explicit yes
on external APIs (`00-plan.md` §6.1).

**No SQL was run.** `supabase/migrations/marketplaces.sql` is still written and
not applied, so in production today the panel renders one setup line and Step 4
behaves exactly as it did before.

---

## 1. Files

| File | What |
|---|---|
| `src/components/MarketplaceExport.tsx` | The panel. **NEW.** |
| `src/components/MarketplaceExport.css` | Its styles — tokens only, no hex. **NEW.** |
| `src/components/MarketplaceExport.test.tsx` | 15 tests on the `ui/testUtils` harness. **NEW.** |
| `src/lib/marketplaces/matrix.ts` | `effectiveTargets` · `nextTargets` · `cellSummary` · `summarizeMarketplace` · `summarizeMatrix` · `fixableIssues`. Pure. **NEW.** |
| `src/lib/marketplaces/matrix.test.ts` | 23 tests. **NEW.** |
| `src/lib/marketplaceService.ts` | `fetchBatchTargets(batchId)` added. Nothing else touched. |
| `src/lib/marketplaceService.test.ts` | 4 tests for it (58 → 62). |
| `src/App.tsx` | The Step 4 mount, `onToastStable`, `onOpenWorkspaceMarketplaces`, and a one-shot `workspaceTab` hint so that link lands on the dashboard's Marketplaces tab. |

Not touched, deliberately: the ten adapters, `csvExport.ts`,
`GoogleSheetExporter.tsx`, `OrgPanel.tsx`, and every migration.

---

## 2. The rules this pass decided

### Empty targets means ALL enabled — and the explicit list is written on first change

`workflow_batches.target_marketplaces` defaults to `'{}'` and nothing in the
column tells "not chosen yet" apart from "chosen none". `02-data.md` §7.3 left
that open; §2b of the plan says a batch should default to every enabled
marketplace on first open. So:

- `effectiveTargets(stored, enabled)` reads `[]` as **every enabled
  marketplace**, in `MARKETPLACE_KEYS` order. A batch nobody has configured shows
  every column, which is the only reading that says anything.
- The first time a chip is toggled, the **explicit** list is persisted — so the
  ambiguous state can be read but is never created from here.
- **The last remaining target cannot be turned off.** `nextTargets` returns
  `null` and the panel says "Keep at least one marketplace selected for this
  batch." Storing `[]` would also silently re-select everything on the next open,
  which reads as the app undoing the click.
- A stored target the workspace has since **disabled** is dropped (plan §2b: a
  marketplace the shop has not enabled never appears in the workflow). If that
  empties the list the batch falls back to "all enabled" — the same recovery as
  never having chosen.

`nextTargets` takes the **effective** list, not the stored one, which is what
turns an implicit "all" into an explicit "all minus this one" in a single click.

### Shopify is a readiness column, not a second download

`GoogleSheetExporter` keeps the Shopify CSV. It dedups titles and handles against
the app's own `products` table **and the live Shopify catalog** through the
`shopify-titles` Edge Function, it threads per-store metaobject GIDs into the
builder, and it runs the $0 price gate — none of which `shopify.serialize` can do
(`01-adapters.md` §4.1, `SerializeOptions` has no field for the overrides). Two
buttons producing two different Shopify CSVs, one of them silently worse, is the
mistake this avoids. Shopify's column header says **"Download below"** and offers
no button.

The other three feed marketplaces (Facebook, Depop, Whatnot) get
`adapter.serialize(...)` → blob download, with the marketplace in the filename
the way the pricing pass established.

### A feed is blocked by an error, exactly like the price gate

A column whose listings hold any `error`-level issue has its download disabled
with the count in the `title`. That is the same rule the Shopify export already
enforces for $0 prices, and it uses the same source of truth: `validate()` **is**
`format().issues`, so the checklist and the file can never disagree about what is
wrong.

A `warning` never blocks. An unresolved brand goes out as the seller typed it
(`01-adapters.md` §1) and a listing with no size still sells; a missing price does
not.

### One `format()` per (listing × marketplace), memoized

The adapters are pure and cheap individually, but ten of them over 375 listings is
a few thousand calls, and App re-renders on every workflow-store write. So:

- `MarketplaceExport` is `memo`'d, and App feeds it `useEventCallback` handlers
  plus its already-memoized `step4ExportItems` (§18 #24).
- `rows` is memoized on `items`, `formatted` on `targets · rows · vocab ·
  vendorName · descriptionSettings · pricingFor`, and `summaries` on
  `targets · formatted`. Typing in a "Remember" input recomputes none of them.

Rows come from `buildGroupArray` — the same groups Step 3 navigates — coalesced
with `coalesceGroup`, titled with `buildCleanTitle`. A row here **is** a listing
there, and a row here is the same product the CSV exports.

### A vocabulary fix is a workspace row, written by any member

Every issue carrying a `fixKind` and a `value` becomes an inline
`Remember: «value» → [input]` row under that marketplace's checklist. Saving calls
`upsertVocab({ orgId, marketplace, kind, canonical, marketplaceValue })` — a
**workspace** row, with no admin gate, exactly as `marketplaces.sql` and
`brand_aliases.sql` intend: the person who hits it is whoever is listing, not
whoever happens to be an admin. The vocabulary is refetched on success, the
resolver is rebuilt, and the matrix re-resolves — so the warning disappears from
every listing that shared that value, not just the one that surfaced it.

Two unresolved **values** stay two rows (each needs its own mapping); the same
value seen in different case folds into one row with a count.

### Provisional limits are said once per marketplace

Every adapter's `spec.verified` is still `false` (`01-adapters.md` §3). The
checklist says so once per column, in `--text-muted`, with a link to that spec's
`docsUrl` — not once per listing, which would bury the actual issues.

### Packs

"Open packs" expands one card per listing under the matrix: every field
`buildListingPack` produced with a **Copy** button, a **Copy all**
(`packToText`), the photos in publish order with **Download photos (zip)**, and
that listing's own issues. A field with no value is not shown at all — a copy
button that copies nothing is a dead control (that rule is `pack.ts`'s, honoured
here).

- **Clipboard has a real fallback.** `navigator.clipboard` is absent outside a
  secure context and can be refused by permission, and a pack is a row of copy
  buttons, so a silent no-op there is the whole feature failing quietly. The
  fallback selects a hidden textarea and runs `execCommand('copy')`. The toast
  says which path ran.
- **The zip is lazy.** `import('jszip')` exactly the way `ImageUpload`'s
  `loadJSZip` does it (jszip's `.d.ts` uses `export =`, so `default` is resolved
  inside the loader) — ~97 kB fetched only when a seller actually downloads
  photos. Files are named `01.jpg`, `02.jpg`… because a seller uploads them in
  order. A photo that cannot be fetched is skipped and counted in the toast
  rather than failing the zip.
- **Mark posted** writes `listing_publications` status `posted` with
  `posted_at`; a second click on an already-posted listing offers **Mark sold**.
- The pack card layout is **CSS multi-column, not grid**. A pack holds one field
  that is paragraphs long beside a dozen that are one word, and any grid gives
  that row the description's height — leaving BRAND and SIZE as 400px boxes
  holding a single word. Columns pack by height, so there is no void and nothing
  needs a nested scroller or a clamp that would hide text the seller is about to
  paste.

### Publications are recorded serially

A feed export upserts one `listing_publications` row per listing as `exported`,
then refetches. Serial rather than parallel on purpose: these are writes against
one table keyed on one triple, and a burst of 375 concurrent PATCHes is how a
workspace gets rate-limited in the middle of its own download. Failures are
counted and named in the toast — the file still downloaded, and saying "and N
records could not be saved" is more useful than failing the export.

### Price rules

Each marketplace's `settings.pricingRuleId` is looked up in
`descriptionSettings.platformPricing` through `selectablePlatforms`. An id that no
longer resolves falls back to **no adjustment** — derived every render rather than
stored, the same rule Step 4's existing platform selector follows (§10, feature
21). The adapters' own `$0`-and-non-positive invariants (§18 #42) are untouched:
`applyPrice` never hands a non-positive price to a rule.

---

## 3. Mobile

Phone block at `<= 640px`, measured at 390 (see §5):

- The matrix scrolls **inside its own box** with the listing column frozen
  (`position: sticky; left: 0`), the header cell at `z-index: 3` so it outranks
  both the sticky header row (2) and the sticky body cells (1) — the pattern the
  54-column export preview already uses.
- `overscroll-behavior-x: contain` so a sideways pan does not chain into the page.
  `overflow-y: hidden` beside `overflow-x: auto`, because `auto` on one axis makes
  a box scrollable on **both**.
- Checklist cards and pack fields collapse to one column; the fix row puts its
  label on its own line and keeps input + Save side by side, so one unresolved
  value is two rows rather than three full-width slabs.
- Inputs are `var(--fs-md)` (16px, from the token) and 44px tall — under 16px,
  mobile Safari zooms the page on focus and never zooms back. The 44px is a
  literal, per §18 #31.

Desktop above 640px is untouched by every one of those rules.

---

## 4. Tests

**1530 → 1572 passed, 71 → 73 files.** This pass adds 42:

- `matrix.test.ts` (23) — the empty-targets rule in both directions, key-order
  output, a disabled target being dropped and the fallback when that empties the
  list, **the last target refusing to be turned off**, error-outranks-warning,
  issue collapsing with two values kept apart and one value's case folded
  together, adapters' issue order preserved, an empty column as zeros.
- `MarketplaceExport.test.tsx` (15) — the setup hint and nothing else
  pre-migration; the no-marketplaces empty state and its button; empty vs
  explicit targets rendering the right columns; two rows with the right cell
  level per column; the checklist counts; **Shopify offering no CSV button and
  saying "Download below"**; a Facebook feed download firing the browser download
  and upserting one `exported` record; the same button disabled while a listing
  errors; a target toggle persisting the explicit list and the last one refusing;
  a "Remember" save calling `upsertVocab` with the workspace org id and
  refetching; packs opening with a copy button per field and three thumbs; "Mark
  posted" recording exactly one publication; a recorded status rendering in its
  cell; the no-listings empty state.
- `marketplaceService.test.ts` (+4) — `fetchBatchTargets` projecting one column,
  ok-and-empty vs unavailable, and asking nothing without a batch id.

Only the network functions are mocked. `buildGroupArray`, `coalesceGroup`, all
ten adapters, `buildListingPack` and `summarizeMatrix` run for real against the
adapters' own fixtures — so a column that reads "1 blocked" here is blocked for
exactly the reason `01-adapters.md`'s golden says it is.

---

## 5. Gates

| Gate | Result |
|---|---|
| `npx vitest run` | **1572 passed / 73 files** (baseline 1530 / 71) |
| `npm run build` | clean — only the pre-existing "dynamically imported by … also statically imported" notices |
| `npx eslint .` | **252 problems**, exactly the recorded baseline; zero in the new files |

---

## 6. Visual verification

No harness can sign in (the standing gap, §14 #26), so the panel was rendered
through the `ui/testUtils` harness, its markup injected into the live dev page
(which loads the real CSS bundle), and photographed in headless Chrome at 1280
and 390. Fixtures are the adapters' own FULL + SPARSE listings; photo `src`
values were swapped for a grey placeholder because the fixture's storage URLs do
not resolve.

| Screenshot | What it shows |
|---|---|
| `img-03/matrix-1280.png` | Three targets, two listings, the checklist with its fix rows, the matrix with the `exported` chip |
| `img-03/packs-1280.png` | The same with Poshmark's packs open |
| `img-03/matrix-390.png` | Phone: chips wrapped, checks stacked, matrix scrolling in its box |
| `img-03/packs-390.png` | Phone: packs one column |

Measured in the page, not eyeballed:

- **390px: `document.documentElement.scrollWidth === clientWidth === 390`**, with
  and without packs open. The matrix's own box is 584 wide inside a 368 client —
  it scrolls, the page does not.
- 390px: **0** buttons or inputs inside `.mkx` under 44px tall; the fix input
  computes to **16px**.
- 1280px: `scrollWidth === clientWidth === 1280`; the matrix needs no scroll.

Two things the screenshots changed: the target chips were rendering in
`org_marketplaces` row order while the columns were in `MARKETPLACE_KEYS` order
(two orderings of the same set read as two different lists — the chips now use
key order), and both card grids were stretching every card to the tallest sibling
(fixed with `align-items: start` on the checklist, and by moving the pack fields
to multi-column).

---

## 7. Not verified / not built

- **Nothing has been seen in a signed-in browser.** Same standing gap as the
  mobile pass and the Marketplaces tab (`02-data.md` §5): the markup was rendered
  from the real component through the real CSS, which proves the cascade, not the
  React wiring inside a live App.
- **No SQL has been run**, so the panel has never rendered against real rows. The
  `'unavailable'` path is the one that runs in production today.
- **The zip, the clipboard and the blob download were exercised only under
  happy-dom**, where `execCommand`, `URL.createObjectURL` and `fetch` are stubs.
  The feed-download test asserts the anchor's `download` attribute, not that a
  file landed on disk.
- **No connectors.** `adaptersWithChannel('api')` is still empty; eBay / Etsy /
  Shopify write are plan phase 3.
- **Shopify gid overrides still do not reach `shopify.serialize`** — which is why
  Shopify's CSV stays with `GoogleSheetExporter`. Unchanged from
  `01-adapters.md` §4.1.
- **`DEPOP_COLUMNS` and `WHATNOT_COLUMNS` are still guesses** and every
  `spec.verified` is still `false`. The panel says so per marketplace; it does not
  make the numbers true.
- **No "sold on X → mark the rest"**, no status sync-back, no per-marketplace
  analytics. Plan phase 4.
- **The global vocabulary is still empty** (`02-data.md` §7.1). Until it is
  seeded, a shop's first pass through this panel will show a brand and colour
  warning per marketplace — which is exactly the prompt the fix rows exist for,
  but it is a lot of rows on day one.
