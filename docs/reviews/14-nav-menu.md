# 14 — One navigation surface: the workspace menu

> "I don't like this navigation bar, have these as dropdown options from the
> workspace dropdown menu. Also need them accessible on mobile."

The header was a wordmark plus **eleven tool buttons** (Manage Categories,
Category Presets, Library, Labels, Scan, Inbox, Vocabulary, Analytics, CRM,
Finance, Board) and then the account trigger, wrapping onto a second line. Below
1024px those eleven were hidden and re-rendered as a scrolling **NavRail**;
below 640px the rail was hidden and they were re-rendered *again* inside a
**More sheet**. Three renderings of one list, three places for a role gate to
drift, and a header that never stopped growing.

There is now **one** surface. The header is a wordmark and the workspace
trigger, at every width. The trigger opens the menu that holds everything.

---

## 1. The menu model

`WorkspaceMenu` is the whole navigation. It is built from ONE list in `App.tsx`
(`navItems`), where each entry carries its `group`, `icon`, `title` and role
gate — so a tool is declared exactly once and the gate cannot drift between
surfaces, because there are no other surfaces.

| Section | Rows | Gate |
|---|---|---|
| *(identity)* | workspace name + role badge + email | always |
| *(no heading)* | **Back to workflow** | only while `activeView !== 'workflow'` |
| **Work** | Library · Labels · Scan · Inbox/Messages *(unread badge)* | Labels/Scan/Library always; Messages hidden when the support tables are missing |
| **Setup** | Manage Categories · Category Presets · Workspace dashboard | dashboard needs a resolved org (not legacy mode) |
| **Founder** | Vocabulary · Analytics · CRM · Finance | Founding Workspace **owner/admin** |
| **Founder** | Board | Founding Workspace, any role |
| *(danger)* | Sign out | always |

Groups are `role="group"` with an `aria-label`, separated by `role="separator"`
rules; the visible heading is `aria-hidden` so it is not announced twice.

The **active view** is marked with `aria-current="page"`, a filled `--ink-750`
row and a check. Deliberately *not* the accent-black fill the old More sheet
used: a solid black row inside a white popover reads as a button, and it would
have forced the unread badge and the icon to invert along with it.

Selecting a row closes the menu and sets `activeView`. Selecting the row you are
already on **just closes** — no toggle-back, which is what the old header
buttons did and what made "click Library twice" surprising.

**One trigger, two openers.** `open` is lifted into `App` (`navMenuOpen`) so the
phone tab bar's **More** tab opens the *same component with the same list*. The
separate More-sheet implementation in `MobileNav` is deleted.

**Unread count.** It rides on the trigger (`.nav-badge`, the header's existing
disc) so the one signal that cannot wait for a menu to be opened is still on the
bar, and again on the Inbox row (`.wsmenu-badge`, same geometry restated for a
white surface). The `useSupportThreads` hook still lives in a component rendered
only inside the signed-in header — now `AccountNav` instead of the deleted
`MessagesNavButton` — so a logged-out visitor on the landing page never queries
`support_threads`.

### Two load-bearing implementation notes

**It is portaled to `document.body`.** `.app-header` is
`position: sticky; z-index: 100`, which makes it a stacking context: a
`position: fixed` child of it is trapped at 100 relative to the page, and the
phone tab bar is a sibling at 200. Rendered in place, the bottom sheet would
paint *underneath the very tab bar that opened it*. The portal also drops the
popover out of the nav's forced-white cascade — which is why the
`.app-header .wsmenu-menu { color: … }` opt-outs this file used to need are gone
rather than rewritten. There is nothing left to opt out of.

**Its geometry is CSS-only.** The desktop anchor is handed to CSS as
`--wsmenu-top` / `--wsmenu-right` custom properties, never as inline
`top`/`right`, because an inline declaration would outrank the
`@media (max-width: 640px)` sheet rules. Custom properties are inert until
something reads them, so the phone simply ignores them. No `matchMedia`, no
resize state, no first-paint flash of the wrong shape.

**`data-tv-modal` on the popover.** `ToolView` registers a document-level
Escape-to-workflow listener when a view mounts, i.e. *before* the menu's. A
`stopPropagation` cannot stop a sibling listener on the same node, so without
this the Escape that closes the menu would also navigate out of the view behind
it. `data-tv-modal` is the codebase's existing park signal (Library's rename
prompt and the preset editor already use it).

---

## 2. Keyboard map

| Key | On the trigger | Inside the menu |
|---|---|---|
| `Enter` / `Space` | opens **and focuses the first row** (detected as `click.detail === 0`) | activates the row |
| pointer press | opens **without moving focus** | activates the row |
| `ArrowDown` | opens, focuses first | next row, wrapping to the first |
| `ArrowUp` | opens, focuses **last** | previous row, wrapping to the last |
| `Home` / `End` | — | first / last row |
| `Escape` | — | closes, focus returns to the opener (and `ToolView` keeps its hands off) |
| `Tab` | — | closes; focus is handed back to the trigger only if it was inside the popover |
| press outside | closes | closes |

`aria-haspopup="menu"` + `aria-expanded` + `aria-controls` on the trigger;
`role="menu"` on the list, `role="menuitem"` on every row (all `tabindex="-1"`,
roving focus). "Opener" is whatever had focus when the menu opened — the header
trigger, or the phone's More tab — so focus returns to the right control either
way, and `App` parks that same element in `viewTriggerRef` so `ToolView`'s Back
and Escape land the user back where the trip started.

Row heights: 36px base, `var(--tap)` (44px) under `@media (pointer: coarse)` —
which covers the phone sheet and a touch laptop without either being a
breakpoint.

---

## 3. What was removed

| Gone | Where | Why |
|---|---|---|
| 11 header tool buttons | `App.tsx` | they are menu rows now |
| `MessagesNavButton` | `App.tsx` | replaced by `AccountNav`, which mounts the same hook for the trigger badge |
| `toggleView()` | `App.tsx` | the header buttons it served are gone; `handleNavSelect` replaces it |
| `navTools` / `mobileTools` | `App.tsx` | one `navItems` list |
| `NavRail` component + `.nav-rail*` CSS | `MobileNav.tsx/.css` | it duplicated a header row that no longer exists |
| More sheet (`Dialog` + `NavTool` + `.nav-sheet*` CSS) | `MobileNav.tsx/.css` | More opens the workspace menu instead |
| `.nav-tool-btn`, `.nav-tool-btn--on`, `.nav-msg-btn` rules | `App.css` | no such buttons |
| `@media (max-width: 1024px) { .nav-tool-btn:not(.nav-msg-btn) { display: none } }` | `App.css` | nothing left to hide at a breakpoint |
| `.app-header .wsmenu-menu` colour opt-outs | `WorkspaceMenu.css` | the popover is portaled out of the nav |

Kept working and re-checked: `goToWorkflow` / Escape-to-back in `ToolView`, the
`SupportWidget` FAB, toasts, `--tabbar-h` clearance, the `≤640px` header rules,
the tab bar's Workflow / Library / Messages tabs and its unread badge.

One deliberate widening: `.wsmenu-name`'s phone clamp went 7rem → 10rem. The
trigger used to share the bar with a Messages button; alone, 7rem truncated
"Founding Workspace" to "Foundi…" with 60px of dead space beside it.

---

## 4. What was verified, and how

No credentials, so the signed-in header and menu were verified the way
`10-mobile-shell.md` did it: **the exact markup the components render was
injected into the live landing page** (which already loads the same CSS bundle)
and photographed at real breakpoints, with the real cascade. Driver:
`scratchpad/nav.mjs` (CDP, `setDeviceMetricsOverride` + touch emulation).

| Width | menu shape | scrim | tab bar | row height | pop fits | page overflow |
|---|---|---|---|---|---|---|
| 1280×900 | popover `272×650` at (994, 44) | none | none | 36px | yes | none |
| 820×1180 | popover `272×762` at (534, 55) | none | none | **44px** (coarse pointer) | yes | none |
| 390×844 | bottom sheet, full width, 80dvh, scrolls | block | flex | 44px | yes | none |
| 360×780 (closed) | — | — | flex | 44px trigger | — | none |

**Screenshots read** (`nav-1280.png`, `nav-820.png`, `nav-390.png`,
`nav-390-closed.png`):

* **1280** — header is wordmark + one trigger, no wrap, no second line. Popover
  hangs off the trigger's right edge: identity block (name + amber OWNER pill +
  email), Back to workflow, then WORK / SETUP / FOUNDER with hairline dividers,
  CRM filled grey with a check, Inbox carrying a red `3`, Sign out red at the
  bottom. Every row, icon and badge legible — the popover is white-on-black-nav
  and nothing inherited the nav's white foreground.
* **820** — identical popover, rows grown to 44px because the emulated pointer
  is coarse. No rail, no tab bar.
* **390 open** — bottom sheet: full width, rounded top corners, page dimmed by
  the scrim, tab bar covered. 14 rows at 44px, badge and check both readable.
  The founder's full list (14 rows) exceeds 80dvh and **scrolls**, so Sign out
  is one flick down; every non-founder list fits without scrolling.
* **390 closed** — wordmark + trigger on one black row, trigger 44px, workspace
  name reads "Founding W…", tab bar showing Workflow / Library / Inbox(3) /
  **More** with More marked active (the view behind it was CRM). No horizontal
  overflow at 390 or 360.

**The keyboard model was also exercised for real**, not just read: a throwaway
suite against the in-house `ui/testUtils` harness (no new deps) covering trigger
ARIA + badge, pointer-open-does-not-focus vs keyboard-open-focuses-first,
Arrow/Home/End roving with wrap at both ends, Escape closing + restoring focus
to the trigger, select-closes-and-reports vs active-row-only-closes, the three
group labels + separators + `aria-current` + `data-tv-modal`, and
outside-press/Tab dismissal. **7/7 passed.** The file was then removed from the
repo (test files were outside this pass's edit scope) and is parked at
`scratchpad/WorkspaceMenu.test.tsx` — it drops into `src/components/` unchanged
if you want it as permanent coverage, which I would recommend.

**What this does not prove:** that `activeView` actually changes in the running
app, and that the More tab opens the sheet in a real session. Those rest on
`tsc`, on the single shared `navItems` list, and on the behavioural suite above.
A signed-in pass of Workflow → menu → CRM → Back → More → Library is still owed.

**Gates:** `npm test` 1019/1019 · `npm run build` clean ·
`npx eslint .` 252 problems (unchanged baseline, none in the new code).

---

## 5. Paste-ready CLAUDE.md lines

**§5 (folder structure) — replace the `WorkspaceMenu` and `MobileNav` entries:**

```
│   │   ├── WorkspaceMenu.tsx      # THE app's only navigation surface. Header trigger (workspace name +
│   │   │                          # unread badge) + a portaled role="menu" popover: identity, "Back to
│   │   │                          # workflow", Work/Setup/Founder groups, Sign out. Built from App's ONE
│   │   │                          # `navItems` list. Controlled `open` so MobileNav's More tab opens the
│   │   │                          # SAME menu. Portaled to <body> (the header is a z-index:100 stacking
│   │   │                          # context, so an in-place sheet would paint under the tab bar) and
│   │   │                          # anchored via --wsmenu-top/--wsmenu-right custom props (inline
│   │   │                          # top/right would outrank the ≤640px sheet rules). Carries
│   │   │                          # `data-tv-modal` so Escape closes the menu without ToolView also
│   │   │                          # navigating back. Roving focus, Escape/Tab/outside-press dismissal.
│   │   ├── WorkspaceMenu.css      # Trigger (inverted nav) + popover/bottom-sheet (tokens; portaled, so
│   │   │                          # no .app-header opt-outs needed). 36px rows, 44px at pointer:coarse.
│   │   ├── MobileNav.tsx          # ≤640px bottom tab bar ONLY (Workflow/Library/Messages/More). More
│   │   │                          # opens WorkspaceMenu. NavRail (tablet) and the More sheet were
│   │   │                          # deleted — they re-rendered a list the menu now owns.
│   │   ├── MobileNav.css
```

**§6 (route map) — replace the nav sentence under the table:**

```
Navigation is ONE surface at every width: the header's workspace trigger opens
<WorkspaceMenu> (a dropdown > 640px, a bottom sheet ≤ 640px), built from the
single `navItems` list in App.tsx — each entry carries its group, icon, title
and role gate. Below 640px a bottom tab bar adds Workflow / Library / Messages,
and its More tab opens that same menu. The header itself is a wordmark plus that
one trigger at every width.
```

**§15 (what's done) — append:**

```
- ✅ **Navigation consolidated into the workspace menu (Sept 2026)** — the header's ELEVEN tool buttons (which wrapped onto a second line), the tablet `NavRail` and the phone More sheet are all gone; the header is a wordmark plus the workspace trigger at every width, and every destination is a row in `WorkspaceMenu`: identity, "Back to workflow" (only inside a tool view), then Work (Library/Labels/Scan/Inbox) · Setup (Categories/Presets/Workspace dashboard) · Founder (Vocabulary/Analytics/CRM/Finance/Board), then Sign out. ONE `navItems` list in App.tsx feeds it, so a role gate is declared once. Full menu semantics: `aria-haspopup="menu"`/`aria-expanded` trigger, `role="menu"`/`menuitem`/`separator`, roving Arrow/Home/End with wrap, Escape restores focus to the opener, Tab and outside-press dismiss, keyboard opens focus the first row and pointer opens do not. The unread count rides the trigger AND the Inbox row. THREE THINGS ARE LOAD-BEARING: it is portaled to `<body>` (the header is a `z-index:100` stacking context, so an in-place bottom sheet would paint under the tab bar — the portal also removes the need for the old `.app-header .wsmenu-menu` colour opt-outs); its desktop anchor is passed as `--wsmenu-top`/`--wsmenu-right` custom properties, never inline `top`/`right`, or it would outrank the ≤640px sheet rules; and it carries `data-tv-modal` so ToolView's document-level Escape-to-workflow stays parked while the menu is open. The phone tab bar keeps Workflow/Library/Messages and its More tab opens this same component (`navMenuOpen` lifted into App) — one component, one list. `toggleView`, `MessagesNavButton`, `NavRail`, `NavTool`, `mobileTools`, `.nav-tool-btn*`, `.nav-rail*` and `.nav-sheet*` were all deleted. Verified by injecting the rendered markup into the live landing page at 1280/820/390/360 and by a 7-case keyboard suite on the in-house test harness (docs/reviews/14-nav-menu.md).
```
