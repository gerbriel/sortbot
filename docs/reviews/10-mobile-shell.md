# 10 — Mobile shell: navigation, chrome, and the logged-out screens

**The direction, verbatim:** *"think mobile first for user experience."*

Scope: the app **shell** only — `index.html`, the global token/reset layer, the
header, the full-page `ToolView` frame, the support widget, and the three
logged-out screens (Landing, Auth, WaitlistGate). Two other agents were working
in parallel on the tool pages and the four workflow steps; those files were not
touched. Nothing committed. No dependency added.

Breakpoints used throughout, shared across the three agents:
**≤ 640px phone**, **641–1024px tablet**, **> 1024px desktop (unchanged)**.

---

## 1. The navigation model

The header was a single row of 7–9 tool buttons plus the account menu. At 390px
it wrapped into a four-line black slab before anything else could be looked at.

| Width | Header keeps | Tools live in |
|---|---|---|
| **> 1024px** | wordmark + subtitle, **all tools**, Messages, account menu | the header row — **unchanged** |
| **641–1024px** | wordmark, **Messages** (badge), account menu | `<NavRail>` — a scroll-snapped second row on the same black bar |
| **≤ 640px** | wordmark, **Messages** (badge), account menu | `<MobileTabBar>` — fixed bottom tabs **Workflow / Library / Messages / More**, the rest behind **More** in a bottom sheet |

Three decisions are load-bearing:

**One list, four surfaces.** `navTools` in `App.tsx` is now the only place a tool
declares its label, icon, tooltip and role gate. The desktop header maps over it
(replacing nine hand-written buttons), and `mobileTools` — the same list minus
Messages, plus Workspace — feeds the rail, the tab bar and the sheet. Four
hand-maintained copies of a role-gated list is how the gates drift apart.

**CSS decides which nav shows, not `matchMedia`.** Both subtrees are in the DOM
and the inactive one is `display: none`, which also drops it from the
accessibility tree — so a screen reader never meets a tool twice, there is no
flash of the wrong nav on first paint, and there is no resize listener to keep in
sync. The desktop buttons are hidden by one rule,
`.app-header .nav-tool-btn:not(.nav-msg-btn) { display: none }`; `nav-msg-btn` is
the exemption handle added to `MessagesNavButton` so the unread badge survives at
every width.

**`NavRail` and `MobileTabBar` are two components for a stacking reason, not a
styling one.** `.app-header` is `position: sticky; z-index: 100`, which makes it a
stacking context: a `position: fixed` child is trapped at that level. The rail
belongs *inside* the header (it is the header's second row, same black surface);
the tab bar and its sheet must render outside it, or the More sheet would paint
underneath the support widget (z 5000) and the toasts (9000).

**The More sheet is the existing `Dialog` primitive**, not a hand-rolled panel —
it already carries `role="dialog"`, the focus trap, Escape, scrim-click dismissal,
the body-scroll lock and focus restoration. A parallel agent had meanwhile taught
`Dialog` to become a bottom sheet at ≤640px, so `.nav-sheet` overrides shrank to
two rules: a 70dvh cap (a menu should not claim 92% of the screen) and
`padding-bottom: calc(var(--space-4) + var(--safe-b))` on the body, because
`Dialog` pads its *footer* for the home indicator and this sheet has no footer.

`aria-current="page"` marks the active item on all four surfaces. "More" reports
itself active whenever the showing view lives behind it, so the bar says where
you are instead of going blank on, say, CRM.

---

## 2. What changed, per file

| File | Change |
|---|---|
| `index.html` | `viewport-fit=cover` on the viewport meta. This is what makes `env(safe-area-inset-*)` report anything but 0. **The CSP meta is byte-identical.** |
| `src/index.css` | New tokens `--safe-t/-b/-l/-r`, `--tabbar-row`, `--tabbar-h`, `--tap: 44px`. `text-size-adjust: 100%` on `html`. Global `-webkit-tap-highlight-color: transparent` + a deliberate `:active` wash under `@media (hover: none)`. A `≤640px` block that raises `--tabbar-h` **on `.app-container`** (not `:root`, so the shell-less waitlist gate keeps 0 and its support FAB does not float above a bar that is not there), puts every form control at `var(--fs-md)` (16px) and gives controls and buttons `min-height: var(--tap)`. |
| `src/App.tsx` | `navTools` / `mobileTools` / `navigateToView`; header buttons replaced by a map over `navTools` (identical markup, identical order); `<NavRail>` rendered inside `<header>`, `<MobileTabBar>` outside it; `nav-msg-btn` class on `MessagesNavButton`; a class on the storage meter's file count; the Auth "← Back" button given a 44px target and safe-area offsets. |
| `src/App.css` | New "Mobile shell" block: hide the tools ≤1024, one-row header, 44px header controls, safe-area gutters, hide the subtitle and the debug toggle ≤640, `--tabbar-h` clearance on `.app-main`, storage meter allowed to wrap, toasts lifted above the tab bar and the support FAB. |
| `src/components/MobileNav.tsx` *(new)* | `NavRail` + `MobileTabBar` + the `NavTool` type. Owns the sheet and the Messages badge (`useSupportThreads`). |
| `src/components/MobileNav.css` *(new)* | Mobile-first: base rules describe the phone, `min-width` queries take things away. Rail, tab bar, sheet list. |
| `src/components/ToolView.css` | Phone block: 1.5rem gutters, 2rem section gaps, `padding-bottom: calc(4rem + var(--tabbar-h))`, `min-height` in `dvh`, a stacking title row, a 44px Back control, 44px tabs, and a 44px/16px floor for any control a tool page renders. |
| `src/components/SupportWidget.css` | Phone block: FAB lifts by `--tabbar-h`; the panel becomes a full-screen `100dvh` sheet with safe-area padding and the composer pinned to the bottom; textarea at `--fs-md`; square 44px icon and send buttons. |
| `src/components/Landing.css` | Phone block (px-based, per AGENTS.md §1): 44px nav actions, a hero clamp that is actually live at phone width, stacked full-width CTAs, smaller section headings, 16px/44px signup fields. Plus a real bug fix — see §4. |
| `src/components/Auth.css`, `WaitlistGate.css` | 16px + 44px form controls, 44px link-buttons, safe-area gutters. |

`src/main.tsx` and `WorkspaceMenu.tsx` needed no change (`WorkspaceMenu.css` is
reached by the header rules in `App.css`).

---

## 3. Two global changes worth flagging to the other agents

Both live in `src/index.css` and therefore apply to files I do not own:

1. **`button, .button { min-height: var(--tap) }` at ≤640px.** This is the shared
   44px standard applied once rather than per component. It will grow dense
   chips and icon rows on phones; that is the intent, but a component that
   genuinely needs to opt out can override at its own specificity.
2. **`text-size-adjust: 100%` on `html`.** Chrome on Android "font boosts" text
   inside wide blocks. On a **9px root** that is not merely ugly — every
   `--space-*` is a rem tuned to that root, so boosted type overflows padding
   that did not grow with it. Measured here at 14px rendering as 22px.

---

## 4. Two real bugs found while verifying

**The landing's mock panels could not shrink.** `.mock-fields div`,
`.mock-preset-rows div` and `.mock-trow span` are grid items, which default to
`min-width: auto` and so refuse to go narrower than their longest word. At 360px
the two-column mocks ran ~30px past their panel, where `.ld-shot`'s
`overflow: hidden` silently clipped the right-hand cells — and the
`text-overflow: ellipsis` already on those cells could never engage. Fixed with
`min-width: 0`. Invisible at 390px, which is why it had survived.

**A CSS comment that ate a rule.** A comment in `MobileNav.css` contained the
token glob `--ink-*` immediately followed by `/--text-*`. The `*/` in the middle
of that closed the comment early and swallowed the whole `.nav-rail` rule, so the
rail rendered at every width. Caught only because the screenshot harness reported
`railDisplay: "block"` where it should have been `"none"` — it is invisible in
the source and the build does not warn. A scan of all nine CSS files I own now
shows no stray terminators, and the comment carries a warning not to reintroduce
one.

---

## 5. What was verified, and how

A `cdp-mobile.mjs` driver (copied from the session's `cdp.mjs`, plus
`Emulation.setDeviceMetricsOverride` at 390×844 @2× `mobile: true` and
`setTouchEmulationEnabled`) screenshots a page and audits it for horizontal
overflow, sub-44px targets and sub-16px inputs.

### Logged out — seen directly

| Screen | Before | After |
|---|---|---|
| Landing @390 | no page overflow; **9 sub-44px targets**, **6 inputs at 15px** | no overflow; **0 sub-44px targets** except four inline photo credits; no 15px inputs |
| Landing @360 | **6 elements clipped past the panel** | **0 overflowing elements** |
| Auth @390 | **5 sub-44px targets** (fields 42px, Sign In **31px**, Sign Up 17px) | **0** |

Screenshots read: `shot-ld-top.png` (nav collapses to logo + Request access +
Log in, all ≥44px; hero wraps to three lines at 28px; CTAs stacked full-width),
`shot-ld-pricing.png` (tier cards one column, comfortable padding),
`shot-ld-signup.png` (full-width 16px fields), `after-auth.png`.

The four remaining small targets are the Unsplash credit links in the footer —
inline links inside a sentence, which WCAG 2.5.8 explicitly exempts. Left alone.

### Signed in — could not log in, so verified indirectly

I have no credentials, so the header, rail, tab bar, sheet, `ToolView` and the
support panel were verified by **injecting the exact markup `App` renders into
the live landing page** (which already loads the app's single CSS bundle) and
photographing the real cascade at real breakpoints. Measured results:

| Width | rail | tab bar | header tools hidden | page overflow | targets < 44px |
|---|---|---|---|---|---|
| 360 | none | flex | 8 of 9 (Messages kept) | no | 0 |
| 390 | none | flex | 8 of 9 | no | 0 |
| 820 | flex | none | 8 of 9 | no | 0 |
| 1280 | none | none | 0 — **desktop unchanged** | no | (desktop sizes, untouched) |

Also measured: tab bar pinned at `y=787, h=57` in an 844px viewport;
`.app-main` bottom padding `64.8px` and `.tool-view` bottom padding `91.8px`
(both = their own padding + the 55.8px bar); Back control exactly 44px; the
support panel `[0,0,390,844]` with its composer bottom at 844 and its textarea
computing 16px; the unread badge fully inside the bar (13px below its top edge).

Screenshots read: `shell-390.png`, `shell-sheet.png` (the More sheet as a bottom
sheet with a two-column grid of eight tools, CRM filled black as active),
`shell-toolview.png`, `shell-support.png`.

**What this does not prove:** the React wiring — that tapping a tab actually sets
`activeView`, that the sheet closes on selection, that the badge count is live.
Those rest on `tsc`, on the fact that the tab bar and header consume the same
`navTools` array and the same `setActiveView`, and on a code read. A signed-in
smoke test of Workflow → Library → More → CRM → Back is still owed.

Also unverified: real iOS Safari. Chrome's emulator font-boosts some text even
with `text-size-adjust: 100%` (a DevTools quirk; real iOS does not boost), so the
screenshots run slightly large — a conservative bias for overflow checks, but it
means the 16px rule was confirmed from the declared CSS rather than the computed
value. `--fs-md` was confirmed to resolve to exactly 16px.

---

## 6. Notes on two brief items

- **"the toast stack respects safe-area top."** The stack in `App.css`
  (`.toast-stack`) is bottom-anchored, so what applies is the *bottom* inset; it
  now clears the tab bar, the support FAB and the home indicator via
  `--tabbar-h`. `ui/Toast.css` does have `top-*` viewport variants, but that file
  belongs to another agent and was left alone.
- **"`overscroll-behavior` on the parked workflow is untouched."** There is no
  `overscroll-behavior` anywhere in `src/` — nothing to preserve, and `.app-main`
  was not given one. The only one added is `contain` on the More sheet's body.

---

## 7. Gates

| Gate | Result |
|---|---|
| `npm test` | **579 passed / 40 files** (the brief's 570 plus tests added by parallel agents) |
| `npm run build` | clean (`tsc -b` + vite; only the pre-existing dynamic-import chunk notice) |
| `npx eslint .` | **254 problems** — exactly the baseline recorded before starting. `MobileNav.tsx`: **zero findings**. No new findings on any line I touched. |

---

## Summary

1. The header could not fit a phone; the tools now leave it below 1024px.
2. Tablet gets a scroll-snapped rail on the black bar; phone gets a fixed bottom
   tab bar (Workflow / Library / Messages / More) plus a More bottom sheet.
3. One `navTools` list in `App.tsx` feeds all four surfaces, so role gates and
   labels cannot drift; the nine hand-written header buttons are gone.
4. Which nav shows is pure CSS — no `matchMedia`, no first-paint flash, and the
   hidden one leaves the accessibility tree.
5. The sheet reuses the `Dialog` primitive, so focus trap, Escape and scrim
   dismissal came for free.
6. `--tabbar-h` (0 above 640px) is the single number every bottom-anchored
   surface clears: main, ToolView, support FAB, toasts.
7. 44px targets and 16px inputs are enforced globally, then restated where a
   component's specificity outranks the global rule.
8. Two real bugs fixed: unshrinkable grid items clipping the landing mocks at
   360px, and a CSS comment whose `*/` ate the entire `.nav-rail` rule.
9. Verified at 360/390/820/1280 — zero horizontal overflow, zero sub-44px targets
   except WCAG-exempt inline links; desktop provably unchanged.
10. Tests, build and lint all at or better than baseline. A signed-in smoke test
    and a real-iOS pass are the two things still owed.
