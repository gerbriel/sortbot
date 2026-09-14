# 03 — performance review: implementation log

Source: `docs/reviews/03-performance.md` (+ `03-performance-memory-bundle.md`). Nothing was
committed. The bug-fix pass logged in `02-debugging-fixes.md` had already landed in most of
these files, so every site was re-located by reading the current code rather than by the line
numbers in the perf report.

Scope was the seven-step brief, not all 45 findings. Findings outside it are listed under
**Not in scope** so the orchestrator can see what is still on the table.

---

## Gates

| Gate | Before | After |
|---|---|---|
| `npm test` | 357 passed / 29 files | **427 passed / 32 files** (+70: 12 imageTransforms, 12 workflowBackup, 5 slimItems, +14 from the pagination/upsert pass, rest another agent's) |
| `npm run build` | clean | **clean** (`tsc -b && vite build`) |
| `npx eslint .` | **302 problems** (286 errors, 16 warnings) | **301 problems** (285, 16) — *below* baseline |
| per-file lint, every file touched | App 66 · Grouper 9 · CategoryZones 3 · Library 33 · PDG 24 · ImageUpload 5 · GSE 0 · SupportWidget 0 · slimItems 0 · libraryData 0 · applyPresetToGroup 3 · workflowBatchService 4 | **identical, every file** — zero findings on any line added. The 4 new files (`workflowBackup.ts`, `workflowBackup.test.ts`, `imageTransforms.test.ts`, + test additions) are at **0**. |

Per-file baselines were measured against `git show HEAD:<file>` piped through
`eslint --stdin --stdin-filename`, because several of these files were already dirty from the
debugging pass when this one started.

### Bundle, measured (`npm run build`, vite 7.3.1)

| File | before raw | after raw | before gzip | after gzip |
|---|---|---|---|---|
| `index-*.js` (**main**) | 1,249.53 kB | **872.73 kB** (−376.80, **−30.2 %**) | 363.42 kB | **256.75 kB** (−106.67, **−29.4 %**) |
| `index-*.css` (render-blocking) | 188.65 kB | **112.50 kB** (−76.15, **−40.4 %**) | 30.01 kB | **19.57 kB** (−34.8 %) |
| new: `jszip.min-*.js` | — | 97.15 kB | — | 30.09 kB |
| new: `full.esm-*.js` (exifr) | — | 75.29 kB | — | 26.51 kB |
| new: `Library-*.js` / `.css` | — | 62.25 / 21.66 kB | — | 17.78 / 4.36 kB |
| new: `OrgPanel-*.js` / `.css` (carries CrmPanel + AnalyticsPanel) | — | 58.21 / 17.80 kB | — | 15.92 / 3.36 kB |
| new: `KanbanBoard-*.js` / `.css` | — | 36.97 / 17.61 kB | — | 10.84 / 3.21 kB |
| new: `CategoryPresetsManager-*.js` / `.css` | — | 30.91 / 7.46 kB | — | 7.04 / 1.65 kB |
| new: `VocabDashboard-*.js` / `.css` | — | 21.26 / 7.20 kB | — | 5.17 / 1.60 kB |
| new: `CategoriesManager-*.js` / `.css` | — | 5.78 / 5.07 kB | — | 1.96 / 1.21 kB |
| unchanged | `builtinBrandVocab` 361.35 · `tusUpload` 61.77 · `brandCategorySystem` 29.55 | same | | |

First paint now parses **872 kB of JS + 112 kB of CSS** instead of 1,250 + 189. The CSS drop came
free with the lazy components — each modal's stylesheet followed its chunk (part of F25).

### Micro-benchmarks (node 22 / V8, n = 1,500, mean of 20 runs)

| Operation | as written | after | factor |
|---|---|---|---|
| 1,500 Step-2 card date labels | **84.56 ms** | **0.07 ms** | **1,130×** |
| ↳ intermediate (hoisted `Intl` only, i.e. a cold cache) | | 1.95 ms | 43× |
| 1,500-item name sort comparator | 3.83 ms | 0.20 ms | **18.9×** |
| `workflow_state` payload, 1,500 items | **1,066 KB** | **508 KB** | **−52.3 %** |
| 1,500 `en-CA` filter keys | 0.78 ms | 0.90 ms | **1.0× (neutral — see F1 row)** |

The payload figure reproduces the report's independently measured 1,067 KB, which is a good sign
the model matches production.

---

## Per finding

### 1 — cheap, zero-risk wins

| # | Status | Files | Notes |
|---|---|---|---|
| **F1** — 2 uncached `Intl` formats per card per render | **Fixed** | `src/components/ImageGrouper.tsx` (module-scope `CARD_DATE_FMT`, `CARD_TIME_FMT`, `FILTER_DATE_FMT`, `EN_CA_DATE_FMT`, `NAME_COLLATOR`; memoized `captureLabel(ts)`; card JSX, filter-dropdown label, filter date keys) | 84.56 → 0.07 ms per grid render. The label cache is keyed by the raw timestamp so it is bounded by distinct capture times, and cleared wholesale past 5,000 entries (it is a pure function of `ts`, so a drop only costs a re-derive). Output is byte-identical: the card previously rendered three text nodes (`date`, `' '`, `time`), now one string with the same content. **One sub-change measured neutral and was kept anyway:** `toLocaleDateString('en-CA')` with *no* options already hits V8's formatter cache, so routing the filter keys through `EN_CA_DATE_FMT` is a wash (0.78 → 0.90 ms) — kept so all date formatting in the file lives in one place. |
| **F17** — `localeCompare` with an options object, ~17,700 collator builds per sort | **Fixed (bundled with F1)** | same file | Not in the brief, but `nameKey`/`naturalCompare` sit in the same three lines as the label change and `Intl.Collator(l, o).compare` is spec-equivalent to `String.localeCompare(x, l, o)`. Both hoisted to module scope (they are pure functions of the item and closed over nothing), which also stops re-allocating two closures per render. 18.9×. |
| `revokeObjectURL` after the CSV download (**F41**) | **Fixed** | `src/components/GoogleSheetExporter.tsx` | Revoked on a `setTimeout(…, 0)` rather than synchronously after `click()`: Safari can still be reading the href when `click()` returns. |
| unmount cleanup for `autoScrollRafRef` | **Fixed** | `src/components/ImageGrouper.tsx` | The auto-scroll loop re-queues itself every frame and was only cancelled by `handleReorderDragEnd`; a drag interrupted by an unmount (batch switch remounts via the `key` prop) left a 60 fps rAF running for the tab's life against a detached node. The rubber-band's own rAF was already covered by its effect cleanup, which React also runs on unmount — noted in a comment so nobody "fixes" it twice. |
| unmount cleanup for App's `autoSaveTimerRef` / `groupUpsertTimerRef` / `chunkTimerRef` | **Fixed** | `src/App.tsx` (new teardown effect) | Same effect also owns the unload backup flush (below), so the two concerns that both mean "the page is going away" live in one place. |
| **F6** — `makeBatchName` per item | **Fixed** | `src/lib/libraryData.ts` | Memoized per batch id (`batchNameFor`) **and** hoisted out of both per-item loops. The memo is what fixes the third call site, which looks a batch up per `product_images` row (up to 20,000). Cache is function-local, so a renamed batch is never served stale. ~2.0 s → ~0 per `loadAll`. |
| **F12 / debugging #18** — per-item `console.log` in restore + PDG persistence | **Fixed** | `src/App.tsx` (hydration `mergeDB`), `src/components/ProductDescriptionGenerator.tsx` (9 sites: `debouncedDirectSave`, the 500 ms effect, `handleTableFieldChange`) | Routed through `log.app` / `log.pdg`. **`log.*` alone is not sufficient** and the report is right about why: it early-returns when disabled but its arguments are evaluated eagerly, so the 15-field object literal with its `.slice()` calls would still be built. Every log that constructs an object is wrapped in `if (isDebugEnabled())`; the string-only ones just became `log.*`. Genuine `console.error` on failure paths was left alone. |

### 2 — data-loss-grade 1,000-row caps (**F13**, **F14**)

| Site | Status | Notes |
|---|---|---|
| `workflowBatchService.deleteWorkflowBatch` — `products` id read | **Fixed** | Paginated with `.range()` in 1,000-row pages + iteration guard, same idiom as `libraryService.fetchSavedImages`. This was the one that **permanently orphaned 500 of 1,500 products' images and storage files**, and handed `filterUnreferencedStoragePaths` a partial deletion set so it also *kept* files it should have deleted. A new `productIdsComplete` flag mirrors the existing `imageLookupComplete`: an incomplete read now deletes DB rows but leaves storage untouched, rather than guessing from a partial set. |
| `App.tsx` startup-restore DB hydration (`hydrateSelect`) | **Fixed** | Paginated. A 1,500-item batch was hydrating its first 1,000 items; the other 500 silently lost every DB-backed field (description, price, tags…) on every reload. |
| `App.tsx handleOpenBatch` — `savedProducts` (`slimProductSelect`) | **Fixed** | Paginated. Same truncation, *plus* the gap-fill safety cap (§11) was judging the missing 500 against that partial view. |
| `App.tsx pruneStaleProducts` | **Fixed** | Paginated. Under-deleted rather than over-deleted, so not destructive — but stale rows past row 1,000 were never pruned. |
| `App.tsx` startup DB-fallback stage 2 — `products.in('product_group', …)` and `product_images.in('product_id', …)` | **Fixed (F14)** | Both chunked at 100, matching `DELETE_CHUNK_SIZE`. Unchunked these build a multi-KB URL that PostgREST answers with a 400/414. |
| `productService.fetchUserProducts`, `deleteProduct` (read + `storage.remove`), `syncGroupFieldsToDatabase` mirror `.in('id', …)` | **Fixed** | Three sites beyond the named line numbers, same two bug classes. `fetchUserProducts`/`deleteProduct` are only reachable from the dead `SavedProducts.tsx` (verified by grepping every importer), so these are correctness fixes with no live perf impact. |
| `workflowBatchService`'s four other bulk lists | **Already correct** | The debugging pass had chunked them at 100; now pinned by tests (`inSizes()`) instead of changed. |
| `fetchWorkflowBatches` / `fetchWorkflowBatchesMeta` | **Skipped, deliberately** | Capped at 1,000 *batches* per workspace, and ordered `updated_at DESC`, so truncation hides the oldest batches rather than destroying anything. Paginating would multiply an already ~54 MB blob read; the report's own recommendation (F11 + retiring the `workflow_state` blob) is the right fix. **Left for the orchestrator.** |

New helper `readAllPages()` in `App.tsx` drains a ranged select generically. It is typed
generically (no `any`) and returns `{ rows, error }` so a mid-pagination failure degrades to
"partial, and we know it" rather than pretending to be complete.

### 3 — memory

| # | Status | Files | Notes |
|---|---|---|---|
| **F5** — unbounded `_imgCache` (24 GB at 1,500; tab OOMs at ~130–250) | **Fixed** | `src/lib/imageTransforms.ts`, `src/lib/imageTransforms.test.ts` (new, 12 tests) | Byte-budgeted LRU: `IMG_CACHE_MAX_BYTES = 512 MB`, each entry charged `naturalWidth*naturalHeight*4` (4 MB fallback for unknown dimensions), reads move the key to the MRU end, inserts evict from the front until the new entry fits, and an image larger than the whole budget is simply not cached (so the eviction loop can never spin). `evictCachedImage` now decrements the byte total and is idempotent. `createTransformedFile` is byte-for-byte unchanged, and a cache miss is exactly the never-cached path — a re-fetch — so the paste-crop batch never *depends* on residency. The code comment claiming a decoded bitmap's footprint was "manageable" was replaced with the real RGBA arithmetic. |
| **F10** — `markCompressed` O(n) per image ⇒ O(n²) per batch | **Fixed** | `src/components/ImageUpload.tsx` | One lazy hydration per session, an in-memory `Set` (O(1) per image), one coalesced write. Explicit `flushCompressedPaths()` at the end of `processFiles` and `recompressExisting`, a `pagehide`/`beforeunload` listener, and a 2 s timer as the backstop. **Quota errors are now warned about once per session** instead of swallowed by a bare `catch {}` — the old behaviour let the registry die silently and the recompress buttons start re-doing the entire 4,854-file bucket with no clue why. `sortbot_compressed_paths` is untouched as a key name (§1). ~2.4 GB of string churn + ~810 MB of blocking `setItem` per 1,500-image batch → one write. |
| **F7** — the un-debounced 393 KB synchronous `sortbot_workflow_backup` write | **Fixed** | new `src/lib/workflowBackup.ts` + `workflowBackup.test.ts` (12 tests); wired in `src/App.tsx` | Extracted to its own module so the throttle is testable (App has no component harness). **Trailing throttle, not a debounce**, which is the load-bearing detail: a debounce would keep pushing the deadline out under a continuous stream of clicks and the guarantee would evaporate exactly when the user is busiest. The window is 1 s, the newest payload scheduled inside it wins, and `flushWorkflowBackup()` — wired to `pagehide` **and** `beforeunload` (pagehide is the dependable one; beforeunload does not fire reliably on back-button nav or bfcache) — writes immediately, so the worst case is still "everything up to the moment the tab went away". `cancelWorkflowBackup()` is called in `handleBatchDeleted` **before** its `removeItem`, because a queued write landing afterwards would resurrect the deleted batch's backup — the §15 "deleted batch returns" bug through a new door. Tests cover: no synchronous write, 50 calls → 1 `setItem`, last-payload-wins, throttle-vs-debounce (a steady stream still writes), fresh window, null payload, flush-writes-pending, flush-is-idempotent, flush-consumes, cancel, quota warned not swallowed, throwing builder contained. |

### 4 — payload (**F8**) — **contract change, see below**

**Fixed** — `src/lib/slimItems.ts`, `src/lib/slimItems.test.ts` (5 new tests), plus one follow-on
in `src/lib/workflowBatchService.ts`.

`slimForWorkflowState` now omits `imageUrls` and `thumbnailUrl` **when `storagePath` is present**,
and keeps them when it is not. Measured **1,066 KB → 508 KB (−52.3 %)** per autosave PATCH at
n = 1,500, on a payload that is re-uploaded every 2 s and TOASTed + WAL-logged by Postgres each
time.

Verified by reading every restore path before making the change — all four rebuild both fields
from `storagePath` and **discard** whatever was saved:

- `App.tsx` startup restore — the code's own comment is *"If we have a storagePath, rebuild
  imageUrls entirely from it (ignore saved value)"*; `thumbnailUrl` via `getThumbnailUrl`. This
  path is a literal no-op difference.
- `App.tsx handleOpenBatch` — `item.imageUrls?.length ? item.imageUrls : [reconstructed]`,
  `thumbnailUrl` from `storagePath`.
- `App.tsx handleImagesGrouped` — collapses `imageUrls` to `[canonicalUrl]` built from
  `storagePath` on **every** Step-2 action, which is the app already declaring the field
  non-durable.
- `lib/libraryData.ts` pass 1, both the group and imageList builders — `getPublicUrl(storagePath)`
  when preview/imageUrls are empty.

`getThumbnailUrl` ignores its `_size` argument (transforms need a paid plan), so with a
`storagePath` all three fields are the same string. `ultraSlimForBackup` has never carried either
field, which is the same bet, already in production.

**Two consequences worth knowing:**

1. **One follow-on fix was required.** `createWorkflowBatch` derived `thumbnail_url` from
   `firstItem.imageUrls[0]`, so every *new* batch row would have started writing `null` there.
   It now falls back to `getPublicUrl(firstItem.storagePath)`. (`thumbnail_url` is written and
   copied by `duplicateBatch` but never actually rendered — Library derives thumbnails through
   `deriveLibraryData` — so this was a latent-column fix, not a visible one.)
2. **The only observable delta** is a group-*leader* item whose persisted `imageUrls` held more
   than one URL (the startup-hydration merge sets it to the leader's whole `product_images` list).
   Such an item now restores with one URL instead of N. Nothing reads `imageUrls[1+]` on a
   restored item: the CSV's multi-image list is built as `group.map(item => resolvePublicUrl(item))`
   — one URL **per group member**, not from one item's array — and `handleImagesGrouped` collapses
   the array to one element on the next Step-2 action anyway.

> **AGENTS.md §11 needs updating** (orchestrator): the `slim()` whitelist paragraph should say
> `imageUrls`/`thumbnailUrl` are persisted **only for items with no `storagePath`**, and that
> anything reading `workflow_state` must reconstruct both from `storagePath` — which §11 already
> requires for `preview`. The §18 #5 warning ("do not call `slim()` without understanding what it
> strips") now covers five fields, not three.

### 5 — rendering

| # | Status | Files | Notes |
|---|---|---|---|
| **F3** — rubber-band: `setSelectionBox` per mousemove *and* per rAF frame | **Fixed** | `src/components/ImageGrouper.tsx` | `selectionBoxRef` is now the **source of truth** (it used to be a per-render mirror of the state; the relationship is inverted). `mousemove` and the auto-scroll step write only the ref; the rAF loop that was already running for the duration of the drag flushes it to state **at most once per frame**, and skips the commit entirely when the rect has not moved (`paintedSelectionBoxRef`). Both mouseup paths and mousedown clear both refs, so a rect can never bleed across drags. One behavioural nuance, in the safe direction: mouseup now reads a rect that includes the final sub-frame of movement, where before it read the state mirror (up to one frame stale). Also hoisted the loop-invariant `containerRef.getBoundingClientRect()`/`scrollLeft`/`scrollTop` out of both intersection loops — 3,000 forced reflows for 1,500 cards become 1,501. **I implemented the brief's rAF-coalesced variant, not the report's fully-imperative one** (paint the box via a DOM ref, zero renders during a drag): the coalesced version keeps the rect in React state, so the two render sites and the `selectionThresholdMet` gate are untouched and there is nothing to get visually wrong. The imperative version remains available as a further step. |
| **F2** — nothing memoized, every callback prop a fresh arrow | **Fixed** | `src/App.tsx` + `ImageGrouper`, `CategoryZones`, `ProductDescriptionGenerator`, `GoogleSheetExporter`, `SupportWidget`, `Library` | `React.memo` on all six, plus a `useEventCallback` helper in App that gives every handler prop a permanently stable identity while always invoking the newest closure. **I used `useEventCallback` rather than `useCallback([deps])` deliberately**: given this codebase's stale-closure history (§14 #14; `aae35fc`, `993c0cf`, `b0a41a6`), a wrong dep list silently freezes state, whereas this construction can only ever call the latest render's function — semantics identical to the inline arrow it replaces, only the identity is now constant. It is implemented as `useCallback((...a) => ref.current(...a), [])` with the ref assigned in a layout effect; the first draft read `ref.current` during render and `react-hooks/refs` correctly rejected it (+1 error), which is how the current shape was arrived at. `step2Items` names the already-stable store array; `step4ExportItems` replaces an inline IIFE that minted a new array every render (that alone defeated any memo on the exporter and re-ran its whole group/coalesce/dedup/54-column-preview pipeline). Handlers declared after the early `loading`/`!user` returns (where no hook may go) are reached through a thin arrow resolved at call time. **Zero new `exhaustive-deps` warnings; no disable comments added.** |
| **F38** — `onActionsReady` pushes a fresh object into App state per selection change | **Fixed** | `src/components/ImageGrouper.tsx` | The bundle is now `useMemo`'d on `selectedItems.size` — the only field the parent renders — so a selection change that preserves the count makes `setGrouperActions` a no-op React bails out of. Every method delegates through `actionImplRef`, refreshed on **every** render, so a memoized bundle can never hold a stale closure (the whole reason the old code rebuilt the object each time). When the count *does* change App still gets a second render pass, but `memo(ImageGrouper)` now bails out of it, so the 1,500-card grid is no longer rebuilt. The render-phase ref write matches ~10 existing ones in this file. Bonus: `onStatsChange` is stable now, so the stats effect finally settles instead of re-firing every render. |

**Stale-closure reasoning pass** (asked for explicitly). Every prop each memoized child receives:

- `ImageGrouper` — `items` = `step2Items` (a store array, identity stable between store updates);
  `userId`/`batchId` primitives; `onSelectionChange`/`onActionsReady` are `useState` setters
  (permanently stable); `onGrouped`/`onStatsChange`/`onImageDeleted` are `useEventCallback`
  (stable identity, newest closure). It reads nothing from App other than props.
- `CategoryZones` — same `items`; `compactMode` literal; `selectedItemIds` is App's `Set` state,
  whose identity changes exactly when the selection does, so it still re-renders then.
- `ProductDescriptionGenerator` — subscribes to `workflowStore` itself, so it still re-renders on
  every item change, as it must; the memo only stops it re-rendering for a toast or a Step-2
  selection. `descriptionSettings` is state, `batchId` a primitive.
- `GoogleSheetExporter` — `items` memoized on `processedItems`; `vendorName` a string (compared by
  value); `ref` is not part of memo's comparison.
- `Library` / `SupportWidget` — primitives and stable callbacks only.

The one construct that *could* freeze state is the F38 `useMemo`, and that is why its methods all
go through a ref refreshed every render rather than capturing the callbacks directly.

### 6 — network

| # | Status | Files | Notes |
|---|---|---|---|
| **F4** — `saveBatchToDatabase`: one awaited `product_images` upsert **per image** | **Fixed** | `src/lib/productService.ts`, `productService.test.ts` | The loop now only prepares rows; one chunked upsert (≤100 rows/request) runs after it. Round trips for 1,500 images / 375 groups: **1,875 → 750** (per group 5 → 2; a pathological 1,500-photo group goes 1,501 → 16). Row content is byte-identical and an upsert error still fails the whole group, so the `success`/`failed` tallies are unchanged. **`buildProductImageRow()` was deliberately NOT substituted** despite the report suggesting it: it sets `product_id: item.id` (not the group leader — debugging findings 2/16), `storage_path: item.storagePath` (not the path just uploaded to), a different `alt_text`, and an extra `original_name`. Using it would have changed what lands in the DB, which the no-behaviour-change gate forbids; the inline literal was kept with a comment saying why. Cross-group batching and bounded concurrency over groups were **not** done — the first breaks per-group accounting, the second is out of scope; both are the remaining path from 750 to ~380. One nuance: if the DB write fails, all N photos of that group have already been uploaded to Storage (the per-image `throw` used to abort the loop part-way). The group outcome is identical; only the number of orphaned files on a *failed* group changes. |
| PDG's per-group `getCategoryPresets()` | **Fixed** | `src/lib/applyPresetToGroup.ts`, `src/components/ProductDescriptionGenerator.tsx` | `applyPresetToProductGroup` gained an optional 4th arg `presetsIn`; the initial-load pass fetches the list **once** and passes it to all groups. **375 awaited round trips → 1** for a 1,500-image batch. Resolution logic is untouched, and the list is genuinely *fetched* (not reused from the already-loaded `availablePresets` state) so the data is exactly as fresh as before. This is the same shape as the freezes fixed in `55a46f0` / `b0a41a6`. |

### 7 — bundle

| # | Status | Files | Notes |
|---|---|---|---|
| **F23** — eager `exifr` (statically imported twice) and `jszip` | **Fixed** | `src/App.tsx`, `src/components/ImageUpload.tsx` | The brief only named App's gratuitous `import exifr`, but removing that alone buys **nothing**: `ImageUpload` statically imported it too, and `ImageUpload` is statically imported by App. Both are now cached lazy loaders (`loadExifr`, `loadJSZip`), so exifr (75.29 kB chunk) loads only when an EXIF rescan actually runs and jszip (97.15 kB chunk) only on the ZIP path. `jszip`'s `.d.ts` uses `export = JSZip`, so the loader resolves `default` inside itself and the class is imported type-only. `react-dropzone` was left in main — it is needed for the Step-1 dropzone at first authenticated paint. |
| **F24** — modal/founder surfaces in the main chunk | **Fixed** | `src/App.tsx` only | `React.lazy` + `Suspense` for `Library`, `CategoriesManager`, `CategoryPresetsManager`, `OrgPanel`, `VocabDashboard`, `KanbanBoard`. `CrmPanel` and `AnalyticsPanel` follow into `OrgPanel`'s chunk automatically (it is their only importer) — **`OrgPanel.tsx` itself was not touched**, per the coordination rule. `Landing`/`Auth`/`WaitlistGate` stay eager: they *are* the first paint. The fallback (`OverlayFallback`) reuses the existing `.loading-screen` + `.spinner` classes, so no new CSS. |
| **F25** — 188 kB render-blocking stylesheet | **Partially fixed, for free** | — | Each lazy component's co-located CSS followed its chunk: main CSS **188.65 → 112.50 kB (−40 %)**. The remaining 112 kB is the four-step flow's own CSS, which F25's full fix would attack separately. |

---

## Not in scope / skipped, with reasons

| # | Why not |
|---|---|
| **F18** — preview table renders *all* products × 54 columns, uncapped | The `useMemo` half is largely delivered by F2 (the exporter is memoized and its `items` prop is now stable, so the pipeline and the ~20,250 `<td>`s are built when items change, not on every App render). The **row cap was deliberately not added**: it is a visible change (fewer preview rows) and the gate for this pass is no behaviour change — even though AGENTS.md §15 already *claims* "shows up to 10 products", so arguably the uncapped render is the regression. Exact code is in **Deferred** below. Wrapping the in-component pipeline in its own `useMemo` was also skipped: it is ~100 lines of interdependent consts feeding `rawProducts`, and the remaining re-runs are only the component's own two state updates per mount. |
| **F36** — `console.log(..., new Error().stack)` on every selection update; **F19** — 6–9 logs per image in `imageTransforms` | Outside the brief's "App restore/merge and PDG persistence" scope. Both are one-line deletions/`log.*` swaps and remain good next candidates. (The imageTransforms agent did retune one existing `[imgCache]` log to report the new byte accounting rather than a now-meaningless size.) |
| **F9** (`fetchStorageUsage` ~2,500 sequential requests), **F11** (Library select-narrowing), **F15**, **F16**, **F20**–**F22**, **F26**–**F37**, **F39**, **F40**, **F42**–**F45** | Not in the seven-step brief. F16 (`updateGroupField` mutating live store objects in place) is worth flagging as the natural next step: it is what blocks *per-item* memoization, and F2 has now made everything above it memoizable. |
| Restoring the React-Compiler purity guard (hoisting ImageGrouper's three in-body `await import(...)`) | Not in the brief, and it would change how those dynamic imports are structured in a file this pass already edited heavily. Worth doing on its own — the report is right that clean lint on `ImageGrouper`/`CategoryZones`/`PDG` is currently *not* evidence of render purity. |
| Virtualization / windowing | Explicitly ruled out by the report (no new dependencies). |

---

## Deferred to the orchestrator

### `public/sw.js` (security agent is editing this file — F26)

Three changes, in the order they matter. Cache Storage currently has no entry or byte cap and is
pruned only on `activate`, reaching ~6.3 GB after 10 × 1,500-image batches — at which point
Chrome/Safari evict the **whole origin bucket**, taking useful recent entries with it, so the
stale-while-revalidate hit rate collapses exactly at scale.

**(a) Stop re-fetching on every cache hit.** `refreshInBackground` currently fires a second
`fetch` + `arrayBuffer()` + `cache.put` on *every* hit, so the 800-revalidation storm the SW was
built to prevent still happens — just off the critical path (1,500 extra requests and ~600 MB of
rewrite churn per page load). Revalidate only past a staleness floor. In `handleImageRequest`,
replace:

```js
    if (age < MAX_AGE_MS) {
      // CACHE HIT (fresh) — return immediately, refresh in background
      refreshInBackground(cache, request, cacheKey);
      return cached;
    }
```

with:

```js
    if (age < MAX_AGE_MS) {
      // CACHE HIT — revalidate only once the entry is past the staleness floor.
      // Product images are immutable per storage_path (a re-crop writes a NEW path),
      // so a fresh entry has nothing to learn from the network. Refreshing on EVERY
      // hit re-issued one request per image per page load — the exact storm this SW
      // exists to prevent.
      if (age > REVALIDATE_AFTER_MS) refreshInBackground(cache, request, cacheKey);
      return cached;
    }
```

and add beside `MAX_AGE_MS`:

```js
const REVALIDATE_AFTER_MS = 24 * 60 * 60 * 1000; // 1 day: revalidate at most daily per entry
```

**(b) Cap the cache and prune on fetch, not only on activate.** Add:

```js
// Hard entry cap. 15 000 entries x ~400 KB = ~6 GB, which is past the point where
// Chrome evicts the whole origin bucket; 3 000 (~1.2 GB) keeps two full 1 500-image
// batches resident while staying inside every browser's per-origin budget.
const MAX_ENTRIES = 3000;
// Trim at most this many per fetch so pruning never blocks an image response.
const TRIM_PER_FETCH = 50;

/** Oldest-first trim to MAX_ENTRIES. cache.keys() returns insertion order, which is
 *  close enough to LRU here because storeInCache re-puts on refresh. */
async function trimCache(cache) {
  const keys = await cache.keys();
  const over = keys.length - MAX_ENTRIES;
  if (over <= 0) return;
  await Promise.all(keys.slice(0, Math.min(over, TRIM_PER_FETCH)).map((k) => cache.delete(k)));
}
```

and call it fire-and-forget after each successful store in `handleImageRequest`:

```js
    if (networkResponse.ok) {
      await storeInCache(cache, cacheKey, networkResponse.clone());
      void trimCache(cache);   // never awaited — must not delay the image
    }
```

**(c) Strip `_retry` as well as `t`.** `src/lib/imageTransforms.ts` appends `_retry=<attempt>`,
which `stripCacheBust` does not remove, so each retry mints a **new cache key for the same bytes**
(up to 4× duplication on a flaky batch). In `stripCacheBust`:

```js
    u.searchParams.delete('t');
    u.searchParams.delete('_retry');   // imageTransforms.ts retry suffix — same bytes, must share a key
```

### `docs/reviews/…` / AGENTS.md (this pass must not edit them)

1. **§11 slim contract** — see the F8 box above. This is the one documentation change that is
   load-bearing rather than cosmetic.
2. **§3 test coverage list** — add `imageTransforms.test.ts` (LRU), `workflowBackup.test.ts`
   (backup throttle), and the new `src/lib/workflowBackup.ts` module; note `slimItems.test.ts` now
   locks the derivable-field rule.
3. **§5 folder structure** — add `src/lib/workflowBackup.ts`.
4. **§14 #15** (raw `console.log` regression) — App's hydration storm and PDG's persistence logs
   are now behind `isDebugEnabled()`; `ImageGrouper`'s `[PICK]` logs and `imageTransforms`'
   `[imgCache]` logs are still unconditional.
5. **§16 / §18** — the modal surfaces are now `React.lazy`; anything added to that list needs a
   `Suspense` boundary. And a new invariant worth writing down: **props passed to the six memoized
   children must stay referentially stable** — a new inline arrow or inline array in one of those
   JSX blocks silently undoes F2 with no test failure to catch it.

### F18's row cap, if the orchestrator wants it

```diff
-                  {products.map((product, idx) => {
+                  {/* Capped at 10 rows, as AGENTS.md §15 already describes. Uncapped this
+                      built products x 54 <td> with per-cell inline styles — 20 250 cells at
+                      375 products — inside an always-mounted <details> that only CSS hides. */}
+                  {products.slice(0, 10).map((product, idx) => {
```

plus a `…and {products.length - 10} more` row beneath the table so the cap is visible rather than
silently misleading.
