# 10 — Mobile-first workflow: Steps 1–4

**The direction, verbatim:** *"think mobile first for user experience."* A
reseller's photos live on their phone, so Step 1 is the most natural mobile
action in the whole product, and Steps 2–4 have to at least be usable there.

Built against the working tree at `c60e437` (branch `main`). Nothing committed.
No dependency added. `src/App.tsx`, `index.css`, `index.html`, ToolView,
SupportWidget, Landing and Auth were **not** touched — two other agents were
editing in parallel. The only shared file edited is `src/App.css`, and every line
of it is inside one clearly fenced block appended at the END of the file
(`▼▼▼ MOBILE WORKFLOW BLOCK ▼▼▼`); no existing rule was reflowed or reformatted.

Breakpoints used throughout: **≤1024px tablet, ≤640px phone**, matching the other
two agents. Layout at 641px and up is unchanged — every layout rule added here
lives inside a media query, and the handful of unconditional declarations are
`touch-action` / `-webkit-tap-highlight-color`, which are inert on a mouse.

---

## 0. Gates

| Gate | Before | After |
|---|---|---|
| `npm test` | 570 passing | **579 passing** (40 files) — +9 from `responsiveGrid.test.ts` |
| `npm run build` | clean | **clean** (`tsc -b && vite build`) |
| `npx eslint .` | 254 problems (238 errors, 16 warnings) | **254** — unchanged, none on lines this pass touched |

The two `[css-syntax-error]` warnings esbuild prints during minify come from
`src/components/MobileNav.css` (another agent's new file — a comment containing a
literal `*/`). Not from anything here.

---

## 1. Files changed

| File | What |
|---|---|
| `src/components/responsiveGrid.ts` | **new.** Pure column-clamp helpers (§2). |
| `src/components/responsiveGrid.test.ts` | **new.** 9 unit tests. |
| `src/components/ImageUpload.tsx` | Camera + photo-library inputs and the phone action block. |
| `src/components/ImageUpload.css` | Phone drop zone. |
| `src/components/ImageGrouper.tsx` | Phone flag, clamped grid columns, Tools disclosure. |
| `src/components/ImageGrouper.css` | Toolbar, grid, cards, menus, touch contracts. |
| `src/components/CategoryZones.tsx` | 5 styling hooks (`has-selection`, `cz-*`). No behaviour. |
| `src/components/CategoryZones.css` | Chip rail. |
| `src/components/ProductDescriptionGenerator.tsx` | `.preview-nav-dock` wrapper around the existing nav. |
| `src/components/ProductDescriptionGenerator.css` | Nav dock, voice, chips, crop touch, VCT card list. |
| `src/components/ComprehensiveProductForm.css` | One-column fields, 44px controls. |
| `src/components/GoogleSheetExporter.tsx` | One class on the price-gate banner. |
| `src/components/GoogleSheetExporter.css` | Frozen first column, phone sizing. |
| `src/App.css` | One appended block: step-region rules only. |

`LazyImg` and `LoadingProgress` needed no change — neither holds a tap target,
and `LoadingProgress` is already `width: 90%; max-width: 600px` with its own
768px query.

---

## 2. The one piece of JS logic added, and why it could not be CSS

The Step 2 grid applies its column count as an **inline** `grid-template-columns`
(it is driven by the columns slider). Inline styles beat every media query, so a
phone layout for that grid is not expressible in CSS at all — a `!important`
override would work but would turn the slider into a no-op, which the brief
explicitly rules out.

So the clamp happens where the value is produced. `src/components/responsiveGrid.ts`
is pure, dependency-free and unit-tested:

- `gridColumnBounds(isPhone)` → `{min: 1, max: 3}` on a phone, `{min: 2, max: 12}`
  otherwise. The slider gets this range, so it keeps working — it just has a
  phone-sized travel.
- `clampGridColumns(requested, isPhone)` → the stored preference is **never
  mutated**, so rotating back to a wide viewport restores the user's density.
  The stored default of 8 renders as 3 at 390px (≈105px cards).
- `clampGroupGridColumns` caps product-GROUP cards at 2 — a group card carries a
  header bar plus a thumbnail strip, so at 3-up its thumbnails fall to ~24px.

`ImageGrouper` gets one `matchMedia('(max-width: 640px)')` listener to feed
`isPhone`. That is the only new runtime behaviour in this pass; everything else
is CSS.

---

## 3. Step 1 — ImageUpload

**Camera-capture wiring.** Two separate hidden inputs, both feeding the **exact
same `processFiles` pipeline** as the existing drop zone (compress → EXIF →
chunked TUS upload). Nothing in the upload or DB-write strategy was touched.

```
<input type="file" accept="image/*" capture="environment" multiple />   → cameraInputRef
<input type="file" accept="image/*"                      multiple />   → libraryInputRef
```

Both use the existing `handleFolderChange` handler (renamed only in its comment;
it was already just `processFiles(Array.from(files))` + input reset).

Two inputs rather than one with a toggled attribute, deliberately: `capture` is a
*hint*, and on some Android builds an input that carries it stops offering the
gallery entirely. Separate elements make "Take photos" and "Choose from library"
each mean exactly one thing.

**At ≤640px** the drop zone becomes a 260px tap target. The drag copy ("Drag &
drop clothing images here" / "or click to select files" / the ZIP hint) is hidden
— it is meaningless on a touch device — and replaced by phone copy plus the two
52px-tall buttons. Both buttons `stopPropagation()` on click: they sit inside
react-dropzone's root, whose own `onClick` would otherwise open the generic
picker *behind* the camera sheet.

The folder/ZIP buttons live in App.tsx's Step 1 header, which is out of scope, so
the phone copy stands on its own ("Folder and ZIP import are in the buttons
above") and the header itself is restacked from the App.css block: column layout,
full-width row, 44px buttons — styled as `.step-section .step1-header*` so the
selector is anchored on a step region and cannot collide with the header/nav
agent.

**Panels.** Progress, failed-upload and compression panels are block children of
a `width: 100%` container, so they already stack full-bleed; the only thing added
is `overflow-wrap: anywhere` so a long failed filename cannot push the panel
wider than the screen. **The EXIF-rescan panel no longer exists** in this
component — it was removed when the rescan became automatic on batch open
(AGENTS.md §15), so there was nothing to stack. The storage meter is rendered by
App.tsx and was left alone.

---

## 4. Step 2 — ImageGrouper + CategoryZones

### 4.1 Sidebar → top toolbar (≤640px)

Verified: the sidebar already collapses at ≤768px (AGENTS.md §15). What it did
*not* do was fit. Stats, 4 sort buttons, view toggles, a date select, N category
buttons, a clear button, the auto-group input + Apply + Pick + slider, and the
columns slider all rendered inline — roughly a full screen before the first
photo.

- **Stats** stay visible always (they are the "where am I" readout) but scroll
  sideways in a nowrap rail instead of wrapping into four stacked rows. Undo/Redo
  inside the rail get a full 44px target.
- **Everything else** collapses behind a phone-only **"Sort, filter & group
  tools"** disclosure (`toolsOpen` state → `.grouper-header--tools-open`). The
  toggle renders at every width but is `display: none` above 640px, and every
  rule that reads the class lives inside the phone media query, so the desktop
  sidebar is byte-identical.
- When open, the sheet's controls are full-width and ≥44px: sort buttons stack,
  filter toggles become a 2-up grid, and **the date select is full-width, 44px
  and `--fs-md`**.
- The toolbar is deliberately **not sticky**. The app's own black nav is
  `position: sticky; top: 0; z-index: 100`, so a second sticky bar at `top: 0`
  slides underneath it and reads as having vanished.

### 4.2 Grid and touch

- 3 columns at 390px via the clamp in §2; the slider still works over 1–3.
- `touch-action: pan-y pinch-zoom` on `.items-grid`, `.groups-grid` and
  `.grouper-scroll-content`. `pinch-zoom` is kept on purpose — dropping it (which
  plain `pan-y` would) breaks WCAG 1.4.4 on a screen full of small garment
  photos. Declaring any value other than `auto` also kills the 300ms double-tap
  delay, which is what makes tap-to-select feel instant.
- `touch-action: manipulation` on cards, chips, toolbar buttons and menu items.
  The intersection with the grid's value is `pan-y pinch-zoom`, i.e. scroll and
  pinch still work, double-tap zoom does not.
- Cards get `user-select: none` + `-webkit-touch-callout: none` so a long press
  during a multi-select does not raise iOS's "Save Image…" sheet.
- `.grouper-scroll-content` stays its own 56vh scroller rather than flowing into
  the page — that is what lets `.photo-toolbar` stick to the top of a box the
  black nav can never cover. Noted as a trade-off in §8.
- Photo toolbar: wrapping (not sideways-scrolling, so no action is ever hidden
  off-screen), 44px buttons, dividers dropped, status line on its own row.
- Group cards: select bar 44px, `⋯` button 44×44, menu items 44px. The menu is
  capped at 150px so a right-aligned dropdown on a 2-up card (~162px at 390px)
  cannot spill past the scroll container's left edge and get clipped.
- Group thumbnail strip drops from 4-up to 3-up.
- The "drag photos here to make them individual items" strip is hidden: HTML5
  drag-and-drop does not fire on touch, so it is a dead target.
- Hover-reveal controls (the per-photo revert button) are pinned visible, since
  nothing hovers on a phone.

### 4.3 Category assignment → a bottom dock

Desktop assigns by dragging a group card onto a zone. That path simply does not
exist on touch. The phone path is the **second, already-supported** one: select
photos, then tap a category.

`.step2-split` becomes `display: block` at ≤640 and `.step2-right-panel` becomes
`position: sticky; bottom: var(--tabbar-h, 0px)` — the last child of a block box,
which is what gives a sticky-bottom element travel. Inside it, CategoryZones'
vertical `.category-list` becomes a horizontally scrolling chip rail of 44px
category chips, and the Group/Ungroup/Delete actions become a 2-up button grid.

- The gender pills stay (they change *which* categories are listed — navigation,
  not decoration). The heading and the free-text category search are hidden: in a
  bottom dock a text field summons the keyboard directly over the dock it belongs
  to, and the rail is already scrollable.
- Idle the dock is capped at 26vh (just the rail); with a selection it grows to
  38vh and reveals the actions. That is driven by a new `has-selection` class on
  `.category-zones-container` read through `:not(:has(…))`. Written in that
  direction on purpose: an engine without `:has()` drops the selector as invalid
  and the dock stays expanded — the safe failure, since the buttons are disabled
  at 0 selected anyway.

**Sticky, not fixed — and this is the important one.** All four step sections are
mounted simultaneously (App.tsx renders each behind a length check, not as
routes). Two `position: fixed` bottom bars — this one and Step 3's — would sit
permanently stacked on top of each other, and both would still float over Steps 1
and 4. Sticky binds each dock to its own section: it pins while you are inside
that step and scrolls away when you leave.

Both docks anchor at `bottom: var(--tabbar-h, 0px)`, the shared token another
agent introduced in `index.css` for the phone tab bar (it already carries the
home-indicator inset and is `0px` above 640px). **This is a cross-agent
dependency:** if that tab bar is dropped, the fallback keeps the docks at the
viewport bottom but they lose the safe-area inset on a notched iPhone.

---

## 5. Step 3 — PDG + form + voice table

### 5.1 Nav → sticky bottom bar

Prev / counter / Next / group slider / Download CSV are wrapped in a new
`.preview-nav-dock`. Above 640px that wrapper is **`display: contents`** — it
generates no box at all, so the three children remain direct flex children of
`.product-preview` and desktop layout is untouched.

At ≤640px `.product-editor` becomes a flex column, `.product-preview` becomes
`display: contents`, and the dock / image area / form become three siblings
ordered by `order` (image 1, form 2, dock 3). That is what lets the dock be
sticky across the **whole** editor — image *and* form — rather than being trapped
in the preview card, which would have made Prev/Next disappear the moment you
started editing fields. The card styling moves onto `.preview-scroll-area` so
nothing is lost visually. DOM order is unchanged, so tab order is unchanged.

Prev/Next are 48px. The dock is a rounded floating bar rather than full-bleed:
bleeding to the screen edge needs a negative margin sized to ancestor padding
this file does not own, and a wrong guess is a horizontal page scroll.

### 5.2 Touch decisions — what was adapted, what was disabled

| Feature | Decision | Why |
|---|---|---|
| **Crop / zoom tool** | **Adapted** — works on touch | It already runs on Pointer Events with `setPointerCapture`; the only thing missing was a gesture contract. `touch-action: none` on `.crop-fs-stage` (correct there and nowhere else: it *is* the gesture surface, it lives in a full-screen modal, it has nothing to scroll). Corner/edge handles get a 44px invisible hit area via `::after` while the painted handle stays small, so the rect still looks precise. Cancel/Done/ratio pills go to 44px. |
| **Magnifier lens** | **Disabled** on touch-only devices | It is driven purely by `mousemove` over the preview, so on a device with no mouse the lens can never track a finger. Gated on `@media (hover: none) and (pointer: coarse)` — not on width, so a touchscreen laptop keeps it — and the *settings control* is removed too rather than left as a toggle that does nothing. |
| **Rubber-band selection** (Step 2) | Left mouse-only | A tap fires one `mousedown` + `mouseup` at the same point and never meets the drag threshold, so it cannot fire by accident. |
| **Drag-to-categorize / drag-to-reorder** | Left desktop-only | HTML5 DnD does not exist on touch. The tap-a-category path (§4.3) is the replacement. |

### 5.3 The rest of Step 3

- Preview image full-width, capped at 52vh.
- Start/Stop Recording: full-width, 56px, `--fs-md`, bold. It is *the* phone
  action in this step.
- Quick-keyword chips wrap at 44px.
- Fields stack to one column (`.fields-row`), measurements 2-up, inputs 44px.
- **Voice command table → 2-up card list.** This also fixes a real bug: the grid
  template is set inline as `repeat(N, minmax(90px, 1fr))`, so a 5-column row
  demanded 450px and pushed the whole **page** into a horizontal scroll on a
  390px screen. `!important` is the only way to beat an inline style.
- Textarea min-height reduced to 160px; thumbnails 4-up.

---

## 6. Step 4 — GoogleSheetExporter

- The 54-column preview already scrolls in its own container with an inline
  sticky header row. Added: a **frozen first column** (Handle) at ≤1024px, with
  the header cell at `z-index: 3` so it outranks both the sticky header row
  (`z: 2`, inline) and the sticky body cells (`z: 1`). Scoped to ≤1024 so desktop
  rendering is untouched.
- `overscroll-behavior-x: contain` + `touch-action: pan-x pan-y` on the
  container, so panning the table sideways never chains into the page.
- **Download button:** there is no longer one inside this component (it is
  triggered by ref from the Step 3 dock, and Step 4's own buttons live in
  App.tsx's `.batch-actions`). Those are made full-width / 48px from the App.css
  block, and the Step 3 dock's Download CSV button was already `width: 100%`.
- **Price-gate banner** got a class (`.export-price-gate`) and moves from
  `--fs-sm` to `--fs-base` at ≤640 — it is the one thing in Step 4 a user must be
  able to read and act on.
- Summary stat cards go 3-up; instructions and the sheet-URL group stack.

---

## 7. Horizontal page scroll — the audit

Every wide thing is contained:

| Element | Containment |
|---|---|
| 54-column CSV preview (`min-width: 4800px`) | `.table-container` `overflow: auto` (inline) |
| Voice command table | **was overflowing** — fixed, §5.3 |
| Stats rail | `overflow-x: auto` on `.stats` |
| Category chip rail | `overflow-x: auto` on `.category-list` |
| Crop ratio pills | already `overflow-x: auto` |
| `.grouper-header` (210px fixed) | `width: 100% !important` |
| Group `⋯` menu | capped at 150px < card width |
| `.measurements-grid` / `.summary-stats` / `.thumbnail-grid` (all `auto-fit, minmax(120–150px)`) | replaced with explicit `repeat(N, minmax(0, 1fr))` |

No negative margins were used on any bottom-anchored surface, for exactly this
reason.

---

## 8. Deliberate deviations from the brief

1. **Step 3 form section headers are NOT `position: sticky`.** A sticky
   sub-header at `top: 0` slides under the app's own sticky black nav (`z-index:
   100`), whose height is owned by another surface and varies with header
   wrapping — so it would read as simply disappearing, and any hard-coded `top`
   offset would be a guess that breaks when the nav changes. Instead
   `.form-section-title` becomes a full-bleed tinted strip with a bottom rule, so
   it stays an obvious section boundary while scrolling a long form. The reason
   is repeated in a comment at the rule itself.
2. **The Step 2 photo grid keeps its own inner scroller** (56vh) rather than
   flowing into the page. Nested scrollers on a phone are not ideal, but this is
   what lets `.photo-toolbar` stick to the top of a box the black nav cannot
   cover. Revisit if/when a `--app-header-h` token lands.
3. **The Step 2 dock is always present**, not only when items are selected — it
   collapses to a 26vh chip rail when idle instead of disappearing. The rail *is*
   the primary assign affordance; hiding it entirely would leave a phone user
   with no visible way to categorize.

---

## 9. Proposals — NOT implemented (they touch selection logic)

Per the brief, anything needing a change to the Step-2 selection handlers is
written down rather than done. AGENTS.md §15 lists nine separate commits fixing
that code and I cannot sign in to smoke-test.

1. **Add `.grouper-header` to the click-outside safe-selector list**
   (`ImageGrouper.tsx` ~line 1013). Today a mousedown on neutral toolbar chrome
   clears the whole selection. That was harmless when the toolbar was a sidebar
   off to the left; on a phone it is a wide strip directly above the grid, so a
   mis-tap silently wipes a selection the user just built. One selector added to
   an existing string — low risk, but it is selection logic.
2. **Consider a `pointerdown`-based selection path.** Selection currently runs on
   `onMouseDown`, i.e. on the browser's *synthesized* mouse event. That is
   reliable (one tap = one `mousedown`, so the 200ms per-item double-fire
   debounce cannot swallow it) and is why no change was needed, but a native
   `pointerdown` path would remove the dependency on mouse-event emulation
   entirely.
3. **A "done selecting" affordance in the dock.** With pick mode off, a phone
   user has no clear signal that tapping a category consumes the selection. The
   dock's `N items selected` hint covers it partly.

---

## 10. Unverified

I cannot sign in, so **nothing here was rendered, screenshotted or exercised in a
browser.** Everything below was reasoned per breakpoint and kept additive inside
media queries; the only executable part is the column-clamp helper, which is
unit-tested. Specifically unverified:

- Real camera/gallery behaviour of `capture="environment"` on iOS Safari and
  Chrome Android, including multi-select from the camera roll.
- Whether the two sticky docks and the other agent's `--tabbar-h` tab bar stack
  correctly in practice at Step 2 → Step 3 boundaries.
- `display: contents` on `.product-preview` under the real Step 3 tree (verified
  by reading the JSX; the card styling handoff to `.preview-scroll-area` is a
  visual judgement).
- Actual measured tap targets (44px is asserted by CSS, not measured).
- `:has()` behaviour of the dock collapse on the founder's actual browser.
- The 56vh grid scroller vs 26–38vh dock budget on a short phone (e.g. iPhone SE
  at 667px) — the numbers add up on paper but want a real look.
- Crop-on-touch end to end (pinch is not supported; it is single-finger drag and
  handle-drag only).

---

## Summary

- Step 1 now has real phone capture: **Take photos** (`capture="environment"`)
  and **Choose from library**, both feeding the unchanged `processFiles` pipeline.
- Step 2's sidebar becomes a compact top toolbar with a "Tools" sheet; the grid
  clamps to 3 columns at 390px with the slider still live; category assignment
  moves to a sticky bottom chip rail, because drag-to-categorize cannot exist on
  touch.
- Step 3's Prev/Next/slider/CSV become a sticky bottom bar spanning image *and*
  form; voice recording becomes a 56px primary button; the voice table stops
  forcing a horizontal page scroll.
- Step 4 freezes the Handle column in the 54-column preview and makes the
  price-gate banner readable.
- **Crop was adapted, not disabled** — it already used Pointer Events and only
  needed `touch-action: none` plus 44px handles. **The magnifier was disabled**
  on mouse-less devices; it is a `mousemove` feature with no touch equivalent.
- One JS helper added (`responsiveGrid.ts`, 9 tests) because the grid's column
  count is an inline style that no media query can reach.
- Gates: **579 tests pass**, build clean, lint **254 = baseline**. No commits, no
  dependencies, no changes to grouping/saving logic.
