# 16 — Step 2: photo piles, and one toolbar row on top

Founder brief, verbatim:

> (a) "Revise the images in Step 2 so instead of tiles/cards they are set to little
> piles: when they get grouped together they create a stack, where only one shows up
> on top and the rest are behind it but can get clicked to expand the stack."
>
> (b) "Make filter + sort features in the top-left bar on Step 2 into one long row of
> options on top of Step 2" / "remove them from the Step 2 left-hand bar".

Files owned by this pass: `src/components/ImageGrouper.tsx` + `.css`,
`src/lib/stackLayout.ts` + `.test.ts`. `App.css` was **not** touched (another agent
was editing it concurrently) — see *Left for the App.css owner* at the end.

---

## 1. The stack model

### What a group looks like now

A multi-photo group renders as a **pile**, not a fan:

- the **leader** (`items[0]` — already the first-shot photo, sorted by filename then
  `capturedAt` in the existing `sortGroupItems`) sits on top at full card size;
- up to **two more layers** peek out behind it, each translated down-right and
  rotated a couple of degrees with alternating sign;
- anything deeper than three photos is a **`+N` badge** in the bottom-right, where
  N counts the photos the pile could *not* draw (a 5-photo group reads `+2`);
- the group's **select bar and `⋯` menu are unchanged** — same check circle, same
  count badge, same Copy crop / Paste crop / Ungroup / Delete group… menu.

Clicking anywhere on the pile (not the select bar) **fans it open in place** into
the existing `.group-images` layout: every photo, drag-to-reorder, double-click
lightbox, plus a `↩` **remove-from-group** button per photo and a full-width
**Collapse** bar underneath.

### Geometry lives in `src/lib/stackLayout.ts` (pure, 19 tests)

```
STACK_MAX_LAYERS = 3      STACK_OFFSET_X/Y = 7px      STACK_ROTATE_STEP = 2.6°
STACK_COMPACT_SCALE = 0.7 (≤640px)

stackLayers(count, {compact, maxLayers}) -> StackLayer[]   // BACK-TO-FRONT
stackReserve(count, …)  -> {right, bottom}                 // padding to keep free
stackOverflowBadge(count, …) -> "+N" | null
```

Three things are load-bearing enough to be locked by tests:

1. **Order.** `stackLayers` returns back-to-front, so the leader is last in the
   array and last in the DOM — natural paint order already puts it on top, and `z`
   is set as well so a future JSX reshuffle can't break it.
2. **The reserve.** Layers are absolutely positioned against the pile's *padding*
   box, and the component writes `stackReserve()` as inline `padding-right` /
   `padding-bottom`. If the two ever disagree the deepest layer gets clipped. Same
   reasoning as the grid's inline `grid-template-columns` (AGENTS.md §1): the value
   is data, so it cannot live in CSS.
3. **The badge counts hidden photos, not total** — `+2` on a 5-photo group, `null`
   at 3 or fewer.

### Interaction rules

| Gesture | Collapsed pile | Open pile |
|---|---|---|
| click on the pile | opens it | (photos behave as before) |
| click on the select bar | toggles group selection (unchanged) | same |
| `Enter` / `Space` on the focused pile | opens / closes | — |
| `Escape` | — | collapses |
| double-click | lightbox on the leader (`openLightboxFromDoubleClick`) | lightbox on that photo |
| photo pick mode, tap the **top** photo | toggles it | toggles that photo |
| photo pick mode, tap a peeking layer | inert — open the pile to reach it | — |

- **One pile open at a time.** `expandedGroupId: string \| null`, component-local.
  Keyed by group id, so it survives a re-sort or a filter change; a group that stops
  existing simply stops matching, so there is **no cleanup effect** to go stale (and
  no synchronous `setState` in an effect — react-hooks v7).
- **`togglePile` reuses the 200 ms repeat guard** from `lib/selectionGesture`
  (report 30). A hardware double-click emits two clicks, and without the guard the
  pile would open and instantly close before `dblclick` ran. It is keyed
  `pile:<id>`, **not** `<id>`, so it can never eat a select-bar toggle on the same
  group or vice versa.
- **Selection semantics did not change.** The card's `onMouseDown` already bailed on
  `.group-images`; `.group-stack` was added to that same bail list, so clicking a
  pile never toggles the group.
- `prefers-reduced-motion: reduce` drops the layer/hint transitions.

### Two knock-on fixes the piles forced

- **The select bar no longer wraps or clips.** At the default 8 columns a group card
  is ~93px wide inside `.step2-split`. The bar is now `flex-wrap: nowrap`, the count
  badge is a `Layers` icon + number instead of "5 images", the `⋯` is pinned right
  with `margin-left: auto`, and the **category chip moved onto the pile** (top-left,
  `.gs-cat`) where it has the photo's full width. Open, the pile is gone and the
  chip goes back on the bar. Before this, "Sweatshirts" rendered as "S".
- **`.gs-cat` needs `.group-stack .gs-cat` (0,2,0).** `.category-badge` is also
  declared in `ProductDescriptionGenerator.css` (which `ImageGrouper.tsx` imports for
  the shared crop tool) as `position: relative; z-index: 2`, and again in
  `CategoryZones.css`. At (0,1,0) those won by source order and the chip sank behind
  the leader layer — it rendered, it was just invisible. Worth remembering before
  adding any other rule to a class this component doesn't solely own.
- **An open pile takes two grid slots** (`.product-group-card:has(.gs-collapse)
  { grid-column: span 2 }`) and fans 3-up. Expanding a card that made it *smaller*
  read as the wrong direction. `:has()`'s failure mode is safe: an unsupported engine
  drops the selector, the card stays one slot wide, the fan still renders.

---

## 2. The toolbar

### Layout: ONE sticky block, TWO rows

```
.grouper-scroll-content            (the scroll box, max-height 75vh)
└── .grouper-toolbar               ← position: sticky; top: 0; z-index: 60
    ├── .gtb-row.gtb-row--controls  stats │ sort │ filters │ photos-per-item + pick │ columns
    └── .gtb-row.photo-toolbar      pick photos │ rotate │ copy rot/crop │ revert │ delete │ clear originals
├── .singles-section
└── .groups-section
```

**Why one block rather than two sticky bars:** they are used together (pick photos in
row 2, filter what you're picking from in row 1), and two independently sticky bars
leapfrog each other while scrolling. The block sticks to the top of
`.grouper-scroll-content` — a position the app's own black nav (sticky, `z-index:
100`) can never cover, which is exactly why the old *phone* top-bar had to be
non-sticky. `.photo-toolbar` keeps its class name (handlers and the click-outside
safe list read it) but its sticky positioning, surface and shadow moved up to
`.grouper-toolbar`; it is now just a row with a hairline above it.

Row 1 content, left to right, separated by `.gtb-divider` hairlines:

| cluster | contents |
|---|---|
| `.stats` | `N groups`, `N singles`, **`N listings`** (accent fill), `N photos`, `N selected` (success fill), Undo, Redo |
| `.sort-control` | ↑↓ Date, ↑↓ Name |
| `.filter-bar` | Groups / Singles, date `<select>`, Uncategorized + one chip per category, ✕ Clear |
| `.auto-group-control` | Photos/item number + 1–10 slider + Apply + Pick |
| `.auto-group-control` | Columns + slider |

Stats are compact chips (`11 groups` not `11 Multi-Image Groups`) and always first,
so the "where am I" readout is never wrapped away from the left edge. Undo/Redo were
`<span onClick>`; they are real `<button>`s now, which also buys them the global
44px touch floor.

**Responsive:** the row **wraps** onto extra lines as width drops (three lines in the
real `.step2-split` column at a 1280 viewport — 131px of toolbar). At **≤640px** each
row becomes one horizontally scrollable strip with `scroll-snap-type: x proximity`
and per-cluster `scroll-snap-align: start`, so a thumb flick moves cluster by
cluster instead of the toolbar eating most of a screen. A `mask-image` fade on the
right edge is the affordance that there is more; it degrades to "no fade" where
unsupported. Tablet (641–1024px) wraps rather than scrolls and gets 36px controls.

### What was removed

- **`.grouper-header` as a 210px sticky sidebar column** — and with it
  `.image-grouper-container`'s two-column flex (now `display: block`), the
  `height: 75vh` / `overflow-y: auto` sidebar scroller, and `.sort-control` /
  `.filter-bar` / `.auto-group-control` / `.stats` as vertical stacks. The photo grid
  takes the full width.
- **The phone "Sort, filter & group tools" disclosure** — `toolsOpen` state, the
  `.grouper-tools-toggle` button, `.grouper-header--tools-open` and its ~14 phone
  rules. It existed only because the sidebar folded into a top bar that would
  otherwise push the grid a screen down; a sideways-scrolling strip solves that
  without hiding anything. `SlidersHorizontal` dropped from the lucide import.
- **`.keyboard-cheatsheet`** and `.cheatsheet-title` / `.cheatsheet-row` / its
  `kbd` styling and its `@media (max-width: 768px)` hide rule. The shortcuts now
  live in the bottom-left gear panel (`src/lib/keyboardShortcuts.ts`). **Every
  handler stayed** — ⌘Enter, ⌘⌫, ⌘1–9, ⌘0, ⌘A, ⌘⇧A, ⌘D, ⌘Z, ⌘⇧Z are untouched.
- Dead CSS that lost its last consumer: `.filter-bar-label`, `.filter-btn-group`
  (+ its sibling-divider rule), and the sidebar half of the `@media (max-width:
  768px)` block.

### Click-outside safe list

`.grouper-header` in the safe-selector list (`ImageGrouper.tsx`, near the
`.photo-toolbar` entry) was replaced by **`.grouper-toolbar`**, which wraps
`.photo-toolbar`. A mis-tap on a divider or on the padding between two clusters
still cannot wipe the selection.

---

## 3. What I saw

Verified with the DevTools driver against the live dev server: the logged-out
landing page loads the real app CSS bundle, so representative Step 2 markup was
injected into it and screenshotted. Two saved under `docs/reviews/img-16/`:
`step2-stacks-1280.png`, `step2-stacks-390.png`.

**1280px, inside a realistic `.step2-split` (`1fr 340px`) — grouper column 873px:**
toolbar 131px tall, three wrapped lines in row 1 plus the photo row; no horizontal
page overflow (`scrollWidth === clientWidth === 1280`). Piles 93px square at the
default 8 columns, peek layers clearly legible on the right and bottom edges, `+2`
badge and category chip both readable. The open group spans two slots with its
Collapse bar; every other card keeps its height (the grid is `align-items: start`).

**Things I fixed because the screenshots showed them:**

- *Piles were 490px tall* in the first pass — my fixture used 4 group columns, not
  the real 8. Re-rendered at the real default.
- *Peek layers were invisible* at 5px/2.2°. Raised to 7px/2.6°.
- *The select bar clipped "Outerwear" to "O"* and squeezed the `⋯` off the card.
  Fixed by nowrap + icon-and-number count badge + moving the category chip onto the
  pile (see §1).
- *The category chip rendered but was invisible* — the `.category-badge` z-index
  collision described above. Found by probing `getComputedStyle`, not by looking.
- *Expanding made a card smaller than the pile.* Added `grid-column: span 2`.

**390px:** toolbar 104px (two 44px-target strips), both rows scroll sideways with
the right-edge fade visible, no page-level horizontal overflow. Group grid is 2
columns (`clampGroupGridColumns`), so a pile is ~156px — bigger than desktop's, which
is why `STACK_COMPACT_SCALE` is 0.7 rather than 0.6 (the peek has to stay readable).
An open pile spans both columns, i.e. full width. The `Tees` chip, the `+2` badge and
the `⋯` all clear each other.

**Not cramped or clipped anywhere I could find at either width.** The one deliberate
trade at ≤640px: sort/filter start off-screen to the right of the stats and need one
flick — that is the brief's "horizontally scrollable with scroll-snap rather than a
stack of rows".

---

## 4. Gates

| gate | before | after |
|---|---|---|
| `npm test` | 1060 | **1106 passed** (55 files; +19 mine in `stackLayout.test.ts`, the rest from a concurrent agent) |
| `npm run build` | clean | **clean** (`tsc -b` + vite) |
| `npx eslint .` | 252 problems (236 errors, 16 warnings) | **252** — none on my lines (`ImageGrouper.tsx`, `stackLayout*.ts` report 0 errors) |

No commit made. No `App.tsx` / PDG / AGENTS.md / README / CHANGELOG edits.

### Left for the `App.css` owner

`src/App.css` still carries a now-dead rule I could not touch (another agent owns
that file this session):

```css
/* Tablet: sidebar inside ImageGrouper shrinks to 160px */
@media (max-width: 1024px) and (min-width: 769px) {
  .grouper-header { width: 160px !important; padding: 0.9rem 0.7rem !important; font-size: var(--fs-xs); }
}
```

`.grouper-header` no longer exists in the DOM, so it is inert — but it should be
deleted with its comment on the next App.css pass.

---

## 5. Paste-ready AGENTS.md lines

### §10 — Step 2: Group & Categorize → replace the "Multi-image groups display as a card" bullet and its neighbours

```md
- **A multi-photo group renders as a PILE, not a grid of thumbnails** (Sept 2026).
  The leader photo (`items[0]`, first-shot by filename then `capturedAt`) sits on top
  at full card size; up to two more layers peek out behind it, offset and rotated;
  anything deeper is a `+N` badge counting the HIDDEN photos. Clicking the pile (or
  Enter/Space on it) fans it open in place into the old `.group-images` layout —
  every photo, drag-to-reorder, double-click lightbox, a per-photo `↩`
  remove-from-group, and a Collapse bar. Escape collapses. **One pile open at a
  time**, held in component-local `expandedGroupId` keyed by group id, so it survives
  a re-sort and needs no cleanup effect. An open pile takes two grid slots
  (`:has(.gs-collapse) { grid-column: span 2 }`) so expanding is never a shrink.
- **The geometry is `src/lib/stackLayout.ts`, not CSS** — `stackLayers()` (returns
  BACK-TO-FRONT so the leader paints last), `stackReserve()` (written as inline
  padding: the layers are positioned against the padding box, so the reserve and the
  offsets must come from the same helper or the deepest layer is clipped) and
  `stackOverflowBadge()`. Same reason the grid's column count is inline (§1): the
  values are depth- and viewport-dependent data. 19 tests.
- `togglePile` reuses the 200 ms repeat guard from `lib/selectionGesture`, keyed
  `pile:<id>` rather than `<id>` so a pile toggle and a select-bar toggle on the same
  group never eat each other. The select bar still owns group selection; the card's
  `onMouseDown` bails on `.group-stack` exactly as it does on `.group-images`.
- **The category chip sits ON the pile when collapsed** (`.gs-cat`, top-left) and on
  the select bar when open — at the default 8 columns a group card is ~93px wide and
  the bar clipped "Sweatshirts" to one letter. `.gs-cat` needs the (0,2,0) selector
  `.group-stack .gs-cat`: `.category-badge` is also declared in
  ProductDescriptionGenerator.css (imported here for the shared crop tool) as
  `position: relative; z-index: 2`, which otherwise wins by source order and sinks
  the chip behind the leader layer.
- **The 210px sort/filter/stats sidebar is GONE** (Sept 2026). Everything it held —
  stats, sort, filters, Photos/item + Apply + Pick, Columns — is row 1 of
  `.grouper-toolbar`, ONE sticky block of two rows at the top of
  `.grouper-scroll-content`, with the photo-tools cluster as row 2. It sticks to the
  top of that scroll box, a position the black app nav can never cover. The row wraps
  onto extra lines as width drops; at ≤640px each row is one horizontally scrolling
  strip with scroll-snap and a right-edge `mask-image` fade — which is what replaced
  the phone-only "Sort, filter & group tools" disclosure (`toolsOpen`). The
  click-outside safe list now names `.grouper-toolbar` instead of `.grouper-header`.
```

### §15 — What's Done

```md
- ✅ **Step 2 groups are PILES, and the sidebar became one toolbar row**
  (Sept 2026, `docs/reviews/16-step2-stacks-toolbar.md`) — (1) a multi-photo group
  renders as a stack: leader on top at full card size, two peeking layers behind it,
  `+N` for the rest; click / Enter / Space fans it open in place (all photos,
  drag-reorder, double-click lightbox, per-photo `↩` remove-from-group, Collapse
  bar), Escape collapses, one open at a time, state keyed by group id so it survives
  a re-sort. Geometry is the pure, tested `src/lib/stackLayout.ts` (19 tests) because
  the inline offsets and the pile's reserved padding have to come from one place.
  (2) `.grouper-header` — the 210px sticky sidebar — is deleted; stats, sort,
  filters, Photos/item + Pick and Columns are now row 1 of `.grouper-toolbar`, one
  sticky two-row block above the grid (row 2 is the existing photo-tools cluster), so
  the photo grid gets the full width. Wraps on desktop, scroll-snaps sideways at
  ≤640px, which also retired the phone "Tools" disclosure (`toolsOpen`). (3) The
  keyboard cheat sheet left the sidebar for the bottom-left gear panel — every
  shortcut HANDLER is untouched. Knock-on fixes: the group select bar no longer wraps
  or clips on a ~93px card (nowrap, icon+number count badge, category chip moved onto
  the pile), and an open pile spans two grid slots so expanding is never a shrink.
```
