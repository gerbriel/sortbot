# 17 — Step 2 toolbar condensed

**Report:** "the Step 2 toolbar is too cluttered — simplify and condense it".
**Files touched:** `src/components/ImageGrouper.tsx`, `src/components/ImageGrouper.css`,
`AGENTS.md` (§10 tree block + one §15 bullet), `CHANGELOG.md` (one bullet), this file and
`docs/reviews/img-17/`. Nothing else — App.tsx, WorkspaceMenu, ShortcutsPanel and
ProductDescriptionGenerator all have uncommitted work in progress and were left alone.
**Nothing was committed.**

---

## 1. What it was

`.grouper-toolbar` rendered two rows, both unconditional, ~20 always-visible controls:

| Row | Contents |
|---|---|
| 1 | Sort (4 buttons) │ Filter: Groups, Singles, an all-dates `<select>`, Uncategorized + **one chip per category** │ Photos/item: number input + **a duplicate range slider** + Apply + Pick │ Columns slider │ (N selected · Undo · Redo) |
| 2 | Pick photos │ Rotate ⟲ │ Rotate ⟳ │ Copy Rot │ Copy Crop │ (+ status chip, Paste, Revert, Delete, Clear originals when applicable) |

Measured height at 1280 inside the `1fr 340px` `.step2-split` (873px of usable column —
the narrowest desktop case, and exactly where the columns slider wrapped): **131px**,
three wrapped lines plus the photo row.

## 2. What it is

**Idle row — always on, ONE line.** `Filter ▾` · `View ▾` · divider · Photos/item +
number + Apply + Pick · divider · `Pick photos` · (N selected · Undo · Redo, trailing).

**Contextual row** — the photo tools, rendered **only** when
`selectedItems.size > 0 || copiedRotation !== null || copiedCrop !== undefined`. With
nothing selected and nothing copied the row does not exist in the DOM at all, which is
what makes the idle toolbar a single line.

Measured at 1280 in the same split column: **34px**, one line,
`row.scrollWidth === row.clientWidth === 873` (no wrap, no overflow).

### Where every control went

| Control | Before | After |
|---|---|---|
| Sort ×4 (↑/↓ Date, ↑/↓ Name) | idle row, 4 buttons | **View ▾ → Sort**, a radio-style list of 4 full-width rows with a lucide `Check` on the active one; labels rewritten to "Date · oldest first", "Date · newest first", "Name · A → Z", "Name · Z → A". Data lives in module-scope `SORT_OPTIONS`. |
| Groups / Singles toggles | idle row | **Filter ▾ → Show** |
| Dates `<select>` | idle row | **Filter ▾ → Date** |
| Uncategorized + one chip per category | idle row (the main offender — unbounded width) | **Filter ▾ → Category**, chips wrap inside the panel |
| Clear filters | idle row | **Filter ▾ footer**, only when `activeFilterCount > 0` |
| Active-filter count | inline in the label text | a `.gtb-count` badge on the Filter trigger |
| Columns slider | idle row (this is what wrapped at 873px) | **View ▾ → Columns**, full width, value in the label |
| Clear N **all** originals | photo row, `margin-left:auto` | **View ▾ → Storage footer**, only when nothing is selected |
| Clear N **selected** originals | same button, scope chosen at click time | contextual row, `clearOriginalsCache('selected')` |
| Photos/item number + Apply + Pick | idle row | unchanged, idle row |
| **Photos/item range slider (1–10)** | idle row | **DELETED** — the number input is the only setter. ⌘1–9 / ⌘0 still write `autoGroupN` (that handler was not touched). |
| Pick photos | photo row (first control) | idle row — it is the gate that produces the selection the contextual row acts on |
| Rotate ×2, Copy Rot, Copy Crop, status chip + `clear`, Paste to N, Revert N, Delete N | photo row, always rendered | contextual row, same handlers / enable rules / titles / `.ptb-btn` classes |
| N selected · Undo · Redo | end of idle row | unchanged |

Nothing else changed: no handler, state name, enable rule, keyboard shortcut, pick-mode
or auto-group semantic was altered. The `Clear N all originals` action is the one thing
that moved *and* narrowed (it is now reachable only with nothing selected, which is when
its scope was `'all'` anyway).

## 3. Popover mechanics

One state, `openPanel: 'filter' | 'view' | null`, plus two trigger refs.

- **Not portaled, deliberately.** `.grouper-toolbar` is on the click-outside-deselect
  safe-selector list in `ImageGrouper.tsx` (~line 1153). A portaled panel would sit
  outside that subtree, so every click inside it — every filter chip — would wipe the
  user's selection. The panels are children of `.gtb-panel-wrap` inside the row.
- **Dismissal** copies the `openMenuGroupId` / `.group-menu` pattern: an outside
  `mousedown` (anything not inside `.gtb-panel-wrap`) closes it, and Escape closes it and
  returns focus to the trigger. A click *inside* the panel is left alone, so several
  filter chips can be toggled in one visit and picking a sort option leaves the panel up.
- **ARIA:** trigger gets `aria-haspopup="true"`, `aria-expanded`, `aria-controls`; the
  panel is `role="group"` with an `aria-label` ("Filter photos" / "View options").
- **Desktop layout:** wrap is `position: relative`; panel is `absolute; top: calc(100% +
  4px); left: 0; z-index: 70` (above the toolbar's 60), `--ink-800` surface,
  `1px solid var(--border)`, `var(--shadow-lg)`, radius 10px, padding 0.6rem,
  `min-width: 240px`, `max-width: min(380px, calc(100vw - 2rem))`, `max-height: 60vh`
  with `overflow-y: auto; overscroll-behavior: contain` — i.e. `.group-menu` one size up.
- **`justify-content: flex-start` on `.gtb-opt`** is load-bearing: `index.css` sets
  `button { justify-content: center }` globally, which centred all four sort rows (caught
  in the first screenshot round, fixed, re-shot).

### The phone case, which is the only subtle part

At ≤640px `.gtb-row` is a horizontal scroll strip (`overflow-x: auto`) carrying an
edge-fade `mask-image`. Two things would eat the panel:

1. **The row's overflow.** Solved by `.gtb-panel-wrap { position: static }` at ≤640px, so
   the panel's containing block becomes `.grouper-toolbar` (sticky, therefore positioned)
   — an absolutely positioned box whose containing block lies *outside* an overflow
   ancestor is not clipped by it. It also makes `left: 0; right: 0` span the toolbar
   rather than the ~90px trigger, which is what the design called for.
2. **The mask.** A mask groups every descendant, including one positioned against an
   outer ancestor, so the fade would clip the panel regardless of (1). `.gtb-row--panel-open`
   (added from React while `openPanel` is set) drops `mask-image`, which also drops the
   stacking context the mask created, so the panel's `z-index: 70` competes at the
   toolbar level again.

Both verified in the browser: at 390 the panel is 329px wide, `y=82 … bottom=399` against
a scroll box bottom of 428 — visible and unclipped.

## 4. CSS deleted / added

**Deleted** (grepped repo-wide first; zero consumers after this pass):
`.sort-control`, `.filter-bar`, `.auto-group-slider`, and the phone rules
`.gtb-row .auto-group-slider` / `.gtb-row .columns-slider` (the columns slider moved into
the panel, so its phone rule is now `.gtb-panel .columns-slider`).

**Kept** (still consumed, as instructed): `.sort-btn` (the triggers, Apply, Pick, Undo/Redo
and every panel chip), `.filter-select`, `.filter-clear-btn`, `.pick-mode-btn`,
`.auto-group-control/-input/-btn`, all `.ptb-*`, all `.stats*`.

**One tablet rule was widened:** `@media (max-width:1024px) and (min-width:641px)` gave a
36px floor to `.gtb-row .sort-btn/.filter-select/.auto-group-input` but not to `.ptb-btn`,
which was fine while `.ptb-btn` only lived in the second row. `Pick photos` now sits in the
idle row beside those controls, and measured **22.8px against their 36px** at 768 — so
`.gtb-row .ptb-btn` was added to that selector list. Caught by measurement, not by eye.

**Added:** `.gtb-panel-wrap`, `.gtb-trigger`, `.gtb-count`, `.gtb-panel`,
`.gtb-panel-section`, `.gtb-panel-chips`, `.gtb-panel-opts`, `.gtb-opt`, `.gtb-opt-mark`,
`.gtb-panel-select`, `.gtb-panel-foot`, `.gtb-row--panel-open`. Tokens only, no hex, every
font size through `--fs-*`, 44px written as the literal `var(--tap, 44px)` on phones.

**One pre-existing dead rule was left alone:** `.auto-group-label` (5 lines) had no
consumer *before* this pass either — the JSX has used `.gtb-label` for some time. It is
inside the explicit "keep `.auto-group-*`" fence in the brief, so it was not touched;
flagging it here as a one-line cleanup for whoever is next in this file.

## 5. Screenshots

Method is the established one (no harness can sign in): the logged-out landing page at
`http://localhost:5173/` loads the real app CSS bundle, and Step 2 fixture markup is
injected into it, so everything below is the **real cascade** with stand-in content.
Driver: `t17.mjs` in the session scratchpad (headless Chrome via CDP, DSF 2).

| File | What |
|---|---|
| `img-17/idle-1280-split.png` | the idle toolbar at 1280 inside the real `.step2-split` (`1fr 340px`) — **one line, 34px** |
| `img-17/filter-panel-1280.png` | Filter ▾ open: Show / Date / Category chips / Clear filters |
| `img-17/view-panel-1280.png` | View ▾ open: the four sort rows with the check, the columns slider, the Storage footer |
| `img-17/contextual-row-1280.png` | 4 photos selected — the "4 selected" chip appears and the contextual row is rendered (71px total) |
| `img-17/idle-768.png` | the idle toolbar at 768 (tablet) — one line, every control on the same 36px floor |
| `img-17/idle-390.png` | the idle toolbar at 390: one sideways scroll-snap strip, all targets ≥ 44px |
| `img-17/filter-panel-390.png` | Filter ▾ at 390, spanning the toolbar, escaping the row's scroller and mask |

### Measurements

| Width / context | Toolbar height | Idle row | Notes |
|---|---|---|---|
| 1280, `.step2-split` left column (873px) | **34px** (was **131px**) | 32px, one line | `scrollWidth === clientWidth === 873` |
| 1280, same, 4 selected | 71px | 32px | contextual row 37px + hairline |
| 1024 | 46px | 44px, one line | tablet 36px control floor |
| 768 | 46px | 44px, one line | every control 36px after the `.gtb-row .ptb-btn` fix below |
| 700 | 46px | 44px, one line | |
| 390 | 52px | 50px, one strip | `scrollWidth 581 > clientWidth 329` — the intended sideways scroll |

At 390, with and without the panel open: **zero controls under 44px**, **zero form
controls under 16px**, and `document.documentElement.scrollWidth === clientWidth === 390`
(no horizontal page overflow). Panel at 390: 329px wide, not clipped by the scroll box.

## 6. Gates

| Gate | Result |
|---|---|
| `npx vitest run` | **1109 passed (1109), 55 files** |
| `npm run build` | **clean** (only the pre-existing >500 kB chunk advisory) |
| `npx eslint .` | **252 problems** (236 errors, 16 warnings) — the recorded baseline, unchanged |

## 7. Not verified

- **No signed-in run.** Same standing limitation as every pass since the mobile-first one
  (AGENTS.md §14 #26): no agent can sign in, so the toolbar was verified from the real CSS
  against injected markup, not from React state. The *cascade*, the geometry and the
  overflow behaviour are real; the wiring (openPanel toggling, Escape focus return, the
  outside-mousedown close, the contextual row appearing on a real selection) is verified by
  reading the code and by `tsc`, not by clicking.
- **No real-iOS pass**, so the ≤640px panel's escape from the row's scroller + mask is
  confirmed in headless Chrome only. It relies on two well-specified behaviours (an
  abs-positioned box whose containing block is outside an overflow ancestor; masks grouping
  descendants), but WebKit has not been checked.
- **The fixture hardcodes 8 grid columns** at every width; the real app clamps to 3 on a
  phone via `responsiveGrid.ts`. That is a fixture artifact in `idle-390.png`, not a
  regression.
- **The lucide icons in the fixtures are hand-drawn stand-ins** at the same 12–13px box, so
  the measured row width is representative but not byte-exact against the real icon set.
  The headroom makes that immaterial: at 1280-split the controls up to the trailing cluster
  occupy **494px of the 873px row**, with the 60px selection/undo cluster pinned right —
  ~319px of slack, where the real icons differ by a few px of glyph width, not by a control.
  The one input that can still grow the row is the workspace's category list, and those
  chips now live inside the Filter panel where they wrap.
