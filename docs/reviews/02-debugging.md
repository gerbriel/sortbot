# Acadia — latent defect review (analysis only)

Scope: upload → restore → group/categorize → Step 3 → export → delete, plus auth/org
bootstrap and the new founder tools. Every finding below was traced in source; nothing
was applied. `npm test` baseline at time of review: **229 passed / 19 files**.

Legend: **CONFIRMED** = fully traced in code with the exact lines and a mechanical
sequence. **PLAUSIBLE** = the code defect is real but the trigger needs a runtime repro
to prove impact.

---

## Top findings

| # | Sev | Status | file:line | Defect | Trigger | Proposed fix | Effort | Regr. risk |
|---|---|---|---|---|---|---|---|---|
| 1 | Critical | CONFIRMED | `src/lib/productService.ts:553` | `updateProduct` returns `true` when the UPDATE affects **0 rows** (no `.select()`); `syncGroupFieldsToDatabase` swallows the result | products row missing (per-chunk upsert errored) or RLS-blocked | `.select('id')`, treat 0 rows as failure; upsert instead of update | S | Low |
| 2 | Critical | CONFIRMED | `src/lib/productService.ts:585` | Step-3 group save writes **only `groupItems[0]`**, while restore reads the group's **earliest-`created_at`** row → edits written to a row the restore never reads | any group whose processedItems order ≠ products `created_at` order (sort, regroup, gap-fill) | write to the leader (`id === product_group`) or all group rows; read by leader id | M | Med |
| 3 | Critical | CONFIRMED | `src/components/ImageUpload.tsx:282` + `:363` + `:411` | Cancelling an upload deletes the Storage files but leaves the `products`/`product_images` rows **and** the items already pushed to state | user cancels a large upload | delete DB rows for `uploadedPaths` before the storage remove; tell parent to drop the items | M | Low |
| 4 | High | CONFIRMED | `src/lib/workflowBatchService.ts:254` | `.in('product_id', batchProductIds)` is **unchunked** → PostgREST 400 above ~700 ids → `imageRows` undefined → **every storage file in the batch leaks** | deleting a batch with >~700 images | chunk at 100 like every other call site | S | Low |
| 5 | High | CONFIRMED | `src/lib/workflowBatchService.ts:289`,`:319` vs `:322` | Storage files and `products` rows are deleted **before** the authoritative `workflow_batches` delete is confirmed; the products/images deletes are never checked for 0 rows | RLS-blocked delete, or the batch-row delete fails | delete the batch row first (or verify claim-ownership succeeded) and check affected rows at every step | M | Med |
| 6 | High | CONFIRMED | `src/App.tsx:1732` (+ `:1602`) | Debounced `products` upsert writes `batch_id` with `ignoreDuplicates: false` — the exact `batch_id`-theft pattern AGENTS.md §18 #3 forbids | items in the working set whose DB row belongs to another batch | drop `batch_id` from these two upserts | S | Low |
| 7 | High | CONFIRMED | `src/App.tsx:2096` | ±24 h orphan-product query has **no batch / user / org filter and no limit**, with the full nested select | opening any batch that has no `products` rows | scope by `user_id`/`org_id`, add `.limit()`, select only `id` + image urls | S | Low |
| 8 | High | CONFIRMED | `src/lib/tusUpload.ts:51` | `new Promise(async (resolve, reject) => …)` — a throw from `getSession()` becomes an **unhandled rejection and the promise never settles** → the upload loop hangs forever | `auth.getSession()` rejects (offline blip) | move the async body inside, wrap in try/catch, reject on throw | S | Low |
| 9 | High | CONFIRMED | `src/components/ProductDescriptionGenerator.tsx:284` | Unload flush uses a plain `fetch` (no `keepalive`/`sendBeacon`) despite the comment claiming otherwise → edits made in the last 500 ms are lost on tab close | close/refresh within the debounce window | `sendBeacon` to the REST endpoint, or `fetch(..., {keepalive:true})` | M | Low |
| 10 | Med-High | CONFIRMED | `src/components/ProductDescriptionGenerator.tsx:115` vs `:256` | Two independent debounce paths share `productSaveTimerRef`; the effect's cleanup always cancels `debouncedDirectSave` and `pendingSaveGroupRef` is never drained | every field edit | give each path its own ref; flush both on unload | S | Low |
| 11 | Med-High | CONFIRMED | `src/components/ImageUpload.tsx:236`–`244` | `onUploadStart()` and a wholesale `tus::` localStorage wipe run **before** the concurrency guard; the wipe also permanently defeats `storeFingerprintForResuming` | any second drop/StrictMode double-fire; every upload | move the guard to the top; scope the wipe to this session's paths | S | Med |
| 12 | Med | CONFIRMED | `src/components/ImageUpload.tsx:384` + `src/App.tsx:1469` | Per-chunk `product_images` insert omits `original_name`/`alt_text`/`transforms`; the later upsert uses `ignoreDuplicates:true` so it can never fill them → the `d0147f0` fix is dead | every upload | use `buildProductImageRow` in the per-chunk insert too | S | Low |
| 13 | Med | CONFIRMED | `src/lib/libraryService.ts:394` | `duplicateBatch` copies `workflow_state.uploadedImages`, which the current save format **always leaves empty** (`src/App.tsx:1872`) → every duplicate is empty but reports the original's `total_images` | Library → Duplicate | copy `processedItems` (and recompute stats) | S | Low |
| 14 | Med | CONFIRMED | `src/App.tsx:1035`, `:2515` | `autoSaveWorkflow(...)` is called **inside a `setProcessedItems` updater** — impure updater, double-invoked under StrictMode | EXIF auto-rescan finishing | compute the patch, call the setter, then auto-save outside | S | Low |
| 15 | Med | CONFIRMED | `src/lib/orgService.ts:64` | `ensureOrganization`'s in-flight promise is **not keyed by user** → an account switch during bootstrap hands user B user A's org/role/analytics context | sign out + sign in inside the bootstrap window | key the in-flight map by `user.id` | S | Low |
| 16 | Med | CONFIRMED | `src/App.tsx:537`,`:591` | `registerItemsInDB` deletes all `product_images` for the batch and re-inserts **one row per item**, collapsing the N rows Save Batch wrote for a group → photo order/positions destroyed on every open | reopen any batch after Save Batch | write one row per image, keyed by the owning item, preserving position | M | Med |
| 17 | Med | CONFIRMED | `src/App.tsx:1819` | Synchronous `JSON.stringify` + `localStorage.setItem` on **every** `autoSaveWorkflow` call, and that runs per `onGrouped` (≈ every 150 ms during upload) | 1 500-image upload | throttle the backup to ~1 s and/or move it into the debounce | S | Low |
| 18 | Low-Med | CONFIRMED | `src/App.tsx:917`, `PDG:116` | Unconditional `console.log` with object payloads per item × 4 arrays on restore, and per keystroke in Step 3 (§14 #15, now worse) | every restore / every edit | route through `log.*` | S | Low |
| 19 | Low | CONFIRMED | `src/App.tsx:1165` | Pageview effect depends on the `user` **object** → a duplicate pageview on every token refresh; also fires `app` before the waitlist status resolves | hourly token refresh; waitlisted sign-in | depend on `user?.id`, and gate on `betaWaitlist !== null` | S | Low |
| 20 | Low | CONFIRMED | `src/lib/productService.ts:169` | `price: product.price \|\| 0` stores unpriced items as **$0**, which the export price gate then hard-blocks | Save Batch before pricing | write `null`, keep the gate on null/0 | S | Low |
| 21 | Low | PLAUSIBLE | `src/components/ImageGrouper.tsx:1196` | Slow-path `finalItems` is rebuilt from a pre-`await` `initialItems` snapshot → items deleted or added during the upload loop are resurrected/dropped | only reachable when an item has `file` but no URL | rebuild from `groupedItemsRef.current` | S | Med |
| 22 | Low | CONFIRMED | `src/App.tsx:625` | Startup-restore effect has no cancellation flag; StrictMode dev double-mount runs the whole restore (incl. `registerItemsInDB`, EXIF rescan) twice concurrently | dev only | add a module-level in-flight guard like `isOpeningBatchRef` | S | Low |

Findings from the parallel export/deletion and founder-tools audits are folded in as
§F and §G below and are included in the ranking above where they overlap.

---

## 1. Step-3 field saves are silently dropped (findings 1 & 2)

### The path

1. Any edit in Step 3 mutates the store (`useStoreItemArray('processedItems')`,
   `ProductDescriptionGenerator.tsx:89`).
2. The `[processedItems]` effect (`PDG:256-281`) schedules a 500 ms timer that calls
   `syncGroupFieldsToDatabase(buildGroupArray(processedItems)[currentGroupIndex], batchId)`.
3. `syncGroupFieldsToDatabase` (`productService.ts:579-607`) takes
   `representative = groupItems[0]` and calls `updateProduct(representative.id, representative)`.
4. `updateProduct` (`productService.ts:553-564`) issues
   `supabase.from('products').update(patch).eq('id', productId)` and returns `true`
   unless `error` is set.

### Root cause A — 0 rows reported as success (`productService.ts:553`)

```ts
const { error } = await supabase
  .from('products')
  .update(patch)
  .eq('id', productId);

if (error) { … return false; }
console.log('[SAVE] updateProduct SUCCESS for id:', productId);
return true;
```

A PostgREST `UPDATE … WHERE id = $1` that matches nothing is **not an error**. So:

* If the item has no `products` row — which happens whenever the per-chunk upsert in
  `ImageUpload.tsx:376-378` errored (it only `console.error`s and the item still flows on
  through `onChunkReady`) — the write is a no-op reported as success.
* If RLS blocks the UPDATE (pre-`collaborative_edit_policies.sql`, editing someone
  else's listing), same outcome.

The loss is permanent, because `workflow_state` is slim: `slimForWorkflowState`
(`src/lib/slimItems.ts:38-57`) carries **no** `generatedDescription`, `voiceDescription`,
`seoTitle`, `price`, `tags` or `measurements`. If the `products` row was not written,
nothing anywhere holds the text. The next reload shows an empty listing.

### Root cause B — write key ≠ read key (`productService.ts:585`)

Write side: `groupItems[0]` — the first member of the group **in `processedItems` order**.

Read side, `handleOpenBatch` (`src/App.tsx:2320-2336`):

```ts
for (const p of productsToUse) {            // ordered created_at ASC (App.tsx:2083)
  const g = p.product_group || p.id;
  if (g && !productsByGroup.has(g)) productsByGroup.set(g, p);   // FIRST row wins
  …
}
…
let savedProduct: any = productsByGroup.get(item.productGroup || item.id);
```

The read picks the **earliest-created** row sharing the `product_group`. Those two
resolve to the same row only while `processedItems` order matches insertion order. They
diverge as soon as:

* the user sorts in Step 2 (`↓ Date` / `Name`) and a group action republishes the list,
* a group is re-formed (the leader convention takes `grouped[0].id` from selection order,
  `ImageGrouper` "Group Selected"),
* items are gap-filled from the DB and appended (`App.tsx:2290`).

When they diverge, the row that holds the user's work is never read, and the row that is
read has stub values from the upload-time upsert (`title: null`, everything else default).
The merge at `App.tsx:2384-2440` then resolves `savedProduct.x || item.x`, and `item.x` is
empty because of the slim contract — so the listing comes back blank.

### Hidden edge cases

* Groups of 1 are unaffected (single row), which is why this reads as "some listings lose
  their description" rather than a total failure.
* `saveBatchToDatabase` compounds it: it writes **one row per group**, keyed on
  `groupItems[0].id` (`productService.ts:351-359`), so the 3 other rows of a 4-photo group
  stay stubs forever.
* Offline: `updateProduct` throws, `syncGroupFieldsToDatabase` catches and comments
  "workflow_state blob is still the source of truth" — which is false under the slim
  contract.

### Fix

```ts
// src/lib/productService.ts
export const updateProduct = async (
  productId: string,
  updates: Partial<ClothingItem>,
  userId?: string,
): Promise<boolean> => {
  // …build `patch` exactly as today…
  if (Object.keys(patch).length === 0) return true;

  const { data, error } = await supabase
    .from('products')
    .update(patch)
    .eq('id', productId)
    .select('id');                       // <- prove the row was touched

  if (error) { console.error('[SAVE] updateProduct error:', error); return false; }
  if (data && data.length > 0) return true;

  // 0 rows: either the row does not exist, or RLS blocked us. Try to create it —
  // an upsert is safe because `id` is the item id and never collides across batches.
  if (!userId) { console.error('[SAVE] updateProduct: 0 rows and no userId to insert with'); return false; }
  const { data: inserted, error: upErr } = await supabase
    .from('products')
    .upsert({ id: productId, user_id: userId, ...patch }, { onConflict: 'id' })
    .select('id');
  if (upErr || !inserted?.length) {
    console.error('[SAVE] updateProduct: row missing and upsert failed', upErr);
    return false;
  }
  return true;
};

/** Write group fields to the row the restore path actually reads (the leader),
 *  and mirror them onto every other member so no ordering can lose them. */
export const syncGroupFieldsToDatabase = async (
  groupItems: ClothingItem[],
  _batchId: string | null,
  userId?: string,
): Promise<boolean> => {
  if (!groupItems.length) return true;
  const groupId = groupItems[0].productGroup || groupItems[0].id;
  // Leader-first: the row whose id === product_group is the one handleOpenBatch reads.
  const leader = groupItems.find(i => i.id === groupId) ?? groupItems[0];
  const fields = { ...leader, productGroup: groupId };
  const targets = [leader.id, ...groupItems.filter(i => i.id !== leader.id).map(i => i.id)];
  const results = await Promise.all(targets.map(id => updateProduct(id, fields, userId)));
  return results.every(Boolean);
};
```

and make the read side deterministic:

```ts
// src/App.tsx — handleOpenBatch, replacing the "first row wins" loop
for (const p of productsToUse) {
  const g = p.product_group || p.id;
  if (!g) continue;
  const incumbent = productsByGroup.get(g);
  // Prefer the leader row (id === product_group); otherwise keep the earliest.
  if (!incumbent || p.id === g) productsByGroup.set(g, p);
}
```

### Characterization tests

```ts
// src/lib/productService.test.ts
it('reports failure when the UPDATE matches no row', async () => {
  mockUpdateReturns({ data: [], error: null });      // 0 rows, no error
  mockUpsertReturns({ data: [], error: { message: 'rls' } });
  expect(await updateProduct('missing-id', { price: 42 }, 'u1')).toBe(false);
});

it('writes group fields to the leader row, not processedItems[0]', async () => {
  const leader  = { id: 'G', productGroup: 'G' } as ClothingItem;
  const member  = { id: 'B', productGroup: 'G', price: 40 } as ClothingItem;
  await syncGroupFieldsToDatabase([member, leader], null, 'u1');   // member first!
  expect(updatedIds()).toContain('G');
});

// src/lib/libraryData.test.ts style test for the read side
it('prefers the leader row when several products share a product_group', () => {
  const rows = [
    { id: 'older', product_group: 'G', price: null },   // created first
    { id: 'G',     product_group: 'G', price: 40 },     // the leader
  ];
  expect(pickGroupRow(rows, 'G').id).toBe('G');
});
```

---

## 2. Cancelling an upload leaves the DB pointing at deleted files (finding 3)

### The path

`processFiles` (`ImageUpload.tsx:276-402`) loops chunks of 10. Per chunk it:

* uploads each file (`:289-341`) and pushes successes into `uploadedPaths` (`:332`),
* writes `products` + `product_images` rows for that chunk (`:363-397`),
* calls `onChunkReady(results)` (`:401`), which appends the items to
  `uploadedImages`/`groupedImages`/`sortedImages`/`processedItems` (`App.tsx:469-486`).

On cancel (`:282-285`) it breaks the loop, then at `:411-424`:

```ts
} else {
  if (uploadedPaths.length > 0) {
    const { error } = await supabase.storage.from('product-images').remove(uploadedPaths);
```

### Why it fails

Nothing undoes steps 2 and 3. After a cancel you are left with:

* `products` rows for every cancelled item, `batch_id` = the live batch,
* `product_images` rows whose `storage_path` points at files that were **just deleted**,
* the same items still in all four store arrays with dead CDN URLs,
* a `workflow_batches` row (pre-inserted at `App.tsx:1395`) referencing them.

Downstream: Library renders broken thumbnails; `handleOpenBatch`'s gap-fill re-adds the
rows (`App.tsx:2210-2290`); if their count exceeds `max(workflowItems.length*2, 50)` the
"stolen batch id" branch **deletes them** (`App.tsx:2291-2308`) — destructive cleanup
triggered by a user simply pressing Cancel.

Edge cases: cancel during the very first chunk leaves a `workflow_batches` row with
`workflow_state` `{[],[],[],[]}` and `total_images` 0 — a ghost batch in the Library.
`remove(uploadedPaths)` is also unchunked (1 500 paths in one request body) and does not
go through `filterUnreferencedStoragePaths` (safe here only because the paths are fresh).

### Fix

```ts
// src/components/ImageUpload.tsx — replace the cancel-cleanup block
} else {
  const cancelledIds = items.map(i => i.id);
  // 1. DB rows first, while storage still exists (so a partial failure is recoverable).
  const CHUNK = 100;
  for (let i = 0; i < cancelledIds.length; i += CHUNK) {
    const ids = cancelledIds.slice(i, i + CHUNK);
    await supabase.from('product_images').delete().in('product_id', ids);
    await supabase.from('products').delete().in('id', ids);
  }
  // 2. Then the storage objects, chunked.
  for (let i = 0; i < uploadedPaths.length; i += CHUNK) {
    const { error } = await supabase.storage
      .from('product-images').remove(uploadedPaths.slice(i, i + CHUNK));
    if (error) console.error('Cancel cleanup: storage remove failed', error);
  }
  // 3. Drop them from the parent's state so no dead URLs survive the cancel.
  onUploadCancelled?.(cancelledIds);
  log.upload(`upload cancelled — removed ${cancelledIds.length} rows, ${uploadedPaths.length} files`);
}
```

with the matching App-side handler:

```ts
// src/App.tsx
const handleUploadCancelled = useCallback((ids: string[]) => {
  const drop = new Set(ids);
  const prune = (arr: ClothingItem[]) => arr.filter(i => !drop.has(i.id));
  setUploadedImages(prune); setGroupedImages(prune);
  setSortedImages(prune);   setProcessedItems(prune);
  pendingChunkRef.current = pendingChunkRef.current.filter(i => !drop.has(i.id));
}, [setUploadedImages, setGroupedImages, setSortedImages, setProcessedItems]);
```

### Test

```ts
it('cancel removes the DB rows for everything it uploaded', async () => {
  // 2 chunks succeed, cancel is requested before chunk 3
  await runUploadWithCancelAfterChunks(2);
  expect(deletedTables()).toEqual(['product_images', 'products']);
  expect(storageRemoveCalls().flat()).toEqual(uploadedPathsFromFirstTwoChunks());
  expect(onUploadCancelled).toHaveBeenCalledWith(idsFromFirstTwoChunks());
});
```

---

## 3. Batch deletion: storage leak and destructive-before-confirm ordering (4 & 5)

`deleteWorkflowBatch` (`src/lib/workflowBatchService.ts:249-340`):

```ts
252  const batchProductIds =
253    (await supabase.from('products').select('id').eq('batch_id', batchId)).data?.map(r => r.id) ?? [];
254  const { data: imageRows } = await supabase
255    .from('product_images')
256    .select('id, storage_path')
257    .in('product_id', batchProductIds);        // <- UNCHUNKED
```

Every other `.in()` in this codebase is chunked at 100 precisely because PostgREST
returns a 400 once the URL exceeds ~794 ids (`App.tsx:551-554`, `storageSafety.ts:30`).
Here it is not. For a 1 000+ image batch:

* `imageRows` comes back `undefined` (the error is not even destructured),
* `storagePaths` (`:278`) is `[]`,
* `allPaths` is only the `originalStoragePath` values scraped from
  `workflow_state.uploadedImages`/`groupedImages` (`:267-273`) — which the current save
  format **always leaves empty** (`App.tsx:1872-1874`), so it is `[]` too,
* the storage remove is skipped entirely, and the `product_images` delete at `:313-316`
  is also skipped (`imageIds` is `[]`).

The DB still ends up clean because the `products` delete at `:319` cascades, but **every
file stays in the bucket forever**. That is a direct explanation for a storage meter that
reads far above what the tables account for.

### Ordering (finding 5)

```
:289  storage.remove(safePaths)                  ← destructive
:302  products.update({user_id})                 ← claim, result unchecked
:319  products.delete().eq('batch_id', batchId)  ← destructive, result unchecked
:322  workflow_batches.delete()...select('id')   ← the ONLY checked step
:329  if (!deletedRows?.length) return false
```

If the batch-row delete is the one RLS blocks, the function returns `false` (Library shows
its red `.library-delete-error` banner) but the images and products are already gone — the
batch survives as an empty husk. Conversely if the `products` claim/delete is blocked and
the batch row is not, the batch row disappears while its `products` rows survive with a
dangling `batch_id`; `deriveLibraryData` synthesises a batch from `products` rows, so the
batch **reappears in the Library** — and the tombstone in `markBatchDeleted` cannot help,
because the resurrection comes from `products`, not `workflow_batches`.

### Fix

```ts
// src/lib/workflowBatchService.ts
const CHUNK = 100;

const batchProductIds =
  (await supabase.from('products').select('id').eq('batch_id', batchId)).data?.map((r: any) => r.id) ?? [];

// 1. Collect image rows in chunks; abort the storage phase if any chunk errors.
const imageRows: Array<{ id: string; storage_path: string | null }> = [];
let imageLookupComplete = true;
for (let i = 0; i < batchProductIds.length; i += CHUNK) {
  const { data, error } = await supabase
    .from('product_images')
    .select('id, storage_path')
    .in('product_id', batchProductIds.slice(i, i + CHUNK));
  if (error) { imageLookupComplete = false; break; }
  imageRows.push(...(data ?? []));
}

// 2. Claim ownership FIRST and verify it, so a blocked DELETE never half-deletes.
const { data: { user } } = await supabase.auth.getUser();
if (!user) return false;
const { data: claimed } = await supabase
  .from('workflow_batches').update({ user_id: user.id }).eq('id', batchId).select('id');
if (!claimed?.length) {
  console.warn('[deleteWorkflowBatch] cannot claim batch — refusing to delete anything');
  return false;
}
// …claim products + product_images in chunks, as today…

// 3. Delete the batch row and CONFIRM before touching storage.
const { data: deletedRows, error } = await supabase
  .from('workflow_batches').delete().eq('id', batchId).select('id');
if (error) throw error;
if (!deletedRows?.length) return false;

// 4. Now the destructive parts, in FK order, checked.
for (let i = 0; i < batchProductIds.length; i += CHUNK) {
  await supabase.from('product_images').delete().in('product_id', batchProductIds.slice(i, i + CHUNK));
}
const { error: prodErr } = await supabase.from('products').delete().eq('batch_id', batchId);
if (prodErr) console.warn('[deleteWorkflowBatch] products delete failed:', prodErr.message);

// 5. Storage last, and only when the reference lookup was complete.
if (imageLookupComplete) {
  const allPaths = [...new Set([...imageRows.map(r => r.storage_path).filter(Boolean) as string[], ...originalPaths])];
  const safePaths = await filterUnreferencedStoragePaths(allPaths, batchProductIds);
  for (let i = 0; i < safePaths.length; i += CHUNK) {
    await supabase.storage.from('product-images').remove(safePaths.slice(i, i + CHUNK));
  }
} else {
  console.warn('[deleteWorkflowBatch] image lookup incomplete — leaving storage untouched');
}
```

Note step 5 must still run `filterUnreferencedStoragePaths` *before* the `product_images`
rows go away, so in the reordered version pass the already-collected `imageRows` and run
the reference query while the rows exist (compute `safePaths` in step 1, remove in step 5).

### Tests

```ts
it('chunks the product_images lookup so >794 ids never 400', async () => {
  await deleteWorkflowBatch('b1');   // 1200 product ids mocked
  expect(inFilterSizes('product_images.select')).toEqual(Array(12).fill(100));
});

it('does not delete storage or products when the batch row delete affects 0 rows', async () => {
  mockBatchDeleteReturns([]);        // RLS blocked
  expect(await deleteWorkflowBatch('b1')).toBe(false);
  expect(storageRemoveCalls()).toHaveLength(0);
  expect(deletedTables()).not.toContain('products');
});
```

---

## 4. `batch_id` theft is still live in two upserts (finding 6) + the unscoped orphan window (7)

AGENTS.md §18 #3 says `registerItemsInDB`'s `products` upsert must never overwrite
`batch_id`, and it does not (`App.tsx:529` uses `ignoreDuplicates: true`). But two other
upserts do exactly what the rule forbids:

```ts
// src/App.tsx:1732 — handleImagesGrouped, debounced, runs on EVERY group action
chunk.map(item => ({ id: item.id, user_id: user.id,
                     batch_id: currentBatchIdRef.current, … })),
{ onConflict: 'id', ignoreDuplicates: false }

// src/App.tsx:1602 — handleImagesSorted, runs on every categorize
registerable.map(item => ({ id: item.id, …, batch_id: currentBatchId, user_id: user.id })),
{ onConflict: 'id', ignoreDuplicates: false }
```

Both also silently rewrite `user_id`, which changes who the owner-scoped DELETE policy
lets delete the row.

How a foreign item reaches the working set — `handleOpenBatch`, `App.tsx:2089-2112`:

```ts
if (!savedProducts || savedProducts.length === 0) {
  const startTime = new Date(batchCreatedAt.getTime() - timeWindow);   // ±24 h
  const { data: recentProducts } = await supabase
    .from('products')
    .select(slimProductSelect)            // full nested select, no limit
    .gte('created_at', startTime.toISOString())
    .lte('created_at', endTime.toISOString())
    .order('created_at', { ascending: true });
```

No `batch_id`, `user_id` or `org_id` filter and no `.limit()`. In legacy shared-workspace
RLS this returns **every product any user created in a 48-hour window**, capped only by
PostgREST's 1 000-row ceiling, each with its nested `product_images`. Matching is then by
image URL against `workflowItems[].preview` — tight, but the matched rows can legitimately
belong to a *different* batch (a batch whose `products.batch_id` was cleared, or an
old-format duplicate that shares image URLs). Those rows become `productsToUse` →
`baseItems` → in-memory items → the next group/categorize action re-tags their `batch_id`
to the current batch, and the original batch loses its products. Reopening the original
then finds no products and re-steals them: a ping-pong.

**Status:** the unscoped/unbounded query and the two `batch_id`-writing upserts are
CONFIRMED code defects. The full theft ping-pong is **PLAUSIBLE** — it needs a batch whose
products carry a foreign/NULL `batch_id`, which I could not prove exists in production
data from source alone.

### Fix

```ts
// src/App.tsx — handleImagesGrouped (…:1732) and handleImagesSorted (…:1602)
// batch_id is set authoritatively at upload time. Never re-assert it here.
chunk.map(item => ({
  id:            item.id,
  product_group: item.productGroup || item.id,
  title:         item.seoTitle || null,
  status:        'Active',
}))
// keep ignoreDuplicates: false so product_group/category DO update,
// but drop batch_id and user_id from the payload entirely.
```

```ts
// src/App.tsx — the ±24h fallback, scoped and bounded
const { data: recentProducts } = await supabase
  .from('products')
  .select('id, product_group, batch_id, product_images(image_url, storage_path, position)')
  .is('batch_id', null)                       // only genuinely unassigned rows
  .eq('user_id', activeUserId)                // never another account's products
  .gte('created_at', startTime.toISOString())
  .lte('created_at', endTime.toISOString())
  .limit(Math.max(workflowItems.length * 2, 100));
```

### Test

```ts
it('never writes batch_id from a group/categorize upsert', async () => {
  await handleImagesGrouped(items);  await flushTimers(2000);
  for (const row of upsertedRows('products')) {
    expect(row).not.toHaveProperty('batch_id');
  }
});
```

---

## 5. Upload hangs forever on a session hiccup (finding 8)

```ts
// src/lib/tusUpload.ts:51
return new Promise(async (resolve, reject) => {
  const { data: sessionData } = await supabase.auth.getSession();
  …
});
```

An `async` function used as a Promise executor swallows its own throws: the rejection
lands on the *executor's* returned promise, which nobody holds. The outer promise is
therefore **never settled**. `uploadToSupabase` (`ImageUpload.tsx:458`) awaits it, so the
whole `Promise.all` for that chunk — and the entire upload loop — stalls with no error,
no retry, and no progress. The 5-attempt backoff at `ImageUpload.tsx:311-319` never runs
because the first attempt never returns.

Trigger: `supabase.auth.getSession()` rejecting — a refresh-token round trip on a dropped
connection, which is exactly the "slow/rural, 1 500 images" scenario TUS was added for.

### Fix

```ts
export function tusUploadFile(
  file: File, storagePath: string,
  onProgress?: (uploaded: number, total: number) => void,
): Promise<TusUploadResult> {
  return new Promise((resolve, reject) => {
    (async () => {
      let token: string | undefined;
      try {
        const { data } = await supabase.auth.getSession();
        token = data?.session?.access_token;
      } catch (err) {
        reject(new Error(`tusUpload: session lookup failed: ${String(err)}`));
        return;
      }
      if (!token) { reject(new Error('tusUpload: no auth session')); return; }
      // …build and start the tus.Upload exactly as today…
    })().catch(reject);          // any unexpected throw settles the outer promise
  });
}
```

Add a watchdog in the caller so a stalled TUS session can never block a batch:

```ts
// src/components/ImageUpload.tsx — inside uploadToSupabase
const TUS_TIMEOUT_MS = 5 * 60_000;
const result = await Promise.race([
  tusUploadFile(file, filePath),
  new Promise<never>((_, rej) =>
    setTimeout(() => rej(new Error('tus timeout')), TUS_TIMEOUT_MS)),
]);
```

### Test

```ts
it('rejects (never hangs) when getSession throws', async () => {
  getSessionMock.mockRejectedValue(new Error('network'));
  await expect(tusUploadFile(file, 'u/p/x.jpg')).rejects.toThrow(/session lookup failed/);
});
```

---

## 6. Step-3 persistence: unload flush and the shared debounce ref (9 & 10)

```ts
// src/components/ProductDescriptionGenerator.tsx:284-305
const flushOnUnload = () => {
  if (productSaveTimerRef.current) { clearTimeout(productSaveTimerRef.current); … }
  const group = buildGroupArray(processedItems)[currentGroupIndex];
  if (group && group.length > 0) {
    // Use sendBeacon-friendly sync approach: fire-and-forget
    syncGroupFieldsToDatabase(group, batchId ?? null).catch(() => {});
  }
};
window.addEventListener('beforeunload', flushOnUnload);
window.addEventListener('pagehide', flushOnUnload);
```

The comment names `sendBeacon`; the code uses `supabase-js`, i.e. a plain `fetch` with no
`keepalive`. Browsers cancel in-flight `fetch` when the document is discarded, so the
flush is best-effort at best and reliably lost on `pagehide`/bfcache. Any edit made in the
last 500 ms before the tab closes is gone — and per finding 1 there is no slim fallback.

Second defect, same feature: `debouncedDirectSave` (`:115-137`, 800 ms) and the
`[processedItems]` effect (`:256-281`, 500 ms) **share `productSaveTimerRef`**. Because an
edit both calls `debouncedDirectSave` and changes `processedItems`, the effect's cleanup
(`:277-279`) runs immediately after and clears the direct save's timer. `debouncedDirectSave`
therefore never fires in practice, and `pendingSaveGroupRef.current` (`:125`) is left
holding a stale group forever — it is only nulled inside the timer that never runs (`:132`).
The unload flush does not drain it either.

### Fix

```ts
// Separate timers so the two paths cannot cancel each other.
const directSaveTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
const groupSaveTimerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);

/** Fire a save that survives page teardown. */
const flushGroupNow = (group: ClothingItem[]) => {
  if (!group?.length) return;
  const rep = group.find(i => i.id === (group[0].productGroup || group[0].id)) ?? group[0];
  const body = JSON.stringify(buildProductPatch(rep));   // same mapping as updateProduct
  const url  = `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/products?id=eq.${rep.id}`;
  const headers = {
    'Content-Type': 'application/json',
    apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
    Authorization: `Bearer ${accessTokenRef.current ?? ''}`,
    Prefer: 'return=minimal',
  };
  // keepalive survives document teardown (sendBeacon cannot send PATCH).
  fetch(url, { method: 'PATCH', headers, body, keepalive: true }).catch(() => {});
};

useEffect(() => {
  const flushOnUnload = () => {
    for (const r of [directSaveTimerRef, groupSaveTimerRef]) {
      if (r.current) { clearTimeout(r.current); r.current = null; }
    }
    const pending = pendingSaveGroupRef.current;
    if (pending?.length) { flushGroupNow(pending); pendingSaveGroupRef.current = null; }
    flushGroupNow(buildGroupArray(processedItemsRef.current)[currentGroupIndex]);
  };
  window.addEventListener('beforeunload', flushOnUnload);
  window.addEventListener('pagehide', flushOnUnload);
  return () => {
    window.removeEventListener('beforeunload', flushOnUnload);
    window.removeEventListener('pagehide', flushOnUnload);
  };
}, [currentGroupIndex]);
```

(`accessTokenRef` kept current from `supabase.auth.onAuthStateChange`, so the unload path
needs no `await`.)

### Test

```ts
it('flushes with keepalive on pagehide, and drains pendingSaveGroupRef', () => {
  editField('price', 42);                       // schedules both timers
  window.dispatchEvent(new Event('pagehide'));
  const [, init] = fetchMock.mock.calls.at(-1)!;
  expect(init.keepalive).toBe(true);
  expect(init.method).toBe('PATCH');
});

it('the processedItems effect does not cancel the direct save timer', () => {
  editField('brand', 'Nike');
  vi.advanceTimersByTime(900);
  expect(syncSpy).toHaveBeenCalledTimes(2);      // both paths ran
});
```

---

## 7. Upload-side ordering and dual-write gaps (11, 12, 16, 17)

### 11 — side effects before the concurrency guard (`ImageUpload.tsx:236-250`)

```ts
onUploadStart?.();                                 // :236  side effect #1
Object.keys(localStorage)
  .filter(k => k.startsWith('tus::'))
  .forEach(k => localStorage.removeItem(k));       // :242  side effect #2
if (isProcessingRef.current) { … return; }         // :246  the guard, too late
```

Two consequences. (a) A second drop, a folder-input change fired alongside a drop, or a
StrictMode double-invocation of the dropzone callback wipes the fingerprints of the upload
already running. (b) More fundamentally, this wipe runs at the start of **every** upload,
which means `storeFingerprintForResuming: true` (`tusUpload.ts:85`) and
`findPreviousUploads()` (`:119-126`) can never find anything — the advertised
"interrupted uploads resume automatically on next visit" is dead code. Two features in the
same subsystem contradict each other.

```ts
// Fix: guard first; scope the wipe to paths this session will not use.
const processFiles = useCallback(async (acceptedFiles: File[]) => {
  if (acceptedFiles.length === 0) return;
  if (isProcessingRef.current) { log.upload('processFiles | SKIPPED — already in progress'); return; }
  isProcessingRef.current = true;
  onUploadStart?.();
  // Only drop fingerprints older than the resume window; never touch live ones.
  const RESUME_TTL_MS = 24 * 60 * 60 * 1000;
  for (const k of Object.keys(localStorage)) {
    if (!k.startsWith('tus::')) continue;
    try {
      const meta = JSON.parse(localStorage.getItem(k) || '{}');
      if (!meta.creationTime || Date.now() - new Date(meta.creationTime).getTime() > RESUME_TTL_MS) {
        localStorage.removeItem(k);
      }
    } catch { localStorage.removeItem(k); }
  }
  try { /* …rest unchanged… */ } finally { isProcessingRef.current = false; … }
```

### 12 — the per-chunk `product_images` insert drops every optional column

```ts
// src/components/ImageUpload.tsx:384-390
const imgRows = chunkWithStorage.map(r => ({
  product_id: r.id, user_id: userId,
  image_url: r.imageUrls![0], storage_path: r.storagePath!,
}));
await supabase.from('product_images').insert(imgRows);
```

No `original_name`, `alt_text`, `position`, `transforms`, `captured_at`. The later upsert
in `handleImagesUploaded` (`App.tsx:1469-1477`) *does* build a full row via
`buildProductImageRow`, but it passes `ignoreDuplicates: true` on
`(product_id, image_url)` — the rows already exist, so it is a no-op. Net effect: the
`d0147f0` fix ("original_name written at upload time") is silently reverted; filenames
only appear after a batch is closed and reopened, when `registerItemsInDB` re-inserts.

```ts
// Fix: use the shared builder here too.
const stage4 = await stage4ColumnsAvailable();
const imgRows = chunkWithStorage.map((r, idx) =>
  buildProductImageRow(r as unknown as ClothingItem, userId, idx, r.imageUrls![0], stage4));
const { error: imgErr } = await supabase
  .from('product_images')
  .upsert(imgRows, { onConflict: 'product_id,image_url', ignoreDuplicates: false });
```

### 16 — `registerItemsInDB` collapses a group's image rows

`App.tsx:537-544` builds **one** row per item (`registerable.flatMap` → a single
`buildProductImageRow(item, …, idx, imageUrl, …)` using `imageUrls[0]`), and `:591-600`
deletes *all* `product_images` rows for those product ids first. `saveProductToDatabase`
had written N rows against the group leader with `position: i`
(`productService.ts:293-312`). Opening the batch therefore destroys the per-group photo
list and all `position` values — which is the concrete root cause behind §16's
"Photo reorder persistence — Missing". Fix: emit one row per element of
`item.imageUrls` with its real index, and key each row to the item that owns the photo.

### 17 — synchronous backup on every call

`autoSaveWorkflow` writes the localStorage backup *outside* the debounce
(`App.tsx:1819-1835`) — deliberately, so a fast refresh keeps pending work. But
`autoSaveWorkflow` is invoked from `handleImagesGrouped`, which fires on every
`onGrouped` — i.e. roughly every 150 ms while a large upload streams chunks
(`App.tsx:469-486` → ImageGrouper fast path `:1119` → `handleImagesGrouped`). On a
1 500-item batch that is ~150 synchronous `JSON.stringify` passes over a growing array
plus 150 `localStorage.setItem` calls on the main thread. Throttle it:

```ts
const lastBackupAtRef = useRef(0);
const BACKUP_MIN_INTERVAL_MS = 1000;
// …inside autoSaveWorkflow, replacing the unconditional write:
if (liveNow.length > 0 && currentBatchIdRef.current &&
    Date.now() - lastBackupAtRef.current >= BACKUP_MIN_INTERVAL_MS) {
  lastBackupAtRef.current = Date.now();
  localStorage.setItem('sortbot_workflow_backup', JSON.stringify({ … }));
}
```

---

## 8. Smaller confirmed defects (13, 14, 15, 18, 19, 20, 22)

**13 — `duplicateBatch` always produces an empty batch.** `libraryService.ts:393-398`
copies `batch.workflow_state?.uploadedImages`, but `autoSaveWorkflow` always writes
`uploadedImages: []` and stores everything in `processedItems` (`App.tsx:1871-1875`).
The duplicate also inherits `total_images: batch.total_images` (`:388`), so the Library
card promises N images for an empty batch, and opening it falls into the ±24 h orphan
query with an empty URL set (finding 7) and returns nothing.
Fix: `workflow_state: { uploadedImages: [], groupedImages: [], sortedImages: [],
processedItems: batch.workflow_state?.processedItems ?? [] }` and recompute the counters
from that list.

**14 — side effect inside a state updater.** `App.tsx:1035-1044` and `:2515-2525`:

```ts
setProcessedItems(prev => {
  const patched = patch(prev);
  autoSaveWorkflow({ …, processedItems: patched });   // impure
  return patched;
});
```

Updaters must be pure; React StrictMode double-invokes them, so the localStorage backup is
written twice and the 2 s debounce is reset twice per EXIF rescan completion. Fix: build
`patched` from `processedItemsRef.current`, call the setter with the value, then call
`autoSaveWorkflow` after.

**15 — `ensureOrganization` dedupe is not keyed by user** (`orgService.ts:64-71`). The
module-level `inFlight` promise is returned to *any* caller regardless of the `user`
argument, so a sign-out/sign-in inside the bootstrap window resolves user B's effect with
user A's `{org, role}` — which then drives `setCurrentOrg`, `setOrgRole`, the Vocabulary/
Board buttons and `setAnalyticsContext({ orgId })`. RLS still protects the data, so this is
a mislabeling/authorization-UI defect rather than a data breach.

```ts
const inFlight = new Map<string, Promise<OrgBootstrapResult>>();
export function ensureOrganization(user: User): Promise<OrgBootstrapResult> {
  const existing = inFlight.get(user.id);
  if (existing) return existing;
  const p = ensureOrganizationInner(user).finally(() => inFlight.delete(user.id));
  inFlight.set(user.id, p);
  return p;
}
```

**18 — production log storm.** `App.tsx:917-931` logs an object per item inside `mergeDB`,
which runs for all four arrays (`:991-994`) — 4 × N unconditional `console.log`s with
retained object references on every restore (6 000 for a 1 500-image batch).
`PDG:116-124` logs on every keystroke; `productService.ts:588-597`, `:551`, `:563` log every
save; `ImageUpload.tsx:298-302`, `:330`, `:365` log per file; `tusUpload.ts:61`, `:91`,
`:112` log per chunk. §14 #15 is not only still real, it has grown.

**19 — duplicate pageviews.** `App.tsx:1165-1168` depends on `user` (an object).
`onAuthStateChange` calls `setUser(session.user)` with a fresh object on `TOKEN_REFRESHED`,
so the effect re-fires and emits another `app` pageview roughly hourly per open tab. It
also fires before `betaWaitlist` resolves, so every waitlisted sign-in records `app` then
`waitlist`. Fix: `[loading, user?.id, showLogin, betaWaitlist]` plus an early return while
`user && betaWaitlist === null`.

**20 — `price: product.price || 0`** (`productService.ts:169`). Save Batch turns "no price
yet" into a real `0`, which the exporter's price gate then treats as a hard block, and the
restore merge reads `savedProduct.price ?? item.price` — so the 0 sticks. Write `null`.

**22 — no guard on the startup-restore effect** (`App.tsx:625-1097`). Unlike
`handleOpenBatch`'s `isOpeningBatchRef`, this effect has no in-flight guard and no
cancellation: the `getSession().then(…)` chain is not aborted by the cleanup
(`:1096`), so a StrictMode dev double-mount runs the entire restore — including
`registerItemsInDB`'s delete-then-upsert and the EXIF rescan — twice concurrently.
Production builds do not double-invoke, so this is dev-only noise, but it makes every
restore bug twice as hard to read and races `registerItemsInDB` against itself.

---

## 9. AGENTS.md §14 known-bugs check

| § | Claim | Verdict |
|---|---|---|
| 1 | Startup restore always calls `registerItemsInDB` | **Fixed.** `App.tsx:890-893` only calls it when the batch has no DB products. But `:537-609` now destroys group image rows instead (finding 16). |
| 2 | `getCategories()` has no `user_id` filter | **Still true by design**; post-tenancy it is org-scoped by RLS. |
| 3 | `SavedProducts.tsx` dead | Still true, still unrendered. |
| 4 | `services/api.ts` dead second AI path | Still true, no call sites in the active flow. |
| 5 | `workflow_state` type mismatch (`ClothingItem[] \| SlimItem[]`) | **Still true and now load-bearing** — it is what lets finding 1/2 lose text silently. `workflowBatchService.ts:34`. |
| 6 | `batch_name` null handling | Still true; `App.tsx:1922` interpolates `"${batch.batch_name}"` into a log, and `:2538-2539` has the `\|\| defaultName` fallback. |
| 7 | `autoSaveWorkflow` stale closure | **Mitigated, not gone.** The `live` pick (`:1865-1869`) uses the passed object, which can be stale; the ref-based callers (`:1797-1802`) are fine. |
| 9 | `proxy.log` gitignored | Still true, harmless. |
| 10 | `saveProductToDatabase` upserts on id | Confirmed fixed (`productService.ts:140-145`), but it writes one row **per group**, which is half of finding 2. |
| 11 | `initializeItems` stale closure | Fixed (`ImageGrouper.tsx:1016` reads `groupedItemsRef`). |
| 12 | Rubber-band `[isSelecting]` dep + eslint-disable | Still intentional, still correct. |
| 13 | `handleApplyPreset` routes through `handleImagesSorted` | Still true. That path is also one of the two `batch_id`-writing upserts (finding 6). |
| 14 | Ref mirrors retired → `liveArrayRef` | Confirmed (`App.tsx:30-33`, `workflowStore.ts:121-127`). Staleness is now impossible for those four reads. |
| 15 | Raw `console.log` crept back | **Worse than documented** — see finding 18. |
| 16 | 9 px base font | Still true (`index.css`). |
| 17 | `capturedAt` has no DB column | **Partly addressed**: `stage4_slim_fields.sql` adds `product_images.captured_at` and `buildProductImageRow` writes it when the probe passes (`imageRowSync.ts:89-92`) — but **nothing reads it back**. Gap-filled items (`App.tsx:2241`) still get `capturedAt: undefined`, so the symptom is unchanged until the restore path selects the column. |

Also worth noting about the Stage 4 probe: `stage4ColumnsAvailable()`
(`imageRowSync.ts:24-39`) caches the *first* result for the session and treats **any**
error — including a transient `Failed to fetch` — as "migration not run". One offline blip
at the wrong moment disables `captured_at`/`original_storage_path` dual-writes for the rest
of the session. Low impact today (nothing reads them), but it will matter the moment the
restore flip lands; cache only successes and negative results with a TTL.

---

## 10. What still needs a runtime repro

* The `batch_id` ping-pong (finding 6/7) — I proved both halves in code but not that
  production has `products` rows with a foreign or NULL `batch_id` that the ±24 h window
  would match. Query `select batch_id, count(*) from products group by 1` and
  `select count(*) from products p where not exists (select 1 from workflow_batches b where b.id = p.batch_id)`.
* Finding 2's ordering divergence — measure how often
  `processedItems[groupIdx][0].id != (earliest created_at row for that product_group).id`.
  A one-off script over a real batch settles it.
* Finding 4's 400 — confirm the PostgREST URL ceiling on the actual project by deleting a
  >800-image batch with the network tab open (expect `GET /product_images?product_id=in.(…)`
  to 400 and the bucket to keep its files).
* Finding 21 (`ImageGrouper` slow path) — only reachable if an item ever arrives with a
  `file` and no URL; instrument `toUpload.length > 0` to see whether that branch runs at all.

