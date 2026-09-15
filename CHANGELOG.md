# Changelog — Arcadian

## 2026-09-14 — Rename to Arcadian

### Brand
- **Outfit is the UI typeface** — self-hosted (SIL OFL, `src/assets/fonts/`, variable 300–700, latin), declared once in `index.css` as `--font-sans`; no font CDN, so the CSP stays `font-src 'self'`. **The logo is now the wordmark**: `Arcadian` set in Outfit 500 with tight tracking, no icon, everywhere the brand appears (header, landing nav, sign-in, waitlist); new geometric "A" favicon.
- **Acadia → Arcadian** across every user-visible surface (landing, auth, waitlist gate, header wordmark, tool-view copy, support widget and Messages, invite and approval emails, browser title and meta description, the beta.html redirect, CI and uptime title assertions, deploy configs, README, AGENTS.md). Structural identifiers unchanged: the `/sortbot/` base path, every `sortbot_*` key, the `ACD-` SKU prefix and the `acadia-app` container names.

### Step 2 and Step 3
- **Step 2 piles.** Grouped photos are a stack: the first photo on top, the rest peeking behind with a `+N` badge; click (or Enter/Space) fans the stack open in place with drag-reorder, remove-from-group and a Collapse bar; Escape collapses. Singles are unchanged.
- **One Step 2 toolbar, one line.** The left sidebar is gone and the ~20 controls that replaced it are condensed: **Filter ▾** holds Groups/Singles, the date list and the category chips (with a count on the button when anything is filtered), **View ▾** holds the sort order, the columns slider and the "clear cached originals" action, and photos-per-item + Apply + Pick + Pick photos stay out in the open. The photo tools — rotate, copy/paste crop, revert, delete — now appear only when you have photos selected or something copied, so the resting toolbar is a single strip above a full-width grid instead of three wrapped rows. The duplicate photos-per-item slider is gone (type the number, or press ⌘ 1–9). On phones the strip scrolls sideways and the panels open full width. The groups/singles/listings/photos count chips were removed (the section headings carry the counts); the selected count plus Undo/Redo sit at the end of the row.
- **Step 3 scrolls as one page.** The preview column, the voice-command table and the three text areas no longer scroll inside the page, so a scroll never gets stuck inside a panel. Prev/Next now stay pinned for the whole form.
- **Shortcuts moved to a gear button** in the bottom-left corner, mirroring the inbox button on the right: a panel lists every shortcut by screen (Ctrl shown on Windows/Linux) and holds the debug-logging switch. The cheat sheet in Step 2 and the floating debug button are gone.

### Navigation
- **Storage meter moved into the workspace menu.** The always-on bar under the header is gone; the same figures (used / limit, %, file count, almost-full warning) are a row at the top of the workspace menu, and clicking the row refreshes them.
- **The header toolbar is gone.** Every tool (Library, Labels, Scan, Inbox, Manage Categories, Category Presets, Workspace dashboard, and for founding admins Vocabulary, Analytics, CRM, Finance, Board) is now a grouped option in the workspace menu at the top right, which shows the unread-message count on its trigger. Keyboard-complete (arrows, Home/End, Escape). On phones the same menu opens as a bottom sheet, and the bottom bar's More tab opens it too.

### Database
- **Database CPU reduction** — `perf_rls_initplan.sql` recreates every RLS policy with helper calls wrapped as `(select …)` (once per statement instead of once per row: 94.5 ms → 1.9 ms measured) and adds six missing indexes; `perf_storage_usage.sql` replaces the ~2,500-call storage-bucket walk with one `storage_usage_bytes()` RPC. Client: auto-save skips byte-identical payloads and debounces at 5 s with a flush on batch switch, the group upsert sends only changed rows, support polling pauses in hidden tabs and backs off to 180 s while Realtime is connected, the CRM auto-sync runs at most every 10 minutes. Run order: storage usage, then the policy file last, and re-run the policy file after any migration that recreates a policy.
- **The last nine database linter warnings cleared** — `supabase/migrations/security_rpc_wrappers.sql`
  finishes what `security_function_hardening.sql` started. The nine functions the client calls through
  `supabase.rpc(...)` kept warning 0029 because they had to stay in the exposed schema to be callable; that
  was true of the entry point, not of the definer rights. Each SECURITY DEFINER body now lives in the
  unexposed `app_private` schema behind a SECURITY INVOKER wrapper in `public` whose signature is identical
  down to argument names, DEFAULTs, `returns table` column order and volatility — so `/rest/v1/rpc/<fn>`
  answers exactly as before and **no client code changed** (verified: identical result hash, founder access,
  42501 for non-founders, zero anon reachability across all 18 functions, and a byte-identical layered
  rollback). Supabase's linter now reports nothing: 0011, 0028 and 0029 all clear. Note that this also means
  the linter can no longer flag a NEW SECURITY DEFINER function — AGENTS.md §18 is the guard from here.
- **Database function hardening (linter 0011 / 0028 / 0029)** — `CREATE FUNCTION` grants EXECUTE to PUBLIC,
  so all 27 SECURITY DEFINER functions were callable by the logged-out `anon` role. New migration
  `supabase/migrations/security_function_hardening.sql`: the eight helpers that policies and `org_id` column
  DEFAULTs call move into a new unexposed `app_private` schema (with same-name SECURITY INVOKER wrappers in
  `public`, because function bodies re-resolve names at execution time while policies are bound by OID);
  the fifteen trigger functions, internal guards and maintenance routines lose EXECUTE from PUBLIC, `anon`
  **and** `authenticated` (a trigger fires without it); the nine RPCs the client actually calls keep
  `authenticated` and lose `anon`. `crm_touch_updated_at` and `finance_touch_updated_at` get a pinned
  `search_path`. Additive, idempotent, rollback included; verified on a throwaway PostgreSQL 14 — founder
  RPCs, tenant RLS, anon analytics writes, the support triggers and the founding-admin lockout rail all
  behave identically, and the rollback restores the catalog byte for byte. No client code changes.

## 2026-09-14 — Dictation, persistence, pricing, barcodes and labels

Twelve more of your reports, numbered as you sent them (9, 11, 14, 16, 17, 21, 23, 25, 26, 28, 29, 30). **1,019 tests / 51 files green**, build clean, no new dependency, and the description and CSV output for a listing that was already correct is byte-for-byte what it was. Two migrations and one one-off data repair are waiting for you at the bottom of this entry — until they are run, everything behaves exactly as it does today.

### Dictating and describing

- **Report 9 — field names stop ending up inside your fields.** Saying `brand nike chest 22` was storing the brand as "Nike Chest 22", and the same happened with the word "description" and six other field names, in every field. A value now ends where the next field name begins, and any field name that had already been saved into a value is stripped when it is read. Only the field's own name is removed, so real labels like "Care Bears" and "Second Skin" survive.
- **Report 26 — kids, petite, plus, tall and pants sizes are understood.** `petite small` was becoming "PETITE", `youth medium` became "YOUTH", `large tall` quietly lost the "tall", and `32 by 34` lost the inseam entirely. They now come out as `PS`, `YM`, `LT` and `32x34`, along with toddler (`3T`), baby age ranges (`6-9M`) and women's plus (`1X`) — and women's plus is never turned into men's extra-large, because they are different garments. Saying the waist and the inseam fills the size, and saying the size fills the waist and inseam.
- **Report 11 — titles stop collecting small words.** `of`, `its`, `it's`, `the`, `they`, `would`, `because` and the rest of their families are filtered out of a title built from your description. Words that only look like filler in a resale listing — "all **over** print", "**made** in usa", "**right** chest hit", "**Bad** Boy" — are deliberately kept.
- **Report 14 — the app remembers how your brands are misheard.** Dictation returns the English word it heard: "echo unlimited" for *Ecko Unltd*, "foo boo" for *Fubu*, "la tiger" for *Le Tigre*. Correct it once and choose "Remember for this workspace", and from then on it is corrected automatically with an Undo. When it is only fairly sure it asks "Did you mean Ecko Unltd?" and leaves your text alone until you say yes. Anyone on the team can see and edit the list, from the Brand field or from the Vocabulary dashboard's new Brand spellings tab.
- **Report 17 — the magnifying glass stays on screen.** It used to run off the right edge and get cut off at the top and bottom. It now flips to the other side of the cursor rather than sliding, so it never covers the spot you are inspecting.
- **Report 23 — "C&D Vintage" stops coming back in the brand field.** A build that was live for 34 minutes in July wrote the shop name into the same column that stores a garment's brand, and the app then loaded it back over whatever you had just typed. It no longer writes it, it clears it when it sees it, and a brand you type is never replaced by the stored one. **The rows written that day are still in the database** — see the repair at the bottom.
- **Report 28 — a Save button, and you can see when saving fails.** Auto-save was working, but a failure was completely silent. There is now a Save button beside Prev/Next that flushes everything and waits for the write, and one status line — `Saving… / Saved 12:04 / Save failed — retry` — that every save in the app reports into. One real hole was found and closed while checking: the last half-second of typing could be dropped when you switched batches from the Library.

### Grouping, photos and saving

- **Report 29 — grouped photos stay grouped after a refresh.** Four separate things were undoing your grouping: an older copy of the grouping in a second place in the database was allowed to win; a save that arrived while another was still in flight was thrown away instead of retried; the app compared the timestamps wrongly and sometimes discarded the newer of its two copies; and the newer copy, when it did win, replaced the other one wholesale and took descriptions with it. An ungroup is now treated as a decision, not as missing data, so a refresh cannot put a group back together.
- **Also fixed on that path:** a pending grouping save could delete the product rows of the *next* batch if you opened one within two seconds of grouping.
- **Report 16 — photos stop appearing upside down in the Describe step.** Saving a batch writes a rotated copy of a rotated photo, and the app was then rotating that copy again on the next load — 90 plus 90 is 180, which is why it looked upside down rather than sideways. It only affected photos that were rotated *and* saved, which is why it looked random. Restored photos now always come from their own original file.
- **Report 30 — double-clicking while selecting no longer opens the photo.** While anything is selected (or a pick mode is on), a double-click is exactly one selection tap and nothing else. On group photos it used to select and deselect in one gesture, so nothing happened at all except the photo opening. With nothing selected it still opens the photo, and it no longer leaves that photo selected afterwards.

### Pricing, barcodes and labels

- **Report 21 — per-marketplace pricing.** Set an uplift per platform — a percentage or a dollar amount, with optional `.99` or whole-dollar rounding, and optionally applied to the compare-at price too — in **Workspace → Settings → Marketplace pricing**. Then pick the platform above the Step 4 preview: the preview and the downloaded CSV both use it, the platform name goes into the filename (`shopify-products-ebay-2026-09-14.csv`), and a line above the preview states the rule in words. Quick-add chips seed each marketplace's published headline fee as a starting point — fees change, so check yours. Your listing still has **one** price; the marketplace rule is applied when the file is written and never saved back. A $0 price is never adjusted, so picking a platform cannot sneak an unpriced product past the export block.
- **Report 25 — labels.** Give a listing colour labels, word labels ("bad kids club") and vendor labels from Step 3. A label can be on some of a listing's photos and not others, so a chip shows "2/4" and tapping it applies it to the rest rather than clearing it. Any member of the workspace can add labels — it is shared shop vocabulary.
- **Report 25 — printed labels with barcodes.** The new **Labels** page prints a shelf label per listing of the open batch: title, size, price, its labels, and a scannable barcode with the SKU underneath. Three stocks are supported — 4"×2" (10 per sheet), Avery 5160 (30 per sheet) and 2.25"×1.25" thermal — and what you see on screen is what prints. SKUs are assigned on demand and are unique inside your workspace.
- **Report 25 — scanning.** The new **Scan** page finds a listing three ways: point a phone camera at a label, use a USB or Bluetooth barcode scanner (it behaves like a keyboard), or type the SKU. A hit shows the listing and opens it in the Describe step. If the scanned listing belongs to a different batch, it says so and tells you to open that batch from the Library rather than jumping you to the wrong listing. Everything here is ours — no barcode library, no scanning service, and no camera left running after you leave the page.
- **Labels and Scan are available to every workspace**, from the header on a computer and from **More** on a phone.

### Before these are fully on

Run in the Supabase SQL editor, after the workspace migration. Both are additive, can be run twice safely, and include a rollback:

- **`supabase/migrations/brand_aliases.sql`** — turns on brand spelling memory. Until then the brand-spelling panel simply does not appear.
- **`supabase/migrations/listing_labels.sql`** — turns on labels, SKUs and the Labels and Scan pages. Until then the labels picker shows nothing, Labels prints without barcodes, and Scan says what is missing.

One more thing needs a human: **the "C&D Vintage" rows from report 23 are still in the database.** The code no longer creates or reloads them, but rows written during that 34-minute window in July still hold the shop name where a garment brand belongs. The `update` to fix them — with a preview query to read first — is in `docs/reviews/12-step3-fields-brands-sizes.md`, "Final stitch", section 5. It is a one-off edit to your own data, not a schema change, which is why it is not a migration.

## 2026-09-14 — Step 3 dictation and crop paste fixes

Your six Step 3 reports (numbered below as you sent them), plus the "1 or 2 out of a hundred come out cropped wrong" problem. Nothing else changed: no migration to run, no setting to change, no new dependency, and the description and CSV output for a listing that was already correct is byte-for-byte what it was. **668 tests / 41 files green**, build clean.

### Dictating

- **Report 4 — you no longer have to say "period".** Naming the next field ends the one before it, so `brand nike size large price forty` fills three fields in one breath. Whatever you have said is also written when you simply stop talking — including when the browser cuts the microphone on its own after a pause and starts it again. Nothing is thrown away any more: Stop Recording keeps what was in progress instead of deleting it, and so does moving to the next listing.
- **Report 5 — press the `.` key, or click the new Period button, instead of saying the word.** Same effect as saying it. The key is ignored while you are typing in a field, so it never eats a decimal point.
- **Report 10 — the word "description" no longer ends up inside your listings.** Dictating `description super soft faded` was storing the literal word "description" as part of the description, which then leaked into the generated title, the tags and the description body. It is stripped now, and listings already saved with it are repaired when they are next generated.
- **Report 7 — a dictated description no longer gets chopped in half.** It now runs until you say "period" (or press the key), so narration containing words like "sleeve", "style", "length" or "care" stays in the description instead of jumping into those fields. A new sentence that really does start a command — `length 28` — still ends it.
- **Field names are matched as whole words.** Saying "vin**tag**e", "over**size**d" or "s**care**d" no longer fires the tags, size or care fields.
- **Words always land on the listing you said them over**, even if you hit Next in the middle of a sentence.

### Editing after dictating

- **Report 8 — edits stick now.** Changing one field in the voice table was deleting the description that shared a line with it in the transcript, and the next Generate then rebuilt the listing from the damaged transcript. Fixed.
- **Several fields dictated in one breath all save.** `brand nike size large price forty` was writing all three on screen but saving only the last one to the database, and a spoken price like "forty five" saved as blank. Fixed.
- **Generating no longer reverts brand, size or colour** in the database to their pre-dictation values.

### Categories and presets

- **Report 3 — your category stops being replaced by the preset's product type.** Assigning a preset in Step 3 was overwriting the category you set in Step 2 (`sweatshirts` became `Mens Sweatshirts`), and because generating runs every time you stop recording, it could then pick an unrelated preset and re-apply it. The category you chose is now left alone, and when two presets share a product type the one marked default wins instead of whichever the database returned first.

### Cropping

- **Pasting a crop across many photos is accurate on the odd ones out.** A copied crop now remembers the shape of the photo it was drawn on, so pasting it onto a photo shot in the other orientation, onto a rotated photo, or onto one that was already cropped reproduces the same framing instead of a stretched version of it. Photos that match the one you copied from are cropped exactly as before.
- **Pasting twice no longer crops the crop.** A bulk paste now works from the original photo, so running it again does not zoom in further.
- **Photos that fail are reported instead of counted as done.** A failed upload or a photo that would not load used to show as finished while staying uncropped; you now get a count of what failed and a message saying those photos are unchanged, and the Retry button actually appears.
- **Crops in Step 3 show up immediately.** A re-crop in the Describe step replaces the photo at the same address, and the app's own image cache plus the offline cache could keep serving the old picture for up to a week — which is why a few photos in a batch looked like the crop had not applied. Those caches are now cleared for that photo.
- **Two crops can no longer run on the same photo at once** (a double-clicked Paste, or Retry starting while the first pass is still finishing), which could leave a photo pointing at a file that had just been deleted.

## 2026-09-14 — Mobile-first pass

The whole app now has phone and tablet layouts. **Nothing about desktop changed** — every layout rule added here lives inside a screen-width query, and the listing, saving and export logic was not touched. No migration to run, no setting to change, no new dependency. End state: **579 tests / 40 files green**, build clean, lint unchanged at 254.

Three screen sizes are used throughout: phone (up to 640px), tablet (641-1024px), and desktop (above 1024px, unchanged). Everything you can tap is at least 44px, and every form field is at least 16px text, which is what stops iPhones from zooming into a field and never zooming back out.

### Getting around

- **On a phone there is a bottom tab bar** — Workflow, Library, Messages, More — with everything else (Categories, Presets, Workspace, and the founder tools) behind **More**, which opens as a sheet from the bottom of the screen. The unread badge stays on the Messages tab, so a new message is never hidden behind a menu.
- **On a tablet the tools move to a second row** on the black bar that scrolls sideways, instead of wrapping the header into several lines.
- The header used to wrap into a four-line black slab on a phone before you could look at anything. It is now one line: the name, Messages, and your account menu.
- The bar always shows where you are, including when you are on a page that lives behind More.

### Uploading (Step 1)

- **Take photos** and **Choose from library** buttons on phones. Take photos opens the camera directly; both feed the same upload as before, so compression, shot-time ordering and resumable uploads are unchanged. Folder and ZIP import are still there, above.

### Grouping and categorizing (Step 2)

- The left sidebar becomes a compact toolbar at the top, with sort, filter, date and auto-group controls folded behind **Sort, filter & group tools** so photos start near the top of the screen instead of a screen-and-a-half down.
- The photo grid fits **three across** on a phone (two for multi-photo groups). The density slider still works — it just has a phone-sized range, and your desktop setting is remembered, not overwritten.
- **Categories move to a bar along the bottom** of the screen that scrolls sideways. Select photos, then tap a category — dragging a group onto a category is a mouse gesture that does not exist on a touch screen. The bar grows to show Group / Ungroup / Delete once something is selected.
- Tapping the toolbar itself no longer clears a selection you just built.
- Pinch-to-zoom still works over the photo grid, and a long press no longer pops up "Save Image".

### Describing (Step 3)

- **Previous / Next, the listing counter and Download CSV sit in a bar pinned to the bottom** of the screen, and stay there while you scroll through the form — not just while you are looking at the photo.
- Start Recording is a full-width button; fields stack to one column; measurements sit two across.
- **The crop tool works with a finger** — drag the box, drag the corners (the grab areas are finger-sized even though the handles still look precise). Pinch-to-zoom inside the crop is not supported.
- **The magnifier is hidden on touch-only devices**, along with its settings — it followed a mouse pointer and could never follow a finger. A touchscreen laptop with a mouse keeps it.

### Exporting (Step 4)

- The Handle column stays frozen on the left while you scroll the 54-column preview sideways, so a row can still be identified 40 columns in. Panning the table no longer drags the whole page with it.
- The "a product has no price" warning is bigger — it is the one thing here you have to be able to read and act on.

### Library, Messages and the founder tools

- **Library shows two cards per row** on a phone rather than one full-screen card per batch, and the per-item controls that used to appear only on hover are now always visible (nothing hovers on a phone). Rename opens as a bottom sheet instead of a box wider than the screen.
- **Messages** puts search and filters on one wrapping line, and the reply box sits on the bottom edge of the conversation.
- **Analytics, Errors, CRM, Finance and Workspace**: summary tiles sit two across, filter rows scroll sideways instead of wrapping into four ragged lines, and wide tables either become labelled cards (the funnel, events, top issues, the ledger, workspaces) or scroll inside themselves with the first column pinned, so you never lose the row's label. Charts scroll inside their own box with the legend held above.
- **Category presets**: the ten editor sections are now collapsible on a phone, so you can fold away what you are not editing. They start open, and on desktop they behave exactly as before.
- **Kanban board**: lanes swipe one at a time instead of shrinking, and a card opens full screen.

### Logged out

- The landing page, sign-in and the waitlist screen all take the same treatment: 44px buttons and links, full-width stacked calls to action, and 16px form fields. Sign In was a 31px target before.

### Two bugs fixed

- **The landing page's preview panels were being clipped at narrow widths.** At 360px the two-column mock panels ran about 30px past their container and the right-hand cells were quietly cut off. Invisible at 390px, which is why it had survived.
- **Step 3's voice command table pushed the whole page sideways on a phone.** Its five columns demanded 450px on a 390px screen, so the entire page scrolled horizontally. It is now a two-up card list.

### Still owed

Nobody could sign in to the app while this was built, so everything past the logged-out screens was verified from the code and from the real stylesheet at real screen widths, not from a signed-in phone. A pass on an actual iPhone is the next step; the specific list of what that would confirm is in `docs/reviews/10-mobile-pages.md` and `10-mobile-workflow.md`, and all of it is small numeric tuning rather than anything structural.

## 2026-09-14 — Messages page + Finance module

Two additions, neither of which changes anything in the listing workflow. **One migration needs running: `supabase/migrations/finance.sql`.** Until it is, Finance shows a setup step instead of an error, so the button is safe to expose today. End state: **570 tests / 39 files green**, build clean, lint unchanged at 254, no dependency added.

### Messages: a full page beside the floating widget (`docs/reviews/08-messages-view.md`)

- **Every signed-in user now gets a Messages button in the header**, with an unread count badge, alongside the floating button that was already there. The floating widget is unchanged — same badge, same auto-open, same Enter-to-send.
- **The page is a list beside a conversation**: search across email, workspace, subject and message preview; the thread stays open while you scan the list; Up/Down arrows walk the list from the keyboard; Enter sends and Shift+Enter starts a new line. Starting a conversation now offers an optional **subject** — the database always supported one, nothing had surfaced it.
- **For founding admins the same page is the Inbox**: every conversation from every workspace, Open / Closed / All filters with live counts, unread conversations first, and close/reopen. The page title says "Inbox" for founders and "Messages" for everyone else.
- **On a narrow screen** the two columns become one, with an "All conversations" control to get back to the list.
- **Both views and the badge now share one live connection.** Previously the widget owned its own; adding a second front end would have meant two live connections, two refresh timers and two lists that disagree the moment one of them sends a message. There is now exactly one of each no matter how many messaging views are open, and a sent message appears in the list immediately rather than one round-trip later.
- **Signing out clears the conversation list**, so the next person on a shared machine never sees a flash of the previous account's messages.
- Waitlisted users are unaffected: they have no header, and keep the floating widget exactly as before.

### Finance: the founder's books, first-party (`docs/reviews/09-finance.md`)

For founding admins only, behind a new **Finance** button in the header. Like analytics, the CRM and messaging, it is tables in this project's own database — **no payment processor, no accounting service, no bank feed, no external API.**

- **Overview** — income, expenses, profit and margin over any range (with the equal-length previous range for comparison), a monthly profit-and-loss chart, and a breakdown by category. Every charted value is also in a table.
- **Transactions** — type in what came in and what went out: date, income/expense, category, amount, description, and optionally the customer workspace an income belongs to. Delete is a two-step confirm, never a browser popup.
- **Recurring entries are entered once.** A monthly or yearly entry is a template with an optional end date; its repeats are worked out when the books are read, not stored. Changing a $20/month bill to $25 corrects the history and the forecast in one edit, and a repeat can never drift — a charge anchored to the 31st lands on Feb 28, then **Mar 31**, then Apr 30, not on the 28th forever. (Consequence worth knowing: the transaction count on Overview counts occurrences in the range; the Transactions tab counts each recurring entry once and says so.)
- **Customers** — every workspace with its plan, members, what it has paid, and what it is worth per month; totals for workspaces, members, new signups and active workspaces; and projected monthly recurring revenue shown twice, at list price and after the founding discount, so the cost of the founding promise is visible rather than buried.
- **Founding shops are recognised by a durable rule**, not a flag: a workspace is founding if it is on the beta plan **or** was created on or before the cutoff date. Moving a founding shop onto a paid plan therefore does not quietly revoke the 30%-off-for-life promise on the pricing page.
- **Plan prices are editable in the app** (Customers → Plan prices) — no migration to change a price. They arrive seeded to match the landing page: Starter $50, Basic $90, Growth $150, Pro $250, Business $350, Scale $700, Enterprise $1,200 per month, with Free and Beta at $0, and founding shops at 70% of list. Re-running the migration never overwrites a price you edited.
- **Reports** — a ledger CSV, a profit-and-loss CSV, and a printable statement. Both exports go through the same guard as the Shopify export, so a spreadsheet cannot be tricked into running a formula from an exported field.
- Projected revenue reads $0 today, because no workspace is on a paid plan yet. That is the books being correct, and the Customers tab says so.

### For the operator

- **Run `supabase/migrations/finance.sql`** in the Supabase SQL Editor, after `multi_org_tenancy.sql` and `beta_signups.sql`. It is additive, idempotent, and carries its own rollback at the bottom. It was verified against a throwaway local Postgres — access control, the recurrence and revenue math, a re-run that preserved hand-edited prices, behaviour with the optional analytics table absent, and the rollback — but **no SQL was run against the live database.**
- Finance data is founding-workspace-only at the database level, and the "who entered this" stamp on a ledger row cannot be edited by anyone, including its author.
- Nothing else to configure: no keys, no secrets, no environment variables.
- Still missing on purpose: multiple currencies (the column exists, the interface is USD-only), receipt attachments, and importing from a bank or payment processor.

## 2026-09-13 — Engineering review: six passes over the whole codebase

Six audits (architecture, latent defects, performance, UI system, security, DevOps) were run against the tree and each was then implemented. Reports and implementation logs are in `docs/reviews/`. End state: **505 tests / 35 files green** (from 305/24), `npm run build` clean, **254 lint problems** (from 311), **no dependency added or removed**, and no `sortbot_*` storage key renamed.

Most of this is invisible to a user in the good sense — the app does the same things, with fewer ways to lose their work. **Two things need the owner: five SQL migrations to run and a handful of Supabase dashboard settings to turn on.** Both lists are at the bottom.

### Data loss and correctness (`docs/reviews/02-debugging-fixes.md`, `03-performance-fixes.md`)

- **Six queries silently truncated at 1,000 rows and now paginate.** PostgREST caps a response with no error, so a partial read looked like a complete one. The worst of them meant deleting a 1,500-item batch permanently orphaned 500 products' images and storage files; another meant a 1,500-item batch reloaded with 500 items missing every saved field (description, price, tags). A read that cannot be completed now refuses to delete storage rather than guessing.
- **Field edits in Step 3 could be silently discarded.** The product update treated "0 rows changed" as success, so an RLS-blocked or missing row lost the edit. It is now checked, and it also writes the group *leader* row (the one the restore path reads) before mirroring onto the rest of the group, so no later re-grouping can strand a listing's text on a row nothing reads.
- **Reopening a batch no longer destroys a group's other photos.** The `product_images` refresh wiped and re-inserted; it now merges against what is already there, keeps positions, drops only genuinely stale rows, and skips the wipe entirely if it could not read the existing rows first.
- **Deleting a batch is ordered so a failure leaves a recoverable state**: reference-count, claim, confirm the batch row is gone, then children, then storage files last.
- **Cancelling an upload cleans up after itself** — the rows and files it had already created are deleted (rows before files). One rough edge remains: cancelling during the first chunk leaves an empty batch in the Library.
- **Duplicating a batch used to produce an empty one.** It now copies the items.
- **An upload could wedge the whole batch** if a resumable-upload session hung; there is now a 5-minute watchdog that falls back to a normal upload.
- **Items no longer get stolen between batches** by the Step 2 saves, and the ±24 h orphan-adoption fallback is now restricted to genuinely unassigned rows belonging to the current user.
- **"No price" is saved as empty instead of $0**, so a reload no longer pins a fake price (and the $0 export block still fires for a real 0).
- **Library's delete of individual images no longer discards concurrent work** (a compare-and-set on the shared session blob). *Known and still open:* deleting an image in Library while its batch is open can be undone by the open session's next auto-save — the fix is a behaviour change and is waiting on a decision.
- **A dangerous one-time cleanup was deleted.** It ran unscoped storage-row deletions with no workspace filter on first load per browser; under multi-workspace RLS it could have reached another workspace's rows.

### Speed and memory (`docs/reviews/03-performance-fixes.md`)

- **First load parses ~30% less JavaScript**: the main bundle went 1,250 kB → ~875 kB raw (363 → ~259 kB gzipped) and the render-blocking stylesheet 189 kB → 112 kB (−40%), by loading the ZIP and EXIF libraries only when those features are used and every modal only when it is opened.
- **Step 2 is dramatically cheaper to render**: date labels on 1,500 cards went from 84.6 ms to 0.07 ms per render, the name sort 19× faster, and rubber-band selection now repaints at most once per frame instead of once per mouse event (and halves its forced layouts).
- **The tab no longer runs out of memory during bulk crop work.** The decoded-image cache was unbounded (~24 GB at 1,500 images; the tab died somewhere around 130–250) and is now a 512 MB least-recently-used cache.
- **Auto-save writes half as much**: derived image URLs are no longer stored in the session blob, since every restore path rebuilds them from the storage path anyway (1,066 KB → 508 KB per save at 1,500 items). Items with no storage path keep theirs.
- **The crash backup no longer blocks the UI on every click** (a ~393 KB synchronous write, now throttled to at most once a second and flushed when the page goes away), and the compress-tracking registry went from an O(n²) rewrite per image to one write.
- **Saving a batch makes 60% fewer requests** (1,875 → 750 for 1,500 images), and Step 3's preset pass makes one request instead of 375.
- Unmount now cancels the timers and animation loops that used to keep running against a detached page.

### Security (`docs/reviews/05-security-fixes.md`)

- **Both Edge Functions now verify who is calling.** The public anon key is itself a valid project token, so the built-in JWT check never proved a user: the Shopify function was dumping the founding store's entire product catalog to anyone with the public key, and the description-paragraph function was an unmetered AI proxy on the owner's Cloudflare account. Both now require a real signed-in user; the global Shopify credentials are reachable only by a proven member of the founding workspace; the paragraph function requires that workspace's opt-in, bounds its prompt, and treats the input as data, not instructions. Neither function echoes an upstream error body any more.
- **Store-domain input is validated**, closing a server-side request forgery vector (`evil.com/.myshopify.com` and friends).
- **A Content-Security-Policy ships in `index.html`** — the app's session tokens live in browser storage, so this is what makes injected script useless. No remote scripts, no `eval`, network limited to Supabase plus the landing page's photo host.
- **CSV exports can no longer carry a spreadsheet formula** (`=`, `+`, `@`, leading tab/CR are neutralized; `-12.50` still exports as a number). The golden export snapshot is byte-identical.
- **Mail links are validated** — a beta applicant's email address could previously inject extra headers into the owner's mail client.
- **Live updates no longer leak deleted support threads** to every subscriber.
- **Sign-up requires a 10-character password** (existing accounts are unaffected), and **signing out purges the cached images** the Service Worker was holding for 7 days — relevant on a shared machine.

### Reliability and operations (`docs/reviews/06-devops-monitoring.md`)

- **CI on every pull request** (`.github/workflows/ci.yml`): tests, type-check, production build, verification that the built page keeps its title and its `/sortbot/` asset paths, a scan of the built bundle for credential-shaped strings, a lint ratchet that fails only if the debt grew, a rule that every migration touched by the change documents its rollback and is safe to re-run, and a type-check of the Edge Functions. It has read-only permissions and never deploys.
- **The app reports its own crashes** into its own `app_errors` table, grouped into issues by a fingerprint that survives a redeploy, readable in **Workspace → Founder tools → Errors**. Messages and stacks are scrubbed of emails and identifiers in the browser; the database itself refuses to store a full user agent; volume is capped three ways so a crash loop cannot flood the table. Inert until the migration is run — the panel shows a setup hint instead of an error.
- **An uptime probe every 15 minutes** (`.github/workflows/uptime.yml`) checks the deployed page and Supabase's auth health and files a single GitHub issue on failure, closing it on recovery. Its limits are written into the file: a skipped cron run means *unknown*, not healthy, and no probe can see a broken access-control policy.
- **Optional container packaging** in `deploy/` (Docker + nginx, `/healthz`, SPA fallback, cache headers) for a staging URL, self-hosting, or a rollback artifact that does not depend on re-running CI. GitHub Pages remains production.

### Internal structure (`docs/reviews/01-architecture-refactors.md`, `04-ui-system.md`)

- **20 dead files / 5,819 lines deleted** — all six unused components, the unused presence hook, and the OpenAI / Google-Vision / Llama-vision code paths, which is what makes "there is no third-party API key in this app" true rather than aspirational. Their variables were dropped from `.env.example`.
- **Five new single-purpose modules** replaced duplicated logic: the database-row→item conversion (two copies plus two 45-field merges, whose seven real differences are now explicit options), the storage-path→URL conversion (23 inline copies — which turns the future private-image migration into a one-function change), ID chunking (18 hand-written loops), preset matching (two diverging matchers), and the crash backup.
- **The session-blob item type is honest now** — one type instead of a 5-field claim about a 15-field reality, which removed the unchecked casts that claim required.
- **Library thumbnails get the retry-on-failure behaviour** the rest of the app already had (it had its own copy of the image component).
- **Diagnostic logging is gated again** — 76 stray console calls routed through the debug logger, with the expensive ones skipped entirely when debug is off.
- **A tested UI primitive library landed in `src/components/ui/`** (13 components, 76 tests) — real focus traps, keyboard-navigable tabs, required accessible names on icon buttons, one confirm pattern instead of six copies. **It is not adopted yet**: nothing outside that folder uses it, and adoption is an 18-step plan ordered by risk. Nothing in the app changed visually.

### Migrations to run, in this order

All are additive, idempotent, and carry their own rollback. **Take a database backup first.**

1. `supabase/migrations/security_invites_hardening.sql` — closes an invited member's path to workspace owner. Needs `multi_org_tenancy.sql`; must precede step 2.
2. `supabase/migrations/security_verified_email.sql` — stops email-matching access rules from trusting an unverified address. Precondition: confirm `select count(*) from auth.users where email_confirmed_at is null;` returns 0, and turn **Confirm email** on.
3. `supabase/migrations/security_abuse_limits.sql` — size/format/rate limits on the three tables the browser can write to. Existing rows are untouched.
4. `supabase/migrations/security_storage_policies.sql` — stops one workspace overwriting or deleting another's image files. **Inert until you drop the permissive policy that currently exists in the dashboard** (its inventory query finds it), then smoke-test upload, Step 3 crop, "Compress N Images", and deleting a teammate's batch.
5. `supabase/migrations/app_errors.sql` — turns on error reporting and the Errors panel. Independent of 1–4.

Then `deno check supabase/functions/*/index.ts`, `supabase functions deploy shopify-titles`, `supabase functions deploy generate-prose`, and **rotate `SHOPIFY_ADMIN_TOKEN` and `CF_API_TOKEN`** — assume both were reachable by anyone holding the public key.

### Supabase dashboard settings (code cannot set these)

- Authentication → Providers → Email: **Confirm email** (the precondition for migration 2), **Leaked password protection**, **minimum password length 10** (the dashboard value is the authoritative one).
- Authentication → **MFA (TOTP)**, especially for founding admins — that role reaches every workspace's membership, the CRM, and all support threads.
- Authentication → **Rate limits**. Database → **PITR / backups**: the delete paths are irreversible.
- For the uptime workflow: repository secrets `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.

## 2026-09-13 — Founder tools built in: analytics, CRM, messaging (first-party)

The app is 100% self-reliant for these: no third-party service, no external API. Everything is a table in this project's own Supabase database plus React UI. (An earlier same-day pass had integrated Twenty CRM, Plausible and Chatwoot — first hosted, then self-hosted; it was replaced outright by the native features below and no trace of it ships.)

### Analytics (`supabase/migrations/analytics_events.sql`, `src/lib/analytics.ts`, `AnalyticsPanel.tsx`)
- Cookieless first-party tracking: one `analytics_events` row per pageview / funnel event, written straight from the browser (anon landing visitors included; anon rows can never carry an identity, signed-in rows only their own user id — RLS). Random per-tab session id, referrer **host only**, coarse device class; no cookies, IP or user agent. Honors Do Not Track; skips localhost (`localStorage sortbot_analytics_force=1` to override).
- Events: `pageview` on every top-level view change (landing / auth / waitlist / app), plus Beta Signup, Account Created, Batch Created, CSV Exported.
- `analytics_summary(days)` RPC (Founding admins) returns totals + previous-period totals, a zero-filled daily series, top events, referrers, devices and views in one round-trip; `analytics_prune(days)` trims history.
- Dashboard in **Workspace → Founder tools → Analytics**: 7/30/90-day range, KPI tiles with deltas, a daily pageview column chart (thin bars, rounded caps, hairline grid, per-bar tooltip, keyboard-focusable), the four-step funnel with conversion rates, and events / referrers / devices tables — every charted value is also in a table.

### CRM (`supabase/migrations/crm.sql`, `src/lib/crmService.ts`, `CrmPanel.tsx`)
- `crm_contacts` (one per email: stage lead → approved → active → churned / lost, tags, next follow-up, links to the auth user + workspace, last seen) and `crm_notes` (timeline). Founding admins only (every policy is `is_beta_admin()`); note authorship is pinned to the caller.
- `crm_sync_contacts()` mirrors beta requests and accounts (with their oldest non-founding workspace) into contacts — new orgs and users show up by themselves; runs on panel open, on the Sync button, and after a beta approve/deny. It never overwrites hand edits: names/companies only fill blanks, stage only moves forward from lead/approved, tags/follow-ups/notes are untouched. The Founding Workspace's own members are skipped.
- Panel: stage chips with counts, a "Due" chip for overdue/today follow-ups, search across email/name/company/tags, inline stage select + follow-up date (overdue/today/soon styling), expandable rows with editable name/company/tags, notes with add/delete, manual "Add contact", two-step delete.

### Messaging (`supabase/migrations/support_messaging.sql`, `src/lib/supportService.ts`, `SupportWidget.tsx`)
- `support_threads` (one per conversation, denormalized email/workspace for the inbox, trigger-maintained last-message/preview/read stamps, open/closed) and `support_messages`. RLS: a user sees only their own threads and may only post as `user` in them; Founding admins see everything and post as `founder`. Both tables are added to the Realtime publication (replica identity full) so updates are live; the widget also polls every 45 s as a fallback.
- Floating **Messages** button (bottom-right) for every signed-in user — waitlisted users at the gate included — with an unread badge, conversation list, new-conversation composer, Enter-to-send. For Founding admins the same button is the **Inbox**: open/closed filter, unread-first ordering, reply, close/reopen.

### Plumbing
- New keys: `sortbot_analytics_session` (sessionStorage) and `sortbot_analytics_force` (localStorage) — listed in AGENTS.md §1. No env vars, no Edge Function, no new dependency.
- 16 new tests: tracker privacy contract (session id, DNT/localhost gating, referrer host, row shape), dashboard math (funnel, compact numbers, deltas, tick ceilings), CRM list logic (tags, follow-up urgency, filter/sort/counts), messaging unread/ordering/timestamps.

## 2026-09-13 — Rename to Acadia

### Brand
- **Arcatya → Acadia** across every user-visible surface: landing page, auth, waitlist gate, app header wordmark, invite and beta-approval emails, browser title and meta description, the beta.html redirect page, the index.css header comment, README, ANALYSIS, AGENTS.md
- No structural identifier changed — the `/sortbot/` base path and every `sortbot_*` localStorage key still read `sortbot` (see AGENTS.md §1)

## 2026-07-29 — Rebrand to Arcatya + dark theme

### Brand
- **Sortbot → Arcatya** across every user-visible surface: landing page, auth, waitlist gate, app header (now a wordmark, with the descriptor moved to the subtitle), invite emails, browser title, README, CHANGELOG
- Structural identifiers deliberately still read `sortbot` and must not be renamed without a migration — the `/sortbot/` base path (derived from the GitHub repo name; changing it 404s every asset) and the `sortbot_*` localStorage keys (in-progress batch, delete tombstones, the compressed-paths set covering all 4,854 storage files, debug toggle). Documented as a table in AGENTS.md §1.

### Dark theme
- `src/index.css` is now the single source of truth for color, elevation and motion: near-black canvas (`--ink-950` `#08080a`, never pure black), violet accent (`--accent` `#b087ff`), gold secondary, one shared easing curve
- **The legacy `--gray-*` ramp was inverted rather than replaced** — `--gray-50` was the lightest background and is now the darkest surface; `--gray-600/700` were text and are now near-white. That let ~13,300 lines of existing CSS flip correctly without per-rule edits.
- All 24 CSS files converted to tokens (~1,400 color literals), plus the hardcoded colors in TSX inline styles and runtime `element.style` assignments, which no stylesheet change could reach
- Category default palette reseeded — the old brand indigo was being written into every new workspace's `categories` table as persisted data

### Accessibility fixes surfaced by the conversion audit
- `--shopify-red-dark` was referenced by `.button-danger:hover` but **never defined anywhere**, so the hover state silently dropped its background and the label vanished (1.09:1). Now defined.
- `--text-muted` measured 4.34:1 on `--ink-850` — under AA, on the surface cards actually use. Lifted to 5.38:1. At a 9 px root font nothing in this app qualifies for WCAG's large-text exemption, so 4.5:1 applies to every string.
- `--gray-100` resolved byte-identical to `--ink-850`, making page canvas and cards the same color; remapped to the canvas step
- Added `--border-control` (3:1) for interactive edges — the decorative border tokens left inputs and buttons with no visible boundary at rest
- Solid accent/semantic fills now carry dark labels (`--text-primary` on `--accent` is only 2.46:1)
- `prefers-reduced-motion` honored; dark scrollbars, selection color, and a pre-paint canvas in `index.html` so there is no white flash on load

## 2026-07 — Title Engine, Export Integrity & Collaboration

### Title / Tags / Voice Engine Overhaul
- Category-aware synonym system: `fitTo60` detects the active garment type and only swaps synonyms within that group — no more sweatshirt titles absorbing tee terms
- New voice **"type"** (garment) and **"description"** fields; titles built from description keywords when a spoken description exists
- Sizes always render as letter symbols (XL / XXL / XXXL); many spoken size forms normalized
- Color/material dropped from title formulas; color modifiers stripped ("Faded Out White" → White); material split into primary (Shopify GID) vs full composition (description)
- User-typed titles are respected: used as the description opener and never overwritten by Regenerate

### Export Integrity & Shopify Cross-Reference
- Group-wide field coalescing — exported price/brand/size no longer depend on which photo happens to lead the group
- Export blocks (alert + banner) when any product has no price
- Titles/handles deduplicated against the export, the app's own database, **and the live Shopify catalog** via the new `shopify-titles` Supabase Edge Function (first server-side code; Admin token stays server-side)

### Collaboration
- `collaborative_edit_policies.sql`: any authenticated user can INSERT/UPDATE workflow tables (DELETE stays owner-scoped) — editing someone else's batch saves in place instead of forking a duplicate
- Library batch cards show "edited by <email>" (`lastEditedBy`/`lastEditedAt` stamped on auto-save)
- Batch/listing delete works on any batch (claims ownership before delete)

### Reliability
- Shared-storage-file guard (`storageSafety.ts`): deleting a batch no longer wipes files still referenced by a duplicated batch
- Batch reopen matches items by `productGroup` (was title/position — bled wrong images across products)
- Preset overrides persist across reloads (`applied_preset_id` column); 500 ms debounced field saves + `beforeunload` flush
- Image load errors no longer delete database rows; pick mode works with categorized singletons (ungroup→crop→regroup flow)

### UI
- Pick mode (auto-select next N ungrouped photos) + 1–10 quick-pick slider; columns-per-row slider (2–12)
- Density pass: 9 px base font (67%-zoom look at 100%), narrower right sidebar, rebalanced gutters

## 2026 H1 — Scale & Workflow Hardening (summary)

- TUS resumable uploads (6 MB chunks) for large batches on unreliable connections
- Canvas compression on upload (max 2000 px / JPEG 0.88) + bucket-wide recompression tools (~2.3 GB reclaimed)
- Crop/zoom tool in Step 3 with copy-crop → paste-crop across items; in-memory image cache
- EXIF `DateTimeOriginal` capture ordering + rescan backfill; original filename persistence and name sort
- Step 2: vertical sidebar, sort/filter bars, auto-group by N, select-all shortcuts, `Cmd+Enter` grouping
- Library: gap-fill recovery for corrupted batches, orphan cleanup, dedup fixes, newest-first sort
- Service Worker CDN image cache (stale-while-revalidate, 7-day TTL)
- Centralized debug logger with per-category colors and DOM event tracing
- Voice command table with inline editing; Shopify taxonomy mapping in CSV export

See `AGENTS.md` §15 for the exhaustive commit-by-commit record.

---

## [2025] - Natural Product Descriptions Update

### 🎯 Major Changes

#### Enhanced Product Fields
- Added **8 new fields** to product data structure:
  - `brand` - Manual brand entry (no auto-detection)
  - `condition` - Dropdown: NWT, Excellent, Good, Fair
  - `flaws` - Text input for transparency (e.g., "minor pilling on sleeves")
  - `material` - Fabric composition or "unknown"
  - `measurements` - 7 fields: pit-to-pit, length, waist, inseam, rise, shoulder, sleeve
  - `era` - Time period/vibe (e.g., "90s", "Y2K", "workwear")
  - `care` - Care instructions

#### Rewritten AI Description Generator
- **Removed banned phrases**: "perfect for any occasion", "timeless piece", "elevate your wardrobe", "must-have"
- **Fact-based descriptions**: Only uses provided data, no hallucinations
- **Natural conversational tone**: Sounds like a real person, not AI
- **Transparency**: Mentions condition and flaws honestly
- **Measurements included**: Builds trust and reduces returns
- **"Feels like" language**: Uses qualifiers for uncertain details (e.g., "Material feels like polyester")
- **Limited adjectives**: Max 6-10 adjectives for natural flow
- **All colors included**: Captures every color mentioned in voice description

#### Description Structure
1. **Opening**: Era + Brand + Colors + Category + Voice description
2. **Size & Fit**: Tagged size with fit notes
3. **Condition**: Honest assessment with any flaws mentioned
4. **Measurements**: Formatted list of all measurements
5. **Material**: Fabric info or "unknown" with transparency
6. **Care**: Instructions if provided
7. **Closing**: Helpful reminder to compare measurements

### 📋 Example Before/After

#### BEFORE (AI-sounding):
```
Discover this timeless Lakers jacket - a must-have piece that will elevate your wardrobe! 
Perfect for any occasion, this versatile piece offers unparalleled style and comfort. 
Don't miss this opportunity to own a piece of Lakers history!
```
❌ Problems: Banned phrases, no specifics, salesy tone, no useful info

#### AFTER (Natural):
```
Mid-2000s blue and white Lakers warmup jacket. Tagged XL, fits true to size with a 
roomy athletic cut.

Condition: Good vintage wear - minor pilling on sleeves, but no holes or stains.

Measurements:
• Pit to pit: 24"
• Length: 28"
• Sleeve: 26"

Material feels like polyester or nylon blend. Full zip, side pockets, elastic cuffs and 
waist. Machine wash cold. Compare measurements to your favorites!
```
✅ Benefits: Factual, specific, honest, helpful, natural tone

### 🎨 UI Improvements

Added comprehensive manual input fields:
- Brand text input
- Condition dropdown (4 options)
- Flaws text input
- Material input
- Era/Vibe input
- Care instructions input
- Measurements section (7-field grid layout)

All fields update the entire product group simultaneously for consistency.

### 🚫 Banned Phrases Filter

Implemented automatic filtering of:
- "perfect for any occasion"
- "timeless piece"  
- "elevate your wardrobe"
- "must-have"
- "wardrobe staple"
- "unparalleled"
- "investment piece"
- "holy grail"
- "game changer"

### 📈 Benefits

1. **Reduced Returns**: Measurements provide accurate fit info
2. **Increased Trust**: Honest condition and flaw disclosure
3. **Better SEO**: Natural language improves search rankings
4. **Avoids AI Detection**: Descriptions sound human-written
5. **Faster Approval**: No banned phrases to edit out
6. **Professional**: Builds credibility with transparency

### 🔧 Technical Details

- Updated `ClothingItem` interface in `App.tsx`
- Rewrote `handleGenerateProductInfo` function in `ProductDescriptionGenerator.tsx`
- Added helper functions: `removeBannedPhrases`, `formatMeasurements`, `formatCondition`
- Maintained all existing features (voice recognition, color detection, pricing)
- No breaking changes - backwards compatible with existing data

### 📚 Documentation Added

- `DESCRIPTION_BEST_PRACTICES.md` - Comprehensive 9-point guideline system
- `AI_PROMPT_IMPROVEMENTS.md` - Implementation details and examples

---

## Previous Updates

### v1.6 - Excel Export with Embedded Images
- Added ExcelJS library for .xlsx generation
- Images embedded directly in cells, not just file paths
- High-quality image compression and formatting

### v1.5 - GitHub Actions Deployment
- Automated deployment to GitHub Pages
- Custom domain support ready
- Build and deploy on every push to main

### v1.4 - Google Drive Integration
- Load images directly from shared Drive folders
- No downloads required - images processed in browser
- Batch import with progress tracking

### v1.3 - SEO Title Improvements
- Removed hard 70-character limit
- Smart word-boundary trimming
- Includes ALL colors and key features

### v1.2 - Console Cleanup
- Removed 19+ console.log statements
- Production-ready logging
- Cleaner browser console

### v1.1 - Color Organization Fix
- ALL colors now included in titles and descriptions
- Consistent color detection across fields
- Improved natural color combinations

### v1.0 - Initial Release
- React + TypeScript + Vite setup
- Voice recognition for product descriptions
- AI-powered description generation
- CSV and Excel export
- Google Sheets integration
- Category-based organization
