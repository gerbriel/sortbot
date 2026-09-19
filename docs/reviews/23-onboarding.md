# 23 — Onboarding: a first-run checklist for a beta shop's first screen

**Date:** 19 Sept 2026 · **Scope:** `src/lib/onboarding.ts` + `.test.ts` (new),
`src/components/OnboardingChecklist.tsx` + `.css` + `.test.tsx` (new),
`src/components/HomeDashboard.tsx` + `.test.tsx` (wiring), `src/App.tsx` (three props,
one effect, one unrelated fallback) · **Nothing committed. No SQL was run. No migration is
needed. No dependency added.**

The ask: *"Also need an onboarding process for beta / subscribed users."*

---

## 1. What was actually wrong

An approved shop signs in. `ensureOrganization` mints their workspace (`plan = 'beta'`),
seeds its default categories and presets, and drops them on Home — which, as of pass 20,
shows them their (empty) current batch, their (empty) recent batches, a tools grid, and
nothing at all about **what to do first**.

Four things need doing before the first listing is any good, and every one of them lives
behind a menu row somebody has to think to open:

| | Why it matters on listing #1, not listing #100 |
|---|---|
| the shop name | it is the **Vendor** column on every Shopify row, and it is what `scrubSellerBrand` matches so the shop's own name never lands in a garment's brand (§11, report 23) |
| categories and presets | Step 2 drags onto them; a preset fills shipping, measurements and the SEO template in one click |
| marketplaces | Step 4 offers only the ones the workspace has turned on |
| the team | one person shoots while another describes — and they need an invite |

Nothing was broken. There was simply no surface that said "here is the order".

---

## 2. The shape: a pure rule, a widget that owns its reads, and a thing that leaves

`src/lib/onboarding.ts` answers one question — *what is left to set up?* — from facts it is
handed. `OnboardingChecklist.tsx` gathers those facts and renders them. The split is the
same one `home.ts` / `HomeDashboard.tsx` and `phoneSteps.ts` / `App.tsx` already make, for
the same reason: **a checklist that tells a paying shop to do something it has already done
is worse than no checklist**, and that is only testable if the rule is a function.

```
deriveOnboardingSteps(facts) → OnboardingStep[]      (7 max, ordered, role-aware)
onboardingProgress(steps)    → { done, total, complete }
read/writeOnboardingLocal(orgId, …)                  (sortbot_onboarding_<orgId>)
```

---

## 3. The four decisions

### 3.1 Unknown is not done

Every fact defaults to its "we could not find out" value (`UNKNOWN_FACTS`) and every `done`
test is written so that value reads as **undone**. Every read in the component is
independently wrapped, and a rejection resolves to that same fallback.

A flaky connection therefore leaves a step on the list — visible, dismissible — rather than
quietly ticking it off and retiring the whole card. The inverse failure is the expensive
one: a shop that never names itself exports 400 listings with the wrong Vendor.

`deriveOnboardingSteps` takes a `Partial`, so the test can pass `{}` and assert that
nothing at all is done. It does.

### 3.2 A step you cannot take is ABSENT, not red

Two separate reasons a step is not rendered at all:

- **The migration has not run.** `marketplaceService` and `shopifyConnectionService` both
  report the house `'unavailable'` shape, and that hides the step. This is the same rule
  Home's own widgets follow (pass 20 §3): *hidden* is distinct from *loaded and empty*, and
  a feature that is not installed must not render an invitation to use it.
- **RLS would refuse the caller.** `organizations`, `org_marketplaces` and
  `org_shopify_connections` are all admin/owner on write. A plain member shown "Name your
  shop" could only fail at it. So a member's list is three lines — review your categories,
  upload your first batch, export it — and every one is something they can finish.

The component uses the same test to decide what to **fetch**: a member never asks for the
marketplaces rows, the Shopify connection or the member roster, because no step of theirs
depends on any of them.

### 3.3 `complete` counts the REQUIRED steps; the readout counts everything

`Connect your Shopify store` and `Invite your team` are `optional: true`. A solo reseller
importing by CSV will never do either, and a checklist that sits on their dashboard forever
because of it is a checklist they will hide.

So `complete` — which retires the card — ignores optional steps, while `done` / `total`
count every step on the list, because that is what the reader sees. "4 of 7 done" over a
card that is about to vanish is correct: the three left are two optional ones and the one
that just completed.

`onboardingProgress([])` is `complete`, not stuck.

### 3.4 It never flashes, and a dismissed workspace reads nothing

The card renders `null` until the facts have settled. Every workspace is an established
workspace within a week, and a checklist that appears and then vanishes on every page load
is worse than one that is a beat late on day one.

The local record is checked **before** the network: a workspace that dismissed the checklist
makes zero reads. (`expect(getCategories).not.toHaveBeenCalled()` is a test.)

### 3.5 The one fact the database cannot answer

"Have you reviewed your categories?" is a human judgement. The only observable proxy is
that the page was opened, so the step is ticked by a **visit** — and the visit is recorded
in **App's view-change effect**, not on the checklist's own button:

```ts
useEffect(() => {
  if (!resolvedOrgId) return;
  if (activeView === 'categories') writeOnboardingLocal(resolvedOrgId, { visitedCategories: true });
  else if (activeView === 'presets') writeOnboardingLocal(resolvedOrgId, { visitedPresets: true });
}, [activeView, resolvedOrgId]);
```

The workspace menu, the Tools grid and a keyboard walk all reach those pages. A step that
only ticks when you arrive through one particular door is a step that never ticks.

The category and preset **counts** go in the sentence, not in the rule. Gating on
`presetCount > 0` would deadlock a workspace whose preset seed failed — the step could never
be completed and the card could never retire.

`sortbot_onboarding_<orgId>` is per WORKSPACE (a founder who sets up two shops sets up two
shops), cosmetic, and every accessor is wrapped — `localStorage.getItem` itself throws with
site data blocked, so the try/catch is round the accessor and not just the parse. Absent
means show the checklist, which is the safe failure.

---

## 4. Cost, and the duplication that was accepted

Up to six projected reads, two of which Home makes anyway
(`fetchWorkflowBatchesMeta`, `fetchOrgMarketplaces`). That duplication is real and
deliberate:

- it is paid **only while setup is unfinished**, which is exactly the window where an extra
  round trip matters least;
- `fetchPublications` is the one that could be large, and it is only asked for when no batch
  has reached Step 4 — a shop that has exported to Shopify never pays it;
- the alternative is threading six facts through `HomeDashboard`'s props for a widget whose
  whole job is to delete itself.

`hasVendorName` is the exception and is a **prop**: App already holds
`orgDescSettings`, and reading it as a prop means saving the shop name ticks the step on the
next render with no refetch.

---

## 5. Two notes on the React

**No synchronous `setState` in the effect body.** `react-hooks/set-state-in-effect` rejects
it, and the fix is better than the code it replaced: the facts carry the workspace they were
read for and the dismissal carries the workspace it was clicked in, both compared at render.

```ts
const fetched = settled && settled.orgId === orgId ? settled.facts : null;
const dismissed = !!orgId && dismissedIn === orgId;
```

Switching workspace can therefore never show one workspace's checklist against another's
facts, and there is nothing to correct in an effect. Same shape as `shownStep` in §6.

**`HomeDashboard.test.tsx` mounts the real child** rather than stubbing it, so its four
extra reads are mocked in that file alongside every other widget's. Nothing in either test
file touches the network.

---

## 6. What the screenshots caught

Method as in passes 20–22: the component's **real rendered DOM** (through `ui/testUtils`)
injected into a page that links the **built** `index.css` and `HomeDashboard` chunk CSS,
screenshotted in headless Chrome at 1280 and 390 with a probe for `scrollWidth`,
`clientWidth`, every sub-44px target and the computed `font-size` of every control.

Two real defects, both invisible in the source:

1. **The tick was orphaned on a line of its own, on the phone.** `.onb-step` is allowed to
   wrap below 640px so the button can drop under the sentence it belongs to — but
   `.onb-body` was `flex: 1 1 auto`, and `auto` means *the sentence's own max-content
   width*, which is wider than what is left beside an 18px tick. The body wrapped to line 2
   and left the tick alone on line 1. `flex: 1 1 0` is the entire fix, and it is identical
   on desktop, where the row does not wrap and the body shrank to the same width either way.
   Card height at 390: **1451 → 1291px**.

2. **A done step's rationale was below the contrast floor.** `--text-faint` (`#8e8e8e`) on
   `--ink-850` (`#f3f3f3`) is roughly 2.8:1, and §1 requires body text at AA 4.5:1 with
   `--text-muted` reserved for non-essential meta. Rather than re-tint it, **a done step now
   collapses to its title alone**: the sentence existed to talk someone into doing the thing,
   and seven of them is a card that grows as the work shrinks. There is no greyed-out body
   text left on the card to fail the floor. Card height at four-of-seven: **691 → 531px**
   (desktop), **1010 → 781px** (phone).

One deliberate change while looking: the step buttons went from `sm` (24px) to the default
`md` (32px). They are the page's invitations on a shop's first screen and they match every
other Home widget; the footer "Hide this checklist" stays `sm`, because it is a dismissal.

Final measurements:

| Width | `scrollWidth` = `clientWidth` | Targets < 44px | Control font |
|---|---|---|---|
| 1280 (0 of 7) | 1280 = 1280 ✓ | n/a (pointer) | 14px |
| 390 (0 of 7) | 390 = 390 ✓ | **none** | 14px |
| 1280 (4 of 7) | 1280 = 1280 ✓ | n/a (pointer) | 14px |
| 390 (4 of 7) | 390 = 390 ✓ | **none** | 14px |

No touch-target rule was written into `OnboardingChecklist.css`: `ui/Button.css` already
floors every size at the 44px literal below 640px, and restating it would be a second place
to keep in step (§18 #26). The measurement above is the proof it works.

Screenshots: `img-23/onboarding-fresh-1280.png`, `img-23/onboarding-fresh-390.png`,
`img-23/onboarding-mid-1280.png`, `img-23/onboarding-mid-390.png`.

---

## 7. One unrelated change, decided in the same pass

`App.tsx`'s `resolvedVendorName` fell back to the literal string `'C&D Vintage'` whenever
`currentOrg?.slug === 'founding'`. It now falls back to `currentOrg?.name`, like every other
workspace: the Founding Workspace is becoming a demo and testing workspace while that shop
moves to its own tenant, and a workspace that wants a Vendor different from its own name
types one into **Workspace → Settings**, which is what that field is for.

`grep -rn "C&D" src/` afterwards shows no other fallback — the remaining hits are test
fixtures (`csvExport.test.ts`, `productRow.test.ts`, `brandSpelling.test.ts`,
`MarketplaceExport.test.tsx`) that pass the name explicitly and assert what they pass, so
none of them changed. **Two stale references were left alone because they are outside this
pass's file list**, and both are cosmetic:

- `OrgPanel.tsx:800` — the Vendor input's `placeholder` still previews `'C&D Vintage'` for
  the founding workspace; it should now preview `org.name`.
- `descriptionSettings.ts:28` — a doc comment still describes the old fallback.

---

## 8. Gates

| | Before | After |
|---|---|---|
| `npx vitest run` | 1696 / 79 files | **1745 / 81 files, green** |
| `npm run build` | clean | **clean** (the pre-existing `supabase.ts` dynamic-import warning only) |
| `npx eslint .` | 252 | **252 — flat** |

49 new tests: 29 in `onboarding.test.ts`, 20 in `OnboardingChecklist.test.tsx`.

---

## 9. Open questions and what was deliberately not done

- **Nothing here has been seen signed in.** Same standing limitation as §14 #26 — the
  screenshots prove the cascade and the real rendered markup, not the React wiring against
  live data. Owed: sign in as a brand-new beta workspace, walk all seven steps, and confirm
  the card retires.
- **`role` and `canInvite` are two facts that will almost always agree.** The brief named
  both, so `role` gates the three admin-write steps and `canInvite` gates the invite. If
  they ever diverge, the invite step is the one that is right.
- **A checklist that is complete still costs its reads once per Home mount** for any
  workspace that has not dismissed it, because "complete" is only knowable after the reads.
  The cheap fix — writing `hidden: true` the first time it completes — was not taken: it
  would permanently hide a checklist that could legitimately come back (a workspace that
  turns every marketplace off again), and the reads are projected and parallel.
- **The greeting is the workspace name, and appears only while the workspace has no batch.**
  After that the shop is working, and being welcomed again reads as the app not knowing who
  it is talking to.
- **Not built:** a progress bar (the "N of M done" line is enough for seven items), a
  per-step dismissal, anything email-shaped (a welcome email is a server concern and this
  app sends none), and any change to `ensureOrganization` — the checklist reports on what
  the bootstrap already does, it does not do any of it.
