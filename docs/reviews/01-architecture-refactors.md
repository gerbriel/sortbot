# 01 — architecture refactors: implementation log

Source: `docs/reviews/01-architecture.md` (findings §1, duplicates §4, plan §7, code §8), plus the
deferred items from `02-debugging-fixes.md`, `03-performance-fixes.md`, `05-security-fixes.md` and
`06-devops-monitoring.md` §5. **Nothing was committed.**

Every site was re-located by reading the current tree; the line numbers in the source reports
predate the four passes that already landed.

---

## Gates

| Gate | Before | After |
|---|---|---|
| `npm test` | 427 passed / 32 files | **505 passed / 35 files** (+78, all mine) |
| `npm run build` (`tsc -b && vite build`) | clean | **clean** |
| `npx eslint .` | **301 problems** (285 errors, 16 warnings) | **254 problems** (238, 16) — **−47** |
| per-file lint vs `git show HEAD:<file>` | — | **no file regressed**; App.tsx 66→41, Library 33→31, workflowBatchService 9→4, productService 7→4, the rest unchanged |
| lint on the 7 new files | — | **0 findings** |
| `sortbot_*` localStorage keys | 43 references | **43 references, none renamed** |
| `package.json` / `package-lock.json` | — | **untouched** (no dependency added or removed) |

New tests by file: `productRow.test.ts` 39 · `chunk.test.ts` 7 · `storageUrls.test.ts` 6 ·
`workflowBatchService.test.ts` +13 · `applyPresetToGroup.test.ts` +8 · `slimItems.test.ts` +5.

Net source change across the 56 touched/deleted files: **3,524 insertions, 7,308 deletions.**

---

## PART A — deferred wiring

### A1 — sign-out purges the Service-Worker image cache · **done**

`src/App.tsx:1313` — `await purgeImageCache()` (from `lib/swCache.ts`) immediately after
`supabase.auth.signOut()`, before the analytics/error context clears. Comment cites security audit
05 finding #21: the SW cache is keyed by URL only and lives in shared origin storage, so without
this the next person on a shared machine could still pull the previous workspace's photos for the
full 7-day TTL.

### A2 — first-party error reporting wired into App · **done, all five edits**

| # | Where | What |
|---|---|---|
| 1 | `App.tsx:50` | `import { installErrorReporter, reportError, setErrorContext, clearErrorContext }` |
| 2 | `App.tsx:61` | module-scope `installErrorReporter()` (after the import block, before the first render) |
| 3 | `App.tsx:317` | `reportError(error, { source: 'boundary', component: … })` inside `GrouperErrorBoundary.componentDidCatch`, keeping the existing `console.error` |
| 4 | `App.tsx:1252, 1272, 1277, 1282, 1315` | `setErrorContext` beside each of the three `setAnalyticsContext` calls; `clearErrorContext` in both teardown paths (the `!user` branch and `handleSignOut`) |
| 5 | `App.tsx:1301-1304` | `view` hoisted out of the `trackPageview(...)` argument so `setErrorContext({ view })` gets it too |

Applied verbatim from `06-devops-monitoring.md` §5. I chose `App.tsx` over `main.tsx` for the
install call, as the report's note allows.

### A3 — `public/sw.js`: the three deferred cache fixes · **done**

Applied verbatim from `03-performance-fixes.md` "Deferred", on top of the security agent's purge
handler (which is untouched and still answers `PURGE_IMAGE_CACHE` on the supplied MessageChannel).

- **(a)** `REVALIDATE_AFTER_MS = 24 h`; a fresh cache hit no longer fires a background
  `fetch` + `arrayBuffer()` + `cache.put`. Product images are immutable per `storage_path`
  (a re-crop writes a NEW path), so a fresh entry has nothing to learn from the network — the
  old code re-issued one request per image per page load, i.e. the exact storm the SW exists to prevent.
- **(b)** `MAX_ENTRIES = 3000` + `TRIM_PER_FETCH = 50` + `trimCache(cache)` called fire-and-forget
  (never awaited) after each successful store, so pruning happens during `fetch` rather than only on
  `activate`.
- **(c)** `stripCacheBust` now deletes `_retry` as well as `t`, so `imageTransforms.ts`'s retry
  suffix stops minting a new cache key for identical bytes.

---

## PART B — refactors

### B4 · finding #10 — the two byte-identical DB-row→`ClothingItem` builders · **done**

**New:** `src/lib/productRow.ts`, `src/lib/productRow.test.ts` (39 tests).

`productRowToClothingItem(row, htmlToPlain)` replaces both 70-line copies in `App.tsx` (the
"`workflow_state` is empty" rebuild and the gap-fill path). Confirmed byte-identical beforehand:
they differed only in the order of two adjacent property lines and one comment. `htmlToPlain` is
injected because `htmlDescToPlain` lives in `App.tsx`, which imports this module — importing it back
would be a cycle.

`grep -c customLabel0 src/App.tsx` went from 5 to 3 (the type declaration plus two whitelist arrays);
all four field-by-field copies are gone.

### B5 · finding #11 — the two 45-field DB→item merges · **done, divergence preserved**

Same module. `mergeProductRowIntoItem(item, row, htmlToPlain, opts)` with two exported option
presets, `STARTUP_MERGE_OPTIONS` and `OPEN_BATCH_MERGE_OPTIONS`, each reproducing its call site
exactly.

**The report says the paths differ in one way (`|| ''`). They actually differ in SEVEN.** I found
the other six by diffing the two blocks line by line, and all seven are now explicit options rather
than an accident:

| Option | STARTUP | handleOpenBatch |
|---|---|---|
| `coerceEmptyStrings` | `true` — ~30 string fields get a `\|\| ''` tail | `false` — they stay `undefined` |
| `imageStrategy` | `'db-group-wins'` — the row's `product_images` list beats the item's own image | `'own-image-wins'` — the item's own image wins; the row's list is a fallback only |
| `descriptionStrategy` | `'row-or-item'` — `plain(row) \|\| item \|\| ''` | `'row-else-item-then-plain'` — `plain(row ?? item ?? '')` |
| `defaultStatus` | `'Active'` | none |
| `defaultEmptyMeasurements` | `true` (`{}`) | `false` (`undefined`) |
| `setProductGroup` | `false` — never re-derived it | `true` |
| `setOriginalName` / `setAppliedPresetId` | `false` / `true` | `true` / `false` |

**`imageStrategy` is the one that matters.** The open-batch rule is not an accident — it is commit
`3a70b52`. The row is matched at the GROUP level, so `row.product_images` is the whole group's photo
list; preferring it made every member of a group show the same photo. Unifying on the startup
semantics would reintroduce that bug. Unifying on the open-batch semantics is probably correct but
is a behaviour change to the reload path, so it is **not** what I did.

**Two exactness bugs in the report's §8.3 code, which I did not carry over:**

1. `const s = (a, b) => a || b || e` with `e = undefined` is **not** equivalent to the open-batch
   copy's `a || b`. When both sides are `''` — which happens constantly, because the startup path
   coerces every string field to `''` — the report's version yields `undefined` where the original
   yielded `''`. `s` is now two written-out branches. Same fix applied to `status` and
   `measurements`, which have the same shape. Locked by
   `"OPEN-BATCH keeps a literal '' from the item rather than turning it into undefined"`.
2. `descriptionStrategy === 'db-group-wins'` in the report's draft is a value from the *other*
   option's union and would not type-check.

### B6 · finding #12 — the `storagePath → public URL` seam · **done**

**New:** `src/lib/storageUrls.ts` (`IMAGE_BUCKET`, `publicImageUrl`, `thumbnailImageUrl`),
`src/lib/storageUrls.test.ts` (6 tests).

Every inline `supabase.storage.from('product-images').getPublicUrl(…).data.publicUrl` in `src/` now
routes through it — **23 sites across 10 files**: `App.tsx` (12), `ImageGrouper.tsx` (3),
`productService.ts` (3, including `getThumbnailUrl` itself), `libraryData.ts` (2), `Library.tsx`,
`GoogleSheetExporter.tsx`, `ImageUpload.tsx`, `tusUpload.ts`, `workflowBatchService.ts`.
`grep -rn getPublicUrl src/` now returns only `lib/storageUrls.ts`, the test mock, and prose in
comments. ANALYSIS Phase 1b's private-bucket migration is now one function body.

The invariant the helper absorbs is that an absent path yields `''`, never a throw and never the
string `undefined` inside a URL — every call site was hand-rolling that ternary.

`productService.getThumbnailUrl` is now `export { thumbnailImageUrl as getThumbnailUrl }`, so
nothing that imported it broke. `libraryData.ts` no longer imports `supabase` at all.

**Deviation from §8.1:** I dropped `resolveImageUrl`. It had **no consumer** — the three App sites
that look closest use a different priority order, so adopting it would have been a behaviour change
— and shipping a new unused export in the same pass that deletes 5,819 lines of unused code is
incoherent. Its 6 tests went with it.

### B7 · finding #13 — the two diverged persisted-item types · **done**

`SlimItem` (5 fields, in `workflowBatchService.ts`) is **deleted**. `slimItems.ts` — beside the
function that writes the blob — now owns:

- `PersistedWorkflowItem = SlimWorkflowItem & Partial<ClothingItem>` — the honest type. New saves
  hold slim items; batches saved before the slimming (and anything `duplicateBatch` copied) hold
  whole `ClothingItem`s. The intersection is also what lets consumers read `preview` / `seoTitle` /
  `storagePath` off a persisted item **without a cast**.
- `asClothingItems(items)` — the ONE documented widening, runtime-identical to the `as ClothingItem[]`
  cast it replaces (it adds and normalises nothing).

`WorkflowBatch.workflow_state`'s four arrays are all typed `PersistedWorkflowItem[]` (they were
`ClothingItem[]` × 3 plus `ClothingItem[] | SlimItem[]`).

**Casts genuinely removed** (not relocated): the four `(ClothingItem | SlimItem)[]` unions in
`Library.tsx`, its four `as ClothingItem[] | undefined` arguments to `patchArray`, and
`libraryData.ts`'s six `(i as ClothingItem).preview` / `.storagePath` / `.seoTitle` accesses.
`workflowBatchService.ts`'s `as SlimItem | undefined` is gone. App's one remaining cast is now the
named `asClothingItems(...)` call.

+5 tests in `slimItems.test.ts`, including type-level assertions that both a slim item and a legacy
whole `ClothingItem` satisfy the type.

### B8 · finding #21 — Library's local image component · **done**

`Library.tsx`'s private 40-line `LazyImg` (no retry) is deleted; it now imports
`components/LazyImg`, so Library thumbnails finally get the 3× exponential backoff + cache-bust that
exists to survive `ERR_QUIC_PROTOCOL_ERROR`.

**The CSS needed retargeting** to keep this visually identical: the shared component emits
`.lazy-skeleton` / `.lazy-skeleton--error` (defined globally in `index.css`) while the local copy
emitted `.img-skeleton`. `Library.css`'s two positioning rules (`.image-preview .img-skeleton` and
`.thumbnail-item .img-skeleton`, both `position:absolute; inset:0`) now also select
`.lazy-skeleton`. The `.img-skeleton` shimmer definition is kept — harmless, and documented as such.

### B9 · finding #14 — `fetchWorkflowBatches` `select('*')` with no limit · **done (perf pass had NOT done it)**

Verified first: the perf pass left this function untouched.

- **Pagination** in 1000-row `.range()` windows, the same shape `fetchSavedProducts` uses. This
  **fixes a silent bug**: the function stopped at PostgREST's 1000-row max-rows cap with no error,
  so a workspace past 1000 batches simply never saw its oldest ones in the Library. This is the one
  place in Part B where behaviour changes, and it changes in the "stops losing data" direction.
- **Projection** via `WORKFLOW_BATCH_RESTORE_COLUMNS`. I enumerated every field any consumer reads
  off these rows by grep before choosing it, because `deriveLibraryData` passes `wfBatches` straight
  through into Library's `batches` state — so the batch CARDS read these rows too, and narrowing to
  just the three columns `deriveLibraryData` itself touches (as §7 Step 1 implies) would have blanked
  the card counts and the "edited by" label. Dropped: `thumbnail_url`, `tags`, `notes` (§7 marks the
  latter two unused). The three count columns are kept only because `WorkflowBatch` declares them
  non-optional.

+6 tests, including "walks pages until a short one", "requests consecutive 1000-row windows",
"stops after ONE request when the first page is short", and "never `select(*)`".

`src/lib/testing/supabaseMock.ts` gained one additive field: `MockCall.range` (the builder's
`range()` now records its arguments, where it previously discarded them).

### B10 · finding #24 — dead code deletion · **done, 20 files / 5,819 lines**

Every candidate was proven to have no importer outside the dead set, by dumping every import
specifier in `src/**/*.{ts,tsx}` (`from`, bare side-effect, and dynamic `import(`), then sweeping by
exported-symbol name across `src/`, `scripts/`, `public/`, `supabase/`, `.github/`, `deploy/`,
`index.html` and the root config files. Post-delete, every relative import in `src/` was re-resolved
against the filesystem: **zero dangling imports**.

| Deleted | Lines |
|---|---|
| `src/components/SavedProducts.tsx` + `.css` | 371 + 730 |
| `src/components/TestLlamaVision.tsx` + `.css` | 121 + 168 |
| `src/components/LiveWorkspaceSelector.tsx` + `.css` | 201 + 221 |
| `src/components/RemoteCursors.tsx` + `.css` | 118 + 192 |
| `src/components/AISettings.tsx` + `.css` | 132 + 239 |
| `src/components/ImageSorter.tsx` + `.css` | 115 + 116 |
| `src/hooks/useUserPresence.ts` | 188 |
| `src/services/api.ts` | 520 |
| `src/lib/huggingfaceService.ts` | 188 |
| `src/lib/brandMatcher.ts` | 348 |
| `src/lib/constructionDatabase.ts` | 570 |
| `src/lib/fitConditionDatabase.ts` | 650 |
| `src/lib/exportLibraryService.ts` | 509 |
| `huggingface-proxy.cjs` (repo root) | 122 |

`src/hooks/` and `src/services/` became empty and were removed. Nothing was kept — all 14 candidates
were dead. The only intra-set import edges were `RemoteCursors → useUserPresence` and
`TestLlamaVision → huggingfaceService`, which do not count as live importers.

**`COLOR_RGB_MAP` removed** from `colorDatabase.ts` (zero consumers since `colorUtils.ts` was
deleted): the doc comment, the `export const`, and the `.push(...)` inside the derivation loop.

> **`hexToRgb()` was deliberately KEPT.** It is not a `COLOR_RGB_MAP`-only helper — the loop's
> `const rgb = hexToRgb(firstHex); if (!rgb) continue;` is the **pattern-entry filter** that keeps
> `#MULTI` / `#RAINBOW` entries (tie dye, camo, plaid) out of `COLOR_WORDS_LIST`. Deleting it would
> have silently leaked pattern names into the voice/AI colour scanner. `COLOR_DNA` and
> `COLOR_WORDS_LIST` are untouched.

`index.html`'s CSP rationale comment named `src/services/api.ts` as the reason `script-src 'self'`
is safe; updated to say both files are now deleted. **No CSP directive changed** — `apis.google.com`
was never in the policy.

### B11 · finding #23 — route `console.log`/`debug`/`table` through the gated logger · **done, 76 sites**

| File | Sites | Category |
|---|---|---|
| `ImageGrouper.tsx` | 38 | `log.grouper` |
| `App.tsx` | 19 | `log.app` |
| `ProductDescriptionGenerator.tsx` | 12 | `log.pdg` |
| `imageTransforms.ts` | 9 | `log.img` |
| `ImageUpload.tsx` | 7 | `log.upload` |
| `tusUpload.ts` | 6 | `log.upload` |
| `main.tsx` | 2 | `log.app` |

`grep -rn 'console\.(log|debug|table)' src/` now returns exactly **one** line: the `console.table` in
`ImageGrouper.tsx`, which is correct — the logger has no table equivalent, so it is kept and
**gated** inside `if (isDebugEnabled())` along with its surrounding `console.group`/`groupEnd` (all
three, or an empty collapsed group would still print in production).

`console.error` and `console.warn` were left alone throughout — they report genuine failures and must
stay visible. That includes the ones interleaved with converted logs on the same line, e.g. the
`.then(…log…)` / `.catch(…console.error…)` pair in `runCropBatchPaste`.

**The part that is more than mechanical:** `log.*` arguments are evaluated **eagerly** at the call
site even when debug is off, so a bare swap leaves the cost behind and only removes the output.
Every site whose arguments do real work is now wrapped in `isDebugEnabled()`:

- `App.tsx` — two `.filter()`-over-the-whole-batch + per-item object literals (the `[OPEN]` image
  audits, which ran on **every** batch open), the `wsLengths` object, and `Object.keys(workflow_state)`.
- `ImageGrouper.tsx` — `new Error().stack` on every selection change; a
  `.map().slice().join()` in the pick-mode log; the `console.table` block.
- `PDG` — five inline object literals (an 11-key one on every group navigation, plus the
  `[REGEN]`/`[PRESET REGEN]` payloads with `.slice(0,80)` calls).
- `ImageUpload.tsx` — the per-file `📦 Compressed:` log (four divisions + three `.toFixed()`, per
  image, inside the chunked upload loop).
- `imageTransforms.ts` — the `[imgCache]` HIT/MISS logs (`.split('/').pop()` per image) and the
  crop-param strings.
- `tusUpload.ts` — the per-25%-milestone progress string and the per-6 MB-chunk PATCH log.

Emoji inside log strings and code comments were preserved verbatim (CLAUDE.md allows them there and
explicitly not in rendered UI).

### B12 · finding #2 — two unsynchronised writers to `workflow_state` · **half done, half proposed**

The finding conflates two defects. I fixed the one that can be fixed without changing semantics, and
am proposing the other.

**DONE — the lost update.** `removeItemsFromWorkflowBatch` was an unguarded read-modify-write on the
same blob App's auto-save blind-UPDATEs every 2 s, so the interleaving

```
Library READ blob → App UPDATE blob (new grouping) → Library UPDATE blob
```

silently discarded everything App wrote in between. It is now **compare-and-set**: the SELECT also
reads `updated_at`, the UPDATE carries `.eq('updated_at', <that value>).select('id')`, and a 0-row
result means someone wrote in between → **re-read and re-apply once**, then give up with a
`console.warn` rather than loop. The token is reliable because a BEFORE UPDATE trigger stamps
`updated_at = NOW()` on every write to this table (`create_workflow_batches.sql:98-109`) — I verified
the trigger exists rather than assuming it. Return type widened `void` → `boolean`; all four Library
call sites ignore it, so nothing broke. **On the normal path (no concurrent writer) the guard matches
first try and behaviour is unchanged**, one extra column in the SELECT aside. +7 tests.

**PROPOSED, NOT IMPLEMENTED — the resurrection**, which is the user-visible half. App's in-memory
store is never told about the deletion, so if the batch is OPEN its next auto-save re-adds the
deleted items within 2 s. No compare-and-set can fix that: the blob App writes is *newer*, it is just
wrong. The fix is the report's `onItemsDeleted` callback, and it is a deliberate behaviour change
(deleting an image in Library while its batch is open would start actually removing it), so it needs
the owner's call:

```ts
// LibraryProps, beside the existing onBatchDeleted (Library.tsx:70)
onItemsDeleted?: (ids: string[]) => void;

// Library — after each successful removeItemsFromWorkflowBatch(batchId, ids):
if (batchId === activeBatchId) onItemsDeleted?.(ids);

// App.tsx — mirror of handleBatchDeleted: prune the store so auto-save cannot re-add them.
const handleItemsDeleted = (ids: string[]) => {
  const gone = new Set(ids);
  const prune = (xs: ClothingItem[]) => xs.filter(i => !gone.has(i.id));
  setUploadedImages(prune); setGroupedImages(prune);
  setSortedImages(prune);   setProcessedItems(prune);
  autoSaveWorkflow({ processedItems: prune(processedItemsRef.current) } as never);
};
```

Library also still **discards** the `false` return — a lost race is only visible in the console. It
already has a `.library-delete-error` banner for `deleteWorkflowBatch`; routing this through it is a
small, safe follow-up I left out because it is a UI change.

### B13 · §8 production-grade code not covered above

**`src/lib/presetResolver.ts` (§8.2) + 8 tests · done for the duplicate, SKIPPED for the N+1.**

`resolvePreset(presets, categoryName, { allowDefaultPrefix })` replaces both matchers:
`CategoryZones.findPreset` (4 steps, passes `allowDefaultPrefix: true` to keep the
`<name>_default_<rand>` step that `createCategory` produces) and the 3-step matcher inside
`applyPresetToProductGroup` (no prefix — it never had that step and must not gain it). A third
difference the report did not mention: CategoryZones spelled "active" as `is_active !== false`,
`applyPresetToGroup` used truthiness. Those agree for every value `CategoryPreset` permits
(`is_active: boolean`, non-optional), so the resolver uses `!== false`.

**SKIPPED: rewiring PDG's per-navigation `applyPresetToProductGroup` call.** The report's finding #3
targets two sites. The loop at `:773` — the actual O(groups) mount storm — **was already fixed by the
perf pass** (it hoists one `getCategoryPresets()` for the whole pass). The remaining site is the
per-*navigation* auto-apply, which fetches once per group change, not once per group. Passing the
mount-loaded `availablePresets` there would make it cheaper **and would change freshness**: the
current code re-reads on every navigation, so it sees a preset edited elsewhere mid-session. The
perf pass hit the same question at `:773` and chose to re-fetch for exactly that reason. Changing it
is a judgement call about staleness, not a refactor, so I left it.

**`src/lib/chunk.ts` (§8.1's other half, duplicate #8) + 7 tests · done, 18 loops in 6 files.**

`ID_CHUNK = 100` and `chunked(xs, size = ID_CHUNK)` replace 18 hand-written
`for (let i = 0; i < xs.length; i += N)` loops spelled six different ways (`DELETE_CHUNK_SIZE`,
`CHUNK`, `OCHUNK`, and bare `100` literals): `App.tsx` 10, `workflowBatchService.ts` 4,
`Library.tsx` 2, `productService.ts` 2, `storageSafety.ts` 1. The two EXIF-rescan loops pass an
explicit `5` with a comment, because they bound **concurrency**, not URL length — that distinction
was invisible when both were bare literals. Tests pin the boundary cases the old loops each had to
get right independently (0, 1, 99, 100, 101) and assert a nonsense size throws instead of looping
forever.

**Not attempted** (large, and each needs characterization tests first — §7 Steps 4 and 5):
`batchRestore.ts` (splitting `handleOpenBatch` + startup restore, ~900 lines), and migrating
`ImageGrouper` off its third copy of the item list. Finding #6 (PDG's save effect keying on raw
`[processedItems]`) is also untouched — the report itself says it needs a locking test first, and it
is the path the June 2026 persistence saga fixed.

---

## Files added / changed / deleted

**Added (7):** `src/lib/storageUrls.ts` · `src/lib/storageUrls.test.ts` ·
`src/lib/productRow.ts` · `src/lib/productRow.test.ts` · `src/lib/presetResolver.ts` ·
`src/lib/chunk.ts` · `src/lib/chunk.test.ts`

**Changed (20):** `public/sw.js` · `index.html` (one stale comment) · `src/App.tsx` ·
`src/main.tsx` · `src/components/{Library.tsx, Library.css, ImageGrouper.tsx, ImageUpload.tsx,
ProductDescriptionGenerator.tsx, CategoryZones.tsx, GoogleSheetExporter.tsx}` ·
`src/lib/{workflowBatchService.ts, slimItems.ts, libraryData.ts, productService.ts, tusUpload.ts,
imageTransforms.ts, storageSafety.ts, applyPresetToGroup.ts, colorDatabase.ts,
testing/supabaseMock.ts}`

**Test files extended (3):** `workflowBatchService.test.ts` · `slimItems.test.ts` ·
`applyPresetToGroup.test.ts`

**Deleted (20 files + 1 export):** see B10.

---

## CLAUDE.md sections that now need updating

I did not edit `CLAUDE.md`. These are the specific edits it needs:

1. **§5 folder structure — remove the deleted entries.** All six dead components and their `.css`,
   `src/hooks/useUserPresence.ts` (and the `hooks/` directory), `src/services/api.ts` (and
   `services/`), `lib/huggingfaceService.ts`, `lib/brandMatcher.ts`, `lib/constructionDatabase.ts`,
   `lib/fitConditionDatabase.ts`, `lib/exportLibraryService.ts`, and the root
   `huggingface-proxy.cjs`. Also delete the **"Dead/unused components"** paragraph beneath the tree
   — there are none left.
2. **§5 folder structure — add:** `lib/storageUrls.ts`, `lib/productRow.ts`,
   `lib/presetResolver.ts`, `lib/chunk.ts`. (And from the perf pass, still missing:
   `lib/workflowBackup.ts`.)
3. **§11 helper names.** `slim()` → the whitelist is unchanged, but add: the four DB-row→item copies
   are now `productRowToClothingItem` / `mergeProductRowIntoItem` in `lib/productRow.ts`, **and the
   two restore paths' seven documented divergences are now the `MergeProductRowOptions` presets**.
   The `storagePath → getPublicUrl` reconstruction sentence should name `publicImageUrl`
   (`lib/storageUrls.ts`) as the single seam. The `DELETE_CHUNK_SIZE = 100` paragraph should name
   `ID_CHUNK` / `chunked` (`lib/chunk.ts`) — the warning "do NOT remove the chunking loop" still
   applies, it is just one loop now.
4. **§7 data models.** `SlimItem` no longer exists; `workflow_state.processedItems` is
   `PersistedWorkflowItem[]` (`lib/slimItems.ts`). The `WorkflowBatch` entry should say so.
5. **§14 known bugs — resolved:** **#5** (the `workflow_state` type mismatch and the
   `as ClothingItem[]` casts — now one named widening, `asClothingItems`); **#15** (raw
   `console.log`) is now genuinely closed for `src/` — one gated `console.table` remains by design,
   so the item should say that rather than being deleted; **#3** and **#4** (`SavedProducts.tsx` and
   `services/api.ts` are dead code) — both files are gone.
6. **§14 — new/updated entries worth adding:** `fetchWorkflowBatches` silently truncated at 1000
   batches (now paginated); `removeItemsFromWorkflowBatch` is compare-and-set but the **item-level
   resurrection is still open** (B12's proposal).
7. **§16 in-progress table.** "Automated tests — Missing" is long stale (505 tests). The
   `exportLibraryService.ts` row ("Export library tracking — Partial") should become **Removed** —
   the file is deleted. Add a row for the `onItemsDeleted` proposal.
8. **§3 test coverage list — add:** `storageUrls.test.ts`, `productRow.test.ts`, `chunk.test.ts`,
   and the new suites inside `workflowBatchService.test.ts` (pagination + compare-and-set),
   `slimItems.test.ts` (the unified type) and `applyPresetToGroup.test.ts` (`resolvePreset`). Note
   that `src/lib/testing/supabaseMock.ts` now records `.range()`.
9. **§18 Do Not — worth adding two:** (a) do not remove the `.eq('updated_at', …)` guard from
   `removeItemsFromWorkflowBatch` — it is what stops the blob lost-update; (b) do not give the
   Step-3 preset paths `allowDefaultPrefix` — only CategoryZones had that 4th match step.
10. **§2 tech stack / §9 integrations.** The Hugging Face / Llama Vision and OpenAI rows describe
    code that no longer exists (`huggingfaceService.ts`, `services/api.ts`, `huggingface-proxy.cjs`,
    `TestLlamaVision.tsx`). `VITE_OPENAI_API_KEY` and `VITE_GOOGLE_VISION_API_KEY` in §4 now have
    **no consumer at all** and should be marked dead like the other four.
