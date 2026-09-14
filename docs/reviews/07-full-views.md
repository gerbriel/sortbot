# 07 — Full views: the header tools stop being modals

Implemented against the working tree at commit `0cdfacd` (branch `main`, tree
already dirty from passes 01–06). Nothing was committed. No dependency added, no
`sortbot_*` key renamed, no `confirm()`/`prompt()` introduced.

**The request, verbatim:** *"instead of popups can these be full views? i want
each of them to have a less crammed feeling/layout when they open up to those
views. i feel like those pop ups are crammed and things are too close and don't
feel inviting to use."*

He was right about the cause, not just the feeling. Every one of the nine panels
was a `position: fixed` overlay holding a 640–1200 px box, and the padding inside
them was written in `rem` against the app's **9 px root** — so `0.35rem` was
**3 px**, `0.6rem` was **5 px**, and a "1.1rem" panel inset was **10 px**. The
panels were not badly designed; they were designed for a viewport they were never
given.

---

## 1. What was built

### 1.1 One `activeView`, six booleans deleted

`src/App.tsx` now has a single union (exported, because CLAUDE.md §6 documents it):

```ts
export type ActiveView =
  | 'workflow' | 'library' | 'categories' | 'presets'
  | 'vocabulary' | 'analytics' | 'crm' | 'board' | 'workspace';
```

`showLibrary`, `showCategoriesManager`, `showCategoryPresets`,
`showVocabDashboard`, `showKanban` and `showOrgPanel` are gone. Three helpers
replaced them:

| Helper | Job |
|---|---|
| `toggleView(view)` | Header button `onClick`. Opens the view, records the button in `viewTriggerRef` for focus restore, and returns to the workflow if that view is already showing. |
| `goToWorkflow()` | Back / Escape / a view's own `onClose`. `useCallback([])` — ToolView registers its Escape listener against it, and an unstable identity would re-register on every render. |
| `viewSetter(view)` | `useState`-shaped setter over `activeView`. Turning a view off only returns to the workflow if that view is the one showing. |

**Only `setShowLibrary` survived as a flag-shaped setter.** The brief anticipated
"many existing call sites", but after the rewrite exactly two remained —
`handleOpenBatch` (which closes the Library as a side effect of opening a batch)
and `onLibraryCloseStable`. The other five would have been dead code that fails
`tsc --noUnusedLocals`, so they were not kept. Two call sites inside the auth
effect and `handleSignOut` were switched to the raw `setActiveView('workflow')`
instead, which is both more honest (signing out should land on the workflow) and
lint-stable — a `useState` setter is exempt from `exhaustive-deps`, a helper
function is not.

`orgPanelOpenOn` / `initialToolsView` were removed rather than rewired: the
Analytics and CRM buttons now address their own views directly, and the account
menu's "Workspace dashboard" opens `'workspace'` on OrgPanel's default tab.

### 1.2 The workflow is parked, never unmounted

```tsx
<main className="app-main" hidden={activeView !== 'workflow'}>
```

`.app-main` is `display: flex`, which outranks the UA's `[hidden] { display:none }`,
so `App.css` pins `.app-main[hidden] { display: none }`. That one rule is
load-bearing; without it the workflow renders *underneath* every tool view.

Verified by reading the render: `ImageUpload` (upload queue + TUS resume),
`ImageGrouper` (selection, pick mode, sort/filter state) and
`ProductDescriptionGenerator` (500 ms + 800 ms save timers, `beforeunload`
/`pagehide` flush) all stay mounted with their state intact. `SupportWidget`,
the toast stack, the storage meter and the debug toggle sit outside `<main>` and
are visible in every view, as asked.

### 1.3 `ToolView` — the shell

`src/components/ToolView.tsx` + `ToolView.css` (new; `ToolView.test.tsx`, 8 tests).

```tsx
<ToolView icon={<Package size={26} />} title="Library" description="…"
          onBack={goToWorkflow} wide escapeToBack tabs={…} actions={…} />
```

- Title row: Back first, then icon + `<h1>` at `--fs-2xl`, optional actions right,
  one-line description at `--fs-base` in `--text-secondary`.
- On open: `window.scrollTo(top)` + focus the `<h1>` (`tabIndex={-1}`, with
  `:focus` ring suppressed and `:focus-visible` ring kept, so the programmatic
  focus does not paint a box nobody asked for).
- On Back: focus returns to the header button stored in `viewTriggerRef`, via
  `requestAnimationFrame` — focusing a node that is about to be detached drops
  focus to `<body>`.
- `wide` drops the 1400 px measure (Library, Board).
- `escapeToBack={false}` hands Escape to the child (Board).

---

## 2. Per component: what changed

Every component kept its `onClose` prop on its interface so App's call sites are
unchanged; Back is what calls it. Where the prop became genuinely unused it was
left off the destructuring rather than deleted (`CategoriesManager`,
`CategoryPresetsManager`, `Library`) — except `VocabDashboard`, whose props
object then held nothing at all, so the interface went with it.

| Component | Modal → page | Layout on the page | Behaviour touched |
|---|---|---|---|
| **CategoriesManager** | `.categories-manager-overlay` + `.categories-manager` + title bar + close button deleted. Its create/edit form was a **modal stacked on a modal** (`.category-form-overlay`, z-index 1001). | Two columns, `42rem` editor left / list right. The editor is permanently in view beside the list it edits; when no edit is open it shows a "New category" card with the Add button. Rows gained `min-height: 8rem` and `1.4rem 2rem` padding. | Icon picker changed from a hard `repeat(10, 1fr)` to `auto-fill minmax(5.5rem, 1fr)` — 10 fixed tracks in a narrower column squeezed the icons to slivers. Nothing else. |
| **CategoryPresetsManager** | Same, plus `.preset-form-overlay` / `.preset-form-modal` (the 800 px editor modal). | List left / editor right (`1fr` + `52rem`, source order swapped with `order`), editor sticky and self-scrolling so the list does not get pushed down the page. Gender chips + "Create new preset" became a toolbar row. | The open editor carries `data-tv-modal` so Escape cannot throw away a half-written preset. `FieldModal` stays a real modal (it edits one row *of* the editor) and carries the same attribute. |
| **Library** | `.library-modal` + `.library-content` + title bar + close button deleted. | Full width (`wide`). The batch/group/image count moved onto the tab row, where it describes the tab you are looking at. Tabs, selection toolbar (now sticky) and grids all rescaled; image thumbnails `180px → 240px` tracks with `290px` rows. | **The three grids deliberately keep `overflow-y: auto`** — see §3. `data-tv-modal` on the rename prompt. Rubber-band, drag-and-drop, merge, delete, bulk actions untouched. |
| **VocabDashboard** | `.vocab-overlay` / `.vocab-panel` / header / close deleted. | Toolbar row: scope badge + three tabs + a wide search field. List rows `0.4rem` → `1.2rem` padding with a `5rem` minimum and a hover surface; add-forms and chips to 4 rem controls. | None. Component now takes no props. |
| **OrgPanel** | `.org-panel-overlay` / `.org-panel` / close deleted. | **Tabs are a left rail** (`26rem` + content) on ≥1024 px, sticky under the header, stacking back to a chip row below that. Member rows, invite form, beta chips and search all to page scale. | **The "Founder tools" tab was removed**, with `toolsView` state and `initialToolsView`. The workspace name, rename pencil, plan and role badges stay as the view's own header. |
| **AnalyticsPanel** | Was a tab-inside-a-tab. Now the Analytics view's *Overview* tab. | KPI row (`20rem` auto-fit tiles, `--fs-3xl` values) → chart → tables two-up at `42rem` minimum. | Added `import './OrgPanel.css'` — it uses `org-*`/`ft-*`/`an-*` classes and no longer arrives in OrgPanel's chunk. |
| **ErrorsPanel** | Same. Now the Analytics view's *Errors* tab. | Same scale as Overview. | Same CSS import. |
| **CrmPanel** | Same. Now its own view. | Filters + list, with the expanded contact as a wide detail card (`auto-fit minmax(26rem, 1fr)` field grid on a recessed surface). | Same CSS import. |
| **KanbanBoard** | `.kanban-overlay` / `.kanban-panel` / close deleted. | Full width (`wide`), `height: calc(100vh - 30rem)`. Lanes `250px → 280px`, gaps `0.6rem → 1.5rem`. | `escapeToBack={false}` — the board already owned Escape (it closes an open card drawer first, `onClose` only when none is open). `.kanban-page` had to take `position: relative`: the card drawer is `position: absolute` and `.kanban-panel` used to be its positioned ancestor. |

---

## 3. Decisions worth arguing with

**Library's grids still scroll inside themselves.** The obvious move was
`overflow: visible` so the page scrolls as one. It would have broken rubber-band
selection: `handleMouseDown` and the mousemove handler compute coordinates from
`container.getBoundingClientRect()` **plus `container.scrollTop`**, and the edge
auto-scroll *writes* `container.scrollTop` — a no-op on a non-scrolling element.
The coordinate maths would still have been correct (a zero `scrollTop` is
harmless), but dragging a selection past the bottom edge would silently stop
scrolling. So the grids keep `overflow-y: auto` and got height
(`calc(100vh - 34rem)`, `min-height: 44rem`), real gutters and bigger cards
instead. This is the one place the "window inside a page" feeling survives; if it
still reads as cramped, the fix is to hoist the auto-scroll onto the window,
which is a behaviour change and did not belong in a layout pass.

**`.tool-view` uses `overflow-x: clip`, not `hidden`.** `overflow-x: hidden` with
`overflow-y: visible` computes the other axis to `auto`, turning the element into
a scroll container — which would have made every `position: sticky` inside it
(the Categories editor, the Presets editor, the Workspace tab rail, Library's
selection toolbar) resolve against a scrollport that never scrolls, i.e. never
stick. `clip` does not create a scrollport.

**`--tv-sticky-top: 8.5rem`.** `.app-header` is sticky at `z-index: 100` and about
6 rem tall, so every sticky element inside a tool view needs clearance or it
slides underneath. One variable on `.tool-view`, consumed with a literal fallback
by the four sticky rules across the tool CSS files.

**The header wordmark switches tag.** `const Wordmark = activeView === 'workflow'
? 'h1' : 'p'`. Without it a tool view has two `<h1>`s (the app mark and the view
title). This also required a `.app-header .app-wordmark` rule — and per CLAUDE.md
§1, anything added to the nav must set its own light colour. Which surfaced a
pre-existing bug, below.

**Escape has two exemptions.** It stands down when the event target is an
`input`/`textarea`/`select`/`contenteditable` (so an inline rename can still
cancel with it), and while any `[data-tv-modal]` is in the document. Without the
second, pressing Escape over the preset editor would have navigated away from a
half-written preset.

---

## 4. Pre-existing bug found, NOT fixed

`src/App.css:55` — `.app-header h1 { color: var(--text-primary) }` sits *after*
the `.app-header, .app-header h1, … { color: #ffffff }` group at the same
specificity, so it wins. `--text-primary` is `#000000` and the nav is
`#000000`: **the "Acadia" wordmark is black on black.** The `.app-wordmark` rule
this pass added sets `color: #ffffff`, so the mark is now visible again as a side
effect — but the `h1` element rule is untouched and will bite anything else that
puts an `h1` in the nav. Flagging rather than editing, because the `src/components/ui/`
redesign is mid-flight in the same tree.

Also observed, not touched: `CategoryPresetsManager.css` defines global `.button`,
`.button-secondary`, `.button-danger`, `.form-group` etc. — a fourth conflicting
`.button` definition (see `04-ui-system.md`), which now leaks globally the moment
the Presets view is opened, exactly as it did when it was a modal. And the gender
chips in that view still use emoji (👔 👗 🧒), which §1 forbids; both are for the
UI-primitive adoption pass.

---

## 5. What I could not verify

**Nothing was verified visually.** This environment cannot sign in to Supabase —
the app requires an authenticated session for all nine views, there is no
headless browser available, and adding one would break the no-new-dependencies
rule. The dev server was left running and returns 200, and the built CSS/JS is
correct by inspection, but **no screenshot of any tool view was taken and no
rendered layout was seen.** Specifically unverified:

- Whether `8.5rem` is the right sticky clearance for the real header height.
- Whether `calc(100vh - 34rem)` (Library grids) and `calc(100vh - 30rem)` (Board)
  land well on a real viewport — both are arithmetic against an estimated header
  + title-block height.
- Whether the two-column splits (Categories, Presets, Workspace rail) feel right
  at their chosen widths, or want more/less.
- Whether the white `.nav-tool-btn--on` chip reads correctly against the black nav
  next to the outlined inactive buttons.
- Drag-and-drop, rubber-band and the Board's card drawer were reasoned about from
  the source, not exercised.

These are all single-number CSS adjustments; none of them is structural.

---

## 6. Gates

| Gate | Before | After |
|---|---|---|
| `npm test` | 505 / 35 files | **513 / 36 files** (8 new, `ToolView.test.tsx`) |
| `npm run build` | clean | **clean** |
| `npx eslint .` | 254 problems | **254 problems** (unchanged; no findings on any line this pass touched) |

Files changed: `src/App.tsx`, `src/App.css`, and the `.tsx`/`.css` pairs for
CategoriesManager, CategoryPresetsManager, Library, OrgPanel, VocabDashboard,
KanbanBoard, plus a one-line CSS import in AnalyticsPanel / CrmPanel /
ErrorsPanel. Added: `ToolView.tsx`, `ToolView.css`, `ToolView.test.tsx`.
Docs: CLAUDE.md §5 (ToolView + revised component entries), §6 (route map
rewritten), one §15 bullet. `git diff --stat` shows no file outside that set
changed by this pass.
