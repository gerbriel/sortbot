# Sortbot — Deep Analysis & Scaling Roadmap

*Written July 2026 against commit `28e9d9b`. Companion to [CLAUDE.md](CLAUDE.md) (codebase reference). Goal state: a multi-organization SaaS where each org has its own private workspace, team, categories/presets, and Shopify store connection — marketed to vintage resellers, starting in California.*

---

## 1. Where the Product Stands Today

Sortbot is a **single-workspace power tool** built around one team's real daily workflow. It takes a pile of clothing photos and turns them into Shopify-importable listings in four steps (upload → group → describe → export). It is fast, deeply tuned, and battle-hardened for that one workspace — but every architectural decision (shared RLS, one storage bucket layout, one Shopify secret, no roles) assumes exactly one team. That assumption is the main thing standing between today's app and the multi-org goal.

---

## 2. Strengths (what to protect while scaling)

### 2.1 The workflow itself is the moat
The Step 1–4 pipeline mirrors how resellers physically work: shoot a rack in the morning, group the angles, dictate while looking at the garment, export before lunch. Features like **pick mode** (auto-select the next N ungrouped photos), **auto-group by N**, **EXIF shot-time ordering**, and **copy/paste crop across hundreds of images** only come from living the workflow. Competing tools (Vendoo, Crosslist, List Perfectly) start *after* the listing exists — they crosspost. Sortbot owns the harder, earlier step: **camera roll → first draft listing**. That positioning is genuinely differentiated.

### 2.2 Voice-first data entry
Continuous dictation with field commands (`"brand Nike period"`, `"width 18 period"`, `"type crewneck period"`) means a seller never puts the garment down to type. Measurements — the #1 trust factor in vintage sales — become nearly free to capture. No mainstream listing tool does this well.

### 2.3 Domain knowledge as data
`vintagePatternEngine.ts` + 4 expansions (5,000+ brand/team cultural entries), 57-color `COLOR_DNA` with aliases and era associations, construction/fit/condition databases, a 160+ brand/model taxonomy. This is accumulated domain data competitors can't fork from a framework. It also makes the "AI" output *sound like a vintage seller*, not a generic LLM.

### 2.4 Built for real-world (bad) conditions
TUS resumable uploads (6 MB chunks that survive dropped connections), canvas compression before upload (89% storage reduction, confirmed across 4,854 images), a Service Worker CDN cache, image-load retry with QUIC workarounds. The app was hardened against rural-connection reality — most SaaS never is.

### 2.5 Export quality is Shopify-serious
63-column CSV matching Shopify's import format, full taxonomy path mapping, group-wide field coalescing, a hard $0-price export block, and title/handle dedup against the export itself, the app's DB, **and the live store catalog** (via the `shopify-titles` Edge Function). The last one — reading the merchant's live catalog to prevent collisions — is the seed of the real Shopify integration.

### 2.6 Cheap to run, fast to iterate
Static SPA + Supabase. No servers to babysit; the entire infra bill today is roughly one Supabase project. Every dollar of early revenue is margin.

### 2.7 The failure history is documented
CLAUDE.md §15 is an unusually honest record of every race condition, RLS trap, and stale-closure bug found and fixed. For scaling, this is an asset: the sharp edges are *known and written down*, which is far better than unknown.

---

## 3. Weaknesses (ranked by how hard they block the multi-org goal)

### 3.1 🔴 There is no tenancy boundary anywhere — the #1 blocker
> **Update (July 2026): Phase 1 is code-complete.** `supabase/migrations/multi_org_tenancy.sql` + `orgService.ts` + `OrgPanel.tsx` implement org tables, org-scoped RLS, an additive backfill into a Founding Workspace, invites, and personal workspaces for new signups. The DB half activates when the migration is run in the SQL Editor (after a backup). Remaining from this section afterwards: private storage bucket (Phase 1b) and per-org Shopify secrets (Phase 2).
- **Database:** `shared_workspace_rls.sql` + `collaborative_edit_policies.sql` mean every authenticated user can SELECT **and now INSERT/UPDATE** every row in `workflow_batches`, `products`, `product_images`. There is no `organizations` table, no roles, no membership concept.
- **Auth:** open email/password signup against a public anon key. Anyone who finds the URL can create an account and immediately see and edit all existing inventory data. For a single trusted team this was a deliberate convenience; for a commercial product it is an outright data breach waiting for the second customer.
- **Storage:** one public bucket, paths keyed by `userId` (not org), every image world-readable to anyone holding a URL.
- **Shopify:** a single global `SHOPIFY_STORE`/`SHOPIFY_ADMIN_TOKEN` secret pair — one store for the whole deployment.

Nothing about multi-org can ship until this layer exists. Everything else in this document is secondary.

### 3.2 🔴 Zero automated tests, silent error handling, no error boundaries
The June 2026 log shows ~15 consecutive commits to make preset persistence survive a page refresh — each regression discovered manually in production. The core invariants (slim→restore roundtrip, `productGroup` leader rule, export CSV shape, gap-fill cap) are exactly the kind of pure-ish logic that unit tests protect cheaply. Onboarding paying orgs onto an untested data pipeline that already *deletes rows by heuristic* (gap-fill cap, orphan cleanup) is the biggest operational risk in this codebase.

### 3.3 🟠 God components and duplicated state
`App.tsx` (~2,900 lines), `ImageGrouper.tsx` (~3,100), `ProductDescriptionGenerator.tsx` (~3,100), `Library.tsx` (~3,000). All global state lives in App.tsx and flows by prop drilling; PDG keeps its own copy of `processedItems` synced by a suppression flag (`isResettingRef`); every async handler must remember the ref-mirror pattern or reintroduce stale-closure bugs. This didn't stop a solo builder, but it makes every new contributor (human or AI) dangerous, and multi-org will touch *all* of these files.

### 3.4 🟠 `workflow_state` JSONB as quasi-source-of-truth, defended by heuristics
The real listing data lives in a JSONB blob, reconciled against relational tables via gap-fill windows (±24 h), safety caps (`items × 2`), and background deletions of "stolen" rows. It works for one workspace because one person understands it. With N orgs, a heuristic that silently deletes rows is a support-ticket generator. Long-term: promote the relational tables to source of truth and demote `workflow_state` to a UI-session cache.

### 3.5 🟠 The "AI" is mostly rules, and the real AI paths are dead
`textAIService.ts` is a (very good) template/keyword engine. The OpenAI path (`services/api.ts`) is dead code, vision analysis requires a localhost proxy that can't run in production, and `AISettings` is unused. Two consequences: (a) marketing "AI-powered listings" is overselling until a real model is wired in; (b) the biggest product upgrade available — vision auto-fill of brand/color/condition from the photos themselves — is unbuilt.

### 3.6 🟡 Chrome/Edge-only voice
Web Speech API doesn't work in Firefox and only partially in Safari. Safari matters: many resellers work from an iPad at the rack. A server-side transcription fallback (Whisper-class API) removes the single biggest browser restriction.

### 3.7 🟡 Ops immaturity
- Deployed to GitHub Pages under `/sortbot/` — no custom domain, no staging environment, no rollback story.
- Migrations are ad-hoc SQL files run by hand in the dashboard, not tracked by the Supabase CLI; some live at repo root (`ADD_APPLIED_PRESET_ID.sql`, `fix_security_warnings.sql`).
- No error monitoring (Sentry), no product analytics, no uptime checks.
- Repo hygiene: ~100 raw `console.log` calls regressed into production code; a 9 px base font bakes one user's zoom preference into the design system. (`consolelog.md`, a 238 KB committed console dump, was removed July 2026.)

### 3.8 🟡 Free-tier ceilings already hit
Storage was at 310% of the 1 GB free tier before compression; the public bucket can't use image transforms (Pro-only), so every thumbnail is a full-size download mitigated by client tricks. Commercialization requires Supabase Pro on day one (~$25/mo) — trivial cost, but it should be planned, and it unlocks real thumbnails.

---

## 4. Roadmap: From Power Tool to Multi-Org SaaS

Ordered so that each phase de-risks the next. Rough sizing assumes current solo + AI-assisted pace.

### Phase 0 — Stabilize the foundation *(before any external user)*
1. **Test harness:** ✅ **74 tests as of July 2026** — Vitest characterization tests over the voice/size/title engine (incl. golden description snapshot), preset priority hierarchy, delete tombstones, the `slim()` save→reload contract, the Shopify CSV builder (golden two-product CSV + header/handle/taxonomy rules), the workflowStore, and the Library `loadAll` derivation (dedup/gap-fill/synthesis rules). Caught two real title-corruption bugs on day one. Still open: grouping invariants (inside ImageGrouper), Playwright smoke run.
2. **Observability:** Sentry (or GlitchTip) + a React error boundary around each step; route stray `console.log`s through `debugLogger`.
3. **Repo/ops hygiene:** move root SQL into `supabase/migrations/`; adopt `supabase db push`/CLI migration tracking; add a staging Supabase project. (`consolelog.md` already removed.)
4. **Hosting:** move to Vercel/Netlify/Cloudflare Pages with a custom domain. Kills the `/sortbot/` base-path complexity and unlocks preview deploys.

### Phase 1 — Tenancy (the structural rewrite) — ✅ code-complete July 2026 (run `multi_org_tenancy.sql` to activate; storage privatization below is Phase 1b, still open)
1. **Schema:**
   ```sql
   organizations (id, name, slug, plan, created_at)
   org_members   (org_id, user_id, role check in ('owner','admin','member'), invited_by, created_at)
   org_invites   (org_id, email, role, token, expires_at)
   ```
   Add `org_id` (NOT NULL, FK) to `workflow_batches`, `products`, `product_images`, `categories`, `category_presets`, `export_batches`. Backfill everything current into a "founding org."
2. **RLS rewrite:** replace shared-workspace policies with org-membership policies — `org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid())` for SELECT/INSERT/UPDATE (use a `SECURITY DEFINER` helper function so the subquery is planned once); DELETE gated to `owner`/`admin` roles. **This preserves the collaborative feel** — the whole point of the current shared workspace survives, just scoped to the org. CLAUDE.md §18 items 1–2 get retired.
3. **Storage:** new path convention `{orgId}/{productId}/…`; flip bucket to **private** with signed URLs (or per-org-prefix policies). Every URL-reconstruction seam already funnels through `storagePath` → `getPublicUrl()`, so this is one function swap (`createSignedUrl`) plus cache handling — the discipline around `storagePath` finally pays off.
4. **App layer:** an `OrgContext` (first justified use of React Context here), an org switcher in the header, invite/accept flow, member management page. Categories and presets become org-scoped, which they already almost are.
5. **Migration for existing data:** founding org gets all current batches; the three existing user folders in storage map into it.

### Phase 2 — Shopify per-org, direct publish
1. **Per-org store connection:** `org_integrations (org_id, provider, shop_domain, access_token_encrypted, scopes, status)`. Start with each org creating a **custom app token** in their own Shopify admin (works today, no app review); design the table so a proper **OAuth public app** slots in later.
2. **Edge Functions:** parameterize `shopify-titles` by org; add `shopify-publish` using the Admin GraphQL `productSet` mutation + staged media uploads, so "Finish" pushes draft products directly instead of (or alongside) the CSV. Keep CSV export forever as the escape hatch and the path to eBay/Depop/Squarespace later.
3. **Shopify App Store listing (later but strategic):** once the OAuth app exists, the App Store is the single highest-quality acquisition channel for exactly this customer. Requires app review, a privacy policy, GDPR webhooks — plan it, don't rush it.

### Phase 3 — Productize
1. **Billing:** Stripe subscriptions keyed to `organizations.plan`; RLS/feature-gating reads the plan. Pricing that matches how resellers think: per-listing volume tiers with unlimited seats (e.g., Free trial: 1 batch/50 images → Solo ~$29/mo → Team ~$79/mo → Volume ~$149+). Teams-with-one-login is common in this niche; don't fight it with per-seat pricing early.
2. **Onboarding:** org-creation wizard, seeded default categories/presets, a sample batch, empty states. Genericize the personal-tool idiosyncrasies: 9 px font → normal type scale with a density toggle; hide the debug button and bucket-wide compression tools behind an admin flag.
3. **Supabase Pro** + image transforms for real thumbnails (delete a whole layer of client-side workaround); consider Cloudflare in front of the CDN.
4. **Security posture for customers:** private bucket (done in Phase 1), leaked-password protection on, rate limiting, signup email verification, a written privacy policy + ToS + DPA template.

### Phase 4 — The AI upgrade (post-revenue differentiator)
1. **Vision auto-fill:** send each group's photos to a vision model (e.g. Claude via one Edge Function) to pre-fill brand, garment type, colors, era guess, condition notes, and flaw detection — voice becomes the *correction* layer instead of the entry layer. Pennies per listing; gate by plan. This turns "45 seconds per listing" into "10 seconds per listing" and is the demo that sells the product.
2. **Transcription fallback:** server-side Whisper-class STT for Safari/Firefox/iPad, removing the Chrome-only constraint.
3. **Pricing intelligence (later):** comp suggestions from sold listings would be the third leg, but it needs data partnerships — park it.

---

## 4b. Remediation Plans (detail for §3.3–§3.5)

### God components + duplicated state — strangler-fig, never a rewrite
1. **Safety net first** (Phase 0 tests) — refactoring 12,000 lines without tests is gambling.
2. **One source of truth for items** — ✅ **done July 2026 (dependency-free)**: hand-rolled `workflowStore` on `useSyncExternalStore`; Stage 2a moved App's four arrays behind `useState`-compatible adapters and replaced the ref mirrors with live views; Stage 2b retired PDG's duplicate `processedItems` copy, `isResettingRef`, the structureKey sync effect, and App's filtered-subset merge. The stale-closure bug class is dead by construction.
3. **Extract along existing seams, one PR each, zero behavior change:**
   - App.tsx → `batchLifecycle.ts` (handleOpenBatch + startup restore + registerItemsInDB), `useAutoSave`, toast system → App becomes layout + wiring (~600 lines)
   - PDG → `useSpeechRecognition`, `useCropTool`, `Lightbox`, group-nav hook
   - ImageGrouper → `useRubberBand`, `usePickMode`, `useGrouperShortcuts`, `GrouperSidebar.tsx`, `GroupCard.tsx`
   - Library → **`libraryData.ts` first** (the two-pass loadAll merge as a pure, unit-testable function — highest value), then per-tab components
4. **Demote the JSONB scribbled note** (after step 2, ~2–3 weeks incl. soak):
   a. Additive migration: columns for everything only `slim()` preserves today — `captured_at`, `image_rotation`, `crop` jsonb, `original_storage_path`, `description_edited` on products/product_images.
   b. Dual-write phase: existing product writes extended to the new columns; workflow_state keeps saving as today.
   c. Flip restore priority: build items from products+product_images first, workflow_state as legacy fallback (today it's the reverse). Old batches stay readable forever via the fallback.
   d. Stop writing the blob; `workflow_batches` becomes metadata only. The gap-fill cap, ±24h orphan window, and stolen-row deletion — the scariest heuristics in the app — all become dead code, because there's no second copy left to reconcile.

### Vision AI — a model with eyes, feeding the existing template engine
- **Architecture:** one Edge Function `vision-analyze` (same server-side-key pattern as `shopify-titles`). Client sends a group's image URLs; the function calls Claude (Sonnet default, Haiku for cost) with a structured-output prompt returning strict JSON: brand, garment type, colors, era, material guess, condition notes, flaws[], printed text, per-field confidence.
- **The knowledge bases become the grader, not casualties:** the prompt embeds the allowed vocabularies (57 COLOR_DNA names, category list, letter sizes) so vision output snaps to values the template/preset pipeline already understands. Vision fills fields → existing `generateProductDescription` runs unchanged → voice stays as the correction layer. Vision replaces typing, not the Mad Libs engine.
- **UX:** "🔮 Analyze photos" per listing + "Analyze all" batch run (chunked with progress, like the compress tools). Results appear as visibly-AI suggestions; never overwrite a non-empty user field (same rule presets follow).
- **Cost:** send the already-compressed 2000 px images (ideal input size); ≈ $0.01–0.04 per listing depending on model — ~$10/week at 300 listings. Gate by plan later.
- **Free eval set:** thousands of existing hand-labeled `products` rows are ground truth — measure field-level accuracy against them while iterating the prompt, before any user sees it.
- **Order:** buildable independently of tenancy; ship behind a flag after the tenancy migration is run (per-org gating wants orgs). Rate-limit per user inside the function; `verify_jwt` stays on.

## 5. California Go-to-Market Notes

**Who to sell to first.** LA is the densest vintage-reseller market in the country: Melrose/Fairfax storefronts, Rose Bowl Flea and Long Beach Antique Market vendors, the bins-reseller scene, plus SF/Oakland and San Diego. The ideal early profile: a Shopify-storefront vintage shop (often also doing markets via Shopify POS) listing **50–500 items/week** with listing labor as the acknowledged bottleneck. That profile matches Sortbot's exact strengths and the Phase 2 Shopify integration.

**The pitch.** "Photograph the rack in the morning; listings are live by lunch." Lead with measured time-per-listing (voice + presets + vision autofill), not features. Demo with a real rack of 40 items.

**Positioning vs. incumbents.** Vendoo / List Perfectly / Crosslist start from an existing listing and crosspost it. Sortbot starts from the camera roll and *creates* the listing. Early on, position as the step **before** those tools (their users are your users), not a replacement — and keep the CSV so nobody has to switch anything else.

**Distribution.**
1. Hand-onboard 3–5 LA shops personally (founding-org pricing, weekly feedback loop). Their catalogs also stress-test tenancy.
2. Reseller YouTube/TikTok is a huge, cheap channel in this niche — sponsor "list with me" creators; the workflow is inherently demo-able.
3. Shopify App Store once the OAuth app ships (Phase 2.3) — the compounding channel.
4. Vintage wholesale/bins suppliers as referral partners (their buyers all share the same bottleneck).

**Legal/compliance (not legal advice — confirm with a CA attorney before charging money).**
- **Privacy:** CCPA/CPRA thresholds ($25M revenue / 100k+ consumers) won't apply immediately, but customers will ask for a privacy policy, ToS, and a data-deletion story regardless — the delete paths already exist; write them down.
- **Sales tax:** California generally does **not** tax remotely-accessed SaaS (no tangible personal property transferred) — favorable home-state economics; register with CDTFA only if selling anything taxable.
- **Business basics:** LLC/inc., business license in the operating city, and — if the vision features later touch biometric-adjacent data — a fresh privacy review.

---

## 6. Top 10 Next Actions (in order)

| # | Action | Phase | Why first |
|---|--------|-------|-----------|
| 1 | Vitest + golden-file test for CSV export and `slim()`/restore | 0 | Protects the money path before touching anything |
| 2 | Sentry + error boundaries; clean up `console.log` / `consolelog.md` | 0 | Can't support customers blind |
| 3 | Move hosting off GitHub Pages to custom domain + staging | 0 | Prereq for auth callbacks, OAuth, branding |
| 4 | Supabase CLI migration tracking; consolidate root SQL | 0/1 | The RLS rewrite must be reproducible |
| 5 | `organizations`/`org_members` schema + org-scoped RLS + backfill | 1 | The blocker for everything commercial |
| 6 | Private storage bucket + signed URLs, org-keyed paths | 1 | Second half of the tenancy boundary |
| 7 | Org switcher, invites, roles in the UI | 1 | Makes tenancy sellable |
| 8 | Per-org Shopify connection + `shopify-publish` Edge Function | 2 | Converts "CSV exporter" into "lists to your store" |
| 9 | Stripe billing tied to org plan + onboarding flow | 3 | Revenue switch |
| 10 | Vision auto-fill Edge Function (Claude) + Safari STT fallback | 4 | The demo that closes California shops |

---

## 7. What NOT to change while scaling

- The four-step workflow order and its keyboard/voice ergonomics — this is the product.
- The `storagePath`-as-only-truth invariant and its single reconstruction seam — it is what makes the private-bucket migration cheap.
- The collaborative editing *experience* (now org-scoped) — teams sharing one workspace is a feature, not a bug.
- The brand/color/construction knowledge bases — keep growing them; they compound.
- CSV export as a permanent escape hatch, even after direct publish ships.
