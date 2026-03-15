# SortBot — AI Clothing Sorting & Export App

A React web application for sorting, grouping, and exporting clothing product images with AI-powered descriptions, voice transcription, and Shopify-ready CSV export.

---

## Features

- 📤 **Batch Image Upload** — Drag-and-drop upload of 100+ images at once
- 📦 **Product Grouping** — Group multiple images of the same product together in Step 2
- 🏷️ **Category Assignment** — Drag product groups onto category zones to assign and auto-apply presets
- 🎤 **Voice Descriptions** — Record audio, transcribe with Web Speech API, and generate AI product info
- 🤖 **AI Product Generation** — Auto-generate SEO titles, descriptions, tags, pricing, and policies
- 💾 **Supabase Backend** — Images, products, and batches persisted to Supabase (Postgres + Storage)
- 📚 **Library View** — Browse all saved images, product groups, and batches with search and drag-to-reassign
- 🛍️ **Shopify CSV Export** — Download a Shopify-compatible CSV for direct product import
- 🔄 **Workflow State** — Auto-saves progress so you can resume any batch

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + TypeScript |
| Build | Vite |
| Backend / DB | Supabase (Postgres, Storage, Auth) |
| Styling | CSS3 (component-scoped) |
| Speech | Web Speech API |
| AI | OpenAI API (GPT-4o) |
| Icons | Lucide React |

---

## Getting Started

### Prerequisites

- Node.js 18+
- A [Supabase](https://supabase.com/) project
- An [OpenAI](https://platform.openai.com/) API key

### Installation

```bash
git clone https://github.com/gerbriel/sortbot.git
cd sortbot
npm install
```

### Environment Variables

Create a `.env` file in the root:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-supabase-anon-key
VITE_OPENAI_API_KEY=your-openai-api-key
```

### Development

```bash
npm run dev
```

App runs at `http://localhost:5173`

### Production Build

```bash
npm run build
```

---

## Workflow

### Step 1 — Upload Images
- Drag and drop or click to select clothing images (JPG, PNG, WEBP)
- Images are uploaded to Supabase Storage

### Step 2 — Group & Categorize
- Images appear as individual items
- Select multiple images and click **Group Selected** to create a multi-image product group
- Drag a group card onto a **Category Zone** (right panel) to assign a category and auto-apply its preset (title template, tags, price, policies)
- Single items can also be dragged to a category zone
- Stats bar shows: multi-image groups · singles · total listings · total images

### Step 3 — Add Voice Descriptions & Generate Product Info
- Navigate listings with **Prev / Next**
- Click **Start Recording** and describe the product aloud
- Transcription appears in real time
- Click **Generate Product Info** to use AI to produce:
  - SEO title
  - Product description
  - Tags
  - Price
  - Policies
- Edit any field manually
- Click **Save Changes** to persist

### Step 4 — Review & Export
- See a summary: Total Products · Priced Items · Categories
- Preview all items in Shopify table format
- Click **Download CSV** to export a Shopify-compatible CSV

### Step 5 — Save & Export
- Products and images are saved to Supabase
- Batch progress is tracked (0–100%)

---

## Library

Access the **Library** from the main dashboard to manage all your saved data across three tabs:

| Tab | Shows |
|-----|-------|
| **Images** | All saved images, grouped by batch → product group |
| **Product Groups** | All product groups, grouped by batch |
| **Batches** | All workflow batches as cards with image/group counts |

### Library Features
- **Search** across titles, categories, and batch names
- **Rubber-band multi-select** — click and drag to select multiple items
- **Drag to reassign** — drag images between product groups, or drag groups between batches
- **Empty batches** show as drop targets in all three tabs
- **Unassigned section** at the bottom for items with no batch
- **Delete** individual images, groups, or entire batches
- **Duplicate** a batch
- **Rename** a batch inline
- **Open** a batch to resume working on it

---

## Project Structure

```
sortingapp/
├── src/
│   ├── components/
│   │   ├── ImageUpload.tsx               # Step 1: drag-and-drop upload
│   │   ├── ImageGrouper.tsx              # Step 2: group & categorize
│   │   ├── CategoryZones.tsx             # Step 2: category drop zones
│   │   ├── ProductDescriptionGenerator.tsx  # Step 3: voice + AI
│   │   ├── SavedProducts.tsx             # Step 4: review & export
│   │   ├── Library.tsx                   # Library view (all tabs)
│   │   ├── LazyImg.tsx                   # Lazy-loading image component
│   │   └── CategoryPresetsManager.tsx    # Manage category presets
│   ├── lib/
│   │   ├── supabaseClient.ts             # Supabase client
│   │   ├── libraryService.ts             # Fetch saved images/products
│   │   ├── workflowBatchService.ts       # Batch CRUD
│   │   ├── categoriesService.ts          # Category management
│   │   ├── applyPresetToGroup.ts         # Apply category preset to group
│   │   └── saveBatchToDatabase.ts        # Persist batch to Supabase
│   ├── App.tsx                           # Root component & workflow state
│   ├── App.css                           # Global styles
│   └── main.tsx                          # Entry point
├── supabase/
│   └── migrations/                       # DB schema migrations
├── .github/
│   └── copilot-instructions.md           # AI assistant instructions
├── .env                                  # Local env vars (not committed)
├── .env.example                          # Env template
└── package.json
```

---

## Database Schema (Supabase)

| Table | Purpose |
|-------|---------|
| `workflow_batches` | Batches with name, workflow_state JSON, progress |
| `products` | Saved product groups (title, category, price, tags, etc.) |
| `product_images` | Individual images linked to products |
| `categories` | User-defined categories with emoji, color, sort order |
| `category_presets` | Presets per category (title template, tags, price, policies) |

---

## Category Presets

Each category can have a preset that auto-fills:
- Title template (e.g. `{brand} {model} Hat - Vintage`)
- Tags
- Price
- Product type
- Policies

When a product group is dragged onto a category zone, the preset is applied automatically. Unfilled `{brand}` / `{model}` tokens are cleaned up in the Library display.

---

## Browser Support

| Feature | Chrome | Edge | Safari | Firefox |
|---------|--------|------|--------|---------|
| Voice recording | ✅ | ✅ | ✅ | ⚠️ Limited |
| Full app | ✅ | ✅ | ✅ | ✅ |

---

## License

MIT

