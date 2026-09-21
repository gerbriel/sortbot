# Matting service — HTTP contract

**This file is the interface.** The Arcadian app codes against this document,
not against the Python. If the two ever disagree, this file is the bug report
and `app/` is the bug.

Everything below is verified by `tests/` — the preset vectors in §4 by
`test_preset_hash.py`, the backdrop rules in §4.3 by `test_compose.py` and
`test_jobs.py`, the auth rules in §2 by `test_auth.py`, the skip rules in §5 by
`test_pipeline.py`, the shutdown and timeout behaviour in §5 by `test_jobs.py`,
and the failure flags and retry policy in §8.1 by `test_backend_replicate.py`.

---

## 1. Base URL

Production: `https://matting.arcadian.ltd`
Local: `http://localhost:8080`

The app's CSP (`index.html`) must list exactly that origin in `connect-src`, or
every call fails silently with no visible error — a blocked subresource does not
throw (AGENTS.md §18 #25).

---

## 2. Authentication

Every request except `GET /healthz` carries the **signed-in user's Supabase
access token**:

```
Authorization: Bearer <supabase access token>
```

That is `(await supabase.auth.getSession()).data.session?.access_token` — the
user's token, never the anon key and never a service key.

The service resolves it by calling `GET {SUPABASE_URL}/auth/v1/user` with
`apikey: <anon key>` and the caller's bearer token. It does not decode the JWT
locally.

> **The anon key is a validly signed project JWT.** Anything that only checks
> "is this a well-formed project token" admits the entire internet, because the
> anon key is printed in the browser bundle — this is the trap audit 05 found in
> the Edge Functions (AGENTS.md §9). `/auth/v1/user` returns no user for it, and
> that is a **401**.

Then, **with the service role** (which bypasses RLS), the service loads every
requested `product_images` row joined to `products.org_id` and requires that org
to be one the caller is a member of.

| Condition | Status |
|---|---|
| No / malformed / expired token, or the anon key | `401` |
| Any requested id in another workspace | `403` |
| Any requested id that does not exist | `403` |
| Caller belongs to no workspace | `403` |
| Ids spanning two workspaces in one job | `403` |

**403 is for the whole request, never a filtered subset.** A partial success is
indistinguishable from a success on the client side, so a bug that sends the
wrong ids would look like "matting sometimes skips photos" for months. An
unknown id is 403 and not 404 for the same reason it is 403 in the app: a 404
here would be an existence oracle over the uuid space.

---

## 3. CORS

`ALLOWED_ORIGINS` (default `https://arcadian.ltd,http://localhost:5173`).
Methods `GET, POST, OPTIONS`; headers `Authorization, Content-Type`. Never `*` —
the browser sends a bearer token on every call.

Request bodies are capped at **256 KB** (`413` above it).

---

## 4. `BackgroundPreset`

```ts
type BackgroundPreset = {
  id: string;          // default "default" — NOT part of the hash
  canvas: number;      // default 2048, 256-4096, integer
  color: string;       // default "#FFFFFF", /^#[0-9a-fA-F]{6}$/
  padding: number;     // default 0.10, 0-0.4, fraction of canvas PER SIDE
  anchor: "center" | "top";  // default "center"
  shadow: boolean;     // default false
  quality: number;     // default 90, 60-95, integer
  backdrop: { storagePath: string; fit: "cover" } | null;   // default null
};
```

Validation is **strict, not clamping**: `padding: 0.9` is a `422`, not `0.4`. A
caller that has misunderstood the unit should find out now, not months later in
the catalog.

### 4.1 `presetHash` — the cross-language contract

The hash names the composite file and fills `product_images.bg_preset`. The
browser computes it to decide whether a stored composite is stale; the service
computes it to write one. **If the two disagree, every composite looks stale
forever and the app re-mats the whole catalog.**

Algorithm:

1. Build a JSON object with **exactly these seven keys, sorted alphabetically**:
   `anchor`, `backdrop`, `canvas`, `color`, `padding`, `quality`, `shadow`.
   `id` is **not** included — the hash identifies a *look*, not a preset row, so
   renaming a preset must not invalidate 4,800 composites.
2. No whitespace anywhere. Strings double-quoted.
3. `color` is **upper-cased**.
4. `canvas` and `quality` are plain integers.
5. `shadow` is `true` / `false`.
6. `padding` is written with **at most 3 decimals, trailing zeros stripped**:
   `0.1` and `0.100` both serialise as `0.1`; `0.08` as `0.08`; `0` as `0`.
   In TypeScript that is `String(Number(padding.toFixed(3)))`.
   *(Not the language's float repr: a slider emitting `0.10000000000000003`
   would otherwise mint a second hash for a look nobody can distinguish.)*
7. `backdrop` is written as a **bare string**: its `storagePath`, or `""` when
   there is no backdrop. **`backdrop.fit` is NOT hashed** — `"cover"` is its only
   legal value, so it cannot describe two looks. The day a second fit exists it
   must enter the canonical form, and that is a breaking change to ship as a new
   preset, not as a new hash for an old one.
8. `presetHash` = **first 8 lowercase hex characters of `sha1(canonicalJson)`**.

```ts
function presetHash(p: BackgroundPreset): string {
  const pad = String(Number(p.padding.toFixed(3)));
  const json =
    `{"anchor":${JSON.stringify(p.anchor)},` +
    `"backdrop":${JSON.stringify(p.backdrop?.storagePath ?? "")},` +
    `"canvas":${p.canvas},` +
    `"color":${JSON.stringify(p.color.toUpperCase())},"padding":${pad},` +
    `"quality":${p.quality},"shadow":${p.shadow}}`;
  return sha1Hex(json).slice(0, 8);
}
```

### 4.2 Fixed test vectors — assert these on the TypeScript side

| # | Preset | Canonical JSON | Hash |
|---|---|---|---|
| 1 | all defaults (or `{}`, or omitted) | `{"anchor":"center","backdrop":"","canvas":2048,"color":"#FFFFFF","padding":0.1,"quality":90,"shadow":false}` | `6300e6dc` |
| 2 | `{canvas:1536,color:"#f4f4f4",padding:0.08,anchor:"top",shadow:true,quality:85}` | `{"anchor":"top","backdrop":"","canvas":1536,"color":"#F4F4F4","padding":0.08,"quality":85,"shadow":true}` | `a4c629a4` |
| 3 | defaults + `backdrop.storagePath = "u1/backdrops/1700000000000-linen.jpg"` | `{"anchor":"center","backdrop":"u1/backdrops/1700000000000-linen.jpg","canvas":2048,"color":"#FFFFFF","padding":0.1,"quality":90,"shadow":false}` | `6218c54a` |
| 4 | `{padding:0.100}` | identical to vector 1 | `6300e6dc` |

Vector 2 exercises every scalar field at a non-default value and the colour
upper-casing. Vector 3 is the backdrop. Vector 4 is the float-formatting rule.

> **`7abc910f` and `c7e0869c` are RETIRED.** They were vectors 1 and 2 before
> `backdrop` entered the canonical form on **20 Sept 2026**. Nothing had ever been
> processed under them — the first production run failed all three of its photos
> on Replicate's billing gate — so no stored composite carries an old hash and
> there is nothing to migrate. Had one catalogue been matted first, the field
> would have had to ship as a second preset instead. If either string turns up
> anywhere, it is pre-backdrop code, not data.

### 4.3 Photo backdrops

`backdrop` replaces the flat `color` fill with a photo. Everything else about the
composite is **identical** — same padding, same anchor, same shadow, same
placement arithmetic — so switching a catalogue from white to linen changes what
is behind the garment and not where the garment is.

- **Where the files live:** `{uploaderUserId}/backdrops/{unix_ms}-{slug}.jpg` in
  the same bucket, uploaded by the app at **≤ 2048 px**. The service accepts any
  bucket-relative path (the bucket is public, so reading another prefix is not a
  new exposure) but refuses an absolute path, a `..` segment, a scheme, a
  backslash, a `?`/`#`, a control character, and anything over 300 characters.
- **`fit: "cover"`** is the only fit: the backdrop is scaled to cover
  `canvas × canvas` and **centre-cropped**, LANCZOS. Cover rather than contain
  because a backdrop that does not reach the edges is not a backdrop.
- **It is fetched and decoded ONCE PER JOB**, not once per image.
- **`color` fills nothing when a backdrop is set.** It still has an effect through
  the shadow, which multiplies darkness into whatever is underneath — so a contact
  shadow darkens the linen rather than painting grey on it.
- **A missing or undecodable backdrop fails the row** with
  `mask_flags = ['error:backdrop missing']`. It **never** falls back to the flat
  colour: half a catalogue on linen and half on white, because one fetch failed on
  a Tuesday, is invisible until a buyer sees the grid, and is the exact failure the
  deterministic compositor exists to prevent.
- **Also accepted:** `backdrop` as a bare path string (and `""` for none), because
  the canonical JSON writes it that way and a caller round-tripping its own
  canonical form should not get a 422.

---

## 5. Endpoints

### `GET /healthz`

The only unauthenticated endpoint.

```json
{
  "ok": true,
  "backend": "replicate",
  "model": "replicate:men1scus/birefnet@f74986db",
  "embedModel": "clip-vit-base-patch32@onnx",
  "embedReady": true
}
```

`embedReady` is whether the CLIP weights are on disk yet. It is `false` for the
first minute or so of a cold start on an ephemeral `MODEL_CACHE_DIR` — show that,
not "broken"; `POST /v1/embed` fetches them on first use if the prefetch has not
finished.

### `POST /v1/jobs` → `202`

```jsonc
// request
{
  "productImageIds": ["uuid", "..."],   // <= MAX_IDS_PER_JOB (default 2000)
  "preset": { /* BackgroundPreset, optional — omitted means all defaults */ },
  "force": false
}
```

```jsonc
// response
{ "jobId": "uuid", "accepted": 12, "skipped": 3 }
```

**Skip rule.** Unless `force`, a row is skipped when it already has **both**
derived paths **and** `mask_model` equals the current backend tag **and**
`bg_preset` equals this preset's hash. That is the whole idempotency key:

- `mask_status` is **not** part of it, with two exceptions below. `approved` and
  `original` are a human's judgement, and a background refresh must never quietly
  re-cut them.
- `mask_status = 'failed'` is **never** skipped — pressing the button again is
  the retry.
- **`mask_status = 'queued'` is never skipped either.** A queued row is normally a
  row **nobody is working on**: the status is written before any work starts, so a
  machine that died mid-batch leaves its remaining photos queued with nothing
  behind them, and the service's own host stops a machine after five minutes on
  its current plan — so that is the ordinary case, not an exotic one. The trap is
  that re-queueing touches only `mask_status`, so a queued row can still carry the
  *previous* run's `mask_model` and `bg_preset`; the idempotency key would match
  and the photo would be skipped **for good**, permanently "in flight" behind a
  process that no longer exists.
- **The one thing skipped even under `force`:** a row the service is working on
  *right now*. That is in-process knowledge, not a column. The reason is money, not
  correctness — jobs are serialised per workspace, so a duplicate would run
  *afterwards* and simply mat (and bill for) every photo twice, because its
  accepted list was decided before the first job wrote a row. `force` means
  "ignore what the row says", never "do it twice".
- A new preset is not skipped, but it costs nothing: the composite is
  re-derived from the stored alpha master with no matting call.

Accepted rows are set to `mask_status = 'queued'` **before** any work starts, so
the first poll already shows the queue.

`accepted: 0` with `jobId: ""` is a **success** meaning "already up to date" —
render it as such, not as an error.

Duplicate ids in the request are collapsed.

**On shutdown, nothing is left half-done.** `SIGTERM` and `SIGINT` both drain the
images in flight, and whatever did not finish is written back to
`mask_status = 'queued'` with a log line naming the ids. Resubmitting the same ids
then picks them straight back up, per the rule above. **So the recovery from an
interrupted batch is: press the button again.**

### `GET /v1/jobs/{jobId}` → `200`

```json
{ "jobId": "uuid", "status": "running", "total": 12, "done": 7, "failed": 0, "review": 2, "auto": 5 }
```

`status` is `"running"` or `"done"`. `404` for an unknown or expired job (they
are retained for one hour after finishing).

> **The rows are the truth; this is a progress bar.** Job state is in memory. A
> restart loses the counter, not the work — the rows are still `queued` and
> resubmitting the same ids picks them up. Poll this for the bar, then read
> `product_images` for the result.

### `POST /v1/images/{productImageId}/rerun` → `202`

```jsonc
{ "preset": { /* BackgroundPreset */ }, "resolution": 1024 }  // 1024 | 2048
```

```json
{ "jobId": "uuid" }
```

A single-image job, **always forced**. `2048` asks the backend for its
high-resolution variant where it has one.

Unlike `POST /v1/jobs`, this is **not** filtered against the images in flight: the
caller has explicitly asked for this one photo to be redone, and honouring that is
worth more than saving one matting call. Jobs are serialised per workspace, so it
runs after whatever is in progress rather than alongside it.

### `POST /v1/embed` → `202`

CLIP-embed these photos into `listing_embeddings` (see §9). Nothing to do with
matting: it writes **no** `product_images` column, and it is the only endpoint
here whose output the app reads through SQL rather than off a row.

```jsonc
// request
{
  "productImageIds": ["uuid", "..."],   // <= MAX_IDS_PER_JOB (default 2000)
  "force": false
}
```

```jsonc
// response
{ "jobId": "uuid", "accepted": 12, "skipped": 3 }
```

Poll it with `GET /v1/jobs/{jobId}` — the same endpoint and the same shape. An
embedded photo counts as **`auto`** (it needed nobody) and `review` is always `0`.

**Auth is byte-for-byte the auth of `POST /v1/jobs`** (§2): the caller is resolved
through `/auth/v1/user`, every row is read with the service role and joined to its
org, and one foreign or unknown id is `403` for the whole request. An embedding is
a searchable fingerprint of somebody's inventory, so it gets the same boundary as
a cutout and not a softer one.

**Skip rule.** Unless `force`, a photo is skipped when it already has a
`listing_embeddings` row whose `model` equals this deployment's tag. Two
consequences worth knowing:

- A row embedded with a **different** model is always taken, `force` or not. The
  nearest-neighbour RPC never compares across models, so such a row is invisible
  to the feature until it is replaced — which is what makes changing the model a
  re-run of this endpoint rather than a migration.
- As with `/v1/jobs`, a photo **this process is already embedding** is skipped even
  under `force`, for the same reason: jobs are serialised per workspace, so a
  duplicate would run afterwards with an accepted list decided before the first one
  wrote anything.

`accepted: 0` with `jobId: ""` is a **success** meaning "already embedded".
Duplicate ids are collapsed.

**`503` means the table is missing** — i.e. `supabase/migrations/listing_embeddings.sql`
has not been run. The body is deliberately generic; the client detects that case
for itself with a column probe and can name the file.

**A failed photo writes no row at all** — not a zero vector, not a NULL embedding.
A zero vector is orthogonal to everything and would sit quietly at the bottom of
every neighbour list forever; an absent row is what makes pressing the button
again work. The job carries on, and the failure is one of the `failed` count.

---

## 6. What the service writes

Per image, on success, **one `PATCH` to `product_images`**:

| Column | Value |
|---|---|
| `cutout_storage_path` | `{dir}/cut-{modelTag}-{unixMs}.webp` — the alpha master |
| `composite_storage_path` | `{dir}/bg-{presetHash}-{unixMs}.jpg` — the catalog image |
| `bg_preset` | the 8-hex preset hash |
| `mask_model` | `replicate:{owner}/{name}@{version8}` or `local:BiRefNet@{res}` |
| `mask_score` | `1 - flags/5`, 3 decimals |
| `mask_flags` | `text[]` from `coverage`, `edge`, `fragments`, `soft`, `contrast` |
| `mask_status` | `auto` (clean) or `review` (a non-advisory flag fired) |
| `matted_at` | `now()` |

On failure: `mask_status = 'failed'`, a single `mask_flags` entry of the form
`error:<reason>` (**§8.1**), and the job continues with the next image.

**It never touches `storage_path`, `image_url` or `position`.** Derived files
are always NEW paths beside the source, so the per-`storage_path` immutability
the Service Worker relies on (AGENTS.md §18 #35, `public/sw.js`) holds and
nothing needs `invalidateImageUrl`.

Superseded cutouts and composites are deleted only after the row is updated, and
only when **no other `product_images` row references that path** — duplicated
batches share files (AGENTS.md §18 #15). Any doubt keeps the file.

### 6.1 The flags, in the words a reviewer needs

| Flag | Means | Sends to review? |
|---|---|---|
| `coverage` | subject is <12% or >90% of the frame — it found a label, or it failed open | yes |
| `edge` | >1.5% of the left/right/bottom border is subject — it ran into the floor or wall | yes |
| `fragments` | >3 separate blobs — it grabbed the hanger and a shadow too | yes |
| `soft` | >25% of the subject is half-transparent — a ghost | yes |
| `contrast` | the edge and the photo's own backdrop are within 12 CIELAB — a white tee on a white wall | **no, advisory** |

The top edge is **exempt** when `anchor: "top"` — a hanging garment's hook
legitimately leaves the frame.

`contrast` is advisory because it describes a *difficult photograph*, not a
wrong answer. It still lowers `mask_score`, so it still sorts the queue.

---

## 7. Backend notes (informational)

`REPLICATE_MODEL` defaults to `men1scus/birefnet`. Its published schema
(replicate.com/men1scus/birefnet/api/schema, verified September 2026):

- `input.image` — string, format `uri`, **required**
- `input.resolution` — string, `"WxH"` (e.g. `"1024x1024"`), default `""`
- `output` — a single string, format `uri`

The `resolution` field is a **string**, so the integer in `/rerun` is translated
here. `REPLICATE_VERSION` is pinned (`f74986db…` is the current latest); an
unpinned model changes weights without notice and makes a catalog's cutouts
inconsistent, so the service refuses to start unpinned outside `MATTING_ENV=dev`.

None of this reaches the app: swapping to `MATTING_BACKEND=local` changes
`mask_model` and nothing else in this document.

---

## 8. Error bodies

Every non-2xx is `{ "error": "<sentence>" }`.

| Status | When |
|---|---|
| `401` | no user behind the token |
| `403` | rows not available to this caller |
| `404` | unknown job id |
| `413` | body over 256 KB |
| `422` | invalid preset, or too many ids |
| `503` | the matting backend is not configured / unavailable |

Upstream bodies and exception strings are **never** echoed — they are logged
server-side and the caller gets a generic sentence (same rule as the Edge
Functions, AGENTS.md §9).

### 8.1 `mask_flags` failure entries — the shape to render

A failed row carries **exactly one** flag, always `error:` followed by a reason,
and **the whole flag is capped at 200 characters**. Render it as text; do not
parse it. The reasons you will actually see:

| Flag | Means | What to do |
|---|---|---|
| `error:replicate <status> <title> — <detail>` | The matting API refused. `title`/`detail` are **its own words**. | Read them. `402 Insufficient credit` means the account needs a card. |
| `error:replicate prediction failed — <model error>` | The model ran and failed (CUDA OOM, an input it could not fetch). | Usually re-run; a repeat means the photo. |
| `error:backdrop missing` | The preset's backdrop could not be fetched or decoded (§4.3). | Fix the backdrop, then re-run. It did **not** render on the flat colour. |
| `error:timeout after 180s` | The whole image exceeded `IMAGE_TIMEOUT_S`. | Re-run. A repeat means a very large source or a wedged upstream. |
| `error:<ExceptionClass>: <message>` | Anything unexpected. | The class name is the lead. |

> **Why the upstream *status text* is in a database column here when §8 forbids
> echoing upstream bodies in a RESPONSE.** These are two different boundaries. §8
> is about what a browser is told over HTTP; this is the founder's own review queue,
> and the whole point of it is to say why a photo failed. The first production run
> wrote `error:RuntimeError: replicate create failed (429)` three times, which named
> an exception class and a status and **not** the cause — a billing gate. The API
> token, the image URL and any inline `data:` image are scrubbed out before the flag
> is written, and the flag is one collapsed line.

**Retry policy, so a flag means what it says.** `429`, `5xx` and transport errors
are retried **5 times** with backoff **2, 4, 8, 16, 32 s** (±20% jitter) before the
row fails — they are load, and load passes. **`402` and every other `4xx` fail on
the first response**: insufficient credit does not appear within a minute, and
retrying turns one legible failure into six identical ones and a minute of dead
capacity per photo. The count is `REPLICATE_RETRY_ATTEMPTS` (`0` disables it).

---

## 9. Embeddings

`POST /v1/embed` (§5) writes rows to **`listing_embeddings`** —
`supabase/migrations/listing_embeddings.sql`, run by hand like every other
migration here. The app does not read the vectors; it calls the RPC that ranks
them.

### 9.1 The row

| Column | Value |
|---|---|
| `product_image_id` | PK. `product_images.id`, cascade delete. **One CURRENT embedding per photo** — the model is *not* part of the key, so a re-run replaces rather than accumulates. |
| `product_id` | the photo's `products` row |
| `product_group_id` | the group LEADER's id, read from `products.product_group` and **NULL when that value is absent or is not a uuid** (the column is `text`; a listing whose group cannot be read is a listing of one photo) |
| `org_id` | the workspace, from the authorized rows — never from the request |
| `embedding` | `vector(512)`, **L2-normalised before it is written** |
| `model` | this deployment's tag, e.g. `clip-vit-base-patch32@onnx` |
| `created_at` | the database's, never sent |

`storage_path` is what gets embedded — **the original photo, never the composite.**
A cutout on a flat canvas is a different image to CLIP, and a catalogue embedded
half one way and half the other has useless cross-comparisons that look fine.

### 9.2 The model, and why this one

OpenAI **CLIP ViT-B/32**, vision tower only, as the ONNX export
`Xenova/clip-vit-base-patch32` → `onnx/vision_model.onnx` (~350 MB, fp32).
Licences: CLIP weights **MIT** (OpenAI), the export **MIT** (Xenova),
`onnxruntime` **MIT**. No torch, no API key, no third party at run time.

Preprocessing is CLIP's own, reproduced exactly: shortest side to 224 with PIL
bicubic, centre crop 224×224, RGB, `/255`, then mean
`[0.48145466, 0.4578275, 0.40821073]` and std `[0.26862954, 0.26130258, 0.27577711]`,
NCHW float32. Output is the 512-wide `image_embeds`, L2-normalised.

**The quantized export was measured and rejected**, and the numbers are in
`docs/pricing/02-embeddings.md`: cosine agreement with fp32 was 0.90–0.97 (not the
>0.99 that would have made it interchangeable), and — the deciding part — it moved
every *pairwise* similarity down by 0.03–0.06. This feature consumes the cosine
*between* two embeddings and thresholds it at 0.92; a quantization that shifts the
pairs does not add noise to a ranking, it moves the thresholds out from under it.
It was also slower on arm64 (25 ms vs 15 ms).

Swapping the model is `EMBED_MODEL_URL` plus a re-run. The tag is **derived from
the filename** so the two cannot disagree, and a differing tag is what stops the
old and new vectors from ever being compared.

### 9.3 `match_listing_images(p_product_image_id uuid, p_limit int default 12)`

The read side, and the only one the app uses. A `public` SECURITY INVOKER wrapper
over an `app_private` SECURITY DEFINER body (AGENTS.md §18 #45).

Returns, ordered by cosine similarity descending:
`(product_image_id, product_id, product_group_id, similarity real, title text,
price numeric, sold_price_cents bigint, sold_at timestamptz)`.

- **Same workspace only**, and a query photo in another workspace returns an
  **empty result** rather than an error — an error would distinguish "not yours"
  from "no neighbours" and make the RPC an existence oracle over `product_image_id`.
- **Same `model` only.** A cosine across two models sorts convincingly and means
  nothing.
- **The query listing's own `product_group_id` is excluded**, and so is the query
  photo. A listing's other four photos are not a comp; they are the same garment.
- `title` / `price` come from the group LEADER's `products` row, falling back to
  the photo's own row for the legacy fresh-uuid groups (AGENTS.md §11).
- `sold_price_cents` / `sold_at` come from the **most recent** `listing_sales` row
  for that group, and are `NULL` when `pricing_research.sql` has not been run —
  that table is read through `to_regclass`, so its arrival needs no re-run of the
  embeddings migration.
- `p_limit` is clamped to 1–50.
