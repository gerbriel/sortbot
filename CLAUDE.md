# CLAUDE.md — Acadia Codebase Reference

> **For any AI agent reading this file:**
> 1. Read this file **in full** before writing any code.
> 2. After every task, report: what files were modified, what moved from in-progress to done, and what new gaps were introduced.
> 3. Check this file before assuming any type, utility, or component doesn't exist — it probably does.
> 4. Ask before adding any new dependency.
> 5. Ask before running any Supabase migration SQL. Several migration files in `supabase/migrations/` are **dangerous** (they modify RLS policies or drop constraints). Never run them without explicit user approval.

---

## 1. Project Identity

Acadia is a web app for vintage clothing resellers. Users upload batches of clothing photos (individual files, folders, or ZIPs), group multi-angle photos of the same item together, assign categories, record a voice description per listing, and generate AI-powered Shopify-ready product listings. The final output is a CSV export formatted for Shopify product import. The app persists work-in-progress to Supabase (workflow_batches table) so sessions survive page reloads and can be reopened from a Library modal. It is designed as a shared workspace — all authenticated users currently see all batches and images in the Library, controlled via Supabase RLS.

### Naming — "Acadia" is the brand, "sortbot" is the plumbing (September 2026)

The product was renamed from **Sortbot** to **Arcatya** (July 2026) and then to **Acadia**
(September 2026). Both times only user-visible text changed.
These deliberately still say `sortbot`, and renaming them is a breaking change:

| Identifier | Where | Why it must not change |
|---|---|---|
| `/sortbot/` base path | `vite.config.ts`, `main.tsx` (SW registration) | Derived from the GitHub repo name `gerbriel/sortbot`. Changing it 404s every asset on the deployed site unless the repo is renamed first. |
| `sortbot_current_batch_id`, `sortbot_current_batch_number` | `App.tsx` | Renaming drops every user's in-progress batch on next load. |
| `sortbot_workflow_backup` | `lib/workflowBackup.ts` (`WORKFLOW_BACKUP_KEY`), read by `App.tsx` | The synchronous crash backup. The key moved into the module that owns the throttled write (Sept 2026) — same string, one definition. |
| `sortbot_deleted_batch_ids` | `workflowBatchService.ts` | The delete tombstone registry — losing it resurrects deleted batches (see §15). |
| `sortbot_compressed_paths` | `ImageUpload.tsx` | The "already compressed" set for all 4,854 storage files. Losing it re-compresses the entire bucket. |
| `sortbot_debug_enabled`, `window.__SORTBOT_DEBUG__` | `debugLogger.ts` | Debug toggle state + the global guard. |
| `sortbot_orphan_cleanup_v3` | **nothing reads it any more** | The one-shot cleanup effect it guarded was DELETED in the Sept 2026 debugging pass (three unscoped `delete().like('storage_path', …)` statements that under org RLS could reach another workspace's rows). The key is left behind in every existing browser, unread. Do not re-add the effect (§18 #19). |
| `sortbot_analytics_session` (sessionStorage), `sortbot_analytics_force` (localStorage) | `analytics.ts` (`SESSION_KEY` / `FORCE_KEY`) | Per-tab analytics session id (losing it just starts a new session) + the dev-only "track on localhost" override. `errorReporter.ts` imports both, so an error row and an analytics row share one session id and the same localhost override. |
| `sortbot_magnifier_settings` | `ProductDescriptionGenerator.tsx` | Step 3 magnifier lens size/zoom preference. Cosmetic — losing it resets to the defaults. |
| `sortbot_kanban_view` | `KanbanBoard.tsx` | Last-used board view (`lanes` / `atlas`). Cosmetic. |

If any of these ever *do* get renamed, ship a migration that reads the old key,
writes the new one, and deletes the old — do not just rename the string.

### Design system — light, Uber-inspired (July 2026)

`src/index.css` is the **single source of truth** for color, elevation, and motion.

White canvas, light-grey sections, black nav and black primary actions. Colour is
spent almost entirely on black/white/grey; semantics appear only to signal state.

| Role | Token | Value |
|---|---|---|
| page canvas | `--ink-950` | `#ffffff` |
| subtle bg | `--ink-900` | `#fafafa` |
| **grey sections / cards** | `--ink-850` | `#f3f3f3` |
| modals, popovers | `--ink-800` | `#ffffff` (lifted by shadow) |
| hover | `--ink-750` | `#e9e9e9` |
| pressed / strong fill | `--ink-700` | `#dedede` |
| text | `--text-primary/secondary/muted/faint` | `#000` / `#545454` / `#6b6b6b` / `#8e8e8e` |
| **accent is BLACK** | `--accent` | `#000000` |

**Why solid buttons just work:** every solid-accent fill already sets
`color: var(--ink-950)` (a rule from the dark era, where the accent was light).
`--ink-950` is now white, so black fill + white label falls out for free. Keep that
convention — it is what makes the palette swappable in either direction.

**`--ink-800` is intentionally NOT monotonic.** In a light theme elevation moves
*toward* white, so modals/popovers (`#ffffff`) are lighter than the cards they sit
over (`#f3f3f3`). Do not "correct" the ramp to be strictly ordered.

**The legacy `--gray-*` ramp is back to its ORIGINAL meaning.** It was inverted for
the dark theme; on light it reads normally again — `--gray-50` is the lightest
background, `--gray-600/700` are the darkest text. If the app ever returns to dark,
that ramp must invert again along with everything else.

**Semantics are darkened for a light canvas** — `--success #0a7d43`, `--warning
#8a5a00`, `--danger #b3001b`, `--info #3d3d3d`. The dark-theme values were far too
light to read as text on white. Use the `--*-dim` tints as banner fills.

**THE NAV IS THE ONE DELIBERATELY INVERTED SURFACE.** `.app-header` (App.css) and
`.ld-nav` (Landing.css) are black bars on a white page, so they do **not** take
`--ink-*` tokens and everything inside them sets a literal light foreground. That
includes `.ld-logo`, `.ld-nav-link`, `.ld-nav-cta`, `.ld-nav-login` (the app's only
white button) and the `.app-header` overrides. If you add anything to a nav, give it
an explicit light colour or it will inherit page-black and vanish. The inverse holds for a light POPOVER rendered inside the nav (the account menu, `WorkspaceMenu.css`): it must opt back OUT with higher-specificity rules (`.app-header .wsmenu-menu …`) or its buttons/icons inherit the forced white and vanish on the white surface; and `.button-secondary` hover/focus inside the nav is pinned in App.css because the page-level hover rule (0,3,0) outranks the header rule (Sept 2026 fix).

Because everything else resolves through tokens, **swapping the whole palette is a
~45-line edit in `:root`.** This app has already shipped violet-on-dark, bone-on-dark
and monochrome variants from that one block.

Three colour surfaces are NOT tokens because they are data or stand-ins, and each
must be retuned by hand when the palette changes:
`Landing.tsx` mock garment tiles (inline hex, they stand in for photos),
`DEFAULT_CATEGORIES` in `lib/categories.ts` + the duplicate list in
`initializeDefaultCategories`, and the colour-picker defaults in `CategoriesManager.tsx`.

**Rule for new CSS:** no hardcoded hex outside the nav. Map by *role* (a grey section
is a surface → `--ink-850`; a heading is text → `--text-primary`), and keep body text
at WCAG AA 4.5:1 against its surface — `--text-muted` is for non-essential meta only.

### Type scale — `--fs-*` (July 2026)

The app had drifted to ~60 distinct font-size values app-wide (four inside a single
0.05rem band, mixed `px`/`rem`, `!important` overrides). All of them now snap to one
9-step ramp defined in `index.css`:

| Token | size | use |
|---|---|---|
| `--fs-2xs` | 11px | badges, chips, micro-meta |
| `--fs-xs` | 12px | captions, secondary meta |
| `--fs-sm` | 13px | secondary UI text, dense cells |
| `--fs-base` | 14px | body, buttons, inputs |
| `--fs-md` | 16px | emphasized body, card titles |
| `--fs-lg` | 18px | section headings |
| `--fs-xl` | 22px | step titles |
| `--fs-2xl` | 28px | page headings |
| `--fs-3xl` | 36px | hero |

**The type scale is in px on purpose; spacing/radius stay rem.** The root is pinned at
9px for the rem spacing grid (§16), which meant a rem type scale carried an invisible
×0.5625 and `1rem` rendered as 9px — that inversion is how the app drifted to ~60 sizes,
several under 7px, and why a stray `font-size: 12px` was *larger* than `1rem`. Type is
now absolute and says what it means. Moving spacing to px would reflow every layout, so
it stays rem. Pair sizes with `--lh-tight` / `--lh-snug` / `--lh-normal`.

`body` sets `font-size: var(--fs-base)`. Without it, anything with no explicit size
inherits the 9px root and renders unreadably small — body owns the real text baseline,
`html` only owns the spacing grid.

**Retuning the whole app is a 9-line change.** Every one of the ~560 font-size
declarations resolves through these tokens, so sizing is adjusted here, never per-file.

Applies to inline styles too: `style={{ fontSize: 'var(--fs-sm)' }}`, not a literal.

**TWO DELIBERATE EXCEPTIONS — do not "fix" them:**
1. `html { font-size: 9px }` in `index.css` stays a literal. Tokenizing it is circular.
2. **`Landing.css` stays px-based.** The marketing page is rendered at the main URL for
   logged-out visitors and must not inherit the 9px root, or the hero collapses. A pass
   that converted it to `--fs-*` shrank the nav from 14px to 12.6px and was reverted.
   If Landing ever needs a scale, it needs its own px-based one.

**Icons, not emoji.** Steps 1-4 use `lucide-react` (already a dependency) — no emoji in
rendered UI. Emoji inside `console.log` / `log.*` / `console.table` diagnostics and code
comments are fine and were deliberately left. The `categories.emoji` column is per-workspace
USER DATA, not chrome — never rewrite it. Global `.lucide { flex-shrink: 0;
vertical-align: -0.125em }` keeps SVGs on the text baseline where emoji sat for free.

### Mobile-first standards (Sept 2026)

A three-agent pass made the whole app usable on a phone — the shell, the thirteen
tool views, and the four workflow steps (`docs/reviews/10-mobile-shell.md`,
`10-mobile-pages.md`, `10-mobile-workflow.md`). These are its standing rules.

**Three breakpoints, the same three everywhere.** `<= 640px` phone, `641-1024px`
tablet, `> 1024px` desktop. **Desktop is deliberately unchanged** — every layout rule
the pass added lives inside a media query, so a regression above 1024px is a bug, not
a trade-off. The 640 boundary also exists in JS as `PHONE_BREAKPOINT_PX`
(`src/components/responsiveGrid.ts`); keep the two in step.

**The touch floor is `44px`, and it is written as a literal `px`.** Every other length
in this app is a rem against the 9px root (§16), which is exactly why this one is not:
`0.2rem 0.55rem` of padding is 1.8px x 5px, so hand-rolled controls landed at 16-20px
tall — fine with a mouse, unusable with a thumb. A touch target is a *physical*
constant; a rem value would silently drift off the accessibility floor the next time
the root is retuned, while `44px` cannot. `--tap: 44px` in `index.css` names it, and
`index.css` applies it once at `<= 640px` to `input` (except checkbox/radio/range/color),
`select`, `textarea`, `button` and `.button`. Components restate it only where their
own specificity outranks that global rule. The reasoning is also written into
`ui/Button.css` so it is not "corrected" to a rem later.

**Form controls are `var(--fs-md)` (16px) on phones — never 15px, never a literal.**
Mobile Safari zooms the page when a focused control is under 16px and does not zoom
back out; that is the single most common reason a form "feels broken" on an iPhone.
`--fs-md` IS 16px, so the token is what buys the behaviour. Checkboxes are excluded
(a 44px checkbox is a grey slab — they get 22px square and the wrapping label is the
real target).

**`--tabbar-h` is the ONE bottom offset.** Defined in `index.css` as `0px` and raised
at `<= 640px` **on `.app-container`** (not `:root`, so the shell-less waitlist gate keeps
0 and its support button does not float above a bar that is not there) to
`calc(var(--tabbar-row) + var(--safe-b))`. Every bottom-anchored surface subtracts it
and nothing invents its own number: `.app-main`, `.tool-view`, the toast stack, the
support FAB, Step 2's category dock, Step 3's nav dock, Finance's sticky Save bar. A
short-lived `--app-tabbar-h` spelling was consolidated onto `--tabbar-h`; there is only
the one token (§18 #29).

**Safe areas need `viewport-fit=cover`.** `--safe-t/-b/-l/-r` in `index.css` wrap
`env(safe-area-inset-*)`, which reports `0` unless `index.html`'s viewport meta carries
`viewport-fit=cover`. Any full-bleed sheet, dock or fixed bar pads with the matching
token, or its primary action sits under the home indicator.

**`text-size-adjust: 100%` on `html`.** Chrome on Android "font boosts" text inside wide
blocks. On a 9px root that is not merely ugly: every `--space-*` is a rem tuned to that
root, so boosted type overflows padding that did not grow with it (14px measured
rendering as 22px).

**New CSS is written mobile-first; existing desktop-first files are EXTENDED, not
flipped.** `MobileNav.css` is the one file written the new way — its base rules describe
the phone and `min-width` queries take things away. Everything older describes the
desktop first and adds `max-width` blocks, and rewriting one of those files in the other
direction reflows a layout nobody asked to change. Match the file you are in.

**Never put a token glob, a slash, and another token glob inside a CSS comment.**
`--ink-*` immediately followed by `/--text-*` contains `*/`, which closes the comment
early and silently swallows the next rule — it cost a debugging round in `MobileNav.css`
(the `.nav-rail` rule vanished and the rail rendered at every width). The build does not
warn about the swallowed rule and it is invisible in the source. Write token names out in
full in prose (§18 #30).

**Two specificity traps to know before writing a phone rule.**
1. `ToolView.css` pins every control inside a tool view at (0,5,1) with `--fs-base`
   (14px). No per-component input rule can reach it, so the 16px restatement is written
   as `.tool-view :is(<page roots>) input:not(...)` — `:is()` contributes its most
   specific argument, which buys the extra step without an unreadable selector.
2. **Inline styles beat every media query.** Step 2's grid writes
   `grid-template-columns` inline (it is slider-driven), so its phone layout is not
   expressible in CSS at all — the clamp happens where the value is produced, in
   `responsiveGrid.ts`. Reach for that pattern, not `!important`, which would turn the
   slider into a no-op.

---

## 2. Tech Stack

| Dependency | Version | Role in This App |
|---|---|---|
| `react` | ^19.2.0 | UI framework. `StrictMode` is ON — double-invokes effects in dev. |
| `react-dom` | ^19.2.0 | DOM rendering. |
| `vite` | ^7.2.4 | Build tool + dev server. Base path is `/sortbot/` on GitHub Actions, `/` locally. |
| `typescript` | ~5.9.3 | Type checking. `tsc -b` runs before Vite build. |
| `@supabase/supabase-js` | ^2.93.3 | Auth (email/password), Postgres DB queries, Realtime presence, Storage bucket for images. |
| `lucide-react` | ^0.563.0 | Icon components throughout the UI. |
| `react-dropzone` | ^14.4.0 | Drag-and-drop file upload zone in Step 1. |
| `jszip` | ^3.10.1 | Extract images from ZIP files in ImageUpload. |
| `exifr` | ^7.1.3 | JPEG EXIF parsing. Used in `ImageUpload.tsx` to read `DateTimeOriginal` for shot-time sort order. |
| `tus-js-client` | ^4.3.1 | Resumable uploads to Supabase Storage via the TUS protocol (`src/lib/tusUpload.ts`). 6 MB chunks; survives connection drops mid-file — chosen for large batches (380–1500 images) on slow/rural connections. |
| `vitest` | ^4.1.9 | Test runner (`npm test`). 579 tests / 40 files. Config in `vitest.config.ts`. |
| `happy-dom` | ^20.10.6 | DOM implementation for the tests, incl. the `src/components/ui/` render harness. |
| `eslint` | ^9.39.1 | Linting. Config in `eslint.config.js`, with `eslint-plugin-react-hooks` ^7 (render-purity rules) and `eslint-plugin-react-refresh`. |
| `@vitejs/plugin-react` | ^5.1.1 | Vite plugin enabling React JSX transform and Fast Refresh. |

**No dependency was added or removed by the Sept 2026 engineering review** — `package.json` and `package-lock.json` were untouched. Everything the review built (the store, the UI primitives, the error reporter, the test mock) is dependency-free on purpose (§18 #18 and the user's standing "100% self reliant" rule).

---

## 3. How To Run & Test

```bash
# Install dependencies
npm install

# Start dev server (http://localhost:5173)
npm run dev

# Type-check + production build (output → dist/)
npm run build

# Lint
npm run lint

# Preview production build locally
npm run preview
```

**Required before first run:** Copy `.env.example` to `.env` and fill in the two Supabase variables. Without them the app throws on load.

**Tests:** Vitest (`npm test` to run once, `npm run test:watch` for watch mode). Config in `vitest.config.ts` (happy-dom environment; dummy Supabase env vars injected because `src/lib/supabase.ts` throws at import without them — tests never hit the network). Test files live next to their sources as `src/**/*.test.ts(x)`. **579 tests across 40 files, all green (Sept 2026)** — up from 305/24 before the engineering review. They are characterization tests: they lock in behavior the workflow depends on, so a failure means "you changed the contract", not "the assertion is picky".

Coverage by area:
- **Listing engine** — `textAIService.test.ts` (34: size normalization incl. fits-like, voice command extraction, ✠ description lines, title length/letter-size/no-compounding rules, golden snapshot of a full description with `Math.random` mocked), `applyPresetToGroup.test.ts` (17: preset priority hierarchy, force-mode, SEO template interpolation, and `resolvePreset`'s four match steps incl. `allowDefaultPrefix`), `csvExport.test.ts` (30: 54-column header/row shape, handle dedup, taxonomy rules, CSV formula-injection guard, golden two-product CSV), `proseService.test.ts` (5), `grouping.test.ts` (7: leader convention, tolerant resolution, the 42-image/11-group reproduction).
- **Persistence contract** — `slimItems.test.ts` (14: the whitelist field-by-field, `file`/`preview`/`_presetData` proven stripped, the derivable-field rule — `imageUrls`/`thumbnailUrl` omitted when `storagePath` exists — and type-level assertions that both a slim item and a legacy whole `ClothingItem` satisfy `PersistedWorkflowItem`), `workflowBatchService.test.ts` (30: delete tombstones + the 200 cap, `fetchWorkflowBatches` pagination and "never `select(*)`", the chunked lookups, the ordered delete sequence, and `removeItemsFromWorkflowBatch`'s compare-and-set), `productRow.test.ts` (39: both DB-row→item builders and the seven documented divergences between the two restore merges), `productService.test.ts` (25: "0 rows is a failure, not a success", the leader-keyed group write, the batched `product_images` upsert, keepalive flush, price `null` vs `0`), `imageRowSync.test.ts` (14: row shape + the six `mergeProductImageRows` merge rules), `libraryData.test.ts` (12), `libraryService.test.ts` (3: `duplicateBatch` copies `processedItems`), `workflowBackup.test.ts` (12: the 1 s trailing throttle, flush, cancel, quota warning), `workflowStore.test.ts` (8), `storageUrls.test.ts` (6), `chunk.test.ts` (7: the 0/1/99/100/101 boundaries every hand-rolled loop used to re-derive), `orgService.test.ts` (4: per-user in-flight dedupe), `tusUpload.test.ts` (2: a 250 ms race that fails loudly if the promise ever hangs again).
- **Memory / platform** — `imageTransforms.test.ts` (12: the byte-budgeted LRU image cache), `mailto.test.ts` (8: every `mailto:` header separator rejected), `errorReporter.test.ts` (27: PII scrubbing, fingerprint stability across a redeploy, dedupe + per-load cap, the availability latch, `app_version` from the entry-chunk hash).
- **Founder tools** — `analytics.test.ts` (9), `crmService.test.ts` (5), `supportService.test.ts` (4), `supportStore.test.ts` (15: the ref-counted ONE channel + ONE poll, `applySentMessage` asserted field-by-field against the `support_after_message` SQL trigger, optimistic-write-then-reconcile for send/markRead/setStatus/startThread, `available: false` NOT stopping the poll, concurrent `refresh()` collapsing to one query, `filterThreads`), `financeService.test.ts` (34: money ↔ cents, ANCHORED month steps, the five range presets, recurrence expansion, P&L totals matching the SQL smoke test row-for-row, both CSV builders incl. the formula guard, validation mirroring every CHECK, summary normalization), `FinanceView.test.tsx` (8: the pre-migration setup hint, the founders-only 42501 message, KPI/chart/table parity, ledger filtering, the recurring-entry preview, both MRR numbers, the CSV download, the printable statement adding up to the server's profit), `kanban/*.test.ts` (95 across atlas/dates/format/rank/status/tree).
- **UI primitives + shells** — `src/components/ui/*.test.tsx` (76: Tabs 13, Dialog 17, ConfirmAction 13, Field 13, controls 20) and `ToolView.test.tsx` (8: the full-page shell's navigation + a11y contract), all driven by `ui/testUtils.tsx` (a `createRoot` + `act` harness, not a test file). `FinanceView.test.tsx` uses the same harness rather than a testing-library dependency.
- **Layout helpers** — `responsiveGrid.test.ts` (9: the Step-2 column clamp — phone bounds 1-3 vs desktop 2-12, the tighter group-card cap, and the rule that the stored slider preference is never mutated, so rotating back to a wide viewport restores the user's density).

`src/lib/testing/supabaseMock.ts` (test-only, imported by no app code) is a chainable `supabase` stand-in that records table/op/filters/payload/`range()` per call and exposes `inSizes()` / `callsFor()` helpers — that is how query **order** and **chunk size** are asserted. Snapshots live in `src/lib/__snapshots__/` — update deliberately with `npx vitest run -u` only when output changes on purpose.

**Deployment:** GitHub Actions deploys to GitHub Pages at `https://gerbriel.github.io/sortbot` on every push to `main` (`.github/workflows/deploy.yml`). `vite.config.ts` detects `process.env.GITHUB_ACTIONS` to set `base: '/sortbot/'`.

**CI (Sept 2026):** `.github/workflows/ci.yml` runs on every pull request and on every push to a non-`main` branch, with `permissions: contents: read` only — it never deploys. Steps: `npm ci` → `npm test` → `npm run build` (with dummy `VITE_*` values) → **verify build output** (`dist/index.html` exists, contains `<title>Acadia</title>`, and its asset URLs are under `/sortbot/` — the base path §1 forbids changing) → **bundle secret-leak guard** (greps `dist/` for `shpat_`, `service_role`, `eyJhbGciOi`, `sk-…` shapes; every `VITE_*` var is inlined into the public bundle, so this is the one mistake that cannot be walked back) → **lint ratchet** (fails only if the problem count GREW past `LINT_BASELINE`) → **migration hygiene** (every migration *changed in the PR* must contain a ROLLBACK section and an "idempotent"/"if not exists" note; the repo-wide pass rate is reported as informational debt). A second job type-checks the Edge Functions with `deno check` (`continue-on-error` while the gate is new). **`LINT_BASELINE` in that file still reads `311`; the tree is at 254** (§17) — lowering it is a one-line change that locks the win in.

**Uptime (Sept 2026):** `.github/workflows/uptime.yml` — a first-party 15-minute cron probe (`contents: read`, `issues: write`): the deployed page must contain `<title>Acadia</title>`, and `${VITE_SUPABASE_URL}/auth/v1/health` must return 200. Failures open/comment on ONE GitHub issue titled "Uptime check failed" (matched by exact title via `--jq`, deliberately NOT `gh issue list --search`, whose index lags minutes and would duplicate issues on a 15-minute cron) and a recovery closes it. Honest limits are written into the file: `schedule` is best-effort, so a missing run means *unknown*, not healthy; the probe cannot see a partial outage that only affects signed-in users, nor a broken RLS policy. The real end-to-end signal remains `CSV Exported` per day in the Analytics panel.

**Container packaging (optional):** `deploy/` holds a two-stage `Dockerfile` (`node:24-alpine` runs `npm ci` + `npm test` + `npm run build`; `nginx:1.27-alpine` serves `dist/`), `nginx.conf` (SPA fallback, immutable-asset caching, never-cached `index.html`/`sw.js`, `/healthz`), `docker-compose.yml` (port 8088) and a `README.md` covering the self-hosted-Supabase story, the `BASE_PATH` build arg, and why Kubernetes is not the answer here. GitHub Pages remains production; nothing in `deploy/` is required to ship.

---

## 4. Environment Variables

| Variable | Required | Where Consumed | Purpose |
|---|---|---|---|
| `VITE_SUPABASE_URL` | **Required** | `src/lib/supabase.ts` line 3 | Supabase project URL. Throws hard error on load if missing. |
| `VITE_SUPABASE_ANON_KEY` | **Required** | `src/lib/supabase.ts` line 4 | Supabase anon/public API key. Throws hard error on load if missing. |
| `VITE_STORAGE_LIMIT_GB` | Optional | `src/App.tsx` (storage meter) | Denominator for the storage usage meter. Defaults to `100` (Pro plan) if unset. Set to `1` for free tier. |

**THOSE THREE ARE THE ONLY VARIABLES.** `.env.example` lists exactly them. `VITE_OPENAI_API_KEY`, `VITE_GOOGLE_VISION_API_KEY`, `VITE_GOOGLE_CLIENT_ID`, `VITE_GOOGLE_API_KEY`, `VITE_APP_PASSWORD` and `VITE_DISABLE_AUTH` are **gone** — the Sept 2026 dead-code deletion removed the last files that read any of them (`src/services/api.ts`, `src/components/AISettings.tsx`), and they were dropped from `.env.example`. **There is no third-party API key anywhere in this app**, which is also why `script-src 'self'` in the CSP (§9) is provable: no remote script, no vendor SDK. Do not re-add one without reading §18 #18.

**Supabase Edge Function secrets** (server-side, set via `supabase secrets set`, NOT in `.env`):
- `SHOPIFY_STORE` / `SHOPIFY_ADMIN_TOKEN` — `supabase/functions/shopify-titles/index.ts`. As of Sept 2026 these are reachable **only by a proven member of the workspace whose `organizations.slug = 'founding'`**; every other caller gets the clean empty result. Per-org stores live in `org_shopify_connections` (token WRITE-ONLY for clients via column grants; only the Edge Function's service role reads it).
- `CF_ACCOUNT_ID` / `CF_API_TOKEN` — `supabase/functions/generate-prose/index.ts` (Cloudflare Workers AI). Absent → 503, and the rule-based description path is unaffected.
- Both functions keep `verify_jwt` ON **and** additionally resolve the caller through `/auth/v1/user`, because the bare anon key is a validly signed project JWT — `verify_jwt` alone never proved a user (§9).
- The Admin token and the CF token must never appear in client code or a `VITE_*` var. If they were ever exposed, rotate them (§18 #17).

**Analytics / CRM / messaging need NO env vars or secrets** (Sept 2026) — they are first-party tables in this project (`analytics_events.sql`, `crm.sql`, `support_messaging.sql`). Run the migrations and they are on; the UI hides itself until the tables exist.

---

## 5. Folder Structure

```
sortingapp/
├── src/
│   ├── App.tsx                    # Root component. Owns all global state except the four item arrays (§8). ~3075 lines. Orchestrates all 4 steps, batch lifecycle, auto-save, registerItemsInDB, handleOpenBatch. Also: module-scope installErrorReporter(), React.lazy for every modal, useEventCallback for stable handler props, readAllPages() for paginated selects, GrouperErrorBoundary.
│   ├── App.css                    # Global app styles.
│   ├── main.tsx                   # Entry point. Renders <App /> in StrictMode; registers public/sw.js.
│   ├── index.css                  # Design tokens (§1), reset, body styles, .lazy-skeleton.
│   ├── assets/                    # Static assets (empty or unused).
│   ├── components/
│   │   ├── Auth.tsx / .css        # Email/password sign-in + sign-up. MIN_PASSWORD_LENGTH = 10, enforced on sign-up only (existing short passwords can still sign in).
│   │   ├── Landing.tsx / .css     # Marketing landing rendered at the main URL for logged-out visitors + beta signup form. Landing.css stays px-based (§1). Photos from images.unsplash.com (the one non-Supabase img-src origin).
│   │   ├── WaitlistGate.tsx / .css  # Full-screen gate for a signed-in user with no membership and no invite.
│   │   ├── WorkspaceMenu.tsx / .css # Header account dropdown: workspace name, role, email, links, sign-out.
│   │   ├── ImageUpload.tsx / .css  # Step 1. Drag-drop, folder, ZIP (lazy `loadJSZip`), EXIF (lazy `loadExifr`), canvas compression, TUS upload with a TUS_TIMEOUT_MS = 5 min watchdog that falls through to the plain PUT. `forwardRef` → `ImageUploadHandle` (`triggerFolder()`, `triggerZip()`, `isBusy`). Writes product_images via `buildProductImageRow`. The compressed-paths registry is an in-memory Set flushed once (`flushCompressedPaths`) instead of a per-image localStorage write. Cancel deletes the rows/files it already created (`onUploadCancelled`).
│   │   ├── ImageGrouper.tsx / .css  # Step 2 left panel, ~3226 lines. Multi-select, rubber-band, group/ungroup, delete, sidebar sort/filter, pick mode, auto-group, photo toolbar, keyboard shortcuts. Module-scope Intl formatters + a timestamp-keyed label cache; the rubber-band rect lives in a ref and is flushed to state at most once per rAF; the actions bundle is useMemo'd on the selection SIZE and delegates through a per-render ref. Exported as `memo(ImageGrouper)`.
│   │   ├── CategoryZones.tsx / .css # Step 2 right panel. Drag/click groups onto categories; resolves presets through `lib/presetResolver.ts` with `allowDefaultPrefix: true`. Exported as `memo(CategoryZones)`.
│   │   ├── ProductDescriptionGenerator.tsx / .css  # Step 3, ~3322 lines. Voice recording, description generation, field editing, crop/zoom + copy-paste crop, magnifier, group navigation. Reads/writes `workflowStore` directly (no local copy). Two separate save timers — 500 ms store-driven + 800 ms direct — plus a `flushProductPatchKeepalive` drain on pagehide/beforeunload. Exported as `memo(...)`.
│   │   ├── VoiceCommandTable.tsx  # Step 3 keyword→field reference table with inline cell editing. Exports VOICE_KEYWORD_TO_FIELD.
│   │   ├── ComprehensiveProductForm.tsx / .css  # Sub-form within Step 3 for all ~50 product fields. No local state.
│   │   ├── GoogleSheetExporter.tsx / .css  # Step 4 shell: fetches existing titles, coalesces group fields, dedups titles/handles, price gate, 54-column preview, blob download (object URL revoked on a deferred tick). The pure CSV builder lives in `lib/csvExport.ts`. Exported as `memo(forwardRef(...))`.
│   │   ├── Library.tsx / .css      # FULL-PAGE VIEW (was a modal overlay), ~2790 lines. Batches / groups / images tabs, rename, duplicate, delete (ownership claim + reference-counted storage guard), rubber-band select. Derivation is `lib/libraryData.ts`; thumbnails now use the SHARED `components/LazyImg` (its private copy was deleted, so Library finally gets the retry/backoff). Exported as `memo(LibraryInner)`.
│   │   ├── CategoriesManager.tsx / .css      # Full-page view, CRUD on categories (editor left / list right). Lazy-loaded.
│   │   ├── CategoryPresetsManager.tsx / .css # Full-page view, CRUD on category presets (list left / editor right — the editor was a modal stacked on a modal). Lazy-loaded.
│   │   ├── OrgPanel.tsx / .css     # Workspace, full-page view (lazy-loaded): members, invites, Shopify connection, description-format settings, beta requests, beta workspaces directory, founding Users tab — tabs render as a LEFT RAIL on wide screens. The Founder tools tab is gone (Analytics/CRM/Errors are top-level views). `.an-*` / `.crm-*` / `.ft-*` styles still live in OrgPanel.css, and the three panels import it themselves; page-scale overrides are scoped under `.tool-view`.
│   │   ├── AnalyticsPanel.tsx      # Analytics view, Overview tab. 7/30/90-day range, KPI tiles, HTML bar chart, funnel + tables.
│   │   ├── CrmPanel.tsx            # CRM view. Stage chips, search, inline editing, notes, Add contact, Sync. Mail links go through `lib/mailto.ts`.
│   │   ├── ErrorsPanel.tsx         # Analytics view, Errors tab (Sept 2026). Founding admins only. Range chips 7/30/90 (default 7), four KPI tiles, Top-issues table (untruncated message in `title` for copy/paste), Daily + By-screen tables. Deliberately table-only, no chart — an error list is read for its text. Shows a setup hint naming `app_errors.sql` when the table does not exist. Reuses existing OrgPanel.css classes only.
│   │   ├── VocabDashboard.tsx / .css  # Founding-admin vocabulary CRUD (chips, brand keywords, models). Full-page view, takes no props. Lazy-loaded.
│   │   ├── KanbanBoard.tsx / .css, KanbanCardDetail.tsx  # Founding-admin feature board (lanes + atlas views). Full-page view; owns Escape itself (closes the card drawer first), so ToolView is given `escapeToBack={false}`. Lazy-loaded.
│   │   ├── SupportWidget.tsx / .css  # Floating Messages button + panel for every signed-in user; inbox for founding admins. Since Sept 2026 it owns only PANEL-LOCAL state (open/closed, active thread, that thread's messages, draft, busy, the Open/Closed filter) — the thread list, the Realtime channel and the 45 s poll all moved to `lib/supportStore.ts`, and the `userId` prop is gone. Behaviour unchanged. Exported as `memo(...)`.
│   │   ├── MessagesView.tsx / .css  # 'messages' view (§6) — the full-page half of messaging: "Messages" for a user, "Inbox" for a founder. Searchable thread list beside a full-height conversation, founder Open/Closed/All chips with live counts, unread-first ordering with a real unread dot element (+ a visually-hidden "(unread)"), Up/Down keyboard walk over the list, Enter-to-send composer with an optional Subject on a new conversation, `EmptyState` for all four empty cases, and a one-column stack with a "All conversations" back control ≤1024px. Reads `supportStore` — it fetches nothing of its own.
│   │   ├── FinanceView.tsx / .css  # 'finance' view (§6), Founding admins only. Sub-tabs Overview / Transactions / Customers / Reports, held in COMPONENT state so App's diff stays the same shape as the CRM's. Ledger CRUD with the two-step `org-confirm-yes/no` delete (no `confirm()`), a two-series monthly P&L chart in `--accent` + `--text-muted` (semantics reserved for the one real state: profit sign), plan-price editor, projected MRR list vs discounted, two CSV downloads and a printable statement. The Transactions tab lists TEMPLATES (what you edit); everything else shows expanded occurrences. FinanceView.css only adds what Finance needs on top of the `.tool-view` scale, plus the print stylesheet (the `visibility` technique — everything invisible, `.fin-print` painted back, so app chrome outside this component is free to change).
│   │   ├── ToolView.tsx / .css    # THE full-page shell every header tool opens into (§6). Title row (icon + <h1> + one-line description + optional actions), "Back to workflow" first in tab order, Escape-to-back, optional `tabs` slot, `wide` (Library/Board), `escapeToBack` (Board). Focuses the <h1> and scrolls to top on open. ToolView.css owns THE spacing scale for all tool views — page padding `3rem clamp(2rem,4vw,6rem) 6rem`, 3rem section gaps, 2rem card padding, 4rem controls, 4.5rem table rows, 1400px measure — plus `--tv-sticky-top`, the header-clearance var the sticky editor columns and tab rails share. Per-tool CSS scopes its page overrides under `.tool-view` rather than rewriting 30 KB files. Tested in ToolView.test.tsx (8 tests).
│   │   ├── MobileNav.tsx / .css   # The <= 1024px navigation (§1, §6). BOTH surfaces live in this one file — `NavRail` (the 641-1024px tablet row, rendered INSIDE <header>) and `MobileTabBar` (the <= 640px fixed bottom tabs Workflow / Library / Messages / More, plus the More bottom sheet, rendered OUTSIDE <header> because .app-header is a stacking context that would trap a fixed child). Exports the `NavTool` type. The sheet is the shared `ui/Dialog`, so focus trap / Escape / scrim dismissal come for free. There is no NavRail.tsx and no MobileTabBar.tsx. MobileNav.css is the one mobile-first stylesheet in the tree (§1).
│   │   ├── responsiveGrid.ts / .test.ts  # PURE column-clamp helpers for the Step 2 grid (9 tests): PHONE_BREAKPOINT_PX = 640, gridColumnBounds(isPhone) (1-3 phone / 2-12 desktop), clampGridColumns, clampGroupGridColumns (group cards cap at 2). Exists because the grid applies its column count as an INLINE style that no media query can reach (§1); the stored slider preference is clamped for display, never mutated.
│   │   ├── LazyImg.tsx            # Shared image component: skeleton shimmer, 3× retry with exponential backoff + `?t=` cache-bust (works around ERR_QUIC_PROTOCOL_ERROR). Used by Step 2/3/4 AND Library.
│   │   ├── LoadingProgress.tsx / .css  # Upload progress bar shown in Step 2.
│   │   └── ui/                    # PRIMITIVE SYSTEM (Sept 2026) — built, tested, NOT YET ADOPTED (§16). index.ts (components + types only, so react-refresh stays happy), base.css (focus ring, .ui-sr-only), Button, IconButton (accessible `label` REQUIRED at the type level), Chip/ToggleChip/RemovableChip, Badge/CountBadge, Tabs (roving tabindex, manual activation mode), Dialog (focus trap + restore, Escape stack, reference-counted scroll lock, portal-free), ConfirmAction (the `confirm()` replacement, §18 #12), Field/TextField/TextareaField/SelectField, EmptyState, Spinner/Skeleton, Toast/ToastViewport (state-free — App keeps owning the queue), StatTile/StatGrid, testUtils.tsx (mount/click/keyDown harness), *.test.tsx (76 tests). NO hex literal anywhere except one documented scrim in Dialog.css.
│   ├── constants/
│   │   └── fieldLimits.ts         # Shopify character limits (SEO_TITLE=70, DESCRIPTION=5000, etc.) and helpers.
│   ├── lib/
│   │   ├── supabase.ts            # Supabase client + TypeScript Database types for the core tables.
│   │   ├── debugLogger.ts         # Centralized debug logger: dbg(), log.X() category wrappers, setDebugEnabled(), isDebugEnabled(). Zero-cost when disabled (window.__SORTBOT_DEBUG__ guard). Persists to 'sortbot_debug_enabled'. NOTE: log.* arguments are evaluated EAGERLY — wrap any log that builds an object in `if (isDebugEnabled())`.
│   │   ├── workflowStore.ts       # Dependency-free shared store (useSyncExternalStore). SOURCE OF TRUTH for the four item arrays: App.tsx and PDG both consume it via useStoreItemArray + module-level liveArrayRef views.
│   │   ├── slimItems.ts           # THE save→reload contract: SlimWorkflowItem, `PersistedWorkflowItem` (= SlimWorkflowItem & Partial<ClothingItem> — what a restore path actually finds), `asClothingItems()` (the ONE documented widening), slimForWorkflowState (omits imageUrls/thumbnailUrl when storagePath exists), ultraSlimForBackup (7 fields).
│   │   ├── workflowBackup.ts      # The synchronous localStorage crash backup, extracted so its throttle is testable: scheduleWorkflowBackup (1 s TRAILING THROTTLE, not a debounce), flushWorkflowBackup (pagehide + beforeunload), cancelWorkflowBackup (called BEFORE removeItem in handleBatchDeleted, or a queued write resurrects the deleted batch). Owns WORKFLOW_BACKUP_KEY.
│   │   ├── workflowBatchService.ts  # CRUD for workflow_batches. autoSaveWorkflowBatch (+ tombstones/confirmed-batch registry), fetchWorkflowBatches (PAGINATED 1000/page, projected via WORKFLOW_BATCH_RESTORE_COLUMNS — never `select(*)`), fetchWorkflowBatchesMeta, getWorkflowBatch, removeItemsFromWorkflowBatch (COMPARE-AND-SET on updated_at), deleteWorkflowBatch (ordered: read+reference-count → claim → confirmed batch-row delete → product_images → products → storage). Re-exports the persisted-item types from slimItems.
│   │   ├── productService.ts      # CRUD for products + product_images. saveProductToDatabase, saveBatchToDatabase (ONE chunked product_images upsert per group, not one per image), buildProductPatch, updateProduct (CHECKED — 0 rows is a failure, recovers by upserting without batch_id), syncGroupFieldsToDatabase (writes the group LEADER then mirrors onto members in one .in()), flushProductPatchKeepalive (fetch keepalive PATCH for page teardown — sendBeacon cannot PATCH), fetchUserProducts, deleteProduct. getThumbnailUrl is re-exported from storageUrls.
│   │   ├── productRow.ts          # The DB-row→ClothingItem seam, extracted from App.tsx's two byte-identical copies: productRowToClothingItem(row, htmlToPlain) and mergeProductRowIntoItem(item, row, htmlToPlain, opts) with the STARTUP_MERGE_OPTIONS / OPEN_BATCH_MERGE_OPTIONS presets that encode the two restore paths' SEVEN documented divergences (see §11). 39 tests.
│   │   ├── storageUrls.ts         # THE single storagePath → URL seam: IMAGE_BUCKET, publicImageUrl(), thumbnailImageUrl(). Invariant: an absent path yields '' — never a throw, never 'undefined' inside a URL. `grep getPublicUrl src/` returns only this file (+ the test mock). The private-bucket/signed-URL migration is now one function body.
│   │   ├── chunk.ts               # ID_CHUNK = 100 + chunked(xs, size) — replaced 18 hand-written chunking loops spelled six different ways. Throws on a nonsense size instead of looping forever. Concurrency-bounding loops pass an explicit size (e.g. 5) with a comment, because that is a DIFFERENT reason to chunk than URL length.
│   │   ├── presetResolver.ts      # resolvePreset(presets, categoryName, { allowDefaultPrefix }) — the ONE preset matcher, shared by CategoryZones (prefix step ON) and applyPresetToGroup (OFF). Tested inside applyPresetToGroup.test.ts.
│   │   ├── imageRowSync.ts        # product_images row builders + Stage 4 dual-write: stage4ColumnsAvailable() (cached probe) / stage4ColumnsKnownAvailable() (its synchronous view), buildTransforms(), buildProductImageRow(), and mergeProductImageRows() — the merge that makes registerItemsInDB's wipe non-destructive (§11).
│   │   ├── libraryData.ts         # PURE Library derivation: deriveLibraryData(wfBatches, savedProducts, savedImages) → {batches, groups, images}; owns ProductGroup/ImageRecord, cleanTitle, the per-batch-memoized makeBatchName, the two-pass imageList dedup/gap-fill rules and batch synthesis. Imports storageUrls, not supabase.
│   │   ├── libraryService.ts      # fetchSavedProducts / fetchSavedImages (paginated 1000/page), duplicateBatch (copies workflow_state.processedItems and recomputes the counts), delete operations for Library.
│   │   ├── csvExport.ts           # PURE Shopify CSV generation: taxonomy/type/GID maps, GidOverrides, resolveCategoryPath/resolveProductType, buildCleanTitle, SHOPIFY_CSV_HEADERS (54 cols), buildShopifyCsv/buildShopifyCsvRows, escapeCsvValue (incl. the formula-injection guard).
│   │   ├── imageTransforms.ts     # Canvas crop/transform engine for the Step 3 crop tool. createTransformedFile() re-encodes at 92% JPEG. The decoded-image session cache is a BYTE-BUDGETED LRU (IMG_CACHE_MAX_BYTES = 512 MB, charged w*h*4) — it was unbounded, which is ~24 GB at 1,500 images.
│   │   ├── tusUpload.ts           # TUS resumable upload (tus-js-client), 6 MB chunks, auth token passed so Storage RLS applies. No async Promise executor (a throw used to hang the promise forever).
│   │   ├── storageSafety.ts       # filterUnreferencedStoragePaths() — reference-count guard before deleting storage files. Fails safe (keeps the file) on lookup errors. MUST run BEFORE the product_images rows are deleted (§18 #15).
│   │   ├── swCache.ts             # purgeImageCache() — posts PURGE_IMAGE_CACHE to the active Service Worker over a MessageChannel (2 s timeout) and falls back to deleting the cache from the page. Called on sign-out so a shared machine cannot pull the previous workspace's photos. Never throws, never rejects.
│   │   ├── errorReporter.ts       # FIRST-PARTY error tracking → app_errors: installErrorReporter() (window 'error' + 'unhandledrejection'), reportError(), setErrorContext()/clearErrorContext(), fetchErrorSummary(). Pure helpers: scrubPII (emails/UUIDs/opaque tokens), normalizeMessage/normalizeFrame + fingerprintError (survives a redeploy — strips the Vite content hash and :line:col), browserFamily, appVersionFrom (reads the entry-chunk hash; no build-config change), createGate/allowReport (60 s per-fingerprint dedupe + 20 reports per page load). Skips localhost unless sortbot_analytics_force=1; does NOT honor DNT (a crash report about our own code is neither behavioural nor cross-site); latches itself off when the table is missing.
│   │   ├── mailto.ts              # isSafeEmail() + safeMailto(addr, subject?, body?) — the ONLY way to build a mailto: href. Returns null for anything unsafe so the caller renders plain text instead of a link; blocks `?`/`&`/`#`/`,`/`;`/`<`/`>`/quotes/whitespace header injection into the founder's mail client.
│   │   ├── analytics.ts           # FIRST-PARTY analytics: track()/trackPageview(), setAnalyticsContext, fetchAnalyticsSummary, pure helpers (shouldTrack, referrerHost, deviceClass, buildEvent, buildFunnel, compactNumber, percentDelta, niceCeiling). Owns SESSION_KEY / FORCE_KEY. Auto-disables when the table is missing.
│   │   ├── crmService.ts          # FIRST-PARTY CRM (Founding admins): crm_contacts/crm_notes CRUD + syncCrmContacts(). Pure: filterContacts, sortContacts, stageCounts, followUpStatus, parseTags, todayKey. 'unavailable' pre-migration.
│   │   ├── supportService.ts      # FIRST-PARTY messaging: support_threads/support_messages reads + writes, subscribeToSupport (postgres_changes on INSERT and UPDATE only — NEVER '*', which would ship a deleted thread's whole OLD row to every subscriber). Pure: isUnread, unreadThreadCount, sortThreads, formatRelative.
│   │   ├── supportStore.ts        # Dependency-free shared store (useSyncExternalStore, mirrors workflowStore). SOURCE OF TRUTH for the support THREAD LIST + the availability flag, and OWNER of the single Realtime subscription and the single 45 s poll (`SUPPORT_POLL_MS`), ref-counted: started by the first subscriber, stopped by the last. `SupportWidget`, `MessagesView` and the header badge all consume it through `useSupportThreads(role)`. MESSAGES are deliberately NOT in the store (two front ends can read different threads) — a `revision` counter ticks once per completed refetch and each consumer reloads its own conversation on `[activeId, revision]`. Writes are optimistic then reconciled; `applySentMessage` mirrors the `support_after_message` SQL trigger field for field. `refresh()` dedupes concurrent callers into one in-flight promise. `filterThreads` lives here. Tested (15).
│   │   ├── financeService.ts      # FIRST-PARTY finance (Founding admins): typed CRUD over finance_transactions / finance_plan_prices, `fetchFinanceSummary` (the finance_summary RPC, mapping 42501 → 'forbidden' and a missing table → 'unavailable'), `normalizeSummary`, and the PURE helpers the view, the previews and both CSVs share — money↔cents, `addMonthsAnchored`, the five range presets, `expandOccurrences` (reproduces the SQL recurrence rule EXACTLY), `buildMonthlyPnl`, `summarizeTransactions`, `buildCategoryBreakdown`, the ledger/P&L CSV builders (through csvExport's `escapeCsvValue`, so the formula guard is not reimplemented), category suggestions, `validateTransactionInput` (mirrors every CHECK). Tested (34).
│   │   ├── kanbanService.ts, kanban/  # Founding-admin feature board: service + pure modules (atlas, dates, format, rank, status, tree, types), 95 tests.
│   │   ├── orgService.ts          # Multi-org bootstrap (ensureOrganization with legacy fallback), members/invites CRUD, the PRIVATE BETA GATE. The in-flight dedupe promise is keyed BY USER ID (a Map), not module-global.
│   │   ├── betaService.ts         # Beta waitlist: getMyBetaSignup, requestBetaAccess, fetchBetaSignups/setBetaStatus.
│   │   ├── foundingAdminService.ts  # Cross-workspace user management for Founding admins (founding_* SECURITY DEFINER RPCs). MEMBERSHIPS MOVE, DATA DOES NOT.
│   │   ├── shopifyConnectionService.ts  # Per-org Shopify credentials. Token is WRITE-ONLY from the client.
│   │   ├── descriptionSettings.ts # Per-workspace description format shape + defaults (byte-identical to the old hardcoded output).
│   │   ├── proseService.ts        # Requests + VALIDATES the model-written selling paragraph (15–120 words, banned phrases, numbers guard). Invalid → null → today's rule-based output.
│   │   ├── categoriesService.ts, categories.ts, categoryPresets.ts, categoryPresetsService.ts, applyPresetToGroup.ts  # Categories + presets: CRUD, types, DEFAULT_CATEGORIES, preset application (applyPresetDirectly is the sync, no-network path).
│   │   ├── textAIService.ts       # Core listing engine: extractFieldsFromVoice(), generateProductDescription(), title/tag engine (fitTo60, ITEM_TYPE_SYNONYM_GROUPS), size normalization. ~1850 lines.
│   │   ├── grouping.ts            # buildGroupArray (tolerant group-id resolution) + filterStep3Visible.
│   │   ├── brandCategorySystem.ts, vintagePatternEngine.ts, vintagePatternExpansion{,2,3,4}.ts, builtinBrandVocab.ts, colorDatabase.ts, vocabService.ts  # Brand/colour knowledge bases. builtinBrandVocab is loaded by DYNAMIC IMPORT only (~361 kB chunk) — keep it out of any main-bundle import path.
│   │   ├── testing/supabaseMock.ts  # TEST-ONLY chainable Supabase stand-in that records table/op/filters/payload/range() per call (inSizes(), callsFor()). Imported by no app code.
│   │   └── __snapshots__/         # csvExport + textAIService golden snapshots.
├── supabase/
│   ├── schema.sql                 # Original schema (may be outdated — not all columns present here).
│   ├── functions/
│   │   ├── shopify-titles/index.ts  # Deno Edge Function. Resolves the caller via /auth/v1/user (401 without a user), resolves their org, reads titles+handles (and metaobject GIDs) from the Shopify Admin GraphQL API. `resolveShopHost()` accepts one DNS label only (no scheme/path/port/@ — blocks SSRF). Global secrets fire ONLY for organizations.slug = 'founding'. Upstream error bodies are logged server-side, never echoed. verify_jwt ON.
│   │   └── generate-prose/index.ts  # Deno Edge Function. Caller resolved via the JWT (401); the caller's org must have description_settings->>'proseEnabled' true, read with the service role (403); prompt bounded (25 fields, 40-char keys, 200-char values, 4,000-char facts budget, 300-char style note, 64 KB body → 413); the untrusted region is fenced and the system prompt states the blocks are DATA. verify_jwt ON.
│   └── migrations/                # 50 migration SQL files. Many are one-off fixes. NOT tracked by the Supabase CLI — they are run BY HAND in the SQL Editor, which is why CI requires every changed file to carry a ROLLBACK section and an idempotency note.
│       ├── shared_workspace_rls.sql  # ⚠️ DANGER: Sets "all users see all rows" SELECT policies. Has been run in Supabase dashboard.
│       ├── collaborative_edit_policies.sql  # ⚠️ DANGER: Makes INSERT/UPDATE permissive for ANY authenticated user on workflow_batches/products/product_images (DELETE stays owner-scoped). Idempotent; rollback SQL at bottom.
│       ├── multi_org_tenancy.sql     # ⚠️ DANGER (but additive): org tables + org_id on the 5 data tables + backfill into a "Founding Workspace" + org-membership RLS. Supersedes the two above once run. TAKE A DB BACKUP FIRST.
│       ├── beta_signups.sql / beta_admin_directory.sql / founding_user_admin.sql  # Private beta + founding-admin surfaces. Run AFTER multi_org_tenancy.sql.
│       ├── org_shopify_connections.sql / org_description_settings.sql  # Per-org Shopify credentials (client-write-only token) + description_settings JSONB.
│       ├── stage4_slim_fields.sql    # Stage 4 dual-write columns (product_images.captured_at + original_storage_path, products.description_edited). The app feature-detects these via the imageRowSync probe.
│       ├── analytics_events.sql / crm.sql / support_messaging.sql / kanban_board.sql / vocab_tables.sql / vocab_models.sql  # First-party founder tools. Additive, idempotent, rollback included.
│       ├── finance.sql               # NEW (Sept 2026), NOT YET RUN: the founder's books. finance_transactions (ledger; a row with a `recurrence` is a TEMPLATE expanded at read time, never stored), finance_plan_prices (plan → list price, seeded to the Landing tiers), finance_settings (founding_discount_pct = 30, founding_cutoff = 2026-12-31) — every policy on all three is `is_beta_admin()`, with column-level UPDATE grants that exclude `created_by`/`created_at` — plus `finance_summary(from, to)` SECURITY DEFINER (totals, the previous equal-length range, a zero-filled monthly series, by_category, by_workspace, customer + MRR stats; `analytics_events` optional via `to_regclass`, so a missing table yields `active_workspaces: null`, not 0). Raises 42501 for a non-founder, 22007 on an inverted range. Run AFTER multi_org_tenancy.sql + beta_signups.sql. Additive, idempotent, rollback at the bottom.
│       ├── app_errors.sql            # NEW (Sept 2026), NOT YET RUN: app_errors table + RLS (anon+authed INSERT with identity checks, SELECT is_beta_admin(), no client UPDATE/DELETE) + a 20-rows-per-session-per-10-min BEFORE INSERT rate trigger + app_errors_summary(days) / app_errors_prune(keep_days). user_agent_class is a CLOSED VOCABULARY in the CHECK, so the "browser family, never a full UA" privacy promise is enforced by the database. Run AFTER multi_org_tenancy.sql + beta_signups.sql. Verified against a throwaway PG 17 cluster (12 scenarios). Additive, idempotent, rollback at the bottom.
│       ├── security_invites_hardening.sql  # NEW (Sept 2026), NOT YET RUN: closes invitee → OWNER self-promotion. Column-level UPDATE grant on org_invites (accepted_at only), org_members_insert may never mint an owner from an invite, unique index on (org_id, lower(email)). Run AFTER multi_org_tenancy.sql and BEFORE security_verified_email.sql.
│       ├── security_verified_email.sql    # NEW (Sept 2026), NOT YET RUN: auth_email_verified() added as an ADDITIONAL condition to all seven email-matching policy sites (the JWT email claim comes from the signup form — it is not proof of mailbox control). PRECONDITION: `select count(*) from auth.users where email_confirmed_at is null;` must be 0. Run after the optional tables it guards + migration above.
│       ├── security_abuse_limits.sql      # NEW (Sept 2026), NOT YET RUN: analytics_events props size + event-name CHECKs and a 120-rows/session/10-min trigger; beta_signups length + email-format CHECKs (also the server half of the mailto: fix); support messaging quotas (20 open threads/user, 30 messages/10 min) with org_id/org_name DERIVED from real membership and founder_last_read_at pinned for non-founders. All CHECKs are NOT VALID, so existing history is untouched.
│       └── security_storage_policies.sql  # NEW (Sept 2026), NOT YET RUN and INERT UNTIL ONE MANUAL STEP: org-scoped INSERT/UPDATE/DELETE policies on storage.objects for the product-images bucket. Scope is the caller's ORG, not the caller alone, because three shipped flows write under a teammate's uid prefix (Step 3 crop re-upload, "Compress All Batches", deleting a teammate's batch). SELECT stays public. RLS policies are OR'ed, so run the section 0 inventory, find the permissive dashboard policy, then uncomment its drop in section 4 — until then this file changes nothing.
├── scripts/                       # Node one-off maintenance scripts (`node scripts/<name>.mjs`). Not part of the build: cleanup-orphaned-storage, fetch-taxonomy, fetch-metaobject-gids, check-shopify-csv, update-presets.
├── public/                        # Static assets. sw.js = the Service Worker image cache (stale-while-revalidate, 7-day TTL, REVALIDATE_AFTER_MS = 1 day, MAX_ENTRIES = 3000 trimmed 50-per-fetch, strips both `t` and `_retry` cache-busters, answers PURGE_IMAGE_CACHE). Also beta.html (redirect to the main URL).
├── deploy/                        # OPTIONAL container packaging (Sept 2026): Dockerfile (node:24-alpine build+test → nginx:1.27-alpine serve), nginx.conf (SPA fallback, /healthz, cache headers), docker-compose.yml (:8088), README.md (self-hosted Supabase, BASE_PATH arg, per-environment CSP, why not Kubernetes). GitHub Pages is still production.
├── docs/reviews/                  # The Sept 2026 engineering review: six audit reports + their implementation logs (01 architecture, 02 debugging, 03 performance, 04 UI system, 05 security, 06 devops), then the feature passes that followed — 07 full-page views, 08 messages view, 09 finance, and the three-agent mobile-first pass (10-mobile-shell, 10-mobile-pages, 10-mobile-workflow). Read the log for the reasoning behind anything in §15's Sept 2026 entries.
├── .github/workflows/             # deploy.yml (Pages, push to main) · ci.yml (PR/branch: test, build, dist verification, secret-leak grep, lint ratchet, migration hygiene, deno check) · uptime.yml (15-min probe → GitHub issue).
├── dist/                          # Build output. Do not edit.
├── .env / .env.example            # Local env vars (NOT committed) / template with the three VITE_ values.
├── vite.config.ts                 # Sets base '/sortbot/' under GITHUB_ACTIONS, '/' locally.
├── vitest.config.ts               # happy-dom + dummy Supabase env vars.
├── tsconfig*.json, eslint.config.js, package.json
├── index.html                     # Vite entry. Carries the CSP <meta http-equiv> + referrer policy (§9) and the pre-paint canvas <style>.
├── ADD_APPLIED_PRESET_ID.sql, database_migration_csv_fields.sql, fix_security_warnings.sql  # Ad-hoc SQL at the repo root, outside supabase/migrations/.
├── check-and-run-migration.js, check-collaborative-changes.js, run-collaborative-migration.js, run-categories-migration.sh, test-db-connection.html, console-log.html  # One-off helpers. Not part of the app.
├── ANALYSIS.md                    # Strengths/weaknesses assessment + the multi-org SaaS roadmap.
└── proxy.log                      # Leftover log file. In .gitignore — never committed.
```

**There are no dead/unused components left.** The Sept 2026 refactor pass DELETED all six (`SavedProducts`, `TestLlamaVision`, `LiveWorkspaceSelector`, `RemoteCursors`, `AISettings`, `ImageSorter`) with their CSS, plus `src/hooks/useUserPresence.ts`, `src/services/api.ts`, `src/lib/huggingfaceService.ts`, `brandMatcher.ts`, `constructionDatabase.ts`, `fitConditionDatabase.ts`, `exportLibraryService.ts` and the root `huggingface-proxy.cjs` — 20 files, 5,819 lines. `src/hooks/` and `src/services/` no longer exist. Every candidate was proven to have no importer outside the dead set, and every relative import in `src/` was re-resolved afterwards (zero dangling imports). `COLOR_RGB_MAP` was dropped from `colorDatabase.ts` in the same pass, but `hexToRgb()` was deliberately KEPT — it is the `#MULTI`/`#RAINBOW` pattern-entry filter that keeps "tie dye"/"camo"/"plaid" out of `COLOR_WORDS_LIST`.

---

## 6. Route Map

This app has **no router**. It is a single-page application with no URL routing. All navigation is state-driven conditional rendering in `App.tsx`.

**Since Sept 2026 the header tools are full PAGES, not modals.** One state variable decides what is on screen:

```ts
export type ActiveView =
  | 'workflow' | 'library' | 'categories' | 'presets'
  | 'vocabulary' | 'analytics' | 'crm' | 'finance' | 'board' | 'workspace' | 'messages';
```

`'workflow'` is the four steps. Every other value renders that tool inside the shared `<ToolView>` shell (title block, "Back to workflow", Escape, one spacing scale) in place of the workflow — **the workflow itself is never unmounted**: `<main className="app-main" hidden={activeView !== 'workflow'}>` parks it so uploads in flight, ImageGrouper's selection and Step 3's debounced saves all survive opening a tool. `.app-main[hidden] { display: none }` in App.css is load-bearing (`display: flex` would otherwise beat the UA `[hidden]` rule).

| View | Condition | Component | Loading |
|---|---|---|---|
| Loading screen | `loading === true` | Inline JSX in App.tsx | eager |
| Marketing landing | `!user && !showLogin` | `<Landing />` | **eager — it is the first paint** |
| Auth screen | `!user && showLogin` | `<Auth />` | eager |
| Waitlist gate | signed in, `betaWaitlist` set | `<WaitlistGate />` | eager |
| Step 1: Upload | `activeView === 'workflow'` (always rendered; parked behind `hidden` otherwise) | `<ImageUpload />` | eager |
| Step 2: Group+Categorize | + `uploadedImages.length > 0` | `<ImageGrouper />` (inside `<GrouperErrorBoundary>`) + `<CategoryZones />` side by side | eager |
| Step 3: Descriptions | + `sortedImages.length > 0` | `<ProductDescriptionGenerator />` | eager |
| Step 4: Save+Export | + `processedItems.length > 0` | Inline buttons + `<GoogleSheetExporter />` inside `<details>` | eager |
| Library | `activeView === 'library'` | `<ToolView wide>` → `<Library />` | `React.lazy` |
| Categories | `activeView === 'categories'` | `<ToolView>` → `<CategoriesManager />` | `React.lazy` |
| Category presets | `activeView === 'presets'` | `<ToolView>` → `<CategoryPresetsManager />` | `React.lazy` |
| Workspace | `activeView === 'workspace'` + `currentOrg` | `<ToolView>` → `<OrgPanel />` | `React.lazy` |
| Vocabulary | `activeView === 'vocabulary'` + founding owner/admin | `<ToolView>` → `<VocabDashboard />` | `React.lazy` |
| Analytics (+ Errors sub-tab) | `activeView === 'analytics'` + founding owner/admin | `<ToolView tabs>` → `<AnalyticsPanel />` or `<ErrorsPanel />` | `React.lazy` (own chunks) |
| CRM | `activeView === 'crm'` + founding owner/admin | `<ToolView>` → `<CrmPanel />` | `React.lazy` (own chunk) |
| Finance | `activeView === 'finance'` + founding owner/admin | `<ToolView>` → `<FinanceView />` | `React.lazy` (own chunk) |
| Board | `activeView === 'board'` + founding workspace | `<ToolView wide escapeToBack={false}>` → `<KanbanBoard />` | `React.lazy` |
| Messages / Inbox | `activeView === 'messages'` — **any signed-in user** | `<ToolView wide>` → `<MessagesView />`; the ToolView title is "Inbox" for a founder and "Messages" for everyone else | `React.lazy` (own chunk) |
| Messages widget | any signed-in user (waitlist included) | `<SupportWidget />` floating button — visible in EVERY view, including the Messages page | eager |

### Navigation by breakpoint (Sept 2026)

The view list above is the same at every width; only the surface that *reaches* it
changes. **`navTools` in `App.tsx` is the single declaration** of a tool's id, label,
icon, tooltip and role gate — the desktop header maps over it (it replaced nine
hand-written buttons), and `mobileTools` (the same list minus Messages, plus Workspace)
feeds the rail, the tab bar and the sheet. Four hand-maintained copies of a role-gated
list is how gates drift apart; add a tool to `navTools` and it appears everywhere.

| Width | Header keeps | Tools live in |
|---|---|---|
| `> 1024px` | wordmark + subtitle, **all tools**, Messages, account menu | the header row — **unchanged** |
| `641-1024px` | wordmark, Messages (badge), account menu | `<NavRail>` — a scroll-snapped second row on the same black bar, rendered INSIDE `<header>` |
| `<= 640px` | wordmark, Messages (badge), account menu | `<MobileTabBar>` — fixed bottom tabs **Workflow / Library / Messages / More**, everything else behind More in a bottom sheet |

- **CSS decides which nav shows, not `matchMedia`.** Both subtrees are in the DOM and the
  inactive one is `display: none`, which also drops it from the accessibility tree — no
  tool is announced twice, there is no flash of the wrong nav on first paint, and there is
  no resize listener to keep in sync. One rule hides the desktop buttons:
  `.app-header .nav-tool-btn:not(.nav-msg-btn) { display: none }`. `nav-msg-btn` is the
  exemption handle on `MessagesNavButton` so the unread badge survives at every width.
- **Rail and tab bar are two components for a stacking reason, not a styling one.**
  `.app-header` is `position: sticky; z-index: 100`, i.e. a stacking context, so a
  `position: fixed` child is trapped at that level. The rail belongs inside the header
  (it is the header's second row, same black surface); the tab bar and its sheet must
  render outside it or the More sheet paints under the support widget (z 5000) and the
  toasts (z 9000).
- **Workflow / Library / Messages are hard-coded tabs**; the sheet renders
  `mobileTools` minus those (`TAB_IDS`), so nothing appears twice. The Messages tab hides
  itself when `supportStore` reports the messaging tables absent, exactly like the header
  button and the floating widget.
- **`aria-current="page"` marks the active item on all four surfaces**, and **More reports
  itself active** whenever the showing view lives behind it — the bar says where you are
  instead of going blank on, say, CRM.
- **The mobile surfaces navigate, they never toggle.** `navigateToView` only ever sets
  `activeView`; tapping the tab you are on is inert. That is deliberately different from a
  header button, which toggles back to the workflow (the sheet's trigger is unmounted by
  the time the view opens, so there would be nothing to hand focus back to anyway).

Things that bite if forgotten:

- **The Messages header button is its own component** (`MessagesNavButton`, module scope in App.tsx), not an inline branch, because mounting `useSupportThreads` is what starts the Realtime channel and the poll. Putting that hook in App's body would query `support_threads` from the logged-out landing page and leave `available` false for up to 45 s after sign-in. It hides itself when messaging is unavailable (same rule as the widget) and carries the `.nav-badge` unread count — which sets its own literal `#ffffff` on `var(--danger)` in App.css, because the nav is the app's one inverted surface (§1). **The waitlist branch has no header at all** (`WaitlistGate` + `SupportWidget` only), so waitlisted users still reach messaging through the floating widget exactly as before.
- **Finance is founding-admin only**, gated exactly like Analytics/CRM/Vocabulary (`currentOrg?.slug === 'founding'` + `orgRole` owner/admin). It is safe to expose before `finance.sql` runs: every read reports `'unavailable'` and the view shows the setup step.
- **Errors is a sub-tab of Analytics**, not a view of its own and no longer a tab inside OrgPanel. The "Founder tools" tab was removed from `OrgPanel`, which now owns only Members / Settings / Beta program / Users. `AnalyticsPanel`, `CrmPanel` and `ErrorsPanel` therefore `import './OrgPanel.css'` themselves — they use its `org-*` / `ft-*` / `an-*` classes and no longer ride along in OrgPanel's chunk.
- **`setShowLibrary` is the one surviving flag-shaped setter** (`viewSetter('library')`), because `handleOpenBatch` and the close callback still speak in booleans. The other five tools open from the header via `toggleView(view)` and close through ToolView's Back.
- **Clicking the header button of the view you are already in returns to the workflow.** The active button carries `aria-current="page"` + `.nav-tool-btn--on` — a solid white chip, because the nav is the app's one inverted surface and the page's black fill cannot read as "active" there.
- **The header wordmark switches between `<h1>` and `<p>`** (`const Wordmark = activeView === 'workflow' ? 'h1' : 'p'`) so every view has exactly one `<h1>`; inside a tool view that `<h1>` is ToolView's title. `.app-header .app-wordmark` sets its own white colour, per §1's nav rule.
- **Focus**: opening a view moves focus to its `<h1>` and scrolls to top; Back restores focus to the header button that opened it (`viewTriggerRef`). Escape goes back, except inside an editable field or while any `[data-tv-modal]` is open (the preset editor, `FieldModal`, Library's rename prompt).

The `view` string the analytics pageview and `setErrorContext` record (`landing` / `auth` / `waitlist` / `app`) is computed in one place, in an effect that sits ABOVE the early returns so hook order stays stable.

---

## 7. Data Models & Schema

### Supabase Tables (authoritative definition in `src/lib/supabase.ts`)

#### `workflow_batches`
| Column | Type | Notes |
|---|---|---|
| `id` | UUID | PK |
| `user_id` | UUID | FK → auth.users. Always set on write, but SELECT has no user_id filter (shared workspace). |
| `batch_name` | TEXT | Optional user-set name. |
| `batch_number` | TEXT | Auto-generated e.g. `batch-1712345678901`. |
| `current_step` | INT | 1–4. Computed by `determineCurrentStep()`. |
| `is_completed` | BOOL | Not actively used. |
| `total_images` | INT | Set by `calculateWorkflowStats()`. |
| `product_groups_count` | INT | Unique productGroup IDs. |
| `categorized_count` | INT | Items with category set. |
| `processed_count` | INT | Items with category (proxy for "processed"). |
| `saved_products_count` | INT | Not actively maintained. |
| `workflow_state` | JSONB | Contains `{ processedItems: PersistedWorkflowItem[] }` in the new format (plus `lastEditedBy` / `lastEditedAt`). Written by `slimForWorkflowState` (`lib/slimItems.ts`). |
| `thumbnail_url` | TEXT | Set by `createWorkflowBatch` from the first item's `imageUrls[0]`, falling back to `publicImageUrl(storagePath)` — the fallback became load-bearing once `slimForWorkflowState` stopped persisting derived `imageUrls` (§11). **Written and copied by `duplicateBatch` but never rendered** — Library derives thumbnails through `deriveLibraryData`. |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | |
| `last_opened_at` | TIMESTAMPTZ | Updated on every fetch/open. |
| `tags` | TEXT[] | Not used. |
| `notes` | TEXT | Not used. |

#### `products`
| Column | Type | Notes |
|---|---|---|
| `id` | UUID | PK. Matches `ClothingItem.id`. |
| `user_id` | UUID | FK → auth.users. |
| `batch_id` | UUID | FK → workflow_batches.id (nullable). |
| `product_group` | TEXT | UUID matching the group leader's id. Items sharing a group have the same value. |
| `title` / `seo_title` | TEXT | Both set to `item.seoTitle`. Redundant. |
| `description` | TEXT | Full generated description. |
| `vendor` | TEXT | Maps to `ClothingItem.brand`. |
| `product_category` | TEXT | Maps to `ClothingItem.category`. |
| `voice_description` | TEXT | Raw voice transcript. |
| `measurements` | JSONB | `{ width, length, waist, inseam, rise, shoulder, sleeve }`. |
| `product_images` | — | Related via FK in product_images table. |
| *(~50 more columns)* | | See `supabase.ts` Database type for full list. |

#### `product_images`
| Column | Type | Notes |
|---|---|---|
| `id` | UUID | PK |
| `product_id` | UUID | FK → products.id CASCADE DELETE |
| `user_id` | UUID | FK → auth.users |
| `image_url` | TEXT | Public CDN URL from Supabase Storage. |
| `storage_path` | TEXT | Path within `product-images` bucket e.g. `userId/productId/filename.jpg`. |
| `position` | INT | Order index for multi-image products. |
| `alt_text` | TEXT | |
| `original_name` | TEXT | Original upload filename (e.g. `DSC02175.jpg`). Nullable; NULL for rows created before migration `add_original_name_to_product_images.sql`. Used for name-sort in Step 2 and displayed on Step 2 cards. |

**⚠️ Write strategy (critical):** `registerItemsInDB` in App.tsx still uses a **hybrid delete-then-upsert**, but since Sept 2026 the wipe is preceded by a MERGE instead of a one-column pre-fetch: (1) read the FULL existing row set for the batch's product IDs (chunked), (2) `mergeProductImageRows(computed, existing)` (`lib/imageRowSync.ts`) decides what survives, (3) delete ALL rows for those product IDs (chunked 100/query), (4) re-insert the merged rows via `upsert(..., { ignoreDuplicates: true })` so a concurrent racing call skips instead of throwing 409. **If the existing-row read fails, the wipe is skipped entirely** and only the computed rows are upserted — never destroy what you could not read. The `products` upsert above it uses `ignoreDuplicates: true` on `id` so it can NEVER steal `batch_id` from another batch, and the two Step-2 `products` upserts (`handleImagesSorted`, the debounced `handleImagesGrouped` write) no longer send `batch_id` at all. Merge rules and the reason the delete stays are in §11.

#### `categories`
| Column | Type | Notes |
|---|---|---|
| `id` | UUID | PK |
| `user_id` | UUID | FK → auth.users |
| `name` | TEXT | Lowercase internal key e.g. `sweatshirts` |
| `display_name` | TEXT | UI label e.g. `Sweatshirts` |
| `emoji` | TEXT | Stores Lucide icon name (e.g. `shirt`), NOT an actual emoji character. Naming is misleading. |
| `color` | TEXT | Hex color string |
| `sort_order` | INT | Display order |
| `is_active` | BOOL | Soft delete |

#### `category_presets`
| Column | Type | Notes |
|---|---|---|
| `id` | UUID | PK |
| `user_id` | UUID | FK → auth.users |
| `category_name` | TEXT | Legacy matching field |
| `product_type` | TEXT | Used for matching in `applyPresetToGroup.ts` (takes precedence over category_name) |
| `measurement_template` | JSONB | `{ width, length, sleeve, shoulder, waist, inseam, rise }` booleans |
| `seo_title_template` | TEXT | Template with `{brand}`, `{model}`, `{color}`, `{size}`, `{era}`, `{category}` tokens |
| `is_default` | BOOL | Whether this preset auto-applies when category is assigned |
| `is_active` | BOOL | Soft delete |

#### Finance (`supabase/migrations/finance.sql` — Founding admins only, every policy `is_beta_admin()`)

| Table | Column | Type | Notes |
|---|---|---|---|
| `finance_transactions` | `id` | UUID | PK. One row per real-world money movement. |
| | `occurred_on` | DATE | Default `current_date`. For a recurring row this is the series **ANCHOR**, not just its first date. |
| | `kind` | TEXT | `income` \| `expense`. **Carries the sign** — `amount_cents` is always positive. |
| | `category` | TEXT | ≤ 60 chars, free text. The form suggests; it does not constrain. |
| | `amount_cents` | BIGINT | `> 0` and `<= 1e11`. The ceiling stops a fat-fingered amount silently rescaling every chart. |
| | `currency` | TEXT(3) | Default `USD`. Stored per row; the UI is USD-only today. |
| | `description` | TEXT | ≤ 500 chars. |
| | `org_id` | UUID | FK → organizations, **ON DELETE SET NULL** — deleting a workspace must not erase what it paid. |
| | `recurrence` | TEXT | `monthly` \| `yearly` \| null. A recurring row is a **TEMPLATE**; repeats are expanded at read time, never stored (§9). |
| | `recurrence_ends_on` | DATE | CHECKed `>= occurred_on`, and CHECKed to require a `recurrence`. |
| | `created_by` | UUID | Default `auth.uid()`. **Excluded from the UPDATE grant** — it is the audit trail of who typed a number into the books. |
| | `created_at` / `updated_at` | TIMESTAMPTZ | `updated_at` via a touch trigger; `created_at` also outside the UPDATE grant. |
| `finance_plan_prices` | `plan` | TEXT | PK. Matches the value in `organizations.plan`, so projected MRR is a JOIN, not a constant in the client. |
| | `monthly_cents` | BIGINT | List price. **Seeded to the Landing tiers**: free 0, beta 0, starter 5000, basic 9000, growth 15000, pro 25000, business 35000, scale 70000, enterprise 120000 — all `on conflict do nothing`, so a founder's edit survives a re-run. |
| | `note` / `updated_at` | TEXT / TIMESTAMPTZ | |
| `finance_settings` | `key` | TEXT | PK. Seeded `founding_discount_pct = 30` and `founding_cutoff = 2026-12-31`. |
| | `value` | TEXT | Parsed **defensively** by the RPC — a founder typing "thirty" degrades to "no discount", it never breaks the books. |
| | `note` / `updated_at` | TEXT / TIMESTAMPTZ | |

A third table rather than a magic row in `finance_plan_prices` is deliberate: a discount is not a plan, and a `founding_discount_pct` row sitting in the price table would be summed into MRR by any future query that forgot to exclude it. A separate key/value table cannot be added up by accident.

### TypeScript Types

#### `ClothingItem` (defined in `src/App.tsx`, exported)
The central runtime type. Has ~60 fields. Key fields:
- `id: string` — UUID generated at upload time. Stable across all steps.
- `file: File` — Raw File object. **Stripped by `slim()` before saving to DB.** null when restored from DB.
- `preview: string` — Blob URL (upload time) or Supabase CDN URL (after upload). **Stripped by `slim()`.** Reconstructed from `storagePath` on restore.
- `thumbnailUrl?: string` — Supabase Storage CDN URL (plain, no transform). Built at restore time from `storagePath` via `thumbnailImageUrl()` (exported as `getThumbnailUrl` for compatibility). Used by ImageGrouper card `<img>` tags. Falls back to `imageUrls[0]` for legacy items. **Persisted by `slimForWorkflowState` ONLY when the item has no `storagePath`** — otherwise it is derivable and omitted. Note: Supabase Storage image transforms require the paid add-on — `thumbnailImageUrl()` intentionally ignores its size argument and returns the plain CDN URL.
- `imageUrls?: string[]` — Array of full-resolution CDN URLs. Index 0 = primary image. **Same rule as `thumbnailUrl`: persisted only for items with no `storagePath`.** Reconstructed on restore, and every restore path already discarded whatever was saved.
- `storagePath?: string` — Supabase Storage path. **Always preserved.** The only reliable image reference after a restore, and now the only one for any item that has it.
- `productGroup?: string` — ID of the group leader item. All items sharing a group card have the same value.
- `_presetData?: {...}` — Cached preset metadata. **Stripped by `slim()`.** Runtime-only.

#### `WorkflowBatch` (defined in `src/lib/workflowBatchService.ts`)
Mirrors the `workflow_batches` DB row. All four `workflow_state` arrays (`uploadedImages`, `groupedImages`, `sortedImages`, `processedItems`) are typed `PersistedWorkflowItem[]`, but in practice only `processedItems` is ever populated (the other three are saved as `[]`).

#### `SlimWorkflowItem` / `PersistedWorkflowItem` (both in `src/lib/slimItems.ts`)
`SlimWorkflowItem` is what `slimForWorkflowState` WRITES (15 fields — see §11). `PersistedWorkflowItem = SlimWorkflowItem & Partial<ClothingItem>` is what a restore path actually FINDS, because the blob is years old: batches saved before the slimming hold whole `ClothingItem`s, and `duplicateBatch` copies whatever the source had. That intersection is also what lets consumers read `preview` / `seoTitle` / `storagePath` off a persisted item **without a cast**.

**`SlimItem` no longer exists.** It lived in `workflowBatchService.ts` and claimed the blob held 5 fields while the writer had been persisting 15 — the mismatch behind the `as ClothingItem[]` casts scattered through `Library.tsx` and `libraryData.ts` (old §14 #5). The one remaining widening is the named, documented `asClothingItems(items)` helper, which is runtime-identical to the cast it replaced.

---

## 8. State Management Map

Most state lives in `App.tsx`. **Exception (July 2026): the four item arrays** (`uploadedImages`, `groupedImages`, `sortedImages`, `processedItems`) **live in `src/lib/workflowStore.ts`** — a dependency-free store on `useSyncExternalStore`. App.tsx accesses them through `useStoreItemArray(key)` (exact `useState` API, so all setter call sites are unchanged) and module-level `liveArrayRef(key)` views (`.current` always reads live store state — this REPLACED the per-render ref-mirror pattern). Everything else (batch id, UI flags, org state) is still App.tsx `useState`; there is no Redux/Zustand/Context.

| State | Type | Owned By | Mutated By | Read By | Notes |
|---|---|---|---|---|---|
| `user` | `User \| null` | App.tsx | `onAuthStateChange`, `handleSignOut` | All components via props | Supabase User object. |
| `uploadedImages` | `ClothingItem[]` | App.tsx | `handleImagesUploaded`, `handleImagesGrouped` (prune), `handleOpenBatch`, startup restore | `<ImageGrouper>`, `<CategoryZones>` | All 4 arrays are always set together from one source list. |
| `groupedImages` | `ClothingItem[]` | App.tsx | `handleImagesGrouped`, `handleImagesUploaded`, `handleOpenBatch` | `<ImageGrouper>`, `<CategoryZones>` | Should equal `uploadedImages` after Step 2 changes. |
| `sortedImages` | `ClothingItem[]` | App.tsx | `handleImagesSorted`, `handleImagesGrouped`, `handleOpenBatch` | Triggers Step 3 visibility | Should equal `groupedImages` after category assignment. |
| `processedItems` | `ClothingItem[]` | App.tsx | `handleItemsProcessed`, `handleImagesSorted`, `handleOpenBatch` | `<ProductDescriptionGenerator>`, Step 3 subtitle, Step 4 visibility, `<GoogleSheetExporter>` | The single source of truth for what gets exported. |
| `currentBatchId` | `string \| null` | App.tsx | `handleImagesUploaded` (creates new), `handleOpenBatch`, `autoSaveWorkflow` | `registerItemsInDB`, auto-save calls, `<ProductDescriptionGenerator>` key prop | Also mirrored to `localStorage` and `currentBatchIdRef`. |
| `currentBatchIdRef` | `MutableRef<string \| null>` | App.tsx | Same as `currentBatchId` | All async callbacks (autoSave, registerItemsInDB) | Ref mirror to avoid stale closure reads in async code. |
| `showLibrary` | `boolean` | App.tsx | Header button, `handleOpenBatch` closes it | Renders `<Library>` | |
| `libraryRefreshTrigger` | `number` | App.tsx | Incremented on: upload, group change, image delete, Save Batch | `<Library refreshTrigger>` | Library re-fetches when this increments. |
| `categoryPresets` | `CategoryPreset[]` | App.tsx | `getCategoryPresets()` on user login + when `showCategoryPresets` closes | Step 2 right sidebar preset picker | Loaded once; refreshed after `CategoryPresetsManager` modal closes so new presets appear immediately. |
| ~~`processedItems` (local copy)~~ | — | — | — | — | **RETIRED (July 2026, Stage 2b).** PDG reads/writes `workflowStore` directly via `useStoreItemArray('processedItems')` — same list App uses. No local copy, no `isResettingRef`, no prop-sync heuristics. `onProcessed` survives only as an auto-save trigger. |

**Support threads live in a second dependency-free store (Sept 2026):** `src/lib/supportStore.ts` — same `useSyncExternalStore` shape as `workflowStore`. It owns the thread list and the availability flag for **all three** messaging front ends at once (the floating `SupportWidget`, the full-page `MessagesView`, and the header `MessagesNavButton` badge), and it owns the subscription: the first `useSupportThreads` subscriber starts the fetch + the Realtime channel + the 45 s poll, the last unsubscriber stops them. Mount one front end or all three — there is still exactly ONE channel and ONE timer, so no two lists can disagree. **Messages are deliberately not in the store** (the widget and the page may be reading different threads); a `revision` counter ticks once per *completed* refetch and each consumer reloads its own open conversation on `[activeId, revision]`, which covers opening a thread, a Realtime reply, the poll and a send reconciling in one dependency. `handleSignOut` calls `supportStore.reset()` so the next person on the machine never sees a flash of the previous account's conversations.

**Render-cost invariants added Sept 2026 (performance pass) — breaking one is silent:**
- `ImageGrouper`, `CategoryZones`, `ProductDescriptionGenerator`, `GoogleSheetExporter`, `Library` and `SupportWidget` are all wrapped in `React.memo`. **Props passed to them must stay referentially stable**, or the memo is undone with no test failure to catch it. A new inline arrow or inline array literal in one of those JSX blocks is the whole failure mode.
- Handler props therefore go through App's `useEventCallback` helper — `useCallback((...a) => ref.current(...a), [])` with the ref assigned in a layout effect. It gives a permanently stable identity while ALWAYS invoking the newest closure, which is deliberately not `useCallback([deps])`: given this codebase's stale-closure history (§14 #14), a wrong dep list freezes state silently, whereas this construction cannot. Do not "fix" it by reading `ref.current` during render — `react-hooks/refs` rejects that, which is how the current shape was arrived at.
- `step2Items` / `step4ExportItems` name already-stable arrays instead of computing them inline. `step4ExportItems` replaced an inline IIFE that minted a new array every render and by itself defeated the exporter's memo (re-running its whole group/coalesce/dedup/54-column-preview pipeline).
- Every modal (`Library`, `CategoriesManager`, `CategoryPresetsManager`, `OrgPanel`, `VocabDashboard`, `KanbanBoard`) is `React.lazy` behind a `Suspense` fallback that reuses `.loading-screen`/`.spinner`. Anything added to that list needs a boundary too. `Landing`/`Auth`/`WaitlistGate` stay eager — they ARE the first paint.

**Error/analytics identity** is module state, not React state: `setAnalyticsContext` and `setErrorContext` are called side by side when the org resolves, on the waitlist and legacy branches, and cleared in both teardown paths (`!user` and `handleSignOut`). The pageview effect hoists its `view` string so `setErrorContext({ view })` records which screen a crash came from.

**Single source of truth (since July 2026):** `processedItems` lives ONLY in `workflowStore`. App.tsx and PDG both read/write the same store list. PDG shows the full list through its Step-3 visibility filter (inside `buildGroupArray`: categorized items + true multi-image groups); its writes are all targeted per-id/per-group patches, so uncategorized singles in the store are never disturbed. Batch switches remount PDG via `key={currentBatchId}` in App.tsx (resets navigation to group 0).

---

## 9. External Integrations & APIs

### Supabase
- **Auth:** Email/password via `supabase.auth.signInWithPassword` / `signUp`.
- **Database:** Postgres via PostgREST. Tables: `workflow_batches`, `products`, `product_images`, `categories`, `category_presets`.
- **Storage:** Bucket `product-images`. Path pattern: `{userId}/{productId}/{timestamp}-{random}.{ext}`. Public bucket.
- **Realtime:** ONE subscription, in `supportService.subscribeToSupport` — `postgres_changes` for `INSERT` on `support_messages`, and `INSERT` + `UPDATE` on `support_threads`. **Never `event: '*'`**: with `replica identity full` and no RLS on DELETE payloads, a founder deleting a thread would ship its whole OLD row (`user_email`, `subject`, `last_message_preview`) to every subscriber. Deletions are picked up by the 45 s poll. The old `workspace-presence` channel is gone with `useUserPresence`/`LiveWorkspaceSelector` (deleted Sept 2026). **That subscription is OWNED BY `src/lib/supportStore.ts` and reference-counted**: however many messaging front ends are mounted (the floating widget, the Messages page, the header badge), there is exactly ONE channel and ONE 45 s poll timer, started by the first subscriber and stopped by the last. Do not call `subscribeToSupport` — or start a poll — from a component (§18 #27).
- **RLS (tenancy pending):** `supabase/migrations/multi_org_tenancy.sql` exists but may not have been run yet. Once run, it REPLACES everything below with org-membership policies (`org_id IN (SELECT user_org_ids())` on all five data tables) — users see and edit only their own workspace's rows. The client auto-detects which state the DB is in (`orgService.ensureOrganization` returns `legacy` mode when the org tables don't exist) so the same build works before and after. The description below is the PRE-tenancy state:
- **RLS (legacy/current state):** `shared_workspace_rls.sql` opened SELECT to all authenticated users. `collaborative_edit_policies.sql` (June 2026) additionally opens INSERT and UPDATE on `workflow_batches`, `products`, and `product_images` to any authenticated user — this fixed the duplicate-batch fork that happened when a non-owner's auto-save UPDATE was RLS-blocked (0 rows updated → INSERT new batch). **DELETE stays owner-scoped** (`auth.uid() = user_id`); the app works around this by "claiming ownership" (UPDATE `user_id` to the current user, chunked) before deleting another user's batch/listing (commit `308ce2a`). Client code is forward-compatible: it works owner-only if the collab migration hasn't been run. The app does NOT add `.eq('user_id', ...)` filters on reads — it relies entirely on RLS.
- **Edge Functions:** `shopify-titles` (invoked from `GoogleSheetExporter.tsx`, best-effort with silent fallback if not deployed) and `generate-prose` (invoked from `proseService.ts`). Both are hardened as of Sept 2026 — see "Edge Function hardening" below.
- **Quirks:** PostgREST caps rows at 1000 per request **with no error** — a truncated read looks like a complete one, which is how a 1,500-item batch silently lost 500 items' DB fields on every reload and how `deleteWorkflowBatch` permanently orphaned 500 products' images. Everything that can exceed 1,000 rows now paginates with `.range()`: `fetchSavedProducts`, `fetchSavedImages`, `fetchWorkflowBatches`, `deleteWorkflowBatch`'s product-id read, `fetchUserProducts`, and (via App's generic `readAllPages()`) the startup hydration, `handleOpenBatch`'s `savedProducts`, and `pruneStaleProducts`. Large `IN()` lists must be chunked at `ID_CHUNK = 100` (`lib/chunk.ts`) to avoid URL-length 400/414s. **`fetchWorkflowBatchesMeta` is deliberately NOT paginated** — 1,000 *batches* per workspace, ordered `updated_at DESC`, so truncation hides the oldest rather than destroying anything, and paginating would multiply an already ~54 MB blob read.

### Shopify Admin API (read-only, via Edge Function)
- `supabase/functions/shopify-titles/index.ts` pulls every existing product title + handle from the store's Admin GraphQL API (`2024-10`), paginated 250/page with a 200-page cap.
- Purpose: `GoogleSheetExporter.tsx` builds an `existingTitles` set from (1) the app's own `products` table and (2) the live Shopify catalog, and deduplicates CSV export titles/handles against both — prevents Shopify import collisions.
- Credentials: per-org from `org_shopify_connections` (caller's org resolved server-side; token never client-readable). Global `SHOPIFY_STORE`/`SHOPIFY_ADMIN_TOKEN` secrets are the fallback for the Founding Workspace / pre-tenancy legacy mode only; other unconnected orgs get a clean empty response. CORS is open but `verify_jwt` is ON, so only signed-in app users can invoke.
- There is NO write path to Shopify yet — publishing still happens via CSV import.
- `scripts/fetch-taxonomy.mjs` and `scripts/fetch-metaobject-gids.mjs` are one-off local Node scripts hitting the same Admin API for taxonomy/metaobject data pasted into the exporter.

### Cloudflare Workers AI (via Edge Function, opt-in per workspace)
- `supabase/functions/generate-prose/index.ts` → `@cf/meta/llama-3.1-8b-instruct`. It writes ONLY the short selling paragraph; the rule-based template engine still owns the description skeleton, so a model can never corrupt a measurement or a price.
- `src/lib/proseService.ts` VALIDATES every response (15–120 words, `PROSE_BANNED_PHRASES`, no hashtags/links, and a NUMBERS GUARD: every digit run in the prose must appear in the facts it was given). Invalid → `null` → the rule-based output, byte-identical to a workspace that never enabled it.
- **`proseEnabled` defaults to false and is now enforced server-side too** (403 without it), not just in the client.

### There is NO third-party API in this app
The Hugging Face/Llama-vision proxy (`huggingfaceService.ts`, `huggingface-proxy.cjs`, `TestLlamaVision.tsx`, `AISettings.tsx`) and the OpenAI path (`src/services/api.ts`) were **deleted** in Sept 2026 — all five were dead code, none was reachable from the running app, and `apis.google.com` / `api.openai.com` / `localhost:3001` are provably absent from the built bundle. The active description path is and always was `textAIService.ts → generateProductDescription()`, which is pure local rule-based text. The only outbound origins are Supabase (`https://` + `wss://`) and `images.unsplash.com` on the landing page.

### Edge Function hardening (Sept 2026)
- **The anon key is a validly signed project JWT, so `verify_jwt` alone never proved a user.** Both functions now additionally resolve the caller through `/auth/v1/user` and return **401** when there is none.
- `shopify-titles`: the global `SHOPIFY_STORE`/`SHOPIFY_ADMIN_TOKEN` secrets are reachable **only** when the org lookup SUCCEEDED and `organizations.slug = 'founding'`. A failed lookup, no membership, or membership in any other org all return the clean empty result (`{titles:[],handles:[],count:0,source:"none"}`, 200) — the old "legacy mode" escape hatch that dumped the founding store's catalog to any anon-key caller is gone.
- `shopify-titles`: `resolveShopHost()` strips scheme/path/query/port/trailing dot and a trailing `.myshopify.com`, then requires a single DNS label (`^[a-z0-9][a-z0-9-]{0,62}$`) — `evil.com/.myshopify.com`, `evil.com.myshopify.com` and `user:pass@evil.com` all become **400**, closing the SSRF/path-smuggling vector. The global secret is validated the same way.
- `generate-prose`: caller must belong to an org whose `description_settings->>'proseEnabled'` is true (read with the service role) → **403** otherwise; the prompt is bounded (25 fields, 40-char keys, 200-char values, a 4,000-char facts budget, a 300-char style note, 64 KB body → **413**); the untrusted region is fenced (`<<<FACTS … FACTS`, `<<<STYLE … STYLE`) and the system prompt states those blocks are DATA.
- **Neither function echoes an upstream body or an exception string any more.** They `console.error` the status plus a truncated body server-side and return a generic message (`"Shopify request failed."` 502 / `"Fetch failed."` 500 / `"Model unavailable."` 502).
- Deploying them is manual: `deno check supabase/functions/*/index.ts`, then `supabase functions deploy shopify-titles` / `generate-prose`. Both keep `verify_jwt` ON. **After deploying, rotate `SHOPIFY_ADMIN_TOKEN` and `CF_API_TOKEN`** — assume both were reachable by anyone holding the public anon key.

### Content-Security-Policy (`index.html`)
GitHub Pages cannot send response headers, so a `<meta http-equiv="Content-Security-Policy">` is the only enforcement point. It matters here because the Supabase session (access AND refresh token) lives in `localStorage`: any XSS is a persistent account takeover, and this is what makes injected script useless. The policy, with the reason each origin is in it:

| Directive | Value | Why |
|---|---|---|
| `default-src` | `'self'` | Backstop for media/manifest/frame — the app has none of them. |
| `script-src` | `'self'` | The built `index.html` has exactly one `/assets/*.js` module and **no inline script**; no CDN script anywhere. No `'unsafe-eval'` (the bundle's one `new Function` is jszip's setimmediate polyfill on a branch jszip never takes). |
| `style-src` | `'self' 'unsafe-inline'` | The pre-paint `<style>` in `index.html` plus the app's pervasive React `style={{…}}` attributes. |
| `img-src` | `'self' data: blob: https://*.supabase.co https://images.unsplash.com` | Product photos; the Landing page photos; `data:` for the SVG select arrow in `ComprehensiveProductForm.css`; `blob:` for upload previews. The wildcard keeps the policy env-agnostic. |
| `font-src` | `'self' data:` | Nothing is fetched — every `font-family` is a system stack. |
| `connect-src` | `'self' https://*.supabase.co wss://*.supabase.co` | REST/auth/storage/`functions.invoke`, the TUS endpoint, the three raw `fetch()` calls that re-download storage images (EXIF rescan, recompress), and Realtime. `'self'` also covers the dev server's HMR socket (CSP3 `'self'` matches same-origin ws/wss). |
| `worker-src` | `'self'` | `public/sw.js`, same origin at both `/` and `/sortbot/`. |
| `object-src` / `base-uri` | `'none'` / `'none'` | No plugin content; no `<base>`, so an injection cannot re-point every relative URL. |
| `form-action` | `'self'` | Both forms `preventDefault()`; `'self'` rather than `'none'` so a future real post is not silently broken. |

`<meta name="referrer" content="strict-origin-when-cross-origin">` is set explicitly so the Unsplash requests never carry a full app URL. **Two directives are deliberately absent:** `frame-ancestors` (per spec it MUST be ignored in a `<meta>`, so clickjacking protection needs a real header — i.e. moving off GitHub Pages, which also unlocks HSTS and `report-to`) and `upgrade-insecure-requests` (it would rewrite the dev server's `ws://localhost:5173` HMR socket and break `npm run dev`, and buys nothing — there is no `http://` subresource). Dev mode survives because Vite injects its refresh preamble ABOVE the meta tag, and a `<meta>` CSP only governs what is fetched after it is parsed; if a future Vite moves that preamble, the fix is a `transformIndexHtml` plugin that injects the meta only when `command === 'build'`.

### First-party error tracking + uptime (Sept 2026)
**Same rule as analytics/CRM/messaging: no Sentry, no Datadog, no third-party uptime service.** `src/lib/errorReporter.ts` writes one `app_errors` row per uncaught error, rejected promise, or caught render error, straight into this project's own Supabase table (see `app_errors.sql`, **not yet run** — the client latches itself off when the table is missing and `ErrorsPanel` shows a setup hint instead of an error).
- Volume is bounded three ways, because the app is broken when this code runs: one row per fingerprint per 60 s, ≤20 reports per page load (a *suppressed* report does not spend the cap), and a 20-rows-per-session-per-10-min database trigger. A 54000 rate rejection does NOT latch reporting off for the session; a missing table (42P01/PGRST205) does.
- `fingerprintError()` hashes `source | normalizeMessage | normalizeFrame`, stripping the origin, the Vite content hash (`index-BQ3f7x.js` → `index.js`), `:line:col` and digit runs — **so one bug stays one issue across a redeploy**. `app_version` is read from the entry chunk's hash, which needed no `vite.config.ts` change.
- PII is scrubbed from the message AND the stack before either leaves the browser (emails → `[email]`, UUIDs → `[id]` because storage paths are `{userId}/{productId}/…`, long opaque runs → `[token]`). The `user_agent_class` CHECK is a closed vocabulary, so the "browser family, never a full UA" promise is enforced by the database, not just the client.
- It skips localhost unless `sortbot_analytics_force=1`, and **deliberately does not honor Do Not Track** — DNT asks not to be tracked across sites; a crash report about our own broken code is neither behavioural nor cross-site.
- Read path: `app_errors_summary(days)` RPC → **Workspace → Founder tools → Errors** (founding admins only). Retention is manual: `select public.app_errors_prune(90);`.
- Liveness is `.github/workflows/uptime.yml` (§3): two curl probes on a 15-minute cron, incidents as GitHub issues. Not a substitute for the `CSV Exported`-per-day signal in Analytics — a probe cannot see a broken RLS policy.

### Web Speech API
- `ProductDescriptionGenerator.tsx` uses `window.SpeechRecognition` / `window.webkitSpeechRecognition` directly.
- Works in Chrome and Edge. Not supported in Firefox or Safari.
- Continuous mode, interim results enabled.
- Speech auto-corrects common misrecognitions (e.g. "with 18 inches" → "width 18 inches").

### Founder tools — analytics, CRM, messaging: FIRST-PARTY (Sept 2026)
- **THERE IS NO THIRD-PARTY SERVICE BEHIND ANY OF THESE** (user rule: "100% self reliant, not dependent on external APIs"). An earlier same-day pass integrated Twenty CRM / Plausible / Chatwoot (hosted, then self-hosted); it was REPLACED OUTRIGHT by native features and nothing of it ships. Do not reintroduce vendor SDKs, tracking scripts, or external API calls for these capabilities — extend the tables and React instead.
- **Analytics** — `analytics_events` rows written by the browser via `track()` (anon on the landing page too). Privacy: random per-tab session id (sessionStorage), referrer HOST only, coarse device class, own user/org id when signed in; no cookies/IP/UA; Do Not Track honored; localhost skipped. `pageview` fires from an App.tsx effect on every top-level view change (landing/auth/waitlist/app — the effect sits above the early returns so hook order is stable). Dashboard = `analytics_summary(days)` RPC (Founding admins) → `AnalyticsPanel`. Chart is plain HTML (no chart lib): ≤24 px bars, 4 px rounded caps, hairline grid, sparse x labels, per-bar tooltip; single series so no legend; every value also in a table.
- **CRM** — `crm_contacts` / `crm_notes`, Founding admins only. `crm_sync_contacts()` runs on panel open, the Sync button, and after beta approve/deny; it inserts from beta_signups + auth.users/org_members and NEVER overwrites hand edits (name/company fill blanks only; stage only moves forward from lead/approved; tags/follow-ups/notes untouched; founding-org members skipped). Client may UPDATE only name/company/stage/tags/next_follow_up (column grant) — email/source/user_id/org_id are sync-owned.
- **Messaging** — `support_threads` / `support_messages`. One thread = one user; Founding admins see all. `sender_role` is enforced by RLS (a devtools user cannot post as 'founder'). A SECURITY DEFINER trigger maintains last_message_*, reopens closed threads on a new message, and stamps the sender's own read marker. Since Sept 2026 messaging has **two front ends onto one data source**: the floating `SupportWidget` (mounted for every signed-in user, including the waitlist gate) and the full-page `MessagesView` (`activeView === 'messages'`, reached from a header **Messages/Inbox** button with an unread badge). Both — and the badge — read `lib/supportStore`, which owns the single Realtime subscription and the single 45 s poll and reconciles optimistic writes by mirroring the `support_after_message` trigger. Unread = last message from the other side newer than my read stamp (`isUnread`). Known soft spot: the column grant lets a user write `founder_last_read_at` on their own thread — only affects the founders' unread badge for that thread.
- **Finance** — `finance_transactions` / `finance_plan_prices` / `finance_settings` + the `finance_summary(p_from, p_to)` RPC (`SECURITY DEFINER`, 42501 for a non-founder, 22007 on an inverted range), the ONLY read `FinanceView` makes. Everything is our own Postgres: **no payment processor, no accounting service, no bank feed, no external API.** Two rules are implemented twice — in `finance.sql` and in `financeService.ts` — and asserted against the same worked example on both sides, so the chart, the ledger CSV, the P&L CSV and the printed statement can never disagree:
  - **RECURRENCE.** A row with a `recurrence` is a **template expanded at read time**, never a stored repeat, so changing a $20/mo hosting bill to $25 fixes the history and the forecast in one edit and there is no monthly cron to forget. Steps are **ANCHORED** to `occurred_on` (`occurred_on + n × interval`, matching `generate_series`): Jan 31 monthly → Feb 28, **Mar 31**, Apr 30 — it does not drift down to the 28th for good. Consequence: `totals.transaction_count` counts **OCCURRENCES, not ledger rows**, and totals / `by_category` / `by_workspace` all come from the same expansion so every number on the page adds up. The Transactions tab is the one place that shows templates (it is what you edit) and says so in its footer.
  - **FOUNDING DISCOUNT.** A workspace is a founding shop when `plan = 'beta'` **OR** `created_at <= finance_settings.founding_cutoff`; founding shops get `founding_discount_pct` (30) off list, for life. The cutoff is what makes the promise survive the upgrade it exists to reward — moving a beta workspace onto a paid plan changes `plan` but never `created_at`, so a `plan = 'beta'` test alone would silently revoke it. No flag column was added to `organizations`. The summary returns **both** `projected_mrr_list_cents` (everyone at list) and `projected_mrr_cents` (founding shops discounted), because the gap between them is the cost of the founding promise. Both read $0 today — `organizations.plan` only ever holds `free` or `beta` — which is correct, not a bug, and the Customers tab says so in words.
  - `analytics_events` is **optional**: it is read through `to_regclass` + `execute format(…)`, so a missing table yields `customers.active_workspaces: null` (never 0) and the rest of the summary still works.
- **UI**: Analytics (with the Errors sub-tab), CRM and Finance are top-level full-page views gated on the founding workspace (§6); messaging is the floating button **plus** the Messages page every signed-in user gets. All of them hide themselves (`'unavailable'`) until their migration has run, so code ships first.

---

## 10. Core Features & How They Work

### Step 1: Image Upload
**Files:** `ImageUpload.tsx`, `App.tsx:handleImagesUploaded`

1. User drops images, selects a folder (`webkitdirectory`), or drops/selects a ZIP.
2. ZIPs are extracted via JSZip, preserving `lastModified` from zip entry dates.
3. Files are sorted by `lastModified` (capture date order).
4. Each image is canvas-compressed (max 2000 px, JPEG 0.88) then uploaded to Supabase Storage via TUS resumable upload (`tusUpload.ts`, dynamic import) in chunks of 10, in parallel within each chunk.
5. Storage path: `{userId}/{productId}/{timestamp}-{random}.{ext}`.
6. Each image becomes a `ClothingItem` with `{ id, file, preview (CDN URL), imageUrls: [url], storagePath }`.
7. `onImagesUploaded` fires → App.tsx appends to `uploadedImages`, creates a new `batchId` if none exists, upserts stub rows to `products` and `product_images`.
8. `autoSaveWorkflow` is triggered (2s debounce).
9. **Side effect:** `libraryRefreshTrigger` incremented — Library reloads.

**On a phone (Sept 2026).** The drop zone becomes a 260px tap target and the drag copy
is replaced by two buttons: **Take photos** (`<input type="file" accept="image/*"
capture="environment" multiple>`) and **Choose from library** (the same input without
`capture`). A reseller's photos live on their phone, so this is the most natural mobile
action in the product. Both inputs feed the **exact same `processFiles` pipeline** —
compression, EXIF, chunked TUS upload, DB writes are untouched. Two separate inputs
rather than one with a toggled attribute, deliberately: `capture` is only a *hint*, and
some Android builds stop offering the gallery entirely on an input that carries it. Both
buttons `stopPropagation()` on click because they sit inside react-dropzone's root, whose
own `onClick` would otherwise open the generic picker behind the camera sheet. Folder and
ZIP import stay in App.tsx's Step 1 header (restacked full-width at 44px), and the phone
copy points at them.

### Step 2: Group & Categorize
**Files:** `ImageGrouper.tsx`, `CategoryZones.tsx`, `App.tsx:handleImagesGrouped`, `App.tsx:handleImagesSorted`

**Grouping (ImageGrouper):**
- Items start as singles. User selects items (click, Shift+click range, rubber-band drag) and clicks "Group Selected".
- Groups are represented by `item.productGroup = groupLeaderId` (the first item's ID at group creation time).
- Multi-image groups display as a card showing all images.
- Clicking a group card selects the whole group. ↩ button removes one photo from a group. × button deletes all photos in a group.
- `onGrouped` fires on every change → App.tsx updates `groupedImages`, prunes `uploadedImages` for deleted items, syncs `sortedImages`.
- **DB side effect:** Upserts all items' `products` rows with current `product_group`, then prunes stale rows.

**Categorizing (CategoryZones):**
- Categories loaded from Supabase `categories` table on mount.
- User drags a group card onto a category zone, OR selects items and clicks a category.
- `applyPreset()` helper (inside `CategoryZones`) is called: looks up matching preset from the already-loaded `presets` state (no DB fetch), then calls `applyPresetDirectly()` (sync) to apply default shipping/measurement/SEO fields to items. The old `applyPresetToProductGroup()` (async, fetched DB each call) is no longer used in this path.
- `onCategorized` fires → App.tsx updates `sortedImages`, `processedItems`.

**On a phone (Sept 2026) — select, then tap. Dragging is desktop-only.**
- **Drag-to-categorize and drag-to-reorder do not exist on touch** (HTML5 DnD never fires
  there), so the phone path is the second, already-supported one: select photos, then tap
  a category. The "drag photos here to make them individual items" strip is hidden as a
  dead target, and hover-reveal controls are pinned visible since nothing hovers.
- `.step2-split` becomes `display: block` and `.step2-right-panel` becomes a **sticky
  bottom dock** (`bottom: var(--tabbar-h, 0px)`), with CategoryZones' vertical list turned
  into a horizontally scrolling rail of 44px category chips and the Group/Ungroup/Delete
  actions as a 2-up grid. **Sticky, not fixed**: all four step sections are mounted at once
  (§6), so two fixed bottom bars — this one and Step 3's — would stack permanently and float
  over Steps 1 and 4. The dock is capped at 26vh idle and 38vh with a selection, driven by a
  `has-selection` class read through `:not(:has(...))` so an engine without `:has()` drops
  the selector and leaves it expanded (the safe failure).
- **The sidebar becomes a top toolbar with a "Sort, filter & group tools" disclosure**
  (`toolsOpen`). Stats stay visible as a sideways-scrolling rail; everything else folds
  away. It is deliberately **not** sticky — the app's own black nav is sticky at `top: 0`,
  so a second sticky bar there slides underneath it and reads as having vanished.
- **The grid clamps to 3 columns** (group cards to 2) via `responsiveGrid.ts`, with the
  slider still live over the phone range; the stored preference is not mutated.
- `touch-action: pan-y pinch-zoom` on the grids — `pinch-zoom` is kept on purpose (dropping
  it breaks WCAG 1.4.4 on a screen of small garment photos), and declaring anything but
  `auto` also kills the 300ms double-tap delay, which is what makes tap-to-select feel
  instant. Cards get `user-select: none` + `-webkit-touch-callout: none` so a long press
  during a multi-select does not raise iOS's "Save Image..." sheet.
- **Rubber-band selection is left mouse-only** and needs no guard: a tap fires one
  `mousedown`/`mouseup` at the same point and never meets the drag threshold.

### Step 3: Voice Descriptions & AI Generation
**Files:** `ProductDescriptionGenerator.tsx` (~3320 lines), `textAIService.ts`, `ComprehensiveProductForm.tsx`

- `processedItems` are grouped by `productGroup`. Navigation is per-group (one listing at a time).
- **Voice:** User clicks "Start Recording". Web Speech API runs continuously. Transcription appears live.
  - Voice commands parsed: `"brand Nike period"`, `"size large period"`, `"price 45 period"`, etc. (`extractFieldsFromVoice()`)
  - Measurement fields populated from `"width 18 period"`, `"length 28 period"`, etc.
  - Non-command speech goes into the description text.
- **AI generation:** `generateProductDescription()` in `textAIService.ts` calls Hugging Face Inference API (text-only, no vision). Takes voice description + all extracted fields and returns a formatted Shopify-style listing.
- `ComprehensiveProductForm` renders all ~50 product fields as form inputs. Edits propagate to all items in the same `productGroup` simultaneously via `updateGroupField()`.
- Category presets can be applied per-listing via a dropdown, applying default values without overwriting existing voice-set fields.
- On every change, `onProcessed(processedItems)` fires back to App.tsx (auto-save triggers).
- **DB side effect:** `syncGroupFieldsToDatabase()` saves changed fields to the `products` table immediately (not just on "Save Batch"). It writes the group **LEADER** row (`id === productGroup`) through the checked `updateProduct`, then mirrors the same patch onto the remaining members in ONE `.in('id', …)` request — 2 requests per group instead of 1, deliberately: every member row ends up holding the group's fields, so no future re-grouping can strand the text on a row the restore path never reads. Legacy fresh-UUID groups with no leader fall back to member[0], as before.
- **Two independent save timers** (`groupSaveTimerRef` 500 ms store-driven, `directSaveTimerRef` 800 ms direct-write), plus a `pagehide`/`beforeunload` drain that flushes the pending group via `flushProductPatchKeepalive` — a `fetch(..., {keepalive:true})` PATCH straight at PostgREST, because `sendBeacon` cannot send PATCH and PostgREST has no POST-shaped update. The direct path exists because it carries the just-typed value even if the store has not propagated; the cost is that one voice-table edit produces two saves of the same group (and with the leader mirror, up to four requests per edit burst). Known and flagged, not yet collapsed.

**On a phone (Sept 2026) — what was adapted and what was disabled.**
- **Prev / counter / Next / group slider / Download CSV move into a sticky bottom bar**
  (`.preview-nav-dock`, `bottom: var(--tabbar-h, 0px)`). Above 640px that wrapper is
  `display: contents`, so it generates no box and desktop layout is untouched. At phone
  width `.product-preview` also becomes `display: contents` and the dock / image / form
  become three `order`ed siblings — that is what lets the dock be sticky across the WHOLE
  editor rather than being trapped in the preview card, where Prev/Next would disappear the
  moment you started editing fields. DOM order, and therefore tab order, is unchanged.
- **The crop tool was ADAPTED, not disabled.** It already ran on Pointer Events with
  `setPointerCapture`; the only thing missing was a gesture contract. `touch-action: none`
  on `.crop-fs-stage` (correct there and nowhere else — it *is* the gesture surface, it
  lives in a full-screen modal, and it has nothing to scroll), plus a 44px invisible hit
  area on each handle via `::after` while the painted handle stays small, so the rect still
  looks precise. Pinch is not supported: single-finger drag and handle-drag only.
- **The magnifier lens was DISABLED on mouse-less devices.** It is driven purely by
  `mousemove` over the preview, so it can never track a finger. Gated on
  `@media (hover: none) and (pointer: coarse)` — not on width, so a touchscreen laptop keeps
  it — and its settings control is removed too, rather than left as a toggle that does
  nothing.
- Start/Stop Recording becomes a full-width 56px primary button (it is *the* phone action in
  this step); fields stack to one column; measurements go 2-up; the voice command table
  becomes a 2-up card list, which also **fixed a real horizontal-page-scroll bug** — its
  grid template is set inline as `repeat(N, minmax(90px, 1fr))`, so a 5-column row demanded
  450px on a 390px screen (`!important` is the only way to beat an inline style).
- **Form section sub-headers are deliberately NOT sticky** — see §14.

### Step 4: Save & Export
**Files:** `App.tsx:handleSaveBatch`, `productService.ts:saveBatchToDatabase`, `GoogleSheetExporter.tsx`

**Save Batch:**
- Calls `saveBatchToDatabase(processedItems, userId, currentBatchId)`.
- Groups items by `productGroup`. For each group, calls `saveProductToDatabase()` which **upserts** on `id` (safe to call multiple times — updates the existing row, does not create duplicates).
- Images are re-associated using existing `storagePath` — no re-upload.
- After save, prunes stale `products` rows for this batch (items that were deleted during the session).
- `libraryRefreshTrigger` incremented.

**CSV Export (GoogleSheetExporter):**
- Groups items by `productGroup`.
- **Field coalescing:** for each field, takes the first non-blank value across the WHOLE group (not just `group[0]`) — price/brand/size never depend on which item happens to be the representative.
- Builds one product row per group, with multiple `Image Src` columns for multi-image products.
- **Export integrity gates:** export is blocked (alert + banner) if any product has $0 / no price.
- **Title/handle dedup, three sources:** within the export itself (sequential suffixes " 2", " 3"), against the app's own `products` table (paginated), and against the live Shopify catalog via the `shopify-titles` Edge Function (best-effort; silently skipped if not deployed).
- Strips unresolved `{token}` placeholders from all fields.
- Outputs Shopify product import CSV format (63 columns).
- **On a phone (Sept 2026):** the wide preview keeps its own contained scroll and gains a
  **frozen first column** (Handle) at `<= 1024px`, with the header cell at `z-index: 3` so it
  outranks both the inline sticky header row (z 2) and the sticky body cells (z 1);
  `overscroll-behavior-x: contain` stops a sideways pan chaining into the page. The
  price-gate banner moves up to `--fs-base` — it is the one thing here a user must be able
  to read and act on.

### Library
**Files:** `Library.tsx` (~2800 lines), `libraryData.ts`, `libraryService.ts`, `workflowBatchService.ts`

- Modal overlay opened from header. Fetches data on open and when `refreshTrigger` increments.
- `loadAll()` is the single fetch entry point:
  1. `fetchWorkflowBatches()` — gets all batches (shared workspace, no user filter).
  2. `fetchSavedProducts()` + `fetchSavedImages()` — paginated, parallel, no user filter.
  3. Builds `imageList` in two passes:
     - **Pass 1:** workflow_state items (authoritative). Reconstructs CDN URLs from `storagePath` for slim items. Marks batch as "covered."
     - **Pass 2:** DB `product_images` rows, skipping any row whose `product_id` already appeared in pass 1 (per-ITEM dedup — never per-batch; see §11).
  4. Builds `productGroups` list similarly.
  5. Batches missing from `workflow_batches` but present in `products` are synthesized.
- Three tabs: Images, Product Groups (labeled "listings"), Batches.
- Click batch → `onOpenBatch(batch)` → `handleOpenBatch()` in App.tsx.
- `isLoadingRef` prevents overlapping fetch calls. `force=true` bypasses it for mount calls.

### Auto-Save
**Files:** `App.tsx:autoSaveWorkflow`, `workflowBatchService.ts:autoSaveWorkflowBatch`

- Debounced 2 seconds. Called after every significant state change.
- Saves only `processedItems` (slim format — `file`, `preview`, `_presetData` stripped, and `imageUrls`/`thumbnailUrl` omitted whenever `storagePath` can rebuild them: §11).
- The synchronous localStorage crash backup that runs alongside it is **throttled** (`lib/workflowBackup.ts`, 1 s trailing throttle, flushed on `pagehide`/`beforeunload`) — it used to be an un-debounced ~393 KB blocking `setItem` on every call.
- Uses `currentBatchIdRef` (not `currentBatchId` state) to avoid stale closure.
- If batchId is null (session not yet resolved), skips silently.
- If batch no longer exists in DB, creates a new batch.
- **`autoSaveInFlightRef` mutex** — if a Supabase round-trip is already in-flight when the debounce fires, the second fire is skipped entirely; `finally` resets the flag. Prevents two concurrent calls from both seeing "0 rows updated → INSERT new batch" → duplicate rows.
- **Does NOT refresh Library** — auto-save only writes `workflow_state`, not `products/product_images`.

### Batch Restore (Startup)
**Files:** `App.tsx` auth `useEffect`

1. On mount, reads `sortbot_current_batch_id` from localStorage.
2. Fetches batch row from Supabase using `.maybeSingle()`.
3. If not found, clears localStorage.
4. If found with `workflow_state`, reconstructs preview/imageUrls from `storagePath`, sets all 4 arrays, calls `registerItemsInDB`.
5. **Race condition risk:** `registerItemsInDB` is called with `session.user` explicitly because `user` React state hasn't been set yet at this point.

---

## 11. Critical Business Logic

### `slim()` — now `slimForWorkflowState` in `src/lib/slimItems.ts`
A whitelist (not a strip-list): only the fields that CANNOT be recovered from the products/product_images tables survive into `workflow_state` (`id, storagePath, imageUrls, thumbnailUrl, productGroup, category, capturedAt, originalName, imageRotation, crop, originalStoragePath, originalUrl, brandCategory, descriptionEdited, customDescription`). `ultraSlimForBackup` (7 fields) feeds the localStorage backup. Both are unit-tested (`slimItems.test.ts`). It removes `file`, `preview`, `_presetData`, and all DB-recoverable text before saving to `workflow_state`.

**CONTRACT CHANGE (Sept 2026, performance pass): `imageUrls` and `thumbnailUrl` are now persisted ONLY for items with no `storagePath`.** Both are `getPublicUrl(storagePath)` (`thumbnailImageUrl` ignores its size argument), so with a path present all three fields are the same string — and every restore path already rebuilt them and **discarded** whatever was saved (verified site by site before the change: startup restore's own comment says *"rebuild imageUrls entirely from it (ignore saved value)"*; `handleOpenBatch` prefers the reconstruction; `handleImagesGrouped` collapses `imageUrls` to `[canonicalUrl]` on every Step-2 action; `libraryData` pass 1 rebuilds from `storagePath`). Measured **1,066 KB → 508 KB (−52%)** per autosave PATCH at 1,500 items, on a payload re-uploaded every 2 s and WAL-logged each time. **Legacy items keep theirs** — an item with no `storagePath` has no other image reference at all, and dropping its `imageUrls` would lose the picture permanently. One follow-on was required: `createWorkflowBatch` derived `thumbnail_url` from `firstItem.imageUrls[0]` and now falls back to `publicImageUrl(firstItem.storagePath)`. The only observable delta is a group *leader* whose persisted `imageUrls` held N URLs — it now restores with one, and nothing reads `imageUrls[1+]` on a restored item (the CSV's multi-image list is built one URL per group MEMBER).

**The consequence, now covering five fields:** after any page reload, `file`, `preview`, `_presetData`, `imageUrls` and `thumbnailUrl` are empty/undefined on restored items. Every code path that reads restored items MUST reconstruct the URLs from `storagePath` — **through `publicImageUrl()` / `thumbnailImageUrl()` in `src/lib/storageUrls.ts`, never an inline `getPublicUrl` call** (§18 #20). That helper is the single seam the private-bucket/signed-URL migration will change; `grep -rn getPublicUrl src/` must keep returning only `storageUrls.ts` and the test mock. The reconstruction happens in: startup restore, `handleOpenBatch`, `handleImagesGrouped`, and Library's `deriveLibraryData` pass 1.

### DB row → `ClothingItem`: one builder, one merge, two option presets (`src/lib/productRow.ts`)
`productRowToClothingItem(row, htmlToPlain)` replaced two byte-identical 70-line copies in App.tsx (the "`workflow_state` is empty" rebuild and the gap-fill path). `mergeProductRowIntoItem(item, row, htmlToPlain, opts)` replaced the two 45-field restore merges — and the **seven** ways those two paths differ are now explicit options rather than an accident: `coerceEmptyStrings`, `imageStrategy`, `descriptionStrategy`, `defaultStatus`, `defaultEmptyMeasurements`, `setProductGroup`, `setOriginalName`/`setAppliedPresetId`. Use `STARTUP_MERGE_OPTIONS` or `OPEN_BATCH_MERGE_OPTIONS`; do not invent a third preset casually.

**`imageStrategy` is the one that matters.** Startup is `'db-group-wins'`; `handleOpenBatch` is `'own-image-wins'` — and that is not an accident, it is commit `3a70b52`. The row is matched at the GROUP level, so `row.product_images` is the whole group's photo list; preferring it there made every member of a group show the same photo. Unifying the two on the startup semantics would reintroduce that bug. `htmlToPlain` is injected because `htmlDescToPlain` lives in App.tsx, which imports this module. 39 tests.

### `autoSaveWorkflow` saves ONLY ONE LIST
The auto-save stores only the most-progressed list as `processedItems`, with the other three arrays set to `[]`. The fallback chain on restore is: `processedItems → sortedImages → groupedImages → uploadedImages`. Never break this chain. If you add a new array to `workflow_state`, you must also add it to the fallback chain in `handleOpenBatch` and startup restore.

### `registerItemsInDB` uses hybrid delete-then-upsert — now with `mergeProductImageRows`
`product_images` rows for a batch are still **deleted** before re-inserting (via `upsert` with `ignoreDuplicates: true` so concurrent calls don't 409). This prevents stale row accumulation from sessions where the public URL changed. **Sept 2026: the wipe is no longer destructive to a group's other photos.** The function reads the FULL existing row set for those product IDs, runs `mergeProductImageRows(computed, existing)` (`lib/imageRowSync.ts`), and re-inserts everything still valid with its position. Merge rules:
1. A computed row replaces the existing row for the **same `storage_path`** in place — so a regenerated CDN URL keeps its slot instead of jumping to primary. Then by `image_url`.
2. A leftover row pointing at a file we just re-wrote under a different URL **is** the stale row the wipe exists for, and is dropped.
3. Everything else is carried forward, and positions are renumbered 0..n-1 in that order.
4. **If the existing-row read fails, the wipe is skipped entirely** and only the computed rows are upserted — never destroy what you could not read.

Cost: one extra chunked SELECT per open (it replaced the previously-conditional `original_name` read). The `products` upsert uses `ignoreDuplicates: true` on `id` and must NEVER overwrite `batch_id` (doing so "stole" items across batches and made gap-fill grow unboundedly); the two Step-2 `products` upserts no longer send `batch_id` at all, though they still send `user_id` because they must be able to INSERT and that column is NOT NULL + RLS-checked. Do NOT change any of this without understanding why. See commits `a14876d`, `8ab4e6a`, `7d146ec` and `docs/reviews/02-debugging-fixes.md` findings 6 and 16.

**Chunk size — `ID_CHUNK = 100` in `src/lib/chunk.ts`:** every bulk `IN()`/delete/upsert is chunked at 100 IDs, because PostgREST answers a longer URL with a 400/414 (it broke at ~794 IDs). `chunked(xs)` replaced 18 hand-written loops spelled six different ways (`DELETE_CHUNK_SIZE`, `CHUNK`, `OCHUNK`, bare `100`s); the boundary cases each of them had to get right independently (0, 1, 99, 100, 101) are now pinned by 7 tests. Do NOT remove the chunking — it is one helper now, not one loop per site. The two EXIF-rescan loops pass an explicit `5` **with a comment**, because they bound *concurrency*, not URL length; keep that distinction visible.

### `saveBatchToDatabase` batches its `product_images` writes
The per-group loop only PREPARES rows; one chunked upsert (≤100 rows/request) runs after it. For 1,500 images / 375 groups that is **1,875 → 750 round trips** (per group 5 → 2; a pathological 1,500-photo group goes 1,501 → 16). Row content is byte-identical and an upsert error still fails the whole group, so the `success`/`failed` tallies are unchanged. **`buildProductImageRow()` is deliberately NOT used here** — it sets `product_id: item.id` (not the group leader), `storage_path: item.storagePath`, a different `alt_text` and an extra `original_name`; substituting it would change what lands in the DB. The inline literal carries a comment saying so.

### Two writers to one `workflow_state` blob — compare-and-set
`removeItemsFromWorkflowBatch` (Library) read-modify-writes the same blob App's auto-save blind-UPDATEs every 2 s, so `Library READ → App UPDATE → Library UPDATE` silently discarded everything App wrote in between. It is now **compare-and-set**: the SELECT also reads `updated_at`, the UPDATE carries `.eq('updated_at', <that value>).select('id')`, and a 0-row result means someone wrote in between → re-read and re-apply **once**, then give up with a `console.warn` rather than loop. The token is reliable because a BEFORE UPDATE trigger stamps `updated_at = NOW()` on every write to this table (`create_workflow_batches.sql`). On the normal path the guard matches first try and behaviour is unchanged. **Do not remove the guard** (§18 #21). The *item-level resurrection* half of this bug is still open — see §14 #19.

### The decoded-image cache is a byte-budgeted LRU
`imageTransforms.ts` keeps decoded `HTMLImageElement`s so paste-crop across hundreds of photos never re-fetches. It used to be unbounded: at ~4 MB of RGBA per 1,000×1,000 image that is ~24 GB for 1,500 images, and the tab OOM'd at 130–250. Now `IMG_CACHE_MAX_BYTES = 512 MB`, each entry charged `naturalWidth*naturalHeight*4` (4 MB fallback when dimensions are unknown), reads move the key to the MRU end, inserts evict from the front until the new entry fits, and an image larger than the whole budget is simply never cached (so the eviction loop cannot spin). A cache miss is exactly the never-cached path — a re-fetch — so no batch operation may *depend* on residency.

### `handleOpenBatch` double-fire guard
`isOpeningBatchRef` prevents the function from running twice simultaneously (React StrictMode double-invokes). If you restructure this function, ensure the guard is still in place. The lock is released in `finally {}`.

### Two-pass imageList dedup — now in `lib/libraryData.ts` (`deriveLibraryData`)
Pass 1 adds each item's `product_id` to a `wfItemIds` Set when building the imageList from `workflow_state`. Pass 2 skips any `product_images` DB row whose `product_id` is already in `wfItemIds`. This prevents double-counting while still surfacing DB items absent from (corrupted/partial) `workflow_state`. Do NOT revert this back to a batch-level skip (`batchIdsCoveredByWfState` Set) — that pattern was removed in commit `69dd319` because it incorrectly hid loose images for batches that had a partial `workflow_state`. (The leftover unused `batchIdsCoveredByWfState` set was dropped during the July 2026 extraction.) These rules are locked in by `libraryData.test.ts`.

### `productGroup` — leader convention, tolerantly resolved
When grouping items, all items in the group receive `productGroup = firstItem.id` (the "leader" is the item whose `id === productGroup`). **History (July 2026):** `createGroupFromSelected` and `applyAutoGrouping` had drifted to fresh `crypto.randomUUID()` group ids, which Step 3's old leader-only validation rejected — every item silently became its own listing (the §16 "Next navigates per-image" mystery bug). Both functions now use the leader convention again, AND `lib/grouping.ts:buildGroupArray` resolves group ids tolerantly (a productGroup is real when it matches an item id OR ≥2 items share it), so historical fresh-UUID batches heal without regrouping. `saveBatchToDatabase`, CSV export, CategoryZones, and Library all group by the shared value and tolerate both conventions. Keep new code on the leader convention.

### Magic number: `2000` (autoSave debounce)
The auto-save debounce is 2000ms. This was tuned to avoid a race where PDG's `onProcessed` fires rapidly during batch switches. Do not reduce below 1000ms.

### Magic number: `24 * 60 * 60 * 1000` (orphan product search window)
`handleOpenBatch` searches for orphaned products within ±24h of the batch creation time. This is a fallback when `batch_id` was not set on products. It's a broad heuristic that could match wrong products if multiple batches were created close together.

### Gap-fill safety cap in `handleOpenBatch`
When the DB returns more products "missing" from `workflow_state` than the cap `max(workflowItems.length × 2, 50)`, they are treated as stolen batch IDs rather than legitimate gap-fill candidates. The stolen rows are **deleted** (not nullified) in the background: `product_images` first (FK constraint), then `products`, in chunks of 100. The cap formula gives 2× headroom for legitimate gap-fill. Do NOT change the cleanup from DELETE back to `UPDATE batch_id=null` — that causes an infinite loop where the nullified rows reappear in Library as Unassigned, get assigned to the batch by mistake, and get deleted again on next open.

### Library "Unassigned" section and why there is no "Assign" button
Products with `batch_id = null` surface in Library's Images view under a separate "Unassigned" section. These are orphaned duplicate rows. There is intentionally NO "assign to batch" feature: assigning them to any batch puts them back in the gap-fill query → gap-fill cap fires → they get deleted again → infinite loop. Only the "🗑 Delete all unassigned" button is offered. Do NOT re-add an assign button.

---

## 12. Component Dependency Map

### `App.tsx` (~3075 lines)
The root of everything. It is doing far too much:
- Auth management
- Batch lifecycle (create, restore, save, clear)
- All 4 step orchestrations
- Auto-save logic
- `registerItemsInDB` (writes to DB)
- `handleOpenBatch` (300+ line function)
- All state that flows down to every component, plus the memoization scaffolding (`useEventCallback`, `step2Items`, `step4ExportItems`) and the `React.lazy` modal boundaries
- `readAllPages()` — the generic paginated-select drain shared by the three restore/prune queries
- `installErrorReporter()` at module scope and `GrouperErrorBoundary`

It got ~270 lines SHORTER in Sept 2026 despite the additions, because four field-by-field DB-row copies moved to `lib/productRow.ts`, ~23 inline `getPublicUrl` expressions to `lib/storageUrls.ts`, 10 chunking loops to `lib/chunk.ts` and the crash backup to `lib/workflowBackup.ts`. The remaining split worth doing is `batchRestore.ts` (`handleOpenBatch` + startup restore, ~900 lines) — deliberately not attempted without characterization tests first.

**What depends on App.tsx:** Every component.
**What App.tsx depends on:** `workflowBatchService`, `productService`, `productRow`, `storageUrls`, `chunk`, `slimItems`, `workflowBackup`, `errorReporter`, `swCache`, `supabase` directly, all step components.

### `ProductDescriptionGenerator.tsx` (~3320 lines)
Also doing too much:
- Voice recording lifecycle
- AI generation
- Per-item field editing (ComprehensiveProductForm embedded)
- Group navigation
- Preset application + per-group preset override (`selectedPresetId`, persisted via `applied_preset_id` / `productType` DB columns)
- DB sync on every change (`syncGroupFieldsToDatabase`) + debounced 500 ms auto-save with `beforeunload` flush
- Photo reorder within a group
- Crop/zoom tool with copy-crop → paste-crop across many items (canvas re-encode + re-upload to same storagePath)
- Lightbox + magnifier lens
- VoiceCommandTable rendering and cell-edit handling

**Risk:** it writes to the SHARED `workflowStore` list (its local copy and `isResettingRef` were retired in July 2026), so every write must be a targeted per-id/per-group patch — a wholesale replace built from the filtered display groups wipes uncategorized singles (§18 #11). Its two save timers plus the leader-mirror write mean one field edit can issue up to four requests; the 500 ms effect is still keyed on the whole `[processedItems]` array, which is the next thing to fix and needs a locking test first (§14 #21).

### `Library.tsx` (~2800 lines)
Standalone modal. Fetches its own data independently of App.tsx state. Communicates back via `onOpenBatch` callback only.

**Risk:** `loadAll` is complex. The two-pass imageList build has subtle ordering dependencies. The `isLoadingRef` guard means a forced mount call and a refreshTrigger call can race if both fire in the same render.

### `ImageGrouper.tsx` → `App.tsx`
`onGrouped` fires on every single group/ungroup/delete action, which triggers `handleImagesGrouped` in App.tsx, which upserts to DB, which calls `setLibraryRefreshTrigger`, which causes Library to reload. High DB write frequency during active grouping sessions.

---

## 13. Conventions In Use

### Component Style
All components are functional React components with hooks. No class components. No context providers.

### Naming
- Components: PascalCase files and function names.
- Services/hooks/libs: camelCase files.
- CSS: co-located file per component (e.g. `Library.tsx` + `Library.css`).
- Event handlers: `handle[Action]` in App.tsx, `on[Action]` as prop names.

### Export Patterns
- Components: `default export` (most) or named export (`export const Library`, `export const ComprehensiveProductForm`).
- Libs: named exports only.
- Types/interfaces: named exports.

### Styling
Plain CSS files co-located with components. No CSS modules, no Tailwind, no CSS-in-JS. Class names are not scoped — global namespace. Use BEM-style or descriptive class names to avoid collisions.

### State Management Pattern
All state in App.tsx, passed down as props. No Context. No global store. Callbacks flow up via `onX` props.

### Data Fetching Pattern
Direct Supabase client calls in service files (`src/lib/`). No React Query, no SWR. No loading state abstraction — each component manages its own loading state.

### Error Handling Pattern
- Supabase errors: check `if (error) throw error` or `console.error + return []`.
- Component errors: `try/catch` with console.error, silent fallbacks.
- **One error boundary exists** — `GrouperErrorBoundary` in App.tsx, wrapping Step 2. It keeps its `console.error` AND calls `reportError(error, { source: 'boundary', component })`, because a boundary is the only place a render crash is observable. There is no boundary around Steps 1/3/4 or the modals.
- **Uncaught errors and rejected promises are reported** to `app_errors` by `installErrorReporter()` (§9). `console.error` / `console.warn` are still the right call for a handled failure — they report something real and must stay visible. `console.log` / `debug` / `table` are NOT (see below).
- Most failures are still silent to the user. `Library` has a `.library-delete-error` banner; `App` has toasts. Adding a user-facing error path is usually the right call.

### Logging
Every diagnostic goes through `log.*` / `dbg()` from `lib/debugLogger.ts`. `grep -rnE 'console\.(log|debug|table)' src/` returns exactly **one** line: the `console.table` in `ImageGrouper.tsx`, kept because the logger has no table equivalent and **gated inside `if (isDebugEnabled())`** along with its surrounding `console.group`/`groupEnd`. **`log.*` arguments are evaluated eagerly even when debug is off** — the early return removes the output, not the work — so any log whose arguments build an object, `.filter()` a batch, `.map().join()`, or call `new Error().stack` must ALSO be wrapped in `if (isDebugEnabled())`. Emoji inside log strings and comments are fine; in rendered UI they are not (§1).

### Two Conflicting Patterns for DB Writes
- `registerItemsInDB`: hybrid delete-then-upsert for `product_images` (delete chunked, then `upsert` with `ignoreDuplicates: true`).
- `handleImagesUploaded` upload path: upsert with `ignoreDuplicates: true` for `product_images`.
- **Follow the hybrid pattern** for writes that happen after a full restore/open. Use plain upsert with `ignoreDuplicates: true` only for fresh first-time upload writes where no stale rows can exist.

---

## 14. Known Bugs & Fragile Areas

> Sept 2026: the engineering review (`docs/reviews/`) closed nine of these. Resolved entries are kept, marked, and cite the pass that fixed them — an agent who finds the old symptom needs to know it was deliberate work, not luck.

1. **Startup restore always calls `registerItemsInDB`** even if the batch was just viewed and nothing changed. It still deletes and re-inserts `product_images` rows on every page refresh — wasteful, not harmful. **The harmful half is FIXED** (debugging pass, finding 16): the wipe now goes through `mergeProductImageRows`, so a group's other photos and any row it could not recompute survive, and a failed read skips the wipe entirely (§11).

2. **`getCategories()` in `categoriesService.ts` has no user_id filter** — it returns all active categories the caller can SELECT. Intentional for the shared workspace (and correct under org RLS), but pre-tenancy it means one user's custom categories are visible to all.

3. ~~`SavedProducts.tsx` is dead code~~ — **RESOLVED (refactor pass):** the file is deleted, along with 19 other dead files.

4. ~~`services/api.ts` is a second AI description path~~ — **RESOLVED (refactor pass):** deleted. `textAIService.ts` is the only description path, and no third-party AI API remains in the tree (§9).

5. ~~`workflow_state` type mismatch (`ClothingItem[] | SlimItem[]`, casts everywhere)~~ — **RESOLVED (refactor pass):** `SlimItem` is gone; all four `workflow_state` arrays are `PersistedWorkflowItem[]`, and the only widening is the named `asClothingItems()` (§7). The casts in `Library.tsx` and `libraryData.ts` were removed, not relocated.

6. **`batch_name` is null in many batches** — saved as `null` (not a string) and the code doesn't consistently handle it. `batchName="null"` appears in logs. Any display code must use `batch.batch_name || 'fallback'`.

7. **`autoSaveWorkflow` captures stale closure state** — it receives a `workflowState` parameter that was current at call time, but the 2 s debounce means it fires after further state changes. `slimForWorkflowState(live)` picking the most-progressed list partially mitigates this; the passed object may still be stale.

8. **The dangerous one-shot storage cleanup is GONE** (debugging pass). The `sortbot_orphan_cleanup_v3` effect ran three unscoped `delete().like('storage_path','%prefix%')` statements with no `user_id`/`org_id` filter — under the shared Founding Workspace it deleted other members' `product_images` rows, and under org RLS it could reach another workspace's. It had already run in every existing browser (the localStorage guard), so removing it changed nothing for existing users. **Do not re-add it** (§18 #19).

9. **`proxy.log` is in `.gitignore`** and never tracked by git. The file still sits in the repo root; safe to ignore (the proxy that wrote it is deleted).

10. **`productService.ts:saveProductToDatabase` upserts on `id`** — fixed long ago. Calling "Save Batch" repeatedly updates the existing row instead of creating duplicates.

11. **`initializeItems` in `ImageGrouper.tsx` previously had a stale-closure bug** — the `useEffect([items])` captured `groupedItems` at effect-creation time, so every prop change saw empty `existingIds` and re-triggered the loading spinner. Fixed by `groupedItemsRef` (commit `fe22a7e`).

12. **Rubber-band `useEffect` has an `[isSelecting]`-only dep array with an `eslint-disable` comment.** Intentional: everything else is read through refs, which are stable, so adding them changes nothing and would re-introduce the listener-churn bug. **Sept 2026 inverted one relationship inside it:** `selectionBoxRef` is now the SOURCE OF TRUTH (it used to mirror the state). `mousemove` and the auto-scroll step write only the ref; the rAF loop already running for the drag flushes it to state at most once per frame and skips the commit when the rect has not moved. Both mouseup paths and mousedown clear both refs so a rect cannot bleed across drags.

13. ~~`handleApplyPreset` routes through `handleImagesSorted`~~ — **no longer applicable.** Neither `handleApplyPreset` nor the Step-2 sidebar preset buttons exist any more (they were already gone before this review). Presets are applied by `CategoryZones` (sync `applyPresetDirectly`, no per-group fetch) and by PDG's per-listing dropdown.

14. **Ref mirror pattern RETIRED (July 2026) — the names live on as store views.** `sortedImagesRef`, `groupedImagesRef`, `uploadedImagesRef`, `processedItemsRef` are module-level `liveArrayRef()` views into `workflowStore` whose `.current` getter ALWAYS reads live store state, so staleness is impossible by construction. The rule for new async handlers is unchanged: read `xxxRef.current` (or `workflowStore.getState()`), never the render-captured variable. `.current` is fresh IMMEDIATELY after a setter call, which is what lets the EXIF-rescan auto-saves sit outside the `setProcessedItems` updater (they used to be inside it — a side effect in a state updater, which StrictMode double-invokes).

15. ~~Raw `console.log` calls have crept back in (~100 across 5 files)~~ — **RESOLVED (refactor pass, 76 sites):** everything is routed through `log.*`, and every log whose arguments do real work is additionally wrapped in `isDebugEnabled()` — the per-item restore audits, `ImageGrouper`'s `new Error().stack` on every selection change, PDG's 11-key navigation payload, the per-file compression log, `[imgCache]` HIT/MISS, the per-chunk TUS log. **One `console.table` remains by design** in `ImageGrouper.tsx`, gated with its `console.group`/`groupEnd`. `console.error`/`console.warn` were deliberately left alone (§13).

16. **Base font-size is 9 px** (commit `0eae362`) — deliberate, to replicate the user's preferred 67%-zoom look at 100%. All `rem` values are relative to this; new `rem` CSS will look ~2/3 the size you expect. Type uses the px `--fs-*` ramp instead (§1).

17. **`capturedAt` has no live DB column yet.** `stage4_slim_fields.sql` adds `product_images.captured_at`, and `buildProductImageRow` writes it, but **only once the feature probe sees the column** — the migration has not been run, so today `capturedAt` still lives only in `workflow_state.processedItems`. Items gap-filled from the DB therefore show no date label on their Step 2 card. Recovery is automatic on batch open (the EXIF rescan fires for any batch with items missing `capturedAt`); the manual Step 1 button still exists.

### Still open, found by the Sept 2026 review

18. **Cancelling an upload can leave an empty ghost batch row.** Cancel now deletes the `product_images` and `products` rows for every item it had already emitted (chunked, rows BEFORE files, so a failed row delete leaves a recoverable situation) and calls `onUploadCancelled` so App prunes the store. But `handleImagesUploaded` pre-inserts the `workflow_batches` stub row when it mints the batch id, and cancelling during the first chunk leaves that row behind as an empty batch in the Library.

19. **Deleting an image in Library while its batch is OPEN can resurrect it.** `removeItemsFromWorkflowBatch` is compare-and-set now (§11), which fixes the *lost update* — but App's in-memory store is never told about the deletion, so its next auto-save (≤2 s) writes the item back. No CAS can fix that: App's blob is genuinely newer, just wrong. The fix is an `onItemsDeleted(ids)` callback mirroring `onBatchDeleted`, pruning all four store arrays and re-saving — **deliberately not implemented**, because it is a behaviour change (deleting an image in Library would start actually removing it) and needs the owner's call. Library also still discards the `false` return, so a lost race is only visible in the console; routing it through the existing `.library-delete-error` banner is a small follow-up.

20. **`ImageGrouper` keeps a third copy of the item list.** `const [groupedItems, setGroupedItems] = useState<ClothingItem[]>([])` is initialized from the `items` prop and reconciled by effects — the same duplicate-state shape that produced the July 2026 preset saga in PDG. Migrating it onto `workflowStore` was explicitly not attempted without characterization tests first.

21. **PDG's save effect is keyed on the whole `[processedItems]` array**, so it re-arms on every store write rather than on a change to the group being edited. Combined with the two save timers and the leader-mirror write, one field edit can issue up to four requests. The report says this needs a locking test before it is touched — it is the path the June 2026 persistence saga fixed, and breaking it silently loses a user's typing.

22. **The Step 4 export preview renders EVERY product × 54 columns.** §15 claims "shows up to 10 products"; the cap was lost. At 375 groups that is ~20,250 `<td>`s with inline styles, inside an always-mounted `<details>` that only CSS hides. The memoization pass made it build on item change rather than every render, but the cap itself was deliberately not re-added (a visible change, and the pass's gate was no behaviour change). The one-line diff is in `docs/reviews/03-performance-fixes.md`.

23. **The two Step-2 `products` upserts can now CREATE a row with `batch_id = null`**, which surfaces in Library's "Unassigned" section until the upload/registration path assigns it. That is the deliberate trade for removing `batch_id` from those payloads: visible and deletable, versus the previous silent cross-batch theft. Do not "fix" it by putting `batch_id` back (§18 #3).

24. **`fetchWorkflowBatchesMeta` is still capped at 1,000 batches** (PostgREST's silent max-rows). Left as-is on purpose: it is ordered `updated_at DESC`, so truncation hides the oldest batches rather than destroying anything, and paginating it would multiply an already ~54 MB blob read. The real fix is retiring the `workflow_state` blob (Stage 4).

25. **`fetchStorageUsage` issues one sequential Storage `list()` per product folder** — ~2,500 round trips for the largest existing user (perf finding F9, outside the review's scope). It is why the storage meter can take a long time on a large bucket.

### Open after the Sept 2026 mobile-first pass

26. **No signed-in mobile smoke test has been run.** None of the three agents could sign in,
    so the header, rail, tab bar, More sheet, `ToolView`, the support panel, all thirteen tool
    views and all four workflow steps were verified from the CSS and the JSX, not from a
    rendered signed-in app. The shell was photographed by injecting the exact markup `App`
    renders into the live landing page (which loads the same CSS bundle) at 360/390/820/1280 —
    that proves the cascade, not the React wiring. **Owed:** Workflow -> Library -> More -> CRM
    -> Back on a real phone, plus Steps 1-4 end to end. Everything the logs list as unverified
    is single-number CSS tuning, not structure — the specific list is in
    `10-mobile-pages.md` §5 and `10-mobile-workflow.md` §10.

27. **No real-iOS pass.** Chrome's device emulator font-boosts some text even with
    `text-size-adjust: 100%` (a DevTools quirk; real iOS does not), so the screenshots run
    slightly large — a conservative bias for overflow checks, but it means the 16px input rule
    was confirmed from the declared CSS rather than the computed value. `--fs-md` was confirmed
    to resolve to exactly 16px. Also unverified on a real device: `capture="environment"`
    behaviour on iOS Safari and Chrome Android (including multi-select from the camera roll),
    crop-on-touch end to end, `:has()` on the founder's actual browser, and whether the Step-2
    56vh grid scroller plus the 26-38vh category dock still add up on a short phone (iPhone SE).

28. **The preset editor's ten sections start OPEN on phones, not collapsed.** They are real
    `<details open>` elements (inert on desktop — the summary is `pointer-events: none` above
    640px, so desktop behaviour is byte-for-byte what it was). Shipping them collapsed at one
    breakpoint only would need either a `matchMedia`-driven `open` prop — synchronous setState
    in an effect, which react-hooks v7 forbids — or overriding the UA's closed-`<details>`
    behaviour from CSS, which is not spec-guaranteed and breaks differently per engine.
    Collapsible-but-open is the portable half of the win. Deliberate partial.

29. **Step 3's form section sub-headers are deliberately NOT `position: sticky`.** A sticky
    sub-header at `top: 0` slides under the app's own sticky black nav (z-index 100), whose
    height is owned by another surface and varies with header wrapping, so it would read as
    simply disappearing — and any hard-coded `top` offset is a guess that breaks when the nav
    changes. `.form-section-title` is a full-bleed tinted strip with a bottom rule instead. The
    reason is repeated in a comment at the rule. Revisit if an `--app-header-h` token ever
    lands (the Step-2 grid's own 56vh inner scroller, `10-mobile-workflow.md` §8.2, is the
    other thing waiting on that token).

## 15. What's Done

- ✅ Email/password auth via Supabase
- ✅ Image upload: drag-drop, folder import, ZIP import, Supabase Storage
- ✅ Step 2 grouping: multi-select (click, Shift+click range, rubber-band), group/ungroup, remove-from-group, delete — all four multiselect bugs fixed (commit c7344c4)
- ✅ Category assignment: drag groups to category zones, click-to-assign with selection, or apply preset buttons in right sidebar (assigns category + shipping/SEO defaults in one click)
- ✅ Voice recording via Web Speech API with field command parsing
- ✅ AI-powered product description generation via Hugging Face text model
- ✅ Comprehensive product form (50+ fields)
- ✅ Category Presets (per-category defaults for shipping, measurements, SEO templates)
- ✅ Custom Categories (CRUD with emoji/color/icon/sort)
- ✅ Shopify CSV export with multi-image support and title deduplication
- ✅ Auto-save to Supabase every 2s (debounced)
- ✅ Session restore on page reload (from localStorage + workflow_state)
- ✅ Library modal: batches, product groups, images tabs with counts
- ✅ Library: batch open/restore from DB
- ✅ Library: batch delete (cascade: products, images, storage files)
- ✅ Library: batch rename
- ✅ Library: rubber-band selection, multi-select
- ✅ Shared workspace: all users see all batches (RLS + no user_id filter)
- ✅ Delete-then-insert strategy preventing product_images row accumulation
- ✅ `saveProductToDatabase` upserts on `id` — safe to call Save Batch multiple times
- ✅ Dead components (`SavedProducts`, `TestLlamaVision`, `LiveWorkspaceSelector`, `RemoteCursors`, `AISettings`) marked with `// UNUSED` banners — **all six are DELETED as of Sept 2026** (see the refactor entry below)
- ✅ Dead dependencies removed from `package.json` (`axios`, `react-speech-recognition`, `@google-cloud/vision`, `@huggingface/inference`, `openai`, `cors`, `express`, `node-fetch`)
- ✅ `proxy.log` added to `.gitignore`
- ✅ ~140 stale root-level `.md` files deleted; only `README.md`, `CLAUDE.md`, `CHANGELOG.md` remain
- ✅ `.github/copilot-instructions.md` updated to point to `CLAUDE.md`
- ✅ Batch open performance: `getThumbnailUrl()` (plain CDN URL) used for ImageGrouper card `<img>` tags; `loading="lazy"` on both bare `<img>` tags in ImageGrouper; state set immediately from `workflowItems` before DB product fetch so images render before descriptions load; `registerItemsInDB` skipped when re-opening the already-active batch
- ✅ `getThumbnailUrl()` returns plain CDN URL — Supabase Storage transform API requires paid Pro plan; free-tier transform URLs return errors, so transform params are intentionally omitted
- ✅ `registerItemsInDB` deletes chunked to 100 IDs at a time (`DELETE_CHUNK_SIZE = 100`) — PostgREST 400 URL-length limit hit with 794+ IDs in a single `IN()` clause
- ✅ Library batches sorted newest-first: `fetchWorkflowBatches` uses `updated_at DESC`, Library client-side also sorts `finalBatches` by `updated_at` descending before `setBatches()`
- ✅ Cursor-following magnifier lens on main preview image in Step 3 — circular 200×200px `.magnifier-lens` (position fixed, pointer-events none) follows cursor over the `preview-image-wrap` div, showing a 3× zoomed region via CSS `background-image`/`background-position`/`background-size: 300%`
- ✅ Category preset picker in Step 2 right sidebar — when items are selected, a green pill-button per active preset appears below the grouper action buttons; clicking applies the preset (category, shipping defaults, SEO template) to all selected items via `handleApplyPreset` → `applyPresetToProductGroup` → `handleImagesSorted`; presets loaded from DB on login and refreshed when `CategoryPresetsManager` modal closes (commit `0530e9f`)
- ✅ `initializeItems` stale-closure fix in `ImageGrouper.tsx` — added `groupedItemsRef` (ref mirror of `groupedItems` state) so the `useEffect([items])` always reads live local state; previously the stale closure caused every group/ungroup action to see `existingIds` as empty, falsely treating all items as "new" and re-triggering the loading spinner (commit `fe22a7e`)
- ⚠️ All `console.log` calls removed from entire codebase — regressed, then **closed again in Sept 2026** (§14 #15: 76 sites routed through the gated logger, one intentional gated `console.table` left). Historical detail (174 calls across 8 files: `App.tsx`, `Library.tsx`, `ImageGrouper.tsx`, `ImageUpload.tsx`, `ProductDescriptionGenerator.tsx`, `ImageSorter.tsx`, `workflowBatchService.ts`, `libraryService.ts`). Variables that existed solely to feed removed log calls also cleaned up (`withStoragePath`, `withImageUrls`, `imgCount`, `action`, `count`, `multiCount`, `wfItems`). (commit `9021611`)
- ✅ Centralized debug logger (`src/lib/debugLogger.ts`) — single module with `dbg()`, `log.X()` category wrappers (`log.app`, `log.library`, `log.grouper`, `log.upload`, `log.pdg`, `log.sorter`, `log.service`, `log.db`, `log.auth`, `log.dom`, `log.error`), `setDebugEnabled()`, `isDebugEnabled()`. Zero-cost when disabled (`window.__SORTBOT_DEBUG__` guard). When enabled: attaches DOM event listeners for click, dblclick, contextmenu, mousedown/up/move (100ms throttle), keydown/up, dragstart/over/enter/leave/drop/dragend, scroll (throttled), selectionchange, focusin/out, input, change. State persisted to localStorage key `sortbot_debug_enabled`. Debug toggle button (🐛 Bug icon) rendered as a fixed bottom-left corner overlay (position fixed, z-index 9999) — amber when ON, grey when OFF — NOT in the header. Log calls instrumented in: `App.tsx` (8 handlers), `ImageGrouper.tsx` (7 call sites), `ImageUpload.tsx` (processFiles + upload complete), `ProductDescriptionGenerator.tsx` (applyPreset, startRecording, stopRecording, save, clearTranscript, thumbDrag, next/prev/finish), `Library.tsx` (loadAll, all CRUD handlers, itemClick, dragStart, dropImageOntoGroup, dropGroupOntoBatch), `workflowBatchService.ts` (fetchWorkflowBatches), `libraryService.ts` (fetchSavedProducts, fetchSavedImages). Category colour system: App=#6366f1, Library=#0ea5e9, Grouper=#f59e0b, Upload=#10b981, PDG=#ec4899, Sorter=#8b5cf6, Service=#64748b, DB=#0284c7, Auth=#7c3aed, DOM=#94a3b8, Error=#ef4444. (commits `fc59d7d`, `ace3a41`)
- ✅ CategoryZones fully instrumented with debug logging — category drop, click-assign, clear category, group reorder, photo reorder (commit `6f3062a`)
- ✅ ImageGrouper selection clicks instrumented with debug logging — click-select, shift+click range, group-card click (commit `c11f8b5`)
- ✅ App.tsx startup/restore/DB/autoSave logging added (commit `7368705`)
- ✅ Persistence fix: `handleImagesSorted` now syncs `productGroup` (not just `category`/`_presetData`) when updating `processedItems`; DB upsert now covers ALL items with a storagePath/imageUrl (not just items with a category set) so group assignments persist across page reloads (commit `b018d38`)
- ✅ Preset buttons in Step 2 right sidebar now group-then-apply: `handleApplyPreset` merges all selected items into one group first (same logic as `handleCategoryClick`), then applies the preset — previously it applied the preset without merging (commit `b018d38`)
- ✅ Click-outside deselect no longer clears selection when clicking category zone or preset button — `mousedown` safe-selector list expanded to include `.category-zone`, `.category-zones-container`, `.category-zones`, `.category-list`, `.grouper-preset-picker`, `.grouper-preset-buttons`, `.button-preset`, `.grouper-actions-sidebar` (commit `0c43ff8`)
- ✅ Rubber-band selection propagation fixed — `handleGlobalMouseUp` now calls `onSelectionChangeRef.current?.(newSelected)` (via a stable ref) in addition to `setSelectedItems`; previously only local state was updated so `selectedGroupItems` in App.tsx stayed empty and category clicks had no items to act on (commit `0ba0160`)
- ✅ Rubber-band selector reliability fixed — `useEffect` dep array reduced to `[isSelecting]` only; all mutable values read through refs (`selectionStartRef`, `selectionBoxRef`, `selectionThresholdMetRef`, `activeContainerRef`, `selectedItemsRef`); previously every `setSelectionBox()` call during a drag triggered a full listener re-registration causing frequent event drops that required multiple attempts to activate (commit `903347e`)
- ✅ Stale-closure fix in `handleImagesGrouped` — added ref mirrors (`sortedImagesRef`, `groupedImagesRef`, `uploadedImagesRef`, `processedItemsRef`) updated every render; `handleImagesGrouped` now reads from refs so rapid `handleImagesSorted` → `handleImagesGrouped` chains always merge against the latest state, not the pre-`handleImagesSorted` snapshot; previously a clear-category drag immediately followed by an ungroup click would restore the cleared category silently (commit `aae35fc`)
- ✅ `handleImagesGrouped` DB upsert debounced + chunked — separate `groupUpsertTimerRef` (2 s) prevents a full 800-item `products` upsert on every single group/ungroup click; upsert now chunked at 100 rows to match the `DELETE_CHUNK_SIZE` pattern and avoid PostgREST URL-length limits; `handleItemsProcessed` also updated to use ref mirrors for the `autoSaveWorkflow` call (commit `aae35fc`)
- ✅ Image load retry with exponential backoff — `LazyImg.tsx` retries up to 3× (500 ms → 1 000 ms → 1 500 ms) with `?t=<ts>` cache-bust on each attempt; works around `ERR_QUIC_PROTOCOL_ERROR` by forcing Chrome off the broken QUIC session; bare `<img>` tags in `ImageGrouper.tsx` (single-item-card thumbnail and group thumbnail) use a `retryImg` helper with the same strategy via `data-retry` DOM attribute (commit `3ff42ac`)
- ✅ `[Img]` debug logging category added — orange (`#f97316`) category in `debugLogger.ts`; `LazyImg.tsx` logs each retry attempt and final failure; `retryImg` helper in `ImageGrouper.tsx` does the same; zero-cost when debug is disabled (commit `9af8ce4`)
- ✅ Double-fire `toggleItemSelection` debounce — hardware double-clicks emit two `mousedown` events ~10–15 ms apart, causing the item to toggle twice and land in the wrong state; `lastToggleTimeRef` (a `Map<string, number>`) tracks last toggle timestamp per item; any second call within 200 ms is skipped with a `[Grouper] debounced` log entry (commit `7c4806f`)
- ✅ Service Worker image cache — `public/sw.js` intercepts all GET requests to `*/storage/v1/object/public/product-images/*` using stale-while-revalidate strategy with a 7-day TTL; bypasses Supabase free-tier `Cache-Control: no-cache` header that caused all 800 images to be revalidated (conditional HTTP round-trip) on every page refresh; cache key strips `?t=` cache-bust param so LazyImg retries don't create duplicate entries; SW registered in `main.tsx` via `import.meta.env.BASE_URL` (works at both `/` locally and `/sortbot/` on GitHub Pages); entries pruned on activate and on cache-name version change (commit `14f2c0f`)
- ✅ Blank card bug fixed — single-item-card and group-image-item thumbnails were conditionally rendered only when `item.preview || item.imageUrls[0]` was truthy, but the actual `src` uses `thumbnailUrl || preview || imageUrls[0]`; items where only `thumbnailUrl` was populated (slim restore set `thumbnailUrl` from `storagePath` but `imageUrls` was already populated from slim save) showed blank cards; render condition updated to `thumbnailUrl || preview || imageUrls[0]`; items with all three empty now show a grey `lazy-skeleton--error` placeholder instead of nothing; startup restore log now includes `noUrl=N` when any items have no URL (commit `949413b`)
- ✅ Startup restore DB image fallback — 24 items had no `storagePath` AND no `imageUrls` in slim data (uploaded before storagePath was preserved), so the synchronous `getPublicUrl(storagePath)` reconstruction returned `''`; startup restore now detects these no-URL items after the initial map and runs a two-stage DB fallback: (1) query `product_images` directly by the missing item IDs; (2) for items still missing, find their `productGroup` peers in the `products` table, fetch those peers' `product_images` rows, and use the group's images as the fallback — handles the common case where legacy secondary photos in a group have no storagePath but their group leader does; a `[App] startup restore | DB image fallback | fixed=N stillMissing=N` log line reports the result; `handleOpenBatch` already had this coverage via the `savedProducts` products-table JOIN (commits `65851bb`, `8f11491`)
- ✅ Storage meter light theme + usage warnings — storage meter in Step 1 restyled from dark/glass to light indigo theme; warning banner (💡 amber) appears at >60% usage; danger banner (⚠️ red) appears at >85%; over-limit banner (🚨 red) appears at ≥100%; bar colors updated to match thresholds (`#059669` normal, `#d97706` warning, `#dc2626` danger); label updated to "X GB / 1 GB free" (commit `b9719e0`)
- ✅ Step 2 sort by creation date — four compact toggle buttons in the `grouper-header` bar: **↑ Date** (oldest first by `capturedAt`, default), **↓ Date** (newest first), **↑ Name** (filename A→Z by `originalName`), **↓ Name** (Z→A); applies to both Individual Items and Product Groups (groups sorted by minimum `capturedAt` of their members); active button highlighted white/purple; `capturedAt` is preserved through `slim()` since it is not in the stripped fields (`file`, `preview`, `_presetData`); `sortOrder` is component-local state in `ImageGrouper.tsx`, not persisted to DB (commit `970413f`)
- ✅ `handleOpenBatch` performance — three changes: (1) `registerItemsInDB` is now fire-and-forget (no `await`) so the UI is fully usable the moment images render, with the Library DB sync finishing in background; (2) the redundant `product_group` sync upsert that ran immediately after `registerItemsInDB` was removed (it was duplicating what `registerItemsInDB` already upserts); (3) the active-batch skip guard (`isAlreadyActiveBatch`) now captures `batch.id === currentBatchIdRef.current` before any state mutations so it correctly skips `registerItemsInDB` on re-opens of the already-active batch — the previous check ran after the ref was updated and always evaluated false; (4) `fullProductSelect` renamed to `slimProductSelect` and `title`/`url_handle` removed from the DB select (they aren't used in the merge, `seo_title` is used instead) (commit `2d38bc0`)
- ✅ Step 2 capture date labels — each single-item card always shows its `capturedAt` date **and time** (e.g. `Mar 12, 2024 3:41 PM`) as a compact footer label; product group cards do **not** show a date label; labels use `.capture-date-label` CSS class in `ImageGrouper.css`; previously labels were only shown when sorting by date — that condition has been removed (commit `ac8d281`)
- ✅ Step 2 date filter dropdown — a `<select>` in the `.grouper-header` bar (below the sort buttons) is auto-populated with all unique calendar dates derived from `capturedAt` of all items; selecting a date hides single-item cards and product group cards whose items don't match that date; section headings show `N of Total` when a filter is active; an `✕ Clear` button resets the filter; dropdown only renders when there are items with `capturedAt`; dropdown hidden at Steps 3–4 (feature is local to `ImageGrouper.tsx`); filter state is `dateFilter` string in `YYYY-MM-DD` format (commit `ac8d281`)
- ✅ **Crop upload progress banner** (commit `47593d9`) — when a cropped image is re-uploaded in Step 3 (after using the crop/zoom tool on a product photo), a dismissible progress banner now shows upload status; previously the crop re-upload was silent with no user feedback; `content-visibility: auto` also re-applied to Step 2 card sections in this commit
- ✅ Step 2 image rendering perf — four CSS/HTML changes: (1) `aspect-ratio: 110/138` + `contain: layout style` on `.single-item-card` so the browser knows slot size before layout and `loading="lazy"` correctly defers off-screen images; (2) `content-visibility: auto` + `contain-intrinsic-size: 0 600px` on `.singles-section` and `.groups-section` so the browser skips paint + layout for sections scrolled out of view; (3) `decoding="async"` on all bare `<img>` tags in `ImageGrouper.tsx` and on the `<img>` inside `LazyImg.tsx` so JPEG decoding happens off the main thread; (4) `will-change: transform` on `.single-item-card:hover` and `.product-group-card:hover` so hover animations are GPU-composited without triggering layout recalc; no image data, URLs, or uploads changed (commit `b0d5235`)
- ✅ Image compression on upload + recompress-existing tool — `COMPRESS_ON_UPLOAD = true` constant in `ImageUpload.tsx` gates a `compressImage()` helper (canvas resize to max 2000px longest side, JPEG quality 0.88) that runs before every Supabase upload; expected ~10× reduction on 4000×4000px phone PNGs (e.g. 4 MB → ~300 KB); `lastModified` preserved so `capturedAt` / date sort still works; new `recompressExisting()` function fetches each existing image from its CDN URL, compresses via canvas, and re-uploads to the **same** `storagePath` using `upsert:true` — storage path, DB rows, and workflow_state are all unchanged; skips files already under 200 KB or where compression yields less than 10% savings; a green "🗜️ Compress N Images" button appears in the Step 1 upload UI whenever `uploadedImages.length > 0`; shows live progress and final MB saved; errors shown per-image in the done panel; `existingItems` prop added to `ImageUploadProps`; `COMPRESS_MAX_PX = 2000`, `COMPRESS_QUALITY = 0.88`, `RECOMPRESS_SKIP_UNDER_BYTES = 200KB` constants at top of file for easy tuning (commits `5661295`, `7e3dcf9`); **values raised from 1200px/0.75 → 2000px/0.88** in commit `6d4bb03` after user reported visible JPEG pixelation — previous 1200px setting caused double generation loss on crop (source already compressed at 75% quality, then re-encoded at 92% in `imageTransforms.ts`; Shopify also recommends ≥2048px); **"compress once" guard** — `COMPRESSED_PATHS_KEY = 'sortbot_compressed_paths'` localStorage key tracks every storagePath successfully compressed; button shows live count of "⏳ N need compression" vs "✅ N already compressed" before running; running same button again only processes paths not yet in the set; **confirmed run: 2,260 MB saved across one batch (avg 3,500 KB → 400 KB per image, 89% reduction), 0 errors, 0 skipped** — initial run only covered the single loaded batch; full-bucket compression completed via v2 button (see next item)
- ✅ **Compress All Batches button v1** (commit `a63b7f5`) — purple "🗄️ Compress All Batches" button in Step 1 upload UI runs `recompressAllBatches()` which queries the `product_images` table (paginated 1000 rows/page) to find every `storage_path` ever uploaded by the current user across ALL batches, deduplicates paths, skips any already in the localStorage compressed-paths set, then runs the same compress+upsert pipeline; fixes the limitation of `recompressExisting()` which only saw the currently-loaded batch; both buttons are mutually exclusive (all-batches button disabled while per-batch button is running); live progress shows done/total, MB saved, skipped count; error list in done panel; separate `recompressAllState` state variable so the two panels render independently; **v1 limitation:** `product_images` DB table only has ~804 rows for the main user but storage bucket has ~2,425 product folders — ~1,621 folders (67%) have no corresponding DB row (uploaded in old sessions before `storage_path` was reliably persisted), so DB-only query missed 67% of files; ran v1 → `alreadyDone=804 needsWork=0` → storage unchanged at 310%
- ✅ **Compress All Batches button v2 — storage bucket walk** (commit `9d9f1d5`) — fixed root cause by adding a second source: `supabase.storage.list(userId, { limit: 10000 })` gets all product subfolder UUIDs; for each subfolder (in chunks of 50) `supabase.storage.list(`${userId}/${folder.name}`, { limit: 1000 })` lists the files inside; CDN URL built via `supabase.storage.getPublicUrl(storagePath)` for each file; results merged into a `Map<storagePath, url>` (DB entries overwrite walk-derived URL where both exist); **scanning phase UI sentinel:** `total === -1` means "still scanning" — UI shows `Scanning storage… N folders checked` during the walk; after scan completes, `total` is set to the actual needsWork count and progress updates normally; **two-source merge logic:** Phase 1 = DB query (authoritative CDN URLs), Phase 2 = storage walk (covers folders with no DB row), Phase 3 = merge (start with walk-derived map, overwrite with DB entries), Phase 4 = filter by localStorage compressed-paths set; **v2 confirmed run (April 8 2026):** `totalFiles=4854 needsWork=92 alreadyDone=4762` → `saved=0.00MB skipped=92 errors=0`; all 92 "needsWork" files were skipped because they were already under the 200 KB threshold or yielded <10% savings — **all 4,854 images across the entire bucket are already fully compressed**; the 310% storage reading was a stale Supabase dashboard metric; **actual storage situation:** 4,854 files all compressed, bucket split across 3 user folders (`18c356d9`: 279 folders, `259161f3`: 2 folders, `b3fb80c0`: 2,517 folders); prior per-batch compression run (2,260 MB saved, 89% reduction) already handled the bulk of the savings; storage compression work is **complete**
- ✅ **Categorize multiple groups without merging** (commit `1505d34`) — selecting multiple existing product groups and dragging/clicking to a category zone no longer merges all groups into one; fix in both `CategoryZones.tsx:handleCategoryClick` and `App.tsx:handleApplyPreset`; singles (groups of 1) still merge together; existing multi-image groups keep their group ID and just get the category/preset applied independently per group
- ✅ **Step 2 filter bar — view/category as toggle buttons** (commits `1f96f66`, `d555ea0`) — "Groups only" and "Singles only" view filter replaced with two toggle buttons; all category filters replaced with one toggle button per category name (plus "Uncategorized"); clicking a button activates it, clicking again deactivates; date filter remains a dropdown; filter groups separated by a faint divider; `filter-btn-group` CSS class added to `ImageGrouper.css`; `filter-select` CSS retained for the date dropdown
- ✅ **Shopify taxonomy map in CSV export** (commit `54cebd1`) — `SHOPIFY_CATEGORY_MAP` added to `GoogleSheetExporter.tsx` mapping 6 short internal category names (`tees`, `sweatshirts`, `outerwear`, `bottoms`, `hats`, `femme`) to full Shopify taxonomy path strings; both "Product category" and "Google Shopping / Google product category" CSV columns now emit the full taxonomy string (e.g. `"Apparel & Accessories > Clothing > Tops > T-Shirts"` for `tees`); falls back to raw category value for any category not in the map
- ✅ **Category/preset applies correctly to all members of selected multi-image groups** (commit `efdd532`) — fixed a bug where the "group leader" item (whose `productGroup === item.id`) was treated as a singleton rather than a group member; this caused the group leader to be processed via the singles path and the rest of the group's members to be dropped from the output; both `handleCategoryClick` (CategoryZones) and `handleApplyPreset` (App.tsx) now determine single vs multi-group by checking **full group size in the items list** (`items.filter(i => (i.productGroup || i.id) === gid).length > 1`); true multi-groups get their entire map entry replaced wholesale with preset-applied versions; singles (groups of 1) get merged together as before
- ✅ **EXIF DateTimeOriginal read on upload** (commit `ac06e11`) — `getCapturedAt(file)` async helper added to `ImageUpload.tsx`; for JPEG files it runs `exifr.parse(file, ['DateTimeOriginal'])` and returns the EXIF shot time as a Unix ms timestamp; falls back to `file.lastModified` for non-JPEGs, files with no EXIF tag, or any parse error; `processFiles` now reads all timestamps in parallel via `Promise.all` before sorting, so items are sorted by actual shot time rather than filesystem modification date (which resets on copy/zip/AirDrop); `capturedAt` stored on each `ClothingItem` is the EXIF date (or fallback); `exifr` (~20 KB) added as a dependency
- ✅ **EXIF rescan backfill button** (commits `3c2fab2`) — one-time tool to fix `capturedAt` on already-uploaded images in the current batch; a yellow "📷 Fix Sort Order (EXIF rescan — N images)" button appears in Step 1 when items are present; clicking it downloads each image from its CDN URL in chunks of 5, runs `exifr.parse` on the blob, and updates `capturedAt` in memory where the EXIF date differs; shows live progress (`Reading EXIF… done/total · N updated · N no tag`); on completion calls `onCapturedAtUpdated` callback → `App.tsx:handleCapturedAtUpdated` patches all four workflow arrays (`uploadedImages`, `groupedImages`, `sortedImages`, `processedItems`) by item ID and fires `autoSaveWorkflow` so corrected timestamps survive reload; button is hidden once the callback is not supplied (production path only wires it from Step 1); new items imported after `ac06e11` are handled automatically at upload time — rescan is only needed for pre-existing batches
- ~~**Auto color detection via color-thief**~~ — **REMOVED** (commit `49dc58a`) — `colorthief` dependency uninstalled, `src/lib/colorUtils.ts` deleted, `useEffect` auto-color block removed from `ComprehensiveProductForm.tsx`. Color field is still populated by: (1) manual typing, (2) voice input via `textAIService.ts` scanning `COLOR_WORDS_LIST`, (3) AI generation, (4) category preset. `colorDatabase.ts` (`COLOR_DNA`, `COLOR_WORDS_LIST`) untouched — still used by `textAIService.ts`. `COLOR_RGB_MAP` export in `colorDatabase.ts` was left dead but harmless — and was **removed in the Sept 2026 dead-code pass**, keeping `hexToRgb()` because it is the pattern-entry filter.
- ✅ **Color database consolidated as single source of truth** (commit `c9594b8`) — `src/lib/colorDatabase.ts` (`COLOR_DNA`) is now the only place color names and hex codes are defined; `COLOR_WORDS_LIST` (flat array of all canonical names + all aliases) is exported and used by `textAIService.ts` for voice/AI text scanning; `COLOR_RGB_MAP` is also exported but now has no consumer (was used by the deleted `colorUtils.ts`); pattern entries (`tie dye`, `camo`, `plaid`) have non-hex `hexCodes` values (`#MULTI` etc.) and are automatically excluded from derived exports; multi-word aliases are sorted longest-first in text scanning so `"forest green"` matches before `"green"`; regex-escaped for special characters
- ✅ **COLOR_DNA expanded to 57 solid colors** (commits `152b9e1`, `cadfb35`) — added 26 new solid color entries covering common mass-produced clothing colors missing from the original 31: `black`, `red`, `blue`, `denim`, `cyan`, `green`, `yellow`, `orange`, `coral`, `salmon`, `maroon`, `pink`, `brown`, `beige`, `gray`, `white`, `ecru`, `light blue`, `sky blue`, `mint`, `lilac`, `mauve`, `peach`, `terracotta`, `taupe`, `camel`, `stone`; each entry includes hex codes, aliases, vibes, eras, subcultures, and commonIn fields; all new entries automatically flow into `COLOR_WORDS_LIST` (voice/AI scanning) with no other file changes needed; to add a new color in future: add one entry to `COLOR_DNA` with a real hex code
- ~~**Color-thief output restricted to 43 approved names**~~ — **REMOVED** along with `colorUtils.ts` (commit `49dc58a`)
- ✅ **`originalName` — original filename saved, displayed, and used for name sort** (commits `ca2bf11`, `bbb6a0d`, `31168cd`) — `originalName?: string` added to `ClothingItem` type; `ImageUpload.tsx` saves `file.name` (e.g. `"DSC02175.jpg"`) as `originalName` on every newly uploaded item; `nameKey()` in `ImageGrouper.tsx` now prefers `originalName` over `storagePath` (which was a randomized `timestamp-uuid.jpg` path, useless for meaningful sort); sort uses `localeCompare({ numeric: true })` so `DSC02175 < DSC02176 < DSC02177` instead of alphabetical string comparison; **Step 2 card display**: single-item cards show the original filename above the capture date in the card footer using `.original-name-label` CSS class (monospace, 0.62rem, #aaa); the label block renders if either `originalName` or `capturedAt` is present; **persistence**: `original_name TEXT` column added to `product_images` table (migration `add_original_name_to_product_images.sql`); `registerItemsInDB` writes `item.originalName` to `product_images.original_name` on every save; **backfill for already-uploaded batches**: startup restore now does a bulk `product_images` select for `original_name` for all items missing it and merges it in before render; `handleOpenBatch` fetches `original_name` as part of the existing `product_images` join and wires it into the merge map; DB column is `NULL` for rows inserted before this migration — name sort falls back to `storagePath` filename for those
- ✅ **Steps 3/4 show only categorized items and multi-image groups** (commit `0922eca`) — `ProductDescriptionGenerator` and `GoogleSheetExporter` both receive a filtered version of `processedItems`: items are included only if they have a `category` set OR belong to a true multi-image group (`groupCounts[productGroup] > 1`); uncategorized singles are excluded from these steps so they don't clutter the description/export workflow; the filter is applied inline in JSX (not stored to state) so `processedItems` always contains the full list; Step 3 stats banner shows `· N uncategorized singles hidden` when items are filtered out; loose images return to Step 2 to be categorized or grouped before proceeding
- ✅ **Batch-open preserves loose/uncategorized images** (commit `dbd5d43`) — fixed a bug where opening a batch from Library only showed grouped/categorized items, losing uncategorized singles; root cause: `handleItemsProcessed` (the PDG → App.tsx callback) was calling `setProcessedItems(items)` where `items` is the filtered PDG subset (categorized/grouped only, same filter as above); this overwrote the full `processedItems` state with just the filtered list, which `autoSaveWorkflow` then persisted to `workflow_state`; on next batch open the uncategorized singles were gone; fix: `handleItemsProcessed` now builds a merged array using `processedItemsRef.current` as the base, updating only matching items from PDG and leaving non-PDG items (the loose singles) untouched; the merged list is passed directly to both `setProcessedItems` and `autoSaveWorkflow` (avoids stale-ref timing since `setProcessedItems` is async)
- ✅ **Library product groups show images** (commit `5de47fb`) — product group cards in Library's "Product Groups" tab were always showing the "No images" placeholder; root cause: groups are built by iterating `workflow_state` slim items, but `slim()` strips `preview` and `imageUrls`, so the group builder saw `images: []`; fix: when constructing the `images` array for a product group, reconstruct CDN URL from `storagePath` via `supabase.storage.from('product-images').getPublicUrl(storagePath).data.publicUrl` instead of reading `preview`/`imageUrls` — same pattern used in startup restore and `handleOpenBatch`
- ✅ **Library and batch-open gap-fill for loose images missing from corrupted `workflow_state`** (commit `69dd319`) — pre-`dbd5d43` batches had corrupted `workflow_state` where loose/uncategorized images were stripped and only grouped/categorized items survived; three places affected: (1) **Library imageList Pass 2** was using `batchIdsCoveredByWfState` to skip the entire DB pass for any batch with ANY `workflow_state` items — changed to per-item ID dedup using a `wfItemIds` Set so only items already present in `workflow_state` are skipped, and DB items absent from `workflow_state` are still surfaced; (2) **`handleOpenBatch`** used `workflowItems` (possibly partial) directly as `baseItems` — now performs a gap-fill pass after building `baseItems`: any `product_images` DB row whose `product_id` is absent from `baseItems` is appended as a new `ClothingItem` with `storagePath`, `thumbnailUrl`, CDN URL, and `originalName` reconstructed from the DB row; (3) **Library `getThumbnails`** now falls back to DB-derived `productGroups` thumbnails when `workflow_state` items have no URL; batch card counts updated to `Math.max(workflow_state count, DB count)` so the larger (more complete) number is shown
- ✅ **`originalName`, `storagePath`, `thumbnailUrl` in DB-built ClothingItems** (commit `0f0ad30`) — items built entirely from the DB (both the "no workflow_state" rebuild path and the new gap-fill path in `handleOpenBatch`) were missing `storagePath`, `thumbnailUrl`, and `originalName`; root cause: `slimProductSelect` query was missing `storage_path` in the `product_images` join, and both rebuild paths didn't extract these fields; fix: added `storage_path` to the `slimProductSelect` join, and both the "no workflow_state" path (~line 1265) and the gap-fill path (~line 1330) now properly set `storagePath: row.storage_path`, `thumbnailUrl: reconstructedUrl`, and `originalName: row.original_name ?? undefined` on every gap-fill item
- ✅ **`original_name` written at upload time** (commit `d0147f0`) — previously `original_name` was only written to `product_images` by `registerItemsInDB` (which runs on batch open/restore), not at initial upload time; newly uploaded items had `NULL` for `original_name` in the DB until the batch was closed and reopened; fix: added `original_name: item.originalName ?? null` to the `product_images` upsert in `handleImagesUploaded` so filename is stored immediately; `registerItemsInDB` still overwrites it on batch open via delete-then-insert (always has the correct value since it reads from live in-memory items), so existing rows with `NULL` are also repaired on the next batch open
- ✅ **`registerItemsInDB` changed to `ignoreDuplicates: true`** (commit `8ab4e6a`) — changed from delete-then-insert to `upsert(..., { onConflict: 'product_id,storage_path', ignoreDuplicates: true })` for `product_images`; prevents the situation where re-registering items fails with FK violations when racing with Storage uploads; `ignoreDuplicates: true` means duplicate rows are silently skipped (no error, no update), so the first write wins; safe because `storage_path` + `product_id` uniquely identifies an image row and these fields never change after upload
- ✅ **Gap-fill safety cap + stolen-product cleanup** (commit `8ab4e6a`) — `handleOpenBatch` already gap-filled by appending DB rows missing from `workflow_state`; new safety cap: if the number of "missing" products exceeds `max(workflowItems.length × 2, 50)` they are treated as "stolen" (duplicate rows from the `ignoreDuplicates:false` era whose `batch_id` was cloned to a new batch) and deleted rather than added to the working set; deletion is done in background, chunked at 100 IDs, deleting `product_images` first (FK constraint) then `products`; log line: `handleOpenBatch | gap-fill cleanup done | deleted N stolen products`; the cap formula gives generous headroom for legitimate gap-fill (e.g. 38 real items → cap = 76) while catching mass-stolen batches (N = 308, 972, etc.)
- ✅ **Auto-EXIF rescan on batch open** (commit `9bd19d3`) — `handleOpenBatch` now fires the EXIF rescan automatically for batches where any item is missing `capturedAt`; previously the user had to manually click the yellow "📷 Fix Sort Order" button; auto-rescan runs after the batch images are set in state and only patches `capturedAt` — it does not change grouping, category, or any other field; works in background via fire-and-forget; manual button still available
- ✅ **Library "Unassigned" section — delete orphaned products** (commits `fdbf663`, `c3ff75e`, `1f4ff75`) — products with `batch_id = null` are shown as a separate "Unassigned" section in Library's Images view; these are orphaned duplicate rows created by the old `ignoreDuplicates:false` bug; Library shows a `(orphaned duplicates — safe to delete)` label and a single "🗑 Delete all unassigned" button; clicking it deletes all `product_images` rows then all `products` rows for items with `batch_id = null` in chunks of 100; `workingUnassigned` boolean state prevents double-click; **why there is no "Assign to batch" button:** assigning these rows to any batch triggers the gap-fill safety cap on next open (the orphaned IDs are not in that batch's `workflow_state`), which deletes them again — the assign→open→delete→assign loop is infinite; the rows contain no unique image data (the real images live in the source batch's `workflow_state`); deletion is the only safe operation
- ✅ **Spurious "needs compression" badge fix** (commit `d9d20fc`) — after uploading a folder, images were showing a "⏳ N need compression" badge even though they were just compressed on upload; root cause: `markCompressed(storagePath)` (writes to `sortbot_compressed_paths` localStorage set) was called inside `recompressExisting()` but NOT inside the fresh-upload `processFiles()` path; fix: added `if (COMPRESS_ON_UPLOAD) markCompressed(uploaded.storagePath)` immediately after each successful upload in `processFiles`; badge now correctly shows 0 after a fresh upload
- ✅ **ProductDescriptionGenerator crash guard for empty group** (commit `7997a6a`) — `TypeError: Cannot read properties of undefined (reading 'category')` crashed Step 3 when no categorized items existed yet; root cause: `currentItem = currentGroup[0]` where `currentGroup = groupArray[currentGroupIndex] || []` — when `groupArray` is empty, `currentItem` was `undefined`, crashing at `currentItem.category` in JSX; fix: early return guard added before the main render: if `!currentItem` return a "⚠️ No categorized items yet — go back to Step 2" message
- ✅ **Library imageList deduplication fix** (commit `8643c5d`) — Pass 2 (DB `product_images` rows) was double-counting items when their DB `batch_id` differed from the batch that holds them in `workflow_state`; the old dedup condition required BOTH `batchIdsCoveredByWfState.has(batchId)` AND `wfItemIds.has(productId)` — since the DB `batch_id` was an old value, the batch check failed and all items slipped through Pass 2 and were added again (770 images instead of 385); fix: simplified to `if (productId && wfItemIds.has(productId)) return` — dedup by product_id alone, regardless of batch_id
- ✅ **`Cmd+Enter` / `Ctrl+Enter` to group selected images in Step 2** (commit `71df4b9`) — keyboard shortcut added to `ImageGrouper.tsx` via a `useEffect` `keydown` handler; `[selectedItems]` dependency ensures fresh closure; `Cmd+G` was attempted first (commit `9b61479`) but Chrome/Safari intercept `Cmd+G` at the OS level as "Find Next" before JavaScript can cancel it — switched to `Cmd+Enter` which has no browser default in non-form context; calls `createGroupFromSelected()` which requires `selectedItems.size >= 2`
- ✅ **`handleApplyPreset` stale closure fix** (commit `993c0cf`) — applying a category preset immediately after grouping items failed (no effect); root cause: `handleApplyPreset` read `groupedImages` and `uploadedImages` directly from the closure, which held pre-group stale values because `setGroupedImages` hadn't re-rendered yet; fix: switched to `groupedImagesRef.current` and `uploadedImagesRef.current` which are updated synchronously every render; after refresh it worked because state was fresh — confirmed classic stale closure bug
- ~~**Color-thief accuracy improvements**~~ — **REMOVED** (commit `49dc58a`) — multiple rounds of improvements to `colorUtils.ts` were made (perceptual RGB weighting, background filtering, side-edge fabric zone sampling, exposure normalization) but the entire approach was then removed at user request; `src/lib/colorUtils.ts` is deleted
- ✅ **CategoryZones preset-apply freeze fix** (commit `55a46f0`) — clicking a category zone (or preset button) with multiple groups selected caused a UI freeze because `CategoryZones.tsx` called `applyPresetToProductGroup()` (async, fires a `getCategoryPresets()` Supabase network fetch) once **per group**; with N groups selected this was N sequential DB round-trips blocking the main thread; fix: added `findPreset(categoryName)` and `applyPreset(groupItems, categoryName)` helpers inside `CategoryZones` that look up the matching preset from the already-loaded `presets` state (fetched once on mount) and call `applyPresetDirectly()` (sync, no network) instead; all three call sites in `handleCategoryClick` and `handleCategoryDrop` replaced; the old `applyPresetToProductGroup` import removed entirely from `CategoryZones.tsx`
- ✅ **Preset apply — eliminated per-group Supabase fetches + double-fire guard** (commit `b0a41a6`) — applying a category preset to multiple groups stopped working after a few presses; root cause: `handleApplyPreset` called `applyPresetToProductGroup()` once per group, each making a fresh `getCategoryPresets()` Supabase network fetch — with many groups, sequential fetches could time out and the `catch` block silently returned unchanged items; fix: extracted field-mapping into `applyPresetFields()` private fn in `applyPresetToGroup.ts`, added `applyPresetDirectly(items, categoryName, preset)` export that accepts the preset object directly (no network call); `handleApplyPreset` in `App.tsx` now uses `applyPresetDirectly` since the `preset` object is already the function argument — zero extra fetches regardless of how many groups are selected; also added `isApplyingPresetRef` boolean ref guard in `App.tsx` to prevent concurrent double-fire (rapid double-click skipped)
- ✅ **Step 2 select-all keyboard shortcuts** (commits `4a6a53d`, `b4f37a2`) — three new shortcuts in `ImageGrouper.tsx`, all in a single stable `useEffect([], [])` that reads live values via refs:
  - `Cmd+A` / `Ctrl+A` — select all **singles** (individual ungrouped images only; does NOT select items inside multi-image groups); toggle: press again to deselect
  - `Cmd+Shift+A` / `Ctrl+Shift+A` — select all **multi-image groups** (every item inside every group; singles excluded); toggle: press again to deselect
  - `Cmd+D` / `Ctrl+D` — deselect everything (hard clear, no toggle)
  - All three are no-ops when an `<input>` or `<textarea>` has focus (prevents accidental fire while typing); `Cmd+D` also skips if selection is already empty
- ✅ **Save button removed from Step 3** (commit `e249150`) — the manual "Save" button in `ProductDescriptionGenerator.tsx` was redundant: `syncGroupFieldsToDatabase` (products table) is already called by Next/Prev navigation; removed button, `isSaving` state, `saveConfirmed` state; `handleSave()` simplified to just call `syncGroupFieldsToDatabase` + `setHasUnsavedChanges(false)` with no UI feedback — it is still called internally by Next/Prev when `hasUnsavedChanges` is true
- ✅ **Finish button exports CSV** (commit `8ad523b`) — `handleFinish` in `ProductDescriptionGenerator.tsx` no longer shows an alert or blocks on `allProcessed`; it always calls `onProcessed(processedItems)` (writes items to App.tsx) then immediately calls `onDownloadCSV?.()` (triggers the `GoogleSheetExporter` ref's `downloadCSV`); navigation to Step 4 still happens via `onProcessed` → App.tsx state update
- ✅ **Export preview table — real data** (commit `37f44a0`) — preview table in `GoogleSheetExporter.tsx` was showing raw IDs (`product-1`, `product-2`) and empty prices because it read `product.seoTitle` directly; fixed by extracting `buildCleanTitle(product, idx)` shared helper (strips `{tokens}`, prepends brand, falls back to auto-parts) used by both the preview table and `handleDownloadCSV`; preview now shows real titles, `$X.XX` prices, `—` for empty fields, tag truncation with tooltip, 80-char description preview
- ✅ **Export preview expanded to all 63 CSV columns** (commit `f450e1b`) — preview table in `GoogleSheetExporter.tsx` replaced the 5-column table with a full 63-column horizontally-scrollable table; `overflow-x: auto` on the container, `position: sticky` + `top: 0` on `<thead>` for a frozen header row, `white-space: nowrap` on cells, `min-width: 4800px` on the table; shows up to 10 products; each cell value computed identically to the CSV row builder using the same helpers (`buildCleanTitle`, `SHOPIFY_CATEGORY_MAP`, etc.); long text cells (Description, SEO description) truncated to 60 chars with `…` and full value in the `title` tooltip; other cells truncated at 35 chars
- ✅ **Cleanup script protects in-flight workflow_batches images** (commit `a4b452d`) — `scripts/cleanup-orphaned-storage.mjs` previously deleted images that were uploaded to Storage but not yet saved to the `product_images` DB table (they live in `workflow_batches.workflow_state` during the active session); fix: script now queries `workflow_batches`, extracts all `imageUrls` from every `workflow_state.processedItems` array, and adds those paths to the `knownPaths` set before diffing against Storage; any storage file referenced by an in-flight batch is preserved
- ✅ **Preset fields survive grouping/categorizing** — two code paths in `App.tsx` were silently wiping all preset-applied fields whenever the user touched Step 2 after applying a preset in Step 3: (1) `handleImagesSorted`'s `userFields` whitelist (used when merging sortedItems back into processedItems) only listed user-typed fields and was missing all 16 preset fields (`policies`, `shipsFrom`, `gender`, `whoMadeIt`, `productType`, `shopifyProductType`, `_presetData`, etc.) — added all preset fields to the whitelist; (2) `handleImagesGrouped` called `setProcessedItems(finalSorted)` where `finalSorted` is derived from `sortedImages` (structural array only — no preset data) — replaced with a `mergedProcessed` array that merges `finalSorted` against `processedItemsRef.current`, keeping all preset + user-entered fields from the live processed state and only updating `productGroup` and `category` from the new grouping; `autoSaveWorkflow` also updated to pass `mergedProcessed` instead of `finalSorted`
- ✅ **OSFA voice size normalization** — `normalizeSizeValue()` in `textAIService.ts` was returning `"1 SIZE"` for "OSFA", "one size fits all", "one size fits most", "one size", "os"; changed to return `"OSFA"`; lookup map entries for `1size`/`onesize` also updated to `"OSFA"`
- ✅ **Storage meter moved under navbar + upload notifications as dismissible toasts** (commit `c7c6538`) — storage meter (previously inside the `<ImageUpload>` component) is now rendered directly in `App.tsx` just below the `<header>` navbar, visible at all times when logged in; upload notifications ("N images uploaded") converted from inline banners to dismissible toast notifications via a new `addToast`/`toasts` state in `App.tsx` and a `<div className="toast-container">` overlay; `onToast` prop added to `ImageUploadProps`; toasts auto-dismiss after 4 s and have an `×` close button; `storageUsed` and `storageTotal` props removed from `ImageUploadProps` and handled by `App.tsx` directly
- ✅ **Auto-group by N photos per item in Step 2 filter bar** (commit `ade77a7`) — new `📸 Photos/item:` number input + `Apply` button in the `ImageGrouper` filter bar; `applyAutoGrouping(n)` sorts all items by filename (natural order via `localeCompare({ numeric: true })`), then chunks into groups of `n` with fresh UUIDs; previous grouping is discarded; `autoGroupN` state initialized to `'4'`; input accepts 1–99; layout uses a `border-left` divider to visually separate from other filter controls; CSS classes: `.auto-group-control`, `.auto-group-label`, `.auto-group-input`, `.auto-group-btn` in `ImageGrouper.css`
- ✅ **Batch duplication on upload fixed** (commits `4d9d594`) — two concurrent `autoSaveWorkflowBatch` calls could both see 0 rows updated (batch UUID minted in memory by `handleImagesUploaded` but row never inserted yet) and both call `createWorkflowBatch` → two duplicate batch rows; **Fix 1:** `handleImagesUploaded` now immediately `INSERT`s a stub `workflow_batches` row when it mints a new UUID so `autoSaveWorkflowBatch`'s blind UPDATE always finds an existing row; **Fix 2:** `autoSaveInFlightRef` mutex in `autoSaveWorkflow`'s `setTimeout` callback — if a Supabase round-trip is already in-flight the concurrent fire is skipped, `finally` resets the flag
- ✅ **CategoryZones preset-apply freeze fix** (commit `55a46f0`) — clicking a category zone (or preset button) with multiple groups selected caused a UI freeze because `CategoryZones.tsx` called `applyPresetToProductGroup()` (async, fires a `getCategoryPresets()` Supabase network fetch) once **per group**; with N groups selected this was N sequential DB round-trips blocking the main thread; fix: added `findPreset(categoryName)` and `applyPreset(groupItems, categoryName)` helpers inside `CategoryZones` that look up the matching preset from the already-loaded `presets` state (fetched once on mount) and call `applyPresetDirectly()` (sync, no network) instead; all three call sites in `handleCategoryClick` and `handleCategoryDrop` replaced; the old `applyPresetToProductGroup` import removed entirely from `CategoryZones.tsx`
- ✅ **PDG real-time sync when category/preset changes on existing items** (commit `994faee`) — `ProductDescriptionGenerator`'s items-prop sync `useEffect` only triggered on `batchId`, `items.length`, or `items[0].id` changes; re-categorizing an item already in Step 3 (same count, same first ID), or applying a preset to already-categorized items, left PDG's internal `processedItems` stale — the form showed old category/preset fields until page refresh; fix: added `structureChanged` check — a per-item key of `id:category:productGroup` joined and compared against the previous render; any category or grouping change now silently syncs `processedItems` from props without resetting the user's current group navigation index (only `batchChanged`/`lengthChanged`/`firstIdChanged` reset index to 0, as before); all product-group creation and category-preset application paths (ImageGrouper grouping, CategoryZones click/drag, PDG dropdown) now reflect immediately in the UI without requiring a page refresh
- ✅ **Increased working area — wider layout** (commit `57c7694`) — all four layout containers in `App.css` raised from `1280px`/`1400px` to `1600px`: `.app-main` (main content column, was `1280px`), `.header-content`, `.app-header-content`, `.storage-meter-nav-inner` (all were `1400px`); reduces the dead left/right negative space on wider monitors; Step 2 split (ImageGrouper + CategoryZones) benefits most
- ✅ **Step 2 stats/sort/filter bar moved to vertical left sidebar** (commits `99907d5`, `231bc1e`) — `ImageGrouper` restructured into a two-column flex layout: `.grouper-header` is now a `210px`-wide sticky left sidebar (`height: 75vh`, purple background) containing the stats block, sort control, filter bar, and auto-group control all stacked vertically; `.grouper-scroll-content` is the new flex-1 scrollable right column holding the image grid; dividers changed from `border-left` to `border-top` for vertical orientation; button/text sizes increased; sidebar is `position: sticky; top: 1rem` so it stays visible while scrolling through many images
- ✅ **Vertical sidebar collapses to horizontal top bar on mobile** (commit `aa99c50`) — `@media (max-width: 768px)` in `ImageGrouper.css` reverts the sidebar layout: `.image-grouper-container` switches back to `flex-direction: column`, `.grouper-header` becomes `width: 100%; height: auto; position: static` (full-width horizontal bar), stats/filter/auto-group controls revert to `flex-direction: row`; tablet breakpoint (`max-width: 1024px and min-width: 769px`) shrinks sidebar to `160px` with tighter padding in `App.css`
- ✅ **Step 2 right panel mobile responsiveness** (commit `8ebc7ea`) — CategoryZones right panel in Step 2 had `position: sticky; height: 75vh; overflow-y: auto` as React inline styles, which CSS `@media` queries could not override; moved to a `.step2-right-panel` CSS class in `App.css`; `@media (max-width: 1024px)` resets it to `position: static; height: auto; overflow-y: visible` so panels stack correctly on tablet/mobile; `@media (max-width: 480px)` hides `.step2-split .step-description` and shrinks action button text; `step2-split` grid still declares `1fr 340px` inline but is overridden with `!important` in CSS at ≤1024px

### June–July 2026 (post-June-10 CLAUDE.md update)

- ✅ **UI density pass** (commits `0eae362`, `4d2f71d`, `4c788bf`, `5354909`, `83cfc9d`, `bd7e8e4`) — base font-size set to **9px** (matches the user's preferred 67%-zoom look at 100%); Step 2 right sidebar narrowed to 227px; image-grid gutters equalized at 3rem/3.5rem; `ComprehensiveProductForm` scaled to match `VoiceCommandTable` sizing; shortcut cheatsheet fonts doubled
- ✅ **Preset persistence saga** (~15 commits, `3ab0e96` → `cc4be33`) — the per-group preset override now survives page refresh end-to-end: `applied_preset_id` column added to `products` (root-level `ADD_APPLIED_PRESET_ID.sql`) and included in `hydrateSelect`; `selectedPresetId` restored from `_presetData.presetId` on group navigation; preset override detection uses direct string comparison on `productType` (loose matching collapsed two presets to the same ID); auto-apply is skipped when preset fields were already persisted in a prior session; `isResettingRef` set before `applyPresetsToAllGroups` to stop an `onProcessed` feedback loop; brand/size/color/price preserved through all auto-apply merges; force-apply when the user explicitly switches preset or re-categorizes a group; green preset box always shows the currently active preset
- ✅ **Field persistence hardening** (commits `73dc736`, `29a2fcf`, `840c337`, `aef0e6a`, `f75de6f`) — PDG now saves to the `products` table via a **500 ms debounced direct save** that bypasses the `isResettingRef` feedback loop, plus a `beforeunload` flush; hydration lookup is **byId** (was positional); `structureKey` expanded to include `seoTitle`+`voiceDescription` so DB hydration triggers PDG prop-sync; sz-corrupted titles stripped on load
- ✅ **Title/tag/voice engine overhaul** (commits `0b56d07`, `6b6f9c1`, `58376d2`, `3a70b52`, `b4e6c0d`) — `ITEM_TYPE_SYNONYM_GROUPS` separated from `TITLE_SYNONYMS`; `fitTo60` self-detects the active garment type and only swaps synonyms within that one group (prevents cross-category title contamination, e.g. sweatshirt titles absorbing "crewneck tee"); "l size"/"m size"/"s size" synonyms removed ("extra l size" corruption); word-boundary on `isTee` regex; color/material dropped from title formulas ({size}- prefix retained); generic description-sourced tags (surf/skate/embroidered…) excluding size/material/condition; new **"Type" (garment) field** flows into the title with voice command `"type X period"`; material split into primary material (for Shopify GID) vs full composition (description); color modifier stripping ("Faded Out White" → White); washing-process disclosure line before condition; chest AND pit-to-pit/p2p both route to width
- ✅ **Sizes always letter symbols** (commits `3a70b52`, `28e9d9b`) — size normalization accepts many spoken forms and always renders letter format (`XL`, `XXL`, `XXXL`), never spelled out
- ✅ **Built-in brand library surfaced in the Vocabulary dashboard (July 2026)** — `src/lib/builtinBrandVocab.ts` distills the hardcoded BRAND_DNA knowledge base (vintagePatternEngine + 4 expansions — the code comments claim "5,000+" but the REAL count is 917 unique brands (154+127+55+418+194, dupes merged); NOTHING in the active app imported it) into brand → keywords entries using ONLY `vibes` + `subculture` (tag-quality words; the raw `keywords` field is matching bait — player names etc. — deliberately excluded), capped 10/brand. The Brands tab shows it as a read-only, searchable "Built-in brand library" section (render-capped 50/100 rows) with one-click copy into the editable `brand_keywords` table; already-copied brands show a "customized" badge. LOADED VIA DYNAMIC IMPORT — its own ~361 KB chunk fetched only when the Brands tab opens; keep it out of any main-bundle import path. Generation behavior unchanged: only editable DB rows feed `getBrandTerms`. The **Models tab** is fully editable (July 2026): `vocab_models` table (`vocab_models.sql`, run manually — global SELECT, `is_beta_admin()` writes, unique on lower(brand)+lower(model_name)) with an add/edit form (~10 fields: brand, model, number, category, year, price min/max, collectibility 1-10, features, keywords, discontinued), on/off toggle, delete-confirm; the read-only built-in `MODEL_DATABASE` (~65 entries, lazy-loaded 29 KB chunk) sits below with one-click import + 'customized' badge. NOTHING consumes vocab_models rows yet — it's the growing knowledge base for the future photo-scanning feature. Access model: Vocabulary button + all CRUD = founding admins only; other workspaces CONSUME (chips render in Step 3, brand keywords auto-merge into tags when the brand matches) but never see the dashboard. **Brand→chip suggestions (July 2026):** when the current item's brand has curated words, related chips float to the FRONT of the Step 3 chip row with an amber 'suggested for {brand}' treatment — matching is loose (exact word OR ≥4-char prefix, so brand word 'skate' suggests chip 'skater'); per-brand terms cached per session in PDG; suggestion styling never overrides the active (--on) state
- ✅ **CSV Vendor = seller, not garment brand (July 2026)** — the Vendor column now carries the RESELLER: `buildShopifyCsvRows/buildShopifyCsv` accept a `vendorName` param (falls back to `product.brand` when absent — legacy behavior, golden unchanged); App resolves it as settings `vendorName` → 'C&D Vintage' for the founding workspace → workspace name, and passes it to `GoogleSheetExporter` (download + preview). `vendorName` lives in the `description_settings` JSONB (no migration; editable in the OrgPanel format section). The short-lived preset.vendor→brand wiring was REVERTED (it would have leaked the shop name into brand/titles) — preset `vendor` is unused again, locked by test
- ✅ **Preset audit fixes (July 2026)** — six wiring gaps closed after a field-by-field audit of the preset CRUD → apply → CSV chain: (1) `CategoryZones.findPreset` rebuilt — product_type exact match first (default preferred), then category_name, then the auto-created `<name>_default` prefix; the WILD FALLBACK to any is_default preset (which applied another category's defaults to unmatched categories) and the sloppy substring match are GONE — unmatched categories get plain category assignment; (2) preset `shopify_product_type` now reaches the CSV: full taxonomy path (contains '>') → Product Category column with Type from its last segment, short value → Type column, unset → category-name maps as before (locked by 3 tests; golden unchanged); preview kept in parity; (3) preset weight converted to grams at apply time (`WEIGHT_UNIT_TO_GRAMS` in applyPresetToGroup — item.weightValue is always grams, the lb/oz/kg dropdown was silently exporting raw values as grams); (4) preset `vendor` wired as the default brand (voice/manual brand wins); (5) `suggested_price_max` wired as the compare-at fallback (explicit compare_at_price wins); (6) `measurement_template` finally consumed — Step 3 shows an amber "needed" badge on template-flagged empty measurements (render helper, not hidden fields); (7) new workspaces now seed a default preset per default category (product_type match + measurement template) so Step 2 preset buttons work out of the box. All locked by applyPresetToGroup + csvExport tests (104 passing). Still open: the full ~45-field preset surface is editable only via SQL — the CRUD covers 18 (deferred UI pass)
- ✅ **Model-written selling paragraph — hybrid prose architecture (July 2026)** — `supabase/functions/generate-prose/index.ts` (2nd Edge Function; Cloudflare Workers AI, `@cf/meta/llama-3.1-8b-instruct`; secrets `CF_ACCOUNT_ID`/`CF_API_TOKEN`, 503 without them; verify_jwt ON) writes ONLY the short selling paragraph — the rule-based template engine keeps owning the skeleton so the model can never corrupt a measurement/price. `src/lib/proseService.ts` requests + VALIDATES (15-120 words, `PROSE_BANNED_PHRASES`, no hashtags/links, NUMBERS GUARD: every digit sequence in the prose must appear in the provided facts) — anything invalid → null → today's output (tested in proseService.test.ts). Rendering: `ProductContext.proseParagraph` replaces the raw customDescription note in PART 1b (keywords still feed titles/tags; absent = byte-identical, golden safe). Per-workspace: `proseEnabled` (DEFAULT FALSE — no behavior change until a workspace opts in) + `proseStyle` (voice notes) in description_settings JSONB, editable in the OrgPanel Settings tab; PDG requests prose in parallel with brandTerms only when enabled. UI copy never says "AI" ("selling paragraph", "language model")
- ✅ **Per-workspace description format settings (July 2026)** — `organizations.description_settings` JSONB column (`org_description_settings.sql`, run manually; NULL = defaults; existing org SELECT/UPDATE RLS covers it). Shape + defaults in `src/lib/descriptionSettings.ts` (measurementPrefix '✠', washingLine, closingLine 'BUNDLE AND SAVE!!!!!!', includeHashtags, disclaimerLines[4]); `createFallbackDescription` resolves `context.descriptionSettings` over defaults — DEFAULTS ARE BYTE-IDENTICAL to the old hardcoded output (golden test unchanged; custom-settings test added). Editing UI: "Listing description format" section in OrgPanel (org admins of ANY org — loaded once, not on action reloads, so unsaved edits survive); App fetches settings when the org resolves and passes them to PDG via the new `descriptionSettings` prop → threaded into `generateProductDescription` on Generate. Tags are ALWAYS computed (CSV needs them) — the hashtags setting only gates their rendering in the description body. Also: user-visible "AI" wording removed from Step 3 ("Generated Description:", button/help text) — it's a rule-based engine, and Landing/Auth already banned the term
- ✅ **Founder Vocabulary dashboard (July 2026)** — `VocabDashboard.tsx` modal (header "Vocabulary" button, visible ONLY to Founding Workspace owners/admins) CRUDs two new GLOBAL tables (`supabase/migrations/vocab_tables.sql`, run manually; reuses `is_beta_admin()` for writes, SELECT open to all authenticated — every workspace consumes the vocabulary, only founders edit it): (1) `descriptor_chips` — the Step 3 quick-keyword chips, with `label` (button text) vs `output_text` (what gets inserted; NULL → label); PDG loads active chips via `vocabService.fetchActiveChips()` and falls back to the hardcoded `DESCRIPTOR_KEYWORDS` list when the table is missing/empty (migration seeded with the same 31); (2) `brand_keywords` — words per brand (unique on lower(brand)); `getBrandTerms(brand)` is fetched in PDG's Generate path and passed as `brandTerms` into `generateProductDescription`, where `generateTagsFromFields` merges them on every path like preset tags (locked by test). Augments the hardcoded BRAND_DNA engine, does not replace it
- ✅ **Voice description overhaul (July 2026)** — three compounding bugs fixed: (1) `handleTableFieldChange` no longer REBUILDS the whole transcript from structured fields (which deleted all freeform narration on every field write, and the 500ms direct save persisted the loss) — it now surgically patches/appends/removes only the edited field's "label value period" line via `patchVoiceLine`; (2) "description … period" captures EVERYTHING up to "period" — narration words that double as field triggers (sleeve/style/length/care…) no longer chop it up, in BOTH the live pipeline (description mode swallows segments until period; interim highlighting can't switch away) AND the extractor (`extractFieldsFromVoice` skips FIELD_BOUNDARY_RE for description and scrubs the matched span so description words can't leak into other fields — locked by 2 tests); (3) `customDescription` added to the `slimForWorkflowState` whitelist so it survives reload (no products column holds it). Also: `pagehide` listener added beside `beforeunload` (back-button/bfcache doesn't fire beforeunload reliably). **Quick keyword chips**: `DESCRIPTOR_KEYWORDS` (~30 curated resale descriptors — faded, distressed, single stitch, y2k…) render as toggle chips above the voice table in Step 3; toggling routes through `handleTableFieldChange('customDescription', …)` so chips get group-wide update + transcript patch + auto-save for free
- ✅ **Voice "description" field + description-based titles** (commits `9c1106d`, `9c1d866`, `0c96397`, `ef7514f`) — spoken `"description ... period"` captured as its own field, injected after the title in AI output; when present, the title is built from description keywords with a stop-word filter (grammatical filler only — descriptive words are kept)
- ✅ **User-typed title respected** (commits `109dc2a`, `62a3e51`, `4b350f1`) — a manually entered seoTitle is used as the description opener verbatim and is never overwritten by Regenerate; the auto-generated opener (size + Vintage prefix) still applies in the description body when no manual title exists
- ✅ **CSV export integrity** (commit `3a70b52`) — group-wide field coalescing (first non-blank value across the whole group per field); export hard-blocked with alert + banner when any product has $0/no price; titles unique within the export AND against existing titles from the app DB + live Shopify
- ✅ **Shopify duplicate-title cross-reference — first Edge Function** (commit `3a70b52`) — `supabase/functions/shopify-titles/index.ts` (Deno) reads all product titles/handles from the Shopify Admin GraphQL API server-side (Admin token as Supabase secret, never in the client bundle); invoked best-effort from `GoogleSheetExporter.tsx`; silent fallback to DB-only dedup when not deployed
- ✅ **Grouper restore fix — match by productGroup** (commit `3a70b52`) — `handleOpenBatch` previously matched restored items to DB products by shared title/list-position, bleeding the wrong product's images/fields across items on reopen; now matches by `productGroup` (collision-free); each item keeps its OWN photo; the dangerous position-index fallback was removed
- ✅ **Shared-file storage guard** (commit `de9f8a9`, `src/lib/storageSafety.ts`) — duplicated batches share storage files (a duplicate's workflow_state references the original's paths); deletes now call `filterUnreferencedStoragePaths()` which keeps any path still referenced by a product outside the deletion set; fails safe (keeps files) on lookup errors; must run BEFORE the product_images rows are deleted
- ✅ **Image-load errors no longer delete DB rows** (commit `7d146ec`) — transient CDN/load failures were triggering product_images row deletion; deletion-on-error removed; large `IN()` queries chunked
- ✅ **Auto-save never forks a duplicate batch when RLS-blocked** (commit `050a7bf`) — when editing someone else's batch pre-collab-migration, the UPDATE returned 0 rows and the code created a new batch; now detects the RLS-blocked case and does not fork
- ✅ **Last-edited-by** (commit `2440569`) — auto-save stamps `lastEditedBy` (email) + `lastEditedAt` into `workflow_state`; `fetchWorkflowBatchesMeta` surfaces them cheaply via JSONB sub-key projection (`workflow_state->>lastEditedBy`) without pulling the heavy blob; Library batch cards show "edited by <email>"
- ✅ **Collaborative-edit RLS migration** (`supabase/migrations/collaborative_edit_policies.sql`) — INSERT/UPDATE opened to any authenticated user on the 3 workflow tables; DELETE stays owner-scoped; idempotent with rollback SQL included; client code is forward-compatible (works owner-only until the migration is run)
- ✅ **Delete any batch/listing** (commit `308ce2a`) — since DELETE RLS stays owner-scoped, Library now "claims ownership" (chunked `UPDATE user_id = auth.uid()`) on products before deleting another user's batch or listing
- ✅ **Pick mode** (feature + fix `f5a23b3`) — `🟢/⬜ Pick` toggle in the Step 2 sidebar auto-selects the next N ungrouped images (N = the Photos/item value, quick-set slider 1–10) so the user can rapid-fire group; pick mode owns the selection lifecycle (click-outside deselect is suppressed); after each group action it advances to the next N; pool is ANY ungrouped singleton **regardless of category** — the earlier categorized-singleton exclusion broke the ungroup→crop→regroup flow by silently turning pick mode off
- ✅ **Columns-per-row slider** — `⊞ Columns` range input (2–12) in the Step 2 sidebar controls grid density
- ✅ **Batch delete persistence — no more resurrection** (July 2026) — users reported deleted batches "coming back" on refresh or not deleting at all. Three-part fix: (1) **tombstone registry** in `workflowBatchService.ts` (`markBatchDeleted`/`isBatchDeleted`, persisted to localStorage key `sortbot_deleted_batch_ids`, capped 200) — `autoSaveWorkflowBatch` refuses to write to a tombstoned id, and `deleteWorkflowBatch` tombstones on confirmed row deletion; (2) **confirmed-batch set** (`markBatchConfirmed`, called from startup restore, `handleOpenBatch`, `getWorkflowBatch`, and successful auto-save UPDATEs) — when an auto-save UPDATE affects 0 rows and the row is gone, a batch that was previously CONFIRMED is treated as deleted (tombstone + skip) instead of re-created; only never-confirmed batches (failed stub INSERT recovery) still get re-created; (3) **`onBatchDeleted` callback** Library → App.tsx (`handleBatchDeleted`) — deleting the ACTIVE batch now cancels pending debounce timers (`autoSaveTimerRef`, `groupUpsertTimerRef`, `chunkTimerRef`), clears all four item arrays, and removes `sortbot_current_batch_id`/`sortbot_workflow_backup` from localStorage. Also: **delete failures are no longer silent** — Library shows a dismissible red `.library-delete-error` banner when `deleteWorkflowBatch` returns false (RLS-blocked), and bulk delete only removes the batches that actually deleted, reporting the failed count
- ✅ **Voice "fits like" size note** (July 2026) — `"size large fits like period"` → size stored as `L (fits like)`; `"size large fits like medium period"` → `L (fits like M)` (leading articles stripped: "fits like a medium" → M). `normalizeSizeValue(raw, { keepFitsLike?: boolean })` splits off the `(fits like …)` note, normalizes base and target to letter symbols, and re-attaches the note only when `keepFitsLike` is passed. The note renders in the description `✠ SIZE-` line and the Step 3 size form field; titles, CSV size metafield columns, image alt text, and auto-title fallbacks all strip it via the default (a `baseSize()` helper wraps the five `product.size` sites in `GoogleSheetExporter.tsx`)
- ✅ **CSV export rows in shoot order** (July 2026) — export rows (and the preview table) were in `processedItems` array order, which drifts across merges/gap-fills/restores, so products landed in Shopify scattered; `GoogleSheetExporter.tsx` now sorts groups by earliest `capturedAt` of each group's members (matching Step 2's default ↑ Date sort), tiebreak by `originalName` natural order; within-group image order (primary image, positions) is untouched
- ✅ **Test suite bootstrapped — Vitest + 39 characterization tests** (July 2026, refactor Stage 1) — `vitest` + `happy-dom` devDependencies; `npm test` / `npm run test:watch`; `vitest.config.ts` injects dummy Supabase env vars. Coverage: voice/size/title engine, preset priority hierarchy, delete tombstones (see §3). The suite caught two real title-engine bugs on day one (next two bullets)
- ✅ **Title engine: size synonym groups removed from `TITLE_SYNONYMS`** (July 2026) — `fitTo60` could respell a title's size ("XL" → "extra lg"), violating the sizes-always-letter-symbols rule (commit `28e9d9b`); sizes already enter titles as letters via `normalizeSizeValue`, so the swap groups could only hurt; locked in by test
- ✅ **Title engine: per-group swap lock in `fitTo60`** (July 2026) — synonym swaps compounded when a replacement contained its own group's canonical word ('90s' → 'early 90s' → 'early mid 90s' → 'early mid late nineties'); each synonym group may now be used at most once per title (`usedGroups` set); same failure family as the historic "extra l size" corruption (`58376d2`); locked in by test
- ✅ **CSV builder extracted to `lib/csvExport.ts` + golden CSV test** (July 2026, refactor Stage 3) — taxonomy/type/GID maps, category/type resolvers, `buildCleanTitle`, the 54-column header list, and the row-building loop moved VERBATIM out of `GoogleSheetExporter.tsx` (974 → ~450 lines) into pure functions; the component keeps data fetching, group coalescing, title dedup, the price gate, the preview table, and the blob download; the preview's duplicated `resolveCategoryPathPreview`/`resolveProductTypePreview` copies were replaced with the shared lib functions; `csvExport.test.ts` locks headers/row-shape/handle-dedup/compare-at/tag-extraction/taxonomy rules + a golden snapshot of a full two-product CSV
- ✅ **`slim()`/`ultraSlim` extracted to `lib/slimItems.ts` + roundtrip tests** (July 2026, refactor Stage 3) — the save→reload whitelist contract is now unit-tested: preserved fields exact-match, `file`/`preview`/`_presetData`/DB-recoverable text proven stripped, JSON-serializability proven
- ✅ **Dependency-free `workflowStore` created (Stage 2 foundation, NOT yet wired)** (July 2026) — `src/lib/workflowStore.ts`, ~40 lines on React's built-in `useSyncExternalStore` (no library, per user's dependency-free requirement); `getState()` gives live reads inside async callbacks — the designed replacement for the entire ref-mirror pattern; selector rule documented (return state slices directly); fully unit-tested; consumers migrate one PR at a time (PDG's duplicate `processedItems` first)
- ✅ **Library `loadAll` derivation extracted to `lib/libraryData.ts` + tests** (July 2026, refactor Stage 3) — the pure transformation `(wfBatches, savedProducts, savedImages) → {batches, groups, images}` moved VERBATIM out of `Library.tsx` (3,030 → ~2,830 lines), including batch synthesis, both productGroups builders + saved-wins merge, the two-pass imageList with per-product-id dedup and gap-fill, and the empty-unassigned skip; the component keeps fetching, cancellation, loading state, setState, collapse bookkeeping, and diagnostics; `ProductGroup`/`ImageRecord` types, `cleanTitle`, `makeBatchName` now live in the lib; the dead `batchIdsCoveredByWfState` set was dropped; `libraryData.test.ts` (12 tests) locks the dedup-by-product-id-regardless-of-batch_id rule (`8643c5d`), gap-fill (`69dd319`), legacy no-workflow_state path, URL reconstruction, batch synthesis, newest-first sort, and unassigned handling
- ✅ **Stage 2a: the four item arrays moved into `workflowStore`** (July 2026) — App.tsx's `useState` for `uploadedImages`/`groupedImages`/`sortedImages`/`processedItems` replaced with `useStoreItemArray(key)` (a `useState`-compatible adapter — value AND functional-update setter forms — so all ~74 setter call sites are UNCHANGED); the four per-render ref mirrors replaced with module-level `liveArrayRef(key)` views whose `.current` getter always reads live store state (all ~30 read sites unchanged, staleness now impossible by construction); semantic note: `.current` is fresh immediately after a setter call instead of after the next render; PDG's duplicate `processedItems` copy is the NEXT consumer to migrate — once it reads the store directly, `onProcessed`/`isResettingRef`/the structure-sync effects all go away
- ✅ **Stage 2b: PDG's duplicate `processedItems` copy RETIRED — one homework sheet** (July 2026) — `ProductDescriptionGenerator` now reads/writes `workflowStore` directly via `useStoreItemArray('processedItems')` (the FULL list; all 26 write sites audited as targeted per-id/per-group patches, safe against the full list). Deleted: the local `useState` copy, the `items` prop, the prop-sync effect (`batchChanged`/`lengthChanged`/`firstIdChanged`/`structureKey` heuristics), `isResettingRef` and every suppression guard, the `previousItemsLengthRef`/`previousBatchIdRef`/`previousItemsRefRef` trackers, and PDG's per-render `processedItemsRef` mirror (now a module-level `liveArrayRef`). The Step-3 visibility filter (categorized items + true multi-image groups, commit `0922eca`) moved from App's items-prop IIFE into `buildGroupArray` itself, so all 8 group-derivation sites are consistent. App-side: `handleItemsProcessed`'s filtered-subset merge (the `dbd5d43` fix) is obsolete and removed — the callback is now purely an auto-save trigger. New safety net: a clamp effect keeps `currentGroupIndex` in range when the group list shrinks while mounted. `onProcessed` kept its signature (passes the full store list). Net: the June 2026 preset-persistence saga's entire machinery is deleted rather than maintained
- ✅ **Step 3 per-image navigation bug FIXED — group-id convention repaired + tolerant resolution** (July 2026) — user smoke test (42 images, auto-grouped by 4 into 11 groups) revealed Next/Prev cycling through all 42 images; root cause: `createGroupFromSelected` and `applyAutoGrouping` assigned fresh `crypto.randomUUID()` productGroups, violating the leader-id invariant that PDG's group builder validated against (`itemIds.has(productGroup)`), so every item silently degraded to its own listing — also multiplying the preset auto-apply + `syncGroupFieldsToDatabase` cascade per fake-listing (the perceived slowness) and scrambling preset state per image. Fix: (1) both grouping functions use the leader convention (`grouped[0].id` / first-of-chunk id); (2) `buildGroupArray` extracted to `lib/grouping.ts` with tolerant resolution — a productGroup is real when it matches an item id OR ≥2 items share it — so existing fresh-UUID batches heal on next open without regrouping; (3) `filterStep3Visible` exported alongside; `grouping.test.ts` (7 tests) locks both conventions, the 42→11 reproduction, stale-foreign-ref singletons, ordering, and the visibility rule
- ✅ **Photo tools consolidated — no more per-photo buttons** (July 2026) — the scattered per-photo hover controls in Step 2 (⟲/⟳/⟲All/⟳All/↺Orig strip + × delete on single cards, ↺Orig on group photos) are REMOVED; everything lives in the **`.photo-toolbar`** — a horizontal, sticky (top: 0, z-index 60) toolbar pinned ABOVE the photo grid at the top of `.grouper-scroll-content` (moved out of the sidebar per user request; `.ptb-btn` light-indigo button system with `--active/--primary/--warn/--danger/--ghost` variants in ImageGrouper.css): **🎯 Pick photos toggle** (`photoSelectMode` + ref) — when ON, clicking any photo INCLUDING photos inside group cards toggles its selection (`.photo-picked` indigo ring, `togglePhotoPick`), photo drag-reorder is suppressed, and click-outside never clears the in-progress selection (same guard as the auto-select pick mode); **⟲/⟳ Rotate N** buttons (`rotateSelected(±90)`) act on the whole selection; existing Copy Rot / Copy Crop / Paste-to-selected (format painter), ↺ Revert-selected, and 🗑 Delete-selected complete the cluster. The single-photo `handleDeleteImage` was deleted with its × button — all deletion goes through `handleDeleteSelected`. Deleting a group's leader photo is safe: the tolerant group-id resolution keeps remaining members grouped
- ✅ **Step 3 nav moved to the top** (July 2026) — Prev/Next + counter + group slider + 💾 Download CSV relocated from below the scrollable preview area to the TOP of the preview column, reachable without scrolling (user request)
- ✅ **Founding admins: cross-workspace user management ("Users" tab)** (July 2026) — Founding Workspace owners/admins can list EVERY account (including waitlisted users with no workspace, shown with a "no workspace" badge), add a user to any workspace, change their role there, remove them, and move them between workspaces. Backed by `founding_user_admin.sql` (`founding_list_users` / `founding_set_membership` / `founding_remove_membership` / `founding_move_user`, all SECURITY DEFINER gated on `is_beta_admin()`) + `foundingAdminService.ts` + an OrgPanel tab that hides itself pre-migration (RPC returns [] → `allUsers.length > 0` gates the tab). **Why RPCs:** `org_members` RLS is `is_org_admin(org_id)`, so founding admins cannot see or write tenant memberships at all; widening that policy would leak every tenant's member list to every org admin. **MEMBERSHIPS MOVE, DATA DOES NOT** — batches/products/images keep their `org_id` (data belongs to the WORKSPACE, not its creator), so a move is reversible and never strips a shared batch out from under the team that was working on it; the UI notice says so explicitly. Move is two-step (pick destination → confirm), remove reuses the existing `confirmKey` pattern. Every write lands in the append-only `founding_admin_audit` table (`authenticated` has SELECT only; the SECURITY DEFINER functions write it as table owner), surfaced as "Recent user changes". **Hard rail:** no operation may leave the founding org with zero owners+admins — that would permanently lock user management (only founding admins can run the RPCs), recoverable only from the SQL Editor; all three routes (remove / demote / move-out) raise and roll back. Verified against a throwaway local postgres with a stubbed `auth` schema: 12 scenarios green — non-admin gets 0 rows and 42501, a moved user's batch provably stays with the old workspace, all three lockout routes roll back, audit records only successful actions
- ✅ **Workspace panel: member detail expand + beta workspaces directory** (July 2026) — (1) member rows are click-to-expand (chevron or email): joined date, batches/products created + last-active (from `fetchMemberActivity` — count queries on rows the caller can already see, RLS-scoped), and for Founding admins the member's matching beta application (shop, store, volume, notes, status); (2) **Beta workspaces** section (Founding admins only) lists every org with plan badge, member count + emails, batch/product/image counts, created + last-active dates — backed by `beta_org_directory()` SECURITY DEFINER RPC returning AGGREGATES ONLY (deliberately not wider RLS, so founding admins never gain access to other tenants' actual data); section hides itself pre-migration (empty array on missing function)
- ✅ **Stage 4 kickoff — dual-write phase live (code side)** (July 2026) — goal: retire `workflow_state` as source of truth so the data-deleting heuristics (gap-fill cap, ±24h orphan window, stolen-row cleanup) become dead code. This step: (1) `stage4_slim_fields.sql` adds the columns for the only slim() fields without a DB home — `product_images.captured_at` (bigint Unix ms) + `product_images.original_storage_path`, `products.description_edited` (`brand_category` and `transforms` already existed); (2) `lib/imageRowSync.ts` — `stage4ColumnsAvailable()` cached probe (writing an unknown column fails the whole upsert with PGRST204, so new fields are omitted until the migration runs) + `buildProductImageRow()` now shared by all three `product_images` write paths (registerItemsInDB, upload upsert, saveBatchToDatabase), which also means **`transforms` (rotation/crop) is now written on every open/upload/save**, not just Save Batch; (3) `description_edited` gated into `saveProductToDatabase` + `updateProduct` (so the PDG debounced save carries it). READS still come from workflow_state — the flip to DB-first restore happens after the dual-write soak. NOT yet: restore-flip, blob retirement, heuristic deletion
- ✅ **Private beta program — landing page, waitlist gate, admin approvals** (July 2026) — (1) **`Landing.tsx`** marketing landing rendered at the MAIN URL for logged-out visitors (logged-in users go straight to the dashboard via session restore); nav with Pricing link + "Log in" button (→ Auth screen with a ← Back button; `showLogin` state in App); hero, stats strip, three CSS-mockup "screenshot" tour panels (grouping grid + toolbar, voice/fields, CSV table — swap for real PNGs in `public/screenshots/` later), founding-shop incentives, **pricing tiers section** (aggressive launch pricing: Starter $49 / Pro $129 featured / Studio $299 with listing caps 200/750/2,000-fair-use, $0.20/listing overage, annual = 2 months free, per-tier founding chips at 30% off for life = $34/$89/$209; rationale: Supabase marginal cost is ~$0.30–$3/org/mo, so pricing is value-based), and the signup form inserting into `beta_signups`; duplicate email (23505) shows "already on the list"; **Landing.css is px-based** so the app's 9px root font can't shrink it; **NO emojis (lucide icons only) and NO "AI" wording** on Landing/Auth/WaitlistGate (user rules — Auth header re-copied to "From camera roll to Shopify-ready listings"); the earlier standalone `beta.html` Vite entry was replaced by `public/beta.html` (meta-refresh redirect to the main URL); (2) **`beta_signups` migration** — anon INSERT forced to status 'pending', own-row SELECT for signed-in users, `is_beta_admin()` (Founding Workspace owner/admin) for manage; (3) **the gate** — `ensureOrganization` step 4: new users without membership/invite get `{ mode: 'waitlist' }` unless approved; `WaitlistGate.tsx` full-screen (request form when no signup, "on the list" when pending, "at capacity" when denied) replaces the dashboard; forward-compatible — if the migration isn't run, `getMyBetaSignup` returns 'unavailable' and the gate is skipped; (4) **admin UI** — Beta requests section in OrgPanel (Founding admins only): pending-first list with Approve/Deny; approval creates nothing directly — the requester's workspace is auto-created (named from their org_name, **`plan='beta'`** for the future paid-tier migration) on their next sign-in. Members and invited teammates NEVER hit the gate
- ✅ **Multi-org tenancy — code complete, migration pending** (July 2026) — `supabase/migrations/multi_org_tenancy.sql` creates `organizations`/`org_members`/`org_invites` (+ SECURITY DEFINER helpers `user_org_ids()`, `default_org_id()`, `is_org_admin()`, `org_has_members()`, `invited_role()`), adds nullable `org_id` to the 5 data tables with `DEFAULT default_org_id()` (so NO client insert needs to pass org_id), backfills every existing row and every existing auth user into a "Founding Workspace" (UPDATE-only — zero data loss; existing users see exactly what they saw before), and swaps all policies on the 5 tables to org-membership RLS (categories/presets additionally readable when `org_id IS NULL` for future system rows). Client: `src/lib/orgService.ts` `ensureOrganization()` resolves membership → pending invite (auto-join with invited role) → self-repair of a creator-orphaned org → create personal workspace + seed default categories; **any error returns `{ mode: 'legacy' }`** so the identical build runs correctly against a pre-migration DB; concurrent calls deduped via an in-flight promise (StrictMode). `OrgPanel.tsx` modal (header button shows org name): member list w/ roles, admin invite-by-email (invitee joins on next sign-in), revoke invite, remove member. The app's "no `.eq('user_id')` filters — RLS decides" pattern means zero query changes were needed anywhere else. NOT yet done: private storage bucket / signed URLs (bucket still public), per-org Shopify secrets, org switcher for multi-org users (first org wins)
- ✅ **Group card select bar + ⋯ actions menu** (July 2026) — the group card's crowded header (Copy/Paste/× buttons squeezed next to the badges, × at the natural click spot, no per-group ungroup at all) replaced with: (1) a full-width **select bar** (`.group-select-bar`, keeps the `group-header` class so rubber-band/deselect selectors still match) with a check circle — the whole bar toggles group selection; (2) a **⋯ dropdown** (`.group-menu-wrap`/`.group-menu`, `openMenuGroupId` state, closes on outside mousedown) holding Copy crop, Paste crop (disabled until a crop is copied), **Ungroup** (new per-group action via `ungroupGroup()` — same semantics as Ungroup Selected: members become singles, category cleared), and Delete group… (moved into `deleteGroup()` helper, same confirm + storage/DB cleanup as the old × button); (3) **photos no longer toggle selection** — the card-level `onMouseDown` skips targets inside `.group-images`, so thumbnails are purely drag-to-reorder + double-click lightbox (this also fixes double-click on a photo leaving the group in a half-toggled selection state)

- ✅ **Founder tools built in — first-party analytics, CRM, messaging** (Sept 2026) — three additive migrations (`analytics_events.sql`, `crm.sql`, `support_messaging.sql`), three services (`analytics.ts`, `crmService.ts`, `supportService.ts`, all with pure tested helpers and an `'unavailable'` pre-migration path), three components (`AnalyticsPanel`, `CrmPanel` under the Workspace panel's Founder tools tab; `SupportWidget` floating for every signed-in user, inbox mode for Founding admins). App wiring: `trackPageview` effect above the early returns, `setAnalyticsContext` on workspace resolve / `clearAnalyticsContext` on sign-out, `track()` at Beta Signup / Account Created / Batch Created / CSV Exported, `SupportWidget` mounted in both the main render and the waitlist branch, beta approve/deny → `syncCrmContacts()`. No env vars, no Edge Function, no dependency. Replaced the same-day Twenty/Plausible/Chatwoot integration entirely (user rule: 100% self-reliant). 16 new Vitest tests. **SQL verified against a throwaway local Postgres 14** with a stubbed `auth` schema + tenancy tables: all three migrations apply and re-apply idempotently; 21 smoke checks green — anon/authenticated identity pins on analytics inserts, non-admin summary → 42501, correct 7-day totals/series; CRM sync counts + stage rules + hand-edit preservation + forged-note/email-edit rejection; messaging trigger stamps, sender-role and thread-identity enforcement, cross-user isolation, reopen-on-reply, both tables in the realtime publication

### Sept 2026 — engineering review and the passes that followed (`docs/reviews/`)

Six audits were run against the tree and each was then implemented as its own pass, with the implementation logs kept beside the reports; three feature passes (full-page tools, the Messages view, Finance) followed in the same numbering. Nothing was committed by the passes themselves; the numbers below are the measured end state of the working tree (**579 tests / 40 files green · `npm run build` clean · 254 lint problems, down from 311**). The per-bullet counts are the state at the END of that bullet's pass, which is why they climb: 505 → 513 → 528 → 570 → 579.

- ✅ **Architecture review + refactors — 20 dead files deleted, five new seams, 5,819 lines removed** (Sept 2026, `01-architecture-refactors.md`) — net **3,524 insertions / 7,308 deletions** across 56 files, no dependency added, no `sortbot_*` key renamed. (1) **`lib/productRow.ts`** replaced the two byte-identical DB-row→`ClothingItem` builders and the two 45-field restore merges; the two restore paths differ in **seven** ways, not the one the report claimed, and all seven are now explicit `MergeProductRowOptions` rather than an accident — `imageStrategy` in particular MUST stay divergent (`'db-group-wins'` on startup, `'own-image-wins'` in `handleOpenBatch`, because the row is matched at group level and preferring it there made every group member show the same photo: commit `3a70b52`). (2) **`lib/storageUrls.ts`** absorbed all 23 inline `getPublicUrl` expressions across 10 files, so the private-bucket migration is now one function body; `resolveImageUrl` from the report was dropped because it had no consumer and adopting it would have changed a priority order. (3) **`lib/chunk.ts`** (`ID_CHUNK`, `chunked`) replaced 18 hand-rolled loops spelled six different ways, with the concurrency-bounding loops passing an explicit size so the two *reasons* to chunk stay distinguishable. (4) **`lib/presetResolver.ts`** unified the two preset matchers, keeping CategoryZones' 4th `<name>_default` step opt-in. (5) **`SlimItem` deleted** in favour of `PersistedWorkflowItem` + the named `asClothingItems()` widening, which removed real casts from `Library.tsx` and `libraryData.ts`. Also: `fetchWorkflowBatches` paginated and projected (it silently stopped at 1,000 batches), `removeItemsFromWorkflowBatch` made compare-and-set, Library's private 40-line `LazyImg` replaced by the shared retrying one (with `Library.css` retargeted from `.img-skeleton` to `.lazy-skeleton` so it stays visually identical), 76 `console.log`/`debug`/`table` sites routed through the gated logger, and the five deferred wirings from the other passes applied (sign-out cache purge, error reporter, the three `sw.js` cache fixes). Deleted: all six `// UNUSED` components + CSS, `hooks/useUserPresence.ts`, `services/api.ts`, `huggingfaceService.ts`, `brandMatcher.ts`, `constructionDatabase.ts`, `fitConditionDatabase.ts`, `exportLibraryService.ts`, root `huggingface-proxy.cjs`, and `COLOR_RGB_MAP` — **but `hexToRgb()` was KEPT**, because it is the `#MULTI`/`#RAINBOW` filter that keeps pattern names out of `COLOR_WORDS_LIST`.
- ✅ **Latent-defect pass — 19 confirmed bugs fixed, 40 tests, plus the Supabase test mock** (Sept 2026, `02-debugging-fixes.md`) — the ones that were destroying data: **`updateProduct` treated "0 rows updated" as success** (RLS-blocked or missing row = silent data loss); it now chains `.select('id')` and recovers by upserting **without `batch_id`**, so a recovered row starts unassigned rather than stealing a batch. **`syncGroupFieldsToDatabase` wrote a key the restore path never reads** — it now writes the group LEADER and mirrors the patch onto members in one `.in()`, so no future re-grouping can strand the text. **`registerItemsInDB`'s wipe destroyed group image rows** → `mergeProductImageRows` (§11). **`deleteWorkflowBatch` deleted children before confirming the parent** → new order (read + reference-count → claim → confirmed batch-row delete → `product_images` → `products` → storage), with `safePaths` still computed while the rows exist (§18 #15) and an incomplete lookup now leaving storage untouched rather than guessing. **`batch_id` removed from the two Step-2 `products` upserts** (the theft vector; `user_id` deliberately kept because they must still be able to INSERT). **The ±24 h orphan query** gained `.is('batch_id', null)`, a `user_id` filter and a limit. **`tusUpload`'s `async` Promise executor** swallowed a throw and hung forever → inner IIFE + a 5-minute caller watchdog that falls through to the plain PUT. **Page-teardown saves** now use a `keepalive` PATCH (`sendBeacon` cannot PATCH). **`duplicateBatch` copied no items**, so a duplicate opened empty. **`orgService`'s in-flight dedupe was module-global**, so two users signing in back-to-back shared one resolution → keyed by user id. **`price: 0` was written for "no price"** → `null`, so the restore merge falls through instead of pinning a fake $0. Plus: EXIF auto-save moved out of a state updater, a module-level startup-restore lock (StrictMode), the pageview effect gated on org resolution, the compressed-paths cleanup made functional (TUS resume now actually works), and `buildProductImageRow` used at upload time. **New:** `src/lib/testing/supabaseMock.ts`, a chainable recorder that makes query ORDER and CHUNK SIZE assertable.
- ✅ **Performance pass — main bundle −30%, 1,130× on the Step-2 grid, 52% smaller autosave** (Sept 2026, `03-performance-fixes.md`) — measured, not estimated. **Bundle:** main JS 1,249.53 → ~875 kB raw (363.42 → ~259 kB gzip) and the render-blocking CSS 188.65 → 112.50 kB (−40%, which came free with the lazy modals), by lazy-loading `exifr` (75 kB) and `jszip` (97 kB) — App imported exifr gratuitously AND `ImageUpload` imported it statically, so removing only App's would have bought nothing — plus `React.lazy` for all six modal surfaces. **Render:** module-scope `Intl` formatters + a timestamp-keyed label cache took 1,500 Step-2 date labels from 84.56 ms to 0.07 ms; a hoisted `Intl.Collator` took the name-sort comparator 3.83 → 0.20 ms; the rubber-band now writes a ref and flushes to state once per rAF, with the container rect hoisted out of both intersection loops (3,000 forced reflows → 1,501); `React.memo` on all six children with `useEventCallback` keeping every handler prop stable. **Memory:** the unbounded decoded-image cache (~24 GB at 1,500 images, tab OOM at 130–250) became a 512 MB byte-budgeted LRU; `markCompressed` went from O(n²) string churn (~2.4 GB + ~810 MB of blocking `setItem` per 1,500-image batch) to one coalesced write with quota errors WARNED instead of swallowed; the 393 KB synchronous crash backup became a **1 s trailing throttle** in `lib/workflowBackup.ts` — deliberately a throttle, not a debounce, because a debounce keeps pushing the deadline out under a continuous stream of clicks and evaporates exactly when the user is busiest. **Data loss:** six silent 1,000-row truncations paginated (the worst permanently orphaned 500 of 1,500 products' images and handed `filterUnreferencedStoragePaths` a partial set, so it also *kept* files it should have deleted) and two unchunked `IN()` lists chunked. **Network:** `saveBatchToDatabase` 1,875 → 750 round trips per 1,500 images; PDG's preset pass 375 awaited `getCategoryPresets()` fetches → 1. **Contract change:** `slimForWorkflowState` stopped persisting derived `imageUrls`/`thumbnailUrl` (§11), 1,066 → 508 KB per autosave PATCH. **Deliberately NOT done:** virtualization (no new dependencies), the export preview row cap (§14 #22), and `fetchWorkflowBatchesMeta` pagination (§14 #24).
- ✅ **Security hardening — 12 findings closed in code, 4 migrations written** (Sept 2026, `05-security-fixes.md`; **no SQL was executed**) — **the two Edge Functions were the urgent part**: `verify_jwt` never proved a user because the anon key is itself a validly signed project JWT, so `shopify-titles` was dumping the founding store's entire Shopify catalog to any anon-key caller, and `generate-prose` was an unmetered LLM proxy on the founder's Cloudflare account. Both now resolve the caller via `/auth/v1/user` (401), the global Shopify secrets fire only for `organizations.slug = 'founding'`, `proseEnabled` is enforced server-side (403), `resolveShopHost()` accepts a single DNS label (killing `evil.com/.myshopify.com` and `user:pass@evil.com`), the prose prompt is bounded and fenced as DATA, and neither function echoes an upstream body or exception string. **In the client:** a full CSP in `index.html` with every origin proved against the built bundle (§9), `mailto:` header injection closed by `lib/mailto.ts` (returns `null` → the caller renders plain text, never an unvalidated `href`), CSV formula injection defused in `escapeCsvValue` (`-12.50` still exports as a negative number; the golden snapshot is byte-identical), the Realtime subscription narrowed from `'*'` to INSERT/UPDATE (a founder deleting a thread would have shipped its whole OLD row to every subscriber), a 10-character password minimum applied **on sign-up only** so existing accounts can still sign in, and `lib/swCache.ts` purging the Service Worker image cache on sign-out. **Four migrations are written and NOT run** (§16): invite hardening, verified-email identity, abuse limits, storage object policies — the last is deliberately INERT until the owner drops the permissive dashboard policy, and is ORG-scoped rather than user-scoped because three shipped flows legitimately write under a teammate's uid prefix. **After deploying the functions, rotate `SHOPIFY_ADMIN_TOKEN` and `CF_API_TOKEN`.**
- ✅ **UI primitive system in `src/components/ui/` — built and tested, NOT yet adopted** (Sept 2026, `04-ui-system.md`) — 13 primitives (Button/LinkButton, IconButton, Chip/ToggleChip/RemovableChip, Badge/CountBadge, Tabs, Dialog, ConfirmAction, Field + three wrappers, EmptyState, Spinner/Skeleton, Toast/ToastViewport, StatTile/StatGrid) with **76 tests** and zero lint findings; nothing outside that folder was touched. It exists because the app had grown **four conflicting definitions of `.button`** with different colours for the same class name, nine hand-rolled modal overlays with four z-indexes, six copy-pasted confirm pairs, and a tab row with no `role="tablist"` and no arrow keys — and because the accessibility work in those copies had been done zero times. Load-bearing decisions: every colour/size resolves through `index.css` tokens (**no hex literal except one documented scrim in `Dialog.css`**, which is what keeps the palette swappable in a ~45-line `:root` edit); state a screen reader must know lives in an ARIA attribute **and the CSS selects off that attribute**, so the visual and the announced state cannot drift; `IconButton`'s accessible `label` is required at the TYPE level; `Dialog` is portal-free (it is `position: fixed`, so it already escapes every ancestor), stacks Escape so a nested confirm does not close its parent, and reference-counts the scroll lock; `ConfirmAction` is the `confirm()` replacement (§18 #12) and maps 1:1 onto the existing `confirmKey` pattern; `Toast` is state-free so App keeps owning the queue policy; `index.ts` exports components and types ONLY, or `react-refresh` breaks Fast Refresh for every screen importing the barrel. **Every interactive primitive sets an explicit `min-height` in rem** because at a 9 px root, rem padding alone yields unhittable controls. Adoption is an 18-step plan in the log, ordered by payoff ÷ risk, with the rule "delete the replaced CSS in the same commit" — and the standing warning that the nav (`.app-header`, `.ld-nav`) is a deliberately inverted surface where a primitive will draw black-on-black without explicit light overrides.
- ✅ **DevOps: CI, first-party error tracking, uptime monitoring, container packaging** (Sept 2026, `06-devops-monitoring.md`) — **no Sentry, no Datadog, no third-party uptime service**; the self-reliance rule holds. (1) `.github/workflows/ci.yml` — PR/branch verification with `contents: read` only: tests, type-check + build, `dist/` verification (title + the `/sortbot/` base path §1 forbids changing), a **bundle secret-leak grep** (every `VITE_*` is inlined into the public bundle, so this is the one mistake that cannot be walked back), a **lint ratchet** that fails only if the count grew, **migration hygiene** on changed SQL files (ROLLBACK section + idempotency note required, because these are run by hand and the file is the only place a reviewer learns how to undo it), and a `deno check` job for the Edge Functions. (2) `supabase/migrations/app_errors.sql` + `src/lib/errorReporter.ts` + `src/components/ErrorsPanel.tsx` — first-party crash reporting into this project's own table, with three volume guards, PII scrubbed from message AND stack before it leaves the browser, a **closed-vocabulary CHECK on `user_agent_class`** so the privacy promise is enforced by the database, and fingerprints that survive a redeploy (the Vite content hash and `:line:col` are normalized out — without that, every deploy would split one bug into a new issue). Verified against a throwaway PG 17 cluster: 12 scenarios including forged identity, a 21-row flood, and the rollback block. (3) `.github/workflows/uptime.yml` — 15-minute probe, incidents as a single GitHub issue matched by exact title (not `gh issue list --search`, whose index lags minutes and would duplicate on this cron), with the honest limits written into the file. (4) `deploy/` — optional Docker/nginx packaging for staging, self-hosting, and a rollback artifact independent of CI, plus a written argument for why Kubernetes is the wrong tool for a static SPA + managed Postgres.
- ✅ **Header tools are full-page views, not modals** (Sept 2026, `07-full-views.md`) — the founder's complaint was that the nine overlay panels felt "crammed … too close … not inviting", which they were: 640–1200 px boxes at 0.35–0.9 rem padding (3–8 px on the 9 px root). All nine — Library, Categories, Category presets, Vocabulary, Analytics, CRM, Board, Workspace, Errors — now render as pages under the header through one new shell, **`components/ToolView.tsx`**, driven by a single `activeView` union in App.tsx (§6) that replaced six `show*` booleans. **The workflow never unmounts**: `<main>` is parked behind the `hidden` attribute, so an upload in flight, ImageGrouper's selection and Step 3's debounced saves all survive a trip to the Library. Each panel lost its overlay, its own close button and its scroll-lock; `ToolView.css` is now THE spacing scale for every tool view (page padding `3rem clamp(2rem,4vw,6rem) 6rem`, 3 rem section gaps, 2 rem cards, 4 rem controls, 4.5 rem table rows) and the per-tool CSS scopes its page overrides under `.tool-view` rather than rewriting `Library.css` (31 KB) and `KanbanBoard.css` (27 KB). Layouts that were stacked in a modal became two columns on the page: Categories = editor left / list right (its form was a modal on top of a modal), Presets = list left / editor right, Workspace = tabs as a left rail, CRM = wide detail card, Analytics = KPI row → chart → two-up tables, Library and Board full-bleed with larger thumbnails. **Errors became a sub-tab of Analytics** and the "Founder tools" tab was deleted from OrgPanel, so nothing is duplicated. Behaviour was preserved deliberately, not incidentally: Library's three grids KEEP `overflow-y: auto` because rubber-band selection measures against the grid's own `scrollTop` and its edge auto-scroll WRITES `scrollTop` — making them `overflow: visible` would have silently killed the auto-scroll; `.tool-view` uses `overflow-x: clip`, not `hidden`, because `hidden` forces the other axis to `auto` and would have turned the page into a scrollport that disables every `position: sticky` inside it; Escape stands down inside editable fields and while any `[data-tv-modal]` is open (the preset editor, `FieldModal`, Library's rename prompt) so a half-written preset cannot be thrown away; and the Board keeps Escape entirely (`escapeToBack={false}`) because it closes its card drawer first. 8 new tests lock the shell's navigation and a11y contract. **505 → 513 tests green · build clean · lint unchanged at 254.**
- ✅ **Full-page Messages view + one shared support store** (Sept 2026, `08-messages-view.md`) — the founder asked for "a messages view i can access" alongside the floating widget, so messaging became a tenth `activeView`. **`MessagesView.tsx`**: a searchable thread list (email / workspace / subject / preview) beside a full-height conversation, founder Open/Closed/All chips with live counts, unread-first ordering with a real unread-dot element so the flex row still truncates the label (and a visually-hidden "(unread)" for screen readers), Up/Down keyboard walk driven off the focused row's `data-thread-id`, an Enter-to-send composer that finally surfaces the `subject` the API always accepted, `EmptyState` for all four empty cases, and a one-column stack with an "All conversations" back control ≤1024px. ToolView supplies the title, so it reads **Inbox** for a founder and **Messages** for everyone else. Reached from a header button available to **every signed-in user** with a `.nav-badge` unread count. **The interesting part was not the page**: two front ends onto the same conversations must not become two Realtime channels, two poll timers and two lists that disagree the moment one writes — so `src/lib/supportStore.ts` (dependency-free, `useSyncExternalStore`, mirroring `workflowStore`) now holds the thread list and REFERENCE-COUNTS one channel + one 45 s poll across all consumers, with optimistic writes that copy the `support_after_message` trigger field-for-field (that copy is what makes the list settle instantly instead of a round-trip later) and a `revision` counter each consumer reloads its own messages from. Two deliberate calls: `available === false` does **not** stop the poll (a transient network failure reports the same as a missing table, and stopping would hide messaging until a full reload), and `refresh()` dedupes concurrent callers into one in-flight promise so a Realtime burst plus the poll cannot stampede. `SupportWidget` kept its behaviour exactly and lost its data layer (thread state, `loadThreads`/`loadMessages`, the subscription, the timer, the `userId` prop); `handleSignOut` calls `supportStore.reset()`. **15 tests**; `supabaseMock` gained a Realtime stub. Not verified: anything visual, and Realtime beyond the mock.
- ✅ **Finance — first-party books (Sept 2026, `09-finance.md`)** — the founder asked to "keep track of finances + users + profit and expenses + pull reports", and per §9's self-reliance rule it is three tables, one RPC and React: no payment processor, no accounting vendor, no bank feed. **`supabase/migrations/finance.sql`** (NOT YET RUN, §16): `finance_transactions` / `finance_plan_prices` / `finance_settings`, every policy `is_beta_admin()`, column-level UPDATE grants excluding `created_by`/`created_at` (verified: updating `created_by` raises 42501), + `finance_summary(from, to)` SECURITY DEFINER returning totals, the previous equal-length range, a zero-filled monthly series, category/workspace breakdowns and customer+MRR stats in ONE round-trip, with the current and previous ranges computed from a single expansion split by date so they cannot diverge. **Two rules are implemented twice and asserted against the same worked example in SQL and TypeScript** (§9): recurring rows are TEMPLATES expanded at read time with ANCHORED month steps (Jan 31 → Feb 28, **Mar 31**, Apr 30), and a founding shop is `plan = 'beta' OR created_at <= founding_cutoff` so the 30%-off-for-life promise survives the upgrade it rewards. **`FinanceView.tsx`** (Overview / Transactions / Customers / Reports, founding admins only, inside ToolView) charts in black + grey with `--success`/`--danger` reserved for profit sign, deletes through the two-step confirm pattern, and prints via the `visibility` technique rather than enumerating app chrome. Both CSVs go through `csvExport`'s `escapeCsvValue`, so the formula guard is not reimplemented. Seeded plan prices match the Landing tiers exactly (starter 5000 → enterprise 120000 cents/mo, founding shops at 70% of list) and are `on conflict do nothing`, so a founder's edit in the plan-price editor survives a re-run. **42 tests** (34 + 8); verified end-to-end against a throwaway Postgres 14 — 19 checks covering founders-only access, the recurrence and MRR math, an idempotent re-apply that preserved hand-edited prices, operation with `analytics_events` dropped, and the rollback block. **No SQL was run against Supabase.** Not built: multi-currency UI (the column exists), receipt attachments, any bank or processor import. **513 → 570 tests green · build clean · lint unchanged at 254.**

### Sept 2026 — mobile-first pass (three agents, `docs/reviews/10-mobile-*.md`)

The direction was "think mobile first for user experience". Three agents worked disjoint
file sets against one shared contract (§1): breakpoints 640/1024, a 44px touch floor, 16px
controls, and no horizontal PAGE scroll — only tables, charts and the board strip scroll,
each inside its own container. Nothing committed, no dependency added, desktop unchanged.
End state: **579 tests / 40 files green, build clean, lint flat at 254**.

- **Shell, chrome and the logged-out screens** (`10-mobile-shell.md`) — the header was a
  single row of 7-9 tool buttons that wrapped into a four-line black slab at 390px. The tools
  now leave the header below 1024px: a scroll-snapped `NavRail` on the black bar at
  641-1024px, and a fixed `MobileTabBar` (Workflow / Library / Messages / More) plus a More
  bottom sheet at `<= 640px`, all fed by the one `navTools` list (§6). New in `index.css`:
  `--safe-*`, `--tabbar-row`, `--tabbar-h`, `--tap`, `text-size-adjust: 100%`, a global
  tap-highlight reset with a deliberate `:active` wash under `@media (hover: none)`, and the
  `<= 640px` block that raises `--tabbar-h` on `.app-container` and applies the 16px/44px
  floors. `viewport-fit=cover` added to the viewport meta (the CSP meta is byte-identical).
  `ToolView`, `SupportWidget` (full-screen `100dvh` sheet with a pinned composer), Landing,
  Auth and WaitlistGate all got phone blocks. **Two real bugs fixed:** the landing's mock
  panels could not shrink (grid items default to `min-width: auto`, so at 360px the two-column
  mocks ran ~30px past their panel and `.ld-shot`'s `overflow: hidden` silently clipped them —
  fixed with `min-width: 0`), and a CSS comment in `MobileNav.css` whose stray `*/` swallowed
  the entire `.nav-rail` rule, so the rail rendered at every width (§18 #30). Measured at
  360/390/820/1280: zero horizontal overflow, zero sub-44px targets except four inline photo
  credits (WCAG 2.5.8 exempts inline links in a sentence), desktop provably unchanged.

- **The thirteen tool views and the `ui/` primitives** (`10-mobile-pages.md`) — two root
  causes drove most of the diff: the 9px root makes rem-padded controls 16-20px tall, and
  `ToolView.css` pins every control in a tool view at (0,5,1) with 14px, under iOS's 16px zoom
  threshold (§1). One shared `<= 640px` block at the end of `OrgPanel.css` fixes five views at
  once (OrgPanel, Analytics, Errors, CRM, Finance): touch + 16px floors, **two-up KPI tiles**
  (`auto-fit minmax(20rem,1fr)` was collapsing a four-tile row into four screens), filter rows
  that **scroll rather than wrap**, and two table treatments picked per table — either
  contained scroll with a sticky opaque first column (where `white-space: nowrap` is
  load-bearing: without it auto table layout squeezes to fit and there is nothing to scroll),
  or `.an-table--cards`, which hides `<thead>` and prints `attr(data-label)` per cell. Finance's
  ledger gets a bespoke three-line card via `data-col` + `grid-template-areas` — attribute-keyed,
  so re-ordering a column in the JSX cannot scramble the card. All six `ui/` primitives
  (Button, IconButton, Chip, Tabs, Field, Dialog) took the 44px floor, and `Dialog` became a
  bottom sheet at `<= 640px` using `dvh` with a `vh` fallback and `--safe-b` footer padding.
  Library drops to **two** columns (not one) with hover-only controls pinned visible; Kanban
  lanes become one-lane-at-a-time scroll-snap and the card detail a full-screen fixed sheet;
  the preset editor's ten sections became native `<details open>` (§14 #28). Print output is
  provably unaffected — every table rule sits inside `@media screen and (...)`.

- **The four workflow steps** (`10-mobile-workflow.md`) — Step 1 gets real phone capture
  (Take photos / Choose from library, both feeding the unchanged `processFiles` pipeline);
  Step 2's sidebar becomes a top toolbar with a Tools disclosure, the grid clamps to 3 columns
  via `responsiveGrid.ts` with the slider still live, and category assignment moves to a
  sticky bottom chip rail because drag-to-categorize cannot exist on touch; Step 3's
  Prev/Next/slider/CSV become a sticky bottom dock spanning image *and* form, the crop tool was
  adapted for touch and the magnifier disabled on mouse-less devices; Step 4 freezes the Handle
  column in the 54-column preview (§10). **A real bug fixed:** the voice command table's inline
  `repeat(N, minmax(90px,1fr))` grid demanded 450px and pushed the whole page into horizontal
  scroll at 390px. Every line of the shared `App.css` edit is inside one fenced block appended
  at the end of the file; no existing rule was reflowed.

- **Click-outside deselect no longer fires on the Step 2 toolbar chrome** — `.grouper-header`
  and `.photo-toolbar` were added to `ImageGrouper`'s mousedown safe-selector list. Harmless
  when the toolbar was a sidebar off to the left; on a phone it is a wide strip directly above
  the grid, so a mis-tap there silently wiped a selection the user had just built. The workflow
  log proposed it rather than doing it (it is selection logic, §14 #12 and the nine commits
  behind it); applied afterwards as a one-selector change. The full list is now:
  `.single-item-card, .product-group-card, .group-header, .toolbar, button, [role="button"],
  .category-zone, .category-zones-container, .category-zones, .category-list,
  .grouper-actions-sidebar, .grouper-header, .photo-toolbar`.

---

## 16. What's In Progress or Missing

| Item | Status | Notes |
|---|---|---|
| Real-time collaboration cursors | **Removed (Sept 2026)** | `RemoteCursors.tsx`, `useUserPresence.ts` and `LiveWorkspaceSelector.tsx` were deleted as dead code (they had compiled for months without ever being rendered). Rebuilding presence means writing it fresh against the current org RLS. |
| AI image vision analysis | **Removed (Sept 2026)** | `huggingfaceService.ts`, `TestLlamaVision.tsx`, `AISettings.tsx` and the root `huggingface-proxy.cjs` are deleted. Photo scanning is still a wanted feature (the `vocab_models` knowledge base exists for it), but nothing of the old localhost-proxy attempt remains. |
| Google Drive / Sheets integration | Dead | Never implemented. The env vars were dropped from `.env.example` in Sept 2026. |
| Export library tracking | **Removed (Sept 2026)** | `exportLibraryService.ts` is deleted (no UI ever rendered it). `supabase/migrations/export_library.sql` still exists, so the tables may be live in the database with nothing reading them. |
| Batch duplication | Wired in Library service | `duplicateBatch()` exists in `libraryService.ts` and button exists in Library UI, but behavior after duplication is not fully tested. |
| Photo reorder persistence | Missing (half fixed) | Reorder in Step 3 still does not WRITE `product_images.position`. The destroying half is fixed: `mergeProductImageRows` now preserves and renumbers positions instead of letting the wipe flatten them (§11). |
| Automated tests | **Done** | Vitest, 579 tests / 40 files (§3). `npm test` is step 0 of §17 and runs in CI. |
| `SavedProducts` / `TestLlamaVision` components | **Deleted (Sept 2026)** | Along with four other unused components and 14 other dead files. |
| Error boundaries | Partial | `GrouperErrorBoundary` wraps Step 2 and reports to `app_errors`. Steps 1/3/4 and the modals have none — the lazy modals do at least have `Suspense` boundaries. |
| Loading state for Library tabs | Partial | `loading` state shown at top level but individual tab switches have no loading indicator. |
| "Next" navigates per-listing | **FIXED (July 2026)** | Root cause found: Group Selected + auto-group assigned fresh-UUID group ids that Step 3's leader-only validation rejected, degrading every item to its own listing. Fixed both directions: grouping uses the leader convention again, and `lib/grouping.ts` resolves group ids tolerantly (heals old fresh-UUID batches). Locked by `grouping.test.ts` incl. a 42-image/11-group reproduction. |
| AI description prefix "Vintage / y2k" | Pending | Add to start of every AI-generated description in `textAIService.ts`. |
| Sync Fields from Description | Done | "🔁 Sync Fields from Description" button added in Step 3 below the description textarea — re-parses edited description text back into structured fields (size, brand, color, etc.) via `generateProductDescription`. |
| Library tally live sync | Partial | Tab counts (images/groups/batches) don't update live when edits happen in Steps 2–4 until Library is re-opened or refreshTrigger fires. |
| Shopify taxonomy map coverage | Partial | `SHOPIFY_CATEGORY_MAP` in `GoogleSheetExporter.tsx` maps only 6 short category names. System presets now use full Shopify taxonomy paths as `shopify_product_type` (seeded via `seed_gender_category_presets.sql`), but the CSV exporter reads `item.shopifyProductType` from preset-applied data — ensure preset application writes `shopifyProductType` through to items for full coverage. |
| Shopify read integration (dup-title cross-ref) | Done, per-org (needs deploy + migration) | `shopify-titles` resolves the CALLER'S ORG connection from `org_shopify_connections` (org admins connect via Workspace panel → Shopify section; `shopifyConnectionService.ts`); global `SHOPIFY_STORE`/`SHOPIFY_ADMIN_TOKEN` secrets are the fallback for the Founding Workspace/legacy only; other unconnected orgs get a clean empty result. Requires `supabase functions deploy shopify-titles` + running `org_shopify_connections.sql`. Exporter falls back silently to DB-only dedup either way. |
| Shopify WRITE integration (direct publish, no CSV) | Missing | Products still reach Shopify via manual CSV import. A `productSet`/`productCreate` mutation path through an Edge Function would remove the CSV step entirely. Per-org credentials now exist (`org_shopify_connections`) — a write path would reuse the same connection with a `write_products` scope token. Metaobject GIDs are per-store SOLVED (July 2026): `shopify-titles` also returns the store's color/fabric/gender metaobject maps (needs `read_metaobjects` scope, omitted on failure); `csvExport.ts` resolvers accept `GidOverrides` (alias-aware: cream→beige, mens→male; NO fallback to foreign hardcoded GIDs — blank instead); exporter passes them to CSV + preview. Hardcoded founding-store maps remain the no-override default, locked by golden test. |
| Founding cross-workspace user admin | **Built — migration not yet run** | `founding_user_admin.sql` + `foundingAdminService.ts` + OrgPanel "Users" tab. Ship code first (tab stays hidden — the RPC returns [] pre-migration), then run the SQL after `multi_org_tenancy.sql` + `beta_signups.sql`. Manages memberships only; real auth-account create/delete was deliberately NOT built (needs a service_role Edge Function — full RLS bypass, much larger blast radius). A "deleted" user is one with no memberships: they keep the account and hit the waitlist gate. |
| Multi-org / multi-tenant support | **Built — migration not yet run** | `multi_org_tenancy.sql` (org tables + org-scoped RLS + additive backfill into a Founding Workspace) + `orgService.ts` (bootstrap with legacy fallback, invite accept, personal-workspace creation w/ seeded categories) + `OrgPanel.tsx` (members/invites UI) + App.tsx wiring (header Workspace button). Safe deploy order: ship code first (legacy mode), then run the migration in the SQL Editor after a DB backup. Storage bucket remains public and Shopify secret remains global — Phase 1b/2 in ANALYSIS.md. |
| Collaborative-edit migration status | Verify in dashboard | `collaborative_edit_policies.sql` must be run manually; client code works either way (owner-only until run). Confirm which state production is in before debugging duplicate-batch reports. |
| **UI primitive system adoption** | **Built, tested, NOT adopted** | `src/components/ui/` ships 13 primitives + 76 tests and is imported by NOTHING (Sept 2026). Adoption is the 18-step plan at the end of `docs/reviews/04-ui-system.md`, ordered by payoff ÷ risk: #1–#9 are low-risk leaves (ConfirmAction ×2, Badge, EmptyState, StatTile, ToggleChip, IconButton, Toast, Button-in-OrgPanel) and can land as one series; #10–#13 want a visual pass per screen; #14–#16 are the Dialog migration and should land together with a keyboard sweep (Escape, Tab trap, focus restore) per modal; #17 (`.button`, four conflicting definitions) last and alone, moving `.batch-actions .button`'s `flex:1`/`min-width` to the wrapper rather than into the primitive. **Rule: delete the replaced CSS in the same commit** — a half-migrated stylesheet is worse than either end state. Do not place a primitive in `.app-header` / `.ld-nav` without explicit light overrides. |
| **`app_errors.sql`** | **Written, NOT run** | Prereqs: `multi_org_tenancy.sql` + `beta_signups.sql` (needs `organizations` and `is_beta_admin()`). Additive, idempotent, rollback at the bottom; the VERIFY block is the smoke test. Until it runs, `errorReporter` latches off and **Founder tools → Errors** shows a setup hint. Retention is manual: `select public.app_errors_prune(90);`. |
| **`security_invites_hardening.sql`** | **Written, NOT run** | Prereq: `multi_org_tenancy.sql`. **Must run BEFORE `security_verified_email.sql`** (that file re-creates the same two `org_invites` policies). Closes invitee → OWNER self-promotion. If the unique index raises a `notice`, clean the duplicate invites with the query in its VERIFY (c) and re-run. |
| **`security_verified_email.sql`** | **Written, NOT run — has a precondition** | Prereqs: `multi_org_tenancy.sql`, `beta_signups.sql`, `support_messaging.sql`, `crm.sql`, `kanban_board.sql`, and the invites migration above. **PRECONDITION — run `select count(*) from auth.users where email_confirmed_at is null;` first and confirm it returns 0** — such accounts lose exactly three abilities (accepting an invite, reading their own `beta_signups` row, opening a support thread with their email). **Dashboard first:** Authentication → Providers → Email → **Confirm email** ON (with it OFF, Supabase auto-confirms and stamps the column, which is also fine; what breaks is the in-between state). |
| **`security_abuse_limits.sql`** | **Written, NOT run** | Prereqs: `analytics_events.sql`, `beta_signups.sql`, `support_messaging.sql`. Independent of the other three. Every CHECK is `NOT VALID`, so existing history is untouched; VERIFY (f) lists the rows that would fail a future `validate constraint`. If this Postgres rejects `pg_column_size()` inside a CHECK, the header gives the `octet_length(props::text)` equivalent. |
| **`security_storage_policies.sql`** | **Written, NOT run — and INERT until one manual step** | Prereq: `multi_org_tenancy.sql`. RLS policies are OR'ed, and a permissive `storage.objects` policy exists in the dashboard under an unknown name (this repo has never contained one, yet uploads work). Run the section 0 inventory, note the exact name, then uncomment the matching drop in section 4 — until then the new scoped policies change nothing. Immediately afterwards exercise: **upload a folder · crop a photo in Step 3 · "Compress N Images" · delete a TEAMMATE's batch from the Library.** Rollback is one `create policy` away. |
| **Supabase dashboard settings the owner must enable** | **Not done — code cannot do these** | Authentication → Providers → Email: **Confirm email** (the precondition above), **Leaked password protection**, **minimum password length = 10** (the dashboard value is authoritative; `Auth.tsx` only enforces it client-side). Authentication → **MFA (TOTP)**, especially for Founding Workspace admins — `is_beta_admin()` reaches every tenant's membership, the CRM, all support threads and every account's email. Authentication → **Rate limits** (open signup is the entry point for several findings). Database → **PITR / backups** (the delete paths are irreversible and unaudited). Storage → verify the bucket + object policies. |
| **Edge Function redeploy + token rotation** | **Pending** | `deno check supabase/functions/*/index.ts`, then `supabase functions deploy shopify-titles` and `generate-prose`. **Then rotate `SHOPIFY_ADMIN_TOKEN` and `CF_API_TOKEN`** — assume the catalog and the model quota were reachable by anyone holding the public anon key. |
| **Library `onItemsDeleted` callback** | **Proposed, not implemented** | The item-level resurrection in §14 #19. The complete edit is in `docs/reviews/01-architecture-refactors.md` B12. It is a deliberate behaviour change (deleting an image in Library while its batch is open would start actually removing it), so it needs the owner's call. |
| **Deferred proposals from the review** | Recorded, not done | Export preview row cap (§14 #22 — one-line diff in the perf log). `ImageGrouper` off its third item list and `batchRestore.ts` (splitting `handleOpenBatch` + startup restore, ~900 lines) — both need characterization tests first. PDG's `[processedItems]`-keyed save effect (§14 #21). `edge_call_log` + `edge_rate_ok` per-user Edge Function quota, and `organizations` column grants making `slug`/`created_by`/`plan` unwritable (`slug='founding'` is the key `is_beta_admin()` reads — the highest-value remaining migration), both with SQL ready to lift from `docs/reviews/05-security.md`. `F16` (`updateGroupField` mutating live store objects in place) is what blocks per-item memoization. Lowering `LINT_BASELINE` in `ci.yml` from 311 to 254. |
| Founder tools (analytics / CRM / messaging) | **Built — migrations not yet run** | Run `analytics_events.sql`, `crm.sql`, `support_messaging.sql` in the SQL Editor (after tenancy + beta_signups). Nothing else to configure. Messaging now has BOTH front ends — the floating widget and the full-page Messages/Inbox view (§6) — over one `supportStore` (§8). Not built yet: email/push notification to founders on a new message (the badge + Realtime is the only signal), analytics retention UI (`analytics_prune()` is SQL-Editor only), CRM CSV export, per-contact activity from analytics (events are joinable by user_id — an easy next step), bulk actions in the inbox. |
| **Finance** | **Built — migration `finance.sql` not yet run** | `supabase/migrations/finance.sql` + `src/lib/financeService.ts` + `src/components/FinanceView.tsx`. **Every read reports `'unavailable'` until the SQL is run** and the view shows the setup step instead, so the Finance button is safe to expose immediately. Run it in the SQL Editor after `multi_org_tenancy.sql` + `beta_signups.sql`; additive, idempotent, rollback at the bottom. Seeded plan prices already match the Landing tiers and are editable in **Finance → Customers → Plan prices** without a migration (`on conflict do nothing`, so a re-run never overwrites an edit) — but note the migration header still carries a stale paragraph claiming the seeds predate Landing's tiers; the seeds themselves are current. Not built: multi-currency (the `currency` column exists, the UI is USD-only), receipt attachments, and any bank or payment-processor import. |
| **Mobile-first pass** | **Built, not yet seen on a device** | The whole app has phone and tablet layouts (§1, §6, §10, §15), but no agent could sign in, so nothing past the logged-out screens was rendered. A signed-in smoke test and a real-iOS pass are the two things owed — §14 #26/#27 list exactly what that leaves unverified. Everything on that list is single-number CSS tuning, not structure. |
| **Step 2 selection on touch** | Partly done | `.grouper-header` and `.photo-toolbar` were added to the click-outside safe-selector list (§15). Two proposals from `10-mobile-workflow.md` §9 are recorded, NOT done, because both touch the selection handlers §14 #12 and nine prior commits say to leave alone without a smoke test: (a) a native `pointerdown` selection path — today's `onMouseDown` works because a tap fires exactly one synthesized `mousedown`, so the 200 ms per-item debounce cannot swallow it; (b) a "done selecting" affordance in the category dock, since with pick mode off nothing signals that tapping a category consumes the selection (the dock's "N items selected" hint covers it partly). |

---

## 17. Before Marking Any Task Done

Run these commands and confirm all pass:

```bash
# 0. Tests must pass
npm test
# (Vitest; snapshot changes must be intentional — see §3)

# 1. TypeScript must have zero errors
npm run build
# (runs tsc -b && vite build — any type error fails the build)

# 2. Lint must introduce zero NEW errors
npm run lint
# ⚠️ Current baseline (Sept 2026): 254 problems — 238 errors + 16 warnings, down from 311.
#    182 @typescript-eslint/no-explicit-any, 25 no-unused-vars, 14 react-hooks/static-components,
#    13 no-useless-escape, 12 react-hooks/exhaustive-deps, 4 parse (the .sql-adjacent files),
#    1 each ban-ts-comment / set-state-in-effect / prefer-const / react-refresh.
#    Do not add to the count. Measure per-file against `git show HEAD:<file>` piped through
#    `eslint --stdin --stdin-filename` when a file is already dirty.
#    NOTE: .github/workflows/ci.yml still sets LINT_BASELINE: 311, so CI will not catch a
#    regression between 255 and 311 until that line is lowered to 254.

# 3. CI runs 0-2 for you on every PR and on every push to a non-main branch
#    (.github/workflows/ci.yml), and additionally verifies dist/ (title + /sortbot/ base path),
#    greps the built bundle for credential-shaped strings, and requires a ROLLBACK section +
#    an idempotency note in every migration the PR changed. A red CI run is not advisory.

# 4. Manual smoke test checklist:
# - Can sign in
# - Can upload 3+ images
# - Can group 2 images together
# - Can assign a category to the group
# - Can record voice description (Chrome/Edge only)
# - Can generate AI description
# - Can download CSV
# - Can save batch
# - Can open Library and see correct image count
# - Can reopen a batch from Library
# - Page reload restores last session
# - Browser console shows NO CSP violation (the policy is a <meta> in index.html):
#   landing photos render, sign in, upload a folder, Step 2 thumbnails, Step 3 crop,
#   CSV download, Library, Realtime support widget
```

---

## 18. Do Not

1. **Do not add `.eq('user_id', ...)` filters to `fetchWorkflowBatches`, `fetchSavedProducts`, or `fetchSavedImages`.** The shared workspace intentionally shows all users' data. RLS handles permissions. Per-user filtering was deliberately removed.

2. **Do not run `supabase/migrations/shared_workspace_rls.sql` again** unless intentionally changing the shared workspace policy. It drops existing per-user SELECT policies and replaces them with "all authenticated users see all rows."

3. **Do not remove the delete phase from `registerItemsInDB`'s `product_images` write, and do not let its `products` upsert overwrite `batch_id`.** The current hybrid (delete chunked → upsert `ignoreDuplicates: true`) prevents both stale-row accumulation (rows inflated 816 → 1747 in the pure-upsert era) and cross-batch `batch_id` theft (the `ignoreDuplicates: false` era). Also keep the `original_name` pre-fetch that runs before the delete.

4. **Do not add new arrays to `workflow_state`** without updating the restore fallback chain in BOTH `handleOpenBatch` AND the startup restore `useEffect`. Forgetting either will silently discard that data on reload.

5. **Do not call `slim()` (`slimForWorkflowState`) without understanding what it strips.** It removes `file`, `preview`, `_presetData`, **and — since Sept 2026 — `imageUrls` and `thumbnailUrl` for any item that has a `storagePath`.** Any code that reads from `workflow_state` must handle all five as undefined/empty and rebuild the URLs from `storagePath` (§11). Adding a `ClothingItem` field that cannot be recovered from the DB means adding it to the whitelist, or it silently vanishes on reload.

6. **Do not save `file` (the File object) to any DB column.** File objects cannot be serialized. `slim()` exists precisely to strip them before any DB write.

7. **Do not use `loadAll` in Library without the `cancelRef` pattern.** React 18 StrictMode double-mounts components. Without `cancelRef`, you get two concurrent fetches that stomp each other's state.

8. **Do not add a second auto-save trigger inside Library.** Auto-save must ONLY refresh the Library on actual DB writes (`products/product_images`), not on `workflow_state` saves. Adding a Library refresh to `autoSaveWorkflow` would create an infinite loop: autoSave → Library reload → component re-render → autoSave.

9. **Do not remove the `isOpeningBatchRef` guard from `handleOpenBatch`.** React StrictMode will double-invoke it. Without the guard, `registerItemsInDB` races with itself, corrupting DB state.

10. **Do not store blob URLs (`URL.createObjectURL(...)`) in the DB.** Blob URLs are session-local. Only Supabase Storage CDN URLs should ever be written to `image_url` or `workflow_state`. Blob URLs appear as fallbacks in preview only when a Supabase upload fails.

11. **Do not directly mutate `processedItems` inside `ProductDescriptionGenerator`** outside of `setProcessedItems` (the store setter). `processedItemsRef` is a read-only LIVE view into `workflowStore` — reading `.current` is always safe; mutating what it returns will cause silent bugs. Also: PDG's `processedItems` is the FULL list (Stage 2b) — any new write must be a targeted per-id/per-group patch, never a wholesale replace built from the filtered display groups, or uncategorized singles get wiped (the dbd5d43 bug class).

12. **Do not use `confirm()` or `prompt()` in new code.** They block the event loop mid-auto-save and cannot be styled or tested. Library already uses an inline modal replacement for `prompt()`. Several native `confirm()` calls remain (`App.tsx` clear-batch and ungroup-all, `ImageGrouper` revert/delete, `Library`, PDG) — a known inconsistency, and `src/components/ui/ConfirmAction.tsx` now exists as their replacement. Do not add new native dialog calls.

13. **Do not re-add an "Assign to batch" button for unassigned/orphaned products in Library.** It was built and removed (commits `ae548ae`, `3488a6f`, `1f4ff75`). Assigning `batch_id=null` rows to any batch triggers the gap-fill safety cap in `handleOpenBatch` → those rows are immediately deleted → they reappear as unassigned → the user assigns again → infinite loop. The only safe operation for these rows is deletion.

14. **Do not change the gap-fill cleanup from DELETE to `UPDATE batch_id=null`.** Nullifying stolen batch IDs just puts them back in the Library Unassigned section. They get deleted on the next open anyway. DELETE is the correct and final operation.

15. **Do not delete storage files without going through `filterUnreferencedStoragePaths()` (`src/lib/storageSafety.ts`), and always call it BEFORE deleting the corresponding `product_images` rows.** Duplicated batches share storage files; a naive delete wipes images out from under the surviving batch (this destroyed a real batch — see commit `de9f8a9`). Calling it after the row delete makes every file look unreferenced.

16. **Do not make the founding "move user" re-tag data, and do not widen `org_members` RLS to give founding admins cross-tenant access.** Moving a user must stay membership-only: batches/products/images belong to the WORKSPACE, so re-tagging them by `user_id` would delete a shared batch out from under the team that was collaborating on it, and is not cleanly reversible. And the cross-tenant power must stay behind the `founding_*` SECURITY DEFINER RPCs — loosening the `is_org_admin(org_id)` policy instead would expose every tenant's member list to every org admin, not just founding ones. Also do not remove the `guard_founding_admins()` call from any of the mutators: zero founding admins = user management is permanently locked, fixable only from the SQL Editor.

17. **Do not put the Shopify Admin token (or the Cloudflare token) anywhere in client code or `VITE_*` env vars.** The Shopify token has full store read/write. Both live only as Supabase Edge Function secrets (`SHOPIFY_ADMIN_TOKEN`, `CF_API_TOKEN`), consumed server-side. Every `VITE_*` var is inlined into the public bundle — CI greps `dist/` for credential-shaped strings precisely because this mistake cannot be walked back once deployed.

18. **Do not replace the first-party analytics / CRM / messaging / error tracking with a vendor, and do not add any tracking script, chat SDK, crash-reporting SDK, uptime service, or external API call for them.** The user's rule is "100% self reliant" — these capabilities are features of this app on its own Supabase tables. Extend the tables, RPCs and React components instead. Also keep the four `'unavailable'` / latched-off pre-migration paths intact (each UI hides itself until its SQL has run) and keep every read of these tables behind RLS as written: analytics SELECT and all CRM access are `is_beta_admin()`, threads are owner-or-founding, and `sender_role` must stay RLS-enforced.

19. **Do not re-add the one-shot orphan-storage cleanup effect** (the `sortbot_orphan_cleanup_v3` block, deleted Sept 2026). It ran three `delete().like('storage_path', '%prefix%')` statements with no `user_id`/`org_id` filter — inside the shared Founding Workspace that deleted other members' rows, and under org RLS it could reach another workspace's. It fired automatically on first load per browser. If something like it is ever genuinely needed, it belongs in `scripts/` where a human runs it deliberately, not in an effect.

20. **Do not build a Storage URL inline. Route every one through `lib/storageUrls.ts`** (`publicImageUrl` / `thumbnailImageUrl`). `grep -rn getPublicUrl src/` must keep returning only that file and the test mock. That seam is 23 call sites collapsed into one function body, and it is what makes the private-bucket + signed-URL migration a single edit instead of 23 with three different async-ness assumptions. The invariant it owns: an absent path yields `''` — never a throw, never the string `undefined` inside a URL.

21. **Do not remove the `.eq('updated_at', …)` compare-and-set from `removeItemsFromWorkflowBatch`.** It is the only thing stopping the `workflow_state` lost update (Library READ → App auto-save UPDATE → Library UPDATE silently discarding everything App wrote). It costs one extra column in the SELECT and matches first try on the normal path. The `updated_at` token is only reliable because a BEFORE UPDATE trigger stamps it on every write to that table — if that trigger is ever dropped, this guard becomes a no-op, not a soft failure.

22. **Do not break the `product_images` row-builder invariant.** `buildProductImageRow()` (`lib/imageRowSync.ts`) is shared by `registerItemsInDB`, the upload upsert, and nothing else — `saveBatchToDatabase` deliberately keeps its own inline literal, because it keys on the group leader with a different `alt_text` and an extra `original_name`, and substituting the builder there would change what lands in the DB. And do not skip `mergeProductImageRows` before the delete-then-upsert: that merge is what keeps the wipe from destroying a group's other photos, and its "read failed → skip the wipe entirely" branch is deliberate.

23. **Do not remove pagination from a query that reads rows the user could plausibly have more than 1,000 of.** PostgREST truncates at its max-rows cap **with no error**, so the caller cannot tell a partial read from a complete one — that is how a 1,500-item batch silently lost 500 items' DB fields on every reload, and how `deleteWorkflowBatch` permanently orphaned 500 products' images. Use App's `readAllPages()` or the `.range()` loop in `libraryService`, and keep the "incomplete read → do NOT delete storage" flags (`productIdsComplete` / `imageLookupComplete`) — a leak is recoverable, a wrong delete is not.

24. **Do not pass an inline arrow, inline array, or inline object as a prop to `ImageGrouper`, `CategoryZones`, `ProductDescriptionGenerator`, `GoogleSheetExporter`, `Library` or `SupportWidget`.** All six are `React.memo`'d; a fresh reference undoes the memo silently, with no test to catch it. Use `useEventCallback` for handlers and name the array (`step2Items`, `step4ExportItems`). Equally: do not "simplify" `useEventCallback` into `useCallback([deps])` — a wrong dep list freezes state silently, which is the exact bug class §14 #14 exists for.

25. **Do not add an origin to the CSP without updating the `<meta http-equiv>` in `index.html` — and do not add one you have not proved.** A blocked subresource fails with **no visible error**; uploads simply stop working. Every origin in that policy was verified by grepping `src/` + `public/` and by reading the built bundle, and the rationale comment above it says why each one is there. Keep them in sync, keep `script-src 'self'` (no CDN, no `'unsafe-eval'`), and remember `frame-ancestors` is ignored in a `<meta>` — clickjacking protection needs a real response header, i.e. a host that can send one. If you add a `deploy/` environment, its `nginx.conf` CSP needs the same change.

26. **Do not put a `src/components/ui/` primitive inside `.app-header` or `.ld-nav` without explicit light overrides, and do not restate a primitive's colours in a screen's stylesheet.** The nav is the one deliberately inverted surface (§1), so a primitive dropped there draws black-on-black. And a `.some-screen .ui-btn { background: … }` override reintroduces exactly the four-conflicting-`.button`-definitions drift the system replaces — if a variant is missing, add the variant. Any new primitive must also keep the token rule: no hex literals in `src/components/ui/`.

27. **Do not call `subscribeToSupport`, start a poll, or hold a thread list inside a support UI component.** `src/lib/supportStore.ts` owns all three and reference-counts them, so the floating widget, the Messages page and the header badge share ONE Realtime channel and ONE 45 s timer. A second subscription means two thread lists that drift apart the moment one of them writes, and it makes the optimistic-write reconciliation unobservable. New messaging surfaces consume `useSupportThreads(role)` and write through `supportActions`. Two things in that store look like bugs and are not: `available === false` does **not** stop the poll (a transient network failure is reported identically to a missing table, and stopping would hide messaging until a full page reload), and `refresh()` collapses concurrent callers into one in-flight promise. Keep `applySentMessage` a faithful mirror of the `support_after_message` trigger in `support_messaging.sql` — if that trigger changes, change this with it, or the list settles to something the server will contradict on the next refetch.

28. **Do not materialize recurring finance entries as rows, and do not let the two recurrence implementations drift.** A `finance_transactions` row with a `recurrence` is a TEMPLATE that stands for itself and every repeat until `recurrence_ends_on`; occurrences are expanded at READ time, identically, in `finance.sql` and in `financeService.expandOccurrences`. Writing the repeats would mean a monthly cron to forget, and editing a $20/mo bill to $25 would then fix the forecast but not the history. Steps are ANCHORED to `occurred_on` (Jan 31 monthly → Feb 28, **Mar 31**, Apr 30 — never drifting to the 28th for good); both sides are asserted against the same worked example, so changing one without the other silently makes the chart, the CSVs and the printed statement disagree. Related: `totals.transaction_count` counts occurrences, not rows — do not "fix" it to count rows. And keep the founding-shop test as `plan = 'beta' OR created_at <= founding_cutoff`; narrowing it to the plan alone revokes the landing page's for-life promise the moment a founding shop upgrades.

29. **Do not introduce a second bottom-anchored offset. Everything that clears the phone tab bar reads `var(--tabbar-h)`.** It is defined once in `index.css` (`0px`, raised at `<= 640px` on `.app-container` to `calc(var(--tabbar-row) + var(--safe-b))`, so it already carries the home-indicator inset and is inert above 640px). `.app-main`, `.tool-view`, the toast stack, the support FAB, Step 2's category dock, Step 3's nav dock and Finance's sticky Save bar all subtract that one number — a parallel token (an `--app-tabbar-h` spelling existed briefly and was consolidated away) or a hand-measured `bottom: 57px` guarantees that two surfaces disagree the first time the bar's height changes. Do not use a negative margin to bleed a bottom-anchored surface to the screen edge either: it needs a number sized to ancestor padding the file does not own, and a wrong guess is a horizontal page scroll.

30. **Do not write a token glob, a slash, and another token glob inside a CSS comment** — `--ink-*` followed immediately by `/--text-*` contains `*/`, which closes the comment early and silently eats the next rule. It swallowed the whole `.nav-rail` block in `MobileNav.css` and the rail then rendered at every width; the build does not warn about the missing rule, and it is invisible in the source. Spell token names out in full in prose. (The related build-level symptom is an `Unexpected bad string token` / `Unterminated string token` warning from esbuild — if you ever see one, look for this.)

31. **Do not lower the 44px touch floor, and do not convert it to rem.** `--tap: 44px` and the `min-height: 44px` declarations across the phone blocks are literal `px` on purpose: every other length in this app is a rem against the 9px root (§16), and a rem touch target would silently drift off the accessibility floor the next time the root is retuned. The same goes for the 16px (`var(--fs-md)`) control minimum — mobile Safari zooms a focused control under 16px and never zooms back. A component that genuinely needs to opt out overrides at its own specificity and says why; the global rules in `index.css` stay.
