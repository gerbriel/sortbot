# 12 — Step 3 field hygiene, brand spelling, sizes, saving: implementation log

Seven founder reports (9, 11, 14, 17, 23, 26, 28). Every root cause was traced in
the current source before anything changed. Nothing was committed.

Builds on `11-step3-voice-fixes.md`: the speech parser now lives in
`src/lib/voiceGrammar.ts`, PDG reads `workflowStore` directly, and both save
paths read the group back out of the live store. Those are the foundations three
of these fixes stand on.

Files owned by concurrent agents (`App.tsx`, `productRow.ts`, `productService.ts`,
`csvExport.ts`, `GoogleSheetExporter.tsx`, `categoryPresetsService.ts`,
`descriptionSettings.ts`, `ImageGrouper`, `Library`, `OrgPanel`) were **read but
not touched**. Report 23's remaining half lands in two of them — §"Deferred".

---

## 9 — "Don't include word description or field names in the field inputs" — **CONFIRMED**, two distinct leaks

### Leak A — the extractor's boundary lists had drifted (the live one)

`extractFieldsFromVoice` gives every field its own hand-written copy of "stop the
value at the next field title". All eleven copies were missing the same seven
titles: `description`, `note`, `chest`, `hip`, `rise`, `leg opening`, `type`
(`textAIService.ts:182,190,216,226,239,251,259,267,275,283,291` at HEAD).

So with no "period" spoken — which the new grammar explicitly allows —

```
"brand nike chest 22"        → brand = "Nike Chest 22"
"brand nike description ..." → brand = "Nike Description ..."
```

and the same for model, colour, material, condition, era, style, type, gender and
price. `FIELD_BOUNDARY_RE` (the guard *inside* `extractCommand`) had the same
gap.

**Fix.** One alternation, built from the live parser's own vocabulary so the two
can never disagree again:

```ts
const MEASUREMENT_TITLES = [...keys of VOICE_KEYWORD_TO_FIELD starting meas_, 'pit…pit', 'p2p'];
const PLAIN_TITLES       = [...the rest, 'model', 'type'];
const NEXT_TITLE_LOOKAHEAD = `(?=\\s+(?:${PLAIN_TITLES})\\b|\\s+(?:${MEASUREMENT_TITLES})\\s+\\S*\\d|$)`;
const nextFieldRe = (head: string) => new RegExp(`${head}(.+?)${NEXT_TITLE_LOOKAHEAD}`, 'i');
```

All eleven fallbacks and `FIELD_BOUNDARY_RE` now derive from it
(`textAIService.ts:113-145`).

**Measurement titles are digit-gated** — the same "plausible value" rule the live
grammar uses to decide whether a title may interrupt a description. Without it,
completing the lists would have *introduced* a regression: `style hip hop` would
end at `hip` and `high rise` at `rise`, both ordinary vintage-resale vocabulary.
Measurements are always dictated with a number, so the gate costs nothing. This
is a deliberate, documented divergence from the live parser, which has no such
gate (changing it there would break spoken-word measurements like
"chest twenty two" — out of scope, and noted for the orchestrator).

**One list was deliberately NOT widened**: the description's own no-period
fallback (`textAIService.ts:190`). The description is the single field whose
value legitimately contains field titles ("long sleeve", "boxy style", "care
label") — widening it re-opens the exact regression the July 2026 voice overhaul
fixed. Comment added in place so the next reader does not "complete" it.

### Leak B — nothing stripped a title that had already got in

`stripLeadingFieldTitle` existed but hard-coded `description|note` and ran only in
`generateProductDescription`'s merge, so it healed exactly one field.

**Fix.** `stripFieldTitlePrefix(fieldKey, value)` in `voiceGrammar.ts:135` —
repeat-strips a field's **own** titles (and its synonyms: `colour` for `color`,
`fabric` for `material`), returns `''` for a value that was nothing but the title.
Applied at three layers:

| layer | site |
|---|---|
| every voice write | `parseVoiceChunk`'s `emit` + `flushVoiceState` |
| every extracted value | the sweep before `return extracted` |
| legacy stored data | `stripLeadingFieldTitle` now delegates to it |

**Only the field's OWN titles are stripped, and that is a design decision, not an
omission.** "Care Bears", "Second Skin" and "Size?" are real labels; stripping
another field's title from a value would destroy them. Other titles are kept out
structurally, by Leak A's boundary work. The report asked for "its own field
title or any other field title" — the second half is satisfied by construction,
and the tests assert it end-to-end rather than by stripping.

**Tests.** `voiceGrammar.test.ts` +44 — including **one case per entry in
`VOICE_KEYWORD_TO_FIELD`** (all 39 titles) asserting the written value equals the
value and starts with no title at all; plus the "Care Bears" guard, the
mid-string mention, and the flush path. `textAIService.test.ts` +4 end-to-end
through `generateProductDescription`, including the `style hip hop` non-regression.

---

## 11 — "Titles don't include small words like of, its, a, the etc." — **CONFIRMED**

**Root cause, two halves.** `generateTitleFromFields`' description-keyword path
(`textAIService.ts:1365` at HEAD) filtered a 49-word `STOP_WORDS` set. It was
missing whole closed classes — pronouns (`they`, `them`, `their`, `you`, `my`),
auxiliaries (`am`, `being`, `do`, `did`, `will`, `would`, `can`, `should`),
conjunctions (`but`, `if`, `than`, `because`, `while`), prepositions (`after`,
`before`, `between`, `during`, `through`) — and a long tail of contentless
evaluatives.

**And `it's` could never have been filtered**, because the apostrophe is not in
the punctuation class the normaliser strips (`[,;:.!?()\-\/]`), so `it's` arrived
as one token that no entry matched. The founder named that exact word.

**Fix.**
- Possessive `'s` dropped and other apostrophes turned into word breaks, *before*
  the stop-word pass.
- The set rebuilt by grammatical class — articles/determiners, conjunctions,
  prepositions/particles, pronouns/possessives (`its` **and** `it's`),
  auxiliaries, degree adverbs and intensifiers.

**Five words that look closed-class are deliberately absent, with the reason in
the source:** `over`/`under` ("all over print", "over dyed"), `made` ("made in
usa", "union made" — and `made in usa` is a shipped descriptor chip),
`right`/`left` ("right chest hit") and `bad` ("Bad Boy"). They carry real meaning
in resale vocabulary.

**`fitTo60` needed no change.** It swaps synonyms between members of
`TITLE_SYNONYMS` / `ITEM_TYPE_SYNONYM_GROUPS`; I read every group and none
contains a bare function word, so it cannot *introduce* filler. The only filler
route into a title is the description-keyword path above. (The structured-formula
path assembles named tokens only — size, era, brand, style, decade, item.)

**GOLDEN SNAPSHOT UNCHANGED.** The golden context has no `customDescription`, so
it never enters this path. Verified, not assumed.

**Tests.** `textAIService.test.ts` +4 — a sentence of pure filler produces a title
with none of it; the descriptive words and the brand survive; `it's` specifically;
and the domain words that must be kept.

---

## 14 — Brand spelling memory — **feature, built**

Speech-to-text returns the English word it heard, and clothing labels are
deliberately misspelled: *Ecko Unltd* → "echo unlimited", *Fubu* → "foo boo",
*Le Tigre* → "la tiger". The wrong string then flows into the title, the tags and
the CSV, and the seller retypes the same correction on every listing.

### Design

**`src/lib/brandSpelling.ts` — pure, dependency-free.**

- `normalizeBrand` — case, accents, `&`/`and`, apostrophes, punctuation.
- `levenshtein` / `similarity` — two-row DP, no dependency.
- `phoneticCode` — Soundex with a metaphone-style digraph pass in front
  (`x`→`ks`, `kn`→`n`, `wr`→`r`, `ph`→`f`, `ck`→`k`, `sch`→`sk`, and a hard/soft
  `c` fold). **The `c` fold is the one that earns its place**: plain Soundex keeps
  the first *letter* verbatim, so `Kappa` and `Capa` — the single most common way
  a recogniser mangles a label — would never pair.
- `brandSimilarity` — **word-aligned, not whole-string**. This is the crux. "echo
  unlimited" → "ecko unltd" is 6 edits over 14 characters (0.57, under any sane
  threshold), because the abbreviation is concentrated in *one* word. Per word it
  is a perfect phonetic hit on *echo/ecko* and 0.75 on *unlimited/unltd* → **0.87**.
- `rankBrandMatches` / `resolveHeardBrand` — candidates from (1) the workspace's
  saved aliases, (2) `brand_keywords`, (3) the built-in library; ties broken in
  that order. `SUGGEST_THRESHOLD = 0.72`.

Four outcomes, and which one fires is the whole UX:

| outcome | when | what Step 3 does |
|---|---|---|
| `applied` | exact hit on a saved alias's `heard` | rewrites the field, "Corrected … · Undo" |
| *nothing* | the heard spelling **is** a known brand | says nothing |
| `suggestion` | strong phonetic/fuzzy, nothing saved | "Did you mean …?" Use / Ignore — **field untouched** |
| *nothing* | no candidate over threshold | says nothing |

**`supabase/migrations/brand_aliases.sql`** — `(org_id default default_org_id(),
heard, preferred, created_by, created_by_email, created_at, updated_at)`, unique
on `(org_id, lower(btrim(heard)))`, org-membership RLS on all four verbs with
**no admin gate** — this is one shop's record of its own inventory, so any member
maintains it (contrast `vocab_tables.sql`, which is founder chrome behind
`is_beta_admin()`). Authorship is pinned on INSERT and made immutable by column
grants, exactly as in `kanban_board.sql`. Additive, idempotent, rollback at the
bottom (which deliberately does **not** drop the shared `my_email()`).

**`src/lib/brandAliasService.ts`** — fetch / save / delete, `'unavailable'`
pre-migration so the entire surface hides. `saveBrandAlias` is find-then-update
rather than upsert, because the uniqueness is on an *expression* index that
PostgREST cannot address with `onConflict`, and because `org_id` must never be
sent from the client. A 23505 from a double tap is treated as success.

**`builtinBrandCandidates()`** dynamic-imports `builtinBrandVocab` — and is only
consulted **after** the two cheap sources fail to produce a confident match, then
cached for the session. Confirmed in the build output: `builtinBrandVocab` is
still its own 361 kB chunk and is not in `index.js`.

### UX

**`src/components/BrandSpelling.tsx`** (+ CSS, tokens only, no literal colours),
rendered under the Brand field via a new `brandExtra` slot on
`ComprehensiveProductForm`:

- the three notices above;
- **"Remember 'echo unlimited' → 'Ecko Unltd' for this workspace"** — offered when
  the seller types over a brand that *came from voice* (`heardBrandRef` maps group
  id → the raw spelling voice wrote), and also right after accepting a suggestion;
- an inline **Brand spellings** manager — list, add, inline edit of the
  preferred spelling (re-saving the same `heard` re-points it, so edit is the
  add path in place rather than a second one) and two-step delete (`confirmKey`,
  no `confirm()`), reachable by **any member** from the brand field. `variant="full"` renders the same manager as a new **Brand spellings**
  tab in the Vocabulary dashboard, where the scope badge flips to "this workspace
  only" because — unlike the other three tabs — these rows are not global.

**One flicker worth naming.** The grammar writes the tail of every utterance
optimistically, so a half-spoken "nik" scores 0.75 against *Nike* and raises "Did
you mean Nike?" a beat before "nike" arrives and answers it. A resolution that
finds the brand already correct now clears a standing suggestion (a pending
*remember* offer is the seller's own decision and is left alone).

**Tests.** `brandSpelling.test.ts` (35) — normalisation, Levenshtein incl. the
textbook `kitten/sitting`, phonetic pairing *and* separation, the report's
`echo unlimited` case, false-positive guards (`nike`/`dickies`,
`carhartt`/`champion`, `polo ralph lauren`/`tommy hilfiger`), ranking, source
priority, and all four `resolveHeardBrand` outcomes. One of those guards found a
real defect while I wrote it: a word with no letters ("47", "212") has an EMPTY
phonetic code, and two empty codes compared as a *perfect* match — scoring the
brands "47" and "212 NYC" as identical. Such a word now scores on spelling only. `brandAliasService.test.ts`
(5) — alias rows → candidates, application through casing, near-miss only
suggests, workspace-beats-global, and the pre-network guards (blank, blank,
circular).

**Migration verified on a throwaway Postgres 14** — see §Verification.

---

## 17 — "Magnifying glass ... should stay in visible area" — **CONFIRMED**

**Root cause.** `ProductDescriptionGenerator.tsx:3153-3155` (HEAD):

```jsx
left: magnifier.x + 20,
top:  magnifier.y,          // with CSS transform: translate(0, -50%)
```

Unclamped in both axes. Right edge: `x + 20 + size` runs past `innerWidth`.
Vertically the lens is centred on the cursor, so the top half is cut off above
`y < size/2` and the bottom half below `y > innerHeight - size/2`. At the default
200 px — and the size slider goes higher — that is a large dead zone all the way
round the preview.

**Fix.** `src/lib/magnifierPosition.ts` — `clampLensPosition(cursorX, cursorY,
size, viewportW, viewportH)`. Horizontally the lens **flips** to the left of the
cursor rather than sliding, so it never covers the pixel being inspected; then
both axes clamp to a margin. A lens larger than the viewport clamps to the
top-left margin instead of inverting.

It returns the **true top-left**, so `.magnifier-lens`'s `transform: translate(0,
-50%)` was removed (and the `zoomPopIn` keyframes with it) — otherwise the paint
would move back out from under the clamp. Comment left in the CSS saying so.

**Coarse pointers unchanged**: `@media (hover: none) and (pointer: coarse)` still
hides the lens and its controls, as the mobile pass left them.

**Tests.** `magnifierPosition.test.ts` (7) — including a sweep of the whole
viewport and 50 px beyond every edge, at three lens sizes, asserting the lens is
inside the margin on all four sides.

---

## 23 — "C&D Vintage is overwriting the brand inputted still" — **CONFIRMED as a data + hydration problem, NOT a preset problem**

I traced every write of `brand` and of `products.vendor` across `src/`.

**Ruled out.** `applyPresetToGroup.ts:167` at HEAD is already
`brand: item.brand || undefined` and is test-locked; `preset.vendor` appears
nowhere else in that file. `vendorName` (`App.tsx:455`, the `'C&D Vintage'`
founding fallback) is **export-only** — it is a local in the CSV row builder
(`csvExport.ts:537`), never assigned to a `ClothingItem`, never in a Supabase
write. The `KNOWN_BRANDS` scan contains no `C&D` entry. No migration or script
seeds a preset `vendor`.

**The actual mechanism, in three parts.**

1. **The source.** Commit `21296ea` (7 Jul 2026 08:00) shipped
   `brand: item.brand || preset.vendor || undefined`, reverted by `f8ae919`
   **34 minutes later** for exactly this reason. The preset field is labelled
   **"Default Vendor/Brand"** in `CategoryPresetsManager.tsx:743` and documented
   as "Default vendor/brand if applicable" in `category_presets.sql:21` — so a
   shop typing its own name there is the intended reading. Everything preset-
   applied in that window got `brand = 'C&D Vintage'`.

2. **The persistence.** `products.vendor` **is** the storage column for
   `item.brand` (`productService.ts:147,518`), so the poisoned value was written
   to the database.

3. **Why it comes back.** `productRow.ts:262` merges as `brand: s(r.vendor,
   item.brand)` — `s` is `(a, b) => a || b`, so **the DB row beats the live
   item**, on every startup hydration and every batch open;
   `productRow.ts:130` has no item fallback at all. And
   `productService.ts:701` mirrors the leader's `vendor` onto every other member
   of the group. The code was fixed; the rows were not, and they are re-served
   over whatever the seller just typed. **That is the "still".**

**Fix, in my files.** `scrubSellerBrand(brand, sellerNames)` in `brandSpelling.ts`
— matches through case, punctuation and `&`/`and`, and never touches a real brand
that merely contains the word "Vintage".

- `applyPresetToGroup.ts:167` → `brand: scrubSellerBrand(item.brand, [preset.vendor])`.
  Applying a preset is the one moment both the brand and the vendor it came from
  are in scope, so it is where the poisoned value is dropped. A preset's vendor
  still cannot *fill* brand — the contradiction in AGENTS.md §15 is resolved in
  favour of **brand = garment brand only**, in both directions.
- **PDG** clears a brand equal to this workspace's `descriptionSettings.vendorName`
  as each listing opens, persisted by the normal per-group save. It runs at most
  once per listing (after the clear the brand is `''` and never matches again).

**A user-typed brand is never overwritten by a later automatic step** in my
files: `applyPresetFields` keeps `item.brand` ahead of everything; PDG's two
merge points are `item.brand || patch.brand` and `prevItem.brand ||
updatedItem.brand`; `brand` is absent from App's `PRESET_OWNED` strip list; and
report 14's suggestion path deliberately does **not** write the field.

**Tests.** `applyPresetToGroup.test.ts` +5 — the heal, the heal through
`c and d vintage` / `C&D VINTAGE.` / `c & d  vintage`, "American Vintage"
untouched, a vendorless preset untouched, and force-mode still unable to put the
vendor in brand. Plus 9 in `brandSpelling.test.ts`.

### Deferred — this fix is not complete without two edits I do not own

1. **`src/lib/productRow.ts:262`** — `brand: s(r.vendor, item.brand)` should not
   let the stored value beat a live edited one. Same for `:130`
   (`brand: r.vendor || ''`, no item fallback). Until then a brand typed in the
   first second after load is silently replaced by the DB's.
2. **A one-row data repair.** The poisoned rows are still there:
   ```sql
   select count(*), vendor from products where vendor ilike '%C&D%' group by vendor;
   update products set vendor = '' where vendor ilike 'C&D Vintage';
   select id, category_name, vendor from category_presets where vendor is not null;
   ```
   Needs the founder's eyes before running — I did not write it as a migration
   because it is a one-shop data edit, not schema.
3. **`src/lib/categoryPresetsService.ts:136`** — `vendor: productData.vendor ||
   preset.vendor` inside `applyCategoryPreset`. **Zero callers**, but it writes
   `preset.vendor` into the snake_case `vendor` key, i.e. the very column that
   hydrates back into `brand`. Anyone wiring it up re-creates the bug. Delete it
   or route it through `scrubSellerBrand`.
4. **AGENTS.md §15 is stale** — "Preset audit fixes" item (4), "preset `vendor`
   wired as the default brand", is factually wrong for the current code and
   contradicts the correct entry two lines above it. Orchestrator's file.

---

## 26 — Kids, petite, plus, tall and pants sizing — **CONFIRMED**

At HEAD, `normalizeSizeValue` was a letter map plus "first token, uppercased".
Everything outside the S/M/L/XL ramp degraded, several of them silently:

| spoken / typed | HEAD | correct |
|---|---|---|
| `petite small` | `PETITE` | `PS` |
| `youth medium` | `YOUTH` | `YM` |
| `large tall` | `L` (the "tall" vanished) | `LT` |
| `32 by 34` | `32` (the inseam vanished) | `32x34` |
| `32x34` | `32X34` | `32x34` |
| `6 to 9` | `6` | `6-9` |
| `6-9 months` | `6-9` | `6-9M` |
| `one x` | `ONE` | `1X` |

`1X`, `2X`, `3T` and `6-9` happened to survive the "first token uppercased"
fallback — by accident, not by rule, and nothing tested them.

**Fix.** `normalizeSizeValue` restructured into named families, ordered so they
cannot shadow each other, with the letter map lifted out as `SIZE_LETTER_MAP`
(`med`/`lg` added) and reused by every family via `letterSize()`. Leading `size`/
`sz` and gender qualifiers (`women's`, `mens`, `ladies`) are stripped up front.

Two ordering decisions carry the weight:

- **`1X` ≠ `XL`, `2X` ≠ `XXL`.** The plus matcher is `^(\d|one|…|six)\s*x$` —
  anchored, with no trailing `l`/`large` — so it can never swallow `2XL`. Women's
  plus and men's extra-large are different garments; merging them mis-sizes every
  plus listing.
- **A hyphen is NOT a waist×inseam separator.** `6-9` is a baby age range, and
  that exact ambiguity is what mangled kids sizes. Pants take `x`, `by`, `/` and
  the `W32 L34` / `w32l34` tag spellings; the hyphen belongs to age ranges.

**The size and the two measurements are one fact**, so the extractor now bridges
them both ways: `waist 32 inseam 34` with no size command yields size `32x34`,
and `size 32 by 34` fills the waist and inseam measurement fields. Pass 2's
fallbacks learned the new families too, with the multi-word petite/tall/youth/
pants/age patterns listed **before** the plain letter ramp so "petite small" is
never read as bare "small".

The **size form needed no change** — `ComprehensiveProductForm`'s brand-new
`onBlur` already routes through `normalizeSizeValue(v, { keepFitsLike: true })`,
so it inherited every family. Its placeholder now shows one of each
(`M · 1X · 32x34 · YM · PS`).

The `(fits like …)` note still rides along on all of them, and is still stripped
by the default for titles, CSV and alt text.

**GOLDEN SNAPSHOT UNCHANGED** (its size is `XL`).

**Tests.** `textAIService.test.ts` +56 — one per family member (44 table cases),
the explicit `1X ≠ XL` / `2X ≠ 2XL` assertions, `fits like` over the new
families, and three through the voice pipeline (`waist`+`inseam` → size,
`size 32 by 34` → measurements, spoken kids/plus/petite).

---

## 28 — "Ensure autosave is working and enable a save button" — **autosave CONFIRMED working; button added**

**Autosave verified, not assumed.** Step 3 has two independent debounced writes
to `products` — `debouncedDirectSave` (800 ms, per edit) and the
`[processedItems]` effect (500 ms) — plus a keepalive `beforeunload`/`pagehide`
flush. Both were already reading the group from the live store after the previous
pass. What was missing is that **`syncGroupFieldsToDatabase` resolves `false`
rather than throwing**, and every caller used `.catch()` — so an RLS refusal or a
row that did not persist produced *no signal at all*. That is what "ensure
autosave is working" was really asking about.

**And one real hole, found while checking it.** The `[processedItems]` debounce
cancels itself in its own cleanup — which React also runs **on unmount**. PDG
unmounts on every batch switch (`key={currentBatchId}` in App), and
`beforeunload`/`pagehide` do not fire for a component unmount. So the last
≤500 ms of edits were silently dropped. That window is not theoretical:
`ComprehensiveProductForm` writes through `setProcessedItems` directly, **not**
through `handleTableFieldChange`, so form edits are carried by that debounce
alone — `debouncedDirectSave` never sees them. Switching batches from the Library
within half a second of typing lost them from `products`.

**Fix.**
- An **unmount flush** (empty deps, so its cleanup runs at unmount and nowhere
  else) that cancels both timers and writes the pending group and the current
  group, deduped.
- `reportedSync(group, label)` — the one funnel every Step 3 products write now
  goes through, reporting `saveStatus.begin()` / `end(ok)` into
  `src/lib/saveStatusStore.ts`. A `false` result now surfaces as
  **"Save failed — retry"** instead of silence.
- **A Save button** beside Prev/Next at the top of the preview column. It cancels
  *both* debounce timers and runs what they were holding, awaited — so it is a
  real "write my work now", not a third racing path. It re-reads groups out of
  `processedItemsRef` (the pending snapshot captured at edit time is already
  stale by the time the button is clicked), and if a pending direct save belongs
  to a *different* listing (edit, then navigate) that group is refreshed and
  saved too.
- **A status line** under the nav: `Saving… / Saved 12:04 / Save failed — retry /
  Unsaved changes`, `role="status"`, colours by `data-state`, with the row height
  reserved so the nav never jumps.

The indicator is shared: another agent reports App's `workflow_state` auto-save
into the same store, so one line speaks for every persistence path. I consume it
and report PDG's writes; I did not modify `saveStatusStore.ts`.

---

## Verification — `brand_aliases.sql` on a throwaway Postgres 14

`initdb` into the scratchpad, `stub2.sql` → `multi_org_tenancy.sql` →
`beta_signups.sql` → `brand_aliases.sql`, applied twice. **Cluster stopped and
deleted afterwards.** Two full rounds plus a focused third.

**Round 1 — all 10 checks green**, and five defects found. All five fixed:

| # | Defect | Fix |
|---|---|---|
| 1 | A comment predicted `permission denied for column created_by`; PG 14 actually says `... for table brand_aliases` on an UPDATE column-privilege denial | VERIFY block now matches on the **SQLSTATE 42501** and lists all four immutable columns. (The same wrong wording is in `kanban_board.sql:265` — not my file, flagged below.) |
| 2 | Header said the index was on `lower(heard)`; it is on `lower(btrim(heard))` | comment corrected |
| 3 | `heard` was normalised only inside the index, never on write — a row stored as `'  la tiger  '` is matched by the btrimmed index but **not** by the client's `.ilike` lookup, so "re-point this correction" finds nothing, inserts, trips 23505, and the service reports success having changed nothing | new `brand_aliases_heard_is_canonical` CHECK |
| 4 | Header described an upsert that does not exist (PostgREST cannot target an expression index with `onConflict`) | rewritten to say what actually happens |
| 5 | `created_by_email` had no DEFAULT yet is immutable by column grant — an insert omitting it produced a row whose "denormalized for display" email **no client could ever backfill** | `default nullif(public.my_email(), '')`, and `my_email()` moved to the top of the file so the table can reference it |

**Round 2 — all 16 checks green** (the original 10 plus six aimed at the fixes):
the default fires for a signed-in insert and stays NULL (not `''`) for an
owner-run one; the canonical CHECK rejects padded and upper-case forms; and the
**upgrade path** works — from a database created by the earlier version of the
file (constraint and default dropped, non-canonical rows seeded), a re-apply
canonicalises the rows, adds the constraint, restores the default, and leaves all
four policies and the column grants intact.

One residual defect and one ordering hazard came out of round 2, both fixed:

- **`btrim/1` strips U+0020 only.** JavaScript's `.trim()` strips the whole
  Unicode White_Space set, so a row stored as `E'\tla tiger'` satisfied the new
  CHECK, took its own unique-index slot, and was *still* unreachable by the
  client — the very failure the CHECK was added to close, narrowed rather than
  removed. Fixed with `public.canonical_heard(text)`, one IMMUTABLE function now
  shared by the CHECK (and documented as equivalent to the index expression for
  any admissible row, so the index is deliberately left alone — `create index if
  not exists` matches on NAME, so re-expressing it would be a silent no-op on an
  existing database).
- **The upgrade DO block canonicalises before the unique index exists**, and the
  file is not transactional, so from a hand-damaged state (table present, index
  hand-dropped) a re-apply could abort mid-file. Now it counts collisions first
  and **raises with the de-duplicating query** instead of half-applying.

**Round 3 — the `canonical_heard` change, verified directly.** All seven forms
(`'  La Tiger  '`, tab, newline, NBSP, BOM + line separator, vertical-tab + CR,
paragraph separator) normalise to `la tiger`; the function is IMMUTABLE and
indexable; each of the seven is rejected by the CHECK with **23514
`heard_is_canonical`**; and the collision guard raises as designed. Cluster
destroyed.

**Not my file:** `kanban_board.sql:265-266` carries the same incorrect
"permission denied for column" wording as defect 1.

---

## Files

| File | Change |
|---|---|
| `src/lib/brandSpelling.ts` | **new** — normalise, Levenshtein, phonetic code, word-aligned matcher, seller-name guard |
| `src/lib/brandSpelling.test.ts` | **new** — 34 |
| `src/lib/brandAliasService.ts` | **new** — `brand_aliases` CRUD, candidate assembly, lazy built-in library |
| `src/lib/brandAliasService.test.ts` | **new** — 5 |
| `src/lib/magnifierPosition.ts` | **new** — viewport clamp |
| `src/lib/magnifierPosition.test.ts` | **new** — 7 |
| `src/components/BrandSpelling.tsx` / `.css` | **new** — notices + inline manager (inline and full variants) |
| `supabase/migrations/brand_aliases.sql` | **new** — per-workspace aliases, org RLS, any member writes |
| `src/lib/textAIService.ts` | shared trigger alternation; title strip sweep; stop words; `normalizeSizeValue` rewrite; size↔measurement bridge |
| `src/lib/voiceGrammar.ts` | `FIELD_TO_TITLES`, `stripFieldTitlePrefix`, applied in `emit` + `flushVoiceState` |
| `src/lib/applyPresetToGroup.ts` | `scrubSellerBrand` on the brand passthrough |
| `src/components/ProductDescriptionGenerator.tsx` | lens clamp; `reportedSync`; unmount flush; Save button + status; brand-spelling flow; seller-brand scrub |
| `src/components/ProductDescriptionGenerator.css` | lens transform removed; `.save-status` / `.preview-save-btn` |
| `src/components/ComprehensiveProductForm.tsx` | `brandExtra` slot, `onBrandEdited`, size placeholder |
| `src/components/VocabDashboard.tsx` | Brand spellings tab (scope badge flips to per-workspace) |
| `src/lib/textAIService.test.ts` | +64 |
| `src/lib/voiceGrammar.test.ts` | +44 |
| `src/lib/applyPresetToGroup.test.ts` | +5 |

## Gates

| Gate | Before | After |
|---|---|---|
| `npm test` | 671 passed | **1015 passed**, 51 files (**+160 mine**; the rest are concurrent agents') |
| `npm run build` | clean | **clean** |
| `npx eslint .` | **252 problems** | **252** |
| `ProductDescriptionGenerator.tsx` | 23 | **23** |
| `ComprehensiveProductForm.tsx` | 19 | **19** |
| `VoiceCommandTable.tsx` | 12 | **12** |
| `textAIService.ts` | 14 | **14** |
| `applyPresetToGroup.ts` | 3 | **3** |
| `VocabDashboard.ts` / `vocabService.ts` | 0 | **0** |
| the 7 new source/test files | — | **0** |
| golden snapshots (description, CSV) | — | **unchanged** |

Every file I touched holds its exact prior count (verified per file against the
previous pass's recorded table, and for `ComprehensiveProductForm` against
`HEAD`: 14 `PresetBadge` uses → 14 render-purity errors, before and after). The
count peaked at 255 mid-pass from a concurrent agent's in-flight edits and
returned to 252 when they finished; **none of the three were on my lines.**

`builtinBrandVocab` is still a separate **361 kB** chunk in the build output — it
did not enter the main bundle.

No `confirm()`/`prompt()`, no new dependency, no emoji in rendered UI, no literal
colours outside the nav, no AGENTS.md/README/CHANGELOG edits, nothing committed.

## For the orchestrator

1. **Report 23 is half-landed.** The code no longer creates the bug and now heals
   it at two points, but `productRow.ts` still lets `products.vendor` beat a live
   edit, and the poisoned rows are still in the database. See §23 Deferred (4
   items, one of them a AGENTS.md correction).
2. **`brand_aliases.sql` must be run** before the Step 3 surface appears at all.
   Until then every path reports `'unavailable'` and Step 3 behaves exactly as
   today — safe to ship code first.
3. **The built-in brand library is now reachable from Step 3** (lazily, on the
   first genuinely unknown brand of a session, then cached). It is a 361 kB
   fetch. If that is unwelcome on rural connections, gate it behind a setting —
   the two cheap sources already cover a shop that maintains its aliases.
4. **The extractor and the live parser disagree on one rule by design**:
   measurement titles end a value only when a digit follows (extractor), always
   (live parser). Unifying them means teaching the live parser spoken-word
   numbers first.
5. **AGENTS.md updates the orchestrator owns:** §3 test coverage (`brandSpelling`,
   `brandAliasService`, `magnifierPosition`), §5 folder map (four new libs, one
   new component, one new migration), §7 (the `brand_aliases` table), §10 Step 3
   (Save button, brand corrections), §15 (sizes, stop words, the report-23
   resolution), and §16 (`brand_aliases.sql` "built — migration not yet run").

---

## Summary

1. **9** CONFIRMED, two leaks: eleven hand-copied boundary lists all missing the same seven field titles, and nothing stripping a title already stored. One shared alternation built from the parser's own vocabulary + `stripFieldTitlePrefix`. 48 tests, one per title.
2. **11** CONFIRMED: the stop-word set was missing whole grammatical classes, and `it's` could never match because apostrophes survive the punctuation strip. Rebuilt by class; five domain words deliberately kept.
3. **14** BUILT: `brandSpelling.ts` (word-aligned phonetic matcher, no dependency), `brand_aliases.sql`, `brandAliasService.ts`, and a Step 3 surface — auto-apply + Undo, "Did you mean?", "Remember for this workspace", and a manager for any member plus a founder tab.
4. **17** CONFIRMED: the lens was unclamped in both axes. `clampLensPosition` flips then clamps; the CSS centring transform had to go with it.
5. **23** CONFIRMED, but **not** in preset apply — a 34-minute-lived build poisoned `products.vendor`, which IS the storage column for `brand`, and hydration lets the DB row beat a live edit. Healed at preset-apply and on listing open; **two edits and a data repair I do not own remain** (§23 Deferred).
6. **26** CONFIRMED: everything outside S/M/L/XL degraded silently. Nine size families, `1X` never folded into `XL`, a hyphen never a waist×inseam separator, size↔measurement bridged both ways.
7. **28** autosave verified working, plus a real hole: the debounce cancelled itself on unmount, and form edits ride that path alone. Unmount flush, Save button, shared status indicator.
8. **Gates:** 1015 tests (+160 mine), build clean, eslint **252 = baseline**, golden snapshots unchanged, migration verified over three rounds on throwaway Postgres 14, nothing committed.

---

# Final stitch — the cross-file items, applied

Every other agent had finished, so the five remaining cross-file items went in.

## 1. `ListingLabelsPicker` mounted in Step 3

`ProductDescriptionGenerator.tsx`, directly under the preset controls (the
per-listing metadata column), with the contract §7(d) specifies:
`<ListingLabelsPicker productIds={currentGroupIds} />`.

`currentGroupIds` is a **memo keyed on the joined id string**, not
`currentGroup.map(i => i.id)` inline. The picker keys its fetch on the array, and
a fresh array every render would refetch every label on every keystroke of every
Step 3 field. It is mobile-safe by construction — the component owns its own CSS
and the column it sits in already reflows at 1024px and 640px.

## 2. The two PDG save-status edits from `12-grouping-persistence.md`

- **Edit 1 was already in place** from this pass's report 28: `reportedSync`
  wraps *both* debounced writes (the 800 ms direct save and the 500 ms
  `[processedItems]` save) with `saveStatus.begin()` / `end(ok, message?)`, using
  the boolean `syncGroupFieldsToDatabase` returns rather than a `.catch()` — so
  a silent RLS refusal surfaces as "Save failed — retry". Nothing to add.
- **Edit 2 applied**: the `beforeunload` / `pagehide` keepalive flush now reports
  `begin(); end(true)` — optimistically, as specified, because a keepalive PATCH
  has no response to await and no render left to show a failure in.

**Reconciled so nothing double-reports.** There are now three teardown paths and
they are disjoint: the **unmount flush** (batch switch) uses `reportedSync` and
reports truthfully; the **unload flush** (page teardown) reports optimistically,
and only `if (flushedIds.size > 0)` so an idle teardown reports nothing; the
**Save button** awaits `reportedSync` directly. No teardown runs two of them.

## 3. `focusProductId` on PDG, wired from App

~6 lines in PDG — an effect that maps the id through `groupArray` and sets
`currentGroupIndex` — matching **any photo in the group**, not just the leader,
because `LabelPrintView` hands back the leader while the scanner hands back
whichever row owns the SKU.

App side: `focusListingId` state, set by `openListingInStep3` and **cleared in
the same `requestAnimationFrame` that scrolls**. The clear is the load-bearing
part: PDG focuses on a *change* of the prop, so a sticky id would make a second
scan of the same label — after navigating away with Next — do nothing. Clearing
makes every scan a `null → id` transition. (A `nonce` was tried first and
discarded: it could not reach PDG through a `string | null` prop, so it was
decoration.) App's stale "SELECTING the scanned listing needs a ~6-line prop"
comment was corrected.

## 4. Report 23's remaining code half

**`productRow.ts:296` — `brand: s(r.vendor, item.brand)` → `s(item.brand, r.vendor ?? undefined)`.**
This merge runs on App's **background** hydration, after the UI is interactive,
so row-first meant a brand typed in the first second after load was silently
replaced by whatever the database held. That is the mechanism behind "overwriting
the brand inputted **still**".

Behaviour-neutral on a real restore: `brand` is not in the
`slimForWorkflowState` whitelist, so a hydrated item has no brand and the row is
still what lands. It differs only when the item holds a live value.

The `?? undefined` is not decoration — `s` is `(a, b) => a || b`, which returns
the **second** operand when both are falsy, so swapping the order alone made a
null vendor surface as `null` where it had been `undefined`. The existing
`coerceEmptyStrings` divergence test caught it.

**`productRow.ts:151` (`productRowToClothingItem`) needs no change** — it builds
an item entirely from a DB row, with no in-memory value to beat. Stated here
because it was flagged as `:130`; there is nothing to fix, not an omission.

**`categoryPresetsService.ts:136`** — `vendor: productData.vendor || preset.vendor`
removed. Zero callers, but the keys there are snake_case `products` **columns**,
so it wrote `preset.vendor` into the exact column that hydrates back into `brand`.
Function now carries an `UNUSED` banner and a warning naming the regression.

**Tests:** `productRow.test.ts` +4 (both merge option sets keep a live brand over
`'C&D Vintage'`; the row still wins when the item has none — the restore case; an
empty in-memory brand counts as absent). The general "DB row wins" test keeps
`size`/`price` and now asserts brand as the documented exception.

## 5. One-off data repair — **NOT a migration file, run by hand**

The code no longer creates or re-serves the bug, but rows written during the
34-minute window (`21296ea` → `f8ae919`, 7 Jul 2026) are still in the database.
Run in the Supabase SQL Editor, **after reading the preview**:

```sql
-- ── ONE-OFF DATA REPAIR — founder report 23 ─────────────────────────────────
-- NOT a migration. Run once, by hand, after checking the preview.
-- Substitute your own shop name for 'C&D Vintage' if it differs.

-- 1. PREVIEW — what is about to change. Read this before anything else.
--    Anything here whose vendor is a GARMENT brand must NOT be repaired;
--    narrow the WHERE clause instead.
select p.id, p.vendor, p.title, p.batch_id, p.created_at
from public.products p
where lower(btrim(p.vendor)) in ('c&d vintage', 'c and d vintage')
order by p.created_at;

-- 2. COUNT, grouped and deliberately WIDER than the repair, so a typo'd or
--    spaced variant shows up here rather than being missed silently.
select vendor, count(*) from public.products
where vendor ilike '%vintage%'
group by vendor order by count(*) desc;

-- 3. THE REPAIR. `vendor` is the storage column for item.brand; blanking it
--    means "no garment brand recorded", which is correct — the seller name
--    reaches the CSV from the org-level vendorName setting, never from a row.
update public.products
set vendor = ''
where lower(btrim(vendor)) in ('c&d vintage', 'c and d vintage');

-- 4. The likely SOURCE row, if the shop name was typed into a preset's
--    "Default Vendor/Brand" field. Nothing reads category_presets.vendor any
--    more, so this is belt-and-braces.
select id, category_name, product_type, vendor
from public.category_presets where vendor is not null;
-- update public.category_presets set vendor = null where vendor ilike '%vintage%';
```

Step 2 is intentionally wider than step 3: it surfaces every `%vintage%` vendor so
a spaced or misspelled variant is seen and added to the repair list by hand,
rather than being missed. Step 3 only touches the two exact forms.

## Gates after the stitch

| Gate | Result |
|---|---|
| `npm test` | **1019 passed / 51 files** (+4 `productRow.test.ts`) |
| `npm run build` | clean |
| `npx eslint .` | **252 — the baseline** |
| `ProductDescriptionGenerator.tsx` | 23 (unchanged) |
| `App.tsx` | 41 (unchanged — the labels agent's recorded count) |
| `productRow.ts` / `productRow.test.ts` | **0** |
| `categoryPresetsService.ts` | 2, both pre-existing `any` (same count at `HEAD`) |
| react-hooks v7 | clean — the focus effect is a plain `setState` in an effect body keyed on the prop, the same shape as the existing index clamp beside it; no ref written during render |

Nothing committed.
