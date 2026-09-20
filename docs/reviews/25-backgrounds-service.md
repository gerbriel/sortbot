# 25 — Automated background removal and replacement (the service half)

**Status:** built, tested, **nothing run against Supabase and nothing deployed.**
`supabase/migrations/image_backgrounds.sql` is written and NOT run. The app half
(`src/lib/backgroundService.ts` and its UI) was built in parallel against
[`services/matting/CONTRACT.md`](../../services/matting/CONTRACT.md); this
document covers the migration, the service, and the decisions behind them.

> **Note on the file number.** A parallel pass wrote `25-plan-management.md` at
> the same time, so there are two 25s. This one was named in the brief; renaming
> it is a one-line change if the collision is annoying.

---

## 1. What was built

| | |
|---|---|
| `supabase/migrations/image_backgrounds.sql` | 8 columns + 1 CHECK + 1 partial index on `product_images`. No new table, policy, function or grant change. |
| `services/matting/` | FastAPI service, Python 3.12, 6 runtime deps, **157 tests**, Dockerfile, Fly config, README, CONTRACT. |
| `.github/workflows/ci.yml` | one additive `matting` job (Python 3.12 → `pip install -e` → `pytest`). No existing job touched. |

Nothing in `src/`, `index.html`, `vite.config.ts`, `.env.example`, `AGENTS.md` or
`CHANGELOG.md` was modified by this pass.

---

## 2. The three decisions everything else follows from

### 2.1 The matting backend is an interface; everything else is arithmetic

Matting is the one part that is a model, costs money, and will be replaced.
`app/backends/base.py` is four lines of `Protocol`, and the compositor, the
scorer, the storage layout, the database columns, the HTTP contract and every
line of the app are written against it. Swapping `replicate` (BiRefNet hosted,
~$0.0017/image) for `local` (BiRefNet in-process) is one env var and changes
`mask_model` and nothing else.

That is also why `mask_model` exists as a column. "Which weights cut this photo"
is the question you ask when a batch comes out wrong, and without it
"re-run everything the old model touched" is a guess rather than a query.

### 2.2 Compositing is deterministic, never generative

Same source + same alpha + same preset → the same pixels on every machine,
forever. A generative background pass makes every photo slightly different, and
a catalog page of forty garments on forty subtly different whites looks broken
in a way nobody can point at.

This had one concrete consequence during the build. The obvious edge-refinement
call is `cv2.ximgproc.guidedFilter`, which ships in opencv-**contrib**, not in
the `opencv-python-headless` wheel this service depends on. The options were to
add contrib (a second ~50 MB wheel that also provides `cv2`, so installing both
leaves whichever landed last in charge) or to fall back to bicubic when it is
absent. **Both were rejected**, and the filter is 15 lines of box filters over
the base API instead (`guided_filter` in `app/backends/base.py`, He/Sun/Tang
2010). The fallback in particular would have made the same photo and the same
preset produce different pixels on the founder's laptop and on the server —
which is the one thing the determinism argument is for.

### 2.3 The alpha master is the durable asset; the composite is disposable

Per image the service writes **two** files beside the source:

- `cut-<model>-<ms>.webp` — source RGB + **lossless** alpha (`alpha_quality=100`).
  This is what a matting call bought.
- `bg-<presetHash>-<ms>.jpg` — the catalog image. Arithmetic.

So **changing a preset costs nothing**: the composite is re-derived from the
stored alpha with no matting call. That is the single most important cost
property of the design, and the reason `cutout_storage_path` is a column rather
than a temp file.

---

## 3. The migration

Eight nullable columns (`mask_flags` is `not null default '{}'`), one CHECK on
`mask_status`, one partial index on `(product_id) where mask_status = 'review'`.

**No RLS change, deliberately.** `product_images` is already org-scoped under
`multi_org_tenancy.sql`; members already SELECT and UPDATE their own workspace's
rows, and that existing grant is exactly what lets the review UI write
`approved` / `original` from the browser. Adding a policy here would be a
second, drifting copy of a rule that already holds.

**The service's boundary is not a policy and the migration says so.** The
service writes with the service role, which bypasses RLS entirely; its boundary
is `app/auth.py` (§4.2). A policy in this file would suggest the database is
guarding the service. It is not.

Two smaller calls, both written into the file:

- `mask_status` is **nullable with no default**. A default would retroactively
  claim ~4,900 existing photos are queued for matting. `NULL` means "never
  processed" and that is the state of every row today.
- `mask_flags` is `not null default '{}'` so `= '{}'` and `array_length` are
  safe everywhere and nothing has to spell `coalesce(mask_flags, '{}')`.

### 3.1 Verification — 13 scenarios on a throwaway Postgres 14

Cluster built with the recipe in the brief: `initdb`, port 55703, the Supabase
stub schema (auth schema, `auth.uid()`, the three roles), then
`multi_org_tenancy.sql`, then a fixture with one workspace, one product and two
photos.

| # | Scenario | Result |
|---|---|---|
| S1 | apply on a tenancy database | exit 0 |
| S2 | the 8 columns land with the right types/nullability | 8 rows; `mask_flags` `NOT NULL DEFAULT '{}'::text[]` |
| S3 | pre-existing rows untouched | `never_processed = total = 2`; `mask_flags = {}` |
| S4 | CHECK rejects `'pending'`, `''`, `'Review'` | 23514 on all three |
| S5 | CHECK accepts all six statuses **and** NULL | all accepted |
| S6 | `mask_flags = null` refused | 23502 |
| S7 | a realistic service write round-trips | `review / 0.600 / {coverage,edge} / replicate:…@f74986db`; `1.000` fits `numeric(4,3)` |
| S8 | the index is partial | `… (product_id) WHERE (mask_status = 'review'::text)` |
| S9 | **re-apply is a no-op and preserves data** | exit 0, 9 skip NOTICEs, row intact, counts still 8/1/1 |
| S10 | a member reads and updates the new columns with **no new policy** | sees 2 rows, writes `approved` |
| S11 | an outsider sees nothing and writes nothing | 0 rows visible, 0 written, value unchanged |
| S12 | ROLLBACK, and rollback is re-runnable | 0 columns / 0 constraints / 0 indexes; **both photos survive**; second run exit 0 |
| S13 | re-apply after rollback | 8 columns back, bookkeeping `(all null)`, CHECK in force again |

**One harness finding, not a migration finding.** S10/S11 initially showed an
outsider reading and writing freely. The cause is that `multi_org_tenancy.sql`
runs `enable row level security` on only the three *org* tables — the five data
tables already had RLS on in production (from the original `create_*` migrations
/ `shared_workspace_rls.sql`), so the tenancy file only **swaps their policies**.
A cluster bootstrapped from the migrations alone therefore has org policies that
are present but **inert**. The fixture now enables it explicitly and both
scenarios pass. Worth knowing if anyone ever rebuilds a database from
`supabase/migrations/` alone; it is pre-existing and out of scope here.

CI's migration-hygiene grep passes (`ROLLBACK` + `idempotent`/`if not exists`).

**The rollback destroys bookkeeping, not pixels**, and the file says so with a
snapshot query: cutouts and composites already in the bucket survive, but the
only record of which file belongs to which photo — and which ones a human
approved — is in these columns.

---

## 4. The service

### 4.1 Shape

```
app/config.py      env, and the startup refusals
app/preset.py      BackgroundPreset + the cross-language presetHash
app/compose.py     deterministic geometry + encoders (the only EXIF handling)
app/score.py       the five review heuristics
app/auth.py        THE SECURITY BOUNDARY
app/storage.py     download / upload / reference-counted delete / row PATCH
app/pipeline.py    one image, seven ordered steps
app/jobs.py        in-memory registry, per-org lock, CONCURRENCY semaphore
app/main.py        four endpoints
app/cli.py         the offline fallback
app/backends/      base.py (Matter + guided filter), replicate.py, local.py
```

Runtime deps: fastapi, uvicorn, httpx, pillow, numpy, opencv-python-headless.
`torch`/`transformers`/`timm` are the optional `[local]` extra and the Dockerfile
does not install them (~2.5 GB).

### 4.2 The security boundary

The service holds the service role, so RLS is suspended for the duration of a
request and `app/auth.py` is the whole guarantee. Two steps, neither optional:

1. **Who is calling** — `GET {SUPABASE_URL}/auth/v1/user` with the anon key as
   `apikey`. The JWT is never decoded locally. **This is the trap audit 05 found
   in the Edge Functions (AGENTS.md §9): the anon key is a validly signed project
   JWT and is printed in the browser bundle**, so any check of the form "is this
   a well-formed project token" admits the internet. `/auth/v1/user` returns no
   user for it → 401. `test_auth.py` asserts that case by name.
2. **What may they touch** — every requested row read with the service role,
   joined to `products.org_id`, and that org must be one the caller belongs to.

**403 is for the whole request, never a filtered subset.** A partial success is
indistinguishable from a success client-side, so a bug that sent the wrong ids
would look like "matting sometimes skips photos" for months. An unknown id is
also 403, not 404 — a 404 would be an existence oracle over the uuid space.

A job spanning two workspaces the caller belongs to is also refused: a job is
serialised per org, so it would have no single queue to sit in.

### 4.3 The ordering rules in `pipeline.py`

Seven steps, and three of the orderings are load-bearing:

- **master before composite** — the alpha is the expensive artifact; dying
  between them costs one re-mat, whereas the reverse leaves a composite whose
  alpha was never saved.
- **row UPDATE after both uploads** — the row is the only thing anyone reads; a
  row that points at a file is a promise the file exists.
- **cleanup after the commit** — until the row points at the new files, the old
  ones are still the live catalog images.

**Failure is a row state, not an exception.** Anything that throws becomes
`mask_status='failed'` + `mask_flags=['error:<reason>']` and the job continues. A
400-photo batch must not stop on one corrupt JPEG.

`0 rows updated` from a PATCH is treated as a **failure**, the same lesson
`updateProduct` learned (AGENTS.md §8).

### 4.4 Immutability and shared files

Derived files are always NEW paths beside the source, so the
immutable-per-`storage_path` promise `public/sw.js` relies on (AGENTS.md §18 #35)
holds and **nothing here needs `invalidateImageUrl`** — this pipeline
deliberately does not join Step 3's crop in overwriting bytes in place.
`storage_path`, `image_url` and `position` are never in a patch.

Superseded cutouts/composites are deleted only after the row is updated and only
when no other `product_images` row references the path — duplicated batches share
files (AGENTS.md §18 #15). Every lookup **fails safe**: any error, any doubt, the
file stays. A leaked file costs fractions of a cent; a wrongly deleted one is a
hole in a catalog.

### 4.5 The preset hash

`sha1` over a canonical JSON of the six *visual* fields, first 8 hex. `id` is
**not** hashed — the hash identifies a look, not a preset row, so renaming a
preset must not invalidate thousands of composites. `padding` is serialised at
3 decimals with trailing zeros stripped rather than by the language's float
repr, so a slider emitting `0.10000000000000003` cannot mint a second hash for a
look nobody can distinguish.

Three fixed vectors are in CONTRACT.md §4.2 and asserted on both sides:

| Preset | Hash |
|---|---|
| all defaults (or `{}`, or omitted) | `7abc910f` |
| `{canvas:1536,color:"#f4f4f4",padding:0.08,anchor:"top",shadow:true,quality:85}` | `c7e0869c` |
| `{padding:0.100}` | `7abc910f` (identical to the first) |

If the two sides ever disagree, every composite looks stale forever and the app
re-mats the whole catalog — at ~$0.0017 an image on a 4,854-file bucket, a real
bill for a rounding bug.

### 4.6 Scoring

Five heuristics, described in README "Scoring". The design point: **be wrong in
one direction.** A false `review` costs a glance; a false `auto` ships a jacket
with half a sleeve missing. They are shapes a correct clothing cutout does not
have, not a model confidence — the one number BiRefNet could give is highest
exactly on the worst failure (a mask that confidently cuts out the mannequin
stand).

Two judgement calls:

- **The top edge is exempt when `anchor: "top"`.** That is the hanging-garment
  case and the hook legitimately leaves the frame.
- **`contrast` is advisory** (`MATTING_ADVISORY_FLAGS`). It describes a difficult
  *photograph* — a white tee on a white wall — not a wrong answer, and BiRefNet
  handles most of them. It still lowers `mask_score`, so it still sorts the queue.

`mask_score = 1 - flags/5` is a **sort key, not a gate**; nothing branches on it,
because a number merging five unrelated failure modes has no meaningful
threshold.

### 4.7 Pinning the model

The service **refuses to start** with `MATTING_BACKEND=replicate` and no
`REPLICATE_VERSION` unless `MATTING_ENV=dev`. An unpinned model changes weights
without notice, and a catalog whose cutouts are half old-model and half new is
worse than one with none — you cannot tell by looking which half to redo. The
startup log prints Replicate's current latest so re-pinning is a copy-paste, and
**never adopts it**: a service that pins itself to "latest at boot" re-pins every
restart, which is the unpinned problem with extra steps.

---

## 5. What the Replicate model actually takes (verified)

From `replicate.com/men1scus/birefnet/api/schema`, read September 2026:

```
input.image       string, format uri, REQUIRED   "Input image"
input.resolution  string, default ""             "Resolution in WxH format, e.g., '1024x1024'"
output            string, format uri
```

Two things that would have been silent bugs:

- **`resolution` is a STRING `"WxH"`, not an integer.** The contract's `/rerun`
  takes `1024 | 2048`; the translation happens in the backend.
- **`output` is one URL, not a list.** `_first_url` accepts a string, a list or a
  dict anyway, because other BiRefNet packagings differ.

The model returns a cut-out **RGBA PNG**, so alpha comes from its alpha channel.
A greyscale return is handled too — one `if`, and without it every photo would
composite as a **black rectangle** (an RGB decode has no alpha, so everything
reads as opaque).

Latest version at time of writing: `f74986db0355b58403ed20963af156525e2891ea3c2d499bfbfb2a28cd87c5d7`
(pinned in `fly.toml.example`).

**No call was made to the Replicate API** — it needs a token, and the
unauthenticated `GET /v1/models/...` returns 401. The schema and version came
from the public model pages.

---

## 6. Verification

### 6.1 `python -m pytest -q` → **157 passed**

| File | n | Covers |
|---|---:|---|
| `test_preset_hash.py` | 31 | the three vectors, float-noise collapse, colour case, `id` excluded, every visual field changing the hash, 16 invalid presets |
| `test_compose.py` | 28 | the worked 1000×400 → 2048 example by hand, the fits-inside-padding property, both anchors incl. the garment-alignment argument, aspect preservation, premultiplied blending, shadow off by default, determinism, lossless alpha round trip, EXIF applied exactly once |
| `test_score.py` | 24 | each flag firing **and not firing**, the hanger exemption (and that it does not excuse the other three edges), speckle ≠ fragments, contrast advisory, every flag reachable, the scorer never raising |
| `test_auth.py` | 23 | 401 for the anon key by name, "could not check ≠ allowed", 403 for foreign/unknown/no-workspace/cross-org, the anon-vs-service key split, column projection, `in.()` quoting, 100-id chunking |
| `test_backend_replicate.py` | 34 | the polling loop, failed/canceled/timeout, a transient 502 not failing the image, RGBA **and** greyscale outputs, the verified input key and `"WxH"` string, the pin in the tag, data-URI fallback, guided-filter behaviour |
| `test_pipeline.py` | 17 | the skip/force rule incl. "a human decision is never re-matted", derived-path naming, the source path never reused |

**No test touches the network** — Replicate and Supabase are both behind
`httpx.MockTransport`. A test that could reach Replicate spends money on every CI
run; one that could reach Supabase can write to the real `product_images`.

Verified to pass from three working directories (repo root as CI runs it, the
service directory, and an absolute path from `/tmp`) — the first of those found a
real packaging bug, below.

### 6.2 End-to-end dry run

A scratchpad script drove a whole 5-image job through the real code path
(`authorize` → `mark_queued` → `JobRegistry` → `process_image`) with every HTTP
call mocked, using synthetic photos built to trip specific heuristics:

```
authorize -> rows=5 ; mark_queued -> 5 rows 'queued' BEFORE any work
job -> {"status":"done","total":5,"done":5,"failed":0,"review":3,"auto":2}

 image  status   score  flags
  dd01  auto     1.0    []
  dd02  auto     1.0    []
  dd03  review   0.8    ['edge']                            (garment runs off the bottom)
  dd04  review   0.6    ['coverage', 'edge']                (mask failed open)
  dd05  review   0.4    ['fragments', 'soft', 'contrast']   (five separate blobs)

uploads: 5 × cut-replicate_men1scus_birefnet_f74986db-<ms>.webp  (0.9-3.9 KB)
         5 × bg-7abc910f-<ms>.jpg                                (56-83 KB)
cleanup: ['…/cut-old-1.webp', '…/bg-old-1.jpg']   — only the one row that had previous files
```

The row patch carries exactly the eight columns and nothing else — no
`storage_path`, no `image_url`, no `position`.

### 6.3 Other gates

- `ruff check .` → **All checks passed** (ruff was run via `uvx`; it is **not**
  added to the repo).
- `pip install -e 'services/matting[test]'` verified in a clean venv, which is
  the exact command CI runs.
- Node gates are untouched by construction: this pass modified no `src/` file and
  no Node config. (`vitest` / `npm run build` / `eslint` were not re-run — a
  parallel agent was editing `src/` throughout, so any number here would have
  described their in-flight tree, not this work.)

### 6.4 Two real bugs found by the tests

- **`bearer_token("Bearer ")` returned the literal string `"Bearer"`** instead of
  refusing. The prefix strip ran after `.strip()`, so the trailing space it was
  matching on was already gone. It would have been rejected upstream anyway, but
  as a confusing round trip instead of an immediate 401. Fixed, plus the scheme
  prefix is now only stripped when a separator follows it, so a token beginning
  with the letters "bearer" is not silently truncated.
- **The guided filter's radius was a fixed 8 and silently stopped working at
  high resolution.** Measured on a step edge: bicubic upsampling 64→512 leaves a
  6-pixel transition, radius 8 leaves it at **6** (no improvement at all) and
  radius 16 collapses it to **0**. A filter fits a local linear model over a
  (2r+1)² window, so it can only pull an edge back inside that window. `radius`
  is now `refine_radius()` = `2 × upsample factor`, floored at 8 and capped at
  32, with the limit pinned by a test so that raising the model's working
  resolution without raising the radius fails rather than quietly stops helping.

### 6.5 One real packaging bug found by running CI's own command

`from tests.conftest import ...` resolved only when pytest was invoked from
inside `services/matting`. CI runs `pytest services/matting` **from the repo
root**, where it failed with `ModuleNotFoundError: No module named 'tests'`.
Fixed with `tests/__init__.py` (excluded from the wheel by
`packages.find.include = ["app*"]`). This is the reason the suite is now verified
from three working directories rather than one.

---

## 7. What is NOT built, and what is unverified

**Not built**

- **The app half is not mine.** `src/lib/backgroundService.ts` and the review UI
  were built in parallel against CONTRACT.md.
- **No CSP change.** `index.html` must gain `https://matting.arcadian.ltd` in
  `connect-src` before the app can call this. A blocked subresource fails with
  **no visible error** (AGENTS.md §18 #25), so forgetting it looks like the
  feature silently not working.
- **No shadow tuning.** `shadow` is implemented (blurred alpha, σ = 1.5% of
  canvas, 1% down, 18% opacity) and **off by default**. It is the one part of the
  composite that is taste rather than correctness, and a marketplace that
  requires pure white will reject a grey smudge.
- **No durable job queue.** The registry is in memory; a restart costs a progress
  bar, not work (the rows stay `queued` and a resubmit picks them up). The trade
  is written into `app/jobs.py` so the day it stops being the right size is a
  decision, not a discovery.
- **No bulk "re-render every composite at the new preset" endpoint.** It is
  `POST /v1/jobs` with the new preset and the batch's ids — the skip rule already
  makes it free of matting calls — but there is no single call for "the whole
  workspace".
- **No automatic retry of `failed` rows.** Resubmitting is the retry, by design.

**Unverified**

- **The `local` backend has never been run against real weights.** It is written,
  import-guarded and reachable, but BiRefNet's checkpoints are >1 GB and were
  deliberately not downloaded. Treat `MATTING_BACKEND=local` as untested code
  until someone runs the CLI against it once.
- **No Docker build.** Docker is not running on this machine. The Dockerfile is
  written and reviewed but not built, so the base-image package list
  (`libglib2.0-0`) and the venv copy are unproven.
- **No real Replicate call.** No token was used and none should be — the schema
  and the version id came from the public model pages, and the polling loop is
  verified against a fake transport only. **The first real call is the first
  thing to try after deploying**, and the things most likely to be wrong there
  are the ones a mock cannot check: whether a cold container exceeds
  `REPLICATE_TIMEOUT_SECONDS` (180 s), and whether the public bucket URL is
  actually fetchable from Replicate's side (there is a data-URI fallback if not).
- **No real photo has been through the pipeline.** Every alpha in the tests is
  synthetic. The scoring thresholds are reasoned, not calibrated — run
  `python -m app.cli` over a hundred real photos and read the flag column before
  trusting the `auto` / `review` split. That is what the CLI is for.
- **Costs are an order of magnitude, not a quote.** ~$0.0017/image is Replicate's
  published rate for this model at time of writing.

---

## 8. Licences

Every runtime dependency is permissive: FastAPI (MIT), Uvicorn (BSD-3), httpx
(BSD-3), Pillow (HPND), NumPy (BSD-3), OpenCV (Apache-2.0), **BiRefNet code and
weights (MIT)**. The `[local]` extra adds torch/torchvision (BSD-3) and
transformers/timm (Apache-2.0).

**Two things the founder should know.**

1. **BiRefNet's weights are MIT, but the DIS5K dataset it was trained on carries
   its own terms**, published as a PDF by the dataset authors rather than as a
   standard licence. That is a question about training data, not about running
   inference on a permissively licensed checkpoint — but it is a call to make
   deliberately before this is commercial, and not one a service file can make.
2. **BRIA RMBG was excluded on purpose.** It is the obvious alternative and often
   cuts clothing slightly better, but it is **CC BY-NC** — non-commercial. A
   reseller's catalog is the definition of commercial use.

---

## 9. To turn it on

1. Run `supabase/migrations/image_backgrounds.sql` in the SQL Editor (after
   `multi_org_tenancy.sql`).
2. `fly secrets set SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… SUPABASE_ANON_KEY=… REPLICATE_API_TOKEN=…`
   — **none of these may ever be given a `VITE_` name** (AGENTS.md §4; CI greps
   `dist/` for `service_role`-shaped strings for exactly this reason).
3. `cp fly.toml.example fly.toml`, set `app`, `fly deploy`, `fly certs add matting.arcadian.ltd`.
4. Add `https://matting.arcadian.ltd` to `connect-src` in `index.html`'s CSP.
5. Mat one listing and look at it. Then a hundred, and tune `SCORE_*`.

---

## Rollout log (Sept 20 2026)

- Deployed with `FLY_APP=sortbot FLY_REGION=sjc ./deploy.sh`. The Fly token the founder minted was a
  DEPLOY token scoped to an app named `sortbot` that a `fly launch` had just created (two `goStatic`
  machines in `ams`, no public IP, nothing the business used); those machines were destroyed and the
  service deployed into that app in `sjc` next to the Supabase project. A deploy token cannot create
  apps, which is why `deploy.sh` now creates the app only when `fly status` cannot find it.
- Model pinned at `men1scus/birefnet@f74986db…`; secrets set (`--stage`); two shared-cpu-1x / 1 GB
  machines, auto-stop; Fly's HTTP check on `/healthz` passing with
  `{"ok":true,"backend":"replicate","model":"replicate:men1scus/birefnet@f74986db"}`; the startup
  call to Replicate's model endpoint returned 200 (token valid).
- The app had NO public IPs (the interrupted launch never allocated any): allocated a shared v4
  `66.241.124.148` and a dedicated v6 `2a09:8280:1::195:70d4:0`. `/healthz` verified 200 at the IP
  with SNI. Certificate for `matting.arcadian.ltd` requested; **pending the founder's DNS records**
  (A + AAAA to those IPs, or `CNAME → pe9qqe6.sortbot.fly.dev`).
- GitHub secret `VITE_MATTING_URL=https://matting.arcadian.ltd` set; the Pages build inlines it.
  Until DNS resolves the origin is unreachable, and until `image_backgrounds.sql` runs the column
  probe keeps the feature hidden anyway — so the order of the two remaining founder steps does not
  matter.
- Not yet done: `image_backgrounds.sql` in the SQL Editor (production SQL is not reachable from this
  session), the DNS records, and the first real photo.

