# 16 — Step 3 scroll containers + the bottom-left shortcuts panel

Founder reports handled: **#36** ("hard time scrolling in dictation area or scroll area within
scroll area") and the shortcuts request ("move shortcuts into a toggle view like the inbox but use
a gear icon to expand it; make it be in the bottom-left corner"). **Nothing was committed.**

---

## Gates

| Gate | Before | After |
|---|---|---|
| `npm test` | 1080 passed / 54 files | **1106 passed / 55 files** (+26, all mine) |
| `npm run build` (`tsc -b && vite build`) | clean | **clean** |
| `npx eslint .` | **252 problems** (236 errors, 16 warnings) | **252 problems** (236, 16) — unchanged |
| lint on the 3 new files | — | **0 findings** |
| `package.json` | — | **untouched** (no dependency added) |
| horizontal page scroll, 390 / 950 / 1024 / 1280 | — | **none** (`scrollWidth === clientWidth` at all four) |

Files touched: `ProductDescriptionGenerator.tsx` / `.css`, `ComprehensiveProductForm.tsx`,
`VoiceCommandTable.tsx`, `App.tsx` (debug-toggle region only), `App.css` (debug-toggle region
only), `lib/keyboardShortcuts.ts`. New: `components/ShortcutsPanel.tsx` / `.css`,
`lib/keyboardShortcuts.test.ts`.

---

## PART A — report #36: the page is now Step 3's only scroller

### The mechanism

A wheel or touch gesture is delivered to the innermost scrollable box under the pointer. That box
keeps the gesture until it reaches its own end, and Chrome then *latches* — it will not hand the
remainder of the same gesture to the page. So every nested scroller is a place where the page
stops responding and the user has to move the pointer somewhere else and start again. Step 3 had
five of them stacked down the middle of the screen, which is why it felt like the page "would not
scroll past".

Two of the five were invisible as scrollers in the source:

- **`overflow-x: auto` makes a box scrollable on BOTH axes.** Per CSS Overflow, when one axis is
  not `visible` the other computes from `visible` to `auto`. `.vct-grid` was declared horizontal
  and was silently a vertical scroll container too.
- **A `<textarea rows={8}>` is a scroll container.** It is the literal "dictation area" in the
  report: the transcript box scrolled its own text instead of the page.

### Every scroll container in Step 3

| # | Container | Where | Was | Now | Why |
|---|---|---|---|---|---|
| 1 | `.product-preview` + `.preview-scroll-area` | PDG.css :77–97 | `height: calc(100vh - 160px)` on a sticky card with an `overflow-y: auto` child | **REMOVED.** Card chrome moved onto `.preview-scroll-area`, which is now `flex: 0 0 auto` and grows to its content; `.product-preview` is a transparent column that keeps the grid's default `align-self: stretch` | The main trap. The image and the thumbnail grid — the widest target in the left column — captured every gesture that landed on them. Measured after: `.product-preview` height 930px = `.product-form` height 930px, card 505px, nothing scrolls |
| 2 | `.preview-nav-dock` | PDG.css :1356 | `display: contents` (no box — the fixed-height card did the pinning) | **KEPT PINNED, differently.** A real `position: sticky; top: calc(var(--space-8) + 60px)` box | Removing #1 would have let Prev/Next scroll away. Because the parent column stretches to the editor row, the dock now stays on screen for the **whole** form — strictly more than the old card managed, which pinned it for one viewport only |
| 3 | `.vct-grid` (voice command table) | PDG.css :1132 | `overflow-x: auto` ⇒ implicit `overflow-y: auto` | **REMOVED.** Columns are `minmax(0, 1fr)` (was `minmax(90px, 1fr)`) + `min-width: 0` on `.vct-col` | The 90px floor made 5 columns demand 450px, which is what created the scrollbar in the first place. Verified no overflow at 390/950/1024/1280 |
| 4 | `textarea.description-textarea` (dictation) | PDG.tsx :3136 | `rows={8}`, scrolls its own transcript | **REMOVED.** `js-autogrow` → height set to content after every render | The literal subject of the report |
| 5 | `textarea.info-textarea` (generated description) | PDG.tsx :3211 | `rows={6}` | **REMOVED.** `js-autogrow` | Same class of trap, directly below #4 |
| 6 | `textarea.info-input` (SEO description) | ComprehensiveProductForm.tsx :310 | `rows={2}`, `min-height: 80px` | **REMOVED.** `js-autogrow` | Same |
| 7 | Preset search listbox | PDG.tsx :3420 | `maxHeight: 240px; overflowY: auto` | **KEPT** + `overscrollBehavior: 'contain'` | A floating popover, not page flow. Uncapped it would cover the form with every preset in the workspace. `contain` stops a flick inside it reaching the page |
| 8 | `.crop-fs-ratiobar` | PDG.css :742 | `overflow-x: auto` | **KEPT** + `overflow-y: hidden` + `overscroll-behavior: contain` | A genuinely horizontal rail of ratio pills that cannot fit a phone, inside a full-screen modal — it never competes with the page scroller. The y axis is pinned so it cannot become an accidental vertical one (the #3 failure) |
| 9 | `.ks-body` (new) | ShortcutsPanel.css | — | **KEPT** with `overscroll-behavior: contain` | Same reasoning as #7 |
| 10 | `.crop-fs-stage`, `.progress-bar`, `.vct-row-group`, `.vct-header`, `.preview-image-wrap` | various | `overflow: hidden` | **KEPT, untouched** | Clipping, not scrolling. `overflow: hidden` boxes are not wheel-scrollable, so none of them can capture a gesture. `.preview-image-wrap` in particular never actually clips: the `<img>` inside carries the same 280px cap with `object-fit: contain` |
| 11 | `.preview-image` 280px / 300px / 52vh caps | PDG.css :135, :530, :1432 | image size caps | **KEPT, untouched** | They cap a painted image. No overflow, no scroll |

**Measured result** — a representative Step 3 injected into the live app CSS, then every descendant
of `.product-description-container` tested for `(overflowY is auto|scroll) && scrollHeight >
clientHeight`:

```
390px   step3Scrollers: []
950px   step3Scrollers: []
1024px  step3Scrollers: []
1280px  step3Scrollers: []
```

### Phone layout re-checked

The mobile pass (report 10) turned the dock into a **bottom**-sticky bar at `bottom: var(--tabbar-h)`.
The dock's new desktop rule sets `top`, and an element with both offsets re-sticks to the top edge
on the way down — so the ≤640 block now explicitly releases it with `top: auto`. Verified:

```
390px   dockPos sticky · dockTop auto   · dockBottom 55.8px   (= --tabbar-h)
1280px  dockPos sticky · dockTop 78px   · dockBottom auto
```

`.preview-scroll-area`'s duplicated card chrome was dropped from the ≤640 block (it is in the base
rule now); only its tighter `padding` and `order` remain. The ≤900 block lost its `position:
relative / top / height: auto` resets, which existed solely to undo the fixed-height card.

### One `box-sizing` detail worth keeping

`scrollHeight` measures the **content** box. `box-sizing: border-box` is global here, so setting
`height = scrollHeight` clips the last 2px of every textarea — measured: a 320px description
rendered into a 318px content box. The effect adds `offsetHeight - clientHeight` (the borders).
After the fix both textareas report `clips: false`.

`resize: none` goes with auto-grow: a manual drag would be overwritten by the next keystroke, and
there is nothing left to reveal by dragging. The rule is scoped
`.product-description-container textarea.js-autogrow` so it outranks `textarea.info-input`'s
`resize: vertical` — same specificity in a different file, and CSS import order must not be allowed
to decide it.

---

## PART B — the bottom-left shortcuts panel

### Design

A fixed gear FAB in the bottom-left, mirroring `SupportWidget` in the bottom-right: same 44px
target, same `0 6px 20px rgba(0,0,0,.18)` shadow, same `z-index: 5000`, same `--tabbar-h` lift and
full-screen-sheet behaviour on phones, same `--safe-*` padding in standalone mode. Open state
swaps the fill to `--ink-700` and rotates the gear 45°.

The panel above it renders `lib/keyboardShortcuts.ts` grouped by `SHORTCUT_SCOPE_LABEL`, each row a
`<kbd>` run plus its action. `platformKeys(keys, IS_MAC)` substitutes `Ctrl` for `⌘` off Apple
platforms; `IS_MAC` is read once from `navigator.platform || navigator.userAgent`. `aria-expanded`
on the FAB, `role="dialog"` + `aria-label` on the panel, Escape and outside-`mousedown` close, and
focus moves into the panel on open and back to the FAB on close.

**The debug toggle moved inside it** as a `role="switch"` row at the bottom, running App's existing
`toggleDebug` handler unchanged (now wrapped in the file's `useEventCallback` so the memoized panel
does not re-render on every App render). `.button-debug-toggle` / `.button-debug-on` and the
floating `<button>` are deleted. Net effect: one control in that corner instead of a permanently
pinned developer affordance — and the switch is finally reachable on a phone, where the old button
was `display: none`.

### The list was corrected against the handlers

Read back off the code, not off the seed:

| Row | Source | Change |
|---|---|---|
| `Enter` → Start / stop voice recording | PDG.tsx :2333 | **ADDED.** It was missing entirely. It is a toggle on the record button — not "next listing", which is what a reader would assume |
| `← →` | PDG.tsx :2329 **and** ImageGrouper.tsx :3318 | **`step3` → `global`.** Both steps mount a lightbox and both bind the arrows |
| `.` | PDG.tsx :1599 | Marked `when: 'while recording'` — the handler returns early unless `isRecordingRef.current` |
| `⌘ A` / `⌘ Shift A` | ImageGrouper.tsx :1194 | Marked `when: 'press again to deselect'` — both are toggles |
| `⌘ Z` | ImageGrouper.tsx :1220 | Wording tightened to "Undo the last grouping change" (it is the grouper's own history stack, not a global undo) |
| the other six Step 2 rows | ImageGrouper.tsx :1169–1275 | Verified correct as seeded |

A `SHORTCUT_FOOTNOTE` was added because every one of these handlers bails out when an input,
textarea, select or contenteditable has focus — otherwise "⌘A stopped working" gets filed from
inside a text field.

New pure helpers, all unit-tested: `SHORTCUT_SCOPES` (render order), `groupedShortcuts()`,
`splitKeys()`, `detectIsMac()`. 26 tests in `keyboardShortcuts.test.ts`, including list-integrity
guards (no duplicate key/scope pair, no ⌘ ever shown on a non-Apple platform, every scope has a
label) and regression guards for the four corrections above.

### Screenshots

Representative markup injected into the live dev page — real app CSS, real tokens, real 9px root —
via the DevTools driver, with the auto-grow pass applied exactly as the effect runs it.

| | |
|---|---|
| `docs/reviews/img-16/shortcuts-1280.png` | 1280 × 1100. Panel open bottom-left over Step 3. FAB 44×44 at left 16px / bottom 16px (`1.75rem` on the 9px root — the same number the support FAB uses on the right). Panel 360 × 471 |
| `docs/reviews/img-16/shortcuts-390-open.png` | 390 × 844. Full-screen sheet, FAB hidden, debug switch shown ON (amber) |
| `docs/reviews/img-16/shortcuts-390-closed.png` | 390 × 844. Gear at left 7px / bottom 63px, clear of the tab bar (`0.75rem + --tabbar-h`) |

---

## Two things I did NOT do

1. **`ImageGrouper.tsx` still renders its own `.keyboard-cheatsheet`** (lines 2735–2747) in the
   Step 2 sidebar — the nine Step 2 rows now appear in two places. Deleting it is the other half of
   "move shortcuts into a toggle view", but `ImageGrouper` was out of my ownership for this pass.
   It is a 13-line deletion in the JSX plus `.keyboard-cheatsheet` / `.cheatsheet-*` in
   `ImageGrouper.css:595–640`.

2. **On a phone in Step 3, the gear overlaps the sticky nav dock.** The dock is a full-width bar at
   `bottom: var(--tabbar-h)`; the two FABs sit in the same band at `bottom: calc(0.75rem +
   --tabbar-h)`, so the gear covers the left end of the Save row (and the support FAB has always
   covered the right end — this is pre-existing on that side). I left the geometry as specified
   rather than redesigning the Step-3 phone dock unasked. The existing pattern for this is
   `App.css:810`, where toasts lift a further `4.8rem` to clear the FAB row; the dock would need
   the equivalent, or the FABs need to move above it when Step 3 is active.

---

## Paste-ready AGENTS.md lines

### For §10 (Step 3), after the existing bullets

```
- **Step 3 has exactly one scroller: the page.** `.product-preview` is a transparent
  content-height column (the card chrome lives on `.preview-scroll-area`), `.preview-nav-dock` is
  the sticky element that keeps Prev/Next on screen, and the three big textareas
  (dictation, generated description, SEO description) carry `js-autogrow` — an effect in
  `ProductDescriptionGenerator.tsx` sets each one's height to `scrollHeight + (offsetHeight -
  clientHeight)` after every render. Do NOT add `overflow-y: auto`, a `max-height`, or a `rows`-sized
  textarea to anything inside `.product-description-container`: a nested scroller captures the
  wheel and latches, which is the bug report #36 fixed. And remember `overflow-x: auto` makes a box
  scrollable on BOTH axes — pin the other axis explicitly. The only scrollers that may stay are
  ones that are not in page flow (the crop modal's ratio rail, the preset listbox, the shortcuts
  panel body), and each must carry `overscroll-behavior: contain`.
- **Keyboard shortcuts are DATA, in `src/lib/keyboardShortcuts.ts`.** Any handler that binds a key
  must add its row there or the shortcut is invisible to users — `ShortcutsPanel` is the only place
  the app lists them. Keys are written with `⌘`; `platformKeys()` substitutes `Ctrl`.
```

### For §15 (What's Done), as new bullets

```
- ✅ **Step 3 nested scrollers removed (report 36)** — the left preview column's
  `height: calc(100vh - 160px)` + `overflow-y: auto` card, `.vct-grid`'s `overflow-x: auto` (which
  silently made it a VERTICAL scroll container too), and the three `rows`-sized textareas are gone;
  the page is the only scroller in Step 3. `.preview-nav-dock` became the sticky element and, because
  its parent column stretches to the grid row, now pins Prev/Next for the whole form instead of one
  viewport. Kept, each with `overscroll-behavior: contain`: the crop modal's horizontal ratio rail,
  the preset listbox, the shortcuts panel body. Voice-table columns are `minmax(0, 1fr)`; verified no
  scroll container and no horizontal page overflow at 390/950/1024/1280.
- ✅ **ShortcutsPanel — bottom-left gear FAB** (`components/ShortcutsPanel.tsx`) — mirrors
  SupportWidget's FAB on the opposite corner (44px, same shadow, `--tabbar-h` lift, full-screen
  sheet ≤640px) and expands a panel listing `lib/keyboardShortcuts.ts` grouped by scope, with
  `Ctrl` substituted for `⌘` off Apple platforms. Escape / outside-click close, `aria-expanded`,
  focus returns to the FAB. **The floating debug toggle is gone** — it is a switch at the bottom of
  this panel running the same handler, so the corner holds one control and the switch works on a
  phone (`.button-debug-toggle` / `.button-debug-on` deleted from App.css). The shortcut list was
  corrected against the handlers: Enter is Step 3's record toggle (was missing), the lightbox arrows
  are global (Step 2 binds them too), and `.` / `⌘A` / `⌘⇧A` carry their conditions.
```

---

## Summary

1. Step 3 had five nested scroll containers; two were invisible in the source (`overflow-x: auto`
   implies `overflow-y: auto`; a `rows`-sized textarea is a scroller).
2. Removed six of them, kept three that are not in page flow, each now with
   `overscroll-behavior: contain`. Measured: zero scroll containers in Step 3 at four widths.
3. The left column's fixed-height card is gone; `.preview-nav-dock` is the sticky element and pins
   Prev/Next for the whole form, which the old card never did.
4. Three textareas auto-grow, with the `box-sizing: border-box` border correction.
5. New `ShortcutsPanel`: bottom-left gear FAB mirroring the support widget, panel driven entirely by
   `lib/keyboardShortcuts.ts`.
6. The floating debug button and its CSS are deleted; the switch lives in the panel and now works on
   phones.
7. The shortcut list was corrected against the real handlers — Enter (missing), the lightbox arrows
   (wrong scope), and three conditions.
8. Gates: 1106 tests (+26), clean build, lint 252 = baseline, none on my lines, no new dependency.
9. Open: `ImageGrouper`'s duplicate cheatsheet (out of my ownership) and the phone FAB/Step-3-dock
   overlap (pre-existing on the support side).
10. Nothing committed.

---

## Addendum — the phone FAB / Step-3 dock overlap, both corners

Open item #2 above is now fixed. **Option (b): a `--dock-h` custom property.**

### Why not (a) — the dock reserving horizontal lanes

Measured at 390px before changing anything:

| | width | position |
|---|---|---|
| shortcuts gear | **44px** | left 7px, bottom 63px |
| support FAB | **105px** | right 7px, bottom 63px — it is a labelled pill, not a circle |
| Step 3 nav dock | 356px inner | left/right inset 17px, **168px tall**, bottom 56px (`--tabbar-h`) |

The two lanes would be `(51 − 17) = 34px` on the left and `(120 − 17) = 103px` on the right —
**137px of the dock's 356px, asymmetrically**, leaving ~219px for Prev + the 58px counter + Next,
i.e. ~76px buttons and a visibly lopsided bar. Shrinking the support FAB to a 44px circle would
even the lanes up, but `SupportWidget.css` states the label is deliberate ("`Messages` is what makes
the button legible to a first-time user"), and overruling that to make room is the wrong trade. It
also costs those 137px permanently, on every phone screen, whether or not a FAB is being looked at.

### What (b) does

`ProductDescriptionGenerator.tsx` publishes `--dock-h` on `.app-container` — the same contract
`--tabbar-h` uses in `index.css`: one number every bottom-anchored surface adds, so neither FAB has
to know what a dock is. Both consume it identically:

```css
bottom: calc(0.75rem + var(--tabbar-h) + var(--dock-h, 0px));
```

It is `0px` in all three cases where there is nothing to clear:

- **above 640px** — the dock is `display: contents`, generates no box, `offsetHeight` is 0;
- **when Step 3 is off screen** — every step is mounted at once, so the dock is in the DOM while the
  user is up in Step 1 or 2, but a `position: sticky` bar is only painted while its containing block
  is in view. An `IntersectionObserver` (threshold 0) is what distinguishes the two, so the buttons
  never lift over a bar that is not there. A `resize` listener covers orientation change;
- **when PDG unmounts** — the effect's cleanup removes the property.

The element is held in state rather than a `useRef` because the dock mounts *after* the
`!currentItem` early return, so a ref would still be null the single time a `[]` effect ran.

### Verified at 390px

Rectangle-intersection test against the dock, with the page scrolled so the dock is pinned:

```
--dock-h        168px
dock      top 620  bottom 788   left 17  right 373
gear      top 569  bottom 613   left  7  right  51   → overlapsDock: false
support   top 569  bottom 613   left 278 right 383   → overlapsDock: false
tabbar    top 787  bottom 844
```

A clean bottom stack — tab bar, dock, then the two buttons 7px above it. Prev, Next, the slider and
Save are fully exposed; both FABs stay 44px tall (`--tap`). Screenshot:
`docs/reviews/img-16/dock-fabs-390.png`.

**Still open (unchanged, out of ownership):** `App.css:810` lifts toasts a fixed `4.8rem` to clear
the FAB row. Now that the row itself can move, that literal should become
`calc(var(--space-3) + var(--tabbar-h) + var(--dock-h, 0px) + 4.8rem)` — a one-line change in a
region of `App.css` another agent is working in.

### Addition to the §15 bullet

```
  On phones the two bottom-corner FABs (shortcuts gear left, support pill right) clear the Step 3
  nav bar via `--dock-h`, published on `.app-container` by PDG the way `--tabbar-h` is published by
  index.css: `bottom: calc(0.75rem + var(--tabbar-h) + var(--dock-h, 0px))`. It is 0 above 640px
  (the dock is `display: contents`) and 0 whenever the sticky dock is off screen (IntersectionObserver),
  so nothing lifts over a bar that is not there. Reserving horizontal lanes in the dock instead was
  rejected: the support FAB is a 105px labelled pill, so the lanes would take 137px of 356px.
```
