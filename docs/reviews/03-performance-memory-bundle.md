# Performance Audit 03 — Memory Leaks / Unbounded Growth & Bundle Composition

> Measured against `dist/` built at 15:57 on 2026-09-13 (`index-C5V_uDCS.js`); no rebuild was performed.

**Note on tree state:** `dist/` was rebuilt by another process mid-audit (hashes moved `index-Cc07ekai.js` → `index-C5V_uDCS.js`, mtime 15:52 → 15:57) and `src/components/ui/` appeared as untracked. All numbers below are from the current on-disk `dist/`.

---

# PART A — MEMORY & LIFECYCLE

## A1. `addEventListener` inventory (22 sites)

**Properly cleaned up in an effect return (14 sites):**

| Site | Target/event | Cleanup |
|---|---|---|
| `src/App.tsx:432` | window `presetsUpdated` | `:433` ✅ |
| `src/components/CategoryZones.tsx:180` | window `categoriesUpdated` | `:181` ✅ |
| `src/components/KanbanBoard.tsx:212` | document `keydown` | `:213` ✅ |
| `src/components/WorkspaceMenu.tsx:31,32` | document `mousedown`,`keydown` | `:34,35` ✅ |
| `src/components/Library.tsx:1293,1294` | document `mousemove`,`mouseup` | `:1297,1298` ✅ |
| `src/components/ProductDescriptionGenerator.tsx:299,300` | window `beforeunload`,`pagehide` | `:302,303` ✅ |
| `src/components/ProductDescriptionGenerator.tsx:2068` | document `keydown` | `:2069` ✅ |
| `src/components/ImageGrouper.tsx:863,864` | document `mousemove`,`mouseup` | `:868,869` ✅ (+`cancelAnimationFrame` `:867`) |
| `src/components/ImageGrouper.tsx:893,906,943,963,984,1002,1431` | document `mousedown`/`keydown`×5/`mousedown` | `:894,907,944,964,985,1003,1432` ✅ |
| `src/hooks/useUserPresence.ts:129` | window `mousemove` | `:147` ✅ (file is dead — no importers) |

**NOT cleaned up (2 sites, 21 listeners):**

1. **`src/main.tsx:14`** — `window.addEventListener('load', …)` for SW registration. Never removed. Benign (page-lifetime, fires once).

2. **`src/lib/debugLogger.ts:96`** — the `add()` helper inside `attachDomListeners()`. **This is the significant one.** It attaches **20 `document` listeners** and is *not inside any React effect*:
   - `click, dblclick, contextmenu, mousedown, mouseup, mousemove(passive, 100 ms self-throttle), keydown, keyup, dragstart, dragover, dragenter, dragleave, drop, dragend, scroll(passive+capture), selectionchange, focusin, focusout, input, change` (lines 101–217).
   - Removal path is **only** `setDebugEnabled(false)` → `detachDomListeners()` (`:220–226`, iterates `_domListeners` `:84`, then `_domListeners.length = 0` — the array itself is bounded ✅).
   - **`src/lib/debugLogger.ts:247-249` auto-attaches at *module import time*** if `localStorage['sortbot_debug_enabled'] === 'true'` (read at `:25`). So on any reload with the flag on, 20 document listeners exist **before React mounts** and stay for the tab's life with no component owning them.
   - Cost when enabled: `mousemove` throttling is checked *inside* the handler (`:128-130`), so the handler executes on every single mousemove event; `dragover` (`:153`) fires at native rate during every drag over 1,500 cards. And `dbg()` at `:55` calls `console.groupCollapsed` + `console.log(d)` **retaining a live reference to the DOM target and the raw Event** (`{ target: t, event: e }` at `:103`). DevTools console retention means every logged event pins its `target` element → detached-DOM growth proportional to interaction count. This is an unbounded leak whenever debug is on with DevTools open.

## A2. Timers

**Cleared correctly:**

| Site | Cleared at |
|---|---|
| `src/components/LazyImg.tsx:47` (`retryTimerRef`) | `:34`, **unmount `:38`** ✅ |
| `src/components/KanbanBoard.tsx:805` (`commitTimer`) | `:800`, **unmount `:800-802`** ✅ |
| `src/components/SupportWidget.tsx:93` (`setInterval`, `POLL_MS`) | `:97` ✅ |
| `src/components/ProductDescriptionGenerator.tsx:127,263` (`productSaveTimerRef`) | `:126,262`, effect cleanup `:278`, unload flush `:287` ✅ |
| `src/components/ProductDescriptionGenerator.tsx:2077` | `:2089` ✅ |
| `src/components/Library.tsx:1217,1226` (`scrollInterval`) | `:1206,1276,1301` ✅ |
| `src/hooks/useUserPresence.ts:113,132` | `:148,156` ✅ (dead file) |

**Stored in refs with NO unmount cleanup — flagged:**

- **`src/App.tsx:352` `autoSaveTimerRef`**, **`:359` `groupUpsertTimerRef`**, **`:364` `chunkTimerRef`**. Set at `:1840`, `:1723`, `:469`. Cleared only in *explicit imperative paths* (`:468`, `:1286`, `:1300-1302`, `:1722`, `:1838`, `:1946`). **There is no `useEffect(() => () => clearTimeout(...), [])`** anywhere in App.tsx. The 2 s `autoSaveTimerRef` closure captures `workflowState.{uploadedImages,groupedImages,sortedImages,processedItems}` — for 1,500 items that's a 4-array closure pinned for up to 2 s past sign-out/teardown, and it can fire a Supabase write for a batch the user just left.
- **`src/components/ImageGrouper.tsx:1711/1713` `autoScrollRafRef`** — self-perpetuating `requestAnimationFrame(loop)` started in `handleReorderDragStart`. Cancelled **only** in `handleReorderDragEnd` (`:1774`). No unmount cleanup. If the drag ends without `dragend` (Esc, drop outside window, component unmount mid-drag) the loop runs **forever at 60 fps** calling `startAutoScroll(reorderMouseYRef.current)`.

**Fire-and-forget timers, never cleared (setState-after-unmount + closure retention):**

| Site | Delay (ms) | Retains |
|---|---|---|
| `src/App.tsx:333` | 4000 | toast id (benign) |
| `src/App.tsx:1244` | 3000 | 4× `setXxx([])` after save |
| `src/App.tsx:2546` | 5000 | `setSaveMessage(null)` |
| `src/components/ImageGrouper.tsx:32` | 500/1500/4500 | `HTMLImageElement` + src, ×3 per failed image |
| `src/components/ImageGrouper.tsx:594` | 0 | **`onGrouped(groupedItemsRef.current)` — full 1,500-item array** |
| `src/components/ImageGrouper.tsx:600` | 3500 | `setCropPasteProgress(null)` |
| `src/components/ImageGrouper.tsx:617` | 0 | **full 1,500-item array** |
| `src/components/ImageGrouper.tsx:1119` | 0 | **full 1,500-item array** |
| `src/components/ImageGrouper.tsx:1703` | 0 | ghost DOM node |
| `src/components/ProductDescriptionGenerator.tsx:346` | 1000 | `setIsTransitioning` |
| `src/components/ProductDescriptionGenerator.tsx:620` | — | **restarts `SpeechRecognition` after unmount** (`recognitionRef.current.start()`) |
| `src/components/ProductDescriptionGenerator.tsx:1110` | 150 | `processedItemsRef` + group array |
| `src/components/Library.tsx:127, 908, 1655, 2297, 2427, 2627` | 50–3000 | setState after unmount |
| **`src/lib/imageTransforms.ts:56`** | 500 | **module-level, uncancellable.** Up to 3 pending per failed image; at 1,500 CDN failures = 1,500 live timers each pinning an `Image` + closure. |

## A3. `URL.createObjectURL` / `revokeObjectURL`

Only **2** create sites in the whole tree:

- **`src/components/ImageUpload.tsx:117`** (`compressImage`) → **revoked** at `:120` (first line of `onload`) and `:150` (`onerror`). ✅ Residual gap: if neither `onload` nor `onerror` fires (decode aborted, unsupported-but-not-erroring payload) the URL leaks. The `reject` paths at `:130` (no 2d context) and `:137` (`toBlob` failed) occur *after* revoke, so they're safe.
- **`src/components/GoogleSheetExporter.tsx:254`** → **NO `revokeObjectURL`**. The `<a>` is removed at `:262` but the blob URL is never released. Each CSV export permanently pins its blob for the tab's lifetime. At 1,500 items × ~1.5–2 KB/row ≈ **2.3–3.0 MB per export**; 10 exports ≈ **23–30 MB** leaked.

**Re: the 1,500 × 400 KB estimate** — the compressed-JPEG object URLs are *not* the leak; they are revoked at `ImageUpload.tsx:120`. The hypothetical figure would be **1,500 × 400 KB = 600,000 KB = 586 MiB (614 MB)**, but it does not materialize here. The compressed `File` objects themselves are also *not* retained — `fileToUpload` (`ImageUpload.tsx:252`) is local to the `chunk.map` callback and only the **original** `file` is attached to the item (`:336`). See A5 for what *is* retained.

## A4. Module-level mutable caches that only grow

### `src/lib/imageTransforms.ts` — the HTMLImageElement cache (worst offender)

Declaration, **line 17**, with the comment that documents the design decision (lines 6–16):

```ts
// The cache is intentionally not bounded: a user doing 1500 images needs them
// all available without eviction during a single paste-crop batch. Each decoded
// HTMLImageElement is a reference to GPU-decoded bitmap data (not the raw JPEG
// bytes), so memory footprint is manageable. If memory ever becomes a concern,
// close/reload the tab — the cache is fully ephemeral.
const _imgCache = new Map<string, HTMLImageElement>();
```

Insert sites: **`:48`** `_imgCache.set(src, img);` (inside `img.onload`, every network load) and **`:22`** `cacheImage()`. Read: `:33`. Only eviction: **`:26`** `evictCachedImage(url)` → `_imgCache.delete(url)`, called from exactly one place, `src/components/ImageGrouper.tsx:519`, and only for an item whose storage path just changed after a re-crop. **Confirmed: no LRU, no size cap, no count cap, no TTL, no clear-on-batch-close.**

The code comment's claim is **factually wrong**: a decoded `HTMLImageElement` holds an uncompressed RGBA bitmap, `w * h * 4` bytes, and it counts against the renderer process.

- 2000×2000 → `2000*2000*4` = **16,000,000 B = 16.0 MB (15.26 MiB)** per image
- **1,500 images → 24,000,000,000 B = 24.0 GB (22.35 GiB)**
- Realistic 4:3 at `COMPRESS_MAX_PX = 2000` (`ImageUpload.tsx:19`) → 2000×1500 = 12.0 MB each → **18.0 GB** for 1,500

The tab will OOM-crash long before finishing a 1,500-image paste-crop. Chrome's renderer typically dies around 2–4 GB, i.e. **~130–250 images**.

### Other module-level growth

| Location | Structure | Bound |
|---|---|---|
| `src/lib/workflowBatchService.ts:55` | `deletedBatchIds = new Set<string>` | In-memory **unbounded**; only the *persisted* copy is capped (`:66` `.slice(-200)`). |
| `src/lib/workflowBatchService.ts:78` | `confirmedBatchIds = new Set<string>` | **Unbounded**, never pruned. 36 B/uuid — negligible. |
| `src/lib/workflowStore.ts:52` | `listeners = new Set<() => void>` | Removed by `subscribe`'s returned disposer (`:70`) ✅ |
| `src/lib/workflowStore.ts:96` | `itemArraySetters = new Map` | Bounded to 4 keys ✅ |
| `src/lib/builtinBrandVocab.ts:33` | `let cache: BuiltinBrandEntry[] \| null` | Set once, **never cleared**. Pins the merged object built at `:38-45` (spread copy of all 5 BRAND_DNA objects) *plus* the 5 originals via the module namespace. 361,354 B of minified literals → **~1.1–1.8 MB parsed object graph**, plus merged copy + ~5,000-entry result array ≈ **~2.5–3.5 MB permanently resident** once the founder vocab screen is opened once. |
| `src/lib/vocabService.ts:175` | `brandEntriesCache` | Set once at `:181`, **never invalidated** — not even by `createBrandKeywords`/`updateBrandKeywords`/delete in the same file. Correctness bug (stale chips) + permanent retention. |
| `src/lib/csvExport.ts:368` | `CANONICAL_TAXONOMY_PATHS = new Map` | Static literal, built at import time ✅ |
| `src/lib/colorDatabase.ts:590,597` | `COLOR_WORDS_LIST`, `COLOR_RGB_MAP` | Filled once by the **top-level `for` loop at `:599-613`**, executed at import ✅ bounded, but see A13. |
| `src/lib/debugLogger.ts:84` | `_domListeners: Listener[]` | Reset on detach (`:224`) ✅ |

### `lastToggleTimeRef` — `src/components/ImageGrouper.tsx:162`

```ts
const lastToggleTimeRef = useRef<Map<string, number>>(new Map());
```

Inserted at **`:1313`** `lastToggleTimeRef.current.set(itemId, now);` inside `toggleItemSelection`, read at `:1308`. **Never deleted, never cleared.** Component-scoped (dies with ImageGrouper unmount), and keys are bounded by the number of distinct items in the batch → max 1,500 entries × (36-char uuid ≈ 72 B UTF-16 + 8 B number + ~32 B Map slot) ≈ **170 KB**. Not a leak of consequence, but it is a monotonic Map with no eviction; if the batch is ever "add-more"'d past 1,500 it grows linearly with cumulative item count for the component's life.

### `brandTermsCacheRef` — `src/components/ProductDescriptionGenerator.tsx:1364`

`useRef<Map<string, string[]>>(new Map())`, inserted at `:1374`, read `:1368`. Monotonic, keyed by lowercased brand. Bounded by distinct brands seen (~hundreds), small. Plus `allBrandEntries` state (`:1383`) holds the whole `brand_keywords` table for the session.

### `sortbot_compressed_paths` — `src/components/ImageUpload.tsx:26`

```ts
const COMPRESSED_PATHS_KEY = 'sortbot_compressed_paths';
```

Read `getCompressedPaths()` `:31-36`; write `markCompressed()` `:38-44`. **Nothing ever removes an entry.** Called once per successful upload at `:333` (`if (COMPRESS_ON_UPLOAD) markCompressed(uploaded.storagePath)`).

Path shape from `ImageUpload.tsx:449` — `` `${userId}/${productId}/${Date.now()}-${randomId}.${fileExt}` `` = 36 + 1 + 36 + 1 + 13 + 1 + 13 + 1 + 3 = **105 characters**. Serialized as a JSON array element: `"…",` = **108 chars**.

- **5,000 paths → 540,002 chars ≈ 540 KB**, i.e. **~10.3 % of the 5,242,880-character localStorage quota**
- Quota is hit at **~48,500 paths (≈ 32 batches of 1,500)**
- The `catch { /* ignore quota errors */ }` at **`:43`** swallows `QuotaExceededError` silently → compression tracking dies quietly and the recompress button starts re-doing everything.

**Bigger problem than the size: `markCompressed` is O(n) per image, so O(n²) per batch.** It does `getCompressedPaths()` (full `JSON.parse` of the whole array) + `set.add` + `JSON.stringify([...set])` + `setItem` for **every single image**, synchronously on the main thread, inside the upload loop. With 5,000 existing entries × 1,500 new images: **~1,500 × (540 KB parse + 540 KB stringify + 540 KB sync disk write) ≈ 2.4 GB of string churn and ~810 MB of synchronous localStorage writes per batch.**

## A5. Closures retaining `File` objects

**`ClothingItem.file` is declared non-optional at `src/App.tsx:78`** (`file: File;`) and the raw original is attached at **`src/components/ImageUpload.tsx:336`**:

```ts
return {
  id: productId, file,          // ← the ORIGINAL File, not fileToUpload
  capturedAt,
  originalName: file.name,
  preview: uploaded.preview,    // https public URL — NOT a blob: URL ✅
  ...
```

Nothing ever nulls it in the live path. The only `file: null` assignments are **`src/App.tsx:2149`** and **`src/App.tsx:2237`** (`file: null as any`) — the *reload/restore* paths. So within a single session every uploaded item pins its original `File` forever.

**Who keeps the arrays alive for the tab lifetime:**

1. **`src/lib/workflowStore.ts:43-49`** — `initialState` / module-level `let state` at `:51` holds **four** arrays: `uploadedImages, groupedImages, sortedImages, processedItems`. All four are populated during upload (`src/App.tsx:473, 481, 482, 483` — `prev => [...prev, ...batch]`). This is module scope, **outside React**, so nothing unmounts it. Only `workflowStore.reset()` (`:74`) clears it (sign-out / active-batch deletion). 4 × 1,500 = 6,000 references to the same 1,500 objects.
2. **`src/App.tsx:363` `pendingChunkRef`** — pushed at `:467`, **drained and cleared at `:470-471`** inside the chunk timer, plus `:1285, :1303, :1945`. ✅ Bounded to one chunk (`CHUNK = 10`, `ImageUpload.tsx:271`). **Not the retainer suspected.**
3. **`src/components/ImageUpload.tsx:266` `const items: ClothingItem[] = []`** + `:344` `items.push(...results)` — accumulates **all 1,500** items for the whole run, held by the `processFiles` async closure until `onImagesUploaded(items)` at `:409`.
4. **`src/components/ImageUpload.tsx:205-210` `failedUploads` state** holds `{ file, capturedAt, originalName }` for every failure (`:345`), cleared only in `retryFailedUploads` (`:437`).
5. **`src/components/ImageUpload.tsx:261-263`** — `imageFiles` array (`{file, capturedAt}` × 1,500) plus `rawFiles` plus the `fileTimestamps` `Promise.all`, all live in the `processFiles` closure for the full duration.

**Retained-byte estimate, 1,500 files @ 3.5 MB original / 400 KB compressed:**

| What | Bytes |
|---|---|
| Compressed `File`s (`fileToUpload`) | **0** — local to the `chunk.map` callback, GC'd per chunk. (Would have been 600 MB.) |
| Original `File`s via `item.file`, **drag/folder-input path** | `1,500 × 3,670,016 = 5,505,024,000 B ≈ **5.51 GB / 5.13 GiB** of Blob-store references. Because a `File` from `<input type=file>`/DnD is an OS-file handle, heap cost is ~a few hundred bytes each (**~0.5 MB total**) — it *pins the disk file*, not RAM. Low real cost. |
| Original `File`s via `item.file`, **ZIP path** (`ImageUpload.tsx:154-175`, `zip.forEach` → `entry.async('blob')`) | These are **materialized in-memory blobs**, not disk handles. **~5.51 GB in the browser blob store**, held for the tab's life by `item.file`. Plus `JSZip.loadAsync(zipFile)` (`:156`) holds the entire archive and `Promise.all(promises)` materializes all 1,500 blobs before returning. **This is the real File leak.** |
| `ClothingItem` field payload (≈80 fields, ~1.5 KB each) | `1,500 × 1,500 = 2,250,000 B ≈ **2.25 MB**` |
| 4 store array pointer sets | `4 × 1,500 × 8 = 48,000 B ≈ **48 KB**` |
| `preview` strings (https URLs, ~150 chars UTF-16) | `1,500 × 300 = **450 KB**` (×4 refs, same strings) |
| **`_imgCache` decoded bitmaps** (A4) | **24.0 GB** — dominates everything else by 4× |

## A6. `public/sw.js`

**Strategy** (docstring lines 15–19, implementation `:66-99`):

```
Strategy: stale-while-revalidate
  1. Request arrives → check Cache Storage.
  2. Cache HIT  → return cached response immediately (instant load),
                  AND fire a background fetch to refresh the cache entry.
  3. Cache MISS → fetch from network, store in cache, return response.
```

**Config:**

```js
const CACHE_NAME = 'sortbot-images-v1';                    // :28
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days      // :29
const SUPABASE_IMG_PATTERN = /\/storage\/v1\/object\/public\/product-images\//;  // :32
```

TTL enforced per-entry at read time via the `x-sw-cached-at` header (`:76-83`, written at `:123`).

**MAX ENTRY COUNT / SIZE BOUND: NONE.** Confirmed — there is no `keys().length` check, no LRU, no byte accounting anywhere in the file.

**Pruning reality vs. the docstring.** Line 21–22 claims:

```
Cache eviction: entries older than MAX_AGE_MS are deleted in the background
on every install/activate and periodically during fetch processing.
```

The "periodically during fetch processing" half is **false**. `pruneExpiredEntries()` (`:157-171`) is called **only** from the `activate` handler (`:48`). `handleImageRequest` (`:66`) never calls it. `pruneOldCaches()` (`:147-154`) deletes caches whose name `!== CACHE_NAME` — it only does anything when someone bumps `'sortbot-images-v1'`. **So: the cache is pruned on version change or on a new SW activation, and never during normal use.**

**Three additional defects:**

- **`refreshInBackground` (`:104-118`) fires a second `fetch(request)` on *every* cache hit** and re-`put`s the entry. The stated goal (docstring 6–10) was to avoid 800 revalidations per reload; instead every reload still issues N network requests (non-blocking) *and* performs N `arrayBuffer()` reads + N `cache.put` writes. For 1,500 images that is 1,500 extra requests and ~600 MB of rewrite churn per page load.
- **`storeInCache` (`:121-133`) does `await response.arrayBuffer()`** before the `put`, buffering each full image into SW heap. With chunked parallel loads this spikes the SW process.
- **`stripCacheBust` (`:136-144`) only deletes the `t` param.** `src/lib/imageTransforms.ts:63` appends **`_retry=${attempt}`**, which is *not* stripped → every retry mints a **new cache key** for the same bytes. 3 retries × a flaky batch ⇒ up to 4× duplication.

**Cache Storage growth, 10 batches × 1,500 images:**

| Component | Count | Per entry | Total |
|---|---|---|---|
| Full-res compressed JPEGs (2000 px, q0.88) | 15,000 | ~400 KB | **6,000,000 KB = 6.00 GB** |
| Thumbnails — `getThumbnailUrl` (`src/lib/productService.ts:15-17`) **ignores `_size` and returns the same public URL**, so thumbs are *not* separate entries | 0 | — | **0** |
| `_retry=` duplicates at a 5 % retry rate | 750 | ~400 KB | **300,000 KB = 300 MB** |
| **Total** | ~15,750 | | **≈ 6.3 GB**, pruned never (within 7 days) |

Chrome evicts at ~60 % of free disk per origin; Safari caps ~1 GB then evicts the whole origin bucket. Practically: the cache will be blown away wholesale (including useful recent entries) rather than pruned LRU, so the stale-while-revalidate hit rate collapses at scale.

## A7. localStorage — full key inventory

| Key | Written at | Growth |
|---|---|---|
| `sortbot_debug_enabled` | `src/lib/debugLogger.ts:232` (read `:25`, removed `:237`) | 4 B |
| `sortbot_current_batch_id` | `src/App.tsx:451, 464, 1386, 1895, 1949` (removed `:646, 1080, 1182, 1280, 1309`) | 36 B |
| `sortbot_current_batch_number` | `src/App.tsx:1896, 1950` (removed `:647, 1081, 1183, 1281, 1310`) | ~4 B |
| **`sortbot_workflow_backup`** | **`src/App.tsx:1829`** (read `:670, 1054`; removed `:1311`) | **~500 KB @ 1,500 items** — below |
| `sortbot_orphan_cleanup_v3` | `src/App.tsx:1123` (read `:1106`) | 1 B |
| **`sortbot_compressed_paths`** | **`src/components/ImageUpload.tsx:42`** | **unbounded, 108 B/image** — see A4 |
| `sortbot_deleted_batch_ids` | `src/lib/workflowBatchService.ts:66` | capped `.slice(-200)` ≈ 7.6 KB ✅ |
| `sortbot_kanban_view` | `src/components/KanbanBoard.tsx:68` | ~10 B |
| `sortbot_magnifier_settings` | `src/components/ProductDescriptionGenerator.tsx:199` | ~100 B |
| `ai_provider` | `src/components/AISettings.tsx:23` | ~10 B (**dead component**) |
| `presets_gender_filter` | `src/components/CategoryPresetsManager.tsx:272` | ~10 B |
| `dropzone_gender_filter` | `src/components/CategoryZones.tsx:172` | ~10 B |
| `tus::*` (written by `tus-js-client`) | enumerated + `removeItem` at **`src/components/ImageUpload.tsx:240-243`** at the start of every `processFiles` | cleared per upload ✅ |
| `sortbot_analytics_force` | read-only (`src/lib/analytics.ts:51`) | — |
| `sortbot_analytics_session` | **sessionStorage** (`src/lib/analytics.ts:50, 76`) | not localStorage ✅ |

### `sortbot_workflow_backup` sizing

`ultraSlimForBackup` (`src/lib/slimItems.ts:63-71`) emits exactly 7 fields: `id, storagePath, productGroup, category, capturedAt, imageRotation, crop`.

Per-item JSON, with `storagePath` at 105 chars (A4) and uuid `id`/`productGroup`:

```
{"id":"<36>","storagePath":"<105>","productGroup":"<36>","category":"outerwear",
 "capturedAt":1757800000000,"imageRotation":0,"crop":{"x":10.5,"y":12.25,"w":70.125,"h":65.5}}
```

= 44 + 122 + 54 + 23 + 27 + 17 + 46 + 3 ≈ **336 chars/item** with a crop, **~290 chars** without (`crop: undefined` is dropped by `JSON.stringify`).

- **1,500 items → 435,000–504,000 chars ≈ 425–492 KB**, plus the `{"batchId":…,"savedAt":…,"items":[…]}` wrapper (~70 B). Call it **~500 KB = 9.6 % of the 5 MB quota.**
- 5,000 items (Library-scale batch) → **~1.68 MB = 32 %**.

**QuotaExceededError handling: `src/App.tsx:1834` — `catch { /* localStorage full or unavailable — skip */ }`. Silently swallowed.** No user-visible signal, no fallback, no eviction of the competing `sortbot_compressed_paths` blob. Since `sortbot_compressed_paths` grows without bound in the *same* 5 MB quota, the predictable end state is: compressed-paths wins the space, the backup write starts failing silently, and the "never lose grouping on refresh" guarantee documented at `App.tsx:1815-1818` quietly stops holding.

**Secondary: this write is synchronous and un-debounced by design.** `App.tsx:1819-1835` runs *before* the `autoSaveTimerRef` debounce (`:1838`), so **every single item mutation** performs a `JSON.stringify` of 1,500 items (~500 KB) plus a synchronous `setItem` on the main thread. At a modest 30 edits/minute that is **~15 MB/min of blocking stringify + disk I/O**, which is almost certainly a large share of the interaction jank in Step 3/4.

## A8. Unbounded React state arrays

Audited every `prev => [...prev, …]`:

| Site | Verdict |
|---|---|
| `src/App.tsx:332` `setToasts(prev => [...prev, …])` | **Bounded** — each entry removed after 4 s by `:333`. No cap on *concurrent* toasts, so a burst loop could pile up for 4 s, but no leak. |
| `src/App.tsx:473, 481, 482, 483` | The four workflow arrays. Grow with upload, cleared by `:1244` / `workflowStore.reset()`. Not a leak per se, but **four copies of the pointer set** (A5). |
| `src/components/ImageUpload.tsx:345` `setFailedUploads` | **Monotonic within a session**, each entry pins a `File`. Only cleared by `retryFailedUploads` (`:437`). A repeatedly-flaky 1,500-file batch accumulates File refs. |
| `src/components/SupportWidget.tsx:149` `setMessages` | Bounded — `loadMessages` replaces the array; this only appends the user's own just-sent message. ✅ |

**No unbounded log/analytics queue exists.** `src/lib/analytics.ts` has no buffer — it inserts directly and flips a module-level `available = false` (`:57`) on first failure. `src/components/Library.tsx:1314-1321` `addTrace` writes only to `console` (gated on `window.__SORTBOT_DEBUG__` at `:1315`), no state array. ✅ `src/lib/debugLogger.ts` keeps no ring buffer — everything goes to `console` only. ✅

---

# PART B — BUNDLE COMPOSITION (existing `dist/`)

## Current dist, measured

| File | raw B | gzip B |
|---|---|---|
| `dist/assets/index-C5V_uDCS.js` | **1,243,045** | **358,019** |
| `dist/assets/builtinBrandVocab-DqmDkqoP.js` | **361,354** | **71,331** |
| `dist/assets/tusUpload-DOVkKO_V.js` | **61,578** | **16,540** |
| `dist/assets/brandCategorySystem-B-Fo3I4p.js` | **29,548** | **8,448** |
| `dist/assets/index-CSQXvmAo.css` | **188,647** | **29,757** |
| **Total** | **1,884,172** | **484,095** |

Only 4 JS chunks total — `vite.config.ts` has **no `manualChunks`**, no `rollupOptions`, `sourcemap: false`.

## B9. What landed in the MAIN chunk

Grep evidence against `dist/assets/index-C5V_uDCS.js` (MAIN), `builtinBrandVocab-*.js` (VOCAB), `brandCategorySystem-*.js` (BCS), `tusUpload-*.js` (TUS). Counts are literal-match occurrences.

| Module | src bytes | Probe literal | MAIN | VOCAB | BCS | TUS | Verdict |
|---|---|---|---|---|---|---|---|
| `src/lib/vintagePatternEngine.ts` | 91,923 | `Ted Williams` / `Jackie Robinson` | 0 / 0 | **1 / 1** | 0 | 0 | **SEPARATE** ✅ |
| `src/lib/vintagePatternExpansion.ts` | 63,432 | `sweet orr` / `junya watanabe` | 0 / 0 | **2 / 7** | 0 | 0 | **SEPARATE** ✅ |
| `src/lib/vintagePatternExpansion2.ts` | 27,843 | `cameron indoor` | 0 | **1** | 0 | 0 | **SEPARATE** ✅ |
| `src/lib/vintagePatternExpansion3.ts` | **182,278** | `5th-avenue` | 0 | **1** | 0 | 0 | **SEPARATE** ✅ |
| `src/lib/vintagePatternExpansion4.ts` | 67,749 | `hartwell polo` | 0 | **1** | 0 | 0 | **SEPARATE** ✅ |
| `src/lib/brandCategorySystem.ts` | 50,859 | `MODEL_DATABASE` | 1¹ | 0 | **2** | 0 | **SEPARATE** ✅ |
| **`src/lib/colorDatabase.ts`** | 26,068 | `harvard crimson` / `#MULTI` | **1 / 3** | 0 | 0 | 0 | **IN MAIN** ❌ |
| **`src/lib/textAIService.ts`** | **110,185** | `All American Inc. Team Sports Specialists` | **1** | 0 | 0 | 0 | **IN MAIN** ❌ |
| **`src/lib/proseService.ts`** | 4,993 | `sure to turn heads` | **1** | 0 | 0 | 0 | **IN MAIN** ❌ |
| **`exifr`** | (1,468 KB pkg) | `DateTimeOriginal` | **10** | 0 | 0 | 0 | **IN MAIN** ❌ |
| **`jszip`** | (1,100 KB pkg) | `corrupted zip`, `JSZip` | **1, 5** | 0 | 0 | 0 | **IN MAIN** ❌ |
| **`react-dropzone`** | (864 KB pkg) | `file-invalid-type`, `getRootProps` | **1, 2** | 0 | 0 | 0 | **IN MAIN** ❌ |
| **`src/components/KanbanBoard.tsx`** | 38,693 | `No visible cards in this subsystem` | **2** | 0 | 0 | 0 | **IN MAIN** ❌ |
| **`src/components/Landing.tsx`** | 24,421 | `XL Vintage Y2K Nike 90s Tee` | **1** | 0 | 0 | 0 | **IN MAIN** (justified — logged-out first view) |
| **`src/components/OrgPanel.tsx`** | 55,859 | `Could not leave the workspace` | **1** | 0 | 0 | 0 | **IN MAIN** ❌ |
| **`src/components/VocabDashboard.tsx`** | 35,126 | `Brand keywords active again.` | **1** | 0 | 0 | 0 | **IN MAIN** ❌ (its *data* is lazy, its *shell* is not) |
| **`src/components/CrmPanel.tsx`** | 13,582 | `beta-chip--active` | **4** | 0 | 0 | 0 | **IN MAIN** ❌ |
| `src/components/SavedProducts.tsx` | 15,319 | `Failed to delete product. Please try again.` | **0** | 0 | 0 | 0 | **NOT SHIPPED — dead code** |
| `src/services/api.ts` | 16,214 | `OpenAI API key not configured…`, `Google API credentials not configured` | **0** | 0 | 0 | 0 | **NOT SHIPPED — dead code** |
| `src/lib/fitConditionDatabase.ts` | 26,319 | `Cracking in screen print` | **0** | 0 | 0 | 0 | **NOT SHIPPED — dead code** |
| `src/lib/constructionDatabase.ts` | 27,596 | `Denim with self-finished edge from shuttle loom` | **0** | 0 | 0 | 0 | **NOT SHIPPED — dead code** |
| `tus-js-client` / `src/lib/tusUpload.ts` | 4,455 | `tus-js-client`, `tusUploadFile` | 0 / 3² | 0 | 0 | **1 / 1** | **SEPARATE** ✅ |

¹ The single `MODEL_DATABASE` hit in MAIN is the property access `m.MODEL_DATABASE` from `src/components/VocabDashboard.tsx:67`'s dynamic import, not the data.
² The 3 `tusUploadFile` hits in MAIN are the dynamic-import binding/console strings at `src/components/ImageUpload.tsx:457-459`.

### Byte-offset landmark map of MAIN (1,243,045 B)

`grep -b -o -F -m1` first-occurrence offsets. Deltas are approximate region sizes, not exact module boundaries:

```
     13,324  react (Minified React error)
    194,007  react-dom
    230,531  exifr            ← ~56 KB region
    286,801  @supabase realtime-js
    344,599  @supabase gotrue-js
    523,870  react-dropzone   ← ~55 KB region
    579,133  jszip            ← ~165 KB region to next landmark
    743,860  colorDatabase    ← 28,079 B to next (src is 26,068 — matches)
    771,939  textAIService    ← ~75 KB
    847,020  proseService
             … ~207 KB of app code: App.tsx / ImageGrouper / PDG / Library / ImageUpload / CategoryZones …
  1,053,620  CrmPanel
  1,070,967  OrgPanel
  1,115,346  VocabDashboard
  1,150,520  KanbanBoard
  1,169,720  Landing
  1,243,045  end
```

Read-off: **~0–230 KB is React+ReactDOM, ~230–520 KB is exifr + supabase-js, ~520–745 KB is react-dropzone + jszip.** That's roughly **60 % of the 1.24 MB main chunk in vendor code**, of which **exifr + jszip + react-dropzone (~275 KB raw) are only needed on the Step-1 upload screen**, and jszip only for the `.zip` code path specifically.

## B10. Static import graph from `src/main.tsx`

`src/main.tsx:4` → `src/App.tsx`, which statically imports **everything**. `src/App.tsx` has no `React.lazy` and no dynamic component imports anywhere.

| Target | Static importers | In MAIN? |
|---|---|---|
| `vintagePatternEngine` + all 4 expansions (**433,225 B src combined**) | **Only** `src/lib/builtinBrandVocab.ts:1-5` (all 5 lines), which is itself reached **only** via `await import()` from `src/lib/vocabService.ts:121` and `src/components/VocabDashboard.tsx:55` | **No** ✅ |
| `brandCategorySystem` (50,859 B) | `src/App.tsx:44` (**`import type`** — erased), `src/components/VocabDashboard.tsx:13` (**`import type`** — erased), **`src/lib/brandMatcher.ts:6` (value import of `MODEL_DATABASE`)** | **No** ✅ — because `brandMatcher.ts` has **zero importers** (only a comment reference at `builtinBrandVocab.ts:38`). **`src/lib/brandMatcher.ts` (17,885 B) is dead code, and it is the ONLY static importer of both `vintagePatternExpansion` and `brandCategorySystem`. Wire it up and you immediately pull 361 KB + 29.5 KB into MAIN.** |
| `textAIService` (110,185 B) | `src/components/ProductDescriptionGenerator.tsx:10`, `src/components/GoogleSheetExporter.tsx:5`, `src/components/ComprehensiveProductForm.tsx:4`, `src/lib/csvExport.ts:2` — all four statically reachable from `App.tsx` | **Yes** ❌ |
| `colorDatabase` (26,068 B) | `src/lib/textAIService.ts:6` (`COLOR_WORDS_LIST`) → transitively from App | **Yes** ❌ |
| `jszip` | `src/components/ImageUpload.tsx:3` (`import JSZip from 'jszip'`) → `App.tsx:9` | **Yes** ❌ |
| `exifr` | **`src/App.tsx:2`** *and* `src/components/ImageUpload.tsx:4` | **Yes** ❌ (double static import; `App.tsx:2` makes it unavoidably eager) |
| `react-dropzone` | `src/components/ImageUpload.tsx:2` | **Yes** ❌ |
| `tus-js-client` | `src/lib/tusUpload.ts:21`, and `tusUpload` is **only** reached via `await import('../lib/tusUpload')` at `src/components/ImageUpload.tsx:457` | **No** ✅ — 61,578 B chunk |
| `lucide-react` | 22 files (`App.tsx:5-6`, `ImageGrouper.tsx:6`, `ProductDescriptionGenerator.tsx:5`, `Library.tsx:16`, `OrgPanel.tsx:2`, `KanbanBoard.tsx:2`, `CategoriesManager.tsx:18`, `CategoryZones.tsx:42`, `Landing.tsx:5`, `SupportWidget.tsx:2`, `CrmPanel.tsx:2`, `VocabDashboard.tsx:2`, `KanbanCardDetail.tsx:2`, `ImageUpload.tsx:9`, `WorkspaceMenu.tsx:2`, `ComprehensiveProductForm.tsx:2`, `GoogleSheetExporter.tsx:2`, `AnalyticsPanel.tsx:2`, `WaitlistGate.tsx:2`, `AISettings.tsx:3`, `TestLlamaVision.tsx:3`) | **Yes**, but tree-shaken per icon. **54 unique icon names app-wide:** `AlertTriangle Archive ArrowLeft ArrowRight Ban BarChart3 BookMarked Brain Building2 Calendar Check CheckCircle2 ChevronDown ChevronLeft ChevronRight Circle CircleDot Contact Copy DollarSign Edit2 FileText Folder Grid3x3 History Image KanbanSquare Layers LayoutDashboard ListTree LogOut Mail Merge MessageSquare Package Pencil Plus RefreshCw RotateCcw Ruler Search Send Settings ShoppingBag Sparkles Tag Trash2 User UserCog Users Wrench X XCircle Zap`. At ~400–700 B minified per icon ⇒ **~22–38 KB**. Acceptable; not a hotspot. |
| `@supabase/supabase-js` | `src/lib/supabase.ts:1`, reached from `App.tsx:3` | **Yes** — `realtime-js` (landmark 286,801) is ~58 KB and is used by exactly three files, two of which are dead (`useUserPresence.ts`, `LiveWorkspaceSelector.tsx`) plus `supportService.ts:143` |

## B11. Dynamic `import()` sites and which are DEFEATED

| Site | Module | Also statically imported? | Status |
|---|---|---|---|
| `src/components/ProductDescriptionGenerator.tsx:2079` | `../lib/supabase` | **YES** — `src/App.tsx:3`, plus ~30 other files | **DEFEATED** ❌ |
| `src/components/ProductDescriptionGenerator.tsx:2128` | `../lib/supabase` | same | **DEFEATED** ❌ |
| `src/components/ImageGrouper.tsx:427` | `../lib/imageTransforms` | No static importer exists | Works in principle, **but** Rollup inlines it into MAIN — confirmed: no `imageTransforms-*.js` chunk exists. **DEFEATED** ❌ |
| `src/components/ImageGrouper.tsx:519` | `../lib/imageTransforms` | same | **DEFEATED** ❌ |
| `src/components/ProductDescriptionGenerator.tsx:2111` | `../lib/imageTransforms` | same | **DEFEATED** ❌ |
| `src/components/ImageGrouper.tsx:467` | `../lib/productService` | **YES** — `src/App.tsx:19` (`saveBatchToDatabase`, `getThumbnailUrl`) | **DEFEATED** ❌ |
| `src/components/ProductDescriptionGenerator.tsx:2116` | `../lib/productService` | same | **DEFEATED** ❌ |
| `src/components/ImageUpload.tsx:457` | `../lib/tusUpload` | No | **WORKS** ✅ → `tusUpload-DOVkKO_V.js`, 61,578 B / 16,540 gz |
| `src/components/VocabDashboard.tsx:55`, `src/lib/vocabService.ts:121` | `../lib/builtinBrandVocab` | No (only `import type` at `VocabDashboard.tsx:12`) | **WORKS** ✅ → `builtinBrandVocab-DqmDkqoP.js`, 361,354 B / 71,331 gz |
| `src/components/VocabDashboard.tsx:67` | `../lib/brandCategorySystem` | Only `import type` (erased) + dead `brandMatcher.ts:6` | **WORKS** ✅ → `brandCategorySystem-B-Fo3I4p.js`, 29,548 B / 8,448 gz |
| `src/components/CategoryZones.tsx:199` | `import('../lib/categoryPresets')` | TypeScript type-only `import()` in a type position — not a runtime dynamic import | n/a |

**Confirms the build log exactly: `supabase.ts`, `imageTransforms.ts`, `productService.ts` — all three `import()`s are defeated.** Net effect: 5 of the 7 real dynamic imports produce no separate chunk. The two that work are the only reason MAIN isn't ~1.63 MB.

## B12. CSS

All 29 CSS imports are **static** (`grep "import '.*\.css'"` — no dynamic CSS anywhere), so everything reachable is concatenated into one render-blocking `<link>`.

| File | bytes | First paint? |
|---|---|---|
| `src/components/ImageGrouper.css` | 34,036 | No — Step 2 |
| `src/components/Library.css` | 30,481 | No — Library view |
| `src/components/ProductDescriptionGenerator.css` | 30,356 | No — Step 4 + crop modal (also imported by `ImageGrouper.tsx:10`) |
| `src/components/KanbanBoard.css` | 26,688 | **No — modal/panel** |
| `src/components/OrgPanel.css` | 24,820 | **No — panel** |
| `src/components/Landing.css` | 22,294 | Yes (logged-out) |
| `src/components/ImageUpload.css` | 19,023 | No — Step 1 (post-auth) |
| `src/index.css` | 15,124 | **Yes** |
| `src/App.css` | 14,830 | **Yes** |
| `src/components/SavedProducts.css` | 14,049 | **DEAD** — 0 hits for `saved-products` in shipped CSS ✅ not shipped |
| `src/components/VocabDashboard.css` | 10,213 | **No — panel** |
| `src/components/CategoryPresetsManager.css` | 10,101 | **No — modal** |
| `src/components/CategoryZones.css` | 9,714 | No — Step 3 |
| `src/components/CategoriesManager.css` | 6,769 | **No — modal** |
| `src/components/SupportWidget.css` | 6,496 | **No — collapsed widget** |
| `src/components/LoadingProgress.css` | 6,302 | **DEAD** — `LoadingProgress.tsx` never imports it; 0 hits for `loading-progress` ✅ not shipped |
| `src/components/ComprehensiveProductForm.css` | 5,688 | **No — modal** |
| `src/components/ui/Button.css` | 4,867 | *untracked, new this session* |
| `src/components/Auth.css` | 4,507 | Yes (auth view) |
| `src/components/AISettings.css` | 4,421 | **DEAD** ✅ not shipped |
| `src/components/LiveWorkspaceSelector.css` | 4,306 | **DEAD** ✅ not shipped |
| `src/components/GoogleSheetExporter.css` | 4,188 | **No — modal** |
| `src/components/RemoteCursors.css` | 3,404 | **DEAD** ✅ not shipped |
| `src/components/TestLlamaVision.css` | 3,011 | **DEAD** ✅ not shipped |
| `src/components/WaitlistGate.css` | 2,766 | Conditional |
| `src/components/ui/Spinner.css` | 2,421 | *untracked* (`spinner` = 2 hits → **is** shipped) |
| `src/components/WorkspaceMenu.css` | 2,060 | **No — dropdown** |
| `src/components/ui/base.css` | 1,963 | *untracked* |
| `src/components/ImageSorter.css` | 2,033 | **DEAD** ✅ not shipped |

**Sums:**

- **26 tracked CSS files: 317,680 B**
- Dead / never-imported: `SavedProducts 14,049 + LoadingProgress 6,302 + AISettings 4,421 + LiveWorkspaceSelector 4,306 + RemoteCursors 3,404 + TestLlamaVision 3,011 + ImageSorter 2,033` = **37,526 B** — correctly tree-shaken, verified by 0 grep hits for each class prefix in `index-CSQXvmAo.css` ✅
- Live CSS source: **280,154 B** → minified bundle **188,647 B / 29,757 gz**
- **Not needed for first paint — pure modals/panels/dropdowns:** `KanbanBoard 26,688 + OrgPanel 24,820 + VocabDashboard 10,213 + CategoryPresetsManager 10,101 + CategoriesManager 6,769 + SupportWidget 6,496 + ComprehensiveProductForm 5,688 + GoogleSheetExporter 4,188 + WorkspaceMenu 2,060` = **97,023 B (34.6 % of live CSS)**
- **Plus non-first-view screens:** `ImageGrouper 34,036 + Library 30,481 + ProductDescriptionGenerator 30,356 + CategoryZones 9,714` = **104,587 B**
- **First paint genuinely needs:** `index.css 15,124 + App.css 14,830 + Landing.css 22,294` (logged-out) or `+ Auth.css 4,507` ⇒ **~52.2 KB of 280 KB source (19 %)**. 81 % of the render-blocking stylesheet is for views the visitor cannot see.

## B13. Everything that runs before first paint

**Render-blocking, before any JS executes:**

1. `index.html:19` — inline `<style>` paints white (good, no FOUC).
2. Vite injects `<link rel=stylesheet href=/assets/index-CSQXvmAo.css>` — **188,647 B / 29,757 gz, render-blocking**, 81 % unused at first paint (B12).
3. `<script type="module" src="/assets/index-C5V_uDCS.js">` — **1,243,045 B / 358,019 gz must be downloaded, parsed and executed** before `createRoot(...).render()` at `src/main.tsx:26`.

**Module-evaluation side effects during that 1.24 MB execution** (all synchronous, all before React mounts, ordered by import graph from `src/main.tsx:3-4`):

| Site | Side effect |
|---|---|
| **`src/lib/debugLogger.ts:25`** | `window.__SORTBOT_DEBUG__ = localStorage.getItem('sortbot_debug_enabled') === 'true'` — **synchronous localStorage read at import time** |
| **`src/lib/debugLogger.ts:247-249`** | `if (window.__SORTBOT_DEBUG__) attachDomListeners()` — **attaches 20 `document` listeners before React exists** |
| **`src/lib/supabase.ts:6-8`** | `throw new Error(...)` if env vars missing — **a missing env var white-screens the app at module eval, before any error boundary** |
| **`src/lib/supabase.ts:10`** | `createClient(url, key)` — constructs GoTrue (reads auth token from storage), PostgREST and Realtime clients at import time |
| **`src/lib/colorDatabase.ts:599-613`** | Top-level `for (const [name, ctx] of Object.entries(COLOR_DNA))` over 500+ colors, pushing into `COLOR_WORDS_LIST` + `COLOR_RGB_MAP` and calling `hexToRgb` per entry — **~1,500 iterations of work on the critical path** |
| **`src/lib/workflowBatchService.ts:55-62`** | IIFE: `JSON.parse(localStorage.getItem('sortbot_deleted_batch_ids'))` → `new Set` — **synchronous localStorage read + parse at import time** |
| `src/lib/csvExport.ts:368` | `CANONICAL_TAXONOMY_PATHS = new Map(...)` built at import |
| `src/App.tsx:30-33` | 4× `liveArrayRef(...)` at module scope |
| `src/lib/workflowStore.ts:43-52` | `initialState`, `state`, `listeners` module singletons created |

**`src/main.tsx:11-24` — SW registration timing:** correctly deferred to `window.addEventListener('load', …)` (`:14`), i.e. **after** first paint and after all subresources. ✅ Caveats: `sw.js:37` `skipWaiting()` + `sw.js:45` `clients.claim()` mean a new SW seizes control mid-session, and `sw.js:47-48` (`pruneOldCaches` + `pruneExpiredEntries`) is the **only** place pruning ever runs — so on a returning user with 15,000 entries it does `cache.keys()` + a `cache.match()` per entry inside `event.waitUntil` (`sw.js:161-170`), i.e. **15,000 `match()` calls competing with the 1,500 image fetches the page is issuing at the same moment.**

**`src/main.tsx:26-30`** — `createRoot(...).render(<StrictMode><App/></StrictMode>)`. StrictMode double-invocation of effects is **development-only**; in this production build the double-mount is not happening, so the `sortbot_orphan_cleanup_v3` and auth effects fire once per mount.

**Top-level `App` effects that hit the network, in hook order** (all above the early returns, so all run before any content renders — `loading` gates the UI at `App.tsx:1166`):

| Site | Deps | Network |
|---|---|---|
| `App.tsx:383` | `[showLibrary]` | none (ref mirror) |
| `App.tsx:387-435` | `[]` | registers `presetsUpdated`; the handler calls `getCategoryPresets()` (`:393`) on event |
| `App.tsx:491-494` | `[user]` | **`fetchStorageUsage(user.id)`** |
| **`App.tsx:625-…`** | `[]` | **`supabase.auth.getSession()` → `SELECT * FROM workflow_batches WHERE id=…` (`:637-640`) → reads `sortbot_workflow_backup` (`:670`) → then `rawItems.map(...)` at `:684` calls `supabase.storage.getPublicUrl(item.storagePath)` (`:686`) **and** `getThumbnailUrl(item.storagePath, 300)` (`:695`, which is *another* `getPublicUrl` — `productService.ts:16`). **For 1,500 items that is 3,000 synchronous `getPublicUrl` calls + a 1,500-element map on the main thread before the grid can render.** |
| `App.tsx:1095-1096` | `[]` | `onAuthStateChange` subscription (cleaned up ✅) |
| **`App.tsx:1103-1127`** | **`[user]`** | **the one-time `sortbot_orphan_cleanup_v3` effect** — below |
| `App.tsx:1132-1160` | `[user?.id]` | **`ensureOrganization(user)`** → then **`getOrgDescriptionSettings(res.org.id)`** (`:1144`) |
| `App.tsx:1165-1168` | `[loading, user, showLogin, betaWaitlist]` | **`trackPageview(...)`** → `INSERT INTO analytics_events` |

### The `sortbot_orphan_cleanup_v3` effect (`src/App.tsx:1103-1127`) — specifics

```ts
useEffect(() => {
  if (!user) return;
  const CLEANUP_KEY = 'sortbot_orphan_cleanup_v3';      // :1105
  if (localStorage.getItem(CLEANUP_KEY)) return;        // :1106
  (async () => {
    try {
      const badPrefixes = ['17796956', '17796957', '17796974'];   // :1113
      for (const prefix of badPrefixes) {
        await supabase.from('product_images').delete()
          .like('storage_path', `%${prefix}%`);          // :1118
      }
    } catch { /* swallowed */ }
    finally { localStorage.setItem(CLEANUP_KEY, '1'); } // :1123
  })();
}, [user]);                                             // :1127
```

- Three **serially awaited** `DELETE … LIKE '%prefix%'` statements. A **leading wildcard defeats any index** on `storage_path` → three full sequential scans of `product_images`, awaited one after another, on the first session of every browser, concurrent with the startup restore above.
- Deps are **`[user]`, not `[user?.id]`** (contrast `:1160`, which correctly uses `[user?.id]`). The re-entry guard is the localStorage key, only written in the `finally` at `:1123` — i.e. **after** all three DELETEs. Any `user` object-identity change during that window starts a **second concurrent run**.
- The `catch {}` at `:1120` swallows failures, then `:1123` still writes the key — so a cleanup that failed (RLS, timeout) is permanently recorded as done.
- Hardcoded 2024-era timestamp prefixes; `v3` implies `v1`/`v2` keys are still squatting in localStorage on older browsers with no removal path.

---

# Priority ranking

1. **`src/lib/imageTransforms.ts:17` unbounded `_imgCache`** — 24 GB at 1,500 × 2000², tab-fatal at ~130–250 images. The code comment at `:13-16` asserts the opposite of the truth. Needs an LRU with a byte budget (or `ImageBitmap` + `close()`, or `createImageBitmap` with `resizeWidth`).
2. **`src/components/ImageUpload.tsx:38-44` `markCompressed` is O(n²)** — ~2.4 GB of synchronous string churn + ~810 MB of blocking `localStorage.setItem` per 1,500-image batch, and the key is unbounded toward the 5 MB quota (full at ~48.5 K paths). Keep the Set in memory, flush once per batch.
3. **`src/App.tsx:1819-1835` un-debounced synchronous `JSON.stringify` of 1,500 items (~500 KB) on every mutation** → ~15 MB/min of main-thread disk I/O, with `QuotaExceededError` silently swallowed at `:1834`.
4. **Main chunk: ~275 KB of `exifr` + `jszip` + `react-dropzone` eager**, plus `textAIService` (110 KB src) + `colorDatabase` (26 KB) + `KanbanBoard`/`OrgPanel`/`VocabDashboard`/`CrmPanel` (143 KB src of panels). The 5 defeated `import()`s mean the only real code-splitting wins are the two that survive. `exifr` is statically imported *twice* (`App.tsx:2` is the gratuitous one).
5. **`public/sw.js`: no entry/size cap, prune only on activate, and `refreshInBackground` re-fetches on every hit** → ~6.3 GB Cache Storage at 10 × 1,500, whole-origin eviction, and the original 800-revalidation problem is not actually solved.
6. **`src/components/ImageGrouper.tsx:1711-1713` `autoScrollRafRef` has no unmount cleanup** — a 60 fps infinite rAF if a reorder drag ends abnormally.
7. **`src/lib/debugLogger.ts:96/247` — 20 unowned `document` listeners with `console.log({target, event})`** → unbounded detached-DOM retention when debug is on.
8. **`src/components/GoogleSheetExporter.tsx:254` missing `revokeObjectURL`** — ~3 MB per CSV export, permanent.
9. **Dead source in the tree** (not shipped, but ~190 KB of maintenance surface): `src/services/api.ts` (16,214), `src/lib/brandMatcher.ts` (17,885 — *and the tripwire that would pull 391 KB into MAIN*), `src/lib/constructionDatabase.ts` (27,596), `src/lib/fitConditionDatabase.ts` (26,319), `src/lib/exportLibraryService.ts` (12,844), `src/components/SavedProducts.tsx` (15,319), `src/components/ImageSorter.tsx`, `src/components/TestLlamaVision.tsx` + `src/lib/huggingfaceService.ts` (5,958), `src/components/RemoteCursors.tsx` + `src/hooks/useUserPresence.ts`, `src/components/LiveWorkspaceSelector.tsx`, `src/components/AISettings.tsx`, plus 37,526 B of matching dead CSS.
10. **`src/App.tsx:1103-1127`** — three unindexed `DELETE … LIKE '%…%'` on the critical path of every browser's first session, with a `[user]` dep that permits a concurrent second run.
