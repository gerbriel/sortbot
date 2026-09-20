# Arcadian matting service

Cuts the background out of a product photo and puts the garment on a flat
canvas, so a batch of forty listings looks like forty photos taken the same way.

It is a small self-hosted FastAPI service. It is **not** part of the Vite app and
nothing in `src/` imports it — the app talks to it over HTTP, and the interface
is [`CONTRACT.md`](./CONTRACT.md).

---

## The two ideas worth knowing before reading the code

**1. The matting backend is an interface; everything else is arithmetic.**
Matting is the one part that is a model, costs money, and will be replaced.
`replicate` (BiRefNet hosted, ~$0.0017/image) is the default; `local` (BiRefNet
in-process) is one env var away. Everything above it — the compositor, the
scorer, the storage layout, the database columns, the HTTP contract, and every
line of the app — is written against the four-line `Matter` protocol in
`app/backends/base.py`. `product_images.mask_model` records which backend cut a
given photo, so a backend change is answerable after the fact rather than a
silent fork in the catalog.

**2. Compositing is deterministic, never generative.** Same source, same alpha,
same preset → the same pixels on every machine, forever. A generative "replace
the background" pass makes every photo slightly different, and a catalog page of
forty garments on forty subtly different whites looks broken in a way nobody can
point at. It also means changing a preset is a cheap re-render from the stored
alpha master, not another matting bill.

Which is why **the alpha master is the durable asset**. The cutout (`cut-*.webp`,
lossless alpha) is what a matting call bought; the composite (`bg-*.jpg`) is
arithmetic. Keep the first, throw away the second whenever the look changes.

---

## Quick start

```bash
cd services/matting
python3.12 -m venv .venv && . .venv/bin/activate
pip install -e '.[test]'
python -m pytest -q                      # 157 tests, no network

export SUPABASE_URL=https://<project>.supabase.co
export SUPABASE_SERVICE_ROLE_KEY=...      # server-only, see "Secrets"
export SUPABASE_ANON_KEY=...
export REPLICATE_API_TOKEN=r8_...
export REPLICATE_VERSION=f74986db0355b58403ed20963af156525e2891ea3c2d499bfbfb2a28cd87c5d7
uvicorn app.main:app --reload --port 8080
```

`GET /healthz` should answer
`{"ok":true,"backend":"replicate","model":"replicate:men1scus/birefnet@f74986db"}`.

**Prerequisite:** run `supabase/migrations/image_backgrounds.sql`. Until it has
run, every write fails on a missing column.

---

## Configuration

| Variable | Default | Notes |
|---|---|---|
| `SUPABASE_URL` | — | **required** |
| `SUPABASE_SERVICE_ROLE_KEY` | — | **required.** Bypasses RLS — see "Secrets" |
| `SUPABASE_ANON_KEY` | — | **required.** The `apikey` for `/auth/v1/user` |
| `BUCKET` | `product-images` | |
| `MATTING_BACKEND` | `replicate` | or `local` |
| `REPLICATE_API_TOKEN` | — | required for the replicate backend |
| `REPLICATE_MODEL` | `men1scus/birefnet` | |
| `REPLICATE_VERSION` | — | **required in production** — see below |
| `REPLICATE_INPUT_KEY` | `image` | verified against the published schema |
| `REPLICATE_RESOLUTION_KEY` | `resolution` | takes `"WxH"`, a string |
| `LOCAL_MODEL` / `LOCAL_HR_MODEL` | `ZhengPeng7/BiRefNet` / `…_HR` | |
| `MATTING_ENV` | `production` | `dev` relaxes the version pin |
| `ALLOWED_ORIGINS` | `https://arcadian.ltd,http://localhost:5173` | never `*` |
| `CONCURRENCY` | `4` | images in flight per job |
| `MAX_IDS_PER_JOB` | `2000` | |
| `MAX_BODY_BYTES` | `262144` | |
| `SCORE_*` | see below | review thresholds |
| `MATTING_ADVISORY_FLAGS` | `contrast` | flags that do **not** force review |

### Why `REPLICATE_VERSION` is mandatory

An unpinned model changes weights without notice. Two photos of the same jacket
matted a week apart would then be cut by different models, and a catalog whose
cutouts are inconsistent is worse than one with no cutouts — you cannot tell by
looking which half needs redoing. The service refuses to start unpinned unless
`MATTING_ENV=dev`, logs Replicate's current latest at startup so re-pinning is a
copy-paste, and **never adopts it automatically** (a service that pins itself to
"whatever is latest at boot" re-pins every restart — the unpinned problem with
extra steps).

Because `mask_model` carries the pin, "re-run everything the old model touched"
is a query rather than a guess.

---

## Secrets

`SUPABASE_SERVICE_ROLE_KEY` and `REPLICATE_API_TOKEN` are **server-side only**.

They must never be given a `VITE_` name. Every `VITE_*` variable is inlined into
the public browser bundle (AGENTS.md §4), and CI greps `dist/` for
`service_role`-shaped strings precisely because that is the one mistake that
cannot be walked back once deployed. There are exactly three `VITE_*` variables
in this product and none of them belongs to this service.

The service role **bypasses RLS entirely**. The only thing between "matte these
ten photos" and "matte any ten photos in the product" is `app/auth.py` — read it
as the policy it replaces. `tests/test_auth.py` is the automated statement of
what it refuses.

---

## Scoring, and how to tune it

Five heuristics decide whether a human needs to look. Each describes a *shape* a
correct clothing cutout does not have; none of them is a model confidence,
because the one number BiRefNet could give is highest exactly on the failure
that matters most (a mask that confidently cuts out the mannequin's stand).

The point is not to be right — it is to be **wrong in one direction**. A false
`review` costs one glance; a false `auto` ships a jacket with half a sleeve
missing to a marketplace. Every threshold flags generously and every one is an
env var, because the right number depends on how a shop photographs.

| Flag | Fires when | Env |
|---|---|---|
| `coverage` | subject <12% or >90% of the frame | `SCORE_COVERAGE_MIN` / `_MAX` |
| `edge` | >1.5% of the left/right/bottom border is subject | `SCORE_EDGE_FRACTION` |
| `fragments` | >3 blobs, each >0.5% of the subject, at 256 px | `SCORE_FRAGMENTS_MAX`, `SCORE_FRAGMENT_MIN_AREA` |
| `soft` | >25% of the subject is between 0.2 and 0.8 alpha | `SCORE_SOFT_BAND_MAX` |
| `contrast` | the soft rim and the photo's own backdrop are within 12 CIELAB | `SCORE_CONTRAST_MIN_LAB` |

The **top edge is exempt when `anchor: "top"`** — a hanging garment's hook
legitimately leaves the frame. `contrast` is **advisory**: it describes a hard
photograph, not a wrong answer, and it is recorded so a reviewer knows why a
photo was hard.

`mask_score = 1 - flags/5` is a **sort key for the review queue, not a gate**.
Nothing branches on it, deliberately: a single number merging five unrelated
failure modes has no threshold that means anything.

The cheapest way to tune is the CLI below — run a hundred photos, read the flag
column, move the numbers, run again, without touching production.

---

## Offline CLI

```bash
python -m app.cli --backend local --preset preset.json --in ./photos --out ./out
```

Writes `cut-*.webp` and `bg-<hash>-*.jpg` per input and prints the status, score
and flags each photo would have got. It calls the **same** compose, score and
backend code, so a composite produced here is byte-identical to one the service
would produce for the same preset and alpha.

It exists because the founder's work is not allowed to stop because a service is
down, a card expired, or Replicate is having an afternoon. It needs no Supabase
at all.

---

## Deploying

**Fastest path:** `REPLICATE_API_TOKEN=… SUPABASE_SERVICE_ROLE_KEY=… ./deploy.sh` (after `fly auth login`). It pins the model version, sets every secret, deploys, and requests the certificate for `matting.arcadian.ltd`; re-running is safe. The manual steps below are what it does.


The container is one stateless process with four secrets and a health check, so
any Docker host works. `fly.toml.example` is a worked Fly config with
scale-to-zero (`min_machines_running = 0`) — the founder mats a batch and then
does not touch it for days, and a cold start of ~2 s hides entirely behind
Replicate's own container boot.

```bash
docker build -t arcadian-matting services/matting
docker run --rm -p 8080:8080 \
  -e SUPABASE_URL=... -e SUPABASE_SERVICE_ROLE_KEY=... -e SUPABASE_ANON_KEY=... \
  -e REPLICATE_API_TOKEN=... -e REPLICATE_VERSION=f74986db... \
  arcadian-matting
```

Then point `matting.arcadian.ltd` at it and add **exactly that origin** to
`connect-src` in `index.html`'s CSP. A blocked subresource fails with no visible
error (AGENTS.md §18 #25), so forgetting this looks like the feature silently
not working.

**One uvicorn worker, deliberately.** The job registry and the per-workspace
lock are in-process, so two workers would be two registries — a job started on
one is a 404 on the other. Concurrency comes from asyncio (`CONCURRENCY`), which
is the right shape anyway: this service is almost entirely waiting on network.

### The `local` backend

```bash
pip install -e '.[local]'
MATTING_BACKEND=local uvicorn app.main:app
```

Needs **≥ 8 GB RAM at 1024² and ≥ 16 GB at 2048²** on CPU, and a pass is ~15 s an
image against ~2 s hosted (MPS on an M-series Mac is ~1 s, which is why the
device probe has an MPS branch). The Dockerfile does **not** install it by
default — it is ~2.5 GB of wheels. Resize the machine *before* switching:
it will not OOM gracefully, it will be killed mid-batch and leave rows `queued`.

---

## Cost

At the default backend, one image ≈ **$0.0017** (Replicate's published rate for
this model at the time of writing; treat it as an order of magnitude, not a
quote). A 400-photo batch is roughly **$0.70**, and the whole existing 4,854-file
bucket would be about **$8**.

A preset change costs **nothing** — the composite is re-derived from the stored
alpha master with no matting call. That is the single most important cost
property of the design and the reason the cutout is kept.

The `local` backend is $0 per image and a fixed machine cost instead; on a
scale-to-zero host the hosted backend is cheaper until roughly a few thousand
images a month.

---

## Licences

Every runtime dependency is permissive. No copyleft, no NC clause, nothing that
restricts commercial resale listings.

| Component | Licence |
|---|---|
| FastAPI | MIT |
| Uvicorn | BSD-3-Clause |
| httpx | BSD-3-Clause |
| Pillow | HPND (MIT-like) |
| NumPy | BSD-3-Clause |
| OpenCV (`opencv-python-headless`) | Apache-2.0 |
| **BiRefNet** (code and weights) | **MIT** |
| pytest / pytest-asyncio *(test only)* | MIT |
| torch / torchvision *(`[local]` extra)* | BSD-3-Clause |
| transformers / timm *(`[local]` extra)* | Apache-2.0 |

**Two things to be aware of.**

1. **BiRefNet's code and weights are MIT, but the DIS5K dataset it was trained on
   carries its own terms**, published as a PDF by the dataset authors rather than
   as a standard licence. That is a question about training data, not about
   running inference on a permissively licensed checkpoint — but it is the
   founder's call to read it before this goes commercial, and it is not one this
   file can make. See the BiRefNet repository's dataset links.

2. **BRIA RMBG was excluded on purpose.** It is the obvious alternative and it
   often cuts clothing slightly better, but it is **CC BY-NC** — non-commercial.
   A reseller's catalog is the definition of commercial use. Do not swap it in
   without buying BRIA's commercial licence, and if you do, put the licence
   reference next to `REPLICATE_MODEL` so the next person knows why it is there.

The guided filter in `app/backends/base.py` is an implementation of He, Sun and
Tang (2010) written against the base OpenCV API rather than a dependency on
`opencv-contrib` — see the docstring for why.

---

## Tests

```bash
python -m pytest -q          # 157 tests
```

**No test touches the network.** The Replicate backend is driven through an
`httpx.MockTransport` and so is the auth boundary — a test that could reach
Replicate is a test that spends money on every CI run, and a test that could
reach Supabase is a test that can write to the real `product_images` table.

CI runs them in the `matting` job of `.github/workflows/ci.yml`.
