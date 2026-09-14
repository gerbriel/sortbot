# 12 — grouping, persistence and save-status: founder reports 16, 29, 30 + the autosave audit

Scope: `src/App.tsx`, `src/components/ImageGrouper.tsx`, `src/lib/productRow.ts`,
`src/lib/workflowBatchService.ts`, plus two new pure modules (`restoreSource.ts`,
`selectionGesture.ts`) and their tests. `ProductDescriptionGenerator.tsx` and the
Step-3 indicator itself belong to another agent — the two things that path needs
are written out at the end. Nothing committed.

## Gates

| Gate | Before | After |
|---|---|---|
| `npm test` | 713 passed / 43 files | **965 passed / 48 files** — +45 mine (20 restoreSource, 15 selectionGesture, 7 autosave outcomes, +3 net productRow); the rest arrived from the two concurrent agents while this ran |
| `npm run build` | clean | **clean** at the last green run; it fails intermittently on `ProductDescriptionGenerator.tsx` / `brandSpelling.ts` / `OrgPanel.tsx` mid-edit, which are another agent's files. `tsc -b` filtered to everything else is clean throughout. |
| `npx eslint .` | **252 problems** (236 errors, 16 warnings) | **255** (239, 16). The +3 is `src/components/LabelPrintView.tsx`, a new untracked file from another agent (`git status` confirms). |
| per-file lint, every file I touched | App 41 · ImageGrouper 9 · workflowBatchService 4 · productRow 0 | **identical, every file** — measured against `git show HEAD:<file>` piped through `eslint --stdin`. Zero findings on any line I added. The four new files are at **0**. |
| react-hooks v7 | — | no new hooks, no new dep arrays, no disable comments added |
| §18 rails | — | delete phase kept · no `batch_id` in any upsert · all chunking kept · autosave debounce still 2 000 ms (the new retry is 1 000 ms, the floor) |

---

# Report 16 — "random images are getting flipped upside down when they reach the dictation step"

## 1. The traced path

Every place an image's orientation can change between upload and Step 3:

| Stage | Where | What it does to orientation |
|---|---|---|
| upload compression | `ImageUpload.tsx:190-220` (`compressImage`) | decodes an `<img>` and re-draws it at `naturalWidth/Height`. **Does not read EXIF at all** — `exifr` is imported only for `DateTimeOriginal` (`:172`). |
| `imageRotation` set | `ImageGrouper.tsx:1706` (`rotateSelected ±90`), `:2789` (Paste-to-selected, assignment), `:3249/3255` (lightbox), `PDG:3177/3179` | assignment or ±90 accumulation; never doubled |
| `imageRotation` cleared | `ImageGrouper.tsx:643` + `:723` (crop/revert mappers), `PDG:2108/2119` | set to 0 because the pixels are now baked |
| baked into pixels | `imageTransforms.ts:493-533` (`createTransformedFile`) — rotate onto an intermediate canvas, then crop | the returned file IS rotated |
| rendered | `ImageGrouper.tsx:2968` + `:3202`, `PDG:2318` (Step 3 preview) | `style={{ transform: rotate(${item.imageRotation||0}deg) }}` |
| persisted | `slimItems.ts` (`imageRotation` in both whitelists); `imageRowSync.buildTransforms` → `product_images.transforms` | — |

**Ruled out, with the evidence:**

- **EXIF double-application.** `image-orientation: from-image` is the initial value for
  `<img>` in every current engine, so `naturalWidth/Height` and `drawImage` both see the
  ORIENTED bitmap — the modal `<img>` and the canvas `<img>` agree. Nothing in the app
  reads an `Orientation` tag (`grep -rn Orientation src` → only `DateTimeOriginal`). Already
  documented at `imageTransforms.ts:140-145`.
- **A `transforms` round-trip re-applying a rotation.** `product_images.transforms` is
  **write-only**: `grep -rn "transforms" src` shows three writers (`imageRowSync`,
  `productService`, the `registerItemsInDB` read-back which only carries the column across
  the wipe) and **no reader that maps it back onto `imageRotation`**. It cannot double-apply.
- **A memoized card holding another item's rotation.** Cards are not individually memoized
  (`React.memo` is on `ImageGrouper` as a whole, perf finding F2) and both grids key on
  `item.id` (`:2914`, `:3176`), so a sort reorders by key rather than by position.
- **`% 360` producing negatives** (`-90`, `-180`): CSS accepts them, `rotatedSize` takes
  `Math.abs` of cos/sin, `ctx.rotate` accepts negative radians. Cosmetic only.
- **`runCropBatchPaste` dropping a rotation**: it passes
  `rotation !== null ? rotation : undefined` (`:809`), so a null copied-rotation correctly
  falls through to the item's own. Correct as written.

## 2. CONFIRMED mechanism

**A rotation is baked into a stored file and then applied a second time by CSS.**
`90 + 90 = 180` — which is why the symptom is specifically "upside down" rather than
"sideways".

1. `saveProductToDatabase` (`productService.ts:259-275`): when
   `item.imageRotation || item.crop`, it calls `createTransformedFile(item)` — which
   **bakes the rotation into the pixels** — uploads the result to a **new** storage path,
   and writes a `product_images` row for it (`:303-311`).
2. It **never clears `item.imageRotation`.** Nothing downstream does either:
   `handleSaveBatch` (`App.tsx:1449+`) only reads the `{success, failed}` tally.
   `slimForWorkflowState` duly persists `imageRotation: 90` into `workflow_state`.
3. On the next page load, the startup restore's DB hydration merged with
   `STARTUP_MERGE_OPTIONS.imageStrategy = 'db-group-wins'` (`productRow.ts`), i.e.
   `imageUrls = row.product_images` — **the baked file** — while leaving `imageRotation`
   untouched at 90.
4. Step 2's card and Step 3's preview then CSS-rotate the already-rotated bitmap.

**Why "randomly":** after a Save Batch the item's `product_images` holds *two* rows — the
original (position 0, written by `registerItemsInDB`) and the baked one (position `i`, 0 for
a single) — and `imagesFromRow` sorts by `(position ?? 0)`. On a tie the order is whatever
PostgREST returned, which is unordered (the embedded resource has no `ORDER BY`). So which
file becomes `urls[0]` is arbitrary per item per load. Only items that were rotated **and**
went through Save Batch are candidates, which is why it is a handful and not the batch.

**Why only at the dictation step:** the same wrong URL lands on the Step-2 card too, but
Step 2 shows a 110×138 thumbnail in a grid and Step 3 shows one large preview — that is
where a flipped garment is unmissable.

**The same option was also serving the wrong photo.** `db-group-wins` hands an item the
row's whole `product_images` list, and `saveBatchToDatabase` writes a GROUP's photos as N
rows against the **leader** product. This is exactly the bug commit `3a70b52` removed from
the open-batch path ("every member of a group shows the same photo") — it was still live on
the startup path.

## 3. The fix

`STARTUP_MERGE_OPTIONS.imageStrategy: 'db-group-wins'` → **`'own-image-wins'`**
(`src/lib/productRow.ts`), matching the open-batch path.

A restored item now resolves its image from its **own** `storagePath` (the authoritative
reference per CLAUDE.md §11), which is the *un*-baked original — so the single CSS rotation
is correct. The row's list stays the fallback for an item that has no image reference at all,
which is the legacy-recovery case the two-stage DB fallback exists for. Nothing else needed
changing: `createTransformedFile` reads `item.preview` and is idempotent across repeat Save
Batches, and `handleOpenBatch` was already `'own-image-wins'` (so this report was
startup-restore-only — worth knowing when reproducing).

### Residual, and the instrumentation for it

An item with **no `storagePath` and no `imageUrls`** (pre-`storagePath` legacy) still has
only the DB list to fall back on, and could in principle be handed a baked row while
declaring a rotation. Two `log.img` tripwires were added behind the debug toggle
(`window.__SORTBOT_DEBUG__` / the 🐛 button), so the founder can capture it:

- `App.tsx` startup restore, after hydration — one line listing every item that still
  declares a rotation, with `urlFrom: 'storagePath (safe)' | 'DB row (suspect)'`:
  ```
  [rot] 3 restored item(s) still declare a rotation: [{id, rotation, urlFrom, preview}]
  ```
- `App.tsx` `mergeDB`, per item — fires only when an item **keeps a rotation** *and* its
  image **changed** during the merge, i.e. the exact double-rotation combination:
  ```
  [rot] item <id> kept rotation 90° but its image CHANGED in the DB merge (<old> → <new>)
        — storagePath=<path>. If this photo looks upside down, this is why.
  ```
Both are inside `isDebugEnabled()` guards or are string-only, so they cost nothing with
debug off.

### Ranked remaining hypotheses (not fixed here)

| # | Hypothesis | Signature that distinguishes it | Why not fixed |
|---|---|---|---|
| H2 | **PDG's same-path overwrite** (`ProductDescriptionGenerator.tsx:2067`): a Step-3 crop uploads over `item.storagePath` with `upsert:true`, so the URL never changes, and it never calls `evictCachedImage`. The SW (7-day stale-while-revalidate), the HTTP cache and the `imageTransforms` LRU can all still hold the pre-crop bytes while `imageRotation` is now 0. | Image looks **un**-rotated / **sideways**, and self-corrects on a later load — NOT 180°. | PDG is another agent's file. Already logged as M6 in `11-crop-paste.md`. |
| H3 | A **legacy item with no `storagePath`** takes the DB fallback and is handed a baked row. | The `[rot] … urlFrom: 'DB row (suspect)'` line above, on an item whose `storagePath` prints as `NONE`. | Needs a field capture to confirm it exists at all; the fix would be to stop `saveProductToDatabase` writing a baked row without clearing the item's rotation. |

## 4. The test

`src/lib/productRow.test.ts` — the characterization test for divergence 2 was inverted and a
direct reproduction added:

- `STARTUP: the item's OWN image now wins over the DB group list, like open-batch`
- `STARTUP: report 16 — a baked, already-rotated row cannot replace the item image` — builds
  the exact post-Save-Batch row (original + baked, **both at position 0**) and asserts the
  merged item still declares `imageRotation: 90` **and** still points at the original.
- `STARTUP: the DB group list is still the fallback for an item with no image at all`

Verified to reproduce: flipping `imageStrategy` back to `'db-group-wins'` fails 4 tests
(the two above plus the two preset-diff assertions); restoring it passes.

---

# Report 29 — "when you group photos and refresh, the images don't persist in the same group randomly"

## 1. The traced path

`productGroup` has **two** persistence mirrors, written by **two independent 2 s debounces**,
and the restore reads both:

```
ImageGrouper (commitUpdate) → onGrouped → App.handleImagesGrouped
   ├─ autoSaveWorkflow  ── throttled 1 s ──→ localStorage `sortbot_workflow_backup`  (ultraSlim, 7 fields)
   │                    ── debounced 2 s ──→ workflow_batches.workflow_state          (slim, 15 fields)
   └─ groupUpsertTimerRef  debounced 2 s ──→ products.product_group                   (the MIRROR)

reload → startup restore: pick DB blob vs backup → DB hydration (STARTUP_MERGE_OPTIONS)
open from Library → handleOpenBatch: workflow_state → gap-fill → merge (OPEN_BATCH_MERGE_OPTIONS)
                                                              → lib/grouping.buildGroupArray
```

Checked and found **correct**: `slimForWorkflowState` and `ultraSlimForBackup` both persist
`productGroup`; `buildGroupArray`'s tolerant resolution; `mergeProductImageRows`; the
pagination added by the perf pass; `handleBatchDeleted`'s `cancelWorkflowBackup()` ordering;
the unmount teardown effect (App is only unmounted by a real teardown, and it flushes the
backup first).

## 2. Four CONFIRMED mechanisms

### C1 — a stale `products.product_group` overwrote the restored grouping *(the main one)*

`OPEN_BATCH_MERGE_OPTIONS.setProductGroup: true` →
`merged.productGroup = row.product_group || item.productGroup || item.id`
(`productRow.ts`). So the **DB mirror beat `workflow_state`**, and the mirror is the
unreliable of the two:

- it is written by a **different** debounce, which the user can outrun;
- `registerItemsInDB`'s `products` upsert uses `{ onConflict: 'id', ignoreDuplicates: true }`
  (`App.tsx:756-773`), so for a row that already exists it writes **nothing** — despite its
  own comment claiming "the purpose of this upsert is to ensure product_group and title are
  in sync". It cannot repair the mirror. (Comment corrected; the upsert is untouched — §18 #3.)
- the row is matched **group → image-url → title** (`App.tsx` `handleOpenBatch`), and the
  last two can match a *different* product entirely, whose group then got stamped on.

Concrete failures, both reproduced in the test file:

- *regroup:* A,B grouped; user regroups B,C. `productsByGroup.get('B')` misses (the DB rows
  are still keyed 'A'), so B falls to the image-URL fallback → **its own** row → group 'A'.
  C likewise → 'C'. The group {B,C} splits into B→A and C→singleton.
- *ungroup:* `workflow_state` says `productGroup === own id`; the row still says 'A', so the
  merge silently **re-groups** the items the user just separated.

### C2 — the auto-save in-flight mutex DROPPED the newest state

`App.tsx` `autoSaveWorkflow`: when the debounce fired while a round trip was in flight, the
fire `return`ed — **and was never rescheduled**. The in-flight save carries a payload captured
*before* the grouping, so the newest grouping never reached Supabase at all.

### C3 — the backup-vs-DB arbitration compared the wrong timestamps

```js
const supabaseUpdatedAt = batch.last_opened_at ? … : batch.updated_at …
const backupIsNewer = backup.savedAt > supabaseUpdatedAt;
```
`last_opened_at` is stamped when a write **lands**, not when its payload was **built**
(`workflowBatchService` sets it inside the UPDATE), and `updateWorkflowBatch(id, {})` bumps it
while writing **no `workflow_state` at all** (`getWorkflowBatch`, `libraryService:300`). So
the DB's freshness was systematically over-stated and a genuinely newer backup was discarded.
Compose with C2 and you get the plain-refresh loss: payload built at T−0.5 s, lands at T+3 s,
backup written at T+1 s holding the grouping → judged older → thrown away.

Secondary loss on the same line: when the backup *did* win it **replaced** the DB list
wholesale, and the backup carries 7 fields to the blob's 15 — so winning the race erased
`customDescription` (which has **no products column** — the blob is its only home),
`originalName`, `brandCategory`, `originalStoragePath`, `originalUrl` and `descriptionEdited`
for the entire batch.

### C4 — a pending group-upsert timer could delete the *next* batch's products rows

The `groupUpsertTimerRef` callback ended with
`pruneStaleProducts(currentBatchIdRef.current, <this payload's ids>)`, reading the ref at
**fire** time. `handleOpenBatch` cleared `chunkTimerRef` but **not** this one. Group something
in batch A, open batch B within 2 s, and the timer fired against B with A's keep-list —
`pruneStaleProducts` **DELETEs** every `products` row of the given batch that is not in the
keep-list (`App.tsx:1424-1447`), so B lost all of its product rows (descriptions, prices,
tags, and its `product_group` mirror). Grouping itself survives via `workflow_state`, but this
is the most destructive thing found in the pass.

## 3. The fixes

| # | Fix | File |
|---|---|---|
| C1 | `setProductGroup` became `false \| 'row-wins' \| 'item-wins'` (`true` still means `'row-wins'`, so no other caller changes). `OPEN_BATCH_MERGE_OPTIONS` → **`'item-wins'`**: `item.productGroup \|\| item.id`, the row is never consulted. Safe for DB-built and gap-filled items too — `productRowToClothingItem` already derived their group from `product_group \|\| row.id`, so the row is simply not read twice. | `lib/productRow.ts` |
| C2 | The debounce body became a named `fire()`; a collision now **re-arms** at `AUTOSAVE_RETRY_MS = 1000` instead of dropping. The debounce itself is still `AUTOSAVE_DEBOUNCE_MS = 2000` (§11 floor respected). | `App.tsx` |
| C3 | New pure module `lib/restoreSource.ts`: `workflowStateCapturedAt()` prefers **`workflow_state.lastEditedAt`** (which App stamps as it *builds* the payload) over the two columns, and `resolveRestoreItems()` **merges** instead of replacing — the backup decides membership and its own 6 fields, the blob supplies everything else. Wired into both backup branches of the startup restore. | `lib/restoreSource.ts`, `App.tsx` |
| C4 | The batch id is **pinned** when the timer is armed; the callback bails if `currentBatchIdRef.current` has changed and prunes against the pinned id. `handleOpenBatch` and `handleClearBatch` also clear the timer. | `App.tsx` |

**Merge semantics, spelled out** (this is the load-bearing detail):
`productGroup` / `category` / `imageRotation` / `crop` are taken from the backup
**unconditionally, including when they are `undefined`** — an ungroup, a cleared category and
a revert are *data*, and letting the older blob fill them back in is precisely the
"I ungrouped them and the refresh put them back" report. `storagePath` and `capturedAt` use
`??` instead: a missing value there can only ever be a gap (losing a storage path loses the
picture; losing `capturedAt` loses an EXIF backfill no column holds).

## 4. The tests

`src/lib/restoreSource.test.ts` — **20 tests** built on the REAL `slimForWorkflowState`,
`ultraSlimForBackup`, `asClothingItems`, `buildGroupArray` and `mergeProductRowIntoItem`, not
on stand-ins. Four are explicit reproductions:

- `REPRODUCES report 29: a newer backup grouping survives a slower Supabase round trip`
- `REPRODUCES report 29: workflow_state landed but the products upsert did not`
- `REPRODUCES report 29: neither write landed — the backup carries the grouping through the merge`
- `REPRODUCES report 29: an ungroup is not undone by the lagging products mirror`

plus the merge rules (wide DB fields kept, newer delete/add/ungroup win, `storagePath` and
`capturedAt` never dropped), the timestamp precedence, backup validation, and a "both writes
landed" control.

`src/lib/productRow.test.ts` — divergence-6 characterization inverted, plus
`a stale row cannot re-group an item the user ungrouped`,
`a mismatched (title-matched) row cannot move an item into another product's group`, and
`'row-wins' is still available and is the default for setProductGroup: true`.

Verified to reproduce: reverting `setProductGroup` to `true` fails 6 of these; restoring it
passes.

---

# Report 30 — "when multi-selecting, don't allow double-click to zoom in on the photo"

## 1. The traced path

A hardware double-click emits `mousedown → mouseup → mousedown → mouseup → dblclick`, so the
selection handler runs **twice** and the lightbox opens on top. Three surfaces, two different
bad outcomes:

| Surface | Before | Outcome |
|---|---|---|
| singles card (`ImageGrouper.tsx:2952`) | `onMouseDown` → `toggleItemSelection` (200 ms repeat guard, commit `7c4806f`) + unconditional `onDoubleClick` → `openLightboxForItem` | second toggle eaten, so the item is **selected** *and* the lightbox opens |
| group photo (`:3185`) | `onClick` → `togglePhotoPick` with **no** guard + unconditional `onDoubleClick` | two toggles **cancel out** (nothing visibly happens) *and* the lightbox opens — the "half-toggled" half of the report |
| group select bar (`:3064`) | `onMouseDown` → `toggleGroupSelection`, no guard | the whole group toggles twice, i.e. visibly nothing |

## 2. The fix

New pure module **`src/lib/selectionGesture.ts`** holding the rules, because `ImageGrouper`
has no component harness:

- `TOGGLE_REPEAT_MS = 200` and `isRepeatToggle(lastAt, now)` — one gesture, one toggle,
  now shared by all three surfaces (`togglePhotoPick` and the select bar gained it).
- `isSelectionModeActive({ selectedAtGestureStart, pickMode, photoSelectMode })` /
  `shouldOpenLightbox(…)`.

In `ImageGrouper`:

- `selectionAtGestureStartRef` records the selection **before** the gesture's first toggle,
  refreshed only when the mousedown is outside the repeat window. **This is the subtle part:**
  judged against the *live* selection, every double-click would look like "the user is
  selecting" (the first mousedown already selected the item) and the lightbox would become
  unreachable.
- `openLightboxFromDoubleClick()` replaces the direct `openLightboxForItem` on both
  double-click handlers. It returns early when selection mode is active; when it does open,
  it **restores the pre-gesture selection** first — a double-click means "show me this photo",
  and leaving it silently selected is how a later Group/Delete picks up a photo the user never
  chose.
- The group-photo `<div>` gained an `onMouseDown={() => noteGestureStart(item.id)}` so its
  snapshot is taken at the same moment as the singles grid's.

Net behaviour: anything selected, or either pick mode on → a double-click is exactly one
selection toggle, never a zoom, never a half-toggle. Nothing selected and both modes off →
it zooms, as before. Keyboard shortcuts (`Cmd+Enter`, `Cmd+A`, `Cmd+Shift+A`, `Cmd+D`) are
untouched.

## 3. The test

`src/lib/selectionGesture.test.ts` — **15 tests**: the repeat window, each of the three ways
selection mode can be active, the gesture-start-vs-live subtlety, and a six-case replay of the
full handler wiring (`mousedown → mousedown → dblclick`) covering select-once-no-zoom,
deselect-once-no-zoom, photo-select mode, zoom-with-empty-selection leaving no residue, zoom
coming back after a clear, and two genuine single clicks still toggling twice.

---

# Report 28 (my half) — autosave audit + save-status wiring

## Guarantees the chain actually provides

1. **Debounce.** 2 000 ms trailing, reset by every call; seven call sites. §11 floor respected.
2. **No duplicate batches.** The in-flight mutex plus the stub `workflow_batches` INSERT at
   upload time (`4d9d594`) keep two fires from both seeing "0 rows updated → INSERT".
3. **No resurrection.** `isBatchDeleted` tombstones (localStorage, capped 200) are checked
   before any query; a *confirmed* batch whose row has vanished is tombstoned rather than
   re-created; only a never-confirmed id takes the stub-insert recovery path.
4. **No RLS fork.** A 0-row UPDATE is disambiguated with a SELECT: row present → do **not**
   create a duplicate.
5. **A refresh inside the debounce is covered** by the localStorage backup, throttled 1 s
   trailing and flushed on `pagehide` + `beforeunload` and on App teardown.
6. **One list only.** `processedItems → sortedImages → groupedImages → uploadedImages`,
   slimmed through the tested whitelist. Unchanged.

## Gaps found

| Gap | Status |
|---|---|
| **A collided fire was dropped, not rescheduled** — the newest state could never reach Supabase. | **Fixed** (C2 above). |
| **Every failure was silent.** `autoSaveWorkflowBatch` returns `string \| null`; `rls-blocked` returns the batch id, so a total write failure was indistinguishable from a success, and App only `console.error`'d the throw case. | **Fixed**: new `autoSaveWorkflowBatchDetailed` → `{batchId, outcome, message?}` with `outcome ∈ updated \| created \| rls-blocked \| deleted \| error`, plus `autoSaveSucceeded()`. The old function is a thin wrapper, so every existing caller and test is unchanged. |
| **Error message extraction.** The `throw updateError` re-raises supabase-js's `PostgrestError`, a plain object — `error instanceof Error` would have discarded its message. | **Fixed** (duck-typed on `.message`). |
| **`last_opened_at` used as a content timestamp.** | **Fixed** (C3 above). |
| **A pending group-upsert timer pruning the wrong batch.** | **Fixed** (C4 above). |
| **`products.product_group` has no repair path** — `registerItemsInDB` cannot update it (`ignoreDuplicates: true`), so it only converges when a group action's 2 s timer completes. | **Not fixed, by design.** Repairing it means a second write that could touch `batch_id` (§18 #3). The restore no longer *trusts* it, which removes the consequence. Comment corrected so the next reader isn't misled. |
| **PDG's own debounced products save + the `keepalive` unload flush** report nothing. | **Out of scope** — another agent's file. Two edits written out below. |
| **`fetchWorkflowBatches` is still capped at 1 000 batches.** | Pre-existing, deliberate (perf pass), untouched. |

## What now reports into `saveStatusStore`

`saveStatus.begin()` / `end(ok, message?)` — ref-counted, errors win until the next success:

| Writer | Where | Reports |
|---|---|---|
| workflow_state auto-save | `App.autoSaveWorkflow` | `begin()` at the start of the round trip; `end(true)` only on `updated`/`created`; `end(false, message)` on `rls-blocked` / `deleted` / `error` and on a thrown exception |
| `products.product_group` mirror | `App.handleImagesGrouped`'s debounced upsert | `begin()` before the chunk loop; `end(false, …)` on the first chunk error, `end(true)` after the prune + Library refresh |
| Save Batch | `App.handleSaveBatch` | `begin()`; `end(true)` on a clean save, **`end(false, "N product(s) failed to save.")` on a partial** — a partial save is not a clean save; `end(false, …)` on total failure and on a throw |
| lifecycle | `handleSignOut`, `handleBatchDeleted`, `handleClearBatch` | `saveStatus.reset()` — the indicator must not carry one account's (or a deleted batch's) state forward |

`saveStatusStore.ts` itself was **not modified**.

Tests: `src/lib/workflowBatchService.test.ts` gained **7** — one per outcome, including
`rls-blocked: 0 rows updated but the row still exists — NOT a success, and no duplicate batch`
(which also asserts zero `workflow_batches` inserts), `deleted: a tombstoned batch is refused
before any query runs` (asserts `mock.calls` is empty), and the back-compat wrapper.

## For the agent building the Step-3 indicator

`useSaveStatus()` is ready to render. The two edits `ProductDescriptionGenerator.tsx` still
needs, which I could not make:

```ts
// 1. around the 500 ms debounced direct save (and the 800 ms group save)
saveStatus.begin();
const ok = await updateProduct(/* … */);        // already returns boolean since finding 1
saveStatus.end(ok, ok ? undefined : 'Could not save this listing.');

// 2. flushProductPatchKeepalive on unload — fire-and-forget, so report optimistically
saveStatus.begin(); saveStatus.end(true);
```

---

# For the orchestrator to double-check

1. **`OPEN_BATCH_MERGE_OPTIONS.setProductGroup` and `STARTUP_MERGE_OPTIONS.imageStrategy` are
   deliberate behaviour changes** to two of the seven documented divergences in
   `productRow.ts`. The module doc now says which two are closed and why; the "differ in
   exactly the seven documented options" test is now **six**.
2. **`registerItemsInDB`'s comment was wrong, not its code.** It claims to keep
   `product_group` in sync; `ignoreDuplicates: true` means it never can. Left as-is
   deliberately (§18 #3) — the restore no longer depends on that column.
3. **CLAUDE.md updates the orchestrator owns:** §11 should record that the restore
   arbitration lives in `lib/restoreSource.ts` and keys on `workflow_state.lastEditedAt`, not
   `last_opened_at`; §5 needs `restoreSource.ts` and `selectionGesture.ts`; §3's coverage list
   needs their two test files; §14 can drop "auto-save failures are silent".
4. **Report 16's residual (H3) needs a field capture** — turn on the 🐛 debug toggle, reload a
   batch that has been Save-Batched, and look for `[rot] … urlFrom: 'DB row (suspect)'`.

---

## Summary

1. **16 — CONFIRMED and fixed.** `saveProductToDatabase` bakes `imageRotation` into a new
   JPEG but never clears the field; the startup restore's `db-group-wins` then handed the item
   that baked file while keeping the rotation, so CSS applied it twice — 90 + 90 = 180, i.e.
   upside down. "Randomly" because the original and baked `product_images` rows tie on
   `position`, so which one wins is arbitrary DB row order.
2. Fix: `STARTUP_MERGE_OPTIONS.imageStrategy → 'own-image-wins'`, matching the open-batch path
   (`3a70b52`). Two `[rot]` tripwires behind the debug logger cover the legacy residual.
   EXIF double-application, a `transforms` round-trip and stale memoized cards were all ruled
   out with evidence.
3. **29 — four CONFIRMED mechanisms, all fixed.** (C1) a stale `products.product_group`
   overwrote the restored grouping; (C2) the auto-save mutex dropped the newest state instead
   of re-arming; (C3) the backup-vs-DB arbitration compared against `last_opened_at`, which
   dates the round trip, not the payload; (C4) a pending group-upsert timer could DELETE the
   newly-opened batch's `products` rows.
4. Fixes: `setProductGroup: 'item-wins'`; re-arm at 1 000 ms; new `lib/restoreSource.ts` that
   keys on `workflow_state.lastEditedAt` and **merges** the two sources instead of replacing
   (so winning the race no longer erases `customDescription` & co.); the group-upsert timer's
   batch id is pinned and the timer is cleared on open/clear.
5. **30 — fixed.** New `lib/selectionGesture.ts`: while anything is selected or either pick
   mode is on, a double-click is exactly one selection toggle and never opens the lightbox;
   with an empty selection it zooms and restores the pre-gesture selection. The 200 ms repeat
   guard now covers group photos and the group select bar too.
6. **28 — audited.** Six guarantees documented, eight gaps listed. Auto-save failures are no
   longer silent: `autoSaveWorkflowBatchDetailed` reports which of five outcomes happened, and
   `rls-blocked` (row exists, nothing written, id handed back) is now surfaced as an error.
7. Auto-save, the `product_group` mirror upsert and Save Batch all report into
   `saveStatusStore`; sign-out / batch-delete / clear-batch reset it. A partial Save Batch is
   reported as an error, not a success.
8. **+45 tests** (965 total), per-file lint identical to HEAD on every file touched, four new
   files at 0. Both report-16 and report-29 fixes were verified by reverting the option and
   watching the reproductions fail.
