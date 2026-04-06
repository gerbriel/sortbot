# CLAUDE.md — Sortbot Codebase Reference

> **For any AI agent reading this file:**
> 1. Read this file **in full** before writing any code.
> 2. After every task, report: what files were modified, what moved from in-progress to done, and what new gaps were introduced.
> 3. Check this file before assuming any type, utility, or component doesn't exist — it probably does.
> 4. Ask before adding any new dependency.
> 5. Ask before running any Supabase migration SQL. Several migration files in `supabase/migrations/` are **dangerous** (they modify RLS policies or drop constraints). Never run them without explicit user approval.

---

## 1. Project Identity

Sortbot is a web app for vintage clothing resellers. Users upload batches of clothing photos (individual files, folders, or ZIPs), group multi-angle photos of the same item together, assign categories, record a voice description per listing, and generate AI-powered Shopify-ready product listings. The final output is a CSV export formatted for Shopify product import. The app persists work-in-progress to Supabase (workflow_batches table) so sessions survive page reloads and can be reopened from a Library modal. It is designed as a shared workspace — all authenticated users currently see all batches and images in the Library, controlled via Supabase RLS.

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
| `eslint` | ^9.39.1 | Linting. Config in `eslint.config.js`. |
| `@vitejs/plugin-react` | ^5.1.1 | Vite plugin enabling React JSX transform and Fast Refresh. |

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

**No automated tests exist.** There is no test runner, no test files, no `test` script in `package.json`.

**Deployment:** GitHub Actions deploys to GitHub Pages at `https://gerbriel.github.io/sortbot` on every push to `main`. The workflow file is in `.github/workflows/`. `vite.config.ts` detects `process.env.GITHUB_ACTIONS` to set `base: '/sortbot/'`.

**Local Llama proxy:** `huggingface-proxy.cjs` is a standalone Express server for AI image analysis. Run separately with `node huggingface-proxy.cjs`. It is **not part of the Vite build** and not required for most features.

---

## 4. Environment Variables

| Variable | Required | Where Consumed | Purpose |
|---|---|---|---|
| `VITE_SUPABASE_URL` | **Required** | `src/lib/supabase.ts` line 3 | Supabase project URL. Throws hard error on load if missing. |
| `VITE_SUPABASE_ANON_KEY` | **Required** | `src/lib/supabase.ts` line 4 | Supabase anon/public API key. Throws hard error on load if missing. |
| `VITE_OPENAI_API_KEY` | Optional | `src/services/api.ts` line 18 | OpenAI key for `generateProductDetails()`. Falls back to mock data if absent. This path is not the active AI description path — see `textAIService.ts`. |
| `VITE_GOOGLE_VISION_API_KEY` | Optional | `src/components/AISettings.tsx` line 23 | Controls whether Google Vision option appears in AI settings dropdown. The actual Google Vision integration is not functional in current code. |
| `VITE_GOOGLE_CLIENT_ID` | Optional | Referenced in `.env.example` only. Not found in `src/`. | Dead variable — no Google Drive or Sheets OAuth in current code. |
| `VITE_GOOGLE_API_KEY` | Optional | Referenced in `.env.example` only. Not found in `src/`. | Dead variable. |
| `VITE_APP_PASSWORD` | Optional | Referenced in `.env.example` only. Not found in `src/`. | Dead variable — password protection not implemented. |
| `VITE_DISABLE_AUTH` | Optional | Referenced in `.env.example` only. Not found in `src/`. | Dead variable. |

---

## 5. Folder Structure

```
sortingapp/
├── src/
│   ├── App.tsx                    # Root component. Owns ALL global state. 1380 lines. Orchestrates all 4 steps.
│   ├── App.css                    # Global app styles.
│   ├── main.tsx                   # Entry point. Renders <App /> in StrictMode.
│   ├── index.css                  # Base CSS reset and body styles.
│   ├── assets/                    # Static assets (empty or unused).
│   ├── components/
│   │   ├── Auth.tsx               # Email/password sign-in and sign-up form. Uses Supabase auth directly.
│   │   ├── Auth.css
│   │   ├── ImageUpload.tsx        # Step 1. Drag-drop, folder, and ZIP import. Uploads to Supabase Storage.
│   │   ├── ImageUpload.css
│   │   ├── ImageGrouper.tsx       # Step 2 left panel. Multi-select, rubber-band, group/ungroup, delete.
│   │   ├── ImageGrouper.css
│   │   ├── CategoryZones.tsx      # Step 2 right panel. Drag groups onto categories. Loads categories from DB.
│   │   ├── CategoryZones.css
│   │   ├── ProductDescriptionGenerator.tsx  # Step 3. Voice recording, AI generation, field editing. 1636 lines. Has cursor-following magnifier lens on main preview image.
│   │   ├── ProductDescriptionGenerator.css
│   │   ├── ComprehensiveProductForm.tsx     # Sub-form within Step 3 for all product fields. No local state.
│   │   ├── ComprehensiveProductForm.css
│   │   ├── GoogleSheetExporter.tsx          # Step 4. Generates Shopify-format CSV and triggers download.
│   │   ├── GoogleSheetExporter.css
│   │   ├── Library.tsx            # Modal overlay. Shows all batches, groups, images. 2478 lines. Batches displayed newest-first (client-side sort by updated_at DESC after fetch).
│   │   ├── Library.css
│   │   ├── CategoriesManager.tsx  # Modal for CRUD on user categories.
│   │   ├── CategoriesManager.css
│   │   ├── CategoryPresetsManager.tsx  # Modal for CRUD on category presets (shipping defaults, SEO templates).
│   │   ├── CategoryPresetsManager.css
│   │   ├── LazyImg.tsx            # Image component with skeleton shimmer placeholder. Used throughout.
│   │   ├── LoadingProgress.tsx    # Upload progress bar shown in Step 2 during AI analysis.
│   │   ├── LoadingProgress.css
│   │   ├── SavedProducts.tsx      # UNUSED in current App.tsx. Legacy product browser. Not rendered anywhere.
│   │   ├── SavedProducts.css
│   │   ├── AISettings.tsx         # Dropdown to pick AI provider (Google vs Llama). Persists to localStorage.
│   │   ├── AISettings.css         # Neither provider is actually active in the step-by-step flow.
│   │   ├── TestLlamaVision.tsx    # Dev/debug component for testing Llama vision. Not rendered in App.tsx.
│   │   ├── TestLlamaVision.css
│   │   ├── LiveWorkspaceSelector.tsx  # Presence-based dropdown to switch whose workspace you're viewing.
│   │   ├── LiveWorkspaceSelector.css  # Not rendered in App.tsx — feature built but not wired in.
│   │   ├── RemoteCursors.tsx      # Renders floating cursor overlays for other users. Not rendered in App.tsx.
│   │   └── RemoteCursors.css
│   ├── constants/
│   │   └── fieldLimits.ts         # Shopify character limits (SEO_TITLE=70, DESCRIPTION=5000, etc.) and helpers.
│   ├── hooks/
│   │   └── useUserPresence.ts     # Supabase Realtime presence hook. Broadcasts cursor, step, action. Not used in App.tsx.
│   ├── lib/
│   │   ├── supabase.ts            # Supabase client + full TypeScript Database type definitions for all tables.
│   │   ├── debugLogger.ts         # Centralized debug logger. exports dbg(), log.X() category wrappers, setDebugEnabled(), isDebugEnabled(). Zero-cost when disabled (window.__SORTBOT_DEBUG__ guard). Attaches DOM event listeners (click, drag, keyboard, scroll, focus, input, selection) when enabled. Persists toggle state to localStorage key 'sortbot_debug_enabled'.
│   │   ├── workflowBatchService.ts  # CRUD for workflow_batches table. autoSaveWorkflowBatch, fetchWorkflowBatches (ordered updated_at DESC — newest first), delete.
│   │   ├── productService.ts      # CRUD for products + product_images tables. saveBatchToDatabase, updateProduct, syncGroupFieldsToDatabase. getThumbnailUrl() returns plain CDN URL (no Supabase transform — requires paid plan).
│   │   ├── libraryService.ts      # fetchSavedProducts, fetchSavedImages (paginated, 1000/page). Delete operations for Library.
│   │   ├── exportLibraryService.ts  # Types and DB functions for export_batches + export_batch_items tables. Partially implemented.
│   │   ├── categoriesService.ts   # CRUD for categories table. getCategories, createCategory, deleteCategory, reorderCategories.
│   │   ├── categoryPresets.ts     # TypeScript types for CategoryPreset, MeasurementTemplate, CustomSection.
│   │   ├── categoryPresetsService.ts  # CRUD for category_presets table.
│   │   ├── applyPresetToGroup.ts  # Applies a CategoryPreset to a ClothingItem array. SEO title template interpolation.
│   │   ├── categories.ts          # Category type + DEFAULT_CATEGORIES constant (7 defaults).
│   │   ├── textAIService.ts       # Core AI service. extractFieldsFromVoice(), generateProductDescription(). 841 lines.
│   │   ├── brandCategorySystem.ts # 160+ brand/category taxonomy. BrandCategory type + MODEL_DATABASE.
│   │   ├── brandMatcher.ts        # Matches voice description text to brands + models using BRAND_DNA databases.
│   │   ├── vintagePatternEngine.ts  # 5000+ brand/team cultural knowledge base. BRAND_DNA Record. 1443 lines.
│   │   ├── vintagePatternExpansion.ts   # Expansion 1 of BRAND_DNA (more brands).
│   │   ├── vintagePatternExpansion2.ts  # Expansion 2 of BRAND_DNA.
│   │   ├── vintagePatternExpansion3.ts  # Expansion 3 of BRAND_DNA.
│   │   ├── vintagePatternExpansion4.ts  # Expansion 4 of BRAND_DNA.
│   │   ├── colorDatabase.ts       # Color name/alias lookup.
│   │   ├── constructionDatabase.ts  # Garment construction keyword lookup.
│   │   ├── fitConditionDatabase.ts  # Fit and condition keyword lookup.
│   │   └── huggingfaceService.ts  # Calls local proxy (localhost:3001) for Llama vision. Not used in production.
│   └── services/
│       └── api.ts                 # OpenAI fetch wrapper + mock fallback for generateProductDetails(). 521 lines. Not the active description path.
├── supabase/
│   ├── schema.sql                 # Original schema (may be outdated — not all columns present here).
│   └── migrations/                # 25+ migration SQL files. Many are one-off fixes. NOT tracked by Supabase CLI.
│       └── shared_workspace_rls.sql  # ⚠️ DANGER: Sets "all users see all rows" SELECT policies. Has been run in Supabase dashboard.
├── public/                        # Static public assets served by Vite.
├── dist/                          # Build output. Generated by `npm run build`. Do not edit.
├── .env                           # Local environment variables. NOT committed.
├── .env.example                   # Template for env vars.
├── vite.config.ts                 # Vite config. Sets base path for GitHub Actions deployment.
├── tsconfig.json                  # TypeScript root config.
├── tsconfig.app.json              # TypeScript config for src/ (browser target).
├── tsconfig.node.json             # TypeScript config for vite.config.ts (Node target).
├── eslint.config.js               # ESLint config (flat config format, eslint 9+).
├── package.json                   # Dependencies and scripts.
├── huggingface-proxy.cjs          # Standalone Express proxy for Llama vision API. Run separately. Not part of Vite build.
├── index.html                     # Vite entry HTML. Mounts to #root.
├── check-and-run-migration.js     # One-off migration helper script. Not part of app.
├── check-collaborative-changes.js # One-off helper script. Not part of app.
├── run-collaborative-migration.js # One-off migration runner. Not part of app.
├── run-categories-migration.sh    # Shell script for categories migration. Not part of app.
├── database_migration_csv_fields.sql  # Ad-hoc migration SQL at root. Not in supabase/migrations/.
├── fix_orphaned_product.sql       # Ad-hoc fix SQL at root. Not in supabase/migrations/.
├── test-db-connection.html        # Standalone HTML test file. Not part of app.
└── proxy.log                      # Log file from huggingface-proxy. In .gitignore — never committed.
```

**Dead/unused components** (exist in `components/` but not rendered in `App.tsx`, each marked with `// UNUSED` banner): `SavedProducts.tsx`, `TestLlamaVision.tsx`, `LiveWorkspaceSelector.tsx`, `RemoteCursors.tsx`, `AISettings.tsx`.

---

## 6. Route Map

This app has **no router**. It is a single-page application with no URL routing. All navigation is state-driven conditional rendering in `App.tsx`.

| View | Condition | Component |
|---|---|---|
| Loading screen | `loading === true` | Inline JSX in App.tsx |
| Auth screen | `!user` | `<Auth />` |
| Step 1: Upload | Always (when authed) | `<ImageUpload />` |
| Step 2: Group+Categorize | `uploadedImages.length > 0` | `<ImageGrouper />` + `<CategoryZones />` side by side |
| Step 3: Descriptions | `sortedImages.length > 0` | `<ProductDescriptionGenerator />` |
| Step 4: Save+Export | `processedItems.length > 0` | Inline buttons + `<GoogleSheetExporter />` inside `<details>` |
| Library modal | `showLibrary === true` | `<Library />` overlay |
| Categories Manager modal | `showCategoriesManager === true` | `<CategoriesManager />` overlay |
| Category Presets modal | `showCategoryPresets === true` | `<CategoryPresetsManager />` overlay |

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
| `workflow_state` | JSONB | Contains `{ processedItems: SlimItem[] }` only in new format. See `slim()` in App.tsx. |
| `thumbnail_url` | TEXT | First item's imageUrls[0] at save time. |
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

**⚠️ Write strategy (critical):** `registerItemsInDB` in App.tsx uses **delete-then-insert** (not upsert) to keep product_images in sync. It deletes ALL rows for the product IDs in the batch, then inserts fresh. This prevents stale row accumulation when storage URLs change between sessions.

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

### TypeScript Types

#### `ClothingItem` (defined in `src/App.tsx`, exported)
The central runtime type. Has ~60 fields. Key fields:
- `id: string` — UUID generated at upload time. Stable across all steps.
- `file: File` — Raw File object. **Stripped by `slim()` before saving to DB.** null when restored from DB.
- `preview: string` — Blob URL (upload time) or Supabase CDN URL (after upload). **Stripped by `slim()`.** Reconstructed from `storagePath` on restore.
- `thumbnailUrl?: string` — Supabase Storage CDN URL (plain, no transform). Built at restore time from `storagePath` via `getThumbnailUrl()`. Used by ImageGrouper card `<img>` tags. Falls back to `imageUrls[0]` for legacy items. **Stripped by `slim()` (not in the slim type) — OK, rebuilt on restore.** Note: Supabase Storage image transforms (resize/crop) require the paid Pro plan — `getThumbnailUrl()` intentionally returns the plain CDN URL to avoid transform errors on the free tier.
- `imageUrls?: string[]` — Array of full-resolution CDN URLs. Index 0 = primary image. **Stripped by `slim()`.** Reconstructed on restore.
- `storagePath?: string` — Supabase Storage path. **Preserved by `slim()`.** The only reliable image reference after a restore.
- `productGroup?: string` — ID of the group leader item. All items sharing a group card have the same value.
- `_presetData?: {...}` — Cached preset metadata. **Stripped by `slim()`.** Runtime-only.

#### `WorkflowBatch` (defined in `src/lib/workflowBatchService.ts`)
Mirrors the `workflow_batches` DB row. `workflow_state` field is typed as `{ uploadedImages?, groupedImages?, sortedImages?, processedItems? }` but in practice only `processedItems` is ever populated (the other arrays are saved as `[]`).

#### `SlimItem` (defined in `src/lib/workflowBatchService.ts`)
Minimal version of ClothingItem stored in `workflow_state.processedItems`: `{ id, productGroup?, category?, storagePath?, imageUrls? }`. All other fields are omitted by `slim()`.

---

## 8. State Management Map

All state lives in `App.tsx`. There is no global store (no Redux, no Zustand, no Context).

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
| `processedItems` (local copy) | `ClothingItem[]` | `ProductDescriptionGenerator.tsx` | `setProcessedItems` inside PDG | Synced back to App via `onProcessed` | **Duplicate source of truth.** PDG has its own internal copy. Sync-back is suppressed during resets via `isResettingRef`. |

**⚠️ Multiple sources of truth:** `processedItems` exists both in App.tsx and inside `ProductDescriptionGenerator.tsx`. They sync via prop-down / callback-up. If they diverge (e.g. during a batch switch), `isResettingRef` in PDG suppresses the write-back for one render cycle to prevent overwriting the newly loaded data.

---

## 9. External Integrations & APIs

### Supabase
- **Auth:** Email/password via `supabase.auth.signInWithPassword` / `signUp`.
- **Database:** Postgres via PostgREST. Tables: `workflow_batches`, `products`, `product_images`, `categories`, `category_presets`.
- **Storage:** Bucket `product-images`. Path pattern: `{userId}/{productId}/{timestamp}-{random}.{ext}`. Public bucket.
- **Realtime:** Presence channel `workspace-presence` used in `useUserPresence` and `LiveWorkspaceSelector`. Not wired into App.tsx in current code.
- **RLS:** `shared_workspace_rls.sql` has been run. All authenticated users can SELECT all rows. Users can only INSERT/UPDATE/DELETE their own rows (user_id check). The app does NOT add `.eq('user_id', ...)` filters on reads — it relies entirely on RLS.
- **Quirks:** PostgREST caps rows at 1000 per request. `fetchSavedProducts` and `fetchSavedImages` paginate with `range()` to bypass this.

### Hugging Face / Llama Vision
- Calls `http://localhost:3001/api/llama-vision` (local proxy).
- **Not functional in production deployment** (GitHub Pages cannot reach localhost).
- Used only for the dev test component `TestLlamaVision.tsx`.

### OpenAI
- `src/services/api.ts` calls `https://api.openai.com/v1/chat/completions` with `gpt-4`.
- Requires `VITE_OPENAI_API_KEY`.
- This is **not the active description generation path**. Active path is `textAIService.ts → generateProductDescription()` which uses Hugging Face Inference API directly without a key requirement.
- Falls back to mock data if key is absent.

### Web Speech API
- `ProductDescriptionGenerator.tsx` uses `window.SpeechRecognition` / `window.webkitSpeechRecognition` directly.
- Works in Chrome and Edge. Not supported in Firefox or Safari.
- Continuous mode, interim results enabled.
- Speech auto-corrects common misrecognitions (e.g. "with 18 inches" → "width 18 inches").

---

## 10. Core Features & How They Work

### Step 1: Image Upload
**Files:** `ImageUpload.tsx`, `App.tsx:handleImagesUploaded`

1. User drops images, selects a folder (`webkitdirectory`), or drops/selects a ZIP.
2. ZIPs are extracted via JSZip, preserving `lastModified` from zip entry dates.
3. Files are sorted by `lastModified` (capture date order).
4. Images are uploaded to Supabase Storage in chunks of 10, in parallel within each chunk.
5. Storage path: `{userId}/{productId}/{timestamp}-{random}.{ext}`.
6. Each image becomes a `ClothingItem` with `{ id, file, preview (CDN URL), imageUrls: [url], storagePath }`.
7. `onImagesUploaded` fires → App.tsx appends to `uploadedImages`, creates a new `batchId` if none exists, upserts stub rows to `products` and `product_images`.
8. `autoSaveWorkflow` is triggered (2s debounce).
9. **Side effect:** `libraryRefreshTrigger` incremented — Library reloads.

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
- `applyPresetToProductGroup()` is called: fetches matching preset from DB, applies default shipping/measurement/SEO fields to items.
- `onCategorized` fires → App.tsx updates `sortedImages`, `processedItems`.

### Step 3: Voice Descriptions & AI Generation
**Files:** `ProductDescriptionGenerator.tsx` (1616 lines), `textAIService.ts`, `ComprehensiveProductForm.tsx`

- `processedItems` are grouped by `productGroup`. Navigation is per-group (one listing at a time).
- **Voice:** User clicks "Start Recording". Web Speech API runs continuously. Transcription appears live.
  - Voice commands parsed: `"brand Nike period"`, `"size large period"`, `"price 45 period"`, etc. (`extractFieldsFromVoice()`)
  - Measurement fields populated from `"width 18 period"`, `"length 28 period"`, etc.
  - Non-command speech goes into the description text.
- **AI generation:** `generateProductDescription()` in `textAIService.ts` calls Hugging Face Inference API (text-only, no vision). Takes voice description + all extracted fields and returns a formatted Shopify-style listing.
- `ComprehensiveProductForm` renders all ~50 product fields as form inputs. Edits propagate to all items in the same `productGroup` simultaneously via `updateGroupField()`.
- Category presets can be applied per-listing via a dropdown, applying default values without overwriting existing voice-set fields.
- On every change, `onProcessed(processedItems)` fires back to App.tsx (auto-save triggers).
- **DB side effect:** `syncGroupFieldsToDatabase()` called from PDG saves changed fields to the `products` table immediately (not just on "Save Batch").

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
- Builds one product row per group, with multiple `Image Src` columns for multi-image products.
- Deduplicates titles with sequential suffixes (" 2", " 3", etc.).
- Strips unresolved `{token}` placeholders from all fields.
- Outputs Shopify product import CSV format.
- **Does not call any API.** Pure client-side CSV generation.

### Library
**Files:** `Library.tsx` (2478 lines), `libraryService.ts`, `workflowBatchService.ts`

- Modal overlay opened from header. Fetches data on open and when `refreshTrigger` increments.
- `loadAll()` is the single fetch entry point:
  1. `fetchWorkflowBatches()` — gets all batches (shared workspace, no user filter).
  2. `fetchSavedProducts()` + `fetchSavedImages()` — paginated, parallel, no user filter.
  3. Builds `imageList` in two passes:
     - **Pass 1:** workflow_state items (authoritative). Reconstructs CDN URLs from `storagePath` for slim items. Marks batch as "covered."
     - **Pass 2:** DB `product_images` rows, only for batches NOT covered by workflow_state.
  4. Builds `productGroups` list similarly.
  5. Batches missing from `workflow_batches` but present in `products` are synthesized.
- Three tabs: Images, Product Groups (labeled "listings"), Batches.
- Click batch → `onOpenBatch(batch)` → `handleOpenBatch()` in App.tsx.
- `isLoadingRef` prevents overlapping fetch calls. `force=true` bypasses it for mount calls.

### Auto-Save
**Files:** `App.tsx:autoSaveWorkflow`, `workflowBatchService.ts:autoSaveWorkflowBatch`

- Debounced 2 seconds. Called after every significant state change.
- Saves only `processedItems` (slim format — `file`, `preview`, `_presetData` stripped).
- Uses `currentBatchIdRef` (not `currentBatchId` state) to avoid stale closure.
- If batchId is null (session not yet resolved), skips silently.
- If batch no longer exists in DB, creates a new batch.
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

### `slim()` in App.tsx (line ~685)
```typescript
const slim = (items: ClothingItem[]): ClothingItem[] =>
  items.map(({ file: _f, preview: _p, _presetData: _pr, ...rest }) => rest as ClothingItem);
```
Strips `file`, `preview`, and `_presetData` before saving to `workflow_state`. This keeps the JSONB payload small. **The consequence:** after any page reload, `preview` and `imageUrls` are empty on restored items. Every code path that reads restored items MUST reconstruct them from `storagePath` using `supabase.storage.from('product-images').getPublicUrl(storagePath).data.publicUrl`. This reconstruction happens in: startup restore, `handleOpenBatch`, Library's `loadAll` pass 1.

### `autoSaveWorkflow` saves ONLY ONE LIST
The auto-save stores only the most-progressed list as `processedItems`, with the other three arrays set to `[]`. The fallback chain on restore is: `processedItems → sortedImages → groupedImages → uploadedImages`. Never break this chain. If you add a new array to `workflow_state`, you must also add it to the fallback chain in `handleOpenBatch` and startup restore.

### `registerItemsInDB` uses delete-then-insert
`product_images` rows for a batch are **deleted** before inserting fresh ones. This prevents stale row accumulation from sessions where the public URL changed. Do NOT change this back to upsert without understanding why it was changed. See commit `a14876d`.

**Chunk size (`DELETE_CHUNK_SIZE = 100`):** The delete is done in chunks of 100 product IDs at a time. PostgREST has a URL length limit that causes a 400 error when `IN(...)` clause exceeds ~794 IDs. Chunking prevents this. Do NOT remove the chunking loop.

### `handleOpenBatch` double-fire guard
`isOpeningBatchRef` prevents the function from running twice simultaneously (React StrictMode double-invokes). If you restructure this function, ensure the guard is still in place. The lock is released in `finally {}`.

### `batchIdsCoveredByWfState` in Library `loadAll`
Pass 1 adds a batch's ID to this Set when workflow_state has items. Pass 2 skips any `product_images` DB rows for covered batches. This prevents double-counting. Do NOT remove this logic or Library image counts will inflate.

### `productGroup` is a UUID pointing to the group leader's item ID
When grouping items, all items in the group receive `productGroup = firstItem.id`. The "leader" is the item whose `id === productGroup`. In `saveBatchToDatabase`, items are grouped by this field and one `products` row is saved per unique `productGroup`. Breaking this invariant breaks the entire export pipeline.

### Magic number: `2000` (autoSave debounce)
The auto-save debounce is 2000ms. This was tuned to avoid a race where PDG's `onProcessed` fires rapidly during batch switches. Do not reduce below 1000ms.

### Magic number: `24 * 60 * 60 * 1000` (orphan product search window)
`handleOpenBatch` searches for orphaned products within ±24h of the batch creation time. This is a fallback when `batch_id` was not set on products. It's a broad heuristic that could match wrong products if multiple batches were created close together.

---

## 12. Component Dependency Map

### `App.tsx` (1380 lines)
The root of everything. It is doing far too much:
- Auth management
- Batch lifecycle (create, restore, save, clear)
- All 4 step orchestrations
- Auto-save logic
- `registerItemsInDB` (writes to DB)
- `handleOpenBatch` (300+ line function)
- All state that flows down to every component

**What depends on App.tsx:** Every component.
**What App.tsx depends on:** `workflowBatchService`, `productService`, `supabase` directly, all step components.

### `ProductDescriptionGenerator.tsx` (1616 lines)
Also doing too much:
- Voice recording lifecycle
- AI generation
- Per-item field editing (ComprehensiveProductForm embedded)
- Group navigation
- Preset application
- DB sync on every change (`syncGroupFieldsToDatabase`)
- Photo reorder within a group
- Lightbox

**Risk:** Has its own internal `processedItems` state that must stay in sync with App.tsx. Changes here can silently diverge if `isResettingRef` logic is broken.

### `Library.tsx` (2478 lines)
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
- Component errors: `try/catch` with console.error, silent fallbacks. No error boundaries.
- No user-facing error toasts for most failures — errors are silent.

### Two Conflicting Patterns for DB Writes
- `registerItemsInDB`: delete-then-insert for `product_images`.
- `handleImagesUploaded` upload path: upsert with `ignoreDuplicates: true` for `product_images`.
- **Follow the delete-then-insert pattern** for writes that happen after a full restore/open. Use upsert with `ignoreDuplicates: true` only for fresh first-time upload writes where no stale rows can exist.

---

## 14. Known Bugs & Fragile Areas

1. **Startup restore always calls `registerItemsInDB`** even if the batch was just viewed and nothing changed. This deletes and re-inserts all `product_images` rows on every page refresh. Not harmful but wasteful.

2. **`getCategories()` in `categoriesService.ts` has no user_id filter** — it returns all active categories from all users. This is intentional for the shared workspace but means custom categories created by one user are visible to all users.

3. **`SavedProducts.tsx` is dead code** — not rendered anywhere in App.tsx. It has its own `fetchUserProducts` calls and duplicate UI logic.

4. **`services/api.ts` is a second AI description path** that is never called in the active flow. `textAIService.ts` is the active path. `api.ts` is dead for the main workflow.

5. **`workflow_state` type mismatch:** `WorkflowBatch.workflow_state.processedItems` is typed as `ClothingItem[] | SlimItem[]` but SlimItem only has 5 fields. Code that reads processedItems from workflow_state must cast carefully. Many places cast with `as ClothingItem[]` which is technically incorrect for slim items.

6. **`batch_name` is null in many batches** — saved as `null` (not a string) and the code doesn't consistently handle this. `batchName="null"` appears in logs. Any display code must use `batch.batch_name || 'fallback'`.

7. **`autoSaveWorkflow` captures stale closure state** — it receives a `workflowState` parameter that was current at call time, but the 2s debounce means it fires after further state changes. The `slim(live)` picks the most-progressed list, which partially mitigates this, but the passed `workflowState` object may be stale.

8. **Photo reorder in Step 3 (PDG) is not persisted to DB.** Reordering thumbnails changes `imageUrls` array order in `processedItems` but this is only saved to `workflow_state` via auto-save. The `product_images.position` column in the DB is not updated.

9. **`proxy.log` is in `.gitignore`** and never tracked by git. Safe to ignore.

10. **`productService.ts:saveProductToDatabase` upserts on `id`** — fixed. Calling "Save Batch" multiple times now updates the existing row instead of creating duplicates.

11. **`initializeItems` in `ImageGrouper.tsx` previously had a stale-closure bug** — the `useEffect([items])` captured `groupedItems` at effect-creation time. Every `items` prop change would see stale (often empty) `existingIds`, treating all items as "new" and triggering the loading spinner. Fixed by adding `groupedItemsRef` (commit `fe22a7e`).

12. **Rubber-band `useEffect` has `[isSelecting]`-only dep array with an `eslint-disable` comment.** The exhaustive-deps lint rule would want all refs in the array, but refs are stable references — adding them would not change behavior and would re-introduce the listener churn bug. The comment is intentional.

13. **`handleApplyPreset` routes through `handleImagesSorted` (not `handleImagesGrouped`).** This means a preset-button click sets `category` on the items, which shows them in the CategoryZones panel and advances the workflow. If you ever need to apply a preset WITHOUT setting a category, a new code path is needed.

14. **Ref mirror pattern is now canonical for all async handlers in App.tsx.** `sortedImagesRef`, `groupedImagesRef`, `uploadedImagesRef`, and `processedItemsRef` are updated every render. Any NEW handler added to App.tsx that reads these arrays inside an async callback or `setTimeout` MUST read from the ref (e.g. `sortedImagesRef.current`) not the state variable, to avoid the same stale-closure category-overwrite bug fixed in commit `aae35fc`.

---

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
- ✅ Dead components (`SavedProducts`, `TestLlamaVision`, `LiveWorkspaceSelector`, `RemoteCursors`, `AISettings`) marked with `// UNUSED` banners
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
- ✅ All `console.log` calls removed from entire codebase (174 calls across 8 files: `App.tsx`, `Library.tsx`, `ImageGrouper.tsx`, `ImageUpload.tsx`, `ProductDescriptionGenerator.tsx`, `ImageSorter.tsx`, `workflowBatchService.ts`, `libraryService.ts`). Variables that existed solely to feed removed log calls also cleaned up (`withStoragePath`, `withImageUrls`, `imgCount`, `action`, `count`, `multiCount`, `wfItems`). (commit `9021611`)
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
- ✅ Startup restore DB image fallback — 24 items had no `storagePath` AND no `imageUrls` in slim data (uploaded before storagePath was preserved), so the synchronous `getPublicUrl(storagePath)` reconstruction returned `''`; startup restore now detects these no-URL items after the initial map, fetches their `product_images` rows in one query (`SELECT product_id, image_url, storage_path, position WHERE product_id IN (...)`), builds an `imgMap` + `pathMap`, and patches each item with the DB-sourced `imageUrls`, `preview`, and `thumbnailUrl` before setting state; a `[App] startup restore | DB image fallback | fixed=N stillMissing=N` log line reports the result; `handleOpenBatch` already had this coverage via the `savedProducts` products-table JOIN (commit `65851bb`)

---

## 16. What's In Progress or Missing

| Item | Status | Notes |
|---|---|---|
| Real-time collaboration cursors | Built but not wired | `RemoteCursors.tsx`, `useUserPresence.ts`, `LiveWorkspaceSelector.tsx` all exist and compile but are not rendered in App.tsx. |
| AI image vision analysis | Broken in production | `huggingfaceService.ts` calls `localhost:3001` — not available on GitHub Pages. `AISettings.tsx` exists but is not rendered. |
| Google Drive / Sheets integration | Dead | Env vars present in `.env.example` but no implementation in `src/`. |
| Export library tracking | Partial | `exportLibraryService.ts` defines types and DB functions for `export_batches` table but no UI renders it. |
| Batch duplication | Wired in Library service | `duplicateBatch()` exists in `libraryService.ts` and button exists in Library UI, but behavior after duplication is not fully tested. |
| Photo reorder persistence | Missing | Reorder in Step 3 changes in-memory order but does not update `product_images.position` in DB. |
| Automated tests | Missing | No test runner, no test files. |
| `SavedProducts` component | Dead | Exists but not rendered. Overlaps with Library functionality. |
| `TestLlamaVision` component | Dev-only | Not rendered in production App.tsx. |
| Error boundaries | Missing | No React error boundaries anywhere. |
| Loading state for Library tabs | Partial | `loading` state shown at top level but individual tab switches have no loading indicator. |

---

## 17. Before Marking Any Task Done

Run these commands and confirm all pass:

```bash
# 1. TypeScript must have zero errors
npm run build
# (runs tsc -b && vite build — any type error fails the build)

# 2. Lint must have zero errors
npm run lint

# 3. Manual smoke test checklist:
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
```

---

## 18. Do Not

1. **Do not add `.eq('user_id', ...)` filters to `fetchWorkflowBatches`, `fetchSavedProducts`, or `fetchSavedImages`.** The shared workspace intentionally shows all users' data. RLS handles permissions. Per-user filtering was deliberately removed.

2. **Do not run `supabase/migrations/shared_workspace_rls.sql` again** unless intentionally changing the shared workspace policy. It drops existing per-user SELECT policies and replaces them with "all authenticated users see all rows."

3. **Do not change `registerItemsInDB` back to upsert for `product_images`.** The delete-then-insert strategy prevents stale row accumulation. This was a deliberate fix after rows inflated from 816 to 1747.

4. **Do not add new arrays to `workflow_state`** without updating the restore fallback chain in BOTH `handleOpenBatch` AND the startup restore `useEffect`. Forgetting either will silently discard that data on reload.

5. **Do not call `slim()` without understanding what it strips.** It removes `file`, `preview`, and `_presetData`. Any code that reads from `workflow_state` must handle items where these three fields are undefined/empty.

6. **Do not save `file` (the File object) to any DB column.** File objects cannot be serialized. `slim()` exists precisely to strip them before any DB write.

7. **Do not use `loadAll` in Library without the `cancelRef` pattern.** React 18 StrictMode double-mounts components. Without `cancelRef`, you get two concurrent fetches that stomp each other's state.

8. **Do not add a second auto-save trigger inside Library.** Auto-save must ONLY refresh the Library on actual DB writes (`products/product_images`), not on `workflow_state` saves. Adding a Library refresh to `autoSaveWorkflow` would create an infinite loop: autoSave → Library reload → component re-render → autoSave.

9. **Do not remove the `isOpeningBatchRef` guard from `handleOpenBatch`.** React StrictMode will double-invoke it. Without the guard, `registerItemsInDB` races with itself, corrupting DB state.

10. **Do not store blob URLs (`URL.createObjectURL(...)`) in the DB.** Blob URLs are session-local. Only Supabase Storage CDN URLs should ever be written to `image_url` or `workflow_state`. Blob URLs appear as fallbacks in preview only when a Supabase upload fails.

11. **Do not directly mutate `processedItems` inside `ProductDescriptionGenerator`** outside of `setProcessedItems`. The `processedItemsRef` is a read-only snapshot for async handlers. Mutating the ref directly will cause silent bugs.

12. **Do not use `confirm()` or `prompt()` in new code.** Library already uses an inline modal replacement for `prompt()`. `handleClearBatch` still uses `confirm()` — that is a known inconsistency, but do not add new native dialog calls.
