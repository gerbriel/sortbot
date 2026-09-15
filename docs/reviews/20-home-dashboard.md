# 20 — Home: a dashboard to land on, and a way to put a batch down

**Date:** 15 Sept 2026 · **Scope:** `src/components/HomeDashboard.tsx` + `.css` +
`.test.tsx` (new), `src/lib/home.ts` + `.test.ts` (new), `src/App.tsx` (wiring only),
`src/App.css` (one rule), `src/components/MobileNav.tsx` (one tab) ·
**Nothing committed. No SQL was run. No dependency added.**

The ask: *"a user dashboard full of widgets so they can exit a batch, or when they log in
they could use other features — labels, scan, inbox, managing presets, etc."*

---

## 1. What was actually wrong

The app opened on Step 1 of the workflow and stayed there. Everything else it can do —
Labels, Scan, the Library, the inbox, presets, categories, the marketplaces matrix, the
founder tools — lived behind one menu, so the product's whole surface area was invisible
unless you went looking for it. And there was no way to *stop*: the only control that
released a batch was "Clear Batch", a `window.confirm` at the bottom of Step 4, which
reads as destructive because it is spelled as destructive.

Two separate problems, one shape: there was nowhere to be that was not inside a batch.

---

## 2. The decision everything else follows from

**`'home'` is an `ActiveView`, and the workflow is parked behind it exactly as it is
behind every tool view.**

`<main className="app-main" hidden={activeView !== 'workflow'}>` already existed (§6, the
Sept 2026 full-page-views pass). Opening the Library does not unmount Step 2's grid, does
not cancel an upload, does not drop Step 3's debounced saves. Home inherits all of that
for free, which is why **"exit batch" costs nothing**: the batch stays mounted, stays
restorable, and **Resume is a re-reveal, not a re-open** — no fetch, no rebuild, no
`handleOpenBatch`.

That is also why Home is deliberately **not** a `<ToolView>`. Every tool view leads with
"Back to workflow" and binds Escape to it. There is nothing to go back *from* on the page
you arrive at; a Back control there would be a control that lies. Home borrows ToolView's
spacing scale — restated in `HomeDashboard.css` with the numbers and the reasons — and
nothing else.

The one control that genuinely ends a session is **Start a new batch**, and it is a
two-step `ConfirmAction`, not a `confirm()` (Do Not #12). `handleClearBatch` was split:

```
startNewBatch()      ← the whole teardown, no dialog
handleClearBatch()   ← confirm() + startNewBatch()
```

Step 4's button is byte-for-byte the behaviour it had; the dashboard calls the
confirm-free half because it has already asked, in a styled two-step it can test.

---

## 3. The seven widgets, and what each one refuses to do

| Widget | Source | Hides itself when |
|---|---|---|
| **Current batch** | props (`processedItems`) — no fetch | never; empty → `EmptyState` + Upload photos |
| **Recent batches** | `fetchWorkflowBatchesMeta()` | never; empty or failed → empty state |
| **Inbox / Messages** | `useSupportThreads` | `available === false` (migration not run) |
| **Tools** | the `navItems` prop | a tool the user has no role for is simply not in the list |
| **Storage** | App's `storageInfo` | App has no reading yet |
| **Marketplaces** | `fetchOrgMarketplaces` + `fetchPublications` | pre-migration, or no marketplace enabled |
| **Last 7 days** | `fetchAnalyticsSummary(7)` | not a founding admin, or unavailable |

**Every widget fails quiet.** A failed read renders that widget's empty state, never an
error wall — this is the first screen after sign-in, and a `listing_publications` table
that has not been migrated yet must not be the first thing a new shop sees.

`hidden` is a real state, distinct from "loaded and empty": a feature that is *not
installed* must not render an empty state inviting the user to use it.

Four independent `Loadable`s rather than one, so a slow marketplaces round trip cannot
hold the recent-batches list behind it. One effect, one `cancelled` flag, keyed on
`[orgId, activeBatchId, refreshTrigger, isFounder]` — `refreshTrigger` because App
already increments it on exactly the events that move these numbers.

### Three things worth naming

**Resume lands on the step the work is on, not the furthest one.** It reuses
`resumeStep(items)` from `lib/phoneSteps.ts` — the helper the phone stepper already uses,
whose whole point is that every restore path sets all four arrays from one list, so
`furthestStep` would send every reopened batch to Export.

**Opening a recent batch has to LEAVE Home, explicitly.** `handleOpenBatch` ends in
`setShowLibrary(false)`, which only returns to the workflow when the Library is the view
actually showing — called from Home it is a no-op and the user would sit on the dashboard
watching nothing happen. App wraps it in `onHomeOpenBatchStable`, which switches the view
first so the workflow is on screen while the async open runs; `handleOpenBatch` still
picks the step itself, from `resumeStep`.

**Opening a recent batch costs one extra read, deliberately.**
`fetchWorkflowBatchesMeta` projects `workflow_state` away (it is the ~54 MB column), and
handing `handleOpenBatch` a row without it sends it down the DB-rebuild path instead of
the restore path. The row resolves the full batch through `getWorkflowBatch(id)` first,
then hands the full row to App. There is a double-click ref guard for the
same reason `isOpeningBatchRef` exists.

**The open batch is filtered OUT of Recent batches** — it has its own widget directly
above, and listing it twice makes the page look like it has lost track of where you are.
Its display *name* is read from the same response, so App did not need a new piece of
state to hold a batch name it has never held.

**Quick actions are built FROM `navItems`**, in a fixed display order, filtered by id.
A role gate is therefore declared exactly once (§6) and a tool a user cannot reach cannot
appear as a tile. `phoneOnly` rows are dropped — they stand in for floating controls and
have no view to open. "Marketplaces" is the one synthetic tile: it is not a view, it is
the Workspace dashboard on a particular tab, so it rides alongside the row that opens
that page and calls App's existing one-shot `workspaceTab` hint.

---

## 4. Navigation

- A `navItems` row, first in the Work group: **Home** (`LayoutDashboard`).
- The **wordmark is the way home**, the way a masthead is on any site. A real `<button>`,
  not an `<a>`: there is no router and no URL for an anchor to point at, and a hrefless
  anchor is not focusable. It carries `aria-current="page"` on Home, and — because the
  nav is the app's one deliberately inverted surface — an explicit literal light
  foreground and a **white** focus ring (`--accent` is black and would be invisible).
- The phone tab bar becomes **Home / Workflow / Messages / More**. Library gave up its
  slot: a phone has four, Home is where a session now starts and ends, and the Library is
  one tap away from Home as both a widget and a menu row — whereas Home would otherwise be
  reachable only through "More", which is the one destination that must not be.
- `activeView` now initialises to `'home'`, and both sign-out resets land there too, so
  the next sign-in on a shared machine starts on the dashboard rather than mid-workflow.
- Unchanged: `goToWorkflow`, ToolView's Back and Escape, the workspace menu's "Back to
  workflow" row, `goToPhoneStep`, and the Step 4 Clear Batch button.

---

## 5. Pure helpers (`src/lib/home.ts`, 23 tests)

Split out for the same reason `phoneSteps.ts` was: a count that is wrong is invisible
until a founder notices the page disagrees with the Library.

- `batchSummary(items)` — photos, true multi-photo groups, **listings via the shared
  `buildGroupArray`** (so the number can never disagree with the step it links to), and
  categorized count.
- `recentBatchRows(meta, activeBatchId, limit)` — skips the open batch, preserves server
  order (`updated_at DESC`) rather than re-sorting a string date, clamps `current_step`
  into 1–4 (the column has no CHECK behind it), and treats the literal four-character
  string `"null"` as no name — a real shape in this database (§14 #6) that `||` cannot
  catch and that would otherwise print "null" as a batch title on the landing page.
- `publicationCounts(rows)` — one count per status, plus `total` (PLACEMENTS) and
  `listings` (DISTINCT products). Those are different numbers the moment a shop
  cross-lists, and conflating them makes "12 posted" read as twelve garments when it is
  four garments on three marketplaces.
- `storageReadout(bytes, limitGb)` — clamps the bar at 100% while still reporting
  `nearLimit` off the raw ratio, so an over-plan bucket says "nearly full" instead of
  drawing a 310%-wide bar; never divides by a zero or negative limit.

---

## 6. First real adoption of `src/components/ui/`

The primitive system has shipped since Sept 2026 imported by almost nothing (§16). This
page uses `StatTile` / `StatGrid`, `EmptyState`, `Button`, `ConfirmAction`, `Badge` and
`Skeleton` as they are. **No primitive was edited.** One override was needed and is
documented at the rule: `.home-stats` narrows `StatGrid`'s minimum track from the
primitive's 130px to 10rem (90px), because every stat row on this page is exactly three
tiles and at 130px the narrow column fits two — the third dropped to a second row and
left a hole beside it. `auto-fit` collapses the tracks it does not fill, so three tiles
share the row whatever the card is wide.

Nothing else restates a primitive's colour or size (§18 #26).

---

## 7. What the screenshots caught

No harness can sign in, so the page was verified the usual way: the component's real
rendered DOM (produced through `ui/testUtils`) injected into a page that links the
**built** `index.css` and `HomeDashboard` chunk CSS, screenshotted in headless Chrome at
1280 / 820 / 390 with a probe for `scrollWidth`, `clientWidth` and every sub-44px target.

Three things were wrong on screen and are fixed:

1. **Stat rows wrapped 2 + 1.** `StatGrid`'s 130px minimum. → the `.home-stats` override
   above. Fixed in all three cards at once.
2. **Tool tile labels truncated to "Manage Cate…".** First attempt — `-webkit-line-clamp:
   2` — made it *worse*: `display: -webkit-box` turns the label into an old-spec flexbox
   whose anonymous text child sizes to max-content, so the text stayed on one line and was
   clipped mid-word with no ellipsis at all.
3. **The real cause, found by probing the computed style rather than guessing:**
   `index.css` pins `white-space: nowrap` on every `button`, and the label is inside one,
   so it had inherited `nowrap` the whole time and could never wrap. `white-space: normal`
   on the label is the entire fix; no vendor property is involved. This is worth
   remembering — anything multi-line inside a `button` in this codebase has to opt out.

Final measurements:

| Width | `scrollWidth` = `clientWidth` | Targets < 44px | Layout |
|---|---|---|---|
| 1280 | 1280 = 1280 ✓ | n/a (pointer) | 3 columns; Current batch and Tools span 2 |
| 820 | 820 = 820 ✓ | n/a (pointer) | 2 columns; the spanned cards drop to span 1 |
| 390 | 390 = 390 ✓ | **none** | 1 column, 2-up tiles, stacked full-width actions |

Screenshots: `img-20/home-1280.png`, `img-20/home-820.png`, `img-20/home-390.png`.
(The tab bar appears mid-page in the 390 shot — it is `position: fixed` and the capture is
full-page; on screen it is at the bottom edge.)

---

## 8. Gates

| | Before | After |
|---|---|---|
| `npx vitest run` | 1572 / 73 files | **1619 / 75 files, green** |
| `npm run build` | clean | **clean** (HomeDashboard is its own ~14 kB chunk) |
| `npx eslint .` | 252 | **252 — unchanged** |

---

## 9. Open questions and what was deliberately not done

- **Nothing here has been seen signed in.** Same standing limitation as §14 #26: the
  screenshots prove the cascade and the real rendered markup, not the React wiring against
  live data. Owed: sign in, land on Home, Resume, Start a new batch, open a recent batch,
  and the same on a phone.
- **No `EmptyState` variant was missing**, but `StatTile` has no "loading" flavour — the
  widgets use `Skeleton` rows instead of skeleton tiles, which reads slightly differently
  from the settled state. A `loading` prop on `StatTile` would be the tidier answer and
  belongs in the primitive, not here.
- **Home does not refetch on becoming visible again.** It refetches on
  `libraryRefreshTrigger`, which App increments on upload / group / save / batch delete —
  the events that move these numbers. A trip to Finance and back does not re-read. That is
  deliberate (it is three round trips) but it means a batch renamed in the Library shows
  its old name on Home until the next trigger.
- **The greeting uses the email local part.** It is the only name the app has; a real
  display name would need a profile field nobody has asked for yet.
- **`activeBatchNumber` is still a prop** even though the name is resolved from metadata,
  because a batch created in this session has no `workflow_batches` row read back yet and
  the number is the only thing to show.
