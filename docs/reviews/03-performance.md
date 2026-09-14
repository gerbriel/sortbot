# Performance Review 03 — Acadia

Analysis only. No source file was modified. One production build was run to measure chunk sizes.

**Scope** — render path, CPU hot spots, network/DB cost, memory growth, bundle, startup.
**Working set** — n = 1,500 `ClothingItem`s in one batch (the documented upper bound), ~50 batches,
~8,000 `products`, ~20,000 `product_images`.
**Companion file** — `docs/reviews/03-performance-memory-bundle.md` (522 lines) holds the full
listener/timer/blob inventory, per-file CSS table, byte-offset map of the main chunk, and the
dead-code list. This document references it rather than repeating its tables.

---

## Measured baseline

### Bundle (`npm run build`, vite 7.3.1, 1,872 modules, 1.50 s)

| File | raw | gzip |
|---|---|---|
| `dist/assets/index-*.js` (**main**) | **1,243,045 B** | **358,019 B** |
| `dist/assets/builtinBrandVocab-*.js` | 361,354 B | 71,331 B |
| `dist/assets/tusUpload-*.js` | 61,578 B | 16,540 B |
| `dist/assets/brandCategorySystem-*.js` | 29,548 B | 8,448 B |
| `dist/assets/index-*.css` | **188,647 B** | 29,757 B |
| **Total** | **1,884,172 B** | **484,095 B** |

Four JS chunks. `vite.config.ts` has no `manualChunks`/`rollupOptions`. Rollup emitted the
500 kB-chunk warning. `App.tsx` contains no `React.lazy` and no dynamic component import.

### CPU micro-benchmarks (node 22 / V8, n = 1,500, mean of 20 runs)

| Operation | as written | optimal | factor |
|---|---|---|---|
| 1,500 × `toLocaleDateString` + `toLocaleTimeString` (Step-2 card labels) | **82.51 ms** | 0.07 ms (memoized) / 2.56 ms (hoisted `Intl`) | **1,180× / 32×** |
| `makeBatchName` × 75,000 (Library, per item) | **2,020 ms** | 1.09 ms | **1,850×** |
| sort 1,500 by `localeCompare(…,{numeric:true})` | 3.27 ms | 0.19 ms (reused `Intl.Collator`) | **17×** |
| `CategoryZones.handleCategoryClick` group resolution | 12.56 ms | 0.21 ms (prebuilt Map) | **60×** |
| `handleImagesSorted` merge (Map + 46-field overlay + spread) | 7.52 ms | — | — |
| startup `mergeDB` × 4 arrays (spread + 12 regex/item) | 8.66 ms | — | — |
| `handleImagesGrouped` pipeline (8 passes) | 1.69 ms | — | — |
| `slimForWorkflowState` + `JSON.stringify` | 1.00 ms → **1,067 KB payload** | ~0.5 ms / ~520 KB | **2× payload** |
| `ultraSlimForBackup` + `JSON.stringify` (synchronous localStorage) | 0.47 ms → **393 KB** | — | — |
| App Step-3 stats IIFE (per App render) | 0.18 ms | 0 (memo) | — |

### Lint signal

`npm run lint` → **311 problems (295 errors, 16 warnings)**; baseline is 228 `no-explicit-any`,
30 `no-unused-vars`, 13 `no-useless-escape`. Performance-relevant:

- **14 × `react-hooks/static-components`** in `ComprehensiveProductForm.tsx` (104, 134, 144, 148,
  160, 174, 182, 242, 248, 252, 262, 266, 296, 306) — `PresetBadge` is declared in the component
  body, so it is a **new component type every render**: all 14 badge subtrees unmount and remount
  on every keystroke and every magnifier mouse-move.
- **`react-hooks/set-state-in-effect`** at `LazyImg.tsx:30` — three unconditional `setState`s on
  mount, one extra render pass per image. **`react-hooks/refs`** at `Library.tsx:27-28`.
- **12 × `exhaustive-deps`**, several indicating real stale-prop capture (`ImageGrouper.tsx:965`,
  `:986`, `:1218`; `PDG:2070`).
- **Critical caveat:** the seven React-Compiler-backed purity rules are enabled at error level but
  **bail out silently on `ImageGrouper.tsx`, `CategoryZones.tsx` and `ProductDescriptionGenerator.tsx`**
  (verified by stdin probe: an identical render-phase ref write reports in a synthetic file and not
  in these). Clean lint on those three files is **not** evidence of render purity. In ImageGrouper
  the trigger is isolated to `await import(...)` in the component body (`:427`, `:467`, `:519`).
  So enabling React Compiler would skip exactly the three components that most need memoizing —
  manual `React.memo` is not optional.

### Logging that ships to production

**156 unconditional `console.*` calls**: `ImageGrouper 47 · App 29 · PDG 22 · ImageUpload 14 ·
imageTransforms 11 · workflowBatchService 7 · tusUpload 7 · productService 5 · api 5 · Library 3`.
Three sit inside per-item loops, which is what makes them a performance problem rather than noise
(F12, F19, F36).

`debugLogger.dbg()` early-returns when disabled, but **its arguments are evaluated eagerly at the
call site**: `App.tsx:1526` builds `[...new Set(items.map(...).filter(...))].join()` over 1,500
items on every category assignment with debug *off* (same at `App.tsx:1624`,
`ImageUpload.tsx:409`). AGENTS.md §5's "zero-cost when disabled" holds for formatting, not for
argument construction.

---

## Top findings

Impact = user-visible cost at n = 1,500. Effort S ≤ 1 h · M ≤ 1 day · L > 1 day.
Risk = chance of behavioural change.

| # | Impact | file:line | Issue | Fix | Effort | Risk |
|---|---|---|---|---|---|---|
| F1 | **High** | `ImageGrouper.tsx:2741,2743` | 2 uncached `Intl` formats per card per render → **82 ms** of pure date formatting per ImageGrouper render, and it renders on *every* App render | Precompute the label string once inside the existing `useMemo` at `:1939` | **S** | Low |
| F2 | **High** | `App.tsx:2791-2820`, `:2968`; no `React.memo` anywhere in the workflow | Nothing is memoized and every callback prop is a fresh inline arrow, so **one keystroke in Step 3 re-renders the whole 1,500-card Step-2 grid, CategoryZones and the 54-column export preview** | `React.memo` the four big children + stabilise handler identity | **M** | Med |
| F3 | **High** | `ImageGrouper.tsx:784`, `:743` | `setSelectionBox()` on **every** `mousemove` and **every** rAF frame → 60–120 full 1,500-card renders/second during a rubber-band drag | Keep the box in a ref, write `style` imperatively, `setState` only on mouseup | **M** | Med |
| F4 | **High** | `productService.ts:251-318` + `:351-366` | `saveBatchToDatabase` awaits one `product_images` upsert **per image** inside a sequential per-group loop → **~1,875 serial round trips ≈ 150 s** for one Save Batch | Collect rows, one chunked bulk upsert | **M** | Low |
| F5 | **High** | `imageTransforms.ts:17` | `_imgCache` is an unbounded `Map<string, HTMLImageElement>` for the tab's lifetime. Decoded RGBA = `w·h·4` → **16 MB/image, 24 GB at 1,500**. Tab OOMs at ~130–250 images | Byte-budgeted LRU (~50 entries), or `ImageBitmap` + `close()` | **M** | Low |
| F6 | **High** | `libraryData.ts:246` (also `:162`, `:277`) | `makeBatchName(batch)` called **per item**, not per batch → **~2.0 s of `Intl` work** inside every `Library.loadAll` when `batch_name` is null (common — AGENTS.md §14.6) | Hoist above the loop / memoize per batch id | **S** | None |
| F7 | **High** | `App.tsx:1819-1830` | The localStorage backup is **deliberately un-debounced**: a 393 KB `map` + `JSON.stringify` + synchronous `setItem` on every one of 7 call sites, i.e. every group/category click and every keystroke. `QuotaExceededError` swallowed at `:1834` | Debounce to ~1 s, or fold into the existing 2 s timer | **S** | Low |
| F8 | **High** | `slimItems.ts:41-43` | `imageUrls` + `thumbnailUrl` are **51 % of the 1,067 KB autosave payload** and both are byte-identical re-derivations of `storagePath` — restore rebuilds them from `storagePath` anyway (`App.tsx:686-695`) | Omit both when `storagePath` is present | **S** | Low |
| F9 | **High** | `App.tsx:301-322` | `fetchStorageUsage` lists the bucket root then issues **one more `storage.list()` per product folder** (folders always have `metadata: null`) → **~2,500 sequential requests** on every sign-in and after every upload | One recursive/paginated listing, or a stored counter | **M** | Low |
| F10 | **High** | `ImageUpload.tsx:38-44` | `markCompressed` re-parses + re-stringifies + re-writes the whole `sortbot_compressed_paths` array **per image** → O(n²): ~2.4 GB string churn + ~810 MB blocking `setItem` per 1,500-image batch | Keep the Set in memory, flush once per batch | **S** | Low |
| F11 | **High** | `libraryService.ts:102`, `:34`; `workflowBatchService.ts:100` | `Library.loadAll` = **34 serial-ish requests, ~54 MB of JSON parsed**. `select('*')` on `product_images` (20 k rows) with a doubly-nested embed; `select('*')` on `workflow_batches` ships **all 50 `workflow_state` blobs (~17.8 MB)** | Narrow the selects to the fields `deriveLibraryData` reads; drop the nested embeds | **M** | Low |
| F12 | **High** | `App.tsx:917-931` | `console.log('[HYDRATE] mergeDB MATCH', {...15 fields})` runs **per item × 4 arrays = 6,000 console calls** on every page restore, each building an object literal with `.slice()` calls | Delete the two log statements | **S** | None |
| F13 | Med | `workflowBatchService.ts:253`; `App.tsx:2079`, `:2096`, `:1195`; `productService.ts:376` | Five queries with **no `.limit()`/pagination against PostgREST's 1,000-row cap**. `deleteWorkflowBatch` silently misses 500 of 1,500 products (orphaning storage); `handleOpenBatch` hydrates only 1,000 of 1,500 items | Paginate with `range()`, or chunk by id | **M** | Low |
| F14 | Med | `workflowBatchService.ts:254-257`, `:315` | `.in()` with up to 1,500 UUIDs → **~55 KB URL → HTTP 414**, three lines below a correctly chunked loop | Chunk at 100 like the neighbours | **S** | None |
| F15 | Med | `ImageGrouper.tsx:1046-1048` | `prev.map(existing => items.find(...))` — **O(n²) ≈ 1.1 M comparisons** per `items` change. An id→item Map is already built at `:1032` and not used | Use the Map | **S** | None |
| F16 | Med | `ComprehensiveProductForm.tsx:25-40` | `updateGroupField` copies the 1,500-array, does an **O(n) `findIndex` per group member**, and then **mutates the live store objects in place** (`:31`, `:36`) — which makes per-item memoization structurally impossible | Map lookup + immutable per-item copy | **S** | Low |
| F17 | Med | `ImageGrouper.tsx:1891-1892`, `:1886` | `localeCompare` with an options object never hits V8's fast path → **~17,700 `Intl.Collator` builds + ~35,400 `nameKey` calls** per sort (26–106 ms) | Module-level `Intl.Collator` + precomputed sort keys | **S** | None |
| F18 | Med | `GoogleSheetExporter.tsx:346-440` | The preview table renders **every** product × 54 columns with per-cell inline styles — 375 rows = **20,250 `<td>`** — unmemoized, inside an always-mounted `<details>`. (AGENTS.md says "up to 10 products"; the code has no cap) | Cap at 10 rows + `useMemo` the pipeline | **S** | Low |
| F19 | Med | `imageTransforms.ts:35,39,49,77,86,101,130,149,150` | 6–9 unconditional `console.log`s **per image** in `createTransformedFile` → ~10,000 console entries per 1,500-item paste-crop | Route through `log.*` | **S** | None |
| F20 | Med | `PDG:2120`, `:2130` | `handlePasteCrop` calls `setProcessedItems(prev => prev.map(...))` **once per item** → 1,500 full array rebuilds, 1,500 store notifications, 1,500 App+PDG render pairs, 1,500 × 393 KB synchronous localStorage writes (**≈ 533 MB**) | Batch per concurrency group | **M** | Low |
| F21 | Med | `PDG:2284`, `:2325`; `:1972-2010` | Magnifier and crop-drag `setState` a **new object per mouse event**, unthrottled → full PDG subtree render at 60–120 Hz (incl. ~42 `new RegExp` from the chip row and 14 `PresetBadge` remounts) | rAF-coalesce, or drive with CSS vars on a ref | **M** | Low |
| F22 | Med | `textAIService.ts:418-544`, `:552-558`, `:1231-1277` | Per `generateProductDescription`: the 433-entry `KNOWN_BRANDS` array is **re-allocated and re-sorted inside the function**, then up to 433 + 264 + 23 `new RegExp` are compiled in loops; `fitTo60` compiles up to **10,350** | Hoist arrays and precompiled regexes to module scope | **M** | Low |
| F23 | Med | main chunk | **~275 KB raw of `exifr` + `jszip` + `react-dropzone` is eager**, all Step-1-only; `jszip` only for the ZIP path. `exifr` is statically imported **twice** (`App.tsx:2` is gratuitous) | Dynamic-import all three | **M** | Low |
| F24 | Med | main chunk | `KanbanBoard` + `OrgPanel` + `VocabDashboard` + `CrmPanel` = **143 KB of source** for modals nobody sees at first paint; 5 of 7 existing `import()`s are **defeated** because the same module is also statically imported | `React.lazy` the modals; stop static-importing `supabase.ts`/`productService.ts`/`imageTransforms.ts` from the dynamic sites | **M** | Low |
| F25 | Med | `index.css` bundle | One render-blocking 188 KB stylesheet; **97 KB (34.6 %) is modal/panel CSS** and only ~52 KB of 280 KB source is needed at first paint | CSS follows the lazy components | **M** | Low |
| F26 | Med | `public/sw.js:28-48`, `:103-117` | Image cache has **no entry or byte cap**; pruning runs only on activate. ~6.3 GB Cache Storage after 10 × 1,500 batches → whole-origin eviction. `refreshInBackground` re-fetches on **every** hit, so the 800-revalidation problem it was built to solve still happens | Cap entries, prune on fetch, revalidate only past a staleness floor | **M** | Med |
| F27 | Med | 20 sites, e.g. `categoriesService.ts:12,37,61,…` | `supabase.auth.getUser()` is **always a network `GET /auth/v1/user`** (and takes the auth lock). `getCategories()` costs 2 RTTs instead of 1; `Library.tsx:1452` calls it **inside a per-100 chunk loop** | Use `getSession()` | **S** | Low |
| F28 | Med | `Library.tsx:2526-2563`, `:2641-2646`, `:2079` | Zero `useMemo`/`useCallback` in 2,829 lines. Per keystroke (search is undebounced, `:1873`): **~4 × O(20,000) passes + 60,000 regex + 100 `Intl` formats**, plus `getThumbnails` at O(B·G) = 400,000 | `useMemo` the three view derivations, debounce search 200 ms | **M** | Low |
| F29 | Med | `Library.tsx:1341-1345` | Rubber-band `mousemove` does a fresh `querySelectorAll` **plus `getBoundingClientRect()` per card** → 1,500 forced reflows per event; a new 16 ms `setInterval` per move at `:1216` | Cache geometry at mousedown | **M** | Low |
| F30 | Med | missing indexes | No index on `product_images(created_at)` — each of the 21 `fetchSavedImages` pages re-sorts 20,000 rows. No index on `product_images(storage_path)` — `storageSafety.ts:37` is 15 sequential scans per batch delete. No index on `products(user_id)` — `orgService.ts:263` `count:'exact'` | Two `CREATE INDEX` + keyset pagination | **S** | Low |
| F31 | Med | `App.tsx:1103-1127` | Three serially awaited `DELETE … LIKE '%prefix%'` — a leading wildcard defeats any index → 3 full scans of `product_images` on every browser's first session, concurrent with startup restore. Deps are `[user]` (not `[user?.id]`) and the guard key is written only in `finally`, so an identity change starts a **second concurrent run** | Retire it, or gate server-side | **S** | Low |
| F32 | Low | `PDG:320-654` | A new `SpeechRecognition` is constructed and the old one `abort()`ed on **every Next/Prev** (deps `[currentGroupIndex, …]`) | Split instance creation (`[]`) from handler logic (ref) | **M** | Med |
| F33 | Low | `PDG:115-137`, `:1318-1339` | The 800 ms "direct save" is **dead code** — it shares `productSaveTimerRef` with the 500 ms effect, whose cleanup clears it before it can fire. The redundant O(g·n) group rebuild at `:1318-1334` exists only to feed it | Delete, or give it its own ref | **S** | Med |
| F34 | Low | `ImageGrouper.tsx:104-107` | `commitUpdate` shallow-clones all 1,500 ~70-field items into a 50-deep history → up to **75,000 objects ≈ 45 MB**, each pinning a `File` reference | Store `{id, productGroup, category}` deltas | **M** | Low |
| F35 | Low | `ImageGrouper.tsx:1185` | `await new Promise(r => setTimeout(r, 50))` **per item** on the upload slow path → **75 s** of artificial delay for 1,500 items, with 2 setStates each | Remove the sleep; update progress on an interval | **S** | Low |
| F36 | Low | `ImageGrouper.tsx:1283` | `console.log(..., new Error().stack)` on **every** selection update — a V8 stack capture per click | Delete | **S** | None |
| F37 | Low | `ImageGrouper.tsx:32` | `retryImg`'s `setTimeout` handle is never stored or cleared → up to 3 stray network requests per broken image with a 4.5 s tail after unmount | Track and clear, or reuse `LazyImg` | **S** | Low |
| F38 | Low | `ImageGrouper.tsx:2051-2072` | The `onActionsReady` effect builds a **fresh object** and calls the parent setter on every selection change → **two** full App+grid render passes per click | `useMemo` the actions object, or a ref+getter | **S** | Med |
| F39 | Low | `CategoryZones.tsx:46-130`, `:295-307` | `getCategoryIcon` **instantiates all 23 icon elements** on each call (~460 per render). `groupIdsKey` sorts 1,500 strings and allocates a **55.7 KB string every render** purely as an effect dep. Plus a `getCategories()` fetch whose result (`_categories`, `:144`) is never read | Module-level icon map; hash or length+count key; delete the dead fetch | **S** | Low |
| F40 | Low | `GoogleSheetExporter.tsx:59-113` | The title-dedup effect keys on `items.length`, so it re-runs a **fully paginated `products` scan + a Shopify Edge Function invoke** on every length change — ~150 times during an add-more upload | Key on batch id; debounce | **S** | Low |
| F41 | Low | `GoogleSheetExporter.tsx:254` | `URL.createObjectURL` with no `revokeObjectURL` → one multi-MB CSV blob pinned per export | Revoke after click | **S** | None |
| F42 | Low | `SupportWidget.tsx:93-99` | 45 s poll runs **while the widget is closed**, for every signed-in user, alongside a Realtime subscription that already covers it. A second instance mounts for waitlisted users (`App.tsx:1361`) | Poll only when open | **S** | Low |
| F43 | Low | `vocabService.ts:175`; `builtinBrandVocab.ts:33` | Module caches never invalidated — `brandEntriesCache` survives its own `create/update/delete` (stale chips, a correctness bug) and pins ~2.5–3.5 MB once the vocab screen is opened | Invalidate on write | **S** | Low |
| F44 | Low | `useUserPresence.ts:161`, `:167` | `setIsTracking` is both set by the effect and in its own dep array → infinite subscribe/teardown loop; `broadcastAction` leaks a new `RealtimeChannel` per call. **Currently dead code** (not rendered in `App.tsx`) — a landmine if ever wired in | Fix before wiring | **S** | Low |
| F45 | Low | ~190 KB of source | Dead modules still in the tree: `services/api.ts`, `brandMatcher.ts`, `constructionDatabase.ts`, `fitConditionDatabase.ts`, `exportLibraryService.ts`, `SavedProducts`, `ImageSorter`, `TestLlamaVision`, `AISettings`, `RemoteCursors`, `LiveWorkspaceSelector` + 37.5 KB of matching CSS. All correctly tree-shaken today — but **`brandMatcher.ts` is the only static importer of the 4 BRAND_DNA expansions and `brandCategorySystem`; importing it once pulls 391 KB into the main chunk** | Delete | **S** | None |

---

## Breakdown

### 1. Rendering

**What re-renders App.** App subscribes to all four store arrays (`App.tsx:264-267`), so it
re-renders on any item mutation — including a single keystroke in a Step-3 form field. It also
re-renders on `selectedGroupItems`, `grouperActions`, `toasts`, `storageInfo`, `saveMessage`.

**What that costs.** Steps 1–4 are sections of one scrolling page, all mounted simultaneously
(`App.tsx:2787` gates Step 2 on `uploadedImages.length > 0`, `:2886` gates Step 3 on
`sortedImages.length > 0`). No workflow component is wrapped in `React.memo` — `grep "memo("`
finds exactly one use, `KanbanBoard.tsx:788`. So every App render re-executes:

- **ImageGrouper's full card map.** The two `useMemo`s at `:1939` and `:2023` correctly survive
  (deps are `[groupedItems, sortOrder, manualOrder]` and `[singleItems, multiItemGroups, filters]`),
  so the sort does *not* recompute — but the JSX map does. Per single card: 7 fresh arrow closures,
  1–2 inline style objects, a 5-ternary className, and **two uncached `Intl` date formats**. At
  1,500 singles: ~10,500 closures, ~7,500 elements (~13,500 DOM nodes), and **82 ms of date
  formatting** (measured). Locale `undefined` *with* an options object misses V8's formatter cache;
  hoisting two `Intl.DateTimeFormat` instances takes it to 2.56 ms, precomputing the string to
  0.07 ms. Eight more full-array scans sit directly in the JSX (`:2290`, `:2292`, `:2550`, `:2556`,
  `:2570`, `:2578-2580`), three of them literally duplicate predicates.
- **CategoryZones.** Zero `useMemo`/`useCallback` in the file. `groupsMap` (`:295-303`) rebuilds
  per render; `groupIdsKey` (`:307`) sorts 1,500 strings into a **55.7 KB string** per render purely
  as an effect dep; `getCategoryIcon` (`:46-130`) builds all 23 icon elements per call (~460 per
  render); two more `items.filter()` in JSX (`:765`, `:781`). Most of it feeds the `!compactMode`
  branch that App never renders.
- **GoogleSheetExporter.** Its `items` prop is an inline IIFE (`App.tsx:2968`) so identity changes
  every render; the whole group/order/coalesce/dedup pipeline (`:114-225`) runs in the component
  body; then the preview renders **all** products × 54 `<td>` with per-cell inline styles.
  `<details>` hides it with CSS — React still creates all 20,250 cells.
- **PDG's children.** `ComprehensiveProductForm` and `VoiceCommandTable` are unmemoized, and the
  former remounts 14 `PresetBadge` subtrees per render.

**Two renders per click, not one.** `updateSelection` (`ImageGrouper.tsx:1282-1286`) calls
`setSelectedItems` **and** `onSelectionChange` → `App.setSelectedGroupItems` (batched, render A).
Render A's effect at `:2051-2072` then calls `onActionsReady` with a **fresh object literal** →
`App.setGrouperActions` → render B. And since `onStatsChange` is a fresh `() => {}`
(`App.tsx:2795`), the stats effect at `:2041-2048` re-fires every render and never settles.

**Rubber-band is the worst offender.** `setSelectionBox` fires on **every `mousemove`** (`:784`)
*and* on **every rAF frame** of the auto-scroll loop (`:743`) — a fresh object each time, so React
cannot bail out: 60–120 full 1,500-card renders per second, each ≥82 ms of work into an 8–16 ms
budget. The per-item intersection test correctly runs only on mouseup, but there the loop-invariant
`getBoundingClientRect()` is called *inside* the forEach (`:812`, `:836`) → 3,000 rect reads
instead of 1,500. Library's version is worse: per-card `getBoundingClientRect()` on every
`mousemove` (`Library.tsx:1345`).

The CSS mitigations in place (`content-visibility: auto`, `contain`, `aspect-ratio`,
`loading="lazy"`, `decoding="async"`) bound **layout and paint** to the viewport. They do nothing
for `createElement`, reconciliation, the 3,000 `Intl` calls, or the ~21,000-node memory footprint —
which is why the React-side cost dominates here.

**O(n²) inventory:** `ImageGrouper.tsx:1046` (1.1 M), `:640`, `:1465`, `:1763` (`indexOf` in a
comparator, ~47 M for a 1,500-item multi-drag), `:2535`; `CategoryZones.tsx:476`, `:498`
(12.56 ms → 0.21 ms with a Map), `:765`; `ComprehensiveProductForm.tsx:27`; `PDG:1319`;
`libraryData.ts:285-288`.

### 2. Expensive operations

**Auto-save.** `autoSaveWorkflow` (`App.tsx:1806-1911`) does two things. The Supabase write is
correctly debounced 2 s with an in-flight mutex — but the payload is **1,067 KB measured**, and
request bodies are not compressed by browsers. At a realistic 12–20 fires/min that is
**13–22 MB/min uploaded**, and Postgres rewrites a ~1 MB TOASTed JSONB plus WAL each time.
**51 % of that is provably redundant**: `imageUrls` and `thumbnailUrl` are both
`getPublicUrl(storagePath)` (`productService.ts:15-17` ignores its `_size` argument), and the
restore path explicitly rebuilds them from `storagePath` and discards the saved values
(`App.tsx:686-695`). The localStorage backup above it is **not debounced at all** —
393 KB stringified synchronously on all 7 call sites, with `QuotaExceededError` swallowed.

**Startup hydration.** `mergeDB` runs over all four arrays (`App.tsx:993-996`) — 8.66 ms of
spreads and ~12 regex per item measured — but the real cost is `console.log` at `:917`, executed
**per item per array = 6,000 times**, each constructing a 15-field object with `.slice()` calls.
Before that, `rawItems.map` (`:684`) calls `getPublicUrl` **twice per item** (`:686` and `:695`
via `getThumbnailUrl`) = 3,000 synchronous calls before the grid renders.

**Paste-crop.** `createTransformedFile` builds two full-size canvases plus a 0.92-quality `toBlob`
(40–80 ms of main-thread encode, no `OffscreenCanvas`) and logs 6–9 lines per image.
`handlePasteCrop` runs 375 batches of 4 with a 150 ms sleep → a **3–5 minute** floor, and calls
`setProcessedItems` once per item → 1,500 store notifications and **~533 MB of synchronous
localStorage traffic**. It also never calls `evictCachedImage` after re-uploading to the same
`storagePath`, so the stale pre-crop bitmap is served on any later transform (a correctness bug).

**textAIService per Generate.** `KNOWN_BRANDS` (433 strings) is an array literal **inside the
function** — re-allocated and re-sorted each call, then scanned with a `new RegExp` per entry;
`COLOR_WORDS_LIST` (~264) and `MATERIAL_WORDS` (23) do the same. `fitTo60` compiles up to
**10,350** regexes (69 synonym groups × ~5 members × ≤30 passes), all using a lookbehind that
defeats engine-level caching. Typical ~800 compilations per Generate, worst case ~11,100.

**Voice.** `continuous` + `interimResults` (`PDG:332-333`) fire `onresult` every 100–300 ms; each
interim event re-creates `fixTranscript`'s 17 regexes inside the handler (`:356-377`), issues two
state updates, and allocates a 40-entry `Object.entries` — 5–10 full-subtree render pairs per
second of dictation. The voice textarea's `onChange` defines `parseVoiceTextToFields` inline
(`:2681-2747`), compiling **up to 48 regexes per keystroke**.

### 3. Network / DB

**Per user action, at n = 1,500:**

| Action | Round trips | Bytes |
|---|---|---|
| `Library.loadAll` | **34** (2 wasted `getUser`, 21 serial image pages) | **~54 MB parsed** |
| `registerItemsInDB` (every batch open) | 17 warm / 32 cold | ~870 KB up |
| 2 s group upsert | 17–18, **+34 / +54 MB if Library is open** | ~870 KB up |
| `autoSaveWorkflow` | 1 | **1,067 KB up** |
| PDG 500 ms save | 1 `UPDATE` (only `groupItems[0]` is written) | small |
| **Save Batch** | **~1,875 serial** ≈ **150 s** | — |
| Delete a batch | ~30–40 serial, **two likely 414s**, one silent 1,000-row truncation | ~1.1 MB down |
| `handleDeleteUnassigned` | **~110**, 15 of them redundant `getUser` | ~17.8 MB down + up to 17.8 MB up |
| Sign-in (`fetchStorageUsage`) | **~2,500 sequential** | — |

**Silent truncation at the 1,000-row cap is a data-loss bug, not just a perf issue.**
`workflowBatchService.ts:253` fetches only 1,000 of 1,500 product ids, so `deleteWorkflowBatch`
permanently orphans 500 products' images and storage files — and hands
`filterUnreferencedStoragePaths` a partial deletion set, so it also *keeps* files it should delete.
`App.tsx:2079` hydrates only 1,000 of 1,500 items on batch open; `App.tsx:1195` computes
`staleIds` against a partial view.

**N+1 patterns:** `productService.ts:294` (per image), `libraryService.ts:566`/`:587`/`:608` (bulk
delete → per-item full delete), `Library.tsx:616-632` (**one `storage.list()` per item, unbounded
concurrency** — 1,500 parallel Storage calls), `Library.tsx:1013`, `Library.tsx:1452` (`getUser` in
a chunk loop), `libraryService.ts:277-305` (fetch all 50 blobs to rename one group ≈ 36 MB).

**Missing indexes implied by query patterns:** `product_images(created_at)` (ordered + ranged 21×
per `loadAll`), `product_images(storage_path)` (`.in()` per 100-path chunk, 15× per batch delete),
`products(user_id)` (`count:'exact'`). `libraryService.ts:631` uses `ilike '%q%'` and `:656`
`.contains('tags', …)` with no GIN index — both seq scans, both also pulling full blobs. And
`fetchWorkflowBatchesMeta`'s `workflow_state->>lastEditedBy` projection keeps the *response* at
16 KB while forcing Postgres to **de-TOAST and parse ~55 MB of JSONB** server-side — the comment
claiming it "excludes the heavy blob" is true of the wire and false of the database.

**Analytics is well built** — one fire-and-forget insert per event, never awaited, self-disabling on
a missing table, DNT-gated, ~1–8 rows per session. No change needed.

### 4. Memory

Full inventory — 22 listener sites, every timer, all module caches, the localStorage key table and
the SW growth model — is in the companion file §A1–A8. Headlines only:

- **`_imgCache`: 24 GB at 1,500 × 2000²** (18 GB at 4:3), unbounded by explicit design. The comment
  justifying it (`imageTransforms.ts:13-16`, "GPU-decoded bitmap data … manageable") is factually
  inverted — a decoded RGBA bitmap is 15–40× the JPEG. Tab OOMs at ~130–250 images.
- **`File` retention**: `ClothingItem.file` is non-optional (`App.tsx:78`) and holds the *original*,
  not the compressed copy (`ImageUpload.tsx:336`). `commitUpdate`'s 50-deep history pins them 50×.
- **Timers without unmount cleanup**: `PDG:346`, `:620`, `:1110`, `:2172`, `:3017`,
  `ImageGrouper.tsx:32`, plus `autoScrollRafRef` (`ImageGrouper.tsx:1711`) which can leave a 60 fps
  rAF running indefinitely if a reorder drag ends abnormally. One blob-URL leak
  (`GoogleSheetExporter.tsx:254`).
- **Service Worker**: no entry or byte cap; pruning only on activate, which then does a
  `cache.match()` per entry (15,000 of them) while the page is fetching 1,500 images. And
  `refreshInBackground` re-fetches on **every** hit, so the 800-revalidation storm the SW exists to
  prevent still happens — just off the critical path.

### 5. Bundle & startup

**Correctly split** (credit where due): all 5 BRAND_DNA modules (433 KB of source → the 361 KB
vocab chunk), `brandCategorySystem`, `tus-js-client`.

**In main but shouldn't be:** `exifr` (~56 KB region, statically imported *twice* — `App.tsx:2` is
gratuitous), `jszip` (~165 KB region, ZIP path only), `react-dropzone` (~55 KB), `textAIService`
(110 KB src) + `colorDatabase` (26 KB src) pulled in by three files that only want
`smartSeoTruncate`/`normalizeSizeValue`, and `KanbanBoard`/`OrgPanel`/`VocabDashboard`/`CrmPanel`
(143 KB src). ~60 % of the 1.24 MB main chunk is vendor code; ~275 KB of that is Step-1-only.
**5 of 7 dynamic imports are defeated** because the same module is also statically imported
(`supabase.ts`, `productService.ts`, `imageTransforms.ts`) — the build log names all three.

**Before first paint:** a 188 KB render-blocking stylesheet (81 % unused at first paint) plus
1.24 MB of JS to parse and execute, during which these module side effects run synchronously — a
localStorage read + possible 20-listener attach (`debugLogger.ts:25`, `:247`), a `throw` on missing
env vars with no boundary above it (`supabase.ts:6`), `createClient` (`:10`), a ~1,500-iteration
loop over `COLOR_DNA` (`colorDatabase.ts:599`), and a localStorage read + `JSON.parse`
(`workflowBatchService.ts:55`). SW registration is correctly deferred to `load`, and StrictMode
double-invocation is dev-only, so production startup effects fire once.

---

## Optimization strategies, ordered by payoff ÷ risk

**Tier 1 — free wins, no behaviour change, do first (≈1 day total).**
F1 (82 ms→0.07 ms per grid render) · F6 (2 s per `loadAll`) · F12 (6,000 console calls) ·
F19, F36 · F17 (17× sort) · F15 (1.1 M comparisons) · F7 + F8 (halve the autosave payload,
debounce the backup) · F10 (O(n²)→O(n)) · F14 (two 414s) · F30 (two `CREATE INDEX`) ·
F27 (`getUser`→`getSession`) · F41, F45 · F11's select-narrowing · F18's row cap.
None of these change a single user-visible behaviour.

**Tier 2 — memoization pass (≈2–3 days, medium risk).**
F2 is the structural fix and everything else in this tier depends on it: `React.memo` the four
big children and give every callback prop a stable identity. Then F16 (immutable
`updateGroupField` — a prerequisite, because in-place mutation makes per-item memo comparison
impossible), F38, F28, F39, F21, F18's `useMemo`. Expected effect: a Step-3 keystroke stops
touching Step 2 entirely.
**Risk note:** `ComprehensiveProductForm`'s props are already referentially stable, so memoizing
it is free. `VoiceCommandTable` needs `handleTableFieldChange` in a `useCallback` first or the memo
is defeated every render. Verify F2 against AGENTS.md §18.11 (PDG writes must stay targeted
per-id/per-group patches) and the 104-test suite.

**Tier 3 — hot-path rewrites (≈3–5 days).**
F3 (imperative selection box) · F29 · F4 (1,875→~20 round trips) · F20 · F5 (LRU) · F9 ·
F22 · F32 · F13 (pagination — also fixes two data-loss bugs).

**Tier 4 — bundle & delivery (≈2 days).**
F23, F24, F25, F26. Expected: main chunk **1,243 KB → ~750 KB raw / ~358 KB → ~230 KB gzip**;
render-blocking CSS 188 KB → ~55 KB.

**Explicitly do not do.** Don't add a virtualization library — the brief forbids new dependencies,
and `content-visibility` plus a memoized card gets most of the way there. Don't enable React
Compiler expecting it to fix this: it bails out on the three components that matter (see the lint
caveat). Don't "fix" the `[isSelecting]` dep array in the rubber-band effect — it is correct, and
eslint now reports its disable comment as unused.

---

## Production-ready code for the top 5 fixes

Not applied. Line references are from the reads in this review; a bug-fix agent is concurrently
editing `App.tsx` and `src/lib/*`, so re-anchor before applying.

### Fix 1 — F1/F17: precompute card labels and sort keys (biggest win per byte changed)

Add module-level formatters near the top of `src/components/ImageGrouper.tsx`:

```ts
// ── Hoisted formatters ────────────────────────────────────────────────────────
// `toLocaleDateString(undefined, {...})` misses V8's formatter cache whenever an
// options object is passed, so it resolves a fresh Intl.DateTimeFormat per call.
// At 1,500 cards x 2 calls that measured 82.5 ms PER RENDER; reusing these two
// instances is 2.56 ms and precomputing the string (below) is 0.07 ms.
const CARD_DATE_FMT = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const CARD_TIME_FMT = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const FILTER_DATE_FMT = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
const NAME_COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** Formatted "Mar 12, 2026 3:41 PM" for a capturedAt, memoized by timestamp.
 *  Bounded by distinct capture times in the session (<= item count). */
const captureLabelCache = new Map<number, string>();
function captureLabel(ts: number): string {
  let s = captureLabelCache.get(ts);
  if (s === undefined) {
    const d = new Date(ts);
    s = `${CARD_DATE_FMT.format(d)} ${CARD_TIME_FMT.format(d)}`;
    captureLabelCache.set(ts, s);
  }
  return s;
}
```

Move `nameKey` / `naturalCompare` (currently `:1886-1892`, re-created every render) to module
scope, and inside the existing `useMemo` at `:1939` precompute one sort/label key per item so the
comparators and the JSX become pure string reads (Schwartzian transform):

```ts
// Module scope — hoisted out of the component body.
const nameKey = (item: ClothingItem): string => {
  if (item.originalName) return item.originalName.toLowerCase();
  if (item.storagePath) return item.storagePath.split('/').pop()?.toLowerCase() ?? item.id;
  return item.id.toLowerCase();
};
const naturalCompare = (a: string, b: string) => NAME_COLLATOR.compare(a, b);

// Inside the useMemo at :1939, right after `const entries = Object.entries(grps);`
const keyed = new Map<string, { name: string; label: string }>();
for (const item of groupedItems) {
  keyed.set(item.id, {
    name: nameKey(item),
    label: item.capturedAt ? captureLabel(item.capturedAt) : '',
  });
}
const nk = (i: ClothingItem) => keyed.get(i.id)!.name;
// Then replace every `nameKey(x)` in sortArr/sortGroups/sortGroupItems with `nk(x)`, and
// return `captureLabels: keyed` alongside multiItemGroups/singleItems so the JSX can read it.
// Bonus: split the uniqueFilterDates/uniqueFilterCategories half of this memo into its own
// useMemo([groupedItems]) — today a sort-button click needlessly re-derives 1,500 dates.
```

Card JSX diff (currently `:2735-2748`):

```diff
-                  {(item.originalName || item.capturedAt) ? (
-                    <div className="capture-date-label">
-                      {item.originalName && (
-                        <div className="original-name-label">{item.originalName}</div>
-                      )}
-                      {item.capturedAt ? (
-                        <>
-                          {new Date(item.capturedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
-                          {' '}
-                          {new Date(item.capturedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
-                        </>
-                      ) : null}
-                    </div>
-                  ) : null}
+                  {(item.originalName || item.capturedAt) ? (
+                    <div className="capture-date-label">
+                      {item.originalName && (
+                        <div className="original-name-label">{item.originalName}</div>
+                      )}
+                      {captureLabels.get(item.id)?.label || null}
+                    </div>
+                  ) : null}
```

Also swap the filter-dropdown label at `:2283` to `FILTER_DATE_FMT.format(new Date(d + 'T00:00:00'))`.
Output is byte-identical; only the formatter instance is reused.

### Fix 2 — F2/F16: make memoization possible, then apply it

Add one helper (React's `useEvent` pattern) to `src/App.tsx`. It gives every handler a permanently
stable identity while always invoking the latest render's closure, so no dependency-array
archaeology is needed and behaviour is provably unchanged:

```ts
import { useLayoutEffect } from 'react';

/** Stable-identity wrapper around a changing callback: the returned function never
 *  changes identity and always calls the most recent render's `fn`. This is what lets
 *  React.memo bail out on the big children with no dependency-array archaeology. */
function useEventCallback<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const ref = useRef(fn);
  useLayoutEffect(() => { ref.current = fn; });
  return useRef(((...args: A) => ref.current(...args)) as (...args: A) => R).current;
}
```

Wrap the handlers passed to memoized children (declare these once, near the existing handlers):

```ts
const onGroupedStable        = useEventCallback(handleImagesGrouped);
const onCategorizedStable    = useEventCallback(handleImagesSorted);
const onProcessedStable      = useEventCallback(handleItemsProcessed);
const onStatsChangeStable    = useEventCallback(() => {});
const onImageDeletedStable   = useEventCallback(() => setLibraryRefreshTrigger(p => p + 1));
const onCategoryAssignedStable = useEventCallback(() => {
  setSelectedGroupItems(new Set());
  grouperActionsRef.current?.onCategoryAssigned();
});
const onDownloadCSVStable    = useEventCallback(() => exporterRef.current?.downloadCSV());

// Step 2 / Step 4 item lists — stop allocating a new array per render.
const step2Items = groupedImages.length > 0 ? groupedImages : uploadedImages;
const step3VisibleItems = useMemo(() => filterStep3Visible(processedItems), [processedItems]);
```

JSX diff (`App.tsx:2791-2820`, `:2929-2934`, `:2968`) — every inline arrow and every inline
array/IIFE becomes one of the stable values above:

```diff
                 <ImageGrouper
                   key={currentBatchId || 'no-batch'}
-                  items={groupedImages.length > 0 ? groupedImages : uploadedImages}
-                  onGrouped={handleImagesGrouped}
-                  onStatsChange={() => {}}
-                  onImageDeleted={() => { setLibraryRefreshTrigger(prev => prev + 1); }}
+                  items={step2Items}
+                  onGrouped={onGroupedStable}
+                  onStatsChange={onStatsChangeStable}
+                  onImageDeleted={onImageDeletedStable}
                   userId={user.id}
                   batchId={currentBatchId || undefined}
                   onSelectionChange={setSelectedGroupItems}
                   onActionsReady={setGrouperActions}
                 />
@@ CategoryZones
-                  items={groupedImages.length > 0 ? groupedImages : uploadedImages}
-                  onCategorized={handleImagesSorted}
-                  onCategoryAssigned={() => { setSelectedGroupItems(new Set()); grouperActionsRef.current?.onCategoryAssigned(); }}
+                  items={step2Items}
+                  onCategorized={onCategorizedStable}
+                  onCategoryAssigned={onCategoryAssignedStable}
@@ ProductDescriptionGenerator
-                  onProcessed={handleItemsProcessed}
-                  onDownloadCSV={() => exporterRef.current?.downloadCSV()}
+                  onProcessed={onProcessedStable}
+                  onDownloadCSV={onDownloadCSVStable}
@@ GoogleSheetExporter
-                  items={(() => { /* groupCounts forEach + filter over processedItems */ })()}
+                  items={step3VisibleItems}
```

Then memoize the components themselves:

```ts
// src/components/ImageGrouper.tsx (replaces `export default ImageGrouper;` at :3126)
export default React.memo(ImageGrouper);

// src/components/CategoryZones.tsx :869
export default React.memo(CategoryZones);

// src/components/ComprehensiveProductForm.tsx — props are already referentially stable
// (currentItem/currentGroup come from PDG's useMemo at :221; setProcessedItems is the
// permanently-stable store setter), so this memo is a free win.
export const ComprehensiveProductForm = React.memo(function ComprehensiveProductForm({ ... }) { ... });
```

`ComprehensiveProductForm` needs two more changes for that memo to be meaningful. First hoist
`PresetBadge` to module scope — it is currently a new component *type* every render, so React
unmounts and remounts all 14 badge subtrees (this is what the 14 `static-components` lint errors
are reporting):

```ts
// Module scope, above the component. Call sites pass the label explicitly:
//   <PresetBadge show={isFromPreset('brand')} label={currentItem._presetData?.displayName} />
const PresetBadge = ({ show, label }: { show: boolean; label?: string }) =>
  show ? (
    <span className="preset-badge" title={`From "${label}" preset`}>
      <ArrowLeft size={11} style={{ flexShrink: 0 }} /> Preset
    </span>
  ) : null;
```

Second, make `updateGroupField` immutable and O(g) rather than mutating shared store objects in
O(g·n) (replaces `ComprehensiveProductForm.tsx:23-40`):

```ts
const updateGroupField = (fieldPath: string, value: unknown) => {
  const groupIds = new Set(currentGroup.map(i => i.id));
  const [head, tail] = fieldPath.split('.');
  setProcessedItems(processedItems.map(item => {
    if (!groupIds.has(item.id)) return item;          // untouched items keep identity
    if (!tail) return { ...item, [head]: value };      // new object -> memo can see the change
    const nested = { ...((item as Record<string, unknown>)[head] as object ?? {}), [tail]: value };
    return { ...item, [head]: nested };
  }));
};
```

This is the change that makes per-item memoization viable at all: the old code wrote through a
shallow array copy into the *same* item objects, so referential comparison could never detect an
edit.

### Fix 3 — F3: stop re-rendering 1,500 cards on every mousemove

Keep the in-progress box in a ref and write it to the DOM imperatively; commit to state only on
mouseup. Replace both `setSelectionBox` calls (`ImageGrouper.tsx:784` in `handleGlobalMouseMove`
and `:743` in the auto-scroll rAF loop) with `paintSelectionBox`:

```ts
const selectionBoxElRef = useRef<HTMLDivElement | null>(null);

/** Write the rubber-band rect straight to the DOM. No setState, so the 1,500-card grid
 *  is not reconciled 60-120x/second during a drag. The box is a pointer-events:none
 *  overlay, so nothing else in the tree depends on its position. */
const paintSelectionBox = useCallback((box: { x: number; y: number; width: number; height: number } | null) => {
  selectionBoxRef.current = box;                 // the ref that mouseup already reads
  const el = selectionBoxElRef.current;
  if (!el) return;
  if (!box) { el.style.display = 'none'; return; }
  el.style.display = 'block';
  el.style.transform = `translate3d(${box.x}px, ${box.y}px, 0)`;
  el.style.width = `${box.width}px`;
  el.style.height = `${box.height}px`;
}, []);

// both call sites:  setSelectionBox({ x, y, width, height })
//              ->   paintSelectionBox({ x, y, width, height })
```

Render the overlay while selecting, positioned at the origin and moved by `transform` (replaces the
inline-style block at `:2644-2655`):

```tsx
{isSelecting && activeContainer === 'singles' && (
  <div
    ref={selectionBoxElRef}
    className="selection-box"
    style={{ position: 'absolute', left: 0, top: 0, display: 'none', pointerEvents: 'none', willChange: 'transform' }}
  />
)}
```

While in there, hoist the loop-invariant reads out of the mouseup intersection loops
(`:810-813` and `:834-838`) — 3,000 `getBoundingClientRect()` calls become 1,501:

```diff
       const itemElements = containerRef.querySelectorAll('.single-item-card[data-item-id]');
+      const containerRect = containerRef.getBoundingClientRect();
+      const scrollLeft = containerRef.scrollLeft;
+      const scrollTop = containerRef.scrollTop;
       itemElements.forEach((element) => {
         const itemRect = element.getBoundingClientRect();
-        const containerRect = containerRef.getBoundingClientRect();
-        const itemX = itemRect.left - containerRect.left + containerRef.scrollLeft;
-        const itemY = itemRect.top - containerRect.top + containerRef.scrollTop;
+        const itemX = itemRect.left - containerRect.left + scrollLeft;
+        const itemY = itemRect.top - containerRect.top + scrollTop;
```

### Fix 4 — F7/F8: halve the autosave payload and debounce the synchronous backup

`src/lib/slimItems.ts` — `imageUrls` and `thumbnailUrl` are both `getPublicUrl(storagePath)`
(`productService.ts:15-17`), and `App.tsx:686-695` rebuilds them from `storagePath` on restore
while discarding the saved values. Persist them only for legacy items that have no `storagePath`:

```ts
export const slimForWorkflowState = (items: ClothingItem[]): SlimWorkflowItem[] =>
  items.map(item => {
    // imageUrls/thumbnailUrl are BOTH getPublicUrl(storagePath), and BOTH are rebuilt
    // from storagePath on restore (App.tsx startup + handleOpenBatch) with the saved
    // values discarded. Persisting them doubles the blob for zero information. Legacy
    // items with no storagePath have no other image reference, so they keep theirs.
    const derivable = !!item.storagePath;
    return {
      id:           item.id,
      storagePath:  item.storagePath,
      imageUrls:    derivable ? undefined : item.imageUrls,
      thumbnailUrl: derivable ? undefined : item.thumbnailUrl,
      // …all 11 remaining fields unchanged: productGroup, category, capturedAt,
      // originalName, imageRotation, crop, originalStoragePath, originalUrl,
      // brandCategory, descriptionEdited, customDescription…
    };
  });
```

Measured: **1,067 KB → ~520 KB** per PATCH, so ~13–22 MB/min becomes ~6–11 MB/min. Update
`slimItems.test.ts` to assert the new derivable-field rule — that whitelist contract is the whole
point of that test.

`src/App.tsx` — the backup is 393 KB stringified synchronously on all 7 `autoSaveWorkflow` call
sites. Give it its own short debounce (replaces the try/catch at `:1819-1835`):

```ts
// Module scope, beside the other refs.
const backupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

// Inside autoSaveWorkflow, replacing the synchronous backup block:
// ── Instant-ish localStorage backup ───────────────────────────────────────
// Still far ahead of the 2 s Supabase write, but no longer a ~393 KB
// stringify + blocking setItem on EVERY click and keystroke.
if (backupTimerRef.current) clearTimeout(backupTimerRef.current);
backupTimerRef.current = setTimeout(() => {
  try {
    const live =
      workflowState.processedItems.length > 0 ? workflowState.processedItems :
      workflowState.sortedImages.length    > 0 ? workflowState.sortedImages    :
      workflowState.groupedImages.length   > 0 ? workflowState.groupedImages   :
      workflowState.uploadedImages;
    if (live.length > 0 && currentBatchIdRef.current) {
      localStorage.setItem('sortbot_workflow_backup', JSON.stringify({
        batchId: currentBatchIdRef.current,
        savedAt: Date.now(),
        items:   live.map(ultraSlimForBackup),
      }));
    }
  } catch (e) {
    // Quota exceeded: drop the backup rather than failing silently forever.
    console.warn('[App] workflow backup skipped:', e);
  }
}, 400);
```

400 ms keeps the backup strictly ahead of the 2 s Supabase write (its only job is winning a
refresh race), while collapsing a burst of 50 clicks from 50 writes to 1. Clear
`backupTimerRef` alongside the other timers in `handleBatchDeleted`.

### Fix 5 — F4: one bulk upsert instead of one round trip per image

`src/lib/productService.ts` — `saveProductToDatabase` awaits a `product_images` upsert inside a
per-image loop (`:251-318`), and `saveBatchToDatabase` awaits that per group (`:351-366`):
**~1,875 serial round trips ≈ 150 s** for 1,500 images. Collect the rows, upsert once:

```ts
// Rewrite the `for (let i = 0; i < groupImages.length; i++)` loop at :251 so it only
// PREPARES rows, then issue ONE upsert after the loop. The transform + upload awaits
// inside the loop are unchanged (canvas encode + Storage PUT are inherently per-item);
// only the DB write moves out. Lines marked "…unchanged…" are copied verbatim from :252-291.
const imageRows: Record<string, unknown>[] = [];

for (let i = 0; i < groupImages.length; i++) {
  const item = groupImages[i];
  let imageUrl = '';
  let storagePath = '';

  // …unchanged: createTransformedFile + uploadImageToStorage when (imageRotation || crop)…
  // …unchanged: else reuse item.storagePath/item.preview, else uploadImageToStorage(item.file)…

  // Same row shape as today — just pushed instead of awaited.
  if (imageUrl && storagePath) {
    imageRows.push({
      product_id: productData.id, user_id: resolvedUserId,
      image_url: imageUrl, storage_path: storagePath, position: i,
      alt_text: `${product.seoTitle || 'Product'} - Image ${i + 1}`,
      transforms: buildTransforms(item),
      ...(stage4 ? {
        captured_at: item.capturedAt ?? null,
        original_storage_path: item.originalStoragePath ?? null,
      } : {}),
    });
  }
}

// ONE upsert per product group instead of one per image. Same conflict target,
// same rows, same ignore semantics — only the request count changes.
if (imageRows.length > 0) {
  const { error: imageError } = await supabase
    .from('product_images')
    .upsert(imageRows, { onConflict: 'product_id,image_url' });
  if (imageError) console.warn('[productService] product_images upsert error:', imageError.message);
}
```

And run the groups with bounded concurrency instead of strictly serially (replaces the
`for (const [, groupItems] of Object.entries(productGroups))` loop at `:351`):

```ts
const groups = Object.values(productGroups);
const CONCURRENCY = 4;   // matches the paste-crop limiter; keeps Storage happy
let success = 0, failed = 0;
for (let i = 0; i < groups.length; i += CONCURRENCY) {
  const results = await Promise.all(
    groups.slice(i, i + CONCURRENCY).map(groupItems =>
      saveProductToDatabase(groupItems[0], userId, groupItems, batchId)),
  );
  for (const id of results) id ? success++ : failed++;
}
return { success, failed };
```

Round trips for 1,500 images in 375 groups: **~1,875 serial → ~750 across 4 lanes ≈ 20 s**, and
further to ~380 once the `.select().single()` on the products upsert is dropped (it is only used
for `productData.id`, which equals `product.id`).

---

## Scalability

### 10,000 images in one batch

Breaks, in order of arrival:

1. **`_imgCache` OOMs the tab** at ~130–250 images of a paste-crop. Already broken at 1,500 (F5).
2. **`workflow_state` reaches ~7.1 MB** (≈3.5 MB with Fix 4). PostgREST's default body limit and
   Supabase's statement timeout both come into play, and the row is TOASTed and fully rewritten
   every 2 s. **Mitigation:** stop storing the item list in a JSONB blob. Stage 4's dual-write
   already puts every slim field into `product_images`/`products` columns; completing the
   restore-flip makes `workflow_state` a small cursor (batch id, step, `lastEditedBy`) and retires
   the blob, the 1,000-row gap-fill heuristics, the ±24 h orphan window and the stolen-row
   cleanup all at once. This is the single highest-value architectural change.
3. **The 1,000-row cap silently truncates** five queries. At 10,000 items `handleOpenBatch`
   hydrates 10 % of the batch and `deleteWorkflowBatch` orphans 90 % of the storage files.
   **Mitigation:** F13 + F14 before anything else — these are data-loss bugs at 1,500 already.
4. **DOM: ~90,000 nodes / ~50,000 elements** (~100–180 MB). `content-visibility` bounds paint but
   not reconciliation or memory. **Mitigation:** after F2, add manual windowing — slice
   `filteredSingleItems` to a scroll-driven range (no new dependency needed; one
   `IntersectionObserver` sentinel plus `contain-intrinsic-size` for the spacer).
5. **`Save Batch` ≈ 1,000 s**; **`fetchStorageUsage` ≈ 16,000 requests**. Mitigated by F4 and F9.
6. **`markCompressed` O(n²)** becomes ~100 GB of string churn. Mitigated by F10.

### 100 concurrent workspaces

1. **`Library.loadAll` is not tenant-scoped by cost.** 34 requests and ~54 MB per open; 100
   workspaces opening it a few times an hour is tens of GB of egress against Supabase's quota,
   and the `product_images` page queries are unindexed sorts of the whole table.
   **Mitigation:** F11 + F30, then paginate the Library UI itself (fetch per batch on expand
   rather than fetching everything and collapsing it in the client).
2. **RLS without composite indexes.** Every org-scoped policy is `org_id IN (SELECT user_org_ids())`.
   Single-column `org_id` indexes exist, but queries filter `org_id` *and* `batch_id`/`created_at`.
   **Mitigation:** composite indexes `(org_id, batch_id)`, `(org_id, created_at DESC)` on
   `products`; `(org_id, product_id)` on `product_images`.
3. **Realtime**: 1 support channel per signed-in user, plus the 45 s poll running while closed
   (F42) → ~8,000 `support_threads` queries/hour at 100 users for a table that changes a few
   times a day. `useUserPresence` would add a 10 Hz cursor broadcast fanned out to every
   connected user — fix F44 before wiring it.
4. **Storage is one public bucket.** Every workspace's images are world-readable by URL; the
   SW caches across tenants in one origin cache. **Mitigation:** private bucket + signed URLs
   (already tracked as tenancy Phase 1b) — note this interacts with the SW cache key and with
   `getPublicUrl`, which is called ~3,000 times per restore.
5. **`getUser()` takes the GoTrue auth lock** on all 20 call sites; under concurrency this
   serialises unrelated work within a tab. F27.

### 1,000,000 analytics rows

The write path is fine (one fire-and-forget insert, ~1–8 rows/session, self-disabling). The read
path is the risk: `analytics_summary(p_days)` aggregates over a growing table on every founder
dashboard open.

- **Mitigation:** ensure `analytics_events(created_at DESC)` and `(event, created_at DESC)`
  indexes exist and that the RPC is bounded by `created_at >= now() - p_days`; add a
  `BRIN` index on `created_at` past ~10 M rows.
- **Retention:** keep raw events 90 days; roll older data into a daily `analytics_daily`
  materialised view refreshed on a cron. 1 M raw rows ≈ 200–400 MB with the JSONB `props`;
  the daily rollup is a few thousand rows.
- **Cost note:** `props` is already key/value-capped (40 keys / 200 chars), so row width is
  bounded — good. Don't add per-step tracking without batching; step changes are high-frequency.

### Restore the automated purity guard first

Before any of the above, hoist ImageGrouper's three in-body `await import(...)` calls (`:427`,
`:467`, `:519`) into a module-scope helper. That single change un-bails the React Compiler analysis
and restores ~15 real `react-hooks/refs` + `immutability` errors on the file — the only automated
guard against the mutation and render-phase-side-effect class of bug that produced the June 2026
preset-persistence saga. Cheap insurance, and it unblocks a future React Compiler adoption.
