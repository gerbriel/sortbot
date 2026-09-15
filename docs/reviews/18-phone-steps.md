# 18 — One step at a time on a phone

**Date:** 15 Sept 2026
**Scope:** `src/App.tsx`, `src/App.css`, new `src/components/PhoneStepper.tsx` + `.css`, new
`src/lib/phoneSteps.ts` + `.test.ts`, `src/components/ProductDescriptionGenerator.tsx` (one effect).
**Gates:** 1,133 tests / 56 files green · `npm run build` clean · `npx eslint .` 252 problems (the
recorded baseline, unchanged).
**Not committed.**

---

## 1. The report

> "like steps in order, for ease of use"

On a phone the four workflow steps are one long page: the upload zone, then a 56vh photo grid with a
sticky category dock, then the description editor with its own sticky nav dock, then export. Two sticky
docks compete for the bottom of a 390px screen and the page is ~4,000px of scroll before the founder
reaches the thing they were trying to do.

Follow-up from the founder while this was being built:

> users must be able to go forward AND back between steps on their own, not only forward via Continue.

Both are in.

---

## 2. What was built

### 2.1 Nothing unmounts — the sections are hidden, not conditional

This is the load-bearing decision and it is the same one §6 already makes for the tool views. All four
`<section>`s render exactly as they do today; below 640px the three that are not the active step get
`display: none` from CSS alone.

`<main>` carries `data-phone-step={shownStep}` at every width, each section carries `data-step="1|2|3|4"`,
and one appended block in `App.css` does the hiding:

```css
@media (max-width: 640px) {
  .app-main[data-phone-step="1"] > section[data-step]:not([data-step="1"]),
  … one rule per step …
  { display: none; }
}
```

Specificity is (0,4,1) against `.step-section`'s (0,1,0), and no step section carries an inline `display`,
so it lands. Above 640px **the rules do not exist**, which is what makes desktop byte-identical — there is
no `matchMedia`, no resize listener and no width in JavaScript anywhere in this feature.

Because nothing unmounts, an upload in flight, ImageGrouper's selection, Step 3's debounced saves and the
recogniser session all survive a step change, exactly as they survive opening the Library.

### 2.2 Reachability is a pure module — `src/lib/phoneSteps.ts` (24 tests)

`reachableSteps(counts)` mirrors the render conditions in `App.tsx` by hand: 1 always, 2 iff
`uploadedImages.length > 0`, 3 iff `sortedImages.length > 0`, 4 iff `processedItems.length > 0`. A step
with no section on the page must not be offered, or the stepper navigates to a blank screen.

It is **not assumed contiguous**. In practice every restore path sets all four arrays from one list, but
the render conditions are three independent `length > 0` tests, so `reachableSteps` stays a filter and
every other helper walks the list it returns rather than doing arithmetic on step numbers. A list like
`[1, 2, 4]` degrades into "never jump the user forward", not into a step that is not rendered.

Also exported: `furthestStep`, `clampStep`, `nextReachable`, `prevReachable`, `STEP_LABELS`
(Upload / Group / Describe / Export, with the long forms), `ALL_STEPS`.

### 2.3 The four state rules

| Event | Rule | Why |
|---|---|---|
| Startup restore (both branches: hydrated, and the localStorage backup) | `resumeStep(items)` | The step with work left: no items → 1, none categorized → 2, any categorized → 3; never 4 (see §7). |
| `handleOpenBatch`, after the try/catch settles the final list | `resumeStep(items)` | Same. |
| `handleImagesUploaded`, after the items are appended | `setPhoneStep(s => s === 1 ? 2 : s)` | **The only auto-advance.** Step 2 has just become reachable and Step 1 is done. |
| `handleClearBatch`, `handleBatchDeleted` (active batch) | `1` | Nothing left to show. |
| Everything else (sign-out, the 3s auto-clear after Save Batch, an ungroup that drops the last category) | nothing — the clamp handles it | See below. |

**2 → 3 and 3 → 4 are deliberately NOT automatic.** Step 3 becomes reachable the moment the first category
is assigned, and yanking someone out of the grid mid-grouping is exactly the wrong move. Those are the
user's Continue tap.

All three restore sites read the counts through the `liveArrayRef` views (`uploadedImagesRef.current` etc.),
which are fresh the instant a store setter returns (§14 #14) — the render-captured arrays in those closures
are still empty at that point.

### 2.4 The clamp is derived, not corrected

```ts
const [phoneStep, setPhoneStep] = useState<WorkflowStep>(1);
const stepCounts = { uploaded: …, sorted: …, processed: … };
const phoneReachable = reachableSteps(stepCounts);
const shownStep = clampStep(phoneStep, stepCounts);   // ← what data-phone-step gets
```

The stored value is what the user last asked for; `shownStep` is what is on screen. Deriving it at render
rather than correcting the state in an effect means it cannot be stale for a frame (the brief's fallback
option, taken from the start), it needs no functional `setState` inside an effect (which react-hooks v7
would question), and **every teardown path is covered without teardown code**: sign-out, Clear Batch and
the post-save auto-clear all empty the arrays, so `clampStep` returns 1 on the very same render. The two
explicit `setPhoneStep(1)` calls exist only to reset the stored intent, not to fix the display.

`clampStep` falls **downward** — losing Step 4 lands on Step 3, not on Step 1 — and never promotes past a
gap. One test asserts the invariant across every step × count-shape combination: the result is always a
reachable step.

### 2.5 The stepper — `PhoneStepper.tsx`

`<nav aria-label="Workflow steps">` → `<ol>` → four `<button>`s, rendered as the first child of
`<main>`. Disc + short label, 44px tall (a literal `px`, per §1 — a rem against the 9px root would drift
off the accessibility floor the next time the root is retuned).

- **Every reachable step is tappable, in both directions.** Tapping a completed step goes back; tapping a
  later reachable step jumps ahead. Only an unreachable step is `disabled` (plus `aria-disabled`).
- `aria-current="step"` on the active chip; solid `--accent` disc with the `--ink-950` label, which is the
  convention that makes the palette swappable in either direction.
- Steps behind the furthest reachable one show a lucide `Check` instead of their number — except the active
  one, which keeps its number, so going back never looks like going forward.
- Accessible name is "Group — step 2 of 4" (the visible label first, so "click Group" still works), with
  ", not available yet" appended on a dead chip. The suffix is a visually-hidden span defined in
  `PhoneStepper.css`; there is no global sr-only class in this app's CSS (the `ui/` primitives own one and
  that system is not adopted).
- **It is not sticky.** The black header already is, at `z-index: 100`, and owns a height this file does not
  know, so a second sticky bar slides underneath it and reads as having vanished (§14 #29). Instead, every
  step change calls `window.scrollTo({ top: 0 })`, which puts the stepper back under the header anyway.

Tokens only, no hex. Written mobile-first like `MobileNav.css`: the base rules describe the phone and one
`@media (min-width: 641px)` takes the stepper and the Continue rows away.

### 2.6 The Back / Continue row — `PhoneStepNav`

Rendered as the last child of all four sections. One row: **Back** at the left (`ArrowLeft`, secondary,
44px, `flex: 0 0 auto`), **Continue to <next>** filling the rest (`ArrowRight`, accent fill). Step 1 has no
Back; Step 4 has no Continue. When the next step is not reachable, a muted one-line hint takes Continue's
place — "Upload photos to continue.", "Assign a category to at least one group to continue.", "Nothing to
export yet."

Back and Continue both use `prevReachable`/`nextReachable`, so a gap is skipped rather than offering a step
that is not on the page.

**It is not covered by either sticky dock, and this is structural rather than a magic number.** A sticky
element stops sticking once its containing block scrolls past. Step 2's category dock is the last child of
`.step2-split`, and Step 3's nav dock is a grid item of `.product-description-container`; the Continue row
sits *after* both containers. By the time it is on screen, its dock has settled into flow above it.
Confirmed in `390-step2-full` and `390-step3-full`.

### 2.7 Bottom tab bar — not changed

The Workflow tab could carry the step number as a badge, but it needs a new prop through `App` → 
`MobileTabBar`, a badge element, and rules in `MobileNav.css`, which is outside the file list for this pass.
Skipped, per the brief.

---

## 3. Trap A — Step 3's self-sizing textareas

### The bug, reproduced in real Chrome

`ProductDescriptionGenerator` has an effect with **no dependency array** that resizes every
`textarea.js-autogrow` to `scrollHeight + (offsetHeight - clientHeight)` after each render. Two facts
collide:

1. PDG re-renders while Step 3 is parked. It reads `processedItems` from the store, and a Step 2 grouping
   action writes that array — so the effect runs with the section at `display: none`.
2. A hidden textarea measures zero. Measured (`obs-probe.mjs`, headless Chrome):

   | | `scrollHeight` | `offsetHeight` | `clientHeight` | `offsetParent` | effect would write |
   |---|---|---|---|---|---|
   | shown | 82 | 45 | 43 | set | **84px** ✓ |
   | `display: none` ancestor | 0 | 0 | 0 | **null** | **0px** ✗ |

`height: 0px` would then be *committed and stay committed*, because PDG is `React.memo`'d and a
`phoneStep` change does not re-render it. The user comes back to three collapsed boxes.

### The fix (inside that effect only)

```ts
const fit = (el: HTMLTextAreaElement) => {
  if (el.offsetParent === null) return;          // not laid out → do not measure
  el.style.height = 'auto';
  const h = el.scrollHeight + (el.offsetHeight - el.clientHeight);
  if (!(h > 0)) return;                          // belt and braces; leaves height:auto
  const next = `${h}px`;
  if (el.style.height !== next) el.style.height = next;
};
```

`offsetParent === null` is exactly true inside a `display: none` subtree (the `position: fixed` exception to
that rule cannot apply — these textareas are in normal flow), and the probe confirms it.

Then the re-run: **one `ResizeObserver` per textarea**, feature-detected, created in the same effect and
disconnected in its cleanup. `display: none → block` changes each box from 0×0 to a real size, which *is* a
resize. Measured RO callback heights across the cycle: **`[39, 0, 78]`** — initial, hidden, restored. The
same observer covers orientation change and Android font-boost for free, and there is still no `matchMedia`
and no resize listener in this feature.

The RO callback defers its work to a `requestAnimationFrame` instead of writing heights inline. Writing a
height from inside the delivery loop is what produces Chrome's *"ResizeObserver loop completed with
undelivered notifications"* error, and `installErrorReporter()` listens for `window 'error'` — a benign
console warning would otherwise become `app_errors` rows.

### No pure helper was extracted

The brief offered `autogrowHeight(scrollHeight, offsetHeight, clientHeight) → number | null` as a testable
unit. It was not extracted: the arithmetic is one line and the only real content is the hidden-element
guard, which is a **DOM** condition (`offsetParent`) that cannot be expressed as an argument without
re-encoding the same assumption in the test — and a new `src/lib/` module is outside this pass's file list.
The evidence that the guard is right is the measured table above, produced against real Chrome rather than
against happy-dom, which does not implement layout at all.

---

## 4. Trap B — Step 2's measured layout, and `--dock-h`

`ImageGrouper` was **not edited** (it was changed and verified two passes ago). What follows is the proof
that a `display: none → block` cycle cannot leave it holding a stale number.

### 4.1 Every measurement is gesture-scoped

Every `getBoundingClientRect` / `scrollTop` read in `ImageGrouper.tsx` is inside an event handler or inside
the rAF loop that only runs *during* an active drag:

| Site | When it runs |
|---|---|
| `handleMouseDown` (L1677) — container rect + `scrollTop` for the selection origin | on `mousedown`, live |
| the rubber-band `mousemove` handler and the intersection sweeps (L1033–L1123) | during a drag, live, rect re-read each pass |
| the auto-scroll rAF loop (L963–L1001) | only while `isSelecting`, rect re-read each frame |
| drag-over / drop rects (L2064, L2116, L2130) | inside HTML5 drag handlers (desktop only) |
| crop-modal image bounds (L505–L595) | gated on `cropModal.open`, via rAF + `useLayoutEffect` |

**Nothing measures on mount, and nothing caches a rect across a gesture.** The one hoist that exists (the
container rect lifted out of the two intersection loops, §14 #12) lives inside a single `mousemove` call.
There is no `ResizeObserver` and no `IntersectionObserver` in the file. The crop modal cannot be open while
the stepper is reachable — it is a full-screen fixed overlay, so a step change cannot happen underneath it.

`initializeItems` and the phone-flag effect measure nothing: the flag is `matchMedia('(max-width: 640px)')`,
which is a **viewport** query and is unaffected by an ancestor's `display`.

`content-visibility: auto` and `loading="lazy"` are both browser-side and resume when the section is
painted again; neither can persist a stale number.

### 4.2 Scroll position survives — measured, not assumed

`display: none` is widely believed to reset a scroll container. It does not, in Chrome: the probe scrolled a
container to `scrollTop: 800`, hid its wrapper, showed it again, and read **800**. So the grid does not jump
to the top when the user steps away and back.

### 4.3 `--dock-h` resolves to 0 while Step 3 is parked

PDG publishes `--dock-h` on `.app-container` from an `IntersectionObserver` on the sticky nav dock, and the
shortcuts gear and the support pill both add it to their `bottom`. If it stayed non-zero while Step 3 was
hidden, both FABs would float for a bar that is not on screen.

It does not. `IntersectionObserver` fires on **both** transitions — measured entries across a
hide/show cycle: **`[{isIntersecting: true}, {isIntersecting: false}, {isIntersecting: true}]`** — so
`publish(false)` runs on hide and sets `--dock-h: 0px`. The effect's `resize` fallback is safe for the same
case by a second route: `getBoundingClientRect()` on a hidden element is all zeros, so
`r.bottom > 0 && r.top < window.innerHeight` is false. **No change was needed.**

---

## 5. Screenshots (`docs/reviews/img-18/`)

Method: the logged-out landing page at `localhost:5173` loads the real CSS bundle, so the exact markup App
renders is injected into it and screenshotted (`steps.mjs` in the scratchpad drives headless Chrome over
the DevTools protocol, stamping `data-phone-step` and the matching stepper state for each shot).

| File | What it shows |
|---|---|
| `390-step1.png` | Step 1 active. Steps 2/3 open, Step 4 disabled. Full-width "Continue to Group". |
| `390-step2.png` / `390-step2-full.png` | Step 2 active — stepper (✓ Upload, **2** Group, Describe, Export) above the grid and the category dock; the full-page shot shows the Back / Continue row below the settled dock. |
| `390-step3.png` / `390-step3-full.png` | Step 3 active; the full-page shot shows the Back / Continue row clear of the sticky Prev/Next dock. |
| `390-step4.png` | Step 4 active, Back only, three ticks behind it. |
| `360-stepper.png` | 360px — all four labels still fit, nothing truncated. |
| `1280-desktop.png` | 1280px — no stepper, no Continue rows, all four sections stacked as before. |

Probe output at each step (from the same run):

```
390 step 1  visibleSections ["1"]  stepper block  scrollW 390 = clientW 390  taps 44,44,44,44,44
390 step 2  visibleSections ["2"]  stepper block  scrollW 390 = clientW 390  taps 44,44,44,44,44,44
390 step 3  visibleSections ["3"]  stepper block  scrollW 390 = clientW 390  taps 44,44,44,44,44,44
390 step 4  visibleSections ["4"]  stepper block  scrollW 390 = clientW 390  taps 44,44,44,44,44
360 step 2  visibleSections ["2"]  stepper block  scrollW 360 = clientW 360
640 step 1  visibleSections ["1"]  stepper block          ← phone behaviour at the boundary
641 step 1  visibleSections ["1","2","3","4"]  stepper none, continue rows none
1280        visibleSections ["1","2","3","4"]  stepper none, continue rows none
```

`document.documentElement.scrollWidth === clientWidth` at every phone width tested. No console errors and
no exceptions in any run.

One visual nit visible in `390-step2.png` is **pre-existing**: the "4 selected" chip at the end of the Step 2
toolbar is clipped by that toolbar's own horizontal scroller (shipped in `4557d15`). It causes no page
overflow and is outside this pass's files.

---

## 6. Not verified

- **Nothing was seen signed in.** No harness can authenticate, so the stepper, the Continue rows and the
  step switching were rendered from the real CSS against hand-written markup that matches what App emits —
  that proves the cascade, not the React wiring. The state machine itself is covered by 24 unit tests, and
  `tsc` proves the props line up, but the owed smoke test is: upload on a phone → land on Step 2 → group →
  Continue → Describe → Back → Group → Continue → Continue → Export, then reload and confirm the batch
  reopens on Step 4.
- **No real-iOS pass.** Chrome's emulator was used. The 44px targets and the 16px form rule were read from
  the computed CSS, as in the earlier mobile passes.
- **Trap A's ResizeObserver was proven in isolation, not inside PDG.** The measured `[39, 0, 78]` cycle used
  a standalone textarea in real Chrome with the same DOM shape; PDG's own three textareas could not be
  rendered without signing in.
- **The "ResizeObserver loop" error was avoided by construction** (writes deferred to rAF), not observed.
- Whether landing a reopened batch on **Step 4** is the behaviour the founder wants — see §7.

---

## 7. Open question — resolved after review

Every restore path sets all four item arrays from the same list, so `furthestStep` was **4** for any batch
with anything in it: reopening a batch from the Library landed on Export. `workflow_batches.current_step`
was considered (it is on the row, written on every auto-save by `determineCurrentStep()`), but its rule says
"all categorized = 4", which on a phone would still open a fully categorized batch on Export while the
descriptions — the actual work — are unfinished, and the slim state cannot tell. The restore sites now call
`resumeStep(items)` (`lib/phoneSteps.ts`, 4 tests): no items → 1, none categorized → 2, any categorized → 3,
never 4. Export is the one step with nothing to resume and it is one Continue tap away from Describe.
