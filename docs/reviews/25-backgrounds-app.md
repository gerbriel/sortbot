# 25 — Photo backgrounds: the app half

Sept 2026. The APP side of automated background removal: the preset, the job
submission, what Step 2 shows, how a person reviews a flagged mask without
reviewing every photo, and what the export does about it. The service itself
(`services/matting/`, its `CONTRACT.md`, the migration `image_backgrounds.sql`)
was built in parallel and is written up separately; this pass owns everything in
`src/` plus the CSP and the docs.

Nothing generative. A mask, a flat colour and a rectangle.

**Gates.** 1,898 tests / 83 files green (baseline 1,764 / 81 in this working
tree — 1,745 / 81 at HEAD before another agent's in-flight plan-management
work). `npm run build` clean; the "chunks larger than 500 kB" warning is
pre-existing. `npx eslint .` **252** — the recorded baseline, unchanged.

---

## 1. The division of ownership, which is the design

| | writes |
|---|---|
| **the service** | `cutout_storage_path`, `composite_storage_path`, `bg_preset`, `mask_score`, `mask_flags`, `mask_model`, `matted_at`, and the `queued` / `auto` / `review` / `failed` statuses |
| **the app** | `mask_status`, and only `approved` / `original` / back to `review`, and only when a person decided |

Everything else in this document falls out of that line. The app never writes a
path, a score or a flag; if it did, a re-run would have to reconcile two writers
over one row and the most useful property of the whole design — that the service
can be re-run over any photo at any time without asking the app anything — would
be gone.

`mask_status = null` is a seventh state and deliberately not a value in the
union: "never processed" and "processed and it failed" must not be the same
thing, or a retry sweep re-tries the failures for ever.

---

## 2. `resolveCatalogPath` — one rule, one place

```
composite when mask_status is 'auto' or 'approved'   (and a composite exists)
original    for everything else
```

That is the whole rule, and it lives in exactly one function
(`src/lib/backgroundService.ts`). The Step-2 grid, `GoogleSheetExporter`'s
`resolvePublicUrl`, `MarketplaceExport`'s `resolveUrl`, every pack and every
photo zip call it. Same argument as §18 #20 for Storage URLs: re-deriving it
inline is how a thumbnail and a shipped CSV start disagreeing about which file a
listing has, and the shipped CSV is the one you find out about after an import.

Three things it does that are easy to get wrong and are tested exhaustively:

- **It must be consulted BEFORE `imageUrls[0]`.** That field always points at
  the original, so a fallback chain that reaches it first exports the un-matted
  files from a fully matted batch.
- **An `auto`/`approved` row with no composite falls back to the original.** It
  should not happen; a dead path in a shop's catalogue is worse than an
  un-matted photo.
- **`failed` and `original` resolve to the original and block nothing.** Both
  are settled answers. Only `review` and `queued` are unsettled, and those are
  what `isBackgroundBlocking` reports.

---

## 3. The preset, and the hash both sides compute

`BackgroundPreset` lives in `description_settings.background` — the JSONB
`org_description_settings.sql` already added, so **no migration**, for the same
reasons `platformPricing` lives there: per-workspace presentation policy, edited
on the same Settings tab. And like `platformPricing` it is normalised on every
read, because it is free-form JSON driving an unattended image pipeline: a junk
`padding` has to mean "the default margin", never a crash and never a 400-pixel
border.

`presetHash` is the cross-language contract. Canonical JSON, six keys
alphabetically, no whitespace, colour upper-cased, `id` excluded, padding at
most 3 decimals. **The canonical STRING is exported and asserted in full**, not
just its digest — when the two sides disagree, a human needs something to diff.

| # | preset | canonical JSON | hash |
|---|---|---|---|
| 1 | defaults | `{"anchor":"center","canvas":2048,"color":"#FFFFFF","padding":0.1,"quality":90,"shadow":false}` | `7abc910f` |
| 2 | `{canvas:1536,color:'#f4f4f4',padding:0.08,anchor:'top',shadow:true,quality:85}` | `{"anchor":"top","canvas":1536,"color":"#F4F4F4","padding":0.08,"quality":85,"shadow":true}` | `c7e0869c` |
| 3 | `{padding:0.100}` | identical to 1 | `7abc910f` |

Computed independently on both sides and identical. `crypto.subtle` is async, so
`presetHash` is too — a hand-rolled SHA-1 to avoid an `await` would be a second
implementation of the one thing that has to match byte for byte. When
SubtleCrypto is unavailable it returns `''`, and the caller then treats every
composite as "preset unknown" rather than "preset stale": nothing is re-run
behind the user's back.

---

## 4. The thing that would have quietly destroyed the feature

`registerItemsInDB` deletes every `product_images` row for the batch and
re-inserts them from in-memory items. It runs on **every batch open and every
startup restore**. The mask columns are not the app's to author — so a
whole-row replacement erases a batch's cut-outs, scores and flags on the next
refresh, and nothing but a full re-run can bring them back.

Two halves, and both are needed:

1. `buildProductImageRow` carries the background block, but **only once
   `backgroundColumnsAvailable()` has seen the columns** — naming an unknown
   column fails the entire upsert with PGRST204, and this is the one query the
   app cannot afford to break before the migration runs.
2. `mergeProductImageRows` → `carryBackground` preserves the existing row's mask
   columns **per column** wherever the computed row has nothing to say. Per
   column, not all-or-nothing: a restored item carries three of the six fields
   (the `slimForWorkflowState` whitelist) and one hydrated before the background
   read lands carries none, so a row that knows its `mask_status` and nothing
   else must not read the absence of `mask_score` as an instruction to clear it.

**Caught while reading the service's migration:** `mask_flags` is
`not null default '{}'`. The first version of the writer emitted
`item.maskFlags ?? null`, which would have failed every insert the day the SQL
ran. It writes `[]` now, and `carryBackground` reads an empty array from the app
as *absence* — the app is not the author of that column, and the existing row
was read moments earlier, so it is always the newer answer.

That probe is deliberately separate from `backgroundsAvailable()`: this one asks
only "do the columns exist". A workspace whose matting service is unconfigured
or down must still carry existing mask state across the wipe.

Also in the persistence seam: `slimForWorkflowState` gained exactly three fields
(`productImageId`, `compositeStoragePath`, `maskStatus`). They look derivable
and are not at the one moment that matters — startup restore sets all four
arrays from the blob and fires `registerItemsInDB` immediately, before any
background row has been read. Without them the first paint after a reload shows
every composited photo as its original, and Step 4's gate reads "nothing to
review" on a batch with forty photos waiting. The score, flags, cut-out path and
preset hash are *not* persisted: they are only read on a photo the reviewer has
opened, which is always after the row read has landed.

---

## 5. Step 2 — reviewing four photos, not four hundred

That sentence is the feature. The service scores its own masks; `auto` passes
silently and only `review` and `failed` ever ask for anything. So:

- badges on the flagged cards **only** — a badge on every one of 400 cards is a
  badge on none of them;
- a one-tap **Needs review (N)** chip in the Filter panel;
- Left/Right in the lightbox walks the **review pool** (every flagged photo in
  the batch, groups included) while that filter is on, so four decisions cost
  four taps;
- a closed pile shows ONE badge for the whole group — the leader's photo can be
  clean while a sibling is flagged, and a pile that says nothing is findable
  only through the filter.

**`Backgrounds ▾` is the third popover on the same `openPanel` mechanism**, and
like the other two it is **not portaled**: `.grouper-toolbar` is on the
click-outside-deselect safe list, so a portaled panel wipes the selection on
every click inside it. The idle toolbar row stays one line — measured 34px at
1280, unchanged from before this pass.

**There is deliberately no "Approve all unflagged".** An `auto` photo already
exports its composite; such a button would set a column and change nothing. What
is worth a bulk action is the flagged pile, in either direction — Approve all N,
or Keep originals — both two-step `ConfirmAction`s, and both settle the gate.

**Re-apply excludes `original`.** The person said "do not use a cut-out on this
photo"; a new backdrop colour is not a reason to ask them again.

App owns the join (`refreshBackgroundRows`), not ImageGrouper, because two
surfaces need the same answer: Step 2's review and Step 4's export gate, which
reads `step4ExportItems`. Two readers with two fetches is two lists that
disagree about whether a batch is ready to export. It patches all four arrays,
keeps an item's identity when nothing changed (so the memo'd children bail out),
and deliberately does **not** auto-save — the three persisted fields ride along
on the next save of their own accord, and firing a 2 s debounce on every poll
tick of a 400-photo job would re-upload the whole blob a dozen times for values
the database already holds.

---

## 6. The export gate is the $0 price gate's twin

While any photo is `review` or `queued`, the Shopify CSV download is blocked
with a banner in the same style, and `withBackgroundIssues` adds
`{ level: 'error', field: 'photos' }` per affected listing so **every
marketplace feed is blocked by the same rule** — an `error` is what
`summarizeMarketplace` turns into `blocked`, which is what refuses the download.

Two details that matter:

- the message is a **constant**, so `summarizeMarketplace` collapses it into one
  checklist line with a count instead of N near-identical lines (the per-listing
  count is already in the cell);
- the gate is applied to the adapters' **output**, not inside any of the ten. It
  is our rule, not a marketplace's, and one `withBackgroundIssues` cannot be
  implemented nine different ways.

`failed` and `original` do not block. Letting them through as a warning instead
would mean shipping a feed built from whichever photo happened to be current,
which is the one outcome nobody can undo after an import.

---

## 7. CSP

`connect-src` gains `https://matting.arcadian.ltd`, named exactly rather than
wildcarded — it is the one origin in the policy that is ours rather than
Supabase's, and a wildcard covers a subdomain nobody audited.

Local development needs `http://localhost:8080`, which the production policy
must never carry. `vite.config.ts` gets a `apply: 'serve'` `transformIndexHtml`
plugin — the mechanism AGENTS §9 already named for exactly this situation.

**Its regex is anchored on `connect-src 'self'`, not on the bare directive
name.** The rationale comment above the meta tag also contains the words
"connect-src" and a semicolon, so a looser pattern rewrites the *comment* and
leaves the real policy untouched — silently, which is the whole failure mode the
plugin exists to avoid. Verified both ways: the dev server serves
`… wss://*.supabase.co https://matting.arcadian.ltd http://localhost:8080
ws://localhost:8080`, and `dist/index.html` carries no localhost.

---

## 8. What the screenshots showed

Four fixtures injected into the live dev page (which loads the real CSS bundle)
at 1280 and 390. `docs/reviews/img-25/`.

Three real defects, all fixed:

1. **`.ptb-btn--ghost` is the *danger* ghost** in this file — red text, danger
   border. "Show them" and "Re-run at 2K" were using it and rendered as
   destructive actions. Both are plain `.ptb-btn` now.
2. **The Before/After toggle showed no active state.**
   `ProductDescriptionGenerator.css` is imported *after* `ImageGrouper.css` (the
   crop-fs-\* styles are shared with Step 3) and redefines `.lightbox-tool-btn`
   at (0,1,0) — so a single-class rule here loses the cascade to a stylesheet
   that knows nothing about this control. Measured: both buttons read
   `rgb(233,233,233)`. Raised to (0,3,0); "After" is now black-on-white.
3. **On a phone the lightbox toolbar ran off both edges**, putting Before/After
   — the one control a reviewer needs there — furthest off screen. It was
   already too wide before this pass (Rotate L and Copy Crop were cut off);
   bounding it to `calc(100vw - 1rem)` with horizontal scroll fixes the
   pre-existing overflow too, `overflow-y: hidden` pinned so the pill cannot
   trap a vertical swipe.

Two smaller adjustments from looking: the two bulk-verdict buttons wrapped into
a ragged row inside a ~280px panel and are now a full-width stack; the `queued`
badge at `--ink-700` was barely visible on a beige photo and moved to
`--text-muted` with a white glyph, matching the weight of the other two.

**Measured.** Idle toolbar row 32px (toolbar block 34px) at 1280, one line,
`scrollWidth === clientWidth` on the row. At 390: `documentElement.scrollWidth
=== clientWidth === 390` on all four fixtures, **zero sub-44px targets**, every
form control at 16px.

---

## 9. Owed / not done

- **Nothing has been seen signed in, and nothing has been run against real
  rows.** `image_backgrounds.sql` is not run, the service is not deployed and
  `VITE_MATTING_URL` is unset, so what ships today is the feature hiding itself.
  The first real run is the test: process one small batch, check the composites
  in Step 2, confirm the gate blocks and then releases.
- **The Workspace → Settings section was not screenshotted.** `OrgPanel` is
  `React.lazy`, so its CSS is not on the dev landing page and the injection
  method cannot reach it. Its markup and rules were read, not rendered.
- **The polling is a fixed 4 s with no backoff.** Fine for a batch that takes a
  minute; a 1,500-photo run is ~375 polls. Worth a backoff if that becomes real.
- **`bgStale` needs `bgPresetHash`**, which resolves asynchronously — so for the
  first frame after mount nothing looks stale. That is the safe failure (nothing
  is offered for re-run that should not be) but it does mean the count appears a
  tick late.
- **Not built, deliberately:** per-listing background overrides (the recipe is
  per workspace), a background in Step 3's preview (Step 2 owns the review), and
  any automatic re-run on a preset change — "Re-apply to N" is always a
  deliberate press.

---

# Round 2 — what the first real run taught us

Sept 2026. The founder processed photos in production and three things came back
at once: every row `failed` with `mask_flags =
["error:RuntimeError: replicate create failed (429)"]` and a UI that said only
*"1 could not be processed"*; rows left `queued` for ever when the host stopped
an idle machine mid-run, with no press left anywhere that could pick them up;
and a request — *"want to be able to upload a few photo backdrops to replace
background as well, not just colours."*

**Gates.** 1,949 tests / 83 files green (1,898 / 83 at the start of this round —
**+51**, no file added). `npm run build` clean; the "chunks larger than 500 kB"
warning is pre-existing. `npx eslint .` **252** — the recorded baseline,
unchanged.

---

## R1. Show the reason

The reason was in the database the whole time. Three places now read it, from one
pure helper each:

| Where | What it shows |
|---|---|
| card badge `title` | `Could not be processed: <reason> — this photo exports untouched` |
| lightbox review strip | the reason on its own line, plus the hint, plus any heuristic flags as bullets |
| `Backgrounds ▾` panel | the reason **once**, under the counts, when every failure agrees |

**`maskFailureReason` passes the text through, and that is the point.** It does
exactly two things to it: a bare machine token with no spaces (`fetch_failed`,
`no-mask`) becomes words, because that is the shape the older flags took; and a
leading Python exception class (`RuntimeError: `, `HTTPError: `) is dropped,
because it is the one part of the string a reseller can neither read nor act on.
Status codes, vendor names, brackets and an em dash the upstream put there all
survive verbatim — **a message we do not understand is exactly the message worth
showing whole.** The label's separator is a colon rather than the em dash the
other flags use, because these messages frequently contain an em dash of their
own and two in one line reads as a sentence that lost its verb.

**`sharedFailureReason` returns null unless every failed photo agrees.** The
normal case is that they do — the causes are shared (no credit, service down,
backend rate-limiting) — and one line is then worth more than forty identical
ones. When they disagree, or when any failure said nothing, the panel keeps its
bare count rather than picking one photo's story to tell for all of them.

**`backgroundFailureHint` names one fix and only one.** If the reason matches
`/credit|billing/i`, the panel adds *"Add credit to the Replicate account, then
Process again."* There is deliberately no generic "try again later" — a hint that
fires on everything is chrome, and the reason line already says what happened.

Two supporting changes were needed for any of this to reach the screen:

- **`App.refreshBackgroundRows` compares `mask_flags` by CONTENT.** Its
  "unchanged, keep the identity so memo'd children bail out" test read four
  fields and not the flags. Identity would have been wrong (two equal arrays from
  two reads are never `===`, so every refresh would rebuild every item and defeat
  the memo); leaving it out meant a **re-run that returns the same status with a
  different reason never re-renders**, which is precisely what the new line
  depends on. A joined-string compare is both cheap and correct.
- **A `failed` photo now reaches the lightbox review strip.** It has neither a
  composite nor a cut-out, so `lbReviewable` excluded it and the one surface big
  enough to read a sentence said nothing at all about the photos that most needed
  explaining. Approve and Keep original are hidden there — there is nothing to
  approve, and "keep the original" is already what a failed photo does — leaving
  **Re-run at 2K** as the only offered action, which is the only move there is.

## R2. Never strand a photo

The service's job state is in memory, on a host that stops an idle machine after
a few minutes. Two independent failures followed from that, and both are now
closed by rules that are pure functions:

**`isProcessableStatus(status, jobRunning)`.** `queued` is processable *unless
this session is watching a job* — either it is a row the live job is working on
(leave it alone) or it is one a previous run abandoned, which nothing else in the
UI could ever pick up. The service re-accepts a `queued` row on submit, so
offering it is safe. The button's line names them: *"Including 2 left in flight
by an earlier run."* A test asserts this agrees with `summarizeMaskStatuses`'s
`processable` count when idle — that count has included `queued` since the
beginning, and the two disagreeing by exactly the stranded rows is how this bug
hid in plain sight.

**`isJobGone(result)` — a 404 is not an error.** It means the counter was lost
while the rows it was counting are still sitting there. The poll ends with *"The
service restarted — press Process again to continue."*, refreshes the rows, and
**stops** — a lost job never comes back, and retrying for ever is how the bar sat
at 0/12 with nothing to show for it. A network failure carries no status and is
deliberately NOT treated as gone, so it keeps its own message.

## R3. Photo backdrops

`BackgroundPreset.backdrop: { storagePath, fit: 'cover' } | null`, default null.
The workspace's library is `description_settings.backdrops` (≤ 8). Full shape and
reasoning in AGENTS §7; the decisions worth repeating here:

- **The preset names one backdrop; the library is the shelf.** Separate because a
  path is not a name — without the library, Step 2 and Settings could only print
  a uuid at the seller.
- **`<uuid>/backdrops/<file>`, or dropped.** The string is fetched by a service
  holding the service role, so a shape we did not write is not something to guess
  at, and the uid prefix means the existing storage policies already cover these
  files. Files go through the crop tool's own `uploadFileToPath` after a canvas
  downscale to 2048px at JPEG 0.9; a source over 4 MB is refused in a sentence
  rather than quietly resized.
- **Add and Remove save the JSONB immediately**, unlike the text fields beside
  them. The file write has already happened, so the library is the record of a
  side effect — leaving it pending would mean a chip that vanishes on reload with
  an orphan file behind it. It is the same one write the Save buttons make, with
  the same object, so nothing can half-apply. (`handleSaveDescSettings` was split
  into `buildDescSettings` + `persistDescSettings(override, message)` for this;
  the three existing Save buttons are unchanged.)
- **Remove deletes the ROW first, then the file** — an orphan file is
  recoverable, a library row pointing at a deleted file is not — and the file goes
  through `filterUnreferencedStoragePaths` even though a backdrop can never be a
  product image, because that is the one storage-delete path in this app and it
  fails safe (§18 #15). The raw `supabase.storage.remove` became
  `productService.deleteStorageFiles`, a named seam beside the uploaders.
- **Removing the backdrop the preset uses resets the preset to the flat colour
  and says so.** A dangling path must not survive: §18 #52's spirit says a
  missing backdrop fails loudly at the service, and that is correct behaviour for
  a missing file — but it is the wrong way to *change a setting*.
- **The hash gained a seventh key** and every vector moved, once:
  `6300e6dc` / `a4c629a4` / `6218c54a`, with `7abc910f` and `c7e0869c` retired.
  Nothing had been processed under them. `fit` is excluded from the canonical
  string because there is one mode; a second one must add it, since two
  differently-fitted composites do not look the same.

## R4. What the screenshots showed

Two fixtures at 1280 and 390, injected into the live dev page — and for the
Settings section, `OrgPanel.css` + `ToolView.css` injected with them, which is
what Round 1 could not do (`OrgPanel` is `React.lazy`, so its CSS is not on the
landing page). `docs/reviews/img-25/bg-settings-{1280,390}.png`,
`bg-fail-{1280,390}.png`.

Three real defects, all fixed, all only visible rendered:

1. **The backdrop rows ran 1,500px wide with their content floating mid-row.**
   Two causes at once: `index.css` centres the content of *every* `button`, so
   `.bd-pick`'s thumbnail and name sat in the middle of the row; and
   `.bg-controls` is `flex: 1 1 26rem`, which on a 1600px page stretched a
   3.6rem thumbnail and a Remove button to opposite ends of the screen.
   `justify-content: flex-start` and `max-width: 34rem` (matching the
   `22rem` cap the sliders above already use).
2. **The in-use tick floated between the name and Remove.** `.bd-meta` now
   grows, so the tick lands at the end of the row where a status belongs.
3. **`.bgp-swatch` hung between two lines** in the Step-2 panel: naming the
   backdrop pushed that line to two, and a 12px square centred against a
   two-line block lines up with nothing. `align-items: flex-start` plus a 2px
   optical offset puts it on the first line.

**Measured.** `documentElement.scrollWidth === clientWidth` on all four
fixtures. At 390: zero sub-44px targets except the range sliders and the
checkbox (excluded from the floor by `index.css`, §1), and every form control at
16px. `.bgp-fail` resolves to `rgb(179, 0, 27)` — `--danger`, not a literal.

## R5. Owed / not done

- **Still nothing seen signed in, and nothing run against real rows.** These are
  fixtures with the real stylesheets, which proves the cascade and not the React
  wiring. The first real run is still the test — and this round exists because
  that run found three things a code read did not.
- **The backdrop is not applied in the SERVICE yet** in this repo's app half:
  the contract is written (`backdrop` in the preset, in the canonical string, in
  the three vectors) and the parallel pass owns `services/matting/**`. Until both
  halves ship, choosing a backdrop changes the hash — which correctly makes
  existing composites stale — and the composite itself is whatever the deployed
  service builds.
- **`BACKDROP_MAX_BYTES` is checked on the SOURCE file, not the encoded result.**
  Deliberate: the downscale turns anything reasonable into a few hundred KB, so a
  file over the limit is a sign the wrong thing was picked, and saying so beats
  quietly resizing a 20 MB raw export on a rural connection.
- **A backdrop uploaded and then never saved cannot happen**, but a workspace
  that removes a backdrop while offline will keep the file: the row goes first
  and the storage delete is best-effort. That is the right order and the leftover
  is a few hundred KB.
- **The billing hint names Replicate**, which is the backend the service runs
  today. If that ever changes, this string and the service's error text change
  together — the hint is keyed on the word "credit" or "billing" in the reason,
  not on the vendor.
