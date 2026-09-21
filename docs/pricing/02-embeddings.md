# Step 3 — image embeddings, pgvector, and "you have listed this before"

Sept 20 2026. Step 3 of [`00-plan.md`](./00-plan.md): the free one. No API key, no
third party at run time, nothing new in `package.json`.

## What shipped

| | |
|---|---|
| `services/matting/app/embed.py` | CLIP preprocessing, the ONNX session, the model file |
| `services/matting/app/embed_store.py` | the `listing_embeddings` reader, the skip rule, the writer |
| `services/matting/app/embed_pipeline.py` | one photo, start to finish |
| `POST /v1/embed` (`app/main.py`) | 202 `{ jobId, accepted, skipped }`, same auth as `/v1/jobs` |
| `supabase/migrations/listing_embeddings.sql` | the table, the vector index, `match_listing_images` |
| `src/lib/embeddingsService.ts` | `embeddingsAvailable` / `findSimilar` / `ensureEmbeddings` / `similarityLabel` |
| `src/components/SimilarListings.tsx` + `.css` | the strip. **Not mounted anywhere** — the founder places it |

**Counts.** Service: 247 → **346** pytest (99 new), `ruff check` clean. App: **82**
new vitest (44 + 38), `npx eslint .` at **252**, the recorded baseline. The
migration was verified across **20 scenarios** on a throwaway Postgres 14 with real
pgvector 0.8.6.

## The model, and the one decision that took measuring

OpenAI **CLIP ViT-B/32**, vision tower only, as the ONNX export
`Xenova/clip-vit-base-patch32` → `onnx/vision_model.onnx`. Licences: CLIP weights
**MIT** (OpenAI, <https://github.com/openai/CLIP>), the export **MIT** (Xenova,
<https://huggingface.co/Xenova/clip-vit-base-patch32>), `onnxruntime` **MIT**. Both
halves matter — several obvious alternatives (SigLIP's best checkpoints, some
OpenCLIP variants) carry dataset terms or non-commercial clauses, and an embedding
of a reseller's inventory is commercial use.

`onnxruntime` is a **runtime** dependency, not an extra: ~20 MB of wheel, no CUDA,
no torch. The 350 MB of weights are fetched at run time, so the image does not grow.

### fp32 vs the quantized export — measured, then rejected

The brief said to prefer `vision_model_quantized.onnx` (85 MiB) if its cosine
agreement with fp32 on three test images exceeded 0.99. It does not. Both files
were downloaded and run through the real `preprocess` on three real garment photos
(the Unsplash images the landing page already uses):

| | fp32 | int8 |
|---|---|---|
| cosine(fp32, this) per image | — | **0.9216 / 0.9682 / 0.8986** |
| pairwise similarity: (1,2) (1,3) (2,3) | 0.8422 / 0.7697 / 0.8188 | **0.7851 / 0.7397 / 0.8015** |
| latency, 1 intra-op thread, arm64 | **15 ms** | 25 ms |
| resident after warm-up | 407 MB | 239 MB |
| download | 335 MiB | 85 MiB |

The per-image row alone settles it — 0.90–0.97 is nowhere near 0.99. But the
**pairwise** row is the reason it is not even close to a judgement call. This
feature never consumes an embedding; it consumes the **cosine between two of
them**, and it thresholds that number at 0.92 to say "near duplicate". Quantization
here did not add symmetric noise to a ranking — it moved every pair down by
0.03–0.06, which slides a user-visible threshold out from under the data. Re-tuning
that rule to save 170 MB of RAM would be trading a correctness property for a
resource one, and the int8 file was also **slower** on this hardware (a known ORT
artifact on ARM without a good int8 GEMM path), so it bought nothing at all.

So: **fp32**, with the numbers written into `app/embed.py`'s header so nobody
re-litigates it from intuition.

### The preprocessing is a contract, not a choice

Shortest side to 224 (PIL **bicubic**, which is `PILImageResampling.BICUBIC`,
which is what `CLIPImageProcessor` uses), centre crop 224×224, RGB, `/255`, then
mean `[0.48145466, 0.4578275, 0.40821073]` and std
`[0.26862954, 0.26130258, 0.27577711]`, NCHW float32. Output `image_embeds` (512),
L2-normalised.

`resize_shortest` copies transformers' **`int()` truncation** on the long edge
rather than rounding. It is one pixel and it shifts the centre crop by one; matching
it is free and makes "exactly as CLIP expects" literally rather than approximately
true.

Nothing here can fail loudly. A wrong kernel, a forgotten `/255`, mean and std
swapped, BGR instead of RGB — every one of those yields a 512-float unit vector
that Postgres accepts, that sorts, and whose neighbour list is *almost* right. That
is why the preprocessing is the most-tested part of the feature, including an
assertion against PIL directly (the claim is "the same kernel", so that is the
claim being tested) and a centred-crop check on a gradient.

**EXIF is handled once, by `compose.decode_image_rgb`, and `embed.py` does not
touch it.** Pillow does not orient on open, so the service must — and it already
does, in the one place the matting pipeline does. A photo embedded sideways is a
garment CLIP has never seen; oriented twice is the same bug mirrored.

## `POST /v1/embed`

Same auth boundary as `/v1/jobs`, with nothing relaxed: the caller is resolved
through `/auth/v1/user` (the anon key is a validly signed project JWT and
identifies no user), every row is read with the service role and joined to its org,
and one foreign or unknown id is **403 for the whole request**. An embedding is a
searchable fingerprint of somebody's inventory; it does not get a softer rule than
a cutout.

**It writes nothing to `product_images`.** No `mark_queued`, no `mask_status`.
Those columns belong to the backgrounds feature, and borrowing one to mean
"embedding in flight" would fill the review queue with photos no reviewer can act
on and make "Process photos" skip them. That is also why the job registry keeps
**two** in-flight sets — `pipeline.accepted_rows` reads the matting one, and an
embedding's ids in it would silently skip photos. There is a test for exactly that.

**It shares matting's per-workspace lock**, deliberately. Both jobs download every
photo in a batch; a ~400 MB CLIP session plus four in-flight 12 MP decodes is how a
1 GB machine gets OOM-killed mid-batch. Serialising them makes the peak the larger
of the two rather than the sum, and costs a founder nothing (the two buttons are
pressed minutes apart).

**Skip rule.** A photo is skipped when it already carries a row whose `model`
equals this deployment's tag, unless `force`. A row from a **different** model is
always taken, force or not — the RPC never compares across models, so such a row is
invisible to the feature until replaced. That is what makes changing the model a
re-run rather than a migration, and the tag is **derived from the filename** so the
two cannot silently agree when the weights differ.

**Failures are per photo and write nothing.** Not a zero vector, not a NULL
embedding — nothing. A zero vector is orthogonal to everything and would sit at the
bottom of every neighbour list forever looking like a result; an absent row is what
makes pressing the button again work. A failed **flush** counts its chunk as failed
and the job carries on.

**The model file** is fetched in the background at container start, streamed to a
temporary file and `os.replace`d, and verified against its **byte count and
sha256** before the rename — because a short read does not raise, and a truncated
350 MB file would be cached, accepted on the next start, and either fail one image
at a time inside a worker or load and produce wrong vectors. A cancelled download
leaves a `.part` file and never the real name.

**`MODEL_CACHE_DIR` is ephemeral on Fly** without a volume, so every cold start
re-downloads ~350 MB. `fly.toml.example` has a commented `[mounts]` block with the
trade-off written next to it (a volume pins the app to one machine in one region).

## The migration

`supabase/migrations/listing_embeddings.sql` — **written, verified, NOT RUN.** One
table, one function pair, no change to anything that exists.

Decisions worth knowing:

- **pgvector is created defensively.** The extension goes into `extensions` when
  that schema exists (Supabase) and `public` otherwise, and a failure to create it
  is a NOTICE naming the dashboard toggle rather than a dead migration — managed
  Postgres often withholds `CREATE EXTENSION` from the SQL editor's role. A second
  guard then raises if `to_regtype('vector')` still does not resolve, so the failure
  is a sentence naming the fix instead of `type "vector" does not exist`.
- **The primary key is `product_image_id` ALONE**, not `(photo, model)`. One photo
  has one *current* embedding, a re-run replaces rather than doubling the table, and
  an old model's vectors disappear as they are superseded instead of lingering as
  comps nothing will ever compare against.
- **`product_group_id` is deliberately not a foreign key** — the same decision
  `listing_publications` made. The leader's `products` row can be deleted and
  re-created while the listing carries on, and a cascade would destroy the
  embedding of a photo that still exists. `product_id` *is* one, because a photo
  cannot outlive its product row.
- **HNSW, with an ivfflat fallback and a NOTICE.** HNSW needs pgvector ≥ 0.5.0 and
  needs no rebuild as rows arrive. The fallback exists because the query is an
  ORDER BY over every row in the workspace and a seq scan stops being fine at
  50,000 photos; the NOTICE says to REINDEX it, because an ivfflat built on an
  empty table has one useless centroid.
- **`match_listing_images` is a `public` SECURITY INVOKER wrapper over an
  `app_private` SECURITY DEFINER body** (AGENTS.md §18 #45), born that way so
  neither hardening file has to move it. The DEFINER half is not ceremony: it lets
  the workspace be proven **once** and then filtered with a plain
  `e.org_id = <that org>`, which the planner and the index both understand, where an
  RLS `USING` clause becomes a post-filter on an approximate index scan. It also
  lets the body be dynamic SQL, which `to_regclass`-gating `listing_sales` requires.
  A query photo in another workspace returns an **empty result**, not an error — an
  error would distinguish "not yours" from "no neighbours" and make the RPC an
  existence oracle over `product_image_id`.
  - **What that does not fix, stated in the file:** `org_id` and `model` are still a
    Filter over the HNSW scan (verified — see scenario 17), and pgvector documents
    that a filtered approximate scan can return fewer rows than the LIMIT. It is
    acceptable because one workspace dominates its own table and its own model.
- **Same `model` only.** A cosine between a CLIP-B/32 vector and some future
  model's vector is noise that sorts convincingly.
- **`listing_sales` through `to_regclass`, and through a LATERAL.** A listing can
  have several sales rows (a return, a re-list), and a plain join would return the
  same photo three times; the most recent sale is what a comp wants. Its absence
  yields NULL columns, and its later arrival needs no re-run of this file.

### Verification transcript

A throwaway PG 14.21 cluster with **real pgvector 0.8.6** (the Homebrew bottle only
ships for PG 17/18, so it was built from source against `postgresql@14`'s pgxs — the
`vector` column and the HNSW index are therefore genuinely exercised, not stubbed),
plus a stub of the Supabase-managed pieces and `multi_org_tenancy.sql`. Fixture:
two workspaces, six listings, vectors of the form `v(θ) = [cos θ, sin θ, 0 … 0]` so
every expected cosine is arithmetic rather than a guess.

| # | Scenario | Result |
|---|---|---|
| 1 | table applies; `embedding` is `vector`; which index was built | `listing_embeddings_vec_hnsw` |
| 2 | `public` wrapper `prosecdef = f`, `app_private` body `= t` | ✅ |
| 3 | linter 0028/0029 over `public` | `match_listing_images` absent from the report (the 5 rows are multi_org_tenancy's own helpers, which the hardening files move) |
| 4 | EXECUTE granted to `authenticated` on both halves, revoked from `anon` | ✅ |
| 5 | ordering + the three exclusions | `L2 0.9801, L5 0.9211, L3 0.8253, L4 0.3624`; the sibling photo, the other model and the other workspace all absent |
| 6 | `p_limit` honoured; 0 → 1, null → 12, 99999 → clamped | ✅ |
| 7 | workspace B querying A's photo; B querying its own | 0 rows; 0 rows |
| 8 | unknown / unembedded `product_image_id` | 0 rows, no error |
| 9 | before `pricing_research.sql`: `sold_price_cents` / `sold_at` | NULL on every row |
| 10 | RLS on the table: A sees 7, B sees 1, leak count | 0 leaked |
| 11 | `update … set org_id` as a member | `42501 permission denied` |
| 11b–d | member may rewrite `embedding`/`model`, may delete own row, may NOT delete B's | ✅ |
| 12 | deleting the `product_images` row cascades the embedding | ✅ |
| 13 | wrong dimension / blank model / duplicate PK | `expected 512 dimensions, not 3`; CHECK; `23505` |
| 14 | with `listing_sales`: two sales on one group, distinct order ids | ONE row for L3, at **1800** (the most recent), not 2200, not two rows |
| 15 | a sale on the same group id in workspace B | NULL for A |
| 16 | index choice at 8 rows | btree + Sort — the planner is right at that size |
| 17 | index choice at 5,008 rows | `Index Scan using listing_embeddings_vec_hnsw`, org/model as Filter |
| 18 | ROLLBACK block exactly as written | functions and table gone; `vector` and `app_private` deliberately kept |
| 19 | re-apply after rollback, and re-apply on top of itself | identical index set and function pair, rows intact |
| 20 | **REAL CLIP vectors end to end** | see below |

Scenario 20 is the one worth reading. Four real photos were embedded through
`OnnxEmbedder` with the actual 350 MB model, serialised with `to_pgvector`, inserted
as SQL text, and ranked by the RPC:

```
    title    |  sim
-------------+--------
 img1-reshot | 0.9837      <- the SAME jacket, re-shot brighter and re-cropped
 img2        | 0.8422      <- a different garment
 img3        | 0.7697      <- a different garment
```

That is the whole feature working: preprocess → ORT → L2 → pgvector text →
Postgres cast → `<=>` → similarity. It is also where the 0.92 duplicate threshold
comes from — the re-shoot clears it by a wide margin and neither genuine comp comes
close, so "near duplicate" means what it says.

## The client

`embeddingsService.ts` mirrors `backgroundService.ts`, deliberately: same env seam
(`mattingBaseUrl`, imported rather than re-parsed), same cached column probe, same
`'unavailable'` pre-migration path, and `pollBackgroundJob` **re-exported** rather
than duplicated because an embed job is a job on the same registry with the same
progress shape.

- **`findSimilar` is one RPC plus one read.** The RPC returns ids; a strip needs a
  picture and a way in, so the photo ids go back to `product_images` for
  `storage_path` with `products(batch_id)` embedded. Two round trips, never N. Every
  URL is built through `storageUrls.publicImageUrl` (§18 #20), and the thumbnail is
  the **original** photo — the one that was embedded — so a correct match never looks
  wrong because the thumbnail came from somewhere else.
- **A `$0` price becomes `null`**, because the export gate reads 0 as "unpriced" and
  "$0.00" beside a comp is worse than no number.
- **`fetchEmbeddedPhotoIds` exists for one question the RPC cannot answer:** an
  empty neighbour list means either "never analysed" (offer a button) or "nothing
  like it" (say so). It is read **only** in the empty case.

`SimilarListings.tsx` renders nothing at all until it has something true to say —
no service URL, no migration, no workspace, or a read that came back unavailable.
Otherwise: up to eight cards in a horizontally scrolling, scroll-snapped strip,
each with the thumbnail, the similarity word over it, the title (clamped to two
lines), the price, `sold $X · N days ago` when it sold, and a `Possible duplicate`
chip in the header plus a per-card line when any match clears 0.92. The duplicate
claim is a real element, not a `title` attribute — it is the one thing here a
seller acts on, so it belongs in the accessibility tree.

Phone: the strip scrolls with `overscroll-behavior-x: contain`, cards narrow to
9.5rem so two are visible (one card filling the viewport hides that the row
scrolls), and the button is a literal 44px tall at `var(--fs-md)` (16px, so mobile
Safari does not zoom). `white-space: normal` is restated on every label inside a
`<button>`, because `index.css` pins `nowrap` on buttons and a label inherits it —
the defect the Home dashboard's tool tiles hit.

## What is NOT verified

- **Nothing in a signed-in browser.** `SimilarListings` is not mounted anywhere by
  design (the founder places it), so it has been exercised only through the test
  harness — 38 tests, including every empty and failing path. No screenshots.
- **The service has not been deployed with this code.** The endpoint, the job
  wiring and the auth boundary are covered by 99 offline tests; the 350 MB
  download, the cold-start prefetch and the volume story have been reasoned about
  and unit-tested against a MockTransport, not watched on Fly.
- **`listing_embeddings.sql` has not been run against Supabase.** Only the
  throwaway PG 14 cluster above.
- **Real-world recall.** The 0.92 threshold is calibrated on one re-shoot and two
  genuine comps. It is the right shape and it is a single named constant; the first
  few hundred real listings are what would justify moving it.
- **Latency on the actual machine.** 15 ms/photo is arm64 with one thread; a Fly
  `shared-cpu-1x` will be several times that. Still trivial against the download.

## Next, in the plan's order

Step 4 (comps + price) can now read `match_listing_images` for the shop's own
comps. Two follow-ons this pass deliberately did not do:

- **Mount the strip.** Step 3's research card is the intended home; `ProductsView`
  is the other obvious one, where "have I listed this before" is asked while
  holding the garment.
- **Embed on upload.** Today a photo is embedded when somebody asks. Calling
  `ensureEmbeddings` after a batch's `registerItemsInDB` would make the comps ready
  before the seller reaches Step 3 — cheap, and it wants the founder's call on
  whether a 400-photo upload should also do 400 forward passes unasked.
