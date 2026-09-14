# 10 — Mobile: the tool pages on a 390px phone

Pass scope: the nine full-page tool views, the two new first-party views
(Messages, Finance) and the `src/components/ui/` primitives. Implemented against
the working tree on `main` (already dirty from passes 01–09 and from two agents
working in parallel on disjoint files). Nothing was committed. No dependency
added, no `confirm()`/`prompt()` introduced, no `sortbot_*` key touched.

**Founder's direction:** *"think mobile first for user experience."*

Breakpoints as agreed across the three agents: **≤ 640px = phone**,
**≤ 1024px = tablet**. Touch floor **44 × 44 CSS px**. Controls **≥ 16px**
(`--fs-md`) on phones. No horizontal PAGE scroll — only tables, charts and the
board strip scroll, each inside its own container.

---

## 0. The two problems that produced most of the diff

Almost every rule below is one of two fixes, so they are worth stating once.

### 0.1 The 9px root makes every hand-rolled control a dart board

`html { font-size: 9px }` (CLAUDE.md §16) means rem padding reads about ⅔ smaller
than it looks in source. `.org-confirm-yes { padding: 0.2rem 0.55rem }` is
**1.8px × 5px**, so that button is ~16px tall. `.org-icon-btn` is ~20px square.
`.beta-chip` is ~19px. These are fine with a mouse and unusable with a thumb.

Everything interactive is floored at **44px**, written as an absolute literal
rather than `4.9rem`. Deliberate: every other length in this app is rem against
the 9px grid, but a touch target is a *physical* constant — if the root is ever
retuned, a rem value would silently drift off the accessibility floor while
`44px` cannot. That reasoning is written into `ui/Button.css` so it is not
"corrected" later.

### 0.2 ToolView out-specifies every component's control rule

`ToolView.css` pins every control in a tool view with

```css
.tool-view input:not([type='checkbox']):not([type='radio'])
                :not([type='range']):not([type='color'])   /* (0,5,1) */
{ min-height: 4rem; font-size: var(--fs-base); }
```

`--fs-base` is **14px**, and mobile Safari zooms the page when a focused control
is under 16px — then leaves it zoomed. That is the single most common reason a
form "feels broken" on an iPhone.

(0,5,1) already outranked every per-component input rule in the tree, so
`.beta-search input` (0,2,1) never applied in a page view in the first place.
Raising the font size therefore needs **six** classes, not a restatement. The
pattern used everywhere is:

```css
.tool-view :is(<page roots>) input:not([type='checkbox']):not([type='radio'])
                                  :not([type='range']):not([type='color'])
{ min-height: 44px; font-size: var(--fs-md); }   /* (0,6,1) — wins */
```

`:is()` contributes the specificity of its most specific argument (one class),
which is what buys the extra step without a selector a person cannot read.
Selects and textareas only need two classes to beat `.tool-view select` (0,1,1).
ToolView.css was not edited — it belongs to the shell agent.

---

## 1. `src/components/ui/` — the primitives

CSS only; **the 76 ui tests are unchanged and green.** Verified that the
primitives are consumed *only* by `MessagesView` and the test files
(`grep -rl "from './ui'"`), so nothing here reaches a workflow step.

| File | ≤ 640px |
|---|---|
| `Button.css` | All three size steps (24/32/40px) floored at 44px. `--sm` also gets `padding-inline: var(--space-3)`, or its tight padding leaves the label floating in a wide empty pill. Font size, variants and colours untouched. |
| `IconButton.css` | All three steps become 44 × 44. A glyph-only control has no label to widen it, so it was the worst offender (`--sm` was a 24px square). |
| `Chip.css` | `min-height: 44px` + wider inline padding; `.ui-chip__remove` to 44px. New opt-in `.ui-chip-group--scroll` for filter rows. |
| `Tabs.css` | `.ui-tablist` stops wrapping and scrolls sideways (scrollbar hidden); `.ui-tab` 44px and `flex: 0 0 auto`. Roving-tabindex keyboard model untouched — the browser scrolls the focused tab into view for free. |
| `Field.css` | `.ui-input` → 44px / `--fs-md`, plus the (0,6,0) `.tool-view` restatement from §0.2. `.ui-field--inline` stacks. Textareas keep a line-count minimum, not a hit-target one. |
| `Dialog.css` | **Bottom sheet.** The old `@media (max-width: 560px)` block was replaced by a 640px one: overlay padding to 0 and `align-items: flex-end`, all size variants to full width, top corners rounded, and a new `ui-sheet-in` slide-up (with a `prefers-reduced-motion` opt-out). |

Three details in the sheet that matter more than the shape:

* **`dvh`, with `vh` as the preceding fallback.** iOS measures `vh` against the
  viewport with toolbars *retracted*, so a `92vh` sheet is taller than the screen
  while the toolbar shows — putting its footer behind the browser chrome.
* **`padding-bottom: calc(var(--space-4) + var(--safe-b))`** on the footer.
  Without it the primary action sits under the home indicator, which is exactly
  where a confirm button must not be.
* Each footer child gets its own `min-height: 44px`, because a stretched row of
  three buttons does not inherit one.

**Why a taller chip and not an invisible `::after` hit area.** The overlay trick
keeps the pill visually small, but chips sit in rows with ~4px gaps — two 44px
overlays would overlap and the row would start handing taps to the wrong chip. A
taller pill is honest: what you can see is what you can press.

---

## 2. Per component

### MessagesView — `MessagesView.css` only

The ≤1024px rules already did the structural half, and I **verified rather than
assumed** it: `data-open` is written on every viewport and only consulted in the
tablet block, and `backToList` clears *both* `activeId` and `composingNew` —
which is exactly the condition the attribute is computed from, so the swap
cannot get stuck with neither pane showing.

| ≤ 640px | |
|---|---|
| Filters | `.mv-list-head` becomes a **wrapping row**: search takes the first line, the status chips flow onto the next. As three stacked blocks it ate a third of the screen before a single conversation appeared. |
| Thread rows | `min-height: 56px` (the floor matters for a thread with an empty preview, which otherwise collapses to ~34px). Unread dot 7px → 9px; the timestamp keeps `flex: 0 0 auto` so only the label between them truncates. Chips 44px. |
| Composer | `.mv[data-open='true'] .mv-conv` gets a `min-height` of `calc(100dvh - 24rem)`; `.mv-msgs` is `flex: 1; min-height: 0` and scrolls, so the composer is the last flex child and lands on the card's bottom edge. `--safe-b` on its padding. Textarea and subject at `--fs-md`. Send is a ui `Button` and inherits the 44px floor. |
| Back | 44px, ordered first; the title block drops to its own full-width line. |

**`min-height`, not `height`, and why.** The subtrahend is an *estimate* of chrome
above the card (black header + ToolView title block + the shell's page padding)
that this component cannot measure and the shell owns. A low guess just makes the
card slightly short; with `height`, a high guess would push the composer off
screen. `dvh` for the iOS toolbar reason above.

### FinanceView — `FinanceView.css` + `FinanceView.tsx`

| Area | ≤ 640px |
|---|---|
| Range presets | Already `.ft-chips` → sideways-scrolling row from the shared layer. Custom date fields take a full line each (a date input at half of 390px shows `mm/dd/…`). |
| Sub-tabs | One no-wrap scrolling row, bled to the page edge. |
| KPI tiles | Two up (shared layer). |
| Monthly chart | Legend **hoisted above** the scroll box; bars scroll inside `.fin-chart-scroll` with the plot at `min-width: 56rem`. |
| Ledger | **Card per transaction**, three-line reading order. |
| Customers | Workspaces table → labelled cards; the two plan tables stay tables in contained scroll. |
| Entry form | One column, full-width controls, **sticky Save bar**. |
| Reports | Buttons stack full width. |
| Print | Untouched — see below. |

**Markup added (TSX):**

1. `MonthlyChart` gained a `.fin-chart-wrap` parent and a `.fin-chart-scroll`
   box, with `.fin-legend` moved *out* of `.fin-chart` so it cannot scroll away
   with the bars. Desktop is unchanged to the pixel: a new base rule
   `.fin-chart-wrap > .fin-legend { padding-left: 6rem }` re-states the inset the
   legend used to inherit from `.fin-chart`, and the vertical rhythm is identical
   (legend + 1.5rem, chart + 2rem, same as before).
2. Ledger `<td>`s carry `data-col="date|kind|category|amount|workspace|repeats|note|actions"`.
   Placement uses `grid-template-areas` keyed off those attributes, **not
   `nth-child`** — re-ordering a column in the JSX cannot silently scramble the
   card. Reading order:

   ```
   AMOUNT                        [kind]
   category                   workspace
   date                         repeats
   note (full width, only when present — `td:empty { display: none }`)
   [ Edit ]  [ Delete ]
   ```
3. Workspaces `<td>`s carry `data-label`, and both tables gained `an-table--cards`.

**Two scoping bugs caught in self-review and fixed:**

* The sticky Save bar and the stacked Reports buttons both target
  `.fin-form-actions`. Without child combinators the Reports rule un-stuck the
  Save bar. They are now `.fin-form > .fin-form-actions` (sticky) and
  `.ft-card > .fin-form-actions` (stacked) — structurally disjoint.
* `.fin-price-input` was briefly `width: 100%`; it sits in a cell of a table that
  is sized *by its content* in the contained-scroll treatment, so a percentage
  would resolve against a width the cell is deriving from it. Reverted to its
  intrinsic 12rem, which holds a money value at 16px.

**The sticky Save bar uses `bottom: var(--app-tabbar-h, 0px)`** — a
forward-compatible hook. It resolves to `0px` today and lifts itself
automatically if the shell agent ever publishes a bottom-tab-bar height. See
§4.

**Print is provably unaffected:** every table rule in this pass is inside
`@media screen and (…)`. `@media print` and a width query are independent, and a
narrow page box could otherwise have dragged the card layouts into a PDF.

### AnalyticsPanel / ErrorsPanel — `.tsx` markup + shared CSS

Both render `<section className="ft-card">` and import `OrgPanel.css`, so their
layout work lives in the shared layer (§3). Markup added here:

* `DailyChart` wrapped in `.an-chart-scroll`. 90 days across 340px is 3.7px per
  bar — a grey smear. The plot keeps `min-width: 52rem` and the wrapper scrolls.
* **Cards** (per the brief's "funnel and events read best as cards"): Analytics
  *Funnel* and *Events*, plus Errors *Top issues* — five columns, two of them
  free text, where scrolling sideways loses the message that identifies the row.
  Each `<td>` got a `data-label`.
* *Referrers*, *Devices*, *Daily*, *By screen* stay tables in contained scroll
  with a sticky first column: two or three narrow numeric columns read fine that
  way, and the label column is the one you must not lose.

**Why the chart scroll box wraps the whole `.an-chart` and not just `.an-plot`:**
the y-axis tick labels are `position: absolute; left: -2.4rem` — inside
`.an-chart`'s left padding but *outside* `.an-plot`. A tighter scrollport would
clip them.

**Why that box needs `padding-top: 5rem`:** `overflow-x: auto` computes the other
axis to `auto` as well, and the tooltip is `top: -0.5rem` then translated up 100%
of its own height. The padding gives it room *inside* the box. (Same reasoning,
6rem, in `.fin-chart-scroll`; the Finance legend's bottom margin is zeroed to pay
for it.)

### CrmPanel — shared CSS only, no markup change

Rows stack: the toggle and name take the first line, and the stage `<select>` and
follow-up `<input type="date">` each take a **full line** beneath
(`flex: 1 1 100%`). Tags wrap. `.crm-detail` field grid → one column. Notes
composer stacks with a full-width Save. Stage chips scroll sideways with the rest
of `.ft-chips`. Delete confirm goes full width.

### OrgPanel — shared CSS only, no markup change

* **Tab rail → scrolling top row.** The ≤1024px rule already turns the left rail
  back into a wrapped chip row; at phone width wrapping is wrong again (nine tabs
  become four lines), so it is one no-wrap scrolling row, bled to the page edge.
  Tabs 44px, `flex: 0 0 auto`, `width: auto`.
* **Member rows stack** with the role select full width. Invite form one field
  per line.
* **Beta requests and the Users list become cards** — `.beta-request-row`,
  `.fa-user-row`, `.org-dir-row` and `.shopify-conn-row` all get a card surface,
  stack, and put their actions on a full-width row of real buttons. No markup
  needed; they were already `<li class="org-member-row …">` flex lines.
* Membership sub-rows, the move-select and the add-row all wrap.

### CategoriesManager — `CategoriesManager.css` only

The ≤1024px rule already stacks the split, and I verified the JSX renders
`.categories-editor` **before** `.categories-list-col` — so form-first,
list-second falls out of source order with no `order` juggling.

* Icon picker: the ≤768px rule pins `repeat(6, 1fr)`, which at 390px lands each
  track near 46px while `.emoji-option` is a hard `width: 48px` — the grid
  overflowed its own card. Now `auto-fill minmax(44px, 1fr)` with the swatch at
  `width: 100%; height: 44px`.
* Colour input already full-width 50px. `.button-icon` 36 → 44px. `.button` /
  `.button-small` floored and centred. Form actions stack full width.

**Everything is scoped to `.categories-page`.** `.button`, `.button-icon`,
`.form-group`, `.form-actions`, `.emoji-picker` and `.emoji-option` are *global*
class names that App.css and CategoryPresetsManager.css also define — a collision
`07-full-views.md` §4 already flags. An unscoped `.button { min-height: 44px }`
would have resized buttons inside the workflow steps, which this pass does not
own.

### CategoryPresetsManager — `.css` + `.tsx` (accordion)

**Markup added:** the ten `<div className="form-section"><h4>…</h4>` blocks became
`<details className="form-section" open><summary>…</summary>`. Converted by
script with real tag matching (each section's close is the next line at exactly
its own 16-space indentation — verified flat before running, 10/10 converted,
`tsc -b` clean).

* **Desktop is byte-for-byte the same behaviour.** `open` is set in the JSX, the
  disclosure marker is removed (`display: block` on the summary, plus
  `::-webkit-details-marker` and `::marker`), and `@media (min-width: 641px)`
  makes the summary `pointer-events: none` so it cannot be collapsed at all.
* On a phone the summary becomes a 44px button with a CSS-drawn caret (a rotated
  border pair — no icon import, no emoji) that flips on `[open]`.

**Sections start open on phones, not collapsed.** Shipping them collapsed at one
breakpoint only would need either a `matchMedia`-driven `open` prop — synchronous
setState in an effect, which react-hooks v7 forbids and the brief calls out — or
overriding the UA's closed-`<details>` behaviour from CSS, which is not
spec-guaranteed and breaks differently per engine. Collapsible is the portable
half of the win: ~45 fields over ten sections, and the reader folds what they do
not need and it stays folded while they work. Flagged as a deliberate partial.

Also: gender chips scroll sideways; measurement checkboxes go one per row at 44px
(`minmax(150px, 1fr)` left two cramped tracks); `.button-sm` needed its height
floor stated separately because its padding ships `!important`; **FieldModal
becomes a bottom sheet** (it stays a real modal — it edits one row *of* the
editor). Controls were `--fs-sm` (13px) → now `--fs-md`. All scoped to
`.presets-page` for the same global-collision reason as Categories.

### VocabDashboard — `VocabDashboard.css` only

**There are no `<table>`s in this view** — every list is already a flex row
(`grep -c "<table"` → 0), so "tables → cards" had nothing to convert. The real
work was stacking those rows: a vocab row is
`[chip/brand][detail][toggle][edit][delete]` on one line, and at 390px the
*detail* — the actual vocabulary — truncated to nothing so three icon buttons
could keep their place. Identity now takes the full width and wraps; controls sit
on their own right-aligned line.

Tabs scroll sideways; the brand-library search is full width on its own line; the
three-column model editor goes to one column; add-forms stack; icon buttons 44px;
controls at `--fs-md`.

### Library — `Library.css` only

* **Two columns, not one.** The ≤480px rule dropped `.batch-grid` to a single
  column, turning a twelve-batch library into twelve full screens. Batches,
  images and grouped-image cards all go `repeat(2, minmax(0, 1fr))` — ~165px
  cards. `minmax(0, 1fr)` rather than `1fr` because a long batch name would
  otherwise force its track past the viewport and take the *page* into horizontal
  scroll.
* **Hover-only controls revealed.** `.group-actions` and `.image-delete` were
  `opacity: 0` until `:hover` — on a touch screen that is a control that does not
  exist. Both now permanently visible (`.batch-actions` already did this at
  ≤768px; these two were missed).
* Tap targets: `.action-button` (which loses its label at ≤480px and became a
  ~34px icon) squared at 44px; `.image-delete`, `.collapse-toggle`,
  `.section-select-all` likewise. Selected badge 28 → 32px (decoration, not a
  target).
* Tab bar wraps with 44px tabs and the count on its own line. Selection toolbar
  keeps its sticky position but stacks, with wrapping 44px actions.
* **Rename prompt → bottom sheet.** `.prompt-modal` had `min-width: 340px`, wider
  than the content box of a 360px phone once the overlay padding is counted — it
  overflowed the viewport and took the page sideways.

**Multi-select on tap — verified in `Library.tsx`, not assumed.**
`handleItemClick` toggles membership in `selectedItems` on a *plain* click and
only consults `event.shiftKey` to decide the same thing, so a tap already adds to
the selection with no modifier. The tap target is the whole card — `onClick` sits
on `.batch-card` / `.group-card` / `.image-card` and bails when the tap landed on
a button — so it is ~165 × 200px. Nothing smaller needed introducing.

**Rubber-band left exactly as is.** The existing ≤640px rule already drops the
grids' own scrollports (`overflow-y: visible`). That is the right call and no
rubber-band code path is touched: the reason the grids keep `overflow-y: auto` on
desktop is the edge auto-scroll writing `container.scrollTop`, and rubber-band is
a mouse-drag gesture that does not exist on a touch screen (a finger drag over
the grid scrolls it). The handler simply has no work to do at this width. Now
documented in the file so it is not "fixed".

### KanbanBoard / KanbanCardDetail — `KanbanBoard.css` only

`KanbanCardDetail` has no CSS file of its own; it uses `.kanban-detail-*`.

* **Lanes: one-lane-at-a-time swipe.** A board is a horizontal object and stays
  one — stacking the lanes would throw away the only thing a board is for.
  `.kanban-lanes` gets `scroll-snap-type: x mandatory` and bleeds to the page
  edge with matching `scroll-padding-inline`; `.kanban-lane` is `85vw`
  (`max-width: 32rem`) with `scroll-snap-align: start`, so a swipe lands on
  exactly one lane with the next peeking in.
* **Card detail: full-screen sheet.** As a `position: absolute`, 92%-wide drawer
  it covered the board while leaving an 8% strip showing — a dead zone that reads
  as a mis-tap target. Now `position: fixed; inset: 0; z-index: 1000`.
  `fixed` resolves against the viewport here because no ancestor creates a
  containing block (`.kanban-page` is `position: relative` only — no transform,
  filter or `contain`). 1000 is the dialog step from the `ui/Dialog` z-index
  budget: above the sticky app header (100), below the support widget (5000) and
  toasts (9000), which must stay reachable. `--safe-b` on its padding. The
  board's own Escape handling is untouched.
* **Atlas simply stacks** — it was already a vertical list of sections. Only its
  two control strips needed work: search full width, lane chips scroll, and the
  pipeline map scrolls as one strip rather than wrapping mid-arrow (a wrapped
  arrow reads as a broken diagram).

---

## 3. The shared founder-tool layer — `OrgPanel.css`

One `@media screen and (max-width: 640px)` block at the end of `OrgPanel.css`
serves **five** views (OrgPanel, AnalyticsPanel, ErrorsPanel, CrmPanel,
FinanceView), because all five import it. It carries §0.1 and §0.2 for those
views plus:

**KPI tiles two-up.** `auto-fit minmax(20rem, 1fr)` is a 180px minimum, so at
390px it collapsed to *one* column and a four-tile row became four screens.
`repeat(2, minmax(0, 1fr))` fits, and `minmax(0, …)` stops a long value forcing
its track wider than the screen. The value drops `--fs-3xl` → `--fs-xl`: "$12,480"
at 36px does not fit half of 390px, and an overflowing number is worse than a
smaller one.

**Two table treatments, chosen per table rather than one blanket rule.**

*(a) Default — stays a table, scrolls inside itself.* `display: block` makes the
`<table>` its own scrollport; the rows keep working because the browser re-wraps
them in an anonymous table box. The first column is `position: sticky; left: 0`
on an opaque `--ink-850` (the `.ft-card` surface), so a row never loses the thing
it is about while its numbers scroll past.

> **`white-space: nowrap` on those cells is load-bearing, not cosmetic.** The
> anonymous table box uses auto layout, which clamps it to the *available* width
> — so without it the table squeezes to fit, never overflows, and
> `overflow-x: auto` has nothing to scroll. Refusing to wrap raises the
> min-content width past the scrollport, which is what produces the scroll. This
> is commented in the file, because it looks like a tidy-up target.

*(b) `.an-table--cards` — stops being a table.* `<thead>` hidden, `<tbody>` a flex
column of cards, each `<td>` a label/value line printing `attr(data-label)`. A
cell with no `data-label` becomes a full-width row of its own (actions, meters),
and `<tfoot>` degrades to a wrapping summary strip.

**Filter rows scroll, they do not wrap.** `.ft-chips` / `.beta-filter-chips` /
the OrgPanel tab rail all become no-wrap scrolling rows bled to the card edge
with `margin-inline: -1.5rem; padding-inline: 1.5rem`. Wrapping turned one-line
controls into three or four ragged lines that pushed the content below the fold.
`.ft-card` padding also drops to `1.5rem` to match ToolView's own `.tv-card`
phone padding, so the bleed lands exactly on the card edge rather than 4px short.

Checkboxes are excluded from the 16px rule (a 44px checkbox is a grey slab) and
get `22px` square instead.

---

## 4. Coordination notes for the other two agents

1. **`--app-tabbar-h`.** Finance's sticky Save bar reads
   `bottom: var(--app-tabbar-h, 0px)`. If the shell agent publishes a bottom-tab-bar
   height under that name on `:root` or `.tool-view`, the bar lifts itself with no
   further change. Until then it sits at `bottom: 0` and **may be overlapped by
   the tab bar** — a one-number fix either way.
2. **A pre-existing CSS parse error in a file I do not own.**
   `src/components/MobileNav.css:14` contains a literal `*/` inside a CSS
   comment, which closes the comment early. esbuild reports it on every build:
   `▲ [WARNING] Unexpected bad string token` + `Unterminated string token`. It is
   the only CSS warning in the build and it is not from this pass. Flagging
   rather than editing — `MobileNav` belongs to the shell agent.
3. **ui primitives are shared by contract.** Touch sizing was added to Button,
   IconButton, Chip, Tabs, Field and Dialog. They are currently consumed only by
   MessagesView, so nothing else moved — but a future adopter inherits 44px
   controls on phones by design.

---

## 5. What I could not verify

**Nothing was verified visually.** This environment cannot sign in to Supabase;
all thirteen views require an authenticated session, there is no headless
browser, and adding one would break the no-new-dependencies rule. The dev server
was left running and untouched. Every change was reasoned per breakpoint from the
source and confirmed to survive the build (`an-table--cards`, `an-chart-scroll`,
`fin-chart-scroll`, `data-col=amount`, `ui-sheet-in`, `scroll-snap-type`,
`attr(data-label)` and 109 `44px` declarations are all present in `dist`).

Specifically **not seen rendered**:

| Component | Unverified |
|---|---|
| **MessagesView** | Whether `calc(100dvh - 24rem)` puts the composer at a comfortable height, or leaves a gap / needs a scroll. Whether the wrapping filter row reads better than the stack. |
| **FinanceView** | Whether the ledger card's three-line grid holds together with long category and workspace names. Whether `min-width: 56rem` is the right plot width for 12 vs 36 months. Whether the sticky Save bar collides with the shell's tab bar (see §4.1). |
| **Analytics / Errors** | Whether `min-width: 52rem` is readable for 90 days. Whether `padding-top: 5rem` is exactly enough room for the tooltip, or clips a three-line one. Whether the tooltip is reachable at all by tap (`.an-slot` is focusable, so it should be — untested). |
| **CrmPanel** | Whether a full-width `<select>` + `<input type="date">` per row reads as generous or as bloat at a realistic contact count. |
| **OrgPanel** | Whether the scrolling tab row is discoverable (no fade/affordance was added beyond the edge bleed). |
| **Categories** | Whether `auto-fill minmax(44px, 1fr)` gives a sensible icon-grid column count at 390px. |
| **Presets** | The accordion caret's optical alignment. Whether ten open sections still feel long enough that starting collapsed is worth the JS. |
| **Vocab** | Whether stacked rows make long brand lists too tall. |
| **Library** | Whether ~165px cards are usable thumbnails. Whether the sticky selection toolbar's `--tv-sticky-top: 8.5rem` clearance is right on a phone (that value is the shell's, tuned for desktop header height). |
| **Kanban** | Whether `85vw` + snap feels right or overshoots. Whether the fixed full-screen drawer escapes the shell's stacking context in practice. Drag-and-drop on touch was **not** exercised and was not in scope. |

All of these are single-number CSS adjustments; none is structural.

---

## 6. Gates

| Gate | Baseline | After |
|---|---|---|
| `npm test` | 579 / 40 files | **579 / 40 files** — including the 76 `ui` tests, unchanged |
| `npm run build` | clean | **clean** (the one CSS warning is `MobileNav.css`, §4.2) |
| `npx eslint .` | **254 problems** (238 errors, 16 warnings) | **254** — unchanged, none on any line this pass touched |

**Files changed — CSS (14):** `ui/Button.css`, `ui/IconButton.css`, `ui/Chip.css`,
`ui/Tabs.css`, `ui/Field.css`, `ui/Dialog.css`, `OrgPanel.css`,
`MessagesView.css`, `FinanceView.css`, `CategoriesManager.css`,
`CategoryPresetsManager.css`, `VocabDashboard.css`, `Library.css`,
`KanbanBoard.css`.

**Files changed — TSX (4):** `FinanceView.tsx` (chart wrapper + legend hoist,
`data-col`, `data-label`, two `an-table--cards`), `AnalyticsPanel.tsx` (chart
wrapper, `data-label`, two `an-table--cards`), `ErrorsPanel.tsx` (`data-label`,
one `an-table--cards`), `CategoryPresetsManager.tsx` (ten
`<div>`/`<h4>` → `<details open>`/`<summary>`).

**Untouched, as required:** `App.tsx`, `App.css`, `index.css`, `index.html`,
`ToolView.*`, `SupportWidget.*`, `WorkspaceMenu.*`, `MobileNav.*`,
`Landing/Auth/WaitlistGate`, and every workflow step component. No component I own
needed a TSX change for its own sake — `CrmPanel`, `OrgPanel`, `Library`,
`KanbanBoard`, `KanbanCardDetail`, `MessagesView`, `VocabDashboard` and
`CategoriesManager` are all CSS-only.

---

## Summary

1. Thirteen tool views made usable at 390px; all work is additive inside
   `@media (max-width: 640px)` / `(max-width: 1024px)` — desktop is unchanged.
2. Two root causes drove most of it: the 9px root makes rem-padded controls
   ~16–20px, and ToolView's (0,5,1) rule pinned every input at 14px, under iOS's
   16px zoom threshold. Both are documented in the files.
3. Everything interactive is floored at 44px — written as literal px on purpose,
   since a touch target is physical and must not drift with the root.
4. One shared block in `OrgPanel.css` fixes five views at once (touch, 16px,
   two-up KPIs, scrolling filter rows, and two table treatments).
5. Wide tables become either labelled cards (`an-table--cards` + `data-label`) or
   contained scroll with a sticky first column, picked per table.
6. Finance's ledger gets a bespoke three-line card via `data-col` +
   `grid-template-areas` — attribute-keyed, so re-ordering columns can't scramble it.
7. Dialogs (ui `Dialog`, Library rename, preset FieldModal) are bottom sheets;
   Kanban's card drawer is a full-screen sheet; all use `dvh` + `--safe-b`.
8. Presets' ten editor sections became native `<details>` — inert and open on
   desktop, collapsible on phones; they start *open*, since collapsing per
   breakpoint would need forbidden effect-setState.
9. Gates: 579 tests green (76 ui tests untouched), build clean, eslint flat at 254.
10. Nothing was seen rendered — no sign-in is possible here. §5 lists exactly what
    that leaves unverified; all of it is single-number tuning.
