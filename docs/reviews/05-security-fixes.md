# 05 — Security Fixes (implementation log)

Implements `docs/reviews/05-security.md`. **No SQL was executed against any database** — every
schema change is a file in `supabase/migrations/` for the owner to run, in the order given in
§3 below. Nothing is committed.

Gates at the end of this pass:

| Gate | Before | After |
|---|---|---|
| `npm test` | 305 tests / 24 files | **357 tests / 29 files, all passing** (12 are mine; the rest are a concurrent agent's) |
| `npm run build` (`tsc -b && vite build`) | — | **clean** |
| `npx eslint .` | 311 problems | **302 problems** (−9; one is mine — the `_moErr` unused catch binding in `shopify-titles`) |
| `npx eslint <files I touched>` | — | 1 finding: `src/components/Auth.tsx:66` `catch (error: any)`, **pre-existing** (was line 53 before my +13 lines), not on a line I wrote |

`deno` is not installed on this machine, so the two Edge Functions were type-reasoned rather than
`deno check`ed — see the note at the end of §1.

---

## 1. Per-finding status

| # | Finding | Status | What was done |
|---|---|---|---|
| **1** | Shopify Admin catalog dumped to any anon-key caller — global-token fallback fires whenever the org lookup finds nothing | **Fixed** | `supabase/functions/shopify-titles/index.ts` rewritten. The caller is now resolved to a real user via `/auth/v1/user` (the bare anon key is a validly signed project JWT, so `verify_jwt` alone never stopped it) → no user = **401**. The global `SHOPIFY_STORE`/`SHOPIFY_ADMIN_TOKEN` secrets are reachable **only** when the org lookup *succeeded* and `organizations.slug = 'founding'`. A failed lookup, an absent membership, or a membership in any other org all return the clean empty result (`{titles:[],handles:[],count:0,source:"none"}`, 200) — the `lookupWorked`/"legacy mode" escape hatch is gone, as the tenancy migration is live. |
| **9** | SSRF + path smuggling via `store_domain`; upstream bodies echoed | **Fixed** | `resolveShopHost()` now strips scheme, path, query, port and trailing dot, removes a trailing `.myshopify.com`, and requires the remainder to match `^[a-z0-9][a-z0-9-]{0,62}$` (a single DNS label — no dots, no `@`, no whitespace). `evil.com/.myshopify.com`, `evil.com.myshopify.com` and `user:pass@evil.com` all return `null` → **400 "Invalid store domain — reconnect the store."** The global secret is validated the same way. |
| **19** | Both functions echo upstream error bodies and raw exception strings | **Fixed** | Both functions now `console.error` the status + a truncated body server-side and return a generic message: `"Shopify request failed."` (502) / `"Fetch failed."` (500) / `"Model unavailable."` (502). GraphQL error arrays are no longer returned either. |
| **3** | `generate-prose` is an unmetered LLM proxy on the founder's Cloudflare account | **Fixed** | `supabase/functions/generate-prose/index.ts`: caller resolved via the JWT (**401** without a user); the caller must belong to an org whose `description_settings->>'proseEnabled'` is true, read with the service role (**403** otherwise) — the per-workspace opt-in is now enforced server-side, not only in `proseService.ts`; prompt bounded to **25** fields, 40-char keys, 200-char values, a **4 000-char** total facts budget and a 300-char style note, with a 64 KB body refused outright (**413**); the untrusted region is fenced (`<<<FACTS … FACTS`, `<<<STYLE … STYLE`) and the system prompt now states the blocks are data. |
| **2** | Invited member can self-promote to workspace **owner** | **Migration written (not run)** | `supabase/migrations/security_invites_hardening.sql`. Three independent layers: (a) `revoke update on org_invites` + `grant update (accepted_at)` — `role`/`org_id`/`email` become unwritable from any client (verified: `orgService.ts:112` only ever writes `accepted_at`; OrgPanel otherwise inserts and deletes); (b) `org_members_insert` clause (2) now requires `role in ('admin','member')`, so an invite can never mint an owner (the invite UI only offers member/admin — `OrgPanel.tsx:566-568`); (c) a unique index on `(org_id, lower(email))`, created inside a guarded `do` block so pre-existing duplicates raise a `notice` instead of aborting the migration. |
| **5** | Every email-matching policy trusts the **unverified** JWT email claim | **Migration written (not run)** | `supabase/migrations/security_verified_email.sql`. Adds `public.auth_email_verified()` (SECURITY DEFINER, `auth.users.email_confirmed_at is not null` for `auth.uid()`) and adds it as an **additional** condition to all seven email-matching sites, each keeping its original semantics: `invited_role()`, `org_invites_select`, `org_invites_update`, `beta_select`, `support_threads_insert`, `crm_notes_insert`, `kanban_insert_kanban_cards`, `kanban_insert_kanban_comments`. Admin branches (`is_org_admin` / `is_beta_admin`) are untouched. Each optional table is guarded with `to_regclass`, so the file runs cleanly whichever migrations are live. **Read the PRECONDITION block in the header before running.** |
| **6** | Anonymous `analytics_events` INSERT: no payload cap, no rate limit, arbitrary event names | **Migration written (not run)** | `supabase/migrations/security_abuse_limits.sql` §1: `analytics_events_props_size_chk` (`pg_column_size(props) <= 2048`), `analytics_events_event_pattern_chk` (`^[A-Za-z0-9][A-Za-z0-9 ._-]{0,59}$` — passes all five event names the app emits), and an `analytics_rate_limit()` BEFORE INSERT trigger at **120 rows per `session_id` per 10 minutes** (a full funnel is ~6 events). |
| **16** | Anonymous `beta_signups` INSERT with no length checks | **Migration written (not run)** | Same file §2: `beta_signups_len_chk` (org_name/contact_name ≤ 120, email 6–254, store_url ≤ 200, volume ≤ 60, notes ≤ 2 000) and `beta_signups_email_chk` (`^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$`) — the second is also the **server half of #7**: no `?`, `&`, `<`, `>`, `,`, `;` or whitespace can reach the founder panel. |
| **10** | Support messaging has no quotas; thread owner can write `founder_last_read_at` and forge `org_id`/`org_name` | **Migration written (not run)** | Same file §3. `support_thread_before_insert()`: **max 20 open threads per user** (founders exempt) and `org_id`/`org_name` **derived** from the caller's real membership rather than accepted from the client — deriving instead of rejecting means forging is impossible and no valid request ever fails. `support_thread_before_update()`: non-founders get `founder_last_read_at` reset to OLD (a grant cannot be role-conditional, which is why this is a trigger), non-owners get `user_last_read_at` reset, and `user_id`/`user_email`/`org_id`/`org_name` are pinned to OLD as belt-and-braces over the column grant. `support_message_rate_limit()`: **30 messages per user per 10 minutes**, founders exempt; the `raise exception` message surfaces in the widget via `createThread`/`sendMessage`'s `error.message`. |
| **4** | Public bucket; no `storage.objects` write policy in the repo | **Migration written (not run) — and it is deliberately INERT until one manual step** | `supabase/migrations/security_storage_policies.sql`. **Scope is the caller's ORG, not the caller alone**, and the header explains why at length: object paths are `{userId}/{productId}/{file}` (`ImageUpload.tsx:447`, `productService.ts:106`), and three shipped flows write under a *teammate's* prefix — the Step 3 crop re-upload derives its directory from the existing item's `storagePath` (`ImageGrouper.tsx:449-455`, and PDG's paste-crop upserts the same path at `ProductDescriptionGenerator.tsx:2118`), "Compress N/All Batches" upserts over every path in the workspace (`ImageUpload.tsx:568`), and deleting a teammate's batch removes their files (`workflowBatchService.ts:289`, `libraryService.ts:185`, `Library.tsx:1397`). So `public.storage_prefix_writable(prefix)` allows the caller's own uid **or** any uid sharing an org with them — exactly the app's existing trust boundary, and it closes the **cross-tenant** hole, which is the actual finding. A strict `= auth.uid()::text` check (as drafted in the audit) would have broken all three. SELECT stays public — documented in the header, with the private-bucket/signed-URL project noted as separate. **The one manual step:** this repo contains no `storage.objects` policy yet uploads work, so a permissive policy exists in the dashboard under an unknown name; RLS policies are OR'ed, so the new scoped ones change nothing until that one is dropped. Section 0 has the inventory query, section 4 the drops. |
| **7** | `mailto:` header injection into the founder's mail client | **Fixed** | New `src/lib/mailto.ts` — `isSafeEmail()` + `safeMailto(addr, subject?, body?)`. Validates against a strict regex whose character class excludes `?`, `&`, `#`, `%`, `,`, `;`, `<`, `>`, quotes, backslash and whitespace, then `encodeURIComponent`s the address (restoring only `@`) and always encodes subject/body. Returns `null` for anything unsafe so the caller renders **plain text instead of a link** — never an unvalidated `href`. Wired into all three sites: `OrgPanel.tsx` (the beta-request address link and the "Compose welcome email" button, whose subject/body interpolate `contact_name` and `org_name` from the same anonymous form) and `CrmPanel.tsx` (the contact "email" link — `crm_contacts.email` is synced from `beta_signups`). |
| **14** | CSV formula injection | **Fixed** | `src/lib/csvExport.ts` `escapeCsvValue`: `CSV_FORMULA_START_RE = /^(?:[=+@\t\r]|-(?![0-9]))/` prefixes a single quote — so `=`, `+`, `@`, leading TAB/CR and `-`-followed-by-a-non-digit are defused while `-12.50` stays a negative number. `\r` was also added to the quote-wrapping test, since a bare CR in an unquoted field breaks row parsing. `String(value \|\| '')` was left exactly as it was (`0` → `''`) so no existing cell changes. **The golden CSV snapshot is byte-identical** — no cell in it starts with a formula character. |
| **11** | Realtime `event: '*'` leaks deleted `support_threads` rows | **Fixed** | `src/lib/supportService.ts` `subscribeToSupport` now subscribes to `INSERT` and `UPDATE` on `support_threads` separately instead of `'*'`. With `replica identity full` and no RLS on DELETE payloads, a founder deleting a thread would otherwise have shipped its whole OLD row (`user_email`, `subject`, `last_message_preview`) to every subscriber. Deletions are picked up by the widget's existing polling. |
| **18** | 6-character password minimum | **Fixed** | `src/components/Auth.tsx`: `MIN_PASSWORD_LENGTH = 10`, checked before the `signUp` call with a clear message ("Use at least 10 characters — a short password is the easiest way into your workspace."), plus `minLength` and the helper copy. The `minLength` attribute is applied **only on sign-up** (`isSignUp ? MIN_PASSWORD_LENGTH : undefined`) so existing accounts with shorter passwords can still sign in. **Dashboard settings the owner must enable — code cannot do these:** Authentication → Providers → Email → **"Leaked password protection"**, the server-side **minimum password length**, and **"Confirm email"** (which finding #5's migration depends on — see §4). |
| **12** | No CSP; session tokens in `localStorage` | **Fixed — written into `index.html`** | Every origin was proved before writing it, and the built output was inspected: `dist/index.html` contains **no inline script** (only `/assets/*.js` + a stylesheet link + the existing inline `<style>`), and the dead third-party origins (`apis.google.com` in `services/api.ts`, `api.openai.com`, huggingface, `localhost:3001`) are **absent from the bundle** — both modules are imported by nothing and are tree-shaken. Full directive-by-directive evidence in §2. |
| **21** | Service Worker caches tenant images for 7 days and never purges | **Fixed (client half) — one line deferred** | New `src/lib/swCache.ts` exports `purgeImageCache()`: posts `{type:'PURGE_IMAGE_CACHE'}` to the active Service Worker over a `MessageChannel`, waits up to 2 s for `PURGE_IMAGE_CACHE_DONE`, and falls back to deleting `sortbot-images-v1` from the page itself when no SW controls the page or the SW stays silent. Matching handler added to `public/sw.js` (deletes `CACHE_NAME`, then `pruneOldCaches()`, then replies on the supplied port). **Wiring into sign-out is in `App.tsx` — see §5.** |

### Not implemented (out of the assigned scope, recorded for the next pass)

| # | Why not |
|---|---|
| §3.2 `edge_call_log` + `edge_rate_ok` per-user Edge Function quota | Not in the assigned list — items 1 and 2 asked for the auth gate, domain validation, prompt caps and error hygiene. Worth adding: an opted-in workspace can still loop `generate-prose`. The report's SQL is ready to lift. |
| §3.1 `organizations` column grants (`slug`/`created_by`/`plan` unwritable) and the org-creation rate limit (#24) | Not assigned. `slug='founding'` is the super-admin key that `is_beta_admin()` reads, so this is the highest-value remaining migration. |
| §3.1 `support_mark_read(uuid)` RPC + the matching `supportService.markThreadRead` change | The assignment specified the trigger approach for #10 instead ("since column grants cannot be role-conditional"), which achieves the same guarantee with **no client change**. The RPC would be a cleaner API but is redundant now. |
| #13, #15, #17, #20, #22, #23, #25, #26 | Not assigned. #17 (dev-only `vite`/`rollup`/`postcss` advisories) and #20 (deleting `services/api.ts` / `huggingfaceService.ts` / `AISettings.tsx` / `TestLlamaVision.tsx`, which is what keeps `VITE_*_API_KEY` reads out of the bundle for good) are the cheapest of these. |

### Nothing was skipped as "doesn't hold up"

All 12 assigned items held up on re-reading the source. Two were adjusted on the evidence:

1. **#4's scope.** The audit drafted `(storage.foldername(name))[1] = auth.uid()::text`. Applied as drafted it
   would break crop re-upload, recompress, and teammate-batch delete — see the #4 row. Org-scoped instead,
   with the reasoning and the flows to smoke-test in the migration header. The path segment is compared as
   **text** against `user_id::text`, never cast to `uuid`, so a legacy object whose first segment is not a
   uuid cannot raise inside the policy and take the whole bucket down.
2. **#8** (unscoped `delete().like('storage_path', …)` with no `user_id` filter, `App.tsx:1104-1126`) is
   real in `HEAD`, but `App.tsx` is off-limits to me this pass — and the concurrent agent has **already
   removed that whole one-shot cleanup block** in the working tree (`git show HEAD:src/App.tsx` still has
   `sortbot_orphan_cleanup_v3` and the `.like()` call; the working copy has neither). Verify it stays gone
   at merge; if it comes back, it needs `.eq('user_id', user.id)` or deletion.

### Edge Function type-checking

`deno` is not installed, so I reasoned through the types instead. Both files are `Deno.serve` + `fetch`
only, with no imports. The constructs that need care: JSON bodies are `any`, so the annotated `.map`/
`.filter` callbacks in `proseEnabledForUser` narrow `unknown[]` → `string[]` through an explicit
`(v: unknown): v is string` guard; `clean()` and `resolveShopHost()` take `unknown` so `any` values pass
without an implicit-any error; `Resolution` is a discriminated union of `ShopifyConn | "none" | "unauth" |
"badhost"` checked by string equality before the object branch. `npx eslint` (which does lint
`supabase/functions/**/*.ts` — the config's `files` glob is `**/*.{ts,tsx}`) reports **zero** findings on
both files, and I removed the pre-existing unused `_moErr` catch binding while I was in there.
Run `deno check supabase/functions/*/index.ts` before `supabase functions deploy`.

---

## 2. The CSP, directive by directive, with evidence

Written into `index.html` immediately after `<meta charset>`. Every claim below was verified by grepping
`src/` + `public/` and by reading `dist/assets/*.js` after a build.

| Directive | Value | Evidence |
|---|---|---|
| `default-src` | `'self'` | Backstop for `media-src` / `manifest-src` / `frame-src`. No `<video>`, `<audio>`, `<iframe>`, `<embed>`, `<object>` or web manifest anywhere in `src/`, `public/` or `index.html`. |
| `script-src` | `'self'` | `dist/index.html` has exactly one `<script type="module" crossorigin src="/assets/index-*.js">` and **no inline script**. No CDN script tag anywhere. The only `script.src = 'https://apis.google.com/js/api.js'` is `src/services/api.ts:384`, and `grep -rn "services/api"` over `src/` returns **nothing** — it is imported by no module and is absent from the bundle (`grep apis.google.com dist/assets/*.js` → 0 hits, same for `api.openai.com`, `huggingface`, `localhost:3001`). **No `'unsafe-eval'`:** the bundle's single `new Function(` is the `setimmediate` polyfill (pulled in by `jszip`) taking its non-function-argument branch, `x.setImmediate = function(M){ typeof M != "function" && (M = new Function(""+M)) … }` — jszip only ever passes a function, so it is unreachable. |
| `style-src` | `'self' 'unsafe-inline'` | Required twice over: the `<style>` block in `index.html:12` that paints the canvas before the bundle loads, and the app's pervasive React `style={{…}}` attributes (`'unsafe-inline'` in `style-src` covers `style-src-attr` too). Vite's dev server also injects `<style>` elements at runtime. |
| `img-src` | `'self' data: blob: https://*.supabase.co https://images.unsplash.com` | `https://*.supabase.co` — every product photo (`/storage/v1/object/public/product-images/…`; `VITE_SUPABASE_URL` is `https://<ref>.supabase.co`, wildcarded so the policy is env-agnostic). `https://images.unsplash.com` — the four `PHOTO` entries in `Landing.tsx:25-33`. `data:` — the SVG select arrow in `ComprehensiveProductForm.css:175`. `blob:` — `URL.createObjectURL(file)` upload previews (`ImageUpload.tsx:117`). |
| `font-src` | `'self' data:` | `grep -rn "@font-face\|@import\|fonts.googleapis\|fonts.gstatic"` over `src/`, `public/` and `index.html` returns **nothing** — every `font-family` is a system stack (`-apple-system`, `BlinkMacSystemFont`, `ui-monospace`, `'Courier New'`, …). Nothing is fetched; `data:` is belt-and-braces. |
| `connect-src` | `'self' https://*.supabase.co wss://*.supabase.co` | The Supabase client (REST/auth/storage/`functions.invoke`), the TUS endpoint (`tusUpload.ts:67`), and the three raw `fetch(url)` calls that re-download storage images for EXIF rescan / recompress (`App.tsx:1079`, `App.tsx:2566`, `ImageUpload.tsx:536`) — all `https://<ref>.supabase.co`. `wss://` for Realtime presence. `'self'` also covers the dev server's `ws://localhost:5173` HMR socket (CSP3 `'self'` matches same-origin `ws`/`wss`). |
| `worker-src` | `'self'` | `public/sw.js`, registered from `import.meta.env.BASE_URL` (`main.tsx:13`) — same origin at both `/` and `/sortbot/`. Stated explicitly rather than relying on the `child-src` → `script-src` fallback. |
| `object-src` | `'none'` | No plugin content. |
| `base-uri` | `'none'` | No `<base>` element; prevents a future injection from re-pointing every relative URL. |
| `form-action` | `'self'` | The Landing beta form and the Auth form both `preventDefault()` and submit via JS, so no form navigation happens — but `'self'` rather than `'none'` so that a future real form post is not silently broken. |

Also added: `<meta name="referrer" content="strict-origin-when-cross-origin">` — already the Chrome/Firefox
default, made explicit so the Unsplash requests never carry a full app URL.

**Two directives deliberately omitted** (both documented in the file):

- **`frame-ancestors`** — per spec it *must be ignored* in a `<meta>` element, so including it would only
  log a console warning. Clickjacking protection needs a real response header, i.e. moving the origin off
  GitHub Pages (Cloudflare Pages / Netlify serve the same `dist/`), which also unlocks `report-to` and HSTS.
- **`upgrade-insecure-requests`** — it would rewrite the dev server's `ws://localhost:5173` HMR socket to
  `wss://` and break `npm run dev`. It buys nothing here: the app contains no `http://` subresource.

**Dev-mode interaction, verified empirically.** `curl http://localhost:5173/` shows Vite injecting the
`@vitejs/plugin-react` refresh preamble as an **inline** `<script type="module">` at line 4 and
`/@vite/client` at line 9 — both *above* the CSP meta at line 54. A `<meta>` CSP only governs what is
fetched after it is parsed, so the preamble executes before the policy applies and `npm run dev` keeps
working. This does depend on Vite's injection order; if a future Vite version moves the preamble below the
meta, the fix is a `transformIndexHtml` plugin that injects the meta only when `command === 'build'`.

**Smoke-test after deploy** (browser console must show no CSP violation): landing page photos render ·
sign in · upload a folder · Step 2 thumbnails · Step 3 crop · **CSV download** (a `blob:` href with
`download`, which no shipping browser subjects to CSP, but confirm it) · Library · Realtime support widget.

---

## 3. Migrations the owner must run, in this order

All four are additive and idempotent, each with a `VERIFY` and a `ROLLBACK` section. **Take a database
backup first.** None has been executed.

1. **`security_invites_hardening.sql`** — after `multi_org_tenancy.sql`.
   Must run *before* #2, which re-creates the same two `org_invites` policies.
   *If the unique index raises a `notice`*, clean the duplicate invites with the query in `VERIFY (c)` and
   re-run to pick it up.
2. **`security_verified_email.sql`** — after `multi_org_tenancy.sql`, `beta_signups.sql`,
   `support_messaging.sql`, `crm.sql`, `kanban_board.sql` and migration 1.
   ⚠️ **Run this check first and confirm it returns 0:**
   `select count(*) from auth.users where email_confirmed_at is null;`
   Accounts with a NULL `email_confirmed_at` lose exactly three abilities — accepting a workspace invite,
   reading their own `beta_signups` row (so an *approved* user would stay stuck on the waitlist screen),
   and opening a support thread that carries their email. With "Confirm email" ON users confirm and are
   fine; with it OFF Supabase auto-confirms at signup and stamps the column, so they are also fine. If the
   count is not 0, confirm or stamp those accounts before running.
3. **`security_abuse_limits.sql`** — after `analytics_events.sql`, `beta_signups.sql`,
   `support_messaging.sql`. Independent of 1 and 2.
   Every CHECK is `NOT VALID` so existing history is untouched; `VERIFY (f)` lists the rows that would
   fail if you ever `validate constraint`. One portability note in the header: if this Postgres rejects
   `pg_column_size()` inside a CHECK, the drop-in equivalent is `octet_length(props::text) <= 2048`.
4. **`security_storage_policies.sql`** — after `multi_org_tenancy.sql`. Independent of 1–3.
   **This one is not finished by running it.** Run the section 0 inventory, note the exact name of the
   permissive dashboard policy, then uncomment the matching drop in section 4 — policies are OR'ed, so
   until the old one is gone the new scoped ones change nothing. Immediately afterwards exercise:
   **upload a folder · crop a photo in Step 3 · "Compress N Images" · delete a *teammate's* batch from the
   Library.** Rollback is one `create policy` away if any of those breaks.

### Also needs deploying (code, not SQL)

```bash
deno check supabase/functions/shopify-titles/index.ts supabase/functions/generate-prose/index.ts
supabase functions deploy shopify-titles
supabase functions deploy generate-prose
```

Both keep `verify_jwt` ON. After #1 and #3 are deployed, **rotate `SHOPIFY_ADMIN_TOKEN` and
`CF_API_TOKEN`** — assume the catalog and the model quota were reachable by anyone holding the public
anon key.

---

## 4. Dashboard settings the owner must enable (code cannot)

| Setting | Where | Why |
|---|---|---|
| **Confirm email** | Authentication → Providers → Email | The precondition for `security_verified_email.sql`. Without it the JWT email claim is self-asserted from the signup form (finding #5). |
| **Leaked password protection** | Authentication → Providers → Email | Finding #18. `Auth.tsx` now enforces 10 characters client-side; only the server can check a breach corpus. |
| **Minimum password length** | Authentication → Providers → Email | Set to 10 to match `MIN_PASSWORD_LENGTH`. The dashboard value is authoritative. |
| **MFA (TOTP)** | Authentication → MFA | Finding #18/§4.4. Especially for Founding Workspace admins — `is_beta_admin()` reaches every tenant's membership, the CRM, all support threads and every account's email. |
| **Auth rate limits** | Authentication → Rate Limits | Open signup is the entry point for #1, #3, #5 and #10. |
| **Verify bucket + object policies** | SQL Editor, then Storage | The section 0 query in `security_storage_policies.sql`. This is the unverified half of finding #4. |
| **PITR / backups** | Database → Backups | The delete paths in #15 are irreversible and unaudited. |

---

## 5. Deferred to the orchestrator

Everything below is in a file I was told not to touch. Each is the complete edit.

### (a) `src/App.tsx` — purge the image cache on sign-out (finding #21)

`handleSignOut` is at **`src/App.tsx:1216`**. Add the import and one call:

```ts
// with the other src/lib imports at the top of App.tsx:
import { purgeImageCache } from './lib/swCache';
```

```ts
  const handleSignOut = async () => {
    log.auth('handleSignOut');
    await supabase.auth.signOut();
    await purgeImageCache();          // ← ADD THIS LINE (finding #21: drop cached tenant images)
    clearAnalyticsContext();
    setUser(null);
```

`purgeImageCache()` never throws and never rejects (no Cache Storage, no Service Worker, and nothing
cached are all handled), so it needs no `try/catch` and cannot block sign-out.

### (b) `src/App.tsx` — confirm the unscoped one-shot delete stays deleted (finding #8)

`git show HEAD:src/App.tsx` still contains the `sortbot_orphan_cleanup_v3` block with
`delete().like('storage_path', '%<prefix>%')` and **no `user_id`/`org_id` filter** (HEAD lines 1105 and
1118) — inside the shared Founding Workspace that deletes other members' `product_images` rows, and it
fires automatically on first load per browser. The working tree no longer has it (the concurrent agent
removed it). **Verify it is absent after the merge.** If it returns, either delete the effect outright
(the localStorage guard means it has already run for every existing browser) or scope it:

```ts
await supabase.from('product_images').delete()
  .eq('user_id', user.id)                       // ← was missing entirely
  .like('storage_path', `%${prefix}%`);
```

### (c) Nothing else was blocked

No other assigned fix needed a file on the exclusion list. `src/lib/productService.ts`,
`workflowBatchService.ts`, `libraryService.ts`, `tusUpload.ts`, `orgService.ts`, `ImageUpload.tsx`,
`ProductDescriptionGenerator.tsx` and `src/components/ui/` were **read only** — `orgService.ts` and
`ImageUpload.tsx` in particular to prove the `org_invites` UPDATE surface (only `accepted_at`) and the
storage path shape (`{userId}/{productId}/{file}`) that migrations 1 and 4 depend on.

---

## 6. Files touched

**New**

| File | Purpose |
|---|---|
| `supabase/migrations/security_invites_hardening.sql` | #2 |
| `supabase/migrations/security_verified_email.sql` | #5 |
| `supabase/migrations/security_abuse_limits.sql` | #6, #16, #10 |
| `supabase/migrations/security_storage_policies.sql` | #4 |
| `src/lib/mailto.ts` | #7 — `isSafeEmail`, `safeMailto` |
| `src/lib/mailto.test.ts` | 8 tests |
| `src/lib/swCache.ts` | #21 — `purgeImageCache()` |
| `docs/reviews/05-security-fixes.md` | this log |

**Modified**

| File | Change |
|---|---|
| `supabase/functions/shopify-titles/index.ts` | #1, #9, #19 — caller gate, founding-only global fallback, strict host validation, no response echo (+ removed a pre-existing unused catch binding) |
| `supabase/functions/generate-prose/index.ts` | #3, #19 — caller gate, `proseEnabled` gate, prompt caps, fenced untrusted region, no response echo |
| `index.html` | #12 — CSP `<meta http-equiv>` + referrer policy |
| `public/sw.js` | #21 — `PURGE_IMAGE_CACHE` message handler |
| `src/lib/csvExport.ts` | #14 — formula-injection guard in `escapeCsvValue` |
| `src/lib/csvExport.test.ts` | 4 new tests (golden snapshot unchanged) |
| `src/lib/supportService.ts` | #11 — INSERT/UPDATE instead of `'*'` |
| `src/components/Auth.tsx` | #18 — 10-character minimum |
| `src/components/OrgPanel.tsx` | #7 — `safeMailto` on both mail links |
| `src/components/CrmPanel.tsx` | #7 — `safeMailto` on the contact mail link |

**Tests added: 12** — `src/lib/mailto.test.ts` (8: accepts ordinary addresses, rejects every mailto header
separator incl. `?bcc=`/`&body=`/`#`/`,`/`;`/`<>`/newline/`%0A`, rejects malformed and non-string input,
bare mailto, encoded subject/body, `+` encoding, null return, empty params) and `src/lib/csvExport.test.ts`
(4: every formula lead-in defused, negative numbers and ordinary cells untouched, original quoting
behavior preserved for blanks/separators, and an end-to-end check that a poisoned `seoTitle` comes out of
`buildShopifyCsv` as `'=cmd|calc`).
