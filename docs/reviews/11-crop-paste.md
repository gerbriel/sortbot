# 11 — bulk paste-crop: "99 % accurate but 1–3 are cropped weird"

Scope: `src/lib/imageTransforms.ts`, `src/components/ImageGrouper.tsx` (+ tests).
`src/components/ProductDescriptionGenerator.tsx` is owned by another agent — the two
edits it needs are written out verbatim at the bottom. Nothing committed.

## Gates

| Gate | Before | After |
|---|---|---|
| `npm test` | 579 | **659 passed / 41 files** at the final run — +30 mine (25 geometry/source-resolution, 5 queue); the rest arrived from the concurrent agent while this ran |
| `npm run build` | clean | **clean** (`tsc -b && vite build`) |
| `npx eslint .` | **254 problems** (238 errors, 16 warnings) | **253** (237, 16) — *below* baseline |
| `imageTransforms.ts` + `.test.ts` | 0 | **0** |
| `ImageGrouper.tsx` | 9 warnings, 0 errors (measured on `git show HEAD:` through `--stdin`) | **9 warnings, 0 errors — identical**, none on a line I added |

Bundle unaffected: `ImageGrouper` now imports `createTransformQueue` statically, but
`productService.ts:3` already imported `imageTransforms` statically, so the module was
in the main chunk either way.

---

## 1. The traced path

### 1.1 How a crop is represented

`ClothingItem.crop` — `App.tsx:343` — is `{x,y,w,h}` in **percent 0–100**, plus
`imageRotation` (degrees, `App.tsx:342`) and the pre-crop cache
`originalStoragePath` / `originalUrl` (`App.tsx:352-353`).

The percentages are relative to the **rotated frame**, not the natural bitmap:

- the modal renders `<img className="crop-fs-image">` with
  `style={{ transform: rotate(${rot}deg) }}` (`ImageGrouper.tsx:3331`) and measures it
  with `getBoundingClientRect()` (`measureGCImg`, `:445`), which returns the **transformed**
  axis-aligned box — so at 90°/270° the measured box is already w/h-swapped;
- `createTransformedFile` therefore rotates onto an intermediate canvas first and crops
  second (`imageTransforms.ts:441-470`). The two agree. **Not a bug.**

`.crop-fs-image` is `max-width/max-height` + `object-fit: contain` with no explicit
width/height, so the replaced element's used size already carries the image's aspect —
there is no letterbox inside the element box for `getBoundingClientRect()` to include.
**Not a bug.**

### 1.2 EXIF — verified, and deliberately left alone

`image-orientation: from-image` is the initial value for `<img>` in every current engine, so
a decoded element reports **oriented** `naturalWidth/naturalHeight` and `drawImage` paints
the **oriented** bitmap. The modal `<img>` and the canvas `<img>` are the same kind of
element loaded the same way, so both see one consistent frame. Adding manual EXIF handling
here would double-apply orientation on EXIF 6/8 phone photos. The reasoning is now recorded
in the geometry header comment (`imageTransforms.ts:112-128`) so nobody "fixes" it.

### 1.3 Copy → paste → apply

| Step | Where (HEAD) | What it did |
|---|---|---|
| Copy Crop (toolbar) | `ImageGrouper.tsx:2647` | `setCopiedCrop(source.crop ?? null)` — **percentages only; the source's shape is not recorded** |
| Copy crop (group ⋯ menu) | `:3022` | same |
| Copy Crop (lightbox) | `:3176` | same |
| Paste to N | `:2683` → `runCropBatchPaste` `:659` | chunks of 8, `Promise.all` per chunk |
| Per item | `applyAndPersistTransformGrouper` `:513` | `createTransformedFile` → upload to a **fresh** `cropped-${Date.now()}` path → `product_images` insert → delete previous crop → `commitFunctional` + `onGrouped` |
| Pixels | `imageTransforms.ts` `createTransformedFile` | `src = item.preview \|\| item.imageUrls[0]`, rotate, `sx=round(x/100*rotW)` … |

`copiedRotation` is separate state; when it is `null` the per-item call passes
`rotationOverride: undefined` and the item's **own** `imageRotation` is used. That is
correct-as-intended (the grid displays the item rotated, so the user expects the crop to
land on what they see) — but it means a rotated target's frame is w/h-swapped relative to
the source the crop was drawn on, which folds into mechanism **M1** below.

### 1.4 The async batch — what was checked

- **Load before draw**: `loadImageWithRetry` resolves on `onload`, so the network half was
  fine; a *cached* element was returned with no liveness check at all.
- **LRU correctness**: keyed by exact URL, reads refresh recency, a miss is a re-fetch —
  the byte-budgeted LRU from `03-performance-fixes.md` is sound and **not** a source of
  wrong pixels. It cannot return an element for a different URL.
- **`_retry=` / `?t=`**: retries cache-bust the `img.src` but `cacheImage` keys the clean
  `src`, so no split entries. The service worker strips `?t=` (`public/sw.js:99`) but not
  `_retry=` — cosmetic only.
- **Service worker staleness**: the ImageGrouper path uploads to a **new** timestamped path
  every time, so the SW's 7-day stale-while-revalidate entry for the old URL is never
  re-read. **The PDG path does not** — see M6.

---

## 2. Confirmed mechanisms for the 1–3 %

Five independent causes, all reproducible from the code, each hitting a *minority* of a
batch. That is the signature: nothing here fails 100 % of the time.

### M1 — percent crop pasted onto a differently-shaped frame *(confirmed, by construction)*

`crop` is percent-of-frame and carries no record of the frame it was drawn on. A 70 %×60 %
rect drawn on 4:3 becomes a **portrait** rect on a 3:4 target (`2100×2400` instead of the
drawn `2800×1800` shape — pinned in `imageTransforms.test.ts`). Which items differ from
the rest of a shoot:

- the one or two frames shot in the other orientation;
- any item with a non-zero `imageRotation` — rotation swaps the frame's w/h;
- **any item already cropped once**, whose current frame is the previous crop's shape.

### M2 — a repeat paste crops the crop *(confirmed)*

`createTransformedFile` read `item.preview || item.imageUrls[0]`. After the first crop the
mapper sets `preview`/`imageUrls` to the **cropped** file (`ImageGrouper.tsx:639`), so
a second paste applies full-frame percentages to an already-cropped image and zooms in
again — 70 % of 70 %. `originalStoragePath`/`originalUrl` were maintained faithfully but
**never used as a transform source**. The items hit are exactly the handful the user had
hand-cropped before running the bulk paste.

### M3 — a failed item was reported as a success *(confirmed)*

`applyAndPersistTransformGrouper` ended in `catch (err) { console.error(...) }` (HEAD `:616`)
and `return`ed early on `!file` and on the upload fallback failing. It could therefore
**never reject**, so `runCropBatchPaste`'s `.catch()` was dead code, `failed` stayed empty,
the Retry button never appeared, and the item was counted ✅ while staying uncropped. The
population is transient image-load/upload failures — the exact reason `LOAD_RETRIES = 3`
exists — which land at a low single-digit percentage on a long batch.

### M4 — concurrent `onGrouped` payloads dropped each other's crops *(confirmed)*

Each finisher called `onGrouped(groupedItemsRef.current.map(cropMapper))` (HEAD `:608`).
`commitFunctional` updates `groupedItemsRef.current` inside the **setState updater**, which
React runs lazily — so within a chunk of 8 several finishers map the *same pre-chunk array*
through their own single-item mapper. Each payload contains its own crop and **reverts its
siblings**. App stores one; the stale `storagePath` then comes back through the `items`
prop into `initializeItems`, where `pathChanged` is true (stale path ≠ the new one) and the
code "trusts incoming" (`ImageGrouper.tsx:1291`) — reverting that item's URLs to the
pre-crop file. The trailing `setTimeout(… onGrouped(ref.current))` usually won the race,
which is why this corrupts a few items rather than all of them.

### M5 — two transforms racing on one item *(confirmed, latent)*

Nothing serialised per item. A double-clicked **Paste to N**, the **Retry** button firing
while the first pass still drains, or a group card and the photo toolbar naming the same
photo all produce two in-flight transforms that read the same pre-crop `baseItem`, upload to
two paths, insert two rows, and each delete what it thinks is "the previous crop" — which
can be the other's freshly uploaded file, leaving a row pointing at a deleted object.

### M6 — PDG only: same-path overwrite + no cache eviction *(confirmed, other agent's file)*

`ProductDescriptionGenerator.tsx:2067` uploads with `uploadFileToPath(file, item.storagePath, true)`
— **overwriting the same storage path**, so the public URL never changes — and never calls
`evictCachedImage`. Three caches then hold the pre-crop bytes for that URL: the
`imageTransforms` LRU, the service worker (7-day stale-while-revalidate,
`public/sw.js:107-120`), and the HTTP cache. A second paste therefore re-crops the
**original** for items still served stale and the **cropped** file for items whose entry was
evicted or revalidated — per-item nondeterminism, i.e. a handful of differently-framed
images in an otherwise uniform batch. PDG also sets `crop: undefined` after applying, so its
own state cannot tell the two cases apart.

### Ruled out

Anything that would have to fail uniformly: the LRU returning a mismatched URL (keyed
exactly), EXIF double-application (§1.2), `?t=`/`_retry=` splitting cache entries,
`cropped-${Date.now()}` path collisions (the directory is per-item, `{userId}/{productId}/`).

---

## 3. The fix

### (a) Pure, tested geometry — `src/lib/imageTransforms.ts`

| Export | Line | Contract |
|---|---|---|
| `rotatedSize(w, h, rot)` | `:148` | axis-aligned box after rotation; total over `NaN`/0/negative degrees |
| `computeCropRect(source, crop, opts)` | `:202` | percent → integer source rect; **identical arithmetic to the old inline code** when no `sourceAspect` is given or the aspects match, then clamped |
| `clampRect` | `:187` | slides rather than shrinks; never empty, never past the frame |
| `resolveTransformSource(item, mode)` | `:309` | `'current'` = the file the modal displayed; `'original'` = the cached pre-crop file, falling back to current |
| `getSourceFrameAspect(url, rot)` | `:374` | source shape for a copy; also warms the LRU with the image the paste will read |
| `createTransformQueue()` | `:277` | per-key serialisation; the stored tail never rejects, each caller's promise still does |

**Aspect-preserving paste (fixes M1).** When `opts.sourceAspect` is supplied and differs from
the target's, the crop's drawn *shape* is reproduced instead of its raw percentages: take the
larger of "keep the vertical extent" and "keep the horizontal extent" that fits, anchor on the
crop's relative centre, then clamp. **When the aspects match the two candidates are
algebraically the same rect as the percent mapping**, which is how the 99 % stay byte-identical
— proved in a test that replays the pre-fix formula and `toEqual`s it.

**Source resolution (fixes M2).** `createTransformedFile(item, { sourceMode })` defaults to
`'current'`, so the interactive modal and `productService`'s save path are unchanged. Only the
bulk paste passes `'original'`, which makes a repeat paste idempotent instead of compounding.

**Decode guard.** `createTransformedFile` now `await img.decode()`s and rejects a zero-size
bitmap before touching a canvas (`:424-431`); `loadImageWithRetry` refuses a cached element that
is not `complete && naturalWidth > 0`, evicting and re-fetching instead (`:320-334`) — a
half-decoded element silently paints a blank frame.

### (b) Robust batch — `src/components/ImageGrouper.tsx`

- **Failures propagate** (M3): `applyAndPersistTransformGrouper` throws on missing base item,
  null transform and failed upload, and rethrows from its catch (`:543`, `:673`). `.catch()` in
  `runCropBatchPaste` is live again, so `failed` is real and the Retry button works. The one
  interactive caller (modal **Done**) wraps it and reports.
- **One parent notification per batch** (M4): the per-item `onGrouped` is suppressed when
  `batched` (`:661`); `runCropBatchPaste`'s existing trailing `setTimeout` is now the only
  payload, so no finisher can publish an array that reverts its siblings.
- **Per-item serialisation** (M5): every transform goes through `queueItemTransform`
  (`:426-429`), backed by `createTransformQueue`. Different items stay parallel (chunks of 8
  are unchanged); the same item can never overlap. Plus `cropPasteRunningRef` (`:432`) makes
  the whole batch non-re-entrant, and target ids are de-duplicated.
- **Shape capture** (M1): `captureCopiedCrop` (`:684`) replaces the three bare
  `setCopiedCrop` sites and fire-and-forget resolves the source frame's aspect into
  `copiedCropAspect` (`:350`), threaded into all three paste call sites (`:2371`, `:2784`,
  `:3140`). A failure leaves it `null` → plain percent-of-frame → today's behaviour.
- **Deterministic busting**: unchanged and already correct here — a fresh
  `cropped-${Date.now()}` path per crop, plus `evictCachedImage` on the old URLs. Sourcing
  from `originalUrl` keeps the original resident, so the batch reads it from memory.

### (c) Proof the 99 % did not move

`imageTransforms.test.ts` carries a `legacyRect()` helper — the pre-fix formula, verbatim —
and asserts `toEqual` against `computeCropRect` for four frame sizes, for a same-aspect paste
*with* an aspect supplied (`4000×3000 → 2000×1500`, exactly `{200, 225, 1400, 900}`), for
sub-epsilon aspect drift, and for every unusable `sourceAspect` value.

---

## 4. Tests added (30; `npm test` 659 green)

- `rotatedSize` — 0/90/180/270, negative degrees from `rotateSelected`, degenerate input (4)
- identity for the 99 % — legacy-formula equality, same-aspect-with-aspect, drift, no-crop (4)
- differently-shaped targets — landscape→portrait, portrait→landscape, rotated target,
  centre anchoring, shrink-to-fit (5)
- clamping — out-of-frame, the independent-rounding `1001 > 1000` overflow, negative/over-100
  percentages, sub-pixel crop, `NaN`, unusable source, bad `sourceAspect` (7)
- `resolveTransformSource` — modal reads current, paste reads original, fallbacks, and a
  **double-paste idempotence** test showing the un-fixed path losing another 30 % (5)
- `createTransformQueue` — strict same-key ordering, cross-key parallelism, failure isolation,
  no bookkeeping leak over 50 items, pending accounting (5)

---

## 5. Deferred to the orchestrator — `ProductDescriptionGenerator.tsx`

M6 lives entirely in the other agent's file. Two edits, both small.

**Edit 1 — stop overwriting the storage path in place** (`applyAndPersistTransform`, the
`uploadFileToPath` branch — `:2067` as of this writing; that file is being edited concurrently,
so go by symbol name, not line). Replace the
`uploadFileToPath(file, item.storagePath, true)` branch with the fresh-path upload
ImageGrouper already uses, so the public URL changes on every crop and no cache can serve
pre-crop bytes. If that is too large a change, the minimum viable fix is to evict the URL
from all three caches after the overwrite:

```ts
// after a successful uploadFileToPath overwrite, before setProcessedItems:
const { evictCachedImage } = await import('../lib/imageTransforms');
evictCachedImage(res.url);
if (item.preview) evictCachedImage(item.preview);
// the SW keeps a 7-day stale-while-revalidate copy under the SAME url
try { await caches.open('sortbot-images-v1').then(c => c.delete(res.url)); } catch { /* ignore */ }
```
(confirm the cache name against `public/sw.js` before pasting).

**Edit 2 — bulk paste must read the original and not compound** (`handlePasteCrop`, `:2090`;
`applyAndPersistTransform`, `:2055`). Pass the new options through:

```ts
const file = await createTransformedFile(item, {
  sourceMode: bulk ? 'original' : 'current',
  cropSourceAspect,
});
```
where `bulk` is a new parameter set by `handlePasteCrop` and `cropSourceAspect` comes from
`getSourceFrameAspect(sourceUrl, sourceRotation)` captured when `copiedCrop` is set
(`:209`). Both options are optional and default to today's behaviour, so PDG keeps compiling
and behaving identically until this edit lands.

PDG also swallows failures the same way M3 described (`applyAndPersistTransform` returns on
`!file` and catches at `:2082`) and reports `cropPasteProgress` as complete regardless —
worth the same rethrow treatment.

---

## Summary

- Traced copy → paste → canvas → upload end to end; EXIF handling and the byte-budgeted LRU
  are correct and were left alone.
- **Five confirmed mechanisms**, each hitting a minority of a batch: percent crops pasted
  onto differently-shaped frames (M1), repeat pastes cropping the crop because the source was
  the cropped file (M2), failures counted as successes (M3), concurrent `onGrouped` payloads
  reverting each other (M4), unserialised transforms racing on one item (M5).
- A sixth, PDG-only: same-path overwrite with no cache eviction, so the SW/LRU serve pre-crop
  bytes for some items and not others (M6) — **deferred, exact edits in §5**.
- Fix: new pure `computeCropRect` / `rotatedSize` / `resolveTransformSource` /
  `createTransformQueue` in `imageTransforms.ts`; `createTransformedFile` gained a decode
  guard and `{sourceMode, cropSourceAspect}`; the batch now throws on failure, notifies the
  parent once, serialises per item, is non-re-entrant, and records the copied crop's shape.
- **The 99 % are provably unmoved**: tests replay the pre-fix formula and assert equality.
- Gates: `npm test` 659 green (+30), `npm run build` clean, eslint **253 ≤ 254**, 0 findings
  on my files.

---

## §5 applied — `ProductDescriptionGenerator.tsx` (follow-up)

PDG was released by the voice agent and the deferred edits were applied directly. Symbols
were re-located by name: that file had been substantially reworked (speech parser extracted
to `src/lib/voiceGrammar.ts`, new save paths, a Period button), so every line number in §5
above was stale. **No voice-related code was touched.**

### Gates (this follow-up)

| Gate | Before | After |
|---|---|---|
| `npm test` | 662 | **668 passed / 41 files** (+6 invalidation tests) |
| `npm run build` | clean | **clean** |
| `npx eslint .` | **252** | **252** — net zero |
| findings on lines I added | — | **none** (PDG's 20 errors / 12 warnings are all pre-existing `no-explicit-any`, unused `err`, and `exhaustive-deps` at lines 243–2763, none inside my edited regions) |

### What the trace turned up that §5 did not know

`public/sw.js` states the invariant out loud in its cache-hit branch: *"Product images are
immutable per storage_path (a re-crop writes a NEW path), so a fresh entry has nothing to
learn from the network."* ImageGrouper honours that. **PDG's crop path is the one place in
the app that violates it** — `uploadFileToPath(file, item.storagePath, true)` replaces the
bytes at an unchanged URL. M6 is therefore not a subtlety; it is a documented assumption
being broken, and the SW will keep serving pre-crop bytes for up to 7 days.

### Edit 1 — minimum fix, deliberately (not the fresh path)

I chose the minimum fix. The fresh-path route is *mechanically* easy here — PDG's existing
`uploadTransformedImage` fallback branch already uploads to a new path — but promoting it to
the primary would make its bare `supabase.storage.remove([item.storagePath])` run on **every**
crop instead of rarely. That is a §18 #15 hazard (duplicated batches share storage files, and
this delete does not go through `filterUnreferencedStoragePaths`), and PDG has no
`originalStoragePath`/`originalUrl` caching to build a safe revert on. Escalating an unsafe
delete from "rare fallback" to "every crop" is not a contained change.

New in `imageTransforms.ts`: **`invalidateImageUrl(url)`** — drops the LRU entry, deletes the
Service Worker entry (importing `IMAGE_CACHE_NAME` from `src/lib/swCache.ts` rather than
duplicating the `'sortbot-images-v1'` literal), and marks the URL in a module-level
`_forceFreshUrls` set. `loadImageWithRetry` consumes that mark on the next read and loads via
a `?_fresh=<ts>` suffix — deliberately **not** one of the params `sw.js:stripCacheBust`
removes (`t`, `_retry`), so it misses the SW cache *and* the HTTP cache, which the other two
deletions cannot reach (Supabase uploads with `cacheControl: '3600'`). The decoded element is
then cached under the clean URL and the mark cleared, so exactly one read pays the cost — a
blanket `fetch(url, {cache:'reload'})` per item would have re-downloaded the whole batch.
Never throws: Cache Storage can be absent or blocked, and that must not fail a crop.

Called after the in-place overwrite succeeds, and on the fallback branch after the old file
is removed.

> Rejected: versioning the in-memory `preview` URL. `productService.saveBatchToDatabase`
> assigns `imageUrl = item.preview` when `storagePath && preview`, so a `?v=` suffix would
> have been written to `product_images.image_url`. (All `buildProductImageRow` call sites
> derive the URL from `imageUrls`/`storagePath` and would have been safe — this one is not.)

### Edit 2 — source resolution + shape, in full

`applyAndPersistTransform` gained a 4th parameter `{ bulk?, cropSourceAspect? }` and passes
`{ sourceMode: bulk ? 'original' : 'current', cropSourceAspect }` into `createTransformedFile`.
`handlePasteCrop` sets `bulk: true`. The interactive modal path is unchanged by default.

Aspect capture: PDG copies a crop in exactly one place — the modal's **Copy Crop** button,
which copies `tempCrop`. That handler now also resolves `getSourceFrameAspect(srcUrl,
srcItem.imageRotation)` for `cropModal.itemId` into new `copiedCropAspect` state
(fire-and-forget; failure leaves it `null` → plain percent-of-frame → historical behaviour).
The ✕ clear button resets it.

Note on reach: PDG never sets `originalUrl`/`originalStoragePath` (it sets `crop: undefined`
after applying and has no revert), so `sourceMode: 'original'` resolves to the current file
for items only ever cropped in Step 3 — a clean no-op fallback. It *does* bite for items
cropped in Step 2 first, where ImageGrouper populated those fields. Giving PDG its own
original-caching is the remaining half of M2 for this component and is left for a product
decision, not smuggled in here.

### Edit 3 — real failure reporting

`applyAndPersistTransform` now throws on a missing item, a null transform, and both upload
paths failing, and rethrows from its catch. `handlePasteCrop` wraps each item in
`.then/.catch` so one failure cannot abort the run **or** be counted as a success, tracks
`failedIds`, and on a non-empty list logs them, holds the progress readout, and alerts the
user that those photos are unchanged in storage — which matters because the crop was already
applied optimistically to `processedItems` for the clip-path preview, so the UI would
otherwise show a crop that was never baked. `cropPasteProgress` carries a `failed` count and
the inline readout appends `· N failed`. A `cropPasteRunningRef` makes the batch
non-re-entrant. The modal's **Done** wraps the call and reports.

### Tests (+6, all in `imageTransforms.test.ts`)

`invalidateImageUrl`: drops the LRU entry and its bytes; opens exactly `IMAGE_CACHE_NAME` and
deletes that URL; marks the URL once and only once; still marks when Cache Storage is absent;
never throws when Cache Storage rejects; no-op on an empty URL. `__resetImgCacheForTests`
now also clears the force-fresh set so the module state cannot leak between tests.
