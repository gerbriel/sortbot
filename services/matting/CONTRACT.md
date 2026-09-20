# Matting service — HTTP contract

**This file is the interface.** The Arcadian app codes against this document,
not against the Python. If the two ever disagree, this file is the bug report
and `app/` is the bug.

Everything below is verified by `tests/` — the preset vectors in §4 by
`test_preset_hash.py`, the auth rules in §2 by `test_auth.py`, the skip rules in
§5 by `test_pipeline.py`.

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

1. Build a JSON object with **exactly these six keys, sorted alphabetically**:
   `anchor`, `canvas`, `color`, `padding`, `quality`, `shadow`.
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
7. `presetHash` = **first 8 lowercase hex characters of `sha1(canonicalJson)`**.

```ts
function presetHash(p: BackgroundPreset): string {
  const pad = String(Number(p.padding.toFixed(3)));
  const json =
    `{"anchor":${JSON.stringify(p.anchor)},"canvas":${p.canvas},` +
    `"color":${JSON.stringify(p.color.toUpperCase())},"padding":${pad},` +
    `"quality":${p.quality},"shadow":${p.shadow}}`;
  return sha1Hex(json).slice(0, 8);
}
```

### 4.2 Fixed test vectors — assert these on the TypeScript side

| # | Preset | Canonical JSON | Hash |
|---|---|---|---|
| 1 | all defaults (or `{}`, or omitted) | `{"anchor":"center","canvas":2048,"color":"#FFFFFF","padding":0.1,"quality":90,"shadow":false}` | `7abc910f` |
| 2 | `{canvas:1536,color:"#f4f4f4",padding:0.08,anchor:"top",shadow:true,quality:85}` | `{"anchor":"top","canvas":1536,"color":"#F4F4F4","padding":0.08,"quality":85,"shadow":true}` | `c7e0869c` |
| 3 | `{padding:0.100}` | identical to vector 1 | `7abc910f` |

Vector 3 is the float-formatting rule. Vector 2 exercises every field at a
non-default value and the colour upper-casing.

---

## 5. Endpoints

### `GET /healthz`

The only unauthenticated endpoint.

```json
{ "ok": true, "backend": "replicate", "model": "replicate:men1scus/birefnet@f74986db" }
```

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

- `mask_status` is **not** part of it. `approved` and `original` are a human's
  judgement, and a background refresh must never quietly re-cut them.
- `mask_status = 'failed'` is **never** skipped — pressing the button again is
  the retry.
- A new preset is not skipped, but it costs nothing: the composite is
  re-derived from the stored alpha master with no matting call.

Accepted rows are set to `mask_status = 'queued'` **before** any work starts, so
the first poll already shows the queue.

`accepted: 0` with `jobId: ""` is a **success** meaning "already up to date" —
render it as such, not as an error.

Duplicate ids in the request are collapsed.

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

On failure: `mask_status = 'failed'`, `mask_flags = ['error:<short reason>']`,
and the job continues with the next image.

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
