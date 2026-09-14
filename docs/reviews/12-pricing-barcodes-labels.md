# 12 — Per-platform pricing, barcodes and listing labels

**The two requests, verbatim:**

> *(21)* "User can set pricing options for different platforms they will upload
> CSV to. Either an upsell percentage or dollar value per app because of charges
> and fees."

> *(25)* "Need to build out this barcode generator & scanner + enable labels →
> color labels, word labels to select (e.g. 'bad kids club'), vendor labels."

Built against the working tree at `354dcae` (branch `main`). **Nothing committed.**
**No dependency added.** **No SQL run against Supabase** — the migration is a file,
verified against a throwaway local Postgres 14 (§6). `src/App.tsx`,
`ProductDescriptionGenerator.tsx`, `ImageGrouper.tsx` and `Library.tsx` were
**not edited**; the exact wiring they need is in §7 for the orchestrator.

Everything is first-party, per CLAUDE.md §9. The Code 128 encoder is ours
(§3) — no barcode library, no WASM decoder, no fee API. Three tables' worth of
schema, two pure libraries, three components.

---

## 1. Feature 21 — per-platform pricing

### The model: one price, many prices

A listing keeps **one** price — the one typed in Step 3, the one in
`products.price`. A platform is a pure **function** applied at export time.
Nothing is written back, so the same batch exports to Shopify and to eBay from
identical rows, and the number the user reasons about never becomes ambiguous.
The alternative (a price column per marketplace) would have meant a migration,
a Step-3 form that is five times wider, and five values to keep in step.

### The rule

```ts
interface PlatformPricingRule {
  id: string;            // stable key: selector, filename slug, React key
  name: string;          // "eBay", "Etsy — vintage shop"
  enabled: boolean;      // off = keep it, but hide it from Step 4
  adjustment: { type: 'percent' | 'fixed'; value: number };
  rounding: 'none' | '.99' | 'whole';
  applyToCompareAt: boolean;
}
```

Stored as `description_settings.platformPricing` on `organizations` — the JSONB
that already exists (`org_description_settings.sql`). **No migration.**
`DEFAULT_DESCRIPTION_SETTINGS.platformPricing` is `[]`, so a workspace that never
opens the setting exports exactly the prices it always did, and nothing in the
description engine reads the key — the golden description snapshot is untouched
(verified: `textAIService.test.ts` unchanged and passing).

### Two invariants that are not negotiable

**1. `$0` passes through untouched.** The exporter hard-blocks any export where a
product has no price or $0 (CLAUDE.md §10). If a `.99` rounding rule could turn
`0` into `0.99`, *selecting a platform would silently defeat that gate* and ship
unpriced products to Shopify. So anything that is not a positive finite number is
returned exactly as it arrived. Locked by an exhaustive test over the whole rule
space (3 roundings × 2 types × 6 values × {0, −0, NaN, ∞, −5}).

**2. A rule can never produce a non-positive price.** A −100% platform, or a
fixed −$50 on a $20 item, would otherwise *manufacture* the very $0 the gate
exists to catch — after the gate has run. Results clamp to one cent; whole-dollar
rounding clamps to one dollar; `.99` clamps to `0.99`.

### Rounding

| Mode | Rule | $49.50 → |
|---|---|---|
| `none` | exact cents | 49.50 |
| `.99` | **nearest** whole dollar, less a penny | **49.99** |
| `whole` | nearest whole dollar | 50.00 |

`.99` is *nearest*, not ceiling: that is what makes the founder's worked example
come out right — $45.00 +10% = $49.50 → **$49.99**. `pricingExample()` renders
exactly that string in the settings form, and a test asserts it.

Compare-at is compared against the **adjusted** sale price, so a +20% platform
never emits a compare-at that is now *below* what the listing charges (Shopify
renders that as a nonsense discount). It degrades to blank, not to an import
error.

### Where it plugs in

* `buildShopifyCsvRows(products, gidOverrides, vendorName, pricing?)` — a fourth
  **optional** parameter. Omitted (the default everywhere except the Step 4
  selector) the output is byte-identical, which is what keeps the golden CSV
  snapshot valid. The snapshot was **not** regenerated.
* `GoogleSheetExporter` — a `<select>` above the preview, rendered **only when
  the workspace has configured a marketplace** (with none, the single
  "Shopify / no adjustment" option would be a control that cannot do anything).
  The preview table and the download use the *same helpers*, so they cannot
  drift. The selected platform is **derived** each render, not stored: if the
  workspace disables or renames it while Step 4 is open, it falls back to the
  no-adjustment platform rather than silently applying a rule that no longer
  exists.
* **Filename** — `shopify-products-ebay-2026-09-14.csv`. These files pile up in a
  Downloads folder and importing the eBay-priced CSV into Shopify is a silent,
  costly mistake. The identity platform keeps the historical filename exactly.
* **Summary line** — `Prices +12% rounded to .99 for eBay`, in `--warning` when a
  rule is active. Nobody downloads a re-priced CSV without being told in words.

### Settings UI

Workspace panel → Settings → **Marketplace pricing** (org admins). One card per
marketplace: name, percent/dollars, value, rounding, `compare-at too`,
`show in Step 4`, reorder, delete — plus a live worked example (`$45.00 →
$49.99`) and the rule in a sentence. Quick-add chips for Shopify / eBay / Depop /
Poshmark / Mercari / Etsy / Grailed / Vinted seeded with each marketplace's
**published headline fee as a starting point** — the copy says so, and says fees
change and to check yours. Saving goes through the existing
`handleSaveDescSettings`, so this JSONB has exactly one writer.

"Reset to defaults" deliberately does **not** clear the marketplaces: that button
means "reset the description format", and it must not silently delete pricing
that merely shares a column.

`normalizePlatformRules` runs on every read (`resolveDescriptionSettings`). The
JSONB is free-form, may have been written by an older build, and feeds the money
path — so a malformed rule is dropped once, centrally, rather than defended
against at every use.

---

## 2. Feature 25 — data model

### `listing_labels` — the vocabulary

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `org_id` | uuid → organizations, cascade, **default `default_org_id()`** | The client never passes it. |
| `name` | text, `check length(btrim(name)) between 1 and 40` | |
| `color` | text, default `slate`, `check ~ '^[a-z]{3,16}$'` | A palette **name**, never a hex or CSS. |
| `kind` | `vendor` \| `custom`, default `custom` | |
| `sort_order` | integer, default 0 | |
| `created_by` | uuid, default `auth.uid()` | Excluded from the UPDATE grant → immutable. |

### `product_labels` — the join

`primary key (product_id, label_id)` **is** the "applied at most once" rule — no
unique index needed, and a double-tap in the picker hits 23505 instead of
creating a second row. Both FKs cascade. **No updatable columns at all**: an
assignment is created or destroyed, never edited.

### `products.sku` / `.barcode`

**They already exist** (`supabase/schema.sql` lines 44–45, and the `Database`
type in `src/lib/supabase.ts`), so the `add column if not exists` statements are
no-ops on any real database — they are there only so a project bootstrapped from
the migrations alone still gets them. The genuinely new thing is
**`products_org_sku_uidx`**, a unique **partial** index on `(org_id, sku) where
sku is not null`: a SKU is the key a scanner looks a product up by, so two
products sharing one within a workspace makes the scanner ambiguous. Partial,
because the overwhelming majority of rows have no SKU and NULLs must not collide.

That index is wrapped in a `DO` block that catches `unique_violation`. A database
that already contains duplicate SKUs (they were free text before today) would
otherwise fail the *whole* migration on one statement. Instead it emits a NOTICE
with the query that finds the duplicates, and everything else installs. Verified
live (§6, check 10).

### Two decisions worth arguing about

**Why the colour CHECK constrains the shape, not the membership.** The brief said
"a fixed palette". Pinning that list in SQL means a production migration every
time the founder wants one more colour. The column stores a palette *name*, so
nothing from the database ever reaches a style attribute; `LABEL_COLORS` in
`labelsService.ts` maps the name to a chip and renders an unknown name as the
neutral chip. The CHECK enforces "short lowercase slug" — real integrity, no
injection surface — and the client stays the authority on what is *offered*. A
test asserts every offered colour satisfies the DB's regex, so the picker can
never offer something that will not save.

**Why any member can write labels.** A label is shared shop vocabulary — a
vendor's name, a drop. A vocabulary only admins can extend is not shared. There
is no `is_org_admin()` gate anywhere in the file (contrast
`org_shopify_connections.sql`, where the token genuinely needs one).

`product_labels`' INSERT policy additionally proves the **product** belongs to
the caller's workspace, not just the join row: otherwise a member could tag
another workspace's product by guessing its id — the row would be invisible to
them, but it would exist, and the owning workspace's print sheet would render it.

---

## 3. Code 128, implemented here

`src/lib/barcode.ts`, ~150 lines of arithmetic that has not changed since
ISO/IEC 15417. Every JS barcode library is a dependency, a bundle and a
supply-chain surface for that. Nothing in the module touches the network, the
DOM, or Supabase — string in, string out.

**Subsets B and C, chosen automatically.** Subset A (control characters) is
deliberately *not* implemented: this encoder prints SKUs, which are ASCII 32–126
by construction, and an unused branch in a checksum is a place for a bug to live
unobserved.

**Subset selection** — C packs two digits per symbol, so a digit run pays for its
switch symbol at length 4:

* start in C when the leading digit run is ≥ 4, or the whole string is an even
  number of digits (the two-digit case the spec calls out);
* inside B, switch to C at any digit run ≥ 4, consuming an even number of its
  digits (an odd run leaves its last digit to be encoded back in B);
* inside C, switch back to B as soon as two digits are not available.

A run of exactly 5 is the same length either way; we take the switch.
Correctness never depends on the choice — only width does.

**Checksum**: `(start + Σ vᵢ·i) mod 103`, i from 1 at the first data symbol.

### How the 107-row table is proved correct

A single mistyped digit anywhere produces a barcode that still *looks* like a
barcode and scans as the wrong product. Three independent checks, all in
`barcode.test.ts` (42 tests):

1. **Spec properties** — 107 rows; 11 modules over 6 elements each (STOP: 13 over
   7); no element outside 1–4; all patterns distinct; and the symbology's own
   self-check, **every character's three bar widths sum to an even number and its
   three space widths to an odd one**. That parity catches almost any single-digit
   transcription error.
2. **Published anchors**, verbatim from any Code 128 reference:

   | Symbol | Pattern |
   |---|---|
   | Start A (103) | `11010000100` |
   | Start B (104) | `11010010000` |
   | Start C (105) | `11010011100` |
   | Stop (106) | `1100011101011` |
   | Value 0 | `11011001100` |

3. **A decoder written from the symbology, not from the encoder** — it run-length
   decodes our own module string back into symbol values, looks each up, and
   re-derives the checksum independently. Bar/space inversion, an off-by-one in
   the alternation, or a wrong width all fail here even when (1) passes. Run over
   13 inputs including `'~!@#$%^&*()_+{}|:"<>?'` and `'999999999999'`.

### Worked test vectors

| Input | Symbols | Checksum | Modules |
|---|---|---|---|
| `ABC123` | `104, 33, 34, 35, 17, 18, 19` | **67** (582 mod 103) | 8×11 + 13 = 101 |
| `12345678` | `105, 12, 34, 56, 78` | **47** (665 mod 103) | 6×11 + 13 = 79 |
| `AB1234567890CD` | B → **99**(→C) → 5 pairs → **100**(→B) → B | — | — |
| `A12345` | odd run: 2 pairs in C, last digit back in B | — | — |
| `A12` | short run, **no** switch | — | — |

**Rejections are loud, not silent.** Empty input, anything outside ASCII 32–126
(`CAFÉ`, a tab, an emoji), and >80 characters all throw. Dropping an unsupported
character would print a barcode that scans as a *different product*.

### SKUs

`ACD-` + 6 Crockford base32 characters — `0123456789ABCDEFGHJKMNPQRSTVWXYZ`.
I/L/O go because a SKU is read aloud across a table and typed off a printed
label, where 1/I/L and 0/O are the classic mistypes; U goes because Crockford
drops it so the alphabet cannot spell an obscenity by accident. 32⁶ ≈ 1.07
billion codes per workspace. `crypto.getRandomValues` with `Math.random` behind
it only so a non-browser test environment still runs; 256 is an exact multiple of
32, so the modulo introduces no bias.

**Uniqueness is the database's job.** `products_org_sku_uidx` is the authority;
`ensureSkus` retries on 23505 (budget 6, so a broken RNG surfaces as an error
rather than an infinite loop). Checking "is it taken?" with a SELECT first would
be a race, not a check.

**Scanned-input folding.** `skuLookupCandidates` returns the exact spelling
*first* and the confusable fold (I/L→1, O→0) *second*. Our own codes cannot
contain those letters, so folding is free accuracy on them — but it would
silently corrupt a manufacturer SKU that legitimately contains them, so it is a
second candidate, never an edit to the first. The prefix is never folded.

---

## 4. The three components

### `ListingLabelsPicker` — one listing's labels

Chips with colour dots; vendor labels first. **Mixed selections are
first-class**: a group's photos are separate `products` rows, so a label can
genuinely be on some and not others (a regroup, a partially-failed write). A chip
has three states — on, off, **partial** (`2/4`, dashed border) — and tapping a
partial chip **applies it to the rest** rather than clearing it. That is the only
reading of the tap that cannot destroy work.

Inline "New label": name, 12-swatch colour picker, "this is a vendor". A label
created from inside a listing is immediately applied to it. Pre-migration it
renders nothing at all.

### `LabelPrintView` — the print sheet

**Read-only on the workflow.** It consumes `workflowStore.processedItems` via the
same `useStoreItemArray` hook Step 3 uses and never writes an item back
(CLAUDE.md §18.11). The one mutation it performs is `ensureSkus`, which writes
`products.sku` directly and touches no in-memory item — so printing labels can
never disturb a batch mid-edit. Rows come from `buildGroupArray`, the same
leader-tolerant builder Step 3 navigates with, so the sheet and the description
screen cannot disagree about what a listing is.

Three stocks, in `src/lib/labelTemplates.ts` (a lib, not the component, because
the geometry is data — and because exporting a constant from a component file
breaks Fast Refresh):

| Template | Page | Grid | Label |
|---|---|---|---|
| 4" × 2" — 10 per sheet | 8.5×11, margin `0.5in 0.25in` | 2 × 5 | 4in × 2in, **no gutter** |
| Avery 5160 — 30 per sheet | 8.5×11, margin `0.5in 0.1875in` | 3 × 10 | 2.625in × 1in, 0.125in gutter |
| 2.25" × 1.25" thermal | 2.25×1.25, margin `0.06in` | 1-up | 2.13in × 1.13in |

**The geometry test caught a real bug on first run.** The 4"×2" template shipped
with an invented 0.19in gutter: `2 × 4in + 0.19in = 8.19in` against a 7.5in
printable width — the right-hand column would have run off every sheet. The two
columns butt together; 8in of label inside an 8.5in page leaves exactly 0.25in
each side. `labelTemplates.test.ts` now asserts that a full row plus gutters fits
the printable width, that a label is never taller than its page, and that a
generated SKU's barcode fits the narrowest label at that template's module width.

The template drives custom properties on one element, and those drive **both** the
on-screen sheet and the print stylesheet — so a preview that looks wrong *is*
wrong. At print time `body * { visibility: hidden }` plus a visible sheet removes
the app header, the ToolView title block, the controls and the pick list;
`break-inside: avoid` keeps a label off a page boundary; `print-color-adjust:
exact` stops the browser dropping chip backgrounds.

Each label prints: title (2 lines, clamped so a long title cannot push the
barcode off), size, price, the colour/word/vendor chips, and the Code 128 SVG
with the SKU underneath. Listings without a SKU print without a barcode and the
view says so in an amber banner with the count.

### `BarcodeScannerView` — three ways in

1. **Phone camera** via the browser's own `BarcodeDetector` (`code_128`), sampled
   every 160 ms — instant to a human, and it does not cook a mid-range phone.
2. **A USB/Bluetooth scanner**, which is just a keyboard: it types the code and
   presses Enter into the "scan here" field.
3. **Typing the SKU**, for the label that got scuffed.

**No polyfill.** The alternative is shipping a ~500 KB WASM decoder to everyone so
the minority on Safari/Firefox can use the camera, when (2) already covers them
with hardware they own. When the API is missing the view says so plainly and
points at the other two inputs.

**Camera lifecycle** is the part that bites: a `getUserMedia` stream that is not
stopped leaves the phone's camera light on after navigation. Every exit path —
stop button, unmount, an error mid-stream, a permission denial — goes through
`stopCamera`, which stops every *track* (pausing the `<video>` alone does not do
it). A `mountedRef` keeps a lookup that resolves after unmount from calling
setState. The same decoded value on consecutive frames is one scan, not N.

A hit renders the listing card — thumbnail (via `lib/storageUrls`), title, price,
size, SKU, label chips — plus **Open in Step 3** when App supplies the callback.

---

## 5. Mobile-first

The scanner is a phone feature and the print view gets used standing at a rack,
so: every interactive control is **≥ 44 px** tall (chips, swatch rows, icon
buttons, checkbox labels); every `<input>`/`<select>` is **`--fs-md` = 16px**,
below which iOS Safari zooms the viewport on focus and throws the user out of the
page; the scanner is one column below 760px and two above; the letter-width sheet
preview scales down rather than forcing a horizontal page scroll (a screen
concern only — print output is unaffected); `prefers-reduced-motion` disables
both spinners.

No hardcoded hex outside the label swatches, which are **data** (CLAUDE.md §1's
carve-out) and must survive a thermal printer, where a theme token does not
resolve at all. No emoji — `lucide-react` throughout.

---

## 6. Migration verification (throwaway Postgres 14)

Two clusters, ports 55441/55442, `initdb` into the scratchpad, applied
`stub2.sql` → `multi_org_tenancy.sql` → `beta_signups.sql` → `listing_labels.sql`,
each with `ON_ERROR_STOP=1`. **Both clusters stopped and deleted afterwards**
(`pgrep` clean, sockets gone, data dirs removed). No repo file changed by the
harness.

| # | Check | Result |
|---|---|---|
| 1 | Second apply idempotent | EXIT 0; 4+4 policies, 3+3 indexes, 2 tables, grants unchanged |
| 2 | `products.sku`/`.barcode` added to a table that lacked them | both `text`; `products_org_sku_uidx` present |
| 3 | Same org + same sku → 23505; two NULLs → both OK; different orgs + same sku → both OK | PASS |
| 4a | A inserts with no `org_id` → lands in A's org, `created_by` = A | PASS |
| 4b–d | B cannot see, insert into, update or delete A's label | 0 rows / 42501 |
| 4e | A moves a label to B's org | denied (42501) |
| 4f | A renames its own label | `UPDATE 1` |
| 5 | A tags **B's** product → 42501 (verified with products RLS both on and off, so the `exists(...)` with-check does the work itself); A tags its own → OK; duplicate → 23505 `product_labels_pkey` | PASS |
| 6 | `update product_labels` → permission denied for table | PASS |
| 7 | 41-char name, empty name, `AMBER`, `x`, 17-char colour, `kind='bogus'` all → 23514; `amber`/`vendor` OK; defaults `slate`/`custom`/`0` | PASS |
| 8 | `'Bad Kids Club'` vs `'bad kids club  '` same org → 23505 on `(org_id, lower(btrim(name)))`; different org → OK | PASS |
| 9 | Cascades: delete product → joins gone; delete label → joins gone; delete org → labels gone | PASS |
| 10 | **Duplicate-SKU degradation** on a fresh cluster: migration does **not** abort, emits the 3 NOTICEs, index absent, everything else installs; after fixing the dup and re-running, the index is created | PASS |
| 11 | Rollback → 0 tables, 0 policies, index gone, `sku`/`barcode` deliberately retained; clean re-install afterwards with isolation re-verified | PASS |
| extra | A stale table-wide UPDATE grant lets A write `org_id`; after re-apply the `revoke` closes it | PASS |

Two comments in the file were corrected as a result: PG 14 reports *"permission
denied for table listing_labels"*, not *"for column org_id"*, and the
`labels_update_product_labels` policy is unreachable (that table has no UPDATE
grant) — now stated in the file rather than left to be rediscovered.

Two harness-only compensations, not defects: `stub2.sql` grants `authenticated`
nothing on `products`, and RLS on the five data tables is enabled by
`schema.sql`, not by `multi_org_tenancy.sql`. Check 5 was run both ways.

One pre-existing behaviour noted, out of scope: `delete from organizations` is
blocked by `products_org_id_fkey` (tenancy FKs have no `ON DELETE`). Our two
tables cascade correctly; check 9c was isolated on an org holding only labels.

---

## 7. Deferred edits — exactly what the orchestrator applies

### (a) `src/App.tsx` — the exporter's pricing prop (**one line**)

App already holds `orgDescSettings`. At **line 3121**, add one prop:

```tsx
<GoogleSheetExporter ref={exporterRef} vendorName={resolvedVendorName}
  platformPricing={orgDescSettings?.platformPricing} items={step4ExportItems} />
```

That is the whole of Feature 21's wiring. (The exporter also accepts an `orgId`
prop and will fetch the settings itself if `platformPricing` is not supplied —
the fallback path, unused once the line above lands.)

### (b) `src/App.tsx` — the two new views

**b1.** Add to the `lucide-react` import (line 5): `Printer`, `ScanLine`.

**b2.** Lazy imports, beside the other views (~line 143):

```ts
const LabelPrintView = React.lazy(() => import('./components/LabelPrintView'));
const BarcodeScannerView = React.lazy(() => import('./components/BarcodeScannerView'));
```

**b3.** Extend the `ActiveView` union (~line 147):

```ts
export type ActiveView =
  | 'workflow' | 'library' | 'categories' | 'presets'
  | 'vocabulary' | 'analytics' | 'crm' | 'finance' | 'board' | 'workspace'
  | 'messages' | 'labels' | 'scan';
```

**b4.** Two entries in `navTools` (~line 2674), after `library` — available to
**every** workspace, not gated to founding admins:

```tsx
    { id: 'labels', label: 'Labels', icon: <Printer size={18} />,
      title: 'Labels — print shelf labels with barcodes for the open batch' },
    { id: 'scan', label: 'Scan', icon: <ScanLine size={18} />,
      title: 'Scan — find a listing by its barcode or SKU' },
```

They join the tablet rail, the phone tab bar and the More sheet automatically —
`navTools` is the single declaration (App.tsx's own comment says so).

**b5.** Two render branches, beside the other `activeView` blocks (~line 3288).
`goToWorkflow` and `ViewFallback` already exist; `onOpenListing` is the callback
in (c):

```tsx
      {/* Labels — print shelf labels for the open batch. Read-only on the
          workflow store; the only write is assigning SKUs to products. */}
      {activeView === 'labels' && user && (
        <Suspense fallback={<ViewFallback />}>
          <ToolView
            icon={<Printer size={26} />}
            title="Labels"
            description="Print shelf labels for this batch — title, size, price, your colour and vendor labels, and a scannable barcode."
            onBack={goToWorkflow}
            wide
          >
            <LabelPrintView onOpenListing={openListingInStep3} />
          </ToolView>
        </Suspense>
      )}

      {/* Scan — camera, USB scanner or typed SKU, back to the listing. */}
      {activeView === 'scan' && user && (
        <Suspense fallback={<ViewFallback />}>
          <ToolView
            icon={<ScanLine size={26} />}
            title="Scan"
            description="Point the camera at a label, use a USB scanner, or type a SKU to pull up the listing."
            onBack={goToWorkflow}
          >
            <BarcodeScannerView onOpenListing={openListingInStep3} />
          </ToolView>
        </Suspense>
      )}
```

### (c) `src/App.tsx` — `openListingInStep3` (optional but wanted)

Both views take `onOpenListing?: (productId: string) => void`. Without it they
still work; with it, a scanned label jumps to the listing. Minimal version — go
to the workflow and scroll Step 3 into view:

```ts
  /* A scanned/printed label identifies a PRODUCT row; Step 3 navigates by
     group. The product id IS the group leader's id for any listing these views
     show (LabelPrintView takes the leader; the scanner returns the row that
     owns the SKU), so PDG can select it directly once it accepts the prop. */
  const openListingInStep3 = useEventCallback((productId: string) => {
    setActiveView('workflow');
    setFocusListingId(productId);   // new useState<string | null>(null)
    requestAnimationFrame(() =>
      document.getElementById('step-3')?.scrollIntoView({ behavior: 'smooth' }));
  });
```

`focusListingId` then wants to reach `ProductDescriptionGenerator` as a prop that
sets `currentGroupIndex` to the group containing that id (PDG is another agent's
file — a ~6-line change there, or drop the prop and keep the scroll).

### (d) Step 3 mount for `ListingLabelsPicker`

In `ProductDescriptionGenerator.tsx`, inside the current-listing panel — the
natural home is directly under the voice/keyword block, above the generated
description:

```tsx
import ListingLabelsPicker from './ListingLabelsPicker';

// …where `currentGroup` is the ClothingItem[] for the listing on screen:
<ListingLabelsPicker productIds={currentGroup.map(i => i.id)} />
```

That is the entire contract: `productIds: string[]`, plus optional
`readOnly?: boolean` and `onChanged?: () => void`. The component owns its own
fetching, is a no-op pre-migration, and never touches `processedItems` — so it
cannot interact with the store patches in §18.11.

### (e) Run the migration

`supabase/migrations/listing_labels.sql`, in the SQL Editor, **after**
`multi_org_tenancy.sql`. Additive and idempotent; rollback at the bottom. Until
it is run, the labels picker renders nothing, the print view still prints titles
and prices, and the scanner says what is missing.

---

## 8. Files

**New**

| File | What |
|---|---|
| `src/lib/barcode.ts` | Code 128 encoder (subsets B/C), SVG, SKU generation, scanner-input normalization |
| `src/lib/barcode.test.ts` | 42 tests — table properties, published anchors, independent decoder round-trip |
| `src/lib/platformPricing.ts` | The pricing rule, rounding, slug, summary, JSONB normalization |
| `src/lib/platformPricing.test.ts` | 42 tests — both invariants exhaustively, rounding, malformed input |
| `src/lib/labelsService.ts` | Labels CRUD, assign/unassign, `ensureSkus`, `findProductBySku`, `LABEL_COLORS` |
| `src/lib/labelsService.test.ts` | 31 tests — chunking, `ignoreDuplicates`, 0-row writes, SKU retry, fold fallback |
| `src/lib/labelTemplates.ts` | The three label stocks + `usableWidthInches` |
| `src/lib/labelTemplates.test.ts` | 8 tests — the geometry that caught the overflowing template |
| `src/components/ListingLabelsPicker.tsx` / `.css` | Per-listing label chips with partial state |
| `src/components/LabelPrintView.tsx` / `.css` | Print sheet + `@page` stylesheet |
| `src/components/BarcodeScannerView.tsx` / `.css` | Camera / USB scanner / typed SKU |
| `supabase/migrations/listing_labels.sql` | Two tables, RLS, the SKU unique index, rollback |

**Modified**

| File | Change |
|---|---|
| `src/lib/descriptionSettings.ts` | `platformPricing` in the shape + defaults (`[]`), normalized on read |
| `src/lib/csvExport.ts` | Optional 4th `pricing` param on both builders; `Variant Barcode` falls back to the SKU |
| `src/lib/csvExport.test.ts` | +13 tests (pricing, SKU/barcode columns). **Golden snapshot untouched** |
| `src/components/GoogleSheetExporter.tsx` / `.css` | Platform selector, adjusted preview + CSV, filename slug, summary line |
| `src/components/OrgPanel.tsx` / `.css` | Marketplace pricing section |
| `supabase/migrations/listing_labels.sql` | Two comments corrected after the PG14 run |

---

## 9. Gates

| Gate | Result |
|---|---|
| `npm test` | **1014 passed / 51 files**, 0 failed. +136 from this work (42 barcode, 42 pricing, 31 labels, 13 CSV, 8 templates) |
| `npm run build` | Clean (`tsc -b` + vite, no new warnings) |
| `npx eslint .` | **252 problems — exactly the recorded baseline.** `eslint` on the 16 files I own: **0** |
| Golden CSV snapshot | Unchanged, not regenerated |
| Golden description snapshot | Unchanged |

Two `react-hooks` v7 errors were introduced and fixed properly rather than
suppressed: `LabelPrintView` stored *selection* and re-seeded it from an effect;
it now stores **de**selection, so "print everything" is the empty set and the
selection derives from `rows` on every render — no effect, no cascading render,
and listings that arrive after the first render are no longer silently dropped.
A label reload after assigning SKUs goes through a `reloadKey` bump so there is
one loader, not two copies of the fetch.

---

## 10. Not built, deliberately

* **Writing labels or SKUs to Shopify.** Publishing is still CSV; a write path is
  its own feature (CLAUDE.md §16).
* **Label assignment from Step 2.** The picker takes `productIds: string[]` and
  is already reusable for a multi-select, but Step 2 is another agent's file.
* **A label filter in Library.** The join table supports it; no UI yet.
* **Per-platform anything except price** (titles, categories, descriptions). The
  brief asked for price; the rule type is the seam if that grows.
* **Barcode formats other than Code 128.** UPC/EAN are check-digit systems for
  manufacturer codes; our SKUs are ours, and Code 128 encodes them exactly.

---

## Summary

- **Feature 21**: one listing price, per-marketplace rules applied at export
  time. No migration — it lives in the existing `description_settings` JSONB,
  default `[]`, so nothing changes until a workspace configures a platform.
- Two invariants are tested exhaustively: **$0 never adjusts** (or a platform
  choice would defeat the export gate), and **no rule can produce a
  non-positive price**.
- `buildShopifyCsv` took an optional 4th param; **the golden CSV snapshot is
  unchanged and was not regenerated**.
- **Feature 25**: `listing_labels` + `product_labels`, org-scoped RLS, plus a
  unique partial index on `(org_id, sku)` that degrades to a NOTICE instead of
  aborting when duplicates already exist.
- **Code 128 is ours** — no dependency. The 107-row table is proved three ways:
  spec properties incl. the even-bars/odd-spaces parity, the four published
  anchor patterns, and a decoder written from the symbology that round-trips it.
- Three components: a per-listing label picker with a genuine **partial** state,
  a print sheet for three real label stocks, and a scanner that works via
  camera, USB scanner, or typing — no WASM polyfill.
- The label **geometry test caught a real bug**: the 4"×2" template would have
  run off the right edge of every sheet.
- Migration verified on a throwaway Postgres 14: idempotence, cross-org
  isolation, immutable `org_id`, cascades, CHECK constraints, the duplicate-SKU
  degradation path, and rollback. Clusters destroyed.
- Gates: **1014 tests pass**, build clean, eslint **252 = baseline**, **0 on my
  files**. Nothing committed; App.tsx and Step 3 wiring is in §7.

---

## 11. §7 App wiring applied

`src/App.tsx` was released by the Step 2 agent and the §7 edits are now **applied**,
not deferred. App.tsx was re-read first; the Step 2 agent's autosave/restore
changes and its `saveStatus` reporting are untouched — every edit below is
additive. `ProductDescriptionGenerator.tsx` was **not** touched.

| # | Edit | Where |
|---|---|---|
| 1 | `Printer`, `ScanLine` added to the `lucide-react` import | line 5 |
| 2 | `LabelPrintView` / `BarcodeScannerView` lazy imports | 146–147 |
| 3 | `'labels' \| 'scan'` on the `ActiveView` union | 154 |
| 4 | `openListingInStep3` (`useEventCallback`) | 1670–1698 |
| 5 | Two `navTools` entries, beside Library | 2864–2865 |
| 6 | `id="step-3"` on the Step 3 section (scroll target) | 3230 |
| 7 | `platformPricing={orgDescSettings?.platformPricing}` on the exporter | 3313–3320 |
| 8 | Two `ToolView` render branches | 3536–3562 |

**Mobile surfaces — verified by reading `MobileNav.tsx`, not assumed.**
`mobileTools = navTools.filter(id !== 'messages') + workspace`, and it feeds both
`<NavRail>` (tablet) and `<MobileTabBar>` (phone). `TAB_IDS` is
`{'library','messages'}`, and the sheet is `tools.filter(t => !TAB_IDS.has(t.id))`
— so Labels and Scan appear in the tablet rail outright and in the phone **More
sheet** automatically, with no extra wiring. They are placed beside Library
because all three act on the open batch; Messages keeps its own tab and badge.

**Gating:** `activeView === 'labels' && user` / `'scan' && user` — **every
workspace member**, no founding-admin gate (contrast Vocabulary/Analytics/CRM/
Finance). Labels gets `wide`, because the sheet preview is a letter page and the
1400px reading measure would crop it.

### `openListingInStep3` — what it does, and the one thing it cannot

A scan identifies a `products` row; Step 3 navigates by **group index**, which is
state inside `ProductDescriptionGenerator` and has no prop to set it. So the
callback returns to the workflow and scrolls Step 3 into view. **Selecting the
scanned listing still needs a ~6-line PDG prop** (`focusProductId`, mapped
through `buildGroupArray` to an index) — PDG is another agent's file, so that
stays deferred, as §7(c) said it might.

What it refuses to do is *pretend*. If the scanned product is not in the open
batch, scrolling to Step 3 would park the user on an unrelated listing and look
like a successful jump — so it raises a toast naming the real situation ("find it
in the Library and open its batch first") and navigates nowhere. The membership
test reads `processedItemsRef.current`, the live store view, never a
render-captured array (CLAUDE.md §14).

### Gates after wiring

| Gate | Result |
|---|---|
| `npm test` | **1015 passed / 51 files** |
| `npm run build` | Clean. Both views are their own lazy chunks — `LabelPrintView` 7.47 kB + 5.51 kB CSS, `BarcodeScannerView` 7.56 kB + 4.20 kB CSS — so nothing new reaches the main bundle or the landing page's first paint |
| `npx eslint .` | **252 — unchanged from the baseline recorded before this wiring.** App.tsx's 41 pre-existing problems are all on lines ≤ 2678; none fall on any line added above |
| react-hooks v7 | Clean (`useEventCallback` for the callback, `requestAnimationFrame` for the deferred scroll, no setState in an effect) |
